// 측정 도구 (docs/specs/I1-causality.md §2 · §6 의 I1-a): 결과 불변, 손 계산, 문구 규칙, 멈춤 감지기, 연쇄 깊이, 일치 검사, 요약 모양
import { describe, expect, it } from 'vitest';
import { PROBLEM_LABEL } from '../src/sim/debrief';
import { NORMAL, parseDifficulty, parseDisaster } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import type { EventKind, Incident, Role, SimEvent } from '../src/sim/types';
import {
  PHRASE, PROBLEM_SYS, Probe, SAMPLE_EVERY, STALL_ALLOW, STALL_SEC, SYSTEMS, causeDepths, causesDepthByIncident, checkC5, checkMetrics,
  divertAnalysis, eventSystems, formatLines, linkCounts, metricsJson, runWithProbe, shiftMetrics, spreadByIncident, spreadDistinct,
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
  it('T1·T2·T3·T4·T7 이 보통 S1 의 기록과 맞고, 그 기록의 시스템이 맞다', () => {
    const { sim } = probedShift('S1');
    const hit = (re: RegExp): SimEvent[] => sim.events.filter((e) => re.test(e.text));
    for (const k of ['T1', 'T2', 'T3', 'T4', 'T7'] as const) expect(hit(PHRASE[k]).length, k).toBeGreaterThan(0);
    expect(hit(PHRASE.T1).every((e) => sysOf(e) === 'aid')).toBe(true);
    expect(hit(PHRASE.T2).every((e) => sysOf(e) === 'hospital')).toBe(true);
    expect(hit(PHRASE.T4).every((e) => sysOf(e) === 'hospital')).toBe(true);
    expect(hit(PHRASE.T7).every((e) => sysOf(e) === 'dispatch')).toBe(true);
  });
  it('T6(결원 운용 중단)이 대원이 다치는 교대(극한 S10·S13·S18 가운데 처음 맞는 것)의 기록과 맞는다', () => {
    const ext = parseDifficulty('extreme')!;
    let found: SimEvent | null = null;
    for (const seed of ['S10', 'S13', 'S18']) {
      const s = new Sim(seed, ext, 1200); s.runToEnd();
      found = s.events.find((e) => PHRASE.T6.test(e.text)) ?? null;
      if (found) break;
    }
    expect(found).not.toBe(null);
    expect(sysOf(found!)).toBe('crew');
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
  it('보통 S0~S3 에서 C1~C4 위반 0', () => {
    for (const seed of ['S0', 'S1', 'S2', 'S3']) {
      const c = probedShift(seed).m.consistency;
      expect([c.C1, c.C2, c.C3, c.C4], seed).toEqual([0, 0, 0, 0]);
    }
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
  });
});
