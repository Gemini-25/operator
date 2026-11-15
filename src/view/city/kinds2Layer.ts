// 지도에 덧붙인 N9 장소의 그림 (화면 — 시뮬레이션 상태를 읽기만 한다)
// 지하철역 출입구의 기호(계단을 내려가는 그림 — 글자 없음) · 세 역을 잇는 땅 밑 노선 점선 · 중앙대로 지하차도(철길 아래의 어두운 띠와 철교) ·
// 공연장의 둥근 지붕 · 은행 본점의 지붕(은행과 같은 색 — 기둥 줄은 길 쪽).
// 도시는 고정이라 한 번만 그린다: renderCity 가 고정 층(staticCity)을 만든 바로 다음에 그 캔버스 위에 덧그린다(paintKinds2Static).
// staticCity.ts·places.ts 는 고치지 않는다 — 새 종류 셋의 건물 바탕(평지붕)과 그림자는 그쪽의 기본 그림이 그린다.

import type { Sim } from '../../sim/engine';
import { underpassEdges } from '../../sim/field/kinds2Kit';
import { RAIL } from '../../sim/cityPlan';
import type { City, Place } from '../../sim/types';
import { shade } from '../scene/common';

/** 지하철 노선의 색 (지도의 다른 기호와 겹치지 않는 보라) */
export const SUBWAY_LINE = '#8f6ee0';
/**
 * 지하철 출입구 기호의 모양(가운데가 원점, 지도 단위): 반지름 r 의 노선 색 원 안에 흰 계단(왼쪽 위가 높다)과 오른쪽 위의 아래 화살.
 * 글자처럼 읽히지 않게 채운 모양 하나 + 화살 하나로 했다. 지도(캔버스)와 범례(ui/MapLegend.tsx 의 SVG)가 같은 것을 쓴다.
 */
export const SUBWAY_GLYPH = {
  r: 6.4,
  stairs: [[-4.4, -2.2], [-1.8, -2.2], [-1.8, 0.2], [0.8, 0.2], [0.8, 2.4], [4.3, 2.4], [4.3, 4.0], [-4.4, 4.0]] as [number, number][],
  arrow: [[[2.7, -4.4], [2.7, -1.2]], [[1.4, -2.4], [2.7, -1.0], [4.0, -2.4]]] as [number, number][][],
};
/** 고정 층의 간선 도로 폭(staticCity 의 widths.arterial[0]) — 지하차도 띠의 폭 */
const ARTERIAL_W = 27;

type G = CanvasRenderingContext2D;
type Dim = (c: string, k?: number) => string;

/** 고정 층 캔버스(staticCity 가 CITY_K 배로 그린 것) 위에 덧그린다. 캔버스의 배율은 폭으로 안다 */
export function paintKinds2Static(c: HTMLCanvasElement, sim: Sim): void {
  const g = c.getContext('2d');
  if (!g) return;
  const K = c.width / sim.city.w;
  g.save(); g.setTransform(K, 0, 0, K, 0, 0);
  drawKinds2Layer(g, sim.city, sim.weather === 'night');
  g.restore();
}

/** 지도 좌표로 그린다 (g 에는 이미 지도 좌표 → 화면 변환이 걸려 있다) */
export function drawKinds2Layer(g: G, city: City, night: boolean): void {
  const dim: Dim = (col, k = 0.45) => (night ? shade(col, -k) : col);
  const subway = city.places.filter((q) => q.kind === 'subway');
  g.save();
  g.lineJoin = 'round';
  drawUnderpasses(g, city, dim);
  drawSubwayLine(g, subway, dim);
  for (const q of city.places) {
    if (q.kind === 'concertHall') local(g, q, () => drawDome(g, q, dim));
    else if (q.kind === 'bankHQ') local(g, q, () => drawBankHQ(g, q, dim));
  }
  for (const q of subway) drawEntrance(g, q, dim, night);
  g.restore();
}

