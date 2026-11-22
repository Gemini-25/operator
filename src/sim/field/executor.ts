// BehaviorExecutor — 선택된 임무를 실제 행동으로 실행한다.
// 모든 행동은 현장 상태(화재, 잔해, 구조 대상, 용의자, 장비)를 직접 바꾼다.
// 이동은 대원의 "믿음"으로 계획되므로, 모르는 장애물은 부딪혀 본 뒤에야 알게 된다.

import type { Sim } from '../engine';
import { emit, markRecovered, raiseProblem } from '../events';
import { T } from '../types';
import { leavePerch, perchIdx } from './perch';
import type { AniBelief, Animal, Casualty, Fact, FieldAgent, Hostile, Incident, KitId, MateBelief, Prop, Scene, Task, TaskKind, WorkItem } from '../types';
import { clamp, dist, josa, pct } from '../util';
import { hasKit, kitRng, kitUses, kitWorks, medLevelOf, refillAir, seatsOf, seatsUsed, toolUse, useKit } from '../crews';
import { RETRY_AFTER, agentCost, casFact, debrisText, detectRadius, exitName, fitFor, flushOutbox, hazCount, hosFact, learn, learnQuiet, mateFact, mateStatus, perceive, regionNameAt, resp, staminaF, targetInHaz, visionOf, workLabel } from './agents';
import { mkFact } from './beliefs';
import { astar, doorAt, isIndoor, los, staticPass, tileOf, walkableCount } from './grid';
import { applyWater, flashbang, hostageNear, hostileActive, isHeld, placeAtSafe, pushFx, panicShot } from './hazards';
import { coverRoll, fireShot } from './damage';
import { breachHowFor, lastFx, noteCollateral, noteHit, noteShot, recBreach, recCuff, recTaser, weaponOf } from './fxlog';
import { detonate } from './rules/crime';
import { TASK_SHAPE, primeNums } from '../shape';      // (R3b N7)
import { DOWN_AT, careHostile, careResponder, hurtCas, hurtHostile, hurtResponder, initialCause, injuryRng, mustRetreat, needsHospital, treatEffect, treatPlan } from './injury';

export function makeTask(kind: TaskKind, label: string, w: WorkItem | null = null): Task {
  return primeNums<Task>({
    kind, workId: w ? w.id : -1, region: w ? w.region : -1, cas: w ? w.cas : -1, prop: w ? w.prop : -1, hostile: w ? w.hostile : -1, tile: w ? w.tile : -1, mate: w ? w.mate : -1,
    phase: 0, progress: 0, need: 1, tx: 0, ty: 0, range: 0, pts: null, ptI: 0, covered: null,
    method: undefined, mwhy: undefined, missing: undefined, tried: undefined, entryDoor: undefined, mtry: undefined, mbad: undefined, mt0: undefined, marr: undefined, mcands: undefined,      // (R2) 대응 방법 — 쓰는 것은 단계 1a 부터 (모든 임무가 같은 모양)
    startedAt: 0, selfAssigned: false, thorough: w ? w.thorough : false, wait: 0, sub: null, fails: 0, label, repathAt: 0,
    docRule: undefined, gateAt: -1, gateId: undefined, gateSaid: false, cvX: undefined, cvY: undefined, cvTx: undefined, cvTy: undefined, cvLost: -1,      // (R3) 교본 줄·판단 지점·엄폐 자리 — 쓰는 것은 단계 2 부터 (모든 임무가 같은 모양)
    animal: w ? w.animal ?? -1 : -1,      // (N8 단계 5) 포획할 동물
    wake: 0,      // (N8 단계 6a) 잠든 취객 곁에서 깨우며 기다린 초
  }, TASK_SHAPE);      // (R3b N7) 숫자 칸을 만들 때부터 소수 표현으로 — 값은 그대로 (shape.ts)
}

function releaseSpot(s: Scene, a: FieldAgent): void { if (a.spot >= 0) { if (s.spots[a.spot].taken === a.rid) s.spots[a.spot].taken = -1; a.spot = -1; } }

/** 이미 끝나 있던 일: 지휘관의 믿음이 낡아 다시 지시한 것이므로, 같은 내용이라도 다시 보고한다 (무전 문구는 남기지 않는다) */
function reportDone(sim: Sim, a: FieldAgent, f: Fact): void { a.quiet.add(f.key); learn(sim, a, f, true, true); }
/** (N8 §5.10) 위험 반경 안의 대상이면 놓는 일 (agents.fitBase 의 반경 줄과 같은 목록) */
const HAZ_DROP: ReadonlySet<string> = new Set(['treat', 'carry', 'extricate', 'escort', 'rescueMate']);
/** (N8 §4.2) 전선의 haz 사실 값 (perceive·원격 차단 무전과 같은 모양 — 반경은 본 그대로) */
function wireHaz(s: Scene, p: Prop, active: boolean): { kind: string; active: boolean; x: number; y: number; r: number } { return { kind: 'wire', active, x: p.x, y: p.y, r: s.kinds?.hazR ?? 2.2 }; }

/** 임무 종료. 실패하면 지휘관이 알 수 있도록 작업 항목에 기록하고 무전으로 알린다. */
// ───────────────────────── (N8 단계 8 §5.11) 높은 자리 ─────────────────────────
/** 높은 자리의 구출 시간(초 — 구조 능력 ×(0.6 + 0.4 × 구조)로 나눈다): 사다리 20 · 하강 35(구조 공작차의 대원) · 그 밖의 대원 50 */
export const PERCH_WORK = { ladder: 20, descend: 35, descendSlow: 50 };
/** (N8 §4.7 overdose) 약물 과다의 환자가 지금 흥분하고 있는가 (진실 s.kinds.agitated — 실행부는 읽어도 된다) */
function agitatedNow(sim: Sim, s: Scene, c: Casualty): boolean { return s.kind === 'medical' && s.variant === 'overdose' && s.kinds !== undefined && (s.kinds.agitated ?? -1) > sim.t && c.id === 0; }
/**
 * (N8 단계 9) 출산을 기다리는 구급대원은 처치 임무를 쥔 채 산모 곁에 머문다 — 진행 막대가 믿는 출산 시각으로 찬다(설계서 원칙 11).
 * 시각은 그 대원의 믿음(evid labor)으로만 정한다 (낳았다는 강제 보고 done 이 오면 끝난다)
 */
const LABOR_T0 = new WeakMap<Task, number>();
function laborStay(sim: Sim, s: Scene, a: FieldAgent, t: Task, c: Casualty, until: number, label: string): void {
  const m = moveTo(sim, s, a, c.x, c.y, 1.3);
  if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
  if (m !== 'arrived') return;
  let t0 = LABOR_T0.get(t);
  if (t0 === undefined) { t0 = sim.t; LABOR_T0.set(t, t0); }
  a.label = label;
  a.ring = Math.min(1, (sim.t - t0) / Math.max(1, until - t0));
  drain(sim, a, 0.1);
}
/** 흥분한 환자에게서 2.2칸 밖으로 물러서 기다린다 (곁에 있으면 밀쳐진다 — rules/kinds.ts overdoseRule) */
function backOff(sim: Sim, s: Scene, a: FieldAgent, c: Casualty): void {
  a.label = '흥분이 가라앉기를 기다림';
  const d = Math.hypot(a.x - c.x, a.y - c.y);
  if (d >= 2.2) return;
  const ux = d > 0.01 ? (a.x - c.x) / d : 1, uy = d > 0.01 ? (a.y - c.y) / d : 0;
  const tx = Math.max(0, Math.min(s.w - 1, Math.round(c.x + ux * 2.4))), ty = Math.max(0, Math.min(s.h - 1, Math.round(c.y + uy * 2.4)));
  if (staticPass(s.tiles[ty * s.w + tx])) moveTo(sim, s, a, tx, ty, 0.6);
}
/**
 * 높은 자리의 사람에게 가는 구출: 방법이 사다리면 사다리를 펴는 땅 칸(ground), 하강이면 위쪽 칸(top)으로 가서 정해진 시간 동안 일한다.
 * 그 밖의 방법(또는 방법 없음)으로는 닿을 수 없다 — 내려놓는다(실패 기억 25초 — 지휘관이 같은 대원에게 다시 주지 않는다).
 * 끝나면 그 사람은 ground 칸의 보통 구조 대상(거동 불가)이 된다 — 처치·이송은 핵심 규칙이 낸다
 */
function perchRescue(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, c: Casualty, k: number): void {
  const pe = s.kinds!.perch![k], r = sim.responders[a.rid];
  if (t.method !== 'ladder' && t.method !== 'descend') { learn(sim, a, casFact(sim, s, c, r.name), false); finishTask(sim, s, a, false, 'nopath'); return; }
  const tile = t.method === 'ladder' ? pe.ground : pe.top;
  const m = moveTo(sim, s, a, tile % s.w, (tile / s.w) | 0, 0.8);
  if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
  if (m !== 'arrived') return;
  const need = (t.method === 'ladder' ? PERCH_WORK.ladder : sim.units[r.unitId].kind === 'rescue' ? PERCH_WORK.descend : PERCH_WORK.descendSlow) / (0.6 + 0.4 * r.skills.rescue);
  t.progress += sim.dt * staminaF(r); a.ring = clamp(t.progress / need, 0.02, 1); drain(sim, a, 0.6);
  a.label = METHOD[t.method].label; a.fx = c.x - a.x; a.fy = c.y - a.y;
  if (t.progress < need) return;
  leavePerch(s, c, k, c.health >= 70 ? 'mobile' : 'immobile');      // 멀쩡한 사람은 내려와 스스로 걷는다
  c.tFreed = sim.t;
  learnQuiet(sim, a, casFact(sim, s, c, r.name));
  const done = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 2, text: extricateDoneText(c, t.method) });
  c.freedHow = t.method; c.freedBy = a.rid; recordMethod(sim, I, a, t, t.method, t.mwhy ?? 'usual', true, done);
  r.xpGained += 0.004;
  finishTask(sim, s, a, true);
}

