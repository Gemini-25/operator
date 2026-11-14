// CityManager + RoadNetwork + Pathfinder
// 도시는 cityPlan.ts 의 설계도로 만든다. 교대가 바뀌어도 같은 지도이고(사건만 달라진다),
// 한 번 만든 지도는 다시 쓴다(도로의 혼잡·통제처럼 교대마다 바뀌는 값만 새로 복사한다).

import type { Sim } from './engine';
import { Rng } from './rng';
import { BANKS, CITY_H, CITY_W, COAST, CONVENIENCE, DISTRICTS, EXITS, FACTORIES, KIND_DISTRICT, LAKE, LANDMARKS, MOUNTAINS, NAME_PREFIX, NODES, PENSIONS, RAIL, RESTAURANTS, RIVER, RIVER_NAME, ROADS, SHOPS } from './cityPlan';
import type { DistrictDef } from './cityPlan';
import type { Alley, City, District, Facility, Place, PlaceKind, RoadEdge, RoadNode, Route } from './types';
import { clamp } from './util';

const HALF: Record<string, number> = { highway: 15, arterial: 12.5, street: 9, local: 6.5 };
/** 도로의 반폭 (보도 포함) */
export const roadHalf = (e: RoadEdge): number => HALF[e.cls ?? 'street'];
const SPEED: Record<string, number> = { highway: 44, arterial: 31, street: 23, local: 18 };