const mid = (q: Place): [number, number] => [q.x + q.w / 2, q.y + q.h / 2];
const disc = (g: G, x: number, y: number, r: number, col: string): void => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill(); };
/** 건물 가운데를 원점으로, 건물의 각도대로 돌린 좌표에서 그린다 */
function local(g: G, q: Place, draw: () => void): void { const [cx, cy] = mid(q); g.save(); g.translate(cx, cy); if (q.rot) g.rotate(q.rot); draw(); g.restore(); }

type Side = 'n' | 's' | 'e' | 'w';
/** 건물의 어느 변이 길(진입 지점 q.cx, q.cy) 쪽인가 — 건물의 돌린 좌표로(n = −y · s = +y · e = +x · w = −x) */
function frontOf(q: Place): Side {
  const [cx, cy] = mid(q), r = -(q.rot ?? 0), dx = q.cx - cx, dy = q.cy - cy;
  const lx = dx * Math.cos(r) - dy * Math.sin(r), ly = dx * Math.sin(r) + dy * Math.cos(r);
  return Math.abs(lx) / (q.w / 2) > Math.abs(ly) / (q.h / 2) ? (lx > 0 ? 'e' : 'w') : ly > 0 ? 's' : 'n';
}
/** 그 변을 따라 두께 t 의 띠 (돌린 좌표의 [x, y, w, h]) */
function strip(q: Place, side: Side, t: number, inset = 0): [number, number, number, number] {
  const hw = q.w / 2, hh = q.h / 2;
  if (side === 's') return [-hw + inset, hh - t, q.w - inset * 2, t];
  if (side === 'n') return [-hw + inset, -hh, q.w - inset * 2, t];
  if (side === 'e') return [hw - t, -hh + inset, t, q.h - inset * 2];
  return [-hw, -hh + inset, t, q.h - inset * 2];
}

/** 땅 밑 노선: 역을 차례로 잇는 부드러운 점선 (그림만 — 시뮬레이션에 노선·시각표는 없다) */
function drawSubwayLine(g: G, st: Place[], dim: Dim): void {
  if (st.length < 2) return;
  const pts = st.map(mid);
  const path = (): void => {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) { const [x, y] = pts[i], [nx, ny] = pts[i + 1]; g.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2); }
    g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  };
  g.lineCap = 'round'; g.setLineDash([9, 7]);
  path(); g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 4.6; g.stroke();
  path(); g.strokeStyle = dim(SUBWAY_LINE, 0.3); g.globalAlpha = 0.66; g.lineWidth = 2.6; g.stroke();
  g.globalAlpha = 1; g.setLineDash([]);
}

/** 지하철역 출입구: 지붕 덮인 계단(건물의 각도대로 — 노선 색 띠는 길 쪽) + 똑바로 선 동그란 기호(계단 + 내려가는 화살) */
function drawEntrance(g: G, q: Place, dim: Dim, night: boolean): void {
  const [cx, cy] = mid(q);
  local(g, q, () => {
    g.fillStyle = dim('#3b4652', 0.3); g.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
    g.fillStyle = dim('#9fb4c4', 0.4); g.fillRect(-q.w / 2 + 1.2, -q.h / 2 + 1.2, q.w - 2.4, q.h - 2.4);      // 유리 지붕
    const [x, y, w, h] = strip(q, frontOf(q), 2.4); g.fillStyle = dim(SUBWAY_LINE, 0.3); g.fillRect(x, y, w, h);      // 노선 색 띠
  });
  // 기호: 노선 색 동그라미 + 흰 테 + SUBWAY_GLYPH (건물이 돌아 있어도 기호는 똑바로)
  const r = SUBWAY_GLYPH.r;
  disc(g, cx + 0.8, cy + 1.1, r + 0.7, 'rgba(0,0,0,0.4)');
  disc(g, cx, cy, r + 1.1, night ? '#d9dde2' : '#f4f6f8');
  disc(g, cx, cy, r, dim(SUBWAY_LINE, 0.25));
  g.fillStyle = '#ffffff';
  g.beginPath(); SUBWAY_GLYPH.stairs.forEach(([x, y], k) => (k ? g.lineTo(cx + x, cy + y) : g.moveTo(cx + x, cy + y))); g.closePath(); g.fill();
  g.strokeStyle = '#ffffff'; g.lineWidth = 1.2; g.lineCap = 'round';
  for (const pl of SUBWAY_GLYPH.arrow) { g.beginPath(); pl.forEach(([x, y], k) => (k ? g.lineTo(cx + x, cy + y) : g.moveTo(cx + x, cy + y))); g.stroke(); }
}

