// 무너진 자리의 고정 그림 (docs/specs/G4-scene-legibility.md §4.1). staticLayer 가 부른다.
// 내려앉은 구획(음영·기울기·그림자 띠), 먼지 테두리, 높낮이 있는 잔해 더미, 넘어간 벽, 깔린 가구, 새로 쏟아진 잔해,
// 천장이 내려앉은 자리, 치운 자리, 붕괴 구역 경계 — 그리고 벽을 그린 뒤 부러진 벽 끝·금 간 벽·바깥 벽의 금.
// 상태(s.damage · s.ruin · 지금의 칸 · 치운 잔해 소품)만 읽는다. 모양은 칸 번호 해시라 다시 그려도 같다.

import { T } from '../../sim/types';
import type { Scene } from '../../sim/types';
import { hash2, mix } from './common';
import type { G } from './common';

const RUIN_WALL = 1, RUIN_SECONDARY = 8, RUIN_CEILING = 9, RUIN_FURN = 16;      // field/ruins.ts 와 같은 값 (표현 계층은 시뮬레이션 모듈의 값을 다시 적어 둔다)
const CONCRETE = ['#57524b', '#6a645b', '#8d867a', '#a59d90', '#b3aa9a'];
const EARTH = ['#3e3022', '#4a3a28', '#5a4630', '#6a543a', '#7a6246'];
const SLAB = '#9b9488';
const WALL_BODY = mix('#8f99a3', '#a59d90', 0.45), WALL_TOP = mix('#bcc5cd', '#a59d90', 0.4);      // 먼지를 뒤집어쓴 벽색 (서 있는 벽보다 흐리다)
const REBAR = '#9a5a3a';
export const RUIN_EDGE = '#d6a878';      // 붕괴 구역 경계 (TYPE_COLOR.collapse)

const isBuilding = (t: number): boolean => t === T.FLOOR || t === T.FURN || t === T.DOOR || t === T.WALL || t === T.WINDOW || t === T.STAIR;

// ───────────────────────── 구역 (캐시) ─────────────────────────
export interface RuinZone {
  tiles: number[];
  x0: number; y0: number; x1: number; y1: number;
  hx: number; hy: number;           // 받쳐진 높은 쪽 (단위 방향: 북 0,-1 · 남 0,1 · 서 -1,0 · 동 1,0)
}
export interface RuinZones {
  ver: number;
  zones: RuinZone[];
  zoneOf: Int16Array;               // 칸 → 구역 번호 (-1 = 무너진 자리가 아님)
  depth: Uint8Array;                // 무너진 칸에서 구역 경계까지의 칸 거리 (가장자리 칸 = 1)
  edges: number[];                  // 경계 선분 [x0, y0, x1, y1, …] (칸 모서리 좌표, 이어진 것은 합쳤다)
  count: number;                    // 무너진 칸 수
}
const zoneCache = new WeakMap<Scene, RuinZones>();
const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;

