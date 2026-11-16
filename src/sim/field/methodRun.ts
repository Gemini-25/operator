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
//   단계 1b  헤엄(runSwim)·줄 확보(runTend)·끌려가는 대상 기다리기(waitCarried), 물 위의 바탕: waterTick(executor.act)·pullAshore(안전장치 — case 'ashore'·rules/methods)·
//            dropWet(executor.finishTask 의 내려놓기)·swimTrouble·clutchP, 물 위 피해의 하한 WATER_FLOOR(18)
//   뒤 단계  보트(1c) · blockerRate(2) · runSuppress(4) …

import type { Sim } from '../engine';
import { emit, lastProblemEvent, raiseProblem } from '../events';
import type { Rng } from '../rng';
import { T } from '../types';
import type { CasBelief, Casualty, FieldAgent, Incident, KitId, MethodId, MethodUse, MethodWhy, Problem, Scene, Task, TaskKind, Unit, WorkKind } from '../types';
import { clamp, dist, josa } from '../util';
import { casFact, learn, learnQuiet, staminaF } from './agents';
import { BARE_HANDS, kitCount, kitTool, kitWorks } from './gear';
import { tileOf } from './grid';
import { HAND_REACH, METHOD, POLE_REACH, RING_REACH, SAY, THROW_REACH, WORK_MODE, catchPoint, chooseMethod, methodStillFits, onWater, reachOf, sayStart, swimOf, targetKey } from './methods';
import { hurtResponder } from './injury';
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
  t.range = 0;      // (1b) 헤엄·줄 확보의 "물가 자리를 정했다" 표시 — 새 방법은 자리를 다시 정한다
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
  if (m === 'tend') return '헤엄치던 동료가 물에서 나옴';
  if (team) return '동료가 헤엄쳐 들어감';
  if (m === 'swim') return '대상이 물가 가까이 떠밀려 옴';      // 손이 닿는 거리가 됐다(헤엄의 조건 reach > 1.2) — 또는 수영 능력의 문턱(구명조끼를 잃음)
  return `대상이 떠내려가 ${josa(METHOD[m].short, '이/가')} 닿지 않음`;
}
/**
 * 뭍에 내려놓고 방법별 완료 문구·방법 기록을 남긴다 (상태를 바꾸는 그 자리에서 — 규칙 5). 물가 방법의 성공, 헤엄·보트로 끌고 나온 끝,
 * 끌고 오던 사람을 뭍에서 내려놓게 된 임무 종료(executor.finishTask → dropWet)가 같은 줄을 쓴다
 */
