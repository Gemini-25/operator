// 대응 교본의 실행부 (docs/specs/R3-doctrine.md §2.7·§2.9·§5). executor.ts 와 같은 자격이다: 진실을 읽고 상태를 바꾼다. 기록은 상태를 바꾸는 바로 그 자리에서만 남긴다.
// executor.ts 를 import 하지 않는다(순환 — 실행기의 새 case 가 이 파일을 부른다). 실행기의 함수가 필요하면 실행기가 건네는 도구(R2 의 ExecKit — executor.XK)를 받는다.
//
// 단계 0 (틀): 기록 recordDoc 하나와, brain 의 교본 자리가 고른 행동을 임무로 바꾸는 docBegin.
// 단계 1 (공통): 자기 신고 selfReport(brain 의 perceive 다음 — 'crew' 사실), 동요 shake(피격·피습·쓰러진 동료·폭발), 교본 기억 docRemember, split 표본 splitBegin·splitSettle·docSplitOf.
// 뒤 단계가 더한다: 탄약 fireRound·reloadTick·엄폐 cover·보급 rearm·breachExit(2) · 짝 pairUp·rebuddy·pair·airOut·pairOut(3) · triage(4) ·
// 해체 runDefuse(5) · 이송·통제 runCarry·runTraffic(6).

import type { Sim } from '../engine';
import type { CrewBelief, DocHook, DocUse, DocWhy, FieldAgent, Incident, Scene, Task, TaskKind, WorkItem, WorkKind } from '../types';
import type { DocFitAns, DocPick, DoctrineRule } from './doctrine/registry';
import type { ExecKit } from './methodRun';
import { learn, learnQuiet } from './agents';
import { mkFact } from './beliefs';
import { DOC, bandHyst, crewSigOf, docDeptOf, phaseOf, sigBand } from './doctrine';
import { gunOf, kitHas, kitQty } from './gear';

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
  const was: WorkKind | null = a.task && a.task.workId >= 0 && s.board[a.task.workId] ? s.board[a.task.workId].kind : null;      // 이 행동이 대신한 작업판 일 (split 의 열쇠)
  if (a.task) k.finish(sim, s, a, false, 'preempt');
  const t = k.makeTask(pick.act as string as TaskKind, pick.rule.short);
  t.startedAt = sim.t; t.docRule = pick.rule.id;
  a.task = t;
  a.doc = { rule: pick.rule.id, act: pick.act, since: sim.t };
  splitBegin(sim, s, a, was);
  recordDoc(sim, sim.incidents[s.incidentId], a, pick.rule.id, pick.rule.hook, { act: pick.act });
}

// ───────────────────────── (1단계) 교본이 바꾼 배정 (§2.7) ─────────────────────────
/** 지시 무전 끝의 까닭 말에 쓰는 낱말 (줄의 short 가 이 말로 시작하면 short 만) */
export const WHY_WORD: Record<DocWhy, string> = {
  alone: '혼자', buddy: '짝', outside: '대기조 없음', hurt: '부상', tired: '지침', shaken: '동요', lowAir: '공기 부족', lowAmmo: '탄약 부족', noKit: '장비 없음',
  kit: '장비', civ: '시민 위험', hostage: '인질 위험', danger: '위험', triage: '분류', backup: '지원', protocol: '절차', team: '동료',
};
/** 중립이 아닌 효과 (배율 ≠ 1 또는 가산 ≠ 0) */
const nonNeutral = (h: DocFitAns['hits'][number]): boolean => h.mul !== 1 || h.add !== 0;
/**
 * commander.assign 이 교본을 넣은 1등과 교본 전의 1등이 다를 때 부른다: 뽑힌 대원에게 걸린 중립 아닌 줄 가운데 rank 가 가장 작은 줄(같으면 등록 순서)의 까닭 말
 * — "(부상 — 가벼운 임무)". 뽑힌 대원에게 그런 줄이 없으면(밀려난 대원 쪽의 감점만이면) 빈 글
 */
