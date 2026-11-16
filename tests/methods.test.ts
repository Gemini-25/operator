// R2 대응 방식 다양화 (docs/specs/R2-methods.md §8). 시험 1(판단부의 정보 격리), 틀(고르기·바꾸기·기록 — 시험이 표를 단계 0 처럼 끄고 줄을 켜서 본다: withRows),
// 단계 1a(수난의 물가 방법 — §8 의 2·3·4·5·6·7·8·9 가운데 1a 의 몫, 맨 아래 묶음들). 방법을 구현하는 뒤 단계(1b~6)가 자기 몫을 더한다.
import { readFileSync } from 'node:fs';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { KITS, ROLES, kitWorks } from '../src/sim/crews';
import { PROBLEM_LABEL, buildReport, evaluate } from '../src/sim/debrief';
import { NORMAL, parseDisaster } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { raiseProblem } from '../src/sim/events';
import { casFact, detectRadius, fitFor, perceive } from '../src/sim/field/agents';
import { mkFact } from '../src/sim/field/beliefs';
import { XK, act, finishTask, makeTask } from '../src/sim/field/executor';
import { think } from '../src/sim/field/brain';
import type { Rng } from '../src/sim/rng';
import { BARE_HANDS, SHARED, isQty, kitCount, kitName, kitTool, seatsLeft, swimBonus, useKit } from '../src/sim/field/gear';
import { los, staticPass } from '../src/sim/field/grid';
import { exteriorSpots, newOps } from '../src/sim/field/ops';
import { catOf, catTick } from '../src/sim/field/catastrophe';
import { WORK_DONE, methodFailLine, methodLines, methodSummary, methodTally, whyText } from '../src/sim/field/methodReport';
import { BOAT, FAIL_KEEP, WATER_FLOOR, blockerRate, clutchP, extricateRate, grabP, hitP, mrng, recheckOnArrive, recordAir, recordMethod, senseOf, stackSpot, startMethod, swimTrouble, switchMethod, targetOf, waterTick } from '../src/sim/field/methodRun';
import { METHOD, METHOD_ORDER, NOT_YET, NO_SENSE, SAY, WORK_MODE, boatCost, catchPoint, chooseMethod, searchMul, landComp, methodFit, methodStillFits, methodsOf, onWater, reachOf, sayStart, swimOf, targetKey, targetOfWork, whyNote } from '../src/sim/field/methods';
import type { MTarget, MethodDef } from '../src/sim/field/methods';
import { BARRICADE, FLOW_MIN, methodsRule } from '../src/sim/field/rules/methods';
import { lockDoor } from '../src/sim/field/plans';
import { SCENE_RULES } from '../src/sim/field/sceneRegistry';
import { tickScene, unitArrived } from '../src/sim/field/sceneManager';
import { createIncident } from '../src/sim/incidents';
import { createAidUnit, tickUnits } from '../src/sim/resources';
import { tickWater } from '../src/sim/field/hazards';
import { T } from '../src/sim/types';
import type { CasBelief, Casualty, FieldAgent, Incident, IncidentType, KitId, MethodId, MethodUse, Needs, Prop, RoleId, Scene, Task, UnitKind, WorkItem, WorkKind } from '../src/sim/types';
import { clamp, josa } from '../src/sim/util';
import { MethodRows } from '../src/ui/MethodRows';
import { THROW_RELEASE, drawBarricades, drawBoats, drawCharges, drawMethodFx, inBoat, swimming } from '../src/view/scene/methodsLayer';
import { drawPerson, drawSwimmer, responderLook } from '../src/view/scene/sprites';
import { fakeCtx } from './fakeCanvas';

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
/** 방법을 켠 단계가 조건(can)을 채운 줄 — 단계 1a: 수난의 물가 방법 여섯, 단계 1b: 헤엄·줄 확보, 단계 1c: 보트, 단계 2: 문·통로 일곱(폭파 진입 포함), 단계 3: 구출 아홉·수색 다섯, 단계 4: 화재 다섯 */
const LIVE: MethodId[] = ['hand', 'pole', 'ring', 'rope', 'improvise', 'catch', 'swim', 'tend', 'boat', 'kick', 'irons', 'ram', 'hydraulic', 'handClear', 'toolClear', 'charge',
  'manual', 'basic', 'spread', 'roof', 'rapid', 'haul', 'tunnel', 'airbag', 'shore', 'call', 'listen', 'line', 'hail', 'thermal',
  'interior', 'defensive', 'aerial', 'extinguisher', 'ventilate'];
/** 헤엄을 못 치는 몸으로 둔다 (수영 능력 = 0.15 + 개인차 ±0.15 < 문턱 0.35 — 구명조끼가 없을 때) */
const noSwim = (sim: Sim, a: FieldAgent): void => { const r = sim.responders[a.rid]; r.fitness = 0; r.skills.rescue = 0; strip(sim, a.rid, 'pfd'); };
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
  it('단계 1a·3·4: 수난의 넷(장대·구명조끼·드라이슈트·고무보트)·구출의 둘(에어백·지지대)·화재의 둘(소화기·송풍기)만 설계서의 역할이 기본 장비 끝에 든다 — 비살상탄은 아직 표에만', () => {
    for (const id of NEW) expect(KITS[id].name.length, id).toBeGreaterThan(0);
    // 설계서 §3.3 표의 "누가 든다" (단계 1a 의 넷 · 단계 3 의 둘 · 단계 4 의 둘). 수중 구조대의 두 자리(잠수 팀장·대원)는 N9 §4.8 대로 드라이슈트를 처음부터 든다 — 편성되지 않는 줄(minLevel 6)
    const WHO: Partial<Record<KitId, RoleId[]>> = {
      pole: ['engineer', 'ladderOp', 'boatRescuer'], pfd: ['ropeTech', 'boatRescuer', 'airRescuer'], drysuit: ['ropeTech', 'boatRescuer', 'diveLead', 'diver'], raft: ['ropeTech'],
      airbag: ['extricator'], shoring: ['rescueLead'],
      extinguisher: ['engineer', 'patrolLead', 'emsDriver', 'eodGuard'], fan: ['engineer', 'ladderOp', 'decon'],
    };
    for (const id of NEW) {
      const holders = (Object.keys(ROLES) as RoleId[]).filter((role) => ROLES[role].kit.indexOf(id) >= 0).sort();
      expect(holders, id).toEqual((WHO[id] ?? []).slice().sort());
    }
    // 끝에 붙였다: 그 역할의 R1·N9 장비 순서는 그대로다 (고장 추첨 순서)
    expect(ROLES.ropeTech.kit).toEqual(['scba', 'turnout', 'rope', 'ring', 'hose', 'pfd', 'drysuit', 'raft']);
    expect(ROLES.boatRescuer.kit).toEqual(['rope', 'ring', 'oilBoom', 'pole', 'pfd', 'drysuit']);
    expect(ROLES.engineer.kit.slice(-3)).toEqual(['pole', 'extinguisher', 'fan']); expect(ROLES.ladderOp.kit.slice(-2)).toEqual(['pole', 'fan']); expect(ROLES.airRescuer.kit.slice(-1)).toEqual(['pfd']);
    expect(ROLES.patrolLead.kit.slice(-1)).toEqual(['extinguisher']); expect(ROLES.emsDriver.kit).toEqual(['stretcher', 'extinguisher']); expect(ROLES.eodGuard.kit.slice(-1)).toEqual(['extinguisher']); expect(ROLES.decon.kit.slice(-1)).toEqual(['fan']);
    expect(ROLES.extricator.kit).toEqual(['scba', 'turnout', 'spreader', 'airbag']); expect(ROLES.rescueLead.kit).toEqual(['scba', 'turnout', 'searchKit', 'irons', 'shoring']);
    // 교대의 명부: 여덟은 그 역할의 대원이 들고, 비살상탄은 아무도 들지 않는다. 표의 처음 수량은 명부가 복사한다 (kitFor — 소화기 1)
    const sim = new Sim('R2-KIT', FULL);
    const LATER: KitId[] = ['beanbag'];
    for (const r of sim.responders) for (const it of r.kit!) { expect(LATER.indexOf(it.id), `${r.name}: ${it.id}`).toBe(-1); expect(it.uses, `${r.name}: ${it.id}`).toBe(it.id === 'scba' ? sim.tune.airFull : it.id === 'flashbang' ? it.uses : ({ taser: 2, charge: 2 } as Partial<Record<KitId, number>>)[it.id] ?? KITS[it.id].uses); }
    expect(sim.responders.some((r) => r.kit!.some((it) => it.id === 'raft'))).toBe(true);
    expect(sim.responders.some((r) => r.kit!.some((it) => it.id === 'airbag'))).toBe(true); expect(sim.responders.some((r) => r.kit!.some((it) => it.id === 'shoring'))).toBe(true);
    expect(sim.responders.some((r) => r.kit!.some((it) => it.id === 'fan'))).toBe(true);
    for (const r of sim.responders) for (const it of r.kit!) if (it.id === 'extinguisher') expect(it.uses).toBe(1);
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
  it('켜진 줄은 수난의 물가 방법 여섯과 헤엄·줄 확보(1b)·보트(1c), 문·통로 일곱(2), 구출·수색(3)이고, 나머지는 아직 꺼져 있다', () => {
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
    expect(picks(rope).sort()).toEqual(['boat', 'hand', 'improvise', 'ring', 'rope']);      // (1c) 로프 대원은 고무보트를 든다 — 거리 조건이 없다
    expect(chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)!).toMatchObject({ m: 'hand', why: 'near' });
    // 안벽: 손이 빠진다 → 장대가 있는 기관원은 장대, 없는 순찰 경관은 즉석 부력물 (장비를 따지지 않은 1등은 장대 — noGear)
    s.quay = true;
    expect(chooseMethod(sim, s, eng, 'waterRescue', tg, null, NO_SENSE)!).toMatchObject({ m: 'pole', why: 'near' });
    expect(chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)!).toMatchObject({ m: 'improvise', why: 'noGear', missing: 'pole' });
    s.quay = false;
    // 강의 줄마다: 믿음 위치에서 대원이 걸어서 닿는 가장 가까운 뭍까지의 거리(reachOf)로 후보가 갈린다 (1b: 손이 닿지 않으면 헤엄 — 수영 능력이 문턱을 넘는 대원만)
    const swims = (a: FieldAgent): boolean => swimOf(sim, a) >= (kitCount(sim, a.rid, 'pfd') > 0 ? 0.25 : 0.35);
    for (let y = top; s.tiles[y * s.w + x] === T.WATER; y++) {
      set(rope, { x, y }); set(cop, { x, y }); set(eng, { x, y });
      const d = reachOf(s, x, y, 4, cop)!.d;
      const want = (a: FieldAgent, kits: MethodId[]): MethodId[] => [...(['hand', 'pole', 'ring', 'rope', 'improvise'] as MethodId[]).filter((m) => kits.indexOf(m) >= 0 && d <= ({ hand: 1.2, pole: 2, ring: 2.8, rope: 3.6, improvise: 3.6 } as Record<string, number>)[m]), ...(d > 1.2 && swims(a) ? ['swim' as MethodId] : []), ...(kits.indexOf('boat') >= 0 ? ['boat' as MethodId] : [])].sort();
      expect(picks(cop).sort(), `y ${y} d ${d}`).toEqual(want(cop, ['hand', 'improvise']));
      expect(picks(eng).sort(), `y ${y} d ${d}`).toEqual(want(eng, ['hand', 'pole', 'improvise']));
      expect(picks(rope).sort(), `y ${y} d ${d}`).toEqual(want(rope, ['hand', 'ring', 'rope', 'improvise', 'boat']));
    }
    // 즉석 부력물은 2.4칸 넘게 멀면 ×0.6 (그런 물 칸을 현장 전체에서 찾는다)
    let fx = -1, fy = -1;
    for (let i = 0; i < s.tiles.length && fx < 0; i++) if (s.tiles[i] === T.WATER) { const b = reachOf(s, i % s.w, (i / s.w) | 0, 4, cop); if (b && b.d > 2.4 && b.d <= 3.6) { fx = i % s.w; fy = (i / s.w) | 0; } }
    expect(fx).toBeGreaterThanOrEqual(0);
    set(cop, { x: fx, y: fy });
    const r = sim.responders[cop.rid];
    expect(chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)!.cands.find((q) => q.m === 'improvise')).toEqual({ m: 'improvise', score: expect.closeTo(0.5 * 0.6 * (0.8 + 0.4 * r.skills.rescue) * (sim.weather !== 'clear' ? 0.9 : 1), 9) });
    // 던져서 닿지 않는다 (다리를 끊고 건너편 물가 바로 아래 — 대원 쪽 물가에서 3.6칸 넘게): 헤엄을 못 치는 대원에게는 쓸 방법이 없다
    cutBridge(s);
    set(cop, { x, y: top });
    noSwim(sim, cop);
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
    expect(chooseMethod(sim, s, eng, 'waterRescue', tg, null, NO_SENSE)!).toMatchObject({ m: 'pole', why: 'noGear', missing: 'raft' });      // (1c) 장비를 따지지 않은 1등은 보트(위중 ×1.15) — 고무보트가 없다
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
    noSwim(sim, cop);      // (1b) 헤엄을 칠 수 있으면 위중한 대상에게는 헤엄이 이긴다 — 이 시험은 즉석 부력물을 본다
    for (const a of s.agents) a.beliefs.merge(casFact(sim, s, c, '시험'));
    const w = work(sim, s, 'waterRescue', { cas: c.id });
    const t = taskFor(cop, w);
    const p0 = peek(s.rng);
    runAlone(sim, s, I, cop, 90, () => (I.methods ?? []).some((u) => !u.ok));
    expect(t.method).toBe('improvise');
    const fold = I.methods!.find((u) => !u.ok)!;
    expect(fold).toMatchObject({ method: 'improvise', why: 'noGear', missing: 'raft' });      // (1c) 위중한 대상: 장비를 따지지 않은 1등은 보트
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
  it('쓸 방법이 없으면 맡지 않는다: 던져서 닿지 않는 대상을 헤엄을 못 치는 대원이 맡으면 nomethod 로 끝낸다 (작업은 다시 열린다)', () => {
    const { sim, I, s, role } = sceneWith('R2-NONE', 'water', ['patrol']);
    const cop = role('officer'), c = s.casualties[0];
    noSwim(sim, cop);
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
    const ADDED: Partial<Record<RoleId, KitId[]>> = { engineer: ['pole'], ladderOp: ['pole'], ropeTech: ['pfd', 'drysuit', 'raft'], airRescuer: ['pfd'], boatRescuer: ['pole', 'pfd', 'drysuit'], extricator: ['airbag'], rescueLead: ['shoring'] };      // 단계 1a · 단계 3
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
    // 지원 구조대의 로프 대원이 든 고무보트·유압 대원의 에어백(단계 3)은 그 지원 부대의 흐름 aid-r2:<n> 에서 뽑는다
    const sim = new Sim('RK0', { ...FULL, equipment: 1 });
    const I = createIncident(sim, { type: 'water', rng: sim.rng.fork('t') });
    sim.aidUsed = 3;
    const u = createAidUnit(sim, 'rescue', I)!;
    const rg = sim.rng.fork('aid-r2:3');
    let seen = 0;
    for (const rid of u.crew) for (const it of sim.responders[rid].kit!) if (KITS[it.id].batch === 'r2') { seen++; expect(!!it.fault).toBe(rg.chance(sim.tune.kitFault)); }
    expect(seen).toBe(u.crew.reduce((n, rid) => n + sim.responders[rid].kit!.filter((it) => KITS[it.id].batch === 'r2').length, 0));
    expect(seen).toBeGreaterThanOrEqual(2);
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

// ───────────────────────── 단계 1b: 수난 구조 — 헤엄·줄 확보·물 위의 바탕 (§3.5·§4.1, §8 의 3·4 가운데 1b 의 몫) ─────────────────────────
/** 물 현장에 대상 하나만 강 가운데 줄(물가에서 3칸)에 둔다. 다른 대상은 안전 구역으로 */
function oneVictim(seed: string, kinds: UnitKind[], health = 35, dy = 2): ReturnType<typeof sceneWith> & { c: Casualty; x: number; top: number } {
  const q = sceneWith(seed, 'water', kinds);
  const c = q.s.casualties[0];
  for (const o of q.s.casualties) if (o !== c) { o.inWater = false; o.where = 'safe'; }
  const x = 8, top = waterTop(q.s, x);
  c.x = c.px = x; c.y = c.py = top + dy; c.drift = 0; c.health = health; c.inWater = true; c.where = 'scene';
  for (const a of q.s.agents) a.beliefs.merge(casFact(q.sim, q.s, c, '시험'));
  return { ...q, c, x, top };
}
/** 헤엄을 잘 치는 몸으로 둔다 */
const goodSwimmer = (sim: Sim, a: FieldAgent): void => { const r = sim.responders[a.rid]; r.fitness = 0.9; r.skills.rescue = 0.5; r.stamina = 100; r.health = 100; };
/** 대원들을 한 틱씩 함께 돌린다 (지휘관·두뇌 없이 — 물살·눈·임무만. 대원 순서대로) */
function runMany(sim: Sim, s: Scene, I: Incident, as: FieldAgent[], sec: number, until: () => boolean, each?: () => void): void {
  for (let k = 0; k < sec * 5 && !until(); k++) {
    sim.tick++; sim.t = sim.tick * sim.dt;
    tickWater(sim, s, I); methodsRule(sim, s, I);
    for (const a of as) { perceive(sim, s, a); act(sim, s, a); }
    each?.();
  }
}
const onW = (s: Scene, a: FieldAgent): boolean => s.tiles[Math.round(a.y) * s.w + Math.round(a.x)] === T.WATER;

describe('R2 단계 1b: 헤엄의 조건과 위험 (§3.3·§3.5·§4.1)', () => {
  it('수영 능력: 문턱 0.35(구명조끼가 있으면 0.25) 아래면 헤엄을 고르지 않는다. 손이 닿는 대상(1.2칸 안)에도, 같은 대상에 이미 헤엄치는 동료가 있어도 고르지 않는다', () => {
    const { sim, s, c, of } = oneVictim('R2-SWIMOF', ['patrol']);
    const cop = of('patrol')[0], r = sim.responders[cop.rid];
    const tg = tgCas(c);
    const has = (): boolean => (chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)?.cands ?? []).some((q) => q.m === 'swim');
    strip(sim, cop.rid, 'pfd');
    for (const fit of [0, 0.2, 0.4, 0.6, 0.8, 1]) for (const res of [0, 0.3, 0.6]) {
      r.fitness = fit; r.skills.rescue = res;
      expect(has(), `fit ${fit} res ${res}`).toBe(swimOf(sim, cop) >= 0.35);
    }
    give(sim, cop.rid, 'pfd');
    for (const fit of [0, 0.2, 0.4]) { r.fitness = fit; r.skills.rescue = 0; expect(has(), `구명조끼 fit ${fit}`).toBe(swimOf(sim, cop) >= 0.25); }
    goodSwimmer(sim, cop);
    expect(has()).toBe(true);
    // 손이 닿는 거리(물가 바로 아래 줄)
    const top = waterTop(s, 8);
    cop.beliefs.merge(mkFact('cas', c.id, { ...(cop.beliefs.val<CasBelief>('cas', c.id)!), y: top }, '시험', sim.t + 1, 1, true, '시험')); sim.t += 1;
    expect(has()).toBe(false);
    cop.beliefs.merge(mkFact('cas', c.id, { ...(cop.beliefs.val<CasBelief>('cas', c.id)!), y: top + 2 }, '시험', sim.t + 1, 1, true, '시험')); sim.t += 1;
    // 같은 대상에 헤엄치는 동료가 있다
    const mate = of('patrol')[1];
    const w = work(sim, s, 'waterRescue', { cas: c.id, max: 2 });
    const mt = taskFor(mate, w); mt.method = 'swim';
    expect(has()).toBe(false);
    mt.method = 'rope';
    expect(has()).toBe(true);
  });
  it('점수: 위중 ×1.15 · 빠른 물살 ×0.6 · 던져서 닿지 않는 거리 ×1.3 · 안벽 ×0.8, 사람 배율 0.5 + 수영 능력, 위험 0.3 × 조심성. 다친 대원은 고르지 않는다', () => {
    const { sim, s, c, of } = oneVictim('R2-SWIMSC', ['patrol'], 80);
    const cop = of('patrol')[0];
    goodSwimmer(sim, cop);
    const tg = tgCas(c);
    const set = (v: Partial<CasBelief>): void => { cop.beliefs.merge(mkFact('cas', c.id, { ...(cop.beliefs.val<CasBelief>('cas', c.id)!), ...v }, '시험', sim.t + 1, 1, true, '시험')); sim.t += 1; };
    const sc = (): number => chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)!.cands.find((q) => q.m === 'swim')!.score;
    const base = 0.45 * (0.5 + swimOf(sim, cop)) * (1 - 0.3 * cautionOf(sim, cop));
    set({ band: 0, drift: 0 });
    expect(sc()).toBeCloseTo(base, 9);
    set({ band: 2 }); expect(sc()).toBeCloseTo(base * 1.15, 9);
    expect(chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)!).toMatchObject({ m: 'swim' });
    set({ band: 0, drift: 0.08 }); expect(sc()).toBeCloseTo(base * 0.6, 9);
    set({ drift: 0 }); s.quay = true; expect(sc()).toBeCloseTo(base * 0.8, 9); s.quay = false;
    // 다친 대원(걸을 수 있는 부상)은 위험이 있는 방법을 고르지 않는다
    sim.responders[cop.rid].status = 'injured';
    expect((chooseMethod(sim, s, cop, 'waterRescue', tg, null, NO_SENSE)?.cands ?? []).some((q) => q.m === 'swim')).toBe(false);
  });
  it('swimTrouble 은 수영 능력이 클수록·구명조끼·드라이슈트·줄 확보가 있으면 작고, 물살·밤·지침·끌고 오는 중이면 크다. 붙잡힘은 대상 체력 40 이하에서 0', () => {
    const b = swimTrouble(0.5, 0.2, false, false, false, false, false, false);
    expect(b).toBeCloseTo(0.010 * 1.0 * 1.3, 12);
    expect(swimTrouble(0.9, 0.2, false, false, false, false, false, false)).toBeLessThan(b);
    expect(swimTrouble(0.5, 0.2, true, false, false, false, false, false)).toBeCloseTo(b * 0.45, 12);
    expect(swimTrouble(0.5, 0.2, false, true, false, false, false, false)).toBeCloseTo(b * 0.7, 12);
    expect(swimTrouble(0.5, 0.2, false, false, true, false, false, false)).toBeCloseTo(b * 0.5, 12);
    expect(swimTrouble(0.5, 1, false, false, false, false, false, false)).toBeGreaterThan(b);
    expect(swimTrouble(0.5, 0.2, false, false, false, true, false, false)).toBeCloseTo(b * 2, 12);
    expect(swimTrouble(0.5, 0.2, false, false, false, false, true, false)).toBeCloseTo(b * 1.5, 12);
    expect(swimTrouble(0.5, 0.2, false, false, false, false, false, true)).toBeCloseTo(b * 1.3, 12);
    expect(clutchP(0.5, false, 40)).toBe(0); expect(clutchP(0.5, false, 10)).toBe(0);
    expect(clutchP(0.5, false, 41)).toBeCloseTo(0.15 * 0.7, 12); expect(clutchP(0.5, true, 90)).toBeCloseTo(0.15 * 0.7 * 0.5, 12);
    expect(clutchP(0.9, false, 90)).toBeLessThan(clutchP(0.4, false, 90));
  });
});

