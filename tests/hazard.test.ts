// 초과 위험 과정과 교통의 장부 (I1-b b3-4 · b3-5 — docs/specs/I1-causality.md §3.6a·§3.6b, 시험 목록 §6 I1-b 5·6·9·12·13).
// 틀의 시험은 가짜 법칙으로 한다: registerHazard 로 넣고 finally 에서 거둔다 — 등록은 그 파일의 모든 Sim 에 걸리므로(모듈 전역) 자기 Sim 만 돌린다.
// 대부분 sim.step() 없이 tickHazards(sim) 만 부른다 — 빠르고 다른 원인이 끼지 않는다. 시각은 sim.t 를 손으로 옮긴다(틱마다 1초).
// 뒤 단계가 진짜 법칙을 등록해도 이 시험이 흔들리지 않게, 가짜 법칙을 넣는 동안에는 등록된 법칙을 모두 치워 둔다(withLaws).
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CHAIN_MAX, CHAIN_SHIFT_MAX, canChain, chainedInShift, noteChainDrop } from '../src/sim/chain';
import { NORMAL, parseDisaster } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { findRoute } from '../src/sim/city';
import { emit } from '../src/sim/events';
import { closeIncident, createIncident, tickIncidents } from '../src/sim/incidents';
import type { SpawnOpts } from '../src/sim/incidents';
import type { HazardLawId, HzCell, Incident } from '../src/sim/types';
import { CSQ_SPAWN_CAP, HZ, hazardCell, hazardImpulse, hazardLabel, hazardLaws, registerHazard, ruleLoad, tickHazards } from '../src/sim/world/hazard';
import type { HazardLaw, HzPart } from '../src/sim/world/hazard';
import { CSQ_SPAWN_CAP as CAP_AGAIN } from '../src/sim/world/consequence';
import { HAZARD_LAWS, checkMetrics, formatLines, hazardShift, summarize } from '../scripts/metrics';
import { HazProbe, hazJson, hazLines, sumHaz } from '../scripts/hazstats';
import type { HazCount } from '../scripts/hazstats';
import { roadSill } from '../src/sim/disaster';
import { DIVERT, LANES, LEVEL_EX, addBump, addObstacle, canBlock, noteBump, noteRoadCause, reallyLinked, removeBump, roadFlow, roadParts, unnoteBump } from '../src/sim/traffic';
import type { RoadPart } from '../src/sim/traffic';
import type { ShiftMetrics } from '../scripts/metrics';
import { ROAD, roadSurface, roadWeight } from '../src/sim/world/laws/road';
import { HEAT, heatMul, heatRate, heatTargets } from '../src/sim/world/laws/heat';
import { NB_REACH, expoOf, neighborsOf, neighborsOfPoint, pointGap, wallGap } from '../src/sim/world/expo';
import { knownHazardNear, placeState } from '../src/sim/world/state';
import { FIRE_LOAD_MIN, fireCauseEv, fireLoad, tickFire } from '../src/sim/field/hazards';
import { SPREAD_SEV, assess } from '../src/sim/dispatch/analyst';
import { raiseProblem } from '../src/sim/events';
import { INCIDENT_PLACES } from '../src/sim/cityPlan';
import type { Place } from '../src/sim/types';
import { T as TILE } from '../src/sim/types';
import type { Scene, Signal } from '../src/sim/types';
import { consequences, signal, tickWorld } from '../src/sim/world/consequence';
import { EXPO_LEAK, GAS_KINDS, SHOCK, applyExpo, shockDelta } from '../src/sim/world/expo';
import { CAT, catOf, collapseBuilding, collapseRegion } from '../src/sim/field/catastrophe';
import { NO_SENSE, chooseMethod } from '../src/sim/field/methods';
import { tickScene, unitArrived } from '../src/sim/field/sceneManager';
import { sysOf } from '../scripts/metrics';
import { PIPE, STRUCT } from '../src/sim/world/laws/shock';
import { REKINDLE } from '../src/sim/world/laws/ember';
import { EMBER, RESIDUAL, emberDelta, residualOf } from '../src/sim/world/expo';
import { hazardCellFor } from '../src/sim/world/hazard';
import { REOFFEND, policeNear, reoffendItem, reoffendPlace } from '../src/sim/field/hazards';
import { ARMED_BIAS } from '../src/sim/incidents';
import { RISK } from '../src/sim/world/rules/risk';
import { knownZone, knownZoneOfIncident, zoneName, zoneOfXY } from '../src/sim/world/state';
import { ZONE_SEV } from '../src/sim/dispatch/analyst';
import type { Hostile } from '../src/sim/types';
import { COMMS, POWER, SMOKE } from '../src/sim/world/rules/infra';
import { LIFT, darkened, liftDelta, liftOcc, liftPlaces } from '../src/sim/world/expo';
import { LIFT_LAW } from '../src/sim/world/laws/power';
import { HOSPITAL_CAP, endZoneBy, isDark, recoverWorld, setZone, setZoneArea, zoneAt, zoneOfPlace } from '../src/sim/world/state';
import { POWER_SEV } from '../src/sim/dispatch/analyst';
import { DISTRICTS } from '../src/sim/cityPlan';
import { makeAgent } from '../src/sim/field/agents';
import { FLOOD, floodPlaces, sillOf } from '../src/sim/world/rules/infra';
import { ILL, smokeBase, smokeExposure, smokeTargets } from '../src/sim/world/expo';
import { SMOKE_ILL } from '../src/sim/world/laws/smoke';
import { SMOKE_OUT, smokeOutdoor } from '../src/sim/field/rules/smoke';
import { SCENE_RULES } from '../src/sim/field/sceneRegistry';
import { methodsRule } from '../src/sim/field/rules/methods';
import { FIRE_BIG, tickMedical } from '../src/sim/field/hazards';
import { scenarioName } from '../src/sim/scenarios';
import { NATURE_LIK, makeCaller } from '../src/sim/dispatch/callSystem';
import { registerConsequence } from '../src/sim/world/consequence';
import { ZONE_DEFAULT } from '../src/sim/world/state';
import { riverDist } from '../src/sim/city';
import { isIndoor, tileOf } from '../src/sim/field/grid';
import { TYPE_DEFS } from '../src/sim/incidentTypes';

const T = (name: string): HazardLawId => ('t-' + name) as HazardLawId;
/** 등록된 법칙을 모두 치우고 시험 법칙만 넣어 fn 을 돌린 뒤 되돌린다 */
function withLaws<R>(laws: HazardLaw[], fn: () => R): R {
  const reg = hazardLaws() as HazardLaw[];
  const saved = reg.splice(0, reg.length);
  const offs = laws.map((l) => registerHazard(l));
  try { return fn(); } finally { for (const off of offs) off(); reg.splice(0, reg.length, ...saved); }
}
interface Fake { law: HazardLaw; rates: Map<number, HzPart[]>; can: boolean; opts: (target: number, cell: HzCell) => SpawnOpts | null; spawned: { target: number; n: number; u2: number; main: HzPart; total: number }[] }
/** 가짜 법칙: rates 에 넣은 대상·몫을 그대로 내놓는다. can 이 거짓이면 spawn 이 null(기다린다). 기본으로 내는 사건은 그 번호의 교차로의 교통사고 */
function fake(name: string, over: Partial<HazardLaw> = {}, id: HazardLawId = T(name)): Fake {
  const f: Fake = {
    rates: new Map(), can: true, spawned: [],
    opts: (target) => ({ type: 'traffic', variant: 'std', severity: 1, nodeId: target, note: '시험 법칙의 사고' }),
    law: null as unknown as HazardLaw,
  };
  f.law = {
    id, label: '시험 법칙 ' + name, every: 1, once: false, cap: 99,
    scan: (_sim, put) => { for (const [t, parts] of f.rates) put(t, parts); },
    spawn: (_sim, target, cell, main, total) => { if (!f.can) return null; f.spawned.push({ target, n: cell.n, u2: cell.u2, main: { ...main }, total }); return f.opts(target, cell); },
    ...over,
  };
  return f;
}
/** 평소 생성기·대형 사고·교통 사건을 얼린 교대 (법칙이 낸 사건만 남게) */
function quiet(seed = 'S7', d: Difficulty = NORMAL): Sim {
  const s = new Sim(seed, d, 1200);
  s.gen.nextAt = s.gen.majorAt = Infinity; s.gen.nextNuisanceAt = Infinity; s.traffic.nextEvent = Infinity;
  return s;
}
/** 시각만 옮기고(초) 그때마다 초과 위험의 한 주기를 돈다. each 는 주기 뒤에 */
function run(s: Sim, sec: number, each?: (t: number) => void): void {
  for (let k = 0; k < sec; k++) { s.tick += 5; s.t = s.tick * s.dt; tickHazards(s); if (each) each(s.t); }
}
const part = (rate: number, ev: number, inc = -1, what: HzPart['what'] = 'jam', ref = -1): HzPart => ({ rate, ev, inc, what, ref });
const note = (s: Sim, text: string): number => emit(s, { role: 'SYSTEM', actor: '시험', kind: 'traffic', imp: 0, text });
const lawInc = (s: Sim): Incident[] => s.incidents.filter((I) => I.hz !== undefined);
/** 열린 사건이 없는, 시설 앞이 아닌 교차로 n 개 (가짜 법칙이 교통사고를 낼 자리) */
function freeNodes(s: Sim, n: number): number[] {
  const fac = new Set(s.city.facilities.map((f) => f.nodeId)), busy = new Set(s.incidents.map((I) => I.truth.nodeId));
  const out: number[] = [];
  for (const nd of s.city.nodes) { if (out.length >= n) break; if (!fac.has(nd.id) && !busy.has(nd.id) && nd.edges.length >= 3) out.push(nd.id); }
  return out;
}

describe('I1-b b3-4: 초과 위험 과정의 틀 (가짜 법칙)', () => {
  it('법칙이 없으면 아무 일도 없다 — 칸도 난수도 기록도 남기지 않는다. 전체 상한의 정의는 hazard.ts 하나다', () => {
    const s = quiet();
    withLaws([], () => { run(s, 30); });
    expect(s.world.hz).toEqual({ cells: {}, live: {}, waiting: [], roadAt: -1, holes: 0 });
    expect([s.world.expo, s.world.sills, s.world.spans]).toEqual([{}, {}, []]);
    expect(CAP_AGAIN).toBe(CSQ_SPAWN_CAP);
    expect(hazardLabel('t-none')).toBe(null);
    const f = fake('label');
    withLaws([f.law], () => { expect(hazardLabel(f.law.id)).toBe('시험 법칙 label'); expect(hazardLaws().length).toBe(1); });
    expect(hazardLabel(f.law.id)).toBe(null);
  });

  it('문턱은 경로와 무관하다: 같은 시드·같은 대상이면 위험률을 어떻게 주든 thr·u2 가 같고, once 가 아니면 n 마다 다르다 (흐름 hz:<법칙>:<대상>:<n>)', () => {
    const seq = (seed: string, rate: number, target: number): { thr: number; u2: number }[] => {
      const s = quiet(seed), f = fake('thr', { cap: 0 });      // 상한 0 — 넘을 때마다 버려지고 칸만 다음 문턱으로 넘어간다
      const ev = note(s, '시험 원인');
      f.rates.set(target, [part(rate, ev)]);
      const out: { thr: number; u2: number }[] = [];
      withLaws([f.law], () => { run(s, 4000, () => { const c = hazardCell(s, f.law.id, target)!; if (out.length === c.n && out.length < 4) out.push({ thr: c.thr, u2: c.u2 }); }); });
      return out;
    };
    const a = seq('S7', 0.004, 5), b = seq('S7', 0.05, 5);
    expect(a.length).toBe(4);
    expect(b).toEqual(a);
    expect(new Set(a.map((x) => x.thr)).size).toBe(4);
    // 흐름 이름 그대로: 첫 값이 문턱 −ln(1 − u), 둘째 값이 u2
    const s0 = new Sim('S7', NORMAL, 1200), r = s0.rng.fork('hz:t-thr:5:0');
    expect(a[0].thr).toBe(-Math.log(1 - r.next()));
    expect(a[0].u2).toBe(r.next());
    expect(seq('S7', 0.05, 6)[0]).not.toEqual(a[0]);      // 대상이 다르면 다르다
    expect(seq('S8', 0.05, 5)[0]).not.toEqual(a[0]);      // 시드가 다르면 다르다
    // once 법칙의 흐름에는 번호가 없다
    const s1 = quiet(), g = fake('once', { once: true });
    g.rates.set(9, [part(0.001, note(s1, '시험 원인'))]);
    withLaws([g.law], () => run(s1, 1));
    expect(hazardCell(s1, g.law.id, 9)!.thr).toBe(-Math.log(1 - new Sim('S7', NORMAL, 1200).rng.fork('hz:t-once:9').next()));
  });

  it('단조성: 위험률을 절반으로 줄이면 k 번째로 문턱을 넘는 시각이 늦어지거나 없어질 뿐 빨라지지 않는다 (개입 시험이 성립하는 까닭)', () => {
    const times = (mul: number): number[] => {
      const s = quiet('S11'), f = fake('mono', { cap: 0 });
      const ev = note(s, '시험 원인'), p = part(0, ev);
      f.rates.set(3, [p]);
      const out: number[] = [];
      withLaws([f.law], () => { run(s, 900, (t) => { p.rate = mul * (0.006 + 0.005 * Math.sin((t + 1) / 37)); const c = hazardCell(s, f.law.id, 3); if (c && c.n > out.length) out.push(t); }); });
      return out;
    };
    const full = times(1), half = times(0.5);
    expect(full.length).toBeGreaterThanOrEqual(3);
    for (let k = 0; k < 3; k++) if (half[k] !== undefined) expect(half[k], `${k + 1}번째`).toBeGreaterThanOrEqual(full[k]);
    expect(half.length).toBeLessThanOrEqual(full.length);
  });

  it('초과가 0 인 동안 H 는 그대로이고 since 는 −1 — 넘친 몫은 다음 문턱으로 넘어간다 (보간 없음: 넘은 시각 = 그 주기의 시각)', () => {
    const s = quiet(), f = fake('hold', { cap: 0 });
    const ev = note(s, '시험 원인');
    f.rates.set(7, [part(0.002, ev)]);
    withLaws([f.law], () => {
      run(s, 3);
      const c = hazardCell(s, f.law.id, 7)!;
      expect(c.H).toBeCloseTo(0.006, 12);
      expect(c.since).toBe(1);
      f.rates.delete(7);
      run(s, 50);
      expect([c.H, c.since, c.n]).toEqual([0.002 * 3, -1, 0]);      // 식지 않는다 — 적분이 멎을 뿐이다
      f.rates.set(7, [part(0.002, ev)]);
      run(s, 1);
      expect(c.since).toBe(54);
      // 문턱 바로 아래로 옮기고 한 주기에 크게 넘긴다: H = H + dH − thr, n + 1, 새 문턱
      const thr0 = c.thr;
      c.H = thr0 - 0.001;
      f.rates.set(7, [part(0.5, ev)]);
      run(s, 1);
      expect(c.n).toBe(1);
      expect(c.H).toBeCloseTo(0.499, 9);
      expect(c.thr).not.toBe(thr0);
      expect(s.gen.dropped.length).toBe(1);
      expect(s.gen.dropped[0]).toMatchObject({ t: s.t, why: 'cap', csq: f.law.id });
    });
  });

  it('평균이 맞다: 대상 300개에 일정한 위험률 λ 를 T 초 주면 넘은 횟수의 평균이 λT ± 15% (주사위 없이도 푸아송이다)', () => {
    const s = quiet('S3'), f = fake('mean', { cap: 0 });
    const ev = note(s, '시험 원인'), lam = 0.004, Tn = 500;
    for (let k = 0; k < 300; k++) f.rates.set(k, [part(lam, ev)]);
    const nEv = s.events.length;
    withLaws([f.law], () => run(s, Tn));
    let sum = 0;
    for (let k = 0; k < 300; k++) sum += hazardCell(s, f.law.id, k)!.n;
    expect(sum / 300).toBeGreaterThan(lam * Tn * 0.85);
    expect(sum / 300).toBeLessThan(lam * Tn * 1.15);
    expect(s.events.length, '버린 일은 기록에 없다').toBe(nEv);
    expect(s.gen.dropped.length).toBe(sum);
    expect(s.world.hz.holes).toBe(0);
  });

  it('귀속: 넘는 순간의 몫으로 — 가장 큰 몫이 cause, 나머지가 causes, 부모는 주인 사건의 몫이 1/3 이상일 때만. since 는 몫마다 따로', () => {
    const s = quiet();
    const A = createIncident(s, { type: 'medical', variant: 'faint' });
    const [n1, n2, n3] = freeNodes(s, 3);
    const f = fake('attr');
    withLaws([f.law], () => {
      // (가) 0.3 짜리 몫(사건 없음)이 먼저 걸려 있다가, 뒤에 생긴 기록의 0.7 짜리 몫(주인 사건 A)이 겹친다
      const e2 = note(s, '먼저 있던 정체');
      run(s, 4);
      f.rates.set(n1, [part(0.0003, e2, -1, 'jam', 11)]);
      run(s, 6);                                           // 초과는 t = 5 부터
      const e1 = note(s, '뒤에 생긴 통제');                 // t = 10 의 기록
      f.rates.set(n1, [part(0.0003, e2, -1, 'jam', 11), part(0.0007, e1, A.id, 'divert', 22)]);
      const c = hazardCell(s, f.law.id, n1)!;
      c.H = c.thr - 0.0005;
      run(s, 1);
      expect(s.gen.chain.length).toBe(1);
      const at = s.t;
      tickIncidents(s);
      const J = lawInc(s)[0];
      expect(J).toBeDefined();
      expect([J.csq, J.cause, J.parent, J.createdAt]).toEqual([f.law.id, e1, A.id, at]);
      expect(s.events[J.rootEvent].causes).toEqual([e1, e2]);
      expect(s.events[J.rootEvent].text.startsWith('시험 법칙의 사고 —')).toBe(true);
      expect(J.hz).toEqual({ law: f.law.id, target: n1, at, src: [
        { ev: e1, inc: A.id, w: 0.0007, what: 'divert', ref: 22, since: 10 },
        { ev: e2, inc: -1, w: 0.0003, what: 'jam', ref: 11, since: 5 },
      ] });
      for (const q of J.hz!.src) expect(q.since).toBeGreaterThanOrEqual(s.events[q.ev].t);      // 문장의 "약 N초" 가 원인 기록보다 앞서지 않는다
      expect(f.spawned[0]).toMatchObject({ target: n1, n: 0, main: { rate: 0.0007, ev: e1, inc: A.id, what: 'divert', ref: 22 } });
      expect(f.spawned[0].total).toBeCloseTo(0.001, 12);
      expect(J.truth.nodeId).toBe(n1);
      expect(s.world.log[s.world.log.length - 1]).toEqual({ rule: f.law.id, t: at, ev: e1, inc: A.id, made: J.id, depth: 1 });
      expect(c.n).toBe(1);
      // (나) 주인 있는 몫이 1/3 아래면 부모가 없다 — 지나가던 사건을 부모로 붙이지 않는다
      f.rates.clear();
      f.rates.set(n2, [part(0.0008, e2), part(0.0002, e1, A.id)]);
      run(s, 1);
      const c2 = hazardCell(s, f.law.id, n2)!;
      c2.H = c2.thr;
      run(s, 1); tickIncidents(s);
      const K = lawInc(s)[1];
      expect([K.cause, K.parent, s.events[K.rootEvent].causes]).toEqual([e2, undefined, [e2, e1]]);
      expect(s.world.log[s.world.log.length - 1]).toMatchObject({ inc: -1, made: K.id, depth: 0 });
      // (다) 같은 주인 사건의 몫은 합쳐 본다: 0.3 + 0.3 이 0.4 짜리 주인 없는 몫과 겹치면 부모는 그 사건, 주된 원인은 가장 큰 몫의 기록
      const e3 = note(s, '같은 사건의 다른 상태');
      f.rates.clear();
      f.rates.set(n3, [part(0.0004, e2), part(0.0003, e1, A.id, 'divert'), part(0.0003, e3, A.id, 'queue')]);
      run(s, 1);
      const c3 = hazardCell(s, f.law.id, n3)!;
      c3.H = c3.thr;
      run(s, 1); tickIncidents(s);
      const L = lawInc(s)[2];
      expect([L.cause, L.parent, s.events[L.rootEvent].causes]).toEqual([e2, A.id, [e2, e1, e3]]);
      expect(L.hz!.src.map((q) => q.ev)).toEqual([e2, e1, e3]);      // 같은 크기면 기록이 앞선 것부터
      expect(s.world.hz.holes).toBe(0);
    });
  });

  it('장부의 구멍: 기록 없는 큰 몫을 뒤로 숨기지 않는다 — 사건은 나되 holes 가 늘고, 모든 몫에 기록이 없으면 사건을 만들지 않는다 (주기마다 늘지 않는다)', () => {
    const s = quiet();
    const [n1, n2] = freeNodes(s, 2);
    const f = fake('hole');
    withLaws([f.law], () => {
      const e1 = note(s, '작은 몫의 기록');
      // 큰 몫(0.8)의 기록이 없다: 20% 짜리 기록이 주된 원인으로 올라오지 않는다
      f.rates.set(n1, [part(0.0002, e1, -1, 'jam'), part(0.0008, -1, -1, 'divert', 4)]);
      run(s, 1);
      const c = hazardCell(s, f.law.id, n1)!;
      c.H = c.thr;
      run(s, 1); tickIncidents(s);
      const J = lawInc(s)[0];
      expect(J).toBeDefined();
      expect(s.world.hz.holes).toBe(1);
      expect([J.hz!.src[0].ev, J.hz!.src[0].what, J.hz!.src[0].since, J.cause]).toEqual([-1, 'divert', 1, e1]);
      expect(s.events[J.rootEvent].causes).toEqual([e1]);
      // 모든 몫의 기록이 없다: 사건 없이 구멍만 — 칸은 넘은 것으로 치므로 다음 주기에 다시 세지 않는다
      f.rates.clear();
      f.rates.set(n2, [part(0.0005, -1), part(0.0005, -1)]);
      run(s, 1);
      const c2 = hazardCell(s, f.law.id, n2)!;
      c2.H = c2.thr;
      const nInc = s.incidents.length, nDrop = s.gen.dropped.length;
      run(s, 1);
      expect([s.world.hz.holes, c2.n, s.gen.chain.length, s.world.hz.waiting.length]).toEqual([2, 1, 0, 0]);
      run(s, 5); tickIncidents(s);
      expect([s.world.hz.holes, s.incidents.length, s.gen.dropped.length]).toEqual([2, nInc, nDrop]);
      // 작은 몫(1/3 아래)의 기록이 없는 것은 구멍으로 세지 않는다
      f.rates.clear();
      f.rates.set(n2, [part(0.0008, e1), part(0.0002, -1)]);
      c2.H = c2.thr;
      run(s, 1);
      expect(s.world.hz.holes).toBe(2);
      expect(s.gen.chain.length).toBe(1);
    });
  });

  it('once 는 한 번 넘으면 끝이다: 예약됐든 상한으로 버려졌든 done 이고, 문턱의 세 배가 되는 충격을 줘도 사건은 하나다', () => {
    const s = quiet();
    const pid = s.city.places.findIndex((q) => q.facility < 0 && !q.open && q.kind === 'houseS');
    const f = fake('one', { once: true, scan: undefined });
    f.opts = (target) => ({ type: 'fire', variant: 'std', severity: 1, placeId: target, note: '시험 법칙의 불' });
    withLaws([f.law], () => {
      const e1 = note(s, '충격의 기록');
      const thr = -Math.log(1 - s.rng.fork('hz:t-one:' + pid).next());
      hazardImpulse(s, f.law.id, pid, thr * 0.4, part(0, e1, -1, 'ember', 3));
      const c = hazardCell(s, f.law.id, pid)!;
      expect([c.thr, c.done, c.n]).toEqual([thr, false, 0]);
      expect(c.H).toBeCloseTo(thr * 0.4, 12);
      expect(s.gen.chain.length).toBe(0);
      s.tick += 50; s.t = s.tick * s.dt;
      hazardImpulse(s, f.law.id, pid, thr * 3, part(0, e1, -1, 'ember', 3));
      expect(c.done).toBe(true);
      expect(s.gen.chain.length).toBe(1);
      const H = c.H;
      hazardImpulse(s, f.law.id, pid, thr * 3, part(0, e1, -1, 'ember', 3));
      run(s, 3);
      expect([c.H, c.n, s.gen.chain.length]).toEqual([H, 0, 1]);
      tickIncidents(s);
      const J = lawInc(s)[0];
      expect(J.truth.placeId, '건물 법칙이 만든 사건의 건물은 언제나 그 대상이다').toBe(J.hz!.target);
      expect(J.hz!.src).toEqual([{ ev: e1, inc: -1, w: thr * 3, what: 'ember', ref: 3, since: 10 }]);      // 몫은 그 충격 하나 — rate 자리에 충격량
      // 상한으로 버려진 대상도 끝이다 (흐름 이름에 번호가 없어 다시 뽑아도 같은 문턱이다)
      const g = fake('one2', { once: true, cap: 0 });
      const off = registerHazard(g.law);
      try {
        g.rates.set(4, [part(5, e1)]);
        run(s, 1);
        const c4 = hazardCell(s, g.law.id, 4)!;
        expect(c4.done).toBe(true);
        const H4 = c4.H, drops = s.gen.dropped.length;
        run(s, 5);
        hazardImpulse(s, g.law.id, 4, 100, part(0, e1));
        expect([c4.H, s.gen.dropped.length]).toEqual([H4, drops]);
        expect(s.gen.dropped[drops - 1]).toMatchObject({ why: 'cap', csq: g.law.id });
      } finally { off(); }
    });
    // 등록되지 않은 법칙의 충격은 아무것도 하지 않는다
    hazardImpulse(s, T('nobody'), 1, 10, part(0, 0));
    expect(hazardCell(s, T('nobody'), 1)).toBe(null);
  });

  it('기다리는 줄: 자리가 없으면 넘는 순간의 몫을 적어 두고 기다린다 — 초과가 끝나도 버려지지 않고, 자리가 나면 다음 1초 블록에 그 몫으로 난다. 마감이 지나면 expired', () => {
    const s = quiet();
    const [n1, n2, n3] = freeNodes(s, 3);
    const f = fake('wait', { every: 12 }), g = fake('wait300', { hold: 300 });
    withLaws([f.law, g.law], () => {
      const e1 = note(s, '통제 기록');
      f.can = false; g.can = false;
      f.rates.set(n1, [part(1, e1, -1, 'divert', 8)]);
      // 12초 주기의 법칙은 교통 모델이 혼잡을 다시 계산했을 때만 적분한다 (dt = 12)
      run(s, 3);
      expect(hazardCell(s, f.law.id, n1)).toBe(null);
      s.traffic.driftAt = s.t;
      run(s, 1);
      const c = hazardCell(s, f.law.id, n1)!;
      expect(s.world.hz.roadAt).toBe(s.t - 1);
      expect(c.n, '위험률 1 × 12초 — 넘었다').toBe(1);
      expect(s.world.hz.waiting).toEqual([{ law: f.law.id, target: n1, n: 0, until: s.t + HZ.HOLD, parts: [{ ev: e1, inc: -1, w: 1, what: 'divert', ref: 8, since: s.t }], total: 1 }]);
      const H = c.H;
      // 줄에 있는 동안 그 대상은 적분하지 않는다. 초과가 끝나도 줄은 남는다
      s.traffic.driftAt = s.t; run(s, 1);
      expect([c.H, c.n]).toEqual([H, 1]);
      f.rates.clear();
      s.traffic.driftAt = s.t; run(s, 10);
      expect(s.world.hz.waiting.length).toBe(1);
      expect(s.gen.dropped.length).toBe(0);
      // 자리가 났다: 12초 주기의 법칙이어도, scan 이 그 대상을 내놓지 않아도, 다음 1초 블록에 난다 — 넘은 문턱(n = 0)의 내용으로
      f.can = true;
      run(s, 1);
      expect(s.world.hz.waiting.length).toBe(0);
      expect(s.gen.chain.length).toBe(1);
      expect(f.spawned[0]).toMatchObject({ target: n1, n: 0, main: { rate: 1, ev: e1, what: 'divert', ref: 8 }, total: 1 });
      { const r = s.rng.fork('hz:t-wait:' + n1 + ':0'); r.next(); expect(f.spawned[0].u2).toBe(r.next()); }
      tickIncidents(s);
      const J = lawInc(s)[0];
      expect([J.cause, J.hz!.at, J.hz!.src[0].ev, J.createdAt]).toEqual([e1, s.t, e1, s.t]);
      // 마감: 기본 60초, hold 를 준 법칙은 그만큼
      f.can = false;
      f.rates.set(n2, [part(1, e1)]);
      g.rates.set(n3, [part(5, e1)]);
      s.traffic.driftAt = s.t; run(s, 1);
      f.rates.clear(); g.rates.clear();
      expect(s.world.hz.waiting.map((w) => [w.law, w.target, w.until - s.t])).toEqual([[f.law.id, n2, 60], [g.law.id, n3, 300]]);
      run(s, 59);
      expect(s.world.hz.waiting.length).toBe(2);
      run(s, 1);
      expect(s.world.hz.waiting.map((w) => w.law)).toEqual([g.law.id]);
      expect(s.gen.dropped).toEqual([{ t: s.t, why: 'expired', type: undefined, variant: undefined, parent: undefined, csq: f.law.id }]);
      run(s, 239);
      expect(s.world.hz.waiting.length).toBe(1);
      run(s, 1);
      expect(s.world.hz.waiting.length).toBe(0);
      expect(s.gen.dropped[1]).toMatchObject({ why: 'expired', csq: g.law.id });
    });
  });

  it('부하: 열린 사건이 한도를 넘으면 기다리고, 풀리면 난다 — 기다리는 줄은 자기 자리 때문에 상한에 걸려 버려지지 않는다', () => {
    const s = quiet();
    const [n1] = freeNodes(s, 1);
    const f = fake('busy', { cap: 1 });
    withLaws([f.law], () => {
      const e1 = note(s, '원인');
      const held: Incident[] = [];
      for (let k = 0; k <= s.tune.maxConcurrent; k++) held.push(createIncident(s, { type: 'medical', variant: 'faint' }));
      f.rates.set(n1, [part(9, e1)]);
      run(s, 1);
      expect([s.world.hz.waiting.length, f.spawned.length, s.gen.chain.length]).toEqual([1, 0, 0]);      // 부하일 때는 spawn 도 묻지 않는다
      expect(ruleLoad(s, f.law.id)).toBe(1);
      f.rates.clear();
      run(s, 5);
      expect(s.world.hz.waiting.length, '법칙 상한 1 — 줄 자신은 빼고 센다').toBe(1);
      held[0].phase = 'closed';
      run(s, 1);
      expect([s.world.hz.waiting.length, s.gen.chain.length, ruleLoad(s, f.law.id)]).toEqual([0, 1, 1]);
      tickIncidents(s);
      expect(lawInc(s).length).toBe(1);
      expect(ruleLoad(s, f.law.id)).toBe(1);
    });
  });

  it('건물에 내는 사건의 공통 조건: 전소·전체 붕괴 건물이면 버리고(expired), 사건 중인 건물이면 기다린다. 예약한 뒤 꺼내기 전에 전소하면 만들지 않는다', () => {
    const s = quiet();
    const houses = s.city.places.filter((q) => q.facility < 0 && !q.open && q.kind === 'houseS').slice(0, 3).map((q) => q.id);
    const [p1, p2, p3] = houses;
    const f = fake('bldg', { once: true });
    f.opts = (target) => ({ type: 'fire', variant: 'std', severity: 1, placeId: target, note: '시험 법칙의 불' });
    withLaws([f.law], () => {
      const e1 = note(s, '옆 건물의 불');
      // ① 다 탄 건물: 다른 건물로 옮겨 내지 않는다 — 버린다
      s.placeMarks.set(p1, { placeId: p1, state: 'burnt', t: 0, incidentId: -1, burnFrac: 1, ruinFrac: 0 });
      f.rates.set(p1, [part(50, e1, -1, 'heat', p2)]);
      run(s, 1);
      expect([s.gen.chain.length, s.world.hz.waiting.length, hazardCell(s, f.law.id, p1)!.done]).toEqual([0, 0, true]);
      expect(s.gen.dropped).toEqual([{ t: s.t, why: 'expired', type: 'fire', variant: 'std', parent: undefined, csq: f.law.id }]);
      // ② 사건 중인 건물: 그 사건이 닫힐 때까지 기다린다
      const open = createIncident(s, { type: 'fire', variant: 'std', placeId: p2 });
      expect(open.truth.placeId).toBe(p2);
      f.rates.clear(); f.rates.set(p2, [part(50, e1, -1, 'heat', p1)]);
      run(s, 1);
      expect([s.gen.chain.length, s.world.hz.waiting.length]).toEqual([0, 1]);
      f.rates.clear();
      run(s, 3);
      expect(s.world.hz.waiting.length).toBe(1);
      open.phase = 'closed';
      run(s, 1);
      expect([s.gen.chain.length, s.world.hz.waiting.length]).toEqual([1, 0]);
      tickIncidents(s);
      const J = lawInc(s)[0];
      expect([J.truth.placeId, J.hz!.target, J.truth.type]).toEqual([p2, p2, 'fire']);
      // ③ 예약과 꺼냄 사이에 전소: createIncident 의 "다른 건물을 다시 고른다" 갈래를 타지 않고 버린다
      f.rates.set(p3, [part(50, e1, -1, 'heat', p2)]);
      run(s, 1);
      f.rates.clear();
      expect(s.gen.chain.length).toBe(1);
      s.placeMarks.set(p3, { placeId: p3, state: 'collapsed', t: s.t, incidentId: -1, burnFrac: 0, ruinFrac: 1 });
      const nInc = s.incidents.length;
      tickIncidents(s);
      expect([s.incidents.length, s.gen.chain.length]).toEqual([nInc, 0]);
      expect(s.gen.dropped[s.gen.dropped.length - 1]).toMatchObject({ why: 'expired', type: 'fire', csq: f.law.id });
      expect(s.world.log.filter((l) => l.rule === f.law.id).map((l) => l.made)).toEqual([J.id, -1]);
      expect(ruleLoad(s, f.law.id), '버려진 예약의 자리는 돌아온다').toBe(1);
    });
  });

  it('사건의 흐름 이름이 (법칙, 대상, 몇 번째)라 앞의 다른 사건이 있든 없든 그 사건의 선택(유형·변형·규모·자리)이 같다', () => {
    const pick = (other: boolean): Incident['truth'] => {
      const s = quiet('S5'), f = fake('flow');
      const [nx, ny] = freeNodes(s, 2);
      f.opts = (target) => ({ type: 'traffic', nodeId: target, note: '시험 법칙의 사고' });      // 변형·규모를 정해 주지 않는다 — 그 사건의 흐름이 뽑는다
      return withLaws([f.law], () => {
        const e1 = note(s, '원인');
        if (other) { f.rates.set(ny, [part(50, e1)]); run(s, 1); tickIncidents(s); f.rates.clear(); }
        f.rates.set(nx, [part(50, e1)]);
        run(s, 1); tickIncidents(s);
        const J = lawInc(s).find((I) => I.hz!.target === nx)!;
        expect(J.id).toBe(other ? 1 : 0);
        return J.truth;
      });
    };
    const a = pick(false), b = pick(true);
    expect([b.type, b.variant, b.severity, b.nodeId]).toEqual([a.type, a.variant, a.severity, a.nodeId]);
  });

  it('무한 연쇄: 깊이 2 의 사건을 부모로 한 초과는 depth · 한 뿌리의 법칙 사건은 둘까지 · 버릴 때마다 H 가 thr 만큼 줄고 n 이 는다. 기록은 없다', () => {
    const s = quiet();
    const nodes = freeNodes(s, 8);
    const f = fake('caps');
    withLaws([f.law], () => {
      const R = createIncident(s, { type: 'medical', variant: 'faint' });
      const P1 = createIncident(s, { type: 'medical', variant: 'faint', parent: R.id });
      const P2 = createIncident(s, { type: 'medical', variant: 'faint', parent: P1.id });
      const e1 = note(s, '원인');
      const cross = (target: number, inc: number): HzCell => {
        for (const I of s.incidents) I.phase = 'closed';      // 부하에 걸리지 않게 (부모는 닫힌 사건이어도 된다)
        f.rates.clear(); f.rates.set(target, [part(0.001, e1, inc)]);
        run(s, 1);
        const c = hazardCell(s, f.law.id, target)!;
        c.H = c.thr + 0.25;
        run(s, 1);
        f.rates.clear();
        return c;
      };
      // 깊이 2(사슬 3건)의 사건이 주인인 상태에서는 더 잇지 않는다 — 되먹임의 고리가 끊기는 자리
      const c0 = cross(nodes[0], P2.id);
      expect(s.gen.dropped).toEqual([{ t: s.t, why: 'depth', type: undefined, variant: undefined, parent: P2.id, csq: f.law.id }]);
      expect(c0.n).toBe(1);
      expect(c0.H).toBeCloseTo(0.251, 9);      // H −= thr (넘친 몫 0.25 + 그 주기의 0.001)
      expect(s.gen.chain.length).toBe(0);
      // 한 뿌리(R)에서 난 법칙 사건은 둘까지: 셋째는 depth (사슬의 길이는 2 라 canChain 은 지난다)
      const S2 = createIncident(s, { type: 'medical', variant: 'faint' });
      cross(nodes[1], S2.id); tickIncidents(s);
      cross(nodes[2], S2.id);                    // 예약만 된 것도 센다
      expect(s.gen.chain.length).toBe(1);
      cross(nodes[3], S2.id);
      expect(s.gen.dropped.length).toBe(2);
      expect(s.gen.dropped[1]).toMatchObject({ why: 'depth', parent: S2.id });
      tickIncidents(s);
      expect(lawInc(s).map((I) => I.parent)).toEqual([S2.id, S2.id]);
      // 법칙 사건의 자식(같은 뿌리 S2)도 그 뿌리의 가지로 센다
      cross(nodes[4], lawInc(s)[0].id);
      expect(s.gen.dropped[2]).toMatchObject({ why: 'depth', parent: lawInc(s)[0].id });
      expect(s.events.filter((e) => e.text.includes('시험 법칙')).length, '버린 일은 기록에 없다 (사건 둘의 발생 기록만)').toBe(2);
      expect(s.world.hz.holes).toBe(0);
    });
  });

  it('교대 상한: 이야기 연쇄와 법칙 사건(부모가 있든 없든)을 합쳐 6건이면 cap · 부모 없는 법칙 사건은 그 안에서 3건 · 법칙별 상한 · 전체 상한 · 교대 끝 150초 안에는 late', () => {
    const cross = (s: Sim, f: Fake, target: number, parts: HzPart[]): void => {
      for (const I of s.incidents) I.phase = 'closed';      // 부하에 걸리지 않게 (상한은 닫힌 사건도 센다)
      f.rates.clear(); f.rates.set(target, parts);
      run(s, 1);
      const c = hazardCell(s, f.law.id, target)!;
      if (c.n === 0 && !c.done) { c.H = c.thr; run(s, 1); }
      f.rates.clear();
      tickIncidents(s);
    };
    // (가) 부모 없는 법칙 사건은 3건까지, 부모 있는 것은 그 뒤에도 난다
    {
      const s = quiet(), nodes = freeNodes(s, 8), f = fake('orph');
      withLaws([f.law], () => {
        const e1 = note(s, '원인');
        const A = createIncident(s, { type: 'medical', variant: 'faint' });
        for (let k = 0; k < 3; k++) cross(s, f, nodes[k], [part(0.001, e1)]);
        expect(lawInc(s).length).toBe(HZ.ORPHAN_CAP);
        cross(s, f, nodes[3], [part(0.001, e1)]);
        expect(lawInc(s).length).toBe(3);
        expect(s.gen.dropped).toEqual([{ t: s.gen.dropped[0].t, why: 'cap', type: undefined, variant: undefined, parent: undefined, csq: f.law.id }]);
        cross(s, f, nodes[4], [part(0.001, e1, A.id)]);
        expect(lawInc(s).length).toBe(4);
        expect(lawInc(s)[3].parent).toBe(A.id);
      });
    }
    // (나) 한 교대 6건: 이야기 연쇄 넷 + 법칙 사건 둘이면 다음 것은 cap (부모가 있어도 없어도)
    {
      const s = quiet(), nodes = freeNodes(s, 8), f = fake('six', {}, 'roadCrash');      // 진짜 법칙의 이름으로 (등록된 법칙은 withLaws 가 치워 둔다 — 측정 도구는 gen.dropped 의 csq 가 법칙의 이름일 때만 센다)
      withLaws([f.law], () => {
        const e1 = note(s, '원인');
        const roots = [0, 1, 2, 3].map(() => createIncident(s, { type: 'medical', variant: 'faint' }));
        for (const r of roots) createIncident(s, { type: 'medical', variant: 'faint', parent: r.id, csq: 'reoffend' });      // 이야기 연쇄 넷 (부모 있는 사건)
        const B = createIncident(s, { type: 'medical', variant: 'faint' });
        cross(s, f, nodes[0], [part(0.001, e1)]);
        cross(s, f, nodes[1], [part(0.001, e1, B.id)]);
        expect(lawInc(s).length).toBe(2);
        expect(CHAIN_SHIFT_MAX).toBe(6);
        cross(s, f, nodes[2], [part(0.001, e1)]);
        cross(s, f, nodes[3], [part(0.001, e1, roots[0].id)]);
        expect(lawInc(s).length).toBe(2);
        expect(s.gen.dropped.map((d) => d.why)).toEqual(['cap', 'cap']);
        // 이야기 연쇄 쪽도 같은 수를 본다: 법칙 사건이 자리를 쓰면 재범·방화도 그 6건 안에서 멈춘다 (canChain — 법칙 사건이 먼저 나고 이야기 연쇄가 뒤에 와도 합이 6건을 넘지 않는다)
        expect([chainedInShift(s), canChain(s, B)]).toEqual([6, false]);
        noteChainDrop(s, B, 'armed', 'robbery');
        expect(s.gen.dropped[2]).toMatchObject({ why: 'cap', parent: B.id });
        // 측정 도구의 관문과 같은 수: 이야기 연쇄 + 법칙 사건 = 6
        const h = hazardShift(s, null);
        expect([h.natural, h.parented, h.orphan, h.story, h.ruleMade, h.dropped.cap, h.rootMax, h.holes]).toEqual([2, 1, 1, 4, 0, 2, 1, 0]);
        expect(h.byLaw).toEqual({ roadCrash: 2 });
      });
    }
    // (다) 법칙별 상한 · 전체 상한(CSQ_SPAWN_CAP — 실제로 사건이 된 수만으로 닿으면 그 교대의 초과 위험은 멎는다) · 교대 끝
    {
      const s = quiet(), nodes = freeNodes(s, 8), f = fake('lawcap', { cap: 1 }), g = fake('other');
      withLaws([f.law, g.law], () => {
        const e1 = note(s, '원인');
        const A = createIncident(s, { type: 'medical', variant: 'faint' });
        cross(s, f, nodes[0], [part(0.001, e1, A.id)]);
        cross(s, f, nodes[1], [part(0.001, e1, A.id)]);
        expect(lawInc(s).length).toBe(1);
        expect(s.gen.dropped[0]).toMatchObject({ why: 'cap', csq: f.law.id });
        for (let k = 0; k < CSQ_SPAWN_CAP - 1; k++) s.world.log.push({ rule: 't-fill', t: s.t, ev: -1, inc: -1, made: A.id, depth: 0 });
        expect(ruleLoad(s)).toBe(CSQ_SPAWN_CAP);
        const drops = s.gen.dropped.length;
        g.can = false;
        s.world.hz.waiting.push({ law: g.law.id, target: nodes[5], n: 0, until: s.t + 60, parts: [{ ev: e1, inc: -1, w: 1, what: 'jam', ref: -1, since: s.t }], total: 1 });
        g.rates.set(nodes[2], [part(50, e1)]);
        run(s, 3);
        expect(hazardCell(s, g.law.id, nodes[2]), '첫 줄에서 돌아온다 — 적분도 하지 않는다').toBe(null);
        expect(s.world.hz.waiting.length, '기다리던 것은 cap 으로 버린다').toBe(0);
        expect(s.gen.dropped.length).toBe(drops + 1);
        expect(s.gen.dropped[drops]).toMatchObject({ why: 'cap', csq: g.law.id });
      });
      // 교대 끝 150초 안: 만들지 않는다 (기다리던 것도 late 로 버린다 — 교대 끝에 몰려 터지지 않는다)
      const s2 = quiet(), n2 = freeNodes(s2, 2), h = fake('late');
      withLaws([h.law], () => {
        const e1 = note(s2, '원인');
        s2.tick = (s2.shiftLen - HZ.LATE - 3) * 5; s2.t = s2.tick * s2.dt;
        h.can = false;
        h.rates.set(n2[0], [part(50, e1)]);
        run(s2, 1);
        expect(s2.world.hz.waiting.length).toBe(1);
        h.rates.clear(); h.rates.set(n2[1], [part(50, e1)]);
        run(s2, 1);
        expect(s2.world.hz.waiting.length).toBe(2);
        h.rates.clear();
        run(s2, 1);
        expect(s2.t).toBe(s2.shiftLen - HZ.LATE);
        expect(s2.world.hz.waiting.length).toBe(0);
        expect(s2.gen.dropped.map((d) => d.why)).toEqual(['late', 'late']);
        expect(s2.gen.chain.length).toBe(0);
      });
      expect(CHAIN_MAX).toBe(3);
    }
  });

  it('미룬 충격(delay): 예약의 at 이 그만큼 뒤이고 when·until 이 붙는다 — 그동안 그 건물에 사건이 열리면 기다리다 마감에 버린다', () => {
    const s = quiet();
    const pid = s.city.places.filter((q) => q.facility < 0 && !q.open && q.kind === 'houseS')[5].id;
    const f = fake('delay', { once: true, scan: undefined, hold: 30 });
    f.opts = (target) => ({ type: 'fire', variant: 'std', severity: 1, placeId: target, note: '시험 법칙의 불' });
    withLaws([f.law], () => {
      const e1 = note(s, '닫힌 화재');
      hazardImpulse(s, f.law.id, pid, 100, part(0, e1, -1, 'residual', pid), 40);
      expect(s.gen.chain.length).toBe(1);
      const it0 = s.gen.chain[0];
      expect([it0.at, it0.until, typeof it0.when, it0.opts.hz!.at]).toEqual([40, 70, 'function', 40]);
      expect(it0.when!(s)).toBe(true);
      const open = createIncident(s, { type: 'fire', variant: 'std', placeId: pid });
      expect(it0.when!(s)).toBe(false);
      s.tick = 41 * 5; s.t = 41; tickIncidents(s);
      expect([s.gen.chain.length, s.gen.chain[0].at]).toEqual([1, 46]);
      s.tick = 71 * 5; s.t = 71; tickIncidents(s);
      expect(s.gen.chain.length).toBe(0);
      expect(s.gen.dropped).toEqual([{ t: 71, why: 'expired', type: 'fire', variant: 'std', parent: undefined, csq: f.law.id }]);
      expect(open.phase).not.toBe('closed');
      expect(lawInc(s).length).toBe(0);
    });
  });

  it('틱 순서: tickWorld 의 1초 블록에서 돌고(상태 규칙 다음), 예약은 같은 틱에 사건이 된다 — 12초 주기의 법칙은 교통 모델의 주기마다 한 번', () => {
    const s = quiet('S9');
    const [n1] = freeNodes(s, 1);
    const f = fake('tick'), g = fake('tick12', { every: 12, cap: 0 });
    const calls: number[] = [];
    const scan0 = g.law.scan!;
    g.law.scan = (sim, put) => { calls.push(sim.t); scan0(sim, put); };
    withLaws([f.law, g.law], () => {
      s.run(5 * 20);                                       // 20초
      expect(calls.length).toBe(1);                         // 첫 혼잡 계산(t = 10) 뒤의 1초 블록에서 한 번
      expect(calls[0]).toBeGreaterThanOrEqual(10);
      expect(calls[0]).toBeLessThan(11.01);
      const e1 = note(s, '원인');
      f.rates.set(n1, [part(50, e1)]);
      const nInc = s.incidents.length;
      while (s.incidents.length === nInc && s.t < 25) s.step();
      f.rates.clear();
      const J = s.incidents[nInc];
      expect(J).toBeDefined();
      expect([J.csq, J.hz!.at, J.createdAt, s.tick % 5]).toEqual([f.law.id, s.t, s.t, 1]);
      expect(s.world.log[s.world.log.length - 1]).toMatchObject({ rule: f.law.id, made: J.id });
      s.run(5 * 30);
      expect(calls.length).toBe(4);                         // t = 10 · 22 · 34 · 46
      expect(s.world.hz.roadAt).toBe(s.traffic.driftAt);
    });
  });

  it('측정 도구의 hazard 줄: 법칙 사건이 없는 교대는 0 이고 관문을 지난다 — 구멍·한 뿌리의 가지·교대 상한을 넘기면 문구가 나온다', () => {
    const s = new Sim('S2', NORMAL, 1200);
    s.runToEnd();
    const h = hazardShift(s, null);
    expect(h).toMatchObject({ natural: 0, byLaw: {}, parented: 0, orphan: 0, rootMax: 0, ruleMade: 0, waited: null, holes: 0, dropped: { depth: 0, cap: 0, late: 0, expired: 0, busy: 0 } });
    expect(h.story).toBe(s.incidents.filter((I) => I.csq !== undefined).length);
    expect(HAZARD_LAWS.length).toBe(7);
    const m = summarize([{ ...emptyShift('S2'), hazard: h }]);
    expect(formatLines(m, false)[9].startsWith('hazard: natural 0 (-)')).toBe(true);
    expect(checkMetrics(m, { baseline: false })).toEqual([]);
    const bad = summarize([{ ...emptyShift('S2'), hazard: { ...h, natural: 7, byLaw: { roadCrash: 7 }, parented: 5, orphan: 2, rootMax: 3, lawKids: 2, story: 1, holes: 2 } }]);
    expect(bad.hazard).toMatchObject({ natural: 7, gain: 0.286, maxMadeInShift: 7, maxCausalInShift: 8, rootMax: 3, holes: 2 });
    const fails = checkMetrics(bad, { baseline: false });
    expect(fails.some((x) => x.startsWith('초과 위험 장부의 구멍 2건'))).toBe(true);
    expect(fails.some((x) => x.startsWith(`한 교대의 규칙·법칙 사건 7건 > ${CSQ_SPAWN_CAP}`))).toBe(true);
    expect(fails.some((x) => x.startsWith(`한 교대의 이야기 연쇄 + 법칙 사건 8건 > ${CHAIN_SHIFT_MAX}`))).toBe(true);
    expect(fails.some((x) => x.startsWith(`한 뿌리의 법칙 사건 3건 > ${HZ.ROOT_MAX}`))).toBe(true);
    expect(fails.length).toBe(4);
  });
});

