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
  const wasW = a.task && a.task.workId >= 0 ? s.board[a.task.workId] : undefined;
  const was: WorkKind | null = wasW ? wasW.kind : null;      // 이 행동이 대신한 작업판 일 (split 의 열쇠)
  const hostile = a.task !== null && a.task.hostile >= 0 ? a.task.hostile : -1;      // (2단계) 하던 임무의 용의자 — 엄폐가 그 위협을 본다 (P16 의 협상 상대)
  if (a.task) k.finish(sim, s, a, false, 'preempt');
  // (2단계 P16) 협상자가 교전 때문에 엄폐하면 그 협상은 엄폐의 상한(12초) 동안 다른 대원에게 넘기지 않는다 — 넘기면 손이 빈 대원이 차례로 협상을 받아 차례로 엄폐한다.
  // 작업은 열린 채 남는다: 교전이 그쳐 엄폐가 끝나면 지휘관이 협상을 다시 준다 (§3.1 P16)
  if (wasW !== undefined && wasW.kind === 'negotiate' && pick.act === 'cover' && (wasW.status === 'open' || wasW.status === 'active')) wasW.holdUntil = Math.max(wasW.holdUntil, sim.t + DOC.COVER_CAP);
  const t = k.makeTask(pick.act as string as TaskKind, ACT_LABEL[pick.act] ?? pick.rule.short);      // TaskKind 에는 그 행동을 쓰는 단계가 이름을 더한다 (2단계 cover·rearm, 3단계 airOut·pairOut·pair)
  t.startedAt = sim.t; t.docRule = pick.rule.id; t.hostile = hostile;
  a.task = t;
  a.doc = { rule: pick.rule.id, act: pick.act, since: sim.t };
  splitBegin(sim, s, a, was);
  const I = sim.incidents[s.incidentId];
  ACT_DOC.set(t, recordDoc(sim, I, a, pick.rule.id, pick.rule.hook, { act: pick.act, tgt: hostile >= 0 ? 'h:' + hostile : '', mate: PAIR_ACTS.has(pick.act) && a.buddy !== undefined ? a.buddy : -1 }, docNote(sim, s, a, pick.rule), pick.rule.report !== undefined));
}
/** 교본 행동 임무의 기록 한 줄 (끝날 때 t1 을 닫는다 — 평균 길이·보고서의 {n}) */
const ACT_DOC = new WeakMap<Task, DocUse>();
/** 교본 행동 임무가 끝났다: 그 기록의 끝 시각을 적고 따르는 교본을 비운다 */
export function actEnd(sim: Sim, a: FieldAgent, t: Task): void { const d = ACT_DOC.get(t); if (d !== undefined) d.t1 = sim.t; a.doc = null; }
/** (2단계) 교본 행동 임무의 머리 위 라벨 (§7.2) */
export const ACT_LABEL: Partial<Record<DocActId, string>> = { cover: '엄폐', rearm: '탄약 보급', airOut: '공기 탈출', pairOut: '짝 따라 나감', pair: '짝 동행' };
/** 같은 대원·같은 줄의 교본 행동 문구를 다시 남기지 않는 시간 (초 — 지금의 후퇴 문구와 같다) */
export const NOTE_GAP = 20;
/** 대원마다 줄별 마지막 문구 시각 (대원 개체의 모양을 바꾸지 않으려 WeakMap — 되감기는 Sim 을 새로 만든다) */
const NOTE_AT = new WeakMap<FieldAgent, Map<string, number>>();
/**
 * (2단계) 교본 행동·놓기의 기록 문구 (§2.7): 그 줄의 note 를 대원의 말로 한 번 (imp 1, 같은 대원·같은 줄은 20초에 한 번). 돌려주는 값 = 기록 id (남기지 않았으면 -1).
 * {name} = 그 대원, {mate} = 짝(없으면 빈 말) — 줄의 note 가 없으면 기록 없이 센다
 */
