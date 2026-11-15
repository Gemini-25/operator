// 현장 파손: 총격·폭발·열에 창이 깨지고, 엄폐물로 쓰인 가구가 닳아 부서진다.
// 이 파일은 "세계"의 규칙이다(hazards.ts 와 같은 자격: 진실을 읽고 바꾼다). 지휘관·대원의 판단부는 이 파일을 부르지 않는다.
//   Scene.glass[i]    창 칸에서 1 = 깨짐 (깨져도 지나갈 수는 없다. 시야는 원래 통과한다)
//   Scene.decorHp[i]  가구 칸의 상태: 0 = 멀쩡, 1…200 = 지금까지 받은 피해량, 255 = 부서짐
//                     (부서진 칸은 T.FLOOR 가 되고 decor[i] 는 그대로 남아 무엇의 잔해인지 알려 준다)
// 난수는 현장마다 따로 만든 파손용 흐름만 쓴다. s.rng 를 한 번이라도 더 부르면 교전의 다른 결과까지 바뀐다.

import type { Sim } from '../engine';
import { emit } from '../events';
import type { Rng } from '../rng';
import { DECOR, T } from '../types';
import type { Fx, FxStop, Scene } from '../types';
import { josa } from '../util';
import { doorAt, staticPass } from './grid';

/** 가구가 부서지기까지 버티는 피해량 (DECOR 값 → 내구) */
export const DECOR_HP: Record<number, number> = {
  [DECOR.PLANT]: 1,
  [DECOR.TABLE]: 2, [DECOR.DESK]: 2, [DECOR.SHELF]: 2,
  [DECOR.BED]: 3, [DECOR.SOFA]: 3, [DECOR.CABINET]: 3,
  [DECOR.COUNTER]: 4, [DECOR.KITCHEN]: 4, [DECOR.CRATE]: 4,
  [DECOR.MACHINE]: 6,
};
/** 기록에 적는 가구 이름 */
export const DECOR_NAME: Record<number, string> = {
  [DECOR.BED]: '침대', [DECOR.DESK]: '책상', [DECOR.TABLE]: '탁자', [DECOR.SOFA]: '소파', [DECOR.CABINET]: '수납장', [DECOR.CRATE]: '상자 더미',
  [DECOR.MACHINE]: '기계', [DECOR.COUNTER]: '계산대', [DECOR.PLANT]: '화분', [DECOR.KITCHEN]: '조리대', [DECOR.SHELF]: '진열대',
};
/** 부서진 가구 칸의 decorHp 값 */
export const WRECKED = 255;
/** 빗나간 탄이 엄폐 가구에 맞을 확률. 엄폐가 사라지는 것이 균형을 크게 흔들면 이 값을 낮춘다 */
export const COVER_HIT = 0.7;
/** 센 불길 곁의 창이 화재 틱(1초)마다 열에 깨질 확률 */
export const HEAT_BREAK = 0.06;
/** 같은 현장에서 "엄폐물이 사라졌습니다" 기록을 남기는 최소 간격(초) */
const LOG_GAP = 10;

interface DamageState { rng: Rng; logAt: number }
const states = new WeakMap<Scene, DamageState>();
function stateOf(sim: Sim, s: Scene): DamageState {
  let st = states.get(s);
  if (!st) { st = { rng: sim.rng.fork('dmg:' + s.id), logAt: -99 }; states.set(s, st); }
  return st;
}
/** 이 현장의 파손용 난수 흐름 (다른 흐름과 섞이지 않는다) */
export function dmgRng(sim: Sim, s: Scene): Rng { return stateOf(sim, s).rng; }

// hazards.pushFx 와 같은 내용이다. hazards.ts 가 이 파일을 부르므로 서로를 import 하지 않게 따로 둔다
function fx(sim: Sim, s: Scene, kind: Fx['kind'], x: number, y: number, x2: number | undefined, y2: number | undefined, ttl: number): void {
  s.fx.push({ kind, t: sim.t, x, y, x2, y2, text: undefined, color: undefined, ttl, c: undefined });      // 모든 기록이 같은 모양 (hazards.pushFx·fxlog.recFx 와 같은 칸, 같은 순서)
  if (s.fx.length > 60) s.fx.splice(0, s.fx.length - 60);
}

