// BehaviorExecutor — 선택된 임무를 실제 행동으로 실행한다.
// 모든 행동은 현장 상태(화재, 잔해, 구조 대상, 용의자, 장비)를 직접 바꾼다.
// 이동은 대원의 "믿음"으로 계획되므로, 모르는 장애물은 부딪혀 본 뒤에야 알게 된다.

import type { Sim } from '../engine';
import { emit, markRecovered, raiseProblem } from '../events';
import { T } from '../types';
import type { Fact, FieldAgent, Hostile, Incident, KitId, MateBelief, Prop, Scene, Task, TaskKind, WorkItem } from '../types';
import { clamp, dist, josa, pct } from '../util';
import { hasKit, kitRng, kitUses, kitWorks, medLevelOf, refillAir, seatsOf, seatsUsed, toolUse, useKit } from '../crews';
import { RETRY_AFTER, agentCost, casFact, debrisText, detectRadius, exitName, fitFor, flushOutbox, hosFact, learn, learnQuiet, mateFact, mateStatus, perceive, regionNameAt, resp, staminaF, visionOf, workLabel } from './agents';
import { mkFact } from './beliefs';
import { astar, doorAt, isIndoor, los, staticPass, tileOf, walkableCount } from './grid';
import { applyWater, flashbang, hostageNear, hostileActive, isHeld, placeAtSafe, pushFx, panicShot } from './hazards';
import { coverRoll, fireShot } from './damage';
import { breachHowFor, lastFx, noteCollateral, noteHit, noteShot, recBreach, recCuff, recTaser, weaponOf } from './fxlog';
import { detonate } from './rules/crime';
import { DOWN_AT, careHostile, careResponder, hurtCas, hurtHostile, hurtResponder, initialCause, injuryRng, mustRetreat, needsHospital, treatEffect, treatPlan } from './injury';

export function makeTask(kind: TaskKind, label: string, w: WorkItem | null = null): Task {
  return {
    kind, workId: w ? w.id : -1, region: w ? w.region : -1, cas: w ? w.cas : -1, prop: w ? w.prop : -1, hostile: w ? w.hostile : -1, tile: w ? w.tile : -1, mate: w ? w.mate : -1,
    phase: 0, progress: 0, need: 1, tx: 0, ty: 0, range: 0, pts: null, ptI: 0, covered: null,
    method: undefined, mwhy: undefined, missing: undefined, tried: undefined, entryDoor: undefined, mtry: undefined, mbad: undefined, mt0: undefined, marr: undefined, mcands: undefined,      // (R2) 대응 방법 — 쓰는 것은 단계 1a 부터 (모든 임무가 같은 모양)
    startedAt: 0, selfAssigned: false, thorough: w ? w.thorough : false, wait: 0, sub: null, fails: 0, label, repathAt: 0,
    docRule: undefined, gateAt: -1, gateId: undefined, gateSaid: false, cvX: undefined, cvY: undefined, cvTx: undefined, cvTy: undefined, cvLost: -1,      // (R3) 교본 줄·판단 지점·엄폐 자리 — 쓰는 것은 단계 2 부터 (모든 임무가 같은 모양)
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
        const txt: Record<string, string> = { nopath: '진입 경로를 찾지 못했습니다', fire: '화염으로 접근할 수 없습니다', equip: '장비 문제로 임무를 계속할 수 없습니다', gone: '대상이 더 이상 그 위치에 없습니다', unsafe: '위협이 해소되지 않아 접근할 수 없습니다', full: '차에 환자 자리가 없습니다', nomethod: '쓸 수 있는 방법이 없습니다' };      // nomethod: (R2) 고를 대응 방법이 남지 않았다
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'radio', imp: 1, causes: [a.lastBlockEvent], text: `${workLabel(s, w, sim)} 중단 — ${txt[reason] ?? reason}. 재지시 요청.` });
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
/** 공기통을 바꾸는 데 걸리는 시간(초) */
const SWAP_AIR_TIME = 8;

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

/**
 * escape = 물러나는 길: 불에 막혀 길이 없으면 불길을 뚫고 나가는 길을 찾고, 길 위의 불 앞에서 멈추지 않는다 (관창을 든 대원은 지금처럼 끄며 지나간다).
 * 다친 채 제자리에 서서 타는 것보다 불길을 지나 나오는 편이 낫다 — 지나는 동안의 화상은 그대로 입는다 (sceneManager.agentHealth).
 */
