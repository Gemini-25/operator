// 교전 연출 기록 (docs/specs/G5-combat-fx.md). 이 파일은 s.fx 에 기록을 넣거나 방금 넣은 기록에 꼬리표(c)를 붙이기만 한다.
// 난수 금지, 기록(로그) 금지, s.fx 밖의 상태를 쓰지 않는다. 시뮬레이션은 s.fx 를 읽지 않는다(sceneManager 의 정리 한 줄뿐).
// 이 파일은 진실(용의자·구조 대상의 실제 자리)을 읽지만 판단하지 않는다: 그림과 소리에 쓸 꼬리표만 남긴다.
import type { Sim } from '../engine';
import type { ArrestHow, BreachHow, Casualty, FieldAgent, Fx, FxInfo, FxWeapon, Hostile, Scene } from '../types';
import { coverTile, rayEnd } from './damage';

/** 시험용 스위치: 끄면 꼬리표와 새 기록을 남기지 않는다. 켜고 끈 두 실행의 결과가 같아야 한다(tests/combatfx.test.ts) */
export const FXLOG = { on: true };

/** s.fx 의 상한 (hazards.pushFx·damage 의 지역 fx 와 같다) */
const FX_CAP = 60;

/** 이 틱(sim.t)에 넣은 kind 기록 가운데 가장 최근 것. 뒤에서 6개까지만 본다. 없으면 null */
export function lastFx(sim: Sim, s: Scene, kind: Fx['kind']): Fx | null {
  for (let i = s.fx.length - 1, k = 0; i >= 0 && k < 6; i--, k++) {
    const f = s.fx[i];
    if (f.t !== sim.t) return null;
    if (f.kind === kind) return f;
  }
  return null;
}

/** 새 기록. hazards.pushFx 와 같은 모양(모든 칸을 같은 순서로 채운다: kind,t,x,y,x2,y2,text,color,ttl,c)과 같은 상한(60) */
export function recFx(sim: Sim, s: Scene, kind: Fx['kind'], x: number, y: number, x2: number | undefined, y2: number | undefined, ttl: number, c: FxInfo, color?: string): Fx | null {
  if (!FXLOG.on) return null;
  const f: Fx = { kind, t: sim.t, x, y, x2, y2, text: undefined, color, ttl, c };
  s.fx.push(f);
  if (s.fx.length > FX_CAP) s.fx.splice(0, s.fx.length - FX_CAP);
  return f;
}

/** 대원의 무기: 지금은 부대 종류로 정한다 — tactical·swat 'rifle', 그 밖 'pistol'. R1(개인 장비)이 들어오면 sniper > rifle > pistol 을 장비로 고른다 */
export function weaponOf(sim: Sim, a: FieldAgent): FxWeapon {
  const k = sim.units[a.unitId]?.kind;
  return k === 'tactical' || k === 'swat' ? 'rifle' : 'pistol';
}

/**
 * 사격 기록에 꼬리표. tx,ty = 사격을 받은 사람의 자리(흔들기 전).
 *  맞음        → res 'hit',   ix,iy = f.x2,f.y2,  stop 'body'
 *  빗나감+엄폐 → coverTile(s, tx, ty, f.x, f.y) 가 있으면 res 'cover', ix,iy = 그 칸 가운데에서 쏜 쪽으로 0.45칸, stop 'furn'
 *  빗나감      → res 'miss',  rayEnd(s, f.x, f.y, f.x2, f.y2, 3) 의 자리와 stop ('wall' | 'door' | 'far')
 */
export function noteShot(sim: Sim, s: Scene, f: Fx | null, o: { side: 0 | 1; by: number; wpn: FxWeapon; hit: boolean; cover: boolean; tx: number; ty: number; tk: 0 | 1 | 2; target: number; arm?: number }): void {
  if (!FXLOG.on || !f) return;
  const ex = f.x2 ?? o.tx, ey = f.y2 ?? o.ty;
  const c: FxInfo = { side: o.side, by: o.by, wpn: o.wpn, tk: o.tk, target: o.target };
  if (o.arm !== undefined) c.arm = o.arm;
  if (o.hit) { c.res = 'hit'; c.ix = ex; c.iy = ey; c.stop = 'body'; }
  else {
    const ct = o.cover ? coverTile(s, o.tx, o.ty, f.x, f.y) : -1;
    if (ct >= 0) {
      const cx = ct % s.w, cy = (ct / s.w) | 0, d = Math.hypot(f.x - cx, f.y - cy);
      c.res = 'cover'; c.stop = 'furn';
      c.ix = d > 0.01 ? cx + ((f.x - cx) / d) * 0.45 : cx; c.iy = d > 0.01 ? cy + ((f.y - cy) / d) * 0.45 : cy;
    } else {
      const e = rayEnd(s, f.x, f.y, ex, ey, 3);
      c.res = 'miss'; c.ix = e.x; c.iy = e.y; c.stop = e.stop;
    }
  }
  f.c = c;
}

