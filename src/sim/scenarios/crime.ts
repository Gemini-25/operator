// 강력 범죄: 폭발물, 대형 인질극, 폭동, 연쇄 방화 (docs/specs/N4b-crime.md)
import type { Scenario } from '../scenarios';
import type { Needs, PlaceKind } from '../types';

// ── 폭발물 ──
// 협박 전화(bombthreat)와 진짜 폭발물(bomb)은 신고 내용이 같다: 관제는 둘을 구별하지 못하고, 현장을 뒤져 봐야 안다.
const BOMB_PLACES: Partial<Record<PlaceKind, number>> = { station: 3, terminal: 3, deptStore: 3, busTerminal: 2, ferry: 1, mart: 2, bank: 2, office: 3, hotel: 1.5, stadium: 1.5, broadcast: 1, university: 2, market: 1.5, powerPlant: 0.6 };
const bombNeeds = (n: Needs): void => { n.law = 2; n.eod = 1; n.ems = 1; n.suppression = 1; n.tactical = 0; };      // 수색·통제할 경찰, 처리반, 터졌을 때를 대비한 구급·진압

export const CRIME: Scenario[] = [
  { type: 'armed', variant: 'bomb', name: '폭발물', share: 0.04, nature: 'bombthreat', vague: 'bang', severity: [3, 3], tag: 'crime', places: BOMB_PLACES, label: '폭발물 의심', limit: 120,
    texts: ['폭탄을 설치했다는 전화를 받았어요.', '건물을 폭파하겠다는 협박 전화가 왔어요.'], lik: [0.03, 0.005, 0.005, 0.9, 0.01, 0.02, 0.025, 0.005], needs: bombNeeds },
  { type: 'armed', variant: 'bombthreat', name: '폭파 협박', share: 0.04, nature: 'bombthreat', vague: 'bang', severity: [2, 3], tag: 'crime', places: BOMB_PLACES, label: '폭발물 의심', limit: 120 },      // 문구·가능도·필요 자원은 위의 줄과 같은 키다
  { type: 'armed', variant: 'package', name: '수상한 물건', share: 0.04, nature: 'package', vague: 'bang', severity: [2, 3], tag: 'crime', places: BOMB_PLACES, label: '폭발물 의심', limit: 120,
    texts: ['주인 없는 가방이 한참째 놓여 있어요.', '수상한 상자에서 소리가 나요.'], lik: [0.02, 0.01, 0.01, 0.88, 0.02, 0.02, 0.035, 0.005], needs: bombNeeds },
];
