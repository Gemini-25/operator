// 교통 — 구간별 수치(혼잡·밀림)와 장애물 목록, 철길의 열차와 건널목. 설계: docs/specs/T1-traffic.md
//
// - 차량 하나하나를 굴리지 않는다. 도로의 상태는 구간마다의 수치(cong)와 길 위의 장애물 목록으로 표현한다.
// - 정보 격리: 경로를 짜는 쪽(city.findRoute — 관제의 예상 도착 시간, 부대의 경로)은 **알려진** 도로 상태만 본다.
//   알려지지 않은 장애물(known === false)은 부대가 가서 보고 무전으로 알리거나(reportObstacle), 시민 제보(tipAt)로 알려진다.
// - 난수는 sim.rngTraffic 과 거기서 갈라낸 흐름만 쓴다. 사건 생성의 난수를 건드리지 않는다.
// - 기존 칸의 뜻: cong = 교통량에서 오는 혼잡(1~3, 이 파일이 계산한다), slow = 사건이 얹는 지연(읽기만 한다),
//   closed·closedReason 의 'incident'·'disaster' 는 다른 곳의 것(건드리지 않는다). 이 파일이 만드는 통제는 'roadwork'·'obstacle' 이다.

import { edgeName, segCross } from './city';
import type { Sim } from './engine';
import { emit } from './events';
import type { Rng } from './rng';
import type { PlaceKind, RoadEdge, Unit } from './types';
import { clamp, josa } from './util';

export type ObstacleKind = 'roadwork' | 'breakdown' | 'debris' | 'parked';
export interface Obstacle {
  id: number; edge: number; t: number;          // 구간 위의 위치 (a→b 로 0..1)
  kind: ObstacleKind; full: boolean;            // 전면 차단인가 (아니면 한 차로만 — 느려질 뿐)
  heavyOnly: boolean;                           // 큰 차만 못 지난다 (불법 주차)
  since: number; until: number;                 // 생긴 시각, 치워지는 시각 (불법 주차는 교대 끝까지 = Infinity)
  known: boolean; knownAt: number;              // 관제가 아는가, 언제 알았는가
  tipAt: number;                                // 시민 제보가 들어올 시각 (그 전에 부대가 보면 그때 알려진다. 제보가 없으면 Infinity)
  label: string;                                // '낙하물' · '고장 차량' · '도로 공사' · '불법 주차'
}
export interface Train { pos: number; ppos: number; dir: 1 | -1; speed: number; len: number; dwell: number; called: boolean }      // pos = 철길 위 머리의 위치(화소), ppos = 한 틱 전(그림 보간용), dwell = 역에 서 있는 남은 초, called = 역에 이미 섰는가
export interface Crossing { edge: number; s: number; down: boolean; downAt: number }                // s = 철길 위의 위치
export interface TrafficStats { jams: number; closures: number; obstacles: number; detours: number; delaySec: number; gateWaits: number }
export interface TrafficState {
  queue: Float32Array;            // 구간별 밀린 정도 0..1 (막힌 구간에서 뒤로 번진다)
  jams: { edge: number; until: number }[];
  obstacles: Obstacle[]; nextObstacleId: number;
  trains: Train[]; crossings: Crossing[]; nextTrainAt: number;
  nextDrift: number; nextEvent: number;
  tod: number;                    // 시간대 계수 (교대가 시작된 시각으로 정해진다)
  stats: TrafficStats;
  // ── 그 밖 ──
  todName: string;                // '출근 시간대' · '퇴근 시간대' · '심야' · '평시'
  crowds: { edges: number[]; until: number; place: number }[];      // 행사 인파: bump 를 더해 둔 구간들 (끝나면 되돌린다)
  railLen: number; stationS: number; trainDir: 1 | -1;              // 철길의 길이, 역의 위치, 다음 열차의 방향
  railRng: Rng;                   // 열차 시각표 (교통 사건의 흐름과 따로 — 손잡이를 바꿔도 열차는 같은 시각에 온다)
  atGate: Map<number, number>;    // 차단기 앞에 서 있는 부대 → 구간 (기록을 한 번만 남긴다)
  announced: boolean;             // 교대 시작 뒤의 안내(시간대, 불법 주차)를 했는가
}

