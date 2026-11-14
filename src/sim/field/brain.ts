// AgentBrain — 대원 한 명의 판단 주기.
//   Perception → Belief Update → Goal Selection(Utility) → Task Planning → (Executor 가 실행) → 결과 평가 → Communication → Replanning
// 행동 후보마다 점수를 매겨 가장 높은 것을 고른다. 판단력이 낮은 대원은 점수 추정에 오차가 크다.

import type { Sim } from '../engine';
import { emit, raiseProblem } from '../events';
import type { Candidate, CasBelief, FieldAgent, Scene, WorkItem } from '../types';
import { dist } from '../util';
import { fitFor, flushOutbox, perceive, resp, shareNearby, workLabel } from './agents';
import { commanderThink } from './commander';
import { finishTask, makeTask } from './executor';
import { tileOf } from './grid';

interface Option { label: string; score: number; apply: (() => void) | null }

function takeWork(sim: Sim, s: Scene, a: FieldAgent, w: WorkItem, self: boolean): void {
  if (a.task) finishTask(sim, s, a, false, 'preempt');
  const t = makeTask(w.kind, workLabel(s, w), w);
  t.startedAt = sim.t; t.selfAssigned = self;
  a.task = t; a.orderWork = w.id;
  if (w.assignees.indexOf(a.rid) < 0) w.assignees.push(a.rid);
  if (w.status === 'open') w.status = 'active';
  w.orderSentAt[a.rid] = sim.t;
}

function setTask(sim: Sim, s: Scene, a: FieldAgent, kind: Parameters<typeof makeTask>[0], label: string): void {
  if (a.task) finishTask(sim, s, a, false, 'preempt');
  const t = makeTask(kind, label);
  t.startedAt = sim.t;
  a.task = t;
}

function dangerScore(sim: Sim, s: Scene, a: FieldAgent): number {
  const r = resp(sim, a);
  if (r.health < 40) return 1.4;
  let u = 0;
  const ax = Math.round(a.x), ay = Math.round(a.y);
  let f = 0;
  for (let y = Math.max(0, ay - 1); y <= Math.min(s.h - 1, ay + 1); y++) for (let x = Math.max(0, ax - 1); x <= Math.min(s.w - 1, ax + 1); x++) f = Math.max(f, s.fire[y * s.w + x]);
  if (r.dept === 'fire') { if (f > 0.85 && r.health < 65) u += 0.45; if (r.stamina < 8) u += 0.5; }
  else { u += f * 1.1; if (a.smokeT > 4) u += 0.45 + (a.smokeT - 4) * 0.06; }
  if (r.dept !== 'police' && sim.t - a.underFireT < 4) u += 0.7;
  if (r.dept === 'police' && sim.t - a.underFireT < 3 && !a.inCover && r.health < 70) u += 0.35 * (1.3 - r.composure);
  u *= 1.25 - 0.5 * r.composure;
  if (a.carrying !== -1) u *= 0.55;
  return u;
}

