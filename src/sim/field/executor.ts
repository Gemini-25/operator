// BehaviorExecutor — 선택된 임무를 실제 행동으로 실행한다.
// 모든 행동은 현장 상태(화재, 잔해, 구조 대상, 용의자, 장비)를 직접 바꾼다.
// 이동은 대원의 "믿음"으로 계획되므로, 모르는 장애물은 부딪혀 본 뒤에야 알게 된다.

import type { Sim } from '../engine';
import { emit, markRecovered, raiseProblem } from '../events';
import { T } from '../types';
import type { Fact, FieldAgent, Incident, Scene, Task, TaskKind, WorkItem } from '../types';
import { clamp, dist, josa, pct } from '../util';
import { agentCost, casFact, detectRadius, hosFact, learn, learnQuiet, perceive, regionNameAt, resp, staminaF, visionOf, workLabel } from './agents';
import { mkFact } from './beliefs';
import { astar, doorAt, isIndoor, los, staticPass, tileOf, walkableCount } from './grid';
import { applyWater, flashbang, hostageNear, hostileActive, isHeld, placeAtSafe, pushFx } from './hazards';

export function makeTask(kind: TaskKind, label: string, w: WorkItem | null = null): Task {
  return {
    kind, workId: w ? w.id : -1, region: w ? w.region : -1, cas: w ? w.cas : -1, prop: w ? w.prop : -1, hostile: w ? w.hostile : -1, tile: w ? w.tile : -1, mate: w ? w.mate : -1,
    phase: 0, progress: 0, need: 1, tx: 0, ty: 0, range: 0, pts: null, ptI: 0, covered: null,
    startedAt: 0, selfAssigned: false, thorough: w ? w.thorough : false, wait: 0, sub: null, fails: 0, label, repathAt: 0,
  };
}

function releaseSpot(s: Scene, a: FieldAgent): void { if (a.spot >= 0) { if (s.spots[a.spot].taken === a.rid) s.spots[a.spot].taken = -1; a.spot = -1; } }

/** 임무 종료. 실패하면 지휘관이 알 수 있도록 작업 항목에 기록하고 무전으로 알린다. */
export function finishTask(sim: Sim, s: Scene, a: FieldAgent, ok: boolean, reason = ''): void {
  const t = a.task;
  if (!t) return;
  const I = sim.incidents[s.incidentId];
  if (a.carrying >= 0) { const c = s.casualties[a.carrying]; if (c.where === 'carried') { c.where = 'scene'; c.x = Math.round(a.x); c.y = Math.round(a.y); } a.carrying = -1; }
  if (a.carrying <= -2) a.carrying = -1;
  releaseSpot(s, a);
  if (t.workId >= 0) {
    const w = s.board[t.workId];
    const k = w.assignees.indexOf(a.rid); if (k >= 0) w.assignees.splice(k, 1);
    if (ok) { if (w.status === 'active' || w.status === 'open') { w.status = 'done'; w.doneAt = sim.t; } }
    else if (reason === 'preempt') { if ((w.status === 'active' || w.status === 'open') && !w.assignees.length) w.status = 'open'; }
    else if (w.status === 'active' || w.status === 'open') {
      w.fails++; w.holdUntil = sim.t + (reason === 'fire' ? 14 : 8);
      if (!w.assignees.length) w.status = 'open';
      if (reason && reason !== 'preempt') {
        const r = resp(sim, a);
        const txt: Record<string, string> = { nopath: '진입 경로를 찾지 못했습니다', fire: '화염으로 접근할 수 없습니다', equip: '장비 문제로 임무를 계속할 수 없습니다', gone: '대상이 더 이상 그 위치에 없습니다', unsafe: '위협이 해소되지 않아 접근할 수 없습니다' };
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'radio', imp: 1, causes: [a.lastBlockEvent], text: `${workLabel(s, w)} 중단 — ${txt[reason] ?? reason}. 재지시 요청.` });
        w.note = txt[reason] ?? reason;
      }
    }
    if (a.orderWork === t.workId) a.orderWork = -1;
  }
  a.task = null; a.path = null; a.pathGoal = -1; a.ring = 0; a.idleSince = sim.t;
}

function discoverBlock(sim: Sim, s: Scene, I: Incident, a: FieldAgent, tile: number, kind: 'debris' | 'locked'): void {
  const r = resp(sim, a);
  const where = regionNameAt(s, tile % s.w, (tile / s.w) | 0);
  const txt = kind === 'debris' ? `${where} 통로가 잔해로 막혀 있음` : `${where} 문이 잠겨 있음`;
  learnQuiet(sim, a, mkFact('blk', tile, kind, r.name, sim.t, 1, true, txt));
  a.pendingBlock = tile;
  a.lastBlockEvent = raiseProblem(sim, I, 'PATH_BLOCKED', txt, {
    role: 'RESPONDER', actor: r.name, rid: r.id, imp: 2, text: `기존 접근 경로가 차단되어 있습니다 — ${txt}.`,
  }, false);
  pushFx(sim, s, 'text', a.x, a.y - 1, undefined, undefined, '경로 차단!', '#ff6b6b', 1.8);
}

type MoveRes = 'arrived' | 'moving' | 'nopath' | 'busy';

export function moveSpeed(sim: Sim, s: Scene, a: FieldAgent): number {
  const r = resp(sim, a);
  const i = tileOf(s, a.x, a.y);
  let v = 2.5 * (0.75 + 0.5 * r.fitness) * staminaF(r);
  if (s.smoke[i] > 0.3) v *= r.dept === 'fire' ? 0.8 : 0.6;
  if (s.kind === 'search') v *= s.tiles[i] === T.TRAIL ? 0.9 : s.tiles[i] === T.TREE ? 0.42 : 0.6;      // 험한 지형
  else if (s.tiles[i] === T.TREE) v *= 0.62;
  if (a.carrying !== -1) {
    const helper = s.agents.some((b) => b !== a && b.status === 'active' && b.task && b.task.kind === a.task?.kind && b.task.workId === a.task?.workId && dist(a.x, a.y, b.x, b.y) < 2);
    const walk = a.carrying >= 0 && s.casualties[a.carrying].mob === 'mobile';
    v *= walk ? 0.7 : helper ? 0.78 : 0.48;
  }
  return v;
}