export function docAssignWhy(pick: DocFitAns | null): string {
  if (pick === null) return '';
  let best: DoctrineRule | null = null;
  for (const h of pick.hits) if (nonNeutral(h) && (best === null || h.rule.rank < best.rank)) best = h.rule;
  if (best === null) return '';
  const word = WHY_WORD[best.why];
  return best.short.startsWith(word) ? `(${best.short})` : `(${word} — ${best.short})`;
}
/**
 * 교본이 바꾼 배정을 기록한다 (§2.7 — '쓰였다'의 정의): 뽑힌 대원에게 걸린 중립 아닌 줄과, 교본 전이라면 뽑혔을 대원에게 걸린 금지·감점 줄(배율 < 1)을
 * hook 'fit', 대상 열쇠 'w:<작업 id>' 로. ev = 그 지시 무전의 기록 (지휘관 자신이거나 아무도 뽑히지 않았으면 -1). 같은 줄·대원·작업은 30초 안이면 한 줄로 잇는다(recordDoc)
 */
export function docAssignRecord(sim: Sim, I: Incident, pick: FieldAgent | null, pickAns: DocFitAns | null, base: FieldAgent | null, baseAns: DocFitAns | null, w: WorkItem, ev: number): void {
  const tgt = 'w:' + w.id;
  if (pick !== null && pickAns !== null) for (const h of pickAns.hits) if (nonNeutral(h)) recordDoc(sim, I, pick, h.rule.id, 'fit', { work: w.kind, tgt }, ev, h.rule.report !== undefined);
  if (base !== null && baseAns !== null && base !== pick) for (const h of baseAns.hits) if (h.mul < 1) recordDoc(sim, I, base, h.rule.id, 'fit', { work: w.kind, tgt }, ev, h.rule.report !== undefined);
}

// ───────────────────────── (1단계) 자기 신고 ─────────────────────────
/** 신고의 글 (§4.1 — 사실만. 무엇을 하겠다는 말은 넣지 않는다: fit 은 지금 임무를 놓게 하지 않는다) */
export const CREW_TEXT = { air2: '공기 30% 미만.', air1: '공기 50% 미만.', hurt: '부상 — 체력 저하.', ammo2: '탄약 소진.', ammo1: '탄약 마지막 탄창.' } as const;
/** 자기 몸의 지금 상태 (자기 몸 — 실행부의 자격). band 는 지난 신고에 간격을 얹는다 (70 에서 들어가고 75 에서 풀린다) */
export function crewNow(sim: Sim, a: FieldAgent): CrewBelief {
  const r = sim.responders[a.rid], rid = a.rid;
  const air: 0 | 1 | 2 = kitHas(sim, rid, 'scba') ? ((q: number): 0 | 1 | 2 => (q < DOC.AIR_OUT ? 2 : q < DOC.AIR_IN ? 1 : 0))(kitQty(sim, rid, 'scba') / sim.tune.airFull) : 0;
  const g = gunOf(sim, rid);
  const ammo: 0 | 1 | 2 = g !== null && g.ammo !== Infinity ? (g.ammo <= 2 * g.perShot ? 2 : g.ammo <= g.magSize ? 1 : 0) : 0;      // 탄을 세지 않는 동안(2단계 전)은 늘 0
  return { band: bandHyst(r.health, sigBand(a.crewSig)), air, ammo, shaken: a.shaken !== undefined && a.shaken > sim.t, t: sim.t };
}
/**
 * 자기 신고 (§4.1 — brain.think 의 perceive 다음, flushOutbox 앞): 몸 상태의 서명(band·air·ammo·shaken)이 지난 신고와 다르면 'crew' 사실을 자기 믿음에 넣고 무전으로 보낸다.
 * 나빠진 것(공기 위급·낮음, 탄 위급·마지막 탄창, 중상)만 글이 있다 — 공기 위급·탄 위급·중상은 바로·중요로(agents 의 hot), 그 밖은 묶음 보고.
 * 나아진 것·동요·위중(체력 40 아래 — H1 의 후퇴·부상 무전이 이미 알린다)은 글 없이(learnQuiet) 믿음과 무전 자료로만 보낸다.
 * 처음 판단이고 멀쩡하면 알리지 않는다 (신고가 없으면 멀쩡한 것으로 본다 — 도착마다 빈 무전이 나가지 않게)
 */
