// R3 분야별 대응 교본 (docs/specs/R3-doctrine.md §10). 단계 0 (틀): 시험 1(정보 격리 — 글자) · 5(재현성과 순수 함수) · 8(표 모양 — 줄이 없어도 통과).
// 단계 0 에는 교본 줄이 하나도 없다. 엔진의 갈래는 시험이 줄을 잠깐 등록해서 본다(withRules — 끝나면 지운다).
// 줄을 구현하는 단계(1~6)가 §10 의 2·3·4·6·7·9 를 이 파일에 더하고, "단계 0" 이라고 적힌 묶음을 자기 단계에 맞게 고친다.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NORMAL } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { casFact, fitFor } from '../src/sim/field/agents';
import {
  DOC, PAIRS, SOLO_OK, ZERO_SENSE, buddyOf, coverSpot, coverTileAt, docAct, docCtx, docDeptOf, docDrop, docDuty, docFit, docFitRules, docForget, docGate,
  docMethodMul, docRetreat, docSit, hasDoc, outsideWatch, phaseOf, stateReported, stateSelf, watchNeed,
} from '../src/sim/field/doctrine';
import { CMD_ROWS, DOCTRINE, DOC_DEPTS_DONE, registerDoctrine } from '../src/sim/field/doctrine/registry';
import type { DoctrineRule } from '../src/sim/field/doctrine/registry';
import { recordDoc } from '../src/sim/field/doctrineRun';
import { makeTask } from '../src/sim/field/executor';
import { crewHas, gunOf, groupOf, kitHas, kitQty, roleIdOf } from '../src/sim/field/gear';
import { staticPass } from '../src/sim/field/grid';
import { unitArrived } from '../src/sim/field/sceneManager';
import { createIncident } from '../src/sim/incidents';
import { STAFF, minCrew } from '../src/sim/crews';
import type { DocDept, FieldAgent, Incident, IncidentType, Scene, UnitKind, WorkItem, WorkKind } from '../src/sim/types';

