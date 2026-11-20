// L1 roadCrash — 차가 몰린 길에서는 사고가 잦다 (설계서 I1 §3.7 L1 · 틀은 world/hazard.ts §3.6a).
//
// 읽는 상태: 교통 모델이 혼잡을 다시 계산할 때마다(12초) 적어 두는 구간의 초과 혼잡과 그 몫(traffic.excess·roadParts — §3.6b), 구간의 통행량·길이·등급, 노면과 시야.
// **교통 모델의 배열만 읽는다** — 사건·현장·재난을 읽지 않는다. 그 초과를 무엇이 만들었는지(쓰러진 나무·사고 통제·공사·낙하물·잔해·정체·인파·꺼진 신호·재난의 통제 …)를 식에 쓰지 않는다:
// 혼잡이면 같다. 원인은 귀속에만 쓰인다 — 문턱을 넘는 순간의 몫마다의 기록(틀이 cause·causes·parent·hz 로 적는다).
//
// 식: λ_e = A × x_e × V_e × S × ℓ_e (초당)
//   x_e = 초과 혼잡(네 몫의 합, 닫힌 구간은 0) · V_e = 0.4 + 1.6 × 통행량 · S = 노면·시야(초과분에만 곱한다 — 막히거나 몰린 길이 없으면 날씨만으로는 0 이다) · ℓ_e = clamp(길이 / 150, 0.5, 2)
// 대상은 구간, 주기는 12초(교통 모델의 주기 뒤), 문턱의 흐름은 hz:roadCrash:<구간>:<n>(구간마다 몇 번이고 날 수 있다).
// 낸 사고의 감속·통제가 다시 밀림과 우회 몰림의 뿌리가 된다(되먹임 — 기대값이 1 아래이고, 사슬 3건·한 뿌리의 가지 2·한 교대 6건이 꼬리를 자른다: hazard.hazardRoom).
//
// 이 파일은 등록만 한다(world/laws/index.ts 가 모은다). src/sim 의 다른 모듈은 이 파일을 import 하지 않는다 — 가중의 식(roadSurface·roadWeight)은 측정(scripts/hazstats.ts)이 함께 쓴다.

import { weatherSpeedFactor } from '../../city';
import type { Sim } from '../../engine';
import type { SpawnOpts } from '../../incidents';
import { roadFlow, roadParts } from '../../traffic';
import type { RoadPart } from '../../traffic';
import type { HzWhat, RoadEdge } from '../../types';
import { clamp } from '../../util';
import { registerHazard } from '../hazard';
import type { HzPart } from '../hazard';

/**
 * 법칙의 세기와 사건의 크기 (시험이 A 를 키워 쓴다):
 *  A        초과 1.0 · 통행량 1 · 맑은 낮 · 150 길이의 구간 하나가 1초에 쌓는 위험 (구간 하나의 평소 사고율이 약 7e-6/초 — 그 여섯 배쯤이 더해진다).
 *           설계의 첫 값 2.5e-5 에서 hazstats 의 노출량으로 맞췄다(b3-6): 보통 교대의 노출량 Σ x·V·S·ℓ dt 가 평균 14,750(60교대), 쓰러진 나무 하나가 약 1,850, 평소 사고 하나가 약 2,550 이고
 *           문턱을 넘은 것의 다섯에 하나(늦게까지 이어지는 교대는 절반까지)는 교대 끝이라 버려진다 → 보통 60교대에 29건(교대당 0.48), 통제 하나가 사고로 이어질 몫 5~8%
 *  X_BIG    이 초과부터 한 단계 큰 사고 · BUS3·BUS2 = 규모 3·2 의 사고에 버스가 끼어 있을 몫(평소 추첨과 같다) · NIGHT = 밤의 시야
 *  CAP      이 법칙이 낸 사고의 교대 상한
 */
export const ROAD = { A: 4.2e-5, X_BIG: 1.2, BUS3: 0.28, BUS2: 0.06, NIGHT: 1.2, CAP: 3 };

/** 노면·시야: (차량 속도 손잡이 ÷ 날씨·비바람의 속도 계수)² × 밤이면 NIGHT — 비 1.29 · 안개 1.42. 난이도의 차량 속도 손잡이는 약분돼 빠진다 */
export function roadSurface(sim: Sim): number {
  const f = sim.tune.vehicleSpeedMul / weatherSpeedFactor(sim);
  return f * f * (sim.weather === 'night' ? ROAD.NIGHT : 1);
}
/** 초과 1 이 그 구간에서 갖는 무게 V × S × ℓ (A 를 곱하기 전) — flow = 그 구간의 통행량(0..1), S = roadSurface */
export function roadWeight(e: RoadEdge, flow: number, S: number): number {
  return (0.4 + 1.6 * flow) * S * clamp(e.len / 150, 0.5, 2);
}

