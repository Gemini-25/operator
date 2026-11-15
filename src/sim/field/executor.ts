// BehaviorExecutor — 선택된 임무를 실제 행동으로 실행한다.
// 모든 행동은 현장 상태(화재, 잔해, 구조 대상, 용의자, 장비)를 직접 바꾼다.
// 이동은 대원의 "믿음"으로 계획되므로, 모르는 장애물은 부딪혀 본 뒤에야 알게 된다.

import type { Sim } from '../engine';
import { emit, markRecovered, raiseProblem } from '../events';
import { T } from '../types';
import type { Fact, FieldAgent, Hostile, Incident, KitId, Prop, Scene, Task, TaskKind, WorkItem } from '../types';
import { clamp, dist, josa, pct } from '../util';
import { hasKit, kitRng, kitUses, kitWorks, medLevelOf, seatsOf, toolUse, useKit } from '../crews';
import { RETRY_AFTER, agentCost, casFact, debrisText, detectRadius, exitName, fitFor, hosFact, learn, learnQuiet, perceive, regionNameAt, resp, staminaF, visionOf, workLabel } from './agents';
import { mkFact } from './beliefs';
import { astar, doorAt, isIndoor, los, staticPass, tileOf, walkableCount } from './grid';
import { applyWater, flashbang, hostageNear, hostileActive, isHeld, placeAtSafe, pushFx, panicShot } from './hazards';
import { coverRoll, fireShot } from './damage';
import { breachHowFor, lastFx, noteCollateral, noteHit, noteShot, recBreach, recCuff, recTaser, weaponOf } from './fxlog';
import { detonate } from './rules/crime';

export function makeTask(kind: TaskKind, label: string, w: WorkItem | null = null): Task {
  return {
    kind, workId: w ? w.id : -1, region: w ? w.region : -1, cas: w ? w.cas : -1, prop: w ? w.prop : -1, hostile: w ? w.hostile : -1, tile: w ? w.tile : -1, mate: w ? w.mate : -1,
    phase: 0, progress: 0, need: 1, tx: 0, ty: 0, range: 0, pts: null, ptI: 0, covered: null,
    startedAt: 0, selfAssigned: false, thorough: w ? w.thorough : false, wait: 0, sub: null, fails: 0, label, repathAt: 0,
  };
}

function releaseSpot(s: Scene, a: FieldAgent): void { if (a.spot >= 0) { if (s.spots[a.spot].taken === a.rid) s.spots[a.spot].taken = -1; a.spot = -1; } }

