// 대응 방법의 실행부 (docs/specs/R2-methods.md §3.5·§3.6). 판단부(methods.ts)가 고른 방법을 임무에 적고, 접고, 기록한다.
// executor.ts 와 같은 자격이다: 진실을 읽고 상태를 바꾼다. 기록은 상태를 바꾸는 바로 그 자리에서만 남긴다.
//
// executor.ts 를 import 하지 않는다(순환). 실행기의 함수가 필요한 곳은 실행기가 건네는 도구(ExecKit — executor.XK)로 부른다.
// 장비는 gear.ts 로만 본다(효과용 kitWorks·useKit·bestTool 은 여기서만 부른다 — 판단부는 부르지 않는다).
//
// 난수: 방법의 판정(투척 명중·잡기·헤엄 중 사고·보트 전복·비살상탄·저격·터널 붕락)은 전부 mrng — 대원마다 method:<사건>:<rid>:<k>.
//   a.rng(판단 오차·제거 시간 추정)·s.rng(사격·용의자)·kit·kit:<현장>·injury:<현장>·roster-* 에 호출을 끼우지 않는다(무관한 결과까지 바뀐다).
//
// 단계 0 (틀): 공통 함수만 있다 — 아직 아무도 부르지 않는다(결과 불변). 방법별 실행(runWaterRescue·landCasualty·waterTick·pullAshore·blockerRate·runSuppress …)은
// 그 방법을 구현하는 단계가 이 파일에 더한다.

import type { Sim } from '../engine';
import { emit, lastProblemEvent, raiseProblem } from '../events';
import type { Rng } from '../rng';
import type { Casualty, FieldAgent, Incident, MethodId, MethodUse, MethodWhy, Problem, Scene, Task, TaskKind, Unit, WorkKind } from '../types';
import { josa } from '../util';
import { tileOf } from './grid';
import { METHOD, SAY, WORK_MODE, chooseMethod, sayStart, targetKey } from './methods';
import type { MTarget, MethodPick, Sense } from './methods';

/** 실행기가 건네는 도구 (executor.ts 의 XK). 지휘 규칙의 CommandKit 과 같은 방식 */
export interface ExecKit {
  moveTo(sim: Sim, s: Scene, a: FieldAgent, tx: number, ty: number, range: number, needLos?: boolean): 'arrived' | 'moving' | 'nopath' | 'busy';
  finish(sim: Sim, s: Scene, a: FieldAgent, ok: boolean, reason?: string): void;
  drain(sim: Sim, a: FieldAgent, rate: number): void;
  spray(sim: Sim, s: Scene, a: FieldAgent, tx: number, ty: number, eff?: number, wmul?: number, jitter?: boolean): boolean;
  makeTask(kind: TaskKind, label: string): Task;
}

/** 대원이 선 칸에서 잰 연기와 열 (몸의 감각 — 판단부에 넘기는 유일한 진실) */
export function senseOf(s: Scene, a: FieldAgent): Sense { const i = tileOf(s, a.x, a.y); return { smoke: s.smoke[i], heat: s.fire[i] }; }

/**
 * 방법 판정의 난수 흐름 method:<사건 id>:<rid>:<k> (처음 쓸 때 만든다). k = 그 대원이 이 현장에 들어온 순번(s.agents 에서 같은 rid 가운데 몇째인가) —
 * 같은 부대가 같은 사건에 다시 와도 흐름이 처음부터 되풀이되지 않는다. fork 는 부모를 소비하지 않으므로 언제 만들어도 같다.
 */
export function mrng(sim: Sim, s: Scene, a: FieldAgent): Rng {
  if (a.mrng === undefined) {
    let k = 0;
    for (let i = 0; i < s.agents.length; i++) { const b = s.agents[i]; if (b === a) break; if (b.rid === a.rid) k++; }
    a.mrng = sim.rng.fork(`method:${s.incidentId}:${a.rid}:${k}`);
  }
  return a.mrng;
}

/** 임무의 대상 (문·잔해 하위 작업이면 그 하위 작업을 넘긴다 — tile 과 prop) */
export function targetOf(t: Task): MTarget { return { cas: t.cas, prop: t.prop, hostile: t.hostile, region: t.region, tile: t.tile }; }

/** 접은 방법을 기억하는 시간(초): 실패 60 · 조건 상실 15 · 고장은 끝까지 */
export const FAIL_KEEP: Record<'failed' | 'broken' | 'tooFar' | 'team', number> = { failed: 60, broken: Infinity, tooFar: 15, team: 15 };