describe('R2 단계 1b: 헤엄과 줄 확보의 실행 (장면을 직접 만들어)', () => {
  it('헤엄: 줄이 없는 순찰 경관이 물가에서 준비하고 헤엄쳐 가 붙잡아 끌고 나온다 — 물 위에 있었고, 끝나면 뭍에 서 있으며 구한 방법·방법 기록·문구가 남는다', () => {
    const { sim, I, s, c, of } = oneVictim('R2-SWIM', ['patrol']);
    const cop = of('patrol')[0];
    goodSwimmer(sim, cop); give(sim, cop.rid, 'pfd'); give(sim, cop.rid, 'drysuit');
    const w = work(sim, s, 'waterRescue', { cas: c.id });
    const t = taskFor(cop, w);
    const n = sim.events.length;
    let wet = 0, phases = new Set<number>();
    runMany(sim, s, I, [cop], 90, () => !c.inWater || cop.task === null, () => { if (onW(s, cop)) wet++; phases.add(t.phase); });
    expect(t.method).toBe('swim');
    expect([...phases].sort()).toEqual([0, 1, 2, 3, 4]);
    expect(wet, '물 위에 있었다').toBeGreaterThan(5);
    expect(c.inWater).toBe(false); expect(c.freedHow).toBe('swim'); expect(c.freedBy).toBe(cop.rid);
    expect(s.tiles[Math.round(c.y) * s.w + Math.round(c.x)]).not.toBe(T.WATER);
    expect(onW(s, cop), '대원은 뭍에 서 있다').toBe(false); expect(cop.carrying).toBe(-1);
    expect(cop.wetSince, '물에 들어간 시각이 있었다').toBeDefined();
    runMany(sim, s, I, [cop], 0.2, () => false);
    expect(cop.wetSince, '뭍에 오르면 다음 틱에 지운다').toBeUndefined();
    const lines = texts(sim, n);
    expect(lines).toContain(`구조 대상 ${josa(c.label, '을/를')} 붙잡았습니다. 물가로 끌고 갑니다.`);
    expect(lines).toContain(`구조 대상 ${c.label}, 헤엄쳐 들어가 끌어냈습니다. 처치와 이송이 필요합니다.`);
    expect(I.methods!.filter((u) => u.ok)).toMatchObject([{ method: 'swim', work: 'waterRescue', cas: c.id, rid: cop.rid }]);
    expect(w.status).toBe('done');
    // 물 위의 피해는 체력 18 아래로 내리지 않는다 (사고가 없었으면 익수 피해만 — 구명조끼·드라이슈트로 줄었다)
    expect(sim.responders[cop.rid].health).toBeGreaterThanOrEqual(18);
  });
  it('줄 확보: 헤엄치는 동료가 있으면 구명줄을 든 대원은 던지지 않고 동료의 줄을 잡는다. 끌고 나오는 동료는 줄을 잡은 대원 쪽으로 온다', () => {
    const { sim, I, s, c, of, role } = oneVictim('R2-TEND', ['patrol', 'rescue']);
    const cop = of('patrol')[0], rope = role('ropeTech');
    goodSwimmer(sim, cop); give(sim, cop.rid, 'pfd'); give(sim, cop.rid, 'drysuit');
    const w = work(sim, s, 'waterRescue', { cas: c.id, max: 2 });
    const ts = taskFor(cop, w), tt = taskFor(rope, w);
    w.assignees.push(cop.rid, rope.rid);
    const n = sim.events.length;
    let tendSet = false, towTo: [number, number] | null = null, ropeAt: [number, number] | null = null;
    runMany(sim, s, I, [cop, rope], 90, () => !c.inWater, () => {
      if (tt.method === 'tend' && tt.phase >= 1) tendSet = true;
      if (ts.phase === 4 && towTo === null) { towTo = [ts.tx, ts.ty]; ropeAt = [Math.round(rope.x), Math.round(rope.y)]; }
    });
    expect(ts.method).toBe('swim');
    expect(tendSet, '줄 확보 자리를 잡았다').toBe(true);
    expect(texts(sim, n)).toContain('헤엄치는 동료의 줄을 잡겠습니다.');
    expect(towTo).toEqual(ropeAt);
    expect(c.freedHow).toBe('swim');
    // 대상이 물 밖이 되면 줄 확보도 끝난다 (다음 틱에)
    runMany(sim, s, I, [rope], 1, () => rope.task === null);
    expect(rope.task).toBeNull();
  });
  it('던지던 대원은 동료가 헤엄쳐 들어가면 3초 뒤 조건 상실(team)로 바꾼다 — 줄이 있으면 줄 확보, 남은 방법이 없으면 손을 뗀다(실패 횟수에 들지 않는다)', () => {
    const { sim, I, s, c, of, role } = oneVictim('R2-TEAM', ['patrol', 'rescue'], 80);
    const thrower = role('ropeTech'), cop = of('patrol')[0];
    const w = work(sim, s, 'waterRescue', { cas: c.id, max: 2 });
    const tt = taskFor(thrower, w);
    sim.tick = 4; sim.t = sim.tick * sim.dt;
    act(sim, s, thrower);
    expect(['rope', 'ring']).toContain(tt.method);
    goodSwimmer(sim, cop);
    const ts = taskFor(cop, w); ts.method = 'swim'; ts.mt0 = sim.t;      // 동료가 헤엄을 골랐다
    for (let k = 0; k < 25 && tt.method !== 'tend'; k++) { sim.tick++; sim.t = sim.tick * sim.dt; act(sim, s, thrower); }
    expect(tt.method).toBe('tend'); expect(tt.mwhy).toBe('team');
    expect(I.methods!.some((u) => !u.ok && u.why !== undefined && (u.method === 'rope' || u.method === 'ring'))).toBe(true);
    expect(w.fails).toBe(0);
    // 줄이 없고 손·장대가 닿지 않는 대원: 손을 뗀다 (preempt — 실패 횟수 그대로)
    const { sim: sim2, I: I2, s: s2, c: c2, of: of2 } = oneVictim('R2-TEAM2', ['patrol'], 80);
    const [p1, p2] = of2('patrol');
    noSwim(sim2, p1);
    const w2 = work(sim2, s2, 'waterRescue', { cas: c2.id, max: 2 });
    const t1 = taskFor(p1, w2);
    sim2.tick = 4; sim2.t = sim2.tick * sim2.dt;
    act(sim2, s2, p1);
    expect(t1.method).toBe('improvise');
    const t2 = taskFor(p2, w2); t2.method = 'swim'; t2.mt0 = sim2.t;
    for (let k = 0; k < 25 && p1.task !== null; k++) { sim2.tick++; sim2.t = sim2.tick * sim2.dt; act(sim2, s2, p1); }
    expect(p1.task).toBeNull(); expect(w2.fails).toBe(0);
    void I2;
  });
});

