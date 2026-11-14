// 이어지는 사건(연쇄)의 상한: 달아난 용의자의 재범(강도)·도주 차량·납치범의 은신처 제보·연쇄 방화.
// 연쇄는 예약하는 곳(field/hazards 의 도주, pursuit 의 은신처, scenarios/crime 의 방화)에서 canChain 으로 확인하고,
// 상한에 걸리면 예약하지 않는다. 걸렸다는 기록도 남기지 않는다(일어나지 않은 일을 지어내지 않는다 — 달아난 용의자는 이번 교대에 다시 나타나지 않을 뿐이다).
// 상한이 없으면 극한 난이도에서 강도 ↔ 도주 차량이 서로를 낳아 한 교대에 연쇄 사건이 16건, 깊이 6까지 이어졌다.
// 이 파일은 형(type)만 가져온다: scenarios/crime.ts 가 불러도 가져오기가 돌지 않는다.
import type { Sim } from './engine';
import type { Incident } from './types';

/** 한 연쇄는 많아야 세 사건 (처음 사건 + 이어진 사건 둘). 연쇄 방화의 상한(ARSON_MAX)과 같다 */
export const CHAIN_MAX = 3;
/** 한 교대에 이어지는 사건은 많아야 이만큼 (이미 일어난 것 + 예약해 둔 것) */
export const CHAIN_SHIFT_MAX = 6;

/** 이 사건이 연쇄의 몇 번째인가 (낳은 사건을 거슬러 올라가며 센다. 처음 사건은 1) */
export function chainLen(sim: Sim, I: Incident): number {
  let n = 1;
  for (let J = I; J.parent !== undefined && n < 50; J = sim.incidents[J.parent]) n++;
  return n;
}

/** 이번 교대에 이어진 사건의 수 (예약해 두고 아직 일어나지 않은 것 포함) */
export function chainedInShift(sim: Sim): number {
  let n = sim.gen.chain.length;
  for (const J of sim.incidents) if (J.parent !== undefined) n++;
  return n;
}

/** 사건 I 에서 사건을 하나 더 이을 수 있는가 */
export function canChain(sim: Sim, I: Incident): boolean {
  return chainLen(sim, I) < CHAIN_MAX && chainedInShift(sim) < CHAIN_SHIFT_MAX;
}
