// 지도에 남은 지난 교대의 흔적 (I2 §5.4 — docs/specs/I2-persistence.md). renderCity 의 월드 층에서 drawDisasterWorld 바로 뒤,
// G4·X6 의 drawRuinsWorld 앞(이번 교대의 건물 상태가 그 위에 온다)에 그린다. 읽기만 한다: sim.carryState.places (교대 내내 그대로 — 이어받은 건물 겹침 표).
// 이어받은 상태는 조직이 아는 기록이라 관찰자 시점과 AI 시점에 똑같이 보인다(§5.1).
//   크게 볼 때 (짧은 변이 12화소 이상 — G4 와 같은 기준): 흔적(그을음 얼룩 · 금 · 열린 터의 탄 자리) / X6 의 상태(mark)면 그 그림 —
//     전소 paintBurnt · 구획 붕괴 paintRoofHole('partial') · 폭발 흔적 paintBlasted · 전체 붕괴 paintTotal · 무너짐(mark 없음) paintRoofHole('major').
//     출입 통제·무너짐은 그 위에 노란 점선 울타리, 출입 통제는 지붕 가운데 공사 고깔(REPAIR_MARK). 먼지는 그리지 않는다(지난 일이다)
//   작게 볼 때: 출입 통제 = 공사 고깔 하나, 무너짐 = 무너짐 기호(RUIN_MARK) — 흔적만 남은 건물은 그리지 않는다(작은 얼룩은 읽히지 않는다)

import type { Sim } from '../../sim/engine';
import type { Place, PlaceCarry } from '../../sim/types';
import type { RuinInfo } from '../hazardState';
import { REPAIR_MARK, RUIN_MARK } from '../marks';
import { hash2, shade } from '../scene/common';
import { drawOutlinedMark, local, paintBlasted, paintBurnt, paintRoofHole, paintTotal, ruinOverlayVisible } from './ruinLayer';

/** 복구 공사 울타리와 공사 고깔의 색 (범례가 같은 값을 쓴다) */
export const FENCE = '#e0b83a';
/** 무너진 건물 기호의 색 (G4 의 끝난 붕괴 기호와 같은 흙빛) */
const RUIN_EDGE = '#d6a878';

export interface CarryOpts { scale: number; timeMs: number; mini: boolean; zs?: number }

/** 지붕의 그을음 얼룩 (G4 §7.6 과 같은 틀): 넓이 = 지붕의 clamp(그을음 × 1.07, 0.25, 0.9), 진하기는 그을음에 비례 */
function sootBlob(ctx: CanvasRenderingContext2D, q: Place, soot: number, col: (c: string) => string): void {
  const A = Math.max(0.25, Math.min(0.9, soot * 1.07));
  const sc = Math.min(1, Math.sqrt((4 * A) / Math.PI)), ax = (q.w * sc) / 2, ay = (q.h * sc) / 2;
  const ox = (hash2(q.id, 900) - 0.5) * (q.w - ax * 2) * 0.6, oy = (hash2(q.id, 901) - 0.5) * (q.h - ay * 2) * 0.6;
  ctx.globalAlpha = 0.55 * Math.max(0.4, Math.min(1, soot)); ctx.fillStyle = col('#0e0a08'); ctx.beginPath();
  for (let k = 0; k < 12; k++) {
    const a = (k / 12) * 6.2832, r = 0.8 + 0.3 * hash2(q.id + 17, k);
    const x = Math.max(-q.w / 2, Math.min(q.w / 2, ox + Math.cos(a) * ax * r)), y = Math.max(-q.h / 2, Math.min(q.h / 2, oy + Math.sin(a) * ay * r));
    if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y);
  }
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 1;
}
/** 열린 터(숲·공원·주차장 …)의 탄 자리: 불규칙한 어두운 얼룩 둘셋 */
function burntPatch(ctx: CanvasRenderingContext2D, q: Place, soot: number, col: (c: string) => string): void {
  const n = 2 + (hash2(q.id, 920) > 0.5 ? 1 : 0), m = Math.min(q.w, q.h);
  ctx.fillStyle = col('#1e1610');
  for (let j = 0; j < n; j++) {
    const cx = (hash2(q.id, 930 + j) - 0.5) * q.w * 0.5, cy = (hash2(q.id, 940 + j) - 0.5) * q.h * 0.5, R = m * (0.16 + 0.14 * hash2(q.id, 950 + j)) * (0.7 + 0.6 * soot);
    ctx.globalAlpha = 0.5 * Math.max(0.4, Math.min(1, soot));
    ctx.beginPath();
    for (let k = 0; k < 10; k++) { const a = (k / 10) * 6.2832, r = R * (0.65 + 0.5 * hash2(q.id * 7 + j, k)); if (k) ctx.lineTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); else ctx.moveTo(cx + Math.cos(a) * r, cy + Math.sin(a) * r); }
    ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = 1;
}
/** 구조 손상(dmg ≥ 0.2)의 금: 지붕을 가로지르는 꺾은선 하나 */
function roofCrack(ctx: CanvasRenderingContext2D, q: Place, scale: number, col: (c: string) => string): void {
  const w = q.w, h = q.h, id = q.id;
  ctx.globalAlpha = 0.6; ctx.strokeStyle = col('#0a0806'); ctx.lineWidth = Math.max(0.6, 1.3 / scale); ctx.lineJoin = 'round';
  let x = -w * 0.44, y = (hash2(id, 960) - 0.5) * h * 0.5;
  ctx.beginPath(); ctx.moveTo(x, y);
  for (let k = 0; k < 6; k++) { x += w * 0.15; y = Math.max(-h * 0.45, Math.min(h * 0.45, y + (hash2(id, 970 + k) - 0.5) * h * 0.3)); ctx.lineTo(x, y); }
  ctx.stroke();
  ctx.globalAlpha = 1;
}
/** 지붕: X6 의 상태(mark)가 있으면 그 그림, 없으면 흔적(그을음·금) — 무너짐은 G4 의 무너진 지붕 */
function paintCarryRoof(ctx: CanvasRenderingContext2D, q: Place, p: PlaceCarry, o: CarryOpts, col: (c: string) => string): void {
  if (q.open) { if (p.soot > 0.05) burntPatch(ctx, q, p.soot, col); return; }
  const hole = (level: 'partial' | 'major', frac: number): void => {
    const info: RuinInfo = { frac, u: p.spot ? p.spot[0] : 0.5, v: p.spot ? p.spot[1] : 0.5, level, secondary: 0, lastFall: -Infinity, material: 'concrete' };
    paintRoofHole(ctx, q, info, o.scale, col);
  };
  if (p.mark === 'collapsed') { paintTotal(ctx, q, o.scale, col); return; }
  if (p.mark === 'burnt') { paintBurnt(ctx, q, o.scale, col); return; }
  if (p.state === 'ruin') { if (p.soot > 0.05) sootBlob(ctx, q, p.soot, col); hole('major', 0.3); return; }
  if (p.soot > 0.05) sootBlob(ctx, q, p.soot, col);
  if (p.mark === 'partial') hole('partial', Math.max(0.1, Math.min(0.3, p.dmg / 2)));
  else if (p.mark === 'blasted') paintBlasted(ctx, q, o.scale, col, o.timeMs);
  else if (p.dmg >= 0.2) roofCrack(ctx, q, o.scale, col);
}
/** 복구 공사 울타리: 건물 외곽을 조금 바깥으로 따라가는 노란 점선 */
function fence(ctx: CanvasRenderingContext2D, q: Place, scale: number, col: (c: string) => string): void {
  const d = 1.6 / scale;
  ctx.save();
  ctx.strokeStyle = 'rgba(11,18,25,0.7)'; ctx.lineWidth = 3 / scale; ctx.strokeRect(-q.w / 2 - d, -q.h / 2 - d, q.w + d * 2, q.h + d * 2);
  ctx.strokeStyle = col(FENCE); ctx.lineWidth = 1.6 / scale; ctx.setLineDash([5 / scale, 3.5 / scale]);
  ctx.strokeRect(-q.w / 2 - d, -q.h / 2 - d, q.w + d * 2, q.h + d * 2);
  ctx.restore();
}