describe('R2 단계 1b: 물 위의 바탕 — 사고·하한·안전장치·가드 (§3.5)', () => {
  /** 헤엄 구조의 물에 들어간 단계(phase 2)에 대원을 물 칸에 세운다 */
  const inWater = (seed: string, health = 35) => {
    const q = oneVictim(seed, ['patrol'], health);
    const cop = q.of('patrol')[0];
    goodSwimmer(q.sim, cop);
    const w = work(q.sim, q.s, 'waterRescue', { cas: q.c.id });
    const t = taskFor(cop, w);
    t.method = 'swim'; t.mt0 = q.sim.t; t.phase = 2; t.range = 0.5;
    cop.x = cop.px = q.x - 1; cop.y = cop.py = q.top + 2;
    return { ...q, cop, w, t };
  };
  it('지침(지구력 8 이하): 헤엄 구조를 접고(METHOD_FAIL) 뭍으로 간다 — 그 대상의 헤엄·보트를 60초 기억한다. 피해는 체력 18 아래로 내리지 않는다', () => {
    const { sim, I, s, c, cop, w } = inWater('R2-TIRED');
    const r = sim.responders[cop.rid];
    r.stamina = 5; r.health = 24;
    expect(onW(s, cop)).toBe(true);
    sim.tick++; sim.t = sim.tick * sim.dt;
    waterTick(sim, s, I, cop, XK);
    const p = I.problems.find((q) => q.code === 'METHOD_FAIL')!;
    expect(p.detail).toBe('헤엄 구조 중 힘이 빠짐');
    expect(cop.task!.kind).toBe('ashore'); expect(cop.task!.startedAt).toBe(sim.t);
    const key = targetKey('waterRescue', tgCas(c));
    expect(cop.mfail!.filter((q) => q.k === key).map((q) => q.m).sort()).toEqual(['boat', 'swim']);
    expect(cop.mfail!.find((q) => q.m === 'swim')!.until).toBeCloseTo(sim.t + 60, 9);
    expect(r.health).toBeGreaterThanOrEqual(WATER_FLOOR);
    expect(w.fails).toBe(1); expect(w.assignees).toEqual([]);
    expect(I.methods!.at(-1)).toMatchObject({ method: 'swim', ok: false, eventId: p.eventId });
    // 지침 사고는 한 번 물에 들어갈 때 한 번
    const nf = I.problems.length;
    for (let k = 0; k < 10; k++) { sim.tick++; sim.t = sim.tick * sim.dt; waterTick(sim, s, I, cop, XK); }
    expect(I.problems.length).toBe(nf);
    expect(r.health).toBeGreaterThanOrEqual(WATER_FLOOR);
  });
  it('끌고 오던 중의 사고(위기 — 체력 30 아래): 대상을 그 자리 물에 놓친다(물속 그대로 다시 떠내려간다), 뭍으로', () => {
    const { sim, I, s, c, cop, t } = inWater('R2-CRISIS');
    c.x = cop.x; c.y = cop.y; c.where = 'carried'; cop.carrying = c.id; t.phase = 4;
    sim.responders[cop.rid].health = 29;
    sim.tick++; sim.t = sim.tick * sim.dt;
    waterTick(sim, s, I, cop, XK);
    expect(I.problems.find((q) => q.code === 'METHOD_FAIL')!.detail).toBe('헤엄 구조 중 물을 많이 먹음');
    expect(cop.carrying).toBe(-1);
    expect(c.where).toBe('scene'); expect(c.inWater).toBe(true); expect(s.tiles[c.y * s.w + c.x]).toBe(T.WATER);
    expect(cop.task!.kind).toBe('ashore');
    expect(sim.events.some((e) => e.text === '물을 많이 먹었습니다. 대상을 놓치고 뭍으로 돌아갑니다.')).toBe(true);
  });
  it('붙잡힘: 허우적댈 힘이 남은 대상(체력 40 초과)을 붙잡는 순간 붙잡힐 수 있다 — 판정은 방법 흐름(mrng)', () => {
    const { sim, I, s, c, cop, t } = inWater('R2-CLUTCH', 90);
    c.x = cop.x + 0.5; c.y = cop.y; t.phase = 3; t.progress = 1.45;
    const calls: number[] = [];
    cop.mrng = { next: () => 0.5, chance: (p: number) => { calls.push(p); return p > 0.03; }, range: (lo: number) => lo, int: (lo: number) => lo, pick: <V>(l: V[]) => l[0] } as unknown as Rng;
    sim.tick = 5; sim.t = sim.tick * sim.dt;
    act(sim, s, cop);
    expect(calls.some((p) => Math.abs(p - clutchP(swimOf(sim, cop), false, 90)) < 1e-12)).toBe(true);
    expect(I.problems.find((q) => q.code === 'METHOD_FAIL')!.detail).toBe('헤엄 구조 중 허우적대는 대상에게 붙잡힘');
    expect(c.where).toBe('scene'); expect(cop.task!.kind).toBe('ashore');
    // 체력 40 이하의 대상에게는 붙잡히지 않는다
    const q2 = inWater('R2-CLUTCH2', 40);
    q2.c.x = q2.cop.x + 0.5; q2.c.y = q2.cop.y; q2.t.phase = 3; q2.t.progress = 1.45;
    q2.cop.mrng = cop.mrng;
    q2.sim.tick = 5; q2.sim.t = q2.sim.tick * q2.sim.dt;
    act(q2.sim, q2.s, q2.cop);
    expect(q2.c.where).toBe('carried'); expect(q2.cop.carrying).toBe(q2.c.id); expect(q2.t.phase).toBe(4);
  });
  it('물 위의 익수 피해는 체력 18 에서 멈춘다 (매 틱 — 하한). 물 위에 150초 넘게 있으면 물가로 옮긴다(기록)', () => {
    const { sim, I, s, cop } = inWater('R2-FLOOR');
    const r = sim.responders[cop.rid];
    r.health = 19; r.stamina = 100;
    cop.mrng = { next: () => 0.99, chance: () => false, range: (lo: number) => lo } as unknown as Rng;
    for (let k = 0; k < 50; k++) { sim.tick++; sim.t = sim.tick * sim.dt; waterTick(sim, s, I, cop, XK); }
    expect(r.health).toBeCloseTo(WATER_FLOOR, 9);
    expect(cop.wetSince).toBeDefined();
    cop.wetSince = sim.t - 151;
    const n = sim.events.length;
    waterTick(sim, s, I, cop, XK);
    expect(onW(s, cop)).toBe(false); expect(cop.wetSince).toBeUndefined();
    expect(sim.events.slice(n).some((e) => e.truth && e.text === `물살에 밀려 ${r.name} 대원이 물가에 걸렸습니다.`)).toBe(true);
  });
  it('안전장치: 물 칸 위에 쓰러진 대원은 다음 틱 세계 규칙이 물가로 옮긴다. 보트에 탄 표시는 뭍 칸에서 풀린다', () => {
    const { sim, I, s, cop } = inWater('R2-DOWN');
    cop.status = 'down';
    expect(onW(s, cop)).toBe(true);
    methodsRule(sim, s, I);
    expect(onW(s, cop)).toBe(false);
    const other = s.agents.find((a) => a !== cop)!;
    other.afloat = 'boat';
    methodsRule(sim, s, I);
    expect(other.afloat).toBeUndefined();
  });
  it('가드: 물 위의 대원은 지금 맡은 수난 구조 말고는 맡지 않고(fitFor 0), 다른 임무 중이면 다음 판단에서 뭍으로 간다 — 뭍에 오르면 끝난다', () => {
    const { sim, I, s, c, cop, w } = inWater('R2-GUARD');
    const other = work(sim, s, 'search', { region: 0 });
    expect(fitFor(sim, s, cop, other)).toBe(0);
    expect(fitFor(sim, s, cop, w)).toBeGreaterThan(0);
    // 다른 임무(휴식) 중 물 위
    cop.task = makeTask('rehab', '휴식'); cop.task.startedAt = sim.t;
    cop.nextThink = 0;
    think(sim, s, cop);
    expect(cop.task!.kind).toBe('ashore');
    runMany(sim, s, I, [cop], 30, () => cop.task === null);
    expect(cop.task).toBeNull(); expect(onW(s, cop)).toBe(false);
    void c;
  });
  it('임무가 끝날 때 끌고 오던 사람: 물 칸이면 그 자리 물에 놓고, 뭍이면 뭍에 내려놓으며 완료·방법 기록을 남긴다', () => {
    const { sim, I, s, c, cop, t } = inWater('R2-DROP');
    c.where = 'carried'; cop.carrying = c.id; t.phase = 4;
    finishTask(sim, s, cop, false, 'preempt');
    expect(c.where).toBe('scene'); expect(c.inWater).toBe(true); expect(s.tiles[c.y * s.w + c.x]).toBe(T.WATER);
    const q = inWater('R2-DROP2');
    q.c.where = 'carried'; q.cop.carrying = q.c.id; q.t.phase = 4;
    q.cop.x = q.cop.px = q.x; q.cop.y = q.cop.py = q.top - 1;      // 물가 뭍 칸
    finishTask(q.sim, q.s, q.cop, false, 'preempt');
    expect(q.c.inWater).toBe(false); expect(q.c.freedHow).toBe('swim'); expect(q.s.tiles[q.c.y * q.s.w + q.c.x]).not.toBe(T.WATER);
    expect(q.I.methods!.some((u) => u.ok && u.method === 'swim' && u.cas === q.c.id)).toBe(true);
    void I;
  });
});

describe('R2 단계 1b: 강제 교대 — 물 위의 대원은 끝내 나온다 (§8 시험 4)', () => {
  /** 매 틱 대원을 살피며 교대를 끝까지 돌린다 */
  const watch = (seed: string, strip = false, diff: Difficulty = NORMAL) => {
    const sim = new Sim(seed, diff, 1200, { force: 'water/std' });
    const gone = (): void => { for (const r of sim.responders) for (const it of r.kit ?? []) if (it.id === 'rope' || it.id === 'ring' || it.id === 'pole') { it.fault = true; it.faultKnown = true; } };
    if (strip) gone();
    let n = sim.responders.length, steps = 0, swimTicks = 0;
    const bad: string[] = [];
    const wasDown = new Set<FieldAgent>();
    while (!sim.ended && steps++ < 20000) {
      sim.step();
      if (strip && sim.responders.length !== n) { gone(); n = sim.responders.length; }
      for (const s of sim.scenes) if (s && !s.archived) for (const a of s.agents) {
        if (a.status === 'left') continue;
        const wet = onW(s, a), r = sim.responders[a.rid];
        if (wasDown.has(a) && wet) bad.push(`${seed} t${sim.t.toFixed(1)} ${r.name} 쓰러진 다음 틱에도 물 칸`);
        if (a.status === 'down') wasDown.add(a); else wasDown.delete(a);
        if (!wet || a.status === 'down') continue;
        swimTicks++;
        if (sim.tick % 100 === 0 && r.health < WATER_FLOOR - 1e-9) bad.push(`${seed} t${sim.t.toFixed(1)} ${r.name} 물 위 체력 ${r.health.toFixed(1)}`);
        if (r.health < 30 && a.task && a.task.kind === 'waterRescue' && a.task.method === 'swim') bad.push(`${seed} t${sim.t.toFixed(1)} ${r.name} 체력 30 아래로 헤엄 구조를 계속`);
      }
    }
    for (const s of sim.scenes) if (s) {
      for (const a of s.agents) { if (a.status !== 'left' && onW(s, a)) bad.push(`${seed} 교대 끝 물 칸에 ${sim.responders[a.rid].name}`); if (a.afloat) bad.push(`${seed} 교대 끝 보트 위 ${sim.responders[a.rid].name}`); }
      // 닫힌 사건에 남은 부대·보관되지 않은 현장 (교대는 마지막 사건이 닫히는 그 순간 끝나므로 끝나기 90초 전에 닫힌 사건만 본다 — 그 사건의 부대는 아직 떠나는 중이다)
      const I = sim.incidents[s.incidentId];
      if (I.phase === 'closed' && I.closedAt !== undefined && I.closedAt < sim.t - 90) {
        for (const u of sim.units) if (u.state === 'onscene' && u.incidentId === I.id) bad.push(`${seed} 닫힌 사건 ${I.code} 에 남은 부대 ${u.callsign}`);
        if (!s.archived) bad.push(`${seed} 보관되지 않은 현장 ${I.code}`);
      }
    }
    return { sim, bad, swimTicks };
  };
  it('헤엄이 쓰인 교대에서: 물 위의 체력 18 하한, 쓰러지면 다음 틱에 물 밖, 체력 30 아래면 헤엄 구조를 접는다, 교대가 끝나면 물 위에 아무도 없다', () => {
    let swimTicks = 0, swims = 0;
    const bad: string[] = [];
    for (const [seed, strip] of [['W0', false], ['W1', false], ['W2', true], ['W3', true], ['W4', false], ['W5', true]] as [string, boolean][]) {
      const q = watch(seed, strip);
      bad.push(...q.bad); swimTicks += q.swimTicks;
      swims += usesOf([q.sim]).filter((u) => u.method === 'swim').length;
    }
    expect(bad).toEqual([]);
    expect(swims, '헤엄을 고른 기록').toBeGreaterThan(0);
    expect(swimTicks, '물 위에 대원이 있었다').toBeGreaterThan(50);
  }, 120000);
  it('3. 장면 밖에서도: 수난 강제 + 장비를 뺀 교대에서 헤엄으로 건진 사람이 있다 (W20 + STRIPPED)', () => {
    const set = new Set(rescued(usesOf([...W20().slice(0, 12), ...STRIPPED()])).map((u) => u.method));
    expect(set.has('swim')).toBe(true);
  });
});

// ───────────────────────── 단계 1c: 수난 구조 — 보트 (§4.1 boat, §8 시험 3 의 보트 장면) ─────────────────────────
describe('R2 단계 1c: 보트 (구조정·고무보트)', () => {
  /** 보트 장면: 위중한 대상(band 2) 하나를 강 가운데 줄(물가에서 3칸)에, 그 부대의 대원 하나만 움직인다 */
  const boatScene = (seed: string, kind: UnitKind, role: RoleId) => {
    const q = oneVictim(seed, [kind], 35);
    const a = q.role(role);
    const w = work(q.sim, q.s, 'waterRescue', { cas: q.c.id });
    const t = taskFor(a, w);
    return { ...q, a, w, t };
  };
  for (const [kind, role, launch] of [['boat', 'boatRescuer', BOAT.launchUnit], ['rescue', 'ropeTech', BOAT.launchRaft]] as [UnitKind, RoleId, number][]) {
    it(`${kind === 'boat' ? '구조정 대원' : '고무보트를 든 로프 대원'}: 위중한 대상에게 보트를 고르고, 띄운 틱에 물 칸 위 보트에 있고, 대상을 뭍에 내린 뒤 뭍 칸에 서서 보트에서 내린다`, () => {
      const { sim, I, s, c, a, w, t } = boatScene(`R2-BOAT-${kind}`, kind, role);
      const n = sim.events.length;
      let launchedAt = -1, launchWet = false, launchAfloat = false, carriedInBoat = false;
      runMany(sim, s, I, [a], 120, () => !c.inWater || a.task === null, () => {
        if (launchedAt < 0 && a.afloat === 'boat') { launchedAt = sim.t; launchWet = onW(s, a); launchAfloat = true; }
        if (c.where === 'carried' && a.afloat === 'boat' && Math.abs(c.x - a.x) < 1e-9 && Math.abs(c.y - a.y) < 1e-9) carriedInBoat = true;
      });
      expect(t.method).toBe('boat'); expect(t.mwhy).toBe('weak');
      expect(launchAfloat).toBe(true); expect(launchWet, '띄운 틱에 물 칸 위').toBe(true);
      expect(carriedInBoat, '끌어올린 사람은 보트 안에').toBe(true);
      expect(c.inWater).toBe(false); expect(c.freedHow).toBe('boat'); expect(c.freedBy).toBe(a.rid);
      expect(s.tiles[Math.round(c.y) * s.w + Math.round(c.x)]).not.toBe(T.WATER);
      expect(a.afloat).toBeUndefined(); expect(onW(s, a), '대원은 뭍 칸에').toBe(false);
      const lines = texts(sim, n);
      expect(lines[0]).toBe('대상이 줄을 잡을 힘이 없습니다. 보트를 띄우겠습니다.');
      expect(lines).toContain('보트를 띄웠습니다.');
      expect(lines).toContain(`구조 대상 ${josa(c.label, '을/를')} 보트에 끌어올렸습니다. 물가로 돌아갑니다.`);
      expect(lines).toContain(`구조 대상 ${c.label}, 보트로 다가가 끌어냈습니다. 처치와 이송이 필요합니다.`);
      expect(I.methods!.filter((u) => u.ok)).toMatchObject([{ method: 'boat', why: 'weak', cas: c.id, rid: a.rid }]);
      expect(w.status).toBe('done');
      // 진수 시간: 진수 지점에 닿은 뒤 (구조정 8초 · 고무보트 14초) — 띄운 시각은 방법을 고른 뒤 그 시간보다 늦다
      expect(launchedAt - t.mt0!).toBeGreaterThanOrEqual(launch - 1e-9);
    });
  }
  it('보트 비용: 물 칸만 지난다(뭍 칸 -1) — 보트로 뭍에 대는 이동은 뭍 칸 둘레의 물 칸에서 멈춘다', () => {
    const { s, x, top } = oneVictim('R2-BCOST', ['rescue']);
    const f = boatCost(s);
    expect(f(top * s.w + x)).toBe(0); expect(f((top - 1) * s.w + x)).toBe(-1);
  });
  it('한 부대에 보트는 한 척: 같은 부대의 동료가 보트를 쓰는 중이면 보트를 고르지 않는다. 다친 대원은 고르지 않는다(위험 0.08)', () => {
    const { sim, s, c, of } = oneVictim('R2-BONE', ['boat'], 35);
    const [b1, b2] = of('boat');
    const tg = tgCas(c);
    const has = (a: FieldAgent): boolean => (chooseMethod(sim, s, a, 'waterRescue', tg, null, NO_SENSE)?.cands ?? []).some((q) => q.m === 'boat');
    expect(has(b2)).toBe(true);
    const w = work(sim, s, 'waterRescue', { cas: c.id });
    taskFor(b1, w).method = 'boat';
    expect(has(b2)).toBe(false);
    b1.task!.method = 'rope';
    expect(has(b2)).toBe(true);
    sim.responders[b2.rid].status = 'injured';
    expect(has(b2)).toBe(false);
  });
  it('고무보트의 숨은 고장은 띄우기 시작할 때 드러난다 — 장비 고장(EQUIP_FAIL) 뒤 다른 방법으로, 고장의 기억은 끝까지', () => {
    const { sim, I, s, c, a, t } = boatScene('R2-BFAULT', 'rescue', 'ropeTech');
    sim.responders[a.rid].kit!.find((it) => it.id === 'raft')!.fault = true;
    runMany(sim, s, I, [a], 60, () => t.method !== undefined && t.method !== 'boat');
    expect(I.problems.some((p) => p.code === 'EQUIP_FAIL')).toBe(true);
    expect(I.methods![0]).toMatchObject({ method: 'boat', ok: false });
    expect(t.mwhy).toBe('broken'); expect(t.method).not.toBe('boat');
    expect(a.mfail!.find((q) => q.m === 'boat')!.until).toBe(Infinity);
    expect(kitCount(sim, a.rid, 'raft')).toBe(0);
    void c;
  });
  it('보트 전복: 보트에서 떨어져 그 자리 물에 빠지고(다음 틱부터 헤엄 중), 실은 사람을 놓치며, 보트 구조를 접고 뭍으로 간다', () => {
    const { sim, I, s, c, a, t } = boatScene('R2-BFLIP', 'boat', 'boatRescuer');
    t.method = 'boat'; t.mt0 = sim.t; t.phase = 3; t.range = 0.5; t.tx = 8; t.ty = waterTop(s, 8) - 1;
    a.x = a.px = 8; a.y = a.py = waterTop(s, 8) + 2; a.afloat = 'boat';
    c.x = a.x; c.y = a.y; c.where = 'carried'; a.carrying = c.id;
    a.mrng = { next: () => 0.5, chance: () => true, range: (lo: number) => lo } as unknown as Rng;
    sim.tick++; sim.t = sim.tick * sim.dt;
    waterTick(sim, s, I, a, XK);
    expect(a.afloat).toBeUndefined(); expect(onWater(s, a)).toBe(true);
    expect(c.where).toBe('scene'); expect(c.inWater).toBe(true); expect(a.carrying).toBe(-1);
    expect(I.problems.find((p) => p.code === 'METHOD_FAIL')!.detail).toBe('보트 구조 중 보트 전복');
    expect(sim.events.some((e) => e.text === '보트가 뒤집혔습니다! 물에 빠졌습니다.')).toBe(true);
    expect(a.task!.kind).toBe('ashore');
    const key = targetKey('waterRescue', tgCas(c));
    expect(a.mfail!.filter((q) => q.k === key).map((q) => q.m).sort()).toEqual(['boat', 'swim']);
  });
  it('물 위의 보트 대원이 다른 임무 중이면 뭍으로(case ashore 의 보트 갈래): 뭍 칸 둘레의 물 칸까지 와서 뭍에 오르고 보트에서 내린다', () => {
    const { sim, I, s, a } = boatScene('R2-BASHORE', 'boat', 'boatRescuer');
    a.task = null;
    a.x = a.px = 8; a.y = a.py = waterTop(s, 8) + 2; a.afloat = 'boat';
    a.nextThink = 0;
    think(sim, s, a);
    expect(a.task!.kind).toBe('ashore');
    runMany(sim, s, I, [a], 30, () => a.task === null);
    expect(a.task).toBeNull(); expect(a.afloat).toBeUndefined(); expect(onW(s, a)).toBe(false);
  });
  it('상공의 호이스트는 헤엄·보트 대원이 끌고 오는 대상을 기다린다 (진행하지 않고 그 위에서), 놓으면 다시 끌어올린다', () => {
    let seed = '';
    for (let k = 0; k < 40 && !seed; k++) { const q = new Sim('R2-AIR' + k, FULL); if (q.weather === 'clear') seed = 'R2-AIR' + k; }
    const sim = new Sim(seed, FULL);
    const I = createIncident(sim, { type: 'water', rng: sim.rng.fork('t') });
    const s = sim.scenes[I.id]!;
    I.reportedAt = sim.t; I.phase = 'dispatched';
    const heli = sim.units.find((u) => u.kind === 'heli')!;
    heli.state = 'onscene'; heli.incidentId = I.id; I.assigned.push(heli.id); I.everAssigned.push(heli.id); unitArrived(sim, I, heli);
    const step = (): void => { sim.tick++; sim.t = sim.tick * sim.dt; tickUnits(sim); tickScene(sim, s); };
    for (let k = 0; k < 5 * 60 && !(s.air && s.air[0] && s.air[0].mode === 'hoist' && s.air[0].phase === 'work' && s.air[0].progress > 1); k++) step();
    const op = s.air![0];
    expect(op.mode).toBe('hoist');
    const c = s.casualties[op.target];
    op.eye.nextThink = sim.t + 1000;      // 관측자가 다시 고르지 않게 (기다리는 줄만 본다)
    c.where = 'carried';
    const p0 = op.progress;
    for (let k = 0; k < 25; k++) step();
    expect(op.phase).toBe('hover'); expect(op.progress).toBeLessThan(p0); expect(sim.airStats.hoists).toBe(0);
    expect(c.where).toBe('carried'); expect(c.inWater).toBe(true);
    c.where = 'scene';
    for (let k = 0; k < 5 * 60 && sim.airStats.hoists === 0; k++) step();
    expect(sim.airStats.hoists).toBe(1); expect(c.freedHow).toBe('hoist');
  });
});

