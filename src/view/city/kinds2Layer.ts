// 지도에 덧붙인 N9 장소의 그림 (화면 — 시뮬레이션 상태를 읽기만 한다)
// 지하철역 출입구의 기호(계단을 내려가는 그림 — 글자 없음) · 세 역을 잇는 땅 밑 노선 점선 · 중앙대로 지하차도(철길 아래의 어두운 띠와 철교) · 공연장의 둥근 지붕.
// 도시는 고정이라 한 번만 그린다: renderCity 가 고정 층(staticCity)을 만든 바로 다음에 그 캔버스 위에 덧그린다(paintKinds2Static).
// staticCity.ts·places.ts 는 고치지 않는다 — 새 종류 셋의 건물 바탕(평지붕)은 그쪽의 기본 그림이 그린다.

import type { Sim } from '../../sim/engine';
import { underpassEdges } from '../../sim/field/kinds2Kit';
import { RAIL } from '../../sim/cityPlan';
import type { City, Place } from '../../sim/types';
import { shade } from '../scene/common';

/** 지하철 노선의 색 (지도의 다른 기호와 겹치지 않는 보라) */
export const SUBWAY_LINE = '#8f6ee0';
/** 고정 층의 간선 도로 폭(staticCity 의 widths.arterial[0]) — 지하차도 띠의 폭 */
const ARTERIAL_W = 27;

type G = CanvasRenderingContext2D;

/** 고정 층 캔버스(staticCity 가 CITY_K 배로 그린 것) 위에 덧그린다. 캔버스의 배율은 폭으로 안다 */
export function paintKinds2Static(c: HTMLCanvasElement, sim: Sim): void {
  const g = c.getContext('2d');
  if (!g) return;
  const K = c.width / sim.city.w;
  g.save(); g.setTransform(K, 0, 0, K, 0, 0);
  drawKinds2Layer(g, sim.city, sim.weather === 'night');
  g.restore();
}

/** 지도 좌표로 그린다 (g 는 이미 지도 좌표 → 화면 변환이 걸려 있다) */
export function drawKinds2Layer(g: G, city: City, night: boolean): void {
  const dim = (col: string, k = 0.45): string => (night ? shade(col, -k) : col);
  const subway = city.places.filter((q) => q.kind === 'subway');
  g.save();
  g.lineCap = 'round'; g.lineJoin = 'round';
  drawUnderpasses(g, city, dim);
  drawSubwayLine(g, subway, dim);
  for (const q of city.places) if (q.kind === 'concertHall') drawDome(g, q, dim);
  for (const q of subway) drawEntrance(g, q, dim, night);
  g.restore();
}

const mid = (q: Place): [number, number] => [q.x + q.w / 2, q.y + q.h / 2];
const disc = (g: G, x: number, y: number, r: number, col: string): void => { g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill(); };

/** 땅 밑 노선: 역을 차례로 잇는 부드러운 점선 (그림만 — 시뮬레이션에 노선·시각표는 없다) */
function drawSubwayLine(g: G, st: Place[], dim: (c: string, k?: number) => string): void {
  if (st.length < 2) return;
  const pts = st.map(mid);
  const path = (): void => {
    g.beginPath(); g.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length - 1; i++) { const [x, y] = pts[i], [nx, ny] = pts[i + 1]; g.quadraticCurveTo(x, y, (x + nx) / 2, (y + ny) / 2); }
    g.lineTo(pts[pts.length - 1][0], pts[pts.length - 1][1]);
  };
  g.setLineDash([9, 7]);
  path(); g.strokeStyle = 'rgba(0,0,0,0.32)'; g.lineWidth = 5; g.stroke();
  path(); g.strokeStyle = dim(SUBWAY_LINE, 0.3); g.globalAlpha = 0.72; g.lineWidth = 2.8; g.stroke();
  g.globalAlpha = 1; g.setLineDash([]);
}