/**
 * 창 한 칸을 깬다. 이미 깨졌거나 창이 아니면 false. 효과 'glass', s.staticVersion++.
 * (fromX, fromY) 는 힘이 온 곳이다(쏜 자리, 폭발 중심, 불길): 파편은 그 반대쪽으로 튄다. 없으면 양쪽으로 흩어진다.
 */
export function breakGlass(sim: Sim, s: Scene, i: number, fromX?: number, fromY?: number): boolean {
  if (i < 0 || i >= s.tiles.length || s.tiles[i] !== T.WINDOW || s.glass[i]) return false;
  s.glass[i] = 1; s.staticVersion++;
  const x = i % s.w, y = (i / s.w) | 0;
  let x2: number | undefined, y2: number | undefined;
  if (fromX !== undefined && fromY !== undefined) {
    const d = Math.hypot(x - fromX, y - fromY);
    if (d > 0.01) { x2 = x + (x - fromX) / d; y2 = y + (y - fromY) / d; }
  }
  fx(sim, s, 'glass', x, y, x2, y2, 0.5);
  return true;
}

/** 부서진 가구 칸이 바닥이 되었을 때 걸어서 닿을 수 있는가: 네 이웃 가운데 하나는 지나갈 수 있는 칸이어야 한다 */
function opensOnto(s: Scene, i: number): boolean {
  const x = i % s.w, y = (i / s.w) | 0;
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) continue;
    const j = ny * s.w + nx;
    if (!staticPass(s.tiles[j])) continue;
    const p = s.propAt[j] >= 0 ? s.props[s.propAt[j]] : null;
    if (!p || p.kind === 'door' || p.kind === 'debris') return true;      // 문과 잔해는 열거나 치울 수 있다
  }
  return false;
}

/**
 * 가구 한 칸에 피해를 준다. 부서지면 true (칸 → T.FLOOR, decorHp = 255, s.fuel 은 절반, 효과 'debris', s.staticVersion++).
 * 다른 가구와 벽에 완전히 둘러싸인 가구는 부서져도 치워질 곳이 없다: 닿지 못하는 바닥이 생기지 않도록 부서지기 직전(200)에서 멈춘다.
 * 둘러싼 가구가 먼저 부서지면 그다음 피해에 부서진다.
 */
export function damageDecor(sim: Sim, s: Scene, i: number, amount: number): boolean {
  if (i < 0 || i >= s.tiles.length || s.tiles[i] !== T.FURN || s.propAt[i] >= 0) return false;
  const dmg = Math.round(amount);
  if (dmg <= 0) return false;
  const taken = Math.min(200, s.decorHp[i] + dmg);
  s.staticVersion++;
  if (taken < (DECOR_HP[s.decor[i]] ?? 3)) { s.decorHp[i] = taken; return false; }
  if (!opensOnto(s, i)) { s.decorHp[i] = 200; return false; }
  s.tiles[i] = T.FLOOR; s.decorHp[i] = WRECKED; s.fuel[i] *= 0.5;
  if (s.region[i] < 0) {
    // 어느 구역에도 들지 않은 자리였다면 이웃한 구역에 넣는다 (바닥이 된 칸이 "건물 밖"으로 읽히지 않게)
    for (const d of [1, -1, s.w, -s.w]) { const j = i + d; if (j >= 0 && j < s.region.length && s.region[j] >= 0) { s.region[i] = s.region[j]; s.regions[s.region[j]].tiles.push(i); break; } }
  }
  fx(sim, s, 'debris', i % s.w, (i / s.w) | 0, undefined, undefined, 0.6);
  return true;
}

/** 정수 격자 위의 직선(grid.los 와 같은 걷기)을 따라 칸마다 visit 을 부른다. visit 이 false 를 돌려주면 거기서 멈추고 false. 시작 칸은 부르지 않는다 */
function walk(s: Scene, ax: number, ay: number, bx: number, by: number, visit: (i: number, t: number) => boolean): boolean {
  const dx = Math.abs(bx - ax), dy = Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
  let err = dx - dy, guard = 0;
  while ((ax !== bx || ay !== by) && guard++ < 80) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; ax += sx; }
    if (e2 < dx) { err += dx; ay += sy; }
    if (ax < 0 || ay < 0 || ax >= s.w || ay >= s.h) return false;
    const i = ay * s.w + ax;
    if (!visit(i, s.tiles[i])) return false;
  }
  return true;
}

