// 현장 환경 규칙: 화재 확산, 연기, 구조 대상 상태 악화, 용의자 행동, 통과 차량.
// 이 파일은 "세계"의 규칙이다. 대원의 행동은 이 상태를 바꾸고, 이 상태는 대원의 다음 판단을 바꾼다.

import type { Sim } from '../engine';
import { emit, raiseProblem } from '../events';
import { T } from '../types';
import type { Casualty, Hostile, Incident, Scene } from '../types';
import { clamp, dist } from '../util';
import { addProp } from './builders';
import { casFact } from './agents';
import { astar, doorAt, isIndoor, los, staticPass, tidx, tileOf, truthCost, truthWalkable } from './grid';

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
  }
  // 연기 확산
  for (let i = 0; i < n; i++) {
    const t = s.tiles[i];
    if (t === T.WALL || t === T.VOID) continue;
    const indoor = isIndoor(t);
    let target = s.fire[i];
    const x = i % w, y = (i / w) | 0;
    for (let d = 0; d < 4; d++) {
      const nx = x + NB[d * 2], ny = y + NB[d * 2 + 1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx;
      if (s.tiles[j] === T.WALL) continue;
      const v = s.smoke[j] * (indoor ? 0.86 : 0.5);
      if (v > target) target = v;
    }
    if (!indoor) target *= 0.5;
    const cur = s.smoke[i];
    s.smoke[i] = target > cur ? cur + (target - cur) * 0.3 : cur + (target - cur) * (indoor ? 0.07 : 0.3);
    if (s.smoke[i] < 0.01) s.smoke[i] = 0;
  }
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
    let b = 0; for (const i of r.tiles) if (s.burned[i]) b++;
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

function blast(sim: Sim, s: Scene, I: Incident, x: number, y: number, radius: number, dmg: number, ev: number): void {
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
    let d = c.bleed * (c.treated ? 1 : 1);
    if (c.where === 'scene' || c.where === 'carried') {
      const i = tileOf(s, c.x, c.y);
      d += s.smoke[i] * 0.42;
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

export function placeAtSafe(s: Scene, c: Casualty): void {
  const k = s.casualties.filter((q) => q.where === 'safe' && q.id !== c.id).length;
  c.x = s.safe.x - 1 + (k % 3) * 0.9; c.y = s.safe.y - 0.6 + Math.floor(k / 3) * 0.9;
  c.px = c.x; c.py = c.y;
}

// ───────────────────────── 용의자 ─────────────────────────
function officersSeeing(sim: Sim, s: Scene, h: Hostile, range: number): { n: number; nearest: number; nearestD: number } {
  let n = 0, nearest = -1, nd = 99;
  for (const a of s.agents) {
    if (a.status !== 'active') continue;
    const d = dist(a.x, a.y, h.x, h.y);
    if (d > range || !los(s, h.x, h.y, a.x, a.y)) continue;
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
    const see = officersSeeing(sim, s, h, 11);
    h.seenOfficers = see.n;
    if (h.state === 'surrendered') continue;
    // 사기 변화: 포위될수록, 부상당할수록 떨어진다
    h.morale -= (0.006 * Math.max(0, see.n - 1) + (h.health < 60 ? 0.012 : 0)) * dt;
    if (h.morale < 0.2 && h.state !== 'flee') {
      h.state = 'surrendered'; h.path = null;
      emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', text: `${h.label}가 무기를 내려놓고 투항 의사를 보입니다.`, imp: 2, truth: see.n === 0 });
      continue;
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
          const p = 0.28 * (0.6 + h.skill * 0.6) * (ta.inCover ? 0.3 : moving ? 0.5 : 1) * clamp(1.25 - see.nearestD / 16, 0.4, 1.1);
          h.cooldown = s.rng.range(1.5, 2.6);
          const hit = s.rng.chance(p);
          ta.underFireT = sim.t;
          pushFx(sim, s, 'shot', h.x, h.y, ta.x + (hit ? 0 : s.rng.range(-0.8, 0.8)), ta.y + (hit ? 0 : s.rng.range(-0.8, 0.8)), undefined, '#ff8a5c', 0.25);
          if (!I.problems.some((q) => q.code === 'ESCALATION' && q.detail === '용의자 발포')) {
            raiseProblem(sim, I, 'ESCALATION', '용의자 발포', { role: 'SYSTEM', actor: '현장', text: `${h.label}가 대원을 향해 발포했습니다!`, imp: 3 }, false);
          }
          if (hit) {
            const dmg = s.rng.range(18, 32) * (1 - u.armor * 0.6);
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
  emit(sim, { inc: sim.incidents[s.incidentId].id, role: 'SYSTEM', actor: '현장', kind: 'hazard', text: `${h.label}가 ${exitK === 0 ? '정문' : '후문'}으로 도주를 시도합니다.`, imp: 2, truth: s.arrivedAt < 0 });
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
