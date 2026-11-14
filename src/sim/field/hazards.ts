// 현장 환경 규칙: 화재 확산, 연기, 구조 대상 상태 악화, 용의자 행동, 통과 차량.
// 이 파일은 "세계"의 규칙이다. 대원의 행동은 이 상태를 바꾸고, 이 상태는 대원의 다음 판단을 바꾼다.

import type { Sim } from '../engine';
import { emit, raiseProblem } from '../events';
import { T } from '../types';
import type { Casualty, Hostile, Incident, Scene } from '../types';
import { clamp, dist, josa } from '../util';
import { addProp } from './kit';
import { casFact, exitName } from './agents';
import { astar, doorAt, isIndoor, los, staticPass, tidx, tileOf, truthCost, truthWalkable } from './grid';
import { bulletPath, heatGlass, hitCover, shatter } from './damage';

export function pushFx(sim: Sim, s: Scene, kind: any, x: number, y: number, x2?: number, y2?: number, text?: string, color?: string, ttl = 1.2): void {
  s.fx.push({ kind, t: sim.t, x, y, x2, y2, text, color, ttl });
  if (s.fx.length > 60) s.fx.splice(0, s.fx.length - 60);
}

export const band = (h: number): number => (h <= 0 ? 3 : h > 70 ? 0 : h > 40 ? 1 : 2);
export const BAND_NAME = ['경상', '중상', '위중', '사망'];

const NB = [1, 0, -1, 0, 0, 1, 0, -1];

/** 화재·연기 (1초에 한 번 호출) */
export function tickFire(sim: Sim, s: Scene, I: Incident): void {
  const w = s.w, h = s.h, n = w * h;
  let burning = 0;
  for (let i = 0; i < n; i++) {
    const f = s.fire[i];
    if (s.wet[i] > 0) s.wet[i] *= 0.955;
    if (f <= 0) continue;
    burning++;
    s.fuel[i] -= 0.0105 * f;
    if (s.fuel[i] <= 0) {
      s.fuel[i] = 0;
      if (!s.burned[i]) { s.burned[i] = 1; s.burnedTiles++; }
      s.fire[i] = f - 0.09 <= 0.02 ? 0 : f - 0.09;
    } else {
      s.fire[i] = Math.min(1, f + 0.03 * (1 - s.wet[i]));
    }
    if (f < 0.25) continue;
    const x = i % w, y = (i / w) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + NB[d * 2], ny = y + NB[d * 2 + 1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      let j = ny * w + nx;
      if (f >= 0.7 && s.tiles[j] === T.WINDOW) heatGlass(sim, s, j, x, y);      // 센 불길 곁의 창은 열에 깨진다
      let through = 1;
      if (s.tiles[j] === T.WALL) {
        // 내부 칸막이는 천천히 뚫고 번진다
        const bx = nx + NB[d * 2], by = ny + NB[d * 2 + 1];
        if (bx < 0 || by < 0 || bx >= w || by >= h) continue;
        j = by * w + bx; through = 0.3;
      }
      if (s.fire[j] > 0 || s.fuel[j] <= 0) continue;
      let k = 0.085 * sim.tune.fireSpreadMul * through * f * clamp(s.fuel[j] * 1.5, 0.45, 1) * (1 - s.wet[j]);
      if (s.tiles[j] === T.DOOR || s.tiles[i] === T.DOOR) { const dr = doorAt(s, s.tiles[j] === T.DOOR ? j : i); if (dr && !dr.open) k *= 0.55; }
      s.heat[j] += k;
      if (s.heat[j] >= 1) { s.fire[j] = 0.15; s.heat[j] = 0; }
    }
    // 계단을 타고 다른 층으로 번진다
    const st = s.stairTo[i];
    if (st >= 0 && s.fire[st] <= 0 && s.fuel[st] > 0) { s.heat[st] += 0.06 * sim.tune.fireSpreadMul * f; if (s.heat[st] >= 1) { s.fire[st] = 0.15; s.heat[st] = 0; } }
  }
  // 연기 확산. 타는 칸도 연기도 없으면 아래 순회는 아무것도 바꾸지 않으므로 건너뛴다(대부분의 현장이 그렇다)
  let smoky = burning > 0;
  if (!smoky) { const sm = s.smoke; for (let i = 0; i < n; i++) if (sm[i] !== 0) { smoky = true; break; } }
  if (smoky) smokeSpread(s, w, h);
  // 가스 용기 폭발 (숨겨진 추가 위험)
  for (const p of s.props) {
    if (p.kind !== 'gas' || p.exploded) continue;
    let hot = s.fire[tidx(s, p.x, p.y)] > 0.3;
    for (let d = 0; d < 4 && !hot; d++) { const nx = p.x + NB[d * 2], ny = p.y + NB[d * 2 + 1]; if (nx >= 0 && ny >= 0 && nx < w && ny < h && s.fire[ny * w + nx] > 0.6) hot = true; }
    if (!hot) continue;
    p.exploded = true;
    for (let y = Math.max(0, p.y - 2); y <= Math.min(h - 1, p.y + 2); y++) for (let x = Math.max(0, p.x - 2); x <= Math.min(w - 1, p.x + 2); x++) {
      const j = y * w + x;
      if (s.fuel[j] > 0 && dist(x, y, p.x, p.y) <= 2.3) s.fire[j] = Math.max(s.fire[j], 0.85);
    }
    const ev = raiseProblem(sim, I, 'HIDDEN_HAZARD', '보관 중이던 가스 용기 폭발', { role: 'SYSTEM', actor: '현장', text: '폭발! 건물 내부에 보관되어 있던 가스 용기가 화염에 노출되어 폭발했습니다.', imp: 3, truth: s.arrivedAt < 0 }, false);
    blast(sim, s, I, p.x, p.y, 3.6, 34, ev);
    pushFx(sim, s, 'boom', p.x, p.y, undefined, undefined, undefined, undefined, 1.6);
  }
  // 붕괴
  for (const r of s.regions) {
    if (!r.indoor || r.kind !== 'room' || s.collapseDone.has(r.id)) continue;
    let b = 0; if (s.burnedTiles > 0) for (const i of r.tiles) if (s.burned[i]) b++;      // 탄 칸이 하나도 없으면 셀 것도 없다
    if (b / r.tiles.length < 0.55) continue;
    s.collapseDone.add(r.id);
    if (!s.rng.chance(0.55)) continue;
    const cands = r.tiles.filter((i) => s.propAt[i] < 0 && s.tiles[i] !== T.DOOR);
    if (!cands.length) continue;
    const k = Math.min(cands.length, s.rng.int(1, 2));
    for (let q = 0; q < k; q++) { const i = s.rng.pick(cands); if (s.propAt[i] < 0) addProp(s, 'debris', i % w, (i / w) | 0, { blocking: true, hp: s.rng.range(9, 14) }); }
    s.staticVersion++;
    const ev = raiseProblem(sim, I, 'ESCALATION', `${r.name} 천장 일부 붕괴`, { role: 'SYSTEM', actor: '현장', text: `${r.name} 천장 일부가 무너졌습니다.`, imp: 2, truth: s.arrivedAt < 0 }, false);
    blast(sim, s, I, r.cx, r.cy, 2.2, 22, ev);
  }
  s.burning = burning;
  if (burning === 0 && s.fireOutAt < 0 && s.kind === 'fire' && sim.t - s.startedAt > 5) s.fireOutAt = sim.t;
  if (burning > 0) s.fireOutAt = -1;
}

