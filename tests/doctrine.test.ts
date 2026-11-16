// R3 분야별 대응 교본 (docs/specs/R3-doctrine.md §10). 단계 0 (틀): 시험 1(정보 격리 — 글자) · 5(재현성과 순수 함수) · 8(표 모양).
// 단계 1 (공통): 시험 2-e(중상 신고가 배정을 바꾼다 — 특수 표 대원의 G01) · 3(남의 몸 — docFit) · 4(중상 간격·동요) · 7(자기 신고의 글·I.docs·요약 줄 — 공기 부분 빼고),
//   그리고 단계 0 의 "줄이 없으면…" 묶음을 1단계의 뜻(공통 다섯 줄만 있다 · 줄을 모두 빼면 그대로)으로 고쳤다.
// 엔진의 갈래는 시험이 줄을 바꿔 끼워서 본다(withRules — 그동안 등록된 줄을 빼 두고 시험용 줄만 넣는다. 끝나면 되돌린다).
// 줄을 구현하는 단계(2~6)가 §10 의 2·3·4·6·7·9 를 이 파일에 더하고, "단계 1" 이라고 적힌 묶음을 자기 단계에 맞게 고친다.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NORMAL } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { casFact, fitFor, fitParts, hosFact, perceive } from '../src/sim/field/agents';
import { think } from '../src/sim/field/brain';
import { chaseRoles, predictNode } from '../src/sim/dispatch/doctrine';
import { setReported } from '../src/sim/pursuit';
import { ORDER_RULES } from '../src/sim/field/sceneRegistry';
import type { CommandKit } from '../src/sim/field/sceneRegistry';
import { P02_WAIT, P07_WAIT } from '../src/sim/field/doctrine/police';
import { mkFact } from '../src/sim/field/beliefs';
import { assign } from '../src/sim/field/commander';
import {
  DOC, PAIRS, SOLO_OK, ZERO_SENSE, bandHyst, buddyOf, coverSpot, coverTileAt, docAct, docCtx, docDeptOf, docDrop, docDuty, docFit, docFitRules, docForget, docGate,
  docMethodMul, docRetreat, docSit, hasDoc, outsideWatch, phaseOf, reported, sigBand, stateReported, stateSelf, watchNeed,
} from '../src/sim/field/doctrine';
import { CMD_ROWS, DOCTRINE, DOC_DEPTS_DONE, registerDoctrine } from '../src/sim/field/doctrine/registry';
import type { DoctrineRule } from '../src/sim/field/doctrine/registry';
import { CREW_TEXT, SHAKE, crewNow, docRemember, fireRound, gunReady, recordDoc, selfReport, shake } from '../src/sim/field/doctrineRun';
import { docLines, docSummary, docTally } from '../src/sim/field/doctrineReport';
import { act, makeTask } from '../src/sim/field/executor';
import { blast } from '../src/sim/field/hazards';
import { NO_SENSE, chooseMethod, sayStart, whyNote } from '../src/sim/field/methods';
import { whyText } from '../src/sim/field/methodReport';
import { crewHas, gunOf, groupOf, kitHas, kitQty, roleIdOf } from '../src/sim/field/gear';
import { los, staticPass } from '../src/sim/field/grid';
import { unitArrived } from '../src/sim/field/sceneManager';
import { createIncident } from '../src/sim/incidents';
import { STAFF, minCrew } from '../src/sim/crews';
import type { CrewBelief, DocDept, FieldAgent, Incident, IncidentType, MethodUse, Scene, UnitKind, WorkItem, WorkKind } from '../src/sim/types';

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
/** 시험 동안만 줄을 바꿔 끼운다: 등록된 줄을 빼 두고 rules 만 넣는다(빈 배열이면 줄이 하나도 없는 상태). 끝나면 되돌리고 담아 둔 상태·색인을 버린다 */
function withRules<V>(rules: DoctrineRule[], fn: () => V): V {
  const saved = DOCTRINE.splice(0);
  registerDoctrine(...rules);
  docForget();
  try { return fn(); } finally { DOCTRINE.splice(0); DOCTRINE.push(...saved); docForget(); }
}
/** 단계 1 에 등록된 줄 (공통 다섯 — 등록 순서) */
const STAGE1 = ['G01', 'G02', 'G02b', 'G03', 'G04'];
/** 단계 2 까지 등록된 줄 (공통 다섯 + 경찰 열넷 — 등록 순서. P17·P17b 는 3단계, P20 은 6단계) */
const STAGE2 = [...STAGE1, 'P01', 'P02', 'P03', 'P05', 'P07', 'P08', 'P09', 'P10', 'P11', 'P12', 'P14', 'P15', 'P16', 'P22'];
/** 단계 2 까지의 지휘·관제·추격 줄 */
const CMD2 = ['CP1', 'CP2', 'CP3', 'CP4', 'D3', 'D6', 'D7', 'D2'];
/** 단계 3 (소방)이 더한 줄 — 공통 G08 은 공통 파일 끝, P17·P17b 는 경찰 파일 끝, F 줄은 소방 파일 (등록 순서) */
const FIRE3 = ['F01', 'F02', 'F03', 'F03b', 'F04', 'F04b', 'F04c', 'F05', 'F05b', 'F06', 'F07', 'F08', 'F09', 'F12', 'F13', 'F14', 'F16'];
const STAGE3 = [...STAGE1, 'G08', ...STAGE2.slice(STAGE1.length), 'P17', 'P17b', ...FIRE3];
/** 단계 3 까지의 지휘·관제 줄 (소방 표의 지휘 줄은 경찰 줄 다음, 관제 D2 앞) */
const CMD3 = ['CP1', 'CP2', 'CP3', 'CP4', 'D3', 'D6', 'D7', 'CF1', 'CF2', 'CF3', 'CF4', 'CF5', 'CF6', 'CF7', 'D5', 'D4', 'D2'];
/** 다른 분야의 단계(4 의료·5 특수)가 나란히 줄을 더해도 깨지지 않게: 이 단계까지의 줄만 골라 순서를 본다 */
const mine = (ids: string[], known: string[]): string[] => ids.filter((id) => known.indexOf(id) >= 0);
/** 자기 신고를 손으로 넣는다 (그 대원의 믿음 — 남이 아는 그 대원의 몸) */
const report = (sim: Sim, a: FieldAgent, v: Partial<CrewBelief>): void => { a.beliefs.merge(mkFact('crew', a.rid, { band: 0, air: 0, ammo: 0, shaken: false, t: sim.t, ...v }, '시험', sim.t, 1, true, '시험')); docForget(a); };
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
  it('단계 3: 줄은 공통 여섯·경찰 열여섯·소방 열일곱, 지휘·관제 줄은 경찰 일곱·소방 아홉·D2. 의무(duty) 줄이 생겼다(F01·F02). 짝을 맺고 펌프차에 예비 펌프가 있다. 뒤 단계의 상태 칸(분류·차량 차단)은 비어 있다', () => {
    expect(mine(DOCTRINE.map((r) => r.id), STAGE3)).toEqual(STAGE3);
    expect(mine(CMD_ROWS.map((c) => c.id), CMD3)).toEqual(CMD3);
    expect(DOC_DEPTS_DONE).toEqual(expect.arrayContaining(['police', 'fire']));
    for (const h of ['fit', 'method', 'act', 'gate', 'duty'] as const) expect(hasDoc(h), h).toBe(true);
    let paired = 0;
    let docs = 0, sig = 0, split = 0;
    for (const sim of first) {
      const sp = sim.report!.docSplit;
      expect(sp).toBeDefined();
      for (const key of Object.keys(sp!)) { expect(key).toMatch(/^(police|fire|ems|special|common)\|[a-z]+\|[A-Za-z]+$/); for (const v of Object.values(sp![key])) { expect(v).toBeGreaterThan(0); split += v; } }
      for (const I of sim.incidents) {
        if (!I.pursuit) { expect(I.trackBy).toBeUndefined(); expect(I.reportedPrev).toBeUndefined(); }
        for (const d of I.docs ?? []) {
          docs++;
          expect(['fit', 'method', 'act', 'gate', 'cmd', 'dispatch', 'chase']).toContain(d.hook);
          expect(DOCTRINE.some((r) => r.id === d.rule) || CMD_ROWS.some((c) => c.id === d.rule), d.rule).toBe(true);
          if (d.hook === 'act' || d.hook === 'duty') expect(['cover', 'rearm', 'airOut', 'pairOut', 'pair', 'triage']).toContain(d.act); else expect(d.act).toBeUndefined();
          if (d.hook === 'gate') expect(['closeIn', 'roomEntry', 'breach', 'coverFire', 'bangUse', 'interiorEntry']).toContain(d.gate); else expect(d.gate).toBeUndefined();
          if (d.hook === 'cmd' || d.hook === 'dispatch' || d.hook === 'chase') expect(d.rid).toBe(-1);
        }
      }
      for (const s of sim.scenes) if (s) {
        expect(s.triageAt).toBe(-1); expect(s.laneShield).toBeNull();
        for (const a of s.agents) {
          expect(a.buddy === -1 || sim.responders[a.buddy!] !== undefined).toBe(true);      // 짝 맺기는 3단계 (pairUp — 부대가 내린 뒤)
          if (a.buddy !== undefined && a.buddy >= 0) { paired++; expect(a.buddy).not.toBe(a.rid); }
          if (a.doc) expect(['cover', 'rearm', 'airOut', 'pairOut', 'pair', 'triage']).toContain(a.doc.act);
          if (a.crewSig !== undefined) { sig++; expect(a.crewSig).toMatch(/^[0-2][0-2][0-2][01]$/); }      // 2단계부터 탄을 센다
          if (a.task && a.task.gateAt !== -1) expect(['closeIn', 'roomEntry', 'breach', 'interiorEntry']).toContain(a.task.gateId);
        }
      }
      for (const u of sim.units) {
        expect(typeof u.ammoBox).toBe('number'); expect(u.ammoBox).toBeGreaterThanOrEqual(0); expect(u.ammoBox).toBeLessThanOrEqual(u.ammoBoxMax!);
        if (u.water !== undefined && u.waterMax > 0) { expect(typeof u.sparePump).toBe('number'); expect(u.sparePump!).toBeGreaterThanOrEqual(0); expect(u.sparePump!).toBeLessThanOrEqual(sim.tune.sparePump); } else expect(u.sparePump).toBeUndefined();      // (3단계) 물을 싣는 부대만
      }
      if (sim.report!.doctrine) expect(Object.keys(sim.report!.doctrine).every((k) => DOCTRINE.some((r) => r.id.startsWith(k)) || CMD_ROWS.some((c) => c.id.startsWith(k)))).toBe(true);
    }
    expect(sig).toBeGreaterThan(0);      // 자기 신고가 있었다 (공기·부상)
    expect(split).toBeGreaterThan(0);
    expect(paired).toBeGreaterThan(0);      // (3단계) 짝을 맺었다
    void docs;
  });
  it('줄을 모두 빼면 걸리는 자리가 그대로 돌려준다 — docFit 은 받은 값, 의무·행동·놓기는 null, 방법 배율 1, 판단 지점은 통과', () => withRules([], () => {
    const { sim, s, of } = sceneWith('R3-PASS', 'fire/std', ['engine', 'rescue', 'als', 'patrol']);
    const works = (['search', 'suppress', 'carry', 'treat', 'traffic', 'perimeter', 'hookup'] as WorkKind[]).map((k) => work(sim, s, k, { region: s.regions.findIndex((r) => r.indoor), cas: k === 'carry' || k === 'treat' ? 0 : -1, prop: k === 'hookup' ? s.agents[0].unitId : -1 }));
    expect(of('engine').length).toBeGreaterThan(0);
    for (const a of s.agents) {
      for (const w of works) for (const v of [0, 0.02, 0.37, 1.05]) expect(docFit(sim, s, a, w, v)).toBe(v);
      for (const w of works) { const d = docFitRules(sim, s, a, w, 0.5); expect(d).toEqual({ fit: 0.5, base: 0.5, hits: [] }); }
      expect(docDuty(sim, s, a)).toBeNull(); expect(docAct(sim, s, a, ZERO_SENSE, 0.5)).toBeNull(); expect(docRetreat(sim, s, a, 0.9)).toBeNull();
      a.task = makeTask('search', '시험', works[0]); expect(docDrop(sim, s, a)).toBeNull(); a.task = null;
      expect(docGate(sim, s, a, 'closeIn')).toEqual({ ok: true, rule: null, wait: 0, opt: null, exc: null });
      for (const m of ['interior', 'defensive', 'swim', 'rope'] as const) expect(docMethodMul(docCtx(sim, s, a, 'self'), m)).toBe(1);
      const bd = buddyOf(sim, s, a); expect(bd === null || bd.rid === a.buddy).toBe(true);      // (3단계) 짝은 줄이 아니라 엔진이 맺는다(pairUp) — 줄이 없어도 쓸 수 있는 짝은 그 짝이다
    }
  }));
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
    const fitBefore = docFit(sim, s, nozzle, wSearch, 0.6), idsBefore = DOCTRINE.map((r) => r.id);      // (3단계) 등록된 줄(소방 줄 포함)이 걸린 값 — 시험용 줄을 뺀 뒤 그대로 돌아오는지 본다
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
      expect(docGate(sim, s, nozzle, 'coverFire')).toEqual({ ok: true, rule: null, wait: 0, opt: 'cover', exc: null });
      expect(docMethodMul(docCtx(sim, s, nozzle, 'self'), 'interior')).toBe(0.5);
      expect(docMethodMul(docCtx(sim, s, nozzle, 'self'), 'swim')).toBe(1);
      expect(buddyOf(sim, s, nozzle)).toBe(fl);
    });
    // 시험용 줄을 빼면 다시 그대로다 (3단계: 짝(팀장)의 공기가 20% 라 관창수의 위험 실내 수색은 짝 없음(F04) — 시험 전의 값과 같다)
    expect(docFit(sim, s, nozzle, wSearch, 0.6)).toBe(fitBefore);
    expect(DOCTRINE.map((r) => r.id)).toEqual(idsBefore);
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
  it('gear 의 판단용 감싼 함수: 알려진 고장만 반영한다. 총기는 2단계부터 탄을 센다(권총 30·탄창 15 · 소총 90·30·두 발 · 저격 15·5), 수량이 없는 총(손으로 만든 명부)은 무한이다', () => {
    const { sim, s } = sceneWith('R3-GEAR', 'armed/hostage', ['patrol', 'tactical', 'swat', 'engine']);
    const role = (id: string): FieldAgent => s.agents.find((a) => sim.responders[a.rid].role === id)!;
    const off = role('officer'), tac = role('tacOfficer'), mk = role('marksman'), noz = role('nozzle');
    expect(gunOf(sim, off.rid)).toEqual({ id: 'pistol', ammo: 30, mag: 15, magSize: 15, perShot: 1, reload: 2 });
    expect(gunOf(sim, tac.rid)).toEqual({ id: 'rifle', ammo: 90, mag: 30, magSize: 30, perShot: 2, reload: 2.5 });
    expect(gunOf(sim, mk.rid)).toEqual({ id: 'sniper', ammo: 15, mag: 5, magSize: 5, perShot: 1, reload: 3 });
    const pi = sim.responders[off.rid].kit!.find((k) => k.id === 'pistol')!;
    pi.uses = undefined; pi.mag = undefined;
    expect(gunOf(sim, off.rid)).toMatchObject({ id: 'pistol', ammo: Infinity, mag: Infinity });
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

// ───────────────────────── 시험 2-e: 중상 신고가 배정을 바꾼다 (단계 1 — 특수 표 대원의 G01. 경찰의 P12 는 2단계가 더한다) ─────────────────────────
describe('R3 시험 2-e: 중상 신고가 배정을 바꾼다 (단계 1 — 특수 표 대원의 G01)', () => {
  /** 특공 대원 둘(A·H)을 역할·능력·장비·자리·지구력까지 똑같이 맞추고 다른 대원은 빼 둔다. 지휘관은 멀리 세운다 */
  function twins(seed: string) {
    const env = sceneWith(seed, 'armed/hostage', ['swat']);
    const { sim, s } = env;
    const cmd = s.agents.find((a) => a.isCommander)!;
    const rest = s.agents.filter((a) => a !== cmd && sim.responders[a.rid].role !== 'marksman');
    const [A, H] = rest;
    const ra = sim.responders[A.rid], rh = sim.responders[H.rid];
    rh.role = ra.role; rh.skills = { ...ra.skills }; rh.experience = ra.experience; rh.stamina = ra.stamina; rh.composure = ra.composure; rh.judgment = ra.judgment;
    rh.kit = ra.kit!.map((k) => ({ ...k }));
    for (const b of s.agents) if (b !== cmd && b !== A && b !== H) b.status = 'withdrawn';
    const ex = s.exits[0];
    A.x = H.x = ex.x; A.y = H.y = ex.y;
    cmd.x = ex.x > s.w / 2 ? 0 : s.w - 1; cmd.y = ex.y > s.h / 2 ? 0 : s.h - 1;
    A.task = H.task = null; A.orderWork = H.orderWork = -1;
    s.board.length = 0;
    docForget();
    return { ...env, cmd, A, H };
  }
  it('중상 신고(band 1)인 대원: 교전 적합도 ×0.35, 봉쇄 +0.15 — 지휘관 배정에서 그 대원이 봉쇄를 받고, 지시 무전 끝에 까닭 말이 붙는다(교본 전의 1등과 달랐다)', () => {
    const { sim, I, s, cmd, A, H } = twins('R3-HURT');
    report(sim, H, { band: 1 });
    const wE = work(sim, s, 'engage', { hostile: s.hostiles[0].id, priority: 0.9 });
    const fe = fitParts(sim, s, H, wE);
    expect(fe.base).toBeGreaterThan(0);
    expect(fe.fit).toBeCloseTo(Math.max(0.02, fe.base * 0.35), 12);
    expect(fitFor(sim, s, H, wE)).toBe(fe.fit);
    expect(fitParts(sim, s, A, wE).fit).toBe(fe.base);      // 다치지 않은 쌍둥이는 교본 전과 같다
    wE.status = 'done';
    const wP = work(sim, s, 'perimeter', { tile: 0, priority: 0.76 });
    const fp = fitParts(sim, s, H, wP);
    expect(fp.fit).toBeCloseTo(fp.base + 0.15, 12);
    expect(fp.hits.map((h) => h.rule.id)).toEqual(['G01']);
    const ev0 = sim.events.length;
    assign(sim, s, I, cmd);
    expect(wP.assignees).toEqual([H.rid]);      // 교본 전에는 같은 점수에서 먼저 선 A 였다
    const order = sim.events.slice(ev0).find((e) => e.kind === 'command' && e.text.startsWith(sim.responders[H.rid].name))!;
    expect(order.text).toContain('(부상 — 가벼운 임무).');
    const d = I.docs!.find((q) => q.rule === 'G01' && q.rid === H.rid)!;
    expect(d).toMatchObject({ hook: 'fit', work: 'perimeter', eventId: order.id, tgt: `w:${wP.id}` });
  });
  it('둘 다 다치지 않았으면(교본 전후의 1등이 같으면) 까닭 말도 기록도 없다', () => {
    const { sim, I, s, cmd, A } = twins('R3-HURT');
    const wP = work(sim, s, 'perimeter', { tile: 0, priority: 0.76 });
    const ev0 = sim.events.length;
    assign(sim, s, I, cmd);
    expect(wP.assignees).toEqual([A.rid]);
    const order = sim.events.slice(ev0).find((e) => e.kind === 'command')!;
    expect(order.text).not.toContain('(');
    expect(I.docs ?? []).toEqual([]);
  });
  it('금지된 대원이 교본 전의 1등이면 그 줄을 밀려난 대원 쪽으로 센다 (지친 대원의 위험 실내 새 일 — G03)', () => {
    const { sim, I, s, of } = sceneWith('R3-TIRED', 'fire/std', ['engine']);
    const eng = of('engine'), cmd = eng.find((a) => a.isCommander)!;
    const reg = s.regions.findIndex((r) => r.indoor);
    s.board.length = 0;
    const wS = work(sim, s, 'search', { region: reg, priority: 0.8 });
    // 교본 전의 1등을 찾고 그 대원을 지치게 한다
    let top: FieldAgent | null = null, ts = -1;
    for (const b of eng) { if (b === cmd) continue; const f = fitParts(sim, s, b, wS).base; if (f > ts) { ts = f; top = b; } }
    for (const b of eng) { b.task = null; b.orderWork = -1; b.x = top!.x; b.y = top!.y; }
    for (const b of eng) if (b !== top) sim.responders[b.rid].stamina = sim.responders[top!.rid].stamina;
    sim.responders[top!.rid].stamina = 25;
    docForget();
    expect(fitFor(sim, s, top!, wS)).toBe(0);
    assign(sim, s, I, cmd);
    expect(wS.assignees.length).toBe(1);
    expect(wS.assignees[0]).not.toBe(top!.rid);
    expect(I.docs!.some((d) => d.rule === 'G03' && d.rid === top!.rid && d.hook === 'fit')).toBe(true);
  });
});

// ───────────────────────── 시험 3: 판단에 새지 않는다 — 남의 몸 (단계 1) ─────────────────────────
describe('R3 시험 3: 남의 몸 — 지휘관이 부르는 fitFor 는 자기 신고 전에는 체력·출혈을 모른다', () => {
  it('체력 85 → 50 · 출혈 0 → 0.1 로 바꿔도 신고 전에는 engage·search·waterRescue·suppress 의 fitFor 가 그대로다. 신고(selfReport)하면 바뀐다', () => {
    const cases: { what: string; kinds: UnitKind[]; pick: (sim: Sim, s: Scene) => { b: FieldAgent; ws: WorkItem[] } }[] = [
      { what: 'armed/hostage', kinds: ['swat', 'patrol'], pick: (sim, s) => { const b = s.agents.find((a) => sim.responders[a.rid].role === 'assaulter')!; return { b, ws: [work(sim, s, 'engage', { hostile: s.hostiles[0].id }), work(sim, s, 'search', { region: s.regions.findIndex((r) => r.indoor) })] }; } },
      { what: 'water/std', kinds: ['engine', 'rescue'], pick: (sim, s) => { const b = s.agents.find((a) => sim.responders[a.rid].role === 'searcher')!; const c = s.casualties.find((q) => q.inWater) ?? s.casualties[0]; return { b, ws: [work(sim, s, 'waterRescue', { cas: c.id })] }; } },
      { what: 'fire/std', kinds: ['engine'], pick: (sim, s) => {
        const b = s.agents.find((a) => sim.responders[a.rid].role === 'nozzle')!;
        sim.responders[b.rid].kit!.find((k) => k.id === 'scba')!.uses = 30;      // 공기가 문턱 아래 — 진압의 적합도가 R2 methodFit(외부 방어의 몸 상태 조건)을 거친다
        return { b, ws: [work(sim, s, 'suppress', { region: s.regions.findIndex((r) => r.indoor) })] };
      } },
    ];
    let changed = 0;
    for (const cs of cases) {
      const { sim, s } = sceneWith('R3-BODY', cs.what, cs.kinds);
      const { b, ws } = cs.pick(sim, s);
      const r = sim.responders[b.rid];
      r.health = 85; r.bleed = 0; docForget();
      const f0 = ws.map((w) => fitFor(sim, s, b, w));
      r.health = 50; r.bleed = 0.1; docForget();
      expect(ws.map((w) => fitFor(sim, s, b, w)), cs.what).toEqual(f0);
      expect(reported(b)).toBeUndefined();
      selfReport(sim, s, b);      // 자기 몸을 신고한다 (다음 판단의 첫머리)
      docForget();
      expect(reported(b)).toMatchObject({ band: 1 });
      if (cs.what === 'armed/hostage') { const f1 = fitFor(sim, s, b, ws[0]); expect(f1).toBeCloseTo(Math.max(0.02, f0[0] * 0.35), 12); changed++; }      // 특수 표 대원의 G01
    }
    expect(changed).toBe(1);
  });
});

// ───────────────────────── 시험 4: 왕복 없음 — 중상 간격·동요 (단계 1) ─────────────────────────
describe('R3 시험 4: 중상 간격과 동요', () => {
  it('중상 간격: 체력을 68 ↔ 72 로 흔들어도 자기 신고 band 가 1 에 머문다(75 에서만 0). 체력 40 은 band 2 (H1 bandOf 와 같다)', () => {
    expect([bandHyst(72, 0), bandHyst(72, 1), bandHyst(74.9, 1), bandHyst(75, 1), bandHyst(70, 0), bandHyst(40, 0), bandHyst(40, 1)]).toEqual([0, 1, 1, 0, 1, 2, 2]);
    const { sim, s } = sceneWith('R3-BAND', 'fire/std', ['engine']);
    const a = s.agents.find((q) => !q.isCommander)!, r = sim.responders[a.rid];
    const seen: number[] = [];
    for (const hp of [68, 72, 69, 73, 71, 74, 76, 72, 40, 60]) { r.health = hp; selfReport(sim, s, a); seen.push(sigBand(a.crewSig)); }
    expect(seen).toEqual([1, 1, 1, 1, 1, 1, 0, 0, 2, 1]);
    expect(reported(a)!.band).toBe(1);
    // 신고는 서명이 바뀔 때만: 같은 몸으로 다시 불러도 믿음의 사실이 그대로다
    const f = a.beliefs.get('crew', a.rid);
    selfReport(sim, s, a);
    expect(a.beliefs.get('crew', a.rid)).toBe(f);
  });
  it('동요: 길이 20 × (1.3 − 침착함), 동요 중에 더 걸어도 늘지 않고, 끝난 뒤 10초 안에는 다시 걸리지 않는다', () => {
    const { sim, s } = sceneWith('R3-SHAKE', 'armed/hostage', ['patrol']);
    const a = s.agents[0], comp = sim.responders[a.rid].composure;
    shake(sim, a);
    const end = sim.t + SHAKE.base * (SHAKE.top - comp);
    expect(a.shaken).toBeCloseTo(end, 9);
    sim.t += 2; shake(sim, a);
    expect(a.shaken).toBeCloseTo(end, 9);
    docForget(a);
    expect(stateSelf(sim, s, a).shaken).toBe(true);
    sim.t = end + 5; selfReport(sim, s, a);
    expect(a.shaken).toBeUndefined(); expect(a.shakenOff).toBeCloseTo(end, 9);
    shake(sim, a);
    expect(a.shaken).toBeUndefined();      // 끝난 뒤 10초 면역
    sim.t = end + SHAKE.immune + 0.5; shake(sim, a);
    expect(a.shaken).toBeCloseTo(sim.t + SHAKE.base * (SHAKE.top - comp), 9);
    // 쓰러진 대원·상공의 관측자에게는 걸지 않는다
    const b = s.agents[1]; b.status = 'down'; shake(sim, b); expect(b.shaken).toBeUndefined();
  });
  it('동요를 거는 자리: 6칸 안에서 동료가 쓰러진 것을 처음 본다(perceive) · 반경 + 3칸 안의 폭발(blast)', () => {
    const { sim, I, s } = sceneWith('R3-SHAKE2', 'armed/hostage', ['patrol', 'tactical']);
    const [a, b, c] = s.agents;
    b.x = a.x + 1; b.y = a.y; b.status = 'down';
    perceive(sim, s, a);
    expect(a.shaken).toBeGreaterThan(sim.t);
    const h0 = sim.responders[c.rid].health;
    blast(sim, s, I, c.x + 3.5, c.y, 1, 30, -1);
    expect(c.shaken).toBeGreaterThan(sim.t);
    expect(sim.responders[c.rid].health).toBe(h0);      // 반경 밖이라 다치지 않았다
  });
  it('교본 기억의 두 뜻: "w:<작업>" = 그 작업을 그 시각까지 맡지 않는다(docFit 0) · 대상 열쇠 = 그 행동 줄을 그 대상에 다시 걸지 않는다', () => {
    const { sim, s, of } = sceneWith('R3-MEM', 'fire/std', ['engine']);
    const a = of('engine').find((q) => sim.responders[q.rid].role === 'nozzle')!;
    const w = work(sim, s, 'suppress', { region: s.regions.findIndex((r) => r.indoor) });
    const f0 = fitFor(sim, s, a, w);
    expect(f0).toBeGreaterThan(0);
    docRemember(sim, a, 'F04c', 'w:' + w.id, 30);
    expect(fitFor(sim, s, a, w)).toBe(0);
    expect(docFitRules(sim, s, a, w, 0.5).fit).toBe(0);
    sim.t += 30.5;
    expect(fitFor(sim, s, a, w)).toBe(f0);
    withRules([{ id: 'G93', dept: 'common', name: '시험 행동', short: '시험 행동', hook: 'act', when: () => true, effect: { kind: 'act', act: 'pair', score: 0.5 }, rank: 2, why: 'buddy' }], () => {
      expect(docAct(sim, s, a)!.rule.id).toBe('G93');
      docRemember(sim, a, 'G93', '', 20);
      docRemember(sim, a, 'G93', '', 10);      // 같은 (줄, 열쇠)는 늦은 쪽으로 — 줄이 하나다
      expect(a.docMem!.filter((m) => m.rule === 'G93').length).toBe(1);
      expect(docAct(sim, s, a)).toBeNull();
      sim.t += 21;
      expect(docAct(sim, s, a)!.rule.id).toBe('G93');
    });
  });
});

// ───────────────────────── 시험 7: 기록 — 자기 신고의 글·I.docs·요약 줄 (단계 1 — 공기 부분은 3단계) ─────────────────────────
describe('R3 시험 7: 기록', () => {
  it('자기 신고의 글은 사실만 — "돌리겠"·"빠집니다"·"하겠습니다" 가 없다', () => {
    const { sim, s } = sceneWith('R3-TEXT', 'fire/std', ['engine']);
    const a = s.agents.find((q) => !q.isCommander)!, r = sim.responders[a.rid];
    const texts: string[] = [...Object.values(CREW_TEXT)];
    const scba = r.kit!.find((k) => k.id === 'scba')!;
    for (const [hp, air] of [[60, 1], [80, 0.45], [80, 0.2], [30, 1], [90, 1]] as [number, number][]) { r.health = hp; scba.uses = air * sim.tune.airFull; selfReport(sim, s, a); texts.push(a.beliefs.get('crew', a.rid)!.text); }
    for (const t of texts) for (const bad of ['돌리겠', '빠집니다', '하겠습니다']) expect(t.includes(bad), t).toBe(false);
    expect(texts).toContain(CREW_TEXT.hurt);
    expect(crewNow(sim, a).air).toBe(0);
  });
  it('교대 보고서: 교본 줄이 쓰인 교대는 요약에 "교본:" 줄, report.doctrine 은 I.docs 의 번호별 횟수, fit 줄의 기록은 그 지시 무전을 가리킨다', () => {
    let sim: Sim | null = null;
    for (const seed of ['S3', 'S0', 'S1', 'S2', 'S4', 'S5']) { const x = new Sim(seed, NORMAL, 1200, { force: 'fire/std' }); x.runToEnd(); if (x.report!.doctrine) { sim = x; break; } }
    expect(sim).not.toBeNull();
    const rep = sim!.report!;
    expect(rep.doctrine).toEqual(docTally(sim!));
    const line = rep.summary.find((l) => l.startsWith('교본:'))!;
    expect(line).toBe(docSummary(rep.doctrine));
    for (const I of sim!.incidents) for (const d of I.docs ?? []) if (d.hook === 'fit' && d.eventId >= 0) {
      const e = sim!.events[d.eventId];
      expect(e.kind).toBe('command');
    }
  });
  it('보고서 문장: I.docs 의 보고서 후보(say)만, 줄의 rank 순으로 최대 2 — 템플릿의 {name}·{n} 을 채운다', () => {
    const { sim, I, s } = sceneWith('R3-LINES', 'armed/dispute', ['patrol']);
    const a = s.agents[0];
    const rules: DoctrineRule[] = [
      { id: 'G90', dept: 'common', name: '시험 문장', short: '시험', hook: 'gate', gate: 'closeIn', when: () => true, effect: { kind: 'block', maxWait: 5 }, rank: 2, why: 'alone', report: '{name} 대원은 {n}초 동안 지원을 기다렸습니다.' },
      { id: 'G89', dept: 'common', name: '시험 문장 둘', short: '시험 둘', hook: 'gate', gate: 'closeIn', when: () => true, effect: { kind: 'block', maxWait: 5 }, rank: 0, why: 'danger', report: '{name} 대원이 먼저 움직였습니다.' },
      { id: 'G88', dept: 'common', name: '시험 문장 셋', short: '시험 셋', hook: 'gate', gate: 'closeIn', when: () => true, effect: { kind: 'block', maxWait: 5 }, rank: 1, why: 'danger' },
    ];
    withRules(rules, () => {
      const d = recordDoc(sim, I, a, 'G90', 'gate', { gate: 'closeIn' }, -1, true);
      sim.t += 12; recordDoc(sim, I, a, 'G90', 'gate', { gate: 'closeIn' }, -1, true);
      recordDoc(sim, I, a, 'G88', 'gate', { gate: 'closeIn' }, -1, true);      // 템플릿이 없다 — 싣지 않는다
      recordDoc(sim, I, a, 'G89', 'gate', { gate: 'closeIn', tgt: 'h:1' }, -1, false);      // 보고서 후보가 아니다
      const name = sim.responders[a.rid].name;
      expect(d.t1 - d.t).toBe(12);
      expect(docLines(sim, I, s)).toEqual([`${name} 대원은 12초 동안 지원을 기다렸습니다.`]);
      recordDoc(sim, I, a, 'G89', 'gate', { gate: 'closeIn' }, -1, true);
      expect(docLines(sim, I, s)).toEqual([`${name} 대원이 먼저 움직였습니다.`, `${name} 대원은 12초 동안 지원을 기다렸습니다.`]);      // rank 0 이 먼저
      expect(docLines(sim, I, s, 1).length).toBe(1);
      expect(docLines(sim, I, s, 0)).toEqual([]);
    });
  });
  it('방법의 까닭 여섯(R3): 동요한 대원이 위험한 방법(헤엄)을 꺼려 1등이 바뀌면 까닭은 shaken, 줄은 G02b — 시작 문구·패널·보고서의 말', () => {
    let pairs = 0;
    for (const seed of ['W1', 'W2', 'W3', 'W4']) {
      const { sim, s } = sceneWith(seed, 'water/std', ['engine', 'rescue']);
      const c = s.casualties.find((q) => q.inWater);
      if (!c) continue;
      for (const a of s.agents) {
        const tg = { cas: c.id, prop: -1, hostile: -1, region: -1, tile: -1 };
        docForget(a);
        const p0 = chooseMethod(sim, s, a, 'waterRescue', tg, null, NO_SENSE, docCtx(sim, s, a, 'self'));
        a.shaken = sim.t + 20; docForget(a);
        const p1 = chooseMethod(sim, s, a, 'waterRescue', tg, null, NO_SENSE, docCtx(sim, s, a, 'self'));
        a.shaken = undefined; docForget(a);
        if (!p0 || !p1) continue;
        if (p0.m === p1.m) { expect(p1.doc).toBeUndefined(); continue; }
        pairs++;
        expect(p1).toMatchObject({ why: 'shaken', doc: 'G02b', skip: p0.m });
        expect(p0.m).toBe('swim');
      }
    }
    expect(pairs).toBeGreaterThan(0);
    expect(sayStart('catch', 'shaken', undefined, 'swim')).toBe('손이 떨려 헤엄은 못 합니다. 하류에서 기다렸다 붙잡겠습니다.');
    expect(sayStart('catch', 'hurt')).toBe('부상으로 방법을 바꿉니다. 하류에서 기다렸다 붙잡겠습니다.');
    expect(['hurt', 'alone', 'lowAir', 'lowAmmo', 'shaken', 'tired'].map((w) => whyNote(w as never))).toEqual(['부상', '혼자', '공기 부족', '탄약 부족', '동요', '지침']);
    const u = { why: 'shaken' } as MethodUse;
    expect(whyText(u)).toBe('동요해');
    expect(whyText({ ...u, why: 'tired' })).toBe('지쳐서');
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

// ───────────────────────── 단계 2 (경찰) — 도구 ─────────────────────────
/** 그 대원(들)만 굴린다 (다른 대원·용의자·세계 규칙은 서 있다): 틱마다 실행기, withThink 면 1초마다 판단도 */
function stepOne(sim: Sim, s: Scene, a: FieldAgent | FieldAgent[], sec: number, withThink = false): void {
  const list = Array.isArray(a) ? a : [a];
  const n = Math.round(sec / sim.dt);
  for (let k = 0; k < n; k++) { sim.tick++; sim.t = sim.tick * sim.dt; for (const b of list) { if (withThink && sim.tick % 5 === 0) think(sim, s, b); act(sim, s, b); } }
}
/** (x, y) 에서 dmin~dmax 떨어진 지나갈 수 있는 빈 칸 (가운데 거리에 가까운 것). see 면 시야선이 닿는 칸만, ok 로 더 거른다 */
function spotAt(s: Scene, x: number, y: number, dmin: number, dmax: number, see: boolean, ok: (tx: number, ty: number) => boolean = () => true): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (let ty = 0; ty < s.h; ty++) for (let tx = 0; tx < s.w; tx++) {
    const i = ty * s.w + tx;
    if (!staticPass(s.tiles[i]) || s.propAt[i] >= 0) continue;
    const d = Math.hypot(tx - x, ty - y);
    if (d < dmin || d > dmax || (see && !los(s, tx, ty, x, y)) || !ok(tx, ty)) continue;
    const sc = Math.abs(d - (dmin + dmax) / 2);
    if (sc < bd) { bd = sc; best = { x: tx, y: ty }; }
  }
  return best;
}
const put = (a: FieldAgent, p: { x: number; y: number }): void => { a.x = a.px = p.x; a.y = a.py = p.y; a.path = null; a.pathGoal = -1; };
const said = (sim: Sim, from: number, rid: number, text: string): boolean => sim.events.slice(from).some((e) => e.rid === rid && e.text.includes(text));
/** 경찰 대원 둘(A·B)과 용의자 하나: 용의자를 그 무기·상태로 두고 두 대원의 믿음에 넣는다. 다른 대원은 빼 둔다 */
function copsScene(seed: string, what: string, kinds: UnitKind[], weapon: 'gun' | 'knife' | 'none', state: 'hold' | 'fight') {
  const env = sceneWith(seed, what, kinds);
  const { sim, s } = env;
  const h = s.hostiles[0];
  h.weapon = weapon; h.state = state; h.stunUntil = -1;
  const cops = s.agents.filter((a) => sim.responders[a.rid].dept === 'police' && sim.responders[a.rid].role !== 'marksman');
  for (const a of s.agents) { a.task = null; a.orderWork = -1; a.isCommander = false; if (cops.indexOf(a) < 0) a.status = 'withdrawn'; }
  for (const a of cops) a.beliefs.merge(hosFact(sim, s, h, '시험', 0));
  docForget();
  return { ...env, h, cops, A: cops[0], B: cops[1] };
}
const noKit = (sim: Sim, a: FieldAgent, ...ids: string[]): void => { const r = sim.responders[a.rid]; r.kit = r.kit!.filter((k) => ids.indexOf(k.id) < 0); };
const giveTask = (sim: Sim, s: Scene, a: FieldAgent, w: WorkItem): void => { a.task = makeTask(w.kind, w.kind, w); if (w.assignees.indexOf(a.rid) < 0) w.assignees.push(a.rid); };

// ───────────────────────── 시험 2-a: 흉기 난동 — 같은 상황, 다른 장비·상태 (closeIn) ─────────────────────────
describe('R3 시험 2-a: 흉기 상대에게 붙기 — 테이저·동료·혼자·시민 (arrest 의 판단 지점 closeIn)', () => {
  it('① 테이저를 든 둘: 테이저를 먼저 쏘고, 무력화되지 않았으면 1.8칸에서 기다린다 (P01)', () => {
    const { sim, I, s, h, A, B } = copsScene('R3-KNIFE', 'armed/dispute', ['patrol'], 'knife', 'fight');
    const w = work(sim, s, 'arrest', { hostile: h.id, priority: 0.86, max: 2 });
    put(A, spotAt(s, h.x, h.y, 3.2, 3.8, true)!);
    put(B, spotAt(s, A.x, A.y, 0.9, 1.6, false, (x, y) => Math.hypot(x - h.x, y - h.y) > 2.5)!);
    giveTask(sim, s, A, w); giveTask(sim, s, B, w);
    const ev0 = sim.events.length;
    stepOne(sim, s, A, 0.4);
    expect(said(sim, ev0, A.rid, '테이저 발사')).toBe(true);
    h.stunUntil = -1; A.taserAt = sim.t;      // 빗나간 것으로 (맞았어도 무력화를 지운다) — 다음 테이저는 4초 뒤
    B.taserAt = sim.t;
    stepOne(sim, s, [A, B], 2);
    expect(A.task!.gateId).toBe('closeIn'); expect(A.task!.docRule).toBe('P01');
    expect(Math.hypot(A.x - h.x, A.y - h.y)).toBeGreaterThan(1.6);
    expect(I.docs!.some((d) => d.rule === 'P01' && d.rid === A.rid && d.gate === 'closeIn')).toBe(true);
    // 무력화가 보이면 둘이 붙는다
    h.stunUntil = sim.t + 3;
    stepOne(sim, s, [A, B], 1.2);
    expect(A.task!.gateId).toBeUndefined();
    expect(Math.hypot(A.x - h.x, A.y - h.y)).toBeLessThan(1.6);
  });
  it('② 테이저 없이 둘, 한 사람이 멀다: 3칸에서 기다렸다가 동료가 오면 함께 붙는다 (P03)', () => {
    const { sim, I, s, h, A, B } = copsScene('R3-KNIFE', 'armed/dispute', ['patrol'], 'knife', 'fight');
    noKit(sim, A, 'taser'); noKit(sim, B, 'taser');
    const w = work(sim, s, 'arrest', { hostile: h.id, priority: 0.86, max: 2 });
    put(A, spotAt(s, h.x, h.y, 6, 9, false)!);
    put(B, spotAt(s, h.x, h.y, 12, 30, false, (x, y) => Math.hypot(x - A.x, y - A.y) > 6)!);
    giveTask(sim, s, A, w); giveTask(sim, s, B, w);
    stepOne(sim, s, A, 3);
    expect(A.task!.docRule).toBe('P03');
    expect(Math.hypot(A.x - h.x, A.y - h.y)).toBeGreaterThan(2.6);
    expect(I.docs!.some((d) => d.rule === 'P03' && d.rid === A.rid)).toBe(true);
    put(B, spotAt(s, A.x, A.y, 0.9, 1.6, false)!);
    stepOne(sim, s, [A, B], 2);
    expect(A.task!.gateId).toBeUndefined();
    expect(Math.hypot(A.x - h.x, A.y - h.y)).toBeLessThan(2);
  });
  it('③ 테이저 없이 혼자: 3칸에서 거리를 두고 상한(P02_WAIT — 시작값 20초를 §8.4 손잡이로 12초) 동안 덮치지 않고, 지원이 없으면 그 뒤 덮친다 (P02) · ④ 시민이 곁에 있으면 바로 (예외)', () => {
    const { sim, I, s, h, A, B } = copsScene('R3-KNIFE', 'armed/dispute', ['patrol'], 'knife', 'fight');
    noKit(sim, A, 'taser');
    B.status = 'withdrawn';
    const w = work(sim, s, 'arrest', { hostile: h.id, priority: 0.86 });
    put(A, spotAt(s, h.x, h.y, 6, 9, false)!);
    giveTask(sim, s, A, w);
    const ev0 = sim.events.length, t0 = sim.t;
    stepOne(sim, s, A, 6);
    expect(A.task!.docRule).toBe('P02');
    expect(said(sim, ev0, A.rid, '흉기 소지 — 거리 유지하며 지원 기다립니다.')).toBe(true);
    stepOne(sim, s, A, P02_WAIT - 0.6 - (sim.t - t0));
    expect(Math.hypot(A.x - h.x, A.y - h.y)).toBeGreaterThan(2.6);      // 상한 안에는 덮치지 않는다
    stepOne(sim, s, A, 3);
    expect(said(sim, ev0, A.rid, '더 기다릴 수 없습니다 — 제압합니다.')).toBe(true);
    expect(Math.hypot(A.x - h.x, A.y - h.y)).toBeLessThan(1.6);
    const d = I.docs!.find((q) => q.rule === 'P02' && q.rid === A.rid)!;
    expect(d.t1 - d.t).toBeGreaterThanOrEqual(P02_WAIT - 1);
    // ④ 같은 장면을 다시 — 시민이 용의자 1.5칸 곁에 있다고 안다
    const env = copsScene('R3-KNIFE', 'armed/dispute', ['patrol'], 'knife', 'fight');
    noKit(env.sim, env.A, 'taser'); env.B.status = 'withdrawn';
    const w2 = work(env.sim, env.s, 'arrest', { hostile: env.h.id, priority: 0.86 });
    put(env.A, spotAt(env.s, env.h.x, env.h.y, 6, 9, false)!);
    giveTask(env.sim, env.s, env.A, w2);
    env.A.beliefs.merge(mkFact('cas', 77, { x: Math.round(env.h.x) + 1, y: Math.round(env.h.y), band: 1, where: 'scene' } as never, '시험', env.sim.t, 1, true, '시민'));
    const e0 = env.sim.events.length;
    stepOne(env.sim, env.s, env.A, 1);
    expect(env.A.task!.gateId).toBeUndefined();
    expect(said(env.sim, e0, env.A.rid, '시민이 위험합니다 — 바로 제압!')).toBe(true);
    expect(env.I.docs!.some((q) => q.rule === 'P02' && q.rid === env.A.rid && q.eventId >= 0)).toBe(true);
  });
});

// ───────────────────────── 시험 2-b: 닫힌 방·동시 진입 — 혼자 들어가지 않는다 (P07) ─────────────────────────
/** 용의자가 방 안에 있고 그 방의 닫힌(잠기지 않은) 문이 있는 무장 현장을 시드에서 찾는다 */
function roomScene(): ReturnType<typeof copsScene> & { door: { x: number; y: number; id: number } } {
  for (let k = 0; k < 40; k++) {
    const env = copsScene('R3-ROOM' + k, 'armed/hostage', ['patrol', 'tactical'], 'gun', 'hold');
    const { s, h } = env;
    const hr = s.region[Math.round(h.y) * s.w + Math.round(h.x)];
    if (hr < 0 || s.regions[hr].kind !== 'room') continue;
    const door = s.props.find((p) => { if (p.kind !== 'door' || p.open || p.entered || p.blocking) return false; const i = p.y * s.w + p.x; return [i, i - 1, i + 1, i - s.w, i + s.w].some((j) => s.region[j] === hr); });
    if (!door || env.cops.length < 2) continue;
    s.entryOrdered = true; s.breachAt = -1; s.breachDone = false;
    return { ...env, door };
  }
  throw new Error('방 진입 장면을 찾지 못했다');
}
describe('R3 시험 2-b: 닫힌 방의 총기 용의자 · 동시 진입 — 혼자 들어가지 않는다 (P07)', () => {
  it('방 진입: 혼자면 4초가 지나도 들어가지 않고(gateAt) 동료가 붙으면 들어간다. 지원 없이 상한(P07_WAIT — 시작값 60초를 §8.4 손잡이로 40초)이면 들어간다(상한 문구)', () => {
    const env = roomScene();
    const { sim, I, s, h, A, B, door } = env;
    const hr = s.region[Math.round(h.y) * s.w + Math.round(h.x)];
    const out = (x: number, y: number): boolean => s.region[y * s.w + x] !== hr && !los(s, x, y, h.x, h.y);
    const w = work(sim, s, 'engage', { hostile: h.id, priority: 0.9, max: 3 });
    put(A, spotAt(s, door.x, door.y, 1, 1.5, false, out)!);
    B.status = 'withdrawn';
    giveTask(sim, s, A, w);
    const ev0 = sim.events.length;
    stepOne(sim, s, A, 6);
    const rd = s.props[door.id];
    expect(rd.entered).toBeFalsy();
    expect(A.task!.gateId).toBe('roomEntry'); expect(A.task!.gateAt).toBeGreaterThanOrEqual(0);
    expect(said(sim, ev0, A.rid, '혼자 들어가지 않습니다. 동료를 기다립니다.')).toBe(true);
    B.status = 'active'; put(B, spotAt(s, A.x, A.y, 0.9, 1.6, false, (x, y) => out(x, y) && Math.hypot(x - door.x, y - door.y) <= 2.4)!); giveTask(sim, s, B, w);
    stepOne(sim, s, A, 0.6);
    expect(rd.entered).toBe(true);
    expect(I.docs!.some((d) => d.rule === 'P07' && d.rid === A.rid && d.gate === 'roomEntry')).toBe(true);
    // 지원 없이 혼자 — 상한 뒤 들어간다
    const e2 = roomScene();
    const out2 = (x: number, y: number): boolean => e2.s.region[y * e2.s.w + x] !== e2.s.region[Math.round(e2.h.y) * e2.s.w + Math.round(e2.h.x)] && !los(e2.s, x, y, e2.h.x, e2.h.y);
    const w2 = work(e2.sim, e2.s, 'engage', { hostile: e2.h.id, priority: 0.9, max: 3 });
    put(e2.A, spotAt(e2.s, e2.door.x, e2.door.y, 1, 1.5, false, out2)!);
    e2.B.status = 'withdrawn';
    giveTask(e2.sim, e2.s, e2.A, w2);
    const f0 = e2.sim.events.length;
    stepOne(e2.sim, e2.s, e2.A, P07_WAIT - 6);
    expect(e2.s.props[e2.door.id].entered).toBeFalsy();
    stepOne(e2.sim, e2.s, e2.A, 25);
    expect(e2.s.props[e2.door.id].entered).toBe(true);
    expect(said(e2.sim, f0, e2.A.rid, '지원이 오지 않습니다 — 진입합니다.')).toBe(true);
    const d = e2.I.docs!.find((q) => q.rule === 'P07' && q.rid === e2.A.rid)!;
    expect(d.t1 - d.t).toBeGreaterThanOrEqual(P07_WAIT - 1);
  });
  it('동시 진입: 2조가 한 명뿐이면 1조가 진입을 불러도 2조의 문은 열리지 않고(t.gateId breach) 그 대원은 문 앞에 남는다. 동료가 오면 자기 문만 열고 들어간다', () => {
    let env: ReturnType<typeof copsScene> | null = null, e0 = -1, e1 = -1;
    for (let k = 0; k < 40 && env === null; k++) {
      const c = copsScene('R3-TWO' + k, 'armed/hostage', ['patrol', 'tactical'], 'gun', 'hold');
      if (c.cops.length < 4) continue;
      for (let p = 0; p < c.s.exits.length && e0 < 0; p++) for (let q = 0; q < c.s.exits.length; q++) if (p !== q && Math.hypot(c.s.exits[p].x - c.s.exits[q].x, c.s.exits[p].y - c.s.exits[q].y) > 10) { e0 = p; e1 = q; break; }
      if (e0 >= 0) env = c;
    }
    expect(env).not.toBeNull();
    const { sim, I, s, h, cops } = env!;
    const [A, C, B, D] = cops;
    const w = work(sim, s, 'engage', { hostile: h.id, priority: 0.9, max: 4 });
    s.entryOrdered = true; s.breachAt = sim.t; s.breachDone = false; s.entryExit = e0; s.entryExit2 = e1;
    const X0 = s.exits[e0], X1 = s.exits[e1];
    put(A, spotAt(s, X0.x, X0.y, 0, 1.2, false)!); put(C, spotAt(s, X0.x, X0.y, 0.8, 1.6, false)!); put(B, spotAt(s, X1.x, X1.y, 0, 1.2, false)!);
    D.status = 'withdrawn';
    for (const a of [A, C, B]) giveTask(sim, s, a, w);
    A.task!.tile = e0; C.task!.tile = e0; B.task!.tile = e1;
    const ev0 = sim.events.length;
    stepOne(sim, s, A, 0.2);
    expect(s.breachDone).toBe(true);
    expect(said(sim, ev0, A.rid, '진입!')).toBe(true);
    expect(B.task!.gateId).toBe('breach');
    expect(I.docs!.some((d) => d.rule === 'P07' && d.rid === B.rid && d.gate === 'breach')).toBe(true);
    stepOne(sim, s, B, 3);
    expect(B.task!.gateId).toBe('breach');      // 동료가 없는 동안은 문 앞에 남는다
    expect(said(sim, ev0, B.rid, '진입!')).toBe(false);
    D.status = 'active'; put(D, spotAt(s, B.x, B.y, 0.8, 1.6, false)!); giveTask(sim, s, D, w); D.task!.tile = e1;
    const e2 = sim.events.length;
    stepOne(sim, s, B, 0.4);
    expect(B.task!.gateId).toBeUndefined();
    expect(said(sim, e2, B.rid, '진입!')).toBe(true);
  });
});

// ───────────────────────── 시험 2-d: 탄 — 엄폐 → 보급, 총기 상대 일은 놓는다 (P09·P08·P22) ─────────────────────────
describe('R3 시험 2-d: 탄약 — 탄 위급에 피격 중이면 엄폐, 피격이 그치면 보급, 하던 총기 상대 교전은 놓는다', () => {
  function ammoScene(seed: string) {
    const env = copsScene(seed, 'armed/hostage', ['patrol'], 'gun', 'fight');
    const { sim, s, h, A, B } = env;
    B.status = 'withdrawn';
    const spot = spotAt(s, h.x, h.y, 3, 7, true, (x, y) => coverSpot(s, x, y, Math.round(h.x), Math.round(h.y), false) !== null)!;
    put(A, spot);
    const gun = sim.responders[A.rid].kit!.find((k) => k.id === 'pistol')!;
    gun.uses = 2; gun.mag = 2;
    const w = work(sim, s, 'engage', { hostile: h.id, priority: 0.9, max: 3 });
    giveTask(sim, s, A, w); A.orderWork = w.id;
    return { ...env, gun, w, u: sim.units[A.unitId] };
  }
  it('권총 2발 · 피격 중 → 하던 교전을 놓고(P22) 엄폐(P09), 4초 피격이 없으면 보급(P08) — 보급 뒤 30발, 상자 하나 줄어듦', () => {
    const { sim, I, s, A, gun, w, u } = ammoScene('R3-AMMO');
    A.underFireT = sim.t;
    const box0 = u.ammoBox!;
    expect(box0).toBeGreaterThan(0);
    expect(fitFor(sim, s, A, w)).toBe(0);      // P22: 탄 위급이면 총기 상대 교전을 맡지 않는다
    think(sim, s, A);
    expect(A.task).toBeNull();                 // 하던 교전도 놓았다 (drop)
    expect(I.docs!.some((d) => d.rule === 'P22' && d.rid === A.rid && d.hook === 'fit')).toBe(true);
    A.underFireT = sim.t;
    stepOne(sim, s, A, 0.2);
    think(sim, s, A);
    expect(A.task!.kind).toBe('cover'); expect(A.task!.docRule).toBe('P09');
    expect(A.doc).toMatchObject({ rule: 'P09', act: 'cover' });
    stepOne(sim, s, A, 6, true);      // 피격이 그친 지 4초 — 엄폐가 끝나고 보급으로
    expect(A.task!.kind).toBe('rearm'); expect(A.task!.docRule).toBe('P08');
    const ev0 = sim.events.length;
    stepOne(sim, s, A, 25, true);
    expect(gun.uses).toBe(30); expect(gun.mag).toBe(15);
    expect(u.ammoBox).toBe(box0 - 1);
    expect(said(sim, ev0, A.rid, '탄약 보급 완료')).toBe(true);
    expect(I.docs!.filter((d) => d.rid === A.rid && d.hook === 'act').map((d) => d.rule)).toEqual(['P09', 'P08']);
    const cv = I.docs!.find((d) => d.rule === 'P09' && d.rid === A.rid)!;
    expect(cv.t1).toBeGreaterThan(cv.t);      // 끝난 시각이 적혔다
  });
  it('보급하러 갔는데 상자가 비었다 → "보급할 탄약이 없습니다" 한 번, 이 사건 동안 보급 줄을 다시 걸지 않는다. 그동안 총기 상대 교전은 맡지 않는다(P22)', () => {
    const { sim, s, h, A, w, u } = ammoScene('R3-AMMO');
    think(sim, s, A);      // 교전을 놓는다 (P22)
    h.state = 'hold'; A.beliefs.merge(hosFact(sim, s, h, '시험', 0));      // 용의자가 쏘지 않는다 (교전 중이면 상자가 빈 대원은 보급 대신 엄폐한다 — P09)
    stepOne(sim, s, A, 0.2);
    think(sim, s, A);
    expect(A.task!.kind).toBe('rearm');      // 피격 중이 아니다 — 바로 보급 (탄 위급 0.97)
    u.ammoBox = 0;
    const ev0 = sim.events.length;
    stepOne(sim, s, A, 25, true);
    expect(sim.events.slice(ev0).filter((e) => e.rid === A.rid && e.text === '보급할 탄약이 없습니다.').length).toBe(1);
    expect(A.docMem!.some((m) => m.rule === 'P08' && m.key === '*')).toBe(true);
    expect(A.task === null || A.task.kind !== 'rearm').toBe(true);
    expect(fitFor(sim, s, A, w)).toBe(0);
  });
  it('재장전: 탄창이 비면 재장전 동안 쏘지 않는다 — 난수를 부르기 전에 돌아간다 (s.rng 의 다음 값이 그대로)', () => {
    const { sim, s, A, gun } = ammoScene('R3-AMMO');
    gun.uses = 20; gun.mag = 1;
    expect(fireRound(sim, A)).toBe(true);
    expect(gun.mag).toBe(0); expect(gun.uses).toBe(19); expect(A.reloadUntil).toBeCloseTo(sim.t + 2, 9);
    expect(gunReady(sim, A)).toBe(false);
    expect(fireRound(sim, A)).toBe(false);
    sim.tick += 11; sim.t = sim.tick * sim.dt;
    act(sim, s, A);
    expect(A.reloadUntil).toBeUndefined(); expect(gun.mag).toBe(15);
    void s;
  });
});

// ───────────────────────── 측정 묶음에서 쓰이지 않은 줄 (§9 완료 조건 1 — 측정 ∪ 시험 = 100%): P10 · P11 · CP2 · CP3 (P09·P22 는 시험 2-d) ─────────────────────────
describe('R3 시험 2-d (덧붙임): 측정 묶음에서 한 번도 쓰이지 않은 경찰 줄을 장면이 쓴다 — 재장전 엄폐(P10)·피격 엄폐(P11)·2인 제압 요청(CP2)·탄약 보급 요청(CP3)', () => {
  /** 지휘 교본(orders/doctrine.ts — 현장 등록의 마지막 registerOrders)을 시험용 도구로 한 번 부른다. 요청은 적어 두고 기록 id 77 을 돌려준다 */
  function orders(sim: Sim, s: Scene, I: Incident, a: FieldAgent, onScene: number[]): string[] {
    const asked: string[] = [];
    const k: CommandKit = {
      want: () => { throw new Error('want 를 부르지 않는다'); }, cancel: () => undefined,
      request: (need, reason) => { asked.push(`${need}:${reason}`); return 77; }, countUnits: () => 0, unitsOnScene: () => onScene,
    };
    ORDER_RULES[ORDER_RULES.length - 1](sim, s, I, a, k);
    return asked;
  }
  it('P10: 재장전 중에 피격되면 숨을 자리로 엄폐하고, 재장전이 끝나고 4초 동안 피격이 없으면 엄폐를 끝낸다', () => {
    const env = copsScene('R3-RELOAD', 'armed/hostage', ['patrol'], 'gun', 'fight');
    const { sim, I, s, h, A, B } = env;
    B.status = 'withdrawn';
    put(A, spotAt(s, h.x, h.y, 3, 7, true, (x, y) => coverSpot(s, x, y, Math.round(h.x), Math.round(h.y), false) !== null)!);
    const gun = sim.responders[A.rid].kit!.find((k) => k.id === 'pistol')!;
    gun.uses = 20; gun.mag = 1;
    const w = work(sim, s, 'engage', { hostile: h.id, priority: 0.9, max: 3 });
    giveTask(sim, s, A, w); A.orderWork = w.id;
    expect(fireRound(sim, A)).toBe(true);      // 마지막 탄 — 재장전 2초 시작 (탄 20 → 19: 위급·마지막 탄창이 아니다 — P08·P09·P22 가 걸리지 않는다)
    A.underFireT = sim.t; A.inCover = false;
    think(sim, s, A);
    expect(A.task!.kind).toBe('cover'); expect(A.task!.docRule).toBe('P10');
    expect(I.docs!.some((d) => d.rule === 'P10' && d.rid === A.rid && d.hook === 'act')).toBe(true);
    stepOne(sim, s, A, 7, true);
    expect(gun.mag).toBe(15);
    expect(A.task === null || A.task.kind !== 'cover').toBe(true);
    const d = I.docs!.find((q) => q.rule === 'P10' && q.rid === A.rid)!;
    expect(d.t1).toBeGreaterThan(d.t);
  });
  it('P11: 피격 중인 경찰(체력 40~70 · 출혈 없음 · 엄폐 아님)은 후퇴 대신 숨을 자리로 엄폐한다 (후퇴 후보를 바꿔 끼운다 — swap)', () => {
    const { sim, I, s, h, A, B } = copsScene('R3-P11', 'armed/hostage', ['patrol'], 'gun', 'fight');
    B.status = 'withdrawn';
    put(A, spotAt(s, h.x, h.y, 3, 7, true, (x, y) => coverSpot(s, x, y, Math.round(h.x), Math.round(h.y), false) !== null)!);
    const r = sim.responders[A.rid];
    r.health = 60; r.composure = 0.1;      // 침착함이 낮아야 경찰의 피격 위험 점수가 후퇴 문턱(0.3)을 넘는다 (brain.dangerScore)
    A.underFireT = sim.t; A.inCover = false;
    think(sim, s, A);
    expect(A.task!.kind).toBe('cover'); expect(A.task!.docRule).toBe('P11');
    expect(I.docs!.some((d) => d.rule === 'P11' && d.rid === A.rid && d.hook === 'act')).toBe(true);
  });
  it('CP2: 맞서는 흉기 용의자 · 쓸 수 있는 경찰 하나 · 오는 경찰 부대 없음 → 22초를 기다리지 않고 2인 제압 인력을 부른다 (기록 id 가 기록에 남는다). 경찰이 둘이면 부르지 않는다', () => {
    const { sim, I, s, A, B } = copsScene('R3-CP2', 'armed/dispute', ['patrol'], 'knife', 'fight');
    for (const uid of I.assigned) expect(['enroute', 'turnout']).not.toContain(sim.units[uid].state);
    expect(orders(sim, s, I, A, [A.unitId]).some((q) => q.startsWith('law:흉기 난동'))).toBe(false);      // 둘 다 쓸 수 있다
    B.status = 'withdrawn';
    expect(orders(sim, s, I, A, [A.unitId])).toContain('law:흉기 난동 — 2인 제압 인력 부족');
    expect(I.docs!.filter((d) => d.rule === 'CP2')).toMatchObject([{ hook: 'cmd', rid: -1, eventId: 77 }]);
  });
  it('CP3: 탄 위급 신고가 있는데 현장 경찰 부대의 탄약 상자가 모두 비었다 → 탄약 보급 요청. 상자가 남았으면 부르지 않는다', () => {
    const { sim, I, s, A } = copsScene('R3-CP3', 'armed/hostage', ['patrol'], 'gun', 'fight');
    const u = sim.units[A.unitId];
    report(sim, A, { ammo: 2 });
    expect(u.ammoBoxMax!).toBeGreaterThan(0);
    expect(orders(sim, s, I, A, [u.id])).not.toContain('law:탄약 보급 필요');
    u.ammoBox = 0;
    expect(orders(sim, s, I, A, [u.id])).toContain('law:탄약 보급 필요');
    expect(I.docs!.filter((d) => d.rule === 'CP3')).toMatchObject([{ hook: 'cmd', eventId: 77 }]);
  });
});

// ───────────────────────── 시험 2-h: 추격 — 따라가기와 앞막기 (D7) ─────────────────────────
describe('R3 시험 2-h: 추격 역할 — 헬기가 보고 있으면 하나만 따라가고 나머지는 진행 방향의 교차로를 막는다 (D7)', () => {
  it('trackBy air: 지상 부대 셋 가운데 follow 하나 · block 둘, block 의 목적지는 그 전 위치 → 알려진 위치 방향으로 가장 곧은 이웃. 헬기가 없고 둘이 곁에 있으면 셋째만 block', () => {
    const sim = new Sim('R3-CHASE', FULL);
    const I = createIncident(sim, { type: 'armed', variant: 'robbery', rng: sim.rng.fork('t') });
    const city = sim.city;
    const K = city.nodes.find((n) => n.edges.length >= 3 && !n.exit)!;
    const P = city.edges[K.edges[0]].a === K.id ? city.edges[K.edges[0]].b : city.edges[K.edges[0]].a;
    I.reportedNode = P; I.reportedPrev = undefined;
    setReported(sim, I, K.id);
    expect(I.reportedPrev).toBe(P); expect(I.reportedNode).toBe(K.id);
    setReported(sim, I, K.id);
    expect(I.reportedPrev).toBe(P);      // 같은 위치를 다시 넣어도 그 전 위치를 잃지 않는다
    // 기대하는 예상 교차로를 손으로 센다
    const PN = city.nodes[P];
    let want = -1, bc = -Infinity;
    for (const eid of K.edges) { const e = city.edges[eid]; const o = e.a === K.id ? e.b : e.a; if (o === P) continue; const O = city.nodes[o]; const c = ((K.x - PN.x) * (O.x - K.x) + (K.y - PN.y) * (O.y - K.y)) / (Math.hypot(K.x - PN.x, K.y - PN.y) * Math.hypot(O.x - K.x, O.y - K.y)); if (c > bc) { bc = c; want = o; } }
    expect(predictNode(sim, I)).toBe(want);
    const W = city.nodes[want];
    const cops = sim.units.filter((u) => u.kind === 'patrol').slice(0, 3);
    const at = (u: (typeof cops)[number], n: typeof K): void => { u.state = 'enroute'; u.nodeId = n.id; u.x = u.px = n.x; u.y = u.py = n.y; u.route = null; u.incidentId = I.id; };
    at(cops[0], K); at(cops[1], W); at(cops[2], W);
    I.assigned = cops.map((u) => u.id);
    I.trackBy = 'air'; I.reportedNodeAt = sim.t;
    let r = chaseRoles(sim, I);
    expect(r.get(cops[0].id)).toEqual({ role: 'follow', node: K.id });
    expect(r.get(cops[1].id)).toEqual({ role: 'block', node: want });
    expect(r.get(cops[2].id)).toEqual({ role: 'block', node: want });
    I.trackBy = null; at(cops[1], K);
    r = chaseRoles(sim, I);
    expect([...r.values()].map((v) => v.role)).toEqual(['follow', 'follow', 'block']);
    // 차가 이미 예상 교차로를 지났을 만큼 시간이 흘렀으면 모두 따라간다
    sim.t += 600;
    r = chaseRoles(sim, I);
    expect([...r.values()].every((v) => v.role === 'follow')).toBe(true);
  });
});

// ───────────────────────── 시험 2-j: 섬광탄 없는 인질 — 엄폐 대기, 상한 뒤 접근 (P14) ─────────────────────────
describe('R3 시험 2-j: 인질 곁 총기 용의자 — 현장 경찰 누구도 섬광탄이 없으면 7.5칸 엄폐 자리에서 기다리고 20초 안에 지금 동작으로 (P14)', () => {
  function hostageScene() {
    for (let k = 0; k < 40; k++) {
      const env = copsScene('R3-HOST' + k, 'armed/hostage', ['patrol'], 'gun', 'hold');
      const { s, h, A, B } = env;
      if (!s.casualties.some((c) => c.hostage && !c.dead && c.where === 'scene' && Math.hypot(c.x - h.x, c.y - h.y) <= 1.7)) continue;
      for (const p of s.props) if (p.kind === 'door' && !p.blocking) { p.open = true; }
      s.entryOrdered = true; s.breachAt = -1; s.breachDone = true;
      B.status = 'withdrawn';
      for (const a of env.cops) noKit(env.sim, a, 'flashbang', 'beanbag', 'sniper');
      const sp = spotAt(s, h.x, h.y, 9, 14, false);
      if (!sp) continue;
      put(A, sp);
      return env;
    }
    throw new Error('인질 장면을 찾지 못했다');
  }
  it('20초 동안은 덮치지 않고 엄폐 자리(또는 7.5칸)에 머문다 → 상한 문구와 함께 다가간다. 섬광탄을 가진 경찰 부대가 오는 중이면 상한 40초', () => {
    const { sim, I, s, h, A } = hostageScene();
    const w = work(sim, s, 'engage', { hostile: h.id, priority: 0.9, max: 3 });
    giveTask(sim, s, A, w);
    // 섬광탄을 실은 경찰 부대가 오는 중이면 상한 40초
    const tac = sim.units.find((u) => u.kind === 'tactical' && u.flashbangs > 0)!;
    const was = tac.state;
    tac.state = 'enroute'; I.assigned.push(tac.id);
    docForget();
    expect(docGate(sim, s, A, 'closeIn')).toMatchObject({ ok: false, rule: 'P14', wait: 40 });
    tac.state = was; I.assigned.splice(I.assigned.indexOf(tac.id), 1);
    docForget();
    const ev0 = sim.events.length;
    stepOne(sim, s, A, 1);
    expect(A.task!.docRule).toBe('P14');
    expect(docGate(sim, s, A, 'closeIn').wait).toBe(20);
    expect(said(sim, ev0, A.rid, '섬광탄 없음 — 인질 위험, 엄폐 대기.')).toBe(true);
    stepOne(sim, s, A, 17.5);
    expect(Math.hypot(A.x - h.x, A.y - h.y)).toBeGreaterThan(1.7);      // 덮치는 거리(1.7) 밖에 머문다 — 방 안의 용의자는 문 곁에서야 보인다
    expect(A.task!.gateId).toBe('closeIn'); expect(A.task!.progress).toBe(0);
    stepOne(sim, s, A, 6);
    expect(said(sim, ev0, A.rid, '더 기다릴 수 없습니다 — 접근해 제압합니다.')).toBe(true);
    expect(A.task === null || A.task.gateId === undefined).toBe(true);
    expect(I.docs!.some((d) => d.rule === 'P14' && d.rid === A.rid && d.t1 - d.t >= 19)).toBe(true);
  });
});

// ───────────────────────── 시험 2-e (경찰): 중상 신고가 배정을 바꾼다 — P12 ─────────────────────────
describe('R3 시험 2-e (경찰판): 경찰 표 대원의 중상 신고 — P12', () => {
  it('기동대원 둘 가운데 하나가 중상 신고: 교전 ×0.35, 봉쇄 +0.15 — 지휘관 배정에서 그 대원이 봉쇄를 받고 지시 무전 끝에 까닭 말', () => {
    const env = sceneWith('R3-HURT2', 'armed/hostage', ['tactical']);
    const { sim, I, s } = env;
    const cmd = s.agents.find((a) => a.isCommander)!;
    const [A, H] = s.agents.filter((a) => a !== cmd && sim.responders[a.rid].role === 'tacOfficer');
    const ra = sim.responders[A.rid], rh = sim.responders[H.rid];
    rh.skills = { ...ra.skills }; rh.experience = ra.experience; rh.stamina = ra.stamina; rh.composure = ra.composure; rh.judgment = ra.judgment; rh.kit = ra.kit!.map((k) => ({ ...k }));
    const ex = s.exits[0];
    A.x = H.x = ex.x; A.y = H.y = ex.y; A.task = H.task = null; A.orderWork = H.orderWork = -1;
    cmd.x = ex.x > s.w / 2 ? 0 : s.w - 1; cmd.y = ex.y > s.h / 2 ? 0 : s.h - 1;
    s.board.length = 0;
    report(sim, H, { band: 1 });
    const wE = work(sim, s, 'engage', { hostile: s.hostiles[0].id, priority: 0.9 });
    const fe = fitParts(sim, s, H, wE);
    expect(fe.fit).toBeCloseTo(Math.max(0.02, fe.base * 0.35), 12);
    expect(fe.hits.map((q) => q.rule.id)).toEqual(['P12']);
    wE.status = 'done';
    const wP = work(sim, s, 'perimeter', { tile: 0, priority: 0.76 });
    expect(fitParts(sim, s, H, wP).fit).toBeCloseTo(fitParts(sim, s, H, wP).base + 0.15, 12);
    const ev0 = sim.events.length;
    assign(sim, s, I, cmd);
    expect(wP.assignees).toEqual([H.rid]);
    const order = sim.events.slice(ev0).find((e) => e.kind === 'command' && e.text.startsWith(rh.name))!;
    expect(order.text).toContain('(부상 — 가벼운 임무).');
    expect(I.docs!.some((d) => d.rule === 'P12' && d.rid === H.rid && d.eventId === order.id)).toBe(true);
  });
});

// ───────────────────────── 시험 4 (경찰): 엄폐 왕복 없음 — 강제 armed/hostage 6교대 ─────────────────────────
describe('R3 시험 4 (단계 2): 엄폐·보급 왕복이 없다 · 엄폐 중인 대원에게 교전 지시를 보내지 않는다', () => {
  // P16 이 이미 엄폐한 협상 자리에서는 걸리지 않게 된 뒤(단계 2 — 구현 메모) 인질극 여섯 교대에는 엄폐가 거의 없다: 엄폐가 실제로 생기는 대형 인질극 세 교대를 더한다
  it('강제 armed/hostage 6교대 + armed/siege 3교대: 교본 임무(엄폐·보급)를 떠났다가 10초 안에 다시 들어가는 경우가 0', () => {
    let doc = 0;
    const bad: string[] = [];
    for (let k = 0; k < 9; k++) {
      const sim = new Sim('R3-OSC' + (k % 6), NORMAL, 1200, { force: k < 6 ? 'armed/hostage' : 'armed/siege' });
      const flow = new Map<FieldAgent, { kind: string; t: number }[]>();
      while (!sim.ended) {
        sim.step();
        for (const s of sim.scenes) if (s) for (const a of s.agents) {
          const kind = a.task ? a.task.kind : '-';
          let f = flow.get(a);
          if (f === undefined) { f = []; flow.set(a, f); }
          if (!f.length || f[f.length - 1].kind !== kind) f.push({ kind, t: sim.t });
        }
      }
      for (const [a, f] of flow) for (let q = 0; q + 2 < f.length; q++) {
        const x = f[q], y = f[q + 1], z = f[q + 2];
        if (x.kind === 'cover' || x.kind === 'rearm') doc++;
        if ((x.kind === 'cover' || x.kind === 'rearm') && z.kind === x.kind && y.kind !== x.kind && z.t - y.t < 10) bad.push(`${sim.seed} ${sim.responders[a.rid].name}: ${x.kind}→${y.kind}→${z.kind} @${y.t.toFixed(1)}`);
      }
    }
    expect(bad).toEqual([]);
    expect(doc).toBeGreaterThan(0);      // 교본 임무가 실제로 있었다
  });
  it('엄폐 중인 대원은 지휘관이 교전으로 빼 가지 않는다 (assign 건너뛰기)', () => {
    const { sim, I, s, h, A, B } = copsScene('R3-SKIP', 'armed/hostage', ['patrol', 'tactical'], 'gun', 'fight');
    const cmd = B; cmd.isCommander = true;
    A.task = makeTask('cover', '엄폐'); A.task.docRule = 'P10'; A.task.hostile = h.id;
    for (const a of s.agents) if (a !== A && a !== cmd) a.status = 'withdrawn';
    s.board.length = 0;
    const w = work(sim, s, 'engage', { hostile: h.id, priority: 0.9, max: 3 });
    w.status = 'open';
    expect(fitFor(sim, s, A, w)).toBeGreaterThan(0);
    assign(sim, s, I, cmd);
    expect(w.assignees.indexOf(A.rid)).toBe(-1);
    A.task = null;
    assign(sim, s, I, cmd);
    expect(w.assignees.indexOf(A.rid)).toBeGreaterThanOrEqual(0);
  });
});

// ───────────────────────── 시험 6 (단계 2): 모든 사건은 끝난다 — 최소 인원 ─────────────────────────
describe('R3 시험 6 (단계 2): 최소 인원 강제 묶음 armed/dispute·armed/hostage 각 6교대 — 닫히지 않은 사건·남은 부대 0, 한계 시간·방치 각 1건 이하', () => {
  for (const f of ['armed/dispute', 'armed/hostage']) it(f, () => {
    let timeout = 0, abandoned = 0;
    for (let k = 0; k < 6; k++) {
      const sim = new Sim('R3-MIN' + k, { ...NORMAL, resources: 1 }, 1200, { force: f });
      sim.runToEnd();
      for (const I of sim.incidents) {
        expect(I.phase, `${f} R3-MIN${k} ${I.code}`).toBe('closed');
        // 한계 시간·방치는 강제한 시나리오의 사건만 센다 (배경 사건 — 납치 차량을 놓친 추격전의 '방치'·응급 — 은 교본과 무관하게 단계 1 과 같은 시드에서 그대로 난다)
        if (`${I.truth.type}/${I.truth.variant ?? ''}` !== f) continue;
        if (I.closeReason === 'timeout') timeout++;
        if (I.closeReason === 'abandoned') abandoned++;
      }
      // 교대는 마지막 사건이 닫히는 그 틱에 끝난다 — 막 닫힌 사건(90초 안)의 부대는 아직 철수하는 중일 수 있다. 그보다 오래된 사건에 남은 부대·보관되지 않은 현장은 없다
      const recent = (id: number | null): boolean => id !== null && sim.t - sim.incidents[id].closedAt <= 90;
      for (const u of sim.units) if (u.state === 'onscene') expect(recent(u.incidentId), `${f} R3-MIN${k} ${u.callsign}`).toBe(true);
      for (const s of sim.scenes) if (s && !s.archived) expect(recent(s.incidentId), `${f} R3-MIN${k} 현장 ${s.incidentId}`).toBe(true);
    }
    expect(timeout).toBeLessThanOrEqual(1); expect(abandoned).toBeLessThanOrEqual(1);
  });
});
