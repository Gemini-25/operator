// 재난에 딸린 시나리오: 산불 현장, 산사태, 해안 대피 (docs/specs/N6-disaster.md)
// 모두 tag 가 disaster 이고 share 가 0 이다: 평소에는 추첨되지 않고 disaster.ts 가 직접 일으킨다(시험은 sweep --force).
import { edgeName, mountainAt } from '../city';
import { emit } from '../events';
import type { Scenario } from '../scenarios';
import { reallyLinked } from '../traffic';

export const DISASTER: Scenario[] = [
  { type: 'fire', variant: 'wild', name: '산불', share: 0, nature: 'wildfire', vague: 'smoke', severity: [2, 3], tag: 'disaster', label: '산불',
    places: { forest: 4, pension: 3, campsite: 1, temple: 1, farmhouse: 2, lookout: 1 },
    texts: ['산에서 불길이 내려와요! 집 쪽으로 번지고 있어요!', '숲에 불이 크게 났어요. 사람들이 못 내려오고 있어요!'], lik: [0.9, 0.01, 0.03, 0.005, 0.01, 0.01, 0.03, 0.005],
    needs: (n) => { n.suppression = Math.max(n.suppression, 2); n.search = Math.max(n.search, 1); n.ems = Math.max(n.ems, 1); }, limit: 120 },
  { type: 'collapse', variant: 'landslide', name: '산사태', share: 0, nature: 'landslide', vague: 'rumble', severity: [2, 3], tag: 'disaster', label: '산사태',
    texts: ['산이 무너져서 도로를 덮쳤어요! 차가 묻혔어요!', '흙더미가 쏟아져서 길이 끊겼어요. 차 안에 사람이 있어요!'], lik: [0.01, 0.15, 0.01, 0.005, 0.01, 0.8, 0.005, 0.01],
    // 산자락의 교차로에서 일어난다 (사건이 진행 중인 곳은 피한다)
    node: (sim, rng, busy) => {
      const hill = sim.city.nodes.filter((n) => mountainAt(n.x, n.y) > 0.12);
      const free = hill.filter((n) => !busy.has(n.id));
      const cands = free.length ? free : hill;
      return cands.length ? rng.pick(cands).id : null;
    },
    needs: (n) => { n.rescue = Math.max(n.rescue, 1); n.ems = Math.max(n.ems, 1); },
    // 흙더미가 덮은 구간은 치울 때까지 지나갈 수 없다 (우회로가 있는 구간만. 사건이 끝나면 closeIncident 가 푼다)
    onCreate: (sim, I) => {
      const node = sim.city.nodes[I.truth.nodeId];
      const es = node.edges.map((id) => sim.city.edges[id]).filter((e) => !e.closed && e.cls !== 'highway');
      for (const e of es) {
        if (!reallyLinked(sim, e.a, e.b, e.id)) continue;      // 실제 상태로 본다: 아직 아무도 모르는 낙하물이 놓인 길은 돌아갈 길이 아니다
        I.blockedEdge = e.id; e.slow += 1.4; e.closed = true; e.closedReason = 'incident';
        emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', text: `${edgeName(sim.city, e)} 통행 불가 — 흙더미가 길을 덮었습니다.`, imp: 1, truth: true });
        break;
      }
    } },
  { type: 'water', variant: 'evac', name: '해안 대피', share: 0, nature: 'evac', vague: 'scream', severity: [2, 3], tag: 'disaster', label: '해안 대피',
    places: { beach: 4, pier: 2, fishMarket: 1.5, ferry: 1.5 },
    texts: ['해일 경보가 났는데 바닷가에 사람들이 아직 많아요!', '부두에 어르신들이 남아 있어요. 못 걸으세요!'], lik: [0.005, 0.01, 0.05, 0.005, 0.03, 0.005, 0.005, 0.8],
    needs: (n) => { n.law = Math.max(n.law, 2); n.ems = Math.max(n.ems, 1); n.rescue = Math.max(n.rescue, 1); }, limit: 100, delay: [1, 3] },
];
