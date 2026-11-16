// 지도의 무너진 건물 (docs/specs/G4-scene-legibility.md §5). renderCity 가 부른다.
//   drawRuinsWorld: 월드 좌표(건물 크기) — 크게 볼 때 지붕의 구멍·잔해·금·먼지, 크레인의 쓰러진 팔. 무너지는 순간 건물 위로 피는 먼지(배율과 무관)
//   drawRuinBadge : 화면 좌표 — 진행 중인 사건 핀의 왼쪽 아래 배지(확인 = 실선, 신고 = 점선), 2차 붕괴 때 퍼지는 흙빛 고리
//   ruinGlyphAt   : 화면 좌표 — 끝난 붕괴가 교대 끝까지 남는 기호(작게 볼 때)
// 과장(§2.2): 지붕 구멍의 넓이는 실제 몫의 약 두 배, 'major' 의 외곽 틈. 상태(진실 또는 시점 규칙 — hazardState.ruinSeen)만 읽는다.

import type { Sim } from '../../sim/engine';
import type { Incident, Place } from '../../sim/types';
import { ruinInfo, ruinMark, ruinSeen, seenSecondary } from '../hazardState';
import type { RuinInfo } from '../hazardState';
import { RUIN_MARK } from '../marks';
import { hash2, shade } from '../scene/common';

const EDGE = '#d6a878';
const RUBBLE = ['#57524b', '#6a645b', '#8d867a', '#a59d90', '#b3aa9a'];
/** 건물 칸 크기의 기준: 짧은 변이 이만큼(화소) 보이면 덧그림, 아니면 기호 */
const OVERLAY_PX = 12;
/** 끝난 붕괴 기호의 크기(화소, × 표식 배율). 설계서는 11 — 배율 1 의 지도에서 잘 안 보여 15 로 키웠다 */
export const GLYPH = 15;

/** 덧그림을 그릴 만큼 크게 보이는가 */
export const ruinOverlayVisible = (q: Place, scale: number): boolean => Math.min(q.w, q.h) * scale >= OVERLAY_PX;

/** 건물의 회전 좌표계 (staticCity.ts 의 local() 과 같은 세 줄 — 그 파일은 고치지 않는다) */
function local(ctx: CanvasRenderingContext2D, q: Place): void {
  ctx.translate(q.x + q.w / 2, q.y + q.h / 2);
  if (q.rot) ctx.rotate(q.rot);
}

/** 들쭉날쭉한 조각 (월드 좌표) */
function chunk(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, seed: number, col: string): void {
  ctx.fillStyle = col; ctx.beginPath();
  for (let v = 0; v < 5; v++) { const a = (v / 5) * 6.2832 + hash2(seed, 1) * 3, rad = r * (0.6 + 0.5 * hash2(seed, v + 2)); if (v) ctx.lineTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); else ctx.moveTo(x + Math.cos(a) * rad, y + Math.sin(a) * rad); }
  ctx.closePath(); ctx.fill();
}

