// R2 대응 방식 다양화 (docs/specs/R2-methods.md §8). 시험 1(판단부의 정보 격리), 틀(고르기·바꾸기·기록 — 시험이 표를 단계 0 처럼 끄고 줄을 켜서 본다: withRows),
// 단계 1a(수난의 물가 방법 — §8 의 2·3·4·5·6·7·8·9 가운데 1a 의 몫, 맨 아래 묶음들). 방법을 구현하는 뒤 단계(1b~6)가 자기 몫을 더한다.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KITS, ROLES, kitWorks } from '../src/sim/crews';
import { PROBLEM_LABEL, buildReport, evaluate } from '../src/sim/debrief';
import { NORMAL } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { raiseProblem } from '../src/sim/events';
import { casFact, fitFor, perceive } from '../src/sim/field/agents';
import { mkFact } from '../src/sim/field/beliefs';
import { XK, act, makeTask } from '../src/sim/field/executor';
import { BARE_HANDS, SHARED, isQty, kitCount, kitName, kitTool, seatsLeft, swimBonus, useKit } from '../src/sim/field/gear';
import { staticPass } from '../src/sim/field/grid';
import { WORK_DONE, methodFailLine, methodLines, methodSummary, methodTally, whyText } from '../src/sim/field/methodReport';
import { FAIL_KEEP, grabP, hitP, mrng, recheckOnArrive, recordAir, recordMethod, senseOf, startMethod, switchMethod, targetOf } from '../src/sim/field/methodRun';
import { METHOD, METHOD_ORDER, NOT_YET, NO_SENSE, SAY, WORK_MODE, catchPoint, chooseMethod, landComp, methodFit, methodStillFits, methodsOf, onWater, reachOf, sayStart, swimOf, targetKey, targetOfWork, whyNote } from '../src/sim/field/methods';
import type { MTarget, MethodDef } from '../src/sim/field/methods';
import { FLOW_MIN, methodsRule } from '../src/sim/field/rules/methods';
import { SCENE_RULES } from '../src/sim/field/sceneRegistry';
import { unitArrived } from '../src/sim/field/sceneManager';
import { createIncident } from '../src/sim/incidents';
import { createAidUnit } from '../src/sim/resources';
import { tickWater } from '../src/sim/field/hazards';
import { T } from '../src/sim/types';
import type { CasBelief, Casualty, FieldAgent, Incident, IncidentType, KitId, MethodId, MethodUse, Needs, RoleId, Scene, Task, UnitKind, WorkItem, WorkKind } from '../src/sim/types';
import { clamp } from '../src/sim/util';
import { MethodRows } from '../src/ui/MethodRows';

// ───────────────────────── 도구 ─────────────────────────
const FULL: Difficulty = { ...NORMAL, resources: 5 };      // 모든 부대가 편성된다
/** 주석 줄을 뺀 소스 (tests/crews.test.ts 와 같은 방식: //, /*, * 로 시작하는 줄) */
const code = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8').split('\n').filter((l) => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); }).join('\n');
/** 난수 흐름의 다음 값 (사본에서 본다 — 원본은 소비하지 않는다) */
const peek = (r: unknown): number => { if (!r) return -1; const c = Object.create(Object.getPrototypeOf(r)); Object.assign(c, r); return c.next(); };
/** 현장을 하나 만들고 부대를 내려 세운다. 모든 대원이 모든 구조 대상을 본 것으로 둔다(믿음) */
function sceneWith(seed: string, what: string, kinds: UnitKind[]): { sim: Sim; I: Incident; s: Scene; of: (kind: UnitKind) => FieldAgent[]; role: (r: RoleId) => FieldAgent } {
  const sim = new Sim(seed, FULL);
  for (const r of sim.responders) for (const it of r.kit!) it.fault = false;      // 고장은 시험이 직접 준다
  const [type, variant] = what.split('/');
  const I = createIncident(sim, { type: type as IncidentType, variant: variant || undefined, rng: sim.rng.fork('t') });
  const s = sim.scenes[I.id]!;
  for (const kind of kinds) unitArrived(sim, I, sim.units.find((u) => u.kind === kind)!);
  for (const a of s.agents) for (const c of s.casualties) a.beliefs.merge(casFact(sim, s, c, '시험'));
  return { sim, I, s, of: (kind) => s.agents.filter((a) => sim.units[a.unitId].kind === kind), role: (r) => s.agents.find((a) => sim.responders[a.rid].role === r)! };
}
const tgCas = (c: Casualty): MTarget => ({ cas: c.id, prop: -1, hostile: -1, region: -1, tile: -1 });
const work = (sim: Sim, s: Scene, kind: WorkKind, tg: Partial<WorkItem> = {}): WorkItem => {
  const w: WorkItem = { id: s.board.length, kind, region: -1, cas: -1, prop: -1, hostile: -1, tile: -1, mate: -1, priority: 0.8, status: 'active', assignees: [], max: 1,
    createdAt: sim.t, doneAt: -1, note: '', fails: 0, holdUntil: 0, thorough: false, orderSentAt: {}, cause: -1, failedAt: {}, ...tg };
  s.board.push(w);
  return w;
};
const taskFor = (a: FieldAgent, w: WorkItem): Task => { const t = makeTask(w.kind, '시험', w); a.task = t; a.status = 'active'; return t; };
/** 방법을 켠 단계가 조건(can)을 채운 줄 — 단계 1a: 수난의 물가 방법 여섯 */
const LIVE: MethodId[] = ['hand', 'pole', 'ring', 'rope', 'improvise', 'catch'];
/**
 * 시험 동안만 표를 "틀" 상태(단계 0 — 모든 줄이 꺼져 있고 배율이 없다)로 두고 patch 의 줄만 고친다. 끝나면 되돌린다.
 * 고르는 틀(점수·까닭·넓히기·접기·기록)을 단계와 상관없이 같은 손 계산으로 보기 위해서다 — 켜진 줄의 실제 조건은 아래 "단계 1a" 묶음이 본다
 */
function withRows<V>(patch: Partial<Record<MethodId, Partial<MethodDef>>>, fn: () => V): V {
  const saved: Partial<Record<MethodId, MethodDef>> = {};
  for (const m of METHOD_ORDER) if (METHOD[m].can !== NOT_YET || METHOD[m].situ || METHOD[m].skill || patch[m]) {
    saved[m] = { ...METHOD[m] };
    Object.assign(METHOD[m], { can: NOT_YET, situ: undefined, skill: undefined }, patch[m] ?? {});
  }
  try { return fn(); } finally { for (const m of Object.keys(saved) as MethodId[]) Object.assign(METHOD[m], saved[m]); }
}
const ON = { can: () => true };
const cautionOf = (sim: Sim, a: FieldAgent): number => { const r = sim.responders[a.rid]; return clamp(1.1 - 0.3 * r.composure - 0.3 * r.experience, 0.5, 1.1); };
const give = (sim: Sim, rid: number, id: KitId, uses?: number): void => { sim.responders[rid].kit!.push({ id, uses, fault: false, faultKnown: false }); };
const strip = (sim: Sim, rid: number, ...ids: KitId[]): void => { sim.responders[rid].kit = sim.responders[rid].kit!.filter((it) => ids.indexOf(it.id) < 0); };
const texts = (sim: Sim, from: number): string[] => sim.events.slice(from).map((e) => e.text);
/** 물 현장: 다리를 끊는다 (두 물가가 다른 뭍 성분이 된다) */
function cutBridge(s: Scene): number {
  let bx = -1;
  for (let x = 0; x < s.w && bx < 0; x++) for (let y = 0; y < s.h; y++) if (s.tiles[y * s.w + x] === T.TRAIL) { bx = x; break; }
  for (let y = 0; y < s.h; y++) if (s.tiles[y * s.w + bx] === T.TRAIL) s.tiles[y * s.w + bx] = T.WATER;
  s.staticVersion++;
  return bx;
}
/** 물 칸의 맨 윗줄 (그 열에서) */
const waterTop = (s: Scene, x: number): number => { for (let y = 0; y < s.h; y++) if (s.tiles[y * s.w + x] === T.WATER) return y; return -1; };

// ───────────────────────── 시험 1: 정보 격리 ─────────────────────────
describe('R2 시험 1: 판단부(methods.ts)는 진실을 읽지 않는다', () => {
  it('주석이 아닌 줄에 진실·숨은 고장·효과 함수의 이름이 없다', () => {
    const src = code('../src/sim/field/methods.ts');
    expect(src.length).toBeGreaterThan(5000);
    for (const bad of ['s.props', 's.casualties', 's.hostiles', '.truth', 's.fire[', 's.smoke[', 'sim.scenes', 's.variant', '.fault', 'kitWorks', 'useKit', 'bestTool']) expect(src.includes(bad), bad).toBe(false);
  });
  it('agents·hazards·executor·methodRun·crews 를 import 하지 않는다 (장비는 gear.ts 로만)', () => {
    const imports = code('../src/sim/field/methods.ts').split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    for (const bad of ['./agents', './hazards', './executor', './methodRun', '../crews', './sceneManager', './commander', './brain']) expect(imports.includes(`'${bad}'`), bad).toBe(false);
    expect(imports).toContain("'./gear'");
    // gear.ts 에서 판단용 함수만 가져온다
    const gearLine = imports.split('\n').find((l) => l.includes("'./gear'"))!;
    for (const bad of ['kitTool', 'bestTool', 'kitWorks', 'useKit']) expect(gearLine.includes(bad), bad).toBe(false);
  });
  it('gear.ts 는 crews 와 타입만, methodRun.ts 는 실행기를 import 하지 않는다 (순환 없음). 실행기는 methodRun 의 타입만 가져온다', () => {
    const imp = (p: string): string => code(p).split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    for (const bad of ['./agents', './executor', './hazards', './methods', './methodRun']) expect(imp('../src/sim/field/gear.ts').includes(`'${bad}'`), bad).toBe(false);
    expect(imp('../src/sim/field/methodRun.ts').includes("'./executor'")).toBe(false);
    expect(imp('../src/sim/field/executor.ts')).toMatch(/import type \{ ExecKit \} from '\.\/methodRun'/);
    expect(typeof XK.moveTo).toBe('function'); expect(typeof XK.finish).toBe('function'); expect(typeof XK.drain).toBe('function'); expect(typeof XK.spray).toBe('function'); expect(XK.makeTask('standby', 'x').kind).toBe('standby');
  });
  it('방법 그림·패널(src/ui·src/view)은 판단부의 표와 임무에 적힌 칸만 읽는다', () => {
    const src = code('../src/ui/MethodRows.tsx');
    for (const bad of ['chooseMethod', 'methodFit', 'startMethod', 'switchMethod', 'recordMethod', 'kitWorks', 'useKit', 'bestTool', 'toolUse']) expect(src.includes(bad), bad).toBe(false);
  });
});

// ───────────────────────── 방법 표 ─────────────────────────
describe('R2 방법 표 (METHOD)', () => {
  const ids = Object.keys(METHOD) as MethodId[];
  it('모든 줄이 온전하다: 이름·짧은 이름·라벨(12자 안)·문장에 끼우는 말, 장비는 표에 있는 것, 임무가 하나 이상', () => {
    expect(ids.length).toBe(60);      // R2 의 55 + N9 단계 1 의 다섯(dive·boom·shieldLine·deconTent·hoseWash — can 은 NOT_YET)
    expect(METHOD_ORDER).toEqual(ids);
    for (const m of ids) {
      const d = METHOD[m];
      expect(d.id, m).toBe(m);
      for (const v of [d.name, d.short, d.label, d.noun]) expect(v.length, m).toBeGreaterThan(0);
      expect(d.label.length, `${m} 라벨 "${d.label}"`).toBeLessThanOrEqual(12);
      expect(d.work.length, m).toBeGreaterThan(0);
      for (const k of d.kits) expect(KITS[k], `${m}: ${k}`).toBeTruthy();
      expect(d.pref).toBeGreaterThanOrEqual(0); expect(d.pref).toBeLessThanOrEqual(1);
      expect(d.risk).toBeGreaterThanOrEqual(0); expect(d.risk).toBeLessThanOrEqual(1);
      if (!d.record) { expect(SAY[m].length, `${m} 시작 문구`).toBeGreaterThan(0); expect(d.pref, m).toBeGreaterThan(0); }
      for (const w of d.work) expect(WORK_MODE[w], `${m}: ${w}`).toBeTruthy();
    }
  });
  it('평소 방법(시작을 알리지 않고 보고서에 넣지 않는다)과 기록 전용 방법의 목록이 설계서와 같다', () => {
    const plain = ids.filter((m) => METHOD[m].plain && !METHOD[m].record).sort();
    expect(plain).toEqual(['rope', 'pole', 'hand', 'irons', 'handClear', 'toolClear', 'basic', 'spread', 'call', 'line', 'interior', 'stay', 'seal', 'cordon'].sort());
    const rec = ids.filter((m) => METHOD[m].record).sort();
    expect(rec).toEqual(['hoist', 'chase', 'breach', 'bang', 'tackle', 'cover', 'taser', 'shield', 'airlift', 'air'].sort());
    // 기록 전용 가운데 보고서에 싣는 것(평소 방법이 아닌 것)
    expect(rec.filter((m) => !METHOD[m].plain).sort()).toEqual(['hoist', 'airlift', 'bang', 'taser', 'shield', 'air'].sort());
  });
  it('수치는 설계서의 시작값이다 (수난·문·화재의 줄)', () => {
    const pr = (m: MethodId): [number, number] => [METHOD[m].pref, METHOD[m].risk];
    expect(pr('hand')).toEqual([1.0, 0]); expect(pr('pole')).toEqual([0.92, 0]); expect(pr('ring')).toEqual([0.84, 0]); expect(pr('rope')).toEqual([0.85, 0]);
    expect(pr('improvise')).toEqual([0.5, 0]); expect(pr('catch')).toEqual([0.8, 0]); expect(pr('swim')).toEqual([0.45, 0.3]); expect(pr('tend')).toEqual([0.9, 0]); expect(pr('boat')).toEqual([0.78, 0.08]);
    expect(pr('kick')).toEqual([0.5, 0]); expect(pr('irons')).toEqual([0.85, 0]); expect(pr('ram')).toEqual([0.8, 0]); expect(pr('hydraulic')).toEqual([0.9, 0]); expect(pr('charge')).toEqual([0.8, 0.1]);
    for (const m of ['interior', 'defensive', 'aerial', 'extinguisher', 'ventilate'] as MethodId[]) expect(METHOD[m].risk, m).toBe(0);      // 진압 방법 다섯의 risk 는 0
    expect(METHOD.boat.kits).toEqual(['raft']); expect(METHOD.boat.altUnit).toEqual(['boat']); expect(METHOD.aerial.needUnit).toEqual(['ladder']);
    expect(METHOD.charge.work.sort()).toEqual(['clear', 'force']); expect(METHOD.hoist.work).toEqual(['hoist']);
    // 다친 대원이 고르지 않는 위험한 방법
    for (const m of ['swim', 'rapid', 'tunnel', 'charge', 'boat'] as MethodId[]) expect(METHOD[m].risk, m).toBeGreaterThan(0);
  });
  it('임무별 갈래: 수난 구조는 맡지 않음, 진압·교전은 선택 임무, 문·구출·수색·처치·누출·통제는 늘 남는 방법이 있다', () => {
    expect(WORK_MODE.waterRescue).toBe('refuse');
    for (const w of ['suppress', 'engage', 'arrest', 'load', 'hoist'] as WorkKind[]) expect(WORK_MODE[w], w).toBe('optional');
    for (const w of ['force', 'clear', 'extricate', 'search', 'treat', 'mitigate', 'perimeter'] as WorkKind[]) {
      expect(WORK_MODE[w], w).toBe('always');
      // 늘 남는 줄: 장비도 부대 조건도 없는 방법이 하나는 있다 (기록 전용 제외)
      expect(methodsOf(w).some((m) => !METHOD[m].record && METHOD[m].kits.length === 0 && !METHOD[m].needUnit), w).toBe(true);
    }
    expect(methodsOf('waterRescue')).toEqual(['hand', 'pole', 'ring', 'rope', 'improvise', 'catch', 'swim', 'tend', 'boat', 'dive']);      // dive: N9 단계 1 (표의 끝 — can 은 NOT_YET)
    expect(methodsOf('carry')).toEqual([]); expect(WORK_MODE.carry).toBeUndefined();
  });
  it('문구: 시작 문구는 까닭을 먼저 말하고, 패널의 까닭 말은 짧다', () => {
    expect(sayStart('swim', 'noGear', 'rope')).toBe('구조 로프가 없습니다. 헤엄쳐 들어가겠습니다.');
    expect(sayStart('improvise', 'noGear', 'pole')).toBe('갈고리 장대가 없습니다. 옷을 이어 던지겠습니다.');
    expect(sayStart('boat', 'weak')).toBe('대상이 줄을 잡을 힘이 없습니다. 보트를 띄우겠습니다.');
    expect(sayStart('catch', 'usual')).toBe('하류에서 기다렸다 붙잡겠습니다.');
    expect(sayStart('charge', 'usual')).toBe('장약 설치합니다. 물러서십시오.');
    expect(whyNote('noGear', 'rope')).toBe('구조 로프 없음'); expect(whyNote('usual')).toBe(''); expect(whyNote(undefined)).toBe('');
  });
});

