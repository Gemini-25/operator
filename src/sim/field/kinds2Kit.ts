// N9 큰 사건·새 장소의 현장 틀과 길 위 장소의 도우미 (세계 쪽 — 현장 생성기·시나리오의 node 가 부른다. 진실을 만든다)
//
// 단계 3(지도): 터널·지하차도의 도우미 넷. 부르는 곳은 단계 5(fire/tunnelfire 의 node)·9(water/underpass 의 node).
// 현장 틀(venueFrame·tunnelFrame·subwayFrame …)·plazaNode·nearPlaceNode·setWater 는 처음 쓰는 단계(4·5·9)에서 이 파일에 더한다.
//
// 도시는 고정이다(CLAUDE.md "도시는 고정이고 한 번만 만든다"): 교대마다 도로 상태(edges)만 복사하고 교차로·건물은 같은 배열을 쓴다.
// 그래서 구간·교차로 번호는 도시마다 한 번만 구해 모듈에 둔다(열쇠 = 함께 쓰는 city.places). 구간의 모양(양 끝·등급)은 교대마다 같다.

import type { Sim } from '../engine';
import { mountainAt, segCross } from '../city';
import { RAIL } from '../cityPlan';
import type { Rng } from '../rng';
import type { City } from '../types';

/** 터널로 보는 산의 문턱 — view/city/staticCity.ts 가 터널 입구를 그리는 조건(간선 && 구간 가운데의 mountainAt ≥ 0.35)과 같다 */
export const TUNNEL_AT = 0.35;

interface RoadSpots { tunnel: number[]; tunnelNodes: number[]; under: number[]; underNodes: number[] }
const spotCache = new WeakMap<object, RoadSpots>();

/** 구간들의 끝 교차로(번호 순, 겹치지 않게). 도시 밖으로 나가는 끝(exit)은 뺀다 — 산성터널로의 N3 은 그 너머에 길이 없다 */
function endsOf(city: City, ids: number[]): number[] {
  const out: number[] = [];
  for (const id of ids) { const e = city.edges[id]; for (const n of [e.a, e.b]) if (!city.nodes[n].exit && out.indexOf(n) < 0) out.push(n); }
  return out.sort((a, b) => a - b);
}
function spotsOf(city: City): RoadSpots {
  let s = spotCache.get(city.places);
  if (!s) {
    const tunnel: number[] = [], under: number[] = [];
    for (const e of city.edges) {
      const A = city.nodes[e.a], B = city.nodes[e.b];
      if (e.cls === 'arterial' && mountainAt((A.x + B.x) / 2, (A.y + B.y) / 2) >= TUNNEL_AT) tunnel.push(e.id);
      if (e.cls === 'arterial' || e.cls === 'highway') {
        for (let i = 0; i < RAIL.length - 1; i++) if (segCross(A.x, A.y, B.x, B.y, RAIL[i][0], RAIL[i][1], RAIL[i + 1][0], RAIL[i + 1][1])) { under.push(e.id); break; }
      }
    }
    s = { tunnel, tunnelNodes: endsOf(city, tunnel), under, underNodes: endsOf(city, under) };
    spotCache.set(city.places, s);
  }
  return s;
}

/** 산을 뚫고 지나는 간선 구간의 번호(지금 지도: 산성터널로 e53 N1–N2 · e54 N2–N3). **이 구간은 닫지 않는다** — N3 너머가 도시 출구라 끊긴다(§4.3) */
export function tunnelEdges(city: City): number[] { return spotsOf(city).tunnel; }
/** 철길과 입체로 만나는 간선·고속도로 구간의 번호 = 지하차도(지금 지도: 중앙대로 e196 L52–L74). 교통 모델은 street·local 만 건널목으로 본다 */
export function underpassEdges(city: City): number[] { return spotsOf(city).under; }

/**
 * 후보 교차로 가운데 하나. **null 을 돌려주지 않는다**(§5.8): 사건이 없고 출동 시설 앞이 아닌 곳 → 사건이 없는 곳 → 아무 후보(같은 교차로에 두 사건이 열릴 수 있다 — N8 §12.3).
 * 후보가 하나도 없으면(지도가 바뀌어 터널·지하차도가 사라졌으면) 도시 밖 끝이 아닌 모든 교차로에서 같은 규칙으로 고른다 — null 이면 createIncident 가 그 유형의 건물로 떨어지므로.
 */
function pickSpot(sim: Sim, rng: Rng, busy: Set<number>, cands: number[]): number {
  const city = sim.city;
  const all = cands.length ? cands : city.nodes.filter((n) => !n.exit).map((n) => n.id);
  const fac = new Set(city.facilities.map((f) => f.nodeId));
  let pool = all.filter((n) => !busy.has(n) && !fac.has(n));
  if (!pool.length) pool = all.filter((n) => !busy.has(n));
  if (!pool.length) pool = all;
  return rng.pick(pool);
}
/** 터널 사건의 교차로(시나리오 node — 단계 5): 터널 구간의 끝 가운데 도시 밖 끝이 아닌 곳(지금 N1·N2) */
export function tunnelNode(sim: Sim, rng: Rng, busy: Set<number>): number { return pickSpot(sim, rng, busy, spotsOf(sim.city).tunnelNodes); }
/** 지하차도 사건의 교차로(시나리오 node — 단계 9): 지하차도 구간의 끝(지금 L52·L74) */
export function underpassNode(sim: Sim, rng: Rng, busy: Set<number>): number { return pickSpot(sim, rng, busy, spotsOf(sim.city).underNodes); }