export function distSeg(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax, dy = by - ay, t = clamp(((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy || 1), 0, 1);
  return Math.hypot(px - ax - dx * t, py - ay - dy * t);
}
/** 그 x 에서의 해안선. 이보다 남쪽(y 가 큰 쪽)이 바다다. */
export function coastY(x: number): number {
  let i = 0; while (i < COAST.length - 2 && x > COAST[i + 1][0]) i++;
  const A = COAST[i], B = COAST[i + 1];
  return A[1] + ((B[1] - A[1]) * clamp((x - A[0]) / (B[0] - A[0]), 0, 1));
}
/** 강까지의 거리(물가 기준). 음수면 물 위다. */
export function riverDist(x: number, y: number): number {
  let best = Infinity;
  for (let i = 0; i < RIVER.length - 1; i++) {
    const A = RIVER[i], B = RIVER[i + 1], dx = B[0] - A[0], dy = B[1] - A[1];
    const t = clamp(((x - A[0]) * dx + (y - A[1]) * dy) / (dx * dx + dy * dy), 0, 1);
    const d = Math.hypot(x - A[0] - dx * t, y - A[1] - dy * t) - (A[2] + (B[2] - A[2]) * t) / 2;
    if (d < best) best = d;
  }
  return best;
}
/** 산·숲의 짙기 (0 = 평지, 1 = 산 한가운데) */
export function mountainAt(x: number, y: number): number {
  let m = 0;
  for (const q of MOUNTAINS) m = Math.max(m, 1 - ((x - q.x) / q.rx) ** 2 - ((y - q.y) / q.ry) ** 2);
  return Math.max(0, m);
}
/** 그 지점이 속한 동네 (가장 영향이 큰 곳). pick 을 주면 경계에서 옆 동네와 섞인다. */
export function districtAt(x: number, y: number, pick?: number): DistrictDef | null {
  let best: DistrictDef | null = null, bw = 0, sum = 0;
  const ws: number[] = [];
  for (const d of DISTRICTS) { const w = Math.max(0, 1 - Math.hypot(x - d.x, y - d.y) / (d.r * 1.22)) ** 1.6; ws.push(w); sum += w; if (w > bw) { bw = w; best = d; } }
  if (pick === undefined || sum <= 0) return best;
  let r = pick * sum;
  for (let i = 0; i < ws.length; i++) { r -= ws[i]; if (r <= 0) return DISTRICTS[i]; }
  return best;
}

export interface Box { cx: number; cy: number; w: number; h: number; rot: number }
/** 선분과 돌려 놓인 직사각형 사이의 최소 거리 (겹치면 0) */
export function rectSegDist(b: Box, ax: number, ay: number, bx: number, by: number): number {
  const c = Math.cos(-b.rot), s = Math.sin(-b.rot), hw = b.w / 2, hh = b.h / 2;
  const x0 = (ax - b.cx) * c - (ay - b.cy) * s, y0 = (ax - b.cx) * s + (ay - b.cy) * c;
  const x1 = (bx - b.cx) * c - (by - b.cy) * s, y1 = (bx - b.cx) * s + (by - b.cy) * c;
  // 선분이 직사각형을 지나는가 (잘라 보기)
  const dx = x1 - x0, dy = y1 - y0;
  let t0 = 0, t1 = 1, hit = true;
  for (const [pp, qq] of [[-dx, x0 + hw], [dx, hw - x0], [-dy, y0 + hh], [dy, hh - y0]]) {
    if (pp === 0) { if (qq < 0) { hit = false; break; } continue; }
    const r = qq / pp;
    if (pp < 0) { if (r > t1) { hit = false; break; } if (r > t0) t0 = r; } else { if (r < t0) { hit = false; break; } if (r < t1) t1 = r; }
  }
  if (hit) return 0;
  const ptRect = (x: number, y: number): number => Math.hypot(Math.max(Math.abs(x) - hw, 0), Math.max(Math.abs(y) - hh, 0));
  let d = Math.min(ptRect(x0, y0), ptRect(x1, y1));
  for (const [qx, qy] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) d = Math.min(d, distSeg(qx, qy, x0, y0, x1, y1));
  return d;
}
/** 두 선분이 (끝점이 아닌 곳에서) 만나는가 */
export function segCross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): boolean {
  const o = (px: number, py: number, qx: number, qy: number, rx: number, ry: number): number => (qx - px) * (ry - py) - (qy - py) * (rx - px);
  const d1 = o(cx, cy, dx, dy, ax, ay), d2 = o(cx, cy, dx, dy, bx, by), d3 = o(ax, ay, bx, by, cx, cy), d4 = o(ax, ay, bx, by, dx, dy);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

/** 도로로 둘러싸인 칸(블록)을 찾는다: 반변을 따라 돌며 면을 구한다. 가장 큰 것(바깥)은 뺀다. */
export function cityFaces(nodes: RoadNode[], edges: RoadEdge[]): { ns: number[]; es: number[]; area: number; cx: number; cy: number }[] {
  const order = nodes.map((n) => n.edges.map((id) => { const e = edges[id], o = nodes[e.a === n.id ? e.b : e.a]; return { id, ang: Math.atan2(o.y - n.y, o.x - n.x) }; }).sort((p, q) => p.ang - q.ang || p.id - q.id).map((p) => p.id));
  const used = new Set<number>();
  const out: { ns: number[]; es: number[]; area: number; cx: number; cy: number }[] = [];
  for (const e of edges) for (const dir of [0, 1]) {
    if (used.has(e.id * 2 + dir)) continue;
    const ns: number[] = [], es: number[] = [];
    let ce = e.id, cd = dir, guard = 0;
    while (!used.has(ce * 2 + cd) && guard++ < 600) {
      used.add(ce * 2 + cd);
      const E = edges[ce], from = cd === 0 ? E.a : E.b, to = cd === 0 ? E.b : E.a;
      ns.push(from); es.push(ce);
      const lst = order[to], nx = lst[(lst.indexOf(ce) + lst.length - 1) % lst.length];      // 온 길 바로 옆(시계 방향)의 길로 꺾는다
      cd = edges[nx].a === to ? 0 : 1; ce = nx;
    }
    let area = 0, cx = 0, cy = 0;
    for (let i = 0; i < ns.length; i++) { const P = nodes[ns[i]], Q = nodes[ns[(i + 1) % ns.length]], cr = P.x * Q.y - Q.x * P.y; area += cr; cx += (P.x + Q.x) * cr; cy += (P.y + Q.y) * cr; }
    area /= 2;
    out.push({ ns, es, area, cx: area ? cx / (6 * area) : 0, cy: area ? cy / (6 * area) : 0 });
  }
  out.sort((p, q) => Math.abs(q.area) - Math.abs(p.area));
  return out.slice(1);
}

/**
 * 이면 도로: 큰 블록의 가장 긴 변에서 맞은편 변까지 좁은 길을 낸다. 설계도(cityPlan)는 큰 뼈대만 갖고, 블록 안의 작은 길은 여기서 생긴다.
 * 기존 교차로·구간의 번호는 바뀌지 않는다(새 교차로와 구간은 끝에 붙는다. 쪼갠 구간의 앞 토막이 원래 번호를 물려받는다).
 */
function addLocalStreets(rng: Rng, nodes: RoadNode[], edges: RoadEdge[]): void {
  const span = new Map<number, number>();      // 쪼개는 동안 seq 를 실수로 다룬다 (도로 위의 순서를 지키기 위해)
  const lm: Box[] = LANDMARKS.map((l) => ({ cx: l.x, cy: l.y, w: l.w, h: l.h, rot: ((l.rot ?? 0) * Math.PI) / 180 }));
  const count = new Map<string, number>();
  let roadNo = ROADS.length, localNode = 0;
  const landOk = (x: number, y: number): boolean => x > 30 && y > 30 && x < CITY_W - 30 && y < CITY_H - 30 && y < coastY(x) - 16 && riverDist(x, y) > 14 && mountainAt(x, y) < 0.3 && ((x - LAKE.x) / (LAKE.rx + 20)) ** 2 + ((y - LAKE.y) / (LAKE.ry + 20)) ** 2 > 1;
  /** 새 길의 한 토막이 놓일 수 있는가 (ig = 닿아도 되는 구간들) */
  const segOk = (ax: number, ay: number, bx: number, by: number, ig: number[]): boolean => {
    for (let k = 1; k < 8; k++) if (!landOk(ax + ((bx - ax) * k) / 8, ay + ((by - ay) * k) / 8)) return false;
    for (let i = 0; i < RAIL.length - 1; i++) if (segCross(ax, ay, bx, by, RAIL[i][0], RAIL[i][1], RAIL[i + 1][0], RAIL[i + 1][1])) return false;
    for (const b of lm) if (rectSegDist(b, ax, ay, bx, by) < 20) return false;
    for (const e of edges) {
      if (ig.indexOf(e.id) >= 0) continue;
      const A = nodes[e.a], B = nodes[e.b];
      if (segCross(ax, ay, bx, by, A.x, A.y, B.x, B.y)) return false;
      if (distSeg(A.x, A.y, ax, ay, bx, by) < 34 || distSeg(B.x, B.y, ax, ay, bx, by) < 34) return false;      // 다른 길의 끝에 너무 붙지 않는다
    }
    return true;
  };
  const split = (ei: number, t: number): number => {
    const E = edges[ei], A = nodes[E.a], B = nodes[E.b], x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t;
    const N: RoadNode = { id: nodes.length, x, y, c: 0, r: 0, district: districtAt(x, y)?.district ?? 'outskirts', edges: [], key: `L${localNode++}` };
    nodes.push(N);
    const sp = span.get(ei) ?? 1;
    const E2: RoadEdge = { ...E, id: edges.length, a: N.id, b: E.b, len: Math.hypot(B.x - x, B.y - y), seq: (E.seq ?? 0) + sp / 2 };
    edges.push(E2); span.set(ei, sp / 2); span.set(E2.id, sp / 2);
    B.edges[B.edges.indexOf(ei)] = E2.id;
    E.b = N.id; E.len = Math.hypot(A.x - x, A.y - y);
    N.edges.push(ei, E2.id);
    return N.id;
  };
  const link = (a: number, b: number, name: string, road: number, seq: number): void => {
    const A = nodes[a], B = nodes[b], d = districtAt((A.x + B.x) / 2, (A.y + B.y) / 2)?.district ?? 'outskirts';
    const baseCong = d === 'commercial' ? 1.5 : d === 'residential' ? 1.2 : d === 'industrial' ? 1.25 : 1.0;
    const e: RoadEdge = { id: edges.length, a, b, len: Math.hypot(A.x - B.x, A.y - B.y), speed: SPEED.local, arterial: false, cong: baseCong, baseCong, closed: false, closedReason: null, slow: 0, name, cls: 'local', road, seq, bridge: false };
    edges.push(e); A.edges.push(e.id); B.edges.push(e.id);
  };
  const failed = new Set<string>();
  let made = 0;
  while (made < 66) {
    const fs = cityFaces(nodes, edges).filter((f) => Math.abs(f.area) > 46000 && !failed.has([...f.ns].sort((p, q) => p - q).join(',')));
    let done = false;
    for (const f of fs) {
      const fk = [...f.ns].sort((p, q) => p - q).join(',');
      const D = districtAt(f.cx, f.cy);
      if (!D || D.density < 0.5 || !landOk(f.cx, f.cy)) { failed.add(fk); continue; }
      const poly = f.ns.map((id) => nodes[id]);
      const inside = (x: number, y: number): boolean => { let c = false; for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) { const P = poly[i], Q = poly[j]; if ((P.y > y) !== (Q.y > y) && x < ((Q.x - P.x) * (y - P.y)) / (Q.y - P.y) + P.x) c = !c; } return c; };
      const sides = [...new Set(f.es)].filter((id) => f.es.indexOf(id) === f.es.lastIndexOf(id)).sort((p, q) => edges[q].len - edges[p].len || p - q);
      for (const [ei, t1] of sides.flatMap((id) => [[id, rng.range(0.4, 0.6)], [id, 0.33], [id, 0.67]])) {
        const E = edges[ei];
        if (E.cls === 'highway' || E.bridge || E.len < 120) continue;
        const A = nodes[E.a], B = nodes[E.b], px = A.x + (B.x - A.x) * t1, py = A.y + (B.y - A.y) * t1;
        let nx = -(B.y - A.y) / E.len, ny = (B.x - A.x) / E.len;
        if (!inside(px + nx * 12, py + ny * 12)) { nx = -nx; ny = -ny; if (!inside(px + nx * 12, py + ny * 12)) continue; }
        // 맞은편 변: 안쪽 법선 방향으로 쏜 반직선이 처음 만나는 변
        let be = -1, bs = Infinity, bu = 0;
        for (const ej of sides) {
          if (ej === ei) continue;
          const C = nodes[edges[ej].a], Dd = nodes[edges[ej].b], rx = Dd.x - C.x, ry = Dd.y - C.y, den = nx * ry - ny * rx;
          if (Math.abs(den) < 1e-6) continue;
          const sdist = ((C.x - px) * ry - (C.y - py) * rx) / den, u = ((C.x - px) * ny - (C.y - py) * nx) / den;
          if (sdist > 1 && u >= 0 && u <= 1 && sdist < bs) { bs = sdist; be = ej; bu = u; }
        }
        if (be < 0 || bs < 76 || bs > 520) continue;
        const E2 = edges[be];
        if (E2.cls === 'highway' || E2.bridge || E2.len < 120) continue;
        const um = 48 / E2.len, u2 = clamp(bu + rng.range(-0.07, 0.07), um, 1 - um), C = nodes[E2.a], Dd = nodes[E2.b];
        const qx = C.x + (Dd.x - C.x) * u2, qy = C.y + (Dd.y - C.y) * u2, L = Math.hypot(qx - px, qy - py);
        if (L < 76 || ((qx - px) * nx + (qy - py) * ny) / L < 0.72) continue;      // 너무 비스듬하면 내지 않는다
        if (Math.min(t1, 1 - t1) * E.len < 48) continue;
        // 긴 길은 가운데에서 살짝 꺾는다
        const bend = L > 250, k = bend ? (rng.chance(0.5) ? 1 : -1) * rng.range(12, 20) : 0, mx = (px + qx) / 2 - ((qy - py) / L) * k, my = (py + qy) / 2 + ((qx - px) / L) * k;
        const ok = bend ? segOk(px, py, mx, my, [ei, be]) && segOk(mx, my, qx, qy, [ei, be]) && landOk(mx, my) : segOk(px, py, qx, qy, [ei, be]);
        if (!ok) continue;
        const c = (count.get(E.name) ?? 0) + 1; count.set(E.name, c);
        const name = `${E.name} ${c * 2}길`, n1 = split(ei, t1), n2 = split(be, u2);
        if (bend) {
          const M: RoadNode = { id: nodes.length, x: mx, y: my, c: 0, r: 0, district: districtAt(mx, my)?.district ?? 'outskirts', edges: [], key: `L${localNode++}` };
          nodes.push(M); link(n1, M.id, name, roadNo, 0); link(M.id, n2, name, roadNo, 1);
        } else link(n1, n2, name, roadNo, 0);
        roadNo++; made++; done = true;
        break;
      }
      if (done) break;
      failed.add(fk);
    }
    if (!done) break;
  }
  // 도로마다 구간 번호를 다시 매긴다 (쪼갠 순서와 상관없이 도로를 따라 0, 1, 2 …)
  const byRoad = new Map<number, RoadEdge[]>();
  for (const e of edges) { let l = byRoad.get(e.road!); if (!l) byRoad.set(e.road!, (l = [])); l.push(e); }
  for (const l of byRoad.values()) { l.sort((p, q) => (p.seq ?? 0) - (q.seq ?? 0) || p.id - q.id); l.forEach((e, i) => { e.seq = i; }); }
}

