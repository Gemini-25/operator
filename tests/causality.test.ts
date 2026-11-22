// 측정 도구 (docs/specs/I1-causality.md §2 · §6 의 I1-a): 결과 불변, 손 계산, 문구 규칙, 멈춤 감지기, 연쇄 깊이, 일치 검사, 요약 모양
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { PROBLEM_LABEL } from '../src/sim/debrief';
import { NORMAL, parseDifficulty, parseDisaster } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { blockersOf } from '../src/sim/dispatch/dispatcher';
import { emit, raiseProblem } from '../src/sim/events';
import { BeliefStore, heardEv, mergeHeard, mkFact } from '../src/sim/field/beliefs';
import { CHAIN_MAX, CHAIN_SHIFT_MAX, DEPTH_MAX, canChain, chainDepth, noteChainDrop } from '../src/sim/chain';
import { closeIncident, createIncident } from '../src/sim/incidents';
import { FIRE_BIG, blast } from '../src/sim/field/hazards';
import { DISTRICTS } from '../src/sim/cityPlan';
import { CSQ_SPAWN_CAP, registerConsequence, signal, spawnConsequence, tickWorld } from '../src/sim/world/consequence';
import { ruleLoad } from '../src/sim/world/hazard';
import type { CsqCtx } from '../src/sim/world/consequence';
import { DIVERT_LATE_MIN, divertArrived, divertUnmet, noteDivert } from '../src/sim/world/rules/record';
import { ER } from '../src/sim/world/rules/hospital';
import { RUBBLE } from '../src/sim/world/rules/structure';
import { X6_BOOM_DETAIL, catOf, collapseBuilding } from '../src/sim/field/catastrophe';
import { makeCarryover } from '../src/sim/persist';
import { unitArrived } from '../src/sim/field/sceneManager';
import { OBSTACLE_LABEL, addObstacle, reallyLinked, tickTraffic } from '../src/sim/traffic';
import { ER_PENALTY, dispatchUnit, etaFor, sendUnitTo, startTransport, tickUnits, transportWhy } from '../src/sim/resources';
import { HOSPITAL_CAP, ZONE_DEFAULT, erLoad, hospitalOf, initWorld, knownBuildingAt, knownHospital, knownZone, knownZoneOfIncident, placeState, setZone, zoneOfPlace, zoneOfXY } from '../src/sim/world/state';
import { findRoute } from '../src/sim/city';
import { smokeBase } from '../src/sim/world/expo';
import { CHAIN_LINES, HZ_SHORT, chainLines, worldReport } from '../src/sim/world/report';
import { drawZonesWorld } from '../src/view/city/zoneLayer';
import { drawExpoWorld } from '../src/view/city/ruinLayer';
import { causeChip } from '../src/ui/HazardStrip';
import { fakeCtx, withFakeDom } from './fakeCanvas';
import { hazardLabel } from '../src/sim/world/hazard';
import { scenarioName } from '../src/sim/scenarios';
import type { EventKind, Incident, Responder, Role, Signal, SimEvent, Unit, ZoneField, ZoneState } from '../src/sim/types';
import {
  PHRASE, PROBLEM_SYS, Probe, SAMPLE_EVERY, STALL_ALLOW, STALL_SEC, SYSTEMS, causeDepths, causesDepthByIncident, checkC5, checkMetrics,
  divertAnalysis, eventSystems, formatLines, genDropped, linkCounts, metricsJson, runWithProbe, shiftMetrics, spreadByIncident, spreadDistinct,
  spreadGraph, spreadPath, summarize, sysOf, waitState,
} from '../scripts/metrics';
import type { MetricsSummary, ShiftMetrics, SysOf } from '../scripts/metrics';

const QUAKE: Difficulty = { ...NORMAL, disaster: parseDisaster('quake')! };
/** 끝까지 돈 교대 (runWithProbe) 는 이 파일 안에서 한 번만 돌리고 다시 쓴다. 쓰는 테스트는 끝난 상태를 읽기만 한다 */
const probed = new Map<string, { sim: Sim; probe: Probe; m: ShiftMetrics }>();
function probedShift(seed: string, d: Difficulty = NORMAL, force: string | null = null): { sim: Sim; probe: Probe; m: ShiftMetrics } {
  const key = `${seed}|${JSON.stringify(d)}|${force}`;
  let r = probed.get(key);
  if (!r) { const sim = new Sim(seed, d, 1200, { force }); const probe = runWithProbe(sim); r = { sim, probe, m: shiftMetrics(sim, probe) }; probed.set(key, r); }
  return r;
}

/** 손으로 만드는 기록 (id 는 배열 위치) */
function ev(list: SimEvent[], inc: number, kind: EventKind, opts: { text?: string; causes?: number[]; problem?: SimEvent['problem']; role?: Role; actor?: string; t?: number; tag?: string } = {}): number {
  const id = list.length;
  const e: SimEvent = { id, t: opts.t ?? id, incidentId: inc, role: opts.role ?? 'SYSTEM', actor: opts.actor ?? '시험', kind, text: opts.text ?? `기록 ${id}`, causes: opts.causes ?? [], problem: opts.problem ?? null, importance: 1, truth: false, rid: -1 };
  if (opts.tag !== undefined) (e as { tag?: string }).tag = opts.tag;      // SimEvent.tag 는 WorldTag 지만 시험은 표에 없는 태그도 넣는다
  list.push(e);
  return id;
}

describe('측정은 결과를 바꾸지 않는다', () => {
  it('runToEnd 와 runWithProbe 의 보고서가 같다 (보통 S1·S4, 지진 S2)', () => {
    for (const [seed, d] of [['S1', NORMAL], ['S4', NORMAL], ['S2', QUAKE]] as [string, Difficulty][]) {
      const a = new Sim(seed, d, 1200); a.runToEnd();
      const { sim: b, probe } = probedShift(seed, d);
      expect(probe.failed).toBe(false);
      expect(probe.samples).toBeGreaterThan(1000);
      expect(b.report!.hash).toBe(a.report!.hash);
      expect(b.logHash).toBe(a.logHash);
      expect(JSON.stringify(b.report)).toBe(JSON.stringify(a.report));
    }
  });
});

describe('계산이 손 계산과 맞다', () => {
  // 사건 둘(0·1). 사건 0 의 현장 위험이 도로를 바꾸고, 그 도로가 사건 1 의 출동을 막는다. 사건 없는 재난 알림이 사건 1 의 무전을 낳는다.
  const E: SimEvent[] = [];
  ev(E, -1, 'shift', { text: '교대 시작.' });                                                    // 0 none
  ev(E, 0, 'incident');                                                                        // 1 origin
  ev(E, 0, 'call', { causes: [1] });                                                           // 2 call
  ev(E, 0, 'dispatch', { causes: [2], role: 'DISPATCH', text: '출동 지령: 진압1 → 사건 01.' });  // 3 dispatch
  ev(E, 0, 'hazard', { causes: [3] });                                                         // 4 hazard  (w 1)
  ev(E, 0, 'traffic', { causes: [4] });                                                        // 5 road    (w 1)
  ev(E, 1, 'problem', { causes: [5], problem: 'ROUTE_BLOCKED' });                              // 6 road, 다른 사건 (w 1)
  ev(E, 1, 'dispatch', { causes: [6], role: 'DISPATCH' });                                     // 7 dispatch (w 0)
  ev(E, -1, 'hazard', { text: '지진 발생.' });                                                 // 8 disaster (사건 없음)
  ev(E, 1, 'radio', { causes: [8] });                                                          // 9 field
  ev(E, 1, 'unit', { causes: [9], text: '구급1: 응급실이 붐벼 환자 인계가 늦어집니다 (앞에 1대).' });   // 10 hospital (w 1)
  const sys: SysOf[] = E.map(sysOf);

  it('시스템 대응', () => {
    expect(sys).toEqual(['none', 'origin', 'call', 'dispatch', 'hazard', 'road', 'road', 'dispatch', 'disaster', 'field', 'hospital']);
  });
  it('원인 사슬 깊이와 사건 사이 간선', () => {
    const L = causeDepths(E);
    expect(Array.from(L)).toEqual([1, 1, 2, 3, 4, 5, 6, 7, 1, 2, 3]);
    expect(causesDepthByIncident(E, L, 2)).toEqual([5, 7]);
    expect(linkCounts(E, sys)).toEqual({ cross: 1, world: 1 });
  });
  it('확산 단계: 사건 0 은 3 (0:hazard → 0:road → 1:road), 세계에서 시작한 확산은 2', () => {
    const g = spreadGraph(E, sys);
    expect(Array.from(g.raw)).toEqual([0, 3, 3, 3, 2, 1, 0, 0, 2, 1, 0]);
    expect(spreadPath(E, sys, g, 1)).toEqual([1, 2, 3, 4, 5, 6]);
    const sp = spreadByIncident(E, sys, 2, g);
    expect(sp.inc[0]).toEqual({ distinct: 3, raw: 3, start: 1 });
    expect(sp.inc[1].distinct).toBe(1);
    expect(sp.world.distinct).toBe(2);
  });
  it('사건별 시스템 집합: 사건 없는 원인(재난 알림)과 다른 사건을 가리키는 원인이 들어간다', () => {
    const S = eventSystems(E, sys, 2);
    expect(SYSTEMS.filter((x) => S[0].has(x))).toEqual(['call', 'dispatch', 'road', 'hazard']);
    expect(SYSTEMS.filter((x) => S[1].has(x))).toEqual(['dispatch', 'field', 'road', 'hospital', 'other', 'disaster']);
  });
  it('왕복은 세지 않는다: 두 시스템을 오가면 raw 4 · distinct 2, 두 사건을 오가면 distinct < raw', () => {
    // 설계서의 예는 hazard → field → … 이지만 field 는 기본 세 시스템이라 무게가 0 이다. 기본 밖의 두 시스템(hazard ↔ road)으로 잰다
    const A: SimEvent[] = [];
    ev(A, 0, 'hazard'); ev(A, 0, 'traffic', { causes: [0] }); ev(A, 0, 'hazard', { causes: [1] }); ev(A, 0, 'traffic', { causes: [2] }); ev(A, 0, 'hazard', { causes: [3] });
    const sa = A.map(sysOf), ga = spreadGraph(A, sa);
    expect(ga.raw[0]).toBe(4);
    expect(spreadDistinct(A, sa, spreadPath(A, sa, ga, 0))).toBe(2);
    expect(spreadByIncident(A, sa, 1).inc[0]).toEqual({ distinct: 2, raw: 4, start: 0 });
    const B: SimEvent[] = [];
    ev(B, 0, 'radio'); ev(B, 1, 'radio', { causes: [0] }); ev(B, 0, 'radio', { causes: [1] }); ev(B, 1, 'radio', { causes: [2] });
    const sb = B.map(sysOf), gb = spreadGraph(B, sb);
    expect(gb.raw[0]).toBe(3);
    expect(spreadDistinct(B, sb, spreadPath(B, sb, gb, 0))).toBe(2);
  });
  it('전환 배정의 짝: DIVERTED 바로 뒤의 출동 지령, 대체 지령은 dispatchLog 에서 문제 기록보다 id 가 큰 첫 것', () => {
    const D: SimEvent[] = [];
    ev(D, 1, 'dispatch', { role: 'DISPATCH', t: 90, text: '출동 지령: 진압1 → 사건 02 (건물 화재).' });       // 0 J 로의 첫 출동
    ev(D, 1, 'problem', { role: 'DISPATCH', t: 100, problem: 'DIVERTED' });                                   // 1 전환
    ev(D, 0, 'dispatch', { role: 'DISPATCH', t: 100, text: '출동 지령: 진압1 → 사건 01 (건물 화재).' });      // 2 받는 사건 I
    ev(D, 1, 'dispatch', { role: 'DISPATCH', t: 104, text: '출동 지령: 진압2 → 사건 02 (건물 화재).' });      // 3 대체 지령
    ev(D, 1, 'problem', { role: 'DISPATCH', t: 200, problem: 'DIVERTED' });                                   // 4 짝이 없는 전환 (C4 위반)
    const incs = [
      { id: 0, problems: [], firstArrivalAt: 150, closedAt: 300, dispatchLog: [2] },
      { id: 1, problems: [{ code: 'DIVERTED', t: 100, eventId: 1 }, { code: 'DIVERTED', t: 200, eventId: 4 }], firstArrivalAt: 160, closedAt: 400, dispatchLog: [0, 3] },
    ];
    const units = [{ callsign: '진압1' }, { callsign: '진압2' }];
    const etaLog = [{ unit: 1, t: 101, fromInc: 1, fromEta: 999 }, { unit: 0, t: 101, fromInc: 1, fromEta: 130 }];
    const r = divertAnalysis(D, incs, units, etaLog, 1200);
    expect(r.c4).toBe(1);
    expect(r.rows[0]).toEqual({ j: 1, i: 0, unit: 0, t: 100, pe: 1, hurt: true, eta: 130, lostSec: 30, refillSec: 4 });
    expect(r.rows[1]).toMatchObject({ j: 1, i: -1, unit: -1, hurt: false, eta: null, lostSec: null, refillSec: null });
  });
  it('잊힌 사건과 위치를 모르는 사건의 판정', () => {
    const base = { phase: 'call', assigned: [] as number[], pursuit: undefined as { state: string } | undefined, assessment: {}, locationKnown: true, unmet: {} };
    expect(waitState(base, false)).toBe('forgot');
    expect(waitState(base, true)).toBe(null);                                         // 아직 통화 중
    expect(waitState({ ...base, phase: 'dispatched' }, true)).toBe('forgot');         // 출동 지령 뒤 부대가 모두 빠졌다
    expect(waitState({ ...base, locationKnown: false }, false)).toBe('unloc');
    expect(waitState({ ...base, assessment: null }, false)).toBe('unloc');
    expect(waitState({ ...base, unmet: { ems: 1 } }, false)).toBe(null);              // 대기열 (자원 부족)
    expect(waitState({ ...base, assigned: [3] }, false)).toBe(null);
    expect(waitState({ ...base, pursuit: { state: 'driving' } }, false)).toBe(null);
    expect(waitState({ ...base, phase: 'onscene' }, false)).toBe(null);
  });
  it('잊힌 사건의 시계: 가짜 사건·통화로 30초 이상이면 센다', () => {
    const I = { id: 0, phase: 'call', assigned: [], assessment: {}, locationKnown: true, unmet: {}, blockedEdge: -1, truth: { type: 'fire', variant: 'std' }, parent: undefined };
    const fake = { t: 0, dt: 0.2, events: [], incidents: [I], gen: { chain: [] }, disaster: null, units: [], city: { edges: [] }, calls: [{ incidentId: 0, state: 'active' }], scenes: [null] };
    const p = new Probe(fake as unknown as Sim);
    for (let k = 0; k < 10; k++) { fake.t++; p.sample(); }
    expect(p.forgotBest[0]).toBe(0);                     // 통화 중에는 돌지 않는다
    fake.calls[0].state = 'done';
    for (let k = 0; k < 31; k++) { fake.t++; p.sample(); }
    expect(p.forgotBest[0]).toBe(30);
    expect(p.unlocBest[0]).toBe(0);
  });
});

describe('대응표가 문구를 아직 잡는다', () => {
  it('모든 문제 코드가 대응표에 있다', () => {
    for (const code of Object.keys(PROBLEM_LABEL)) expect(PROBLEM_SYS.has(code), code).toBe(true);
  });
  it('T1·T2·T3·T4·T7 이 보통 S1 의 기록과 맞고, 그 기록의 시스템이 맞다', () => {
    // 시드는 다섯 문구가 모두 나오는 교대로 고른다 (R1 에서 대원 수가 바뀌어 모든 시드의 결과가 달라졌다: S1 에는 응급실 대기가 없어졌고 S7 에는 5건 있다.
    // R3 3단계(짝·2인 진입)로 다시 바뀌어 S7 의 응급실 대기가 없어지고 S1 에 5건 있다)
    const { sim } = probedShift('S1');
    const hit = (re: RegExp): SimEvent[] => sim.events.filter((e) => re.test(e.text));
    for (const k of ['T1', 'T2', 'T3', 'T4', 'T7'] as const) expect(hit(PHRASE[k]).length, k).toBeGreaterThan(0);
    expect(hit(PHRASE.T1).every((e) => sysOf(e) === 'aid')).toBe(true);
    expect(hit(PHRASE.T2).every((e) => sysOf(e) === 'hospital')).toBe(true);
    expect(hit(PHRASE.T4).every((e) => sysOf(e) === 'hospital')).toBe(true);
    expect(hit(PHRASE.T7).every((e) => sysOf(e) === 'dispatch')).toBe(true);
  });
  it('T8(이송 중 목적지 변경 — I1-b C3)이 응급실 포화가 알려진 교대(보통 S3·S7)의 기록과 맞고, 그 기록의 시스템이 병원이다', () => {
    let n = 0;
    // (N8 단계 6a) S1 을 더했다 (표본만 넓힌다): 경찰 새 부대 셋이 편성돼 S3·S7 의 응급실 포화 뒤 목적지 변경이 없어졌다
    // (N8 단계 7 뒤 절반) S12 를 더했다 (표본만 넓힌다): 위기자·문 잠긴 집이 짧은 사건에 들어 S1 의 목적지 변경이 없어졌다 — S0~S59 가운데 목적지 변경이 있는 첫 시드
    for (const seed of ['S3', 'S7', 'S1', 'S12']) for (const e of probedShift(seed).sim.events) if (PHRASE.T8.test(e.text)) { n++; expect(sysOf(e)).toBe('hospital'); expect(PHRASE.T8.exec(e.text)![1]).toBe(e.actor); }
    expect(n).toBeGreaterThan(0);
    // 사건이 없는 목적지 변경(다친 대원만 실은 차)은 문제 기록이 아니다 — 문구로 병원을 가린다
    const X: SimEvent[] = [];
    ev(X, -1, 'unit', { actor: '구급2', text: '구급2: 시립병원 포화 소식 — 가온대학교병원으로 목적지 변경.' });
    expect(sysOf(X[0])).toBe('hospital');
  });
  it('T6(결원 운용 중단)이 걸을 수 있는 대원이 남지 않은 부대가 복귀할 때 남는 기록과 맞는다 — 전원 순직 · 남은 대원 모두 병원 이송 · 걸을 수 있는 대원 없음', () => {
    // H1 4b(사용자 결정 2026-11-15): 다쳐도 걸을 수 있으면 부대는 계속 나간다 — '대원 전원 부상으로 운용 중단'은 없어졌다.
    // 사람이 없어 빠지는 부대는 드물어 시드에 기대지 않고 그 상태를 직접 만든다. 기록은 실제 코드(resources.arrive 의 복귀 갈래)가 남긴다
    const arrive = (set: (r: Responder, k: number) => void): { u: Unit; s: Sim } => {
      const s = new Sim('S1', NORMAL, 1200);
      const u = s.units.find((q) => q.kind === 'patrol')!;
      u.crew.forEach((rid, k) => set(s.responders[rid], k));
      u.state = 'returning'; u.destNode = u.homeNode;
      s.step();
      return { u, s };
    };
    const cases: [string, (r: Responder, k: number) => void][] = [
      ['대원 전원 순직 — 운용 중단.', (r) => { r.status = 'down'; r.dead = true; r.health = 0; }],
      ['남은 대원 모두 병원 이송 — 운용 중단.', (r, k) => { if (k === 0) { r.status = 'down'; r.dead = true; r.health = 0; } else { r.status = 'injured'; r.care = 'hospital'; } }],
      ['걸을 수 있는 대원이 없어 운용 중단.', (r) => { r.status = 'down'; r.health = 10; }],
    ];
    for (const [text, set] of cases) {
      const { u, s } = arrive(set);
      expect(u.state, text).toBe('oos');
      const found = s.events.find((e) => PHRASE.T6.test(e.text)) ?? null;
      expect(found, text).not.toBe(null);
      expect(found!.text).toBe(`${u.callsign} ${text}`);
      expect(found!.actor).toBe(u.callsign);
      expect(sysOf(found!)).toBe('crew');
    }
    // 둘 다 다쳤지만 걸을 수 있으면 운용을 멈추지 않는다 (기록 없음)
    const { u, s } = arrive((r) => { r.status = 'injured'; r.health = 55; });
    expect(u.state).toBe('available');
    expect(s.events.some((e) => PHRASE.T6.test(e.text) || /운용 중단/.test(e.text))).toBe(false);
  });
  it('T5(지난 교대에서 이어받은 상태 — I2)가 이어받은 상태로 시작한 교대(보통 S1 이 만든 상태로 S2)의 요약 기록과 맞고, 그 기록의 시스템이 carry 다', () => {
    // 정해진 시드에 이어받은 상태로 시작하는 교대 하나를 더한다 (I2 §8 완료 조건 3): S1 은 이어받은 상태가 없어 맞는 기록이 없다
    const A = probedShift('S1').sim;
    expect(A.events.some((e) => PHRASE.T5.test(e.text)), 'S1 (이어받은 상태 없음)').toBe(false);
    const B = new Sim('S2', NORMAL, 1200, { carry: makeCarryover(A) });
    const m = shiftMetrics(B, runWithProbe(B));
    const hit = B.events.filter((e) => PHRASE.T5.test(e.text));
    expect(hit.length).toBe(1);
    expect(hit[0].id).toBe(B.carryState.event);
    expect(hit[0].incidentId).toBe(-1);
    expect(hit[0].kind).toBe('shift');
    expect(sysOf(hit[0])).toBe('carry');
    // 요약 줄을 원인으로 한 이어받은 상태의 기록(tag 'carry')도 carry 로 센다 — 지금 교대가 쓴 시스템 몫에 carry 칸이 있다
    for (const e of B.events) if ((e as { tag?: string }).tag === 'carry') { expect(sysOf(e), e.text).toBe('carry'); expect(e.causes, e.text).toContain(hit[0].id); }
    expect(typeof summarize([m]).systems.share.carry).toBe('number');
  }, 60000);
  it('태그(I1-b·I2): carry 는 다른 규칙보다 먼저, 표에 없는 태그는 건너뛴다', () => {
    const X: SimEvent[] = [];
    ev(X, 3, 'incident', { tag: 'carry' }); ev(X, -1, 'unit', { tag: 'carry' }); ev(X, 0, 'unit', { tag: 'power' }); ev(X, 0, 'traffic', { tag: '없는 태그' });
    expect(X.map(sysOf)).toEqual(['carry', 'carry', 'infra', 'road']);
  });
});

