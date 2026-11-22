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
//   단계 1c  보트(runBoat)
//   단계 2   문·통로: blockerRate(방법별 속도)·blockerKitFails(유압 개방기의 장비 확인)·doorNoise(충격기·폭파의 소리), 폭파 진입 runCharge·stackSpot(물러설 자리) — executor.workOnBlocker 가 부른다
//   단계 3   구출: extricateRate(방법별 k·장비 값)·extricatePrep(준비 시간·장비 확인·지지대의 균열 보강)·tunnelSlide(손으로 파기의 붕락)·extricateDoneText,
//            수색: searchStop(경유점에 멈추는 시간·탐지 장비 확인) — executor 의 case 'extricate'·'search' 가 부른다
//   단계 4   화재: runSuppress(외부 방어 방수·고가 사다리 방수·배연 — 내부 공격은 executor 의 지금 코드)·runExtinguisher(소화기 — 펌프·물을 쓰지 않는다)·confirmOut(진압 확인) —
//            executor 의 case 'suppress' 가 부른다. 송풍기 s.fan 의 효과는 세계 규칙(rules/methods.ts)과 X6 의 가스 모델(catastrophe.gasStep)
//   단계 5   무장: runBeanbag(비살상탄)·runSniper(결정적 저격)·sniperSpot, 검거 기록의 이름 arrestMethod·recordArrest·stunMethod(무력화 수단 h.stunHow) —
//            executor 의 case 'engage'·'arrest' 가 부른다
//   단계 6   누출: runVentFirst(환기 후 차단 — 송풍기 또는 맨몸으로 문·창 열기 → s.fan → 기다림 → 차단 ×0.8) — executor 의 case 'mitigate' 가 부른다.
//            즉시 이송(rush)·헬기 이송 기록(airlift)·대피 방송(announce)은 executor 의 case 'treat'·'load'·'perimeter' 와 hazards.tickGas 에 한 줄씩

import type { Sim } from '../engine';
import { emit, lastProblemEvent, raiseProblem } from '../events';
import type { Rng } from '../rng';
import { T } from '../types';
import type { CasBelief, Casualty, FieldAgent, Hostile, Incident, KitId, KitItem, MethodId, MethodUse, MethodWhy, Problem, Prop, Scene, Task, TaskKind, Unit, WorkKind } from '../types';
import { clamp, dist, josa } from '../util';
import { casFact, learn, learnQuiet, staminaF, visionOf } from './agents';
import { BARE_HANDS, bestTool, kitCount, kitTool, kitWorks, useKit } from './gear';
import { los, staticPass, tileOf } from './grid';
import { applyWater, blast, hostageNear, pushFx } from './hazards';
import { fireShot } from './damage';
import { recShot } from './fxlog';
import { EXT_RANGE, exteriorSpots, opsExterior } from './ops';
import { AERIAL_RANGE, BEANBAG_RANGE, HAND_REACH, METHOD, POLE_REACH, SNIPER_RANGE, aerialSpots, RING_REACH, SAY, THROW_REACH, WORK_MODE, catchPoint, chooseMethod, methodStillFits, onWater, reachOf, sayStart, shoreCrack, swimOf, targetKey } from './methods';
import { hurtCas, hurtHostile, hurtResponder } from './injury';
import { mkFact } from './beliefs';
import type { MTarget, MethodPick, Sense } from './methods';
import { docCtx, hasDoc } from './doctrine';      // (R3) 교본 입력 (자기 모드)
import type { DocCtx } from './doctrine/registry';
import { recordDoc } from './doctrineRun';      // (R3 1단계) 교본이 방법의 1등을 바꾼 기록

/** 실행기가 건네는 도구 (executor.ts 의 XK). 지휘 규칙의 CommandKit 과 같은 방식 */
export interface ExecKit {
  moveTo(sim: Sim, s: Scene, a: FieldAgent, tx: number, ty: number, range: number, needLos?: boolean, escape?: boolean): 'arrived' | 'moving' | 'nopath' | 'busy';      // escape (R3 3단계 — 공기 탈출): 물러나는 길은 불길도 뚫는다 (executor.moveTo 그대로)
  finish(sim: Sim, s: Scene, a: FieldAgent, ok: boolean, reason?: string): void;
  drain(sim: Sim, a: FieldAgent, rate: number): void;
  spray(sim: Sim, s: Scene, a: FieldAgent, tx: number, ty: number, eff?: number, wmul?: number, jitter?: boolean): boolean;
  makeTask(kind: TaskKind, label: string): Task;
  /** (단계 2) 문·잔해를 연다 — 방법별 완료 문구·G5 진입 기록(how = 방법)·통로 차단 복구. 돌려주는 값 = 완료 기록 id (폭파 진입의 폭발 원인) */
  unblock(sim: Sim, s: Scene, a: FieldAgent, tile: number, method?: MethodId): number;
}

/** 대원이 선 칸에서 잰 연기와 열 (몸의 감각 — 판단부에 넘기는 유일한 진실) */
export function senseOf(s: Scene, a: FieldAgent): Sense { const i = tileOf(s, a.x, a.y); return { smoke: s.smoke[i], heat: s.fire[i] }; }
/** (R3) 실행부가 방법을 고를 때 넘기는 교본 입력 — 자기 모드 (R3 §2.3 ③). 방법 줄이 없으면 만들지 않는다(null) */
export function selfDc(sim: Sim, s: Scene, a: FieldAgent, t: Task): DocCtx | null { return hasDoc('method') ? docCtx(sim, s, a, 'self', t.workId >= 0 ? s.board[t.workId] ?? null : null, senseOf(s, a)) : null; }

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
export function targetOf(t: Task): MTarget { return { cas: t.cas, prop: t.prop, hostile: t.hostile, region: t.region, tile: t.tile, animal: t.animal ?? -1 }; }

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
/**
 * 한 대원이 한 사건에서 처음 고를 때만 알리는 방법 (구역마다 수색 임무가 따로 나와 여러 번 고른다 — §3.6).
 * (단계 6) 즉시 이송도: 처치 임무는 환자 둘 사이를 오가며 다시 받는 일이 잦아(점수가 비슷한 두 후보) 받을 때마다 알리면 같은 말이 쏟아졌다
 */
const SAY_ONCE: ReadonlySet<MethodId> = new Set<MethodId>(['listen', 'hail', 'thermal', 'rush', 'feel']);      // (R3 3단계) 벽 더듬기도 탐지 방법 — 방마다 알리면 한 대원이 한 사건에서 열 번 넘게 같은 말을 했다
/**
 * (검토) 같은 대원이 같은 대상에 같은 방법을 다시 고른 시작 문구는 이 시간(초) 안이면 다시 알리지 않는다 — 다시 고를 때마다 시계를 새로 잰다.
 * 임무를 다시 받을 때마다 방법을 처음부터 고르므로(새 Task) 대원이 곁의 두 일 사이를 오가거나(brain 의 자체 판단 — 지휘관이 고립자 셋 사이를 0.6초마다)
 * 지휘관이 꺼졌다 되살아나는 불에 같은 진압을 5초마다 다시 내면 같은 말이 수십 번 쏟아졌다(측정 도구의 반복 최대 6 → 26). 기록만 줄인다 — 고르는 것은 그대로다
 */
export const SAY_AGAIN = 20;
/** 대원마다 (대상 열쇠|방법) → 마지막으로 그 시작 문구를 고른 시각 (현장 대원 객체의 모양을 바꾸지 않으려 WeakMap — 되감기는 Sim 을 새로 만든다) */
const SAID = new WeakMap<FieldAgent, Map<string, number>>();
/** 이번 시작 문구가 같은 대원·같은 대상·같은 방법의 되풀이인가 (SAY_AGAIN 안). 부를 때마다 그 시각을 적는다 */
function sayRepeat(sim: Sim, a: FieldAgent, key: string): boolean {
  let m = SAID.get(a);
  if (m === undefined) { m = new Map(); SAID.set(a, m); }
  const last = m.get(key);
  m.set(key, sim.t);
  return last !== undefined && sim.t - last < SAY_AGAIN;
}
/**
 * 방법을 정한 순간의 시작 문구 (§3.6). 알리지 않는 것: 기록 전용 방법, 평소 방법(plain) — 문·잔해처럼 자주 일어나는 일은 완료 문구만 방법별로 바뀐다.
 * 다만 같은 대상에 아직 복구되지 않은 방법 실패가 있으면 평소 방법이라도 알린다(관찰자가 "다른 방법으로 다시"를 보게).
 * 탐지 방법은 한 대원이 한 사건에서 처음 고를 때만. 같은 대원·같은 대상·같은 방법을 SAY_AGAIN 초 안에 다시 고르면 알리지 않는다.
 * 돌려주는 값 = 남긴 기록 id (알리지 않았으면 -1).
 */
function announce(sim: Sim, I: Incident, a: FieldAgent, t: Task, work: WorkKind, tg: MTarget, skip?: MethodId): number {
  const m = t.method;
  if (m === undefined) return -1;
  const d = METHOD[m];
  if (d.record) return -1;
  if (work === 'suppress') { const sc = sim.scenes[I.id]; if (sc && opsExterior(sc, tg.region)) return -1; }      // (단계 4) X6 의 외부 방어 중: 지휘관의 지시("건물 밖에서 방수하라")가 이미 알렸다 — 방수 작업마다 되풀이하지 않는다
  let text: string;
  if (d.plain) {
    if (!openFails(I, targetKey(work, tg)).length) return -1;
    text = SAY[m];
  } else {
    if (SAY_ONCE.has(m)) { const said = (a.msaid ??= []); if (said.indexOf(m) >= 0) return -1; said.push(m); }
    text = sayStart(m, t.mwhy ?? 'usual', t.missing, skip);
  }
  if (sayRepeat(sim, a, targetKey(work, tg) + '|' + m)) return -1;
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
  docPick(sim, I, a, pick, work, tg, announce(sim, I, a, t, work, tg, pick.skip));
  return true;
}
/** (R3 §3.7) 교본 줄이 방법의 1등을 바꿨으면 그 줄을 사건의 교본 기록에 (ev = 그때 남긴 시작 문구 — 없으면 -1) */
function docPick(sim: Sim, I: Incident, a: FieldAgent, pick: MethodPick, work: WorkKind, tg: MTarget, ev: number): void {
  if (pick.doc !== undefined) recordDoc(sim, I, a, pick.doc, 'method', { method: pick.m, work, tgt: targetKey(work, tg) }, ev);
}

/**
 * 도착 재선택 (§3.2-2): 그 방법의 작업 자리에 처음 닿은 틱에 한 번, 지금 선 자리의 감각으로 다시 고른다(진행도와 단계가 0 일 때만).
 * 다른 방법이 1등이면 예정된 전환이다 — 실패가 아니므로 접은 줄을 남기지 않고 t.tried·a.mfail 에도 넣지 않는다. 평소 방법이 아니면 시작 문구는 낸다.
 * anyPhase: (단계 4) 진행도·단계를 따지지 않는다 — 내부 공격(지금 코드)은 단계·진행도 칸을 화점 다시 고르기 시계로 쓰므로 화점 곁에 처음 닿은 틱에 이것으로 부른다.
 * 돌려주는 값 = 방법을 바꿨다 (부른 쪽은 그 틱에 끝낸다)
 */
