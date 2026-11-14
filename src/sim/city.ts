// CityManager + RoadNetwork + Pathfinder
// 도시는 cityPlan.ts 의 설계도로 만든다. 교대가 바뀌어도 같은 지도이고(사건만 달라진다),
// 한 번 만든 지도는 다시 쓴다(도로의 혼잡·통제처럼 교대마다 바뀌는 값만 새로 복사한다).

import type { Sim } from './engine';
import { emit } from './events';
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

let cached: City | null = null;
/** 도시를 만든다. 지도 자체는 고정이므로 한 번만 만들고, 교대마다 바뀌는 도로 상태만 새로 복사해 돌려준다. */
export function generateCity(rng: Rng): City {
  if (!cached) cached = buildCity(rng);
  return { ...cached, edges: cached.edges.map((e) => ({ ...e })) };
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

interface Box { cx: number; cy: number; w: number; h: number; rot: number }
function obbHit(a: Box, b: Box, m: number): boolean {
  const ax = Math.cos(a.rot), ay = Math.sin(a.rot), bx = Math.cos(b.rot), by = Math.sin(b.rot), dx = b.cx - a.cx, dy = b.cy - a.cy;
  for (const [ux, uy] of [[ax, ay], [-ay, ax], [bx, by], [-by, bx]]) {
    const ra = (a.w / 2 + m) * Math.abs(ux * ax + uy * ay) + (a.h / 2 + m) * Math.abs(-ux * ay + uy * ax);
    const rb = (b.w / 2) * Math.abs(ux * bx + uy * by) + (b.h / 2) * Math.abs(-ux * by + uy * bx);
    if (Math.abs(dx * ux + dy * uy) > ra + rb) return false;
  }
  return true;
}
const boxOf = (q: Place): Box => ({ cx: q.x + q.w / 2, cy: q.y + q.h / 2, w: q.w, h: q.h, rot: q.rot ?? 0 });

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
  const boxOk = (b: Box, skip: number, margin: number): boolean => {
    const c = Math.cos(b.rot), s = Math.sin(b.rot);
    for (const [u, v] of [[0, 0], [-1, -1], [1, -1], [1, 1], [-1, 1], [0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const lx = (u * b.w) / 2, ly = (v * b.h) / 2;
      if (!pointOk(b.cx + lx * c - ly * s, b.cy + lx * s + ly * c, skip)) return false;
    }
    const r = Math.hypot(b.w, b.h) / 2 + margin, done = new Set<number>();
    for (let gx = b.cx - r; gx <= b.cx + r + CELL; gx += CELL) for (let gy = b.cy - r; gy <= b.cy + r + CELL; gy += CELL) {
      for (const id of grid.get(gk(gx, gy)) ?? []) { if (done.has(id)) continue; done.add(id); const q = places[id]; if (q.open && reserved.indexOf(id) < 0) continue; if (obbHit(b, boxOf(q), q.open || q.facility >= 0 ? 6 : margin)) return false; }
    }
    return true;
  };
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
  for (let gy = 30; gy < CITY_H - 30; gy += 31) for (let gx = 30; gx < CITY_W - 30; gx += 31) {
    const x = gx + pr.range(-9, 9), y = gy + pr.range(-9, 9);
    const D = districtAt(x, y, pr.next());
    if (!D || !pr.chance(D.density * 0.62 * (1 - Math.min(1, mountainAt(x, y) * 2.5)))) continue;
    let be: RoadEdge | null = null, bd = Infinity;
    for (const e of edges) { if (e.cls === 'highway') continue; const A = nodes[e.a], B = nodes[e.b], d = distSeg(x, y, A.x, A.y, B.x, B.y) - roadHalf(e); if (d < bd) { bd = d; be = e; } }
    if (!be || bd < 44 || bd > 175) continue;
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
  const roadLen: number[][] = ROADS.map(() => []);
  for (const e of edges) roadLen[e.road!][e.seq!] = e.len;
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
    let along = t * e.len; for (let k = 0; k < e.seq!; k++) along += roadLen[e.road!][k] ?? 0;
    const side = (b.cx - A.x) * dy - (b.cy - A.y) * dx > 0 ? 1 : 0;
    let no = Math.floor(along / 11) * 2 + side + 1;
    while (usedAddr.has(`${e.name} ${no}`)) no += 2;
    usedAddr.add(`${e.name} ${no}`);
    q.addr = `${e.name} ${no}`;
  }
  return { places, alleys };
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

/** 긴급 차량 주행 속도 계수: 날씨 × 차량 상태(난이도의 장비 손잡이) */
export function weatherSpeedFactor(sim: Sim): number {
  return (sim.weather === 'rain' ? 0.88 : sim.weather === 'fog' ? 0.84 : 1) * sim.tune.vehicleSpeedMul;
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
