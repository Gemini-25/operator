// N9 사건 종류 다양화 ② 큰 사건·새 장소 — docs/specs/N9-major-kinds.md §9.1 (번호는 설계서 §8 의 단계 표와 같다).
// 시간 예산 90초: 평소 교대 몇 번에 나온다에 기대지 않고, 교대를 끝까지 돌리는 시험은 두지 않는다(새 사건은 createIncident 로 직접 일으킨다).
// 결과 해시를 숫자로 박아 두는 시험(설계서 시험 1 의 HASH0)은 두지 않는다 — 결과를 바꾸는 묶음(X6)이 같은 주 브랜치에 나란히 합쳐지므로 그 관문이 깨진다
// (N8 의 시험 2 를 주 세션이 같은 까닭으로 뺐다). 틀 단계(1·2·3)의 결과 불변은 해시 목록(scratchpad wf-kinds2/)으로 증명하고 설계서 끝 "구현 메모"에 적는다.
import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROBLEM_SYS } from '../scripts/metrics';
import { INCIDENT_PLACES, KIND_DISTRICT, KIND_NAME, KIND_SCENE } from '../src/sim/cityPlan';
import { PROBLEM_LABEL, evaluate } from '../src/sim/debrief';
import { Sim } from '../src/sim/engine';
import { TYPE_DEFS, TYPE_ORDER, floorOf } from '../src/sim/incidentTypes';
import { createIncident } from '../src/sim/incidents';
import { SCENARIOS } from '../src/sim/scenarios';
import { KINDS2 } from '../src/sim/scenarios/kinds2';
import { fitFor, makeAgent, workLabel } from '../src/sim/field/agents';
import { mkFact } from '../src/sim/field/beliefs';
import { commanderThink } from '../src/sim/field/commander';
import { act, makeTask } from '../src/sim/field/executor';
import { FACT_ID } from '../src/sim/field/kinds2Ids';
import { addHostile } from '../src/sim/field/kit';
import { METHOD, NOT_YET, SAY, WORK_MODE, methodsOf } from '../src/sim/field/methods';
import { HOS_HOLDS, registerHosHold } from '../src/sim/field/sceneRegistry';
import type { HosHold } from '../src/sim/field/sceneRegistry';
import type { FieldAgent, HosBelief, Incident, IncidentType, MethodId, PlaceKind, Scene, WorkItem, WorkKind } from '../src/sim/types';

const workOf = (sim: Sim, kind: WorkKind, tg: Partial<WorkItem> = {}): WorkItem => ({
  id: 0, kind, region: -1, cas: -1, prop: -1, hostile: -1, tile: -1, mate: -1, priority: 0.8, status: 'open', assignees: [], max: 1,
  createdAt: sim.t - 60, doneAt: -1, note: '', fails: 0, holdUntil: 0, thorough: false, orderSentAt: {}, cause: -1, failedAt: {}, animal: -1, ...tg,
});
/** 그 유형의 사건 하나를 직접 일으킨 교대 (평소 추첨에 기대지 않는다) */
function sceneOf(seed: string, type: IncidentType): { sim: Sim; I: Incident; s: Scene } {
  const sim = new Sim(seed);
  sim.run(3);
  const I = createIncident(sim, { type, rng: sim.rng.fork('n9-1:' + seed) });
  return { sim, I, s: sim.scenes[I.id]! };
}
/** 경찰 대원 n 명을 현장 대기 지점에 세운다 (첫 사람이 지휘관). 믿음은 비어 있다 */
function copsOn(sim: Sim, s: Scene, n: number): FieldAgent[] {
  const out: FieldAgent[] = [];
  for (const u of sim.units) {
    if (u.dept !== 'police' || u.kind !== 'patrol') continue;
    for (const rid of u.crew) {
      if (out.length >= n) break;
      const a = makeAgent(sim, rid, u.id, s.staging.x, s.staging.y, sim.t, sim.rng.fork('n9-1-cop:' + rid));
      s.agents.push(a); out.push(a);
    }
    if (out.length >= n) break;
  }
  s.commanderRid = out[0].rid;
  return out;
}
const hosVal = (x: number, y: number, state: HosBelief['state'], weapon: HosBelief['weapon'] = 'none'): HosBelief =>
  ({ x, y, weapon, state, hostage: false, facing: 0, dead: false, band: 0, tq: 0, where: 'scene' });