export function recheckOnArrive(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, work: WorkKind, tg: MTarget, anyPhase = false): boolean {
  if (t.marr) return false;
  t.marr = true;
  if (!anyPhase && (t.progress !== 0 || t.phase !== 0)) return false;
  const pick = chooseMethod(sim, s, a, work, tg, t, senseOf(s, a), selfDc(sim, s, a, t));
  if (pick === null || pick.m === t.method) return false;
  applyPick(sim, t, pick);
  t.phase = 0; t.progress = 0;
  docPick(sim, I, a, pick, work, tg, announce(sim, I, a, t, work, tg, pick.skip));
  return true;
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
    docPick(sim, I, a, pick, work, tg, ev);
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
/**
 * 즉석 부력물(옷·끈을 이은 줄과 빈 통)의 명중·잡기 배율 — 설계서 §4.1 의 시작값 그대로. 수난 균형의 손잡이(§6)다:
 * 단계 1c 에서 0.85 도 재 보았으나 선박 화재 60교대의 성공률이 같아(방법 실패만 반) 시작값을 두었다 (구현 메모)
 */
export const IMPROVISE_MUL = 0.7;

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
  if (m === 'boat') return '같은 부대의 보트를 동료가 씀';      // 보트의 조건은 "부대의 보트가 비어 있다" 하나다 (고무보트의 고장이 알려진 것도 여기로 온다)
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
  if (sim.tick % 5 === 0 && t.mt0 !== sim.t && !(m === 'catch' && t.phase >= 1) && !(m === 'swim' && t.phase >= 2) && !(m === 'tend' && t.phase >= 1) && !(m === 'boat' && t.phase >= 1)) {
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
  if (m === 'boat') { runBoat(sim, s, I, a, t, c, k); return; }
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
    else if (m === 'improvise') { hit *= IMPROVISE_MUL; grab *= IMPROVISE_MUL; }
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
/** 물가 방법 밖에서 자기 실행부를 가진 수난 방법 (하류 차단 1a · 헤엄·줄 확보 1b · 보트 1c) */
const OWN_RUN: ReadonlySet<MethodId> = new Set<MethodId>(['catch', 'swim', 'tend', 'boat']);
/** 몸이 물 위에 있어도 되는 방법의 단계: 헤엄은 물에 들어간 뒤(phase ≥ 2), 보트는 띄운 뒤(phase ≥ 1) */
function inWaterPhase(m: MethodId, t: Task): boolean { return (m === 'swim' && t.phase >= 2) || (m === 'boat' && t.phase >= 1); }
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
  } else if (I.phase !== 'closed') {
    // (1c) 보트 위: 전복 판정 (초당 0.0015 × (1 + 2 × 물살)) — 뒤집히면 그 자리 물 칸에서 다음 틱부터 헤엄 중이다
    const flowK = Math.min(1, (s.flow ?? 0) / 0.1);
    if (mrng(sim, s, a).chance(BOAT.capsize * (1 + 2 * flowK) * sim.dt)) boatCapsize(sim, s, I, a, k);
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

// ───────────────────────── 수난 구조 (§4.1·§3.5) — 단계 1c: 보트 ─────────────────────────
/**
 * 보트의 수치 (§4.1 boat): 진수 지점에서 멈추는 거리(칸) · 진수 시간(초 — 구조정 8, 고무보트 14) · 붙잡는 거리(칸)·벌어지면 다시 다가가는 거리 ·
 * 끌어올리는 시간(초) · 뭍에 대는 거리(칸 — 뭍 칸을 가운데로, 둘레의 물 칸에서 멈춘다) · 전복(초당, 물살 배율 전)
 */
export const BOAT = { entry: 0.5, launchUnit: 8, launchRaft: 14, reach: 0.9, grabFar: 1.4, haul: 2.5, dock: 1.5, capsize: 0.0015 };
/** 구조정의 대원인가 (보트를 장비 없이 쓰는 부대 — METHOD.boat.altUnit) */
const boatUnit = (sim: Sim, a: FieldAgent): boolean => (METHOD.boat.altUnit ?? []).indexOf(sim.units[a.unitId].kind) >= 0;

/**
 * 보트 전복 (§3.5): 보트에서 떨어져 그 자리 물 칸에 빠진다(다음 틱부터 헤엄 중 — waterTick 의 익수·사고가 걸린다). 실은 사람은 그 자리 물에 놓친다.
 * 보트 구조 중이면 방법을 접고(실패) 임무를 내려놓은 뒤 뭍으로 간다 — 그 대상의 보트·헤엄은 60초 동안 다시 고르지 않는다.
 */
function boatCapsize(sim: Sim, s: Scene, I: Incident, a: FieldAgent, k: ExecKit): void {
  const r = sim.responders[a.rid], t = a.task;
  a.afloat = undefined;
  dropInWater(sim, s, a);
  const say = '보트가 뒤집혔습니다! 물에 빠졌습니다.';
  if (t !== null && t.kind === 'waterRescue' && t.method === 'boat') {
    const key = targetKey('waterRescue', targetOf(t));
    switchMethod(sim, s, I, a, t, 'failed', '보트 구조 중 보트 전복', false, { say });
    rememberFail(sim, a, key, 'swim', 'failed');
    k.finish(sim, s, a, false, 'preempt');
    const nt = k.makeTask('ashore', '뭍으로');
    nt.startedAt = sim.t;
    a.task = nt;
  } else emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 2, text: say });
}

/**
 * 보트 접근 (§4.1 boat): 고무보트(로프 대원) 또는 구조정(대원이 장비 없이). 한 틱에 moveTo 는 한 번.
 *   phase 0  진수 지점 L(대상에서 가장 가까운, 대원이 걸어서 닿는 뭍 칸 — 처음 한 번)로 걸어간다 → 도착하면 고무보트의 작동 확인(kitWorks — 숨은 고장이면 broken)
 *            → 진수(구조정 8초·고무보트 14초) → L 의 여덟 이웃 가운데 대상(믿음 위치)에 가장 가까운 물 칸으로 대원을 옮기고 a.afloat = 'boat'
 *            (뭍 칸 위에서 켜면 다음 틱 세계 규칙이 풀어 버린다)
 *   phase 1  보트로 다가간다 (executor.costFor 의 보트 비용 — 물 칸만)
 *   phase 2  끌어올리기 2.5초 → 끌려가는 중(c.where = 'carried' — inWater 는 그대로, 보트 안에 눕는다)
 *   phase 3  L 둘레의 물 칸까지 와서 대원을 L 에 올리고 보트에서 내린다 → 뭍에 내려놓고 끝
 * 도중에 대상이 물 밖이 되면(호이스트가 먼저 끝났다) 첫 줄에서 끝난다 — 다음 판단에서 뭍으로(brain 의 물 위 가드 → case 'ashore' 의 보트 갈래가 뭍에 댄다).
 * 전복은 waterTick 이 판정한다.
 */
function runBoat(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, c: Casualty, k: ExecKit): void {
  const r = sim.responders[a.rid], dt = sim.dt;
  if (t.phase === 0) {
    if (t.range === 0) {
      const l = reachOf(s, c.x, c.y, 4, a);
      if (l === null) { switchMethod(sim, s, I, a, t, 'tooFar', '보트를 띄울 물가가 없음', true, { k }); return; }
      t.tx = l.x; t.ty = l.y; t.range = BOAT.entry;
    }
    const mv = k.moveTo(sim, s, a, t.tx, t.ty, BOAT.entry);
    if (mv === 'nopath') {
      if (!(t.tried && t.tried.length) && switchMethod(sim, s, I, a, t, 'tooFar', '진수 지점으로 갈 길이 없음')) return;
      k.finish(sim, s, a, false, 'nopath'); return;
    }
    if (mv !== 'arrived') { a.label = '진수 지점으로'; t.progress = 0; return; }
    const unit = boatUnit(sim, a);
    // 고무보트는 띄우기 시작할 때 작동을 확인한다 (숨은 고장이 이때 드러난다 — EQUIP_FAIL 은 kitWorks 가 남긴다)
    if (!unit && t.progress === 0 && !kitWorks(sim, a.rid, 'raft', I)) { switchMethod(sim, s, I, a, t, 'broken', '고무보트가 장비 고장으로 막힘', true, { k }); return; }
    a.label = '보트 띄우는 중';
    t.need = unit ? BOAT.launchUnit : BOAT.launchRaft;
    t.progress += dt; a.ring = t.progress / t.need;
    a.fx = c.x - a.x; a.fy = c.y - a.y;
    if (t.progress < t.need) return;
    // 물에 띄운다: 진수 지점의 여덟 이웃 가운데 대상(믿음 위치 — 없으면 본 자리)에 가장 가까운 물 칸
    const cb = a.beliefs.val<CasBelief>('cas', c.id);
    const gx = cb ? cb.x : c.x, gy = cb ? cb.y : c.y;
    let wx = -1, wy = -1, wd = Infinity;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const x = t.tx + dx, y = t.ty + dy;
      if ((dx === 0 && dy === 0) || x < 0 || y < 0 || x >= s.w || y >= s.h || s.tiles[y * s.w + x] !== T.WATER) continue;
      const d = (x - gx) * (x - gx) + (y - gy) * (y - gy);
      if (d < wd) { wd = d; wx = x; wy = y; }
    }
    if (wx < 0) { switchMethod(sim, s, I, a, t, 'tooFar', '보트를 띄울 물이 없음', true, { k }); return; }
    a.x = a.px = wx; a.y = a.py = wy; a.afloat = 'boat'; a.path = null; a.pathGoal = -1;
    emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: '보트를 띄웠습니다.' });
    t.phase = 1; t.progress = 0;
    return;
  }
  if (a.afloat === undefined) { k.finish(sim, s, a, false, 'preempt'); return; }      // 보트에서 내렸다(해일이 뭍으로 옮겼다 등) — 내려놓고 다시 판단한다
  if (t.phase === 1) {
    a.label = METHOD.boat.label;
    const mv = k.moveTo(sim, s, a, c.x, c.y, BOAT.reach);
    if (mv === 'nopath') { switchMethod(sim, s, I, a, t, 'tooFar', '보트로 닿을 길이 없음', false); k.finish(sim, s, a, false, 'nopath'); return; }
    if (mv !== 'arrived' && dist(a.x, a.y, c.x, c.y) > BOAT.reach) return;
    t.phase = 2; t.progress = 0;
    return;
  }
  if (t.phase === 2) {
    if (dist(a.x, a.y, c.x, c.y) > BOAT.grabFar) { t.phase = 1; t.progress = 0; return; }
    a.label = '보트로 끌어올리는 중';
    a.fx = c.x - a.x; a.fy = c.y - a.y;
    t.progress += dt; a.ring = t.progress / BOAT.haul;
    if (t.progress < BOAT.haul) return;
    c.where = 'carried'; a.carrying = c.id; a.path = null; a.pathGoal = -1;
    c.x = a.x; c.y = a.y;
    emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `구조 대상 ${josa(c.label, '을/를')} 보트에 끌어올렸습니다. 물가로 돌아갑니다.` });
    learnQuiet(sim, a, casFact(sim, s, c, r.name));
    t.phase = 3; t.progress = 0;
    return;
  }
  // phase 3: 진수 지점(뭍 칸)을 가운데로 둘레의 물 칸까지 와서 대원을 뭍에 올린다
  a.label = '물가로 돌아가는 중';
  const mv = k.moveTo(sim, s, a, t.tx, t.ty, BOAT.dock);
  c.x = a.x; c.y = a.y;      // 보트 안에 누워 있다
  if (mv === 'arrived') {
    a.x = t.tx; a.y = t.ty; a.afloat = undefined; a.path = null; a.pathGoal = -1;
    landed(sim, s, I, a, t, c, 'boat', t.tx, t.ty);
    k.finish(sim, s, a, true);
    return;
  }
  if (mv === 'nopath') {
    // 진수 지점으로 돌아갈 물길이 없다(드묾): 가장 가까운 뭍을 다시 찾아 그쪽에 댄다. 그래도 없으면 놓치고 접는다
    const l = reachOf(s, a.x, a.y, 4, null);
    if (l !== null && (l.x !== t.tx || l.y !== t.ty)) { t.tx = l.x; t.ty = l.y; return; }
    dropInWater(sim, s, a);
    switchMethod(sim, s, I, a, t, 'tooFar', '보트를 댈 물가가 없음', false);
    k.finish(sim, s, a, false, 'nopath');
  }
}

