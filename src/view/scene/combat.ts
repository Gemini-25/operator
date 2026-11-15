// 교전 그림 (표현 계층, docs/specs/G5-combat-fx.md 3절).
// 총구 섬광·예광선·탄착·피격, 섬광탄의 던짐·터짐·방 채움, 폭발, 진입(3-2-1·문짝·파편), 겨누는 선·협상·검거·테이저.
// 모두 연출 기억(FxBook)의 기록과 시뮬레이션 상태를 읽어 그릴 뿐이다. renderScene.ts 는 여기의 함수를 한 줄씩 부른다.
// 피·신체 훼손은 그리지 않는다: 맞는 순간은 섬광·궤적·충격(움찔)으로만 보여 준다.
// 이 파일은 import 할 때 DOM 을 건드리지 않는다(시험에서 가짜 맥락으로 부른다).

import type { Sim } from '../../sim/engine';
import { los } from '../../sim/field/grid';
import { officersSeeing } from '../../sim/field/hazards';
import type { FieldAgent, Fx, Hostile, Scene } from '../../sim/types';
import { hash2, visPoly } from './common';
import type { G } from './common';
import { chip, drawDebrisFx, drawGlassFx, drawLight, fxSprites, hole } from './fx';
import { HAIL, TALK, impactOf, muzzleLen, talkPhase, tracerSpeed } from './fxBook';
import type { FxBook, FxEntry } from './fxBook';
import { doorHorizontal, rubbleColors } from './staticLayer';

export const ALLY = { core: '#f2fbff', glow: '#6cc4ff', flash: '#fffbe6', flashOut: '#ffd27a', aim: '150,205,255' };
export const FOE = { core: '#fff0d8', glow: '#ff6a3d', flash: '#fff2c8', flashOut: '#ff8a3c', aim: '255,90,70' };
/** 수갑 기호 (view/marks.ts 와 같은 24×24 경로 문자열) */
export const CUFF_PATH = 'M7 6.5a4.5 4.5 0 1 0 0.01 0ZM17 6.5a4.5 4.5 0 1 0 0.01 0ZM10.6 10.2h2.8v1.6h-2.8Z';

export interface CombatView {
  g: G; sim: Sim; s: Scene; book: FxBook; ts: number; alpha: number;
  mini: boolean; truth: boolean;
  reduced: boolean;                   // prefers-reduced-motion
  H: number;                          // 화면 높이(화소): 큰 반경의 상한
  time: number;                       // 실제 시간(초): 깜박임
}

const P = (v: number, ts: number): number => (v + 0.5) * ts;
const ipos = (o: { x: number; y: number; px: number; py: number }, a: number): { x: number; y: number } => ({ x: o.px + (o.x - o.px) * a, y: o.py + (o.y - o.py) * a });
const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (k: number): number => 1 - (1 - k) * (1 - k);
const poly: number[] = [];

/** 쏜·던진 사람의 그려진 자리. 현장에 없거나 숨어 있어 보이지 않으면 기록의 자리 */
export function originOf(cv: CombatView, f: Fx): { x: number; y: number } {
  const c = f.c;
  if (c && c.by !== undefined) {
    if (c.side === 0) { const a = cv.s.agents.find((q) => q.rid === c.by && q.status !== 'left'); if (a) return ipos(a, cv.alpha); }
    else if (c.side === 1) { const h = cv.s.hostiles.find((q) => q.id === c.by); if (h && h.state !== 'escaped' && !(h.hidden && !cv.truth)) return ipos(h, cv.alpha); }
  }
  return { x: f.x, y: f.y };
}
const sideOf = (f: Fx): 0 | 1 => (f.c?.side ?? (f.color === '#ff8a5c' ? 1 : 0)) as 0 | 1;
const throwOf = (f: Fx): number => (f.c && f.c.ox !== undefined ? 0.34 : 0);
/**
 * 사격의 선: 총구(칸)와 탄착점, 방향, 총구~탄착 거리, 머리의 도착 시간.
 * 선은 기록의 자리(쏜 순간의 자리 f.x, f.y)에서 탄착점까지다 — 시뮬레이션의 탄도(damage.fireShot)와 같은 선분이라, 그 위의 창이 깨지고 끝의 칸이 탄을 멈춘 칸이다.
 * 쏜 사람이 그 뒤에 움직여도 선은 따라가지 않는다(따라가면 배속이 높을 때 선이 깨진 창에서 벗어난다).
 */
function shotLine(cv: CombatView, e: FxEntry): { mx: number; my: number; ix: number; iy: number; ux: number; uy: number; D: number; fly: number; o: { x: number; y: number } } {
  const f = e.f!, o = { x: f.x, y: f.y }, imp = impactOf(f);
  let ux = imp.x - o.x, uy = imp.y - o.y;
  const d0 = Math.hypot(ux, uy) || 1; ux /= d0; uy /= d0;
  const ml = f.c ? Math.min(muzzleLen(f), d0 * 0.5) : 0.25;
  const mx = o.x + ux * ml, my = o.y + uy * ml;
  const D = Math.max(0.05, d0 - ml);
  return { mx, my, ix: imp.x, iy: imp.y, ux, uy, D, fly: e.fly ?? Math.max(0.05, D / tracerSpeed(f)), o };
}

// ───────────────────────── 2. 남는 그림 ─────────────────────────
/** 탄흔(벽·문), 폭발 그을음, 빈 섬광탄 깡통. 바닥 흔적 다음에 그린다 */
export function drawCombatDecals(cv: CombatView): void {
  if (cv.mini) return;
  const { g, book, ts } = cv;
  const ds = book.decals(cv.s.id);
  if (!ds.length) return;
  const sp = fxSprites();
  for (const d of ds) {
    const age = book.clock - d.born;
    if (age < 0) continue;
    const x = P(d.x, ts), y = P(d.y, ts);
    if (d.kind === 'hole') {
      g.fillStyle = `rgba(20,18,16,${0.7 * clamp01((60 - age) / 12)})`;
      g.beginPath(); g.arc(x, y, Math.max(1, ts * 0.05), 0, 6.2832); g.fill();
    } else if (d.kind === 'scorch') {
      const dd = d.r * 2 * ts;
      g.globalAlpha = 0.85 * clamp01((120 - age) / 30) * clamp01(age / 0.4); g.drawImage(sp.scorch, x - dd / 2, y - dd / 2, dd, dd); g.globalAlpha = 1;
    } else {
      const rot = hash2(Math.round(d.x * 31), Math.round(d.y * 17)) * 6.2832;
      g.save(); g.translate(x, y); g.rotate(rot); g.globalAlpha = clamp01((90 - age) / 20);
      g.fillStyle = '#23282e'; g.fillRect(-ts * 0.09, -ts * 0.045, ts * 0.18, ts * 0.09);
      g.fillStyle = '#9aa3ab'; g.fillRect(-ts * 0.02, -ts * 0.045, ts * 0.03, ts * 0.09);
      g.restore(); g.globalAlpha = 1;
    }
  }
}