/**
 * 연기 한 번 퍼지기 (tickFire 의 일부). 칸을 행 우선으로 차례로 고쳐 쓰고(앞 칸의 새 값을 뒤 칸이 읽는다),
 * 이웃은 NB 순서(+x, -x, +y, -y)로 본다. 칸마다 하는 계산은 예전 한 줄짜리 순회와 똑같다.
 */
function smokeSpread(s: Scene, w: number, h: number): void {
  const tiles = s.tiles, smoke = s.smoke, fire = s.fire, stairTo = s.stairTo;
  for (let y = 0, i = 0; y < h; y++) {
    for (let x = 0; x < w; x++, i++) {
      const t = tiles[i];
      if (t === T.WALL || t === T.VOID) continue;
      const indoor = isIndoor(t);
      const k = indoor ? 0.86 : 0.5;
      let target = fire[i];
      if (x + 1 < w && tiles[i + 1] !== T.WALL) { const v = smoke[i + 1] * k; if (v > target) target = v; }
      if (x > 0 && tiles[i - 1] !== T.WALL) { const v = smoke[i - 1] * k; if (v > target) target = v; }
      if (y + 1 < h && tiles[i + w] !== T.WALL) { const v = smoke[i + w] * k; if (v > target) target = v; }
      if (y > 0 && tiles[i - w] !== T.WALL) { const v = smoke[i - w] * k; if (v > target) target = v; }
      const sl = stairTo[i];
      if (sl >= 0 && smoke[sl] * 0.9 > target) target = smoke[sl] * 0.9;      // 연기는 계단을 타고 오르내린다
      if (!indoor) target *= 0.5;
      const cur = smoke[i];
      smoke[i] = target > cur ? cur + (target - cur) * 0.3 : cur + (target - cur) * (indoor ? 0.07 : 0.3);
      if (smoke[i] < 0.01) smoke[i] = 0;
    }
  }
}

export function blast(sim: Sim, s: Scene, I: Incident, x: number, y: number, radius: number, dmg: number, ev: number): void {
  for (const a of s.agents) {
    if (a.status === 'left') continue;
    const d = dist(a.x, a.y, x, y);
    if (d > radius) continue;
    const r = sim.responders[a.rid];
    r.health -= dmg * (1 - d / (radius + 1)) * (r.dept === 'fire' ? 0.7 : 1);
    a.lastBlockEvent = ev;
  }
  for (const c of s.casualties) {
    if (c.dead || c.where !== 'scene') continue;
    const d = dist(c.x, c.y, x, y);
    if (d <= radius) { c.health -= dmg * 0.8 * (1 - d / (radius + 1)); c.causeEvent = ev; }
  }
  shatter(sim, s, x, y, radius + 1.5, Math.min(2.5, radius), 3);      // 반경 안의 창과 가구가 부서진다
}

/** 물(또는 소화 약제)을 뿌린다. 대원의 진압 행동이 호출한다. */
export function applyWater(s: Scene, tx: number, ty: number, amount: number): number {
  let reduced = 0;
  for (let y = Math.max(0, ty - 2); y <= Math.min(s.h - 1, ty + 2); y++) for (let x = Math.max(0, tx - 2); x <= Math.min(s.w - 1, tx + 2); x++) {
    const d = dist(x, y, tx, ty);
    if (d > 1.6) continue;
    const i = y * s.w + x;
    const f = s.fire[i];
    const k = amount * (1 - d / 3);
    if (f > 0) { const nf = Math.max(0, f - k); reduced += f - nf; s.fire[i] = nf < 0.03 ? 0 : nf; }
    s.heat[i] = Math.max(0, s.heat[i] - k * 2);
    s.wet[i] = Math.min(1, s.wet[i] + k * 1.5);
  }
  return reduced;
}

export function regionFireLevel(s: Scene, regionId: number): number {
  let m = 0; for (const i of s.regions[regionId].tiles) if (s.fire[i] > m) m = s.fire[i];
  return m;
}
export function anyFire(s: Scene): boolean { for (let i = 0; i < s.fire.length; i++) if (s.fire[i] > 0.04) return true; return false; }

