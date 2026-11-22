// 사건 유형의 화면 표 (docs/specs/N8-incident-kinds.md §5.1). 시뮬레이션 쪽 자료(sim/incidentTypes.ts)와 나눠 둔다 — 색이 시뮬레이션의 표에 들어가지 않게.
// 지도의 핀·테두리·통제 구간의 원인 색, 사건 카드, 확률 막대가 모두 이 표를 읽는다 (예전에는 renderCity·trafficLayer 에 같은 표가 둘 있었다).

import { TYPE_DEFS } from '../sim/incidentTypes';
import type { IncidentType } from '../sim/types';

/** 유형색 ('unknown' = 아직 유형을 모르는 사건). 새 유형을 더하면 tsc 가 이 표의 줄을 요구한다 */
export const TYPE_COLOR: Record<IncidentType | 'unknown', string> = { fire: '#ff6b3d', traffic: '#ffc24a', search: '#58d68d', armed: '#b98cff', medical: '#ff7eb6', collapse: '#d6a878', hazmat: '#b6e04a', water: '#4fb8ff', unknown: '#9aa7b4',
  utility: '#22c9d6',      // (N8 단계 4a) 시설 사고 — 청록 (설계서 §4.1: 기존 여덟 색·회색에서 CIEDE2000 17 이상)
  animal: '#a0703c' };      // (N8 단계 5) 동물 — 갈색

/** 핀의 경과 고리가 한 바퀴를 도는 시간(초): 그 유형의 대응 지연 기준(TYPE_DEFS.respLimit). 모르는 유형은 100 */
export function respLimitOf(type: IncidentType | 'unknown'): number { return type === 'unknown' ? 100 : TYPE_DEFS[type].respLimit; }
