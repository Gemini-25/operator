// 대응 방법의 보고서 문장과 집계 (docs/specs/R2-methods.md §3.8). debrief.ts 가 부른다 — 판정과 같은 자격이라 진실(구조 대상의 이름표)을 읽어도 된다.
// 재료는 기록된 것뿐이다: I.methods 의 칸(method·why·missing·rid·unitId·대상)과 Problem. 보고서를 쓸 때 방법을 다시 계산하지 않는다.
// (debrief.ts 는 여러 묶음이 함께 고치는 파일이라, 방법의 문장은 이 파일에 두고 debrief.ts 에는 부르는 줄만 넣었다.)

import type { Sim } from '../engine';
import type { Incident, MethodId, MethodUse, Problem, Scene, WorkKind } from '../types';
import { josa } from '../util';
import { kitName } from './gear';
import { METHOD, METHOD_ORDER, targetKey } from './methods';

/** "○○ 대원이 <방법의 noun> <여기>" — 임무별 맺음말 */
export const WORK_DONE: Partial<Record<WorkKind, string>> = {
  force: '문을 열었습니다', clear: '잔해를 치웠습니다', extricate: '구출했습니다', suppress: '불길을 잡았습니다', engage: '제압했습니다', arrest: '검거했습니다',
  mitigate: '누출을 막았습니다', search: '찾아냈습니다', treat: '처치했습니다', perimeter: '주변에 대피를 알렸습니다', load: '환자를 이송했습니다', hoist: '끌어올려 구했습니다',
};
/** 까닭 말 (괄호 안). 평소 선택·가까움·바꾼 까닭(실패·고장)은 붙이지 않는다. 빠진 장비를 모르면 noGear 말도 붙이지 않는다 */
export function whyText(u: MethodUse): string {
  switch (u.why) {
    case 'noGear': return u.missing ? `${josa(kitName(u.missing), '이/가')} 없었음` : '';
    case 'weak': return '줄을 잡을 힘이 없었음';
    case 'fast': return '물살이 빨랐음';
    case 'tooFar': return '던져서 닿지 않는 거리였음';
    case 'danger': return '추가 위험이 있었음';
    case 'quiet': return '용의자에게 들키지 않으려';
    case 'team': return '동료와 짝을 이뤄';
    case 'hurt': return '다쳐서';      // (R3 §7.3 WHY_DOC 의 말) 교본 줄이 1등을 바꾼 까닭 여섯
    case 'alone': return '혼자였음';
    case 'lowAir': return '공기가 부족해';
    case 'lowAmmo': return '탄약이 떨어져';
    case 'shaken': return '동요해';
    case 'tired': return '지쳐서';
    default: return '';
  }
}
/** METHOD_FAIL 의 문장: 횟수는 times 의 합 (같은 대상에서 되풀이된 실패는 문제 하나에 쌓인다) */
export function methodFailLine(ps: Problem[]): string {
  let n = 0;
  for (const p of ps) n += p.times ?? 1;
  return `대응 방법이 ${n}차례 막혔습니다 (${ps[0].detail})${ps[0].recovered ? ` — ${ps[0].recoveryText}` : ''}.`;
}
/**
 * 평소와 다른 방법으로 끝낸 것을 말하는 문장 (최대 max 개, 기록 순서).
 * I.methods 의 ok 줄 가운데 평소 방법(plain)이 아닌 것 — 같은 대상에 앞선 실패(문제를 남긴 접은 줄)가 있으면 뺀다(그 이야기는 문제 문장의 복구 문구가 한다).
 *   수난 구조: "구조 대상 A는 이서준 대원이 헤엄쳐 들어가 구했습니다 (구조 로프가 없었음)."   호이스트: "구조 대상 B는 헬기1이 호이스트로 끌어올려 구했습니다."
 *   그 밖:     "윤다온 대원이 폭파 장약으로 문을 열었습니다."
 */
export function methodLines(sim: Sim, I: Incident, s: Scene, max = 2): string[] {
  const out: string[] = [];
  const ms = I.methods;
  if (!ms || !ms.length) return out;
  const failed = new Set<string>();      // 문제를 남긴 접은 줄이 있던 대상
  for (const u of ms) {
    const key = targetKey(u.work, u);
    if (!u.ok) { if (u.eventId >= 0 && I.problems.some((p) => p.eventId === u.eventId && (p.code === 'METHOD_FAIL' || p.code === 'EQUIP_FAIL'))) failed.add(key); continue; }
    const d = METHOD[u.method];
    if (d.plain || failed.has(key) || out.length >= max) continue;
    // 호이스트는 임무 종류가 달라 열쇠가 다르다: 같은 구조 대상의 지상 수난 구조가 막혔었다면 그쪽 문제 문장이 말한다
    if (u.work === 'hoist' && failed.has(targetKey('waterRescue', u))) continue;
    // (단계 3) 수색은 그 방법으로 그 구역을 훑는 동안 그 대원이 누군가를 찾아냈을 때만 말한다 ("찾아냈습니다")
    if (u.work === 'search' && !s.casualties.some((c) => c.discoveredBy === u.rid && c.tDiscovered >= u.t0 && c.tDiscovered <= u.t)) continue;
    const wt = whyText(u), why = wt ? ` (${wt})` : '';
    const who = u.work === 'hoist' ? josa(sim.units[u.unitId].callsign, '이/가') : `${sim.responders[u.rid].name} 대원이`;
    const c = u.cas >= 0 ? s.casualties[u.cas] : undefined;
    if ((u.work === 'waterRescue' || u.work === 'hoist') && c) out.push(`구조 대상 ${josa(c.label, '은/는')} ${who} ${d.noun} 구했습니다${why}.`);
    else out.push(`${who} ${d.noun} ${WORK_DONE[u.work] ?? '임무를 마쳤습니다'}${why}.`);
  }
  return out;
}
/** 이 교대에 성공한 방법별 횟수 (평소 방법 포함 — sweep --methods 가 쓴다). 표의 순서대로 담는다 */
export function methodTally(sim: Sim): Partial<Record<MethodId, number>> {
  const n: Partial<Record<MethodId, number>> = {};
  let any = false;
  for (const I of sim.incidents) if (I.methods) for (const u of I.methods) if (u.ok) { n[u.method] = (n[u.method] ?? 0) + 1; any = true; }
  if (!any) return n;
  const out: Partial<Record<MethodId, number>> = {};
  for (const m of METHOD_ORDER) if (n[m] !== undefined) out[m] = n[m];
  return out;
}
/** 교대 요약의 한 줄: "대응 방법: 헤엄 2 · 구명환 3 · 호이스트 1" — 평소 방법은 빼고 센다(수십 건이 섞이면 읽히지 않는다). 하나도 없으면 null */
export function methodSummary(tally: Partial<Record<MethodId, number>>): string | null {
  const parts: string[] = [];
  for (const m of METHOD_ORDER) { const k = tally[m]; if (k !== undefined && k > 0 && !METHOD[m].plain) parts.push(`${METHOD[m].short} ${k}`); }
  return parts.length ? `대응 방법: ${parts.join(' · ')}.` : null;
}