interface WorldOpts { truth: boolean; timeMs: number; scale: number; mini: boolean }
/** 월드 층 (drawDisasterWorld 바로 뒤, 같은 변환 안). 작은 지도 창에서는 그리지 않는다 */
export function drawRuinsWorld(ctx: CanvasRenderingContext2D, sim: Sim, o: WorldOpts): void {
  if (o.mini) return;
  const night = sim.weather === 'night';
  const col = (c: string): string => (night ? shade(c, -0.35) : c);
  for (const I of sim.incidents) {
    if (I.truth.placeId < 0) continue;
    // (X6 §7.2) 건물 상태(placeMarks)를 남긴 사건도 — 붕괴 유형이 아니어도. 상태가 없는 끝난 화재는 G4 의 그을린 지붕
    const seen = I.truth.type === 'collapse' || I.truth.type === 'fire' || sim.placeMarks.size ? ruinSeen(sim, I, o.truth) : 'none';
    const info = seen === 'confirmed' ? ruinInfo(sim, I) : null;
    const closedFire = I.truth.type === 'fire' && I.phase === 'closed';
    if (!info) { if (closedFire) paintScorchedRoof(ctx, sim, I, o.truth, o.scale, col); continue; }
    if (closedFire && info.level !== 'burnt' && info.level !== 'total') paintScorchedRoof(ctx, sim, I, o.truth, o.scale, col);      // 그을림 위에 무너진 모습
    if (info.level === 'scorched') continue;
    const q = sim.city.places[I.truth.placeId];
    const faint = o.truth && I.phase === 'unreported' ? 0.55 : 1;
    ctx.save();
    local(ctx, q);
    if (ruinOverlayVisible(q, o.scale)) {
      ctx.globalAlpha = faint;
      const fell = info.level !== 'burnt' && info.level !== 'blasted';
      if (info.level === 'total') paintTotal(ctx, q, o.scale, col);
      else if (info.level === 'burnt') paintBurnt(ctx, q, o.scale, col);
      else if (info.level === 'blasted') paintBlasted(ctx, q, o.scale, col, o.timeMs);
      else if (info.material === 'crane') paintCrane(ctx, q, o.scale, col); else paintRoofHole(ctx, q, info, o.scale, col);
      // 먼지: 마지막 무너짐 뒤 90초 동안 0.3 → 0.08, 그 뒤 0.08 로 남는다 (무너진 것만)
      if (fell) {
        const age = sim.t - info.lastFall, a = age < 90 ? 0.3 - 0.22 * (age / 90) : 0.08;
        ctx.globalAlpha = faint * a; ctx.fillStyle = col('#c4b292');
        ctx.beginPath(); ctx.arc(0, 0, 0.9 * Math.max(q.w, q.h), 0, 6.2832); ctx.fill();
      }
    }
    // 무너지는 순간: 무너짐마다 6초 동안 건물 위로 먼지가 핀다 (배율과 무관하게). AI 시점은 첫 도착 뒤의 것만
    const s = sim.scenes[I.id];
    if (s && s.falls) for (const f of s.falls) {
      const age = sim.t - f.t;
      if (age < 0 || age >= 6) continue;
      if (!o.truth && (I.firstArrivalAt < 0 || f.t < I.firstArrivalAt)) continue;
      const k = age / 6, R = Math.max(Math.max(q.w, q.h) * (0.6 + 0.4 * k), 10 / o.scale);
      ctx.globalAlpha = faint * 0.45 * (1 - k); ctx.fillStyle = col('#c4b292');
      ctx.beginPath(); ctx.arc(0, 0, R, 0, 6.2832); ctx.fill();
    }
    ctx.restore();
  }
  ctx.globalAlpha = 1;
}

