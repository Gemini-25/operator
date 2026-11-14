// 강력 범죄 (docs/specs/N4b-crime.md): 폭발물과 해체, 대형 인질극, 도주 차량과 은신처, 폭동, 연쇄 방화
import { describe, expect, it } from 'vitest';
import { NORMAL } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { createIncident } from '../src/sim/incidents';
import { arsonDepth } from '../src/sim/scenarios/crime';
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

describe('대형 인질극', () => {
  it('총을 든 용의자 둘 이상이 인질 넷 이상을 홀과 안쪽 방에 나눠 붙잡고 있고, 풀려난 인질의 말을 듣고 안쪽 방까지 진입해 끝낸다', () => {
    let tips = 0, roomEntries = 0;
    for (let k = 0; k < 6; k++) {
      const sim = new Sim('SIEGE' + k);
      sim.run(60);
      const I = createIncident(sim, { type: 'armed', variant: 'siege', rng: sim.rng.fork('t') });
      const s = sim.scenes[I.id]!;
      expect(I.tag).toBe('crime'); expect(I.truth.severity).toBe(3);
      const hostages = s.casualties.filter((c) => c.hostage);
      expect(hostages.length, `${sim.seed}: 인질 수`).toBeGreaterThanOrEqual(4); expect(hostages.length).toBeLessThanOrEqual(6);
      expect(s.hostiles.length, `${sim.seed}: 용의자 수`).toBeGreaterThanOrEqual(2); expect(s.hostiles.length).toBeLessThanOrEqual(3);
      const rooms = new Set<number>(), held = new Set<number>();
      for (const h of s.hostiles) {
        expect(h.weapon).toBe('gun');
        expect(h.hostageId, `${sim.seed}: ${h.label} 가 붙든 인질`).toBeGreaterThanOrEqual(0);
        expect(held.has(h.hostageId)).toBe(false); held.add(h.hostageId);
        const c = s.casualties[h.hostageId];
        expect(Math.hypot(c.x - h.x, c.y - h.y)).toBeLessThanOrEqual(3.2);      // 곁에 붙들려 있다 (hazards.isHeld 의 거리 안)
        expect(isFinite(h.deadline)).toBe(true);
        rooms.add(s.region[Math.round(h.y) * s.w + Math.round(h.x)]);
      }
      expect(rooms.size, `${sim.seed}: 용의자가 있는 방의 수`).toBe(2);
      // 안쪽 방의 문은 닫혀 있다 (건물에 들어선 뒤에도 따로 진입해야 한다)
      const inner = s.hostiles[0], innerRoom = s.region[Math.round(inner.y) * s.w + Math.round(inner.x)];
      const doors = s.props.filter((p) => p.kind === 'door' && s.region[p.y * s.w + p.x] === innerRoom);
      expect(doors.length).toBeGreaterThan(0);
      for (const d of doors) expect(d.open).toBeFalsy();
      sim.runToEnd();
      expect(I.phase).toBe('closed'); expect(I.result).not.toBeNull();
      expect(I.result!.suspectsTotal).toBe(s.hostiles.length);
      for (const e of sim.events) {
        if (e.incidentId !== I.id) continue;
        if (e.text.startsWith('풀려난 인질의 말')) tips++;
        if (/ 진입!/.test(e.text) && !e.text.startsWith('진입!')) roomEntries++;
      }
    }
    expect(tips, '풀려난 인질이 남은 용의자를 알려 준 횟수').toBeGreaterThanOrEqual(1);
    expect(roomEntries, '방 진입 횟수').toBeGreaterThanOrEqual(1);
  });
});