describe('멈춤 감지기', () => {
  const FORCE = 'medical/faint', SEED = 'S1';
  const findForced = (sim: Sim): Incident | undefined => sim.incidents.find((J) => `${J.truth.type}/${J.truth.variant}` === FORCE && J.createdAt >= 15 && J.createdAt < 16);
  it('첫 도착 직후 모든 대원을 멈추면 60초 넘는 후보가 그 사건에서 나온다', () => {
    const sim = new Sim(SEED, NORMAL, 1200, { force: FORCE });
    const probe = new Probe(sim);
    let T0 = -1, id = -1;
    while (!sim.ended && sim.t < 900) {
      sim.step();
      if (sim.tick % SAMPLE_EVERY !== 0) continue;
      probe.sample();
      if (id < 0) id = findForced(sim)?.id ?? -1;
      if (id >= 0 && T0 < 0 && sim.incidents[id].firstArrivalAt >= 0) {
        T0 = sim.t;
        // 시험 안에서만 일부러 멈춘다: 하던 임무를 지우고 생각하지 않게 한다
        for (const a of sim.scenes[id]!.agents) { a.task = null; a.path = null; a.nextThink = Infinity; }
      }
      if (T0 >= 0 && sim.t >= T0 + 120) break;
    }
    expect(T0).toBeGreaterThan(0);
    expect(sim.incidents[id].phase).toBe('onscene');
    const b = probe.stallBest[id]!;
    expect(b).not.toBe(null);
    expect(b.start).toBeGreaterThanOrEqual(T0);
    expect(b.start).toBeLessThanOrEqual(T0 + 10);
    expect(b.len).toBeGreaterThanOrEqual(STALL_SEC);
    // 같은 교대를 손대지 않고 같은 시각까지 돌리면 그 사건은 후보가 아니다
    const clean = new Sim(SEED, NORMAL, 1200, { force: FORCE });
    const p2 = new Probe(clean);
    while (clean.t < T0 + 120) { clean.step(); if (clean.tick % SAMPLE_EVERY === 0) p2.sample(); }
    expect(p2.stallBest[id]?.len ?? 0).toBeLessThanOrEqual(STALL_SEC);
  });
});

describe('연쇄 깊이', () => {
  it('연쇄 방화가 생기는 교대(fire/arson 강제 S1·S2·S4 가운데 처음 맞는 것)에서 깊이 1 이상', () => {
    let m: ShiftMetrics | null = null;
    for (const seed of ['S1', 'S2', 'S4']) { m = probedShift(seed, NORMAL, 'fire/arson').m; if (m.chained > 0) break; }
    expect(m!.maxParentDepth).toBeGreaterThanOrEqual(1);
    expect(m!.chained).toBeGreaterThanOrEqual(1);
    const s = summarize([m]);
    expect(s.chain.maxParentDepth).toBeGreaterThanOrEqual(1);
    expect(s.chain.parentDepth['1'] + s.chain.parentDepth['2'] + s.chain.parentDepth['3+']).toBeGreaterThanOrEqual(1);
  });
});

describe('일치 검사', () => {
  it('보통 S0~S3 에서 C1~C5 위반 0 (출발 기록의 병원 = 인계한 병원)', () => {
    let pairs = 0;
    for (const seed of ['S0', 'S1', 'S2', 'S3']) {
      const c = probedShift(seed).m.consistency;
      expect([c.C1, c.C2, c.C3, c.C4, c.C5], seed).toEqual([0, 0, 0, 0, 0]);
      pairs += c.C5n;
    }
    expect(pairs, '출발과 인계가 짝지어진 이송').toBeGreaterThan(20);
  });
  it('C5: 출발 문구와 인계 문구의 병원이 다르면 1, 뒤에 인계가 없는 출발은 분자·분모에서 뺀다', () => {
    const X: SimEvent[] = [];
    ev(X, 0, 'unit', { actor: '구급1', text: '구급1 환자 1명 싣고 시립병원으로 출발.' });
    ev(X, 0, 'unit', { actor: '구급2', text: '구급2 환자 1명 싣고 시립병원으로 출발.' });        // 인계 기록 없음
    ev(X, 0, 'casualty', { actor: '구급1', text: '구급1: 가온대학교병원 도착, 환자 1명 인계 완료.' });
    expect(checkC5(X)).toEqual({ bad: 1, n: 1 });
    ev(X, 1, 'unit', { actor: '구급3', text: '구급3 환자 2명 싣고 시립병원으로 출발.' });
    ev(X, 1, 'casualty', { actor: '구급3', text: '구급3: 시립병원 도착, 환자 2명 인계 완료.' });
    expect(checkC5(X)).toEqual({ bad: 1, n: 2 });
    // (I1-b C3) 이송 중 목적지 변경(T8)은 출발로 친다: 출발 시립병원 → 변경 가온대학교병원 → 인계 가온대학교병원 은 위반이 아니다
    ev(X, 2, 'unit', { actor: '구급4', text: '구급4 환자 2명 싣고 시립병원으로 출발.' });
    ev(X, 2, 'problem', { actor: '구급4', problem: 'HOSPITAL_FULL', text: '구급4: 시립병원 포화 소식 — 가온대학교병원으로 목적지 변경.' });
    ev(X, 2, 'casualty', { actor: '구급4', text: '구급4: 가온대학교병원 도착, 환자 2명 인계 완료.' });
    expect(checkC5(X)).toEqual({ bad: 1, n: 3 });
    // 바꾼 뒤에 원래 병원에 인계했으면 위반이다. 환자 0명 출발은 목적지 변경이 있어도 건너뛴다
    ev(X, 3, 'unit', { actor: '구급5', text: '구급5 환자 1명 싣고 시립병원으로 출발.' });
    ev(X, 3, 'problem', { actor: '구급5', problem: 'HOSPITAL_FULL', text: '구급5: 시립병원 포화 소식 — 가온대학교병원으로 목적지 변경.' });
    ev(X, 3, 'casualty', { actor: '구급5', text: '구급5: 시립병원 도착, 환자 1명 인계 완료.' });
    ev(X, 3, 'unit', { actor: '구급6', text: '구급6 환자 0명 싣고 시립병원으로 출발.' });
    ev(X, 3, 'problem', { actor: '구급6', problem: 'HOSPITAL_FULL', text: '구급6: 시립병원 포화 소식 — 가온대학교병원으로 목적지 변경.' });
    ev(X, 3, 'casualty', { actor: '구급6', text: '구급6: 시립병원 도착, 부상 대원 1명 인계 완료.' });
    expect(checkC5(X)).toEqual({ bad: 2, n: 4 });
  });
});

describe('요약 모양', () => {
  const KEYS = ['chain', 'systems', 'replan', 'alt', 'actions', 'contention', 'stall', 'variety', 'consistency', 'hazard'] as const;      // hazard = I1-b b3-4 의 초과 위험 줄
  it('교대 둘의 요약에 열 키가 있고, 글자 줄의 접두어가 고정이다', () => {
    const m = summarize([probedShift('S1').m, probedShift('S4').m]);
    for (const k of KEYS) { expect(typeof m[k], k).toBe('object'); expect(m[k]).not.toBe(null); }
    expect(m.errors).toBe(0);
    expect(m.incidents).toBeGreaterThan(10);
    expect(typeof m.systems.avg).toBe('number');
    expect(typeof m.stall.candidates).toBe('number');
    expect(typeof m.contention.peakBusyAvg).toBe('number');
    const json = metricsJson(m);
    for (const k of KEYS) expect(json[k]).toBeDefined();
    expect(json.errors).toBe(0);
    expect(json.scenarios).toBeUndefined();
    const lines = formatLines(m, false);
    expect(lines.slice(0, 10).map((l) => l.split(':')[0])).toEqual([...KEYS]);
    expect(checkMetrics(m, { baseline: true })).toEqual([]);
  });
  it('shiftMetrics 의 예외(null)는 오류 수에 1', () => {
    expect(summarize([probedShift('S1').m, null]).errors).toBe(1);
  });
  it('checkMetrics 는 상한을 넘긴 값에서 문구를 낸다 (교착 래칫은 보통 기본 조건에서만)', () => {
    const base = summarize([probedShift('S1').m]);
    const bad: MetricsSummary = JSON.parse(JSON.stringify(base));
    bad.errors = 2;
    bad.chain.maxParentDepth = 5; bad.chain.maxChainedInShift = 9;
    bad.consistency.C2 = 1;
    bad.stall.candidates = STALL_ALLOW + 1; bad.stall.forgotten = 1;
    const f = checkMetrics(bad, { baseline: true });
    expect(f.some((x) => x.startsWith('지표 계산 오류 2건'))).toBe(true);
    expect(f.some((x) => x.startsWith('연쇄 깊이 5'))).toBe(true);
    expect(f.some((x) => x.startsWith('한 교대의 연쇄 사건 9건'))).toBe(true);
    expect(f.some((x) => x.startsWith('기록·상태 불일치 C2 1건'))).toBe(true);
    expect(f.some((x) => x.startsWith('교착 후보'))).toBe(true);
    expect(f.some((x) => x.startsWith('잊힌 사건'))).toBe(true);
    const g = checkMetrics(bad, { baseline: false });
    expect(g.some((x) => x.startsWith('교착 후보') || x.startsWith('잊힌 사건'))).toBe(false);
    expect(g.length).toBe(4);
    // (I1-b b5) 조인 관문의 경계: 깊이 3 · 한 교대 6건까지는 통과, 4 · 7 은 걸린다
    const edge: MetricsSummary = JSON.parse(JSON.stringify(base));
    edge.chain.maxParentDepth = 3; edge.chain.maxChainedInShift = 6;
    expect(checkMetrics(edge, { baseline: true })).toEqual([]);
    edge.chain.maxParentDepth = 4; edge.chain.maxChainedInShift = 7;
    expect(checkMetrics(edge, { baseline: true }).sort()).toEqual(['연쇄 깊이 4 > 3', '한 교대의 연쇄 사건 7건 > 6']);
    // C5 도 관문이다 (R1 단계 3 부터): 출발 기록의 병원과 인계한 병원이 다르면 실패
    bad.consistency.C5 = 3;
    expect(checkMetrics(bad, { baseline: false }).some((x) => x.startsWith('기록·상태 불일치 C5 3건'))).toBe(true);
  });
});