/** 내려앉은 지붕: 구멍(과장된 넓이) · 구멍 속 잔해와 기울어진 지붕 판 · 윤곽 밖으로 쏟아진 잔해 · 지붕의 금 · 'major' 의 외곽 틈 */
function paintRoofHole(ctx: CanvasRenderingContext2D, q: Place, r: RuinInfo, scale: number, col: (c: string) => string): void {
  const w = q.w, h = q.h, base = ctx.globalAlpha;
  const A = Math.max(0.3, Math.min(0.85, r.frac * 2.2));      // 지붕 넓이에 대한 구멍의 몫 (과장: 실제의 약 두 배)
  const sc = Math.min(0.96, Math.sqrt((4 * A) / Math.PI));      // 타원 축 비율 (지붕 밖으로 나가지 않게)
  const ax = (w * sc) / 2, ay = (h * sc) / 2;
  const hx = Math.max(-w / 2 + ax, Math.min(w / 2 - ax, (r.u - 0.5) * w)), hy = Math.max(-h / 2 + ay, Math.min(h / 2 - ay, (r.v - 0.5) * h));
  const id = q.id;
  // 'major': 구멍에 가장 가까운 외곽선 한 변을 따라 어두운 틈 (외곽이 무너졌다 — 과장)
  if (r.level !== 'partial') {
    const dl = hx + w / 2, dr = w / 2 - hx, dt = hy + h / 2, db = h / 2 - hy, m = Math.min(dl, dr, dt, db);
    const th = Math.max(1.2 / scale, Math.min(w, h) * 0.07);
    ctx.globalAlpha = base * 0.7; ctx.fillStyle = col('#100c09'); ctx.beginPath();
    const n = 7;
    if (m === dl || m === dr) {
      const x = m === dl ? -w / 2 : w / 2, dir = m === dl ? 1 : -1, y0 = hy - ay * 1.1, y1 = hy + ay * 1.1;
      ctx.moveTo(x, y0); for (let k = 0; k <= n; k++) ctx.lineTo(x + dir * th * (0.4 + 0.8 * hash2(id, 40 + k)), y0 + ((y1 - y0) * k) / n); ctx.lineTo(x, y1);
    } else {
      const y = m === dt ? -h / 2 : h / 2, dir = m === dt ? 1 : -1, x0 = hx - ax * 1.1, x1 = hx + ax * 1.1;
      ctx.moveTo(x0, y); for (let k = 0; k <= n; k++) ctx.lineTo(x0 + ((x1 - x0) * k) / n, y + dir * th * (0.4 + 0.8 * hash2(id, 50 + k))); ctx.lineTo(x1, y);
    }
    ctx.closePath(); ctx.fill();
  }
  // 1) 구멍: 들쭉날쭉한 14각형
  const pts: [number, number][] = [];
  for (let k = 0; k < 14; k++) { const a = (k / 14) * 6.2832, rr = 0.8 + 0.28 * hash2(id, k); pts.push([hx + Math.cos(a) * ax * rr, hy + Math.sin(a) * ay * rr]); }
  ctx.globalAlpha = base * 0.62; ctx.fillStyle = col('#100c09');
  ctx.beginPath(); pts.forEach(([x, y], k) => (k ? ctx.lineTo(x, y) : ctx.moveTo(x, y))); ctx.closePath(); ctx.fill();
  // 2) 구멍 속 잔해 + 가장자리의 기울어진 지붕 판
  ctx.globalAlpha = base;
  const nIn = 10 + Math.floor(hash2(id, 60) * 9), cr = Math.min(w, h) * 0.07;
  for (let k = 0; k < nIn; k++) { const a = hash2(id, 70 + k) * 6.2832, d = Math.sqrt(hash2(id, 90 + k)) * 0.75; chunk(ctx, hx + Math.cos(a) * ax * d, hy + Math.sin(a) * ay * d, cr * (0.5 + 0.7 * hash2(id, 110 + k)), id * 31 + k, col(RUBBLE[k % RUBBLE.length])); }
  const nP = 3 + (hash2(id, 130) > 0.5 ? 1 : 0);
  for (let k = 0; k < nP; k++) {
    const a = (k / nP) * 6.2832 + hash2(id, 131) * 2, px = hx + Math.cos(a) * ax * 0.78, py = hy + Math.sin(a) * ay * 0.78;
    ctx.save(); ctx.translate(px, py); ctx.rotate(a + Math.PI / 2 + (hash2(id, 140 + k) - 0.5) * 0.8);
    const pw = Math.min(w, h) * (0.22 + 0.1 * hash2(id, 150 + k)), ph = Math.min(w, h) * 0.08;
    ctx.globalAlpha = base * 0.9; ctx.fillStyle = col('#78746c'); ctx.fillRect(-pw / 2, -ph / 2, pw, ph);
    ctx.fillStyle = col('#a8a398'); ctx.fillRect(-pw / 2, -ph / 2, pw, ph * 0.28);
    ctx.restore();
  }
  // 3) 쏟아진 잔해: 건물 가운데에서 구멍 쪽으로, 외벽 밖 0.25·max(w, h) 안
  {
    let dx = hx, dy = hy; const L = Math.hypot(dx, dy);
    if (L < 1e-3) { const a = hash2(id, 160) * 6.2832; dx = Math.cos(a); dy = Math.sin(a); } else { dx /= L; dy /= L; }
    const t = Math.min(Math.abs(dx) > 1e-6 ? w / 2 / Math.abs(dx) : Infinity, Math.abs(dy) > 1e-6 ? h / 2 / Math.abs(dy) : Infinity);
    const nS = 5 + Math.floor(hash2(id, 161) * 4), M = Math.max(w, h);
    ctx.globalAlpha = base;
    for (let k = 0; k < nS; k++) {
      const d = t + 0.02 * M + 0.23 * M * hash2(id, 170 + k), side = (hash2(id, 180 + k) - 0.5) * 0.5 * M;
      chunk(ctx, dx * d - dy * side * (1 - d / (t + 0.25 * M)), dy * d + dx * side * (1 - d / (t + 0.25 * M)), cr * (0.45 + 0.6 * hash2(id, 190 + k)), id * 17 + k, col(RUBBLE[(k + 2) % RUBBLE.length]));
    }
  }
  // 4) 지붕의 금: 구멍에서 지붕을 가로지르는 꺾은선 둘
  ctx.globalAlpha = base * 0.55; ctx.strokeStyle = col('#0a0806'); ctx.lineWidth = Math.max(0.8, 1.2 / scale); ctx.lineJoin = 'round';
  for (let k = 0; k < 2; k++) {
    const a = hash2(id, 200 + k) * 6.2832;
    let x = hx + Math.cos(a) * ax * 0.95, y = hy + Math.sin(a) * ay * 0.95;
    ctx.beginPath(); ctx.moveTo(x, y);
    for (let j = 0; j < 4; j++) {
      x += Math.cos(a + (hash2(id, 210 + k * 5 + j) - 0.5) * 1.2) * Math.min(w, h) * 0.14; y += Math.sin(a + (hash2(id, 220 + k * 5 + j) - 0.5) * 1.2) * Math.min(w, h) * 0.14;
      x = Math.max(-w / 2, Math.min(w / 2, x)); y = Math.max(-h / 2, Math.min(h / 2, y));
      ctx.lineTo(x, y);
    }
    ctx.stroke();
  }
  ctx.globalAlpha = base;
}

