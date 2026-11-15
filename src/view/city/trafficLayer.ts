// 지도의 교통 표시 (docs/specs/T1-traffic.md). 상태(sim.traffic, 도로 구간)를 읽기만 한다.
// 두 자리에서 불린다: 월드 좌표계(혼잡 띠·통제 점선·열차·차단기)와 화면 좌표계(장애물 표식).
// 관제 시점(truth = false)에서는 아직 알려지지 않은 통제와 장애물을 그리지 않는다.

import { edgeName } from '../../sim/city';
import type { Sim } from '../../sim/engine';
import { railAt } from '../../sim/traffic';
import type { Obstacle, ObstacleKind } from '../../sim/traffic';
import type { RoadEdge } from '../../sim/types';
import { fmtSec } from '../../sim/util';
import { mix } from '../scene/common';
import { TYPE_COLOR } from '../typeStyle';

type G = CanvasRenderingContext2D;

/** 차도의 폭 (staticCity 의 도로 그림과 같은 값) */
const LANE_W: Record<string, number> = { local: 9.5, street: 12.5, arterial: 19, highway: 24 };
const YELLOW = '#f2c94c', ORANGE = '#ff9f43', RED = '#ff5d5d';

/** 그 구간의 지금 속도 느낌 (알려진 상태로) */
export function flowOf(e: RoadEdge, truth: boolean): '원활' | '서행' | '정체' | '극심' | '통제' {
  if (e.closed && (truth || e.known !== false)) return '통제';
  const load = e.cong + e.slow;
  return load >= 2.3 ? '극심' : load >= 1.8 ? '정체' : load >= 1.4 ? '서행' : '원활';      // 띠의 색(노랑·주황·빨강), 범례의 말과 같다
}

// 띠의 색이 12초마다 뚝뚝 바뀌지 않도록, 화면에 보이는 값은 실제 값을 천천히 따라간다 (표현 계층의 상태)
let shownFor: Sim | null = null, shown = new Float32Array(0), shownAt = 0;
function easeLoads(sim: Sim, timeMs: number): Float32Array {
  const edges = sim.city.edges;
  if (shownFor !== sim || shown.length !== edges.length) { shownFor = sim; shown = new Float32Array(edges.length); for (const e of edges) shown[e.id] = e.cong + e.slow; shownAt = timeMs; return shown; }
  const dt = timeMs - shownAt;
  if (dt <= 0) return shown;
  shownAt = timeMs;
  const k = dt > 4000 ? 1 : 1 - Math.exp(-dt / 900);
  for (const e of edges) shown[e.id] += (e.cong + e.slow - shown[e.id]) * k;
  return shown;
}
/** 부하 → 띠의 색 (경계에서는 두 색이 섞인다) */
function bandColor(load: number): string {
  if (load < 1.72) return YELLOW;
  if (load < 1.88) return mix(YELLOW, ORANGE, (load - 1.72) / 0.16);
  if (load < 2.22) return ORANGE;
  if (load < 2.38) return mix(ORANGE, RED, (load - 2.22) / 0.16);
  return RED;
}

export interface TrafficWorldOpts { timeMs: number; scale: number; truth: boolean; alpha?: number; mini?: boolean }