// ───────────────────────── 도구 ─────────────────────────
const FULL: Difficulty = { ...NORMAL, resources: 5 };      // 모든 부대가 편성된다
/** 주석 줄을 뺀 소스 (tests/methods.test.ts 와 같은 방식: //, /*, * 로 시작하는 줄) */
const code = (path: string): string => readFileSync(new URL(path, import.meta.url), 'utf8').split('\n').filter((l) => { const t = l.trim(); return !t.startsWith('//') && !t.startsWith('*') && !t.startsWith('/*'); }).join('\n');
const importLines = (src: string): string[] => src.split('\n').filter((l) => /^\s*import\b/.test(l));
/** 난수 흐름의 다음 값 (사본에서 본다 — 원본은 소비하지 않는다) */
const peek = (r: unknown): number => { if (!r) return -1; const c = Object.create(Object.getPrototypeOf(r)); Object.assign(c, r); return c.next(); };
/** 현장을 하나 만들고 부대를 내려 세운다. 모든 대원이 모든 구조 대상을 본 것으로 둔다(믿음) */
function sceneWith(seed: string, what: string, kinds: UnitKind[]): { sim: Sim; I: Incident; s: Scene; of: (kind: UnitKind) => FieldAgent[] } {
  const sim = new Sim(seed, FULL);
  for (const r of sim.responders) for (const it of r.kit!) it.fault = false;      // 고장은 시험이 직접 준다
  const [type, variant] = what.split('/');
  const I = createIncident(sim, { type: type as IncidentType, variant: variant || undefined, rng: sim.rng.fork('t') });
  const s = sim.scenes[I.id]!;
  for (const kind of kinds) unitArrived(sim, I, sim.units.find((u) => u.kind === kind)!);
  for (const a of s.agents) for (const c of s.casualties) a.beliefs.merge(casFact(sim, s, c, '시험'));
  return { sim, I, s, of: (kind) => s.agents.filter((a) => sim.units[a.unitId].kind === kind) };
}
const work = (sim: Sim, s: Scene, kind: WorkKind, tg: Partial<WorkItem> = {}): WorkItem => {
  const w: WorkItem = { id: s.board.length, kind, region: -1, cas: -1, prop: -1, hostile: -1, tile: -1, mate: -1, priority: 0.8, status: 'active', assignees: [], max: 1,
    createdAt: sim.t, doneAt: -1, note: '', fails: 0, holdUntil: 0, thorough: false, orderSentAt: {}, cause: -1, failedAt: {}, ...tg };
  s.board.push(w);
  return w;
};
/** 시험 동안만 줄을 등록한다 (단계 0 에는 줄이 없다). 끝나면 지우고 담아 둔 상태를 버린다 */
function withRules<V>(rules: DoctrineRule[], fn: () => V): V {
  const n = DOCTRINE.length;
  registerDoctrine(...rules);
  docForget();
  try { return fn(); } finally { DOCTRINE.splice(n); docForget(); }
}
/** 엔진의 갈래를 모두 지나가는 시험용 줄 (번호 G91~G98 — 표에 없는 번호, 시험이 끝나면 지운다) */
const PROBE: DoctrineRule[] = [
  { id: 'G91', dept: 'common', name: '시험 적합도', short: '시험 적합도', hook: 'fit', when: (c) => c.st.air <= 1 && c.sit.kind === c.s.kind && c.st.stamina >= 0, effect: [{ kind: 'fitMul', mul: 0.5 }, { kind: 'fitAdd', add: 0.1 }], rank: 3, why: 'kit' },
  { id: 'G92', dept: 'common', name: '시험 의무', short: '시험 의무', hook: 'duty', kits: ['scba'], when: (c) => c.st.air < DOC.AIR_OUT, effect: { kind: 'duty', act: 'airOut' }, rank: 0, why: 'lowAir' },
  { id: 'G93', dept: 'common', name: '시험 행동', short: '시험 행동', hook: 'act', when: (c) => c.st.hasScba, effect: { kind: 'act', act: 'pair', score: (c) => 0.5 + 0.01 * c.st.mates }, rank: 2, why: 'buddy' },
  { id: 'G94', dept: 'common', name: '시험 방법', short: '시험 방법', hook: 'method', methods: ['interior', 'defensive'], when: () => true, effect: { kind: 'methodMul', mul: 0.5 }, rank: 3, why: 'kit' },
  { id: 'G95', dept: 'common', name: '시험 판단', short: '시험 판단', hook: 'gate', gate: 'closeIn', when: (c) => c.mode === 'self', effect: { kind: 'block', maxWait: (c) => (c.st.backup ? 30 : 20) }, rank: 2, why: 'alone' },
  { id: 'G96', dept: 'common', name: '시험 고르기', short: '시험 고르기', hook: 'gate', gate: ['coverFire'], when: () => true, effect: { kind: 'choose', opt: 'cover' }, rank: 1, why: 'danger' },
  { id: 'G97', dept: 'common', name: '시험 바꿔 끼우기', short: '시험 바꿔 끼우기', hook: 'act', swap: 'retreat', when: (c) => c.dng > 0, effect: { kind: 'act', act: 'cover', score: (c) => c.dng }, rank: 1, why: 'danger' },
  { id: 'G98', dept: 'common', name: '시험 놓기', short: '시험 놓기', hook: 'fit', works: ['suppress'], when: () => true, effect: { kind: 'fitMul', mul: 0, drop: true }, rank: 1, why: 'lowAmmo' },
];
const SIM = '../src/sim/';
const RULE_FILES = ['common', 'police', 'fire', 'ems', 'special'].map((n) => `${SIM}field/doctrine/${n}.ts`);
const DOC_FILES = [`${SIM}field/doctrine.ts`, ...readdirSync(new URL(`${SIM}field/doctrine/`, import.meta.url)).map((f) => `${SIM}field/doctrine/${f}`), `${SIM}field/orders/doctrine.ts`,
  ...(existsSync(new URL(`${SIM}dispatch/doctrine.ts`, import.meta.url)) ? [`${SIM}dispatch/doctrine.ts`] : [])];