/**
 * (선택 §7.6) 끝난 화재 사건의 그을린 지붕: 넓이 = 지붕의 clamp(탄 칸 / 탈 수 있는 칸 × 1.6, 0.25, 0.9). AI 시점은 도착했던 사건만.
 * 크게 볼 때만 (붕괴 덧그림과 같은 틀)
 */
function paintScorchedRoof(ctx: CanvasRenderingContext2D, sim: Sim, I: Incident, truth: boolean, scale: number, col: (c: string) => string): void {
  const s = sim.scenes[I.id];
  if (!s || s.burnedTiles <= 0 || s.totalFuelTiles <= 0 || (!truth && I.firstArrivalAt < 0)) return;
  const q = sim.city.places[I.truth.placeId];
  if (!ruinOverlayVisible(q, scale)) return;
  const A = Math.max(0.25, Math.min(0.9, (s.burnedTiles / s.totalFuelTiles) * 1.6));
  const sc = Math.min(1, Math.sqrt((4 * A) / Math.PI)), ax = (q.w * sc) / 2, ay = (q.h * sc) / 2;
  ctx.save(); local(ctx, q);
  ctx.globalAlpha = 0.55; ctx.fillStyle = col('#0e0a08'); ctx.beginPath();
  for (let k = 0; k < 12; k++) { const a = (k / 12) * 6.2832, r = 0.8 + 0.3 * hash2(q.id + 7, k); const x = Math.max(-q.w / 2, Math.min(q.w / 2, Math.cos(a) * ax * r)), y = Math.max(-q.h / 2, Math.min(q.h / 2, Math.sin(a) * ay * r)); if (k) ctx.lineTo(x, y); else ctx.moveTo(x, y); }
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = 0.45;
  for (let k = 0; k < 4; k++) { const a = hash2(q.id, 300 + k) * 6.2832, d = 0.5 * hash2(q.id, 310 + k); ctx.beginPath(); ctx.arc(Math.cos(a) * ax * d, Math.sin(a) * ay * d, Math.min(q.w, q.h) * (0.06 + 0.06 * hash2(q.id, 320 + k)), 0, 6.2832); ctx.fill(); }
  ctx.restore();
}

