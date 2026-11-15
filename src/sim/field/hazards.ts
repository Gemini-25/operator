// 현장 환경 규칙: 화재 확산, 연기, 구조 대상 상태 악화, 용의자 행동, 통과 차량.
// 이 파일은 "세계"의 규칙이다. 대원의 행동은 이 상태를 바꾸고, 이 상태는 대원의 다음 판단을 바꾼다.

import { canChain } from '../chain';
import type { Sim } from '../engine';
import { emit, raiseProblem } from '../events';
import { T } from '../types';
import type { Casualty, FieldAgent, FxInfo, Hostile, Incident, InjuryCause, Prop, Scene } from '../types';
import type { Rng } from '../rng';
import { clamp, dist, josa } from '../util';
import { armorOf, blastFactor } from '../crews';
import { addProp } from './kit';
import { casFact, exitName } from './agents';
import { astar, doorAt, isIndoor, los, staticPass, tidx, tileOf, truthCost, truthWalkable } from './grid';
import { coverRoll, fireShot, heatGlass, shatter } from './damage';
import { lastFx, noteBoom, noteFlash, noteHit, noteShot, recHarm, recMelee } from './fxlog';
import { RUIN_CEILING, RUIN_SECONDARY, markRuin, recordFall } from './ruins';
import { bandOf, decayCause, hurtCas, hurtCasTo, noteDecay, noteInjury, noteRespHurt } from './injury';

export function pushFx(sim: Sim, s: Scene, kind: any, x: number, y: number, x2?: number, y2?: number, text?: string, color?: string, ttl = 1.2, c?: FxInfo): void {
  s.fx.push({ kind, t: sim.t, x, y, x2, y2, text, color, ttl, c });
  if (s.fx.length > 60) s.fx.splice(0, s.fx.length - 60);
}

export const band = bandOf;      // 중증도 단계는 세 부류가 함께 쓴다 (field/injury.ts)
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
    noteBoom(lastFx(sim, s, 'boom'), 3.6, 'tank');
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
    for (let q = 0; q < k; q++) { const i = s.rng.pick(cands); if (s.propAt[i] < 0) { addProp(s, 'debris', i % w, (i / w) | 0, { blocking: true, hp: s.rng.range(9, 14) }); markRuin(s, i, RUIN_CEILING); } }
    s.staticVersion++;
    const ev = raiseProblem(sim, I, 'ESCALATION', `${r.name} 천장 일부 붕괴`, { role: 'SYSTEM', actor: '현장', text: `${r.name} 천장 일부가 무너졌습니다.`, imp: 2, truth: s.arrivedAt < 0 }, false);
    blast(sim, s, I, r.cx, r.cy, 2.2, 22, ev, 'crush');
    recordFall(sim, s, r.cx, r.cy, 2.2, 'ceiling');      // (G4) 그림용 기록
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