// ───────────────────────── 3. 겨누는 선 · 확성기 · 인질 끌기 ─────────────────────────
export function drawAimLines(cv: CombatView): void {
  if (cv.mini) return;
  const { g, sim, s, ts, alpha, truth, book } = cv;
  const lines: { d: number; draw: () => void }[] = [];
  // 용의자 → 대원: 교전 중이면 노리는 대원, 아니면 지금 보이는 가장 가까운 대원 (시뮬레이션과 같은 판정)
  for (const h of s.hostiles) {
    if (h.weapon !== 'gun' || (h.state !== 'hold' && h.state !== 'fight') || sim.t < h.stunUntil || (h.hidden && !truth)) continue;
    let ta: FieldAgent | undefined;
    if (h.state === 'fight' && h.targetRid >= 0) {
      const a = s.agents.find((q) => q.rid === h.targetRid && q.status === 'active');
      if (a && Math.hypot(a.x - h.x, a.y - h.y) <= 11 && los(s, h.x, h.y, a.x, a.y)) ta = a;
    }
    if (!ta) { const see = officersSeeing(sim, s, h, 11); if (see.nearest >= 0) ta = s.agents.find((q) => q.rid === see.nearest); }
    if (!ta) continue;
    const hp = ipos(h, alpha), ap = ipos(ta, alpha), d = Math.hypot(ap.x - hp.x, ap.y - hp.y);
    if (d < 0.6) continue;
    const fire = h.state === 'fight' && h.cooldown <= 0.4;
    lines.push({ d, draw: () => {
      const ux = (ap.x - hp.x) / d, uy = (ap.y - hp.y) / d;
      const mx = P(hp.x + ux * 0.58, ts), my = P(hp.y + uy * 0.58, ts), ex = P(ap.x - ux * 0.2, ts), ey = P(ap.y - uy * 0.2, ts);
      const a = fire ? 0.8 : h.state === 'fight' ? 0.45 : 0.25;
      g.strokeStyle = `rgba(${FOE.aim},${a})`; g.lineWidth = Math.max(1, ts * 0.035) * (fire ? 1.6 : 1); g.lineCap = 'round';
      g.setLineDash(fire ? [] : [ts * 0.18, ts * 0.14]);
      g.beginPath(); g.moveTo(mx, my); g.lineTo(ex, ey); g.stroke(); g.setLineDash([]);
      g.fillStyle = `rgba(255,60,50,${Math.min(1, a + 0.2)})`; g.beginPath(); g.arc(ex, ey, Math.max(1.5, ts * 0.06), 0, 6.2832); g.fill();
      if (fire) { g.strokeStyle = `rgba(${FOE.aim},0.85)`; g.lineWidth = Math.max(1, ts * 0.03); g.beginPath(); g.arc(mx, my, ts * (0.1 + 0.03 * Math.sin(cv.time * 20)), 0, 6.2832); g.stroke(); }
    } });
  }
  // 대원 → 용의자: 교전·봉쇄로 서 있고, 13칸 안에 보이는 활동 중인 용의자가 바라보는 쪽 ±25° 안에 있을 때
  const COS25 = Math.cos((25 * Math.PI) / 180);
  for (const a of s.agents) {
    if (a.status !== 'active' || !a.task || (a.task.kind !== 'engage' && a.task.kind !== 'perimeter')) continue;
    if (Math.abs(a.x - a.px) + Math.abs(a.y - a.py) > 0.01) continue;
    const fl = Math.hypot(a.fx, a.fy); if (fl < 1e-3) continue;
    let best: Hostile | null = null, bd = 13;
    for (const h of s.hostiles) {
      if ((h.state !== 'hold' && h.state !== 'fight' && h.state !== 'flee') || (h.hidden && !truth)) continue;
      const d = Math.hypot(h.x - a.x, h.y - a.y);
      if (d > bd || d < 0.6) continue;
      if (((h.x - a.x) * a.fx + (h.y - a.y) * a.fy) / (d * fl) < COS25) continue;
      if (!los(s, a.x, a.y, h.x, h.y)) continue;
      best = h; bd = d;
    }
    if (!best) continue;
    const h = best;
    lines.push({ d: bd, draw: () => {
      const ap = ipos(a, alpha), hp = ipos(h, alpha), d = Math.hypot(hp.x - ap.x, hp.y - ap.y) || 1;
      const ux = (hp.x - ap.x) / d, uy = (hp.y - ap.y) / d;
      const rifle = sim.units[a.unitId]?.kind === 'tactical' || sim.units[a.unitId]?.kind === 'swat';
      const ml = rifle ? 0.8 : 0.58;
      const mx = P(ap.x + ux * ml, ts), my = P(ap.y + uy * ml, ts), ex = P(hp.x - ux * 0.22, ts), ey = P(hp.y - uy * 0.22, ts);
      const hold = a.label.startsWith('사격 보류');
      const ready = a.cooldown <= 0.25 && a.label === '교전';
      g.strokeStyle = `rgba(${ALLY.aim},${ready ? 0.5 : 0.25})`; g.lineWidth = Math.max(1, ts * 0.03); g.lineCap = 'round';
      g.setLineDash(hold ? [ts * 0.04, ts * 0.12] : [ts * 0.18, ts * 0.14]);
      g.beginPath(); g.moveTo(mx, my); g.lineTo(ex, ey); g.stroke(); g.setLineDash([]);
      if (hold) { const px = -uy * ts * 0.14, py = ux * ts * 0.14; g.lineWidth = Math.max(1.5, ts * 0.05); g.beginPath(); g.moveTo(ex - px, ey - py); g.lineTo(ex + px, ey + py); g.stroke(); }
    } });
  }
  lines.sort((p, q) => p.d - q.d);
  for (let i = 0; i < Math.min(12, lines.length); i++) lines[i].draw();
  // 확성기 파동 (합성 'hail': 소리와 같은 시각)
  for (const e of book.live(s.id)) {
    if (e.kind !== 'hail') continue;
    const age = book.age(e); if (age < 0 || age >= HAIL) continue;
    const a = s.agents.find((q) => q.rid === e.n && q.status === 'active');
    if (!a || !a.task || a.task.kind !== 'negotiate') continue;
    const h = s.hostiles[a.task.hostile]; if (!h) continue;
    const ap = ipos(a, alpha), hp = ipos(h, alpha), dir = Math.atan2(hp.y - ap.y, hp.x - ap.x), k = age / HAIL;
    const ox = P(ap.x + Math.cos(dir) * 0.42, ts), oy = P(ap.y + Math.sin(dir) * 0.42, ts);
    g.lineWidth = Math.max(1, ts * 0.035); g.lineCap = 'round';
    for (let q = 0; q < 3; q++) {
      const r = ts * (0.25 + q * 0.28 + 1.5 * k);
      g.strokeStyle = `rgba(232,240,247,${0.5 * (1 - k) * (1 - q * 0.2)})`;
      g.beginPath(); g.arc(ox, oy, r, dir - 0.45, dir + 0.45); g.stroke();
    }
  }
  // 인질 끌기: 끌려가는 방향으로 작은 화살 셋 (선은 그대로)
  for (const h of s.hostiles) {
    if (!h.dragging || h.hostageId < 0 || (h.hidden && !truth)) continue;
    const c = s.casualties[h.hostageId]; if (!c) continue;
    const mvx = h.x - h.px, mvy = h.y - h.py, m = Math.hypot(mvx, mvy);
    if (m < 1e-4) continue;
    const ux = mvx / m, uy = mvy / m, hp = ipos(h, alpha), cp = ipos(c, alpha);
    g.strokeStyle = 'rgba(255,150,140,0.85)'; g.lineWidth = Math.max(1.5, ts * 0.045); g.lineCap = 'round';
    for (let q = 0; q < 3; q++) {
      const t = (q + 1) / 4, sl = ((cv.time * 1.6) % 1) * 0.12;
      const x = P(cp.x + (hp.x - cp.x) * t + ux * sl, ts), y = P(cp.y + (hp.y - cp.y) * t + uy * sl, ts), sz = ts * 0.12;
      g.beginPath(); g.moveTo(x - ux * sz - uy * sz, y - uy * sz + ux * sz); g.lineTo(x, y); g.lineTo(x - ux * sz + uy * sz, y - uy * sz - ux * sz); g.stroke();
    }
  }
}