function landed(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, c: Casualty, how: MethodId, x: number, y: number): void {
  const r = sim.responders[a.rid];
  landCasualty(sim, s, I, a, c, how, x, y);
  const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, text: `구조 대상 ${c.label}, ${METHOD[how].noun} 끌어냈습니다. 처치와 이송이 필요합니다.` });
  recordMethod(sim, I, a, t, how, t.mwhy ?? 'usual', true, ev);
  r.xpGained += 0.005;
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
  // 이미 물 밖이거나 숨졌다: 낡은 믿음 대비 — 강제로 보고하고 끝낸다 (지휘관이 같은 지시를 되풀이하지 않게). 물 위에 있으면 다음 판단에서 뭍으로(brain 의 물 위 가드)
  if (c.dead || !c.inWater) { learn(sim, a, casFact(sim, s, c, r.name), true, true); k.finish(sim, s, a, true); return; }
  // 다른 대원이 끌고 오는 중이다 (헤엄·보트): 헤엄치는 동료면 줄을 가진 대원은 줄 확보로 바꾸고, 아니면 곁의 물가에서 기다린다
  if (c.where === 'carried' && a.carrying !== c.id) { if (t.method === 'tend') runTend(sim, s, I, a, t, c, k); else waitCarried(sim, s, I, a, t, c, k); return; }
  const tg = targetOf(t);
  if (t.method === undefined && !startMethod(sim, s, I, a, t, 'waterRescue', tg)) { k.finish(sim, s, a, false, 'nomethod'); return; }
  const m = t.method;
  if (m === undefined || (SHORE_REACH[m] === undefined && !OWN_RUN.has(m))) { k.finish(sim, s, a, false, 'nomethod'); return; }      // 이 단계에 실행부가 없는 방법 (고르지 않으므로 오지 않는다)
  // 물 위의 대원은 물가 방법을 하지 않는다 (헤엄을 접고 다른 방법이 됐다): 그 일을 내려놓는다 — 다음 판단에서 뭍으로 간다(brain 의 물 위 가드)
  if ((a.afloat !== undefined || onWater(s, a)) && !inWaterPhase(m, t)) { k.finish(sim, s, a, false, 'preempt'); return; }
  // 1초마다 고른 방법을 지금도 쓸 수 있는지 다시 본다 — 3초 넘게 맞지 않으면 조건 상실로 바꾼다.
  // 하류 차단은 기다릴 자리에 나선 뒤에는 따로 본다(runCatch). 헤엄은 물에 들어간 뒤, 줄 확보는 자리를 잡은 뒤 다시 보지 않는다 — 몸이 이미 그 일에 들어가 있다
  if (sim.tick % 5 === 0 && t.mt0 !== sim.t && !(m === 'catch' && t.phase >= 1) && !(m === 'swim' && t.phase >= 2) && !(m === 'tend' && t.phase >= 1)) {
    t.mbad = methodStillFits(sim, s, a, 'waterRescue', tg, t, m) ? 0 : (t.mbad ?? 0) + 1;
    if (t.mbad >= 3) {
      const team = ((THROWS.has(m) || m === 'swim') && mateSwimming(s, a, c.id)) || m === 'tend';
      // 동료가 헤엄쳐 들어가 이 대원에게 남은 방법이 없으면 그 동료에게 맡기고 손을 뗀다 (실패가 아니다 — 실패 횟수를 올리지 않는다)
      if (!switchMethod(sim, s, I, a, t, team ? 'team' : 'tooFar', lostText(m, team), true, team ? {} : { k }) && team && a.task === t) k.finish(sim, s, a, false, 'preempt');
      return;
    }
  }
  if (m === 'catch') { runCatch(sim, s, I, a, t, c, k); return; }
  if (m === 'swim') { runSwim(sim, s, I, a, t, c, k); return; }
  if (m === 'tend') { runTend(sim, s, I, a, t, c, k); return; }
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
    landed(sim, s, I, a, t, c, m, a.x, a.y);
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

// ───────────────────────── 수난 구조 (§4.1·§3.5) — 단계 1b: 헤엄 · 줄 확보 · 물 위의 바탕 ─────────────────────────
/** 물가 방법 밖에서 자기 실행부를 가진 수난 방법 (하류 차단 1a · 헤엄·줄 확보 1b) */
const OWN_RUN: ReadonlySet<MethodId> = new Set<MethodId>(['catch', 'swim', 'tend']);
/** 몸이 물 위에 있어도 되는 방법의 단계: 헤엄은 물에 들어간 뒤(phase ≥ 2) */
function inWaterPhase(m: MethodId, t: Task): boolean { return m === 'swim' && t.phase >= 2; }
/**
 * 헤엄의 수치 (§4.1 swim·§3.5): 물가 진입점에서 멈추는 거리(칸) · 준비(초 — 소방은 방화복·공기호흡기 벗기 6, 그 밖 2, 구명조끼를 입으면 +3) ·
 * 붙잡는 거리(칸)·벌어지면 다시 헤엄쳐 가는 거리(칸)·붙잡는 시간(초) · 끌고 오는 대상이 놓이는 자리(대원 뒤 칸) · 물 위에 이 시간(초) 넘게 있으면 안전장치가 물가로 옮긴다
 */
