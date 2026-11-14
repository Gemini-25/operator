// 지도 사건 핀의 교전 표시 (표현 계층, docs/specs/G5-combat-fx.md 5.4절). 글자 없이 그림으로만 그린다.
//  사격마다 핀 테두리 위에 네 꼭지 별(대원 흰·노랑, 용의자 주황), 폭발은 주황 충격 고리 + 핀 흔들림, 섬광탄은 흰 고리, 진입은 파란 고리,
//  교전 중(최근 8 연출 초 안에 사격)이면 핀 바깥에 붉은·흰 두 색이 번갈아 도는 점선 테. 축소 창은 사격 순간 흰 점 하나.

import type { Sim } from '../../sim/engine';
import type { Incident } from '../../sim/types';
import type { FxBook, FxEntry } from '../scene/fxBook';

const ok = (sim: Sim, I: Incident, e: FxEntry, truth: boolean): boolean => {
  if (truth || !e.f) return true;
  const s = sim.scenes[I.id];
  return !!s && s.arrivedAt >= 0 && e.f.t >= s.arrivedAt;      // AI 시점: 부대 도착 전의 범행은 보이지 않는다
};

/** 폭발에 흔들리는 핀(±2px) */
export function combatPinJitter(book: FxBook, sim: Sim, I: Incident, truth: boolean): { x: number; y: number } | null {
  for (const e of book.live(I.id)) {
    if (e.kind !== 'boom' || !ok(sim, I, e, truth)) continue;
    const a = book.age(e);
    if (a < 0 || a > 0.6) continue;
    const k = 2 * Math.exp(-a / 0.18);
    return { x: Math.sin(a * 175 + e.seed * 6) * k, y: Math.cos(a * 151 + e.seed * 4) * k };
  }
  return null;
}

export function drawCombatPin(ctx: CanvasRenderingContext2D, book: FxBook, sim: Sim, I: Incident, x: number, y: number, r: number, zs: number, o: { truth: boolean; mini: boolean; timeMs: number }): void {
  if (I.phase !== 'onscene') return;
  const live = book.live(I.id);
  for (const e of live) {
    if (!ok(sim, I, e, o.truth)) continue;
    const a = book.age(e);
    if (a < 0) continue;
    if (e.kind === 'shot' && a < 0.18) {
      const foe = (e.f?.c?.side ?? (e.f?.color === '#ff8a5c' ? 1 : 0)) === 1;
      const an = e.seed * 6.2832, px = x + Math.cos(an) * r, py = y + Math.sin(an) * r;
      if (o.mini) { ctx.fillStyle = '#ffffff'; ctx.beginPath(); ctx.arc(x, y - r - 2, 1.6, 0, 7); ctx.fill(); continue; }
      const R = 3 * zs * (1 - a / 0.3);
      ctx.fillStyle = foe ? '#ff8a3c' : a < 0.06 ? '#ffffff' : '#ffe9a0';
      ctx.beginPath();
      for (let i = 0; i < 8; i++) { const aa = (i / 8) * 6.2832 + 0.39, rr = i % 2 ? R * 0.3 : R; const qx = px + Math.cos(aa) * rr, qy = py + Math.sin(aa) * rr; if (i) ctx.lineTo(qx, qy); else ctx.moveTo(qx, qy); }
      ctx.closePath(); ctx.fill();
    } else if (o.mini) continue;
    else if (e.kind === 'boom' && a < 0.8) {
      const k = a / 0.8;
      ctx.strokeStyle = `rgba(255,138,60,${0.9 * (1 - k)})`; ctx.lineWidth = Math.max(1.5, 3 * zs * (1 - k));
      ctx.beginPath(); ctx.arc(x, y, r + 40 * zs * k, 0, 7); ctx.stroke();
    } else if (e.kind === 'flash' && a < 0.4 + (e.f?.c?.ox !== undefined ? 0.34 : 0)) {
      const t = a - (e.f?.c?.ox !== undefined ? 0.34 : 0); if (t < 0) continue;
      const k = t / 0.4; ctx.strokeStyle = `rgba(255,255,255,${0.9 * (1 - k)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r + 4 + 18 * zs * k, 0, 7); ctx.stroke();
    } else if (e.kind === 'breach' && a < 0.5) {
      const k = a / 0.5; ctx.strokeStyle = `rgba(159,208,255,${0.9 * (1 - k)})`; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r + 4 + 14 * zs * k, 0, 7); ctx.stroke();
    }
  }
  if (o.mini) return;
  // 교전 중: 최근 8 연출 초 안에 사격 (AI 시점이면 부대 도착 뒤의 사격만)
  const last = book.lastShot(I.id);
  const s = sim.scenes[I.id];
  if (last && book.clock - last.at < 8 && (o.truth || (!!s && s.arrivedAt >= 0 && last.t >= s.arrivedAt))) {
    const R = r + Math.max(5, r * 0.62), dash = Math.max(3, 4 * zs), off = (o.timeMs / 500) * dash * 2;
    const flip = Math.floor(o.timeMs / 500) % 2 === 0;
    ctx.lineWidth = Math.max(1.6, 2 * zs); ctx.setLineDash([dash, dash]);
    ctx.strokeStyle = flip ? '#ff4d4d' : '#ffffff'; ctx.lineDashOffset = -off; ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.stroke();
    ctx.strokeStyle = flip ? '#ffffff' : '#ff4d4d'; ctx.lineDashOffset = -off - dash; ctx.beginPath(); ctx.arc(x, y, R, 0, 7); ctx.stroke();
    ctx.setLineDash([]); ctx.lineDashOffset = 0;
  }
}
