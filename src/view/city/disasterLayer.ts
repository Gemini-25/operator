// 재난의 그림 (docs/specs/N6-disaster.md). 상태(sim.disaster)를 읽기만 한다.
// 세 자리에서 불린다. 재난이 없으면 아무것도 그리지 않는다.
//   지도(월드 좌표)   물에 잠긴 강가, 산불이 탄 자리와 불머리, 해일의 물마루, 지진의 고리, 정전의 어둠
//   지도(화면 좌표)   비바람 줄기, 산불 연기, 지진의 떨림 테두리
//   현장              강한 비, 여진의 먼지, 산불의 붉은 하늘빛, 다가오는 해일

import type { DisasterState } from '../../sim/disaster';
import type { Sim } from '../../sim/engine';
import type { Scene } from '../../sim/types';
import { T } from '../../sim/types';
import { hash2 } from '../scene/common';

type G = CanvasRenderingContext2D;
const TAU = 6.2832;
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
/** 마지막으로 흔들린 뒤 지난 시간(초). 흔들린 적이 없으면 큰 값 */
function sinceShake(sim: Sim, d: DisasterState): number {
  const sh = d.shakes;
  return sh && sh.length ? sim.t - sh[sh.length - 1] : 1e9;
}

/** 지도의 월드 좌표계에서, 고정 지도와 도로 상태 위·부대 표식 아래 (물에 잠긴 곳, 탄 자리, 불머리, 해일 띠) */
export function drawDisasterWorld(ctx: G, sim: Sim, timeMs: number, scale: number): void {
  const d = sim.disaster;
  if (!d || d.phase === 'calm') return;
  const c = sim.city, px = 1 / Math.max(0.05, scale), time = timeMs / 1000;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  // ── 산불: 탄 자리는 재난이 끝난 뒤에도 남는다 ──
  if (d.kind === 'wildfire' && d.scar) {
    for (const [x, y, r] of d.scar) {
      const gr = ctx.createRadialGradient(x, y, r * 0.15, x, y, r);
      gr.addColorStop(0, 'rgba(20,9,6,0.5)'); gr.addColorStop(0.7, 'rgba(34,13,8,0.32)'); gr.addColorStop(1, 'rgba(40,14,8,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
    const f = d.front;
    if (f && (d.phase === 'impact' || d.phase === 'aftermath')) {
      const live = !d.stopped, k = live ? 1 : clamp01(1 - (sim.t - d.tEnd) / 120) * 0.6, fl = 0.85 + 0.15 * Math.sin(time * 7);
      const gr = ctx.createRadialGradient(f.x, f.y, f.r * 0.2, f.x, f.y, f.r * 1.3);
      gr.addColorStop(0, `rgba(255,96,24,${0.1 * k})`); gr.addColorStop(0.7, `rgba(255,120,30,${0.3 * k * fl})`); gr.addColorStop(1, 'rgba(255,120,30,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(f.x, f.y, f.r * 1.3, 0, TAU); ctx.fill();
      if (live) {
        // 불머리: 번지는 쪽으로 밝은 테
        const a0 = Math.atan2(f.dy, f.dx);
        ctx.strokeStyle = `rgba(255,170,70,${0.85 * fl})`; ctx.lineWidth = Math.max(3 * px, 4);
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, a0 - 1.25, a0 + 1.25); ctx.stroke();
        ctx.strokeStyle = 'rgba(255,120,40,0.4)'; ctx.lineWidth = Math.max(1.5 * px, 2); ctx.setLineDash([10, 12]);
        ctx.beginPath(); ctx.arc(f.x, f.y, f.r, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
        // 불씨
        for (let q = 0; q < 16; q++) {
          const ph = (time * (0.35 + 0.3 * hash2(q, 3)) + hash2(q, 7)) % 1, a = a0 + (hash2(q, 11) - 0.5) * 3.2, rr = f.r * (0.75 + 0.5 * ph);
          ctx.fillStyle = `rgba(255,${Math.round(190 - 90 * ph)},70,${0.9 * (1 - ph)})`;
          ctx.beginPath(); ctx.arc(f.x + Math.cos(a) * rr, f.y + Math.sin(a) * rr - ph * 14, Math.max(1.6 * px, 2.4) * (1 - 0.5 * ph), 0, TAU); ctx.fill();
        }
      }
    }
  }
  if (d.phase === 'over') { ctx.restore(); return; }
  // ── 홍수: 강의 중심선을 따라 수위만큼 넓어진 물 ──
  if (d.kind === 'flood' && (d.level ?? 0) > 0.01) {
    const lv = d.level!, pts = c.river.pts;
    const trace = (): void => { ctx.beginPath(); pts.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1]) : ctx.moveTo(p[0], p[1]))); };
    trace(); ctx.strokeStyle = 'rgba(52,120,186,0.26)'; ctx.lineWidth = 36 + lv * 160; ctx.stroke();
    trace(); ctx.strokeStyle = 'rgba(70,150,216,0.3)'; ctx.lineWidth = 36 + lv * 104; ctx.stroke();
    trace(); ctx.strokeStyle = `rgba(190,226,250,${0.22 + 0.1 * Math.sin(time * 1.6)})`; ctx.lineWidth = Math.max(1.5 * px, 2); ctx.setLineDash([26, 34]); ctx.lineDashOffset = -time * 22;
    ctx.stroke(); ctx.setLineDash([]);
  }
  // ── 해일: 바다에서 다가오는 물마루(예고), 해안을 넘어 들어온 물(충격) ──
  if (d.kind === 'tsunami' && c.coast) {
    const coast = c.coast;
    const line = (off: number): void => { ctx.beginPath(); coast.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1] + off) : ctx.moveTo(p[0], p[1] + off))); };
    if (d.phase === 'warning') {
      const p = clamp01((sim.t - d.tWarn) / Math.max(1, d.tImpact - d.tWarn)), off = 30 + 260 * (1 - p);
      line(off + 16); ctx.strokeStyle = 'rgba(150,205,240,0.28)'; ctx.lineWidth = 18; ctx.stroke();
      line(off); ctx.strokeStyle = `rgba(240,250,255,${0.55 + 0.25 * Math.sin(time * 4)})`; ctx.lineWidth = Math.max(2.5 * px, 4); ctx.stroke();
    } else {
      const u = d.phase === 'impact' ? clamp01((sim.t - d.tImpact) / Math.max(1, d.tEnd - d.tImpact)) : 1;
      const reach = d.phase === 'impact' ? 150 * Math.sin(Math.PI * Math.min(1, 0.12 + u * 0.88) * 0.92) : 22 * clamp01(1 - (sim.t - d.tEnd) / 120);
      if (reach > 1) {
        ctx.beginPath();
        coast.forEach((p, i) => (i ? ctx.lineTo(p[0], p[1] + 12) : ctx.moveTo(p[0], p[1] + 12)));
        for (let i = coast.length - 1; i >= 0; i--) ctx.lineTo(coast[i][0], coast[i][1] - reach);
        ctx.closePath(); ctx.fillStyle = d.phase === 'impact' ? 'rgba(96,170,226,0.4)' : 'rgba(96,170,226,0.2)'; ctx.fill();
        line(-reach); ctx.strokeStyle = `rgba(245,252,255,${d.phase === 'impact' ? 0.85 : 0.35})`; ctx.lineWidth = Math.max(2.5 * px, 4); ctx.stroke();
      }
    }
  }
  // ── 지진: 진앙에서 퍼지는 고리 (흔들린 뒤 6초) ──
  if (d.kind === 'quake' && d.epi && d.shakes) {
    for (const ts of d.shakes) {
      const age = sim.t - ts;
      if (age < 0 || age > 6) continue;
      const fade = 1 - age / 6;
      for (let q = 0; q < 3; q++) {
        const a = age - q * 0.8;
        if (a <= 0) continue;
        ctx.beginPath(); ctx.arc(d.epi.x, d.epi.y, a * 240, 0, TAU);
        ctx.strokeStyle = `rgba(255,190,110,${0.2 * fade})`; ctx.lineWidth = Math.max(12 * px, 34) * (1 - q * 0.2); ctx.stroke();
        ctx.strokeStyle = `rgba(255,226,160,${0.95 * fade})`; ctx.lineWidth = Math.max(3 * px, 7) * (1 - q * 0.25); ctx.stroke();
      }
    }
    if (d.phase === 'impact') {
      const r = Math.max(7 * px, 12), pr = 0.6 + 0.4 * Math.sin(time * 5);
      ctx.strokeStyle = `rgba(255,214,140,${0.5 + 0.4 * pr})`; ctx.lineWidth = Math.max(1.5 * px, 2.5);
      ctx.beginPath(); ctx.moveTo(d.epi.x - r, d.epi.y); ctx.lineTo(d.epi.x + r, d.epi.y); ctx.moveTo(d.epi.x, d.epi.y - r); ctx.lineTo(d.epi.x, d.epi.y + r); ctx.stroke();
      ctx.beginPath(); ctx.arc(d.epi.x, d.epi.y, r * (1.2 + 0.3 * pr), 0, TAU); ctx.stroke();
    }
  }
  // ── 정전: 건물의 불빛이 꺼진 도시 ──
  if (d.dark) { ctx.fillStyle = 'rgba(2,4,12,0.42)'; ctx.fillRect(-200, -200, c.w + 400, c.h + 400); }
  ctx.restore();
}