/** 구조 대상 상태 변화 (매 틱) */
export function tickCasualties(sim: Sim, s: Scene, I: Incident): void {
  const dt = sim.dt;
  for (const c of s.casualties) {
    c.px = c.x; c.py = c.y;
    if (c.dead || c.where === 'hospital') continue;
    let d = c.bleed;
    if (c.bystander && c.treatQ <= 0 && c.where === 'scene') d *= 0.5;      // 신고자가 안내대로 돌보는 중
    if (c.where === 'scene' || c.where === 'carried') {
      const i = tileOf(s, c.x, c.y);
      d += s.smoke[i] * (s.kind === 'hazmat' ? 0.62 : 0.36);      // 새어 나온 가스는 연기보다 빨리 사람을 쓰러뜨린다
      if (s.fire[i] > 0.3) d += 2.6 * s.fire[i];
      if (!isIndoor(s.tiles[i]) && (c.isTarget || s.kind === 'search')) d += s.exposure;
    } else if (c.where === 'loaded') d *= 0.5;
    else if (c.where === 'safe' && c.treated) d *= 0.6;
    c.health -= d * dt;
    if (c.health <= 0) {
      c.health = 0; c.dead = true; c.tDead = sim.t; c.walking = false;
      const known = c.tDiscovered >= 0;
      const ev = emit(sim, {
        inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'casualty', imp: 3, truth: !known, causes: [c.causeEvent, I.lastEvent],
        text: known ? `구조 대상 ${c.label}: 생체 반응 소실. 구조에 실패했습니다.` : `(미발견) 구조 대상 ${c.label}의 생체 반응이 사라졌습니다.`,
      });
      c.causeEvent = ev;
      for (const a of s.agents) if (a.carrying === c.id) a.carrying = -1;
      continue;
    }
    // 스스로 대피 중인 대상
    if (c.walking && c.where === 'scene') {
      if (!c.path) {
        c.path = astar(s, c.x, c.y, s.safe.x, s.safe.y, 1.5, truthCost(s));
        c.pathI = 0;
        if (!c.path) { c.walking = false; c.panic = true; continue; }
      }
      if (c.pathI >= c.path.length) {
        c.walking = false; c.where = 'safe'; c.tSafe = sim.t; placeAtSafe(s, c);
        // 안전 구역(차량 대기 지점)에 도착한 사람은 현장 무전망으로 확인된다
        if (s.agents.some((a) => a.status !== 'left')) {
          const ev = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '안전 구역', kind: 'casualty', imp: 1, text: `구조 대상 ${c.label} 스스로 대피해 안전 구역 도착.` });
          s.radio.push({ id: s.nextMsgId++, t: sim.t, deliverAt: sim.t + 1, from: -1, to: -1, kind: 'report', facts: [casFact(sim, s, c, '안전 구역')], workId: -1, text: '', eventId: ev });
        }
        continue;
      }
      const ti = c.path[c.pathI];
      if (!truthWalkable(s, ti) || s.fire[ti] > 0.5) { c.walking = false; c.panic = true; c.path = null; continue; }
      const tx = ti % s.w, ty = (ti / s.w) | 0;
      if (s.stairTo[tileOf(s, c.x, c.y)] === ti) {      // 계단을 내려간다
        c.climb = (c.climb ?? 0) + dt;
        if (c.climb >= 2.6) { c.climb = 0; c.x = tx; c.y = ty; c.px = tx; c.py = ty; c.pathI++; }
        continue;
      }
      const dd = dist(c.x, c.y, tx, ty), step = 1.35 * dt * (1 - s.smoke[tileOf(s, c.x, c.y)] * 0.4);
      if (dd <= step) { c.x = tx; c.y = ty; c.pathI++; const dr = doorAt(s, ti); if (dr) dr.open = true; } else { c.x += ((tx - c.x) / dd) * step; c.y += ((ty - c.y) / dd) * step; }
    }
    // 배회하는 실종자
    if (c.wander && c.tDiscovered < 0 && c.where === 'scene') {
      if (!c.path || c.pathI >= c.path.length) {
        if (sim.t >= c.wanderT) {
          c.wanderT = sim.t + s.rng.range(9, 18);
          const tx = clamp(Math.round(c.x) + s.rng.int(-4, 4), 0, s.w - 1), ty = clamp(Math.round(c.y) + s.rng.int(-4, 4), 0, s.h - 1);
          if (staticPass(s.tiles[ty * s.w + tx]) && dist(tx, ty, s.staging.x, s.staging.y) > 9) { c.path = astar(s, c.x, c.y, tx, ty, 0, truthCost(s)); c.pathI = 0; }
        }
      } else {
        const ti = c.path[c.pathI];
        const tx = ti % s.w, ty = (ti / s.w) | 0;
        const dd = dist(c.x, c.y, tx, ty), step = 0.42 * dt;
        if (dd <= step) { c.x = tx; c.y = ty; c.pathI++; } else { c.x += ((tx - c.x) / dd) * step; c.y += ((ty - c.y) / dd) * step; }
      }
    }
  }
}

/** 신고자가 접수 AI 의 안내를 따랐을 때 현장에 생기는 변화 (부대 도착 전에만 의미가 있다). */
export function applyCallerAid(sim: Sim, I: Incident, kind: string, ev: number): void {
  const s = sim.scenes[I.id];
  if (!s || s.arrivedAt >= 0) return;
  const note = (text: string) => emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'action', imp: 1, truth: true, causes: [ev], text });
  if (kind === 'fire') {
    const c = s.casualties.find((q) => q.mob === 'mobile' && !q.walking && !q.dead && q.where === 'scene');
    if (c) { c.walking = true; c.path = null; c.concealment = 0; note(`신고자의 외침을 듣고 구조 대상 ${josa(c.label, '이/가')} 스스로 대피를 시작했습니다.`); }
  } else if (kind === 'traffic' || kind === 'medical' || kind === 'care') {
    let best: Casualty | null = null;
    for (const c of s.casualties) if (!c.dead && c.where === 'scene' && c.mob !== 'mobile' && (!best || c.bleed > best.bleed)) best = c;
    if (best) { best.bystander = true; note(kind === 'medical' ? `신고자가 안내에 따라 가슴 압박을 하고 있습니다. 환자의 악화가 늦춰집니다.` : kind === 'care' ? `신고자가 안내에 따라 환자를 돌보고 있습니다. 악화가 늦춰집니다.` : `신고자가 구조 대상 ${best.label}의 출혈 부위를 누르고 있습니다. 악화가 늦춰집니다.`); }
  } else if (kind === 'search') {
    if (!s.props.some((p) => p.kind === 'witness')) {
      const tgt = s.casualties.find((c) => c.isTarget);
      const reg = tgt ? s.region[Math.round(tgt.y) * s.w + Math.round(tgt.x)] : 0;
      addProp(s, 'witness', 2, 11, { lastSeenRegion: Math.max(0, reg), accurate: true, interviewed: false });
      s.staticVersion++;
      note('신고자가 현장 입구에서 대원을 기다립니다. 도착하면 직접 본 것을 알려 줄 수 있습니다.');
    }
  }
}

export function placeAtSafe(s: Scene, c: Casualty): void {
  const k = s.casualties.filter((q) => q.where === 'safe' && q.id !== c.id).length;
  c.x = s.safe.x - 1 + (k % 3) * 0.9; c.y = s.safe.y - 0.6 + Math.floor(k / 3) * 0.9;
  c.px = c.x; c.py = c.y;
}

// ───────────────────────── 용의자 ─────────────────────────
export const HOSTILE_FOV = 1.15;      // 시야각의 절반(라디안). 약 ±66°

/** 용의자가 그 지점을 보고 있는가: 가까우면 기척으로, 경계 중이면 사방을, 아니면 바라보는 방향만 */
export function hostileSees(sim: Sim, h: Hostile, x: number, y: number): boolean {
  if (sim.t < h.stunUntil) return false;
  if (dist(x, y, h.x, h.y) < 2.6 || sim.t < h.alertUntil) return true;
  let diff = Math.abs(Math.atan2(y - h.y, x - h.x) - h.facing);
  if (diff > Math.PI) diff = 2 * Math.PI - diff;
  return diff <= HOSTILE_FOV;
}

