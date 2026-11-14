// CityManager + RoadNetwork + Pathfinder
// 도시는 고정된 도시 시드로 생성되어 교대가 바뀌어도 같은 지도를 쓴다(사건만 달라진다).

import type { Sim } from './engine';
import { emit } from './events';
import { Rng } from './rng';
import { BANKS, BLOCKS, COL_ROADS, CONVENIENCE, FACTORIES, KIND_DISTRICT, NAME_PREFIX, PENSIONS, RESTAURANTS, RIVER_COL, RIVER_NAME, ROW_ROADS, SHOPS, USE_DISTRICT } from './cityPlan';
import type { BlockUse } from './cityPlan';
import type { Alley, City, CityBlock, District, Facility, Place, PlaceKind, RoadEdge, RoadNode, Route } from './types';
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
      arterial, cong: baseCong, baseCong, closed: false, closedReason: null, slow: 0, name: horiz ? ROW_ROADS[A.r] : COL_ROADS[A.c],
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

  const built = buildPlaces(rng.fork('places-v1'), W, H, nodes, kept, facilities);

  const colX = (c: number) => 170 + c * 257;
  const rowY = (r: number) => 150 + r * 268;
  const districts = [
    { district: 'residential' as District, name: '주거 구역', x: colX(1) - 128, y: rowY(0) - 100, w: 257 * 3, h: 268 * 4.5 + 20 },
    { district: 'commercial' as District, name: '상업 구역', x: colX(4) - 128, y: rowY(0) - 100, w: 257 * 4, h: 268 * 2.5 + 100 },
    { district: 'industrial' as District, name: '산업 구역', x: colX(4) - 128, y: rowY(3) - 134, w: 257 * 4, h: 268 * 2 },
    { district: 'outskirts' as District, name: '외곽 구역', x: 0, y: rowY(5) - 134, w: W, h: H - rowY(5) + 134 },
  ];
  return { w: W, h: H, nodes, edges: kept, buildings: built.places.filter((q) => !q.open), facilities, parks: [], districts, places: built.places, alleys: built.alleys, blocks: built.blocks, river: built.river };
}

// ───────────────────────── 건물과 터 ─────────────────────────
// cityPlan.ts 의 배치표를 읽어 블록마다 필지를 나누고, 모든 건물에 종류·이름·주소·진입 지점을 붙인다.

interface Rect { x0: number; y0: number; x1: number; y1: number }
interface Lot { x: number; y: number; w: number; h: number; row: number; rows: number; alley: number }
export const facilityRect = (f: Facility): { x: number; y: number; w: number; h: number } => ({ x: f.x - 18, y: f.y - 52, w: 78, h: 62 });

