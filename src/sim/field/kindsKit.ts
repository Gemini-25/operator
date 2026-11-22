// N8 현장 도구 (docs/specs/N8-incident-kinds.md §4.2·§4.8·§10.1) — 진실을 만든다 (field/scenes/kinds.ts 가 부른다).
//   buildQuiet   그 유형의 장소에 아무 일도 없는 현장 (장난 전화 — 불 없는 건물 · 환자 없는 집 · 사람 없는 하천 · 용의자 없는 가게)
//   streetFrame  길 위 현장의 틀: 가로 도로 네 줄 · 보도 둘 · 위아래 건물 앞면(벽 — 들어가지 않는다) · 바깥 현장
// 단계 3 은 이 둘만 둔다. 시장·도심·홀 틀(marketFrame·urbanFrame·hallFrame)·동물(addAnimal)·농가·다리 교차로는 그것을 쓰는 단계(4a~8)가 더한다.
// 길 위 교차로 고르기(streetNode)는 시나리오 표가 부르므로 scenarios/kinds.ts 에 있다 (시나리오 표가 현장 도구를 import 하면 builders 를 끌어온다).
import type { Sim } from '../engine';
import type { Rng } from '../rng';
import { T } from '../types';
import type { Incident, Scene } from '../types';
import { buildArmed, buildFire, buildMedical, buildWater } from './builders';
import { SW, addRegion, baseScene, set } from './kit';

/**
 * 아무 일도 없는 현장 — 그 유형의 장소 틀을 그대로 쓰고 사건만 뺀다:
 * 화재·가스(오인)는 buildFire 의 오인 신고 갈래(불·가스통·구조 대상 없음), 응급·수난은 그 틀에서 구조 대상을 뺀 것, 무장은 장난 전화의 빈 가게.
 * 끝나는 길: 지금의 방(물가) 수색 → 확인할 것이 없음 → 종료. 구조 대상을 빼는 것은 만든 직후라 아무도 그 사람을 가리키지 않는다(addCas 는 배열에 넣기만 한다)
 */
export function buildQuiet(sim: Sim, I: Incident, rng: Rng): Scene {
  const t = I.truth.type;
  if (t === 'fire' || t === 'hazmat') return buildFire(sim, I, rng);      // falseAlarm 갈래 (변형 false · prank)
  if (t === 'armed') return buildArmed(sim, I, rng);      // 빈 가게 (변형 prank · false)
  const s = t === 'water' ? buildWater(sim, I, rng) : buildMedical(sim, I, rng);
  s.casualties.length = 0;
  return s;
}

/**
 * 길 위 현장의 틀 (§4.2): 가로 도로 네 줄(y 8~11, T.ROAD) · 북쪽 보도(y 7) · 남쪽 보도(y 12~14 — 대기 지점·안전 구역이 있는 넓은 보도) · 위아래 건물 앞면(y ≤ 6, y ≥ 15 — 벽과 진열창,
 * 들어가지 않는다) · s.outdoor. (N8 단계 4a) 남쪽 보도를 세 줄로 넓혔다 — 안전 구역(5,12) 아래로 쓰러진 동료를 내려놓는 자리(executor rescueMate: safe.y + 1 ~ 2.2)가 벽이 되지 않게.
 * opt.lanes 가 참이면 지나는 차(laneRows 넷 — hazards.tickLane)와 통제 지점 둘(x 3·26)을 둔다. 거짓이면 차는 지나지 않는다(보도 위의 일 — 통제가 필요 없다).
 * 출입구 넷(도로 양 끝·보도 양 끝)과 출입구마다 자리 하나 + 정면 자리. 보도 둘은 수색할 수 있는 바깥 구역이다
 */
export function streetFrame(sim: Sim, I: Incident, rng: Rng, opt: { lanes: boolean; search?: boolean }): Scene {
  const s = baseScene(sim, I, rng);
  const H = s.h;
  for (let x = 0; x < SW; x++) {
    for (let y = 0; y <= 6; y++) set(s, x, y, T.WALL);
    for (let y = 15; y < H; y++) set(s, x, y, T.WALL);
    for (let y = 8; y <= 11; y++) set(s, x, y, T.ROAD);
    set(s, x, 7, T.GROUND); for (let y = 12; y <= 14; y++) set(s, x, y, T.GROUND);
  }
  // 건물 앞면: 가게마다 진열창(창 칸 — 시야는 통하지 않는 벽과 다르게 그린다). 문은 두지 않는다(안으로 들어갈 일이 없다)
  for (let x = 2; x < SW - 2; x += rng.int(3, 5)) { set(s, x, 6, T.WINDOW); set(s, x, 15, T.WINDOW); }
  s.outdoor = true;
  s.staging = { x: 2, y: 12 }; s.safe = { x: 5, y: 12 }; s.vantage = { x: 8, y: 12 };
  // 보도 둘은 바깥 구역 — opt.search 가 거짓이면 수색하지 않는 구역 (시설 사고: 사람은 보이는 자리에 있고, 수색 경로가 위험 반경을 지나지 않게 — N8 단계 4a)
  const srch = opt.search !== false;
  addRegion(s, '북쪽 보도', 'zone', 0, 7, SW - 1, 7, false, srch);
  addRegion(s, '남쪽 보도', 'zone', 0, 12, SW - 1, 14, false, srch);
  s.exits = [{ x: 0, y: 9 }, { x: SW - 1, y: 10 }, { x: 0, y: 7 }, { x: SW - 1, y: 12 }];
  s.spots = [{ x: 2, y: 9, exit: 0, taken: -1 }, { x: SW - 3, y: 10, exit: 1, taken: -1 }, { x: 2, y: 7, exit: 2, taken: -1 }, { x: SW - 3, y: 12, exit: 3, taken: -1 }, { x: 14, y: 12, exit: -1, taken: -1 }];
  if (opt.lanes) {
    addRegion(s, '차로', 'zone', 0, 8, SW - 1, 11, false, false);      // (N8 단계 4a) 차가 다니는 길 — 수색하지 않는다 (이름만: "차로에 끊어진 전선")
    s.laneRows = [8, 9, 10, 11];
    s.controlPts = [{ x: 3, y: 10 }, { x: 26, y: 9 }]; s.controlDone = [false, false];
    const node = sim.city.nodes[I.truth.nodeId];
    let cong = 1.2; for (const eid of node.edges) cong = Math.max(cong, sim.city.edges[eid].cong);
    s.trafficFlow = cong / 2.6; s.nextCarAt = sim.t + 6;
  } else { s.trafficFlow = 0; s.nextCarAt = Infinity; }
  return s;
}
