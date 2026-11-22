// (N8 단계 10) 일상 사건이 세계에 남기는 상태의 식 — 등록이 없는 파일 (docs/specs/N8-incident-kinds.md §5.6 · 구현 메모 단계 10).
// 상태 규칙(world/rules/kinds.ts — 상태를 놓는다)과 일반 법칙(world/laws/kinds.ts — 상태로 위험을 쌓는다), 측정(scripts/hazstats.ts)이 같은 식을 쓴다.
// 법칙 파일을 다른 모듈이 import 하면 등록 차례가 import 차례에 묶이므로(world/laws/index.ts), 둘이 함께 쓰는 것은 여기에 둔다 (expo.ts 와 같은 까닭).
// 진실 쪽이다(세계 규칙과 같은 자격). 판단(관제·지휘관·대원)은 이 파일·world.loose·world.soak 를 읽지 않는다.
//
//   살아 있는 전선의 불꽃(spark) — 곁 건물의 L2 heatSpread 칸에 1초마다 불티(충격). 사건이 닫힐 때도 살아 있으면 LEFT 초만큼을 닫힌 꼴로 한 번에(넘는 시각만큼 미룬다)
//   길 밑으로 스민 물(soak)     — 터진 수도관의 물이 흐르는 동안 그 교차로의 이웃 교차로마다 1초에 1 씩 쌓이고, 멎으면 DRAIN 씩 빠진다 → 법칙 washout
//   풀린 위험(loose)            — 닫힐 때 살아 남은 벌집(그 건물) · 찻길로 달아난 동물(그 교차로 둘레, tau 초의 지수로 멀어진다) → 법칙 strayHarm · strayRoad
import type { Sim } from '../engine';
import type { LooseHazard, Prop, Scene } from '../types';
import { burnedPlaces, fireTargetOk, heatMul, neighborsOfPoint, smokeBase } from './expo';

/**
 * 살아 있는 전선의 불꽃이 곁 건물에 쌓는 불티 (L2 heatSpread 의 같은 칸 — "그 건물이 얼마나 타기 쉬운가"의 문턱):
 *  K      벽까지 틈 0 · 타기 쉬운 정도 1 인 건물이 1초에 받는 위험 — 틈 g 면 K × M / (1 + g/6)². 시험이 키워 쓴다
 *  LEFT   사건이 닫힐 때 전선이 아직 살아 있으면 그 뒤로 더 튀는 초 (전력 회사가 끝내 끊기까지 — 아무도 지키지 않는다)
 *  MIN_DELAY 닫힌 꼴의 충격이 문턱을 넘을 때 사건까지의 가장 짧은 초 · NB_MAX 불티를 받는 가까운 건물 수 · REACH 불티가 닿는 벽까지의 거리
 */
export const SPARK = { K: 4.5e-3, LEFT: 600, MIN_DELAY: 30, NB_MAX: 4, REACH: 30 };
/** 그 현장의 살아 있는 전선 (끊어진 전선 — 전기가 흐르는 fixture 'wire') */
export function liveWire(s: Scene): Prop | null {
  for (let k = 0; k < s.props.length; k++) { const p = s.props[k]; if (p.kind === 'fixture' && p.skin === 'wire' && p.live === true && !p.removed) return p; }
  return null;
}
/** 도시 좌표 (x, y)의 전선 불꽃이 1초에 곁 건물에 주는 불티 — 옮겨붙을 수 있는 건물(expo.fireTargetOk — L2 와 같은 조건)만, 가까운 순 NB_MAX 채 */
export function sparkTargets(sim: Sim, x: number, y: number): { id: number; dH: number }[] {
  const out: { id: number; dH: number }[] = [];
  const nbs = neighborsOfPoint(sim, x, y), places = sim.city.places;
  let burned: Set<number> | null = null;
  for (let k = 0; k < nbs.length && out.length < SPARK.NB_MAX; k++) {
    const nb = nbs[k];
    if (nb.gap > SPARK.REACH) break;
    if (!burned) burned = burnedPlaces(sim);
    if (!fireTargetOk(sim, nb.id, burned)) continue;
    const d = 1 + nb.gap / 6;
    out.push({ id: nb.id, dH: (SPARK.K * heatMul(places[nb.id].kind)) / (d * d) });
  }
  return out;
}