// ───────────────────────── 문·통로 (§4.2·§4.2a) — 단계 2 ─────────────────────────
/** 그 방법이 시작할 때 작동을 확인하는 장비 (숨은 고장이 이때 드러난다 → broken). 장비로 치우기는 bestTool 이 스스로 확인한다 */
const BLOCK_KIT: Partial<Record<MethodId, KitId>> = { hydraulic: 'spreader' };
/**
 * 문·잔해를 깎는 속도 (§4.2 — staminaF 는 부르는 쪽이 곱한다). R1 의 식에서 toolFor 자리에 **고른 방법의 장비 값**을 넣는다:
 *   문(force)  0.6 + 0.6 × 구조 + 0.6 × 장비 값 + 0.3 × 치안 — 발로 차기 맨손 0.12 · 할리건 · 충격기(+0.3 내리치는 힘) · 유압 개방기(×1.6)
 *   잔해(clear) 0.5 + 0.8 × 구조 + 0.5 × 장비 값 — 손으로 치우기 맨손 0.12 · 장비로 치우기는 R1 의 toolUse 그대로(bestTool — 숨은 고장이 드러난다)
 * 방법이 없으면(고르기 전) R1 의 식 그대로. 폭파 진입은 깎지 않는다(runCharge — 문의 hp 와 상관없이 6.5초 + 물러서는 걸음).
 * I 는 bestTool 이 숨은 고장을 기록할 사건 (본문의 서명에 더한 인자)
 */
export function blockerRate(sim: Sim, _s: Scene, a: FieldAgent, tk: Task, I: Incident): number {
  const r = sim.responders[a.rid], rs = r.skills.rescue;
  const force = (tool: number): number => 0.6 + 0.6 * rs + 0.6 * tool + 0.3 * r.skills.law;
  const clear = (tool: number): number => 0.5 + 0.8 * rs + 0.5 * tool;
  switch (tk.method) {
    case 'kick': return force(BARE_HANDS);
    case 'irons': return force(kitTool(sim, 'irons', 'force'));
    case 'ram': return force(kitTool(sim, 'breachKit', 'force')) + 0.3;
    case 'hydraulic': return force(kitTool(sim, 'spreader', 'force')) * 1.6;
    case 'handClear': return clear(BARE_HANDS);
    case 'toolClear': return clear(bestTool(sim, a.rid, 'clear', I));
    default: return tk.kind === 'force' ? force(bestTool(sim, a.rid, 'force', I)) : clear(bestTool(sim, a.rid, 'clear', I));
  }
}
/** 문 방법의 첫 틱: 장비가 작동하는지 본다(유압 개방기). 고장이 드러나면 broken 으로 바꾸고 true (부른 쪽은 그 틱에 끝낸다) */
export function blockerKitFails(sim: Sim, s: Scene, I: Incident, a: FieldAgent, tk: Task): boolean {
  if (tk.phase !== 0 || tk.method === undefined || tk.method === 'charge') return false;
  tk.phase = 1;
  const kid = BLOCK_KIT[tk.method];
  if (kid === undefined || kitWorks(sim, a.rid, kid, I)) return false;
  switchMethod(sim, s, I, a, tk, 'broken', `${josa(METHOD[tk.method].name, '이/가')} 장비 고장으로 막힘`);
  return true;
}
/** 문이 열리는 소리 (충격기·폭파): 13칸 안의 무력화되지 않은 용의자가 문 쪽을 돌아보고 5초 경계한다 — 동시 진입(breach)의 그 줄과 같은 코드·같은 반경 */
export function doorNoise(sim: Sim, s: Scene, x: number, y: number): void {
  for (const h of s.hostiles) if ((h.state === 'hold' || h.state === 'fight') && sim.t >= h.stunUntil && dist(h.x, h.y, x, y) <= 13 && sim.t >= h.alertUntil) { h.facing = Math.atan2(y - h.y, x - h.x); h.alertUntil = sim.t + 5; }
}

/** 폭파 진입의 수치 (§4.2a): 설치 5초 · 3-2-1 1.5초 · 반경이 비기를 기다리는 한도 10초 · 폭발 반경 1.5칸·가운데 피해 18 · 카운트 전에 비어 있어야 하는 반경 2.5칸 · 물러설 자리 3~4칸 */
export const CHARGE = { set: 5, count: 1.5, wait: 10, radius: 1.5, dmg: 18, clear: 2.5, back0: 3, back1: 4.5 };
/** 건물 안을 걸어서(진실 — 문·잔해·불 칸은 지나지 못한다) 닿는 칸인가 */
const walkTile = (s: Scene, i: number): boolean => staticPass(s.tiles[i]) && s.tiles[i] !== T.WATER && s.propAt[i] < 0 && s.fire[i] <= 0.5;
/**
 * 폭파 진입에서 물러설 자리 (§4.2a): 대원이 선 쪽(문의 바깥쪽)에서 걸어서 닿는 바닥 칸 가운데 문에서 3~4칸이고 문을 정면으로 마주 보지 않는 칸
 * (문 칸에서 그은 통로의 축 위가 아닌 칸), 대원에게 가장 가까운 것(걸음 수, 같으면 먼저 닿은 칸). 없으면 문에서 3칸 넘는 아무 바닥 칸, 그것도 없으면 null.
 * 대원의 칸에서 문을 지나지 않는 걸음(최대 12걸음)으로 닿는 칸만 본다 — 실행부라 진실의 칸·소품·불을 읽는다
 */
export function stackSpot(s: Scene, door: number, a: FieldAgent): { x: number; y: number } | null {
  const w = s.w, n = s.w * s.h, dx = door % w, dy = (door / w) | 0;
  const wallX = (dx > 0 && !staticPass(s.tiles[door - 1])) || (dx < w - 1 && !staticPass(s.tiles[door + 1]));      // 좌우가 벽이면 가로 벽의 문 — 통로의 축은 세로(x = 문 x)
  const start = tileOf(s, a.x, a.y);
  // 다른 대원이 이미 물러설 자리로 정한 칸은 비켜 고른다 (폭파하는 대원과 기다리는 진입조가 한 칸에 겹치지 않게 — 임무의 tx·ty, 자리를 정한 표시 range 1)
  const taken = new Set<number>();
  for (const b of s.agents) {
    if (b === a || b.status !== 'active' || b.task === null) continue;
    const bt = b.task.sub !== null && b.task.sub.method === 'charge' ? b.task.sub : b.task;
    if (bt.range === 1 && (bt.method === 'charge' || bt.entryDoor !== undefined)) taken.add(Math.round(bt.ty) * w + Math.round(bt.tx));
  }
  const steps = new Map<number, number>([[start, 0]]);
  const q = [start];
  let best = -1, bs = Infinity, any = -1, as = Infinity;
  for (let h = 0; h < q.length; h++) {
    const i = q[h], st = steps.get(i)!;
    const x = i % w, y = (i / w) | 0, d = Math.hypot(x - dx, y - dy);
    if (walkTile(s, i) && !taken.has(i)) {
      const onAxis = wallX ? x === dx : y === dy;
      if (d >= CHARGE.back0 && d <= CHARGE.back1 && !onAxis && st < bs) { bs = st; best = i; }
      if (d > CHARGE.back0 && st < as) { as = st; any = i; }
    }
    if (st >= 12) continue;
    const nb = [x > 0 ? i - 1 : -1, x < w - 1 ? i + 1 : -1, i - w, i + w];
    for (const j of nb) if (j >= 0 && j < n && j !== door && !steps.has(j) && walkTile(s, j)) { steps.set(j, st + 1); q.push(j); }
  }
  const pick = best >= 0 ? best : any;
  return pick < 0 ? null : { x: pick % w, y: (pick / w) | 0 };
}
/** 폭파 반경(카운트 전에 비어 있어야 하는 2.5칸) 안에 이 대원 말고 사람이 있는가 — 동료의 겉(현장에 있는 대원, 쓰러진 대원 포함 — 다친다) */
function radiusBusy(sim: Sim, s: Scene, a: FieldAgent, x: number, y: number): boolean {
  for (const b of s.agents) if (b !== a && b.status !== 'left' && !sim.responders[b.rid].dead && dist(b.x, b.y, x, y) <= CHARGE.clear) return true;
  return false;
}
/**
 * 폭파 진입의 실행 (§4.2a) — executor.workOnBlocker 가 부른다(본 임무와 이동 중 하위 작업 모두). 돌려주는 값 = 문·잔해가 열렸다.
 *   phase 0  설치 5초 (하위 작업이 멈춘 문 곁 칸에서, 제자리)
 *   phase 1  물러설 자리(stackSpot — 처음 한 번 정해 tk.tx, tk.ty)로. 자리가 없거나 갈 길이 없으면 조건 상실(tooFar)
 *   phase 2  반경 2.5칸 안에 다른 대원이 없을 때까지 기다린다 (10초 넘게 비지 않으면 조건 상실 team → 다음 방법)
 *   phase 3  3-2-1 (1.5초 — 그림만, 기록 없음). 그 사이 누가 들어오면 phase 2 로 → 폭발하는 틱에 연다
 * 난수를 쓰지 않는다 (불발·위력의 흔들림 없음 — 같은 상황 = 같은 결과). 장약은 폭발할 때만 준다. 이동은 한 틱에 한 번(phase 1 의 moveTo)
 */