export const OBSTACLE_LABEL: Record<ObstacleKind, string> = { roadwork: '도로 공사', breakdown: '고장 차량', debris: '낙하물', parked: '불법 주차' };
const TRAIN_SPEED = 26, TRAIN_LEN = 110, STATION_DWELL = 14, GATE_AHEAD = 400, GATE_BEHIND = 30;
/** 차단기 앞에서 서는 거리, 장애물 앞에서 서는 거리 (지도 단위) */
const GATE_STOP = 14, OBSTACLE_STOP = 10;
/** 행사 인파가 몰리는 곳 */
const VENUES: Partial<Record<PlaceKind, boolean>> = { stadium: true, market: true, fishMarket: true, busTerminal: true, ferry: true, terminal: true, amusement: true };

// ───────────────────────── 철길 ─────────────────────────

/** 철길 위의 위치(화소) → 지도 좌표와 방향 */
export function railAt(rail: number[][], s: number): { x: number; y: number; ang: number } {
  let acc = 0;
  for (let i = 0; i + 1 < rail.length; i++) {
    const P = rail[i], Q = rail[i + 1], sl = Math.hypot(Q[0] - P[0], Q[1] - P[1]);
    if (s <= acc + sl || i === rail.length - 2) { const k = (s - acc) / sl; return { x: P[0] + (Q[0] - P[0]) * k, y: P[1] + (Q[1] - P[1]) * k, ang: Math.atan2(Q[1] - P[1], Q[0] - P[0]) }; }
    acc += sl;
  }
  return { x: 0, y: 0, ang: 0 };
}
function railLength(rail: number[][]): number { let l = 0; for (let i = 0; i + 1 < rail.length; i++) l += Math.hypot(rail[i + 1][0] - rail[i][0], rail[i + 1][1] - rail[i][1]); return l; }
/** 그 점에서 가장 가까운 철길 위의 위치 */
function railNearest(rail: number[][], x: number, y: number): number {
  let best = 0, bd = Infinity, acc = 0;
  for (let i = 0; i + 1 < rail.length; i++) {
    const P = rail[i], Q = rail[i + 1], dx = Q[0] - P[0], dy = Q[1] - P[1], sl = Math.hypot(dx, dy);
    const k = clamp(((x - P[0]) * dx + (y - P[1]) * dy) / (sl * sl || 1), 0, 1), d = Math.hypot(x - P[0] - dx * k, y - P[1] - dy * k);
    if (d < bd) { bd = d; best = acc + sl * k; }
    acc += sl;
  }
  return best;
}

// ───────────────────────── 시간대 ─────────────────────────

/** 시간대 계수: 8시와 18시에 봉우리(폭 1시간), 22시~6시는 한산하다 */
export function timeOfDay(startTod: number): { tod: number; peak: number; name: string } {
  const h = ((startTod / 3600) % 24 + 24) % 24;
  if (h >= 22 || h < 6) return { tod: 0.7, peak: 0, name: '심야' };
  const g = (c: number): number => Math.exp(-((h - c) ** 2) / 2);
  const peak = Math.max(g(8), g(18));
  return { tod: 0.82 + 0.5 * peak, peak, name: peak >= 0.5 ? (h < 13 ? '출근 시간대' : '퇴근 시간대') : '평시' };
}

// ───────────────────────── 도로망 ─────────────────────────

const obstacleOn = (tr: TrafficState, edge: number): Obstacle | null => { for (const o of tr.obstacles) if (o.edge === edge) return o; return null; };

/**
 * 실제 상태(알려졌든 아니든)에서, 큰 차도 a 에서 b 로 갈 수 있는가. skip 구간은 없는 것으로 본다.
 * 새 통제·불법 주차를 놓기 전에 본다: 이것이 참이면 도시의 어느 교차로도 어느 부대에게서도 끊기지 않는다.
 */