/** 지도의 월드 좌표계에서, 고정 지도 바로 위. 혼잡 띠, 통제 점선, 열차, 건널목 차단기 */
export function drawTrafficWorld(ctx: G, sim: Sim, o: TrafficWorldOpts): void {
  const city = sim.city, tr = sim.traffic, loads = easeLoads(sim, o.timeMs), minW = (o.mini ? 1.6 : 2.6) / Math.max(0.05, o.scale);
  const far = o.scale < 0.6 ? 0.2 : 0;      // 멀리서 볼 때는 가는 띠를 조금 더 짙게
  ctx.save();
  ctx.lineCap = 'butt';
  // 1) 혼잡: 도로 가운데의 띠 (내비게이션 지도처럼 노랑 → 주황 → 빨강)
  for (const e of city.edges) {
    const hidden = e.closed && e.known === false && !o.truth;      // 관제가 모르는 통제: 관제 시점에서는 평소처럼 보인다
    if (e.closed && !hidden) continue;
    const load = loads[e.id];
    if (load < 1.4) continue;
    const A = city.nodes[e.a], B = city.nodes[e.b], len = e.len || 1, inset = Math.min(len * 0.2, LANE_W[e.cls ?? 'street'] * 0.5);
    const ux = (B.x - A.x) / len, uy = (B.y - A.y) / len;
    ctx.strokeStyle = bandColor(load); ctx.globalAlpha = (0.55 + far) * Math.min(1, (load - 1.4) / 0.12);
    ctx.lineWidth = Math.max(LANE_W[e.cls ?? 'street'] * 0.45, minW);
    ctx.beginPath(); ctx.moveTo(A.x + ux * inset, A.y + uy * inset); ctx.lineTo(B.x - ux * inset, B.y - uy * inset); ctx.stroke();      // 교차로에서는 띠를 끊는다 (겹쳐서 짙어지지 않게)
  }
  ctx.globalAlpha = 1; ctx.lineCap = 'round';
  // 2) 통제: 알려진 것은 붉은 점선, 알려지지 않은 것은 관찰자 시점에서만 옅은 점선
  for (const e of city.edges) {
    if (!e.closed) continue;
    const A = city.nodes[e.a], B = city.nodes[e.b];
    if (e.known === false) {
      if (!o.truth) continue;
      ctx.strokeStyle = 'rgba(255,93,93,0.5)'; ctx.lineWidth = Math.max(3, minW * 0.8); ctx.setLineDash([3, 11]);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.setLineDash([]);
      continue;
    }
    ctx.strokeStyle = 'rgba(255,93,93,0.25)'; ctx.lineWidth = e.arterial ? 19 : 12.5;
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    ctx.strokeStyle = RED; ctx.lineWidth = 4.5; ctx.setLineDash([10, 9]);
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.setLineDash([]);
  }
  if (o.mini) { ctx.restore(); return; }
  // 3) 건널목 차단기: 내려가면 길을 가로지르는 막대와 번갈아 깜박이는 붉은 등
  const rail = city.rail ?? [], blink = Math.floor(o.timeMs / 430) % 2;
  for (const c of tr.crossings) {
    const e = city.edges[c.edge], A = city.nodes[e.a], B = city.nodes[e.b], len = e.len || 1, ux = (B.x - A.x) / len, uy = (B.y - A.y) / len;
    const gx = A.x + (B.x - A.x) * (e.gateT ?? 0.5), gy = A.y + (B.y - A.y) * (e.gateT ?? 0.5), half = LANE_W[e.cls ?? 'street'] / 2 + 1.5;
    for (const side of [-1, 1]) {
      const px = gx + ux * side * 9.5, py = gy + uy * side * 9.5;      // 철길 양쪽, 길을 가로질러
      const x0 = px - uy * half, y0 = py + ux * half, x1 = px + uy * half, y1 = py - ux * half;
      if (c.down) {
        ctx.strokeStyle = '#11181f'; ctx.lineWidth = 3.4; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.strokeStyle = '#f4f1e8'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
        ctx.strokeStyle = '#e5484d'; ctx.lineWidth = 2; ctx.setLineDash([2.6, 2.6]); ctx.lineCap = 'butt'; ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke(); ctx.setLineDash([]); ctx.lineCap = 'round';
        const lr = Math.max(1.7, 2.6 / o.scale);
        for (const [k, lx, ly] of [[0, x0, y0], [1, x1, y1]] as const) {
          const on = (k + (side > 0 ? 1 : 0)) % 2 === blink;
          if (on) { ctx.fillStyle = 'rgba(255,70,70,0.3)'; ctx.beginPath(); ctx.arc(lx, ly, lr * 2.2, 0, 6.2832); ctx.fill(); }
          ctx.fillStyle = on ? '#ff4646' : '#5a1f22'; ctx.beginPath(); ctx.arc(lx, ly, lr, 0, 6.2832); ctx.fill();
        }
      } else if (o.scale >= 0.9) {
        // 올라가 있을 때: 길가의 기둥만
        ctx.fillStyle = 'rgba(214,220,226,0.75)';
        for (const [lx, ly] of [[x0, y0], [x1, y1]]) { ctx.beginPath(); ctx.arc(lx, ly, 1.1, 0, 6.2832); ctx.fill(); }
      }
    }
  }
  // 4) 열차: 철길을 따라 움직이는 객차 세 칸
  if (rail.length > 1) for (const t of tr.trains) {
    const pos = t.ppos + (t.pos - t.ppos) * (o.alpha ?? 1), gap = 3, L = (t.len - gap * 2) / 3, wid = Math.max(7.4, 4.6 / o.scale);
    for (let k = 0; k < 3; k++) {
      const s = pos - t.dir * (L / 2 + k * (L + gap));
      if (s < 2 || s > tr.railLen - 2) continue;      // 아직 지도 밖이거나 이미 나갔다
      const p = railAt(rail, s);
      ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.ang + (t.dir < 0 ? Math.PI : 0));
      ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.roundRect(-L / 2 + 1.2, -wid / 2 + 1.8, L, wid, 2.4); ctx.fill();
      ctx.fillStyle = '#1d3160'; ctx.beginPath(); ctx.roundRect(-L / 2, -wid / 2, L, wid, k === 0 ? [2.4, wid * 0.42, wid * 0.42, 2.4] : 2.4); ctx.fill();
      ctx.strokeStyle = 'rgba(150,180,240,0.75)'; ctx.lineWidth = Math.max(0.7, 0.9 / o.scale); ctx.stroke();      // 어두운 지도 위에서 드러나게 밝은 테
      ctx.fillStyle = '#34539a'; ctx.fillRect(-L / 2 + 2, -wid * 0.16, L - 4 - (k === 0 ? wid * 0.2 : 0), wid * 0.32);      // 지붕의 밝은 줄
      // 밝은 창 줄 (양옆)
      ctx.fillStyle = 'rgba(255,232,160,0.92)';
      const n = 6, ww = (L - 8) / n;
      for (let i = 0; i < n; i++) { const wx = -L / 2 + 4 + i * ww; ctx.fillRect(wx, -wid / 2 + 0.9, ww * 0.62, wid * 0.14); ctx.fillRect(wx, wid / 2 - 0.9 - wid * 0.14, ww * 0.62, wid * 0.14); }
      if (k === 0) { ctx.fillStyle = t.dwell > 0 ? 'rgba(255,244,200,0.55)' : '#fff4c8'; ctx.beginPath(); ctx.arc(L / 2 - 1.6, 0, wid * 0.14, 0, 6.2832); ctx.fill(); }      // 전조등
      ctx.restore();
    }
  }
  ctx.restore();
}

