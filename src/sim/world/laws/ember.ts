// L7 rekindle — 덜 식은 불 자리는 다시 붙는다 (설계서 I1 §3.7 L7 · 틀은 world/hazard.ts §3.6a).
//
// 충격만 받는 법칙이다(scan 이 없다): 닫힌 현장에 실제로 남은 불씨와 열(expo.residualOf — e0)이 식어 가는 동안의 위험은 닫힌 꼴의 식이라 매초 적분하지 않는다.
// 닫히는 순간(신호 'closed') 상태 규칙 residualHeat(world/rules/structure.ts)가 끝내 닿는 위험 H∞ = K × e0 × τ 를 그 건물의 칸 하나에 충격으로 더하고,
// 문턱을 넘으면 넘는 시각 Δt* = −τ × ln(1 − 문턱 / H∞) 만큼 미뤄 사건을 예약한다(hazardImpulse 의 delay — 그동안 그 건물에 사건이 열리면 기다리고, 마감이 지나면 버린다).
// **그 열을 무엇이 남겼는지는 식에 쓰지 않는다** — 한계 시간·방치로 끝난 화재든, 닿지 못해 잔불 정리를 건너뛴 구역이든, 진입 금지로 남긴 구획이든,
// 무너진 구획 밑의 불씨든, 물이 떨어져 접은 진압이든, 화재가 아닌 현장(가스 폭발·붕괴)에 남은 불이든 남은 열이 같으면 같다. 잔불 정리를 마친 구역은 열 0 · 젖음 0.9 라 저절로 0 이다.
// 대상은 건물, 건물마다 교대에 한 번(once — 흐름 hz:rekindle:<건물>). 낸 불은 그 건물의 화재(부모 = 닫힌 그 사건, 원인 = 그 종료 기록).
// 정직한 값: 잘 끈 화재는 닫힐 때 불 칸 0 · 뜨거운 칸이 거의 없다 — 보통 교대의 재발화는 거의 0건이다(한계 시간·방치·진입 금지로 끝난 화재에서만).
// 잘 끈 화재에서도 나오게 하는 새 물리(탄 칸의 잔열)는 N9 뒤 화재 균형 때 정한다(사용자 결정 — 설계서 §9). '재발화' 이름표는 넣지 않는다(§3.7 L7).
//
// 이 파일은 등록만 한다(world/laws/index.ts 가 모은다). src/sim 의 다른 모듈은 이 파일을 import 하지 않는다 — 충격의 크기(RESIDUAL·residualOf)는 등록이 없는 world/expo.ts 에 있다.

import type { SpawnOpts } from '../../incidents';
import { registerHazard } from '../hazard';

/** 이 법칙이 낸 불의 교대 상한 (설계서 §3.7 L7 — 2) */
export const REKINDLE = { CAP: 2 };

registerHazard({
  id: 'rekindle', label: '되살아난 잔불', every: 1, once: true, cap: REKINDLE.CAP,
  spawn: (_sim, target): SpawnOpts | null => ({ type: 'fire', variant: 'std', severity: 1, placeId: target, note: '잔불이 되살아나 다시 불길이 올랐습니다' }),
});
