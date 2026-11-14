// CityManager + RoadNetwork + Pathfinder
// 도시는 고정된 도시 시드로 생성되어 교대가 바뀌어도 같은 지도를 쓴다(사건만 달라진다).

import type { Sim } from './engine';
import { emit } from './events';
import { Rng } from './rng';
import type { Building, City, District, Facility, Park, RoadEdge, RoadNode, Route } from './types';
import { clamp } from './util';

export const COLS = 9;
export const ROWS = 6;

function districtOf(c: number, r: number): District {
  if (c === 0 || c === COLS - 1 || r === ROWS - 1) return 'outskirts';
  if (c <= 3) return 'residential';
  if (r <= 2) return 'commercial';
  return 'industrial';
}

export function generateCity(rng: Rng): City {
  const W = 2400, H = 1640;
  const nodes: RoadNode[] = [];
  const nid = (c: number, r: number) => r * COLS + c;
  for (let r = 0; r < ROWS; r++) {
    for (let c = 0; c < COLS; c++) {
      const d = districtOf(c, r);
      const j = d === 'outskirts' ? 46 : 22;
      nodes.push({ id: nid(c, r), c, r, x: 170 + c * 257 + rng.range(-j, j), y: 150 + r * 268 + rng.range(-j, j), district: d, edges: [] });
    }
  }
  const edges: RoadEdge[] = [];
  const addEdge = (a: number, b: number) => {
    const A = nodes[a], B = nodes[b];
    const horiz = A.r === B.r;
    const arterial = (horiz && A.r === 2) || (!horiz && A.c === 4) || (horiz && A.r === 4 && A.c >= 1 && B.c <= 7) || (!horiz && A.c === 1 && B.r <= 4);
    const outs = A.district === 'outskirts' || B.district === 'outskirts';
    const dMain: District = A.district === 'outskirts' ? B.district : A.district;
    const baseCong = (dMain === 'commercial' ? 1.5 : dMain === 'residential' ? 1.2 : dMain === 'industrial' ? 1.25 : 1.0) + (arterial ? 0.15 : 0);
    const e: RoadEdge = {
      id: edges.length, a, b, len: Math.hypot(A.x - B.x, A.y - B.y), speed: arterial ? 31 : outs ? 25 : 21,
      arterial, cong: baseCong, baseCong, closed: false, closedReason: null, slow: 0,
    };
    edges.push(e);
  };
  for (let r = 0; r < ROWS; r++) for (let c = 0; c < COLS; c++) {
    if (c + 1 < COLS) addEdge(nid(c, r), nid(c + 1, r));
    if (r + 1 < ROWS) addEdge(nid(c, r), nid(c, r + 1));
  }
  // 일부 도로 제거 (연결성 유지)
  const alive = edges.map(() => true);
  const connected = (): boolean => {
    const seen = new Uint8Array(nodes.length); const st = [0]; seen[0] = 1; let n = 1;
    while (st.length) {
      const u = st.pop()!;
      for (let i = 0; i < edges.length; i++) {
        if (!alive[i]) continue; const e = edges[i];
        const v = e.a === u ? e.b : e.b === u ? e.a : -1;
        if (v >= 0 && !seen[v]) { seen[v] = 1; n++; st.push(v); }
      }
    }
    return n === nodes.length;
  };
  const degree = (n: number) => edges.reduce((s, e, i) => s + (alive[i] && (e.a === n || e.b === n) ? 1 : 0), 0);
  for (let i = 0; i < edges.length; i++) {
    const e = edges[i]; if (e.arterial) continue;
    const outs = nodes[e.a].district === 'outskirts' || nodes[e.b].district === 'outskirts';
    if (!rng.chance(outs ? 0.3 : 0.08)) continue;
    if (degree(e.a) <= 2 || degree(e.b) <= 2) continue;
    alive[i] = false;
    if (!connected()) alive[i] = true;
  }
  const kept: RoadEdge[] = [];
  for (let i = 0; i < edges.length; i++) if (alive[i]) { const e = edges[i]; e.id = kept.length; kept.push(e); }
  for (const e of kept) { nodes[e.a].edges.push(e.id); nodes[e.b].edges.push(e.id); }

  // 시설
  const fac = (kind: Facility['kind'], name: string, c: number, r: number, id: number): Facility => {
    const n = nodes[nid(c, r)];
    return { id, kind, name, nodeId: n.id, x: n.x + 34, y: n.y - 34 };
  };
  const facilities: Facility[] = [
    fac('fireStation', '중앙소방서', 3, 2, 0),
    fac('fireStation', '공단119안전센터', 6, 4, 1),
    fac('hospital', '시립병원', 5, 1, 2),
    fac('police', '중부경찰서', 2, 1, 3),
    fac('police', '동부지구대', 7, 2, 4),
    fac('public', '시청', 4, 1, 5),
    fac('public', '초등학교', 2, 3, 6),
    fac('public', '물류터미널', 5, 4, 7),
  ];

  // 건물 / 녹지
  const buildings: Building[] = [];
  const parks: Park[] = [];
  for (let r = 0; r < ROWS - 1; r++) for (let c = 0; c < COLS - 1; c++) {
    const n00 = nodes[nid(c, r)], n10 = nodes[nid(c + 1, r)], n01 = nodes[nid(c, r + 1)], n11 = nodes[nid(c + 1, r + 1)];
    const x0 = Math.max(n00.x, n01.x) + 26, x1 = Math.min(n10.x, n11.x) - 26;
    const y0 = Math.max(n00.y, n10.y) + 26, y1 = Math.min(n01.y, n11.y) - 26;
    if (x1 - x0 < 60 || y1 - y0 < 60) continue;
    const ds = [n00.district, n10.district, n01.district, n11.district];
    const outsCount = ds.filter((d) => d === 'outskirts').length;
    const d: District = outsCount >= 2 ? 'outskirts' : ds.find((q) => q !== 'outskirts')!;
    if (d === 'outskirts') {
      const k = rng.int(1, 3);
      for (let i = 0; i < k; i++) parks.push({ x: rng.range(x0 + 20, x1 - 20), y: rng.range(y0 + 20, y1 - 20), r: rng.range(34, 70) });
      const nb = rng.int(0, 3);
      for (let i = 0; i < nb; i++) { const w = rng.range(18, 34), h = rng.range(16, 28); buildings.push({ x: rng.range(x0, x1 - w), y: rng.range(y0, y1 - h), w, h, district: d, tone: rng.next() }); }
      continue;
    }
    const gx = d === 'industrial' ? 2 : d === 'commercial' ? 3 : 4;
    const gy = d === 'industrial' ? 2 : 3;
    const cw = (x1 - x0) / gx, ch = (y1 - y0) / gy;
    for (let iy = 0; iy < gy; iy++) for (let ix = 0; ix < gx; ix++) {
      if (rng.chance(d === 'residential' ? 0.14 : 0.08)) continue;
      const pad = d === 'industrial' ? 9 : 6;
      const w = cw - pad * 2 - rng.range(0, cw * 0.22), h = ch - pad * 2 - rng.range(0, ch * 0.22);
      buildings.push({ x: x0 + ix * cw + pad + rng.range(0, 4), y: y0 + iy * ch + pad + rng.range(0, 4), w, h, district: d, tone: rng.next() });
    }
  }

  const colX = (c: number) => 170 + c * 257;
  const rowY = (r: number) => 150 + r * 268;
  const districts = [
    { district: 'residential' as District, name: '주거 구역', x: colX(1) - 128, y: rowY(0) - 100, w: 257 * 3, h: 268 * 4.5 + 20 },
    { district: 'commercial' as District, name: '상업 구역', x: colX(4) - 128, y: rowY(0) - 100, w: 257 * 4, h: 268 * 2.5 + 100 },
    { district: 'industrial' as District, name: '산업 구역', x: colX(4) - 128, y: rowY(3) - 134, w: 257 * 4, h: 268 * 2 },
    { district: 'outskirts' as District, name: '외곽 구역', x: 0, y: rowY(5) - 134, w: W, h: H - rowY(5) + 134 },
  ];
  return { w: W, h: H, nodes, edges: kept, buildings, facilities, parks, districts };
}