// ───────────────────────── 단계 1 (틀 A — 자료형과 등록 자리) ─────────────────────────
describe('1 틀 A — 자료형과 등록 자리 (결과 불변 — 해시는 구현 메모의 해시 목록)', () => {
  it('등록 자리 HOS_HOLDS 는 아직 비어 있다 (단계 1 — 첫 줄은 단계 4 의 시위)', () => {
    new Sim('N9-1-REG');      // 현장 등록(field/scenes/index.ts)을 불러 둔다
    expect(HOS_HOLDS.length).toBe(0);
  });

  it('용의자 보류(registerHosHold): 참이면 syncBoard 가 그 용의자에게 봉쇄·협상·검거를 내지 않는다 — 위협 셈에는 든다. 줄을 지우면 예전 그대로', () => {
    // 보류 없음: 무기 없는 대치 중 용의자 → 협상 · 출입구 봉쇄, 투항한 용의자 → 검거
    const A = sceneOf('N9-1-HOS-A', 'armed');
    const [cmdA] = copsOn(A.sim, A.s, 2);
    cmdA.beliefs.merge(mkFact('hos', 0, hosVal(12, 8, 'hold'), '시험', A.sim.t, 1, true, ''));
    cmdA.beliefs.merge(mkFact('hos', 1, hosVal(14, 8, 'surrendered'), '시험', A.sim.t, 1, true, ''));
    A.s.secureAt = 5;
    commanderThink(A.sim, A.s, cmdA);
    const kindsFor = (s: Scene, h: number): string[] => s.board.filter((w) => w.hostile === h && w.status !== 'cancelled').map((w) => w.kind).sort();
    expect(kindsFor(A.s, 0)).toContain('negotiate');
    expect(kindsFor(A.s, 1)).toContain('arrest');
    expect(A.s.board.some((w) => w.kind === 'perimeter' && w.status !== 'cancelled'), '출입구 봉쇄').toBe(true);
    expect(A.s.secureAt, '위협이 있으면 안전 확보가 풀린다').toBe(-1);

    // 보류 있음(두 용의자 모두): 핵심 규칙이 그 둘에게 아무 일도 내지 않는다. 위협 셈에는 들어 안전 확보는 그대로 풀린다
    const B = sceneOf('N9-1-HOS-B', 'armed');
    const [cmdB] = copsOn(B.sim, B.s, 2);
    cmdB.beliefs.merge(mkFact('hos', 0, hosVal(12, 8, 'hold'), '시험', B.sim.t, 1, true, ''));
    cmdB.beliefs.merge(mkFact('hos', 1, hosVal(14, 8, 'surrendered'), '시험', B.sim.t, 1, true, ''));
    B.s.secureAt = 5;
    const seen: { id: number; state: string }[] = [];
    const hold: HosHold = (_sim, sc, _a, id, h) => { if (sc.id !== B.s.id) return false; seen.push({ id, state: h.state }); return true; };
    registerHosHold(hold);
    try {
      commanderThink(B.sim, B.s, cmdB);
    } finally {
      HOS_HOLDS.splice(HOS_HOLDS.indexOf(hold), 1);
    }
    expect(HOS_HOLDS.length).toBe(0);
    expect(kindsFor(B.s, 0)).toEqual([]);
    expect(kindsFor(B.s, 1)).toEqual([]);
    expect(B.s.board.some((w) => w.kind === 'perimeter'), '보류된 용의자에게는 출구 봉쇄도 내지 않는다').toBe(false);
    expect(B.s.secureAt, '보류해도 위협 셈에는 든다').toBe(-1);
    expect(seen.map((q) => q.id).sort(), '두 고리(투항·활동) 모두에서 묻는다').toEqual([0, 1]);
    expect(seen.find((q) => q.id === 1)!.state).toBe('surrendered');

    // 줄을 지운 뒤 같은 현장의 다음 계획은 예전 그대로 일을 낸다
    commanderThink(B.sim, B.s, cmdB);
    expect(kindsFor(B.s, 0)).toContain('negotiate');
    expect(kindsFor(B.s, 1)).toContain('arrest');
  });

  it('해산한 용의자(dispersed)는 판정의 용의자 셈·위험 판정에서 빠진다 — 없으면 예전 그대로 (debrief.evaluate 의 두 줄)', () => {
    const { sim, I, s } = sceneOf('N9-1-DISP', 'medical');
    for (const c of s.casualties) { c.tDiscovered = sim.t; c.where = 'safe'; c.health = 90; }
    I.reportedAt = sim.t; I.firstDispatchAt = sim.t; I.firstArrivalAt = sim.t;
    expect(evaluate(sim, I, 'resolved').grade).toBe('success');
    const h = addHostile(s, 10, 10, 'none', 0.5, 0.4, false, Infinity);      // 대치 중(hold)인 맨손 용의자 — 위험이 남고 달아난 것으로 센다
    const before = evaluate(sim, I, 'resolved');
    expect([before.suspectsTotal, before.suspectsCaught, before.suspectsEscaped]).toEqual([1, 0, 1]);
    expect(before.grade).toBe('partial');
    h.dispersed = true;
    const after = evaluate(sim, I, 'resolved');
    expect([after.suspectsTotal, after.suspectsCaught, after.suspectsEscaped]).toEqual([0, 0, 0]);
    expect(after.grade).toBe('success');
    // 해산하지 않은 다른 용의자는 그대로 센다 (검거된 사람)
    const g = addHostile(s, 12, 10, 'none', 0.5, 0.4, false, Infinity); g.state = 'arrested';
    const both = evaluate(sim, I, 'resolved');
    expect([both.suspectsTotal, both.suspectsCaught, both.suspectsEscaped]).toEqual([1, 1, 0]);
  });

  it('체력 하한 floorOf = max(유형의 값, 장면의 값) — 지금 유형은 모두 0, 장면 값(s.kinds2.floorHp)이 있으면 그것', () => {
    for (const t of TYPE_ORDER) expect(floorOf({ kind: t, kinds2: undefined }), t).toBe(TYPE_DEFS[t].floorHp);
    expect(floorOf({ kind: 'traffic', kinds2: { floorHp: 20 } })).toBe(20);
    expect(floorOf({ kind: 'traffic', kinds2: {} })).toBe(0);
    const { s } = sceneOf('N9-1-FLOOR', 'fire');
    expect(floorOf(s)).toBe(0);
  });

  it('현장·용의자의 새 칸은 생성 리터럴에 undefined 로 있다(객체 모양) — 아무도 채우지 않는다', () => {
    const { s } = sceneOf('N9-1-SHAPE', 'armed');
    for (const k of ['kinds2', 'windDir', 'flowSpots']) { expect(k in s, k).toBe(true); expect((s as unknown as Record<string, unknown>)[k], k).toBeUndefined(); }
    expect(s.rules?.includes('sightline') ?? false).toBe(false);
    expect(s.hostiles.length).toBeGreaterThan(0);
    for (const h of s.hostiles) for (const k of ['crowdRole', 'dispersed']) { expect(k in h, k).toBe(true); expect((h as unknown as Record<string, unknown>)[k], k).toBeUndefined(); }
  });

  it('새 임무 decontam 의 자리: 이름 "제독" · 누구도 맡지 않는다(fitFor 0) · 닿으면 내려놓는다(임무를 쥔 채 서 있지 않는다)', () => {
    const { sim, s } = sceneOf('N9-1-DECON', 'hazmat');
    const cops = copsOn(sim, s, 2);
    const w = workOf(sim, 'decontam', { id: s.board.length, cas: s.casualties.length ? 0 : -1 });
    expect(workLabel(s, w)).toBe('제독');
    for (const a of cops) expect(fitFor(sim, s, a, w), sim.responders[a.rid].name).toBe(0);
    s.board.push(w);
    const a = cops[1];
    a.task = makeTask('decontam', '제독', w); w.assignees.push(a.rid); w.status = 'active';
    act(sim, s, a);
    expect(a.task).toBeNull();
    expect(w.assignees).toEqual([]);
    expect(w.status, '다른 대원이 맡을 수 있게 열어 둔다').toBe('open');
  });

  it('새 문제 코드 DECON_LATE: 이름표 "제독 지연" · 측정 도구의 시스템은 hazard', () => {
    expect(PROBLEM_LABEL.DECON_LATE).toBe('제독 지연');
    expect(PROBLEM_SYS.get('DECON_LATE')).toBe('hazard');
  });

  it('새 방법 다섯(R2 표의 끝): 줄이 온전하고 아직 고르지 않는다(can = NOT_YET) — 임무별 갈래(cordon·decontam 은 always)', () => {
    const five: MethodId[] = ['dive', 'boom', 'shieldLine', 'deconTent', 'hoseWash'];
    const ids = Object.keys(METHOD) as MethodId[];
    expect(ids.slice(-5), '표의 끝에 같은 순서로').toEqual(five);
    for (const m of five) {
      const d = METHOD[m];
      expect(d.can, m).toBe(NOT_YET);
      expect(d.record ?? false, m).toBe(false);
      expect(d.plain, m).toBe(false);
      expect(SAY[m].length, m).toBeGreaterThan(0);
      expect(d.label.length, m).toBeLessThanOrEqual(12);
    }
    expect(METHOD.dive.work).toEqual(['waterRescue', 'extricate', 'search']);
    expect(METHOD.boom.work).toEqual(['mitigate']);
    expect(METHOD.shieldLine.work).toEqual(['cordon']); expect(METHOD.shieldLine.kits).toEqual(['shield']);
    expect(methodsOf('decontam')).toEqual(['deconTent', 'hoseWash']); expect(METHOD.hoseWash.kits).toEqual(['hose']);
    expect(methodsOf('cordon')).toEqual(['shieldLine']);
    expect(WORK_MODE.decontam).toBe('always'); expect(WORK_MODE.cordon).toBe('always');
  });

  it('새 장소 종류 셋: 이름표·동네가 있고, 아직 어떤 사건 장소 표에도 없다 (덧붙이기가 해시를 바꾸지 않을 조건 — 설계서 §4.9 의 1)', () => {
    const three: PlaceKind[] = ['subway', 'concertHall', 'bankHQ'];
    expect(three.map((k) => KIND_NAME[k])).toEqual(['지하철역', '공연장', '은행 본점']);
    for (const k of three) {
      expect(KIND_DISTRICT[k], k).toBe('commercial');
      expect(KIND_SCENE[k], `${k}: 현장 틀은 단계 3`).toBeUndefined();
      for (const t of Object.keys(INCIDENT_PLACES) as IncidentType[]) expect(INCIDENT_PLACES[t][k], `${t}: ${k}`).toBeUndefined();
      for (const sc of SCENARIOS) expect(sc.places?.[k], `${sc.type}/${sc.variant}: ${k}`).toBeUndefined();
    }
  });

  it('N9 사실의 id 범위(kinds2Ids.FACT_ID): 소품 범위(0~1999) 위에서 서로 겹치지 않는다', () => {
    const one = [FACT_ID.TRAIN, FACT_ID.FLOOD, FACT_ID.TILT, FACT_ID.OIL, FACT_ID.LANDING, FACT_ID.LAB, FACT_ID.EVENT, FACT_ID.DRONE, FACT_ID.HEADCOUNT, FACT_ID.SWITCH, FACT_ID.AIR_GUESS, FACT_ID.HANDOVER, FACT_ID.FALLPT];
    expect(new Set(one).size).toBe(one.length);
    expect(one).toEqual(Array.from({ length: 13 }, (_, k) => 3001 + k));
    // [시작, 끝) — 구역 < 1000 · 소품 < 300 · 대원 rid < 500
    const bands: [number, number][] = [[0, 2000], [FACT_ID.CROWD, FACT_ID.CROWD + 1000], [3001, 3014], [FACT_ID.AIR, FACT_ID.AIR + 300], [FACT_ID.CARGO, FACT_ID.CARGO + 300],
      [FACT_ID.SPILL, FACT_ID.SPILL + 200], [FACT_ID.DIZZY, FACT_ID.DIZZY + 500], [FACT_ID.CONTAM, FACT_ID.CONTAM + 1000]];
    for (let i = 0; i < bands.length; i++) for (let j = i + 1; j < bands.length; j++) {
      const [a0, a1] = bands[i], [b0, b1] = bands[j];
      expect(a1 <= b0 || b1 <= a0, `${bands[i]} · ${bands[j]}`).toBe(true);
    }
  });

  it('시나리오 표 KINDS2 는 아직 비어 있다 (단계 1 — 첫 줄은 단계 4)', () => {
    expect(KINDS2.length).toBe(0);
    expect(SCENARIOS.filter((sc) => sc.tag === 'kinds2').length).toBe(0);
  });
});