// ───────────────────────── 탄도 (G5c: 그림의 선 = 탄이 실제로 간 선) ─────────────────────────
// 탄 한 발은 쏜 자리에서 겨눈 점 쪽으로 그은 선분 하나다. 깨지는 창, 닳는 엄폐 가구, 멈춘 자리를 모두 그 선분 하나로 정하고,
// 그림(fxlog.noteShot → FxInfo.ix, iy, stop, 그리고 기록의 x2, y2)은 같은 선분을 그 멈춘 자리까지 그린다.
// 그래서 그림의 선이 지나는 창 = 깨진 창이고, 그림의 탄착점 = 탄을 멈춘 칸(벽·문·가구)에 들어서는 자리다.

/** 탄 한 발이 멈춘 자리와 무엇에 멈췄는가. 그림의 탄착점(FxInfo.ix, iy, stop)이 이 값 그대로다 */
export interface ShotEnd { x: number; y: number; stop: FxStop }
/** 빗나간 탄이 겨눈 점을 지나쳐 더 나아가는 거리(칸) */
export const MISS_OVER = 3;
/** 같은 시각에 두 칸 경계를 넘으면(꼭짓점을 지나면) 대각선으로 바로 건너간다: 꼭짓점만 스친 옆 칸에는 들어가지 않은 것이다 */
const CORNER_EPS = 1e-9;

/**
 * 선분 (x0,y0) → (x1,y1) 이 지나는 칸을 지나는 차례대로 visit(i, tile) 한다. 시작 칸은 부르지 않는다.
 * 칸 (cx,cy) 는 [cx−0.5, cx+0.5] × [cy−0.5, cy+0.5] 다(Math.round 와 같은 나눔, 그림의 P(v) = (v+0.5)·ts 와 같은 자리).
 * at 에는 선분이 마지막으로 들어선 칸의 가장자리 자리를 적는다.
 * 'end' = 끝까지 갔다, 'stop' = visit 이 false 를 돌려주었다(at = 그 칸에 들어서는 자리), 'out' = 현장 밖으로 나갔다(at = 현장의 가장자리).
 */
function cross(s: Scene, x0: number, y0: number, x1: number, y1: number, at: { x: number; y: number }, visit: (i: number, tile: number) => boolean): 'end' | 'stop' | 'out' {
  const dx = x1 - x0, dy = y1 - y0;
  const sx = dx > 0 ? 1 : dx < 0 ? -1 : 0, sy = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  let cx = Math.round(x0), cy = Math.round(y0);
  // 다음 세로 경계·가로 경계를 넘는 매개변수 t (선분 위의 자리 = 시작 + t·(끝 − 시작), 0 ≤ t ≤ 1)
  let tx = sx ? (cx + 0.5 * sx - x0) / dx : Infinity, ty = sy ? (cy + 0.5 * sy - y0) / dy : Infinity;
  const ddx = sx ? 1 / Math.abs(dx) : Infinity, ddy = sy ? 1 / Math.abs(dy) : Infinity;
  for (let guard = 0; guard < 400; guard++) {
    const t = Math.min(tx, ty);
    if (t >= 1) return 'end';                               // 끝점이 지금 칸 안(또는 그 가장자리)에 있다
    if (Math.abs(tx - ty) < CORNER_EPS) { cx += sx; cy += sy; tx += ddx; ty += ddy; }
    else if (tx < ty) { cx += sx; tx += ddx; }
    else { cy += sy; ty += ddy; }
    at.x = x0 + dx * t; at.y = y0 + dy * t;
    if (cx < 0 || cy < 0 || cx >= s.w || cy >= s.h) return 'out';
    const i = cy * s.w + cx;
    if (!visit(i, s.tiles[i])) return 'stop';
  }
  return 'end';
}

