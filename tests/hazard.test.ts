// 초과 위험 과정과 교통의 장부 (I1-b b3-4 · b3-5 — docs/specs/I1-causality.md §3.6a·§3.6b, 시험 목록 §6 I1-b 5·6·9·12·13).
// 틀의 시험은 가짜 법칙으로 한다: registerHazard 로 넣고 finally 에서 거둔다 — 등록은 그 파일의 모든 Sim 에 걸리므로(모듈 전역) 자기 Sim 만 돌린다.
// 대부분 sim.step() 없이 tickHazards(sim) 만 부른다 — 빠르고 다른 원인이 끼지 않는다. 시각은 sim.t 를 손으로 옮긴다(틱마다 1초).
// 뒤 단계가 진짜 법칙을 등록해도 이 시험이 흔들리지 않게, 가짜 법칙을 넣는 동안에는 등록된 법칙을 모두 치워 둔다(withLaws).
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it, vi } from 'vitest';
import { CHAIN_MAX, CHAIN_SHIFT_MAX } from '../src/sim/chain';
import { NORMAL, parseDisaster } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { emit } from '../src/sim/events';
import { createIncident, tickIncidents } from '../src/sim/incidents';
import type { SpawnOpts } from '../src/sim/incidents';
import type { HazardLawId, HzCell, Incident } from '../src/sim/types';
import { CSQ_SPAWN_CAP, HZ, hazardCell, hazardImpulse, hazardLabel, hazardLaws, registerHazard, ruleLoad, tickHazards } from '../src/sim/world/hazard';
import type { HazardLaw, HzPart } from '../src/sim/world/hazard';
import { CSQ_SPAWN_CAP as CAP_AGAIN } from '../src/sim/world/consequence';
import { HAZARD_LAWS, checkMetrics, formatLines, hazardShift, summarize } from '../scripts/metrics';
import { HazProbe, hazJson, hazLines, sumHaz } from '../scripts/hazstats';
import type { HazCount } from '../scripts/hazstats';
import { roadSill } from '../src/sim/disaster';
import { DIV_MAX, LEVEL_EX, addBump, addObstacle, canBlock, noteBump, noteRoadCause, reallyLinked, removeBump, roadParts, unnoteBump } from '../src/sim/traffic';
import type { RoadPart } from '../src/sim/traffic';
import type { ShiftMetrics } from '../scripts/metrics';

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
      expect([tr.exDiv[e.id], tr.divert[e.id], tr.divertBy[e.id]], '우회 몰림은 b3-5 ② 가 채운다').toEqual([0, 0, -1]);
    }
    expect(DIV_MAX).toBe(1);
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
      expect(r.div).toBe(0);
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
