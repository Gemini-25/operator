// 재난의 그림 (docs/specs/N6-disaster.md). 상태(sim.disaster)를 읽기만 한다.
// 세 자리에서 불린다. 재난이 없으면 아무것도 그리지 않는다.

import type { Sim } from '../../sim/engine';
import type { Scene } from '../../sim/types';

type G = CanvasRenderingContext2D;

/** 지도의 월드 좌표계에서, 고정 지도와 도로 상태 위·부대 표식 아래 (물에 잠긴 곳, 탄 자리, 불머리, 해일 띠) */
export function drawDisasterWorld(_ctx: G, sim: Sim, _timeMs: number, _scale: number): void {
  if (!sim.disaster) return;
}

/** 지도의 화면 좌표계에서, 모든 것 위 (비바람 줄기, 연기, 지진의 흔들림 테두리, 정전의 어둠). mini = 축소 창 */
export function drawDisasterScreen(_ctx: G, sim: Sim, _w: number, _h: number, _timeMs: number, _mini: boolean): void {
  if (!sim.disaster) return;
}

/** 현장 화면에서, 날씨 다음 (비바람, 흔들림, 붉은 하늘빛) */
export function drawDisasterScene(_ctx: G, sim: Sim, _s: Scene, _w: number, _h: number, _timeMs: number, _mini: boolean): void {
  if (!sim.disaster) return;
}