export const SWIM = { entry: 0.5, prepFire: 6, prep: 2, prepPfd: 3, reach: 0.9, grabFar: 1.4, grab: 1.5, tow: 0.45, stuck: 150 };
/** 줄 확보: 헤엄 동료가 들어간 물가에서 이만큼 안에 선다 (칸) */
export const TEND_RANGE = 1.0;
/** 물 위의 피해(R2 — 익수·사고·붙잡힘)는 체력을 이 아래로 내리지 않는다 (§3.5 — H1 이 있든 없든). 쓰러짐 문턱(15)보다 위 */
export const WATER_FLOOR = 18;
/** 헤엄 중 익수 피해(초당 — 구명조끼 ×0.5 · 드라이슈트 ×0.7), 사고 한 번의 피해 범위(줄 확보면 ×0.5)·지구력 손실, 지구력 소모(초당 — 끌고 오면 더) */
export const SWIM_HURT = { tick: 1.2, mishap: [8, 18] as const, stamina: 25, drain: 1.6, drainTow: 2.4 };

/** R2 의 물 위 피해: 체력 하한 18 을 지켜 H1 의 hurtResponder 로 (원인 익수 — 방호 0. 구명조끼·드라이슈트는 부르는 쪽의 식이 이미 줄였다) */
function wetHurt(sim: Sim, s: Scene, I: Incident, a: FieldAgent, raw: number, tick: boolean, ev = -1): void {
  const r = sim.responders[a.rid];
  const v = Math.min(raw, r.health - WATER_FLOOR);
  if (v > 0) hurtResponder(sim, s, I, a, v, 'drown', tick ? { tick: true } : { ev });
}
/** 같은 대상에게 줄을 잡아 주는(자리를 잡은) 동료 */
function tenderFor(s: Scene, a: FieldAgent, cas: number): FieldAgent | null {
  for (let k = 0; k < s.agents.length; k++) { const b = s.agents[k], q = b.task; if (b !== a && b.status === 'active' && q !== null && q.kind === 'waterRescue' && q.cas === cas && q.method === 'tend' && q.phase >= 1) return b; }
  return null;
}
/** 같은 대상에게 헤엄쳐 들어가는 동료 (헤엄을 고른 뒤 — 아직 물가로 걷는 중이어도) */
function swimmerFor(s: Scene, a: FieldAgent, cas: number): FieldAgent | null {
  for (let k = 0; k < s.agents.length; k++) { const b = s.agents[k], q = b.task; if (b !== a && b.status === 'active' && q !== null && q.kind === 'waterRescue' && q.cas === cas && q.method === 'swim') return b; }
  return null;
}

/**
 * 헤엄 중 사고율 (초당, §3.5): 0.010 × (1.5 − 수영 능력) × (1 + 1.5 × 물살) × (밤 1.3) × (구명조끼 0.45) × (드라이슈트 0.7) × (줄 확보 0.5)
 * × (지구력 30 아래면 2) × (끌고 오는 중 1.5). flowK = 물살 / 0.1 (최대 1). 순수 함수 — 시험이 부른다
 */
export function swimTrouble(swim: number, flowK: number, pfd: boolean, drysuit: boolean, tended: boolean, tired: boolean, towing: boolean, night: boolean): number {
  return 0.010 * (1.5 - swim) * (1 + 1.5 * flowK) * (night ? 1.3 : 1) * (pfd ? 0.45 : 1) * (drysuit ? 0.7 : 1) * (tended ? 0.5 : 1) * (tired ? 2 : 1) * (towing ? 1.5 : 1);
}
/** 허우적대는 대상에게 붙잡힐 확률 (붙잡는 순간 한 번 — 대상의 체력이 40 넘게 남아 허우적댈 힘이 있을 때만) */
export function clutchP(swim: number, pfd: boolean, health: number): number { return health > 40 ? 0.15 * (1.2 - swim) * (pfd ? 0.5 : 1) : 0; }