export function runCharge(sim: Sim, s: Scene, I: Incident, a: FieldAgent, tk: Task, tile: number, k: ExecKit): boolean {
  const dx = tile % s.w, dy = (tile / s.w) | 0, dt = sim.dt;
  if (tk.phase === 0) {
    a.label = '장약 설치'; a.fx = dx - a.x; a.fy = dy - a.y;
    tk.progress += dt; a.ring = tk.progress / CHARGE.set;
    if (tk.progress + 1e-9 >= CHARGE.set) { tk.phase = 1; tk.progress = 0; tk.range = 0; }
    return false;
  }
  if (tk.phase === 1) {
    if (!tk.range) {
      const sp = stackSpot(s, tile, a);
      if (sp === null) { switchMethod(sim, s, I, a, tk, 'tooFar', '물러설 자리가 없음'); return false; }
      tk.tx = sp.x; tk.ty = sp.y; tk.range = 1;      // 자리를 정했다 (다시 고르지 않는다 — 한 임무에 이동 목표 하나)
    }
    a.label = '물러서는 중';
    const mv = k.moveTo(sim, s, a, tk.tx, tk.ty, 0.3);
    if (mv === 'nopath') { switchMethod(sim, s, I, a, tk, 'tooFar', '물러설 자리로 갈 길이 없음'); return false; }
    if (mv !== 'arrived') return false;
    tk.phase = 2; tk.progress = 0; tk.mbad = 0;      // 닿은 틱부터 센다 (이 틱에는 더 움직이지 않는다)
  }
  a.fx = dx - a.x; a.fy = dy - a.y;
  if (radiusBusy(sim, s, a, dx, dy)) {
    a.label = '폭파 대기 — 반경 안에 동료';
    if (tk.phase === 3) { tk.phase = 2; tk.progress = 0; }
    tk.mbad = (tk.mbad ?? 0) + dt;
    if (tk.mbad + 1e-9 >= CHARGE.wait) switchMethod(sim, s, I, a, tk, 'team', '동료가 폭파 반경 안');
    return false;
  }
  tk.phase = 3; tk.progress += dt;
  a.label = '폭파 3-2-1'; a.ring = tk.progress / CHARGE.count;
  if (tk.progress + 1e-9 < CHARGE.count) return false;
  detonateCharge(sim, s, I, a, tk, tile, k);
  return true;
}
/**
 * 폭발하는 틱 (§4.2a 의 "효과" 순서): 장약 1 → 문·잔해를 연다(unblock — 완료 기록·G5 진입 기록 how 'charge') → 문 자리에 반경 1.5·피해 18 의 폭발(hazards.blast —
 * 진실의 모든 사람·창·가구·X6 의 가스와 구조에 걸린다) → 문 뒤의 못 본 사람이 다쳤으면 ESCALATION 한 줄(폭파마다 한 줄) → 방법 기록 → 문이 열리는 소리.
 * I1 의 blast 신호는 보내지 않는다 — 지금의 hazards.blast 는 신호를 보내지 않는다(본문의 noSignal 인자가 아직 없다)
 */
function detonateCharge(sim: Sim, s: Scene, I: Incident, a: FieldAgent, tk: Task, tile: number, k: ExecKit): void {
  const dx = tile % s.w, dy = (tile / s.w) | 0, pid = s.propAt[tile];
  useKit(sim, a.rid, 'charge', 1);
  // 폭발 전에 문 둘레의 진실 사람(대원이 아닌 구조 대상·용의자)의 체력을 적어 두고, 폭발 뒤에 줄어든 사람을 센다 (blast 가 누구를 다치게 했는지 그대로)
  const near: { label: string; hp: () => number; was: number }[] = [];
  for (const c of s.casualties) if (!c.dead && c.where === 'scene' && dist(c.x, c.y, dx, dy) <= CHARGE.radius + 0.5) near.push({ label: `구조 대상 ${c.label}`, hp: () => c.health, was: c.health });
  for (const h of s.hostiles) if (!h.dead && h.state !== 'escaped' && (h.where === undefined || h.where === 'scene') && dist(h.x, h.y, dx, dy) <= CHARGE.radius + 0.5) near.push({ label: h.label, hp: () => h.health, was: h.health });
  const ev = k.unblock(sim, s, a, tile, 'charge');
  blast(sim, s, I, dx, dy, CHARGE.radius, CHARGE.dmg, ev, 'blast', true);      // (R3 5단계) 계획된 폭파 — 진입조에 동요를 걸지 않는다
  const hurt = near.filter((q) => q.hp() < q.was - 1e-9).map((q) => q.label);
  if (hurt.length) {
    const who = hurt.join('·');
    raiseProblem(sim, I, 'ESCALATION', `폭파 진입으로 ${who} 부상`, { role: 'SYSTEM', actor: '현장', imp: 2, truth: true, causes: [ev], text: `문 뒤에 있던 ${josa(who, '이/가')} 폭파에 휘말려 다쳤습니다!` }, false);
  }
  recordMethod(sim, I, a, tk, 'charge', tk.mwhy ?? 'usual', true, ev, { cas: -1, prop: pid, hostile: -1, region: -1, tile });
  doorNoise(sim, s, dx, dy);
  sim.responders[a.rid].xpGained += 0.003;
}

// ───────────────────────── 구출 (§4.3) — 단계 3 ─────────────────────────
/** 준비 시간(초): 문 벌리기 3 · 지붕 절단 8 · 에어백 5 · 지지대 8 · 줄 내리기 4 (그동안 구출 작업량은 줄지 않는다) */
export const EXTRICATE_PREP: Partial<Record<MethodId, number>> = { spread: 3, roof: 8, airbag: 5, shore: 8, haul: 4 };
/** 준비할 때 작동을 확인하는 장비 (숨은 고장이 이때 드러난다 → broken) */
const PREP_KIT: Partial<Record<MethodId, KitId>> = { spread: 'spreader', roof: 'spreader', airbag: 'airbag' };
/** 준비 중의 머리 위 글자 */
const PREP_LABEL: Partial<Record<MethodId, string>> = { spread: '유압 전개 준비', roof: '지붕 절단 준비', airbag: '에어백 설치', shore: '지지대 설치', haul: '줄 내리는 중' };
/**
 * 구출 속도의 k 와 그 방법의 장비 값 (§4.3 — 속도 = 구조 × k × staminaF × 연기 배율은 부르는 쪽). tool 은 H1 의 "구출 중 잔해" 확률(1.2 − tool)에 넘긴다.
 *   수동 0.35 + 0.65 × 맨손 · 손 공구 0.35 + 0.65 × 가진 가장 좋은 구출 도구(R1 의 식 그대로 — bestTool) · 지지대도 같다 · 문 벌리기 0.35 + 0.65 × 유압 구조기 · 지붕 절단 1.5 · 에어백 1.6 · 줄로 끌어올리기 1.2 ·
 *   손으로 파기 0.5 · 급박 구출 1.8 × (0.35 + 0.65 × 실제로 쓰는 가장 좋은 도구 — bestTool) · 방법이 없으면 R1 의 식 그대로
 */
export function extricateRate(sim: Sim, a: FieldAgent, t: Task, I: Incident): { k: number; tool: number } {
  const r1 = (tool: number): { k: number; tool: number } => ({ k: 0.35 + 0.65 * tool, tool });
  switch (t.method) {
    case 'manual': return r1(BARE_HANDS);
    case 'basic': case 'shore': return r1(bestTool(sim, a.rid, 'extricate', I));      // R1 의 식 그대로 (실제로 쓰는 가장 좋은 도구 — 숨은 고장은 여기서 드러난다). 지지대는 세운 뒤 손 공구와 같다
    case 'spread': return r1(kitTool(sim, 'spreader', 'extricate'));
    case 'roof': return { k: 1.5, tool: kitTool(sim, 'spreader', 'extricate') };
    case 'airbag': return { k: 1.6, tool: 1 };
    case 'haul': return { k: 1.2, tool: kitTool(sim, 'rope', 'water') };
    case 'descend': return { k: 0.7, tool: kitTool(sim, 'rope', 'water') };      // (N8 단계 8) 구덩이에 내려가 의식 없는 사람을 묶어 올린다 — 줄로 끌어올리기보다 느리다 (높은 자리의 하강은 executor 의 높은 자리 갈래가 따로 센다)
    case 'tunnel': return { k: 0.5, tool: BARE_HANDS };
    case 'rapid': { const tool = bestTool(sim, a.rid, 'extricate', I); return { k: 1.8 * (0.35 + 0.65 * tool), tool }; }
    default: return r1(bestTool(sim, a.rid, 'extricate', I));
  }
}
/**
 * 구출 방법의 준비 (대상 곁에 닿은 뒤 — phase 0). 돌려주는 값 = 아직 준비 중이다(부른 쪽은 그 틱에 끝낸다).
 * 준비를 시작할 때 장비를 확인하고(유압 구조기·에어백 — 숨은 고장이면 다른 방법으로), 지지대는 다 세운 순간 그 균열을 보강한다
 * (지금 case 'mitigate' 의 균열 완료와 같은 처리 — p.mitigated · 균열 사실 · 고정 층 · 같은 완료 문구. X6 의 보강 규칙(c.shored)이 그대로 받는다)
 */
export function extricatePrep(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, c: Casualty): boolean {
  if (t.phase !== 0 || t.method === undefined) return false;
  const need = EXTRICATE_PREP[t.method];
  if (need === undefined) { t.phase = 1; return false; }
  const kid = PREP_KIT[t.method];
  if (t.progress === 0 && kid !== undefined && !kitWorks(sim, a.rid, kid, I)) { switchMethod(sim, s, I, a, t, 'broken', `${josa(METHOD[t.method].name, '이/가')} 장비 고장으로 막힘`); return true; }
  a.label = PREP_LABEL[t.method] ?? METHOD[t.method].label;
  a.fx = c.x - a.x; a.fy = c.y - a.y;
  t.progress += sim.dt; a.ring = t.progress / need;
  if (t.progress + 1e-9 < need) return true;
  t.phase = 1; t.progress = 0;
  if (t.method === 'shore') shoreUp(sim, s, I, a, c);
  return false;
}
/** 지지대: 대원의 믿음이 가리키는 그 균열(methods.shoreCrack)을 보강한다 — 이미 보강됐거나 없으면 아무것도 하지 않는다 */
function shoreUp(sim: Sim, s: Scene, I: Incident, a: FieldAgent, c: Casualty): void {
  const id = shoreCrack(s, a, a.beliefs.val<CasBelief>('cas', c.id) ?? null);
  if (id < 0 || id >= s.props.length) return;
  const p = s.props[id];
  if (p.kind !== 'unstable' || p.mitigated) return;
  const r = sim.responders[a.rid];
  p.mitigated = true;
  learnQuiet(sim, a, mkFact('haz', p.id, { kind: 'leak', active: false, x: p.x, y: p.y, sub: 'crack' }, r.name, sim.t, 1, true, '균열부 보강 완료'));
  emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 2, text: '균열부에 지지대를 세웠습니다. 추가 붕괴 위험을 줄였습니다.' });
  s.staticVersion++;
}
/** 손으로 파기의 붕락 확률(초당): 믿음 속 4칸 안에 살아 있는 균열이 있을 때 · 피해: 대상 8 · 대원 6 (잔해 깔림) */
export const TUNNEL = { p: 0.006, cas: 8, resp: 6 };
/**
 * 손으로 파기 중 잔해가 다시 흘러내림 (§4.3 tunnel): 그 대원의 믿음에 대상 4칸 안의 살아 있는 균열이 있으면 mrng.chance(0.006 × dt) — 대상 피해 8, 대원 피해 6(H1, 원인 crush), 기록 한 줄.
 * 판정 뒤에는 일어나지 않는다
 */
