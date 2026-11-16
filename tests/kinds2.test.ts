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
      if (k === 'subway') expect(KIND_SCENE[k], '지하철역은 현장 틀이 없다(교통 유형 — 단계 5 의 subwayFrame)').toBeUndefined();
      else expect(KIND_SCENE[k], `${k}: 현장 틀은 단계 3 에 생겼다`).toBeDefined();
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

// ───────────────────────── 단계 2 (틀 B — 새 부대의 자리) ─────────────────────────
// 시험 3 의 틀 부분. 새 부대 넷은 편성되지 않는다(minLevel 6) — 표와 관제의 틀은 온 조직을 편성한 명부(unitLevel 6 으로 createRoster 를 다시 부른 시험용 교대)와
// 인근 도시 지원(제독차만 지원 종류다)으로 본다. 편성 단계의 짝(tests/crews.test.ts ③)·AID_KEYS·공기호흡기 예외는 그 부대를 편성하는 단계(4·5·6·9)가 넣는다.
import { mountainAt } from '../src/sim/city';
import { EXTRA_NAMES, KITS, ROLES, STAFF, drawBatchFaults, drawFaults, hasFirearm, hasKit, kitIdsOf, slotsOf } from '../src/sim/crews';
import { NORMAL } from '../src/sim/difficulty';
import { emptyNeeds, needsText } from '../src/sim/dispatch/analyst';
import { KIND_AUX, LABEL_BONUS, kindFit, kitBonus, notSpare, recomputeUnmet } from '../src/sim/dispatch/dispatcher';
import { PAIRS, docDeptOf } from '../src/sim/field/doctrine';
import { createAidUnit, createRoster, rosterKeys, UNIT_KIND_NAME } from '../src/sim/resources';
import { Rng } from '../src/sim/rng';
import type { Assessment, KitId, Needs, Responder, RoleId, Unit, UnitKind } from '../src/sim/types';
import { unitField } from '../src/view/city/tokens';
import { UNIT_MARK } from '../src/view/marks';
import { VEH_SIZE, responderLook } from '../src/view/scene/sprites';

const N9_KINDS: UnitKind[] = ['mtnRescue', 'dive', 'deconUnit', 'riotPol'];
/** 온 조직을 편성한 명부: 보통 교대(부대 규모 5)를 만든 뒤 편성 단계 6 으로 명부를 다시 짠다 — 표를 보는 시험 전용(교대를 돌리지 않는다) */
function fullOrg(seed: string, equipment = 3): Sim {
  const sim = new Sim(seed, { ...NORMAL, resources: 5, equipment });
  sim.units.length = 0; sim.responders.length = 0;
  sim.tune.unitLevel = 6;
  createRoster(sim);
  return sim;
}
const assessOf = (sim: Sim, type: string, label?: string, needs: Partial<Needs> = {}): Assessment =>
  ({ type: type as IncidentType, typeConf: 0.9, probs: {} as Assessment['probs'], severity: 1.5, confidence: 0.9, needs: { ...emptyNeeds(), ...needs }, risks: [], summary: '', t: sim.t, revision: 0, label });
const kitsOf = (sim: Sim, rid: number): KitId[] => sim.responders[rid].kit!.map((it) => it.id);