type Mishap = 'flow' | 'tired' | 'crisis' | 'swept' | 'clutch';
/** 헤엄 구조 중 사고의 문제 상세 (METHOD_FAIL) */
const MISHAP_DETAIL: Record<Mishap, string> = {
  flow: '헤엄 구조 중 물살에 밀림', tired: '헤엄 구조 중 힘이 빠짐', crisis: '헤엄 구조 중 물을 많이 먹음', swept: '헤엄 구조 중 하류로 떠밀림', clutch: '헤엄 구조 중 허우적대는 대상에게 붙잡힘',
};
/** 사고의 무전 (헤엄 구조 중 — towing = 끌고 오던 사람을 놓쳤다) */
function mishapSay(kind: Mishap, towing: boolean): string {
  switch (kind) {
    case 'flow': return towing ? '물살에 밀려 대상을 놓쳤습니다. 뭍으로 돌아갑니다.' : '물살에 휩쓸렸습니다. 뭍으로 돌아갑니다.';
    case 'tired': return towing ? '힘이 빠졌습니다. 대상을 놓치고 뭍으로 돌아갑니다.' : '힘이 빠졌습니다. 뭍으로 돌아갑니다.';
    case 'crisis': return towing ? '물을 많이 먹었습니다. 대상을 놓치고 뭍으로 돌아갑니다.' : '물을 많이 먹었습니다. 뭍으로 돌아갑니다.';
    case 'swept': return '하류로 떠밀렸습니다! 뭍으로 붙겠습니다.';
    case 'clutch': return '허우적대는 대상에게 붙잡혀 함께 가라앉을 뻔했습니다. 뭍으로 돌아갑니다.';
  }
}
/** 끌고 오던 사람을 그 자리 물에 놓는다 (inWater 그대로 — 다시 떠내려간다). 대원이 선 물 칸에 둔다 */
function dropInWater(sim: Sim, s: Scene, a: FieldAgent): void {
  if (a.carrying < 0) return;
  const c = s.casualties[a.carrying];
  a.carrying = -1;
  if (c.where !== 'carried') return;
  c.where = 'scene'; c.x = Math.round(a.x); c.y = Math.round(a.y);
  learnQuiet(sim, a, casFact(sim, s, c, sim.responders[a.rid].name));
}
/**
 * 헤엄 중 사고 (§3.5·§4.1): 한 번 피해(체력 하한 18), 지구력 −25, 끌던 사람을 놓친다, 기록 한 줄.
 * 헤엄 구조 중이면 방법을 접고(실패 — METHOD_FAIL) 임무를 내려놓은 뒤 뭍으로 간다. 그 대상의 헤엄·보트는 60초 동안 다시 고르지 않는다(a.mfail).
 * 그 밖의 임무(뭍으로·철수 — 물을 건너는 중)면 피해·기록만.
 */
function swimMishap(sim: Sim, s: Scene, I: Incident, a: FieldAgent, k: ExecKit, kind: Mishap): void {
  const r = sim.responders[a.rid], t = a.task;
  const rescue = t !== null && t.kind === 'waterRescue' && t.method === 'swim';
  const towing = a.carrying >= 0;
  const tended = rescue && tenderFor(s, a, t!.cas) !== null;
  const raw = mrng(sim, s, a).range(SWIM_HURT.mishap[0], SWIM_HURT.mishap[1]) * (tended ? 0.5 : 1);
  dropInWater(sim, s, a);
  let ev: number;
  if (rescue) {
    const key = targetKey('waterRescue', targetOf(t!));
    switchMethod(sim, s, I, a, t!, 'failed', MISHAP_DETAIL[kind], false, { say: mishapSay(kind, towing) });
    rememberFail(sim, a, key, 'boat', 'failed');      // 헤엄은 switchMethod 가 기억한다 — 보트로도 곧바로 다시 나서지 않는다
    const ms = I.methods!;
    ev = ms[ms.length - 1].eventId;
    k.finish(sim, s, a, false, 'preempt');
    const nt = k.makeTask('ashore', '뭍으로');
    nt.startedAt = sim.t;
    a.task = nt;
  } else ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 2, text: kind === 'tired' ? '힘이 빠졌습니다.' : '물살에 휩쓸려 물을 먹었습니다.' });
  wetHurt(sim, s, I, a, raw, false, ev);
  r.stamina = Math.max(0, r.stamina - SWIM_HURT.stamina);
}

