// 대형 사고: 비행기 추락, 열차 탈선, 다중 추돌, 가스 폭발, 크레인 붕괴, 선박 화재 (docs/specs/N5-major.md)
// 평소 추첨에는 들어가지 않는다. 교대마다 많아야 한 번, tune.majorProb 로 일어난다 (share 는 대형 사고끼리의 비중).
import { edgeName, findRoute } from '../city';
import { emit } from '../events';
import type { Scenario } from '../scenarios';
import type { Needs } from '../types';

/** 필요한 칸만 올린다 (유형의 기본 계산보다 내려가지 않는다) */
const atLeast = (n: Needs, m: Partial<Needs>): void => { for (const k of Object.keys(m) as (keyof Needs)[]) n[k] = Math.max(n[k], m[k] ?? 0); };

export const MAJOR: Scenario[] = [
  { type: 'traffic', variant: 'pileup', name: '다중 추돌', share: 1.6, nature: 'pileup', vague: 'bang', severity: [3, 3], tag: 'major', delay: [2, 6], limit: 200,
    texts: ['고속도로에서 차 여러 대가 연달아 부딪쳤어요!', '차가 대여섯 대 엉켜 있어요. 기름이 새요!'], lik: [0.05, 0.88, 0.005, 0.01, 0.01, 0.02, 0.02, 0.005],
    needs: (n) => atLeast(n, { rescue: 2, ems: 3, suppression: 1, traffic: 1, law: 1 }),
    // 고속도로가 닿는 교차로. 통제해도 돌아갈 길이 있는 구간이 있는 곳을 먼저 고른다
    node: (sim, rng, busy) => {
      const c = sim.city;
      const hw = c.nodes.filter((n) => !busy.has(n.id) && n.edges.some((e) => c.edges[e].cls === 'highway') && !c.facilities.some((f) => f.nodeId === n.id));
      const open = hw.filter((n) => n.edges.some((e) => c.edges[e].cls === 'highway' && !c.edges[e].closed && !!findRoute(c, c.edges[e].a, c.edges[e].b, 1, e)));
      const pool = open.length ? open : hw;
      return pool.length ? rng.pick(pool).id : null;
    },
    // 평소 교통사고는 고속도로가 아닌 구간을 느리게 한다. 다중 추돌은 고속도로 구간을 통째로 막는다 (풀기는 closeIncident 가 한다)
    onCreate: (sim, I) => {
      const c = sim.city, node = c.nodes[I.truth.nodeId];
      if (I.blockedEdge >= 0) { const e0 = c.edges[I.blockedEdge]; e0.slow = Math.max(0, e0.slow - 1.4); I.blockedEdge = -1; }
      const hw = node.edges.map((e) => c.edges[e]).filter((e) => e.cls === 'highway' && !e.closed).sort((a, b) => a.id - b.id);
      for (const e of hw) {
        if (!findRoute(c, e.a, e.b, 1, e.id)) continue;
        I.blockedEdge = e.id; e.slow += 1.4; e.closed = true; e.closedReason = 'incident';
        emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', text: `${edgeName(c, e)} 전면 통제 — 다중 추돌 사고로 차로가 모두 막혔습니다.`, imp: 2, truth: true });
        break;
      }
    } },
];