function moveTo(sim: Sim, s: Scene, a: FieldAgent, tx: number, ty: number, range: number, needLos = false, escape = false): MoveRes {
  const t = a.task!;
  const I = sim.incidents[s.incidentId];
  const r = resp(sim, a);
  const goalKey = Math.round(tx) + Math.round(ty) * 64 + Math.round(range * 10) * 4096 + (needLos ? 1 << 20 : 0);
  if (!a.path || a.pathGoal !== goalKey || sim.t >= t.repathAt) {
    a.path = astar(s, a.x, a.y, Math.round(tx), Math.round(ty), range, agentCost(sim, s, a), needLos);
    if (!a.path && escape) a.path = astar(s, a.x, a.y, Math.round(tx), Math.round(ty), range, agentCost(sim, s, a, true, true), needLos);
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
    if (!escape) {
      a.path = null; a.pathGoal = -1;
      t.fails++;
      return t.fails > 3 ? 'nopath' : 'moving';
    }
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
  if (newest !== worst) { const by = resp(sim, newest); emit(sim, { inc: I.id, role: 'RESPONDER', actor: by.name, rid: by.id, kind: 'action', imp: 1, text: `${josa(rw.name, '과/와')} 교대합니다. ${workLabel(s, w, sim)}, 제가 이어서 하겠습니다.` }); }
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

/** eff = 효과 배율(물이 불에 닿는 양), wmul = 물 소모 배율 — (X6 §5.5) 외부 방수는 0.7·1.4 (R2 의 defensive 가 같은 인자를 쓴다) */
function spray(sim: Sim, s: Scene, a: FieldAgent, tx: number, ty: number, eff = 1, wmul = 1): boolean {
  const I = sim.incidents[s.incidentId];
  const r = resp(sim, a), u = sim.units[a.unitId];
  if (u.pumpFailed) { equipTrouble(sim, s, a, 'pump'); return false; }
  if (u.water <= 0 && !u.hydrant) { equipTrouble(sim, s, a, 'water'); return false; }
  applyWater(s, tx, ty, 0.15 * (0.6 + 0.8 * r.skills.fire) * staminaF(r) * sim.dt * eff);
  // 펌프를 맡은 대원(기관원·사다리 조작원)이 차 곁(대기 지점 6칸 안)에서 펌프를 보고 있으면 물을 덜 쓰고 펌프가 덜 닳는다
  const tended = pumpTended(sim, s, a.unitId);
  if (!u.hydrant) u.water = Math.max(0, u.water - 1.5 * (tended ? 0.9 : 1) * wmul * sim.dt);
  u.pumpCond -= 0.0042 * sim.tune.pumpWearMul * (tended ? 0.6 : 1) * sim.dt;
  drain(sim, a, 0.55);
  if (sim.tick % 2 === 0) pushFx(sim, s, 'spray', a.x, a.y, tx + s.rng.range(-0.4, 0.4), ty + s.rng.range(-0.4, 0.4), undefined, undefined, 0.3);
  if (u.pumpCond < 0.2 && !u.pumpFailed) {
    u.pumpFailed = true;
    u.pumpFails = (u.pumpFails ?? 0) + 1;      // (I2) 이번 교대의 펌프 고장 수 — 다음 교대의 정밀 정비를 정한다(persist.makeCarryover). 결과에 쓰지 않는다
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
/** 구출 중 사고 (H1 §5.1): 붕괴 현장에서 구출을 마칠 때의 확률(× 위험 배율 × (1.2 − 쓴 장비의 값))과 그때 잃는 체력. 붕괴 현장이 너무 어려워지면 확률을 줄인다 (§9.3-4) */
export const MISHAP = { p: 0.06, hit: [6, 14] };
/** 덮쳐 제압할 때의 몸싸움 (H1 §4.2 — 단계 4c): 붙잡는 순간 맞서던(state 'fight', 무력화되지 않은) 상대와 양쪽이 이만큼 다친다(타박상). 흉기·몸싸움 손잡이 (§12.2-2) */
export const FIGHT_HIT: readonly [number, number] = [3, 8];
/** 붙잡는 순간 상대가 맞서는가: 맞서던(fight) 상대가 섬광탄·테이저로 무력화되지 않았다. 사건이 끝난 뒤에는 다치지 않는다 */
const fights = (sim: Sim, I: Incident, h: Hostile, was: Hostile['state']): boolean => was === 'fight' && sim.t >= h.stunUntil && I.phase !== 'closed';
/**
 * 몸싸움 끝의 검거 (§4.2): 기록 '○○이 저항해 몸싸움 끝에 검거.'(검거 문구를 대신한다)를 먼저 남기고, 난수는 injury:<현장>:fight 에서 대원 몫 → 용의자 몫 순서로 뽑는다.
 * 대원은 hurtResponder(타박상, 가해자 = 그 용의자), 용의자는 hurtHostile(타박상, 가해자 = 그 대원)
 */
function scuffle(sim: Sim, s: Scene, I: Incident, a: FieldAgent, h: Hostile): void {
  const rng = injuryRng(sim, s, 'fight');
  const toMe = rng.range(FIGHT_HIT[0], FIGHT_HIT[1]), toHim = rng.range(FIGHT_HIT[0], FIGHT_HIT[1]);
  const r = resp(sim, a);
  const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'resolve', imp: 3, text: `${josa(h.label, '이/가')} 저항해 몸싸움 끝에 검거.` });
  hurtResponder(sim, s, I, a, toMe, 'blunt', { by: h.id, byKind: 'hostile', ev });
  hurtHostile(sim, s, I, h, toHim, 'blunt', { by: a.rid, byKind: 'responder', ev });
}
/** 테이저에 맞은 용의자 (§4.2): 감전 2 를 기록한다 — 체력을 1 아래로 내리지 않는다 (무력화가 목적이지 다치게 하는 것이 아니다) */
const TASER_HIT = 2;
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
  const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 2, text: hit ? `테이저 발사 — ${h.label} 무력화.` : '테이저 발사 — 빗나감.' });
  if (hit && h.health > 1) hurtHostile(sim, s, I, h, Math.min(TASER_HIT, h.health - 1), 'electric', { by: a.rid, byKind: 'responder', ev });      // 기록만 남길 만큼 (H1 §4.2)
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
  const struck = !hit && hc && s.rng.chance(0.2) && I.phase !== 'closed' ? hc : null;      // 인질 곁의 용의자를 향해 쏜 빗나간 탄이 인질에게 간다 (판정 흐름의 순서는 예전과 같다: 흔들기 다음)
  const ct = !hit && covered ? coverRoll(sim, s, h.x, h.y, a.x, a.y) : -1;      // 빗나간 탄이 용의자의 엄폐 가구에 맞는가 (파손용 흐름)
  // 탄이 실제로 간 선: 지나간 창이 깨지고 엄폐 가구가 닳는다. 그림은 같은 선을 그 끝(end)까지 그린다
  const end = hit ? fireShot(sim, s, a.x, a.y, h.x, h.y, 'body') : struck ? fireShot(sim, s, a.x, a.y, struck.x, struck.y, 'body') : ct >= 0 ? fireShot(sim, s, a.x, a.y, h.x, h.y, ct) : fireShot(sim, s, a.x, a.y, mx, my, 'miss');
  pushFx(sim, s, 'shot', a.x, a.y, end.x, end.y, undefined, '#ffe08a', 0.25);
  const shot = lastFx(sim, s, 'shot'); noteShot(sim, s, shot, { side: 0, by: a.rid, wpn: weaponOf(sim, a), hit, end, tx: h.x, ty: h.y, tk: 1, target: h.id });
  h.morale -= 0.015;
  if (sim.t >= h.stunUntil) { h.alertUntil = sim.t + 6; h.facing = Math.atan2(a.y - h.y, a.x - h.x); }
  if (struck) {
    // 인질 곁의 용의자를 향해 쏜 빗나간 탄
    const dmg = s.rng.range(22, 34);      // 판정 흐름에서 뽑는 자리는 그대로
    const ev = raiseProblem(sim, I, 'ESCALATION', '교전 중 인질 피격', { role: 'SYSTEM', actor: '현장', rid: r.id, imp: 3, text: `교전 중 빗나간 탄에 인질(구조 대상 ${struck.label})이 다쳤습니다!` }, false);
    hurtCas(sim, s, I, struck, dmg, 'gunshot', { by: r.id, byKind: 'responder', ev, bleed: 0.15, immobile: true });
    noteCollateral(sim, s, shot, struck, a.x, a.y);
  }
  if (!I.problems.some((q) => q.detail === '교전 발생')) {
    I.problems.push({ code: 'ESCALATION', t: sim.t, eventId: emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 3, text: '교전 발생! 대응 사격합니다.' }), detail: '교전 발생', recovered: true, recoveryText: '' });
  }
  if (hit) {
    const dmg = s.rng.range(30, 48);      // 판정 흐름에서 뽑는 자리는 그대로 — 뽑은 값만 hurtHostile 에 넘긴다
    h.morale -= 0.12;
    hurtHostile(sim, s, I, h, dmg, 'gunshot', { by: r.id, byKind: 'responder' });      // 용의자 문턱·출혈·쓰러짐(체력 15 이하 — 그 자리에서 바로)과 그 기록
    pushFx(sim, s, 'hit', h.x, h.y);
    noteHit(lastFx(sim, s, 'hit'), { side: 0, ox: a.x, oy: a.y, tk: 1, target: h.id });
    if (h.health <= DOWN_AT) r.xpGained += 0.004;
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

/** (X6 §5.5) 그 대원이 단계 2 구역(외부 방어 아님)인 그 구획 안에 서 있는가 — 거기서 이미 안에서 진압하던 대원은 안에서 잇는다 */
function insideLevel2(s: Scene, a: FieldAgent, region: number): boolean {
  const ops = s.ops;
  return !!ops && ops.mode !== 'defensive' && regionLevel(ops.zones, region) === 2 && regionAt(s, tileOf(s, a.x, a.y)) === region;
}
/** (X6 §5.5) 서 있는 자리(spot)에서 그 구획의 불 칸 가운데 5.5칸 안·시야선이 닿는 가장 가까운 칸 (-1 = 없음). 진실(불)을 읽는다 — 실행기 */
function exteriorFire(s: Scene, region: number, spot: number): number {
  const w = s.w, sx = spot % w, sy = (spot / w) | 0, tl = s.regions[region].tiles;
  let best = -1, bd = EXT_RANGE + 1e-6;
  for (let q = 0; q < tl.length; q++) {
    const i = tl[q];
    if (s.fire[i] <= 0.05) continue;
    const d = dist(sx, sy, i % w, (i / w) | 0);
    if (d < bd && los(s, sx, sy, i % w, (i / w) | 0)) { bd = d; best = i; }
  }
  return best;
}
/**
 * (X6 §5.5) 외부 방수: 실내가 아니고 단계 3 구역 밖인 자리(구조 위험 때문이면 건물 칸에서 2칸 넘게 떨어진 자리)에서 그 구획의 불 칸에 시야선(창·열린 문·무너진 벽 너머)이
 * 닿는 5.5칸 안으로 가서 효과 0.7·물 1.4배로 쏜다. 창 없는 안쪽 방은 밖에서 끌 수 없다 — 그것이 외부 방어의 실제 결과다.
 * 돌려주는 값: true = 이 틱은 끝(밖에서 했거나 실패로 끝냈다) · false = 밖에서 닿을 자리가 없는데 안에서 해도 되는 단계 2 구역이다(안에서 잇는다)
 */
function runExterior(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, region: number): boolean {
  const ops = s.ops!, r = resp(sim, a), reg = s.regions[region];
  if (!reg) { finishTask(sim, s, a, false, 'nopath'); return true; }
  let lit = false;
  for (const i of reg.tiles) if (s.fire[i] > 0.05) { lit = true; break; }
  if (!lit) {      // 그 구획에 불이 없다: 안에서의 진압 확인과 같다 (밖에서 본 대로 알린다)
    learn(sim, a, mkFact('fire', reg.id, 0, r.name, sim.t, 1, true, `${reg.name} 화재 진압 확인 (외부)`), true, true);
    r.xpGained += 0.003; finishTask(sim, s, a, true); return true;
  }
  const zm = ops.zones.length ? zoneMask(s, ops.zones) : null;
  // 자리 고르기: 처음이거나, 지금 자리에서 불이 보이지 않게 됐거나, 자리가 구역 안이 됐다
  let spot = t.phase === 1 ? Math.round(t.ty) * s.w + Math.round(t.tx) : -1;
  if (spot >= 0 && zm && zm[spot] >= 3) spot = -1;
  if (spot < 0) {
    const far = ops.mode === 'defensive' || ops.zones.some((z) => z.kind === 'bldg' || (z.kind === 'struct' && z.regions.indexOf(region) >= 0));
    const cands = exteriorSpots(s, region, far), order: number[] = [];
    for (let q = 0; q < cands.length; q++) if (!zm || zm[cands[q]] < 3) order.push(cands[q]);
    order.sort((p, q) => dist(a.x, a.y, p % s.w, (p / s.w) | 0) - dist(a.x, a.y, q % s.w, (q / s.w) | 0) || p - q);
    for (const c of order) { const f = exteriorFire(s, region, c); if (f >= 0) { spot = c; t.tile = f; break; } }
    if (spot < 0) {
      // 밖에서 닿을 자리가 없다. 단계 2 구역(외부 방어 아님)이고 들어갈 수 있으면 안에서 한다 — 허락된 일이다. 그 밖은 실패(8초 보류 — 두 번이면 지휘 규칙이 거둔다)
      if (ops.mode !== 'defensive' && regionLevel(ops.zones, region) === 2 && regionReachable(s, ops, region)) return false;
      finishTask(sim, s, a, false, 'nopath'); return true;
    }
    t.phase = 1; t.tx = spot % s.w; t.ty = (spot / s.w) | 0; t.progress = sim.t + 1.6; a.path = null;
  }
  a.label = '외부 방수';
  const m = moveTo(sim, s, a, t.tx, t.ty, 0.6);
  if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return true; }
  if (m !== 'arrived') return true;
  if (t.tile < 0 || s.fire[t.tile] <= 0.05 || sim.t > t.progress) {
    t.tile = exteriorFire(s, region, spot); t.progress = sim.t + 1.6;
    if (t.tile < 0) { t.phase = 0; return true; }      // 이 자리에서는 더 보이지 않는다 — 다음 틱에 다른 자리를 찾는다
  }
  const tx = t.tile % s.w, ty = (t.tile / s.w) | 0;
  a.fx = tx - a.x; a.fy = ty - a.y; a.ring = 1 - s.fire[t.tile];
  if (!spray(sim, s, a, tx, ty, 0.7, 1.4)) finishTask(sim, s, a, false, 'equip');
  void I;
  return true;
}