function moveTo(sim: Sim, s: Scene, a: FieldAgent, tx: number, ty: number, range: number, needLos = false): MoveRes {
  const t = a.task!;
  const I = sim.incidents[s.incidentId];
  const r = resp(sim, a);
  const goalKey = Math.round(tx) + Math.round(ty) * 64 + Math.round(range * 10) * 4096 + (needLos ? 1 << 20 : 0);
  if (!a.path || a.pathGoal !== goalKey || sim.t >= t.repathAt) {
    a.path = astar(s, a.x, a.y, Math.round(tx), Math.round(ty), range, agentCost(sim, s, a), needLos);
    a.pathI = 0; a.pathGoal = goalKey; t.repathAt = sim.t + 5;
    if (a.pendingBlock >= 0) {
      // 방금 발견한 장애물에 대한 결정: 우회 / 제거 / 포기
      const blk = a.pendingBlock; a.pendingBlock = -1;
      if (!a.path) {
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'problem', imp: 1, causes: [a.lastBlockEvent], text: '우회할 수 있는 경로가 없습니다.' });
      } else if (a.path.indexOf(blk) >= 0) {
        const kind = a.beliefs.val<string>('blk', blk);
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 1, causes: [a.lastBlockEvent], text: kind === 'locked' ? '우회로보다 빠르다고 판단, 문을 강제 개방합니다.' : '우회로가 없거나 너무 멉니다. 잔해를 제거하고 진입합니다.' });
      } else {
        const pe = markRecovered(I, 'PATH_BLOCKED', `${josa(r.name, '이/가')} 대체 경로로 우회`);
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, causes: [pe, a.lastBlockEvent], text: '대체 경로를 찾았습니다. 우회해서 진입합니다.' });
        pushFx(sim, s, 'text', a.x, a.y - 1, undefined, undefined, '우회', '#7cc4ff', 1.5);
      }
    }
    if (!a.path) { a.pathGoal = -1; return 'nopath'; }
  }
  if (a.pathI >= a.path.length) return 'arrived';
  const next = a.path[a.pathI];
  const pid = s.propAt[next];
  if (pid >= 0) {
    const p = s.props[pid];
    const kind = p.kind === 'door' ? 'locked' : p.kind === 'debris' ? 'debris' : null;
    if (!kind) { a.path = null; return 'moving'; }
    const known = a.beliefs.val<string>('blk', next);
    if (!known || known === 'none') { discoverBlock(sim, s, I, a, next, kind); a.path = null; return 'moving'; }
    const sub = makeTask(kind === 'locked' ? 'force' : 'clear', kind === 'locked' ? '문 강제 개방' : '잔해 제거');
    sub.tile = next; t.sub = sub;
    return 'busy';
  }
  if (s.fire[next] > 0.5) {
    const u = sim.units[a.unitId];
    if (r.dept === 'fire' && !u.pumpFailed && (u.water > 0 || u.hydrant)) {
      const sub = makeTask('suppress', '진입로 화재 진압'); sub.tile = next; t.sub = sub;
      return 'busy';
    }
    a.path = null; a.pathGoal = -1;
    t.fails++;
    return t.fails > 3 ? 'nopath' : 'moving';
  }
  const nx = next % s.w, ny = (next / s.w) | 0;
  if (s.stairTo[tileOf(s, a.x, a.y)] === next) {
    // 계단: 잠깐 뒤 다른 층의 이어진 칸에 나타난다 (사람을 옮기는 중이면 더 오래 걸린다)
    a.climb += sim.dt;
    if (a.climb >= (a.carrying !== -1 ? 3.4 : 1.8)) {
      a.climb = 0; a.x = nx; a.y = ny; a.px = nx; a.py = ny; a.pathI++;
      if (a.carrying >= 0) { const c = s.casualties[a.carrying]; c.x = nx; c.y = ny; c.px = nx; c.py = ny; }
    }
    r.stamina = Math.max(0, r.stamina - (a.carrying !== -1 ? 1.1 : 0.3) * (1.35 - r.fitness) * sim.dt);
    return 'moving';
  }
  a.climb = 0;
  const d = dist(a.x, a.y, nx, ny);
  const step = moveSpeed(sim, s, a) * sim.dt;
  if (d > 0.001) { a.fx = (nx - a.x) / d; a.fy = (ny - a.y) / d; }
  if (d <= step) {
    a.x = nx; a.y = ny; a.pathI++;
    const dr = doorAt(s, next); if (dr && !dr.open) { dr.open = true; s.staticVersion++; }
    if (t.kind === 'search' && t.covered) markCovered(sim, s, a, t);
  } else { a.x += a.fx * step; a.y += a.fy * step; }
  r.stamina = Math.max(0, r.stamina - (a.carrying !== -1 ? 0.75 : 0.16) * (1.35 - r.fitness) * sim.dt);
  return a.pathI >= a.path.length ? 'arrived' : 'moving';
}

function markCovered(sim: Sim, s: Scene, a: FieldAgent, t: Task): void {
  const reg = s.regions[t.region];
  const rr = detectRadius(sim, s, a, 0.45);
  for (const i of reg.tiles) {
    if (t.covered!.has(i)) continue;
    const x = i % s.w, y = (i / s.w) | 0;
    if (dist(a.x, a.y, x, y) <= rr && los(s, a.x, a.y, x, y)) t.covered!.add(i);
  }
}

/** 수색 경유점. 시야가 나쁠수록 촘촘해야 하지만, 경험이 부족하면 간격을 넓게 잡아 빈틈이 생긴다. */
function sweepPoints(sim: Sim, s: Scene, a: FieldAgent, t: Task): number[] {
  const reg = s.regions[t.region];
  const r = resp(sim, a);
  const ci = tileOf(s, reg.cx, reg.cy);
  const base = reg.indoor ? s.indoorVision : s.outdoorVision;
  const rr = base * (1 - 0.78 * s.smoke[ci]) * (1 - 0.72 * 0.45) * (0.72 + 0.3 * r.judgment + 0.25 * r.experience);
  let spacing = t.thorough ? Math.max(1.6, rr * 1.1) : Math.max(2.6, rr * 1.85);
  if (r.experience < 0.4 && !t.thorough) spacing *= 1.25;
  const pts: number[] = [];
  const inReg = new Set(reg.tiles);
  const snap = (x: number, y: number): number => {
    let best = -1, bd = 2.3;
    for (let yy = Math.round(y) - 2; yy <= Math.round(y) + 2; yy++) for (let xx = Math.round(x) - 2; xx <= Math.round(x) + 2; xx++) {
      if (xx < 0 || yy < 0 || xx >= s.w || yy >= s.h) continue;
      const i = yy * s.w + xx;
      if (!inReg.has(i) || !staticPass(s.tiles[i]) || s.tiles[i] === T.DOOR) continue;
      if (s.propAt[i] >= 0 && s.props[s.propAt[i]].kind === 'vehicle') continue;
      const d = dist(xx, yy, x, y); if (d < bd) { bd = d; best = i; }
    }
    return best;
  };
  const wSpan = reg.x1 - reg.x0 + 1, hSpan = reg.y1 - reg.y0 + 1;
  const nx = Math.max(1, Math.round(wSpan / spacing)), ny = Math.max(1, Math.round(hSpan / spacing));
  for (let iy = 0; iy < ny; iy++) for (let ix = 0; ix < nx; ix++) {
    const x = reg.x0 - 0.5 + (wSpan * (ix + 0.5)) / nx, y = reg.y0 - 0.5 + (hSpan * (iy + 0.5)) / ny;
    const i = snap(x, y);
    if (i >= 0 && pts.indexOf(i) < 0) pts.push(i);
  }
  if (!pts.length) { const i = snap(reg.cx, reg.cy); pts.push(i >= 0 ? i : reg.tiles[0]); }
  // 가까운 점부터 차례로
  const out: number[] = []; let cx = a.x, cy = a.y;
  while (pts.length) {
    let bi = 0, bd = 1e9;
    for (let k = 0; k < pts.length; k++) { const d = dist(cx, cy, pts[k] % s.w, (pts[k] / s.w) | 0); if (d < bd) { bd = d; bi = k; } }
    const p = pts.splice(bi, 1)[0]; out.push(p); cx = p % s.w; cy = (p / s.w) | 0;
  }
  return out;
}