/** 무너진 칸(s.damage)을 4이웃으로 이은 덩어리들. s.staticVersion 이 바뀔 때만 다시 센다 */
export function ruinZones(s: Scene): RuinZones {
  const hit = zoneCache.get(s);
  if (hit && hit.ver === s.staticVersion) return hit;
  const w = s.w, h = s.h, n = w * h;
  const zoneOf = new Int16Array(n).fill(-1), depth = new Uint8Array(n);
  const zones: RuinZone[] = [];
  let count = 0;
  const dmg = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < h && s.damage[y * w + x] === 1;
  for (let i0 = 0; i0 < n; i0++) {
    if (!s.damage[i0] || zoneOf[i0] >= 0) continue;
    const id = zones.length, z: RuinZone = { tiles: [], x0: w, y0: h, x1: 0, y1: 0, hx: 0, hy: -1 };
    const st = [i0]; zoneOf[i0] = id;
    while (st.length) {
      const c = st.pop()!, x = c % w, y = (c / w) | 0;
      z.tiles.push(c); z.x0 = Math.min(z.x0, x); z.x1 = Math.max(z.x1, x); z.y0 = Math.min(z.y0, y); z.y1 = Math.max(z.y1, y);
      for (const [dx, dy] of D4) { const nx = x + dx, ny = y + dy; if (!dmg(nx, ny)) continue; const j = ny * w + nx; if (zoneOf[j] < 0) { zoneOf[j] = id; st.push(j); } }
    }
    // 받쳐진 높은 쪽: 구역 가장자리에서 서 있는 벽에 가장 많이 닿은 방향
    const wallHits = [0, 0, 0, 0];      // D4 순서: 동 서 남 북
    for (const c of z.tiles) {
      const x = c % w, y = (c / w) | 0;
      D4.forEach(([dx, dy], k) => { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= w || ny >= h) return; const j = ny * w + nx; if (!s.damage[j] && s.tiles[j] === T.WALL) wallHits[k]++; });
    }
    let best = 3; for (const k of [3, 1, 0, 2]) if (wallHits[k] > wallHits[best]) best = k;      // 같으면 북 → 서 → 동 → 남
    z.hx = D4[best][0]; z.hy = D4[best][1];
    zones.push(z); count += z.tiles.length;
  }
  // 경계까지의 거리: 무너지지 않은 칸(격자 밖 포함)에서 시작하는 넓히기
  const q: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!s.damage[i]) continue;
    const x = i % w, y = (i / w) | 0;
    if (D4.some(([dx, dy]) => !dmg(x + dx, y + dy))) { depth[i] = 1; q.push(i); }
  }
  for (let k = 0; k < q.length; k++) {
    const c = q[k], x = c % w, y = (c / w) | 0;
    for (const [dx, dy] of D4) { const nx = x + dx, ny = y + dy; if (!dmg(nx, ny)) continue; const j = ny * w + nx; if (!depth[j]) { depth[j] = Math.min(255, depth[c] + 1); q.push(j); } }
  }
  // 경계 선분: 같은 줄에서 이어진 변은 하나로 합친다 (점선이 칸마다 다시 시작하지 않게)
  const edges: number[] = [];
  for (let y = 0; y <= h; y++) {      // 가로 변: 칸 (x, y-1) 과 (x, y) 사이
    let run = -1;
    for (let x = 0; x <= w; x++) {
      const on = x < w && dmg(x, y - 1) !== dmg(x, y);
      if (on && run < 0) run = x;
      if (!on && run >= 0) { edges.push(run, y, x, y); run = -1; }
    }
  }
  for (let x = 0; x <= w; x++) {      // 세로 변: 칸 (x-1, y) 와 (x, y) 사이
    let run = -1;
    for (let y = 0; y <= h; y++) {
      const on = y < h && dmg(x - 1, y) !== dmg(x, y);
      if (on && run < 0) run = y;
      if (!on && run >= 0) { edges.push(x, run, x, y); run = -1; }
    }
  }
  const out: RuinZones = { ver: s.staticVersion, zones, zoneOf, depth, edges, count };
  zoneCache.set(s, out);
  return out;
}

/** 경계 선분을 경로로 (k = 칸당 화소) */
export function traceRuinEdges(g: G, z: RuinZones, k: number): void {
  g.beginPath();
  for (let e = 0; e < z.edges.length; e += 4) { g.moveTo(z.edges[e] * k, z.edges[e + 1] * k); g.lineTo(z.edges[e + 2] * k, z.edges[e + 3] * k); }
}
/** 붕괴 구역 경계의 점선 모양 (고정 층과 밤의 다시 긋기가 같은 것을 쓴다) */
export function strokeRuinEdges(g: G, z: RuinZones, k: number, alphaV: number): void {
  if (!z.edges.length) return;
  g.save();
  g.globalAlpha = alphaV; g.strokeStyle = RUIN_EDGE; g.lineWidth = Math.max(1.5, k * 0.05); g.lineCap = 'butt';
  g.setLineDash([k * 0.28, k * 0.18]);
  traceRuinEdges(g, z, k); g.stroke();
  g.restore();
}

// ───────────────────────── 조각 ─────────────────────────
type Mat = 'concrete' | 'earth' | 'crane';
const matOf = (s: Scene): Mat => (s.variant === 'landslide' ? 'earth' : s.variant === 'crane' ? 'crane' : 'concrete');

/** 들쭉날쭉한 조각 하나 + 오른쪽 아래 그림자 + 왼쪽 위 밝은 면 (화소 좌표) */
function chunk(g: G, x: number, y: number, r: number, rot: number, seed: number, col: string, R: number, flat = false): void {
  const n = 5 + ((hash2(seed, 1) * 2) | 0);
  const pts: number[] = [];
  for (let q = 0; q < n; q++) { const a = rot + (q / n) * 6.2832, rad = r * (0.6 + 0.55 * hash2(seed, q + 3)); pts.push(Math.cos(a) * rad, Math.sin(a) * rad * 0.82); }
  const poly = (ox: number, oy: number, sc: number): void => { g.beginPath(); for (let q = 0; q < pts.length; q += 2) { const px = x + ox + pts[q] * sc, py = y + oy + pts[q + 1] * sc; if (q) g.lineTo(px, py); else g.moveTo(px, py); } g.closePath(); g.fill(); };
  if (!flat) { g.fillStyle = 'rgba(0,0,0,0.28)'; poly(R * 0.03, R * 0.04, 1); }
  g.fillStyle = col; poly(0, 0, 1);
  if (!flat) { g.fillStyle = 'rgba(255,255,255,0.14)'; poly(-r * 0.22, -r * 0.24, 0.5); }
}

export interface RuinPaintOpts {
  rubble: (g: G, h: number, cols: string[]) => void;              // staticLayer 의 부서진 가구 그림
  rubbleColors: (kind: number, x: number, y: number) => string[];
}