/** 지표 요약에 넣을 빈 교대 (hazard 칸만 바꿔 쓴다) */
function emptyShift(seed: string): ShiftMetrics {
  return {
    seed, sampled: false, probeErrors: 0, incidents: [], chained: 0, maxParentDepth: 0, dropped: 0, droppedApprox: null, disasterSkipped: null, disasterCleared: null,
    crossLinks: 0, worldLinks: 0, spreadWorld: 0, spreadWorldRaw: 0, aidUsed: 0, peakOpen: 0, peakBusy: null, divert: [], erWaits: 0, erCross: null,
    consistency: { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, C5n: 0 }, stall: null, forgotten: null, unlocated: null,
    hazard: { natural: 0, byLaw: {}, parented: 0, orphan: 0, rootMax: 0, lawKids: 0, story: 0, ruleMade: 0, queued: 0, waited: null, dropped: { depth: 0, cap: 0, late: 0, expired: 0, busy: 0 }, holes: 0 },
  };
}

describe('I1-b b3-4: 재현성과 소스 글자', () => {
  it('한 프로세스에서 다른 시드를 먼저 돌려도 결과가 같다 — 대상마다 한 번 뽑는 값이 도시 열쇠의 캐시로 새지 않는다 (홍수 + 가스 폭발 강제)', async () => {
    const FLOOD: Difficulty = { ...NORMAL, disaster: parseDisaster('flood')! };
    const hashOf = async (seeds: string[]): Promise<string> => {
      vi.resetModules();      // 새 모듈 그래프 = 새 프로세스와 같은 모듈 캐시 (도시·이웃 목록·통행량 …)
      const m = await import('../src/sim/engine');
      let h = '';
      for (const seed of seeds) { const s = new m.Sim(seed, FLOOD, 1200, { force: 'collapse/gasblast' }); s.runToEnd(); h = s.report!.hash; }
      return h;
    };
    const alone = await hashOf(['S4']);
    const after = await hashOf(['S9', 'S4']);
    expect(after).toBe(alone);
  }, 60000);

  const read = (f: string): string => readFileSync(f, 'utf8');
  const tsIn = (dir: string): string[] => readdirSync(dir).filter((f) => f.endsWith('.ts')).map((f) => dir + '/' + f);
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(dir + '/' + e.name) : e.name.endsWith('.ts') ? [dir + '/' + e.name] : []));

  it('법칙은 원인을 모른다 (소스 글자): 법칙 파일에 확률 주사위·시나리오·재난·현장 규칙의 글자가 없고, 상태 규칙은 사건을 만들지 않는다', () => {
    // (가) world/laws/*.ts (모음 파일 제외) 통째
    const laws = tsIn('src/sim/world/laws').filter((f) => !f.endsWith('/index.ts'));
    for (const f of laws) for (const w of ['.chance(', 'spawnConsequence', 'truth.variant', '.variant ===', 'd.kind', 'sim.disaster', '.rules']) expect(read(f).includes(w), `${f} 에 ${w}`).toBe(false);
    // (나) 법칙마다 scan 함수의 본문: 시나리오 변형의 이름이 없다 — 결과의 이름은 spawn 안에만
    for (const f of laws) {
      const src = read(f);
      for (let at = src.indexOf('scan:'); at >= 0; at = src.indexOf('scan:', at + 1)) {
        let depth = 0, end = -1;
        for (let i = src.indexOf('{', at); i >= 0 && i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) { end = i; break; } }
        const body = src.slice(at, end + 1);
        for (const v of ["'tree'", "'pileup'", "'bus'", "'gasblast'", "'wild'", "'std'", "'landslide'", "'crane'"]) expect(body.includes(v), `${f} 의 scan 에 ${v}`).toBe(false);
      }
    }
    // (다) I1 의 상태 규칙은 사건을 만들지 않는다 (N8·N9 의 kinds*.ts 는 뺀다)
    for (const f of tsIn('src/sim/world/rules').filter((q) => !/\/kinds\d*\.ts$/.test(q))) expect(read(f).includes('spawnConsequence'), f).toBe(false);
    // (라) 등록하는 파일(world/rules·world/laws)은 모음 파일만 import 한다: 다른 모듈이 import 하면 그 파일의 등록이 모음의 차례보다 먼저 실행된다.
    //      예외는 등록이 없는 rules/record.ts (C6 — 관제·현장·종료가 직접 부른다)
    const bad: string[] = [];
    for (const f of walk('src/sim')) {
      if (f === 'src/sim/engine.ts' || f === 'src/sim/world/rules/index.ts' || f === 'src/sim/world/laws/index.ts') continue;
      const inRules = f.startsWith('src/sim/world/rules/'), inLaws = f.startsWith('src/sim/world/laws/');
      for (const line of read(f).split('\n')) {
        const m = /^\s*(?:import|export)\b[^'"]*['"]([^'"]+)['"]/.exec(line);
        if (!m) continue;
        const p = m[1];
        const hit = /world\/(rules|laws)(\/|$)/.test(p) || (f.startsWith('src/sim/world/') && /^\.\/(rules|laws)(\/|$)/.test(p)) || (inRules && /^\.\.\/laws(\/|$)/.test(p)) || (inLaws && /^\.\.\/rules(\/|$)/.test(p))
          || ((inRules || inLaws) && /^\.\//.test(p));      // 같은 폴더의 다른 등록 파일
        if (hit && !/rules\/record$/.test(p) && !(inRules && p === './record')) bad.push(`${f}: ${line.trim()}`);
      }
    }
    expect(bad).toEqual([]);
    // 등록이 없는 파일: hazard.ts·state.ts 에는 registerHazard(...)·registerConsequence(...) 호출이 없다
    for (const f of ['src/sim/world/hazard.ts', 'src/sim/world/state.ts', 'src/sim/world/expo.ts', 'src/sim/world/rules/record.ts']) expect(/^\s*register(?:Hazard|Consequence)\(/m.test(read(f)), f).toBe(false);
  });

  it('정보 격리 2 (소스 글자): 판단 파일은 초과 위험·내력·교통의 장부·건물의 손상을 읽지 않고, 세계 쪽은 현장의 생김새 칸(s.rules)에 쓰지 않는다', () => {
    const files = [
      ...tsIn('src/sim/dispatch'), 'src/sim/field/commander.ts', 'src/sim/field/brain.ts', ...tsIn('src/sim/field/orders'),
      'src/sim/field/methods.ts', 'src/sim/field/ops.ts', 'src/sim/field/airDecide.ts', 'src/sim/field/gear.ts', ...tsIn('src/sim/field/doctrine'),
    ];
    expect(files.length).toBeGreaterThan(20);
    const WORDS = ['world.hz', 'I.hz', 'fireLoad', 'zoneAt(', 'isDark(', '.excess', '.exDiv', '.exQueue', '.exOwn', '.exBump', '.divertBy', 'closeEv', 'slowEv', 'levelEv', 'qEv', '.bumps', '.wear', 'expoOf', 'roadParts',
      'world.expo', 'applyExpo', 'shockDelta', 'shakeEv', 'pipeThr', 'placeState(', 'EXPO_LEAK'];      // (b3-8) 이웃 건물의 손상(진실)과 그것을 현장에 옮기는 자리
    for (const f of files) {
      const src = read(f);
      for (const w of WORDS) expect(src.includes(w), `${f} 에 ${w}`).toBe(false);
      expect(/\b(?:tr|traffic)\.divert\b/.test(src), `${f} 에 traffic.divert`).toBe(false);
      expect(/\bhz\.(?:src|law|target|at)\b/.test(src), `${f} 에 hz.*`).toBe(false);      // 글자 .hz 로는 막지 않는다 — R3 교본의 c.hz 는 다른 칸이다
    }
    for (const f of walk('src/sim/world')) { const src = read(f); expect(/\.rules\.push|\.rules\s*=[^=]/.test(src), `${f} 가 s.rules 에 쓴다`).toBe(false); }
  });
});