/** 비스듬히 쏟아지는 빗줄기와 가로로 스치는 바람 줄기 (세기 0..1) */
function storm(ctx: G, w: number, h: number, timeMs: number, k: number, mini: boolean, wind: boolean): void {
  const n = Math.round((mini ? 60 : 300) * k);
  ctx.strokeStyle = `rgba(198,220,244,${0.3 + 0.22 * k})`; ctx.lineWidth = mini ? 1 : 1.7; ctx.beginPath();
  for (let q = 0; q < n; q++) {
    const sp = 0.8 + 0.5 * hash2(q, 3);
    const x = (hash2(q, 1) * (w + 80) + timeMs * 0.42 * sp) % (w + 80) - 40, y = (hash2(q, 2) * h + timeMs * 0.95 * sp) % h;
    ctx.moveTo(x, y); ctx.lineTo(x + (mini ? 4 : 9), y + (mini ? 9 : 21));
  }
  ctx.stroke();
  if (!wind || k < 0.3) return;
  const m = Math.round((mini ? 4 : 12) * k);
  ctx.strokeStyle = `rgba(226,238,250,${0.1 + 0.12 * k})`; ctx.lineWidth = mini ? 1 : 2.2; ctx.beginPath();
  for (let q = 0; q < m; q++) {
    const ph = (timeMs * 0.0011 * (0.7 + 0.6 * hash2(q, 31)) + hash2(q, 37)) % 1, len = (mini ? 30 : 130) * (0.6 + 0.8 * hash2(q, 41));
    const x = ph * (w + len * 2) - len, y = hash2(q, 43) * h + Math.sin(ph * 6 + q) * 8;
    ctx.moveTo(x, y); ctx.quadraticCurveTo(x + len * 0.5, y - 6, x + len, y + 3);
  }
  ctx.stroke();
}