/** 이미 끝나 있던 일: 지휘관의 믿음이 낡아 다시 지시한 것이므로, 같은 내용이라도 다시 보고한다 (무전 문구는 남기지 않는다) */
function reportDone(sim: Sim, a: FieldAgent, f: Fact): void { a.quiet.add(f.key); learn(sim, a, f, true, true); }

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
    else if (reason === 'preempt' || reason === 'danger') {
      if ((w.status === 'active' || w.status === 'open') && !w.assignees.length) w.status = 'open';
      // 위험해서 내려놓았다(후퇴): 작업은 다른 대원이 맡을 수 있게 열어 두고, 이 대원에게는 한동안 다시 맡기지 않는다 (무전은 후퇴 보고가 대신한다)
      if (reason === 'danger') w.failedAt[a.rid] = sim.t;
    }
    else if (w.status === 'active' || w.status === 'open') {
      w.fails++; w.holdUntil = sim.t + (reason === 'fire' ? 14 : 8);
      if (reason === 'nopath' || reason === 'fire') w.failedAt[a.rid] = sim.t;      // 닿지 못한 대원은 한동안 같은 시도를 하지 않는다 (agents.failedRecently)
      if (!w.assignees.length) w.status = 'open';
      if (reason && reason !== 'preempt') {
        const r = resp(sim, a);
        const txt: Record<string, string> = { nopath: '진입 경로를 찾지 못했습니다', fire: '화염으로 접근할 수 없습니다', equip: '장비 문제로 임무를 계속할 수 없습니다', gone: '대상이 더 이상 그 위치에 없습니다', unsafe: '위협이 해소되지 않아 접근할 수 없습니다', full: '차에 환자 자리가 없습니다' };
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
  const txt = kind === 'debris' ? debrisText(where) : `${where} 문이 잠겨 있음`;
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
  if (s.smoke[i] > 0.3) v *= hasKit(sim, a.rid, 'scba') ? 0.8 : 0.6;      // 공기호흡기가 없으면 연기 속에서 더 느리다
  if (hasKit(sim, a.rid, 'bombSuit')) v *= 0.75;      // 폭발물 방호복은 무겁다
  if (a.task && (a.task.kind === 'engage' || a.task.kind === 'perimeter') && hasKit(sim, a.rid, 'shield')) v *= 0.9;      // 방패를 세우고 움직이면 느리다
  if (s.kind === 'search') v *= s.tiles[i] === T.TRAIL ? 0.9 : s.tiles[i] === T.TREE ? 0.42 : 0.6;      // 험한 지형
  else if (s.tiles[i] === T.TREE) v *= 0.62;
  if (a.carrying !== -1) {
    const helper = s.agents.find((b) => b !== a && b.status === 'active' && b.task && b.task.kind === a.task?.kind && b.task.workId === a.task?.workId && dist(a.x, a.y, b.x, b.y) < 2);
    const walk = a.carrying >= 0 && s.casualties[a.carrying].mob === 'mobile';
    // 옮기는 사람이나 곁에서 돕는 사람이 들것을 가졌으면 더 빨리 옮긴다 (둘 0.78 → 0.88, 혼자 0.48 → 0.55)
    const litter = !walk && (hasKit(sim, a.rid, 'stretcher') || (helper !== undefined && hasKit(sim, helper.rid, 'stretcher')));
    v *= walk ? 0.7 : helper ? (litter ? 0.88 : 0.78) : litter ? 0.55 : 0.48;
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
    if (hasKit(sim, a.rid, 'hose') && !u.pumpFailed && (u.water > 0 || u.hydrant)) {      // 관창을 든 사람만 길 위의 불을 끄며 지나간다
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
  // 정밀 재수색을 거듭할수록 간격을 더 좁힌다 (잘 숨겨진 대상은 "다 보았다"고 여긴 거리보다 가까이 가야 보인다)
  if (t.thorough && s.kind === 'search' && s.researchRound >= 2) spacing = Math.max(1.0, rr * (1.1 - 0.25 * (s.researchRound - 1)));
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
  if (p.kind === 'door') recBreach(sim, s, p.x, p.y, a.x, a.y, { door: p.id, how: breachHowFor(sim, [a], true, false), n: 1, sync: false, by: a.rid, forced: true });
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
  const r = resp(sim, a), I = sim.incidents[s.incidentId];
  // 효과 자리: 실제로 쓰는 도구의 성능 (숨은 고장은 여기서 드러난다 — crews.toolUse)
  const rate = kind === 'force' ? 0.6 + r.skills.rescue * 0.6 + toolUse(sim, a.rid, 'force', I) * 0.6 + r.skills.law * 0.3 : 0.5 + r.skills.rescue * 0.8 + toolUse(sim, a.rid, 'clear', I) * 0.5;
  p.hp -= rate * staminaF(r) * sim.dt;
  drain(sim, a, 0.7);
  a.ring = clamp(1 - p.hp / 12, 0.05, 1);
  if (p.hp <= 0) { unblock(sim, s, a, tile); return true; }
  return false;
}

/** 진압 분사. 물 소모와 펌프 마모가 누적된다. 반환: false = 장비 문제로 중단 */
/**
 * 물이 떨어졌거나 펌프가 멈췄다: 분사하던 대원과, 그 부대에서 펌프를 맡은 활동 중인 대원(기관원·사다리 조작원)이 함께 안다.
 * 급수 연결·예비 펌프 교체는 펌프를 맡은 대원이 스스로 나선다(brain.ts) — 관창수는 관창을 놓지 않는다.
 */
function equipTrouble(sim: Sim, s: Scene, a: FieldAgent, issue: 'pump' | 'water', ev = -1): void {
  a.equipIssue = issue; if (ev >= 0) a.lastBlockEvent = ev;
  for (const b of s.agents) if (b !== a && b.unitId === a.unitId && b.status === 'active' && hasKit(sim, b.rid, 'pumpPanel')) { b.equipIssue = issue; if (ev >= 0) b.lastBlockEvent = ev; }      // 그 기록이 급수 연결·장비 교체의 원인으로 이어진다
}

/**
 * 공기호흡기 없이는 들어가지 않는 자리인가: 화재·가스·붕괴 현장의 건물 안, 또는 불이 났다고 아는 건물 안 구역 (fitFor 의 검사와 같다).
 * 임무를 맡은 뒤에 그 자리가 그런 곳임을 알게 된 대원을 문 앞에서 세운다 — 부른 쪽은 그 사실을 믿음에 넣고(낡은 믿음으로 같은 시도를 되풀이하지 않게) 임무를 내려놓는다.
 */
function noAirEntry(sim: Sim, s: Scene, a: FieldAgent, x: number, y: number): boolean {
  if (hasKit(sim, a.rid, 'scba')) return false;
  const rg = s.region[tileOf(s, x, y)];
  return rg >= 0 && s.regions[rg].indoor && (s.kind === 'fire' || s.kind === 'hazmat' || s.kind === 'collapse' || (a.beliefs.val<number>('fire', rg) ?? 0) > 0.25);
}

/**
 * 교대: 이 작업에 붙어 일하는 사람이 정원(w.max)을 넘었다 — 지휘관이 더 나은 장비의 대원을 보냈다(commander.assign 의 교대).
 * 그 자리(2.5칸 안)에서 일하는 사람 가운데 가장 서툰 사람이 손을 뗀다. 돌려주는 값: 손을 뗀 사람이 나인가.
 * 적합도는 든 장비로 본다(fitFor). 넘겨주는 것은 곁에서 얼굴을 보고 하는 일이라 무전을 거치지 않는다.
 */
function relieve(sim: Sim, s: Scene, a: FieldAgent, w: WorkItem, x: number, y: number): boolean {
  let n = 0, worst: FieldAgent = a, wf = Infinity, newest: FieldAgent = a;
  for (const b of s.agents) {
    if (b.status !== 'active' || !b.task || b.task.workId !== w.id || dist(b.x, b.y, x, y) > 2.5) continue;
    n++;
    const f = fitFor(sim, s, b, w);
    if (f < wf) { wf = f; worst = b; }
    if (b.task.startedAt > newest.task!.startedAt) newest = b;      // 방금 넘겨받으러 온 사람
  }
  if (n <= w.max) return false;
  const I = sim.incidents[s.incidentId];
  const rw = resp(sim, worst);
  finishTask(sim, s, worst, false, 'preempt');
  if (newest !== worst) { const by = resp(sim, newest); emit(sim, { inc: I.id, role: 'RESPONDER', actor: by.name, rid: by.id, kind: 'action', imp: 1, text: `${josa(rw.name, '과/와')} 교대합니다. ${workLabel(s, w)}, 제가 이어서 하겠습니다.` }); }
  return worst === a;
}

/** 옮기는 사람이나 곁(2칸 안)에서 같은 이송을 돕는 사람이 그 장비를 들었는가 (들것·척추 고정판) */
function carryHas(sim: Sim, s: Scene, a: FieldAgent, id: KitId): boolean {
  if (hasKit(sim, a.rid, id)) return true;
  const t = a.task;
  if (t) for (const b of s.agents) if (b !== a && b.status === 'active' && b.task && b.task.kind === t.kind && b.task.workId === t.workId && dist(a.x, a.y, b.x, b.y) < 2 && hasKit(sim, b.rid, id)) return true;
  return false;
}

/** 그 부대에서 펌프를 맡은 대원이 활동 중이고 차 곁(대기 지점 6칸 안)에 있는가 */
export function pumpTended(sim: Sim, s: Scene, unitId: number): boolean {
  for (const b of s.agents) if (b.unitId === unitId && b.status === 'active' && dist(b.x, b.y, s.staging.x, s.staging.y) <= 6 && hasKit(sim, b.rid, 'pumpPanel')) return true;
  return false;
}

function spray(sim: Sim, s: Scene, a: FieldAgent, tx: number, ty: number): boolean {
  const I = sim.incidents[s.incidentId];
  const r = resp(sim, a), u = sim.units[a.unitId];
  if (u.pumpFailed) { equipTrouble(sim, s, a, 'pump'); return false; }
  if (u.water <= 0 && !u.hydrant) { equipTrouble(sim, s, a, 'water'); return false; }
  applyWater(s, tx, ty, 0.15 * (0.6 + 0.8 * r.skills.fire) * staminaF(r) * sim.dt);
  // 펌프를 맡은 대원(기관원·사다리 조작원)이 차 곁(대기 지점 6칸 안)에서 펌프를 보고 있으면 물을 덜 쓰고 펌프가 덜 닳는다
  const tended = pumpTended(sim, s, a.unitId);
  if (!u.hydrant) u.water = Math.max(0, u.water - 1.5 * (tended ? 0.9 : 1) * sim.dt);
  u.pumpCond -= 0.0042 * sim.tune.pumpWearMul * (tended ? 0.6 : 1) * sim.dt;
  drain(sim, a, 0.55);
  if (sim.tick % 2 === 0) pushFx(sim, s, 'spray', a.x, a.y, tx + s.rng.range(-0.4, 0.4), ty + s.rng.range(-0.4, 0.4), undefined, undefined, 0.3);
  if (u.pumpCond < 0.2 && !u.pumpFailed) {
    u.pumpFailed = true;
    equipTrouble(sim, s, a, 'pump', raiseProblem(sim, I, 'EQUIP_FAIL', `${u.callsign} 펌프 고장 (출동 전 상태 불량)`, { role: 'RESPONDER', actor: r.name, rid: r.id, imp: 2, text: `${u.callsign} 펌프 압력 저하! 방수가 중단됐습니다.` }, false));
    pushFx(sim, s, 'text', a.x, a.y - 1, undefined, undefined, '펌프 고장', '#ff6b6b', 2);
    return false;
  }
  if (u.water <= 0 && !u.hydrant) {
    equipTrouble(sim, s, a, 'water', raiseProblem(sim, I, 'WATER_OUT', `${u.callsign} 탱크 용수 소진`, { role: 'RESPONDER', actor: r.name, rid: r.id, imp: 2, text: `${u.callsign} 탱크 용수가 바닥났습니다. 급수 연결이 필요합니다.` }, false));
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

/** 사격의 거리 감쇠는 든 총이 정한다: 권총 1.3 − d/14, 소총 1.3 − d/18, 저격 소총 1.35 − d/32 (하한 0.6). 저격 소총 > 소총 > 권총 */
export function rangeFactor(sim: Sim, rid: number, d: number): number {
  if (hasKit(sim, rid, 'sniper')) return clamp(1.35 - d / 32, 0.6, 1.1);
  if (hasKit(sim, rid, 'rifle')) return clamp(1.3 - d / 18, 0.4, 1.1);
  return clamp(1.3 - d / 14, 0.4, 1.1);
}

/**
 * 테이저: 총을 들지 않은 상대가 덤벼들 때(fight) 4칸 안에서 보이면 쏜다. 맞으면(0.72) 3.2초 무력화.
 * 대기 시간은 사격 대기(a.cooldown)와 따로인 a.taserAt 이다(검거 임무에서는 cooldown 이 줄지 않는다). 판정은 kit:<현장> 흐름 — s.rng 를 쓰지 않는다.
 * 돌려주는 값: 이번 틱에 쐈는가 (쐈으면 부른 쪽은 그 틱에 움직이지 않는다).
 */
const TASER = { range: 4, hit: 0.72, stun: 3.2, wait: 4 };
function tryTaser(sim: Sim, s: Scene, a: FieldAgent, h: Hostile): boolean {
  if (h.weapon === 'gun' || h.state !== 'fight' || sim.t < h.stunUntil) return false;
  if (sim.t - (a.taserAt ?? -99) < TASER.wait || kitUses(sim, a.rid, 'taser') <= 0 || !hasKit(sim, a.rid, 'taser')) return false;
  if (dist(a.x, a.y, h.x, h.y) > TASER.range || !los(s, a.x, a.y, h.x, h.y)) return false;
  const I = sim.incidents[s.incidentId], r = resp(sim, a);
  if (!kitWorks(sim, a.rid, 'taser', I)) return false;      // 숨은 고장이면 여기서 드러나고 쏘지 못한다
  useKit(sim, a.rid, 'taser'); a.taserAt = sim.t;
  a.fx = h.x - a.x; a.fy = h.y - a.y;
  const hit = kitRng(sim, s).chance(TASER.hit);
  if (hit) h.stunUntil = sim.t + TASER.stun;
  recTaser(sim, s, a, h.x, h.y, hit, 1, h.id);
  emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 2, text: hit ? `테이저 발사 — ${h.label} 무력화.` : '테이저 발사 — 빗나감.' });
  return true;
}

function shootAt(sim: Sim, s: Scene, a: FieldAgent, hid: number): void {
  const I = sim.incidents[s.incidentId];
  const r = resp(sim, a), h = s.hostiles[hid];
  a.cooldown = s.rng.range(1.4, 2.2);
  const d = dist(a.x, a.y, h.x, h.y);
  // 용의자가 가구나 벽 모서리를 끼고 있거나 움직이는 중이면 맞히기 어렵다
  const sx = Math.round(h.x) + Math.sign(Math.round(a.x - h.x)), sy = Math.round(h.y) + Math.sign(Math.round(a.y - h.y));
  const tileAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= s.w || y >= s.h ? T.VOID : s.tiles[y * s.w + x]);
  const covered = tileAt(sx, Math.round(h.y)) === T.FURN || tileAt(Math.round(h.x), sy) === T.FURN;
  const moving = Math.abs(h.x - h.px) + Math.abs(h.y - h.py) > 0.05;
  const p = 0.36 * (0.55 + 0.7 * r.skills.law) * (0.7 + 0.5 * r.composure) * rangeFactor(sim, a.rid, d) * staminaF(r) * (covered ? 0.55 : 1) * (moving ? 0.6 : 1);
  const hit = s.rng.chance(p);
  h.shotAt = sim.t;
  // 빗나간 탄이 겨눈 점 (판정 흐름에서 x 다음 y — 예전 그림 줄과 같은 호출 순서)
  const mx = h.x + (hit ? 0 : s.rng.range(-0.8, 0.8)), my = h.y + (hit ? 0 : s.rng.range(-0.8, 0.8));
  const hc = hostageNear(s, h);
  const struck = !hit && hc && s.rng.chance(0.2) ? hc : null;      // 인질 곁의 용의자를 향해 쏜 빗나간 탄이 인질에게 간다 (판정 흐름의 순서는 예전과 같다: 흔들기 다음)
  const ct = !hit && covered ? coverRoll(sim, s, h.x, h.y, a.x, a.y) : -1;      // 빗나간 탄이 용의자의 엄폐 가구에 맞는가 (파손용 흐름)
  // 탄이 실제로 간 선: 지나간 창이 깨지고 엄폐 가구가 닳는다. 그림은 같은 선을 그 끝(end)까지 그린다
  const end = hit ? fireShot(sim, s, a.x, a.y, h.x, h.y, 'body') : struck ? fireShot(sim, s, a.x, a.y, struck.x, struck.y, 'body') : ct >= 0 ? fireShot(sim, s, a.x, a.y, h.x, h.y, ct) : fireShot(sim, s, a.x, a.y, mx, my, 'miss');
  pushFx(sim, s, 'shot', a.x, a.y, end.x, end.y, undefined, '#ffe08a', 0.25);
  const shot = lastFx(sim, s, 'shot'); noteShot(sim, s, shot, { side: 0, by: a.rid, wpn: weaponOf(sim, a), hit, end, tx: h.x, ty: h.y, tk: 1, target: h.id });
  h.morale -= 0.015;
  if (sim.t >= h.stunUntil) { h.alertUntil = sim.t + 6; h.facing = Math.atan2(a.y - h.y, a.x - h.x); }
  if (struck) {
    // 인질 곁의 용의자를 향해 쏜 빗나간 탄
    struck.health -= s.rng.range(22, 34); struck.mob = 'immobile'; struck.bleed = Math.max(struck.bleed, 0.15); struck.bleed0 = struck.bleed; struck.walking = false;
    struck.causeEvent = raiseProblem(sim, I, 'ESCALATION', '교전 중 인질 피격', { role: 'SYSTEM', actor: '현장', rid: r.id, imp: 3, text: `교전 중 빗나간 탄에 인질(구조 대상 ${struck.label})이 다쳤습니다!` }, false);
    noteCollateral(sim, s, shot, struck, a.x, a.y);
  }
  if (!I.problems.some((q) => q.detail === '교전 발생')) {
    I.problems.push({ code: 'ESCALATION', t: sim.t, eventId: emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 3, text: '교전 발생! 대응 사격합니다.' }), detail: '교전 발생', recovered: true, recoveryText: '' });
  }
  if (hit) {
    h.health -= s.rng.range(30, 48); h.morale -= 0.12;
    pushFx(sim, s, 'hit', h.x, h.y);
    noteHit(lastFx(sim, s, 'hit'), { side: 0, ox: a.x, oy: a.y, tk: 1, target: h.id });
    if (h.health <= 0) r.xpGained += 0.004;
  }
}