// ───────────────────────── b3-5 ①: 교통의 장부와 초과의 네 몫 (§3.6b (나)·(다) — 결과 불변: 읽는 곳은 L1 과 측정뿐) ─────────────────────────
describe('I1-b b3-5 ①: 교통의 장부와 초과의 네 몫', () => {
  /** 실제로 돌린다 — 교통 모델이 혼잡을 다시 계산한 틱마다 each */
  function drifts(s: Sim, sec: number, each?: () => void): number {
    let seen = s.traffic.driftAt, n = 0;
    const end = s.tick + sec * 5;
    while (s.tick < end && !s.ended) { s.step(); if (s.traffic.driftAt !== seen) { seen = s.traffic.driftAt; n++; if (each) each(); } }
    return n;
  }
  const nbrs = (s: Sim, id: number): number[] => {
    const e = s.city.edges[id], out: number[] = [];
    for (const nd of [e.a, e.b]) for (const k of s.city.nodes[nd].edges) if (k !== id && out.indexOf(k) < 0) out.push(k);
    return out;
  };
  const partsOf = (s: Sim, id: number): RoadPart[] => { const buf: RoadPart[] = []; buf.length = roadParts(s, id, buf); return buf; };

  it('평소의 도로: 교통 사건·사건·재난이 없으면 모든 구간의 초과가 0 이다 — 수요만으로 꽉 찬 구간의 밀림은 원인 탓으로 돌리지 않는다. drift 의 난수 호출 수는 구간 수 그대로', () => {
    const s = quiet('S7'), tr = s.traffic, edges = s.city.edges;
    let draws = 0;
    const rg = s.rngTraffic as unknown as { range: (a: number, b: number) => number }, range0 = rg.range.bind(s.rngTraffic);
    rg.range = (a, b) => { draws++; return range0(a, b); };
    const n = drifts(s, 300, () => { for (const e of edges) expect(tr.excess[e.id]).toBe(0); expect(tr.parts.length).toBe(0); });
    expect(n).toBeGreaterThanOrEqual(24);
    expect(draws, '혼잡 계산의 난수는 구간마다 한 번 — 장부가 끼어들지 않는다').toBe(n * edges.length);
    expect(tr.driftAt).toBeGreaterThan(285);
    for (const e of edges) {
      expect(tr.base[e.id]).toBeGreaterThanOrEqual(1);
      if (tr.queue[e.id] === 0) expect(Math.abs(e.cong - tr.base[e.id]), `e${e.id}`).toBeLessThanOrEqual(0.3);
      expect([tr.closeEv[e.id], tr.slowEv[e.id], tr.levelEv[e.id], tr.qBy[e.id], tr.qEv[e.id]]).toEqual([-1, -1, -1, -1, -1]);
    }
    expect(tr.bumps).toEqual([]);
    expect(s.world.hz.cells).toEqual({});
    // 수요만으로 꽉 찬 구간(평소의 뿌리)을 손으로 만든다: 이웃은 밀리지만 그 밀림은 초과가 아니다 — 그 위에 혼잡을 얹어도 같다
    const E = edges.find((e) => e.cls === 'arterial' && !e.closed && tr.queue[e.id] === 0 && nbrs(s, e.id).every((k) => tr.queue[k] === 0 && !edges[k].closed))!;
    E.baseCong = 6;
    drifts(s, 60);
    for (const k of nbrs(s, E.id)) { expect(tr.queue[k], `e${k}`).toBeGreaterThan(0.5); expect([tr.exQueue[k], tr.qBy[k], tr.excess[k]]).toEqual([0, -1, 0]); }
    const id = addBump(s, [E.id], 0.8, note(s, '시험으로 얹은 혼잡'), 0);
    drifts(s, 36);
    for (const k of nbrs(s, E.id)) expect([tr.exQueue[k], tr.qBy[k], tr.excess[k]]).toEqual([0, -1, 0]);
    expect([tr.base[E.id], tr.excess[E.id]], '상한까지의 여유가 없으면 초과도 없다').toEqual([3, 0]);
    removeBump(s, id);
    expect([E.bump, tr.bumps.length]).toEqual([0, 0]);
  });

  it('닫힌 구간과 밀림의 내력: 닫힘의 주인은 통제 기록, 감속의 주인은 발생 기록(서로 덮지 않는다) — 이웃의 밀림은 그 통제의 것이고, 통제가 풀린 뒤에도 밀림이 0 이 될 때까지 그 기록을 지닌다', () => {
    const s = quiet('S7'), tr = s.traffic, edges = s.city.edges;
    drifts(s, 15);
    const fac = new Set(s.city.facilities.map((f) => f.nodeId));
    const nd = s.city.nodes.find((q) => !fac.has(q.id) && q.edges.length >= 3 && q.edges.some((k) => edges[k].arterial))!;
    const I = createIncident(s, { type: 'traffic', variant: 'tree', nodeId: nd.id });
    const c = I.blockedEdge, e = edges[c];
    expect(e.closed).toBe(true);
    expect([tr.closeEv[c], tr.closeInc[c], tr.slowEv[c], tr.slowInc[c]]).toEqual([I.blockEv, I.id, I.rootEvent, I.id]);
    expect(s.events[I.blockEv!].text).toContain('쓰러진 나무가 길을 막았습니다');
    expect(s.events[I.rootEvent].kind).toBe('incident');
    drifts(s, 60);
    const ring = nbrs(s, c).filter((k) => !edges[k].closed);
    expect(ring.length).toBeGreaterThanOrEqual(3);
    expect(tr.excess[c], '닫힌 구간에는 차가 다니지 않는다').toBe(0);
    for (const k of ring) {
      expect([tr.qBy[k], tr.qEv[k], tr.qInc[k]], `e${k}`).toEqual([c, I.blockEv, I.id]);
      expect(tr.exQueue[k]).toBeGreaterThan(0.3);
      const q = partsOf(s, k).find((p) => p.what === 'queue')!;
      expect([q.ev, q.inc, q.ref]).toEqual([I.blockEv, I.id, c]);
      expect(q.x).toBeCloseTo(tr.exQueue[k], 6);
    }
    // 통제를 푼다 (나무가 길에 만든 상태만 되돌린다 — 장부는 손대지 않는다: 다음 drift 가 상태를 보고 스스로 비운다)
    e.closed = false; e.closedReason = null; e.slow = Math.max(0, e.slow - 1.4); I.blockedEdge = -1;
    let tail = 0, first = true;
    drifts(s, 300, () => {
      expect([tr.closeEv[c], tr.closeInc[c], tr.slowEv[c], tr.slowInc[c]]).toEqual([-1, -1, -1, -1]);
      for (const k of ring) {
        if (tr.exQueue[k] > 0) { tail++; expect([tr.qBy[k], tr.qEv[k], tr.qInc[k]], `꼬리 e${k}`).toEqual([c, I.blockEv, I.id]); }
        else expect([tr.queue[k], tr.qBy[k], tr.qEv[k]]).toEqual([0, -1, -1]);
      }
      if (first) { first = false; for (const k of ring) expect(tr.exQueue[k]).toBeGreaterThan(0); }
    });
    expect(tail, '뿌리가 사라진 뒤에도 밀림은 3분쯤 남는다').toBeGreaterThan(ring.length * 8);
    for (const k of ring) expect(tr.excess[k]).toBe(0);
  });

  it('우회 몰림(b3-5 ②): 구간 하나를 닫으면 그 우회로의 구간들에만 차가 몰린다 — 통행량이 큰 길이 막힐수록 크고, 상한을 넘지 않으며, 풀면 다음 drift 에 0. 우회로가 없는 구간을 닫아도 예외가 없다', () => {
    const s = quiet('S7'), tr = s.traffic, edges = s.city.edges, flow = roadFlow(s);
    drifts(s, 15);
    for (const e of edges) expect([tr.divert[e.id], tr.divertBy[e.id]]).toEqual([0, -1]);
    expect([tr.detours.size, tr.detourSig]).toEqual([0, '']);
    const lanes = (id: number): number => LANES[edges[id].cls!];
    const vol = (id: number): number => lanes(id) * (0.25 + flow[id]);
    const shut = (id: number, text: string): number => { const e = edges[id]; e.closed = true; e.closedReason = 'incident'; const ev = note(s, text); noteRoadCause(s, id, 'close', ev); return ev; };
    const open = (id: number): void => { const e = edges[id]; e.closed = false; e.closedReason = null; };
    // 통행량이 큰 간선 하나 (막아도 도시가 끊기지 않는 것)
    const A = edges.filter((e) => e.cls === 'arterial' && canBlock(s, e) && e.gateT === undefined).sort((p, q) => flow[q.id] - flow[p.id] || p.id - q.id)[0];
    const before = edges.map((e) => e.cong);
    const evA = shut(A.id, `${A.name} 통제 (시험)`);
    drifts(s, 12);
    const path = tr.detours.get(A.id)!;
    expect(path.length).toBeGreaterThanOrEqual(2);
    expect(tr.detourSig).toBe(A.id + ',');
    // 우회로는 닫힌 구간을 지나지 않고 그 양 끝을 잇는다
    { let cur = A.b; for (const id of path) { const e = edges[id]; expect(e.closed).toBe(false); expect(e.a === cur || e.b === cur, `e${id} 가 이어진다`).toBe(true); cur = e.a === cur ? e.b : e.a; } expect(cur).toBe(A.a); }
    for (const e of edges) {
      const on = path.indexOf(e.id) >= 0;
      if (!on) { expect([tr.divert[e.id], tr.divertBy[e.id], tr.exDiv[e.id]], `우회로 밖 e${e.id}`).toEqual([0, -1, 0]); continue; }
      expect(tr.divert[e.id]).toBeCloseTo((DIVERT.K * vol(A.id)) / lanes(e.id), 5);      // 좁은 길일수록 같은 차에 더 밀린다
      expect(tr.divertBy[e.id]).toBe(A.id);
      expect(tr.exDiv[e.id]).toBeGreaterThan(0);
      expect(tr.exDiv[e.id]).toBeLessThanOrEqual(DIVERT.MAX + 1e-6);
      const dp = partsOf(s, e.id).find((q) => q.what === 'divert')!;
      expect([dp.ev, dp.inc, dp.ref]).toEqual([evA, -1, A.id]);      // 내력: 그 통제의 기록, 관련 구간 = 닫힌 구간
      expect(dp.x).toBeCloseTo(tr.exDiv[e.id], 6);
    }
    // 막다른 가지(우회로가 될 수 없는 구간)에는 몰림이 없다
    for (const e of edges) if (!reallyLinked(s, e.a, e.b, e.id) && !e.closed) expect(tr.divert[e.id], `막다른 e${e.id}`).toBe(0);
    // 몰린 길의 혼잡이 따라 오른다 (12초마다 35%씩) — 목표값에 더해질 뿐 밀림의 뿌리가 되지는 않는다(압력에 넣지 않는다)
    drifts(s, 36);
    // (닫힌 구간에 닿지 않은 우회로의 가운데 구간은 예전에는 아무 일도 없던 곳이다)
    for (const id of path) expect(edges[id].cong, `e${id}`).toBeGreaterThan(before[id] + 0.5 * Math.min(DIVERT.MAX, tr.divert[id], 3 - tr.base[id]) - 0.25);
    // 통행량이 작은 이면 도로를 하나 더 닫는다: 그 우회로에 얹히는 양은 통행량의 비만큼 작다
    const L = edges.filter((e) => e.cls === 'local' && !e.closed && canBlock(s, e) && path.indexOf(e.id) < 0 && e.gateT === undefined && !tr.obstacles.some((o) => o.edge === e.id)).sort((p, q) => flow[p.id] - flow[q.id] || p.id - q.id)[0];
    expect(vol(L.id)).toBeLessThan(vol(A.id) / 3);
    shut(L.id, `${L.name} 통제 (시험)`);
    drifts(s, 12);
    expect(tr.detourSig).toBe([A.id, L.id].sort((p, q) => p - q).map((k) => k + ',').join(''));
    const pathL = tr.detours.get(L.id)!, pathA = tr.detours.get(A.id)!;
    expect(pathL.length).toBeGreaterThan(0);
    for (const id of pathL) {
      const both = pathA.indexOf(id) >= 0;
      expect(tr.divert[id]).toBeCloseTo((DIVERT.K * (vol(L.id) + (both ? vol(A.id) : 0))) / lanes(id), 5);
      expect(tr.divertBy[id], '가장 크게 보탠 닫힌 구간').toBe(both ? A.id : L.id);
    }
    for (const e of edges) expect(Math.min(DIVERT.MAX, tr.divert[e.id])).toBeLessThanOrEqual(DIVERT.MAX);
    // 풀면 다음 drift 에 0 이다 (상태를 쌓지 않는다)
    open(A.id); open(L.id);
    drifts(s, 12);
    for (const e of edges) expect([tr.divert[e.id], tr.divertBy[e.id], tr.exDiv[e.id]], `e${e.id}`).toEqual([0, -1, 0]);
    expect([tr.detours.size, tr.detourSig]).toEqual([0, '']);
    // 우회로가 없는 구간(막다른 가지)을 닫아도 예외가 없고 몰리는 길도 없다
    const D = edges.find((e) => !reallyLinked(s, e.a, e.b, e.id))!;
    shut(D.id, `${D.name} 통제 (시험)`);
    drifts(s, 12);
    expect(tr.detours.get(D.id)).toEqual([]);
    for (const e of edges) expect(tr.divert[e.id]).toBe(0);
    open(D.id);
    expect(s.world.hz.holes).toBe(0);
  });

  it('쓰러진 나무의 "이웃 구간 +0.7" 은 없다 — 이웃이 밀리고 우회로가 몰리는 것은 닫힌 까닭을 가리지 않는 교통 모델의 일반 규칙이다 (나무·공사·낙하물이 같은 길을 막으면 같은 몰림)', () => {
    const src = readFileSync('src/sim/incidents.ts', 'utf8');
    expect(/cong\s*\+\s*0\.7/.test(src)).toBe(false);
    const run1 = (how: 'tree' | 'work' | 'debris'): { c: number; div: number[]; by: number[] } => {
      const s = quiet('S7'), tr = s.traffic, edges = s.city.edges;
      drifts(s, 15);
      const fac = new Set(s.city.facilities.map((f) => f.nodeId));
      const nd = s.city.nodes.find((q) => !fac.has(q.id) && q.edges.length >= 3 && q.edges.some((k) => edges[k].arterial))!;
      const pre = nd.edges.map((k) => edges[k].cong);
      let c: number;
      if (how === 'tree') {
        c = createIncident(s, { type: 'traffic', variant: 'tree', nodeId: nd.id }).blockedEdge;
        expect(nd.edges.map((k) => edges[k].cong), '발생 순간에는 이웃의 혼잡을 손대지 않는다').toEqual(pre);
      } else {
        // 같은 구간을 다른 까닭으로 막는다 (그 구간 번호는 나무가 고르는 것과 같다: 간선 먼저 · 번호 작은 것)
        const es = nd.edges.map((k) => edges[k]).filter((e) => !e.closed && e.cls !== 'highway').sort((a, b) => (b.arterial ? 1 : 0) - (a.arterial ? 1 : 0) || a.id - b.id);
        c = es[0].id;
        expect(addObstacle(s, { edge: c, kind: how === 'work' ? 'roadwork' : 'debris', full: true, dur: 300, known: how === 'work' })).not.toBeNull();
      }
      drifts(s, 12);
      return { c, div: Array.from(tr.divert), by: Array.from(tr.divertBy) };
    };
    const t = run1('tree'), w = run1('work'), d = run1('debris');
    expect([w.c, d.c]).toEqual([t.c, t.c]);
    expect(t.div.some((v) => v > 0)).toBe(true);
    expect(w.div).toEqual(t.div); expect(d.div).toEqual(t.div);      // 아직 아무도 모르는 낙하물이어도 같다 — 시민의 차는 가서 보고 돌아선다
    expect(w.by).toEqual(t.by); expect(d.by).toEqual(t.by);
  });

  it('얹은 혼잡의 줄: 인파와 정전이 겹친 구간에서 한쪽을 거두면 e.bump 와 남은 줄이 맞는다 — 줄이 없는 혼잡은 기록 없는 몫이 된다. 한 차로 장애물·정체·차오르는 물의 주인', () => {
    const s = quiet('S7'), tr = s.traffic, edges = s.city.edges;
    drifts(s, 15);
    // 서로 멀리 떨어진(이웃의 이웃도 겹치지 않는) 한가한 일반 도로 넷 — 막아도 도시가 끊기지 않는 구간
    const used = new Set<number>(), pickd: typeof edges = [];
    for (const e of edges) {
      if (pickd.length >= 4) break;
      if (e.cls !== 'street' || e.closed || e.gateT !== undefined || tr.obstacles.some((o) => o.edge === e.id) || e.baseCong * tr.tod * s.tune.trafficMul >= 1.3 || !reallyLinked(s, e.a, e.b, e.id)) continue;
      const near = [e.id, ...nbrs(s, e.id)], wide = new Set<number>(near);
      for (const k of near) for (const q of nbrs(s, k)) wide.add(q);
      if ([...wide].some((k) => used.has(k))) continue;
      for (const k of wide) used.add(k);
      pickd.push(e);
    }
    const [e1, e2, e3, e4] = pickd;
    expect(pickd.length).toBe(4);
    const evC = note(s, '행사장 주변에 인파가 몰려 길이 밀립니다.'), evD = note(s, '정전 — 신호등이 꺼졌습니다.');
    const crowd = addBump(s, [e1.id, e2.id], 0.8, evC, 0), dark = addBump(s, edges.map((e) => e.id), 0.4, evD, 1, 7);
    expect([e1.bump, e3.bump, tr.bumps.length]).toEqual([0.8 + 0.4, 0.4, 2]);
    drifts(s, 12);
    expect(tr.exBump[e1.id]).toBeCloseTo(1.2, 6);
    expect(partsOf(s, e1.id).filter((p) => p.what === 'crowd' || p.what === 'dark').map((p) => [p.what, p.ev, p.inc, +p.x.toFixed(6)])).toEqual([['crowd', evC, -1, 0.8], ['dark', evD, 7, 0.4]]);
    expect(partsOf(s, e3.id).filter((p) => p.what !== 'queue').map((p) => [p.what, p.ev, +p.x.toFixed(6)])).toEqual([['dark', evD, 0.4]]);
    // 정전이 먼저 끝난다: 남은 몫은 인파다
    removeBump(s, dark);
    expect([+(e1.bump ?? 0).toFixed(9), e3.bump, tr.bumps.map((b) => b.id)]).toEqual([0.8, 0, [crowd]]);
    drifts(s, 12);
    expect(partsOf(s, e1.id).filter((p) => p.x > 0 && p.what !== 'queue').map((p) => [p.what, p.ev])).toEqual([['crowd', evC]]);
    expect(tr.exBump[e3.id]).toBe(0);
    removeBump(s, crowd); removeBump(s, crowd); unnoteBump(s, 999);
    expect([e1.bump, e2.bump, tr.bumps.length]).toEqual([0, 0, 0]);
    // 장부 줄만 넣고 빼기 (산술을 자기 자리에서 하는 인파·태풍 정전의 길)
    const row = noteBump(s, [e2.id], 0.8, evC, 0);
    expect(e2.bump).toBe(0);
    unnoteBump(s, row);
    // 줄이 없는 혼잡: 기록 없는 몫 — 법칙이 그 몫으로 문턱을 넘으면 구멍으로 센다
    e4.bump = 0.5;
    drifts(s, 12);
    expect(partsOf(s, e4.id).filter((p) => p.what !== 'queue').map((p) => [p.ev, +p.x.toFixed(6)])).toEqual([[-1, 0.5]]);
    e4.bump = 0;
    // 한 차로 장애물: 그 알림 기록이 병목(0.9)의 주인. 전면 차단이면 닫힘의 주인
    const lane = addObstacle(s, { edge: e3.id, kind: 'breakdown', full: false, dur: 200, known: true })!;
    const full = addObstacle(s, { edge: e2.id, kind: 'roadwork', full: true, dur: 200, known: true })!;
    expect(s.events[lane.ev!].text).toContain('고장 차량');
    expect([tr.closeEv[e2.id], tr.closeInc[e2.id], s.events[full.ev!].text.includes('공사')]).toEqual([full.ev, -1, true]);
    // 정체: 그 정체를 알린 기록이 주인 (정체 없는 압력이 2.8 아래인 만큼이 초과)
    const evJ = note(s, '시험로 정체 발생.');
    tr.jams.push({ edge: e4.id, until: s.t + 100, ev: evJ });
    // 차오르는 물: 느림을 건 자리가 적고 거둘 때 지운다 (쓰는 것은 b3-12 — 여기서는 장부의 길만)
    noteRoadCause(s, e1.id, 'level', evD);
    drifts(s, 12);
    expect(partsOf(s, e3.id).filter((p) => p.what === 'lane').map((p) => [p.ev, p.inc, p.ref, +p.x.toFixed(6)])).toEqual([[lane.ev, -1, e3.id, 0.9]]);
    expect(tr.exOwn[e3.id]).toBeCloseTo(0.9, 6);
    const pj = partsOf(s, e4.id).find((p) => p.what === 'jam')!;
    expect([pj.ev, pj.ref]).toEqual([evJ, e4.id]);
    expect(pj.x).toBeGreaterThan(0.5);
    expect(pj.x).toBeLessThanOrEqual(2.8 - e4.baseCong * tr.tod * s.tune.trafficMul + 1e-9);
    expect(partsOf(s, e1.id).filter((p) => p.what === 'level').map((p) => [p.ev, +p.x.toFixed(6)])).toEqual([[evD, LEVEL_EX]]);
    expect([tr.excess[e2.id], partsOf(s, e2.id).length], '닫힌 구간은 0').toEqual([0, 0]);
    // 몫을 더하면 초과이고, 초과는 네 몫의 합이며 상한까지의 여유를 넘지 않는다
    for (const e of edges) {
      const sum = partsOf(s, e.id).reduce((a, p) => a + p.x, 0);
      expect(sum).toBeCloseTo(tr.excess[e.id], 5);
      expect(tr.exOwn[e.id] + tr.exBump[e.id] + tr.exQueue[e.id] + tr.exDiv[e.id]).toBeCloseTo(tr.excess[e.id], 5);
      expect(tr.excess[e.id]).toBeLessThanOrEqual(3 - tr.base[e.id] + 1e-5);
      // 우회 몰림(b3-5 ②): 몰린 양이 있으면 가장 크게 보탠 닫힌 구간이 있고, 그 몫은 상한을 넘지 않는다 (전면 공사로 닫은 e2 의 우회로가 몰려 있다)
      expect(tr.divert[e.id] > 0, `e${e.id}`).toBe(tr.divertBy[e.id] >= 0);
      if (tr.divertBy[e.id] >= 0) expect(edges[tr.divertBy[e.id]].closed).toBe(true);
      expect(tr.exDiv[e.id]).toBeLessThanOrEqual(Math.min(DIVERT.MAX, tr.divert[e.id]) + 1e-6);
    }
    expect(edges.filter((e) => tr.divertBy[e.id] === e2.id).length, '닫힌 e2 의 우회로').toBeGreaterThan(0);
    noteRoadCause(s, e1.id, 'level', -1);
    drifts(s, 12);
    expect(partsOf(s, e1.id).some((p) => p.what === 'level')).toBe(false);
  });

  it('실제 교대의 장부(보통 S7 · 태풍 S1 · 지진 S2 · 홍수 S0): 닫힘·감속·정체·장애물·얹은 혼잡마다 기록이 있고 그 문구가 그 상태를 말한다 — 몫을 더하면 초과이고, 장부 없는 초과의 노출량은 0', () => {
    const seen = { closed: 0, slow: 0, jam: 0, obst: 0, crowd: 0, dark: 0, excess: 0, queue: 0, tail: 0, disasterClose: 0 };
    const audit = (seed: string, d: Difficulty): HazCount => {
      const s = new Sim(seed, d, 1200), tr = s.traffic, edges = s.city.edges, hp = new HazProbe(s), buf: RoadPart[] = [];
      let last = tr.driftAt;
      while (!s.ended) {
        s.step(); hp.tick();
        if (tr.driftAt === last) continue;
        last = tr.driftAt;
        for (const e of edges) {
          const id = e.id;
          if (e.closed) {
            seen.closed++;
            expect(tr.closeEv[id], `${seed} t=${s.t} e${id} 닫힘(${e.closedReason})의 주인`).toBeGreaterThanOrEqual(0);
            expect(s.events[tr.closeEv[id]].text, `${seed} e${id}`).toMatch(/통제|통행 불가|막혔습니다/);
            if (e.closedReason === 'disaster') { seen.disasterClose++; expect(tr.closeInc[id]).toBe(-1); }
            if (e.closedReason === 'incident') expect(tr.closeInc[id]).toBeGreaterThanOrEqual(0);
          } else if (e.slow >= 1) {
            seen.slow++;
            expect(tr.slowEv[id], `${seed} t=${s.t} e${id} 감속의 주인`).toBeGreaterThanOrEqual(0);
            expect(s.events[tr.slowEv[id]].kind).toBe('incident');
            expect(tr.slowInc[id]).toBe(s.events[tr.slowEv[id]].incidentId);
          }
          const x = tr.excess[id];
          expect(tr.exOwn[id] + tr.exBump[id] + tr.exQueue[id] + tr.exDiv[id]).toBeCloseTo(x, 4);
          expect(x).toBeLessThanOrEqual(3 - tr.base[id] + 1e-4);
          const np = roadParts(s, id, buf);
          let sum = 0;
          for (let k = 0; k < np; k++) {
            const p = buf[k];
            sum += p.x;
            expect(p.ev, `${seed} t=${s.t} e${id} ${p.what} 몫(${p.x.toFixed(3)} / ${x.toFixed(3)})의 기록`).toBeGreaterThanOrEqual(0);
            if (p.what === 'queue') { seen.queue++; expect(p.ref).toBeGreaterThanOrEqual(0); if (!edges[p.ref].closed && edges[p.ref].slow < 1) seen.tail++; }
          }
          expect(sum).toBeCloseTo(x, 4);
          if (x > 0) seen.excess++;
        }
        for (const j of tr.jams) { seen.jam++; expect(s.events[j.ev].text).toContain('정체 발생'); }
        for (const o of tr.obstacles) { if (o.kind === 'parked') continue; seen.obst++; expect(o.ev, `${seed} ${o.label}`).toBeDefined(); expect(s.events[o.ev!].kind).toBe('traffic'); }
        for (const c of tr.crowds) { seen.crowd++; const row = tr.bumps.find((b) => b.id === c.bump)!; expect([row.what, row.add, row.edges]).toEqual([0, 0.8, c.edges]); expect(s.events[row.ev].text).toContain('인파가 몰려'); }
        const dz = s.disaster;
        if (dz && dz.dark) { seen.dark++; const row = tr.bumps.find((b) => b.id === dz.darkBump)!; expect([row.what, row.edges.length]).toEqual([1, edges.length]); expect(s.events[row.ev].text).toContain('정전'); }
        // (b3-10 C4) 정전 한 건마다의 꺼진 신호 — 그 줄은 world.spans 의 한 건이 가진다(원인 기록 = 그 정전의 원인)
        const c4 = tr.bumps.filter((b) => b.what === 1 && !(dz && b.id === dz.darkBump));
        for (const b of c4) { const sp = s.world.spans.find((q) => q.bump === b.id)!; expect(sp, `${seed} C4 bump ${b.id} 의 장부`).toBeDefined(); expect([sp.f, b.ev, b.add]).toEqual(['power', sp.cause, 0.4]); }
        // (b3-11 C5) 연기 한 건마다의 시야 혼잡(what 2 — 'haze') — 그 줄도 world.spans 의 연기 줄이 가진다(원인 기록 = 그 연기 알림, 양 = BUMP × 세기)
        const c5 = tr.bumps.filter((b) => b.what === 2);
        for (const b of c5) { const sp = s.world.spans.find((q) => q.bump === b.id)!; expect(sp, `${seed} C5 bump ${b.id} 의 장부`).toBeDefined(); expect([sp.f, b.ev]).toEqual(['smoke', sp.cause]); expect(b.add).toBeCloseTo(SMOKE.BUMP * sp.v!, 9); expect(s.events[b.ev].tag).toBe('smoke'); }
        expect(tr.bumps.length).toBe(tr.crowds.length + (dz && dz.dark ? 1 : 0) + c4.length + c5.length);
      }
      // 교대가 끝나면 얹은 혼잡과 그 줄이 남지 않는다 — (b3-10) 원인이 아직 살아 있는 정전의 꺼진 신호만 남고, 구간의 bump 는 남은 줄의 합이다
      for (const b of tr.bumps) expect(s.world.spans.some((q) => q.bump === b.id), `${seed} 남은 줄 ${b.id}`).toBe(true);
      for (const e of edges) expect(e.bump ?? 0).toBeCloseTo(tr.bumps.reduce((a, b) => a + (b.edges.indexOf(e.id) >= 0 ? b.add : 0), 0), 6);
      expect(s.world.hz.holes).toBe(0);
      return hp.done();
    };
    const dis = (z: string): Difficulty => ({ ...NORMAL, disaster: parseDisaster(z)! });
    const runs = [audit('S7', NORMAL), audit('S1', dis('typhoon')), audit('S2', dis('quake')), audit('S0', dis('flood'))];
    for (const h of runs) {
      const r = h.road!;
      expect(r.drifts).toBeGreaterThanOrEqual(99);
      expect(r.unledgered, '장부 없는 초과의 노출량').toBe(0);
      expect(r.own + r.bump + r.queue + r.div).toBeGreaterThan(1000);
      const tot = r.own + r.bump + r.queue + r.div;
      expect(Math.abs(Object.values(r.byWhat).reduce((a, v) => a + v, 0) - tot) / tot, '갈래별 합 = 네 몫의 합 (배열은 32비트 실수라 상대 오차로 본다)').toBeLessThan(1e-6);
      expect(r.div, '닫힌 구간이 있던 교대에는 우회 몰림의 노출량이 있다').toBeGreaterThan(0);
      expect(r.byWhat.divert).toBeGreaterThan(0);
    }
    expect(runs[1].road!.byWhat.dark, '태풍의 정전').toBeGreaterThan(0);
    for (const k of ['closed', 'slow', 'jam', 'obst', 'dark', 'excess', 'queue', 'tail', 'disasterClose'] as const) expect(seen[k], k).toBeGreaterThan(0);
    const sum = sumHaz(runs);
    expect(hazLines(sum)[1].startsWith('hazard-road: exposure ')).toBe(true);
    expect((hazJson(sum).road as { unledgered: number }).unledgered).toBe(0);
  }, 120000);

  it('막아도 되는 구간(canBlock — 재난의 우회로 판정을 옮긴 것): 실제 상태에서, 열린 사건이 잡고 있는 구간도 막힌 것으로 치고 양 끝이 이어지는가. 홍수의 구간 문턱은 roadSill 로 읽는다', () => {
    const s = quiet('S7'), edges = s.city.edges;
    for (const e of edges) expect(canBlock(s, e), `e${e.id}`).toBe(reallyLinked(s, e.a, e.b, e.id));
    expect(edges.filter((e) => !canBlock(s, e)).length).toBeGreaterThan(5);      // 막다른 가지
    expect(edges.filter((e) => canBlock(s, e) && !canBlock(s, e, true)).length, '다리 없이는 이어지지 않는 구간').toBeGreaterThan(0);
    // 열린 사건이 구간 하나를 잡고 있다(아직 닫히지 않았다): 그 구간에 기대는 우회로는 우회로가 아니다
    const I = createIncident(s, { type: 'traffic', variant: 'std', severity: 1 });
    expect([edges[I.blockedEdge].closed, edges[I.blockedEdge].slow]).toEqual([false, 1.4]);
    // 그 사건이 잡은 구간을, "막히면 다른 구간 하나의 우회로가 사라지는" 구간으로 옮겨 본다 (고리 하나에 함께 놓인 두 구간)
    let b = edges[I.blockedEdge], hit = -1;
    for (const cand of edges) {
      if (!reallyLinked(s, cand.a, cand.b, cand.id)) continue;
      cand.closed = true;
      const e = edges.find((q) => q.id !== cand.id && !reallyLinked(s, q.a, q.b, q.id) && (() => { cand.closed = false; const was = reallyLinked(s, q.a, q.b, q.id); cand.closed = true; return was; })());
      cand.closed = false;
      if (e) { b = cand; hit = e.id; break; }
    }
    expect(hit).toBeGreaterThanOrEqual(0);
    I.blockedEdge = b.id;
    expect([reallyLinked(s, edges[hit].a, edges[hit].b, hit), canBlock(s, edges[hit])], '우회로가 사건이 잡은 구간뿐이면 막지 못한다').toEqual([true, false]);
    for (const e of edges) {
      if (e.id === b.id) continue;
      b.closed = true; const want = reallyLinked(s, e.a, e.b, e.id); b.closed = false;
      expect(canBlock(s, e), `e${e.id}`).toBe(want);
    }
    expect(canBlock(s, b), '자기가 잡은 구간은 막힌 것으로 치지 않는다').toBe(true);
    expect(b.closed, '판정은 상태를 남기지 않는다').toBe(false);
    I.phase = 'closed';
    for (const e of edges) expect(canBlock(s, e)).toBe(reallyLinked(s, e.a, e.b, e.id));
    const f = new Sim('S0', { ...NORMAL, disaster: parseDisaster('flood')! }, 1200), d = f.disaster!;
    for (const e of f.city.edges) expect(roadSill(f, d, e)).toBe(d.thr![e.id]);
    expect(roadSill(f, d, f.city.edges.find((e) => e.bridge)!)).toBe(0.9);
  });

  it('사고가 난 구간이 막힌다(opts.edgeId — §3.6b (다)): 정해 준 구간이 이 교차로에 닿아 있고 열려 있고 고속도로가 아니며 남이 잡지 않았고 막아도 도시가 끊기지 않으면 그 구간을, 아니면 지금 규칙으로 — 정해 주지 않으면 예전 그대로', () => {
    const s = quiet('S7'), tr = s.traffic, edges = s.city.edges, nodes = s.city.nodes;
    const fac = new Set(s.city.facilities.map((f) => f.nodeId));
    const usual = (nd: number): number => {      // 지금 규칙: 간선 먼저 · 번호 작은 것 (알려진 통제만 피해 돌아갈 길이 있는 구간)
      const es = nodes[nd].edges.map((k) => edges[k]).filter((e) => !e.closed && e.cls !== 'highway').sort((a, b) => (b.arterial ? 1 : 0) - (a.arterial ? 1 : 0) || a.id - b.id);
      for (const e of es) if (findRoute(s.city, e.a, e.b, 1, e.id)) return e.id;
      return -1;
    };
    const crash = (nd: number, edgeId?: number): Incident => { const I = createIncident(s, { type: 'traffic', variant: 'std', severity: 1, nodeId: nd, edgeId, rng: s.rng.fork('edge-test:' + s.incidents.length) }); I.firstCallAt = Infinity; return I; };
    // 서로 멀리 떨어진 교차로들: 구간이 넷 이상이고 모두 막아도 되는 일반 구간
    const picked: number[] = [], far = new Set<number>();
    for (const q of nodes) {
      if (picked.length >= 5) break;
      if (fac.has(q.id) || q.edges.length < 4 || far.has(q.id)) continue;
      if (!q.edges.every((k) => edges[k].cls !== 'highway' && !edges[k].closed && canBlock(s, edges[k]) && !tr.obstacles.some((o) => o.edge === k))) continue;
      picked.push(q.id);
      far.add(q.id); for (const k of q.edges) { const o = edges[k].a === q.id ? edges[k].b : edges[k].a; far.add(o); for (const k2 of nodes[o].edges) far.add(edges[k2].a === o ? edges[k2].b : edges[k2].a); }
    }
    expect(picked.length).toBe(5);
    const [n1, n2, n3, n4, n5] = picked;
    const notUsual = (nd: number): number => nodes[nd].edges.filter((k) => k !== usual(nd)).sort((a, b) => b - a)[0];
    // ① 정해 준 구간을 잡는다 (지금 규칙이 고를 구간이 아니어도)
    const e1 = notUsual(n1), u1 = usual(n1);
    const I1 = crash(n1, e1);
    expect([I1.blockedEdge, edges[e1].slow, edges[u1].slow, tr.slowEv[e1], tr.slowInc[e1]]).toEqual([e1, 1.4, 0, I1.rootEvent, I1.id]);
    // ② 정해 주지 않으면 예전 그대로
    const u2 = usual(n2);
    expect(crash(n2).blockedEdge).toBe(u2);
    // ③ 닫힌 구간 · 이 교차로에 닿지 않은 구간이면 지금 규칙으로
    const e3 = notUsual(n3);
    edges[e3].closed = true; edges[e3].closedReason = 'incident'; noteRoadCause(s, e3, 'close', note(s, '시험 통제'));
    const u3 = usual(n3);
    const I3 = crash(n3, e3);
    expect([I3.blockedEdge, edges[e3].slow]).toEqual([u3, 0]);
    edges[e3].closed = false; edges[e3].closedReason = null;
    const u4 = usual(n4);
    expect(crash(n4, nodes[n5].edges[0]).blockedEdge, '닿지 않은 구간').toBe(u4);
    // ④ 다른 열린 사건이 잡은 구간이면 잡지 않는다 — 대신 고르는 구간도 남이 잡지 않았고 막아도 끊기지 않는다 (법칙이 낸 사고는 지금 규칙에서도 그 둘을 본다)
    const other = edges[e1].a === n1 ? edges[e1].b : edges[e1].a;
    const I5 = crash(other, e1);
    expect(I5.blockedEdge).not.toBe(e1);
    expect(edges[e1].slow, '감속을 한 번 더 걸지 않는다').toBe(1.4);
    if (I5.blockedEdge >= 0) { expect(s.incidents.some((q) => q !== I5 && q.phase !== 'closed' && q.blockedEdge === I5.blockedEdge)).toBe(false); expect(canBlock(s, edges[I5.blockedEdge])).toBe(true); }
    // ⑤ 막으면 끊기는 구간(막다른 가지)은 잡지 않는다 · 고속도로도
    const D = edges.find((e) => !reallyLinked(s, e.a, e.b, e.id) && !fac.has(e.a) && !fac.has(e.b) && !s.incidents.some((q) => q.truth.nodeId === e.a || q.truth.nodeId === e.b))!;
    const nD = nodes[D.a].edges.length >= nodes[D.b].edges.length ? D.a : D.b;
    expect(crash(nD, D.id).blockedEdge).not.toBe(D.id);
    expect(D.slow).toBe(0);
    const H = edges.find((e) => e.cls === 'highway' && !fac.has(e.a) && !s.incidents.some((q) => q.truth.nodeId === e.a))!;
    expect(crash(H.a, H.id).blockedEdge).not.toBe(H.id);
    expect(H.slow).toBe(0);
  });

  it('소스 글자: 밖에서 혼잡을 얹는 자리는 교통 모델과 재난의 정전 둘뿐이다 (.bump += · .bump = — 장부 없는 혼잡은 구멍이 된다)', () => {
    const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(dir + '/' + e.name) : e.name.endsWith('.ts') ? [dir + '/' + e.name] : []));
    const hits: string[] = [];
    for (const f of walk('src/sim')) {
      if (f === 'src/sim/traffic.ts') continue;
      const lines = readFileSync(f, 'utf8').split('\n');
      for (let i = 0; i < lines.length; i++) if (/\.bump\s*(?:\+=|-=|=[^=])/.test(lines[i].replace(/\/\/.*$/, ''))) hits.push(`${f}:${lines[i].trim()}`);
    }
    expect(hits.length).toBe(2);
    expect(hits.every((h) => h.startsWith('src/sim/disaster.ts:') && h.includes('DARK_BUMP'))).toBe(true);
    // 재난의 그 두 자리는 장부 줄을 함께 넣고 뺀다
    const dz = readFileSync('src/sim/disaster.ts', 'utf8');
    expect(dz).toContain('d.darkBump = noteBump(');
    expect(dz).toContain('unnoteBump(sim, d.darkBump)');
  });
});

