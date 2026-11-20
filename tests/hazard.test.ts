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
    for (const f of ['src/sim/world/hazard.ts', 'src/sim/world/state.ts', 'src/sim/world/rules/record.ts']) expect(/^\s*register(?:Hazard|Consequence)\(/m.test(read(f)), f).toBe(false);
  });

  it('정보 격리 2 (소스 글자): 판단 파일은 초과 위험·내력·교통의 장부·건물의 손상을 읽지 않고, 세계 쪽은 현장의 생김새 칸(s.rules)에 쓰지 않는다', () => {
    const files = [
      ...tsIn('src/sim/dispatch'), 'src/sim/field/commander.ts', 'src/sim/field/brain.ts', ...tsIn('src/sim/field/orders'),
      'src/sim/field/methods.ts', 'src/sim/field/ops.ts', 'src/sim/field/airDecide.ts', 'src/sim/field/gear.ts', ...tsIn('src/sim/field/doctrine'),
    ];
    expect(files.length).toBeGreaterThan(20);
    const WORDS = ['world.hz', 'I.hz', 'fireLoad', 'zoneAt(', 'isDark(', '.excess', '.exDiv', '.exQueue', '.exOwn', '.exBump', '.divertBy', 'closeEv', 'slowEv', 'levelEv', 'qEv', '.bumps', '.wear', 'expoOf', 'roadParts'];
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
        expect(tr.bumps.length).toBe(tr.crowds.length + (dz && dz.dark ? 1 : 0));
      }
      // 교대가 끝나면 얹은 혼잡과 그 줄이 남지 않는다
      expect(tr.bumps).toEqual([]);
      for (const e of edges) expect(e.bump ?? 0).toBe(0);
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