/** cause: 기록에 적는 원인 — 폭발이면 blast(기본), 천장·2차 붕괴처럼 무너져 내린 것이면 crush */
export function blast(sim: Sim, s: Scene, I: Incident, x: number, y: number, radius: number, dmg: number, ev: number, cause: InjuryCause = 'blast'): void {
  for (const a of s.agents) {
    if (a.status === 'left') continue;
    const d = dist(a.x, a.y, x, y);
    if (d > radius) continue;
    const r = sim.responders[a.rid];
    const hp0 = r.health;
    r.health -= dmg * (1 - d / (radius + 1)) * blastFactor(sim, a.rid);      // 폭발물 방호복·방화복이 줄인다
    a.lastBlockEvent = ev;
    noteRespHurt(r, cause, hp0, sim.t, -1, 'world', ev);      // (H1) 기록만
  }
  for (const c of s.casualties) {
    if (c.dead || c.where !== 'scene') continue;
    const d = dist(c.x, c.y, x, y);
    if (d > radius) continue;
    hurtCas(sim, s, I, c, dmg * 0.8 * (1 - d / (radius + 1)), cause, { ev });
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
    let nWound = d, nSmoke = 0, nBurn = 0, nExpo = 0;      // (H1) 항별 기록용: 상처 · 연기(가스) · 불 · 실외 노출. 아래 식은 그대로 두고 같은 항을 따로 잡아 둔다
    if (c.where === 'scene' || c.where === 'carried') {
      const i = tileOf(s, c.x, c.y);
      d += s.smoke[i] * (s.kind === 'hazmat' ? 0.62 : 0.36);      // 새어 나온 가스는 연기보다 빨리 사람을 쓰러뜨린다
      if (s.fire[i] > 0.3) d += 2.6 * s.fire[i];
      if (!isIndoor(s.tiles[i]) && (c.isTarget || s.kind === 'search')) d += s.exposure;
      nSmoke = s.smoke[i] * (s.kind === 'hazmat' ? 0.62 : 0.36); if (s.fire[i] > 0.3) nBurn = 2.6 * s.fire[i]; if (!isIndoor(s.tiles[i]) && (c.isTarget || s.kind === 'search')) nExpo = s.exposure;
    } else if (c.where === 'loaded') d *= 0.5;
    else if (c.where === 'safe' && c.treated) d *= 0.6;
    c.health -= d * dt;
    if (d > 0) { if (c.where !== 'scene' && c.where !== 'carried') nWound = d; noteDecay(c, s, nWound, nSmoke, nBurn, nExpo, dt, sim.t); }      // (H1) 기록만
    if (c.health <= 0) {
      if (c.deathCause === undefined) c.deathCause = decayCause(c, s, I, nWound, nSmoke, nBurn, nExpo);      // (H1) 숨진 틱의 가장 큰 항 (한 번 피해로 0 이하가 됐으면 그 자리가 이미 적었다)
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
export function flashbang(sim: Sim, s: Scene, x: number, y: number, by?: FieldAgent): number {
  let n = 0;
  for (const h of s.hostiles) {
    if (h.state !== 'hold' && h.state !== 'fight') continue;
    if (dist(h.x, h.y, x, y) > 5.2 || !los(s, x, y, h.x, h.y)) continue;      // 벽 너머까지는 미치지 않는다
    h.stunUntil = sim.t + 3.8; h.morale -= 0.15; n++;
  }
  pushFx(sim, s, 'flash', x, y, undefined, undefined, undefined, undefined, 0.7);
  noteFlash(lastFx(sim, s, 'flash'), by, n);
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
    const dmg = s.rng.range(26, 40);      // 판정 흐름에서 뽑는 자리는 그대로 — 뽑은 값만 아래 hurtCas 에 넘긴다
    h.state = 'fight'; h.cooldown = 1;
    pushFx(sim, s, 'shot', h.x, h.y, c.x, c.y, undefined, '#ff8a5c', 0.25); pushFx(sim, s, 'hit', c.x, c.y);
    noteShot(sim, s, lastFx(sim, s, 'shot'), { side: 1, by: h.id, wpn: 'hgun', hit: true, tx: c.x, ty: c.y, tk: 2, target: c.id }); noteHit(lastFx(sim, s, 'hit'), { side: 1, ox: h.x, oy: h.y, tk: 2, target: c.id });
    fireShot(sim, s, h.x, h.y, c.x, c.y, 'body');
    const ev = raiseProblem(sim, I, 'ESCALATION', '진입 순간 인질 피격', { role: 'SYSTEM', actor: '현장', imp: 3, text: `진입에 놀란 ${h.label}가 인질(구조 대상 ${c.label})을 쐈습니다!` }, false);
    hurtCas(sim, s, I, c, dmg, 'gunshot', { by: h.id, byKind: 'hostile', ev, bleed: 0.18, immobile: true });
  }
}

export function officersSeeing(sim: Sim, s: Scene, h: Hostile, range: number): { n: number; nearest: number; nearestD: number } {
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
        const dmg = s.rng.range(28, 42);
        const ev = raiseProblem(sim, I, 'ESCALATION', '시한이 지나 인질이 다침', { role: 'SYSTEM', actor: '현장', imp: 3, truth: s.arrivedAt < 0, text: `${h.label}가 요구가 받아들여지지 않자 인질을 다치게 했습니다!` }, false);
        // 원인은 든 무기대로 (G5 의 recHarm 과 같은 갈래): 총 → 총상, 칼 → 자상, 맨손 → 타박상
        hurtCas(sim, s, I, c, dmg, h.weapon === 'gun' ? 'gunshot' : h.weapon === 'knife' ? 'stab' : 'blunt', { by: h.id, byKind: 'hostile', ev, bleed: 0.18, immobile: true });
        recHarm(sim, s, h, c);
        if (h.weapon === 'gun') fireShot(sim, s, h.x, h.y, c.x, c.y, 'body');      // (G5c) 그려진 탄의 선이 지나는 창도 깨진다
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
          noteShot(sim, s, lastFx(sim, s, 'shot'), { side: 1, by: h.id, wpn: 'hgun', hit: true, tx: target.x, ty: target.y, tk: 2, target: target.id }); noteHit(lastFx(sim, s, 'hit'), { side: 1, ox: h.x, oy: h.y, tk: 2, target: target.id });
          fireShot(sim, s, h.x, h.y, target.x, target.y, 'body');
          const dmg = s.rng.range(20, 32);
          const ev = raiseProblem(sim, I, 'ESCALATION', `총격범의 추가 범행 (구조 대상 ${target.label})`, { role: 'SYSTEM', actor: '현장', imp: 3, truth: s.arrivedAt < 0, text: `총성! ${h.label}가 건물 안의 시민을 쐈습니다.` }, false);
          hurtCas(sim, s, I, target, dmg, 'gunshot', { by: h.id, byKind: 'hostile', ev, bleed: 0.13, immobile: true });
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
          // 맞은 사람이 입은 방호 (부대 값이 아니라 사람 값). 방패는 교전·봉쇄 임무 중에만 세운다
          const armor = armorOf(sim, ta.rid, ta.task !== null && (ta.task.kind === 'engage' || ta.task.kind === 'perimeter'));
          const moving = Math.abs(ta.x - ta.px) + Math.abs(ta.y - ta.py) > 0.05;
          const p = 0.32 * (0.6 + h.skill * 0.6) * (ta.inCover ? 0.3 : moving ? 0.6 : 1) * clamp(1.25 - see.nearestD / 16, 0.4, 1.1);
          h.cooldown = s.rng.range(1.5, 2.6);
          const hit = s.rng.chance(p);
          ta.underFireT = sim.t;
          const mx = ta.x + (hit ? 0 : s.rng.range(-0.8, 0.8)), my = ta.y + (hit ? 0 : s.rng.range(-0.8, 0.8));      // 빗나간 탄이 겨눈 점 (판정 흐름에서 x 다음 y — 예전 그림 줄과 같은 순서)
          const ct = !hit && ta.inCover ? coverRoll(sim, s, ta.x, ta.y, h.x, h.y) : -1;      // 빗나간 탄이 대원의 엄폐 가구에 맞는가 (파손용 흐름)
          const end = hit || ct >= 0 ? fireShot(sim, s, h.x, h.y, ta.x, ta.y, hit ? 'body' : ct) : fireShot(sim, s, h.x, h.y, mx, my, 'miss');      // 탄이 실제로 간 선: 지나간 창이 깨지고 엄폐 가구가 닳는다
          pushFx(sim, s, 'shot', h.x, h.y, end.x, end.y, undefined, '#ff8a5c', 0.25);
          noteShot(sim, s, lastFx(sim, s, 'shot'), { side: 1, by: h.id, wpn: 'hgun', hit, end, tx: ta.x, ty: ta.y, tk: 0, target: ta.rid, arm: armor });
          if (!I.problems.some((q) => q.code === 'ESCALATION' && q.detail === '용의자 발포')) {
            raiseProblem(sim, I, 'ESCALATION', '용의자 발포', { role: 'SYSTEM', actor: '현장', text: `${h.label}가 대원을 향해 발포했습니다!`, imp: 3 }, false);
          }
          if (hit) {
            const dmg = s.rng.range(25, 41) * (1 - armor * 0.6);
            r.health -= dmg; h.morale = Math.min(1, h.morale + 0.05);
            pushFx(sim, s, 'hit', ta.x, ta.y);
            noteHit(lastFx(sim, s, 'hit'), { side: 1, ox: h.x, oy: h.y, tk: 0, target: ta.rid, arm: armor });
            ta.lastBlockEvent = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'hazard', text: `${r.name} 피격${ta.inCover ? ' (엄폐 중)' : ' (엄폐 없이 노출)'}.`, imp: 2, causes: [I.lastEvent] });
            noteRespHurt(r, 'gunshot', r.health + dmg, sim.t, h.id, 'hostile', ta.lastBlockEvent);      // (H1) 기록만 — dmg 는 방호를 뺀 뒤의 값
          }
        } else {
          h.cooldown = 1.8;
          const hp0 = r.health;
          if (see.nearestD < 1.8) { r.health -= s.rng.range(8, 16) * (h.weapon === 'knife' ? 1.4 : 0.6); pushFx(sim, s, 'hit', ta.x, ta.y); }
          if (see.nearestD < 1.8) { noteHit(lastFx(sim, s, 'hit'), { side: 1, ox: h.x, oy: h.y, tk: 0, target: ta.rid }); recMelee(sim, s, h, ta); }      // (G5) 위 줄과 같은 조건: 기존 줄을 바꾸지 않으려고 따로 둔다
          noteRespHurt(r, h.weapon === 'knife' ? 'stab' : 'blunt', hp0, sim.t, h.id, 'hostile');      // (H1) 기록만 — 흉기는 자상, 맨손은 타박상
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
          // 연쇄 상한(chain.ts): 넘으면 예약하지 않는다. 난수는 상한과 상관없이 똑같이 뽑는다(상한에 걸리지 않는 교대의 결과를 바꾸지 않는다)
          const room = canChain(sim, I);
          // 차를 몰고 달아나면 추격전이 이어지고(도주 차량), 아니면 다른 곳에서 다시 범행한다
          if (r < 0.35 && !I.pursuit && !sim.gen.chain.some((c) => c.opts.parent === I.id && c.opts.variant === 'getaway') && !sim.incidents.some((J) => J.parent === I.id && J.truth.variant === 'getaway')) { if (room) sim.gen.chain.push({ at: sim.t + 2, opts: { type: 'armed', variant: 'getaway', nodeId: I.truth.nodeId, parent: I.id, note: '달아난 용의자가 차를 몰고 도주합니다', rng: sim.rng.fork('getaway:' + I.id + ':' + h.id) } }); }
          else if (r < 0.65) { const at = sim.t + s.rng.range(45, 100); if (room) sim.gen.chain.push({ at, opts: { note: '도주한 용의자가 다른 곳에서 다시 범행을 벌입니다', type: 'armed', variant: 'robbery', parent: I.id } }); }
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
      const hp0 = r.health;
      r.health -= s.rng.range(28, 44);
      c.hit = true;
      pushFx(sim, s, 'hit', a.x, a.y);
      a.lastBlockEvent = raiseProblem(sim, I, 'SECONDARY_COLLISION', `통제되지 않은 차로에서 ${r.name} 2차 사고`, {
        role: 'SYSTEM', actor: '현장', rid: r.id, imp: 3, text: `2차 사고! 통제되지 않은 차로를 지나던 차량이 작업 중인 ${r.name} 대원을 충격했습니다.`,
      }, false);
      noteRespHurt(r, 'vehicle', hp0, sim.t, -1, 'world', a.lastBlockEvent);      // (H1) 기록만
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
      noteBoom(lastFx(sim, s, 'boom'), 1.5, 'fuel');
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
      s.damage[i] = 1; made++; markRuin(s, i, RUIN_SECONDARY);
    }
    for (let y = Math.max(0, p.y - 3); y <= Math.min(s.h - 1, p.y + 3); y++) for (let x = Math.max(0, p.x - 3); x <= Math.min(s.w - 1, p.x + 3); x++) { const i = tidx(s, x, y); if (isIndoor(s.tiles[i])) s.smoke[i] = Math.max(s.smoke[i], 0.5); }
    s.staticVersion++;
    const where = s.region[tidx(s, p.x, p.y)] >= 0 ? s.regions[s.region[tidx(s, p.x, p.y)]].name : '건물';
    const ev = raiseProblem(sim, I, 'ESCALATION', `${where} 2차 붕괴`, { role: 'SYSTEM', actor: '현장', text: `2차 붕괴! ${where}의 금이 간 구조물이 다시 무너졌습니다.`, imp: 3, truth: s.arrivedAt < 0 }, false);
    blast(sim, s, I, p.x, p.y, 2.6, 28, ev, 'crush');
    recordFall(sim, s, p.x, p.y, 2.6, 'secondary');      // (G4) 예전의 pushFx(…'boom'…) 자리: 무너짐은 폭발 그림이 아니라 'collapse' 로 그린다
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
        injuries: undefined, bleedCause: undefined, deathCause: undefined, lost: undefined,      // (H1) kit.addCas 와 같은 칸, 같은 순서
      };
      c.bleed0 = c.bleed;
      s.casualties.push(c);
      c.causeEvent = raiseProblem(sim, I, 'ESCALATION', '통제되지 않은 출입구에서 시민이 가스에 노출', { role: 'SYSTEM', actor: '현장', imp: 2, text: `건물 ${k === 0 ? '앞' : '뒤'}쪽으로 다가온 시민이 새어 나온 가스를 마시고 쓰러졌습니다 (출입구 통제 없음).` }, false);
      c.injuries = noteInjury(c.injuries, 'toxic', 100 - c.health, sim.t, bandOf(c.health), -1, 'world', c.causeEvent); c.bleedCause = 'toxic';      // (H1) 사건 중에 붙는 사람은 만드는 자리가 원인을 적는다
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
  noteBoom(lastFx(sim, s, 'boom'), 3.8, 'gas');
}

