// 이어지는 사건(연쇄)의 상한: 달아난 용의자의 재범(강도)·도주 차량·납치범의 은신처 제보·연쇄 방화.
// 연쇄는 예약하는 곳(field/hazards 의 도주, pursuit 의 은신처, scenarios/crime 의 방화)에서 canChain 으로 확인하고,
// 상한에 걸리면 예약하지 않는다. 걸렸다는 기록도 남기지 않는다(일어나지 않은 일을 지어내지 않는다 — 달아난 용의자는 이번 교대에 다시 나타나지 않을 뿐이다).
// (I1-b) 걸린 수는 gen.dropped 에만 적는다(noteChainDrop — 기록이 아니다. 보고서의 '일어나지 않은 연쇄 n건'과 측정 도구가 쓴다).
// 상한이 없으면 극한 난이도에서 강도 ↔ 도주 차량이 서로를 낳아 한 교대에 연쇄 사건이 16건, 깊이 6까지 이어졌다.
// 이 파일은 형(type)만 가져온다: scenarios/crime.ts 가 불러도 가져오기가 돌지 않는다.
import type { Sim } from './engine';
import type { Incident, IncidentType } from './types';

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

/**
 * (I1-b §3.6) 연쇄 깊이 — 뿌리 사건 0, 그 사건이 낳은 사건 1 … (= chainLen − 1 = 측정 도구의 parentDepth).
 * 깊이 상한의 정본은 이 파일의 canChain 이다: 인과 규칙이 만드는 사건(world/consequence.ts 의 spawnConsequence)도 같은 상한을 쓴다 — 상한이 둘이 되지 않게.
 */
export const DEPTH_MAX = CHAIN_MAX - 1;
export function chainDepth(sim: Sim, incId: number): number {
  const I = sim.incidents[incId];
  return I ? chainLen(sim, I) - 1 : 0;
}

/**
 * 이번 교대에 이어진 사건의 수 (예약해 두고 아직 일어나지 않은 것 포함).
 * (I1-b b2) 예약은 낳은 사건(parent)이 있는 것만 센다 — 기존 연쇄 넷은 모두 부모가 있어 예전과 같은 수다. 인과 규칙이 부모 없이 만드는 사건
 * (재난·구역이 낳는 것)은 연쇄가 아니라 world/consequence.ts 의 전체 상한(CSQ_SPAWN_CAP)이 따로 묶는다
 */
export function chainedInShift(sim: Sim): number {
  let n = 0;
  const ch = sim.gen.chain;
  for (let k = 0; k < ch.length; k++) if (ch[k].opts.parent !== undefined) n++;
  for (const J of sim.incidents) if (J.parent !== undefined) n++;
  return n;
}

/** 사건 I 에서 사건을 하나 더 이을 수 있는가 */
export function canChain(sim: Sim, I: Incident): boolean {
  return chainLen(sim, I) < CHAIN_MAX && chainedInShift(sim) < CHAIN_SHIFT_MAX;
}

/**
 * (I1-b b2) 조건은 맞았지만 상한(canChain) 때문에 잇지 못한 연쇄 하나를 gen.dropped 에 적는다 — 'depth' 사슬 길이 · 'cap' 교대 상한.
 * 기록(emit)은 지금처럼 남기지 않는다(일어나지 않은 일이다). 보고서·측정 도구가 수로만 쓴다. canChain 이 거짓인 자리에서만 부른다
 */
export function noteChainDrop(sim: Sim, I: Incident, type: IncidentType, variant: string): void {
  sim.gen.dropped.push({ t: sim.t, why: chainLen(sim, I) >= CHAIN_MAX ? 'depth' : 'cap', type, variant, parent: I.id });
}