// ───────────────────────── 5. 사람의 자세 ─────────────────────────
export interface PersonFx { recoil?: number; flinch?: { x: number; y: number }; throwAct?: number; ram?: boolean; irons?: boolean; glow?: number; lunge?: { x: number; y: number }; jitter?: { x: number; y: number } }
function flinchOf(book: FxBook, sid: number, tk: 0 | 1 | 2, target: number, x: number, y: number): { x: number; y: number } | undefined {
  const e = book.recentOn(sid, tk, target, 0.12);
  if (!e || !e.f?.c || e.f.c.ox === undefined) return undefined;
  const dx = x - e.f.c.ox, dy = y - (e.f.c.oy ?? y), d = Math.hypot(dx, dy) || 1, k = 1 - book.age(e) / 0.12;
  return { x: (dx / d) * 0.07 * k, y: (dy / d) * 0.07 * k };
}
/** 대원: 반동, 움찔, 섬광탄 던지기, 공성추, 진입 신호에 맞춘 발밑 테 */
export function agentFx(cv: CombatView, a: FieldAgent): PersonFx {
  const { book, s } = cv, out: PersonFx = {};
  for (const e of book.live(s.id)) {
    const c = e.f?.c; if (!c) continue;
    const age = book.age(e); if (age < 0) continue;
    if (e.kind === 'shot' && c.side === 0 && c.by === a.rid && age < 0.1) out.recoil = 1 - age / 0.1;
    else if (e.kind === 'flash' && c.by === a.rid && c.ox !== undefined && age < 0.28) out.throwAct = age / 0.28;
    else if (e.kind === 'breach' && c.by === a.rid && c.how === 'ram' && age < 0.4) out.ram = true;
    else if (e.kind === 'breach' && c.by === a.rid && c.how === 'irons' && age < 0.4) out.irons = true;      // (R1) 할리건으로 연 문: 0.4초 동안 할리건을 든 자세 (G5 §11 ⑤)
    else if (e.kind === 'breach' && c.sync && age < 0.4 && c.ox !== undefined && Math.hypot(a.x - c.ox, a.y - (c.oy ?? 0)) <= 2.6) out.glow = 1 - age / 0.4;
    else if (e.kind === 'taser' && c.tk === 0 && c.target === a.rid && c.res === 'hit' && age < 1.2) out.jitter = { x: Math.sin(cv.time * 190) * 0.02, y: Math.cos(cv.time * 170) * 0.02 };
  }
  out.flinch = flinchOf(book, s.id, 0, a.rid, a.x, a.y);
  return out;
}
/** 용의자: 반동, 움찔, 휘두르며 내딛기, 테이저 떨림 */
export function hostileFx(cv: CombatView, h: Hostile): PersonFx {
  const { book, s } = cv, out: PersonFx = {};
  for (const e of book.live(s.id)) {
    const c = e.f?.c; if (!c) continue;
    const age = book.age(e); if (age < 0) continue;
    if (e.kind === 'shot' && c.side === 1 && c.by === h.id && age < 0.1) out.recoil = 1 - age / 0.1;
    else if (e.kind === 'melee' && c.by === h.id && age < 0.12 && e.f!.x2 !== undefined) {
      const dx = e.f!.x2 - e.f!.x, dy = (e.f!.y2 ?? e.f!.y) - e.f!.y, d = Math.hypot(dx, dy) || 1, k = Math.sin((Math.PI * age) / 0.12) * 0.25;
      out.lunge = { x: (dx / d) * k, y: (dy / d) * k };
    } else if (e.kind === 'taser' && c.tk === 1 && c.target === h.id && c.res === 'hit' && age < 1.2) out.jitter = { x: Math.sin(cv.time * 190) * 0.02, y: Math.cos(cv.time * 170) * 0.02 };
  }
  out.flinch = flinchOf(book, s.id, 1, h.id, h.x, h.y);
  return out;
}
/** 구조 대상의 움찔 (빗나간 탄·시한 초과에 맞음) */
export function casualtyFlinch(cv: CombatView, id: number, x: number, y: number): { x: number; y: number } | undefined { return flinchOf(cv.book, cv.s.id, 2, id, x, y); }
/**
 * 무력화 표지: 섬광탄이 터진 반경 안에서 무력화된 용의자는 흰 별 고리('star'), 근처 4초 안에 섬광 기록이 없는 무력화(기습)는 노란 점('dots').
 * 깡통이 아직 날아가는 동안은 표지를 늦춘다('wait').
 */
export function stunMark(cv: CombatView, h: Hostile): 'star' | 'dots' | 'wait' {
  const { s, sim, book } = cv;
  let rec: Fx | null = null;
  for (const f of s.fx) if (f.kind === 'flash' && sim.t - f.t <= 4 && Math.hypot(f.x - h.x, f.y - h.y) <= 5.7) rec = f;
  if (!rec) return 'dots';
  for (const e of book.live(s.id)) if (e.f === rec) return book.age(e) < throwOf(rec) ? 'wait' : 'star';
  return 'star';
}
/** 흰 별 고리 (돌며 옅어짐) */
export function drawStunStars(g: G, x: number, y: number, ts: number, time: number, k: number): void {
  for (let q = 0; q < 5; q++) {
    const an = time * 3.2 + q * 1.2566, px = x + Math.cos(an) * ts * 0.38, py = y - ts * 0.12 + Math.sin(an) * ts * 0.18, r = Math.max(2, ts * 0.075);
    g.fillStyle = `rgba(255,255,255,${0.95 * k})`; g.beginPath();
    for (let i = 0; i < 8; i++) { const aa = (i / 8) * 6.2832, rad = i % 2 ? r * 0.4 : r; const xx = px + Math.cos(aa) * rad, yy = py + Math.sin(aa) * rad; if (i) g.lineTo(xx, yy); else g.moveTo(xx, yy); }
    g.closePath(); g.fill();
  }
}
/** 엄폐 자세: 위협 쪽에 반원형 회색 띠 */
export function drawCoverBand(cv: CombatView, a: FieldAgent, x: number, y: number): void {
  const { g, s, ts, truth } = cv;
  let ang = Math.atan2(a.fy, a.fx), bd = 14;
  for (const h of s.hostiles) {
    if ((h.state !== 'hold' && h.state !== 'fight') || (h.hidden && !truth)) continue;
    const d = Math.hypot(h.x - a.x, h.y - a.y); if (d < bd) { bd = d; ang = Math.atan2(h.y - a.y, h.x - a.x); }
  }
  g.strokeStyle = 'rgba(150,160,170,0.6)'; g.lineWidth = Math.max(2, ts * 0.09); g.lineCap = 'butt';
  g.beginPath(); g.arc(x, y, ts * 0.56, ang - 1.35, ang + 1.35); g.stroke();
}
/** 엄폐 배지: 반쪽 벽(벽돌 두 줄) 기호. 방패 기호는 쓰지 않는다(방패수·경찰 기호와 헷갈린다) */
export function drawCoverBadge(g: G, x: number, y: number, ts: number): void {
  const s = ts * 0.22, x0 = x - s / 2, y0 = y - s / 2;
  g.fillStyle = '#e8f0f7'; g.beginPath(); g.roundRect(x0 - s * 0.12, y0 - s * 0.12, s * 1.24, s * 1.24, s * 0.25); g.fill();
  g.fillStyle = '#3b444d';
  const bh = s * 0.4, gap = s * 0.08;
  g.fillRect(x0, y0 + s * 0.12, s * 0.46, bh - gap); g.fillRect(x0 + s * 0.54, y0 + s * 0.12, s * 0.46, bh - gap);
  g.fillRect(x0, y0 + s * 0.12 + bh, s * 0.2, bh - gap); g.fillRect(x0 + s * 0.28, y0 + s * 0.12 + bh, s * 0.44, bh - gap); g.fillRect(x0 + s * 0.8, y0 + s * 0.12 + bh, s * 0.2, bh - gap);
}
/** 진입 신호에 맞춘 진입조 발밑 테 (파랗게 0.4초) */
export function drawBreachGlow(g: G, x: number, y: number, ts: number, k: number): void {
  g.strokeStyle = `rgba(159,208,255,${0.9 * k})`; g.lineWidth = Math.max(2, ts * 0.09); g.beginPath(); g.arc(x, y, ts * 0.5, 0, 6.2832); g.stroke();
}

// ───────────────────────── 6·7. 어둠의 구멍 · 색 빛 ─────────────────────────
/** 어둠 층의 구멍: 총구 2.6칸, 섬광 6.5칸, 폭발 2r칸 (dg 는 어둠 층, k 는 그 배율) */
export function drawCombatHoles(cv: CombatView, dg: G, k: number): void {
  const { book, s, ts } = cv;
  for (const e of book.live(s.id)) {
    const a = book.age(e); if (a < 0 || !e.f) continue;
    if (e.kind === 'shot') { if (a < 0.25) { const L = shotLine(cv, e); hole(dg, P(L.mx, ts) * k, P(L.my, ts) * k, ts * 2.6 * k, 0.85 * (1 - a / 0.25)); } }
    else if (e.kind === 'flash') { const t = a - throwOf(e.f); if (t >= 0 && t < 0.71) hole(dg, P(e.x, ts) * k, P(e.y, ts) * k, ts * 6.5 * k, 1 - t / 0.71); }
    else if (e.kind === 'boom') { if (a < 0.8) hole(dg, P(e.x, ts) * k, P(e.y, ts) * k, ts * 2 * (e.f.c?.r ?? 3) * k, 1 - a / 0.8); }
  }
}
/** 색 빛 (가산 혼합 중에 부른다): 총구 빛, 섬광, 폭발 빛 */
export function drawCombatLights(cv: CombatView): void {
  const { g, book, s, ts, H } = cv;
  for (const e of book.live(s.id)) {
    const a = book.age(e); if (a < 0 || !e.f) continue;
    if (e.kind === 'shot' && a < 0.08) { const L = shotLine(cv, e), rifle = e.f.c?.wpn === 'rifle' || e.f.c?.wpn === 'sniper'; drawLight(g, P(L.mx, ts), P(L.my, ts), ts * (rifle ? 2.4 : 1.9), '#ffe2a0', 0.8 * (1 - a / 0.08)); }
    else if (e.kind === 'flash') { const t = a - throwOf(e.f); if (t >= 0 && t < 0.3) drawLight(g, P(e.x, ts), P(e.y, ts), Math.min(H * 0.5, ts * 3.6), '#ffffff', 0.9 * (1 - t / 0.3)); }
    else if (e.kind === 'boom' && a < 0.8) drawLight(g, P(e.x, ts), P(e.y, ts), Math.min(H * 0.6, ts * 2 * (e.f.c?.r ?? 3)), '#ff9a3c', 0.9 * (1 - a / 0.8));
  }
  g.globalAlpha = 1;
}