let cached: City | null = null;
/** 도시를 만든다. 지도 자체는 고정이므로 한 번만 만들고, 교대마다 바뀌는 도로 상태만 새로 복사해 돌려준다. */
export function generateCity(rng: Rng): City {
  if (!cached) cached = buildCity(rng);
  // 교대 중에 붙는 칸(교통·재난)을 처음부터 같은 순서로 비워 둔다: 모든 구간이 같은 모양의 객체가 되어 경로 계산이 빨라진다 (값은 없는 것과 같다)
  return { ...cached, edges: cached.edges.map((e) => ({ ...e, known: undefined, bump: undefined, wait: undefined, gateT: undefined, noHeavy: undefined })) };
}

function buildCity(rng: Rng): City {
  const keys = Object.keys(NODES), idx = new Map(keys.map((k, i) => [k, i]));
  const nodes: RoadNode[] = keys.map((k, i) => ({ id: i, x: NODES[k][0], y: NODES[k][1], c: 0, r: 0, district: districtAt(NODES[k][0], NODES[k][1])?.district ?? 'outskirts', edges: [], key: k, exit: EXITS.indexOf(k) >= 0 }));
  const edges: RoadEdge[] = [];
  const seen = new Set<number>();
  ROADS.forEach((rd, ri) => {
    for (let k = 0; k + 1 < rd.path.length; k++) {
      const a = idx.get(rd.path[k]), b = idx.get(rd.path[k + 1]);
      if (a === undefined || b === undefined) throw new Error(`도로 ${rd.name}: 없는 교차로 ${rd.path[k]} / ${rd.path[k + 1]}`);
      const key = Math.min(a, b) * 1000 + Math.max(a, b); if (seen.has(key)) continue; seen.add(key);
      const A = nodes[a], B = nodes[b], mx = (A.x + B.x) / 2, my = (A.y + B.y) / 2;
      const d: District = districtAt(mx, my)?.district ?? 'outskirts', major = rd.cls === 'arterial' || rd.cls === 'highway';
      const baseCong = rd.cls === 'highway' ? 1.1 : (d === 'commercial' ? 1.5 : d === 'residential' ? 1.2 : d === 'industrial' ? 1.25 : 1.0) + (major ? 0.15 : 0);
      let bridge = false;
      for (let q = 0; q <= 20; q++) if (riverDist(A.x + (B.x - A.x) * (q / 20), A.y + (B.y - A.y) * (q / 20)) < 0) bridge = true;
      edges.push({ id: edges.length, a, b, len: Math.hypot(A.x - B.x, A.y - B.y), speed: SPEED[rd.cls], arterial: major, cong: baseCong, baseCong, closed: false, closedReason: null, slow: 0, name: rd.name, cls: rd.cls, road: ri, seq: k, bridge });
    }
  });
  for (const e of edges) { nodes[e.a].edges.push(e.id); nodes[e.b].edges.push(e.id); }
  addLocalStreets(rng.fork('local-streets'), nodes, edges);
  const built = buildPlaces(rng.fork('places-v2'), nodes, edges);
  // 출동 시설: 설계도에 적힌 순서대로 번호를 붙인다. 차량은 시설 앞마당에 선다.
  const facilities: Facility[] = [];
  for (const q of built.places) {
    if (q.facility < 0) continue;
    const def = LANDMARKS.filter((l) => l.facility)[q.facility];
    facilities[q.facility] = { id: q.facility, kind: def.facility!, name: q.name, nodeId: q.nodeId, x: q.x + 18, y: q.y + 52 };
  }
  const districts = DISTRICTS.map((d) => ({ district: d.district, name: d.dong, x: d.x - d.r, y: d.y - d.r, w: d.r * 2, h: d.r * 2 }));
  return {
    w: CITY_W, h: CITY_H, nodes, edges, buildings: built.places.filter((q) => !q.open), facilities, parks: [], districts,
    places: built.places, alleys: built.alleys, blocks: [], river: { pts: RIVER, w: RIVER[RIVER.length - 1][2], name: RIVER_NAME },
    coast: COAST, rail: RAIL, mountains: MOUNTAINS, lake: LAKE,
  };
}