// ───────────────────────── 배회하는 실종자 ─────────────────────────
// 길을 잃고 숲을 헤매는 사람(실종 · 배회)에게 찾기 전까지 일어날 수 있는 일. 진실만 바꾼다 — 대원은 보거나(perceive) 찾아야 안다.
//   개울가를 걷다 미끄러져 물에 빠진다 → 물살에 떠밀려 내려가다 다리·바위에 걸린다. 찬물에서 빠르게 나빠진다(수난 구조가 필요하다)
//   바위 비탈이나 덤불에서 넘어져 다친다 → 더는 걷지 못하고 악화가 빨라진다
//   비·밤·안개 속에서 체온을 잃는다 → 주저앉아 움직이지 않고 악화가 빨라진다
// 난수는 사건마다 따로 만든 흐름(wander:<사건>:<대상>)만 쓴다. 현장 흐름(s.rng)의 배회 이동 순서는 그대로다.

/** 배회 실종자에게 일어나는 일의 확률·속도. 균형은 여기서 맞춘다 */
export const WANDER = {
  straight: 0.6, stride: 5,        // 새 걸음을 뗄 때 들어온 쪽(현장 입구)에서 멀어지는 쪽으로 곧장 걸을 확률과 거리(칸): 길 잃은 사람은 막힐 때까지 곧장 걷는다
  slip: 0.06, slipBad: 0.12,     // 물가(개울과 맞닿은 칸)에서 1초에 미끄러져 빠질 확률: 맑음 / 비·밤·안개
  fall: 0.006, fallBad: 0.012,     // 바위 곁이나 덤불 속에서 1초에 넘어질 확률
  fallHit: [6, 14], fallMul: 2.6, brush: 0.1,  // 넘어질 때 잃는 체력, 악화 속도 배율, 덤불 속에 쓰러지면 더 가려지는 정도
  dunk: [8, 18], cold: [0.45, 0.6], cling: 0.6,      // 물에 빠질 때 잃는 체력, 물살에 휩쓸리는 동안의 악화 속도(난이도의 악화 배율을 곱한다), 무언가를 붙잡고 버티는 동안의 배율
  drift: [0.14, 0.3], snag: 0.08, slipGrip: 0.04, gripHp: 35,  // 떠내려가는 속도(칸/초, 하류 = +y), 1초에 물가 나무뿌리에 걸릴 확률, 지친 사람(체력 gripHp 아래)이 1초에 붙잡은 것을 놓칠 확률
  under: 0.18, underHit: [8, 20],  // 떠내려가는 동안 1초에 물속으로 가라앉아 물을 먹을 확률과 그때 잃는 체력
  chill: { clear: 0.25, fog: 0.6, rain: 1, night: 1 } as Record<string, number>,      // 1초에 쌓이는 추위
  chillAt: [50, 170], chillBleed: 0.25, burrow: 0.2,   // 저체온으로 주저앉는 추위, 그때 더해지는 악화 속도, 덤불·바위 밑으로 기어드는 정도(저체온의 이상 행동)
  hideMax: 0.84,                   // 기어들거나 덤불에 쓰러져도 이보다 더 가려지지는 않는다 (조난자가 덤불 속에 있을 때의 상한과 같다: 정밀 재수색으로 찾을 수 있는 정도)
};
interface WanderState { rng: Rng; phase: 'walk' | 'down' | 'water' | 'out'; chill: number; chillAt: number; col: number; speed: number; held: '' | 'root' | 'fixed'; path: number[] | null }
const wanderStates = new WeakMap<Casualty, WanderState>();

