// AI Incident Analyst — 신고 접수 AI 가 모은 진술만으로 사건 유형·위험도·필요 자원을 추정한다.
// 입력(진술)이 틀리거나 부족하면 결론도 틀린다. 새 정보가 들어오면 평가를 다시 한다.

import type { Sim } from '../engine';
import { emit } from '../events';
import type { Assessment, Claim, Incident, IncidentType, Needs, Topic } from '../types';
import { TYPE_NAME, clamp } from '../util';
import { NATURE_LIK } from './callSystem';
import { recomputeUnmet } from './dispatcher';

const TYPES: IncidentType[] = ['fire', 'traffic', 'search', 'armed'];
export const sevName = (s: number): string => (s < 1.7 ? '보통' : s < 2.4 ? '높음' : '매우 높음');
const NEED_NAME: Record<keyof Needs, string> = { suppression: '진압', rescue: '구조', ems: '구급', law: '경찰', tactical: '경찰 기동', search: '수색', traffic: '교통 통제' };
export const needsText = (n: Partial<Needs>): string => {
  const out: string[] = [];
  for (const k of Object.keys(NEED_NAME) as (keyof Needs)[]) if ((n[k] ?? 0) > 0) out.push(`${NEED_NAME[k]} ${n[k]}`);
  return out.length ? out.join(', ') : '없음';
};
export const emptyNeeds = (): Needs => ({ suppression: 0, rescue: 0, ems: 0, law: 0, tactical: 0, search: 0, traffic: 0 });

/** 주제별로 가장 "안전한 쪽(더 심각한 쪽)"의 진술을 고른다. 충돌 여부도 돌려준다. */
function pick(claims: Claim[], topic: Topic): { c: Claim | null; conflict: boolean } {
  const list = claims.filter((c) => c.topic === topic);
  if (!list.length) return { c: null, conflict: false };
  let conflict = false;
  for (let i = 1; i < list.length; i++) if (JSON.stringify(list[i].value) !== JSON.stringify(list[0].value)) conflict = true;
  if (!conflict) return { c: list[list.length - 1], conflict };
  const rank = (c: Claim): number => {
    if (typeof c.value === 'boolean') return c.value ? 1 : 0;
    if (typeof c.value === 'number') return c.value;
    if (c.value === 'gun') return 3; if (c.value === 'knife') return 2;
    return 1;
  };
  let best = list[0];
  for (const c of list) if (rank(c) > rank(best) || (rank(c) === rank(best) && c.conf > best.conf)) best = c;
  return { c: best, conflict };
}