/** 긴급 차량 기준 구간 통과 시간(초) */
export function edgeTime(e: RoadEdge, weatherF = 1): number {
  const congEff = 1 + (e.cong - 1) * 0.5 + e.slow;
  return (e.len / (e.speed * weatherF)) * congEff;
}

/** 다익스트라. 통제(closed)된 도로는 통과할 수 없다. */
export function findRoute(city: City, from: number, to: number, weatherF = 1, avoidEdge = -1): Route | null {
  const n = city.nodes.length;
  const distArr = new Float64Array(n).fill(Infinity);
  const prevEdge = new Int32Array(n).fill(-1);
  const done = new Uint8Array(n);
  distArr[from] = 0;
  for (let it = 0; it < n; it++) {
    let u = -1, best = Infinity;
    for (let i = 0; i < n; i++) if (!done[i] && distArr[i] < best) { best = distArr[i]; u = i; }
    if (u < 0 || u === to) break;
    done[u] = 1;
    for (const eid of city.nodes[u].edges) {
      const e = city.edges[eid];
      if (e.closed || eid === avoidEdge) continue;
      const v = e.a === u ? e.b : e.a;
      const nd = distArr[u] + edgeTime(e, weatherF);
      if (nd < distArr[v]) { distArr[v] = nd; prevEdge[v] = eid; }
    }
  }
  if (!isFinite(distArr[to])) return null;
  const nodes: number[] = [to]; const edges: number[] = [];
  let cur = to;
  while (cur !== from) {
    const e = city.edges[prevEdge[cur]];
    edges.push(e.id);
    cur = e.a === cur ? e.b : e.a;
    nodes.push(cur);
  }
  nodes.reverse(); edges.reverse();
  return { nodes, edges, time: distArr[to] };
}