/**
 * (X6 §5.8) 가스 용기·드럼통의 냉각 (mitigate 의 갈래 — 새 임무 종류 없음): 시야선이 닿는 3.2칸 안으로 가서 물을 뿌린다(밖에서 하면 §5.5 의 자리에서 5.5칸).
 * 열이 0.15 아래로 내려가고 2.5칸 안에 불 0.3 이상이 없으면 끝 — 영구 조치가 아니다(mitigated 를 세우지 않는다. 불이 다시 닿으면 다시 데워진다).
 * 이미 터졌으면 본 대로 다시 알린다 (이미 끝나 있던 일은 조용히 + 강제로 — reportDone)
 */
function runCool(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, p: Prop): void {
  const r = resp(sim, a), u = sim.units[a.unitId];
  const where = regionNameAt(s, p.x, p.y), nm = p.skin === 'drum' ? '드럼통' : '가스 용기';
  if (p.exploded || p.removed) { reportDone(sim, a, mkFact('haz', p.id, { kind: 'gas', active: false, x: p.x, y: p.y }, r.name, sim.t, 1, true, `${nm} 폭발 확인`)); finishTask(sim, s, a, true); return; }
  if (u.pumpFailed || (u.water <= 0 && !u.hydrant)) { equipTrouble(sim, s, a, u.pumpFailed ? 'pump' : 'water'); finishTask(sim, s, a, false, 'equip'); return; }
  let hot = false;
  for (let y = Math.max(0, p.y - 3); y <= Math.min(s.h - 1, p.y + 3) && !hot; y++) for (let x = Math.max(0, p.x - 3); x <= Math.min(s.w - 1, p.x + 3); x++) if (s.fire[y * s.w + x] >= 0.3 && dist(x, y, p.x, p.y) <= 2.5) { hot = true; break; }
  if ((p.heatLoad ?? 0) < 0.15 && !hot) {
    learnQuiet(sim, a, mkFact('sign', SIGN_BASE.vessel + p.id, { kind: 'vessel', level: 0, region: regionAt(s, tileOf(s, p.x, p.y)), x: p.x, y: p.y, prop: p.id, down: true }, r.name, sim.t, 1, true, `${where} ${nm} 열기 가라앉음`));
    emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, text: `${nm === '드럼통' ? '드럼통' : '가스 용기'} 냉각 완료. 폭발 위험을 낮췄습니다.` });
    r.xpGained += 0.003;
    finishTask(sim, s, a, true);
    return;
  }
  const out = opsExterior(s, regionAt(s, tileOf(s, p.x, p.y))) && !isIndoor(s.tiles[tileOf(s, a.x, a.y)]);
  const m = moveTo(sim, s, a, p.x, p.y, out ? EXT_RANGE : 3.2, true);
  if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
  if (m !== 'arrived') return;
  a.fx = p.x - a.x; a.fy = p.y - a.y; a.label = `${nm} 냉각`;
  a.ring = 1 - Math.min(1, p.heatLoad ?? 0);
  if (!spray(sim, s, a, p.x, p.y, out ? 0.7 : 1, out ? 1.4 : 1)) finishTask(sim, s, a, false, 'equip');
}