/** 월드 층 (drawDisasterWorld 바로 뒤, 같은 변환 안). 작은 지도 창·이어받은 상태가 없는 교대에서는 그리지 않는다 */
export function drawCarryWorld(ctx: CanvasRenderingContext2D, sim: Sim, o: CarryOpts): void {
  const cs = sim.carryState;
  if (o.mini || !cs.on || cs.places.size === 0) return;
  const night = sim.weather === 'night';
  const col = (c: string): string => (night ? shade(c, -0.35) : c);
  const zs = o.zs ?? 1;
  for (const p of cs.places.values()) {
    const q = sim.city.places[p.id];
    const shut = p.state !== 'marked';
    if (ruinOverlayVisible(q, o.scale)) {
      ctx.save(); local(ctx, q);
      // 이번 교대의 건물 상태(X6 placeMarks)가 있는 건물은 그 그림(drawRuinsWorld — 이 층 위)이 지붕을 맡는다. 울타리·고깔은 그대로 얹는다
      if (!sim.placeMarks.has(p.id)) paintCarryRoof(ctx, q, p, o, col);
      if (shut) fence(ctx, q, o.scale, col);
      if (p.state === 'closed') {
        // 고깔: 지붕의 왼쪽 위 안쪽 (가운데는 큰 배율에서 건물 이름표가 앉는다) · 똑바로 선다
        const sz = Math.min(Math.min(q.w, q.h) * 0.5, (15 * zs) / o.scale);
        ctx.translate(-q.w / 2 + sz * 0.62, -q.h / 2 + sz * 0.62);
        if (q.rot) ctx.rotate(-q.rot);
        drawOutlinedMark(ctx, REPAIR_MARK, 0, 0, sz, col(FENCE), 2.6 / o.scale);
      }
      ctx.restore();
    } else if (shut) {
      ctx.save(); ctx.translate(q.x + q.w / 2, q.y + q.h / 2); ctx.globalAlpha = 0.85;
      if (p.state === 'closed') drawOutlinedMark(ctx, REPAIR_MARK, 0, 0, (10 * zs) / o.scale, col(FENCE), 2.6 / o.scale);
      else drawOutlinedMark(ctx, RUIN_MARK[p.mark === 'collapsed' ? 'total' : 'major'], 0, 0, (11 * zs) / o.scale, col(RUIN_EDGE), 2.6 / o.scale);
      ctx.restore();
    }
  }
  ctx.globalAlpha = 1;
}