describe('도주 차량과 은신처', () => {
  it('총을 든 용의자가 현장을 빠져나가면 열에 서넛은 차를 몰고 달아나는 사건이 이어진다', () => {
    let getaways = 0, repeats = 0;
    for (let k = 0; k < 24; k++) {
      const sim = new Sim('GETAWAY' + k);
      sim.run(50);
      const I = createIncident(sim, { type: 'armed', variant: 'robbery', rng: sim.rng.fork('t') });
      const s = sim.scenes[I.id]!;
      expect(s.hostiles.length).toBeGreaterThan(0);
      for (const h of s.hostiles) { h.state = 'flee'; h.path = []; h.pathI = 0; }      // 곧바로 현장을 벗어난다
      sim.run(40);
      for (const h of s.hostiles) expect(h.state).toBe('escaped');
      const next = sim.incidents.filter((q) => q.parent === I.id);
      const G = next.filter((q) => q.truth.variant === 'getaway');
      expect(G.length, `${sim.seed}: 한 사건에서 도주 차량은 하나만`).toBeLessThanOrEqual(1);
      repeats += next.length - G.length + sim.gen.chain.filter((c) => c.opts.parent === I.id).length;
      for (const g of G) {
        getaways++;
        expect(g.truth.type).toBe('armed'); expect(g.tag).toBe('crime');
        expect(g.pursuit, '추격전이 시작돼 있다').toBeTruthy();
        expect(g.pursuit!.kind).toBe('getaway');
        const n = sim.city.nodes[I.truth.nodeId];
        expect(g.pursuit!.trail[0]).toEqual([n.x, n.y]);      // 달아난 그 자리에서 출발한다
        expect(sim.scenes[g.id]!.hostiles.every((h) => h.weapon === 'gun')).toBe(true);
        expect(sim.scenes[g.id]!.casualties.length).toBe(0);      // 인질은 없다
        sim.runToEnd();
        expect(g.phase).toBe('closed');
        if (g.pursuit!.state === 'escaped') expect(g.result!.outcome).toBe('unresolved');      // 놓치면 미해결
      }
    }
    expect(getaways).toBeGreaterThanOrEqual(3);
    expect(repeats).toBeGreaterThanOrEqual(1);      // 나머지 일부는 예전처럼 다른 곳에서 다시 범행한다
  });

  it('위협 4 의 평소 교대 40번: 이어진 사건마다 낳은 사건이 적혀 있고, 은신처에서 이어진 인질 사건은 바로 그 건물에서 일어난다', () => {
    const HIDE = ['warehouse', 'workshop'];      // 무장 사건이 날 수 있는 건물 가운데 외진 곳 (pursuit.ts 의 HIDEOUT_KINDS)
    let chained = 0, dens = 0, hidden = 0, followed = 0;
    for (let k = 0; k < 40; k++) {
      const sim = new Sim('T4-' + k, { ...NORMAL, threat: 4 });
      sim.runToEnd();
      expect(sim.ended).toBe(true);
      for (const I of sim.incidents) {
        expect(I.phase).toBe('closed');
        if (I.truth.variant === 'getaway') {
          expect(I.pursuit!.kind).toBe('getaway');
          // 현장에서 달아난 용의자가 낳은 도주 차량에는 낳은 사건이 적혀 있고, 그 사건에서는 총을 든 용의자가 실제로 달아났다
          if (I.parent !== undefined) { chained++; const P = sim.incidents[I.parent]; expect(sim.scenes[P.id]!.hostiles.some((h) => h.weapon === 'gun' && h.state === 'escaped'), `${sim.seed} ${I.code}`).toBe(true); }
        }
        const p = I.pursuit;
        if (p && p.hideout !== undefined) {
          dens++;
          expect(p.kind).toBe('kidnap');
          const den = sim.city.places[p.hideout];
          expect(HIDE).toContain(den.kind); expect(den.open).toBe(false);
          if (p.how === 'hideout') {
            hidden++;
            expect(p.state).toBe('escaped'); expect(I.closeReason).toBe('abandoned');
            // 설계서는 '미해결'로 적었지만, tests/sim.test.ts(추격전)가 놓친 납치를 모두 '실패'로 검사하므로 그대로 둔다
            expect(I.result!.outcome).toBe('failed');
          }
        }
        if (I.parent !== undefined) {
          const P = sim.incidents[I.parent];
          expect(P.id).toBeLessThan(I.id);
          if (P.pursuit && P.pursuit.how === 'hideout') {
            followed++;
            expect(I.truth.variant).toBe('hostage');
            expect(I.truth.placeId).toBe(P.pursuit.hideout);
            expect(sim.scenes[I.id]!.hostiles.length).toBeGreaterThan(0);      // 창고·농가에서도 인질 사건의 현장이 만들어진다
          }
        }
      }
    }
    expect(dens, '은신처로 향한 납치').toBeGreaterThanOrEqual(1);
    expect(chained + followed, '도주 차량 또는 은신처에서 이어진 사건').toBeGreaterThanOrEqual(1);
    expect(followed).toBeLessThanOrEqual(hidden);
  });
});

