// 대응 교본(R3) 집계 — scripts/sweep.ts 가 교대마다 부른다 (설계서 R3 §8.3). 상태와 기록을 읽기만 한다: 결과는 바뀌지 않는다.
// 재료는 사건마다 남은 교본 기록(I.docs — field/doctrineRun.ts 의 recordDoc)과 교대 보고서의 docSplit(1단계부터)뿐이다.
// --doctrine 을 붙이면 표 셋을 낸다 (글자 출력의 줄은 모두 'doctrine:' 으로 시작한다 — I1-a 측정 도구의 접두어와 겹치지 않게):
//   ① 분야별 "등록 n줄 중 쓰인 m줄"(개인 줄은 번호 = 앞 세 글자로 묶고, 지휘·관제 줄 CMD_ROWS 를 더한다)과 줄별 쓰인 횟수
//   ② 판단 지점·교본 행동의 평균 길이(t1 − t)
//   ③ split(같은 상황 다른 행동 — 표본 10 이상인 열쇠 가운데 고른 것이 두 가지 이상인 열쇠의 비율)과 그 열쇠 목록
// --json 에는 요약의 doctrine 칸({ rules, used, split, avgWait })으로 들어간다. 단계 0(틀)에는 줄도 기록도 없으므로 표가 비어 있다.

import type { Sim } from '../src/sim/engine';
import { CMD_ROWS, DOCTRINE } from '../src/sim/field/doctrine/registry';
import type { DocDept } from '../src/sim/types';

const DEPT_ORDER: DocDept[] = ['police', 'fire', 'ems', 'special', 'common'];
const DEPT_NAME: Record<DocDept, string> = { police: '경찰', fire: '소방', ems: '의료', special: '특수', common: '공통' };
/** split 을 세는 열쇠의 최소 표본 */
export const SPLIT_MIN = 10;

export interface DocCount {
  used: Record<string, number>;                          // 줄 번호(앞 세 글자) → 쓰인 횟수
  waitSum: Record<string, number>; waitN: Record<string, number>;      // 'gate'·'act' → 길이 합 · 건수
  split: Record<string, Record<string, number>>;         // '분야|국면|임무' → (고른 것 → 횟수)
}
export const doctrineZero = (): DocCount => ({ used: {}, waitSum: {}, waitN: {}, split: {} });
const num = (id: string): string => id.slice(0, 3);

/** 한 교대의 집계 (교대가 끝난 뒤에 부른다) */
export function doctrineStats(sim: Sim): DocCount {
  const o = doctrineZero();
  for (const I of sim.incidents) for (const d of I.docs ?? []) {
    o.used[num(d.rule)] = (o.used[num(d.rule)] ?? 0) + 1;
    if (d.hook === 'gate' || d.hook === 'act' || d.hook === 'duty') {
      const k = d.hook === 'gate' ? 'gate' : 'act';
      o.waitSum[k] = (o.waitSum[k] ?? 0) + (d.t1 - d.t); o.waitN[k] = (o.waitN[k] ?? 0) + 1;
    }
  }
  const sp = sim.report?.docSplit;
  if (sp) for (const key of Object.keys(sp)) { const row = (o.split[key] ??= {}); for (const v of Object.keys(sp[key])) row[v] = (row[v] ?? 0) + sp[key][v]; }
  return o;
}
/** 교대들의 합 */
export function sumDoctrine(list: DocCount[]): DocCount {
  const o = doctrineZero();
  const add = (to: Record<string, number>, from: Record<string, number>): void => { for (const k of Object.keys(from)) to[k] = (to[k] ?? 0) + from[k]; };
  for (const c of list) {
    add(o.used, c.used); add(o.waitSum, c.waitSum); add(o.waitN, c.waitN);
    for (const key of Object.keys(c.split)) add((o.split[key] ??= {}), c.split[key]);
  }
  return o;
}
/** 등록한 줄 (번호로 묶은 개인 줄 + 지휘·관제 줄) — 분야별 */
function registered(): Record<DocDept, string[]> {
  const out: Record<DocDept, string[]> = { police: [], fire: [], ems: [], special: [], common: [] };
  for (const r of DOCTRINE) { const n = num(r.id); if (out[r.dept].indexOf(n) < 0) out[r.dept].push(n); }
  for (const r of CMD_ROWS) if (out[r.dept].indexOf(r.id) < 0) out[r.dept].push(r.id);
  return out;
}
/** split 의 값 (표본이 모자라 셀 열쇠가 없으면 null) */
function splitOf(c: DocCount): { value: number | null; keys: { key: string; n: number; kinds: number }[] } {
  const keys: { key: string; n: number; kinds: number }[] = [];
  for (const key of Object.keys(c.split).sort()) { const row = c.split[key]; let n = 0; for (const v of Object.keys(row)) n += row[v]; keys.push({ key, n, kinds: Object.keys(row).length }); }
  const big = keys.filter((k) => k.n >= SPLIT_MIN);
  return { value: big.length ? +(big.filter((k) => k.kinds >= 2).length / big.length).toFixed(3) : null, keys };
}
/** --json 의 doctrine 칸 */
export function doctrineJson(c: DocCount): { rules: number; used: number; split: number | null; avgWait: number | null } {
  const reg = registered();
  let rules = 0, used = 0;
  for (const d of DEPT_ORDER) for (const n of reg[d]) { rules++; if ((c.used[n] ?? 0) > 0) used++; }
  const wn = (c.waitN.gate ?? 0) + (c.waitN.act ?? 0);
  return { rules, used, split: splitOf(c).value, avgWait: wn ? +(((c.waitSum.gate ?? 0) + (c.waitSum.act ?? 0)) / wn).toFixed(1) : null };
}
/** 글자 출력 (--doctrine). 모든 줄이 'doctrine:' 으로 시작한다 */
export function doctrineTables(c: DocCount): string[] {
  const reg = registered();
  const out: string[] = [];
  const j = doctrineJson(c);
  out.push(`doctrine: 등록 ${j.rules}줄 중 쓰인 ${j.used}줄 (${DEPT_ORDER.map((d) => `${DEPT_NAME[d]} ${reg[d].filter((n) => (c.used[n] ?? 0) > 0).length}/${reg[d].length}`).join(' · ')})`);
  const rows = Object.keys(c.used).sort((a, b) => c.used[b] - c.used[a] || (a < b ? -1 : 1));
  out.push(`doctrine: 줄별 횟수 — ${rows.length ? rows.map((n) => `${n} ${c.used[n]}`).join(' · ') : '(없음)'}`);
  const avg = (k: string): string => ((c.waitN[k] ?? 0) > 0 ? `${((c.waitSum[k] ?? 0) / c.waitN[k]).toFixed(1)}초 (${c.waitN[k]}건)` : '-');
  out.push(`doctrine: 평균 길이 — 판단 지점 ${avg('gate')} · 교본 행동 ${avg('act')}`);
  const sp = splitOf(c);
  out.push(`doctrine: split ${sp.value === null ? '-' : sp.value} (표본 ${SPLIT_MIN} 이상 열쇠 ${sp.keys.filter((k) => k.n >= SPLIT_MIN).length} / 전체 ${sp.keys.length})`);
  for (const k of sp.keys) if (k.n >= SPLIT_MIN) out.push(`doctrine:   ${k.key} — ${Object.entries(c.split[k.key]).sort((a, b) => b[1] - a[1]).map(([v, n]) => `${v} ${n}`).join(' · ')}`);
  return out;
}
