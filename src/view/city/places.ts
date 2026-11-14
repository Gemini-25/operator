// 지도 위의 건물과 터를 종류별로 그린다. 고정 층(staticCity.ts)이 한 번만 부른다.
// 건물은 위에서 본 지붕으로, 종류마다 지붕 모양·색·부속물이 달라 멀리서도 구분된다.

import type { Place } from '../../sim/types';
import { disc, hash2, mix, oval, rr, seg, shade } from '../scene/common';
import type { G } from '../scene/common';

interface Rect4 { x: number; y: number; w: number; h: number }
type Dim = (c: string, k?: number) => string;

export function poly(g: G, pts: number[][], col: string): void {
  g.fillStyle = col; g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
  for (let i = 1; i < pts.length; i++) g.lineTo(pts[i][0], pts[i][1]);
  g.closePath(); g.fill();
}

export function canopy(g: G, x: number, y: number, r: number, h: number, night: boolean): void {
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

export function hipRoof(g: G, x: number, y: number, w: number, h: number, col: string): void {
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

export function flatRoof(g: G, b: Rect4, col: string, seed: number): void {
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

export function shedRoof(g: G, b: Rect4, col: string, seed: number): void {
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


const HV = (p: Place, k: number): number => hash2(p.id * 17 + 3, k);
const CARS = ['#c9ccd1', '#2b2f36', '#a33a34', '#35568f', '#8b8f96', '#e7e2d4'];

function tank(g: G, x: number, y: number, r: number, col: string): void {
  disc(g, x + r * 0.35, y + r * 0.45, r, 'rgba(0,0,0,0.35)'); disc(g, x, y, r, shade(col, -0.25)); disc(g, x, y, r * 0.86, col);
  disc(g, x - r * 0.25, y - r * 0.25, r * 0.4, shade(col, 0.18)); disc(g, x, y, r * 0.12, shade(col, -0.4));
}
function plane(g: G, x: number, y: number, a: number, k: number, col: string): void {
  g.save(); g.translate(x, y); g.rotate(a); g.scale(k, k);
  poly(g, [[-1, 0], [3, 0], [-3, -10], [-5, -10]], shade(col, -0.12)); poly(g, [[-1, 0], [3, 0], [-3, 10], [-5, 10]], shade(col, -0.12));
  poly(g, [[-9, 0], [-7, 0], [-10.5, -4], [-11.5, -4]], shade(col, -0.12)); poly(g, [[-9, 0], [-7, 0], [-10.5, 4], [-11.5, 4]], shade(col, -0.12));
  seg(g, -10, 0, 9, 0, 2.6, col); disc(g, 9.6, 0, 1.3, col); g.fillStyle = '#35568f'; g.fillRect(6.5, -0.7, 2, 1.4);
  g.restore();
}
function carsRow(g: G, x: number, y: number, w: number, seed: number, dim: Dim): void {
  g.strokeStyle = 'rgba(235,238,240,0.35)'; g.lineWidth = 0.5;
  for (let q = 0; q * 5.2 < w; q++) {
    const cx = x + q * 5.2;
    g.beginPath(); g.moveTo(cx, y); g.lineTo(cx, y + 8.5); g.stroke();
    if (hash2(seed, q) < 0.55 && cx + 5 < x + w) rr(g, cx + 0.9, y + 1, 3.4, 6.6, 1, dim(CARS[(hash2(seed + 9, q) * CARS.length) | 0], 0.4));
  }
}

/** 건물이 아닌 터: 공원, 숲, 저수지, 주차장, 놀이터, 활주로 */
export function paintOpen(g: G, p: Place, dim: Dim, night: boolean): void {
  const { x, y, w, h } = p;
  if (p.kind === 'park') {
    rr(g, x, y, w, h, 14, dim('#2c5234', 0.35)); rr(g, x + 3, y + 3, w - 6, h - 6, 12, dim('#35603a', 0.35));
    for (let k = 0; k < 7; k++) oval(g, x + 14 + HV(p, k) * (w - 28), y + 14 + HV(p, k + 20) * (h - 28), 10 + HV(p, k + 40) * 16, 7 + HV(p, k + 60) * 10, dim('#3f7044', 0.35), HV(p, k + 80) * 3);
    const px = x + w * 0.56, py = y + h * 0.42;
    oval(g, px, py, w * 0.24, h * 0.13, dim('#1c3a2a', 0.3), 0.3); oval(g, px, py, w * 0.22, h * 0.115, dim('#2f6f8f', 0.35), 0.3); oval(g, px - w * 0.05, py - h * 0.03, w * 0.08, h * 0.03, 'rgba(180,225,240,0.25)', 0.3);
    g.strokeStyle = dim('#b3a07a', 0.35); g.lineWidth = 2.2; g.lineCap = 'round';
    g.beginPath(); g.moveTo(x + 2, y + h * 0.5); g.quadraticCurveTo(x + w * 0.3, y + h * 0.75, x + w * 0.55, y + h * 0.7); g.quadraticCurveTo(x + w * 0.85, y + h * 0.64, x + w - 2, y + h * 0.82); g.stroke();
    g.beginPath(); g.moveTo(x + w * 0.4, y + 2); g.quadraticCurveTo(x + w * 0.2, y + h * 0.3, x + w * 0.3, y + h * 0.66); g.stroke();
    g.beginPath(); g.ellipse(px, py, w * 0.29, h * 0.17, 0.3, 0, 6.2832); g.stroke(); g.lineCap = 'butt';
    for (let k = 0; k < 6; k++) disc(g, x + w * 0.3 + (HV(p, 100 + k) - 0.5) * 16, y + h * 0.86 + (HV(p, 110 + k) - 0.5) * 10, 1.6, dim(['#e06a8a', '#f0c84a', '#e9e4d8'][k % 3], 0.3));
    const n = Math.round((w * h) / 620);
    for (let k = 0; k < n; k++) {
      const tx = x + 8 + HV(p, 200 + k) * (w - 16), ty = y + 8 + HV(p, 300 + k) * (h - 16);
      if (((tx - px) / (w * 0.3)) ** 2 + ((ty - py) / (h * 0.19)) ** 2 < 1) continue;
      canopy(g, tx, ty, 4.5 + 4.5 * HV(p, 400 + k), HV(p, 500 + k), night);
    }
  } else if (p.kind === 'forest') {
    rr(g, x, y, w, h, 22, dim('#1c3a26', 0.3));
    for (let k = 0; k < 6; k++) oval(g, x + 20 + HV(p, k) * (w - 40), y + 20 + HV(p, k + 20) * (h - 40), 22 + HV(p, k + 40) * 26, 16 + HV(p, k + 60) * 18, dim(k % 2 ? '#234a2c' : '#18331f', 0.3), HV(p, k + 80) * 3);
    g.strokeStyle = dim('#8a7a5c', 0.4); g.lineWidth = 1.4; g.setLineDash([4, 3]);
    g.beginPath(); g.moveTo(x + w * 0.5, y + h - 2); g.bezierCurveTo(x + w * 0.2, y + h * 0.7, x + w * 0.8, y + h * 0.45, x + w * 0.45, y + h * 0.2); g.stroke(); g.setLineDash([]);
    const n = Math.round((w * h) / 150);
    for (let k = 0; k < n; k++) canopy(g, x + 5 + HV(p, 200 + k) * (w - 10), y + 5 + HV(p, 300 + k) * (h - 10), 4.5 + 6 * HV(p, 400 + k), HV(p, 500 + k), night);
  } else if (p.kind === 'farmland') {
    if (p.name.includes('공항')) { rr(g, x, y, w, h, 6, dim('#2b3f2e', 0.3)); g.strokeStyle = 'rgba(0,0,0,0.12)'; g.lineWidth = 1; for (let q = y + 6; q < y + h; q += 7) { g.beginPath(); g.moveTo(x + 4, q); g.lineTo(x + w - 4, q); g.stroke(); } }
  } else if (p.kind === 'reservoir') {
    const cx = x + w / 2, cy = y + h / 2;
    const blob = (k: number): void => { g.beginPath(); for (let i = 0; i <= 28; i++) { const a = (i / 28) * 6.2832, r = k * (1 + 0.1 * Math.sin(a * 3 + 1) + 0.06 * Math.sin(a * 5)); const qx = cx + Math.cos(a) * (w / 2) * r, qy = cy + Math.sin(a) * (h / 2) * r; if (i) g.lineTo(qx, qy); else g.moveTo(qx, qy); } g.closePath(); };
    g.fillStyle = dim('#5c5a42', 0.35); blob(1.0); g.fill(); g.fillStyle = dim('#1a4a60', 0.35); blob(0.95); g.fill();
    const gr = g.createRadialGradient(cx - w * 0.1, cy - h * 0.1, 4, cx, cy, Math.max(w, h) * 0.55); gr.addColorStop(0, dim('#3a86a8', 0.35)); gr.addColorStop(1, dim('#1f5874', 0.35));
    g.fillStyle = gr; blob(0.9); g.fill();
    g.strokeStyle = 'rgba(170,220,240,0.22)'; g.lineWidth = 0.8;
    for (let k = 0; k < 26; k++) { const a = HV(p, k) * 6.2832, r = Math.sqrt(HV(p, k + 30)) * 0.72, qx = cx + Math.cos(a) * (w / 2) * r, qy = cy + Math.sin(a) * (h / 2) * r; g.beginPath(); g.moveTo(qx, qy); g.quadraticCurveTo(qx + 4, qy - 1.6, qx + 9, qy); g.stroke(); }
    seg(g, x + w * 0.96, y + h * 0.3, x + w * 0.96, y + h * 0.7, 5, dim('#7d8288', 0.35)); seg(g, x + w * 0.96, y + h * 0.3, x + w * 0.96, y + h * 0.7, 1.2, dim('#b4bac0', 0.35));      // 둑
    g.fillStyle = dim('#8a6a45', 0.35); g.fillRect(x + w * 0.1, cy + h * 0.2, 16, 3); rr(g, x + w * 0.1 + 17, cy + h * 0.2 - 1.5, 7, 3.6, 1.6, dim('#e7e2d4', 0.35));      // 낚시 잔교와 배
  } else if (p.kind === 'parking') {
    rr(g, x, y, w, h, 3, dim('#2d333a', 0.2)); g.strokeStyle = 'rgba(255,255,255,0.1)'; g.lineWidth = 0.7; g.strokeRect(x + 1, y + 1, w - 2, h - 2);
    for (let q = y + 2.5; q + 9 <= y + h - 1; q += 15) carsRow(g, x + 3, q, w - 6, p.id * 7 + Math.round(q), dim);
  } else if (p.kind === 'playground') {
    rr(g, x, y, w, h, 5, dim('#a88f62', 0.35)); disc(g, x + w * 0.3, y + h * 0.4, 3.4, dim('#d8423a', 0.35)); disc(g, x + w * 0.3, y + h * 0.4, 1.2, dim('#f0c84a', 0.35));
    seg(g, x + w * 0.55, y + h * 0.25, x + w * 0.85, y + h * 0.6, 2.2, dim('#3f8ad8', 0.35)); seg(g, x + w * 0.2, y + h * 0.78, x + w * 0.7, y + h * 0.78, 1.4, dim('#5ad17a', 0.35));
  } else if (p.kind === 'runway') {
    // 계류장과 유도로, 활주로
    g.fillStyle = dim('#3a4046', 0.2); g.fillRect(x + w * 0.12, y - 46, w * 0.76, 38);
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 0.6; for (let q = x + w * 0.12; q < x + w * 0.88; q += 12) { g.beginPath(); g.moveTo(q, y - 46); g.lineTo(q, y - 8); g.stroke(); }
    for (const tx of [x + w * 0.2, x + w * 0.8]) { g.fillStyle = dim('#353b41', 0.2); g.fillRect(tx - 6, y - 10, 12, 12); g.strokeStyle = dim('#d9b23a', 0.3); g.lineWidth = 0.8; g.beginPath(); g.moveTo(tx, y - 44); g.lineTo(tx, y + 2); g.stroke(); }
    g.strokeStyle = dim('#d9b23a', 0.3); g.lineWidth = 0.8; g.beginPath(); g.moveTo(x + w * 0.2, y - 27); g.lineTo(x + w * 0.8, y - 27); g.stroke();
    g.fillStyle = dim('#24282d', 0.1); g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(235,238,240,0.75)'; g.lineWidth = 0.9; g.strokeRect(x + 2, y + 2, w - 4, h - 4);
    g.setLineDash([14, 10]); g.lineWidth = 1.2; g.beginPath(); g.moveTo(x + 34, y + h / 2); g.lineTo(x + w - 34, y + h / 2); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(235,238,240,0.8)';
    for (const ex of [x + 8, x + w - 20]) for (let q = 0; q < 6; q++) g.fillRect(ex, y + 5 + q * ((h - 10) / 6), 12, (h - 10) / 6 - 1.4);
    for (const ex of [x + 60, x + w - 74]) { g.fillRect(ex, y + 6, 14, 3); g.fillRect(ex, y + h - 9, 14, 3); }
    for (let k = 0; k < 3; k++) plane(g, x + w * (0.3 + k * 0.17), y - 30 + (k % 2) * 6, -Math.PI / 2, 1.05, dim('#eef1f4', 0.3));
    plane(g, x + w * 0.62, y + h / 2, 0, 1.25, dim('#eef1f4', 0.3));
    for (let q = x + 6; q < x + w - 4; q += 16) { disc(g, q, y - 1.5, 0.8, night ? '#7ad0ff' : '#5a7f95'); disc(g, q, y + h + 1.5, 0.8, night ? '#7ad0ff' : '#5a7f95'); }
  }
}

const HOUSE = ['#8b5644', '#6f4a3c', '#7a6a4f', '#7d4a4a', '#51606e', '#476660', '#5d5f66'];
const SHOPC = ['#6a6f78', '#70757f', '#5a6470', '#6b6f66', '#77706a', '#5f6872'];
const AWN = ['#c9483f', '#3f8a5c', '#3f69a8', '#d9a23a', '#8f5cc0', '#d8642f'];
const pal = (p: Place, a: string[]): string => a[(p.tone * a.length) | 0];

/** 건물의 그림자: 층수가 높을수록 길다 */
export function paintShadow(g: G, p: Place): void {
  const d = Math.min(15, 3 + p.floors * 1.25);
  g.fillStyle = 'rgba(0,0,0,0.42)'; g.beginPath(); g.moveTo(p.x, p.y + p.h); g.lineTo(p.x + d, p.y + p.h + d * 1.2); g.lineTo(p.x + p.w + d, p.y + p.h + d * 1.2); g.lineTo(p.x + p.w + d, p.y + d * 1.2); g.lineTo(p.x + p.w, p.y); g.closePath(); g.fill();
}

/** 건물 한 채의 지붕 */
export function paintRoof(g: G, p: Place, dim: Dim, night: boolean): void {
  const { x, y, w, h } = p, k = p.kind;
  const tint = (c: string): string => dim(mix(c, '#ffffff', (HV(p, 2) - 0.5) * 0.12 + 0.02), 0.5);
  const awning = (col: string): void => { g.fillStyle = dim(col, 0.4); g.fillRect(x, y + h - 3.2, w, 3.2); g.fillStyle = 'rgba(255,255,255,0.35)'; for (let q = x; q < x + w - 2; q += 5) g.fillRect(q, y + h - 3.2, 2.5, 3.2); };
  if (k === 'houseS' || k === 'farmhouse') {
    rr(g, x - 3.5, y - 3.5, w + 7, h + 9, 2, dim(k === 'farmhouse' ? '#3a4630' : '#2b4532', 0.35));
    disc(g, x - 1, y + h + 2.6, 1.9, dim('#3f7a48', 0.4)); disc(g, x + w + 0.6, y + h + 1.6, 1.5, dim('#4b8a52', 0.4));
    hipRoof(g, x, y, w, h, tint(k === 'farmhouse' ? ['#3f6a9a', '#9a4a3c', '#5f6a5a'][(p.tone * 3) | 0] : pal(p, HOUSE)));
  } else if (k === 'houseL' || k === 'pension') {
    rr(g, x - 5, y - 5, w + 10, h + 11, 3, dim(k === 'pension' ? '#2a4a30' : '#2f4c36', 0.35));
    if (k === 'pension') { g.fillStyle = dim('#9a7a52', 0.4); g.fillRect(x + w * 0.2, y + h, w * 0.6, 4.5); }
    else if (HV(p, 4) > 0.55) { rr(g, x + w - 12, y + h + 0.8, 11, 4.6, 1.6, dim('#d8dde2', 0.35)); rr(g, x + w - 11.2, y + h + 1.5, 9.4, 3.2, 1.2, dim('#4aa3c9', 0.35)); }      // 수영장
    else { canopy(g, x + w - 4, y + h + 2.5, 3.2, HV(p, 5), night); disc(g, x + 3, y + h + 3, 1.8, dim('#4b8a52', 0.4)); }
    const col = tint(k === 'pension' ? ['#7a5a3c', '#6a4a34', '#8a6a48'][(p.tone * 3) | 0] : pal(p, HOUSE));
    const w1 = w * (0.58 + 0.1 * HV(p, 6));
    hipRoof(g, x + w1 - 2, y + h * 0.28, w - w1 + 2, h * 0.72, shade(col, -0.06)); hipRoof(g, x, y, w1, h * 0.86, col);
    g.fillStyle = dim('#8f8a80', 0.4); g.fillRect(x + w1 * 0.3, y + h * 0.2, 2.4, 2.4);
  } else if (k === 'villa' || k === 'dorm') {
    const col = tint(k === 'dorm' ? '#7f8388' : ['#8a5f4c', '#7a6a5a', '#6d6f76', '#86705a'][(p.tone * 4) | 0]);
    flatRoof(g, p, col, p.id * 31 + 7);
    disc(g, x + w * 0.78 + 0.8, y + h * 0.3 + 1, 3, 'rgba(0,0,0,0.3)'); disc(g, x + w * 0.78, y + h * 0.3, 2.8, dim(HV(p, 7) > 0.5 ? '#e0b83a' : '#4a8fd0', 0.4)); disc(g, x + w * 0.78, y + h * 0.3, 1, 'rgba(0,0,0,0.25)');      // 옥상 물탱크
    g.fillStyle = shade(col, 0.2); g.fillRect(x + 3, y + 3, 6, 6);
  } else if (k === 'apartment') {
    // 판상형 아파트: 긴 지붕에 계단실 세 개, 앞쪽에 주차장
    g.fillStyle = dim('#2d333a', 0.2); g.fillRect(x - 2, y + h + 6, w + 4, 10.5); carsRow(g, x, y + h + 7, w, p.id * 5, dim);
    const col = tint(['#b8b2a4', '#a9adb2', '#b5a998'][(p.tone * 3) | 0]);
    g.fillStyle = shade(col, -0.3); g.fillRect(x, y, w, h); g.fillStyle = col; g.fillRect(x + 1.2, y + 1.2, w - 2.4, h - 2.4);
    g.fillStyle = 'rgba(0,0,0,0.12)'; for (let q = x + 6; q < x + w - 3; q += 6.2) g.fillRect(q, y + 1.2, 0.7, h - 2.4);
    for (let q = 0; q < 3; q++) { const cx = x + w * (0.18 + q * 0.32); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(cx - 3, y + h * 0.5 - 3.4, 8, 8); g.fillStyle = shade(col, 0.16); g.fillRect(cx - 4, y + h * 0.5 - 4.4, 8, 8); g.fillStyle = shade(col, -0.2); g.fillRect(cx - 2, y + h * 0.5 - 2.4, 4, 4); }
    g.fillStyle = dim(['#3f69a8', '#3f8a5c', '#c9682f'][(p.block + 1) % 3], 0.4); g.fillRect(x + 1.2, y + 1.2, 5, h - 2.4);      // 동 표시 띠
  } else if (k === 'office' || k === 'officetel' || k === 'hotel') {
    const col = tint(k === 'hotel' ? '#8a7f74' : k === 'officetel' ? '#5c6470' : ['#4f6478', '#5a6b7c', '#52606e', '#607080'][(p.tone * 4) | 0]);
    g.fillStyle = shade(col, -0.32); g.fillRect(x, y, w, h);
    const gr = g.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, shade(col, 0.16)); gr.addColorStop(1, shade(col, -0.08));
    g.fillStyle = gr; g.fillRect(x + 1.6, y + 1.6, w - 3.2, h - 3.2);
    const m = Math.min(w, h) * 0.16; g.fillStyle = shade(col, 0.1); g.fillRect(x + m, y + m, w - m * 2, h - m * 2); g.strokeStyle = 'rgba(255,255,255,0.14)'; g.lineWidth = 0.7; g.strokeRect(x + m, y + m, w - m * 2, h - m * 2);
    if (k === 'hotel') { rr(g, x + m + 3, y + m + 3, w * 0.34, h * 0.2, 2, dim('#d8dde2', 0.35)); rr(g, x + m + 4, y + m + 4, w * 0.34 - 2, h * 0.2 - 2, 1.5, dim('#4aa3c9', 0.35)); g.fillStyle = dim('#a8382c', 0.4); g.fillRect(x + w * 0.4, y + h - 2.5, w * 0.2, 5); }
    else if (p.floors >= 9) { disc(g, x + w / 2, y + h / 2, Math.min(w, h) * 0.2, shade(col, -0.25)); g.strokeStyle = dim('#e8c15a', 0.3); g.lineWidth = 1; g.beginPath(); g.arc(x + w / 2, y + h / 2, Math.min(w, h) * 0.15, 0, 6.2832); g.stroke(); }
    else { for (let q = 0; q < 2; q++) { const ux = x + m + 3 + HV(p, 30 + q) * Math.max(1, w - m * 2 - 14), uy = y + m + 3 + HV(p, 40 + q) * Math.max(1, h - m * 2 - 12); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(ux + 1.2, uy + 1.6, 8, 6); g.fillStyle = '#9aa3ac'; g.fillRect(ux, uy, 8, 6); disc(g, ux + 2.4, uy + 3, 1.6, '#4c555e'); disc(g, ux + 5.8, uy + 3, 1.6, '#4c555e'); } }
  } else if (k === 'bank') {
    const col = dim('#b8b09a', 0.5);
    g.fillStyle = shade(col, -0.3); g.fillRect(x, y, w, h); g.fillStyle = col; g.fillRect(x + 1.5, y + 1.5, w - 3, h - 3);
    g.fillStyle = dim('#2f6a4f', 0.45); g.fillRect(x + 4, y + 4, w - 8, h - 12); g.fillStyle = dim('#3f8a66', 0.45); g.fillRect(x + 5.5, y + 5.5, w - 11, h - 15);
    for (let q = x + 3; q < x + w - 3; q += 4.6) { g.fillStyle = dim('#efeadb', 0.4); g.fillRect(q, y + h - 5.5, 2, 5.5); }
    disc(g, x + w / 2, y + (h - 8) / 2 + 2, Math.min(w, h) * 0.17, dim('#e8c15a', 0.4)); disc(g, x + w / 2, y + (h - 8) / 2 + 2, Math.min(w, h) * 0.1, dim('#b8902f', 0.4));
  } else if (k === 'shop' || k === 'restaurant' || k === 'convenience' || k === 'restStop') {
    const col = k === 'convenience' ? dim('#e4e7ea', 0.5) : tint(pal(p, SHOPC));
    flatRoof(g, p, col, p.id * 31 + 7);
    if (k === 'convenience') { g.fillStyle = dim('#2f9a5c', 0.4); g.fillRect(x, y + h - 4, w, 4); g.fillStyle = dim('#f08a2f', 0.4); g.fillRect(x, y + h - 5.4, w, 1.4); }
    else awning(pal(p, AWN));
    if (k === 'restaurant') { disc(g, x + w * 0.3, y + h * 0.3, 2.2, '#aab2b9'); disc(g, x + w * 0.3, y + h * 0.3, 1, '#3a4046'); disc(g, x + w * 0.55, y + h * 0.3, 1.6, '#aab2b9'); }
    if (k === 'restStop') { g.fillStyle = dim('#d9a23a', 0.4); g.fillRect(x + w * 0.3, y - 3, w * 0.4, 3); }
  } else if (k === 'market') {
    // 아케이드 지붕: 둥근 지붕을 색 패널로
    g.fillStyle = shade('#59636f', -0.3); g.fillRect(x, y, w, h);
    for (let q = 0; q * 9 < w; q++) { g.fillStyle = dim(q % 2 ? '#d9dde1' : ['#3f9a8a', '#d8a23a', '#c9584a'][(q >> 1) % 3], 0.45); g.fillRect(x + q * 9, y + 1.5, Math.min(8.2, w - q * 9), h - 3); }
    const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, 'rgba(0,0,0,0.28)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.14)'); gr.addColorStop(1, 'rgba(0,0,0,0.32)');
    g.fillStyle = gr; g.fillRect(x, y, w, h);
  } else if (k === 'mart') {
    const col = dim('#aeb4ba', 0.5);
    g.fillStyle = shade(col, -0.3); g.fillRect(x, y, w, h); g.fillStyle = col; g.fillRect(x + 2, y + 2, w - 4, h - 4);
    g.strokeStyle = 'rgba(0,0,0,0.1)'; g.lineWidth = 0.7; for (let q = x + 10; q < x + w - 4; q += 10) { g.beginPath(); g.moveTo(q, y + 2); g.lineTo(q, y + h - 2); g.stroke(); }
    for (let r = 0; r < 2; r++) for (let q = 0; q < Math.floor((w - 20) / 16); q++) { const ux = x + 10 + q * 16, uy = y + h * (0.28 + r * 0.34); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(ux + 1.2, uy + 1.6, 9, 6); g.fillStyle = '#868e96'; g.fillRect(ux, uy, 9, 6); disc(g, ux + 2.6, uy + 3, 1.7, '#4c555e'); disc(g, ux + 6.4, uy + 3, 1.7, '#4c555e'); }
    g.fillStyle = dim('#d8423a', 0.4); g.fillRect(x, y + h - 5, w, 5); g.fillStyle = dim('#f4d24a', 0.4); g.fillRect(x + w * 0.35, y + h - 5, w * 0.3, 5);
  } else if (k === 'church') {
    hipRoof(g, x, y + h * 0.25, w, h * 0.75, tint('#6a6f78')); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + w / 2 - 3.4, y + 1.5, 9, 9);
    g.fillStyle = dim('#c9ccd1', 0.4); g.fillRect(x + w / 2 - 4.5, y, 9, 9); g.fillStyle = dim('#ffffff', 0.3); g.fillRect(x + w / 2 - 0.6, y + 1.5, 1.2, 6); g.fillRect(x + w / 2 - 2.4, y + 3.3, 4.8, 1.2);
  } else if (k === 'gasStation') {
    rr(g, x - 3, y - 3, w + 6, h + 6, 3, dim('#30363d', 0.2));
    for (let q = 0; q < 3; q++) { g.fillStyle = dim('#c9ccd1', 0.4); g.fillRect(x + w * (0.2 + q * 0.26), y + h * 0.62, 3, 5); }
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 3, y + h * 0.45 + 3, w - 2, h * 0.5); g.fillStyle = dim('#eef1f4', 0.45); g.fillRect(x + 1, y + h * 0.45, w - 2, h * 0.5);
    g.strokeStyle = dim('#d8423a', 0.4); g.lineWidth = 1.6; g.strokeRect(x + 1.8, y + h * 0.45 + 0.8, w - 3.6, h * 0.5 - 1.6);
    flatRoof(g, { x: x + w * 0.2, y, w: w * 0.6, h: h * 0.36 }, dim('#7a8088', 0.5), p.id);
  } else if (k === 'factory') {
    const col = tint(['#6a655c', '#5d6468', '#74614f'][(p.tone * 3) | 0]);
    g.fillStyle = shade(col, -0.3); g.fillRect(x, y, w, h);
    for (let q = 0; q * 8 < w - 1; q++) { const sx = x + q * 8, sw = Math.min(8, x + w - sx); const gr = g.createLinearGradient(sx, 0, sx + 8, 0); gr.addColorStop(0, shade(col, 0.22)); gr.addColorStop(0.7, shade(col, -0.12)); gr.addColorStop(0.72, '#2f4a60'); gr.addColorStop(1, '#27405a'); g.fillStyle = gr; g.fillRect(sx, y + 1.2, sw, h - 2.4); }
    g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = 0.7; g.strokeRect(x, y, w, h);
    for (let q = 0; q < 2; q++) { const cx = x + w * (0.25 + 0.5 * q), cy = y + h * 0.22; oval(g, cx + 6, cy + 8, 3.4, 10, 'rgba(0,0,0,0.3)', -0.6); disc(g, cx, cy, 3.6, dim('#8a6a5e', 0.4)); disc(g, cx, cy, 2, '#2a2420'); }
  } else if (k === 'warehouse' || k === 'logistics') {
    shedRoof(g, p, tint(['#6d6a70', '#59605a', '#5d6468', '#74614f'][(p.tone * 4) | 0]), p.id * 31 + 7);
    for (let q = x + 5; q + 6 < x + w; q += 12) { g.fillStyle = dim('#d9dde1', 0.45); g.fillRect(q, y + h, 6, 2.2); }
  } else if (k === 'hangar') {
    g.fillStyle = shade('#8f98a1', -0.35); g.fillRect(x, y, w, h);
    for (let q = 0; q * 4 < h; q++) { const t = (q * 4) / h, v = Math.sin(t * Math.PI); g.fillStyle = dim(mix('#5d666f', '#c2c9cf', v), 0.45); g.fillRect(x + 1, y + q * 4, w - 2, Math.min(3.4, h - q * 4)); }
    g.fillStyle = dim('#2f3840', 0.3); g.fillRect(x + w * 0.2, y + h - 2.4, w * 0.6, 2.4);
  } else if (k === 'terminal') {
    g.fillStyle = shade('#8fa3b5', -0.4); g.fillRect(x, y, w, h);
    for (let q = 0; q * 7 < w; q++) { g.fillStyle = dim(q % 2 ? '#c8d6e2' : '#9fb6c8', 0.45); g.fillRect(x + q * 7, y + 1.5, Math.min(6.2, w - q * 7), h - 3); }
    const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, 'rgba(0,0,0,0.25)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(0,0,0,0.25)'); g.fillStyle = gr; g.fillRect(x, y, w, h);
    for (let q = 0; q < 3; q++) { g.fillStyle = dim('#d9dde1', 0.4); g.fillRect(x + w * (0.2 + q * 0.3) - 1.5, y + h, 3, 9); }      // 탑승교
  } else if (k === 'tower') {
    g.fillStyle = dim('#9aa3ac', 0.45); g.fillRect(x + w * 0.25, y + h * 0.25, w * 0.5, h * 0.5);
    g.fillStyle = dim('#2f4a60', 0.3); g.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.2832 + 0.39; g.lineTo(x + w / 2 + Math.cos(a) * w * 0.5, y + h / 2 + Math.sin(a) * h * 0.5); } g.closePath(); g.fill();
    disc(g, x + w / 2, y + h / 2, w * 0.3, dim('#dfe5ea', 0.4)); disc(g, x + w / 2, y + h / 2, 1.2, '#d8423a');
  } else if (k === 'chemical') {
    shedRoof(g, p, tint('#687078'), p.id * 31 + 7);
    g.strokeStyle = dim('#c9ccd1', 0.4); g.lineWidth = 1.2; for (let q = 0; q < 3; q++) { g.beginPath(); g.moveTo(x + w, y + h * (0.25 + q * 0.2)); g.lineTo(x + w + 14, y + h * (0.25 + q * 0.2)); g.stroke(); }
    for (let q = 0; q < 2; q++) { const cx = x + w * (0.3 + 0.4 * q), cy = y + h * 0.7; disc(g, cx + 1, cy + 1.4, 3.6, 'rgba(0,0,0,0.3)'); disc(g, cx, cy, 3.4, dim('#d9dde1', 0.4)); disc(g, cx, cy, 1.6, dim('#d8423a', 0.4)); }
  } else if (k === 'storage') {
    rr(g, x, y, w, h, 3, dim('#3d3f3a', 0.25)); g.strokeStyle = dim('#8a8f96', 0.4); g.lineWidth = 1.1; g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    const r = Math.min(w / 4.6, h / 4.6);
    for (let iy = 0; iy < 2; iy++) for (let ix = 0; ix < 2; ix++) tank(g, x + w * (0.28 + ix * 0.44), y + h * (0.28 + iy * 0.44), r * (0.82 + 0.18 * HV(p, ix * 2 + iy)), dim(HV(p, 9 + ix + iy * 2) > 0.4 ? '#d9dde1' : '#c2b48a', 0.45));
  } else if (k === 'utility') {
    g.fillStyle = dim('#d9b23a', 0.4); g.fillRect(x - 1.5, y - 1.5, w + 3, h + 3); g.fillStyle = dim('#2a2d31', 0.2); for (let q = -1.5; q < w + 3; q += 5) g.fillRect(x + q, y - 1.5, 2.5, h + 3);
    g.fillStyle = dim('#8a8f96', 0.45); g.fillRect(x, y, w, h); g.fillStyle = dim('#b4bac0', 0.45); g.fillRect(x + 1.5, y + 1.5, w - 3, h - 3);
    seg(g, x + 4, y + h / 2, x + w - 4, y + h / 2, 1.8, dim('#d8a23a', 0.4)); disc(g, x + w / 2, y + h / 2, 2.2, dim('#d8423a', 0.4));
  } else if (k === 'construction') {
    rr(g, x, y, w, h, 2, dim('#5a4f3c', 0.3)); g.strokeStyle = dim('#3f7fc0', 0.4); g.lineWidth = 1.6; g.setLineDash([7, 2]); g.strokeRect(x + 1, y + 1, w - 2, h - 2); g.setLineDash([]);
    for (let q = 0; q < 12; q++) oval(g, x + 8 + HV(p, q) * (w - 16), y + 8 + HV(p, q + 20) * (h - 16), 5 + HV(p, q + 40) * 8, 3 + HV(p, q + 60) * 5, dim(q % 2 ? '#665a44' : '#4c4233', 0.3), HV(p, q + 80) * 3);
    const bx = x + w * 0.12, by = y + h * 0.16, bw = w * 0.46, bh = h * 0.66;
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(bx + 5, by + 6, bw, bh); g.fillStyle = dim('#7d8288', 0.45); g.fillRect(bx, by, bw, bh);
    g.fillStyle = dim('#4a4f55', 0.3); for (let iy = 0; iy < 4; iy++) for (let ix = 0; ix < 5; ix++) g.fillRect(bx + 2 + ix * ((bw - 4) / 5) + 1, by + 2 + iy * ((bh - 4) / 4) + 1, (bw - 4) / 5 - 2, (bh - 4) / 4 - 2);
    const cx = x + w * 0.72, cy = y + h * 0.4;      // 타워 크레인
    seg(g, cx - w * 0.3 + 4, cy - h * 0.2 + 6, cx + w * 0.1 + 4, cy + h * 0.08 + 6, 1.6, 'rgba(0,0,0,0.3)'); seg(g, cx - w * 0.3, cy - h * 0.2, cx + w * 0.1, cy + h * 0.08, 1.8, dim('#e0b83a', 0.4));
    g.fillStyle = dim('#e0b83a', 0.4); g.fillRect(cx - 2.5, cy - 2.5, 5, 5); g.fillStyle = '#2a2420'; g.fillRect(cx - 1, cy - 1, 2, 2);
    for (let q = 0; q < 3; q++) rr(g, x + w * 0.66 + q * 2, y + h * 0.68 + q * 6.5, 15, 5.4, 0.8, dim(['#b5564a', '#3f69a8', '#5f9a82'][q], 0.4));
  } else if (k === 'greenhouse') {
    g.fillStyle = 'rgba(0,0,0,0.25)'; g.fillRect(x + 1.5, y + 2, w, h); rr(g, x, y, w, h, h / 2.2, dim('#8fa29c', 0.45));
    g.fillStyle = 'rgba(60,90,70,0.3)'; for (let q = x + 4; q < x + w - 2; q += 4.5) g.fillRect(q, y + 0.8, 0.8, h - 1.6);
    g.fillStyle = 'rgba(255,255,255,0.22)'; g.fillRect(x + 3, y + h * 0.28, w - 6, 1);
  } else flatRoof(g, p, tint('#6a6f78'), p.id * 31 + 7);
}
