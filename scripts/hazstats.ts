// 초과 위험 과정(I1-b §3.6a)의 노출량 — scripts/sweep.ts 가 --hazard 일 때 교대마다 부른다 (설계서 I1 §4). 상태를 읽기만 한다: 결과는 바뀌지 않는다.
// 법칙의 세기 상수는 이 값으로 맞춘다: `상수 = 목표 건수 ÷ 노출량의 평균` (조사 때의 어림은 혼잡 값의 차로 잰 것이라 쓰지 않는다 — 반드시 다시 잰다).
//
// b3-4 는 뼈대다: 재는 값은 그 상태가 생기는 단계가 한 줄씩 더한다(아직 없는 상태는 잴 수 없다).
//   hazard-laws:  법칙마다 초과가 있었던 대상 수 · 문턱을 넘은 횟수 · 사건이 된 수 · 교대 끝에 기다리던 줄 (법칙이 없으면 '-')
//   hazard-road:  (b3-5 ①) 도로의 노출량 Σ_e ∫ x·V·S·ℓ dt 를 네 몫으로 나눠, 장부 없는 초과의 노출량(0 이어야 한다), 닫힌 구간·초과가 있는 구간의 수
//                 (b3-5 ②) 우회로: 몰린 구간의 수(표본당)와 지속 시간(구간·초/교대) · 그 구간들의 혼잡(평균·최대) · 몰림이 상한에 닿은 비율 — 우회 몰림의 크기(traffic.DIVERT)를 맞추는 데 쓴다
//   hazard-heat:  (b3-7) 열의 노출량 Σ∫ M × max(0, q − Q0) dt (L2 의 K 를 곱하기 전 — 법칙과 같은 식: world/laws/heat.ts 의 heatTargets) · 노출된 건물 수 · 열원 현장 수 · 열원의 F 최댓값 ·
//                 노출된 건물의 노출량 분포(가장 큰 것) — L2 의 세기(HEAT.K)를 맞추는 데 쓴다
// 뒤 단계가 더할 줄: 충격을 받은 건물 수와 shake 분포·끊긴 배관(b3-8)
//   · 닫힌 화재의 e0 분포(b3-9) · 정전이 닿은 4층 이상 건물 수(b3-10) · 연기 Σ∫c × base dt(b3-11).
//
// 표본: HazProbe.tick() 을 매 틱 step() 뒤에 부른다 — 교통 모델이 혼잡을 다시 계산한 틱(traffic.driftAt 이 바뀐 틱)에만 도로를 읽는다(12초에 한 번).

import type { Sim } from '../src/sim/engine';
import { DIVERT, roadFlow, roadParts } from '../src/sim/traffic';
import type { RoadPart } from '../src/sim/traffic';
import { roadSurface, roadWeight } from '../src/sim/world/laws/road';      // L1 의 가중(통행량 × 노면·시야 × 길이) — 법칙과 측정이 같은 식을 쓴다
import { heatTargets } from '../src/sim/world/laws/heat';                   // (b3-7) L2 의 열원·대상·유속 — 법칙과 측정이 같은 식을 쓴다

export interface HazLawCount { cells: number; crossed: number; made: number; waitingEnd: number }
export interface HazRoad {
  drifts: number;                                   // 표본 수 (교통 모델이 혼잡을 다시 계산한 횟수)
  own: number; bump: number; queue: number; div: number;      // 노출량 Σ_e ∫ (그 몫) × V × S × ℓ dt — 네 몫
  raw: number;                                      // 가중 없는 초과 Σ_e ∫ x dt (구간·초 — 조사의 "보통 교대 약 18,000" 과 견줄 값)
  unledgered: number;                               // 내력의 기록이 없는(ev < 0) 몫의 노출량 — 장부의 구멍 (0 이어야 한다)
  edgeDrifts: number; closedDrifts: number;         // 초과가 있던 구간 × 표본 · 닫혀 있던 구간 × 표본
  byWhat: Record<string, number>;                   // 몫의 갈래별 노출량 (divert·queue·lane·jam·crowd·dark·haze·level)
  detourDrifts: number; detourCong: number; detourCongMax: number; detourCap: number;      // (b3-5 ②) 우회 몰림이 있던 구간 × 표본 · 그 구간들의 혼잡의 합과 최댓값 · 몰림이 상한(DIVERT.MAX)에 닿은 구간 × 표본
}
/** (b3-7) 열의 노출 — 1초마다(초과 위험의 주기와 같은 틱) 법칙과 같은 열원·대상을 훑는다 */
export interface HazHeat {
  secs: number;                                     // 열원이 하나라도 있던 초
  exposure: number;                                 // Σ_대상 ∫ M × max(0, q − Q0) dt (K 를 곱하기 전)
  targets: number;                                  // 노출된 건물 수 (교대 안에서 서로 다른)
  sources: number;                                  // 열원이 된 현장 수 (F ≥ F_MIN 이던 사건)
  fMax: number;                                     // 열원의 불 요약 F 의 최댓값
  top: number[];                                    // 노출량이 큰 건물들의 노출량 (큰 것부터 다섯)
}
export interface HazCount { laws: Record<string, HazLawCount>; holes: number; road: HazRoad | null; heat: HazHeat | null }