// ───────────────────────── 장비 ─────────────────────────
describe('R2 장비 아홉 줄과 gear.ts', () => {
  const NEW: KitId[] = ['pole', 'pfd', 'drysuit', 'raft', 'extinguisher', 'fan', 'airbag', 'shoring', 'beanbag'];
  it('단계 1a: 수난의 넷(장대·구명조끼·드라이슈트·고무보트)만 설계서의 역할이 기본 장비 끝에 든다 — 나머지 다섯은 아직 표에만', () => {
    for (const id of NEW) expect(KITS[id].name.length, id).toBeGreaterThan(0);
    // 설계서 §3.3 표의 "누가 든다" (단계 1a 의 넷). 수중 구조대의 두 자리(잠수 팀장·대원)는 N9 §4.8 대로 드라이슈트를 처음부터 든다 — 편성되지 않는 줄(minLevel 6)
    const WHO: Partial<Record<KitId, RoleId[]>> = {
      pole: ['engineer', 'ladderOp', 'boatRescuer'], pfd: ['ropeTech', 'boatRescuer', 'airRescuer'], drysuit: ['ropeTech', 'boatRescuer', 'diveLead', 'diver'], raft: ['ropeTech'],
    };
    for (const id of NEW) {
      const holders = (Object.keys(ROLES) as RoleId[]).filter((role) => ROLES[role].kit.indexOf(id) >= 0).sort();
      expect(holders, id).toEqual((WHO[id] ?? []).slice().sort());
    }
    // 끝에 붙였다: 그 역할의 R1·N9 장비 순서는 그대로다 (고장 추첨 순서)
    expect(ROLES.ropeTech.kit).toEqual(['scba', 'turnout', 'rope', 'ring', 'hose', 'pfd', 'drysuit', 'raft']);
    expect(ROLES.boatRescuer.kit).toEqual(['rope', 'ring', 'oilBoom', 'pole', 'pfd', 'drysuit']);
    expect(ROLES.engineer.kit.slice(-1)).toEqual(['pole']); expect(ROLES.ladderOp.kit.slice(-1)).toEqual(['pole']); expect(ROLES.airRescuer.kit.slice(-1)).toEqual(['pfd']);
    // 교대의 명부: 넷은 그 역할의 대원이 들고, 나머지 다섯은 아무도 들지 않는다. 표의 처음 수량은 명부가 복사한다 (kitFor)
    const sim = new Sim('R2-KIT', FULL);
    const LATER: KitId[] = ['extinguisher', 'fan', 'airbag', 'shoring', 'beanbag'];
    for (const r of sim.responders) for (const it of r.kit!) { expect(LATER.indexOf(it.id), `${r.name}: ${it.id}`).toBe(-1); expect(it.uses, `${r.name}: ${it.id}`).toBe(it.id === 'scba' ? sim.tune.airFull : it.id === 'flashbang' ? it.uses : ({ taser: 2, charge: 2 } as Partial<Record<KitId, number>>)[it.id] ?? KITS[it.id].uses); }
    expect(sim.responders.some((r) => r.kit!.some((it) => it.id === 'raft'))).toBe(true);
    expect(sim.responders.find((r) => r.role === 'boatRescuer')!.kit!.find((it) => it.id === 'oilBoom')!.uses).toBe(3);
    expect(KITS.extinguisher.uses).toBe(1); expect(KITS.beanbag.uses).toBe(3);
    expect(NEW.filter((id) => KITS[id].batch === 'r2').sort()).toEqual(['airbag', 'fan', 'raft']);
    expect(NEW.filter((id) => KITS[id].faultable).sort()).toEqual(['airbag', 'fan', 'raft']);
    expect(KITS.pole.tool).toEqual({ water: 0.7 });
    expect(SHARED).toBe(false);
  });
  it('kitCount: 없으면 0, 알려진 고장이면 0, 숨은 고장은 모른다, 수량 장비는 남은 수, 공기호흡기는 60초 문턱', () => {
    const sim = new Sim('R2-GEAR', FULL);
    const rid = sim.responders.find((r) => r.role === 'ropeTech')!.id, kit = sim.responders[rid].kit!;
    expect(kitCount(sim, rid, 'rope')).toBe(1); expect(kitCount(sim, rid, 'pole')).toBe(0);
    const rope = kit.find((it) => it.id === 'rope')!;
    rope.fault = true; expect(kitCount(sim, rid, 'rope'), '숨은 고장은 판단부가 모른다').toBe(1);
    rope.faultKnown = true; expect(kitCount(sim, rid, 'rope')).toBe(0);
    give(sim, rid, 'beanbag', 3); expect(isQty('beanbag')).toBe(true); expect(kitCount(sim, rid, 'beanbag')).toBe(3);
    useKit(sim, rid, 'beanbag'); expect(kitCount(sim, rid, 'beanbag')).toBe(2); useKit(sim, rid, 'beanbag', 5); expect(kitCount(sim, rid, 'beanbag')).toBe(0);
    give(sim, rid, 'extinguisher', KITS.extinguisher.uses); expect(kitCount(sim, rid, 'extinguisher')).toBe(1);
    expect(isQty('charge')).toBe(true); expect(isQty('flashbang')).toBe(true); expect(isQty('taser')).toBe(true); expect(isQty('rope')).toBe(false);
    const scba = kit.find((it) => it.id === 'scba')!;
    scba.uses = 60; expect(kitCount(sim, rid, 'scba')).toBe(1); scba.uses = 59; expect(kitCount(sim, rid, 'scba')).toBe(0); scba.uses = undefined; expect(kitCount(sim, rid, 'scba')).toBe(1);
    expect(kitName('rope')).toBe('구조 로프'); expect(kitName('pole')).toBe('갈고리 장대');
    expect(kitTool(sim, 'pole', 'water')).toBeCloseTo(Math.min(1.15, 0.7 * sim.tune.toolMul), 9); expect(kitTool(sim, 'pole', 'force')).toBe(0); expect(BARE_HANDS).toBe(0.12);
    const amb = sim.units.find((u) => u.kind === 'als')!, eng = sim.units.find((u) => u.kind === 'engine')!;
    expect(seatsLeft(sim, amb)).toBe(2); amb.patients.push(0); expect(seatsLeft(sim, amb)).toBe(1); amb.patients.length = 0; expect(seatsLeft(sim, eng)).toBe(0);
  });
  it('swimBonus 와 swimOf: 역할 보정, 0..1, 같은 사람은 같은 값이고 난수를 쓰지 않는다', () => {
    const { sim, s } = sceneWith('R2-SWIM', 'water', ['rescue', 'patrol', 'engine', 'als']);
    const by = (role: RoleId): FieldAgent => s.agents.find((a) => sim.responders[a.rid].role === role)!;
    expect(swimBonus(sim, by('ropeTech').rid)).toBe(0.3); expect(swimBonus(sim, by('rescueLead').rid)).toBe(0.15); expect(swimBonus(sim, by('nozzle').rid)).toBe(0.05);
    expect(swimBonus(sim, by('officer').rid)).toBe(0); expect(swimBonus(sim, by('paramedic').rid)).toBe(0);
    const before = [peek(sim.rng), peek(s.rng), ...s.agents.map((a) => peek(a.rng))];
    for (const a of s.agents) {
      const v = swimOf(sim, a);
      expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1);
      expect(swimOf(sim, a)).toBe(v);
      const r = sim.responders[a.rid];
      // 식: 0.15 + 0.45 × 체력 + 0.3 × 구조 능력 + 역할 보정 + 개인차(±0.15)
      const base = 0.15 + 0.45 * r.fitness + 0.3 * r.skills.rescue + swimBonus(sim, a.rid);
      expect(v).toBeGreaterThanOrEqual(clamp(base - 0.15, 0, 1) - 1e-9); expect(v).toBeLessThanOrEqual(clamp(base + 0.15, 0, 1) + 1e-9);
    }
    expect([peek(sim.rng), peek(s.rng), ...s.agents.map((a) => peek(a.rng))]).toEqual(before);
    // 체력이 오르면 수영 능력도 오른다
    const o = by('officer'), r = sim.responders[o.rid], f0 = r.fitness, v0 = swimOf(sim, o);
    r.fitness = Math.max(0, f0 - 0.4); const lo = swimOf(sim, o); r.fitness = f0;
    expect(lo).toBeLessThan(v0 + 1e-9);
  });
});

// ───────────────────────── 지형 ─────────────────────────
describe('R2 지형 계산 (생김새만 — 수난 현장)', () => {
  it('landComp: 다리로 이어진 두 물가는 같은 뭍 성분, 다리를 끊으면 다른 성분. 물·벽은 -1', () => {
    const { s } = sceneWith('R2-GEO', 'water', ['rescue']);
    const comp = landComp(s);
    expect(landComp(s), '생김새가 그대로면 같은 배열').toBe(comp);
    for (let i = 0; i < s.tiles.length; i++) expect(comp[i] >= 0, `칸 ${i}`).toBe(staticPass(s.tiles[i]));
    const south = comp[s.staging.y * s.w + s.staging.x], north = comp[0];
    expect(south).toBeGreaterThanOrEqual(0); expect(north).toBe(south);
    cutBridge(s);
    const c2 = landComp(s);
    expect(c2).not.toBe(comp);
    expect(c2[0]).not.toBe(c2[s.staging.y * s.w + s.staging.x]);
  });
  it('reachOf: 가장 가까운 뭍 칸과 거리, from 이 있으면 그 대원이 걸어서 닿는 쪽만. onWater 는 선 칸으로 본다', () => {
    const { s, of } = sceneWith('R2-GEO', 'water', ['rescue']);
    const a = of('rescue')[0];
    const x = 8, top = waterTop(s, x);
    // 강 윗줄 바로 아래 칸: 건너편(북쪽) 물가가 1칸, 이쪽(남쪽)은 4칸쯤
    const near = reachOf(s, x, top)!;
    expect(near.d).toBeCloseTo(1, 6); expect(near.y).toBe(top - 1);
    expect(reachOf(s, x, top, 4, a)!.d, '다리로 이어져 있으면 건너편도 닿는 쪽이다').toBeCloseTo(1, 6);
    cutBridge(s);
    const far = reachOf(s, x, top, 4, a)!;
    expect(far.y, '다리가 끊기면 대원 쪽 물가만').toBeGreaterThan(top);
    expect(far.d).toBeGreaterThan(3.6);
    expect(staticPass(s.tiles[far.y * s.w + far.x])).toBe(true);
    // 같은 입력 = 같은 값 (같은 거리면 칸 번호가 작은 쪽)
    expect(reachOf(s, x, top, 4, a)).toEqual(far);
    // 물 위의 대원: 그 대원에게 가장 가까운 뭍의 성분
    expect(onWater(s, a)).toBe(false);
    const ax = a.x, ay = a.y;
    a.x = x; a.y = top; expect(onWater(s, a)).toBe(true);
    expect(reachOf(s, x, top + 1, 4, a)!.y, '물 위에 선 대원은 가까운 쪽 물가(북쪽)의 성분').toBeLessThan(top);
    a.afloat = 'boat'; expect(onWater(s, a), '보트 위는 헤엄 중이 아니다').toBe(false); a.afloat = undefined;
    a.x = ax; a.y = ay;
    // 뭍이 하나도 없으면 null
    const blank = { ...s, tiles: new Uint8Array(s.tiles.length).fill(T.WATER), staticVersion: 999 } as Scene;
    expect(reachOf(blank, 5, 5)).toBeNull();
  });
  it('catchPoint: 같은 줄 하류 8칸 안에서 물이 뭍으로 끝나면 그 칸 (다리), 멀거나 뭍이 아니면 null', () => {
    const { s, of } = sceneWith('R2-GEO', 'water', ['rescue']);
    const a = of('rescue')[0];
    // 다리: 강을 가로지르는 열 (그 열에는 물이 없다)
    let bx = -1;
    for (let x = 1; x < s.w && bx < 0; x++) { const top = waterTop(s, x - 1); if (top >= 0 && s.tiles[(top + 2) * s.w + x] === T.TRAIL) bx = x; }
    expect(bx).toBeGreaterThan(8);
    const y = waterTop(s, bx - 1) + 2, x0 = bx - 3;
    expect(s.tiles[y * s.w + x0]).toBe(T.WATER); expect(s.tiles[y * s.w + bx]).toBe(T.TRAIL);
    // 다리 세 칸 위: 다리 칸이 기다릴 자리
    expect(catchPoint(s, x0, y, a)).toEqual({ x: bx, y, d: 3 });
    expect(catchPoint(s, x0, y), '대원을 주지 않으면 성분을 따지지 않는다').toEqual({ x: bx, y, d: 3 });
    expect(catchPoint(s, bx - 8, y, a)!.d).toBe(8);
    // 9칸 넘게 위에서는 없다
    expect(catchPoint(s, bx - 9, y, a)).toBeNull();
    // 다리를 끊으면 없다 (현장 끝까지 물이다)
    cutBridge(s);
    expect(catchPoint(s, x0, y, a)).toBeNull();
  });
  it('targetKey: 구조 대상 > 칸 > 용의자 > 소품 > 구역', () => {
    const none: MTarget = { cas: -1, prop: -1, hostile: -1, region: -1, tile: -1 };
    expect(targetKey('waterRescue', { ...none, cas: 3 })).toBe('waterRescue:c3');
    expect(targetKey('force', { ...none, tile: 412, prop: 7 })).toBe('force:t412');
    expect(targetKey('engage', { ...none, hostile: 1 })).toBe('engage:h1');
    expect(targetKey('mitigate', { ...none, prop: 7 })).toBe('mitigate:p7');
    expect(targetKey('search', { ...none, region: 2 })).toBe('search:r2');
    expect(targetKey('perimeter', none)).toBe('perimeter:-');
  });
});

