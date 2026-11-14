// 소품의 다른 모습(Prop.skin)을 그리는 함수 모음.
// 같은 규칙(예: 치워야 하는 도로 잔해, 사람이 탄 차량)에 다른 그림을 입힐 때 쓴다. 묶음별 파일(skins/*.ts)이 표를 내보내면 여기서 합친다.
// 그리는 함수는 소품의 가운데가 원점이고 1 = 한 칸인 좌표계에서 그린다(소품의 각도만큼 이미 돌아가 있다).

import type { Prop } from '../../sim/types';
import type { G } from './common';
import { CRIME_SKINS } from './skins/crime';
import { DISASTER_SKINS } from './skins/disaster';
import { MAJOR_SKINS } from './skins/major';
import { drawFallenTree, drawManhole } from './sprites';

/** timeMs = 화면 시계(깜박임·흔들림용), truth = 관찰자 시점인가, simT = 시뮬레이션 시각(sim.t) */
export type SkinPainter = (g: G, p: Prop, timeMs: number, truth: boolean, simT: number) => void;
export const SKINS: Record<string, SkinPainter> = {
  tree: (g, p) => drawFallenTree(g, p.id, p.y),
  manhole: (g) => drawManhole(g),
  ...CRIME_SKINS, ...MAJOR_SKINS, ...DISASTER_SKINS,
};
