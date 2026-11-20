// 대응 방법(R2) 집계 — scripts/sweep.ts 가 교대마다 부른다 (설계서 R2 §6). 상태와 기록을 읽기만 한다: 결과는 바뀌지 않는다.
// 재료는 사건마다 남은 방법 기록(I.methods — field/methodRun.ts 의 recordMethod·recordAir)과 문제 기록뿐이다.
// --methods 를 붙이면 표 셋을 낸다:
//   ① 묶음(수난·문·구출·수색·화재·무장·응급·누출)별로 성공한 방법과 그 가짓수·가장 많이 쓰인 방법의 비중(다양성 목표), 접은 방법은 (방법/까닭)별로
//   ② 방법별 평균 시간(성공한 줄의 t − t0)
//   ③ 시나리오별 사건 수 · 대원 부상(RESPONDER_HURT 문제 수) · 순직(RESPONDER_KILLED — H1)
// --json 에는 요약의 methods 칸으로 들어간다. 단계 0(틀)에는 방법 기록이 없으므로 ①② 가 비어 있다.

import type { Sim } from '../src/sim/engine';
import { METHOD, METHOD_ORDER } from '../src/sim/field/methods';
import type { MethodId, WorkKind } from '../src/sim/types';

/** 임무 종류 → 표의 묶음 (호이스트는 수난, 검거는 무장, 잔해는 문, 탑승은 응급, 통제는 누출과 함께 본다) */
const GROUP: Partial<Record<WorkKind, string>> = {
  waterRescue: '수난', hoist: '수난', force: '문·통로', clear: '문·통로', extricate: '구출', search: '수색', suppress: '화재',
  engage: '무장', arrest: '무장', treat: '응급', load: '응급', mitigate: '누출·통제', perimeter: '누출·통제',
  carry: '이송', traffic: '교통 통제',      // (R3 6단계) 업기·끌기·들것 / 통제·차량 차단
};
const GROUP_ORDER = ['수난', '문·통로', '구출', '수색', '화재', '무장', '응급', '누출·통제', '이송', '교통 통제', '그 밖'];

export interface MethodCount {
  ok: Record<string, Record<string, number>>;       // 묶음 → 방법 → 성공 횟수
  fail: Record<string, number>;                     // '방법/까닭' → 접은 횟수
  secSum: Record<string, number>; secN: Record<string, number>;      // 방법 → 성공한 줄의 시간 합 · 건수
  scen: Record<string, { n: number; hurt: number; killed: number; fails: number }>;      // 시나리오 → 사건 수 · 대원 부상 · 순직 · METHOD_FAIL 문제 수
}
export const methodZero = (): MethodCount => ({ ok: {}, fail: {}, secSum: {}, secN: {}, scen: {} });

/** 한 교대의 집계 (교대가 끝난 뒤에 부른다) */
export function methodStats(sim: Sim): MethodCount {
  const o = methodZero();
  for (const I of sim.incidents) {
    const key = `${I.truth.type}/${I.truth.variant}`;
    const sc = (o.scen[key] ??= { n: 0, hurt: 0, killed: 0, fails: 0 });
    sc.n++;
    for (const p of I.problems) {
      const code: string = p.code;      // RESPONDER_KILLED 는 H1 이 합쳐진 뒤에 생긴다 — 글자로 견준다
      if (code === 'RESPONDER_HURT') sc.hurt++;
      else if (code === 'RESPONDER_KILLED') sc.killed++;
      else if (code === 'METHOD_FAIL') sc.fails += p.times ?? 1;
    }
    if (!I.methods) continue;
    for (const u of I.methods) {
      if (u.ok) {
        const g = GROUP[u.work] ?? '그 밖', b = (o.ok[g] ??= {});
        b[u.method] = (b[u.method] ?? 0) + 1;
        o.secSum[u.method] = (o.secSum[u.method] ?? 0) + (u.t - u.t0); o.secN[u.method] = (o.secN[u.method] ?? 0) + 1;
      } else { const k = `${u.method}/${u.why}`; o.fail[k] = (o.fail[k] ?? 0) + 1; }
    }
  }
  return o;
}