export function finishTask(sim: Sim, s: Scene, a: FieldAgent, ok: boolean, reason = ''): void {
  const t = a.task;
  if (!t) return;
  const I = sim.incidents[s.incidentId];
  if (a.carrying >= 0) {
    const c = s.casualties[a.carrying];
    // (R2 1b) 물에서 끌고 오던 사람: 물 칸이면 그 자리에 놓고(다시 떠내려간다), 뭍이면 뭍에 내려놓으며 완료·방법 기록을 함께 (methodRun.dropWet)
    if (c.where === 'carried') { if (c.inWater) dropWet(sim, s, I, a, t, c); else { c.where = 'scene'; c.x = Math.round(a.x); c.y = Math.round(a.y); } }
    a.carrying = -1;
  }
  if (a.carrying <= -2) a.carrying = -1;
  releaseSpot(s, a);
  if (t.workId >= 0) {
    const w = s.board[t.workId];
    const k = w.assignees.indexOf(a.rid); if (k >= 0) w.assignees.splice(k, 1);
    if (ok) { if (w.status === 'active' || w.status === 'open') { w.status = 'done'; w.doneAt = sim.t; } }
    else if (reason === 'preempt' || reason === 'danger' || reason === 'doctrine' || reason === 'handover') {      // (R3) doctrine = 교본이 놓게 했다(docDrop·판단 지점의 상한) · handover = 처치를 넘겨주었다(4단계): 실패 기록·w.fails·holdUntil·재지시 요청 무전이 없다 — 판단 지점 상한의 holdUntil 은 부르는 쪽이 따로 둔다
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
  if (a.doc) actEnd(sim, a, t);      // (R3) 교본 행동 임무가 어떤 까닭으로든 끝났다: 따르는 교본을 비우고 그 기록의 끝 시각을 적는다
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
  // (R2 1b) 물 칸: 보트(구조정 3.0 · 고무보트 2.2칸/초) 또는 헤엄(수영 능력 — 끌고 오면 0.55배). 물살이 깎는다. 물 칸에서는 연기·장비 배율을 보지 않는다
  if (s.tiles[i] === T.WATER) {
    const flowK = Math.min(1, (s.flow ?? 0) / 0.1);
    if (a.afloat === 'boat') return (sim.units[a.unitId].kind === 'boat' ? 3.0 : 2.2) * (1 - 0.25 * flowK);
    return (0.7 + 1.1 * swimOf(sim, a)) * (a.carrying >= 0 ? 0.55 : 1) * (1 - 0.5 * flowK) * staminaF(r);
  }
  let v = 2.5 * (0.75 + 0.5 * r.fitness) * staminaF(r);
  if (s.smoke[i] > 0.3) v *= hasKit(sim, a.rid, 'scba') ? 0.8 : 0.6;      // 공기호흡기가 없으면 연기 속에서 더 느리다
  if (hasKit(sim, a.rid, 'bombSuit')) v *= 0.75;      // 폭발물 방호복은 무겁다
  if (a.task && (a.task.kind === 'engage' || a.task.kind === 'perimeter') && hasKit(sim, a.rid, 'shield')) v *= 0.9;      // 방패를 세우고 움직이면 느리다
  if (s.kind === 'search') v *= s.tiles[i] === T.TRAIL ? 0.9 : s.tiles[i] === T.TREE ? 0.42 : 0.6;      // 험한 지형
  else if (s.tiles[i] === T.TREE) v *= 0.62;
  if (a.carrying !== -1) {
    const helper = s.agents.find((b) => b !== a && b.status === 'active' && b.task && ((b.task.kind === a.task?.kind && b.task.workId === a.task?.workId) || (b.task.kind === 'pair' && b.buddy === a.rid)) && dist(a.x, a.y, b.x, b.y) < 2);      // (R3 3단계) 따라온 짝(짝 동행)도 함께 든다
    const walk = a.carrying >= 0 && s.casualties[a.carrying].mob === 'mobile';
    // 옮기는 사람이나 곁에서 돕는 사람이 들것을 가졌으면 더 빨리 옮긴다 (둘 0.78 → 0.88, 혼자 0.48 → 0.55)
    const litter = !walk && (hasKit(sim, a.rid, 'stretcher') || (helper !== undefined && hasKit(sim, helper.rid, 'stretcher')));
    v *= walk ? 0.7 : helper ? (litter ? 0.88 : 0.78) : litter ? 0.55 : dragging(a) ? 0.48 * CARRY.dragSpeed : 0.48;      // (R3 6단계 — 끌기) 혼자 낮게 끌면 혼자 업기의 ×0.85
  }
  return v;
}

/**
 * (R2 1b) 이동 비용: 바탕은 agents.agentCost(믿음의 장애물·불·연기 — 늘 한 번 만든다: 만들 때 a.rng 를 한 번 부르므로 호출 수가 지금과 같다).
 * 보트 위면 보트 비용(물 칸만 — methods.boatCost, 1c).
 * 물 위(헤엄 중)·헤엄 구조의 물에 들어간 뒤(phase ≥ 2)·뭍으로 가는 중이면 물 칸을 헤엄쳐 지나는 비용(methods.swimCost).
 * 헤엄 구조라도 물가로 걸어가는 동안(phase 0)은 뭍 길이다 — 물을 가로질러 진입점에 가지 않게.
 */
function costFor(sim: Sim, s: Scene, a: FieldAgent, escape: boolean): CostFn {
  const base = escape ? agentCost(sim, s, a, true, true) : agentCost(sim, s, a);
  if (a.afloat === 'boat') return boatCost(s);      // (1c) 보트 위: 물 칸만 (목표는 늘 물 칸 — 뭍에 대는 이동은 뭍 칸을 가운데로 range 1.5)
  const t = a.task;
  if (onWater(s, a) || (t !== null && (t.kind === 'ashore' || (t.kind === 'waterRescue' && t.method === 'swim' && t.phase >= 2)))) return swimCost(s, base);
  return base;
}

/**
 * escape = 물러나는 길: 불에 막혀 길이 없으면 불길을 뚫고 나가는 길을 찾고, 길 위의 불 앞에서 멈추지 않는다 (관창을 든 대원은 지금처럼 끄며 지나간다).
 * 다친 채 제자리에 서서 타는 것보다 불길을 지나 나오는 편이 낫다 — 지나는 동안의 화상은 그대로 입는다 (sceneManager.agentHealth).
 */
/** (N8 §5.10) 길을 짤 때 알던 위험 반경의 수 (대원 객체의 모양을 바꾸지 않으려고 WeakMap) */
const PATH_HZ = new WeakMap<FieldAgent, number>();
function moveTo(sim: Sim, s: Scene, a: FieldAgent, tx: number, ty: number, range: number, needLos = false, escape = false): MoveRes {
  const t = a.task!;
  const I = sim.incidents[s.incidentId];
  const r = resp(sim, a);
  const goalKey = Math.round(tx) + Math.round(ty) * 64 + Math.round(range * 10) * 4096 + (needLos ? 1 << 20 : 0);
  // (N8 §5.10) 길을 짠 뒤에 새 위험 반경을 알게 됐다(본 것·무전): 그 반경을 피해 다시 짠다 (시설 사고 현장만 — 그 밖은 0 이라 그대로)
  const hzn = hazCount(s, a);
  if (a.path && hzn !== (PATH_HZ.get(a) ?? 0)) a.path = null;
  if (!a.path || a.pathGoal !== goalKey || sim.t >= t.repathAt) {
    PATH_HZ.set(a, hzn);
    a.path = astar(s, a.x, a.y, Math.round(tx), Math.round(ty), range, costFor(sim, s, a, false), needLos);
    if (!a.path && escape) a.path = astar(s, a.x, a.y, Math.round(tx), Math.round(ty), range, costFor(sim, s, a, true), needLos);
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
    // (R3 5단계 S03) 진입 결정 전 무장 현장의 잠긴 문: 교본에 묻는다 — 막히면 문 앞에서 기다린다(상한 30초 · 지원이 오면 45초 뒤에는 지금처럼 연다). 진입이 정해지면 풀린다
    if (kind === 'locked' && gateStep(sim, s, a, t, 'forceDoor', docGate(sim, s, a, 'forceDoor')) === 'wait') { a.label = ruleShort(t.docRule ?? null) ?? '잠긴 방 — 진입 보류'; return 'busy'; }
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
  // (R3 §4.4·§5 — 판단 지점 interiorEntry) 위험 실내로 들어서는 첫걸음: 짝이 따라오는가·밖 대기조가 있는가를 교본에 묻는다. 막히면 문턱에 선 채 기다린다 (상한 뒤 임무를 놓는다)
  if (INTERIOR_KINDS.has(t.kind) && !gatePassed(t, 'interiorEntry') && interiorStep(s, a, t, next)) {
    const g = interiorGate(sim, s, a, t);
    if (g !== 'go') return 'moving';
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
function sweepPoints(sim: Sim, s: Scene, a: FieldAgent, t: Task, feel = false): number[] {
  const reg = s.regions[t.region];
  const r = resp(sim, a);
  const ci = tileOf(s, reg.cx, reg.cy);
  const base = reg.indoor ? s.indoorVision : s.outdoorVision;
  const rr = base * (1 - 0.78 * s.smoke[ci]) * (1 - 0.72 * 0.45) * (0.72 + 0.3 * r.judgment + 0.25 * r.experience);
  let spacing = t.thorough ? Math.max(1.6, rr * 1.1) : Math.max(2.6, rr * 1.85);
  if (r.experience < 0.4 && !t.thorough) spacing *= 1.25;
  // 정밀 재수색을 거듭할수록 간격을 더 좁힌다 (잘 숨겨진 대상은 "다 보았다"고 여긴 거리보다 가까이 가야 보인다)
  if (t.thorough && s.kind === 'search' && s.researchRound >= 2) spacing = Math.max(1.0, rr * (1.1 - 0.25 * (s.researchRound - 1)));
  if (feel) spacing *= FEEL_SPACING;      // (R3 §3.7 feel) 벽 더듬기: 간격 ×0.75, 경유점은 벽과 이웃한 바닥 칸만
  const pts: number[] = [];
  const inReg = new Set(reg.tiles);
  const snap = (x: number, y: number): number => {
    let best = -1, bd = feel ? 3.3 : 2.3;
    for (let yy = Math.round(y) - 3; yy <= Math.round(y) + 3; yy++) for (let xx = Math.round(x) - 3; xx <= Math.round(x) + 3; xx++) {
      if (xx < 0 || yy < 0 || xx >= s.w || yy >= s.h) continue;
      const i = yy * s.w + xx;
      if (!inReg.has(i) || !staticPass(s.tiles[i]) || s.tiles[i] === T.DOOR) continue;
      if (feel && !wallNext(s, xx, yy)) continue;
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

/** (R2 §4.2) 문·잔해를 연 방법별 완료 문구 (없으면 지금의 문구) */
const UNBLOCK_TEXT: Partial<Record<MethodId, string>> = {
  kick: '문을 걷어차 열었습니다. 진입합니다.', irons: '할리건으로 문을 땄습니다. 진입합니다.', ram: '충격기로 문을 부쉈습니다. 진입합니다.',
  hydraulic: '유압 개방기로 철문을 열었습니다. 진입합니다.', handClear: '손으로 잔해를 치워 통로를 확보했습니다.', toolClear: '장비로 잔해를 잘라 통로를 확보했습니다.',
};
/**
 * 문·잔해를 연다. method = 연 방법 (R2 §4.2 — 완료 문구·통로 차단 복구 문구에 방법 이름, G5 진입 기록의 how 에 그 방법).
 * 돌려주는 값 = 완료 기록 id (폭파 진입의 폭발 원인 — §4.2a). 폭파 진입은 막힌 문(문을 막은 잔해)도 진입 기록을 남긴다(문짝 없이 — door -1)
 */
function unblock(sim: Sim, s: Scene, a: FieldAgent, tile: number, method?: MethodId): number {
  const I = sim.incidents[s.incidentId];
  const r = resp(sim, a);
  const p = s.props[s.propAt[tile]];
  s.propAt[tile] = -1; p.blocking = false;
  if (p.kind === 'door') { p.locked = false; p.open = true; } else p.removed = true;
  const how: BreachHow | null = method === 'kick' || method === 'irons' || method === 'ram' || method === 'hydraulic' || method === 'charge' ? method : null;
  if (p.kind === 'door') recBreach(sim, s, p.x, p.y, a.x, a.y, { door: p.id, how: how ?? breachHowFor(sim, [a], true, false), n: 1, sync: false, by: a.rid, forced: true });
  else if (method === 'charge') recBreach(sim, s, p.x, p.y, a.x, a.y, { door: -1, how: 'charge', n: 1, sync: false, by: a.rid, forced: true });
  s.staticVersion++;
  learnQuiet(sim, a, mkFact('blk', tile, 'none', r.name, sim.t, 1, true, p.kind === 'door' ? '문 개방 완료' : '잔해 제거, 통로 확보'));
  const noun = method !== undefined ? METHOD[method].noun : '';
  const rec = method === undefined ? `${josa(r.name, '이/가')} ${p.kind === 'door' ? '문을 강제 개방' : '잔해를 제거'}해 통로 확보`
    : p.kind === 'door' ? `${josa(r.name, '이/가')} ${noun} 문을 열어 통로 확보` : method === 'charge' ? `${josa(r.name, '이/가')} ${noun} 막힌 문을 뚫어 통로 확보` : `${josa(r.name, '이/가')} ${noun} 통로 확보`;
  const pe = markRecovered(I, 'PATH_BLOCKED', rec);
  const text = method === 'charge' ? (p.kind === 'door' ? '폭파 — 문 개방. 진입합니다.' : '폭파 — 막힌 문을 뚫었습니다. 진입합니다.')
    : (method !== undefined ? UNBLOCK_TEXT[method] : undefined) ?? (p.kind === 'door' ? '문 강제 개방 완료. 진입합니다.' : '잔해 제거 완료. 통로를 확보했습니다.');
  const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, causes: [pe], text });
  r.xpGained += 0.003;
  return ev;
}

/**
 * 문·잔해를 깎는다 (본 임무 force·clear 와 이동 중 하위 작업 t.sub — tk 가 그 임무). 돌려주는 값 = 열렸다.
 * (R2 §4.2) 처음 부를 때 방법을 고른다(판단부 — 발로 차기·할리건·충격기·유압 개방기·폭파 진입 / 손으로·장비로 치우기). 속도는 고른 방법의 장비 값(methodRun.blockerRate),
 * 유압 개방기는 시작할 때 장비 확인(숨은 고장 → 다른 방법), 폭파 진입은 설치·물러서기·기다림·3-2-1 뒤 폭발(methodRun.runCharge — 문의 hp 와 상관없다).
 * 연 방법은 완료 문구·G5 진입 기록·방법 기록(I.methods — 대상은 그 칸과 소품)에 남는다. 충격기는 문이 열리는 소리로 둘레의 용의자가 돌아본다
 */
function workOnBlocker(sim: Sim, s: Scene, a: FieldAgent, tile: number, kind: TaskKind, tk: Task): boolean {
  const pid = s.propAt[tile];
  if (pid < 0) return true;
  const p = s.props[pid];
  const r = resp(sim, a), I = sim.incidents[s.incidentId];
  const work = kind === 'force' ? 'force' : 'clear';
  const tg = { cas: -1, prop: pid, hostile: -1, region: -1, tile };
  if (tk.method === undefined && tk.mt0 === undefined) { if (tk.workId < 0) tk.prop = pid; startMethod(sim, s, I, a, tk, work, tg); }
  if (tk.method === 'charge') return runCharge(sim, s, I, a, tk, tile, XK);
  // (검토) 문·잔해는 그 곁에서만 깎는다: 폭파를 접고(동료가 반경 안·물러설 자리 없음) 다른 방법으로 바꾼 대원은 물러선 자리(3~4칸)에 서 있다.
  // 본 임무는 case 'force'·'clear' 가 곁(1.5칸)으로 데려오지만 이동 중 하위 작업(t.sub — 방 진입의 잠긴 문)에는 이동이 없으므로 여기서 돌아간다 (이 분기의 이동은 이것 하나).
  // 닿았다고 하거나 길이 없으면 그 자리에서 잇는다(지금처럼 — 막히지 않게). 하위 작업이 생기는 자리는 늘 문 곁이라 폭파를 접은 뒤에만 걸린다
  { const dx = tile % s.w, dy = (tile / s.w) | 0; if (Math.hypot(a.x - dx, a.y - dy) > 1.6) { const mv = moveTo(sim, s, a, dx, dy, 1.5); if (mv === 'moving' || mv === 'busy') return false; } }
  if (blockerKitFails(sim, s, I, a, tk)) return false;      // 유압 개방기의 숨은 고장이 드러났다 → 다음 방법 (다음 틱부터)
  if (tk.method !== undefined) a.label = METHOD[tk.method].label;
  // 효과 자리: 고른 방법의 장비 값 (방법이 없으면 R1 의 식 — 실제로 쓰는 도구의 성능, 숨은 고장은 여기서 드러난다 — crews.toolUse)
  p.hp -= blockerRate(sim, s, a, tk, I) * staminaF(r) * sim.dt;
  drain(sim, a, 0.7);
  a.ring = clamp(1 - p.hp / 12, 0.05, 1);
  if (p.hp <= 0) {
    const m = tk.method;
    const ev = unblock(sim, s, a, tile, m);
    if (m !== undefined) recordMethod(sim, I, a, tk, m, tk.mwhy ?? 'usual', true, ev, tg);
    if (m === 'ram') doorNoise(sim, s, p.x, p.y);
    return true;
  }
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

/**
 * eff = 효과 배율(물이 불에 닿는 양), wmul = 물 소모 배율 — (X6 §5.5) 외부 방수는 0.7·1.4 (R2 의 defensive 가 같은 인자를 쓴다).
 * jitter = (R2 §3.5) 물줄기 그림의 끝점을 s.rng 로 흩뜨리는가 — 지금의 호출은 그대로(true), R2 의 외부 방수·고가 방수는 false(고정 오프셋 — s.rng 는 명중·용의자 행동의 흐름이다)
 */
function spray(sim: Sim, s: Scene, a: FieldAgent, tx: number, ty: number, eff = 1, wmul = 1, jitter = true): boolean {
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
  if (sim.tick % 2 === 0) {
    if (jitter) pushFx(sim, s, 'spray', a.x, a.y, tx + s.rng.range(-0.4, 0.4), ty + s.rng.range(-0.4, 0.4), undefined, undefined, 0.3);
    else { const o = ((sim.tick % 3) - 1) * 0.3; pushFx(sim, s, 'spray', a.x, a.y, tx + o, ty - o, undefined, undefined, 0.3); }
  }
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
function scuffle(sim: Sim, s: Scene, I: Incident, a: FieldAgent, h: Hostile): number {
  const rng = injuryRng(sim, s, 'fight');
  const toMe = rng.range(FIGHT_HIT[0], FIGHT_HIT[1]), toHim = rng.range(FIGHT_HIT[0], FIGHT_HIT[1]);
  const r = resp(sim, a);
  const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'resolve', imp: 3, text: `${josa(h.label, '이/가')} 저항해 몸싸움 끝에 검거.` });
  hurtResponder(sim, s, I, a, toMe, 'blunt', { by: h.id, byKind: 'hostile', ev });
  hurtHostile(sim, s, I, h, toHim, 'blunt', { by: a.rid, byKind: 'responder', ev });
  return ev;      // (R2 단계 5) 검거 기록 id — 방법 기록(recordArrest)이 가리킨다
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
  if (hit) { h.stunUntil = sim.t + TASER.stun; h.stunHow = 'taser'; }      // (R2 §4.6) 무력화 수단 — 검거 기록이 쓴다
  recTaser(sim, s, a, h.x, h.y, hit, 1, h.id);
  const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 2, text: hit ? `테이저 발사 — ${h.label} 무력화.` : '테이저 발사 — 빗나감.' });
  if (hit && h.health > 1) hurtHostile(sim, s, I, h, Math.min(TASER_HIT, h.health - 1), 'electric', { by: a.rid, byKind: 'responder', ev });      // 기록만 남길 만큼 (H1 §4.2)
  return true;
}

function shootAt(sim: Sim, s: Scene, a: FieldAgent, hid: number): void {
  if (!fireRound(sim, a)) return;      // (R3 §2.9) 재장전 중이거나 탄창이 비었다: 난수를 부르기 전에 돌아간다 (쏘지 않았다 — s.rng 소비가 그대로)
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
    I.problems.push({ code: 'ESCALATION', t: sim.t, eventId: emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 3, text: '교전 발생! 대응 사격합니다.' }), detail: '교전 발생', recovered: true, recoveryText: '', times: undefined, ref: undefined });      // times·ref: raiseProblem 과 같은 모양 (I1-b)
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
/**
 * 용의자가 있는 방으로 들어가는, 아직 닫혀 있는 가장 가까운 문 (용의자가 이미 보이거나 같은 방이면 없음).
 * (R2 §4.2a) 잠긴 방 문을 하위 작업으로 연 진입조는 그 문(t.entryDoor)을 열린 뒤에도 들어가기(entered) 전까지 돌려받는다 — 열린 문 너머로 용의자가 보여도 함께 들어간다
 */
function roomDoorFor(s: Scene, a: FieldAgent, h: Hostile, t: Task | null = null): Prop | null {
  const hr = s.region[tileOf(s, h.x, h.y)], ar = s.region[tileOf(s, a.x, a.y)];
  if (t !== null && t.entryDoor !== undefined) {
    const p = s.props[t.entryDoor], i = p.y * s.w + p.x;
    if (!p.entered && hr >= 0 && hr !== ar && (s.region[i] === hr || s.region[i - 1] === hr || s.region[i + 1] === hr || s.region[i - s.w] === hr || s.region[i + s.w] === hr)) return p;
    t.entryDoor = undefined;
  }
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
  const by: FieldAgent[] = [];
  let stacked: FieldAgent | null = null;      // (R3 S01) 줄 서기로 들어간 문의 방패수
  s.exits.forEach((e, k) => {
    const team = s.agents.filter((b) => b.status === 'active' && b.task && b.task.kind === 'engage' && dist(b.x, b.y, e.x, e.y) <= 2.6);
    if (!team.length) return;
    // (R3 §3.1 P07) 그 출입구의 진입조가 한 명이면 교본에 묻는다: 막히면 그 출입구만 건너뛴다 — 그 대원은 문 곁에 남고(t.gateId 'breach'), 풀리면 자기 문만 연다 (case 'engage' ①)
    if (team.length === 1 && team[0].task !== null && gateStep(sim, s, team[0], team[0].task, 'breach', docGate(sim, s, team[0], 'breach')) === 'wait') return;
    // (R3 5단계 S01) 그 문의 진입조에 방패를 든 특공 대원이 있으면 그 사람에게 묻는다: 줄 서기면 방패수가 먼저 들어가고 나머지는 0.6초 간격으로 따른다
    const sh = team.length >= 2 ? team.find((b) => hasKit(sim, b.rid, 'shield')) : undefined;
    if (sh !== undefined && docGate(sim, s, sh, 'breach').opt === 'stack') { stackTeam(sim, team, sh); stacked = sh; }
    bangs += breachExit(sim, s, k, team);
    by.push(team.indexOf(a) >= 0 ? a : team[0]);
  });
  // 진입 문구는 실제로 들어간 진입조의 대원이 말한다 (부른 대원의 문이 건너뛰어졌으면 그 대원이 아니다). 아무 문도 열리지 않았으면 남기지 않는다
  const who: FieldAgent | null = by.indexOf(a) >= 0 ? a : by.length ? by[0] : null;
  // (R3 S01) 줄 서기로 들어갔으면 방패 선두를 말한다 (문구는 '진입!' 으로 시작한다 — 동시 진입의 기록으로 읽힌다)
  const bangText = `섬광탄을 던져 넣고 들어갑니다${bangs ? ` (용의자 ${bangs}명 무력화)` : ''}.`;
  const entryText = stacked !== null ? (s.bangAt === sim.t ? `진입! 방패 선두, ${bangText}` : '진입! 방패 선두로 들어갑니다.') : s.bangAt === sim.t ? `진입! ${bangText}` : '진입! 출입문을 열고 들어갑니다.';
  const ev = who !== null ? emit(sim, { inc: I.id, role: 'RESPONDER', actor: resp(sim, who).name, rid: who.rid, kind: 'action', imp: 3, text: entryText }) : -1;
  if (stacked !== null) recordDoc(sim, I, stacked, 'S01', 'gate', { gate: 'breach' }, ev);
}
/** (R3 S01) 줄 서기의 간격 (초) */
const STACK_GAP = 0.6;
/** 줄 서기로 뒤따르는 진입조의 임무 → 들어가기 시작하는 시각 (임무의 모양을 바꾸지 않으려 WeakMap) */
const STACK_AT = new WeakMap<Task, number>();
/** 방패수(sh)가 먼저, 나머지 진입조는 출입구에 가까운 순으로 0.6초 간격 (같으면 rid 가 작은 쪽) */
function stackTeam(sim: Sim, team: FieldAgent[], sh: FieldAgent): void {
  const rest = team.filter((b) => b !== sh).sort((p, q) => dist(p.x, p.y, sh.x, sh.y) - dist(q.x, q.y, sh.x, sh.y) || p.rid - q.rid);
  rest.forEach((b, k) => { if (b.task) STACK_AT.set(b.task, sim.t + STACK_GAP * (k + 1)); });
}
/**
 * (R3 §3.1 P01~P03) 흉기·맨손 상대에게 붙기 전에 기다리는 거리: 테이저를 든 둘은 2칸(본문 1.8칸 — 흉기가 닿는 거리가 1.8칸 미만이라 그 경계에 서지 않게 조금 물렸다),
 * 혼자이거나 동료가 멀면 3칸
 */
const STAND_TASER = 2, STAND_KNIFE = 3;
/** 용의자에게서 R 칸쯤 떨어진, 대원에게 가장 가까운 빈 칸 (거리 유지의 자리). 없으면 null */
function standOffSpot(s: Scene, a: FieldAgent, h: Hostile, R: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null, bd = Infinity;
  const hx = Math.round(h.x), hy = Math.round(h.y), k = Math.ceil(R + 1);
  for (let y = Math.max(0, hy - k); y <= Math.min(s.h - 1, hy + k); y++) for (let x = Math.max(0, hx - k); x <= Math.min(s.w - 1, hx + k); x++) {
    const i = y * s.w + x;
    if (!staticPass(s.tiles[i]) || s.propAt[i] >= 0) continue;
    const dh = dist(x, y, h.x, h.y);
    if (dh < R - 0.4 || dh > R + 0.6) continue;
    const da = dist(x, y, a.x, a.y);
    if (da < bd) { bd = da; best = { x, y }; }
  }
  return best;
}
/** (R3 §3.1 P07) 혼자라 동시 진입에서 빠진 대원이 기다리는 자리 (임무마다 한 번 정한다 — 출입구 곁 4칸 안에서 믿음 속 용의자에게 벽으로 가려지는 칸, 없으면 null = 출입구 앞) */
const WAIT_AT = new WeakMap<Task, { x: number; y: number } | null>();
/** (R3 P05) 그 교전 임무가 엄폐 사격 자리를 쓰는가 (판단 지점 coverFire 의 고르기 — 1초마다 다시 묻는다) */
const COVER_FIRE = new WeakMap<Task, boolean>();
function waitSpot(s: Scene, a: FieldAgent, t: Task, h: Hostile, ox: number, oy: number): { x: number; y: number } | null {
  let w = WAIT_AT.get(t);
  if (w === undefined) {
    const hb = a.beliefs.val<{ x: number; y: number }>('hos', h.id);
    w = coverSpot(s, ox, oy, hb !== undefined ? hb.x : h.x, hb !== undefined ? hb.y : h.y, false);
    WAIT_AT.set(t, w);
  }
  return w;
}
/**
 * 출입구 하나의 동시 진입 (R3 — breach 의 출입구 반복 몸을 꺼낸 것. 혼자라 빠졌던 진입조가 나중에 자기 문만 열 때도 쓴다):
 * 출입구 곁의 문을 열고(잠겼으면 부수고) 문 바로 안쪽에 용의자가 있다고 알면 섬광탄을 던져 넣는다. 돌려주는 값 = 섬광탄으로 무력화한 수
 * (본문 §11.1 은 doctrineRun.breachExit 라고 적었지만, 진입 뒤의 검거를 'breach' 로 적는 ENTERED 가 이 파일의 것이라 여기에 둔다)
 */
function breachExit(sim: Sim, s: Scene, k: number, team: FieldAgent[], sync = true): number {      // sync = 동시 진입의 그 틱 (3단계: 늦게 자기 문만 여는 진입조는 false — 연출 기록의 동시 진입은 breachDone 이 참이 된 틱에만)
  const e = s.exits[k];
  let bangs = 0;
  {
    // 출입구 바로 안쪽의 문
    let inX = e.x, inY = e.y + (e.y > s.h / 2 ? -3 : 3);
    let doorSeen = false;
    for (const p of s.props) {
      if (p.kind !== 'door' || Math.abs(p.x - e.x) + Math.abs(p.y - e.y) > 1.5) continue;
      const wasLocked = p.blocking, wasOpen = !!p.open;
      if (p.blocking) { s.propAt[p.y * s.w + p.x] = -1; p.blocking = false; p.locked = false; }
      if (!p.open) { p.open = true; s.staticVersion++; }
      inX = e.x + (p.x - e.x) * 3; inY = e.y + (p.y - e.y) * 3;      // 문을 지나 세 칸 안쪽
      recBreach(sim, s, p.x, p.y, e.x, e.y, { door: p.id, how: breachHowFor(sim, team, wasLocked, wasOpen), n: team.length, sync, by: team[0].rid, forced: wasLocked }); doorSeen = true;
    }
    if (!doorSeen) recBreach(sim, s, e.x, e.y, e.x, e.y, { door: -1, how: 'open', n: team.length, sync, by: team[0].rid, forced: false });
    // 문 바로 안쪽에 용의자가 있다고 알고 있을 때만 섬광탄을 쓴다(없으면 방 진입 때를 위해 아낀다). 섬광탄은 사람 몫이다: 가진 사람이 던진다
    // (R3 §3.1 P15) 마지막 한 개를 든 대원은 동시 진입에서 쓰지 않고 방 진입용으로 아낀다 (용의자가 3칸 안이면 쓴다 — docGate 'bangUse' 의 고르기)
    let thrower: FieldAgent | undefined;
    for (const b of team) {
      if (kitUses(sim, b.rid, 'flashbang') <= 0 || !b.beliefs.list('hos').some((f) => (f.value.state === 'hold' || f.value.state === 'fight') && dist(f.value.x, f.value.y, inX, inY) <= 5)) continue;
      const gb = docGate(sim, s, b, 'bangUse');
      if (gb.opt === 'save') { docMark(sim, s, b, gb.rule ?? 'P15', 'gate', { gate: 'bangUse' }, 0); continue; }
      thrower = b; break;
    }
    if (thrower && sim.t - s.bangAt > 2) {
      useKit(sim, thrower.rid, 'flashbang'); s.bangAt = sim.t;
      bangs += flashbang(sim, s, inX, inY, thrower);
    }
    for (const b of team) { b.path = null; b.pathGoal = -1; if (b.task) ENTERED.add(b.task); }      // ENTERED: (R2 §4.6) 진입 뒤의 검거는 'breach' 로 적는다
    // 문이 열리는 소리: 무력화되지 않은 용의자는 그쪽을 돌아본다
    for (const h of s.hostiles) if ((h.state === 'hold' || h.state === 'fight') && sim.t >= h.stunUntil && dist(h.x, h.y, e.x, e.y) <= 13 && sim.t >= h.alertUntil) { h.facing = Math.atan2(e.y - h.y, e.x - h.x); h.alertUntil = sim.t + 5; }
  }
  return bangs;
}
/**
 * (R3 §2.10) 엄폐 사격 자리로 간다 (P05 의 교전 · P14 의 대기): 믿음 속 위협 둘레 3~7.5칸 고리에서 위협이 보이고 위협 쪽에 엄폐가 있는 자리(doctrine.coverSpot).
 * 자리는 임무에 담고(t.cvX·cvY, 그때의 위협 자리 t.cvTx·cvTy) 다시 고르는 때는 셋뿐이다 — 아직 고른 적이 없다 · 위협이 2칸 넘게 움직였다 · 자리에 닿은 뒤 2초 넘게 위협이 보이지 않는다(t.cvLost).
 * 자리가 없으면(NaN) 그 셋 가운데 하나가 될 때까지 다시 찾지 않고 null — 부르는 쪽이 지금 동작으로 간다. 한 틱에 moveTo 하나 (갈 길이 없으면 'nopath' — 이 틱은 끝)
 */
function toCoverSpot(sim: Sim, s: Scene, a: FieldAgent, t: Task, h: Hostile): MoveRes | null {
  // 위협의 자리는 이 교전 분기가 쫓는 대상의 자리(h) 그대로다 — 지금의 "7.5칸·시야 아무 자리"(moveTo(h…))와 같은 자격.
  // 믿음의 낡은 자리로 고르면 움직이는 총격범을 놓쳐 교전이 길어졌다 (2단계 측정 — 강제 armed/shooter 의 한계 시간)
  const tx = h.x, ty = h.y;
  let again = t.cvX === undefined || t.cvTx === undefined || t.cvTy === undefined || dist(tx, ty, t.cvTx, t.cvTy) > 2;
  if (!again && t.cvX !== undefined && t.cvY !== undefined && !Number.isNaN(t.cvX)) {
    // (R3b 단계 2 — 어려움 S5 #07 의 교착) 자리에 닿았으면 대원의 자리에서, 아직 가는 중이면 고른 그 자리에서 위협이 보이는가를 잰다.
    // 위협이 2칸 안에서 움직여 고른 자리의 시야를 잃으면, 그 자리 곁(위협이 안 보이는 칸)에 선 대원을 방 진입 갈래(roomDoorFor — 시야가 없으면 문으로)가
    // 데려갔다가 시야가 트인 칸에서 이 갈래가 되돌려 보내 두 목표 사이를 틱마다 오갔다(149초 — 닿지 못해 2초 재기가 시작되지 않았다)
    const at = dist(a.x, a.y, t.cvX, t.cvY) <= 0.6;
    if (at ? los(s, a.x, a.y, h.x, h.y) : los(s, t.cvX, t.cvY, h.x, h.y)) t.cvLost = -1;
    else if ((t.cvLost ?? -1) < 0) t.cvLost = sim.t;
    else if (sim.t - (t.cvLost ?? sim.t) > 2) again = true;
  }
  if (again) {
    let sp = coverSpot(s, a.x, a.y, tx, ty, true);
    // 판단부는 벽만 보고 고른다(losWalls — 문은 열려 있다고 본다). 닫힌 문 너머의 자리는 서 보아야 아무것도 보이지 않으므로 실행기가 그 자리를 받지 않는다 — 지금 동작으로
    if (sp !== null && !los(s, sp.x, sp.y, tx, ty)) sp = null;
    t.cvTx = tx; t.cvTy = ty; t.cvX = sp !== null ? sp.x : NaN; t.cvY = sp !== null ? sp.y : NaN; t.cvLost = -1;
    a.path = null; a.pathGoal = -1;
  }
  if (t.cvX === undefined || t.cvY === undefined || Number.isNaN(t.cvX)) return null;
  const m = moveTo(sim, s, a, t.cvX, t.cvY, 0.4);
  if (m === 'nopath') { t.cvX = NaN; t.cvY = NaN; }
  return m;
}

/** (R3 5단계) 잠긴 방 문을 여는 사람을 고르는 거리 — 그 문으로 오고 있는 진입조도 센다 (칸) */
const OPENER_NEAR = 6;
/** (R2 §4.2a) 잠긴 방 문의 상한 (초): 모인 뒤 이만큼 지나도 안 열리면 지금처럼 바로 연다 (모든 사건은 끝난다) */
const ROOM_DOOR_CAP = 25;
/** 잠긴 방 문 앞에 진입조가 처음 모인 시각 (문마다 — 소품의 모양을 바꾸지 않으려 WeakMap. 되감기는 Sim 을 새로 만든다) */
const roomDoorAt = new WeakMap<Prop, number>();
/** 그 문을 여는 하위 작업을 맡은 진입조 대원, 또는 (R3b D1) 그 문을 본 임무로 여는 대원(S30 — 진입대원(파괴)이 문으로 오는 중) (없으면 null) */
function doorOpener(s: Scene, rd: Prop): FieldAgent | null {
  const i = rd.y * s.w + rd.x;
  for (const b of s.agents) if (b.status === 'active' && b.task !== null && ((b.task.kind === 'engage' && b.task.sub !== null && b.task.sub.tile === i) || (b.task.kind === 'force' && b.task.tile === i))) return b;
  return null;
}
/** 문을 여는 대원의 그 문 임무 (하위 작업 또는 본 임무) */
const openTask = (op: FieldAgent): Task => (op.task!.kind === 'force' ? op.task! : op.task!.sub!);
/** (R3b D1) 잠긴 방 문 앞에 모인 진입조가 스스로 열지 않고 진입대원(파괴)을 기다리는 시간 (초 — 모인 뒤. 상한 ROOM_DOOR_CAP 25초는 그대로) */
const BREACHER_WAIT = 8;
/**
 * (R3b D1) 현장에 손이 닿는 진입대원(파괴)이 있는가: 장약이 남았고(알려진 고장 제외) 걸을 수 있는 다친 대원이 아니며 업고 있지 않고,
 * 검거·문 개방·후퇴·철수·휴식·탑승 중이 아닌 활동 대원 — 교본 S30 이 그 사람을 문으로 데려올 수 있다. 진입조(교전)이면 같은 용의자를 맡아 이 방으로 오는 중일 때만
 * (문 6칸 안에 닿으면 여는 사람 고르기에 든다 — OPENER_NEAR). 동료의 겉·조직 정보만 본다
 */
function breacherOn(sim: Sim, s: Scene, t: Task): boolean {
  for (const b of s.agents) {
    if (b.status !== 'active' || b.carrying !== -1 || roleIdOf(sim, b.rid) !== 'breacher' || kitCount(sim, b.rid, 'charge') <= 0 || sim.responders[b.rid].status === 'injured') continue;
    const bt = b.task, k = bt !== null ? bt.kind : null;
    if (k === 'engage' && (bt!.hostile !== t.hostile || bt!.sub !== null)) continue;
    if (k === 'arrest' || k === 'force' || k === 'clear' || k === 'retreat' || k === 'evacuate' || k === 'rehab' || k === 'board') continue;
    return true;
  }
  return false;
}
/**
 * (R2 §4.2a) 방 진입의 잠긴 문 (case 'engage' ①-2 — 진입조가 모였을 때). 돌려주는 값 = 아직 기다린다(이 틱은 여기서 끝).
 *   ① 처음 모인 대원이 손잡이를 돌려 보고 안다 — 지금의 discoverBlock(기록·blk 믿음). 곁의 진입조도 함께 본다
 *   ② 모인 대원 가운데 그 문의 force 방법 1등 점수가 가장 높은 한 사람(같으면 rid 가 작은 쪽)이 문 여는 하위 작업을 맡는다 — 그 안에서 방법을 고른다(폭파·충격기·할리건·유압·발차기)
 *   ③ 나머지는 문 앞에서 기다린다 (폭파면 stackForCharge 가 각자의 물러설 자리로)
 *   ④ 모인 뒤 25초가 지나도 안 열리면 false — 부른 쪽이 지금처럼 바로 연다
 * 문이 열리면 다음 틱에 지금의 방 진입(섬광탄 → 함께 들어감)이 이어진다(roomDoorFor 가 t.entryDoor 를 돌려준다)
 */
function lockedRoomDoor(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, rd: Prop, mates: FieldAgent[]): boolean {
  const tile = rd.y * s.w + rd.x;
  t.entryDoor = rd.id;
  let at = roomDoorAt.get(rd);
  if (at === undefined) { at = sim.t; roomDoorAt.set(rd, at); }
  if (sim.t >= at + ROOM_DOOR_CAP) {
    const r = resp(sim, a);
    markRecovered(I, 'PATH_BLOCKED', `${josa(r.name, '이/가')} 문을 강제 개방해 통로 확보`);
    return false;
  }
  const team = [a, ...mates];
  if (a.beliefs.val<string>('blk', tile) !== 'locked') {
    // 먼저 와서 손잡이를 돌려 본 동료가 있으면 그 사실을 함께 안다 (같은 문을 두 번 "차단"으로 알리지 않는다)
    let known: Fact | undefined;
    for (const b of s.agents) if (b !== a && b.status === 'active' && b.beliefs.val<string>('blk', tile) === 'locked') { known = b.beliefs.get('blk', tile); break; }
    if (known) a.beliefs.merge(known);
    else {
      discoverBlock(sim, s, I, a, tile, 'locked');
      a.pendingBlock = -1;      // 길을 다시 짜며 "우회/강제 개방" 을 따로 정하지 않는다 — 방 진입이 정한다
      const f = a.beliefs.get('blk', tile);
      if (f) for (const b of mates) b.beliefs.merge(f);      // 곁에 모인 진입조도 같이 본다
      return true;
    }
  }
  for (const b of mates) if (b.task !== null) b.task.entryDoor = rd.id;
  if (doorOpener(s, rd) !== null) return true;      // 이미 누군가 연다 (R3b D1 — 그 문을 본 임무로 열러 오는 진입대원(파괴)도)
  // (R3 5단계 — S26·S03) 문 여는 사람은 모인 진입조와 그 문으로 오고 있는 진입조(같은 용의자의 교전 · 문에서 6칸 안) 가운데서 고른다:
  // 장약을 든 진입대원(파괴)이 조금 늦게 와도 그 사람이 연다 — 그 사람이 닿아 스스로 맡을 때까지 모인 사람은 기다린다 (모인 뒤 25초 상한은 그대로)
  for (const b of s.agents) if (b !== a && mates.indexOf(b) < 0 && b.status === 'active' && b.task !== null && b.task.kind === 'engage' && b.task.hostile === t.hostile && b.task.sub === null && dist(b.x, b.y, rd.x, rd.y) <= OPENER_NEAR) team.push(b);
  // (R3b D1) 모인 뒤 8초는 진입대원(파괴)이 문 개방(S30)을 맡거나 이 방으로 닿을 틈을 둔다 — 그 사람이 이미 고를 사람들 가운데 있으면 기다리지 않는다
  if (sim.t < at + BREACHER_WAIT && !team.some((b) => roleIdOf(sim, b.rid) === 'breacher' && kitCount(sim, b.rid, 'charge') > 0) && breacherOn(sim, s, t)) { a.label = '파괴 담당 대기'; return true; }
  const tg = { tile, prop: rd.id, cas: -1, hostile: -1, region: -1 };
  let best: FieldAgent | null = null, bs = -1;
  for (const b of team) {
    if (b.status !== 'active' || b.task === null || b.task.sub !== null) continue;
    const pk = chooseMethod(sim, s, b, 'force', tg, null, NO_SENSE, selfDc(sim, s, b, b.task));      // (R3b D4) 그 대원의 자기 모드 교본 입력과 함께 — 문 곁에서 실제로 고를 점수(S26 이 폭파를 뺀 점수)로 견준다
    const sc = pk !== null ? pk.cands[0].score : 0;
    if (sc > bs || (sc === bs && best !== null && b.rid < best.rid)) { bs = sc; best = b; }
  }
  if (best === a) {
    const sub = makeTask('force', '문 강제 개방');
    sub.tile = tile; t.sub = sub; a.path = null;
  }
  return true;
}
/**
 * (R2 §4.2a) 잠긴 방 문을 동료가 폭파로 여는 중이다: 이 대원은 자기 물러설 자리(처음 한 번 정해 t.tx, t.ty)로 가 기다린다.
 * 돌려주는 값 = 이 틱의 일을 했다(물러서는 중·기다리는 중). 폭파가 아니거나 자리가 없으면 false — 문 앞에서 기다린다
 */
function stackForCharge(sim: Sim, s: Scene, a: FieldAgent, t: Task, rd: Prop): boolean {
  const op = doorOpener(s, rd);
  if (op === null || op === a || openTask(op).method !== 'charge') { t.range = 0; return false; }
  if (!t.range) { const sp = stackSpot(s, rd.y * s.w + rd.x, a); if (sp === null) return false; t.tx = sp.x; t.ty = sp.y; t.range = 1; }
  a.label = '폭파 대기';
  const m = moveTo(sim, s, a, t.tx, t.ty, 0.3);
  if (m === 'arrived') { a.fx = rd.x - a.x; a.fy = rd.y - a.y; }
  return m !== 'nopath';
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
    if (t.method !== undefined) recordMethod(sim, I, a, t, t.method === 'aerial' ? 'aerial' : 'defensive', t.mwhy ?? 'usual', true, -1, { cas: -1, prop: -1, hostile: -1, region, tile: -1 });      // (R2 §4.5) 지휘관이 정한 외부 방어 — 고른 방법과 관계없이 밖에서 끈 것이다
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

// ───────────────────────── (N8 단계 4b) 시설 사고의 실행 갈래 — 진실을 읽는다 ─────────────────────────
/** 공급 차단 확인을 마친 밸브 (§5.3.8 — 다시 하지 않는다). 소품 객체의 모양을 바꾸지 않으려고 WeakSet */
const SUPPLY_CHECKED = new WeakSet<Prop>();
/** 실행 시간 (초 — 숙련 보정 전) */
export const UTIL_WORK = { pipe: 18, check: 20, hole: 20, sign: 20, fireMul: 3 };
/**
 * (4b §4.2 utility/main·sinkhole) 터진 관의 제수밸브 잠그기 — 수도 복구반(밸브 키)이면 보통 시간, 시간 막이로 맡은 소방(손 공구)이면 세 배(§5.3.6 ③ — 처음 손을 댈 때 UTIL_LATE,
 * 잠그면 복구됨). 이미 멎은 관이면 확인만 하고 강제 보고(CLAUDE.md "이미 끝나 있던 일")
 */
function runPipeShut(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, p: Prop): void {
  const r = resp(sim, a), civil = r.dept === 'civil';
  const fact = (active: boolean, text: string): Fact => mkFact('haz', p.id, { kind: 'pipe', pipe: p.sub === 'gas' ? 'gas' : 'water', active, x: p.x, y: p.y }, r.name, sim.t, 1, true, text);
  if (!p.live) { reportDone(sim, a, fact(false, '관의 물이 멎어 있음 — 확인')); finishTask(sim, s, a, true); return; }
  const m = moveTo(sim, s, a, p.x, p.y, 1.4);
  if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
  if (m !== 'arrived') return;
  if (t.phase === 0) {
    t.phase = 1;
    if (!civil && !I.problems.some((q) => q.code === 'UTIL_LATE' && !q.recovered)) raiseProblem(sim, I, 'UTIL_LATE', '수도 복구반이 오지 못해 소방이 제수밸브를 잠금', { role: 'RESPONDER', actor: r.name, rid: r.id, imp: 2, text: '수도 복구반이 오지 않습니다. 소방이 제수밸브를 찾아 직접 잠그겠습니다 — 시간이 걸립니다.' });
    else emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: '밸브 키로 터진 수도관의 제수밸브를 잠그겠습니다.' });
  }
  t.need = UTIL_WORK.pipe / (0.7 + 0.3 * r.skills.rescue) * (civil ? 1 : UTIL_WORK.fireMul);
  t.progress += sim.dt; a.ring = t.progress / t.need;
  if (t.progress < t.need) return;
  p.live = false;
  const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, text: '터진 수도관의 제수밸브를 잠갔습니다. 물이 멎었습니다.' });
  if (!civil) markRecovered(I, 'UTIL_LATE', '소방이 제수밸브를 잠가 물을 멈췄습니다');
  void ev;
  reportDone(sim, a, fact(false, '제수밸브 잠금 완료 — 물이 멎음'));
  r.xpGained += 0.003;
  finishTask(sim, s, a, true);
}
/**
 * (4b §5.3.8) 가스 밸브의 공급 차단 확인 — 가스 복구반(20초). 밸브가 아직 열려 있으면 그 자리에서 잠근다(누출 조치와 같은 결과).
 * 마치면 믿음에 checked 를 붙여 강제 보고 — 지휘 규칙이 다시 내지 않는다
 */
