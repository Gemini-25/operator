// 대응 방법의 실행부 (docs/specs/R2-methods.md §3.5·§3.6). 판단부(methods.ts)가 고른 방법을 임무에 적고, 접고, 기록한다.
// executor.ts 와 같은 자격이다: 진실을 읽고 상태를 바꾼다. 기록은 상태를 바꾸는 바로 그 자리에서만 남긴다.
//
// executor.ts 를 import 하지 않는다(순환). 실행기의 함수가 필요한 곳은 실행기가 건네는 도구(ExecKit — executor.XK)로 부른다.
// 장비는 gear.ts 로만 본다(효과용 kitWorks·useKit·bestTool 은 여기서만 부른다 — 판단부는 부르지 않는다).
//
// 난수: 방법의 판정(투척 명중·잡기·헤엄 중 사고·보트 전복·비살상탄·저격·터널 붕락)은 전부 mrng — 대원마다 method:<사건>:<rid>:<k>.
//   a.rng(판단 오차·제거 시간 추정)·s.rng(사격·용의자)·kit·kit:<현장>·injury:<현장>·roster-* 에 호출을 끼우지 않는다(무관한 결과까지 바뀐다).
//
// 단계 0 (틀)이 공통 함수를 두었고, 방법별 실행은 그 방법을 구현하는 단계가 이 파일에 더한다:
//   단계 1a  runWaterRescue(수난 구조의 물가 방법 — 손·장대·구명환·구명줄·즉석 부력물·하류 차단) · landCasualty — executor 의 case 'waterRescue' 가 부른다
//   뒤 단계  waterTick·pullAshore(1b) · 보트(1c) · blockerRate(2) · runSuppress(4) …

import type { Sim } from '../engine';
import { emit, lastProblemEvent, raiseProblem } from '../events';
import type { Rng } from '../rng';
import { T } from '../types';
import type { CasBelief, Casualty, FieldAgent, Incident, KitId, MethodId, MethodUse, MethodWhy, Problem, Scene, Task, TaskKind, Unit, WorkKind } from '../types';
import { clamp, dist, josa } from '../util';
import { casFact, learn, learnQuiet, staminaF } from './agents';
import { BARE_HANDS, kitCount, kitTool, kitWorks } from './gear';
import { tileOf } from './grid';
import { HAND_REACH, METHOD, POLE_REACH, RING_REACH, SAY, THROW_REACH, WORK_MODE, catchPoint, chooseMethod, methodStillFits, reachOf, sayStart, targetKey } from './methods';
import type { MTarget, MethodPick, Sense } from './methods';
import { docCtx, hasDoc } from './doctrine';      // (R3) 교본 입력 (자기 모드)
import type { DocCtx } from './doctrine/registry';

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
/** (R3) 실행부가 방법을 고를 때 넘기는 교본 입력 — 자기 모드 (R3 §2.3 ③). 방법 줄이 없으면 만들지 않는다(null) */
function selfDc(sim: Sim, s: Scene, a: FieldAgent, t: Task): DocCtx | null { return hasDoc('method') ? docCtx(sim, s, a, 'self', t.workId >= 0 ? s.board[t.workId] ?? null : null, senseOf(s, a)) : null; }

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
  const pick = chooseMethod(sim, s, a, work, tg, t, senseOf(s, a), selfDc(sim, s, a, t));
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
  const pick = chooseMethod(sim, s, a, work, tg, t, senseOf(s, a), selfDc(sim, s, a, t));
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
  const pick = next ? chooseMethod(sim, s, a, work, tg, t, senseOf(s, a), selfDc(sim, s, a, t)) : null;
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