describe('R2 단계 1c: 강제 교대 — 해일에서 보트가 쓰이고, 물 위의 대원은 끝내 나온다', () => {
  it('해일 교대에서 보트로 건진 사람이 있고, 교대가 끝나면 보트 위·물 칸 위에 아무도 없다', () => {
    let boats = 0;
    const bad: string[] = [];
    for (const seed of ['S3', 'S4', 'S8']) {
      const sim = new Sim(seed, { ...NORMAL, disaster: parseDisaster('tsunami')! }, 1200);
      sim.runToEnd();
      boats += usesOf([sim]).filter((u) => u.ok && u.method === 'boat').length;
      for (const s of sim.scenes) if (s) for (const a of s.agents) {
        if (a.afloat) bad.push(`${seed} ${sim.responders[a.rid].name} 보트 위`);
        if (a.status !== 'left' && onW(s, a)) bad.push(`${seed} ${sim.responders[a.rid].name} 물 칸`);
      }
    }
    expect(bad).toEqual([]);
    expect(boats, '보트로 건진 사람').toBeGreaterThan(0);
  }, 120000);
});

// ───────────────────────── 단계 1d: 수난 그림 (§3.7 — 화면은 상태를 읽기만 한다) ─────────────────────────
describe('R2 단계 1d: 수난 그림 (methodsLayer · 헤엄치는 대원 · 보트 · 자세)', () => {
  it('보트·줄·장대·줄 확보의 그림 함수는 예외 없이 끝나고 시뮬레이션 상태를 바꾸지 않는다 (판단·실행 함수를 부르지 않는다)', () => {
    const { sim, s, c, of, role } = oneVictim('R2-DRAW', ['patrol', 'rescue', 'boat'], 35);
    const [cop, cop2] = of('patrol'), rope = role('ropeTech'), boatman = role('boatRescuer'), eng = of('rescue').find((a) => a !== rope)!;
    const w = work(sim, s, 'waterRescue', { cas: c.id, max: 5 });
    const top = waterTop(s, 8);
    // 헤엄치는 대원 · 줄 확보 · 던지는 대원(놓은 뒤) · 장대 · 보트
    const tw = taskFor(cop, w); tw.method = 'swim'; tw.phase = 2; cop.x = cop.px = 8; cop.y = cop.py = top + 1;
    const tt = taskFor(rope, w); tt.method = 'tend'; tt.phase = 1; rope.x = rope.px = 8; rope.y = rope.py = top - 1;
    const tr = taskFor(cop2, w); tr.method = 'improvise'; tr.phase = 0; cop2.ring = 0.9; cop2.x = cop2.px = 9; cop2.y = cop2.py = top - 1;
    const tp = taskFor(eng, w); tp.method = 'pole'; eng.ring = 0.5; eng.x = eng.px = 7; eng.y = eng.py = top - 1;
    const tb = taskFor(boatman, w); tb.method = 'boat'; tb.phase = 3; boatman.x = boatman.px = 10; boatman.y = boatman.py = top + 2; boatman.afloat = 'boat';
    expect(swimming(s, cop)).toBe(true); expect(swimming(s, rope)).toBe(false); expect(inBoat(boatman)).toBe(true); expect(swimming(s, boatman)).toBe(false);
    const snap = (): string => JSON.stringify([sim.logHash, sim.events.length, peek(sim.rng), peek(s.rng), s.agents.map((a) => [a.x, a.y, a.afloat, a.task && a.task.method, a.ring, a.mrng === undefined]), s.casualties.map((q) => [q.x, q.y, q.where])]);
    const before = snap();
    const g = fakeCtx();
    for (const tr2 of [0.2, THROW_RELEASE + 0.01, 1]) { cop2.ring = tr2; drawBoats(g, sim, s, 24, 0.5, 1.3); drawMethodFx(g, s, 24, 0.5); }
    tr.phase = 1; drawMethodFx(g, s, 24, 1);      // 다시 감는 중
    const lk = responderLook('fire', 'engine', 3, 'firefighter');
    for (const arms of ['reach', 'hold', 'throw'] as const) for (const item of ['rope', 'ring', 'pole', 'cloth', 'none'] as const) drawPerson(g, 10, 10, 0.3, 24, lk, { step: 0, moving: false, arms, item, t: 1, act: 0.3 });
    drawSwimmer(g, 10, 10, 24, lk, 1, 1, '#f07a2a'); drawSwimmer(g, 10, 10, 24, lk, 1, 1);
    cop2.ring = 0.9; tr.phase = 0;      // 시험이 바꾼 그림 입력을 되돌린다
    expect(snap()).toBe(before);
    void tp; void tb;
  });
  it('화면의 그림 파일은 판단·실행 함수와 장비의 효과 함수를 부르지 않는다 (methodsLayer)', () => {
    const src = code('../src/view/scene/methodsLayer.ts');
    for (const bad of ['chooseMethod', 'methodFit', 'startMethod', 'switchMethod', 'recordMethod', 'runWaterRescue', 'waterTick', 'pullAshore', 'kitWorks', 'useKit', 'toolUse', 'mrng']) expect(src.includes(bad), bad).toBe(false);
    const imports = src.split('\n').filter((l) => /^\s*import\b/.test(l)).join('\n');
    for (const bad of ['methodRun', 'executor', "/methods'", 'agents', 'brain']) expect(imports.includes(bad), bad).toBe(false);
  });
});

// ───────────────────────── 단계 2: 문·통로와 폭파 진입 (§4.2·§4.2a) ─────────────────────────
/** 무장(강도) 현장의 문 장면: 잠긴 방 문 하나(hp), 그 앞(복도 쪽)에 대원. 구조 대상은 모두 안전 구역에, 용의자는 검거된 채 멀리 — 믿음은 비어 있다 */
function doorScene(seed: string, kinds: UnitKind[], hp = 17, what = 'armed/robbery'): { sim: Sim; I: Incident; s: Scene; door: Prop; tile: number; of: (kind: UnitKind) => FieldAgent[]; role: (r: RoleId) => FieldAgent; place: (a: FieldAgent) => void; know: (a: FieldAgent) => void } {
  const sim = new Sim(seed, FULL);
  for (const r of sim.responders) for (const it of r.kit!) it.fault = false;
  const [type, variant] = what.split('/');
  const I = createIncident(sim, { type: type as IncidentType, variant: variant || undefined, rng: sim.rng.fork('t') });
  const s = sim.scenes[I.id]!;
  for (const kind of kinds) unitArrived(sim, I, sim.units.find((u) => u.kind === kind)!);
  for (const c of s.casualties) { c.where = 'safe'; c.x = c.px = s.safe.x; c.y = c.py = s.safe.y; }
  for (const h of s.hostiles) { h.state = 'arrested'; h.x = h.px = 2; h.y = h.py = 16; }
  // 위아래가 바닥이고 좌우가 벽인, 출입구에서 먼 문 (방 문)
  const door = s.props.find((p) => p.kind === 'door' && !s.exits.some((e) => Math.hypot(e.x - p.x, e.y - p.y) <= 2) && staticPass(s.tiles[(p.y - 1) * s.w + p.x]) && staticPass(s.tiles[(p.y + 1) * s.w + p.x]) && !staticPass(s.tiles[p.y * s.w + p.x - 1]))!;
  lockDoor(s, door, hp);
  s.staticVersion++;
  const tile = door.y * s.w + door.x;
  const place = (a: FieldAgent): void => { a.x = a.px = door.x; a.y = a.py = door.y + 1; a.path = null; a.status = 'active'; };
  const know = (a: FieldAgent): void => { a.beliefs.merge(mkFact('blk', tile, 'locked', '시험', sim.t, 1, true, '문이 잠겨 있음')); };
  return { sim, I, s, door, tile, of: (kind) => s.agents.filter((a) => sim.units[a.unitId].kind === kind), role: (r) => s.agents.find((a) => sim.responders[a.rid].role === r)!, place, know };
}
/** 문 장면을 한 대원만 돌린다 (지휘관·두뇌·세계 규칙 없이 — 눈과 임무만). 나머지 대원은 현장 밖으로 */
function soloDoor(q: ReturnType<typeof doorScene>, a: FieldAgent, sec: number, until: () => boolean, each?: () => void): void {
  for (let k = 0; k < sec * 5 && !until(); k++) { q.sim.tick++; q.sim.t = q.sim.tick * q.sim.dt; perceive(q.sim, q.s, a); act(q.sim, q.s, a); each?.(); }
}
const tgTile = (q: { door: Prop; tile: number }): MTarget => ({ cas: -1, prop: q.door.id, hostile: -1, region: -1, tile: q.tile });

describe('R2 단계 2: 문·통로의 방법 (§4.2)', () => {
  it('고르는 규칙: 유압 구조기 > 할리건 > 충격기(경찰 0.9) > 발로 차기 — 장비가 없으면 발로 차기·손으로 치우기가 늘 남는다. 무장 현장의 대치 중에는 시끄러운 방법 ×0.7 (까닭 quiet)', () => {
    const q = doorScene('R2-DOOR', ['rescue', 'patrol', 'engine', 'swat']);
    const ext = q.role('extricator'), lead = q.role('fireLead'), cop = q.role('officer'), br = q.role('breacher');
    for (const a of [ext, lead, cop, br]) q.know(a);
    const pick = (a: FieldAgent, work: WorkKind = 'force'): MethodId | undefined => chooseMethod(q.sim, q.s, a, work, tgTile(q), null, NO_SENSE)?.m;
    expect(pick(ext)).toBe('hydraulic'); expect(pick(lead)).toBe('irons'); expect(pick(cop)).toBe('kick'); expect(pick(br)).toBe('ram');      // 진입 전 무장 현장: 폭파는 고르지 않는다
    expect(pick(cop, 'clear')).toBe('handClear'); expect(pick(lead, 'clear')).toBe('toolClear');
    // 시끄러운 방법: 무장 현장에서 믿음에 대치 중인 용의자가 있으면 ×0.7 — 유압 구조기와 충격기를 함께 든 대원은 유압 개방기 (까닭 quiet)
    give(q.sim, br.rid, 'spreader');
    expect(pick(br)).toBe('ram');      // 경찰의 충격기 0.9 = 유압 0.9 — 같은 점수면 표의 순서
    br.beliefs.merge(mkFact('hos', 0, { x: 2, y: 2, state: 'hold', weapon: 'gun', hostage: false, hidden: false }, '시험', q.sim.t, 1, true, '용의자'));
    const p = chooseMethod(q.sim, q.s, br, 'force', tgTile(q), null, NO_SENSE)!;
    expect(p.m).toBe('hydraulic'); expect(p.why).toBe('quiet');
    expect(p.cands.find((c) => c.m === 'ram')!.score).toBeCloseTo(0.9 * 0.7, 6);
  });
  it('속도는 고른 방법의 장비 값 (R1 의 식에서 toolFor 자리) — 발로 차기 맨손, 충격기 +0.3, 유압 개방기 ×1.6, 손으로 치우기 맨손', () => {
    const q = doorScene('R2-DOOR', ['rescue', 'patrol']);
    const cop = q.role('officer'), r = q.sim.responders[cop.rid];
    const t = makeTask('force', '시험'); t.tile = q.tile;
    const f = (tool: number): number => 0.6 + 0.6 * r.skills.rescue + 0.6 * tool + 0.3 * r.skills.law;
    const tm = q.sim.tune.toolMul;
    for (const [m, v] of [['kick', f(BARE_HANDS)], ['irons', f(Math.min(1.15, 0.9 * tm))], ['ram', f(Math.min(1.15, 1.0 * tm)) + 0.3], ['hydraulic', f(Math.min(1.15, 0.8 * tm)) * 1.6]] as [MethodId, number][]) {
      t.method = m; expect(blockerRate(q.sim, q.s, cop, t, q.I), m).toBeCloseTo(v, 9);
    }
    t.kind = 'clear'; t.method = 'handClear';
    expect(blockerRate(q.sim, q.s, cop, t, q.I)).toBeCloseTo(0.5 + 0.8 * r.skills.rescue + 0.5 * BARE_HANDS, 9);
  });
  it('문을 연 방법이 완료 문구·진입 기록(G5 how)·방법 기록(대상은 그 칸과 소품)에 남는다 — 할리건', () => {
    const q = doorScene('R2-DOOR', ['engine']);
    const lead = q.role('fireLead');
    for (const a of q.s.agents) if (a !== lead) a.status = 'left';
    q.place(lead); q.know(lead);
    const w = work(q.sim, q.s, 'force', { tile: q.tile });
    const t = taskFor(lead, w);
    const n = q.sim.events.length;
    soloDoor(q, lead, 30, () => q.s.propAt[q.tile] < 0);
    expect(q.s.propAt[q.tile]).toBe(-1); expect(q.door.open).toBe(true);
    expect(t.method).toBe('irons');
    expect(texts(q.sim, n)).toContain('할리건으로 문을 땄습니다. 진입합니다.');
    expect(q.s.fx.filter((f) => f.kind === 'breach' && f.c?.door === q.door.id).map((f) => f.c!.how)).toEqual(['irons']);
    expect(q.I.methods!.filter((u) => u.ok)).toMatchObject([{ method: 'irons', work: 'force', tile: q.tile, prop: q.door.id, rid: lead.rid }]);
  });
  it('예 6: 유압 구조기에 숨은 고장 → 장비 고장 기록 뒤 발로 차기로 바꾸고, 문을 열면 그 장비 고장이 복구된다', () => {
    const q = doorScene('R2-DOOR', ['rescue']);
    const ext = q.role('extricator');
    for (const a of q.s.agents) if (a !== ext) a.status = 'left';
    strip(q.sim, ext.rid, 'irons', 'lightRescue', 'breachKit');
    q.sim.responders[ext.rid].kit!.find((it) => it.id === 'spreader')!.fault = true;      // 숨은 고장
    q.place(ext); q.know(ext);
    const t = taskFor(ext, work(q.sim, q.s, 'force', { tile: q.tile }));
    const n = q.sim.events.length;
    soloDoor(q, ext, 40, () => q.s.propAt[q.tile] < 0);
    expect(q.s.propAt[q.tile]).toBe(-1);
    expect(t.method).toBe('kick'); expect(t.mwhy).toBe('broken');
    const tx = texts(q.sim, n);
    expect(tx).toContain('장비 없이 문을 걷어차 열겠습니다.');
    expect(tx).toContain('문을 걷어차 열었습니다. 진입합니다.');
    const ef = q.I.problems.find((p) => p.code === 'EQUIP_FAIL')!;
    expect(ef.recovered).toBe(true); expect(ef.recoveryText).toContain('발로 차');
    expect(q.I.methods!.map((u) => [u.method, u.ok])).toEqual([['hydraulic', false], ['kick', true]]);
    expect(q.I.methods![0].eventId).toBe(ef.eventId);
  });
});