export function docNote(sim: Sim, s: Scene, a: FieldAgent, rule: DoctrineRule, imp = 1, text?: string): number {
  const tpl = text ?? rule.note;
  if (tpl === undefined) return -1;
  let m = NOTE_AT.get(a);
  if (m === undefined) { m = new Map(); NOTE_AT.set(a, m); }
  const key = text === undefined ? rule.id : rule.id + '|' + text;
  const at = m.get(key);
  if (at !== undefined && sim.t - at < NOTE_GAP) return -1;
  m.set(key, sim.t);
  const r = sim.responders[a.rid];
  const mate = mateName(sim, s, a);
  return emit(sim, { inc: s.incidentId, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp, text: tpl.replace(/\{name\}/g, r.name).replace(/\{mate\}, /g, mate ? mate + ', ' : '').replace(/\{mate\}/g, mate || '동료') });
}
/** 문구의 {mate}: 짝(3단계), 없으면 6칸 안의 같은 부서 활동 대원 가운데 가장 가까운 사람, 없으면 빈 말 */
function mateName(sim: Sim, s: Scene, a: FieldAgent): string {
  if (a.buddy !== undefined && a.buddy >= 0) return sim.responders[a.buddy].name;
  const dept = sim.responders[a.rid].dept;
  let best = '', bd: number = DOC.MATE_R;
  for (const b of s.agents) { if (b === a || b.status !== 'active' || sim.responders[b.rid].dept !== dept) continue; const d = dist(a.x, a.y, b.x, b.y); if (d <= bd) { bd = d; best = sim.responders[b.rid].name; } }
  return best;
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

// ───────────────────────── (2단계) 탄약 (§2.9) ─────────────────────────
// 총기(권총 30발·탄창 15 · 소총 90발·탄창 30·두 발 사격 · 저격 소총 15발·탄창 5)는 탄을 센다. 탄창이 비면 재장전(2.0·2.5·3.0초) 동안 쏘지 않는다.
// 판정은 결정적이다(난수 없음). 소모·재장전은 쏘는 그 자리(executor.shootAt · methodRun 의 저격)에서만 — 판단부(doctrine.ts)는 gear.gunOf 로 읽기만 한다.
/** 쏘는 총: gun 을 주면 그것, 아니면 가진 총 가운데 저격 소총 > 소총 > 권총 (G5 weaponOf · gear.gunOf 와 같은 순서). 없으면 null */
function gunItem(sim: Sim, rid: number, gun?: KitId): KitItem | null {
  const kit = sim.responders[rid].kit;
  if (!kit) return null;
  for (const id of gun !== undefined ? [gun] : GUN_ORDER) for (let k = 0; k < kit.length; k++) if (kit[k].id === id && !kit[k].faultKnown) return kit[k];
  return null;
}
const GUN_ORDER: KitId[] = ['sniper', 'rifle', 'pistol'];
/** 지금 쏠 수 있는가 (재장전 중이 아니고 탄창에 탄이 있다). 총이 없거나 탄을 세지 않는 총이면 true — 상태를 바꾸지 않는다 */
export function gunReady(sim: Sim, a: FieldAgent, gun?: KitId): boolean {
  if (a.reloadUntil !== undefined && a.reloadUntil > sim.t) return false;
  const it = gunItem(sim, a.rid, gun);
  if (it === null || it.uses === undefined || it.mag === undefined) return true;
  return it.mag > 0 || (a.reloadUntil !== undefined && it.uses > 0);      // 재장전이 막 끝났다 (reloadTick 이 아직 돌지 않았다) — 쏠 때 채운다
}
/**
 * 한 번 쏜다 (§2.9 — executor.shootAt 의 첫머리, R2 저격의 판정 직후): 재장전 중이거나 탄창이 비었으면 쏘지 않고 false (부르는 쪽은 난수를 부르기 전에 돌아간다).
 * 쏘면 가진 탄에서 perShot 을 쓰고(crews.useKit) 탄창도 줄인다. 탄창이 비고 탄이 남았으면 재장전을 시작한다(a.reloadUntil — 그 시각에 reloadTick 이 채운다).
 * 총이 없거나 탄을 세지 않는 총(손으로 만든 명부)이면 세지 않고 true
 */
export function fireRound(sim: Sim, a: FieldAgent, gun?: KitId): boolean {
  if (a.reloadUntil !== undefined) { if (a.reloadUntil > sim.t) return false; reloadTick(sim, a); }
  const it = gunItem(sim, a.rid, gun);
  if (it === null || it.uses === undefined || it.mag === undefined) return true;
  const d = KITS[it.id], per = d.perShot ?? 1;
  if (it.mag <= 0) { if (it.uses > 0) a.reloadUntil = sim.t + (d.reload ?? 0); return false; }
  crewUseKit(sim, a.rid, it.id, per);
  it.mag = Math.max(0, it.mag - per);
  if (it.mag <= 0 && it.uses > 0) a.reloadUntil = sim.t + (d.reload ?? 0);
  return true;
}
/** 재장전이 끝났다 (executor.act 의 첫머리 — a.reloadUntil 이 지났을 때): 빈 탄창을 남은 탄으로 채운다 (탄창 크기까지) */
export function reloadTick(sim: Sim, a: FieldAgent): void {
  a.reloadUntil = undefined;
  const kit = sim.responders[a.rid].kit;
  if (kit) for (let k = 0; k < kit.length; k++) { const it = kit[k], d = KITS[it.id]; if (d.mag !== undefined && it.mag !== undefined && it.uses !== undefined && it.mag < (d.perShot ?? 1)) it.mag = Math.min(d.mag, it.uses); }
}
// (import 를 이 절에 둔 것은 위의 import 묶음을 다른 단계가 함께 고치고 있어서다)
import { KITS, useKit as crewUseKit } from '../crews';
import type { KitId, KitItem } from '../types';

// ───────────────────────── (2단계) 판단 지점의 기다림 (§2.7·§4.4) ─────────────────────────
/** 예외·상한으로 지나간 판단 지점 (그 임무 동안 다시 묻지 않는다 — 막고 풀고 다시 막는 왕복을 막는다. 임무의 모양을 바꾸지 않으려 WeakMap) */
const PASSED = new WeakMap<Task, DocGateId[]>();
/** 그 임무가 그 판단 지점을 예외·상한으로 이미 지나갔는가 */
export function gatePassed(t: Task, g: DocGateId): boolean { const v = PASSED.get(t); return v !== undefined && v.indexOf(g) >= 0; }
function passGate(t: Task, g: DocGateId): void { const v = PASSED.get(t); if (v === undefined) PASSED.set(t, [g]); else if (v.indexOf(g) < 0) v.push(g); }
const ruleById = (id: string | null): DoctrineRule | undefined => { if (id === null) return undefined; for (let k = 0; k < DOCTRINE.length; k++) if (DOCTRINE[k].id === id) return DOCTRINE[k]; return undefined; };
/**
 * 판단 지점의 공통 처리 — 실행기의 그 분기가 docGate 의 답(ans)을 받아 부른다. 판단은 교본 함수가, 기다림·기록은 이 함수가, 이동은 실행기가 한다.
 *  막혔다     처음이면 t.gateAt·gateId·docRule 을 적고 그 줄의 note 를 한 번(t.gateSaid — 임무마다 한 번), 기록(recordDoc — 기다리는 동안 t1 이 늘어난다).
 *             상한(ans.wait)에 닿으면 그 줄의 outNote 를 남기고 'timeout' — 부르는 쪽이 줄마다 정한 갈래로(대개 지금 동작). 상한이 없는 판단 지점은 없다
 *  막히지 않았다  막혀 있던 것이 풀렸으면 판단 지점 칸을 비운다. 예외(ans.exc — unless)가 처음 결정을 바꿨으면 그 줄의 excNote(imp 2) 한 번과 기록
 * 예외·상한으로 지나간 판단 지점은 그 임무 동안 다시 묻지 않는다(gatePassed). 돌려주는 값: 'wait' 이 틱은 기다린다 · 'go' 지금 동작으로 · 'timeout' 상한
 */
export function gateStep(sim: Sim, s: Scene, a: FieldAgent, t: Task, gate: DocGateId, ans: DocGateAns): 'wait' | 'go' | 'timeout' {
  if (gatePassed(t, gate)) return 'go';
  const I = sim.incidents[s.incidentId];
  const tgt = t.hostile >= 0 ? 'h:' + t.hostile : t.workId >= 0 ? 'w:' + t.workId : '';
  if (ans.ok) {
    if (ans.exc !== null) {
      const r = ruleById(ans.exc);
      const ev = r !== undefined && r.excNote !== undefined ? docNote(sim, s, a, r, 2, r.excNote) : -1;
      recordDoc(sim, I, a, ans.exc, 'gate', { gate, tgt }, ev, r !== undefined && r.report !== undefined);
      passGate(t, gate);
    }
    if (t.gateId === gate) { if (t.docRule !== undefined) recordDoc(sim, I, a, t.docRule, 'gate', { gate, tgt }); clearGate(t); }
    return 'go';
  }
  const rule = ruleById(ans.rule);
  if (t.gateId !== gate || (t.gateAt ?? -1) < 0) { t.gateAt = sim.t; t.gateId = gate; t.gateSaid = false; }
  t.docRule = ans.rule ?? undefined;
  let ev = -1;
  if (!t.gateSaid) { t.gateSaid = true; if (rule !== undefined) ev = docNote(sim, s, a, rule); }
  if (ans.rule !== null) recordDoc(sim, I, a, ans.rule, 'gate', { gate, tgt }, ev, rule !== undefined && rule.report !== undefined);
  if (sim.t - (t.gateAt ?? sim.t) + 1e-9 < ans.wait) return 'wait';
  if (rule !== undefined && rule.outNote !== undefined) docNote(sim, s, a, rule, 1, rule.outNote);
  passGate(t, gate); clearGate(t);
  return 'timeout';
}
/** 판단 지점 칸을 비운다 (풀렸거나 상한) */
function clearGate(t: Task): void { t.gateAt = -1; t.gateId = undefined; t.gateSaid = false; if (t.kind !== 'cover' && t.kind !== 'rearm') t.docRule = undefined; }

// ───────────────────────── (2단계) 교본 행동의 실행 — 엄폐 · 탄약 보급 (§2.9·§2.10) ─────────────────────────
type HosV = { x: number; y: number; state: string; weapon: string };
/** 믿음 속 가장 가까운 활동 용의자의 id (없으면 -1) */
function nearestThreat(a: FieldAgent): number {
  let best = -1, bd = Infinity;
  for (const f of a.beliefs.list('hos')) { const v = f.value as HosV; if (v.state !== 'hold' && v.state !== 'fight' && v.state !== 'flee') continue; const d = dist(a.x, a.y, v.x, v.y); if (d < bd) { bd = d; best = f.id; } }
  return best;
}
/**
 * 엄폐 (TaskKind 'cover', 라벨 '엄폐' — §2.10): 믿음 속 위협에서 벽에 가려 보이지 않는 대원 둘레 4칸의 자리(coverSpot 숨기)로 가서 쏘지 않고 기다린다.
 * 자리는 임무에 담고(t.cvX·cvY, 그때의 위협 자리 t.cvTx·cvTy) 위협이 2칸 넘게 움직였을 때만 다시 고른다. 자리가 없으면 대기 지점으로 물러난다(지금의 후퇴).
 * 끝: 12초 · 믿음 속 위협이 교전(fight) 중이 아님 · (재장전 엄폐 P10 · 탄 위급 엄폐 P09 · 탄 위급) 재장전이 끝났고 4초 동안 피격이 없음.
 * 끝나면 그 줄을 그 위협에 20초 동안 다시 걸지 않는다(docMem — 엄폐 ↔ 교전 왕복을 늦춘다). 탄 위급이면 그다음 판단에 P08 이 보급으로 잇는다
 */
export function runCover(sim: Sim, s: Scene, a: FieldAgent, t: Task, k: ExecKit): void {
  if (t.hostile < 0) t.hostile = nearestThreat(a);
  const th = t.hostile >= 0 ? a.beliefs.val<HosV>('hos', t.hostile) : undefined;
  const reloading = a.reloadUntil !== undefined && a.reloadUntil > sim.t;
  const calm = sim.t - a.underFireT >= DOC.CALM;
  const g = gunOf(sim, a.rid);
  const crit = g !== null && g.ammo !== Infinity && g.ammo <= 2 * g.perShot;
  const rule = t.docRule ?? '';
  if (th === undefined || th.state !== 'fight' || sim.t - t.startedAt >= DOC.COVER_CAP || (calm && !reloading && (rule === 'P09' || rule === 'P10' || crit))) {
    if (t.hostile >= 0 && rule) docRemember(sim, a, rule, 'h:' + t.hostile, DOC.COVER_MEM);
    actEnd(sim, a, t);
    k.finish(sim, s, a, true);
    return;
  }
  if (t.cvX === undefined || t.cvTx === undefined || t.cvTy === undefined || dist(th.x, th.y, t.cvTx, t.cvTy) > 2) {
    const sp = coverSpot(s, a.x, a.y, th.x, th.y, false);
    t.cvTx = th.x; t.cvTy = th.y; t.cvX = sp !== null ? sp.x : NaN; t.cvY = sp !== null ? sp.y : NaN;
    a.path = null; a.pathGoal = -1;
  }
  a.label = '엄폐';
  if (Number.isNaN(t.cvX)) { k.moveTo(sim, s, a, s.staging.x, s.staging.y, 2); return; }      // 숨을 자리가 없다: 지금의 후퇴 (대기 지점으로)
  const m = k.moveTo(sim, s, a, t.cvX, t.cvY ?? t.cvX, 0.4);
  if (m === 'nopath') { t.cvX = NaN; t.cvY = NaN; return; }
  if (m === 'arrived') { a.fx = th.x - a.x; a.fy = th.y - a.y; }
}
/** 탄약 보급의 시간 (초 — 대기 지점의 차에서) */
export const REARM_TIME = 6;
/**
 * 탄약 보급 (TaskKind 'rearm', 라벨 '탄약 보급' — §2.9): 대기 지점(3칸 안)까지 가서 6초 → 자기 부대에 탄약 상자가 남았으면 가진 총기를 모두 처음 값으로, 상자 하나를 쓴다.
 * 상자가 없으면(오는 동안 동료가 마지막 상자를 썼다) '보급할 탄약이 없습니다.' 를 한 번 남기고 이 사건 동안 그 줄(P08)을 다시 걸지 않는다. 닿지 못하면 25초 동안 다시 걸지 않는다
 */
export function runRearm(sim: Sim, s: Scene, a: FieldAgent, t: Task, k: ExecKit): void {
  a.label = '탄약 보급';
  const m = k.moveTo(sim, s, a, s.staging.x, s.staging.y, 3);
  if (m === 'moving' || m === 'busy') return;
  const rule = t.docRule ?? 'P08';
  if (m === 'nopath') { docRemember(sim, a, rule, '*', 25); actEnd(sim, a, t); k.finish(sim, s, a, false); return; }
  t.need = REARM_TIME; t.progress += sim.dt; a.ring = t.progress / t.need;
  if (t.progress + 1e-9 < t.need) return;
  const u = sim.units[a.unitId], r = sim.responders[a.rid];
  if ((u.ammoBox ?? 0) > 0) {
    u.ammoBox = (u.ammoBox ?? 0) - 1;
    refillGuns(sim, a.rid); a.reloadUntil = undefined;
    emit(sim, { inc: s.incidentId, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 0, text: `탄약 보급 완료 (${u.callsign} 탄약 상자 ${u.ammoBox}개).` });
  } else {
    emit(sim, { inc: s.incidentId, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'radio', imp: 1, text: '보급할 탄약이 없습니다.' });
    docRemember(sim, a, rule, '*', 1e9);      // 이 사건 끝까지 (현장 대원은 현장마다 새로 만든다)
  }
  actEnd(sim, a, t);
  k.finish(sim, s, a, true);
}
/** 교본 행동 임무의 계속 점수 (brain 의 "현재 임무 계속" — §4.4 끝). 교본 행동이 아니면 undefined */
export function docContinue(sim: Sim, a: FieldAgent, t: Task): number | undefined {
  if (t.kind === 'pair') return PAIR_P.get(t) ?? 0.62;      // (3단계 §4.4 끝) 짝 동행: 0.5 + 0.4 × 짝 일의 우선도 + 0.12 (runPair 가 적는다)
  if (t.kind === 'cover') return 0.97;      // 교전 지시 0.92·교전 계속 0.94·후퇴 0.95 보다 높게 — 12초 상한과 끝나는 조건으로 스스로 끝난다
  if (t.kind === 'rearm') { const g = gunOf(sim, a.rid); return g !== null && g.ammo !== Infinity && g.ammo <= 2 * g.perShot ? 0.96 : 0.86; }
  return undefined;
}
// (import 를 이 절에 둔 것은 위의 import 묶음을 다른 단계가 함께 고치고 있어서다)
import { emit } from '../events';
import { refillGuns } from '../crews';
import { dist } from '../util';
import { DOCTRINE } from './doctrine/registry';
import type { DocGateAns } from './doctrine/registry';
import { coverSpot } from './doctrine';
import type { DocActId, DocGateId } from '../types';
/** 판단 지점 칸을 손으로 비운다 (지금 동작으로 넘어간 자리 — 막혀 있던 것이 다른 까닭으로 풀렸을 때. 기록의 t1 을 닫는다) */
export function gateClear(sim: Sim, s: Scene, a: FieldAgent, t: Task): void {
  if ((t.gateAt ?? -1) < 0 && t.gateId === undefined) return;
  if (t.docRule !== undefined && t.gateId !== undefined) recordDoc(sim, sim.incidents[s.incidentId], a, t.docRule, 'gate', { gate: t.gateId, tgt: t.hostile >= 0 ? 'h:' + t.hostile : t.workId >= 0 ? 'w:' + t.workId : '' });
  clearGate(t);
}
/** 줄의 짧은 이름 (머리 위 라벨 — 판단 지점에서 기다리는 동안) */
export function ruleShort(id: string | null): string | undefined { const r = ruleById(id); return r !== undefined ? r.short : undefined; }
/** 교본 줄이 막지 않고 갈래만 고른 자리의 기록 (choose — P05 엄폐 사격 자리 · P15 섬광탄 아끼기): 그 줄의 note 를 한 번(같은 대원 20초) 남기고 I.docs 에 한 줄 */
export function docMark(sim: Sim, s: Scene, a: FieldAgent, ruleId: string, hook: DocHook, extra: Partial<Pick<DocUse, 'act' | 'gate' | 'method' | 'work' | 'mate' | 'tgt'>> = {}, noteImp = 1): void {
  const r = ruleById(ruleId);
  if (r === undefined) return;
  recordDoc(sim, sim.incidents[s.incidentId], a, ruleId, hook, extra, docNote(sim, s, a, r, noteImp), r.report !== undefined);
}

// ───────────────────────── (3단계 — 소방) 짝 맺기 · 다시 맺기 · 공기 탈출 · 짝 따라 나가기 · 짝 동행 (§5) ─────────────────────────
// 짝(FieldAgent.buddy)은 작업판의 담당자가 아니다(WorkItem.max 그대로 — §5.4): 작업판에는 한 사람, 몸은 둘. 짝은 이 파일만 맺고(pairUp·rebuddy) 판단부는 읽기만 한다.
import { PAIRS, SOLO_OK, hotSearch, inJob, pairAlt } from './doctrine';
import { ROLES, STAFF, refillAir } from '../crews';
import { roleIdOf } from './gear';
import { staticPass, tileOf } from './grid';
import type { RoleId, Unit } from '../types';
/** 짝을 기록에 싣는 교본 행동 (기록의 mate — 보고서의 {mate}) */
const PAIR_ACTS: ReadonlySet<string> = new Set<string>(['airOut', 'pairOut', 'pair']);
/**
 * 최소 인원 부대인가 (§5.1 — PAIRS 의 min 열을 쓰는 때): 내린 대원 가운데 최소 인원에서 빠지는 자리(STAFF.minDrop)의 역할이 표준 편성보다 적다.
 * u.crew 의 길이를 세지 않는다 — I2 의 결장자(status 'off')가 u.crew 에 남고 예비 인력이 붙으면 u.crew 가 길어지며, 후송된 대원은 내리지 않는다.
 * 내리지 않는 자리(조종사·부기장 — ROLES.stays)는 세지 않는다 (그 자리가 빠져도 짝은 같다)
 */
export function minUnit(kind: Unit['kind'], roles: (RoleId | null)[]): boolean {
  const st = STAFF[kind];
  for (let k = 0; k < st.minDrop.length; k++) {
    const role = st.std[st.minDrop[k]];
    if (ROLES[role] !== undefined && ROLES[role].stays) continue;
    let want = 0, have = 0;
    for (const r of st.std) if (r === role) want++;
    for (const r of roles) if (r === role) have++;
    if (have < want) return true;
  }
  return false;
}
/**
 * 짝 맺기 (§5.1 — sceneManager.unitArrived 가 그 부대의 대원을 내린 뒤 한 번): PAIRS 의 쌍을 순서대로 보며, 그 부대의 이 현장 활동 대원 가운데 아직 짝이 없는 첫째 역할 A 와
 * (다른 사람인) 첫째 역할 B 를 서로 맺는다(a.buddy = b.rid, b.buddy = a.rid). 같은 역할이 둘이면 내린 순서(crew 순서)로 가린다. 한쪽이 없으면 그 쌍은 건너뛴다 —
 * 남은 사람은 −1 이고 다음 판단에 rebuddy 가 본다. 최소 인원 부대는 min 열(minUnit). 기록은 남기지 않는다 (편성에서 바로 나오는 짝이다)
 * 쓰는 법: pairUp(sim, s, u) — 돌려주는 값 없음. 짝을 기억하는 칸은 FieldAgent.buddy 하나(rid, 없으면 -1)
 */
export function pairUp(sim: Sim, s: Scene, u: Unit): void {
  const def = PAIRS[u.kind];
  if (def === undefined) return;
  const mine: FieldAgent[] = [];
  for (const b of s.agents) if (b.unitId === u.id && b.status === 'active' && !b.aloft) mine.push(b);
  if (mine.length < 2) return;
  const roles = mine.map((b) => roleIdOf(sim, b.rid));
  const cols = minUnit(u.kind, roles) ? def.min : def.std;
  for (const [p, q] of cols) {
    let A = -1, B = -1;
    for (let k = 0; k < mine.length && A < 0; k++) if ((mine[k].buddy ?? -1) < 0 && roles[k] === p) A = k;
    if (A < 0) continue;
    for (let k = 0; k < mine.length && B < 0; k++) if (k !== A && (mine[k].buddy ?? -1) < 0 && roles[k] === q) B = k;
    if (B < 0) continue;
    mine[A].buddy = mine[B].rid; mine[B].buddy = mine[A].rid;
  }
}
/** 같은 현장에서 그 rid 의 대원 (상태와 상관없이 — 짝을 잃었는지 본다) */
function agentAt(s: Scene, rid: number, not: FieldAgent): FieldAgent | null {
  let best: FieldAgent | null = null;
  for (let k = 0; k < s.agents.length; k++) { const b = s.agents[k]; if (b === not || b.rid !== rid) continue; if (best === null || (b.status === 'active' && best.status !== 'active')) best = b; }
  return best;
}
/** 짝이 아직 있는가 (활동 중이거나 쓰러져 있다 — 쓰러진 짝은 G04 가 가리키게 두고 다시 맺지 않는다). 떠났거나 물러나 후송을 기다리거나 숨졌으면 잃었다 */
function hasBuddy(sim: Sim, s: Scene, a: FieldAgent): boolean {
  if (a.buddy === undefined || a.buddy < 0) return false;
  const b = agentAt(s, a.buddy, a);
  if (b === null || sim.responders[b.rid].dead) return false;
  return b.status === 'active' || b.status === 'down';
}
/**
 * 짝 다시 맺기 (§5.3 — brain.think 의 무전 다음, 1번(철수·이송 지시) 앞): 짝이 없거나(−1) 짝이 떠났다·물러났다·숨졌으면, 같은 현장의 같은 부서 활동 대원 가운데
 * 혼자 서는 역할이 아니고 짝이 없는(또는 잃은) 가장 가까운 사람(같으면 rid 가 작은 쪽)과 서로 맺는다. 기록 "{mate}, 지금부터 나와 짝이다." (imp 0).
 * 없으면 −1 로 둔다(혼자). 혼자 서는 역할(SOLO_OK)은 하지 않는다. 대원 순서대로 판단하므로 결정적이다. 쓰는 법: rebuddy(sim, s, a)
 */
export function rebuddy(sim: Sim, s: Scene, a: FieldAgent): void {
  if (a.status !== 'active' || a.aloft) return;
  if (hasBuddy(sim, s, a)) return;
  const ro = roleIdOf(sim, a.rid);
  if (ro !== null && SOLO_OK.has(ro)) return;
  const dept = sim.responders[a.rid].dept;
  let best: FieldAgent | null = null, bd = Infinity;
  for (let k = 0; k < s.agents.length; k++) {
    const b = s.agents[k];
    if (b === a || b.status !== 'active' || b.aloft || sim.responders[b.rid].dept !== dept) continue;
    const rb = roleIdOf(sim, b.rid);
    if ((rb !== null && SOLO_OK.has(rb)) || hasBuddy(sim, s, b)) continue;
    const d = dist(a.x, a.y, b.x, b.y);
    if (d < bd || (d === bd && best !== null && b.rid < best.rid)) { bd = d; best = b; }
  }
  if (best === null) { if (a.buddy !== -1) a.buddy = -1; return; }
  a.buddy = best.rid; best.buddy = a.rid;
  const r = sim.responders[a.rid];
  emit(sim, { inc: s.incidentId, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 0, text: `${sim.responders[best.rid].name}, 지금부터 나와 짝이다.` });
}
/** 공기통을 바꾸는 시간 (초 — R1 의 swapAir 와 같다) · 탈출 자리의 연기 문턱 · 출입구 바깥쪽을 찾는 거리 · 짝을 따라가는 거리 · 짝의 위험 실내 일이 끝난 뒤 동행을 잇는 초 · 짝 따라 나가기가 끝나는 연기·출입구 거리 */
export const AIR_OUT_RUN = { swap: 8, clean: 0.1, exitR: 3, follow: 1.4, linger: 3, pairOutClear: 0.25, pairOutExit: 2 } as const;
/** 위험 건물 실내인가 (실행부 — 공기호흡기 없이 들어가지 않는 자리와 같은 판정: 화재·가스·붕괴 현장의 실내, 또는 불이 났다고 아는 실내) */
function hazIndoorAt(s: Scene, a: FieldAgent, x: number, y: number): boolean {
  const rg = s.region[tileOf(s, x, y)];
  return rg >= 0 && s.regions[rg] !== undefined && s.regions[rg].indoor && (s.kind === 'fire' || s.kind === 'hazmat' || s.kind === 'collapse' || (a.beliefs.val<number>('fire', rg) ?? 0) > 0.25);
}
/**
 * 공기 탈출이 나가는 자리 (§5.7 — 처음 한 번): 대기 지점 칸의 연기가 0.1 아래면 거기, 아니면 대원에게 가장 가까운 출입구의 바깥쪽 3칸 안에서 연기 0.1 아래인 첫 칸
 * (실행부라 칸의 연기를 읽는다 — 연기 찬 대기 지점에 서서 공기 탈출이 다시 걸리지 않게). 그런 칸이 없으면 대기 지점
 */
function airOutSpot(s: Scene, a: FieldAgent): { x: number; y: number } {
  const st = s.staging;
  if (s.smoke[tileOf(s, st.x, st.y)] < AIR_OUT_RUN.clean) return { x: st.x, y: st.y };
  let ex = -1, ed = Infinity;
  for (let k = 0; k < s.exits.length; k++) { const e = s.exits[k], d = dist(a.x, a.y, e.x, e.y); if (d < ed) { ed = d; ex = k; } }
  if (ex < 0) return { x: st.x, y: st.y };
  const e = s.exits[ex], R = AIR_OUT_RUN.exitR;
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (let y = Math.max(0, Math.round(e.y) - R); y <= Math.min(s.h - 1, Math.round(e.y) + R); y++) for (let x = Math.max(0, Math.round(e.x) - R); x <= Math.min(s.w - 1, Math.round(e.x) + R); x++) {
    const i = y * s.w + x, d = dist(x, y, e.x, e.y);
    if (d > R || d >= bd || !staticPass(s.tiles[i]) || s.smoke[i] >= AIR_OUT_RUN.clean) continue;
    const rg = s.region[i];
    if (rg >= 0 && s.regions[rg] !== undefined && s.regions[rg].indoor) continue;
    best = { x, y }; bd = d;
  }
  return best ?? { x: st.x, y: st.y };
}
/**
 * 공기 탈출 (TaskKind 'airOut', 라벨 '공기 탈출' — §5.7, F01 의 의무): 나갈 자리(airOutSpot)로 간다(물러나는 길 — 불길도 뚫는다). 닿으면 자기 부대에 예비 공기통이 있으면
 * 8초 교체(R1 swapAir 의 효과 — 공기 가득, 예비 하나, R1 의 교체 문구) 뒤 끝. 예비가 없으면 닿는 순간 끝(그 뒤 F03 이 위험 실내 일을 막고, 지휘관은 CF2 로 부른다).
 * 길이 없으면 1초 뒤 다시 찾고, 여섯 번 넘게 막히면 놓고 15초 동안 다시 걸지 않는다 (후퇴가 이어받는다 — 모든 일은 끝난다)
 */
export function runAirOut(sim: Sim, s: Scene, a: FieldAgent, t: Task, k: ExecKit): void {
  a.label = '공기 탈출';
  if (t.range !== 1) { const p = airOutSpot(s, a); t.tx = p.x; t.ty = p.y; t.range = 1; a.path = null; a.pathGoal = -1; }
  const u = sim.units[a.unitId], r = sim.responders[a.rid];
  if (t.phase === 0) {
    const m = k.moveTo(sim, s, a, t.tx, t.ty, 0.6, false, true);
    if (m === 'moving' || m === 'busy') return;
    if (m === 'nopath') {
      if (++t.fails > 6) { docRemember(sim, a, t.docRule ?? 'F01', '*', 15); actEnd(sim, a, t); k.finish(sim, s, a, false); return; }
      t.wait = 1; return;
    }
    if ((u.spareAir ?? 0) <= 0) { actEnd(sim, a, t); k.finish(sim, s, a, true); return; }
    t.phase = 1; t.progress = 0;
  }
  a.label = '공기통 교체';
  t.progress += sim.dt; a.ring = t.progress / AIR_OUT_RUN.swap;
  if (t.progress + 1e-9 < AIR_OUT_RUN.swap) return;
  if ((u.spareAir ?? 0) > 0) {
    u.spareAir = (u.spareAir ?? 0) - 1; refillAir(sim, a.rid);
    emit(sim, { inc: s.incidentId, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 0, text: `공기통 교체 완료 (${u.callsign} 예비 ${u.spareAir}개).` });
  }
  actEnd(sim, a, t);
  k.finish(sim, s, a, true);
}
/** 짝을 따라가는 걸음 (짝 따라 나가기·짝 동행): 목표는 짝의 지금 자리 — 짝이 1칸 넘게 움직였을 때만 다시 짠다(한 틱에 moveTo 하나 — t.tx·ty 에 담는다) */
function followMate(sim: Sim, s: Scene, a: FieldAgent, t: Task, b: FieldAgent, k: ExecKit, escape: boolean): 'arrived' | 'moving' | 'nopath' | 'busy' {
  if (t.range !== 1 || dist(t.tx, t.ty, b.x, b.y) > 1) { t.tx = b.x; t.ty = b.y; t.range = 1; a.path = null; a.pathGoal = -1; }
  if (dist(a.x, a.y, b.x, b.y) <= AIR_OUT_RUN.follow) return 'arrived';
  return k.moveTo(sim, s, a, t.tx, t.ty, AIR_OUT_RUN.follow, false, escape);
}
/**
 * 짝 따라 나가기 (TaskKind 'pairOut', 라벨 '짝 따라 나감' — §5.7, F02 의 의무): 나가는 짝을 1.4칸 안에서 따라 나온다(물러나는 길).
 * 끝: 위험 실내 밖이고 선 칸의 연기 0.25 아래이며 출입구에서 2칸 넘게 떨어짐 · 짝의 공기 탈출이 끝남 · 짝이 활동 중이 아님(쓰러짐·떠남). 끝나면 그 줄을 10초 다시 걸지 않는다
 */
export function runPairOut(sim: Sim, s: Scene, a: FieldAgent, t: Task, k: ExecKit): void {
  a.label = '짝 따라 나감';
  const b = a.buddy !== undefined && a.buddy >= 0 ? agentAt(s, a.buddy, a) : null;
  const bk: string | null = b !== null && b.task !== null ? b.task.kind : null;
  let ex = Infinity;
  for (let q = 0; q < s.exits.length; q++) ex = Math.min(ex, dist(a.x, a.y, s.exits[q].x, s.exits[q].y));
  const outside = !hazIndoorAt(s, a, a.x, a.y) && s.smoke[tileOf(s, a.x, a.y)] < AIR_OUT_RUN.pairOutClear && ex > AIR_OUT_RUN.pairOutExit;
  const mateDone = b === null || (b.status !== 'active' && b.status !== 'withdrawn') || (b.status === 'active' && bk !== 'airOut' && bk !== 'retreat' && bk !== 'evacuate');
  if (outside || mateDone) { docRemember(sim, a, t.docRule ?? 'F02', '*', 10); actEnd(sim, a, t); k.finish(sim, s, a, true); return; }
  const m = followMate(sim, s, a, t, b!, k, true);
  if (m === 'nopath') { t.wait = 1; t.range = 0; }
}
/** 짝 동행 임무의 계속 점수 (docContinue — 짝 일의 우선도로 runPair 가 적는다) */
const PAIR_P = new WeakMap<Task, number>();
/** 짝의 일이 위험 실내 일이었던 마지막 시각 (짝 동행 — 방을 옮기는 사이에 끊기지 않게 3초를 잇는다) */
const PAIR_HZ = new WeakMap<Task, number>();
/**
 * 짝 동행 (TaskKind 'pair', 라벨 '짝 동행' — §5.4, G08): 위험 실내 일(또는 확보 전 무장 현장의 수색)을 맡은 짝을 1.4칸 안에서 따라간다. 관찰은 perceive 가 한다(둘이 본 것이 모두 보고된다).
 * 끝: 짝이 활동 중이 아님(쓰러지면 G04 의 동료 구조가 먼저 잡힌다) · 짝이 업고 나가면 그 뒤를 따라 나와 둘 다 위험 실내 밖에 닿았을 때 · 짝의 임무가 위험 실내 일이 아니게 된 뒤 3초
 * (방 하나의 수색이 끝나 다음 방을 받는 사이에 끊지 않는다). 계속 점수 0.5 + 0.4 × 짝 일의 우선도 + 0.12
 */
export function runPair(sim: Sim, s: Scene, a: FieldAgent, t: Task, k: ExecKit): void {
  a.label = '짝 동행';
  const b = a.buddy !== undefined && a.buddy >= 0 ? agentAt(s, a.buddy, a) : null;
  if (b === null || b.status !== 'active') { actEnd(sim, a, t); k.finish(sim, s, a, true); return; }
  if (!PAIR_HZ.has(t)) PAIR_HZ.set(t, sim.t);
  const bw = b.task !== null && b.task.workId >= 0 ? s.board[b.task.workId] : undefined;
  if (bw !== undefined && (bw.status === 'open' || bw.status === 'active') && (inJob(sim, s, a, bw, b.task) || hotSearch(s, bw))) { PAIR_HZ.set(t, sim.t); PAIR_P.set(t, 0.5 + 0.4 * bw.priority + 0.12); }
  if (b.carrying !== -1) { if (!hazIndoorAt(s, a, a.x, a.y) && !hazIndoorAt(s, b, b.x, b.y)) { actEnd(sim, a, t); k.finish(sim, s, a, true); return; } }
  else if (sim.t - (PAIR_HZ.get(t) ?? sim.t) > AIR_OUT_RUN.linger) { actEnd(sim, a, t); k.finish(sim, s, a, true); return; }
  // (3단계 — 측정이 찾은 것) 짝 곁에 내가 맡을 빈 위험 실내 일(짝의 진압에 남은 자리 포함)이 생기면 따라가기를 끝낸다 — 다음 판단에 그 일을 맡는다(G08 은 alt 로 다시 걸리지 않는다)
  if (bw !== undefined && b.carrying === -1 && (sim.tick + a.rid) % 5 === 0 && pairAlt(sim, s, a, bw)) { actEnd(sim, a, t); k.finish(sim, s, a, true); return; }
  const m = followMate(sim, s, a, t, b, k, false);
  if (m === 'nopath') { t.wait = 1; t.range = 0; }
  else if (m === 'arrived') { a.fx = b.x - a.x; a.fy = b.y - a.y; if (bw !== undefined && b.task !== null) pairHelp(sim, s, a, b, b.task, bw.kind, k); }
}
/** 짝 동행이 짝의 진압을 거드는 거리 (짝의 화점에서 — 실내 진압의 분사 거리 3.2 + 따라가는 거리 1.4 + 여유. 3.2 로는 뒤에 선 짝이 거의 닿지 않았다 — 3단계 측정) */
const HELP_SPRAY = 4.8;
/**
 * (3단계 — 본문 밖, 측정이 찾은 것) 짝 동행은 짝의 일을 거든다 — 2인 진입은 한 사람이 일을 맡고 둘이 함께 한다(작업판의 담당자는 한 사람 그대로 — §5.4).
 *   진압: 관창을 들었고 부대의 물·펌프가 되면 짝이 겨눈 화점에 함께 분사한다(물줄기 그림을 흩뜨리지 않는다 — s.rng 를 쓰지 않는다)
 *   수색: 짝 동행이 본 칸(탐지 반경·시야)을 짝의 수색 확인에 더한다 (발견은 지금처럼 perceive 가 한다)
 * 그러지 않으면 짝을 따라 들어간 대원이 손을 놓아 실내의 손이 절반이 된다 (3단계 측정 — 강제 fire/std 의 성공이 크게 줄었다)
 */
function pairHelp(sim: Sim, s: Scene, a: FieldAgent, b: FieldAgent, bt: Task, kind: WorkKind, k: ExecKit): void {
  if (kind === 'suppress' && bt.phase === 2 && bt.tile >= 0 && s.fire[bt.tile] > 0.05 && kitHas(sim, a.rid, 'hose')) {
    const u = sim.units[a.unitId];
    if (u.pumpFailed || (u.water <= 0 && !u.hydrant)) return;
    const tx = bt.tile % s.w, ty = (bt.tile / s.w) | 0;
    if (dist(a.x, a.y, tx, ty) > HELP_SPRAY || !los(s, a.x, a.y, tx, ty)) return;
    a.fx = tx - a.x; a.fy = ty - a.y; a.label = '짝 동행 — 함께 방수';
    k.spray(sim, s, a, tx, ty, bt.method === 'pulse' ? 0.85 : 1, bt.method === 'pulse' ? 0.65 : 1, false);
    return;
  }
  if (kind === 'search' && bt.covered && bt.region >= 0 && s.regions[bt.region] !== undefined) {
    const reg = s.regions[bt.region], rr = detectRadius(sim, s, a, 0.45);
    for (const i of reg.tiles) { if (bt.covered.has(i)) continue; const x = i % s.w, y = (i / s.w) | 0; if (dist(a.x, a.y, x, y) <= rr && los(s, a.x, a.y, x, y)) bt.covered.add(i); }
  }
}
import { detectRadius } from './agents';
import { los } from './grid';
