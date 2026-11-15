// 인과 규칙의 신호 자리 (설계서 I1 §3.10 — "X6 와 함께 넣을 부분").
// 지금은 빈 함수와 타입뿐이다: X6(위험의 현실화)가 폭발·붕괴·전소를 만드는 자리마다 signal(sim, 'catastrophe', …) 한 줄을 남기고,
// I1-b 가 이 파일에 내용(세계 상태 sim.world, 규칙 registerConsequence)을 채운다. 빈 함수라 결과는 바뀌지 않는다.
// SignalKind 는 아직 types.ts 에 없으므로 같은 합집합을 여기 둔다 — I1-b(b2)가 그 정의를 types.ts 로 옮기고
// 여기서는 `export type { SignalKind } from '../types'` 로 다시 내보낸다 (부르는 쪽의 import 는 그대로 컴파일된다).

import type { Sim } from '../engine';

export type SignalKind = 'blast' | 'collapse' | 'fireBig' | 'delivered' | 'fled' | 'closed' | 'catastrophe';

/**
 * 세계에 일어난 일을 알린다. 'catastrophe' 의 data = 0 폭발 · 1 붕괴 · 2 전소, size = 폭발 반경(칸) 또는 무너진 칸 수.
 * (I1-b 전에는 아무것도 하지 않는다.)
 */
export function signal(sim: Sim, kind: SignalKind, s: { inc: number; ev: number; x?: number; y?: number; size?: number; place?: number; data?: number }): void {}