describe('R2 단계 2: 폭파 진입 (§4.2a — 사용자 결정, 시험 10)', () => {
  /** 진입이 정해진 무장 현장에서 장약을 든 진입대원(파괴) 하나만 그 문의 force 를 맡는다 */
  const charger = (seed = 'R2-DOOR'): ReturnType<typeof doorScene> & { br: FieldAgent } => {
    const q = doorScene(seed, ['swat']);
    const br = q.role('breacher');
    for (const a of q.s.agents) if (a !== br) a.status = 'left';
    q.s.entryOrdered = true;
    q.place(br); q.know(br);
    return { ...q, br };
  };
  it('장약을 든 진입대원이 잠긴 문(hp 17)을 폭파로 연다: 까닭 usual, 설치부터 열리기까지 6.5초 + 물러서는 걸음, 장약 하나가 줄고 진입 기록은 how charge·forced', () => {
    const q = charger();
    const t = taskFor(q.br, work(q.sim, q.s, 'force', { tile: q.tile }));
    const kit0 = kitCount(q.sim, q.br.rid, 'charge');
    let t0 = -1, walk0 = -1, walk1 = -1;
    soloDoor(q, q.br, 40, () => q.s.propAt[q.tile] < 0, () => {
      if (t0 < 0 && t.method === 'charge') t0 = q.sim.t - q.sim.dt;      // 고른 그 틱부터 설치 (진행도가 이미 한 틱 들어갔다)
      if (walk0 < 0 && t.phase === 1) walk0 = q.sim.t;
      if (walk1 < 0 && t.phase >= 2) walk1 = q.sim.t;
    });
    expect(q.s.propAt[q.tile]).toBe(-1);
    expect(t.mwhy).toBe('usual');
    const open = q.sim.t;
    expect(Math.abs(open - t0 - (6.5 + (walk1 - walk0)))).toBeLessThanOrEqual(0.4 + 1e-9);
    expect(kitCount(q.sim, q.br.rid, 'charge')).toBe(kit0 - 1);
    const bf = q.s.fx.filter((f) => f.kind === 'breach' && f.c?.door === q.door.id);
    expect(bf.map((f) => [f.c!.how, f.c!.forced])).toEqual([['charge', true]]);
    expect(Math.hypot(q.br.x - q.door.x, q.br.y - q.door.y)).toBeGreaterThanOrEqual(3 - 1e-6);      // 물러선 자리에서 터뜨렸다
    expect(q.I.methods!.filter((u) => u.ok)).toMatchObject([{ method: 'charge', work: 'force', tile: q.tile, why: 'usual' }]);
    expect(texts(q.sim, 0)).toContain('장약 설치합니다. 물러서십시오.');
    expect(texts(q.sim, 0)).toContain('폭파 — 문 개방. 진입합니다.');
    expect(q.I.problems.some((p) => p.code === 'ESCALATION')).toBe(false);
  });
  it('믿음에 없던 사람이 문 1칸 뒤에 있으면 폭발(원인 blast)에 다치고 ESCALATION 한 줄이 남는다 — 믿음에 넣으면 폭파를 고르지 않는다(충격기)', () => {
    const q = charger();
    const c = q.s.casualties[0];
    c.where = 'scene'; c.x = c.px = q.door.x; c.y = c.py = q.door.y - 1; c.health = 90;
    // 같은 장면에서 그 사람을 믿음에 넣으면: 문 2.5칸 안에 사람 → 폭파가 아니다(충격기)
    const q2 = charger();
    expect(chooseMethod(q2.sim, q2.s, q2.br, 'force', tgTile(q2), null, NO_SENSE)!.m).toBe('charge');
    const c2 = q2.s.casualties[0]; c2.where = 'scene'; c2.x = c2.px = q2.door.x; c2.y = c2.py = q2.door.y - 1;
    q2.br.beliefs.merge(casFact(q2.sim, q2.s, c2, '시험'));
    expect(chooseMethod(q2.sim, q2.s, q2.br, 'force', tgTile(q2), null, NO_SENSE)!.m).toBe('ram');
    // 믿음에 없으면 터뜨리고, 문 뒤의 그 사람이 다친다
    taskFor(q.br, work(q.sim, q.s, 'force', { tile: q.tile }));
    soloDoor(q, q.br, 40, () => q.s.propAt[q.tile] < 0);
    expect(q.s.propAt[q.tile]).toBe(-1);
    expect(c.health).toBeLessThan(90);
    expect((c.injuries ?? []).some((j) => j.cause === 'blast')).toBe(true);
    const esc = q.I.problems.filter((p) => p.code === 'ESCALATION');
    expect(esc.length).toBe(1); expect(esc[0].detail).toContain('폭파 진입으로');
    const done = q.I.methods!.find((u) => u.method === 'charge' && u.ok)!;
    expect(q.sim.events[esc[0].eventId].causes).toContain(done.eventId);
  });
  it('가스 조짐(단계 1)·6칸 안의 살아 있는 장치·붕괴 현장·진입 전에는 고르지 않는다', () => {
    const q = charger();
    const tg = tgTile(q), pick = (): MethodId | undefined => chooseMethod(q.sim, q.s, q.br, 'force', tg, null, NO_SENSE)?.m;
    expect(pick()).toBe('charge');
    q.s.entryOrdered = false; expect(pick()).toBe('ram'); q.s.entryOrdered = true; expect(pick()).toBe('charge');
    q.br.beliefs.merge(mkFact('sign', 9001, { kind: 'gas', level: 1, region: -1, x: q.door.x + 3, y: q.door.y }, '시험', q.sim.t, 1, true, '가스 냄새'));
    expect(pick()).toBe('ram');
    const q2 = charger();
    q2.br.beliefs.merge(mkFact('haz', 900, { kind: 'bomb', active: true, x: q2.door.x + 4, y: q2.door.y }, '시험', q2.sim.t, 1, true, '폭발물'));
    expect(chooseMethod(q2.sim, q2.s, q2.br, 'force', tgTile(q2), null, NO_SENSE)!.m).toBe('ram');
    q2.br.beliefs.merge(mkFact('haz', 900, { kind: 'bomb', active: false, x: q2.door.x + 4, y: q2.door.y }, '시험', q2.sim.t + 1, 1, true, '해체'));
    expect(chooseMethod(q2.sim, q2.s, q2.br, 'force', tgTile(q2), null, NO_SENSE)!.m).toBe('charge');
    // 다친 대원은 위험한 방법(risk 0.1)을 고르지 않는다
    q2.sim.responders[q2.br.rid].status = 'injured';
    expect(chooseMethod(q2.sim, q2.s, q2.br, 'force', tgTile(q2), null, NO_SENSE)!.m).toBe('ram');
  });
  it('반경 안에 다른 대원이 서 있으면 카운트를 시작하지 않고, 10초 뒤 다른 방법으로 바꾼다 (METHOD_FAIL 이 아니라 조건 상실 team)', () => {
    const q = charger();
    const other = q.s.agents.find((a) => a !== q.br)!;
    other.status = 'active'; other.task = null; other.x = other.px = q.door.x; other.y = other.py = q.door.y + 2;      // 문 2칸 앞
    const t = taskFor(q.br, work(q.sim, q.s, 'force', { tile: q.tile }));
    const n = q.sim.events.length;
    soloDoor(q, q.br, 30, () => t.method !== 'charge' && t.method !== undefined);
    expect(t.method).toBe('ram'); expect(t.mwhy).toBe('team');
    expect(q.s.propAt[q.tile]).toBe(q.door.id);      // 터뜨리지 않았다
    expect(kitCount(q.sim, q.br.rid, 'charge')).toBe(2);
    expect(q.I.problems.some((p) => p.code === 'METHOD_FAIL')).toBe(false);
    expect(texts(q.sim, n).some((x) => x.startsWith('동료가 폭파 반경 안.'))).toBe(true);
    expect(q.br.mfail!.some((f) => f.m === 'charge' && f.k === targetKey('force', tgTile(q)))).toBe(true);
    expect(q.I.methods!.map((u) => [u.method, u.ok])).toEqual([['charge', false]]);
  });
  it('stackSpot: 대원 쪽의 걸어서 닿는 바닥 칸 가운데 문에서 3~4칸, 통로의 축 위가 아닌 칸', () => {
    const q = charger();
    const sp = stackSpot(q.s, q.tile, q.br)!;
    const d = Math.hypot(sp.x - q.door.x, sp.y - q.door.y);
    expect(d).toBeGreaterThanOrEqual(3); expect(d).toBeLessThanOrEqual(4.5);
    expect(sp.x).not.toBe(q.door.x);
    expect(sp.y).toBeGreaterThan(q.door.y);      // 대원 쪽(문 아래)
    expect(staticPass(q.s.tiles[sp.y * q.s.w + sp.x])).toBe(true);
  });
});

describe('R2 단계 2: 농성 문 잠금과 방 진입의 잠긴 문 (§4.2a)', () => {
  it('농성 문 잠금: 인질을 붙잡은 총기 용의자의 방에 문이 하나뿐이면, 첫 대원이 내린 뒤 15~40초에 그 문을 잠그고 막는다 (흐름 barricade:<사건>) — 0 이면 일어나지 않는다', () => {
    const run = (p: number): { s: Scene; ev: string[]; door: Prop | undefined } => {
      const saved = { ...BARRICADE };
      BARRICADE.p = p; BARRICADE.cap = 1;
      try {
        const sim = new Sim('R2-BAR', FULL);
        const I = createIncident(sim, { type: 'armed', variant: 'hostage', rng: sim.rng.fork('t') });
        const s = sim.scenes[I.id]!;
        unitArrived(sim, I, sim.units.find((u) => u.kind === 'patrol')!);
        for (const a of s.agents) { a.x = a.px = s.staging.x; a.y = a.py = s.staging.y; }
        const n = sim.events.length, parent = peek(sim.rng);
        for (let k = 0; k < 45 * 5; k++) { sim.tick++; sim.t = sim.tick * sim.dt; methodsRule(sim, s, I); }
        expect(peek(sim.rng)).toBe(parent);      // fork 는 부모 흐름을 쓰지 않는다
        return { s, ev: texts(sim, n), door: s.props.find((d) => d.skin === 'barricade') };
      } finally { Object.assign(BARRICADE, saved); }
    };
    const on = run(1);
    expect(on.door).toBeDefined();
    const d = on.door!;
    expect(d.locked).toBe(true); expect(d.blocking).toBe(true); expect(d.open).toBe(false);
    expect(on.s.propAt[d.y * on.s.w + d.x]).toBe(d.id);
    expect(d.hp).toBeGreaterThanOrEqual(10); expect(d.hp).toBeLessThanOrEqual(16);
    expect(on.ev).toContain('용의자 1이 방 문을 걸어 잠그고 가구로 막았습니다.');
    expect(on.s.exits.some((e) => Math.hypot(e.x - d.x, e.y - d.y) <= 1.5)).toBe(false);
    const off = run(0);
    expect(off.door).toBeUndefined(); expect(off.ev.length).toBe(0);
  });
  it('방 진입의 잠긴 문: 모인 진입조가 손잡이를 돌려 보고(한 번), 폭파를 고를 수 있는 진입대원(파괴)이 문을 열고, 다른 대원은 물러섰다가 함께 들어간다 — 진입 기록은 폭파 한 번', () => {
    const q = doorScene('R2-ROOM', ['swat'], 13, 'armed/hostage');
    const br = q.role('breacher'), as = q.role('assaulter');
    for (const a of q.s.agents) if (a !== br && a !== as) a.status = 'left';
    // 문 위쪽 방에 총기 용의자와 붙잡힌 인질 (문에서 2.5칸 넘게)
    const room = q.s.region[(q.door.y - 1) * q.s.w + q.door.x];
    const far = q.s.regions[room].tiles.map((i) => ({ i, d: Math.hypot(i % q.s.w - q.door.x, ((i / q.s.w) | 0) - q.door.y) })).filter((o) => staticPass(q.s.tiles[o.i]) && q.s.propAt[o.i] < 0 && o.d > 2.6).sort((x, y) => y.d - x.d);
    const h = q.s.hostiles[0], c = q.s.casualties[0];
    h.state = 'hold'; h.weapon = 'gun'; h.x = h.px = far[0].i % q.s.w; h.y = h.py = (far[0].i / q.s.w) | 0; h.stunUntil = -1;
    const ci = far.find((o) => Math.hypot(o.i % q.s.w - h.x, ((o.i / q.s.w) | 0) - h.y) <= 1.5 && o.i !== far[0].i)!;
    c.where = 'scene'; c.hostage = true; c.x = c.px = ci.i % q.s.w; c.y = c.py = (ci.i / q.s.w) | 0; h.hostageId = c.id;
    q.door.skin = 'barricade';
    q.s.entryOrdered = true; q.s.breachDone = true;
    br.x = br.px = q.door.x - 1; br.y = br.py = q.door.y + 1; as.x = as.px = q.door.x + 1; as.y = as.py = q.door.y + 1;
    for (const a of [br, as]) { const t = makeTask('engage', '시험'); t.hostile = h.id; a.task = t; a.status = 'active'; }
    const n = q.sim.events.length, hp0 = c.health;
    let asFar = 0;
    for (let k = 0; k < 40 * 5 && !q.door.entered; k++) {
      q.sim.tick++; q.sim.t = q.sim.tick * q.sim.dt;
      for (const a of [br, as]) { perceive(q.sim, q.s, a); act(q.sim, q.s, a); }
      if (br.task?.sub?.method === 'charge' && Math.hypot(as.x - q.door.x, as.y - q.door.y) >= 2.9) asFar++;
    }
    const tx = texts(q.sim, n);
    expect(tx.filter((x) => x.includes('문이 잠겨 있음')).length).toBe(1);
    expect(tx).toContain('장약 설치합니다. 물러서십시오.');
    expect(tx).toContain('폭파 — 문 개방. 진입합니다.');
    expect(asFar, '진입대원이 폭파하는 동안 다른 대원은 물러서 있었다').toBeGreaterThan(0);
    expect(q.door.entered).toBe(true);
    expect(tx.some((x) => x.includes('진입!'))).toBe(true);
    expect(q.s.fx.filter((f) => f.kind === 'breach' && f.c?.door === q.door.id).map((f) => f.c!.how)).toEqual(['charge']);
    expect(q.I.methods!.filter((u) => u.ok && u.method === 'charge').length).toBe(1);
    expect(c.health).toBe(hp0);      // 인질은 폭발 반경 밖
    expect(q.I.problems.some((p) => p.code === 'ESCALATION' && p.detail.includes('폭파'))).toBe(false);
  });
});