// ───────────────────────── 건물과 터 ─────────────────────────
// 손으로 정한 건물(LANDMARKS)을 먼저 놓고, 나머지는 길가를 따라 채운다. 건물은 도로와 나란히 놓이고,
// 그 자리의 동네 성격(DISTRICTS.mix)에 따라 종류가 정해진다. 동네의 경계에서는 두 동네의 건물이 섞인다.

export const facilityRect = (f: Facility): { x: number; y: number; w: number; h: number } => ({ x: f.x - 18, y: f.y - 52, w: 78, h: 62 });

/** 종류별 크기: [길 쪽 폭 최소, 최대, 깊이 최소, 최대, 층수, 길에서 물러난 거리, 눈에 띄는 정도] */
const DIM: Partial<Record<PlaceKind, number[]>> = {
  houseS: [20, 25, 17, 21, 1, 7, 0], houseL: [32, 40, 24, 29, 2, 8, 0], villa: [28, 36, 22, 27, 3, 5, 1], apartment: [66, 78, 16, 18, 6, 12, 1], officetel: [26, 32, 24, 30, 8, 4, 1], dorm: [40, 50, 18, 22, 4, 7, 1],
  shop: [20, 28, 20, 26, 2, 2.5, 1], convenience: [17, 21, 16, 19, 1, 2.5, 1], restaurant: [20, 27, 20, 25, 2, 2.5, 1], cafe: [17, 22, 16, 20, 1, 3, 1], clinic: [22, 28, 20, 24, 3, 3, 1],
  bank: [28, 34, 24, 28, 3, 3, 2], office: [32, 46, 28, 38, 7, 4, 1], hotel: [40, 50, 30, 36, 9, 5, 2], church: [22, 26, 32, 38, 2, 6, 2], gasStation: [34, 40, 26, 30, 1, 5, 2],
  factory: [60, 84, 40, 52, 2, 9, 1], warehouse: [56, 88, 28, 36, 1, 8, 1], workshop: [30, 40, 24, 30, 1, 5, 1], utility: [18, 20, 14, 16, 1, 6, 1], storage: [46, 54, 40, 46, 1, 8, 1],
  farmhouse: [22, 26, 17, 20, 1, 9, 0], pension: [26, 30, 19, 22, 2, 8, 1], greenhouse: [40, 48, 11, 13, 1, 10, 0], parking: [40, 60, 26, 34, 0, 4, 0],
};
/** 블록 안쪽(길에서 떨어진 곳)에 들어설 수 있는 종류 */
const INNER_OK: Partial<Record<PlaceKind, boolean>> = { houseS: true, houseL: true, villa: true, apartment: true, dorm: true, factory: true, warehouse: true, workshop: true, storage: true, farmhouse: true, greenhouse: true, pension: true, parking: true, office: true, officetel: true };

/** 돌려 놓인 두 직사각형이 (여유 m 안으로) 겹치는가 */
export function obbHit(a: Box, b: Box, m: number): boolean {
  const ax = Math.cos(a.rot), ay = Math.sin(a.rot), bx = Math.cos(b.rot), by = Math.sin(b.rot), dx = b.cx - a.cx, dy = b.cy - a.cy;
  for (const [ux, uy] of [[ax, ay], [-ay, ax], [bx, by], [-by, bx]]) {
    const ra = (a.w / 2 + m) * Math.abs(ux * ax + uy * ay) + (a.h / 2 + m) * Math.abs(-ux * ay + uy * ax);
    const rb = (b.w / 2) * Math.abs(ux * bx + uy * by) + (b.h / 2) * Math.abs(-ux * by + uy * bx);
    if (Math.abs(dx * ux + dy * uy) > ra + rb) return false;
  }
  return true;
}
export const boxOf = (q: Place): Box => ({ cx: q.x + q.w / 2, cy: q.y + q.h / 2, w: q.w, h: q.h, rot: q.rot ?? 0 });

