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
  const hostile = a.task !== null && a.task.hostile >= 0 ? a.task.hostile : -1;      // (2단계) 하던 임무의 용의자 — 엄폐가 그 위협을 본다 (P16 의 협상 상대)
  if (a.task) k.finish(sim, s, a, false, 'preempt');
  const t = k.makeTask(pick.act as string as TaskKind, ACT_LABEL[pick.act] ?? pick.rule.short);      // TaskKind 에는 그 행동을 쓰는 단계가 이름을 더한다 (2단계 cover·rearm, 3단계 airOut·pairOut·pair)
  t.startedAt = sim.t; t.docRule = pick.rule.id; t.hostile = hostile;
  a.task = t;
  a.doc = { rule: pick.rule.id, act: pick.act, since: sim.t };
  splitBegin(sim, s, a, was);
  const I = sim.incidents[s.incidentId];
  ACT_DOC.set(t, recordDoc(sim, I, a, pick.rule.id, pick.rule.hook, { act: pick.act, tgt: hostile >= 0 ? 'h:' + hostile : '' }, docNote(sim, s, a, pick.rule), pick.rule.report !== undefined));
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