describe('폭동', () => {
  it('흉기를 든 주동자 둘과 맨손의 가담자들, 다친 시민, 작은 불이 있고, 끝까지 간다', () => {
    let timeouts = 0;
    for (let k = 0; k < 6; k++) {
      const sim = new Sim('RIOT' + k);
      sim.run(60);
      const I = createIncident(sim, { type: 'armed', variant: 'riot', rng: sim.rng.fork('t') });
      const s = sim.scenes[I.id]!;
      expect(['stadium', 'market', 'busTerminal', 'university', 'station', 'mart']).toContain(I.truth.placeKind);
      expect(s.hostiles.length).toBeGreaterThanOrEqual(5); expect(s.hostiles.length).toBeLessThanOrEqual(8);
      const leaders = s.hostiles.filter((h) => h.weapon === 'knife'), rest = s.hostiles.filter((h) => h.weapon === 'none');
      expect(leaders.length).toBe(2); expect(leaders.length + rest.length).toBe(s.hostiles.length);
      for (const h of leaders) expect(h.aggression).toBeGreaterThanOrEqual(0.55);
      for (const h of rest) { expect(h.aggression).toBeLessThanOrEqual(0.4); expect(h.morale).toBeLessThan(0.45); }      // 말을 걸면 곧 손을 든다
      const hurt = s.casualties.filter((c) => c.mob === 'immobile' && c.bleed > 0);
      expect(hurt.length).toBeGreaterThanOrEqual(2); expect(hurt.length).toBeLessThanOrEqual(4);
      let burning = 0; for (let i = 0; i < s.fire.length; i++) if (s.fire[i] > 0) burning++;
      expect(burning).toBeGreaterThanOrEqual(1); expect(burning).toBeLessThanOrEqual(2);
      expect(s.spots.filter((q) => q.exit === -1).length).toBeGreaterThanOrEqual(4);      // 여럿에게 말을 걸 자리
      sim.runToEnd();
      expect(I.phase).toBe('closed');
      if (I.closeReason !== 'resolved') timeouts++;
      else expect(I.result!.suspectsCaught, `${sim.seed}: 붙잡은 수`).toBe(s.hostiles.length);
    }
    expect(timeouts).toBeLessThanOrEqual(1);
  });
});

describe('연쇄 방화', () => {
  it('현장 밖에 목격자가 있고, 이어지는 불은 낳은 사건을 따라 세 번을 넘지 않으며, 방화범이 잡히면 더 나지 않는다', () => {
    let chained = 0, caught = 0, fires = 0;
    for (let k = 0; k < 10; k++) {
      const sim = runForced('ARSON' + k, 'fire/arson');
      forced(sim, 'arson');
      const kids = new Map<number, number>();
      for (const I of sim.incidents) {
        if (I.truth.variant !== 'arson') continue;
        fires++;
        expect(I.truth.type).toBe('fire'); expect(I.phase).toBe('closed'); expect(I.tag).toBe('crime');
        const s = sim.scenes[I.id]!;
        const w = s.props.filter((p) => p.kind === 'witness');
        expect(w.length, `${sim.seed} ${I.code}: 목격자`).toBe(1);
        expect(s.region[w[0].y * s.w + w[0].x] < 0 || !s.regions[s.region[w[0].y * s.w + w[0].x]].indoor).toBe(true);      // 건물 밖에 서 있다
        expect(s.regions[w[0].lastSeenRegion!].name).toBe('골목');
        expect(arsonDepth(sim, I), `${sim.seed} ${I.code}: 연쇄의 깊이`).toBeLessThanOrEqual(3);
        if (I.parent !== undefined) {
          chained++;
          const P = sim.incidents[I.parent];
          expect(P.truth.variant).toBe('arson'); expect(P.phase).toBe('closed');
          expect(I.createdAt).toBeGreaterThanOrEqual(P.closedAt + 59);      // 앞의 불이 끝나고 1~2분 뒤
          expect(I.truth.placeId).not.toBe(P.truth.placeId);
          expect(arsonDepth(sim, I)).toBe(arsonDepth(sim, P) + 1);
          kids.set(P.id, (kids.get(P.id) ?? 0) + 1);
        }
      }
      for (const n of kids.values()) expect(n).toBe(1);
      // 방화범이 잡힌 사건에서는 불이 더 이어지지 않는다
      for (const e of sim.events) if (e.text.startsWith('방화 용의자 검거')) {
        caught++;
        expect(kids.has(e.incidentId), `${sim.seed}: 잡힌 뒤에도 불이 이어졌다`).toBe(false);
        expect(sim.scenes[e.incidentId]!.props.some((p) => p.kind === 'witness' && p.interviewed)).toBe(true);
      }
    }
    expect(fires).toBeGreaterThanOrEqual(10);
    expect(chained, '이어진 불').toBeGreaterThanOrEqual(1);
    expect(caught, '잡힌 방화범').toBeGreaterThanOrEqual(1);
  });
});

describe('재현성', () => {
  it('같은 시드와 같은 강제 발생이면 기록이 같다', () => {
    for (const force of ['armed/bomb', 'armed/package', 'armed/siege', 'armed/riot', 'armed/getaway', 'fire/arson']) {
      const a = runForced('REP-1', force), b = runForced('REP-1', force);
      expect(a.report!.hash, force).toBe(b.report!.hash);
      expect(a.events.length).toBe(b.events.length);
    }
  });
});