export function weatherSpeedFactor(sim: Sim): number {
  return sim.weather === 'rain' ? 0.88 : sim.weather === 'fog' ? 0.84 : 1;
}

export function edgeName(city: City, e: RoadEdge): string {
  const A = city.nodes[e.a], B = city.nodes[e.b];
  const horiz = A.r === B.r;
  const base = horiz ? `${A.r + 1}번가` : `${String.fromCharCode(65 + A.c)}로`;
  return `${base} ${horiz ? Math.min(A.c, B.c) + 1 : Math.min(A.r, B.r) + 1}구간`;
}
export function nodeName(city: City, nodeId: number): string {
  const n = city.nodes[nodeId];
  return `${String.fromCharCode(65 + n.c)}로 ${n.r + 1}번가`;
}

interface TrafficState { nextDrift: number; nextEvent: number; jams: { edge: number; until: number }[]; closures: { edge: number; until: number }[] }
export function initTraffic(rng: Rng): TrafficState {
  return { nextDrift: 10, nextEvent: rng.range(70, 130), jams: [], closures: [] };
}

/** 교통량은 개별 차량이 아니라 도로별 수치와 간단한 이벤트로 표현한다. */
export function tickTraffic(sim: Sim): void {
  const tr = sim.traffic, city = sim.city, rng = sim.rngTraffic;
  if (sim.t >= tr.nextDrift) {
    tr.nextDrift = sim.t + 12;
    for (const e of city.edges) {
      const jam = tr.jams.some((j) => j.edge === e.id);
      const target = jam ? 2.8 : e.baseCong;
      e.cong = clamp(e.cong + (target - e.cong) * 0.35 + rng.range(-0.1, 0.1), 1, 3);
    }
  }
  for (let i = tr.jams.length - 1; i >= 0; i--) if (sim.t >= tr.jams[i].until) tr.jams.splice(i, 1);
  for (let i = tr.closures.length - 1; i >= 0; i--) {
    if (sim.t >= tr.closures[i].until) {
      const e = city.edges[tr.closures[i].edge];
      if (e.closedReason === 'roadwork') { e.closed = false; e.closedReason = null; emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', text: `${edgeName(city, e)} 통제 해제.`, imp: 0 }); }
      tr.closures.splice(i, 1);
    }
  }
  if (sim.t >= tr.nextEvent && !sim.ended) {
    tr.nextEvent = sim.t + rng.range(80, 150);
    if (rng.chance(0.55)) {
      const cands = city.edges.filter((e) => (e.arterial || e.baseCong >= 1.4) && !e.closed);
      const e = rng.pick(cands);
      tr.jams.push({ edge: e.id, until: sim.t + rng.range(70, 130) });
      e.cong = Math.max(e.cong, 2.4);
      emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', text: `${edgeName(city, e)} 정체 발생.`, imp: 0 });
    } else {
      const cands = city.edges.filter((e) => !e.closed && !city.facilities.some((f) => f.nodeId === e.a || f.nodeId === e.b));
      const e = rng.pick(cands);
      e.closed = true;
      const ok = findRoute(city, e.a, e.b) !== null;
      if (!ok) { e.closed = false; return; }
      e.closedReason = 'roadwork';
      tr.closures.push({ edge: e.id, until: sim.t + rng.range(70, 120) });
      emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', text: `${edgeName(city, e)} 긴급 도로 공사로 통제.`, imp: 0 });
    }
  }
}