/** 살아 있는 인질이 용의자 바로 곁에 있는가 (대원은 이때 사격을 삼간다) */
export function hostageNear(s: Scene, h: Hostile): Casualty | null {
  for (const c of s.casualties) if (c.hostage && !c.dead && c.where === 'scene' && dist(c.x, c.y, h.x, h.y) <= 1.7) return c;
  return null;
}
/** 이 사람이 지금 총을 든 용의자 곁에 붙잡혀 있어 빠져나올 수 없는가 (용의자가 무력화된 동안에는 풀려난다) */
export function isHeld(sim: Sim, s: Scene, cid: number): boolean {
  const c = s.casualties[cid];
  if (!c.hostage || c.dead || c.where !== 'scene') return false;
  return s.hostiles.some((h) => (h.state === 'hold' || h.state === 'fight') && h.weapon === 'gun' && sim.t >= h.stunUntil && dist(h.x, h.y, c.x, c.y) <= 3.2);
}

/** 섬광탄: 반경 안의 용의자를 잠시 무력화한다. */
export function flashbang(sim: Sim, s: Scene, x: number, y: number): number {
  let n = 0;
  for (const h of s.hostiles) {
    if (h.state !== 'hold' && h.state !== 'fight') continue;
    if (dist(h.x, h.y, x, y) > 5.2 || !los(s, x, y, h.x, h.y)) continue;      // 벽 너머까지는 미치지 않는다
    h.stunUntil = sim.t + 3.8; h.morale -= 0.15; n++;
  }
  pushFx(sim, s, 'flash', x, y, undefined, undefined, undefined, undefined, 0.7);
  shatter(sim, s, x, y, 2.2, 0, 0);      // 가까운 창이 깨진다
  return n;
}

/**
 * 무력화되지 않은 채로 진입을 맞은 인질범은 놀라서 인질을 쏠 수 있다 (공격적일수록 위험하다).
 * 섬광탄으로 먼저 무력화하면 일어나지 않는다.
 */
export function panicShot(sim: Sim, s: Scene, I: Incident, x: number, y: number): void {
  for (const h of s.hostiles) {
    if (h.hostageId < 0 || (h.state !== 'hold' && h.state !== 'fight') || sim.t < h.stunUntil) continue;
    if (dist(h.x, h.y, x, y) > 8) continue;
    const c = s.casualties[h.hostageId];
    if (c.dead || c.where !== 'scene' || dist(c.x, c.y, h.x, h.y) > 2.2) continue;
    if (!s.rng.chance(0.18 + 0.42 * h.aggression)) continue;
    c.health -= s.rng.range(26, 40); c.mob = 'immobile'; c.bleed = Math.max(c.bleed, 0.18); c.bleed0 = c.bleed; c.walking = false;
    h.state = 'fight'; h.cooldown = 1;
    pushFx(sim, s, 'shot', h.x, h.y, c.x, c.y, undefined, '#ff8a5c', 0.25); pushFx(sim, s, 'hit', c.x, c.y);
    bulletPath(sim, s, h.x, h.y, c.x, c.y, 0);
    c.causeEvent = raiseProblem(sim, I, 'ESCALATION', '진입 순간 인질 피격', { role: 'SYSTEM', actor: '현장', imp: 3, text: `진입에 놀란 ${h.label}가 인질(구조 대상 ${c.label})을 쐈습니다!` }, false);
  }
}

function officersSeeing(sim: Sim, s: Scene, h: Hostile, range: number): { n: number; nearest: number; nearestD: number } {
  let n = 0, nearest = -1, nd = 99;
  for (const a of s.agents) {
    if (a.status !== 'active') continue;
    const d = dist(a.x, a.y, h.x, h.y);
    if (d > range || !los(s, h.x, h.y, a.x, a.y) || !hostileSees(sim, h, a.x, a.y)) continue;
    if (sim.responders[a.rid].dept === 'police') n++;
    if (d < nd) { nd = d; nearest = a.rid; }
  }
  return { n, nearest, nearestD: nd };
}

export function exitCovered(sim: Sim, s: Scene, k: number): boolean {
  const e = s.exits[k];
  for (const a of s.agents) {
    if (a.status !== 'active' || sim.responders[a.rid].dept !== 'police') continue;
    if (dist(a.x, a.y, e.x, e.y) <= 7.5 && los(s, a.x, a.y, e.x, e.y)) return true;
  }
  return false;
}

export function hostileActive(h: Hostile): boolean { return h.state === 'hold' || h.state === 'fight' || h.state === 'flee' || h.state === 'surrendered'; }