function drain(sim: Sim, a: FieldAgent, rate: number): void {
  const r = resp(sim, a);
  r.stamina = Math.max(0, r.stamina - rate * (1.35 - r.fitness) * sim.dt);
}

function unblock(sim: Sim, s: Scene, a: FieldAgent, tile: number): void {
  const I = sim.incidents[s.incidentId];
  const r = resp(sim, a);
  const p = s.props[s.propAt[tile]];
  s.propAt[tile] = -1; p.blocking = false;
  if (p.kind === 'door') { p.locked = false; p.open = true; } else p.removed = true;
  s.staticVersion++;
  learnQuiet(sim, a, mkFact('blk', tile, 'none', r.name, sim.t, 1, true, p.kind === 'door' ? '문 개방 완료' : '잔해 제거, 통로 확보'));
  const pe = markRecovered(I, 'PATH_BLOCKED', `${josa(r.name, '이/가')} ${p.kind === 'door' ? '문을 강제 개방' : '잔해를 제거'}해 통로 확보`);
  emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, causes: [pe], text: p.kind === 'door' ? '문 강제 개방 완료. 진입합니다.' : '잔해 제거 완료. 통로를 확보했습니다.' });
  r.xpGained += 0.003;
}

function workOnBlocker(sim: Sim, s: Scene, a: FieldAgent, tile: number, kind: TaskKind): boolean {
  const pid = s.propAt[tile];
  if (pid < 0) return true;
  const p = s.props[pid];
  const r = resp(sim, a), u = sim.units[a.unitId];
  const rate = kind === 'force' ? 0.6 + r.skills.rescue * 0.6 + u.tool * 0.6 + r.skills.law * 0.3 : 0.5 + r.skills.rescue * 0.8 + u.tool * 0.5;
  p.hp -= rate * staminaF(r) * sim.dt;
  drain(sim, a, 0.7);
  a.ring = clamp(1 - p.hp / 12, 0.05, 1);
  if (p.hp <= 0) { unblock(sim, s, a, tile); return true; }
  return false;
}

/** 진압 분사. 물 소모와 펌프 마모가 누적된다. 반환: false = 장비 문제로 중단 */
function spray(sim: Sim, s: Scene, a: FieldAgent, tx: number, ty: number): boolean {
  const I = sim.incidents[s.incidentId];
  const r = resp(sim, a), u = sim.units[a.unitId];
  if (u.pumpFailed) { a.equipIssue = 'pump'; return false; }
  if (u.water <= 0 && !u.hydrant) { a.equipIssue = 'water'; return false; }
  applyWater(s, tx, ty, 0.15 * (0.6 + 0.8 * r.skills.fire) * staminaF(r) * sim.dt);
  if (!u.hydrant) u.water = Math.max(0, u.water - 1.5 * sim.dt);
  u.pumpCond -= 0.0042 * sim.tune.pumpWearMul * sim.dt;
  drain(sim, a, 0.55);
  if (sim.tick % 2 === 0) pushFx(sim, s, 'spray', a.x, a.y, tx + s.rng.range(-0.4, 0.4), ty + s.rng.range(-0.4, 0.4), undefined, undefined, 0.3);
  if (u.pumpCond < 0.2 && !u.pumpFailed) {
    u.pumpFailed = true; a.equipIssue = 'pump';
    a.lastBlockEvent = raiseProblem(sim, I, 'EQUIP_FAIL', `${u.callsign} 펌프 고장 (출동 전 상태 불량)`, { role: 'RESPONDER', actor: r.name, rid: r.id, imp: 2, text: `${u.callsign} 펌프 압력 저하! 방수가 중단됐습니다.` }, false);
    pushFx(sim, s, 'text', a.x, a.y - 1, undefined, undefined, '펌프 고장', '#ff6b6b', 2);
    return false;
  }
  if (u.water <= 0 && !u.hydrant) {
    a.equipIssue = 'water';
    a.lastBlockEvent = raiseProblem(sim, I, 'WATER_OUT', `${u.callsign} 탱크 용수 소진`, { role: 'RESPONDER', actor: r.name, rid: r.id, imp: 2, text: `${u.callsign} 탱크 용수가 바닥났습니다. 급수 연결이 필요합니다.` }, false);
    return false;
  }
  return true;
}

function nearestFireTile(sim: Sim, s: Scene, a: FieldAgent, regionId: number): number {
  const v = visionOf(sim, s, a) + 2;
  let best = -1, bd = 1e9;
  for (const i of s.regions[regionId].tiles) {
    if (s.fire[i] <= 0.05) continue;
    const x = i % s.w, y = (i / s.w) | 0;
    const d = dist(a.x, a.y, x, y);
    if (d > v) continue;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}

function agentById(s: Scene, rid: number): FieldAgent | undefined { return s.agents.find((b) => b.rid === rid); }

function shootAt(sim: Sim, s: Scene, a: FieldAgent, hid: number): void {
  const I = sim.incidents[s.incidentId];
  const r = resp(sim, a), h = s.hostiles[hid];
  a.cooldown = s.rng.range(1.4, 2.2);
  const d = dist(a.x, a.y, h.x, h.y);
  const p = 0.36 * (0.55 + 0.7 * r.skills.law) * (0.7 + 0.5 * r.composure) * clamp(1.3 - d / 14, 0.4, 1.1) * staminaF(r);
  const hit = s.rng.chance(p);
  pushFx(sim, s, 'shot', a.x, a.y, h.x + (hit ? 0 : s.rng.range(-0.8, 0.8)), h.y + (hit ? 0 : s.rng.range(-0.8, 0.8)), undefined, '#ffe08a', 0.25);
  h.morale -= 0.015;
  if (sim.t >= h.stunUntil) { h.alertUntil = sim.t + 6; h.facing = Math.atan2(a.y - h.y, a.x - h.x); }
  const hc = hostageNear(s, h);
  if (!hit && hc && s.rng.chance(0.2)) {
    // 인질 곁의 용의자를 향해 쏜 빗나간 탄
    hc.health -= s.rng.range(22, 34); hc.mob = 'immobile'; hc.bleed = Math.max(hc.bleed, 0.15); hc.bleed0 = hc.bleed; hc.walking = false;
    hc.causeEvent = raiseProblem(sim, I, 'ESCALATION', '교전 중 인질 피격', { role: 'SYSTEM', actor: '현장', rid: r.id, imp: 3, text: `교전 중 빗나간 탄에 인질(구조 대상 ${hc.label})이 다쳤습니다!` }, false);
  }
  if (!I.problems.some((q) => q.detail === '교전 발생')) {
    I.problems.push({ code: 'ESCALATION', t: sim.t, eventId: emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 3, text: '교전 발생! 대응 사격합니다.' }), detail: '교전 발생', recovered: true, recoveryText: '' });
  }
  if (hit) {
    h.health -= s.rng.range(30, 48); h.morale -= 0.12;
    pushFx(sim, s, 'hit', h.x, h.y);
    if (h.health <= 0) r.xpGained += 0.004;
  }
}