function nearTile(s: Scene, x: number, y: number, t: number, r: number): number {
  const cx = Math.round(x), cy = Math.round(y);
  let best = -1, bd = 1e9;
  for (let yy = cy - r; yy <= cy + r; yy++) for (let xx = cx - r; xx <= cx + r; xx++) {
    if (xx < 0 || yy < 0 || xx >= s.w || yy >= s.h || s.tiles[yy * s.w + xx] !== t) continue;
    const d = dist(x, y, xx, yy);
    if (d < bd) { bd = d; best = yy * s.w + xx; }
  }
  return best;
}

/** 배회 실종자 (매 틱, 실종 현장만) */
export function tickWander(sim: Sim, s: Scene, I: Incident): void {
  for (let ci = 0; ci < s.casualties.length; ci++) { const c = s.casualties[ci];
    if (!c.isTarget || c.dead || c.where !== 'scene') continue;
    let st = wanderStates.get(c);
    if (!st) {
      if (!c.wander) continue;
      const rng = sim.rng.fork(`wander:${I.id}:${c.id}`);
      st = { rng, phase: 'walk', chill: 0, chillAt: rng.range(WANDER.chillAt[0], WANDER.chillAt[1]), col: -1, speed: 0, held: '', path: null };
      wanderStates.set(c, st);
    }
    if (st.phase === 'water') { if (c.inWater) creekDrift(sim, s, I, c, st); else st.phase = 'out'; continue; }
    if (st.phase !== 'walk' || c.tDiscovered >= 0) continue;      // 찾기 전까지만
    const rng = st.rng, bad = sim.weather !== 'clear';
    // 새 걸음(배회 이동이 방금 고른 길): 현장 입구에서 멀어지는 쪽으로 곧장 걷는 길로 바꾸기도 한다
    if (c.path && c.path !== st.path) {
      st.path = c.path;
      if (rng.chance(WANDER.straight)) {
        const ang = Math.atan2(c.y - s.staging.y, c.x - s.staging.x) + rng.range(-0.7, 0.7);
        const tx = clamp(Math.round(c.x + Math.cos(ang) * WANDER.stride), 1, s.w - 2), ty = clamp(Math.round(c.y + Math.sin(ang) * WANDER.stride), 1, s.h - 2);      // 현장(수색 범위)의 맨 가장자리까지는 가지 않는다
        const p = staticPass(s.tiles[ty * s.w + tx]) ? astar(s, c.x, c.y, tx, ty, 0, truthCost(s)) : null;
        if (p) { c.path = p; c.pathI = 0; st.path = p; }
      }
    }
    if ((sim.tick + s.id) % 5 !== 0) continue;      // 아래는 1초에 한 번
    const i = tileOf(s, c.x, c.y);
    // 개울가에서 미끄러짐
    const wet = nearTile(s, c.x, c.y, T.WATER, 1);
    if (wet >= 0 && rng.chance(bad ? WANDER.slipBad : WANDER.slip)) {
      st.phase = 'water'; st.col = wet % s.w;
      c.wander = false; c.path = null; c.inWater = true; c.mob = 'trapped'; c.trapWork = 0;
      c.x = wet % s.w; c.y = (wet / s.w) | 0;
      // 난수는 예전 자리·예전 순서 그대로(잃는 체력 → 찬물의 악화 → 떠내려가는 속도) 뽑고, 뽑은 값만 hurtCasTo 에 넘긴다. 이 일만으로는 숨지지 않는다(하한 5)
      const to = Math.max(5, c.health - rng.range(WANDER.dunk[0], WANDER.dunk[1])), cold = rng.range(WANDER.cold[0], WANDER.cold[1]) * sim.tune.bleedMul;
      c.drift = st.speed = rng.range(WANDER.drift[0], WANDER.drift[1]);
      c.concealment = Math.min(c.concealment, 0.15);      // 물속에서 허우적거리는 사람은 덤불 속보다 눈에 띈다
      const ev = raiseProblem(sim, I, 'HIDDEN_HAZARD', '배회하던 실종자가 개울에 빠짐', { role: 'SYSTEM', actor: '현장', imp: 3, truth: true, text: `(미발견) 배회하던 ${josa(c.label, '이/가')} 개울가에서 미끄러져 물에 빠졌습니다. 물살에 떠밀려 내려갑니다.` }, false);
      hurtCasTo(sim, s, I, c, to, 'drown', { ev, bleed: cold }); c.bleedCause = 'drown';      // 물속에 있는 동안의 악화는 익수로 적는다
      continue;
    }
    // 바위 비탈·덤불에서 넘어짐
    const rough = s.tiles[i] === T.TREE || nearTile(s, c.x, c.y, T.ROCK, 1) >= 0;
    if (rough && rng.chance(bad ? WANDER.fallBad : WANDER.fall)) {
      st.phase = 'down';
      c.wander = false; c.path = null; c.mob = 'immobile';
      const to = Math.max(5, c.health - rng.range(WANDER.fallHit[0], WANDER.fallHit[1])), bl0 = c.bleed;      // 하한 5
      c.bleed *= WANDER.fallMul; c.bleed0 = c.bleed;
      if (c.bleed > bl0) c.bleedCause = 'fall';      // 넘어져 빨라진 악화는 추락으로 적는다
      if (s.tiles[i] === T.TREE) c.concealment = Math.max(c.concealment, Math.min(WANDER.hideMax, c.concealment + WANDER.brush));
      const ev = raiseProblem(sim, I, 'ESCALATION', '배회하던 실종자가 넘어져 다침', { role: 'SYSTEM', actor: '현장', imp: 2, truth: true, text: `(미발견) 배회하던 ${josa(c.label, '이/가')} ${s.tiles[i] === T.TREE ? '덤불' : '바위 비탈'}에서 넘어져 다쳤습니다. 더는 걷지 못합니다.` }, false);
      hurtCasTo(sim, s, I, c, to, 'fall', { ev });
      continue;
    }
    // 추위: 비·밤·안개 속에서 체온을 잃는다
    st.chill += WANDER.chill[sim.weather] ?? 0.25;
    if (st.chill >= st.chillAt) {
      st.phase = 'down';
      c.wander = false; c.path = null; c.mob = 'immobile';
      c.bleed += WANDER.chillBleed * sim.tune.bleedMul; c.bleed0 = c.bleed;
      c.bleedCause = 'exposure';      // 추위로 늘어난 악화는 실외 노출로 적는다
      c.concealment = Math.max(c.concealment, Math.min(WANDER.hideMax, c.concealment + WANDER.burrow));      // 추위에 정신이 흐려진 사람은 몸을 숨길 곳으로 기어든다
      const why = sim.weather === 'rain' ? '비에 젖어' : sim.weather === 'night' ? '밤 추위에' : sim.weather === 'fog' ? '차가운 안개 속에서' : '오래 헤매다';
      c.causeEvent = raiseProblem(sim, I, 'ESCALATION', '실종자 저체온', { role: 'SYSTEM', actor: '현장', imp: 2, truth: true, text: `(미발견) ${josa(c.label, '이/가')} ${why} 체온을 잃고 덤불 밑으로 기어들어 웅크렸습니다. 상태가 빠르게 나빠집니다.` }, false);
    }
  }
}