/** 공연장(돌린 좌표): 평지붕 위에 얹은 둥근 지붕(살·고리·꼭대기 채광창)과 길 쪽 차양 */
function drawDome(g: G, q: Place, dim: Dim): void {
  const rx = q.w * 0.4, ry = q.h * 0.4;
  const [x, y, w, h] = strip(q, frontOf(q), 4.5, 3); g.fillStyle = dim('#c9b26a', 0.4); g.fillRect(x, y, w, h);      // 차양
  g.fillStyle = 'rgba(0,0,0,0.32)'; g.beginPath(); g.ellipse(2.2, 2.8, rx, ry, 0, 0, 6.2832); g.fill();
  const gr = g.createRadialGradient(-rx * 0.3, -ry * 0.35, 1, 0, 0, Math.max(rx, ry));
  gr.addColorStop(0, dim('#e6ecf2', 0.45)); gr.addColorStop(0.6, dim('#a9b6c3', 0.45)); gr.addColorStop(1, dim('#6d7b88', 0.45));
  g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 6.2832); g.fill();
  g.strokeStyle = 'rgba(30,40,50,0.28)'; g.lineWidth = 0.8;
  for (let k = 0; k < 12; k++) { const a = (k / 12) * 6.2832; g.beginPath(); g.moveTo(Math.cos(a) * rx * 0.22, Math.sin(a) * ry * 0.22); g.lineTo(Math.cos(a) * rx, Math.sin(a) * ry); g.stroke(); }
  for (const f of [0.55, 0.82]) { g.beginPath(); g.ellipse(0, 0, rx * f, ry * f, 0, 0, 6.2832); g.stroke(); }
  g.strokeStyle = dim('#3d4954', 0.3); g.lineWidth = 1.1; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 6.2832); g.stroke();
  g.fillStyle = dim('#f2e3a0', 0.5); g.beginPath(); g.ellipse(0, 0, rx * 0.2, ry * 0.2, 0, 0, 6.2832); g.fill();      // 꼭대기 채광창
}

/** 은행 본점(돌린 좌표): 은행 지붕과 같은 색(베이지 테·초록 지붕·금빛 원)에 길 쪽 기둥 줄 — 지점보다 크고 층이 높다 */
function drawBankHQ(g: G, q: Place, dim: Dim): void {
  const hw = q.w / 2, hh = q.h / 2, col = dim('#b8b09a', 0.5);
  g.fillStyle = shade(col, -0.3); g.fillRect(-hw, -hh, q.w, q.h); g.fillStyle = col; g.fillRect(-hw + 1.5, -hh + 1.5, q.w - 3, q.h - 3);
  g.fillStyle = dim('#2f6a4f', 0.45); g.fillRect(-hw + 4, -hh + 4, q.w - 8, q.h - 8); g.fillStyle = dim('#3f8a66', 0.45); g.fillRect(-hw + 5.5, -hh + 5.5, q.w - 11, q.h - 11);
  g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(-hw + 9, -hh + 9, q.w - 18, q.h - 18);      // 가운데 탑
  const side = frontOf(q), [x, y, w, h] = strip(q, side, 4.6, 2), along = side === 'n' || side === 's';
  g.fillStyle = dim('#efeadb', 0.4);
  if (along) for (let k = x + 1; k < x + w - 1; k += 4.2) g.fillRect(k, y, 2, h); else for (let k = y + 1; k < y + h - 1; k += 4.2) g.fillRect(x, k, w, 2);
  disc(g, 0, 0, Math.min(q.w, q.h) * 0.17, dim('#e8c15a', 0.4)); disc(g, 0, 0, Math.min(q.w, q.h) * 0.1, dim('#b8902f', 0.4));
}