// ───────────────────────── 시험 1: 정보 격리 (글자) ─────────────────────────
describe('R3 시험 1: 교본의 판단부는 진실을 읽지 않는다 (글자)', () => {
  it('판단부·줄·지휘 교본 파일의 주석이 아닌 줄에 진실·숨은 고장·효과 함수의 이름이 없다', () => {
    expect(DOC_FILES.length).toBeGreaterThanOrEqual(9);
    expect(code(`${SIM}field/doctrine.ts`).length).toBeGreaterThan(5000);
    const BAD = ['s.props', 's.propAt', 's.casualties', 's.hostiles', '.truth', '.pursuit', 's.fire[', 's.smoke[', 'sim.scenes', 's.variant', '.fault', 'kitWorks', 'useKit', 'toolUse', 'bestTool', 'needsHospital'];
    for (const f of DOC_FILES) { const src = code(f); for (const bad of BAD) expect(src.includes(bad), `${f}: ${bad}`).toBe(false); }
  });
  it('doctrine.ts 에서 몸(.health·.bleed·.injuries)이 나오는 줄은 모두 stateSelf 의 몸 안이다', () => {
    const lines = code(`${SIM}field/doctrine.ts`).split('\n');
    const at = lines.findIndex((l) => /^export function stateSelf\(/.test(l));
    expect(at).toBeGreaterThanOrEqual(0);
    let end = at + 1;
    while (end < lines.length && !/^}/.test(lines[end])) end++;
    expect(end).toBeLessThan(lines.length);
    const body = lines.slice(at, end + 1).join('\n'), rest = [...lines.slice(0, at), ...lines.slice(end + 1)].join('\n');
    expect(/\.health\b/.test(body), 'stateSelf 가 자기 체력을 읽는다').toBe(true);
    expect(rest.match(/\.(health|bleed|injuries)\b/g) ?? []).toEqual([]);
  });
  it('doctrine.ts 는 agents·executor·hazards·methods·methodRun·doctrineRun·crews 를 값으로 import 하지 않는다 (import type 은 된다)', () => {
    const vals = importLines(code(`${SIM}field/doctrine.ts`)).filter((l) => /^import (?!type )/.test(l)).join('\n');
    for (const bad of ['./agents', './executor', './hazards', './methods', './methodRun', './doctrineRun', '../crews']) expect(vals.includes(`'${bad}'`), bad).toBe(false);
    expect(vals).toContain("'./gear'");
    // gear.ts 에서 판단용 함수만 가져온다
    const gearLine = vals.split('\n').find((l) => l.includes("'./gear'"))!;
    for (const bad of ['kitTool', 'bestTool', 'kitWorks', 'useKit']) expect(gearLine.includes(bad), bad).toBe(false);
  });
  it('줄 파일에는 sim.responders 가 없고, ./registry 와 타입·util 만 import 한다. registry.ts 는 타입만 import 하는 잎 모듈이다', () => {
    for (const f of RULE_FILES) {
      const src = code(f);
      expect(src.includes('sim.responders'), f).toBe(false);
      for (const l of importLines(src)) {
        const from = /from '([^']+)'/.exec(l)?.[1] ?? '';
        if (/^\s*import type /.test(l)) expect(['./registry', '../../types', '../../engine'].indexOf(from), `${f}: ${l}`).toBeGreaterThanOrEqual(0);
        else expect(['./registry', '../../util'].indexOf(from), `${f}: ${l}`).toBeGreaterThanOrEqual(0);
      }
    }
    for (const l of importLines(code(`${SIM}field/doctrine/registry.ts`))) expect(/^\s*import type /.test(l), l).toBe(true);
  });
  it('지휘 교본(orders/doctrine.ts)에 남의 몸(.health·.bleed·.dead·.injuries)이 없다', () => {
    expect(/\.(health|bleed|dead|injuries)\b/.test(code(`${SIM}field/orders/doctrine.ts`))).toBe(false);
  });
  it('대원 정보창의 교본 칸(ui/DoctrineRows.tsx)은 이름표(registry)와 기록만 읽는다 — 판단·실행 함수를 부르지 않는다', () => {
    const src = code('../src/ui/DoctrineRows.tsx');
    for (const bad of ["'../sim/field/doctrine'", 'doctrineRun', 'docFit', 'docAct', 'docDuty', 'docGate', 'docCtx', 'recordDoc', 'docBegin']) expect(src.includes(bad), bad).toBe(false);
  });
});

