// 확장 지점: 사건을 정해서 일으키기, 등록표, 재난·대형 사고의 틀, 지휘 규칙의 정보 격리
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { NORMAL, difficultyLabel, parseDisaster, validDifficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { createIncident } from '../src/sim/incidents';
import { SCENARIOS, scenarioOf } from '../src/sim/scenarios';
import { SCENE_BUILDERS } from '../src/sim/field/sceneRegistry';

describe('확장 지점', () => {
  it('유형·시나리오·장소를 정해서 사건을 일으킬 수 있고, 끝까지 간다', () => {
    const s = new Sim('EXT-1');
    s.run(100);
    const bank = s.city.places.find((q) => q.kind === 'bank')!;
    const a = createIncident(s, { type: 'armed', variant: 'burglary', placeId: bank.id, tag: 'test', rng: s.rng.fork('t') });
    const b = createIncident(s, { type: 'traffic', nodeId: s.city.nodes[10].id, rng: s.rng.fork('t2') });
    expect(a.truth.type).toBe('armed'); expect(a.truth.variant).toBe('burglary'); expect(a.truth.placeId).toBe(bank.id); expect(a.tag).toBe('test');
    expect(b.truth.type).toBe('traffic'); expect(b.truth.nodeId).toBe(s.city.nodes[10].id); expect(b.truth.placeId).toBe(-1);
    s.runToEnd();
    expect(a.phase).toBe('closed'); expect(b.phase).toBe('closed'); expect(a.result).not.toBeNull();
  });
  it('강제 발생(force)은 교대 초반에 그 시나리오를 한 번 일으키고, 평소 사건의 추첨을 흔들지 않는다', () => {
    const plain = new Sim('EXT-2'); plain.run(400);
    const forced = new Sim('EXT-2', NORMAL, 1200, { force: 'collapse/elevator' }); forced.run(400);
    const extra = forced.incidents.filter((I) => I.truth.variant === 'elevator' && I.createdAt < 16);
    expect(extra.length).toBe(1);
    // 강제로 일으킨 사건을 빼면 처음 몇 건의 유형·시나리오가 같다 (부대가 묶여 뒤쪽 시점은 달라질 수 있다)
    const sig = (x: Sim, skip: number): string => x.incidents.filter((I) => I.id !== skip).slice(0, 2).map((I) => `${I.truth.type}/${I.truth.variant}`).join(',');
    expect(sig(forced, extra[0].id)).toBe(sig(plain, -1));
  });
  it('시나리오 표: 몫의 합이 유형마다 1 을 넘지 않고, 대형 사고와 재난은 평소 추첨에 들어가지 않는다', () => {
    const sum: Record<string, number> = {};
    for (const q of SCENARIOS) if (q.tag !== 'major' && q.tag !== 'disaster') sum[q.type] = (sum[q.type] ?? 0) + q.share;
    for (const k of Object.keys(sum)) expect(sum[k], k).toBeLessThanOrEqual(0.75);
    for (const q of SCENARIOS) {
      expect(q.tag, `${q.type}/${q.variant} 에 tag 가 없다`).toBeTruthy();
      if (q.lik) expect(q.lik.length).toBe(8);
      if (q.texts) expect(q.texts.length).toBeGreaterThan(0);
    }
    // 등록된 현장 생성기는 모두 시나리오 표에 있는 것이다
    for (const key of Object.keys(SCENE_BUILDERS)) { const [t, v] = key.split('/'); expect(scenarioOf(t as never, v), key).toBeTruthy(); }
  });
  it('재난: 없음이면 아무 상태도 없고, 선택은 조건의 일부로 이름에 드러난다', () => {
    expect(new Sim('EXT-3').disaster).toBeNull();
    expect(parseDisaster('typhoon')).toBe('typhoon'); expect(parseDisaster('x')).toBeNull();
    expect(validDifficulty({ ...NORMAL, disaster: 'quake' })).toBe(true);
    expect(difficultyLabel({ ...NORMAL, disaster: 'flood' })).toBe('보통 · 재난 홍수');
    expect(difficultyLabel(NORMAL)).toBe('보통');
    const low = { ...NORMAL, severity: 1, disaster: 'random' as const };
    for (let k = 0; k < 6; k++) expect(new Sim('R' + k, low).disaster).toBeNull();      // 심각도 1 에서는 무작위 재난이 일어나지 않는다
  });
  it('지휘 규칙(field/orders)은 진실을 읽지 않는다', () => {
    const dir = new URL('../src/sim/field/orders/', import.meta.url);
    for (const f of readdirSync(dir)) {
      const src = readFileSync(new URL(f, dir), 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
      for (const bad of ['s.props', 's.casualties', 's.hostiles', '.truth', 's.fire[', 's.smoke[', 'sim.scenes']) expect(src.includes(bad), `${f}: ${bad}`).toBe(false);
    }
  });
});
