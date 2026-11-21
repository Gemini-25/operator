// L4 smokeIll — 연기를 오래 마신 동네에서는 환자가 난다 (설계서 I1 §3.7 L4 · 틀은 world/hazard.ts §3.6a).
//
// 읽는 상태: 연기가 덮은 자리(world.spans 의 연기 줄 — 상태 규칙 world/rules/infra.ts 의 smokePlume 이 놓는다: 자리 at · 세기 v · 불이 난 건물 ref)와
// 그 안 건물의 **평소 응급률**(base_p — 평소 응급의 장소 표에서 그대로: 인구의 대용치를 따로 만들지 않는다. 그 표가 이미 "어느 집에서 환자가 나는가"다).
// **그 연기를 무엇이 만들었는지는 식에 쓰지 않는다** — 건물 화재든 대형 화재든 산불이든 같은 연기다. 원인은 귀속에만 쓰인다:
// 몫 { ev: 연기 알림 기록, inc: 그 화재 사건(산불이면 −1), what: 'smoke', ref: 불이 난 건물 }.
//
// 식: λ_p = base_p × RR × c (초당), c = 그 자리의 세기 × (1 − 거리 / 반경) — 매초 건물마다 구역 값을 묻지 않고 그 자리의 대상 목록에서 바로 계산한다(설계서 §3.6a "주기와 비용").
// 대상: 연기 자리마다 가까운 주거 건물 ILL.MAX 채까지 — 목록은 그 자리가 생기거나 자리·반경이 바뀔 때만 만든다(expo.smokeTargets).
//       불이 난 그 건물(그 건물의 연기 환자는 화재 현장의 구조 대상이다)·열린 사건이 있는 건물·쓸 수 없는 건물은 뺀다(expo.smokeExposure).
// 주기 1초, 건물마다 몇 번이고(once 가 아니다) — 문턱의 흐름 hz:smokeIll:<건물>:<n>. 상한: 법칙 CAP · 한 뿌리의 가지(옮겨붙은 불과 함께 — hazard.hazardRoom).
// 나는 사건: 연기를 마신 주민(응급의 변형 — 실신의 틀 · 처음 부상 원인 연기 흡입 · 급변 없음), 그 건물, 규모 1.
//
// 이 파일은 등록만 한다(world/laws/index.ts 가 모은다). src/sim 의 다른 모듈은 이 파일을 import 하지 않는다 — 식(ILL·smokeBase·smokeTargets·smokeExposure)은 등록이 없는 world/expo.ts 에 있다.

import type { SpawnOpts } from '../../incidents';
import { ILL, smokeExposure } from '../expo';
import { registerHazard } from '../hazard';
import type { HzPart } from '../hazard';

/** 이 법칙이 낸 환자의 교대 상한 (설계서 §3.7 L4 — 3. 등록할 때 한 번 읽힌다) */
export const SMOKE_ILL = { CAP: 3 };

const acc = new Map<number, HzPart[]>();

registerHazard({
  id: 'smokeIll', label: '연기를 마신 주민', every: 1, once: false, cap: SMOKE_ILL.CAP,
  scan: (sim, put) => {
    // 건물마다 연기 자리의 몫을 모은다 (연기 둘이 겹치면 몫이 둘) — 내놓는 차례는 처음 만난 차례(장부 줄 · 가까운 순)
    acc.clear();
    smokeExposure(sim, (target, c, base, sp) => {
      let parts = acc.get(target);
      if (!parts) acc.set(target, (parts = []));
      parts.push({ rate: base * ILL.RR * c, ev: sp.cause, inc: sp.inc, what: 'smoke', ref: sp.ref ?? -1 });
    });
    for (const [target, parts] of acc) put(target, parts);
  },
  spawn: (_sim, target): SpawnOpts | null => ({ type: 'medical', variant: 'smoke', severity: 1, placeId: target, note: '연기를 마신 주민이 숨쉬기 힘들어합니다' }),
});