function runSupplyCheck(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, p: Prop): void {
  const r = resp(sim, a);
  const fact = (checked: boolean, text: string): Fact => mkFact('haz', p.id, { kind: 'leak', active: false, x: p.x, y: p.y, sub: 'valve', checked: checked ? true : undefined }, r.name, sim.t, 1, true, text);
  if (SUPPLY_CHECKED.has(p) || p.ignited) { reportDone(sim, a, fact(true, '가스 공급 차단 확인됨')); finishTask(sim, s, a, true); return; }
  // 확인은 건물 밖의 인입 배관(계량기)에서 한다 — 새는 방(밸브 자리)까지 들어가지 않는다: 들어가면 측정기가 남은 가스를 재 X6 의 진입 금지 구역을 만들고,
  // 그 재측정을 기다리느라 밸브를 이미 잠근 사건이 2~4분 더 열려 있었다(보통 S8 #05 — 측정 도구의 교착 후보). 밸브에서 가장 가까운 출입구 1.5칸 안(바깥에서 다가가 멈춘다)
  let ex = s.exits.length ? s.exits[0] : null;
  for (const e of s.exits) if (ex && Math.hypot(e.x - p.x, e.y - p.y) < Math.hypot(ex.x - p.x, ex.y - p.y)) ex = e;
  const m = ex ? moveTo(sim, s, a, ex.x, ex.y, 1.5) : moveTo(sim, s, a, p.x, p.y, 1.6);
  if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
  if (m !== 'arrived') return;
  if (t.phase === 0) { t.phase = 1; emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: p.mitigated ? '건물 밖 인입 배관에서 가스 공급 차단 상태를 확인하겠습니다.' : '건물 밖 인입 배관의 밸브를 잠가 가스 공급을 끊겠습니다.' }); }
  t.need = UTIL_WORK.check / (0.7 + 0.3 * r.skills.rescue);
  t.progress += sim.dt; a.ring = t.progress / t.need;
  if (t.progress < t.need) return;
  const closed = !p.mitigated;
  p.mitigated = true;
  SUPPLY_CHECKED.add(p);
  emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 1, text: closed ? '인입 배관의 밸브를 잠갔습니다. 가스 공급 차단을 확인했습니다.' : '가스 공급 차단을 확인했습니다. 배관에 가스가 흐르지 않습니다.' });
  reportDone(sim, a, fact(true, '가스 공급 차단 확인 완료'));
  r.xpGained += 0.002;
  finishTask(sim, s, a, true);
}
/**
 * (4b §4.2) 시설물의 보강·고정(mitigate — R2 의 방법이 아니다): 싱크홀은 가장자리 1.4칸 안에서 20초 지지대 → p.mitigated(넓어짐 확률 −0.12 — holeRule),
 * 매달린 간판은 곁에서 20초 줄로 묶음 → p.mitigated · p.live 거짓(떨어지지 않는다). 이미 떨어졌거나 끝나 있으면 강제 보고
 */