// ───────────────────────── I1-b 0단계 (§3.11): 기록만 잇기 — 결과는 그대로, 원인 간선만 생긴다 ─────────────────────────
// 결과 불변 자체는 저장소 밖 해시 목록(보통 40·어려움 20·극한 20·재난 다섯 ×3·강제 연쇄 28 — a1fe68a 와 diff 0)으로 확인했다.
// 여기서는 원인이 실제로 이어졌는지를 본다. 교대는 위에서 이미 돈 것(probedShift)을 다시 쓴다
describe('I1-b 0단계: 기록만 잇기', () => {
  it('연쇄 사건의 발생 기록이 원인을 가리킨다 — 방화는 앞 불의 기록, 은신처·재범·도주 차량은 SUSPECT_FLED', () => {
    // 극한 S1 의 무장 사건 강제 교대에는 달아난 용의자의 재범·도주 차량이 여섯 건 이어진다
    const cases: [string, Difficulty, string | null, string[]][] = [
      // (N8 단계 8·9) 납치 S0 → S5: 구조 유형이 평소 추첨에 들어 S0 의 납치가 은신처로 가지 않게 됐다(은신처 40%) — S0~S7 가운데 은신처가 이어지는 S5·S7 의 앞쪽
      //  평소 S4 → S7: S4 의 연쇄 방화가 없어졌다 — S0~S14 가운데 연쇄 방화가 이어지는 S7
      //  (N8 단계 7 뒤 절반) 평소 S7 → S15: 위기자·문 잠긴 집이 짧은 사건에 들어 S7 의 연쇄 방화가 없어졌다 — S0~S59 가운데 연쇄 방화가 이어지는 첫 시드
      ['S1', NORMAL, 'fire/arson', ['arson']], ['S5', NORMAL, 'armed/kidnap', ['hideout']], ['S15', NORMAL, null, ['arson']], ['S1', parseDifficulty('extreme')!, 'armed/std', ['reoffend', 'getaway', 'hideout']],
    ];
    const seen = new Set<string>();
    for (const [seed, d, force, csqs] of cases) {
      const { sim, m } = probedShift(seed, d, force);
      const kids = sim.incidents.filter((J) => J.parent !== undefined && J.hz === undefined);      // 이야기 연쇄만 — 법칙이 낸 사건(I.hz — 원인이 몫마다 여럿일 수 있다)은 tests/hazard.test.ts 가 본다
      expect(kids.length, seed).toBeGreaterThan(0);
      for (const J of kids) {
        expect(csqs, `${seed} #${J.code}`).toContain(J.csq);
        seen.add(J.csq!);
        expect(J.cause).toBeGreaterThanOrEqual(0);
        expect(sim.events[J.rootEvent].causes).toEqual([J.cause]);
        const c = sim.events[J.cause!];
        expect(c.incidentId).toBe(J.parent);
        if (J.csq !== 'arson') expect(c.problem).toBe('SUSPECT_FLED');
      }
      expect(m.crossLinks, seed).toBeGreaterThan(0);
    }
    expect(seen.has('reoffend') || seen.has('getaway'), '달아난 용의자의 연쇄').toBe(true);
    // 연쇄가 아닌 사건에는 원인·연쇄 이름이 없다
    expect(probedShift('S2').sim.incidents.every((J) => J.cause === undefined && J.csq === undefined)).toBe(true);
  });
  it('재난이 일으킨 사건은 마지막 재난 알림을 원인으로 (부모는 두지 않는다) — 세계 → 사건 간선', () => {
    const { sim, m } = probedShift('S2', QUAKE);
    const dis = sim.incidents.filter((J) => J.tag?.startsWith('disaster:'));
    expect(dis.length).toBeGreaterThan(0);
    for (const J of dis) {
      expect(J.parent).toBe(undefined);
      const c = sim.events[J.cause!];
      expect([c.incidentId, c.kind, sysOf(c)]).toEqual([-1, 'hazard', 'disaster']);
      expect(sim.events[J.rootEvent].causes).toEqual([J.cause]);
    }
    const last = sim.events[sim.disaster!.lastEv];
    expect([last.kind, last.incidentId]).toEqual(['hazard', -1]);
    expect(m.worldLinks).toBeGreaterThan(0);
  });
  it('전환 배정(DIVERTED)은 받는 사건의 마지막 기록을 원인으로, ref 에 받는 사건·부대 (바로 뒤 출동 지령의 사건과 같다)', () => {
    let n = 0;
    for (const seed of ['S0', 'S3', 'S7']) {
      const { sim } = probedShift(seed);
      for (const J of sim.incidents) for (const p of J.problems) if (p.code === 'DIVERTED') {
        n++;
        const inc = p.ref!.inc!;
        expect(inc).not.toBe(J.id);
        expect(sim.units[p.ref!.unit!]).toBeDefined();
        expect(sim.events[p.eventId].causes.some((c) => sim.events[c].incidentId === inc)).toBe(true);
        const next = sim.events.find((e) => e.id > p.eventId && e.kind === 'dispatch' && e.role === 'DISPATCH')!;
        expect(next.incidentId).toBe(inc);
        expect(next.text.startsWith(`출동 지령: ${sim.units[p.ref!.unit!].callsign} →`)).toBe(true);
      }
    }
    expect(n).toBeGreaterThan(0);
  });
  it('부족(NO_UNIT)은 그 능력의 부대를 잡고 있던 사건(blockedBy)과 그 사건의 출동 지령을 원인으로', () => {
    let withBlk = 0;
    for (const seed of ['S0', 'S3', 'S7']) {
      const { sim } = probedShift(seed);
      for (const I of sim.incidents) {
        expect(I.blockedBy?.includes(I.id) ?? false).toBe(false);
        for (const p of I.problems) if (p.code === 'NO_UNIT' && p.ref?.inc !== undefined) {
          withBlk++;
          expect(I.blockedBy).toContain(p.ref.inc);
          const cs = sim.events[p.eventId].causes.map((c) => sim.events[c]);
          expect(cs.some((e) => e.kind === 'dispatch' && I.blockedBy!.includes(e.incidentId))).toBe(true);
        }
      }
    }
    expect(withBlk).toBeGreaterThan(0);
  });
  it('결원으로 운용을 멈춘 부대: ref.unit 과 그 부대의 운용 중단 기록(T6)이 부족의 원인 (blockersOf)', () => {
    const s = new Sim('S1', NORMAL, 1200);
    for (let k = 0; k < 5; k++) s.step();
    const ems = s.units.filter((u) => u.dept === 'ems' && !u.air && !u.sea);
    const [e1, ...rest] = ems;
    expect(rest.length).toBeGreaterThan(0);
    // e1: 대원 전원 순직 뒤 복귀 → 실제 코드(resources.arrive)가 운용 중단 기록을 남긴다. oosEv(마지막 부상·순직 기록, H1)는 시험에서 정해 둔다
    e1.oosEv = 0;
    for (const rid of e1.crew) { const r = s.responders[rid]; r.status = 'down'; r.dead = true; r.health = 0; }
    e1.state = 'returning'; e1.destNode = e1.homeNode;
    s.step();
    expect(e1.state).toBe('oos');
    const rec = s.events.find((e) => PHRASE.T6.test(e.text) && e.actor === e1.callsign)!;
    expect(rec.causes).toEqual([0]);
    const I = createIncident(s, { type: 'medical' }), J = createIncident(s, { type: 'fire' });
    const order = emit(s, { inc: J.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', text: '출동 지령: 시험' });
    J.dispatchLog.push(order);
    for (const u of rest) { u.incidentId = J.id; u.state = 'enroute'; }
    const why = blockersOf(s, I, ['ems']);
    expect(I.blockedBy).toEqual([J.id]);
    expect(why.ref).toEqual({ inc: J.id, unit: e1.id });
    expect(why.causes).toContain(order);
    expect(why.causes).toContain(rec.id);
  });
  it('통제를 만난 출동(ROUTE_BLOCKED)은 막은 사건의 통제 기록을, 늦은 도착(TRAFFIC_DELAY)은 그 ROUTE_BLOCKED 를 원인으로', () => {
    // 평소 교대에서는 대개 자기 사건의 통제를 만난다(알려진 통제는 경로가 처음부터 피한다 — 사건 사이의 경우는 아래 시험이 만든다)
    let own = 0, td = 0;
    // (N8 단계 4a·4b) S0 → S5·S7: 시설 사고가 짧은 사건에 들어 S0 의 가스 누출 현장이 무너지며 남긴 건물 잔해(I1-b C2 — 장애물의 기록으로 잇는 갈래, 막은 사건의 blockedEdge 가 없다)에 부대가 되돌아섰다
    // (N8 단계 6a) S11·S12 를 더했다 (표본만 넓힌다): 경찰 새 부대 셋이 편성돼 S1·S3·S5·S7 에서 자기 사건의 통제를 만난 출동이 없어졌다
    // (N8 단계 8·9) S3 → S13: 구조 유형이 평소 추첨에 들어 S3 의 건물 화재가 무너지며 남긴 잔해(C2 — 장애물의 기록으로 잇는 갈래, 막은 사건의 blockedEdge 가 아니다)가 제 부대의 길을 막았다
    // (N8 단계 10) S13 → S14 · S7 → S18: 중복 신고·조건부 연쇄가 들어 S13·S7 의 건물 화재가 무너지며 남긴 잔해(C2 — 장애물의 기록으로 잇는 갈래)가 다시 부대의 길을 막았다 (S14~S18 을 훑어 그런 갈래가 없는 것)
    for (const seed of ['S1', 'S14', 'S5', 'S18', 'S11', 'S12']) {
      const { sim } = probedShift(seed);
      for (const I of sim.incidents) for (const p of I.problems) {
        if (p.code === 'ROUTE_BLOCKED') {
          expect(sim.units[p.ref!.unit!]).toBeDefined();
          expect(p.ref!.edge).toBeGreaterThanOrEqual(0);
          if (p.ref!.inc !== undefined) {
            const J = sim.incidents[p.ref!.inc];
            expect(J.blockedEdge).toBe(p.ref!.edge);
            expect(sim.events[J.blockEv!].kind).toBe('traffic');
            expect(sim.events[p.eventId].causes).toContain(J.blockEv);
            own++;
          }
        }
        if (p.code === 'TRAFFIC_DELAY') {
          const cs = sim.events[p.eventId].causes;
          if (!cs.length) continue;
          td++;
          const rb = I.problems.find((q) => q.eventId === cs[0])!;
          expect(rb.code).toBe('ROUTE_BLOCKED');
          expect([rb.ref!.unit, rb.ref!.edge, rb.ref!.inc]).toEqual([p.ref!.unit, p.ref!.edge, p.ref!.inc]);
        }
      }
    }
    expect(own, '사건의 통제를 만난 출동').toBeGreaterThan(0);
    expect(td, 'ROUTE_BLOCKED 를 이어받은 TRAFFIC_DELAY').toBeGreaterThan(0);
  });
  it('다른 사건이 막은 구간: 출동 중인 부대의 ROUTE_BLOCKED 가 그 사건과 통제 기록을 가리킨다 (만든 상황 — 사건 사이 간선)', () => {
    const s = new Sim('S0', NORMAL, 1200);
    let u: Unit | undefined;
    while (!u && s.t < 600) {
      s.step();
      u = s.units.find((q) => q.state === 'enroute' && !q.air && !q.sea && q.incidentId !== null && q.pendingDest === null && q.route !== null && q.route.edges.length - q.seg >= 3
        && findRoute(s.city, s.city.edges[q.route.edges[q.seg + 1]].a, s.city.edges[q.route.edges[q.seg + 1]].b, 1, q.route.edges[q.seg + 1]) !== null);
    }
    expect(u).toBeDefined();
    const e = s.city.edges[u!.route!.edges[u!.seg + 1]];
    // 다른 사건 J 가 부대의 다음 다음 구간을 막는다 (sceneManager 6) 블록의 전면 통제와 같은 상태·같은 기록)
    const J = createIncident(s, { type: 'medical' });
    J.blockedEdge = e.id; e.closed = true; e.closedReason = 'incident';
    J.blockEv = emit(s, { inc: J.id, role: 'SYSTEM', actor: '교통정보', kind: 'traffic', imp: 0, text: '시험 구간 전면 통제.' });
    const I = s.incidents[u!.incidentId!], before = I.problems.length;
    for (let k = 0; k < 1500 && !I.problems.slice(before).some((p) => p.code === 'ROUTE_BLOCKED'); k++) s.step();
    const p = I.problems.slice(before).find((q) => q.code === 'ROUTE_BLOCKED')!;
    expect(p).toBeDefined();
    expect(p.ref).toEqual({ inc: J.id, unit: u!.id, edge: e.id });
    expect(s.events[p.eventId].causes).toContain(J.blockEv);
    expect(linkCounts(s.events, s.events.map(sysOf)).cross).toBeGreaterThan(0);
  });
  it('버린 예약은 gen.dropped 에만 남는다 — 교대 끝 150초 안(late)·열린 사건이 많을 때(busy). 기록은 남기지 않는다', () => {
    const late = new Sim('S2', NORMAL, 200);
    late.gen.chain.push({ at: 60, opts: { type: 'fire', note: '시험 예약' } });
    while (late.t < 62) late.step();
    expect(late.gen.dropped.length).toBe(1);
    expect(late.gen.dropped[0]).toMatchObject({ why: 'late', type: 'fire' });
    expect(late.events.some((e) => e.text.startsWith('시험 예약'))).toBe(false);
    expect(genDropped(late)).toBe(1);
    const busy = new Sim('S2', NORMAL, 1200);
    busy.tune.maxConcurrent = -1;
    busy.gen.chain.push({ at: 1, opts: { type: 'medical', parent: 0, note: '시험 예약' } });
    while (busy.t < 2) busy.step();
    expect(busy.gen.dropped).toEqual([{ t: busy.gen.dropped[0].t, why: 'busy', type: 'medical', variant: undefined, parent: 0 }]);
    expect(busy.events.some((e) => e.text.startsWith('시험 예약'))).toBe(false);
    // 측정 도구의 dropped 는 이 배열의 길이다 (표본의 근사는 droppedApprox)
    const m = probedShift('S1').m;
    expect(m.dropped).toBe(genDropped(probedShift('S1').sim));
  });
  it('지휘관의 지시는 그 일을 낳은 사실을 실어 온 무전 기록을 원인으로 (want 의 cause → 지시 무전의 causes)', () => {
    const { sim } = probedShift('S0');
    let n = 0;
    for (const I of sim.incidents) {
      const s = sim.scenes[I.id];
      if (!s) continue;
      for (const w of s.board) if (w.cause >= 0) {
        n++;
        const ce = sim.events[w.cause];
        // 대원의 무전, 또는 현장 자체가 무전 자료로 알린 기록(SYSTEM — 스스로 대피해 안전 구역에 닿은 사람 'casualty' 등, hazards.ts)
        if (ce.kind !== 'radio') expect(ce.role, ce.text).toBe('SYSTEM');
        expect(ce.incidentId).toBe(I.id);
        expect(ce.t).toBeLessThanOrEqual(w.createdAt);
      }
    }
    expect(n).toBeGreaterThan(0);
    expect(sim.events.some((e) => e.kind === 'command' && e.role === 'COMMANDER' && e.causes.some((c) => sim.events[c].kind === 'radio'))).toBe(true);
    // mergeHeard: 실제로 저장된 사실만 그 무전을 기억한다 (더 오래된 소식은 합쳐지지 않으므로 앞의 기록이 남는다)
    const B = new BeliefStore();
    mergeHeard(B, mkFact('evid', 3, { kind: 'witness', done: false }, '시험', 10, 0.9, true, '목격자'), 7);
    expect(heardEv(B.get('evid', 3))).toBe(7);
    mergeHeard(B, mkFact('evid', 3, { kind: 'witness', done: true }, '시험', 5, 0.9, true, '목격자'), 9);
    expect(heardEv(B.get('evid', 3))).toBe(7);
    B.merge(mkFact('evid', 3, { kind: 'witness', done: true }, '시험', 20, 0.9, true, '목격자'));      // 직접 본 새 소식: 무전이 아니다
    expect(heardEv(B.get('evid', 3))).toBe(-1);
    expect(heardEv(undefined)).toBe(-1);
  });
});

// ───────────────────────── I1-b 1단계 (§3.11): 어긋난 기록 고치기 — 재범이 생긴 교대의 해시가 바뀐다 ─────────────────────────
// 이송 출발 문구의 병원은 R1 단계 3 이 고쳤다 — C5 = 0 과 관문은 위의 '일치 검사'·'요약 모양' 이 본다.
describe('I1-b 1단계: 어긋난 기록 고치기', () => {
  it('재범은 자기 흐름(reoffend:<사건>:<용의자>)으로 만든다 — 평소 생성기의 다음 사건이 달라지지 않는다', () => {
    // 예약하는 자리(hazards 의 도주 블록)가 새 흐름을 넘긴다
    const line = readFileSync('src/sim/field/hazards.ts', 'utf8').split('\n').find((l) => l.includes("csq: 'reoffend'"))!;
    expect(line).toContain("rng: sim.rng.fork('reoffend:' + I.id + ':' + h.id)");
    // 그 흐름으로 만든 재범은 평소 생성기(sim.rngGen·gen.lastType)를 건드리지 않는다: 바로 다음 평소 사건의 유형·변형·규모가 재범이 없을 때와 같다
    const a = new Sim('S5', NORMAL, 1200), b = new Sim('S5', NORMAL, 1200), old = new Sim('S5', NORMAL, 1200);
    const P = createIncident(a); createIncident(b); createIncident(old);
    createIncident(a, { type: 'armed', variant: 'robbery', parent: P.id, rng: a.rng.fork('reoffend:' + P.id + ':0') });
    createIncident(old, { type: 'armed', variant: 'robbery', parent: P.id });      // 예전 방식: 평소 흐름으로 만들고 lastType 을 고친다
    expect(a.gen.lastType).toBe(b.gen.lastType);
    expect(old.gen.lastType).toBe('armed');
    const key = (I: Incident): string => `${I.truth.type}/${I.truth.variant}/${I.truth.severity}`;
    const na = [createIncident(a), createIncident(a), createIncident(a)].map(key), nb = [createIncident(b), createIncident(b), createIncident(b)].map(key);
    const no = [createIncident(old), createIncident(old), createIncident(old)].map(key);
    expect(na).toEqual(nb);
    expect(no).not.toEqual(nb);
  });
  it('연쇄 깊이 상한: chainDepth 는 뿌리 0, 상한의 정본은 canChain — 깊이 DEPTH_MAX 인 사건을 부모로 한 예약은 꺼낼 때 버린다 (depth)', () => {
    const s = new Sim('S2', NORMAL, 1200);
    const A = createIncident(s, { type: 'medical' });
    const B = createIncident(s, { type: 'medical', parent: A.id, rng: s.rng.fork('t1') });
    const C = createIncident(s, { type: 'medical', parent: B.id, rng: s.rng.fork('t2') });
    expect([chainDepth(s, A.id), chainDepth(s, B.id), chainDepth(s, C.id)]).toEqual([0, 1, 2]);
    expect(DEPTH_MAX).toBe(CHAIN_MAX - 1);
    expect([canChain(s, B), canChain(s, C)]).toEqual([true, false]);
    // canChain 을 보지 않고 예약한 것 둘: 깊이가 넘는 것은 버리고(기록 없이 gen.dropped 에만), 넘지 않는 것은 일으킨다
    s.gen.chain.push({ at: 1, opts: { type: 'medical', parent: C.id, note: '시험 예약', rng: s.rng.fork('t3') } });
    s.gen.chain.push({ at: 1, opts: { type: 'medical', parent: B.id, note: '시험 예약 둘', rng: s.rng.fork('t4') } });
    while (s.t < 3) s.step();
    expect(s.gen.dropped).toEqual([{ t: s.gen.dropped[0].t, why: 'depth', type: 'medical', variant: undefined, parent: C.id }]);
    expect(s.incidents.some((J) => J.parent === C.id)).toBe(false);
    expect(s.events.some((e) => e.text.startsWith('시험 예약 —'))).toBe(false);
    expect(s.incidents.filter((J) => J.parent === B.id).length).toBe(2);
    // 측정 도구의 parentDepth 와 같은 정의다
    const m = probedShift('S1', NORMAL, 'fire/arson');
    for (const J of m.sim.incidents) expect(chainDepth(m.sim, J.id)).toBeLessThanOrEqual(DEPTH_MAX);
    expect(m.m.maxParentDepth).toBe(Math.max(...m.sim.incidents.map((J) => chainDepth(m.sim, J.id))));
  });
});

// ───────────────────────── I1-b b2 (§3.3~§3.6): 세계 상태·신호·인과 규칙의 틀 — 규칙이 없으면 결과는 그대로 ─────────────────────────
// 결과 불변 자체는 저장소 밖 해시 목록(123교대 — b1 끝과 diff 0)으로 확인했다. 여기서는 틀이 하는 일을 본다.
// 규칙을 등록하는 시험은 자기 Sim 만 돌리고 끝에 반드시 거둔다(registerConsequence 가 돌려준 함수) — 등록은 이 파일 안의 모든 Sim 에 걸린다.
describe('I1-b b2: 세계 상태와 인과 규칙의 틀', () => {
  /** 교대를 끝까지 돌리며 틱마다 그 틱에 보낸 신호를 모은다 (세계 틱이 다음 틱에 비우기 전에 읽는다 — 읽기만) */
  function runCollect(sim: Sim): Signal[] {
    const all: Signal[] = [];
    let n = 0;
    while (!sim.ended && n++ < 20000) { sim.step(); for (const g of sim.world.signals) { expect(g.t).toBe(sim.t); all.push(g); } }
    return all;
  }
  it('세계 상태는 걸린 규칙이 바꾼 것 말고는 처음 값 그대로이고, 신호는 상태를 바꾼 자리에서 그 기록과 함께 간다 (보통 S6)', () => {
    const sim = new Sim('S6', NORMAL, 1200);      // (N8 단계 4a·4b) 시설 사고 유형이 추첨에 들어 S3 에 법칙 사건이 생겼다 — 같은 조건(연기 알림 · 규칙이 만든 사건 없음)의 S6 으로
    const fresh = JSON.stringify(initWorld(sim));
    expect(sim.world.zones.length).toBe(DISTRICTS.length);
    expect(sim.world.hospitals.length).toBe(sim.city.facilities.filter((f) => f.kind === 'hospital').length);
    expect(sim.world.hospitals.length).toBeGreaterThan(0);
    for (const h of sim.world.hospitals) expect(sim.city.facilities[h.fac].kind).toBe('hospital');
    const sigs = runCollect(sim);
    // 결과는 신호를 읽지 않고 돈 교대와 같다
    expect(sim.report!.hash).toBe(probedShift('S6').sim.report!.hash);
    // 세계 상태: 걸린 규칙이 바꾼 것(응급실 체류 — C3) 말고는 처음 값이다. 구역은 건드리는 규칙이 없고, 규칙이 만든 사건도 없다 (끝난 틱에 닫힌 사건의 신호는 처리되지 않고 남는다)
    const w0 = JSON.parse(fresh);
    // (b3-11 C5) 큰 불이 45초 넘게 이어지면 연기가 동네를 덮는다(국지 구역 값 'smoke') — 교대 끝에 걷히지 않은 연기만 남고, 그 밖의 칸은 처음 값이다
    const noSmoke = (zs: ZoneState[]): string => JSON.stringify(zs.map((Z) => ({ ...Z, smoke: 0, until: { ...Z.until, smoke: 0 }, known: { ...Z.known, smoke: false }, cause: { ...Z.cause, smoke: -1 }, at: undefined })));
    expect(noSmoke(sim.world.zones)).toBe(noSmoke(w0.zones));
    for (const Z of sim.world.zones) {
      if (Z.smoke === 0) { expect([Z.cause.smoke, Z.known.smoke, Z.at?.smoke]).toEqual([-1, false, undefined]); continue; }
      expect(sim.events[Z.cause.smoke].tag, '연기의 원인 = 그 연기 알림').toBe('smoke');
      expect(sim.world.spans.some((q) => q.f === 'smoke' && q.cause === Z.cause.smoke), '걷히지 않은 연기는 장부 줄이 있다').toBe(true);
    }
    expect(sim.events.some((e) => e.tag === 'smoke'), 'S6 에는 45초 넘게 이어진 큰 불이 있다').toBe(true);
    expect(sim.world.spawned).toBe(0);
    // (b3-4) 초과 위험·건물 노출의 칸은 법칙·상태 규칙이 걸리지 않으면 처음 값 그대로다.
    // (b3-6) 등록된 법칙 L1 — 초과 혼잡이 있던 구간에만 칸이 생긴다(평소 교대에도 정체·공사·사고의 밀림이 있다). 교대가 끝나면 기다리는 줄도 구멍도 없다
    // (b3-7) L2 — 큰 불(불 요약 10 이상) 곁의 건물에만 칸이 생긴다.
    // (b3-8) 이웃 노출(world.expo)은 충격(폭발·전체 붕괴·무너진 채 시작한 사건)이 있던 교대에만 생긴다 — 상태 규칙 shockSpread 가 흔든 건물만, 손상은 0 보다 크다
    // (b3-11) L4 — 연기(C5)가 덮은 자리의 주거 건물(평소 응급률이 있는 종류)에만 칸이 생긴다
    expect(w0.hz.cells).toEqual({});
    expect(Object.keys(sim.world.hz.cells).filter((k) => k !== 'roadCrash' && k !== 'heatSpread' && k !== 'smokeIll')).toEqual([]);
    for (const id of Object.keys(sim.world.hz.cells.smokeIll ?? {})) { const q = sim.city.places[+id]; expect(q?.open, `건물 ${id}`).toBe(false); expect(smokeBase(sim, q.kind), `건물 ${id}`).toBeGreaterThan(0); }
    for (const id of Object.keys(sim.world.hz.cells.roadCrash ?? {})) expect(sim.city.edges[+id], `구간 ${id}`).toBeDefined();
    for (const id of Object.keys(sim.world.hz.cells.heatSpread ?? {})) expect(sim.city.places[+id]?.open, `건물 ${id}`).toBe(false);
    expect([sim.world.hz.waiting, sim.world.hz.holes, sim.world.sills, sim.world.spans.filter((q) => q.f !== 'smoke')]).toEqual([[], 0, {}, []]);
    for (const q of sim.world.spans) expect(sim.world.zones.some((Z) => Z.cause.smoke === q.cause), '연기 줄은 걷히지 않은 연기의 것뿐').toBe(true);
    const shook = sim.world.log.some((l) => l.rule === 'shockSpread');
    for (const [id, ex] of Object.entries(sim.world.expo)) { expect(shook, `건물 ${id} 의 노출 — 충격이 있던 교대만`).toBe(true); expect(sim.city.places[+id]?.open).toBe(false); expect(ex.shake).toBeGreaterThan(0); }
    const LAWS = ['roadCrash', 'heatSpread', 'smokeIll'];
    expect(sim.world.log.every((l) => l.rule === 'hospitalLoad' || l.rule === 'rubbleRoad' || l.rule === 'shockSpread' || LAWS.indexOf(l.rule) >= 0), '기록되는 규칙은 포화·잔해·충격 손상, 법칙은 몰린 길의 사고·옮겨붙은 불뿐 (응급실 체류는 줄을 남기지 않는다)').toBe(true);
    expect(sim.world.log.every((l) => l.made === -1 || (LAWS.indexOf(l.rule) >= 0 && sim.incidents[l.made]?.csq === l.rule)), '사건을 만드는 것은 법칙뿐').toBe(true);
    expect(sim.world.signals.length).toBeLessThan(40);
    // 종료: 닫힌 사건마다 하나, 그 종료 기록과 함께
    const closed = sigs.filter((g) => g.kind === 'closed');
    expect(closed.map((g) => g.inc).sort((a, b) => a - b)).toEqual(sim.incidents.filter((I) => I.phase === 'closed').map((I) => I.id));
    for (const g of closed) { const e = sim.events[g.ev]; expect([e.kind, e.incidentId, e.actor]).toEqual(['resolve', g.inc, '사건 관리']); expect(g.place).toBe(sim.incidents[g.inc].truth.placeId); }
    // 병원 인계: 인계 기록(T4)마다 하나 — 병원 시설·그 자리, 산 환자 수
    const del = sigs.filter((g) => g.kind === 'delivered');
    expect(del.length).toBe(sim.events.filter((e) => PHRASE.T4.test(e.text)).length);
    expect(del.length).toBeGreaterThan(3);
    for (const g of del) {
      const e = sim.events[g.ev], f = sim.city.facilities[g.place];
      expect(PHRASE.T4.test(e.text)).toBe(true);
      expect(f.kind).toBe('hospital');
      expect(e.text).toContain(f.name);
      expect([g.x, g.y]).toEqual([f.x, f.y]);
      const m = /환자 (\d+)명/.exec(e.text);
      expect(g.data).toBe(m ? Number(m[1]) : 0);
    }
    // 그 밖의 신호: 자리는 도시 좌표(그 사건의 자리), 기록은 그 사건의 것
    for (const g of sigs) {
      if (g.kind === 'closed' || g.kind === 'delivered') continue;
      const I = sim.incidents[g.inc], e = sim.events[g.ev];
      expect(e.incidentId, g.kind).toBe(I.id);
      if (I.pursuit === undefined) expect([g.x, g.y], g.kind).toEqual([I.truth.x, I.truth.y]);
      // 폭발은 지휘관이 그 위험을 알았는가로 기록 코드가 갈린다(catastrophe.ts — 몰랐으면 HIDDEN_HAZARD). 그 경우는 X6 의 폭발 글귀(X6_BOOM_DETAIL)인 기록이어야 한다
      // (N8 단계 6a — 경찰 새 부대 셋이 편성돼 S6 에 지휘관이 모르던 가스 폭발이 생겼다)
      if (g.kind === 'catastrophe') {
        if (e.problem === 'HIDDEN_HAZARD') expect(X6_BOOM_DETAIL.test(I.problems.find((q) => q.eventId === e.id)!.detail), g.kind).toBe(true);
        else expect(['EXPLOSION', 'STRUCT_COLLAPSE', 'BURNOUT']).toContain(e.problem);
      }
      if (g.kind === 'fled') { expect(e.problem).toBe('SUSPECT_FLED'); expect(sim.scenes[I.id]!.hostiles[g.data].weapon).toBe('gun'); }
      if (g.kind === 'fireBig') expect(g.size).toBeGreaterThanOrEqual(FIRE_BIG);
    }
    const big = sigs.filter((g) => g.kind === 'fireBig').map((g) => g.inc);
    expect(new Set(big).size, '큰 불 신호는 현장마다 한 번').toBe(big.length);
  });
  it('붕괴·폭발의 신호: 무너진 채 시작하는 사건은 발생 기록과 함께, 폭발은 X6·폭파 진입·무너져 내린 것이 아닐 때만', () => {
    const sim = new Sim('S1', NORMAL, 1200, { force: 'collapse/gasblast' });
    let I: Incident | undefined;
    while (!I && sim.t < 30) { sim.step(); I = sim.incidents.find((J) => J.truth.variant === 'gasblast'); }
    expect(I).toBeDefined();
    const g = sim.world.signals.find((q) => q.kind === 'collapse')!;
    expect(g).toBeDefined();
    expect([g.inc, g.ev, g.place]).toEqual([I!.id, I!.rootEvent, I!.truth.placeId]);
    const scene = sim.scenes[I!.id]!;
    let fell = 0;
    for (let i = 0; i < scene.damage.length; i++) if (scene.damage[i]) fell++;
    expect(g.size).toBe(fell);
    expect(g.size).toBeGreaterThan(0);
    sim.step();
    expect(sim.world.signals.some((q) => q.kind === 'collapse')).toBe(false);      // 다음 틱의 세계 틱이 비웠다
    // 승강기 갇힘은 무너진 것이 아니다 — 신호가 없다
    const lift = createIncident(sim, { type: 'collapse', variant: 'elevator', rng: sim.rng.fork('t-lift') });
    expect(sim.world.signals.some((q) => q.kind === 'collapse' && q.inc === lift.id)).toBe(false);
    // 폭발: 기본(폭발물)만 신호를 보낸다 — 계획된 폭파(planned)·X6 의 폭발(noSignal)·무너져 내린 것(crush)은 보내지 않는다
    const ev0 = emit(sim, { inc: I!.id, role: 'SYSTEM', actor: '시험', kind: 'hazard', text: '시험 폭발.', truth: true });
    const before = sim.world.signals.length;
    blast(sim, scene, I!, 1, 1, 2, 0, ev0, 'blast', true);
    blast(sim, scene, I!, 1, 1, 2, 0, ev0, 'blast', false, true);
    blast(sim, scene, I!, 1, 1, 2, 0, ev0, 'crush');
    expect(sim.world.signals.filter((q) => q.kind === 'blast').length).toBe(0);
    expect(sim.world.signals.length).toBeGreaterThanOrEqual(before);
    blast(sim, scene, I!, 1, 1, 2, 0, ev0);
    const b = sim.world.signals.filter((q) => q.kind === 'blast');
    expect(b.length).toBe(1);
    expect([b[0].inc, b[0].ev, b[0].size, b[0].cx, b[0].cy, b[0].x, b[0].y, b[0].place]).toEqual([I!.id, ev0, 2, 1, 1, I!.truth.x, I!.truth.y, I!.truth.placeId]);      // 자리·건물은 signal 이 그 사건에서 채운다
    // 사건 목록에 없는 사건(현장만 만든 시험 — tests/destruction 의 방)으로 불러도 신호는 그 사건의 진실을 읽지 않는다: 자리·건물 -1
    blast(sim, scene, { id: 9999 } as never, 1, 1, 2, 0, -1);
    const lone = sim.world.signals[sim.world.signals.length - 1];
    expect([lone.kind, lone.inc, lone.x, lone.y, lone.place]).toEqual(['blast', 9999, -1, -1, -1]);
  });
  it('규칙의 발동: 열쇠·쿨다운·교대 상한·시도 번호의 난수 흐름 — 한 틱에는 쌓여 있던 신호만 처리한다', () => {
    const s = new Sim('S9', NORMAL, 1200);
    const rolls: number[] = [], keys: string[] = [];
    let ticks = 0;
    const off = [
      registerConsequence({ id: 't-fire', label: '시험 규칙', on: ['blast'], key: (_s, sig) => (sig!.data === 9 ? null : 'k' + sig!.data), cooldown: 30, cap: 3, spawns: false,
        test: (c) => { rolls.push(c.rng.next()); return c.sig!.size > 0; },
        apply: (c) => { keys.push(c.key); signal(c.sim, 'blast', { inc: -1, ev: -1, data: 5, size: 1 }); } }),      // 규칙이 보낸 신호는 다음 틱에
      registerConsequence({ id: 't-tick', label: '시험 틱 규칙', on: 'tick', key: () => 'all', cooldown: 0, cap: 99, spawns: false, test: () => { ticks++; return false; }, apply: () => { throw new Error('조건이 거짓이면 부르지 않는다'); } }),
    ];
    try {
      const send = (data: number, size: number): void => signal(s, 'blast', { inc: -1, ev: -1, data, size });
      send(1, 1); send(1, 1); send(2, 0); send(9, 1);
      signal(s, 'closed', { inc: -1, ev: -1 });      // 받는 규칙이 없는 종류
      tickWorld(s);
      expect(keys).toEqual(['k1']);                                   // 둘째 k1 은 쿨다운, k2 는 조건이 거짓, 9 는 해당 없음
      expect(s.world.count).toEqual({ 't-fire': 1 });
      expect(s.world.tries).toEqual({ 't-fire|k1': 1, 't-fire|k2': 1 });      // 쿨다운에 걸린 것은 시도로 세지 않는다
      expect(s.world.log).toEqual([{ rule: 't-fire', t: s.t, ev: -1, inc: -1, made: -1, depth: 0 }]);
      expect(s.world.signals.map((g) => g.data)).toEqual([5]);          // 규칙이 방금 보낸 신호만 남았다
      expect(rolls).toEqual([s.rng.fork('csq:t-fire:k1:1').next(), s.rng.fork('csq:t-fire:k2:1').next()]);
      tickWorld(s);                                                    // 다음 틱: k5 가 걸리고, 그것이 보낸 신호는 또 다음 틱에
      expect(keys).toEqual(['k1', 'k5']);
      tickWorld(s);                                                    // k5 는 쿨다운 — 신호가 끝없이 이어지지 않는다
      expect(keys).toEqual(['k1', 'k5']);
      expect(s.world.signals.length).toBe(0);
      // 시도 번호: 조건이 거짓이었던 열쇠를 다시 보면 다른 흐름의 난수다 (같은 이름의 fork 는 같은 수열이므로)
      send(2, 0); tickWorld(s);
      expect(rolls[rolls.length - 1]).toBe(s.rng.fork('csq:t-fire:k2:2').next());
      expect(rolls[rolls.length - 1]).not.toBe(s.rng.fork('csq:t-fire:k2:1').next());
      // 쿨다운이 지나면 다시, 교대 상한(3)까지만
      s.t = 31; send(1, 1); tickWorld(s); tickWorld(s);
      expect(keys).toEqual(['k1', 'k5', 'k1']);
      send(7, 1); tickWorld(s);
      expect(keys.length).toBe(3);
      expect(s.world.count['t-fire']).toBe(3);
      // world tick 규칙은 1초에 한 번(tick % 5 === 1)
      expect(ticks).toBe(0);
      s.tick = 6; tickWorld(s); s.tick = 7; tickWorld(s);
      expect(ticks).toBe(1);
      expect(s.world.tries['t-tick|all']).toBe(1);
    } finally { for (const f of off) f(); }
    // 거둔 뒤에는 걸리지 않는다
    signal(s, 'blast', { inc: -1, ev: -1, data: 3, size: 1 }); s.t = 99; s.tick = 8; tickWorld(s);
    expect(keys.length).toBe(3);
    expect(s.world.signals.length).toBe(0);
  });
  it('spawnConsequence: 자기 흐름으로 예약하고 원인·연쇄 이름을 잇는다 — 깊이·상한에 걸리면 gen.dropped 에만 (기록 없음)', () => {
    const s = new Sim('S2', NORMAL, 1200);
    const A = createIncident(s, { type: 'medical' });
    const off = registerConsequence({ id: 't-spawn', label: '시험 연쇄', on: ['blast'], key: (_s, sig) => 'inc:' + sig!.inc, cooldown: 0, cap: 99, spawns: true, test: () => true,
      apply: (c) => { expect(spawnConsequence(c.sim, c, { type: 'medical', parent: c.sig!.inc, note: '시험 연쇄' }, [1, 2])).toBe(true); } });
    try {
      const kidOf = (P: Incident): Incident | undefined => s.incidents.find((J) => J.parent === P.id);
      const lastType = s.gen.lastType;
      signal(s, 'blast', { inc: A.id, ev: A.rootEvent });
      s.step();
      expect(s.gen.chain.length).toBe(1);
      expect(s.gen.chain[0]).toMatchObject({ until: s.gen.chain[0].at + 120, log: 0, opts: { type: 'medical', parent: A.id, cause: A.rootEvent, csq: 't-spawn' } });
      expect(s.gen.chain[0].at - s.t).toBeGreaterThanOrEqual(1);
      expect(s.world.spawned).toBe(1);
      while (!kidOf(A) && s.t < 5) s.step();
      const B = kidOf(A)!;
      expect(B).toBeDefined();
      expect([B.cause, B.csq, s.events[B.rootEvent].causes]).toEqual([A.rootEvent, 't-spawn', [A.rootEvent]]);
      expect(s.events[B.rootEvent].text.startsWith('시험 연쇄 —')).toBe(true);
      expect(s.world.log).toEqual([{ rule: 't-spawn', t: s.world.log[0].t, ev: A.rootEvent, inc: A.id, made: B.id, depth: 1 }]);
      expect(s.gen.lastType).toBe(lastType);                           // 평소 생성기를 건드리지 않았다
      // B → C (깊이 2), C 에서는 더 만들지 않는다: 연쇄 상한의 정본(canChain — 한 사슬 3건)
      signal(s, 'blast', { inc: B.id, ev: B.rootEvent });
      while (!kidOf(B) && s.t < 10) s.step();
      const C = kidOf(B)!;
      expect(C).toBeDefined();
      expect(s.world.log[1]).toMatchObject({ made: C.id, depth: 2 });
      const nEv = s.events.length, nInc = s.incidents.length;
      signal(s, 'blast', { inc: C.id, ev: C.rootEvent });
      s.step(); s.step();
      expect(s.gen.dropped).toEqual([{ t: s.gen.dropped[0].t, why: 'depth', type: undefined, variant: undefined, parent: C.id, csq: 't-spawn' }]);
      expect(s.gen.chain.length).toBe(0);
      expect(s.incidents.length).toBe(nInc);
      expect(s.events.slice(nEv).some((e) => e.text.includes('시험 연쇄'))).toBe(false);
      expect(s.world.count['t-spawn']).toBe(2);                         // 걸린 것은 발동으로 세지 않는다
      // 직접 불러도 같은 상한: 깊이 → 'depth', 전체 상한(CSQ_SPAWN_CAP) → 'cap'
      const ctx: CsqCtx = { sim: s, sig: null, key: 'x', rng: s.rng.fork('t-ctx'), depth: 0, rule: 't-spawn', spawns: 0 };
      expect(spawnConsequence(s, ctx, { type: 'fire', variant: 'std', parent: C.id }, [1, 2])).toBe(false);
      expect(s.gen.dropped[1]).toMatchObject({ why: 'depth', type: 'fire', variant: 'std', parent: C.id });
      // 부모 없는 예약(재난·구역이 낳는 사건): 원인만 잇는다
      expect(spawnConsequence(s, ctx, { type: 'medical', cause: A.rootEvent, note: '부모 없는 시험 연쇄' }, [1, 2])).toBe(true);
      expect(s.world.log[2]).toMatchObject({ rule: 't-spawn', ev: A.rootEvent, inc: -1, made: -1, depth: 0 });
      expect(s.gen.chain[0].opts.parent).toBe(undefined);
      // 전체 상한(b3-4): 세는 법은 hazard.ruleLoad 하나 — 실제로 사건이 된 줄(made ≥ 0) + 기다리는 예약. 여기까지 만든 것 둘(B·C) + 예약 하나
      expect([ruleLoad(s), ruleLoad(s, 't-spawn'), ruleLoad(s, 'rubbleRoad')]).toEqual([3, 3, 0]);
      for (let k = 0; k < CSQ_SPAWN_CAP; k++) s.world.log.push({ rule: 't-fill', t: s.t, ev: -1, inc: -1, made: A.id, depth: 0 });      // 사건이 된 줄 여섯 — 상한을 채운다
      expect(ruleLoad(s)).toBeGreaterThanOrEqual(CSQ_SPAWN_CAP);
      expect(spawnConsequence(s, ctx, { type: 'medical' }, [1, 2])).toBe(false);
      expect(s.gen.dropped[2]).toMatchObject({ why: 'cap', type: 'medical', csq: 't-spawn' });
      // 예약이 버려지면 자리가 돌아온다: 기다리던 예약을 빼면 그 규칙의 수가 준다 (world.spawned 는 흐름의 순번으로만 남는다)
      s.gen.chain.length = 0;
      expect([ruleLoad(s, 't-spawn'), s.world.spawned]).toEqual([2, 3]);
      expect(ctx.spawns).toBe(1);
    } finally { off(); }
  });
  it('조건으로 일어나는 연쇄: when 이 거짓이면 5초마다 다시 보고, 맞으면 일어나고, until 이 지나면 버린다 (expired — 기록 없음)', () => {
    const s = new Sim('S2', NORMAL, 1200);
    let allow = false, calls = 0;
    s.gen.chain.push({ at: 1, until: 30, when: () => { calls++; return allow; }, opts: { type: 'medical', note: '조건 연쇄', rng: s.rng.fork('t-when') } });
    while (s.t < 8) s.step();
    expect(calls).toBe(2);                                             // 1초, 6초
    expect(s.incidents.some((J) => s.events[J.rootEvent].text.startsWith('조건 연쇄'))).toBe(false);
    allow = true;
    while (s.t < 14) s.step();
    const J = s.incidents.find((q) => s.events[q.rootEvent].text.startsWith('조건 연쇄'))!;
    expect(J).toBeDefined();
    expect(J.createdAt).toBeGreaterThanOrEqual(11);
    expect(J.createdAt).toBeLessThan(12);
    expect(s.gen.dropped.length).toBe(0);
    // 끝내 맞지 않는 조건: 기한(until)이 지난 뒤 처음 볼 때 버린다
    const z = new Sim('S2', NORMAL, 1200);
    z.gen.chain.push({ at: 1, until: 9, when: () => false, opts: { type: 'fire', variant: 'std', parent: 0, note: '끝내 맞지 않는 연쇄', rng: z.rng.fork('t-never') } });
    while (z.t < 14) z.step();
    expect(z.gen.dropped).toEqual([{ t: z.gen.dropped[0].t, why: 'expired', type: 'fire', variant: 'std', parent: 0 }]);
    expect(z.gen.dropped[0].t).toBeGreaterThanOrEqual(9);
    expect(z.gen.dropped[0].t).toBeLessThan(12);
    expect(z.events.some((e) => e.text.includes('끝내 맞지 않는 연쇄'))).toBe(false);
    expect(z.gen.chain.length).toBe(0);
  });
  it('상한에 걸려 잇지 못한 기존 연쇄(재범·도주 차량·은신처·방화)도 gen.dropped 에 남는다 — depth · cap, 기록 없음', () => {
    const s = new Sim('S2', NORMAL, 1200);
    const A = createIncident(s, { type: 'medical' });
    const B = createIncident(s, { type: 'medical', parent: A.id, rng: s.rng.fork('t1') });
    const C = createIncident(s, { type: 'medical', parent: B.id, rng: s.rng.fork('t2') });
    const nEv = s.events.length;
    expect(canChain(s, C)).toBe(false);
    noteChainDrop(s, C, 'armed', 'robbery');
    expect(s.gen.dropped).toEqual([{ t: s.t, why: 'depth', type: 'armed', variant: 'robbery', parent: C.id }]);
    // 교대 상한: 이어진 사건(이미 일어난 것 + 예약) 여섯이면 뿌리 사건에서도 잇지 못한다
    for (let k = 0; k < 8; k++) s.gen.chain.push({ at: 1e9, opts: { type: 'medical' } });      // 부모 없는 예약(인과 규칙이 재난·구역에서 만드는 사건)은 연쇄로 세지 않는다
    expect(canChain(s, A)).toBe(true);
    while (s.gen.chain.filter((c) => c.opts.parent !== undefined).length + 2 < CHAIN_SHIFT_MAX) s.gen.chain.push({ at: 1e9, opts: { type: 'medical', parent: A.id } });
    expect(canChain(s, A)).toBe(false);
    noteChainDrop(s, A, 'fire', 'arson');
    expect(s.gen.dropped[1]).toEqual({ t: s.t, why: 'cap', type: 'fire', variant: 'arson', parent: A.id });
    expect(s.events.length).toBe(nEv);
    // 예약하는 네 자리가 모두 canChain 이 거짓일 때 이것을 부른다
    const src = (f: string): string => readFileSync(f, 'utf8');
    expect(src('src/sim/field/hazards.ts').split('noteChainDrop(sim, I, ').length - 1).toBe(2);
    expect(src('src/sim/pursuit.ts')).toContain("else noteChainDrop(sim, I, 'armed', 'hostage')");
    expect(src('src/sim/scenarios/crime.ts')).toContain("if (!canChain(sim, I)) { noteChainDrop(sim, I, 'fire', 'arson'); return; }");
    // 극한의 무장 강제 교대(재범·도주 차량이 여섯까지 이어진다)에서 실제로 걸린 것은 부모가 있는 줄이고 기록에는 없다
    const { sim } = probedShift('S1', parseDifficulty('extreme')!, 'armed/std');
    // (b3-6) 법칙이 낸 사고의 거절(csq 가 있다)은 따로다 — 이야기 연쇄의 거절만 본다
    for (const d of sim.gen.dropped) if (d.csq === undefined && (d.why === 'depth' || d.why === 'cap')) { expect(d.parent).toBeGreaterThanOrEqual(0); expect(['getaway', 'robbery', 'hostage', 'arson']).toContain(d.variant); }
  });
  it('구역 값은 덮어쓰기(더 나쁜 쪽만)이고 회복 시각이 지나면 처음 값으로 — 관제는 알려진 칸만 본다', () => {
    const s = new Sim('S4', NORMAL, 1200);
    const d0 = DISTRICTS[0];
    expect(zoneOfXY(d0.x, d0.y)).toBe(0);
    expect(zoneOfXY(-5000, -5000)).toBe(-1);
    const inTown = s.city.places.find((q) => q.dong === d0.dong)!, outside = s.city.places.find((q) => !DISTRICTS.some((d) => d.dong === q.dong));
    expect(zoneOfPlace(s, inTown.id)).toBe(0);
    if (outside) expect(zoneOfPlace(s, outside.id)).toBe(-1);
    expect(knownZone(s, 0)).toEqual({});
    expect(knownZone(s, -1)).toEqual({});
    // 전력은 낮은 값만, 연기는 높은 값만 받는다. 알려지지 않은 변화는 관제가 보지 못한다
    expect(setZone(s, 0, 'power', 0.4, 50, 11, false)).toBe(true);
    expect(knownZone(s, 0)).toEqual({});
    expect(setZone(s, 0, 'power', 0.7, 80, 12, true)).toBe(false);      // 더 나쁘지 않다: 값·원인은 그대로, 회복 시각은 늦은 쪽, 알려짐은 켠다
    expect([s.world.zones[0].power, s.world.zones[0].cause.power, s.world.zones[0].until.power]).toEqual([0.4, 11, 80]);
    expect(knownZone(s, 0)).toEqual({ power: 0.4 });
    expect(setZone(s, 0, 'smoke', 0.6, 40, 13, true)).toBe(true);
    expect(setZone(s, 0, 'smoke', 0.3, 20, 14, true)).toBe(false);
    expect(setZone(s, -1, 'power', 0, 99, 15, true)).toBe(false);       // 구역 -1 은 어느 상태도 받지 않는다
    expect(knownZone(s, 0)).toEqual({ power: 0.4, smoke: 0.6 });
    // 회복: 세계 틱(1초에 한 번)이 회복 시각이 지난 칸만 되돌리고, 규칙의 recover 가 그 칸·원인을 받는다
    const got: [number, ZoneField, number, boolean][] = [];
    const off = registerConsequence({ id: 't-recover', label: '시험 회복', on: ['closed'], key: () => null, cooldown: 0, cap: 0, spawns: false, test: () => false, apply: () => {}, recover: (_s, z, f, cause, known) => { got.push([z, f, cause, known]); } });
    try {
      s.t = 45; s.tick = 226; tickWorld(s);
      expect(got).toEqual([[0, 'smoke', 13, true]]);
      expect(knownZone(s, 0)).toEqual({ power: 0.4 });
      s.t = 80; s.tick = 401; tickWorld(s);
      expect(got[1]).toEqual([0, 'power', 11, true]);
    } finally { off(); }
    expect(JSON.stringify(s.world.zones)).toBe(JSON.stringify(initWorld(s).zones));
    for (const f of ['power', 'comms', 'water'] as const) expect(ZONE_DEFAULT[f]).toBe(1);
    // 응급실 체류: 병동으로 옮겨진 환자는 빠진다
    s.world.hospitals[0].stays.push(70, 500, 90);
    s.t = 100; s.tick = 501; tickWorld(s);
    expect(s.world.hospitals[0].stays).toEqual([500]);
    // 병원: 알린 것만
    const h = s.world.hospitals[0];
    expect(knownHospital(s, h.fac)).toBe(null);
    h.divert = true;
    expect(knownHospital(s, h.fac)).toBe(null);
    h.known = true;
    expect(knownHospital(s, h.fac)).toEqual({ divert: true, ev: -1 });      // ev = 그것을 알린 기록 (여기서는 손으로 켰다)
    expect(knownHospital(s, -7)).toBe(null);
  });
  it('건물 상태와 사건의 구역: 세계 규칙은 placeState(진실), 관제는 알려진 교차로로만 묻는다 (knownBuildingAt · knownZoneOfIncident)', () => {
    const s = new Sim('S4', NORMAL, 1200);
    const I = createIncident(s, { type: 'fire', variant: 'std' });
    const pid = I.truth.placeId, kind = I.truth.placeKind!;
    expect(pid).toBeGreaterThanOrEqual(0);
    expect(placeState(s, pid)).toBe(null);
    // 위치를 모르는 사건의 구역은 -1 — 진실의 자리를 읽지 않는다
    expect(I.locationKnown).toBe(false);
    expect(knownZoneOfIncident(s, I)).toBe(-1);
    I.locationKnown = true;
    const n = s.city.nodes[I.reportedNode];
    expect(knownZoneOfIncident(s, I)).toBe(zoneOfXY(n.x, n.y));
    // 열린 사건의 건물은 관제가 아직 모른다
    s.placeMarks.set(pid, { placeId: pid, state: 'scorched', t: 0, incidentId: I.id, burnFrac: 0.3, ruinFrac: 0 });
    expect(placeState(s, pid)).toMatchObject({ mark: 'scorched', burnFrac: 0.3, ruinFrac: 0, usable: true });      // (b3-7 이 노출의 칸 shake·pipe·wet 을 더한다)
    expect(knownBuildingAt(s, I.reportedNode, kind)).toBe(null);
    I.phase = 'closed';
    expect(knownBuildingAt(s, I.reportedNode, kind)).toEqual({ burnFrac: 0.3, usable: true, inc: I.id });
    expect(knownBuildingAt(s, I.reportedNode)).toEqual({ burnFrac: 0.3, usable: true, inc: I.id });
    expect(knownBuildingAt(s, I.reportedNode, 'intersection')).toBe(null);
    expect(knownBuildingAt(s, I.reportedNode, kind === 'shop' ? 'bank' : 'shop')).toBe(null);
    s.placeMarks.get(pid)!.state = 'burnt';
    expect(placeState(s, pid)!.usable).toBe(false);
    expect(knownBuildingAt(s, I.reportedNode, kind)!.usable).toBe(false);
    // 닫혔지만 끝내 위치를 몰랐던 사건(무대응 종료)은 관제가 아는 건물이 아니다
    I.locationKnown = false;
    expect(knownBuildingAt(s, I.reportedNode, kind)).toBe(null);
  });
  it('정보 격리: 판단 파일은 세계 상태·건물 상태를 직접 읽지 않는다 — known* 함수만 (소스 글자)', () => {
    const WORLD = ['sim.world', 'world.zones', 'world.hospitals', 'world.signals', 'world.log', 'placeMarks', 'carryState'];
    const files = [
      ...readdirSync('src/sim/dispatch').filter((f) => f.endsWith('.ts')).map((f) => 'src/sim/dispatch/' + f),
      'src/sim/field/commander.ts', 'src/sim/field/brain.ts',
      ...readdirSync('src/sim/field/orders').filter((f) => f.endsWith('.ts')).map((f) => 'src/sim/field/orders/' + f),
    ];
    expect(files.length).toBeGreaterThan(8);
    for (const f of files) { const src = readFileSync(f, 'utf8'); for (const w of WORLD) expect(src.includes(w), `${f} 에 ${w}`).toBe(false); }
    // 분석·배정은 진실의 건물 id 를 읽지 않는다 (신고자 모델 callSystem 은 신고자가 본 것을 정하므로 뺀다)
    for (const f of ['src/sim/dispatch/analyst.ts', 'src/sim/dispatch/dispatcher.ts']) expect(readFileSync(f, 'utf8').includes('truth.placeId'), f).toBe(false);
    // 병원을 고르는 startTransport 는 관제 쪽 결정이다: 그 함수의 본문만 잘라 같은 글자를 본다 (같은 파일의 다른 자리는 진실을 읽어도 된다)
    const res = readFileSync('src/sim/resources.ts', 'utf8');
    const at = res.indexOf('export function startTransport');
    expect(at).toBeGreaterThanOrEqual(0);
    let depth = 0, end = -1;
    for (let i = res.indexOf('{', at); i < res.length; i++) { if (res[i] === '{') depth++; else if (res[i] === '}' && --depth === 0) { end = i; break; } }
    const body = res.slice(at, end + 1);
    expect(body.length).toBeGreaterThan(100);
    expect(body).toContain('etaFor');
    for (const w of [...WORLD, 'truth.placeId']) expect(body.includes(w), `startTransport 에 ${w}`).toBe(false);
  });
});

describe('I1-b b3-1: C6 divertRecord — 전환 배정의 실제 영향', () => {
  const LATE = /^사건 (\S+): 전환 배정 뒤 첫 도착이 예정보다 약 (\d+)초 늦었습니다\.$/;
  it('빼앗긴 사건의 첫 도착이 예정보다 얼마나 늦었는가: DIVERTED 의 ref.lost, 10초 넘으면 그 DIVERTED 를 원인으로 한 기록 (보통 S0·S3·S7·S8·S15·S17·S19·S21·S22)', () => {
    let hurtN = 0, lateN = 0, zeroN = 0, notHurt = 0;
    // (N8 단계 4a·4b) S15·S17 을 더했다 (표본만 넓힌다): 시설 사고가 짧은 사건에 들어 S0·S3·S7·S8 의 전환 배정 넷이 모두 10초 안에 메워졌다
    // (N8 단계 5) S19·S21·S22 를 더했다 (표본만 넓힌다): 동물 사건이 짧은 사건에 들어 10초 넘게 늦은 전환이 하나로 줄었다
    // (N8 단계 6a) S35 를 더했다 (표본만 넓힌다): 경찰 새 부대 셋이 편성돼 10초 넘게 늦은 전환이 다시 하나로 줄었다
    // (N8 단계 8·9) S44·S50 을 더했다 (표본만 넓힌다): 구조 유형이 평소 추첨에 들어 첫 도착을 늦춘 전환이 셋(모두 10초 안)으로 줄었다 — S36~S99 가운데 10초 넘게 늦은 전환이 있는 앞쪽 둘
    for (const seed of ['S0', 'S3', 'S7', 'S8', 'S15', 'S17', 'S19', 'S21', 'S22', 'S35', 'S44', 'S50']) {
      const { sim, probe } = probedShift(seed);
      const rows = divertAnalysis(sim.events, sim.incidents, sim.units, probe.etaLog, sim.t).rows;
      for (const J of sim.incidents) {
        expect(J.divertWait, `${seed} #${J.code} 의 기억해 둔 전환은 첫 도착이나 종료 때 비운다`).toBeUndefined();
        const lates = sim.events.filter((e) => e.incidentId === J.id && LATE.test(e.text));
        expect(lates.length).toBeLessThanOrEqual(1);
        for (const p of J.problems) if (p.code === 'DIVERTED') {
          const hurt = J.firstArrivalAt < 0 || J.firstArrivalAt > p.t;
          const rec = lates.filter((e) => e.causes.includes(p.eventId));
          if (!hurt) { notHurt++; expect(p.ref!.lost, '이미 부대가 닿은 사건에서 빼 간 것은 첫 도착을 늦추지 않는다').toBeUndefined(); expect(rec.length).toBe(0); continue; }
          hurtN++;
          const lost = p.ref!.lost!;
          expect(lost).toBeGreaterThanOrEqual(0);
          // 측정 도구가 표본으로 따로 잰 값과 같다 (예정 도착은 같은 u.estArrive — 반올림만 다르다)
          const row = rows.find((r) => r.pe === p.eventId)!;
          expect(row.hurt).toBe(true);
          if (row.lostSec !== null) expect(Math.abs(row.lostSec - lost)).toBeLessThanOrEqual(1);
          // (N8 단계 7 뒤 절반) 끝내 아무도 닿지 못하고 닫힌 사건(무대응)은 닫힌 시각까지를 ref.lost 에만 적고 기록을 남기지 않는다 — 아래 '기억과 정산' 시험의 갈래 (보통 S7 #13: 전환 뒤 진압 부대가 모두 다른 화재에 묶인 오인 신고)
          if (J.firstArrivalAt < 0) { expect(rec.length, `${seed} #${J.code} 무대응`).toBe(0); continue; }
          if (lost >= DIVERT_LATE_MIN) {
            lateN++;
            expect(rec.length).toBe(1);
            const e = rec[0], m = LATE.exec(e.text)!;
            expect([e.kind, e.role, e.actor, e.importance]).toEqual(['dispatch', 'DISPATCH', '배정 AI', 1]);
            expect(m[1]).toBe(J.code);
            expect(Number(m[2])).toBeGreaterThanOrEqual(lost);
            // 첫 도착의 그 틱, 도착 기록 바로 다음에 남는다
            expect(e.t).toBe(J.firstArrivalAt);
            const prev = sim.events[e.id - 1];
            expect([prev.kind, prev.incidentId, prev.importance]).toEqual(['arrive', J.id, 3]);
            // 원인 사슬: 받는 사건의 기록 → DIVERTED(J) → 지연 기록(J)
            expect(sim.events[p.eventId].causes.some((c) => sim.events[c].incidentId === p.ref!.inc)).toBe(true);
          } else { zeroN++; expect(rec.length).toBe(0); }
        }
      }
    }
    expect(hurtN).toBeGreaterThan(3);
    expect(lateN, '10초 넘게 늦은 전환').toBeGreaterThan(1);
    expect(zeroN, '다른 부대가 예정보다 먼저 닿은 전환').toBeGreaterThan(0);
    expect(notHurt).toBeGreaterThan(0);
  });
  it('기억과 정산: 아직 아무도 닿지 않은 사건만 기억하고, 끝내 아무도 닿지 못하고 닫히면 닫힌 시각까지를 ref.lost 에만 (기록 없음)', () => {
    const s = new Sim('S2', NORMAL, 1200);
    for (let k = 0; k < 10; k++) s.step();
    const J = createIncident(s, { type: 'medical', variant: 'faint' }), K = createIncident(s, { type: 'fire', variant: 'std' });
    const u = s.units.find((q) => q.dept === 'ems')!;
    u.estArrive = s.t + 30;      // J 로 가던 부대의 예정 도착
    const dv = raiseProblem(s, J, 'DIVERTED', '시험', { role: 'DISPATCH', actor: '배정 AI', text: '시험: 전환 배정' }, false, { inc: K.id, unit: u.id });
    noteDivert(s, J, u, dv);
    expect(J.divertWait).toEqual([{ unit: u.id, t: s.t, eta: s.t + 30, ev: dv }]);
    // 이미 부대가 닿은 사건은 기억하지 않는다
    K.firstArrivalAt = s.t;
    noteDivert(s, K, u, raiseProblem(s, K, 'DIVERTED', '시험', { role: 'DISPATCH', actor: '배정 AI', text: '시험: 전환 배정' }, false, { inc: J.id, unit: u.id }));
    expect(K.divertWait).toBeUndefined();
    divertArrived(s, K); divertUnmet(s, K);      // 기억한 것이 없으면 아무 일도 없다
    expect(K.problems[0].ref!.lost).toBeUndefined();
    // 예정보다 7초 늦은 첫 도착: ref.lost 만, 기록은 없다
    const n0 = s.events.length, t0 = s.t;
    s.t = t0 + 37;
    divertArrived(s, J);
    expect(J.problems[0].ref).toEqual({ inc: K.id, unit: u.id, lost: 7 });
    expect(J.divertWait).toBeUndefined();
    expect(s.events.length).toBe(n0);
    // 예정보다 52초 늦은 첫 도착: 기록 한 줄, 원인은 그 DIVERTED
    J.divertWait = [{ unit: u.id, t: t0, eta: t0 + 30, ev: dv }];
    s.t = t0 + 82;
    divertArrived(s, J);
    expect(J.problems[0].ref!.lost).toBe(52);
    expect(s.events.length).toBe(n0 + 1);
    expect(LATE.exec(s.events[n0].text)!.slice(1)).toEqual([J.code, '52']);
    expect(s.events[n0].causes).toEqual([dv]);
    // 끝내 아무도 닿지 못하고 닫혔다: 닫힌 시각 − 예정 도착, 기록은 남기지 않는다
    J.divertWait = [{ unit: u.id, t: t0, eta: t0 + 30, ev: dv }];
    s.t = t0 + 130;
    closeIncident(s, J, 'noresponse');
    expect(J.problems[0].ref!.lost).toBe(100);
    expect(J.divertWait).toBeUndefined();
    expect(s.events.slice(n0 + 1).some((e) => LATE.test(e.text))).toBe(false);
  });
  it('정보 격리: 관제(dispatcher)가 부르는 C6 의 파일은 세계 상태를 읽지 않는다 — 관제 자신의 결정과 도착 보고만 (소스 글자)', () => {
    const src = readFileSync('src/sim/world/rules/record.ts', 'utf8');
    for (const w of ['sim.world', 'world.zones', 'world.hospitals', 'world.signals', 'world.log', 'placeMarks', 'carryState', '.truth', 'sim.scenes']) expect(src.includes(w), `record.ts 에 ${w}`).toBe(false);
    expect(readFileSync('src/sim/dispatch/dispatcher.ts', 'utf8')).toContain("from '../world/rules/record'");
  });
});

describe('I1-b b3-2: C3 hospitalLoad — 응급실 포화', () => {
  const FULL = /^(.+) 응급실 포화 — 당분간 중증 환자만 받습니다\.$/, REOPEN = /^(.+) 응급실 수용 재개\.$/;
  /** 세계 틱 한 번 (1초 틱 — 신호 처리 + world tick 규칙 + 회복) */
  const worldTick = (s: Sim, t: number): void => { s.t = t; s.tick = Math.round(t * 5) * 5 + 1; tickWorld(s); };
  /** 병원에 n 명 인계했다는 신호 (그 인계 기록과 함께) */
  const deliver = (s: Sim, fac: number, n: number, mates = 0): number => {
    const f = s.city.facilities[fac];
    const e = emit(s, { role: 'UNIT', actor: '시험구급', kind: 'casualty', text: `시험구급: ${f.name} 도착, 환자 ${n}명 인계 완료.` });
    signal(s, 'delivered', { inc: -1, ev: e, x: f.x, y: f.y, place: fac, data: n, size: mates });
    return e;
  };
  it('병원 수용 한도는 시설 순서의 두 값이고, 인계마다 체류가 쌓인다 — 한도에 닿으면 병원이 알리고(tag hospital) 한도 − 2 로 내려가면 재개, 60초 안에는 다시 바뀌지 않는다', () => {
    const s = new Sim('S5', NORMAL, 1200);
    const [H0, H1] = s.world.hospitals, f0 = s.city.facilities[H0.fac];
    expect([H0.cap, H1.cap]).toEqual([HOSPITAL_CAP[0], HOSPITAL_CAP[1]]);
    expect(s.city.facilities.filter((f) => f.kind === 'hospital').map((f) => f.id)).toEqual([H0.fac, H1.fac]);
    expect(hospitalOf(s, H0.fac)).toBe(H0);
    expect(hospitalOf(s, -3)).toBe(null);
    // 한도 − 1 명(환자와 함께 인계한 다친 대원도 병상을 쓴다): 체류만 쌓인다 — 알림도 world.log 의 줄도 없다
    s.t = 10;
    const e1 = deliver(s, H0.fac, H0.cap - 2, 1);
    worldTick(s, 10.2);
    expect(H0.stays).toEqual(new Array(H0.cap - 1).fill(10 + ER.STAY));
    expect([H0.divert, H0.known, H0.lastEv]).toEqual([false, false, e1]);
    expect(knownHospital(s, H0.fac)).toBe(null);
    expect(s.world.log.length).toBe(0);
    expect(H1.stays.length).toBe(0);
    // 한 명 더: 한도 — 병원이 곧바로 알린다 (원인 = 그 인계 기록)
    s.t = 20;
    const e2 = deliver(s, H0.fac, 1);
    const n0 = s.events.length;
    worldTick(s, 20.2);
    expect(erLoad(H0, s.t)).toBe(H0.cap);
    expect(s.events.length).toBe(n0 + 1);
    const full = s.events[n0];
    expect(FULL.exec(full.text)![1]).toBe(f0.name);
    expect([full.actor, full.kind, full.tag, full.importance, full.incidentId, full.truth]).toEqual([f0.name, 'unit', 'hospital', 2, -1, false]);
    expect(full.causes).toEqual([e2]);
    expect(sysOf(full)).toBe('hospital');
    expect([H0.divert, H0.known, H0.since, H0.cause]).toEqual([true, true, s.t, full.id]);
    expect(knownHospital(s, H0.fac)).toEqual({ divert: true, ev: full.id });
    expect(knownHospital(s, H1.fac)).toBe(null);
    expect(s.world.log.map((l) => l.rule)).toEqual(['hospitalLoad']);
    // 체류가 빠져도 60초 안에는 다시 바뀌지 않는다
    H0.stays.length = H0.cap - ER.RELIEF;
    worldTick(s, 20.2 + ER.HOLD - 1);
    expect(H0.divert).toBe(true);
    // 60초 뒤: 수용 재개 (원인 = 포화 알림). 관제는 재개도 안다
    worldTick(s, 20.4 + ER.HOLD);
    const re = s.events[s.events.length - 1];
    expect(REOPEN.exec(re.text)![1]).toBe(f0.name);
    expect([re.tag, re.importance, re.causes]).toEqual(['hospital', 1, [full.id]]);
    expect(knownHospital(s, H0.fac)).toEqual({ divert: false, ev: re.id });
    // 다시 한도까지 차도, 재개한 지 60초 안에는 포화를 알리지 않는다
    const t1 = s.t;
    deliver(s, H0.fac, ER.RELIEF);
    worldTick(s, t1 + 5);
    expect(erLoad(H0, s.t)).toBe(H0.cap);
    expect(H0.divert, '재개한 지 60초 안에는 다시 포화를 알리지 않는다').toBe(false);
    worldTick(s, t1 + ER.HOLD + 0.2);
    expect(H0.divert).toBe(true);
    // 한도 − 1 로는 재개하지 않는다 (한도 − 2 까지 내려가야 한다)
    H0.stays.length = H0.cap - 1;
    worldTick(s, t1 + 3 * ER.HOLD);
    expect(H0.divert).toBe(true);
    // 병동으로 옮겨지면(체류 시간이 지나면) 저절로 빠지고 재개한다
    worldTick(s, 20 + ER.STAY + 1);
    expect(H0.stays.length).toBeLessThanOrEqual(H0.cap - ER.RELIEF);
    worldTick(s, 20 + ER.STAY + 2);
    expect(H0.divert).toBe(false);
    expect(s.events.filter((e) => e.tag === 'hospital').length).toBe(4);
    expect(s.world.log.filter((l) => l.rule === 'hospitalLoad').length).toBe(4);
  });
  it('새 이송은 알려진 포화 병원을 240초 멀리 보고(HOSPITAL_FULL — 원인은 그 알림), 그 병원으로 가던 부대는 목적지를 바꾼다(T8) — 둘 다 포화면 가까운 곳으로', () => {
    const s = new Sim('S5', NORMAL, 1200);
    for (let k = 0; k < 5; k++) s.step();
    const [H0, H1] = s.world.hospitals, f0 = s.city.facilities[H0.fac], f1 = s.city.facilities[H1.fac];
    const I = createIncident(s, { type: 'medical', variant: 'faint' });
    const amb = s.units.filter((u) => u.dept === 'ems' && !u.air && !u.sea);
    expect(amb.length).toBeGreaterThanOrEqual(3);
    /** 부대를 그 교차로에 환자를 실은 채 세운다 */
    const put = (u: Unit, node: number): void => { const n = s.city.nodes[node]; u.nodeId = node; u.x = n.x; u.y = n.y; u.route = null; u.seg = 0; u.segT = 0; u.curb = null; u.pendingDest = null; u.state = 'onscene'; u.incidentId = null; u.patients = [0]; u.patientsIncident = I.id; };
    // 첫 병원이 더 가깝고 둘째 병원이 120초 안으로만 더 먼 교차로(near), 120초 넘게 더 먼 교차로(far)
    const [A, B, C] = amb;
    let near = -1, far = -1, nd = 0, fd = 0;
    for (const n of s.city.nodes) {
      put(A, n.id);
      const d = etaFor(s, A, f1.nodeId) - etaFor(s, A, f0.nodeId);
      if (d > 20 && d <= ER.REROUTE_MAX - 10 && d > nd) { near = n.id; nd = d; }
      if (d > ER.REROUTE_MAX + 10 && d < ER_PENALTY - 10 && d > fd) { far = n.id; fd = d; }
    }
    expect(near).toBeGreaterThanOrEqual(0);
    // 포화가 알려지기 전: 가장 빨리 닿는 병원으로, 원인 없음
    put(A, near);
    expect(startTransport(s, A)).toBe(f0);
    expect([A.state, A.destNode]).toEqual(['transport', f0.nodeId]);
    expect(transportWhy(A)).toBeUndefined();
    if (far >= 0) { put(B, far); expect(startTransport(s, B)).toBe(f0); }
    expect(I.problems.some((p) => p.code === 'HOSPITAL_FULL')).toBe(false);
    // 첫 병원이 포화를 알린다 → 그 병원으로 가던 A 는 목적지를 바꾼다 (120초 안), 훨씬 가까운 B 는 그대로 간다
    deliver(s, H0.fac, H0.cap);
    const n0 = s.events.length;
    worldTick(s, s.t + 0.2);
    const full = s.events.find((e) => e.id >= n0 && FULL.test(e.text))!;
    expect(full).toBeDefined();
    expect(A.destNode).toBe(f1.nodeId);
    const re = s.events.find((e) => e.id > full.id && PHRASE.T8.test(e.text))!;
    expect(PHRASE.T8.exec(re.text)!.slice(1)).toEqual([A.callsign, f1.name]);
    expect(re.text).toContain(`${f0.name} 포화 소식`);
    expect([re.problem, re.incidentId, re.role, re.actor, re.causes]).toEqual(['HOSPITAL_FULL', I.id, 'UNIT', A.callsign, [full.id]]);
    const pr = I.problems.find((p) => p.eventId === re.id)!;
    expect([pr.code, pr.ref!.fac, pr.ref!.unit]).toEqual(['HOSPITAL_FULL', f0.id, A.id]);
    expect(Math.abs(pr.ref!.lost! - nd)).toBeLessThanOrEqual(2);
    expect(pr.detail).toContain('이송 중');
    if (far >= 0) { expect(B.destNode, '둘째 병원이 120초 넘게 더 멀면 그대로 간다').toBe(f0.nodeId); expect(s.events.filter((e) => e.id > full.id && PHRASE.T8.test(e.text)).length).toBe(1); }
    // 새 이송: 가까운 첫 병원 대신 둘째 병원을 고른다 — HOSPITAL_FULL 과 그 알림이 출발 기록의 원인이 된다
    put(C, near);
    const n1 = s.events.length;
    expect(startTransport(s, C)).toBe(f1);
    expect(s.events.length).toBe(n1 + 1);
    const hf = s.events[n1];
    expect([hf.problem, hf.incidentId, hf.role, hf.causes]).toEqual(['HOSPITAL_FULL', I.id, 'DISPATCH', [full.id]]);
    expect(hf.text).toContain(`${f0.name} 응급실 포화`);
    expect(hf.text).toContain(f1.name);
    expect(transportWhy(C)).toEqual([full.id, hf.id]);
    const pc = I.problems.find((p) => p.eventId === hf.id)!;
    expect([pc.ref!.fac, pc.ref!.unit]).toEqual([f0.id, C.id]);
    expect(Math.abs(pc.ref!.lost! - nd)).toBeLessThanOrEqual(2);
    expect(pc.detail).toMatch(new RegExp(`^${f0.name} 포화로 ${f1.name}(?:으로|로) 이송 \\(약 \\+\\d+초\\)$`));
    // 둘 다 포화면 벌점이 상쇄된다: 가까운 곳으로, 기록 없음
    deliver(s, H1.fac, H1.cap);
    worldTick(s, s.t + 1);
    expect(knownHospital(s, H1.fac)!.divert).toBe(true);
    put(C, near);
    const n2 = s.events.length;
    expect(startTransport(s, C)).toBe(f0);
    expect(s.events.length).toBe(n2);
    expect(transportWhy(C)).toBeUndefined();
    // 수용 재개가 알려지면 다시 가까운 병원으로 (기록 없음)
    H0.stays.length = 0; H1.stays.length = 0;
    worldTick(s, s.t + ER.HOLD + 1); worldTick(s, s.t + 1);
    expect([knownHospital(s, H0.fac)!.divert, knownHospital(s, H1.fac)!.divert]).toEqual([false, false]);
    put(C, near);
    expect(startTransport(s, C)).toBe(f0);
    expect(transportWhy(C)).toBeUndefined();
  });
  it('실제 교대(보통 S3·S7): 포화 알림 → 먼 병원 이송·이송 중 목적지 변경 → 그 병원에 인계 (C5 0), 응급실 대기 기록은 앞 차의 출발 기록·그 병원의 인계 기록을 원인으로', () => {
    let fulls = 0, reroutes = 0, departs = 0, waits = 0;
    // (N8 단계 6a) S1 을 더했다 (표본만 넓힌다): 경찰 새 부대 셋이 편성돼 S3·S7 의 이송 중 목적지 변경이 없어졌다
    // (N8 단계 7 뒤 절반) S12 를 더했다 (표본만 넓힌다): 위기자·문 잠긴 집이 짧은 사건에 들어 포화 알림이 S7 의 하나로 줄고 목적지 변경이 없어졌다 — S0~S59 가운데 목적지 변경이 있는 첫 시드
    for (const seed of ['S3', 'S7', 'S1', 'S12']) {
      const { sim, m } = probedShift(seed);
      expect(m.consistency.C5, seed).toBe(0);
      const hospName = new Set(sim.city.facilities.filter((f) => f.kind === 'hospital').map((f) => f.name));
      for (const e of sim.events) {
        if (FULL.test(e.text)) {
          fulls++;
          expect(hospName.has(FULL.exec(e.text)![1])).toBe(true);
          expect(e.causes.length).toBe(1);
          expect(PHRASE.T4.test(sim.events[e.causes[0]].text), '포화 알림의 원인은 그 병원의 인계 기록').toBe(true);
          expect(sim.events[e.causes[0]].text).toContain(FULL.exec(e.text)![1]);
        }
        if (e.problem === 'HOSPITAL_FULL') {
          const notice = sim.events[e.causes[0]];
          expect(FULL.test(notice.text)).toBe(true);
          expect(notice.id).toBeLessThan(e.id);
          const I = sim.incidents[e.incidentId], p = I.problems.find((q) => q.eventId === e.id)!;
          const u = sim.units[p.ref!.unit!], full = sim.city.facilities[p.ref!.fac!];
          expect(full.name).toBe(FULL.exec(notice.text)![1]);
          // 그 부대의 다음 인계는 포화가 아닌 다른 병원이다
          const next = sim.events.find((x) => x.id > e.id && x.actor === u.callsign && PHRASE.T4.test(x.text));
          if (next) expect(PHRASE.T4.exec(next.text)![2]).not.toBe(full.name);
          if (PHRASE.T8.test(e.text)) { reroutes++; expect(e.actor).toBe(u.callsign); if (next) expect(PHRASE.T4.exec(next.text)![2]).toBe(PHRASE.T8.exec(e.text)![2]); }
          else {
            departs++;
            // 바로 다음 기록이 그 부대의 출발 기록이고, 알림과 이 기록을 원인으로 잇는다
            const dep = sim.events[e.id + 1];
            expect(PHRASE.T3.test(dep.text)).toBe(true);
            expect(dep.actor).toBe(u.callsign);
            expect(dep.causes).toEqual([notice.id, e.id]);
          }
        }
        if (PHRASE.T2.test(e.text)) {
          waits++;
          const ahead = /앞에 (\d+)대/.exec(e.text);
          const cs = e.causes.map((c) => sim.events[c]);
          if (ahead) expect(cs.filter((c) => PHRASE.T3.test(c.text) && c.actor !== e.actor).length, e.text).toBeLessThanOrEqual(Number(ahead[1]));
          else { expect(cs.length).toBe(1); expect(PHRASE.T4.test(cs[0].text)).toBe(true); }
        }
      }
      // 교대 끝의 체류 = 마지막 300초 안에 인계한 사람 수 (환자 + 다친 대원 + 용의자)
      for (const H of sim.world.hospitals) {
        const name = sim.city.facilities[H.fac].name;
        let n = 0;
        for (const e of sim.events) { const t4 = PHRASE.T4.exec(e.text); if (!t4 || t4[2] !== name || e.t >= sim.t || e.t + ER.STAY <= sim.t) continue; for (const part of e.text.split('도착, ')[1].split('·')) n += Number(/(\d+)명/.exec(part)![1]); }
        expect(erLoad(H, sim.t), name).toBe(n);
      }
    }
    expect(fulls).toBeGreaterThan(1);
    expect(reroutes, '이송 중 목적지 변경').toBeGreaterThan(0);
    expect(departs, '먼 병원으로 출발').toBeGreaterThan(0);
    expect(waits).toBeGreaterThan(0);
  });
});

describe('I1-b b3-3: C2 rubbleRoad — 잔해는 사건이 끝나도 남는다', () => {
  const KNOWN = /^(.+) 건물 잔해로 (전면|한 차로) 통제\.$/, HIDDEN = /^(.+)에 건물 잔해가 쏟아져 (길이 막혔습니다|한 차로가 막혔습니다)\. 아직 아무도 신고하지 않았습니다\.$/;
  /** 건물에서 난 화재 하나만 있는 교대 (평소 생성기를 건드리지 않는 흐름으로) — 그 건물이 면한 구간이 있는 것 */
  function fireAt(seed: string): { sim: Sim; I: Incident; edge: number } {
    for (let k = 0; k < 40; k++) {
      const sim = new Sim(seed + k, NORMAL, 1200);
      sim.traffic.nextEvent = Infinity;      // 무작위 교통 사건은 끈다 (장애물을 직접 본다)
      const I = createIncident(sim, { type: 'fire', variant: 'std', rng: sim.rng.fork('t') });
      const pl = sim.city.places[I.truth.placeId];
      if (pl && pl.edgeId !== undefined && !sim.traffic.obstacles.some((o) => o.edge === pl.edgeId) && catOf(sim, sim.scenes[I.id]!)?.struct) return { sim, I, edge: pl.edgeId };
    }
    throw new Error('면한 구간이 있는 건물 화재를 찾지 못함');
  }
  /** 도시가 끊기지 않았다: 모든 시설에서 사건 교차로와 그 구간의 양 끝으로, 실제 상태(모르는 통제까지 막힌 것으로)에서 큰 차도 간다 */
  function expectLinked(sim: Sim, I: Incident, edge: number): void {
    const e = sim.city.edges[edge];
    for (const f of sim.city.facilities) for (const to of [I.truth.nodeId, e.a, e.b]) expect(reallyLinked(sim, f.nodeId, to, -1, true), `${f.name} → 교차로 ${to}`).toBe(true);
  }
  const rubbles = (sim: Sim) => sim.traffic.obstacles.filter((o) => o.kind === 'rubble');

  it('(가) 통째로 무너진 건물: 사건 동안의 통제(X6)가 끝나면 그 구간에 잔해가 이어서 남는다 — 알려진 전면 통제, 기록의 원인은 종료 기록, 도시는 끊기지 않는다', () => {
    const { sim, I } = fireAt('C2-A');
    const s = sim.scenes[I.id]!;
    collapseBuilding(sim, s, I, catOf(sim, s)!);
    const edge = I.blockedEdge, e = sim.city.edges[edge];
    expect(edge).toBeGreaterThanOrEqual(0);
    expect([e.closed, e.closedReason]).toEqual([true, 'incident']);
    expect(sim.placeMarks.get(I.truth.placeId)!.state).toBe('collapsed');
    tickWorld(sim);      // 붕괴의 신호(catastrophe · 붕괴)는 잔해를 남기지 않는다 — 사건 동안은 X6 의 통제다
    expect(rubbles(sim).length).toBe(0);
    closeIncident(sim, I, 'resolved');
    expect(e.closed, '사건이 끝나면 X6 의 통제는 풀린다').toBe(false);
    const closeEv = sim.events.find((x) => x.incidentId === I.id && x.kind === 'resolve')!;
    sim.tick++; sim.t += sim.dt; tickWorld(sim);      // 다음 틱
    const [ob] = rubbles(sim);
    expect(rubbles(sim).length).toBe(1);
    expect([ob.edge, ob.full, ob.known, ob.label]).toEqual([edge, true, true, OBSTACLE_LABEL.rubble]);
    expect(ob.until - sim.t).toBeGreaterThanOrEqual(RUBBLE.DUR[0]);
    expect(ob.until - sim.t).toBeLessThanOrEqual(RUBBLE.DUR[1]);
    expect([e.closed, e.closedReason, e.known]).toEqual([true, 'obstacle', undefined]);
    const rec = sim.events[ob.ev!];
    expect([rec.kind, rec.actor, rec.truth, rec.incidentId, rec.importance]).toEqual(['traffic', '교통정보', false, -1, 1]);
    expect(KNOWN.exec(rec.text)![2]).toBe('전면');
    expect(rec.causes).toEqual([closeEv.id]);
    expect(sysOf(rec)).toBe('road');
    expect(sim.world.log.filter((l) => l.rule === 'rubbleRoad')).toEqual([{ rule: 'rubbleRoad', t: sim.t, ev: closeEv.id, inc: I.id, made: -1, depth: 0 }]);
    expectLinked(sim, I, edge);
    // 치워지면 길이 열린다 (교통 모델이 한다)
    sim.t = ob.until + 1; sim.tick = Math.round(sim.t * 5); tickTraffic(sim);
    expect(rubbles(sim).length).toBe(0);
    expect([e.closed, e.closedReason]).toEqual([false, null]);
    expect(sim.events[sim.events.length - 1].text).toMatch(/통행 재개\.$/);
  });
  it('(가) 전면 통제가 도시를 끊으면 한 차로만 — 앞 사건이 남긴 건물 상태로는 잔해를 또 남기지 않는다', () => {
    const { sim, I } = fireAt('C2-B');
    const s = sim.scenes[I.id]!;
    collapseBuilding(sim, s, I, catOf(sim, s)!);
    const edge = I.blockedEdge, e = sim.city.edges[edge];
    // 그 구간의 한쪽 끝에 닿는 다른 길을 모두 막는다: 이 구간을 전면 통제하면 그 교차로가 끊긴다
    const shut: number[] = [];
    for (const id of sim.city.nodes[e.a].edges) if (id !== edge && !sim.city.edges[id].closed) { sim.city.edges[id].closed = true; sim.city.edges[id].closedReason = 'disaster'; shut.push(id); }
    closeIncident(sim, I, 'resolved');
    sim.tick++; sim.t += sim.dt; tickWorld(sim);
    const [ob] = rubbles(sim);
    expect(ob.full).toBe(false);
    expect(e.closed).toBe(false);
    expect(KNOWN.exec(sim.events[ob.ev!].text)![2]).toBe('한 차로');
    for (const id of shut) { sim.city.edges[id].closed = false; sim.city.edges[id].closedReason = null; }
    expectLinked(sim, I, edge);
    // 같은 건물의 뒤 사건: 건물 상태를 적은 것이 앞 사건이면 닫혀도 잔해를 남기지 않는다 (쿨다운이 지난 뒤에도)
    sim.traffic.obstacles.length = 0;
    const J = createIncident(sim, { type: 'medical', variant: 'faint', placeId: I.truth.placeId, rng: sim.rng.fork('t2') });
    sim.t += RUBBLE.COOLDOWN + 5; sim.tick = Math.round(sim.t * 5);
    if (J.truth.placeId === I.truth.placeId) {      // (무너진 건물에는 새 사건이 나지 않는다 — placeGone 이 다른 건물로 돌리면 이 갈래는 건너뛴다)
      closeIncident(sim, J, 'resolved');
      sim.tick++; sim.t += sim.dt; tickWorld(sim);
      expect(rubbles(sim).length).toBe(0);
    }
    // 건물 상태가 무너짐·폭발이 아니면(그을림·일부 붕괴) 남기지 않는다
    const K = fireAt('C2-B2');
    K.sim.placeMarks.set(K.I.truth.placeId, { placeId: K.I.truth.placeId, state: 'partial', t: 0, incidentId: K.I.id, burnFrac: 0.2, ruinFrac: 0.2 });
    closeIncident(K.sim, K.I, 'resolved');
    K.sim.tick++; K.sim.t += K.sim.dt; tickWorld(K.sim);
    expect(rubbles(K.sim).length).toBe(0);
    // 폭발한 건물(blasted)은 X6 의 통제가 없어도 면한 구간에 남는다
    const B = fireAt('C2-B3');
    B.sim.placeMarks.set(B.I.truth.placeId, { placeId: B.I.truth.placeId, state: 'blasted', t: 0, incidentId: B.I.id, burnFrac: 0.1, ruinFrac: 0 });
    closeIncident(B.sim, B.I, 'resolved');
    B.sim.tick++; B.sim.t += B.sim.dt; tickWorld(B.sim);
    expect(rubbles(B.sim).map((o) => [o.edge, o.known])).toEqual([[B.edge, true]]);
  });
  it('(나) 큰 폭발: 현장에 대원이 있으면 알려진 통제, 없으면 아무도 모르는 잔해(진실 기록) — 부대가 가서 보고 되돌아 나오며 그 기록을 원인으로 잇는다', () => {
    // 1) 대원이 없는 현장의 폭발: 진실만 바뀐다
    const { sim, I, edge } = fireAt('C2-C');
    const e = sim.city.edges[edge];
    const boom = raiseProblem(sim, I, 'EXPLOSION', '보관 중이던 가스 용기 폭발', { role: 'SYSTEM', actor: '현장', truth: true, text: '시험: 가스 용기 폭발' }, false);
    signal(sim, 'catastrophe', { inc: I.id, ev: boom, size: 2.8, data: 0 });
    sim.tick++; sim.t += sim.dt; tickWorld(sim);
    const [ob] = rubbles(sim);
    expect([ob.edge, ob.full, ob.known]).toEqual([edge, true, false]);
    expect([e.closed, e.closedReason, e.known]).toEqual([true, 'obstacle', false]);
    expect(ob.tipAt - sim.t).toBeGreaterThanOrEqual(RUBBLE.TIP[0]);
    expect(ob.tipAt - sim.t).toBeLessThanOrEqual(RUBBLE.TIP[1]);
    const rec = sim.events[ob.ev!];
    expect([rec.kind, rec.actor, rec.truth, rec.causes]).toEqual(['traffic', '도시', true, [boom]]);
    expect(HIDDEN.test(rec.text)).toBe(true);
    expectLinked(sim, I, edge);
    // 그 구간으로 오던 부대: 가 보아야 안다 — 보고(알려짐)와 ROUTE_BLOCKED 가 그 잔해 기록을 원인으로, 막은 사건은 그 폭발의 사건
    const u = sim.units.find((q) => q.kind === 'engine')!;
    const from = e.a, to = e.b, n = sim.city.nodes[from];
    u.nodeId = from; u.x = u.px = n.x; u.y = u.py = n.y; u.route = null; u.seg = 0; u.segT = 0; u.pendingDest = null; u.curb = null; u.backing = false;
    u.state = 'enroute'; u.incidentId = I.id; u.dispatchedAt = sim.t;
    sendUnitTo(sim, u, to);
    expect(u.route!.edges[0], '아직 모르는 통제는 경로가 피하지 않는다').toBe(edge);
    let rb = I.problems.find((p) => p.code === 'ROUTE_BLOCKED');
    for (let k = 0; k < 600 && !rb; k++) { sim.tick++; sim.t = sim.tick * sim.dt; tickUnits(sim); rb = I.problems.find((p) => p.code === 'ROUTE_BLOCKED'); }
    expect(rb).toBeDefined();
    expect(ob.known).toBe(true);
    expect(e.known).toBe(true);
    expect(sim.events[rb!.eventId].causes).toEqual([ob.ev]);
    expect(rb!.ref).toEqual({ inc: I.id, unit: u.id, edge });
    expect(rb!.detail).toContain('건물 잔해');
    const report = sim.events.find((x) => x.id > ob.ev! && x.kind === 'traffic' && x.actor === u.callsign)!;
    expect(report.causes).toEqual([ob.ev]);
    expect(report.text).toContain('건물 잔해');
    // 2) 대원이 있는 현장의 폭발: 곧바로 알려진다. 폭발물(blast)은 반경 3.2 칸부터, X6 가 길을 막고 있는 사건(전체 붕괴)에는 더 놓지 않는다
    const A = fireAt('C2-D');
    const eng = A.sim.units.find((q) => q.kind === 'engine')!;
    dispatchUnit(A.sim, eng, A.I, 0); eng.state = 'onscene'; eng.nodeId = A.I.truth.nodeId;
    unitArrived(A.sim, A.I, eng);
    expect(A.sim.scenes[A.I.id]!.agents.some((a) => a.status === 'active')).toBe(true);
    const b0 = raiseProblem(A.sim, A.I, 'HIDDEN_HAZARD', '폭발물 폭발', { role: 'SYSTEM', actor: '현장', text: '시험: 폭발' }, false);
    signal(A.sim, 'blast', { inc: A.I.id, ev: b0, size: RUBBLE.BLAST_R - 0.2 });
    A.sim.tick++; A.sim.t += A.sim.dt; tickWorld(A.sim);
    expect(rubbles(A.sim).length, '작은 폭발은 잔해를 쏟지 않는다').toBe(0);
    signal(A.sim, 'blast', { inc: A.I.id, ev: b0, size: 3.4 });
    A.sim.tick++; A.sim.t += A.sim.dt; tickWorld(A.sim);
    const [oa] = rubbles(A.sim);
    expect([oa.edge, oa.known, oa.tipAt]).toEqual([A.edge, true, Infinity]);
    expect(A.sim.events[oa.ev!].causes).toEqual([b0]);
    expect(KNOWN.test(A.sim.events[oa.ev!].text)).toBe(true);
    expectLinked(A.sim, A.I, A.edge);
    // 같은 건물: 쿨다운(600초) 안에는 닫혀도 또 남기지 않는다
    A.sim.placeMarks.set(A.I.truth.placeId, { placeId: A.I.truth.placeId, state: 'blasted', t: 0, incidentId: A.I.id, burnFrac: 0, ruinFrac: 0 });
    A.sim.traffic.obstacles.length = 0; A.sim.city.edges[A.edge].closed = false; A.sim.city.edges[A.edge].closedReason = null;
    signal(A.sim, 'catastrophe', { inc: A.I.id, ev: b0, size: 3.6, data: 0 });
    A.sim.tick++; A.sim.t += A.sim.dt; tickWorld(A.sim);
    expect(rubbles(A.sim).length).toBe(0);
    // X6 가 이미 길을 막은 사건(전체 붕괴)의 폭발
    const X = fireAt('C2-E');
    collapseBuilding(X.sim, X.sim.scenes[X.I.id]!, X.I, catOf(X.sim, X.sim.scenes[X.I.id]!)!);
    X.sim.tick++; X.sim.t += X.sim.dt; tickWorld(X.sim);
    signal(X.sim, 'catastrophe', { inc: X.I.id, ev: X.I.blockEv!, size: 4, data: 0 });
    X.sim.tick++; X.sim.t += X.sim.dt; tickWorld(X.sim);
    expect(rubbles(X.sim).length).toBe(0);
  });
  it('실제 교대(보통 S0·S3·S7): 잔해 기록마다 원인이 그 사건의 폭발 기록이거나 종료 기록이고, 건물 상태(X6)와 맞는다', () => {
    let boom = 0, after = 0;
    for (const seed of ['S0', 'S3', 'S7']) {
      const { sim, m } = probedShift(seed);
      const recs = sim.events.filter((e) => e.kind === 'traffic' && (KNOWN.test(e.text) || HIDDEN.test(e.text)));
      expect(recs.length, seed).toBe(sim.world.log.filter((l) => l.rule === 'rubbleRoad').length);
      expect(recs.length).toBeLessThanOrEqual(RUBBLE.CAP);
      for (const r of recs) {
        expect(r.causes.length).toBe(1);
        const c = sim.events[r.causes[0]], I = sim.incidents[c.incidentId], pm = sim.placeMarks.get(I.truth.placeId)!;
        expect(I.truth.placeId).toBeGreaterThanOrEqual(0);
        if (c.kind === 'resolve') { after++; expect(r.actor).toBe('교통정보'); expect(['collapsed', 'blasted']).toContain(pm.state); expect(pm.incidentId).toBe(I.id); expect(r.t - I.closedAt).toBeLessThan(0.5); }
        else { boom++; expect(['EXPLOSION', 'HIDDEN_HAZARD']).toContain(c.problem); expect(r.truth).toBe(r.actor === '도시'); }
      }
      const c = m.consistency;
      expect([c.C1, c.C2, c.C3, c.C4, c.C5], seed).toEqual([0, 0, 0, 0, 0]);
    }
    expect(boom, '폭발의 잔해').toBeGreaterThan(0);
    expect(after, '사건 뒤에 남은 잔해').toBeGreaterThan(0);
  });
  it('장애물의 기록(ev): 인과 규칙이 놓은 것(quiet)은 놓은 쪽이 넣고, 교통 모델이 놓은 것은 그 알림 기록이다 (b3-5 — 초과 혼잡의 주인). 교대 내내 있는 불법 주차에는 없다', () => {
    const sim = new Sim('C2-F', NORMAL, 1200);
    sim.traffic.nextEvent = Infinity;
    for (const o of sim.traffic.obstacles) expect(o.ev).toBeUndefined();
    const e = sim.city.edges.find((q) => q.cls === 'street' && !q.closed && !sim.traffic.obstacles.some((o) => o.edge === q.id))!;
    const n0 = sim.events.length;
    const a = addObstacle(sim, { edge: e.id, kind: 'rubble', full: false, dur: 60, known: true, quiet: true })!;
    expect(sim.events.length, 'quiet: 놓은 쪽이 기록한다').toBe(n0);
    expect([a.kind, a.label, a.ev]).toEqual(['rubble', '건물 잔해', undefined]);
    sim.traffic.obstacles.length = 0;
    const b = addObstacle(sim, { edge: e.id, kind: 'debris', full: false, dur: 60, known: true })!;
    expect(sim.events.length).toBe(n0 + 1);
    expect(b.ev, '알림 기록이 그 장애물의 기록이 된다').toBe(n0);
    expect(sim.events[n0].text).toContain('낙하물');
  });
});

describe('I1-b b4: 보고서의 내력 문장 (§3.9 · §6 I1-b 15)', () => {
  const LAW_IDS = ['roadCrash', 'heatSpread', 'structFail', 'pipeLeak', 'rekindle', 'liftStall', 'smokeIll'];
  const STORY = ['reoffend', 'getaway', 'hideout', 'arson'];
  const shiftOf = (seed: string, d: Difficulty = NORMAL): Sim => probedShift(seed, d).sim;
  /** 법칙 사건·이야기 연쇄·건물 손상·정전이 나는 교대들 (해시 목록에서 고른 것 — 흐름이 바뀌어 사라져도 아래 문턱이 잡는다) */
  // (N8 단계 8·9) 지진 S6 을 더했다 (표본만 넓힌다): 구조 유형이 평소 추첨에 들어 지진 S2 의 금 간 건물 문장이 없어졌다 — 지진 S0~S7 가운데 'wear' 문장이 있는 하나
  const SHIFTS: [string, Difficulty][] = [['S1', NORMAL], ['S4', NORMAL], ['S5', NORMAL], ['S15', NORMAL], ['S19', NORMAL], ['S20', NORMAL], ['S2', QUAKE], ['S6', QUAKE]];
  it('문장마다 가리키는 기록·사건·구간·건물이 있다 — 법칙 사건은 주된 몫의 갈래로 한 문장, "약 N초"는 그 몫의 at − since 이고 그 원인 기록보다 앞서지 않는다. 법칙 이름이 문장에 없다', () => {
    let hzN = 0, storyN = 0, kidsN = 0, wearN = 0, lineN = 0;
    const kinds = new Set<string>();
    for (const [seed, d] of SHIFTS) {
      const sim = shiftOf(seed, d), r = sim.report!;
      for (const x of r.incidents) {
        const I = sim.incidents[x.id];
        const lines = chainLines(sim, I);
        expect(x.chain ?? [], `${seed} #${I.code}`).toEqual(lines.map((L) => L.text));
        expect(lines.length).toBeLessThanOrEqual(CHAIN_LINES);
        expect(x.parent).toBe(I.parent);
        expect(x.children ?? []).toEqual(sim.incidents.filter((J) => J.parent === I.id).map((J) => J.id));
        for (const L of lines) {
          lineN++; kinds.add(L.kind);
          for (const e of L.ev) expect(sim.events[e], `${seed} #${I.code} ${L.text}`).toBeDefined();
          for (const k of L.inc) expect(sim.incidents[k]).toBeDefined();
          for (const e of L.edge) expect(sim.city.edges[e], L.text).toBeDefined();
          for (const q of L.place) expect(sim.city.places[q], L.text).toBeDefined();
          for (const w of [...LAW_IDS, '법칙']) expect(L.text.includes(w), `${L.text} 에 ${w}`).toBe(false);
          expect(L.text).toMatch(/[.)]$/);
          if (L.kind === 'children') { kidsN++; for (const J of sim.incidents) if (J.parent === I.id) expect(L.text).toContain(J.code); }
          if (L.kind === 'wear') { wearN++; expect(L.text).toContain(sim.scenes[I.id]!.wear!.inc); }
        }
        if (I.hz) {
          hzN++;
          const L = lines.find((q) => q.kind === 'hz')!, s0 = I.hz.src[0];
          expect(L, `${seed} #${I.code} 의 내력 문장`).toBeDefined();
          if (s0.ev >= 0) { expect(L.ev).toContain(s0.ev); expect(sim.events[s0.ev].t).toBeLessThanOrEqual(I.hz.at); }
          if (I.cause !== undefined) expect(L.ev).toContain(I.cause);
          expect(I.hz.law === 'roadCrash' ? L.edge : L.place).toContain(I.hz.target);      // 대상(구간·건물)이 문장에 있다
          if (s0.inc >= 0) expect(L.text).toContain(`사건 ${sim.incidents[s0.inc].code}`);
          if (L.n !== undefined) {
            expect(L.n).toBeLessThanOrEqual(Math.max(10, I.hz.at - s0.since + 5));
            if (s0.ev >= 0) expect(L.n).toBeLessThanOrEqual(Math.max(10, I.hz.at - sim.events[s0.ev].t + 12));      // §3.9 끝: N ≤ hz.at − 그 기록의 시각 + 12
          }
        }
        if (I.csq !== undefined && STORY.includes(I.csq) && I.parent !== undefined) {
          storyN++;
          expect(lines[0].kind).toBe('story');
          expect(lines[0].text).toContain(`사건 ${sim.incidents[I.parent].code}`);
        }
      }
      // 교대 요약의 '인과:' 줄 — 법칙 사건이나 이야기 연쇄가 있을 때만
      const causal = r.summary.filter((t) => t.startsWith('인과: '));
      const laws = sim.incidents.filter((J) => J.hz !== undefined), story = sim.incidents.filter((J) => J.csq !== undefined && STORY.includes(J.csq));
      expect(causal.length, seed).toBe(laws.length + story.length > 0 ? 1 : 0);
      if (laws.length) expect(causal[0]).toContain(`상태에서 난 사건 ${laws.length}건`);
      if (story.length) expect(causal[0]).toContain(`이야기 연쇄 ${story.length}건`);
      for (const t of r.summary) for (const w of LAW_IDS) expect(t.includes(w), t).toBe(false);
      expect(r.world!.lines.every((t) => r.summary.includes(t))).toBe(true);
      expect(r.world!.spawned).toBe(sim.world.log.filter((q) => q.made >= 0).length);
    }
    expect(hzN, '법칙 사건').toBeGreaterThanOrEqual(6);
    expect(storyN, '이야기 연쇄').toBeGreaterThanOrEqual(1);
    expect(kidsN, '자식 줄').toBeGreaterThanOrEqual(4);
    expect(wearN, '금 간 건물').toBeGreaterThanOrEqual(1);
    expect(lineN).toBeGreaterThan(20);
    for (const k of ['hz', 'story', 'children', 'wear', 'blocked']) expect(kinds.has(k), k).toBe(true);
  }, 180000);
  it('법칙 사건도 이야기 연쇄도 없는 교대에는 "인과:" 줄이 없다 (보통 S2)', () => {
    const sim = shiftOf('S2');      // (N8 단계 4a·4b) 시설 사고 유형이 추첨에 들어 S0 에 법칙 사건이 생겼다 — 법칙·이야기 연쇄가 없는 S2 로
    expect(sim.incidents.some((J) => J.hz !== undefined || J.csq !== undefined)).toBe(false);
    expect(sim.report!.summary.some((t) => t.startsWith('인과:'))).toBe(false);
  }, 60000);
  it('자식 줄의 괄호는 그 부모가 주인인 몫의 갈래다 — 내력의 몫에 그 부모가 없으면 법칙의 이름표로', () => {
    let n = 0;
    for (const [seed, d] of SHIFTS) {
      const sim = shiftOf(seed, d);
      for (const J of sim.incidents) {
        if (!J.hz || J.parent === undefined) continue;
        const P = sim.incidents[J.parent], L = chainLines(sim, P).find((q) => q.kind === 'children');
        if (!L) continue;      // 넉 줄에서 잘렸다
        n++;
        const own = J.hz.src.filter((x) => x.inc === P.id).sort((a, b) => b.w - a.w)[0];
        expect(L.text).toContain(`${J.code} ${scenarioName(J.truth.type, J.truth.variant)}(${own ? HZ_SHORT[own.what] : hazardLabel(J.hz.law)})`);
      }
    }
    expect(n).toBeGreaterThanOrEqual(3);
  }, 60000);
  it('손으로 만든 내력: 통제 뒤 몰린 길(divert) · 둘째 몫 · 기록 없는 큰 몫 · 전환의 늦어진 초 · 금 간 건물 — 문장이 기록을 가리킨다', () => {
    const s = new Sim('S2', NORMAL, 1200);
    for (let k = 0; k < 20; k++) s.step();
    const T = createIncident(s, { type: 'traffic', variant: 'tree' });
    const c = T.blockedEdge, e2 = s.city.edges.find((e) => e.id !== c && !e.closed)!;
    s.t += 140;
    const J = createIncident(s, { type: 'traffic', variant: 'std', nodeId: e2.a });
    const dark = emit(s, { role: 'SYSTEM', actor: '한국전력', kind: 'hazard', tag: 'power', imp: 1, text: '시험 — 정전.' });
    J.hz = { law: 'roadCrash', target: e2.id, at: s.t, src: [
      { ev: T.blockEv!, inc: T.id, w: 0.6, what: 'divert', ref: c, since: s.events[T.blockEv!].t },
      { ev: dark, inc: -1, w: 0.3, what: 'dark', ref: e2.id, since: s.t - 20 },
      { ev: -1, inc: -1, w: 0.5, what: 'jam', ref: e2.id, since: s.t - 60 }] };      // 기록 없는 몫이 전체의 1/3 이상 — 장부의 구멍
    const L = chainLines(s, J)[0];
    const name = (id: number): string => `${s.city.edges[id].name} ${(s.city.edges[id].seq ?? 0) + 1}구간`;
    expect(L.kind).toBe('hz');
    expect(L.text).toBe(`${name(c)} 통제(사건 ${T.code} 쓰러진 나무) 뒤 ${name(e2.id)}에 차량이 몰린 동안(약 140초) 난 사고입니다 (정전으로 꺼진 신호도 겹쳤습니다) (까닭이 기록되지 않은 혼잡도 겹쳤습니다).`);
    expect(L.ev).toEqual([T.blockEv, dark]);
    expect(L.edge).toEqual([e2.id, c]);
    expect(L.n).toBe(140);
    // 전환의 늦어진 초 (C6 — DIVERTED 의 ref.lost, §6 I1-b 2)
    const u = s.units.find((q) => q.dept === 'ems')!;
    raiseProblem(s, J, 'DIVERTED', '시험', { role: 'DISPATCH', actor: '배정 AI', text: '시험: 전환 배정' }, false, { inc: T.id, unit: u.id, lost: 52 });
    const D = chainLines(s, J).find((q) => q.kind === 'divert')!;
    expect(D.text).toMatch(new RegExp(`^${u.callsign}[이가] 사건 ${T.code}\\(쓰러진 나무\\)로 돌려져 첫 도착이 약 52초 늦었습니다\\.$`));
    expect(D.inc).toEqual([T.id]);
    // 금 간 건물에서 난 사건 (현장의 wear)
    const F = createIncident(s, { type: 'fire', variant: 'std' });
    s.scenes[F.id]!.wear = { dmg: 0.3, soot: 0, cause: 'shock', inc: T.code, pre: 0 };
    const W = chainLines(s, F).find((q) => q.kind === 'wear')!;
    expect(W.text).toBe(`이 건물은 사건 ${T.code}의 충격으로 이미 금이 가 있었습니다.`);
    expect(W.inc).toEqual([T.id]);
  });
});

describe('I1-b b4: 교대 중에 보이는 표시 — 읽기만 한다 (§7)', () => {
  it('지도의 정전·연기 자리 · 금 간 건물·끊긴 배관 · 사건 카드의 내력 칩: 그려도 세계 상태와 기록이 그대로고, AI 시점에는 진실 전용 표시(금·배관·내력 칩)가 없다', async () => {
    const s = new Sim('S1', QUAKE, 1200);
    let sawZone = false, sawCrack = false, sawHz = false;
    while (s.t < 900 && !s.ended) {
      s.step();
      if (s.tick % 250 !== 0) continue;
      const before = JSON.stringify(s.world) + '|' + s.logHash + '|' + s.events.length;
      await withFakeDom(() => {
        for (const truth of [true, false]) {
          drawZonesWorld(fakeCtx(), s, { truth, timeMs: 1000, scale: 0.8, mini: false });
          drawExpoWorld(fakeCtx(), s, { truth, timeMs: 1000, scale: 0.8, mini: false });
          for (const I of s.incidents) {
            const c = causeChip(I, truth);
            if (!truth) expect(c).toBeNull();
            else if (I.hz) { expect(c!.text).toBe(HZ_SHORT[I.hz.src[0].what]); sawHz = true; }
          }
        }
      });
      expect(JSON.stringify(s.world) + '|' + s.logHash + '|' + s.events.length, `t=${s.t}`).toBe(before);
      if (s.world.zones.some((Z) => Z.power < 1)) sawZone = true;
      if (Object.values(s.world.expo).some((e) => e.shake >= 0.1)) sawCrack = true;
    }
    expect([sawZone, sawCrack]).toEqual([true, true]);
    void sawHz;
  }, 60000);
  it('소스 글자: 그림·화면 파일은 세계 상태를 만들거나 바꾸는 함수를 부르지 않는다 (expoOf 는 없는 칸을 만든다)', () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(dir + '/' + e.name) : /\.(ts|tsx)$/.test(e.name) ? [dir + '/' + e.name] : []));
    for (const f of [...walk('src/view'), ...walk('src/ui')]) {
      const src = readFileSync(f, 'utf8');
      for (const w of ['expoOf(', 'hazardImpulse(', 'setZone(', 'setZoneArea(', 'endZoneBy(', 'applyExpo(', 'noteRoadCause(', 'addBump(']) expect(src.includes(w), `${f} 에 ${w}`).toBe(false);
    }
  });
});