export function tunnelSlide(sim: Sim, s: Scene, I: Incident, a: FieldAgent, c: Casualty): void {
  if (I.phase === 'closed') return;
  const cb = a.beliefs.val<CasBelief>('cas', c.id) ?? null;
  if (cb === null) return;
  let near = false;
  for (const f of a.beliefs.list('haz')) { const v = f.value as { kind: string; active: boolean; x: number; y: number; sub?: string }; if (v.kind === 'leak' && v.active && v.sub === 'crack' && Math.hypot(v.x - cb.x, v.y - cb.y) <= 4) { near = true; break; } }
  if (!near || !mrng(sim, s, a).chance(TUNNEL.p * sim.dt)) return;
  const r = sim.responders[a.rid];
  const ev = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 2, text: `파내던 잔해가 다시 흘러내렸습니다 — 구조 대상 ${josa(c.label, '과/와')} ${josa(r.name, '이/가')} 다쳤습니다.` });
  hurtCas(sim, s, I, c, TUNNEL.cas, 'crush', { ev });
  hurtResponder(sim, s, I, a, TUNNEL.resp, 'crush', { ev });
}
/** 급박 구출의 대상 피해 (척추 보호 없이 끌어냄 — H1 원인 blunt) */
export const RAPID_HURT = 10;
/** 구출을 마친 순간의 방법별 완료 문구 (평소 방법은 지금의 문구 그대로) */
export function extricateDoneText(c: Casualty, m: MethodId | undefined): string {
  if (m === undefined || METHOD[m].plain) return `구조 대상 ${c.label} 구출 완료. 이송이 필요합니다.`;
  return `구조 대상 ${c.label}, ${METHOD[m].noun} 구출 완료. 이송이 필요합니다.`;
}

// ───────────────────────── 수색·탐지 (§4.4) — 단계 3 ─────────────────────────
/** 경유점마다 멈추는 시간(초): 지금 0.5 · 청음 3 · 확성기 2 · 열화상 1.5 (멈춘 동안 perceive 가 searchMul 을 곱한다) */
export const SEARCH_STOP: Partial<Record<MethodId, number>> = { listen: 3, hail: 2, thermal: 1.5, feel: 0.8 };      // (R3 3단계) 벽 더듬기 — 경유점마다 0.8초
/** 경유점에서 처음 멈출 때 작동을 확인하는 장비 (야외에는 연기가 없어 R1 의 자리에서는 열화상 카메라의 고장이 드러나지 않는다) */
const SEARCH_KIT: Partial<Record<MethodId, KitId>> = { listen: 'searchKit', thermal: 'tic' };
/**
 * 수색 경유점에 닿았을 때: 멈출 시간을 돌려준다. 처음 멈출 때 탐지 장비를 확인해 고장이 드러나면 broken 으로 바꾸고(다음 방법 — 호출·줄 수색) 지금의 0.5초
 */
export function searchStop(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task): number {
  const m = t.method;
  if (m === undefined) return 0.5;
  const kid = SEARCH_KIT[m];
  if (kid !== undefined && t.ptI === 0 && !kitWorks(sim, a.rid, kid, I)) { switchMethod(sim, s, I, a, t, 'broken', `${josa(METHOD[m].name, '이/가')} 장비 고장으로 막힘`); return 0.5; }
  return t.method !== undefined ? SEARCH_STOP[t.method] ?? 0.5 : 0.5;
}

// ───────────────────────── 화재 진압 (§4.5) — 단계 4 ─────────────────────────
/**
 * 화재 진압 방법의 수치: 소화기 한 개 = 12초 분사(1.8칸 · 초당 0.10 — applyWater 를 직접, 펌프·물을 쓰지 않는다) ·
 * 외부 방수 5.5칸(X6 의 EXT_RANGE — 효과 ×0.7 · 물 ×1.4) · 고가 사다리 방수 7.5칸(효과 ×1.3 · 물 ×2) · 배연 설치 6초 · 송풍기 120초(power 1) · 대상 칸을 다시 고르는 1.6초
 */
export const SUPPRESS = { extNeed: 12, extRange: 1.8, extAmount: 0.10, aerialRange: AERIAL_RANGE, ventSet: 6, ventFor: 120, ventNear: 1.5, retarget: 1.6 };
/** 방법별 효과 배율·물 배율 (executor.spray 의 eff·wmul — X6 가 더한 인자) */
const SPRAY_MUL: Partial<Record<MethodId, readonly [number, number]>> = { defensive: [0.7, 1.4], aerial: [1.3, 2] };
/** 그 구역에 아직 불이 있는가 (진실 — 실행부) */
function regionLit(s: Scene, region: number): boolean {
  const reg = s.regions[region];
  if (!reg) return false;
  const tl = reg.tiles;
  for (let q = 0; q < tl.length; q++) if (s.fire[tl[q]] > 0.05) return true;
  return false;
}
/** 대원의 시야(+2칸) 안에서 그 구역의 가장 가까운 불 칸 (executor.nearestFireTile 과 같은 식). 없으면 -1 */
function fireNear(sim: Sim, s: Scene, a: FieldAgent, region: number): number {
  const v = visionOf(sim, s, a) + 2, tl = s.regions[region].tiles;
  let best = -1, bd = 1e9;
  for (let q = 0; q < tl.length; q++) {
    const i = tl[q];
    if (s.fire[i] <= 0.05) continue;
    const d = dist(a.x, a.y, i % s.w, (i / s.w) | 0);
    if (d <= v && d < bd) { bd = d; best = i; }
  }
  return best;
}
/** 서 있는 자리(spot)에서 그 구역의 불 칸 가운데 range 안·시야선이 닿는 가장 가까운 칸 (X6 의 exteriorFire 와 같은 식 — 창·열린 문 너머). 없으면 -1 */
function fireFrom(s: Scene, region: number, spot: number, range: number): number {
  const w = s.w, sx = spot % w, sy = (spot / w) | 0, tl = s.regions[region].tiles;
  let best = -1, bd = range + 1e-6;
  for (let q = 0; q < tl.length; q++) {
    const i = tl[q];
    if (s.fire[i] <= 0.05) continue;
    const d = dist(sx, sy, i % w, (i / w) | 0);
    if (d < bd && los(s, sx, sy, i % w, (i / w) | 0)) { bd = d; best = i; }
  }
  return best;
}
/** 그 구역의 진압 확인 (지금의 내부 공격과 같은 보고 — 강제 보고) + 방법 기록(ok) + 임무 끝 */
function confirmOut(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, k: ExecKit, outside: boolean): void {
  const r = sim.responders[a.rid], reg = s.regions[t.region];
  learn(sim, a, mkFact('fire', reg.id, 0, r.name, sim.t, 1, true, `${reg.name} 화재 진압 확인${outside ? ' (외부)' : ''}`), true, true);
  r.xpGained += 0.003;
  if (t.method !== undefined) recordMethod(sim, I, a, t, t.method, t.mwhy ?? 'usual', true, -1, { cas: -1, prop: -1, hostile: -1, region: t.region, tile: -1 });
  k.finish(sim, s, a, true);
}
/**
 * 화재 진압의 방법 갈래 (executor 의 case 'suppress' 가 X6 의 외부 방어 다음에 부른다 — X6 가 정한 현장 모드가 먼저다). 돌려주는 값 = 이 틱은 여기서 끝.
 *   defensive · aerial  밖의 자리(외부 방수: X6 의 exteriorSpots 5.5칸 · 고가 방수: 대기 지점 쪽 7.5칸)에서 창·문 너머 시야선이 닿는 불 칸에 쏜다 — 효과·물 배율, s.rng 를 쓰지 않는다(jitter = false).
 *                       자리가 없거나 갈 길이 없으면 조건 상실(tooFar) → 다음 방법(대개 내부 공격)
 *   ventilate           대원에게 가장 가까운 출입구로 가서 송풍기 작동을 확인(kitWorks — 숨은 고장 → broken)하고 6초 설치 → s.fan(120초) · 방법 기록 →
 *                       같은 대원은 내부 공격으로 예정된 전환(실패가 아니다 — 접은 줄·기억을 남기지 않는다. 내부 공격을 고를 수 없으면 외부 방수, 그것도 아니면 손을 뗀다)
 * 그 밖(내부 공격·방법 없음)은 false — 지금 코드
 */