const roadZero = (): HazRoad => ({ drifts: 0, own: 0, bump: 0, queue: 0, div: 0, raw: 0, unledgered: 0, edgeDrifts: 0, closedDrifts: 0, byWhat: {}, detourDrifts: 0, detourCong: 0, detourCongMax: 0, detourCap: 0 });

/** 교대 하나의 표본 — 매 틱 tick(), 끝난 뒤 done() */
export class HazProbe {
  readonly sim: Sim;
  readonly road: HazRoad = roadZero();
  private seenDrift = -1;
  private heatBy = new Map<number, number>();       // 대상 → 노출량
  private heatSrc = new Set<number>();
  private heatSecs = 0; private heatFMax = 0;
  constructor(sim: Sim) { this.sim = sim; }
  tick(): void {
    if (this.sim.tick % 5 === 1) this.sampleHeat();      // 초과 위험의 1초 블록과 같은 틱 (tickWorld)
    const tr = this.sim.traffic as { driftAt?: number };
    if (tr.driftAt === undefined || tr.driftAt === this.seenDrift) return;
    this.seenDrift = tr.driftAt;
    this.sampleRoad();
  }
  /** 도로의 초과 — 교통 모델이 drift 에서 적어 둔 배열과 몫 목록만 읽는다. 가중은 L1 의 식 그대로(world/laws/road.ts 의 roadWeight — 통행량 × 노면·시야 × 길이), dt = 12 */
  private buf: RoadPart[] = [];
  protected sampleRoad(): void {
    const sim = this.sim, tr = sim.traffic, edges = sim.city.edges, r = this.road, flow = roadFlow(sim), S = roadSurface(sim), dt = 12;
    r.drifts++;
    for (let id = 0; id < edges.length; id++) {
      const e = edges[id];
      if (e.closed) { r.closedDrifts++; continue; }
      if (tr.divert[id] > 0) { r.detourDrifts++; r.detourCong += e.cong; if (e.cong > r.detourCongMax) r.detourCongMax = e.cong; if (tr.divert[id] >= DIVERT.MAX) r.detourCap++; }
      const x = tr.excess[id];
      if (!(x > 0)) continue;
      const w = roadWeight(e, flow[id], S) * dt;
      r.edgeDrifts++;
      r.own += tr.exOwn[id] * w; r.bump += tr.exBump[id] * w; r.queue += tr.exQueue[id] * w; r.div += tr.exDiv[id] * w; r.raw += x * dt;
      const np = roadParts(sim, id, this.buf);
      for (let k = 0; k < np; k++) { const p = this.buf[k]; r.byWhat[p.what] = (r.byWhat[p.what] ?? 0) + p.x * w; if (p.ev < 0) r.unledgered += p.x * w; }
    }
  }
  /** 열 — L2 의 heatTargets 를 그대로 부른다(읽기만 한다), dt = 1 */
  protected sampleHeat(): void {
    let any = false;
    heatTargets(this.sim, (target, _gap, F, rate, inc) => {
      any = true;
      this.heatBy.set(target, (this.heatBy.get(target) ?? 0) + rate);
      this.heatSrc.add(inc);
      if (F > this.heatFMax) this.heatFMax = F;
    });
    if (any) this.heatSecs++;
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
    const ex = [...this.heatBy.values()].sort((a, b) => b - a);
    let tot = 0; for (const v of ex) tot += v;
    const heat: HazHeat | null = this.heatSecs ? { secs: this.heatSecs, exposure: tot, targets: ex.length, sources: this.heatSrc.size, fMax: this.heatFMax, top: ex.slice(0, 5) } : null;
    return { laws, holes: hz.holes, road: this.road.drifts ? this.road : null, heat };
  }
}

