// 추격전으로 시작하는 사건: 납치, 난폭 운전 (pursuit.ts)
import type { Scenario } from '../scenarios';

export const CHASE: Scenario[] = [
  { type: 'traffic', variant: 'drunk', name: '난폭 운전', share: 0.09, nature: 'reckless', vague: 'bang', severity: [1, 2], tag: 'chase',
    texts: ['차 한 대가 비틀거리면서 미친 듯이 달리고 있어요. 곧 사고 날 것 같아요.', '음주 운전 같아요. 중앙선을 넘나들면서 달려요!'], lik: { fire: 0.005, traffic: 0.86, search: 0.01, armed: 0.09, medical: 0.02, collapse: 0.005, hazmat: 0.005, water: 0.005 },
    needs: (n, c) => { if (c.nat.indexOf('crash') >= 0) return; n.traffic = 0; n.law = 2; n.ems = 0; n.rescue = 0; } },      // 한 대는 쫓고 한 대는 앞을 막는다
  { type: 'armed', variant: 'kidnap', name: '납치', share: 0.08, nature: 'kidnap', vague: 'scream', severity: [3, 3], tag: 'chase',
    places: { houseS: 3, villa: 3, apartment: 3, park: 2, cafe: 1, shop: 1, convenience: 1, station: 1, busTerminal: 1, university: 1.5, mart: 1, beach: 0.6 },
    texts: ['어떤 사람들이 사람을 차에 억지로 태우고 달아났어요!', '납치예요! 사람을 차에 밀어 넣고 그대로 출발했어요!'], lik: { fire: 0.005, traffic: 0.03, search: 0.08, armed: 0.86, medical: 0.01, collapse: 0.005, hazmat: 0.005, water: 0.005 },
    needs: (n, c) => { n.law = 2; n.tactical = c.sev >= 2.5 ? 1 : 0; n.search = 1; n.ems = 0; } },      // 쫓을 순찰차와, 하늘에서 볼 헬기
];