/** 두 선분의 교점 (없으면 null) */
function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): [number, number] | null {
  const r1 = bx - ax, r2 = by - ay, s1 = dx - cx, s2 = dy - cy, den = r1 * s2 - r2 * s1;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * s2 - (cy - ay) * s1) / den, u = ((cx - ax) * r2 - (cy - ay) * r1) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [ax + r1 * t, ay + r2 * t] : null;
}

/** 지하차도: 철길 아래로 내려가는 도로의 어두운 띠와 양쪽 입구의 옹벽, 그 위를 지나는 철교(난간 둘) */
function drawUnderpasses(g: G, city: City, dim: Dim): void {
  for (const id of underpassEdges(city)) {
    const e = city.edges[id], A = city.nodes[e.a], B = city.nodes[e.b];
    for (let i = 0; i < RAIL.length - 1; i++) {
      const P = RAIL[i], Q = RAIL[i + 1], X = cross(A.x, A.y, B.x, B.y, P[0], P[1], Q[0], Q[1]);
      if (!X) continue;
      const len = Math.hypot(B.x - A.x, B.y - A.y), ux = (B.x - A.x) / len, uy = (B.y - A.y) / len;
      const rl = Math.hypot(Q[0] - P[0], Q[1] - P[1]), rx = (Q[0] - P[0]) / rl, ry = (Q[1] - P[1]) / rl;
      const half = Math.min(len * 0.36, 20), hw = ARTERIAL_W / 2 - 1.5;
      // 어두운 띠(내려간 차도)와 그 안의 가운데 선
      g.save(); g.translate(X[0], X[1]); g.rotate(Math.atan2(uy, ux));
      const gr = g.createLinearGradient(-half, 0, half, 0);
      gr.addColorStop(0, 'rgba(6,10,14,0.1)'); gr.addColorStop(0.3, 'rgba(6,10,14,0.66)'); gr.addColorStop(0.7, 'rgba(6,10,14,0.66)'); gr.addColorStop(1, 'rgba(6,10,14,0.1)');
      g.fillStyle = gr; g.fillRect(-half, -hw, half * 2, hw * 2);
      g.strokeStyle = dim('#c9b26a', 0.4); g.globalAlpha = 0.45; g.lineWidth = 0.9; g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(-half, 0); g.lineTo(half, 0); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      // 양쪽 옹벽: 차도 가장자리를 따라 내려가는 낮은 벽
      for (const sd of [-1, 1]) { g.fillStyle = dim('#9aa1a8', 0.4); g.fillRect(-half * 0.8, sd * hw - (sd > 0 ? 1.6 : 0), half * 1.6, 1.6); }
      g.restore();
      // 철교: 도로 위를 가로지르는 철길 + 난간 (끝은 각지게)
      const span = ARTERIAL_W / 2 + 5, x0 = X[0] - rx * span, y0 = X[1] - ry * span, x1 = X[0] + rx * span, y1 = X[1] + ry * span;
      const line = (ax: number, ay: number, bx: number, by: number, w: number, col: string): void => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); };
      g.lineCap = 'butt';
      line(x0 + 1.2, y0 + 2.4, x1 + 1.2, y1 + 2.4, 14, 'rgba(0,0,0,0.42)');      // 철교 그림자
      line(x0, y0, x1, y1, 14, dim('#7a7870', 0.3));
      line(x0, y0, x1, y1, 10, dim('#4d4a43', 0.25));
      g.setLineDash([1.6, 3.6]); line(x0, y0, x1, y1, 7, dim('#2b2823', 0.1)); g.setLineDash([]);
      for (const sd of [-1, 1]) { const ox = -ry * sd * 6.4, oy = rx * sd * 6.4; line(x0 + ox, y0 + oy, x1 + ox, y1 + oy, 1.4, dim('#d2d8dd', 0.35)); }
    }
  }
}