// ───────────────────────── 8. 효과 ─────────────────────────
/** 섬광탄 방 채움 → 폭발 → 예광선 → 탄착 → 피격 → 깡통·터짐 → 휘두름 → 테이저 → 진입 → 유리·가구 파편 */
export function drawCombatFx(cv: CombatView): void {
  const { book, s } = cv;
  const L = book.live(s.id);
  if (!L.length) return;
  const by: Record<string, FxEntry[]> = {};
  for (const e of L) { const a = book.age(e); if (a < 0 || a > e.dur) continue; (by[e.kind] ??= []).push(e); }
  if (cv.mini) { drawMini(cv, by); return; }
  for (const e of by.flash ?? []) flashFill(cv, e);
  for (const e of by.boom ?? []) boom(cv, e);
  for (const e of by.shot ?? []) tracer(cv, e);
  for (const e of by.shot ?? []) impact(cv, e);
  for (const e of by.hit ?? []) hitSpark(cv, e);
  for (const e of by.flash ?? []) flashCan(cv, e);
  for (const e of by.melee ?? []) melee(cv, e);
  for (const e of by.taser ?? []) taser(cv, e);
  for (const e of by.breach ?? []) breach(cv, e);
  for (const e of by.strike ?? []) strike(cv, e);
  for (const e of by.glass ?? []) drawGlassFx(cv.g, e.f!, cv.ts, clamp01(book.age(e) / e.dur));
  for (const e of by.debris ?? []) drawDebrisFx(cv.g, s, e.f!, cv.ts, clamp01(book.age(e) / e.dur));
  cv.g.globalAlpha = 1; cv.g.globalCompositeOperation = 'source-over';
}

function drawMini(cv: CombatView, by: Record<string, FxEntry[]>): void {
  const { g, book, ts } = cv;
  g.lineCap = 'round';
  for (const e of by.shot ?? []) {
    const a = book.age(e), Ls = shotLine(cv, e);
    if (a > Ls.fly + 0.1) continue;
    g.strokeStyle = sideOf(e.f!) ? FOE.core : ALLY.core; g.lineWidth = 1; g.globalAlpha = 1 - clamp01((a - Ls.fly) / 0.1);
    g.beginPath(); g.moveTo(P(Ls.mx, ts), P(Ls.my, ts)); g.lineTo(P(Ls.ix, ts), P(Ls.iy, ts)); g.stroke();
  }
  for (const e of by.flash ?? []) { const t = book.age(e) - throwOf(e.f!); if (t < 0 || t > 0.5) continue; g.globalAlpha = 1 - t / 0.5; g.fillStyle = '#ffffff'; g.beginPath(); g.arc(P(e.x, ts), P(e.y, ts), ts * (1 + 3 * t), 0, 6.2832); g.fill(); }
  for (const e of by.boom ?? []) {
    const a = book.age(e), r = e.f!.c?.r ?? 3; if (a > 0.7) continue; const k = a / 0.7;
    g.globalAlpha = 1 - k; g.fillStyle = '#ff9a3c'; g.beginPath(); g.arc(P(e.x, ts), P(e.y, ts), ts * r * 0.6 * (0.4 + 0.6 * k), 0, 6.2832); g.fill();
    g.strokeStyle = '#ffe8c8'; g.lineWidth = 1.5; g.beginPath(); g.arc(P(e.x, ts), P(e.y, ts), ts * r * 1.15 * k, 0, 6.2832); g.stroke();
  }
  for (const e of by.breach ?? []) { const a = book.age(e); if (!e.f!.c?.sync || a > 0.5) continue; g.globalAlpha = 1 - a / 0.5; g.strokeStyle = '#9fd0ff'; g.lineWidth = 1.5; g.beginPath(); g.arc(P(e.x, ts), P(e.y, ts), ts * (0.5 + 2 * a), 0, 6.2832); g.stroke(); }
  g.globalAlpha = 1;
}

function flashFill(cv: CombatView, e: FxEntry): void {
  const { g, s, ts, book } = cv, f = e.f!, t = book.age(e) - throwOf(f);
  if (t < 0 || t >= 0.71) return;
  const r = f.c?.r ?? 5.2, x = P(e.x, ts), y = P(e.y, ts), k = 1 - t / 0.71;
  visPoly(s, e.x, e.y, 0, 6.2832, r, poly);
  const gr = g.createRadialGradient(x, y, 0, x, y, r * ts);
  gr.addColorStop(0, `rgba(255,255,250,${0.75 * k})`); gr.addColorStop(0.55, `rgba(255,255,248,${0.35 * k})`); gr.addColorStop(1, 'rgba(255,255,245,0)');
  g.fillStyle = gr; g.beginPath(); g.moveTo(x, y);
  for (let i = 0; i < poly.length; i += 2) g.lineTo(P(poly[i], ts), P(poly[i + 1], ts));
  g.closePath(); g.fill();
}

function boom(cv: CombatView, e: FxEntry): void {
  const { g, book, ts, H } = cv, f = e.f!, a = book.age(e), r = f.c?.r ?? 3, x = P(e.x, ts), y = P(e.y, ts), seed = e.seed * 1000;
  const sp = fxSprites(), capR = H * 0.3;      // 화염구 지름 ≤ 화면 높이의 60%
  // 연기 0.3~2.8
  if (a >= 0.3 && a < 2.8) {
    const k = (a - 0.3) / 2.5;
    for (let q = 0; q < 8; q++) {
      const an = hash2(seed + q, 3) * 6.2832, dd = Math.min(capR, r * 1.3 * ts) * (0.25 + 0.75 * easeOut(k)) * (0.4 + 0.6 * hash2(q, seed + 1));
      const sz = Math.min(capR, ts * (0.9 + r * 0.45 * (0.4 + k)));
      g.globalAlpha = 0.6 * (1 - k) * Math.min(1, (a - 0.3) / 0.2);
      g.drawImage(sp.puffDark, x + Math.cos(an) * dd - sz / 2, y + Math.sin(an) * dd - sz / 2 - ts * 0.6 * k, sz, sz);
    }
    g.globalAlpha = 1;
  }
  // 화염구 0~0.6 + 섬광 0~0.1 (가산)
  if (a < 0.6) {
    g.globalCompositeOperation = 'lighter';
    const k = a / 0.6;
    for (let q = 0; q < 7; q++) {
      const col = q < 2 ? '#fff3d0' : q < 5 ? '#ffb347' : '#ff6a2a';
      const an = hash2(q, seed + 5) * 6.2832, off = ts * r * 0.25 * k * hash2(seed, q + 9);
      const rad = Math.min(capR, ts * r * 0.8 * (0.3 + 0.7 * easeOut(k)) * (0.55 + 0.45 * hash2(q + 2, seed)));
      drawLight(g, x + Math.cos(an) * off, y + Math.sin(an) * off, rad, col, 0.85 * (1 - k) * (q < 2 ? 1 - k : 1));
    }
    if (a < 0.1) drawLight(g, x, y, Math.min(capR, ts * r * 0.5 * 1.6), '#ffffff', 1 - a / 0.1);
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
  }
  // 충격파 0~0.35 (둘째 고리는 0.05초 늦게, 옅게)
  for (const [d0, aa] of [[0, 0.9], [0.05, 0.3]] as [number, number][]) {
    const t = a - d0; if (t < 0 || t >= 0.35) continue;
    const k = t / 0.35;
    g.strokeStyle = `rgba(255,240,215,${aa * (1 - k)})`; g.lineWidth = Math.max(1, ts * (0.18 - 0.16 * k));
    g.beginPath(); g.arc(x, y, Math.min(capR * 1.6, ts * (0.3 + (1.15 * r - 0.3) * easeOut(k))), 0, 6.2832); g.stroke();
  }
  // 파편 0~0.7
  if (a < 0.7) {
    const k = a / 0.7, e2 = easeOut(k);
    for (let q = 0; q < 12; q++) {
      const an = hash2(q * 7, seed + 11) * 6.2832, dd = ts * r * 1.1 * e2 * (0.35 + 0.65 * hash2(seed + q, 17)), lift = Math.sin(k * Math.PI) * ts * 0.5 * hash2(q, seed + 23);
      const px = x + Math.cos(an) * dd, py = y + Math.sin(an) * dd, rr = ts * (0.05 + 0.07 * hash2(q, 31));
      g.globalAlpha = k < 0.75 ? 1 : (1 - k) / 0.25;
      chip(g, px + ts * 0.02, py + ts * 0.03, rr * 0.9, an, 'rgba(0,0,0,0.3)', 4);
      chip(g, px, py - lift, rr, an + k * 9 * hash2(q, 5), q % 3 ? '#3a332d' : '#6b5a48', q % 2 ? 3 : 4);
    }
    g.globalAlpha = 1;
  }
}