function buildPlaces(pr: Rng, nodes: RoadNode[], edges: RoadEdge[]): { places: Place[]; alleys: Alley[] } {
  const places: Place[] = [], alleys: Alley[] = [];
  const CELL = 110, grid = new Map<number, number[]>();
  const gk = (x: number, y: number): number => Math.floor(x / CELL) * 1000 + Math.floor(y / CELL);
  const index = (q: Place): void => { const b = boxOf(q), r = Math.hypot(b.w, b.h) / 2; for (let gx = b.cx - r; gx <= b.cx + r + CELL; gx += CELL) for (let gy = b.cy - r; gy <= b.cy + r + CELL; gy += CELL) { const k = gk(gx, gy); let l = grid.get(k); if (!l) grid.set(k, (l = [])); if (l.indexOf(q.id) < 0) l.push(q.id); } };
  const usedNames = new Map<string, number>();
  const uniq = (name: string): string => {
    const n = (usedNames.get(name) ?? 0) + 1; usedNames.set(name, n);
    if (n === 1) return name;
    if (name.endsWith('지점')) return `${name.slice(0, -2)}${n}지점`;
    if (/(빌라|연립|맨션|오피스텔|창고|저장소|주차장|정압실|주유소|기숙사)$/.test(name)) return `${name} ${n}차`;
    if (/(빌딩|타워|프라자|센터|호텔|교회)$/.test(name)) return `${name} ${n === 2 ? '별관' : `${n}관`}`;
    return `${name} ${n}호점`;
  };
  const pre = (): string => pr.pick(NAME_PREFIX);
  const aptNo = new Map<string, number>();
  const nameOf = (kind: PlaceKind, dong: string): string => {
    switch (kind) {
      case 'houseS': return '작은 단독주택'; case 'houseL': return '큰 단독주택'; case 'farmhouse': return '농가 주택'; case 'greenhouse': return '비닐하우스';
      case 'villa': return uniq(`${pre()}${pr.pick(['빌라', '연립', '맨션'])}`);
      case 'apartment': { const n = (aptNo.get(dong) ?? 100) + 1; aptNo.set(dong, n); return `${dong.replace(/동$/, '')}아파트 ${n}동`; }
      case 'officetel': return uniq(`${pre()}오피스텔`); case 'dorm': return uniq(`${dong} 기숙사`);
      case 'shop': return uniq(`${pre()} ${pr.pick(SHOPS)}`); case 'convenience': return uniq(`${pr.pick(CONVENIENCE)} ${dong}점`);
      case 'restaurant': return uniq(pr.pick(RESTAURANTS)); case 'cafe': return uniq(`카페 ${pr.pick(['모모', '온도', '결', '숲', '파도', '다락', '봄날', '느루', '여름', '고요'])}`);
      case 'clinic': return uniq(`${pre()}${pr.pick(['내과', '치과', '한의원', '정형외과', '소아과', '안과'])}`);
      case 'bank': return uniq(`${pr.pick(BANKS)} ${dong}지점`); case 'office': return uniq(`${pre()}${pr.pick(['빌딩', '타워', '프라자', '센터'])}`);
      case 'hotel': return uniq(`${pre()}호텔`); case 'church': return uniq(`${pre()}교회`); case 'gasStation': return uniq(`${dong} 주유소`);
      case 'factory': return uniq(`${pre()}${pr.pick(FACTORIES)}`); case 'warehouse': return uniq(`${pre()}창고`);
      case 'workshop': return uniq(`${pre()}${pr.pick(['공업사', '카센터', '철공소', '목공소', '인쇄소'])}`);
      case 'utility': return uniq(`${dong} 가스 정압실`); case 'storage': return uniq(`${dong} 저장소`); case 'pension': return uniq(`${pr.pick(PENSIONS)} 펜션`);
      case 'parking': return uniq(`${dong} 주차장`);
      default: return dong;
    }
  };
  const mk = (kind: PlaceKind, name: string, cx: number, cy: number, w: number, h: number, rot: number, floors: number, open: boolean, rank: number, dong: string): Place => {
    const q: Place = { id: places.length, kind, name, addr: '', x: cx - w / 2, y: cy - h / 2, w, h, district: KIND_DISTRICT[kind] ?? districtAt(cx, cy)?.district ?? 'outskirts', tone: pr.next(), block: -1, dong, nodeId: -1, cx: 0, cy: 0, open, floors, facility: -1, rot, rank };
    places.push(q); index(q);
    return q;
  };
  const dongAt = (x: number, y: number): string => districtAt(x, y)?.dong ?? (mountainAt(x, y) > 0 ? '산촌' : '외곽');

  // 1) 손으로 자리를 정한 건물과 터
  let fac = 0;
  for (const l of LANDMARKS) {
    const q = mk(l.kind, l.name, l.x, l.y, l.w, l.h, ((l.rot ?? 0) * Math.PI) / 180, l.floors ?? 1, !!l.open, l.rank ?? 2, dongAt(l.x, l.y));
    if (l.facility) q.facility = fac++;
  }
  for (const m of MOUNTAINS) mk('forest', m.name, m.x, m.y, m.rx * 1.7, m.ry * 1.7, 0, 0, true, 2, dongAt(m.x, m.y));
  mk('reservoir', LAKE.name, LAKE.x, LAKE.y, LAKE.rx * 2, LAKE.ry * 2, 0, 0, true, 3, '산촌');
  // 강 둔치: 다리와 다리 사이를 한 구간으로 본다
  {
    const cuts: number[] = [0];
    for (const e of edges) { if (!e.bridge) continue; const A = nodes[e.a], B = nodes[e.b]; let bs = 0, bd = Infinity, acc = 0; for (let i = 0; i < RIVER.length - 1; i++) { const P = RIVER[i], Q = RIVER[i + 1], sl = Math.hypot(Q[0] - P[0], Q[1] - P[1]); for (let k = 0; k <= 10; k++) { const x = P[0] + ((Q[0] - P[0]) * k) / 10, y = P[1] + ((Q[1] - P[1]) * k) / 10, d = distSeg(x, y, A.x, A.y, B.x, B.y); if (d < bd) { bd = d; bs = acc + (sl * k) / 10; } } acc += sl; } cuts.push(bs); }
    let total = 0; for (let i = 0; i < RIVER.length - 2; i++) total += Math.hypot(RIVER[i + 1][0] - RIVER[i][0], RIVER[i + 1][1] - RIVER[i][1]);
    cuts.push(total); cuts.sort((a, b) => a - b);
    const at = (s: number): number[] => { let acc = 0; for (let i = 0; i < RIVER.length - 1; i++) { const P = RIVER[i], Q = RIVER[i + 1], sl = Math.hypot(Q[0] - P[0], Q[1] - P[1]); if (s <= acc + sl || i === RIVER.length - 2) { const t = clamp((s - acc) / sl, 0, 1); return [P[0] + (Q[0] - P[0]) * t, P[1] + (Q[1] - P[1]) * t, P[2] + (Q[2] - P[2]) * t]; } acc += sl; } return RIVER[0]; };
    let n = 0;
    for (let i = 0; i + 1 < cuts.length; i++) {
      if (cuts[i + 1] - cuts[i] < 90) continue;
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let k = 0; k <= 8; k++) { const p = at(cuts[i] + 14 + ((cuts[i + 1] - cuts[i] - 28) * k) / 8), r = p[2] / 2 + 15; x0 = Math.min(x0, p[0] - r); x1 = Math.max(x1, p[0] + r); y0 = Math.min(y0, p[1] - 4); y1 = Math.max(y1, p[1] + 4); }
      mk('riverside', `${RIVER_NAME} 둔치 ${++n}구간`, (x0 + x1) / 2, (y0 + y1) / 2, x1 - x0, y1 - y0, 0, 0, true, 1, dongAt((x0 + x1) / 2, (y0 + y1) / 2));
    }
  }
  const reserved = places.filter((q) => q.kind !== 'forest' && q.kind !== 'riverside' && q.kind !== 'beach').map((q) => q.id);

  // 지형·도로와 겹치는지
  const pointOk = (x: number, y: number, skip: number): boolean => {
    if (x < 14 || y < 14 || x > CITY_W - 14 || y > CITY_H - 14) return false;
    if (y > coastY(x) - 9 || riverDist(x, y) < 8) return false;
    if (((x - LAKE.x) / (LAKE.rx + 10)) ** 2 + ((y - LAKE.y) / (LAKE.ry + 10)) ** 2 < 1) return false;
    for (let i = 0; i < RAIL.length - 1; i++) if (distSeg(x, y, RAIL[i][0], RAIL[i][1], RAIL[i + 1][0], RAIL[i + 1][1]) < 9) return false;
    for (const e of edges) { if (e.id === skip) continue; const A = nodes[e.a], B = nodes[e.b]; if (distSeg(x, y, A.x, A.y, B.x, B.y) < roadHalf(e) + 3.5) return false; }
    for (let i = 0; i < alleys.length; i++) { if (-2 - i === skip) continue; const a = alleys[i]; if (distSeg(x, y, a.x0, a.y0, a.x1, a.y1) < 6) return false; }
    return true;
  };
  /** 물·지도 밖이 아닌가 (한 점) */
  const dryOk = (x: number, y: number): boolean => x >= 14 && y >= 14 && x <= CITY_W - 14 && y <= CITY_H - 14 && y <= coastY(x) - 9 && riverDist(x, y) >= 8 && ((x - LAKE.x) / (LAKE.rx + 10)) ** 2 + ((y - LAKE.y) / (LAKE.ry + 10)) ** 2 >= 1;
  /** 상자가 도로·골목·철길에 닿지 않는가 (선분과 직사각형의 정확한 거리). gap = 도로 가장자리에서 띄울 거리 */
  const clearOfRoads = (b: Box, skip: number, gap: number, rail = true): string | null => {
    const br = Math.hypot(b.w, b.h) / 2;
    if (rail) for (let i = 0; i < RAIL.length - 1; i++) if (rectSegDist(b, RAIL[i][0], RAIL[i][1], RAIL[i + 1][0], RAIL[i + 1][1]) < 8) return '철길';
    for (const e of edges) {
      if (e.id === skip) continue;
      const A = nodes[e.a], B = nodes[e.b], lim = roadHalf(e) + gap;
      if (distSeg(b.cx, b.cy, A.x, A.y, B.x, B.y) > br + lim) continue;
      if (rectSegDist(b, A.x, A.y, B.x, B.y) < lim) return e.name;
    }
    for (let i = 0; i < alleys.length; i++) { if (-2 - i === skip) continue; const a = alleys[i]; if (rectSegDist(b, a.x0, a.y0, a.x1, a.y1) < 5.5) return a.name; }
    return null;
  };
  const boxOk = (b: Box, skip: number, margin: number): boolean => {
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    // 둘레를 6 간격으로 훑어 물과 지도 밖을 본다
    const nx = Math.max(2, Math.ceil(b.w / 6)), ny = Math.max(2, Math.ceil(b.h / 6));
    const at = (lx: number, ly: number): boolean => dryOk(b.cx + lx * c - ly * s, b.cy + lx * s + ly * c);
    if (!at(0, 0)) return false;
    for (let k = 0; k <= nx; k++) { const lx = -b.w / 2 + (b.w * k) / nx; if (!at(lx, -b.h / 2) || !at(lx, b.h / 2)) return false; }
    for (let k = 1; k < ny; k++) { const ly = -b.h / 2 + (b.h * k) / ny; if (!at(-b.w / 2, ly) || !at(b.w / 2, ly)) return false; }
    if (clearOfRoads(b, skip, 2.4)) return false;
    const r = Math.hypot(b.w, b.h) / 2 + margin, done = new Set<number>();
    for (let gx = b.cx - r; gx <= b.cx + r + CELL; gx += CELL) for (let gy = b.cy - r; gy <= b.cy + r + CELL; gy += CELL) {
      for (const id of grid.get(gk(gx, gy)) ?? []) { if (done.has(id)) continue; done.add(id); const q = places[id]; if (q.open && reserved.indexOf(id) < 0) continue; if (obbHit(b, boxOf(q), q.open || q.facility >= 0 ? 6 : margin)) return false; }
    }
    return true;
  };
  // 손으로 놓은 건물도 도로·철길에 닿으면 안 된다 (터는 물가나 길에 걸칠 수 있다). 걸리면 cityPlan.ts 의 좌표를 고친다
  {
    const bad: string[] = [];
    for (const q of places) { if (q.open || !LANDMARKS.some((l) => l.name === q.name)) continue; const hit = clearOfRoads(boxOf(q), -1, 1, q.kind !== 'station'); if (hit) bad.push(`${q.name} ↔ ${hit}`); }
    for (let i = 0; i < places.length; i++) for (let j = i + 1; j < places.length; j++) { const a = places[i], b = places[j]; if (a.open || b.open) continue; if (obbHit(boxOf(a), boxOf(b), 1)) bad.push(`${a.name} ↔ ${b.name}`); }
    if (bad.length) throw new Error('설계도의 건물이 도로나 다른 건물과 겹친다: ' + bad.join(', '));
  }
  const pickKind = (D: DistrictDef, inner: boolean, maxW: number): PlaceKind | null => {
    const ks = (Object.keys(D.mix) as PlaceKind[]).filter((k) => DIM[k] && (!inner || INNER_OK[k]) && DIM[k]![0] <= maxW);
    return ks.length ? pr.weighted(ks, ks.map((k) => D.mix[k]!)) : null;
  };
  const RURAL: DistrictDef = { dong: '외곽', x: 0, y: 0, r: 1, district: 'outskirts', density: 0.1, mix: { farmhouse: 2, greenhouse: 1.5, houseS: 0.6, warehouse: 0.15 } };
  const fronts = new Map<number, number>();      // place id → 면한 도로(0 이상) 또는 골목(-2 이하)

  /** 선분의 양쪽에 건물을 줄지어 놓는다 */
  const frontage = (ax: number, ay: number, bx: number, by: number, half: number, key: number, s0: number, s1: number, maxW: number): void => {
    const len = Math.hypot(bx - ax, by - ay), ux = (bx - ax) / len, uy = (by - ay) / len, ang = Math.atan2(uy, ux);
    for (const side of [1, -1]) {
      const nx = -uy * side, ny = ux * side;
      let s = s0;
      while (s < len - s1 - 14) {
        const px = ax + ux * s, py = ay + uy * s;
        const D = districtAt(px + nx * 34, py + ny * 34, pr.next()) ?? RURAL;
        const dens = D.density * (1 - 0.72 * Math.min(1, mountainAt(px + nx * 30, py + ny * 30) * 2.2));
        if (!pr.chance(dens)) { s += pr.range(16, 34); continue; }
        const kind = pickKind(D, false, Math.min(maxW, len - s1 - s));
        if (!kind) { s += 12; continue; }
        const dm = DIM[kind]!, w = Math.min(pr.range(dm[0], dm[1]), len - s1 - s), d = pr.range(dm[2], dm[3]), set = dm[5] + pr.range(0, 2.5);
        const off = half + set + d / 2, cx = px + ux * (w / 2) + nx * off, cy = py + uy * (w / 2) + ny * off;
        const box: Box = { cx, cy, w, h: d, rot: side > 0 ? ang + Math.PI : ang };
        if (!boxOk(box, key, kind === 'houseS' || kind === 'houseL' || kind === 'farmhouse' ? 3.5 : 2)) { s += 9; continue; }
        const dong = dongAt(cx, cy);
        const q = mk(kind, nameOf(kind, dong), cx, cy, w, d, box.rot, kind === 'office' ? 5 + pr.int(0, 7) : dm[4], kind === 'parking', dm[6], dong);
        fronts.set(q.id, key);
        s += w + (D.district === 'commercial' ? pr.range(1.5, 4) : D.district === 'industrial' ? pr.range(8, 16) : pr.range(4, 9));
      }
    }
  };

  // 2) 골목: 긴 길에서 블록 안으로 뻗는 막다른 좁은 길
  const alleyCount = new Map<string, number>();
  for (const e of edges) {
    if (e.cls === 'highway' || e.bridge || e.len < 190) continue;
    const A = nodes[e.a], B = nodes[e.b], ux = (B.x - A.x) / e.len, uy = (B.y - A.y) / e.len, n = e.len > 340 ? 2 : 1;
    for (let k = 0; k < n; k++) {
      const s = e.len * (n === 1 ? pr.range(0.4, 0.6) : k === 0 ? pr.range(0.28, 0.38) : pr.range(0.62, 0.72)), side = pr.chance(0.5) ? 1 : -1;
      const px = A.x + ux * s, py = A.y + uy * s, nx = -uy * side, ny = ux * side;
      const D = districtAt(px + nx * 50, py + ny * 50);
      if (!D || D.density < 0.7 || mountainAt(px, py) > 0.05) continue;
      const L = pr.range(58, 96), h = roadHalf(e), x0 = px + nx * h, y0 = py + ny * h, x1 = px + nx * (h + L), y1 = py + ny * (h + L);
      let ok = true;
      for (let q = 0.25; q <= 1.3 && ok; q += 0.15) { const x = x0 + (x1 - x0) * q, y = y0 + (y1 - y0) * q; if (!pointOk(x, y, e.id)) ok = false; }
      if (ok && !boxOk({ cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, w: L, h: 9, rot: Math.atan2(ny, nx) }, e.id, 2)) ok = false;
      if (!ok) continue;
      const c = (alleyCount.get(e.name) ?? 0) + 1; alleyCount.set(e.name, c);
      alleys.push({ x0, y0, x1, y1, name: `${e.name} ${c * 2 - 1}길` });
    }
  }
  // 3) 길가에 건물을 채운다: 큰길부터
  const order = [...edges].sort((a, b) => roadHalf(b) - roadHalf(a) || a.id - b.id);
  for (const e of order) {
    if (e.cls === 'highway') continue;
    const A = nodes[e.a], B = nodes[e.b];
    frontage(A.x, A.y, B.x, B.y, roadHalf(e), e.id, 19, 19, 999);
  }
  alleys.forEach((a, i) => frontage(a.x0, a.y0, a.x1, a.y1, 3.5, -2 - i, 3, 3, 32));
  // 4) 블록 안쪽: 길에서 떨어진 자리에 뒷집, 아파트 동, 공장을 놓는다
  for (let gy = 30; gy < CITY_H - 30; gy += 27) for (let gx = 30; gx < CITY_W - 30; gx += 27) {
    const x = gx + pr.range(-9, 9), y = gy + pr.range(-9, 9);
    const D = districtAt(x, y, pr.next());
    if (!D || !pr.chance(D.density * 0.8 * (1 - Math.min(1, mountainAt(x, y) * 2.5)))) continue;
    let be: RoadEdge | null = null, bd = Infinity;
    for (const e of edges) { if (e.cls === 'highway') continue; const A = nodes[e.a], B = nodes[e.b], d = distSeg(x, y, A.x, A.y, B.x, B.y) - roadHalf(e); if (d < bd) { bd = d; be = e; } }
    if (!be || bd < 36 || bd > 175) continue;
    const kind = pickKind(D, true, 999);
    if (!kind) continue;
    const dm = DIM[kind]!, A = nodes[be.a], B = nodes[be.b], w = pr.range(dm[0], dm[1]), d = pr.range(dm[2], dm[3]);
    const box: Box = { cx: x, cy: y, w, h: d, rot: Math.atan2(B.y - A.y, B.x - A.x) + (pr.chance(0.5) ? Math.PI : 0) };
    if (!boxOk(box, -1, kind === 'apartment' ? 9 : kind === 'factory' || kind === 'warehouse' ? 7 : 4.5)) continue;
    const dong = dongAt(x, y);
    const q = mk(kind, nameOf(kind, dong), x, y, w, d, box.rot, dm[4], kind === 'parking', dm[6], dong);
    fronts.set(q.id, be.id);
  }

  // 5) 진입 지점과 주소: 가장 가까운 길가 (고속도로에는 차를 댈 수 없다)
  const roadLen = new Map<number, number[]>();
  for (const e of edges) { let l = roadLen.get(e.road!); if (!l) roadLen.set(e.road!, (l = [])); l[e.seq!] = e.len; }
  const usedAddr = new Set<string>();
  const alleyNo = new Map<number, number>();
  for (const q of places) {
    const b = boxOf(q), f = fronts.get(q.id);
    let best: RoadEdge | null = f !== undefined && f >= 0 ? edges[f] : null;
    if (!best) { let bd = Infinity; for (const e of edges) { if (e.cls === 'highway') continue; const A = nodes[e.a], B = nodes[e.b], d = distSeg(b.cx, b.cy, A.x, A.y, B.x, B.y); if (d < bd) { bd = d; best = e; } } }
    const e = best!, A = nodes[e.a], B = nodes[e.b], dx = B.x - A.x, dy = B.y - A.y;
    const t = clamp(((b.cx - A.x) * dx + (b.cy - A.y) * dy) / (dx * dx + dy * dy), 0.06, 0.94);
    q.edgeId = e.id; q.nodeId = t < 0.5 ? e.a : e.b; q.cx = A.x + dx * t; q.cy = A.y + dy * t;
    if (q.open) { q.addr = `${q.dong} ${e.name}`; continue; }
    if (f !== undefined && f <= -2) { const n = (alleyNo.get(f) ?? 0) + 1; alleyNo.set(f, n); q.addr = `${alleys[-2 - f].name} ${n}`; continue; }
    let along = t * e.len; for (let k = 0; k < e.seq!; k++) along += roadLen.get(e.road!)![k] ?? 0;
    const side = (b.cx - A.x) * dy - (b.cy - A.y) * dx > 0 ? 1 : 0;
    let no = Math.floor(along / 11) * 2 + side + 1;
    while (usedAddr.has(`${e.name} ${no}`)) no += 2;
    usedAddr.add(`${e.name} ${no}`);
    q.addr = `${e.name} ${no}`;
  }
  return { places, alleys };
}