// ───────────────────────── 수난 구조 (§4.1) — 단계 1a: 물가 방법 ─────────────────────────
/** 물가 방법의 닿는 거리 (칸) — 대원이 물가에서 대상과 이만큼 안이고 시야가 닿아야 한다 */
const SHORE_REACH: Partial<Record<MethodId, number>> = { hand: HAND_REACH, pole: POLE_REACH, ring: RING_REACH, rope: THROW_REACH, improvise: THROW_REACH };
/** 던지는 방법: 빗나가면 줄을 다시 감고(4초) 다음 투척은 0.6배 시간. 두 번 빗나가면 접는다 (뻗는 방법·하류 차단은 세 번) */
const THROWS: ReadonlySet<MethodId> = new Set<MethodId>(['ring', 'rope', 'improvise']);
/** 물가 방법이 쓰는 장비 — 시도를 시작할 때 kitWorks 로 작동을 확인한다(숨은 고장이 이때 드러난다) */
const SHORE_KIT: Partial<Record<MethodId, KitId>> = { pole: 'pole', ring: 'ring', rope: 'rope' };
/** 던지는 것의 이름 (빗나감 문구) */
const THROWN: Partial<Record<MethodId, string>> = { ring: '구명환', rope: '줄', improvise: '이은 줄' };
/** 줄 다시 감기(초) · 하류 차단의 붙잡는 거리(칸)·붙잡는 시간(초)·걸려 멈춘 대상을 기다리는 한도(초 — 1초 재확인의 횟수) */
export const REWIND = 4, CATCH_GRAB = 1.3, CATCH_NEED = 2, CATCH_STUCK = 6;

/** 대상이 줄을 잡을 수 있는가 (체력 — 진실). 55 넘게 1 · 40 넘게 .75 · 25 넘게 .4 · 그 밖 .15 */
export function grabP(health: number): number { return health > 55 ? 1 : health > 40 ? 0.75 : health > 25 ? 0.4 : 0.15; }
/** 한 번 던져 대상에게 닿는가 (d = 그 순간 대원–대상 거리). 날씨·물살(s.flow — 진실)이 깎는다 */
export function hitP(sim: Sim, s: Scene, rid: number, d: number): number {
  const r = sim.responders[rid];
  return clamp(0.62 + 0.3 * r.skills.rescue + 0.1 * r.composure - 0.12 * Math.max(0, d - 2) - (sim.weather !== 'clear' ? 0.08 : 0) - ((s.flow ?? 0) >= 0.07 ? 0.12 : 0), 0.25, 0.97);
}
/**
 * 물가 방법 한 번의 필요 시간(초). 구명줄은 지금의 식 그대로(9 / (0.4 + 0.8 × 구조 능력 + 0.5 × 장비 값)), 구명환은 그 0.8배(구명환의 값),
 * 즉석 부력물은 맨손 값으로 1.3배에 처음 한 번 찾는 2초. 다시 감은 투척(retry)은 0.6배. 하류 차단의 붙잡기는 2초
 */
export function shoreNeed(sim: Sim, rid: number, m: MethodId, retry: boolean): number {
  const rs = sim.responders[rid].skills.rescue;
  const rope9 = (tool: number): number => 9 / (0.4 + 0.8 * rs + 0.5 * tool);
  let need: number;
  switch (m) {
    case 'hand': need = 2.5 / (0.5 + 0.5 * rs); break;
    case 'pole': need = 1.5 + 4 / (0.5 + 0.6 * rs); break;
    case 'ring': need = 0.8 * rope9(kitTool(sim, 'ring', 'water')); break;
    case 'rope': need = rope9(kitTool(sim, 'rope', 'water')); break;
    case 'catch': return CATCH_NEED;
    default: need = 1.3 * rope9(BARE_HANDS) + (retry ? 0 : 2);      // improvise: 옷·끈과 빈 통을 찾는 2초 (처음 한 번)
  }
  return retry && THROWS.has(m) ? need * 0.6 : need;
}

/**
 * 물에서 뭍으로 (§4.1): 지금 waterRescue 의 완료 처리와 같다 — 물 밖, 떠내려가지 않음, 거동 불가, 그 자리(뭍 칸)에 내려놓고 악화가 느려진다.
 * 남은 악화는 익수가 아니라 실외 노출(저체온 — H1 §2.3). 어떤 방법으로 누가 구했는지 적는다(보고서 타임라인). 끌고 오던 사람이면 놓는다.
 * (x, y) 가 물 칸이면 가장 가까운 뭍 칸으로 옮긴다 (떠 있는 사람을 "물 밖"으로 두지 않는다)
 */
