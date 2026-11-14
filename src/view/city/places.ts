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
  } else if (p.kind === 'pier') {
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + 2, y + 3, w, h);
    g.fillStyle = dim('#7d6a4c', 0.35); g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(0,0,0,0.16)'; for (let q = y + 4; q < y + h; q += 5) g.fillRect(x, q, w, 0.8);
    for (let q = y + 8; q < y + h; q += 22) { disc(g, x + 2, q, 1.6, dim('#3a3f45', 0.3)); disc(g, x + w - 2, q, 1.6, dim('#3a3f45', 0.3)); }
    for (let k = 0; k < 4; k++) { const sd = k % 2 ? 1 : -1, by = y + h * (0.3 + 0.18 * k), bx = sd > 0 ? x + w + 3 : x - 17; rr(g, bx + 1, by + 1.5, 14, 6, 3, 'rgba(0,0,0,0.3)'); rr(g, bx, by, 14, 6, 3, dim(['#e7e2d4', '#3f69a8', '#a33a34', '#e7e2d4'][k], 0.4)); g.fillStyle = dim('#8a9299', 0.4); g.fillRect(bx + 4, by + 1.5, 4, 3); }
  } else if (p.kind === 'containerYard') {
    g.fillStyle = dim('#3f444a', 0.2); g.fillRect(x, y, w, h); g.strokeStyle = dim('#d9b23a', 0.3); g.lineWidth = 0.8; g.strokeRect(x + 2, y + 2, w - 4, h - 4);
    const cols = ['#b5564a', '#3f69a8', '#c9a23a', '#5f9a82', '#8f7cc0', '#d9dde1', '#c9682f'];
    for (let iy = 0; iy < 4; iy++) for (let ix = 0; ix * 15 < w - 22; ix++) { if (HV(p, ix * 9 + iy) < 0.22) continue; const bx = x + 8 + ix * 15, by = y + 8 + iy * 13; g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(bx + 1.5, by + 1.8, 13, 5.5 * (1 + ((HV(p, ix + iy * 7) * 2) | 0) * 0.5)); g.fillStyle = dim(cols[(HV(p, ix * 3 + iy * 11) * cols.length) | 0], 0.4); g.fillRect(bx, by, 13, 5.5); g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(bx, by, 13, 1); }
    for (let k = 0; k < 3; k++) { const cx = x + w * (0.2 + k * 0.3), cy = y + h - 12; g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(cx - 9, cy - 1, 22, 26); g.strokeStyle = dim('#3f7fc0', 0.4); g.lineWidth = 2.2; g.strokeRect(cx - 11, cy - 4, 22, 9); seg(g, cx, cy - 12, cx, cy + 26, 2.6, dim('#e0b83a', 0.4)); g.fillStyle = dim('#2a2d31', 0.2); g.fillRect(cx - 2.5, cy + 12, 5, 4); }
  } else if (p.kind === 'amusement') {
    rr(g, x, y, w, h, 12, dim('#4a4f58', 0.25)); rr(g, x + 4, y + 4, w - 8, h - 8, 10, dim('#565c66', 0.25));
    g.strokeStyle = dim('#b3a07a', 0.35); g.lineWidth = 3; g.beginPath(); g.moveTo(x + w / 2, y + h); g.quadraticCurveTo(x + w * 0.4, y + h * 0.5, x + w * 0.7, y + h * 0.3); g.stroke();
    const fx = x + w * 0.26, fy = y + h * 0.36, fr = h * 0.27;      // 대관람차
    disc(g, fx + 3, fy + 4, fr, 'rgba(0,0,0,0.25)'); g.strokeStyle = dim('#e9e4d8', 0.35); g.lineWidth = 1.6; g.beginPath(); g.arc(fx, fy, fr, 0, 6.2832); g.stroke();
    g.lineWidth = 0.7; for (let k = 0; k < 8; k++) { const a = (k / 8) * 6.2832; g.beginPath(); g.moveTo(fx, fy); g.lineTo(fx + Math.cos(a) * fr, fy + Math.sin(a) * fr); g.stroke(); disc(g, fx + Math.cos(a) * fr, fy + Math.sin(a) * fr, 2.2, dim(['#d8423a', '#f0c84a', '#3f8ad8', '#5ad17a'][k % 4], 0.35)); }
    const mx = x + w * 0.7, my = y + h * 0.66;      // 회전목마
    disc(g, mx + 2, my + 3, 13, 'rgba(0,0,0,0.25)'); for (let k = 0; k < 12; k++) { g.fillStyle = dim(k % 2 ? '#e9e4d8' : '#d8423a', 0.35); g.beginPath(); g.moveTo(mx, my); g.arc(mx, my, 12, (k / 12) * 6.2832, ((k + 1) / 12) * 6.2832); g.closePath(); g.fill(); } disc(g, mx, my, 2.4, dim('#f0c84a', 0.35));
    g.strokeStyle = dim('#3f8ad8', 0.35); g.lineWidth = 2; g.beginPath(); g.moveTo(x + w * 0.5, y + 12); g.bezierCurveTo(x + w * 0.75, y - 4, x + w * 0.98, y + 20, x + w * 0.84, y + 34); g.bezierCurveTo(x + w * 0.7, y + 46, x + w * 0.58, y + 30, x + w * 0.5, y + 12); g.stroke();      // 청룡열차
    for (let k = 0; k < 4; k++) { const tx = x + 16 + k * 22, ty = y + h - 16; g.fillStyle = dim(['#d8a23a', '#3f9a8a', '#c9584a', '#8f5cc0'][k], 0.35); g.beginPath(); g.moveTo(tx, ty - 7); g.lineTo(tx + 7, ty + 5); g.lineTo(tx - 7, ty + 5); g.closePath(); g.fill(); }
  } else if (p.kind === 'campsite') {
    rr(g, x, y, w, h, 16, dim('#2c4d33', 0.3)); rr(g, x + 10, y + 12, w - 20, h - 24, 12, dim('#4a5a3a', 0.3));
    for (let k = 0; k < 9; k++) { const tx = x + 18 + (k % 3) * ((w - 36) / 2) + (HV(p, k) - 0.5) * 10, ty = y + 22 + ((k / 3) | 0) * ((h - 44) / 2) + (HV(p, k + 20) - 0.5) * 8, a = HV(p, k + 40) * 6.28; g.save(); g.translate(tx, ty); g.rotate(a); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(-4.5, -3, 11, 8); g.fillStyle = dim(['#d8642f', '#3f8a5c', '#3f69a8', '#c9a23a', '#8f5cc0'][k % 5], 0.35); g.fillRect(-5.5, -4, 11, 8); g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(-5.5, -0.5, 11, 1); g.restore(); }
    disc(g, x + w / 2, y + h / 2, 2.6, dim('#3a2f26', 0.2)); disc(g, x + w / 2, y + h / 2, 1.4, night ? '#ffb454' : dim('#d8642f', 0.2));
    for (let k = 0; k < 16; k++) { const a = (k / 16) * 6.2832; canopy(g, x + w / 2 + Math.cos(a) * (w / 2 - 6), y + h / 2 + Math.sin(a) * (h / 2 - 6), 4.5 + HV(p, 60 + k) * 3, HV(p, 80 + k), night); }
  } else if (p.kind === 'runway') {
    // 계류장과 유도로, 활주로
    g.fillStyle = dim('#2b3f2e', 0.3); g.fillRect(x - 6, y - 112, w + 12, h + 150);
    g.fillStyle = dim('#3a4046', 0.2); g.fillRect(x + w * 0.1, y - 104, w * 0.8, 96);
    g.strokeStyle = 'rgba(0,0,0,0.18)'; g.lineWidth = 0.6; for (let q = x + w * 0.1; q < x + w * 0.9; q += 12) { g.beginPath(); g.moveTo(q, y - 104); g.lineTo(q, y - 8); g.stroke(); }
    for (const tx of [x + w * 0.16, x + w * 0.84]) { g.fillStyle = dim('#353b41', 0.2); g.fillRect(tx - 6, y - 10, 12, 12); g.strokeStyle = dim('#d9b23a', 0.3); g.lineWidth = 0.8; g.beginPath(); g.moveTo(tx, y - 60); g.lineTo(tx, y + 2); g.stroke(); }
    g.strokeStyle = dim('#d9b23a', 0.3); g.lineWidth = 0.8; g.beginPath(); g.moveTo(x + w * 0.16, y - 30); g.lineTo(x + w * 0.84, y - 30); g.stroke();
    g.fillStyle = dim('#24282d', 0.1); g.fillRect(x, y, w, h);
    g.strokeStyle = 'rgba(235,238,240,0.75)'; g.lineWidth = 0.9; g.strokeRect(x + 2, y + 2, w - 4, h - 4);
    g.setLineDash([14, 10]); g.lineWidth = 1.2; g.beginPath(); g.moveTo(x + 34, y + h / 2); g.lineTo(x + w - 34, y + h / 2); g.stroke(); g.setLineDash([]);
    g.fillStyle = 'rgba(235,238,240,0.8)';
    for (const ex of [x + 8, x + w - 20]) for (let q = 0; q < 6; q++) g.fillRect(ex, y + 5 + q * ((h - 10) / 6), 12, (h - 10) / 6 - 1.4);
    for (const ex of [x + 60, x + w - 74]) { g.fillRect(ex, y + 6, 14, 3); g.fillRect(ex, y + h - 9, 14, 3); }
    for (let k = 0; k < 4; k++) plane(g, x + w * (0.24 + k * 0.13), y - 62 + (k % 2) * 5, -Math.PI / 2, 1.05, dim('#eef1f4', 0.3));
    plane(g, x + w * 0.62, y + h / 2, 0, 1.25, dim('#eef1f4', 0.3));
    for (let q = x + 6; q < x + w - 4; q += 16) { disc(g, q, y - 1.5, 0.8, night ? '#7ad0ff' : '#5a7f95'); disc(g, q, y + h + 1.5, 0.8, night ? '#7ad0ff' : '#5a7f95'); }
  }
}