export function think(sim: Sim, s: Scene, a: FieldAgent): void {
  const I = sim.incidents[s.incidentId];
  const r = resp(sim, a);
  if (a.status !== 'active') return;
  perceive(sim, s, a);
  shareNearby(sim, s, a);
  flushOutbox(sim, s, a);
  if (a.isCommander && sim.t >= a.planT) {
    // 지휘관은 주기적으로 건물 외부에서 화염·연기를 살핀다(창문 너머의 재발화를 놓치지 않도록)
    if (s.sizeupDone && (s.burning > 0 || s.burnedTiles > 0) && sim.t >= a.nextPerceive) { a.nextPerceive = sim.t + 7; perceive(sim, s, a, 2.4, true); }
    commanderThink(sim, s, a);
    a.planT = sim.t + (a.task && a.task.kind !== 'standby' && a.task.kind !== 'sizeup' ? 3.4 : 2);
  }
  if (I.phase === 'closed' && !sim.units[a.unitId].boardOrder) sim.units[a.unitId].boardOrder = 'release';
  const u = sim.units[a.unitId];
  const cur = a.task;

  // 철수/이송 지시는 최우선 (구조 대상을 옮기는 중이면 그것부터 끝낸다)
  if (u.boardOrder) {
    if (cur && cur.kind === 'board') return;
    if (a.carrying !== -1 && cur) return;
    setTask(sim, s, a, 'board', u.boardOrder === 'transport' ? '병원 이송 탑승' : '철수');
    return;
  }

  const opts: Option[] = [];
  // 1) 위험 회피
  const dng = dangerScore(sim, s, a);
  if (dng > 0.3 && (!cur || cur.kind !== 'retreat')) opts.push({ label: r.health < 40 ? '부상 — 후퇴' : '위험 회피 — 후퇴 후 재평가', score: dng, apply: () => {
    setTask(sim, s, a, 'retreat', '후퇴');
    if (sim.t - a.lastRetreatLog < 20 && r.health >= 40) return;
    a.lastRetreatLog = sim.t;
    emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: r.health < 40 ? 2 : 1, causes: [a.lastBlockEvent], text: r.health < 40 ? '부상으로 더 이상 임무 수행 불가. 후퇴합니다.' : '위험 수준이 너무 높습니다. 일단 물러나 재평가합니다.' });
  } });
  // 2) 현재 임무 계속
  if (cur && cur.kind !== 'standby') {
    let sc = 0.5;
    const w = cur.workId >= 0 ? s.board[cur.workId] : null;
    if (w) sc = 0.5 + 0.4 * w.priority + 0.08;
    else if (cur.kind === 'retreat') sc = 0.95;
    else if (cur.kind === 'rehab') sc = 0.62;
    else if (cur.kind === 'resupply') sc = 0.85;
    else if (cur.kind === 'moveSignal') sc = 0.66;
    if (a.carrying !== -1) sc += 0.35;
    opts.push({ label: `계속: ${cur.label}`, score: sc, apply: null });
  }
  // 3) 지휘관 지시
  if (a.orderWork >= 0 && (!cur || cur.workId !== a.orderWork)) {
    const w = s.board[a.orderWork];
    if (w && (w.status === 'open' || w.status === 'active') && fitFor(sim, s, a, w) > 0) {
      opts.push({ label: `지시 수행: ${workLabel(s, w)}`, score: 0.56 + 0.4 * w.priority, apply: () => takeWork(sim, s, a, w, false) });
    } else a.orderWork = -1;
  }
  // 4) 장비 문제
  if (a.equipIssue === 'pump' && (!cur || cur.kind !== 'resupply')) {
    const someoneFixing = s.agents.some((b) => b !== a && b.unitId === a.unitId && b.task && b.task.kind === 'resupply');
    if (!someoneFixing) opts.push({ label: '장비 교체 (예비 펌프)', score: 0.84, apply: () => {
      setTask(sim, s, a, 'resupply', '장비 교체');
      emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 1, causes: [a.lastBlockEvent], text: '차량으로 돌아가 예비 펌프로 교체하겠습니다.' });
    } });
  }
  if (a.equipIssue === 'water' && (!cur || cur.kind !== 'hookup') && !u.hydrant && s.props.some((p) => p.kind === 'hydrant')) {
    const someone = s.agents.some((b) => b !== a && b.unitId === a.unitId && b.task && b.task.kind === 'hookup');
    if (!someone) opts.push({ label: '소화전 급수 연결', score: 0.83, apply: () => {
      const w = s.board.find((q) => q.kind === 'hookup' && q.prop === a.unitId && (q.status === 'open' || q.status === 'active'));
      if (w) takeWork(sim, s, a, w, true); else { setTask(sim, s, a, 'hookup', '소화전 연결'); }
      emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 1, causes: [a.lastBlockEvent], text: '소화전에 급수 라인을 연결하겠습니다.' });
    } });
  }
  // 5) 휴식
  if (r.stamina < 22 && (!cur || cur.kind !== 'rehab') && a.carrying === -1) opts.push({ label: '체력 고갈 — 교대 휴식', score: 0.55 + ((22 - r.stamina) / 22) * 0.4, apply: () => {
    setTask(sim, s, a, 'rehab', '휴식');
    raiseProblem(sim, I, 'FATIGUE', `${r.name} 체력 고갈로 작업 중단`, { role: 'RESPONDER', actor: r.name, rid: r.id, imp: 1, text: '체력이 한계입니다. 잠시 물러나 회복하겠습니다.' });
  } });
  // 6) 무전 음영: 중요한 보고가 막혀 있으면 신호가 닿는 곳으로 이동
  if (a.commFailLogged && a.outbox.length && (!cur || cur.kind !== 'moveSignal') && a.carrying === -1) {
    opts.push({ label: '무전 가능한 위치로 이동해 보고', score: 0.6 + 0.2 * r.experience, apply: () => setTask(sim, s, a, 'moveSignal', '무전 가능 지점으로 이동') });
  }
  // 7) 스스로 판단해 맡을 수 있는 일 (지휘관 지시가 없을 때, 혹은 눈앞의 급한 일)
  const free = !cur || cur.kind === 'standby';
  const initiative = 0.25 + 0.45 * r.experience + 0.2 * r.judgment;
  let bestW: WorkItem | null = null, bestS = 0;
  for (const w of s.board) {
    if (w.status !== 'open' && !(w.status === 'active' && w.assignees.length < w.max && w.kind === 'carry')) continue;
    if (sim.t < w.holdUntil || w.assignees.indexOf(a.rid) >= 0 || w.kind === 'sizeup') continue;
    const fit = fitFor(sim, s, a, w);
    if (fit <= 0) continue;
    let near = 0;
    if (w.cas >= 0) { const c = a.beliefs.val<CasBelief>('cas', w.cas); if (c && dist(a.x, a.y, c.x, c.y) < 4) near = 0.25; else if (!c) continue; }
    if (!free && near === 0) continue;
    if (free && near === 0 && !a.isCommander && sim.t - a.idleSince < 2.6) continue;      // 먼저 지휘관 지시를 기다린다
    const sc = (free ? 0.3 : 0.15) + initiative * 0.25 + w.priority * 0.35 + near + fit * 0.1;
    if (sc > bestS) { bestS = sc; bestW = w; }
  }
  if (bestW) {
    const w = bestW;
    opts.push({ label: `자체 판단: ${workLabel(s, w)}`, score: bestS, apply: () => {
      takeWork(sim, s, a, w, true);
      if (!a.isCommander) emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 0, text: `${workLabel(s, w)}, 제가 맡겠습니다.` });
    } });
  }
  // 8) 대기
  if (free) opts.push({ label: '대기 · 지시 요청', score: 0.08, apply: cur ? null : () => { a.task = makeTask('standby', '대기'); } });

  // 판단 오차
  const noise = (1 - r.judgment) * 0.14;
  for (const o of opts) o.score += (a.rng.next() * 2 - 1) * noise;
  opts.sort((x, y) => y.score - x.score);
  const chosen = opts[0];
  const cands: Candidate[] = opts.slice(0, 5).map((o, k) => ({ label: o.label, score: Math.round(o.score * 100) / 100, chosen: k === 0 }));
  a.candidates = cands;
  if (chosen && chosen.apply) chosen.apply();
  void tileOf;
}