export function landCasualty(sim: Sim, s: Scene, _I: Incident, a: FieldAgent, c: Casualty, how: MethodId, x: number, y: number): void {
  let lx = Math.round(x), ly = Math.round(y);
  if (s.tiles[tileOf(s, lx, ly)] === T.WATER) { const b = reachOf(s, lx, ly, 4, null); if (b) { lx = b.x; ly = b.y; } }
  c.inWater = false; c.drift = 0; c.mob = 'immobile'; c.trapWork = 0; c.tFreed = sim.t; c.where = 'scene';
  c.x = c.px = lx; c.y = c.py = ly;
  c.bleed *= 0.35; c.bleed0 = c.bleed;      // 물 밖으로 나오면 악화가 느려진다 (저체온은 남는다)
  c.bleedCause = 'exposure';      // 남은 악화는 익수가 아니라 실외 노출(저체온)로 적는다
  c.freedHow = how; c.freedBy = a.rid;
  if (a.carrying === c.id) a.carrying = -1;
  learnQuiet(sim, a, casFact(sim, s, c, sim.responders[a.rid].name));
}

/** 그 대원이 같은 대상에서 그 방법을 접은 적이 있다 (a.mfail — 시간이 지난 기억도 센다) */
function foldedBefore(a: FieldAgent, key: string, m: MethodId): boolean {
  const mf = a.mfail;
  if (mf) for (let k = 0; k < mf.length; k++) if (mf[k].k === key && mf[k].m === m) return true;
  return false;
}
/** 방법을 접을 때의 사유 (조건 상실) */
function lostText(m: MethodId, team: boolean): string {
  return team ? '동료가 헤엄쳐 들어감' : `대상이 떠내려가 ${josa(METHOD[m].short, '이/가')} 닿지 않음`;
}
/** 같은 대상에게 헤엄쳐 들어간 동료가 있다 (던지는 방법이 그 동료에게 걸린다) */
function mateSwimming(s: Scene, a: FieldAgent, cas: number): boolean {
  for (let k = 0; k < s.agents.length; k++) { const b = s.agents[k]; if (b !== a && b.status === 'active' && b.task !== null && b.task.kind === 'waterRescue' && b.task.cas === cas && b.task.method === 'swim') return true; }
  return false;
}

/**
 * 수난 구조의 실행 (§4.1) — executor 의 case 'waterRescue' 가 부른다. 고르는 것은 판단부(chooseMethod), 효과·판정은 여기서(진실·mrng).
 * 분기마다 moveTo 는 한 번만 부르고 return 한다(한 틱에 이동 목표 하나). switchMethod 를 부른 틱도 return 한다.
 * 단계 1a: 물가 방법 다섯(손·장대·구명환·구명줄·즉석 부력물)과 하류 차단. 헤엄·줄 확보(1b)·보트(1c)는 아직 고르지 않는다(can = NOT_YET).
 */