/** 발생 기록의 첫머리 — 주된 몫의 갈래로 (상태를 말한다: 무엇이 그 상태를 만들었는지는 원인 기록이 말한다) */
const NOTE: Partial<Record<HzWhat, string>> = {
  divert: '막힌 길을 피해 몰린 차들 사이에서 사고가 났습니다', queue: '길게 밀린 차들의 꼬리에서 추돌 사고가 났습니다',
  lane: '한 차로가 막힌 길에서 차가 부딪쳤습니다', jam: '정체 구간에서 추돌 사고가 났습니다', crowd: '인파로 막힌 길에서 사고가 났습니다',
  dark: '신호등이 꺼진 교차로에서 차가 부딪쳤습니다', haze: '연기로 앞이 보이지 않는 길에서 차가 부딪쳤습니다', level: '물이 차오르는 길에서 차가 부딪쳤습니다',
};

/** 그 교차로에 지금 사고를 낼 수 있는가: 시설 앞이 아니고, 열린 사건이 없고, 이미 예약된 사건의 자리도 아니다 */
function nodeFree(sim: Sim, node: number): boolean {
  for (const f of sim.city.facilities) if (f.nodeId === node) return false;
  for (const I of sim.incidents) if (I.phase !== 'closed' && I.truth.nodeId === node) return false;
  const ch = sim.gen.chain;
  for (let k = 0; k < ch.length; k++) if (ch[k].opts.nodeId === node) return false;      // 같은 주기에 이웃한 두 구간이 함께 넘으면 한 교차로에 둘이 예약된다 — 뒤의 것은 다른 끝으로 가거나 기다린다
  return true;
}

const buf: RoadPart[] = [];

registerHazard({
  id: 'roadCrash', label: '몰린 길의 사고', every: 12, once: false, cap: ROAD.CAP,
  scan: (sim, put) => {
    const tr = sim.traffic, edges = sim.city.edges, flow = roadFlow(sim), S = roadSurface(sim);
    for (let id = 0; id < edges.length; id++) {
      if (!(tr.excess[id] > 0)) continue;      // 초과가 없는 구간은 내놓지 않는다 (닫힌 구간은 0 이다 — 차가 다니지 않는다)
      const w = ROAD.A * roadWeight(edges[id], flow[id], S);
      const n = roadParts(sim, id, buf), parts: HzPart[] = [];
      for (let k = 0; k < n; k++) { const p = buf[k]; parts.push({ rate: p.x * w, ev: p.ev, inc: p.inc, what: p.what, ref: p.ref }); }
      put(id, parts);
    }
  },
  spawn: (sim, target, cell, main, total): SpawnOpts | null => {
    const e = sim.city.edges[target];
    // 자리: 그 구간의 두 끝 가운데 지금 사고를 낼 수 있는 교차로 — 둘 다 되면 닿은 구간이 많은 쪽, 같으면 번호가 작은 쪽. 둘 다 안 되면 기다린다
    const okA = nodeFree(sim, e.a), okB = nodeFree(sim, e.b);
    if (!okA && !okB) return null;
    const na = sim.city.nodes[e.a].edges.length, nb = sim.city.nodes[e.b].edges.length;
    const node = okA && okB ? (na > nb || (na === nb && e.a < e.b) ? e.a : e.b) : okA ? e.a : e.b;
    // 규모는 그 길의 속도와 초과에서: 이면·일반 도로는 1(초과가 크면 2) · 간선은 2(크면 3) · 고속은 3
    const w = ROAD.A * roadWeight(e, roadFlow(sim)[target], roadSurface(sim));
    const x = w > 0 ? total / w : 0;
    let severity = e.speed <= 23 ? (x < ROAD.X_BIG ? 1 : 2) : e.cls === 'highway' || x >= ROAD.X_BIG ? 3 : 2;
    // 변형은 반드시 정한다(비워 두면 시나리오 몫 추첨이 돈다). 버스가 그 줄에 끼어 있었는가는 내용이다 — 문턱과 같은 흐름의 둘째 값으로(평소 추첨과 같은 몫, 버스면 규모 3). 다중 추돌은 내지 않는다(대형 사고는 교대에 많아야 하나)
    let variant = 'std';
    if (severity >= 2 && cell.u2 < (severity >= 3 ? ROAD.BUS3 : ROAD.BUS2)) { variant = 'bus'; severity = 3; }
    return { type: 'traffic', variant, severity, nodeId: node, edgeId: target, note: NOTE[main.what] ?? '차가 몰린 길에서 사고가 났습니다' };
  },
});