// ───────────────────────── b3-6: L1 roadCrash (§3.7 L1 의 시험 ①~⑧ · 개입 시험 §6 I1-b 10) ─────────────────────────
// 진짜 법칙으로 돈다(가짜 법칙이 아니다). 세기 ROAD.A 는 시험이 키워 쓰고 finally 에서 되돌린다 — 그 사이에는 자기 Sim 만 돌린다.
describe('I1-b b3-6: L1 roadCrash — 차가 몰린 길에서는 사고가 잦다', () => {
  const withA = <R>(A: number, fn: () => R): R => { const a0 = ROAD.A; ROAD.A = A; try { return fn(); } finally { ROAD.A = a0; } };
  const A0 = ROAD.A;
  /** 실제로 돌린다 — 교통 모델이 혼잡을 다시 계산한 뒤의 1초 블록(법칙이 그 주기를 적분한 틱)마다 each */
  function cycles(s: Sim, sec: number, each?: () => void): number {
    let n = 0;
    const end = s.tick + sec * 5;
    while (s.tick < end && !s.ended) { const was = s.world.hz.roadAt; s.step(); if (s.world.hz.roadAt !== was) { n++; if (each) each(); } }
    return n;
  }
  const partsOf = (s: Sim, id: number): RoadPart[] => { const buf: RoadPart[] = []; buf.length = roadParts(s, id, buf); return buf; };
  const weightOf = (s: Sim, id: number): number => roadWeight(s.city.edges[id], roadFlow(s)[id], roadSurface(s));
  /** 그 구간이 쌓아 온 위험의 합 = 칸의 H + 이미 넘은 문턱들 (문턱은 (시드, 법칙, 구간, 몇 번째)만의 함수라 다시 뽑아 셀 수 있다) */
  const cum = (s: Sim, id: number): number => {
    const c = hazardCell(s, 'roadCrash', id);
    if (!c) return 0;
    let h = c.H;
    for (let j = 0; j < c.n; j++) h += -Math.log(1 - s.rng.fork('hz:roadCrash:' + id + ':' + j).next());
    return h;
  };
  /** 교통 사건만 돌던 교대를 T 초에 얼리고(새 교통 사건·평소 사건·대형 사고 없음) 통행량이 가장 큰 간선에 나무를 쓰러뜨린다 */
  function treeShift(seed: string, T: number): { s: Sim; I: Incident; c: number } {
    const s = new Sim(seed, NORMAL, 1200);
    s.gen.nextAt = s.gen.majorAt = Infinity; s.gen.nextNuisanceAt = Infinity;
    while (s.t < T) s.step();
    s.traffic.nextEvent = Infinity;
    const edges = s.city.edges, flow = roadFlow(s), fac = new Set(s.city.facilities.map((f) => f.nodeId));
    let best = -1, bf = -1;
    for (const nd of s.city.nodes) {
      if (fac.has(nd.id) || nd.edges.length < 3) continue;
      const es = nd.edges.map((k) => edges[k]).filter((e) => !e.closed && e.cls !== 'highway').sort((a, b) => (b.arterial ? 1 : 0) - (a.arterial ? 1 : 0) || a.id - b.id);
      if (!es.length || !es[0].arterial || !canBlock(s, es[0]) || s.traffic.obstacles.some((o) => o.edge === es[0].id)) continue;
      if (flow[es[0].id] > bf) { bf = flow[es[0].id]; best = nd.id; }
    }
    const I = createIncident(s, { type: 'traffic', variant: 'tree', nodeId: best });
    return { s, I, c: I.blockedEdge };
  }

  it('등록: 법칙 모음의 첫 줄이 roadCrash 다 — 12초 주기 · 구간마다 몇 번이고 · 교대 상한 3. 가중은 통행량 × 노면·시야 × 길이이고 측정 도구가 같은 식을 쓴다', () => {
    const law = hazardLaws()[0];
    expect([law.id, law.every, law.once, law.cap, law.label, hazardLabel('roadCrash')]).toEqual(['roadCrash', 12, false, 3, '몰린 길의 사고', '몰린 길의 사고']);
    expect(readFileSync('src/sim/world/laws/index.ts', 'utf8')).toMatch(/^import '\.\/road';/m);
    expect(A0).toBeGreaterThan(1e-5); expect(A0).toBeLessThan(6e-5);
    const e = { len: 150 } as Sim['city']['edges'][number];
    expect(roadWeight(e, 0.5, 1)).toBeCloseTo(1.2, 9);                                             // V = 0.4 + 1.6 × 통행량
    expect([roadWeight({ ...e, len: 30 }, 0.5, 1), roadWeight({ ...e, len: 900 }, 0.5, 1)].map((v) => +v.toFixed(6))).toEqual([0.6, 2.4]);      // ℓ = clamp(길이 / 150, 0.5, 2)
    // 노면·시야: 맑은 낮 1 · 비 (1/0.88)² · 안개 (1/0.84)² · 밤 1.2 — 난이도의 차량 속도 손잡이는 약분돼 빠진다
    const want: Record<string, number> = { clear: 1, rain: 1 / 0.88 ** 2, fog: 1 / 0.84 ** 2, night: 1.2 };
    const seen = new Set<string>();
    for (let k = 0; k < 40 && seen.size < 4; k++) { const s = new Sim('S' + k, NORMAL, 1200); if (seen.has(s.weather)) continue; seen.add(s.weather); expect(roadSurface(s), s.weather).toBeCloseTo(want[s.weather], 9); }
    expect(seen.size).toBe(4);
    const hs = readFileSync('scripts/hazstats.ts', 'utf8');
    expect(hs).toContain("from '../src/sim/world/laws/road'");
    expect(/0\.4 \+ 1\.6/.test(hs), '측정 도구에 가중의 식을 따로 쓰지 않는다').toBe(false);
  });

  it('① 평소의 도로에는 위험이 쌓이지 않는다: 교통 사건·사건·재난이 없으면 칸도 난수도 사건도 없다 — 세기를 천 배로 키워도, 날씨가 나빠도(초과분에만 곱한다), 수요만으로 꽉 찬 길 곁에서도', () => {
    withA(A0 * 1000, () => {
      // 날씨가 나쁜 교대를 둘 — 날씨만으로는 사고가 나지 않는다
      const bad: Sim[] = [];
      for (let k = 0; k < 40 && bad.length < 2; k++) { const s = quiet('S' + k); if (s.weather !== 'clear' && !bad.some((q) => q.weather === s.weather)) bad.push(s); }
      for (const s of [quiet('S7'), ...bad]) {
        const n = cycles(s, 300, () => { for (const e of s.city.edges) expect(s.traffic.excess[e.id]).toBe(0); });
        expect(n).toBeGreaterThanOrEqual(24);
        expect(s.world.hz.cells.roadCrash, s.weather).toBeUndefined();
        expect([lawInc(s).length, s.world.hz.holes, s.gen.dropped.length, s.world.log.length]).toEqual([0, 0, 0, 0]);
      }
      // 수요만으로 꽉 찬 구간(평소의 뿌리)의 이웃은 밀리지만 그 밀림은 초과가 아니다 — 그 위에 혼잡을 얹어도 이웃의 위험은 0 이다
      const s = quiet('S7'), tr = s.traffic, edges = s.city.edges;
      cycles(s, 15);
      const nb = (id: number): number[] => { const e = edges[id], out: number[] = []; for (const nd of [e.a, e.b]) for (const k of s.city.nodes[nd].edges) if (k !== id && out.indexOf(k) < 0) out.push(k); return out; };
      const E = edges.find((e) => e.cls === 'arterial' && !e.closed && nb(e.id).every((k) => !edges[k].closed))!;
      E.baseCong = 6;
      cycles(s, 60);
      addBump(s, [E.id], 0.8, note(s, '시험으로 얹은 혼잡'), 0);
      cycles(s, 36);
      for (const k of nb(E.id)) { expect(tr.queue[k]).toBeGreaterThan(0.5); expect([tr.exQueue[k], hazardCell(s, 'roadCrash', k)]).toEqual([0, null]); }
      expect(s.world.hz.cells.roadCrash).toBeUndefined();
      expect(lawInc(s).length).toBe(0);
    });
  });

  it('② 구간 하나를 닫으면 우회로와 이웃의 구간에 위험이 쌓인다: H = A × 초과 × 통행량 × 노면 × 길이 × 12초 — 닫힌 구간 자신과 초과가 없는 구간에는 칸이 없다. 통제를 풀면 적분이 멎는다(H 는 그대로)', () => {
    withA(A0 / 1000, () => {      // 문턱을 넘지 않을 만큼 작게 — 적분만 본다
      const s = quiet('S7'), tr = s.traffic, edges = s.city.edges;
      cycles(s, 15);
      const A = edges.filter((e) => e.cls === 'arterial' && canBlock(s, e) && e.gateT === undefined).sort((p, q) => roadFlow(s)[q.id] - roadFlow(s)[p.id] || p.id - q.id)[0];
      A.closed = true; A.closedReason = 'incident';
      const ev = note(s, `${A.name} 통제 (시험)`);
      noteRoadCause(s, A.id, 'close', ev);
      const want = new Map<number, number>();
      const n = cycles(s, 48, () => { for (const e of edges) if (tr.excess[e.id] > 0) want.set(e.id, (want.get(e.id) ?? 0) + ROAD.A * tr.excess[e.id] * weightOf(s, e.id) * 12); });
      expect(n).toBe(4);
      const path = tr.detours.get(A.id)!;
      expect(path.length).toBeGreaterThan(0);
      for (const id of path) { expect(tr.exDiv[id], `우회로 e${id}`).toBeGreaterThan(0); expect(tr.divertBy[id]).toBe(A.id); expect(want.has(id)).toBe(true); }
      const ring = edges.filter((e) => !e.closed && (e.a === A.a || e.b === A.a || e.a === A.b || e.b === A.b));
      for (const e of ring) { expect(tr.exQueue[e.id], `이웃 e${e.id}`).toBeGreaterThan(0); expect([tr.qBy[e.id], tr.qEv[e.id]]).toEqual([A.id, ev]); }
      expect(want.size).toBeGreaterThanOrEqual(ring.length);
      for (const e of edges) {
        const c = hazardCell(s, 'roadCrash', e.id);
        if (!want.has(e.id)) { expect(c, `초과가 없던 e${e.id}`).toBeNull(); continue; }
        expect(c!.n).toBe(0);
        expect(c!.H / want.get(e.id)!, `e${e.id}`).toBeCloseTo(1, 6);
        expect(c!.since).toBeGreaterThan(15);
      }
      expect(hazardCell(s, 'roadCrash', A.id), '닫힌 구간에는 차가 다니지 않는다').toBeNull();
      // 통제를 푼다: 우회 몰림은 다음 주기에 0 — 우회로의 가운데 구간은 적분이 멎고(since −1) H 는 그대로다. 이웃은 밀림이 빠지는 동안 조금 더 쌓인다
      A.closed = false; A.closedReason = null;
      const far = path.filter((id) => !ring.some((e) => e.id === id) && tr.exQueue[id] === 0);
      const H0 = far.map((id) => hazardCell(s, 'roadCrash', id)!.H);
      cycles(s, 24);
      for (let k = 0; k < far.length; k++) expect([hazardCell(s, 'roadCrash', far[k])!.H, hazardCell(s, 'roadCrash', far[k])!.since]).toEqual([H0[k], -1]);
      expect(tr.closeEv[A.id]).toBe(-1);
      for (const e of ring) if (tr.exQueue[e.id] > 0) expect(tr.qEv[e.id], '밀림의 꼬리는 그 통제의 것').toBe(ev);
      expect([lawInc(s).length, s.world.hz.holes]).toEqual([0, 0]);
    });
  });

  it('⑧ 인파와 꺼진 신호가 겹친 길의 사고: 큰 몫(인파)이 원인이고 다른 몫(꺼진 신호)도 원인으로 이어진다 — 꺼진 신호가 먼저 끝나면 남은 몫은 인파뿐이다. 주인 사건이 없어 부모가 없다. 사고는 몰린 그 구간을 막는다', () => {
    const run1 = (darkEnds: boolean): void => {
      const s = quiet('S7'), tr = s.traffic, edges = s.city.edges;
      const fac = new Set(s.city.facilities.map((f) => f.nodeId));
      withA(0, () => {
        cycles(s, 15);
        const E = edges.find((e) => e.cls === 'street' && !e.closed && e.gateT === undefined && !fac.has(e.a) && !fac.has(e.b) && canBlock(s, e) && e.baseCong * tr.tod * s.tune.trafficMul < 1.3 && !tr.obstacles.some((o) => o.edge === e.id))!;
        const evC = note(s, '행사장 주변에 인파가 몰려 길이 밀립니다.'), evD = note(s, '정전 — 신호등이 꺼졌습니다.');
        addBump(s, [E.id], 0.8, evC, 0);
        const dark = addBump(s, [E.id], 0.3, evD, 1);
        cycles(s, 12);
        expect(partsOf(s, E.id).map((p) => p.what)).toEqual(['crowd', 'dark']);
        expect(lawInc(s).length, '세기가 0 이면 아무 일도 없다').toBe(0);
        if (darkEnds) { removeBump(s, dark); cycles(s, 12); expect(partsOf(s, E.id).map((p) => p.what)).toEqual(['crowd']); }
        ROAD.A = 1;      // 다음 주기에 반드시 넘는다
        const n0 = s.incidents.length;
        while (s.incidents.length === n0 && s.t < 80) s.step();
        ROAD.A = 0;
        const J = s.incidents[n0];
        expect(J, '문턱을 넘은 그 틱에 사건이 된다').toBeDefined();
        expect([J.csq, J.truth.type, J.hz!.law, J.hz!.target, J.hz!.at, J.createdAt]).toEqual(['roadCrash', 'traffic', 'roadCrash', E.id, s.t, s.t]);
        expect(['std', 'bus']).toContain(J.truth.variant);
        expect(J.truth.severity).toBe(J.truth.variant === 'bus' ? 3 : 1);      // 일반 도로 · 초과 1.2 아래 (버스가 끼면 3)
        expect(J.hz!.src.map((x) => [x.what, x.ev, x.inc, x.ref])).toEqual(darkEnds ? [['crowd', evC, -1, E.id]] : [['crowd', evC, -1, E.id], ['dark', evD, -1, E.id]]);
        if (!darkEnds) expect(J.hz!.src[0].w / J.hz!.src[1].w).toBeCloseTo(0.8 / 0.3, 6);      // 몫의 비 = 얹은 양의 비
        expect([J.cause, J.parent]).toEqual([evC, undefined]);
        expect(s.events[J.rootEvent].causes).toEqual(darkEnds ? [evC] : [evC, evD]);
        expect(s.events[J.rootEvent].text.startsWith('인파로 막힌 길에서 사고가 났습니다 — ')).toBe(true);
        expect(s.events[J.rootEvent].truth).toBe(true);
        expect([E.a, E.b]).toContain(J.truth.nodeId);
        expect([J.blockedEdge, E.slow, tr.slowEv[E.id], tr.slowInc[E.id]], '몰린 그 구간이 막힌다').toEqual([E.id, 1.4, J.rootEvent, J.id]);
        expect(s.world.log[s.world.log.length - 1]).toMatchObject({ rule: 'roadCrash', ev: evC, inc: -1, made: J.id, depth: 0 });
        expect(hazardCell(s, 'roadCrash', E.id)!.n).toBe(1);
        expect(s.world.hz.holes).toBe(0);
      });
    };
    run1(false); run1(true);
  });

  it('⑥ 양 끝 교차로에 열린 사건이 있으면 기다린다 — 초과가 끝나도 버려지지 않고, 하나가 닫히면 다음 1초 블록에 넘는 순간의 몫으로 난다. 마감 60초가 지나면 expired', () => {
    const setup = (): { s: Sim; E: number; evC: number; Ia: Incident; Ib: Incident; bump: number } => {
      const s = quiet('S7'), tr = s.traffic, edges = s.city.edges, places = s.city.places;
      const fac = new Set(s.city.facilities.map((f) => f.nodeId));
      const home = (node: number): number => { const p = places.find((q) => q.nodeId === node && q.facility < 0 && (q.kind === 'houseS' || q.kind === 'houseL' || q.kind === 'villa' || q.kind === 'apartment')); return p ? p.id : -1; };
      ROAD.A = 0;
      cycles(s, 15);
      const E = edges.find((e) => e.cls === 'street' && !e.closed && e.gateT === undefined && !fac.has(e.a) && !fac.has(e.b) && canBlock(s, e) && e.baseCong * tr.tod * s.tune.trafficMul < 1.3 && !tr.obstacles.some((o) => o.edge === e.id) && home(e.a) >= 0 && home(e.b) >= 0)!;
      // 양 끝 교차로의 집에 사건을 하나씩 (신고가 들어오지 않게 얼려 둔다 — 열린 채 남는다)
      const Ia = createIncident(s, { type: 'medical', variant: 'faint', placeId: home(E.a), rng: s.rng.fork('ta') });
      const Ib = createIncident(s, { type: 'medical', variant: 'faint', placeId: home(E.b), rng: s.rng.fork('tb') });
      Ia.firstCallAt = Ib.firstCallAt = Infinity;
      expect([Ia.truth.nodeId, Ib.truth.nodeId]).toEqual([E.a, E.b]);
      const evC = note(s, '행사장 주변에 인파가 몰려 길이 밀립니다.');
      const bump = addBump(s, [E.id], 0.8, evC, 0);
      ROAD.A = 1;
      while (!s.world.hz.waiting.length && s.t < 60) s.step();      // 다음 주기에 넘는다 — 양 끝이 모두 바빠 자리가 없다
      ROAD.A = 0;
      return { s, E: E.id, evC, Ia, Ib, bump };
    };
    withA(0, () => {
      {
        const { s, E, evC, Ia, bump } = setup();
        expect(s.world.hz.waiting.map((w) => [w.law, w.target, w.n, w.until - s.t, w.parts.map((p) => [p.what, p.ev])])).toEqual([['roadCrash', E, 0, HZ.HOLD, [['crowd', evC]]]]);
        expect([lawInc(s).length, hazardCell(s, 'roadCrash', E)!.n, ruleLoad(s, 'roadCrash')]).toEqual([0, 1, 1]);
        // 초과가 끝난다(인파가 흩어졌다) — 기다리는 줄은 그대로다
        removeBump(s, bump);
        cycles(s, 24);
        expect([s.traffic.excess[E], s.world.hz.waiting.length, lawInc(s).length]).toEqual([0, 1, 0]);
        // 한쪽 교차로의 사건이 닫힌다 → 다음 1초 블록에 그 교차로에서 난다
        closeIncident(s, Ia, 'resolved');
        const t0 = s.t, n0 = s.incidents.length;
        while (s.incidents.length === n0 && s.t < t0 + 3) s.step();
        const J = s.incidents[n0];
        expect(J).toBeDefined();
        expect(s.t - t0).toBeLessThanOrEqual(1.001);
        expect([J.csq, J.truth.nodeId, J.hz!.target, J.hz!.at, J.cause, s.world.hz.waiting.length]).toEqual(['roadCrash', s.city.edges[E].a, E, s.t, evC, 0]);
        expect(J.hz!.src.map((x) => [x.what, x.ev])).toEqual([['crowd', evC]]);
        expect(s.gen.dropped.length).toBe(0);
      }
      {
        const { s, E } = setup();
        const t0 = s.t;
        while (s.world.hz.waiting.length && s.t < t0 + 70) s.step();
        expect(s.t - t0).toBeGreaterThanOrEqual(HZ.HOLD - 0.01); expect(s.t - t0).toBeLessThan(HZ.HOLD + 1.2);
        expect(s.gen.dropped.map((d) => [d.why, d.csq])).toEqual([['expired', 'roadCrash']]);
        expect([lawInc(s).length, ruleLoad(s, 'roadCrash'), hazardCell(s, 'roadCrash', E)!.n]).toEqual([0, 0, 1]);
        expect(s.events.some((x) => x.kind === 'incident' && /인파로 막힌 길/.test(x.text)), '일어나지 않은 일은 기록하지 않는다').toBe(false);
      }
    });
  });

  it('⑦-가 법칙이 고른 구간을 다른 열린 사건이 잡고 있으면 그 구간을 잡지 않는다 — 대신 고른 구간도 남이 잡지 않았고 막아도 도시가 끊기지 않는다', () => {
    withA(0, () => {
      const s = quiet('S7'), tr = s.traffic, edges = s.city.edges;
      const fac = new Set(s.city.facilities.map((f) => f.nodeId));
      cycles(s, 15);
      // 평소의 사고 하나: 그 사고가 잡은 구간(감속 중)이 E 다
      const nd = s.city.nodes.find((q) => !fac.has(q.id) && q.edges.length >= 3 && q.edges.every((k) => { const e = edges[k], o = e.a === q.id ? e.b : e.a; return !fac.has(o) && s.city.nodes[o].edges.length >= 3 && e.cls !== 'highway'; }))!;
      const P = createIncident(s, { type: 'traffic', variant: 'std', severity: 1, nodeId: nd.id, rng: s.rng.fork('tp') });
      P.firstCallAt = Infinity;
      const E = edges[P.blockedEdge], other = E.a === nd.id ? E.b : E.a;
      expect([E.slow, tr.slowInc[E.id]]).toEqual([1.4, P.id]);
      const evC = note(s, '행사장 주변에 인파가 몰려 길이 밀립니다.');
      addBump(s, [E.id], 0.8, evC, 0);
      ROAD.A = 1;
      const n0 = s.incidents.length;
      while (s.incidents.length === n0 && s.t < 60) s.step();
      ROAD.A = 0;
      const J = s.incidents.find((q) => q.hz !== undefined && q.hz.target === E.id)!;
      expect(J).toBeDefined();
      expect(J.truth.nodeId, '사건이 열려 있는 끝은 피한다').toBe(other);
      expect(J.blockedEdge).not.toBe(E.id);
      expect(E.slow, '남이 잡은 구간에 감속을 한 번 더 걸지 않는다').toBe(1.4);
      if (J.blockedEdge >= 0) {
        const b = edges[J.blockedEdge];
        expect(b.a === other || b.b === other).toBe(true);
        expect(s.incidents.some((q) => q !== J && q.phase !== 'closed' && q.blockedEdge === b.id)).toBe(false);
        expect(canBlock(s, b)).toBe(true);
      }
    });
  });

  it('⑦·⑤ 나무 → 사고 → 사고: 사슬은 세 건에서 끊긴다(depth — H 가 문턱만큼 줄고 n 이 는다. 기록은 없다) — 통제가 걸릴 때마다 모든 교차로에 큰 차가 닿는다', () => {
    withA(3e-4, () => {
      const { s, I } = treeShift('S7', 150), edges = s.city.edges, F0 = s.city.facilities[0].nodeId;
      const sigOf = (): string => { let g = ''; for (const e of edges) if (e.closed) g += e.id + ','; return g; };
      const everyNode = (): boolean => s.city.nodes.every((nd) => reallyLinked(s, F0, nd.id, -1, true));
      let sig = sigOf(), stable = false, changes = 0, checks = 0, drops = 0;
      const sigs = new Set<string>([sig]);
      let snap = new Map<number, { n: number; H: number; thr: number }>();
      const shoot = (): void => { snap = new Map(); for (const [k, c] of Object.entries(s.world.hz.cells.roadCrash ?? {})) snap.set(+k, { n: c.n, H: c.H, thr: c.thr }); };
      shoot();
      const t0 = s.t;
      while (s.t < t0 + 400 && !s.ended) {
        const nInc = s.incidents.length, nDrop = s.gen.dropped.length, roadAt = s.world.hz.roadAt;
        s.step();
        // 법칙이 낸 사고가 잡은 구간은 다른 열린 사건의 구간이 아니다
        for (let k = nInc; k < s.incidents.length; k++) { const J = s.incidents[k]; if (J.hz && J.blockedEdge >= 0) expect(s.incidents.some((q) => q !== J && q.phase !== 'closed' && q.blockedEdge === J.blockedEdge)).toBe(false); }
        // 상한에 걸려 버린 넘음: 그 구간의 칸은 사건이 난 것과 같게 넘어간다 (H −= thr, n++)
        if (s.world.hz.roadAt !== roadAt) {
          if (s.gen.dropped.length > nDrop) {
            for (const [k, c] of Object.entries(s.world.hz.cells.roadCrash!)) {
              const id = +k, was = snap.get(id);
              if (!was || c.n !== was.n + 1 || s.gen.chain.some((q) => q.opts.hz?.target === id) || s.incidents.slice(nInc).some((J) => J.hz?.target === id)) continue;
              const dH = ROAD.A * s.traffic.excess[id] * weightOf(s, id) * 12;
              expect(c.H, `e${id}`).toBeCloseTo(was.H + dH - was.thr, 8);
              drops++;
            }
          }
          shoot();
        }
        const g = sigOf();
        if (g !== sig) { sig = g; sigs.add(g); changes++; stable = false; continue; }
        // 통제가 바뀐 다음의 1초 블록부터(하나 남은 길을 막게 된 장애물은 교통 모델이 1초 안에 치운다) 그리고 5초마다
        if (!stable || s.tick % 25 === 0) { if (!stable && s.tick % 5 !== 1) continue; checks++; expect(everyNode(), `t=${s.t} 닫힌 구간 ${g}`).toBe(true); stable = true; }
      }
      const law = lawInc(s);
      const J1 = law.find((J) => J.parent === I.id)!, J2 = law.find((J) => J1 && J.parent === J1.id)!;
      expect(J1, '나무의 통제로 몰린 길의 사고').toBeDefined();
      expect(J2, '그 사고로 밀린 길의 사고').toBeDefined();
      expect([J1.cause, J1.hz!.src[0].what]).toEqual([I.blockEv, 'divert']);
      expect(s.events[J2.rootEvent].causes.some((ev) => s.events[ev].incidentId === J1.id), '둘째 사고의 원인은 첫 사고가 남긴 기록(감속·통제)').toBe(true);
      expect([chainedInShift(s) <= CHAIN_SHIFT_MAX, law.length <= 3]).toEqual([true, true]);
      // 셋째는 없다: 깊이 2 의 사건(J2)이 주인인 초과는 depth 로, 같은 나무에서 난 셋째 가지도 depth 로 버려진다
      const dr = s.gen.dropped.filter((d) => d.csq === 'roadCrash');
      expect(dr.some((d) => d.why === 'depth' && d.parent === J2.id)).toBe(true);
      expect(dr.every((d) => d.why === 'depth' || d.why === 'cap')).toBe(true);
      expect(law.every((J) => J.parent === undefined || J.parent === I.id || J.parent === J1.id)).toBe(true);
      expect(drops).toBeGreaterThan(0);
      expect(s.events.filter((x) => x.kind === 'incident' && s.incidents[x.incidentId]?.hz).length, '버린 일은 기록에 없다').toBe(law.length);
      expect(changes).toBeGreaterThanOrEqual(3);      // 나무가 치워짐 · 첫 사고의 전면 통제 · 둘째 사고의 전면 통제 …
      expect(sigs.size).toBeGreaterThanOrEqual(3);
      expect(checks).toBeGreaterThan(50);
      expect(s.world.hz.holes).toBe(0);
    });
  }, 60000);

  it('③ 개입 시험 — 쓰러진 나무(사용자의 예 ①): 같은 시드에서 나무가 길에 만든 상태(통제와 감속)만 되돌리면 그 원인의 사고가 없다 — 장부는 손대지 않는다. 장부만 지운 대조에서는 위험은 그대로이고 구멍이 는다', () => {
    withA(7.5e-5, () => {
      const A = treeShift('S7', 150), B = treeShift('S7', 150), C = treeShift('S7', 150);
      expect([B.s.logHash, C.s.logHash, B.I.id, B.c, C.c]).toEqual([A.s.logHash, A.s.logHash, A.I.id, A.c, A.c]);      // 여기까지 같은 교대, 같은 사건 번호, 같은 구간
      const c = A.c, blockEv = A.I.blockEv!;
      expect(A.s.events[blockEv].text).toContain('쓰러진 나무가 길을 막았습니다');
      // B: 나무가 길에 만든 상태를 모두 되돌린다 (사건·현장·사건 번호는 그대로. 장부는 다음 주기가 상태를 보고 스스로 비운다)
      { const e = B.s.city.edges[c]; e.closed = false; e.closedReason = null; e.slow = Math.max(0, e.slow - 1.4); B.I.blockedEdge = -1; }
      expect([B.s.traffic.closeEv[c], B.s.traffic.slowEv[c]]).toEqual([blockEv, B.I.rootEvent]);
      // C(대조): 상태는 두고 장부만 지운다 — 원인 꼬리표를 지우는 것으로는 위험이 사라지지 않는다
      noteRoadCause(C.s, c, 'close', -1); noteRoadCause(C.s, c, 'slow', -1);
      const touched = new Set<number>();      // A 에서 그 통제가 올리던 구간 (우회로·밀린 이웃)
      let samples = 0, firstA = -1;
      const t0 = A.s.t;
      while (A.s.t < t0 + 400) {
        const was = A.s.world.hz.roadAt;
        A.s.step(); B.s.step(); C.s.step();
        if (firstA < 0 && lawInc(A.s).length) firstA = A.s.t;
        if (A.s.world.hz.roadAt === was || firstA >= 0) continue;
        // A 의 첫 법칙 사건 전까지의 표본: 그 통제가 올리던 구간에서 B 의 위험은 A 를 넘지 않는다
        const tr = A.s.traffic;
        for (const e of A.s.city.edges) if (tr.divertBy[e.id] === c || tr.qBy[e.id] === c) touched.add(e.id);
        samples++;
        for (const id of touched) {
          expect(cum(B.s, id), `t=${A.s.t} e${id}`).toBeLessThanOrEqual(cum(A.s, id) + 1e-12);
          if (C.s.world.hz.holes === 0) expect(cum(C.s, id), `대조 e${id}`).toBeCloseTo(cum(A.s, id), 12);
        }
        if (samples === 1) { expect([B.s.traffic.closeEv[c], B.s.traffic.slowEv[c]], '장부는 스스로 비워진다').toEqual([-1, -1]); for (const e of B.s.city.edges) expect([B.s.traffic.divertBy[e.id] === c, B.s.traffic.qBy[e.id] === c]).toEqual([false, false]); }
      }
      expect(samples).toBeGreaterThanOrEqual(3);
      expect(touched.size).toBeGreaterThanOrEqual(5);
      expect([...touched].some((id) => cum(A.s, id) > cum(B.s, id) + 1e-6)).toBe(true);
      // ① A: 그 통제로 몰린 길의 사고 — 원인은 통제 기록, 부모는 나무 사건
      const ofTree = (J: Incident): boolean => J.hz !== undefined && J.hz.src.some((x) => x.ref === c && (x.what === 'divert' || x.what === 'queue'));
      const JA = lawInc(A.s).filter(ofTree);
      expect(JA.length).toBeGreaterThanOrEqual(1);
      const J = JA[0];
      expect([J.csq, J.cause, J.parent, J.truth.type]).toEqual(['roadCrash', blockEv, A.I.id, 'traffic']);
      expect(A.s.events[J.rootEvent].causes[0]).toBe(blockEv);
      expect(A.s.events[J.rootEvent].text).toMatch(/^(막힌 길을 피해 몰린 차들 사이에서 사고가 났습니다|길게 밀린 차들의 꼬리에서 추돌 사고가 났습니다) — /);
      expect(J.hz!.at).toBe(J.createdAt);
      for (const x of J.hz!.src) { expect(x.since).toBeGreaterThanOrEqual(A.s.events[blockEv].t); expect(x.since).toBeLessThanOrEqual(J.hz!.at); }
      expect(touched.has(J.hz!.target)).toBe(true);
      expect([J.truth.nodeId === A.s.city.edges[J.hz!.target].a || J.truth.nodeId === A.s.city.edges[J.hz!.target].b, J.blockedEdge]).toEqual([true, J.hz!.target]);
      // ② B: 어느 사건의 내력에도 그 구간이나 그 통제 기록이 없다
      for (const Q of B.s.incidents) { if (!Q.hz) continue; expect(Q.hz.src.some((x) => x.ref === c || x.ev === blockEv), `B #${Q.code}`).toBe(false); expect(Q.cause).not.toBe(blockEv); }
      expect(lawInc(B.s).filter((Q) => Q.parent === B.I.id).length).toBe(0);
      // ⑤ 두 쪽 모두 장부의 구멍이 없다
      expect([A.s.world.hz.holes, B.s.world.hz.holes]).toEqual([0, 0]);
      // ⑥ 대조: 위험은 그대로라 같은 구간에서 문턱을 넘지만, 원인 기록이 없어 사건은 나지 않고 구멍만 는다
      expect(C.s.world.hz.holes).toBeGreaterThanOrEqual(1);
      expect(C.s.incidents.some((Q) => Q.cause === blockEv || (Q.hz !== undefined && Q.hz.src.some((x) => x.ev === blockEv)))).toBe(false);
      expect(hazardCell(C.s, 'roadCrash', J.hz!.target)!.n).toBeGreaterThanOrEqual(1);
    });
  }, 60000);

  it('소스 글자: 법칙의 scan 은 교통 모델의 배열만 읽는다 — 사건·현장·장애물 목록·닫힌 까닭을 보지 않는다. 사고 구간을 정하는 조건(createIncident)은 다른 사건이 잡은 구간과 canBlock 을 본다', () => {
    const src = readFileSync('src/sim/world/laws/road.ts', 'utf8');
    const at = src.indexOf('scan:');
    let depth = 0, end = -1;
    for (let i = src.indexOf('{', at); i < src.length; i++) { if (src[i] === '{') depth++; else if (src[i] === '}' && --depth === 0) { end = i; break; } }
    const body = src.slice(at, end + 1);
    expect(body.length).toBeGreaterThan(100);
    for (const w of ['incidents', 'scenes', 'closedReason', 'obstacles', 'jams', 'crowds', 'placeMarks', '.slow', '.closed', 'gen.']) expect(body.includes(w), `scan 에 ${w}`).toBe(false);
    for (const w of ['tr.excess', 'roadParts(', 'roadFlow(']) expect(body.includes(w), w).toBe(true);
    expect(src.includes("'pileup'"), '다중 추돌은 내지 않는다').toBe(false);
    const inc = readFileSync('src/sim/incidents.ts', 'utf8');
    expect(inc).toContain('canBlock(sim, pre)');
    expect(/opts\.edgeId/.test(inc)).toBe(true);
  });
});