/** 지도의 화면 좌표계에서, 모든 것 위 (비바람 줄기, 연기, 지진의 흔들림 테두리, 정전의 어둠). mini = 축소 창 */
export function drawDisasterScreen(ctx: G, sim: Sim, w: number, h: number, timeMs: number, mini: boolean): void {
  const d = sim.disaster;
  if (!d || d.phase === 'calm' || d.phase === 'over') return;
  ctx.save();
  if (d.kind === 'typhoon') storm(ctx, w, h, timeMs, clamp01(d.intensity), mini, true);
  else if (d.kind === 'flood' && d.phase !== 'aftermath') storm(ctx, w, h, timeMs, 0.45, mini, false);
  else if (d.kind === 'wildfire' && d.front) {
    // 불머리 쪽 가장자리에서 번져 오는 연기
    const c = sim.city, vx = d.front.x - c.w / 2, vy = d.front.y - c.h / 2, vl = Math.hypot(vx, vy) || 1, k = clamp01(d.intensity) * (mini ? 0.5 : 1);
    const gr = ctx.createLinearGradient(w / 2 + (vx / vl) * w * 0.55, h / 2 + (vy / vl) * h * 0.55, w / 2 - (vx / vl) * w * 0.35, h / 2 - (vy / vl) * h * 0.35);
    gr.addColorStop(0, `rgba(128,96,74,${0.34 * k})`); gr.addColorStop(0.55, `rgba(120,100,84,${0.12 * k})`); gr.addColorStop(1, 'rgba(120,100,84,0)');
    ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    if (!mini && !d.stopped) {
      // 날리는 재
      for (let q = 0; q < 26; q++) {
        const ph = (timeMs * 0.00012 * (0.6 + 0.8 * hash2(q, 51)) + hash2(q, 53)) % 1;
        const x = (hash2(q, 55) * w - (vx / vl) * ph * w * 0.6 + w) % w, y = (hash2(q, 57) * h - (vy / vl) * ph * h * 0.6 + h) % h;
        ctx.fillStyle = `rgba(${q % 3 === 0 ? '255,170,90' : '60,52,46'},${0.5 * Math.sin(ph * Math.PI)})`;
        ctx.fillRect(x, y, 2.2, 2.2);
      }
    }
  } else if (d.kind === 'tsunami' && d.phase === 'impact') { ctx.fillStyle = 'rgba(60,120,170,0.06)'; ctx.fillRect(0, 0, w, h); }
  if (d.kind === 'quake') {
    // 흔들린 뒤 3초: 화면 가장자리가 떨린다 (카메라는 흔들지 않는다)
    const age = sinceShake(sim, d);
    if (age < 3) {
      const amp = 1 - age / 3, n = mini ? 2 : 4;
      for (let q = 0; q < n; q++) {
        const j = Math.sin(timeMs * 0.085 + q * 2.1) * (mini ? 2 : 6) * amp, inset = (mini ? 2 : 5) + q * (mini ? 3 : 8) + j;
        ctx.strokeStyle = `rgba(255,208,140,${0.42 * amp * (1 - q / (n + 1))})`; ctx.lineWidth = mini ? 1.5 : 3.5;
        ctx.strokeRect(inset + Math.cos(timeMs * 0.11 + q) * 2 * amp, inset, w - inset * 2, h - inset * 2);
      }
    }
  }
  ctx.restore();
}