function muzzleStar(cv: CombatView, e: FxEntry, mx: number, my: number, ang: number, a: number): void {
  const { g, ts, book } = cv, f = e.f!, w = f.c?.wpn, foe = sideOf(f) === 1, pal = foe ? FOE : ALLY;
  const dur = Math.max(0.06, 2 * (book.lastDt || 1 / 60) * Math.max(1, book.rate));
  if (a >= dur) return;
  if (w === 'beanbag') { g.fillStyle = 'rgba(220,220,220,0.6)'; g.beginPath(); g.arc(P(mx, ts), P(my, ts), ts * 0.12, 0, 6.2832); g.fill(); return; }
  const [len, wid, prongs] = w === 'rifle' ? [0.55, 0.22, 3] : w === 'sniper' ? [0.8, 0.3, 3] : w === 'pistol' ? [0.38, 0.16, 2] : [0.42, 0.2, 5];
  g.save(); g.translate(P(mx, ts), P(my, ts)); g.rotate(ang); g.scale(ts, ts);
  for (const [col, sc] of [[pal.flashOut, 1], [pal.flash, 0.6]] as [string, number][]) {
    g.fillStyle = col; g.beginPath(); g.moveTo(0, -wid * 0.5 * sc);
    for (let i = 0; i < prongs; i++) {
      const spread = prongs === 2 ? (i ? 0.35 : -0.35) : prongs === 3 ? (i - 1) * 0.45 : (i - 2) * 0.42;
      const jag = prongs === 5 ? 0.6 + 0.5 * hash2(i, e.seed * 997) : 1;
      const l = len * sc * jag * (i === (prongs >> 1) ? 1 : 0.7);
      g.lineTo(Math.cos(spread) * l, Math.sin(spread) * l);
      g.lineTo(Math.cos(spread + (prongs === 2 ? 0.35 : 0.22)) * wid * 0.4 * sc, Math.sin(spread + (prongs === 2 ? 0.35 : 0.22)) * wid * 0.4 * sc);
    }
    g.lineTo(0, wid * 0.5 * sc); g.closePath(); g.fill();
  }
  g.restore();
}

function tracer(cv: CombatView, e: FxEntry): void {
  const { g, ts, book } = cv, f = e.f!, a = book.age(e), Ls = shotLine(cv, e), foe = sideOf(f) === 1, pal = foe ? FOE : ALLY, w = f.c?.wpn;
  const ang = Math.atan2(Ls.uy, Ls.ux);
  muzzleStar(cv, e, Ls.mx, Ls.my, ang, a);
  const v = Ls.D / Ls.fly, head = a * v;
  const tailL = w === 'rifle' ? 1.6 : w === 'sniper' ? 2.4 : 1.1;
  const hd = Math.min(Ls.D, head), tl = Math.max(0, head - tailL);
  const at = (d: number): [number, number] => [P(Ls.mx + Ls.ux * d, ts), P(Ls.my + Ls.uy * d, ts)];
  if (w === 'beanbag') {
    if (head < Ls.D) { const [x, y] = at(hd); g.fillStyle = '#e8873a'; g.beginPath(); g.arc(x, y, Math.max(2, ts * 0.06), 0, 6.2832); g.fill(); }
  } else if (tl < Ls.D) {
    const fade = f.c?.stop === 'far' ? clamp01((Ls.D - hd) / 0.6 + (head < Ls.D ? 0.15 : 0)) : 1;
    const segs: [number, number][] = foe && hd - tl > 0.45 ? [[tl, (tl + hd) / 2 - 0.125], [(tl + hd) / 2 + 0.125, hd]] : [[tl, hd]];
    // 꼬리표 없는 옛 기록은 그 색으로
    const core = f.c ? pal.core : f.color ?? '#fff3c0', glow = f.c ? pal.glow : f.color ?? '#ffe9a8';
    g.lineCap = 'round';
    g.globalCompositeOperation = 'lighter'; g.globalAlpha = 0.35 * fade; g.strokeStyle = glow; g.lineWidth = ts * 0.14;
    for (const [s0, s1] of segs) { const [x0, y0] = at(s0), [x1, y1] = at(s1); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
    g.globalCompositeOperation = 'source-over'; g.globalAlpha = fade; g.strokeStyle = core; g.lineWidth = Math.max(1.5, ts * 0.045);
    for (const [s0, s1] of segs) { const [x0, y0] = at(s0), [x1, y1] = at(s1); g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); }
    g.globalAlpha = 1;
  }
  // 남은 줄: 머리가 닿은 뒤 0.25초
  const ra = a - Ls.fly;
  if (ra >= 0 && ra < 0.25) {
    const [x0, y0] = at(0), [x1, y1] = at(Ls.D);
    g.strokeStyle = foe ? '#ffd0b0' : '#cfe9ff'; g.globalAlpha = 0.25 * (1 - ra / 0.25); g.lineWidth = Math.max(1, ts * 0.02);
    g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke(); g.globalAlpha = 1;
  }
}

function impact(cv: CombatView, e: FxEntry): void {
  const { g, s, ts, book } = cv, f = e.f!, c = f.c;
  if (!c || !c.stop || c.stop === 'body' || c.stop === 'far') return;
  const Ls = shotLine(cv, e), ia = book.age(e) - Ls.fly;
  if (ia < 0) return;
  const x = P(Ls.ix, ts), y = P(Ls.iy, ts), back = Math.atan2(-Ls.uy, -Ls.ux), sp = fxSprites(), seed = e.seed * 1000;
  if (c.stop === 'wall') {
    if (ia < 0.8) { const k = ia / 0.8, d = ts * (0.6 + 0.5 * k); g.globalAlpha = 0.5 * (1 - k); g.drawImage(sp.puff, x - d / 2, y - d / 2, d, d); }
    if (ia < 0.12) {
      const k = ia / 0.12; g.strokeStyle = `rgba(255,226,160,${1 - k})`; g.lineWidth = Math.max(1, ts * 0.025); g.lineCap = 'round';
      for (let q = 0; q < 3; q++) { const an = back + (q - 1) * 0.6 + (hash2(q, seed) - 0.5) * 0.4, r0 = ts * 0.05 + ts * 0.15 * k, r1 = r0 + ts * 0.15; g.beginPath(); g.moveTo(x + Math.cos(an) * r0, y + Math.sin(an) * r0); g.lineTo(x + Math.cos(an) * r1, y + Math.sin(an) * r1); g.stroke(); }
    }
  } else if (ia < 0.5) {
    const k = ia / 0.5, e2 = easeOut(k);
    const door = c.stop === 'door';
    const tx = Math.round(Ls.ix + Ls.ux * 0.001), ty = Math.round(Ls.iy + Ls.uy * 0.001);      // 탄착점은 그 칸에 들어서는 가장자리: 탄이 나아가던 쪽으로 조금 들어가 칸을 고른다
    const cols = door ? ['#b98d56', '#7a5a36'] : rubbleColors(s.decor[ty * s.w + tx] ?? 0, tx, ty);
    const d0 = ts * (door ? 0.5 : 0.7) * (0.6 + 0.6 * e2); g.globalAlpha = 0.45 * (1 - k); g.drawImage(sp.puff, x - d0 / 2, y - d0 / 2, d0, d0);
    const n = door ? 4 : 5;
    for (let q = 0; q < n; q++) {
      const an = back + (hash2(q, seed + 3) - 0.5) * 1.6, dd = ts * (0.15 + 0.55 * hash2(seed, q + 1)) * e2, lift = Math.sin(k * Math.PI) * ts * 0.18;
      g.globalAlpha = k < 0.7 ? 1 : (1 - k) / 0.3;
      chip(g, x + Math.cos(an) * dd, y + Math.sin(an) * dd - lift, ts * (0.04 + 0.04 * hash2(q, 7)), an + k * 8, cols[q % cols.length], q % 2 ? 3 : 4);
    }
  }
  g.globalAlpha = 1;
}