/** 개울에 빠진 사람이 하류(+y)로 떠내려간다. 다음 줄에 물이 없으면(다리·현장 끝) 그 자리에 걸리고, 물가의 뿌리·바위에 걸리기도 한다 */
function creekDrift(sim: Sim, s: Scene, I: Incident, c: Casualty, st: WanderState): void {
  const sec = (sim.tick + s.id) % 5 === 0;
  if (!c.drift) {
    // 붙잡고 버티던 사람이 지치면 손을 놓친다 (다리 기둥이나 현장 끝에 걸린 사람은 그대로 걸려 있다)
    if (!sec || st.held !== 'root' || c.health >= WANDER.gripHp || !st.rng.chance(WANDER.slipGrip)) return;
    st.held = ''; c.drift = st.speed; c.bleed /= WANDER.cling; c.bleed0 = c.bleed;
    emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 2, truth: c.tDiscovered < 0, causes: [c.causeEvent], text: `${c.tDiscovered < 0 ? '(미발견) ' : ''}지친 ${josa(c.label, '이/가')} 붙잡고 있던 나무뿌리를 놓쳤습니다. 다시 떠내려갑니다.` });
    return;
  }
  let snag = '';
  if (sec && st.rng.chance(WANDER.under)) hurtCasTo(sim, s, I, c, Math.max(1, c.health - st.rng.range(WANDER.underHit[0], WANDER.underHit[1])), 'drown', { ev: c.causeEvent });      // 물살에 휩쓸려 물을 먹는다 (하한 1 — 숨이 멎는 것은 구조 대상 악화 규칙이 판정한다)
  if (sec && st.rng.chance(WANDER.snag)) snag = '물가의 나무뿌리';
  const ny = c.y + c.drift * sim.dt, row = Math.round(ny);
  if (!snag && row !== Math.round(c.y)) {
    let col = -1;
    if (row < s.h) for (const dx of [0, -1, 1]) { const x = st.col + dx; if (x >= 0 && x < s.w && s.tiles[row * s.w + x] === T.WATER) { col = x; break; } }
    if (col < 0) snag = row >= s.h ? '하류 끝 바위' : '다리 기둥';
    else { st.col = col; c.x = col; }      // 굽은 물길을 따라 옆 칸으로 (반올림한 자리가 늘 물 칸이게 줄을 넘는 순간 옮긴다)
  }
  if (snag) {
    st.held = snag === '물가의 나무뿌리' ? 'root' : 'fixed';
    c.drift = 0; c.x = st.col; c.bleed *= WANDER.cling; c.bleed0 = c.bleed;      // 머리를 물 밖에 두고 버틴다
    emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 1, truth: c.tDiscovered < 0, causes: [c.causeEvent], text: `${c.tDiscovered < 0 ? '(미발견) ' : ''}물에 빠진 ${josa(c.label, '이/가')} 떠내려가다 ${snag}에 걸렸습니다.` });
    return;
  }
  c.y = ny;
}

