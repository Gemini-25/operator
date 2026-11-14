// Z1: 측정 도구(scripts/metrics.ts 의 REPEAT 후보)가 찾은 반복 고리.
// 반복의 셈은 metrics.ts 와 같다: 한 사건 안에서 같은 사람이 같은 문구를 남긴 횟수(중요도 1 이상).
import { describe, expect, it } from 'vitest';
import { NORMAL, PRESETS, parseDisaster } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { RETRY_AFTER, failedRecently } from '../src/sim/field/agents';
import type { Incident, WorkItem } from '../src/sim/types';

const HARD = PRESETS.hard.d, EXTREME = PRESETS.extreme.d;
const finished = new Map<string, Sim>();
function shiftOf(seed: string, d: Difficulty): Sim {
  const key = seed + '|' + JSON.stringify(d);
  let s = finished.get(key);
  if (!s) { s = new Sim(seed, d); s.runToEnd(); finished.set(key, s); }
  return s;
}
function incident(s: Sim, code: string): Incident { const I = s.incidents.find((q) => q.code === code); if (!I) throw new Error(`사건 ${code} 없음`); return I; }
/** 이 사건에서 가장 많이 되풀이된 (사람, 문구)와 그 횟수 */
function maxRepeat(s: Sim, I: Incident, pred: (actor: string, text: string) => boolean = () => true): { n: number; what: string } {
  const m = new Map<string, number>();
  let n = 0, what = '';
  for (const e of s.events) {
    if (e.incidentId !== I.id || e.importance < 1 || !pred(e.actor, e.text)) continue;
    const k = e.actor + ': ' + e.text, v = (m.get(k) ?? 0) + 1;
    m.set(k, v);
    if (v > n) { n = v; what = k; }
  }
  return { n, what };
}

describe('반복 고리 (Z1)', () => {
  it('소화전에 닿지 못한 진압 대원은 연결 시도와 실패를 1초마다 되풀이하지 않는다 (기준선: 42·21·75회)', () => {
    const cases: [string, Difficulty, string][] = [['S14', EXTREME, '13'], ['S17', HARD, '10'], ['S4', { ...NORMAL, disaster: parseDisaster('wildfire')! }, '07']];
    for (const [seed, d, code] of cases) {
      const s = shiftOf(seed, d), I = incident(s, code);
      const r = maxRepeat(s, I, (_a, t) => t.includes('소화전'));
      expect(r.n, `${seed} #${code} ${r.what}`).toBeLessThanOrEqual(5);
      expect(maxRepeat(s, I).n, `${seed} #${code}`).toBeLessThanOrEqual(5);
    }
  }, 60000);

  it('실패를 기억한다: 닿지 못했거나 위험해서 내려놓은 작업은 한동안 같은 대원에게 다시 맡기지 않는다', () => {
    const s = new Sim('T-RETRY');
    const w = { failedAt: {} as Record<number, number> } as WorkItem;
    expect(failedRecently(s, w, 3)).toBe(false);
    w.failedAt[3] = s.t;
    expect(failedRecently(s, w, 3)).toBe(true);
    expect(failedRecently(s, w, 4)).toBe(false);      // 다른 대원은 맡을 수 있다
    s.run(Math.ceil(RETRY_AFTER / s.dt) + 1);
    expect(failedRecently(s, w, 3)).toBe(false);      // 기억은 잠시뿐이다 (상황이 바뀌면 다시 시도한다)
  });

  it('부상 후퇴는 상태가 바뀔 때 한 번만 알린다 (기준선: 보통 S19 #13 에서 12초에 8번)', () => {
    const I = incident(shiftOf('S19', NORMAL), '13');
    expect(maxRepeat(shiftOf('S19', NORMAL), I).n).toBeLessThanOrEqual(5);
    let hurt = 0;
    for (const [seed, d] of [['S19', NORMAL], ...Array.from({ length: 12 }, (_, k) => ['S' + k, HARD] as [string, Difficulty])] as [string, Difficulty][]) {
      const s = shiftOf(seed, d);
      for (const J of s.incidents) {
        const r = maxRepeat(s, J, (_a, t) => t === '부상으로 더 이상 임무 수행 불가. 후퇴합니다.');
        if (r.n) hurt++;
        expect(r.n, `${seed} #${J.code} ${r.what}`).toBeLessThanOrEqual(1);
      }
    }
    expect(hurt).toBeGreaterThan(0);      // 부상 후퇴가 실제로 일어나는 교대를 보고 있다
  }, 120000);

  it('위험해서 물러난 대원에게 같은 지시를 3초마다 되풀이하지 않는다 (기준선: 극한 S18 #10 에서 11번)', () => {
    const s = shiftOf('S18', EXTREME), I = incident(s, '10');
    const r = maxRepeat(s, I, (a, t) => t.endsWith('맡아라.') || t.endsWith('실시.'));
    expect(r.n, r.what).toBeLessThanOrEqual(5);
  }, 60000);

  it('구급대원이 더 해 줄 처치가 없으면 처치 지시와 상태 보고를 끝없이 주고받지 않는다 (기준선: 어려움 S34 #06 에서 24번)', () => {
    for (const [seed, d, code] of [['S34', HARD, '06'], ['S0', HARD, '05']] as [string, Difficulty, string][]) {
      const s = shiftOf(seed, d), I = incident(s, code);
      const r = maxRepeat(s, I);
      expect(r.n, `${seed} #${code} ${r.what}`).toBeLessThanOrEqual(5);
    }
  }, 60000);
});