/** 무너진 자리의 바닥 (벽 그림자·가구·벽보다 먼저). tAt = 격자 밖이면 T.VOID */
export function paintRuinFloor(g: G, s: Scene, R: number, tAt: (x: number, y: number) => number, o: RuinPaintOpts): void {
  const z = ruinZones(s);
  const ruin = s.ruin;
  const w = s.w;
  const mat = matOf(s);
  const small = R < 12;
  const cleared = new Map<number, string>();      // 치운 잔해 소품의 칸 → 모습(skin)
  for (const p of s.props) if (p.kind === 'debris' && p.removed) cleared.set(p.y * w + p.x, p.skin ?? '');
  const hasCeil = !!ruin && ruin.some((v) => v === RUIN_CEILING);
  if (!z.count && !cleared.size && !hasCeil) return;
  const dmg = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < w && y < s.h && s.damage[y * w + x] === 1;
  const ruinAt = (i: number): number => (ruin ? ruin[i] : 0);
  const floorNow = (i: number): boolean => s.tiles[i] === T.FLOOR;

  if (z.count) {
    // 1) 내려앉은 구획: 전체 음영 → 높은 쪽에서 낮은 쪽으로 짙어지는 기울기 → 북·서쪽 그림자 띠 → 높은 쪽 깨진 끝의 밝은 선
    for (const zone of z.zones) {
      const big = zone.tiles.length >= 4 && mat !== 'crane';
      const spanX = zone.x1 - zone.x0 + 1, spanY = zone.y1 - zone.y0 + 1;
      for (const c of zone.tiles) {
        const x = c % w, y = (c / w) | 0;
        let a = 0.18;
        if (big) {
          // 높은 쪽 0 → 낮은 쪽 1
          const t = zone.hy !== 0 ? (zone.hy < 0 ? (y - zone.y0 + 0.5) / spanY : (zone.y1 - y + 0.5) / spanY) : (zone.hx < 0 ? (x - zone.x0 + 0.5) / spanX : (zone.x1 - x + 0.5) / spanX);
          a = 1 - (1 - a) * (1 - (0.06 + 0.3 * t));      // 전체 음영 0.18 위에 기울기 0.06 → 0.36 을 겹친 값
        }
        g.fillStyle = `rgba(18,14,10,${a.toFixed(3)})`; g.fillRect(x * R, y * R, R, R);
      }
      if (!big) continue;
      for (const c of zone.tiles) {
        const x = c % w, y = (c / w) | 0;
        if (!dmg(x, y - 1)) { const gr = g.createLinearGradient(0, y * R, 0, (y + 0.35) * R); gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x * R, y * R, R, R * 0.35); }
        if (!dmg(x - 1, y)) { const gr = g.createLinearGradient(x * R, 0, (x + 0.35) * R, 0); gr.addColorStop(0, 'rgba(0,0,0,0.35)'); gr.addColorStop(1, 'rgba(0,0,0,0)'); g.fillStyle = gr; g.fillRect(x * R, y * R, R * 0.35, R); }
        if (!dmg(x + zone.hx, y + zone.hy)) {
          g.strokeStyle = 'rgba(220,210,190,0.35)'; g.lineWidth = Math.max(1, R * 0.04); g.beginPath();
          if (zone.hy !== 0) { const ey = (y + (zone.hy > 0 ? 1 : 0)) * R + (zone.hy > 0 ? -1 : 1) * R * 0.04; g.moveTo(x * R, ey); g.lineTo((x + 1) * R, ey); }
          else { const ex = (x + (zone.hx > 0 ? 1 : 0)) * R + (zone.hx > 0 ? -1 : 1) * R * 0.04; g.moveTo(ex, y * R); g.lineTo(ex, (y + 1) * R); }
          g.stroke();
        }
      }
    }
    // 2) 먼지 테두리: 경계 칸에서 바깥으로 0.6칸까지 흐린 먼지
    for (let i = 0; i < s.damage.length; i++) {
      if (!s.damage[i] || z.depth[i] !== 1) continue;
      const x = i % w, y = (i / w) | 0;
      for (const [dx, dy] of D4) {
        if (dmg(x + dx, y + dy)) continue;
        const hv = hash2(i * 7 + dx * 3, dy * 5 + 11);
        const px = (x + 0.5 + dx * (0.55 + 0.25 * hv) + (hv - 0.5) * 0.5 * (dy !== 0 ? 1 : 0)) * R, py = (y + 0.5 + dy * (0.55 + 0.25 * hv) + (hv - 0.5) * 0.5 * (dx !== 0 ? 1 : 0)) * R;
        g.fillStyle = mat === 'earth' ? 'rgba(122,98,70,0.16)' : 'rgba(196,178,146,0.16)';
        g.beginPath(); g.ellipse(px, py, R * (0.32 + 0.2 * hv), R * (0.26 + 0.16 * hash2(i, 31)), hv * 3, 0, 6.2832); g.fill();
      }
    }
    // 3) 잔해 더미의 높낮이 (6: 2차 붕괴로 새로 쏟아진 칸은 한 단 밝게). 크레인 팔 밑은 긁힌 땅
    const order: { i: number; h: number }[] = [];
    for (let i = 0; i < s.damage.length; i++) {
      if (!s.damage[i]) continue;
      const rv = ruinAt(i);
      order.push({ i, h: Math.min(3, z.depth[i]) + (rv === RUIN_WALL && floorNow(i) ? 1 : 0) + (rv >= RUIN_FURN && floorNow(i) ? 0.5 : 0) + 0.6 * hash2(i, 77) });
    }
    order.sort((a, b) => a.h - b.h || a.i - b.i);
    const pal = mat === 'earth' ? EARTH : CONCRETE;
    for (const { i, h } of order) {
      const x = i % w, y = (i / w) | 0, rv = ruinAt(i);
      const hv = (k: number): number => hash2(i * 13 + k, 4091);
      if (mat === 'crane') {
        // 긁힌 땅: 밝은 먼지와 팔 방향(남동)의 긁힌 자국 두 줄
        g.fillStyle = 'rgba(214,200,170,0.22)'; g.beginPath(); g.ellipse((x + 0.5) * R, (y + 0.5) * R, R * 0.62, R * 0.5, 0.78, 0, 6.2832); g.fill();
        if (!small) for (let k = 0; k < 2; k++) { const o2 = (k - 0.5) * 0.36 + (hv(k) - 0.5) * 0.1; g.strokeStyle = 'rgba(58,48,38,0.45)'; g.lineWidth = Math.max(1, R * 0.035); g.beginPath(); g.moveTo((x + 0.1 + o2) * R, (y + 0.1 - o2) * R); g.lineTo((x + 0.9 + o2) * R, (y + 0.9 - o2) * R); g.stroke(); }
        for (let k = 0; k < (small ? 1 : 4); k++) chunk(g, (x + 0.15 + 0.7 * hv(10 + k)) * R, (y + 0.15 + 0.7 * hv(20 + k)) * R, R * (0.04 + 0.04 * hv(30 + k)), hv(40 + k) * 6, i * 31 + k, pal[1 + (k % 3)], R, true);
        continue;
      }
      const clr = cleared.get(i);
      const fresh = rv === RUIN_SECONDARY;
      let nCh = Math.round(3 + 2 * h);
      if (small) nCh = Math.max(1, Math.round(nCh / 3));
      const hor = hv(5) > 0.5;      // 치운 칸: 조각을 밀어 둔 두 변의 방향
      for (let k = 0; k < nCh; k++) {
        let u = hv(100 + k), v = hv(200 + k);
        if (clr !== undefined) { const side = k % 2 ? 0.86 : 0.14, j = (v - 0.5) * 0.18; if (hor) v = side + j; else { u = side + j; } }
        const size = R * (0.08 + 0.05 * h) * (0.55 + 0.7 * hv(300 + k));
        let ci = Math.round((h / 4.6) * 4 + (hv(400 + k) - 0.5) * 1.6) + (fresh ? 1 : 0);
        ci = Math.max(0, Math.min(pal.length - 1, ci));
        chunk(g, (x + 0.06 + 0.88 * u) * R, (y + 0.06 + 0.88 * v) * R, size, hv(500 + k) * 6.28, i * 97 + k, pal[ci], R);
      }
      if (h >= 2.5 && clr === undefined) {
        const nS = 1 + (hv(600) > 0.5 ? 1 : 0);
        for (let k = 0; k < nS; k++) {
          g.save(); g.translate((x + 0.25 + 0.5 * hv(610 + k)) * R, (y + 0.25 + 0.5 * hv(620 + k)) * R); g.rotate((hv(630 + k) - 0.5) * 2.4);
          const sw = R * (0.34 + 0.16 * hv(640 + k)), sh = R * (0.16 + 0.08 * hv(650 + k));
          g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-sw / 2 + R * 0.03, -sh / 2 + R * 0.04, sw, sh);
          g.fillStyle = mat === 'earth' ? EARTH[3] : SLAB; g.fillRect(-sw / 2, -sh / 2, sw, sh);
          g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(-sw / 2, -sh / 2, sw, sh * 0.28);
          if (!small) { g.strokeStyle = 'rgba(30,26,22,0.6)'; g.lineWidth = Math.max(1, R * 0.02); g.beginPath(); g.moveTo(-sw * 0.1, -sh / 2); g.lineTo(sw * 0.05, 0); g.lineTo(-sw * 0.04, sh / 2); g.stroke(); }
          g.restore();
        }
      }
      if (fresh && !small) for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(232,224,206,0.55)'; const d = Math.max(1, R * 0.035); g.fillRect((x + 0.1 + 0.8 * hv(700 + k)) * R, (y + 0.1 + 0.8 * hv(710 + k)) * R, d, d); }
    }
  }
  // 4) 넘어간 벽: 원래 벽이 서 있던 줄의 자국 + 잔해가 많은 쪽으로 밀려 쓰러진 벽 판 (지금 바닥인 칸만)
  if (ruin) for (let i = 0; i < ruin.length; i++) {
    if (ruin[i] !== RUIN_WALL || !floorNow(i)) continue;
    const x = i % w, y = (i / w) | 0, hv = (k: number): number => hash2(i * 29 + k, 1777);
    const wallish = (xx: number, yy: number): boolean => { const t = tAt(xx, yy); if (t === T.WALL || t === T.WINDOW) return true; const j = yy * w + xx; return xx >= 0 && yy >= 0 && xx < w && yy < s.h && ruin[j] === RUIN_WALL; };
    const nh = (wallish(x - 1, y) ? 1 : 0) + (wallish(x + 1, y) ? 1 : 0), nv = (wallish(x, y - 1) ? 1 : 0) + (wallish(x, y + 1) ? 1 : 0);
    const cxp = (x + 0.5) * R, cyp = (y + 0.5) * R;
    if (!nh && !nv) {
      // 기둥: 작은 네모 더미
      for (let k = 0; k < 3; k++) { g.save(); g.translate(cxp + (hv(k) - 0.5) * R * 0.4, cyp + (hv(k + 5) - 0.5) * R * 0.4); g.rotate(hv(k + 9) * 1.5); const b = R * (0.14 + 0.08 * hv(k + 13)); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-b / 2 + R * 0.03, -b / 2 + R * 0.04, b, b); g.fillStyle = WALL_BODY; g.fillRect(-b / 2, -b / 2, b, b); g.fillStyle = WALL_TOP; g.fillRect(-b * 0.3, -b * 0.3, b * 0.6, b * 0.6); g.restore(); }
      continue;
    }
    const horiz = nh >= nv;
    // 자국: 벽이 서 있던 줄 (가장자리 들쭉날쭉)
    g.fillStyle = 'rgba(20,16,12,0.5)'; g.beginPath();
    const steps = small ? 2 : 5, half = 0.06;
    for (let q = 0; q <= steps; q++) { const u = q / steps, off = (hv(20 + q) - 0.5) * 0.05; if (horiz) { const px = (x + u) * R, py = cyp - (half + off) * R; if (q) g.lineTo(px, py); else g.moveTo(px, py); } else { const py = (y + u) * R, px = cxp - (half + off) * R; if (q) g.lineTo(px, py); else g.moveTo(px, py); } }
    for (let q = steps; q >= 0; q--) { const u = q / steps, off = (hv(40 + q) - 0.5) * 0.05; if (horiz) g.lineTo((x + u) * R, cyp + (half + off) * R); else g.lineTo(cxp + (half + off) * R, (y + u) * R); }
    g.closePath(); g.fill();
    // 쓰러진 벽 판: 잔해가 더 많은 쪽으로 0.25~0.45칸
    const da = horiz ? z.depth[Math.max(0, i - w)] * (dmg(x, y - 1) ? 1 : 0) : z.depth[i - 1] * (dmg(x - 1, y) ? 1 : 0);
    const db = horiz ? z.depth[Math.min(ruin.length - 1, i + w)] * (dmg(x, y + 1) ? 1 : 0) : z.depth[i + 1] * (dmg(x + 1, y) ? 1 : 0);
    const side = da > db ? -1 : da < db ? 1 : hv(60) > 0.5 ? 1 : -1;
    const shift = (0.25 + 0.2 * hv(61)) * side;
    g.save();
    g.translate(cxp + (horiz ? 0 : shift * R), cyp + (horiz ? shift * R : 0));
    g.rotate((horiz ? 0 : Math.PI / 2) + (hv(62) > 0.5 ? 1 : -1) * (0.17 + 0.27 * hv(63)));
    const pieces = 2 + (hv(64) > 0.55 ? 1 : 0), L = 0.9 * R, th = 0.3 * R, gap = 0.06 * R;
    const pl = (L - gap * (pieces - 1)) / pieces;
    for (let k = 0; k < pieces; k++) {
      const px = -L / 2 + k * (pl + gap), jy = (hv(70 + k) - 0.5) * R * 0.16, rot = (hv(80 + k) - 0.5) * 0.6;
      g.save(); g.translate(px + pl / 2, jy); g.rotate(rot);
      g.fillStyle = 'rgba(0,0,0,0.32)'; g.fillRect(-pl / 2 + R * 0.03, -th / 2 + R * 0.05, pl, th);
      g.fillStyle = '#151a20'; g.fillRect(-pl / 2 - R * 0.015, -th / 2 - R * 0.015, pl + R * 0.03, th + R * 0.03);
      g.fillStyle = WALL_BODY; g.fillRect(-pl / 2, -th / 2, pl, th);
      g.fillStyle = WALL_TOP; g.fillRect(-pl / 2, -th * 0.28, pl, th * 0.56);
      if (!small) { g.strokeStyle = 'rgba(20,18,16,0.55)'; g.lineWidth = Math.max(1, R * 0.018); g.beginPath(); g.moveTo(pl / 2, -th / 2); g.lineTo(pl / 2 - R * 0.04, -th * 0.1); g.lineTo(pl / 2 + R * 0.01, th * 0.2); g.lineTo(pl / 2 - R * 0.03, th / 2); g.stroke(); }
      g.restore();
    }
    // 판 위에 얹힌 잔 조각 (판이 잔해 속에 쓰러져 있다)
    for (let k = 0; k < (small ? 0 : 3); k++) chunk(g, (hv(100 + k) - 0.5) * L * 0.9, (hv(110 + k) - 0.5) * th * 1.2, R * (0.05 + 0.04 * hv(120 + k)), hv(130 + k) * 6, i * 7 + k, CONCRETE[1 + ((hv(140 + k) * 3) | 0)], R);
    if (!small) for (let k = 0; k < 2; k++) { const ex = L / 2 + R * 0.02, ey = (k - 0.5) * th * 0.5; g.strokeStyle = REBAR; g.lineWidth = Math.max(1, R * 0.025); g.lineCap = 'round'; g.beginPath(); g.moveTo(ex - R * 0.04, ey); g.quadraticCurveTo(ex + R * 0.08, ey + (hv(90 + k) - 0.5) * R * 0.1, ex + R * (0.12 + 0.08 * hv(95 + k)), ey + (hv(97 + k) - 0.5) * R * 0.14); g.stroke(); }
    g.restore();
  }
  // 5) 깔린 가구: 부서진 가구 그림 + 묻힌 회색 조각 (N7 의 부서진 가구가 이미 있는 칸은 조각만)
  if (ruin) for (let i = 0; i < ruin.length; i++) {
    if (ruin[i] < RUIN_FURN || !floorNow(i)) continue;
    const x = i % w, y = (i / w) | 0, hv = (k: number): number => hash2(i * 41 + k, 2903);
    if (!(s.decorHp[i] === 255 && s.decor[i])) { g.save(); g.translate((x + 0.5) * R, (y + 0.5) * R); g.scale(R, R); o.rubble(g, hash2(x * 91, y * 53), o.rubbleColors(ruin[i] - RUIN_FURN, x, y)); g.restore(); }
    const nG = small ? 1 : 4 + ((hv(1) * 3) | 0);
    for (let k = 0; k < nG; k++) chunk(g, (x + 0.12 + 0.76 * hv(10 + k)) * R, (y + 0.12 + 0.76 * hv(20 + k)) * R, R * (0.07 + 0.06 * hv(30 + k)), hv(40 + k) * 6, i * 53 + k, CONCRETE[1 + ((hv(50 + k) * 3) | 0)], R);
  }
  // 7) 천장이 내려앉은 칸 (불난 방): 숯빛 잔해와 탄 서까래
  if (hasCeil && ruin) for (let i = 0; i < ruin.length; i++) {
    if (ruin[i] !== RUIN_CEILING) continue;
    const x = i % w, y = (i / w) | 0, hv = (k: number): number => hash2(i * 59 + k, 3301);
    g.fillStyle = 'rgba(20,14,10,0.45)'; g.beginPath(); g.ellipse((x + 0.5) * R, (y + 0.5) * R, R * 0.6, R * 0.52, hv(1) * 3, 0, 6.2832); g.fill();
    const nC = small ? 2 : 8;
    for (let k = 0; k < nC; k++) chunk(g, (x + 0.1 + 0.8 * hv(10 + k)) * R, (y + 0.1 + 0.8 * hv(20 + k)) * R, R * (0.06 + 0.07 * hv(30 + k)), hv(40 + k) * 6, i * 61 + k, k % 2 ? '#2b2118' : '#3a2c20', R);
    for (let k = 0; k < 2; k++) {
      g.save(); g.translate((x + 0.5 + (hv(50 + k) - 0.5) * 0.3) * R, (y + 0.5 + (hv(55 + k) - 0.5) * 0.3) * R); g.rotate(hv(60 + k) * 3.14);
      const L = R * (0.8 + 0.25 * hv(65 + k)), bw = Math.max(1.5, R * 0.08);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-L / 2 + R * 0.03, -bw / 2 + R * 0.04, L, bw);
      g.fillStyle = '#2a1d14'; g.fillRect(-L / 2, -bw / 2, L, bw);
      g.fillStyle = '#4a3324'; g.fillRect(-L / 2, -bw / 2, L, bw * 0.35);
      if (!small) { g.fillStyle = '#ff9a4a'; g.beginPath(); g.arc(L / 2 - bw * 0.4, 0, bw * 0.45, 0, 6.2832); g.fill(); }
      g.restore();
    }
  }
  // 8) 치운 자리: 가운데에 길을 낸 밝은 띠 (조각은 3)에서 두 변으로 밀어 두었다). 흙은 흙 얼룩, 크레인 팔은 긁힌 자국
  for (const [i, skin] of cleared) {
    const x = i % w, y = (i / w) | 0, hv = (k: number): number => hash2(i * 71 + k, 4441);
    if (skin === 'mud') { g.fillStyle = 'rgba(74,58,40,0.5)'; g.beginPath(); g.ellipse((x + 0.5) * R, (y + 0.5) * R, R * 0.55, R * 0.45, hv(1) * 3, 0, 6.2832); g.fill(); g.fillStyle = 'rgba(90,70,48,0.45)'; g.beginPath(); g.ellipse((x + 0.4) * R, (y + 0.55) * R, R * 0.3, R * 0.2, hv(2) * 3, 0, 6.2832); g.fill(); continue; }
    if (skin === 'craneBoom') {
      g.strokeStyle = 'rgba(40,34,28,0.55)'; g.lineWidth = Math.max(1, R * 0.04); g.lineCap = 'round';
      for (let k = 0; k < 3; k++) { const o2 = (k - 1) * 0.22; g.beginPath(); g.moveTo((x + 0.05 + o2) * R, (y + 0.05 - o2) * R); g.lineTo((x + 0.95 + o2) * R, (y + 0.95 - o2) * R); g.stroke(); }
      continue;
    }
    const hor = hash2(i * 13 + 5, 4091) > 0.5;      // 3) 과 같은 해시
    g.fillStyle = 'rgba(220,210,190,0.12)';
    if (hor) g.fillRect(x * R, (y + 0.3) * R, R, R * 0.4); else g.fillRect((x + 0.3) * R, y * R, R * 0.4, R);
    if (!s.damage[i]) for (let k = 0; k < (small ? 2 : 6); k++) { const side = k % 2 ? 0.86 : 0.14, j = (hv(10 + k) - 0.5) * 0.7; chunk(g, (x + (hor ? 0.5 + j : side)) * R, (y + (hor ? side : 0.5 + j)) * R, R * (0.06 + 0.05 * hv(20 + k)), hv(30 + k) * 6, i * 83 + k, CONCRETE[1 + ((hv(40 + k) * 3) | 0)], R); }
  }
  // 9) 붕괴 구역 경계: 흙빛 점선 (벽 밑으로 지나는 곳은 그 위에 벽이 그려져 끊긴다)
  if (z.count) strokeRuinEdges(g, z, R, 0.55);
}