/**
 * 물 위 대원의 매 틱 효과 — 한 곳 (§3.5). executor.act 가 left·down 검사 바로 다음(임무가 없어도) 부른다: 헤엄·보트 방법만이 아니라
 * 뭍으로·철수 중인 대원, 보트가 뒤집혀 헤엄 중이 된 대원 모두에게 같은 규칙이 걸린다. 뭍 칸에 서면 들어간 시각을 지운다.
 *   헤엄 중: 물살에 떠밀림(물살 × 0.7 — 끌고 오는 사람도 함께) · 지구력 소모 · 익수 피해(초당 1.2, 하한 18) · 사고 판정(mrng)과 강제 사고 셋
 *            (지침은 물에 한 번 들어갈 때 한 번, 위기·떠밀림은 헤엄 구조 중에만 — 뭍으로 가는 중에 되풀이되지 않게)
 *   물 위에 150초 넘게 있으면 안전장치(pullAshore)
 * 판정 뒤(사건이 닫힌 뒤)에는 피해·사고가 없다 (§2.6 — 떠밀림·지구력만).
 */
export function waterTick(sim: Sim, s: Scene, I: Incident, a: FieldAgent, k: ExecKit): void {
  if (s.tiles[tileOf(s, a.x, a.y)] !== T.WATER) { a.wetSince = undefined; a.wetTired = undefined; return; }
  a.wetSince ??= sim.t;
  if (a.afloat === undefined) {
    const r = sim.responders[a.rid], dt = sim.dt;
    const flow = s.flow ?? 0, flowK = Math.min(1, flow / 0.1);
    // 떠밀림: 다음 칸이 물이 아니면(선체·바위·다리 기둥) 멈춘다. 현장 끝 1.5칸 앞에서 자른다
    if (flow > 0) {
      const nx = Math.min(a.x + flow * 0.7 * dt, s.w - 1.5);
      if (nx > a.x && s.tiles[tileOf(s, nx + 0.4, a.y)] === T.WATER) {
        const dx = nx - a.x;
        a.x = nx;
        if (a.carrying >= 0) s.casualties[a.carrying].x += dx;
      }
    }
    const towing = a.carrying >= 0;
    k.drain(sim, a, towing ? SWIM_HURT.drainTow : SWIM_HURT.drain);
    if (I.phase !== 'closed') {
      const pfd = kitCount(sim, a.rid, 'pfd') > 0, dry = kitCount(sim, a.rid, 'drysuit') > 0;
      wetHurt(sim, s, I, a, SWIM_HURT.tick * dt * (pfd ? 0.5 : 1) * (dry ? 0.7 : 1), true);
      const t = a.task, rescue = t !== null && t.kind === 'waterRescue' && t.method === 'swim';
      const tended = rescue && tenderFor(s, a, t!.cas) !== null;
      let kind: Mishap | null = null;
      if (mrng(sim, s, a).chance(swimTrouble(swimOf(sim, a), flowK, pfd, dry, tended, r.stamina < 30, towing, sim.weather === 'night') * dt)) kind = 'flow';
      else if (r.stamina <= 8 && !a.wetTired) { kind = 'tired'; a.wetTired = true; }
      else if (rescue && r.health < 30) kind = 'crisis';
      else if (rescue && a.x >= s.w - 2) kind = 'swept';
      if (kind !== null) swimMishap(sim, s, I, a, k, kind);
    }
  }
  if (a.wetSince !== undefined && sim.t - a.wetSince > SWIM.stuck) pullAshore(sim, s, I, a, '오래 갇힘');
}