/** 여러 교대를 더한다 */
export function sumMethods(list: MethodCount[]): MethodCount {
  const o = methodZero();
  const add = (to: Record<string, number>, from: Record<string, number>): void => { for (const k of Object.keys(from)) to[k] = (to[k] ?? 0) + from[k]; };
  for (const c of list) {
    for (const g of Object.keys(c.ok)) add((o.ok[g] ??= {}), c.ok[g]);
    add(o.fail, c.fail); add(o.secSum, c.secSum); add(o.secN, c.secN);
    for (const k of Object.keys(c.scen)) { const a = (o.scen[k] ??= { n: 0, hurt: 0, killed: 0, fails: 0 }), b = c.scen[k]; a.n += b.n; a.hurt += b.hurt; a.killed += b.killed; a.fails += b.fails; }
  }
  return o;
}

/** 묶음 하나의 다양성: 성공 건수 · 가짓수 · 가장 많이 쓰인 방법과 그 비중 */
function diversity(b: Record<string, number>): { n: number; kinds: number; top: string; share: number } {
  let n = 0, kinds = 0, top = '', tv = 0;
  for (const m of METHOD_ORDER) { const v = b[m] ?? 0; if (v <= 0) continue; n += v; kinds++; if (v > tv) { tv = v; top = m; } }
  return { n, kinds, top, share: n ? tv / n : 0 };
}
const inOrder = (b: Record<string, number>): MethodId[] => METHOD_ORDER.filter((m) => (b[m] ?? 0) > 0);

/** --json 에 넣는 칸 */
export function methodJson(c: MethodCount): { ok: Record<string, number>; fail: Record<string, number>; avgSec: Record<string, number>; groups: Record<string, { n: number; kinds: number; top: string; topShare: number }>; methodFails: number } {
  const ok: Record<string, number> = {}, avgSec: Record<string, number> = {}, groups: Record<string, { n: number; kinds: number; top: string; topShare: number }> = {};
  for (const g of GROUP_ORDER) {
    const b = c.ok[g];
    if (!b) continue;
    const d = diversity(b);
    groups[g] = { n: d.n, kinds: d.kinds, top: d.top, topShare: +d.share.toFixed(3) };
    for (const m of inOrder(b)) ok[m] = (ok[m] ?? 0) + b[m];
  }
  for (const m of METHOD_ORDER) if (c.secN[m]) avgSec[m] = +(c.secSum[m] / c.secN[m]).toFixed(1);
  let methodFails = 0;
  for (const k of Object.keys(c.scen)) methodFails += c.scen[k].fails;
  return { ok, fail: c.fail, avgSec, groups, methodFails };
}

/** --methods: 표 셋 */
export function methodTables(c: MethodCount): string[] {
  const out: string[] = [];
  const groups = GROUP_ORDER.filter((g) => c.ok[g]);
  out.push('methods ① 성공한 방법 (묶음 · 건수 · 가짓수 · 가장 많이 쓰인 방법의 비중 | 방법별 횟수 — *는 평소 방법, ·는 기록 전용):');
  if (!groups.length) out.push('  (방법 기록 없음)');
  for (const g of groups) {
    const b = c.ok[g], d = diversity(b);
    out.push(`  ${g.padEnd(6)} ${String(d.n).padStart(4)}건 · ${d.kinds}가지 · 최다 ${METHOD[d.top as MethodId].short} ${(d.share * 100).toFixed(0)}% | `
      + inOrder(b).map((m) => `${METHOD[m].short}${METHOD[m].plain ? '*' : ''}${METHOD[m].record ? '·' : ''}(${m}) ${b[m]}`).join(' · '));
  }
  const fails = Object.keys(c.fail).sort((x, y) => c.fail[y] - c.fail[x] || (x < y ? -1 : 1));
  out.push('methods ① 접은 방법 (방법/까닭 횟수): ' + (fails.length ? fails.map((k) => `${k} ${c.fail[k]}`).join(' · ') : '(없음)'));
  const timed = METHOD_ORDER.filter((m) => c.secN[m]);
  out.push('methods ② 방법별 평균 시간 (성공한 줄의 t − t0, 초): ' + (timed.length ? timed.map((m) => `${METHOD[m].short}(${m}) ${(c.secSum[m] / c.secN[m]).toFixed(1)} (n ${c.secN[m]})`).join(' · ') : '(없음)'));
  out.push('methods ③ 시나리오별 (사건 수 · 대원 부상 RESPONDER_HURT · 사건당 · 순직 · 방법 실패 METHOD_FAIL):');
  for (const k of Object.keys(c.scen).sort()) {
    const s = c.scen[k];
    out.push(`  ${k.padEnd(20)} ${String(s.n).padStart(4)} · 부상 ${s.hurt} (${(s.hurt / Math.max(1, s.n)).toFixed(2)}/건) · 순직 ${s.killed} · 방법 실패 ${s.fails}`);
  }
  return out;
}