/** 시간이 지난 접은 기억을 지운다 (판단부는 무시만 한다) */
function pruneFails(sim: Sim, a: FieldAgent): void {
  const mf = a.mfail;
  if (!mf || !mf.length) return;
  let n = 0;
  for (let k = 0; k < mf.length; k++) if (mf[k].until > sim.t) mf[n++] = mf[k];
  mf.length = n;
}
/** 접은 기억을 남긴다 (같은 대상·같은 방법의 기억이 있으면 더 긴 쪽으로) */
export function rememberFail(sim: Sim, a: FieldAgent, key: string, m: MethodId, why: 'failed' | 'broken' | 'tooFar' | 'team'): void {
  const until = sim.t + FAIL_KEEP[why];
  const mf = (a.mfail ??= []);
  for (let k = 0; k < mf.length; k++) if (mf[k].k === key && mf[k].m === m) { if (until > mf[k].until) mf[k].until = until; return; }
  mf.push({ k: key, m, until });
}
/** 같은 대상의 앞선 접은 줄(ok = false)이 가리키는, 아직 복구되지 않은 문제(METHOD_FAIL·EQUIP_FAIL). 기록 순서대로, 겹치지 않게 */
function openFails(I: Incident, key: string): Problem[] {
  const out: Problem[] = [];
  const ms = I.methods;
  if (!ms) return out;
  for (let k = 0; k < ms.length; k++) {
    const u = ms[k];
    if (u.ok || u.eventId < 0 || targetKey(u.work, u) !== key) continue;
    for (let j = 0; j < I.problems.length; j++) {
      const p = I.problems[j];
      if (p.eventId === u.eventId && !p.recovered && (p.code === 'METHOD_FAIL' || p.code === 'EQUIP_FAIL') && out.indexOf(p) < 0) out.push(p);
    }
  }
  return out;
}
/** 한 대원이 한 사건에서 처음 고를 때만 알리는 방법 (구역마다 수색 임무가 따로 나와 여러 번 고른다 — §3.6) */
const SAY_ONCE: ReadonlySet<MethodId> = new Set<MethodId>(['listen', 'hail', 'thermal']);
/**
 * 방법을 정한 순간의 시작 문구 (§3.6). 알리지 않는 것: 기록 전용 방법, 평소 방법(plain) — 문·잔해처럼 자주 일어나는 일은 완료 문구만 방법별로 바뀐다.
 * 다만 같은 대상에 아직 복구되지 않은 방법 실패가 있으면 평소 방법이라도 알린다(관찰자가 "다른 방법으로 다시"를 보게).
 * 탐지 방법은 한 대원이 한 사건에서 처음 고를 때만. 돌려주는 값 = 남긴 기록 id (알리지 않았으면 -1).
 */
function announce(sim: Sim, I: Incident, a: FieldAgent, t: Task, work: WorkKind, tg: MTarget): number {
  const m = t.method;
  if (m === undefined) return -1;
  const d = METHOD[m];
  if (d.record) return -1;
  let text: string;
  if (d.plain) {
    if (!openFails(I, targetKey(work, tg)).length) return -1;
    text = SAY[m];
  } else {
    if (SAY_ONCE.has(m)) { const said = (a.msaid ??= []); if (said.indexOf(m) >= 0) return -1; said.push(m); }
    text = sayStart(m, t.mwhy ?? 'usual', t.missing);
  }
  const r = sim.responders[a.rid];
  return emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text });
}
function applyPick(sim: Sim, t: Task, pick: MethodPick): void {
  t.method = pick.m; t.mwhy = pick.why; t.missing = pick.missing; t.mcands = pick.cands;
  t.mt0 = sim.t; t.mtry = 0; t.mbad = 0;
  if (t.tried !== undefined && t.tried.indexOf(pick.m) >= 0) t.tried = [];      // 다 써 봐서 처음부터 다시 고른 것이다 (판단부의 넓히기 ①)
}

/**
 * 그 임무의 방법을 처음 고른다 (t.method 도 t.mt0 도 없을 때 실행부가 부른다). 고르면 t.method·mwhy·missing·mcands·mt0 를 적고 시작 문구를 낸다.
 * 고를 것이 없으면: 선택 임무와 늘 남는 임무는 t.mt0 만 두고 true(방법 없이 지금 코드로), "맡지 않는" 임무(수난 구조)는 false — 부른 쪽이 finish(false, 'nomethod').
 */
export function startMethod(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, work: WorkKind, tg: MTarget): boolean {
  pruneFails(sim, a);
  const pick = chooseMethod(sim, s, a, work, tg, t, senseOf(s, a));
  if (pick === null) { t.mt0 = sim.t; t.mtry = 0; t.mbad = 0; return WORK_MODE[work] !== 'refuse'; }
  applyPick(sim, t, pick);
  announce(sim, I, a, t, work, tg);
  return true;
}

