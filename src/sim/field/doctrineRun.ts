// 대응 교본의 실행부 (docs/specs/R3-doctrine.md §2.7·§2.9·§5). executor.ts 와 같은 자격이다: 진실을 읽고 상태를 바꾼다. 기록은 상태를 바꾸는 바로 그 자리에서만 남긴다.
// executor.ts 를 import 하지 않는다(순환 — 실행기의 새 case 가 이 파일을 부른다). 실행기의 함수가 필요하면 실행기가 건네는 도구(R2 의 ExecKit — executor.XK)를 받는다.
//
// 단계 0 (틀): 기록 recordDoc 하나와, brain 의 교본 자리가 고른 행동을 임무로 바꾸는 docBegin 만 있다 — 줄이 없어 아무도 부르지 않는다(결과 불변).
// 뒤 단계가 더한다: 자기 신고 selfReport·동요 shake(1) · 탄약 fireRound·reloadTick·엄폐 cover·보급 rearm·breachExit(2) · 짝 pairUp·rebuddy·pair·airOut·pairOut(3) · triage(4) ·
// 해체 runDefuse(5) · 이송·통제 runCarry·runTraffic(6).

import type { Sim } from '../engine';
import type { DocHook, DocUse, FieldAgent, Incident, Scene, TaskKind } from '../types';
import type { DocPick } from './doctrine/registry';
import type { ExecKit } from './methodRun';

/** 같은 (줄, 대원, 대상)의 기록을 하나로 잇는 시간 (초) — 같은 기다림이 판단 주기마다 줄을 만들지 않게 */
export const DOC_MERGE = 30;

/**
 * 교본을 쓴 기록 한 줄을 I.docs 에 넣는다 (§2.7). 같은 (rule, rid, tgt) 의 줄이 30초 안에 있으면 새 줄 대신 그 줄의 t1 을 늘린다.
 * a = 그 대원 (지휘·관제 줄은 null). extra = 행동·판단 지점·방법·작업·짝·대상 열쇠. eventId = 그때 남긴 기록(없으면 -1). say = 보고서 문장 후보인가.
 * 기록 문구는 따로 내지 않는다 — 문구(emit)는 상태를 바꾸는 부르는 쪽이 남기고 그 id 를 넘긴다.
 */
export function recordDoc(sim: Sim, I: Incident, a: FieldAgent | null, rule: string, hook: DocHook, extra: Partial<Pick<DocUse, 'act' | 'gate' | 'method' | 'work' | 'mate' | 'tgt'>> = {}, eventId = -1, say = false): DocUse {
  const docs = (I.docs ??= []);
  const rid = a !== null ? a.rid : -1, tgt = extra.tgt ?? '';
  for (let k = docs.length - 1; k >= 0; k--) {
    const d = docs[k];
    if (d.rule !== rule || d.rid !== rid || d.tgt !== tgt || sim.t - d.t1 > DOC_MERGE) continue;
    d.t1 = sim.t;
    if (d.eventId < 0 && eventId >= 0) d.eventId = eventId;
    if (say) d.say = true;
    return d;
  }
  const d: DocUse = {
    t: sim.t, t1: sim.t, rid, unitId: a !== null ? a.unitId : -1, rule, hook,
    act: extra.act, gate: extra.gate, method: extra.method, work: extra.work,
    mate: extra.mate ?? -1, tgt, eventId, say,
  };
  docs.push(d);
  return d;
}

/**
 * brain 의 교본 자리(의무·행동 후보·후퇴 바꿔 끼우기)가 고른 교본 행동을 임무로 바꾼다: 하던 임무를 놓고(preempt) 그 행동의 임무를 연다.
 * 그 행동의 TaskKind 와 실행 case·계속 점수·기록 문구는 그 행동을 쓰는 단계가 더한다(2단계 cover·rearm, 3단계 airOut·pairOut·pair) — 그 전에는 줄이 없어 불리지 않는다.
 */
export function docBegin(sim: Sim, s: Scene, a: FieldAgent, pick: DocPick, k: Pick<ExecKit, 'finish' | 'makeTask'>): void {
  if (a.task) k.finish(sim, s, a, false, 'preempt');
  const t = k.makeTask(pick.act as string as TaskKind, pick.rule.short);
  t.startedAt = sim.t; t.docRule = pick.rule.id;
  a.task = t;
  a.doc = { rule: pick.rule.id, act: pick.act, since: sim.t };
  recordDoc(sim, sim.incidents[s.incidentId], a, pick.rule.id, pick.rule.hook, { act: pick.act });
}