describe('I1-b b5: 완료 조건의 정해진 시드 (§5 · §6 I1-b 8)', () => {
  /** 확산 길(distinct ≥ 3) 위의 사건들 */
  function spreadThrough(sim: Sim): { I: Incident; path: number[]; incs: Incident[] }[] {
    const sys = sim.events.map(sysOf), sp = spreadByIncident(sim.events, sys, sim.incidents.length), out: { I: Incident; path: number[]; incs: Incident[] }[] = [];
    for (const I of sim.incidents) {
      const b = sp.inc[I.id];
      if (b.distinct < 3) continue;
      const path = spreadPath(sim.events, sys, sp.graph, b.start);
      const incs: Incident[] = [];
      for (const id of path) { const k = sim.events[id].incidentId; if (k >= 0 && !incs.includes(sim.incidents[k])) incs.push(sim.incidents[k]); }
      out.push({ I, path, incs });
    }
    return out;
  }
  it('3단계 사례: 한 사건에서 서로 다른 사건·시스템으로 세 단계 넘게 퍼진 길이 법칙 사건을 지난다 — 보통 S3684(건물 화재 → 옆 건물로 옮겨붙은 불 → 그 불의 연기 → 연기를 마신 주민) · 보통 S33(퍼진 길이 몰린 길의 사고를 지난다)', () => {
    // (N8 단계 4a·4b) 시설 사고 유형이 추첨에 들어 S33·S26 의 사건이 바뀌었다 — 같은 길(옮겨붙은 불 + 연기를 마신 주민 · 몰린 길의 사고)이 있는 시드로 (표본을 넓혀 찾았다: S0~S529)
    // (N8 단계 6a) 경찰 새 부대 셋(형사·교통 경찰·경찰견)이 편성돼 S293·S5 의 길이 바뀌었다 — 같은 길이 있는 시드로 (표본을 넓혀 찾았다: 옮겨붙은 불 + 연기를 마신 주민은 S0~S999 에 없었고 그 뒤를 훑어 S1800 · 몰린 길의 사고는 S24)
    // (N8 단계 6b) 교통사고가 견인차를 기다려 S24 의 몰린 길의 사고가 확산 길에서 빠졌다 — 같은 길이 있는 시드로 (S0~S119 에 없어 그 뒤를 훑어 S234)
    // (N8 단계 8·9) 구조 유형이 평소 추첨에 들어 두 시드의 길이 바뀌었다 — S234 → S66(몰린 길의 사고 — S0~S120 을 훑어 첫 번째) ·
    //  S1800 → S3684(옮겨붙은 불 + 연기를 마신 주민 — 보통 S0~S409·S2400~S3308·S3600~S3684 와 강제 화재 S0~S399 를 훑어 처음 나온 것)
    // (N8 단계 10) 중복 신고·조건부 연쇄가 들어 S66 의 길이 바뀌었다 — S66 → S33(몰린 길의 사고 — S0~S60 을 훑어 처음 나온 것)
    const want: [string, string[]][] = [['S3684', ['heatSpread', 'smokeIll']], ['S33', ['roadCrash']]];
    for (const [seed, laws] of want) {
      const sim = probedShift(seed).sim;
      const hits = spreadThrough(sim).filter((x) => x.incs.some((J) => J !== x.I && J.hz !== undefined));
      expect(hits.length, `${seed} 의 법칙을 지나는 확산 길`).toBeGreaterThanOrEqual(1);
      const h = hits[0], viaLaws = h.incs.filter((J) => J.hz !== undefined).map((J) => J.hz!.law);
      for (const l of laws) expect(viaLaws, seed).toContain(l);
      // 길 위의 법칙 사건마다 그 사건의 발생 기록이 앞 단계의 기록을 원인으로 가리킨다 (스크립트가 아니라 상태의 몫으로 이은 원인)
      for (const J of h.incs) if (J.hz) { const root = sim.events[J.rootEvent]; expect(root.causes.length, `${seed} #${J.code}`).toBeGreaterThan(0); expect(root.causes).toContain(J.cause); }
      // 사슬 문장이 그 길을 말한다 — 법칙 사건의 내력 문장에 앞 사건의 코드가 있다
      for (const J of h.incs) if (J.hz && J.hz.src[0].inc >= 0) expect(chainLines(sim, J)[0].text).toContain(`사건 ${sim.incidents[J.hz.src[0].inc].code}`);
    }
  }, 120000);
  it('법칙 사건의 통제를 만난 다른 사건의 부대 (완료 조건 2): ROUTE_BLOCKED 의 원인이 그 법칙 사건의 통제 기록이다 — 극한 S4·S7', () => {
    let n = 0;
    for (const seed of ['S4', 'S7', 'S26', 'S8', 'S13', 'S25']) {      // (N8 단계 7 뒤 절반) S25 를 더했다 — 위기자·문 잠긴 집이 짧은 사건에 들어 다섯의 그런 부대가 없어졌다 (극한 S0~S29 가운데 S25·S29)      // (N8 단계 8·9) S13 을 더했다 — 구조 유형이 평소 추첨에 들어 넷의 그런 부대가 없어졌다 (극한 S0~S13 가운데 S13 하나)      // (N8 단계 6b) S8 을 더했다 — 교통사고의 견인으로 셋의 그런 부대가 없어졌다 (S0~S39 가운데 S8 하나) · (N8 단계 6a) S26 을 더했다 — 경찰 새 부대 셋이 편성돼 S4·S7 의 그런 부대가 없어졌다 (S0~S29 가운데 S26·S28) · (N8 단계 4a·4b) 시설 사고 유형이 추첨에 들어 극한 S3 의 사건이 바뀌었다 — 그런 부대가 있는 S7 로 (S0~S15 가운데 S7 하나)
      const sim = probedShift(seed, parseDifficulty('extreme')!).sim;
      const lawBlock = new Map<number, Incident>();
      for (const J of sim.incidents) if (J.hz && J.blockEv !== undefined) lawBlock.set(J.blockEv, J);
      for (const e of sim.events) {
        if (e.problem !== 'ROUTE_BLOCKED') continue;
        for (const c of e.causes) { const J = lawBlock.get(c); if (J && e.incidentId !== J.id) { n++; expect(sim.events[c].text, `${seed}`).toMatch(/통제|막/); } }
      }
    }
    expect(n).toBeGreaterThanOrEqual(1);
  }, 120000);
});