export function assess(sim: Sim, I: Incident, trigger: string): void {
  const claims = I.claims;
  const prev = I.assessment;
  // ── 유형 추정 ──
  const lp = [0, 0, 0, 0];
  let nNature = 0;
  for (const c of claims) {
    if (c.topic === 'nature') { const lik = NATURE_LIK[c.value as string]; if (lik) { nNature++; for (let k = 0; k < 4; k++) lp[k] += Math.log(lik[k]) * (0.5 + c.conf); } }
    if (c.topic === 'weapon' && c.value !== 'none') lp[3] += 1.5 * c.conf;
    if (c.topic === 'detail' && c.value && c.value.ejected) lp[1] += 1.0;
  }
  let mx = Math.max(...lp), sum = 0;
  const probsArr = lp.map((v) => { const e = Math.exp(v - mx); sum += e; return e; });
  const probs = { fire: probsArr[0] / sum, traffic: probsArr[1] / sum, search: probsArr[2] / sum, armed: probsArr[3] / sum } as Record<IncidentType, number>;
  let type: IncidentType = 'fire', best = -1;
  for (const t of TYPES) if (probs[t] > best) { best = probs[t]; type = t; }
  let typeConf = nNature ? best : 0.25;
  if (I.fieldType) { type = I.fieldType; typeConf = 1; }

  // ── 위험도 ──
  const inj = pick(claims, 'injured'), cnt = pick(claims, 'count'), trap = pick(claims, 'trapped'), haz = pick(claims, 'hazard'), wpn = pick(claims, 'weapon'), det = pick(claims, 'detail');
  const nat = claims.filter((c) => c.topic === 'nature').map((c) => c.value as string);
  const why: string[] = [];
  const risks: string[] = [];
  let sev = 1.3;
  const count = cnt.c && typeof cnt.c.value === 'number' ? cnt.c.value : -1;
  const district = sim.city.nodes[I.truth.nodeId].district;     // 위치는 신고로 확인된 정보
  if (type === 'fire') {
    sev = 1.4;
    if (nat.indexOf('flames') >= 0) { sev += 0.45; why.push('화염 목격'); }
    if (nat.indexOf('smell') >= 0 && nat.indexOf('flames') < 0) { sev -= 0.4; why.push('타는 냄새만 신고'); }
    if (nat.indexOf('explosion') >= 0) { sev += 0.3; why.push('폭발음'); }
    if (trap.c && trap.c.value === true) { sev += 0.6 * (0.5 + trap.c.conf * 0.6); why.push('내부 잔류 인원'); }
    if (count >= 3) { sev += 0.35; why.push(`${count}명`); }
    if (haz.c && haz.c.value === 'spreading') { sev += 0.45; why.push('연소 확대'); }
    if (haz.c && haz.c.value === 'gas') { sev += 0.4; why.push('가스 용기'); risks.push('폭발 위험'); }
    if (district === 'industrial') { sev += 0.2; risks.push('산업 구역 — 위험물 보관 가능성'); }
  } else if (type === 'traffic') {
    sev = 1.2;
    if (inj.c && inj.c.value === true) { sev += 0.5; why.push('부상자'); }
    if (trap.c && trap.c.value === true) { sev += 0.7; why.push('차량 내 고립'); }
    if (count >= 3) { sev += 0.4; why.push(`부상 ${count}명`); }
    if (haz.c && haz.c.value === 'leak') { sev += 0.4; why.push('연료 누출'); risks.push('차량 화재 위험'); }
    if (haz.c && haz.c.value === 'lanes') { risks.push('2차 사고 위험'); }
    if (det.c && det.c.value && det.c.value.ejected) { sev += 0.3; why.push('차외 방출'); }
    if (nat.indexOf('explosion') >= 0) { sev += 0.3; }
  } else if (type === 'search') {
    sev = 1.35;
    if (inj.c && inj.c.value === true) { sev += 0.5; why.push('대상 부상 가능'); }
    if (count >= 2) { sev += 0.3; why.push(`${count}명`); }
    if (sim.weather === 'night') { sev += 0.35; why.push('야간'); risks.push('저체온·시야 불량'); }
    else if (sim.weather !== 'clear') { sev += 0.25; why.push('악천후'); risks.push('시야 불량'); }
  } else {
    sev = 1.2;
    if (wpn.c && wpn.c.value === 'gun') { sev += 0.9 * (0.5 + wpn.c.conf * 0.6); why.push('총기'); }
    else if (wpn.c && wpn.c.value === 'knife') { sev += 0.35; why.push('흉기'); }
    if (nat.indexOf('gunshots') >= 0) { sev += 0.6; why.push('총성'); }
    if (nat.indexOf('robbery') >= 0) { sev += 0.4; why.push('강도'); }
    if (inj.c && inj.c.value === true) { sev += 0.45; why.push('부상자'); }
    if (trap.c && trap.c.value === true) { sev += 0.3; why.push('내부 시민'); risks.push('인질 위험'); }
    if (det.c && det.c.value && det.c.value.suspects >= 2) { sev += 0.3; why.push(`용의자 ${det.c.value.suspects}명`); }
  }
  sev = clamp(sev, 1, 3);
  const conflicts = [inj, cnt, trap, haz, wpn].filter((x) => x.conflict).length;
  let confSum = 0; for (const c of claims) confSum += c.conf;
  const callers = new Set(claims.map((c) => c.callId)).size;
  const confidence = clamp((claims.length ? confSum / claims.length : 0.3) * (0.75 + 0.12 * callers) * (1 - 0.12 * conflicts) * (0.5 + 0.5 * typeConf), 0.1, 0.98);
  if (I.fieldType) why.push('현장 확인');

  // ── 필요 자원 ──
  const needs = emptyNeeds();
  const hurt = (inj.c && inj.c.value === true) || (trap.c && trap.c.value === true) || count >= 1;
  if (type === 'fire') {
    needs.suppression = sev >= 2.4 ? 2 : 1;
    if (sev < 2.4 && trap.c && trap.c.value === true) needs.rescue = 1;
    if (sev >= 1.7 && hurt) needs.ems = 1;
    if (sev >= 2.75) needs.ems = Math.max(needs.ems, 1);
  } else if (type === 'traffic') {
    needs.traffic = 1;
    if (sev >= 1.7 || hurt) needs.ems = sev >= 2.5 ? 2 : 1;
    if ((trap.c && trap.c.value === true) || sev >= 2.4 || (haz.c && haz.c.value === 'leak')) needs.rescue = 1;
  } else if (type === 'search') {
    needs.search = sev >= 1.7 ? 2 : 1;
    if (sev >= 2.2) needs.ems = 1;
  } else {
    needs.law = sev >= 1.7 ? 2 : 1;
    if (sev >= 2.4) { needs.law = 1; needs.tactical = 1; }
    if (sev >= 2.2 || (inj.c && inj.c.value === true)) needs.ems = 1;
  }
  const rev = prev ? prev.revision + 1 : 0;
  const summary = `${TYPE_NAME[type]} (${Math.round(typeConf * 100)}%) · 위험도 ${sevName(sev)}`;
  const as: Assessment = { type, typeConf, probs, severity: sev, confidence, needs, risks, summary, t: sim.t, revision: rev };
  I.assessment = as;

  // ── 기록: 처음이거나 실질적으로 달라졌을 때만 ──
  const basis = why.length ? ` 근거: ${why.join(', ')}.` : '';
  const uncertain = confidence < 0.5 ? ' 정보 신뢰도 낮음 — 불확실.' : '';
  if (!prev) {
    emit(sim, { inc: I.id, role: 'ANALYST', actor: '상황 분석 AI', kind: 'assess', imp: 2, causes: [I.lastEvent], text: `${TYPE_NAME[type]} 가능성 ${Math.round(typeConf * 100)}%로 판단. 위험도: ${sevName(sev)}.${basis}${uncertain}` });
  } else if (prev.type !== type) {
    emit(sim, { inc: I.id, role: 'ANALYST', actor: '상황 분석 AI', kind: 'assess', imp: 3, causes: [I.lastEvent], text: `사건 유형 판단 수정: ${TYPE_NAME[prev.type]} → ${TYPE_NAME[type]} (${trigger}). 위험도: ${sevName(sev)}.${basis}` });
  } else if (sevName(prev.severity) !== sevName(sev)) {
    emit(sim, { inc: I.id, role: 'ANALYST', actor: '상황 분석 AI', kind: 'assess', imp: 2, causes: [I.lastEvent], text: `위험도 평가 수정: ${sevName(prev.severity)} → ${sevName(sev)} (${trigger}).${basis}` });
  } else if (risks.length > prev.risks.length) {
    emit(sim, { inc: I.id, role: 'ANALYST', actor: '상황 분석 AI', kind: 'assess', imp: 1, causes: [I.lastEvent], text: `추가 위험 예측: ${risks[risks.length - 1]}.` });
  }
  // 첫 부대가 도착하기 전까지의 판단을 "관제의 사전 판단"으로 남긴다(사후 분석용)
  if (I.firstAssess && I.firstArrivalAt < 0 && !I.fieldType) { I.firstAssess.type = type; I.firstAssess.severity = sev; }
  if (!I.fieldVerified) recomputeUnmet(sim, I);
}