// ───────────────────────── 고르기 ─────────────────────────
describe('R2 고르는 틀 (chooseMethod · methodFit) — 시험이 줄을 켜서 본다', () => {
  const setup = () => {
    const q = sceneWith('R2-PICK', 'water', ['rescue', 'patrol', 'boat', 'ladder', 'engine']);
    const c = q.s.casualties[0];
    return { ...q, c, tg: tgCas(c), rope: q.role('ropeTech'), cop: q.role('officer') };
  };
  it('표의 줄이 모두 꺼져 있으면(틀) 아무것도 고르지 않는다 (methodFit 0)', () => {
    const { sim, s, c, tg, rope } = setup();
    withRows({}, () => {
      for (const w of Object.keys(WORK_MODE) as WorkKind[]) expect(chooseMethod(sim, s, rope, w, tg, null, NO_SENSE), w).toBeNull();
      expect(methodFit(sim, s, rope, work(sim, s, 'waterRescue', { cas: c.id }))).toBe(0);
    });
  });
  it('점수 = pref × (1 − risk × 조심성), 높은 순서로, 같은 점수면 표의 순서. 장비가 없으면 후보가 아니다', () => {
    const { sim, s, tg, rope, cop } = setup();
    withRows({ ring: ON, rope: ON, improvise: ON, swim: ON }, () => {
      const p = chooseMethod(sim, s, rope, 'waterRescue', tg, null, NO_SENSE)!;
      // 로프 대원: 구명환·구명줄이 있다
      expect(p.cands.map((q) => q.m)).toEqual(['rope', 'ring', 'improvise', 'swim']);
      expect(p.m).toBe('rope'); expect(p.why).toBe('usual'); expect(p.missing).toBeUndefined();
      expect(p.cands[0].score).toBeCloseTo(0.85, 9); expect(p.cands[1].score).toBeCloseTo(0.84, 9);
      expect(p.cands[3].score).toBeCloseTo(0.45 * (1 - 0.3 * cautionOf(sim, rope)), 9);
      // 순찰 경관: 줄이 없다 → 즉석 부력물이 1등, 장비를 따지지 않은 1등은 구명줄 → 까닭 noGear, 빠진 장비 = 그 1등의 kits[0]
      const q = chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)!;
      expect(q.m).toBe('improvise'); expect(q.why).toBe('noGear'); expect(q.missing).toBe('rope');
      expect(q.cands.map((v) => v.m)).toEqual(['improvise', 'swim']);
    });
    // 더 좋은 방법(장대 0.92)이 장비 때문에 빠졌으면, 줄을 가진 대원의 평소 방법에도 까닭은 noGear 다 (평소 방법이라 알리지는 않는다)
    withRows({ rope: ON, pole: ON }, () => {
      expect(chooseMethod(sim, s, rope, 'waterRescue', tg, null, NO_SENSE)!).toMatchObject({ m: 'rope', why: 'noGear', missing: 'pole' });
      give(sim, rope.rid, 'pole');
      expect(chooseMethod(sim, s, rope, 'waterRescue', tg, null, NO_SENSE)!).toMatchObject({ m: 'pole', why: 'near' });
      strip(sim, rope.rid, 'pole');
    });
    // 같은 점수: 표에서 앞선 방법이 이긴다
    withRows({ ring: { ...ON, pref: 0.85 }, rope: ON }, () => { expect(chooseMethod(sim, s, rope, 'waterRescue', tg, null, NO_SENSE)!.cands.map((q) => q.m)).toEqual(['ring', 'rope']); });
    // 상황·사람 배율이 곱해진다, 점수가 0 이면 후보가 아니다
    withRows({ rope: { ...ON, situ: () => 0.5, skill: () => 1.2 }, ring: { ...ON, situ: () => 0 } }, () => {
      const p = chooseMethod(sim, s, rope, 'waterRescue', tg, null, NO_SENSE)!;
      expect(p.cands).toEqual([{ m: 'rope', score: 0.85 * 0.5 * 1.2 }]);
    });
  });
  it('대상을 아직 못 봤으면(믿음이 없다) 수난 구조·구출의 후보는 없다. 기록 전용 방법은 켜도 고르지 않는다', () => {
    const { sim, s, tg, rope } = setup();
    withRows({ rope: ON, manual: ON, hoist: ON, taser: ON, kick: ON }, () => {
      expect(chooseMethod(sim, s, rope, 'waterRescue', { ...tg, cas: 99 }, null, NO_SENSE)).toBeNull();
      expect(chooseMethod(sim, s, rope, 'extricate', { ...tg, cas: 99 }, null, NO_SENSE)).toBeNull();
      expect(chooseMethod(sim, s, rope, 'extricate', tg, null, NO_SENSE)!.m).toBe('manual');
      expect(chooseMethod(sim, s, rope, 'hoist', tg, null, NO_SENSE)).toBeNull();
      expect(chooseMethod(sim, s, rope, 'engage', { ...tg, cas: -1, hostile: 0 }, null, NO_SENSE)).toBeNull();
      expect(chooseMethod(sim, s, rope, 'force', { ...tg, cas: -1, tile: 100 }, null, NO_SENSE)!.m).toBe('kick');      // 믿음이 필요 없는 임무
      expect(chooseMethod(sim, s, rope, 'carry', tg, null, NO_SENSE)).toBeNull();      // 방법이 없는 임무
    });
  });
  it('장비 조건: 이 부대면 장비 없이도(altUnit), 이 부대여야(needUnit), 알려진 고장은 빠지고 숨은 고장은 모른다', () => {
    const { sim, s, tg, rope, of } = setup();
    withRows({ boat: ON, aerial: ON, interior: ON, rope: ON }, () => {
      const boatman = of('boat')[0];
      expect(chooseMethod(sim, s, boatman, 'waterRescue', tg, null, NO_SENSE)!.cands.map((q) => q.m), '구조정 대원은 고무보트 없이도 보트를 쓴다').toContain('boat');
      // 로프 대원은 단계 1a 부터 고무보트를 든다 — 빼면 보트를 못 쓰고, 다시 주면 쓴다
      expect(chooseMethod(sim, s, rope, 'waterRescue', tg, null, NO_SENSE)!.cands.map((q) => q.m)).toContain('boat');
      strip(sim, rope.rid, 'raft');
      expect(chooseMethod(sim, s, rope, 'waterRescue', tg, null, NO_SENSE)!.cands.map((q) => q.m)).not.toContain('boat');
      give(sim, rope.rid, 'raft');
      expect(chooseMethod(sim, s, rope, 'waterRescue', tg, null, NO_SENSE)!.cands.map((q) => q.m)).toContain('boat');
      const tgR: MTarget = { cas: -1, prop: -1, hostile: -1, region: 0, tile: -1 };
      const engNozzle = of('engine').find((a) => sim.responders[a.rid].role === 'nozzle')!, ladNozzle = of('ladder').find((a) => sim.responders[a.rid].role === 'nozzle')!;
      expect(chooseMethod(sim, s, engNozzle, 'suppress', tgR, null, NO_SENSE)!.cands.map((q) => q.m)).toEqual(['interior']);
      expect(chooseMethod(sim, s, ladNozzle, 'suppress', tgR, null, NO_SENSE)!.cands.map((q) => q.m)).toEqual(['interior', 'aerial']);
      // 사다리차가 아닌 대원은 고가 방수를 "장비가 없어서" 못 고르는 것이 아니다 — noGear 가 아니다
      expect(chooseMethod(sim, s, engNozzle, 'suppress', tgR, null, NO_SENSE)!.why).toBe('usual');
      // 고장
      const item = sim.responders[rope.rid].kit!.find((it) => it.id === 'rope')!;
      const w = work(sim, s, 'waterRescue', { cas: tg.cas });
      const fit0 = methodFit(sim, s, rope, w);
      item.fault = true; expect(methodFit(sim, s, rope, w), '숨은 고장은 배정에 새지 않는다').toBe(fit0);
      item.faultKnown = true; expect(chooseMethod(sim, s, rope, 'waterRescue', tg, null, NO_SENSE)!.cands.map((q) => q.m), '알려진 고장이면 구명줄은 빠진다 (고무보트만 남는다)').toEqual(['boat']);
      item.fault = false; item.faultKnown = false;
    });
  });
  it('까닭: 위중(weak)·빠른 물살(fast)·닿지 않는 거리(tooFar)·가까움(near)·동료와 짝(team)·위험(danger)', () => {
    const { sim, s, c, tg, rope, cop } = setup();
    const set = (a: FieldAgent, v: Partial<CasBelief>): void => { const f = casFact(sim, s, c, '시험'); a.beliefs.merge(mkFact('cas', c.id, { ...f.value, ...v }, '시험', sim.t + 1, 1, true, f.text)); };
    withRows({ swim: { ...ON, pref: 0.99, risk: 0 }, catch: ON, rope: ON }, () => {
      set(cop, { band: 2 });
      expect(chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)!.why, '줄을 잡을 힘이 없는 대상에게 헤엄').toBe('weak');
      set(cop, { band: 0 });
    });
    withRows({ catch: { ...ON, pref: 0.99 }, improvise: ON }, () => {
      set(cop, { band: 0, drift: 0.09 });
      expect(chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)!.why).toBe('fast');
      set(cop, { drift: 0.03 });
      expect(chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)!.why).toBe('usual');
    });
    withRows({ hand: ON }, () => { expect(chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)!.why).toBe('near'); });
    withRows({ tend: ON }, () => { expect(chooseMethod(sim, s, rope, 'waterRescue', tg, null, NO_SENSE)!.why).toBe('team'); });
    withRows({ rapid: { ...ON, risk: 0 }, manual: ON }, () => { expect(chooseMethod(sim, s, cop, 'extricate', tg, null, NO_SENSE)!).toMatchObject({ m: 'rapid', why: 'danger' }); });
    // 던져서 닿지 않는 거리: 다리를 끊고 건너편 물가 바로 아래에 있는 대상 (대원 쪽 물가에서 3.6칸 넘게)
    cutBridge(s);
    const x = 8, top = waterTop(s, x);
    set(cop, { x, y: top, drift: 0 });
    withRows({ swim: { ...ON, risk: 0 } }, () => { expect(chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)!.why).toBe('tooFar'); });
  });
  it('접은 방법: 이 임무에서 접은 것(t.tried)과 대원의 기억(a.mfail)은 다시 고르지 않는다. 다 접었으면 넓힌다 — 고장만은 끝까지', () => {
    const { sim, s, c, tg, rope } = setup();
    const w = work(sim, s, 'waterRescue', { cas: c.id });
    const t = taskFor(rope, w), key = targetKey('waterRescue', tg);
    withRows({ ring: ON, rope: ON }, () => {
      t.tried = ['rope'];
      expect(chooseMethod(sim, s, rope, 'waterRescue', tg, t, NO_SENSE)!.cands.map((q) => q.m)).toEqual(['ring']);
      t.tried = ['rope', 'ring'];
      expect(chooseMethod(sim, s, rope, 'waterRescue', tg, t, NO_SENSE)!.m, '① 다 써 봤으면 처음부터 다시').toBe('rope');
      t.tried = undefined;
      rope.mfail = [{ k: key, m: 'rope', until: sim.t + 60 }];
      expect(chooseMethod(sim, s, rope, 'waterRescue', tg, null, NO_SENSE)!.m).toBe('ring');
      expect(methodFit(sim, s, rope, w)).toBeCloseTo(0.84, 9);
      // 다른 대상의 기억은 상관없다
      rope.mfail = [{ k: 'waterRescue:c99', m: 'rope', until: sim.t + 60 }];
      expect(chooseMethod(sim, s, rope, 'waterRescue', tg, null, NO_SENSE)!.m).toBe('rope');
      // 시간이 지난 기억은 무시한다 (지우지는 않는다)
      rope.mfail = [{ k: key, m: 'rope', until: sim.t - 1 }];
      expect(chooseMethod(sim, s, rope, 'waterRescue', tg, null, NO_SENSE)!.m).toBe('rope'); expect(rope.mfail.length).toBe(1);
      // ② 모두 기억에 걸리면 고장이 아닌 기억을 무시한다
      rope.mfail = [{ k: key, m: 'rope', until: sim.t + 60 }, { k: key, m: 'ring', until: sim.t + 15 }];
      expect(chooseMethod(sim, s, rope, 'waterRescue', tg, null, NO_SENSE)!.m).toBe('rope');
      rope.mfail = [{ k: key, m: 'rope', until: Infinity }, { k: key, m: 'ring', until: sim.t + 15 }];
      expect(chooseMethod(sim, s, rope, 'waterRescue', tg, null, NO_SENSE)!.cands.map((q) => q.m), '고장 난 방법은 넓혀도 돌아오지 않는다').toEqual(['ring']);
      rope.mfail = [{ k: key, m: 'rope', until: Infinity }, { k: key, m: 'ring', until: Infinity }];
      expect(chooseMethod(sim, s, rope, 'waterRescue', tg, null, NO_SENSE)).toBeNull();      // ③
      expect(methodFit(sim, s, rope, w)).toBe(0);
      rope.mfail = undefined;
    });
  });
  it('걸을 수 있는 다친 대원은 위험한 방법(risk > 0)을 고르지 않는다', () => {
    const { sim, s, tg, cop } = setup();
    withRows({ swim: ON, improvise: ON }, () => {
      expect(chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)!.cands.map((q) => q.m).sort()).toEqual(['improvise', 'swim']);
      sim.responders[cop.rid].status = 'injured';
      expect(chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)!.cands.map((q) => q.m)).toEqual(['improvise']);
      sim.responders[cop.rid].status = 'ok';
    });
  });
  it('순수 함수다: 백 번 불러도 장비·난수 흐름·기억·임무·믿음·기록이 그대로이고 같은 답을 낸다', () => {
    const { sim, s, c, tg, rope, cop } = setup();
    const w = work(sim, s, 'waterRescue', { cas: c.id });
    const t = taskFor(rope, w);
    t.tried = ['ring']; rope.mfail = [{ k: targetKey('waterRescue', tg), m: 'improvise', until: sim.t - 5 }];
    const snap = (): string => JSON.stringify([
      sim.responders.map((r) => r.kit), peek(sim.rng), peek(s.rng), s.agents.map((a) => [peek(a.rng), a.mfail, a.mrng === undefined, a.beliefs.facts.size, a.x, a.y]),
      [t.method, t.mwhy, t.tried, t.mt0, t.mcands], sim.events.length, sim.logHash, w.fails, s.staticVersion, (s.board.length),
    ]);
    withRows({ ring: ON, rope: ON, improvise: ON, swim: ON }, () => {
      const before = snap();
      const first = [JSON.stringify(chooseMethod(sim, s, rope, 'waterRescue', tg, t, NO_SENSE)), JSON.stringify(chooseMethod(sim, s, cop, 'waterRescue', tg, null, { smoke: 0.4, heat: 0.1 })), methodFit(sim, s, rope, w), JSON.stringify(reachOf(s, c.x, c.y, 4, rope)), swimOf(sim, cop)];
      for (let k = 0; k < 100; k++) {
        expect(JSON.stringify(chooseMethod(sim, s, rope, 'waterRescue', tg, t, NO_SENSE))).toBe(first[0]);
        expect(JSON.stringify(chooseMethod(sim, s, cop, 'waterRescue', tg, null, { smoke: 0.4, heat: 0.1 }))).toBe(first[1]);
        expect(methodFit(sim, s, rope, w)).toBe(first[2]);
        expect(JSON.stringify(reachOf(s, c.x, c.y, 4, rope))).toBe(first[3]);
        expect(swimOf(sim, cop)).toBe(first[4]);
      }
      expect(snap()).toBe(before);
    });
  });
  it('methodFit 은 임무를 맡기 전(t = null, 감각 0)의 1등 점수다', () => {
    const { sim, s, c, tg, rope, cop } = setup();
    const w = work(sim, s, 'waterRescue', { cas: c.id });
    expect(targetOfWork(w)).toEqual(tg);
    withRows({ ring: ON, rope: ON, improvise: ON }, () => {
      expect(methodFit(sim, s, rope, w)).toBe(chooseMethod(sim, s, rope, 'waterRescue', tg, null, NO_SENSE)!.cands[0].score);
      expect(methodFit(sim, s, cop, w)).toBe(0.5);
      expect(methodFit(sim, s, cop, work(sim, s, 'carry', { cas: c.id }))).toBe(0);
    });
  });
});