// ───────────────────────── 시험 4 — 정보 격리 (소스 글자 검사, 주석 줄은 뺀다) ─────────────────────────
// 판단 파일은 N9 의 새 진실(Scene.kinds2 — tox·crowd·contamIds·deconned·underIds·…, 용의자의 crowdRole·dispersed)을 읽지 않는다. N8 시험 4(tests/kinds.test.ts)의 목록에 더한다.
// 진실 쪽 글자만 있으므로 믿음 칸(dirty·sunk·lvl·tag·threw)·유형 색인·생김새(windDir·flowSpots)는 걸리지 않는다. callSystem.ts 는 대상이 아니다(신고자 모델).
const SRC = '../src/sim/';
const code = (rel: string): string => readFileSync(new URL(SRC + rel, import.meta.url), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
const JUDGE = ['field/commander.ts', 'field/brain.ts', 'dispatch/analyst.ts', 'dispatch/dispatcher.ts', 'dispatch/screening.ts', 'field/methods.ts', 'field/airDecide.ts', 'field/doctrine/kinds2.ts'];
const JUDGE_LATER = ['field/orders/kinds2.ts'];      // 단계 4 에 생긴다 — 생기면 같은 검사를 받는다
const TRUTH = ['.kinds2', 'kinds2?', '.contamIds', '.underIds', '.deconned', '.tilt', '.train', '.plane', 'escapeAt', 'highPos', 'crowdRole', 'dispersed', '.tunnelEdge'];
const ALLOWED = ['windDir', 'flowSpots', 'dirty', 'sunk', 'lvl', 'tag', 'threw', 'typeIdx.crowd'];
describe('4 정보 격리 — 판단 파일은 N9 의 새 진실을 읽지 않는다 (글자)', () => {
  it('판단 파일의 주석이 아닌 줄에 .kinds2·kinds2?·.contamIds·.underIds·.deconned·.tilt·.train·.plane·escapeAt·highPos·crowdRole·dispersed·.tunnelEdge 가 없다', () => {
    for (const f of JUDGE) expect(existsSync(new URL(SRC + f, import.meta.url)), `${f} 가 있다`).toBe(true);
    const files = [...JUDGE, ...JUDGE_LATER.filter((f) => existsSync(new URL(SRC + f, import.meta.url)))];
    for (const f of files) { const src = code(f); for (const bad of TRUTH) expect(src.includes(bad), `${f}: ${bad}`).toBe(false); }
  });
  it('믿음 칸·생김새의 이름은 금지 글자에 걸리지 않는다 (진실 칸과 다른 이름 — 원칙 13)', () => {
    for (const ok of ALLOWED) for (const bad of TRUTH) expect(ok.includes(bad), `${ok} ⊃ ${bad}`).toBe(false);
  });
});
