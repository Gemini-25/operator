// 강력 범죄 (docs/specs/N4b-crime.md): 폭발물과 해체, 대형 인질극, 도주 차량과 은신처, 폭동, 연쇄 방화
import { describe, expect, it } from 'vitest';
import { NORMAL } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import type { Incident, Scene } from '../src/sim/types';

/** 그 시나리오를 교대 초반에 한 번 일으켜 끝까지 돌린다. 도는 동안 매 초 watch 를 부른다. */
function runForced(seed: string, force: string, watch?: (sim: Sim) => void): Sim {
  const sim = new Sim(seed, NORMAL, 1200, { force });
  let n = 0;
  while (!sim.ended && n++ < 20000) { sim.step(); if (watch && sim.tick % 5 === 0) watch(sim); }
  return sim;
}
/** 강제로 일으킨 사건 (교대 시작 15초 뒤에 생긴다) */
function forced(sim: Sim, variant: string): { I: Incident; s: Scene } {
  const I = sim.incidents.find((q) => q.truth.variant === variant && q.createdAt < 16)!;
  expect(I, `${sim.seed}: ${variant} 사건이 일어나지 않았다`).toBeTruthy();
  return { I, s: sim.scenes[I.id]! };
}

describe('폭발물', () => {
  it('진짜 장치: 끝까지 가고, 해체와 폭발이 함께 일어나지 않으며, 해체는 폭발물 처리반만 맡는다', () => {
    let defused = 0;
    for (let k = 0; k < 8; k++) {
      const sim = runForced('BOMB' + k, 'armed/bomb', (x) => {
        for (const sc of x.scenes) {
          if (!sc) continue;
          for (const w of sc.board) if (w.kind === 'defuse') for (const rid of w.assignees) expect(x.units[x.responders[rid].unitId].caps.eod, `${x.seed}: 처리반이 아닌 대원이 해체를 맡았다`).toBeGreaterThanOrEqual(0.9);
        }
      });
      expect(sim.ended).toBe(true);
      const { I, s } = forced(sim, 'bomb');
      expect(I.phase).toBe('closed'); expect(I.result).not.toBeNull();
      const bombs = s.props.filter((p) => p.kind === 'bomb');
      expect(bombs.length, `${sim.seed}: 장치 수`).toBe(1);
      expect(bombs[0].real).toBe(true);
      expect(bombs[0].fuse! > I.createdAt + 150).toBe(true);
      expect(!!bombs[0].mitigated && !!bombs[0].exploded, `${sim.seed}: 해체된 장치가 터졌다`).toBe(false);
      if (bombs[0].mitigated) defused++;
      // 터지지도 해체되지도 않은 채 끝났다면 판정이 그것을 남은 위험으로 본다
      if (!bombs[0].mitigated && !bombs[0].exploded) expect(I.result!.outcome === 'success' || I.result!.outcome === 'delayed').toBe(false);
      // 장치를 놓은 뒤에도 사람이 있던 자리는 모두 걸어서 닿는다 (안의 사람들이 발견되지 못한 채 남지 않는다)
      if (I.closeReason === 'resolved') expect(I.result!.casUndiscovered, `${sim.seed}: 발견하지 못한 사람`).toBe(0);
    }
    expect(defused).toBeGreaterThanOrEqual(1);
  });

  it('협박 전화: 장치가 없고, 확인 뒤 이상 없이 끝나며, 허위 신고로 기록된다', () => {
    for (let k = 0; k < 4; k++) {
      const sim = runForced('THREAT' + k, 'armed/bombthreat');
      const { I, s } = forced(sim, 'bombthreat');
      expect(s.props.some((p) => p.kind === 'bomb' && p.real)).toBe(false);
      expect(I.closeReason, sim.seed).toBe('resolved');
      expect(I.problems.some((p) => p.code === 'FALSE_ALARM' && p.recovered)).toBe(true);
      expect(I.result!.headline).toContain('폭발물 없음');
      expect(I.result!.casLost).toBe(0);
    }
  });

  it('수상한 물건: 눈에 띄는 곳에 하나 놓이고, 가짜면 처리반이 확인해야 끝난다', () => {
    let fake = 0, real = 0;
    for (let k = 0; k < 8; k++) {
      const sim = runForced('PKG' + k, 'armed/package');
      const { I, s } = forced(sim, 'package');
      const bombs = s.props.filter((p) => p.kind === 'bomb');
      expect(bombs.length).toBe(1);
      expect(I.phase).toBe('closed');
      const b = bombs[0];
      expect(!!b.mitigated && !!b.exploded).toBe(false);
      if (b.real) real++;
      else {
        fake++;
        expect(b.exploded, `${sim.seed}: 가짜가 터졌다`).toBeFalsy();
        expect(I.problems.some((p) => p.code === 'FALSE_ALARM')).toBe(true);
        if (b.mitigated) expect(I.result!.headline).toContain('확인 결과 폭발물 아님');
      }
    }
    expect(fake).toBeGreaterThan(0);
    expect(fake + real).toBe(8);
  });
});

describe('재현성', () => {
  it('같은 시드와 같은 강제 발생이면 기록이 같다', () => {
    for (const force of ['armed/bomb', 'armed/package']) {
      const a = runForced('REP-1', force), b = runForced('REP-1', force);
      expect(a.report!.hash, force).toBe(b.report!.hash);
      expect(a.events.length).toBe(b.events.length);
    }
  });
});