function hitSpark(cv: CombatView, e: FxEntry): void {
  const { g, ts, book } = cv, f = e.f!, c = f.c, a = book.age(e);
  if (a >= 0.35) return;
  const k = a / 0.35, x = P(e.x, ts), y = P(e.y, ts);
  const dir = c && c.ox !== undefined ? Math.atan2(e.y - (c.oy ?? e.y), e.x - c.ox) : e.seed * 6.2832;
  const armor = !!c && c.tk === 0 && (c.arm ?? 0) > 0;
  const spark = armor ? '#cfe6ff' : '#fffbe8', ring = armor ? '#8fb6d8' : '#ffd9a0';
  // 퍼지는 흰 고리
  g.strokeStyle = ring; g.globalAlpha = 0.6 * (1 - k); g.lineWidth = Math.max(1, ts * 0.04);
  g.beginPath(); g.arc(x, y, ts * (0.18 + 0.45 * k), 0, 6.2832); g.stroke();
  // 불꽃 네 줄기: 탄이 온 방향의 반대쪽으로
  g.strokeStyle = spark; g.globalAlpha = 1 - k; g.lineWidth = Math.max(1.2, ts * 0.04); g.lineCap = 'round';
  for (let q = 0; q < 4; q++) {
    const an = dir + (q - 1.5) * 0.42 + (c ? 0 : q * 1.2), r0 = ts * (0.08 + 0.25 * k), r1 = r0 + ts * (0.24 * (1 - k) + 0.05);
    g.beginPath(); g.moveTo(x + Math.cos(an) * r0, y + Math.sin(an) * r0); g.lineTo(x + Math.cos(an) * r1, y + Math.sin(an) * r1); g.stroke();
  }
  // 회색 먼지 몇 점
  g.fillStyle = 'rgba(175,175,170,1)'; g.globalAlpha = 0.6 * (1 - k);
  for (let q = 0; q < 4; q++) { const an = hash2(q, e.seed * 331) * 6.2832, dd = ts * (0.15 + 0.35 * k); g.beginPath(); g.arc(x + Math.cos(an) * dd, y + Math.sin(an) * dd, Math.max(1, ts * 0.035), 0, 6.2832); g.fill(); }
  // 방호: 판 반짝임 하나
  if (armor && a < 0.18) {
    const gx = x - Math.cos(dir) * ts * 0.18, gy = y - Math.sin(dir) * ts * 0.18, r = ts * 0.12 * (1 - a / 0.18);
    g.fillStyle = '#eaf4ff'; g.globalAlpha = 1; g.beginPath(); g.moveTo(gx, gy - r); g.lineTo(gx + r * 0.35, gy); g.lineTo(gx, gy + r); g.lineTo(gx - r * 0.35, gy); g.closePath(); g.fill();
  }
  g.globalAlpha = 1;
}

function drawCan(g: G, x: number, y: number, ts: number, rot: number): void {
  g.save(); g.translate(x, y); g.rotate(rot);
  g.fillStyle = '#23282e'; g.fillRect(-ts * 0.09, -ts * 0.045, ts * 0.18, ts * 0.09);
  g.fillStyle = '#cfd6dc'; g.fillRect(-ts * 0.02, -ts * 0.045, ts * 0.035, ts * 0.09);
  g.restore();
}
function flashCan(cv: CombatView, e: FxEntry): void {
  const { g, ts, book } = cv, f = e.f!, c = f.c, a = book.age(e), t0 = throwOf(f);
  if (t0 > 0 && a < t0) {
    const o = c && c.by !== undefined ? originOf(cv, f) : { x: c!.ox!, y: c!.oy! };
    if (a < 0.28) {
      const k = a / 0.28, gx = o.x + (e.x - o.x) * k, gy = o.y + (e.y - o.y) * k, lift = Math.min(1.4, Math.hypot(e.x - o.x, e.y - o.y) * 0.25) * Math.sin(Math.PI * k);
      g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); g.ellipse(P(gx, ts), P(gy, ts), ts * 0.1, ts * 0.05, 0, 0, 6.2832); g.fill();
      drawCan(g, P(gx, ts), P(gy - lift, ts), ts, a * 3 * 6.2832);
    } else {
      const k = (a - 0.28) / 0.06, lift = 0.12 * Math.sin(Math.PI * clamp01(k));
      drawCan(g, P(e.x, ts), P(e.y - lift, ts), ts, 1.2 + k);
    }
    return;
  }
  const t = a - t0, x = P(e.x, ts), y = P(e.y, ts);
  if (t >= 0 && t < 0.12) {
    const k = t / 0.12;
    g.globalCompositeOperation = 'lighter';
    g.fillStyle = `rgba(255,255,255,${0.95 * (1 - k * 0.5)})`; g.beginPath(); g.arc(x, y, ts * (0.6 + 1.4 * k), 0, 6.2832); g.fill();
    g.strokeStyle = `rgba(255,255,240,${1 - k})`; g.lineWidth = Math.max(1.5, ts * 0.05); g.lineCap = 'round';
    for (let q = 0; q < 8; q++) { const an = (q / 8) * 6.2832 + e.seed, r0 = ts * 0.3, r1 = ts * 1.8 * (0.6 + 0.4 * k); g.beginPath(); g.moveTo(x + Math.cos(an) * r0, y + Math.sin(an) * r0); g.lineTo(x + Math.cos(an) * r1, y + Math.sin(an) * r1); g.stroke(); }
    g.globalCompositeOperation = 'source-over';
  }
  // 잔광: 옅은 고리, 작은 불씨, 옅은 회색 연기
  if (t >= 0.71 - 0.0 && t < 1.96) {
    const k = (t - 0.71) / 1.25;
    g.strokeStyle = `rgba(255,255,255,${0.3 * (1 - k)})`; g.lineWidth = Math.max(1, ts * 0.03); g.beginPath(); g.arc(x, y, ts * (1.2 + 1.2 * k), 0, 6.2832); g.stroke();
    g.fillStyle = `rgba(255,214,150,${0.8 * (1 - k)})`;
    for (let q = 0; q < 3; q++) { const an = hash2(q, e.seed * 77) * 6.2832, dd = ts * 0.35 * (0.5 + k); g.beginPath(); g.arc(x + Math.cos(an) * dd, y + Math.sin(an) * dd, Math.max(1, ts * 0.03), 0, 6.2832); g.fill(); }
    const sp = fxSprites(), d = ts * 1.2 * (0.8 + 0.4 * k);
    g.globalAlpha = 0.35 * (1 - k); g.drawImage(sp.puff, x - d / 2, y - d / 2 - ts * 0.3 * k, d, d); g.globalAlpha = 1;
  }
}

function melee(cv: CombatView, e: FxEntry): void {
  const { g, ts, book } = cv, f = e.f!, a = book.age(e);
  if (a >= 0.15 || f.x2 === undefined) return;
  const o = originOf(cv, f), dir = Math.atan2((f.y2 ?? f.y) - f.y, f.x2 - f.x), k = a / 0.15;
  const knife = f.c?.wpn === 'knife', R = ts * (knife ? 0.62 : 0.42);
  const x = P(o.x, ts), y = P(o.y, ts), a0 = dir - 0.9, a1 = a0 + 1.8 * easeOut(k);
  g.strokeStyle = `rgba(255,255,255,${0.9 * (1 - k * 0.6)})`; g.lineWidth = Math.max(1.5, ts * (knife ? 0.03 : 0.085)); g.lineCap = 'round';
  g.beginPath(); g.arc(x, y, R, a0, a1); g.stroke();
}