function runFixtureFix(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, p: Prop): void {
  const r = resp(sim, a);
  if (p.skin === 'hole') {
    const hr = s.kinds?.hazR ?? 2;
    const fact = (text: string): Fact => mkFact('haz', p.id, { kind: 'hole', active: false, x: p.x, y: p.y, r: hr }, r.name, sim.t, 1, true, text);
    if (p.mitigated) { reportDone(sim, a, fact('구멍 가장자리 보강 확인')); finishTask(sim, s, a, true); return; }
    const m = moveTo(sim, s, a, p.x, p.y, hr + 1.4);
    if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
    if (m !== 'arrived') return;
    if (t.phase === 0) { t.phase = 1; emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: '싱크홀 가장자리에 지지대를 세우겠습니다.' }); }
    t.need = UTIL_WORK.hole / (0.6 + 0.4 * r.skills.rescue);
    t.progress += sim.dt; a.ring = t.progress / t.need; drain(sim, a, 0.5);
    if (t.progress < t.need) return;
    p.mitigated = true;
    s.staticVersion++;
    emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, text: '싱크홀 가장자리에 지지대를 세웠습니다. 더 꺼질 위험을 줄였습니다.' });
    reportDone(sim, a, fact('구멍 가장자리 보강 완료'));
    r.xpGained += 0.003;
    finishTask(sim, s, a, true);
    return;
  }
  if (p.skin === 'sign') {
    const fact = (text: string): Fact => mkFact('haz', p.id, { kind: 'sign', active: false, x: p.x, y: p.y, r: 2 }, r.name, sim.t, 1, true, text);
    if (!p.live) { reportDone(sim, a, fact(p.mitigated ? '간판 고정 확인' : '간판이 이미 떨어짐')); finishTask(sim, s, a, true); return; }
    const m = moveTo(sim, s, a, p.x, p.y, 1.5);
    if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
    if (m !== 'arrived') return;
    const ladder = r.role === 'ladderOp' || r.role === 'ladderLead';
    if (t.phase === 0) { t.phase = 1; emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: ladder ? '사다리를 펴 떨어질 듯한 간판을 고정하겠습니다.' : '옥상에서 줄을 내려 간판을 묶겠습니다.' }); }
    t.need = UTIL_WORK.sign / (0.6 + 0.4 * r.skills.rescue);
    t.progress += sim.dt; a.ring = t.progress / t.need;
    if (t.progress < t.need) return;
    p.mitigated = true; p.live = false;
    emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, text: '간판을 고정했습니다. 떨어질 위험이 없어졌습니다.' });
    reportDone(sim, a, fact('간판 고정 완료'));
    r.xpGained += 0.003;
    finishTask(sim, s, a, true);
    return;
  }
  finishTask(sim, s, a, false, 'preempt');
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
    } else if (workOnBlocker(sim, s, a, t.sub.tile, t.sub.kind, t.sub)) { t.sub = null; a.path = null; }
    return;
  }
  if (t.wait > 0) { t.wait -= dt; return; }
  // (N8 §5.10) 사람에게 가는 일의 대상이 이 대원이 아는 살아 있는 위험 반경 안이다(맡은 뒤에 알았다): 위험해서 놓는다 — 실패 기억으로 한동안 다시 맡지 않는다 (업고 있으면 그대로)
  if (s.kind === 'utility' && a.carrying === -1 && HAZ_DROP.has(t.kind) && targetInHaz(sim, s, a, t)) { finishTask(sim, s, a, false, 'danger'); return; }
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
      // (R2 §4.4) 방법을 처음 고른다 (호출·청음 / 줄 수색·확성기·열화상) — 경유점마다 다시 고르지 않는다
      if (t.method === undefined && t.mt0 === undefined) startMethod(sim, s, I, a, t, 'search', { cas: -1, prop: -1, hostile: -1, region: t.region, tile: -1 });
      if ((t.method === 'feel') !== FEEL_PTS.has(t)) {      // (R3 §3.7) 벽 더듬기를 골랐거나(도착 재선택 포함) 그만두었다: 남은 경유점을 그 방식으로 다시 짠다 (본 칸은 그대로)
        if (t.method === 'feel') FEEL_PTS.add(t); else FEEL_PTS.delete(t);
        t.pts = sweepPoints(sim, s, a, t, t.method === 'feel'); t.ptI = 0; a.path = null; a.pathGoal = -1;
      }
      if (reg.indoor && !hasKit(sim, a.rid, 'turnout')) { let m = 0; for (const i of reg.tiles) if (s.fire[i] > m && dist(a.x, a.y, i % s.w, (i / s.w) | 0) < 4) m = s.fire[i]; if (m > 0.35) { finishTask(sim, s, a, false, 'fire'); return; } }
      if (t.ptI >= t.pts.length) {
        const total = Math.max(1, walkableCount(s, reg.tiles));
        const conf = clamp(t.covered!.size / total, 0, 1);
        if (t.covered!.size === 0 && t.fails > 0) { finishTask(sim, s, a, false, 'nopath'); return; }
        // (R3 독립 검토 — 재수색 고리) 닿지 못한 경유점이 있고(잠긴 문·막힌 통로) 확인율이 이미 알던 값에서 늘지 않았다: 마친 것이 아니라 닿지 못한 것이다 — 실패로 끝내 보류(8초)와 실패 기억(25초)을 남긴다.
        //   그러지 않으면 지휘관이 낮은 확인율을 보고 같은 대원에게 같은 방의 정밀 수색을 5초마다 다시 냈다 (문이 열릴 때까지 — 어려움 S31 의 건물 화재에서 열 번. R3 전의 코드에도 네 번까지 있던 고리다:
        //   짝이 문턱에서 기다림 없이 따라오게 되자 그 간격이 짧아져 드러났다)
        { const prev = a.beliefs.val<number>('srch', reg.id); if (t.fails > 0 && conf < 0.72 && prev !== undefined && conf <= prev + 0.005) { finishTask(sim, s, a, false, 'nopath'); return; } }
        if (conf < 0.72) a.quiet.add('srch:' + reg.id);
        learn(sim, a, mkFact('srch', reg.id, Math.round(conf * 100) / 100, r.name, sim.t, conf, true, `${reg.name} ${t.thorough ? '정밀 ' : ''}수색 완료 (확인율 ${pct(conf)})`), true, true);
        if (conf < 0.72) emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `${reg.name} 수색을 마쳤지만 ${s.smoke[tileOf(s, reg.cx, reg.cy)] > 0.3 ? '짙은 연기로' : '시야가 나빠'} 확인율이 ${pct(conf)}에 그쳤습니다.` });
        if (t.method !== undefined) recordMethod(sim, I, a, t, t.method, t.mwhy ?? 'usual', true, -1, { cas: -1, prop: -1, hostile: -1, region: t.region, tile: -1 });      // (R2) 이 방법으로 그 구역을 마쳤다 (보고서 문장은 찾아낸 사람이 있을 때만 — methodReport)
        r.xpGained += 0.002;
        finishTask(sim, s, a, true);
        return;
      }
      const p = t.pts[t.ptI];
      a.ring = t.ptI / t.pts.length;
      const m = moveTo(sim, s, a, p % s.w, (p / s.w) | 0, 0.4);
      if (m === 'arrived') {
        // (R2) 그 구역의 첫 경유점: 도착 재선택 한 번 · 멈추는 시간은 방법마다(청음 3 · 확성기 2 · 열화상 1.5초 — 멈춘 동안 perceive 가 탐지 배율을 곱한다)
        if (t.ptI === 0 && !t.marr) recheckOnArrive(sim, s, I, a, t, 'search', { cas: -1, prop: -1, hostile: -1, region: t.region, tile: -1 });
        const stop = searchStop(sim, s, I, a, t);
        markCovered(sim, s, a, t); perceive(sim, s, a); t.ptI++; t.wait = stop; drain(sim, a, 0.3);
        if (t.method !== undefined && !METHOD[t.method].plain) a.label = METHOD[t.method].label;
      }
      else if (m === 'nopath') { t.ptI++; t.fails++; a.pathGoal = -1; }
      return;
    }
    case 'suppress': {
      // (R2 §4.5) 방법을 처음 고른다 — 선택 임무: 고를 것이 없으면 방법 없이 지금 코드(내부 공격)로. 소화기는 펌프·물을 쓰지 않으므로 그 검사보다 먼저
      const sg = { cas: -1, prop: -1, hostile: -1, region: t.region, tile: -1 };
      if (t.method === undefined && t.mt0 === undefined) startMethod(sim, s, I, a, t, 'suppress', sg);
      if (t.method === 'extinguisher') {
        // (검토) X6 가 정한 현장 모드가 R2 의 선택보다 먼저다: 외부 방어 구역(진입 금지·단계 3 너머)에는 소화기를 들고 들어가지 않는다 — 대원의 믿음에 지휘 상태가
        // 아직 없어도. 관창이 없으면 밖에서 할 일이 없으므로 위험해서 내려놓고(한동안 이 대원에게 다시 맡기지 않는다), 관창수는 아래의 외부 방수로 간다
        if (!opsExterior(s, t.region)) { runExtinguisher(sim, s, I, a, t, XK); return; }
        if (!hasKit(sim, a.rid, 'hose')) { finishTask(sim, s, a, false, 'danger'); return; }
        t.method = undefined; t.mwhy = undefined;
      }
      if (!hasKit(sim, a.rid, 'hose')) { finishTask(sim, s, a, false, 'nomethod'); return; }      // 관창이 없는 대원(소화기를 다 썼거나 고를 수 없게 됐다)은 할 것이 없다
      if (u.pumpFailed || (u.water <= 0 && !u.hydrant)) { equipTrouble(sim, s, a, u.pumpFailed ? 'pump' : 'water'); finishTask(sim, s, a, false, 'equip'); return; }
      // (X6 §5.5) 외부 방어·진입 금지 구역·단계 3 구역 너머: 밖에서 방수한다. 단계 2 구역 안에서 이미 진압하던 대원은 안에서 잇는다 — R2 의 방법 선택보다 먼저다(현장 모드가 우선)
      const ext = opsExterior(s, t.region);
      if (ext && !(t.phase === 2 && insideLevel2(s, a, t.region))) { if (runExterior(sim, s, I, a, t, t.region)) return; }
      // (R2 §4.5) 외부 방어 방수·고가 사다리 방수·배연 (내부 공격과 방법 없음은 아래 지금 코드)
      if (!ext && runSuppress(sim, s, I, a, t, XK)) return;
      if (t.phase === 1) { t.tile = -1; a.path = null; }      // 밖에서 하다 안으로 (구역이 풀렸거나, 단계 2 구역인데 밖에서 닿을 자리가 없다)
      t.phase = 2;      // 안에서 한다
      if (t.tile < 0 || s.fire[t.tile] <= 0.05 || sim.t > t.progress) { t.tile = nearestFireTile(sim, s, a, t.region); t.progress = sim.t + 1.6; }
      const reg = s.regions[t.region];
      if (t.tile < 0) {
        const m = moveTo(sim, s, a, Math.round(reg.cx), Math.round(reg.cy), 2.2);
        if (m === 'arrived' || m === 'nopath') {
          perceive(sim, s, a);
          let any = false; for (const i of reg.tiles) if (s.fire[i] > 0.05) { any = true; break; }
          if (!any) {
            learn(sim, a, mkFact('fire', reg.id, 0, r.name, sim.t, 1, true, `${reg.name} 화재 진압 확인`), true, true); r.xpGained += 0.003;
            if (t.method !== undefined) recordMethod(sim, I, a, t, t.method, t.mwhy ?? 'usual', true, -1, sg);      // (R2) 이 방법으로 그 구역의 불을 잡았다
            finishTask(sim, s, a, true);
          }
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
      // (R2 §3.2-2) 화점 곁에 처음 닿은 틱: 선 자리의 연기로 한 번 더 고른다(배연 — 연기 0.5 넘음, 외부 방수 — 자기 몸). 바꿨으면 다음 틱부터 그 방법
      if (!t.marr && t.method !== undefined && !ext && recheckOnArrive(sim, s, I, a, t, 'suppress', sg, true)) return;
      a.fx = tx - a.x; a.fy = ty - a.y;
      a.ring = 1 - s.fire[t.tile];
      const pulse = t.method === 'pulse';      // (R3 §3.7 pulse) 끊어 쏘기: 진압 효과 ×0.85, 물 소모 ×0.65
      if (!spray(sim, s, a, tx, ty, pulse ? PULSE_MUL[0] : 1, pulse ? PULSE_MUL[1] : 1)) finishTask(sim, s, a, false, 'equip');
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
      const s30 = t.docRule === 'S30';      // (R3b D1) 교본 S30 — 진입대원(파괴)이 스스로 잠긴 방 문을 열러 왔다 (작업판 밖의 임무)
      if (s.propAt[t.tile] < 0) {
        // (R3b D1) 다른 대원이 먼저 열었다: 낡은 믿음으로 다시 오지 않게 "열렸다"를 강제로 보고하고(reportDone) 그 문에 60초 다시 걸지 않는다 — 판단마다 시작 → 끝의 고리를 막는다
        if (s30) { reportDone(sim, a, mkFact('blk', t.tile, 'none', r.name, sim.t, 1, true, '문 개방 확인')); docRemember(sim, a, 'S30', 'd:' + t.tile, DOC.S30_MEM); }
        finishTask(sim, s, a, true); return;
      }
      // (R2 §4.2a) 폭파 진입의 설치 뒤(물러서기·기다림·3-2-1)는 문 곁으로 가지 않는다 — 이동은 runCharge 안의 한 번뿐 (한 틱에 이동 목표 하나)
      if (t.method === 'charge' && t.phase >= 1) { if (workOnBlocker(sim, s, a, t.tile, t.kind, t)) { if (s30) docRemember(sim, a, 'S30', 'd:' + t.tile, DOC.S30_MEM); finishTask(sim, s, a, true); } return; }
      const m = moveTo(sim, s, a, t.tile % s.w, (t.tile / s.w) | 0, 1.5);
      if (m === 'nopath') { if (s30) docRemember(sim, a, 'S30', 'd:' + t.tile, DOC.S30_MEM); finishTask(sim, s, a, false, 'nopath'); return; }
      if (m === 'arrived' && workOnBlocker(sim, s, a, t.tile, t.kind, t)) { if (s30) docRemember(sim, a, 'S30', 'd:' + t.tile, DOC.S30_MEM); finishTask(sim, s, a, true); }
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
      // (R2 §4.3) 방법을 처음 고른다 — 차량·붕괴·구덩이·그 밖을 대원의 믿음으로 가려 수동·손 공구·문 벌리기·지붕 절단·급박·줄·손으로 파기·에어백·지지대 가운데
      if (t.method === undefined && t.mt0 === undefined) startMethod(sim, s, I, a, t, 'extricate', { cas: c.id, prop: -1, hostile: -1, region: -1, tile: -1 });
      { const pk = perchIdx(s, c.id); if (pk >= 0) { perchRescue(sim, s, I, a, t, c, pk); return; } }      // (N8 단계 8 §5.11) 높은 자리의 사람: 사다리(ground)·하강(top)으로만 닿는다
      if (noAirEntry(sim, s, a, c.x, c.y)) { learn(sim, a, casFact(sim, s, c, r.name), false); finishTask(sim, s, a, false, 'unsafe'); return; }      // 위험한 건물 안: 공기호흡기 없이는 들어가지 않는다
      const pitTile = !staticPass(s.tiles[tileOf(s, c.x, c.y)]);      // (N8 4b) 걸을 수 없는 칸(싱크홀 안): 가장자리에서 줄로 — 사거리 3.6 (구명줄을 던지는 거리, waterRescue 와 같다)
      const m = moveTo(sim, s, a, c.x, c.y, pitTile ? (t.method === 'descend' ? 1.5 : 3.6) : 1.5);      // (N8 단계 8) 구덩이로 내려가는 하강은 가장자리 바로 곁에서
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      if (w && relieve(sim, s, a, w, c.x, c.y)) return;      // 교대: 내가 손을 뗐다
      if (!t.marr) recheckOnArrive(sim, s, I, a, t, 'extricate', { cas: c.id, prop: -1, hostile: -1, region: -1, tile: -1 });      // (R2) 대상 곁에 처음 닿은 틱 — 선 자리의 연기로 급박 구출을 다시 본다
      if (extricatePrep(sim, s, I, a, t, c)) return;      // (R2) 준비(문 벌리기·지붕 절단·에어백·지지대·줄 내리기)와 장비 확인
      const { k, tool } = extricateRate(sim, a, t, I);
      const rate = r.skills.rescue * k * staminaF(r) * (s.smoke[tileOf(s, a.x, a.y)] > 0.4 ? 0.7 : 1);
      c.trapWork -= rate * dt; drain(sim, a, 0.8);
      a.ring = clamp(1 - c.trapWork / 16, 0.05, 1);
      if (t.method !== undefined) a.label = METHOD[t.method].label;
      if (t.method === 'tunnel') tunnelSlide(sim, s, I, a, c);      // (R2) 손으로 파기: 균열 곁이면 잔해가 다시 흘러내릴 수 있다
      if (c.trapWork <= 0) {
        c.mob = 'immobile'; c.tFreed = sim.t;
        if (c.inVehicle !== null) { c.inVehicle = null; c.x = Math.round(a.x); c.y = Math.round(a.y); }
        if (!staticPass(s.tiles[tileOf(s, c.x, c.y)])) { c.x = c.px = Math.round(a.x); c.y = c.py = Math.round(a.y); c.path = null; }      // (N8 4b) 구멍에서 줄로 끌어올렸다: 그 대원의 칸으로
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
        const done = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 2, text: extricateDoneText(c, t.method) });      // (R2) 방법별 완료 문구 (평소 방법은 지금 그대로)
        if (t.method === 'rapid' && I.phase !== 'closed') hurtCas(sim, s, I, c, RAPID_HURT, 'blunt', { ev: done });      // (R2) 급박 구출: 척추 보호 없이 끌어냈다
        if (t.method !== undefined) { c.freedHow = t.method; c.freedBy = a.rid; recordMethod(sim, I, a, t, t.method, t.mwhy ?? 'usual', true, done); }
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
      // (N8 단계 9) 출산이 가깝다고 믿는 구급대원: 처치를 마친 뒤에도 곁에 머문다 (현장 분만 — 낳은 뒤의 산모·신생아는 핵심 규칙의 처치·이송이 맡는다)
      const labAt = r.dept === 'ems' && !c.dead && (c.where === 'scene' || c.where === 'safe') ? laborAtOf(sim, a, c.id) : -1;
      if (labAt >= 0 && c.treated) { laborStay(sim, s, a, t, c, labAt, '분만 대기'); return; }
      // 이미 처치를 받은 환자는 더 나은 처치를 할 수 있는 대원만 다시 본다
      if (c.dead || c.where === 'loaded' || c.where === 'hospital' || (c.treated && qPlan <= c.treatQ + 0.15)) { learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, true); return; }
      if (c.where === 'carried') return;
      if (agitatedNow(sim, s, c)) { backOff(sim, s, a, c); return; }      // (N8 단계 9) 약물 과다: 흥분하는 동안은 곁에서 물러나 기다린다 (경찰이 가라앉힌다)
      if (r.dept !== 'ems' && tryHandover(sim, s, a, t, c, XK)) return;      // (R3 CE2) 지휘관이 같은 처치를 맡긴 구급 대원이 곁에 왔다 — 손을 떼고 넘긴다 (finishTask 'handover')
      if (s.laneRows.length && laneHold(sim, s, a, t, c, XK)) return;      // (R3 E12) 차로 위 환자 — 통제 전에는 차로 밖 곁 칸에서 기다린다 (상한 20초)
      // (R2 §4.7) 방법을 처음 고른다 — 현장 안정 후 이송(평소) · 즉시 이송(위중 · 환자 자리가 남은 부대 · 구급 장비)
      if (t.method === undefined && t.mt0 === undefined) startMethod(sim, s, I, a, t, 'treat', { cas: c.id, prop: -1, hostile: -1, region: -1, tile: -1 });
      const rush = t.method === 'rush';
      if (c.treated && t.phase === 0) { t.phase = 1; c.treatProg = 0; }
      const m = moveTo(sim, s, a, c.x, c.y, 1.3);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      careMark(sim, s, a, t, c);      // (R3 E05) 안전 확보 전의 무장 현장 — 경계 밖 처치소 (그 현장에서 처음 한 번 기록)
      const rate = Math.max(0.1, r.skills.medical * (0.5 + 0.5 * med)) * staminaF(r);
      t.need = rush ? 3.0 : 4.5 + (c.health < 40 ? 4 : c.health < 70 ? 2 : 0);      // 즉시 이송: 최소한만 (3초)
      c.treatProg += rate * dt; a.ring = c.treatProg / t.need; drain(sim, a, 0.3);
      if (c.treatProg >= t.need) {
        const fx = treatEffect(sim, s, I, a.rid, c.health, c.treated ? c.treatQ : -1);
        // 제세동기가 듣지 않아 앞선 처치보다 나아진 것이 없다: 상태만 다시 알리고 끝낸다 (처치의 수준을 낮추지 않는다)
        if (!fx) { learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, true); return; }
        if (fx.heal > 0) c.health = Math.min(100, c.health + fx.heal);
        c.treated = true; if (c.tTreated < 0) c.tTreated = sim.t; c.treatQ = fx.q * (rush ? 0.7 : 1); c.bleed = c.bleed0 * fx.bleedK; c.bystander = false;      // 즉시 이송은 품질 ×0.7
        if (rush) c.rush = true;      // (R2 §4.7) 지휘관은 이 환자에게 처치를 더 내지 않고 탑승을 먼저 한다 (casFact 가 믿음에 싣는다)
        learnQuiet(sim, a, casFact(sim, s, c, r.name));
        const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: rush ? `구조 대상 ${c.label} 최소한만 처치했습니다. 즉시 이송합니다.` : fx.q < 0.6 ? `구조 대상 ${c.label} 기본 응급 처치 완료. 전문 처치가 필요합니다.` : `구조 대상 ${c.label} 전문 응급 처치 완료.` });
        if (t.method !== undefined) recordMethod(sim, I, a, t, t.method, t.mwhy ?? 'usual', true, ev);      // (R2) 이 방법으로 처치했다
        r.xpGained += 0.003;
        if (labAt < 0) finishTask(sim, s, a, true);      // (N8 단계 9) 출산이 가까우면 쥔 채 곁에 머문다 (다음 틱부터 laborStay)
      }
      return;
    }
    case 'carry': case 'escort': {
      const c = s.casualties[t.cas];
      if (c.dead || c.where === 'safe' || c.where === 'loaded' || c.where === 'hospital') { learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, true); return; }
      // 갇혔다(맡은 뒤에 2차 붕괴로 갇힌 사람 등): 옮길 수 없다. 지휘관의 믿음이 '거동 불가'로 남아 같은 지시를 되풀이하지 않게 다시 알린다 (낡은 믿음)
      if (c.mob === 'trapped') { learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, false, 'gone'); return; }
      if (a.carrying !== c.id && isHeld(sim, s, c.id)) { finishTask(sim, s, a, false, 'unsafe'); return; }      // 용의자 곁의 인질은 데리고 나올 수 없다
      if (a.carrying !== c.id && agitatedNow(sim, s, c)) { backOff(sim, s, a, c); return; }      // (N8 단계 9) 흥분하는 동안은 옮기지 못한다
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
        // (R3 6단계 §3.7) 방법을 처음 고른다 — 업기(평소) · 끌기(들것 없이 혼자, 선 자리의 연기가 짙을 때 — E14). 환자 곁에 닿으면 그 자리의 연기로 한 번 다시 본다(runCarry)
        if (t.kind === 'carry' && t.method === undefined && t.mt0 === undefined) startMethod(sim, s, I, a, t, 'carry', { cas: c.id, prop: -1, hostile: -1, region: -1, tile: -1 });
        const m = moveTo(sim, s, a, c.x, c.y, 1.3);
        if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (m !== 'arrived') return;
        if (t.kind === 'carry' && carryHold(sim, s, a, t, senseOf(s, a))) return;      // (R3 E08) 구급 동료가 처치 중인 환자 — 들지 않고 곁에서 기다린다 (상한 15초)
        if (t.kind === 'carry' && runCarry(sim, s, I, a, t, c)) return;      // (R3 6단계) 도착 재선택(끌기) · 척추 고정판을 든 대원은 들기 전에 3초 고정 (E13 — 판단 지점 carryStart, 끝나면 c.immob)
        t.progress += dt;
        if (t.progress >= 1.2) { c.where = 'carried'; c.inVehicle = null; a.carrying = c.id; a.path = null; a.pathGoal = -1; learn(sim, a, casFact(sim, s, c, r.name), false); }
        return;
      }
      const m = moveTo(sim, s, a, s.safe.x, s.safe.y, 1.2);
      c.x = a.x - a.fx * 0.45; c.y = a.y - a.fy * 0.45;
      // 척추 고정판: 차·잔해에서 꺼낸 사람(교통사고·붕괴)을 고정하지 않고 옮기면 옮기는 동안 더 나빠진다 (악화 ×1.12).
      // (R3 6단계 E13) 조건을 "고정판을 가졌는가"에서 "고정했는가(c.immob)"로 — 고정판을 든 대원(옮기는 사람이나 곁에 온 동료)이 들기 전에 3초 고정한다(runCarry). 연기·열 속에서는 고정하지 않고 바로 옮긴다
      // 더해진 악화는 그 상처의 원인으로 적는다 (매 틱 피해)
      if ((s.kind === 'traffic' || s.kind === 'collapse') && c.tFreed >= 0 && !c.dead && !c.immob) hurtCas(sim, s, I, c, c.bleed * 0.12 * dt, c.bleedCause ?? initialCause(s, I, c), { tick: true });
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m === 'arrived') {
        c.where = 'safe'; c.tSafe = sim.t; placeAtSafe(s, c); a.carrying = -1;
        learnQuiet(sim, a, casFact(sim, s, c, r.name));
        const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 2, text: `구조 대상 ${c.label} 안전 구역으로 이송 완료.` });
        if (t.kind === 'carry') carryDone(sim, I, a, t, c.mob !== 'mobile' && carryHas(sim, s, a, 'stretcher'), ev);      // (R3 6단계) 이 방법으로 옮겼다 — 끌기 · 들것(기록 전용) · 업기
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
        const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `구조 대상 ${c.label} ${u.callsign}에 탑승 완료.` });
        if (u.air) recordMethod(sim, I, a, t, 'airlift', 'usual', true, ev, { cas: c.id, prop: -1, hostile: -1, region: -1, tile: -1 });      // (R2 §4.7) 헬기 이송 — 기록 전용 (위중 환자의 헬기 먼저는 R1 의 지휘관 탑승 배정)
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'traffic': {
      const k = t.tile, cp = s.controlPts[k];
      if (s.controlDone[k]) { reportDone(sim, a, mkFact('ctl', k, true, r.name, sim.t, 1, true, '차로 통제 완료')); finishTask(sim, s, a, true); return; }
      // (R3 6단계 §3.7) 방법을 처음 고른다 — 통제(평소) · 차량 차단(부대 차량으로 차로 입구를 막고 선 뒤 통제 — P20 경찰: 2차 사고 뒤·밤·비·안개 / F18 소방차: 차량 화재·연료 누출)
      const ltg = { cas: -1, prop: -1, hostile: -1, region: -1, tile: k };
      if (t.method === undefined && t.mt0 === undefined) startMethod(sim, s, I, a, t, 'traffic', ltg);
      const m = moveTo(sim, s, a, cp.x, cp.y, 0.8);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      t.need = (r.dept === 'police' ? 6 : 10) * (kitWorks(sim, a.rid, 'baton', I) ? 0.85 : 1) + runTraffic(sim, s, I, a, t);      // 경광봉을 들면 차를 더 빨리 세운다 · 차량 차단은 닿는 순간 s.laneShield, 설치 +3초
      t.progress += dt; a.ring = t.progress / t.need;
      if (t.progress >= t.need) {
        s.controlDone[k] = true;
        learnQuiet(sim, a, mkFact('ctl', k, true, r.name, sim.t, 1, true, `${k === 0 ? '서측' : '동측'} 진입 차량 통제 완료`));
        const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `${k === 0 ? '서측' : '동측'} 차로 통제 완료. 진입 차량을 차단했습니다.` });
        if (t.method !== undefined) recordMethod(sim, I, a, t, t.method, t.mwhy ?? 'usual', true, ev);      // (R3 6단계) 이 방법으로 통제했다
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
      if (p.kind === 'fixture') { runFixtureFix(sim, s, I, a, t, p); return; }      // (N8 4b) 싱크홀 가장자리 보강 · 매달린 간판 고정
      const doneText = p.kind === 'unstable' ? '균열부 보강 완료' : p.kind === 'valve' ? (p.ignited ? '누출 가스 발화' : '가스 밸브 차단 완료') : p.ignited ? '누출 연료 발화' : '연료 누출 조치 완료';
      const sub = p.kind === 'unstable' ? 'crack' : p.kind === 'valve' ? 'valve' : 'fuel';      // (R2 §4.3) 균열·밸브·차량 연료 — 판단부가 sub 로 가린다
      if (p.mitigated || p.ignited) { learn(sim, a, mkFact('haz', p.id, { kind: 'leak', active: false, x: p.x, y: p.y, sub }, r.name, sim.t, 1, true, doneText), true, true); finishTask(sim, s, a, true); return; }
      // (R2 §4.8) 방법을 처음 고른다 (누출 조치 — 평소), 밸브 곁에 처음 닿은 틱에 선 자리의 가스로 한 번 더 (환기 후 차단). 환기 후 차단은 환기·기다림 뒤 지금의 차단을 ×0.8 로
      const mg = { cas: -1, prop: p.id, hostile: -1, region: -1, tile: -1 };
      if (t.method === undefined && t.mt0 === undefined) startMethod(sim, s, I, a, t, 'mitigate', mg);
      if (runVentFirst(sim, s, I, a, t, p, XK)) return;
      const m = moveTo(sim, s, a, p.x, p.y, 1.6);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      if (!t.marr && t.progress === 0 && t.phase === 0 && recheckOnArrive(sim, s, I, a, t, 'mitigate', mg)) return;
      // 누출 차단 장비가 있으면 밸브·연료 누출 조치가 빠르다 (균열부 보강에는 쓰지 않는다)
      t.need = (p.kind === 'unstable' ? 13 / (0.5 + r.skills.rescue) : (p.kind === 'valve' ? 9 : 7) / (0.5 + r.skills.fire) / (kitWorks(sim, a.rid, 'plugKit', I) ? 1.6 : 1)) * (t.method === 'ventFirst' ? 0.8 : 1);
      t.progress += dt; a.ring = t.progress / t.need;
      if (t.progress >= t.need) {
        p.mitigated = true;
        learnQuiet(sim, a, mkFact('haz', p.id, { kind: 'leak', active: false, x: p.x, y: p.y, sub }, r.name, sim.t, 1, true, doneText));
        const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, text: p.kind === 'unstable' ? '균열부에 지지대를 세웠습니다. 추가 붕괴 위험을 줄였습니다.' : p.kind === 'valve' ? '가스 밸브 차단 완료. 누출이 멈췄습니다.' : '연료 누출 차단 완료. 발화 위험을 제거했습니다.' });
        if (t.method !== undefined) recordMethod(sim, I, a, t, t.method, t.mwhy ?? 'usual', true, ev, mg);      // (R2) 이 방법으로 막았다
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
      // (R3 §3.7 — 5단계) 해체 방법 셋(로봇 원격·방호복·맨몸): 고르기(R2 startMethod — 고를 것이 없으면 맡지 않는다)·이동·장비 확인·필요 시간·실수 판정·끝은 doctrineRun.runDefuse.
      // 장치가 반응하면 'slip' — 터뜨리는 것(rules/crime.detonate)은 여기서 (doctrineRun 이 rules/ 를 import 하면 규칙의 등록 순서가 바뀐다)
      if (runDefuse(sim, s, I, a, t, XK) === 'slip') {
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'hazard', imp: 2, text: '해체 중 장치가 반응했습니다!' });
        detonate(sim, s, I, p); finishTask(sim, s, a, true);
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
      // (R2 §4.8) 출입구 통제 자리에 처음 닿으면 방법을 고른다 — 출입구 통제(평소) · 대피 방송(가스 현장의 경찰 · 확성기: 시작할 때 한 번 알리고 방법 기록. 효과는 hazards.tickGas)
      if (t.kind === 'perimeter' && t.method === undefined && t.mt0 === undefined) {
        const ev0 = I.lastEvent;      // (검토) 방법 기록은 그 알림을 가리킨다 — 같은 말의 되풀이라 알리지 않았으면(methodRun.SAY_AGAIN) 가리킬 기록이 없다(-1). 남의 기록을 가리키지 않게
        startMethod(sim, s, I, a, t, 'perimeter', { cas: -1, prop: -1, hostile: -1, region: -1, tile: t.tile });
        if (t.method === 'announce') recordMethod(sim, I, a, t, 'announce', t.mwhy ?? 'usual', true, I.lastEvent !== ev0 ? I.lastEvent : -1, { cas: -1, prop: -1, hostile: -1, region: -1, tile: t.tile });
      }
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
      } else a.label = t.method === 'announce' ? METHOD.announce.label : s.kind === 'hazmat' ? '출입구 통제' : `${exitName(s, t.tile)} 봉쇄`;
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
            const ev = fights(sim, I, h, was) ? scuffle(sim, s, I, a, h)      // 맞서던 상대: 몸싸움 끝에 (H1 단계 4c)
              : emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'resolve', imp: 3, text: `${h.label} 검거!` });
            recordArrest(sim, I, a, t, h, was === 'flee' ? 'chase' : s.breachDone || ENTERED.has(t) ? 'breach' : 'tackle', ev);      // (R2 §4.6) 기록 전용 — 추격 검거·진입·덮치기 (무력화 수단·방패가 먼저)
            recCuff(sim, s, h, a, was === 'flee' ? 'chase' : 'tackle');
            r.xpGained += 0.006;
            finishTask(sim, s, a, true);
          }
        }
        return;
      }
      // ① 진입조는 가까운 출입구 앞에 모였다가 정해진 시각에 함께 들어간다
      //    (R3 §3.1 P07) 혼자라 동시 진입에서 빠진 대원(t.gateId 'breach')은 동시 진입 뒤에도 자기 문 앞에 남았다가, 판단 지점이 풀리면(동료 도착·예외·상한) 자기 문만 연다
      if ((s.breachAt >= 0 && !s.breachDone && s.exits.length) || (t.gateId === 'breach' && t.tile >= 0 && t.tile < s.exits.length)) {
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
        if (s.breachDone) {
          // 혼자 기다리는 동안은 출입구 곁 4칸 안에서 믿음 속 용의자에게 벽으로 가려지는 자리에 선다 (없으면 출입구 앞) — 한 틱에 moveTo 하나
          if (gateStep(sim, s, a, t, 'breach', docGate(sim, s, a, 'breach')) === 'wait') {
            a.label = '단독 진입 보류';
            const ws = waitSpot(s, a, t, h, e.x, e.y);
            moveTo(sim, s, a, ws !== null ? ws.x : e.x, ws !== null ? ws.y : e.y, ws !== null ? 0.4 : 1.4);
            return;
          }
          const team = s.agents.filter((b) => b.status === 'active' && b.task && b.task.kind === 'engage' && dist(b.x, b.y, e.x, e.y) <= 2.6);
          const n = breachExit(sim, s, t.tile, team.indexOf(a) >= 0 ? team : [a, ...team], false);
          gateClear(sim, s, a, t);
          emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 3, text: s.bangAt === sim.t ? `진입! 섬광탄을 던져 넣고 들어갑니다${n ? ` (용의자 ${n}명 무력화)` : ''}.` : '진입! 출입문을 열고 들어갑니다.' });
          return;
        }
        const m0 = moveTo(sim, s, a, e.x, e.y, 1.4);
        a.label = '진입 대기';
        const ready = m0 === 'arrived' || m0 === 'nopath';
        if ((ready && sim.t >= s.breachAt) || sim.t >= s.breachAt + 8) breach(sim, s, a);
        return;
      }
      // (R3 S01) 줄 서기: 방패수가 먼저 들어가고 뒤따르는 진입조는 자기 차례(0.6초 간격)까지 출입구에서 기다린다
      { const at = STACK_AT.get(t); if (at !== undefined) { if (sim.t < at) { a.label = '줄 서기'; return; } STACK_AT.delete(t); } }
      // ①-2 방 진입: 용의자가 닫힌 문 뒤의 방에 있으면, 문 앞에 모였다가 (섬광탄이 있으면 던져 넣고) 함께 들어간다
      const rd = sim.t < h.stunUntil ? null : roomDoorFor(s, a, h, t);
      if (rd) {
        a.label = '방 진입 대기';
        // (R2 §4.2a) 잠긴 방 문을 동료가 폭파로 여는 중이면 각자의 물러설 자리로 (이 분기의 이동은 이것 하나)
        if (rd.blocking && t.entryDoor === rd.id && stackForCharge(sim, s, a, t, rd)) return;
        const m0 = moveTo(sim, s, a, rd.x, rd.y, 1.5);
        if (m0 === 'arrived') {
          t.ptI++;
          const mates = s.agents.filter((b) => b !== a && b.status === 'active' && b.task && b.task.kind === 'engage' && dist(b.x, b.y, rd.x, rd.y) <= 2.6);
          // (R3 §3.1 P07) 동료 없이 4초를 기다렸으면 교본에 묻는다: 혼자 방에 들어가지 않는다 (예외 — 총격 중이고 시민이 위험하면 · 상한 police.P07_WAIT(40초), 지원이 오면 P07_WAIT_BACKUP(120초))
          if (mates.length === 0 && t.ptI > 20 && gateStep(sim, s, a, t, 'roomEntry', docGate(sim, s, a, 'roomEntry')) === 'wait') { a.label = '단독 진입 보류'; return; }
          if (mates.length >= 1 || t.ptI > 20) {
            gateClear(sim, s, a, t);
            if (rd.blocking && lockedRoomDoor(sim, s, I, a, t, rd, mates)) return;      // (R2 §4.2a) 잠긴 방 문: 손잡이를 돌려 보고 → 한 사람이 문을 연다 (25초 상한)
            const wasLocked = rd.blocking, bySub = t.entryDoor === rd.id;      // bySub: 하위 작업이 이미 열었다 — 진입 기록은 unblock 이 남겼다
            rd.entered = true; rd.open = true; s.staticVersion++;
            if (rd.blocking) { s.propAt[rd.y * s.w + rd.x] = -1; rd.blocking = false; rd.locked = false; }
            if (!bySub || wasLocked) recBreach(sim, s, rd.x, rd.y, a.x, a.y, { door: rd.id, how: breachHowFor(sim, [a, ...mates], wasLocked, false), n: mates.length + 1, sync: false, by: a.rid, forced: wasLocked });
            const thrower = [a, ...mates].find((b) => kitUses(sim, b.rid, 'flashbang') > 0);
            let n = -1;
            if (thrower && sim.t - s.bangAt > 2 && dist(h.x, h.y, rd.x, rd.y) <= 8) {
              useKit(sim, thrower.rid, 'flashbang'); s.bangAt = sim.t;
              n = flashbang(sim, s, rd.x + (h.x - rd.x) * 0.6, rd.y + (h.y - rd.y) * 0.6, thrower);
            } else if (sim.t >= h.alertUntil) { h.facing = Math.atan2(rd.y - h.y, rd.x - h.x); h.alertUntil = sim.t + 5; }
            panicShot(sim, s, I, rd.x, rd.y);
            const room = s.region[tileOf(s, h.x, h.y)] >= 0 ? s.regions[s.region[tileOf(s, h.x, h.y)]].name : '방';
            emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 3, text: n >= 0 ? `${room} 진입! 섬광탄을 던져 넣고 들어갑니다${n ? ` (용의자 ${n}명 무력화)` : ''}.` : `${room} 진입!` });
            for (const b of [a, ...mates]) { b.path = null; b.pathGoal = -1; if (b.task) { b.task.ptI = 0; b.task.entryDoor = undefined; ENTERED.add(b.task); } }
          }
        } else if (m0 === 'nopath') { rd.entered = true; }
        return;
      }
      // (R2 §4.6) 총기 상대의 새 방법 — ①-2 다음 · ② 섬광탄 앞. 선택 임무: 처음 닿은 틱과, 방법이 아직 없으면 1초마다 고를 수 있는지 본다(비살상탄·저격 소총을 든 대원만 —
      // 9칸·협상 60초 같은 조건은 다가가는 동안에 맞게 된다). 고르지 않으면 지금의 분기 그대로. 쏜 틱·조준·다가가는 틱은 여기서 끝(한 틱에 moveTo 하나)
      if (t.method === undefined && (t.mt0 === undefined || sim.tick % 5 === 0) && (kitCount(sim, a.rid, 'beanbag') > 0 || hasKit(sim, a.rid, 'sniper'))) startMethod(sim, s, I, a, t, 'engage', { cas: -1, prop: -1, hostile: h.id, region: -1, tile: -1 });
      if (runBeanbag(sim, s, I, a, t, h, XK) || runSniper(sim, s, I, a, t, h, XK)) return;
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
            const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'resolve', imp: 3, text: `무력화된 ${h.label} 제압·검거!` });
            recordArrest(sim, I, a, t, h, s.breachDone || ENTERED.has(t) ? 'breach' : 'tackle', ev);      // (R2 §4.6) 무력화 수단(섬광탄·테이저·비살상탄)이 먼저
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
        // (R3 §3.1 P14) 현장 경찰 누구도 섬광탄이 없다: 동료가 곁에 있고 용의자가 등졌을 때만 바로 덮친다. 아니면 7.5칸 엄폐 자리에서 기다린다 (상한 20초 — 섬광탄을 가진 부대가 오면 40초, 그 뒤 지금 동작)
        if (gateStep(sim, s, a, t, 'closeIn', docGate(sim, s, a, 'closeIn')) === 'wait') {
          a.label = '섬광탄 없음 — 엄폐 대기';
          const cm = toCoverSpot(sim, s, a, t, h);
          if (cm === null && moveTo(sim, s, a, h.x, h.y, 7.5, true) === 'nopath') finishTask(sim, s, a, false, 'nopath');
          return;
        }
        // 섬광탄이 없다: 쏘지 않고 거리를 좁힌다. 용의자가 눈치채지 못하면 곁에서 덮치고(기습), 눈치채면 교전이 된다
        a.label = '사격 보류 — 접근해 제압';
        a.pathGoal = sim.t >= t.repathAt - 4.4 ? -1 : a.pathGoal;
        if (moveTo(sim, s, a, h.x, h.y, 1.3) === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (dist(a.x, a.y, h.x, h.y) <= 1.7) {
          t.progress += dt; a.ring = t.progress / 2.2;
          if (t.progress >= 2.2) {
            h.state = 'arrested'; h.path = null;
            learnQuiet(sim, a, hosFact(sim, s, h, r.name, dist(a.x, a.y, h.x, h.y)));
            const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'resolve', imp: 3, text: `${josa(h.label, '을/를')} 곁에서 덮쳐 제압·검거!` });
            recordArrest(sim, I, a, t, h, s.breachDone || ENTERED.has(t) ? 'breach' : 'tackle', ev);      // (R2 §4.6) 기록 전용
            recCuff(sim, s, h, a, 'tackle');
            r.xpGained += 0.006;
            finishTask(sim, s, a, true);
          }
        } else t.progress = 0;
        return;
      }
      t.progress = 0;
      // (R3 §3.1 P05) 엄폐 사격: 지금의 "7.5칸·시야 아무 자리" 대신 위협 둘레 고리의 엄폐 자리로 가서 쏜다 (자리는 임무에 담는다 — 없으면 지금대로)
      let viaCover = false, m: MoveRes = 'moving';
      let cf = COVER_FIRE.get(t);
      if (cf === undefined || sim.tick % 5 === 0) { cf = docGate(sim, s, a, 'coverFire').opt === 'cover'; COVER_FIRE.set(t, cf); }      // 교본의 고르기는 1초마다 다시 묻는다 (매 틱 묻지 않는다 — 속도)
      if (cf) {
        const had = t.cvX !== undefined && !Number.isNaN(t.cvX);
        const cm = toCoverSpot(sim, s, a, t, h);
        if (cm !== null) { viaCover = true; m = cm === 'nopath' ? 'moving' : cm; if (!had) docMark(sim, s, a, 'P05', 'gate', { gate: 'coverFire', tgt: 'h:' + h.id }); }
      }
      if (!viaCover) m = moveTo(sim, s, a, h.x, h.y, 7.5, true);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') { a.label = '진입'; return; }
      a.fx = h.x - a.x; a.fy = h.y - a.y;
      a.label = viaCover ? '엄폐 사격' : '교전';
      if (a.cooldown <= 0 && los(s, a.x, a.y, h.x, h.y)) {
        const up = h.state !== 'down';
        shootAt(sim, s, a, h.id);
        if (up && h.state === 'down') recordMethod(sim, I, a, t, 'cover', 'usual', true, -1, { cas: -1, prop: -1, hostile: h.id, region: -1, tile: -1 });      // (R2 §4.6) 엄폐 사격으로 쓰러뜨렸다 — 기록 전용
      }
      else if (!viaCover && !los(s, a.x, a.y, h.x, h.y)) a.pathGoal = -1;
      return;
    }
    case 'arrest': {
      const h = s.hostiles[t.hostile];
      if (h.state === 'arrested' || h.state === 'escaped' || h.state === 'down') { learn(sim, a, hosFact(sim, s, h, r.name, dist(a.x, a.y, h.x, h.y)), true, true); finishTask(sim, s, a, true); return; }
      if (h.state !== 'surrendered' && h.weapon === 'gun') { finishTask(sim, s, a, false, 'unsafe'); return; }
      // (N8 §4.4 — 단계 6a) 잠든 취객: 1.5칸까지 다가가 깨우기를 기다린다(세계 규칙 rowdyRule 이 경찰이 곁에 4초 머물면 깨운다) — 테이저·비살상탄·덮치기를 쓰지 않는다
      if (h.asleep) {
        const mw = moveTo(sim, s, a, h.x, h.y, 1.4);
        if (mw === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
        if (mw === 'arrived') { a.label = '흔들어 깨우는 중'; a.fx = h.x - a.x; a.fy = h.y - a.y; t.wake = (t.wake ?? 0) + dt; a.ring = Math.min(1, (t.wake ?? 0) / 4); }
        return;
      }
      if (tryTaser(sim, s, a, h)) { a.label = '테이저 발사'; return; }      // 덤벼드는 상대(총이 아닌)에게 테이저 — 쏜 틱에는 움직이지 않는다
      // (R2 §4.6) 비살상탄 — 테이저 다음 · closeIn 판단 지점 앞. 선택 임무: 처음 닿은 틱과, 방법이 아직 없으면 1초마다 고를 수 있는지 본다(비살상탄을 든 대원만). 쏜 틱·조준·다가가는 틱은 여기서 끝
      if (h.state !== 'surrendered' && t.method === undefined && (t.mt0 === undefined || sim.tick % 5 === 0) && kitCount(sim, a.rid, 'beanbag') > 0) startMethod(sim, s, I, a, t, 'arrest', { cas: -1, prop: -1, hostile: h.id, region: -1, tile: -1 });
      if (h.state !== 'surrendered' && runBeanbag(sim, s, I, a, t, h, XK)) return;
      // (R3 §3.1 P01~P03) 판단 지점 closeIn — 흉기·맨손 상대에게 붙기 전: 테이저를 든 둘은 무력화될 때까지 2칸에서(8초), 혼자면 3칸에서 거리를 두고 지원을(police.P02_WAIT 12초 · 지원 옴 18초 —
      // 시민이 위협 곁이면 바로), 동료가 멀면 3칸에서 기다렸다 함께(P03_WAIT 3초). 막히면 그 칸까지만 다가가 기다린다 (한 틱에 moveTo 하나), 상한 뒤에는 지금 동작
      if (h.state !== 'surrendered') {
        const gq = docGate(sim, s, a, 'closeIn', NO_SENSE, { stunned: sim.t < h.stunUntil });
        if (gateStep(sim, s, a, t, 'closeIn', gq) === 'wait') {
          const R = gq.rule === 'P01' ? STAND_TASER : STAND_KNIFE;
          a.label = ruleShort(gq.rule) ?? '거리 유지'; a.fx = h.x - a.x; a.fy = h.y - a.y;
          const d0 = dist(a.x, a.y, h.x, h.y);
          if (d0 > R + 0.3) { if (moveTo(sim, s, a, h.x, h.y, R) === 'nopath') finishTask(sim, s, a, false, 'nopath'); }
          else if (d0 < R - 0.5) {
            // 거리 유지: 이미 그보다 가까우면(맞서기 시작한 상대 곁에 서 있었다) 그 거리의 자리로 물러난다 — 흉기가 닿는 곳(1.8칸 안)에 선 채 기다리지 않는다
            const sp = standOffSpot(s, a, h, R);
            if (sp !== null) moveTo(sim, s, a, sp.x, sp.y, 0.3);
          }
          return;
        }
      }
      const m = moveTo(sim, s, a, h.x, h.y, 1.3);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      t.need = h.state === 'surrendered' ? 2.5 : 5; t.progress += dt; a.ring = t.progress / t.need;
      if (t.progress >= t.need) {
        const was = h.state;
        h.state = 'arrested';
        learnQuiet(sim, a, hosFact(sim, s, h, r.name, dist(a.x, a.y, h.x, h.y)));
        const ev = fights(sim, I, h, was) ? scuffle(sim, s, I, a, h)      // 맞서던 상대: 몸싸움 끝에 (H1 단계 4c)
          : emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'resolve', imp: 3, text: s.kind === 'disturb' ? disturbArrestText(I, s, h) : `${h.label} 검거 완료.` });      // (N8 단계 6a) 치안은 상황에 맞는 말
        if (was !== 'surrendered') recordArrest(sim, I, a, t, h, 'tackle', ev);      // (R2 §4.6) 테이저·비살상탄으로 무력화했으면 그 수단, 아니면 덮치기(방패수면 방패). 투항한 사람의 검거는 적지 않는다
        recCuff(sim, s, h, a, was === 'surrendered' ? 'surrender' : 'tackle');
        r.xpGained += 0.005;
        finishTask(sim, s, a, true);
      }
      return;
    }
    case 'interview': {
      const p = s.props[t.prop];
      if (p.skin === 'victim') { runVictimTalk(sim, s, I, a, t, p); return; }      // (N8 단계 6b) 수거책 잠복의 피해자 — 면담하면 약속 시각을 안다
      if (p.skin === 'operator') { runOperatorTalk(sim, s, I, a, t, p); return; }      // (N8 단계 8) 놀이기구 운영자 — 면담하면 전원 복구 예상 시각을 안다
      if (p.interviewed) { reportDone(sim, a, mkFact('evid', p.id, { kind: 'witness', done: true }, r.name, sim.t, 1, true, '목격자 면담 완료')); finishTask(sim, s, a, true); return; }
      const m = moveTo(sim, s, a, p.x, p.y, 1.5);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      t.need = 6; t.progress += dt; a.ring = t.progress / t.need;
      if (t.progress >= t.need) {
        p.interviewed = true;
        if (p.skin === 'neighbor') {      // (N8 단계 10 — N3 단순 민원) 이웃의 말을 듣고 서로 오해를 풀게 한다 — 대상의 자취는 없다
          learnQuiet(sim, a, mkFact('evid', p.id, { kind: 'witness', done: true }, r.name, sim.t, 1, true, '이웃 면담 완료'));
          emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: '이웃의 이야기를 듣고 서로 조심하기로 했습니다 — 다툼은 없었고 현장에서 중재해 마무리합니다.' });
          finishTask(sim, s, a, true);
          return;
        }
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
    // (N8 단계 4a — 설계서 §4.2) 시설물 복구: 유관 기관 복구반의 일. 시설물(fixture)의 곁(1.4칸)에서 작업을 마치면 그 시설물이 죽는다(live 거짓) — 효과는 여기 한 곳(진실을 바꾼다).
    // 이미 죽어 있으면(관제의 원격 차단 등) 본 대로 강제 보고하고 끝낸다(CLAUDE.md "이미 끝나 있던 일"). 관(수도·가스)·밸브는 단계 4b
    case 'repair': {
      const p = t.prop >= 0 ? s.props[t.prop] : undefined;
      if (!p || p.removed) { finishTask(sim, s, a, false, 'gone'); return; }
      if (p.kind === 'valve') { runSupplyCheck(sim, s, I, a, t, p); return; }      // (4b §5.3.8) 가스 밸브 — 공급 차단 확인
      if (p.skin === 'pipe') { runPipeShut(sim, s, I, a, t, p); return; }      // (4b) 터진 관 — 제수밸브 잠그기
      if (p.skin !== 'wire') { finishTask(sim, s, a, false, 'preempt'); return; }
      if (!p.live) { reportDone(sim, a, mkFact('haz', p.id, wireHaz(s, p, false), r.name, sim.t, 1, true, '전선에 전기가 흐르지 않음 — 확인')); finishTask(sim, s, a, true); return; }
      const m = moveTo(sim, s, a, p.x, p.y, 1.4);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      if (t.phase === 0) { t.phase = 1; emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: '절연 장비를 갖추고 끊어진 전선의 전원 차단 작업을 시작합니다.' }); }
      t.need = 16 / (0.7 + 0.3 * r.skills.rescue);
      t.progress += dt; a.ring = t.progress / t.need;
      if (t.progress >= t.need) {
        p.live = false;
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, text: '끊어진 전선의 전원을 차단하고 고정했습니다. 감전 위험이 사라졌습니다.' });
        reportDone(sim, a, mkFact('haz', p.id, wireHaz(s, p, false), r.name, sim.t, 1, true, '전선 전원 차단·고정 완료'));
        r.xpGained += 0.003;
        finishTask(sim, s, a, true);
      }
      return;
    }
    // (N8 단계 4a — 설계서 §5.10) 통제: 위협이 없는 현장의 한 자리(격자 칸 t.tile)를 지켜 사람의 접근을 막는다. 그 칸 0.8칸 안에 서 있는 동안 진행 막대가 시각에 따라 찬다
    // (원칙 11 — 설계된 기다림은 진행으로 보인다. 측정 도구의 교착 감지가 진전으로 센다). 끝은 지휘관이 믿음상 필요 없어졌을 때 거두는 것뿐이다(perimeter 와 같다)
    case 'cordon': {
      const m = moveTo(sim, s, a, t.tile % s.w, (t.tile / s.w) | 0, 0.8);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      t.progress += dt; a.ring = (t.progress % 30) / 30;
      a.label = '통제';
      // (N8 단계 6b §4.4) 잠복: 이 대원이 약속 시각을 알면 진행 막대가 그 시각으로 찬다(원칙 11 — 설계된 기다림)
      { const m = s.kind === 'disturb' ? meetOf(a) : null; if (m) { const t0 = sim.t - t.progress; a.ring = clamp(t.progress / Math.max(1, m.at - t0), 0, 1); a.label = dist(a.x, a.y, m.x, m.y) <= 3.5 ? '잠복' : '통제'; } }
      if (s.kind === 'rescue') { const at = powerAtOf(a); if (at > sim.t) { const t0 = sim.t - t.progress; a.ring = clamp(t.progress / Math.max(1, at - t0), 0, 1); } }      // (N8 단계 8) 놀이기구: 전원 복구 예상 시각으로 찬다 (원칙 11 — 설계된 기다림)
      return;
    }
    // (N8 단계 2a) 새 임무 셋의 빈 갈래 — 실행은 그 임무를 쓰는 단계가 채운다(capture 5 · towAway 6b · persuade 7, 설계서 §4·§5.9).
    // 지금은 아무도 이 작업을 만들지 않고 fitFor 가 0 이라 닿지 않는다. 닿으면 내려놓는다 (임무를 쥔 채 제자리에 서 있지 않게)
    // (N8 §4.3 — 단계 5) 동물 포획: 벌집(소품 — 벌 보호복을 든 대원이 1.5칸 안에서 25초, 떼어 내는 동안 반경이 4.5 로 커진다) ·
    // 동물(t.animal — R2 방법: 마취총 6칸 안·시야선 · 올가미 1.5칸 · 몰이 뒤에서 · 포획망 잠든 대상 6초). 동물의 진실(s.animals)은 실행부만 읽는다
    case 'capture': {
      if (t.prop >= 0) { runHiveRemove(sim, s, I, a, t); return; }
      runCapture(sim, s, I, a, t);
      return;
    }
    case 'towAway': { runTowAway(sim, s, I, a, t); return; }      // (N8 단계 6b §5.3.8) 견인 — 차로를 막은 부서진 차
    // (N8 §5.9 — 단계 9 가 먼저 쓴다) 설득: 대상(구조 대상) 2칸 안에 서서 말을 건넨다 — 효과는 세계 규칙이 정한다(약물 과다의 흥분 — rules/kinds.ts overdoseRule).
    // 끝은 지휘 규칙이 믿음상 필요 없어졌을 때 거두는 것뿐이다(진행 막대는 시각에 따라 돈다 — 원칙 11)
    case 'persuade': {
      const c = s.casualties[t.cas];
      if (!c || c.dead || c.where !== 'scene') { if (c) learn(sim, a, casFact(sim, s, c, r.name), true, true); finishTask(sim, s, a, true); return; }
      const m = moveTo(sim, s, a, c.x, c.y, 2.0);
      if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
      if (m !== 'arrived') return;
      if (t.phase === 0) { t.phase = 1; emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `구조 대상 ${c.label}에게 말을 걸기 시작합니다.` }); }
      t.progress += dt; a.ring = (t.progress % 20) / 20; a.label = '설득'; a.fx = c.x - a.x; a.fy = c.y - a.y;
      return;
    }
    // (N9 단계 1) 제독의 빈 갈래 — 실행(제독 자리로 데려가 15·30·45초)은 단계 6 이 채운다(설계서 §5.5). 지금은 아무도 이 작업을 만들지 않고 fitFor 가 0 이라 닿지 않는다.
    // 닿으면 내려놓는다 (임무를 쥔 채 제자리에 서 있지 않게)
    case 'decontam': {
      finishTask(sim, s, a, false, 'preempt');
      return;
    }
    case 'evacuate': runEvacuate(sim, s, a, t); return;      // (X6 §5.1) 철수 이동
    case 'ashore': {
      // (R2 1b §3.5) 물 위의 대원이 뭍으로: 목표는 처음 한 번 정한다(강 한가운데서 두 기슭 사이를 오가지 않게) — 가장 가까운, 걸어서 닿는 뭍 칸 → 안전 구역 → 대기 지점.
      // 헤엄 중이면 헤엄 비용(costFor), 보트 위면 보트 비용으로 그 뭍 칸 둘레의 물 칸에서 멈춘 뒤 뭍에 오른다. 길이 없거나 30초가 넘으면 안전장치(pullAshore)
      if (!onWater(s, a) && a.afloat === undefined) { finishTask(sim, s, a, true); return; }
      if (t.phase === 0) { const b = reachOf(s, a.x, a.y, 4, a) ?? s.safe ?? s.staging; t.tx = b.x; t.ty = b.y; t.phase = 1; }
      const m = moveTo(sim, s, a, t.tx, t.ty, a.afloat !== undefined ? 1.5 : 0.3);
      if (m === 'nopath' || sim.t - t.startedAt > 30) { pullAshore(sim, s, I, a, '경로 없음'); finishTask(sim, s, a, true); return; }
      if (a.afloat !== undefined && m === 'arrived') { a.x = t.tx; a.y = t.ty; a.afloat = undefined; finishTask(sim, s, a, true); return; }
      if (!onWater(s, a) && a.afloat === undefined) finishTask(sim, s, a, true);
      return;
    }
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
        // (R3 F10) 예비 펌프를 하나 쓴다 (셀 때만 — 오는 동안 마지막 하나를 다른 대원이 썼으면 바꾸지 못한다: 지휘관이 진압 부대 교체를 부른다 — CF3)
        if (u.sparePump !== undefined) {
          if (u.sparePump <= 0) { emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'radio', imp: 1, text: `${u.callsign} 예비 펌프가 없습니다.` }); finishTask(sim, s, a, false); return; }
          u.sparePump--;
        }
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
    case 'cover': runCover(sim, s, a, t, XK); return;      // (R3 §2.10) 엄폐 — 숨을 자리에서 쏘지 않고 기다린다
    case 'airOut': runAirOut(sim, s, a, t, XK); return;      // (R3 §5.7) 공기 탈출 — 밖으로 나가 공기통 교체
    case 'pairOut': runPairOut(sim, s, a, t, XK); return;      // (R3 §5.7) 짝 따라 나가기
    case 'pair': runPair(sim, s, a, t, XK); return;      // (R3 §5.4) 짝 동행 — 위험 실내 일을 맡은 짝을 따라간다
    case 'rearm': runRearm(sim, s, a, t, XK); return;      // (R3 §2.9) 탄약 보급 — 대기 지점의 차에서
    case 'triage': runTriage(sim, s, a, t, XK); return;      // (R3 4단계 E01·CE1) 다수 사상자 분류 — 환자마다 곁에서 2초, 끝나면 s.triageAt
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
  if (a.reloadUntil !== undefined && a.reloadUntil <= sim.t) reloadTick(sim, a);      // (R3 §2.9) 재장전이 끝났다 — 빈 탄창을 채운다
  // (R2 1b) 물 위의 매 틱 효과는 한 곳에서 (임무가 없어도 — 헤엄·보트·뭍으로·철수 중 모두). 뭍에 오르면 들어간 시각을 지운다
  if (a.wetSince !== undefined || a.afloat !== undefined || s.tiles[tileOf(s, a.x, a.y)] === T.WATER) waterTick(sim, s, sim.incidents[s.incidentId], a, XK);
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
import { dropWet, pullAshore, runWaterRescue, waterTick } from './methodRun';
// (R2 1b) 물 위의 대원: 헤엄 중인가·헤엄 비용·수영 능력·가장 가까운 뭍 (판단부의 생김새 함수 — methods.ts 는 이 파일을 import 하지 않는다)
import { boatCost, onWater, reachOf, swimCost, swimOf } from './methods';
import type { CostFn } from './grid';
export const XK: ExecKit = { moveTo, finish: finishTask, drain, spray, makeTask, unblock };
// (R2 단계 2) 문·통로의 방법: 고르기(startMethod)·속도·장비 확인·소리·폭파 진입·방법 기록 — 고르는 것은 판단부, 효과는 methodRun
import { switchMethod } from './methodRun';
import { dartHit } from './animals';      // (N8 단계 5) 마취 화살이 맞은 동물
import { RAPID_HURT, blockerKitFails, blockerRate, doorNoise, extricateDoneText, extricatePrep, extricateRate, recheckOnArrive, recordArrest, recordMethod, runBeanbag, runCharge, runExtinguisher, runSniper, runSuppress, runVentFirst, searchStop, stackSpot, startMethod, tunnelSlide } from './methodRun';
import { kitCount, roleIdOf } from './gear';
/** (R2 §4.6) 동시 진입·방 진입을 함께 한 임무 — 그 뒤의 검거는 'breach' 로 적는다 (임무의 모양을 바꾸지 않으려 WeakSet) */
const ENTERED = new WeakSet<Task>();
import { METHOD, NO_SENSE, chooseMethod, herdAllowed } from './methods';
import type { BreachHow, MethodId } from '../types';

