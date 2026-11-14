// Z1: 측정 도구(scripts/metrics.ts 의 REPEAT 후보)가 찾은 반복 고리와 재범 연쇄의 상한.
// 반복의 셈은 metrics.ts 와 같다: 한 사건 안에서 같은 사람이 같은 문구를 남긴 횟수(중요도 1 이상).
import { describe, expect, it } from 'vitest';
import { CHAIN_MAX, CHAIN_SHIFT_MAX, canChain, chainLen, chainedInShift } from '../src/sim/chain';
import { NORMAL, PRESETS, parseDisaster } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { RETRY_AFTER, failedRecently } from '../src/sim/field/agents';
import { createIncident } from '../src/sim/incidents';
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

describe('재범 연쇄의 상한 (Z1)', () => {
  it('한 연쇄는 많아야 세 사건, 한 교대에 이어진 사건은 상한 안 (예약할 때 확인한다)', () => {
    const s = new Sim('T-CHAIN', EXTREME);
    s.run(100);
    const a = createIncident(s, { type: 'armed', variant: 'robbery', rng: s.rng.fork('t1') });
    const b = createIncident(s, { type: 'armed', variant: 'robbery', parent: a.id, rng: s.rng.fork('t2') });
    const c = createIncident(s, { type: 'armed', variant: 'robbery', parent: b.id, rng: s.rng.fork('t3') });
    expect(chainLen(s, a)).toBe(1); expect(chainLen(s, c)).toBe(3);
    expect(canChain(s, a)).toBe(true); expect(canChain(s, b)).toBe(true);
    expect(canChain(s, c)).toBe(false);      // 세 번째 사건에서는 더 잇지 않는다
    // 예약해 둔 것도 센다: 교대의 상한에 닿으면 처음 사건에서도 잇지 않는다
    const base = chainedInShift(s);
    for (let k = base; k < CHAIN_SHIFT_MAX; k++) s.gen.chain.push({ at: 1e9, opts: { type: 'armed', variant: 'robbery', parent: a.id } });
    expect(chainedInShift(s)).toBe(Math.max(base, CHAIN_SHIFT_MAX));
    expect(canChain(s, a)).toBe(false);
  });

  it('극한에서 강도 ↔ 도주 차량이 서로를 끝없이 낳지 않는다 (기준선: S1 에서 연쇄 16건·깊이 5), 상한에 걸려도 지어낸 기록이 없다', () => {
    for (const seed of ['S1', 'S5', 'S40']) {
      const s = shiftOf(seed, EXTREME);
      let chained = 0;
      for (const I of s.incidents) {
        if (I.parent === undefined) continue;
        chained++;
        expect(chainLen(s, I), `${seed} #${I.code}`).toBeLessThanOrEqual(CHAIN_MAX);
        expect(s.incidents[I.parent].createdAt).toBeLessThan(I.createdAt);
      }
      expect(chained, seed).toBeLessThanOrEqual(CHAIN_SHIFT_MAX);
      expect(chained, seed).toBeGreaterThan(0);      // 연쇄 자체는 남아 있다
      // 연쇄의 첫머리 기록은 실제로 만들어진 사건에만 있다 (예약하지 않은 연쇄에 대한 기록을 남기지 않는다)
      const notes = s.events.filter((e) => e.text.startsWith('도주한 용의자가 다른 곳에서') || e.text.startsWith('달아난 용의자가 차를 몰고'));
      for (const e of notes) expect(s.incidents[e.incidentId].parent, e.text).toBeDefined();
      expect(notes.length).toBeLessThanOrEqual(chained);
    }
  }, 60000);
});
