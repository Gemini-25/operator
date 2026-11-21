// L3 (다) structFail · pipeLeak — 손상된 건물은 그 손상만큼 위험하다 (설계서 I1 §3.7 L3 · 틀은 world/hazard.ts §3.6a · 손상은 world/expo.ts §3.6c).
//
// "건물이 붕괴되어서 더 큰 사고로 이어진다"의 마지막 화살표다. (가) 충격이 이웃 건물에 손상을 남기고(상태 규칙 rules/structure.ts 의 shockSpread),
// (나) 그 건물의 다음 현장이 그만큼 약하게 시작하며(expo.applyExpo), (다) 손상 자체가 그 건물의 위험률을 올린다 — 이 파일.
// (다)가 없으면 사용자의 예는 거의 보이지 않는다: 손상된 이웃 1~3채에서 "나중에 우연히" 사건이 날 확률은 3% 안팎이다 (조사).
//
// 읽는 상태: 사건이 없던 건물이 이웃에서 받은 손상(world.expo — 구조 손상 shake · 가스 배관 손상 pipe)과 그 건물을 지금 쓸 수 있는가(state.placeState).
// **손상을 무엇이 만들었는지는 식에 쓰지 않는다** — 전체 붕괴든 무너진 채 시작한 사건이든 가스·용기·분진 폭발이든 폭발물이든 금이 같으면 같다.
// 원인은 귀속에만 쓰인다: 몫 { ev: 그 손상을 남긴 기록(금 기록의 원인 shakeEv · 배관 손상 기록 pipeEv), inc: 가장 크게 흔든 사건(shakeInc), what, ref: 그 건물 }.
//
//   structFail  금 간 건물이 내려앉는다:  λ = STRUCT.A × (shake − S_MIN) (초당)       → collapse/std, 규모는 금의 크기
//   pipeLeak    끊긴 배관에서 가스가 샌다: λ = PIPE.A (새는 가스는 곧 누군가 맡는다)  → hazmat/std
// 둘 다 1초 주기 · 건물마다 교대에 한 번(once — 흐름 hz:<법칙>:<건물>). 대상은 world.expo 에서 조건에 맞는 건물(건물 id 순, 많아야 MAX).
// 건물 한 채의 평소 붕괴율·누출율은 10⁻⁷/초 자리라 배율로 쓰지 않는다 — 손상의 양에 비례하는 위험률이다.
// 되먹임: 붕괴(0) → 옆 건물의 붕괴·누출(1) → 그 건물의 폭발·붕괴가 다시 흔든 건물(2)에서 끊기고, 한 뿌리의 법칙 사건은 둘까지다(hazard.hazardRoom).
// 금(shake)에는 회복이 없다(교대 안에서 저절로 붙지 않는다) — 대신 건물마다 한 번이다. 배관은 그 누출 사건이 '해결'로 닫히면 거둔다(rules/structure.ts 의 pipeShut).
//
// buildCollapse·buildHazmat 은 모든 건물 종류의 틀을 받는다(b3-8c 에서 확인 — 종류마다 현장을 만들어 모든 바닥에 걸어서 닿는다) — 그래서 종류로 대상을 거르지 않는다.
// 이 파일은 등록만 한다(world/laws/index.ts 가 모은다). src/sim 의 다른 모듈은 이 파일을 import 하지 않는다.

import type { Sim } from '../../engine';
import type { SpawnOpts } from '../../incidents';
import type { PlaceExpo } from '../../types';
import { SHOCK } from '../expo';
import { registerHazard } from '../hazard';
import type { HzPart } from '../hazard';
import { placeState } from '../state';

/**
 * 법칙의 세기와 사건의 크기 (모두 첫 값 — 설계서 §3.7 L3. 시험이 A 를 키워 쓴다. CAP 은 등록할 때 한 번 읽힌다):
 *  STRUCT.A    금이 S_MIN 을 1 넘는 동안 1초에 쌓이는 위험 (금 0.4 인 건물은 10분에 16%, 0.31 이면 500초에 10%)
 *  STRUCT.SEV2 · SEV3  이 금부터 규모 2 · 3 의 붕괴 · MAX 한 주기에 훑는 건물 수 · CAP 이 법칙이 낸 붕괴의 교대 상한
 *  PIPE.A      배관이 끊긴 동안 1초에 쌓이는 위험 (1/300 — 5분 안에 63%) · PIPE.SEV2 이 금부터 규모 2 의 누출
 */
export const STRUCT = { A: 1.0e-3, SEV2: 0.3, SEV3: 0.45, MAX: 16, CAP: 2 };
export const PIPE = { A: 1 / 300, SEV2: 0.4, MAX: 16, CAP: 2 };

/** 손상된 건물을 건물 id 순으로 내놓는다 — ok 를 지나고 쓸 수 있는 건물만, 많아야 max 채 (world.expo 를 읽기만 한다 — 노출 칸을 만들지 않는다) */
function damaged(sim: Sim, max: number, ok: (e: PlaceExpo) => boolean, visit: (id: number, e: PlaceExpo) => void): void {
  const ex = sim.world.expo;
  let n = 0;
  for (const k in ex) {      // 정수 열쇠 — 오름차순으로 돈다 (건물 id 순)
    if (n >= max) break;
    const e = ex[k];
    if (!ok(e)) continue;
    const id = +k;
    if (placeState(sim, id)?.usable === false) continue;      // 다 탔거나 통째로 무너진 건물에서는 더 날 것이 없다
    n++;
    visit(id, e);
  }
}

const buf: HzPart[] = [];

registerHazard({
  id: 'structFail', label: '금 간 건물의 붕괴', every: 1, once: true, cap: STRUCT.CAP,
  scan: (sim, put) => {
    damaged(sim, STRUCT.MAX, (e) => e.shake >= SHOCK.S_MIN, (id, e) => {
      buf.length = 0;
      buf.push({ rate: STRUCT.A * (e.shake - SHOCK.S_MIN), ev: e.shakeEv, inc: e.shakeInc, what: 'shake', ref: id });
      put(id, buf);
    });
  },
  spawn: (_sim, target, _cell, main): SpawnOpts | null => {
    // 규모는 넘는 순간의 금에서 (주된 몫의 rate 에서 되찾는다 — 기다리던 줄이 뒤늦게 날 때도 넘는 순간의 값)
    const shake = main.rate / STRUCT.A + SHOCK.S_MIN;
    const severity = shake >= STRUCT.SEV3 ? 3 : shake >= STRUCT.SEV2 ? 2 : 1;
    return { type: 'collapse', variant: 'std', severity, placeId: target, note: '금이 가 있던 건물이 내려앉았습니다' };
  },
});