// ───────────────────────── 실행부의 공통 함수 ─────────────────────────
describe('R2 실행부의 공통 함수 (methodRun.ts) — 시험이 줄을 켜서 본다', () => {
  const setup = () => {
    const q = sceneWith('R2-RUN', 'water', ['rescue', 'patrol', 'engine']);
    const c = q.s.casualties[0];
    return { ...q, c, tg: tgCas(c), rope: q.role('ropeTech'), cop: q.role('officer'), lead: q.role('patrolLead') };
  };
  it('mrng: 대원마다 method:<사건>:<rid>:<k> 흐름. 부모 흐름을 소비하지 않고, 처음 쓸 때 만든다', () => {
    const { sim, s, rope, cop } = setup();
    const p0 = [peek(sim.rng), peek(s.rng), peek(rope.rng)];
    expect(rope.mrng).toBeUndefined();
    const r = mrng(sim, s, rope);
    expect(mrng(sim, s, rope)).toBe(r);
    expect(peek(r)).toBe(sim.rng.fork(`method:${s.incidentId}:${rope.rid}:0`).next());
    expect(peek(mrng(sim, s, cop))).not.toBe(peek(r));
    expect([peek(sim.rng), peek(s.rng), peek(rope.rng)]).toEqual(p0);
    // 같은 대원이 같은 현장에 다시 들어오면 다음 순번이다
    const again = { ...rope, mrng: undefined } as FieldAgent;
    s.agents.push(again);
    expect(peek(mrng(sim, s, again))).toBe(sim.rng.fork(`method:${s.incidentId}:${rope.rid}:1`).next());
    s.agents.pop();
  });
  it('senseOf 는 대원이 선 칸의 연기와 열이다. targetOf 는 임무의 대상이다', () => {
    const { sim, s, c, rope } = setup();
    const i = Math.round(rope.y) * s.w + Math.round(rope.x);
    s.smoke[i] = 0.4; s.fire[i] = 0.2;
    expect(senseOf(s, rope).smoke).toBeCloseTo(0.4, 6); expect(senseOf(s, rope).heat).toBeCloseTo(0.2, 6);
    s.smoke[i] = 0; s.fire[i] = 0;
    expect(targetOf(taskFor(rope, work(sim, s, 'waterRescue', { cas: c.id })))).toEqual(tgCas(c));
  });
  it('startMethod: 방법·까닭·후보·시작 시각을 임무에 적는다. 평소 방법은 알리지 않고, 그 밖은 까닭과 함께 알린다. 고를 것이 없으면 수난 구조는 false, 선택 임무는 true', () => {
    const { sim, I, s, c, tg, rope, cop } = setup();
    sim.t = 100;
    withRows({ rope: ON, improvise: ON, swim: ON }, () => {
      const t = taskFor(rope, work(sim, s, 'waterRescue', { cas: c.id }));
      let n = sim.events.length;
      expect(startMethod(sim, s, I, rope, t, 'waterRescue', tg)).toBe(true);
      expect(t).toMatchObject({ method: 'rope', mwhy: 'usual', mt0: 100, mtry: 0, mbad: 0 });
      expect(t.mcands!.map((q) => q.m)).toEqual(['rope', 'improvise', 'swim']);
      expect(texts(sim, n), '평소 방법은 시작을 알리지 않는다').toEqual([]);
      const t2 = taskFor(cop, work(sim, s, 'waterRescue', { cas: c.id }));
      n = sim.events.length;
      expect(startMethod(sim, s, I, cop, t2, 'waterRescue', tg)).toBe(true);
      expect(t2).toMatchObject({ method: 'improvise', mwhy: 'noGear', missing: 'rope' });
      expect(texts(sim, n)).toEqual(['구조 로프가 없습니다. 옷을 이어 던지겠습니다.']);
      const ev = sim.events[sim.events.length - 1];
      expect(ev).toMatchObject({ role: 'RESPONDER', kind: 'action', importance: 1, rid: cop.rid, incidentId: I.id, actor: sim.responders[cop.rid].name });
      expect(I.methods, '시작은 방법 기록이 아니다').toBeUndefined();
    });
    // 고를 것이 없다 (모든 줄이 꺼져 있다)
    withRows({}, () => {
      const t3 = taskFor(rope, work(sim, s, 'waterRescue', { cas: c.id }));
      expect(startMethod(sim, s, I, rope, t3, 'waterRescue', tg), '수난 구조: 맡지 않는다').toBe(false);
      expect(t3.method).toBeUndefined(); expect(t3.mt0).toBe(100);
      const t4 = taskFor(rope, work(sim, s, 'suppress', { region: 0 }));
      expect(startMethod(sim, s, I, rope, t4, 'suppress', targetOf(t4)), '선택 임무: 방법 없이 지금 코드로').toBe(true);
      expect(t4.method).toBeUndefined(); expect(t4.mt0).toBe(100);
      // 시간이 지난 접은 기억은 이때 지운다
      rope.mfail = [{ k: 'x', m: 'rope', until: 50 }, { k: 'y', m: 'ring', until: 500 }];
      startMethod(sim, s, I, rope, t4, 'suppress', targetOf(t4));
      expect(rope.mfail).toEqual([{ k: 'y', m: 'ring', until: 500 }]);
    });
  });
  it('switchMethod(failed) → 문제 기록·접은 줄·기억·작업의 실패 횟수, 되풀이되면 횟수만. 다른 대원의 평소 방법도 알리고, 성공하면 그 문제가 복구된다', () => {
    const { sim, I, s, c, tg, rope, cop } = setup();
    const key = targetKey('waterRescue', tg);
    withRows({ rope: ON, improvise: ON, swim: ON }, () => {
      const w = work(sim, s, 'waterRescue', { cas: c.id });
      const t = taskFor(cop, w);
      sim.t = 200; startMethod(sim, s, I, cop, t, 'waterRescue', tg);
      sim.t = 212;
      let n = sim.events.length;
      t.phase = 2; t.progress = 3; cop.path = [1, 2, 3];
      expect(switchMethod(sim, s, I, cop, t, 'failed', '즉석 부력물 투척이 두 차례 빗나감')).toBe(true);
      expect(t).toMatchObject({ method: 'swim', mwhy: 'failed', mt0: 212, phase: 0, progress: 0, mtry: 0, mbad: 0 });
      expect(t.missing).toBeUndefined(); expect(cop.path).toBeNull();
      expect(t.tried).toEqual(['improvise']);
      expect(cop.mfail).toEqual([{ k: key, m: 'improvise', until: 212 + FAIL_KEEP.failed }]);
      expect(w.fails).toBe(1); expect(w.holdUntil).toBe(0);
      expect(texts(sim, n)).toEqual(['즉석 부력물 투척이 두 차례 빗나감. 헤엄쳐 들어가겠습니다.']);
      const p = I.problems.filter((q) => q.code === 'METHOD_FAIL');
      expect(p.length).toBe(1); expect(p[0]).toMatchObject({ detail: '즉석 부력물 투척이 두 차례 빗나감', recovered: false, eventId: sim.events.length - 1 });
      expect(p[0].times).toBeUndefined();
      expect(I.methods).toEqual([{ t0: 200, t: 212, rid: cop.rid, unitId: cop.unitId, work: 'waterRescue', method: 'improvise', why: 'noGear', ok: false, cas: c.id, prop: -1, hostile: -1, region: -1, tile: -1, missing: 'rope', eventId: p[0].eventId }]);
      // 같은 대상에서 또 실패: 새 문제를 만들지 않고 횟수를 올린다. 다 접었으므로 접은 기억을 무시하고 처음부터 다시 고른다
      sim.t = 230; n = sim.events.length;
      expect(switchMethod(sim, s, I, cop, t, 'failed', '헤엄 구조 중 허우적대는 대상에게 붙잡힘', true, { say: '허우적대는 대상에게 붙잡혀 함께 가라앉을 뻔했습니다.' })).toBe(true);
      expect(I.problems.filter((q) => q.code === 'METHOD_FAIL').length).toBe(1); expect(p[0].times).toBe(2);
      expect(t.method).toBe('improvise'); expect(t.tried, '다 써 봤으면 비운다').toEqual([]);
      expect(texts(sim, n)).toEqual(['허우적대는 대상에게 붙잡혀 함께 가라앉을 뻔했습니다. 옷을 이어 던지겠습니다.']);
      expect(sim.events[sim.events.length - 1].causes).toEqual([p[0].eventId]);
      expect(w.fails).toBe(2); expect(I.methods!.length).toBe(2); expect(I.methods![1]).toMatchObject({ method: 'swim', why: 'failed', ok: false, eventId: p[0].eventId, t0: 212, t: 230 });
      expect(methodFailLine(p)).toBe('대응 방법이 2차례 막혔습니다 (즉석 부력물 투척이 두 차례 빗나감).');
      // 다른 대원이 평소 방법(구명줄)을 고른다: 아직 복구되지 않은 실패가 있으므로 알린다
      const t2 = taskFor(rope, w);
      sim.t = 240; n = sim.events.length;
      startMethod(sim, s, I, rope, t2, 'waterRescue', tg);
      expect(t2.method).toBe('rope'); expect(texts(sim, n)).toEqual(['구명줄을 던지겠습니다.']);
      // 성공: 그 문제가 직접 복구된다
      sim.t = 250;
      const ev = sim.events.length - 1;
      recordMethod(sim, I, rope, t2, 'rope', t2.mwhy!, true, ev);
      expect(p[0].recovered).toBe(true); expect(p[0].recoveryText).toBe(`${sim.responders[rope.rid].name}${/[가-힣]$/.test(sim.responders[rope.rid].name) && (sim.responders[rope.rid].name.charCodeAt(sim.responders[rope.rid].name.length - 1) - 0xac00) % 28 ? '이' : '가'} 구명줄로 다시 시도해 성공`);
      expect(I.methods![2]).toMatchObject({ method: 'rope', why: 'usual', ok: true, t0: 240, t: 250, rid: rope.rid, eventId: ev });
      expect(methodFailLine(p)).toBe(`대응 방법이 2차례 막혔습니다 (즉석 부력물 투척이 두 차례 빗나감) — ${p[0].recoveryText}.`);
      // 복구된 뒤에는 평소 방법이 다시 조용하다
      n = sim.events.length;
      startMethod(sim, s, I, rope, taskFor(rope, w), 'waterRescue', tg);
      expect(texts(sim, n)).toEqual([]);
    });
  });
  it('switchMethod(broken): 문제를 다시 만들지 않고 장비 고장 기록을 가리킨다. 고장의 기억은 끝까지. 성공하면 그 장비 고장만 복구된다 (다른 장비 고장은 그대로)', () => {
    const { sim, I, s, role } = setup();
    const ex = role('extricator'), name = sim.responders[ex.rid].name;
    const pump = raiseProblem(sim, I, 'EQUIP_FAIL', '구조1 펌프 고장', { role: 'RESPONDER', actor: name, rid: ex.rid, text: '펌프 압력 저하!' }, false);
    const tile = 123;
    withRows({ hydraulic: ON, kick: ON }, () => {
      const t = makeTask('force', '문 강제 개방'); t.tile = tile; t.prop = 4; ex.task = makeTask('search', '수색'); ex.task.sub = t;      // 이동 중 하위 작업 (작업 항목이 없다)
      sim.t = 300; startMethod(sim, s, I, ex, t, 'force', targetOf(t));
      expect(t.method).toBe('hydraulic');
      sim.responders[ex.rid].kit!.find((it) => it.id === 'spreader')!.fault = true;
      expect(kitWorks(sim, ex.rid, 'spreader', I)).toBe(false);      // 숨은 고장이 드러난다 (EQUIP_FAIL)
      const broke = I.problems[I.problems.length - 1];
      expect(broke.code).toBe('EQUIP_FAIL'); expect(broke.eventId).not.toBe(pump);
      const n = sim.events.length, problems = I.problems.length;
      sim.t = 301;
      expect(switchMethod(sim, s, I, ex, t, 'broken', '유압 구조기 고장')).toBe(true);
      expect(I.problems.length, '문제를 다시 만들지 않는다').toBe(problems);
      expect(texts(sim, n)).toEqual(['장비 없이 문을 걷어차 열겠습니다.']);
      expect(t).toMatchObject({ method: 'kick', mwhy: 'broken' });
      expect(ex.mfail).toEqual([{ k: 'force:t' + tile, m: 'hydraulic', until: Infinity }]);
      expect(I.methods![0]).toMatchObject({ method: 'hydraulic', ok: false, tile, prop: 4, work: 'force', eventId: broke.eventId });
      sim.t = 312;
      recordMethod(sim, I, ex, t, 'kick', 'broken', true, sim.events.length - 1);
      expect(broke.recovered).toBe(true); expect(broke.recoveryText).toContain('발로 차 다시 시도해 성공');
      expect(I.problems.find((q) => q.eventId === pump)!.recovered, '펌프 고장은 닫지 않는다').toBe(false);
      // 고장 난 방법은 같은 문에서 다시 고르지 않는다
      const again = makeTask('force', '문 강제 개방'); again.tile = tile; again.prop = 4;
      expect(chooseMethod(sim, s, ex, 'force', targetOf(again), again, NO_SENSE)!.cands.map((q) => q.m)).toEqual(['kick']);
    });
  });
  it('switchMethod(조건 상실·다음 방법 없음): tooFar·team 은 문제가 아니다. 다음이 없으면 선택 임무는 방법을 비우고 이어 가고, 수난 구조는 끝낸다(도구를 받았을 때)', () => {
    const { sim, I, s, c, tg, rope } = setup();
    withRows({ rope: ON, ring: ON }, () => {
      const w = work(sim, s, 'waterRescue', { cas: c.id });
      const t = taskFor(rope, w);
      sim.t = 400; startMethod(sim, s, I, rope, t, 'waterRescue', tg);
      let n = sim.events.length;
      const problems = I.problems.length;
      sim.t = 405;
      expect(switchMethod(sim, s, I, rope, t, 'tooFar', '대상이 떠내려가 줄이 닿지 않음')).toBe(true);
      expect(I.problems.length).toBe(problems); expect(w.fails, '조건 상실은 실패 횟수에 넣지 않는다').toBe(0);
      expect(texts(sim, n)).toEqual(['대상이 떠내려가 줄이 닿지 않음. 구명환을 던지겠습니다.']);
      expect(t).toMatchObject({ method: 'ring', mwhy: 'tooFar' });
      expect(rope.mfail![0]).toEqual({ k: targetKey('waterRescue', tg), m: 'rope', until: 405 + FAIL_KEEP.tooFar });
      expect(I.methods![0]).toMatchObject({ method: 'rope', why: 'usual', ok: false, eventId: sim.events.length - 1 });
      // next = false: 부른 쪽이 정한다 — 방법은 그대로 둔다
      n = sim.events.length;
      expect(switchMethod(sim, s, I, rope, t, 'team', '동료가 헤엄쳐 들어감', false)).toBe(false);
      expect(t.method).toBe('ring'); expect(texts(sim, n)).toEqual(['동료가 헤엄쳐 들어감.']);
    });
    // 다음 방법이 없다 (줄이 모두 꺼져 있다)
    withRows({}, () => {
      const finished: string[] = [];
      const k = { ...XK, finish: (_sim: Sim, _s: Scene, _a: FieldAgent, ok: boolean, reason?: string) => { finished.push(`${ok}:${reason}`); } };
      const t = taskFor(rope, work(sim, s, 'waterRescue', { cas: c.id }));
      t.method = 'rope'; t.mwhy = 'usual'; t.mt0 = sim.t;
      expect(switchMethod(sim, s, I, rope, t, 'failed', '구명줄 투척이 두 차례 빗나감', true, { k })).toBe(false);
      expect(finished).toEqual(['false:nomethod']);
      const t2 = taskFor(rope, work(sim, s, 'engage', { hostile: 0 }));
      t2.method = 'beanbag'; t2.mwhy = 'usual'; t2.mt0 = sim.t;
      const w2 = s.board[t2.workId];
      expect(switchMethod(sim, s, I, rope, t2, 'failed', '비살상탄이 빗나감', true, { k })).toBe(false);
      expect(finished.length, '선택 임무는 끝내지 않는다').toBe(1);
      expect(t2.method).toBeUndefined(); expect(w2.fails, '선택 임무는 작업의 실패 횟수에 넣지 않는다').toBe(0);
      // 접을 방법이 없으면 아무 일도 없다
      const n = sim.events.length;
      expect(switchMethod(sim, s, I, rope, t2, 'failed', 'x')).toBe(false); expect(sim.events.length).toBe(n);
    });
  });
  it('recheckOnArrive: 작업 자리에서 한 번, 감각으로 다시 고른다 — 예정된 전환이라 접은 줄도 기억도 남기지 않는다', () => {
    const { sim, I, s, c, tg, cop } = setup();
    withRows({ manual: ON, rapid: { can: (x: { sense: { smoke: number } }) => x.sense.smoke > 0.3, risk: 0 } as Partial<MethodDef> }, () => {
      const t = taskFor(cop, work(sim, s, 'extricate', { cas: c.id }));
      sim.t = 500; startMethod(sim, s, I, cop, t, 'extricate', tg);
      expect(t.method).toBe('manual');
      const i = Math.round(cop.y) * s.w + Math.round(cop.x);
      s.smoke[i] = 0.5;
      sim.t = 507;
      const n = sim.events.length;
      recheckOnArrive(sim, s, I, cop, t, 'extricate', tg);
      expect(t).toMatchObject({ method: 'rapid', mwhy: 'danger', marr: true, mt0: 507 });
      expect(texts(sim, n)).toEqual(['추가 위험이 있습니다. 급박 구출합니다. 바로 끌어내겠습니다.']);
      expect(I.methods).toBeUndefined(); expect(t.tried).toBeUndefined(); expect(cop.mfail).toBeUndefined();
      // 한 번뿐이다
      s.smoke[i] = 0;
      recheckOnArrive(sim, s, I, cop, t, 'extricate', tg);
      expect(t.method).toBe('rapid');
      // 이미 진행 중이면 고르지 않는다
      const t2 = taskFor(cop, work(sim, s, 'extricate', { cas: c.id }));
      startMethod(sim, s, I, cop, t2, 'extricate', tg); t2.progress = 1; s.smoke[i] = 0.5;
      recheckOnArrive(sim, s, I, cop, t2, 'extricate', tg);
      expect(t2.method).toBe('manual'); expect(t2.marr).toBe(true);
      s.smoke[i] = 0;
    });
  });
  it('탐지 방법은 한 대원이 한 사건에서 처음 고를 때만 알린다', () => {
    const { sim, I, s, role } = setup();
    const lead = role('rescueLead');
    withRows({ listen: ON, call: ON }, () => {
      let n = sim.events.length;
      const t = taskFor(lead, work(sim, s, 'search', { region: 0 }));
      startMethod(sim, s, I, lead, t, 'search', targetOf(t));
      expect(t.method).toBe('listen'); expect(texts(sim, n)).toEqual(['청음 장비로 탐지하겠습니다.']);
      n = sim.events.length;
      const t2 = taskFor(lead, work(sim, s, 'search', { region: 1 }));
      startMethod(sim, s, I, lead, t2, 'search', targetOf(t2));
      expect(t2.method).toBe('listen'); expect(texts(sim, n)).toEqual([]);
      expect(lead.msaid).toEqual(['listen']);
    });
  });
  it('recordAir: 호이스트로 건진 사람에 방법을 적고, 지상의 수난 구조가 막혀 있던 대상이면 그 문제도 닫는다', () => {
    const { sim, I, s, c, tg, cop } = setup();
    const heli = sim.units.find((u) => u.kind === 'heli')!;
    withRows({ improvise: ON }, () => {
      const t = taskFor(cop, work(sim, s, 'waterRescue', { cas: c.id }));
      sim.t = 600; startMethod(sim, s, I, cop, t, 'waterRescue', tg);
      switchMethod(sim, s, I, cop, t, 'failed', '즉석 부력물 투척이 두 차례 빗나감', false);
    });
    const p = I.problems.find((q) => q.code === 'METHOD_FAIL')!;
    sim.t = 640;
    recordAir(sim, I, heli, c, 77, 618);
    expect(c.freedHow).toBe('hoist'); expect(c.freedBy).toBe(heli.crew[0]);
    expect(I.methods![I.methods!.length - 1]).toEqual({ t0: 618, t: 640, rid: heli.crew[0], unitId: heli.id, work: 'hoist', method: 'hoist', why: 'usual', ok: true, cas: c.id, prop: -1, hostile: -1, region: -1, tile: -1, missing: undefined, eventId: 77 });
    expect(p.recovered).toBe(true); expect(p.recoveryText).toContain(heli.callsign); expect(p.recoveryText).toContain('호이스트로 끌어올려 다시 시도해 성공');
    // 그 대상은 문제 문장이 말하므로 방법 문장에는 넣지 않는다
    expect(methodLines(sim, I, s)).toEqual([]);
  });
});