// ── (R3) 대응 교본의 판단 지점 (field/doctrine.ts 의 docGate — 자기 모드). 판단은 교본 함수가, 효과(이동·기다림)는 이 파일이 한다 ──
import { docGate } from './doctrine';
import { actEnd, docMark, fireRound, gateClear, gateStep, reloadTick, ruleShort, runCover, runRearm } from './doctrineRun';
import { recordDoc, runDefuse } from './doctrineRun';      // (R3 5단계) 해체 방법 셋 · 줄 서기(S01)의 기록
import { coverSpot } from './doctrine';

// ── (X6 단계 5) 지휘 상태의 도움 함수 (진입 금지 구역·외부 방수 자리·철수 지점 — ops.ts 는 진실을 읽지 않는다. 불을 고르는 것은 이 파일이다) ──
import { EXT_RANGE, OPS_ID, OPS_PAR, SIGN_BASE, evacPoint, exteriorSpots, opsExterior, regionAt, regionLevel, regionReachable, zoneMask } from './ops';
import type { OpsFact, ZoneLike } from './ops';

// ── (R3 3단계 — 소방) 짝 동행·공기 탈출·짝 따라 나가기의 실행, 위험 실내 첫걸음의 판단 지점(interiorEntry), 벽 더듬기·끊어 쏘기의 효과 ──
import { gatePassed, runAirOut, runPair, runPairOut, docRemember } from './doctrineRun';
import { DOC, hasDoc } from './doctrine';
import { selfDc, senseOf } from './methodRun';
/** (R3 §3.7) 벽 더듬기의 경유점 간격 배율 · 끊어 쏘기의 효과·물 배율 */
const FEEL_SPACING = 0.75, PULSE_MUL = [0.85, 0.65] as const;
/** 벽 더듬기로 경유점을 짠 수색 임무 (임무의 모양을 바꾸지 않으려 WeakSet) */
const FEEL_PTS = new WeakSet<Task>();
/** 벽(창)과 맞닿은 칸인가 (네 이웃) — 벽 더듬기의 경유점 */
function wallNext(s: Scene, x: number, y: number): boolean {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) return true; const tt = s.tiles[ny * s.w + nx]; if (tt === T.WALL || tt === T.WINDOW) return true; }
  return false;
}
/** 판단 지점 interiorEntry 를 묻는 임무 (§11.1 — 위험 실내 일 여섯과 진압) */
const INTERIOR_KINDS: ReadonlySet<string> = new Set<string>(['search', 'carry', 'escort', 'extricate', 'mitigate', 'overhaul', 'suppress']);
/**
 * 위험 실내로 들어서는 첫걸음인가: 지금 칸이 실내 구역이 아니고 다음 칸이 실내 구역이다 (판단은 교본이 한다 — 위험 실내·확보 전 무장 현장인지는 줄이 믿음으로 본다).
 * 진압은 실내 방법(내부 공격·끊어 쏘기·방법 없음)일 때만 — 교본이 실내 진압을 뺀 대원은 외부 방수라 여기 오지 않는다
 */