/**
 * 도착 재선택 (§3.2-2): 그 방법의 작업 자리에 처음 닿은 틱에 한 번, 지금 선 자리의 감각으로 다시 고른다(진행도와 단계가 0 일 때만).
 * 다른 방법이 1등이면 예정된 전환이다 — 실패가 아니므로 접은 줄을 남기지 않고 t.tried·a.mfail 에도 넣지 않는다. 평소 방법이 아니면 시작 문구는 낸다.
 */
export function recheckOnArrive(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, work: WorkKind, tg: MTarget): void {
  if (t.marr) return;
  t.marr = true;
  if (t.progress !== 0 || t.phase !== 0) return;
  const pick = chooseMethod(sim, s, a, work, tg, t, senseOf(s, a));
  if (pick === null || pick.m === t.method) return;
  applyPick(sim, t, pick);
  t.phase = 0; t.progress = 0;
  announce(sim, I, a, t, work, tg);
}

/**
 * 지금 방법을 접고 다음 방법으로 바꾼다 (§3.5). 바꾸는 때는 셋뿐이다: 실패('failed') · 장비 고장('broken' — kitWorks 가 방금 EQUIP_FAIL 을 남겼다) ·
 * 조건 상실 3초('tooFar'·'team'). 부른 쪽은 그 틱에 return 한다(한 틱에 moveTo 하나).
 *   ① 접은 방법을 t.tried 와 a.mfail 에 넣는다 ② next 면 다음 방법을 고른다 ③ 기록 — 문구에 바꾸는 방법까지 담는다(따로 시작 문구를 내지 않는다):
 *      failed 는 METHOD_FAIL 문제(같은 대상에서 되풀이되면 새 문제 대신 times 를 올리고 무전 한 줄), broken 은 무전 한 줄만, tooFar·team 은 기록 한 줄
 *   ④ 접은 줄(ok = false)을 I.methods 에 ⑤ failed·broken 이고 선택 임무가 아닌 작업이면 w.fails++ ⑥ 다음 방법을 임무에 적는다.
 * detail = 문제의 상세('구명줄 투척이 두 차례 빗나감'). opt.say = 기록 문구(없으면 `${detail}.`). 돌려주는 값 = 다음 방법을 적었는가.
 * 다음 방법이 없으면: next = false 면 부른 쪽이 정한다. "맡지 않는" 임무(수난 구조)는 opt.k 를 받았으면 finish(false, 'nomethod') — 안 받았으면 부른 쪽이 끝낸다.
 * 그 밖(선택 임무)은 방법을 비우고 지금 코드로 이어 간다(끝내지 않는다).
 */
export function switchMethod(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, why: 'failed' | 'broken' | 'tooFar' | 'team', detail: string, next = true, opt: { say?: string; k?: ExecKit } = {}): boolean {
  const m0 = t.method;
  if (m0 === undefined) return false;
  const work = t.kind as WorkKind, tg = targetOf(t), key = targetKey(work, tg), r = sim.responders[a.rid];
  // ① 접은 방법의 기억
  const tried = (t.tried ??= []);
  if (tried.indexOf(m0) < 0) tried.push(m0);
  rememberFail(sim, a, key, m0, why);
  // ② 다음 방법 (tried·mfail 이 반영된다)
  const pick = next ? chooseMethod(sim, s, a, work, tg, t, senseOf(s, a)) : null;
  // ③ 기록
  const tail = pick !== null && SAY[pick.m] ? ' ' + SAY[pick.m] : '';
  let ev: number;
  if (why === 'failed') {
    const text = (opt.say ?? `${detail}.`) + tail;
    let open: Problem | undefined;
    for (const p of openFails(I, key)) if (p.code === 'METHOD_FAIL') { open = p; break; }
    if (open !== undefined) {
      open.times = (open.times ?? 1) + 1;
      emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, causes: [open.eventId], text });
      ev = open.eventId;
    } else ev = raiseProblem(sim, I, 'METHOD_FAIL', detail, { role: 'RESPONDER', actor: r.name, rid: r.id, text }, false);
  } else if (why === 'broken') {
    ev = lastProblemEvent(I, 'EQUIP_FAIL');      // 문제는 kitWorks 가 이미 남겼다 — 다시 만들지 않는다
    if (opt.say !== undefined || tail) emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, causes: [ev], text: opt.say !== undefined ? opt.say + tail : tail.slice(1) });
  } else ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: (opt.say ?? `${detail}.`) + tail });
  // ④ 접은 줄
  recordMethod(sim, I, a, t, m0, t.mwhy ?? 'usual', false, ev);
  // ⑤ 작업 항목의 실패 횟수 (문·잔해 하위 작업은 작업 항목이 없다. holdUntil 은 건드리지 않는다)
  if ((why === 'failed' || why === 'broken') && t.workId >= 0 && WORK_MODE[work] !== 'optional') s.board[t.workId].fails++;
  // ⑥ 다음 방법
  if (pick !== null) {
    applyPick(sim, t, pick);
    t.mwhy = why; t.missing = undefined;
    t.phase = 0; t.progress = 0; a.path = null;
    return true;
  }
  if (!next) return false;
  if (WORK_MODE[work] === 'refuse') { if (opt.k) opt.k.finish(sim, s, a, false, 'nomethod'); return false; }
  t.method = undefined; t.mwhy = undefined; t.missing = undefined; t.mcands = undefined; t.mt0 = sim.t; t.mtry = 0; t.mbad = 0;
  return false;
}