export function runSuppress(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, k: ExecKit): boolean {
  const m = t.method;
  if (m === 'defensive' || m === 'aerial') { runOutside(sim, s, I, a, t, k, m); return true; }
  if (m === 'ventilate') { runVentilate(sim, s, I, a, t, k); return true; }
  return false;
}
function runOutside(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, k: ExecKit, m: 'defensive' | 'aerial'): void {
  if (!s.regions[t.region]) { k.finish(sim, s, a, false, 'nopath'); return; }
  if (!regionLit(s, t.region)) { confirmOut(sim, s, I, a, t, k, true); return; }
  const range = m === 'aerial' ? SUPPRESS.aerialRange : EXT_RANGE;
  // 1초마다: 고른 까닭(사람이 없다고 확인된 큰 불 · 자기 몸 · 지휘관의 외부 방어 · 창 너머의 센 불)이 3초 넘게 사라졌으면 — 밖에서 불길을 꺾었다 —
  // 안으로 들어가 마무리한다 (예정된 전환: 실패가 아니라 접은 줄·기억을 남기지 않는다. 내부 공격을 고를 수 없으면 밖에서 잇는다)
  if (sim.tick % 5 === 0) {
    const tg = { cas: -1, prop: -1, hostile: -1, region: t.region, tile: -1 }, sense = senseOf(s, a);
    if (methodStillFits(sim, s, a, 'suppress', tg, t, m, sense)) t.mbad = 0;
    else if ((t.mbad = (t.mbad ?? 0) + 1) >= 3 && methodStillFits(sim, s, a, 'suppress', tg, t, 'interior', sense, selfDc(sim, s, a, t))) {      // (R3) 교본이 실내 진압을 뺐으면(짝·대기조·공기) 밖에서 잇는다
      const r = sim.responders[a.rid];
      emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `${s.regions[t.region].name} 불길이 잡혔습니다. 안으로 들어가 마무리하겠습니다.` });
      t.method = 'interior'; t.mwhy = 'usual'; t.missing = undefined; t.mt0 = sim.t; t.mtry = 0; t.mbad = 0;
      t.phase = 0; t.progress = 0; t.range = 0; t.tile = -1; t.marr = true; a.path = null;
      return;
    }
  }
  // 자리: 처음 한 번, 그 자리에서 불이 더 보이지 않게 되면 다시 (X6 의 외부 방수와 같은 칸 — phase 1 · t.tx, t.ty · t.tile · t.progress = 대상 칸을 다시 고를 시각)
  let spot = t.phase === 1 ? Math.round(t.ty) * s.w + Math.round(t.tx) : -1;
  if (spot < 0) {
    const cands = m === 'aerial' ? aerialSpots(s, t.region) : exteriorSpots(s, t.region, false);
    const order: number[] = [];
    for (let q = 0; q < cands.length; q++) order.push(cands[q]);
    if (m === 'defensive') order.sort((p, q) => dist(a.x, a.y, p % s.w, (p / s.w) | 0) - dist(a.x, a.y, q % s.w, (q / s.w) | 0) || p - q);      // 외부 방수: 가까운 자리 (고가 방수는 대기 지점 쪽 순서 그대로)
    for (let q = 0; q < order.length; q++) { const f = fireFrom(s, t.region, order[q], range); if (f >= 0) { spot = order[q]; t.tile = f; break; } }
    if (spot < 0) {      // 밖에서 불길이 보이는 자리가 없다 — 그 구역에 대해 이 방법을 1분 동안 다시 고르지 않는다(조건 상실의 15초로는 방수 작업을 다시 받을 때마다 같은 걸음을 되풀이한다)
      const key = targetKey('suppress', { cas: -1, prop: -1, hostile: -1, region: t.region, tile: -1 });
      switchMethod(sim, s, I, a, t, 'tooFar', `${METHOD[m].name} 자리 없음`, true, { say: '밖에서 불길이 보이는 자리가 없습니다.' });
      rememberFail(sim, a, key, m, 'failed');
      return;
    }
    t.phase = 1; t.tx = spot % s.w; t.ty = (spot / s.w) | 0; t.progress = sim.t + SUPPRESS.retarget; a.path = null;
  }
  a.label = METHOD[m].label;
  const mv = k.moveTo(sim, s, a, t.tx, t.ty, 0.6);
  if (mv === 'nopath') { switchMethod(sim, s, I, a, t, 'tooFar', `${METHOD[m].name} 자리로 갈 길이 없음`, true, { say: '방수 자리로 갈 길이 없습니다.' }); return; }
  if (mv !== 'arrived') return;
  if (t.tile < 0 || s.fire[t.tile] <= 0.05 || sim.t > t.progress) {
    t.tile = fireFrom(s, t.region, spot, range); t.progress = sim.t + SUPPRESS.retarget;
    if (t.tile < 0) { t.phase = 0; return; }      // 이 자리에서는 더 보이지 않는다 — 다음 틱에 다른 자리를 찾는다
  }
  const tx = t.tile % s.w, ty = (t.tile / s.w) | 0, mul = SPRAY_MUL[m]!;
  a.fx = tx - a.x; a.fy = ty - a.y; a.ring = 1 - s.fire[t.tile];
  if (!k.spray(sim, s, a, tx, ty, mul[0], mul[1], false)) k.finish(sim, s, a, false, 'equip');
}
function runVentilate(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, k: ExecKit): void {
  const r = sim.responders[a.rid];
  if (t.phase === 0) {
    const f = s.fan;
    if (f && f.until > sim.t && f.rid !== a.rid) { switchMethod(sim, s, I, a, t, 'team', '다른 대원이 송풍기를 설치함', true, { say: '송풍기가 이미 돌고 있습니다.' }); return; }
    if (t.range !== 1) {      // 출입구는 처음 한 번 정한다 (대원에게 가장 가까운 것 — 정했다는 표시는 1b 와 같은 t.range)
      let bi = -1, bd = Infinity;
      for (let q = 0; q < s.exits.length; q++) { const e = s.exits[q], d = dist(a.x, a.y, e.x, e.y); if (d < bd) { bd = d; bi = q; } }
      if (bi < 0) { switchMethod(sim, s, I, a, t, 'tooFar', '배연할 출입구가 없음', true, { say: '송풍기를 놓을 출입구가 없습니다.' }); return; }
      t.tx = s.exits[bi].x; t.ty = s.exits[bi].y; t.range = 1; a.path = null;
    }
    a.label = '송풍기 설치하러';
    const mv = k.moveTo(sim, s, a, t.tx, t.ty, SUPPRESS.ventNear);
    if (mv === 'nopath') { switchMethod(sim, s, I, a, t, 'tooFar', '출입구로 갈 길이 없음', true, { say: '출입구로 갈 길이 없습니다.' }); return; }
    if (mv !== 'arrived') return;
    if (!kitWorks(sim, a.rid, 'fan', I)) { switchMethod(sim, s, I, a, t, 'broken', '송풍기가 장비 고장으로 막힘'); return; }      // 숨은 고장이 이때 드러난다 (EQUIP_FAIL 은 kitWorks 가)
    t.phase = 5; t.progress = 0;
  }
  // 설치 (phase 5)
  a.label = METHOD.ventilate.label;
  t.progress += sim.dt; a.ring = t.progress / SUPPRESS.ventSet;
  k.drain(sim, a, 0.4);
  if (t.progress + 1e-9 < SUPPRESS.ventSet) return;
  s.fan = { x: t.tx, y: t.ty, until: sim.t + SUPPRESS.ventFor, rid: a.rid, power: 1 };
  const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: '송풍기 가동 — 연기를 빼냅니다. 진입합니다.' });
  recordMethod(sim, I, a, t, 'ventilate', t.mwhy ?? 'usual', true, ev, { cas: -1, prop: -1, hostile: -1, region: t.region, tile: -1 });
  // 예정된 전환: 내부 공격 (고를 수 없으면 외부 방수 — R3 의 교본이 실내 진압을 빼는 경우 등 — 그것도 아니면 손을 뗀다)
  const tg = { cas: -1, prop: -1, hostile: -1, region: t.region, tile: -1 }, sense = senseOf(s, a);
  const dcv = selfDc(sim, s, a, t);      // (R3 3단계) 교본이 실내 진압을 뺐으면(F03b·F04b·F05b) 내부 공격으로 바꾸지 않는다 — 외부 방수, 그것도 아니면 손을 뗀다 (§3.7 끝)
  const nx: MethodId | null = methodStillFits(sim, s, a, 'suppress', tg, t, 'interior', sense, dcv) ? 'interior' : methodStillFits(sim, s, a, 'suppress', tg, t, 'defensive', sense, dcv) ? 'defensive' : null;
  if (nx === null) { k.finish(sim, s, a, false, 'preempt'); return; }
  t.method = nx; t.mwhy = nx === 'defensive' ? 'danger' : 'usual'; t.missing = undefined; t.mt0 = sim.t; t.mtry = 0; t.mbad = 0;
  t.phase = 0; t.progress = 0; t.range = 0; t.tile = -1; a.path = null;
}
/**
 * (검토) 소화기 한 개에서 이미 뿜은 시간(초) — 임무가 바뀌어도 이어서 센다(한 개 = 12초, §4.5). 장비 항목마다 (KitItem 의 모양을 바꾸지 않으려 WeakMap).
 * 임무의 진행도로만 세면 꺼졌다 되살아나는 작은 불에 짧은 진압을 거듭 받는 대원의 소화기가 끝내 비지 않았다
 */
const EXT_USED = new WeakMap<KitItem, number>();
/** 그 대원이 지금 뿜는 소화기 (남은 것 — 알려진 고장 제외). 수량을 세지 않는 손으로 만든 명부면 undefined */
function extItem(sim: Sim, rid: number): KitItem | undefined {
  const kit = sim.responders[rid].kit;
  if (kit) for (const it of kit) if (it.id === 'extinguisher' && !it.faultKnown && it.uses !== undefined && it.uses > 0) return it;
  return undefined;
}
/**
 * 소화기 (§4.5 extinguisher — executor 의 case 'suppress' 가 펌프·물 검사보다 먼저 부른다): 시야선이 닿는 1.8칸 안으로 가서 applyWater 를 직접(초당 0.10) — 그림은 흰 분말 줄기(흩뜨리지 않는다).
 * 12초 쓰면 하나를 다 쓴다(useKit — 뿜은 시간은 임무가 바뀌어도 그 소화기에 이어서 센다). 그 구역의 불이 꺼지면 진압 확인 · 방법 기록. 다 썼는데 불이 남았거나, 믿음 속 불이 커져(0.35 넘게) 3초가 지나면 조건 상실 → 다음 방법(없으면 손을 뗀다)
 */
export function runExtinguisher(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, k: ExecKit): void {
  const reg = s.regions[t.region];
  if (!reg) { k.finish(sim, s, a, false, 'nopath'); return; }
  if (!regionLit(s, t.region)) { confirmOut(sim, s, I, a, t, k, false); return; }
  const tg = { cas: -1, prop: -1, hostile: -1, region: t.region, tile: -1 };
  // 1초마다 조건 재확인: 불이 커졌다(믿음 0.35 넘음) — 3초 넘게 맞지 않으면 바꾼다
  if (sim.tick % 5 === 0) {
    if (methodStillFits(sim, s, a, 'suppress', tg, t, 'extinguisher', senseOf(s, a))) t.mbad = 0;
    else if ((t.mbad = (t.mbad ?? 0) + 1) >= 3) { if (!switchMethod(sim, s, I, a, t, 'tooFar', '불이 커져 소화기로 끌 수 없음', true, { say: '불길이 커졌습니다. 소화기로는 어렵습니다.' })) k.finish(sim, s, a, false, 'preempt'); return; }
  }
  if (t.tile < 0 || s.fire[t.tile] <= 0.05) t.tile = fireNear(sim, s, a, t.region);
  if (t.tile < 0) {      // 연기로 보이지 않는다 — 구역 가운데로 더듬어 간다 (내부 공격과 같다)
    const mv = k.moveTo(sim, s, a, Math.round(reg.cx), Math.round(reg.cy), 2.2);
    if (mv === 'nopath') { k.finish(sim, s, a, false, 'nopath'); return; }
    if (mv === 'arrived') { let bd = 1e9; for (const i of reg.tiles) if (s.fire[i] > 0.05) { const d = dist(a.x, a.y, i % s.w, (i / s.w) | 0); if (d < bd) { bd = d; t.tile = i; } } }
    return;
  }
  const tx = t.tile % s.w, ty = (t.tile / s.w) | 0;
  const mv = k.moveTo(sim, s, a, tx, ty, SUPPRESS.extRange, true);
  if (mv === 'nopath') { k.finish(sim, s, a, false, 'nopath'); return; }
  if (mv !== 'arrived') return;
  a.fx = tx - a.x; a.fy = ty - a.y; a.label = METHOD.extinguisher.label;
  applyWater(s, tx, ty, SUPPRESS.extAmount * sim.dt);
  const bottle = extItem(sim, a.rid);
  t.progress = (bottle !== undefined ? EXT_USED.get(bottle) ?? 0 : t.progress) + sim.dt;      // 이 소화기에서 뿜은 시간 (앞선 임무에서 뿜은 것까지)
  if (bottle !== undefined) EXT_USED.set(bottle, t.progress);
  a.ring = t.progress / SUPPRESS.extNeed;
  k.drain(sim, a, 0.4);
  if (sim.tick % 2 === 0) pushFx(sim, s, 'spray', a.x, a.y, tx, ty, undefined, '#f2f2ee', 0.3);      // 흰 분말 줄기 — 자리를 흩뜨리지 않는다(s.rng 를 쓰지 않는다)
  if (t.progress + 1e-9 < SUPPRESS.extNeed) return;
  useKit(sim, a.rid, 'extinguisher', 1);
  if (bottle !== undefined) EXT_USED.delete(bottle);
  t.progress = 0;
  if (!regionLit(s, t.region)) { confirmOut(sim, s, I, a, t, k, false); return; }
  if (!switchMethod(sim, s, I, a, t, 'tooFar', '소화기 소진', true, { say: '소화기를 다 썼습니다.' })) k.finish(sim, s, a, false, 'preempt');
}

