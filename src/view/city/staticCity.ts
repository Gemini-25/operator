// 도시 지도의 고정된 부분: 땅, 논밭과 숲, 도로와 차선·횡단보도, 지붕, 공원, 주요 시설.
// 한 번만 그려 두고 매 프레임 크기를 바꿔 붙인다. 밤에는 가로등과 창 불빛을 함께 그려 둔다.

import { COLS, ROWS } from '../../sim/city';
import { RIVER_COL } from '../../sim/cityPlan';
import type { Sim } from '../../sim/engine';
import type { District, Facility, RoadNode } from '../../sim/types';
import { canopy, paintOpen, paintRoof, paintShadow, poly } from './places';
import { disc, hash2, mix, oval, rr, seg, shade } from '../scene/common';
import type { G } from '../scene/common';

/** 정적 층의 해상도 배율 (월드 좌표 1 = 화소 K) */
export const CITY_K = 1.5;

const GROUND: Record<District, string> = { residential: '#22312a', commercial: '#272e37', industrial: '#2c2a26', outskirts: '#1b2a20' };
const ROOFS: Record<District, string[]> = {
  residential: ['#8b5644', '#6f4a3c', '#51606e', '#5d5f66', '#476660', '#7a6a4f', '#7d4a4a'],
  commercial: ['#59636f', '#666b78', '#4f5a68', '#70757f', '#5a6470', '#6b6f66'],
  industrial: ['#6a655c', '#5d6468', '#74614f', '#59605a', '#6d6a70'],
  outskirts: ['#7b5343', '#5f6a5a', '#6a5f4a'],
};

export interface FacilityLot { x: number; y: number; w: number; h: number }
/** 시설이 차지하는 부지 (이 안의 일반 건물은 그리지 않는다) */
export function facilityLot(f: Facility): FacilityLot { return { x: f.x - 18, y: f.y - 52, w: 78, h: 62 }; }