/** 동시 진입: 대기하던 출입문을 열고(잠겼으면 부수고), 섬광탄이 있으면 먼저 던져 넣는다. */
function breach(sim: Sim, s: Scene, a: FieldAgent): void {
  const I = sim.incidents[s.incidentId];
  s.breachDone = true;
  let bangs = 0;
  s.exits.forEach((e) => {
    const team = s.agents.filter((b) => b.status === 'active' && b.task && b.task.kind === 'engage' && dist(b.x, b.y, e.x, e.y) <= 2.6);
    if (!team.length) return;
    // 출입구 바로 안쪽의 문
    let inX = e.x, inY = e.y + (e.y > s.h / 2 ? -3 : 3);
    for (const p of s.props) {
      if (p.kind !== 'door' || Math.abs(p.x - e.x) + Math.abs(p.y - e.y) > 1.5) continue;
      if (p.blocking) { s.propAt[p.y * s.w + p.x] = -1; p.blocking = false; p.locked = false; }
      if (!p.open) { p.open = true; s.staticVersion++; }
      inX = e.x + (p.x - e.x) * 3; inY = e.y + (p.y - e.y) * 3;      // 문을 지나 세 칸 안쪽
    }
    // 문 바로 안쪽에 용의자가 있다고 알고 있을 때만 섬광탄을 쓴다(없으면 방 진입 때를 위해 아낀다)
    const thrower = team.find((b) => sim.units[b.unitId].flashbangs > 0 && b.beliefs.list('hos').some((f) => (f.value.state === 'hold' || f.value.state === 'fight') && dist(f.value.x, f.value.y, inX, inY) <= 5));
    if (thrower && sim.t - s.bangAt > 2) {
      sim.units[thrower.unitId].flashbangs--; s.bangAt = sim.t;
      bangs += flashbang(sim, s, inX, inY);
    }
    for (const b of team) { b.path = null; b.pathGoal = -1; }
  });
  emit(sim, { inc: I.id, role: 'RESPONDER', actor: resp(sim, a).name, rid: a.rid, kind: 'action', imp: 3, text: s.bangAt === sim.t ? `진입! 섬광탄을 던져 넣고 들어갑니다${bangs ? ` (용의자 ${bangs}명 무력화)` : ''}.` : '진입! 출입문을 열고 들어갑니다.' });
}

