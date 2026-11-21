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
import { AIR_IN_FRAC, STAFF, minCrew } from '../src/sim/crews';
import { F_AIR_IN, F_AIR_OUT } from '../src/sim/field/doctrine/fire';
import { tileOf } from '../src/sim/field/grid';
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
/** (5단계 — 특수, 3·4단계와 나란히) 특수 열일곱(§3.6 순서, S03 은 끝 — S10·S11 은 짝 맺기 위에 서므로 합치는 작업자 몫)과 지휘·관제 셋 */
const STAGE5 = ['S01', 'S02', 'S05', 'S06', 'S06b', 'S07', 'S08', 'S13', 'S15', 'S19', 'S21', 'S22', 'S23', 'S24', 'S25', 'S26', 'S03'];
const CMD5 = ['CS1', 'CS2', 'D1'];
/** (합치기) 단계 4 (의료)의 개인 줄·지휘 줄 — 파일 끝 '단계 4' 절의 STAGE4·CMD4 와 같은 목록 (const 는 끌어올려지지 않아 여기 다시 적는다) */
const EMS4 = ['E01', 'E02', 'E03', 'E04', 'E05', 'E08', 'E11', 'E12', 'E18', 'E19', 'E20'];
/** (합치기) 단계 5 에 합치는 작업자가 더한 화학 짝·대기조 (S10·S11 — special.ts 의 S03 다음) */
const SPECIAL5 = [...STAGE5, 'S10', 'S11'];
/** 3·4·5 단계를 합친 뒤의 등록 순서 전체 (줄 파일 다섯의 import 순서 common → police → fire → ems → special) */
const STAGE345 = [...STAGE3, ...EMS4, ...SPECIAL5];
/** (6단계) 이송·교통 방법의 줄 넷 — 방법·판단 지점이 6단계에 생겨 그 분야 파일의 끝에 붙었다: P20(경찰 — P17b 다음) · F18(소방 — F16 다음) · E13·E14(의료 — E20 다음) */
const STAGE_ALL = STAGE345.flatMap((id) => (id === 'P17b' ? [id, 'P20'] : id === 'F16' ? [id, 'F18'] : id === 'E20' ? [id, 'E13', 'E14'] : [id]));
/** 3·4·5 단계를 합친 뒤의 지휘·관제 줄 (경찰 파일의 지휘 줄 → 소방 → 의료 → 특수(D2 가 특수 파일의 첫 줄)) */
const CMD_ALL = [...CMD3.filter((id) => id !== 'D2'), 'D8', 'CE1', 'CE2', 'CE3', 'CE4', 'CE5', 'D2', ...CMD5];      // (균형) D8 — 소방 파일의 관제 줄 D4 다음
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
  it('단계 6 뒤: 줄은 공통 여섯·경찰 열일곱·소방 열여덟·의료 열셋·특수 열아홉(등록 순서 — index.ts 의 common → police → fire → ems → special), 지휘·관제 줄은 경찰 일곱·소방 아홉·의료 다섯·특수 넷. 의무(duty) 줄이 있다(F01·F02). 짝을 맺고 펌프차에 예비 펌프가 있다. 차량 차단(s.laneShield)은 비었거나 통제 지점 번호의 목록이다', () => {
    expect(STAGE_ALL.length).toBe(STAGE345.length + 4);
    expect(DOCTRINE.map((r) => r.id)).toEqual(STAGE_ALL);
    expect(CMD_ROWS.map((c) => c.id)).toEqual(CMD_ALL);
    expect(DOC_DEPTS_DONE).toEqual(['police', 'fire', 'special', 'ems']);
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
          expect(['fit', 'method', 'act', 'gate', 'cmd', 'dispatch', 'chase', 'duty']).toContain(d.hook);
          expect(DOCTRINE.some((r) => r.id === d.rule) || CMD_ROWS.some((c) => c.id === d.rule), d.rule).toBe(true);
          if (d.hook === 'act' || d.hook === 'duty') expect(['cover', 'rearm', 'airOut', 'pairOut', 'pair', 'triage']).toContain(d.act); else expect(d.act).toBeUndefined();
          if (d.hook === 'gate') expect(['closeIn', 'roomEntry', 'breach', 'coverFire', 'bangUse', 'interiorEntry', 'carryHold', 'carryStart', 'laneTreat', 'forceDoor']).toContain(d.gate); else expect(d.gate).toBeUndefined();
          if (d.hook === 'cmd' || d.hook === 'dispatch' || d.hook === 'chase') expect(d.rid).toBe(-1);
        }
      }
      for (const s of sim.scenes) if (s) {
        expect(typeof s.triageAt).toBe('number');      // (4단계) 분류가 끝난 시각은 -1 이거나 그 시각
        if (s.laneShield !== null) { expect(s.laneRows.length).toBeGreaterThan(0); for (const k of s.laneShield!) expect(k === 0 || k === 1).toBe(true); expect(new Set(s.laneShield!).size).toBe(s.laneShield!.length); }      // (6단계) 차량으로 막은 통제 지점 — 차로가 있는 현장만
        for (const a of s.agents) {
          expect(a.buddy === -1 || sim.responders[a.buddy!] !== undefined).toBe(true);      // 짝 맺기는 3단계 (pairUp — 부대가 내린 뒤)
          if (a.buddy !== undefined && a.buddy >= 0) { paired++; expect(a.buddy).not.toBe(a.rid); }
          if (a.doc) expect(['cover', 'rearm', 'airOut', 'pairOut', 'pair', 'triage']).toContain(a.doc.act);
          if (a.crewSig !== undefined) { sig++; expect(a.crewSig).toMatch(/^[0-2][0-2][0-2][01]$/); }      // 2단계부터 탄을 센다
          if (a.task && a.task.gateAt !== -1) expect(['closeIn', 'roomEntry', 'breach', 'interiorEntry', 'carryHold', 'laneTreat', 'forceDoor']).toContain(a.task.gateId);
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
    expect(idsBefore).toEqual(STAGE_ALL);
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
    ORDER_RULES.find((r) => String(r).includes('CP2'))!(sim, s, I, a, k);      // 경찰 지휘 교본 (orders/doctrine.ts 의 첫 registerOrders — 뒤 단계가 같은 파일에 지휘 규칙을 더해도 그것을 찾는다)
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

// ═════════════════════════ 3단계 (소방) — 짝·밖 대기조·공기 탈출 (§5·§3.3·§10) ═════════════════════════
const roleIn = (sim: Sim, list: FieldAgent[], role: string): FieldAgent => list.find((a) => sim.responders[a.rid].role === role)!;
const tankOf = (sim: Sim, a: FieldAgent): { uses?: number; fault?: boolean; faultKnown?: boolean } => sim.responders[a.rid].kit!.find((k) => k.id === 'scba')!;
/** 화재 현장: 펌프차(관창수·진입대원 = 안쪽 짝, 진압 팀장·기관원 = 밖)와 다른 부대를 내리고, 위험 건물의 실내 구역 하나와 그 구역에서 가장 가까운 출입구 */
function fireScene(seed: string, kinds: UnitKind[] = ['engine', 'ladder']) {
  const q = sceneWith(seed, 'fire/std', kinds);
  const eng = q.of('engine');
  const noz = roleIn(q.sim, eng, 'nozzle'), ff = roleIn(q.sim, eng, 'firefighter'), lead = roleIn(q.sim, eng, 'fireLead'), op = roleIn(q.sim, eng, 'engineer');
  const rg = q.s.regions.findIndex((r) => r.indoor && r.searchable);
  const reg = q.s.regions[rg];
  let ex = q.s.exits[0], bd = Infinity;
  for (const e of q.s.exits) { const d = Math.hypot(e.x - reg.cx, e.y - reg.cy); if (d < bd) { bd = d; ex = e; } }
  return { ...q, noz, ff, lead, op, rg, ex };
}
/** 바깥(실내 구역이 아닌) 걸을 수 있는 칸 — 출입구에서 dmin~dmax */
const outSpot = (s: Scene, x: number, y: number, dmin: number, dmax: number): { x: number; y: number } => spotAt(s, x, y, dmin, dmax, false, (tx, ty) => { const r = s.region[ty * s.w + tx]; return r < 0 || !s.regions[r].indoor; })!;
/** 그 구역 안의 걸을 수 있는 칸 */
const inSpot = (s: Scene, rg: number): { x: number; y: number } => { const i = s.regions[rg].tiles.find((t) => staticPass(s.tiles[t]) && s.propAt[t] < 0)!; return { x: i % s.w, y: (i / s.w) | 0 }; };
/** 믿음 속 구조 대상을 모두 밖(안전 구역)에 있다고 바꾸고 신고 인원을 n 으로 둔다 — 안에 남은 사람이 없다고 믿는 상태 (F05 의 예외가 걸리지 않게) */
function nobodyInside(sim: Sim, s: Scene, n = s.casualties.length): void {
  for (const a of s.agents) {
    for (const c of s.casualties) { const f = casFact(sim, s, c, '시험'); a.beliefs.merge(mkFact('cas', c.id, { ...f.value, where: 'safe' }, '시험', sim.t + 0.01, 1, true, f.text)); }
    a.beliefs.merge(mkFact('occ', 0, { count: n }, '시험', sim.t + 0.01, 1, true, '시험'));
  }
  docForget();
}

describe('R3 시험 2-c: 화재 실내 수색 — 짝·밖 대기조·요구조자 (F04·F05·F05b)', () => {
  it('짝 있음·대기조 둘 → 맡고 문턱을 넘는다. 짝을 withdrawn 으로 → fitFor 0 (F04)', () => {
    const { sim, s, noz, ff, lead, op, rg, ex } = fireScene('R3-F2C');
    expect(noz.buddy).toBe(ff.rid); expect(ff.buddy).toBe(noz.rid); expect(lead.buddy).toBe(op.rid);      // 펌프차의 표준 짝 (pairUp)
    const w = work(sim, s, 'search', { region: rg });
    for (const a of [lead, op]) put(a, outSpot(s, ex.x, ex.y, 1.5, 4));
    put(noz, ex); put(ff, outSpot(s, ex.x, ex.y, 0.8, 2));
    nobodyInside(sim, s);
    expect(fitFor(sim, s, noz, w)).toBeGreaterThan(0);
    giveTask(sim, s, noz, w); giveTask(sim, s, ff, w);
    expect(outsideWatch(sim, s, noz, ex)).toBeGreaterThanOrEqual(2);
    expect(docGate(sim, s, noz, 'interiorEntry')).toMatchObject({ ok: true });
    noz.task = null; ff.task = null; w.assignees = [];
    ff.status = 'withdrawn'; docForget();
    expect(buddyOf(sim, s, noz, w)).toBeNull();
    expect(fitFor(sim, s, noz, w)).toBe(0);
    expect(fitParts(sim, s, noz, w).hits.map((h) => h.rule.id)).toContain('F04');
  });
  it('밖 대기조 0 · 믿음 구조 대상 없음 → 문턱에서 기다림(F05), 같은 조건의 진압은 실내 방법이 빠진다(F05b). 신고 인원이 찾은 수보다 많음 → 진입(예외)', () => {
    const { sim, s, noz, ff, rg, ex } = fireScene('R3-F2C2', ['engine']);
    for (const a of s.agents) if (a !== noz && a !== ff) a.status = 'left';
    const w = work(sim, s, 'search', { region: rg }), wSup = work(sim, s, 'suppress', { region: rg, max: 2 });
    put(noz, ex); put(ff, outSpot(s, ex.x, ex.y, 0.8, 2));
    nobodyInside(sim, s);
    expect(watchNeed(sim, s)).toBe(DOC.WATCH_NEED);
    giveTask(sim, s, noz, w); giveTask(sim, s, ff, w);
    expect(outsideWatch(sim, s, noz, ex)).toBe(0);
    expect(docGate(sim, s, noz, 'interiorEntry')).toMatchObject({ ok: false, rule: 'F05' });
    noz.task = makeTask('suppress', '시험', wSup);
    expect(docMethodMul(docCtx(sim, s, noz, 'self', wSup), 'interior')).toBe(0);
    expect(docMethodMul(docCtx(sim, s, noz, 'self', wSup), 'defensive')).toBe(1);
    // 신고 인원이 찾은 수보다 둘 많다: 안에 사람이 있을 수 있다 → 짝만 있으면 들어간다 (예외 F05)
    for (const a of s.agents) a.beliefs.merge(mkFact('occ', 0, { count: s.casualties.length + 2 }, '시험', sim.t + 0.02, 1, true, '시험'));
    docForget();
    noz.task = null; w.assignees = [ff.rid]; giveTask(sim, s, noz, w);
    const g = docGate(sim, s, noz, 'interiorEntry');
    expect(g.ok).toBe(true); expect(g.exc).toBe('F05');
    expect(docMethodMul(docCtx(sim, s, noz, 'self', wSup), 'interior')).toBe(1);
  });
});

describe('R3 시험 2-f: 공기 — 공기 탈출(F01)·짝 따라 나가기(F02)·문턱 50%(F03)', () => {
  it('실내의 scba 대원 uses = 0.25 × airFull → 다음 판단에 airOut, 짝은 pairOut. 바깥에서 교체 뒤 uses = airFull, 예비 하나 줄어듦', () => {
    const { sim, s, I, noz, ff, rg } = fireScene('R3-F2F', ['engine']);
    const p = inSpot(s, rg);
    put(noz, p); put(ff, p);
    const u = sim.units[noz.unitId], spare = u.spareAir!;
    tankOf(sim, noz).uses = 0.25 * sim.tune.airFull; docForget();
    expect(docDuty(sim, s, noz)).toMatchObject({ act: 'airOut' });
    think(sim, s, noz);
    expect(noz.task!.kind).toBe('airOut'); expect(noz.task!.docRule).toBe('F01');
    think(sim, s, ff);
    expect(ff.task!.kind).toBe('pairOut'); expect(ff.task!.docRule).toBe('F02');
    expect(I.docs!.some((d) => d.rule === 'F01' && d.rid === noz.rid)).toBe(true);
    for (let k = 0; k < 600 && noz.task && noz.task.kind === 'airOut'; k++) stepOne(sim, s, [noz, ff], 0.2);
    expect(tankOf(sim, noz).uses).toBe(sim.tune.airFull);
    expect(u.spareAir).toBe(spare - 1);
    const ri = s.region[tileOf(s, noz.x, noz.y)];
    expect(ri < 0 || !s.regions[ri].indoor).toBe(true);      // 밖에서 바꿨다
  });
  it('uses = 50 (장비 손잡이 1 의 한 통 220초에서 23% — R2 의 kitCount 가 0 인 구간)에서도 airOut. uses = 0.4 × airFull 이면 위험 실내 일의 fitFor 가 0 (F03)', () => {
    const { sim, s, noz, rg } = fireScene('R3-F2F2', ['engine']);
    put(noz, inSpot(s, rg));
    tankOf(sim, noz).uses = 50; docForget();
    expect(docDuty(sim, s, noz)).toMatchObject({ act: 'airOut' });
    const w = work(sim, s, 'search', { region: rg });
    tankOf(sim, noz).uses = 0.4 * sim.tune.airFull; docForget();
    expect(docDuty(sim, s, noz)).toBeNull();
    expect(fitFor(sim, s, noz, w)).toBe(0);
    expect(fitParts(sim, s, noz, w).base).toBe(0);      // R1 의 공기 문턱(airShort)이 같은 수(AIR_IN_FRAC)로 먼저 막는다 — F03 은 그 문턱의 교본 이름이다
    expect(AIR_IN_FRAC).toBe(DOC.AIR_IN);      // R1 의 공기 문턱(airShort)과 교본의 문턱이 같은 수
    expect(F_AIR_IN).toBe(DOC.AIR_IN); expect(F_AIR_OUT).toBe(DOC.AIR_OUT);
  });
});

describe('R3 시험 3 (소방): 숨은 고장은 교본 판단에 새지 않는다 — 열화상·유압 장비·로봇', () => {
  it('숨은 고장(fault, faultKnown 아님)이 있는 대원과 없는 대원의 docFit·docAct·docMethodMul 이 같다', () => {
    const { sim, s, rg } = fireScene('R3-F3', ['engine', 'rescue', 'eod', 'ladder']);
    for (const a of s.agents) a.beliefs.merge(mkFact('fire', rg, 0.6, '시험', sim.t + 0.01, 1, true, '시험'));      // 연기 찬 구역 (F06 이 걸리는 자리)
    const ws = (['search', 'extricate', 'suppress', 'carry', 'defuse'] as WorkKind[]).map((k) => work(sim, s, k, { region: rg, cas: k === 'extricate' || k === 'carry' ? 0 : -1 }));
    const val = (): string => JSON.stringify(s.agents.map((a) => [ws.map((w) => docFit(sim, s, a, w, 0.6)), docAct(sim, s, a)?.act ?? null, docMethodMul(docCtx(sim, s, a, 'report', ws[0]), 'thermal'), docMethodMul(docCtx(sim, s, a, 'report', ws[2]), 'interior')]));
    docForget();
    const before = val();
    let n = 0;
    for (const r of sim.responders) for (const it of r.kit ?? []) if (it.id === 'tic' || it.id === 'spreader' || it.id === 'robot') { it.fault = true; it.faultKnown = false; n++; }
    expect(n).toBeGreaterThan(0);
    docForget();
    expect(val()).toBe(before);
  });
});

describe('R3 시험 4 (소방): 왕복 없음 — 공기 문턱·짝 동행 경계·강제 fire/std', () => {
  it('AIR_OUT ≤ 공기 < AIR_IN 인 대원은 위험 실내 일을 맡지 않는다 (탈출 뒤 교체 없이 다시 들어가지 않는다)', () => {
    const { sim, s, noz, rg } = fireScene('R3-F4A', ['engine']);
    const w = work(sim, s, 'search', { region: rg });
    for (const q of [DOC.AIR_OUT, (DOC.AIR_OUT + DOC.AIR_IN) / 2, DOC.AIR_IN - 0.001]) { tankOf(sim, noz).uses = q * sim.tune.airFull; docForget(); expect(fitFor(sim, s, noz, w), String(q)).toBe(0); }
    tankOf(sim, noz).uses = DOC.AIR_IN * sim.tune.airFull; docForget();
    expect(fitFor(sim, s, noz, w)).toBeGreaterThan(0);
  });
  it('짝 동행 경계: 짝의 바깥 일 우선도가 대상 일보다 0.05 낮으면(0.1 문턱 안) buddyOf 는 null — 앞장설 대원이 맡지 않는다. 0.15 낮으면 짝이 따라온다', () => {
    const { sim, s, noz, ff, rg, ex } = fireScene('R3-F4B', ['engine']);
    const out = work(sim, s, 'traffic', { tile: ex.y * s.w + ex.x, priority: 0.6 });
    put(ff, outSpot(s, ex.x, ex.y, 1, 3));
    giveTask(sim, s, ff, out);
    const near = work(sim, s, 'search', { region: rg, priority: 0.65 }), far = work(sim, s, 'search', { region: rg, priority: 0.75 });
    docForget();
    expect(buddyOf(sim, s, noz, near)).toBeNull();
    expect(fitFor(sim, s, noz, near)).toBe(0);
    expect(buddyOf(sim, s, noz, far)).toBe(ff);
    expect(fitFor(sim, s, noz, far)).toBeGreaterThan(0);
  });
  it('강제 fire/std 6교대: 교본 임무(공기 탈출·짝 따라 나가기·짝 동행)를 떠났다가 10초 안에 다시 들어가는 경우가 0. 판단 지점 상한으로 놓은 작업을 같은 대원이 30초 안에 다시 맡지 않는다', () => {
    const DOCK = new Set(['cover', 'rearm', 'airOut', 'pairOut', 'pair']);
    let doc = 0, memSeen = 0;
    const bad: string[] = [];
    for (let k = 0; k < 6; k++) {
      const sim = new Sim('R3-OSC' + k, NORMAL, 1200, { force: 'fire/std' });
      const flow = new Map<FieldAgent, { kind: string; t: number }[]>();
      while (!sim.ended) {
        sim.step();
        for (const s of sim.scenes) if (s) for (const a of s.agents) {
          const kind = a.task ? a.task.kind : '-';
          let f = flow.get(a);
          if (f === undefined) { f = []; flow.set(a, f); }
          // 임무 없음이 한 판단 주기 안이면 흐름에 넣지 않는다 (받은 지시가 이미 끝나 있어 그 틱에 바로 끝난 경우 — 다른 일을 한 것이 아니다).
          // (독립 검토) 판단 주기는 0.5 + 0.7 × (1 − 경험) 초라 가장 긴 주기가 꼭 1.2초(여섯 틱)다 — 경험 0 인 대원의 그 한 주기는 "1.2 미만"에 들지 않았다(틱 사이의 차 1.2000000000000455).
          //   한 주기 = 1.2초까지로 본다 (그보다 길면 다른 일을 한 것이다)
          if (f.length >= 2 && f[f.length - 1].kind === '-' && f[f.length - 2].kind === kind && sim.t - f[f.length - 1].t < 1.2 + 1e-6) { f.pop(); continue; }
          if (!f.length || f[f.length - 1].kind !== kind) f.push({ kind, t: sim.t });
          // 판단 지점 상한으로 놓은 작업(w:<id> 기억이 남은 동안)을 다시 맡았는가.
          // (독립 검토) 기억의 모양은 { rule: 줄 번호, key: 'w:<작업 id>' } 다 — 전에는 m.rule 을 'w:…' 와 견줘 이 검사가 늘 비어 있었다
          if (a.task && a.task.workId >= 0 && a.docMem) for (const m of a.docMem) { if (m.key === 'w:' + a.task.workId && m.until > sim.t) bad.push(`${sim.seed} ${sim.responders[a.rid].name}: 놓은 작업 #${a.task.workId} 을 다시 맡았다`); else if (m.key.startsWith('w:')) memSeen++; }
        }
      }
      for (const [a, f] of flow) for (let q = 0; q + 2 < f.length; q++) {
        const x = f[q], y = f[q + 1], z = f[q + 2];
        if (DOCK.has(x.kind)) doc++;
        if (DOCK.has(x.kind) && z.kind === x.kind && y.kind !== x.kind && z.t - y.t < 10) bad.push(`${sim.seed} ${sim.responders[a.rid].name}: ${x.kind}→${y.kind}→${z.kind} @${y.t.toFixed(1)}`);
      }
    }
    expect(bad).toEqual([]);
    expect(doc).toBeGreaterThan(0);
    expect(memSeen).toBeGreaterThan(0);      // (독립 검토) 판단 지점 상한의 기억(w:)이 실제로 있었고, 그동안 그 작업을 다시 맡지 않았다
  }, 120000);
});

describe('R3 시험 6 (소방): 최소 인원 강제 fire/std 6교대 — 닫히지 않은 사건·남은 부대 0, 한계 시간·방치 각 교대 셋에 1건 이하', () => {
  // (I1-b b3-11) 표본을 3교대에서 6교대로 넓혔다 — 문턱은 같은 비율(교대 셋에 1건 → 여섯에 2건). 큰 불의 연기가 길에 얹는 시야 혼잡(C5)으로 R3-MIN0 의
  //   두 화재(#08 · #10)가 한계 시간에 닿았다(연기의 혼잡을 0 으로 두면 0건 — 최소 인원이라 늦은 지원 하나가 다음 화재로 번진다). R3-MIN0~14 의 15교대에서 전 0 · 뒤 2(모두 R3-MIN0)
  it('fire/std', () => {
    let timeout = 0, abandoned = 0;
    for (let k = 0; k < 6; k++) {
      const sim = new Sim('R3-MIN' + k, { ...NORMAL, resources: 1 }, 1200, { force: 'fire/std' });
      sim.runToEnd();
      for (const I of sim.incidents) {
        expect(I.phase, `R3-MIN${k} ${I.code}`).toBe('closed');
        if (`${I.truth.type}/${I.truth.variant ?? ''}` !== 'fire/std') continue;
        if (I.closeReason === 'timeout') timeout++;
        if (I.closeReason === 'abandoned') abandoned++;
      }
      const recent = (id: number | null): boolean => id !== null && sim.t - sim.incidents[id].closedAt <= 90;
      for (const u of sim.units) if (u.state === 'onscene') expect(recent(u.incidentId), `R3-MIN${k} ${u.callsign}`).toBe(true);
      for (const s of sim.scenes) if (s && !s.archived) expect(recent(s.incidentId), `R3-MIN${k} 현장 ${s.incidentId}`).toBe(true);
    }
    expect(timeout).toBeLessThanOrEqual(2); expect(abandoned).toBeLessThanOrEqual(2);
  }, 60000);
});

describe('R3 시험 7 (소방): 공기 탈출의 보고서 문장', () => {
  // 공기 탈출은 평소 교대에 드물다(한 통 280초 — 실내에 오래 머무는 사건에서만 30% 아래로 떨어진다). 장면에서 일으키고 그 사건의 보고서 문장을 본다
  it('공기 탈출(F01)이 있었던 사건의 보고서 문장(docLines)에 "공기" 가 든 문장, 기록 문구는 그 대원의 말로 한 번', () => {
    const { sim, s, I, noz, ff, rg } = fireScene('R3-F7', ['engine']);
    const p = inSpot(s, rg);
    put(noz, p); put(ff, p);
    tankOf(sim, noz).uses = 0.25 * sim.tune.airFull; docForget();
    const ev = sim.events.length;
    think(sim, s, noz); think(sim, s, ff);
    for (let k = 0; k < 600 && noz.task && noz.task.kind === 'airOut'; k++) stepOne(sim, s, [noz, ff], 0.2);
    const name = sim.responders[noz.rid].name;
    expect(sim.events.slice(ev).filter((e) => e.rid === noz.rid && e.text.startsWith('공기 30% 미만 —')).length).toBe(1);      // (자기 신고 '공기 30% 미만.' 은 따로 한 번)
    expect(docLines(sim, I, s).some((l) => l.includes('공기') && l.includes(name))).toBe(true);
  });
});

describe('R3 시험 8 (소방): 표 — 소방 줄 12개 이상, 짝 표, pairUp', () => {
  it('소방 줄(개인 F + 지휘 CF·D4·D5)이 12개 이상이고 DOC_DEPTS_DONE 에 fire. 펌프차·사다리차의 짝 표가 §5.1 그대로, 혼자 서는 역할', () => {
    const fire = DOCTRINE.filter((r) => r.dept === 'fire').length + CMD_ROWS.filter((c) => c.dept === 'fire').length;
    expect(fire).toBeGreaterThanOrEqual(12);
    expect(DOC_DEPTS_DONE).toContain('fire');
    expect(PAIRS.engine!.std).toEqual([['nozzle', 'firefighter'], ['fireLead', 'engineer']]);
    expect(PAIRS.engine!.min).toEqual([['nozzle', 'fireLead']]);
    expect(PAIRS.ladder!.std).toEqual([['nozzle', 'ladderLead']]);
    for (const r of ['engineer', 'ladderOp', 'marksman', 'bombTech', 'emsDriver', 'observer'] as const) expect(SOLO_OK.has(r), r).toBe(true);
  });
  it('pairUp: 부대가 내린 뒤 표의 쌍을 순서대로 맺는다 — 최소 인원 펌프차는 [관창수, 진압 팀장], 기관원은 짝이 없다(-1)', () => {
    const sim = new Sim('R3-PAIRUP', { ...NORMAL, resources: 1 });
    for (const r of sim.responders) for (const it of r.kit!) it.fault = false;
    const I = createIncident(sim, { type: 'fire', variant: 'std', rng: sim.rng.fork('t') });
    const s = sim.scenes[I.id]!;
    const u = sim.units.find((q) => q.kind === 'engine')!;
    expect(u.crew.length).toBe(minCrew('engine'));
    unitArrived(sim, I, u);
    const ag = s.agents.filter((a) => a.unitId === u.id);
    const noz = roleIn(sim, ag, 'nozzle'), lead = roleIn(sim, ag, 'fireLead'), op = roleIn(sim, ag, 'engineer');
    expect([noz.buddy, lead.buddy, op.buddy]).toEqual([lead.rid, noz.rid, -1]);
  });
});

describe('R3 시험 9 (소방): 의무의 순서 — 업고 있으면 공기 탈출이 걸리지 않고, 철수·탑승 지시가 먼저다', () => {
  it('업고 있는 대원에게 airOut 이 걸리지 않는다 · boardOrder 가 선 대원은 공기 30% 미만이어도 airOut 을 고르지 않는다', () => {
    const { sim, s, noz, rg } = fireScene('R3-F9', ['engine']);
    put(noz, inSpot(s, rg));
    tankOf(sim, noz).uses = 0.2 * sim.tune.airFull; docForget();
    expect(docDuty(sim, s, noz)).toMatchObject({ act: 'airOut' });
    noz.carrying = 0; docForget();
    expect(docDuty(sim, s, noz)).toBeNull();
    noz.carrying = -1; docForget();
    sim.units[noz.unitId].boardOrder = 'release';
    think(sim, s, noz);
    expect(noz.task?.kind).not.toBe('airOut');
  });
});
// ───────────────────────── 단계 4 (의료) — 시험 2-g · 시험 5 의 '단계 2' 묶음이 보는 뒤 단계의 목록 ─────────────────────────
// (3·4·5 단계를 나란히 돌린 뒤 합쳤다 — 시험 5 는 머리의 STAGE_ALL·CMD_ALL 로 등록 순서 전체를 본다)
import { commanderThink } from '../src/sim/field/commander';
import { tickScene } from '../src/sim/field/sceneManager';
/** 단계 4 (의료) 의 개인 줄 (등록 순서 — doctrine/ems.ts) */
const STAGE4 = ['E01', 'E02', 'E03', 'E04', 'E05', 'E08', 'E11', 'E12', 'E18', 'E19', 'E20'];
/** 단계 4 의 지휘 줄 */
const CMD4 = ['CE1', 'CE2', 'CE3', 'CE4', 'CE5'];

/** 구조 대상 하나를 거동 불가·그 체력으로 두고 모든 대원의 믿음을 고친다 */
function setCas(sim: Sim, s: Scene, id: number, hp: number, where: 'scene' | 'safe' = 'scene', at?: { x: number; y: number }): void {
  const c = s.casualties[id];
  c.health = hp; c.mob = 'immobile'; c.walking = false; c.where = where; c.inVehicle = null;
  if (at) { c.x = at.x; c.y = at.y; } else if (where === 'safe') { c.x = s.safe.x; c.y = s.safe.y; }
  for (const b of s.agents) b.beliefs.merge(casFact(sim, s, c, '시험'));
  docForget();
}
const medicsOf = (sim: Sim, s: Scene): FieldAgent[] => s.agents.filter((b) => sim.responders[b.rid].dept === 'ems');

describe('R3 시험 2-g: 의료 — 처치 넘겨받기 · 처치 중 이송 막기 · 경계 밖 처치소 · 분류 · 이송 전 지휘 넘김 · 차로 위 처치 (단계 4)', () => {
  it('CE2: 경찰이 처치 중인 환자 — 손이 빈 구급 대원에게 넘겨받으라는 지시가 가고(지휘관은 경찰의 임무를 끝내지 않는다), 구급 대원이 환자 곁(1.5칸)에 오면 경찰이 handover 로 놓는다', () => {
    const { sim, I, s, of } = sceneWith('R3-G1', 'traffic/std', ['patrol', 'als']);
    for (const b of s.agents) { b.task = null; b.orderWork = -1; }
    const cmd = s.agents.find((b) => b.isCommander)!;
    const cop = of('patrol').find((b) => b !== cmd)!;
    setCas(sim, s, 0, 60);
    const c = s.casualties[0];
    const w = work(sim, s, 'treat', { cas: c.id, priority: 0.8 });
    giveTask(sim, s, cop, w);
    const from = sim.events.length;
    assign(sim, s, I, cmd);
    const medic = s.agents.find((b) => b !== cop && w.assignees.indexOf(b.rid) >= 0)!;
    expect(medic).toBeDefined();
    expect(sim.responders[medic.rid].dept).toBe('ems');
    expect(sim.events.slice(from).some((e) => e.text.includes(`${sim.responders[medic.rid].name}, `) && e.text.includes('넘겨받아라'))).toBe(true);
    expect(cop.task).not.toBeNull();      // 지휘관 코드는 남의 임무를 끝내지 않는다
    expect((I.docs ?? []).some((d) => d.rule === 'CE2' && d.hook === 'cmd' && d.eventId >= 0)).toBe(true);
    // 다시 배정해도 같은 작업에 구급 대원을 더 붙이지 않는다 (담당자에 구급 대원이 있다)
    assign(sim, s, I, cmd);
    expect(w.assignees.filter((rid) => sim.responders[rid].dept === 'ems').length).toBe(1);
    // 구급 대원이 멀리 있으면 경찰은 계속 처치한다
    giveTask(sim, s, medic, w); put(medic, s.staging);
    act(sim, s, cop);
    expect(cop.task).not.toBeNull();
    // 곁에 오면 손을 뗀다 — 실패 기록·재지시 요청 없이, 작업은 구급 대원에게 남는다
    put(medic, { x: Math.round(c.x), y: Math.round(c.y) });
    act(sim, s, cop);
    expect(cop.task).toBeNull();
    expect(w.status).toBe('active');
    expect(w.assignees).toEqual([medic.rid]);
    expect(w.fails).toBe(0);
    expect(said(sim, from, cop.rid, '넘깁니다')).toBe(true);
    expect(said(sim, from, cop.rid, '재지시 요청')).toBe(false);
  });

  it('E08: 구급 대원이 곁에 앉아 처치하는 환자는 다른 대원이 들지 않고 곁에서 기다린다(carryHold) — 15초 상한 뒤에는 든다', () => {
    const { sim, I, s, of } = sceneWith('R3-G2', 'traffic/std', ['engine', 'als']);
    for (const b of s.agents) { b.task = null; b.orderWork = -1; }
    setCas(sim, s, 0, 60);
    const c = s.casualties[0];
    const medic = of('als')[0], ff = of('engine')[0];
    const tw = work(sim, s, 'treat', { cas: c.id }); giveTask(sim, s, medic, tw);
    put(medic, { x: Math.round(c.x), y: Math.round(c.y) }); medic.ring = 0.3;      // 곁에 앉아 손을 쓰는 중
    const cw = work(sim, s, 'carry', { cas: c.id, max: 2, priority: 0.5 }); giveTask(sim, s, ff, cw);
    put(ff, spotAt(s, c.x, c.y, 0.9, 1.3, false)!);
    docForget();
    const from = sim.events.length;
    stepOne(sim, s, ff, 5);
    expect(ff.carrying).toBe(-1);
    expect(ff.task!.gateId).toBe('carryHold');
    expect(said(sim, from, ff.rid, '처치 끝나면 옮기겠습니다')).toBe(true);
    expect((I.docs ?? []).some((d) => d.rule === 'E08' && d.gate === 'carryHold')).toBe(true);
    stepOne(sim, s, ff, 12);      // 상한 15초 + 들기 1.2초
    expect(ff.carrying === c.id || c.where === 'safe').toBe(true);
    // 처치하는 구급 동료가 없으면 기다리지 않는다
    const env = sceneWith('R3-G2', 'traffic/std', ['engine', 'als']);
    for (const b of env.s.agents) { b.task = null; b.orderWork = -1; }
    setCas(env.sim, env.s, 0, 60);
    const c2 = env.s.casualties[0], ff2 = env.of('engine')[0];
    const cw2 = work(env.sim, env.s, 'carry', { cas: c2.id, max: 2 }); giveTask(env.sim, env.s, ff2, cw2);
    put(ff2, spotAt(env.s, c2.x, c2.y, 0.9, 1.3, false)!);
    stepOne(env.sim, env.s, ff2, 2);
    expect(ff2.carrying).toBe(c2.id);
  });

  it('E05·E20: 안전 확보 전의 무장 현장 — 현장 안의 환자는 경찰만, 안전 구역의 환자는 구급 대원이 처치한다(경계 밖 처치소 — 현장에서 처음 한 번 기록). 동요 신고 중인 구급 대원은 맡지 않는다', () => {
    const { sim, I, s, of } = sceneWith('R3-G3', 'armed/shooter', ['patrol', 'als']);
    expect(s.secureAt).toBeLessThan(0);
    for (const b of s.agents) { b.task = null; b.orderWork = -1; }
    const medic = of('als')[0];
    setCas(sim, s, 0, 60, 'scene');
    const w = work(sim, s, 'treat', { cas: 0 });
    expect(fitFor(sim, s, medic, w)).toBe(0);
    setCas(sim, s, 0, 60, 'safe');
    const fit = fitFor(sim, s, medic, w);
    expect(fit).toBeGreaterThan(0);
    report(sim, medic, { shaken: true });
    expect(fitFor(sim, s, medic, w)).toBe(0);      // E20
    report(sim, medic, { shaken: false });
    expect(fitFor(sim, s, medic, w)).toBeCloseTo(fit, 6);
    const from = sim.events.length;
    giveTask(sim, s, medic, w); put(medic, spotAt(s, s.safe.x, s.safe.y, 0, 1.2, false)!);
    stepOne(sim, s, medic, 2);
    expect((I.docs ?? []).filter((d) => d.rule === 'E05').length).toBe(1);
    expect(said(sim, from, medic.rid, '경계 밖 처치소')).toBe(true);
    stepOne(sim, s, medic, 2);
    expect((I.docs ?? []).filter((d) => d.rule === 'E05').length).toBe(1);      // 그 현장에서 처음 한 번
  });

  /** 다수 사상자: 버스 사고에 순찰·전문 구급·일반 구급 — 다섯을 중상(거동 불가)으로 두고 모든 대원이 안다 */
  function busScene(seed: string) {
    const env = sceneWith(seed, 'traffic/bus', ['patrol', 'als', 'bls']);
    for (const b of env.s.agents) { b.task = null; b.orderWork = -1; }
    for (let k = 0; k < 5; k++) setCas(env.sim, env.s, k, 60);
    return { ...env, cmd: env.s.agents.find((b) => b.isCommander)! };
  }
  const band1Treats = (s: Scene, a: FieldAgent): WorkItem[] => s.board.filter((w) => w.kind === 'treat' && (w.status === 'open' || w.status === 'active') && a.beliefs.val<{ band: number }>('cas', w.cas)?.band === 1);

  it('CE1·E01: 믿음 속 기다리는 환자 다섯 → 분류 작업이 생기고 그동안 중상(band 1) 처치는 아무에게도 가지 않는다. 분류가 끝나면 s.triageAt ≥ 0 과 "분류 완료", 그 뒤로는 분류를 다시 내지 않는다', () => {
    const { sim, I, s, cmd } = busScene('R3-G4');
    commanderThink(sim, s, cmd);
    const tri = s.board.find((w) => w.kind === 'triage')!;
    expect(tri).toBeDefined();
    expect(['open', 'active']).toContain(tri.status);
    expect((I.docs ?? []).some((d) => d.rule === 'CE1' && d.hook === 'cmd')).toBe(true);
    const held = band1Treats(s, cmd);
    expect(held.length).toBeGreaterThan(0);
    for (const w of held) { expect(w.assignees.length, `구조 대상 ${w.cas}`).toBe(0); expect(w.holdUntil).toBeGreaterThan(sim.t); }
    for (const b of s.agents) if (b.orderWork >= 0) expect(held.map((w) => w.id)).not.toContain(b.orderWork);
    // 분류를 맡을 수 있는 사람은 구급 대원만 (경찰은 0)
    for (const b of s.agents) expect(fitFor(sim, s, b, tri) > 0, sim.responders[b.rid].name).toBe(sim.responders[b.rid].dept === 'ems');
    // 분류를 한다: 믿음 속 환자마다 곁에 2초
    const medic = s.agents.find((b) => b.orderWork === tri.id) ?? medicsOf(sim, s)[0];
    for (const b of s.agents) if (b !== medic) b.status = 'withdrawn';
    giveTask(sim, s, medic, tri);
    const from = sim.events.length;
    stepOne(sim, s, medic, 80);
    expect(medic.task).toBeNull();
    expect(tri.status).toBe('done');
    expect(s.triageAt).toBeGreaterThanOrEqual(0);
    expect(said(sim, from, medic.rid, '다수 사상자 — 먼저 분류합니다')).toBe(true);
    const done = sim.events.slice(from).find((e) => e.rid === medic.rid && e.text.startsWith('분류 완료'));
    expect(done).toBeDefined();
    expect(done!.text).toMatch(/^분류 완료: 위중 \d+ · 중상 \d+ · 경상 \d+\.$/);
    // 끝난 뒤에는 분류를 다시 내지 않고, 중상 처치를 미루지 않는다
    for (const b of s.agents) if (b !== medic) b.status = 'active';
    sim.tick += 20; sim.t = sim.tick * sim.dt;
    commanderThink(sim, s, cmd);
    expect(s.board.filter((w) => w.kind === 'triage' && (w.status === 'open' || w.status === 'active')).length).toBe(0);
    for (const w of band1Treats(s, cmd)) expect(w.holdUntil).toBeLessThanOrEqual(sim.t + 1e-9);
  });

  it('CE1 거두기: 분류 전에 구급 대원이 모두 떠나면 열린 분류를 거둔다 (열린 채 남으면 종료를 막는다)', () => {
    const { sim, s, cmd } = busScene('R3-G5');
    commanderThink(sim, s, cmd);
    const tri = s.board.find((w) => w.kind === 'triage')!;
    expect(tri).toBeDefined();
    for (const b of medicsOf(sim, s)) b.status = 'left';
    commanderThink(sim, s, cmd);
    expect(tri.status).toBe('cancelled');
    expect(s.board.filter((w) => w.kind === 'triage' && (w.status === 'open' || w.status === 'active')).length).toBe(0);
  });

  it('CE5: 구급 지휘관의 부대에 이송 지시 → 타기 전에 다른 부대의 대원에게 지휘가 넘어간다(지휘 넘김). 다른 부대의 대원이 없으면 넘기지 않는다', () => {
    const { sim, I, s } = sceneWith('R3-G6', 'medical/trauma', ['als', 'engine']);
    const cmd = s.agents.find((b) => b.isCommander)!;
    expect(sim.responders[cmd.rid].dept).toBe('ems');
    const from = sim.events.length;
    sim.units[cmd.unitId].boardOrder = 'transport';
    tickScene(sim, s);
    const now = s.agents.find((b) => b.rid === s.commanderRid)!;
    expect(now).not.toBe(cmd);
    expect(now.unitId).not.toBe(cmd.unitId);
    expect(now.isCommander).toBe(true); expect(cmd.isCommander).toBe(false);
    expect(sim.events.slice(from).filter((e) => e.text.includes('지휘 넘김')).length).toBe(1);
    expect((I.docs ?? []).some((d) => d.rule === 'CE5' && d.eventId >= 0)).toBe(true);
    tickScene(sim, s);
    expect(sim.events.slice(from).filter((e) => e.text.includes('지휘 넘김')).length).toBe(1);      // 한 번만
    // 그 부대뿐이면 넘기지 않는다 (떠난 뒤의 지금 경로)
    const env = sceneWith('R3-G6', 'medical/trauma', ['als']);
    const c2 = env.s.agents.find((b) => b.isCommander)!;
    const from2 = env.sim.events.length;
    env.sim.units[c2.unitId].boardOrder = 'transport';
    tickScene(env.sim, env.s);
    expect(env.s.commanderRid).toBe(c2.rid);
    expect(env.sim.events.slice(from2).some((e) => e.text.includes('지휘 넘김'))).toBe(false);
  });

  it('E12: 차로 줄 위의 환자 — 그 차로가 통제됐다고 모르면 차로 밖 곁 칸에서 기다리고(laneTreat), 20초 상한 뒤에는 그 자리에서 처치한다', () => {
    const { sim, I, s, of } = sceneWith('R3-G7', 'traffic/std', ['als']);
    for (const b of s.agents) { b.task = null; b.orderWork = -1; }
    const row = s.laneRows[0];
    let x = -1;
    for (let tx = 4; tx < s.w - 4 && x < 0; tx++) { const i = row * s.w + tx; if (staticPass(s.tiles[i]) && s.propAt[i] < 0 && staticPass(s.tiles[i + s.w]) && s.propAt[i + s.w] < 0) x = tx; }
    expect(x).toBeGreaterThanOrEqual(0);
    setCas(sim, s, 0, 60, 'scene', { x, y: row });
    const c = s.casualties[0];
    const medic = of('als')[0];
    for (const b of s.agents) if (b !== medic) b.status = 'withdrawn';
    const w = work(sim, s, 'treat', { cas: c.id }); giveTask(sim, s, medic, w);
    const from = sim.events.length;
    stepOne(sim, s, medic, 8);
    expect(medic.task!.gateId).toBe('laneTreat');
    expect(s.laneRows).not.toContain(Math.round(medic.y));
    expect(c.treatProg).toBe(0);
    expect(said(sim, from, medic.rid, '차로 통제 전')).toBe(true);
    expect((I.docs ?? []).some((d) => d.rule === 'E12' && d.gate === 'laneTreat')).toBe(true);
    stepOne(sim, s, medic, 22);
    expect(c.treatProg > 0 || c.treated).toBe(true);
    expect(said(sim, from, medic.rid, '그 자리에서 처치합니다')).toBe(true);
    // 그 차로가 통제됐다고 알면 기다리지 않는다
    const env = sceneWith('R3-G7', 'traffic/std', ['als']);
    for (const b of env.s.agents) { b.task = null; b.orderWork = -1; }
    setCas(env.sim, env.s, 0, 60, 'scene', { x, y: row });
    const m2 = env.of('als')[0];
    for (const b of env.s.agents) if (b !== m2) b.status = 'withdrawn';
    for (let k = 0; k < env.s.controlPts.length; k++) m2.beliefs.merge(mkFact('ctl', k, true, '시험', env.sim.t, 1, true, '차로 통제 완료'));
    docForget();
    const w2 = work(env.sim, env.s, 'treat', { cas: 0 }); giveTask(env.sim, env.s, m2, w2);
    stepOne(env.sim, env.s, m2, 8);
    expect(m2.task === null || m2.task.gateId === undefined).toBe(true);
    expect(env.s.casualties[0].treatProg > 0 || env.s.casualties[0].treated).toBe(true);
  });

  it('E04: 의사 — 위중하지만 걸을 수 있는 환자(제세동기 줄 E02·E03 이 걸리지 않는다)에게 즉시 이송 대신 현장 전문 처치를 고르고, 실행부가 그 줄을 기록한다. 교본이 없으면 즉시 이송이다', () => {
    const { sim, I, s, of } = sceneWith('R3-G8', 'medical/trauma', ['medHeli', 'als']);
    const doc = s.agents.find((b) => roleIdOf(sim, b.rid) === 'doctor')!;
    expect(doc).toBeDefined();
    for (const b of s.agents) { b.task = null; b.orderWork = -1; if (b !== doc) b.status = 'withdrawn'; }
    const amb = sim.units[of('als')[0].unitId]; amb.state = 'onscene'; if (I.assigned.indexOf(amb.id) < 0) I.assigned.push(amb.id);      // 환자 자리가 남은 부대가 와 있다 (즉시 이송의 조건)
    const c = s.casualties[0];
    c.health = 30; c.where = 'scene'; c.mob = 'mobile'; c.walking = true; c.treated = false; c.treatQ = 0;
    doc.beliefs.merge(casFact(sim, s, c, '시험')); docForget();
    const w = work(sim, s, 'treat', { cas: c.id });
    const tg = { cas: c.id, prop: -1, hostile: -1, region: -1, tile: -1 };
    expect(chooseMethod(sim, s, doc, 'treat', tg, null, NO_SENSE)!.m).toBe('rush');      // 교본 없이 (R2 의 즉시 이송 조건)
    giveTask(sim, s, doc, w); put(doc, { x: Math.round(c.x), y: Math.round(c.y) });
    act(sim, s, doc);
    expect(doc.task!.method).toBe('stay');
    expect((I.docs ?? []).some((d) => d.rule === 'E04' && d.hook === 'method' && d.method === 'stay')).toBe(true);
  });
});
// ═════════════════════════ 단계 5 (특수) — 시험 2-i · 측정 묶음에서 드문 특수 줄의 장면 시험 ═════════════════════════
// (나란히 실행한 3·4단계와 겹치지 않게 이 파일 끝에 따로 둔다. 도구는 위의 sceneWith·work·report·giveTask·stepOne·put·noKit·said·spotAt 을 쓴다)
import { agentCost } from '../src/sim/field/agents';
import { armorOf, blastFactor } from '../src/sim/crews';
import { hurtResponder } from '../src/sim/field/injury';
import { S03_WAIT, S03_WAIT_BACKUP, S26_AGE, S26_NEAR } from '../src/sim/field/doctrine/special';
import { dispatchPref, docNeeds } from '../src/sim/dispatch/doctrine';
import { emptyNeeds } from '../src/sim/dispatch/analyst';
import type { Needs, Prop } from '../src/sim/types';

/** 폭발물 현장: 처리반(·순찰)을 내려 세우고 모든 대원이 장치를 안다고 둔다(믿음). 해체 작업 하나 */
function bombScene(seed: string, kinds: UnitKind[] = ['eod', 'patrol']) {
  const env = sceneWith(seed, 'armed/bomb', kinds);
  const { sim, s } = env;
  const bomb = s.props.find((p) => p.kind === 'bomb')!;
  expect(bomb).toBeDefined();
  for (const a of s.agents) { a.task = null; a.orderWork = -1; a.isCommander = false; a.beliefs.merge(mkFact('haz', bomb.id, { kind: 'bomb', active: true, x: bomb.x, y: bomb.y }, '시험', sim.t, 1, true, '시험')); }
  const w = work(sim, s, 'defuse', { prop: bomb.id, priority: 0.97 });
  const role = (id: string): FieldAgent => s.agents.find((a) => sim.responders[a.rid].role === id)!;
  docForget();
  return { ...env, bomb, w, tech: role('bombTech'), op: role('robotOp'), guard: role('eodGuard') };
}
const casBelief = (sim: Sim, a: FieldAgent, id: number, x: number, y: number, mob: 'mobile' | 'immobile', t = sim.t): void => {
  a.beliefs.merge(mkFact('cas', id, { x, y, mob, band: mob === 'mobile' ? 0 : 1, where: 'scene', treated: false, trappedDone: false, tq: 0 }, '시험', t, 1, true, '시험'));
};
const dcAt = (sim: Sim, s: Scene, a: FieldAgent, w: WorkItem | null, m: Partial<{ reach: number; flow: number; weak: boolean; tile: number }> = {}) => ({ ...docCtx(sim, s, a, 'self', w), m: { reach: 0, flow: 0, weak: false, tile: -1, ...m } });

describe('R3 시험 2-i (단계 5): 폭발물 — 로봇·방호복·맨몸 해체, 다친·동요한 처리 요원, 해체 반경', () => {
  it('로봇이 작동하면 로봇 조작 요원이 로봇 원격 해체를 맡는다(S06·S06b). 숨은 고장은 자리에 닿아 처음 쓸 때 EQUIP_FAIL — 조작 요원이 놓고 처리 요원이 방호복 해체로. 로봇을 잃은 조작 요원은 출입 통제(S21)', () => {
    const { sim, I, s, w, tech, op } = bombScene('R3-BOMB');
    const ft = fitParts(sim, s, tech, w);
    expect(ft.hits.map((h) => h.rule.id)).toContain('S06b');
    expect(ft.fit).toBeCloseTo(ft.base * 0.4, 6);
    expect(fitFor(sim, s, op, w)).toBeGreaterThan(fitFor(sim, s, tech, w));
    giveTask(sim, s, op, w); act(sim, s, op);
    expect(op.task!.method).toBe('robotDefuse');
    expect(said(sim, 0, op.rid, '로봇 먼저 투입합니다')).toBe(true);
    const robot = sim.responders[op.rid].kit!.find((k) => k.id === 'robot')!;
    robot.fault = true; robot.faultKnown = false;
    stepOne(sim, s, op, 40);
    expect(robot.faultKnown).toBe(true);
    expect(I.problems.some((p) => p.code === 'EQUIP_FAIL')).toBe(true);
    expect(op.task).toBeNull();
    expect((I.methods ?? []).some((m) => m.method === 'robotDefuse' && !m.ok)).toBe(true);
    docForget();
    expect(fitFor(sim, s, op, w)).toBe(0);
    expect(fitParts(sim, s, tech, w).hits.some((h) => h.rule.id === 'S06b')).toBe(false);
    const wP = work(sim, s, 'perimeter', { tile: 0, priority: 0.62 });
    expect(fitParts(sim, s, op, wP).hits.map((h) => h.rule.id)).toContain('S21');
    giveTask(sim, s, tech, w); act(sim, s, tech);
    expect(tech.task!.method).toBe('suitDefuse');
  });
  it('로봇 원격 해체는 장치 8칸 안·벽에 가리지 않는 자리에서, 필요 시간 ×1.6 — 끝나면 장치가 처리된다(방법 기록)', () => {
    const { sim, I, s, bomb, w, op } = bombScene('R3-ROBOT');
    giveTask(sim, s, op, w);
    for (let k = 0; k < 60 && !bomb.mitigated && !bomb.exploded; k++) stepOne(sim, s, op, 5);
    expect(bomb.mitigated || bomb.exploded).toBe(true);
    if (bomb.mitigated) {
      expect(Math.hypot(op.x - bomb.x, op.y - bomb.y)).toBeLessThanOrEqual(8.6);
      expect((I.methods ?? []).some((m) => m.method === 'robotDefuse' && m.ok)).toBe(true);
    }
  });
  it('처리 요원의 중상 신고 → 손으로 하는 해체 금지(S23): 로봇이 있으면 조작 요원만, 로봇도 없으면 아무도 맡지 않는다 (맡을 사람이 없는 작업 — B3 가 처리반을 부른다)', () => {
    const { sim, s, w, tech, op } = bombScene('R3-S23');
    report(sim, tech, { band: 1 });
    expect(fitFor(sim, s, tech, w)).toBe(0);
    expect(fitFor(sim, s, op, w)).toBeGreaterThan(0);
    noKit(sim, op, 'robot'); docForget();
    for (const a of s.agents) expect(fitFor(sim, s, a, w), sim.responders[a.rid].role).toBe(0);
  });
  it('해체 중에 동요하면 해체를 넘기고 놓는다(S23 — 한 번 알림·교본 기록), 그 작업은 30초 동안 맡지 않는다', () => {
    const { sim, I, s, w, tech, op } = bombScene('R3-S23b');
    noKit(sim, op, 'robot'); docForget();
    giveTask(sim, s, tech, w); act(sim, s, tech);
    expect(tech.task!.method).toBe('suitDefuse');
    tech.shaken = sim.t + 20;
    stepOne(sim, s, tech, 1.2);
    expect(tech.task).toBeNull();
    expect(said(sim, 0, tech.rid, '손이 떨립니다 — 해체를 넘기겠습니다.')).toBe(true);
    expect(I.docs!.some((d) => d.rule === 'S23' && d.rid === tech.rid && d.hook === 'method')).toBe(true);
    expect(fitFor(sim, s, tech, w)).toBe(0);
  });
  it('로봇이 없고 옮길 수 없는 사람이 장치 6칸 안 → 맨몸 해체(S07 ×2), 그 사람이 없으면 방호복 해체. 맨몸 해체 중에는 방호복이 폭발·총격을 막지 않는다', () => {
    const { sim, I, s, bomb, w, tech, op } = bombScene('R3-S07');
    noKit(sim, op, 'robot'); docForget();
    const tg = { cas: -1, prop: bomb.id, hostile: -1, region: -1, tile: -1 };
    expect(chooseMethod(sim, s, tech, 'defuse', tg, null, NO_SENSE, docCtx(sim, s, tech, 'self', w))!.m).toBe('suitDefuse');
    casBelief(sim, tech, 999, bomb.x + 2, bomb.y, 'immobile');
    docForget();
    const pk = chooseMethod(sim, s, tech, 'defuse', tg, null, NO_SENSE, docCtx(sim, s, tech, 'self', w))!;
    expect(pk.m).toBe('bareDefuse'); expect(pk.doc).toBe('S07');
    expect(blastFactor(sim, tech.rid)).toBe(0.35); expect(blastFactor(sim, tech.rid, true)).toBe(1);
    expect(armorOf(sim, tech.rid, false, true)).toBeLessThan(armorOf(sim, tech.rid, false));
    const r = sim.responders[tech.rid];
    const hurt = (m: 'bareDefuse' | 'suitDefuse'): number => { tech.task = makeTask('defuse', '시험', w); tech.task.method = m; r.health = 100; r.bleed = 0; tech.hpTick = 100; return hurtResponder(sim, s, I, tech, 20, 'blast'); };
    expect(hurt('bareDefuse')).toBeGreaterThan(hurt('suitDefuse') * 2);
    // 방호복이 없으면(결원·지원 부대) 옮길 수 없는 사람이 없어도 맨몸 해체가 후보다
    tech.task = null; r.health = 100;
    noKit(sim, tech, 'bombSuit');
    const w2 = swapCas(tech);
    expect(chooseMethod(sim, s, tech, 'defuse', tg, null, NO_SENSE, docCtx(sim, s, tech, 'self', w2 ?? w))!.m).toBe('bareDefuse');
  });
  it('해체가 진행 중이면 장치 6칸 안의 일은 맡지 않고(S08) 지휘관이 거둔다(CS1 — 장치마다 한 번 알림). 반경 안 시민의 대피 안내는 막지 않는다. 그 원을 지나는 길은 +20', () => {
    const { sim, I, s, bomb, w, tech } = bombScene('R3-S08', ['eod', 'patrol']);
    const cop = s.agents.find((a) => sim.units[a.unitId].kind === 'patrol')!;
    const rg = s.region[bomb.y * s.w + bomb.x];
    const wS = work(sim, s, 'search', { region: rg, priority: 0.6 });
    expect(Math.hypot(s.regions[rg].cx - bomb.x, s.regions[rg].cy - bomb.y)).toBeLessThanOrEqual(6);
    casBelief(sim, cop, 998, bomb.x + 3, bomb.y, 'mobile');
    const wE = work(sim, s, 'escort', { cas: 998, priority: 0.7 });
    expect(fitFor(sim, s, cop, wS)).toBeGreaterThan(0);
    const spot = spotAt(s, bomb.x, bomb.y, 1, 1.6, false)!;
    const tile = spotAt(s, bomb.x, bomb.y, 2.5, 4, false)!;
    const ti = tile.y * s.w + tile.x;
    const c0 = agentCost(sim, s, cop)(ti);
    put(tech, spot); giveTask(sim, s, tech, w);
    docForget();
    expect(fitFor(sim, s, cop, wS)).toBe(0);
    expect(fitParts(sim, s, cop, wS).hits.map((h) => h.rule.id)).toContain('S08');
    expect(fitFor(sim, s, cop, wE)).toBeGreaterThan(0);
    expect(agentCost(sim, s, cop)(ti)).toBeCloseTo(c0 + 20, 1);
    // 지휘 CS1 (지휘 교본 — 이 파일의 등록이 ORDER_RULES 의 마지막이다)
    const cancelled: number[] = [];
    const k: CommandKit = { want: () => { throw new Error('want'); }, cancel: (pred) => { for (const q of s.board) if ((q.status === 'open' || q.status === 'active') && pred(q)) cancelled.push(q.id); }, request: () => -1, countUnits: () => 0, unitsOnScene: () => [] };
    const docOrders = ORDER_RULES.find((r) => String(r).includes('CP2'))!;      // (합치기) 경찰 지휘 교본의 등록 — CS1 은 그 안에서 불린다 (의료의 지휘 줄이 같은 파일의 둘째 등록이라 마지막 등록이 아니다)
    docOrders(sim, s, I, cop, k);
    docOrders(sim, s, I, cop, k);
    expect(cancelled).toContain(wS.id);
    expect(cancelled).not.toContain(wE.id); expect(cancelled).not.toContain(w.id);
    expect(sim.events.filter((e) => e.text.startsWith('해체 시작 — 반경 6칸 비워라')).length).toBe(1);
    expect(I.docs!.filter((d) => d.rule === 'CS1')).toMatchObject([{ hook: 'cmd', rid: -1 }]);
  });
});
/** (시험 도구) 해체 작업은 그대로 쓴다 — 자리표시 */
function swapCas(_a: FieldAgent): WorkItem | null { return null; }

describe('R3 단계 5: 특수 줄의 장면 — 폭파 진입(S26)·잠긴 방(S03)·줄 서기·저격·진입조·수난 (측정 묶음에서 드문 줄을 장면이 쓴다)', () => {
  /** 인질극 현장의 특공: 진입대원(파괴)·방패수·저격수·팀장, 출입구가 아닌 방 문 하나 (진입대원의 믿음 'locked') */
  function swatScene(seed: string) {
    const env = sceneWith(seed, 'armed/hostage', ['swat', 'patrol']);
    const { sim, s } = env;
    for (const a of s.agents) { a.task = null; a.orderWork = -1; }
    const role = (id: string): FieldAgent => s.agents.find((a) => sim.responders[a.rid].role === id)!;
    const door = s.props.find((p) => p.kind === 'door' && !s.exits.some((e) => Math.abs(e.x - p.x) + Math.abs(e.y - p.y) <= 1.5)) as Prop;
    const tile = door.y * s.w + door.x;
    const br = role('breacher');
    br.beliefs.merge(mkFact('blk', tile, 'locked', '시험', sim.t, 1, true, '시험'));
    docForget();
    return { ...env, br, sh: role('shield'), mk: role('marksman'), lead: role('swatLead'), door, tile };
  }
  const holder = (sim: Sim, a: FieldAgent, id: number, x: number, y: number, t: number): void => { a.beliefs.merge(mkFact('hos', id, { x, y, weapon: 'gun', state: 'hold', hostage: true, facing: 0 }, '시험', t, 1, true, '시험')); docForget(a); };
  it('S26: 인질을 붙든 용의자의 믿음이 10초 안이고 문에서 4칸 밖이면 진입 순간 폭파 ×1.2 — 낡았거나 문 곁이거나, 인질극인데 붙든 용의자를 모르면 ×0', () => {
    const { sim, s, br, tile, door } = swatScene('R3-S26');
    s.entryOrdered = true;
    for (const f of br.beliefs.list('hos')) br.beliefs.merge(mkFact('hos', f.id, { ...f.value, hostage: false }, '시험', sim.t + 0.01, 1, true, '시험'));
    const far = spotAt(s, door.x, door.y, S26_NEAR + 1.5, S26_NEAR + 4, false)!;
    holder(sim, br, 77, far.x, far.y, sim.t + 0.01);
    const mul = (): number => docMethodMul(dcAt(sim, s, br, null, { tile }), 'charge');
    expect(mul()).toBeCloseTo(1.2, 9);
    holder(sim, br, 78, far.x, far.y, sim.t - S26_AGE - 1);      // 다른 용의자의 낡은 믿음
    expect(mul()).toBe(0);
    const w2 = swatScene('R3-S26b');
    w2.s.entryOrdered = true;
    holder(w2.sim, w2.br, 77, w2.door.x + 1, w2.door.y, w2.sim.t + 0.01);      // 문 곁 (4칸 안)
    expect(docMethodMul(dcAt(w2.sim, w2.s, w2.br, null, { tile: w2.tile }), 'charge')).toBe(0);
    const w3 = swatScene('R3-S26c');
    w3.s.entryOrdered = true;
    for (const f of w3.br.beliefs.list('hos')) w3.br.beliefs.merge(mkFact('hos', f.id, { ...f.value, hostage: false }, '시험', w3.sim.t + 0.01, 1, true, '시험'));
    const I3 = w3.sim.incidents[w3.s.incidentId];
    I3.assessment = { ...I3.assessment!, label: '인질극' };
    docForget();
    expect(docMethodMul(dcAt(w3.sim, w3.s, w3.br, null, { tile: w3.tile }), 'charge')).toBe(0);      // 붙든 용의자를 모른다
  });
  it('S03: 진입 결정 전 무장 현장의 잠긴 문은 열지 않고 기다린다(상한 30초 · 지원이 오면 45초) — 진입이 정해지면 풀린다. 도주 용의자를 쫓는 교전은 막지 않는다', () => {
    const { sim, s, lead } = swatScene('R3-S03');
    lead.task = makeTask('search', '시험'); docForget();
    const g = docGate(sim, s, lead, 'forceDoor');
    expect(g.ok).toBe(false); expect(g.rule).toBe('S03');
    expect([S03_WAIT, S03_WAIT_BACKUP]).toContain(g.wait);
    lead.task = makeTask('engage', '시험'); docForget();
    expect(docGate(sim, s, lead, 'forceDoor').ok).toBe(true);
    lead.task = makeTask('search', '시험');
    s.entryOrdered = true; docForget();
    expect(docGate(sim, s, lead, 'forceDoor').ok).toBe(true);
  });
  it('S01: 방패를 든 특공 대원이 다치지도 동요하지도 않았으면 동시 진입에서 줄 서기 — 다치면(자기 몸 band 1) 고르지 않는다', () => {
    const { sim, s, sh } = swatScene('R3-S01');
    sh.task = makeTask('engage', '시험'); docForget();
    expect(docGate(sim, s, sh, 'breach').opt).toBe('stack');
    sim.responders[sh.rid].health = 60; docForget();
    expect(docGate(sim, s, sh, 'breach').opt).toBeNull();
  });
  it('S02·S05·S22: 저격수는 진입조에 덜(×0.3 — 결정적 저격 조건이면 그대로)·봉쇄 +0.1, 섬광탄을 든 경찰은 진입 뒤 교전 +0.1, 특공 팀장은 결정 전 협상 +0.15 · 뒤 교전 +0.1. S24: 동요한 저격수는 저격하지 않는다', () => {
    const { sim, s, mk, lead, br } = swatScene('R3-S02');
    const h = s.hostiles[0];
    for (const a of s.agents) a.beliefs.merge(mkFact('hos', h.id, { x: Math.round(h.x), y: Math.round(h.y), weapon: 'gun', state: 'hold', hostage: false, facing: 0 }, '시험', sim.t + 0.01, 1, true, '시험'));
    const wE = work(sim, s, 'engage', { hostile: h.id, priority: 0.9, max: 3 }), wP = work(sim, s, 'perimeter', { tile: 0 }), wN = work(sim, s, 'negotiate', { hostile: h.id });
    docForget();
    const ids = (a: FieldAgent, w: WorkItem): string[] => fitParts(sim, s, a, w).hits.map((q) => q.rule.id);
    expect(ids(mk, wE)).toContain('S02'); expect(ids(mk, wP)).toContain('S02');
    expect(fitParts(sim, s, mk, wE).hits.find((q) => q.rule.id === 'S02')!.mul).toBeCloseTo(0.3, 9);
    expect(ids(lead, wN)).toContain('S22');
    expect(ids(br, wE)).not.toContain('S05');
    s.entryOrdered = true; docForget();
    expect(ids(br, wE)).toContain('S05'); expect(ids(lead, wE)).toContain('S22');
    // S24 — 동요한 저격수 (자기 모드)
    mk.shaken = sim.t + 10; docForget();
    expect(docMethodMul(dcAt(sim, s, mk, wE), 'sniper')).toBe(0);
  });
  it('S13·S15·S25: 구조정 대원은 보트 ×1.3·헤엄 ×0, 같은 대상에 호이스트 작업이 열려 있으면 헤엄 ×0.5·줄 확보 ×1.2, 지친 수난 대원은 헤엄 ×0', () => {
    const { sim, s } = sceneWith('R3-S13', 'water/std', ['boat', 'rescue']);
    const boater = s.agents.find((a) => sim.responders[a.rid].role === 'boatRescuer')!;
    const rope = s.agents.find((a) => sim.responders[a.rid].role === 'ropeTech')!;
    const wW = work(sim, s, 'waterRescue', { cas: s.casualties[0].id, priority: 0.95 });
    docForget();
    expect(docMethodMul(dcAt(sim, s, boater, wW), 'boat')).toBeCloseTo(1.3, 9);
    expect(docMethodMul(dcAt(sim, s, boater, wW), 'swim')).toBe(0);
    expect(docMethodMul(dcAt(sim, s, rope, wW), 'swim')).toBe(1);
    work(sim, s, 'hoist', { cas: s.casualties[0].id, priority: 0.95 });
    docForget();
    expect(docMethodMul(dcAt(sim, s, rope, wW), 'swim')).toBeCloseTo(0.5, 9);
    expect(docMethodMul(dcAt(sim, s, rope, wW), 'tend')).toBeCloseTo(1.2, 9);
    sim.responders[rope.rid].stamina = 20; docForget();
    expect(docMethodMul(dcAt(sim, s, rope, wW), 'swim')).toBe(0);
  });
  it('S19: 화재 현장에 다른 공기호흡기 대원이 둘 이상이면 사다리 조작원의 실내 수색 ×0.3 · D1: 가스 누출은 위험도 1.6 부터 구조 수요 1, 그 수요에 화학 구조차 +30', () => {
    const { sim, s, of } = sceneWith('R3-S19', 'fire/std', ['ladder', 'engine']);
    const op = of('ladder').find((a) => sim.responders[a.rid].role === 'ladderOp')!;
    const wS = work(sim, s, 'search', { region: s.regions.findIndex((r) => r.indoor) });
    docForget();
    expect(fitParts(sim, s, op, wS).hits.map((q) => q.rule.id)).toContain('S19');
    const n: Needs = emptyNeeds();
    expect(docNeeds(sim, 'hazmat', 1.7, false, undefined, n)).toContain('D1');
    expect(n.rescue).toBe(1);
    const I = sim.incidents[s.incidentId];
    I.assessment = { ...I.assessment!, type: 'hazmat' };
    const hz = sim.units.find((u) => u.kind === 'hazmat')!, rs = sim.units.find((u) => u.kind === 'rescue')!;
    expect(dispatchPref(sim, I, hz, 'rescue')).toEqual({ add: 30, rule: 'D1' });
    expect(dispatchPref(sim, I, rs, 'rescue').rule).toBeNull();
  });
});

// ═════════════════════════ 단계 3·4·5 합치기 — 화학 짝·대기조(S10·S11) · 혼자 서는 역할의 실내(주 세션 결정 (라)) · 짝은 일하면서 함께(나) ═════════════════════════
import { rebuddy } from '../src/sim/field/doctrineRun';
import { DOC_SWITCH } from '../src/sim/field/doctrine/registry';

describe('R3 합치기: 화학 짝·대기조 (S10·S11)', () => {
  it('S10: 가스 누출 현장의 위험 실내 수색은 측정기를 든 화학 대원이 먼저(+0.15) — 측정기 없는 보호복 대원에게는 걸리지 않는다', () => {
    const { sim, s, of } = sceneWith('R3-S10', 'hazmat/std', ['hazmat']);
    const hz = of('hazmat');
    const decon = roleIn(sim, hz, 'decon'), tech = roleIn(sim, hz, 'hazTech');
    const rg = s.regions.findIndex((r) => r.indoor && r.searchable);
    expect(rg).toBeGreaterThanOrEqual(0);
    const w = work(sim, s, 'search', { region: rg });
    for (const b of s.agents) { b.task = null; b.orderWork = -1; }
    docForget();
    const dd = docFitRules(sim, s, decon, w, 0.5), dt = docFitRules(sim, s, tech, w, 0.5);
    expect(dd.hits.some((h) => h.rule.id === 'S10' && h.add === 0.15), JSON.stringify(dd.hits.map((h) => h.rule.id))).toBe(true);
    expect(dt.hits.some((h) => h.rule.id === 'S10')).toBe(false);
  });
  it('S11: 자기 부대의 안쪽 짝이 위험 실내에 있으면 화학 팀장은 위험 실내 일을 덜 맡는다(×0.3) — 짝이 나오면 풀린다', () => {
    const { sim, s, of } = sceneWith('R3-S11', 'hazmat/std', ['hazmat']);
    const hz = of('hazmat');
    const lead = roleIn(sim, hz, 'hazLead'), tech = roleIn(sim, hz, 'hazTech');
    const rg = s.regions.findIndex((r) => r.indoor && r.searchable);
    const w = work(sim, s, 'search', { region: rg });
    for (const b of s.agents) { b.task = null; b.orderWork = -1; }
    put(tech, s.staging); docForget();
    expect(docFitRules(sim, s, lead, w, 0.5).hits.some((h) => h.rule.id === 'S11')).toBe(false);
    put(tech, inSpot(s, rg)); docForget();
    const h = docFitRules(sim, s, lead, w, 0.5).hits.find((x) => x.rule.id === 'S11');
    expect(h, '안쪽 짝이 실내 — S11').toBeDefined();
    expect(h!.mul).toBe(0.3);
  });
});

describe('R3 균형: 혼자 서는 역할의 위험 실내 (본문 §5.1 — DOC_SWITCH.SOLO_IN 기본 true, 합치기 (라)는 false)', () => {
  it('기관원(혼자 서는 역할)은 따라올 짝이 없어도 위험 실내 수색을 맡는다(F04 에서 빠진다 — 본문 §5.1) — 스위치를 끄면(합치기 (라)) 맡지 않는다', () => {
    const { sim, s, op, lead, rg } = fireScene('R3-SOLO', ['engine']);
    const w = work(sim, s, 'search', { region: rg });
    for (const b of s.agents) { b.task = null; b.orderWork = -1; }
    lead.status = 'withdrawn'; op.buddy = -1; docForget();      // 짝(진압 팀장)이 없다
    expect(SOLO_OK.has('engineer')).toBe(true);
    expect(DOC_SWITCH.SOLO_IN).toBe(true);
    expect(fitFor(sim, s, op, w)).toBeGreaterThan(0);
    DOC_SWITCH.SOLO_IN = false; docForget();
    try { expect(fitFor(sim, s, op, w)).toBe(0); } finally { DOC_SWITCH.SOLO_IN = true; docForget(); }
  });
});

describe('R3 합치기: 짝은 일하면서 함께 다닌다 (주 세션 결정 (나))', () => {
  it('다시 맺기: 짝이 혼자 서는 역할(기관원)인 손 빈 진압 팀장(지휘관 아님)은 다른 부대의 짝 없는 손 빈 대원과 맺고, 남겨진 기관원은 짝이 없어진다', () => {
    const { sim, s, of } = sceneWith('R3-REB', 'fire/std', ['engine', 'rescue']);
    const eng = of('engine'), res = of('rescue');
    const lead = roleIn(sim, eng, 'fireLead'), op = roleIn(sim, eng, 'engineer'), rl = roleIn(sim, res, 'rescueLead');
    for (const b of s.agents) { b.task = null; b.orderWork = -1; b.isCommander = false; }
    expect(lead.buddy).toBe(op.rid); expect(op.buddy).toBe(lead.rid);
    expect(rl.buddy ?? -1).toBe(-1);
    rebuddy(sim, s, lead);
    expect(lead.buddy).toBe(rl.rid); expect(rl.buddy).toBe(lead.rid);
    expect(op.buddy).toBe(-1);
    // 지휘관은 다시 맺지 않는다 (밖에 남는다 — CF7)
    const q = sceneWith('R3-REB2', 'fire/std', ['engine', 'rescue']);
    const l2 = roleIn(q.sim, q.of('engine'), 'fireLead'), o2 = roleIn(q.sim, q.of('engine'), 'engineer');
    for (const b of q.s.agents) { b.task = null; b.orderWork = -1; b.isCommander = false; }
    l2.isCommander = true;
    rebuddy(q.sim, q.s, l2);
    expect(l2.buddy).toBe(o2.rid);
  });
  it('둘째 자리: 지휘관이 위험 실내 일(센 불의 진압 — 두 자리)을 맡기는 그 자리에서 짝에게도 그 둘째 자리를 함께 준다 ("— …과 짝으로")', () => {
    const { sim, I, s, noz, ff, lead, rg } = fireScene('R3-PAIRA', ['engine']);
    nobodyInside(sim, s);
    for (const w0 of s.board) w0.status = 'done';
    const w1 = work(sim, s, 'suppress', { region: rg, priority: 0.8, max: 2 });
    for (const b of s.agents) { b.task = null; b.orderWork = -1; b.isCommander = b === lead; if (b !== noz && b !== ff && b !== lead) b.status = 'withdrawn'; }
    put(noz, s.staging); put(ff, s.staging); docForget();
    const ev0 = sim.events.length;
    assign(sim, s, I, lead);
    expect(w1.assignees).toContain(noz.rid); expect(w1.assignees).toContain(ff.rid);
    expect(sim.events.slice(ev0).some((e) => /짝으로\.$/.test(e.text))).toBe(true);
  });
});

// ═════════════════════════ 균형 (사용자 결정 2026-11-16) — 건물 화재 첫 출동의 펌프차 하나 더(D8) · 허락된 일을 하는 짝의 동행 ═════════════════════════
import { FIRST_PLUS } from '../src/sim/dispatch/doctrine';
import { SIGN_BASE } from '../src/sim/field/ops';
import type { SignBelief } from '../src/sim/types';

describe('R3 균형: D8 건물 화재의 첫 출동 — 펌프차 하나 더 (관제가 아는 것만)', () => {
  const fresh = (): Sim => new Sim('R3-D8', FULL);
  const sup = (sim: Sim, type: IncidentType, place: Parameters<typeof docNeeds>[6], label?: string, base = 1): { used: string[]; n: number } => {
    const n: Needs = emptyNeeds(); n.suppression = base;
    const used = docNeeds(sim, type, 1.8, false, label, n, place);
    return { used, n: n.suppression };
  };
  it('위치 신고가 건물(현장 틀이 있는 종류)인 화재면 진압 수요 +1 — 기본 2(센 불)이면 3', () => {
    const sim = fresh();
    expect(FIRST_PLUS.reserve).toBe(1);
    expect(sup(sim, 'fire', 'houseS')).toEqual({ used: ['D8'], n: 2 });
    expect(sup(sim, 'fire', 'apartment', '방화', 2)).toEqual({ used: ['D8'], n: 3 });
  });
  it('건물이 아니거나(교차로·공원·숲·위치 모름) 관제가 산불·비행기 추락·선박 화재로 이름 붙였거나 화재가 아니면 걸지 않는다', () => {
    const sim = fresh();
    for (const p of ['intersection', 'park', 'forest', undefined] as const) expect(sup(sim, 'fire', p).used).toEqual([]);
    for (const l of ['산불', '비행기 추락', '선박 화재']) expect(sup(sim, 'fire', 'pension', l).used).toEqual([]);
    expect(sup(sim, 'hazmat', 'factory').used).not.toContain('D8');
    expect(sup(sim, 'collapse', 'villa').used).not.toContain('D8');
  });
  it('나갈 수 있는 펌프차(진압 펌프차·사다리차 — 이 사건에 배정된 것 포함)가 기본 수요 + 1 대 + 남겨 둘 한 대(FIRST_PLUS.reserve)에 못 미치면 걸지 않는다 (없는 부대를 기다리는 수요를 만들지 않는다)', () => {
    const sim = fresh();
    const pumps = sim.units.filter((u) => u.kind === 'engine' || u.kind === 'ladder');
    expect(pumps.length).toBeGreaterThanOrEqual(3);
    for (const u of pumps.slice(2)) u.state = 'onscene';
    expect(sup(sim, 'fire', 'houseS').used).toEqual([]);
    pumps[2].state = 'returning';
    expect(sup(sim, 'fire', 'houseS').used).toEqual(['D8']);
    pumps[2].state = 'onscene'; pumps[1].state = 'enroute';      // 다른 사건으로 가는 펌프차는 세지 않는다 (이 사건에 배정된 것만)
    expect(sup(sim, 'fire', 'houseS').used).toEqual([]);
  });
  it('스위치(DOC_SWITCH.D8)를 끄면 걸지 않는다 · 관제 줄 이름표가 소방 분야에 있다', () => {
    const sim = fresh();
    DOC_SWITCH.D8 = false;
    try { expect(sup(sim, 'fire', 'houseS').used).toEqual([]); } finally { DOC_SWITCH.D8 = true; }
    expect(CMD_ROWS.find((c) => c.id === 'D8')).toMatchObject({ dept: 'fire', hook: 'dispatch' });
  });
  it('관제 평가(assess)가 건물 화재 신고에 D8 을 기록하고 진압 수요를 둘 이상으로 둔다', () => {
    const sim = new Sim('R3-D8b', NORMAL, 600, { force: 'fire/std' });
    let I: Incident | undefined;
    while (sim.t < 240 && I === undefined) { sim.step(); I = sim.incidents.find((x) => x.truth.type === 'fire' && (x.docs ?? []).some((d) => d.rule === 'D8')); }
    expect(I, 'D8 이 쓰인 건물 화재').toBeDefined();
    expect(I!.assessment!.needs.suppression).toBeGreaterThanOrEqual(2);
  });
});

describe('R3 균형: 허락된 일(밸브 차단)을 하는 짝을 따라 들어간 동행은 가스 단계 3 에 물러나지 않는다 (짝 따라 나가기가 밸브를 잠그던 짝까지 데리고 나오던 고리)', () => {
  it('짝이 밸브 차단(허락된 일)이면 동행은 남고, 짝의 일이 수색(허락되지 않은 일)이면 동행은 철수 의무로 물러난다', () => {
    const { sim, s, of } = sceneWith('R3-GASPAIR', 'hazmat/std', ['engine']);
    const eng = of('engine');
    const noz = roleIn(sim, eng, 'nozzle'), ff = roleIn(sim, eng, 'firefighter');
    const rg = s.regions.findIndex((r) => r.indoor && r.searchable);
    const reg = s.regions[rg];
    for (const b of s.agents) { b.task = null; b.orderWork = -1; b.isCommander = false; if (b !== noz && b !== ff) b.status = 'withdrawn'; }
    noz.buddy = ff.rid; ff.buddy = noz.rid;
    const spot = inSpot(s, rg);
    put(noz, spot); put(ff, spot);
    const g3 = mkFact('sign', SIGN_BASE.gas + rg, { kind: 'gas', level: 3, region: rg, x: reg.cx, y: reg.cy, lel: 70 } as SignBelief, '시험', sim.t, 1, true, '');
    noz.beliefs.merge(g3); ff.beliefs.merge(g3);
    const wM = work(sim, s, 'mitigate', { region: rg });
    noz.task = makeTask('mitigate', '시험', wM); wM.assignees.push(noz.rid);
    ff.task = makeTask('pair', '짝 동행');
    think(sim, s, ff);
    expect(ff.task?.kind, '허락된 일의 동행').toBe('pair');
    const wS = work(sim, s, 'search', { region: rg });
    noz.task = makeTask('search', '시험', wS); wS.assignees.push(noz.rid);
    ff.task = makeTask('pair', '짝 동행');
    think(sim, s, ff);
    expect(ff.task?.kind, '허락되지 않은 일의 동행').toBe('evacuate');
  });
});

describe('R3 균형: 밖 대기조는 출입구 곁 또는 대기 지점 곁의 손 빈 대원 (WATCH_STAGE — 대기 지점이 출입구에서 먼 현장)', () => {
  it('출입구에서 멀어도 대기 지점 4칸 안의 손 빈 공기호흡기 대원은 대기조로 센다 — 둘 다 먼 대원은 세지 않는다', () => {
    const { sim, s, noz, ff, lead, op } = fireScene('R3-WSTAGE', ['engine']);
    for (const b of s.agents) { b.task = null; b.orderWork = -1; }
    const st = s.staging;
    const far = { x: st.x + 40, y: st.y };      // 대기 지점에서 먼 가상의 출입구 (WATCH_R 12 밖)
    put(noz, far); put(ff, far); lead.status = 'withdrawn';
    put(op, st);
    expect(outsideWatch(sim, s, noz, far), '대기 지점의 기관원').toBe(1);
    put(op, { x: st.x + 20, y: st.y });
    expect(outsideWatch(sim, s, noz, far), '대기 지점에서도 출입구에서도 먼 기관원').toBe(0);
  });
});

// ═════════════════════════ 단계 6 (이송·교통 방법) — 시험 2-k · 척추 고정(E13) · 끌기(E14) · 소방차 차단(F18) ═════════════════════════
import { raiseProblem } from '../src/sim/events';
import { METHOD, WORK_MODE, methodsOf } from '../src/sim/field/methods';
import { BLOCK_LANE, CARRY, dragSmoke, dragging, laneShieldMul } from '../src/sim/field/doctrineRun';
import { moveSpeed } from '../src/sim/field/executor';
import { tickCasualties, tickLane } from '../src/sim/field/hazards';
import { agentHealth } from '../src/sim/field/sceneManager';
import type { MethodId, Weather } from '../src/sim/types';
import type { Rng } from '../src/sim/rng';

/** 난수 흐름의 사본 (원본은 소비하지 않는다) */
const cloneRng = (r: Rng): Rng => { const c = Object.create(Object.getPrototypeOf(r)); Object.assign(c, r); return c as Rng; };
/** 교통사고 현장을 그 날씨로: 대원을 내려 세우고 임무를 비운다 */
function laneScene(seed: string, weather: Weather, kinds: UnitKind[] = ['patrol', 'engine', 'als']) {
  const env = sceneWith(seed, 'traffic/std', kinds);
  (env.sim as unknown as { weather: Weather }).weather = weather;
  for (const b of env.s.agents) { b.task = null; b.orderWork = -1; b.isCommander = false; const u = env.sim.units[b.unitId]; u.state = 'onscene'; u.incidentId = env.I.id; }      // 부대는 이 현장에 와 있다 (차량 차단은 막은 부대가 현장에 있는 동안만이다)
  expect(env.s.laneRows.length).toBe(2); expect(env.s.controlPts.length).toBe(2);
  docForget();
  return { ...env, cop: env.of('patrol')[0], cop2: env.of('patrol')[1] };
}
const usedMethods = (I: Incident, w: WorkKind): MethodId[] => (I.methods ?? []).filter((u) => u.ok && u.work === w).map((u) => u.method);

describe('R3 시험 8 (단계 6): 방법 표 — 이송 셋·교통 통제 둘, 줄 넷(P20·F18·E13·E14)', () => {
  it('업기·통제는 평소 방법으로 늘 남고, 끌기·차량 차단은 교본 배율이 걸릴 때만 1등이다. 들것은 기록 전용. 다섯 줄은 N9 의 다섯 앞에 있다', () => {
    const ids = Object.keys(METHOD) as MethodId[];
    for (const m of ['pack', 'drag', 'litter', 'post', 'blockLane'] as MethodId[]) expect(ids.indexOf(m), m).toBeLessThan(ids.indexOf('dive'));
    expect(methodsOf('carry')).toEqual(['pack', 'drag', 'litter']); expect(methodsOf('traffic')).toEqual(['post', 'blockLane']);
    expect(WORK_MODE.carry).toBe('always'); expect(WORK_MODE.traffic).toBe('always');
    expect([METHOD.pack.pref, METHOD.drag.pref, METHOD.post.pref, METHOD.blockLane.pref]).toEqual([0.7, 0.5, 0.75, 0.6]);
    expect(METHOD.pack.plain && METHOD.post.plain && METHOD.litter.plain).toBe(true); expect(METHOD.litter.record).toBe(true); expect(METHOD.litter.kits).toEqual(['stretcher']);
    expect(METHOD.drag.plain || METHOD.blockLane.plain).toBe(false);
    const rule = (id: string): DoctrineRule => DOCTRINE.find((r) => r.id === id)!;
    const mul = (id: string): number => { const e = rule(id).effect; const one = Array.isArray(e) ? e[0] : e; return one.kind === 'methodMul' ? one.mul : NaN; };
    expect(METHOD.drag.pref * mul('E14')).toBeGreaterThan(METHOD.pack.pref);            // 0.80 > 0.70 — 조건이면 끌기가 1등
    expect(METHOD.blockLane.pref * mul('P20')).toBeGreaterThan(METHOD.post.pref);       // 0.90 > 0.75
    expect(METHOD.blockLane.pref * mul('F18')).toBeGreaterThan(METHOD.post.pref);
    expect(rule('P20')).toMatchObject({ dept: 'police', hook: 'method', works: ['traffic'], methods: ['blockLane'], who: { dept: ['police'] }, rank: 3, why: 'danger' });
    expect(rule('F18')).toMatchObject({ dept: 'fire', hook: 'method', works: ['traffic'], methods: ['blockLane'], who: { units: ['engine', 'ladder'] }, rank: 3, why: 'danger' });
    expect(rule('E13')).toMatchObject({ dept: 'ems', hook: 'gate', gate: 'carryStart', works: ['carry'], kits: ['spineBoard'], effect: { kind: 'choose', opt: 'immobilize' }, rank: 3, why: 'kit' });
    expect(rule('E14')).toMatchObject({ dept: 'ems', hook: 'method', works: ['carry'], methods: ['drag'], noKits: ['stretcher'], rank: 1, why: 'danger' });
    expect(BLOCK_LANE).toEqual({ setup: 3, careless: 0.4 }); expect(CARRY).toEqual({ dragSmoke: 0.5, dragSpeed: 0.85, immobilize: 3 });
  });
});

describe('R3 시험 2-k (단계 6): 차량 차단 — 밤·2차 사고 뒤의 경찰(P20), 차량 화재·연료 누출의 소방차(F18). 닿는 순간부터 통제 전까지 그 방향 차의 부주의 ×0.4, 난수 호출 수는 그대로', () => {
  it('밤이면 경찰이 차량 차단을 고른다(P20 — 시작 문구·교본 기록). 맑으면 통제, 맑아도 그 현장에 2차 사고가 있었으면 차량 차단. 구급 대원은 밤에도 통제', () => {
    const night = laneScene('R3-K1', 'night');
    const w = work(night.sim, night.s, 'traffic', { tile: 0 });
    giveTask(night.sim, night.s, night.cop, w);
    const from = night.sim.events.length;
    act(night.sim, night.s, night.cop);
    expect(night.cop.task!.method).toBe('blockLane');
    expect(night.cop.task!.mwhy).toBe('danger');
    expect(said(night.sim, from, night.cop.rid, '차량으로 차로 입구를 막겠습니다')).toBe(true);
    expect((night.I.docs ?? []).some((d) => d.rule === 'P20' && d.hook === 'method' && d.method === 'blockLane' && d.work === 'traffic')).toBe(true);
    expect(night.s.laneShield).toBeNull();      // 아직 통제 지점에 닿지 않았다
    const medic = night.of('als')[0];
    const w1 = work(night.sim, night.s, 'traffic', { tile: 1, max: 2 }); giveTask(night.sim, night.s, medic, w1);
    act(night.sim, night.s, medic);
    expect(medic.task!.method).toBe('post');      // P20 은 경찰에게만
    // 부대의 차는 한 대다 — 같은 순찰차의 동료가 서측 입구를 차량으로 막으러 가는 동안, 동측을 맡은 경찰은 평소 통제
    expect(night.cop2.unitId).toBe(night.cop.unitId);
    giveTask(night.sim, night.s, night.cop2, w1);
    act(night.sim, night.s, night.cop2);
    expect(night.cop2.task!.method).toBe('post');
    // 그 차가 서측 입구를 막고 선 뒤에는(통제가 끝나 임무를 마쳐도) 같은 부대는 다른 입구를 차량으로 막지 못한다
    put(night.cop, night.s.controlPts[0]);
    stepOne(night.sim, night.s, night.cop, 12);
    expect(night.s.controlDone[0]).toBe(true); expect(night.cop.task).toBeNull(); expect(night.s.laneShield).toEqual([0]);
    const tg1 = { cas: -1, prop: -1, hostile: -1, region: -1, tile: 1 };
    expect(chooseMethod(night.sim, night.s, night.cop, 'traffic', tg1, null, NO_SENSE, docCtx(night.sim, night.s, night.cop, 'self', w1))!.m).toBe('post');
    // 맑은 날
    const day = laneScene('R3-K1', 'clear');
    const wd = work(day.sim, day.s, 'traffic', { tile: 0 }); giveTask(day.sim, day.s, day.cop, wd);
    act(day.sim, day.s, day.cop);
    expect(day.cop.task!.method).toBe('post');
    expect((day.I.docs ?? []).some((d) => d.rule === 'P20')).toBe(false);
    // 맑아도 2차 사고가 있었던 현장
    raiseProblem(day.sim, day.I, 'SECONDARY_COLLISION', '시험', { role: 'SYSTEM', actor: '현장', imp: 3, text: '시험: 2차 사고' }, false);
    docForget();
    const wd1 = work(day.sim, day.s, 'traffic', { tile: 1 }); giveTask(day.sim, day.s, day.cop2, wd1);
    act(day.sim, day.s, day.cop2);
    expect(day.cop2.task!.method).toBe('blockLane');
  });

  it('F18: 교통사고 현장에 연료 누출(또는 불)을 믿는 펌프차 대원은 차량 차단, 모르면 통제. 헬기로 온 부대는 차량 차단을 고르지 않는다', () => {
    const { sim, s, I, of } = laneScene('R3-K2', 'clear');
    const ff = of('engine')[0], ff2 = of('engine')[1];
    for (const b of of('engine')) for (const f of [...b.beliefs.list('haz'), ...b.beliefs.list('fire')]) expect(f.type === 'fire' ? (f.value as number) > 0 : f.value.kind === 'leak' && f.value.active, '처음에는 누출·불을 모른다').toBe(false);
    const w = work(sim, s, 'traffic', { tile: 0 }); giveTask(sim, s, ff, w);
    act(sim, s, ff);
    expect(ff.task!.method).toBe('post');
    ff2.beliefs.merge(mkFact('haz', 90, { kind: 'leak', active: true, x: 5, y: 5, sub: 'fuel' }, '시험', sim.t, 1, true, '차량 연료 누출'));
    docForget();
    const w1 = work(sim, s, 'traffic', { tile: 1 }); giveTask(sim, s, ff2, w1);
    act(sim, s, ff2);
    expect(ff2.task!.method).toBe('blockLane');
    expect((I.docs ?? []).some((d) => d.rule === 'F18' && d.hook === 'method' && d.rid === ff2.rid)).toBe(true);
    // 길로 오지 않은 부대(헬기)는 막을 차가 없다 — 조건(can)이 거른다
    const u = sim.units[ff2.unitId];
    const tg = { cas: -1, prop: -1, hostile: -1, region: -1, tile: 1 };
    const pick = (): MethodId => chooseMethod(sim, s, ff2, 'traffic', tg, null, NO_SENSE, docCtx(sim, s, ff2, 'self', w1))!.m;
    expect(pick()).toBe('blockLane');
    u.air = true;
    expect(pick()).toBe('post');
    u.air = undefined;
    // 그 지점이 통제됐다고 알면 차량 차단은 후보가 아니다
    ff2.beliefs.merge(mkFact('ctl', 1, true, '시험', sim.t, 1, true, '차로 통제 완료'));
    expect(pick()).toBe('post');
  });

  it('통제 지점에 닿는 순간 s.laneShield 에 그 지점, 설치 +3초 — 통제가 끝나면 방법 기록(blockLane). 그 방향 차의 부주의 판정은 p × 0.4, s.rng 의 호출 수는 차단이 없을 때와 같다. 막은 부대가 떠나면 차단이 풀린다', () => {
    const A = laneScene('R3-K3', 'night'), B = laneScene('R3-K3', 'night');
    // A: 경찰이 서측(0) 입구를 차량으로 막는다
    const w = work(A.sim, A.s, 'traffic', { tile: 0 });
    giveTask(A.sim, A.s, A.cop, w);
    act(A.sim, A.s, A.cop);
    expect(A.cop.task!.method).toBe('blockLane');
    expect(A.s.laneShield).toBeNull();
    put(A.cop, A.s.controlPts[0]);
    const from = A.sim.events.length;
    act(A.sim, A.s, A.cop);
    expect(A.s.laneShield).toEqual([0]);
    expect(said(A.sim, from, A.cop.rid, '차로 입구를')).toBe(true);
    expect(A.cop.label).toBe(METHOD.blockLane.label);
    const base = 6 * (kitHas(A.sim, A.cop.rid, 'baton') ? 0.85 : 1);
    expect(A.cop.task!.need).toBeCloseTo(base + BLOCK_LANE.setup, 6);
    expect(laneShieldMul(A.sim, A.s, 0)).toBe(BLOCK_LANE.careless); expect(laneShieldMul(A.sim, A.s, 1)).toBe(1); expect(laneShieldMul(B.sim, B.s, 0)).toBe(1);
    // 두 현장에서 사람을 모두 차로 밖으로 뺀다(충격이 없어야 난수 소비가 새 차뿐이다) — 차만 굴린다
    for (const env of [A, B]) for (const b of env.s.agents) b.status = 'withdrawn';
    const p = 0.3;      // 밤 (맑으면 0.2)
    let cars = 0, saved = 0, side0 = 0;
    for (let k = 0; k < 6000 && saved < 2; k++) {
      for (const env of [A, B]) { env.sim.tick++; env.sim.t = env.sim.tick * env.sim.dt; }
      const due = A.sim.t >= A.s.nextCarAt;
      expect(B.sim.t >= B.s.nextCarAt).toBe(due);
      let v = -1, cp = -1;
      if (due) { const c = cloneRng(A.s.rng); c.range(5.5, 11); const row = c.int(0, A.s.laneRows.length - 1); cp = row === 0 ? 1 : 0; v = c.next(); }
      tickLane(A.sim, A.s, A.I); tickLane(B.sim, B.s, B.I);
      expect(peek(A.s.rng), `호출 수 불변 (틱 ${k})`).toBe(peek(B.s.rng));
      if (!due) continue;
      cars++;
      const carA = A.s.cars[A.s.cars.length - 1], carB = B.s.cars[B.s.cars.length - 1];
      expect(carB.distracted).toBe(v < p);
      expect(carA.distracted).toBe(v < p * (cp === 0 ? BLOCK_LANE.careless : 1));
      if (cp === 0) { side0++; if (carB.distracted && !carA.distracted) saved++; }
    }
    expect(cars).toBeGreaterThan(4); expect(side0).toBeGreaterThan(0);
    expect(saved, '차단이 부주의 차량을 줄인 경우').toBeGreaterThanOrEqual(2);
    // 막은 부대가 현장을 떠나면 차단이 풀린다 (막은 차가 없다)
    A.sim.units[A.cop.unitId].state = 'returning';
    expect(laneShieldMul(A.sim, A.s, 0)).toBe(1);
    expect(A.s.laneShield).toEqual([]);
    // 통제를 끝까지: 다른 현장에서 — 설치 시간이 3초 길고, 끝나면 차량 차단으로 기록된다
    const C = laneScene('R3-K3', 'night');
    const wc = work(C.sim, C.s, 'traffic', { tile: 1 }); giveTask(C.sim, C.s, C.cop, wc);
    put(C.cop, C.s.controlPts[1]);
    stepOne(C.sim, C.s, C.cop, base + BLOCK_LANE.setup - 0.6);
    expect(C.s.controlDone[1]).toBe(false); expect(C.s.laneShield).toEqual([1]);
    stepOne(C.sim, C.s, C.cop, 1.2);
    expect(C.s.controlDone[1]).toBe(true);
    expect(usedMethods(C.I, 'traffic')).toEqual(['blockLane']);
    expect(laneShieldMul(C.sim, C.s, 1)).toBe(1);      // 통제가 끝난 입구로는 차가 들어오지 않는다 — 배율은 1
    // 맑은 날의 평소 통제: 6초(경광봉 ×0.85), 기록은 통제(post), 차단 없음
    const D = laneScene('R3-K3', 'clear');
    const wd = work(D.sim, D.s, 'traffic', { tile: 1 }); giveTask(D.sim, D.s, D.cop, wd);
    put(D.cop, D.s.controlPts[1]);
    stepOne(D.sim, D.s, D.cop, base + 0.6);
    expect(D.s.controlDone[1]).toBe(true); expect(D.s.laneShield).toBeNull();
    expect(usedMethods(D.I, 'traffic')).toEqual(['post']);
  });
});

/** 꺼낸 환자 하나(거동 불가·차·잔해에서 꺼냄 — 안전 구역에서 6~9칸의 바깥 자리, 차로 줄 밖)와 그 이송 작업. 연기·불은 지운다 */
function carryScene(seed: string, what = 'traffic/std', kinds: UnitKind[] = ['als', 'engine']) {
  const env = sceneWith(seed, what, kinds);
  const { sim, s } = env;
  for (const b of s.agents) { b.task = null; b.orderWork = -1; b.isCommander = false; }
  const at = spotAt(s, s.safe.x, s.safe.y, 6, 9, false, (tx, ty) => { const rg = s.region[ty * s.w + tx]; return (rg < 0 || !s.regions[rg].indoor) && s.laneRows.indexOf(ty) < 0; })!;      // 바깥이고 차로 줄이 아닌 자리
  setCas(sim, s, 0, 60, 'scene', at);
  const c = s.casualties[0];
  c.tFreed = sim.t; c.bleed = 0.2; c.bleed0 = 0.2; c.immob = undefined;
  for (let i = 0; i < s.smoke.length; i++) { s.smoke[i] = 0; s.fire[i] = 0; }
  const w = work(sim, s, 'carry', { cas: c.id, max: 2, priority: 0.8 });
  const role = (id: string): FieldAgent => s.agents.find((a) => roleIdOf(sim, a.rid) === id)!;
  docForget();
  return { ...env, c, w, at, role };
}
const nearOf = (s: Scene, c: { x: number; y: number }, dmin = 0.9, dmax = 1.3): { x: number; y: number } => spotAt(s, c.x, c.y, dmin, dmax, false, (_tx, ty) => s.laneRows.indexOf(ty) < 0)!;      // 차로 줄이 아닌 곁 칸

describe('R3 단계 6: 척추 고정 (E13 — 판단 지점 carryStart) — 고정판을 든 대원은 들기 전에 3초 고정한다. 고정하지 않고 옮긴 꺼낸 사람은 옮기는 동안 더 나빠진다', () => {
  it('응급구조사(척추 고정판): 문구 한 번·교본 기록, 3초 동안 들지 않고 → c.immob, 그 뒤 든다. 옮기는 동안 더해지는 악화가 없다', () => {
    const { sim, I, s, c, w, role } = carryScene('R3-E13');
    const emt = role('emt');
    expect(kitHas(sim, emt.rid, 'spineBoard')).toBe(true);
    giveTask(sim, s, emt, w); put(emt, nearOf(s, c));
    const from = sim.events.length;
    stepOne(sim, s, emt, 1);
    expect(emt.task!.method).toBe('pack');
    expect(emt.carrying).toBe(-1); expect(c.immob).toBeFalsy();
    expect(emt.label).toBe('척추 고정');
    expect(said(sim, from, emt.rid, '척추 고정 후 이송합니다')).toBe(true);
    expect((I.docs ?? []).filter((d) => d.rule === 'E13' && d.hook === 'gate' && d.gate === 'carryStart' && d.rid === emt.rid).length).toBe(1);
    stepOne(sim, s, emt, CARRY.immobilize - 1 + 0.2);
    expect(c.immob).toBe(true); expect(emt.carrying).toBe(-1);      // 고정이 끝났고 이제 든다(1.2초)
    stepOne(sim, s, emt, 1.4);
    expect(emt.carrying).toBe(c.id);
    const hp = c.health;
    stepOne(sim, s, emt, 2);
    expect(c.health).toBe(hp);      // 고정했다 — 옮기는 동안의 덧악화 없음 (상처 악화 자체는 세계 규칙 tickCasualties 의 몫이라 이 걸음에는 없다)
    expect(sim.events.slice(from).filter((e) => e.text.includes('척추 고정 후 이송합니다')).length).toBe(1);
  });

  it('고정판이 없는 대원은 바로 든다(1.2초) — 고정하지 않고 옮기는 동안 더 나빠진다. 곁에 온 같은 이송의 동료가 고정판을 들었으면 그 동료가 고정한다', () => {
    const { sim, I, s, c, w, role } = carryScene('R3-E13b');
    const ff = role('firefighter');
    expect(kitHas(sim, ff.rid, 'spineBoard')).toBe(false);
    giveTask(sim, s, ff, w); put(ff, nearOf(s, c));
    stepOne(sim, s, ff, 1.4);
    expect(ff.carrying).toBe(c.id); expect(c.immob).toBeFalsy();
    expect((I.docs ?? []).some((d) => d.rule === 'E13')).toBe(false);
    const hp = c.health;
    stepOne(sim, s, ff, 2);
    expect(c.health).toBeLessThan(hp);
    expect(hp - c.health).toBeCloseTo(c.bleed * 0.12 * 2, 3);
    // 곁의 동료가 고정판을 들었다
    const q = carryScene('R3-E13b');
    const ff2 = q.role('firefighter'), emt = q.role('emt');
    giveTask(q.sim, q.s, ff2, q.w); giveTask(q.sim, q.s, emt, q.w);
    const p = nearOf(q.s, q.c); put(ff2, p); put(emt, p);
    stepOne(q.sim, q.s, ff2, 1.4);
    expect(ff2.carrying).toBe(-1); expect(ff2.label).toBe('척추 고정');
    expect((q.I.docs ?? []).some((d) => d.rule === 'E13' && d.rid === emt.rid)).toBe(true);
    stepOne(q.sim, q.s, ff2, CARRY.immobilize - 1.4 + 1.6);
    expect(q.c.immob).toBe(true); expect(ff2.carrying).toBe(q.c.id);
  });

  it('선 자리의 연기가 짙으면 고정하지 않고 바로 옮긴다(그동안 더 나빠진다 — 고정판을 들고만 있어서는 효과가 없다). 화재 현장·걸을 수 있는 사람에게는 걸리지 않는다', () => {
    const { sim, I, s, c, w, role } = carryScene('R3-E13c');
    const emt = role('emt');
    giveTask(sim, s, emt, w); const p = nearOf(s, c); put(emt, p);
    s.smoke[tileOf(s, p.x, p.y)] = 0.5;
    stepOne(sim, s, emt, 1.4);
    expect(emt.carrying).toBe(c.id); expect(c.immob).toBeFalsy();
    expect((I.docs ?? []).some((d) => d.rule === 'E13')).toBe(false);
    const hp = c.health;
    for (let i = 0; i < s.smoke.length; i++) s.smoke[i] = 0;
    stepOne(sim, s, emt, 1);
    expect(c.health).toBeLessThan(hp);
    // 판단 지점의 답: 교통사고·붕괴 현장의 거동 불가 환자에게만
    const q = carryScene('R3-E13c');
    const e2 = q.role('emt');
    giveTask(q.sim, q.s, e2, q.w);
    expect(docGate(q.sim, q.s, e2, 'carryStart').opt).toBe('immobilize');
    expect(docGate(q.sim, q.s, e2, 'carryStart', { smoke: 0, heat: 0.4 }).opt).toBeNull();
    expect(docGate(q.sim, q.s, q.role('firefighter'), 'carryStart').opt).toBeNull();      // 임무도 고정판도 없다
    (q.s as { kind: string }).kind = 'fire'; docForget();
    expect(docGate(q.sim, q.s, e2, 'carryStart').opt).toBeNull();
    (q.s as { kind: string }).kind = 'collapse'; docForget();
    expect(docGate(q.sim, q.s, e2, 'carryStart').opt).toBe('immobilize');
    q.c.walking = true; q.c.mob = 'mobile'; e2.beliefs.merge(casFact(q.sim, q.s, q.c, '시험')); docForget();
    expect(docGate(q.sim, q.s, e2, 'carryStart').opt).toBeNull();
    // 통제되지 않은 차로 위의 환자는 고정하지 않고 먼저 차로 밖으로 옮긴다 (E12 와 같은 판정 — 차가 들어오는 차로에 3초 더 서 있지 않는다). 그 차로가 통제됐다고 알면 고정한다
    const L = carryScene('R3-E13c');
    const row = L.s.laneRows[0];
    let lx = -1;
    for (let tx = 4; tx < L.s.w - 4 && lx < 0; tx++) { const i = row * L.s.w + tx; if (staticPass(L.s.tiles[i]) && L.s.propAt[i] < 0) lx = tx; }
    expect(lx).toBeGreaterThanOrEqual(0);
    setCas(L.sim, L.s, 0, 60, 'scene', { x: lx, y: row });
    const e3 = L.role('emt');
    giveTask(L.sim, L.s, e3, L.w);
    expect(docGate(L.sim, L.s, e3, 'carryStart').opt).toBeNull();
    for (let k = 0; k < L.s.controlPts.length; k++) e3.beliefs.merge(mkFact('ctl', k, true, '시험', L.sim.t, 1, true, '차로 통제 완료'));
    docForget();
    expect(docGate(L.sim, L.s, e3, 'carryStart').opt).toBe('immobilize');
    // 환자는 차로 밖(버스 안)인데 드는 대원이 통제되지 않은 차로 줄에 서 있어도 고정하지 않는다 — 자기가 선 자리
    const M = carryScene('R3-E13c');
    const e4 = M.role('emt');
    giveTask(M.sim, M.s, e4, M.w);
    expect(M.s.laneRows.indexOf(Math.round(M.c.y))).toBe(-1);
    put(e4, { x: lx, y: M.s.laneRows[0] }); docForget();
    expect(docGate(M.sim, M.s, e4, 'carryStart').opt).toBeNull();
    put(e4, nearOf(M.s, M.c)); docForget();
    expect(M.s.laneRows.indexOf(Math.round(e4.y))).toBe(-1);
    expect(docGate(M.sim, M.s, e4, 'carryStart').opt).toBe('immobilize');
  });
});

describe('R3 단계 6: 끌기 (E14 — 방법 drag) — 들것 없이 혼자, 환자 곁의 연기가 짙으면 낮게 끌어 나간다. 연기 피해 ×0.5 · 속도 ×0.85', () => {
  it('맑은 자리에서 맡으면 업기, 연기 짙은 환자 곁에 닿은 틱에 끌기로 바꾼다(도착 재선택 — 시작 문구·E14 기록). 끝까지 옮기면 끌기로 기록된다', () => {
    const { sim, I, s, c, w, at, role } = carryScene('R3-E14', 'fire/std', ['engine', 'als']);
    const ff = role('firefighter');
    for (const b of s.agents) if (b !== ff) b.status = 'withdrawn';
    docForget();
    for (let y = at.y - 2; y <= at.y + 2; y++) for (let x = at.x - 2; x <= at.x + 2; x++) if (x >= 0 && y >= 0 && x < s.w && y < s.h) s.smoke[y * s.w + x] = 0.6;
    const start = outSpot(s, at.x, at.y, 4, 6);
    expect(s.smoke[tileOf(s, start.x, start.y)]).toBe(0);
    giveTask(sim, s, ff, w); put(ff, start);
    const from = sim.events.length;
    act(sim, s, ff);
    expect(ff.task!.method).toBe('pack');
    for (let k = 0; k < 200 && ff.task !== null && ff.task.method !== 'drag' && ff.carrying < 0; k++) stepOne(sim, s, ff, 0.2);
    expect(ff.task!.method).toBe('drag');
    expect(ff.task!.mwhy).toBe('danger');
    expect(said(sim, from, ff.rid, '낮게 끌어 나가겠습니다')).toBe(true);
    expect((I.docs ?? []).some((d) => d.rule === 'E14' && d.hook === 'method' && d.method === 'drag' && d.work === 'carry')).toBe(true);
    stepOne(sim, s, ff, 1.6);
    expect(ff.carrying).toBe(c.id); expect(dragging(ff)).toBe(true);
    // 속도: 혼자 업기의 ×0.85
    const vDrag = moveSpeed(sim, s, ff);
    ff.task!.method = 'pack';
    expect(vDrag / moveSpeed(sim, s, ff)).toBeCloseTo(CARRY.dragSpeed, 6);
    // 연기 피해: 끌려 나가는 사람 ×0.5 (세계 규칙) · 끄는 대원 ×0.5 (대원의 몸)
    const i = tileOf(s, c.x, c.y); s.smoke[i] = 0.6; s.fire[i] = 0;
    const loss = (m: MethodId): number => { ff.task!.method = m; const h0 = c.health; tickCasualties(sim, s, I); const d = h0 - c.health; c.health = h0; return d; };
    const dPack = loss('pack'), dDrag = loss('drag');
    expect(dragSmoke(s, c.id)).toBe(CARRY.dragSmoke);
    expect(dPack - dDrag).toBeCloseTo(0.6 * 0.36 * (1 - CARRY.dragSmoke) * sim.dt, 6);
    const r = sim.responders[ff.rid];
    for (const it of r.kit!) if (it.id === 'scba') it.uses = 0;      // 빈 통 — 연기를 그대로 마신다
    s.smoke[tileOf(s, ff.x, ff.y)] = 0.6;
    const hurt = (m: MethodId): number => { ff.task!.method = m; const h0 = r.health; agentHealth(sim, s, I, ff); const d = h0 - r.health; r.health = h0; return d; };
    const hPack = hurt('pack'), hDrag = hurt('drag');
    expect(hPack).toBeGreaterThan(0); expect(hDrag).toBeGreaterThan(0);
    expect(hDrag).toBeLessThan(hPack);
    // 끝까지 옮기면 끌기로 기록된다
    ff.task!.method = 'drag'; r.health = 100;
    for (let k = 0; k < 400 && c.where !== 'safe'; k++) stepOne(sim, s, ff, 0.2);
    expect(c.where).toBe('safe');
    expect(usedMethods(I, 'carry')).toEqual(['drag']);
  });

  it('같은 분야 동료가 6칸 안에 있으면(혼자가 아니다) 업기, 들것을 든 대원은 연기 속에서도 업기 — 들것으로 끝까지 옮기면 들것(기록 전용)으로 남는다', () => {
    const q = carryScene('R3-E14b', 'fire/std', ['engine', 'als']);
    const ff = q.role('firefighter'), noz = q.role('nozzle');
    for (const b of q.s.agents) if (b !== ff && b !== noz) b.status = 'withdrawn';
    const tg = { cas: q.c.id, prop: -1, hostile: -1, region: -1, tile: -1 };
    const p = nearOf(q.s, q.c); put(ff, p); put(noz, nearOf(q.s, q.c, 1.5, 3));
    docForget();
    giveTask(q.sim, q.s, ff, q.w);
    const SMOKY = { smoke: 0.6, heat: 0 };
    const pick = (a: FieldAgent): MethodId => { docForget(); return chooseMethod(q.sim, q.s, a, 'carry', tg, null, SMOKY, docCtx(q.sim, q.s, a, 'self', q.w, SMOKY))!.m; };
    expect(pick(ff)).toBe('pack');      // 곁에 관창수가 있다
    noz.status = 'withdrawn';
    expect(pick(ff)).toBe('drag');      // 혼자다
    // 들것을 든 구급 운전원은 끌지 않는다 (E14 의 장비 조건)
    const drv = q.role('emsDriver');
    expect(kitHas(q.sim, drv.rid, 'stretcher')).toBe(true);
    drv.status = 'active'; ff.status = 'withdrawn';
    q.w.assignees.length = 0; ff.task = null;
    giveTask(q.sim, q.s, drv, q.w); put(drv, p);
    expect(pick(drv)).toBe('pack');
    for (let k = 0; k < 400 && q.c.where !== 'safe'; k++) stepOne(q.sim, q.s, drv, 0.2);
    expect(q.c.where).toBe('safe');
    expect(usedMethods(q.I, 'carry')).toEqual(['litter']);
    // 들것 없는 대원이 맑은 곳에서 옮기면 업기
    const z = carryScene('R3-E14b', 'traffic/std', ['engine']);
    const f2 = z.role('firefighter');
    giveTask(z.sim, z.s, f2, z.w); put(f2, nearOf(z.s, z.c));
    for (let k = 0; k < 400 && z.c.where !== 'safe'; k++) stepOne(z.sim, z.s, f2, 0.2);
    expect(z.c.where).toBe('safe');
    expect(usedMethods(z.I, 'carry')).toEqual(['pack']);
  });
});

// ═════════════════════════ 단계 7 (화면) — 엄폐 자세 · 짝 끈 · 판단 지점의 머리 위 라벨 · 협상 중단 표시 (그림만 — 결과 불변) ═════════════════════════
import { buddyLinks, coverCrouch, coverTask, drawBuddyLines, headLabel, headLabelMax, inHazardInterior, laneShieldSpot, talkBrokenCover } from '../src/view/scene/doctrineLayer';
import { fakeCtx, withFakeDom } from './fakeCanvas';

describe('R3 단계 7: 화면 — 교본의 현장 그림은 읽기만 한다 (엄폐 자세 · 짝 끈 · 머리 위 라벨 · 협상 중단 표시)', () => {
  it('그림 층(view/scene/doctrineLayer.ts)은 이름표(registry)·유형 표·타입만 가져온다 — 판단·실행 함수를 부르지 않는다', () => {
    const src = code('../src/view/scene/doctrineLayer.ts');
    for (const l of importLines(src)) expect(/from '(\.\.\/\.\.\/sim\/field\/doctrine\/registry|\.\.\/\.\.\/sim\/field\/methods|\.\.\/\.\.\/sim\/incidentTypes|\.\.\/\.\.\/sim\/types)'/.test(l), l).toBe(true);
    expect(importLines(src).find((l) => l.includes('/sim/field/methods'))).toMatch(/^import \{ LANE_SHIELD_BY \} from/);      // 방법 표의 파일에서는 '입구를 막은 부대' 표만 읽는다
    for (const bad of ['doctrineRun', 'docFit', 'docAct', 'docDuty', 'docGate', 'docCtx', 'recordDoc', 'docBegin', 'kitWorks', 'useKit', 'toolUse', '.rng', 'emit(']) expect(src.includes(bad), bad).toBe(false);
  });

  it('짝 끈: 서로 짝이고 둘 다 활동 중이며 둘 다 위험 건물 실내에 있을 때만 잇는다 (한 쌍 한 번). 무장 현장의 실내는 위험 건물이 아니다', () => {
    const { sim, s, noz, ff, rg, ex } = fireScene('R3-V1', ['engine']);
    expect(noz.buddy).toBe(ff.rid); expect(ff.buddy).toBe(noz.rid);
    const out = outSpot(s, ex.x, ex.y, 3, 6), inn = inSpot(s, rg);
    put(noz, out); put(ff, out);
    expect(inHazardInterior(s, noz)).toBe(false);
    expect(buddyLinks(s)).toEqual([]);
    put(noz, inn);
    expect(inHazardInterior(s, noz)).toBe(true);
    expect(buddyLinks(s)).toEqual([]);      // 한 사람만 안에 있다
    const inn2 = s.regions[rg].tiles.map((t) => ({ x: t % s.w, y: (t / s.w) | 0 })).find((p) => staticPass(s.tiles[p.y * s.w + p.x]) && Math.hypot(p.x - inn.x, p.y - inn.y) >= 2) ?? inn;
    put(ff, inn2);
    const links = buddyLinks(s);
    expect(links.length).toBe(1);
    expect(links[0].map((a) => a.rid).sort()).toEqual([noz.rid, ff.rid].sort());
    ff.status = 'down';
    expect(buddyLinks(s)).toEqual([]);      // 쓰러진 짝과는 잇지 않는다
    ff.status = 'active'; ff.buddy = -1;
    expect(buddyLinks(s)).toEqual([]);      // 서로 짝이 아니다
    ff.buddy = noz.rid;
    // 그려도 상태가 그대로다
    const before = JSON.stringify([noz.x, noz.y, ff.x, ff.y, noz.buddy, ff.buddy, sim.events.length, peek(s.rng)]);
    drawBuddyLines(fakeCtx(), s, 24, 0.5);
    expect(JSON.stringify([noz.x, noz.y, ff.x, ff.y, noz.buddy, ff.buddy, sim.events.length, peek(s.rng)])).toBe(before);
    // 무장 현장(위험 건물이 아니다)의 실내에 선 경찰 짝은 잇지 않는다
    const A = sceneWith('R3-V1', 'armed/hostage', ['patrol']);
    const [c1, c2] = A.of('patrol');
    const ri = A.s.regions.findIndex((r) => r.indoor);
    put(c1, inSpot(A.s, ri)); put(c2, inSpot(A.s, ri));
    c1.buddy = c2.rid; c2.buddy = c1.rid;
    expect(inHazardInterior(A.s, c1)).toBe(false);
    expect(buddyLinks(A.s)).toEqual([]);
  });

  it('엄폐 자세: 교본의 엄폐 임무로 멈춰 선 대원만 몸을 낮춘다. 머리 위 라벨: 판단 지점에서 기다리면 막고 있는 줄의 짧은 이름, 아니면 실행기의 라벨. 협상 중단 표시는 P16 의 엄폐에만', () => {
    const { sim, s, A, B, h } = copsScene('R3-V2', 'armed/hostage', ['patrol'], 'gun', 'fight');
    A.task = makeTask('cover', '엄폐'); A.task.docRule = 'P16'; A.task.hostile = h.id; A.label = '엄폐';
    expect(coverTask(A)).toBe(true);
    expect(coverCrouch(A, false)).toBe(true); expect(coverCrouch(A, true)).toBe(false);      // 숨을 자리로 가는 동안은 선 채
    expect(talkBrokenCover(A)).toBe(true);
    expect(headLabel(A)).toBe('엄폐'); expect(headLabelMax(A)).toBe(13);
    A.task.docRule = 'P09';
    expect(talkBrokenCover(A)).toBe(false);      // 탄약이 떨어져 숨은 대원은 협상자가 아니다
    A.status = 'down';
    expect(coverCrouch(A, false)).toBe(false);
    A.status = 'active';
    // 판단 지점에서 기다리는 대원: 실행기의 라벨이 무엇이든 막고 있는 줄의 짧은 이름
    const w = work(sim, s, 'engage', { hostile: h.id });
    B.task = makeTask('engage', '교전', w); B.label = '진입 대기';
    expect(headLabel(B)).toBe('진입 대기');
    B.task.gateAt = sim.t; B.task.gateId = 'breach'; B.task.docRule = 'P07';
    expect(headLabel(B)).toBe(DOCTRINE.find((r) => r.id === 'P07')!.short);
    expect(headLabelMax(B)).toBe(16);
    for (const r of DOCTRINE) if (r.hook === 'gate') expect(r.short.length, `${r.id} 의 짧은 이름이 라벨에 잘리지 않는다`).toBeLessThanOrEqual(16);
    B.task.docRule = 'X99';      // 모르는 줄이면 실행기의 라벨 그대로
    expect(headLabel(B)).toBe('진입 대기');
    B.task.gateAt = -1; B.task.docRule = 'P07';
    expect(headLabel(B)).toBe('진입 대기');      // 막혀 있지 않다
  });

  it('현장 그림(drawScene)이 교본 임무·판단 지점·짝 끈·분류·차량 차단이 있는 장면을 예외 없이 그리고, 그리는 것만으로 기록·난수·임무가 바뀌지 않는다', async () => {
    await withFakeDom(async () => {
      const { drawScene } = await import('../src/view/renderScene');
      const ctx = fakeCtx();
      // 인질극: 협상자가 엄폐(P16) · 진입 대기(P07) · 탄약 보급
      const C = copsScene('R3-V3', 'armed/hostage', ['patrol', 'tactical'], 'gun', 'fight');
      const [a0, a1, a2] = C.cops;
      a0.task = makeTask('cover', '엄폐'); a0.task.docRule = 'P16'; a0.task.hostile = C.h.id; a0.label = '엄폐';
      a1.task = makeTask('engage', '교전', work(C.sim, C.s, 'engage', { hostile: C.h.id })); a1.task.gateAt = C.sim.t; a1.task.gateId = 'breach'; a1.task.docRule = 'P07'; a1.label = '진입 대기';
      if (a2) { a2.task = makeTask('rearm', '탄약 보급'); a2.label = '탄약 보급'; }
      // 화재: 실내의 짝(짝 동행) · 공기 탈출
      const F = fireScene('R3-V3', ['engine']);
      const inn = inSpot(F.s, F.rg);
      put(F.noz, inn); put(F.ff, { x: inn.x + 2, y: inn.y });
      F.ff.task = makeTask('pair', '짝 동행'); F.ff.label = '짝 동행';
      F.lead.task = makeTask('airOut', '공기 탈출'); F.lead.label = '공기 탈출';
      // 교통사고: 분류 · 차량 차단
      const T = laneScene('R3-V3', 'night');
      const medic = T.of('als')[0];
      medic.task = makeTask('triage', '분류'); medic.label = '분류'; medic.ring = 0.5;
      const lw = work(T.sim, T.s, 'traffic', { tile: 0 }); giveTask(T.sim, T.s, T.cop, lw); put(T.cop, T.s.controlPts[0]); act(T.sim, T.s, T.cop);
      expect(T.s.laneShield).toEqual([0]);
      // 차로 입구를 막고 선 차는 그 입구에 그린다: 서쪽 입구(통제 지점 0)는 둘째 차로 줄의 왼쪽 끝. 막지 않은 부대는 null
      const spot = laneShieldSpot(T.s, T.cop.unitId)!;
      expect(spot.x).toBeLessThan(3); expect(Math.abs(spot.y - T.s.laneRows[1])).toBe(0.5);
      expect(laneShieldSpot(T.s, medic.unitId)).toBeNull();
      for (const env of [C, F, T]) {
        const sig = (): string => JSON.stringify([env.sim.events.length, env.sim.logHash, peek(env.s.rng), env.s.agents.map((a) => [a.x, a.y, a.label, a.task ? a.task.kind : null, a.task ? a.task.gateAt : null, peek(a.rng)])]);
        const before = sig();
        for (const o of [{ truth: true }, { truth: false }, { truth: true, mini: true }, { truth: true, cam: { x: 15, y: 10, zoom: 2 } }]) drawScene(ctx, env.sim, env.s, 1200, 800, { alpha: 0.5, timeMs: 1000, selectedRid: env.s.agents[0].rid, ...o });
        expect(sig()).toBe(before);
      }
    });
  });
});

// ═════════════════════════ 독립 검토 — 짝을 기다리다 일을 넘기는 고리 (§5.2 의 경고: 판단부의 "쓸 수 있는 짝"과 짝이 실제로 따라오는 조건이 어긋나면 기다림 → 놓음 → 재배정이 되풀이된다) ═════════════════════════
import { pairAlt } from '../src/sim/field/doctrine';
describe('R3 독립 검토: 앞장설 대원이 일을 받았으면 짝은 실제로 따라온다 (F04 의 buddyOf ↔ G08 · 짝 동행의 끝)', () => {
  it('중상(band 1)을 신고한 짝: 앞장설 대원이 위험 실내 일을 받으면(buddyOf ≠ null — 신고 band < 2) 그 짝의 짝 동행(G08)이 걸린다. 걸을 수 있는 다친 대원(injured)은 양쪽 모두 아니다', () => {
    const { sim, s, noz, ff, lead, op, rg, ex } = fireScene('R3-RV1');
    const w = work(sim, s, 'search', { region: rg });
    put(noz, ex); put(ff, outSpot(s, ex.x, ex.y, 0.8, 2));
    for (const a of [lead, op]) put(a, outSpot(s, ex.x, ex.y, 1.5, 4));
    nobodyInside(sim, s);
    sim.responders[ff.rid].health = 60;      // 물러나지 않은 중상 (체력 41~70)
    selfReport(sim, s, ff); docForget();
    expect(reported(ff)?.band).toBe(1);
    expect(buddyOf(sim, s, noz, w)).toBe(ff);
    expect(fitFor(sim, s, noz, w)).toBeGreaterThan(0);
    giveTask(sim, s, noz, w); docForget();
    // 고치기 전: 여기서 null — 앞장선 대원은 문턱에서 20초를 기다리다 일을 넘기고, 다음 일에서 또 기다렸다 (보통 S3 #10 에서 한 대원이 11번)
    expect(docAct(sim, s, ff)).toMatchObject({ act: 'pair' });
    // 걸을 수 있는 다친 대원(가벼운 일만 — 명부 injured): 따라가지 않고, 앞장설 대원도 그 짝을 세지 않는다 (양쪽이 같다)
    sim.responders[ff.rid].status = 'injured'; docForget();
    expect(docAct(sim, s, ff)).toBeNull();
    noz.task = null; w.assignees = []; docForget();
    expect(buddyOf(sim, s, noz, w)).toBeNull();
    expect(fitFor(sim, s, noz, w)).toBe(0);
  });
  it('곁의 빈 일은 내가 지금 맡을 수 있을 때만(적합도 > 0) 동행을 끝낸다 — 맡지 못하는 일을 보고 끝내면 맡지도 따라가지도 못한 채 서고, 문턱의 짝은 20초 뒤 일을 넘겼다', () => {
    const { sim, s, noz, ff, lead, op, rg, ex } = fireScene('R3-RV2');
    const w = work(sim, s, 'search', { region: rg });
    const near = work(sim, s, 'search', { region: rg });      // 같은 구역의 빈 위험 실내 일 (곁의 일 — pairAlt)
    put(noz, ex); put(ff, outSpot(s, ex.x, ex.y, 4.5, 8));
    for (const a of [lead, op]) put(a, outSpot(s, ex.x, ex.y, 1.5, 4));
    nobodyInside(sim, s);
    giveTask(sim, s, noz, w);
    noz.task!.gateId = 'interiorEntry'; noz.task!.gateAt = sim.t; noz.task!.docRule = 'F04c';      // 문턱에서 짝을 기다린다 (동료의 겉)
    // 지친 대원은 위험 실내 새 일을 맡지 않는다(G03 — 적합도 0). 따라가는 것은 된다
    sim.responders[ff.rid].stamina = DOC.STAMINA_NEW - 10;
    docForget();
    expect(pairAlt(sim, s, ff, w)).toBe(true);      // 판단부의 눈에는 곁에 빈 일이 있다 (관창·종류·자리만 본다)
    expect(fitFor(sim, s, ff, near)).toBe(0);      // 그러나 지금은 맡을 수 없다
    expect(docAct(sim, s, ff)).toMatchObject({ act: 'pair' });      // 판단부: 짝이 기다리면 곁의 일이 있어도 따라간다 (pairOf 의 waiting)
    const pt = makeTask('pair', '짝 동행'); pt.docRule = 'G08'; ff.task = pt;
    stepOne(sim, s, ff, 2.4);      // (tick + rid) % 5 가 두 번 이상 돈다
    // 고치기 전: 실행부가 곁의 일을 보고 바로 끝냈다 (그 뒤 10초는 G08 이 걸리지 않아 대기로 서고, 짝은 일을 넘겼다)
    expect(ff.task?.kind).toBe('pair');
    expect((ff.docMem ?? []).some((m) => m.rule === 'G08' && m.until > sim.t)).toBe(false);
    // 맡을 수 있게 되면(지구력 회복) 지금처럼 곁의 일을 맡으러 동행을 끝낸다 — 그 뒤 10초는 다시 걸지 않는다
    sim.responders[ff.rid].stamina = 90; docForget();
    expect(fitFor(sim, s, ff, near)).toBeGreaterThan(0);
    stepOne(sim, s, ff, 1.2);
    expect(ff.task).toBeNull();
    expect((ff.docMem ?? []).some((m) => m.rule === 'G08' && m.key === '*' && m.until > sim.t)).toBe(true);
    expect(near.assignees).toEqual([]);
  });
  it('곁의 빈 일이 판단 지점 상한으로 놓아 지금은 맡지 않는 일(교본 기억 w:)이면 "내가 맡을 일"이 아니다 (pairAlt)', () => {
    const { sim, s, noz, ff, rg } = fireScene('R3-RV3');
    const w = work(sim, s, 'search', { region: rg });
    const near = work(sim, s, 'search', { region: rg });
    giveTask(sim, s, noz, w); docForget();
    expect(pairAlt(sim, s, ff, w)).toBe(true);
    docRemember(sim, ff, 'F04c', 'w:' + near.id, 30); docForget();
    expect(fitFor(sim, s, ff, near)).toBe(0);
    expect(pairAlt(sim, s, ff, w)).toBe(false);
  });
});

// ═════════════════════════ 독립 검토 — 시험 9 의 빠져 있던 두 갈래 (§10-9: X6 의 철수 명령이 공기 탈출보다 먼저 · R2 의 물 위 대원에게 교본의 의무가 걸리지 않는다) ═════════════════════════
describe('R3 시험 9 (독립 검토): 의무의 순서 — X6 의 철수 명령 > 공기 탈출, 물 위의 대원에게는 교본의 의무가 걸리지 않는다', () => {
  it('공기 30% 미만인 실내 대원: 철수 명령(자기 구역이 단계 3)을 받으면 공기 탈출이 아니라 철수(evacuate), 철수 중에는 공기 탈출로 바꾸지 않는다', () => {
    const { sim, s, noz, rg } = fireScene('R3-F9B', ['engine']);
    put(noz, inSpot(s, rg));
    tankOf(sim, noz).uses = 0.2 * sim.tune.airFull; docForget();
    expect(docDuty(sim, s, noz)).toMatchObject({ act: 'airOut' });      // 교본만 보면 공기 탈출이다
    noz.beliefs.merge(mkFact('ops', 0, { mode: 'interior', zones: [{ key: 'z', kind: 'struct', level: 3, regions: [rg], x: -1, y: -1, r: 0 }], t: sim.t }, '시험', sim.t + 0.01, 1, true, '구역'));
    docForget();
    think(sim, s, noz);
    expect(noz.task?.kind).toBe('evacuate');
    sim.tick += 10; sim.t = sim.tick * sim.dt; docForget();
    think(sim, s, noz);
    expect(noz.task?.kind).toBe('evacuate');
    expect(noz.doc ?? null).toBeNull();
  });
  it('물 위의 대원(보트 위)은 공기 30% 미만이어도 공기 탈출을 고르지 않는다 — 뭍으로(R2 의 물 위 가드가 먼저)', () => {
    const { sim, s, noz, rg } = fireScene('R3-F9C', ['engine']);
    put(noz, inSpot(s, rg));
    tankOf(sim, noz).uses = 0.2 * sim.tune.airFull; docForget();
    expect(docDuty(sim, s, noz)).toMatchObject({ act: 'airOut' });
    noz.afloat = 'boat';
    think(sim, s, noz);
    expect(noz.task?.kind).toBe('ashore');
    expect(noz.doc ?? null).toBeNull();
  });
});

// ═════════════════════════ 독립 검토 — 나아지지 않는 재수색 (잠긴 방의 정밀 수색을 지휘관이 5초마다 같은 대원에게 다시 내던 고리 — 짝이 기다림 없이 따라오게 되자 드러났다) ═════════════════════════
describe('R3 독립 검토: 나아지지 않는 재수색은 마친 것이 아니라 닿지 못한 것이다', () => {
  it('닿지 못한 경유점이 있고 확인율이 이미 알던 값 그대로면 실패(진입 경로 없음)로 끝난다 — 보류와 실패 기억이 남는다. 처음 수색·닿지 못한 곳이 없는 수색·확인율이 는 수색은 지금처럼 마친다', () => {
    const { sim, s, noz, rg } = fireScene('R3-RV4', ['engine']);
    const reg = s.regions[rg];
    const lines = (): string[] => sim.events.filter((e) => e.rid === noz.rid).map((e) => e.text);
    /** 경유점을 모두 지난 수색 임무 (본 칸 n 개 · 닿지 못한 경유점 fails 개)를 한 틱 돌린다 */
    const finish = (n: number, fails: number): WorkItem => {
      sim.tick++; sim.t = sim.tick * sim.dt;
      const w = work(sim, s, 'search', { region: rg, thorough: true });
      giveTask(sim, s, noz, w);
      const t = noz.task!;
      t.pts = []; t.ptI = 0; t.covered = new Set(reg.tiles.slice(0, n)); t.fails = fails; t.mt0 = sim.t;      // mt0: 방법은 고르지 않는다 (지금 코드의 수색)
      act(sim, s, noz);
      return w;
    };
    expect(noz.beliefs.val<number>('srch', rg)).toBeUndefined();
    // ① 처음 수색: 닿지 못한 곳이 있어도 본 만큼 보고하고 마친다
    const w1 = finish(1, 3);
    expect(w1.status).toBe('done');
    const c1 = noz.beliefs.val<number>('srch', rg)!;
    expect(c1).toBeGreaterThanOrEqual(0); expect(c1).toBeLessThan(0.72);
    expect(lines().some((x) => x.includes('수색을 마쳤지만'))).toBe(true);
    // ② 다시 수색했는데 닿지 못한 곳이 그대로이고 확인율도 그대로: 실패 (고치기 전에는 '수색을 마쳤지만 …'으로 마쳐 지휘관이 곧바로 같은 지시를 다시 냈다)
    const n0 = lines().filter((x) => x.includes('수색을 마쳤지만')).length;
    const w2 = finish(1, 3);
    expect(w2.status).toBe('open'); expect(w2.fails).toBe(1);
    expect(w2.failedAt[noz.rid]).toBe(sim.t); expect(w2.holdUntil).toBeGreaterThan(sim.t);
    expect(noz.task).toBeNull();
    expect(lines().filter((x) => x.includes('수색을 마쳤지만')).length).toBe(n0);
    expect(lines().some((x) => x.includes('수색 중단 — 진입 경로를 찾지 못했습니다'))).toBe(true);
    expect(noz.beliefs.val<number>('srch', rg)).toBe(c1);
    // ③ 닿지 못한 곳이 없는 수색(시야만 나빴다)은 같은 확인율이어도 마친다
    expect(finish(1, 0).status).toBe('done');
    // ④ 확인율이 늘었으면 닿지 못한 곳이 있어도 마친다
    const w4 = finish(Math.min(reg.tiles.length, 6), 2);
    expect(w4.status).toBe('done');
    expect(noz.beliefs.val<number>('srch', rg)!).toBeGreaterThan(c1);
  });
});

// ═════════════════════════ 독립 검토 — 밖 대기조: 대기 지점 곁 = 손 빈 대원이 실제로 서는 범위 (실행기의 대기 임무는 5칸 안이면 그 자리에 선다) ═════════════════════════
describe('R3 독립 검토: 대기 지점 둘레 5칸 안에 선 손 빈 공기호흡기 대원은 밖 대기조다 (대기 임무가 세우는 자리와 같은 범위)', () => {
  it('대기 임무는 대기 지점에서 5칸 안이면 걷지 않는다 — 그 자리(4.8칸)의 대원도 대기조로 센다. 5칸을 넘으면 세지 않는다(그 대원은 3칸 안으로 걸어온다)', () => {
    const { sim, s, noz, ff, lead, op } = fireScene('R3-WSTAGE2', ['engine']);
    for (const b of s.agents) { b.task = null; b.orderWork = -1; }
    const st = s.staging;
    const far = { x: st.x + 40, y: st.y };      // 대기 지점에서 먼 가상의 출입구 (WATCH_R 밖)
    put(noz, far); put(ff, far); lead.status = 'withdrawn';
    expect(DOC.WATCH_STAGE).toBe(5);
    // 대기 지점에서 4.8칸: 대기 임무는 그 자리에 세워 둔다 (고치기 전에는 이 대원이 세어지지 않았다 — 문턱 4)
    put(op, { x: st.x + 4.8, y: st.y });
    op.task = makeTask('standby', '대기');
    const x0 = op.x;
    stepOne(sim, s, op, 1);
    expect(op.x).toBe(x0); expect(op.task?.kind).toBe('standby');
    expect(outsideWatch(sim, s, noz, far), '대기 지점 4.8칸의 손 빈 기관원').toBe(1);
    put(op, { x: st.x + 5.6, y: st.y });
    expect(outsideWatch(sim, s, noz, far), '대기 지점 5.6칸').toBe(0);
  });
});

// ═════════════════════════ 독립 검토 — 척추 고정(E13): 곁의 동료의 고정과 통제 전의 차로 (구현 메모 '단계 6' 의 "알려진 문제" 둘째 줄 — 세 모양 가운데 이것으로 정했다) ═════════════════════════
describe('R3 독립 검토: 드는 대원 자신이 통제 전의 차로 줄에 서 있으면 곁의 동료의 척추 고정을 기다리지 않는다', () => {
  /** 환자는 차로 줄 바로 옆(차로 밖), 드는 대원(고정판 없음)은 차로 줄 위, 고정판을 든 동료는 차로 밖 곁 칸 */
  function laneSide(seed: string) {
    const q = carryScene(seed);
    const { sim, s } = q;
    const ok = (tx: number, ty: number): boolean => tx >= 0 && ty >= 0 && tx < s.w && ty < s.h && staticPass(s.tiles[ty * s.w + tx]) && s.propAt[ty * s.w + tx] < 0;
    let spot: { x: number; y: number; oy: number } | null = null;
    for (const y of s.laneRows) for (const oy of [y - 1, y + 1]) {
      if (spot !== null || s.laneRows.indexOf(oy) >= 0) continue;
      for (let x = 3; x < s.w - 3 && spot === null; x++) if (ok(x, y) && ok(x, oy) && ok(x + 1, oy)) spot = { x, y, oy };
    }
    expect(spot).not.toBeNull();
    setCas(sim, s, 0, 60, 'scene', { x: spot!.x, y: spot!.oy });
    const ff = q.role('firefighter'), emt = q.role('emt');
    expect(kitHas(sim, ff.rid, 'spineBoard')).toBe(false); expect(kitHas(sim, emt.rid, 'spineBoard')).toBe(true);
    giveTask(sim, s, ff, q.w); giveTask(sim, s, emt, q.w);
    put(ff, { x: spot!.x, y: spot!.y }); put(emt, { x: spot!.x + 1, y: spot!.oy });
    docForget();
    return { ...q, ff, emt };
  }
  it('통제 전: 차로 줄에 선 대원은 바로 든다(1.2초) — 동료의 고정 기록이 없다. 그 차로의 통제가 끝났다고 알면 곁의 동료가 고정한다(3초)', () => {
    const a = laneSide('R3-E13m');
    stepOne(a.sim, a.s, a.ff, 1.4);
    // 고치기 전: 차로 밖의 동료가 고정하는 3초를 차가 들어오는 차로 줄에 선 채 기다렸다
    expect(a.ff.carrying).toBe(a.c.id); expect(a.c.immob).toBeFalsy();
    expect((a.I.docs ?? []).some((d) => d.rule === 'E13')).toBe(false);
    const b = laneSide('R3-E13m');
    for (const cp of [0, 1]) b.ff.beliefs.merge(mkFact('ctl', cp, true, '시험', b.sim.t + 0.01, 1, true, '시험'));
    docForget();
    stepOne(b.sim, b.s, b.ff, 1.4);
    expect(b.ff.carrying).toBe(-1); expect(b.ff.label).toBe('척추 고정');
    expect((b.I.docs ?? []).some((d) => d.rule === 'E13' && d.rid === b.emt.rid)).toBe(true);
  });
});