function drawFacility(g: G, f: Facility, night: boolean): void {
  const L = facilityLot(f), x = L.x, y = L.y, w = L.w, h = L.h;
  const dim = (c: string): string => (night ? shade(c, -0.42) : c);
  rr(g, x, y, w, h, 4, dim('#3a424b'));
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 0.8; g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  const shadow = (bx: number, by: number, bw: number, bh: number, d = 5): void => { g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(bx + d, by + d * 1.2, bw, bh); };
  if (f.kind === 'fireStation') {
    // 차고 3칸과 앞마당, 훈련탑
    shadow(x + 6, y + 6, w - 12, 30);
    g.fillStyle = dim('#a8382c'); g.fillRect(x + 6, y + 6, w - 12, 30);
    g.fillStyle = dim('#c44a3a'); g.fillRect(x + 8, y + 8, w - 16, 12);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 8, y + 8, w - 16, 1.4);
    for (let k = 0; k < 3; k++) { g.fillStyle = dim('#e9e4d8'); g.fillRect(x + 10 + k * 20, y + 30, 16, 6); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 10 + k * 20, y + 32, 16, 0.8); g.fillRect(x + 10 + k * 20, y + 34, 16, 0.8); }
    g.save(); g.beginPath(); g.rect(x + 8, y + 38, w - 16, 18); g.clip();
    g.strokeStyle = dim('#d9b23a'); g.lineWidth = 1.2; for (let k = -4; k < 16; k++) { g.beginPath(); g.moveTo(x + k * 7, y + 56); g.lineTo(x + k * 7 + 18, y + 38); g.stroke(); }
    g.restore();
    shadow(x + w - 22, y + 2, 12, 12, 7); g.fillStyle = dim('#8a8f96'); g.fillRect(x + w - 22, y + 2, 12, 12); g.fillStyle = dim('#b9c0c6'); g.fillRect(x + w - 20, y + 4, 8, 8);
  } else if (f.kind === 'hospital') {
    shadow(x + 5, y + 16, w - 10, 26, 7); shadow(x + 24, y + 4, 30, 50, 7);
    g.fillStyle = dim('#dfe5ea'); g.fillRect(x + 5, y + 16, w - 10, 26); g.fillRect(x + 24, y + 4, 30, 50);
    g.fillStyle = dim('#f4f7f9'); g.fillRect(x + 7, y + 18, w - 14, 22); g.fillRect(x + 26, y + 6, 26, 46);
    g.fillStyle = dim('#d8423a'); g.fillRect(x + 36.5, y + 21, 5, 16); g.fillRect(x + 31, y + 26.5, 16, 5);
    disc(g, x + 13, y + 49, 8, dim('#3f4a55')); g.strokeStyle = dim('#e8c15a'); g.lineWidth = 1.2; g.beginPath(); g.arc(x + 13, y + 49, 6, 0, 6.2832); g.stroke();
    g.fillStyle = dim('#f4f7f9'); g.fillRect(x + 10.6, y + 46, 1.3, 6); g.fillRect(x + 14.2, y + 46, 1.3, 6); g.fillRect(x + 10.6, y + 48.4, 4.9, 1.2);
  } else if (f.kind === 'police') {
    shadow(x + 6, y + 6, w - 26, 36);
    g.fillStyle = dim('#3d5278'); g.fillRect(x + 6, y + 6, w - 26, 36);
    g.fillStyle = dim('#55709e'); g.fillRect(x + 8, y + 8, w - 30, 32);
    g.fillStyle = dim('#e8edf2'); g.fillRect(x + 8, y + 21, w - 30, 5);
    disc(g, x + 16, y + 14, 3, dim('#c9d0d6')); seg(g, x + 16, y + 14, x + 21, y + 9, 0.8, dim('#c9d0d6'));
    // 주차장과 순찰차
    g.strokeStyle = 'rgba(255,255,255,0.25)'; g.lineWidth = 0.6;
    for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(x + w - 16, y + 8 + k * 11); g.lineTo(x + w - 4, y + 8 + k * 11); g.stroke(); }
    for (let k = 0; k < 2; k++) { rr(g, x + w - 15, y + 10 + k * 11, 10, 6, 1.5, dim('#e9edf1')); g.fillStyle = dim('#27477c'); g.fillRect(x + w - 15, y + 10 + k * 11, 3, 6); g.fillStyle = '#5aa9ff'; g.fillRect(x + w - 10.5, y + 11 + k * 11, 1.4, 4); }
    g.fillStyle = dim('#59636e'); g.fillRect(x + 6, y + 46, w - 26, 10);
  } else if (f.name.includes('학교')) {
    shadow(x + 4, y + 4, w - 8, 18); g.fillStyle = dim('#8a6a55'); g.fillRect(x + 4, y + 4, w - 8, 18); g.fillStyle = dim('#a5826a'); g.fillRect(x + 6, y + 6, w - 12, 14);
    for (let k = 0; k < 6; k++) { g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + 8 + k * 11, y + 6, 0.8, 14); }
    // 운동장
    rr(g, x + 8, y + 27, w - 16, 30, 13, dim('#a86a4a')); rr(g, x + 13, y + 32, w - 26, 20, 9, dim('#3f7a4a'));
    g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 0.6; g.beginPath(); g.roundRect(x + 10.5, y + 29.5, w - 21, 25, 11); g.stroke();
  } else if (f.name.includes('물류')) {
    shadow(x + 4, y + 4, w - 8, 26); g.fillStyle = dim('#6f7780'); g.fillRect(x + 4, y + 4, w - 8, 26);
    for (let k = 0; k * 5 < w - 8; k += 2) { g.fillStyle = 'rgba(0,0,0,0.14)'; g.fillRect(x + 4 + k * 5, y + 4, 5, 26); }
    g.fillStyle = dim('#8f98a1'); g.fillRect(x + 4, y + 16, w - 8, 1.6);
    const cols = ['#b5564a', '#3f69a8', '#c9a23a', '#5f9a82', '#8f7cc0', '#d9dde1'];
    for (let r = 0; r < 3; r++) for (let k = 0; k < 5; k++) { if (hash2(r * 7 + k, f.id + 3) < 0.25) continue; g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 7 + k * 14, y + 35.5 + r * 7.5, 12, 5.5); g.fillStyle = dim(cols[(hash2(k, r + f.id) * cols.length) | 0]); g.fillRect(x + 6, y + 34 + r * 7.5, 0, 0); g.fillRect(x + 6 + k * 14, y + 34 + r * 7.5, 12, 5.5); }
  } else {
    // 시청: 광장과 둥근 지붕
    shadow(x + 10, y + 5, w - 20, 30, 7);
    g.fillStyle = dim('#b9b2a0'); g.fillRect(x + 10, y + 5, w - 20, 30); g.fillStyle = dim('#d2ccba'); g.fillRect(x + 12, y + 7, w - 24, 26);
    disc(g, x + w / 2 + 2, y + 22, 10.5, 'rgba(0,0,0,0.3)'); disc(g, x + w / 2, y + 20, 10, dim('#5f8a86')); disc(g, x + w / 2 - 1.5, y + 18.5, 6, dim('#7fb0aa')); disc(g, x + w / 2, y + 20, 1.6, dim('#e8c15a'));
    for (let k = 0; k < 7; k++) { g.fillStyle = dim('#efeadb'); g.fillRect(x + 14 + k * 8, y + 35, 2.4, 4); }
    rr(g, x + 14, y + 42, w - 28, 15, 3, dim('#59626b'));
    disc(g, x + w / 2, y + 49.5, 5, dim('#3f7a9a')); disc(g, x + w / 2, y + 49.5, 2, dim('#b9e0ee'));
  }
}

