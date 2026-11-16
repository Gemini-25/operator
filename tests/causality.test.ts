// 측정 도구 (docs/specs/I1-causality.md §2 · §6 의 I1-a): 결과 불변, 손 계산, 문구 규칙, 멈춤 감지기, 연쇄 깊이, 일치 검사, 요약 모양
import { describe, expect, it } from 'vitest';
import { PROBLEM_LABEL } from '../src/sim/debrief';
import { NORMAL, parseDifficulty, parseDisaster } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { blockersOf } from '../src/sim/dispatch/dispatcher';
import { emit } from '../src/sim/events';
import { BeliefStore, heardEv, mergeHeard, mkFact } from '../src/sim/field/beliefs';
import { createIncident } from '../src/sim/incidents';
import { findRoute } from '../src/sim/city';
import type { EventKind, Incident, Responder, Role, SimEvent, Unit } from '../src/sim/types';
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
  if (opts.tag !== undefined) (e as SimEvent & { tag?: string }).tag = opts.tag;
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
  it('T1·T2·T3·T4·T7 이 보통 S7 의 기록과 맞고, 그 기록의 시스템이 맞다', () => {
    // 시드는 다섯 문구가 모두 나오는 교대로 고른다 (R1 에서 대원 수가 바뀌어 모든 시드의 결과가 달라졌다: S1 에는 응급실 대기가 없어졌고 S7 에는 5건 있다)
    const { sim } = probedShift('S7');
    const hit = (re: RegExp): SimEvent[] => sim.events.filter((e) => re.test(e.text));
    for (const k of ['T1', 'T2', 'T3', 'T4', 'T7'] as const) expect(hit(PHRASE[k]).length, k).toBeGreaterThan(0);
    expect(hit(PHRASE.T1).every((e) => sysOf(e) === 'aid')).toBe(true);
    expect(hit(PHRASE.T2).every((e) => sysOf(e) === 'hospital')).toBe(true);
    expect(hit(PHRASE.T4).every((e) => sysOf(e) === 'hospital')).toBe(true);
    expect(hit(PHRASE.T7).every((e) => sysOf(e) === 'dispatch')).toBe(true);
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
  it.skip('T5(지난 교대에서 이어받은 상태) — I2 뒤에 켠다', () => {});
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
  });
});

describe('요약 모양', () => {
  const KEYS = ['chain', 'systems', 'replan', 'alt', 'actions', 'contention', 'stall', 'variety', 'consistency'] as const;
  it('교대 둘의 요약에 아홉 키가 있고, 글자 줄의 접두어가 고정이다', () => {
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
    expect(lines.slice(0, 9).map((l) => l.split(':')[0])).toEqual([...KEYS]);
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
      ['S1', NORMAL, 'fire/arson', ['arson']], ['S0', NORMAL, 'armed/kidnap', ['hideout']], ['S4', NORMAL, null, ['arson']], ['S1', parseDifficulty('extreme')!, 'armed/std', ['reoffend', 'getaway', 'hideout']],
    ];
    const seen = new Set<string>();
    for (const [seed, d, force, csqs] of cases) {
      const { sim, m } = probedShift(seed, d, force);
      const kids = sim.incidents.filter((J) => J.parent !== undefined);
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
    for (const seed of ['S0', 'S1', 'S3']) {
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