// ───────────────────────── b3-7: 건물의 노출과 L2 heatSpread (§3.6c · §3.7 L2 — 시험 ①~⑦) ─────────────────────────
describe('I1-b b3-7: L2 heatSpread — 오래 크게 타는 불 곁의 건물은 불이 붙는다', () => {
  const LAW = hazardLaws().find((l) => l.id === 'heatSpread')!;
  const withK = <R>(mul: number, fn: () => R): R => { const k0 = HEAT.K; HEAT.K = k0 * mul; try { return fn(); } finally { HEAT.K = k0; } };
  const firePlace = (q: Place): boolean => !q.open && q.facility < 0 && (INCIDENT_PLACES.fire[q.kind] ?? 0) > 0;
  /** 그 현장의 불 요약을 F 로 맞춘다 (그 건물 안 — 실내 구역 — 의 불 칸을 손으로 채우고 tickFire 를 한 번. 그 뒤 현장은 돌지 않는다: 시험은 tickHazards 만 부른다) */
  const indoorAt = (sc: Sim['scenes'][number], i: number): boolean => sc!.region[i] >= 0 && sc!.regions[sc!.region[i]].indoor;
  function setFire(s: Sim, I: Incident, F: number): void {
    const sc = s.scenes[I.id]!;
    sc.fire.fill(0); sc.heat.fill(0);
    let n = 0;
    for (let i = 0; i < sc.fire.length && n < F; i++) if (sc.fuel[i] > 0.2 && indoorAt(sc, i)) { sc.fire[i] = 1; n++; }
    tickFire(s, sc, I);
    expect(fireLoad(sc)).toBe(n);
    expect(n).toBe(F);
  }
  /** 그 건물에 화재를 일으키고 불 요약을 F 로 */
  function fireAt(s: Sim, placeId: number, F: number): Incident {
    const I = createIncident(s, { type: 'fire', variant: 'std', placeId });
    setFire(s, I, F);
    return I;
  }
  /** 1초씩 시각을 옮기며 초과 위험의 주기 → 예약을 사건으로 (현장·부대는 돌지 않는다) */
  function go(s: Sim, sec: number): void { for (let k = 0; k < sec; k++) { s.tick += 5; s.t = s.tick * s.dt; tickHazards(s); tickIncidents(s); } }
  /** 불 요약 F 에서 문턱을 넘는(rate > 0) 대상 건물이 n 채 이상 있는 화재 장소 (가까운 순) */
  function source(s: Sim, n: number, F: number): { id: number; nbs: { id: number; gap: number }[] } {
    for (const q of s.city.places) {
      if (!firePlace(q)) continue;
      const nbs = neighborsOf(s, q.id).filter((nb) => firePlace(s.city.places[nb.id]) && heatRate(F, nb.gap, heatMul(s.city.places[nb.id].kind)) > 0);
      if (nbs.length >= n) return { id: q.id, nbs: [...nbs] };
    }
    throw new Error('장소 없음');
  }
  const heatInc = (s: Sim): Incident[] => s.incidents.filter((I) => I.csq === 'heatSpread');

  it('등록: 법칙 모음의 둘째 줄이 heatSpread 다 — 1초 주기 · 건물마다 한 번 · 교대 상한 3. 세기는 첫 값에서 노출량으로 맞춘 것이다', () => {
    expect(hazardLaws().map((l) => l.id).slice(0, 2)).toEqual(['roadCrash', 'heatSpread']);
    expect([LAW.every, LAW.once, LAW.cap, LAW.label, LAW.scan !== undefined]).toEqual([1, true, 3, '옮겨붙은 불', true]);
    expect(readFileSync('src/sim/world/laws/index.ts', 'utf8')).toMatch(/^import '\.\/road';[^\n]*\nimport '\.\/heat';/m);
    expect(HEAT.K).toBeGreaterThan(5e-5); expect(HEAT.K).toBeLessThan(3e-4);
    expect([HEAT.Q0, HEAT.F_MIN, HEAT.NB_MAX, HEAT.F_BIG, FIRE_LOAD_MIN]).toEqual([3, 10, 8, 40, 0.5]);
    // 유속 q = F / (1 + g/6)² · 문턱을 넘는 몫만 — 벽을 맞댄 집(틈 3)이 F = 30 곁: q = 13.33 → 몫 10.33
    expect(heatRate(30, 3, 1)).toBeCloseTo(30 / 1.5 ** 2 - 3, 9);
    expect(heatRate(30, 3, 1.3)).toBeCloseTo(1.3 * (30 / 1.5 ** 2 - 3), 9);
    expect([heatMul('market'), heatMul('houseS'), heatMul('factory'), heatMul('apartment')]).toEqual([1.3, 1, 1, 0.6]);
    const hs = readFileSync('scripts/hazstats.ts', 'utf8');
    expect(hs).toContain("from '../src/sim/world/laws/heat'");
    expect(hs).toContain('heatTargets(');
  });

  it('② 이웃과 거리: 벽-벽 틈이 손 계산과 맞고(돌려 놓인 건물에서도) 이웃 목록은 틈 30 안의 건물만 가까운 순으로 — 터·출동 시설·자기 자신은 없고, 두 건물에서 본 틈이 같다. 노출 칸의 배관 문턱은 sim.world 안에', () => {
    const box = (x: number, y: number, w: number, h: number, rot?: number): Place => ({ x, y, w, h, rot } as unknown as Place);
    const A = box(0, 0, 10, 10);
    expect(wallGap(A, box(13, 0, 10, 10))).toBeCloseTo(3, 9);                                  // 옆으로 3
    expect(wallGap(A, box(13, 14, 10, 10))).toBeCloseTo(5, 9);                                 // 모서리끼리 (3, 4)
    expect(wallGap(A, box(20, -8, 20, 4, Math.PI / 2))).toBeCloseTo(18, 9);                    // 90° 돌린 긴 상자: 가운데 (30, −6) → x 28..32
    expect(wallGap(A, box(20, 0, 10, 10, Math.PI / 4))).toBeCloseTo(25 - 5 * Math.SQRT2 - 10, 9);      // 45° 돌린 정사각형의 왼쪽 꼭짓점 x = 25 − 5√2
    expect(pointGap(A, 5, 5)).toBe(0);
    expect(pointGap(A, 13, 14)).toBeCloseTo(5, 9);
    const s = quiet();
    let checked = 0;
    for (const q of s.city.places.slice(0, 400)) {
      if (q.open || q.facility >= 0) continue;
      const nbs = neighborsOf(s, q.id);
      expect(neighborsOf(s, q.id)).toBe(nbs);      // 처음 한 번 만들어 둔다
      for (let k = 0; k < nbs.length; k++) {
        const nb = nbs[k], r = s.city.places[nb.id];
        expect(nb.id).not.toBe(q.id);
        expect([r.open, r.facility >= 0]).toEqual([false, false]);
        expect(nb.gap).toBeLessThanOrEqual(NB_REACH);
        if (k > 0) expect(nb.gap).toBeGreaterThanOrEqual(nbs[k - 1].gap);
        expect(nb.gap).toBeCloseTo(wallGap(q, r), 9);
        expect(neighborsOf(s, nb.id).find((x) => x.id === q.id)?.gap).toBeCloseTo(nb.gap, 9);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(300);
    // 길 위의 점: 그 점에서 벽까지
    const nd = s.city.nodes[10], pts = neighborsOfPoint(s, nd.x, nd.y);
    for (const nb of pts) expect(nb.gap).toBeCloseTo(pointGap(s.city.places[nb.id], nd.x, nd.y), 9);
    // 노출 칸: 배관의 문턱은 만들 때 한 번 (흐름 hz:pipe:<건물> — sim.world 안에만). placeState 는 노출만 있어도 돌려준다
    const p = pts.length ? pts[0].id : 0;
    expect(s.world.expo[p]).toBeUndefined();
    expect(placeState(s, p)).toBe(null);
    const ex = expoOf(s, p);
    expect(ex).toEqual({ shake: 0, shakeEv: -1, shakeInc: -1, pipe: false, pipeEv: -1, pipeThr: 0.2 + 0.6 * s.rng.fork('hz:pipe:' + p).next(), wet: false, wetEv: -1, dark: -1 });
    expect(expoOf(s, p)).toBe(ex);
    expect(placeState(s, p)).toEqual({ mark: null, burnFrac: 0, ruinFrac: 0, usable: true, shake: 0, pipe: false, wet: false });
    const s2 = new Sim('S8', NORMAL, 1200);
    expect(s2.world.expo[p]).toBeUndefined();
    expect(expoOf(s2, p).pipeThr).toBe(0.2 + 0.6 * s2.rng.fork('hz:pipe:' + p).next());
  });

  it('① 큰 불이 없으면 칸이 없다: 불이 없는 교대·불 요약 10 아래의 화재에는 칸도 사건도 없다 — 불 요약은 그 건물 안의 불 0.5 이상 칸만 센다', () => {
    const s = quiet();
    withLaws([LAW], () => {
      go(s, 60);
      expect(s.world.hz.cells.heatSpread).toBeUndefined();
      const src = source(s, 1, 59);
      const I = fireAt(s, src.id, HEAT.F_MIN - 1);
      go(s, 60);
      expect(s.world.hz.cells.heatSpread).toBeUndefined();
      // 불 0.2~0.5 칸은 불 요약에 들지 않는다
      const sc = s.scenes[I.id]!;
      sc.fire.fill(0);
      let n = 0;
      for (let i = 0; i < sc.fire.length && n < 30; i++) if (sc.fuel[i] > 0.2) { sc.fire[i] = 0.4; n++; }
      tickFire(s, sc, I);
      expect(fireLoad(sc)).toBe(0);
      // 건물 밖(실내 구역이 아닌 칸 — 마당·숲)에서 타는 불은 그 건물의 불 요약에 들지 않는다 (그 번짐은 산불 모델의 것이다)
      sc.fire.fill(0); n = 0;
      for (let i = 0; i < sc.fire.length && n < 30; i++) if (!indoorAt(sc, i)) { sc.fire[i] = 1; n++; }
      expect(n).toBe(30);
      tickFire(s, sc, I);
      expect(fireLoad(sc)).toBe(0);
      go(s, 30);
      expect([s.world.hz.cells.heatSpread, heatInc(s).length, s.world.hz.holes]).toEqual([undefined, 0, 0]);
    });
  });

  it('③ 개입 시험: 같은 시드에 같은 화재를 일으키고 한쪽만 그 현장의 불을 0 으로 — 그쪽은 이웃의 칸도 옮겨붙은 불도 없다. 다른 쪽의 불은 부모·원인·내력이 그 화재이고 그 건물에 난다', () => {
    const src = source(quiet(), 1, 40);
    const runOne = (burn: boolean): Sim => {
      const s = quiet();
      withLaws([LAW], () => withK(40, () => {
        const I = fireAt(s, src.id, burn ? 40 : 0);
        expect(I.id).toBe(0);
        go(s, 90);
      }));
      return s;
    };
    const A = runOne(true), B = runOne(false);
    // B: 이웃 어디에도 칸이 없고 옮겨붙은 불이 없다
    expect(B.world.hz.cells.heatSpread).toBeUndefined();
    expect(heatInc(B)).toEqual([]);
    // A: 가장 가까운 이웃에 칸이 있고, 옮겨붙은 불의 부모·원인·내력이 그 화재다
    expect(hazardCell(A, 'heatSpread', src.nbs[0].id)).not.toBe(null);
    const J = heatInc(A);
    expect(J.length).toBeGreaterThanOrEqual(1);
    const P = A.incidents[0];
    for (const K of J) {
      expect([K.parent, K.cause, K.truth.type, K.truth.variant, K.truth.placeId]).toEqual([P.id, P.rootEvent, 'fire', 'std', K.hz!.target]);
      expect(K.hz!.src.every((x) => x.what === 'heat' && x.inc === P.id && x.ref === src.id && x.ev === P.rootEvent)).toBe(true);
      expect(src.nbs.some((nb) => nb.id === K.truth.placeId)).toBe(true);
      const ev = A.events[K.rootEvent];
      expect(ev.text.startsWith('옆 건물의 불이 옮겨붙었습니다 — ')).toBe(true);
      expect(ev.causes).toContain(P.rootEvent);
      expect(K.truth.severity).toBe(2);      // 넘는 순간의 불 요약 40 ≥ F_BIG
    }
    expect(A.world.hz.holes).toBe(0);
  });

  it('④ 길 건너의 건물은 쌓이지 않는다: F = 59(조사의 가장 큰 불)에서 문턱 유속을 넘는 틈은 6(√(59/3) − 1) ≈ 20.6 까지다 — 그 밖의 이웃에는 칸이 없다', () => {
    const gmax = 6 * (Math.sqrt(59 / 3) - 1);
    expect(gmax).toBeCloseTo(20.61, 2);
    expect(heatRate(59, 21, 1.3)).toBe(0);
    expect(heatRate(59, 25, 1)).toBe(0);
    expect(heatRate(59, 20, 1)).toBeGreaterThan(0);
    expect(heatRate(30, 13.5, 1)).toBe(0);      // F = 30 이면 틈 13 남짓까지
    const s = quiet();
    // 이웃 가운데 가까운 화재 장소와 틈 21 넘는 화재 장소가 함께 있는 곳
    let pick = -1;
    for (const q of s.city.places) {
      if (!firePlace(q)) continue;
      const nbs = neighborsOf(s, q.id);
      if (nbs.some((nb) => nb.gap < 8 && firePlace(s.city.places[nb.id])) && nbs.some((nb) => nb.gap > 21 && firePlace(s.city.places[nb.id]))) { pick = q.id; break; }
    }
    expect(pick).toBeGreaterThanOrEqual(0);
    withLaws([LAW], () => withK(0.001, () => {      // 세기를 낮춰 아무도 넘지 않게 — 칸이 생기는가만 본다
      fireAt(s, pick, 59);
      go(s, 30);
    }));
    let near = 0;
    for (const nb of neighborsOf(s, pick)) {
      if (!firePlace(s.city.places[nb.id])) continue;
      const c = hazardCell(s, 'heatSpread', nb.id);
      if (nb.gap > gmax) expect(c, `틈 ${nb.gap.toFixed(1)}`).toBe(null);
      else if (near < HEAT.NB_MAX) { expect(c, `틈 ${nb.gap.toFixed(1)}`).not.toBe(null); expect(c!.H).toBeCloseTo(HEAT.K * 0.001 * heatRate(59, nb.gap, heatMul(s.city.places[nb.id].kind)) * 30, 12); near++; }
    }
    expect(near).toBeGreaterThan(0);
  });

  it('⑤ 대상이 아닌 건물: 전소·전체 붕괴 건물과 이번 교대에 이미 불이 난 건물은 내놓지 않는다 — 사건이 열려 있는 건물은 내놓고 틀이 기다리게 한다', () => {
    const s = quiet();
    const src = source(s, 4, 59);
    const [a, b, c, d] = src.nbs.map((nb) => nb.id);
    const seen = (): number[] => { const out: number[] = []; heatTargets(s, (t) => out.push(t)); return out; };
    const I = fireAt(s, src.id, 59);
    expect(seen()).toEqual(expect.arrayContaining([a, b, c, d]));
    expect(seen()).not.toContain(src.id);      // 불난 그 건물은 자기 이웃이 아니다
    s.placeMarks.set(a, { placeId: a, state: 'burnt', t: 0, incidentId: -1, burnFrac: 1, ruinFrac: 0 });
    s.placeMarks.set(b, { placeId: b, state: 'collapsed', t: 0, incidentId: -1, burnFrac: 0, ruinFrac: 1 });
    expect(seen()).not.toContain(a); expect(seen()).not.toContain(b);
    // 이미 불이 난 건물(닫힌 화재가 있었다)은 탈 것이 탔다
    const C = createIncident(s, { type: 'fire', variant: 'std', placeId: c });
    C.phase = 'closed';
    expect(seen()).not.toContain(c);
    // 사건이 열려 있는 건물: 내놓되 틀이 기다리게 한다 (그 사건이 닫히면 난다)
    const M = createIncident(s, { type: 'medical', placeId: d });
    expect(seen()).toContain(d);
    withLaws([LAW], () => withK(1e4, () => {
      go(s, 2);
      expect(s.world.hz.waiting.some((w) => w.law === 'heatSpread' && w.target === d)).toBe(true);
      M.phase = 'closed';
      go(s, 2);
      expect(heatInc(s).some((K) => K.truth.placeId === d && K.parent === I.id)).toBe(true);
    }));
  });

  it('⑥ 한 뿌리의 가지: 이웃 넷이 모두 문턱을 넘어도 옮겨붙은 불은 둘이고 나머지는 depth — 옮겨붙은 불의 이웃(셋째 세대)도 depth. 버린 것은 기록이 없다', () => {
    const s = quiet();
    const src = source(s, 4, 59);
    withLaws([LAW], () => withK(1e4, () => {
      const I = fireAt(s, src.id, 59);
      const ev0 = s.events.length;
      go(s, 2);
      const kids = heatInc(s);
      expect(kids.length).toBe(HZ.ROOT_MAX);
      expect(kids.every((K) => K.parent === I.id)).toBe(true);
      const dropped = s.gen.dropped.filter((g) => g.csq === 'heatSpread');
      expect(dropped.length).toBeGreaterThanOrEqual(2);
      expect(dropped.every((g) => g.why === 'depth' && g.parent === I.id)).toBe(true);
      // 발생 기록은 사건이 된 둘의 것뿐이다 — 버린 넘음은 기록이 없다
      expect(s.events.slice(ev0).filter((e) => e.kind === 'incident').length).toBe(HZ.ROOT_MAX);
      // 셋째 세대: 옮겨붙은 불이 크게 타도 그 이웃은 한 뿌리의 가지 상한에 걸린다
      for (const K of kids) setFire(s, K, 59);
      const n0 = s.incidents.length, d0 = s.gen.dropped.length;
      go(s, 2);
      expect(s.incidents.length).toBe(n0);
      const more = s.gen.dropped.slice(d0);
      expect(more.length).toBeGreaterThanOrEqual(1);
      expect(more.every((g) => g.csq === 'heatSpread' && g.why === 'depth')).toBe(true);
      expect(s.world.hz.holes).toBe(0);
    }));
  });

  it('⑦ 원인 기록은 그 불을 만든 기록이다 — 상황 악화(ESCALATION)가 아니다: 붕괴 현장의 불은 발생 기록, X6 의 폭발·전소가 있으면 그 마지막 것. 큰 불 신호도 같은 규칙이다', () => {
    const s = quiet();
    const src = source(s, 1, 40);
    withLaws([LAW], () => withK(1e4, () => {
      const I = createIncident(s, { type: 'collapse', variant: 'std', placeId: src.id });
      const esc = raiseProblem(s, I, 'ESCALATION', '압궤 증후군', { role: 'SYSTEM', actor: '현장', text: '시험 — 상황 악화' }, false);
      expect(fireCauseEv(I)).toBe(I.rootEvent);
      const hid = raiseProblem(s, I, 'HIDDEN_HAZARD', '배회하던 실종자가 개울에 빠짐', { role: 'SYSTEM', actor: '현장', text: '시험 — X6 가 아닌 숨은 위험' }, false);
      expect(fireCauseEv(I)).toBe(I.rootEvent);
      setFire(s, I, 40);
      const big = s.world.signals.find((g) => g.kind === 'fireBig' && g.inc === I.id);
      expect(big?.ev).toBe(I.rootEvent);
      go(s, 2);
      const J = heatInc(s);
      expect(J.length).toBeGreaterThanOrEqual(1);
      for (const K of J) expect([K.parent, K.cause, K.cause === esc, K.cause === hid]).toEqual([I.id, I.rootEvent, false, false]);
      // X6 의 폭발이 있으면 그것 (지휘관이 몰랐던 폭발 — HIDDEN_HAZARD 의 X6 문구도), 전소가 뒤에 있으면 그것
      const boom = raiseProblem(s, I, 'HIDDEN_HAZARD', '보관 중이던 가스 용기 폭발', { role: 'SYSTEM', actor: '현장', text: '시험 — 용기 폭발' }, false);
      expect(fireCauseEv(I)).toBe(boom);
      const burn = raiseProblem(s, I, 'BURNOUT', '건물 전소 — 시험', { role: 'SYSTEM', actor: '현장', text: '시험 — 전소' }, false);
      expect(fireCauseEv(I)).toBe(burn);
      raiseProblem(s, I, 'ESCALATION', '2차 붕괴', { role: 'SYSTEM', actor: '현장', text: '시험 — 뒤의 상황 악화' }, false);
      expect(fireCauseEv(I)).toBe(burn);
    }));
  });

  it('관제가 아는 길: 알려진 큰 불(현장 확인 + 현장 보고가 올린 위험도)·폭발 곁의 화재 신고는 위험도 +0.3 · 이름표 연소 확대 — 진실 기록·멀리 떨어진 곳·위치를 모르는 사건·자기 자신은 치지 않는다', () => {
    const s = quiet();
    const src = source(s, 1, 40);
    const P = createIncident(s, { type: 'fire', variant: 'std', placeId: src.id });
    const Q = createIncident(s, { type: 'fire', variant: 'std', placeId: src.nbs[0].id });
    const node = Q.truth.nodeId;
    const near = (): ReturnType<typeof knownHazardNear> => knownHazardNear(s, node, 300, 180, Q.id);
    expect(near()).toEqual({ fire: false, blast: false, collapse: false });
    // 불: 위치를 알고 현장이 화재로 확인했고 현장 보고가 위험도를 올린 열린 사건
    P.locationKnown = true; P.fieldVerified = true; P.fieldType = 'fire';
    expect(near().fire).toBe(false);
    P.fieldRisk = { sev: 2.4, risks: ['건물 붕괴'] };
    expect(near().fire).toBe(true);
    expect(knownHazardNear(s, P.reportedNode, 300, 180, P.id).fire, '자기 자신은 치지 않는다').toBe(false);
    // 신고: 그 곁의 화재 — 위험도 +0.3, 이름표 연소 확대 (위치를 아는 신고만)
    Q.fieldType = 'fire';
    assess(s, Q, '시험');
    expect(Q.assessment!.label).toBe(undefined);      // 위치를 모르면 곁인지 모른다
    const base = Q.assessment!.severity;
    Q.locationKnown = true; Q.reportedNode = node;
    assess(s, Q, '시험');
    expect(Q.assessment!.label).toBe('연소 확대');
    expect(Q.assessment!.severity).toBeCloseTo(Math.min(3, base + SPREAD_SEV), 9);
    P.phase = 'closed';
    expect(near().fire, '닫힌 화재는 큰 불이 아니다').toBe(false);
    // 폭발: 진실이 아닌 EXPLOSION · X6 문구의 HIDDEN_HAZARD 기록이 180초 안 (진실 기록은 관제가 모른다)
    raiseProblem(s, P, 'EXPLOSION', '누출된 가스 폭발 — 시험', { role: 'SYSTEM', actor: '현장', text: '시험 — 폭발(진실)', truth: true }, false);
    expect(near().blast).toBe(false);
    raiseProblem(s, P, 'HIDDEN_HAZARD', '보관 중이던 가스 용기 폭발', { role: 'SYSTEM', actor: '현장', text: '시험 — 용기 폭발' }, false);
    expect(near().blast).toBe(true);
    s.t += 181;
    expect(near().blast, '180초가 지나면').toBe(false);
    raiseProblem(s, P, 'STRUCT_COLLAPSE', '건물 전체 붕괴 — 시험', { role: 'SYSTEM', actor: '현장', text: '시험 — 붕괴' }, false);
    expect(near()).toEqual({ fire: false, blast: false, collapse: true });
    // 멀리 떨어진 교차로(300 밖) · 위치를 모르는 사건은 치지 않는다
    const here = s.city.nodes[P.reportedNode];
    const far = s.city.nodes.find((n) => Math.hypot(n.x - here.x, n.y - here.y) > 320)!;
    expect(knownHazardNear(s, far.id, 300, 180, Q.id).collapse).toBe(false);
    P.locationKnown = false;
    expect(near().collapse).toBe(false);
    // 분석 AI 는 이 함수만 부른다 — 진실 위치·현장·불 요약을 읽지 않는다
    const an = readFileSync('src/sim/dispatch/analyst.ts', 'utf8');
    expect(an).toContain('knownHazardNear(sim, I.reportedNode');
    for (const w of ['fireLoad', 'heatTargets', 'neighborsOf', 'truth.x', 'truth.placeId', 'sim.scenes']) expect(an.includes(w), w).toBe(false);
  });

  it('실제 교대(강제 fire/std S1): 옮겨붙은 불은 그 건물(hz.target)에 나고, 부모는 열원 화재, 원인은 그 불을 만든 기록이며 내력은 모두 열이다 — 측정 도구의 열 노출량 줄', () => {
    const s = new Sim('S1', NORMAL, 1200, { force: 'fire/std' });
    const probe = new HazProbe(s);
    while (!s.ended && s.tick < 20000) { s.step(); probe.tick(); }
    const J = heatInc(s);
    expect(J.length).toBeGreaterThanOrEqual(1);
    for (const K of J) {
      const P = s.incidents[K.parent!];
      expect(K.truth.placeId).toBe(K.hz!.target);
      expect(P.truth.placeId >= 0 ? neighborsOf(s, P.truth.placeId).some((nb) => nb.id === K.truth.placeId) : true).toBe(true);
      expect(K.hz!.src.every((x) => x.what === 'heat' && x.ev >= 0)).toBe(true);
      const c = s.events[K.cause!];
      expect(c.incidentId).toBe(P.id);
      expect(c.kind === 'incident' || c.problem === 'EXPLOSION' || c.problem === 'BURNOUT' || c.problem === 'HIDDEN_HAZARD').toBe(true);
      expect(c.t).toBeLessThanOrEqual(K.hz!.at);
    }
    expect(s.world.hz.holes).toBe(0);
    const cnt = probe.done();
    expect(cnt.heat).not.toBe(null);
    expect(cnt.heat!.sources).toBeGreaterThanOrEqual(1);
    expect(cnt.heat!.exposure).toBeGreaterThan(0);
    const lines = hazLines(sumHaz([cnt]));
    expect(lines.some((l) => l.startsWith('hazard-heat: exposure'))).toBe(true);
    expect(lines[0]).toContain('heatSpread');
  }, 60000);
});

// ───────────────────────── b3-8 a·b: L3 충격 — 붕괴와 폭발은 옆 건물을 흔든다 (상태·판단만 — 법칙 structFail·pipeLeak 은 b3-8c) ─────────────────────────
describe('I1-b b3-8 a·b: L3 충격 — 붕괴와 폭발은 옆 건물을 흔든다 (금·배관 손상 · 손상된 건물의 다음 현장)', () => {
  const bld = (q: Place): boolean => !q.open && q.facility < 0;
  const label = (q: Place): string => `${q.addr} ${q.name}`;
  /** 가장 가까운 이웃의 틈이 maxGap 이하이고 이웃이 n 채 이상인 건물 (화재 현장의 틀이 있는 종류) */
  function srcPlace(s: Sim, maxGap: number, n = 2): Place {
    for (const q of s.city.places) {
      if (!bld(q) || !((INCIDENT_PLACES.fire[q.kind] ?? 0) > 0)) continue;
      const nbs = neighborsOf(s, q.id);
      if (nbs.length >= n && nbs[0].gap <= maxGap) return q;
    }
    throw new Error('장소 없음');
  }
  /** 그 건물의 화재 하나와 그 사건의 기록 하나 (신호의 기록 — 폭발·붕괴 기록 자리) */
  function fireWith(s: Sim, placeId: number, code: 'EXPLOSION' | 'STRUCT_COLLAPSE' = 'EXPLOSION'): { I: Incident; ev: number } {
    const I = createIncident(s, { type: 'fire', variant: 'std', placeId, rng: s.rng.fork('t-shock') });
    const ev = raiseProblem(s, I, code, '시험', { role: 'SYSTEM', actor: '시험', text: code === 'EXPLOSION' ? '폭발! (시험)' : '굉음! (시험)' }, false);
    return { I, ev };
  }
  const structRecs = (s: Sim) => s.events.filter((e) => e.tag === 'struct');
  /** 대기 지점에서 걸어서 닿지 못하는 바닥 칸 수 (문·계단을 지나고 잔해·문 소품은 치우거나 열 수 있다고 본다. 막는 소품이 선 칸은 바닥으로 세지 않는다) */
  function cut(sc: Scene): number {
    const W = sc.w, seen = new Uint8Array(sc.w * sc.h);
    const pass = (i: number): boolean => {
      const t = sc.tiles[i];
      if (t !== TILE.FLOOR && t !== TILE.DOOR && t !== TILE.GROUND && t !== TILE.ROAD && t !== TILE.STAIR && t !== TILE.TREE && t !== TILE.TRAIL) return false;
      const p = sc.propAt[i];
      return p < 0 || sc.props[p].kind === 'door' || sc.props[p].kind === 'debris';
    };
    const st = [Math.round(sc.staging.y) * W + Math.round(sc.staging.x)]; seen[st[0]] = 1;
    while (st.length) {
      const c = st.pop()!, x = c % W, y = (c / W) | 0;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= W || ny >= sc.h) continue; const j = ny * W + nx; if (!seen[j] && pass(j)) { seen[j] = 1; st.push(j); } }
      const sl = sc.stairTo[c]; if (sl >= 0 && !seen[sl]) { seen[sl] = 1; st.push(sl); }
    }
    let n = 0;
    for (let i = 0; i < seen.length; i++) if (sc.tiles[i] === TILE.FLOOR && sc.propAt[i] < 0 && !seen[i]) n++;
    return n;
  }

  it('등록과 크기: shockSpread 는 rubbleRoad 다음의 상태 규칙이다(사건을 만들지 않는다 — 쿨다운·상한 없음). 충격의 식은 X6 의 현장 안 식을 밖으로 이은 것', () => {
    const ids = consequences().map((c) => c.id);
    expect(ids.indexOf('shockSpread')).toBe(ids.indexOf('rubbleRoad') + 1);
    const R = consequences().find((c) => c.id === 'shockSpread')!;
    expect([R.spawns, R.cooldown, R.cap, R.on]).toEqual([false, 0, Infinity, ['catastrophe', 'blast', 'collapse']]);
    expect(SHOCK).toEqual({ K: 0.8, CELL: 2, PAD: 2, TOTAL: 0.6, START: 0.35, REACH: 15, START_SIZE: 10, S_MIN: 0.1 });
    expect(SHOCK.K).toBe(CAT.K_HIT_BLAST);
    const sig = (over: Partial<Signal>): Signal => ({ kind: 'catastrophe', t: 0, inc: 0, ev: 0, x: 0, y: 0, size: 6, place: 0, data: 0, cx: -1, cy: -1, mag: 50, ...over });
    // 설계서의 손 계산: 반경 6칸·피해 50 → 틈 3 에 0.22 · 틈 7.2 에 0.12 · 틈 12 넘으면 0
    expect(shockDelta(sig({}), 3)).toBeCloseTo(0.225, 9);
    expect(shockDelta(sig({}), 7.2)).toBeCloseTo(0.12, 9);
    expect(shockDelta(sig({}), 12)).toBe(0);
    expect(shockDelta(sig({ kind: 'blast', size: 3.4, mag: 55 }), 2)).toBeCloseTo(0.8 * 0.55 * (1 - 3 / 5.4), 9);      // 폭발물
    // 건물 전체의 붕괴: 틈 3 에 0.48 · 7.2 에 0.31 · 15 에 0. 무너진 채 시작하는 사건 0.35 ×. 구획 하나(mag < 1)·2차 붕괴(크기 < 10)·전소는 밖으로 나가지 않는다
    expect(shockDelta(sig({ data: 1, mag: 1 }), 3)).toBeCloseTo(0.48, 9);
    expect(shockDelta(sig({ data: 1, mag: 1 }), 7.2)).toBeCloseTo(0.312, 9);
    expect(shockDelta(sig({ data: 1, mag: 1 }), 15)).toBe(0);
    expect(shockDelta(sig({ kind: 'collapse', size: 12 }), 3)).toBeCloseTo(0.28, 9);
    expect([shockDelta(sig({ data: 1, mag: 0.99 }), 1), shockDelta(sig({ kind: 'collapse', size: 3 }), 1), shockDelta(sig({ data: 2, mag: 0 }), 1)]).toEqual([0, 0, 0]);
    expect([...GAS_KINDS].sort()).toEqual(['apartment', 'cafe', 'convenience', 'hotel', 'houseL', 'houseS', 'market', 'officetel', 'restaurant', 'shop', 'villa']);
  });

  it('① 폭발 신호 하나 → 틈 안의 이웃에만 손상 — 손 계산과 같은 값, 금 기록(진실 · 사건 없음 · 시스템 building)의 원인은 그 폭발 기록. 배관은 도시가스 건물의 문턱을 넘을 때만. 둘째 충격은 더하고 기록은 되풀이하지 않는다', () => {
    const s = quiet(), src = srcPlace(s, 3, 3);
    const { I, ev } = fireWith(s, src.id);
    signal(s, 'catastrophe', { inc: I.id, ev, size: 6, place: src.id, data: 0, mag: 50 });
    tickWorld(s);
    const hand = (g: number): number => 0.8 * 0.5 * Math.max(0, 1 - (g / 2 + 2) / 8);
    let hit = 0, cracks = 0, pipes = 0;
    for (const nb of neighborsOf(s, src.id)) {
      const q = s.city.places[nb.id], ex = s.world.expo[nb.id], d = hand(nb.gap);
      if (!(d > 0)) { expect(ex, `틈 ${nb.gap.toFixed(1)} 은 닿지 않는다`).toBeUndefined(); continue; }
      hit++;
      expect(ex.shake).toBeCloseTo(d, 9);
      expect([ex.shakeEv, ex.shakeInc]).toEqual([ev, I.id]);
      const crack = structRecs(s).filter((e) => e.text === `${label(src)} 폭발의 충격으로 옆 ${label(q)}에 금이 갔습니다.`);
      expect(crack.length).toBe(d >= SHOCK.S_MIN ? 1 : 0);
      if (crack.length) { cracks++; expect([crack[0].causes, crack[0].truth, crack[0].incidentId, crack[0].kind, sysOf(crack[0])]).toEqual([[ev], true, -1, 'hazard', 'building']); }
      const cutPipe = GAS_KINDS.has(q.kind) && ex.shake >= ex.pipeThr;
      expect(ex.pipe).toBe(cutPipe);
      if (cutPipe) { pipes++; const r = s.events[ex.pipeEv]; expect([r.text, r.causes, r.tag]).toEqual([`${label(q)}의 가스 배관이 충격으로 손상됐습니다.`, [ev], 'struct']); }
      else expect(ex.pipeEv).toBe(-1);
    }
    expect(hit).toBeGreaterThanOrEqual(1);
    expect(cracks).toBeGreaterThanOrEqual(1);
    expect(structRecs(s).length).toBe(cracks + pipes);
    expect(Object.keys(s.world.expo).length).toBe(hit);
    expect(s.world.log.filter((l) => l.rule === 'shockSpread')).toEqual([{ rule: 'shockSpread', t: s.t, ev, inc: I.id, made: -1, depth: 0 }]);
    // 측정 도구의 hazard-shock 줄: 흔들린 건물 · S_MIN 을 넘은 건물 · 끊긴 배관 (읽기만 한다)
    const cnt = new HazProbe(s).done();
    expect([cnt.shock.shocked, cnt.shock.overMin, cnt.shock.pipes, cnt.shock.worn]).toEqual([hit, cracks, pipes, 0]);
    expect(hazLines(sumHaz([cnt])).find((l) => l.startsWith('hazard-shock:'))).toContain(`buildings shaken ${hit} (in 1 shifts) · over S_MIN ${cracks} · pipes cut ${pipes}`);
    expect((hazJson(sumHaz([cnt])).shock as { shaken: number }).shaken).toBe(hit);
    // 둘째 충격(더 작은 폭발): 손상은 더해지고(1 에서 멈춘다), 가장 크게 보탠 기록은 그대로, 금 기록은 되풀이되지 않는다
    const nb0 = neighborsOf(s, src.id)[0], before = s.world.expo[nb0.id].shake, n0 = structRecs(s).filter((e) => /금이 갔습니다/.test(e.text)).length;
    const ev2 = raiseProblem(s, I, 'EXPLOSION', '시험 2', { role: 'SYSTEM', actor: '시험', text: '폭발! (시험 2)' }, false);
    signal(s, 'catastrophe', { inc: I.id, ev: ev2, size: 4, place: src.id, data: 0, mag: 30 });
    tickWorld(s);
    const d2 = 0.8 * 0.3 * Math.max(0, 1 - (nb0.gap / 2 + 2) / 6);
    expect(s.world.expo[nb0.id].shake).toBeCloseTo(Math.min(1, before + d2), 9);
    expect(s.world.expo[nb0.id].shakeEv).toBe(ev);
    expect(structRecs(s).filter((e) => /금이 갔습니다/.test(e.text)).length).toBe(n0 + neighborsOf(s, src.id).filter((nb) => { const e = s.world.expo[nb.id]; return e && e.shake >= SHOCK.S_MIN && hand(nb.gap) < SHOCK.S_MIN; }).length);
  });

  it('① 전체 붕괴 하나만으로(폭발 없이) 틈 3 안팎의 이웃에 금이 간다 — X6 의 collapseBuilding 이 mag 1 의 신호를 보내고, 무너진 채 시작하는 사건은 0.35 × 로 흔든다', () => {
    const s = quiet(), src = srcPlace(s, 3, 2);
    const I = createIncident(s, { type: 'fire', variant: 'std', placeId: src.id, rng: s.rng.fork('t-shock') });
    const sc = s.scenes[I.id]!, c = catOf(s, sc)!;
    expect(c.struct).toBe(true);
    const ev = collapseBuilding(s, sc, I, c);
    const sg = s.world.signals.filter((g) => g.kind === 'catastrophe');
    expect(sg.map((g) => [g.data, g.mag, g.ev, g.place])).toEqual([[1, 1, ev, src.id]]);
    tickWorld(s);
    const nbs = neighborsOf(s, src.id);
    expect(nbs[0].gap).toBeLessThanOrEqual(3);
    for (const nb of nbs) {
      const ex = s.world.expo[nb.id], d = nb.gap < 15 ? 0.6 * (1 - nb.gap / 15) : 0;
      if (d > 0 && placeState(s, nb.id)?.usable !== false) expect(ex.shake, `틈 ${nb.gap.toFixed(1)}`).toBeCloseTo(d, 6);
      else expect(ex).toBeUndefined();
    }
    const q0 = s.city.places[nbs[0].id];
    const rec = structRecs(s).find((e) => e.text === `${label(src)} 붕괴의 충격으로 옆 ${label(q0)}에 금이 갔습니다.`)!;
    expect(rec.causes).toEqual([ev]);
    expect(s.world.expo[nbs[0].id].shake).toBeGreaterThanOrEqual(0.48 - 1e-9);
    // 무너진 채 시작하는 사건의 신호(collapse — 크기 = 처음 무너진 칸 수 ≥ 10)
    const s2 = quiet(), src2 = srcPlace(s2, 3, 2), { I: I2, ev: e2 } = fireWith(s2, src2.id, 'STRUCT_COLLAPSE');
    signal(s2, 'collapse', { inc: I2.id, ev: e2, size: 40, place: src2.id });
    tickWorld(s2);
    const n2 = neighborsOf(s2, src2.id)[0];
    expect(s2.world.expo[n2.id].shake).toBeCloseTo(0.35 * (1 - n2.gap / 15), 9);
  });

  it('② 구획 하나의 붕괴(mag < 1)는 밖으로 나가지 않는다 — 2차 붕괴(크기 < 10)·전소도. 노출 칸도 기록도 없다', () => {
    const s = quiet(), src = srcPlace(s, 3, 2);
    const I = createIncident(s, { type: 'fire', variant: 'std', placeId: src.id, rng: s.rng.fork('t-shock') });
    const sc = s.scenes[I.id]!, c = catOf(s, sc)!;
    const r = sc.regions.findIndex((g) => g.indoor && g.tiles.length > 4);
    const ev = collapseRegion(s, sc, I, c, r);
    const sg = s.world.signals.filter((g) => g.kind === 'catastrophe');
    expect(sg.length).toBe(1);
    expect([sg[0].data, sg[0].ev]).toEqual([1, ev]);
    expect(sg[0].mag).toBeGreaterThan(0); expect(sg[0].mag).toBeLessThan(1);
    signal(s, 'collapse', { inc: I.id, ev, size: 3, place: src.id });      // 2차 붕괴
    signal(s, 'catastrophe', { inc: I.id, ev, size: 0, place: src.id, data: 2, mag: 0 });      // 전소
    tickWorld(s);
    expect([s.world.expo, structRecs(s), s.world.log.filter((l) => l.rule === 'shockSpread')]).toEqual([{}, [], []]);
  });

  it('③ 손상된 건물에 난 다음 사건: s.wear 와 낮아진 처음 건전도, 배관이 끊겼으면 새는 밸브와 X6 의 가스 격자 — s.rules·s.kind 는 그대로이고 모든 바닥에 걸어서 닿는다. 배관이 멀쩡하면 밸브는 없다', () => {
    let placed = 0, seen = 0;
    const s0 = quiet();
    const targets = s0.city.places.filter((q) => bld(q) && GAS_KINDS.has(q.kind) && (INCIDENT_PLACES.fire[q.kind] ?? 0) > 0);
    const pick = targets.filter((_, k) => k % Math.max(1, Math.floor(targets.length / 16)) === 0).slice(0, 16);
    expect(pick.length).toBeGreaterThanOrEqual(12);
    for (const [k, q] of pick.entries()) {
      const type = k % 4 === 3 ? 'medical' : 'fire';
      const make = (mark: 'pipe' | 'shake' | null): { s: Sim; sc: Scene; I: Incident } => {
        const s = quiet();
        const src = createIncident(s, { type: 'fire', variant: 'std', rng: s.rng.fork('t-src') });      // 손상을 준 사건 (wear.inc 의 코드)
        if (mark) { const ex = expoOf(s, q.id); ex.shake = 0.4; ex.shakeEv = src.rootEvent; ex.shakeInc = src.id; ex.pipe = mark === 'pipe'; }
        const I = createIncident(s, { type, placeId: q.id, rng: s.rng.fork('t-next') });
        return { s, sc: s.scenes[I.id]!, I };
      };
      const A = make('pipe'), B = make(null), C = make('shake');
      seen++;
      expect(A.I.truth.placeId).toBe(q.id);
      expect([A.sc.rules, A.sc.kind, A.sc.variant]).toEqual([B.sc.rules, B.sc.kind, B.sc.variant]);
      expect(A.sc.wear).toEqual({ dmg: 0.4, soot: 0, cause: 'shock', inc: A.s.incidents[0].code, pre: 0 });
      expect(C.sc.wear).toEqual(A.sc.wear);
      expect(B.sc.wear).toBeUndefined();
      // 밸브: A 에만 하나 (C 는 배관이 멀쩡하다) — 그 밖의 소품은 같다
      expect(C.sc.props.length).toBe(B.sc.props.length);
      const extra = A.sc.props.length - B.sc.props.length;
      expect(extra === 0 || extra === 1).toBe(true);
      if (type === 'fire') expect(extra, `${q.kind} 화재 현장에는 가구 자리가 있다`).toBe(1);
      if (extra === 1) {
        placed++;
        const v = A.sc.props[A.sc.props.length - 1];
        expect([v.kind, v.blocking]).toEqual(['valve', true]);
        expect(v.leakRate!).toBeGreaterThanOrEqual(EXPO_LEAK[0]); expect(v.leakRate!).toBeLessThanOrEqual(EXPO_LEAK[1]);
        const i = v.y * A.sc.w + v.x;
        expect(A.sc.tiles[i]).toBe(TILE.FLOOR);
        expect(A.sc.regions[A.sc.region[i]].indoor).toBe(true);
        expect(cut(A.sc), `${q.kind} 밸브를 놓은 현장의 모든 바닥에 걸어서 닿는다`).toBe(cut(B.sc));
        // 옆에 서서 잠글 수 있다: 맞닿은 바닥 하나가 걸어서 닿는다
        const nbF = [1, -1, A.sc.w, -A.sc.w].map((dd) => i + dd).filter((j) => A.sc.tiles[j] === TILE.FLOOR && A.sc.propAt[j] < 0);
        expect(nbF.length).toBeGreaterThan(0);
        // 다른 칸은 그대로 (밸브 칸만 가구 → 바닥)
        let diff = 0; for (let j = 0; j < A.sc.tiles.length; j++) if (A.sc.tiles[j] !== B.sc.tiles[j]) diff++;
        expect(diff).toBeLessThanOrEqual(1);
      }
      // 처음 건전도: 실내 구획마다 min(그대로의 값, 1 − 0.5 × 0.4) — X6 의 가스 격자는 밸브가 있는 현장에만
      const ca = catOf(A.s, A.sc), cb = catOf(B.s, B.sc), cc = catOf(C.s, C.sc);
      if (ca && cb && cc && ca.struct) {
        for (let r = 0; r < A.sc.regions.length; r++) {
          if (!A.sc.regions[r].indoor) { expect(ca.integ[r]).toBe(cb.integ[r]); continue; }
          expect(ca.integ[r]).toBeCloseTo(Math.min(cb.integ[r], 1 - CAT.WEAR_INTEG * 0.4), 6);
          expect(cc.integ[r]).toBeCloseTo(ca.integ[r], 6);
        }
        expect(ca.bldg).toBeLessThan(cb.bldg);
      }
      if (extra === 1) { expect(ca!.gas).not.toBe(null); }
      if (cb) expect(cb.gas).toBe(null);
    }
    expect(seen).toBe(pick.length);
    expect(placed).toBeGreaterThanOrEqual(Math.ceil(pick.length * 0.75));
    // applyExpo 는 노출 칸이 없으면 아무것도 하지 않고 만들지도 않는다 (길 위의 사건도)
    const s = quiet(), I = createIncident(s, { type: 'traffic', variant: 'std', rng: s.rng.fork('t') }), sc = s.scenes[I.id]!;
    const props = sc.props.length;
    applyExpo(s, sc, I);
    expect([s.world.expo, sc.wear, sc.props.length]).toEqual([{}, undefined, props]);
  }, 60000);

  it('⑥ X6 의 전체 붕괴는 그 건물이 면한 길(Place.edgeId)을 먼저 막는다 — 사건 교차로의 첫 구간이 아니어도. 막아도 도시가 끊기지 않고, 교통의 장부에 닫힘의 주인이 적힌다', () => {
    const s0 = quiet();
    let q: Place | undefined;
    for (const p of s0.city.places) {
      if (!bld(p) || !((INCIDENT_PLACES.fire[p.kind] ?? 0) > 0) || p.edgeId === undefined) continue;
      const nd = s0.city.nodes[p.nodeId], e = s0.city.edges[p.edgeId];
      if (nd.edges[0] === p.edgeId || nd.edges.indexOf(p.edgeId) < 0 || !findRoute(s0.city, e.a, e.b, 1, e.id, true)) continue;
      q = p; break;
    }
    expect(q).toBeDefined();
    const s = quiet(), I = createIncident(s, { type: 'fire', variant: 'std', placeId: q!.id, rng: s.rng.fork('t-shock') });
    const sc = s.scenes[I.id]!, c = catOf(s, sc)!;
    expect(c.struct).toBe(true);
    expect(s.city.nodes[I.truth.nodeId].edges[0]).not.toBe(q!.edgeId);
    collapseBuilding(s, sc, I, c);
    const e = s.city.edges[q!.edgeId!];
    expect(I.blockedEdge).toBe(q!.edgeId);
    expect([e.closed, e.closedReason]).toEqual([true, 'incident']);
    expect(s.events[I.blockEv!].text).toMatch(/^건물 붕괴 잔해로 .+ 통제$/);
    expect(s.traffic.closeEv[e.id]).toBe(I.blockEv);
    for (const f of s.city.facilities) for (const to of [I.truth.nodeId, e.a, e.b]) expect(reallyLinked(s, f.nodeId, to, -1, true), `${f.name} → 교차로 ${to}`).toBe(true);
  });

  it('⑦ 정보 격리: applyExpo 앞뒤로 s.rules·s.kind 가 같고, 밸브를 본 적 없는 경찰 대원의 방법 선택(순수 함수)은 배관이 끊긴 현장과 멀쩡한 현장에서 같다 (확성기 대피 방송은 가스 현장의 생김새에서만)', () => {
    const s0 = quiet();
    const q = s0.city.places.find((p) => bld(p) && GAS_KINDS.has(p.kind) && (INCIDENT_PLACES.fire[p.kind] ?? 0) > 0)!;
    const make = (pipe: boolean): { s: Sim; sc: Scene; I: Incident } => {
      const s = quiet();
      if (pipe) { const ex = expoOf(s, q.id); ex.shake = 0.5; ex.pipe = true; }
      const I = createIncident(s, { type: 'fire', variant: 'std', placeId: q.id, rng: s.rng.fork('t-next') });
      return { s, sc: s.scenes[I.id]!, I };
    };
    const A = make(true), B = make(false);
    expect(A.sc.props.some((p) => p.kind === 'valve')).toBe(true);
    expect(B.sc.props.some((p) => p.kind === 'valve')).toBe(false);
    expect([A.sc.rules, A.sc.kind]).toEqual([B.sc.rules, B.sc.kind]);
    // applyExpo 를 같은 현장에 한 번 더 불러도 생김새 칸은 그대로다 ((b3-8c) 이미 새는 밸브가 있으니 더 놓이지도 않는다)
    const r0 = JSON.stringify(A.sc.rules ?? null), k0 = A.sc.kind;
    applyExpo(A.s, A.sc, A.I);
    expect([JSON.stringify(A.sc.rules ?? null), A.sc.kind]).toEqual([r0, k0]);
    const pick = (X: { s: Sim; sc: Scene; I: Incident }): string | null => {
      unitArrived(X.s, X.I, X.s.units.find((u) => u.kind === 'patrol')!);
      const a = X.sc.agents.find((g) => X.s.responders[g.rid].role === 'patrolLead')!;
      expect(a.beliefs.list('haz').length).toBe(0);
      return chooseMethod(X.s, X.sc, a, 'perimeter', { cas: -1, prop: -1, hostile: -1, region: -1, tile: 0 }, null, NO_SENSE)?.m ?? null;
    };
    const ma = pick(A), mb = pick(B);
    expect(ma).toBe(mb);
    expect(ma).not.toBe('announce');
  });
});