/** 길 밑으로 스민 물: 물이 멎은 교차로에서 1초에 빠지는 양 (흐른 초 단위) */
export const SOAK = { DRAIN: 1 };
/** 그 현장의 물이 흐르는 관 (터진 수도관 — fixture 'pipe' 가 살아 있고 갈래가 물) */
export function flowingMain(s: Scene): Prop | null {
  for (let k = 0; k < s.props.length; k++) { const p = s.props[k]; if (p.kind === 'fixture' && p.skin === 'pipe' && p.live === true && p.sub === 'water' && !p.removed) return p; }
  return null;
}

/**
 * 풀린 위험의 크기:
 *  TAU    찻길로 달아난 동물이 그 교차로 둘레에서 멀어지는 시간(초 — 그만큼 지나면 e 분의 1) · 벌집은 Infinity(그 교대에 남는다)
 *  R      풀린 동물이 다칠 사람을 만나는 거리(건물 가운데까지) · MAX 그 안에서 보는 가까운 건물 수
 *  RR     그 위험이 곁 주민에게 더하는 상대 위험 — 그 건물의 평소 응급률(expo.smokeBase — 평소 응급의 장소 표)의 RR 배. 0 이면 다치게 하지 않는다(가축은 사람을 쫓지 않는다)
 *  HIVE_BASE 벌집이 남은 건물의 평소율 대신 쓰는 값 — 벌집은 그 건물에 사람이 드나드는 한 같다(학교·공원·절은 평소 응급의 장소 표에 없어 0 이 된다). 단독 주택의 평소율 자리
 *  ROAD   찻길에 나온 동물이 곁 구간에서 1초에 쌓는 사고 위험 (통행량 1 일 때 — 0.4 + 1.6 × 통행량을 곱한다)
 */
export const STRAY = {
  TAU: { dog: 420, boar: 360, cow: 240, pig: 240 } as Record<string, number>,
  R: 260, MAX: 12,
  RR: { hive: 250, dog: 40, boar: 25, cow: 0, pig: 0 } as Record<string, number>, HIVE_BASE: 4.8e-6,
  ROAD: { boar: 4e-4, cow: 5e-4, pig: 4e-4, dog: 1.5e-4 } as Record<string, number>,
};
/** 지금 그 위험이 남아 있는 정도 (1 → 0) */
export function presence(sim: Sim, L: LooseHazard): number { return L.tau === Infinity ? 1 : Math.exp(-(sim.t - L.since) / L.tau); }
/**
 * 풀린 위험이 다치게 할 수 있는 건물과 그 가까움 c (0..1): 벌집은 그 건물 하나(c 1), 동물은 R 안의 주거 건물(평소 응급률 > 0) 가까운 순 MAX 채(c = 1 − 거리 / R).
 * 터·출동 시설은 뺀다. 열린 사건이 있는 건물·쓸 수 없는 건물은 틀(world/hazard.ts)이 기다리게 하거나 버린다
 */
const STRAY_OF = new WeakMap<LooseHazard, { id: number; c: number; base: number }[]>();      // 자리가 바뀌지 않으므로 한 건에 한 번 만든다 (그 교대의 sim.world 안의 줄이 열쇠)
export function strayTargets(sim: Sim, L: LooseHazard): readonly { id: number; c: number; base: number }[] {
  const hit = STRAY_OF.get(L);
  if (hit) return hit;
  const out = strayList(sim, L);
  STRAY_OF.set(L, out);
  return out;
}
function strayList(sim: Sim, L: LooseHazard): { id: number; c: number; base: number }[] {
  const places = sim.city.places, out: { id: number; c: number; base: number }[] = [];
  if (L.what === 'hive') {
    const q = places[L.place];
    if (q && q.facility < 0) out.push({ id: q.id, c: 1, base: STRAY.HIVE_BASE });
    return out;
  }
  for (const q of places) {
    if (q.open || q.facility >= 0) continue;
    const d = Math.hypot(q.x + q.w / 2 - L.x, q.y + q.h / 2 - L.y);
    if (d >= STRAY.R) continue;
    const base = smokeBase(sim, q.kind);
    if (base > 0) out.push({ id: q.id, c: 1 - d / STRAY.R, base });
  }
  out.sort((a, b) => b.c - a.c || a.id - b.id);
  if (out.length > STRAY.MAX) out.length = STRAY.MAX;
  return out;
}