/**
 * 탄도를 계산만 한다(아무것도 바꾸지 않는다). glass 를 주면 선분이 멈추기 전까지 지나는 창 칸을 차례로 넣는다.
 *  body        — 끝점(맞은 사람)에서 멈춘다('body'). 맞았다는 판정은 이미 났으므로 벽 모서리를 스쳐도 멈추지 않는다.
 *  cover ≥ 0   — 그 칸에 들어서는 자리에서 멈춘다('furn').
 *  그 밖       — 벽·바위·빈 공간('wall')이나 닫힌 문('door')에 들어서는 자리에서 멈춘다. over > 0 이면 끝점을 지나 over 칸 더 간다.
 *                끝까지 가면 그 끝점('far'), 현장 밖으로 나가면 현장의 가장자리('far').
 */
export function traceShot(s: Scene, x0: number, y0: number, x1: number, y1: number, o: { over?: number; body?: boolean; cover?: number }, glass?: number[]): ShotEnd {
  let ex = x1, ey = y1;
  const over = o.over ?? 0, cover = o.cover ?? -1, body = !!o.body;
  const d = Math.hypot(x1 - x0, y1 - y0);
  if (over > 0 && d >= 0.01) { ex = x1 + ((x1 - x0) / d) * over; ey = y1 + ((y1 - y0) / d) * over; }
  let stop: FxStop = body ? 'body' : 'far';
  const at = { x: x0, y: y0 };
  const r = cross(s, x0, y0, ex, ey, at, (i, t) => {
    if (i === cover) { stop = 'furn'; return false; }
    if (t === T.WINDOW) { glass?.push(i); return true; }
    if (body) return true;
    if (t === T.WALL || t === T.ROCK || t === T.VOID) { stop = 'wall'; return false; }
    if (t === T.DOOR) { const dd = doorAt(s, i); if (dd && !dd.open) { stop = 'door'; return false; } }
    return true;
  });
  if (r === 'end') return { x: ex, y: ey, stop };                // 끝까지 갔으면 'body' 또는 'far'
  if (r === 'out') return { x: at.x, y: at.y, stop: 'far' };
  return { x: at.x, y: at.y, stop };
}

/**
 * 엄폐 가구 칸(cover) 안에서 쏜 자리 (x0,y0) 로부터 곧게(벽·닫힌 문에 막히지 않고) 닿는 점.
 * 칸 안의 5×5 점(가운데에서 ±0.4칸, 0.2칸 간격)을 받은 사람 쪽 선분((x0,y0) → (tx,ty))에 가까운 것부터, 같으면 가운데에 가까운 것부터 본다.
 * 받은 사람이 문틀 너머로 보이는 자리라면 그 선 가까이의 점은 같은 틈으로 닿는다. 닿는 점이 없으면 칸의 가운데.
 */
function coverAim(s: Scene, x0: number, y0: number, tx: number, ty: number, cover: number): { x: number; y: number } {
  const cx = cover % s.w, cy = (cover / s.w) | 0;
  const dx = tx - x0, dy = ty - y0, L2 = dx * dx + dy * dy;
  const off = (x: number, y: number): number => {
    const t = L2 > 1e-9 ? Math.max(0, Math.min(1, ((x - x0) * dx + (y - y0) * dy) / L2)) : 0;
    return Math.hypot(x0 + dx * t - x, y0 + dy * t - y);
  };
  const pts: { x: number; y: number; o: number; c: number }[] = [];
  for (let j = -2; j <= 2; j++) for (let k = -2; k <= 2; k++) { const x = cx + k * 0.2, y = cy + j * 0.2; pts.push({ x, y, o: off(x, y), c: Math.hypot(k, j) }); }
  pts.sort((a, b) => a.o - b.o || a.c - b.c);
  for (const p of pts) if (traceShot(s, x0, y0, p.x, p.y, { cover }).stop === 'furn') return p;
  return { x: cx, y: cy };
}

