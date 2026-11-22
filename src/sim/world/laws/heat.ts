// L2 heatSpread — 오래 크게 타는 불 곁의 건물은 불이 붙는다 (설계서 I1 §3.7 L2 · 틀은 world/hazard.ts §3.6a · 이웃은 world/expo.ts §3.6c).
//
// 읽는 상태: 열린 현장의 불 요약 F(hazards.fireLoad — 불 세기 0.5 이상 칸 수), 그 현장의 건물(길 위면 그 점)에서 이웃 건물까지의 벽-벽 틈 g(expo.neighborsOf·neighborsOfPoint),
// 이웃 건물의 종류(타기 쉬운 정도)와 지금 상태(쓸 수 있는가 · 이번 교대에 이미 불이 났는가).
// **현장의 불이면 무엇이든 같은 열원이다** — 건물 화재든 방화든 가스 폭발 뒤의 불이든 차량 화재든 붕괴 현장의 불이든, 법칙은 그 불을 무엇이 만들었는지를 식에 쓰지 않는다.
// 원인은 귀속에만 쓰인다: 열원 현장마다의 몫 { ev: 그 불을 만든 기록(hazards.fireCauseEv), inc: 그 사건, what: 'heat', ref: 불난 건물 }.
//
// 식: 유속 q = F / (1 + g/6)², 문턱 유속 Q0 를 넘는 몫만 쌓인다 — λ = K × M[종류] × max(0, q − Q0) (초당). F < F_MIN 인 현장은 훑지 않는다. 열원이 둘이면 몫이 더해진다.
// 대상은 열원 현장마다 가까운 NB_MAX 채까지, 주기는 1초, 건물마다 교대에 한 번(once) — 문턱의 흐름은 hz:heatSpread:<건물>("그 건물이 얼마나 타기 쉬운가").
// 옮겨붙은 건물의 불이 다시 열원이 된다(되먹임 — 한 뿌리에서 뿌리 포함 건물 셋까지: 사슬 3건 · 한 뿌리의 가지 2 — hazard.hazardRoom).
// 폭발의 불티(충격 — 같은 칸에 hazardImpulse)는 L3 의 상태 규칙(b3-8c)이 더한다.
//
// 이 파일은 등록만 한다(world/laws/index.ts 가 모은다). src/sim 의 다른 모듈은 이 파일을 import 하지 않는다 — 노출량의 식(heatTargets·heatRate)은 측정(scripts/hazstats.ts)이 함께 쓴다.

import type { Sim } from '../../engine';
import { fireCauseEv, fireLoad } from '../../field/hazards';
import type { SpawnOpts } from '../../incidents';
import type { HzWhat } from '../../types';
import { burnedPlaces, fireTargetOk, heatMul, neighborsOf, neighborsOfPoint } from '../expo';
import type { Nb } from '../expo';
import { registerHazard } from '../hazard';
import type { HzPart } from '../hazard';

export { heatMul } from '../expo';      // (b3-8c) 타기 쉬운 정도와 대상의 조건은 불티 항(rules/structure.ts)도 쓰므로 등록이 없는 파일로 옮겼다

/**
 * 법칙의 세기와 사건의 크기 (시험이 K 를 키워 쓴다):
 *  K       유속이 문턱을 1 넘는 동안 1초에 쌓이는 위험. 설계의 첫 값 1.7e-4(벽을 맞댄 집(틈 3)이 F = 30 의 불 곁에 200초면 H ≈ 0.35)에서 노출량으로 맞췄다(b3-7):
 *          강제 fire/std 20교대의 노출량 Σ M·max(0, q − Q0)·dt 가 교대당 약 2,200(보통 60교대 약 820), 첫 값이면 그 20교대에 옮겨붙은 불 5건 · 화재 성공 −3.5%p 라
 *          0.7배로 — 3건 · −1.2%p (보통 60교대 4건, 교대 끝 150초 안의 넘음 3 은 버려진다). 벽을 맞댄 집이 F = 30 곁에 200초면 H ≈ 0.25
 *  Q0      문턱 유속 · F_MIN 훑는 현장의 불 요약 하한 · NB_MAX 현장마다 훑는 이웃의 수 · F_BIG 이 불 요약부터 규모 2 의 불 · CAP 이 법칙이 낸 불의 교대 상한
 */
export const HEAT = { K: 1.2e-4, Q0: 3, F_MIN: 10, NB_MAX: 8, F_BIG: 40, CAP: 3 };

/** 열원 하나가 틈 g 의 이웃에 주는 몫 (K 를 곱하기 전): M × max(0, q − Q0), q = F / (1 + g/6)² — M 은 expo.heatMul */
export function heatRate(F: number, gap: number, mul: number): number {
  const d = 1 + gap / 6, q = F / (d * d);
  return q > HEAT.Q0 ? mul * (q - HEAT.Q0) : 0;
}