// ───────────────────────── 무장 (§4.6) — 단계 5 ─────────────────────────
/** 무력화가 살아 있거나 막 풀렸으면(1초 안) 그 수단 (섬광탄 'bang' · 테이저 'taser' · 비살상탄 'beanbag' — 무력화한 코드가 h.stunHow 에 적는다), 아니면 undefined */
export function stunMethod(sim: Sim, h: Hostile): MethodId | undefined { return h.stunHow !== undefined && sim.t < h.stunUntil + 1 ? h.stunHow : undefined; }
/**
 * 검거 기록의 이름 (§4.6 표 — 기록 전용): 무력화 수단이 살아 있으면 그것, 아니면 검거한 대원이 방패수(방탄 방패)면 방패,
 * 아니면 자리의 이름 — 추격 검거 'chase' · 동시 진입·방 진입 뒤 'breach' · 덮치기 'tackle'
 */
export function arrestMethod(sim: Sim, a: FieldAgent, h: Hostile, site: 'chase' | 'breach' | 'tackle'): MethodId {
  const st = stunMethod(sim, h);
  if (st !== undefined) return st;
  if (kitCount(sim, a.rid, 'shield') > 0) return 'shield';
  return site;
}
/** 검거한 그 자리에서 방법 기록 한 줄 (대상 = 그 용의자). 고른 방법(비살상탄)이면 그 까닭, 기록 전용이면 'usual' */
export function recordArrest(sim: Sim, I: Incident, a: FieldAgent, t: Task, h: Hostile, site: 'chase' | 'breach' | 'tackle', ev: number): void {
  const m = arrestMethod(sim, a, h, site);
  recordMethod(sim, I, a, t, m, m === t.method ? t.mwhy ?? 'usual' : 'usual', true, ev, { cas: -1, prop: -1, hostile: h.id, region: -1, tile: -1 });
}
/** 비살상탄: 조준 1.5초 · 무력화 4초 · 사기 −0.3 · 타박상 8 */
export const BEANBAG = { aim: 1.5, stun: 4, morale: 0.3, dmg: 8 };
/** 결정적 저격: 조준 6초 · 피해 70(쓰러뜨린다) · 빗나간 탄이 곁의 인질에게 갈 확률 0.2 · 용의자에게서 이만큼은 떨어진 자리 */
export const SNIPER = { aim: 6, dmg: 70, collateral: 0.2, minD: 4 };
/** 조준을 시작한 시각 (임무마다 — 임무의 모양을 바꾸지 않으려 WeakMap) */
const AIM = new WeakMap<Task, number>();
const hosTg = (h: Hostile): MTarget => ({ cas: -1, prop: -1, hostile: h.id, region: -1, tile: -1 });
/** 빗나간 탄이 겨눈 점: 목표 옆 0.8칸 (틱의 홀짝으로 좌우 — 난수를 쓰지 않는다) */
function missAim(sim: Sim, a: FieldAgent, h: Hostile): { x: number; y: number } {
  const d = Math.hypot(h.x - a.x, h.y - a.y) || 1, side = sim.tick % 2 ? 0.8 : -0.8;
  return { x: h.x - ((h.y - a.y) / d) * side, y: h.y + ((h.x - a.x) / d) * side };
}
/** 1초마다 고른 방법을 지금도 쓸 수 있는가 — 3초 넘게 아니면 조건 상실로 바꾼다 (선택 임무: 다음 방법이 없으면 방법 없이 지금 분기로). 돌려주는 값 = 바꿨다 */
function armedLost(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, h: Hostile, m: MethodId, detail: string, say: string): boolean {
  if (sim.tick % 5 !== 0) return false;
  if (methodStillFits(sim, s, a, t.kind as WorkKind, hosTg(h), t, m, senseOf(s, a))) { t.mbad = 0; return false; }
  t.mbad = (t.mbad ?? 0) + 1;
  if (t.mbad < 3) return false;
  AIM.delete(t);
  switchMethod(sim, s, I, a, t, 'tooFar', detail, true, { say });
  return true;
}
/**
 * 비살상탄 (§4.6 beanbag — executor 의 case 'arrest' 테이저 다음 · case 'engage' ①-2 다음에서 부른다). 돌려주는 값 = 이 틱은 여기서 끝 (쏜 틱·조준·다가감).
 * 무력화된 상대는 지금의 제압 분기가 잡는다(false). 9칸·시야선 밖이면 다가가고, 닿으면 제자리에서 1.5초 조준한 뒤 한 발(useKit) —
 * 명중 clamp(0.5 + 0.3 × 법 집행, 0.2, 0.85)(mrng): 무력화 4초 · h.stunHow 'beanbag' · 사기 −0.3 · 타박상 8(H1). 탄은 damage.fireShot 의 선 그대로 G5 recShot.
 * 다 쓰면·조건이 3초 넘게 맞지 않으면·갈 길이 없으면 조건 상실(tooFar) → 선택 임무라 지금 분기로
 */
export function runBeanbag(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, h: Hostile, k: ExecKit): boolean {
  if (t.method !== 'beanbag') return false;
  if (sim.t < h.stunUntil) { AIM.delete(t); return false; }
  if (kitCount(sim, a.rid, 'beanbag') <= 0) { AIM.delete(t); switchMethod(sim, s, I, a, t, 'tooFar', '비살상탄 소진', true, { say: '비살상탄을 다 썼습니다.' }); return true; }
  if (armedLost(sim, s, I, a, t, h, 'beanbag', '비살상탄을 쏠 수 없는 상황', '비살상탄을 쏠 수 없습니다.')) return true;
  a.label = METHOD.beanbag.label;
  if (dist(a.x, a.y, h.x, h.y) > BEANBAG_RANGE || !los(s, a.x, a.y, h.x, h.y)) {
    AIM.delete(t);
    const mv = k.moveTo(sim, s, a, h.x, h.y, BEANBAG_RANGE - 0.5, true);
    if (mv === 'nopath') switchMethod(sim, s, I, a, t, 'tooFar', '비살상탄을 쏠 자리로 갈 길이 없음', true, { say: '비살상탄을 쏠 자리가 없습니다.' });
    return true;
  }
  a.fx = h.x - a.x; a.fy = h.y - a.y;
  const t0 = AIM.get(t);
  if (t0 === undefined) { AIM.set(t, sim.t); return true; }
  a.ring = (sim.t - t0) / BEANBAG.aim;
  if (sim.t - t0 + 1e-9 < BEANBAG.aim) return true;
  AIM.delete(t);
  const r = sim.responders[a.rid];
  useKit(sim, a.rid, 'beanbag', 1); t.mtry = (t.mtry ?? 0) + 1;
  const hit = mrng(sim, s, a).chance(clamp(0.5 + 0.3 * r.skills.law, 0.2, 0.85));
  const mp = missAim(sim, a, h);
  const end = hit ? fireShot(sim, s, a.x, a.y, h.x, h.y, 'body') : fireShot(sim, s, a.x, a.y, mp.x, mp.y, 'miss');
  recShot(sim, s, a, 'beanbag', h.x, h.y, hit, 1, h.id, null, end);
  const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 2, text: hit ? `비살상탄 명중. ${h.label} 무력화.` : '비살상탄 빗나감.' });
  h.shotAt = sim.t;
  if (hit) {
    h.stunUntil = sim.t + BEANBAG.stun; h.stunHow = 'beanbag'; h.morale -= BEANBAG.morale;
    hurtHostile(sim, s, I, h, BEANBAG.dmg, 'blunt', { by: a.rid, byKind: 'responder', ev });
  } else if (sim.t >= h.alertUntil) { h.alertUntil = sim.t + 5; h.facing = Math.atan2(a.y - h.y, a.x - h.x); }
  return true;
}
/** 저격 자리 (생김새·진실 — 실행부): 용의자 둘레 16칸 안의 걸을 수 있는 칸 가운데 시야선이 닿고 4칸 넘게 떨어진 칸, 대기 지점에 가까운 것. 없으면 -1 */
export function sniperSpot(s: Scene, h: Hostile): number {
  const w = s.w, hx = Math.round(h.x), hy = Math.round(h.y), R = SNIPER_RANGE;
  let best = -1, bd = Infinity;
  for (let y = Math.max(0, hy - R); y <= Math.min(s.h - 1, hy + R); y++) for (let x = Math.max(0, hx - R); x <= Math.min(w - 1, hx + R); x++) {
    const i = y * w + x;
    if (!staticPass(s.tiles[i]) || s.tiles[i] === T.WATER || s.tiles[i] === T.DOOR || s.propAt[i] >= 0 || s.fire[i] > 0.3) continue;
    const d = dist(x, y, hx, hy);
    if (d > R - 0.5 || d < SNIPER.minD || !los(s, x, y, hx, hy)) continue;
    const ds = dist(x, y, s.staging.x, s.staging.y);
    if (ds < bd) { bd = ds; best = i; }
  }
  return best;
}
/**
 * 결정적 저격 (§4.6 sniper — executor 의 case 'engage' ①-2 다음). 돌려주는 값 = 이 틱은 여기서 끝.
 * 처음 한 번 저격 자리를 정하고(sniperSpot — 대기 지점 쪽) 그리로 간다. 시야선·16칸이면 제자리에서 6초 조준한 뒤 한 발 —
 * 명중 clamp(0.55 + 0.4 × 법 집행 − (움직이면 0.2), 0.3, 0.95)(mrng): 피해 70(H1 — 한 번에 쓰러뜨린다) · 방법 기록. 빗나가면 mrng 0.2 로 곁의 인질이 다친다(ESCALATION — shootAt 과 같은 처리).
 * 자리가 없거나 갈 길이 없으면 조건 상실(tooFar) + 그 대상의 저격을 1분 기억(조준 → 실패를 되풀이하지 않게) → 선택 임무라 지금 분기(엄폐 사격·덮치기)로.
 * 자리에서 시야선이 세 번 끊기면 같은 처리
 */