// ───────────────────────── 보고서 ─────────────────────────
describe('R2 보고서: 방법 문장과 집계 (기록된 I.methods 와 문제에서만)', () => {
  it('문제 이름표와 문장 틀이 있고, 측정 도구가 그 코드를 안다 (tests/causality.test.ts 가 PROBLEM_SYS 를 본다)', () => {
    expect(PROBLEM_LABEL.METHOD_FAIL).toBe('대응 방법 실패·변경');
    expect(methodFailLine([{ code: 'METHOD_FAIL', t: 0, eventId: 1, detail: '가', recovered: false, recoveryText: '', times: 3 }, { code: 'METHOD_FAIL', t: 0, eventId: 2, detail: '나', recovered: false, recoveryText: '' }])).toBe('대응 방법이 4차례 막혔습니다 (가).');
    expect(Object.keys(WORK_DONE).sort()).toEqual(['arrest', 'clear', 'engage', 'extricate', 'force', 'hoist', 'load', 'mitigate', 'perimeter', 'search', 'suppress', 'treat']);
  });
  it('평소와 다른 방법으로 끝낸 것만, 최대 2문장. 까닭 말은 괄호로. 판정의 분석 문장과 교대 요약에 실린다', () => {
    const { sim, I, s, role } = sceneWith('R2-REP', 'water', ['rescue', 'patrol', 'engine']);
    const cop = role('officer'), rope = role('ropeTech'), cs = s.casualties, heli = sim.units.find((u) => u.kind === 'heli')!;
    while (cs.length < 3) { const c0 = cs[0]; cs.push({ ...c0, id: cs.length, label: String.fromCharCode(65 + cs.length) }); }
    const rec = (a: FieldAgent, c: Casualty, m: MethodId, why: 'usual' | 'noGear' | 'weak', missing?: KitId): void => {
      const t = taskFor(a, work(sim, s, 'waterRescue', { cas: c.id })); t.mt0 = sim.t - 20; t.missing = missing;
      recordMethod(sim, I, a, t, m, why, true, -1);
    };
    sim.t = 300;
    expect(methodLines(sim, I, s)).toEqual([]); expect(methodTally(sim)).toEqual({}); expect(methodSummary({})).toBeNull();
    rec(rope, cs[0], 'rope', 'usual');                    // 평소 방법 — 문장에 넣지 않는다
    rec(cop, cs[1], 'swim', 'noGear', 'rope');
    recordAir(sim, I, heli, cs[2], -1, 280);
    rec(cop, cs[0], 'boat', 'weak');                      // 셋째 — 최대 2문장이라 빠진다
    const name = sim.responders[cop.rid].name;
    expect(methodLines(sim, I, s)).toEqual([
      `구조 대상 B는 ${name} 대원이 헤엄쳐 들어가 구했습니다 (구조 로프가 없었음).`,
      `구조 대상 C는 ${heli.callsign}${(heli.callsign.charCodeAt(heli.callsign.length - 1) - 0xac00) % 28 ? '이' : '가'} 호이스트로 끌어올려 구했습니다.`,
    ]);
    expect(methodLines(sim, I, s, 3).length).toBe(3);
    expect(methodLines(sim, I, s, 3)[2]).toBe(`구조 대상 A는 ${name} 대원이 보트로 다가가 구했습니다 (줄을 잡을 힘이 없었음).`);
    // 그 밖의 임무: "○○ 대원이 <noun> <맺음말>"
    const t = makeTask('force', '문'); t.tile = 50; t.prop = 2; t.mt0 = sim.t;
    const other: Incident = { ...I, methods: undefined, problems: [] };
    recordMethod(sim, other, cop, t, 'charge', 'usual', true, -1);
    expect(methodLines(sim, other, s)).toEqual([`${name} 대원이 폭파 장약으로 문을 열었습니다.`]);
    expect(whyText({ ...other.methods![0], why: 'noGear', missing: undefined })).toBe('');
    // 집계: 성공한 방법별 횟수(평소 방법 포함, 표의 순서), 요약 줄은 평소 방법을 뺀다
    expect(methodTally(sim)).toEqual({ rope: 1, swim: 1, boat: 1, hoist: 1 });
    expect(Object.keys(methodTally(sim))).toEqual(['rope', 'swim', 'boat', 'hoist']);
    expect(methodSummary(methodTally(sim))).toBe('대응 방법: 헤엄 1 · 보트 1 · 호이스트 1.');
    expect(methodSummary({ rope: 5, hand: 2 })).toBeNull();
    // 판정과 교대 보고서에 실린다
    const res = evaluate(sim, I, 'resolved');
    expect(res.analysis.filter((l) => l.includes('구했습니다')).length).toBe(2);
    expect(res.analysis.some((l) => l.includes('헤엄쳐 들어가'))).toBe(true);
    const rep = buildReport(sim);
    expect(rep.methods).toEqual({ rope: 1, swim: 1, boat: 1, hoist: 1 });
    expect(rep.summary.filter((l) => l.startsWith('대응 방법:'))).toEqual(['대응 방법: 헤엄 1 · 보트 1 · 호이스트 1.']);
  });
  it('METHOD_FAIL 문장은 장비 고장 문장 바로 다음 자리에 온다', () => {
    const { sim, I, s, role } = sceneWith('R2-REP2', 'water', ['rescue', 'patrol']);
    const cop = role('officer');
    I.reportedAt = 0; I.firstDispatchAt = 5; I.firstArrivalAt = 40;
    raiseProblem(sim, I, 'WATER_OUT', '진압1 탱크 용수 소진', { role: 'RESPONDER', actor: 'x', text: 'x' }, false);
    raiseProblem(sim, I, 'METHOD_FAIL', '구명줄 투척이 두 차례 빗나감', { role: 'RESPONDER', actor: sim.responders[cop.rid].name, rid: cop.rid, text: 'x' }, false);
    raiseProblem(sim, I, 'EQUIP_FAIL', '진압1 펌프 고장', { role: 'RESPONDER', actor: 'x', text: 'x' }, false);
    const A = evaluate(sim, I, 'resolved').analysis;
    const at = (re: RegExp): number => A.findIndex((l) => re.test(l));
    expect(at(/펌프 고장/)).toBeGreaterThanOrEqual(0);
    expect(at(/대응 방법이 1차례 막혔습니다 \(구명줄 투척이 두 차례 빗나감\)\./)).toBe(at(/펌프 고장/) + 1);
    expect(at(/용수 소진/)).toBe(at(/대응 방법이/) + 1);
    // 판정을 다시 해도 자리가 겹치지 않는다 (order 에 한 번만 끼운다)
    expect(evaluate(sim, I, 'resolved').analysis.filter((l) => l.startsWith('대응 방법이')).length).toBe(1);
  });
});