export function selfReport(sim: Sim, s: Scene, a: FieldAgent): void {
  if (a.aloft) return;
  if (a.shaken !== undefined && a.shaken <= sim.t) { a.shakenOff = a.shaken; a.shaken = undefined; }      // 동요가 끝났다 (끝난 시각 — 10초 면역)
  const v = crewNow(sim, a), sig = crewSigOf(v), prev = a.crewSig;
  if (sig === prev) return;
  a.crewSig = sig;
  if (prev === undefined && sig === '0000') return;
  const ob = prev === undefined ? 0 : +prev[0], oa = prev === undefined ? 0 : +prev[1], om = prev === undefined ? 0 : +prev[2];
  const alert = v.air === 2 && oa < 2 ? CREW_TEXT.air2 : v.ammo === 2 && om < 2 ? CREW_TEXT.ammo2 : v.band === 1 && ob < 1 ? CREW_TEXT.hurt
    : v.air === 1 && oa < 1 ? CREW_TEXT.air1 : v.ammo === 1 && om < 1 ? CREW_TEXT.ammo1 : '';
  const f = mkFact('crew', a.rid, v, sim.responders[a.rid].name, sim.t, 1, true, alert || crewQuietText(v));
  if (alert) learn(sim, a, f); else learnQuiet(sim, a, f);
  void s;
}
/** 글 없이 보내는 신고의 믿음 속 글 (무전 문구에는 실리지 않는다 — 정보창의 '알고 있는 정보'에만 보인다) */
function crewQuietText(v: CrewBelief): string {
  return `상태 보고: 몸 ${['경상', '중상', '위중'][Math.min(2, v.band)]}${v.air ? ` · 공기 ${v.air === 2 ? '위급' : '낮음'}` : ''}${v.ammo ? ` · 탄 ${v.ammo === 2 ? '위급' : '마지막 탄창'}` : ''}${v.shaken ? ' · 동요' : ''}`;
}
/** 바로·중요로 보내는 신고인가 (agents 의 hot — 나빠진 공기 위급·탄 위급·중상의 글) */
export const crewAlert = (text: string): boolean => text === CREW_TEXT.air2 || text === CREW_TEXT.ammo2 || text === CREW_TEXT.hurt;

// ───────────────────────── (1단계) 동요 ─────────────────────────
/** 동요 (§4.2·§4.3): 길이 = 20 × (1.3 − 침착함) 초 (6~26초), 끝난 뒤 10초 면역. 동요 중에는 다시 걸리지 않는다(늘이지 않는다) */
export const SHAKE = { base: 20, top: 1.3, immune: 10, mateR: 6, blastPad: 3 } as const;
/**
 * 동요를 건다 — 상태를 바꾸는 그 자리(hazards 의 피격·피습 줄, perceive 의 쓰러진 동료, blast)가 부른다. 기록은 남기지 않는다(내부 상태다 —
 * 그 동요가 바꾼 결정이 기록된다. 지휘관에게는 'crew' 신고의 서명으로 글 없이 알려진다). 난수를 쓰지 않는다
 */
export function shake(sim: Sim, a: FieldAgent): void {
  if (a.status !== 'active' || a.aloft || sim.responders[a.rid].dead) return;
  if (a.shaken !== undefined && a.shaken > sim.t) return;
  const off = a.shaken !== undefined ? a.shaken : a.shakenOff;
  if (off !== undefined && sim.t - off < SHAKE.immune) return;
  if (a.shaken !== undefined) a.shakenOff = a.shaken;
  a.shaken = sim.t + SHAKE.base * (SHAKE.top - sim.responders[a.rid].composure);
}

// ───────────────────────── (1단계) 교본 기억 ─────────────────────────
/**
 * 교본 기억을 남긴다 (§4.4 끝 — 두 뜻): key 'w:<작업 id>' = 그 작업을 sec 초 동안 맡지 않는다(docFit 이 0) · 그 밖의 key(대상 열쇠, '*' = 모두) = 그 행동 줄을 그 대상에 다시 걸지 않는다.
 * 지난 기억은 이때 지운다. 같은 (줄, 열쇠)가 있으면 늦은 쪽으로 늘린다
 */