const HOUSE = ['#8b5644', '#6f4a3c', '#7a6a4f', '#7d4a4a', '#51606e', '#476660', '#5d5f66'];
const SHOPC = ['#6a6f78', '#70757f', '#5a6470', '#6b6f66', '#77706a', '#5f6872'];
const AWN = ['#c9483f', '#3f8a5c', '#3f69a8', '#d9a23a', '#8f5cc0', '#d8642f'];
const pal = (p: Place, a: string[]): string => a[(p.tone * a.length) | 0];

/** 건물의 그림자: 층수가 높을수록 길다. 돌려 놓은 건물도 빛의 방향은 같으므로, 건물과 빛 방향으로 민 건물을 감싸는 볼록 다각형으로 칠한다. */
export function paintShadow(g: G, p: Place): void {
  const d = Math.min(15, 3 + p.floors * 1.25), cx = p.x + p.w / 2, cy = p.y + p.h / 2, r = p.rot ?? 0, c = Math.cos(r), sn = Math.sin(r);
  const pts: number[][] = [];
  for (const [u, v] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { const x = cx + ((u * p.w) / 2) * c - ((v * p.h) / 2) * sn, y = cy + ((u * p.w) / 2) * sn + ((v * p.h) / 2) * c; pts.push([x, y], [x + d, y + d * 1.2]); }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: number[], a: number[], b: number[]): number => (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);
  const lo: number[][] = [], up: number[][] = [];
  for (const q of pts) { while (lo.length >= 2 && cross(lo[lo.length - 2], lo[lo.length - 1], q) <= 0) lo.pop(); lo.push(q); }
  for (let i = pts.length - 1; i >= 0; i--) { const q = pts[i]; while (up.length >= 2 && cross(up[up.length - 2], up[up.length - 1], q) <= 0) up.pop(); up.push(q); }
  const hull = lo.slice(0, -1).concat(up.slice(0, -1));
  g.fillStyle = 'rgba(0,0,0,0.42)'; g.beginPath(); hull.forEach((q, i) => (i ? g.lineTo(q[0], q[1]) : g.moveTo(q[0], q[1]))); g.closePath(); g.fill();
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
  } else if (k === 'cafe') {
    flatRoof(g, p, tint(['#7a6a5a', '#5f6d66', '#8a7460'][(p.tone * 3) | 0]), p.id * 31 + 7); awning(pal(p, AWN));
    for (let q = 0; q < 2; q++) { disc(g, x + w * (0.3 + q * 0.4), y + h + 3.4, 1.7, dim('#e9e4d8', 0.4)); disc(g, x + w * (0.3 + q * 0.4), y + h + 3.4, 0.6, dim('#7a5a3c', 0.4)); }
  } else if (k === 'clinic') {
    flatRoof(g, p, dim('#d9dfe3', 0.5), p.id * 31 + 7); g.fillStyle = dim('#2f9a6a', 0.4); g.fillRect(x + w / 2 - 1.6, y + h / 2 - 5, 3.2, 10); g.fillRect(x + w / 2 - 5, y + h / 2 - 1.6, 10, 3.2);
  } else if (k === 'workshop') {
    shedRoof(g, p, tint(['#6a6d62', '#5c6168', '#76685a'][(p.tone * 3) | 0]), p.id * 31 + 7);
    g.fillStyle = dim('#2a2d31', 0.2); g.fillRect(x + w * 0.3, y + h - 2.6, w * 0.4, 2.6);
    for (let q = 0; q < 3; q++) rr(g, x + 2 + q * 5, y + h + 1.5, 4, 3, 0.6, dim(['#8a5a3a', '#4c555e', '#a8a29a'][q], 0.4));
  } else if (k === 'school') {
    rr(g, x, y, w, h, 4, dim('#3a4a3a', 0.3));
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 6, y + 6, w - 8, h * 0.34); g.fillStyle = dim('#8a6a55', 0.45); g.fillRect(x + 3, y + 3, w - 6, h * 0.34); g.fillStyle = dim('#a5826a', 0.45); g.fillRect(x + 5, y + 5, w - 10, h * 0.34 - 4);
    rr(g, x + 6, y + h * 0.46, w - 12, h * 0.48, h * 0.2, dim('#a86a4a', 0.4)); rr(g, x + 11, y + h * 0.46 + 5, w - 22, h * 0.48 - 10, h * 0.14, dim('#3f7a4a', 0.4));
  } else if (k === 'station') {
    g.fillStyle = dim('#8a8f96', 0.4); g.fillRect(x - 14, y - 9, w + 28, 5); g.fillRect(x - 14, y + h + 4, w + 28, 5);      // 승강장
    g.fillStyle = shade('#6f8296', -0.4); g.fillRect(x, y, w, h);
    for (let q = 0; q * 6 < w; q++) { g.fillStyle = dim(q % 2 ? '#8fa3b5' : '#7b8fa2', 0.45); g.fillRect(x + q * 6, y + 1.5, Math.min(5.3, w - q * 6), h - 3); }
    const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, 'rgba(0,0,0,0.3)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.2)'); gr.addColorStop(1, 'rgba(0,0,0,0.3)'); g.fillStyle = gr; g.fillRect(x, y, w, h);
    g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(x + w / 2 - 9, y + h + 1, 22, 16); g.fillStyle = dim('#c9c2b0', 0.45); g.fillRect(x + w / 2 - 11, y + h - 2, 22, 16); disc(g, x + w / 2, y + h + 6, 4, dim('#f4f1e6', 0.4)); disc(g, x + w / 2, y + h + 6, 0.8, '#22262b');
  } else if (k === 'stadium') {
    oval(g, x + w / 2 + 6, y + h / 2 + 8, w / 2, h / 2, 'rgba(0,0,0,0.35)'); oval(g, x + w / 2, y + h / 2, w / 2, h / 2, dim('#8a9299', 0.45)); oval(g, x + w / 2, y + h / 2, w / 2 - 4, h / 2 - 4, dim('#aab2b9', 0.45));
    g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 0.8; for (let q = 0; q < 28; q++) { const a = (q / 28) * 6.2832; g.beginPath(); g.moveTo(x + w / 2 + Math.cos(a) * (w / 2 - 20), y + h / 2 + Math.sin(a) * (h / 2 - 20)); g.lineTo(x + w / 2 + Math.cos(a) * (w / 2 - 2), y + h / 2 + Math.sin(a) * (h / 2 - 2)); g.stroke(); }
    oval(g, x + w / 2, y + h / 2, w / 2 - 20, h / 2 - 20, dim('#a8553f', 0.4)); oval(g, x + w / 2, y + h / 2, w / 2 - 28, h / 2 - 27, dim('#3f8a4a', 0.4));
    g.strokeStyle = 'rgba(255,255,255,0.5)'; g.lineWidth = 0.7; g.strokeRect(x + w * 0.3, y + h * 0.34, w * 0.4, h * 0.32); g.beginPath(); g.moveTo(x + w / 2, y + h * 0.34); g.lineTo(x + w / 2, y + h * 0.66); g.stroke(); g.beginPath(); g.arc(x + w / 2, y + h / 2, 5, 0, 6.2832); g.stroke();
  } else if (k === 'university') {
    rr(g, x, y, w, h, 8, dim('#2c4d33', 0.3)); rr(g, x + w * 0.3, y + h * 0.32, w * 0.4, h * 0.36, 4, dim('#3d6a3f', 0.35));
    g.strokeStyle = dim('#b3a07a', 0.35); g.lineWidth = 1.6; g.beginPath(); g.moveTo(x + w / 2, y + h); g.lineTo(x + w / 2, y + h * 0.3); g.moveTo(x + w * 0.1, y + h / 2); g.lineTo(x + w * 0.9, y + h / 2); g.stroke();
    const bl = (bx: number, by: number, bw: number, bh: number, col: string): void => { g.fillStyle = 'rgba(0,0,0,0.38)'; g.fillRect(bx + 5, by + 6, bw, bh); flatRoof(g, { x: bx, y: by, w: bw, h: bh }, dim(col, 0.45), p.id + Math.round(bx)); };
    bl(x + w * 0.3, y + 6, w * 0.4, h * 0.2, '#8a5f4c'); bl(x + 6, y + h * 0.26, w * 0.2, h * 0.5, '#7a6a5a'); bl(x + w * 0.74, y + h * 0.26, w * 0.2, h * 0.5, '#86705a'); bl(x + 10, y + h * 0.8, w * 0.3, h * 0.14, '#6d6f76'); bl(x + w * 0.62, y + h * 0.8, w * 0.3, h * 0.14, '#8a5f4c');
    disc(g, x + w / 2 + 1.5, y + 6 + h * 0.1 + 2, 5.5, 'rgba(0,0,0,0.3)'); disc(g, x + w / 2, y + 6 + h * 0.1, 5, dim('#5f8a86', 0.4)); disc(g, x + w / 2, y + 6 + h * 0.1, 2, dim('#e8c15a', 0.4));
    for (let q = 0; q < 10; q++) canopy(g, x + 10 + HV(p, q) * (w - 20), y + h * (0.3 + 0.4 * HV(p, q + 20)), 3.4, HV(p, q + 40), night);
  } else if (k === 'deptStore') {
    const col = dim('#b9ada0', 0.5);
    g.fillStyle = shade(col, -0.3); g.fillRect(x, y, w, h); g.fillStyle = col; g.fillRect(x + 2, y + 2, w - 4, h - 4);
    g.fillStyle = dim('#2f4a60', 0.3); g.beginPath(); g.moveTo(x + w / 2, y + h * 0.18); g.lineTo(x + w * 0.74, y + h / 2); g.lineTo(x + w / 2, y + h * 0.82); g.lineTo(x + w * 0.26, y + h / 2); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(170,215,240,0.4)'; g.lineWidth = 0.7; g.beginPath(); g.moveTo(x + w / 2, y + h * 0.18); g.lineTo(x + w / 2, y + h * 0.82); g.moveTo(x + w * 0.26, y + h / 2); g.lineTo(x + w * 0.74, y + h / 2); g.stroke();
    g.fillStyle = dim('#c9483f', 0.4); g.fillRect(x, y + h - 5, w, 5); g.fillStyle = dim('#f0d27a', 0.4); for (let q = x + 4; q < x + w - 6; q += 9) g.fillRect(q, y + h - 4, 5, 3);
    for (let q = 0; q < 3; q++) { g.fillStyle = '#868e96'; g.fillRect(x + 6 + q * 12, y + 5, 9, 6); disc(g, x + 8.6 + q * 12, y + 8, 1.7, '#4c555e'); disc(g, x + 12.4 + q * 12, y + 8, 1.7, '#4c555e'); }
  } else if (k === 'cathedral') {
    const col = dim('#59626b', 0.5);
    hipRoof(g, x + w * 0.3, y, w * 0.4, h, col); hipRoof(g, x, y + h * 0.26, w, h * 0.26, shade(col, 0.06));
    disc(g, x + w / 2 + 2, y + h * 0.39 + 3, 6.5, 'rgba(0,0,0,0.35)'); disc(g, x + w / 2, y + h * 0.39, 6, dim('#7fa59f', 0.4)); disc(g, x + w / 2, y + h * 0.39, 2.6, dim('#e8c15a', 0.4));
    g.fillStyle = dim('#d9dde1', 0.4); g.fillRect(x + w * 0.3 - 3, y + h - 8, 6, 9); g.fillRect(x + w * 0.7 - 3, y + h - 8, 6, 9);
  } else if (k === 'temple') {
    rr(g, x, y, w, h, 3, dim('#6a5f48', 0.3)); g.strokeStyle = dim('#8a8f96', 0.4); g.lineWidth = 1.6; g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    const hall = (bx: number, by: number, bw: number, bh: number): void => { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(bx + 3, by + 4, bw, bh); hipRoof(g, bx, by, bw, bh, dim('#3f4a55', 0.45)); g.strokeStyle = dim('#c9a13a', 0.35); g.lineWidth = 0.8; g.strokeRect(bx - 0.6, by - 0.6, bw + 1.2, bh + 1.2); };
    hall(x + w * 0.28, y + 6, w * 0.44, h * 0.3); hall(x + 6, y + h * 0.5, w * 0.26, h * 0.36); hall(x + w * 0.68, y + h * 0.5, w * 0.26, h * 0.36);
    disc(g, x + w / 2, y + h * 0.66, 3, dim('#aab2b9', 0.4)); disc(g, x + w / 2, y + h * 0.66, 1.4, dim('#d9dde1', 0.4));
    for (let q = 0; q < 5; q++) canopy(g, x + 6 + q * ((w - 12) / 4), y + h + 5, 4, q / 5, night);
  } else if (k === 'powerPlant') {
    rr(g, x - 4, y - 4, w + 8, h + 8, 3, dim('#33342f', 0.25));
    g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(x + 6, y + 7, w * 0.5, h * 0.5); shedRoof(g, { x, y, w: w * 0.5, h: h * 0.5 }, dim('#687078', 0.45), p.id);
    for (let q = 0; q < 2; q++) { const cx = x + w * (0.66 + q * 0.2), cy = y + h * 0.3, r = h * 0.2; disc(g, cx + 5, cy + 7, r, 'rgba(0,0,0,0.35)'); disc(g, cx, cy, r, dim('#b4bac0', 0.45)); disc(g, cx, cy, r * 0.72, dim('#8a9299', 0.45)); disc(g, cx, cy, r * 0.5, dim('#3a4046', 0.3)); disc(g, cx - r * 0.2, cy - r * 0.3, r * 0.5, 'rgba(235,240,245,0.16)'); }
    for (let q = 0; q < 2; q++) { const cx = x + w * (0.12 + q * 0.16), cy = y + h * 0.72; oval(g, cx + 9, cy + 12, 3, 15, 'rgba(0,0,0,0.3)', -0.6); disc(g, cx, cy, 4.4, dim('#c9c2b0', 0.4)); disc(g, cx, cy, 2.6, '#2a2420'); g.fillStyle = dim('#c9483f', 0.4); g.beginPath(); g.arc(cx, cy, 4.4, 0, 6.2832); g.arc(cx, cy, 3.6, 0, 6.2832, true); g.fill(); }
    oval(g, x + w * 0.62, y + h * 0.78, w * 0.2, h * 0.13, dim('#22231f', 0.1)); oval(g, x + w * 0.8, y + h * 0.82, w * 0.12, h * 0.1, dim('#22231f', 0.1));
  } else if (k === 'broadcast') {
    flatRoof(g, p, dim('#5a6b7c', 0.5), p.id * 31 + 7);
    const cx = x + w * 0.72, cy = y + h * 0.32; g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1.4; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + 26, cy + 32); g.stroke();
    g.strokeStyle = dim('#d8423a', 0.35); g.lineWidth = 1; for (const a of [0.4, 2.5, 4.6]) { g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * 15, cy + Math.sin(a) * 15); g.stroke(); }
    disc(g, cx, cy, 4.4, dim('#e9e4d8', 0.4)); disc(g, cx, cy, 2.6, dim('#d8423a', 0.4)); disc(g, cx, cy, 1, night ? '#ff5d5d' : '#7a2420');
    disc(g, x + w * 0.26, y + h * 0.6, 6, dim('#d9dde1', 0.4)); disc(g, x + w * 0.26, y + h * 0.6, 4.4, dim('#aab2b9', 0.4));
  } else if (k === 'prison') {
    g.fillStyle = dim('#55594f', 0.3); g.fillRect(x, y, w, h); g.strokeStyle = dim('#9aa3ac', 0.4); g.lineWidth = 3; g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1; g.strokeRect(x + 4, y + 4, w - 8, h - 8);
    for (const [u, v] of [[0, 0], [1, 0], [1, 1], [0, 1]]) { g.fillStyle = dim('#7d8288', 0.4); g.fillRect(x + u * (w - 9), y + v * (h - 9), 9, 9); disc(g, x + u * (w - 9) + 4.5, y + v * (h - 9) + 4.5, 2, dim('#d9dde1', 0.4)); }
    for (let q = 0; q < 3; q++) { g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 18 + 4, y + 16 + q * (h - 30) / 3 + 5, w * 0.5, (h - 30) / 3 - 8); flatRoof(g, { x: x + 18, y: y + 16 + (q * (h - 30)) / 3, w: w * 0.5, h: (h - 30) / 3 - 8 }, dim('#8a8578', 0.45), p.id + q); }
    rr(g, x + w * 0.68, y + h * 0.28, w * 0.22, h * 0.44, 3, dim('#6a6448', 0.3)); g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = 0.6; g.strokeRect(x + w * 0.7, y + h * 0.32, w * 0.18, h * 0.36);
  } else if (k === 'museum' || k === 'library') {
    const col = dim(k === 'museum' ? '#c2b8a2' : '#9aa69c', 0.5);
    g.fillStyle = shade(col, -0.3); g.fillRect(x, y, w, h); g.fillStyle = col; g.fillRect(x + 2, y + 2, w - 4, h - 4);
    if (k === 'museum') { disc(g, x + w / 2 + 2, y + h * 0.42 + 3, Math.min(w, h) * 0.26, 'rgba(0,0,0,0.3)'); disc(g, x + w / 2, y + h * 0.42, Math.min(w, h) * 0.25, dim('#5f8a86', 0.45)); disc(g, x + w / 2 - 2, y + h * 0.42 - 2, Math.min(w, h) * 0.13, dim('#8fb8b0', 0.45)); for (let q = x + 5; q < x + w - 5; q += 5) { g.fillStyle = dim('#efeadb', 0.4); g.fillRect(q, y + h - 5, 2.2, 5); } }
    else { g.fillStyle = dim('#2f4a60', 0.3); for (let iy = 0; iy < 2; iy++) for (let ix = 0; ix < 4; ix++) g.fillRect(x + 6 + ix * ((w - 12) / 4), y + 6 + iy * ((h - 12) / 2), (w - 12) / 4 - 3, (h - 12) / 2 - 3); }
  } else if (k === 'busTerminal' || k === 'ferry' || k === 'fishMarket') {
    const a = k === 'busTerminal' ? ['#8a9aa8', '#75869a'] : k === 'ferry' ? ['#e4e9ee', '#4a8fd0'] : ['#dfe6ea', '#3f7fa8'];
    g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(x, y, w, h);
    for (let q = 0; q * 8 < w; q++) { g.fillStyle = dim(a[q % 2], 0.45); g.fillRect(x + q * 8, y + 1.5, Math.min(7.2, w - q * 8), h - 3); }
    const gr = g.createLinearGradient(x, y, x, y + h); gr.addColorStop(0, 'rgba(0,0,0,0.28)'); gr.addColorStop(0.45, 'rgba(255,255,255,0.14)'); gr.addColorStop(1, 'rgba(0,0,0,0.3)'); g.fillStyle = gr; g.fillRect(x, y, w, h);
    if (k === 'busTerminal') for (let q = 0; q < 5; q++) { g.save(); g.translate(x + 12 + q * ((w - 24) / 4), y + h + 9); g.rotate(1.1); rr(g, -8, -3, 16, 6, 1.4, dim(['#3f8a5c', '#3f69a8', '#c9a23a', '#b5564a', '#e7e2d4'][q], 0.4)); g.fillStyle = '#17232e'; g.fillRect(-7, -2.2, 14, 1.2); g.restore(); }
    if (k === 'fishMarket') for (let q = x + 4; q < x + w - 6; q += 11) rr(g, q, y + h + 1.5, 7, 4, 0.8, dim(['#4a8fd0', '#e7e2d4', '#d8642f'][((q - x) / 11 | 0) % 3], 0.4));
  } else if (k === 'lighthouse') {
    oval(g, x + w / 2, y + h / 2 + 2, w * 0.95, h * 0.8, dim('#6f6a5c', 0.35), 0.4); oval(g, x + w / 2 + 6, y + h / 2 + 9, 6, 18, 'rgba(0,0,0,0.3)', -0.6);
    disc(g, x + w / 2, y + h / 2, w * 0.36, dim('#eef1f4', 0.35)); g.fillStyle = dim('#d8423a', 0.35); g.beginPath(); g.arc(x + w / 2, y + h / 2, w * 0.36, 0, 6.2832); g.arc(x + w / 2, y + h / 2, w * 0.25, 0, 6.2832, true); g.fill();
    disc(g, x + w / 2, y + h / 2, w * 0.14, night ? '#fff4c8' : dim('#f0d27a', 0.2));
  } else if (k === 'dam') {
    g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x + 2, y + 4, w, h); g.fillStyle = dim('#9aa0a6', 0.4); g.fillRect(x, y, w, h); g.fillStyle = dim('#c2c7cc', 0.4); g.fillRect(x, y, w, 4);
    g.fillStyle = 'rgba(0,0,0,0.14)'; for (let q = x + 8; q < x + w; q += 10) g.fillRect(q, y + 4, 1, h - 4);
    g.fillStyle = 'rgba(210,240,250,0.6)'; g.fillRect(x + w * 0.42, y + h, w * 0.16, 10); g.fillStyle = 'rgba(210,240,250,0.3)'; g.fillRect(x + w * 0.38, y + h + 10, w * 0.24, 8);
  } else if (k === 'lookout') {
    g.fillStyle = dim('#8a7a5c', 0.35); g.beginPath(); for (let i = 0; i < 8; i++) { const a = (i / 8) * 6.2832 + 0.39; g.lineTo(x + w / 2 + Math.cos(a) * w * 0.5, y + h / 2 + Math.sin(a) * h * 0.5); } g.closePath(); g.fill();
    hipRoof(g, x + w * 0.25, y + h * 0.25, w * 0.5, h * 0.5, dim('#7a4a3c', 0.45)); g.strokeStyle = dim('#c9ccd1', 0.35); g.lineWidth = 0.8; g.beginPath(); g.moveTo(x + w / 2, y + h / 2); g.lineTo(x + w / 2 + 150, y + h / 2 + 190); g.stroke();
  } else if (k === 'substation') {
    rr(g, x, y, w, h, 2, dim('#4a4c46', 0.25)); g.strokeStyle = dim('#d9b23a', 0.35); g.lineWidth = 1; g.setLineDash([4, 3]); g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3); g.setLineDash([]);
    for (let iy = 0; iy < 2; iy++) for (let ix = 0; ix < 3; ix++) { const bx = x + 9 + ix * ((w - 18) / 3), by = y + 8 + iy * ((h - 16) / 2); g.fillStyle = 'rgba(0,0,0,0.3)'; g.fillRect(bx + 1.5, by + 2, 11, 9); g.fillStyle = dim('#8f98a1', 0.4); g.fillRect(bx, by, 11, 9); disc(g, bx + 3, by + 3, 1.3, dim('#d9dde1', 0.4)); disc(g, bx + 8, by + 3, 1.3, dim('#d9dde1', 0.4)); }
    g.strokeStyle = dim('#c9ccd1', 0.3); g.lineWidth = 0.6; for (let q = 0; q < 3; q++) { g.beginPath(); g.moveTo(x + 6, y + h * (0.3 + q * 0.2)); g.lineTo(x + w - 6, y + h * (0.3 + q * 0.2)); g.stroke(); }
  } else flatRoof(g, p, tint('#6a6f78'), p.id * 31 + 7);
}