// ───────────────────────── 잔해에 눌려 있던 사람 ─────────────────────────
// 무너진 잔해에 오래 눌려 있던 몸은 풀려나는 순간 오히려 나빠질 수 있다(압궤 증후군). 오래 걸린 구출일수록 위험하다.
// 대원이 바로 곁에서 구출하므로 보고 안다. 흐름 crush:<사건>:<사람>.

/** 붕괴 현장의 압궤 증후군: 눌려 있던 시간(사건 발생부터 초)이 이보다 길면, 풀려날 때 이 확률로 체력을 잃고 악화가 빨라진다(난이도의 악화 배율을 곱한다) */
export const CRUSH = { after: 70, p: 0.4, hit: [8, 16], bleed: [0.26, 0.4] };
interface CrushState { rng: Rng; since: number; done: boolean }
const crushStates = new WeakMap<Casualty, CrushState>();

/** 건물 붕괴 (매 틱, 승강기 갇힘을 뺀 붕괴 현장) */
export function tickCrush(sim: Sim, s: Scene, I: Incident): void {
  for (let ci = 0; ci < s.casualties.length; ci++) { const c = s.casualties[ci];
    if (c.dead || c.inWater) continue;
    let st = crushStates.get(c);
    if (!st) { if (c.mob !== 'trapped') continue; st = { rng: sim.rng.fork(`crush:${I.id}:${c.id}`), since: sim.t, done: false }; crushStates.set(c, st); }
    if (st.done || c.mob === 'trapped') continue;
    st.done = true;      // 방금 풀려났다
    if (sim.t - st.since < CRUSH.after || !st.rng.chance(CRUSH.p)) continue;
    const to = Math.max(1, c.health - st.rng.range(CRUSH.hit[0], CRUSH.hit[1])), bl0 = c.bleed;      // 이 일만으로는 숨지지 않는다(하한 1)
    c.bleed0 = Math.max(c.bleed0, st.rng.range(CRUSH.bleed[0], CRUSH.bleed[1]) * sim.tune.bleedMul);
    c.bleed = c.treated ? c.bleed0 * (1 - 0.9 * c.treatQ) : c.bleed0;
    if (c.bleed > bl0) c.bleedCause = 'crush';
    const ev = raiseProblem(sim, I, 'ESCALATION', `구출된 사람의 압궤 증후군 (구조 대상 ${c.label})`, { role: 'SYSTEM', actor: '현장', imp: 3, text: `구출된 ${c.label}의 상태가 급격히 나빠집니다 — 잔해에 ${Math.round(sim.t - st.since)}초 넘게 눌려 있던 몸이 풀리며 압궤 증후군이 왔습니다. 서둘러 처치·이송해야 합니다.` }, false);
    hurtCasTo(sim, s, I, c, to, 'crush', { ev });
  }
}