export function runSniper(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, h: Hostile, k: ExecKit): boolean {
  if (t.method !== 'sniper') return false;
  if (sim.t < h.stunUntil) { AIM.delete(t); return false; }
  if (armedLost(sim, s, I, a, t, h, 'sniper', '저격 조건이 사라짐', '저격 조건이 아닙니다.')) return true;
  const key = targetKey(t.kind, hosTg(h));
  const giveUp = (detail: string, say: string): boolean => { AIM.delete(t); switchMethod(sim, s, I, a, t, 'tooFar', detail, true, { say }); rememberFail(sim, a, key, 'sniper', 'failed'); return true; };
  if (t.range !== 1) {
    const spot = sniperSpot(s, h);
    if (spot < 0) return giveUp('저격 자리가 없음', '저격 자리가 없습니다.');
    t.tx = spot % s.w; t.ty = (spot / s.w) | 0; t.range = 1; a.path = null;
  }
  a.label = METHOD.sniper.label;
  const mv = k.moveTo(sim, s, a, t.tx, t.ty, 0.6);
  if (mv === 'nopath') return giveUp('저격 자리로 갈 길이 없음', '저격 자리로 갈 길이 없습니다.');
  if (mv !== 'arrived') return true;
  if (dist(a.x, a.y, h.x, h.y) > SNIPER_RANGE || !los(s, a.x, a.y, h.x, h.y)) {
    AIM.delete(t); t.range = 0; t.mtry = (t.mtry ?? 0) + 1;      // 다른 자리를 찾는다 (세 번이면 접는다)
    if (t.mtry >= 3) return giveUp('저격 자리에서 표적이 보이지 않음', '표적이 보이지 않습니다.');
    return true;
  }
  a.fx = h.x - a.x; a.fy = h.y - a.y;
  if (!gunReady(sim, a, 'sniper')) { AIM.delete(t); a.label = '재장전'; return true; }      // (R3 §2.9) 재장전 중이면 조준을 멈춘다 (끝나면 처음부터 다시 조준한다). 탄이 다 떨어지면 조건 상실(armedLost)로 놓는다
  const t0 = AIM.get(t);
  if (t0 === undefined) { AIM.set(t, sim.t); return true; }
  a.ring = (sim.t - t0) / SNIPER.aim;
  if (sim.t - t0 + 1e-9 < SNIPER.aim) return true;
  AIM.delete(t);
  const r = sim.responders[a.rid], rng = mrng(sim, s, a);
  const moving = Math.abs(h.x - h.px) + Math.abs(h.y - h.py) > 0.05;
  const hit = rng.chance(clamp(0.55 + 0.4 * r.skills.law - (moving ? 0.2 : 0), 0.3, 0.95));
  fireRound(sim, a, 'sniper');      // (R3 §2.9) 판정 직후 한 발 — 탄창·재장전은 그 함수가 맡는다
  const hc = hit ? null : hostageNear(s, h);
  const struck = hc !== null && rng.chance(SNIPER.collateral) && I.phase !== 'closed' ? hc : null;
  const mp = missAim(sim, a, h);
  const end = hit ? fireShot(sim, s, a.x, a.y, h.x, h.y, 'body') : struck ? fireShot(sim, s, a.x, a.y, struck.x, struck.y, 'body') : fireShot(sim, s, a.x, a.y, mp.x, mp.y, 'miss');
  recShot(sim, s, a, 'sniper', h.x, h.y, hit, 1, h.id, struck, end);
  const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 3, text: hit ? `저격 — ${h.label} 명중, 제압.` : '저격 — 빗나감.' });
  h.shotAt = sim.t;
  if (struck) {
    const e2 = raiseProblem(sim, I, 'ESCALATION', '저격 중 인질 피격', { role: 'SYSTEM', actor: '현장', rid: r.id, imp: 3, causes: [ev], text: `빗나간 저격탄에 인질(구조 대상 ${struck.label})이 다쳤습니다!` }, false);
    hurtCas(sim, s, I, struck, rng.range(22, 34), 'gunshot', { by: r.id, byKind: 'responder', ev: e2, bleed: 0.15, immobile: true });
  }
  if (hit) {
    hurtHostile(sim, s, I, h, SNIPER.dmg, 'gunshot', { by: r.id, byKind: 'responder', ev, down: true });
    recordMethod(sim, I, a, t, 'sniper', t.mwhy ?? 'usual', true, ev, hosTg(h));
    r.xpGained += 0.004;
  } else if (sim.t >= h.alertUntil) { h.alertUntil = sim.t + 6; h.facing = Math.atan2(a.y - h.y, a.x - h.x); }
  return true;
}

// ───────────────────────── 누출 조치·통제 (§4.8) — 단계 6 ─────────────────────────
/** 환기 후 차단: 송풍기 설치 6초(power 1) · 맨몸으로 문·창 열기 12초(power 0.5) · 송풍기 120초 · 차단 전에 기다리는 상한 20초 · 그 아래면 기다리지 않는 선 자리의 가스 0.4 · 차단 시간 ×0.8 */
export const VENT_FIRST = { setFan: 6, setHand: 12, fanFor: 120, wait: 20, clear: 0.4, sealMul: 0.8, near: 1.5 };
/** 그 밸브가 있는 방의 문 가운데 대원에게 가장 가까운 것 (문 소품 — 방 칸에 맞닿은). 없으면 대원에게 가장 가까운 건물 출입구 */
function ventSpot(s: Scene, a: FieldAgent, vx: number, vy: number): { x: number; y: number } | null {
  const w = s.w, rg = s.region[Math.round(vy) * w + Math.round(vx)];
  let best: { x: number; y: number } | null = null, bd = Infinity;
  if (rg >= 0) for (const p of s.props) {
    if (p.kind !== 'door' || p.removed) continue;
    const i = p.y * w + p.x;
    if (s.region[i] !== rg && s.region[i - 1] !== rg && s.region[i + 1] !== rg && s.region[i - w] !== rg && s.region[i + w] !== rg) continue;
    const d = dist(a.x, a.y, p.x, p.y);
    if (d < bd) { bd = d; best = { x: p.x, y: p.y }; }
  }
  if (best !== null) return best;
  for (const e of s.exits) { const d = dist(a.x, a.y, e.x, e.y); if (d < bd) { bd = d; best = { x: e.x, y: e.y }; } }
  return best;
}
/**
 * 환기 후 차단 (§4.8 ventFirst — executor 의 case 'mitigate' 가 밸브 차단 앞에서 부른다). 돌려주는 값 = 이 틱은 여기서 끝 (false 면 지금의 밸브 차단 — 필요 시간 ×0.8).
 *   phase 0  밸브가 있는 방의 문(없으면 출입구)으로 가서, 송풍기가 있으면 작동을 확인하고(kitWorks — 숨은 고장 → broken → 누출 조치) 6초 설치(power 1),
 *            없으면 맨몸으로 문·창을 12초 연다(power 0.5) → s.fan(120초) · 기록 한 줄
 *   phase 6  밸브 곁으로 돌아가 선 자리의 가스가 0.4 아래가 되거나 20초가 지날 때까지 기다린다 → phase 7(차단 — 지금 코드)
 * 다른 대원의 송풍기가 먼저 돌면(설치 전) 조건 상실(team) → 누출 조치
 */
export function runVentFirst(sim: Sim, s: Scene, I: Incident, a: FieldAgent, t: Task, p: Prop, k: ExecKit): boolean {
  if (t.method !== 'ventFirst' || t.phase >= 7) return false;
  const r = sim.responders[a.rid];
  if (t.phase === 0 || t.phase === 5) {
    const f = s.fan;
    if (t.phase === 0 && f && f.until > sim.t && f.rid !== a.rid) { switchMethod(sim, s, I, a, t, 'team', '다른 대원이 이미 환기 중', true, { say: '이미 환기 중입니다.' }); return true; }
    const fan = kitCount(sim, a.rid, 'fan') > 0;
    if (t.phase === 0) {
      if (t.range !== 1) {      // 자리는 처음 한 번 (정했다는 표시는 t.range — 1b 와 같다)
        const sp = ventSpot(s, a, p.x, p.y);
        if (sp === null) { switchMethod(sim, s, I, a, t, 'tooFar', '환기할 문이 없음', true, { say: '열 문이 없습니다.' }); return true; }
        t.tx = sp.x; t.ty = sp.y; t.range = 1; a.path = null;
      }
      a.label = fan ? '송풍기 설치하러' : '문·창 열러';
      const mv = k.moveTo(sim, s, a, t.tx, t.ty, VENT_FIRST.near);
      if (mv === 'nopath') { switchMethod(sim, s, I, a, t, 'tooFar', '환기할 문으로 갈 길이 없음', true, { say: '문으로 갈 길이 없습니다.' }); return true; }
      if (mv !== 'arrived') return true;
      if (fan && !kitWorks(sim, a.rid, 'fan', I)) { switchMethod(sim, s, I, a, t, 'broken', '송풍기가 장비 고장으로 막힘'); return true; }
      t.phase = 5; t.progress = 0;
    }
    // 설치 (phase 5) — 송풍기가 고장이 드러나면 phase 0 에서 이미 바꿨다. 송풍기를 쓰는지는 설치를 시작할 때의 장비로 (그 사이에 바뀌지 않는다)
    const need = fan ? VENT_FIRST.setFan : VENT_FIRST.setHand;
    a.label = fan ? METHOD.ventilate.label : '문·창 개방';
    t.progress += sim.dt; a.ring = t.progress / need;
    k.drain(sim, a, 0.4);
    if (t.progress + 1e-9 < need) return true;
    s.fan = { x: t.tx, y: t.ty, until: sim.t + VENT_FIRST.fanFor, rid: a.rid, power: fan ? 1 : 0.5 };
    emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: fan ? '송풍기 가동 — 가스를 빼냅니다. 농도가 내려가면 밸브를 잠급니다.' : '문과 창을 열어 환기합니다. 농도가 내려가면 밸브를 잠급니다.' });
    t.phase = 6; t.progress = 0; t.mtry = sim.t; a.path = null;      // mtry: 기다리기 시작한 시각
    return true;
  }
  // 기다림 (phase 6): 밸브 곁에서
  const mv = k.moveTo(sim, s, a, p.x, p.y, 1.6);
  if (mv === 'nopath') { k.finish(sim, s, a, false, 'nopath'); return true; }
  if (mv !== 'arrived') { a.label = '밸브로'; return true; }
  a.label = '환기 대기'; a.fx = p.x - a.x; a.fy = p.y - a.y;
  const waited = sim.t - (t.mtry ?? sim.t);
  a.ring = waited / VENT_FIRST.wait;
  if (waited + 1e-9 < VENT_FIRST.wait && senseOf(s, a).smoke >= VENT_FIRST.clear) return true;
  t.phase = 7; t.progress = 0;
  return false;
}
// (R3 §2.9) 저격의 탄 소모 — 탄창·재장전은 교본의 실행부가 맡는다 (import 를 파일 끝에 둔 것은 위의 import 묶음을 다른 묶음이 함께 고치고 있어서다)
import { fireRound, gunReady } from './doctrineRun';