export function tickHostiles(sim: Sim, s: Scene, I: Incident): void {
  const dt = sim.dt;
  for (const h of s.hostiles) {
    h.px = h.x; h.py = h.y;
    if (h.state === 'arrested' || h.state === 'down' || h.state === 'escaped') continue;
    if (h.health <= 0) {
      h.state = 'down';
      emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'resolve', text: `${h.label} 제압됨.`, imp: 2 });
      continue;
    }
    if (sim.t < h.stunUntil) continue;       // 무력화된 동안에는 아무것도 못 한다
    const wasAlert = sim.t < h.alertUntil;
    const see = officersSeeing(sim, s, h, 11);
    h.seenOfficers = see.n;
    if (h.state === 'surrendered') continue;
    if (see.nearest >= 0) {
      const ta = s.agents.find((a) => a.rid === see.nearest)!;
      // 시야 밖에서 바로 곁까지 다가온 대원에게 기습당하면 잠시 얼어붙는다
      if (!wasAlert && see.nearestD < 2.6 && sim.t - s.startedAt > 5 && (h.state === 'hold')) {
        h.stunUntil = sim.t + 1.6; h.morale -= 0.25;
        emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 2, text: `${h.label}가 시야 밖에서 접근한 ${sim.responders[ta.rid].name}에게 기습당했습니다.` });
      }
      h.facing = Math.atan2(ta.y - h.y, ta.x - h.x); h.alertUntil = sim.t + 5;
    } else if (sim.t >= h.lookAt && h.state === 'hold') {
      // 평소에는 출입구 쪽을 번갈아 살핀다
      h.lookAt = sim.t + s.rng.range(4.5, 9);
      const e = s.exits.length ? s.rng.pick(s.exits) : { x: h.x, y: h.y + 4 };
      h.facing = Math.atan2(e.y - h.y, e.x - h.x) + s.rng.range(-0.5, 0.5);
    }
    // 인질
    if (h.hostageId >= 0) {
      const c = s.casualties[h.hostageId];
      if (c.dead || c.where !== 'scene') h.hostageId = -1;
      else if (sim.t >= h.deadline) {
        h.deadline = sim.t + 70; h.state = 'fight'; h.cooldown = 1; h.alertUntil = sim.t + 20;
        c.health -= s.rng.range(28, 42); c.mob = 'immobile'; c.bleed = Math.max(c.bleed, 0.18); c.bleed0 = c.bleed; c.walking = false;
        c.causeEvent = raiseProblem(sim, I, 'ESCALATION', '시한이 지나 인질이 다침', { role: 'SYSTEM', actor: '현장', imp: 3, truth: s.arrivedAt < 0, text: `${h.label}가 요구가 받아들여지지 않자 인질을 다치게 했습니다!` }, false);
      }
    }
    // 사기 변화: 포위될수록, 부상당할수록 떨어진다
    h.morale -= (0.006 * Math.max(0, see.n - 1) + (h.health < 60 ? 0.012 : 0)) * dt;
    if (h.morale < 0.2 && h.state !== 'flee') {
      h.state = 'surrendered'; h.path = null;
      emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', text: `${h.label}가 무기를 내려놓고 투항 의사를 보입니다.`, imp: 2, truth: see.n === 0 });
      continue;
    }
    // 자리를 옮기는 중 (엄폐 이동, 인질을 끌고 물러나기): 옮기는 동안에는 쏘지 않는다
    if ((h.state === 'hold' || h.state === 'fight') && h.path) {
      const ti = h.pathI < h.path.length ? h.path[h.pathI] : -1;
      if (ti < 0 || !truthWalkable(s, ti)) { h.path = null; h.dragging = false; }
      else {
        const tx = ti % s.w, ty = (ti / s.w) | 0;
        const dd = dist(h.x, h.y, tx, ty), step = (h.dragging ? 1.3 : 2.3) * dt * (h.health < 60 ? 0.75 : 1);
        if (dd <= step) { h.x = tx; h.y = ty; h.pathI++; const dr = doorAt(s, ti); if (dr && !dr.locked) dr.open = true; } else { h.x += ((tx - h.x) / dd) * step; h.y += ((ty - h.y) / dd) * step; }
        if (h.dragging && h.hostageId >= 0) { const c = s.casualties[h.hostageId]; c.x = h.px; c.y = h.py; }      // 인질은 한 걸음 뒤에서 끌려온다
        if (h.pathI >= h.path.length) { h.path = null; h.dragging = false; }
        continue;
      }
    }
    // 인질을 붙잡은 용의자: 진입이 시작되거나 대원이 가까이 보이면 한 번, 가장 먼 방으로 인질을 끌고 물러난다
    if (h.hostageId >= 0 && !h.retreated && (h.state === 'hold' || h.state === 'fight') && (s.breachDone || (see.nearest >= 0 && see.nearestD < 7))) {
      h.retreated = true;
      const ref = see.nearest >= 0 ? s.agents.find((a) => a.rid === see.nearest)! : s.exits[Math.max(0, s.entryExit)] ?? s.staging;
      const here = s.region[tileOf(s, h.x, h.y)];
      let room = -1, bd = 0;
      for (const r of s.regions) { if (r.kind !== 'room' || r.id === here) continue; const d = dist(r.cx, r.cy, ref.x, ref.y); if (d > bd) { bd = d; room = r.id; } }
      if (room >= 0) {
        let best = -1, bt = -1;
        for (const i of s.regions[room].tiles) { if (s.tiles[i] !== T.FLOOR || s.propAt[i] >= 0) continue; const d = dist(i % s.w, (i / s.w) | 0, ref.x, ref.y); if (d > bt) { bt = d; best = i; } }
        const path = best >= 0 ? astar(s, h.x, h.y, best % s.w, (best / s.w) | 0, 0, truthCost(s)) : null;
        if (path && path.length > 2 && path.length <= 34) {
          h.path = path; h.pathI = 0; h.dragging = true; h.state = 'hold';
          emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 2, truth: see.n === 0, text: `${h.label}가 인질을 끌고 ${josa(s.regions[room].name, '으로/로')} 물러납니다.` });
          continue;
        }
      }
    }
    // 총격범: 대원이 보이지 않는 동안에는 건물 안의 다른 사람을 찾아다니며 쏜다 (진입이 늦을수록 피해가 는다)
    if (s.variant === 'shooter' && h.weapon === 'gun' && see.nearest < 0 && (h.state === 'hold' || h.state === 'fight') && sim.t >= h.moveAt && sim.t - s.startedAt > 40) {
      let target: Casualty | null = null, td = 1e9;
      for (const c of s.casualties) { if (c.dead || c.where !== 'scene' || c.health < 72) continue; const d = dist(c.x, c.y, h.x, h.y); if (d < td) { td = d; target = c; } }      // 이미 쓰러진 사람은 다시 쏘지 않는다
      if (target) {
        if (td <= 6.5 && los(s, h.x, h.y, target.x, target.y)) {
          h.facing = Math.atan2(target.y - h.y, target.x - h.x); h.moveAt = sim.t + s.rng.range(24, 38);
          pushFx(sim, s, 'shot', h.x, h.y, target.x, target.y, undefined, '#ff8a5c', 0.25); pushFx(sim, s, 'hit', target.x, target.y);
          bulletPath(sim, s, h.x, h.y, target.x, target.y, 0);
          target.health -= s.rng.range(20, 32); target.mob = 'immobile'; target.bleed = Math.max(target.bleed, 0.13); target.bleed0 = target.bleed; target.walking = false; target.path = null;
          target.causeEvent = raiseProblem(sim, I, 'ESCALATION', `총격범의 추가 범행 (구조 대상 ${target.label})`, { role: 'SYSTEM', actor: '현장', imp: 3, truth: s.arrivedAt < 0, text: `총성! ${h.label}가 건물 안의 시민을 쐈습니다.` }, false);
          continue;
        }
        const path = astar(s, h.x, h.y, Math.round(target.x), Math.round(target.y), 4.5, truthCost(s), true);
        h.moveAt = sim.t + 5;
        if (path && path.length >= 1 && path.length <= 40) { h.path = path; h.pathI = 0; continue; }
      } else h.moveAt = sim.t + 20;
    }
    // 총격전 중 사격을 받았거나 다쳤으면 대원에게 보이지 않는 엄폐 위치로 자리를 옮긴다
    if (h.state === 'fight' && h.weapon === 'gun' && h.hostageId < 0 && see.nearest >= 0 && sim.t >= h.moveAt && (sim.t - h.shotAt < 2.5 || h.health < 100)) {
      const ta = s.agents.find((a) => a.rid === see.nearest)!;
      const hx = Math.round(h.x), hy = Math.round(h.y);
      let best = -1, bs = -1e9;
      for (let y = Math.max(0, hy - 5); y <= Math.min(s.h - 1, hy + 5); y++) for (let x = Math.max(0, hx - 5); x <= Math.min(s.w - 1, hx + 5); x++) {
        const i = y * s.w + x;
        if (s.tiles[i] !== T.FLOOR || s.propAt[i] >= 0 || (x === hx && y === hy)) continue;
        if (los(s, x, y, ta.x, ta.y)) continue;
        let near = false; for (const a of s.agents) if (a.status === 'active' && dist(a.x, a.y, x, y) < 2.6) { near = true; break; }
        if (near) continue;
        let cover = 0; for (const d of [1, -1, s.w, -s.w]) { const t2 = s.tiles[i + d]; if (t2 === T.FURN || t2 === T.WALL) { cover = 1; break; } }
        const sc = -dist(hx, hy, x, y) + cover * 0.6 + s.rng.next() * 0.5;
        if (sc > bs) { bs = sc; best = i; }
      }
      const path = best >= 0 ? astar(s, h.x, h.y, best % s.w, (best / s.w) | 0, 0, truthCost(s)) : null;
      if (path && path.length >= 1 && path.length <= 9) {
        h.path = path; h.pathI = 0; h.moveAt = sim.t + s.rng.range(8, 13);
        emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 1, text: `${h.label}가 엄폐물 뒤로 자리를 옮깁니다.` });
        continue;
      }
      h.moveAt = sim.t + 4;
    }
    if (h.state === 'hold') {
      const uncovered = s.exits.findIndex((_, k) => !exitCovered(sim, s, k));
      if (sim.t >= h.fleeAt && uncovered >= 0 && see.nearestD > 3) { startFlee(sim, s, h, uncovered); continue; }
      if (h.weapon === 'gun') {
        if (see.nearest >= 0 && (h.aggression > 0.55 || see.nearestD < 6.5)) { h.state = 'fight'; h.cooldown = 0.6 + (1 - h.aggression); }
      } else if (see.nearest >= 0 && see.nearestD < 1.8 && h.morale > 0.6) { h.state = 'fight'; h.cooldown = 0.8; }
    } else if (h.state === 'fight') {
      if (see.nearest < 0) { h.cooldown += dt; if (h.cooldown > 6) { h.state = 'hold'; h.cooldown = 1; } continue; }
      const uncovered = s.exits.findIndex((_, k) => !exitCovered(sim, s, k));
      if (h.aggression < 0.6 && h.morale < 0.5 && uncovered >= 0 && see.nearestD > 4) { startFlee(sim, s, h, uncovered); continue; }
      h.cooldown -= dt;
      if (h.cooldown <= 0) {
        const ta = s.agents.find((a) => a.rid === see.nearest)!;
        const r = sim.responders[ta.rid];
        if (h.weapon === 'gun') {
          const u = sim.units[ta.unitId];
          const moving = Math.abs(ta.x - ta.px) + Math.abs(ta.y - ta.py) > 0.05;
          const p = 0.32 * (0.6 + h.skill * 0.6) * (ta.inCover ? 0.3 : moving ? 0.6 : 1) * clamp(1.25 - see.nearestD / 16, 0.4, 1.1);
          h.cooldown = s.rng.range(1.5, 2.6);
          const hit = s.rng.chance(p);
          ta.underFireT = sim.t;
          pushFx(sim, s, 'shot', h.x, h.y, ta.x + (hit ? 0 : s.rng.range(-0.8, 0.8)), ta.y + (hit ? 0 : s.rng.range(-0.8, 0.8)), undefined, '#ff8a5c', 0.25);
          bulletPath(sim, s, h.x, h.y, ta.x, ta.y, hit ? 0 : 3);      // 탄이 지나간 창이 깨진다
          if (!hit && ta.inCover) hitCover(sim, s, ta.x, ta.y, h.x, h.y);      // 빗나간 탄에 대원의 엄폐 가구가 닳는다
          if (!I.problems.some((q) => q.code === 'ESCALATION' && q.detail === '용의자 발포')) {
            raiseProblem(sim, I, 'ESCALATION', '용의자 발포', { role: 'SYSTEM', actor: '현장', text: `${h.label}가 대원을 향해 발포했습니다!`, imp: 3 }, false);
          }
          if (hit) {
            const dmg = s.rng.range(25, 41) * (1 - u.armor * 0.6);
            r.health -= dmg; h.morale = Math.min(1, h.morale + 0.05);
            pushFx(sim, s, 'hit', ta.x, ta.y);
            ta.lastBlockEvent = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'hazard', text: `${r.name} 피격${ta.inCover ? ' (엄폐 중)' : ' (엄폐 없이 노출)'}.`, imp: 2, causes: [I.lastEvent] });
          }
        } else {
          h.cooldown = 1.8;
          if (see.nearestD < 1.8) { r.health -= s.rng.range(8, 16) * (h.weapon === 'knife' ? 1.4 : 0.6); pushFx(sim, s, 'hit', ta.x, ta.y); }
        }
        h.targetRid = ta.rid;
      }
    } else if (h.state === 'flee') {
      if (!h.path || h.pathI >= h.path.length) {
        h.state = 'escaped';
        raiseProblem(sim, I, 'SUSPECT_FLED', `${h.label} 도주`, { role: 'SYSTEM', actor: '현장', text: `${h.label}가 현장을 벗어나 도주했습니다.`, imp: 3, truth: s.arrivedAt < 0 }, false);
        // 연쇄: 총기를 든 채 달아난 용의자는 다른 곳에서 다시 범행할 수 있다
        if (h.weapon === 'gun') {
          const r = s.rng.next();
          // 차를 몰고 달아나면 추격전이 이어지고(도주 차량), 아니면 다른 곳에서 다시 범행한다
          if (r < 0.35 && !I.pursuit && !sim.gen.chain.some((c) => c.opts.parent === I.id && c.opts.variant === 'getaway') && !sim.incidents.some((J) => J.parent === I.id && J.truth.variant === 'getaway')) sim.gen.chain.push({ at: sim.t + 2, opts: { type: 'armed', variant: 'getaway', nodeId: I.truth.nodeId, parent: I.id, note: '달아난 용의자가 차를 몰고 도주합니다', rng: sim.rng.fork('getaway:' + I.id + ':' + h.id) } });
          else if (r < 0.65) sim.gen.chain.push({ at: sim.t + s.rng.range(45, 100), opts: { note: '도주한 용의자가 다른 곳에서 다시 범행을 벌입니다', type: 'armed', variant: 'robbery', parent: I.id } });
        }
        continue;
      }
      const ti = h.path[h.pathI];
      const tx = ti % s.w, ty = (ti / s.w) | 0;
      const dd = dist(h.x, h.y, tx, ty), step = 2.5 * dt * (h.health < 60 ? 0.7 : 1);
      if (dd <= step) { h.x = tx; h.y = ty; h.pathI++; const dr = doorAt(s, ti); if (dr) dr.open = true; } else { h.x += ((tx - h.x) / dd) * step; h.y += ((ty - h.y) / dd) * step; }
    }
  }
}