export function runWaterRescue(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, k: ExecKit): void {
  const c = s.casualties[t.cas], r = sim.responders[a.rid], dt = sim.dt;
  // 이미 물 밖이거나 숨졌다: 낡은 믿음 대비 — 강제로 보고하고 끝낸다 (지휘관이 같은 지시를 되풀이하지 않게)
  if (c.dead || !c.inWater) { learn(sim, a, casFact(sim, s, c, r.name), true, true); k.finish(sim, s, a, true); return; }
  // 다른 대원이 끌고 오는 중이다 (헤엄·보트 — 단계 1b·1c): 그 일이 끝나기를 기다린다
  if (c.where === 'carried' && a.carrying !== c.id) { a.label = '구조 지원 대기'; t.progress = 0; return; }
  const tg = targetOf(t);
  if (t.method === undefined && !startMethod(sim, s, I, a, t, 'waterRescue', tg)) { k.finish(sim, s, a, false, 'nomethod'); return; }
  const m = t.method;
  if (m === undefined || (SHORE_REACH[m] === undefined && m !== 'catch')) { k.finish(sim, s, a, false, 'nomethod'); return; }      // 이 단계에 실행부가 없는 방법 (고르지 않으므로 오지 않는다)
  // 1초마다 고른 방법을 지금도 쓸 수 있는지 다시 본다 — 3초 넘게 맞지 않으면 조건 상실로 바꾼다. 하류 차단은 기다릴 자리에 나선 뒤에는 따로 본다(runCatch)
  if (sim.tick % 5 === 0 && t.mt0 !== sim.t && !(m === 'catch' && t.phase >= 1)) {
    t.mbad = methodStillFits(sim, s, a, 'waterRescue', tg, t, m) ? 0 : (t.mbad ?? 0) + 1;
    if (t.mbad >= 3) {
      const team = THROWS.has(m) && mateSwimming(s, a, c.id);
      switchMethod(sim, s, I, a, t, team ? 'team' : 'tooFar', lostText(m, team), true, { k });
      return;
    }
  }
  if (m === 'catch') { runCatch(sim, s, I, a, t, c, k); return; }
  // ── 물가 방법 ──
  const mv = k.moveTo(sim, s, a, c.x, c.y, SHORE_REACH[m]!, true);      // 물가에서 대상이 보이는 가장 가까운 자리 (떠내려가면 따라 옮긴다)
  if (mv === 'nopath') {
    // 처음 막혔으면 다른 거리의 방법으로 한 번 바꿔 본다. 두 번째면(또는 바꿀 방법이 없으면) 지금처럼 닿지 못한 것으로 끝낸다 (방법을 바꾸며 같은 틱마다 되풀이하지 않게)
    if (!(t.tried && t.tried.length) && switchMethod(sim, s, I, a, t, 'tooFar', '물가로 갈 길이 없음')) return;
    k.finish(sim, s, a, false, 'nopath'); return;
  }
  if (t.phase === 1) {      // 줄을 다시 감는다 (걸으며 감아도 된다)
    a.label = '줄 다시 감는 중';
    t.progress += dt; a.ring = t.progress / REWIND;
    if (t.progress >= REWIND) { t.phase = 0; t.progress = 0; }
    return;
  }
  if (mv !== 'arrived') { a.label = '물가로 이동'; t.progress = Math.max(0, t.progress - dt * 0.5); return; }
  a.label = METHOD[m].label;
  a.fx = c.x - a.x; a.fy = c.y - a.y;
  // 시도를 시작할 때 장비가 작동하는지 (숨은 고장이 이때 드러난다 — EQUIP_FAIL 은 kitWorks 가 남긴다)
  const kit = SHORE_KIT[m];
  if (kit !== undefined && t.progress === 0 && !kitWorks(sim, a.rid, kit, I)) { switchMethod(sim, s, I, a, t, 'broken', `${josa(METHOD[m].name, '이/가')} 장비 고장으로 막힘`, true, { k }); return; }
  // 다시 던지는 것: 이번 방법에서 빗나간 뒤이거나, 같은 대상에 이 방법을 이미 접었다가 다시 고른 것 (줄·이은 줄을 이미 손에 들고 있다 — 찾는 2초도 없다)
  t.need = shoreNeed(sim, a.rid, m, (t.mtry ?? 0) > 0 || foldedBefore(a, targetKey('waterRescue', tg), m));
  t.progress += dt * staminaF(r); a.ring = t.progress / t.need;
  k.drain(sim, a, 0.5);
  if (t.progress < t.need) return;
  attempt(sim, s, I, a, t, c, m, k);
}