describe('R2 단계 2: 강제 교대 (§8 의 3·6·10)', () => {
  it('3. 문: 유압 개방·할리건·발로 차기 성공이 각각 있다 (승강기 갇힘·건물 화재 강제)', () => {
    const us: MethodUse[] = [];
    for (const [seed, force] of [['D0', 'collapse/elevator'], ['D1', 'collapse/elevator'], ['D2', 'fire/std'], ['D3', 'fire/std'], ['D4', 'fire/std']] as const) {
      const sim = new Sim(seed, NORMAL, 1200, { force }); sim.runToEnd();
      for (const I of sim.incidents) us.push(...(I.methods ?? []));
    }
    const ok = new Set(us.filter((u) => u.ok && (u.work === 'force' || u.work === 'clear')).map((u) => u.method));
    for (const m of ['hydraulic', 'irons', 'kick'] as MethodId[]) expect(ok.has(m), m).toBe(true);
  }, 60000);
  it('6·10. 무장 강제(인질극·대형 인질극)의 재현성, 농성 문 잠금을 끄면(0) 잠긴 문이 생기지 않는다', () => {
    const one = (seed: string, force: string): Sim => { const sim = new Sim(seed, NORMAL, 1200, { force }); sim.runToEnd(); return sim; };
    for (const [seed, force] of [['A2', 'armed/hostage'], ['A5', 'armed/siege']]) expect(one(seed, force).report!.hash, seed).toBe(one(seed, force).report!.hash);
    const saved = BARRICADE.p;
    BARRICADE.p = 0;
    try {
      for (const [seed, force] of [['S10', 'armed/hostage'], ['S7', 'armed/siege']]) {
        const sim = one(seed, force);
        for (const I of sim.incidents) {
          const s = sim.scenes[I.id];
          if (s && s.kind === 'armed') expect(s.props.some((p) => p.skin === 'barricade' || (p.kind === 'door' && p.locked)), `${seed} #${I.id}`).toBe(false);
        }
        expect(sim.events.some((e) => e.text.includes('가구로 막았습니다'))).toBe(false);
      }
    } finally { BARRICADE.p = saved; }
  }, 60000);
});

describe('R2 단계 2: 폭파 진입의 그림 (§4.2a — 화면은 상태를 읽기만 한다)', () => {
  it('문에 붙인 장약·3-2-1·농성 문의 가구 그림은 예외 없이 끝나고 시뮬레이션 상태를 바꾸지 않는다', () => {
    const q = doorScene('R2-DOOR', ['swat']);
    const br = q.role('breacher');
    q.place(br); q.know(br); q.door.skin = 'barricade';
    const t = taskFor(br, work(q.sim, q.s, 'force', { tile: q.tile }));
    t.method = 'charge';
    const snap = (): string => JSON.stringify([q.sim.logHash, q.sim.events.length, peek(q.sim.rng), peek(q.s.rng), q.s.agents.map((a) => [a.x, a.y, a.task && a.task.method, a.task && a.task.phase]), q.s.props.map((p) => [p.open, p.blocking, p.skin])]);
    const before = snap();
    const g = fakeCtx();
    for (const [ph, pr] of [[0, 0], [0, 2.5], [1, 0], [2, 0], [3, 0.2], [3, 0.7], [3, 1.3]] as [number, number][]) { t.phase = ph; t.progress = pr; drawBarricades(g, q.s, 24); drawCharges(g, q.s, 24, ph + pr); }
    t.phase = 0; t.progress = 0; t.method = undefined;
    expect(snap()).toBe(before.replace('"charge",0', 'null,0'));
  });
});

// ───────────────────────── 단계 3: 구출·탐지 (§4.3·§4.4) ─────────────────────────
/** 갇힌 구조 대상 하나 (없으면 시험이 실패한다) */
const trappedOf = (s: Scene): Casualty => s.casualties.find((c) => c.mob === 'trapped')!;
/** 구출 장면을 한 대원만 돌린다 (눈과 임무만) */
function soloRun(sim: Sim, s: Scene, a: FieldAgent, sec: number, until: () => boolean): void {
  for (let k = 0; k < sec * 5 && !until(); k++) { sim.tick++; sim.t = sim.tick * sim.dt; perceive(sim, s, a); act(sim, s, a); }
}
/** 대원을 대상 곁에 세운다 (구출을 바로 시작하게) */
const beside = (s: Scene, a: FieldAgent, c: Casualty): void => {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1], [1, -1], [-1, 1]]) {
    const x = Math.round(c.x) + dx, y = Math.round(c.y) + dy;
    if (staticPass(s.tiles[y * s.w + x]) && s.propAt[y * s.w + x] < 0) { a.x = a.px = x; a.y = a.py = y; a.path = null; a.status = 'active'; return; }
  }
};

describe('R2 단계 3: 구출의 방법 (§4.3 — 믿음으로 차량·붕괴·구덩이·그 밖을 가린다)', () => {
  it('casFact: 갇힌 차량(veh)과 맨홀 아래(pit)를 본 그대로 싣는다 — 풀려나면 사라진다', () => {
    const t1 = sceneWith('R2-TRA1', 'traffic', ['rescue']);
    const cv = t1.s.casualties.find((c) => c.inVehicle !== null && c.mob === 'trapped');
    if (cv) { expect(casFact(t1.sim, t1.s, cv, '시험').value.veh).toBe(cv.inVehicle); cv.mob = 'immobile'; expect(casFact(t1.sim, t1.s, cv, '시험').value.veh).toBeUndefined(); }
    const m = sceneWith('R2-PIT', 'traffic/manhole', ['rescue']);
    const cp = trappedOf(m.s);
    expect(casFact(m.sim, m.s, cp, '시험').value.pit).toBe(true);
    for (const c of m.s.casualties) if (c !== cp) expect(casFact(m.sim, m.s, c, '시험').value.pit).toBeUndefined();
  });
  it('고르는 규칙: 차량은 문 벌리기(유압)·수동, 붕괴는 에어백·손 공구·손으로 파기, 구덩이는 줄로 끌어올리기 — 다친 대원은 위험한 방법(손으로 파기·급박)을 고르지 않는다', () => {
    const t1 = sceneWith('R2-TRA1', 'traffic', ['rescue', 'patrol']);
    const cv = t1.s.casualties.find((c) => c.inVehicle !== null && c.mob === 'trapped')!;
    expect(cv).toBeDefined();
    const pk = (q: { sim: Sim; s: Scene }, a: FieldAgent, c: Casualty): MethodId | undefined => chooseMethod(q.sim, q.s, a, 'extricate', tgCas(c), null, NO_SENSE)?.m;
    expect(pk(t1, t1.role('extricator'), cv)).toBe('spread');
    expect(pk(t1, t1.role('officer'), cv)).toBe('manual');
    expect(pk(t1, t1.role('rescueLead'), cv)).toBe('basic');
    const co = sceneWith('R2-COL0', 'collapse', ['rescue', 'patrol']);
    const cc = trappedOf(co.s);
    expect(pk(co, co.role('extricator'), cc)).toBe('airbag');
    expect(pk(co, co.role('rescueLead'), cc)).toBe('basic');
    expect(pk(co, co.role('officer'), cc)).toBe('tunnel');
    co.sim.responders[co.role('officer').rid].status = 'injured';
    expect(pk(co, co.role('officer'), cc)).toBeUndefined();      // 손으로 파기(risk 0.1)를 빼면 남는 방법이 없다 — 늘 남는 임무라 실행부는 R1 의 식으로 간다
    const m = sceneWith('R2-PIT', 'traffic/manhole', ['rescue']);
    const cp = trappedOf(m.s);
    expect(pk(m, m.role('ropeTech'), cp)).toBe('haul');
    expect(pk(m, m.role('extricator'), cp)).toBe('basic');      // 유압 구조기만 든 대원도 손 공구 구출(R1 의 식 — 가진 가장 좋은 도구)
  });
  it('급박 구출: 차 곁 4칸 안의 살아 있는 연료 누출(sub fuel)이나 선 자리의 짙은 연기면 고른다 (까닭 danger). 지지대: 4칸 안의 살아 있는 균열(sub crack)을 동료가 보강하지 않을 때 (까닭 danger)', () => {
    const t1 = sceneWith('R2-TRA1', 'traffic', ['rescue']);
    const cv = t1.s.casualties.find((c) => c.inVehicle !== null && c.mob === 'trapped')!, ext = t1.role('extricator');
    ext.beliefs.merge(mkFact('haz', 900, { kind: 'leak', active: true, x: Math.round(cv.x) + 1, y: Math.round(cv.y), sub: 'fuel' }, '시험', t1.sim.t, 1, true, '연료 누출'));
    const p1 = chooseMethod(t1.sim, t1.s, ext, 'extricate', tgCas(cv), null, NO_SENSE)!;
    expect(p1.m).toBe('rapid'); expect(p1.why).toBe('danger');
    const lead = t1.role('rescueLead');
    expect(chooseMethod(t1.sim, t1.s, lead, 'extricate', tgCas(cv), null, { smoke: 0.5, heat: 0 })!.m).toBe('rapid');
    expect(chooseMethod(t1.sim, t1.s, lead, 'extricate', tgCas(cv), null, NO_SENSE)!.m).toBe('basic');
    const co = sceneWith('R2-COL0', 'collapse', ['rescue']);
    const cc = trappedOf(co.s), rl = co.role('rescueLead');
    rl.beliefs.merge(mkFact('haz', 901, { kind: 'leak', active: true, x: Math.round(cc.x) + 2, y: Math.round(cc.y), sub: 'crack' }, '시험', co.sim.t, 1, true, '균열'));
    const p2 = chooseMethod(co.sim, co.s, rl, 'extricate', tgCas(cc), null, NO_SENSE)!;
    expect(p2.m).toBe('shore'); expect(p2.why).toBe('danger');
    // 그 균열을 동료가 보강(mitigate)하고 있으면 지지대를 고르지 않는다
    const mate = co.role('extricator'); const tm = makeTask('mitigate', '시험'); tm.prop = 901; mate.task = tm; mate.status = 'active';
    expect(chooseMethod(co.sim, co.s, rl, 'extricate', tgCas(cc), null, NO_SENSE)!.m).toBe('basic');
    // 밸브(sub valve)를 균열로 잘못 보지 않는다
    const rl2 = sceneWith('R2-COL0', 'collapse', ['rescue']);
    const cc2 = trappedOf(rl2.s), l2 = rl2.role('rescueLead');
    l2.beliefs.merge(mkFact('haz', 902, { kind: 'leak', active: true, x: Math.round(cc2.x) + 1, y: Math.round(cc2.y), sub: 'valve' }, '시험', rl2.sim.t, 1, true, '밸브'));
    expect(chooseMethod(rl2.sim, rl2.s, l2, 'extricate', tgCas(cc2), null, NO_SENSE)!.m).toBe('basic');
  });
  it('줄로 끌어올리기: 맨홀 아래 사람을 로프 대원이 줄을 내리고(4초) 끌어올린다 — 방법별 완료 문구·구한 방법·방법 기록', () => {
    const m = sceneWith('R2-PIT', 'traffic/manhole', ['rescue']);
    const cp = trappedOf(m.s), rope = m.role('ropeTech');
    for (const a of m.s.agents) if (a !== rope) a.status = 'left';
    beside(m.s, rope, cp);
    const t = taskFor(rope, work(m.sim, m.s, 'extricate', { cas: cp.id }));
    const n = m.sim.events.length, t0 = m.sim.t;
    soloRun(m.sim, m.s, rope, 10, () => t.phase === 1);
    const prepEnd = m.sim.t - t0;
    soloRun(m.sim, m.s, rope, 120, () => cp.mob !== 'trapped');
    expect(cp.mob).not.toBe('trapped');
    expect(t.method).toBe('haul');
    expect(prepEnd).toBeGreaterThanOrEqual(4 - 1e-6);
    expect(cp.freedHow).toBe('haul'); expect(cp.freedBy).toBe(rope.rid);
    expect(texts(m.sim, n)).toContain(`구조 대상 ${cp.label}, 줄로 끌어올려 구출 완료. 이송이 필요합니다.`);
    expect(m.I.methods!.filter((u) => u.ok && u.work === 'extricate')).toMatchObject([{ method: 'haul', cas: cp.id, rid: rope.rid }]);
  });
  it('지지대 먼저: 8초 동안 세운 뒤 그 균열을 보강한다(p.mitigated — X6 의 보강 규칙이 받는다), 그 뒤 손 공구로 구출', () => {
    const co = sceneWith('R2-COL0', 'collapse', ['rescue']);
    const cc = trappedOf(co.s), rl = co.role('rescueLead');
    for (const a of co.s.agents) if (a !== rl) a.status = 'left';
    // 대상 곁 4칸 안의 진짜 균열부 하나 (없으면 만든다)
    let crack = co.s.props.find((p) => p.kind === 'unstable' && !p.mitigated && Math.hypot(p.x - cc.x, p.y - cc.y) <= 4);
    if (!crack) { crack = { ...co.s.props[0], id: co.s.props.length, kind: 'unstable', x: Math.round(cc.x) + 2, y: Math.round(cc.y), blocking: false, mitigated: false }; co.s.props.push(crack); }
    rl.beliefs.merge(mkFact('haz', crack.id, { kind: 'leak', active: true, x: crack.x, y: crack.y, sub: 'crack' }, '시험', co.sim.t, 1, true, '균열'));
    beside(co.s, rl, cc); co.s.smoke.fill(0);      // 먼지·연기가 없는 자리 (도착 재선택이 급박 구출로 바꾸지 않게)
    const t = taskFor(rl, work(co.sim, co.s, 'extricate', { cas: cc.id }));
    const n = co.sim.events.length, sv = co.s.staticVersion;
    soloRun(co.sim, co.s, rl, 9, () => crack!.mitigated === true);
    expect(t.method).toBe('shore'); expect(t.mwhy).toBe('danger');
    expect(crack.mitigated).toBe(true);
    expect(co.s.staticVersion).toBeGreaterThan(sv);
    expect(texts(co.sim, n)).toContain('균열부에 지지대를 세웠습니다. 추가 붕괴 위험을 줄였습니다.');
    expect(rl.beliefs.val<{ active: boolean; sub?: string }>('haz', crack.id)).toMatchObject({ active: false, sub: 'crack' });
  });
  it('에어백의 숨은 고장 → 장비 고장 기록 뒤 다른 방법으로 (손 공구 — 유압 구조기)', () => {
    const co = sceneWith('R2-COL0', 'collapse', ['rescue']);
    const cc = trappedOf(co.s), ext = co.role('extricator');
    for (const a of co.s.agents) if (a !== ext) a.status = 'left';
    co.sim.responders[ext.rid].kit!.find((it) => it.id === 'airbag')!.fault = true;
    beside(co.s, ext, cc); co.s.smoke.fill(0);
    const t = taskFor(ext, work(co.sim, co.s, 'extricate', { cas: cc.id }));
    soloRun(co.sim, co.s, ext, 3, () => t.method !== undefined && t.method !== 'airbag');
    expect(t.method).toBe('basic'); expect(t.mwhy).toBe('broken');
    expect(co.I.problems.some((p) => p.code === 'EQUIP_FAIL')).toBe(true);
    expect(co.I.methods!.map((u) => [u.method, u.ok])).toEqual([['airbag', false]]);
  });
  it('급박 구출을 마치면 대상이 척추 보호 없이 끌려 나와 다친다(타박상 10)', () => {
    const t1 = sceneWith('R2-TRA1', 'traffic', ['rescue']);
    const cv = t1.s.casualties.find((c) => c.inVehicle !== null && c.mob === 'trapped')!, ext = t1.role('extricator');
    for (const a of t1.s.agents) if (a !== ext) a.status = 'left';
    ext.beliefs.merge(mkFact('haz', 900, { kind: 'leak', active: true, x: Math.round(cv.x) + 1, y: Math.round(cv.y), sub: 'fuel' }, '시험', t1.sim.t, 1, true, '연료 누출'));
    beside(t1.s, ext, cv); cv.health = 90; cv.bleed = 0;
    const t = taskFor(ext, work(t1.sim, t1.s, 'extricate', { cas: cv.id }));
    soloRun(t1.sim, t1.s, ext, 120, () => cv.mob !== 'trapped');
    expect(t.method).toBe('rapid');
    expect((cv.injuries ?? []).some((j) => j.cause === 'blunt')).toBe(true);
    expect(cv.freedHow).toBe('rapid');
  });
  it('속도 k: 수동 맨손 · 손 공구는 R1 의 식 · 지붕 절단 1.5 · 에어백 1.6 · 줄 1.2 · 손으로 파기 0.5 · 급박 1.8 배', () => {
    const co = sceneWith('R2-COL0', 'collapse', ['rescue']);
    const ext = co.role('extricator'), t = makeTask('extricate', '시험');
    const tm = co.sim.tune.toolMul;
    for (const [m, k] of [['manual', 0.35 + 0.65 * BARE_HANDS], ['basic', 0.35 + 0.65 * Math.min(1.15, 1.0 * tm)], ['roof', 1.5], ['airbag', 1.6], ['haul', 1.2], ['tunnel', 0.5], ['rapid', 1.8 * (0.35 + 0.65 * Math.min(1.15, 1.0 * tm))]] as [MethodId, number][]) {
      t.method = m; expect(extricateRate(co.sim, ext, t, co.I).k, m).toBeCloseTo(k, 9);
    }
  });
});