// ───────────────────────── 화면 ─────────────────────────
describe('R2 대원 정보창의 대응 방법 두 줄 (MethodRows)', () => {
  it('방법이 없으면 아무것도 그리지 않는다. 있으면 방법 — 까닭, 후보의 점수 막대', () => {
    const { sim, s, role } = sceneWith('R2-UI', 'water', ['rescue', 'patrol']);
    const cop = role('officer');
    const html = (): string => renderToStaticMarkup(createElement(MethodRows, { agent: cop }));
    cop.task = null; expect(html()).toBe('');
    cop.task = makeTask('waterRescue', '수난 구조', work(sim, s, 'waterRescue', { cas: 0 })); expect(html()).toBe('');
    cop.task.method = 'swim'; cop.task.mwhy = 'noGear'; cop.task.missing = 'rope'; cop.task.mcands = [{ m: 'swim', score: 0.38 }, { m: 'improvise', score: 0.27 }];
    const out = html();
    expect(out).toContain('대응 방법'); expect(out).toContain('헤엄쳐 접근 — 구조 로프 없음'); expect(out).toContain('방법 후보');
    expect(out).toContain('0.38'); expect(out).toContain('즉석 부력물'); expect(out.match(/class="cand/g)!.length).toBe(2); expect(out.match(/cand chosen/g)!.length).toBe(1);
    // 문·잔해 하위 작업 중이면 그 하위 작업의 방법
    const sub = makeTask('force', '문 강제 개방'); sub.method = 'kick'; sub.mwhy = 'broken';
    cop.task = makeTask('search', '수색'); cop.task.sub = sub;
    expect(html()).toContain('발로 차기·어깨 — 장비 고장');
  });
});

// ───────────────────────── 세계 규칙 · 결과 불변 ─────────────────────────
describe('R2 세계 규칙 (단계 0: 물살과 안벽 표시만)', () => {
  it('물이 있는 현장에서만: 안벽 표시는 처음 한 번, 물살은 떠내려가는 속도의 최댓값을 따라 오르고 내려가지 않는다. 기록·난수 없음', () => {
    const { sim, I, s } = sceneWith('R2-RULE', 'water', []);
    const c = s.casualties[0];
    expect(s.flow).toBeUndefined(); expect(s.quay).toBeUndefined();
    const before = [sim.events.length, sim.logHash, peek(sim.rng), peek(s.rng)];
    const run = (n: number): void => { for (let k = 0; k < n; k++) { sim.tick++; sim.t = sim.tick * sim.dt; methodsRule(sim, s, I); } };
    run(1); expect(s.quay).toBe(false);
    run(6);
    const d0 = Math.max(FLOW_MIN, ...s.casualties.map((q) => q.drift ?? 0));
    expect(s.flow).toBe(d0);
    c.drift = 0.09; run(5); expect(s.flow).toBe(0.09);
    c.drift = 0; run(10); expect(s.flow, '걸려 멈춰도 강물은 흐른다').toBe(0.09);
    expect([sim.events.length, sim.logHash, peek(sim.rng), peek(s.rng)]).toEqual(before);
    // 선박 화재의 부두는 안벽이다. 물이 없는 현장은 건드리지 않는다
    const ship = sceneWith('R2-RULE', 'fire/ship', []);
    methodsRule(ship.sim, ship.s, ship.I); expect(ship.s.quay).toBe(true);
    const fire = sceneWith('R2-RULE', 'fire', []);
    for (let k = 0; k < 6; k++) { fire.sim.tick++; methodsRule(fire.sim, fire.s, fire.I); }
    expect(fire.s.quay).toBeUndefined(); expect(fire.s.flow).toBeUndefined();
    expect(SCENE_RULES.indexOf(methodsRule), '세계 규칙의 맨 끝에 등록한다').toBe(SCENE_RULES.length - 1);
  });
  it('새 칸은 만들 때부터 있다 (객체 모양이 갈라지지 않는다)', () => {
    const { sim, I, s } = sceneWith('R2-SHAPE', 'armed/hostage', ['patrol']);
    const keys = (o: object): string[] => Object.keys(o);
    for (const k of ['method', 'mwhy', 'missing', 'tried', 'entryDoor', 'mtry', 'mbad', 'mt0', 'marr', 'mcands']) expect(keys(makeTask('standby', 'x')), k).toContain(k);
    for (const k of ['afloat', 'mrng', 'mfail', 'msaid', 'wetSince', 'wetTired']) expect(keys(s.agents[0]), k).toContain(k);
    for (const k of ['freedHow', 'freedBy', 'rush']) expect(keys(s.casualties[0]), k).toContain(k);
    expect(keys(s.hostiles[0])).toContain('stunHow');
    for (const k of ['flow', 'quay', 'fan']) expect(keys(s), k).toContain(k);
    expect(keys(I)).toContain('methods');
    raiseProblem(sim, I, 'METHOD_FAIL', 'x', { role: 'SYSTEM', actor: '현장', text: 'x' }, false);
    expect(keys(I.problems[I.problems.length - 1])).toContain('times');
  });
});

// ───────────────────────── 단계 1a: 수난 구조 — 물가 방법 (§4.1, §8 의 2·3·4·5·6·7·8·9 가운데 1a 의 몫) ─────────────────────────
/** 수난 강제 교대. strip 이면 시작 전에(교대 중에 오는 지원 부대도 오는 대로) 모든 대원의 구명줄·구명환·장대를 알려진 고장으로 둔다 */
function waterShift(seed: string, strip = false, diff: Difficulty = NORMAL, len = 1200): Sim {
  const sim = new Sim(seed, diff, len, { force: 'water/std' });
  if (!strip) { sim.runToEnd(); return sim; }
  const gone = (): void => { for (const r of sim.responders) for (const it of r.kit ?? []) if (it.id === 'rope' || it.id === 'ring' || it.id === 'pole') { it.fault = true; it.faultKnown = true; } };
  gone();
  let n = sim.responders.length, k = 0;
  while (!sim.ended && k++ < 20000) { sim.step(); if (sim.responders.length !== n) { gone(); n = sim.responders.length; } }
  return sim;
}
const memo = <V>(f: () => V): (() => V) => { let v: V | undefined; return () => (v ??= f()); };
const W20 = memo(() => Array.from({ length: 20 }, (_, i) => waterShift('W' + i)));
const STRIPPED = memo(() => Array.from({ length: 6 }, (_, i) => waterShift('W' + i, true)));
/** 선박 화재 강제 (tests/major.test.ts 의 spawn 과 같은 방식 — 시드 MA~MD) */
const SHIPS = memo(() => ['MA', 'MB', 'MC', 'MD'].map((seed) => { const sim = new Sim(seed); sim.run(60); const I = createIncident(sim, { type: 'fire', variant: 'ship', rng: sim.rng.fork('major-test') }); sim.runToEnd(); return { sim, I }; }));
const usesOf = (sims: Sim[]): MethodUse[] => sims.flatMap((sim) => sim.incidents.flatMap((I) => I.methods ?? []));
/** 수난 구조로 성공한 줄 (지상의 수난 구조 + 헬기의 호이스트) */
const rescued = (us: MethodUse[]): MethodUse[] => us.filter((u) => u.ok && (u.work === 'waterRescue' || u.work === 'hoist'));
/** 손으로 만든 수난 장면을 한 대원만 움직여 돌린다: 물살·물살 표시·눈·임무 (지휘관·두뇌 없이) */
function runAlone(sim: Sim, s: Scene, I: Incident, a: FieldAgent, sec: number, until: () => boolean): void {
  for (let k = 0; k < sec * 5 && !until(); k++) { sim.tick++; sim.t = sim.tick * sim.dt; tickWater(sim, s, I); methodsRule(sim, s, I); perceive(sim, s, a); act(sim, s, a); }
}

describe('R2 단계 1a: 물가 방법의 조건과 점수 (켜진 줄 그대로 — 믿음으로만 고른다)', () => {
  const setup = () => {
    const q = sceneWith('R2-1A', 'water', ['rescue', 'patrol', 'engine']);
    const c = q.s.casualties[0];
    // 그 대원의 지금 믿음에 덮어쓴다 (없으면 진실에서 — 처음 한 번)
    const set = (a: FieldAgent, v: Partial<CasBelief>): void => { const f = casFact(q.sim, q.s, c, '시험'); const cur = a.beliefs.val<CasBelief>('cas', c.id) ?? f.value; a.beliefs.merge(mkFact('cas', c.id, { ...cur, ...v }, '시험', q.sim.t + 1, 1, true, f.text)); q.sim.t += 1; };
    return { ...q, c, tg: tgCas(c), set, rope: q.role('ropeTech'), cop: q.role('officer'), eng: q.role('engineer') };
  };
  it('켜진 줄은 수난의 물가 방법 여섯이고, 나머지는 아직 꺼져 있다', () => {
    for (const m of METHOD_ORDER) expect(METHOD[m].can !== NOT_YET, m).toBe(LIVE.indexOf(m) >= 0);
  });
  it('닿는 거리: 손 1.2(안벽이면 못 쓴다) · 장대 2.0 · 구명환 2.8 · 구명줄·즉석 부력물 3.6 — 그 밖이면 수난 구조를 맡지 않는다(methodFit 0)', () => {
    const { sim, s, c, tg, set, rope, cop, eng } = setup();
    const x = 8, top = waterTop(s, x);
    expect(top).toBeGreaterThan(0);
    const picks = (a: FieldAgent): MethodId[] => (chooseMethod(sim, s, a, 'waterRescue', tg, null, NO_SENSE)?.cands ?? []).map((q) => q.m);
    // 물가 바로 아래 줄 (reach 1)
    set(rope, { x, y: top, band: 0, drift: 0 }); set(cop, { x, y: top, band: 0, drift: 0 }); set(eng, { x, y: top, band: 0, drift: 0 });
    expect(picks(cop)).toEqual(['hand', 'improvise']);
    expect(picks(eng)).toEqual(['hand', 'pole', 'improvise']);
    expect(picks(rope)).toEqual(['hand', 'rope', 'ring', 'improvise']);
    expect(chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)!).toMatchObject({ m: 'hand', why: 'near' });
    // 안벽: 손이 빠진다 → 장대가 있는 기관원은 장대, 없는 순찰 경관은 즉석 부력물 (장비를 따지지 않은 1등은 장대 — noGear)
    s.quay = true;
    expect(chooseMethod(sim, s, eng, 'waterRescue', tg, null, NO_SENSE)!).toMatchObject({ m: 'pole', why: 'near' });
    expect(chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)!).toMatchObject({ m: 'improvise', why: 'noGear', missing: 'pole' });
    s.quay = false;
    // 강의 줄마다: 믿음 위치에서 대원이 걸어서 닿는 가장 가까운 뭍까지의 거리(reachOf)로 후보가 갈린다
    for (let y = top; s.tiles[y * s.w + x] === T.WATER; y++) {
      set(rope, { x, y }); set(cop, { x, y }); set(eng, { x, y });
      const d = reachOf(s, x, y, 4, cop)!.d;
      const want = (kits: MethodId[]): MethodId[] => (['hand', 'pole', 'ring', 'rope', 'improvise'] as MethodId[]).filter((m) => kits.indexOf(m) >= 0 && d <= ({ hand: 1.2, pole: 2, ring: 2.8, rope: 3.6, improvise: 3.6 } as Record<string, number>)[m]).sort();
      expect(picks(cop).sort(), `y ${y} d ${d}`).toEqual(want(['hand', 'improvise']));
      expect(picks(eng).sort(), `y ${y} d ${d}`).toEqual(want(['hand', 'pole', 'improvise']));
      expect(picks(rope).sort(), `y ${y} d ${d}`).toEqual(want(['hand', 'ring', 'rope', 'improvise']));
    }
    // 즉석 부력물은 2.4칸 넘게 멀면 ×0.6 (그런 물 칸을 현장 전체에서 찾는다)
    let fx = -1, fy = -1;
    for (let i = 0; i < s.tiles.length && fx < 0; i++) if (s.tiles[i] === T.WATER) { const b = reachOf(s, i % s.w, (i / s.w) | 0, 4, cop); if (b && b.d > 2.4 && b.d <= 3.6) { fx = i % s.w; fy = (i / s.w) | 0; } }
    expect(fx).toBeGreaterThanOrEqual(0);
    set(cop, { x: fx, y: fy });
    const r = sim.responders[cop.rid];
    expect(chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)!.cands[0]).toEqual({ m: 'improvise', score: expect.closeTo(0.5 * 0.6 * (0.8 + 0.4 * r.skills.rescue) * (sim.weather !== 'clear' ? 0.9 : 1), 9) });
    // 던져서 닿지 않는다 (다리를 끊고 건너편 물가 바로 아래 — 대원 쪽 물가에서 3.6칸 넘게): 1a 에는 쓸 방법이 없다
    cutBridge(s);
    set(cop, { x, y: top });
    expect(chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)).toBeNull();
    expect(methodFit(sim, s, cop, work(sim, s, 'waterRescue', { cas: c.id }))).toBe(0);
  });
  it('위중(믿음 band 2): 던지기 ×0.35 · 손 ×0.7 · 장대 ×0.8 — 장대가 있으면 장대가 이긴다. 빠른 물살·날씨는 던지기를 깎는다', () => {
    const { sim, s, tg, set, rope, eng } = setup();
    const x = 8, top = waterTop(s, x), mid = top + 1;
    set(rope, { x, y: mid, band: 0, drift: 0 }); set(eng, { x, y: mid, band: 0, drift: 0 });
    const score = (a: FieldAgent, m: MethodId): number => chooseMethod(sim, s, a, 'waterRescue', tg, null, NO_SENSE)!.cands.find((q) => q.m === m)!.score;
    const r0 = score(rope, 'rope'), p0 = score(eng, 'pole');
    set(rope, { band: 2 }); set(eng, { band: 2 });
    expect(score(rope, 'rope')).toBeCloseTo(r0 * 0.35, 9); expect(score(eng, 'pole')).toBeCloseTo(p0 * 0.8, 9);
    expect(chooseMethod(sim, s, eng, 'waterRescue', tg, null, NO_SENSE)!).toMatchObject({ m: 'pole', why: 'weak' });
    set(rope, { band: 0, drift: 0.09 });
    expect(score(rope, 'rope')).toBeCloseTo(r0 * 0.85, 9);
  });
  it('하류 차단: 같은 줄 하류 8칸 안의 뭍(다리)에 대상이 40초 안에 닿으면 ×1, 90초 안이면 ×0.5, 넘으면 고르지 않는다. 빠른 물살 ×1.3 (까닭 fast)', () => {
    const { sim, s, tg, set, cop } = setup();
    let bx = -1;
    for (let x = 1; x < s.w && bx < 0; x++) { const top = waterTop(s, x - 1); if (top >= 0 && s.tiles[(top + 2) * s.w + x] === T.TRAIL) bx = x; }
    const y = waterTop(s, bx - 1) + 2;
    const has = (): number => { const q = chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE); return q?.cands.find((v) => v.m === 'catch')?.score ?? 0; };
    set(cop, { x: bx - 3, y, band: 0, drift: 0 });
    expect(has(), '떠내려가지 않으면 기다릴 까닭이 없다').toBe(0);
    set(cop, { drift: 0.05 });      // (bx − 1 − (bx − 3)) / 0.05 = 40초
    expect(has()).toBeCloseTo(0.8, 9);
    set(cop, { drift: 0.03 });      // 67초
    expect(has()).toBeCloseTo(0.4, 9);
    set(cop, { drift: 0.02 });      // 100초
    expect(has()).toBe(0);
    set(cop, { drift: 0.08 });
    expect(chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)!).toMatchObject({ m: 'catch', why: 'fast' });
    expect(has()).toBeCloseTo(0.8 * 1.3, 9);
  });
  it('methodStillFits: 고른 방법을 지금도 쓸 수 있는가 — 상황·장비만 (대상 믿음이 없으면 참). fitFor 는 methodFit 의 점수로 장비 항을 바꾼다', () => {
    const { sim, s, c, tg, set, eng, cop } = setup();
    const x = 8, top = waterTop(s, x);
    set(eng, { x, y: top, band: 0, drift: 0 });
    expect(methodStillFits(sim, s, eng, 'waterRescue', tg, null, 'pole')).toBe(true);
    set(eng, { y: top + 2 });      // 떠내려가 3칸
    expect(methodStillFits(sim, s, eng, 'waterRescue', tg, null, 'pole')).toBe(false);
    expect(methodStillFits(sim, s, eng, 'waterRescue', { ...tg, cas: 99 }, null, 'pole')).toBe(true);
    // fitFor = 0.22 + 0.5 × 구조 능력 + 0.28 × min(1, methodFit) (+ 역할 선호)
    const w = work(sim, s, 'waterRescue', { cas: c.id });
    set(cop, { x, y: top + 2, band: 0, drift: 0 });
    const r = sim.responders[cop.rid];
    expect(fitFor(sim, s, cop, w)).toBeCloseTo(0.22 + 0.5 * r.skills.rescue + 0.28 * Math.min(1, methodFit(sim, s, cop, w)) + (ROLES.officer.prefer.waterRescue ?? 0), 9);
  });
  it('순수 함수다 (켜진 줄 그대로): 백 번 불러도 장비·난수·기억·믿음·기록이 그대로', () => {
    const { sim, s, c, tg, rope, cop, eng } = setup();
    const w = work(sim, s, 'waterRescue', { cas: c.id });
    const snap = (): string => JSON.stringify([sim.responders.map((r) => r.kit), peek(sim.rng), peek(s.rng), s.agents.map((a) => [peek(a.rng), a.mfail, a.mrng === undefined, a.beliefs.facts.size]), sim.events.length, sim.logHash]);
    const before = snap();
    const first = [rope, cop, eng].map((a) => JSON.stringify([chooseMethod(sim, s, a, 'waterRescue', tg, null, NO_SENSE), methodFit(sim, s, a, w), methodStillFits(sim, s, a, 'waterRescue', tg, null, 'rope')]));
    for (let k = 0; k < 100; k++) [rope, cop, eng].forEach((a, i) => expect(JSON.stringify([chooseMethod(sim, s, a, 'waterRescue', tg, null, NO_SENSE), methodFit(sim, s, a, w), methodStillFits(sim, s, a, 'waterRescue', tg, null, 'rope')])).toBe(first[i]));
    expect(snap()).toBe(before);
  });
});