export interface CityLamp { x: number; y: number }

export function buildCityStatic(sim: Sim): { c: HTMLCanvasElement; lamps: CityLamp[] } {
  const city = sim.city, night = sim.weather === 'night', K = CITY_K;
  const c = document.createElement('canvas'); c.width = Math.round(city.w * K); c.height = Math.round(city.h * K);
  const g = c.getContext('2d')!;
  g.scale(K, K);
  const dim = (col: string, k = 0.45): string => (night ? shade(col, -k) : col);
  const nid = (cc: number, r: number): RoadNode => city.nodes[r * COLS + cc];

  // 1) 바탕: 외곽의 들판
  g.fillStyle = dim(GROUND.outskirts, 0.28); g.fillRect(0, 0, city.w, city.h);
  const fieldCols = ['#24402a', '#2f4a2c', '#3a4a2a', '#45482a', '#2a3a26', '#324a36', '#4a4530'];
  for (let k = 0; k < 150; k++) {
    const fx = hash2(k, 11) * city.w, fy = hash2(k, 12) * city.h, fw = 70 + hash2(k, 13) * 130, fh = 50 + hash2(k, 14) * 110, a = (hash2(k, 15) - 0.5) * 0.5;
    g.save(); g.translate(fx, fy); g.rotate(a);
    const col = dim(fieldCols[(hash2(k, 16) * fieldCols.length) | 0], 0.4);
    g.fillStyle = col; g.fillRect(-fw / 2, -fh / 2, fw, fh);
    g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 1.4;
    const horiz = hash2(k, 17) > 0.5;
    if (horiz) for (let q = -fh / 2 + 3; q < fh / 2; q += 6) { g.beginPath(); g.moveTo(-fw / 2, q); g.lineTo(fw / 2, q); g.stroke(); }
    else for (let q = -fw / 2 + 3; q < fw / 2; q += 6) { g.beginPath(); g.moveTo(q, -fh / 2); g.lineTo(q, fh / 2); g.stroke(); }
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1; g.strokeRect(-fw / 2, -fh / 2, fw, fh);
    g.restore();
  }
  // 2) 블록의 땅: 쓰임새마다 바닥색이 다르다 (도로가 없는 경계는 이웃 블록과 그대로 이어진다)
  const USE_GROUND: Record<string, string> = {
    houses: '#23332b', bigHouses: '#24382d', villas: '#27312c', apt: '#27352e', park: '#24382d',
    office: '#272e37', shops: '#2a2f36', market: '#2c2f33', mart: '#2a2f36',
    factory: '#2c2a26', logistics: '#2d2c29', chemical: '#2b2b28', redevelop: '#3a3429', airport: '#26382b',
  };
  const useKind = (u: string): District => (u === 'office' || u === 'shops' || u === 'market' || u === 'mart' ? 'commercial' : u === 'factory' || u === 'logistics' || u === 'chemical' ? 'industrial' : USE_GROUND[u] && u !== 'airport' ? 'residential' : 'outskirts');
  for (const b of city.blocks) {
    const col = USE_GROUND[b.use]; if (!col) continue;
    const n00 = nid(b.c, b.r), n10 = nid(b.c + 1, b.r), n01 = nid(b.c, b.r + 1), n11 = nid(b.c + 1, b.r + 1);
    poly(g, [[n00.x, n00.y], [n10.x, n10.y], [n11.x, n11.y], [n01.x, n01.y]], dim(col, 0.25));
  }
  // 블록 안의 잔디·포장 무늬
  for (const b of city.blocks) {
    const d = useKind(b.use); if (d === 'outskirts' || b.use === 'park') continue;
    const x0 = b.x0 - 8, x1 = b.x1 + 8, y0 = b.y0 - 8, y1 = b.y1 + 8;
    const seed = Math.round(x0 * 3 + y0 * 7);
    if (d === 'residential') for (let k = 0; k < 16; k++) rr(g, x0 + hash2(seed, k) * (x1 - x0 - 30), y0 + hash2(seed, k + 40) * (y1 - y0 - 24), 18 + hash2(seed, k + 80) * 22, 14 + hash2(seed, k + 120) * 16, 3, dim(hash2(seed, k + 160) > 0.5 ? '#2a4030' : '#263a2d', 0.35));
    else if (d === 'commercial') { g.strokeStyle = 'rgba(255,255,255,0.045)'; g.lineWidth = 0.7; for (let q = x0; q < x1; q += 9) { g.beginPath(); g.moveTo(q, y0); g.lineTo(q, y1); g.stroke(); } }
    else for (let k = 0; k < 8; k++) rr(g, x0 + hash2(seed, k) * (x1 - x0 - 40), y0 + hash2(seed, k + 40) * (y1 - y0 - 30), 24 + hash2(seed, k + 80) * 30, 16 + hash2(seed, k + 120) * 22, 2, dim(hash2(seed, k + 160) > 0.5 ? '#35322c' : '#28261f', 0.3));
  }
  // 3) 터: 숲, 공원, 저수지, 활주로, 주차장, 놀이터 (넓은 것부터)
  const opens = city.places.filter((q) => q.open).sort((a, b) => b.w * b.h - a.w * a.h);
  for (const q of opens) paintOpen(g, q, dim, night);
  // 하천: 둔치 풀밭 → 자갈 → 물, 양쪽에 산책로와 나무
  const RV = city.river, rp = new Path2D();
  RV.pts.forEach(([x, y], i) => (i ? rp.lineTo(x, y) : rp.moveTo(x, y)));
  const riverAt = (y: number): number => { const i = Math.max(0, Math.min(RV.pts.length - 2, Math.floor((y - RV.pts[0][1]) / 20))); const A = RV.pts[i], B = RV.pts[i + 1]; return A[0] + ((B[0] - A[0]) * (y - A[1])) / 20; };
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = dim('#2c4d35', 0.3); g.lineWidth = RV.w + 36; g.stroke(rp);
  g.strokeStyle = dim('#6a6448', 0.35); g.lineWidth = RV.w + 7; g.stroke(rp);
  g.strokeStyle = dim('#1f5874', 0.35); g.lineWidth = RV.w; g.stroke(rp);
  g.strokeStyle = dim('#2a6f8f', 0.35); g.lineWidth = RV.w * 0.62; g.stroke(rp);
  g.strokeStyle = 'rgba(160,215,236,0.26)'; g.lineWidth = 0.8;
  for (let k = 0; k < 150; k++) { const y = hash2(k, 71) * city.h, x = riverAt(y) + (hash2(k, 72) - 0.5) * RV.w * 0.7; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 1.5, y + 4, x, y + 8); g.stroke(); }
  for (const side of [-1, 1]) {
    g.strokeStyle = dim('#b3a07a', 0.35); g.lineWidth = 1.5; g.setLineDash([5, 3]); g.beginPath();
    RV.pts.forEach(([x, y], i) => (i ? g.lineTo(x + side * (RV.w / 2 + 11), y) : g.moveTo(x + side * (RV.w / 2 + 11), y)));
    g.stroke(); g.setLineDash([]);
    for (let y = 8; y < city.h; y += 21) { if (hash2(y, 73 + side) < 0.35) continue; canopy(g, riverAt(y) + side * (RV.w / 2 + 16.5 + hash2(y, 75) * 2), y + hash2(y, 76) * 6, 3.4 + hash2(y, 77) * 1.6, hash2(y, 78), night); }
  }
  g.lineCap = 'butt';
  // 외곽에 흩어진 나무 (건물·활주로·물 위는 피한다)
  const keepOut = city.places.filter((q) => q.kind !== 'forest' && q.kind !== 'riverside' && !(q.kind === 'farmland' && !q.name.includes('공항')));
  for (let k = 0; k < 260; k++) {
    const tx = hash2(k, 31) * city.w, ty = hash2(k, 32) * city.h;
    const col = Math.round((tx - 170) / 257), row = Math.round((ty - 150) / 268);
    const inner = col >= 1 && col <= COLS - 2 && row >= 0 && row <= ROWS - 2 && tx > 300 && tx < city.w - 300 && ty < 150 + 268 * 4.3;
    if (inner || Math.abs(tx - riverAt(ty)) < RV.w / 2 + 8) continue;
    if (keepOut.some((q) => tx > q.x - 8 && tx < q.x + q.w + 8 && ty > q.y - 8 && ty < q.y + q.h + 8)) continue;
    canopy(g, tx, ty, 5 + 6 * hash2(k, 33), hash2(k, 34), night);
  }
  // 골목: 블록 안을 가로지르는 좁은 길
  for (const a of city.alleys) { seg(g, a.x0, a.y0, a.x1, a.y1, 8.6, 'rgba(0,0,0,0.3)'); seg(g, a.x0, a.y0, a.x1, a.y1, 7, dim('#343b43', 0.15)); }
  for (const a of city.alleys) { g.strokeStyle = 'rgba(235,238,240,0.12)'; g.lineWidth = 0.5; g.setLineDash([3, 5]); g.beginPath(); g.moveTo(a.x0, a.y0); g.lineTo(a.x1, a.y1); g.stroke(); g.setLineDash([]); }

  // 4) 도로
  const line = (test: (arterial: boolean) => boolean): Path2D => { const p = new Path2D(); for (const e of city.edges) { if (!test(e.arterial)) continue; const A = city.nodes[e.a], B = city.nodes[e.b]; p.moveTo(A.x, A.y); p.lineTo(B.x, B.y); } return p; };
  const art = line((a) => a), minor = line((a) => !a);
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 27; g.stroke(art); g.lineWidth = 20; g.stroke(minor);
  g.strokeStyle = dim('#4a545e', 0.28); g.lineWidth = 24; g.stroke(art); g.lineWidth = 17; g.stroke(minor);      // 보도
  g.strokeStyle = dim('#2a3038', 0.12); g.lineWidth = 12.5; g.stroke(minor);
  g.strokeStyle = dim('#2c333b', 0.12); g.lineWidth = 19; g.stroke(art);
  g.lineCap = 'butt';
  // 차선
  for (const e of city.edges) {
    const A = city.nodes[e.a], B = city.nodes[e.b], len = e.len, dx = (B.x - A.x) / len, dy = (B.y - A.y) / len, nx = -dy, ny = dx;
    const s0 = e.arterial ? 20 : 15, s1 = len - s0;
    if (s1 <= s0) continue;
    const sub = (off: number, col: string, w: number, dash?: number[]): void => {
      g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash ?? []);
      g.beginPath(); g.moveTo(A.x + dx * s0 + nx * off, A.y + dy * s0 + ny * off); g.lineTo(A.x + dx * s1 + nx * off, A.y + dy * s1 + ny * off); g.stroke();
    };
    if (e.arterial) { sub(-0.9, dim('#c9a13a', 0.3), 0.7); sub(0.9, dim('#c9a13a', 0.3), 0.7); sub(-5, 'rgba(235,238,240,0.5)', 0.6, [5, 6]); sub(5, 'rgba(235,238,240,0.5)', 0.6, [5, 6]); }
    else sub(0, 'rgba(235,238,240,0.42)', 0.6, [4.5, 5.5]);
    g.setLineDash([]);
    // 횡단보도와 정지선
    const half = e.arterial ? 8.2 : 5.2;
    for (const [px, py, sx, sy] of [[A.x + dx * (s0 - 4.5), A.y + dy * (s0 - 4.5), dx, dy], [B.x - dx * (s0 - 4.5), B.y - dy * (s0 - 4.5), -dx, -dy]] as number[][]) {
      g.fillStyle = 'rgba(235,238,240,0.6)';
      for (let q = -half + 0.9; q < half; q += 2.4) {
        const cx = px + nx * q, cy = py + ny * q;
        g.beginPath(); g.moveTo(cx - sx * 2.4 - nx * 0.6, cy - sy * 2.4 - ny * 0.6); g.lineTo(cx + sx * 2.4 - nx * 0.6, cy + sy * 2.4 - ny * 0.6); g.lineTo(cx + sx * 2.4 + nx * 0.6, cy + sy * 2.4 + ny * 0.6); g.lineTo(cx - sx * 2.4 + nx * 0.6, cy - sy * 2.4 + ny * 0.6); g.closePath(); g.fill();
      }
    }
  }
  // 다리: 하천을 건너는 도로에 난간을 단다
  for (const e of city.edges) {
    const A = city.nodes[e.a], B = city.nodes[e.b];
    if (A.r !== B.r || Math.min(A.c, B.c) !== RIVER_COL) continue;
    const L = A.x < B.x ? A : B, Rn = A.x < B.x ? B : A, my = (L.y + Rn.y) / 2, rx = riverAt(my), half = e.arterial ? 12.5 : 9.2;
    const t = (rx - L.x) / (Rn.x - L.x), cy = L.y + (Rn.y - L.y) * t, span = RV.w / 2 + 9;
    for (const sd of [-1, 1]) {
      seg(g, rx - span, cy + sd * half + 1.2, rx + span, cy + sd * half + 1.2, 2.4, 'rgba(0,0,0,0.35)');
      seg(g, rx - span, cy + sd * half, rx + span, cy + sd * half, 2, dim('#c2c9cf', 0.35));
      for (let q = -span; q <= span; q += span / 3) disc(g, rx + q, cy + sd * half, 1.5, dim('#8a9299', 0.35));
    }
  }
  // 5) 건물: 그림자를 먼저 깔고 종류별 지붕을 올린다
  const lots = city.facilities.map(facilityLot);
  const bs = city.places.filter((q) => !q.open && q.facility < 0);
  for (const b of bs) if (b.kind !== 'greenhouse' && b.kind !== 'utility' && b.kind !== 'storage' && b.kind !== 'construction' && b.kind !== 'gasStation') paintShadow(g, b);
  for (const b of bs) paintRoof(g, b, dim, night);
  // 주거 구역의 가로수
  for (const e of city.edges) {
    const A = city.nodes[e.a], B = city.nodes[e.b];
    if (A.district !== 'residential' && B.district !== 'residential') continue;
    const dx = (B.x - A.x) / e.len, dy = (B.y - A.y) / e.len, off = e.arterial ? 15 : 11.5;
    for (let s = 34; s < e.len - 30; s += 30) {
      const side = (Math.round(s / 30) + e.id) % 2 ? 1 : -1;
      const tx = A.x + dx * s - dy * off * side, ty = A.y + dy * s + dx * off * side;
      if (lots.some((l) => tx > l.x - 4 && tx < l.x + l.w + 4 && ty > l.y - 4 && ty < l.y + l.h + 4)) continue;
      canopy(g, tx, ty, 3.6, hash2(e.id, s), night);
    }
  }
  // 6) 주요 시설
  for (const f of city.facilities) drawFacility(g, f, night);

  // 7) 밤: 가로등 불빛과 창에서 새어 나오는 빛
  const lamps: CityLamp[] = [];
  for (const e of city.edges) {
    const A = city.nodes[e.a], B = city.nodes[e.b], dx = (B.x - A.x) / e.len, dy = (B.y - A.y) / e.len, off = e.arterial ? 11 : 8;
    const gap = e.arterial ? 62 : 84;
    for (let s = 26; s < e.len - 20; s += gap) { const side = Math.round(s / gap) % 2 ? 1 : -1; lamps.push({ x: A.x + dx * s - dy * off * side, y: A.y + dy * s + dx * off * side }); }
  }
  if (night) {
    g.globalCompositeOperation = 'lighter';
    for (const l of lamps) { const gr = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, 30); gr.addColorStop(0, 'rgba(255,214,150,0.5)'); gr.addColorStop(0.35, 'rgba(255,190,110,0.16)'); gr.addColorStop(1, 'rgba(255,170,90,0)'); g.fillStyle = gr; g.fillRect(l.x - 30, l.y - 30, 60, 60); }
    bs.forEach((b, i) => {
      if (b.kind === 'greenhouse' || b.kind === 'storage' || b.kind === 'construction') return;
      const n = b.district === 'commercial' ? 4 : b.district === 'residential' ? 2 : 1;
      for (let k = 0; k < n; k++) {
        if (hash2(i * 7 + k, 51) > (b.district === 'industrial' ? 0.4 : 0.72)) continue;
        const t = hash2(i * 3 + k, 52), sideK = (hash2(i + k, 53) * 4) | 0;
        const lx = sideK === 0 ? b.x + t * b.w : sideK === 1 ? b.x + b.w + 1.5 : sideK === 2 ? b.x + t * b.w : b.x - 1.5, ly = sideK === 0 ? b.y - 1.5 : sideK === 1 ? b.y + t * b.h : sideK === 2 ? b.y + b.h + 1.5 : b.y + t * b.h;
        const gr = g.createRadialGradient(lx, ly, 0, lx, ly, 13); gr.addColorStop(0, 'rgba(255,224,160,0.6)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
        g.fillStyle = gr; g.fillRect(lx - 13, ly - 13, 26, 26);
      }
    });
    g.globalCompositeOperation = 'source-over';
    for (const l of lamps) disc(g, l.x, l.y, 1.1, '#fff0c8');
  } else for (const l of lamps) { disc(g, l.x + 0.6, l.y + 0.8, 1, 'rgba(0,0,0,0.35)'); disc(g, l.x, l.y, 0.9, '#aab4bd'); }

  // 8) 잔 입자와 가장자리 어둡게
  g.setTransform(1, 0, 0, 1, 0, 0);
  const n = document.createElement('canvas'); n.width = n.height = 128;
  const ng = n.getContext('2d')!, im = ng.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) { const v = 128 + (hash2(i, 4441) - 0.5) * 110; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
  ng.putImageData(im, 0, 0);
  g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.13; g.fillStyle = g.createPattern(n, 'repeat')!; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  const vg = g.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.45, c.width / 2, c.height / 2, c.width * 0.72);
  vg.addColorStop(0, 'rgba(4,8,12,0)'); vg.addColorStop(1, 'rgba(4,8,12,0.62)');
  g.fillStyle = vg; g.fillRect(0, 0, c.width, c.height);
  return { c, lamps };
}