/**
 * 탄 한 발을 실제로 보낸다: 쏜 자리 (x0,y0) 에서 겨눈 점 (x1,y1) 쪽으로 그은 선분이 지나는 창을 모두 깨고(파편은 쏜 쪽의 반대로),
 * 멈춘 자리를 돌려준다. 부른 쪽은 이 자리를 사격 기록의 끝점(x2, y2)과 noteShot 의 end 로 넘긴다 — 그림이 같은 선을 그린다.
 *  to 'body'  — 맞은 사람(겨눈 점)에서 멈춘다.
 *  to 'miss'  — 겨눈 점을 지나 MISS_OVER 칸 더 간다. 벽·닫힌 문에서 멈춘다.
 *  to 칸 번호 — 그 엄폐 가구 칸을 겨눈다. 이때 (x1,y1) 은 사격을 받은 사람이다: 그 칸 안에서 쏜 자리로부터 곧게 닿는 점을 겨눈다(coverAim).
 *               그 칸에 들어서는 자리에서 멈추고 가구가 한 번 닳는다(부서져 엄폐가 사라지면 기록 — hitCover 와 같다).
 *               곧게 닿는 점이 없으면(문틀 너머 비스듬한 가구) 그 칸의 가운데를 겨눠 벽·닫힌 문에서 멈추고, 가구는 그대로다.
 * 난수를 쓰지 않는다(엄폐 가구에 맞는지는 coverRoll 이 정한다).
 */
export function fireShot(sim: Sim, s: Scene, x0: number, y0: number, x1: number, y1: number, to: 'body' | 'miss' | number): ShotEnd {
  const cover = typeof to === 'number' ? to : -1;
  if (cover >= 0) { const p = coverAim(s, x0, y0, x1, y1, cover); x1 = p.x; y1 = p.y; }
  const passed: number[] = [];
  const end = traceShot(s, x0, y0, x1, y1, to === 'body' ? { body: true } : cover >= 0 ? { cover } : { over: MISS_OVER }, passed);
  for (const i of passed) breakGlass(sim, s, i, x0, y0);
  if (end.stop === 'furn') wearCover(sim, s, cover);
  return end;
}

/**
 * 탄도: (x0,y0) → (x1,y1) 선분이 지나는 창을 깬다 (벽·바위·빈 공간·닫힌 문에 막히면 거기서 멈춘다).
 * over 칸만큼 목표를 지나쳐 더 나아간다. 멈춘 자리를 돌려준다. 사격은 fireShot 을 쓴다(이것은 그 가운데 '벽에 막히는 선'만).
 */
export function bulletPath(sim: Sim, s: Scene, x0: number, y0: number, x1: number, y1: number, over: number): ShotEnd {
  const passed: number[] = [];
  const end = traceShot(s, x0, y0, x1, y1, { over }, passed);
  for (const i of passed) breakGlass(sim, s, i, x0, y0);
  return end;
}

/**
 * (G5) 그림용 탄착점: 탄도(traceShot)와 같은 선분으로 (x0,y0) → (x1,y1) → over 칸 너머까지 간다. 아무것도 바꾸지 않는다.
 * 벽·바위·빈 공간이면 'wall', 닫힌 문이면 'door' — 자리는 그 칸에 들어서는 자리(벽면).
 * 끝까지 가면 'far' — 자리는 끝점. 현장 밖으로 나가면 현장의 가장자리.
 */
export function rayEnd(s: Scene, x0: number, y0: number, x1: number, y1: number, over: number): { x: number; y: number; stop: 'wall' | 'door' | 'far' } {
  return traceShot(s, x0, y0, x1, y1, { over }) as { x: number; y: number; stop: 'wall' | 'door' | 'far' };
}

/**
 * 사격을 받은 사람(tx,ty)과 쏜 사람(sx,sy) 사이의, 받은 사람 바로 옆 엄폐 가구 칸 (없으면 -1).
 * executor.shootAt 의 엄폐 판정과 같은 칸을 본다: 쏜 쪽으로 가로 한 칸, 세로 한 칸. 둘 다 가구면 더 긴 축의 것, 둘 다 아니면 그 모서리 칸.
 */
export function coverTile(s: Scene, tx: number, ty: number, sx: number, sy: number): number {
  const hx = Math.round(tx), hy = Math.round(ty);
  const ox = Math.sign(Math.round(sx - tx)), oy = Math.sign(Math.round(sy - ty));
  const furn = (x: number, y: number): number => (x < 0 || y < 0 || x >= s.w || y >= s.h || s.tiles[y * s.w + x] !== T.FURN ? -1 : y * s.w + x);
  const a = ox ? furn(hx + ox, hy) : -1, b = oy ? furn(hx, hy + oy) : -1;
  if (a >= 0 && b >= 0) return Math.abs(sx - tx) >= Math.abs(sy - ty) ? a : b;
  if (a >= 0) return a;
  if (b >= 0) return b;
  return ox && oy ? furn(hx + ox, hy + oy) : -1;
}