/** 동시 진입: 대기하던 출입문을 열고(잠겼으면 부수고), 섬광탄이 있으면 먼저 던져 넣는다. */
/** 용의자가 있는 방으로 들어가는, 아직 닫혀 있는 가장 가까운 문 (용의자가 이미 보이거나 같은 방이면 없음) */
function roomDoorFor(s: Scene, a: FieldAgent, h: Hostile): Prop | null {
  const hr = s.region[tileOf(s, h.x, h.y)], ar = s.region[tileOf(s, a.x, a.y)];
  if (hr < 0 || hr === ar || s.regions[hr].kind !== 'room' || los(s, a.x, a.y, h.x, h.y)) return null;
  let best: Prop | null = null, bd = 14;
  for (const p of s.props) {
    if (p.kind !== 'door' || p.open || p.entered) continue;
    const i = p.y * s.w + p.x;
    if (s.region[i] !== hr && s.region[i - 1] !== hr && s.region[i + 1] !== hr && s.region[i - s.w] !== hr && s.region[i + s.w] !== hr) continue;
    const d = dist(a.x, a.y, p.x, p.y);
    if (d < bd) { bd = d; best = p; }
  }
  return best;
}

function breach(sim: Sim, s: Scene, a: FieldAgent): void {
  const I = sim.incidents[s.incidentId];
  s.breachDone = true;
  let bangs = 0;
  s.exits.forEach((e) => {
    const team = s.agents.filter((b) => b.status === 'active' && b.task && b.task.kind === 'engage' && dist(b.x, b.y, e.x, e.y) <= 2.6);
    if (!team.length) return;
    // 출입구 바로 안쪽의 문
    let inX = e.x, inY = e.y + (e.y > s.h / 2 ? -3 : 3);
    let doorSeen = false;
    for (const p of s.props) {
      if (p.kind !== 'door' || Math.abs(p.x - e.x) + Math.abs(p.y - e.y) > 1.5) continue;
      const wasLocked = p.blocking, wasOpen = !!p.open;
      if (p.blocking) { s.propAt[p.y * s.w + p.x] = -1; p.blocking = false; p.locked = false; }
      if (!p.open) { p.open = true; s.staticVersion++; }
      inX = e.x + (p.x - e.x) * 3; inY = e.y + (p.y - e.y) * 3;      // 문을 지나 세 칸 안쪽
      recBreach(sim, s, p.x, p.y, e.x, e.y, { door: p.id, how: breachHowFor(sim, team, wasLocked, wasOpen), n: team.length, sync: true, by: team[0].rid, forced: wasLocked }); doorSeen = true;
    }
    if (!doorSeen) recBreach(sim, s, e.x, e.y, e.x, e.y, { door: -1, how: 'open', n: team.length, sync: true, by: team[0].rid, forced: false });
    // 문 바로 안쪽에 용의자가 있다고 알고 있을 때만 섬광탄을 쓴다(없으면 방 진입 때를 위해 아낀다)
    const thrower = team.find((b) => kitUses(sim, b.rid, 'flashbang') > 0 && b.beliefs.list('hos').some((f) => (f.value.state === 'hold' || f.value.state === 'fight') && dist(f.value.x, f.value.y, inX, inY) <= 5));      // 섬광탄은 사람 몫이다: 가진 사람이 던진다
    if (thrower && sim.t - s.bangAt > 2) {
      useKit(sim, thrower.rid, 'flashbang'); s.bangAt = sim.t;
      bangs += flashbang(sim, s, inX, inY, thrower);
    }
    for (const b of team) { b.path = null; b.pathGoal = -1; }
    // 문이 열리는 소리: 무력화되지 않은 용의자는 그쪽을 돌아본다
    for (const h of s.hostiles) if ((h.state === 'hold' || h.state === 'fight') && sim.t >= h.stunUntil && dist(h.x, h.y, e.x, e.y) <= 13 && sim.t >= h.alertUntil) { h.facing = Math.atan2(e.y - h.y, e.x - h.x); h.alertUntil = sim.t + 5; }
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
      if (reg.indoor && !hasKit(sim, a.rid, 'turnout')) { let m = 0; for (const i of reg.tiles) if (s.fire[i] > m && dist(a.x, a.y, i % s.w, (i / s.w) | 0) < 4) m = s.fire[i]; if (m > 0.35) { finishTask(sim, s, a, false, 'fire'); return; } }
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
      if (u.pumpFailed || (u.water <= 0 && !u.hydrant)) { equipTrouble(sim, s, a, u.pumpFailed ? 'pump' : 'water'); finishTask(sim, s, a, false, 'equip'); return; }
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
      // 소화전에 닿을 수 없다(물 없이 불길에 갇힘 등): 한동안 스스로 다시 시도하지 않는다. 급수는 지휘관이 다른 대원이나 지원 부대로 푼다
      if (m === 'nopath') { a.equipRetryAt = sim.t + RETRY_AFTER; finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      t.need = kitWorks(sim, a.rid, 'pumpPanel', I) ? 5.5 : 9;      // 펌프를 맡은 대원은 급수 연결이 손에 익었다
      t.progress += dt * staminaF(r); a.ring = t.progress / t.need; drain(sim, a, 0.5);
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
    case 'waterRescue': {
      const c = s.casualties[t.cas];
      if (c.dead || !c.inWater) { learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, true); return; }
      // 물가에서 구조 대상이 보이는 가장 가까운 자리로 간다 (떠내려가면 따라 옮긴다). 네 칸 안이면 줄을 던질 수 있다
      const m = moveTo(sim, s, a, c.x, c.y, 3.6, true);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      a.label = m === 'arrived' ? '구조 줄 투척' : '물가로 이동';
      if (m !== 'arrived') { t.progress = Math.max(0, t.progress - dt * 0.5); return; }
      a.fx = c.x - a.x; a.fy = c.y - a.y;
      t.need = 9 / (0.4 + r.skills.rescue * 0.8 + toolUse(sim, a.rid, 'water', I) * 0.5);
      t.progress += dt * staminaF(r); a.ring = t.progress / t.need;
      drain(sim, a, 0.5);
      if (t.progress >= t.need) {
        c.inWater = false; c.drift = 0; c.mob = 'immobile'; c.trapWork = 0; c.tFreed = sim.t;
        c.x = Math.round(a.x); c.y = Math.round(a.y); c.px = c.x; c.py = c.y;
        c.bleed *= 0.35; c.bleed0 = c.bleed;      // 물 밖으로 나오면 악화가 느려진다 (저체온은 남는다)
        learnQuiet(sim, a, casFact(sim, s, c, r.name));
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, text: `구조 대상 ${c.label}를 물에서 끌어냈습니다. 처치와 이송이 필요합니다.` });
        r.xpGained += 0.005;
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'extricate': {
      const c = s.casualties[t.cas];
      if (c.dead) { learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, true); return; }
      if (c.mob !== 'trapped') { learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, true); return; }
      if (noAirEntry(sim, s, a, c.x, c.y)) { learn(sim, a, casFact(sim, s, c, r.name), false); finishTask(sim, s, a, false, 'unsafe'); return; }      // 위험한 건물 안: 공기호흡기 없이는 들어가지 않는다
      const m = moveTo(sim, s, a, c.x, c.y, 1.5);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      if (w && relieve(sim, s, a, w, c.x, c.y)) return;      // 교대: 내가 손을 뗐다
      const rate = r.skills.rescue * (0.35 + 0.65 * toolUse(sim, a.rid, 'extricate', I)) * staminaF(r) * (s.smoke[tileOf(s, a.x, a.y)] > 0.4 ? 0.7 : 1);
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
      const med = medLevelOf(sim, a.rid);      // 이 대원이 든 의료 장비의 수준 (없으면 부서의 기본 교육)
      const q0 = clamp(r.skills.medical * (0.5 + 0.5 * med) * 1.15, 0.2, 1);
      // 제세동기: 심정지 환자나 위중한(건강 25 미만) 환자의 처치 질을 0.2 올린다(상한 1).
      // 다시 볼 가치가 있는지는 든 장비로 어림하고(hasKit), 효과는 처치를 마칠 때 준다(kitWorks — 숨은 고장은 그때 드러난다)
      const shock = (s.kind === 'medical' && s.variant === 'arrest') || c.health < 25;
      const qPlan = shock && hasKit(sim, a.rid, 'aed') ? Math.min(1, q0 + 0.2) : q0;
      // 이미 처치를 받은 환자는 더 나은 처치를 할 수 있는 대원만 다시 본다
      if (c.dead || c.where === 'loaded' || c.where === 'hospital' || (c.treated && qPlan <= c.treatQ + 0.15)) { learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, true); return; }
      if (c.where === 'carried') return;
      if (c.treated && t.phase === 0) { t.phase = 1; c.treatProg = 0; }
      const m = moveTo(sim, s, a, c.x, c.y, 1.3);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      const rate = Math.max(0.1, r.skills.medical * (0.5 + 0.5 * med)) * staminaF(r);
      t.need = 4.5 + (c.health < 40 ? 4 : c.health < 70 ? 2 : 0);
      c.treatProg += rate * dt; a.ring = c.treatProg / t.need; drain(sim, a, 0.3);
      if (c.treatProg >= t.need) {
        const q = shock && kitWorks(sim, a.rid, 'aed', I) ? Math.min(1, q0 + 0.2) : q0;
        // 제세동기가 듣지 않아 앞선 처치보다 나아진 것이 없다: 상태만 다시 알리고 끝낸다 (처치의 수준을 낮추지 않는다)
        if (c.treated && q <= c.treatQ) { learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, true); return; }
        // 의사 장비(약물·수혈): 위중한 환자(건강 40 미만)를 더 끌어올리고 악화를 더 늦춘다
        const doc = kitWorks(sim, a.rid, 'doctorKit', I);
        if (doc && c.health < 40) c.health = Math.min(100, c.health + 15);
        else if (!c.treated) c.health = Math.min(100, c.health + 8 * q);
        c.treated = true; if (c.tTreated < 0) c.tTreated = sim.t; c.treatQ = q; c.bleed = c.bleed0 * (1 - (doc ? 0.95 : 0.9) * q); c.bystander = false;
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
        // 공기호흡기가 없는 대원은 위험한 건물(화재·가스·붕괴) 안으로 따라 들어가지 않는다
        if (noAirEntry(sim, s, a, carrier.x, carrier.y)) { learn(sim, a, casFact(sim, s, c, r.name), false); finishTask(sim, s, a, false, 'unsafe'); return; }
        a.label = '이송 보조';
        moveTo(sim, s, a, carrier.x, carrier.y, 1.2);
        return;
      }
      if (a.carrying !== c.id) {
        // 낡았거나 없는 믿음으로 맡았는데 그 사람이 위험한 건물 안에 있다: 공기호흡기 없이는 들어가지 않는다
        if (noAirEntry(sim, s, a, c.x, c.y)) { learn(sim, a, casFact(sim, s, c, r.name), false); finishTask(sim, s, a, false, 'unsafe'); return; }
        const m = moveTo(sim, s, a, c.x, c.y, 1.3);
        if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (m !== 'arrived') return;
        t.progress += dt;
        if (t.progress >= 1.2) { c.where = 'carried'; c.inVehicle = null; a.carrying = c.id; a.path = null; a.pathGoal = -1; learn(sim, a, casFact(sim, s, c, r.name), false); }
        return;
      }
      const m = moveTo(sim, s, a, s.safe.x, s.safe.y, 1.2);
      c.x = a.x - a.fx * 0.45; c.y = a.y - a.fy * 0.45;
      // 척추 고정판: 차·잔해에서 꺼낸 사람(교통사고·붕괴)을 고정판 없이 옮기면 옮기는 동안 더 나빠진다 (악화 ×1.12).
      // 옮기는 사람이나 곁에서 돕는 사람이 고정판을 가졌으면 괜찮다
      if ((s.kind === 'traffic' || s.kind === 'collapse') && c.tFreed >= 0 && !c.dead && !carryHas(sim, s, a, 'spineBoard')) c.health -= c.bleed * 0.12 * dt;
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
      if (c.dead || c.where === 'loaded' || c.where === 'hospital') { learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, true); return; }      // 이미 실려 갔다: 지휘관의 믿음이 낡았으므로 다시 알린다
      if (c.where !== 'safe' && a.carrying !== c.id) { finishTask(sim, s, a, false, 'gone'); return; }
      // 실을 자리가 없다(그 사이에 다른 환자가 먼저 실렸다): 데리러 가지 않는다. 옮기던 중이면 차 앞에서 다시 본다(아래)
      if (a.carrying !== c.id && u.patients.length >= seatsOf(u)) { finishTask(sim, s, a, false, 'full'); return; }
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
        // 실을 때 자리를 다시 본다: 환자 자리(seatsOf — 구급차 2, 헬기 1)가 찼으면 안전 구역에 도로 눕히고 지휘관에게 알린다
        if (u.patients.length >= seatsOf(u)) { c.where = 'safe'; placeAtSafe(s, c); a.carrying = -1; finishTask(sim, s, a, false, 'full'); return; }
        c.where = 'loaded'; c.tLoaded = sim.t; a.carrying = -1; u.patients.push(c.id); u.patientsIncident = I.id;
        learnQuiet(sim, a, casFact(sim, s, c, r.name));
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `구조 대상 ${c.label} ${u.callsign}에 탑승 완료.` });
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'traffic': {
      const k = t.tile, cp = s.controlPts[k];
      if (s.controlDone[k]) { reportDone(sim, a, mkFact('ctl', k, true, r.name, sim.t, 1, true, '차로 통제 완료')); finishTask(sim, s, a, true); return; }
      const m = moveTo(sim, s, a, cp.x, cp.y, 0.8);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      t.need = (r.dept === 'police' ? 6 : 10) * (kitWorks(sim, a.rid, 'baton', I) ? 0.85 : 1);      // 경광봉을 들면 차를 더 빨리 세운다
      t.progress += dt; a.ring = t.progress / t.need;
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
      // 누출 차단 장비가 있으면 밸브·연료 누출 조치가 빠르다 (균열부 보강에는 쓰지 않는다)
      t.need = p.kind === 'unstable' ? 13 / (0.5 + r.skills.rescue) : (p.kind === 'valve' ? 9 : 7) / (0.5 + r.skills.fire) / (kitWorks(sim, a.rid, 'plugKit', I) ? 1.6 : 1);
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
    case 'overhaul': {
      // 잔불 정리: 불이 꺼졌다고 본 방에 들어가 벽·바닥 속에 남은 불씨를 찾아 적신다. 꺼진 줄 알았던 불이 되살아나는 것을 막는다
      // 되살아난 불을 찾으면 보고하고 그 자리에서 직접 끈다(진압조가 방의 일부만 보고 "진압 확인"을 내면 같은 일이 되풀이된다)
      const reg = s.regions[t.region];
      if (t.tile >= 0 && s.fire[t.tile] > 0.05) {
        const tx = t.tile % s.w, ty = (t.tile / s.w) | 0;
        const m = moveTo(sim, s, a, tx, ty, 3.2, true);
        if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (m !== 'arrived') return;
        a.fx = tx - a.x; a.fy = ty - a.y; a.ring = 1 - s.fire[t.tile];
        if (!spray(sim, s, a, tx, ty)) finishTask(sim, s, a, false, 'equip');
        return;
      }
      if (t.progress < t.need || t.need <= 0) {
        const m = moveTo(sim, s, a, Math.round(reg.cx), Math.round(reg.cy), 2.2);
        if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (m !== 'arrived') return;
        t.need = 4 / (0.6 + 0.4 * r.skills.fire);
        t.progress += dt * staminaF(r); a.ring = t.progress / t.need; drain(sim, a, 0.3);
        if (t.progress < t.need) return;
      }
      let embers = 0, left = 0, hot = -1;
      for (const i of reg.tiles) {
        if (s.fire[i] > 0 && s.fire[i] < 0.35) { s.fire[i] = 0; embers++; }
        if (s.fire[i] <= 0) { s.heat[i] = 0; s.wet[i] = Math.max(s.wet[i], 0.9); }
        else if (s.fire[i] > left) { left = s.fire[i]; hot = i; }
      }
      if (embers) emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `${reg.name}에 남아 있던 불씨 ${embers}곳을 찾아 적셨습니다.` });
      if (hot >= 0) {
        if (t.phase === 0) {
          t.phase = 1;
          learn(sim, a, mkFact('fire', reg.id, Math.max(0.1, Math.round(left * 5) / 5), r.name, sim.t, 1, true, `${reg.name} 잔불이 되살아남 (강도 ${pct(left)})`), true, true);
          emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'radio', imp: 2, text: `${reg.name}에서 꺼진 줄 알았던 불이 다시 번지고 있습니다. 직접 진압합니다.` });
        }
        t.tile = hot;
        return;
      }
      if (t.phase === 1 || (a.beliefs.val<number>('fire', reg.id) ?? 0) > 0) learn(sim, a, mkFact('fire', reg.id, 0, r.name, sim.t, 1, true, `${reg.name} 화재 진압 확인`), true, true);      // 불이 났다고 알던 구역이 꺼져 있다 (불 확인)
      learn(sim, a, mkFact('ovh', reg.id, 1, r.name, sim.t, 1, true, `${reg.name} 잔불 정리 완료`), true, true);
      r.xpGained += 0.001;
      finishTask(sim, s, a, true);
      return;
    }
    case 'defuse': {
      // 폭발물 해체 (처리반만 맡는다). 가짜 장치도 다가가 확인해야 끝난다. 시한은 해체하는 동안에도 흐른다 (rules/crime.ts)
      const p = s.props[t.prop];
      const gone = (text: string): Fact => mkFact('haz', p.id, { kind: 'bomb', active: false, x: p.x, y: p.y }, r.name, sim.t, 1, true, text);
      if (p.mitigated || p.exploded) { learn(sim, a, gone(p.exploded ? '장치가 이미 터졌습니다 — 해체할 것이 남아 있지 않음' : '폭발물 위험 해소'), true, true); finishTask(sim, s, a, true); return; }
      if (!hasKit(sim, a.rid, 'eodKit')) { finishTask(sim, s, a, false, 'equip'); return; }      // 해체 공구를 든 처리 요원만 손댄다 (fitFor 가 먼저 막는다)
      const m = moveTo(sim, s, a, p.x, p.y, 1.6);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      a.fx = p.x - a.x; a.fy = p.y - a.y;
      // 원격 로봇: 그것을 든 대원이 현장에서 활동 중이면 가짜 장치를 빨리 확인하고(10 → 5초), 진짜 장치의 해체 실수가 준다(×0.6)
      const op = s.agents.find((b) => b.status === 'active' && hasKit(sim, b.rid, 'robot'));
      const robot = op !== undefined && kitWorks(sim, op.rid, 'robot', I);      // 숨은 고장은 쓰려 할 때 드러난다
      t.need = (p.real ? 26 : robot ? 5 : 10) / (0.5 + r.skill);
      t.progress += dt; a.ring = t.progress / t.need;
      if (p.real && a.rng.chance(0.004 * (1 - r.skill) * (robot ? 0.6 : 1) * dt)) {      // 실수: 숙련도가 낮을수록 잦다
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'hazard', imp: 2, text: '해체 중 장치가 반응했습니다!' });
        detonate(sim, s, I, p); finishTask(sim, s, a, true); return;
      }
      if (t.progress >= t.need) {
        p.mitigated = true; p.blocking = false; s.propAt[p.y * s.w + p.x] = -1; s.staticVersion++;      // 처리된 물건은 더 이상 길을 막지 않는다
        learnQuiet(sim, a, gone('폭발물 위험 해소'));
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 3, text: p.real ? '폭발물 해체 완료. 위험이 사라졌습니다.' : '확인 결과 폭발물이 아닙니다.' });
        r.xpGained += p.real ? 0.006 : 0.002;
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
        const k = 0.0125 * (0.4 + 0.6 * (r.composure + r.experience) / 2) * (1.25 - h.aggression) * (kitWorks(sim, a.rid, 'megaphone', I) ? 1.2 : 1);      // 확성기로 말하면 더 잘 닿는다
        h.negot += dt; h.morale -= k * dt;
        t.progress += dt; a.ring = clamp(1 - (h.morale - 0.2) / 0.6, 0, 1);
        if (t.phase === 0) { t.phase = 1; emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `${h.label}와 협상을 시도합니다.` }); }
        else if (t.phase === 1 && h.morale < 0.42) { t.phase = 2; emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `${h.label}가 동요하고 있습니다. 협상을 계속합니다.` }); }
        else if (t.phase === 1 && t.progress > 30 && h.aggression > 0.6) { t.phase = 3; emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'radio', imp: 1, text: `${h.label}가 협상에 응하지 않습니다.` }); }
      } else a.label = s.kind === 'hazmat' ? '출입구 통제' : `${exitName(s, t.tile)} 봉쇄`;
      return;
    }
    case 'engage': {
      const h = s.hostiles[t.hostile];
      if (!hostileActive(h) || h.state === 'surrendered') { learn(sim, a, hosFact(sim, s, h, r.name), true, true); finishTask(sim, s, a, true); return; }
      a.cooldown -= dt;
      if (h.state === 'flee' || h.weapon !== 'gun') {
        a.label = h.state === 'flee' ? '도주 용의자 추격' : '용의자 접근';
        if (tryTaser(sim, s, a, h)) { a.label = '테이저 발사'; return; }      // 쏜 틱에는 움직이지 않는다 (한 틱에 이동 목표를 둘 두지 않는다)
        if (sim.t >= t.repathAt - 4.4) a.pathGoal = -1;
        const m = moveTo(sim, s, a, h.x, h.y, 1.3);
        if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (dist(a.x, a.y, h.x, h.y) <= 1.6) {
          t.progress += dt; a.ring = t.progress / 1.6;
          if (t.progress >= 1.6) {
            const was = h.state;
            h.state = 'arrested'; h.path = null;
            learnQuiet(sim, a, hosFact(sim, s, h, r.name));
            emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'resolve', imp: 3, text: `${h.label} 검거!` });
            recCuff(sim, s, h, a, was === 'flee' ? 'chase' : 'tackle');
            r.xpGained += 0.006;
            finishTask(sim, s, a, true);
          }
        }
        return;
      }
      // ① 진입조는 가까운 출입구 앞에 모였다가 정해진 시각에 함께 들어간다
      if (s.breachAt >= 0 && !s.breachDone && s.exits.length) {
        if (t.tile < 0) {
          if (s.entryExit >= 0 && s.entryExit < s.exits.length) {
            t.tile = s.entryExit;
            if (s.entryExit2 >= 0 && s.entryExit2 < s.exits.length) {
              // 두 문 동시 진입: 사람이 적은 문으로 간다(둘째부터 번갈아 — 셋이면 2·1, 넷이면 2·2). 방패수는 언제나 주 출입구
              let n1 = 0, n2 = 0;
              for (const b of s.agents) if (b !== a && b.status === 'active' && b.task && b.task.kind === 'engage' && b.task.tile >= 0) { if (b.task.tile === s.entryExit) n1++; else if (b.task.tile === s.entryExit2) n2++; }
              if (n2 < n1 && !hasKit(sim, a.rid, 'shield')) t.tile = s.entryExit2;
            }
          } else { let bd = 1e9; s.exits.forEach((e, k) => { const d0 = dist(a.x, a.y, e.x, e.y); if (d0 < bd) { bd = d0; t.tile = k; } }); }
        }
        const e = s.exits[t.tile];
        const m0 = moveTo(sim, s, a, e.x, e.y, 1.4);
        a.label = '진입 대기';
        const ready = m0 === 'arrived' || m0 === 'nopath';
        if ((ready && sim.t >= s.breachAt) || sim.t >= s.breachAt + 8) breach(sim, s, a);
        return;
      }
      // ①-2 방 진입: 용의자가 닫힌 문 뒤의 방에 있으면, 문 앞에 모였다가 (섬광탄이 있으면 던져 넣고) 함께 들어간다
      const rd = sim.t < h.stunUntil ? null : roomDoorFor(s, a, h);
      if (rd) {
        a.label = '방 진입 대기';
        const m0 = moveTo(sim, s, a, rd.x, rd.y, 1.5);
        if (m0 === 'arrived') {
          t.ptI++;
          const mates = s.agents.filter((b) => b !== a && b.status === 'active' && b.task && b.task.kind === 'engage' && dist(b.x, b.y, rd.x, rd.y) <= 2.6);
          if (mates.length >= 1 || t.ptI > 20) {
            const wasLocked = rd.blocking;
            rd.entered = true; rd.open = true; s.staticVersion++;
            if (rd.blocking) { s.propAt[rd.y * s.w + rd.x] = -1; rd.blocking = false; rd.locked = false; }
            recBreach(sim, s, rd.x, rd.y, a.x, a.y, { door: rd.id, how: breachHowFor(sim, [a, ...mates], wasLocked, false), n: mates.length + 1, sync: false, by: a.rid, forced: wasLocked });
            const thrower = [a, ...mates].find((b) => kitUses(sim, b.rid, 'flashbang') > 0);
            let n = -1;
            if (thrower && sim.t - s.bangAt > 2 && dist(h.x, h.y, rd.x, rd.y) <= 8) {
              useKit(sim, thrower.rid, 'flashbang'); s.bangAt = sim.t;
              n = flashbang(sim, s, rd.x + (h.x - rd.x) * 0.6, rd.y + (h.y - rd.y) * 0.6, thrower);
            } else if (sim.t >= h.alertUntil) { h.facing = Math.atan2(rd.y - h.y, rd.x - h.x); h.alertUntil = sim.t + 5; }
            panicShot(sim, s, I, rd.x, rd.y);
            const room = s.region[tileOf(s, h.x, h.y)] >= 0 ? s.regions[s.region[tileOf(s, h.x, h.y)]].name : '방';
            emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 3, text: n >= 0 ? `${room} 진입! 섬광탄을 던져 넣고 들어갑니다${n ? ` (용의자 ${n}명 무력화)` : ''}.` : `${room} 진입!` });
            for (const b of [a, ...mates]) { b.path = null; b.pathGoal = -1; if (b.task) b.task.ptI = 0; }
          }
        } else if (m0 === 'nopath') { rd.entered = true; }
        return;
      }
      const stunned = sim.t < h.stunUntil;
      const d = dist(a.x, a.y, h.x, h.y);
      // ② 섬광탄: 용의자 가까이 다가갔을 때 던져 넣는다
      const myBangs = kitUses(sim, a.rid, 'flashbang');      // 내가 가진 섬광탄 (부대 몫이 아니라 사람 몫)
      if (!stunned && myBangs > 0 && d <= 5 && sim.t - s.bangAt > 7 && los(s, a.x, a.y, h.x, h.y)) {
        useKit(sim, a.rid, 'flashbang'); s.bangAt = sim.t;
        const n = flashbang(sim, s, a.x + (h.x - a.x) * 0.7, a.y + (h.y - a.y) * 0.7, a);
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
            recCuff(sim, s, h, a, 'stunned');
            r.xpGained += 0.006;
            finishTask(sim, s, a, true);
          }
        }
        return;
      }
      // ④ 인질이 곁에 있고 용의자가 쏘지 않는 동안에는 사격하지 않는다
      const bangComing = s.agents.some((b) => b !== a && b.status === 'active' && b.task && b.task.kind === 'engage' && b.task.hostile === h.id && kitUses(sim, b.rid, 'flashbang') > 0);
      const haveBang = kitUses(sim, a.rid, 'flashbang') > 0;      // (위에서 방금 던졌으면 줄어 있다)
      if (hostageNear(s, h) && (h.state !== 'fight' || bangComing || haveBang)) {
        a.fx = h.x - a.x; a.fy = h.y - a.y;
        if (haveBang) {
          // 벽 너머로는 던질 수 없다: 용의자가 보이는 자리까지 다가간다
          a.label = '섬광탄 투척 위치로 접근';
          if (d > 4.6 || !los(s, a.x, a.y, h.x, h.y)) { a.pathGoal = sim.t >= t.repathAt - 4.4 ? -1 : a.pathGoal; if (moveTo(sim, s, a, h.x, h.y, 4.2, true) === 'nopath') finishTask(sim, s, a, false, 'nopath'); }
          return;
        }
        if (bangComing) { a.label = '사격 보류 — 인질 근접'; if (moveTo(sim, s, a, h.x, h.y, 7.5, true) === 'nopath') finishTask(sim, s, a, false, 'nopath'); return; }
        // 섬광탄이 없다: 쏘지 않고 거리를 좁힌다. 용의자가 눈치채지 못하면 곁에서 덮치고(기습), 눈치채면 교전이 된다
        a.label = '사격 보류 — 접근해 제압';
        a.pathGoal = sim.t >= t.repathAt - 4.4 ? -1 : a.pathGoal;
        if (moveTo(sim, s, a, h.x, h.y, 1.3) === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (dist(a.x, a.y, h.x, h.y) <= 1.7) {
          t.progress += dt; a.ring = t.progress / 2.2;
          if (t.progress >= 2.2) {
            h.state = 'arrested'; h.path = null;
            learnQuiet(sim, a, hosFact(sim, s, h, r.name));
            emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'resolve', imp: 3, text: `${h.label}를 곁에서 덮쳐 제압·검거!` });
            recCuff(sim, s, h, a, 'tackle');
            r.xpGained += 0.006;
            finishTask(sim, s, a, true);
          }
        } else t.progress = 0;
        return;
      }
      t.progress = 0;
      const m = moveTo(sim, s, a, h.x, h.y, 7.5, true);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') { a.label = '진입'; return; }
      a.fx = h.x - a.x; a.fy = h.y - a.y;
      a.label = '교전';
      if (a.cooldown <= 0 && los(s, a.x, a.y, h.x, h.y)) shootAt(sim, s, a, h.id);
      else if (!los(s, a.x, a.y, h.x, h.y)) a.pathGoal = -1;
      return;
    }
    case 'arrest': {
      const h = s.hostiles[t.hostile];
      if (h.state === 'arrested' || h.state === 'escaped' || h.state === 'down') { learn(sim, a, hosFact(sim, s, h, r.name), true, true); finishTask(sim, s, a, true); return; }
      if (h.state !== 'surrendered' && h.weapon === 'gun') { finishTask(sim, s, a, false, 'unsafe'); return; }
      if (tryTaser(sim, s, a, h)) { a.label = '테이저 발사'; return; }      // 덤벼드는 상대(총이 아닌)에게 테이저 — 쏜 틱에는 움직이지 않는다
      const m = moveTo(sim, s, a, h.x, h.y, 1.3);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      t.need = h.state === 'surrendered' ? 2.5 : 5; t.progress += dt; a.ring = t.progress / t.need;
      if (t.progress >= t.need) {
        const was = h.state;
        h.state = 'arrested';
        learnQuiet(sim, a, hosFact(sim, s, h, r.name));
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'resolve', imp: 3, text: `${h.label} 검거 완료.` });
        recCuff(sim, s, h, a, was === 'surrendered' ? 'surrender' : 'tackle');
        r.xpGained += 0.005;
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'interview': {
      const p = s.props[t.prop];
      if (p.interviewed) { reportDone(sim, a, mkFact('evid', p.id, { kind: 'witness', done: true }, r.name, sim.t, 1, true, '목격자 면담 완료')); finishTask(sim, s, a, true); return; }
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