function interiorStep(s: Scene, a: FieldAgent, t: Task, next: number): boolean {
  if (!hasDoc('gate')) return false;
  if (t.kind === 'suppress' && t.method !== undefined && t.method !== 'interior' && t.method !== 'pulse') return false;
  if (t.kind === 'carry' && a.carrying !== -1) return false;      // 업고 나오는 길
  const here = s.region[tileOf(s, a.x, a.y)], there = s.region[next];
  return !regionIndoor(s, here) && regionIndoor(s, there);
}
/** 실내 구역인가 (R3 속도 — interiorStep 의 닫힘을 모듈 함수로: tsx 의 __name) */
function regionIndoor(s: Scene, rg: number): boolean { return rg >= 0 && s.regions[rg] !== undefined && s.regions[rg].indoor; }
/**
 * 판단 지점 interiorEntry (F04c 짝이 따라오지 않음 · F05 밖 대기조 모자람 · P17b 확보 전 수색의 짝): 막히면 문턱에서 기다린다('wait').
 * 상한(20초, 지원이 오면 30초)이면 임무를 놓는다 — finishTask(…, 'doctrine')(실패 기록·w.fails 없음), 작업에 holdUntil +10초, 대원에게 그 작업을 30초 맡지 않는 기억('w:<작업 id>')
 */
