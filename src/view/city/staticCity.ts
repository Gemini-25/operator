// 도시 지도의 고정된 부분: 땅, 논밭과 숲, 도로와 차선·횡단보도, 지붕, 공원, 주요 시설.
// 한 번만 그려 두고 매 프레임 크기를 바꿔 붙인다. 밤에는 가로등과 창 불빛을 함께 그려 둔다.

import { COLS, ROWS } from '../../sim/city';
import type { Sim } from '../../sim/engine';
import type { Building, District, Facility, RoadNode } from '../../sim/types';
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

function poly(g: G, pts: number[][], col: string): void {
  g.fillStyle = col; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath(); g.fill();
}

function canopy(g: G, x: number, y: number, r: number, h: number, night: boolean): void {
  const tones = h > 0.6 ? ['#1c4a2c', '#2b6a3a', '#3f8a4a'] : h > 0.3 ? ['#234b27', '#356b30', '#4c8a3e'] : ['#1f4433', '#2e6044', '#3f7c58'];
  oval(g, x + r * 0.35, y + r * 0.45, r * 1.05, r * 0.95, 'rgba(0,0,0,0.3)');
  for (let l = 0; l < 3; l++) {
    const rad = r * (1 - l * 0.26), off = -l * r * 0.16;
    for (let k = 0; k < 5; k++) {
      const a = (k / 5) * 6.2832 + h * 6, d = rad * 0.42;
      disc(g, x + Math.cos(a) * d + off, y + Math.sin(a) * d + off, rad * 0.62, night ? shade(tones[l], -0.45) : tones[l]);
    }
  }
}

function hipRoof(g: G, x: number, y: number, w: number, h: number, col: string): void {
  const m = Math.min(w, h) / 2, horiz = w >= h;
  const A = [x, y], B = [x + w, y], C = [x + w, y + h], D = [x, y + h];
  const R1 = horiz ? [x + m, y + h / 2] : [x + w / 2, y + m], R2 = horiz ? [x + w - m, y + h / 2] : [x + w / 2, y + h - m];
  poly(g, horiz ? [A, B, R2, R1] : [A, B, R1], shade(col, 0.14));
  poly(g, horiz ? [B, C, R2] : [B, C, R2, R1], shade(col, -0.14));
  poly(g, horiz ? [C, D, R1, R2] : [C, D, R2], shade(col, -0.26));
  poly(g, horiz ? [D, A, R1] : [D, A, R1, R2], shade(col, 0.03));
  g.strokeStyle = shade(col, 0.3); g.lineWidth = 0.8; g.beginPath(); g.moveTo(R1[0], R1[1]); g.lineTo(R2[0], R2[1]); g.stroke();
  g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = 0.6; g.strokeRect(x, y, w, h);
}

function flatRoof(g: G, b: Building, col: string, seed: number): void {
  const { x, y, w, h } = b;
  g.fillStyle = shade(col, -0.25); g.fillRect(x, y, w, h);
  g.fillStyle = col; g.fillRect(x + 1.6, y + 1.6, w - 3.2, h - 3.2);
  g.fillStyle = 'rgba(255,255,255,0.09)'; g.fillRect(x + 1.6, y + 1.6, w - 3.2, 1.2); g.fillRect(x + 1.6, y + 1.6, 1.2, h - 3.2);
  const hv = (k: number): number => hash2(seed, k);
  const v = hv(1);
  if (v < 0.22 && w > 26 && h > 22) {
    // 옥상 정원
    g.fillStyle = '#35553a'; g.fillRect(x + 5, y + 5, w * 0.45, h - 10);
    for (let k = 0; k < 3; k++) disc(g, x + 8 + hv(10 + k) * (w * 0.45 - 6), y + 8 + hv(20 + k) * (h - 16), 2.6, '#4b7a4c');
  } else if (v < 0.4 && w > 30 && h > 30) {
    // 채광창
    const n = Math.max(1, Math.floor((w - 12) / 9));
    for (let k = 0; k < n; k++) { g.fillStyle = '#2f4a60'; g.fillRect(x + 6 + k * 9, y + h * 0.3, 6, h * 0.4); g.fillStyle = 'rgba(160,210,240,0.35)'; g.fillRect(x + 6 + k * 9, y + h * 0.3, 6, 1.5); }
  }
  // 공조 설비
  const units = 1 + ((hv(2) * 3) | 0);
  for (let k = 0; k < units; k++) {
    const ux = x + 5 + hv(30 + k) * Math.max(1, w - 18), uy = y + 5 + hv(40 + k) * Math.max(1, h - 16);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(ux + 1.2, uy + 1.6, 8, 6);
    g.fillStyle = '#9aa3ac'; g.fillRect(ux, uy, 8, 6);
    disc(g, ux + 2.4, uy + 3, 1.6, '#4c555e'); disc(g, ux + 5.8, uy + 3, 1.6, '#4c555e');
  }
  if (hv(3) > 0.6 && w > 24) { g.fillStyle = shade(col, 0.2); g.fillRect(x + w - 11, y + 4, 7, 7); g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + w - 11, y + 10, 7, 1); }
}