/** (X6 §7.2) 전체 붕괴: 지붕 대신 건물 윤곽 전체가 잔해 더미 — 지붕을 덮는 잔해 바탕, 조각을 붕괴 덧그림의 두 배쯤, 끊긴 외곽선, 둘레로 쏟아진 조각 */
function paintTotal(ctx: CanvasRenderingContext2D, q: Place, scale: number, col: (c: string) => string): void {
  const w = q.w, h = q.h, M = Math.max(w, h), m = Math.min(w, h), id = q.id, base = ctx.globalAlpha;
  ctx.globalAlpha = base * 0.92; ctx.fillStyle = col('#5d574f');
  ctx.beginPath();      // 바탕: 윤곽보다 조금 들쭉날쭉하게
  for (let k = 0; k < 16; k++) { const a = (k / 16) * 6.2832, ex = Math.cos(a), ey = Math.sin(a), t = Math.min(Math.abs(ex) > 1e-6 ? w / 2 / Math.abs(ex) : Infinity, Math.abs(ey) > 1e-6 ? h / 2 / Math.abs(ey) : Infinity) * (0.92 + 0.14 * hash2(id, 400 + k)); if (k) ctx.lineTo(ex * t, ey * t); else ctx.moveTo(ex * t, ey * t); }
  ctx.closePath(); ctx.fill();
  ctx.globalAlpha = base;
  const n = 2 * (10 + Math.floor(hash2(id, 410) * 9)), cr = m * 0.075;
  for (let k = 0; k < n; k++) chunk(ctx, (hash2(id, 420 + k) - 0.5) * w * 0.94, (hash2(id, 460 + k) - 0.5) * h * 0.94, cr * (0.55 + 0.8 * hash2(id, 500 + k)), id * 41 + k, col(RUBBLE[k % RUBBLE.length]));
  for (let k = 0; k < 8; k++) { const a = hash2(id, 540 + k) * 6.2832, d = 0.5 + 0.18 * hash2(id, 550 + k); chunk(ctx, Math.cos(a) * w * d, Math.sin(a) * h * d, cr * (0.4 + 0.5 * hash2(id, 560 + k)), id * 43 + k, col(RUBBLE[(k + 1) % RUBBLE.length])); }
  // 끊긴 외곽선: 남은 벽 그루터기
  ctx.globalAlpha = base * 0.8; ctx.strokeStyle = col('#2a2622'); ctx.lineWidth = Math.max(1, 1.6 / scale); ctx.setLineDash([M * 0.09, M * 0.07]);
  ctx.strokeRect(-w / 2, -h / 2, w, h); ctx.setLineDash([]);
  ctx.globalAlpha = base;
}
/** (X6 §7.2) 전소: 지붕 전체 그을음 + 뚫린 구멍 두셋(속에 탄 잔해) + 타다 남은 들보. 밤에도 창 불빛이 비치지 않게 덮는다 */
function paintBurnt(ctx: CanvasRenderingContext2D, q: Place, scale: number, col: (c: string) => string): void {
  const w = q.w, h = q.h, m = Math.min(w, h), id = q.id, base = ctx.globalAlpha;
  ctx.globalAlpha = base * 0.7; ctx.fillStyle = col('#0e0a08'); ctx.fillRect(-w / 2, -h / 2, w, h);
  const nH = 2 + (hash2(id, 600) > 0.5 ? 1 : 0);
  for (let k = 0; k < nH; k++) {
    const hx = (hash2(id, 610 + k) - 0.5) * w * 0.6, hy = (hash2(id, 620 + k) - 0.5) * h * 0.6, rx = m * (0.14 + 0.08 * hash2(id, 630 + k)), ry = rx * (0.7 + 0.4 * hash2(id, 640 + k));
    ctx.globalAlpha = base * 0.85; ctx.fillStyle = col('#050302'); ctx.beginPath(); ctx.ellipse(hx, hy, rx, ry, hash2(id, 650 + k) * 3, 0, 6.2832); ctx.fill();
    ctx.globalAlpha = base;
    for (let j = 0; j < 4; j++) chunk(ctx, hx + (hash2(id, 660 + k * 7 + j) - 0.5) * rx, hy + (hash2(id, 700 + k * 7 + j) - 0.5) * ry, rx * 0.25, id * 47 + k * 7 + j, col(j % 2 ? '#2b241f' : '#3a302a'));
  }
  // 타다 남은 들보 (지붕을 가로지르는 검은 선 셋)
  ctx.globalAlpha = base * 0.75; ctx.strokeStyle = col('#1b1410'); ctx.lineWidth = Math.max(1, m * 0.05); ctx.lineCap = 'round';
  for (let k = 0; k < 3; k++) { const y = (-0.3 + 0.3 * k + (hash2(id, 740 + k) - 0.5) * 0.08) * h; ctx.beginPath(); ctx.moveTo(-w * 0.45, y); ctx.lineTo(w * (0.15 + 0.3 * hash2(id, 750 + k)), y + (hash2(id, 760 + k) - 0.5) * h * 0.08); ctx.stroke(); }
  ctx.lineCap = 'butt'; ctx.globalAlpha = base;
  void scale;
}
/** (X6 §7.2) 폭발 흔적: 건물 둘레에 깨진 유리가 반짝이는 고리와 지붕의 검은 그을음 자국 하나 */
function paintBlasted(ctx: CanvasRenderingContext2D, q: Place, scale: number, col: (c: string) => string, timeMs: number): void {
  const w = q.w, h = q.h, m = Math.min(w, h), id = q.id, base = ctx.globalAlpha;
  const bx = (hash2(id, 800) - 0.5) * w * 0.5, by = (hash2(id, 801) - 0.5) * h * 0.5, br = m * 0.22;
  ctx.globalAlpha = base * 0.6; ctx.fillStyle = col('#0e0a08'); ctx.beginPath();
  for (let k = 0; k < 10; k++) { const a = (k / 10) * 6.2832, r = br * (0.7 + 0.5 * hash2(id, 810 + k)); if (k) ctx.lineTo(bx + Math.cos(a) * r, by + Math.sin(a) * r); else ctx.moveTo(bx + Math.cos(a) * r, by + Math.sin(a) * r); }
  ctx.closePath(); ctx.fill();
  // 유리 조각: 외벽 밖 둘레 띠에 작은 마름모, 시간에 따라 몇 개씩 반짝인다
  const n = 22, sz = Math.max(0.8 / scale, m * 0.035);
  for (let k = 0; k < n; k++) {
    const a = hash2(id, 820 + k) * 6.2832, ex = Math.cos(a), ey = Math.sin(a);
    const t = Math.min(Math.abs(ex) > 1e-6 ? w / 2 / Math.abs(ex) : Infinity, Math.abs(ey) > 1e-6 ? h / 2 / Math.abs(ey) : Infinity) + m * (0.04 + 0.16 * hash2(id, 860 + k));
    const x = ex * t, y = ey * t, tw = 0.5 + 0.5 * Math.sin(timeMs / 300 + k * 1.7);
    ctx.globalAlpha = base * (0.35 + 0.6 * tw); ctx.fillStyle = col(tw > 0.85 ? '#f4fbff' : '#9fd6ea');
    ctx.beginPath(); ctx.moveTo(x, y - sz); ctx.lineTo(x + sz * 0.6, y); ctx.lineTo(x, y + sz); ctx.lineTo(x - sz * 0.6, y); ctx.closePath(); ctx.fill();
  }
  ctx.globalAlpha = base;
}