function interiorGate(sim: Sim, s: Scene, a: FieldAgent, t: Task): 'wait' | 'go' | 'dropped' {
  const ans = docGate(sim, s, a, 'interiorEntry', senseOf(s, a));
  const st = gateStep(sim, s, a, t, 'interiorEntry', ans);
  if (st === 'go') return 'go';
  if (st === 'wait') { a.label = ruleShort(ans.rule) ?? a.label; return 'wait'; }
  const w = t.workId >= 0 ? s.board[t.workId] : undefined;
  finishTask(sim, s, a, false, 'doctrine');
  if (w !== undefined) { w.holdUntil = Math.max(w.holdUntil, sim.t + 10); docRemember(sim, a, ans.rule ?? 'F04c', 'w:' + w.id, DOC.W_MEM); }
  return 'dropped';
}
// ── (R3 4단계) 의료 교본의 실행 (doctrineRun.ts — 분류·처치 넘겨받기·경계 밖 처치소·판단 지점 carryHold·laneTreat) ──
import { careMark, carryHold, laneHold, runTriage, tryHandover } from './doctrineRun';
// ── (R3 6단계) 이송·교통 통제 방법의 실행 (doctrineRun.ts — 끌기·들것·척추 고정 · 차량 차단) ──
import { CARRY, carryDone, dragging, runCarry, runTraffic } from './doctrineRun';