/** 지하철역 출입구: 지붕 덮인 계단(건물의 각도대로) + 똑바로 선 동그란 기호(계단을 내려가는 그림) */
function drawEntrance(g: G, q: Place, dim: (c: string, k?: number) => string, night: boolean): void {
  const [cx, cy] = mid(q);
  g.save(); g.translate(cx, cy); if (q.rot) g.rotate(q.rot);
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-q.w / 2 + 1.4, -q.h / 2 + 1.8, q.w, q.h);
  g.fillStyle = dim('#3b4652', 0.3); g.fillRect(-q.w / 2, -q.h / 2, q.w, q.h);
  g.fillStyle = dim('#9fb4c4', 0.4); g.fillRect(-q.w / 2 + 1.2, -q.h / 2 + 1.2, q.w - 2.4, q.h * 0.42);      // 유리 지붕
  g.fillStyle = dim(SUBWAY_LINE, 0.3); g.fillRect(-q.w / 2, q.h / 2 - 2.2, q.w, 2.2);      // 노선 색 띠
  g.restore();
  // 기호: 노선 색 동그라미 + 흰 테 + 계단 세 칸(왼쪽 위에서 오른쪽 아래로 내려간다)
  const r = 6.4;
  disc(g, cx + 0.8, cy + 1.1, r + 0.6, 'rgba(0,0,0,0.4)');
  disc(g, cx, cy, r + 1.1, night ? '#d9dde2' : '#f4f6f8');
  disc(g, cx, cy, r, dim(SUBWAY_LINE, 0.25));
  g.strokeStyle = '#ffffff'; g.lineWidth = 1.25;
  g.beginPath();
  g.moveTo(cx - 3.9, cy - 2.7); g.lineTo(cx - 1.5, cy - 2.7); g.lineTo(cx - 1.5, cy - 0.3); g.lineTo(cx + 0.9, cy - 0.3); g.lineTo(cx + 0.9, cy + 2.1); g.lineTo(cx + 3.6, cy + 2.1);
  g.stroke();
  g.beginPath(); g.moveTo(cx + 3.6, cy - 3.2); g.lineTo(cx + 3.6, cy + 0.4); g.stroke();      // 내려가는 쪽을 가리키는 짧은 세로 획
  g.beginPath(); g.moveTo(cx + 2.4, cy - 0.8); g.lineTo(cx + 3.6, cy + 0.6); g.lineTo(cx + 4.8, cy - 0.8); g.stroke();
}

/** 공연장: 평지붕 위에 얹은 둥근 지붕(살·고리·꼭대기 채광창)과 앞마당 쪽 차양 */
function drawDome(g: G, q: Place, dim: (c: string, k?: number) => string): void {
  const [cx, cy] = mid(q);
  g.save(); g.translate(cx, cy); if (q.rot) g.rotate(q.rot);
  const rx = q.w * 0.4, ry = q.h * 0.4;
  g.fillStyle = dim('#c9b26a', 0.4); g.fillRect(-q.w / 2 + 3, q.h / 2 - 4.5, q.w - 6, 4.5);      // 앞쪽 차양
  g.fillStyle = 'rgba(0,0,0,0.32)'; g.beginPath(); g.ellipse(2.2, 2.8, rx, ry, 0, 0, 6.2832); g.fill();
  const gr = g.createRadialGradient(-rx * 0.3, -ry * 0.35, 1, 0, 0, Math.max(rx, ry));
  gr.addColorStop(0, dim('#e6ecf2', 0.45)); gr.addColorStop(0.6, dim('#a9b6c3', 0.45)); gr.addColorStop(1, dim('#6d7b88', 0.45));
  g.fillStyle = gr; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 6.2832); g.fill();
  g.strokeStyle = 'rgba(30,40,50,0.28)'; g.lineWidth = 0.8;
  for (let k = 0; k < 12; k++) { const a = (k / 12) * 6.2832; g.beginPath(); g.moveTo(Math.cos(a) * rx * 0.22, Math.sin(a) * ry * 0.22); g.lineTo(Math.cos(a) * rx, Math.sin(a) * ry); g.stroke(); }
  for (const f of [0.55, 0.82]) { g.beginPath(); g.ellipse(0, 0, rx * f, ry * f, 0, 0, 6.2832); g.stroke(); }
  g.strokeStyle = dim('#3d4954', 0.3); g.lineWidth = 1.1; g.beginPath(); g.ellipse(0, 0, rx, ry, 0, 0, 6.2832); g.stroke();
  g.fillStyle = dim('#f2e3a0', 0.5); g.beginPath(); g.ellipse(0, 0, rx * 0.2, ry * 0.2, 0, 0, 6.2832); g.fill();      // 꼭대기 채광창
  g.restore();
}