function linked(sim: Sim, tr: TrafficState, a: number, b: number, skip: number): boolean {
  const city = sim.city, seen = new Uint8Array(city.nodes.length), stack = [a];
  const narrow = new Set<number>(); for (const o of tr.obstacles) if (o.heavyOnly) narrow.add(o.edge);
  seen[a] = 1;
  while (stack.length) {
    const n = stack.pop()!;
    if (n === b) return true;
    for (const id of city.nodes[n].edges) {
      const e = city.edges[id];
      if (id === skip || e.closed || narrow.has(id)) continue;
      const v = e.a === n ? e.b : e.a;
      if (!seen[v]) { seen[v] = 1; stack.push(v); }
    }
  }
  return false;
}

/** 경로를 짤 때: 알려진 상태로 이 구간을 지나갈 수 있는가 (city.findRoute 가 같은 조건을 쓴다) */
export function passable(e: RoadEdge, heavy: boolean, _sim?: Sim): boolean {
  return !(e.closed && e.known !== false) && !(heavy && !!e.noHeavy);
}

// ───────────────────────── 장애물 ─────────────────────────

interface ObstacleOpts { edge: number; t?: number; kind: ObstacleKind; full: boolean; heavyOnly?: boolean; dur: number; known: boolean }

/** 장애물을 놓는다 (기록은 남기지 않는다). 놓을 수 없으면 null: 이미 장애물이 있는 구간, 이미 막힌 구간, 막으면 도시가 끊기는 구간 */
function place(sim: Sim, tr: TrafficState, o: ObstacleOpts): Obstacle | null {
  const e = sim.city.edges[o.edge];
  if (!e || obstacleOn(tr, e.id)) return null;
  const heavyOnly = !!o.heavyOnly && !o.full;
  if (o.full && e.closed) return null;
  if ((o.full || heavyOnly) && !linked(sim, tr, e.a, e.b, e.id)) return null;
  const ob: Obstacle = {
    id: tr.nextObstacleId++, edge: e.id, t: clamp(o.t ?? 0.5, 0.08, 0.92), kind: o.kind, full: o.full, heavyOnly,
    since: sim.t, until: sim.t + o.dur, known: o.known, knownAt: o.known ? sim.t : -1, tipAt: Infinity, label: OBSTACLE_LABEL[o.kind],
  };
  tr.obstacles.push(ob);
  if (ob.full) { e.closed = true; e.closedReason = o.kind === 'roadwork' ? 'roadwork' : 'obstacle'; e.known = o.known ? undefined : false; }
  if (ob.heavyOnly && o.known) e.noHeavy = true;
  return ob;
}

/** 알려진 장애물을 알리는 문장 (교통정보·부대의 보고가 함께 쓴다) */
function noticeText(sim: Sim, o: Obstacle): string {
  const name = edgeName(sim.city, sim.city.edges[o.edge]);
  if (o.full) return o.kind === 'roadwork' ? `${name} 긴급 도로 공사로 통제. 우회하십시오.` : `${name} 통행 불가 — ${o.label}. 우회하십시오.`;
  if (o.heavyOnly) return `${name} — 불법 주차로 길이 좁아 큰 차는 지나갈 수 없습니다.`;
  return o.kind === 'roadwork' ? `${name} 한 차로 공사 중 — 서행.` : `${name} ${josa(o.label, '으로/로')} 한 차로가 막혔습니다 — 서행.`;
}