// ───────────────────────── 시험 5: 재현성과 순수 함수 ─────────────────────────
describe('R3 시험 5: 재현성과 순수 함수', () => {
  const cases: [string, string | null][] = [['D0', null], ['D1', 'fire/std'], ['D2', 'armed/hostage']];
  const shift = (seed: string, f: string | null): Sim => { const sim = new Sim(seed, NORMAL, 1200, { force: f }); sim.runToEnd(); return sim; };
  const first = cases.map(([seed, f]) => shift(seed, f));
  it('같은 시드 두 번의 report.hash 가 같다 — 보통 교대, fire/std·armed/hostage 강제', () => {
    for (let q = 0; q < cases.length; q++) expect(shift(cases[q][0], cases[q][1]).report!.hash, cases[q][0]).toBe(first[q].report!.hash);
  });
  it('단계 0: 줄이 없어 교본 기록·상태 칸을 아무것도 채우지 않는다', () => {
    expect(DOCTRINE.length).toBe(0);
    expect(CMD_ROWS.length).toBe(0);
    for (const h of ['fit', 'duty', 'act', 'method', 'gate'] as const) expect(hasDoc(h), h).toBe(false);
    for (const sim of first) {
      expect(sim.report!.doctrine).toBeUndefined(); expect(sim.report!.docSplit).toBeUndefined();
      for (const I of sim.incidents) { expect(I.docs).toBeUndefined(); expect(I.trackBy).toBeUndefined(); expect(I.reportedPrev).toBeUndefined(); }
      for (const s of sim.scenes) if (s) {
        expect(s.triageAt).toBe(-1); expect(s.laneShield).toBeNull();
        for (const a of s.agents) {
          expect(a.buddy).toBe(-1); expect(a.doc).toBeNull(); expect(a.docMem).toBeUndefined(); expect(a.shaken).toBeUndefined(); expect(a.reloadUntil).toBeUndefined(); expect(a.crewSig).toBeUndefined();
          if (a.task) { expect(a.task.docRule).toBeUndefined(); expect(a.task.gateAt).toBe(-1); }
        }
      }
      for (const u of sim.units) { expect(u.ammoBox).toBeUndefined(); expect(u.sparePump).toBeUndefined(); }
    }
  });
  it('줄이 없으면 걸리는 자리가 그대로 돌려준다 — docFit 은 받은 값, 의무·행동·놓기는 null, 방법 배율 1, 판단 지점은 통과', () => {
    const { sim, s, of } = sceneWith('R3-PASS', 'fire/std', ['engine', 'rescue', 'als', 'patrol']);
    const works = (['search', 'suppress', 'carry', 'treat', 'traffic', 'perimeter', 'hookup'] as WorkKind[]).map((k) => work(sim, s, k, { region: s.regions.findIndex((r) => r.indoor), cas: k === 'carry' || k === 'treat' ? 0 : -1, prop: k === 'hookup' ? s.agents[0].unitId : -1 }));
    expect(of('engine').length).toBeGreaterThan(0);
    for (const a of s.agents) {
      for (const w of works) for (const v of [0, 0.02, 0.37, 1.05]) expect(docFit(sim, s, a, w, v)).toBe(v);
      for (const w of works) { const d = docFitRules(sim, s, a, w, 0.5); expect(d).toEqual({ fit: 0.5, base: 0.5, hits: [] }); }
      expect(docDuty(sim, s, a)).toBeNull(); expect(docAct(sim, s, a, ZERO_SENSE, 0.5)).toBeNull(); expect(docRetreat(sim, s, a, 0.9)).toBeNull();
      a.task = makeTask('search', '시험', works[0]); expect(docDrop(sim, s, a)).toBeNull(); a.task = null;
      expect(docGate(sim, s, a, 'closeIn')).toEqual({ ok: true, rule: null, wait: 0, opt: null });
      for (const m of ['interior', 'defensive', 'swim', 'rope'] as const) expect(docMethodMul(docCtx(sim, s, a, 'self'), m)).toBe(1);
      expect(buddyOf(sim, s, a)).toBeNull();      // 단계 0 에는 짝을 맺지 않는다 (makeAgent 의 -1)
    }
  });
  it('docCtx·docFit·docAct·docDuty·docGate·docMethodMul·coverSpot·buddyOf·outsideWatch 를 백 번 불러도 상태가 바뀌지 않는다 — 시험용 줄이 있어도', () => {
    const { sim, I, s, of } = sceneWith('R3-PURE', 'fire/std', ['engine', 'rescue', 'als', 'patrol', 'ladder']);
    const eng = of('engine'), nozzle = eng.find((a) => sim.responders[a.rid].role === 'nozzle')!;
    const reg = s.regions.findIndex((r) => r.indoor);
    const wSearch = work(sim, s, 'search', { region: reg }), wSup = work(sim, s, 'suppress', { region: reg });
    // 짝을 손으로 맺는다 (pairUp 은 3단계) — buddyOf·outsideWatch 의 갈래를 지나가게
    const fl = eng.find((a) => sim.responders[a.rid].role === 'fireLead')!;
    nozzle.buddy = fl.rid; fl.buddy = nozzle.rid;
    // 한 사람은 공기를 낮춰 의무 갈래를 지나가게, 한 사람은 진압 중이라 놓기 갈래를 지나가게 (상태는 이 다음부터 잰다)
    const air = sim.responders[fl.rid].kit!.find((k) => k.id === 'scba')!;
    air.uses = 0.2 * sim.tune.airFull;
    nozzle.task = makeTask('suppress', '시험', wSup);
    const ex = s.exits[0];
    withRules(PROBE, () => {
      const snap = (): string => JSON.stringify([
        sim.responders.map((r) => r.kit), sim.responders.map((r) => [r.health, r.stamina, r.status]), peek(sim.rng), peek(s.rng),
        s.agents.map((a) => [a.buddy, a.docMem, a.doc, a.shaken, a.crewSig, a.reloadUntil, a.task && a.task.kind, a.x, a.y, peek(a.rng), a.beliefs.facts.size, a.outbox.length]),
        sim.events.length, sim.logHash, s.board.map((w) => [w.status, w.assignees, w.fails, w.holdUntil]), I.docs, s.radio.length,
      ]);
      const once = (): string => JSON.stringify(s.agents.map((a) => [
        docFit(sim, s, a, wSearch, 0.6), docFit(sim, s, a, wSup, 0.6), docDuty(sim, s, a)?.rule.id ?? null, docAct(sim, s, a)?.score ?? null, docRetreat(sim, s, a, 0.7)?.score ?? null,
        docDrop(sim, s, a)?.id ?? null, docGate(sim, s, a, 'closeIn'), docGate(sim, s, a, 'coverFire'), docMethodMul(docCtx(sim, s, a, 'self', wSup), 'interior'), docMethodMul(docCtx(sim, s, a, 'report', wSup), 'swim'),
        buddyOf(sim, s, a)?.rid ?? -1, buddyOf(sim, s, a, wSearch)?.rid ?? -1, outsideWatch(sim, s, a, ex), watchNeed(sim, s), phaseOf(sim, s, a), docDeptOf(sim, a.rid),
        coverSpot(s, a.x, a.y, ex.x, ex.y, true), coverSpot(s, a.x, a.y, ex.x, ex.y, false), docSit(sim, s, a).inHazard,
      ]));
      const before = snap();
      const v0 = once();
      for (let k = 0; k < 100; k++) { expect(once()).toBe(v0); if (k % 25 === 0) docForget(); }
      expect(snap()).toBe(before);
      // 엔진의 규칙 (§2.6): fit 은 곱하고 더해 max(0.02, …) · 금지(0)가 이긴다 · 판단 지점은 막은 줄의 가장 긴 상한 · choose 는 막지 않는다 · 방법은 곱한다
      expect(docFit(sim, s, nozzle, wSearch, 0.6)).toBeCloseTo(0.4, 12);
      expect(docFit(sim, s, nozzle, wSup, 0.6)).toBe(0);
      expect(docFit(sim, s, nozzle, wSearch, 0)).toBe(0);      // 교본은 0 인 자격을 열지 못한다
      expect(fitFor(sim, s, nozzle, wSup)).toBe(0);            // fitFor 의 맨 끝에 걸린다
      expect(docDrop(sim, s, nozzle)!.id).toBe('G98');
      expect(docDuty(sim, s, fl)!.act).toBe('airOut');
      expect(docAct(sim, s, nozzle)!.act).toBe('pair');
      expect(docRetreat(sim, s, nozzle, 0.7)).toMatchObject({ act: 'cover', score: 0.7 });
      expect(docGate(sim, s, nozzle, 'closeIn')).toMatchObject({ ok: false, rule: 'G95' });
      expect(docGate(sim, s, nozzle, 'coverFire')).toEqual({ ok: true, rule: null, wait: 0, opt: 'cover' });
      expect(docMethodMul(docCtx(sim, s, nozzle, 'self'), 'interior')).toBe(0.5);
      expect(docMethodMul(docCtx(sim, s, nozzle, 'self'), 'swim')).toBe(1);
      expect(buddyOf(sim, s, nozzle)).toBe(fl);
    });
    // 줄을 지우면 다시 그대로다
    expect(docFit(sim, s, nozzle, wSearch, 0.6)).toBe(0.6);
    expect(DOCTRINE.length).toBe(0);
  });
  it('두 모드: 보고 모드는 남의 체력·출혈을 쓰지 않고(-1·false) 맞고 있는지 모른다, 자기 모드는 자기 몸이다', () => {
    const { sim, s } = sceneWith('R3-MODE', 'armed/hostage', ['patrol', 'tactical']);
    const a = s.agents[0], r = sim.responders[a.rid];
    r.health = 55; r.bleed = 0.1; a.underFireT = sim.t;
    docForget(a);
    const self = stateSelf(sim, s, a), rep = stateReported(sim, s, a);
    expect(self).toMatchObject({ hp: 55, band: 1, bleeding: true, underFire: true });
    expect(rep).toMatchObject({ hp: -1, band: 0, bleeding: false, underFire: false, inCover: false, reloading: false });
    expect(docCtx(sim, s, a, 'report').st.hp).toBe(-1);
    expect(docCtx(sim, s, a, 'self').st.hp).toBe(55);
    // 조직 정보는 두 모드가 같다 (지구력·장비·짝·지원)
    for (const k of ['stamina', 'hasScba', 'air', 'gun', 'ammo', 'buddy', 'mates', 'alone', 'backup'] as const) expect(rep[k], k).toEqual(self[k]);
  });
  it('gear 의 판단용 감싼 함수: 알려진 고장만 반영하고, 탄을 세지 않는 동안(2단계 전)은 무한이다', () => {
    const { sim, s } = sceneWith('R3-GEAR', 'armed/hostage', ['patrol', 'tactical', 'swat', 'engine']);
    const role = (id: string): FieldAgent => s.agents.find((a) => sim.responders[a.rid].role === id)!;
    const off = role('officer'), tac = role('tacOfficer'), mk = role('marksman'), noz = role('nozzle');
    expect(gunOf(sim, off.rid)).toMatchObject({ id: 'pistol', ammo: Infinity });
    expect(gunOf(sim, tac.rid)!.id).toBe('rifle');
    expect(gunOf(sim, mk.rid)!.id).toBe('sniper');
    expect(gunOf(sim, noz.rid)).toBeNull();
    const scba = sim.responders[noz.rid].kit!.find((k) => k.id === 'scba')!;
    expect(kitHas(sim, noz.rid, 'scba')).toBe(true); expect(kitQty(sim, noz.rid, 'scba')).toBe(scba.uses);
    scba.fault = true; expect(kitHas(sim, noz.rid, 'scba'), '숨은 고장은 모른다').toBe(true);
    scba.faultKnown = true; expect(kitHas(sim, noz.rid, 'scba')).toBe(false); expect(kitQty(sim, noz.rid, 'scba')).toBe(0);
    expect(roleIdOf(sim, noz.rid)).toBe('nozzle'); expect(groupOf(sim, noz.rid)).toBe('nozzle');
    const r = sim.responders[off.rid], saved = r.role;
    r.role = undefined; expect(roleIdOf(sim, off.rid)).toBe('officer'); r.role = saved;      // 역할이 없는 명부는 부서별 기본 역할
    expect(crewHas(sim, sim.units[noz.unitId], 'hose')).toBe(true);
    expect(crewHas(sim, sim.units[off.unitId], 'hose')).toBe(false);
  });
  it('분야·짝 표: 사다리차의 팀장·조작원은 특수, 내리지 않는 자리는 부대로. 짝 표의 역할은 그 부대의 편성에 있고 최소 인원 열은 빠지는 자리를 쓰지 않는다', () => {
    const { sim, s } = sceneWith('R3-DEPT', 'fire/std', ['engine', 'ladder', 'rescue', 'als']);
    const by = (role: string): DocDept => docDeptOf(sim, s.agents.find((a) => sim.responders[a.rid].role === role)!.rid);
    expect(by('ladderLead')).toBe('special'); expect(by('nozzle')).toBe('fire'); expect(by('paramedic')).toBe('ems'); expect(by('extricator')).toBe('fire');
    const pilot = sim.responders.find((r) => r.role === 'pilot' && sim.units[r.unitId].kind === 'policeHeli');
    if (pilot) expect(docDeptOf(sim, pilot.id)).toBe('police');
    for (const kind of Object.keys(PAIRS) as UnitKind[]) {
      const std = STAFF[kind].std, min = std.filter((_, k) => STAFF[kind].minDrop.indexOf(k) < 0);
      expect(min.length).toBe(minCrew(kind));
      const check = (cols: [string, string][], roles: string[]): void => {
        const need: Record<string, number> = {};
        for (const [p, q] of cols) { need[p] = (need[p] ?? 0) + 1; need[q] = (need[q] ?? 0) + 1; }
        for (const id of Object.keys(need)) expect(roles.filter((r) => r === id).length, `${kind}: ${id}`).toBeGreaterThanOrEqual(need[id]);
      };
      check(PAIRS[kind]!.std, std); check(PAIRS[kind]!.min, min);
    }
    // 혼자 서는 자리(SOLO_OK)가 짝 표에 들어 있는 것은 남의 짝이 될 수 있는 둘(일반 구급차의 운전원 · 펌프차 밖 대기조의 기관원)뿐이다
    const paired = [...SOLO_OK].filter((id) => Object.values(PAIRS).some((p) => p!.std.some(([a, b]) => a === id || b === id)));
    expect(paired.sort()).toEqual(['emsDriver', 'engineer']);
  });
  it('coverSpot: 고른 자리는 지나갈 수 있고, 위협에서 1.8칸 넘게 떨어져 있고, 위협 쪽 이웃에 엄폐 칸이 있다. 엄폐 사격은 3~7.5칸 고리, 숨기는 대원 둘레 4칸', () => {
    const { s } = sceneWith('R3-COVER', 'armed/hostage', ['patrol']);
    let found = 0, ring = 0, hide = 0;
    // 대원 자리: 현장의 지나갈 수 있는 칸을 3칸 간격으로 (대기 지점에 선 대원은 위협에서 12칸 밖일 수 있다)
    const spots: { x: number; y: number }[] = [];
    for (let y = 0; y < s.h; y += 3) for (let x = 0; x < s.w; x += 3) if (staticPass(s.tiles[y * s.w + x])) spots.push({ x, y });
    for (const h of s.hostiles) for (const a of spots) for (const wantLos of [true, false]) {
      const p = coverSpot(s, a.x, a.y, h.x, h.y, wantLos);
      if (p === null) continue;
      found++; if (wantLos) ring++; else hide++;
      expect(staticPass(s.tiles[p.y * s.w + p.x])).toBe(true);
      const dt = Math.hypot(p.x - h.x, p.y - h.y), da = Math.hypot(p.x - a.x, p.y - a.y);
      expect(dt).toBeGreaterThan(DOC.THREAT_GAP);
      if (wantLos) { expect(dt).toBeGreaterThanOrEqual(DOC.COVER_MIN); expect(dt).toBeLessThanOrEqual(DOC.COVER_MAX); expect(da).toBeLessThanOrEqual(DOC.COVER_REACH); }
      else expect(da).toBeLessThanOrEqual(DOC.HIDE_R);
      const sx = Math.sign(Math.round(h.x) - p.x), sy = Math.sign(Math.round(h.y) - p.y);
      const near = [[p.x + sx, p.y], [p.x, p.y + sy], [p.x + sx, p.y + sy], [p.x + sx, p.y - 1], [p.x + sx, p.y + 1], [p.x - 1, p.y + sy], [p.x + 1, p.y + sy]];
      expect(near.some(([x, y]) => coverTileAt(s, x, y))).toBe(true);
    }
    expect(ring).toBeGreaterThan(0); expect(hide).toBeGreaterThan(0);
  });
  it('recordDoc: 같은 (줄, 대원, 대상)의 기록은 30초 안이면 한 줄로 잇는다 (t1 을 늘린다)', () => {
    const { sim, I, s } = sceneWith('R3-REC', 'armed/dispute', ['patrol']);
    const a = s.agents[0];
    const d1 = recordDoc(sim, I, a, 'P02', 'gate', { gate: 'closeIn', tgt: 'h:0' });
    sim.t += 10; const d2 = recordDoc(sim, I, a, 'P02', 'gate', { gate: 'closeIn', tgt: 'h:0' }, 7, true);
    expect(d2).toBe(d1); expect(d1).toMatchObject({ t1: d1.t + 10, eventId: 7, say: true, mate: -1 });
    sim.t += 31; const d3 = recordDoc(sim, I, a, 'P02', 'gate', { gate: 'closeIn', tgt: 'h:0' });
    expect(d3).not.toBe(d1);
    recordDoc(sim, I, a, 'P02', 'gate', { gate: 'closeIn', tgt: 'h:1' });
    expect(I.docs!.length).toBe(3);
    expect(Object.keys(I.docs![0])).toEqual(Object.keys(I.docs![2]));      // 같은 모양 (선택 칸도 같은 순서)
  });
});