// ───────────────────────── (N8 §4.3 — 단계 5) 동물 포획의 실행부 ─────────────────────────
/** 포획 실행의 상수: 벌집 떼기 25초 · 올가미 4초 · 포획망 6초 · 마취총 조준 1.5초·사거리 6·다시 쏘기 3초 · 몰이의 뒤 거리 2.5 (가축이 흥분하는 2칸 밖) */
export const CAPTURE = { hive: 25, pole: 4, net: 6, aim: 1.5, dartR: 6, reAim: 3, herdBack: 2.5, poleAgit: 0.6 };
/** (N8 §4.4 — 단계 6a) 치안 현장의 검거 문구 (실행부 — 진실을 읽는다): 주취자는 보호 조치(귀가 · 머리 부상이면 병원) 또는 손님을 다치게 했으면 현행범 체포 · 폭행 시비는 현행범 체포 · 날치기는 가방 회수 */
function disturbArrestText(I: Incident, s: Scene, h: Hostile): string {
  if (s.variant === 'snatch') return `${h.label} 검거 — 가방을 회수했습니다.`;
  if (s.variant === 'scam') return `${h.label} 현행범 체포 — 받은 돈 봉투를 회수했습니다.`;      // (N8 단계 6b)
  if (s.variant === 'cartheft') return `${h.label} 검거 — 도난 차량을 확보했습니다.`;
  if (s.variant === 'brawl') return `${h.label} 현행범 체포.`;
  if (I.problems.some((p) => p.code === 'ESCALATION')) return `${h.label} 현행범 체포 — 손님을 다치게 했습니다.`;
  return s.kinds && s.kinds.headInjury ? `${h.label} 보호 조치 — 머리를 다쳐 병원 이송이 필요합니다.` : `${h.label} 보호 조치 — 귀가 조치합니다.`;
}
/** 마취 화살의 명중 확률 (설계서 §4.3): 0.55 + 0.3 × 숙련 − 0.04 × 거리, 0.1~0.95 */
export function dartHitP(skill: number, d: number): number { return clamp(0.55 + 0.3 * skill - 0.04 * d, 0.1, 0.95); }
/** 그 동물의 지금 'ani' 사실 (본 대로 — 실행부는 진실을 읽어 알린다) */
function aniNow(sim: Sim, x: Animal, src: string, why: string): Fact {
  const st = x.state === 'caught' ? 'caught' : x.state === 'gone' ? 'gone' : x.state === 'sedated' ? 'sedated' : 'loose';
  return mkFact('ani', x.id, { kind: x.kind, x: Math.round(x.x), y: Math.round(x.y), state: st, via: x.via ?? undefined, lost: undefined }, src, sim.t, 1, true, why);
}
/** 벌집 떼어 내기 (보호복) */
function runHiveRemove(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task): void {
  const dt = sim.dt;
  const r = resp(sim, a), p = s.props[t.prop];
  if (!p || p.removed || p.skin !== 'hive') { finishTask(sim, s, a, false, 'gone'); return; }
  if (p.live !== true) { reportDone(sim, a, mkFact('haz', p.id, { kind: 'hive', active: false, x: p.x, y: p.y, r: 3 }, r.name, sim.t, 1, true, '벌집 제거 확인')); finishTask(sim, s, a, true); return; }
  const m = moveTo(sim, s, a, p.x, p.y, 1.5);
  if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
  if (m !== 'arrived') return;
  if (t.phase === 0) {
    t.phase = 1;
    if (s.kinds) s.kinds.hiveWide = sim.t;
    emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: '벌 보호복을 입고 벌집을 떼어 냅니다. 주변으로 벌이 퍼집니다 — 접근 금지.' });
  }
  t.need = CAPTURE.hive; t.progress += dt; a.ring = t.progress / t.need; a.label = '벌집 제거';
  if (t.progress >= t.need) {
    p.live = false;
    emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, text: '벌집을 떼어 내 자루에 담았습니다. 벌 쏘임 위험이 사라졌습니다.' });
    reportDone(sim, a, mkFact('haz', p.id, { kind: 'hive', active: false, x: p.x, y: p.y, r: 3 }, r.name, sim.t, 1, true, '벌집 제거 완료'));
    r.xpGained += 0.003;
    finishTask(sim, s, a, true);
  }
}
/** 동물 포획 (R2 방법: 마취총 · 올가미 · 몰이 · 포획망) */
function runCapture(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task): void {
  const dt = sim.dt;
  const r = resp(sim, a), aid = t.animal ?? -1;
  const x = s.animals && aid >= 0 ? s.animals[aid] : undefined;
  if (!x) { finishTask(sim, s, a, false, 'gone'); return; }
  if (x.state === 'caught' || x.state === 'gone') { reportDone(sim, a, aniNow(sim, x, r.name, x.state === 'caught' ? `${x.label} 포획 확인` : `${x.label} — 현장을 벗어남`)); finishTask(sim, s, a, true); return; }
  const tg = { cas: -1, prop: -1, hostile: -1, region: -1, tile: -1, animal: aid };
  if (t.method === undefined) {
    if (!startMethod(sim, s, I, a, t, 'capture', tg)) { finishTask(sim, s, a, false, 'nomethod'); return; }
    if (t.method === undefined) { finishTask(sim, s, a, false, 'nomethod'); return; }
  }
  const d = dist(a.x, a.y, x.x, x.y);
  const m = t.method;
  if (m === 'net' || (m === 'catchpole' && x.state === 'sedated')) {
    if (x.state !== 'sedated' && m === 'net') { if (!switchMethod(sim, s, I, a, t, 'tooFar', `${josa(x.label, '이/가')} 아직 깨어 있음`)) finishTask(sim, s, a, false, 'nomethod'); return; }
    const mv = moveTo(sim, s, a, x.x, x.y, 1.2);
    if (mv === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
    if (mv !== 'arrived') return;
    t.need = m === 'net' ? CAPTURE.net : CAPTURE.pole; t.progress += dt; a.ring = t.progress / t.need; a.label = METHOD[m].label;
    if (t.progress >= t.need) captured(sim, s, I, a, t, x);
    return;
  }
  if (m === 'catchpole') {
    // 흥분한 동물은 올가미를 피한다: 접은 기억을 남기고(60초) 물러선다 — 같은 대상에 다시 고를 방법이 올가미뿐이면 그 자리에서 되풀이하지 않게 작업을 놓는다(실패 기억 25초)
    if (d <= 3 && x.agit > CAPTURE.poleAgit) { switchMethod(sim, s, I, a, t, 'failed', `${josa(x.label, '이/가')} 흥분해 올가미를 피함`, false, { say: `${josa(x.label, '이/가')} 흥분해 올가미를 피함 — 물러서서 가라앉기를 기다립니다.` }); finishTask(sim, s, a, false, 'danger'); return; }
    const mv = moveTo(sim, s, a, x.x, x.y, 1.4);
    if (mv === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
    if (mv !== 'arrived') { t.progress = 0; return; }
    t.need = CAPTURE.pole; t.progress += dt; a.ring = t.progress / t.need; a.label = METHOD.catchpole.label;
    if (t.progress >= t.need) captured(sim, s, I, a, t, x);
    return;
  }
  if (m === 'dart') {
    if (x.state === 'sedated') { reportDone(sim, a, aniNow(sim, x, r.name, `${x.label} 마취되어 잠듦`)); finishTask(sim, s, a, true); return; }
    // 이미 맞혔다: 잠들 때까지 사거리 안에서 지켜본다 (진행 막대가 잠드는 시각으로 찬다 — 설계된 기다림)
    if (x.sedate > 0) {
      if (d > CAPTURE.dartR || !los(s, a.x, a.y, x.x, x.y)) { moveTo(sim, s, a, x.x, x.y, CAPTURE.dartR - 1, true); return; }
      a.label = '마취 대기'; a.ring = x.sedate;
      return;
    }
    // 조준 시간은 t.progress 에 센다 (t.wait 는 runTask 머리의 공통 멈춤 — 거기에 쓰면 다음 틱에 깎여 조준이 끝나지 않는다)
    if (d > CAPTURE.dartR - 0.5 || !los(s, a.x, a.y, x.x, x.y)) { const mv = moveTo(sim, s, a, x.x, x.y, CAPTURE.dartR - 1.5, true); if (mv === 'nopath') finishTask(sim, s, a, false, 'nopath'); if (t.progress > 0) t.progress = 0; return; }
    a.fx = x.x - a.x; a.fy = x.y - a.y; a.label = METHOD.dart.label;
    t.progress += dt; a.ring = Math.max(0, Math.min(1, t.progress / CAPTURE.aim));
    if (t.progress < CAPTURE.aim) return;
    t.progress = CAPTURE.aim - CAPTURE.reAim;      // 다음 조준까지 (음수에서 다시 찬다)
    // 다음 방법이 없으면(포획 작업은 WORK_MODE 'refuse') switchMethod 가 방법을 그대로 두고 거짓을 돌려준다 — 그 자리에서 작업을 놓는다 (놓지 않으면 같은 고장을 틱마다 다시 셌다)
    if (!kitWorks(sim, a.rid, 'dart', I)) { if (!switchMethod(sim, s, I, a, t, 'broken', '마취총 고장')) finishTask(sim, s, a, false, 'nomethod'); return; }
    if (kitUses(sim, a.rid, 'dart') <= 0) { if (!switchMethod(sim, s, I, a, t, 'failed', '마취 화살이 떨어짐')) finishTask(sim, s, a, false, 'nomethod'); return; }
    useKit(sim, a.rid, 'dart');
    const p = dartHitP(r.skill, d);
    if (kitRng(sim, s).chance(p)) {
      dartHit(sim, x, kitRng(sim, s));
      emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `마취총 명중 — ${josa(x.label, '이/가')} 곧 잠듭니다. 거리를 두고 기다립니다.` });
    } else {
      t.mtry = (t.mtry ?? 0) + 1;
      emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `마취총이 빗나갔습니다 (남은 화살 ${kitUses(sim, a.rid, 'dart')}).` });
    }
    return;
  }
  // 몰이: 대상 뒤(우리·산 출구의 반대쪽 2.2칸)에 선다 — 동물은 가장 가까운 사람에게서 멀어지는 쪽으로 간다. 함께 모는 동료는 좌우로 비킨다
  if (m === 'herd') {
    if (x.state === 'sedated') { finishTask(sim, s, a, true); return; }
    // 맨손 몰이는 포획 장비를 든 대원이 없을 때의 대신이다: 포획팀이 닿았으면(가축이 아니면) 손을 떼고 넘긴다 — 쥔 채 있으면 작업의 자리(1명)를 막아 포획팀이 맡지 못했다
    const hw = t.workId >= 0 ? s.board[t.workId] : null;
    const ab = a.beliefs.val<AniBelief>('ani', aid);
    if (ab && !herdAllowed(sim, s, a, ab, hw ? sim.t - hw.createdAt : 0)) { finishTask(sim, s, a, false, 'handover'); return; }
    let gx = s.staging.x, gy = s.staging.y;
    const pen = s.kinds && s.kinds.pen !== undefined ? s.regions[s.kinds.pen] : undefined;
    if (pen && (x.kind === 'cow' || x.kind === 'pig')) { gx = pen.cx; gy = pen.cy; }
    else if (s.exitKind) {
      let bd = Infinity;
      for (let k = 0; k < s.exits.length; k++) if (s.exitKind[k] === 'wild') { const e = s.exits[k], dd = dist(e.x, e.y, x.x, x.y); if (dd < bd) { bd = dd; gx = e.x; gy = e.y; } }
    }
    const vx = x.x - gx, vy = x.y - gy, n = Math.max(0.1, Math.hypot(vx, vy));
    let side = 0;
    for (const b of s.agents) if (b !== a && b.status === 'active' && b.task !== null && b.task.kind === 'capture' && (b.task.animal ?? -1) === aid) side++;
    const off = side === 0 ? 0 : side % 2 ? 1.4 : -1.4;
    const hx = Math.max(1, Math.min(s.w - 2, Math.round(x.x + (vx / n) * CAPTURE.herdBack - (vy / n) * off)));
    const hy = Math.max(1, Math.min(s.h - 2, Math.round(x.y + (vy / n) * CAPTURE.herdBack + (vx / n) * off)));
    // 뒤 자리가 벽·울타리·우리 안이면 가장 가까운 걸을 수 있는 칸으로 (3칸 안) — 그래도 길이 없으면 동물 곁 2.5칸까지만 다가간다(가장 가까운 사람에게서 멀어지므로 그것도 민다)
    // (t.range = 1: 뒤 자리로 가는 길이 없었다 — t.tx 시각까지 8초 동안 곁으로만 다가간다. 한 틱에 목표 둘을 번갈아 두지 않게)
    const hp = t.range === 1 && sim.t < t.tx ? -1 : passNear(s, hx, hy, 3);
    let mv = hp >= 0 ? moveTo(sim, s, a, hp % s.w, (hp / s.w) | 0, 0.8) : 'nopath';
    if (mv === 'nopath') { if (hp >= 0) { t.range = 1; t.tx = sim.t + 8; } mv = moveTo(sim, s, a, x.x, x.y, 2.5); }
    if (mv === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
    a.label = METHOD.herd.label; t.progress += dt; a.ring = (t.progress % 20) / 20;
    return;
  }
  finishTask(sim, s, a, false, 'nomethod');
}
/** (x, y) 에서 R 칸 안의 가장 가까운 걸을 수 있는 칸 (소품 없음) — 없으면 −1 */
function passNear(s: Scene, x: number, y: number, R: number): number {
  let best = -1, bd = Infinity;
  for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
    const tx = x + dx, ty = y + dy;
    if (tx < 1 || ty < 1 || tx > s.w - 2 || ty > s.h - 2) continue;
    const i = ty * s.w + tx;
    if (!staticPass(s.tiles[i]) || s.propAt[i] >= 0) continue;
    const d = dx * dx + dy * dy;
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
/** 잡았다 (올가미·포획망): 동물 caught · 기록 · 방법 기록 · 강제 보고 */
function captured(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, x: Animal): void {
  const r = resp(sim, a);
  x.state = 'caught'; x.path = null;
  const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'resolve', imp: 2, text: `${x.label} 포획 완료.` });
  if (t.method !== undefined) recordMethod(sim, I, a, t, t.method, t.mwhy ?? 'usual', true, ev, { cas: -1, prop: -1, hostile: -1, region: -1, tile: -1, animal: x.id });
  reportDone(sim, a, aniNow(sim, x, r.name, `${x.label} 포획 완료`));
  r.xpGained += 0.003;
  finishTask(sim, s, a, true);
}

// ───────────────────────── (N8 단계 6b) 치안·견인의 실행부 ─────────────────────────
import { laborAtOf, meetOf, powerAtOf, wreckFact } from './agents';
/** 견인: 견인 장비를 단 차를 부서진 차 곁(1.6칸)에 대고 20초 — 끝나면 차가 치워지고(removed) 차로가 열린다. 탑승자가 아직 차 안에 있으면 기다린다(구출이 먼저). 효과는 여기 한 곳 */
export const TOW = { work: 20, range: 1.6 };
function runTowAway(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task): void {
  const r = resp(sim, a);
  const p = t.prop >= 0 ? s.props[t.prop] : undefined;
  if (!p || p.removed || p.cleared) { if (p) reportDone(sim, a, wreckFact(sim, p, r.name, false)); finishTask(sim, s, a, true); return; }
  const m = moveTo(sim, s, a, p.x + (p.w - 1) / 2, p.y, TOW.range);
  if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
  if (m !== 'arrived') return;
  if (s.casualties.some((c) => !c.dead && c.where === 'scene' && c.inVehicle === p.id)) { a.label = '탑승자 구조 대기'; return; }
  if (t.phase === 0) { t.phase = 1; emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: '견인 장비를 연결합니다 — 차로를 막은 차량을 끌어냅니다.' }); }
  t.need = TOW.work; t.progress += sim.dt; a.ring = t.progress / t.need; a.label = '차량 견인';
  if (t.progress < t.need) return;
  for (let yy = p.y; yy < p.y + p.h; yy++) for (let xx = p.x; xx < p.x + p.w; xx++) if (s.propAt[yy * s.w + xx] === p.id) s.propAt[yy * s.w + xx] = -1;
  p.removed = true; p.cleared = true; p.blocking = false;      // cleared 도: 핵심 규칙의 도로 정리는 치우지 않은 차(!cleared)에 다시 낸다
  s.staticVersion++;
  emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 1, text: '부서진 차량을 견인했습니다. 차로가 열렸습니다.' });
  reportDone(sim, a, wreckFact(sim, p, r.name, false));
  finishTask(sim, s, a, true);
}
/** 수거책 잠복의 피해자 면담 (6초): 피해자가 말한 약속 시각(진실 s.kinds.meetAt — 실제 시각 ± 20초)과 자리를 믿음 evid meet 으로 — 사실의 id 는 피해자 소품의 id (면담 전의 'witness' 사실을 바꾼다) */
/**
 * (N8 단계 8 §4.6 ride) 놀이기구 운영자 면담: 곁에서 6초 → 믿음 evid power { at } (운영자가 말하는 전원 복구 예상 시각 — 진실 s.kinds.powerSay. 복구되지 않는 40% 에도
 * "곧 됩니다"라고 할 수 있다 — 틀릴 수 있는 진술). 이미 면담했으면 강제 보고만 (낡은 믿음의 되풀이 막기)
 */
function runOperatorTalk(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, p: Prop): void {
  const r = resp(sim, a);
  const at = s.kinds && s.kinds.powerSay !== undefined ? s.kinds.powerSay : Infinity;
  const left = Math.max(10, Math.round((at - sim.t) / 10) * 10);
  const f = mkFact('evid', p.id, { kind: 'power', at, done: true }, r.name, sim.t, 0.8, true, at < Infinity ? `운영자 진술: 전원이 ${at > sim.t ? `약 ${left}초 뒤` : '곧'} 돌아온다고 함` : '운영자 진술: 전원 복구는 어렵다고 함');
  if (p.interviewed) { reportDone(sim, a, f); finishTask(sim, s, a, true); return; }
  const m = moveTo(sim, s, a, p.x, p.y, 1.5);
  if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
  if (m !== 'arrived') return;
  t.need = 6; t.progress += sim.dt; a.ring = t.progress / t.need;
  if (t.progress < t.need) return;
  p.interviewed = true;
  emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: at < Infinity ? `운영자 면담 완료. 전원이 ${at > sim.t ? `약 ${left}초 뒤` : '곧'} 돌아온다는 진술을 확보했습니다.` : '운영자 면담 완료. 전원 복구는 어렵다고 합니다 — 직접 내리겠습니다.' });
  reportDone(sim, a, f);
  finishTask(sim, s, a, true);
}
function runVictimTalk(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, p: Prop): void {
  const r = resp(sim, a);
  const at = s.kinds && s.kinds.meetAt !== undefined ? s.kinds.meetAt : sim.t;
  const fact = (): Fact => mkFact('evid', p.id, { kind: 'meet', at, x: p.x, y: p.y, done: true }, r.name, sim.t, 0.9, true, `피해자 진술: 수거책과 ${Math.max(0, Math.round((at - sim.t) / 10) * 10)}초쯤 뒤 이 자리에서 만나기로 함`);
  if (p.interviewed) { reportDone(sim, a, fact()); finishTask(sim, s, a, true); return; }
  const m = moveTo(sim, s, a, p.x, p.y, 1.5);
  if (m === 'nopath') { finishTask(sim, s, a, false, 'nopath'); return; }
  if (m !== 'arrived') return;
  t.need = 6; t.progress += sim.dt; a.ring = t.progress / t.need;
  if (t.progress < t.need) return;
  p.interviewed = true;
  emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `피해자 면담 완료. 돈을 받으러 오는 사람과 ${at > sim.t ? `약 ${Math.max(10, Math.round((at - sim.t) / 10) * 10)}초 뒤` : '이미 약속한 시각에'} 이 자리에서 만나기로 했다는 진술을 확보했습니다.` });
  reportDone(sim, a, fact());
  finishTask(sim, s, a, true);
}