/**
 * 빗나간 탄이 인질을 맞혔다(executor 의 인질 피격 분기): shot.c 를 res 'miss'(탄은 용의자를 빗나갔다 — 엄폐로 'cover' 였어도 'miss' 로 바꾼다),
 * stop 'body', tk 2, target = 인질 id, ix,iy = 인질 자리로 고치고, 인질 자리에 'hit' 기록(c: side, ox,oy = 쏜 자리, tk 2, target)을 더한다
 */
export function noteCollateral(sim: Sim, s: Scene, shot: Fx | null, hc: Casualty, sx: number, sy: number): void {
  if (!FXLOG.on) return;
  const side = shot?.c?.side ?? 0;
  if (shot && shot.c) { shot.c.res = 'miss'; shot.c.stop = 'body'; shot.c.tk = 2; shot.c.target = hc.id; shot.c.ix = hc.x; shot.c.iy = hc.y; }
  recFx(sim, s, 'hit', hc.x, hc.y, undefined, undefined, 1.2, { side, ox: sx, oy: sy, tk: 2, target: hc.id });
}

export function noteHit(f: Fx | null, o: { side: 0 | 1; ox: number; oy: number; tk: 0 | 1 | 2; target: number; arm?: number }): void {
  if (!FXLOG.on || !f) return;
  const c: FxInfo = { side: o.side, ox: o.ox, oy: o.oy, tk: o.tk, target: o.target };
  if (o.arm !== undefined) c.arm = o.arm;
  f.c = c;
}

/** 섬광탄: c = { side 0, by: 던진 사람 rid, ox, oy: 던진 사람 자리, r: 5.2, n }. by 가 없으면(옛 호출) ox,oy 를 비운다 */
export function noteFlash(f: Fx | null, by: FieldAgent | undefined, n: number): void {
  if (!FXLOG.on || !f) return;
  f.c = by ? { side: 0, by: by.rid, ox: by.x, oy: by.y, r: 5.2, n } : { side: 0, r: 5.2, n };
}

export function noteBoom(f: Fx | null, r: number, src: NonNullable<FxInfo['src']>): void {
  if (!FXLOG.on || !f) return;
  f.c = { r, src };
}

/**
 * 기존 사격 줄이 없는 새 사격 코드(R2 의 비살상탄·저격, R1 의 저격 소총이 따로 쏘는 경우)를 위한 한 줄짜리 기록:
 * 'shot'(색은 side 로) + noteShot + 맞았으면 'hit' + noteHit. 판정(hit)은 부른 쪽이 이미 정한 값을 넘긴다 — 여기서 난수를 쓰지 않고, bulletPath 도 부르지 않는다.
 * 빗나간 탄의 그림 끝점은 목표 옆으로 0.6칸 비킨 자리(틱의 홀짝으로 좌우를 정한다).
 * hostage: 빗나간 탄이 인질을 다치게 했으면 그 인질. 주면 noteCollateral 까지 한다.
 */
export function recShot(sim: Sim, s: Scene, a: FieldAgent, wpn: FxWeapon, tx: number, ty: number, hit: boolean, tk: 0 | 1 | 2, target: number, hostage?: Casualty | null): void {
  if (!FXLOG.on) return;
  let ex = tx, ey = ty;
  if (!hit) {
    const d = Math.hypot(tx - a.x, ty - a.y) || 1, side = sim.tick % 2 ? 0.6 : -0.6;
    ex = tx - ((ty - a.y) / d) * side; ey = ty + ((tx - a.x) / d) * side;
  }
  const shot = recFx(sim, s, 'shot', a.x, a.y, ex, ey, 0.25, {}, '#ffe08a');
  noteShot(sim, s, shot, { side: 0, by: a.rid, wpn, hit, cover: false, tx, ty, tk, target });
  if (hit) noteHit(recFx(sim, s, 'hit', tx, ty, undefined, undefined, 1.2, {}), { side: 0, ox: a.x, oy: a.y, tk, target });
  if (hostage) noteCollateral(sim, s, shot, hostage, a.x, a.y);
}