/**
 * 열원 현장과 그 곁의 대상 건물을 차례로 내놓는다 (scan 과 측정이 함께 쓴다 — 읽기만 한다):
 * 열린 사건의 현장 가운데 불 요약 F ≥ F_MIN 인 것(사건 번호 순)마다, 그 건물(길 위면 그 점)의 이웃을 가까운 순으로 — 대상이 될 수 있는 건물만, 유속이 문턱을 넘는 것만, NB_MAX 채까지.
 * 대상에서 빼는 것: 터·출동 시설(이웃 목록이 이미 뺐다) · 화재 현장의 틀이 없는 종류(평소 화재의 장소 표에 없는 종류) · 쓸 수 없는 건물(전소·전체 붕괴) · 이번 교대에 이미 불이 난 건물.
 * 열린 사건이 있는 건물은 내놓는다(틀이 기다리게 한다 — 같은 건물에 현장을 둘 열지 않는다)
 */
export function heatTargets(sim: Sim, visit: (target: number, gap: number, F: number, rate: number, inc: number, ref: number) => void): void {
  let burned: Set<number> | null = null;
  const places = sim.city.places;
  for (const I of sim.incidents) {
    if (I.phase === 'closed') continue;
    const s = sim.scenes[I.id];
    if (!s || s.archived) continue;
    const F = fireLoad(s);
    if (F < HEAT.F_MIN) continue;
    if (!burned) burned = burnedPlaces(sim);
    const ref = I.truth.placeId;
    const nbs: readonly Nb[] = ref >= 0 ? neighborsOf(sim, ref) : neighborsOfPoint(sim, I.truth.x, I.truth.y);
    let taken = 0;
    for (let k = 0; k < nbs.length && taken < HEAT.NB_MAX; k++) {
      const nb = nbs[k], q = places[nb.id];
      const rate = heatRate(F, nb.gap, heatMul(q.kind));
      if (!(rate > 0)) break;      // 가까운 순이라 이 뒤로는 문턱을 넘지 않는다
      if (!fireTargetOk(sim, nb.id, burned)) continue;      // 화재의 틀이 없는 종류 · 이미 불이 난 건물 · 쓸 수 없는 건물 (expo.fireTargetOk — 불티 항과 같은 조건)
      taken++;
      visit(nb.id, nb.gap, F, rate, I.id, ref);
    }
  }
}

/** 넘는 순간의 불 요약을 주된 몫에서 되찾는다 (규모를 정한다 — 기다리던 줄이 뒤늦게 날 때는 그 불이 이미 꺼져 있을 수 있어 fireLoad 를 다시 읽지 않는다) */
function fAtCross(sim: Sim, target: number, main: HzPart): number {
  const q = sim.city.places[target], J = sim.incidents[main.inc];
  if (!q || !J) return 0;
  const nbs = main.ref >= 0 ? neighborsOf(sim, main.ref) : neighborsOfPoint(sim, J.truth.x, J.truth.y);
  let gap = -1;
  for (const nb of nbs) if (nb.id === target) { gap = nb.gap; break; }
  if (gap < 0) return 0;
  const d = 1 + gap / 6;
  return (main.rate / (HEAT.K * heatMul(q.kind)) + HEAT.Q0) * d * d;
}

/** 발생 기록의 첫머리 — 주된 몫의 갈래로 */
const NOTE: Partial<Record<HzWhat, string>> = { heat: '옆 건물의 불이 옮겨붙었습니다', ember: '폭발의 불티가 옮겨붙었습니다', spark: '끊어진 전선의 불꽃이 옮겨붙었습니다' };      // spark: (N8 단계 10) 살아 있는 전선의 불꽃

const acc = new Map<number, HzPart[]>();

registerHazard({
  id: 'heatSpread', label: '옮겨붙은 불', every: 1, once: true, cap: HEAT.CAP,
  scan: (sim, put) => {
    // 대상마다 열원의 몫을 모은다 (열원이 둘이면 유속이 더해진다) — 내놓는 차례는 처음 만난 차례(사건 번호 · 가까운 순)
    acc.clear();
    heatTargets(sim, (target, _gap, _F, rate, inc, ref) => {
      let parts = acc.get(target);
      if (!parts) acc.set(target, (parts = []));
      parts.push({ rate: HEAT.K * rate, ev: fireCauseEv(sim.incidents[inc]), inc, what: 'heat', ref });
    });
    for (const [target, parts] of acc) put(target, parts);
  },
  spawn: (sim, target, _cell, main): SpawnOpts | null => {
    // 그 건물의 불: 변형을 정한다(평소 추첨의 오인·방화로 뽑히지 않게). 규모는 넘는 순간의 열원 불이 크거나 불티면 2 (buildFire 는 규모로 발화점 수를 정한다)
    const severity = main.what === 'spark' ? 1 : main.what === 'ember' || Math.round(fAtCross(sim, target, main)) >= HEAT.F_BIG ? 2 : 1;      // spark: (N8 단계 10) 불꽃 하나에서 시작한 불 — 열원의 불 요약이 없다      // 불 요약은 칸 수(정수)다 — 되찾은 값의 소수 오차를 반올림한다
    return { type: 'fire', variant: 'std', severity, placeId: target, note: NOTE[main.what] ?? '옆 건물의 불이 옮겨붙었습니다' };
  },
});
