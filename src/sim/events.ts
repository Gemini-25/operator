// EventLogger — 모든 AI 판단과 행동, 환경 변화는 여기로 기록된다.
// 로그는 화면용 연출이 아니라 시뮬레이션 코드가 상태를 바꾸는 바로 그 지점에서만 생성된다.
// 각 이벤트는 원인 이벤트(causes)를 가지므로 종료 보고서가 인과 사슬을 추적할 수 있다.

import type { Sim } from './engine';
import type { EventKind, Incident, Problem, ProblemCode, Role, WorldTag } from './types';

export interface EmitArgs {
  inc?: number; role: Role; actor: string; kind: EventKind; text: string;
  causes?: number[]; problem?: ProblemCode; imp?: number; truth?: boolean; rid?: number;
  tag?: WorldTag;      // (I1-b) 세계 상태 알림의 갈래 — 측정 도구가 시스템을 가린다. 해시에는 들지 않는다 (틱과 문구만)
}

export function emit(sim: Sim, a: EmitArgs): number {
  const id = sim.events.length;
  const causes: number[] = [];
  if (a.causes) for (const c of a.causes) if (c >= 0 && causes.indexOf(c) < 0) causes.push(c);
  const inc = a.inc ?? -1;
  sim.events.push({
    id, t: sim.t, incidentId: inc, role: a.role, actor: a.actor, kind: a.kind, text: a.text,
    causes, problem: a.problem ?? null, importance: a.imp ?? 1, truth: a.truth ?? false, rid: a.rid ?? -1,
    tag: a.tag,      // (I1-b) 없으면 undefined — 모든 기록이 같은 모양
  });
  // 재현성 검증용 누적 해시
  let h = sim.logHash ^ Math.imul(sim.tick + 1, 2654435761);
  const s = a.text;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  sim.logHash = h >>> 0;
  if (inc >= 0) {
    const I = sim.incidents[inc];
    if (I && !a.truth) I.lastEvent = id;
  }
  return id;
}

/** 문제 발생을 기록한다. 같은 코드가 이미 있으면 새 Problem 을 추가하지 않고 이벤트만 남긴다(dedupe=false 면 항상 추가).
 *  ref = (I1-b) 관련 사건·부대·구간 — 기록만 (판단은 읽지 않는다). 새 Problem 을 만들 때만 붙는다 */
export function raiseProblem(sim: Sim, I: Incident, code: ProblemCode, detail: string, a: Omit<EmitArgs, 'kind' | 'problem' | 'inc'>, dedupe = true, ref?: Problem['ref']): number {
  const ev = emit(sim, { ...a, inc: I.id, kind: 'problem', problem: code, imp: a.imp ?? 2 });
  if (!dedupe || !I.problems.some((p) => p.code === code && !p.recovered)) {
    I.problems.push({ code, t: sim.t, eventId: ev, detail, recovered: false, recoveryText: '', times: undefined, ref });      // times: (R2) METHOD_FAIL 이 같은 대상에서 되풀이된 횟수
  }
  return ev;
}

/** 가장 최근의 미복구 문제를 복구 처리한다. */
export function markRecovered(I: Incident, code: ProblemCode, text: string): number {
  for (let i = I.problems.length - 1; i >= 0; i--) {
    const p = I.problems[i];
    if (p.code === code && !p.recovered) { p.recovered = true; p.recoveryText = text; return p.eventId; }
  }
  return -1;
}

export function lastProblemEvent(I: Incident, code: ProblemCode): number {
  for (let i = I.problems.length - 1; i >= 0; i--) if (I.problems[i].code === code) return I.problems[i].eventId;
  return -1;
}

/** (X6 §5.7) 그 코드·상세(detail)의 가장 최근 미복구 문제를 복구 처리한다 — 같은 코드를 여러 번 남기는 기록(구역마다의 전원 철수·위험 조짐)에서 하나만 고른다. 돌려주는 값은 그 문제의 기록 (-1 = 없음) */
export function markRecoveredBy(I: Incident, code: ProblemCode, detail: string, text: string): number {
  for (let i = I.problems.length - 1; i >= 0; i--) {
    const p = I.problems[i];
    if (p.code === code && !p.recovered && p.detail === detail) { p.recovered = true; p.recoveryText = text; return p.eventId; }
  }
  return -1;
}