export { roadSurface };      // (b3-6) 법칙 파일의 것을 그대로 내보낸다

export interface HazSum { shifts: number; laws: Record<string, HazLawCount>; holes: number; road: HazRoad | null; roadShifts: number; heat: { shifts: number; secs: number; exposure: number; targets: number; sources: number; fMax: number; top: number[] } }
export function sumHaz(list: readonly HazCount[]): HazSum {
  const o: HazSum = { shifts: list.length, laws: {}, holes: 0, road: null, roadShifts: 0, heat: { shifts: 0, secs: 0, exposure: 0, targets: 0, sources: 0, fMax: 0, top: [] } };
  for (const c of list) {
    if (c.heat) {
      const h = o.heat;
      h.shifts++; h.secs += c.heat.secs; h.exposure += c.heat.exposure; h.targets += c.heat.targets; h.sources += c.heat.sources; if (c.heat.fMax > h.fMax) h.fMax = c.heat.fMax;
      h.top = [...h.top, ...c.heat.top].sort((a, b) => b - a).slice(0, 8);
    }
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
      r.detourDrifts += c.road.detourDrifts; r.detourCong += c.road.detourCong; r.detourCap += c.road.detourCap; if (c.road.detourCongMax > r.detourCongMax) r.detourCongMax = c.road.detourCongMax;
      for (const [k, v] of Object.entries(c.road.byWhat)) r.byWhat[k] = (r.byWhat[k] ?? 0) + v;
    }
  }
  return o;
}

const f1 = (v: number): string => (Math.round(v * 10) / 10).toString();
const f2 = (v: number): string => (Math.round(v * 100) / 100).toString();
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
    out.push(`hazard-detour: ${f1(r.detourDrifts / Math.max(1, r.drifts))} edges/sample · ${f1((r.detourDrifts * 12) / n)} edge·s/shift · cong avg ${f2(r.detourCong / Math.max(1, r.detourDrifts))} max ${f2(r.detourCongMax)} · at cap ${Math.round((100 * r.detourCap) / Math.max(1, r.detourDrifts))}%`);
  } else out.push('hazard-road: -');
  const h = s.heat;
  out.push(h.shifts ? `hazard-heat: exposure ${f2(h.exposure / n)}/shift (Σ M·max(0, q − Q0)·dt) · shifts with a source ${h.shifts} · source scenes ${h.sources} · buildings exposed ${h.targets} · source-seconds ${h.secs} · F max ${h.fMax} · largest ${h.top.map(f2).join(' ')}` : 'hazard-heat: -');
  return out;
}
export function hazJson(s: HazSum): Record<string, unknown> {
  const n = Math.max(1, s.shifts), r = s.road;
  const r1 = (v: number): number => Math.round(v * 10) / 10;
  return {
    shifts: s.shifts, laws: s.laws, holes: s.holes,
    heat: { shifts: s.heat.shifts, exposurePerShift: +(s.heat.exposure / n).toFixed(2), targets: s.heat.targets, sources: s.heat.sources, secs: s.heat.secs, fMax: s.heat.fMax, top: s.heat.top.map((v) => +v.toFixed(2)) },
    road: r ? {
      exposurePerShift: r1((r.own + r.bump + r.queue + r.div) / n), own: r1(r.own / n), bump: r1(r.bump / n), queue: r1(r.queue / n), divert: r1(r.div / n),
      unledgered: r1(r.unledgered / n), rawPerShift: r1(r.raw / n), edgesWithExcess: r1(r.edgeDrifts / Math.max(1, r.drifts)), closedEdges: r1(r.closedDrifts / Math.max(1, r.drifts)),
      byWhat: Object.fromEntries(Object.entries(r.byWhat).map(([k, v]) => [k, r1(v / n)])),
      detour: { edgesPerSample: +(r.detourDrifts / Math.max(1, r.drifts)).toFixed(2), edgeSecPerShift: r1((r.detourDrifts * 12) / n), congAvg: +(r.detourCong / Math.max(1, r.detourDrifts)).toFixed(2), congMax: +r.detourCongMax.toFixed(2), atCap: +(r.detourCap / Math.max(1, r.detourDrifts)).toFixed(3) },
    } : null,
  };
}
