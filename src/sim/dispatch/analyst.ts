// AI Incident Analyst — 신고 접수 AI 가 모은 진술만으로 사건 유형·위험도·필요 자원을 추정한다.
// 입력(진술)이 틀리거나 부족하면 결론도 틀린다. 새 정보가 들어오면 평가를 다시 한다.

import type { Sim } from '../engine';
import { emit } from '../events';
import { INCIDENT_PLACES } from '../cityPlan';
import { SCENARIOS, natureLabel } from '../scenarios';
import type { Assessment, Claim, Incident, IncidentType, Needs, PlaceKind, Topic } from '../types';
import { TYPE_NAME, clamp } from '../util';
import { NATURE_LIK } from './callSystem';
import { TYPE_DEFS, TYPE_ORDER, likRow, typeIdx } from '../incidentTypes';
import { recomputeUnmet } from './dispatcher';
import { docNeeds } from './doctrine';      // (R3 §6.2) 관제 교본의 수요 보정 (D1·D3·D6·D8)
import { recordDoc } from '../field/doctrineRun';

const TYPES = TYPE_ORDER;      // 가설의 순서 = likRow 의 열 순서 (incidentTypes.TYPE_ORDER — 새 유형은 끝에만)
export const sevName = (s: number): string => (s < 1.7 ? '보통' : s < 2.4 ? '높음' : '매우 높음');
const NEED_NAME: Record<keyof Needs, string> = { suppression: '진압', rescue: '구조', ems: '구급', law: '경찰', tactical: '경찰 기동', search: '수색', traffic: '교통 통제', eod: '폭발물 처리',
  utilPower: '전력 복구', utilGas: '가스 복구', utilWater: '수도 복구', tow: '견인', capture: '동물 포획', decon: '제독' };      // (N8 §5.3.5) · (N9 §5.3.1)
export const needsText = (n: Partial<Needs>): string => {
  const out: string[] = [];
  for (const k of Object.keys(NEED_NAME) as (keyof Needs)[]) if ((n[k] ?? 0) > 0) out.push(`${NEED_NAME[k]} ${n[k]}`);
  return out.length ? out.join(', ') : '없음';
};
export const emptyNeeds = (): Needs => ({ suppression: 0, rescue: 0, ems: 0, law: 0, tactical: 0, search: 0, traffic: 0, eod: 0, utilPower: 0, utilGas: 0, utilWater: 0, tow: 0, capture: 0, decon: 0 });

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

/** 그 종류의 건물에서 그 유형의 사건이 날 법한 정도 (지도에서 누구나 알 수 있는 사실만 쓴다) */
function placePrior(kind: PlaceKind | 'intersection', type: IncidentType): number {
  if (kind === 'intersection') return TYPE_DEFS[type].atNode;
  if (type === 'traffic') return 0.6;
  return (INCIDENT_PLACES[type][kind] ?? 0) > 0 ? 1.2 : 0.5;
}