// ───────────────────────── b3-8 c · b3-9: L3 의 법칙(structFail · pipeLeak) · L2 의 불티 · L7 rekindle · C10 suspectZone ─────────────────────────
describe('I1-b b3-8 c · b3-9: 금 간 건물의 붕괴·끊긴 배관의 누출 · 폭발의 불티 · 되살아난 잔불 · 도주한 무장 용의자', () => {
  const bld = (q: Place): boolean => !q.open && q.facility < 0;
  const firePlace = (q: Place): boolean => bld(q) && (INCIDENT_PLACES.fire[q.kind] ?? 0) > 0;
  const lawOf = (id: string): HazardLaw => hazardLaws().find((l) => l.id === id)!;
  /** 1초씩 시각을 옮기며 초과 위험의 주기 → 예약을 사건으로 (현장·부대는 돌지 않는다) */
  function go(s: Sim, sec: number): void { for (let k = 0; k < sec; k++) { s.tick += 5; s.t = s.tick * s.dt; tickHazards(s); tickIncidents(s); } }
  /** 쌓인 신호를 처리한다 (tickWorld 의 신호 단계) */
  function flush(s: Sim): void { s.tick += 1; s.t = s.tick * s.dt; tickWorld(s); }
  /** 법칙의 세기를 잠깐 키운다 */
  const withA = <R>(o: { A: number }, mul: number, fn: () => R): R => { const a0 = o.A; o.A = a0 * mul; try { return fn(); } finally { o.A = a0; } };
  /** 가장 가까운 이웃의 틈이 maxGap 이하이고 이웃이 n 채 이상인 화재의 틀이 있는 건물 */
  function srcPlace(s: Sim, maxGap: number, n = 2): Place {
    for (const q of s.city.places) {
      if (!firePlace(q)) continue;
      const nbs = neighborsOf(s, q.id);
      if (nbs.length >= n && nbs[0].gap <= maxGap) return q;
    }
    throw new Error('장소 없음');
  }
  /** 그 건물의 화재 하나와 그 사건의 기록 하나 (신호의 기록 — 폭발·붕괴 기록 자리) */
  function fireWith(s: Sim, placeId: number, code: 'EXPLOSION' | 'STRUCT_COLLAPSE' = 'EXPLOSION'): { I: Incident; ev: number } {
    const I = createIncident(s, { type: 'fire', variant: 'std', placeId, rng: s.rng.fork('t-shock') });
    const ev = raiseProblem(s, I, code, '시험', { role: 'SYSTEM', actor: '시험', text: code === 'EXPLOSION' ? '폭발! (시험)' : '굉음! (시험)' }, false);
    return { I, ev };
  }
  const lawKids = (s: Sim, ...ids: string[]): Incident[] => s.incidents.filter((J) => J.hz !== undefined && ids.indexOf(J.hz.law) >= 0);

  it('등록: 법칙 모음의 차례가 road → heat → shock(structFail · pipeLeak) → ember(rekindle) 다 — 셋 다 1초 · 건물마다 한 번 · 교대 상한 2, rekindle 은 충격만 받는다(scan 없음). 상태 규칙은 rubbleRoad → shockSpread → pipeShut → residualHeat → suspectZone', () => {
    expect(hazardLaws().map((l) => l.id).slice(0, 5)).toEqual(['roadCrash', 'heatSpread', 'structFail', 'pipeLeak', 'rekindle']);      // (b3-10) 그 뒤에 power(liftStall) — 'I1-b b3-10' 묶음이 본다
    for (const id of ['structFail', 'pipeLeak', 'rekindle']) { const L = lawOf(id); expect([L.every, L.once, L.cap], id).toEqual([1, true, 2]); }
    expect([lawOf('structFail').scan !== undefined, lawOf('pipeLeak').scan !== undefined, lawOf('rekindle').scan]).toEqual([true, true, undefined]);
    expect([lawOf('structFail').label, lawOf('pipeLeak').label, lawOf('rekindle').label]).toEqual(['금 간 건물의 붕괴', '끊긴 배관의 누출', '되살아난 잔불']);
    expect(readFileSync('src/sim/world/laws/index.ts', 'utf8')).toMatch(/^import '\.\/heat';[^\n]*\nimport '\.\/shock';[^\n]*\nimport '\.\/ember';/m);
    expect(readFileSync('src/sim/world/rules/index.ts', 'utf8')).toMatch(/^import '\.\/structure';\nimport '\.\/risk';/m);
    const ids = consequences().map((c) => c.id);
    expect(ids.slice(ids.indexOf('rubbleRoad'), ids.indexOf('suspectZone') + 1)).toEqual(['rubbleRoad', 'shockSpread', 'pipeShut', 'residualHeat', 'suspectZone']);      // (b3-10) 그 뒤로 rules/infra.ts 의 C4·C8 — 'I1-b b3-10' 묶음이 본다
    // 세기와 크기 (첫 값에서 — STRUCT.A 는 강제 collapse/gasblast 20교대로 절반)
    expect(STRUCT).toEqual({ A: 5.0e-4, SEV2: 0.3, SEV3: 0.45, MAX: 16, CAP: 2 });
    expect(PIPE.A).toBeCloseTo(1 / 300, 12); expect([PIPE.SEV2, PIPE.MAX, PIPE.CAP, REKINDLE.CAP]).toEqual([0.4, 16, 2, 2]);
    expect(EMBER).toEqual({ K: 0.25, NB_MAX: 8 });
    expect(RESIDUAL).toEqual({ K: 1.0e-3, TAU: 180, TAU_RAIN: 120, MIN_DELAY: 60, FIRE_MIN: 0.04, HEAT_MIN: 0.5, HEAT_W: 0.25 });
    expect([REOFFEND, RISK]).toEqual([{ R: 900, POLICE_R: 400, WAIT: 240 }, { V: 0.6, HOLD: 300, COOLDOWN: 120 }]);
    // 불티의 손 계산 (설계서): 반경 6칸·피해 50 → 틈 3 에 0.44 · 틈 7.2 에 0.21 · 틈 25 에 0.04. 폭발이 아니면 0
    const sig = (over: Partial<Signal>): Signal => ({ kind: 'catastrophe', t: 0, inc: 0, ev: 0, x: 0, y: 0, size: 6, place: 0, data: 0, cx: -1, cy: -1, mag: 50, ...over });
    expect(emberDelta(sig({}), 3, 1)).toBeCloseTo(0.25 * 144 / 81, 9);
    expect(emberDelta(sig({}), 7.2, 1)).toBeCloseTo(0.25 * 144 / 13.2 ** 2, 9);
    expect(emberDelta(sig({}), 25, 1.3)).toBeCloseTo(1.3 * 0.25 * 144 / 31 ** 2, 9);
    expect(emberDelta(sig({ kind: 'blast', size: 3.4, mag: 55 }), 2, 1)).toBeCloseTo(0.25 * 1.1 * 6.8 ** 2 / 64, 9);
    expect([emberDelta(sig({ data: 1, mag: 1 }), 3, 1), emberDelta(sig({ kind: 'collapse', size: 12 }), 3, 1), emberDelta(sig({ data: 2 }), 3, 1)]).toEqual([0, 0, 0]);
  });

  it('L3 ① 전체 붕괴 하나만으로 틈 안의 이웃에 금이 가고 그 건물의 structFail 칸이 생긴다 — 위험률 A × (금 − S_MIN). 배관이 끊긴 도시가스 건물에는 pipeLeak 칸(A 그대로)', () => {
    const s = quiet(), src = srcPlace(s, 3, 2);
    const { I, ev } = fireWith(s, src.id, 'STRUCT_COLLAPSE');
    signal(s, 'catastrophe', { inc: I.id, ev, size: 40, place: src.id, data: 1, mag: 1 });
    flush(s);      // 신호 단계(shockSpread 가 금을 적는다) 다음, 같은 tickWorld 의 1초 주기(tick % 5 === 1)가 그 금을 한 번 읽는다
    expect(s.tick % 5).toBe(1);
    const cracked = neighborsOf(s, src.id).filter((nb) => (s.world.expo[nb.id]?.shake ?? 0) >= SHOCK.S_MIN);
    expect(cracked.length).toBeGreaterThanOrEqual(1);
    for (const nb of neighborsOf(s, src.id)) {
      const ex = s.world.expo[nb.id], c = hazardCell(s, 'structFail', nb.id), p = hazardCell(s, 'pipeLeak', nb.id);
      if (!ex || ex.shake < SHOCK.S_MIN) { expect(c, `틈 ${nb.gap.toFixed(1)}`).toBe(null); continue; }
      expect(ex.shake).toBeCloseTo(0.6 * (1 - nb.gap / 15), 9);
      expect(c!.H + (c!.done ? c!.thr : 0) >= STRUCT.A * (ex.shake - SHOCK.S_MIN) * 0.999).toBe(true);
      if (!c!.done) expect(c!.H).toBeCloseTo(STRUCT.A * (ex.shake - SHOCK.S_MIN), 12);
      expect(p === null).toBe(!ex.pipe);
      if (p && !p.done) expect(p.H).toBeCloseTo(PIPE.A, 12);
    }
    // 금이 S_MIN 아래인 건물 · 쓸 수 없는 건물(전소·전체 붕괴)은 대상이 아니다
    const s2 = quiet(), q = s2.city.places.find((x) => firePlace(x) && x.id !== src.id)!;
    expoOf(s2, q.id).shake = SHOCK.S_MIN - 0.01;
    go(s2, 3);
    expect(hazardCell(s2, 'structFail', q.id)).toBe(null);
    const ex2 = expoOf(s2, q.id); ex2.shake = 0.5; ex2.pipe = true; ex2.shakeEv = ex2.pipeEv = note(s2, '시험 — 금');
    s2.placeMarks.set(q.id, { placeId: q.id, state: 'collapsed', t: s2.t, incidentId: 0, burnFrac: 0, ruinFrac: 1 });
    go(s2, 3);
    expect([hazardCell(s2, 'structFail', q.id), hazardCell(s2, 'pipeLeak', q.id)]).toEqual([null, null]);
  });

  it('L3 ④ 개입 시험: 같은 시드의 두 Sim 에 같은 전체 붕괴를 일으키고 한쪽만 붕괴 직후 world.expo 를 비운다 — 그쪽에는 structFail·pipeLeak 이 없고, 다른 쪽의 사건은 그 금 간 건물(hz.target)에 나며 부모는 붕괴한 사건, 원인은 금·배관 기록, 현장은 금 간 채로 시작한다', () => {
    const run = (clear: boolean): Sim => {
      const s = quiet(), src = srcPlace(s, 3, 2);
      const { I, ev } = fireWith(s, src.id, 'STRUCT_COLLAPSE');
      signal(s, 'catastrophe', { inc: I.id, ev, size: 40, place: src.id, data: 1, mag: 1 });
      flush(s);      // 신호 단계 + 그 틱의 1초 주기 한 번 (칸이 생긴다)
      if (clear) s.world.expo = {};
      after.push(Hs(s));
      withA(STRUCT, 40, () => withA(PIPE, 40, () => go(s, 300)));
      return s;
    };
    const Hs = (s: Sim): string => JSON.stringify(['structFail', 'pipeLeak'].map((l) => Object.entries(s.world.hz.cells[l as HazardLawId] ?? {}).map(([k, c]) => [k, c.H, c.thr, c.done])));
    const after: string[] = [];
    const A = run(false), B = run(true);
    expect(lawKids(B, 'structFail', 'pipeLeak')).toEqual([]);
    // 비운 쪽의 칸은 붕괴 직후의 첫 주기 값(H) 그대로다 — 금이 없으니 더 쌓이지 않는다 (같은 시드라 두 쪽의 첫 값도 같다)
    expect(Hs(B)).toBe(after[1]);
    expect(after[1]).toBe(after[0]);
    expect(Object.values(B.world.hz.cells.structFail ?? {}).every((c) => !c.done)).toBe(true);
    const kids = lawKids(A, 'structFail', 'pipeLeak');
    expect(kids.length).toBeGreaterThanOrEqual(1);
    expect(kids.length).toBeLessThanOrEqual(HZ.ROOT_MAX);      // 한 뿌리의 법칙 사건은 둘까지
    const src = A.incidents[0];
    for (const K of kids) {
      const ex = A.world.expo[K.hz!.target];
      expect(K.truth.placeId).toBe(K.hz!.target);
      expect(neighborsOf(A, src.truth.placeId).some((nb) => nb.id === K.truth.placeId)).toBe(true);
      expect(K.parent).toBe(src.id);
      expect(K.cause).toBe(K.hz!.law === 'structFail' ? ex.shakeEv : ex.pipeEv);
      expect(A.events[K.rootEvent].causes[0]).toBe(K.cause);
      expect(K.hz!.src[0].what).toBe(K.hz!.law === 'structFail' ? 'shake' : 'pipe');
      expect([K.truth.type, K.truth.variant]).toEqual(K.hz!.law === 'structFail' ? ['collapse', 'std'] : ['hazmat', 'std']);
      if (K.hz!.law === 'structFail') expect(K.truth.severity).toBe(ex.shake >= STRUCT.SEV3 ? 3 : ex.shake >= STRUCT.SEV2 ? 2 : 1);
      expect(A.events[K.rootEvent].text.startsWith(K.hz!.law === 'structFail' ? '금이 가 있던 건물이 내려앉았습니다 — ' : '충격으로 손상된 배관에서 가스가 샙니다 — ')).toBe(true);
      // (L3 (나)) 그 현장은 금 간 채로 시작한다 — 처음 건전도가 1 − 0.5 × 금 아래
      const sc = A.scenes[K.id]!;
      expect([sc.wear?.cause, sc.wear?.dmg]).toEqual(['shock', ex.shake]);
      const c = catOf(A, sc);
      if (c?.struct) for (const r of sc.regions) if (r.indoor) expect(c.integ[r.id]).toBeLessThanOrEqual(1 - CAT.WEAR_INTEG * ex.shake + 1e-6);
    }
    expect(A.world.hz.holes + B.world.hz.holes).toBe(0);
  });

  it('L3 ⑧ 끊긴 배관이 낸 누출이 해결로 닫히면 그 배관 손상을 거둔다 — 그 건물의 다음 현장에는 새는 밸브가 놓이지 않는다. 한계 시간으로 닫히면 그대로다. 누출 현장에는 밸브가 더 놓이지 않는다', () => {
    const leak = (reason: 'resolved' | 'timeout'): { s: Sim; q: Place; K: Incident } => {
      const s = quiet(), q = s.city.places.find((x) => firePlace(x) && GAS_KINDS.has(x.kind))!;
      const ex = expoOf(s, q.id); ex.shake = 0.45; ex.pipe = true; ex.shakeEv = ex.pipeEv = note(s, '시험 — 배관 손상');
      withA(PIPE, 1e4, () => go(s, 3));
      const K = lawKids(s, 'pipeLeak')[0];
      expect(K, '누출 사건').toBeDefined();
      expect([K.truth.type, K.truth.placeId, K.truth.severity, K.parent]).toEqual(['hazmat', q.id, 2, undefined]);      // 금 0.45 ≥ 0.4 → 규모 2 · 주인 사건 없는 금 → 부모 없음
      // 누출 현장(buildHazmat 이 새는 밸브를 놓는다)에는 applyExpo 가 밸브를 더 놓지 않는다 — 다시 불러도 그대로
      const sc = s.scenes[K.id]!, nv = sc.props.filter((p) => p.kind === 'valve').length;
      expect(nv).toBeGreaterThanOrEqual(1);
      applyExpo(s, sc, K);
      expect(sc.props.filter((p) => p.kind === 'valve').length).toBe(nv);
      closeIncident(s, K, reason);
      flush(s);
      return { s, q, K };
    };
    const ok = leak('resolved');
    expect(ok.s.world.expo[ok.q.id].pipe).toBe(false);
    expect(ok.s.world.expo[ok.q.id].shake).toBe(0.45);      // 금은 그대로 남는다
    const next = createIncident(ok.s, { type: 'fire', variant: 'std', placeId: ok.q.id, rng: ok.s.rng.fork('t-next') });
    expect(ok.s.scenes[next.id]!.props.some((p) => p.kind === 'valve')).toBe(false);
    expect(ok.s.scenes[next.id]!.wear?.dmg).toBe(0.45);
    const bad = leak('timeout');
    expect(bad.s.world.expo[bad.q.id].pipe).toBe(true);
    const next2 = createIncident(bad.s, { type: 'fire', variant: 'std', placeId: bad.q.id, rng: bad.s.rng.fork('t-next') });
    expect(bad.s.scenes[next2.id]!.props.some((p) => p.kind === 'valve')).toBe(true);
  });

  it('L2 의 불티: 폭발 신호 하나가 이웃 건물의 heatSpread 칸에 손 계산과 같은 충격을 준다(옮겨붙을 수 있는 건물만 — 화재의 틀이 있는 종류·쓸 수 있음·이미 탔지 않음). 넘으면 그 건물의 불(규모 2 · 내력 ember · 원인 = 폭발 기록 · 부모 = 폭발한 사건)', () => {
    const s = quiet(), src = srcPlace(s, 3, 3);
    const { I, ev } = fireWith(s, src.id);
    signal(s, 'catastrophe', { inc: I.id, ev, size: 6, place: src.id, data: 0, mag: 50 });
    flush(s);
    let n = 0;
    for (const nb of neighborsOf(s, src.id)) {
      const q = s.city.places[nb.id], c = hazardCell(s, 'heatSpread', nb.id);
      if (!firePlace(q) || n >= EMBER.NB_MAX) { if (!firePlace(q)) expect(c, q.kind).toBe(null); continue; }
      n++;
      expect(c, `틈 ${nb.gap.toFixed(1)}`).not.toBe(null);
      const dH = 0.25 * heatMul(q.kind) * 144 / (nb.gap + 6) ** 2;
      if (!c!.done) expect(c!.H).toBeCloseTo(dH, 12);
    }
    expect(n).toBeGreaterThanOrEqual(1);
    // 붕괴 신호(data 1)는 불티가 없다
    const s2 = quiet(), b = fireWith(s2, src.id, 'STRUCT_COLLAPSE');
    signal(s2, 'catastrophe', { inc: b.I.id, ev: b.ev, size: 40, place: src.id, data: 1, mag: 1 });
    flush(s2);
    expect(s2.world.hz.cells.heatSpread).toBeUndefined();
    // 세기를 키우면 넘는다: 그 건물의 불 — 규모 2, 첫머리 '폭발의 불티가 옮겨붙었습니다', 내력 ember, 원인 = 폭발 기록, 부모 = 폭발한 사건
    const s3 = quiet(), c3 = fireWith(s3, src.id), k0 = EMBER.K;
    EMBER.K = k0 * 50;
    try { signal(s3, 'catastrophe', { inc: c3.I.id, ev: c3.ev, size: 6, place: src.id, data: 0, mag: 50 }); flush(s3); go(s3, 2); } finally { EMBER.K = k0; }
    const kids = lawKids(s3, 'heatSpread');
    expect(kids.length).toBeGreaterThanOrEqual(1);
    for (const K of kids) {
      expect([K.truth.type, K.truth.variant, K.truth.severity, K.parent, K.cause]).toEqual(['fire', 'std', 2, c3.I.id, c3.ev]);
      expect(K.hz!.src.map((x) => x.what)).toEqual(['ember']);
      expect(K.hz!.src[0].ref).toBe(src.id);
      expect(K.truth.placeId).toBe(K.hz!.target);
      expect(s3.events[K.rootEvent].text.startsWith('폭발의 불티가 옮겨붙었습니다 — ')).toBe(true);
    }
  });

  // ── L7 ──
  /** 그 건물의 화재를 일으키고 그 건물 안의 칸 n 개에 불 f 를 남긴다 (나머지 칸의 불·열은 0, 젖음 wet) */
  function warmFire(s: Sim, placeId: number, n: number, f: number, wet = 0): { I: Incident; sc: Scene } {
    const I = createIncident(s, { type: 'fire', variant: 'std', placeId, rng: s.rng.fork('t-rekindle') });
    const sc = s.scenes[I.id]!;
    sc.fire.fill(0); sc.heat.fill(0); sc.wet.fill(0);
    let k = 0;
    for (let i = 0; i < sc.fire.length && k < n; i++) if (sc.region[i] >= 0 && sc.regions[sc.region[i]].indoor && sc.fuel[i] > 0.2) { sc.fire[i] = f; sc.wet[i] = wet; k++; }
    expect(k).toBe(n);
    return { I, sc };
  }
  const closeEvOf = (s: Sim, I: Incident): number => s.events.filter((e) => e.incidentId === I.id && e.kind === 'resolve').pop()!.id;

  it('L7 ① 불씨를 남기고 닫은 화재 → 같은 건물에 다시 붙는다: 넘는 시각이 닫힌 꼴의 식 Δt* = −τ ln(1 − 문턱 / H∞) 과 같고, 부모는 닫힌 그 화재, 원인은 그 종료 기록, 내력 residual. 끝내 닿지 못하면 칸에 H∞ 만 남는다', () => {
    const s = quiet(), q = s.city.places.find(firePlace)!;
    const { I, sc } = warmFire(s, q.id, 10, 0.5);
    const e0 = residualOf(sc);
    expect(e0).toBeCloseTo(5, 5);
    const cell = hazardCellFor(s, 'rekindle', q.id)!;      // 문턱을 미리 본다 (칸을 만들 뿐 — 쌓지 않는다)
    expect([cell.H, cell.done]).toEqual([0, false]);
    const tau = s.weather === 'rain' ? RESIDUAL.TAU_RAIN : RESIDUAL.TAU, k0 = RESIDUAL.K;
    RESIDUAL.K = (1.5 * cell.thr) / (e0 * tau);      // H∞ = 1.5 × 문턱 → Δt* = τ ln 3
    let at = -1;
    try {
      closeIncident(s, I, 'timeout');
      const t0 = s.t;
      flush(s);
      const item = s.gen.chain.find((c) => c.opts.csq === 'rekindle')!;
      expect(item).toBeDefined();
      const expect_ = Math.max(RESIDUAL.MIN_DELAY, tau * Math.log(3));
      expect(item.at - (t0 + s.dt)).toBeCloseTo(expect_, 6);
      expect([item.opts.placeId, item.opts.parent, item.opts.cause, item.until! - item.at]).toEqual([q.id, I.id, closeEvOf(s, I), HZ.HOLD]);
      expect(hazardCell(s, 'rekindle', q.id)!.done).toBe(true);
      at = item.at;
    } finally { RESIDUAL.K = k0; }
    go(s, Math.ceil(at - s.t) + 2);
    const K = lawKids(s, 'rekindle');
    expect(K.length).toBe(1);
    expect([K[0].truth.type, K[0].truth.variant, K[0].truth.severity, K[0].truth.placeId, K[0].parent, K[0].cause]).toEqual(['fire', 'std', 1, q.id, I.id, closeEvOf(s, I)]);
    expect(K[0].hz!.src.map((x) => x.what)).toEqual(['residual']);
    expect(Math.abs(K[0].createdAt - at)).toBeLessThanOrEqual(1.01);
    expect(s.events[K[0].rootEvent].text.startsWith('잔불이 되살아나 다시 불길이 올랐습니다 — ')).toBe(true);
    // 끝내 닿지 못하면(H∞ < 문턱) 칸에 H∞ 만 남는다 — 예약도 기록도 없다
    const s2 = quiet(), w2 = warmFire(s2, q.id, 1, 0.05);
    const ev0 = s2.events.length;
    closeIncident(s2, w2.I, 'timeout'); flush(s2);
    const c2 = hazardCell(s2, 'rekindle', q.id)!;
    expect(c2.H).toBeCloseTo(RESIDUAL.K * residualOf(w2.sc) * (s2.weather === 'rain' ? RESIDUAL.TAU_RAIN : RESIDUAL.TAU), 12);
    expect(c2.done).toBe(c2.H >= c2.thr);
    if (!c2.done) expect(s2.gen.chain.some((c) => c.opts.csq === 'rekindle')).toBe(false);
    expect(s2.events.slice(ev0).every((e) => e.incidentId === w2.I.id)).toBe(true);      // 종료 기록 말고는 새 기록이 없다
  });

  it('L7 ② 개입: 닫기 전에 그 현장의 불·열을 0 으로 두면 예약도 칸도 없다 · ③ 잔불 정리를 마친 현장(열 0 · 젖음 0.9)은 e0 = 0, 젖은 불씨는 그만큼 적다 · ④ 전소 건물 · 교대 끝으로 닫힌 사건에는 예약하지 않는다', () => {
    const q = quiet().city.places.find(firePlace)!;
    const k0 = RESIDUAL.K;
    RESIDUAL.K = k0 * 1000;
    try {
      // ② 같은 화재를 일으키고 한쪽만 불씨를 지운다
      const a = quiet(), A = warmFire(a, q.id, 10, 0.5), b = quiet(), B = warmFire(b, q.id, 10, 0.5);
      B.sc.fire.fill(0);
      closeIncident(a, A.I, 'timeout'); flush(a);
      closeIncident(b, B.I, 'timeout'); flush(b);
      expect(a.gen.chain.some((c) => c.opts.csq === 'rekindle')).toBe(true);
      expect([b.gen.chain.some((c) => c.opts.csq === 'rekindle'), hazardCell(b, 'rekindle', q.id)]).toEqual([false, null]);
      // ③ 잔불 정리를 마친 칸: 불 0 · 열 0 · 젖음 0.9 → 0. 젖은 불씨는 (1 − 젖음) 만큼
      const c = quiet(), C = warmFire(c, q.id, 10, 0.5, 0.9);
      expect(residualOf(C.sc)).toBeCloseTo(10 * 0.5 * 0.1, 5);      // 칸 배열은 Float32Array
      C.sc.fire.fill(0);
      expect(residualOf(C.sc)).toBe(0);
      // 열(0.5 넘는 칸)은 HEAT_W 만큼 — 건물 밖(실내 구역이 아닌 칸)의 불은 세지 않는다
      let out = -1, inn = -1;
      for (let i = 0; i < C.sc.fire.length; i++) { const r = C.sc.region[i]; if (out < 0 && (r < 0 || !C.sc.regions[r].indoor)) out = i; if (inn < 0 && r >= 0 && C.sc.regions[r].indoor) inn = i; }
      C.sc.wet.fill(0); C.sc.fire[out] = 1; C.sc.heat[inn] = 0.8;
      expect(residualOf(C.sc)).toBeCloseTo(RESIDUAL.HEAT_W * 0.8, 5);
      // ④ 전소 건물 · 교대 끝으로 닫힌 사건
      const d = quiet(), D = warmFire(d, q.id, 10, 0.5);
      d.placeMarks.set(q.id, { placeId: q.id, state: 'burnt', t: d.t, incidentId: D.I.id, burnFrac: 0.9, ruinFrac: 0 });
      closeIncident(d, D.I, 'timeout'); flush(d);
      expect([d.gen.chain.some((x) => x.opts.csq === 'rekindle'), hazardCell(d, 'rekindle', q.id)]).toEqual([false, null]);
      const e = quiet(), E = warmFire(e, q.id, 10, 0.5);
      closeIncident(e, E.I, 'shiftend'); flush(e);
      expect([e.gen.chain.some((x) => x.opts.csq === 'rekindle'), hazardCell(e, 'rekindle', q.id)]).toEqual([false, null]);
    } finally { RESIDUAL.K = k0; }
  });

  // ── C10 ──
  /** 동네 안의 교차로에 닿은 강도가 잘 나는 건물 (그 교차로의 동네 = 건물의 동네) */
  function robberyPlace(s: Sim): Place {
    for (const q of s.city.places) {
      if (!bld(q) || !((ARMED_BIAS.robbery[q.kind] ?? 0) > 0)) continue;
      const nd = s.city.nodes[q.nodeId], z = zoneOfXY(nd.x, nd.y);
      if (z >= 0 && z === zoneOfXY(q.x + q.w / 2, q.y + q.h / 2)) return q;
    }
    throw new Error('장소 없음');
  }
  const farPolice = (s: Sim): void => { for (const u of s.units) if (u.dept === 'police') { u.x = -99999; u.y = -99999; } };

  it('C10 재범: 도주 지점 900 안의 강도가 잘 나는 건물(이번 교대에 사건이 없던 곳)에서, 그 곁 400 안에 경찰 부대(대기·귀소)가 없을 때만 — 있으면 5초마다 다시 보고 240초 지나면 expired. 고를 건물이 없으면 예전처럼 평소 추첨', () => {
    const s = quiet(), p = robberyPlace(s);
    const I = createIncident(s, { type: 'armed', variant: 'robbery', placeId: p.id, rng: s.rng.fork('t-flee') });
    const ev = raiseProblem(s, I, 'SUSPECT_FLED', '용의자 도주', { role: 'SYSTEM', actor: '현장', text: '용의자가 현장을 벗어나 도주했습니다. (시험)', imp: 3 }, false);
    const h = { id: 0 } as Hostile;
    const item = reoffendItem(s, I, h, s.t + 50, ev);
    const pid = item.opts.placeId!, q = s.city.places[pid];
    expect(pid).toBe(reoffendPlace(s, I, s.rng.fork('reoffend-place:' + I.id + ':0')));      // 흐름 reoffend-place:<사건>:<용의자>
    expect((ARMED_BIAS.robbery[q.kind] ?? 0) > 0 && pid !== p.id).toBe(true);
    expect(Math.hypot(q.x + q.w / 2 - I.truth.x, q.y + q.h / 2 - I.truth.y)).toBeLessThanOrEqual(REOFFEND.R);
    expect([item.opts.csq, item.opts.parent, item.opts.cause, item.until! - item.at]).toEqual(['reoffend', I.id, ev, REOFFEND.WAIT]);
    // 경찰 부대가 곁에 있으면 일어나지 않는다 — 대기·귀소 중인 부대만 친다(출동 중인 부대는 그 자리를 지키지 않는다)
    farPolice(s);
    expect([policeNear(s, pid), item.when!(s)]).toEqual([false, true]);
    const cop = s.units.find((u) => u.dept === 'police' && !u.air)!;
    cop.x = q.x + q.w / 2 + 100; cop.y = q.y + q.h / 2; cop.state = 'available';
    expect([policeNear(s, pid), item.when!(s)]).toEqual([true, false]);
    cop.state = 'enroute';
    expect(policeNear(s, pid)).toBe(false);
    cop.state = 'returning';
    expect(policeNear(s, pid)).toBe(true);
    // 경찰이 머무는 동안 때가 되면 기다리다 버린다 (expired — 기록은 없다)
    s.gen.chain.push(item);
    go(s, 50 + REOFFEND.WAIT + 10);
    expect(s.incidents.some((J) => J.csq === 'reoffend')).toBe(false);
    expect(s.gen.dropped.some((d) => d.why === 'expired' && d.csq === 'reoffend' && d.parent === I.id)).toBe(true);
    // 경찰이 없으면 그 건물에서 다시 범행한다
    const s2 = quiet(), I2 = createIncident(s2, { type: 'armed', variant: 'robbery', placeId: p.id, rng: s2.rng.fork('t-flee') });
    const ev2 = raiseProblem(s2, I2, 'SUSPECT_FLED', '용의자 도주', { role: 'SYSTEM', actor: '현장', text: '용의자가 현장을 벗어나 도주했습니다. (시험)', imp: 3 }, false);
    farPolice(s2);
    s2.gen.chain.push(reoffendItem(s2, I2, h, s2.t + 50, ev2));
    go(s2, 60);
    const R = s2.incidents.find((J) => J.csq === 'reoffend')!;
    expect(R).toBeDefined();
    expect([R.truth.type, R.truth.variant, R.truth.placeId, R.parent, R.cause]).toEqual(['armed', 'robbery', pid, I2.id, ev2]);
    // 고를 건물이 없으면(도주 지점에서 900 안에 없다) 장소도 조건도 없는 예전 예약
    const far = { ...I2, truth: { ...I2.truth, x: -9000, y: -9000 } } as Incident;
    const it2 = reoffendItem(s2, far, h, s2.t + 50, ev2);
    expect([it2.opts.placeId, it2.when, it2.until]).toEqual([undefined, undefined, undefined]);
  });

  it('C10 구역 위험: 부대가 본 무장 용의자의 도주(진실이 아닌 SUSPECT_FLED)는 그 동네의 경계 단계를 올리고 관제 기록을 남긴다 — 분석 AI 는 그 동네의 무장 신고에 위험도 +0.3 · 경찰 +1. 아무도 보지 못한 도주는 진실만 바뀐다', () => {
    const mk = (seen: boolean): { s: Sim; z: number; ev: number; Q: Incident; base: { sev: number; law: number }; x: number; y: number } => {
      const s = quiet(), p = robberyPlace(s), nd = s.city.nodes[p.nodeId], z = zoneOfXY(nd.x, nd.y);
      const I = createIncident(s, { type: 'armed', variant: 'robbery', placeId: p.id, rng: s.rng.fork('t-flee') });
      const Q = createIncident(s, { type: 'armed', variant: 'robbery', placeId: p.id, rng: s.rng.fork('t-next') });
      Q.locationKnown = true; Q.reportedNode = p.nodeId; Q.fieldType = 'armed';
      assess(s, Q, '시험');
      const base = { sev: Q.assessment!.severity, law: Q.assessment!.needs.law };
      const ev = raiseProblem(s, I, 'SUSPECT_FLED', '용의자 도주', { role: 'SYSTEM', actor: '현장', text: '용의자가 현장을 벗어나 도주했습니다. (시험)', imp: 3, truth: !seen }, false);
      signal(s, 'fled', { inc: I.id, ev, x: nd.x, y: nd.y, data: 0 });
      flush(s);
      return { s, z, ev, Q, base, x: nd.x, y: nd.y };
    };
    const A = mk(true);
    const Z = A.s.world.zones[A.z];
    expect([Z.risk, Z.known.risk, Z.cause.risk, Z.until.risk]).toEqual([RISK.V, true, A.ev, A.s.t + RISK.HOLD]);
    const rec = A.s.events.filter((e) => e.tag === 'risk');
    expect(rec.length).toBe(1);
    expect([rec[0].text, rec[0].causes, rec[0].kind, rec[0].role, sysOf(rec[0])]).toEqual([`${zoneName(A.z)} 일대 무장 용의자 도주 — 인근 신고의 경계 단계를 높입니다.`, [A.ev], 'dispatch', 'DISPATCH', 'hazard']);
    expect(knownZone(A.s, knownZoneOfIncident(A.s, A.Q)).risk).toBe(RISK.V);
    assess(A.s, A.Q, '시험');
    expect(A.Q.assessment!.severity).toBeCloseTo(Math.min(3, A.base.sev + ZONE_SEV), 9);
    expect(A.Q.assessment!.needs.law).toBe(A.base.law + 1);
    // 같은 동네에 120초 안의 둘째 도주는 걸리지 않는다(쿨다운)
    const u0 = Z.until.risk;
    A.s.tick += 25; A.s.t = A.s.tick * A.s.dt;      // 5초 뒤 (쿨다운 120초 안)
    signal(A.s, 'fled', { inc: A.Q.id, ev: A.ev, x: A.x, y: A.y, data: 0 });
    flush(A.s);
    expect(A.s.events.filter((e) => e.tag === 'risk').length).toBe(1);
    expect(A.s.world.zones[A.z].until.risk).toBe(u0);      // 쿨다운 안이라 걸리지 않았다 — 회복 시각도 그대로
    // 아무도 보지 못한 도주: 진실만 바뀐다 — 관제 기록도 관제가 아는 값도 없고 분석 AI 는 그대로
    const B = mk(false);
    expect([B.s.world.zones[B.z].risk, B.s.world.zones[B.z].known.risk]).toEqual([RISK.V, false]);
    expect(B.s.events.some((e) => e.tag === 'risk')).toBe(false);
    expect(knownZone(B.s, B.z).risk).toBeUndefined();
    assess(B.s, B.Q, '시험');
    expect([B.Q.assessment!.severity, B.Q.assessment!.needs.law]).toEqual([B.base.sev, B.base.law]);
    // 300초 뒤에는 회복한다
    const until = A.s.world.zones[A.z].until.risk;
    while (A.s.t < until + 1.2) flush(A.s);      // 회복은 1초 주기(tick % 5 === 1)에서
    expect([A.s.world.zones[A.z].risk, knownZone(A.s, A.z).risk]).toEqual([0, undefined]);
  });

  it('L3 의 "AI 가 아는 길": 관제가 아는 붕괴·폭발 곁의 붕괴·가스 신고는 위험도 +0.3 (이름표 없음) — 진실 기록·위치를 모르는 사건은 치지 않는다', () => {
    for (const truth of [false, true]) {
      const s = quiet();
      // 곁의 건물과 차량이 닿는 교차로 사이가 300 안인 화재의 틀이 있는 건물 (이웃의 틈 3 안)
      const src = s.city.places.find((q) => firePlace(q) && neighborsOf(s, q.id).some((nb) => nb.gap <= 3 && Math.hypot(s.city.nodes[q.nodeId].x - s.city.nodes[s.city.places[nb.id].nodeId].x, s.city.nodes[q.nodeId].y - s.city.nodes[s.city.places[nb.id].nodeId].y) <= 300))!;
      const nb = neighborsOf(s, src.id).find((x) => x.gap <= 3 && Math.hypot(s.city.nodes[src.nodeId].x - s.city.nodes[s.city.places[x.id].nodeId].x, s.city.nodes[src.nodeId].y - s.city.nodes[s.city.places[x.id].nodeId].y) <= 300)!;
      const P = createIncident(s, { type: 'fire', variant: 'std', placeId: src.id, rng: s.rng.fork('t-p') });
      raiseProblem(s, P, 'STRUCT_COLLAPSE', '건물 전체 붕괴 — 시험', { role: 'SYSTEM', actor: '현장', text: '시험 — 붕괴', truth }, false);
      for (const type of ['collapse', 'hazmat'] as const) {
        const Q = createIncident(s, { type, variant: 'std', placeId: nb.id, rng: s.rng.fork('t-q-' + type) });
        Q.locationKnown = true; Q.reportedNode = Q.truth.nodeId; Q.fieldType = type;
        P.locationKnown = false;
        assess(s, Q, '시험');
        const base = Q.assessment!.severity;
        P.locationKnown = true; P.reportedNode = P.truth.nodeId;
        assess(s, Q, '시험');
        // 진실이 아닌 기록이면 +0.3, 진실 기록(아무도 보지 못한 붕괴)이면 그대로
        expect(Q.assessment!.severity, type + (truth ? ' 진실' : '')).toBeCloseTo(truth ? base : Math.min(3, base + SPREAD_SEV), 9);
        expect(Q.assessment!.label, type).toBe(undefined);
      }
    }
  });

  it('§6 I1-b 11 (다) 방치 시험: 금(shake 0.4)을 적어 둔 건물과 아닌 건물에 같은 화재를 일으키고 대원 없이 현장만 돌리면 — 앞쪽의 처음 건전도가 1 − 0.5 × 0.4 이하이고 첫 구획 붕괴가 같거나 이르다', () => {
    const s0 = quiet();
    const cands = s0.city.places.filter((q) => firePlace(q) && q.kind !== 'apartment' && q.kind !== 'officetel').slice(0, 40);
    let tested = 0;
    for (const q of cands) {
      if (tested >= 3) break;
      const mk = (shake: number): { s: Sim; sc: Scene } => {
        const s = quiet();
        if (shake > 0) { const ex = expoOf(s, q.id); ex.shake = shake; ex.shakeEv = note(s, '시험 — 금'); }
        const I = createIncident(s, { type: 'fire', variant: 'std', placeId: q.id, rng: s.rng.fork('t-neglect') });
        return { s, sc: s.scenes[I.id]! };
      };
      const A = mk(0.4), B = mk(0);
      const ca = catOf(A.s, A.sc), cb = catOf(B.s, B.sc);
      if (!ca?.struct || !cb?.struct) continue;
      tested++;
      for (const r of A.sc.regions) if (r.indoor) { expect(ca.integ[r.id]).toBeLessThanOrEqual(1 - 0.5 * 0.4 + 1e-6); expect(ca.integ[r.id]).toBeLessThanOrEqual(cb.integ[r.id] + 1e-6); }
      const firstFall = (m: { s: Sim; sc: Scene }): number => {
        const c = m.sc.cat!;
        for (let k = 0; k < 600 * 5; k++) { m.s.tick++; m.s.t = m.s.tick * m.s.dt; tickScene(m.s, m.sc); if (c.fallen.some((v) => v === 1)) return m.s.t; }
        return Infinity;
      };
      const fa = firstFall(A), fb = firstFall(B);
      expect(fa, `${q.kind} #${q.id}: 금 간 건물 ${fa} · 멀쩡한 건물 ${fb}`).toBeLessThanOrEqual(fb);
      expect(fa).toBeLessThan(Infinity);
    }
    expect(tested).toBe(3);
  }, 120000);
});