// ───────────────────────── 승강기에 갇힌 사람 ─────────────────────────
// 오래 갇혀 있으면 숨이 막히고 겁에 질린다. 지병(심장)이 있는 사람은 문이 열리기 전에 쓰러지기도 한다.
// 문이 잠겨 있으니 아무도 보지 못한다(진실 기록) — 문을 열고 들어간 대원이 보고 안다. 흐름 lift:<사건>:<사람>.

/** 승강기에 갇힌 사람이 쓰러질 확률, 시각(사건 발생 뒤 초), 그때 남는 체력의 상한, 악화 속도(난이도의 악화 배율을 곱한다) */
export const LIFT = { attack: 0.3, at: [25, 120], hp: [42, 58], bleed: [0.32, 0.46] };
interface LiftState { door: Prop | null; due: { id: number; t: number; hp: number; bleed: number }[] }
const liftStates = new WeakMap<Scene, LiftState>();

/** 승강기 갇힘 (매 틱, 승강기 현장만) */
export function tickLift(sim: Sim, s: Scene, I: Incident): void {
  let st = liftStates.get(s);
  if (!st) {
    const car = s.regions.find((r) => r.name === '승강기');
    st = { door: car ? s.props.find((p) => p.kind === 'door' && s.region[tidx(s, p.x, p.y)] === car.id) ?? null : null, due: [] };
    for (const c of s.casualties) {
      if (c.mob !== 'mobile') continue;
      const r = sim.rng.fork(`lift:${I.id}:${c.id}`);
      if (r.chance(LIFT.attack)) st.due.push({ id: c.id, t: sim.t + r.range(LIFT.at[0], LIFT.at[1]), hp: r.range(LIFT.hp[0], LIFT.hp[1]), bleed: r.range(LIFT.bleed[0], LIFT.bleed[1]) });
    }
    liftStates.set(s, st);
  }
  if (!st.due.length || !st.door || !st.door.locked) return;      // 문이 열렸으면 다들 걸어 나온다
  for (let k = st.due.length - 1; k >= 0; k--) {
    const e = st.due[k];
    if (sim.t < e.t) continue;
    st.due.splice(k, 1);
    const c = s.casualties[e.id];
    if (c.dead || c.where !== 'scene' || c.mob !== 'mobile') continue;
    c.mob = 'immobile'; c.walking = false; c.path = null;
    const ev = raiseProblem(sim, I, 'ESCALATION', '승강기에 갇힌 사람이 쓰러짐', { role: 'SYSTEM', actor: '현장', imp: 3, truth: true, text: `(문 안쪽) 승강기에 오래 갇혀 있던 ${josa(c.label, '이/가')} 숨이 가빠지더니 쓰러졌습니다 — 지병(심장)이 도졌습니다.` }, false);
    hurtCasTo(sim, s, I, c, Math.min(c.health, e.hp), 'illness', { ev, bleed: e.bleed * sim.tune.bleedMul }); c.bleedCause = 'illness';      // 그 값까지 떨어진다 (이미 더 낮으면 그대로)
  }
}

// ───────────────────────── 응급 환자의 급변 ─────────────────────────
// 신고만으로는 알 수 없는 환자의 속사정. 진실만 바꾼다 — 대원은 환자 곁에서 보고(perceive) 안다.
//   실신: 원인이 부정맥이면 어느 순간 심정지로 넘어간다 → 받은 처치가 더는 듣지 않는다. 가슴 압박(처치)을 다시 해야 한다
//   낙상·외상: 겉보다 다친 곳이 깊으면(내부 출혈·머리 손상) 어느 순간 빠르게 나빠진다 → 현장 처치로는 일부만 늦출 수 있다. 빨리 병원으로
//   심정지: 제세동이 듣지 않는 리듬이면 가슴 압박·전문 처치로도 일부만 늦출 수 있다
// 난수는 환자마다 따로 만든 흐름(medical:<사건>:<환자>)만 쓴다. 현장이 도는 동안만(이송 중인 구급차 안까지) 일어난다.

/** 응급 환자의 급변 확률·시각·세기. 균형은 여기서 맞춘다 */
export const MEDICAL = {
  arrhythmia: 0.3, faintAt: [10, 80], arrestHp: [55, 68], arrestBleed: [0.5, 0.66],      // 실신 → 심정지로 넘어갈 확률, 시각(사건 발생 뒤 초), 그때 남는 체력의 상한, 그때의 악화 속도(심정지 환자와 같다. 난이도의 악화 배율을 곱한다)
  internal: 0.3, traumaAt: [5, 70], internalMul: [3, 4.2],              // 낙상·외상 → 내부 출혈 확률, 시각, 악화 속도 배율
  refractory: 0.3,                                                      // 심정지 → 제세동이 듣지 않는 리듬일 확률
  care: 0.2,                                                            // 내부 출혈·제세동이 듣지 않는 리듬에서 현장 처치가 막아 내는 몫 (나머지는 병원에서만)
};
interface MedState { kind: 'none' | 'arrest' | 'internal' | 'refractory'; at: number; fired: boolean; rng: Rng }
const medStates = new WeakMap<Casualty, MedState>();