/**
 * 안전장치 (§3.5): 대원을 가장 가까운 뭍 칸으로 옮긴다 (못 찾으면 안전 구역, 그다음 대기 지점). 보트에서 내리고, 끌던 사람은 그 자리 물에 놓는다.
 * 다른 피해원(연기·불·폭발)이나 경로 문제로 물 위에 남는 경우를 위한 마지막 장치다 — 물리적으로 너그러운 처리라 기록(truth)으로 드러낸다.
 * 부르는 곳: case 'ashore' 의 경로 없음·30초 초과, waterTick 의 150초, rules/methods.ts 의 "물 칸 위에 쓰러진(숨진) 대원". why 는 기록하지 않는 사유(시험·읽는 사람용)
 */
export function pullAshore(sim: Sim, s: Scene, I: Incident, a: FieldAgent, why: string): void {
  void why;
  const b = reachOf(s, a.x, a.y, 4, null) ?? s.safe ?? s.staging;
  dropInWater(sim, s, a);
  a.x = a.px = b.x; a.y = a.py = b.y;
  a.afloat = undefined; a.path = null; a.pathGoal = -1; a.wetSince = undefined; a.wetTired = undefined;
  const r = sim.responders[a.rid];
  emit(sim, { inc: I.id, truth: true, role: 'SYSTEM', actor: '현장', kind: 'action', imp: 1, text: `물살에 밀려 ${r.name} 대원이 물가에 걸렸습니다.` });
}

/**
 * executor.finishTask 의 내려놓기 — 업고 있던 사람이 물에서 끌고 오던 사람(c.inWater)일 때 (§3.5).
 * 대원이 선 칸이 물이면 지금처럼 그 자리에 놓는다(다시 떠내려간다). 뭍이면 뭍에 내려놓고 완료 기록·방법 기록을 함께 남긴다(숨진 사람은 내려놓기만).
 */
export function dropWet(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, c: Casualty): void {
  const x = Math.round(a.x), y = Math.round(a.y);
  if (s.tiles[tileOf(s, x, y)] === T.WATER) { c.where = 'scene'; c.x = x; c.y = y; return; }
  if (c.dead) { c.where = 'scene'; c.inWater = false; c.drift = 0; c.x = c.px = x; c.y = c.py = y; return; }
  landed(sim, s, I, a, t, c, t.method ?? 'hand', x, y);
}

/**
 * 다른 대원이 끌고 오는 대상 (§4.1): 끌고 오는 대원이 헤엄 중이고 이 대원이 구명줄을 들었으면 예정된 전환으로 줄 확보(실패가 아니다 — 접은 줄을 남기지 않는다).
 * 아니면 끄는 동료 가까운 물가로 가서 기다린다('구조 지원 대기'). 물 위에서 기다리지는 않는다 — 내려놓고 뭍으로(brain 의 물 위 가드).
 */
function waitCarried(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, c: Casualty, k: ExecKit): void {
  let carrier: FieldAgent | null = null;
  for (let q = 0; q < s.agents.length; q++) if (s.agents[q].carrying === c.id) { carrier = s.agents[q]; break; }
  if (carrier === null) { c.where = 'scene'; return; }      // 끄는 사람이 없는 '끌려가는 중' (지금의 이송 보조와 같은 처리)
  if (a.afloat !== undefined || onWater(s, a)) { k.finish(sim, s, a, false, 'preempt'); return; }
  const swimming = carrier.task !== null && carrier.task.method === 'swim';
  if (swimming && kitCount(sim, a.rid, 'rope') > 0) {
    t.method = 'tend'; t.mwhy = 'team'; t.missing = undefined; t.mcands = undefined; t.mt0 = sim.t; t.mtry = 0; t.mbad = 0;
    t.phase = 0; t.progress = 0; t.range = 0; a.path = null;
    announce(sim, I, a, t, 'waterRescue', targetOf(t));
    return;
  }
  a.label = '구조 지원 대기'; t.progress = 0;
  k.moveTo(sim, s, a, carrier.x, carrier.y, 2.5);      // 길이 없으면 그 자리에서 기다린다
}