describe('I1-b b3-10: 국지 구역 값 · C4 정전 · L5 정전이 닿은 순간의 승강기 · C8 무전 음영 · INFRA_FAIL', () => {
  const lawOf = (id: string): HazardLaw => hazardLaws().find((l) => l.id === id)!;
  /** 한 틱 — 쌓인 신호를 처리하고, 1초 블록이면 초과 위험·회복까지 (tickWorld 하나) — 그 뒤 예약을 사건으로 */
  function tk(s: Sim): void { s.tick += 1; s.t = s.tick * s.dt; tickWorld(s); tickIncidents(s); }
  function secs(s: Sim, sec: number): void { const n = Math.round(sec / s.dt); for (let k = 0; k < n; k++) tk(s); }
  const placeOf = (s: Sim, kind: string): Place => s.city.places.find((q) => q.kind === kind)!;
  const midDark = (s: Sim, eid: number): boolean => { const e = s.city.edges[eid], A = s.city.nodes[e.a], B = s.city.nodes[e.b]; return zoneAt(s, 'power', (A.x + B.x) / 2, (A.y + B.y) / 2) < 0.5; };
  /** 그 건물의 화재 사건과 큰 불 신호 (변전소·발전소·방송국 사고의 원인 자리) */
  function bigFire(s: Sim, placeId: number): Incident {
    const I = createIncident(s, { type: 'fire', variant: 'std', placeId, rng: s.rng.fork('t-util') });
    signal(s, 'fireBig', { inc: I.id, ev: I.rootEvent, size: 40 });
    return I;
  }
  const lineU = (s: Sim, id: number): number => s.rng.fork('grid:line:' + id).next();
  const withRide = <R>(mul: number, fn: () => R): R => { const r0 = LIFT.RIDE; LIFT.RIDE = r0 * mul; try { return fn(); } finally { LIFT.RIDE = r0; } };

  it('등록과 크기: 법칙 모음의 끝에 power(liftStall — 1초 · 건물마다 한 번 · 상한 3 · 마감 420초 · 충격만), 상태 규칙은 suspectZone 다음에 powerOut → powerOut.grid → powerOut.end → powerOut.tell → commsDown → commsDown.power → commsDown.shadow', () => {
    expect(hazardLaws().map((l) => l.id).slice(0, 6)).toEqual(['roadCrash', 'heatSpread', 'structFail', 'pipeLeak', 'rekindle', 'liftStall']);      // (b3-11) 그 뒤에 smoke(smokeIll)
    const L = lawOf('liftStall');
    expect([L.every, L.once, L.cap, L.hold, L.scan, L.label]).toEqual([1, true, 3, 420, undefined, '정전으로 멈춘 승강기']);
    expect(LIFT_LAW).toEqual({ CAP: 3, HOLD: 420 });
    expect(readFileSync('src/sim/world/laws/index.ts', 'utf8')).toMatch(/^import '\.\/ember';[^\n]*\nimport '\.\/power';/m);
    expect(readFileSync('src/sim/world/rules/index.ts', 'utf8')).toMatch(/^import '\.\/risk';[^\n]*\nimport '\.\/infra';/m);
    const ids = consequences().map((c) => c.id);
    expect(ids.slice(ids.indexOf('suspectZone'), ids.indexOf('commsDown.shadow') + 1)).toEqual(['suspectZone', 'powerOut', 'powerOut.grid', 'powerOut.end', 'powerOut.tell', 'commsDown', 'commsDown.power', 'commsDown.shadow']);      // (b3-11·12) 그 뒤에 smokePlume · floodLow
    expect(LIFT).toEqual({ RIDE: 0.006, FLOOR_DIV: 6, FLOOR_MAX: 3, FLOORS: 4 });
    expect([POWER.HOLD, POWER.QUAKE_HOLD, POWER.END, POWER.TELL, POWER.DARK_BUMP, POWER.QUAKE_R, POWER.QUAKE_THR, POWER.LINE_THR, POWER.HOSP_CUT, POWER.CAP]).toEqual([600, 240, [60, 120], [20, 40], 0.4, 900, [0.3, 0.5], [0.15, 0.6], 2, 6]);
    expect([COMMS.UTIL_V, COMMS.POWER_V, COMMS.QUAKE_V, COMMS.STORM_V, COMMS.BACKUP, COMMS.AFTER, COMMS.QUAKE_HOLD, COMMS.CAP]).toEqual([0.4, 0.6, 0.5, 0.7, 100, 180, 300, 3]);
    // 승강기 갇힘의 대상: 4층 이상 · 승강기 갇힘 시나리오가 받는 종류. 충격 = RIDE × min(3, 층/6) × 붐빔(종류·시간대)
    const s = quiet(), lp = liftPlaces(s);
    expect(lp.length).toBeGreaterThan(50);
    for (const id of lp) { const q = s.city.places[id]; expect(q.floors).toBeGreaterThanOrEqual(4); expect(['apartment', 'office', 'officetel', 'hotel', 'deptStore', 'university', 'clinic', 'station']).toContain(q.kind); }
    expect([liftOcc('apartment', 8 * 3600), liftOcc('apartment', 2 * 3600), liftOcc('apartment', 13 * 3600), liftOcc('office', 1 * 3600), liftOcc('office', 13 * 3600), liftOcc('hotel', 1 * 3600)]).toEqual([1.5, 0.4, 1, 0.1, 1.5, 1]);
    const q0 = s.city.places[lp[0]];
    expect(liftDelta(s, q0.id)).toBeCloseTo(0.006 * Math.min(3, q0.floors / 6) * liftOcc(q0.kind, s.startTod + s.t), 12);
  });

  it('국지 구역 값: 원 안에서만 겪는다 · 같은 값이면 더 넓을 때 자리를 바꾸며 원인·회복 시각을 함께 바꾼다 · 구역 전체 값이 오면 자리를 지운다 · 회복 때 자리도 지운다 · endZoneBy 는 그 원인의 칸만 당긴다', () => {
    const s = quiet(), z = 0, d = DISTRICTS[z], ev1 = note(s, '시험 1'), ev2 = note(s, '시험 2'), ev3 = note(s, '시험 3');
    expect(setZone(s, z, 'power', 0, 500, ev1, false, { x: d.x, y: d.y, r: 50 })).toBe(true);
    expect([zoneAt(s, 'power', d.x + 10, d.y), zoneAt(s, 'power', d.x + 80, d.y), zoneAt(s, 'comms', d.x, d.y)]).toEqual([0, 1, 1]);
    // 더 좁은 같은 값은 바꾸지 않는다(회복 시각도 늘리지 않는다) · 더 넓은 같은 값은 자리·원인·회복 시각을 함께 가져간다
    expect(setZone(s, z, 'power', 0, 900, ev2, true, { x: d.x + 5, y: d.y, r: 30 })).toBe(false);
    expect([s.world.zones[z].cause.power, s.world.zones[z].until.power, s.world.zones[z].known.power]).toEqual([ev1, 500, false]);
    expect(setZone(s, z, 'power', 0, 400, ev2, false, { x: d.x + 5, y: d.y, r: 120 })).toBe(true);
    expect([s.world.zones[z].cause.power, s.world.zones[z].until.power, s.world.zones[z].at!.power]).toEqual([ev2, 400, { x: d.x + 5, y: d.y, r: 120 }]);
    // 구역 전체 값(같은 값 — 가장 넓다)이 오면 자리를 지운다
    expect(setZone(s, z, 'power', 0, 700, ev3, false)).toBe(true);
    expect([s.world.zones[z].at?.power, s.world.zones[z].cause.power, zoneAt(s, 'power', d.x + 100, d.y)]).toEqual([undefined, ev3, 0]);
    // endZoneBy: 그 원인·그 칸만, 당기기만
    setZone(s, z, 'comms', 0.6, 800, ev3, false);
    expect(endZoneBy(s, ev3, 900, 'power')).toBe(0);
    expect(endZoneBy(s, ev3, 300, 'power')).toBe(1);
    expect([s.world.zones[z].until.power, s.world.zones[z].until.comms]).toEqual([300, 800]);
    expect(endZoneBy(s, ev1, 10)).toBe(0);
    // 동네 둘에 걸친 원: 닿는 동네마다 같은 자리 — 경계 너머의 점도 같은 값을 겪는다
    const s2 = quiet(), a = DISTRICTS[0], b = DISTRICTS[1], mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
    const zs = setZoneArea(s2, 'power', 0, 600, ev1, false, { x: mx, y: my, r: 120 });
    expect(zs).toContain(0); expect(zs).toContain(1);
    for (const zz of zs) expect(s2.world.zones[zz].at!.power).toEqual({ x: mx, y: my, r: 120 });
    // 회복: 값·자리를 함께 지운다
    s2.t = 601;
    recoverWorld(s2);
    for (const zz of zs) expect([s2.world.zones[zz].power, s2.world.zones[zz].at?.power]).toEqual([1, undefined]);
  });

  it('C4 (가) 변전소 사고: 700 안 동네 전체가 꺼지고 20~40초 뒤 알려지며(한국전력 기록 · tag power), 그 범위의 구간에 꺼진 신호(얹은 혼잡 한 줄 — 원인 = 그 사고 기록) · 응급실 수용 −2 · 사건이 정전 100초 뒤 닫히면 60~120초 뒤 복구 — 얹은 혼잡이 얹기 전 값으로 돌아온다', () => {
    const s = quiet(), sub = placeOf(s, 'substation'), cx = sub.x + sub.w / 2, cy = sub.y + sub.h / 2;
    const before = s.city.edges.map((e) => e.bump ?? 0), rows0 = s.traffic.bumps.length;
    const I = bigFire(s, sub.id), ev = I.rootEvent;
    tk(s);
    const want = DISTRICTS.map((d, z) => (Math.hypot(d.x - cx, d.y - cy) <= 700 ? z : -1)).filter((z) => z >= 0);
    expect(want.length).toBeGreaterThan(0);
    for (let z = 0; z < DISTRICTS.length; z++) {
      const Z = s.world.zones[z];
      expect(Z.power, `동네 ${z}`).toBe(want.indexOf(z) >= 0 ? 0 : 1);
      if (Z.power === 0) expect([Z.cause.power, Z.known.power, Z.at?.power]).toEqual([ev, false, undefined]);
      if (Z.power === 0) expect(Z.until.power).toBeCloseTo(s.t + 600, 6);
    }
    expect(s.world.spans.map((q) => [q.f, q.cause, q.inc, q.src])).toEqual([['power', ev, I.id, 'util']]);
    const row = s.traffic.bumps.find((b) => b.id === s.world.spans[0].bump)!;
    expect([row.what, row.ev, row.inc, row.add, s.traffic.bumps.length]).toEqual([1, ev, I.id, 0.4, rows0 + 1]);
    for (const eid of row.edges) expect(midDark(s, eid)).toBe(true);
    for (const e of s.city.edges) if (row.edges.indexOf(e.id) < 0) expect(e.bump ?? 0).toBe(before[e.id]); else expect(e.bump!).toBeCloseTo(before[e.id] + 0.4, 9);
    // 병원: 그 범위의 병원은 발전기로 돈다
    const caps = s.world.hospitals.map((H, k) => HOSPITAL_CAP[Math.min(k, HOSPITAL_CAP.length - 1)] - (zoneAt(s, 'power', s.city.facilities[H.fac].x, s.city.facilities[H.fac].y) < 0.5 ? 2 : 0));
    expect(s.world.hospitals.map((H) => H.cap)).toEqual(caps);
    // 알림: 20~40초 뒤 한 줄 (그 전에는 진실만)
    const t0 = s.t;
    while (!s.events.some((e) => e.tag === 'power') && s.t < t0 + 45) tk(s);
    const tell = s.events.filter((e) => e.tag === 'power');
    expect(tell.length).toBe(1);
    expect(tell[0].t - t0).toBeGreaterThanOrEqual(20 - 1); expect(tell[0].t - t0).toBeLessThanOrEqual(40 + 1);
    expect([tell[0].actor, tell[0].kind, tell[0].causes, sysOf(tell[0])]).toEqual(['한국전력', 'hazard', [ev], 'infra']);
    expect(tell[0].text).toMatch(/일대 정전 — 신호등이 꺼졌습니다\.$/);
    for (const z of want) expect(knownZone(s, z).power).toBe(0);
    // 정전 100초 뒤에 닫는다 → 60~120초 뒤 복구
    while (s.t < t0 + 100) tk(s);
    closeIncident(s, I, 'resolved');
    const tc = s.t;
    tk(s);
    for (const z of want) { expect(s.world.zones[z].until.power).toBeGreaterThanOrEqual(tc + 60); expect(s.world.zones[z].until.power).toBeLessThanOrEqual(tc + 120 + 1); }
    while (s.world.zones[want[0]].power < 1 && s.t < tc + 130) tk(s);
    for (let z = 0; z < DISTRICTS.length; z++) expect(s.world.zones[z].power).toBe(1);
    expect(s.world.spans.filter((q) => q.f === 'power')).toEqual([]);      // (긴 정전이 넘긴 통신 장애는 전력이 돌아온 뒤 180초까지 남는다 — C8 의 시험)
    expect(s.traffic.bumps.length).toBe(rows0);
    for (const e of s.city.edges) expect(e.bump ?? 0).toBeCloseTo(before[e.id], 9);
    expect(s.world.hospitals.map((H, k) => H.cap)).toEqual(s.world.hospitals.map((_, k) => HOSPITAL_CAP[Math.min(k, HOSPITAL_CAP.length - 1)]));
    const rec = s.events.filter((e) => e.tag === 'power');
    expect(rec.length).toBe(2);
    expect(rec[1].text).toMatch(/일대 전력 복구\.$/);
    // 닫히지 않아도 600초 뒤에는 복구된다
    const s2 = quiet(), I2 = bigFire(s2, placeOf(s2, 'substation').id);
    tk(s2);
    const z2 = s2.world.zones.findIndex((Z) => Z.power === 0), u2 = s2.world.zones[z2].until.power;
    expect(u2).toBeCloseTo(s2.t + 600, 6);
    const world = (sec: number): void => { for (let k = 0; k < Math.round(sec / s2.dt); k++) { s2.tick += 1; s2.t = s2.tick * s2.dt; tickWorld(s2); } };      // 사건 생성기를 돌리지 않는다(출동 없음으로 닫히지 않게)
    world(599);
    expect(s2.world.zones[z2].power).toBe(0);
    world(3);
    expect([s2.world.zones[z2].power, s2.world.spans.filter((q) => q.f === 'power').length, I2.phase !== 'closed']).toEqual([1, 0, true]);
  });

  it('C4 (라) 끊긴 전선: 전체 붕괴 자리의 전선 문턱(자리마다 grid:line:<건물>)을 넘을 때만 국지 정전(반경 90 — 원이 닿는 동네마다 같은 자리) · 원 밖 건물은 꺼지지 않는다 · 동네 둘에 걸친 정전이 복구된 뒤 구간의 bump 가 얹기 전 값과 같다 · 문턱이 높은 자리는 끊기지 않는다', () => {
    const s = quiet();
    // 동네 둘 이상에 닿는 원을 갖는 건물 가운데 전선 문턱이 0.6(전체 붕괴의 충격) 아래인 것 / 위인 것
    const reach = (x: number, y: number, r: number): number => DISTRICTS.filter((d) => Math.hypot(d.x - x, d.y - y) <= r + d.r * 1.22).length;
    const cands = s.city.places.filter((q) => !q.open && q.facility < 0 && zoneOfPlace(s, q.id) >= 0 && reach(q.x + q.w / 2, q.y + q.h / 2, 90) >= 2);
    const low = cands.find((q) => 0.15 + 0.6 * lineU(s, q.id) < 0.6)!, high = cands.find((q) => 0.15 + 0.6 * lineU(s, q.id) >= 0.6)!;
    expect(low && high).toBeTruthy();
    const before = s.city.edges.map((e) => e.bump ?? 0);
    const I = createIncident(s, { type: 'collapse', variant: 'std', placeId: low.id, rng: s.rng.fork('t-line') });
    const ev = raiseProblem(s, I, 'STRUCT_COLLAPSE', '건물 전체 붕괴 (시험)', { role: 'SYSTEM', actor: '시험', text: '건물 전체가 무너졌습니다. (시험)' }, false);
    const x = low.x + low.w / 2, y = low.y + low.h / 2;
    signal(s, 'catastrophe', { inc: I.id, ev, size: 40, place: low.id, data: 1, mag: 1 });
    tk(s);
    const zs = s.world.zones.map((Z, z) => (Z.power === 0 ? z : -1)).filter((z) => z >= 0);
    expect(zs.length).toBeGreaterThanOrEqual(2);
    for (const z of zs) expect([s.world.zones[z].cause.power, s.world.zones[z].at!.power]).toEqual([ev, { x, y, r: 90 }]);
    expect(s.world.spans.map((q) => q.src)).toEqual(['line']);
    // 원 안의 건물만 꺼진다
    let inN = 0, outN = 0;
    for (const q of s.city.places) {
      const z = zoneOfPlace(s, q.id);
      if (zs.indexOf(z) < 0) continue;
      const d = Math.hypot(q.x + q.w / 2 - x, q.y + q.h / 2 - y);
      if (d < 85) { expect(isDark(s, q.id)).toBe(true); inN++; } else if (d > 95) { expect(isDark(s, q.id)).toBe(false); outN++; }
    }
    expect(inN).toBeGreaterThan(0); expect(outN).toBeGreaterThan(0);
    secs(s, 41);
    expect(s.events.filter((e) => e.tag === 'power').map((e) => e.text)).toEqual([`${low.addr} ${low.name} 주변 정전 — 인근 신호등이 꺼졌습니다.`]);
    closeIncident(s, I, 'resolved');
    secs(s, 125);
    expect(s.world.zones.every((Z) => Z.power === 1 && Z.at?.power === undefined)).toBe(true);
    expect(s.world.spans.filter((q) => q.f === 'power')).toEqual([]);
    for (const e of s.city.edges) expect(e.bump ?? 0).toBeCloseTo(before[e.id], 9);
    // 문턱이 높은 자리: 같은 붕괴에도 끊기지 않는다 (기록·장부·혼잡 없음)
    const s2 = quiet();
    const J = createIncident(s2, { type: 'collapse', variant: 'std', placeId: high.id, rng: s2.rng.fork('t-line') });
    const ev2 = raiseProblem(s2, J, 'STRUCT_COLLAPSE', '건물 전체 붕괴 (시험)', { role: 'SYSTEM', actor: '시험', text: '건물 전체가 무너졌습니다. (시험)' }, false);
    signal(s2, 'catastrophe', { inc: J.id, ev: ev2, size: 40, place: high.id, data: 1, mag: 1 });
    secs(s2, 45);
    expect([s2.world.zones.every((Z) => Z.power === 1), s2.world.spans.length, s2.events.some((e) => e.tag === 'power')]).toEqual([true, 0, false]);
  });

  it('C4 같은 동네의 둘째 폭발이 더 넓게 끊으면 자리를 가져가고 원인·회복 시각도 둘째의 것이다 — 첫째 사건이 닫혀도 둘째 자리의 정전은 풀리지 않는다', () => {
    const s = quiet();
    // 같은 동네의 두 건물: 둘 다 전선 문턱이 폭발의 충격(0.8 × 피해/100 × (1 − 2/(반경 + 2)))보다 낮다
    const shockOf = (size: number): number => 0.8 * 1 * (1 - 2 / (size + 2));
    const bs = s.city.places.filter((q) => !q.open && q.facility < 0 && zoneOfPlace(s, q.id) === 0 && 0.15 + 0.6 * lineU(s, q.id) < shockOf(3));
    expect(bs.length).toBeGreaterThanOrEqual(2);
    const [p1, p2] = bs;
    const blastAt = (q: Place, size: number): { I: Incident; ev: number } => {
      const I = createIncident(s, { type: 'fire', variant: 'std', placeId: q.id, rng: s.rng.fork('t-b' + q.id) });
      const ev = raiseProblem(s, I, 'EXPLOSION', '폭발 (시험)', { role: 'SYSTEM', actor: '시험', text: '폭발! (시험)' }, false);
      signal(s, 'catastrophe', { inc: I.id, ev, size, place: q.id, data: 0, mag: 100 });
      tk(s);
      return { I, ev };
    };
    const A = blastAt(p1, 3);
    expect([s.world.zones[0].cause.power, s.world.zones[0].at!.power!.r]).toEqual([A.ev, 30 + 8 * 3]);
    secs(s, 10);
    const B = blastAt(p2, 6);
    const Z = s.world.zones[0];
    expect([Z.cause.power, Z.at!.power!.r, Z.until.power]).toEqual([B.ev, 30 + 8 * 6, s.t + 600]);
    closeIncident(s, A.I, 'resolved');
    secs(s, 130);
    expect([s.world.zones[0].power, s.world.zones[0].cause.power]).toEqual([0, B.ev]);
    // 첫째 건이 모든 동네에서 자리를 잃었으면 그 줄과 얹은 혼잡은 거둬졌다
    for (const q of s.world.spans) if (q.f === 'power' && q.cause === A.ev) expect(s.world.zones.some((W) => W.cause.power === A.ev)).toBe(true);
  });

  it('C4 태풍 정전(blackout 신호): 모든 동네가 곧바로 알려진 정전이 되고 동네별 알림·복구 기록은 남기지 않는다 — 꺼진 신호는 재난이 이미 얹었다(장부 줄을 더하지 않는다) · 끝 신호에서 되돌린다', () => {
    const s = quiet(), ev = note(s, '강풍에 송전선이 끊겨 (시험)'), rows0 = s.traffic.bumps.length;
    signal(s, 'blackout', { inc: -1, ev, data: 1 });
    tk(s);
    expect(s.world.zones.every((Z) => Z.power === 0 && Z.known.power && Z.cause.power === ev)).toBe(true);
    expect(s.world.spans.map((q) => [q.src, q.bump, q.told])).toEqual([['blackout', -1, false]]);
    expect(s.traffic.bumps.length).toBe(rows0);
    secs(s, 60);
    signal(s, 'blackout', { inc: -1, ev: -1, data: 0 });
    secs(s, 2);
    expect([s.world.zones.every((Z) => Z.power === 1), s.world.spans.length]).toEqual([true, 0]);
    expect(s.events.some((e) => e.tag === 'power')).toBe(false);
  });

  it('C4 (다) 지진: 동네마다 흔들림(mag × (1 − 거리/900))이 그 동네 전력망의 문턱(grid:power:<동네>)을 넘으면 꺼진다 — 여진(0.6)은 문턱이 낮은 남은 동네만, 240초 뒤 복구', () => {
    const s = quiet(), x = DISTRICTS[0].x, y = DISTRICTS[0].y, ev = note(s, '지진 (시험)');
    const thr = (z: number): number => 0.3 + 0.5 * s.rng.fork('grid:power:' + z).next();
    const shake = (z: number, mag: number): number => mag * Math.max(0, 1 - Math.hypot(DISTRICTS[z].x - x, DISTRICTS[z].y - y) / 900);
    signal(s, 'quake', { inc: -1, ev, x, y, mag: 1 });
    tk(s);
    for (let z = 0; z < DISTRICTS.length; z++) expect(s.world.zones[z].power, `동네 ${z}`).toBe(shake(z, 1) > thr(z) ? 0 : 1);
    const ev2 = note(s, '여진 (시험)');
    signal(s, 'quake', { inc: -1, ev: ev2, x, y, mag: 0.6 });
    tk(s);
    for (let z = 0; z < DISTRICTS.length; z++) {
      const want = shake(z, 1) > thr(z) ? ev : shake(z, 0.6) > thr(z) ? ev2 : -1;
      expect(s.world.zones[z].cause.power, `동네 ${z}`).toBe(want);
    }
    secs(s, 245);
    expect(s.world.zones.every((Z) => Z.power === 1)).toBe(true);
  });

  it('분석 AI: 관제가 아는 정전 안의 교통사고·승강기 신고는 위험도 +0.3 (정전 구역) — 알려지지 않은 정전은 치지 않는다', () => {
    const s = quiet(), node = s.city.nodes.find((n) => zoneOfXY(n.x, n.y) === 0)!;
    const mk = (type: 'traffic' | 'collapse'): Incident => {
      const Q = createIncident(s, type === 'traffic' ? { type, variant: 'std', nodeId: node.id, rng: s.rng.fork('t-q' + type) } : { type, variant: 'elevator', placeId: s.city.places.find((q) => q.nodeId === node.id && !q.open)?.id, rng: s.rng.fork('t-q' + type) });
      Q.locationKnown = true; Q.reportedNode = node.id; Q.fieldType = type;
      if (type === 'collapse') Q.claims.push({ topic: 'nature', value: 'elevator', conf: 0.8, text: '', truthful: true, callId: 0, note: '' });
      return Q;
    };
    const T1 = mk('traffic'), E1 = mk('collapse');
    assess(s, T1, '시험'); assess(s, E1, '시험');
    const base = [T1.assessment!.severity, E1.assessment!.severity];
    setZone(s, 0, 'power', 0, s.t + 600, note(s, '정전 (시험)'), false);
    assess(s, T1, '시험'); assess(s, E1, '시험');
    expect([T1.assessment!.severity, E1.assessment!.severity]).toEqual(base);      // 아직 알려지지 않았다
    s.world.zones[0].known.power = true;
    assess(s, T1, '시험'); assess(s, E1, '시험');
    expect(T1.assessment!.severity).toBeCloseTo(Math.min(3, base[0] + POWER_SEV), 9);
    expect(E1.assessment!.severity).toBeCloseTo(Math.min(3, base[1] + POWER_SEV), 9);
  });

  it('L5 ② 세기를 키우고 한 동네를 끄면 — 그 동네의 4층 이상 · 그 종류 · 쓸 수 있는 건물에서만, 건물마다 한 번, 사건의 자리 = hz.target · 원인 = 정전을 만든 기록 · 부모 = 그 정전의 주인 사건 · 내력 outage(ref = 그 동네) · 한 뿌리 둘까지', () => {
    withRide(1e5, () => {
      const s = quiet(), sub = placeOf(s, 'substation'), I = bigFire(s, sub.id);
      tk(s); tk(s);      // 예약은 한 틱에 하나씩 사건이 된다
      const dark = liftPlaces(s).filter((p) => isDark(s, p));
      expect(dark.length).toBeGreaterThan(0);
      for (const id of liftPlaces(s)) { const c = hazardCell(s, 'liftStall', id); expect(c !== null, `건물 ${id}`).toBe(dark.indexOf(id) >= 0); }
      const kids = s.incidents.filter((J) => J.csq === 'liftStall');
      expect(kids.length).toBe(2);      // 한 뿌리(변전소 화재)의 법칙 사건은 둘까지 — 나머지는 'depth'
      expect(s.gen.dropped.filter((d) => d.csq === 'liftStall').every((d) => d.why === 'depth' || d.why === 'cap')).toBe(true);
      const seen = new Set<number>();
      for (const K of kids) {
        expect([K.truth.type, K.truth.variant, K.truth.placeId, K.parent, K.cause, K.hz!.law, K.hz!.src[0].what]).toEqual(['collapse', 'elevator', K.hz!.target, I.id, I.rootEvent, 'liftStall', 'outage']);
        expect(dark).toContain(K.hz!.target);
        expect(K.hz!.src[0].ref).toBe(zoneOfPlace(s, K.hz!.target));
        expect(seen.has(K.hz!.target)).toBe(false); seen.add(K.hz!.target);
        expect(s.events[K.rootEvent].causes).toContain(I.rootEvent);
      }
      // 다시 꺼져도(같은 건물) 다시 받지 않는다 — 건물마다 한 번
      for (const id of dark) expect(hazardCell(s, 'liftStall', id)!.done).toBe(true);
      expect(s.world.hz.holes).toBe(0);
    });
  });

  it('L5 ③ 개입: 같은 시드에서 정전을 걸지 않은 쪽(같은 변전소 화재 — 큰 불 신호만 없다)에는 승강기 칸도 사건도 없다 · ④ 문턱은 누가 껐는지와 무관하다(변전소 정전과 태풍 정전의 같은 건물 thr 이 같다) · ① 정전이 없는 교대에는 칸이 없다', () => {
    const A = quiet(), B = quiet(), C = quiet();
    bigFire(A, placeOf(A, 'substation').id);
    createIncident(B, { type: 'fire', variant: 'std', placeId: placeOf(B, 'substation').id, rng: B.rng.fork('t-util') });
    signal(C, 'blackout', { inc: -1, ev: note(C, '태풍 정전 (시험)'), data: 1 });
    tk(A); tk(B); tk(C);
    expect(B.world.hz.cells.liftStall).toBeUndefined();
    expect(B.incidents.some((J) => J.csq === 'liftStall')).toBe(false);
    const both = liftPlaces(A).filter((id) => hazardCell(A, 'liftStall', id) && hazardCell(C, 'liftStall', id));
    expect(both.length).toBeGreaterThan(0);
    for (const id of both) { expect(hazardCell(A, 'liftStall', id)!.thr).toBe(hazardCell(C, 'liftStall', id)!.thr); expect(hazardCell(A, 'liftStall', id)!.u2).toBe(hazardCell(C, 'liftStall', id)!.u2); }
    // 정전이 없는 실제 교대 (보통 S1 — 정전 기록이 없는 교대)
    const S = new Sim('S1', NORMAL, 1200);
    S.runToEnd();
    expect(S.events.some((e) => e.tag === 'power')).toBe(false);
    expect(S.world.hz.cells.liftStall).toBeUndefined();
  });

  it('L5 ⑤ 쓸 수 없는 건물(전소)은 정전이 닿아도 칸도 사건도 없다 · 사건 중인 건물은 기다리다 그 사건이 닫힌 다음 1초에 난다', () => {
    withRide(1e5, () => {
      const s = quiet(), ev = note(s, '태풍 정전 (시험)'), lp = liftPlaces(s);
      const burnt = lp[0], busy = lp[1];
      s.placeMarks.set(burnt, { placeId: burnt, state: 'burnt', t: s.t, incidentId: 0, burnFrac: 1, ruinFrac: 0 });
      const J = createIncident(s, { type: 'medical', variant: 'std', placeId: busy, rng: s.rng.fork('t-busy') });
      expect(J.truth.placeId).toBe(busy);
      darkened(s, [burnt, busy], { rate: 0, ev, inc: -1, what: 'outage', ref: -1 });
      tickIncidents(s);
      expect(hazardCell(s, 'liftStall', burnt)).toBe(null);
      expect(hazardCell(s, 'liftStall', busy)!.done).toBe(true);
      expect(s.world.hz.waiting.map((w) => [w.law, w.target])).toEqual([['liftStall', busy]]);
      secs(s, 5);
      expect(s.incidents.some((K) => K.csq === 'liftStall')).toBe(false);
      closeIncident(s, J, 'resolved');
      secs(s, 1.2);
      const K = s.incidents.find((X) => X.csq === 'liftStall')!;
      expect([K.truth.placeId, K.parent, K.cause]).toEqual([busy, undefined, ev]);
    });
  });

  it('C8 방송국 사고: 800 안 동네의 통신 0.4 (곧바로 알려진 기록 한 줄) → 그 범위의 열린 현장에 무전 음영 덩어리(원래 음영이 아니던 바닥 칸만 · s.shadowAdd) → 사건이 닫히고 180초 뒤 복구 — 더한 칸만 되돌린다. 더한 음영에서 보고가 끊기면 INFRA_FAIL 한 줄', () => {
    const s = quiet(), bc = placeOf(s, 'broadcast'), I = bigFire(s, bc.id), sc = s.scenes[I.id]!;
    const shadow0 = Array.from(sc.shadow);
    tk(s);
    const zs = s.world.zones.map((Z, z) => (Z.comms < 1 ? z : -1)).filter((z) => z >= 0);
    expect(zs.length).toBeGreaterThan(0);
    for (const z of zs) expect([s.world.zones[z].comms, s.world.zones[z].known.comms, s.world.zones[z].cause.comms]).toEqual([0.4, true, I.rootEvent]);
    const rec = s.events.filter((e) => e.tag === 'comms');
    expect(rec.length).toBe(1);
    expect([rec[0].actor, rec[0].causes, sysOf(rec[0])]).toEqual(['통신사', [I.rootEvent], 'infra']);
    expect(rec[0].text).toMatch(/가온방송국 사고로 .+ 일대 통신 장애 — 무전이 끊기는 곳이 늘었습니다\.$/);
    secs(s, 1.2);
    expect(sc.shadowAdd && sc.shadowAdd.length).toBeGreaterThan(0);
    for (const i of sc.shadowAdd!) { expect(shadow0[i]).toBe(0); expect(sc.shadow[i]).toBe(1); }
    let floor = 0; for (let i = 0; i < sc.tiles.length; i++) if ([TILE.FLOOR, TILE.GROUND, TILE.ROAD, TILE.TRAIL].indexOf(sc.tiles[i] as never) >= 0 && !shadow0[i]) floor++;
    expect(sc.shadowAdd!.length).toBeLessThanOrEqual(Math.round(0.6 * 0.3 * floor));
    // 더한 음영의 칸에 선 대원의 보고가 끊긴다 → INFRA_FAIL (원인 = 그 COMM_FAIL · 통신 장애의 원인 기록), 한 사건에 한 줄
    const rid = s.responders[0].id, tile = sc.shadowAdd![0];
    const a = makeAgent(s, rid, s.responders[0].unitId, tile % sc.w + 0.5, ((tile / sc.w) | 0) + 0.5, s.t, s.rng.fork('t-agent'));
    sc.agents.push(a);
    const cf = raiseProblem(s, I, 'COMM_FAIL', '시험: 무전 음영 구역에서 보고 전달 실패', { role: 'RESPONDER', actor: '시험', rid, imp: 2, text: '무전 응답 없음. (시험)' }, false);
    secs(s, 1.2);
    const inf = I.problems.filter((p) => p.code === 'INFRA_FAIL');
    expect(inf.length).toBe(1);
    expect(s.events[inf[0].eventId].causes).toEqual([cf, I.rootEvent]);
    expect(inf[0].detail).toMatch(/통신 장애\(방송·관제 시설 사고\)로 무전 음영이 늘어 보고가 끊겼습니다$/);
    raiseProblem(s, I, 'COMM_FAIL', '시험 2', { role: 'RESPONDER', actor: '시험', rid, imp: 2, text: '무전 응답 없음. (시험 2)' }, false);
    secs(s, 1.2);
    expect(I.problems.filter((p) => p.code === 'INFRA_FAIL').length).toBe(1);
    // 닫힌 뒤 180초: 통신 복구 · 더한 칸만 되돌린다
    sc.agents.length = 0;
    closeIncident(s, I, 'resolved');
    const tc = s.t;
    secs(s, 182);
    expect(s.world.zones.every((Z) => Z.comms === 1)).toBe(true);
    expect(s.t - tc).toBeGreaterThanOrEqual(180);
    expect([sc.shadowAdd, Array.from(sc.shadow)]).toEqual([undefined, shadow0]);
    expect(s.events.filter((e) => e.tag === 'comms').map((e) => e.text).pop()).toMatch(/일대 통신 복구\.$/);
  });

  it('C8 (나) 긴 정전: 변전소 정전이 100초 이어지면 그 범위의 통신 0.6 — 알려지지 않은 채(기록 없음), 전력이 돌아오면 180초 뒤 풀린다 · 상한 3건', () => {
    const s = quiet(), I = bigFire(s, placeOf(s, 'substation').id);
    tk(s);
    const zs = s.world.zones.map((Z, z) => (Z.power === 0 ? z : -1)).filter((z) => z >= 0);
    secs(s, 99);
    expect(s.world.zones.every((Z) => Z.comms === 1)).toBe(true);
    secs(s, 2);
    for (const z of zs) expect([s.world.zones[z].comms, s.world.zones[z].known.comms, s.world.zones[z].cause.comms]).toEqual([0.6, false, I.rootEvent]);
    expect(s.events.some((e) => e.tag === 'comms')).toBe(false);
    closeIncident(s, I, 'resolved');
    let tp = -1;
    for (let k = 0; k < 5 * 400 && s.world.zones[zs[0]].comms < 1; k++) { tk(s); if (tp < 0 && s.world.zones[zs[0]].power === 1) tp = s.t; }
    expect(tp).toBeGreaterThan(0);
    expect(s.t - tp).toBeGreaterThanOrEqual(180 - 1); expect(s.t - tp).toBeLessThanOrEqual(181);
    expect(s.world.spans).toEqual([]);
  });

  it('실제 교대 (태풍 S0): 동네별 정전 기록이 없고, 통신 장애 알림은 한 줄, INFRA_FAIL 마다 원인에 그 사건의 COMM_FAIL 과 태풍 정전 기록 · 교대 끝에 동네 값·장부·얹은 혼잡이 남지 않는다', () => {
    const s = new Sim('S0', { ...NORMAL, disaster: parseDisaster('typhoon')! }, 1200);
    s.runToEnd();
    expect(s.events.some((e) => e.tag === 'power')).toBe(false);
    const dark = s.events.find((e) => /^강풍에 송전선이 끊겨/.test(e.text))!;
    const com = s.events.filter((e) => e.tag === 'comms');
    expect(com.filter((e) => /통신 기지국 예비 전원이 떨어졌습니다/.test(e.text)).map((e) => e.causes)).toEqual([[dark.id]]);
    let inf = 0;
    for (const I of s.incidents) {
      const ps = I.problems.filter((p) => p.code === 'INFRA_FAIL');
      expect(ps.length).toBeLessThanOrEqual(1);
      for (const p of ps) {
        inf++;
        const cs = s.events[p.eventId].causes;
        expect(cs).toContain(dark.id);
        expect(cs.some((c) => s.events[c].problem === 'COMM_FAIL' && s.events[c].incidentId === I.id)).toBe(true);
      }
    }
    expect(inf).toBeGreaterThan(0);
    expect(s.world.zones.every((Z) => Z.power === 1 && Z.comms === 1)).toBe(true);
    expect(s.world.spans).toEqual([]);
    expect(s.traffic.bumps).toEqual([]);
    for (const e of s.city.edges) expect(e.bump ?? 0).toBe(0);
    for (const I of s.incidents) expect(s.scenes[I.id]?.shadowAdd).toBeUndefined();
  });
});