// ───────────────────────── 장애물 표식 ─────────────────────────
// view/icons.ts 의 ICON_PATH 와 같은 방식(24×24 경로 문자열)으로 그린 그림 기호. 글자를 쓰지 않는다.
export const OBSTACLE_ICON: Record<ObstacleKind, string> = {
  // 공사 = 고깔
  roadwork: 'M10.4 2.5H13.6L15 7.6H9ZM8.4 9.8H15.6L17 14.9H7ZM3 17.2H21V20.6H3Z',
  // 고장 차량 = 경고 삼각형
  breakdown: 'M12 2.4L22.6 20.6H1.4ZM10.9 8.6V14.6H13.1V8.6ZM10.9 16.1V18.3H13.1V16.1Z',
  // 낙하물 = 상자
  debris: 'M3 8.4L12 4L21 8.4V17.1L12 21.6L3 17.1ZM4.3 8.8L12 12.6L19.7 8.8V10.2L12.7 13.7V20.5H11.3V13.7L4.3 10.2Z',
  // 불법 주차 = 차 (그 위에 사선을 따로 긋는다)
  parked: 'M3 14.5L5 9.2Q5.4 8 6.6 8H17.4Q18.6 8 19 9.2L21 14.5V18.5H18.4V17H5.6V18.5H3ZM6.4 13.2H17.6L16.5 10H7.5Z',
};
const iconCache = new Map<string, Path2D>();
function glyph(ctx: G, kind: ObstacleKind, x: number, y: number, size: number, color: string): void {
  let p = iconCache.get(kind);
  if (!p) { p = new Path2D(OBSTACLE_ICON[kind]); iconCache.set(kind, p); }
  ctx.save(); ctx.translate(x - size / 2, y - size / 2); ctx.scale(size / 24, size / 24); ctx.fillStyle = color; ctx.fill(p, 'evenodd'); ctx.restore();
  if (kind === 'parked') {
    ctx.strokeStyle = '#11181f'; ctx.lineWidth = size * 0.22; ctx.lineCap = 'round'; ctx.beginPath(); ctx.moveTo(x - size * 0.4, y + size * 0.4); ctx.lineTo(x + size * 0.4, y - size * 0.4); ctx.stroke();
    ctx.strokeStyle = RED; ctx.lineWidth = size * 0.12; ctx.beginPath(); ctx.moveTo(x - size * 0.4, y + size * 0.4); ctx.lineTo(x + size * 0.4, y - size * 0.4); ctx.stroke();
  }
}
/** 장애물 표식 하나 (범례에서도 쓴다). known = false 면 점선 테 */
export function drawObstacleMark(ctx: G, kind: ObstacleKind, x: number, y: number, r: number, known = true): void {
  ctx.save();
  ctx.fillStyle = 'rgba(0,0,0,0.45)'; ctx.beginPath(); ctx.arc(x + 0.8, y + 1.4, r, 0, 6.2832); ctx.fill();
  ctx.globalAlpha = known ? 1 : 0.8;
  ctx.fillStyle = '#161d24'; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = YELLOW; ctx.lineWidth = 1.5; if (!known) ctx.setLineDash([2.4, 2.2]);
  ctx.beginPath(); ctx.arc(x, y, r - 0.5, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]);
  glyph(ctx, kind, x, y + (kind === 'breakdown' ? -0.4 : 0), r * 1.36, kind === 'parked' ? '#d9e1e8' : YELLOW);
  ctx.restore();
}