export function recBreach(sim: Sim, s: Scene, x: number, y: number, fromX: number, fromY: number, o: { door: number; how: BreachHow; n: number; sync: boolean; by: number; forced: boolean }): void {
  if (!FXLOG.on) return;
  recFx(sim, s, 'breach', x, y, undefined, undefined, 1.5, { by: o.by, ox: fromX, oy: fromY, door: o.door, how: o.how, n: o.n, sync: o.sync, forced: o.forced });
}

/**
 * 진입 방법(그림·소리만 쓴다). 시뮬레이션은 방법을 다루지 않으므로 상태에서만 정한다 — 난수를 쓰지 않는다.
 *  이미 열린 문 → 'open'
 *  잠긴 문      → 진입조에 경찰이 있으면 'ram', 소방이면 'irons', 그 밖 'kick'
 *  닫힌 문      → 진입조에 swat 가 있으면 'ram', tactical 이면 'kick', 그 밖 'push'
 * R1 이 들어오면 진입조에 breachKit 을 든 사람이 있으면 'ram', irons 를 든 사람이면 'irons' 로 본다. 'charge' 는 여기서 고르지 않는다.
 */
export function breachHowFor(sim: Sim, team: FieldAgent[], wasLocked: boolean, wasOpen: boolean): BreachHow {
  if (wasOpen) return 'open';
  const depts = team.map((b) => sim.responders[b.rid]?.dept);
  if (wasLocked) return depts.includes('police') ? 'ram' : depts.includes('fire') ? 'irons' : 'kick';
  const kinds = team.map((b) => sim.units[b.unitId]?.kind);
  return kinds.includes('swat') ? 'ram' : kinds.includes('tactical') ? 'kick' : 'push';
}

/** 흉기·맨손 공격: 'melee'(x,y = 용의자, x2,y2 = 대원, c = { side 1, by, wpn: knife 'knife' · 맨손 'blunt', res 'hit', tk 0, target }) */
export function recMelee(sim: Sim, s: Scene, h: Hostile, ta: FieldAgent): void {
  if (!FXLOG.on) return;
  recFx(sim, s, 'melee', h.x, h.y, ta.x, ta.y, 0.4, { side: 1, by: h.id, wpn: h.weapon === 'knife' ? 'knife' : 'blunt', res: 'hit', tk: 0, target: ta.rid });
}

/** 시한이 지나 인질을 다치게 함: 총이면 'shot'(용의자 → 인질, 색 '#ff8a5c', ttl 0.25, res 'hit', stop 'body') + 'hit', 아니면 'melee' + 'hit' */
export function recHarm(sim: Sim, s: Scene, h: Hostile, c: Casualty): void {
  if (!FXLOG.on) return;
  if (h.weapon === 'gun') recFx(sim, s, 'shot', h.x, h.y, c.x, c.y, 0.25, { side: 1, by: h.id, wpn: 'hgun', res: 'hit', ix: c.x, iy: c.y, stop: 'body', tk: 2, target: c.id }, '#ff8a5c');
  else recFx(sim, s, 'melee', h.x, h.y, c.x, c.y, 0.4, { side: 1, by: h.id, wpn: h.weapon === 'knife' ? 'knife' : 'blunt', res: 'hit', tk: 2, target: c.id });
  recFx(sim, s, 'hit', c.x, c.y, undefined, undefined, 1.2, { side: 1, ox: h.x, oy: h.y, tk: 2, target: c.id });
}

export function recCuff(sim: Sim, s: Scene, h: Hostile, a: FieldAgent, how: ArrestHow): void {
  if (!FXLOG.on) return;
  recFx(sim, s, 'cuff', h.x, h.y, undefined, undefined, 2.0, { by: a.rid, ox: a.x, oy: a.y, arrest: how, target: h.id });
}

/** 테이저(지금은 부르는 곳이 없다): R1 이 테이저의 효과를 적용하는 줄 바로 다음에 한 줄로 부른다 — R1 설계서 6.3절의 노란 'shot' 대신 */
export function recTaser(sim: Sim, s: Scene, a: FieldAgent, tx: number, ty: number, hit: boolean, tk: 0 | 1 | 2, target: number): void {
  if (!FXLOG.on) return;
  recFx(sim, s, 'taser', a.x, a.y, tx, ty, 1.2, { side: 0, by: a.rid, wpn: 'taser', res: hit ? 'hit' : 'miss', tk, target });
}