/**
 * (X6 §5.1) 철수 이동: 단계 3 구역 밖이고 건물 칸에서 2칸 넘게 떨어진 바깥 칸(대개 대기 지점)으로 간다 — 물러나는 길이라 불길도 뚫는다(후퇴와 같다).
 * 닿으면 인원 점검 응답(ops 100 + rid)을 조용히 보낸다. 길이 없으면 2초 기다렸다 다시 찾는다(잔해는 지금의 "장애물 발견 → 치우기"로 뚫는다)
 */
function runEvacuate(sim: Sim, s: Scene, a: FieldAgent, t: Task): void {
  const ops = a.beliefs.val<OpsFact>('ops', OPS_ID);
  const zones: ZoneLike[] = ops && ops.zones ? ops.zones.slice() : [];
  if (a.avoid && a.avoid.until > sim.t) zones.push({ level: 3, regions: a.avoid.regions, x: a.avoid.x, y: a.avoid.y, r: a.avoid.r });
  const pt = evacPoint(s, zones);
  const m = moveTo(sim, s, a, pt.x, pt.y, 1.6, false, true);
  if (m === 'arrived') {
    const r = resp(sim, a);
    finishTask(sim, s, a, true);
    learnQuiet(sim, a, mkFact('ops', OPS_PAR + a.rid, { par: true, t: sim.t }, r.name, sim.t, 1, true, `${r.name} 철수 완료`));
    a.label = '철수 완료';
  } else if (m === 'nopath') { a.path = null; t.wait = 2; }
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
      if (!spray(sim, s, a, tx, ty)) {
        t.sub = null;
        if (t.kind === 'swapAir') a.equipRetryAt = sim.t + RETRY_AFTER;      // 길의 불을 끄지 못해 대기 지점에 닿지 못했다: 공기통 교체는 한동안 다시 시도하지 않는다 (아래 case 'swapAir' 의 nopath 와 같은 기억)
        finishTask(sim, s, a, false, 'equip');
      }
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
      // (X6 §5.5) 외부 방어·진입 금지 구역·단계 3 구역 너머: 밖에서 방수한다. 단계 2 구역 안에서 이미 진압하던 대원은 안에서 잇는다
      if (opsExterior(s, t.region) && !(t.phase === 2 && insideLevel2(s, a, t.region))) { if (runExterior(sim, s, I, a, t, t.region)) return; }
      if (t.phase === 1) { t.tile = -1; a.path = null; }      // 밖에서 하다 안으로 (구역이 풀렸거나, 단계 2 구역인데 밖에서 닿을 자리가 없다)
      t.phase = 2;      // 안에서 한다
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
      // (R2 1a) 방법(손·장대·구명환·구명줄·즉석 부력물·하류 차단 …)을 골라 실행한다 — 고르는 것은 판단부(methods.chooseMethod), 효과·판정·완료 기록은 실행부(methodRun)
      runWaterRescue(sim, s, I, a, t, XK);
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
      const tool = toolUse(sim, a.rid, 'extricate', I);
      const rate = r.skills.rescue * (0.35 + 0.65 * tool) * staminaF(r) * (s.smoke[tileOf(s, a.x, a.y)] > 0.4 ? 0.7 : 1);
      c.trapWork -= rate * dt; drain(sim, a, 0.8);
      a.ring = clamp(1 - c.trapWork / 16, 0.05, 1);
      if (c.trapWork <= 0) {
        c.mob = 'immobile'; c.tFreed = sim.t;
        if (c.inVehicle !== null) { c.inVehicle = null; c.x = Math.round(a.x); c.y = Math.round(a.y); }
        // 구출 중 사고 (H1 §5.1): 붕괴 현장에서 구출을 마칠 때 잔해가 내려앉아 더 다칠 수 있다 — 장비가 좋을수록 드물다. 난수는 목적별 흐름 injury:<현장>:extricate.
        // 승강기 갇힘에는 잔해가 없다. 판정 뒤에는 일어나지 않는다 (§2.6)
        if (s.kind === 'collapse' && s.variant !== 'elevator' && I.phase !== 'closed') {
          const xr = injuryRng(sim, s, 'extricate');
          if (xr.chance(MISHAP.p * sim.tune.hazardMul * (1.2 - tool))) {
            const ev = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 2, causes: [c.causeEvent], text: `구출 도중 잔해가 내려앉아 구조 대상 ${josa(c.label, '이/가')} 더 다쳤습니다.` });
            hurtCas(sim, s, I, c, xr.range(MISHAP.hit[0], MISHAP.hit[1]), 'crush', { ev });
          }
        }
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
      // 처치의 질과 효과는 세 부류가 같은 식을 쓴다 (injury.treatPlan·treatEffect — 제세동기·의사 장비의 보정 포함).
      // 다시 볼 가치가 있는지는 든 장비로 어림하고(treatPlan — hasKit), 효과는 처치를 마칠 때 준다(treatEffect — 숨은 고장은 그때 드러난다)
      const qPlan = treatPlan(sim, s, a.rid, c.health);
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
        const fx = treatEffect(sim, s, I, a.rid, c.health, c.treated ? c.treatQ : -1);
        // 제세동기가 듣지 않아 앞선 처치보다 나아진 것이 없다: 상태만 다시 알리고 끝낸다 (처치의 수준을 낮추지 않는다)
        if (!fx) { learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, true); return; }
        if (fx.heal > 0) c.health = Math.min(100, c.health + fx.heal);
        c.treated = true; if (c.tTreated < 0) c.tTreated = sim.t; c.treatQ = fx.q; c.bleed = c.bleed0 * fx.bleedK; c.bystander = false;
        learnQuiet(sim, a, casFact(sim, s, c, r.name));
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: fx.q < 0.6 ? `구조 대상 ${c.label} 기본 응급 처치 완료. 전문 처치가 필요합니다.` : `구조 대상 ${c.label} 전문 응급 처치 완료.` });
        r.xpGained += 0.003;
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'carry': case 'escort': {
      const c = s.casualties[t.cas];
      if (c.dead || c.where === 'safe' || c.where === 'loaded' || c.where === 'hospital') { learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, true); return; }
      // 갇혔다(맡은 뒤에 2차 붕괴로 갇힌 사람 등): 옮길 수 없다. 지휘관의 믿음이 '거동 불가'로 남아 같은 지시를 되풀이하지 않게 다시 알린다 (낡은 믿음)
      if (c.mob === 'trapped') { learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, false, 'gone'); return; }
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
      // 더해진 악화는 그 상처의 원인으로 적는다 (매 틱 피해)
      if ((s.kind === 'traffic' || s.kind === 'collapse') && c.tFreed >= 0 && !c.dead && !carryHas(sim, s, a, 'spineBoard')) hurtCas(sim, s, I, c, c.bleed * 0.12 * dt, c.bleedCause ?? initialCause(s, I, c), { tick: true });
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
      if (a.carrying !== c.id && seatsUsed(sim, u) >= seatsOf(u)) { finishTask(sim, s, a, false, 'full'); return; }
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
        if (seatsUsed(sim, u) >= seatsOf(u)) { c.where = 'safe'; placeAtSafe(s, c); a.carrying = -1; finishTask(sim, s, a, false, 'full'); return; }
        c.where = 'loaded'; c.tLoaded = sim.t; a.carrying = -1; u.patients.push(c.id); u.patientsIncident = I.id;
        u.firstLoadAt ??= sim.t;      // 이번 이송에 처음 사람을 태운 시각 (지휘관의 출발 판단이 읽는다 — commander.manageAmbulances)
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
      if (t.prop < 0) {
        // (X6 §5.7) 가스 재측정: 그 구획의 문턱 칸에 가서 1초 서 있는다 — 읽기는 perceive 의 조짐 관찰(perceiveSigns)이 한다
        const m = moveTo(sim, s, a, t.tile % s.w, (t.tile / s.w) | 0, 0.5);
        if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (m !== 'arrived') return;
        if (t.progress === 0) perceive(sim, s, a);
        t.progress += dt; a.ring = t.progress;
        if (t.progress >= 1) { perceive(sim, s, a); finishTask(sim, s, a, true); }
        return;
      }
      const p = s.props[t.prop];
      if (p.kind === 'gas') { runCool(sim, s, I, a, t, p); return; }      // (X6 §5.8) 가스 용기·드럼통의 냉각
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
        if (!hostileActive(h) || h.state === 'surrendered' || h.state === 'flee') { learn(sim, a, hosFact(sim, s, h, r.name, dist(a.x, a.y, h.x, h.y)), true, true); finishTask(sim, s, a, true); return; }
        if (h.state === 'fight') { a.label = '엄폐 (협상 중단)'; return; }
        const k = 0.0125 * (0.4 + 0.6 * (r.composure + r.experience) / 2) * (1.25 - h.aggression) * (kitWorks(sim, a.rid, 'megaphone', I) ? 1.2 : 1);      // 확성기로 말하면 더 잘 닿는다
        h.negot += dt; h.morale -= k * dt;
        t.progress += dt; a.ring = clamp(1 - (h.morale - 0.2) / 0.6, 0, 1);
        if (t.phase === 0) { t.phase = 1; emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `${josa(h.label, '과/와')} 협상을 시도합니다.` }); }
        else if (t.phase === 1 && h.morale < 0.42) { t.phase = 2; emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `${josa(h.label, '이/가')} 동요하고 있습니다. 협상을 계속합니다.` }); }
        else if (t.phase === 1 && t.progress > 30 && h.aggression > 0.6) { t.phase = 3; emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'radio', imp: 1, text: `${josa(h.label, '이/가')} 협상에 응하지 않습니다.` }); }
      } else a.label = s.kind === 'hazmat' ? '출입구 통제' : `${exitName(s, t.tile)} 봉쇄`;
      return;
    }
    case 'engage': {
      const h = s.hostiles[t.hostile];
      if (!hostileActive(h) || h.state === 'surrendered') { learn(sim, a, hosFact(sim, s, h, r.name, dist(a.x, a.y, h.x, h.y)), true, true); finishTask(sim, s, a, true); return; }
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
            learnQuiet(sim, a, hosFact(sim, s, h, r.name, dist(a.x, a.y, h.x, h.y)));
            if (fights(sim, I, h, was)) scuffle(sim, s, I, a, h);      // 맞서던 상대: 몸싸움 끝에 (H1 단계 4c)
            else emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'resolve', imp: 3, text: `${h.label} 검거!` });
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
            learnQuiet(sim, a, hosFact(sim, s, h, r.name, dist(a.x, a.y, h.x, h.y)));
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
            learnQuiet(sim, a, hosFact(sim, s, h, r.name, dist(a.x, a.y, h.x, h.y)));
            emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'resolve', imp: 3, text: `${josa(h.label, '을/를')} 곁에서 덮쳐 제압·검거!` });
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
      if (h.state === 'arrested' || h.state === 'escaped' || h.state === 'down') { learn(sim, a, hosFact(sim, s, h, r.name, dist(a.x, a.y, h.x, h.y)), true, true); finishTask(sim, s, a, true); return; }
      if (h.state !== 'surrendered' && h.weapon === 'gun') { finishTask(sim, s, a, false, 'unsafe'); return; }
      if (tryTaser(sim, s, a, h)) { a.label = '테이저 발사'; return; }      // 덤벼드는 상대(총이 아닌)에게 테이저 — 쏜 틱에는 움직이지 않는다
      if (!docGate(sim, s, a, 'closeIn').ok) return;      // (R3) 판단 지점 closeIn — 단계 0 은 줄이 없어 늘 통과. 2단계가 기다리는 자리(1.8·3칸)·상한·기록을 채운다
      const m = moveTo(sim, s, a, h.x, h.y, 1.3);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      t.need = h.state === 'surrendered' ? 2.5 : 5; t.progress += dt; a.ring = t.progress / t.need;
      if (t.progress >= t.need) {
        const was = h.state;
        h.state = 'arrested';
        learnQuiet(sim, a, hosFact(sim, s, h, r.name, dist(a.x, a.y, h.x, h.y)));
        if (fights(sim, I, h, was)) scuffle(sim, s, I, a, h);      // 맞서던 상대: 몸싸움 끝에 (H1 단계 4c)
        else emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'resolve', imp: 3, text: `${h.label} 검거 완료.` });
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
      if (!b || b.status !== 'down') {
        // 더는 쓰러져 있지 않다(누가 먼저 옮겼다, 자기 부대와 함께 떠났다): 지휘관의 믿음이 낡아 다시 지시한 것이므로 본 대로 다시 알린다 (소리 없이, 강제로)
        if (b) {
          const f = mateFact(sim, s, b, mateStatus(sim, b), r.name, dist(a.x, a.y, b.x, b.y));
          const cur = a.beliefs.val<MateBelief>('mate', b.rid);
          if (cur && cur.dead) { f.value.dead = true; f.value.band = 3; }      // 숨진 줄 알던 것을 먼 관찰로 되돌리지 않는다
          reportDone(sim, a, f);
        }
        finishTask(sim, s, a, true); return;
      }
      // 물 위의 동료는 끌어낼 수 없다: 뭍으로 옮겨질 때까지 기다린다 (실패로 끝내면 보류와 재지시가 되풀이된다 — R2 의 규칙이 뭍으로 옮긴다)
      if (s.tiles[tileOf(s, b.x, b.y)] === T.WATER) { a.label = '물가 대기'; return; }
      if (a.carrying !== -(b.rid + 2)) {
        const m = moveTo(sim, s, a, b.x, b.y, 1.3);
        if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (m !== 'arrived') return;
        if ((b.trapped ?? 0) > 0) {
          // (X6 §4.8) 잔해에 깔린 동료: 먼저 잔해를 들어내 빼낸다 (구출과 같은 식 — 숨은 고장은 이 효과 자리에서 드러난다). 빠지면 아래처럼 끌고 나온다
          a.fx = b.x - a.x; a.fy = b.y - a.y; a.label = '깔린 동료 구출';
          const tool = toolUse(sim, a.rid, 'extricate', I);
          b.trapped = Math.max(0, b.trapped! - r.skills.rescue * (0.35 + 0.65 * tool) * staminaF(r) * dt);
          drain(sim, a, 0.8);
          if (b.trapped > 0) return;
          b.label = '쓰러짐';
          emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 2, text: `잔해에 깔린 ${sim.responders[b.rid].name} 대원을 빼냈습니다. 안전 구역으로 옮깁니다.` });
          learnQuiet(sim, a, mateFact(sim, s, b, 'down', r.name, 0));      // 곁에서 본다 — 이제 깔려 있지 않다 (지휘관이 같은 구출을 다시 내지 않게)
        }
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
        const br = sim.responders[b.rid];
        if (br.dead) b.label = '';
        learnQuiet(sim, a, mateFact(sim, s, b, 'safe', r.name, 0));      // 끌고 온 대원은 곁에서 본다 (숨졌는지·중증도까지)
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, text: br.dead ? `순직한 ${br.name} 대원을 안전 구역으로 옮겼습니다.` : `쓰러진 ${br.name} 대원을 안전 구역으로 옮겼습니다.` });
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'treatMate': {
      // 다친 동료의 처치와 후송 (H1 §3.4-2). 처치는 구조 대상과 같은 식(injury.treatEffect)이다.
      // 태울 차(w.prop)가 내 차이고 자리가 있고 그 동료가 병원이 필요하면, 처치에 이어 차까지 데려가 태운다 — 물러난 대원은 스스로 움직이지 않으므로 내가 끌고 간다.
      // 병원이 필요 없는 동료는 태우지 않는다: 그래야 그 대원이 가벼운 일로 돌아온다 (§3.6a)
      const b = agentById(s, t.mate);
      const br = b ? sim.responders[b.rid] : null;
      // 처치할 수 없는 상태 — 차에 탔다 · 숨졌다 · 아직 쓰러져 있다(구조가 먼저다) · 걸어 다닌다(가벼운 일로 돌아왔다): 지휘관의 믿음이 낡았으므로 본 대로 다시 알리고 끝낸다
      if (!b || !br || b.status === 'left' || br.dead || b.status === 'down' || (b.status === 'active' && !mustRetreat(br))) {
        if (b) reportDone(sim, a, mateFact(sim, s, b, mateStatus(sim, b), r.name, dist(a.x, a.y, b.x, b.y) <= 2 ? 0 : dist(a.x, a.y, b.x, b.y)));
        finishTask(sim, s, a, true); return;
      }
      if (b.status === 'active') {
        // 아직 걸어서 물러나는 중이다: 대기 지점 곁에서 기다린다 (움직이는 사람을 쫓지 않는다)
        a.label = '부상 대원 대기';
        if (moveTo(sim, s, a, s.staging.x, s.staging.y, 2.5) === 'nopath') finishTask(sim, s, a, false, 'nopath');
        return;
      }
      if (t.phase === 0) {
        // ① 처치. 이미 받은 처치보다 0.15 넘게 나은 처치를 할 수 있을 때만 다시 한다 (구조 대상의 처치와 같다)
        const had = (br.treatQ ?? 0) > 0;
        if (had && treatPlan(sim, s, a.rid, br.health) <= (br.treatQ ?? 0) + 0.15) { t.phase = 1; t.progress = 0; return; }
        const m = moveTo(sim, s, a, b.x, b.y, 1.3);
        if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (m !== 'arrived') return;
        a.fx = b.x - a.x; a.fy = b.y - a.y;
        t.need = 4.5 + (br.health < 40 ? 4 : br.health < 70 ? 2 : 0);
        t.progress += Math.max(0.1, r.skills.medical * (0.5 + 0.5 * medLevelOf(sim, a.rid))) * staminaF(r) * dt; a.ring = t.progress / t.need; drain(sim, a, 0.3);
        if (t.progress < t.need) return;
        const fx = treatEffect(sim, s, I, a.rid, br.health, had ? (br.treatQ ?? 0) : -1);
        if (fx) {
          careResponder(br, fx);
          learnQuiet(sim, a, mateFact(sim, s, b, 'safe', r.name, 0));      // 처치한 대원은 곁에서 본다 (중증도·출혈·처치 수준까지)
          emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, causes: [b.hurtEv ?? -1], text: `${br.name} 대원 응급 처치 완료.` });
          r.xpGained += 0.003;
        }
        t.phase = 1; t.progress = 0;
        return;
      }
      if (t.phase === 1) {
        // ② 태울 것인가: 병원이 필요하고, 태울 차가 내 차이고, 자리가 남았을 때만
        if (!needsHospital(br) || !w || w.prop !== a.unitId || seatsUsed(sim, u) >= seatsOf(u)) {
          reportDone(sim, a, mateFact(sim, s, b, 'safe', r.name, 0));
          finishTask(sim, s, a, true); return;
        }
        const m = moveTo(sim, s, a, b.x, b.y, 1.3);
        if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (m !== 'arrived') return;
        t.progress += dt;
        if (t.progress >= 1.2) { t.phase = 2; t.progress = 0; a.path = null; a.pathGoal = -1; if (br.tDown !== undefined) a.carrying = -(b.rid + 2); }      // 쓰러졌던 대원은 들것으로
        return;
      }
      // ③ 차까지 데려가 태운다
      a.label = '부상 대원 후송';
      const m = moveTo(sim, s, a, s.staging.x, s.staging.y, 1.2);
      b.x = a.x - a.fx * 0.5; b.y = a.y - a.fy * 0.5;
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      t.progress += dt;
      if (t.progress < 1.2) return;
      a.carrying = -1;
      // 실을 때 자리를 다시 본다 (그 사이에 다른 환자가 실렸다): 대기 지점 곁에 그대로 두고 지휘관에게 알린다
      if (seatsUsed(sim, u) >= seatsOf(u)) { reportDone(sim, a, mateFact(sim, s, b, 'safe', r.name, 0)); finishTask(sim, s, a, false, 'full'); return; }
      b.status = 'left'; b.task = null; b.label = ''; br.care = 'aboard';
      (u.aboard ??= []).push({ kind: 'mate', id: b.rid, inc: I.id, t: sim.t });
      u.firstLoadAt ??= sim.t;
      reportDone(sim, a, mateFact(sim, s, b, 'evac', r.name, 0));      // 강제 보고 (무전 문구는 아래 기록이 대신한다)
      emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 2, causes: [b.hurtEv ?? -1], text: `${br.name} 대원 ${u.callsign}에 탑승 — 병원 후송.` });
      // 그 대원이 자기 부대에서 현장에 남은 마지막 사람이었으면 그 부대를 철수시킨다. 그러지 않으면 그 차량은 지시를 받을 사람이 없어 교대 끝까지 현장에 남는다
      if (!s.agents.some((q) => q.unitId === b.unitId && q.status !== 'left')) { const bu = sim.units[b.unitId]; if (!bu.boardOrder) bu.boardOrder = 'release'; }
      finishTask(sim, s, a, true);
      return;
    }
    case 'treatSuspect': {
      // 쓰러진·다친 용의자의 처치와 이송 (H1 §4.3). 처치는 세 부류가 같은 식(injury.treatEffect)이다.
      // 태울 차(w.prop)가 내 차이고 자리가 있으면, 처치에 이어 차까지 옮겨 태운다 — 쓰러진 용의자는 스스로 움직이지 않으므로 내가 옮긴다 (좌표를 내 뒤에 붙인다).
      // 호송은 모델하지 않는다(결정): 경찰은 처치까지, 이송은 구급차가 한다
      const h = s.hostiles[t.hostile];
      const d0 = dist(a.x, a.y, h.x, h.y);
      // 숨졌다: 숨진 것은 곁(2칸 안)에서만 알 수 있다 — 멀리서 본 대로 알리면 지휘관은 여전히 처치가 필요한 줄 알고 같은 지시를 되풀이한다 (낡은 믿음). 가서 보고 알린다
      if (h.dead && (h.where ?? 'scene') === 'scene' && d0 > 2) {
        const m = moveTo(sim, s, a, h.x, h.y, 1.5);
        if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (m !== 'arrived') return;
      }
      // 처치할 수 없는 상태 — 숨졌다 · 차에 실렸다 · 달아났다 · 아직 맞서고 있다: 지휘관의 믿음이 낡았으므로 본 대로 다시 알리고 끝낸다
      if (h.dead || (h.where ?? 'scene') !== 'scene' || h.state === 'escaped' || h.state === 'hold' || h.state === 'fight' || h.state === 'flee') {
        // 차에 실려 간 용의자도 알린다(있는 곳 where 가 '차에 실림'으로 간다): 실은 대원의 보고가 늦게 닿거나 음영 구역에서 사라지면, 알리지 않고 끝내는 한 지휘관은 같은 지시를 되풀이한다 (CLAUDE.md "이미 끝나 있던 일은 조용히 + 강제로 보고한다")
        reportDone(sim, a, hosFact(sim, s, h, r.name, dist(a.x, a.y, h.x, h.y)));
        finishTask(sim, s, a, true); return;
      }
      if (t.phase === 0) {
        // ① 처치. 이미 받은 처치보다 0.15 넘게 나은 처치를 할 수 있을 때만 다시 한다 (구조 대상·다친 대원의 처치와 같다). 다친 데가 없으면(중상 아래이고 피도 거의 없다) 할 것이 없다
        const had = (h.treatQ ?? 0) > 0;
        if ((had && treatPlan(sim, s, a.rid, h.health) <= (h.treatQ ?? 0) + 0.15) || (h.tDown === undefined && h.health > 70 && (h.bleed ?? 0) < 0.01)) { t.phase = 1; t.progress = 0; return; }
        const m = moveTo(sim, s, a, h.x, h.y, 1.3);
        if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (m !== 'arrived') return;
        a.fx = h.x - a.x; a.fy = h.y - a.y;
        t.need = 4.5 + (h.health < 40 ? 4 : h.health < 70 ? 2 : 0);
        t.progress += Math.max(0.1, r.skills.medical * (0.5 + 0.5 * medLevelOf(sim, a.rid))) * staminaF(r) * dt; a.ring = t.progress / t.need; drain(sim, a, 0.3);
        if (t.progress < t.need) return;
        if (h.dead) { reportDone(sim, a, hosFact(sim, s, h, r.name, 0)); finishTask(sim, s, a, true); return; }      // 처치하는 동안 숨졌다
        const fx = treatEffect(sim, s, I, a.rid, h.health, had ? (h.treatQ ?? 0) : -1);
        if (fx) {
          careHostile(sim, h, fx);
          learnQuiet(sim, a, hosFact(sim, s, h, r.name, 0));      // 처치한 대원은 곁에서 본다 (중증도·처치 수준까지)
          emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `${h.label} 응급 처치 완료.` });
          r.xpGained += 0.003;
        }
        t.phase = 1; t.progress = 0;
        return;
      }
      if (t.phase === 1) {
        // ② 태울 것인가: 태울 차가 내 차이고 자리가 남았을 때만 (그 차를 고른 것은 지휘관이다 — 더 무겁거나 같은 사람이 기다리지 않을 때만 정한다)
        if (!w || w.prop !== a.unitId || seatsUsed(sim, u) >= seatsOf(u)) { reportDone(sim, a, hosFact(sim, s, h, r.name, d0)); finishTask(sim, s, a, true); return; }
        const m = moveTo(sim, s, a, h.x, h.y, 1.3);
        if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (m !== 'arrived') return;
        t.progress += dt;
        if (t.progress >= 1.2) { t.phase = 2; t.progress = 0; a.path = null; a.pathGoal = -1; }
        return;
      }
      // ③ 차까지 옮겨 태운다 (들것 — a.carrying 은 쓰지 않는다: 그 칸은 구조 대상 id 와 대원 −(rid+2) 만 담는다)
      a.label = '용의자 이송';
      const m = moveTo(sim, s, a, s.staging.x, s.staging.y, 1.2);
      h.x = a.x - a.fx * 0.5; h.y = a.y - a.fy * 0.5;
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      t.progress += dt;
      if (t.progress < 1.2) return;
      // 실을 때 자리를 다시 본다 (그 사이에 다른 환자가 실렸다): 그대로 두고 지휘관에게 알린다
      if (seatsUsed(sim, u) >= seatsOf(u)) { reportDone(sim, a, hosFact(sim, s, h, r.name, 0)); finishTask(sim, s, a, false, 'full'); return; }
      h.where = 'aboard';
      (u.aboard ??= []).push({ kind: 'suspect', id: h.id, inc: I.id, t: sim.t });
      u.firstLoadAt ??= sim.t;
      reportDone(sim, a, hosFact(sim, s, h, r.name, 0));      // 강제 보고 (무전 문구는 아래 기록이 대신한다)
      emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 2, text: `${josa(h.label, '을/를')} ${u.callsign}에 태워 병원으로.` });
      finishTask(sim, s, a, true);
      return;
    }
    // (N8 단계 2a) 새 임무 다섯의 빈 갈래 — 실행은 그 임무를 쓰는 단계가 채운다(repair·cordon 4a · capture 5 · towAway 6b · persuade 7, 설계서 §4·§5.9·§5.10).
    // 지금은 아무도 이 작업을 만들지 않고 fitFor 가 0 이라 닿지 않는다. 닿으면 내려놓는다 (임무를 쥔 채 제자리에 서 있지 않게)
    case 'repair': case 'towAway': case 'capture': case 'persuade': case 'cordon': {
      finishTask(sim, s, a, false, 'preempt');
      return;
    }
    // (N9 단계 1) 제독의 빈 갈래 — 실행(제독 자리로 데려가 15·30·45초)은 단계 6 이 채운다(설계서 §5.5). 지금은 아무도 이 작업을 만들지 않고 fitFor 가 0 이라 닿지 않는다.
    // 닿으면 내려놓는다 (임무를 쥔 채 제자리에 서 있지 않게)
    case 'decontam': {
      finishTask(sim, s, a, false, 'preempt');
      return;
    }
    case 'evacuate': runEvacuate(sim, s, a, t); return;      // (X6 §5.1) 철수 이동
    case 'retreat': {
      const m = moveTo(sim, s, a, s.staging.x, s.staging.y, 2, false, true);      // 물러나는 길은 불길도 뚫는다
      if (m === 'arrived') {
        // 물러나야 하는 몸(체력 40 아래, 또는 출혈이 크고 70 아래)이면 대기 지점에서 후송을 기다린다. 안전 구역에 닿았음을 스스로 알린다 —
        // 물러난 대원은 더 판단하지 않으므로(think 를 돌지 않는다) 보고 대기열을 이 자리에서 비운다
        const out = mustRetreat(r);
        if (out) { a.status = 'withdrawn'; a.label = '부상 — 후송 대기'; }
        finishTask(sim, s, a, true);
        if (out) { learnQuiet(sim, a, mateFact(sim, s, a, 'safe', r.name, 0)); flushOutbox(sim, s, a); }
      } else if (m === 'nopath') {
        // 불길을 뚫는 길조차 없다(사방이 막혔다). 위험해서 물러나던 대원은 예전처럼 그만두고 다시 판단한다.
        // 다친 대원은 그 자리에서 길이 열리기를 기다리며 5초마다 다시 찾는다 — 제자리에서 '후송 대기'가 되지 않는다(그곳은 안전 구역이 아니다)
        if (!mustRetreat(r)) { finishTask(sim, s, a, true); return; }
        if (t.phase === 0) {
          t.phase = 1;
          emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'radio', imp: 2, causes: [a.hurtEv ?? -1], text: '퇴로가 막혀 나갈 수 없습니다. 길이 열리기를 기다립니다.' });
        }
        t.wait = 5;
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
        // 복구하는 것은 이 부대의 펌프 고장이다. 개인 장비의 고장도 같은 문제 코드라서, 가장 최근 것을 그냥 복구 처리하면
        // 고장 난 유압 구조기가 "예비 장비로 교체"된 것으로 보고서에 남는다 — 펌프 고장 기록만 찾는다
        let pe = -1;
        for (let k = I.problems.length - 1; k >= 0; k--) {
          const p = I.problems[k];
          if (p.code === 'EQUIP_FAIL' && !p.recovered && p.detail.startsWith(`${u.callsign} 펌프 고장`)) { p.recovered = true; p.recoveryText = `${josa(r.name, '이/가')} 예비 장비로 교체`; pe = p.eventId; break; }
        }
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, causes: [pe], text: `예비 펌프로 교체 완료. ${u.callsign} 방수 재개 가능.` });
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'swapAir': {
      // 공기통 교체: 대기 지점(차 곁)으로 나가 차에 실은 예비 공기통으로 바꾼다. 닿지 못하면 그만두고 한동안 다시 시도하지 않는다
      const m = moveTo(sim, s, a, s.staging.x, s.staging.y, 1.6);
      if (m === 'moving' || m === 'busy') return;
      if (m === 'nopath') { a.equipRetryAt = sim.t + RETRY_AFTER; finishTask(sim, s, a, false); return; }
      t.need = SWAP_AIR_TIME; t.progress += dt; a.ring = t.progress / t.need;
      if (t.progress >= t.need) {
        // 예비가 남아 있을 때만 바꾼다 (오는 동안 같은 부대의 다른 대원이 마지막 통을 썼으면 그대로 돌아간다)
        if ((u.spareAir ?? 0) > 0) {
          u.spareAir = (u.spareAir ?? 0) - 1; refillAir(sim, a.rid);
          emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 0, text: `공기통 교체 완료 (${u.callsign} 예비 ${u.spareAir}개).` });
        }
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
  if (a.status === 'withdrawn' && (!a.task || a.task.kind !== 'board')) { const r = sim.responders[a.rid]; a.label = r.dead ? '' : (r.treatQ ?? 0) > 0 ? '처치 받음 — 후송 대기' : '부상 — 후송 대기'; return; }
  if (!a.task) { a.label = sim.responders[a.rid].status === 'injured' ? '부상 — 가벼운 일' : '지시 대기'; a.ring = 0; a.inCover = false; return; }
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