function startFlee(sim: Sim, s: Scene, h: Hostile, exitK: number): void {
  const e = s.exits[exitK];
  const cost = (i: number) => (staticPass(s.tiles[i]) && (s.propAt[i] < 0 || s.props[s.propAt[i]].kind === 'door') ? 0 : -1);
  const p1 = astar(s, h.x, h.y, e.x, e.y, 0, cost);
  if (!p1) return;
  // 출구를 나선 뒤 가장 가까운 지도 가장자리로
  const edgeY = e.y < s.h / 2 ? 0 : s.h - 1;
  const edgeX = e.x < s.w / 2 ? 0 : s.w - 1;
  const toSide = Math.abs(e.x - edgeX) < Math.abs(e.y - edgeY) + 4;
  const p2 = astar(s, e.x, e.y, toSide ? edgeX : e.x + (exitK === 0 ? 9 : -6), toSide ? e.y : edgeY, 0, cost) ?? [];
  h.path = p1.concat(p2); h.pathI = 0; h.state = 'flee'; h.hidden = false;
  emit(sim, { inc: sim.incidents[s.incidentId].id, role: 'SYSTEM', actor: '현장', kind: 'hazard', text: `${josa(h.label, '이/가')} ${exitName(s, exitK)}으로 도주를 시도합니다.`, imp: 2, truth: s.arrivedAt < 0 });
}

