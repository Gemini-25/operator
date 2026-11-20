// 지도 위의 표식 — 차량 그림 대신 둥근 돌, 시설은 둥근 모서리의 네모.
// 모양으로 먼저 가린다: 원 = 부대, 네모 = 시설, 고리 달린 큰 핀 = 사건.
// 부대의 돌은 색(분야) · 흰 기호(종류, `view/marks.ts`) · 아래쪽 점(같은 종류 안의 번호) · 테(상태)로 읽는다. 글자는 쓰지 않는다.
// 좁은 도로 위에서도 가려지지 않는다. 현장 화면의 차량 그림과는 별개다.

import { AIR_KIND } from '../../sim/crews';
import type { Unit, UnitField, UnitKind } from '../../sim/types';
import { FACILITY_MARK, STATE_MARK, UNIT_MARK, drawMark } from '../marks';
import { mix, shade } from '../scene/common';

/** 돌의 바탕색 (흰 기호와의 명암비 3.5:1 이상) */
export const FIELD_COLOR: Record<UnitField, string> = { police: '#3f7fd0', fire: '#d8503a', rescue: '#23996b', special: '#8f6fd0', civil: '#a37c12' };      // civil (N8): 황토 — 흰 기호와의 명암비 3.9:1
/** 어두운 바탕 위에 글자·선으로 쓸 때의 밝은 분야색 */
export const FIELD_TEXT: Record<UnitField, string> = { police: '#7db9ff', fire: '#ff8f66', rescue: '#4fd9a6', special: '#c9a2ff', civil: '#e6c14e' };
/** 부대의 화면 분야: 편성표 부대는 u.field, 분야가 없는 인근 도시 지원 부대는 부서로 짐작한다 (동물 포획팀은 소방 부서지만 특수 분야 — N8) */
export function unitField(u: Unit): UnitField { return u.field ?? (u.dept === 'police' ? 'police' : u.dept === 'ems' ? 'rescue' : u.dept === 'civil' ? 'civil' : u.kind === 'animalCtl' || u.kind === 'deconUnit' ? 'special' : 'fire'); }      // (N9) 지원 제독차도 특수
/** 상태 테의 색 (출동은 분야색을 밝힌 점선이라 여기에 없다) */
export const STATE_RING = { onscene: '#ffd166', transport: '#5ad17a' };
/** 시설 배지의 색 */
export const FACILITY_COLOR: Record<string, string> = { fireStation: '#ff7a45', police: '#5aa9ff', hospital: '#2fd39a', public: '#9fb0c0', heliport: '#ff7a45', harbor: '#ff7a45' };
/** 돌의 지름에 대한 기호의 크기 */
export const MARK_RATIO = 0.62;

export interface TokenOpts {
  field: UnitField; kind: UnitKind; state: string; timeMs: number;
  /** 같은 종류를 가리는 번호 (호출부호 끝의 숫자). 숫자 대신 아래쪽 테두리를 따라 점 n개(1~5)로 그린다 */
  no?: number;
  angle?: number; selected?: boolean; mini?: boolean;
}

function stone(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, rim: string): void {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.42, r * 0.08, x, y, r);
  g.addColorStop(0, mix(col, '#ffffff', 0.42)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, -0.36));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = rim; ctx.lineWidth = Math.max(1, r * 0.11); ctx.beginPath(); ctx.arc(x, y, r - ctx.lineWidth / 2, 0, 6.2832); ctx.stroke();
}