function taser(cv: CombatView, e: FxEntry): void {
  const { g, ts, book } = cv, f = e.f!, c = f.c, a = book.age(e);
  if (f.x2 === undefined) return;
  const o = originOf(cv, f), hit = c?.res === 'hit';
  let tx = f.x2, ty = f.y2 ?? f.y;
  const d = Math.hypot(tx - o.x, ty - o.y) || 1, ux = (tx - o.x) / d, uy = (ty - o.y) / d;
  if (!hit) { tx -= ux * 0.45; ty -= uy * 0.45; }
  const k = clamp01(a / 0.06), fade = a > 1.2 ? clamp01(1 - (a - 1.2) / 0.3) : 1;
  const ex = o.x + (tx - o.x) * k, ey = o.y + (ty - o.y) * k;
  g.strokeStyle = '#dfe7ee'; g.lineWidth = 1; g.globalAlpha = fade;
  for (const off of [-0.06, 0.06]) {
    const sag = (hit ? 0.15 : 0.3) * (a > 0.06 ? 1 : k);
    const mx = (o.x + ex) / 2 - uy * off + 0.0, my = (o.y + ey) / 2 + ux * off + sag;
    g.beginPath(); g.moveTo(P(o.x + ux * 0.4, ts), P(o.y + uy * 0.4, ts)); g.quadraticCurveTo(P(mx, ts), P(my, ts), P(ex - uy * off, ts), P(ey + ux * off, ts)); g.stroke();
  }
  if (hit && a > 0.06 && a < 1.2) {
    const on = Math.floor(book.clock * 30) % 2 === 0;
    for (let q = 0; q < 4; q++) { const an = q * 1.5708 + book.clock * 7, r = ts * 0.32; g.fillStyle = on ? '#b8e4ff' : '#ffffff'; g.beginPath(); g.arc(P(tx, ts) + Math.cos(an) * r, P(ty, ts) + Math.sin(an) * r, Math.max(1.2, ts * 0.04), 0, 6.2832); g.fill(); }
  }
  g.globalAlpha = 1;
}

function breach(cv: CombatView, e: FxEntry): void {
  const { g, s, ts, book } = cv, f = e.f!, c = f.c, a = book.age(e);
  if (!c) return;
  const x = P(e.x, ts), y = P(e.y, ts);
  let ix = e.x - (c.ox ?? e.x), iy = e.y - (c.oy ?? e.y);
  if (Math.hypot(ix, iy) < 0.1) { ix = s.w / 2 - e.x; iy = s.h / 2 - e.y; if (Math.abs(ix) > Math.abs(iy)) iy = 0; else ix = 0; }
  const il = Math.hypot(ix, iy) || 1; ix /= il; iy /= il;
  const sp = fxSprites(), seed = e.seed * 1000;
  if (c.sync) {
    if (a < 0.6) {
      const k = a / 0.6; g.strokeStyle = `rgba(159,208,255,${0.95 * (1 - k)})`; g.lineWidth = Math.max(2, ts * 0.08); g.lineCap = 'round'; g.lineJoin = 'round';
      for (let q = 0; q < 3; q++) {
        const d = 0.2 + q * 0.42 + 1.3 * easeOut(k), px = P(e.x + ix * d, ts), py = P(e.y + iy * d, ts), sz = ts * 0.22;
        g.beginPath(); g.moveTo(px - ix * sz - iy * sz, py - iy * sz + ix * sz); g.lineTo(px, py); g.lineTo(px - ix * sz + iy * sz, py - iy * sz - ix * sz); g.stroke();
      }
    }
    if (a < 0.5) { const k = a / 0.5; g.strokeStyle = `rgba(159,208,255,${0.8 * (1 - k)})`; g.lineWidth = Math.max(1.5, ts * 0.06); g.beginPath(); g.arc(x, y, ts * (0.4 + 1.2 * easeOut(k)), 0, 6.2832); g.stroke(); }
  }
  const how = c.how ?? 'open';
  if (how === 'open' || how === 'push' || c.door === undefined || c.door < 0) return;
  // 걸쇠 자리: 문짝은 -0.4 에 경첩, 걸쇠는 +0.3 (벽 방향)
  const hor = doorHorizontal(s, Math.round(e.x), Math.round(e.y));
  const lx = P(e.x + (hor ? 0.3 : 0), ts), ly = P(e.y + (hor ? 0 : 0.3), ts);
  const spark = (n: number, col: string, dur: number): void => {
    if (a >= dur) return;
    const k = a / dur; g.strokeStyle = col; g.globalAlpha = 1 - k; g.lineWidth = Math.max(1, ts * 0.03); g.lineCap = 'round';
    for (let q = 0; q < n * 3; q++) { const an = hash2(q, seed) * 6.2832, r0 = ts * 0.05, r1 = r0 + ts * (0.18 + 0.2 * k); g.beginPath(); g.moveTo(lx + Math.cos(an) * r0, ly + Math.sin(an) * r0); g.lineTo(lx + Math.cos(an) * r1, ly + Math.sin(an) * r1); g.stroke(); }
    g.globalAlpha = 1;
  };
  const [chips, dustR, dustT] = how === 'kick' ? [5, 0.8, 0.8] : how === 'ram' ? [8, 1.1, 1.0] : how === 'irons' ? [6, 1.0, 1.0] : how === 'hydraulic' ? [0, 0, 0] : [0, 0, 0];
  if (how === 'ram') spark(1, '#ffffff', 0.08);
  else if (how === 'irons') spark(2, '#ffe2a0', 0.1);
  else if (how === 'hydraulic') spark(1, '#ffe2a0', 0.12);
  if (dustR > 0 && a < dustT) { const k = a / dustT, d = ts * dustR * (0.6 + 0.8 * easeOut(k)); g.globalAlpha = 0.5 * (1 - k); g.drawImage(sp.puff, lx - d / 2 + ix * ts * 0.3 * k, ly - d / 2 + iy * ts * 0.3 * k, d, d); g.globalAlpha = 1; }
  if (chips > 0 && a < 0.5) {
    const k = a / 0.5, e2 = easeOut(k);
    for (let q = 0; q < chips; q++) {
      const an = Math.atan2(iy, ix) + (hash2(q, seed + 7) - 0.5) * 1.5, dd = ts * (0.2 + 0.9 * hash2(seed, q + 3)) * e2, lift = Math.sin(k * Math.PI) * ts * 0.2;
      g.globalAlpha = k < 0.7 ? 1 : (1 - k) / 0.3;
      chip(g, lx + Math.cos(an) * dd, ly + Math.sin(an) * dd - lift, ts * (0.04 + 0.05 * hash2(q, 11)), an + k * 9, q % 2 ? '#b98d56' : '#7a5a36', q % 2 ? 3 : 4);
    }
    g.globalAlpha = 1;
  }
}

function strike(cv: CombatView, e: FxEntry): void {
  const { g, ts, book } = cv, a = book.age(e);
  if (a >= 0.5) return;
  const k = a / 0.5, x = P(e.x, ts), y = P(e.y, ts), sp = fxSprites(), d = ts * 0.5 * (0.7 + 0.6 * k);
  g.globalAlpha = 0.45 * (1 - k); g.drawImage(sp.puff, x - d / 2, y - d / 2, d, d);
  if (a < 0.1) { const an = e.seed * 6.2832; g.strokeStyle = '#ffe2a0'; g.globalAlpha = 1 - a / 0.1; g.lineWidth = Math.max(1, ts * 0.03); g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(an) * ts * 0.3, y + Math.sin(an) * ts * 0.3); g.stroke(); }
  g.globalAlpha = 1;
}