/** 응급 환자 (매 틱, 응급 환자 현장만) */
export function tickMedical(sim: Sim, s: Scene, I: Incident): void {
  for (let ci = 0; ci < s.casualties.length; ci++) { const c = s.casualties[ci];
    if (c.dead || c.where === 'hospital') continue;
    let st = medStates.get(c);
    if (!st) {
      const rng = sim.rng.fork(`medical:${I.id}:${c.id}`);
      const v = s.variant;
      st = v === 'faint' && rng.chance(MEDICAL.arrhythmia) ? { kind: 'arrest', at: sim.t + rng.range(MEDICAL.faintAt[0], MEDICAL.faintAt[1]), fired: false, rng }
        : v === 'trauma' && rng.chance(MEDICAL.internal) ? { kind: 'internal', at: sim.t + rng.range(MEDICAL.traumaAt[0], MEDICAL.traumaAt[1]), fired: false, rng }
        : v === 'arrest' && rng.chance(MEDICAL.refractory) ? { kind: 'refractory', at: sim.t, fired: false, rng }
        : { kind: 'none', at: Infinity, fired: false, rng };
      medStates.set(c, st);
    }
    if (st.kind === 'none') continue;
    const seen = s.agents.some((a) => a.status === 'active');      // 현장에 대원이 있으면 곁에서 바로 알아챈다 (아니면 진실 기록)
    if (!st.fired && st.kind === 'refractory') {
      if (!c.treated) continue;
      st.fired = true;      // 첫 처치에서 드러난다
      c.causeEvent = raiseProblem(sim, I, 'ESCALATION', '제세동이 듣지 않는 심정지', { role: 'SYSTEM', actor: '현장', imp: 3, text: `환자 ${c.label}: 가슴 압박과 처치를 이어 가지만 맥박이 돌아오지 않습니다 — 제세동이 듣지 않는 리듬입니다. 빨리 병원으로 옮겨야 합니다.` }, false);
    } else if (!st.fired && sim.t >= st.at) {
      st.fired = true;
      if (st.kind === 'arrest') {
        const to = Math.min(c.health, st.rng.range(MEDICAL.arrestHp[0], MEDICAL.arrestHp[1]));
        c.bleed0 = st.rng.range(MEDICAL.arrestBleed[0], MEDICAL.arrestBleed[1]) * sim.tune.bleedMul; c.bleed = c.bleed0;
        c.treated = false; c.treatQ = 0; c.treatProg = 0; c.bystander = false;      // 실신에 맞춘 처치도, 곁을 지키던 신고자의 돌봄도 심정지에는 듣지 않는다 (가슴 압박이 필요하다)
        const ev = raiseProblem(sim, I, 'ESCALATION', '실신 환자가 심정지로 넘어감', { role: 'SYSTEM', actor: '현장', imp: 3, truth: !seen, text: `${seen ? '' : '(현장 도착 전) '}환자 ${c.label}의 상태가 급변했습니다 — 심정지. 실신의 원인은 부정맥이었습니다.` }, false);
        hurtCasTo(sim, s, I, c, to, 'illness', { ev }); c.bleedCause = 'illness';
      } else {
        c.bleed0 *= st.rng.range(MEDICAL.internalMul[0], MEDICAL.internalMul[1]);
        c.bleed = c.treated ? c.bleed0 * (1 - 0.9 * c.treatQ * MEDICAL.care) : c.bleed0;
        c.causeEvent = raiseProblem(sim, I, 'ESCALATION', '외상 환자의 내부 출혈', { role: 'SYSTEM', actor: '현장', imp: 3, truth: !seen, text: `${seen ? '' : '(현장 도착 전) '}환자 ${c.label}: 겉보다 다친 곳이 깊었습니다 — 내부 출혈로 상태가 빠르게 나빠집니다.` }, false);
      }
    }
    // 내부 출혈·제세동이 듣지 않는 리듬: 현장 처치는 일부만 늦춘다
    if (st.fired && st.kind !== 'arrest' && c.treated) c.bleed = Math.max(c.bleed, c.bleed0 * (1 - 0.9 * c.treatQ * MEDICAL.care));
  }
}

/** 수난 사고: 물에 빠진 사람은 하류로 떠내려간다. 다리나 물가에 걸리면 멈추고, 현장 밖으로 벗어나면 잃는다 (매 틱). */
export function tickWater(sim: Sim, s: Scene, I: Incident): void {
  for (const c of s.casualties) {
    if (!c.inWater || c.dead || c.where !== 'scene' || !c.drift) continue;
    const nx = c.x + c.drift * sim.dt;
    if (nx >= s.w - 1.2) {
      const known = c.tDiscovered >= 0;
      const ev = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'casualty', imp: 3, truth: !known, causes: [I.lastEvent], text: known ? `구조 대상 ${c.label}: 물살에 휩쓸려 현장 밖으로 떠내려갔습니다. 구조에 실패했습니다.` : `(미발견) 구조 대상 ${c.label}가 물살에 휩쓸려 떠내려갔습니다.` });
      hurtCasTo(sim, s, I, c, 0, 'drown', { ev });      // 남은 체력을 익수로 적고, 숨지게 한 원인도 익수로 (이미 정해져 있으면 그대로)
      c.dead = true; c.health = 0; c.tDead = sim.t; c.inWater = false;      // 사망은 지금처럼 그 자리에서
      c.lost = true;      // 현장 밖으로 떠내려갔다 — 화면이 그리지 않는다
      continue;
    }
    if (s.tiles[tidx(s, Math.round(nx + 0.4), Math.round(c.y))] !== T.WATER) { c.drift = 0; continue; }      // 다리 기둥이나 물가에 걸렸다
    c.x = nx;
  }
}
