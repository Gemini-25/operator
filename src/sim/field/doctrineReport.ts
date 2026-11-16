// 대응 교본의 보고서 문장과 집계 (docs/specs/R3-doctrine.md §7.3). debrief.ts 가 부른다 — 판정과 같은 자격이다.
// 재료는 기록된 것뿐이다: 사건의 교본 기록(I.docs — doctrineRun.recordDoc)과 줄의 이름표(doctrine/registry.ts). 보고서를 쓸 때 교본을 다시 계산하지 않는다.
// (debrief.ts 는 여러 묶음이 함께 고치는 파일이라, R2 의 methodReport.ts 처럼 문장은 이 파일에 두고 debrief.ts 에는 부르는 줄만 넣었다.)

import type { Sim } from '../engine';
import type { DocUse, DocWhy, Incident, Scene } from '../types';
import { DOCTRINE, ruleName } from './doctrine/registry';
import type { DoctrineRule } from './doctrine/registry';

/** 까닭 말 (§7.3 WHY_DOC). danger·kit·protocol 은 까닭 말 없이 문장 템플릿이 말한다. noKit 의 장비 이름은 줄의 noKits[0] 로 문장이 채운다 */
export const WHY_DOC: Partial<Record<DocWhy, string>> = {
  alone: '혼자였음', buddy: '짝과 함께', outside: '밖에 대기조가 없었음', hurt: '다쳐서', lowAir: '공기가 부족해', lowAmmo: '탄약이 떨어져',
  civ: '시민이 위험해', hostage: '인질이 위험해', backup: '지원이 오고 있어', triage: '부상자가 많아', tired: '지쳐서', shaken: '동요해', team: '동료와 겹치지 않게',
};
/** 줄 번호(앞 세 글자) — 측정·보고서는 번호로 묶는다 ('F04'·'F04b' 는 한 줄) */
export const docNum = (id: string): string => id.slice(0, 3);
/** 등록된 개인 줄 (없으면 undefined) */
function ruleOf(id: string): DoctrineRule | undefined { for (let k = 0; k < DOCTRINE.length; k++) if (DOCTRINE[k].id === id) return DOCTRINE[k]; return undefined; }
/** 문장 템플릿의 자리표시자를 채운다: {name} 그 대원(지휘·관제 줄이면 부대 호출부호) · {mate} 함께한 대원 · {n} 길이(초) · {s} 대상 열쇠의 번호 */
export function fillDoc(sim: Sim, d: DocUse, tpl: string): string {
  const name = d.rid >= 0 ? sim.responders[d.rid].name : d.unitId >= 0 ? sim.units[d.unitId].callsign : '';
  const mate = d.mate >= 0 ? sim.responders[d.mate].name : '';
  return tpl.replace(/\{name\}/g, name).replace(/\{mate\}/g, mate).replace(/\{n\}/g, String(Math.round(d.t1 - d.t))).replace(/\{s\}/g, d.tgt.replace(/^[a-z]+:/, ''));
}
/**
 * 사건 분석 문장 (§7.3): I.docs 의 보고서 후보(say) 가운데 줄의 순위(rank)가 가장 작은 것부터(같으면 기록 순서) 최대 max 개.
 * 줄마다 한 문장(같은 번호의 줄은 한 번). 줄에 문장 템플릿(report)이 없으면 싣지 않는다
 */
export function docLines(sim: Sim, I: Incident, _s: Scene, max = 2): string[] {
  const out: string[] = [];
  const docs = I.docs;
  if (!docs || !docs.length || max <= 0) return out;
  const cand: { d: DocUse; r: DoctrineRule; k: number }[] = [];
  for (let k = 0; k < docs.length; k++) { const d = docs[k]; if (!d.say) continue; const r = ruleOf(d.rule); if (r && r.report) cand.push({ d, r, k }); }
  cand.sort((x, y) => x.r.rank - y.r.rank || x.k - y.k);
  const seen = new Set<string>();
  for (const c of cand) {
    if (out.length >= max) break;
    const n = docNum(c.r.id);
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(fillDoc(sim, c.d, c.r.report!));
  }
  return out;
}
/** 이 교대에 교본 줄이 쓰인 횟수 (번호별 — I.docs 의 줄을 앞 세 글자로 묶어 센다. fit 줄은 배정의 1등 비교로 남긴 것). 하나도 없으면 undefined */
export function docTally(sim: Sim): Record<string, number> | undefined {
  const n: Record<string, number> = {};
  let any = false;
  for (const I of sim.incidents) if (I.docs) for (const d of I.docs) { const k = docNum(d.rule); n[k] = (n[k] ?? 0) + 1; any = true; }
  return any ? n : undefined;
}
/** 교대 요약의 한 줄: "교본: 공기 탈출 3 · 단독 진입 보류 2 · 가벼운 임무 4" — 줄의 짧은 이름, 많은 순 다섯. 하나도 없으면 null */
export function docSummary(tally: Record<string, number> | undefined): string | null {
  if (!tally) return null;
  const rows = Object.keys(tally).sort((a, b) => tally[b] - tally[a] || (a < b ? -1 : 1)).slice(0, 5);
  if (!rows.length) return null;
  return `교본: ${rows.map((k) => `${ruleName(k)?.short ?? k} ${tally[k]}`).join(' · ')}.`;
}