export function docRemember(sim: Sim, a: FieldAgent, rule: string, key: string, sec: number): void {
  const mem = (a.docMem ??= []);
  for (let k = mem.length - 1; k >= 0; k--) if (mem[k].until <= sim.t) mem.splice(k, 1);
  for (let k = 0; k < mem.length; k++) if (mem[k].rule === rule && mem[k].key === key) { mem[k].until = Math.max(mem[k].until, sim.t + sec); return; }
  mem.push({ rule, key, until: sim.t + sec });
}

// ───────────────────────── (1단계) 같은 상황 다른 행동 — split 의 표본 (§8.2) ─────────────────────────
/** 교본 행동의 임무 (DocActId 와 같은 이름 — 그 행동을 쓰는 단계가 TaskKind 에 더한다) */
const DOC_ACTS: ReadonlySet<string> = new Set<string>(['airOut', 'pairOut', 'cover', 'rearm', 'pair']);
/** 교대마다 '분야|국면|임무' → (고른 것 → 횟수). 교대 보고서의 docSplit 이 된다 (Sim 의 모양을 바꾸지 않으려 WeakMap — 되감기는 Sim 을 새로 만든다) */
const SPLIT = new WeakMap<Sim, Record<string, Record<string, number>>>();
/** 시작했지만 아직 고른 것을 적지 않은 표본 (대원마다 하나 — 방법은 시작한 틱의 실행에서 정해지므로 다음 판단에서 적는다) */
const PEND = new WeakMap<FieldAgent, { t: Task; key: string }>();
/**
 * 임무가 시작된 자리(brain 의 setTask·takeWork, 교본 행동의 docBegin)가 부른다 — a.task 가 새 임무다. 열쇠 = 분야(docDeptOf)|시작 직후의 국면(phaseOf)|임무
 * (작업판 일이면 그 WorkKind, 교본 행동이면 그 행동이 대신한 작업판 일 replaced — 없으면 TaskKind). 앞의 표본이 남아 있으면 먼저 적는다
 */
export function splitBegin(sim: Sim, s: Scene, a: FieldAgent, replaced: WorkKind | null = null): void {
  const t = a.task;
  if (t === null) return;
  splitSettle(sim, a);
  const w = t.workId >= 0 ? s.board[t.workId] : undefined;
  const kind: string = w ? w.kind : t.docRule !== undefined && replaced !== null ? replaced : t.kind;
  PEND.set(a, { t, key: `${docDeptOf(sim, a.rid)}|${phaseOf(sim, s, a)}|${kind}` });
}
/** 남은 표본을 적는다 (brain.think 의 첫머리 — 시작한 틱의 실행이 고른 방법이 그 임무에 적혀 있다): 판단 지점에서 막혀 있으면 그 줄 번호, 교본 행동이면 그 행동, 방법이 정해졌으면 그 방법, 아니면 'none' */
export function splitSettle(sim: Sim, a: FieldAgent): void {
  const p = PEND.get(a);
  if (p === undefined) return;
  PEND.delete(a);
  const t = p.t;
  const v = t.gateAt !== undefined && t.gateAt >= 0 && t.docRule !== undefined ? t.docRule.slice(0, 3) : DOC_ACTS.has(t.kind) ? t.kind : t.method ?? 'none';
  let all = SPLIT.get(sim);
  if (all === undefined) { all = {}; SPLIT.set(sim, all); }
  const row = (all[p.key] ??= {});
  row[v] = (row[v] ?? 0) + 1;
}
/** 이 교대의 split 표본 (없으면 undefined) — debrief.buildReport 가 ShiftReport.docSplit 에 담는다 */
export function docSplitOf(sim: Sim): Record<string, Record<string, number>> | undefined { const v = SPLIT.get(sim); return v !== undefined && Object.keys(v).length ? v : undefined; }