/**
 * (G5c) 빗나간 탄이 엄폐 가구에 맞는가: 사격을 받은 사람(tx,ty) 곁, 쏜 사람(sx,sy) 쪽의 가구가 있으면 COVER_HIT 의 확률로 그 칸, 아니면 −1.
 * 파손용 흐름에서 한 번 굴린다(가구가 없으면 굴리지 않는다). 맞은 칸은 fireShot 에 넘겨 탄을 그 칸으로 보낸다 — 가구는 탄이 실제로 닿아야 닳는다.
 */
export function coverRoll(sim: Sim, s: Scene, tx: number, ty: number, sx: number, sy: number): number {
  const c = coverTile(s, tx, ty, sx, sy);
  if (c < 0) return -1;
  return stateOf(sim, s).rng.chance(COVER_HIT) ? c : -1;
}

/** 엄폐 가구 한 칸이 탄에 한 번 닳는다. 부서져 엄폐가 사라졌을 때만 기록을 남긴다 (같은 현장에서 10초에 한 번까지) */
function wearCover(sim: Sim, s: Scene, c: number): void {
  const st = stateOf(sim, s);
  if (!damageDecor(sim, s, c, 1)) return;
  if (sim.t - st.logAt < LOG_GAP) return;
  st.logAt = sim.t;
  const where = s.region[c] >= 0 ? s.regions[s.region[c]].name : '건물 안';
  emit(sim, { inc: s.incidentId, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 1, text: `총격에 ${where}의 ${josa(DECOR_NAME[s.decor[c]] ?? '가구', '이/가')} 부서져 엄폐물이 사라졌습니다.` });
}

/**
 * 빗나간 탄이 엄폐물에 박힌다: coverRoll 이 맞혔으면 그 가구가 한 번 닳는다 (탄도 없이 가구만 — 사격은 coverRoll → fireShot 을 쓴다).
 */
export function hitCover(sim: Sim, s: Scene, tx: number, ty: number, sx: number, sy: number): void {
  const c = coverRoll(sim, s, tx, ty, sx, sy);
  if (c >= 0) wearCover(sim, s, c);
}

/** 두 칸 사이에 빈 공간(T.VOID)이 있는가: 나란히 놓인 다른 층은 같은 폭발에 휘말리지 않는다 */
function acrossVoid(s: Scene, ax: number, ay: number, bx: number, by: number): boolean {
  return !walk(s, ax, ay, bx, by, (_i, t) => t !== T.VOID);
}

/** 폭발·섬광: 반경 glassR 안의 창을 깨고(시야선 무관), decorDmg > 0 이면 반경 decorR 안의 가구에 피해를 준다 */
export function shatter(sim: Sim, s: Scene, x: number, y: number, glassR: number, decorR: number, decorDmg: number): void {
  const R = Math.ceil(Math.max(glassR, decorDmg > 0 ? decorR : 0)), cx = Math.round(x), cy = Math.round(y);
  for (let yy = Math.max(0, cy - R); yy <= Math.min(s.h - 1, cy + R); yy++) for (let xx = Math.max(0, cx - R); xx <= Math.min(s.w - 1, cx + R); xx++) {
    const i = yy * s.w + xx, t = s.tiles[i];
    if (t !== T.WINDOW && t !== T.FURN) continue;
    const d = Math.hypot(xx - x, yy - y);
    if (t === T.WINDOW) { if (d <= glassR && !s.glass[i] && !acrossVoid(s, cx, cy, xx, yy)) breakGlass(sim, s, i, x, y); }
    else if (decorDmg > 0 && d <= decorR && !acrossVoid(s, cx, cy, xx, yy)) damageDecor(sim, s, i, decorDmg);
  }
}

/** 열에 의한 파손: 센 불길(fx, fy)에 맞닿은 창은 화재 틱마다 HEAT_BREAK 의 확률로 깨진다 */
export function heatGlass(sim: Sim, s: Scene, i: number, fx0: number, fy0: number): void {
  if (s.tiles[i] !== T.WINDOW || s.glass[i]) return;
  if (stateOf(sim, s).rng.chance(HEAT_BREAK)) breakGlass(sim, s, i, fx0, fy0);
}