/** 부대 한 팀의 표식 */
export function drawToken(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, o: TokenOpts): void {
  const col = FIELD_COLOR[o.field];
  if (o.mini) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); return; }
  const moving = o.state === 'enroute' || o.state === 'transport' || o.state === 'returning';
  const flying = AIR_KIND.has(o.kind) && o.state !== 'available' && o.state !== 'oos';      // 헬기 세 종류 (TokenOpts 에는 부대의 air 칸이 없다 — 종류로 본다)
  const n = Math.max(0, Math.min(5, Math.round(o.no ?? 0)));
  const lw = Math.max(1.5, r * 0.19), gap = lw * 0.5 + r * 0.16;      // 테의 굵기와 돌에서 떨어진 거리: 돌 크기에 비례
  ctx.save();
  ctx.globalAlpha = o.state === 'oos' ? 0.4 : o.state === 'returning' ? 0.6 : o.state === 'available' ? 0.88 : 1;
  // 그림자: 헬기는 떠 있으므로 멀리 떨어진다
  ctx.fillStyle = flying ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(x + (flying ? r * 0.9 : r * 0.13), y + (flying ? r * 1.2 : r * 0.21), r * (flying ? 0.92 : 1.02), 0, 6.2832); ctx.fill();
  // 구조정의 물결
  if (o.kind === 'boat' && moving) { const a = (o.angle ?? 0) + Math.PI; ctx.strokeStyle = 'rgba(235,245,248,0.55)'; ctx.lineWidth = Math.max(1.2, r * 0.15); for (const k of [0.5, -0.5]) { ctx.beginPath(); ctx.moveTo(x + Math.cos(a + k) * r, y + Math.sin(a + k) * r); ctx.lineTo(x + Math.cos(a + k * 0.7) * r * 2.3, y + Math.sin(a + k * 0.7) * r * 2.3); ctx.stroke(); } }
  stone(ctx, x, y, r, col, 'rgba(255,255,255,0.55)');
  // 종류를 나타내는 기호 (아래에 옅은 그림자). 번호 점이 있으면 조금 올려 그린다
  const ms = r * 2 * MARK_RATIO, my = y - (n ? r * 0.07 : 0);
  drawMark(ctx, UNIT_MARK[o.kind], x + r * 0.05, my + r * 0.1, ms, 'rgba(0,0,0,0.3)');
  drawMark(ctx, UNIT_MARK[o.kind], x, my, ms, '#ffffff');
  // 같은 종류를 가리는 번호: 아래쪽 테두리를 따라 흰 점
  if (n) {
    const dr = Math.max(1.1, r * 0.115), rr = r * 0.76;
    for (let k = 0; k < n; k++) {
      const a = Math.PI / 2 + (k - (n - 1) / 2) * 0.4, dx = x + Math.cos(a) * rr, dy = y + Math.sin(a) * rr;
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.beginPath(); ctx.arc(dx, dy + 0.5, dr + 0.5, 0, 6.2832); ctx.fill();
      ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(dx, dy, dr, 0, 6.2832); ctx.fill();
    }
  }
  ctx.globalAlpha = 1;
  // 상태를 나타내는 테: 출동 = 도는 점선, 출동 준비 = 멈춘 점선, 현장 = 노란 실선, 이송 = 초록 실선 + 십자
  ctx.lineWidth = lw;
  if (o.state === 'enroute' || o.state === 'turnout') {
    const d0 = r * 0.46, d1 = r * 0.38;
    ctx.strokeStyle = mix(col, '#ffffff', 0.5); ctx.globalAlpha = o.state === 'turnout' ? 0.6 : 1; ctx.setLineDash([d0, d1]); ctx.lineDashOffset = o.state === 'turnout' ? 0 : -(o.timeMs / 45) % (d0 + d1);
    ctx.beginPath(); ctx.arc(x, y, r + gap, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  } else if (o.state === 'onscene') { ctx.strokeStyle = STATE_RING.onscene; ctx.beginPath(); ctx.arc(x, y, r + gap, 0, 6.2832); ctx.stroke(); }
  else if (o.state === 'transport' || o.state === 'hospital') {
    ctx.strokeStyle = STATE_RING.transport; ctx.beginPath(); ctx.arc(x, y, r + gap, 0, 6.2832); ctx.stroke();
    const bx = x - (r + gap) * 0.74, by = y - (r + gap) * 0.74, br = Math.max(4.2, r * 0.5);
    ctx.fillStyle = '#0b1219'; ctx.beginPath(); ctx.arc(bx, by, br, 0, 6.2832); ctx.fill();
    drawMark(ctx, STATE_MARK.transport, bx, by, br * 1.36, STATE_RING.transport);
  }
  // 헬기의 회전 날개
  if (AIR_KIND.has(o.kind)) { const a = flying ? (o.timeMs / 70) % 6.2832 : 0.6; ctx.strokeStyle = 'rgba(235,240,245,0.85)'; ctx.lineWidth = Math.max(1.4, r * 0.16); for (let k = 0; k < 2; k++) { ctx.beginPath(); ctx.arc(x, y, r + (flying ? gap + lw + r * 0.26 : r * 0.24), a + k * Math.PI, a + k * Math.PI + 1.5); ctx.stroke(); } }
  if (o.selected) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r + gap + lw + r * 0.3, 0, 6.2832); ctx.stroke(); }
  ctx.restore();
}