/** 한 번의 시도를 판정한다 (mrng 한 번): 성공이면 뭍으로 끌어내고 끝, 실패면 다시 하거나(던지기 둘째·뻗기 셋째까지) 접는다 */
function attempt(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, c: Casualty, m: MethodId, k: ExecKit): void {
  const r = sim.responders[a.rid];
  let hit = 1, grab = grabP(c.health);
  if (m === 'hand') grab = Math.max(grab, 0.6);
  else if (m === 'pole') grab = Math.max(grab, 0.8);      // 갈고리라 의식이 없어도 건다
  else if (m === 'catch') grab = Math.max(grab, kitCount(sim, a.rid, 'pole') > 0 ? 0.8 : 0.6);      // 장대가 있으면 장대의 잡기
  else {
    hit = hitP(sim, s, a.rid, dist(a.x, a.y, c.x, c.y));
    if (m === 'ring') { hit = Math.min(1, hit * 1.08); grab = Math.min(1, grab * 1.15); }
    else if (m === 'improvise') { hit *= 0.7; grab *= 0.7; }
  }
  const roll = mrng(sim, s, a).next();
  if (roll < hit * grab) {
    landCasualty(sim, s, I, a, c, m, a.x, a.y);
    const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, text: `구조 대상 ${c.label}, ${METHOD[m].noun} 끌어냈습니다. 처치와 이송이 필요합니다.` });
    recordMethod(sim, I, a, t, m, t.mwhy ?? 'usual', true, ev);
    r.xpGained += 0.005;
    k.finish(sim, s, a, true);
    return;
  }
  // 한 번 실패 (방법은 그대로 — 기록은 imp 0): 던지기는 줄을 다시 감고, 뻗기·붙잡기는 처음부터
  t.mtry = (t.mtry ?? 0) + 1;
  const thrown = THROWN[m], limit = THROWS.has(m) ? 2 : 3;
  if (t.mtry >= limit) {
    switchMethod(sim, s, I, a, t, 'failed', `${josa(METHOD[m].name, '이/가')} ${limit === 2 ? '두' : '세'} 차례 ${thrown !== undefined ? '빗나감' : '실패'}`, true, { k });
    return;
  }
  const say = thrown !== undefined
    ? (roll >= hit ? `${josa(thrown, '이/가')} 빗나갔습니다. 다시 감아 던집니다.` : `대상이 ${josa(thrown, '을/를')} 잡지 못했습니다. 다시 감아 던집니다.`)
    : m === 'pole' ? '대상이 장대를 놓쳤습니다. 다시 뻗겠습니다.' : m === 'catch' ? '붙잡지 못했습니다. 다시 붙잡겠습니다.' : '손이 미끄러졌습니다. 다시 뻗겠습니다.';
  emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 0, text: say });
  t.progress = 0;
  if (thrown !== undefined) t.phase = 1;
}

/**
 * 하류 차단 (§4.1 catch): 믿음 속 대상이 떠내려오는 같은 줄의 하류 뭍(다리·굽은 물가)에서 기다렸다가, 대상이 1.3칸 안에 오면 붙잡는다 (손의 잡기, 장대가 있으면 장대의 잡기).
 * 기다릴 자리는 처음 한 번 정한다(믿음 위치로). 대상이 다른 데 걸려 멈췄는데(믿음 drift 0) 그 자리에서 2칸 밖인 채 6초가 지나면 조건 상실로 바꾼다 (1초 재확인 — t.mbad 를 센다).
 */
function runCatch(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, c: Casualty, k: ExecKit): void {
  const r = sim.responders[a.rid], dt = sim.dt;
  const cb = a.beliefs.val<CasBelief>('cas', c.id);
  if (t.phase === 0) {
    const pt = cb ? catchPoint(s, cb.x, cb.y, a) : null;
    if (pt === null) { switchMethod(sim, s, I, a, t, 'tooFar', '하류에서 기다릴 자리가 없음', true, { k }); return; }
    t.tx = pt.x; t.ty = pt.y; t.phase = 1; t.mbad = 0;
  }
  if (sim.tick % 5 === 0) {
    if (cb && !(cb.drift ?? 0) && dist(cb.x, cb.y, t.tx, t.ty) > 2) {
      t.mbad = (t.mbad ?? 0) + 1;
      if (t.mbad >= CATCH_STUCK) { switchMethod(sim, s, I, a, t, 'tooFar', '대상이 하류로 오지 않고 걸려 멈춤', true, { k }); return; }
    } else t.mbad = 0;
  }
  const mv = k.moveTo(sim, s, a, t.tx, t.ty, 0.5);
  if (mv === 'nopath') {
    if (!(t.tried && t.tried.length) && switchMethod(sim, s, I, a, t, 'tooFar', '하류로 갈 길이 없음')) return;
    k.finish(sim, s, a, false, 'nopath'); return;
  }
  a.label = '하류에서 대기';
  if (mv !== 'arrived') return;
  a.fx = c.x - a.x; a.fy = c.y - a.y;
  if (dist(a.x, a.y, c.x, c.y) > CATCH_GRAB) { t.progress = 0; return; }      // 아직 오지 않았다
  a.label = '붙잡는 중';
  t.need = CATCH_NEED;
  t.progress += dt * staminaF(r); a.ring = t.progress / t.need;
  k.drain(sim, a, 0.5);
  if (t.progress < t.need) return;
  attempt(sim, s, I, a, t, c, 'catch', k);
}