describe('R2 단계 3: 수색·탐지의 방법 (§4.4)', () => {
  it('고르는 규칙: 실내·붕괴는 호출(붕괴에서 탐지 장비가 있으면 청음), 야외는 줄 수색 — 확성기를 들었으면 확성기, 열화상은 밤이거나 나무 칸이 30% 넘는 구역에서만', () => {
    const co = sceneWith('R2-COL0', 'collapse', ['rescue', 'patrol']);
    const reg = co.s.regions.findIndex((r) => r.indoor);
    const tgR = (r: number): MTarget => ({ cas: -1, prop: -1, hostile: -1, region: r, tile: -1 });
    expect(chooseMethod(co.sim, co.s, co.role('searcher'), 'search', tgR(reg), null, NO_SENSE)!.m).toBe('listen');
    expect(chooseMethod(co.sim, co.s, co.role('officer'), 'search', tgR(reg), null, NO_SENSE)!.m).toBe('call');
    const se = sceneWith('R2-SRCH', 'search', ['patrol', 'engine']);
    const lead = se.role('patrolLead'), fl = se.role('fireLead'), cop = se.role('officer');
    const treeR = (want: (share: number) => boolean): number => se.s.regions.findIndex((r) => { let n = 0; for (const i of r.tiles) if (se.s.tiles[i] === T.TREE) n++; return want(n / Math.max(1, r.tiles.length)); });
    const open = treeR((x) => x < 0.3), woods = treeR((x) => x > 0.3);
    expect(chooseMethod(se.sim, se.s, lead, 'search', tgR(open), null, NO_SENSE)!.m).toBe('hail');
    expect(chooseMethod(se.sim, se.s, cop, 'search', tgR(open), null, NO_SENSE)!.m).toBe('line');
    if (se.sim.weather !== 'night') expect(chooseMethod(se.sim, se.s, fl, 'search', tgR(open), null, NO_SENSE)!.m).toBe('line');
    if (woods >= 0) expect(chooseMethod(se.sim, se.s, fl, 'search', tgR(woods), null, NO_SENSE)!.m).toBe('thermal');
    const w0 = se.sim.weather; Object.assign(se.sim, { weather: 'night' });
    expect(chooseMethod(se.sim, se.s, fl, 'search', tgR(open), null, NO_SENSE)!.m).toBe('thermal');
    Object.assign(se.sim, { weather: w0 });
  });
  it('searchMul 은 경유점에 멈춘 동안만: 청음 ×0.75 · 확성기 ×0.5 (소리를 낼 수 있는 대상만) · 열화상 ×0.6 — 순수 함수', () => {
    const se = sceneWith('R2-SRCH', 'search', ['patrol']);
    const a = se.role('officer'), t = makeTask('search', '시험'); a.task = t;
    expect(searchMul(a)).toEqual({ k: 1, voice: false });
    for (const [m, k, voice] of [['listen', 0.75, true], ['hail', 0.5, true], ['thermal', 0.6, false], ['line', 1, false], ['call', 1, false]] as [MethodId, number, boolean][]) {
      t.method = m; t.wait = 0; expect(searchMul(a).k).toBe(1);
      t.wait = 1; expect(searchMul(a), m).toEqual({ k, voice });
    }
  });
  it('확성기 호출 수색: 경유점마다 2초 멈추고, 멈춘 동안 대답할 수 있는 숨은 사람을 더 멀리서 찾는다', () => {
    const se = sceneWith('R2-SRCH', 'search', ['patrol']);
    const lead = se.role('patrolLead');
    for (const a of se.s.agents) if (a !== lead) a.status = 'left';
    const c = se.s.casualties[0];
    const reg = se.s.region[Math.round(c.y) * se.s.w + Math.round(c.x)];
    const t = taskFor(lead, work(se.sim, se.s, 'search', { region: reg }));
    lead.x = lead.px = se.s.regions[reg].cx; lead.y = lead.py = se.s.regions[reg].cy; lead.path = null;
    let stopped = 0;
    for (let k = 0; k < 40 * 5 && t.ptI < 2 && lead.task === t; k++) { se.sim.tick++; se.sim.t = se.sim.tick * se.sim.dt; perceive(se.sim, se.s, lead); act(se.sim, se.s, lead); if (t.wait > 0.6) stopped++; }
    expect(t.method).toBe('hail');
    expect(stopped).toBeGreaterThan(3);      // 0.5 초보다 길게 멈춘다
    // 탐지 배율: 같은 자리에서 은폐가 큰 사람 — 멈춘 동안은 더 멀리서 보인다
    c.concealment = 0.8; c.health = 80;
    t.wait = 1; const far = detectRadius(se.sim, se.s, lead, c.concealment * searchMul(lead).k);
    t.wait = 0; const near = detectRadius(se.sim, se.s, lead, c.concealment);
    expect(far).toBeGreaterThan(near);
  });
  it('열화상 수색은 처음 멈출 때 카메라의 숨은 고장을 드러내고 줄 수색으로 바꾼다', () => {
    const se = sceneWith('R2-SRCH', 'search', ['engine']);
    const fl = se.role('fireLead');
    for (const a of se.s.agents) if (a !== fl) a.status = 'left';
    Object.assign(se.sim, { weather: 'night' });
    se.sim.responders[fl.rid].kit!.find((it) => it.id === 'tic')!.fault = true;
    const reg = se.s.regions.findIndex((r) => !r.indoor && r.tiles.length > 10);
    const t = taskFor(fl, work(se.sim, se.s, 'search', { region: reg }));
    fl.x = fl.px = se.s.regions[reg].cx; fl.y = fl.py = se.s.regions[reg].cy; fl.path = null;
    for (let k = 0; k < 30 * 5 && t.method !== 'line' && fl.task === t; k++) { se.sim.tick++; se.sim.t = se.sim.tick * se.sim.dt; act(se.sim, se.s, fl); }
    expect(t.method).toBe('line'); expect(t.mwhy).toBe('broken');
    expect(se.I.problems.some((p) => p.code === 'EQUIP_FAIL')).toBe(true);
  });
});

describe('R2 단계 3: 강제 교대 (§8 의 3 · 구출 시간)', () => {
  it('3. 구출: 문 벌리기·에어백·손 공구·수동·급박 구출 가운데 넷 이상이 성공하고, 끌어낸 사람은 그 방법이 적혀 있다 (교통사고·붕괴 강제)', () => {
    const us: MethodUse[] = [];
    let freed = 0;
    for (const [seed, force] of [['E0', 'traffic/std'], ['E1', 'traffic/std'], ['E2', 'collapse/std'], ['E3', 'collapse/std']] as const) {
      const sim = new Sim(seed, NORMAL, 1200, { force }); sim.runToEnd();
      for (const I of sim.incidents) {
        us.push(...(I.methods ?? []));
        const s = sim.scenes[I.id];
        if (s) for (const c of s.casualties) if (c.tFreed >= 0 && c.freedHow !== undefined && METHOD[c.freedHow].work.indexOf('extricate') >= 0) { freed++; expect(us.some((u) => u.ok && u.work === 'extricate' && u.cas === c.id && u.method === c.freedHow), `${seed} #${I.id} ${c.label}`).toBe(true); }
      }
    }
    const ok = new Set(us.filter((u) => u.ok && u.work === 'extricate').map((u) => u.method));
    expect([...ok].filter((m) => ['spread', 'airbag', 'basic', 'manual', 'rapid', 'roof', 'tunnel'].includes(m)).length).toBeGreaterThanOrEqual(4);
    expect(freed).toBeGreaterThan(0);
  }, 60000);
});

// ───────────────────────── 단계 4: 화재 진압 (§4.5) ─────────────────────────
/** 그 구역의 칸 네 이웃에 창 칸이 있는가 (시험이 생김새로 직접 본다) */
const hasWindow = (s: Scene, r: number): boolean => s.regions[r].tiles.some((i) => [i - 1, i + 1, i - s.w, i + s.w].some((j) => j >= 0 && j < s.tiles.length && s.tiles[j] === T.WINDOW));
const tgR4 = (r: number): MTarget => ({ cas: -1, prop: -1, hostile: -1, region: r, tile: -1 });
/** 모든 대원의 믿음에 그 구역의 불(·수색 확인율)을 넣는다 */
const believeFire = (q: { sim: Sim; s: Scene }, r: number, fire: number, srch?: number): void => {
  q.sim.t += 1;
  for (const a of q.s.agents) {
    a.beliefs.merge(mkFact('fire', r, fire, '시험', q.sim.t, 1, true, '화재'));
    if (srch !== undefined) a.beliefs.merge(mkFact('srch', r, srch, '시험', q.sim.t, 1, true, '수색'));
  }
};
/** 그 구역의 구조 대상 믿음을 모두 지운다 (사람이 없다고 확인된 구역) — 구역 밖으로 옮겨 적는다 */
const clearCasIn = (q: { sim: Sim; s: Scene }, r: number): void => {
  q.sim.t += 1;
  for (const a of q.s.agents) for (const f of a.beliefs.list('cas')) {
    const v = f.value as CasBelief;
    if (q.s.region[v.y * q.s.w + v.x] === r) a.beliefs.merge(mkFact('cas', f.id, { ...v, where: 'safe' }, '시험', q.sim.t, 1, true, f.text));
  }
};
/** 외부 방수의 첫 후보 자리 (X6 의 exteriorSpots — 생김새) · 시야선 */
const exteriorSpotsOf = (s: Scene, r: number): number => { const l = exteriorSpots(s, r, false); return l.length ? l[0] : -1; };
const losOk = (s: Scene, x0: number, y0: number, x1: number, y1: number): boolean => los(s, x0, y0, x1, y1);
/** 불이 날 수 있는 실내 구역 (창이 있는 것 / 없는 것) */
const roomWith = (s: Scene, win: boolean): number => s.regions.findIndex((r, i) => r.indoor && r.tiles.length >= 6 && hasWindow(s, i) === win);

describe('R2 단계 4: 화재 진압의 방법 — 고르는 규칙 (§4.5)', () => {
  it('관창수는 내부 공격(평소). 사다리차의 관창수는 창 너머 센 불(믿음 0.5 이상)에 고가 방수 — 한 부대에 사다리 하나. 사람이 없다고 확인된 큰 불(0.7 · 수색 0.72)은 외부 방수(까닭 danger)', () => {
    const q = sceneWith('R2-FIRE', 'fire', ['engine', 'ladder', 'patrol', 'als']);
    const r = roomWith(q.s, true);
    expect(r).toBeGreaterThanOrEqual(0);
    const noz = q.of('engine').find((a) => q.sim.responders[a.rid].role === 'nozzle')!, lop = q.role('ladderOp');
    const lnoz = q.of('ladder').find((a) => q.sim.responders[a.rid].role === 'nozzle')!;
    const pick = (a: FieldAgent, t: Task | null = null, sense = NO_SENSE) => chooseMethod(q.sim, q.s, a, 'suppress', tgR4(r), t, sense);
    believeFire(q, r, 0.4);
    expect(pick(noz)!.m).toBe('interior'); expect(pick(noz)!.why).toBe('usual');
    expect(pick(lop)!.m).toBe('interior');      // 불이 약하다 (0.5 아래) — 고가 방수의 조건이 아니다
    believeFire(q, r, 0.6);
    expect(pick(lop)!.m).toBe('aerial');
    // 같은 부대의 사다리를 다른 대원이 쓰고 있으면 고르지 않는다
    const ta = makeTask('suppress', '시험'); ta.region = r; ta.method = 'aerial'; lop.task = ta; lop.status = 'active';
    expect(pick(lnoz)!.m).toBe('interior');
    lop.task = null;
    // 사람이 없다고 확인된 큰 불: 외부 방수 (밖에서 그 구역이 보이는 자리가 있을 때 — 생김새)
    believeFire(q, r, 1.0, 0.8); clearCasIn(q, r);
    const pd = pick(noz)!;
    expect(pd.m).toBe('defensive'); expect(pd.why).toBe('danger');
    // 그 구역에 구조 대상이 있다고 믿으면 안에서
    const c = q.s.casualties[0], tile = q.s.regions[r].tiles[0];
    noz.beliefs.merge(mkFact('cas', c.id, { ...casFact(q.sim, q.s, c, '시험').value, x: tile % q.s.w, y: (tile / q.s.w) | 0, where: 'scene', band: 1 }, '시험', ++q.sim.t, 1, true, 'x'));
    expect(pick(noz)!.m).toBe('interior');
    // 경찰은 관창이 없다 — 화재 현장 건물 안의 불은 소화기로도 끄지 않는다
    expect(pick(q.role('patrolLead'))).toBeNull();
    expect(pick(q.role('officer'))).toBeNull();
  });
  it('자기 판단의 외부 방수: 실행부가 고를 때(임무가 있을 때) 공기 60초 아래·체력 50 아래면 — 배정(methodFit, 임무 없음)은 남의 몸을 읽지 않는다', () => {
    const q = sceneWith('R2-FIRE', 'fire', ['engine']);
    const r = roomWith(q.s, true);
    const noz = q.role('nozzle'), scba = q.sim.responders[noz.rid].kit!.find((it) => it.id === 'scba')!;
    believeFire(q, r, 0.6);
    const t = makeTask('suppress', '시험'); t.region = r;
    scba.uses = 55;      // 60초 아래 (R1 의 문턱 45 보다는 위 — 내부 공격도 된다)
    expect(chooseMethod(q.sim, q.s, noz, 'suppress', tgR4(r), t, NO_SENSE)!.m).toBe('defensive');
    expect(chooseMethod(q.sim, q.s, noz, 'suppress', tgR4(r), null, NO_SENSE)!.m).toBe('interior');
    scba.uses = 300; q.sim.responders[noz.rid].health = 45;
    expect(chooseMethod(q.sim, q.s, noz, 'suppress', tgR4(r), t, NO_SENSE)!.m).toBe('defensive');
    q.sim.responders[noz.rid].health = 100;
    expect(chooseMethod(q.sim, q.s, noz, 'suppress', tgR4(r), t, NO_SENSE)!.m).toBe('interior');
  });
  it('배연: 송풍기와 공기호흡기를 든 대원이 선 자리의 연기 0.5 넘음(도착 재선택)에 — 이 현장에 송풍기가 돌거나 동료가 설치하러 가면 고르지 않는다', () => {
    const q = sceneWith('R2-FIRE', 'fire', ['ladder', 'engine']);
    const r = roomWith(q.s, false) >= 0 ? roomWith(q.s, false) : roomWith(q.s, true);
    const lop = q.role('ladderOp');
    believeFire(q, r, 0.4);
    const smoky = { smoke: 0.7, heat: 0 };
    expect(chooseMethod(q.sim, q.s, lop, 'suppress', tgR4(r), null, NO_SENSE)!.m).toBe('interior');
    const pv = chooseMethod(q.sim, q.s, lop, 'suppress', tgR4(r), null, smoky)!;
    expect(pv.m).toBe('ventilate'); expect(pv.why).toBe('danger');
    expect(chooseMethod(q.sim, q.s, q.role('nozzle'), 'suppress', tgR4(r), null, smoky)!.m).toBe('interior');      // 송풍기가 없다
    q.s.fan = { x: 1, y: 1, until: q.sim.t + 60, rid: -1, power: 1 };
    expect(chooseMethod(q.sim, q.s, lop, 'suppress', tgR4(r), null, smoky)!.m).toBe('interior');
    q.s.fan = { x: 1, y: 1, until: q.sim.t - 1, rid: -1, power: 1 };      // 멈춘 송풍기
    expect(chooseMethod(q.sim, q.s, lop, 'suppress', tgR4(r), null, smoky)!.m).toBe('ventilate');
    q.s.fan = null;
    const mate = q.role('engineer'), tv = makeTask('suppress', '시험'); tv.method = 'ventilate'; mate.task = tv; mate.status = 'active';
    expect(chooseMethod(q.sim, q.s, lop, 'suppress', tgR4(r), null, smoky)!.m).toBe('interior');
  });
  it('(X6) 지휘관이 외부 방어를 정했다고 믿으면 외부 방수·고가 방수만 — 실내 진압·배연·소화기는 고르지 않는다', () => {
    const q = sceneWith('R2-FIRE', 'fire', ['engine', 'ladder']);
    const r = roomWith(q.s, true);
    believeFire(q, r, 0.4);
    for (const a of q.s.agents) a.beliefs.merge(mkFact('ops', 0, { mode: 'defensive', zones: [], t: q.sim.t }, '시험', ++q.sim.t, 1, true, '외부 방어'));
    expect(chooseMethod(q.sim, q.s, q.role('nozzle'), 'suppress', tgR4(r), null, NO_SENSE)!.m).toBe('defensive');
    expect(chooseMethod(q.sim, q.s, q.role('ladderOp'), 'suppress', tgR4(r), null, { smoke: 0.8, heat: 0 })!.m).toBe('defensive');      // 배연을 고르지 않는다
    // 단계 3 위험 구역만 (모드는 내부)
    for (const a of q.s.agents) a.beliefs.merge(mkFact('ops', 0, { mode: 'interior', zones: [{ key: 'z', kind: 'struct', level: 3, regions: [r], x: -1, y: -1, r: 0 }], t: q.sim.t }, '시험', ++q.sim.t, 1, true, '구역'));
    expect(chooseMethod(q.sim, q.s, q.role('nozzle'), 'suppress', tgR4(r), null, NO_SENSE)!.m).toBe('defensive');
  });
  it('소화기: 관창이 없는 대원(순찰 팀장·구급 운전원·기관원)이 실외 구역이나 화재·가스·붕괴 현장이 아닌 곳의 작은 불(믿음 0 초과 0.35 이하)에 — fitFor 0.25', () => {
    const q = sceneWith('R2-TRAF', 'traffic', ['patrol', 'als', 'engine']);
    const r = q.s.regions.findIndex((g) => !g.indoor && g.tiles.length > 10);
    const lead = q.role('patrolLead'), cop = q.role('officer'), drv = q.role('emsDriver');
    const w = work(q.sim, q.s, 'suppress', { region: r });
    expect(fitFor(q.sim, q.s, lead, w)).toBe(0);      // 불을 모른다
    believeFire(q, r, 0.2);
    expect(chooseMethod(q.sim, q.s, lead, 'suppress', tgR4(r), null, NO_SENSE)!.m).toBe('extinguisher');
    expect(fitFor(q.sim, q.s, lead, w)).toBeCloseTo(0.25 + (ROLES.patrolLead.prefer.suppress ?? 0), 9);
    expect(fitFor(q.sim, q.s, drv, w)).toBeGreaterThan(0);
    expect(fitFor(q.sim, q.s, cop, w)).toBe(0);      // 소화기가 없다
    expect(fitFor(q.sim, q.s, q.role('nozzle'), w)).toBe(q.sim.responders[q.role('nozzle').rid].skills.fire + (ROLES.nozzle.prefer.suppress ?? 0));      // 관창수는 R1 그대로
    believeFire(q, r, 0.6);
    expect(fitFor(q.sim, q.s, lead, w)).toBe(0);      // 불이 크다
    expect(chooseMethod(q.sim, q.s, lead, 'suppress', tgR4(r), null, NO_SENSE)).toBeNull();
    // 소화기를 다 쓰면 고르지 않는다
    believeFire(q, r, 0.2);
    useKit(q.sim, lead.rid, 'extinguisher', 1);
    expect(kitCount(q.sim, lead.rid, 'extinguisher')).toBe(0);
    expect(fitFor(q.sim, q.s, lead, w)).toBe(0);
  });
  it('공기 문턱 아래(R1 airShort)인 관창수: 외부 방수를 고를 수 있을 때만 맡는다 — 공기통을 바꾼 뒤(afterSwap)로 보면 R1 그대로', () => {
    const q = sceneWith('R2-FIRE', 'fire', ['engine']);
    const r = roomWith(q.s, true), noz = q.role('nozzle'), rr = q.sim.responders[noz.rid];
    rr.kit!.find((it) => it.id === 'scba')!.uses = 30;
    const w = work(q.sim, q.s, 'suppress', { region: r });
    believeFire(q, r, 0.6);
    expect(fitFor(q.sim, q.s, noz, w)).toBe(0);
    expect(fitFor(q.sim, q.s, noz, w, true)).toBeCloseTo(rr.skills.fire + (ROLES.nozzle.prefer.suppress ?? 0), 9);
    believeFire(q, r, 1.0, 0.9); clearCasIn(q, r);
    expect(fitFor(q.sim, q.s, noz, w)).toBeCloseTo(rr.skills.fire + (ROLES.nozzle.prefer.suppress ?? 0), 9);
  });
});