describe('R2 단계 1a: 물가 방법의 실행 (장면을 직접 만들어 — 한 대원만)', () => {
  it('손 뻗어 붙잡기: 일반 물가 1칸의 대상을 손으로 건지고, 방법별 완료 문구·방법 기록·구한 방법이 남는다', () => {
    const { sim, I, s, role } = sceneWith('R2-HAND', 'water', ['patrol']);
    const cop = role('officer'), c = s.casualties[0];
    for (const q of s.casualties) if (q !== c) { q.inWater = false; q.where = 'safe'; }
    const x = 8, top = waterTop(s, x);
    c.x = c.px = x; c.y = c.py = top; c.drift = 0; c.health = 80; c.inWater = true; c.where = 'scene';
    cop.x = x; cop.y = top - 2;
    for (const a of s.agents) a.beliefs.merge(casFact(sim, s, c, '시험'));
    const w = work(sim, s, 'waterRescue', { cas: c.id });
    const t = taskFor(cop, w);
    const n = sim.events.length;
    runAlone(sim, s, I, cop, 30, () => !c.inWater);
    expect(c.inWater).toBe(false); expect(c.freedHow).toBe('hand'); expect(c.freedBy).toBe(cop.rid);
    expect(s.tiles[Math.round(c.y) * s.w + Math.round(c.x)]).not.toBe(T.WATER);
    expect(c.bleedCause).toBe('exposure');
    expect(t.method).toBe('hand');
    expect(texts(sim, n)).toContain(`구조 대상 ${c.label}, 손을 뻗어 붙잡아 끌어냈습니다. 처치와 이송이 필요합니다.`);
    expect(I.methods!.filter((u) => u.ok)).toMatchObject([{ method: 'hand', work: 'waterRescue', cas: c.id, rid: cop.rid, ok: true }]);
    expect(w.status).toBe('done');
  });
  it('하류 차단: 다리 3칸 위에서 떠내려오는 대상(drift 0.08)을 줄·장대가 없는 대원이 다리에서 기다렸다 붙잡는다', () => {
    const { sim, I, s, role } = sceneWith('R2-CATCH', 'water', ['patrol']);
    const cop = role('officer'), c = s.casualties[0];
    for (const q of s.casualties) if (q !== c) { q.inWater = false; q.where = 'safe'; }
    let bx = -1;
    for (let x = 1; x < s.w && bx < 0; x++) { const top = waterTop(s, x - 1); if (top >= 0 && s.tiles[(top + 2) * s.w + x] === T.TRAIL) bx = x; }
    const y = waterTop(s, bx - 1) + 2;
    c.x = c.px = bx - 3; c.y = c.py = y; c.drift = 0.08; c.health = 80; c.inWater = true; c.where = 'scene';
    for (const a of s.agents) a.beliefs.merge(casFact(sim, s, c, '시험'));
    const t = taskFor(cop, work(sim, s, 'waterRescue', { cas: c.id }));
    const n = sim.events.length;
    runAlone(sim, s, I, cop, 60, () => !c.inWater || c.dead);
    expect(t.method).toBe('catch'); expect(t.mwhy).toBe('fast');
    expect(texts(sim, n)[0]).toBe('물살이 빠릅니다. 하류에서 기다렸다 붙잡겠습니다.');
    expect(c.inWater).toBe(false); expect(c.freedHow).toBe('catch');
    expect(texts(sim, n)).toContain(`구조 대상 ${c.label}, 하류에서 기다렸다 붙잡아 끌어냈습니다. 처치와 이송이 필요합니다.`);
    expect(Math.abs(Math.round(cop.x) - bx), '다리에서 기다렸다').toBeLessThanOrEqual(1);
  });
  it('투척이 두 번 빗나가면 접는다: METHOD_FAIL 과 다음 방법, 같은 대상의 성공이 그 문제를 복구한다. 판정은 mrng 만 쓴다', () => {
    const { sim, I, s, role } = sceneWith('R2-MISS', 'water', ['patrol']);
    const cop = role('officer'), c = s.casualties[0];
    for (const q of s.casualties) if (q !== c) { q.inWater = false; q.where = 'safe'; }
    const x = 8, top = waterTop(s, x);
    c.x = c.px = x; c.y = c.py = top + 2; c.drift = 0; c.health = 20; c.inWater = true; c.where = 'scene';      // 위중 — 줄을 잡을 힘이 거의 없다
    for (const a of s.agents) a.beliefs.merge(casFact(sim, s, c, '시험'));
    const w = work(sim, s, 'waterRescue', { cas: c.id });
    const t = taskFor(cop, w);
    const p0 = peek(s.rng);
    runAlone(sim, s, I, cop, 90, () => (I.methods ?? []).some((u) => !u.ok));
    expect(t.method).toBe('improvise');
    const fold = I.methods!.find((u) => !u.ok)!;
    expect(fold).toMatchObject({ method: 'improvise', why: 'noGear', missing: 'rope' });
    const p = I.problems.find((q) => q.code === 'METHOD_FAIL')!;
    expect(p.detail).toBe('즉석 부력물이 두 차례 빗나감'); expect(p.eventId).toBe(fold.eventId);
    expect(w.fails).toBe(1);
    expect(sim.events.filter((e) => e.importance === 0 && /빗나갔습니다|잡지 못했습니다/.test(e.text)).length).toBe(1);
    // 같은 대상을 다른 방법으로 건지면 그 문제가 복구된다 (보고서의 복구 문구)
    const t2 = taskFor(role('patrolLead'), w);
    t2.method = 'hand'; t2.mt0 = sim.t;
    recordMethod(sim, I, role('patrolLead'), t2, 'hand', 'usual', true, sim.events.length - 1);
    expect(p.recovered).toBe(true); expect(p.recoveryText).toContain('손을 뻗어 붙잡아 다시 시도해 성공');
    // 판정은 대원의 방법 흐름에서 — 현장의 s.rng(사격·용의자)는 쓰지 않았다
    expect(peek(s.rng)).toBe(p0); expect(cop.mrng).toBeDefined();
  });
  it('대상이 떠내려가 고른 방법의 거리를 3초 넘게 벗어나면 조건 상실(tooFar)로 바꾼다 — 문제가 아니고 실패 횟수에 들지 않는다', () => {
    const { sim, I, s, role } = sceneWith('R2-FAR', 'water', ['engine']);
    const eng = role('engineer'), c = s.casualties[0];
    for (const q of s.casualties) if (q !== c) { q.inWater = false; q.where = 'safe'; }
    const x = 8, top = waterTop(s, x);
    c.x = c.px = x; c.y = c.py = top; c.drift = 0; c.health = 80; c.inWater = true; c.where = 'scene';
    s.quay = true;      // 손을 빼서 장대를 고르게 한다
    for (const a of s.agents) a.beliefs.merge(casFact(sim, s, c, '시험'));
    const w = work(sim, s, 'waterRescue', { cas: c.id });
    const t = taskFor(eng, w);
    sim.tick = 4; sim.t = sim.tick * sim.dt;
    act(sim, s, eng);
    expect(t.method).toBe('pole');
    // 대상을 가운데 줄로 (믿음도 함께 — 대원이 본다)
    c.y = c.py = top + 2;
    for (let k = 0; k < 20 && t.method === 'pole'; k++) { sim.tick++; sim.t = sim.tick * sim.dt; methodsRule(sim, s, I); perceive(sim, s, eng); eng.beliefs.merge(casFact(sim, s, c, '시험')); act(sim, s, eng); }
    expect(t.method).toBe('improvise'); expect(t.mwhy).toBe('tooFar');
    expect(I.methods![0]).toMatchObject({ method: 'pole', ok: false });
    expect(I.problems.some((q) => q.code === 'METHOD_FAIL')).toBe(false); expect(w.fails).toBe(0);
    expect(eng.mfail![0]).toMatchObject({ m: 'pole', until: expect.any(Number) });
  });
  it('쓸 방법이 없으면 맡지 않는다: 1a 에서 던져서 닿지 않는 대상의 수난 구조는 nomethod 로 끝낸다 (작업은 다시 열린다)', () => {
    const { sim, I, s, role } = sceneWith('R2-NONE', 'water', ['patrol']);
    const cop = role('officer'), c = s.casualties[0];
    cutBridge(s);
    const x = 8, top = waterTop(s, x);
    c.x = c.px = x; c.y = c.py = top; c.drift = 0; c.inWater = true; c.where = 'scene';
    for (const a of s.agents) a.beliefs.merge(casFact(sim, s, c, '시험'));
    const w = work(sim, s, 'waterRescue', { cas: c.id });
    taskFor(cop, w);
    const n = sim.events.length;
    act(sim, s, cop);
    expect(cop.task).toBeNull(); expect(w.status).toBe('open'); expect(w.fails).toBe(1);
    expect(texts(sim, n).some((l) => l.includes('쓸 수 있는 방법이 없습니다'))).toBe(true);
    void I;
  });
});