/** 현장 화면에서, 날씨 다음 (비바람, 흔들림, 붉은 하늘빛) */
export function drawDisasterScene(ctx: G, sim: Sim, s: Scene, w: number, h: number, timeMs: number, mini: boolean): void {
  const d = sim.disaster;
  if (!d || d.phase === 'calm' || d.phase === 'over') return;
  const time = timeMs / 1000, ts = h / s.h;
  ctx.save(); ctx.beginPath(); ctx.rect(0, 0, w, h); ctx.clip();
  if (d.kind === 'typhoon') {
    const k = clamp01(d.intensity);
    ctx.fillStyle = `rgba(20,30,46,${0.1 * k})`; ctx.fillRect(0, 0, w, h);
    storm(ctx, w, h, timeMs, k, mini, true);
  } else if (d.kind === 'flood' && d.phase !== 'aftermath') storm(ctx, w, h, timeMs, 0.5, mini, false);
  else if (d.kind === 'quake') {
    // 여진의 먼지: 흔들린 뒤 잠깐 뿌옇게 일어났다 가라앉는다
    const age = sinceShake(sim, d);
    if (age < 5) {
      const amp = 1 - age / 5;
      ctx.fillStyle = `rgba(150,132,104,${0.2 * amp})`; ctx.fillRect(0, 0, w, h);
      if (!mini) for (let q = 0; q < 40; q++) {
        const ph = (age * (0.25 + 0.2 * hash2(q, 61)) + hash2(q, 63)) % 1;
        ctx.fillStyle = `rgba(190,172,140,${0.5 * amp * (1 - ph)})`;
        ctx.fillRect(hash2(q, 65) * w + Math.sin(time * 9 + q) * 3 * amp, hash2(q, 67) * h * 0.9 + ph * h * 0.12, 2.5, 2.5);
      }
    }
  } else if (d.kind === 'wildfire') {
    // 산불 현장은 하늘이 붉다 (다른 현장에는 옅은 연기만)
    const wild = s.kind === 'fire' && s.variant === 'wild', k = clamp01(d.intensity);
    if (wild) {
      const gr = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.25, w / 2, h / 2, Math.max(w, h) * 0.75);
      gr.addColorStop(0, 'rgba(255,110,40,0.05)'); gr.addColorStop(1, `rgba(255,84,24,${0.2 + 0.03 * Math.sin(time * 2.3)})`);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h);
    } else { ctx.fillStyle = `rgba(128,100,80,${0.07 * k})`; ctx.fillRect(0, 0, w, h); }
  } else if (d.kind === 'tsunami' && s.kind === 'water' && s.variant === 'evac') {
    const hit = !!d.hit && d.hit.indexOf(s.incidentId) >= 0;
    let sea = s.h; for (let y = 0; y < s.h; y++) if (s.tiles[y * s.w] === T.WATER) { sea = y; break; }
    const wave = (y: number, a: number): void => {
      ctx.strokeStyle = `rgba(240,250,255,${a})`; ctx.lineWidth = Math.max(1.5, ts * 0.16); ctx.beginPath();
      for (let x = 0; x <= w; x += Math.max(6, ts * 0.5)) { const yy = y + Math.sin(x / (ts * 1.7) + time * 3) * ts * 0.12; if (x) ctx.lineTo(x, yy); else ctx.moveTo(x, yy); }
      ctx.stroke();
    };
    if (!hit && d.phase === 'warning') {
      // 바다 끝에서 다가오는 물마루
      const p = clamp01((sim.t - d.tWarn) / Math.max(1, d.tImpact - d.tWarn));
      const y = (s.h - (s.h - sea) * p) * ts;
      ctx.fillStyle = 'rgba(150,205,240,0.18)'; ctx.fillRect(0, y, w, h - y);
      wave(y, 0.8); wave(y + ts * 0.5, 0.35);
    } else if (hit) {
      // 물가에서 부서지는 물결
      wave(sea * ts + ts * 0.15, 0.6 + 0.2 * Math.sin(time * 2)); wave(sea * ts + ts * 0.8, 0.25);
    }
  }
  ctx.restore();
}