describe('R2 단계 4: 화재 진압의 실행 (장면을 직접 만들어)', () => {
  /** 실외 구역의 한 칸에 작은 불을 놓는다 (대원 곁 — 길 위의 차량 화재처럼) */
  const smallFire = (s: Scene, a: FieldAgent, level: number, n = 1): { r: number; tiles: number[] } => {
    const out: number[] = [];
    for (let d = 2; d < 8 && out.length < n; d++) for (const [dx, dy] of [[d, 0], [-d, 0], [0, d], [0, -d]]) {
      const x = Math.round(a.x) + dx, y = Math.round(a.y) + dy, i = y * s.w + x;
      if (x < 0 || y < 0 || x >= s.w || y >= s.h || !staticPass(s.tiles[i]) || s.region[i] < 0 || s.regions[s.region[i]].indoor || s.propAt[i] >= 0) continue;
      if (out.length && s.region[i] !== s.region[out[0]]) continue;
      out.push(i); if (out.length >= n) break;
    }
    for (const i of out) { s.fire[i] = level; s.fuel[i] = 0.2; }
    return { r: s.region[out[0]], tiles: out };
  };
  it('소화기: 순찰 팀장이 다가가 흰 분말 줄기로 작은 불을 끄고 진압을 확인한다 — 방법 기록, 펌프·물을 쓰지 않는다, s.rng 를 쓰지 않는다', () => {
    const q = sceneWith('R2-TRAF', 'traffic', ['patrol']);
    const lead = q.role('patrolLead');
    for (const a of q.s.agents) if (a !== lead) a.status = 'left';
    q.s.fire.fill(0);
    const { r, tiles } = smallFire(q.s, lead, 0.25);      // 믿음 0.2 와 같은 단계로 보인다 (perceive 는 0.2 단위로 적는다)
    believeFire(q, r, 0.2);
    const t = taskFor(lead, work(q.sim, q.s, 'suppress', { region: r }));
    const rs = peek(q.s.rng);
    soloRun(q.sim, q.s, lead, 30, () => lead.task !== t);
    expect(t.method).toBe('extinguisher');
    expect(q.s.fire[tiles[0]]).toBeLessThanOrEqual(0.05);      // 꺼진 불 (0.05 이하 — 진압 확인과 같은 기준)
    expect(lead.beliefs.val<number>('fire', r)).toBe(0);
    expect(q.I.methods!.filter((u) => u.ok && u.work === 'suppress')).toMatchObject([{ method: 'extinguisher', region: r, rid: lead.rid }]);
    expect(q.s.fx.some((f) => f.kind === 'spray' && f.color === '#f2f2ee')).toBe(true);
    expect(peek(q.s.rng)).toBe(rs);
    expect(kitCount(q.sim, lead.rid, 'extinguisher')).toBe(1);      // 12초를 다 쓰지 않았다
  });
  it('소화기 12초를 다 쓰고도 불이 남으면 하나를 쓴 것이고(kitCount 0), 손을 뗀다 — 작업은 열린 채(다른 대원이 맡는다)', () => {
    const q = sceneWith('R2-TRAF', 'traffic', ['patrol']);
    const lead = q.role('patrolLead');
    for (const a of q.s.agents) if (a !== lead) a.status = 'left';
    q.s.fire.fill(0);
    const { r, tiles } = smallFire(q.s, lead, 0.35, 6);
    for (const i of tiles) q.s.fuel[i] = 1;
    believeFire(q, r, 0.2);
    const w = work(q.sim, q.s, 'suppress', { region: r }), t = taskFor(lead, w);
    const n = q.sim.events.length;
    // 불이 줄지 않게 매 틱 되살린다 (넓게 번진 작은 불)
    for (let k = 0; k < 40 * 5 && lead.task === t; k++) { q.sim.tick++; q.sim.t = q.sim.tick * q.sim.dt; for (const i of tiles) q.s.fire[i] = Math.max(q.s.fire[i], 0.3); act(q.sim, q.s, lead); }
    expect(lead.task).not.toBe(t);
    expect(kitCount(q.sim, lead.rid, 'extinguisher')).toBe(0);
    expect(texts(q.sim, n).some((x) => x.startsWith('소화기를 다 썼습니다.'))).toBe(true);
    expect(w.status === 'open' || w.status === 'active').toBe(true);
    expect(q.I.methods!.some((u) => u.method === 'extinguisher' && !u.ok)).toBe(true);
  });
  it('배연: 송풍기를 출입구에 6초 설치(s.fan 120초) — 방법 기록 뒤 내부 공격으로 예정된 전환(접은 줄·기억 없음). 송풍기는 실내 연기를 빼고 센 불을 조금 키우며, 끝나면 사라진다', () => {
    const q = sceneWith('R2-FIRE', 'fire', ['ladder']);
    const lop = q.role('ladderOp');
    for (const a of q.s.agents) if (a !== lop) a.status = 'left';
    const r = roomWith(q.s, false) >= 0 ? roomWith(q.s, false) : roomWith(q.s, true);
    believeFire(q, r, 0.4);
    const reg = q.s.regions[r], i0 = reg.tiles[Math.floor(reg.tiles.length / 2)];
    lop.x = lop.px = i0 % q.s.w; lop.y = lop.py = (i0 / q.s.w) | 0; lop.path = null;
    q.s.smoke[i0] = 0.8;
    const t = taskFor(lop, work(q.sim, q.s, 'suppress', { region: r }));
    const n = q.sim.events.length;
    soloRun(q.sim, q.s, lop, 60, () => q.s.fan != null);
    expect(q.s.fan).toMatchObject({ rid: lop.rid, power: 1 });
    expect(q.s.fan!.until).toBeCloseTo(q.sim.t + 120, 6);
    expect(q.s.exits.some((e) => e.x === q.s.fan!.x && e.y === q.s.fan!.y)).toBe(true);
    expect(t.method).toBe('interior');
    expect(q.I.methods!.map((u) => [u.method, u.ok])).toEqual([['ventilate', true]]);
    expect(lop.mfail ?? []).toEqual([]);
    expect(texts(q.sim, n)).toContain('추가 위험이 있습니다. 송풍기를 설치해 연기를 빼겠습니다.');
    // 세계 규칙: 1초에 한 번 실내 연기 ×0.8 · 센 불 +0.006
    const ind = reg.tiles[0];
    q.s.smoke[ind] = 0.5; q.s.fire[ind] = 0.6;
    q.sim.tick += 5 - ((q.sim.tick + q.s.id) % 5); q.sim.t = q.sim.tick * q.sim.dt;
    methodsRule(q.sim, q.s, q.I);
    expect(q.s.smoke[ind]).toBeCloseTo(0.4, 6); expect(q.s.fire[ind]).toBeCloseTo(0.606, 6);
    q.sim.t = q.s.fan!.until + 0.1; methodsRule(q.sim, q.s, q.I);
    expect(q.s.fan).toBeNull();
  });
  it('송풍기의 숨은 고장은 설치하러 출입구에 닿았을 때 드러난다 — 장비 고장(EQUIP_FAIL) 뒤 내부 공격으로, 송풍기는 돌지 않는다', () => {
    const q = sceneWith('R2-FIRE', 'fire', ['ladder']);
    const lop = q.role('ladderOp');
    for (const a of q.s.agents) if (a !== lop) a.status = 'left';
    q.sim.responders[lop.rid].kit!.find((it) => it.id === 'fan')!.fault = true;
    const r = roomWith(q.s, false) >= 0 ? roomWith(q.s, false) : roomWith(q.s, true);
    believeFire(q, r, 0.4);
    const reg = q.s.regions[r], i0 = reg.tiles[0];
    lop.x = lop.px = i0 % q.s.w; lop.y = lop.py = (i0 / q.s.w) | 0; lop.path = null; q.s.smoke[i0] = 0.8;
    const t = taskFor(lop, work(q.sim, q.s, 'suppress', { region: r }));
    soloRun(q.sim, q.s, lop, 60, () => t.method !== 'ventilate' && t.method !== undefined);
    expect(t.method).toBe('interior'); expect(t.mwhy).toBe('broken');
    expect(q.s.fan ?? null).toBeNull();
    expect(q.I.problems.some((p) => p.code === 'EQUIP_FAIL')).toBe(true);
  });
  it('외부 방수·고가 방수의 물줄기는 s.rng 를 쓰지 않는다 (흔들림은 고정 오프셋) — 지금의 내부 공격은 그대로 s.rng 로 흩뜨린다', () => {
    const q = sceneWith('R2-FIRE', 'fire', ['engine']);
    const noz = q.role('nozzle');
    for (const a of q.s.agents) if (a !== noz) a.status = 'left';
    const r = roomWith(q.s, true);
    const spot = exteriorSpotsOf(q.s, r);
    expect(spot).toBeGreaterThanOrEqual(0);
    // 그 자리에서 보이는 칸에 불
    const reg = q.s.regions[r], sx = spot % q.s.w, sy = (spot / q.s.w) | 0;
    const vis = reg.tiles.find((i) => Math.hypot(i % q.s.w - sx, ((i / q.s.w) | 0) - sy) <= 5.4 && losOk(q.s, sx, sy, i % q.s.w, (i / q.s.w) | 0))!;
    q.s.fire.fill(0); q.s.fire[vis] = 0.9; q.s.fuel[vis] = 1;
    believeFire(q, r, 1.0, 0.9); clearCasIn(q, r);
    noz.x = noz.px = sx; noz.y = noz.py = sy; noz.path = null;
    const t = taskFor(noz, work(q.sim, q.s, 'suppress', { region: r }));
    const rs = peek(q.s.rng);
    soloRun(q.sim, q.s, noz, 2, () => false);
    expect(t.method).toBe('defensive');
    expect(q.s.fx.some((f) => f.kind === 'spray')).toBe(true);
    expect(peek(q.s.rng)).toBe(rs);
    expect(q.s.fire[vis]).toBeLessThan(0.9);
  });
  it('(X6) 진실의 지휘 상태가 외부 방어면 X6 의 외부 방수가 먼저다 — 배연을 골랐던 대원도 송풍기를 놓지 않는다', () => {
    const q = sceneWith('R2-FIRE', 'fire', ['ladder']);
    const lop = q.role('ladderOp');
    for (const a of q.s.agents) if (a !== lop) a.status = 'left';
    const r = roomWith(q.s, true);
    believeFire(q, r, 0.4);
    q.s.ops = { ...newOps(q.sim.t), mode: 'defensive' };
    const t = taskFor(lop, work(q.sim, q.s, 'suppress', { region: r }));
    t.method = 'ventilate'; t.mt0 = q.sim.t; t.mwhy = 'danger';
    soloRun(q.sim, q.s, lop, 20, () => lop.task !== t);
    expect(q.s.fan ?? null).toBeNull();
  });
  it('(X6 가스 모델) 돌고 있는 송풍기는 그 출입구 3칸 안의 가스를 × (1 − 0.3 × power) 로 뺀다', () => {
    const mk = (fan: boolean): number => {
      const sim = new Sim('R2-GASFAN', FULL);
      const I = createIncident(sim, { type: 'hazmat', rng: sim.rng.fork('t') });
      const s = sim.scenes[I.id]!, c = catOf(sim, s)!;
      const v = s.props.find((p) => p.kind === 'valve')!;
      if (fan) s.fan = { x: v.x, y: v.y, until: 1e9, rid: -1, power: 1 };
      for (let k = 0; k < 25; k++) { sim.tick += 5; sim.t = sim.tick * sim.dt; catTick(sim, s, I, c); }
      let sum = 0;
      for (let i = 0; i < c.gas!.length; i++) if (Math.hypot(i % s.w - v.x, ((i / s.w) | 0) - v.y) <= 3) sum += c.gas![i];
      return sum;
    };
    const off = mk(false), on = mk(true);
    expect(off).toBeGreaterThan(0);
    expect(on).toBeLessThan(off * 0.8);
  });
});

describe('R2 단계 4: 강제 교대 (§8 의 3·6 · 화재 3가지)', () => {
  it('건물 화재 강제: 내부 공격 말고도 외부 방수·고가 방수·배연 가운데 둘 이상이 성공 방법에 있고, 재현성이 지켜진다', () => {
    const ok = new Set<MethodId>();
    for (const seed of ['F0', 'F1', 'F2']) {
      const sim = new Sim(seed, NORMAL, 1200, { force: 'fire/std' }); sim.runToEnd();
      for (const I of sim.incidents) for (const u of I.methods ?? []) if (u.ok && u.work === 'suppress') ok.add(u.method);
      if (seed === 'F0') { const again = new Sim(seed, NORMAL, 1200, { force: 'fire/std' }); again.runToEnd(); expect(again.report!.hash).toBe(sim.report!.hash); }
    }
    expect(ok.has('interior')).toBe(true);
    expect([...ok].filter((m) => m === 'defensive' || m === 'aerial' || m === 'ventilate').length).toBeGreaterThanOrEqual(2);
  }, 90000);
});
