// 초과 위험 과정(I1-b §3.6a)의 노출량 — scripts/sweep.ts 가 --hazard 일 때 교대마다 부른다 (설계서 I1 §4). 상태를 읽기만 한다: 결과는 바뀌지 않는다.
// 법칙의 세기 상수는 이 값으로 맞춘다: `상수 = 목표 건수 ÷ 노출량의 평균` (조사 때의 어림은 혼잡 값의 차로 잰 것이라 쓰지 않는다 — 반드시 다시 잰다).
//
// b3-4 는 뼈대다: 재는 값은 그 상태가 생기는 단계가 한 줄씩 더한다(아직 없는 상태는 잴 수 없다).
//   hazard-laws:  법칙마다 초과가 있었던 대상 수 · 문턱을 넘은 횟수 · 사건이 된 수 · 교대 끝에 기다리던 줄 (법칙이 없으면 '-')
//   hazard-road:  (b3-5 ①) 도로의 노출량 Σ_e ∫ x·V·S·ℓ dt 를 네 몫으로 나눠, 장부 없는 초과의 노출량(0 이어야 한다), 닫힌 구간·초과가 있는 구간의 수
// 뒤 단계가 더할 줄: 우회로의 최대 혼잡과 지속 시간(b3-5 ②) · 열 Σ∫max(0, q − Q0)dt 와 노출된 건물 수(b3-7) · 충격을 받은 건물 수와 shake 분포·끊긴 배관(b3-8)
//   · 닫힌 화재의 e0 분포(b3-9) · 정전이 닿은 4층 이상 건물 수(b3-10) · 연기 Σ∫c × base dt(b3-11).
//
// 표본: HazProbe.tick() 을 매 틱 step() 뒤에 부른다 — 교통 모델이 혼잡을 다시 계산한 틱(traffic.driftAt 이 바뀐 틱)에만 도로를 읽는다(12초에 한 번).

import { weatherSpeedFactor } from '../src/sim/city';
import type { Sim } from '../src/sim/engine';
import { roadFlow, roadParts } from '../src/sim/traffic';
import type { RoadPart } from '../src/sim/traffic';

export interface HazLawCount { cells: number; crossed: number; made: number; waitingEnd: number }
export interface HazRoad {
  drifts: number;                                   // 표본 수 (교통 모델이 혼잡을 다시 계산한 횟수)
  own: number; bump: number; queue: number; div: number;      // 노출량 Σ_e ∫ (그 몫) × V × S × ℓ dt — 네 몫
  raw: number;                                      // 가중 없는 초과 Σ_e ∫ x dt (구간·초 — 조사의 "보통 교대 약 18,000" 과 견줄 값)
  unledgered: number;                               // 내력의 기록이 없는(ev < 0) 몫의 노출량 — 장부의 구멍 (0 이어야 한다)
  edgeDrifts: number; closedDrifts: number;         // 초과가 있던 구간 × 표본 · 닫혀 있던 구간 × 표본
  byWhat: Record<string, number>;                   // 몫의 갈래별 노출량 (divert·queue·lane·jam·crowd·dark·haze·level)
}
export interface HazCount { laws: Record<string, HazLawCount>; holes: number; road: HazRoad | null }

const roadZero = (): HazRoad => ({ drifts: 0, own: 0, bump: 0, queue: 0, div: 0, raw: 0, unledgered: 0, edgeDrifts: 0, closedDrifts: 0, byWhat: {} });

/** 교대 하나의 표본 — 매 틱 tick(), 끝난 뒤 done() */
export class HazProbe {
  readonly sim: Sim;
  readonly road: HazRoad = roadZero();
  private seenDrift = -1;
  constructor(sim: Sim) { this.sim = sim; }
  tick(): void {
    const tr = this.sim.traffic as { driftAt?: number };
    if (tr.driftAt === undefined || tr.driftAt === this.seenDrift) return;
    this.seenDrift = tr.driftAt;
    this.sampleRoad();
  }
  /** 도로의 초과 — 교통 모델이 drift 에서 적어 둔 배열과 몫 목록만 읽는다. 가중은 L1 의 식 그대로: 통행량 V = 0.4 + 1.6 × flow · 노면·시야 S · 길이 ℓ = clamp(len / 150, 0.5, 2), dt = 12 */
  private buf: RoadPart[] = [];
  protected sampleRoad(): void {
    const sim = this.sim, tr = sim.traffic, edges = sim.city.edges, r = this.road, flow = roadFlow(sim), S = roadSurface(sim), dt = 12;
    r.drifts++;
    for (let id = 0; id < edges.length; id++) {
      const e = edges[id];
      if (e.closed) { r.closedDrifts++; continue; }
      const x = tr.excess[id];
      if (!(x > 0)) continue;
      const w = (0.4 + 1.6 * flow[id]) * S * Math.min(2, Math.max(0.5, e.len / 150)) * dt;
      r.edgeDrifts++;
      r.own += tr.exOwn[id] * w; r.bump += tr.exBump[id] * w; r.queue += tr.exQueue[id] * w; r.div += tr.exDiv[id] * w; r.raw += x * dt;
      const np = roadParts(sim, id, this.buf);
      for (let k = 0; k < np; k++) { const p = this.buf[k]; r.byWhat[p.what] = (r.byWhat[p.what] ?? 0) + p.x * w; if (p.ev < 0) r.unledgered += p.x * w; }
    }
  }
  done(): HazCount {
    const sim = this.sim, hz = sim.world.hz;
    const laws: Record<string, HazLawCount> = {};
    const at = (id: string): HazLawCount => laws[id] ?? (laws[id] = { cells: 0, crossed: 0, made: 0, waitingEnd: 0 });
    for (const [id, tab] of Object.entries(hz.cells)) {
      const c = at(id);
      for (const cell of Object.values(tab ?? {})) { c.cells++; c.crossed += cell.n + (cell.done ? 1 : 0); }
    }
    for (const I of sim.incidents) if (I.hz) at(I.hz.law).made++;
    for (const w of hz.waiting) at(w.law).waitingEnd++;
    return { laws, holes: hz.holes, road: this.road.drifts ? this.road : null };
  }
}