const obstacleXY = (sim: Sim, ob: Obstacle): { x: number; y: number } => { const e = sim.city.edges[ob.edge], A = sim.city.nodes[e.a], B = sim.city.nodes[e.b]; return { x: A.x + (B.x - A.x) * ob.t, y: A.y + (B.y - A.y) * ob.t }; };

/** (G4 §7.5) 통제의 원인 색: 사건 유형색(typeStyle.TYPE_COLOR — 예전에는 renderCity 의 표를 복사해 두었다)과 재난 */
const CAUSE_COLOR = TYPE_COLOR;
export const DISASTER_RING = '#ffb454';
export interface TrafficScreenOpts { timeMs: number; truth: boolean; zs?: number; mini?: boolean }

/** 지도의 화면 좌표계에서, 사건 핀과 부대 표식 아래. 장애물 표식과, 사건·재난으로 통제된 구간의 진입 금지 표시 */
export function drawTrafficScreen(ctx: G, sim: Sim, xf: { scale: number; ox: number; oy: number }, o: TrafficScreenOpts): void {
  if (o.mini) return;
  const city = sim.city, zs = o.zs ?? 1;
  // 사건·재난이 막은 구간(장애물 목록에 없는 통제): 가운데에 진입 금지 표시
  for (const e of city.edges) {
    if (!e.closed || e.closedReason === 'roadwork' || e.closedReason === 'obstacle') continue;
    const A = city.nodes[e.a], B = city.nodes[e.b];
    const mx = ((A.x + B.x) / 2) * xf.scale + xf.ox, my = ((A.y + B.y) / 2) * xf.scale + xf.oy;
    ctx.fillStyle = RED; ctx.beginPath(); ctx.arc(mx, my, 8, 0, 7); ctx.fill(); ctx.fillStyle = '#0b1219'; ctx.fillRect(mx - 5, my - 1.5, 10, 3);
    // (G4 §7.5) 무엇이 막았는가: 사건이 막은 구간은 그 사건의 유형색 테, 재난이 막은 구간은 주황 테
    const by = e.closedReason === 'disaster' ? null : sim.incidents.find((I) => I.blockedEdge === e.id && I.phase !== 'closed');
    const ring = e.closedReason === 'disaster' ? DISASTER_RING : by ? CAUSE_COLOR[by.assessment ? by.assessment.type : o.truth ? by.truth.type : 'unknown'] ?? CAUSE_COLOR.unknown : null;
    if (ring) { ctx.strokeStyle = ring; ctx.lineWidth = 2.2; ctx.beginPath(); ctx.arc(mx, my, 10.2, 0, 7); ctx.stroke(); }
  }
  for (const ob of sim.traffic.obstacles) {
    if (!ob.known && !o.truth) continue;      // 아직 아무도 모르는 것은 관찰자 시점에서만
    const p = obstacleXY(sim, ob);
    drawObstacleMark(ctx, ob.kind, p.x * xf.scale + xf.ox, p.y * xf.scale + xf.oy, 6.5 * zs, ob.known);
  }
}

