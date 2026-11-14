// 도시 지도의 고정된 부분: 땅과 바다, 산, 강, 철길, 도로와 다리, 골목, 건물과 터, 주요 시설.
// 한 번만 그려 두고 매 프레임 크기를 바꿔 붙인다. 밤에는 가로등과 창 불빛을 함께 그려 둔다.

import { coastY, districtAt, mountainAt, riverDist, roadHalf } from '../../sim/city';
import type { Sim } from '../../sim/engine';
import type { Facility, Place, RoadEdge } from '../../sim/types';
import { disc, hash2, oval, rr, seg, shade } from '../scene/common';
import type { G } from '../scene/common';
import { canopy, paintOpen, paintRoof, paintShadow } from './places';

/** 정적 층의 해상도 배율 (월드 좌표 1 = 화소 K) */
export const CITY_K = 1.35;

export interface FacilityLot { x: number; y: number; w: number; h: number }
/** 시설이 차지하는 부지 (이 안의 일반 건물은 그리지 않는다) */
export function facilityLot(f: Facility): FacilityLot { return { x: f.x - 18, y: f.y - 52, w: 78, h: 62 }; }

function drawFacility(g: G, f: Facility, night: boolean): void {
  const L = facilityLot(f), x = L.x, y = L.y, w = L.w, h = L.h;
  const dim = (c: string): string => (night ? shade(c, -0.42) : c);
  rr(g, x, y, w, h, 4, dim('#3a424b'));
  g.strokeStyle = 'rgba(255,255,255,0.08)'; g.lineWidth = 0.8; g.strokeRect(x + 1.5, y + 1.5, w - 3, h - 3);
  const shadow = (bx: number, by: number, bw: number, bh: number, d = 5): void => { g.fillStyle = 'rgba(0,0,0,0.4)'; g.fillRect(bx + d, by + d * 1.2, bw, bh); };
  if (f.name.includes('항공')) {
    // 소방항공대: 격납고와 헬기 착륙장
    shadow(x + 6, y + 6, 34, 30); g.fillStyle = dim('#8f98a1'); g.fillRect(x + 6, y + 6, 34, 30); for (let k = 0; k * 4 < 30; k++) { g.fillStyle = 'rgba(0,0,0,0.12)'; if (k % 2) g.fillRect(x + 6, y + 6 + k * 4, 34, 4); }
    g.fillStyle = dim('#c0392b'); g.fillRect(x + 6, y + 34, 34, 3);
    disc(g, x + 56, y + 32, 17, dim('#4a525b')); g.strokeStyle = dim('#e8c15a'); g.lineWidth = 1.4; g.beginPath(); g.arc(x + 56, y + 32, 13.5, 0, 6.2832); g.stroke();
    g.fillStyle = dim('#f4f7f9'); g.fillRect(x + 51, y + 26, 2, 12); g.fillRect(x + 59, y + 26, 2, 12); g.fillRect(x + 51, y + 31, 10, 2);
    g.fillStyle = dim('#59636e'); g.fillRect(x + 6, y + 44, 30, 12);
  } else if (f.name.includes('해양')) {
    // 해양구조대: 정고와 경사로
    shadow(x + 6, y + 6, w - 12, 26); g.fillStyle = dim('#e0712a'); g.fillRect(x + 6, y + 6, w - 12, 26); g.fillStyle = dim('#f1ede2'); g.fillRect(x + 8, y + 8, w - 16, 10);
    g.fillStyle = 'rgba(255,255,255,0.12)'; g.fillRect(x + 8, y + 8, w - 16, 1.4);
    for (let k = 0; k < 2; k++) { g.fillStyle = dim('#3a4650'); g.fillRect(x + 12 + k * 28, y + 26, 22, 6); }
    g.fillStyle = dim('#8a9299'); g.beginPath(); g.moveTo(x + 14, y + 34); g.lineTo(x + w - 14, y + 34); g.lineTo(x + w - 22, y + h); g.lineTo(x + 22, y + h); g.closePath(); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.2)'; g.lineWidth = 0.7; for (let k = 0; k < 4; k++) { g.beginPath(); g.moveTo(x + 18, y + 38 + k * 5); g.lineTo(x + w - 18, y + 38 + k * 5); g.stroke(); }
  } else if (f.kind === 'fireStation') {
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

/** 돌려 놓은 건물을 제자리 좌표로 그린다 */
function local(g: G, q: Place, draw: (p: Place) => void): void {
  g.save(); g.translate(q.x + q.w / 2, q.y + q.h / 2); if (q.rot) g.rotate(q.rot);
  draw({ ...q, x: -q.w / 2, y: -q.h / 2 });
  g.restore();
}

export function buildCityStatic(sim: Sim): { c: HTMLCanvasElement; lamps: CityLamp[] } {
  const city = sim.city, night = sim.weather === 'night', K = CITY_K, W = city.w, H = city.h;
  const c = document.createElement('canvas'); c.width = Math.round(W * K); c.height = Math.round(H * K);
  const g = c.getContext('2d')!;
  g.scale(K, K);
  const dim = (col: string, k = 0.45): string => (night ? shade(col, -k) : col);
  const nodeOf = (e: RoadEdge) => [city.nodes[e.a], city.nodes[e.b]];
  const coast = city.coast ?? [], RV = city.river.pts, rail = city.rail ?? [];

  // 1) 땅: 들판과 논밭
  g.fillStyle = dim('#1c2b21', 0.28); g.fillRect(0, 0, W, H);
  const fieldCols = ['#24402a', '#2f4a2c', '#3a4a2a', '#45482a', '#2a3a26', '#324a36', '#4a4530'];
  for (let k = 0; k < 330; k++) {
    const fx = hash2(k, 11) * W, fy = hash2(k, 12) * H, fw = 60 + hash2(k, 13) * 120, fh = 44 + hash2(k, 14) * 96;
    const D = districtAt(fx, fy);
    if (mountainAt(fx, fy) > 0.08 || fy > coastY(fx) - 40 || (D && D.density > 0.6 && Math.hypot(fx - D.x, fy - D.y) < D.r * 0.85)) continue;
    g.save(); g.translate(fx, fy); g.rotate((hash2(k, 15) - 0.5) * 0.9);
    g.fillStyle = dim(fieldCols[(hash2(k, 16) * fieldCols.length) | 0], 0.4); g.fillRect(-fw / 2, -fh / 2, fw, fh);
    g.strokeStyle = 'rgba(0,0,0,0.16)'; g.lineWidth = 1.3;
    if (hash2(k, 17) > 0.5) for (let q = -fh / 2 + 3; q < fh / 2; q += 6) { g.beginPath(); g.moveTo(-fw / 2, q); g.lineTo(fw / 2, q); g.stroke(); }
    else for (let q = -fw / 2 + 3; q < fw / 2; q += 6) { g.beginPath(); g.moveTo(q, -fh / 2); g.lineTo(q, fh / 2); g.stroke(); }
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1; g.strokeRect(-fw / 2, -fh / 2, fw, fh);
    g.restore();
  }
  // 2) 시가지의 땅: 길을 따라 동네마다 다른 바닥색이 번진다
  const GROUND = { commercial: '#272e37', residential: '#23332b', industrial: '#2c2a26', outskirts: '#1f2f24' };
  g.lineCap = 'round'; g.lineJoin = 'round';
  for (const pass of [0, 1]) for (const e of city.edges) {
    if (e.cls === 'highway') continue;
    const [A, B] = nodeOf(e), D = districtAt((A.x + B.x) / 2, (A.y + B.y) / 2);
    if (!D || D.density < 0.55) continue;
    g.strokeStyle = pass ? dim(GROUND[D.district], 0.25) : 'rgba(0,0,0,0.16)'; g.lineWidth = pass ? 150 : 162;
    g.beginPath(); g.moveTo(A.x, A.y); g.lineTo(B.x, B.y); g.stroke();
  }
  // 3) 산: 짙은 숲과 등고선, 빽빽한 나무
  for (const m of city.mountains ?? []) {
    g.save(); g.translate(m.x, m.y); g.scale(1, m.ry / m.rx);
    const gr = g.createRadialGradient(-m.rx * 0.12, -m.rx * 0.12, m.rx * 0.08, 0, 0, m.rx);
    gr.addColorStop(0, dim('#2f5a3a', 0.3)); gr.addColorStop(0.55, dim('#1b3a25', 0.3)); gr.addColorStop(0.88, 'rgba(20,44,28,0.9)'); gr.addColorStop(1, 'rgba(20,44,28,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(0, 0, m.rx, 0, 6.2832); g.fill();
    g.strokeStyle = 'rgba(150,190,150,0.07)'; g.lineWidth = 1.6;
    for (let q = 0.28; q < 0.9; q += 0.17) { g.beginPath(); g.ellipse(-m.rx * 0.1 * (1 - q), -m.rx * 0.1 * (1 - q), m.rx * q, m.rx * q * (0.86 + 0.1 * hash2(m.x, q * 100)), hash2(m.y, q * 100), 0, 6.2832); g.stroke(); }
    g.restore();
  }
  const treeAt = (x: number, y: number): boolean => y < coastY(x) - 12 && riverDist(x, y) > 10;
  for (let k = 0; k < 9000; k++) {
    const x = hash2(k, 31) * W, y = hash2(k, 32) * H, m = mountainAt(x, y);
    if (m < 0.02 || hash2(k, 35) > 0.3 + m * 2.2 || !treeAt(x, y)) continue;
    canopy(g, x, y, 5 + 7 * hash2(k, 33), hash2(k, 34), night);
  }
  // 4) 바다: 모래톱 → 얕은 물 → 깊은 물, 파도 선
  {
    const sea = new Path2D(); coast.forEach(([x, y], i) => (i ? sea.lineTo(x, y) : sea.moveTo(x, y))); sea.lineTo(W + 60, H + 60); sea.lineTo(-60, H + 60); sea.closePath();
    const shore = new Path2D(); coast.forEach(([x, y], i) => (i ? shore.lineTo(x, y) : shore.moveTo(x, y)));
    g.strokeStyle = dim('#8f8566', 0.35); g.lineWidth = 16; g.stroke(shore);                      // 물가의 자갈
    for (const q of city.places) if (q.kind === 'beach') {                                          // 해수욕장의 모래
      g.strokeStyle = dim('#cdb98a', 0.35); g.lineWidth = 62; g.beginPath();
      for (let x = q.x; x <= q.x + q.w; x += 20) { const y = coastY(x); if (x === q.x) g.moveTo(x, y); else g.lineTo(x, y); }
      g.stroke();
    }
    const gr = g.createLinearGradient(0, 1850, 0, H); gr.addColorStop(0, dim('#1e5a78', 0.35)); gr.addColorStop(1, dim('#123a55', 0.35));
    g.fillStyle = gr; g.fill(sea);
    g.save(); g.clip(sea);
    g.strokeStyle = 'rgba(70,160,185,0.3)'; g.lineWidth = 64; g.stroke(shore);
    g.strokeStyle = 'rgba(120,200,215,0.3)'; g.lineWidth = 24; g.stroke(shore);
    g.strokeStyle = 'rgba(235,245,248,0.5)'; g.lineWidth = 2.2; g.setLineDash([14, 9]); g.stroke(shore); g.setLineDash([]);
    g.strokeStyle = 'rgba(190,225,240,0.13)'; g.lineWidth = 1;
    for (let k = 0; k < 420; k++) { const x = hash2(k, 81) * W, y = coastY(x) + 30 + hash2(k, 82) * (H - coastY(x) - 30); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 6, y - 2.4, x + 13, y); g.stroke(); }
    g.restore();
    for (const q of city.places) if (q.kind === 'beach') for (let k = 0; k < 70; k++) {
      const x = q.x + 12 + hash2(k, 95) * (q.w - 24), y = coastY(x) - 6 - hash2(k, 96) * 20;
      if (hash2(k, 97) < 0.6) { disc(g, x + 1, y + 1.4, 3, 'rgba(0,0,0,0.25)'); disc(g, x, y, 2.9, dim(['#d8423a', '#f0c84a', '#3f8ad8', '#e9e4d8', '#5ad17a'][k % 5], 0.35)); disc(g, x, y, 0.7, '#e9e4d8'); }
      else rr(g, x, y, 4.4, 2.2, 0.5, dim(['#e06a8a', '#4aa3c9', '#f0c84a'][k % 3], 0.35));
    }
    // 작은 섬과 배
    oval(g, 610, 2118, 46, 26, dim('#8f8566', 0.35), 0.2); oval(g, 610, 2116, 38, 20, dim('#24452c', 0.3), 0.2);
    for (let k = 0; k < 9; k++) canopy(g, 588 + hash2(k, 91) * 44, 2106 + hash2(k, 92) * 18, 5 + hash2(k, 93) * 3, hash2(k, 94), night);
    const ship = (x: number, y: number, len: number, a: number, col: string): void => {
      g.save(); g.translate(x, y); g.rotate(a);
      g.fillStyle = 'rgba(235,245,248,0.22)'; g.beginPath(); g.moveTo(-len * 0.5, 0); g.lineTo(-len * 1.3, -len * 0.16); g.lineTo(-len * 1.3, len * 0.16); g.closePath(); g.fill();
      g.fillStyle = dim(col, 0.4); g.beginPath(); g.moveTo(len / 2, 0); g.lineTo(len * 0.28, -len * 0.13); g.lineTo(-len / 2, -len * 0.12); g.lineTo(-len / 2, len * 0.12); g.lineTo(len * 0.28, len * 0.13); g.closePath(); g.fill();
      g.fillStyle = dim('#e8ecef', 0.4); g.fillRect(-len * 0.34, -len * 0.07, len * 0.22, len * 0.14);
      if (len > 40) for (let q = 0; q < 4; q++) { g.fillStyle = dim(['#b5564a', '#3f69a8', '#c9a23a', '#5f9a82'][q], 0.4); g.fillRect(-len * 0.08 + q * len * 0.09, -len * 0.085, len * 0.075, len * 0.17); }
      g.restore();
    };
    ship(2260, 2075, 84, -0.12, '#3a4650'); ship(1560, 2090, 36, 0.3, '#e7e2d4'); ship(1990, 2105, 30, -0.5, '#a33a34'); ship(1120, 2120, 22, 0.9, '#e7e2d4'); ship(2800, 2110, 60, 0.15, '#2f4a60'); ship(330, 2060, 18, -0.3, '#e7e2d4');
    g.strokeStyle = dim('#6f757c', 0.35); g.lineWidth = 6; g.beginPath(); g.moveTo(2560, 1960); g.lineTo(2620, 2040); g.lineTo(2500, 2075); g.stroke();      // 방파제
  }
  // 5) 호수와 강
  for (const q of city.places) if (q.kind === 'reservoir') paintOpen(g, q, dim, night);
  const river = (w: (v: number) => number, col: string): void => { g.strokeStyle = col; for (let i = 0; i < RV.length - 1; i++) { g.lineWidth = w((RV[i][2] + RV[i + 1][2]) / 2); g.beginPath(); g.moveTo(RV[i][0], RV[i][1]); g.lineTo(RV[i + 1][0], RV[i + 1][1]); g.stroke(); } };
  river((v) => v + 34, dim('#2c4d35', 0.3)); river((v) => v + 7, dim('#6a6448', 0.35)); river((v) => v, dim('#1f5874', 0.35)); river((v) => v * 0.62, dim('#2a6f8f', 0.35));
  g.strokeStyle = 'rgba(160,215,236,0.24)'; g.lineWidth = 0.8;
  for (let k = 0; k < 260; k++) { const i = (hash2(k, 71) * (RV.length - 1)) | 0, t = hash2(k, 72), A = RV[i], B = RV[i + 1], x = A[0] + (B[0] - A[0]) * t + (hash2(k, 73) - 0.5) * A[2] * 0.6, y = A[1] + (B[1] - A[1]) * t; g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + 1.5, y + 4, x, y + 8); g.stroke(); }
  for (let k = 0; k < 330; k++) {      // 둔치의 나무
    const i = (hash2(k, 74) * (RV.length - 2)) | 0, t = hash2(k, 75), A = RV[i], B = RV[i + 1], side = hash2(k, 76) > 0.5 ? 1 : -1, len = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const x = A[0] + (B[0] - A[0]) * t + (-(B[1] - A[1]) / len) * side * (A[2] / 2 + 12 + hash2(k, 77) * 5), y = A[1] + (B[1] - A[1]) * t + ((B[0] - A[0]) / len) * side * (A[2] / 2 + 12);
    if (y < coastY(x) - 10) canopy(g, x, y, 3.4 + hash2(k, 78) * 1.8, hash2(k, 79), night);
  }
  g.lineCap = 'butt';
  // 6) 터: 공원, 놀이공원, 캠핑장, 부두, 활주로, 주차장
  const mtn = new Set((city.mountains ?? []).map((m) => m.name));
  const opens = city.places.filter((q) => q.open && q.kind !== 'reservoir' && !mtn.has(q.name)).sort((a, b) => b.w * b.h - a.w * a.h);
  for (const q of opens) local(g, q, (p) => paintOpen(g, p, dim, night));
  // 7) 철길
  if (rail.length) {
    const rp = new Path2D(); rail.forEach(([x, y], i) => (i ? rp.lineTo(x, y) : rp.moveTo(x, y)));
    g.lineJoin = 'round';
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 12; g.stroke(rp);
    g.strokeStyle = dim('#4d4a43', 0.25); g.lineWidth = 10; g.stroke(rp);
    g.strokeStyle = dim('#2b2823', 0.1); g.lineWidth = 7; g.setLineDash([1.6, 3.6]); g.stroke(rp); g.setLineDash([]);
    g.strokeStyle = dim('#aeb4ba', 0.35); g.lineWidth = 0.9;
    for (const off of [-2, 2]) { g.beginPath(); rail.forEach(([x, y], i) => { const A = rail[Math.max(0, i - 1)], B = rail[Math.min(rail.length - 1, i + 1)], l = Math.hypot(B[0] - A[0], B[1] - A[1]); const px = x - ((B[1] - A[1]) / l) * off, py = y + ((B[0] - A[0]) / l) * off; if (i) g.lineTo(px, py); else g.moveTo(px, py); }); g.stroke(); }
  }
  // 8) 골목
  for (const a of city.alleys) { seg(g, a.x0, a.y0, a.x1, a.y1, 8.6, 'rgba(0,0,0,0.3)'); seg(g, a.x0, a.y0, a.x1, a.y1, 7, dim('#343b43', 0.15)); }

  // 9) 도로: 그림자 → 보도 → 차도, 큰길일수록 위에
  g.lineCap = 'round'; g.lineJoin = 'round';
  const line = (test: (e: RoadEdge) => boolean): Path2D => { const p = new Path2D(); for (const e of city.edges) { if (!test(e)) continue; const [A, B] = nodeOf(e); p.moveTo(A.x, A.y); p.lineTo(B.x, B.y); } return p; };
  const paths = { local: line((e) => e.cls === 'local'), street: line((e) => e.cls === 'street'), arterial: line((e) => e.cls === 'arterial'), highway: line((e) => e.cls === 'highway') };
  const widths: Record<string, number[]> = { local: [15, 13, 9.5], street: [20, 17.5, 12.5], arterial: [27, 24.5, 19], highway: [32, 29, 24] };
  for (const k of ['local', 'street', 'arterial', 'highway'] as const) { g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = widths[k][0]; g.stroke(paths[k]); }
  for (const k of ['local', 'street', 'arterial', 'highway'] as const) { g.strokeStyle = k === 'highway' ? dim('#5a5f55', 0.28) : dim('#4a545e', 0.28); g.lineWidth = widths[k][1]; g.stroke(paths[k]); }
  for (const k of ['local', 'street', 'arterial', 'highway'] as const) { g.strokeStyle = k === 'highway' ? dim('#30353c', 0.12) : dim(k === 'arterial' ? '#2c333b' : '#2a3038', 0.12); g.lineWidth = widths[k][2]; g.stroke(paths[k]); }
  g.lineCap = 'butt';
  // 로터리
  for (const n of city.nodes) if (n.key === 'C0') { disc(g, n.x, n.y, 34, dim('#4a545e', 0.28)); disc(g, n.x, n.y, 30, dim('#2c333b', 0.12)); disc(g, n.x, n.y, 15, dim('#4a545e', 0.28)); disc(g, n.x, n.y, 13, dim('#35603a', 0.35)); disc(g, n.x, n.y, 5, dim('#3f7a9a', 0.4)); disc(g, n.x, n.y, 2, dim('#b9e0ee', 0.4)); for (let k = 0; k < 6; k++) canopy(g, n.x + Math.cos(k * 1.047) * 9.5, n.y + Math.sin(k * 1.047) * 9.5, 2.6, k / 6, night); }
  // 차선과 횡단보도
  for (const e of city.edges) {
    const [A, B] = nodeOf(e), len = e.len, dx = (B.x - A.x) / len, dy = (B.y - A.y) / len, nx = -dy, ny = dx;
    const ia = city.nodes[e.a].edges.length >= 3, ib = city.nodes[e.b].edges.length >= 3;
    const s0 = ia ? roadHalf(e) + 7 : 0, s1 = len - (ib ? roadHalf(e) + 7 : 0);
    if (s1 <= s0) continue;
    const sub = (off: number, col: string, w: number, dash?: number[]): void => {
      g.strokeStyle = col; g.lineWidth = w; g.setLineDash(dash ?? []);
      g.beginPath(); g.moveTo(A.x + dx * s0 + nx * off, A.y + dy * s0 + ny * off); g.lineTo(A.x + dx * s1 + nx * off, A.y + dy * s1 + ny * off); g.stroke();
    };
    if (e.cls === 'highway') { sub(0, dim('#8a9299', 0.3), 2); sub(-6.2, 'rgba(235,238,240,0.5)', 0.6, [6, 7]); sub(6.2, 'rgba(235,238,240,0.5)', 0.6, [6, 7]); sub(-11.4, 'rgba(235,238,240,0.6)', 0.6); sub(11.4, 'rgba(235,238,240,0.6)', 0.6); }
    else if (e.cls === 'arterial') { sub(-0.9, dim('#c9a13a', 0.3), 0.7); sub(0.9, dim('#c9a13a', 0.3), 0.7); sub(-5, 'rgba(235,238,240,0.5)', 0.6, [5, 6]); sub(5, 'rgba(235,238,240,0.5)', 0.6, [5, 6]); }
    else if (e.cls === 'street') sub(0, 'rgba(235,238,240,0.42)', 0.6, [4.5, 5.5]);
    g.setLineDash([]);
    if (e.cls === 'highway' || e.cls === 'local') continue;
    const half = e.cls === 'arterial' ? 8.2 : 5.2;
    for (const [on, px, py, sx, sy] of [[ia, A.x + dx * (s0 - 4.5), A.y + dy * (s0 - 4.5), dx, dy], [ib, B.x - dx * (len - s1 - 4.5), B.y - dy * (len - s1 - 4.5), -dx, -dy]] as [boolean, number, number, number, number][]) {
      if (!on) continue;
      g.fillStyle = 'rgba(235,238,240,0.6)';
      for (let q = -half + 0.9; q < half; q += 2.4) {
        const cx = px + nx * q, cy = py + ny * q;
        g.beginPath(); g.moveTo(cx - sx * 2.4 - nx * 0.6, cy - sy * 2.4 - ny * 0.6); g.lineTo(cx + sx * 2.4 - nx * 0.6, cy + sy * 2.4 - ny * 0.6); g.lineTo(cx + sx * 2.4 + nx * 0.6, cy + sy * 2.4 + ny * 0.6); g.lineTo(cx - sx * 2.4 + nx * 0.6, cy - sy * 2.4 + ny * 0.6); g.closePath(); g.fill();
      }
    }
  }
  // 다리: 강을 건너는 도로와 철길에 난간
  const railing = (ax: number, ay: number, bx: number, by: number, half: number): void => {
    const len = Math.hypot(bx - ax, by - ay), dx = (bx - ax) / len, dy = (by - ay) / len;
    let t0 = -1, t1 = -1;
    for (let s = 0; s <= len; s += 3) { if (riverDist(ax + dx * s, ay + dy * s) < 6) { if (t0 < 0) t0 = s; t1 = s; } }
    if (t0 < 0) return;
    for (const sd of [-1, 1]) {
      const ox = -dy * sd * half, oy = dx * sd * half;
      seg(g, ax + dx * t0 + ox, ay + dy * t0 + oy + 1.2, ax + dx * t1 + ox, ay + dy * t1 + oy + 1.2, 2.4, 'rgba(0,0,0,0.35)');
      seg(g, ax + dx * t0 + ox, ay + dy * t0 + oy, ax + dx * t1 + ox, ay + dy * t1 + oy, 2, dim('#c2c9cf', 0.35));
      for (let s = t0; s <= t1 + 0.1; s += (t1 - t0) / 4) disc(g, ax + dx * s + ox, ay + dy * s + oy, 1.5, dim('#8a9299', 0.35));
    }
  };
  for (const e of city.edges) if (e.bridge) { const [A, B] = nodeOf(e); railing(A.x, A.y, B.x, B.y, widths[e.cls ?? 'street'][1] / 2 + 0.6); }
  for (let i = 0; i < rail.length - 1; i++) railing(rail[i][0], rail[i][1], rail[i + 1][0], rail[i + 1][1], 6);
  // 터널 입구: 산을 뚫고 지나는 구간
  for (const e of city.edges) { const [A, B] = nodeOf(e); if (e.cls !== 'arterial' || mountainAt((A.x + B.x) / 2, (A.y + B.y) / 2) < 0.35) continue; for (const t of [0.3, 0.7]) { const x = A.x + (B.x - A.x) * t, y = A.y + (B.y - A.y) * t; g.save(); g.translate(x, y); g.rotate(Math.atan2(B.y - A.y, B.x - A.x)); g.fillStyle = dim('#7d8288', 0.35); g.fillRect(-3, -15, 6, 30); g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(t < 0.5 ? 3 : -9, -10, 6, 20); g.restore(); } }

  // 10) 건물: 그림자를 먼저 깔고 종류별 지붕을 올린다
  const lots = city.facilities.map(facilityLot);
  const bs = city.places.filter((q) => !q.open && q.facility < 0);
  const flat = new Set(['greenhouse', 'utility', 'storage', 'construction', 'gasStation', 'substation', 'dam']);
  for (const b of bs) if (!flat.has(b.kind)) paintShadow(g, b);
  for (const b of bs) local(g, b, (p) => paintRoof(g, p, dim, night));
  // 주거 지역의 가로수
  for (const e of city.edges) {
    if (e.cls === 'highway' || e.bridge) continue;
    const [A, B] = nodeOf(e), D = districtAt((A.x + B.x) / 2, (A.y + B.y) / 2);
    if (!D || (D.district !== 'residential' && e.cls !== 'arterial')) continue;
    const dx = (B.x - A.x) / e.len, dy = (B.y - A.y) / e.len, off = roadHalf(e) - 1;
    for (let s = 30; s < e.len - 26; s += 30) {
      const side = (Math.round(s / 30) + e.id) % 2 ? 1 : -1;
      const tx = A.x + dx * s - dy * off * side, ty = A.y + dy * s + dx * off * side;
      if (lots.some((l) => tx > l.x - 4 && tx < l.x + l.w + 4 && ty > l.y - 4 && ty < l.y + l.h + 4)) continue;
      canopy(g, tx, ty, 3.2, hash2(e.id, s), night);
    }
  }
  // 11) 출동 시설
  for (const f of city.facilities) drawFacility(g, f, night);

  // 12) 밤: 가로등 불빛과 창에서 새어 나오는 빛
  const lamps: CityLamp[] = [];
  for (const e of city.edges) {
    const [A, B] = nodeOf(e), dx = (B.x - A.x) / e.len, dy = (B.y - A.y) / e.len, off = roadHalf(e) - 1.5;
    const gap = e.arterial ? 62 : 84;
    if (e.cls === 'local' && !districtAt((A.x + B.x) / 2, (A.y + B.y) / 2)) continue;
    for (let s = 26; s < e.len - 20; s += gap) { const side = Math.round(s / gap) % 2 ? 1 : -1; lamps.push({ x: A.x + dx * s - dy * off * side, y: A.y + dy * s + dx * off * side }); }
  }
  if (night) {
    g.globalCompositeOperation = 'lighter';
    for (const l of lamps) { const gr = g.createRadialGradient(l.x, l.y, 0, l.x, l.y, 30); gr.addColorStop(0, 'rgba(255,214,150,0.5)'); gr.addColorStop(0.35, 'rgba(255,190,110,0.16)'); gr.addColorStop(1, 'rgba(255,170,90,0)'); g.fillStyle = gr; g.fillRect(l.x - 30, l.y - 30, 60, 60); }
    bs.forEach((b, i) => {
      if (flat.has(b.kind) || b.kind === 'greenhouse') return;
      const n = b.district === 'commercial' ? 3 : b.district === 'residential' ? 1 : 1, cx = b.x + b.w / 2, cy = b.y + b.h / 2, r = Math.max(b.w, b.h) / 2;
      for (let k = 0; k < n; k++) {
        if (hash2(i * 7 + k, 51) > (b.district === 'industrial' ? 0.4 : 0.7)) continue;
        const a = hash2(i * 3 + k, 52) * 6.2832, lx = cx + Math.cos(a) * r * 0.8, ly = cy + Math.sin(a) * r * 0.8;
        const gr = g.createRadialGradient(lx, ly, 0, lx, ly, 13); gr.addColorStop(0, 'rgba(255,224,160,0.6)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
        g.fillStyle = gr; g.fillRect(lx - 13, ly - 13, 26, 26);
      }
    });
    for (const q of city.places) if (q.kind === 'lighthouse') { const x = q.x + q.w / 2, y = q.y + q.h / 2; const gr = g.createRadialGradient(x, y, 0, x, y, 190); gr.addColorStop(0, 'rgba(255,244,200,0.5)'); gr.addColorStop(1, 'rgba(255,244,200,0)'); g.fillStyle = gr; g.beginPath(); g.moveTo(x, y); g.arc(x, y, 190, 0.5, 1.1); g.closePath(); g.fill(); }
    g.globalCompositeOperation = 'source-over';
    for (const l of lamps) disc(g, l.x, l.y, 1.1, '#fff0c8');
  } else for (const l of lamps) { disc(g, l.x + 0.6, l.y + 0.8, 1, 'rgba(0,0,0,0.35)'); disc(g, l.x, l.y, 0.9, '#aab4bd'); }

  // 13) 잔 입자와 가장자리 어둡게
  g.setTransform(1, 0, 0, 1, 0, 0);
  const n = document.createElement('canvas'); n.width = n.height = 128;
  const ng = n.getContext('2d')!, im = ng.createImageData(128, 128);
  for (let i = 0; i < 128 * 128; i++) { const v = 128 + (hash2(i, 4441) - 0.5) * 110; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
  ng.putImageData(im, 0, 0);
  g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.13; g.fillStyle = g.createPattern(n, 'repeat')!; g.fillRect(0, 0, c.width, c.height);
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  const vg = g.createRadialGradient(c.width / 2, c.height / 2, c.height * 0.5, c.width / 2, c.height / 2, c.width * 0.75);
  vg.addColorStop(0, 'rgba(4,8,12,0)'); vg.addColorStop(1, 'rgba(4,8,12,0.55)');
  g.fillStyle = vg; g.fillRect(0, 0, c.width, c.height);
  return { c, lamps };
}