describe('I1-b 검토: 교대 요약의 세계 상태 수는 실제로 일어난 일을 센다 (§3.9 — 보고서는 기록과 상태에서만)', () => {
  it('정전 수는 실제로 연 정전의 수다 — 태풍 정전의 복구(blackout data 0)·아무 동네도 끄지 못한 여진은 세지 않는다', () => {
    const s = new Sim('S0', NORMAL, 1200);
    s.gen.nextAt = s.gen.majorAt = Infinity; s.gen.nextNuisanceAt = Infinity; s.traffic.nextEvent = Infinity;
    const tk = (sec: number): void => { for (let k = 0; k < Math.round(sec / s.dt); k++) { s.tick += 1; s.t = s.tick * s.dt; tickWorld(s); } };
    tk(2);
    // 태풍 정전 한 번: 꺼짐(data 1) → 120초 뒤 켜짐(data 0)
    const out = emit(s, { role: 'SYSTEM', actor: '재난 관리', kind: 'hazard', imp: 2, text: '시험: 강풍에 송전선이 끊겨 도시 곳곳이 정전됐습니다.' });
    signal(s, 'blackout', { inc: -1, ev: out, data: 1 });
    tk(3);
    expect(s.world.zones.every((Z) => Z.power === 0 && Z.cause.power === out), '모든 동네가 그 정전').toBe(true);
    tk(117);
    signal(s, 'blackout', { inc: -1, ev: out, data: 0 });
    tk(3);
    expect(s.world.zones.every((Z) => Z.power === 1), '전력 복구').toBe(true);
    // 아무 동네도 끄지 못한 약한 여진 (흔들림이 모든 동네 전력망의 문턱 0.3 아래)
    const af = emit(s, { role: 'SYSTEM', actor: '재난 관리', kind: 'hazard', imp: 1, text: '시험: 약한 여진.' });
    signal(s, 'quake', { inc: -1, ev: af, x: DISTRICTS[0].x, y: DISTRICTS[0].y, mag: 0.05 });
    tk(3);
    expect(s.world.zones.every((Z) => Z.power === 1), '여진은 아무것도 끄지 못했다').toBe(true);
    const w = worldReport(s);
    expect(w.outages, '정전은 한 번').toBe(1);
    expect(w.lines.find((t) => t.startsWith('세계 상태:')), '세계 상태 줄').toContain('정전 1회');
  });
  it('밀림의 뿌리가 사고가 난 그 구간 자신이면 같은 구간 이름을 두 번 쓰지 않는다 — 먼저 난 사고로 느려진 구간에 밀린 차들 사이의 사고 (보통 S26 #11 의 꼴)', () => {
    const s = new Sim('S2', NORMAL, 1200);
    for (let k = 0; k < 20; k++) s.step();
    const P = createIncident(s, { type: 'traffic', variant: 'std' });
    const e = s.city.edges[P.blockedEdge];
    s.t += 36;
    const J = createIncident(s, { type: 'traffic', variant: 'std', nodeId: e.a });
    J.hz = { law: 'roadCrash', target: e.id, at: s.t, src: [{ ev: P.rootEvent, inc: P.id, w: 0.9, what: 'queue', ref: e.id, since: s.events[P.rootEvent].t }] };
    const L = chainLines(s, J)[0], name = `${e.name} ${(e.seq ?? 0) + 1}구간`;
    expect(L.text.split(name).length - 1, L.text).toBe(1);
    expect(L.text).toBe(`${name}의 사고(사건 ${P.code} 교통사고)로 밀려 있던 그 구간에서 난 사고입니다.`);
    expect(L.edge).toEqual([e.id, e.id]);
    expect(L.ev).toEqual([P.rootEvent]);
  });
  it('연기 수는 연기가 동네로 번진 건수(연기 알림)다 — 연기 규칙은 장부 줄(world.log)을 남기지 않는다 (보통 S3)', () => {
    const sim = probedShift('S3').sim, n = sim.events.filter((e) => e.tag === 'smoke').length;
    expect(n, 'S3 에는 연기 알림이 있다').toBeGreaterThanOrEqual(1);
    const st = sim.report!.world!.lines.find((t) => t.startsWith('세계 상태:'));
    expect(st, '세계 상태 줄').toBeDefined();
    expect(st).toContain(`연기 ${n}건`);
  }, 60000);
});