/** 크레인: 공사장을 가로질러 길까지 쓰러진 팔 (노란 트러스, 격자 눈금, 끝의 갈고리) */
function paintCrane(ctx: CanvasRenderingContext2D, q: Place, scale: number, col: (c: string) => string): void {
  const w = q.w, h = q.h, M = Math.max(w, h), base = ctx.globalAlpha;
  const x0 = -w * 0.32, y0 = -h * 0.3, x1 = w * 0.5 + M * 0.12, y1 = h * 0.5 + M * 0.08;
  const lw = Math.max(1.6, 3.2 / scale);
  ctx.globalAlpha = base * 0.45; ctx.strokeStyle = '#000000'; ctx.lineWidth = lw * 1.5; ctx.lineCap = 'round';
  ctx.beginPath(); ctx.moveTo(x0 + lw * 0.4, y0 + lw * 0.6); ctx.lineTo(x1 + lw * 0.4, y1 + lw * 0.6); ctx.stroke();
  ctx.globalAlpha = base; ctx.strokeStyle = col('#e0b83a'); ctx.lineWidth = lw;
  ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
  // 격자 눈금
  const L = Math.hypot(x1 - x0, y1 - y0), ux = (x1 - x0) / L, uy = (y1 - y0) / L, n = Math.max(4, Math.floor(L / (lw * 2.2)));
  ctx.strokeStyle = col('#6b5414'); ctx.lineWidth = Math.max(0.6, lw * 0.22);
  ctx.beginPath();
  for (let k = 1; k < n; k++) { const t = (k / n) * L, cx = x0 + ux * t, cy = y0 + uy * t, s = k % 2 ? 1 : -1; ctx.moveTo(cx - uy * lw * 0.45 * s - ux * lw * 0.4, cy + ux * lw * 0.45 * s - uy * lw * 0.4); ctx.lineTo(cx + uy * lw * 0.45 * s + ux * lw * 0.4, cy - ux * lw * 0.45 * s + uy * lw * 0.4); }
  ctx.stroke();
  // 갈고리
  ctx.fillStyle = col('#2a2f36'); ctx.beginPath(); ctx.arc(x1 + ux * lw * 0.9, y1 + uy * lw * 0.9, lw * 0.6, 0, 6.2832); ctx.fill();
  // 기초(마스트) 자리의 부서진 흔적
  for (let k = 0; k < 6; k++) chunk(ctx, x0 + (hash2(q.id, k) - 0.5) * M * 0.12, y0 + (hash2(q.id, k + 9) - 0.5) * M * 0.12, Math.min(w, h) * 0.05, q.id * 7 + k, col(RUBBLE[k % RUBBLE.length]));
}