function runTask(sim: Sim, s: Scene, a: FieldAgent, t: Task): void {
  const I = sim.incidents[s.incidentId];
  const r = resp(sim, a), u = sim.units[a.unitId];
  const dt = sim.dt;
  const w = t.workId >= 0 ? s.board[t.workId] : null;
  if (w && (w.status === 'done' || w.status === 'cancelled')) { finishTask(sim, s, a, true); return; }
  a.label = t.label; a.ring = 0;
  // 하위 작업(진입로 확보)
  if (t.sub) {
    a.label = t.sub.label;
    if (t.sub.kind === 'suppress') {
      const tx = t.sub.tile % s.w, ty = (t.sub.tile / s.w) | 0;
      if (s.fire[t.sub.tile] < 0.2) { t.sub = null; a.path = null; return; }
      if (!spray(sim, s, a, tx, ty)) { t.sub = null; finishTask(sim, s, a, false, 'equip'); }
    } else if (workOnBlocker(sim, s, a, t.sub.tile, t.sub.kind)) { t.sub = null; a.path = null; }
    return;
  }
  if (t.wait > 0) { t.wait -= dt; return; }
  switch (t.kind) {
    case 'sizeup': {
      if (!a.isCommander) { finishTask(sim, s, a, false, 'preempt'); return; }
      // 무장 사건으로 알고 온 비경찰 대원은 접근하지 않고 대기 지점에서 관찰한다
      const far = r.dept !== 'police' && (a.beliefs.val<string>('type', 0) === 'armed' || a.beliefs.list('hos').length > 0);
      const m = far ? moveTo(sim, s, a, s.staging.x, s.staging.y, 1.5) : moveTo(sim, s, a, s.vantage.x, s.vantage.y, 1.5);
      if (m === 'moving' || m === 'busy') return;
      t.need = 3.5 + 3 * (1 - r.experience);
      t.progress += dt; a.ring = t.progress / t.need;
      if (t.progress >= t.need) { perceive(sim, s, a, 2.4, true); s.sizeupDone = true; finishTask(sim, s, a, true); }
      return;
    }
    case 'search': {
      const reg = s.regions[t.region];
      if (!t.pts) { t.pts = sweepPoints(sim, s, a, t); t.ptI = 0; t.covered = new Set(); t.fails = 0; }
      if (reg.indoor && r.dept !== 'fire') { let m = 0; for (const i of reg.tiles) if (s.fire[i] > m && dist(a.x, a.y, i % s.w, (i / s.w) | 0) < 4) m = s.fire[i]; if (m > 0.35) { finishTask(sim, s, a, false, 'fire'); return; } }
      if (t.ptI >= t.pts.length) {
        const total = Math.max(1, walkableCount(s, reg.tiles));
        const conf = clamp(t.covered!.size / total, 0, 1);
        if (t.covered!.size === 0 && t.fails > 0) { finishTask(sim, s, a, false, 'nopath'); return; }
        if (conf < 0.72) a.quiet.add('srch:' + reg.id);
        learn(sim, a, mkFact('srch', reg.id, Math.round(conf * 100) / 100, r.name, sim.t, conf, true, `${reg.name} ${t.thorough ? '정밀 ' : ''}수색 완료 (확인율 ${pct(conf)})`), true, true);
        if (conf < 0.72) emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `${reg.name} 수색을 마쳤지만 ${s.smoke[tileOf(s, reg.cx, reg.cy)] > 0.3 ? '짙은 연기로' : '시야가 나빠'} 확인율이 ${pct(conf)}에 그쳤습니다.` });
        r.xpGained += 0.002;
        finishTask(sim, s, a, true);
        return;
      }
      const p = t.pts[t.ptI];
      a.ring = t.ptI / t.pts.length;
      const m = moveTo(sim, s, a, p % s.w, (p / s.w) | 0, 0.4);
      if (m === 'arrived') { markCovered(sim, s, a, t); perceive(sim, s, a); t.ptI++; t.wait = 0.5; drain(sim, a, 0.3); }
      else if (m === 'nopath') { t.ptI++; t.fails++; a.pathGoal = -1; }
      return;
    }
    case 'suppress': {
      if (u.pumpFailed || (u.water <= 0 && !u.hydrant)) { a.equipIssue = u.pumpFailed ? 'pump' : 'water'; finishTask(sim, s, a, false, 'equip'); return; }
      if (t.tile < 0 || s.fire[t.tile] <= 0.05 || sim.t > t.progress) { t.tile = nearestFireTile(sim, s, a, t.region); t.progress = sim.t + 1.6; }
      const reg = s.regions[t.region];
      if (t.tile < 0) {
        const m = moveTo(sim, s, a, Math.round(reg.cx), Math.round(reg.cy), 2.2);
        if (m === 'arrived' || m === 'nopath') {
          perceive(sim, s, a);
          let any = false; for (const i of reg.tiles) if (s.fire[i] > 0.05) { any = true; break; }
          if (!any) { learn(sim, a, mkFact('fire', reg.id, 0, r.name, sim.t, 1, true, `${reg.name} 화재 진압 확인`), true, true); r.xpGained += 0.003; finishTask(sim, s, a, true); }
          else if (m === 'arrived') {
            // 구역 안에 불은 남아 있는데 연기로 보이지 않는다 → 가장 가까운 화점으로 더듬어 접근
            let bd = 1e9;
            for (const i of reg.tiles) if (s.fire[i] > 0.05) { const d = dist(a.x, a.y, i % s.w, (i / s.w) | 0); if (d < bd) { bd = d; t.tile = i; } }
            t.progress = sim.t + 3;
          } else finishTask(sim, s, a, false, 'nopath');
        }
        return;
      }
      const tx = t.tile % s.w, ty = (t.tile / s.w) | 0;
      const m = moveTo(sim, s, a, tx, ty, 3.2, true);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      a.fx = tx - a.x; a.fy = ty - a.y;
      a.ring = 1 - s.fire[t.tile];
      if (!spray(sim, s, a, tx, ty)) finishTask(sim, s, a, false, 'equip');
      return;
    }
    case 'hookup': {
      const hy = s.props.find((p) => p.kind === 'hydrant');
      if (!hy || u.hydrant) { finishTask(sim, s, a, true); return; }
      const m = moveTo(sim, s, a, hy.x, hy.y, 1.5);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      t.need = 9; t.progress += dt * staminaF(r); a.ring = t.progress / t.need; drain(sim, a, 0.5);
      if (t.progress >= t.need) {
        u.hydrant = true;
        const pe = markRecovered(I, 'WATER_OUT', `${josa(r.name, '이/가')} 소화전에 급수 연결`);
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 1, causes: [pe], text: `소화전 연결 완료. ${u.callsign} 연속 방수 가능.` });
        for (const b of s.agents) if (b.unitId === a.unitId && b.equipIssue === 'water') b.equipIssue = 'none';
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'clear': case 'force': {
      if (s.propAt[t.tile] < 0) { finishTask(sim, s, a, true); return; }
      const m = moveTo(sim, s, a, t.tile % s.w, (t.tile / s.w) | 0, 1.5);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m === 'arrived' && workOnBlocker(sim, s, a, t.tile, t.kind)) finishTask(sim, s, a, true);
      return;
    }
    case 'extricate': {
      const c = s.casualties[t.cas];
      if (c.dead) { learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, true); return; }
      if (c.mob !== 'trapped') { learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, true); return; }
      const m = moveTo(sim, s, a, c.x, c.y, 1.5);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      const rate = r.skills.rescue * (0.35 + 0.65 * u.tool) * staminaF(r) * (s.smoke[tileOf(s, a.x, a.y)] > 0.4 ? 0.7 : 1);
      c.trapWork -= rate * dt; drain(sim, a, 0.8);
      a.ring = clamp(1 - c.trapWork / 16, 0.05, 1);
      if (c.trapWork <= 0) {
        c.mob = 'immobile'; c.tFreed = sim.t;
        if (c.inVehicle !== null) { c.inVehicle = null; c.x = Math.round(a.x); c.y = Math.round(a.y); }
        learnQuiet(sim, a, casFact(sim, s, c, r.name));
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 2, text: `구조 대상 ${c.label} 구출 완료. 이송이 필요합니다.` });
        r.xpGained += 0.004;
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'treat': {
      const c = s.casualties[t.cas];
      const q = clamp(r.skills.medical * (0.5 + 0.5 * u.medLevel) * 1.15, 0.2, 1);
      // 이미 처치를 받은 환자는 더 나은 처치를 할 수 있는 대원만 다시 본다
      if (c.dead || c.where === 'loaded' || c.where === 'hospital' || (c.treated && q <= c.treatQ + 0.15)) { learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, true); return; }
      if (c.where === 'carried') return;
      if (c.treated && t.phase === 0) { t.phase = 1; c.treatProg = 0; }
      const m = moveTo(sim, s, a, c.x, c.y, 1.3);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      const rate = Math.max(0.1, r.skills.medical * (0.5 + 0.5 * u.medLevel)) * staminaF(r);
      t.need = 4.5 + (c.health < 40 ? 4 : c.health < 70 ? 2 : 0);
      c.treatProg += rate * dt; a.ring = c.treatProg / t.need; drain(sim, a, 0.3);
      if (c.treatProg >= t.need) {
        if (!c.treated) c.health = Math.min(100, c.health + 8 * q);
        c.treated = true; if (c.tTreated < 0) c.tTreated = sim.t; c.treatQ = q; c.bleed = c.bleed0 * (1 - 0.9 * q); c.bystander = false;
        learnQuiet(sim, a, casFact(sim, s, c, r.name));
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: q < 0.6 ? `구조 대상 ${c.label} 기본 응급 처치 완료. 전문 처치가 필요합니다.` : `구조 대상 ${c.label} 전문 응급 처치 완료.` });
        r.xpGained += 0.003;
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'carry': case 'escort': {
      const c = s.casualties[t.cas];
      if (c.dead || c.where === 'safe' || c.where === 'loaded' || c.where === 'hospital') { learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, true); return; }
      if (c.mob === 'trapped') { finishTask(sim, s, a, false, 'gone'); return; }
      if (a.carrying !== c.id && isHeld(sim, s, c.id)) { finishTask(sim, s, a, false, 'unsafe'); return; }      // 용의자 곁의 인질은 데리고 나올 수 없다
      if (c.walking) { learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, true); return; }
      if (c.where === 'carried' && a.carrying !== c.id) {
        // 다른 대원이 이송 중 → 곁에서 보조
        const carrier = s.agents.find((b) => b.carrying === c.id);
        if (!carrier) { c.where = 'scene'; return; }
        a.label = '이송 보조';
        moveTo(sim, s, a, carrier.x, carrier.y, 1.2);
        return;
      }
      if (a.carrying !== c.id) {
        const m = moveTo(sim, s, a, c.x, c.y, 1.3);
        if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (m !== 'arrived') return;
        t.progress += dt;
        if (t.progress >= 1.2) { c.where = 'carried'; c.inVehicle = null; a.carrying = c.id; a.path = null; a.pathGoal = -1; learn(sim, a, casFact(sim, s, c, r.name), false); }
        return;
      }
      const m = moveTo(sim, s, a, s.safe.x, s.safe.y, 1.2);
      c.x = a.x - a.fx * 0.45; c.y = a.y - a.fy * 0.45;
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m === 'arrived') {
        c.where = 'safe'; c.tSafe = sim.t; placeAtSafe(s, c); a.carrying = -1;
        learnQuiet(sim, a, casFact(sim, s, c, r.name));
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 2, text: `구조 대상 ${c.label} 안전 구역으로 이송 완료.` });
        r.xpGained += 0.004;
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'load': {
      const c = s.casualties[t.cas];
      if (c.dead || c.where === 'loaded' || c.where === 'hospital') { finishTask(sim, s, a, true); return; }
      if (c.where !== 'safe' && a.carrying !== c.id) { finishTask(sim, s, a, false, 'gone'); return; }
      if (a.carrying !== c.id) {
        const m = moveTo(sim, s, a, c.x, c.y, 1.3);
        if (m !== 'arrived') return;
        t.progress += dt;
        if (t.progress >= 1.2) { c.where = 'carried'; a.carrying = c.id; a.path = null; a.pathGoal = -1; t.progress = 0; }
        return;
      }
      const m = moveTo(sim, s, a, s.staging.x, s.staging.y, 1.2);
      c.x = a.x - a.fx * 0.45; c.y = a.y - a.fy * 0.45;
      if (m !== 'arrived') return;
      t.progress += dt;
      if (t.progress >= 1.2) {
        c.where = 'loaded'; c.tLoaded = sim.t; a.carrying = -1; u.patients.push(c.id); u.patientsIncident = I.id;
        learnQuiet(sim, a, casFact(sim, s, c, r.name));
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `구조 대상 ${c.label} ${u.callsign}에 탑승 완료.` });
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'traffic': {
      const k = t.tile, cp = s.controlPts[k];
      if (s.controlDone[k]) { learnQuiet(sim, a, mkFact('ctl', k, true, r.name, sim.t, 1, true, '차로 통제 완료')); finishTask(sim, s, a, true); return; }
      const m = moveTo(sim, s, a, cp.x, cp.y, 0.8);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      t.need = r.dept === 'police' ? 6 : 10; t.progress += dt; a.ring = t.progress / t.need;
      if (t.progress >= t.need) {
        s.controlDone[k] = true;
        learnQuiet(sim, a, mkFact('ctl', k, true, r.name, sim.t, 1, true, `${k === 0 ? '서측' : '동측'} 진입 차량 통제 완료`));
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `${k === 0 ? '서측' : '동측'} 차로 통제 완료. 진입 차량을 차단했습니다.` });
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'mitigate': {
      const p = s.props[t.prop];
      const doneText = p.kind === 'unstable' ? '균열부 보강 완료' : p.kind === 'valve' ? (p.ignited ? '누출 가스 발화' : '가스 밸브 차단 완료') : p.ignited ? '누출 연료 발화' : '연료 누출 조치 완료';
      if (p.mitigated || p.ignited) { learn(sim, a, mkFact('haz', p.id, { kind: 'leak', active: false, x: p.x, y: p.y }, r.name, sim.t, 1, true, doneText), true, true); finishTask(sim, s, a, true); return; }
      const m = moveTo(sim, s, a, p.x, p.y, 1.6);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      t.need = p.kind === 'unstable' ? 13 / (0.5 + r.skills.rescue) : (p.kind === 'valve' ? 9 : 7) / (0.5 + r.skills.fire);
      t.progress += dt; a.ring = t.progress / t.need;
      if (t.progress >= t.need) {
        p.mitigated = true;
        learnQuiet(sim, a, mkFact('haz', p.id, { kind: 'leak', active: false, x: p.x, y: p.y }, r.name, sim.t, 1, true, doneText));
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, text: p.kind === 'unstable' ? '균열부에 지지대를 세웠습니다. 추가 붕괴 위험을 줄였습니다.' : p.kind === 'valve' ? '가스 밸브 차단 완료. 누출이 멈췄습니다.' : '연료 누출 차단 완료. 발화 위험을 제거했습니다.' });
        if (p.kind === 'unstable') s.staticVersion++;
        r.xpGained += 0.003;
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'perimeter': case 'negotiate': {
      const exitK = t.kind === 'perimeter' ? t.tile : -1;
      if (a.spot < 0) {
        let best = -1, bd = 1e9;
        s.spots.forEach((sp, k) => { if (sp.exit !== exitK || (sp.taken >= 0 && sp.taken !== a.rid)) return; const d = dist(a.x, a.y, sp.x, sp.y); if (d < bd) { bd = d; best = k; } });
        if (best < 0) s.spots.forEach((sp, k) => { if (sp.taken >= 0 && sp.taken !== a.rid) return; if (exitK >= 0 && sp.exit !== exitK) return; const d = dist(a.x, a.y, sp.x, sp.y); if (d < bd) { bd = d; best = k; } });
        if (best < 0) { finishTask(sim, s, a, false, 'nopath'); return; }
        a.spot = best; s.spots[best].taken = a.rid;
      }
      const sp = s.spots[a.spot];
      const m = moveTo(sim, s, a, sp.x, sp.y, 0.3);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      // 위치 사수: 교전 중인 용의자가 보이면 엄폐 상태에서 응사
      a.cooldown -= dt;
      const vis = s.hostiles.find((h) => (h.state === 'fight') && dist(a.x, a.y, h.x, h.y) <= 13 && los(s, a.x, a.y, h.x, h.y));
      if (vis && a.cooldown <= 0 && vis.weapon === 'gun') { a.fx = vis.x - a.x; a.fy = vis.y - a.y; shootAt(sim, s, a, vis.id); }
      if (t.kind === 'negotiate') {
        const h = s.hostiles[t.hostile];
        if (!hostileActive(h) || h.state === 'surrendered' || h.state === 'flee') { learn(sim, a, hosFact(sim, s, h, r.name), true, true); finishTask(sim, s, a, true); return; }
        if (h.state === 'fight') { a.label = '엄폐 (협상 중단)'; return; }
        const k = 0.0125 * (0.4 + 0.6 * (r.composure + r.experience) / 2) * (1.25 - h.aggression);
        h.negot += dt; h.morale -= k * dt;
        t.progress += dt; a.ring = clamp(1 - (h.morale - 0.2) / 0.6, 0, 1);
        if (t.phase === 0) { t.phase = 1; emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `${h.label}와 협상을 시도합니다.` }); }
        else if (t.phase === 1 && h.morale < 0.42) { t.phase = 2; emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `${h.label}가 동요하고 있습니다. 협상을 계속합니다.` }); }
        else if (t.phase === 1 && t.progress > 30 && h.aggression > 0.6) { t.phase = 3; emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'radio', imp: 1, text: `${h.label}가 협상에 응하지 않습니다.` }); }
      } else a.label = `${t.tile === 0 ? '정문' : '후문'} 봉쇄`;
      return;
    }
    case 'engage': {
      const h = s.hostiles[t.hostile];
      if (!hostileActive(h) || h.state === 'surrendered') { learn(sim, a, hosFact(sim, s, h, r.name), true, true); finishTask(sim, s, a, true); return; }
      a.cooldown -= dt;
      if (h.state === 'flee' || h.weapon !== 'gun') {
        a.label = h.state === 'flee' ? '도주 용의자 추격' : '용의자 접근';
        if (sim.t >= t.repathAt - 4.4) a.pathGoal = -1;
        const m = moveTo(sim, s, a, h.x, h.y, 1.3);
        if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (dist(a.x, a.y, h.x, h.y) <= 1.6) {
          t.progress += dt; a.ring = t.progress / 1.6;
          if (t.progress >= 1.6) {
            h.state = 'arrested'; h.path = null;
            learnQuiet(sim, a, hosFact(sim, s, h, r.name));
            emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'resolve', imp: 3, text: `${h.label} 검거!` });
            r.xpGained += 0.006;
            finishTask(sim, s, a, true);
          }
        }
        return;
      }
      // ① 진입조는 가까운 출입구 앞에 모였다가 정해진 시각에 함께 들어간다
      if (s.breachAt >= 0 && !s.breachDone && s.exits.length) {
        if (t.tile < 0) { if (s.entryExit >= 0 && s.entryExit < s.exits.length) t.tile = s.entryExit; else { let bd = 1e9; s.exits.forEach((e, k) => { const d0 = dist(a.x, a.y, e.x, e.y); if (d0 < bd) { bd = d0; t.tile = k; } }); } }      // 지휘관이 정한 진입 지점
        const e = s.exits[t.tile];
        const m0 = moveTo(sim, s, a, e.x, e.y, 1.4);
        a.label = '진입 대기';
        const ready = m0 === 'arrived' || m0 === 'nopath';
        if ((ready && sim.t >= s.breachAt) || sim.t >= s.breachAt + 8) breach(sim, s, a);
        return;
      }
      const stunned = sim.t < h.stunUntil;
      const d = dist(a.x, a.y, h.x, h.y);
      // ② 섬광탄: 용의자 가까이 다가갔을 때 던져 넣는다
      if (!stunned && u.flashbangs > 0 && d <= 5 && sim.t - s.bangAt > 7) {
        u.flashbangs--; s.bangAt = sim.t;
        const n = flashbang(sim, s, a.x + (h.x - a.x) * 0.7, a.y + (h.y - a.y) * 0.7);
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 3, text: `섬광탄 투척! ${n ? `용의자 ${n}명 무력화.` : '효과 없음.'}` });
      }
      // ③ 무력화된 용의자는 달려들어 제압한다
      if (sim.t < h.stunUntil) {
        a.label = '제압';
        a.pathGoal = sim.t >= t.repathAt - 4.4 ? -1 : a.pathGoal;
        const m1 = moveTo(sim, s, a, h.x, h.y, 1.3);
        if (m1 === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (dist(a.x, a.y, h.x, h.y) <= 1.7) {
          t.progress += dt; a.ring = t.progress / 1.2;
          if (t.progress >= 1.2) {
            h.state = 'arrested'; h.path = null;
            learnQuiet(sim, a, hosFact(sim, s, h, r.name));
            emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'resolve', imp: 3, text: `무력화된 ${h.label} 제압·검거!` });
            r.xpGained += 0.006;
            finishTask(sim, s, a, true);
          }
        }
        return;
      }
      t.progress = 0;
      const m = moveTo(sim, s, a, h.x, h.y, 7.5, true);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') { a.label = '진입'; return; }
      a.fx = h.x - a.x; a.fy = h.y - a.y;
      // ④ 인질이 곁에 있고 용의자가 쏘지 않는 동안에는 사격하지 않는다
      const bangComing = s.agents.some((b) => b !== a && b.status === 'active' && b.task && b.task.kind === 'engage' && b.task.hostile === h.id && sim.units[b.unitId].flashbangs > 0);
      if (hostageNear(s, h) && (h.state !== 'fight' || bangComing || u.flashbangs > 0)) { a.label = u.flashbangs > 0 ? '섬광탄 투척 위치로 접근' : '사격 보류 — 인질 근접'; if (u.flashbangs > 0 && d > 4.6) { a.pathGoal = sim.t >= t.repathAt - 4.4 ? -1 : a.pathGoal; moveTo(sim, s, a, h.x, h.y, 4.2); } return; }
      a.label = '교전';
      if (a.cooldown <= 0 && los(s, a.x, a.y, h.x, h.y)) shootAt(sim, s, a, h.id);
      else if (!los(s, a.x, a.y, h.x, h.y)) a.pathGoal = -1;
      return;
    }
    case 'arrest': {
      const h = s.hostiles[t.hostile];
      if (h.state === 'arrested' || h.state === 'escaped' || h.state === 'down') { learn(sim, a, hosFact(sim, s, h, r.name), true, true); finishTask(sim, s, a, true); return; }
      if (h.state !== 'surrendered' && h.weapon === 'gun') { finishTask(sim, s, a, false, 'unsafe'); return; }
      const m = moveTo(sim, s, a, h.x, h.y, 1.3);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      t.need = h.state === 'surrendered' ? 2.5 : 5; t.progress += dt; a.ring = t.progress / t.need;
      if (t.progress >= t.need) {
        h.state = 'arrested';
        learnQuiet(sim, a, hosFact(sim, s, h, r.name));
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'resolve', imp: 3, text: `${h.label} 검거 완료.` });
        r.xpGained += 0.005;
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'interview': {
      const p = s.props[t.prop];
      if (p.interviewed) { learnQuiet(sim, a, mkFact('evid', p.id, { kind: 'witness', done: true }, r.name, sim.t, 1, true, '목격자 면담 완료')); finishTask(sim, s, a, true); return; }
      const m = moveTo(sim, s, a, p.x, p.y, 1.5);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      t.need = 6; t.progress += dt; a.ring = t.progress / t.need;
      if (t.progress >= t.need) {
        p.interviewed = true;
        const reg = s.regions[p.lastSeenRegion!];
        learnQuiet(sim, a, mkFact('seen', 0, { region: reg.id }, '목격자', sim.t, 0.65, false, `목격자 진술: 대상이 ${reg.name} 쪽으로 향함`));
        learnQuiet(sim, a, mkFact('evid', p.id, { kind: 'witness', done: true }, r.name, sim.t, 1, true, '목격자 면담 완료'));
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `목격자 면담 완료. "${reg.name} 쪽으로 가는 걸 봤다"는 진술을 확보했습니다.` });
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'clearRoad': {
      const p = s.props[t.prop];
      if (p.cleared || p.removed) { finishTask(sim, s, a, true); return; }
      const m = moveTo(sim, s, a, p.x, p.y, 1.6);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      t.need = p.kind === 'vehicle' ? 8 : 3; t.progress += dt * staminaF(r); a.ring = t.progress / t.need; drain(sim, a, 0.5);
      if (t.progress >= t.need) {
        if (p.kind === 'vehicle') {
          for (let x = p.x; x < p.x + p.w; x++) s.propAt[p.y * s.w + x] = -1;
          p.cleared = true; p.blocking = false; p.y = p.y <= 9 ? 7 : 12; p.angle = 0;
        } else p.removed = true;
        s.staticVersion++;
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'rescueMate': {
      const b = agentById(s, t.mate);
      if (!b || b.status !== 'down') { finishTask(sim, s, a, true); return; }
      if (a.carrying !== -(b.rid + 2)) {
        const m = moveTo(sim, s, a, b.x, b.y, 1.3);
        if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (m !== 'arrived') return;
        t.progress += dt;
        if (t.progress >= 1.5) { a.carrying = -(b.rid + 2); a.path = null; a.pathGoal = -1; }
        return;
      }
      const m = moveTo(sim, s, a, s.safe.x, s.safe.y, 1.5);
      b.x = a.x - a.fx * 0.5; b.y = a.y - a.fy * 0.5;
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m === 'arrived') {
        b.status = 'withdrawn'; a.carrying = -1;
        b.x = s.safe.x + 1.2; b.y = s.safe.y + 1 + (b.rid % 3) * 0.6;
        learnQuiet(sim, a, mkFact('mate', b.rid, { x: Math.round(b.x), y: Math.round(b.y), status: 'safe' }, r.name, sim.t, 1, true, `${sim.responders[b.rid].name} 대원 안전 구역으로 구조`));
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, text: `쓰러진 ${sim.responders[b.rid].name} 대원을 안전 구역으로 옮겼습니다.` });
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'retreat': {
      const m = moveTo(sim, s, a, s.staging.x, s.staging.y, 2);
      if (m === 'arrived' || m === 'nopath') {
        if (r.health < 40) { a.status = 'withdrawn'; a.label = '부상 — 후송 대기'; }
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'rehab': {
      const m = moveTo(sim, s, a, s.staging.x, s.staging.y, 2.2);
      if (m === 'moving' || m === 'busy') return;
      r.stamina = Math.min(100, r.stamina + 5 * dt); a.ring = r.stamina / 55;
      if (r.stamina >= 55) { emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 0, text: '휴식 완료. 임무에 복귀합니다.' }); finishTask(sim, s, a, true); }
      return;
    }
    case 'resupply': {
      const m = moveTo(sim, s, a, s.staging.x, s.staging.y, 1.6);
      if (m === 'moving' || m === 'busy') return;
      t.need = 11 * (1.5 - r.skill); t.progress += dt; a.ring = t.progress / t.need;
      if (t.progress >= t.need) {
        u.pumpFailed = false; u.pumpCond = 0.62;
        for (const b of s.agents) if (b.unitId === a.unitId && b.equipIssue === 'pump') b.equipIssue = 'none';
        const pe = markRecovered(I, 'EQUIP_FAIL', `${josa(r.name, '이/가')} 예비 장비로 교체`);
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, causes: [pe], text: `예비 펌프로 교체 완료. ${u.callsign} 방수 재개 가능.` });
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'moveSignal': {
      if (!s.shadow[tileOf(s, a.x, a.y)]) { finishTask(sim, s, a, true); return; }
      const m = moveTo(sim, s, a, s.staging.x, s.staging.y, 2);
      if (m === 'arrived' || m === 'nopath') finishTask(sim, s, a, true);
      return;
    }
    case 'board': {
      const m = moveTo(sim, s, a, s.staging.x, s.staging.y, 1.3);
      if (m === 'arrived' || m === 'nopath') { a.status = 'left'; a.task = null; a.label = ''; }
      return;
    }
    case 'standby': {
      a.label = '대기';
      if (dist(a.x, a.y, s.staging.x, s.staging.y) > 5 && s.kind !== 'armed') moveTo(sim, s, a, s.staging.x, s.staging.y, 3);
      return;
    }
  }
}

