// 지도 위의 부대 표식 — 차량 그림 대신 둥근 돌.
// 좁은 도로 위에서도 가려지지 않고, 색(분야)·글자(종류)·테(상태)로 한눈에 구분된다. 현장 화면의 차량 그림과는 별개다.

import type { UnitField, UnitKind } from '../../sim/types';
import { mix, shade } from '../scene/common';

export const FIELD_COLOR: Record<UnitField, string> = { police: '#3f7fd0', fire: '#d8503a', rescue: '#2fae7a', special: '#8f6fd0' };
/** 종류를 나타내는 한 글자 */
export const KIND_GLYPH: Record<UnitKind, string> = { patrol: '순', tactical: '기', swat: '특', eod: '폭', engine: '진', ladder: '사', rescue: '조', als: '급', bls: '급', hazmat: '화', heli: '헬', boat: '정' };

export interface TokenOpts {
  field: UnitField; kind: UnitKind; state: string; no: string; timeMs: number; font: string;
  angle?: number; selected?: boolean; mini?: boolean;
}

function stone(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, col: string, rim: string): void {
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.42, r * 0.08, x, y, r);
  g.addColorStop(0, mix(col, '#ffffff', 0.5)); g.addColorStop(0.5, col); g.addColorStop(1, shade(col, -0.34));
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = rim; ctx.lineWidth = Math.max(1, r * 0.16); ctx.beginPath(); ctx.arc(x, y, r - ctx.lineWidth / 2, 0, 6.2832); ctx.stroke();
}

/** 부대 한 팀의 표식 */
export function drawToken(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, o: TokenOpts): void {
  const col = FIELD_COLOR[o.field];
  if (o.mini) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 6.2832); ctx.fill(); return; }
  const moving = o.state === 'enroute' || o.state === 'transport' || o.state === 'returning';
  const flying = o.kind === 'heli' && o.state !== 'available' && o.state !== 'oos';
  ctx.save();
  ctx.globalAlpha = o.state === 'oos' ? 0.4 : o.state === 'returning' ? 0.6 : o.state === 'available' ? 0.85 : 1;
  // 그림자: 헬기는 떠 있으므로 멀리 떨어진다
  ctx.fillStyle = flying ? 'rgba(0,0,0,0.28)' : 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(x + (flying ? r * 0.9 : 1.2), y + (flying ? r * 1.2 : 1.9), r * (flying ? 0.92 : 1), 0, 6.2832); ctx.fill();
  // 구조정의 물결
  if (o.kind === 'boat' && moving) { const a = (o.angle ?? 0) + Math.PI; ctx.strokeStyle = 'rgba(235,245,248,0.55)'; ctx.lineWidth = 1.4; for (const k of [0.5, -0.5]) { ctx.beginPath(); ctx.moveTo(x + Math.cos(a + k) * r, y + Math.sin(a + k) * r); ctx.lineTo(x + Math.cos(a + k * 0.7) * r * 2.3, y + Math.sin(a + k * 0.7) * r * 2.3); ctx.stroke(); } }
  stone(ctx, x, y, r, col, o.kind === 'als' || o.kind === 'bls' ? 'rgba(255,255,255,0.95)' : o.kind === 'rescue' ? '#ffb454' : 'rgba(255,255,255,0.5)');
  ctx.font = `800 ${Math.round(r * 1.12)}px ${o.font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillText(KIND_GLYPH[o.kind], x + 0.6, y + 1.2);
  ctx.fillStyle = '#ffffff'; ctx.fillText(KIND_GLYPH[o.kind], x, y + 0.6);
  // 같은 종류를 가리는 번호
  if (o.no) { const br = r * 0.44; ctx.fillStyle = '#0b1219'; ctx.beginPath(); ctx.arc(x + r * 0.78, y + r * 0.78, br, 0, 6.2832); ctx.fill(); ctx.fillStyle = '#e8f0f7'; ctx.font = `800 ${Math.round(br * 1.6)}px ${o.font}`; ctx.fillText(o.no, x + r * 0.78, y + r * 0.78 + 0.5); }
  ctx.globalAlpha = 1;
  // 상태를 나타내는 테
  if (o.state === 'enroute') { ctx.strokeStyle = mix(col, '#ffffff', 0.45); ctx.lineWidth = 1.8; ctx.setLineDash([4, 3.4]); ctx.lineDashOffset = -(o.timeMs / 45) % 7.4; ctx.beginPath(); ctx.arc(x, y, r + 3.4, 0, 6.2832); ctx.stroke(); ctx.setLineDash([]); }
  else if (o.state === 'onscene') { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, 6.2832); ctx.stroke(); }
  else if (o.state === 'transport' || o.state === 'hospital') { ctx.strokeStyle = '#5ad17a'; ctx.lineWidth = 1.8; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, 6.2832); ctx.stroke(); ctx.fillStyle = '#5ad17a'; ctx.fillRect(x - r - 5.5, y - r - 2.4, 6, 1.8); ctx.fillRect(x - r - 3.4, y - r - 4.5, 1.8, 6); }
  // 헬기의 회전 날개
  if (o.kind === 'heli') { const a = flying ? (o.timeMs / 70) % 6.2832 : 0.6; ctx.strokeStyle = 'rgba(235,240,245,0.85)'; ctx.lineWidth = 1.6; for (let k = 0; k < 2; k++) { ctx.beginPath(); ctx.arc(x, y, r + (flying ? 5.6 : 2.2), a + k * Math.PI, a + k * Math.PI + 1.5); ctx.stroke(); } }
  if (o.selected) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(x, y, r + 7, 0, 6.2832); ctx.stroke(); }
  ctx.restore();
}

/** 달아나는 차량: 빨간 돌과 퍼지는 고리 */
export function drawFugitive(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, glyph: string, timeMs: number, font: string): void {
  const ph = (timeMs / 700) % 1;
  ctx.strokeStyle = `rgba(255,93,93,${0.8 * (1 - ph)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r * (1.2 + ph * 1.6), 0, 6.2832); ctx.stroke();
  ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(x + 1.2, y + 1.9, r, 0, 6.2832); ctx.fill();
  stone(ctx, x, y, r, '#c9362f', 'rgba(255,220,220,0.9)');
  ctx.font = `800 ${Math.round(r * 1.12)}px ${font}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = '#ffffff'; ctx.fillText(glyph, x, y + 0.6);
}