// ───────────────────────── 9. 이름표 단계 ─────────────────────────
/** 3-2-1 (남은 시간 left ≤ 3) 또는 신호 대기(left ≤ 0) — 진입 지점 하나 */
export function drawCountdown(cv: CombatView, ex: number, ey: number, left: number): void {
  if (cv.mini) return;
  const { g, ts, book, s } = cv, x = P(ex, ts), y = P(ey, ts);
  if (left <= 0) {
    const pr = 0.5 + 0.5 * Math.sin(cv.time * 14);
    g.strokeStyle = `rgba(255,180,84,${0.55 + 0.4 * pr})`; g.lineWidth = Math.max(2, ts * 0.08);
    g.beginPath(); g.arc(x, y, ts * (0.9 + 0.12 * pr), 0, 6.2832); g.stroke();
    return;
  }
  const n = Math.max(1, Math.min(3, Math.ceil(left - 1e-9)));
  g.lineWidth = Math.max(2.5, ts * 0.1); g.lineCap = 'round';
  for (let q = 0; q < 3; q++) {
    const a0 = -Math.PI / 2 + q * (6.2832 / 3) + 0.12, a1 = a0 + 6.2832 / 3 - 0.24;
    g.strokeStyle = q < n ? '#9fd0ff' : 'rgba(159,208,255,0.18)';
    g.beginPath(); g.arc(x, y, ts * 0.9, a0, a1); g.stroke();
  }
  const tk = book.lastTick(s.id), ta = tk && tk.n === n ? book.age(tk) : 1;
  const sc = 1 + 0.25 * clamp01(1 - ta / 0.25);
  const fs = Math.round(ts * 0.78 * sc);
  g.font = `800 ${fs}px Pretendard, 'Noto Sans KR', system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
  g.lineWidth = Math.max(3, ts * 0.12); g.strokeStyle = 'rgba(8,13,18,0.9)'; g.strokeText(String(n), x, y + ts * 0.03);
  g.fillStyle = '#ffffff'; g.fillText(String(n), x, y + ts * 0.03);
}

function bubble(g: G, x: number, y: number, r: number, fill: string, stroke: string, tailDx: number): void {
  g.fillStyle = fill; g.strokeStyle = stroke; g.lineWidth = Math.max(1, r * 0.12);
  g.beginPath(); g.ellipse(x, y, r * 1.35, r, 0, 0, 6.2832); g.fill(); g.stroke();
  g.beginPath(); g.moveTo(x + tailDx * r * 0.5, y + r * 0.8); g.lineTo(x + tailDx * r * 1.1, y + r * 1.6); g.lineTo(x + tailDx * r * 0.05, y + r * 0.95); g.closePath(); g.fill();
}
/** 협상: 대원 쪽 말풍선(점 셋), 쉬는 사이 용의자 쪽 풍선(동요하면 물결 테), 협상이 끊기면 용의자 쪽 뾰족한 붉은 풍선 */
export function drawNegotiation(cv: CombatView): void {
  if (cv.mini) return;
  const { g, s, ts, book, alpha, truth } = cv;
  for (const a of s.agents) {
    if (a.status !== 'active' || !a.task || a.task.kind !== 'negotiate' || a.task.phase < 1) continue;
    const h = s.hostiles[a.task.hostile];
    if (!h || (h.state !== 'hold' && h.state !== 'fight')) continue;
    const ap = ipos(a, alpha), hp = ipos(h, alpha), r = ts * 0.2;
    const hx = P(hp.x, ts) + ts * 0.5, hy = P(hp.y, ts) - ts * 1.05;
    if (h.state === 'fight') {
      if (h.hidden && !truth) continue;
      // 뾰족한 붉은 테 + 번개
      g.fillStyle = 'rgba(255,240,240,0.95)'; g.strokeStyle = '#ff4d4d'; g.lineWidth = Math.max(1.5, ts * 0.04);
      g.beginPath(); for (let i = 0; i < 14; i++) { const an = (i / 14) * 6.2832, rr = i % 2 ? r * 1.0 : r * 1.55; const px = hx + Math.cos(an) * rr * 1.2, py = hy + Math.sin(an) * rr; if (i) g.lineTo(px, py); else g.moveTo(px, py); } g.closePath(); g.fill(); g.stroke();
      g.fillStyle = '#e8352f'; g.beginPath(); g.moveTo(hx + r * 0.15, hy - r * 0.7); g.lineTo(hx - r * 0.35, hy + r * 0.1); g.lineTo(hx, hy + r * 0.1); g.lineTo(hx - r * 0.15, hy + r * 0.7); g.lineTo(hx + r * 0.35, hy - r * 0.1); g.lineTo(hx, hy - r * 0.1); g.closePath(); g.fill();
      continue;
    }
    const ph = talkPhase(book.clock, a.rid);
    if (ph < TALK) {
      const bx = P(ap.x, ts) + ts * 0.5, by = P(ap.y, ts) - ts * 1.05;
      bubble(g, bx, by, r, 'rgba(255,255,255,0.95)', 'rgba(8,13,18,0.6)', -1);
      const lit = Math.floor((ph / TALK) * 9) % 3;
      for (let q = 0; q < 3; q++) { g.fillStyle = q === lit ? '#1b2530' : 'rgba(27,37,48,0.3)'; g.beginPath(); g.arc(bx + (q - 1) * r * 0.55, by, Math.max(1.2, r * 0.17), 0, 6.2832); g.fill(); }
    } else if (!(h.hidden && !truth)) {
      const shaken = h.morale < 0.42;
      if (shaken) {
        g.fillStyle = 'rgba(255,248,230,0.95)'; g.strokeStyle = '#ffb454'; g.lineWidth = Math.max(1, ts * 0.03);
        g.beginPath(); for (let i = 0; i <= 24; i++) { const an = (i / 24) * 6.2832, rr = r * (1 + 0.12 * Math.sin(an * 6 + cv.time * 6)); const px = hx + Math.cos(an) * rr * 1.35, py = hy + Math.sin(an) * rr; if (i) g.lineTo(px, py); else g.moveTo(px, py); } g.closePath(); g.fill(); g.stroke();
      } else bubble(g, hx, hy, r, 'rgba(255,236,236,0.95)', 'rgba(8,13,18,0.6)', -1);
      g.fillStyle = '#3a2a2a';
      for (let q = 0; q < 2; q++) { g.beginPath(); g.arc(hx + (q - 0.5) * r * 0.6, hy, Math.max(1.2, r * 0.16), 0, 6.2832); g.fill(); }
    }
  }
}

/** 검거: 용의자 머리 위 수갑 기호 (0.15초에 커져 1.2초 머물고 0.5초에 사라진다) + 딸깍 고리, 덮쳤으면 돌진 선과 먼지 */
export function drawCuffs(cv: CombatView): void {
  if (cv.mini) return;
  const { g, s, ts, book, alpha } = cv;
  for (const e of book.live(s.id)) {
    if (e.kind !== 'cuff' || !e.f?.c) continue;
    const a = book.age(e); if (a < 0 || a > e.dur) continue;
    const c = e.f.c, h = s.hostiles.find((q) => q.id === c.target);
    const hp = h ? ipos(h, alpha) : { x: e.x, y: e.y }, x = P(hp.x, ts), y = P(hp.y, ts);
    if (c.arrest === 'tackle' && a < 0.4 && c.ox !== undefined) {
      const k = a / 0.4; g.strokeStyle = `rgba(232,240,247,${0.7 * (1 - k)})`; g.lineWidth = Math.max(1.5, ts * 0.06); g.lineCap = 'round'; g.setLineDash([ts * 0.12, ts * 0.1]);
      g.beginPath(); g.moveTo(P(c.ox, ts), P(c.oy ?? hp.y, ts)); g.lineTo(x, y); g.stroke(); g.setLineDash([]);
      const sp = fxSprites(), d = ts * (0.6 + 0.6 * k); g.globalAlpha = 0.45 * (1 - k); g.drawImage(sp.puff, x - d / 2, y - d / 2 + ts * 0.2, d, d); g.globalAlpha = 1;
    }
    if (a < 0.3) { const k = a / 0.3; g.strokeStyle = `rgba(255,255,255,${0.9 * (1 - k)})`; g.lineWidth = Math.max(1.5, ts * 0.05); g.beginPath(); g.arc(x, y - ts * 0.9, ts * (0.15 + 0.35 * k), 0, 6.2832); g.stroke(); }
    const sc = a < 0.15 ? a / 0.15 : 1, al = a > 1.35 ? clamp01(1 - (a - 1.35) / 0.5) : 1;
    const size = ts * 0.62 * sc;
    g.save(); g.translate(x - size / 2, y - ts * 0.9 - size / 2); g.scale(size / 24, size / 24); g.globalAlpha = al;
    g.fillStyle = 'rgba(8,13,18,0.85)'; g.beginPath(); g.arc(12, 12, 12.5, 0, 6.2832); g.fill();
    g.strokeStyle = '#eef3f7'; g.lineWidth = 2.2;
    if (typeof Path2D !== 'undefined') { g.stroke(new Path2D(CUFF_PATH)); }
    else { g.beginPath(); g.arc(7, 11, 4.5, 0, 6.2832); g.stroke(); g.beginPath(); g.arc(17, 11, 4.5, 0, 6.2832); g.stroke(); }
    g.restore(); g.globalAlpha = 1;
  }
}

// ───────────────────────── 10. 화면 막 ─────────────────────────
/** 관찰자 흰 막과 폭발 주황 막 (화면 좌표, 비네트 다음). 둘을 합쳐 실제 시간 2.5초에 한 번 */
export function drawScreenVeil(g: G, book: FxBook, sid: number, w: number, h: number, view: { cx: number; cy: number; hw: number; hh: number }, reduced: boolean): void {
  let wa = book.whiteout(sid, view), oa = book.orange(sid, view);
  if (reduced) { wa = Math.min(wa, 0.15); oa *= 0.04 / 0.12; }
  if (wa > 0.004) { g.fillStyle = `rgba(255,255,255,${wa})`; g.fillRect(0, 0, w, h); }
  if (oa > 0.004) { g.fillStyle = `rgba(255,150,60,${oa})`; g.fillRect(0, 0, w, h); }
}