/**
 * 줄 확보 (§4.1 tend): 헤엄 동료가 들어간 물가 칸(그 동료가 정한 진입점 — 아직 정하지 않았으면 대상에서 가장 가까운 뭍)으로 가서 줄을 잡는다.
 * 자리를 잡으면(phase 1) 그 동료의 사고율과 사고 피해가 반으로 준다(waterTick·swimMishap 이 이 대원을 찾는다). 끌고 나올 때 그 동료는 이 대원 쪽으로 온다.
 * 헤엄 동료가 없어지면(사고로 접었거나 뭍으로) 대상이 아직 물속이므로 조건 상실(team)로 바꾼다 — 대상이 물 밖이 되면 첫 줄에서 끝난다.
 */
function runTend(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, c: Casualty, k: ExecKit): void {
  const sw = swimmerFor(s, a, c.id);
  if (sw === null) { switchMethod(sim, s, I, a, t, 'team', lostText('tend', true), true, { k }); return; }
  if (t.range === 0) {
    const q = sw.task!;
    const e = q.range > 0 ? { x: q.tx, y: q.ty } : reachOf(s, c.x, c.y, 4, a);
    if (e === null) { switchMethod(sim, s, I, a, t, 'tooFar', '줄을 잡을 물가가 없음', true, { k }); return; }
    t.tx = e.x; t.ty = e.y; t.range = TEND_RANGE;
  }
  const mv = k.moveTo(sim, s, a, t.tx, t.ty, TEND_RANGE);
  if (mv === 'nopath') {
    if (!(t.tried && t.tried.length) && switchMethod(sim, s, I, a, t, 'tooFar', '줄을 잡을 물가로 갈 길이 없음')) return;
    k.finish(sim, s, a, false, 'nopath'); return;
  }
  a.label = METHOD.tend.label;
  if (mv !== 'arrived') return;
  if (t.phase === 0) t.phase = 1;
  a.fx = sw.x - a.x; a.fy = sw.y - a.y;      // 헤엄치는 동료를 바라본다
}

/**
 * 헤엄쳐 접근 (§4.1 swim). 물 칸 위의 매 틱 효과(떠밀림·지구력·익수 피해·사고)는 이 함수가 아니라 waterTick 이 준다.
 *   phase 0  물가 진입점 E(대상에서 가장 가까운, 대원이 걸어서 닿는 뭍 칸 — 실행부라 진실 위치로. 처음 한 번)로 걸어간다
 *   phase 1  준비 (제자리 — 소방은 방화복·공기호흡기를 벗고, 구명조끼를 입는다)
 *   phase 2  헤엄쳐 접근 (executor.costFor 가 물 칸을 지나게 한다)
 *   phase 3  붙잡기 1.5초 → 붙잡힘 판정(mrng) → 붙잡으면 끌려가는 중(c.where = 'carried' — inWater 는 그대로)
 *   phase 4  끌고 나오기: 뭍 칸 B(줄을 잡은 동료가 선 칸, 없으면 가장 가까운 뭍)로. 뭍 칸에 서면 내려놓고 끝
 * 한 틱에 moveTo 는 한 번.
 */
