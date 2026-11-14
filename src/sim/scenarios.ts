// 시나리오 — 같은 유형 안에서 갈리는 사건의 모습.
// 유형(type)은 관제와 현장 AI의 큰 규칙을 정하고, 시나리오(variant)는 신고 내용, 일어나는 곳,
// 현장의 생김새, 필요한 자원을 바꾼다. 새 시나리오는 여기에 한 줄을 더하고 현장 생성(builders.ts)에 모습을 적는다.

import type { IncidentType, PlaceKind } from './types';
import { TYPE_NAME } from './util';

export interface Scenario {
  type: IncidentType; variant: string; name: string;
  share: number;                 // 그 유형의 사건 가운데 이 시나리오가 차지하는 몫
  nature: string; vague: string; // 제대로 아는 신고자가 말하는 내용 / 잘 모르는 신고자가 말하는 내용 (callSystem 의 NATURE 키)
  severity: [number, number];
  places?: Partial<Record<PlaceKind, number>>;      // 일어나는 곳(건물 종류의 몫). 없으면 유형의 표(cityPlan.INCIDENT_PLACES)를 쓴다
}

export const SCENARIOS: Scenario[] = [
  { type: 'traffic', variant: 'tree', name: '쓰러진 나무', share: 0.14, nature: 'treefall', vague: 'bang', severity: [1, 2] },
  { type: 'traffic', variant: 'manhole', name: '맨홀 추락', share: 0.07, nature: 'manhole', vague: 'scream', severity: [2, 2] },
  { type: 'traffic', variant: 'drunk', name: '난폭 운전', share: 0.09, nature: 'reckless', vague: 'bang', severity: [1, 2] },
  { type: 'armed', variant: 'kidnap', name: '납치', share: 0.08, nature: 'kidnap', vague: 'scream', severity: [3, 3], places: { houseS: 3, villa: 3, apartment: 3, park: 2, cafe: 1, shop: 1, convenience: 1, station: 1, busTerminal: 1, university: 1.5, mart: 1, beach: 0.6 } },
  { type: 'collapse', variant: 'elevator', name: '승강기 갇힘', share: 0.32, nature: 'elevator', vague: 'scream', severity: [1, 2], places: { apartment: 6, office: 5, officetel: 4, hotel: 2, deptStore: 1.5, university: 0.8, clinic: 0.4, station: 0.6 } },
  { type: 'armed', variant: 'domestic', name: '가정 폭력', share: 0.16, nature: 'domestic', vague: 'scream', severity: [2, 2], places: { houseS: 5, houseL: 2.5, villa: 5, apartment: 5, officetel: 1.5, farmhouse: 0.8 } },
  { type: 'armed', variant: 'burglary', name: '침입 절도', share: 0.14, nature: 'burglar', vague: 'bang', severity: [1, 2], places: { houseS: 4, houseL: 4, villa: 2, shop: 3, cafe: 1, convenience: 1, office: 2, workshop: 1.5, clinic: 0.8, museum: 0.8 } },
];

/** 예전부터 있던 변형의 이름 */
const VARIANT_NAME: Record<string, string> = {
  'traffic/bus': '버스 추돌', 'armed/robbery': '강도', 'armed/dispute': '난동', 'armed/shooter': '총격', 'armed/hostage': '인질극', 'armed/prank': '장난 전화',
  'fire/false': '화재 오인 신고', 'search/wander': '실종', 'search/hiker': '조난', 'medical/arrest': '심정지', 'medical/trauma': '낙상·외상', 'medical/faint': '실신',
};

export function scenarioOf(type: IncidentType, variant: string): Scenario | undefined { return SCENARIOS.find((q) => q.type === type && q.variant === variant); }
/** 사건의 실제 모습을 가리키는 이름 (관찰자 정보와 보고서에 쓴다) */
export function scenarioName(type: IncidentType, variant: string): string { return scenarioOf(type, variant)?.name ?? VARIANT_NAME[`${type}/${variant}`] ?? TYPE_NAME[type]; }

/** 신고 내용으로 관제가 사건에 붙이는 이름. 그 내용이 가리키는 유형과 관제의 판단이 같을 때만 쓴다. */
export const NATURE_LABEL: Record<string, [IncidentType, string]> = {
  treefall: ['traffic', '쓰러진 나무'], manhole: ['traffic', '맨홀 추락'], elevator: ['collapse', '승강기 갇힘'], domestic: ['armed', '가정 폭력'], burglar: ['armed', '침입 절도'],
  kidnap: ['armed', '납치'], reckless: ['traffic', '난폭 운전'],
  robbery: ['armed', '강도'], hostage: ['armed', '인질극'], gunshots: ['armed', '총격'], notbreathing: ['medical', '심정지'],
};