function buildPlaces(pr: Rng, W: number, H: number, nodes: RoadNode[], edges: RoadEdge[], facilities: Facility[]): { places: Place[]; alleys: Alley[]; blocks: CityBlock[]; river: City['river'] } {
  const nid = (c: number, r: number): number => r * COLS + c;
  const edgeOf = new Map<number, RoadEdge>();
  for (const e of edges) edgeOf.set(Math.min(e.a, e.b) * 1000 + Math.max(e.a, e.b), e);
  const eb = (a: number, b: number): RoadEdge | null => edgeOf.get(Math.min(a, b) * 1000 + Math.max(a, b)) ?? null;

  // 하천: 강변로와 중앙대로 사이를 북에서 남으로 흐른다
  const colXAt = (c: number, y: number): number => {
    let r = 0; while (r < ROWS - 2 && y > nodes[nid(c, r + 1)].y) r++;
    const A = nodes[nid(c, r)], Bn = nodes[nid(c, r + 1)];
    return A.x + (Bn.x - A.x) * clamp((y - A.y) / (Bn.y - A.y), -1, 2);
  };
  const RW = 30;
  const riverX = (y: number): number => colXAt(RIVER_COL + 1, y) - 66 + 10 * Math.sin(y / 95) + 5 * Math.sin(y / 41 + 1);
  const river: City['river'] = { pts: [], w: RW, name: RIVER_NAME };
  for (let y = -40; y <= H + 40; y += 20) river.pts.push([riverX(y), y]);

  const places: Place[] = [], alleys: Alley[] = [], blocks: CityBlock[] = [];
  const fLots = facilities.map(facilityRect);
  const hitsFacility = (x: number, y: number, w: number, h: number): boolean => fLots.some((l) => x < l.x + l.w + 3 && x + w > l.x - 3 && y < l.y + l.h + 3 && y + h > l.y - 3);
  const usedNames = new Map<string, number>();
  const uniq = (name: string): string => {
    const n = (usedNames.get(name) ?? 0) + 1; usedNames.set(name, n);
    if (n === 1) return name;
    if (name.endsWith('지점')) return `${name.slice(0, -2)}${['', '중앙', '사거리', '역전', '북', '남'][Math.min(5, n - 1)]}지점`;      // 같은 동의 두 번째 지점
    if (/(빌라|연립|맨션|오피스텔|창고)$/.test(name)) return `${name} ${n}차`;
    if (/(빌딩|타워|프라자|센터|호텔|교회)$/.test(name)) return `${name} ${n === 2 ? '별관' : `${n}관`}`;
    return `${name} ${n}호점`;
  };
  const pre = (): string => pr.pick(NAME_PREFIX);
  let cur = { c: 0, r: 0, dong: '', use: 'none' as BlockUse };
  const add = (kind: PlaceKind, name: string, x: number, y: number, w: number, h: number, floors = 1, open = false): Place | null => {
    if (!open && hitsFacility(x, y, w, h)) return null;
    const q: Place = { id: places.length, kind, name, addr: '', x, y, w, h, district: KIND_DISTRICT[kind] ?? USE_DISTRICT[cur.use], tone: pr.next(), block: cur.r * (COLS - 1) + cur.c, dong: cur.dong, nodeId: -1, cx: 0, cy: 0, open, floors, facility: -1 };
    places.push(q);
    return q;
  };
  /** 블록을 가로줄로 나누고(줄 사이는 골목) 줄마다 필지를 자른다 */
  const rowLots = (R: Rect, rowH0: number, alleyW: number, width: () => number, minW: number, ext: [number, number]): Lot[] => {
    const hh = R.y1 - R.y0, n = Math.max(1, Math.round((hh + alleyW) / (rowH0 + alleyW))), rh = (hh - (n - 1) * alleyW) / n;
    const out: Lot[] = [];
    for (let k = 0; k < n; k++) {
      const y = R.y0 + k * (rh + alleyW);
      let al = -1;
      if (k > 0) { al = alleys.length; alleys.push({ x0: R.x0 - ext[0], y0: y - alleyW / 2, x1: R.x1 + ext[1], y1: y - alleyW / 2, name: '' }); }
      let x = R.x0;
      while (x < R.x1 - minW * 0.8) {
        let w = width(); if (R.x1 - (x + w) < minW * 0.8) w = R.x1 - x;
        out.push({ x, y, w, h: rh, row: k, rows: n, alley: k > 0 && k < n - 1 ? al : -1 }); x += w;
      }
    }
    return out;
  };
  const lotAlley = new Map<number, number>();      // place id → 골목 번호 (골목에 면한 필지)
  const put = (L: Lot, kind: PlaceKind, name: string, gx: number, gy: number, floors: number, depth = 0): Place | null => {
    const h = depth > 0 ? Math.min(L.h - gy * 2, depth) : L.h - gy * 2;
    const y = L.row === 0 ? L.y + gy : L.row === L.rows - 1 ? L.y + L.h - gy - h : L.y + (L.h - h) / 2;      // 길 쪽으로 붙인다
    const q = add(kind, name, L.x + gx, y, L.w - gx * 2, h, floors);
    if (q && L.alley >= 0) lotAlley.set(q.id, L.alley);
    return q;
  };
  const scatter = (R: Rect, n: number, w: number, h: number, kind: PlaceKind, name: (k: number) => string, floors = 1): void => {
    for (let k = 0, tries = 0; k < n && tries < 60; tries++) {
      const x = pr.range(R.x0, Math.max(R.x0, R.x1 - w)), y = pr.range(R.y0, Math.max(R.y0, R.y1 - h));
      if (places.some((q) => !q.open && x < q.x + q.w + 10 && x + w > q.x - 10 && y < q.y + q.h + 10 && y + h > q.y - 10)) continue;
      if (add(kind, name(k), x, y, w, h, floors)) k++;
    }
  };

  const fill = (use: BlockUse, R: Rect, def: { name?: string; dong: string }, ext: [number, number]): void => {
    const w = R.x1 - R.x0, h = R.y1 - R.y0;
    if (w < 50 || h < 50) return;
    const bn = def.name ?? def.dong;
    if (use === 'houses' || use === 'bigHouses') {
      const pLarge = use === 'bigHouses' ? 0.72 : 0.2;
      for (const L of rowLots(R, 42, 8, () => (pr.chance(pLarge) ? pr.range(50, 60) : pr.range(29, 35)), 29, ext)) {
        if (L.w > 44) put(L, 'houseL', '큰 단독주택', 6, 4, 2, 30);
        else if (pr.chance(0.05)) put(L, 'convenience', uniq(`${pr.pick(CONVENIENCE)} ${def.dong}점`), 3, 5, 1, 22);
        else put(L, 'houseS', '작은 단독주택', 4.5, 5, 1, 21);
      }
    } else if (use === 'villas') {
      const ls = rowLots(R, 48, 8, () => pr.range(40, 52), 38, ext);
      ls.forEach((L, k) => {
        if (k === ls.length - 1) { add('utility', `${def.dong} 도시가스 정압실`, L.x + 6, L.y + L.h - 24, 20, 16); return; }
        const v = pr.next();
        if (v < 0.08) put(L, 'convenience', uniq(`${pr.pick(CONVENIENCE)} ${def.dong}점`), 6, 8, 1, 24);
        else if (v < 0.12) put(L, 'church', uniq(`${pre()}교회`), 7, 6, 2, 36);
        else if (v < 0.17) add('parking', `${def.dong} 공영 주차장`, L.x + 4, L.y + 5, L.w - 8, L.h - 10, 0, true);
        else put(L, 'villa', uniq(`${pre()}${pr.pick(['빌라', '연립', '맨션'])}`), 4, 4, 3, 34);
      });
    } else if (use === 'apt') {
      const sw = 76, sh = 18, cols = Math.max(1, Math.floor((w + 16) / (sw + 16))), pitch = 47, rows = Math.max(1, Math.floor((h + 20) / pitch));
      const gx = (w - cols * sw) / (cols + 1), base = cur.r * 100 + 101;
      let no = 0;
      for (let k = 0; k < rows; k++) for (let j = 0; j < cols; j++) {
        const x = R.x0 + gx + j * (sw + gx), y = R.y0 + 6 + k * pitch;
        if (k === rows - 1 && j === cols - 1) { add('shop', `${bn} 상가`, x + 8, y, sw - 30, 24, 2); add('playground', `${bn} 놀이터`, x + sw - 18, y, 22, 24, 0, true); continue; }
        add('apartment', `${bn} ${base + no++}동`, x, y, sw, sh, 6);
      }
    } else if (use === 'park') {
      add('park', bn, R.x0, R.y0, w, h, 0, true);
      add('playground', `${bn} 놀이터`, R.x0 + w * 0.12, R.y0 + h * 0.7, 26, 22, 0, true);
      add('parking', `${bn} 주차장`, R.x0 + 4, R.y0 + 4, Math.min(60, w * 0.5), 20, 0, true);
    } else if (use === 'office') {
      const cols = w > 150 ? 2 : 1, rows = Math.max(2, Math.round(h / 68)), cw = w / cols, ch = h / rows;
      let bank = false, hotel = false, k = 0;
      for (let iy = 0; iy < rows; iy++) for (let ix = 0; ix < cols; ix++, k++) {
        const x = R.x0 + ix * cw + pr.range(5, 9), y = R.y0 + iy * ch + pr.range(5, 8), bw = cw - pr.range(13, 20), bh = ch - pr.range(12, 18);
        const v = pr.next();
        if (!bank && (v < 0.2 || k === rows * cols - 1)) { bank = true; add('bank', uniq(`${pr.pick(BANKS)} ${def.dong}지점`), x, y + bh * 0.2, bw * 0.8, bh * 0.75, 3); }
        else if (!hotel && v < 0.3) { hotel = true; add('hotel', uniq(`${pre()}호텔`), x, y, bw * 0.85, bh, 9); }
        else if (v < 0.45) add('officetel', uniq(`${pre()}오피스텔`), x, y, bw * 0.8, bh, 8);
        else if (v < 0.5) add('parking', `${def.dong} 주차장`, x, y, bw, bh, 0, true);
        else add('office', uniq(`${pre()}${pr.pick(['빌딩', '타워', '프라자', '센터'])}`), x, y, bw, bh, 5 + pr.int(0, 6));
      }
    } else if (use === 'shops') {
      let bank = false;
      for (const L of rowLots(R, 50, 10, () => pr.range(34, 48), 32, ext)) {
        const v = pr.next();
        if (v < 0.3) put(L, 'restaurant', uniq(pr.pick(RESTAURANTS)), 3, 4, 2);
        else if (v < 0.42) put(L, 'convenience', uniq(`${pr.pick(CONVENIENCE)} ${def.dong}점`), 3, 5, 1);
        else if (v < 0.5 && !bank) { bank = true; put(L, 'bank', uniq(`${pr.pick(BANKS)} ${def.dong}지점`), 3, 4, 3); }
        else if (v < 0.6) put(L, 'office', uniq(`${pre()}${pr.pick(['빌딩', '프라자'])}`), 3, 3, 5);
        else if (v < 0.68) put(L, 'officetel', uniq(`${pre()}오피스텔`), 4, 3, 7);
        else put(L, 'shop', uniq(`${pre()} ${pr.pick(SHOPS)}`), 3, 4, 2);
      }
    } else if (use === 'market') {
      add('market', `${bn} 가동`, R.x0 + 8, R.y0 + h * 0.3, w - 16, 24, 1);
      add('market', `${bn} 나동`, R.x0 + 8, R.y0 + h * 0.56, w - 16, 24, 1);
      for (const [y0, y1] of [[R.y0, R.y0 + h * 0.24], [R.y0 + h * 0.76, R.y1]]) {
        for (const L of rowLots({ x0: R.x0, y0, x1: R.x1, y1 }, 60, 0, () => pr.range(30, 42), 28, ext)) {
          const v = pr.next();
          if (v < 0.4) put(L, 'restaurant', uniq(pr.pick(RESTAURANTS)), 3, 4, 2); else if (v < 0.5) put(L, 'convenience', uniq(`${pr.pick(CONVENIENCE)} ${def.dong}점`), 3, 4, 1); else put(L, 'shop', uniq(`${pre()} ${pr.pick(SHOPS)}`), 3, 4, 2);
        }
      }
    } else if (use === 'mart') {
      add('mart', bn, R.x0 + 8, R.y0 + 8, w * 0.62, h * 0.5, 2);
      add('gasStation', `${bn} 주유소`, R.x0 + w * 0.7, R.y0 + 10, Math.min(44, w * 0.26), 30, 1);
      add('parking', `${bn} 주차장`, R.x0 + 8, R.y0 + h * 0.58, w - 16, h * 0.36, 0, true);
    } else if (use === 'factory') {
      const cw = w / 2, ch = h / 2;
      for (let k = 0; k < 4; k++) {
        const x = R.x0 + (k % 2) * cw + pr.range(8, 12), y = R.y0 + (k >> 1) * ch + pr.range(8, 12), bw = cw - pr.range(20, 28), bh = ch - pr.range(20, 30);
        if (k === 3) { add('dorm', `${def.dong} 근로자 기숙사`, x, y, bw * 0.55, bh * 0.6, 4); add('warehouse', uniq(`${pre()}창고`), x + bw * 0.62, y, bw * 0.38, bh, 1); }
        else add('factory', uniq(`${pre()}${pr.pick(FACTORIES)}`), x, y, bw, bh, 2);
      }
    } else if (use === 'logistics') {
      const n = Math.max(2, Math.floor(h / 54));
      for (let k = 0; k < n; k++) add('warehouse', `${pre()}물류 ${k + 1}창고`, R.x0 + 10 + (k % 2) * 8, R.y0 + 8 + k * (h / n), w - 44, Math.min(32, h / n - 20), 1);
    } else if (use === 'chemical') {
      add('chemical', `${bn} 1공정동`, R.x0 + 10, R.y0 + 10, w * 0.44, h * 0.3, 2);
      add('chemical', `${bn} 2공정동`, R.x0 + 10, R.y0 + h * 0.5, w * 0.44, h * 0.3, 2);
      add('storage', `${bn} 저장 탱크 A`, R.x0 + w * 0.56, R.y0 + 10, w * 0.38, h * 0.26, 1);
      add('storage', `${bn} 저장 탱크 B`, R.x0 + w * 0.56, R.y0 + h * 0.36, w * 0.38, h * 0.26, 1);
      add('warehouse', `${bn} 자재 창고`, R.x0 + w * 0.56, R.y0 + h * 0.68, w * 0.38, h * 0.22, 1);
      add('utility', `${bn} 가스 정압실`, R.x0 + 12, R.y0 + h * 0.86, 20, 16);
    } else if (use === 'redevelop') {
      add('construction', `${def.dong} 재개발 공사장`, R.x0 + 6, R.y0 + 6, w - 12, h * 0.46, 3);
      for (const L of rowLots({ x0: R.x0, y0: R.y0 + h * 0.54, x1: R.x1, y1: R.y1 }, 46, 8, () => pr.range(38, 50), 34, ext)) {
        if (pr.chance(0.25)) put(L, 'warehouse', uniq(`${pre()}창고`), 4, 5, 1, 30); else put(L, 'villa', uniq(`${pre()}연립`), 4, 5, 3, 32);
      }
    } else if (use === 'forest') {
      add('forest', bn, R.x0, R.y0, w, h, 0, true);
    } else if (use === 'farm') {
      add('farmland', `${def.dong} 농경지`, R.x0, R.y0, w, h, 0, true);
      scatter(R, 3, 26, 20, 'farmhouse', () => '농가 주택');
      scatter(R, 4, 46, 12, 'greenhouse', () => '비닐하우스');
      scatter(R, 1, 34, 24, 'warehouse', () => `${def.dong} 농기계 창고`);
    } else if (use === 'pension') {
      add('forest', bn, R.x0, R.y0, w, h, 0, true);
      scatter({ x0: R.x0 + w * 0.3, y0: R.y0 + 8, x1: R.x1 - 6, y1: R.y1 - 8 }, 5, 30, 22, 'pension', () => uniq(`${pr.pick(PENSIONS)} 펜션`), 2);
    } else if (use === 'rest') {
      add('farmland', `${def.dong} 농경지`, R.x0, R.y0, w, h, 0, true);
      add('parking', `${bn} 주차장`, R.x0 + 8, R.y1 - 86, Math.min(150, w - 16), 34, 0, true);
      add('restStop', bn, R.x0 + 12, R.y1 - 48, 66, 34, 1);
      add('gasStation', `${bn} 주유소`, R.x0 + 90, R.y1 - 46, 42, 30, 1);
      scatter({ x0: R.x0, y0: R.y0, x1: R.x1, y1: R.y1 - 100 }, 2, 26, 20, 'farmhouse', () => '농가 주택');
    } else if (use === 'storage') {
      add('farmland', `${def.dong} 농경지`, R.x0, R.y0, w, h, 0, true);
      for (let k = 0; k < 3; k++) add('storage', `${bn} ${'ABC'[k]}구역`, R.x0 + 14 + k * 64, R.y0 + 16, 54, 46, 1);
      add('warehouse', `${bn} 자재 창고`, R.x0 + 14, R.y0 + 78, 70, 30, 1);
      add('utility', `${bn} 가스 정압실`, R.x0 + 96, R.y0 + 82, 20, 16);
    } else if (use === 'reservoir') {
      add('forest', `${bn} 둘레 숲`, R.x0, R.y0, w, h, 0, true);
      add('reservoir', bn, R.x0 + w * 0.14, R.y0 + h * 0.16, w * 0.72, h * 0.68, 0, true);
      add('pension', uniq(`${pr.pick(PENSIONS)} 펜션`), R.x0 + w * 0.02, R.y0 + 4, 28, 20, 2);
    } else if (use === 'airport') {
      add('farmland', `${bn} 부지`, R.x0, R.y0, w, h, 0, true);
      add('runway', `${bn} 활주로`, R.x0 + 8, R.y1 - 62, w - 16, 28, 0, true);
      add('parking', `${bn} 주차장`, R.x0 + 10, R.y0 + 8, 70, 30, 0, true);
      add('terminal', `${bn} 여객 터미널`, R.x0 + 90, R.y0 + 10, Math.min(110, w * 0.3), 36, 2);
      add('tower', `${bn} 관제탑`, R.x0 + 96 + Math.min(110, w * 0.3), R.y0 + 14, 14, 14, 5);
      for (let k = 0; k < 2; k++) add('hangar', `${bn} 격납고 ${k + 1}`, R.x0 + w * 0.56 + k * 56, R.y0 + 12, 48, 38, 1);
      add('storage', `${bn} 항공유 저장소`, R.x1 - 50, R.y0 + 14, 40, 32, 1);
    }
  };

  // 블록마다 채운다
  const corners: number[][] = [];      // 블록 번호 → 네 모서리 교차로
  for (let r = 0; r < ROWS - 1; r++) for (let c = 0; c < COLS - 1; c++) {
    const n00 = nodes[nid(c, r)], n10 = nodes[nid(c + 1, r)], n01 = nodes[nid(c, r + 1)], n11 = nodes[nid(c + 1, r + 1)];
    corners.push([n00.id, n10.id, n01.id, n11.id]);
    const def = BLOCKS[r][c];
    const m = (e: RoadEdge | null): number => (e ? (e.arterial ? 27 : 23) : 3);
    const top = eb(n00.id, n10.id), bottom = eb(n01.id, n11.id), left = eb(n00.id, n01.id), right = eb(n10.id, n11.id);
    const R: Rect = { x0: Math.max(n00.x, n01.x) + m(left), x1: Math.min(n10.x, n11.x) - m(right), y0: Math.max(n00.y, n10.y) + m(top), y1: Math.min(n01.y, n11.y) - m(bottom) };
    let use = def.use;
    cur = { c, r, dong: def.dong, use };
    if (c === RIVER_COL) {
      // 하천 둔치: 블록의 동쪽을 하천이 차지한다
      let lo = Infinity, hi = -Infinity;
      for (let y = n00.y; y <= n01.y; y += 10) { const x = riverX(y); lo = Math.min(lo, x); hi = Math.max(hi, x); }
      R.x1 = Math.min(R.x1, lo - RW / 2 - 18);
      add('riverside', `${RIVER_NAME} 산책로 ${r + 1}구간`, lo - RW / 2 - 14, Math.min(n00.y, n10.y) + 12, hi - lo + RW + 28, Math.max(n01.y, n11.y) - Math.min(n00.y, n10.y) - 24, 0, true);
    }
    if (def.span && def.span > 1 && c + 1 < COLS - 1 && !right) R.x1 = Math.min(nodes[nid(c + 2, r)].x, nodes[nid(c + 2, r + 1)].x) - m(eb(nid(c + 2, r), nid(c + 2, r + 1)));      // 오른쪽 칸과 한 덩어리
    if (use === 'none') { const lt = BLOCKS[r][c - 1]; if (c > 0 && lt.span && lt.span > 1 && !left) { blocks.push({ c, r, use: lt.use, dong: def.dong, name: lt.name ?? def.dong, x0: R.x0, y0: R.y0, x1: R.x1, y1: R.y1 }); continue; } use = 'farm'; cur.use = use; }
    blocks.push({ c, r, use, dong: def.dong, name: def.name ?? def.dong, x0: R.x0, y0: R.y0, x1: R.x1, y1: R.y1 });
    const a0 = alleys.length;
    fill(use, R, def, [left ? m(left) - 9 : 0, right && c !== RIVER_COL ? m(right) - 9 : 0]);
    for (let k = a0; k < alleys.length; k++) alleys[k].name = `${COL_ROADS[c]} ${r * 10 + (k - a0) * 2 + 1}길`;
  }
  // 출동 시설과 공공 시설도 장소다
  for (const f of facilities) {
    const n = nodes[f.nodeId], l = facilityRect(f);
    cur = { c: clamp(n.c, 0, COLS - 2), r: clamp(n.r - 1, 0, ROWS - 2), dong: BLOCKS[clamp(n.r - 1, 0, ROWS - 2)][clamp(n.c, 0, COLS - 2)].dong, use: 'none' };
    const kind: PlaceKind = f.kind === 'fireStation' ? 'fireStation' : f.kind === 'police' ? 'police' : f.kind === 'hospital' ? 'hospital' : f.name.includes('학교') ? 'school' : f.name.includes('물류') ? 'logistics' : 'cityHall';
    const q: Place = { id: places.length, kind, name: f.name, addr: '', x: l.x, y: l.y, w: l.w, h: l.h, district: n.district, tone: 0, block: cur.r * (COLS - 1) + cur.c, dong: cur.dong, nodeId: f.nodeId, cx: n.x, cy: n.y, open: false, floors: 3, facility: f.id };
    places.push(q);
  }
  // 진입 지점과 주소: 블록을 둘러싼 도로 가운데 가장 가까운 길가
  const usedAddr = new Set<string>();
  for (const q of places) {
    const [a, b, c2, d] = corners[q.block];
    const sides = [eb(a, b), eb(c2, d), eb(a, c2), eb(b, d)].filter((e): e is RoadEdge => !!e);
    const px = q.x + q.w / 2, py = q.y + q.h / 2;
    let best: { e: RoadEdge; t: number; x: number; y: number; d: number } | null = null;
    for (const e of sides) {
      const A = nodes[e.a], Bn = nodes[e.b], dx = Bn.x - A.x, dy = Bn.y - A.y;
      const t = clamp(((px - A.x) * dx + (py - A.y) * dy) / (dx * dx + dy * dy), 0.1, 0.9);
      const x = A.x + dx * t, y = A.y + dy * t, dd = Math.hypot(px - x, py - y);
      if (!best || dd < best.d) best = { e, t, x, y, d: dd };
    }
    if (!best) { let bn = a, bd = Infinity; for (const k of corners[q.block]) { const n = nodes[k], dd = Math.hypot(n.x - px, n.y - py); if (dd < bd) { bd = dd; bn = k; } } q.nodeId = bn; q.cx = nodes[bn].x; q.cy = nodes[bn].y; q.addr = q.dong; continue; }
    if (q.facility < 0) { q.nodeId = best.t < 0.5 ? best.e.a : best.e.b; q.cx = best.x; q.cy = best.y; }
    const al = lotAlley.get(q.id);
    const A = nodes[best.e.a], horiz = A.r === nodes[best.e.b].r;
    const side = horiz ? (py > best.y ? 1 : 0) : px > best.x ? 1 : 0;
    let no = ((horiz ? Math.min(A.c, nodes[best.e.b].c) : Math.min(A.r, nodes[best.e.b].r)) * 20 + Math.floor((best.e.a < best.e.b ? best.t : 1 - best.t) * 19)) * 2 + side + 1;
    const road = al !== undefined ? alleys[al].name : best.e.name;
    if (al !== undefined) no = 1 + side;
    while (usedAddr.has(`${road} ${no}`)) no += 2;
    usedAddr.add(`${road} ${no}`);
    q.addr = q.open ? `${q.dong} ${best.e.name}` : `${road} ${no}`;
  }
  return { places, alleys, blocks, river };
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
  const A = city.nodes[e.a], B = city.nodes[e.b];
  const horiz = A.r === B.r;
  return `${e.name} ${horiz ? Math.min(A.c, B.c) + 1 : Math.min(A.r, B.r) + 1}구간`;
}
/** 교차로 이름: 만나는 두 도로의 이름 */
export function nodeName(city: City, nodeId: number): string {
  const n = city.nodes[nodeId];
  return `${COL_ROADS[n.c]}·${ROW_ROADS[n.r]}`;
}
/** 그 지점에 있는 건물이나 터. 건물이 터보다 먼저다. */
export function placeAt(city: City, x: number, y: number): Place | null {
  let best: Place | null = null;
  for (const q of city.places) {
    if (x < q.x || y < q.y || x > q.x + q.w || y > q.y + q.h) continue;
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