export function assess(sim: Sim, I: Incident, trigger: string): void {
  const claims = I.claims;
  const prev = I.assessment;
  // ── 유형 추정 ──
  const lp = TYPES.map(() => 0);
  let nNature = 0, placeUsed = false;
  for (const c of claims) {
    if (c.topic === 'nature') { const m = NATURE_LIK[c.value as string]; if (m) { const lik = likRow(m); nNature++; for (let k = 0; k < TYPES.length; k++) lp[k] += Math.log(lik[k]) * (0.5 + c.conf); } }
    if (c.topic === 'weapon' && c.value !== 'none') lp[typeIdx.armed] += 1.5 * c.conf;
    // 지도 정보: 신고된 곳이 어떤 건물인지에 따라 있을 법한 유형이 달라진다 (하천이면 수난, 교차로면 교통사고)
    if (c.topic === 'location' && c.placeKind && !placeUsed) { placeUsed = true; for (let k = 0; k < TYPES.length; k++) lp[k] += Math.log(placePrior(c.placeKind, TYPES[k])) * 0.6; }
    if (c.topic === 'detail' && c.value && c.value.ejected) lp[typeIdx.traffic] += 1.0;
  }
  let mx = Math.max(...lp), sum = 0;
  const probsArr = lp.map((v) => { const e = Math.exp(v - mx); sum += e; return e; });
  const probs = {} as Record<IncidentType, number>;
  TYPES.forEach((t, k) => { probs[t] = probsArr[k] / sum; });
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
  const district = sim.city.nodes[I.reportedNode].district;     // 신고로 알게 된 위치
  const prank = claims.some((c) => c.topic === 'hazard' && c.value === 'prank');
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
    if (count >= 6) { sev += 0.4; why.push('다수 사상자'); }
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
  } else if (type === 'water') {
    sev = 1.7;
    if (nat.indexOf('drowning') >= 0) { sev += 0.35; why.push('익수 목격'); }
    if (trap.c && trap.c.value === true) { sev += 0.45 * (0.5 + trap.c.conf * 0.6); why.push('아직 물속'); }
    if (count >= 2) { sev += 0.3; why.push(`${count}명`); }
    if (haz.c && haz.c.value === 'current') { sev += 0.25; why.push('센 물살'); risks.push('떠내려가 시야에서 벗어날 위험'); }
    if (sim.weather === 'night' || sim.weather === 'rain') { sev += 0.2; why.push(sim.weather === 'night' ? '야간' : '우천'); }
  } else if (type === 'collapse') {
    sev = 1.6;
    if (nat.indexOf('collapse') >= 0) { sev += 0.4; why.push('붕괴 목격'); }
    if (trap.c && trap.c.value === true) { sev += 0.6 * (0.5 + trap.c.conf * 0.6); why.push('매몰자'); }
    if (count >= 3) { sev += 0.35; why.push(`${count}명`); }
    if (inj.c && inj.c.value === true) { sev += 0.2; why.push('부상자'); }
    if (haz.c && haz.c.value === 'unstable') { sev += 0.3; why.push('추가 붕괴 조짐'); risks.push('2차 붕괴 위험'); }
  } else if (type === 'hazmat') {
    sev = 1.5;
    if (nat.indexOf('gasleak') >= 0) { sev += 0.35; why.push('가스 누출 확인'); }
    if (trap.c && trap.c.value === true) { sev += 0.5 * (0.5 + trap.c.conf * 0.6); why.push('내부 잔류 인원'); }
    if (count >= 3) { sev += 0.3; why.push(`${count}명`); }
    if (inj.c && inj.c.value === true) { sev += 0.25; why.push('쓰러진 사람'); }
    if (haz.c && haz.c.value === 'gas') { sev += 0.3; why.push('누출 지속'); risks.push('폭발 위험'); }
    if (district === 'industrial') { sev += 0.2; risks.push('산업 구역 — 대량 누출 가능성'); }
  } else if (type === 'medical') {
    sev = 1.4;
    const notBreathing = nat.indexOf('notbreathing') >= 0 || (det.c && det.c.value && det.c.value.breathing === false);
    if (notBreathing) { sev += 1.1; why.push('호흡 없음'); risks.push('심정지 — 분 단위로 악화'); }
    else if (nat.indexOf('fall') >= 0) { sev += 0.5; why.push('낙상·출혈'); }
    if (inj.c && inj.c.value === true) { sev += 0.35; why.push('의식 없음'); }
  } else {
    sev = 1.2;
    if (wpn.c && wpn.c.value === 'gun') { sev += 0.9 * (0.5 + wpn.c.conf * 0.6); why.push('총기'); }
    else if (wpn.c && wpn.c.value === 'knife') { sev += 0.35; why.push('흉기'); }
    if (nat.indexOf('gunshots') >= 0) { sev += 0.6; why.push('총성'); }
    if (nat.indexOf('robbery') >= 0) { sev += 0.4; why.push('강도'); }
    if (nat.indexOf('hostage') >= 0) { sev += 0.9; why.push('인질'); risks.push('인질 위험'); }
    if (prank) { sev -= 0.9; why.push('허위 신고 의심'); risks.push('허위 신고 가능성 — 확인 출동'); }
    if (inj.c && inj.c.value === true) { sev += 0.45; why.push('부상자'); }
    if (trap.c && trap.c.value === true) { sev += 0.3; why.push('내부 시민'); risks.push('인질 위험'); }
    if (det.c && det.c.value && det.c.value.suspects >= 2) { sev += 0.3; why.push(`용의자 ${det.c.value.suspects}명`); }
  }
  sev = clamp(sev, 1, 3);
  if (type === 'collapse' && nat.indexOf('elevator') >= 0 && nat.indexOf('collapse') < 0) sev = Math.min(sev, 1.8);      // 승강기가 멈춘 것이지 건물이 무너진 것은 아니다
  // (X6 §5.9) 현장 상황 보고로 올린 위험도와 위험은 새 신고 진술로 다시 평가해도 지워지지 않는다 (I.fieldType 과 같은 방식)
  if (I.fieldRisk) { sev = Math.max(sev, I.fieldRisk.sev); for (const r of I.fieldRisk.risks) if (risks.indexOf(r) < 0) risks.push(r); }
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
    if ((sev >= 1.7 && hurt) || sev >= 2.1) needs.ems = 1;
  } else if (type === 'traffic') {
    needs.traffic = 1;
    needs.ems = sev >= 2.4 || count >= 3 ? 2 : 1;      // 충돌 사고에는 부상자가 있다고 보고 구급을 먼저 보낸다
    if (count >= 6) { needs.ems = 3; needs.rescue = 1; risks.push('다수 사상자 — 구급 부대가 여러 대 필요'); }
    if ((trap.c && trap.c.value === true) || sev >= 2.0 || (haz.c && haz.c.value === 'leak')) needs.rescue = 1;
  } else if (type === 'search') {
    needs.search = 2;
    if (sev >= 1.6 || (inj.c && inj.c.value === true)) needs.ems = 1;      // 찾은 뒤에는 대개 처치와 이송이 필요하다
  } else if (type === 'water') {
    needs.rescue = 1; needs.ems = 1;
    if (sev >= 2.1) needs.search = 1;      // 물가를 따라 살필 일손
  } else if (type === 'collapse') {
    needs.rescue = 1;
    if (sev >= 2.0) needs.suppression = 1;      // 잔해를 치우고 사람을 옮길 일손
    needs.ems = sev >= 2.5 ? 2 : 1;
  } else if (type === 'hazmat') {
    needs.suppression = 1;
    if (sev >= 2.1 || (trap.c && trap.c.value === true)) needs.rescue = 1;
    if (sev >= 1.9 || hurt) needs.ems = 1;
    if (sev >= 1.8) needs.law = 1;      // 주변 통제
  } else if (type === 'medical') {
    needs.ems = 1;
    if (sev >= 2.3) needs.search = 1;      // 가장 가까운 부대를 선착 대응으로 함께 보낸다 (누구든 가슴 압박은 할 수 있다)
  } else {
    needs.law = sev >= 1.7 ? 2 : 1;
    if (sev >= 2.4) { needs.law = 1; needs.tactical = 1; }
    if (sev >= 1.9 || (inj.c && inj.c.value === true) || nat.indexOf('gunshots') >= 0) needs.ems = 1;
  }
  if (type === 'armed' && prank) { needs.law = 1; needs.tactical = 0; needs.ems = 0; }
  // 신고 내용이 시나리오를 가리키면 그에 맞춰 보낸다 (scenarios/*.ts 의 needs)
  const ctx = { sev, hurt: !!(inj.c && inj.c.value === true), trapped: !!(trap.c && trap.c.value === true), nat };
  for (const sc of SCENARIOS) if (sc.needs && sc.type === type && nat.indexOf(sc.nature) >= 0) sc.needs(needs, ctx);
  let label: string | undefined;
  for (const c of claims) { if (c.topic !== 'nature') continue; const l = natureLabel(c.value as string, type); if (l) label = l; }
  // (R3 §6.2) 관제 교본의 수요 보정 — D3(흉기 신고 경찰 둘)·D6(인질극 기동대 둘). 장난 전화로 본 신고에는 걸지 않는다
  // (균형) D8 은 위치 신고의 건물 종류를 본다 — 유형 추정에 쓴 것과 같은 첫 위치 신고
  let place: Claim['placeKind'];
  for (const c of claims) if (c.topic === 'location' && c.placeKind) { place = c.placeKind; break; }
  if (!(type === 'armed' && prank)) for (const rule of docNeeds(sim, type, sev, !!(wpn.c && wpn.c.value === 'knife'), label, needs, place, I)) recordDoc(sim, I, null, rule, 'dispatch');
  const rev = prev ? prev.revision + 1 : 0;
  const summary = `${TYPE_NAME[type]} (${Math.round(typeConf * 100)}%) · 위험도 ${sevName(sev)}`;
  const as: Assessment = { type, typeConf, probs, severity: sev, confidence, needs, risks, summary, t: sim.t, revision: rev, label };
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