/** 마우스가 장애물·건널목·열차 가까이 있으면 그 정보 (없으면 null). near = 지도 단위의 반경 */
export function describeTraffic(sim: Sim, wx: number, wy: number, truth: boolean, near: number): { title: string; lines: string[]; color: string; alert: boolean } | null {
  const city = sim.city, tr = sim.traffic;
  for (const ob of tr.obstacles) {
    if (!ob.known && !truth) continue;
    const p = obstacleXY(sim, ob);
    if (Math.hypot(p.x - wx, p.y - wy) > near) continue;
    const left = ob.until - sim.t;
    const lines = [`${edgeName(city, city.edges[ob.edge])} · ${ob.full ? '전면 차단' : ob.heavyOnly ? '큰 차는 지나지 못한다 · 작은 차는 서행' : '한 차로 통제'}${isFinite(left) ? ` · 약 ${fmtSec(Math.max(0, left))} 남음` : ''}`];
    lines.push(ob.known ? (ob.full ? '관제에 알려짐 — 경로가 이 구간을 피한다' : ob.heavyOnly ? '관제에 알려짐 — 큰 차의 경로가 이 골목을 피한다' : '관제에 알려짐 — 지나갈 수 있지만 더디다') : ob.heavyOnly ? '아직 아무도 모른다 — 큰 차가 가 보아야 알려진다' : '아직 아무도 모른다 — 제보가 오거나 부대가 가 보아야 알려진다');
    return { title: ob.label, lines, color: YELLOW, alert: !ob.known };
  }
  for (const c of tr.crossings) {
    const e = city.edges[c.edge], A = city.nodes[e.a], B = city.nodes[e.b], g = e.gateT ?? 0.5;
    if (Math.hypot(A.x + (B.x - A.x) * g - wx, A.y + (B.y - A.y) * g - wy) > near + 4) continue;
    return { title: `${e.name} 건널목`, lines: [c.down ? `차단기 내려감 · 약 ${Math.max(1, Math.round(e.wait ?? 0))}초 뒤 열림` : '차단기 올라감 — 열차가 가까이 오면 내려간다'], color: c.down ? RED : '#e8d6a0', alert: c.down };
  }
  const rail = city.rail ?? [];
  if (rail.length > 1) for (const t of tr.trains) {
    for (let k = 0; k < 3; k++) {
      const s = t.pos - t.dir * (t.len / 6 + (k * t.len) / 3);
      if (s < 0 || s > tr.railLen) continue;
      const p = railAt(rail, s);
      if (Math.hypot(p.x - wx, p.y - wy) > near + 12) continue;
      return { title: '열차', lines: [t.dwell > 0 ? '가온역 정차 중' : `${t.dir > 0 ? '동쪽' : '서쪽'}으로 운행 중 — 지나는 건널목마다 차단기가 내려간다`], color: '#8fb0ff', alert: false };
    }
  }
  return null;
}