function isCoverTile(s: Scene, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return false;
  const i = y * s.w + x;
  const t = s.tiles[i];
  if (t === T.WALL || t === T.WINDOW || t === T.ROCK || t === T.FURN) return true;
  return s.propAt[i] >= 0;
}

/** 매 틱 호출: 현재 임무를 한 걸음 실행한다. */
export function act(sim: Sim, s: Scene, a: FieldAgent): void {
  a.px = a.x; a.py = a.y;
  if (a.status === 'left' || a.status === 'down') return;
  if (a.status === 'withdrawn' && (!a.task || a.task.kind !== 'board')) { a.label = '부상 — 후송 대기'; return; }
  if (!a.task) { a.label = '지시 대기'; a.ring = 0; a.inCover = false; return; }
  const bx = a.x, by = a.y;
  runTask(sim, s, a, a.task);
  const moved = Math.abs(a.x - bx) + Math.abs(a.y - by) > 0.001;
  if (moved) a.inCover = false;
  else {
    const x = Math.round(a.x), y = Math.round(a.y);
    a.inCover = isCoverTile(s, x + 1, y) || isCoverTile(s, x - 1, y) || isCoverTile(s, x, y + 1) || isCoverTile(s, x, y - 1) || isCoverTile(s, x + 1, y - 1) || isCoverTile(s, x - 1, y - 1) || isCoverTile(s, x + 1, y + 1) || isCoverTile(s, x - 1, y + 1);
  }
}

export function reportFact(sim: Sim, a: FieldAgent, f: Fact): void { learn(sim, a, f); }
export { isIndoor };