/** 어두운 테를 두른 기호 (바탕 없는 실루엣): 경로를 #0b1219 로 먼저 굵게 긋고 채운다 */
const pathCache = new Map<string, Path2D>();
export function drawOutlinedMark(ctx: CanvasRenderingContext2D, d: string, x: number, y: number, size: number, color: string, outline = 3): void {
  let p = pathCache.get(d);
  if (!p) { p = new Path2D(d); pathCache.set(d, p); }
  const k = size / 24;
  ctx.save();
  ctx.translate(x - size / 2, y - size / 2); ctx.scale(k, k);
  if (outline > 0) { ctx.lineJoin = 'round'; ctx.strokeStyle = '#0b1219'; ctx.lineWidth = outline / k; ctx.stroke(p); }
  ctx.fillStyle = color; ctx.fill(p, 'evenodd');
  ctx.restore();
}

/** 지진의 충격 단계에 처음 나타나는 배지·기호: 0.4초 동안 1.4배에서 1배로 내려앉는다 (관찰자 시점) */
function quakePop(sim: Sim, I: Incident, truth: boolean): number {
  const d = sim.disaster;
  if (!truth || !d || d.kind !== 'quake' || d.phase !== 'impact') return 1;
  const age = sim.t - I.createdAt;
  return age >= 0 && age < 0.4 ? 1.4 - age : 1;
}