function announce(sim: Sim, o: Obstacle): void {
  const name = edgeName(sim.city, sim.city.edges[o.edge]);
  if (o.known) { emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', imp: 0, text: noticeText(sim, o) }); return; }
  const text = o.kind === 'debris' ? `${name}에 화물이 떨어져 ${o.full ? '길이 막혔습니다' : '한 차로가 막혔습니다'}. 아직 아무도 신고하지 않았습니다.`
    : o.kind === 'breakdown' ? `${name}에 고장 난 차량이 ${o.full ? '길을' : '한 차로를'} 막고 서 있습니다. 아직 아무도 신고하지 않았습니다.`
    : o.kind === 'parked' ? `${name}: 불법 주차 차량이 골목을 좁혀 큰 차는 지나갈 수 없습니다. 아직 아무도 모릅니다.`
    : `${name}에서 예고 없이 공사가 시작돼 ${o.full ? '길이 막혔습니다' : '한 차로가 막혔습니다'}. 아직 아무도 신고하지 않았습니다.`;
  emit(sim, { role: 'SYSTEM', actor: '도시', kind: 'traffic', imp: o.full ? 1 : 0, truth: true, text });
}

/** 장애물을 놓고 기록한다 (재난·테스트가 쓴다). 전면 차단이나 불법 주차가 도시를 끊으면 null */
export function addObstacle(sim: Sim, o: ObstacleOpts): Obstacle | null {
  const ob = place(sim, sim.traffic, o);
  if (!ob) return null;
  if (ob.full) sim.traffic.stats.closures += ob.kind === 'roadwork' ? 1 : 0;
  if (!(ob.full && ob.kind === 'roadwork')) sim.traffic.stats.obstacles++;
  announce(sim, ob);
  return ob;
}

/** 이 부대가 이 구간을 from 교차로에서 들어가 달릴 때, 앞에서 길을 막고 있는 것 (전면 차단, 큰 차에게는 불법 주차). 이미 지나친 것은 세지 않는다 */
export function obstacleAhead(sim: Sim, u: Unit, e: RoadEdge, from: number): Obstacle | null {
  for (const o of sim.traffic.obstacles) {
    if (o.edge !== e.id || !(o.full || (o.heavyOnly && !!u.heavy))) continue;
    return (from === e.a ? o.t : 1 - o.t) > u.segT ? o : null;
  }
  return null;
}

/** 알려짐 처리 + 기록. by = 알린 쪽 ('교통정보' 또는 부대의 호출부호) */
export function reportObstacle(sim: Sim, o: Obstacle, by: string): void {
  if (o.known) return;
  const e = sim.city.edges[o.edge];
  o.known = true; o.knownAt = sim.t;
  if (o.full) e.known = true;
  if (o.heavyOnly) { e.noHeavy = true; sim.traffic.stats.obstacles++; }      // 불법 주차는 발견됐을 때 장애물로 센다
  const unit = by !== '교통정보';
  emit(sim, { role: unit ? 'UNIT' : 'SYSTEM', actor: by, kind: 'traffic', imp: 1, text: (unit ? '' : '시민 제보: ') + noticeText(sim, o) });
}

/**
 * 이 틱에 이 부대가 이 구간에서 더 나아갈 수 있는 한계 (진행 방향으로 0..1). 막는 것이 없으면 null.
 * o 가 있으면 길을 막은 장애물에 닿은 것이고(되돌아 나온다), 없으면 내려온 차단기다(기다린다).
 */
export function stopAhead(sim: Sim, u: Unit, e: RoadEdge, from: number): { at: number; o: Obstacle | null } | null {
  let at = 2, ob: Obstacle | null = null;
  const fwd = from === e.a;
  if (e.gateT !== undefined && (e.wait ?? 0) > 0) {
    const g = fwd ? e.gateT : 1 - e.gateT;
    if (u.segT < g) at = Math.max(u.segT, g - GATE_STOP / e.len);      // 이미 건널목을 지났으면 그대로 간다
  }
  if (!u.backing) {
    const o = obstacleAhead(sim, u, e, from);
    if (o) {
      // 가는 도중에 알려졌으면(다른 부대의 보고·제보) 거기까지 가 보지 않고 바로 돌아선다
      const oa = o.known ? u.segT : Math.max(u.segT, (fwd ? o.t : 1 - o.t) - OBSTACLE_STOP / e.len);
      if (oa <= at) { at = oa; ob = o; }
    }
  }
  return at > 1 ? null : { at, o: ob };
}

/** 부대가 내려온 차단기 앞에 서 있다 (이 틱). 처음 설 때 한 번 기록한다 */
export function gateWait(sim: Sim, u: Unit, e: RoadEdge): void {
  const tr = sim.traffic;
  if (tr.atGate.get(u.id) !== e.id) {
    tr.atGate.set(u.id, e.id); tr.stats.gateWaits++;
    emit(sim, { inc: u.state === 'enroute' && u.incidentId !== null ? u.incidentId : -1, role: 'UNIT', actor: u.callsign, kind: 'traffic', imp: 0, text: `${u.callsign}: ${e.name} 건널목 차단기 대기.` });
  }
  tr.stats.delaySec += sim.dt;
}

// ───────────────────────── 교대 시작 ─────────────────────────

export function initTraffic(sim: Sim): TrafficState {
  const city = sim.city, rng = sim.rngTraffic, rail = city.rail ?? [];
  const day = timeOfDay(sim.startTod);
  const tr: TrafficState = {
    queue: new Float32Array(city.edges.length), jams: [], obstacles: [], nextObstacleId: 0,
    trains: [], crossings: [], nextTrainAt: Infinity,
    nextDrift: 10, nextEvent: rng.range(70, 130) * sim.tune.trafficGap,
    tod: day.tod, todName: day.name,
    stats: { jams: 0, closures: 0, obstacles: 0, detours: 0, delaySec: 0, gateWaits: 0 },
    crowds: [], railLen: railLength(rail), stationS: 0, trainDir: 1, railRng: rng.fork('rail'), atGate: new Map(), announced: false,
  };
  // 처음의 혼잡: 이 시간대·이 교통량의 평소 수준
  for (const e of city.edges) e.cong = clamp(e.baseCong * tr.tod * sim.tune.trafficMul, 1, 3);
  // 건널목: 철길과 같은 높이로 만나는 일반·이면 도로 (간선·고속화 도로는 고가로 넘는다)
  let acc = 0;
  for (let i = 0; i + 1 < rail.length; i++) {
    const P = rail[i], Q = rail[i + 1], sx = Q[0] - P[0], sy = Q[1] - P[1], sl = Math.hypot(sx, sy);
    for (const e of city.edges) {
      if ((e.cls !== 'street' && e.cls !== 'local') || e.gateT !== undefined) continue;
      const A = city.nodes[e.a], B = city.nodes[e.b];
      if (!segCross(A.x, A.y, B.x, B.y, P[0], P[1], Q[0], Q[1])) continue;
      const rx = B.x - A.x, ry = B.y - A.y, den = rx * sy - ry * sx;
      e.gateT = ((P[0] - A.x) * sy - (P[1] - A.y) * sx) / den; e.wait = 0;
      tr.crossings.push({ edge: e.id, s: acc + (((P[0] - A.x) * ry - (P[1] - A.y) * rx) / den) * sl, down: false, downAt: -1 });
    }
    acc += sl;
  }
  if (tr.railLen > 0) {
    const st = city.places.find((q) => q.kind === 'station');
    tr.stationS = st ? railNearest(rail, st.x + st.w / 2, st.y + st.h / 2) : tr.railLen / 2;
    tr.trainDir = tr.railRng.chance(0.5) ? 1 : -1;
    tr.nextTrainAt = tr.railRng.range(25, 140);
  }
  // 불법 주차: 이면 도로 몇 곳이 교대 내내 좁아져 있다. 큰 차가 가서 보아야 알려진다
  if (sim.tune.parkedCount > 0) {
    const pr = rng.fork('parked');
    const fac = new Set<number>(); for (const f of city.facilities) fac.add(f.nodeId);
    const facEdge = new Set<number>(); for (const q of city.places) if (q.facility >= 0 && q.edgeId !== undefined) facEdge.add(q.edgeId);
    // 끝이 막다른 곳이거나 꺾이는 점(길이 둘뿐인 교차로)인 구간은 뺀다: 그 교차로가 다른 통제 하나로 큰 차에게서 끊길 수 있다
    const cands = city.edges.filter((e) => e.cls === 'local' && e.gateT === undefined && !fac.has(e.a) && !fac.has(e.b) && !facEdge.has(e.id) && city.nodes[e.a].edges.length >= 3 && city.nodes[e.b].edges.length >= 3);
    pr.shuffle(cands);
    let n = 0;
    for (const e of cands) {
      if (n >= sim.tune.parkedCount) break;
      if (place(sim, tr, { edge: e.id, t: pr.range(0.3, 0.7), kind: 'parked', full: false, heavyOnly: true, dur: Infinity, known: false })) n++;
    }
  }
  return tr;
}

// ───────────────────────── 매 틱 ─────────────────────────

/** 혼잡과 밀림 (12초마다) */
function drift(sim: Sim): void {
  const tr = sim.traffic, city = sim.city, rng = sim.rngTraffic, n = city.edges.length;
  const jam = new Uint8Array(n); for (const j of tr.jams) jam[j.edge] = 1;
  const neck = new Float32Array(n); for (const o of tr.obstacles) if (!o.full) neck[o.edge] = o.heavyOnly ? 0.4 : 0.9;
  // 밀림을 뺀 압력: 수요 + 병목 + 밖에서 더한 혼잡, 정체 중이면 2.8 까지
  const press = new Float32Array(n), src = new Uint8Array(n);
  for (const e of city.edges) {
    let p = e.baseCong * tr.tod * sim.tune.trafficMul + neck[e.id] + (e.bump ?? 0);
    if (jam[e.id]) p = Math.max(p, 2.8);
    press[e.id] = p;
    // 밀림의 뿌리: 막힌 구간, 사고 현장(slow), 그 자체로 꽉 찬 구간. 밀려서 찬 구간은 뿌리가 아니다(서로를 붙잡아 풀리지 않는 정체를 막는다)
    src[e.id] = e.closed || e.slow >= 1 || p >= 2.4 ? 1 : 0;
  }
  const near = (e: RoadEdge, f: (id: number) => boolean): boolean => {
    for (const id of city.nodes[e.a].edges) if (id !== e.id && f(id)) return true;
    for (const id of city.nodes[e.b].edges) if (id !== e.id && f(id)) return true;
    return false;
  };
  const ring1 = new Uint8Array(n);
  for (const e of city.edges) if (near(e, (id) => src[id] === 1)) ring1[e.id] = 1;
  const q0 = tr.queue.slice();
  for (const e of city.edges) {
    const half = e.cls === 'highway' ? 0.5 : 1;
    let q = q0[e.id];
    if (ring1[e.id]) q = Math.min(1, q + 0.14 * half);                                                   // 막힌 곳에 닿아 있다
    else if (q < 0.5 && near(e, (id) => ring1[id] === 1 && q0[id] >= 0.6)) q = Math.min(0.5, q + 0.07 * half);      // 한 다리 건너: 많이 밀린 구간의 뒤
    else q *= 0.75;
    tr.queue[e.id] = q < 0.01 ? 0 : q;
  }
  for (const e of city.edges) {
    const target = clamp(press[e.id] + tr.queue[e.id] * 1.2, 1, 3);
    e.cong = clamp(e.cong + (target - e.cong) * 0.35 + rng.range(-0.1, 0.1), 1, 3);
  }
}

/** 새 교통 사건 하나 */
function spawn(sim: Sim): void {
  const tr = sim.traffic, city = sim.city, rng = sim.rngTraffic;
  const fac = new Set<number>(); for (const f of city.facilities) fac.add(f.nodeId);
  const free = (e: RoadEdge): boolean => !e.closed && !obstacleOn(tr, e.id);
  const away = (e: RoadEdge): boolean => !fac.has(e.a) && !fac.has(e.b) && e.gateT === undefined;
  /** 후보 가운데 놓을 수 있는 곳을 찾아 놓는다 (몇 번 해 보고 안 되면 이번에는 아무 일도 없다) */
  const put = (cands: RoadEdge[], o: Omit<ObstacleOpts, 'edge' | 't'>): Obstacle | null => {
    for (let k = 0; k < 8 && cands.length; k++) { const ob = place(sim, tr, { ...o, edge: rng.pick(cands).id, t: rng.range(0.25, 0.75) }); if (ob) return ob; }
    return null;
  };
  const what = rng.weighted(['jam', 'workFull', 'workLane', 'breakdown', 'debris', 'crowd'] as const, [35, 15, 12, 14, 14, 10]);
  if (what === 'jam') {
    const cands = city.edges.filter((e) => (e.arterial || e.baseCong >= 1.4) && !e.closed && !tr.jams.some((j) => j.edge === e.id));
    if (!cands.length) return;
    const e = rng.pick(cands);
    tr.jams.push({ edge: e.id, until: sim.t + rng.range(70, 130) });
    e.cong = Math.max(e.cong, 2.4); tr.stats.jams++;
    emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', text: `${edgeName(city, e)} 정체 발생.`, imp: 0 });
  } else if (what === 'workFull') {
    const ob = put(city.edges.filter((e) => free(e) && away(e)), { kind: 'roadwork', full: true, dur: rng.range(70, 120), known: true });
    if (ob) { tr.stats.closures++; announce(sim, ob); }
  } else if (what === 'workLane') {
    const ob = put(city.edges.filter((e) => free(e) && (e.cls === 'arterial' || e.cls === 'street')), { kind: 'roadwork', full: false, dur: rng.range(150, 300), known: true });
    if (ob) { tr.stats.obstacles++; announce(sim, ob); }
  } else if (what === 'breakdown') {
    const ob = put(city.edges.filter((e) => free(e) && (e.cls === 'arterial' || e.cls === 'street')), { kind: 'breakdown', full: false, dur: rng.range(60, 150), known: false });
    if (ob) { ob.tipAt = sim.t + rng.range(20, 40); tr.stats.obstacles++; announce(sim, ob); }
  } else if (what === 'debris') {
    const ob = put(city.edges.filter((e) => free(e) && away(e) && (e.cls === 'street' || e.cls === 'local')), { kind: 'debris', full: true, dur: rng.range(70, 160), known: false });
    if (ob) { ob.tipAt = sim.t + rng.range(35, 70); tr.stats.obstacles++; announce(sim, ob); }
  } else {
    const cands = city.places.filter((q) => VENUES[q.kind] && q.edgeId !== undefined && !tr.crowds.some((c) => c.place === q.id));
    if (!cands.length) return;
    const q = rng.pick(cands), e0 = city.edges[q.edgeId!], edges = [e0.id];
    for (const nid of [e0.a, e0.b]) for (const id of city.nodes[nid].edges) if (edges.indexOf(id) < 0) edges.push(id);
    for (const id of edges) city.edges[id].bump = (city.edges[id].bump ?? 0) + 0.8;
    tr.crowds.push({ edges, until: sim.t + 180, place: q.id });
    emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', imp: 0, text: `${q.name} 주변에 인파가 몰려 길이 밀립니다.` });
  }
}

/** 열차와 건널목 차단기 */
function tickRail(sim: Sim): void {
  const tr = sim.traffic, city = sim.city, dt = sim.dt;
  if (tr.railLen <= 0) return;
  if (sim.t >= tr.nextTrainAt) {
    tr.nextTrainAt = sim.t + tr.railRng.range(150, 260);
    const dir = tr.trainDir, pos = dir > 0 ? 0 : tr.railLen;
    tr.trainDir = dir > 0 ? -1 : 1;
    tr.trains.push({ pos, ppos: pos, dir, speed: TRAIN_SPEED, len: TRAIN_LEN, dwell: 0, called: false });
  }
  for (let i = tr.trains.length - 1; i >= 0; i--) {
    const t = tr.trains[i];
    t.ppos = t.pos;
    if (t.dwell > 0) { t.dwell = Math.max(0, t.dwell - dt); continue; }
    const mid0 = t.pos - (t.dir * t.len) / 2;
    t.pos += t.dir * t.speed * dt;
    const mid1 = t.pos - (t.dir * t.len) / 2;
    if (!t.called && (mid0 - tr.stationS) * (mid1 - tr.stationS) <= 0) { t.called = true; t.dwell = STATION_DWELL; t.pos = tr.stationS + (t.dir * t.len) / 2; }      // 역에 선다
    if (t.dir > 0 ? t.pos - t.len > tr.railLen : t.pos + t.len < 0) tr.trains.splice(i, 1);      // 꼬리까지 철길 끝을 벗어났다
  }
  for (const c of tr.crossings) {
    let down = false, wait = 0;
    for (const t of tr.trains) {
      const ahead = (c.s - t.pos) * t.dir;              // 머리에서 건널목까지 (음수 = 머리가 지났다)
      const clear = ahead + t.len + GATE_BEHIND;        // 꼬리가 건널목을 30 지날 때까지
      if (ahead > GATE_AHEAD || clear <= 0) continue;
      down = true;
      let w = clear / t.speed;
      if (t.dwell > 0) w += t.dwell;
      else if (!t.called) { const toStation = (tr.stationS - (t.pos - (t.dir * t.len) / 2)) * t.dir; if (toStation >= 0 && toStation < clear) w += STATION_DWELL; }      // 건널목을 다 지나기 전에 역에 선다
      wait = Math.max(wait, w);
    }
    if (down && !c.down) c.downAt = sim.t;
    c.down = down;
    city.edges[c.edge].wait = down ? Math.max(0.2, wait) : 0;
  }
  if (tr.atGate.size) for (const [uid, eid] of tr.atGate) if (!(city.edges[eid].wait! > 0)) tr.atGate.delete(uid);
}

/** 교통은 개별 차량이 아니라 도로별 수치와 장애물, 간단한 사건으로 표현한다. */
export function tickTraffic(sim: Sim): void {
  const tr = sim.traffic, city = sim.city, rng = sim.rngTraffic;
  if (!tr.announced) {
    tr.announced = true;
    if (tr.todName === '심야') emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', imp: 1, text: '심야 — 도로가 한산합니다.' });
    else if (tr.todName !== '평시') emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', imp: 1, text: `${tr.todName}입니다. 도심 간선 도로가 평소보다 밀립니다.` });
    const parked = tr.obstacles.filter((o) => o.kind === 'parked').length;
    if (parked) emit(sim, { role: 'SYSTEM', actor: '도시', kind: 'traffic', imp: 0, truth: true, text: `이면 도로 ${parked}곳에 불법 주차 차량이 길을 좁히고 있습니다. 큰 차는 지나갈 수 없지만 아직 아무도 모릅니다.` });
  }
  if (sim.t >= tr.nextDrift) { tr.nextDrift = sim.t + 12; drift(sim); }
  for (let i = tr.jams.length - 1; i >= 0; i--) if (sim.t >= tr.jams[i].until) tr.jams.splice(i, 1);
  for (let i = tr.crowds.length - 1; i >= 0; i--) {
    if (sim.t < tr.crowds[i].until) continue;
    for (const id of tr.crowds[i].edges) { const e = city.edges[id]; e.bump = Math.max(0, (e.bump ?? 0) - 0.8); if (e.bump < 1e-6) e.bump = 0; }
    tr.crowds.splice(i, 1);
  }
  for (let i = tr.obstacles.length - 1; i >= 0; i--) {
    const o = tr.obstacles[i], e = city.edges[o.edge];
    if (sim.t >= o.until) {
      // 치워졌다
      if (o.full && (e.closedReason === 'roadwork' || e.closedReason === 'obstacle')) { e.closed = false; e.closedReason = null; e.known = undefined; }
      if (o.heavyOnly) e.noHeavy = undefined;
      if (o.known) emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', imp: 0, text: o.full ? `${edgeName(city, e)} 통행 재개.` : `${edgeName(city, e)} ${o.label} 정리 — 정상 소통.` });
      tr.obstacles.splice(i, 1);
    } else if (!o.known && sim.t >= o.tipAt) reportObstacle(sim, o, '교통정보');
  }
  if (sim.t >= tr.nextEvent && !sim.ended) {
    tr.nextEvent = sim.t + rng.range(80, 150) * sim.tune.trafficGap;
    spawn(sim);
  }
  tickRail(sim);
}