describe('I1-b b3-11 · b3-12: C5 연기 · L4 연기를 마신 주민 · L6 수위가 문턱을 넘으면 잠긴다', () => {
  const lawOf = (id: string): HazardLaw => hazardLaws().find((l) => l.id === id)!;
  const ruleOf = (id: string) => consequences().find((c) => c.id === id)!;
  /** 한 틱 — 쌓인 신호를 처리하고, 1초 블록이면 상태 규칙·초과 위험·회복까지 (tickWorld 하나) — 그 뒤 예약을 사건으로 */
  function tk(s: Sim): void { s.tick += 1; s.t = s.tick * s.dt; tickWorld(s); tickIncidents(s); }
  function secs(s: Sim, sec: number): void { const n = Math.round(sec / s.dt); for (let k = 0; k < n; k++) tk(s); }
  const isRes = (s: Sim, q: Place): boolean => !q.open && q.facility < 0 && smokeBase(s, q.kind) > 0;
  /** 연기 원(반경 367 — 불 칸 40) 안의 주거 건물이 가장 많은 아파트 (시드와 무관한 도시의 생김새) */
  function smokyApt(s: Sim): Place {
    let best: Place | null = null, bn = -1;
    for (const q of s.city.places) {
      if (q.kind !== 'apartment' || !isRes(s, q)) continue;
      const cx = q.x + q.w / 2, cy = q.y + q.h / 2;
      let n = 0;
      for (const p of s.city.places) if (p.id !== q.id && isRes(s, p) && Math.hypot(p.x + p.w / 2 - cx, p.y + p.h / 2 - cy) < 367) n++;
      if (n > bn) { bn = n; best = q; }
    }
    return best!;
  }
  /** 그 현장의 불 칸을 손으로 정한다 (바닥 칸 n 개에 불 1 · 다른 칸 0 — tickScene 을 돌리지 않으므로 그대로 남는다) */
  function burnCells(sc: Scene, n: number): void {
    sc.fire.fill(0);
    let k = 0;
    for (let i = 0; i < sc.fire.length && k < n; i++) if (sc.tiles[i] === TILE.FLOOR) { sc.fire[i] = 1; k++; }
    sc.burning = n;
  }
  function fireAt(s: Sim, q: Place, n: number): { I: Incident; sc: Scene } {
    const I = createIncident(s, { type: 'fire', variant: 'std', placeId: q.id, rng: s.rng.fork('t-smoke') });
    const sc = s.scenes[I.id]!;
    burnCells(sc, n);
    return { I, sc };
  }
  const smokeRows = (s: Sim) => s.world.spans.filter((q) => q.f === 'smoke');
  const withRR = <R>(mul: number, fn: () => R): R => { const r0 = ILL.RR; ILL.RR = r0 * mul; try { return fn(); } finally { ILL.RR = r0; } };
  const floodSim = (seed = 'S7'): Sim => {
    const s = new Sim(seed, { ...NORMAL, disaster: parseDisaster('flood')! }, 1200);
    s.gen.nextAt = s.gen.majorAt = Infinity; s.gen.nextNuisanceAt = Infinity; s.traffic.nextEvent = Infinity;
    return s;
  };
  const sillHand = (s: Sim, id: number, base: number): number => base * (FLOOD.LO + FLOOD.SPAN * s.rng.fork('hz:floodLow:b' + id).next());
  const WET_TEXT = /지하가 물에 잠겨 전기가 끊겼습니다\.$/;
  let s0: Sim | null = null;
  /** 보통 S0 — 연기도 홍수도 없는 실제 교대 (L4 ① · L6 ① 이 함께 쓴다 — 고치지 않는다) */
  const normalS0 = (): Sim => { if (!s0) { s0 = new Sim('S0', NORMAL, 1200); s0.runToEnd(); } return s0; };

  it('등록과 크기: 법칙 모음의 끝에 smoke(smokeIll — 1초 · 건물마다 몇 번이고 · 상한 3), 상태 규칙은 commsDown.shadow 다음에 smokePlume → floodLow(쿨다운 5초 · 사건 없음) · 실외 노출은 현장 규칙에서 상공의 헬기 앞', () => {
    expect(hazardLaws().map((l) => l.id)).toEqual(['roadCrash', 'heatSpread', 'structFail', 'pipeLeak', 'rekindle', 'liftStall', 'smokeIll']);
    const L = lawOf('smokeIll');
    expect([L.every, L.once, L.cap, L.hold, L.label, typeof L.scan]).toEqual([1, false, 3, undefined, '연기를 마신 주민', 'function']);
    expect(SMOKE_ILL).toEqual({ CAP: 3 });
    expect(readFileSync('src/sim/world/laws/index.ts', 'utf8')).toMatch(/^import '\.\/power';[^\n]*\nimport '\.\/smoke';/m);
    const ids = consequences().map((c) => c.id);
    expect(ids.slice(ids.indexOf('commsDown.shadow'))).toEqual(['commsDown.shadow', 'smokePlume', 'floodLow']);
    const P = ruleOf('smokePlume'), F = ruleOf('floodLow');
    expect([P.on, P.cooldown, P.spawns, P.silent, typeof P.recover]).toEqual(['tick', 0, false, true, 'function']);
    expect([F.on, F.cooldown, F.spawns, F.silent]).toEqual(['tick', 5, false, true]);
    expect(SMOKE).toEqual({ HOLD: 45, AFTER: 120, R: 450, V: 0.6, FULL: 60, STEP: 10, WILD_PAD: 300, WILD_V: 0.7, WILD_MOVE: 60, WILD_GROW: 30, BUMP: 0.2 });
    expect(ILL).toEqual({ RR: 40, MED_PER_SHIFT: 1.867, SPAN: 1050, MAX: 40 });
    expect(FLOOD).toEqual({ DIV: 80, MIN: 0.3, LO: 0.85, SPAN: 0.3, TOP: 1.15 });
    expect(SMOKE_OUT).toBe(0.08);
    const kr = SCENE_RULES.indexOf(smokeOutdoor);
    expect(kr).toBeGreaterThanOrEqual(0);
    expect(kr).toBeLessThan(SCENE_RULES.indexOf(methodsRule));      // 대응 방법의 규칙이 세계 규칙의 맨 끝이다 (methods 시험)
    expect(readFileSync('src/sim/field/scenes/index.ts', 'utf8')).toMatch(/^import '\.\.\/rules\/smoke';[^\n]*\nimport '\.\.\/rules\/air';/m);
    // 법칙 파일의 글자: 원인을 모른다(산불·화재·재난을 읽지 않는다) — 식은 expo 에서
    const src = readFileSync('src/sim/world/laws/smoke.ts', 'utf8').split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*\*)/.test(l)).join('\n');
    for (const w of ['disaster', 'wildfire', 'variant ===', 'truth.type', 'scenes', 'fire[']) expect(src.includes(w), `smoke.ts 에 ${w}`).toBe(false);
  });

  it('C5 크게 이어지는 불: 불 칸 30 이상이 45초 이어지면 연기 자리(반경 450 × √(n/60) · 세기 0.6 × n/60 — 10칸 단위) · 처음 한 번 알림(원인 = 그 불을 만든 기록) · 그 자리 안 구간의 시야 혼잡(장부 what 2 — 한 줄) · 커지면 다시 놓고 · 사건이 닫히고 120초 뒤 걷히면 혼잡이 얹기 전 값으로 돌아온다', () => {
    withLaws([], () => {
      const s = quiet(), q = smokyApt(s), before = s.city.edges.map((e) => e.bump ?? 0);
      const { I, sc } = fireAt(s, q, 40);
      expect(FIRE_BIG).toBe(30);
      secs(s, 40);
      expect(smokeRows(s)).toEqual([]);
      expect(s.events.some((e) => e.tag === 'smoke')).toBe(false);
      secs(s, 8);
      const al = s.events.filter((e) => e.tag === 'smoke');
      expect(al.length).toBe(1);
      expect([al[0].actor, al[0].causes, al[0].t >= 45 && al[0].t <= 47]).toEqual(['재난안전본부', [fireCauseEv(I)], true]);
      expect(al[0].text.startsWith(`${q.addr} ${q.name} 화재의 연기가 `)).toBe(true);
      expect(al[0].text.endsWith('번지고 있습니다. 창문을 닫아 주십시오.')).toBe(true);
      const r1 = Math.round(450 * Math.sqrt(40 / 60));
      const sp = smokeRows(s);
      expect(sp.length).toBe(1);
      expect([sp[0].cause, sp[0].inc, sp[0].ref, sp[0].src, sp[0].v, sp[0].at]).toEqual([al[0].id, I.id, q.id, 'fire', 0.4, { x: I.truth.x, y: I.truth.y, r: r1 }]);
      const own = s.world.zones.map((Z, z) => (Z.cause.smoke === al[0].id ? z : -1)).filter((z) => z >= 0);
      expect(own.length).toBeGreaterThan(0);
      for (const z of own) { const Z = s.world.zones[z]; expect([Z.smoke, Z.known.smoke, Z.at!.smoke]).toEqual([0.4, true, { x: I.truth.x, y: I.truth.y, r: r1 }]); }
      expect(zoneAt(s, 'smoke', I.truth.x, I.truth.y)).toBe(0.4);
      expect(zoneAt(s, 'smoke', I.truth.x + r1 + 30, I.truth.y)).toBe(ZONE_DEFAULT.smoke);
      const row = s.traffic.bumps.find((b) => b.id === sp[0].bump)!;
      expect([row.what, row.ev, row.inc]).toEqual([2, al[0].id, I.id]);
      expect(row.add).toBeCloseTo(0.2 * 0.4, 12);
      expect(row.edges.length).toBeGreaterThan(0);
      for (const e of s.city.edges) expect(e.bump ?? 0, `구간 ${e.id}`).toBeCloseTo(before[e.id] + (row.edges.indexOf(e.id) >= 0 ? 0.08 : 0), 12);
      for (const id of row.edges) { const e = s.city.edges[id], A = s.city.nodes[e.a], B = s.city.nodes[e.b]; expect(Math.hypot((A.x + B.x) / 2 - I.truth.x, (A.y + B.y) / 2 - I.truth.y)).toBeLessThanOrEqual(r1); }
      // 불이 커지면(60칸) 자리를 다시 놓는다 — 동네 값·장부 줄·얹은 혼잡을 새로 (알림은 되풀이하지 않는다)
      burnCells(sc, 60);
      secs(s, 1);
      const sp2 = smokeRows(s);
      expect([sp2.length, sp2[0].cause, sp2[0].v, sp2[0].at!.r]).toEqual([1, al[0].id, 0.6, 450]);
      expect(s.traffic.bumps.find((b) => b.id === sp[0].bump)).toBeUndefined();
      const row2 = s.traffic.bumps.find((b) => b.id === sp2[0].bump)!;
      expect(row2.add).toBeCloseTo(0.12, 12);
      for (const e of s.city.edges) expect(e.bump ?? 0).toBeCloseTo(before[e.id] + (row2.edges.indexOf(e.id) >= 0 ? 0.12 : 0), 12);
      expect(s.events.filter((e) => e.tag === 'smoke').length).toBe(1);
      // 불이 이어지는 동안은 걷히지 않는다 · 사건이 닫히면 120초 뒤 걷힌다 — 기록 없이
      secs(s, 200);
      expect(smokeRows(s).length).toBe(1);
      const n0 = s.events.length;
      closeIncident(s, I, 'resolved');
      secs(s, 117);
      expect(smokeRows(s).length).toBe(1);
      secs(s, 5);
      expect(smokeRows(s)).toEqual([]);
      expect(s.world.zones.every((Z) => Z.smoke === ZONE_DEFAULT.smoke && Z.at?.smoke === undefined)).toBe(true);
      expect(s.traffic.bumps.filter((b) => b.what === 2)).toEqual([]);
      for (const e of s.city.edges) expect(e.bump ?? 0).toBeCloseTo(before[e.id], 12);
      expect(s.events.slice(n0).some((e) => e.tag === 'smoke')).toBe(false);
    });
  });

  it('C5 작은 불(불 칸 30 아래)이나 짧게 큰 불(45초 안에 줄어듦)은 연기 자리를 만들지 않는다', () => {
    withLaws([], () => {
      const s = quiet(), q = smokyApt(s);
      const { sc } = fireAt(s, q, 25);
      secs(s, 120);
      expect(smokeRows(s)).toEqual([]);
      burnCells(sc, 50); secs(s, 30); burnCells(sc, 20); secs(s, 2); burnCells(sc, 50); secs(s, 30);
      expect(smokeRows(s)).toEqual([]);
      expect(s.events.some((e) => e.tag === 'smoke')).toBe(false);
    });
  });

  it('C5 산불(실제 교대 산불 S1): 불머리 + 300 의 원 · 세기 0.7 · 원인 = 재난 알림 · 불이 난 건물 없음 — 교대 끝에는 연기 줄·연기 장부 줄이 남지 않고 얹은 혼잡이 장부와 맞는다', () => {
    const s = new Sim('S1', { ...NORMAL, disaster: parseDisaster('wildfire')! }, 1200);
    let first: (typeof s.world.spans)[number] | null = null, fr: { x: number; y: number; r: number } | null = null, bumpAdd = -1, drift = 0;
    while (!s.ended && s.tick < 20000) {
      s.step();
      if (s.tick % 5) continue;
      const w = s.world.spans.find((q) => q.f === 'smoke' && q.src === 'wild');
      if (w && !first) { first = { ...w, at: { ...w.at! } }; const d = s.disaster!; fr = d.front ? { x: d.front.x, y: d.front.y, r: d.front.r } : null; const b = s.traffic.bumps.find((r) => r.id === w.bump); bumpAdd = b ? b.add : -1; }
      const sum = new Float64Array(s.city.edges.length);
      for (const r of s.traffic.bumps) for (const id of r.edges) sum[id] += r.add;
      for (const e of s.city.edges) drift = Math.max(drift, Math.abs((e.bump ?? 0) - sum[e.id]));
    }
    expect(first).not.toBeNull();
    expect([first!.inc, first!.ref, first!.v]).toEqual([-1, -1, 0.7]);
    expect(fr).not.toBeNull();
    // 자리는 그 순간의 불머리(반지름 + 300) — 불머리는 같은 1초 안에도 움직이므로 다시 놓는 문턱(60 · 30) 안에서 본다
    expect(Math.abs(first!.at!.r - Math.round(fr!.r + SMOKE.WILD_PAD))).toBeLessThan(SMOKE.WILD_GROW);
    expect(Math.hypot(first!.at!.x - fr!.x, first!.at!.y - fr!.y)).toBeLessThan(SMOKE.WILD_MOVE);
    if (bumpAdd >= 0) expect(bumpAdd).toBeCloseTo(0.14, 12);
    const al = s.events[first!.cause];
    expect([al.tag, al.actor]).toEqual(['smoke', '재난안전본부']);
    expect(al.text).toMatch(/산불의 연기가 .+ 번지고 있습니다/);
    expect(al.causes.length).toBe(1);
    expect(s.events[al.causes[0]].role).toBe('SYSTEM');
    expect(smokeRows(s)).toEqual([]);
    expect(s.traffic.bumps.filter((b) => b.what === 2)).toEqual([]);
    expect(drift).toBeLessThan(1e-9);
  });

  it('C5 실외 노출: 연기 자리 안의 바깥 현장(수색 — 실외 노출을 받는 구조 대상)은 초당 0.08 × 그 자리의 세기만큼 더 깎인다(원인 연기 흡입) — 자리 밖·건물 안 현장·연기 줄이 없을 때는 없다', () => {
    withLaws([], () => {
      const s = quiet(), fk = INCIDENT_PLACES.fire as Record<string, number | undefined>;
      const outdoor = s.city.places.filter((p) => p.kind === 'park' || p.kind === 'forest' || p.kind === 'campsite');
      let best: { pk: Place; b: Place; d: number } | null = null;
      for (const pk of outdoor) for (const b of s.city.places) {
        if (b.open || b.facility >= 0 || !(fk[b.kind] ?? 0)) continue;
        const d = Math.hypot(b.x + b.w / 2 - pk.x - pk.w / 2, b.y + b.h / 2 - pk.y - pk.h / 2);
        if (!best || d < best.d) best = { pk, b, d };
      }
      expect(best!.d).toBeLessThan(300);
      const { I: F } = fireAt(s, best!.b, 60);
      secs(s, 47);
      const sp = smokeRows(s)[0];
      expect(sp).toBeDefined();
      const A = createIncident(s, { type: 'search', placeId: best!.pk.id, rng: s.rng.fork('t-out-a') });
      const far = outdoor.find((p) => zoneAt(s, 'smoke', p.x + p.w / 2, p.y + p.h / 2) === 0 && Math.hypot(p.x + p.w / 2 - sp.at!.x, p.y + p.h / 2 - sp.at!.y) > sp.at!.r + 300)!;
      const B = createIncident(s, { type: 'search', placeId: far.id, rng: s.rng.fork('t-out-b') });
      const sa = s.scenes[A.id]!, sb = s.scenes[B.id]!;
      expect(TYPE_DEFS[sa.kind].outdoor).toBe(true);
      const v = zoneAt(s, 'smoke', A.truth.x, A.truth.y);
      expect(v).toBeGreaterThan(0);
      expect(zoneAt(s, 'smoke', B.truth.x, B.truth.y)).toBe(0);
      const tg = (sc: Scene) => sc.casualties.filter((c) => !c.dead && (c.where === 'scene' || c.where === 'carried') && !isIndoor(sc.tiles[tileOf(sc, c.x, c.y)]));
      expect(tg(sa).length).toBeGreaterThan(0);
      const ha = tg(sa).map((c) => c.health), hb = sb.casualties.map((c) => c.health);
      smokeOutdoor(s, sa, A); smokeOutdoor(s, sb, B);
      tg(sa).forEach((c, k) => { expect(c.health).toBeCloseTo(ha[k] - SMOKE_OUT * v * s.dt, 12); expect((c.injuries ?? []).some((j) => j.cause === 'smoke')).toBe(true); });
      expect(sb.casualties.map((c) => c.health)).toEqual(hb);
      // 건물 안의 현장(불이 난 그 건물)은 실외가 아니다
      const sf = s.scenes[F.id]!, hf = sf.casualties.map((c) => c.health);
      smokeOutdoor(s, sf, F);
      expect(sf.casualties.map((c) => c.health)).toEqual(hf);
      // 연기 줄이 없으면 첫 줄에서 돌아간다
      s.world.spans = s.world.spans.filter((x) => x.f !== 'smoke');
      const h2 = tg(sa).map((c) => c.health);
      smokeOutdoor(s, sa, A);
      expect(tg(sa).map((c) => c.health)).toEqual(h2);
    });
  });

  it('L4 ① 연기가 없으면 칸이 없다: 연기 없는 실제 교대(보통 S0) · 큰 불이 없는 화재 현장 — 연기 줄이 없으면 대상도 칸도 없다', () => {
    const s = normalS0();
    expect(s.events.some((e) => e.tag === 'smoke')).toBe(false);
    expect(s.world.hz.cells.smokeIll).toBeUndefined();
    expect(s.incidents.some((I) => I.truth.type === 'medical' && I.truth.variant === 'smoke')).toBe(false);
    const q = quiet(), A = smokyApt(q);
    withRR(1e6, () => { fireAt(q, A, 25); secs(q, 120); });
    expect(q.world.hz.cells.smokeIll).toBeUndefined();
    let n = 0;
    smokeExposure(q, () => { n++; });
    expect(n).toBe(0);
  });

  it('L4 ② 평소 응급률 base_p: 응급의 장소 표에서 손으로 셈한 값 — 종류마다 MED_PER_SHIFT × 몫/합 ÷ 그 종류의 건물 수 ÷ 1050, 모든 건물의 합은 MED_PER_SHIFT ÷ 1050 (설계서의 값 × 1.867/2.1)', () => {
    const s = quiet(), table = INCIDENT_PLACES.medical as Record<string, number>;
    const sum = Object.values(table).reduce((a, b) => a + (b ?? 0), 0);
    let total = 0;
    for (const k of Object.keys(table)) {
      const n = s.city.places.filter((q) => q.kind === k && q.facility < 0).length;
      const want = n > 0 ? (1.867 * (table[k] / sum)) / n / 1050 : 0;
      expect(smokeBase(s, k as Place['kind']), k).toBeCloseTo(want, 15);
      total += want * n;
    }
    expect(total).toBeCloseTo(1.867 / 1050, 12);
    let all = 0;
    for (const q of s.city.places) if (q.facility < 0) all += smokeBase(s, q.kind);
    expect(all).toBeCloseTo(1.867 / 1050, 12);
    const scale = 1.867 / 2.1;      // 설계서의 값(조사 때의 어림 2.1)
    for (const [k, v] of [['apartment', 8.3e-6], ['houseL', 4.8e-6], ['officetel', 4.7e-6], ['villa', 4.5e-6], ['houseS', 1.9e-6]] as const) expect(Math.abs(smokeBase(s, k) / (v * scale) - 1), k).toBeLessThan(0.05);
    expect(smokeBase(s, 'office')).toBe(0);
  });

  it('L4 ③ 개입: 같은 시드에 같은 큰 불 — 한쪽만 구역의 연기를 0 으로 묶어 두면(장부 줄은 남는다) 연기 환자가 없다. 다른 쪽의 환자는 연기 속 그 건물(hz.target)에 나고, 원인 = 연기 알림 · 부모 = 그 화재 · 내력 smoke(ref = 불난 건물) · 한 뿌리 둘까지', () => {
    withRR(1e4, () => {
      const A = quiet(), qa = smokyApt(A), fa = fireAt(A, qa, 60);
      secs(A, 70);
      const kids = A.incidents.filter((J) => J.csq === 'smokeIll');
      expect(kids.length).toBe(2);
      const al = A.events.find((e) => e.tag === 'smoke')!;
      const tg = new Set(smokeTargets(A, smokeRows(A)[0]).map((t) => t.id));
      for (const K of kids) {
        expect([K.truth.type, K.truth.variant, K.truth.placeId, K.parent, K.cause, K.hz!.law, K.hz!.src[0].what, K.hz!.src[0].ref, K.hz!.src[0].ev]).toEqual(['medical', 'smoke', K.hz!.target, fa.I.id, al.id, 'smokeIll', 'smoke', qa.id, al.id]);
        expect(tg.has(K.hz!.target)).toBe(true);
        expect(K.truth.severity).toBe(1);
        expect(A.events[K.rootEvent].causes).toContain(al.id);
      }
      expect(A.gen.dropped.filter((d) => d.csq === 'smokeIll').every((d) => d.why === 'depth' || d.why === 'cap')).toBe(true);
      // 개입 쪽: smokePlume 다음에 도는 시험 규칙이 구역의 연기를 매초 0 으로 되돌린다 (법칙은 그 다음에 돈다)
      const off = registerConsequence({
        id: 't-nosmoke' as never, label: '시험 — 연기를 지운다', on: 'tick', key: () => 'x', cooldown: 0, cap: Infinity, spawns: false, silent: true, test: () => true,
        apply: (c) => { for (const Z of c.sim.world.zones) if (Z.smoke !== ZONE_DEFAULT.smoke) Z.smoke = ZONE_DEFAULT.smoke; },
      });
      try {
        const B = quiet(), qb = smokyApt(B);
        fireAt(B, qb, 60);
        secs(B, 70);
        expect(B.events.some((e) => e.tag === 'smoke')).toBe(true);      // 원인(불)과 상태 규칙은 그대로다
        expect(B.incidents.filter((J) => J.csq === 'smokeIll')).toEqual([]);
        const cells = B.world.hz.cells.smokeIll ?? {};
        for (const c of Object.values(cells)) expect(c.H).toBe(0);
      } finally { off(); }
    });
  });

  it('L4 ④ 연기 자리 밖의 건물은 쌓이지 않는다 · ⑤ 불이 난 그 건물·열린 사건이 있는 건물·쓸 수 없는 건물은 대상이 아니다 — 대상 목록은 가까운 순 40채이고 자리·반경이 바뀔 때만 다시 만든다', () => {
    withRR(1e-3, () => {
      const s = quiet(), q = smokyApt(s);
      fireAt(s, q, 40);
      secs(s, 47);
      const sp = smokeRows(s)[0], at = sp.at!;
      const list = smokeTargets(s, sp);
      expect(list.length).toBe(ILL.MAX);
      expect(smokeTargets(s, sp)).toBe(list);      // 같은 자리면 다시 만들지 않는다
      for (let k = 1; k < list.length; k++) expect(list[k].d >= list[k - 1].d).toBe(true);
      for (const t of list) { const p = s.city.places[t.id]; expect(isRes(s, p)).toBe(true); expect(t.id).not.toBe(q.id); expect(Math.hypot(p.x + p.w / 2 - at.x, p.y + p.h / 2 - at.y)).toBeCloseTo(t.d, 9); expect(t.d).toBeLessThan(at.r); }
      // 쓸 수 없는 건물 · 열린 사건이 있는 건물
      const burnt = list[0].id, busy = list[1].id;
      s.placeMarks.set(burnt, { placeId: burnt, state: 'burnt', t: s.t, incidentId: -1, burnFrac: 1, ruinFrac: 0 });
      createIncident(s, { type: 'medical', variant: 'faint', placeId: busy, rng: s.rng.fork('t-busy') });
      const c0 = s.world.hz.cells.smokeIll ?? {}, H0: Record<string, number> = {};
      for (const [k, c] of Object.entries(c0)) H0[k] = c.H;
      secs(s, 20);
      const cells = s.world.hz.cells.smokeIll!;
      const inList = new Set(list.map((t) => t.id));
      for (const k of Object.keys(cells)) expect(inList.has(+k), `건물 ${k} 은 대상 목록 밖`).toBe(true);
      expect(cells[q.id]).toBeUndefined();
      expect(cells[burnt]?.H ?? 0).toBeCloseTo(H0[burnt] ?? 0, 15);
      expect(cells[busy]?.H ?? 0).toBeCloseTo(H0[busy] ?? 0, 15);
      const grow = list.slice(2).filter((t) => (cells[t.id]?.H ?? 0) > (H0[t.id] ?? 0));
      expect(grow.length).toBeGreaterThan(30);
      // 그 밖(가까운 40채 밖 · 원 밖)의 주거 건물은 칸이 없다
      for (const p of s.city.places) if (isRes(s, p) && !inList.has(p.id)) expect(cells[p.id], `건물 ${p.id}`).toBeUndefined();
      // 손 계산: 한 블록(1초)의 증가 = base × RR × 세기 × (1 − 거리 / 반경)
      const t2 = grow[3], before = cells[t2.id].H;
      secs(s, 1);
      const Z = s.world.zones[zoneOfPlace(s, t2.id)];
      expect(cells[t2.id].H - before).toBeCloseTo(smokeBase(s, s.city.places[t2.id].kind) * ILL.RR * Z.smoke * (1 - t2.d / at.r), 15);
    });
  });

  it('L4 ⑥ medical/smoke 현장: 실신의 틀 · 환자의 처음 부상 원인은 연기 흡입 · 급변하지 않는다(tickMedical 이 아무것도 하지 않는다) · 이름 연기 흡입 · 신고는 호흡 곤란', () => {
    const s = quiet(), q = s.city.places.find((p) => p.kind === 'apartment' && p.facility < 0)!;
    const I = createIncident(s, { type: 'medical', variant: 'smoke', placeId: q.id, rng: s.rng.fork('t-med') });
    const sc = s.scenes[I.id]!;
    expect([I.truth.type, I.truth.variant, sc.leadDept]).toEqual(['medical', 'smoke', 'ems']);
    const cs = sc.casualties;
    expect(cs.length).toBe(1);
    expect([cs[0].mob, (cs[0].injuries ?? []).map((j) => j.cause)]).toEqual(['immobile', ['smoke']]);
    expect(cs[0].health).toBeGreaterThanOrEqual(70); expect(cs[0].health).toBeLessThanOrEqual(88);
    const h0 = cs[0].health, b0 = cs[0].bleed, n0 = s.events.length;
    for (let k = 0; k < 5 * 150; k++) { s.tick += 1; s.t = s.tick * s.dt; tickMedical(s, sc, I); }
    expect([cs[0].health, cs[0].bleed, s.events.length]).toEqual([h0, b0, n0]);
    expect(scenarioName('medical', 'smoke')).toBe('연기 흡입');
    // 신고: 정확히 아는 신고자는 '호흡 곤란'(breathless) — 그 줄은 거의 응급이고 연기·가스일 수도 있다
    const seen: string[] = [];
    for (let k = 0; k < 40; k++) {
      const cl = makeCaller(s, I, sc, s.rng.fork('t-call-' + k), false);
      const nat = cl.knows.nature!;
      seen.push(nat.value);
      if (nat.value === 'breathless') expect(nat.text).toMatch(/연기/);
    }
    expect(seen).toContain('breathless');
    for (const v of seen) expect(['breathless', 'collapsed']).toContain(v);
    const lik = NATURE_LIK.breathless;
    expect(Math.max(...Object.values(lik))).toBe(lik.medical);
  });

  it('L6 ① 홍수가 아닌 교대에는 아무것도 없다 — 문턱(world.sills)이 비어 있고 잠긴 건물·잠긴 지하 기록·level 장부가 없다', () => {
    for (const s of [normalS0(), new Sim('S0', { ...NORMAL, disaster: parseDisaster('typhoon')! }, 1200)]) {
      if (!s.ended) s.runToEnd();
      expect(s.world.sills).toEqual({});
      expect(Object.values(s.world.expo).some((e) => e.wet)).toBe(false);
      expect(s.events.some((e) => WET_TEXT.test(e.text))).toBe(false);
      expect(Array.from(s.traffic.levelEv).every((v) => v === -1)).toBe(true);
    }
  });

  it('L6 ② 수위를 손으로 올리면 문턱 순서대로 잠긴다(5초마다 — 문턱 = max(0.3, 강까지 / 80) × (0.85 + 0.3u), 54채) — 기록은 4층 이상 · 쓸 수 있는 건물에서만 건물마다 한 번(원인 = 홍수의 충격 알림), 그 건물의 전기실이 꺼지고 L5 의 칸이 생긴다(내력 level)', () => {
    const s = floodSim(), d = s.disaster!;
    const fp = floodPlaces(s);
    expect(fp.length).toBe(54);
    expect(floodPlaces(floodSim('S3'))).toBe(fp);      // 도시 열쇠의 캐시 — 시드와 무관
    const tall = fp.filter((f) => (s.city.places[f.id].floors ?? 1) >= LIFT.FLOORS).map((f) => f.id);
    expect(tall.length).toBe(2);
    for (const id of tall) expect(s.city.places[id].kind).toBe('officetel');
    for (const f of fp) { const q = s.city.places[f.id]; expect(f.base).toBeCloseTo(Math.max(0.3, riverDist(q.x + q.w / 2, q.y + q.h / 2) / 80), 12); expect(f.base * 1.15).toBeLessThanOrEqual(1.15 + 1e-12); expect(q.open).toBe(false); }
    d.levelEv = note(s, '시험 — 강이 넘치기 시작했다');
    d.level = 0.01;
    secs(s, 5);
    expect(Object.keys(s.world.sills).length).toBe(54);
    for (const f of fp) expect(s.world.sills[f.id]).toBeCloseTo(sillHand(s, f.id, f.base), 15);
    const order = [...fp].sort((a, b) => s.world.sills[a.id] - s.world.sills[b.id]);
    const wetAt: Record<number, number> = {};
    for (const lv of [0.3, 0.45, 0.6, 0.75, 0.9, 1.05, 1.2]) {
      d.level = lv;
      secs(s, 5);
      for (const f of fp) {
        const wet = !!s.world.expo[f.id]?.wet;
        expect(wet, `건물 ${f.id} 수위 ${lv}`).toBe(s.world.sills[f.id] < lv);
        if (wet && wetAt[f.id] === undefined) wetAt[f.id] = lv;
      }
    }
    for (let k = 1; k < order.length; k++) expect(wetAt[order[k].id] >= wetAt[order[k - 1].id]).toBe(true);
    const rec = s.events.filter((e) => WET_TEXT.test(e.text));
    expect(rec.length).toBe(tall.length);
    for (const e of rec) expect([e.role, e.actor, e.truth, e.causes, e.importance]).toEqual(['SYSTEM', '도시', true, [d.levelEv], 0]);
    for (const f of fp) {
      const ex = s.world.expo[f.id];
      if (tall.indexOf(f.id) >= 0) {
        expect(ex.wetEv).toBeGreaterThanOrEqual(0);
        expect(s.events[ex.wetEv].text.startsWith(`${s.city.places[f.id].addr} ${s.city.places[f.id].name}`)).toBe(true);
        expect(ex.dark).toBeGreaterThan(0);
        expect(isDark(s, f.id)).toBe(true);
        const c = hazardCell(s, 'liftStall', f.id);
        expect(c).not.toBeNull();
      } else { expect([ex.wetEv, ex.dark]).toEqual([-1, -1]); expect(hazardCell(s, 'liftStall', f.id)).toBeNull(); }
    }
    // 수위가 내려가도 잠긴 지하는 그대로이고 기록을 되풀이하지 않는다
    d.level = 0.1; secs(s, 10); d.level = 1.3; secs(s, 10);
    expect(s.events.filter((e) => WET_TEXT.test(e.text)).length).toBe(tall.length);
  });

  it('L6 ③ 개입: 같은 시드의 홍수에서 수위를 모든 문턱 아래(0.25)에 묶어 둔 쪽에는 침수도 그 원인의 승강기 사건도 없다 — 다른 쪽의 승강기 사건은 원인이 잠긴 지하 기록이고 내력 level · 부모가 없다', () => {
    const LR = LIFT.RIDE;
    LIFT.RIDE = LR * 1e5;
    try {
      const A = floodSim(), B = floodSim();
      for (const [s, lv] of [[A, 1.3], [B, 0.25]] as const) {
        const d = s.disaster!;
        d.levelEv = note(s, '시험 — 강이 넘치기 시작했다');
        d.level = lv;
        secs(s, 12);
      }
      expect(Object.values(B.world.expo).some((e) => e.wet)).toBe(false);
      expect(B.incidents.filter((J) => J.csq === 'liftStall')).toEqual([]);
      expect(B.world.hz.cells.liftStall).toBeUndefined();
      const kids = A.incidents.filter((J) => J.csq === 'liftStall');
      expect(kids.length).toBeGreaterThan(0);
      for (const K of kids) {
        const ex = A.world.expo[K.hz!.target];
        expect([K.truth.placeId, K.cause, K.parent, K.hz!.src[0].what, K.hz!.src[0].ev]).toEqual([K.hz!.target, ex.wetEv, undefined, 'level', ex.wetEv]);
        expect(A.events[K.rootEvent].causes).toContain(ex.wetEv);
      }
    } finally { LIFT.RIDE = LR; }
  });

  it('L6 ④ 차오르는 물에 느려진 길(실제 교대 홍수 S0): 느린 동안 교통 장부의 level 항(원인 = 홍수의 충격 알림 · 초과의 몫 0.8)이 있고, 통제되면 그 구간의 초과는 0, 느림을 거두면·재난이 끝나면 장부가 비워진다 — 구간에서 직접 내는 사건은 없다', () => {
    const s = new Sim('S0', { ...NORMAL, disaster: parseDisaster('flood')! }, 1200);
    const d = s.disaster!;
    let slowSeen = 0, closedSeen = 0, unslowSeen = 0, partSeen = 0;
    const was = new Set<number>(), closedPrev = new Set<number>();
    const buf: RoadPart[] = [];
    while (!s.ended && s.tick < 20000) {
      s.step();
      if (s.tick % 60) continue;      // 12초마다 (교통 모델의 주기)
      const slowed = new Set(d.slowed ?? []);
      for (const e of s.city.edges) {
        const lv = s.traffic.levelEv[e.id];
        if (slowed.has(e.id)) {
          slowSeen++;
          expect(lv, `구간 ${e.id}`).toBe(d.levelEv);
          expect(d.levelEv).toBeGreaterThanOrEqual(0);
          if (e.closed && closedPrev.has(e.id)) { closedSeen++; expect(s.traffic.excess[e.id]).toBe(0); }      // 한 주기(12초) 넘게 닫혀 있던 구간 — 초과는 교통 모델의 주기마다 다시 적는다
          else if (s.traffic.excess[e.id] > 0) { const n = roadParts(s, e.id, buf); if (buf.slice(0, n).some((p) => p.what === 'level' && p.ev === d.levelEv)) partSeen++; }
        } else {
          expect(lv, `구간 ${e.id}`).toBe(-1);
          if (was.has(e.id)) unslowSeen++;
        }
      }
      was.clear(); for (const id of slowed) was.add(id);
      closedPrev.clear(); for (const e of s.city.edges) if (e.closed) closedPrev.add(e.id);
    }
    expect(slowSeen).toBeGreaterThan(0);
    expect(partSeen).toBeGreaterThan(0);
    expect(closedSeen).toBeGreaterThan(0);
    expect(unslowSeen).toBeGreaterThan(0);      // 물이 빠지며 느림을 거둔 구간 — 장부가 비워졌다
    expect(d.phase).toBe('over');
    expect(Array.from(s.traffic.levelEv).every((v) => v === -1)).toBe(true);
    expect(s.events[d.levelEv].text).toMatch(/넘치기 시작했습니다/);
    expect(LEVEL_EX).toBe(0.8);
  });

  it('측정 도구의 연기·침수 줄: 연기 속 건물의 노출량 Σ c × base_p (법칙과 같은 식) · 알림 · 대상 수 · 교대 끝 줄 — 홍수의 잠긴 건물·기록·문턱 수', () => {
    withLaws([], () => {
      const s = quiet(), q = smokyApt(s), pr = new HazProbe(s);
      fireAt(s, q, 60);
      let hand = 0;
      for (let k = 0; k < 5 * 80; k++) {
        tk(s); pr.tick();
        if (s.tick % 5 === 1 && s.world.spans.some((x) => x.f === 'smoke')) smokeExposure(s, (_t, c, base) => { hand += c * base; });
      }
      const c = pr.done();
      expect([c.smoke!.alerts, c.smoke!.spansEnd, c.smoke!.rowsEnd]).toEqual([1, 1, 1]);
      expect(c.smoke!.secs).toBeGreaterThan(30);
      expect(c.smoke!.targets).toBeGreaterThan(0); expect(c.smoke!.targets).toBeLessThanOrEqual(ILL.MAX);
      expect(c.smoke!.exposure).toBeCloseTo(hand, 15);
      expect(c.smoke!.exposure).toBeGreaterThan(0);
      const lines = hazLines(sumHaz([c]));
      expect(lines.find((l) => l.startsWith('hazard-smoke: exposure '))).toContain('plumes 1 (in 1 shifts)');
      expect(lines).toContain('hazard-flood: -');
      expect((hazJson(sumHaz([c])).smoke as { alerts: number }).alerts).toBe(1);
    });
    const f = floodSim(), pf = new HazProbe(f), d = f.disaster!;
    d.levelEv = note(f, '시험'); d.level = 0.9;
    for (let k = 0; k < 5 * 6; k++) { tk(f); pf.tick(); }
    const cf = pf.done();
    const wet = Object.values(f.world.expo).filter((e) => e.wet).length;
    expect([cf.flood!.wet, cf.flood!.sills, cf.flood!.records]).toEqual([wet, 54, f.events.filter((e) => WET_TEXT.test(e.text)).length]);
    expect(hazLines(sumHaz([cf])).find((l) => l.startsWith('hazard-flood: '))).toContain(`buildings wet ${wet}`);
  });

  it('L6 ⑤ 한 프로세스에서 다른 시드를 먼저 돌려도 문턱이 같다 — 건물마다의 문턱은 그 교대의 sim.world 안에만 있고(흐름 hz:floodLow:b<건물>), 시드가 다르면 다르다', () => {
    const fill = (s: Sim): Record<number, number> => { const d = s.disaster!; d.levelEv = -1; d.level = 0.01; secs(s, 5); return { ...s.world.sills }; };
    const first = fill(floodSim('S7'));
    fill(floodSim('S3'));
    const again = fill(floodSim('S7'));
    expect(again).toEqual(first);
    const other = fill(floodSim('S3'));
    expect(Object.keys(other).some((k) => other[+k] !== first[+k])).toBe(true);
    const s = floodSim('S7');
    for (const f of floodPlaces(s)) expect(sillOf(s, f.id, f.base)).toBe(first[f.id]);
  });
});