/** 두 선분의 교점 (없으면 null) */
function cross(ax: number, ay: number, bx: number, by: number, cx: number, cy: number, dx: number, dy: number): [number, number] | null {
  const r1 = bx - ax, r2 = by - ay, s1 = dx - cx, s2 = dy - cy, den = r1 * s2 - r2 * s1;
  if (Math.abs(den) < 1e-9) return null;
  const t = ((cx - ax) * s2 - (cy - ay) * s1) / den, u = ((cx - ax) * r2 - (cy - ay) * r1) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? [ax + r1 * t, ay + r2 * t] : null;
}

/** 지하차도: 철길 아래로 내려가는 도로의 어두운 띠와 양쪽 입구, 그 위를 지나는 철교(난간 둘) */
function drawUnderpasses(g: G, city: City, dim: (c: string, k?: number) => string): void {
  for (const id of underpassEdges(city)) {
    const e = city.edges[id], A = city.nodes[e.a], B = city.nodes[e.b];
    for (let i = 0; i < RAIL.length - 1; i++) {
      const P = RAIL[i], Q = RAIL[i + 1], X = cross(A.x, A.y, B.x, B.y, P[0], P[1], Q[0], Q[1]);
      if (!X) continue;
      const len = Math.hypot(B.x - A.x, B.y - A.y), ux = (B.x - A.x) / len, uy = (B.y - A.y) / len;
      const rl = Math.hypot(Q[0] - P[0], Q[1] - P[1]), rx = (Q[0] - P[0]) / rl, ry = (Q[1] - P[1]) / rl;
      const half = Math.min(len * 0.32, 18), hw = ARTERIAL_W / 2 - 1.5;
      // 어두운 띠(내려간 차도)와 그 안의 차선
      g.save(); g.translate(X[0], X[1]); g.rotate(Math.atan2(uy, ux));
      const gr = g.createLinearGradient(-half, 0, half, 0);
      gr.addColorStop(0, 'rgba(6,10,14,0.15)'); gr.addColorStop(0.35, 'rgba(6,10,14,0.62)'); gr.addColorStop(0.65, 'rgba(6,10,14,0.62)'); gr.addColorStop(1, 'rgba(6,10,14,0.15)');
      g.fillStyle = gr; g.fillRect(-half, -hw, half * 2, hw * 2);
      g.strokeStyle = dim('#c9b26a', 0.4); g.globalAlpha = 0.5; g.lineWidth = 0.9; g.setLineDash([4, 4]);
      g.beginPath(); g.moveTo(-half, 0); g.lineTo(half, 0); g.stroke(); g.setLineDash([]); g.globalAlpha = 1;
      // 양쪽 입구의 옹벽
      for (const sd of [-1, 1]) {
        g.fillStyle = dim('#9aa1a8', 0.4); g.fillRect(sd * half - (sd > 0 ? 2.4 : 0), -hw - 2.2, 2.4, hw * 2 + 4.4);
        g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(sd * half - (sd > 0 ? 2.4 : 0) + (sd > 0 ? -1.4 : 2.4), -hw, 1.4, hw * 2);
      }
      g.restore();
      // 철교: 도로 위를 가로지르는 철길 + 난간
      const span = ARTERIAL_W / 2 + 6, x0 = X[0] - rx * span, y0 = X[1] - ry * span, x1 = X[0] + rx * span, y1 = X[1] + ry * span;
      const line = (ax: number, ay: number, bx: number, by: number, w: number, col: string): void => { g.strokeStyle = col; g.lineWidth = w; g.beginPath(); g.moveTo(ax, ay); g.lineTo(bx, by); g.stroke(); };
      line(x0 + 1, y0 + 2, x1 + 1, y1 + 2, 13, 'rgba(0,0,0,0.38)');
      line(x0, y0, x1, y1, 12, dim('#6c6a63', 0.3));
      line(x0, y0, x1, y1, 10, dim('#4d4a43', 0.25));
      g.setLineDash([1.6, 3.6]); line(x0, y0, x1, y1, 7, dim('#2b2823', 0.1)); g.setLineDash([]);
      for (const sd of [-1, 1]) { const ox = -ry * sd * 6.6, oy = rx * sd * 6.6; line(x0 + ox, y0 + oy, x1 + ox, y1 + oy, 1.6, dim('#c2c9cf', 0.35)); }
    }
  }
}