/**
 * 방법을 쓴 기록 한 줄을 I.methods 에 남긴다 (보고서는 이것과 Problem 으로만 방법을 말한다).
 * 방법을 인자로 받는다 — 기록 전용 분기(지금의 교전 분기·R1 의 행동)는 t.method 가 비어 있어도 자기 이름을 넘긴다. 대상은 tg ?? 임무에서.
 * ok 면: 같은 대상의 앞선 접은 줄이 가리키는 문제(METHOD_FAIL·EQUIP_FAIL)가 아직 복구되지 않았으면 여기서 직접 복구 처리한다.
 *   events.markRecovered 의 "가장 최근 것" 규칙을 쓰지 않는다 — 펌프 고장 같은 다른 EQUIP_FAIL 을 잘못 닫지 않게.
 */
export function recordMethod(sim: Sim, I: Incident, a: FieldAgent, t: Task, method: MethodId, why: MethodWhy, ok: boolean, eventId: number, tg?: MTarget): void {
  const g = tg ?? targetOf(t), work = t.kind as WorkKind;
  if (ok) {
    const open = openFails(I, targetKey(work, g));
    if (open.length) {
      const text = `${josa(sim.responders[a.rid].name, '이/가')} ${METHOD[method].noun} 다시 시도해 성공`;
      for (const p of open) { p.recovered = true; p.recoveryText = text; }
    }
  }
  const u: MethodUse = {
    t0: t.mt0 ?? sim.t, t: sim.t, rid: a.rid, unitId: a.unitId, work, method, why, ok,
    cas: g.cas, prop: g.prop, hostile: g.hostile, region: g.region, tile: g.tile,
    missing: why === 'noGear' ? t.missing : undefined, eventId,
  };
  (I.methods ??= []).push(u);
}

/**
 * R1 의 호이스트 완료(rules/air.ts 의 hoistDone)가 부른다: 구조 대상에 구한 방법을 적고 방법 기록 한 줄을 남긴다.
 * 구한 사람 = 그 헬기의 관측자(AirOp.eye — 소방 헬기는 0번 자리 항공 구조대원). 보고서 문장은 사람 이름 대신 부대 호출부호를 쓴다.
 * t0 = 인양을 시작한 시각(부르는 쪽이 sim.t − op.progress 로 넘긴다. 없으면 지금).
 */
export function recordAir(sim: Sim, I: Incident, u: Unit, c: Casualty, eventId: number, t0 = sim.t): void {
  const s = sim.scenes[I.id];
  let rid = u.crew[0];
  if (s && s.air) for (const op of s.air) if (op.unitId === u.id) { rid = op.eye.rid; break; }
  c.freedHow = 'hoist'; c.freedBy = rid;
  // 지상의 수난 구조가 같은 대상에서 막혀 있었다면(접은 줄의 문제) 헬기가 건진 것으로 복구 처리한다 — 임무 종류가 달라(hoist) recordMethod 의 열쇠로는 맞지 않는다
  const open = openFails(I, targetKey('waterRescue', { cas: c.id, prop: -1, hostile: -1, region: -1, tile: -1 }));
  for (const p of open) { p.recovered = true; p.recoveryText = `${josa(u.callsign, '이/가')} ${METHOD.hoist.noun} 다시 시도해 성공`; }
  (I.methods ??= []).push({
    t0, t: sim.t, rid, unitId: u.id, work: 'hoist', method: 'hoist', why: 'usual', ok: true,
    cas: c.id, prop: -1, hostile: -1, region: -1, tile: -1, missing: undefined, eventId,
  });
}