// ───────────────────────── 통과 차량 (2차 사고 위험) ─────────────────────────
export function tickLane(sim: Sim, s: Scene, I: Incident): void {
  if (!s.laneRows.length) return;
  const dt = sim.dt;
  if (sim.t >= s.nextCarAt) {
    s.nextCarAt = sim.t + s.rng.range(5.5, 11) / Math.max(0.5, s.trafficFlow);
    const k = s.rng.int(0, s.laneRows.length - 1);
    const row = s.laneRows[k];
    const dir = k === 0 ? -1 : 1;
    // 진입 방향의 통제 지점이 설치됐으면 차량이 들어오지 않는다
    const cp = dir > 0 ? 0 : 1;
    const distracted = s.rng.chance(sim.weather === 'clear' ? 0.2 : 0.3);
    if (!s.controlDone[cp] && I.phase !== 'closed') s.cars.push({ x: dir > 0 ? -1.5 : s.w + 0.5, px: 0, row, dir, speed: s.rng.range(4.2, 5.6), distracted, stopped: false, hit: false });
  }
  for (let k = s.cars.length - 1; k >= 0; k--) {
    const c = s.cars[k];
    c.px = c.x;
    if (c.hit) { c.speed = Math.max(0, c.speed - 6 * dt); }
    c.x += c.dir * c.speed * dt;
    if (c.x < -3 || c.x > s.w + 2 || (c.hit && c.speed <= 0 && sim.t > s.nextCarAt)) { s.cars.splice(k, 1); continue; }
    if (c.hit) continue;
    for (const a of s.agents) {
      if (a.status !== 'active' && a.status !== 'down') continue;
      if (Math.round(a.y) !== c.row) continue;
      const ahead = (a.x - c.x) * c.dir;
      if (ahead < -0.3 || ahead > 3.5) continue;
      if (!c.distracted) { c.speed = Math.max(1.2, c.speed - 9 * dt); if (ahead < 1.2 && !c.stopped) { c.stopped = true; pushFx(sim, s, 'text', c.x, c.row - 0.8, undefined, undefined, '급정거!', '#ffd166', 1.2); } continue; }
      if (ahead > 0.6) continue;
      const r = sim.responders[a.rid];
      r.health -= s.rng.range(28, 44);
      c.hit = true;
      pushFx(sim, s, 'hit', a.x, a.y);
      a.lastBlockEvent = raiseProblem(sim, I, 'SECONDARY_COLLISION', `통제되지 않은 차로에서 ${r.name} 2차 사고`, {
        role: 'SYSTEM', actor: '현장', rid: r.id, imp: 3, text: `2차 사고! 통제되지 않은 차로를 지나던 차량이 작업 중인 ${r.name} 대원을 충격했습니다.`,
      }, false);
      break;
    }
  }
}

/** 차량 연료 누출 → 발화 */
export function tickLeaks(sim: Sim, s: Scene, I: Incident): void {
  for (const p of s.props) {
    if (p.kind !== 'vehicle' || !p.leakRate || p.mitigated || p.ignited) continue;
    p.leak = (p.leak ?? 0) + p.leakRate * sim.dt;
    if (p.leak >= 1) {
      p.ignited = true;
      for (let x = p.x - 1; x <= p.x + p.w; x++) for (let y = p.y - 1; y <= p.y + 1; y++) {
        if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
        const i = y * s.w + x; s.fuel[i] = 0.55; s.fire[i] = 0.55;
      }
      const ev = raiseProblem(sim, I, 'HIDDEN_HAZARD', '누출된 연료에 불이 붙어 차량 화재 발생', { role: 'SYSTEM', actor: '현장', text: '차량에서 누출된 연료에 불이 붙었습니다! 차량 화재 발생.', imp: 3, truth: s.arrivedAt < 0 }, false);
      for (const cid of p.occupants ?? []) { const c = s.casualties[cid]; if (c.inVehicle === p.id) c.causeEvent = ev; }
      pushFx(sim, s, 'boom', p.x + 0.5, p.y, undefined, undefined, undefined, undefined, 1.2);
    }
  }
}

/** 2차 붕괴: 보강하지 않은 균열 구조물은 시간이 지나면 다시 무너진다 (매 틱). */
export function tickCollapse(sim: Sim, s: Scene, I: Incident): void {
  for (const p of s.props) {
    if (p.kind !== 'unstable' || p.mitigated || !p.leakRate) continue;
    p.leak = (p.leak ?? 0) + p.leakRate * sim.dt;
    if (p.leak < 1) continue;
    p.leak = 0; p.leakRate *= 0.6;
    let made = 0;
    for (let k = 0; k < 14 && made < 3; k++) {
      const x = p.x + s.rng.int(-2, 2), y = p.y + s.rng.int(-2, 2);
      if (x < 1 || y < 1 || x >= s.w - 1 || y >= s.h - 1) continue;
      const i = tidx(s, x, y);
      if (s.tiles[i] !== T.FLOOR || s.propAt[i] >= 0 || (x === p.x && y === p.y)) continue;
      if (s.agents.some((a) => a.status !== 'left' && tileOf(s, a.x, a.y) === i)) continue;      // 사람이 선 칸을 막아 가두지 않는다(피해는 아래에서 따로 입는다)
      addProp(s, 'debris', x, y, { blocking: true, hp: s.rng.range(8, 13) });
      s.damage[i] = 1; made++;
    }
    for (let y = Math.max(0, p.y - 3); y <= Math.min(s.h - 1, p.y + 3); y++) for (let x = Math.max(0, p.x - 3); x <= Math.min(s.w - 1, p.x + 3); x++) { const i = tidx(s, x, y); if (isIndoor(s.tiles[i])) s.smoke[i] = Math.max(s.smoke[i], 0.5); }
    s.staticVersion++;
    const where = s.region[tidx(s, p.x, p.y)] >= 0 ? s.regions[s.region[tidx(s, p.x, p.y)]].name : '건물';
    const ev = raiseProblem(sim, I, 'ESCALATION', `${where} 2차 붕괴`, { role: 'SYSTEM', actor: '현장', text: `2차 붕괴! ${where}의 금이 간 구조물이 다시 무너졌습니다.`, imp: 3, truth: s.arrivedAt < 0 }, false);
    blast(sim, s, I, p.x, p.y, 2.6, 28, ev);
    pushFx(sim, s, 'boom', p.x, p.y, undefined, undefined, undefined, undefined, 1.1);
  }
}