function runSwim(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, c: Casualty, k: ExecKit): void {
  const r = sim.responders[a.rid], dt = sim.dt;
  if (t.phase === 0) {
    if (t.range === 0) {
      const e = reachOf(s, c.x, c.y, 4, a);
      if (e === null) { switchMethod(sim, s, I, a, t, 'tooFar', '헤엄쳐 들어갈 물가가 없음', true, { k }); return; }
      t.tx = e.x; t.ty = e.y; t.range = SWIM.entry;
    }
    const mv = k.moveTo(sim, s, a, t.tx, t.ty, SWIM.entry);
    if (mv === 'nopath') {
      if (!(t.tried && t.tried.length) && switchMethod(sim, s, I, a, t, 'tooFar', '물가로 갈 길이 없음')) return;
      k.finish(sim, s, a, false, 'nopath'); return;
    }
    a.label = '물가로 이동';
    if (mv !== 'arrived') return;
    t.phase = 1; t.progress = 0;
    return;
  }
  if (t.phase === 1) {
    const pfd = kitCount(sim, a.rid, 'pfd') > 0, fire = r.dept === 'fire';
    t.need = (fire ? SWIM.prepFire : SWIM.prep) + (pfd ? SWIM.prepPfd : 0);
    a.label = fire ? '방화복 벗는 중' : pfd ? '구명조끼 착용' : '입수 준비';
    a.fx = c.x - a.x; a.fy = c.y - a.y;
    t.progress += dt; a.ring = t.progress / t.need;
    if (t.progress >= t.need) { t.phase = 2; t.progress = 0; a.path = null; }
    return;
  }
  if (t.phase === 2) {
    a.label = '헤엄쳐 접근';
    const mv = k.moveTo(sim, s, a, c.x, c.y, SWIM.reach);
    if (mv === 'nopath') { switchMethod(sim, s, I, a, t, 'tooFar', '헤엄쳐 닿을 길이 없음', false); k.finish(sim, s, a, false, 'nopath'); return; }
    if (mv !== 'arrived' && dist(a.x, a.y, c.x, c.y) > SWIM.reach) return;
    t.phase = 3; t.progress = 0;
    return;
  }
  if (t.phase === 3) {
    if (dist(a.x, a.y, c.x, c.y) > SWIM.grabFar) { t.phase = 2; t.progress = 0; return; }      // 그 사이 물살에 벌어졌다 — 다시 헤엄쳐 간다
    a.label = '붙잡는 중';
    a.fx = c.x - a.x; a.fy = c.y - a.y;
    t.progress += dt; a.ring = t.progress / SWIM.grab;
    if (t.progress < SWIM.grab) return;
    // 붙잡힘 (H1 이 R2 몫으로 남긴 "구조 대상이 구조자를 붙잡음"): 허우적댈 힘이 남은 대상은 구조자를 끌어내릴 수 있다 — 던지기를 먼저 하는 까닭
    if (mrng(sim, s, a).chance(clutchP(swimOf(sim, a), kitCount(sim, a.rid, 'pfd') > 0, c.health))) { swimMishap(sim, s, I, a, k, 'clutch'); return; }
    c.where = 'carried'; a.carrying = c.id; a.path = null; a.pathGoal = -1;
    emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `구조 대상 ${josa(c.label, '을/를')} 붙잡았습니다. 물가로 끌고 갑니다.` });
    learnQuiet(sim, a, casFact(sim, s, c, r.name));
    // 끌고 나올 뭍 칸 B (한 번): 줄을 잡은 동료가 선 물가 칸, 없으면 가장 가까운 뭍
    const tn = tenderFor(s, a, c.id);
    const b = tn !== null ? { x: Math.round(tn.x), y: Math.round(tn.y) } : reachOf(s, a.x, a.y, 4, a) ?? s.safe;
    t.tx = b.x; t.ty = b.y; t.phase = 4; t.progress = 0;
    return;
  }
  // phase 4: 끌고 나온다 (대상은 대원 바로 뒤 — 이송과 같은 식)
  a.label = '끌고 나오는 중';
  const mv = k.moveTo(sim, s, a, t.tx, t.ty, 0.3);
  c.x = a.x - a.fx * SWIM.tow; c.y = a.y - a.fy * SWIM.tow;
  if (!onWater(s, a)) {      // 뭍 칸에 섰다
    landed(sim, s, I, a, t, c, 'swim', a.x, a.y);
    k.finish(sim, s, a, true);
    return;
  }
  if (mv === 'nopath') {
    dropInWater(sim, s, a);
    switchMethod(sim, s, I, a, t, 'tooFar', '끌고 나올 물가가 없음', false);
    k.finish(sim, s, a, false, 'nopath');
  }
}