describe('3 새 부대 — 편성되지 않는 넷 · 표 · 관제의 틀 (단계 2)', () => {
  it('어느 부대 규모에서도 편성되지 않는다(minLevel 6). 명부의 열쇠·이름은 끝에 붙어 앞 사람이 그대로다. 이름은 모두 다르다(지원 13회 뒤에도)', () => {
    for (const lv of [1, 2, 3, 4, 5]) {
      const sim = new Sim('N9-2-ROSTER', { ...NORMAL, resources: lv });
      for (const u of sim.units) expect(N9_KINDS.indexOf(u.kind), `규모 ${lv} ${u.callsign}`).toBe(-1);
      for (const r of sim.responders) for (const it of r.kit!) expect(it.id === 'diveKit' || it.id === 'mtnKit' || it.id === 'deconKit', `규모 ${lv} ${r.name}: ${it.id}`).toBe(false);
    }
    const keys = rosterKeys();
    const tail = keys.slice(-15);
    expect(tail.map((k) => k.callsign)).toEqual(['산악1', '산악1', '산악1', '수중1', '수중1', '수중1', '제독1', '제독1', '제독1', '제독1', '기동대1', '기동대1', '기동대1', '기동대1', '기동대1']);
    expect(tail.map((k) => k.slot)).toEqual([0, 1, 2, 0, 1, 2, 0, 1, 2, 3, 0, 1, 2, 3, 4]);
    expect(keys[keys.length - 16].callsign, 'N9 의 줄은 N8 의 줄(경찰견1) 다음').toBe('경찰견1');
    expect(new Set(keys.map((k) => k.name)).size).toBe(keys.length);
    expect(EXTRA_NAMES.length).toBeGreaterThanOrEqual(keys.length - 40);
    // 지원 13회 (옛 여덟 + N8 의 넷 + 제독 — 견인은 지원을 부르지 않는다): 지원 대원의 이름이 편성표 대원·다른 지원 대원과 겹치지 않는다
    const sim = new Sim('N9-2-AID', { ...NORMAL, resources: 5 });
    const I = createIncident(sim, { type: 'fire', rng: sim.rng.fork('n9-2-aid') });
    for (const key of ['suppression', 'rescue', 'ems', 'law', 'tactical', 'search', 'traffic', 'eod', 'utilPower', 'utilGas', 'utilWater', 'capture', 'decon'] as (keyof Needs)[]) {
      const u = createAidUnit(sim, key, I); expect(u, key).not.toBeNull(); sim.aidUsed++;
    }
    const names = sim.responders.map((r) => r.name);
    expect(new Set(names).size, names.join(',')).toBe(names.length);
  });

  it('표 (§4.8): 분야·능력·차량·자리·역할·장비 — 온 조직 명부에서 본다. 화학 구조차의 제독 0.7 · 수난 구조대원의 오일펜스는 장비 끝 · R3 의 분야와 짝', () => {
    const full = fullOrg('N9-2-ORG');
    const want: Record<string, { dept: string; field: string; caps: Partial<Record<keyof Needs, number>>; heavy: boolean; spareAir: number; call: string }> = {
      mtnRescue: { dept: 'fire', field: 'rescue', caps: { rescue: 0.7, search: 0.85, ems: 0.35 }, heavy: false, spareAir: 0, call: '산악1' },
      dive: { dept: 'fire', field: 'rescue', caps: { rescue: 0.8, search: 0.7, ems: 0.3 }, heavy: false, spareAir: 0, call: '수중1' },
      deconUnit: { dept: 'fire', field: 'special', caps: { decon: 1.0, rescue: 0.45, suppression: 0.3, search: 0.2 }, heavy: true, spareAir: 4, call: '제독1' },
      riotPol: { dept: 'police', field: 'police', caps: { law: 0.9, tactical: 0.85, traffic: 0.6, search: 0.25 }, heavy: true, spareAir: 0, call: '기동대1' },
    };
    for (const kind of N9_KINDS) {
      const u = full.units.find((q) => q.kind === kind)!, w = want[kind];
      expect(u, kind).toBeTruthy();
      expect([u.callsign, u.dept, u.field, !!u.heavy, u.seats, u.spareAir]).toEqual([w.call, w.dept, w.field, w.heavy, 0, w.spareAir]);
      const nonzero: Partial<Record<keyof Needs, number>> = {};
      for (const k of Object.keys(u.caps) as (keyof Needs)[]) if (u.caps[k] > 0) nonzero[k] = u.caps[k];
      expect(nonzero, `${kind} 능력`).toEqual(w.caps);
      expect(u.crew.map((rid) => full.responders[rid].role)).toEqual(STAFF[kind].std);
      u.crew.forEach((rid, k) => expect(kitsOf(full, rid), `${kind} ${k}번 자리`).toEqual(kitIdsOf(kind, k)));
      expect(UNIT_KIND_NAME[kind].length).toBeGreaterThan(2);
    }
    expect(STAFF.mtnRescue.minDrop).toEqual([2]); expect(STAFF.dive.minDrop).toEqual([2]); expect(STAFF.deconUnit.minDrop).toEqual([3]); expect(STAFF.riotPol.minDrop).toEqual([3, 4]);
    // 지금 부대: 화학 구조차의 제독 0.7 (측정·제독 대원이 최소 인원에서도 남는다) · 다른 지금 부대는 제독 0
    const now = new Sim('N9-2-NOW', { ...NORMAL, resources: 5 });
    for (const u of now.units) expect(u.caps.decon, u.callsign).toBe(u.kind === 'hazmat' ? 0.7 : 0);
    expect(slotsOf('hazmat', true).map((k) => STAFF.hazmat.std[k])).toContain('decon');
    // 장비 넷: 고장 나는 것은 잠수 장비 하나(batch n9) · 오일펜스는 수량 3 · 수난 구조대원의 장비 끝
    expect(KITS.diveKit.faultable).toBe(true); expect(KITS.diveKit.batch).toBe('n9'); expect(KITS.diveKit.uses).toBe(900);
    for (const id of ['mtnKit', 'deconKit', 'oilBoom'] as KitId[]) { expect(!!KITS[id].faultable, id).toBe(false); expect(KITS[id].batch, id).toBeUndefined(); }
    expect(KITS.oilBoom.uses).toBe(3);
    expect(ROLES.boatRescuer.kit.slice(0, 3)).toEqual(['rope', 'ring', 'oilBoom']);      // (R2 1a) 그 뒤에 장대·구명조끼·드라이슈트가 붙는다 (R2 §3.3 — 끝에 붙여 추첨 순서가 그대로다)
    // 새 역할 아홉: 그림 묶음은 지금 묶음에서 · 방패 대원은 총기가 없다 · 기동대의 최소 인원에도 총기 대원(소대장)이 남는다(경찰 0.9 ⇒ 총기)
    const groups: Record<string, string> = { mtnLead: 'lead', mtnRescuer: 'rescue', diveLead: 'water', diver: 'water', deconLead: 'lead', deconTech: 'hazmat', riotLead: 'lead', riotShield: 'shield', riotGrab: 'officer' };
    for (const [role, g] of Object.entries(groups)) expect(ROLES[role as RoleId].group, role).toBe(g);
    const riot = full.units.find((q) => q.kind === 'riotPol')!;
    for (const rid of riot.crew) expect(hasFirearm(full, rid), full.responders[rid].role).toBe(full.responders[rid].role === 'riotLead');
    expect(slotsOf('riotPol', true).map((k) => STAFF.riotPol.std[k])).toEqual(['riotLead', 'riotShield', 'riotShield']);
    // 능력과 장비의 짝 — 표준·최소 인원 모두 (편성 단계에 crews.test ③ 이 같은 것을 본다): 수중 → 잠수 장비 · 산악 → 산악 장비 · 제독 ≥ 0.7 → 제독 장비 또는 역할 decon · 구조정 → 오일펜스 · 제독차 → 공기호흡기
    const slotKits = (kind: UnitKind, minimal: boolean): KitId[][] => slotsOf(kind, minimal).map((k) => kitIdsOf(kind, k));
    for (const minimal of [false, true]) {
      expect(slotKits('dive', minimal).some((ks) => ks.indexOf('diveKit') >= 0)).toBe(true);
      expect(slotKits('mtnRescue', minimal).some((ks) => ks.indexOf('mtnKit') >= 0)).toBe(true);
      for (const kind of ['deconUnit', 'hazmat'] as UnitKind[]) expect(slotsOf(kind, minimal).some((k) => kitIdsOf(kind, k).indexOf('deconKit') >= 0 || STAFF[kind].std[k] === 'decon'), `${kind} 제독`).toBe(true);
      expect(slotKits('boat', minimal).some((ks) => ks.indexOf('oilBoom') >= 0)).toBe(true);
      expect(slotKits('deconUnit', minimal).some((ks) => ks.indexOf('scba') >= 0)).toBe(true);
    }
    // R3: 분야(부대의 분야와 같다)와 짝
    const dept: Record<string, string> = { mtnRescue: 'fire', dive: 'fire', deconUnit: 'special', riotPol: 'police' };
    for (const kind of N9_KINDS) for (const rid of full.units.find((q) => q.kind === kind)!.crew) expect(docDeptOf(full, rid), `${kind} ${full.responders[rid].role}`).toBe(dept[kind]);
    expect(PAIRS.riotPol).toEqual({ std: [['riotShield', 'riotShield']], min: [['riotShield', 'riotShield']] });
    expect(PAIRS.dive).toEqual({ std: [['diver', 'diver']], min: [['diveLead', 'diver']] });
  });

  it('고장 추첨: 잠수 장비(batch n9)는 교대 흐름 kit 의 순서에 끼지 않고 kit-n9 흐름에서 따로 뽑는다 — 지금 편성의 대원은 고장이 그대로다', () => {
    // 함수: drawFaults 는 잠수 장비를 건너뛴다(난수를 쓰지 않는다), drawBatchFaults 는 그 묶음만 뽑는다
    const diver: Responder = { ...new Sim('N9-2-F0').responders[0], kit: [{ id: 'diveKit', fault: false, faultKnown: false }, { id: 'tic', fault: false, faultKnown: false }] };
    const a = new Rng(7), b = new Rng(7);
    expect(drawFaults(a, [diver], 1)).toBe(1);
    expect(diver.kit!.map((it) => !!it.fault)).toEqual([false, true]);
    b.chance(1); expect(a.next(), '잠수 장비에는 난수를 쓰지 않았다(한 번만 뽑았다)').toBe(b.next());
    diver.kit![1].fault = false;
    expect(drawBatchFaults(new Rng(7), [diver], 1, 'n9')).toBe(1);
    expect(diver.kit!.map((it) => !!it.fault)).toEqual([true, false]);
    // 명부: 온 조직(장비 1 — 고장이 잦다)의 고장 = 교대 흐름 kit(잠수 장비를 뺀 순서) + kit-n9(잠수 장비만). 지금 편성(규모 5)의 대원은 명부의 앞부분이고 고장이 같다
    let n9 = 0;
    const faults = (rs: Responder[]): string[] => rs.flatMap((r) => r.kit!.filter((it) => it.fault).map((it) => r.name + ':' + it.id));
    for (const seed of ['F1', 'F2', 'F3', 'F4', 'F5', 'F6']) {
      const full = fullOrg(seed, 1), now = new Sim(seed, { ...NORMAL, resources: 5, equipment: 1 });
      const p = full.tune.kitFault;
      // (R2 1a) R2 의 고장 나는 장비(batch r2 — 로프 대원의 고무보트)도 따로 뽑는 묶음이다 (kit-r2 흐름) — 교대 흐름 kit 의 순서에서 뺀다
      const own = (id: KitId): boolean => KITS[id].batch === 'n9' || KITS[id].batch === 'r2';
      const rk = full.rng.fork('kit'), r9 = full.rng.fork('kit-n9'), r2 = full.rng.fork('kit-r2'), want: string[] = [], want9: string[] = [], want2: string[] = [], got: string[] = [], got9: string[] = [], got2: string[] = [];
      for (const r of full.responders) for (const it of r.kit!) {
        if (KITS[it.id].faultable && !own(it.id) && rk.chance(p)) want.push(r.name + ':' + it.id);
        if (it.fault) (KITS[it.id].batch === 'n9' ? got9 : KITS[it.id].batch === 'r2' ? got2 : got).push(r.name + ':' + it.id);
      }
      for (const r of full.responders) for (const it of r.kit!) if (KITS[it.id].batch === 'n9' && r9.chance(p)) want9.push(r.name + ':' + it.id);
      for (const r of full.responders) for (const it of r.kit!) if (KITS[it.id].faultable && KITS[it.id].batch === 'r2' && r2.chance(p)) want2.push(r.name + ':' + it.id);
      expect(got, seed).toEqual(want); expect(got9, seed).toEqual(want9); expect(got2, seed).toEqual(want2);
      n9 += full.responders.reduce((m, r) => m + r.kit!.filter((it) => it.id === 'diveKit').length, 0);
      const k = now.responders.length;
      expect(full.responders.slice(0, k).map((r) => r.name)).toEqual(now.responders.map((r) => r.name));
      expect(faults(full.responders.slice(0, k)), `${seed}: 지금 편성의 고장이 그대로`).toEqual(faults(now.responders));
    }
    expect(n9, '수중 구조대의 셋이 잠수 장비를 든다 (6교대)').toBe(18);
  });

  it('관제: kindFit 이 새 부대 넷의 일을 좁힌다 (§5.3.2). 형사·경찰견의 금고털이 · KIND_AUX · 예비 셈 · 기동대는 기동 수요를 덮지 않는다', () => {
    const sim = new Sim('N9-2-KIND');
    sim.run(3);
    const I = createIncident(sim, { type: 'search', rng: sim.rng.fork('n9-2-kind') });
    const base = sim.units.find((u) => u.kind === 'patrol')!, eng = sim.units.find((u) => u.kind === 'engine')!;
    const fake = (kind: UnitKind, dept: Unit['dept'] = kind === 'riotPol' ? 'police' : 'fire'): Unit => ({ ...(dept === 'police' ? base : eng), kind, dept });
    const set = (type: string, label?: string): void => { I.assessment = assessOf(sim, type, label); };
    const fit = (kind: UnitKind, key: keyof Needs, dept?: Unit['dept']): number => kindFit(sim, fake(kind, dept), I, key);
    const mtnNode = sim.city.nodes.find((n) => mountainAt(n.x, n.y) >= 0.35)!, flatNode = sim.city.nodes.find((n) => mountainAt(n.x, n.y) === 0)!;
    expect(mtnNode, '산의 교차로가 있다(산성터널로)').toBeTruthy();
    for (const k of N9_KINDS) expect(KIND_AUX.has(k), k).toBe(true);
    // 기동대: 군중 유형이거나 이름표 '집단 난동'(폭동)의 경찰·교통 수요만
    set('crowd'); expect([fit('riotPol', 'law'), fit('riotPol', 'traffic'), fit('riotPol', 'tactical'), fit('riotPol', 'search')]).toEqual([1, 1, 0, 0]);
    set('armed', '집단 난동'); expect(fit('riotPol', 'law')).toBe(1);
    for (const t of ['armed', 'disturb', 'traffic', 'medical']) { set(t); expect([fit('riotPol', 'law'), fit('riotPol', 'traffic')], t).toEqual([0, 0]); }
    // 산악 구조대: 이름표 '산악 조난' 의 구조·수색 1 · 산의 교차로로 신고된 실종·구조 유형 0.6 · 그 밖 0
    set('fire', '산악 조난'); expect([fit('mtnRescue', 'rescue'), fit('mtnRescue', 'search'), fit('mtnRescue', 'ems')]).toEqual([1, 1, 0]);
    for (const t of ['search', 'rescue']) {
      set(t); I.reportedNode = mtnNode.id; expect([fit('mtnRescue', 'search'), fit('mtnRescue', 'rescue')], `${t} 산`).toEqual([0.6, 0.6]);
      I.reportedNode = flatNode.id; expect(fit('mtnRescue', 'search'), `${t} 평지`).toBe(0);
    }
    set('medical'); I.reportedNode = mtnNode.id; expect(fit('mtnRescue', 'search'), '산이라도 응급의 선착 대응 수색에는 0').toBe(0);
    set('search'); I.reportedNode = -1; expect(fit('mtnRescue', 'search'), '위치를 모르면 0').toBe(0);
    // 수중 구조대: 수난 유형이거나 네 이름표의 구조·수색
    set('water'); expect([fit('dive', 'rescue'), fit('dive', 'search'), fit('dive', 'ems')]).toEqual([1, 1, 0]);
    for (const lb of ['침수 지하차도', '여객선 사고', '선박 화재', '어선 사고']) { set('fire', lb); expect(fit('dive', 'rescue'), lb).toBe(1); }
    for (const t of ['fire', 'collapse', 'search', 'traffic']) { set(t); expect(fit('dive', 'rescue'), t).toBe(0); }
    // 제독차: 제독 수요만
    set('hazmat'); expect((['decon', 'rescue', 'suppression', 'search'] as (keyof Needs)[]).map((k) => fit('deconUnit', k))).toEqual([1, 0, 0, 0]);
    // 형사·경찰견: 이름표 '금고털이'(무장 유형)에도 — 무장의 다른 사건에는 그대로 0
    set('armed', '금고털이'); expect([fit('detective', 'law', 'police'), fit('k9', 'search', 'police'), fit('detective', 'search', 'police')]).toEqual([1, 1, 0]);
    set('armed', '강도'); expect([fit('detective', 'law', 'police'), fit('k9', 'search', 'police')]).toEqual([0, 0]);
    // 예비 셈: 산악·수중·제독(소방 부서)·기동대는 남은 부대로 세지 않는다 (마지막 펌프차가 나가는 일이 없게)
    for (const k of N9_KINDS) expect(notSpare(fake(k)), k).toBe(true);
    expect(notSpare(eng)).toBe(false);
    // 기동대는 기동 수요를 덮지 않는다(기동 0.85 < 기준 0.9) — 인질 사건의 '섬광탄을 가진 기동대' 요청이 기동대 배정으로 멈추지 않는다. 경찰 수요는 덮는다
    const full = fullOrg('N9-2-TAC');
    const J = createIncident(full, { type: 'armed', rng: full.rng.fork('n9-2-tac') });
    const riot = full.units.find((u) => u.kind === 'riotPol')!, tac = full.units.find((u) => u.kind === 'tactical')!;
    J.assessment = assessOf(full, 'armed', undefined, { law: 1, tactical: 1 });
    J.assigned = [riot.id]; recomputeUnmet(full, J);
    expect([J.unmet.law ?? 0, J.unmet.tactical ?? 0]).toEqual([0, 1]);
    J.assigned = [riot.id, tac.id]; recomputeUnmet(full, J);
    expect([J.unmet.law ?? 0, J.unmet.tactical ?? 0]).toEqual([0, 0]);
  });

  it('이름표 가점 표(§5.3.3): 줄 열여덟이 들어와 있고 지금은 걸리지 않는다 — 이름표를 내는 시나리오가 없거나 줄의 부대가 편성되지 않는다. 걸리면 그 종류·장비의 부대에 더한다', () => {
    const N9_LABELS = ['압사 위험', '시위 충돌', '행사장 환자 다발', '집단 난동', '여객선 사고', '어선 사고', '침수 지하차도', '밀폐 공간 질식', '일산화탄소 중독', '화학 탱크로리', '기계 끼임', '금고털이', '강풍 낙하물', '기름 유출', '산악 조난'];
    const rows = LABEL_BONUS.filter((r) => N9_LABELS.indexOf(r.label) >= 0);
    expect(rows.length).toBe(18);
    // 지금 관제가 붙일 수 있는 이름표 = 시나리오의 이름표(없으면 이름) + 옛 이름표 넷
    const issued = new Set<string>([...SCENARIOS.map((sc) => sc.label ?? sc.name), '강도', '인질극', '총격', '심정지']);
    const live = rows.filter((r) => issued.has(r.label));
    expect([...new Set(live.map((r) => r.label))], '지금 나오는 이름표는 폭동의 것 하나').toEqual(['집단 난동']);
    for (const r of live) {
      expect(r.kind, r.label).toBe('riotPol');
      for (const lv of [1, 2, 3, 4, 5]) expect(new Sim('N9-2-LB', { ...NORMAL, resources: lv }).units.some((u) => u.kind === r.kind), `규모 ${lv}`).toBe(false);
    }
    // 줄이 걸리면: 이름표·수요 열쇠·종류(또는 장비)가 맞는 부대에만 더한다
    const full = fullOrg('N9-2-LB2');
    const I = createIncident(full, { type: 'fire', rng: full.rng.fork('n9-2-lb2') });
    const unit = (k: UnitKind): Unit => full.units.find((u) => u.kind === k)!;
    for (const u of full.units) for (const rid of u.crew) for (const it of full.responders[rid].kit!) it.faultKnown = false;
    I.assessment = assessOf(full, 'armed', '집단 난동');
    expect([kitBonus(full, unit('riotPol'), I, 'law'), kitBonus(full, unit('patrol'), I, 'law'), kitBonus(full, unit('riotPol'), I, 'traffic')]).toEqual([25, 0, 0]);
    I.assessment = assessOf(full, 'fire', '여객선 사고');
    expect([kitBonus(full, unit('dive'), I, 'rescue'), kitBonus(full, unit('rescue'), I, 'rescue')]).toEqual([15, 0]);
    I.assessment = assessOf(full, 'search', '산악 조난');
    expect([kitBonus(full, unit('mtnRescue'), I, 'rescue'), kitBonus(full, unit('mtnRescue'), I, 'search'), kitBonus(full, unit('rescue'), I, 'rescue')]).toEqual([20, 20, 0]);
    I.assessment = assessOf(full, 'water', '기름 유출');
    expect(kitBonus(full, unit('boat'), I, 'rescue'), '구조정: 구명환·로프 12 + 오일펜스 20').toBe(32);
    expect(kitBonus(full, unit('hazmat'), I, 'rescue'), '화학 구조차: 누출 차단 장비 15 (로프·구명환 없음)').toBe(15);
  });

  it('수요 열쇠 decon (§5.3.1): 이름 · 빈 수요 · 지원 제독차(최소 인원 셋, 화면 분야 특수) · 관제의 남은 수요 · 지휘관이 맡을 사람 없는 제독 작업에 "제독 부대"를 부른다(needFor)', () => {
    expect(emptyNeeds().decon).toBe(0);
    expect(needsText({ decon: 1 })).toBe('제독 1');
    const sim = new Sim('N9-2-DECON', { ...NORMAL, resources: 5 });
    sim.run(3);
    const I = createIncident(sim, { type: 'medical', rng: sim.rng.fork('n9-2-decon') });
    const u = createAidUnit(sim, 'decon', I)!;
    sim.aidUsed++;
    expect([u.kind, u.callsign, u.dept, unitField(u), !!u.heavy, u.caps.decon, u.spareAir]).toEqual(['deconUnit', '지원제독1', 'fire', 'special', true, 1, 4]);
    expect(u.crew.map((rid) => sim.responders[rid].role)).toEqual(['deconLead', 'deconTech', 'deconTech']);
    for (const rid of u.crew) expect(hasKit(sim, rid, 'deconKit') && hasKit(sim, rid, 'scba'), sim.responders[rid].role).toBe(true);
    // 관제의 남은 수요: 제독차(1.0)·화학 구조차(0.7)가 덮는다. 다른 부대는 덮지 않는다
    I.assessment = assessOf(sim, 'hazmat', undefined, { decon: 1 });
    I.assigned = []; recomputeUnmet(sim, I); expect(I.unmet.decon).toBe(1);
    I.assigned = [sim.units.find((q) => q.kind === 'engine')!.id]; recomputeUnmet(sim, I); expect(I.unmet.decon).toBe(1);
    I.assigned = [sim.units.find((q) => q.kind === 'hazmat')!.id]; recomputeUnmet(sim, I); expect(I.unmet.decon ?? 0).toBe(0);
    I.assigned = [u.id]; recomputeUnmet(sim, I); expect(I.unmet.decon ?? 0).toBe(0);
    I.assigned = [];
    // 지휘관: 20초 넘게 열린 제독 작업을 맡을 사람이 현장에도 오는 쪽에도 없으면 제독 부대를 부른다 (단계 2 에는 아무도 제독을 맡지 않는다 — fitFor 0)
    const s = sim.scenes[I.id]!;
    const [cmd] = copsOn(sim, s, 2);
    s.board.unshift(workOf(sim, 'decontam', { cas: 0, createdAt: sim.t - 30, id: s.nextWorkId++ }));
    commanderThink(sim, s, cmd);
    expect(s.requests.some((r) => r.need === 'decon'), '제독 지원 요청').toBe(true);
    expect(sim.events.some((e) => e.incidentId === I.id && e.text.startsWith('관제, 제독 부대 추가 지원 요청.')), '요청 무전').toBe(true);
  });

  it('화면의 자리: 새 부대 넷의 기호가 다른 모든 부대 기호와 다르고, 차량 크기·대원 겉모습이 있다 (산악·수중은 공기호흡기를 메지 않는다)', () => {
    const marks = Object.values(UNIT_MARK);
    for (const k of N9_KINDS) {
      expect(UNIT_MARK[k], k).toMatch(/^M[\d. A-Za-z-]+Z$/);
      expect(marks.filter((d) => d === UNIT_MARK[k]).length, k).toBe(1);
      expect(VEH_SIZE[k][0] > VEH_SIZE[k][1] && VEH_SIZE[k][1] >= 0.9, k).toBe(true);
    }
    const mtn = responderLook('fire', 'mtnRescue', 7, 'mtnRescuer'), dive = responderLook('fire', 'dive', 7, 'diver');
    expect(mtn.pack).not.toBe('scba'); expect(mtn.head).toBe('helmet');
    expect(dive.head).toBe('hood');
    expect(responderLook('fire', 'deconUnit', 7, 'deconTech').top).toBe(responderLook('fire', 'hazmat', 7, 'hazTech').top);      // 화학 보호복과 같은 묶음
    expect(responderLook('fire', 'deconUnit', 7, 'deconLead').band, '제독 팀장의 띠').toBeTruthy();
    expect(responderLook('police', 'riotPol', 7, 'riotShield').head).toBe('helmet');
    expect(responderLook('police', 'riotPol', 7).top).not.toBe(responderLook('police', 'patrol', 7).top);
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

// ───────────────────────── 시험 2 — 지도 덧붙이기 (단계 3) ─────────────────────────
// 지하철역 셋·공연장·은행 본점을 buildPlaces 의 "4)"와 "5)" 사이에 덧붙였다(cityPlan.LATE_LANDMARKS). 결과 불변은 구현 메모의 해시 목록으로 증명한다
// (해시를 숫자로 박지 않는다 — 결과를 바꾸는 묶음이 같은 주 브랜치에 나란히 합쳐진다). 여기서는 그 조건(끝에 붙는다 · 겹치지 않는다 · 종류가 어떤 사건 표에도 없다)을 본다.
// 터널 구간을 닫지 않는다는 강제 fire/tunnelfire 시험은 그 시나리오가 생기는 단계 5 가 더한다. 세 종류를 사건 표에 처음 넣는 단계(4·5·6·7)는 셋째 시험의 글자 검사를 좁힌다.
import { readdirSync } from 'node:fs';
import { boxOf, coastY, obbHit, placeAt, rectSegDist, riverDist, roadHalf } from '../src/sim/city';
import { LANDMARKS, LATE_LANDMARKS, RAIL } from '../src/sim/cityPlan';
import { TUNNEL_AT, tunnelEdges, tunnelNode, underpassEdges, underpassNode } from '../src/sim/field/kinds2Kit';
import { drawKinds2Layer, paintKinds2Static } from '../src/view/city/kinds2Layer';
import { fakeCanvas, fakeCtx } from './fakeCanvas';

const NEW_KINDS: PlaceKind[] = ['subway', 'concertHall', 'bankHQ'];
describe('2 지도 덧붙이기 — 새 장소 다섯 · 터널과 지하차도의 도우미 (단계 3)', () => {
  it('다섯 장소가 도시의 끝에 덧붙인 순서대로 있다 — 종류·이름·주소·진입 교차로가 있고 출동 시설이 아니다. 지도는 교대가 바뀌어도 같다', () => {
    const city = new Sim('A').city, n = LATE_LANDMARKS.length;
    expect(n).toBe(5);
    const late = city.places.slice(-n);
    expect(late.map((q) => [q.kind, q.name])).toEqual(LATE_LANDMARKS.map((l) => [l.kind, l.name]));
    expect(late.map((q) => q.kind)).toEqual(['subway', 'subway', 'subway', 'concertHall', 'bankHQ']);
    expect(late.map((q) => q.name)).toEqual(['시청역', '중앙역', '남문역', '가온아트홀', '가람은행 본점']);
    expect(city.places.filter((q) => NEW_KINDS.indexOf(q.kind) >= 0).length, '세 종류의 건물은 덧붙인 다섯뿐').toBe(5);
    for (const [k, q] of late.entries()) {
      const l = LATE_LANDMARKS[k];
      expect(q.id).toBe(city.places.length - n + k);
      expect(q.x + q.w / 2).toBeCloseTo(l.x, 6); expect(q.y + q.h / 2).toBeCloseTo(l.y, 6);
      expect(q.rot ?? 0).toBeCloseTo(((l.rot ?? 0) * Math.PI) / 180, 9);
      expect(q.open, q.name).toBe(false); expect(q.facility, q.name).toBe(-1);
      expect(q.district, q.name).toBe('commercial');
      expect(q.addr.length, q.name).toBeGreaterThan(0); expect(q.dong.length, q.name).toBeGreaterThan(0);
      expect(q.nodeId, q.name).toBeGreaterThanOrEqual(0);
      const e = city.edges[q.edgeId!], nd = city.nodes[q.nodeId];
      expect(e.cls, q.name).not.toBe('highway');
      expect(Math.hypot(q.cx - nd.x, q.cy - nd.y), q.name).toBeLessThanOrEqual(e.len * 0.5 + 1);
      expect(LANDMARKS.some((m) => m.name === q.name), `${q.name}: 손으로 놓은 건물(LANDMARKS)과 이름이 겹치지 않는다`).toBe(false);
    }
    const addr = city.places.filter((q) => !q.open).map((q) => q.addr);
    expect(new Set(addr).size, '주소가 겹치지 않는다').toBe(addr.length);
    const b = new Sim('B').city;
    expect(b.places.slice(-n).map((q) => `${q.id}:${q.addr}:${q.nodeId}:${q.tone}`)).toEqual(late.map((q) => `${q.id}:${q.addr}:${q.nodeId}:${q.tone}`));
  });

  it('겹치지 않는다 — 서로·기존 건물·터와 겹치지 않고(placeAt 이 자기를 찾는다), 도로 반폭 + 3 밖, 철길·골목·물에서 떨어져 있다', () => {
    const city = new Sim('A').city, late = city.places.slice(-LATE_LANDMARKS.length);
    for (const q of late) {
      const bx = boxOf(q), cx = q.x + q.w / 2, cy = q.y + q.h / 2;
      expect(placeAt(city, cx, cy)!.id, q.name).toBe(q.id);
      for (const p of city.places) if (p.id !== q.id) expect(obbHit(bx, boxOf(p), 0), `${q.name} ↔ ${p.name}`).toBe(false);
      for (const e of city.edges) { const A = city.nodes[e.a], B = city.nodes[e.b]; expect(rectSegDist(bx, A.x, A.y, B.x, B.y), `${q.name} ↔ ${e.name}`).toBeGreaterThanOrEqual(roadHalf(e) + 3); }
      for (let i = 0; i < RAIL.length - 1; i++) expect(rectSegDist(bx, RAIL[i][0], RAIL[i][1], RAIL[i + 1][0], RAIL[i + 1][1]), `${q.name} ↔ 철길`).toBeGreaterThanOrEqual(8);
      for (const a of city.alleys) expect(rectSegDist(bx, a.x0, a.y0, a.x1, a.y1), `${q.name} ↔ ${a.name}`).toBeGreaterThanOrEqual(5.5);
      const c = Math.cos(bx.rot), s = Math.sin(bx.rot);
      for (const [lx, ly] of [[-1, -1], [1, -1], [1, 1], [-1, 1], [0, 0]]) {
        const x = cx + (lx * q.w * c) / 2 - (ly * q.h * s) / 2, y = cy + (lx * q.w * s) / 2 + (ly * q.h * c) / 2;
        expect(y, `${q.name}: 바다`).toBeLessThan(coastY(x) - 9); expect(riverDist(x, y), `${q.name}: 강`).toBeGreaterThanOrEqual(8);
      }
    }
  });

  it('세 종류는 아직 어떤 사건 장소 표에도 없다 — src/sim 에서 그 글자는 types.ts 와 cityPlan.ts 의 이름표·동네·현장 틀·덧붙이기 표에만 있다 (단계 4·5·6·7 이 처음 넣는다)', () => {
    const root = new URL('../src/sim/', import.meta.url);
    const files = (readdirSync(root, { recursive: true }) as string[]).filter((f) => f.endsWith('.ts')).map((f) => f.split('\\').join('/'));
    expect(files.length).toBeGreaterThan(40);
    for (const f of files) {
      if (f === 'types.ts' || f === 'cityPlan.ts') continue;
      const src = code(f);
      for (const k of NEW_KINDS) expect(src.includes(k), `${f}: ${k}`).toBe(false);
    }
    // cityPlan.ts 안에서는 KIND_NAME·KIND_DISTRICT·KIND_SCENE·LATE_LANDMARKS 의 줄에만
    const lines = code('cityPlan.ts').split('\n');
    const at = (head: string): number => lines.findIndex((l) => l.startsWith(head));
    const ends = (from: number): number => { let k = from; while (k < lines.length && !lines[k].startsWith('}') && !lines[k].startsWith('];')) k++; return k; };
    const ok = new Set<number>();
    for (const head of ['export const KIND_NAME', 'export const KIND_DISTRICT', 'export const KIND_SCENE', 'export const LATE_LANDMARKS']) { const a = at(head); expect(a, head).toBeGreaterThanOrEqual(0); for (let k = a; k <= ends(a); k++) ok.add(k); }
    lines.forEach((l, k) => { for (const kd of NEW_KINDS) if (l.includes(kd)) expect(ok.has(k), `cityPlan.ts ${k + 1}행: ${l.trim().slice(0, 60)}`).toBe(true); });
    // 지하철역은 현장 틀이 없고(교통 유형), 공연장·은행 본점은 있다. 은행 본점의 무장 장소는 은행
    expect(KIND_SCENE.subway).toBeUndefined();
    expect(KIND_SCENE.concertHall).toEqual({ arch: [0, 0, 1], tall: 0.5 });
    expect(KIND_SCENE.bankHQ).toEqual({ arch: [0.3, 0.3, 0.4], tall: 0.6, venue: 'bank' });
  });

  it('터널·지하차도 도우미: tunnelEdges 는 산성터널로(staticCity 의 터널 입구와 같은 식), underpassEdges 는 중앙대로 — 이름으로 본다', () => {
    const city = new Sim('A').city;
    const te = tunnelEdges(city), ue = underpassEdges(city);
    expect(te.length).toBeGreaterThanOrEqual(1); expect(ue.length).toBeGreaterThanOrEqual(1);
    for (const id of te) {
      const e = city.edges[id], A = city.nodes[e.a], B = city.nodes[e.b];
      expect(e.name).toBe('산성터널로'); expect(e.cls).toBe('arterial');
      expect(mountainAt((A.x + B.x) / 2, (A.y + B.y) / 2)).toBeGreaterThanOrEqual(TUNNEL_AT);
    }
    // 산성터널로의 구간 가운데 산을 지나는 것은 모두 터널이다(빠뜨리지 않는다)
    for (const e of city.edges) if (e.name === '산성터널로' && mountainAt((city.nodes[e.a].x + city.nodes[e.b].x) / 2, (city.nodes[e.a].y + city.nodes[e.b].y) / 2) >= TUNNEL_AT) expect(te).toContain(e.id);
    for (const id of ue) { const e = city.edges[id]; expect(e.name).toBe('중앙대로'); expect(e.cls === 'arterial' || e.cls === 'highway').toBe(true); expect(e.bridge).toBe(false); }
    // 도시는 고정이다 — 다른 교대의 도시에서도 같은 구간
    const b = new Sim('B').city;
    expect(tunnelEdges(b)).toEqual(te); expect(underpassEdges(b)).toEqual(ue);
  });

  it('교차로 도우미 tunnelNode·underpassNode 는 null 을 돌려주지 않는다 — 빈 교차로 먼저, 모두 바쁘면 바쁜 곳이라도. 도시 밖 끝(N3)은 고르지 않는다', () => {
    const sim = new Sim('A'), city = sim.city;
    const fac = new Set(city.facilities.map((f) => f.nodeId));
    const ends = (ids: number[]): number[] => [...new Set(ids.flatMap((id) => [city.edges[id].a, city.edges[id].b]))].filter((n) => !city.nodes[n].exit).sort((a, b) => a - b);
    const cases: [typeof tunnelNode, number[], string[]][] = [[tunnelNode, ends(tunnelEdges(city)), ['N1', 'N2']], [underpassNode, ends(underpassEdges(city)), ['L52', 'L74']]];
    for (const [f, cands, keys] of cases) {
      expect(cands.map((n) => city.nodes[n].key).sort()).toEqual(keys);
      const rng = new Rng(7), seen = new Set<number>();
      for (let k = 0; k < 40; k++) { const n = f(sim, rng, new Set()); expect(cands).toContain(n); expect(fac.has(n)).toBe(false); seen.add(n); }
      const free = cands.filter((n) => !fac.has(n));
      expect([...seen].sort((a, b) => a - b), '빈 교차로가 여럿이면 그 가운데서 고른다').toEqual(free);
      // 한 곳이 바쁘면 다른 곳
      if (free.length >= 2) for (let k = 0; k < 10; k++) expect(f(sim, rng, new Set([free[0]]))).not.toBe(free[0]);
      // 모든 교차로가 바빠도 null 이 아니다 — 후보 가운데 하나
      const all = new Set(city.nodes.map((nd) => nd.id));
      for (let k = 0; k < 10; k++) { const n = f(sim, rng, all); expect(n).not.toBeNull(); expect(cands).toContain(n); }
    }
  });

  it('kinds2Layer 는 시뮬레이션 상태를 바꾸지 않는다 — 가짜 캔버스에 그려도 기록·난수·건물·도로가 그대로이고, 그린 교대와 그리지 않은 교대가 같은 기록을 남긴다', () => {
    const a = new Sim('S1'), b = new Sim('S1');
    a.run(40); b.run(40);
    const sig = (s: Sim): string => JSON.stringify([s.t, s.events.length, JSON.stringify(s.rng), s.city.places.length, s.city.edges.map((e) => [e.closed, e.slow, e.cong])]);
    const before = sig(a);
    drawKinds2Layer(fakeCtx(), a.city, false); drawKinds2Layer(fakeCtx(), a.city, true); paintKinds2Static(fakeCanvas(), a);
    expect(sig(a)).toBe(before);
    a.run(600); b.run(600);
    expect(a.events.map((ev) => ev.text).join('\n')).toBe(b.events.map((ev) => ev.text).join('\n'));
  });
});