/** 긴급 차량 기준 구간 통과 시간(초). 내려온 건널목 차단기 앞에서 기다리는 시간(wait)을 더한다. 큰 차(heavy)는 이면 도로에서 더디다. */
export function edgeTime(e: RoadEdge, weatherF = 1, heavy = false): number {
  const congEff = 1 + (e.cong - 1) * 0.5 + e.slow;
  return (e.len / (e.speed * weatherF)) * congEff * (heavy && e.cls === 'local' ? 1.15 : 1) + (e.wait ?? 0);
}

// findRoute 가 다시 쓰는 버퍼와 이진 힙 (거리, 교차로 번호). 시뮬레이션 상태가 아니라 계산용 임시 공간이다
let rDist = new Float64Array(0), rPrev = new Int32Array(0), rDone = new Uint8Array(0);
let hKey = new Float64Array(64), hNode = new Int32Array(64), hN = 0;
const hLess = (i: number, j: number): boolean => hKey[i] < hKey[j] || (hKey[i] === hKey[j] && hNode[i] < hNode[j]);
function heapPush(k: number, v: number): void {
  if (hN === hKey.length) { const k2 = new Float64Array(hN * 2), v2 = new Int32Array(hN * 2); k2.set(hKey); v2.set(hNode); hKey = k2; hNode = v2; }
  let i = hN++;
  hKey[i] = k; hNode[i] = v;
  while (i > 0) {
    const p = (i - 1) >> 1;
    if (!hLess(i, p)) break;
    const tk = hKey[i], tv = hNode[i]; hKey[i] = hKey[p]; hNode[i] = hNode[p]; hKey[p] = tk; hNode[p] = tv;
    i = p;
  }
}
function heapPop(): void {
  hN--;
  if (hN === 0) return;
  hKey[0] = hKey[hN]; hNode[0] = hNode[hN];
  let i = 0;
  for (;;) {
    const l = i * 2 + 1, r = l + 1;
    let m = i;
    if (l < hN && hLess(l, m)) m = l;
    if (r < hN && hLess(r, m)) m = r;
    if (m === i) break;
    const tk = hKey[i], tv = hNode[i]; hKey[i] = hKey[m]; hNode[i] = hNode[m]; hKey[m] = tk; hNode[m] = tv;
    i = m;
  }
}