/** 달아나는 차량: 빨간 돌 + 차량 기호 + 퍼지는 고리 */
export function drawFugitive(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, timeMs: number): void {
  const ph = (timeMs / 700) % 1;
  ctx.strokeStyle = `rgba(255,93,93,${0.8 * (1 - ph)})`; ctx.lineWidth = Math.max(1.5, r * 0.19); ctx.beginPath(); ctx.arc(x, y, r * (1.2 + ph * 1.6), 0, 6.2832); ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(x + r * 0.13, y + r * 0.21, r * 1.02, 0, 6.2832); ctx.fill();
  stone(ctx, x, y, r, '#c9362f', 'rgba(255,220,220,0.9)');
  const ms = r * 2 * 0.66;
  drawMark(ctx, STATE_MARK.fugitive, x + r * 0.05, y + r * 0.1, ms, 'rgba(0,0,0,0.3)');
  drawMark(ctx, STATE_MARK.fugitive, x, y, ms, '#ffffff');
}

/** 시설 배지: 둥근 모서리의 네모 안에 시설 기호 (x, y 는 가운데, s 는 한 변) */
export function drawFacilityBadge(ctx: CanvasRenderingContext2D, x: number, y: number, s: number, key: string, col: string): void {
  const lw = Math.max(1.5, s * 0.09), rr = s * 0.26;
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.roundRect(x - s / 2 + s * 0.07, y - s / 2 + s * 0.11, s, s, rr); ctx.fill();
  ctx.fillStyle = '#0d151d'; ctx.beginPath(); ctx.roundRect(x - s / 2, y - s / 2, s, s, rr); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = lw; ctx.beginPath(); ctx.roundRect(x - s / 2 + lw / 2, y - s / 2 + lw / 2, s - lw, s - lw, rr - lw / 2); ctx.stroke();
  drawMark(ctx, FACILITY_MARK[key] ?? FACILITY_MARK.public, x, y, s * 0.64, col);
}

export interface Box { x0: number; y0: number; x1: number; y1: number }
const overlap = (a: Box, b: Box): boolean => a.x0 < b.x1 && a.x1 > b.x0 && a.y0 < b.y1 && a.y1 > b.y0;
/**
 * 배지(가운데 x·y, 반 크기 half) 곁에 w×h 이름표를 둘 자리.
 * 오른쪽 → 왼쪽 → 아래 → 위 가운데, 이미 놓인 상자들과 겹치지 않는 첫 자리(모두 겹치면 오른쪽). side: 0 오른쪽 · 1 왼쪽 · 2 아래 · 3 위
 */
export function placeLabel(taken: Box[], x: number, y: number, half: number, w: number, h: number, gap = 4): Box & { side: number } {
  const c: Box[] = [
    { x0: x + half + gap, y0: y - h / 2, x1: x + half + gap + w, y1: y + h / 2 },
    { x0: x - half - gap - w, y0: y - h / 2, x1: x - half - gap, y1: y + h / 2 },
    { x0: x - w / 2, y0: y + half + gap, x1: x + w / 2, y1: y + half + gap + h },
    { x0: x - w / 2, y0: y - half - gap - h, x1: x + w / 2, y1: y - half - gap },
  ];
  for (let k = 0; k < 4; k++) if (!taken.some((b) => overlap(b, c[k]))) return { ...c[k], side: k };
  return { ...c[0], side: 0 };
}
