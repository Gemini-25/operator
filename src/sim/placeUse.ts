// 건물 겹침 표 읽기 (I2 단계 5 — docs/specs/I2-persistence.md §3.6). "쓸 수 있는 건물" 판정은 이 파일의 placeUsable 하나다:
// X6 의 교대 안 제외(전소·전체 붕괴 — X6 §7.1), I2 의 이어받은 출입 통제·무너짐, I1-b 의 placeState().usable 이 모두 이것을 부른다.
// 잎 모듈이다 — type 만 import 한다. 시나리오 묶음 파일(scenarios/crime.ts 의 연쇄 방화)도 부르는데, persist.ts 는 resources → dispatcher → callSystem 을 끌어와
// 시나리오 표가 초기화되기 전에 callSystem 이 SCENARIOS 를 읽는 순환이 생길 수 있다 (CLAUDE.md "시나리오 표는 추격전을 import 하지 않는다"와 같은 꼴). persist.ts 가 다시 export 한다.
// 진실 쪽(현장 생성·세계 규칙·장소 고르기)과 화면이 읽는다 — 관제·지휘 코드는 이 겹침 표를 읽지 않는다 (원칙 7 — 관제는 world/state.knownBuildingAt 으로).

import type { Sim } from './engine';
import type { PlaceCarry, Scene } from './types';

/** 그 건물이 지난 교대에서 이어받은 상태 (겹침 표 — 없으면 null). 진실 쪽(현장 생성·세계 규칙·장소 고르기)과 화면이 읽는다 — 관제·지휘 코드는 읽지 않는다 (원칙 7) */
export function placeCond(sim: Sim, id: number): PlaceCarry | null {
  const cs = sim.carryState;
  if (!cs || !cs.on) return null;
  return cs.places.get(id) ?? null;
}
/**
 * "쓸 수 있는 건물"(그 건물에서 새 사건을 낼 수 있는가)의 판정 — 이 함수 하나다. X6 의 교대 안 제외, I2 의 겹침 표, I1-b 의 placeState().usable 이 모두 이것을 부른다.
 *  inShift (기본 true) — X6 §7.1: 이번 교대에 전소·전체 붕괴한 건물은 다시 쓰지 않는다 (장소 추첨 · 정해 준 건물의 되고르기 · 은신처 후보 · 재범의 자리 · 법칙 사건을 꺼낼 때).
 *    재난의 장소 고르기와 연쇄 방화의 대상은 false 로 불러 이어받은 상태만 본다 (X6 가 그 두 곳에 검사를 두지 않았다 — 넓히면 이어받은 상태가 없는 교대의 결과가 바뀐다)
 *  이어받은 상태: 흔적(marked)은 쓴다 · 출입 통제(closed)는 allowClosed 일 때만(장소 추첨의 셋째 단계 — 그 종류가 모두 막혔을 때) · 무너짐(ruin)은 끝까지 안 된다.
 * 이어받은 상태가 없으면 X6 의 조건만 본다 (결과 불변 — 0단계 해시 목록)
 */
export function placeUsable(sim: Sim, id: number, allowClosed = false, inShift = true): boolean {
  if (inShift && sim.placeMarks.size) {
    const m = sim.placeMarks.get(id);
    if (m !== undefined && (m.state === 'collapsed' || m.state === 'burnt')) return false;
  }
  const cs = sim.carryState;
  if (!cs || !cs.on) return true;
  const pc = cs.places.get(id);
  if (pc === undefined) return true;
  return pc.state === 'marked' || (pc.state === 'closed' && allowClosed);
}

/**
 * 이어받은 그을음으로 "처음부터 탄 칸"으로 둔 칸 (persist.applyPlaceWear 가 현장을 만든 직후 한 번 적는다 — 현장 객체의 모양을 바꾸지 않게 WeakMap).
 * X6 의 catOf 가 전소 비율의 분모·분자(fuelMask)에서 이 칸을 뺀다 — 지난 교대에 탄 칸이 이번 교대의 전소를 앞당기지 않게 (I2 §3.6). 없으면 undefined
 */
const PRE_BURNT = new WeakMap<Scene, Uint8Array>();
export function preBurnt(s: Scene): Uint8Array | undefined { return PRE_BURNT.get(s); }
export function setPreBurnt(s: Scene, mask: Uint8Array): void { PRE_BURNT.set(s, mask); }