/**
 * 다익스트라. **알려진** 통제(closed)만 피한다: 아직 아무도 모르는 장애물(known === false)은 가 보아야 안다(traffic.ts).
 * 큰 차(heavy)는 불법 주차로 좁아졌다고 알려진 골목(noHeavy)도 피한다.
 */
export function findRoute(city: City, from: number, to: number, weatherF = 1, avoidEdge = -1, heavy = false): Route | null {
  const n = city.nodes.length;
  if (rDist.length < n) { rDist = new Float64Array(n); rPrev = new Int32Array(n); rDone = new Uint8Array(n); }
  const distArr = rDist, prevEdge = rPrev, done = rDone;
  distArr.fill(Infinity, 0, n); prevEdge.fill(-1, 0, n); done.fill(0, 0, n);
  distArr[from] = 0;
  // 아직 끝나지 않은 교차로 가운데 (거리, 번호)가 가장 작은 것을 차례로 꺼낸다 — 거리가 같으면 번호가 작은 것.
  // 예전의 "전부 훑어 가장 작은 것" 과 꺼내는 순서가 똑같다 (낡은 항목은 거리가 지금 값과 달라 버린다).
  hN = 0; heapPush(0, from);
  while (hN > 0) {
    const u = hNode[0], du = hKey[0];
    heapPop();
    if (done[u] || du !== distArr[u]) continue;
    if (u === to) break;
    done[u] = 1;
    const ue = city.nodes[u].edges;
    for (let q = 0; q < ue.length; q++) {
      const eid = ue[q];
      const e = city.edges[eid];
      if ((e.closed && e.known !== false) || (heavy && e.noHeavy) || eid === avoidEdge) continue;
      const v = e.a === u ? e.b : e.a;
      const nd = distArr[u] + edgeTime(e, weatherF, heavy) - Math.min(e.wait ?? 0, distArr[u]);      // 차단기는 거기 닿을 즈음이면 그만큼 덜 기다린다
      if (nd < distArr[v]) { distArr[v] = nd; prevEdge[v] = eid; heapPush(nd, v); }
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

/** 긴급 차량 주행 속도 계수: 날씨 × 차량 상태(난이도의 장비 손잡이) */
export function weatherSpeedFactor(sim: Sim): number {
  return (sim.weather === 'rain' ? 0.88 : sim.weather === 'fog' ? 0.84 : 1) * sim.tune.vehicleSpeedMul * (sim.disaster?.speedMul ?? 1);
}

export function edgeName(city: City, e: RoadEdge): string {
  return `${e.name} ${(e.seq ?? 0) + 1}구간`;
}
/** 교차로 이름: 만나는 도로 가운데 큰 길 둘의 이름 */
export function nodeName(city: City, nodeId: number): string {
  const n = city.nodes[nodeId];
  const es = n.edges.map((id) => city.edges[id]).sort((a, b) => roadHalf(b) - roadHalf(a) || a.id - b.id);
  const names: string[] = [];
  for (const e of es) if (names.indexOf(e.name) < 0) names.push(e.name);
  if (n.key === 'C0') return '중앙광장 로터리';
  return names.length >= 2 ? `${names[0]}·${names[1]}` : n.edges.length <= 1 ? `${names[0]} 끝` : `${names[0]} ${(es[0].seq ?? 0) + 1}구간`;
}
/** 그 지점에 있는 건물이나 터. 건물이 터보다 먼저다. */
export function placeAt(city: City, x: number, y: number): Place | null {
  let best: Place | null = null;
  for (const q of city.places) {
    const cx = q.x + q.w / 2, cy = q.y + q.h / 2, r = q.rot ?? 0;
    let lx = x - cx, ly = y - cy;
    if (r) { const c = Math.cos(-r), s = Math.sin(-r), tx = lx * c - ly * s; ly = lx * s + ly * c; lx = tx; }
    if (Math.abs(lx) > q.w / 2 || Math.abs(ly) > q.h / 2) continue;
    if (!best || (best.open && !q.open) || (best.open === q.open && q.w * q.h < best.w * best.h)) best = q;
  }
  return best;
}
