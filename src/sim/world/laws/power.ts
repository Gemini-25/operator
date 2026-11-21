// L5 liftStall — 정전이 닿는 순간 운행 중이던 승강기 (설계서 I1 §3.7 L5 · 틀은 world/hazard.ts §3.6a).
//
// 충격만 받는 법칙이다(scan 이 없다): 건물에 정전이 닿는 **순간**(전이) 그 건물의 승강기에 사람이 타고 있을 기대값만큼의 위험을 그 건물의 칸 하나에 더하고,
// 문턱(흐름 hz:liftStall:<건물> — "그 건물의 승강기가 그 순간 얼마나 붐볐는가"를 건물마다 한 번 뽑은 값)을 넘으면 그 건물에 승강기 갇힘이 난다.
// 충격을 주는 자리는 expo.darkened — 정전을 거는 규칙들(rules/infra.ts 의 C4: 변전소·발전소 사고 · 끊긴 전선 · 지진 · 태풍, b3-12 의 잠긴 지하)이 그 순간 새로 꺼진 건물로 부른다.
// **누가 껐는지는 식에 쓰지 않는다** — 크기는 층수·건물 종류·시간대(expo.liftDelta)뿐이고, 원인은 귀속에만 쓰인다: 몫 { ev: 정전을 만든 기록, inc: 그 정전의 주인 사건(-1 — 태풍·지진), what 'outage' }.
// 대상: 4층 이상이고 승강기 갇힘 시나리오가 받는 종류의 쓸 수 있는 건물(expo.liftPlaces), 건물마다 교대에 한 번(once). 그 건물에 열린 사건이 있거나 부하가 한도를 넘으면 틀이 기다리게 한다(기다리는 줄 — 마감 LIFT_LAW.HOLD).
// 건물 한 채의 평소 승강기 갇힘률은 교대당 0.0013건(아파트) 자리라 배율로 쓰지 않는다 — 정전이 닿은 순간의 충격량이다.
//
// 이 파일은 등록만 한다(world/laws/index.ts 가 모은다). src/sim 의 다른 모듈은 이 파일을 import 하지 않는다 — 충격의 크기(LIFT·liftDelta)는 등록이 없는 world/expo.ts 에 있다.

import type { SpawnOpts } from '../../incidents';
import { registerHazard } from '../hazard';

/**
 * 이 법칙이 낸 승강기 갇힘의 교대 상한 (설계서 §3.7 L5 — 3) · HOLD 문턱을 넘고 자리를 기다리는 마감(초 — 틀의 HZ.HOLD 60 이 아니다):
 * 태풍 정전은 충격 단계 한가운데라 열린 사건이 처리 한도(tune.maxConcurrent)를 정전 뒤 300~390초 넘는다(보통 8~9건 / 5 — 재난 큐는 +4 까지 연다).
 * 60초면 태풍 20교대의 넘음 23 이 모두 마감으로 버려졌다. 갇힌 사람은 그대로 기다리고 신고는 부하가 풀린 뒤 접수된다 — 기다림은 시뮬레이션의 자리 문제다(§3.6a)
 */
export const LIFT_LAW = { CAP: 3, HOLD: 420 };

registerHazard({
  id: 'liftStall', label: '정전으로 멈춘 승강기', every: 1, once: true, cap: LIFT_LAW.CAP, hold: LIFT_LAW.HOLD,
  spawn: (_sim, target): SpawnOpts | null => ({ type: 'collapse', variant: 'elevator', severity: 1, placeId: target, note: '정전으로 승강기가 멈춰 안에 사람이 갇혔습니다' }),
});