/** 벽과 창을 그린 뒤: 부러진 벽 끝(철근), 금 간 벽, 바깥 벽의 금. hw = 칸별 벽 반두께 (0 = 벽 그림 없음) */
export function paintRuinWalls(g: G, s: Scene, R: number, hw: Float32Array): void {
  const ruin = s.ruin;
  const z = ruinZones(s);
  if (!z.count && !ruin) return;
  const w = s.w, h = s.h, small = R < 12;
  const tAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= w || y >= h ? T.VOID : s.tiles[y * w + x]);
  const wallAt = (x: number, y: number): boolean => { const t = tAt(x, y); return t === T.WALL || t === T.WINDOW || t === T.DOOR; };
  for (let i = 0; i < s.tiles.length; i++) {
    if (s.tiles[i] !== T.WALL || !hw[i]) continue;
    const x = i % w, y = (i / w) | 0, t0 = hw[i], cxp = (x + 0.5) * R, cyp = (y + 0.5) * R;
    const hv = (k: number): number => hash2(i * 37 + k, 5113);
    // 1) 부러진 벽 끝: 넘어간 벽(지금 바닥) 쪽으로 들쭉날쭉한 끝과 철근
    if (ruin) for (const [dx, dy] of D4) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (ruin[j] !== 1 || s.tiles[j] !== T.FLOOR) continue;
      const L = 0.22 + 0.16 * hv(dx * 3 + dy * 7 + 20);      // 칸 가운데에서 이웃 쪽으로 뻗은 길이 (칸 경계 0.5 를 넘지 않는다)
      const n = small ? 2 : 5;
      const pts: [number, number][] = [];      // 벽 길이 방향 u(바깥쪽), 두께 방향 v
      pts.push([0, -t0]);
      for (let q = 0; q <= n; q++) { const v = -t0 + (2 * t0 * q) / n; pts.push([L * (q % 2 ? 0.55 + 0.25 * hv(30 + q) : 0.85 + 0.15 * hv(40 + q)), v]); }
      pts.push([0, t0]);
      const map = (u: number, v: number): [number, number] => [cxp + (dx * u - dy * v) * R, cyp + (dy * u + dx * v) * R];
      const poly = (scale: number, col: string): void => { g.fillStyle = col; g.beginPath(); pts.forEach(([u, v], q) => { const [px, py] = map(u, v * scale); if (q) g.lineTo(px, py); else g.moveTo(px, py); }); g.closePath(); g.fill(); };
      g.save(); g.translate(R * 0.012 * (dx || 1), R * 0.012 * (dy || 1)); poly(1.18, '#151a20'); g.restore();
      poly(1, '#8f99a3'); poly(0.56, '#bcc5cd');
      if (!small) {
        g.strokeStyle = REBAR; g.lineWidth = Math.max(1, R * 0.025); g.lineCap = 'round';
        const nr = 2 + (hv(50) > 0.5 ? 1 : 0);
        for (let k = 0; k < nr; k++) {
          const v = -t0 * 0.6 + (1.2 * t0 * k) / Math.max(1, nr - 1), u0 = L * 0.6, l = 0.15 + 0.1 * hv(60 + k), bend = (hv(70 + k) - 0.5) * 0.12;
          const [ax, ay] = map(u0, v), [bx, by] = map(u0 + l * 0.6, v + bend * 0.5), [ex, ey] = map(u0 + l, v + bend);
          g.beginPath(); g.moveTo(ax, ay); g.quadraticCurveTo(bx, by, ex, ey); g.stroke();
        }
      }
    }
    if (small) continue;
    const horiz = wallAt(x - 1, y) || wallAt(x + 1, y);
    const along = (u: number, v: number): [number, number] => (horiz ? [cxp + u * R, cyp + v * R] : [cxp + v * R, cyp + u * R]);
    // 2) 금 간 벽: 무너진 자리에 남은 벽 (sealPockets 가 메운 칸 포함)
    if (s.damage[i]) {
      g.strokeStyle = 'rgba(20,18,16,0.7)'; g.lineWidth = Math.max(1, R * 0.025); g.lineJoin = 'round';
      g.beginPath();
      for (let q = 0; q <= 5; q++) { const [px, py] = along(-0.5 + q * 0.2, (hv(80 + q) - 0.5) * t0 * 0.9); if (q) g.lineTo(px, py); else g.moveTo(px, py); }
      g.stroke();
      for (let k = 0; k < 2; k++) { const [px, py] = along(-0.35 + 0.7 * hv(90 + k), (k ? 1 : -1) * t0 * 0.85); g.fillStyle = 'rgba(16,14,12,0.75)'; g.beginPath(); g.arc(px, py, R * (0.04 + 0.03 * hv(95 + k)), 0, 6.2832); g.fill(); }
      g.fillStyle = 'rgba(165,157,144,0.35)';
      for (let k = 0; k < 4; k++) { const [px, py] = along(-0.4 + 0.8 * hv(100 + k), (hv(110 + k) - 0.5) * t0 * 1.2); g.beginPath(); g.arc(px, py, R * (0.025 + 0.03 * hv(120 + k)), 0, 6.2832); g.fill(); }
      continue;
    }
    // 3) 바깥 벽의 금 (과장 — 설계서 §2.2): 무너진 칸과 맞닿고 건물 밖과도 맞닿은 벽. 벽을 끊지 않는다
    let touch = -1, outside = false;
    D4.forEach(([dx, dy], k) => { const nx = x + dx, ny = y + dy; const t = tAt(nx, ny); if (!isBuilding(t)) outside = true; else if (s.damage[ny * w + nx]) touch = k; });
    if (touch < 0 || !outside) continue;
    g.strokeStyle = 'rgba(20,18,16,0.6)'; g.lineWidth = Math.max(1, R * 0.022);
    const nCr = 1 + (hv(130) > 0.5 ? 1 : 0);
    for (let k = 0; k < nCr; k++) {
      const u0 = -0.3 + 0.6 * hv(140 + k);
      g.beginPath();
      for (let q = 0; q <= 3; q++) { const [px, py] = along(u0 + (hv(150 + q + k * 5) - 0.5) * 0.12, -t0 * 0.85 + (1.7 * t0 * q) / 3); if (q) g.lineTo(px, py); else g.moveTo(px, py); }
      g.stroke();
    }
    const [dx, dy] = D4[touch];
    g.fillStyle = 'rgba(165,157,144,0.35)';
    for (let k = 0; k < 4; k++) { const d = t0 + 0.06 + 0.22 * hv(160 + k), side = (hv(170 + k) - 0.5) * 0.8; const px = cxp + (dx * d + (dy !== 0 ? side : 0)) * R, py = cyp + (dy * d + (dx !== 0 ? side : 0)) * R; g.beginPath(); g.arc(px, py, R * (0.025 + 0.025 * hv(180 + k)), 0, 6.2832); g.fill(); }
  }
}