describe('R2 단계 1a: 강제 교대 (§8 의 2·3·4·5·6·7·9)', () => {
  it('2. 장비를 빼면 다른 방법을 쓴다 — 구명줄·구명환·장대가 모두 알려진 고장이면 손·즉석 부력물·하류 차단·호이스트로 건지고, 장비가 없어서라는 까닭이 남는다', () => {
    const front = rescued(usesOf(W20().slice(0, 6))).map((u) => u.method);
    expect(front.some((m) => m === 'rope' || m === 'pole')).toBe(true);
    const back = usesOf(STRIPPED());
    const ok = rescued(back);
    expect(ok.length).toBeGreaterThan(0);
    for (const u of ok) expect(['hand', 'improvise', 'catch', 'swim', 'boat', 'hoist'], u.method).toContain(u.method);
    expect(back.some((u) => u.why === 'noGear' && u.missing !== undefined)).toBe(true);
  });
  it('3. 방법마다 쓰인 교대가 있다: 수난 강제 + 장비를 뺀 교대에서 구명줄·장대·즉석 부력물, 선박 화재에서는 손이 없다(안벽). 호이스트로 건진 사람은 그렇게 적힌다', () => {
    const set = new Set(rescued(usesOf([...W20().slice(0, 12), ...STRIPPED()])).map((u) => u.method));
    for (const m of ['rope', 'pole', 'improvise'] as MethodId[]) expect(set.has(m), m).toBe(true);
    const ships = SHIPS();
    let shore = 0;
    for (const { sim, I } of ships) {
      expect(sim.scenes[I.id]!.quay).toBe(true);
      const us = rescued(I.methods ?? []);
      expect(us.some((u) => u.method === 'hand'), sim.seed).toBe(false);
      shore += us.filter((u) => ['pole', 'ring', 'rope', 'improvise'].indexOf(u.method) >= 0).length;
    }
    expect(shore).toBeGreaterThanOrEqual(1);
    // 호이스트 (R1 의 상공 헬기): 구한 방법이 적히고 방법 기록이 있다
    let hoisted = 0;
    for (const sim of W20()) for (const s of sim.scenes) if (s) for (const c of s.casualties) if (c.freedHow === 'hoist') {
      hoisted++;
      expect(sim.incidents[s.incidentId].methods!.some((u) => u.method === 'hoist' && u.work === 'hoist' && u.cas === c.id && u.ok)).toBe(true);
    }
    expect(hoisted).toBeGreaterThan(0);
  });
  it('4. 줄도 장대도 없는 순찰대만 나간 수난 사고도 끝난다 (즉석 부력물로 건지거나, 맡을 사람이 없는 작업이 부른 지원 부대가 건진다)', () => {
    for (const seed of ['WN0', 'WN1']) {
      const sim = new Sim(seed, NORMAL, 900, { force: 'water/std' });
      // 구명줄·구명환·장대를 든 대원이 있는 부대는 나가지 않는다 (순찰·구급은 그대로)
      for (const u of sim.units) if (u.crew.some((rid) => (sim.responders[rid].kit ?? []).some((it) => it.id === 'rope' || it.id === 'ring' || it.id === 'pole'))) u.state = 'oos';
      sim.runToEnd();
      const I = sim.incidents.find((q) => q.truth.type === 'water')!;
      expect(I.phase, seed).toBe('closed');
      expect(['timeout', 'abandoned', 'noresponse', 'shiftend'].indexOf(I.closeReason!), `${seed} ${I.closeReason}`).toBe(-1);
      const s = sim.scenes[I.id]!;
      expect(s.casualties.some((c) => c.freedHow !== undefined), seed).toBe(true);
    }
  });
  it('5. 끌어낸 사람은 물 밖 뭍에 있고 구한 방법이 적혀 있다 (모든 강제 교대)', () => {
    let n = 0;
    for (const sim of [...W20(), ...STRIPPED(), ...SHIPS().map((q) => q.sim)]) for (const s of sim.scenes) if (s) for (const c of s.casualties) {
      if (c.tFreed < 0 || !(c.injuries ?? []).some((j) => j.cause === 'drown')) continue;      // 물에 빠졌다가 건져진 사람
      n++;
      expect(c.inWater, `${sim.seed} ${c.label}`).toBe(false);
      expect(s.tiles[Math.round(c.y) * s.w + Math.round(c.x)] !== T.WATER || c.where !== 'scene', `${sim.seed} ${c.label}`).toBe(true);
      expect(c.freedHow, `${sim.seed} ${c.label}`).toBeDefined();
    }
    expect(n).toBeGreaterThan(20);
  });
  it('6. 재현성: 같은 시드 두 번의 기록 해시가 같다 — 수난 강제, 장비를 뺀 교대, 무장 강제', () => {
    expect(waterShift('W0').report!.hash).toBe(W20()[0].report!.hash);
    expect(waterShift('W1', true).report!.hash).toBe(STRIPPED()[1].report!.hash);
    const armed = (): string => { const sim = new Sim('WA0', NORMAL, 1200, { force: 'armed/hostage' }); sim.runToEnd(); return sim.report!.hash; };
    expect(armed()).toBe(armed());
  });
  it('6. R2 장비의 고장 추첨(kit-r2 · aid-r2:<n>)은 R1 의 흐름 결과를 바꾸지 않는다 — 편성표와 인근 도시 지원 부대 모두', () => {
    const ADDED: Partial<Record<RoleId, KitId[]>> = { engineer: ['pole'], ladderOp: ['pole'], ropeTech: ['pfd', 'drysuit', 'raft'], airRescuer: ['pfd'], boatRescuer: ['pole', 'pfd', 'drysuit'] };
    const r1Only = <V>(fn: () => V): V => {
      const saved: Partial<Record<RoleId, KitId[]>> = {};
      for (const role of Object.keys(ADDED) as RoleId[]) { saved[role] = ROLES[role].kit; ROLES[role].kit = ROLES[role].kit.filter((id) => ADDED[role]!.indexOf(id) < 0); }
      try { return fn(); } finally { for (const role of Object.keys(saved) as RoleId[]) ROLES[role].kit = saved[role]!; }
    };
    const AID: (keyof Needs)[] = ['suppression', 'rescue', 'ems', 'law', 'tactical', 'search', 'traffic', 'eod'];
    const build = (seed: string): Sim => {
      const sim = new Sim(seed, { ...FULL, equipment: 1 });
      const I = createIncident(sim, { type: 'water', rng: sim.rng.fork('t') });
      for (const key of AID) { createAidUnit(sim, key, I); sim.aidUsed++; }
      return sim;
    };
    const dump = (sim: Sim): string => JSON.stringify(sim.responders.map((r) => [r.name, r.skills, r.fitness, r.composure, r.experience, (r.kit ?? []).filter((it) => KITS[it.id].batch !== 'r2' && !Object.values(ADDED).some((l) => l!.indexOf(it.id) >= 0)).map((it) => [it.id, it.uses, it.fault, it.faultKnown])]));
    let rafts = 0, raftFaults = 0;
    for (let k = 0; k < 12; k++) {
      const seed = 'RK' + k;
      const withR2 = build(seed), plainR1 = r1Only(() => build(seed));
      expect(dump(withR2), seed).toBe(dump(plainR1));
      // R2 장비의 추첨: 편성표는 kit-r2, 지원 부대는 aid-r2:<n> — 대원 순서 × 장비 순서, 같은 확률
      const rosterN = withR2.responders.findIndex((r) => withR2.units[r.unitId].aid);
      const rg = withR2.rng.fork('kit-r2');
      for (const r of withR2.responders.slice(0, rosterN)) for (const it of r.kit!) if (KITS[it.id].batch === 'r2') { rafts++; const want = rg.chance(withR2.tune.kitFault); expect(!!it.fault, `${seed} ${r.name} ${it.id}`).toBe(want); if (want) raftFaults++; }
    }
    expect(rafts).toBeGreaterThan(5);
    // 지원 구조대의 로프 대원이 든 고무보트는 그 지원 부대의 흐름 aid-r2:<n> 에서 뽑는다
    const sim = new Sim('RK0', { ...FULL, equipment: 1 });
    const I = createIncident(sim, { type: 'water', rng: sim.rng.fork('t') });
    sim.aidUsed = 3;
    const u = createAidUnit(sim, 'rescue', I)!;
    const rg = sim.rng.fork('aid-r2:3');
    let seen = 0;
    for (const rid of u.crew) for (const it of sim.responders[rid].kit!) if (KITS[it.id].batch === 'r2') { seen++; expect(!!it.fault).toBe(rg.chance(sim.tune.kitFault)); }
    expect(seen).toBe(1);
    void raftFaults;
  });
  it('7. 기록과 보고서: 평소와 다른 방법으로 구한 사건의 분석 문장에 그 방법이 실리고, 막혔다가 다시 시도해 건진 문제는 복구로 남으며, 교대 요약에 "대응 방법:" 줄이 있다', () => {
    let sentences = 0, recovered = 0, summaries = 0;
    for (const sim of [...W20(), ...STRIPPED()]) {
      for (const I of sim.incidents) {
        const ms = I.methods ?? [];
        // 다시 시도해 성공: 같은 대상의 접은 줄 뒤에 성공 줄이 있으면 그 METHOD_FAIL 은 복구됐다
        for (const p of I.problems) if (p.code === 'METHOD_FAIL') {
          const fold = ms.find((u) => !u.ok && u.eventId === p.eventId)!;
          expect(fold, `${sim.seed} ${I.code}`).toBeDefined();
          const later = ms.some((u) => u.ok && u.cas === fold.cas && u.t >= fold.t && (u.work === 'waterRescue' || u.work === 'hoist'));
          if (later) { expect(p.recovered, `${sim.seed} ${I.code} ${p.detail}`).toBe(true); recovered++; }
        }
        if (!I.result || I.problems.length > 3) continue;
        // 실릴 문장: 기록 순서대로 평소 방법이 아닌 성공 줄 가운데 같은 대상에 문제를 남긴 접은 줄이 앞서지 않은 것, 앞의 둘 (methodReport.methodLines)
        const failed = new Set<number>(), pick: MethodUse[] = [];
        for (const u of ms) {
          if (!u.ok) { if (I.problems.some((p) => p.eventId === u.eventId)) failed.add(u.cas); continue; }
          if (METHOD[u.method].plain || failed.has(u.cas) || pick.length >= 2) continue;
          pick.push(u);
        }
        for (const u of pick) if (u.work === 'waterRescue') {
          expect(I.result.analysis.some((l) => l.includes(METHOD[u.method].noun) && l.includes('구했습니다')), `${sim.seed} ${I.code} ${u.method}`).toBe(true);
          sentences++;
        }
      }
      const nonPlain = usesOf([sim]).some((u) => u.ok && !METHOD[u.method].plain);
      expect(sim.report!.summary.some((l) => l.startsWith('대응 방법:')), sim.seed).toBe(nonPlain);
      if (nonPlain) summaries++;
    }
    expect(sentences).toBeGreaterThan(0); expect(recovered).toBeGreaterThan(0); expect(summaries).toBeGreaterThan(0);
  });
  it('9. 다양성(느슨하게): 수난 강제 20교대에서 성공 방법이 3가지 이상, 가장 많은 방법이 85% 이하', () => {
    const us = rescued(usesOf(W20()));
    const by: Record<string, number> = {};
    for (const u of us) by[u.method] = (by[u.method] ?? 0) + 1;
    expect(Object.keys(by).length).toBeGreaterThanOrEqual(3);
    expect(Math.max(...Object.values(by)) / us.length).toBeLessThanOrEqual(0.85);
  });
  it('물가의 판정은 방법 흐름(method:<사건>:<rid>:<k>)에서 나온다: 그 흐름을 쓴 대원이 있다', () => {
    const sim = W20()[0];
    expect(sim.scenes.some((s) => s && s.agents.some((a) => a.mrng !== undefined))).toBe(true);
  });
});

describe('R2 세계 규칙과 믿음 (단계 1a)', () => {
  it('casFact: 물속 표시와 떠내려가는 속도(drift — 물 밖이면 0)를 본 그대로 싣는다', () => {
    const { sim, s } = sceneWith('R2-CAS', 'water', []);
    const c = s.casualties[0];
    c.drift = 0.04;
    const v = casFact(sim, s, c, '시험').value as CasBelief;
    expect(v.water).toBe(true); expect(v.drift).toBe(0.04);
    c.inWater = false; expect(casFact(sim, s, c, '시험').value).toMatchObject({ water: false, drift: 0 });
    const dry = sceneWith('R2-CAS', 'medical', []);
    expect(casFact(dry.sim, dry.s, dry.s.casualties[0], '시험').value).toMatchObject({ water: false, drift: 0 });
  });
  it('물살과 안벽 표시를 판단·판정이 읽는다: 안벽이면 손을 고르지 않고, 빠른 물살(0.07 이상)은 투척 명중을 깎는다', () => {
    const { sim, s } = sceneWith('R2-FLOW', 'water', ['rescue']);
    const rid = s.agents[0].rid;
    s.flow = 0.02; const slow = hitP(sim, s, rid, 3);
    s.flow = 0.09; const fast = hitP(sim, s, rid, 3);
    expect(slow - fast).toBeCloseTo(0.12, 9);
    expect(hitP(sim, s, rid, 2) - hitP(sim, s, rid, 3)).toBeCloseTo(0.12, 9);
    expect([grabP(80), grabP(50), grabP(30), grabP(10)]).toEqual([1, 0.75, 0.4, 0.15]);
  });
});