// ───────────────────────── 시험 8: 표 자체 ─────────────────────────
/** 표의 모양을 본다 — 어긋난 곳의 목록 (없으면 빈 배열). 시험용 틀린 줄로 이 함수가 실제로 잡는지도 본다 */
function shapeErrors(rules: DoctrineRule[], cmd: typeof CMD_ROWS, done: DocDept[]): string[] {
  const err: string[] = [];
  const ids = new Set<string>();
  const PLACE = new Set(['{name}', '{mate}', '{new}', '{n}', '{m}', '{k}', '{s}']);
  for (const r of rules) {
    if (!/^[GPFES][0-9]{2}[a-z]?$/.test(r.id)) err.push(`${r.id}: 번호 형식`);
    if (ids.has(r.id)) err.push(`${r.id}: 겹침`);
    ids.add(r.id);
    if (r.id.startsWith('P06') || r.id.startsWith('F15')) err.push(`${r.id}: 지운 번호`);
    const eff = Array.isArray(r.effect) ? r.effect : [r.effect];
    if (!eff.length) err.push(`${r.id}: 효과 없음`);
    if (r.hook === 'gate' && r.gate === undefined) err.push(`${r.id}: gate 줄에 판단 지점이 없다`);
    if (r.hook !== 'gate' && r.gate !== undefined) err.push(`${r.id}: gate 줄이 아닌데 판단 지점`);
    if (r.hook === 'method' && !r.methods && eff.some((e) => e.kind === 'methodMul' && !e.methods)) err.push(`${r.id}: method 줄에 방법이 없다`);
    if ((r.hook === 'act' || r.hook === 'duty') && !eff.some((e) => e.kind === r.hook)) err.push(`${r.id}: ${r.hook} 줄에 행동이 없다`);
    if (r.swap !== undefined && r.hook !== 'act') err.push(`${r.id}: swap 은 act 줄에만`);
    for (const e of eff) {
      if (e.kind === 'choose' && r.hook !== 'gate') err.push(`${r.id}: choose 는 gate 줄에만`);
      const want = { fitMul: 'fit', fitAdd: 'fit', duty: 'duty', act: 'act', methodMul: 'method', block: 'gate', choose: 'gate' }[e.kind];
      if (want !== r.hook) err.push(`${r.id}: ${e.kind} 효과가 ${r.hook} 줄에`);
    }
    for (const t of [r.note ?? '', r.report ?? '']) for (const m of t.match(/\{[^}]*\}/g) ?? []) if (!PLACE.has(m)) err.push(`${r.id}: 자리표시자 ${m}`);
  }
  for (const c of cmd) {
    if (!/^(C[PFES][0-9]|D[0-9])$/.test(c.id)) err.push(`${c.id}: 지휘·관제 번호 형식`);
    if (ids.has(c.id)) err.push(`${c.id}: 겹침`);
    ids.add(c.id);
  }
  for (const d of done) {
    if (d === 'common') continue;
    const n = new Set(rules.filter((r) => r.dept === d).map((r) => r.id.slice(0, 3))).size + cmd.filter((c) => c.dept === d).length;
    if (n < 12) err.push(`${d}: ${n}줄 < 12`);
  }
  const hurt = rules.filter((r) => ['G01', 'P12', 'F14', 'E11'].indexOf(r.id) >= 0);
  const seen = new Set<string>();
  for (const r of hurt) for (const d of r.who?.doc ?? ['*']) { if (seen.has(d)) err.push(`${r.id}: 부상 줄의 who.doc 가 겹친다 (${d})`); seen.add(d); }
  return err;
}
describe('R3 시험 8: 표 자체', () => {
  it('DOCTRINE·CMD_ROWS 의 번호·자리에 맞는 칸·자리표시자·분야별 줄 수·부상 줄의 분야가 맞다 (단계 0 은 줄이 없어 그대로 통과)', () => {
    expect(shapeErrors(DOCTRINE, CMD_ROWS, DOC_DEPTS_DONE)).toEqual([]);
  });
  it('검사 함수가 실제로 틀린 줄을 잡는다', () => {
    const ok = (id: string, x: Partial<DoctrineRule> = {}): DoctrineRule => ({ id, dept: 'police', name: id, short: id, hook: 'fit', when: () => true, effect: { kind: 'fitMul', mul: 1 }, rank: 3, why: 'kit', ...x });
    expect(shapeErrors([ok('P01'), ok('F02', { hook: 'gate', gate: 'roomEntry', effect: { kind: 'block', maxWait: 5 } })], [{ id: 'CP1', dept: 'police', hook: 'cmd', name: 'x', short: 'x', why: 'alone' }], [])).toEqual([]);
    const bad = shapeErrors([
      ok('X01'), ok('P01'), ok('P01'), ok('P06'), ok('P03', { hook: 'gate', effect: { kind: 'block', maxWait: 1 } }), ok('P04', { gate: 'closeIn' }),
      ok('P05', { hook: 'method', effect: { kind: 'methodMul', mul: 0 } }), ok('P07', { hook: 'act' }), ok('P08', { swap: 'retreat' }),
      ok('P09', { effect: { kind: 'choose', opt: 'cover' } }), ok('P10', { note: '{who} 들어간다' }),
      ok('G01', { who: { doc: ['police'] } }), ok('P12', { who: { doc: ['police'] } }),
    ], [{ id: 'C9', dept: 'police', hook: 'cmd', name: 'x', short: 'x', why: 'alone' }, { id: 'P01', dept: 'police', hook: 'cmd', name: 'x', short: 'x', why: 'alone' }], ['fire']);
    for (const want of ['X01: 번호 형식', 'P01: 겹침', 'P06: 지운 번호', 'P03: gate 줄에 판단 지점이 없다', 'P04: gate 줄이 아닌데 판단 지점', 'P05: method 줄에 방법이 없다', 'P07: act 줄에 행동이 없다',
      'P08: swap 은 act 줄에만', 'P09: choose 는 gate 줄에만', 'P10: 자리표시자 {who}', 'C9: 지휘·관제 번호 형식', 'fire: 0줄', 'P12: 부상 줄의 who.doc 가 겹친다 (police)']) expect(bad.some((e) => e.startsWith(want)), want).toBe(true);
  });
  it('줄 파일의 등록 순서는 common → police → fire → ems → special 이고, 지휘 교본·줄 파일이 현장 등록(scenes/index.ts) 끝에서 불린다', () => {
    const idx = importLines(code(`${SIM}field/doctrine/index.ts`)).map((l) => /'\.\/([a-z]+)'/.exec(l)?.[1]);
    expect(idx).toEqual(['common', 'police', 'fire', 'ems', 'special']);
    const scenes = importLines(code(`${SIM}field/scenes/index.ts`)).map((l) => /'([^']+)'/.exec(l)?.[1]);
    expect(scenes.slice(-2)).toEqual(['../doctrine/index', '../orders/doctrine']);
  });
});