/** 진행 중인 사건 핀의 배지 (핀 몸통을 그린 뒤). 왼쪽 아래 (x − 0.78r, y + 0.78r) */
export function drawRuinBadge(ctx: CanvasRenderingContext2D, sim: Sim, I: Incident, x: number, y: number, r: number, truth: boolean, timeMs: number): void {
  const seen = ruinSeen(sim, I, truth);
  if (seen === 'none') return;
  const info = ruinInfo(sim, I);
  if (!info) return;
  void timeMs;
  const zs = r / 16;
  ctx.save();
  if (truth && I.phase === 'unreported') ctx.globalAlpha = 0.55;
  // 2차 붕괴 알림: 2초 동안 핀에서 흙빛 고리가 퍼지고, 배지가 0.6초 동안 1.25배에서 1배로 줄어든다
  const sec = seenSecondary(sim, I, truth), sAge = sim.t - sec.last;
  let pop = quakePop(sim, I, truth);
  if (sec.n > 0 && sAge >= 0 && sAge < 2) {
    const base = ctx.globalAlpha;
    ctx.globalAlpha = base * (1 - sAge / 2); ctx.strokeStyle = EDGE; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, r + (sAge / 2) * 28 * zs, 0, 6.2832); ctx.stroke();
    ctx.globalAlpha = base;
    if (sAge < 0.6) pop = Math.max(pop, 1.25 - (0.25 * sAge) / 0.6);
  }
  const bx = x - 0.78 * r, by = y + 0.78 * r, br = 0.46 * r * pop;
  ctx.fillStyle = '#0b1219'; ctx.beginPath(); ctx.arc(bx, by, br, 0, 6.2832); ctx.fill();
  ctx.strokeStyle = EDGE; ctx.lineWidth = Math.max(1.5, 0.1 * r);
  if (seen === 'reported') ctx.setLineDash([Math.max(2, r * 0.14), Math.max(1.5, r * 0.1)]);
  ctx.stroke(); ctx.setLineDash([]);
  if (seen === 'reported') ctx.globalAlpha *= 0.6;
  const d = seen === 'reported' ? RUIN_MARK.partial : ruinMark(info.level);
  drawOutlinedMark(ctx, d, bx, by, 0.72 * r * pop, EDGE, 0);
  ctx.restore();
}

/** 끝난 사건: 작게 보이면 건물 가운데에 무너진 건물 기호를 그리고 'glyph', 크게 보이면 덧그림이 있으므로 'overlay', 대상이 아니면 null */
export function ruinGlyphAt(ctx: CanvasRenderingContext2D, sim: Sim, I: Incident, x: number, y: number, zs: number, scale: number, truth: boolean): 'glyph' | 'overlay' | null {
  if (I.truth.placeId < 0 || ruinSeen(sim, I, truth) !== 'confirmed') return null;
  const info = ruinInfo(sim, I);
  if (!info) return null;
  const q = sim.city.places[I.truth.placeId];
  if (ruinOverlayVisible(q, scale)) return 'overlay';
  const pop = quakePop(sim, I, truth);
  ctx.save(); ctx.globalAlpha = 0.85;
  drawOutlinedMark(ctx, ruinMark(info.level), x, y, GLYPH * zs * pop, EDGE, 3.5);
  ctx.restore();
  return 'glyph';
}