/** 노면·시야 (L1 의 S 항 — §3.7): (차량 속도 손잡이 ÷ 날씨·재난의 속도 계수)² × 밤이면 1.2. 초과분에만 곱한다 */
export function roadSurface(sim: Sim): number {
  const f = sim.tune.vehicleSpeedMul / weatherSpeedFactor(sim);
  return f * f * (sim.weather === 'night' ? 1.2 : 1);
}

export interface HazSum { shifts: number; laws: Record<string, HazLawCount>; holes: number; road: HazRoad | null; roadShifts: number }
export function sumHaz(list: readonly HazCount[]): HazSum {
  const o: HazSum = { shifts: list.length, laws: {}, holes: 0, road: null, roadShifts: 0 };
  for (const c of list) {
    o.holes += c.holes;
    for (const [id, l] of Object.entries(c.laws)) {
      const t = o.laws[id] ?? (o.laws[id] = { cells: 0, crossed: 0, made: 0, waitingEnd: 0 });
      t.cells += l.cells; t.crossed += l.crossed; t.made += l.made; t.waitingEnd += l.waitingEnd;
    }
    if (c.road) {
      const r = o.road ?? (o.road = roadZero());
      o.roadShifts++;
      r.drifts += c.road.drifts; r.own += c.road.own; r.bump += c.road.bump; r.queue += c.road.queue; r.div += c.road.div; r.raw += c.road.raw;
      r.unledgered += c.road.unledgered; r.edgeDrifts += c.road.edgeDrifts; r.closedDrifts += c.road.closedDrifts;
      for (const [k, v] of Object.entries(c.road.byWhat)) r.byWhat[k] = (r.byWhat[k] ?? 0) + v;
    }
  }
  return o;
}

const f1 = (v: number): string => (Math.round(v * 10) / 10).toString();
/** 글자 출력 (교대당 평균) */
export function hazLines(s: HazSum): string[] {
  const out: string[] = [];
  const n = Math.max(1, s.shifts);
  const laws = Object.keys(s.laws).sort();
  out.push(`hazard-laws: ${laws.length ? laws.map((id) => { const l = s.laws[id]; return `${id} cells ${l.cells} crossed ${l.crossed} made ${l.made} waiting ${l.waitingEnd}`; }).join(' · ') : '-'} · holes ${s.holes}`);
  if (s.road) {
    const r = s.road, tot = r.own + r.bump + r.queue + r.div;
    const what = Object.entries(r.byWhat).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${f1(v / n)}`).join(' ');
    out.push(`hazard-road: exposure ${f1(tot / n)}/shift (own ${f1(r.own / n)} · bump ${f1(r.bump / n)} · queue ${f1(r.queue / n)} · divert ${f1(r.div / n)}) · unledgered ${f1(r.unledgered / n)} · raw ${f1(r.raw / n)} edge·s/shift · edges with excess ${f1(r.edgeDrifts / Math.max(1, r.drifts))}/sample · closed ${f1(r.closedDrifts / Math.max(1, r.drifts))}/sample · by what: ${what || '-'}`);
  } else out.push('hazard-road: -');
  return out;
}
export function hazJson(s: HazSum): Record<string, unknown> {
  const n = Math.max(1, s.shifts), r = s.road;
  const r1 = (v: number): number => Math.round(v * 10) / 10;
  return {
    shifts: s.shifts, laws: s.laws, holes: s.holes,
    road: r ? {
      exposurePerShift: r1((r.own + r.bump + r.queue + r.div) / n), own: r1(r.own / n), bump: r1(r.bump / n), queue: r1(r.queue / n), divert: r1(r.div / n),
      unledgered: r1(r.unledgered / n), rawPerShift: r1(r.raw / n), edgesWithExcess: r1(r.edgeDrifts / Math.max(1, r.drifts)), closedEdges: r1(r.closedDrifts / Math.max(1, r.drifts)),
      byWhat: Object.fromEntries(Object.entries(r.byWhat).map(([k, v]) => [k, r1(v / n)])),
    } : null,
  };
}