/** 가스 누출: 차단하지 않은 배관은 계속 가스를 내뿜고(연기 격자로 퍼진다), 짙게 고이면 불이 붙어 터질 수 있다 (1초에 한 번). */
export function tickGas(sim: Sim, s: Scene, I: Incident): void {
  let leaking = false;
  for (const p of s.props) {
    if (p.kind !== 'valve' || p.mitigated || p.ignited || !p.leakRate) continue;
    leaking = true;
    for (let d = -1; d < 4; d++) {
      const x = d < 0 ? p.x : p.x + NB[d * 2], y = d < 0 ? p.y : p.y + NB[d * 2 + 1];
      if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
      const i = tidx(s, x, y);
      if (s.tiles[i] !== T.WALL) s.smoke[i] = Math.max(s.smoke[i], p.leakRate * (d < 0 ? 1 : 0.92));
    }
  }
  if (!leaking) return;
  // 통제되지 않은 출입구로 다가온 주변 시민이 가스를 마신다 (경찰이 출입구를 지키면 일어나지 않는다)
  if (s.arrivedAt >= 0 && s.casualties.filter((c) => c.bystander2).length < 3) {
    s.exits.forEach((e, k) => {
      if (s.smoke[tidx(s, Math.max(0, Math.min(s.w - 1, e.x)), Math.max(0, Math.min(s.h - 1, e.y)))] < 0.12 || exitCovered(sim, s, k)) return;
      if (!s.rng.chance(Math.min(0.03, 0.011 * sim.tune.hazardMul))) return;
      const id = s.casualties.length;
      const c: Casualty = {
        id, label: String.fromCharCode(65 + id), x: e.x, y: e.y, px: e.x, py: e.y, health: s.rng.range(60, 80), bleed: s.rng.range(0.05, 0.09), mob: 'immobile', trapWork: 0, concealment: 0.05, inVehicle: null,
        where: 'scene', treated: false, treatProg: 0, dead: false, treatQ: 0, bleed0: 0.07, bystander: false, walking: false, path: null, pathI: 0, panic: false,
        wander: false, wanderT: 0, isTarget: false, hostage: false, climb: undefined, bystander2: true, inWater: undefined, drift: undefined,
        tDiscovered: -1, tFreed: -1, tTreated: -1, tSafe: -1, tLoaded: -1, tDead: -1, tHospital: -1, discoveredBy: -1, causeEvent: -1,
      };
      c.bleed0 = c.bleed;
      s.casualties.push(c);
      c.causeEvent = raiseProblem(sim, I, 'ESCALATION', '통제되지 않은 출입구에서 시민이 가스에 노출', { role: 'SYSTEM', actor: '현장', imp: 2, text: `건물 ${k === 0 ? '앞' : '뒤'}쪽으로 다가온 시민이 새어 나온 가스를 마시고 쓰러졌습니다 (출입구 통제 없음).` }, false);
    });
  }
  let dense = 0;
  for (let i = 0; i < s.smoke.length; i++) if (s.smoke[i] > 0.6 && isIndoor(s.tiles[i])) dense++;
  if (dense < 10 || !s.rng.chance(Math.min(0.007, 0.00015 * dense * sim.tune.hazardMul))) return;
  const p = s.props.find((q) => q.kind === 'valve' && !q.mitigated && !q.ignited)!;
  p.ignited = true;
  for (let y = Math.max(0, p.y - 2); y <= Math.min(s.h - 1, p.y + 2); y++) for (let x = Math.max(0, p.x - 2); x <= Math.min(s.w - 1, p.x + 2); x++) {
    const j = tidx(s, x, y);
    if (s.fuel[j] > 0 && dist(x, y, p.x, p.y) <= 1.9) s.fire[j] = Math.max(s.fire[j], 0.6);
  }
  for (let i = 0; i < s.smoke.length; i++) s.smoke[i] *= 0.45;      // 고여 있던 가스가 타 버린다
  const ev = raiseProblem(sim, I, 'HIDDEN_HAZARD', '누출된 가스에 불이 붙어 폭발', { role: 'SYSTEM', actor: '현장', text: '폭발! 고여 있던 가스에 불이 붙었습니다. 화재가 발생했습니다.', imp: 3, truth: s.arrivedAt < 0 }, false);
  blast(sim, s, I, p.x, p.y, 3.8, 32, ev);
  pushFx(sim, s, 'boom', p.x, p.y, undefined, undefined, undefined, undefined, 1.6);
}

/** 수난 사고: 물에 빠진 사람은 하류로 떠내려간다. 다리나 물가에 걸리면 멈추고, 현장 밖으로 벗어나면 잃는다 (매 틱). */
export function tickWater(sim: Sim, s: Scene, I: Incident): void {
  for (const c of s.casualties) {
    if (!c.inWater || c.dead || c.where !== 'scene' || !c.drift) continue;
    const nx = c.x + c.drift * sim.dt;
    if (nx >= s.w - 1.2) {
      c.dead = true; c.health = 0; c.tDead = sim.t; c.inWater = false;
      const known = c.tDiscovered >= 0;
      c.causeEvent = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'casualty', imp: 3, truth: !known, causes: [I.lastEvent], text: known ? `구조 대상 ${c.label}: 물살에 휩쓸려 현장 밖으로 떠내려갔습니다. 구조에 실패했습니다.` : `(미발견) 구조 대상 ${c.label}가 물살에 휩쓸려 떠내려갔습니다.` });
      continue;
    }
    if (s.tiles[tidx(s, Math.round(nx + 0.4), Math.round(c.y))] !== T.WATER) { c.drift = 0; continue; }      // 다리 기둥이나 물가에 걸렸다
    c.x = nx;
  }
}