function shedRoof(g: G, b: Building, col: string, seed: number): void {
  const { x, y, w, h } = b, horiz = w >= h;
  g.fillStyle = col; g.fillRect(x, y, w, h);
  g.fillStyle = 'rgba(0,0,0,0.14)';
  if (horiz) for (let k = 0; k * 4 < w; k += 2) g.fillRect(x + k * 4, y, 4, h); else for (let k = 0; k * 4 < h; k += 2) g.fillRect(x, y + k * 4, w, 4);
  g.fillStyle = shade(col, 0.28);
  if (horiz) g.fillRect(x, y + h / 2 - 0.8, w, 1.6); else g.fillRect(x + w / 2 - 0.8, y, 1.6, h);
  g.fillStyle = 'rgba(0,0,0,0.2)'; if (horiz) g.fillRect(x, y + h / 2 + 0.8, w, h / 2 - 0.8); else g.fillRect(x + w / 2 + 0.8, y, w / 2 - 0.8, h);
  g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 0.7; g.strokeRect(x, y, w, h);
  const n = 1 + ((hash2(seed, 5) * 3) | 0);
  for (let k = 0; k < n; k++) { const vx = x + 6 + hash2(seed, 6 + k) * Math.max(1, w - 12), vy = y + 6 + hash2(seed, 9 + k) * Math.max(1, h - 12); disc(g, vx + 0.8, vy + 1, 2.4, 'rgba(0,0,0,0.3)'); disc(g, vx, vy, 2.2, '#aab2b9'); disc(g, vx, vy, 1, '#59626b'); }
  if (hash2(seed, 15) > 0.55 && w > 30 && h > 30) { const cx = x + w * 0.8, cy = y + h * 0.25; oval(g, cx + 5, cy + 7, 3.4, 9, 'rgba(0,0,0,0.3)', -0.6); disc(g, cx, cy, 3.6, '#7d6a5e'); disc(g, cx, cy, 2, '#2a2420'); }
}

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
  // 2) 구역별 땅 (도로 사이의 블록)
  const blocks: { d: District; pts: number[][] }[] = [];
  for (let r = 0; r < ROWS - 1; r++) for (let cc = 0; cc < COLS - 1; cc++) {
    const n00 = nid(cc, r), n10 = nid(cc + 1, r), n01 = nid(cc, r + 1), n11 = nid(cc + 1, r + 1);
    const ds = [n00.district, n10.district, n01.district, n11.district];
    const d: District = ds.filter((q) => q === 'outskirts').length >= 2 ? 'outskirts' : ds.find((q) => q !== 'outskirts')!;
    blocks.push({ d, pts: [[n00.x, n00.y], [n10.x, n10.y], [n11.x, n11.y], [n01.x, n01.y]] });
  }
  for (const b of blocks) if (b.d !== 'outskirts') poly(g, b.pts, dim(GROUND[b.d], 0.25));
  // 블록 안의 잔디·포장 무늬
  for (const b of blocks) {
    if (b.d === 'outskirts') continue;
    const x0 = Math.max(b.pts[0][0], b.pts[3][0]) + 14, x1 = Math.min(b.pts[1][0], b.pts[2][0]) - 14, y0 = Math.max(b.pts[0][1], b.pts[1][1]) + 14, y1 = Math.min(b.pts[2][1], b.pts[3][1]) - 14;
    const seed = Math.round(x0 * 3 + y0 * 7);
    if (b.d === 'residential') for (let k = 0; k < 16; k++) rr(g, x0 + hash2(seed, k) * (x1 - x0 - 30), y0 + hash2(seed, k + 40) * (y1 - y0 - 24), 18 + hash2(seed, k + 80) * 22, 14 + hash2(seed, k + 120) * 16, 3, dim(hash2(seed, k + 160) > 0.5 ? '#2a4030' : '#263a2d', 0.35));
    else if (b.d === 'commercial') { g.strokeStyle = 'rgba(255,255,255,0.045)'; g.lineWidth = 0.7; for (let q = x0; q < x1; q += 9) { g.beginPath(); g.moveTo(q, y0); g.lineTo(q, y1); g.stroke(); } }
    else for (let k = 0; k < 8; k++) rr(g, x0 + hash2(seed, k) * (x1 - x0 - 40), y0 + hash2(seed, k + 40) * (y1 - y0 - 30), 24 + hash2(seed, k + 80) * 30, 16 + hash2(seed, k + 120) * 22, 2, dim(hash2(seed, k + 160) > 0.5 ? '#35322c' : '#28261f', 0.3));
  }
  // 3) 공원: 풀밭, 연못, 산책로, 나무
  for (const p of city.parks) {
    const gr = g.createRadialGradient(p.x, p.y, p.r * 0.3, p.x, p.y, p.r);
    gr.addColorStop(0, dim('#3d6a3f', 0.4)); gr.addColorStop(0.8, dim('#335a37', 0.4)); gr.addColorStop(1, 'rgba(40,80,50,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r, 0, 6.2832); g.fill();
    const sd = Math.round(p.x * 3 + p.y);
    if (hash2(sd, 1) > 0.5) { oval(g, p.x + p.r * 0.2, p.y + p.r * 0.1, p.r * 0.3, p.r * 0.2, dim('#1c3a2a', 0.3), hash2(sd, 2) * 3); oval(g, p.x + p.r * 0.2, p.y + p.r * 0.1, p.r * 0.26, p.r * 0.16, dim('#2f6f8f', 0.4), hash2(sd, 2) * 3); }
    g.strokeStyle = dim('#8a7a5c', 0.4); g.lineWidth = 1.6; g.setLineDash([4, 3]); g.beginPath(); g.arc(p.x, p.y, p.r * 0.62, hash2(sd, 3) * 6, hash2(sd, 3) * 6 + 4.2); g.stroke(); g.setLineDash([]);
    const n = 6 + ((p.r / 9) | 0);
    for (let k = 0; k < n; k++) { const a = hash2(sd, 10 + k) * 6.2832, d = (0.35 + 0.6 * hash2(sd, 40 + k)) * p.r; canopy(g, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d, 6 + 5 * hash2(sd, 70 + k), hash2(sd, 90 + k), night); }
  }
  // 외곽에 흩어진 나무
  for (let k = 0; k < 260; k++) {
    const tx = hash2(k, 31) * city.w, ty = hash2(k, 32) * city.h;
    const col = Math.round((tx - 170) / 257), row = Math.round((ty - 150) / 268);
    const inner = col >= 1 && col <= COLS - 2 && row >= 0 && row <= ROWS - 2 && tx > 300 && tx < city.w - 300 && ty < 150 + 268 * 4.3;
    if (inner) continue;
    canopy(g, tx, ty, 5 + 6 * hash2(k, 33), hash2(k, 34), night);
  }

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
  // 5) 건물 (시설 부지와 겹치는 것은 뺀다)
  const lots = city.facilities.map(facilityLot);
  const hit = (b: Building): boolean => lots.some((l) => b.x < l.x + l.w + 2 && b.x + b.w > l.x - 2 && b.y < l.y + l.h + 2 && b.y + b.h > l.y - 2);
  const bs = city.buildings.filter((b) => !hit(b));
  for (const b of bs) {
    const d = b.district === 'commercial' ? 8 : b.district === 'industrial' ? 5.5 : 4.5;
    g.fillStyle = 'rgba(0,0,0,0.42)'; g.beginPath(); g.moveTo(b.x, b.y + b.h); g.lineTo(b.x + d, b.y + b.h + d * 1.2); g.lineTo(b.x + b.w + d, b.y + b.h + d * 1.2); g.lineTo(b.x + b.w + d, b.y + d * 1.2); g.lineTo(b.x + b.w, b.y); g.closePath(); g.fill();
  }
  bs.forEach((b, i) => {
    const pal = ROOFS[b.district], seed = i * 31 + 7;
    const col = dim(mix(pal[(b.tone * pal.length) | 0], '#ffffff', (hash2(seed, 2) - 0.5) * 0.12 + 0.02), 0.5);
    if (b.district === 'residential') {
      // 주택: 큰 필지는 두 채로 나눈다
      if (b.w > 34 && hash2(seed, 3) > 0.35) { const gap = 3, w1 = (b.w - gap) * (0.42 + 0.16 * hash2(seed, 4)); hipRoof(g, b.x, b.y, w1, b.h * (0.8 + 0.2 * hash2(seed, 5)), col); hipRoof(g, b.x + w1 + gap, b.y + b.h * 0.1 * hash2(seed, 6), b.w - w1 - gap, b.h * (0.78 + 0.2 * hash2(seed, 7)), dim(pal[(hash2(seed, 8) * pal.length) | 0], 0.5)); }
      else hipRoof(g, b.x, b.y, b.w, b.h, col);
    } else if (b.district === 'commercial') flatRoof(g, b, col, seed);
    else if (b.district === 'industrial') shedRoof(g, b, col, seed);
    else hipRoof(g, b.x, b.y, b.w, b.h, col);
  });
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