// ── (R2) 방법의 실행부(field/methodRun.ts)에 건네는 도구 — methodRun 은 이 파일을 import 하지 않는다(순환). 지휘 규칙의 CommandKit 과 같은 방식이다.
//    단계 1a: case 'waterRescue' 가 runWaterRescue(sim, s, I, a, t, XK) 로 쓴다.
//    (import 를 파일 끝에 둔 것은 위의 import 묶음을 다른 묶음이 함께 고치고 있어서다 — methodRun 의 함수는 실행할 때만 부르므로 순서와 무관하다) ──
import type { ExecKit } from './methodRun';
import { runWaterRescue } from './methodRun';
export const XK: ExecKit = { moveTo, finish: finishTask, drain, spray, makeTask };

// ── (R3) 대응 교본의 판단 지점 (field/doctrine.ts 의 docGate — 자기 모드). 판단은 교본 함수가, 효과(이동·기다림)는 이 파일이 한다 ──
import { docGate } from './doctrine';

// ── (X6 단계 5) 지휘 상태의 도움 함수 (진입 금지 구역·외부 방수 자리·철수 지점 — ops.ts 는 진실을 읽지 않는다. 불을 고르는 것은 이 파일이다) ──
import { EXT_RANGE, OPS_ID, OPS_PAR, SIGN_BASE, evacPoint, exteriorSpots, opsExterior, regionAt, regionLevel, regionReachable, zoneMask } from './ops';
import type { OpsFact, ZoneLike } from './ops';
