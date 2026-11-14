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
  // ── 대형 인질극: 총을 든 여럿이 여러 사람을 붙잡고 있다. 기동대 둘과 구급 둘을 처음부터 보낸다 ──
  { type: 'armed', variant: 'siege', name: '대형 인질극', share: 0.04, nature: 'siege', vague: 'scream', severity: [3, 3], tag: 'crime', label: '인질극(다수)', limit: 120,
    places: { terminal: 2, deptStore: 2, bank: 3, broadcast: 1.5, university: 1.5, busTerminal: 1.5, office: 2 },
    texts: ['무장한 사람들이 사람들을 붙잡고 있어요! 여러 명이에요!', '총 든 사람들이 건물을 점거했어요. 안에 사람들이 갇혀 있어요.'], lik: [0.01, 0.01, 0.01, 0.96, 0.01, 0.01, 0.01, 0.01],
    needs: (n) => { n.law = 2; n.tactical = 2; n.ems = 2; } },
];
