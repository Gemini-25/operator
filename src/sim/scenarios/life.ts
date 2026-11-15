// 생활 사건: 쓰러진 나무, 맨홀 추락, 승강기 갇힘, 가정 폭력, 침입 절도
import type { Scenario } from '../scenarios';

export const LIFE: Scenario[] = [
  { type: 'traffic', variant: 'tree', name: '쓰러진 나무', share: 0.14, nature: 'treefall', vague: 'bang', severity: [1, 2], tag: 'life',
    texts: ['큰 나무가 쓰러져서 도로를 완전히 막았어요!', '가로수가 넘어졌어요. 차가 밑에 깔린 것 같아요!'], lik: { fire: 0.02, traffic: 0.8, search: 0.02, armed: 0.01, medical: 0.05, collapse: 0.08, hazmat: 0.01, water: 0.01 },
    needs: (n, c) => { n.rescue = 1; n.traffic = 1; n.ems = c.hurt || c.trapped ? 1 : 0; } },
  { type: 'traffic', variant: 'manhole', name: '맨홀 추락', share: 0.07, nature: 'manhole', vague: 'scream', severity: [2, 2], tag: 'life',
    texts: ['사람이 맨홀에 빠졌어요! 아래에서 소리가 나요.', '뚜껑이 열린 맨홀에 사람이 떨어졌어요.'], lik: { fire: 0.01, traffic: 0.55, search: 0.05, armed: 0.01, medical: 0.25, collapse: 0.11, hazmat: 0.01, water: 0.01 },
    needs: (n) => { n.rescue = 1; n.ems = 1; n.traffic = 1; } },
  { type: 'collapse', variant: 'elevator', name: '승강기 갇힘', share: 0.32, nature: 'elevator', vague: 'scream', severity: [1, 2], tag: 'life',
    places: { apartment: 6, office: 5, officetel: 4, hotel: 2, deptStore: 1.5, university: 0.8, clinic: 0.4, station: 0.6 },
    texts: ['승강기가 멈췄어요. 안에 사람들이 갇혔어요!', '엘리베이터가 층 사이에 서서 문이 안 열려요. 안에서 살려 달래요.'], lik: { fire: 0.03, traffic: 0.01, search: 0.01, armed: 0.01, medical: 0.12, collapse: 0.8, hazmat: 0.01, water: 0.01 },
    needs: (n) => { n.suppression = 0; n.rescue = 1; n.ems = 1; } },
  { type: 'armed', variant: 'domestic', name: '가정 폭력', share: 0.16, nature: 'domestic', vague: 'scream', severity: [2, 2], tag: 'life',
    places: { houseS: 5, houseL: 2.5, villa: 5, apartment: 5, officetel: 1.5, farmhouse: 0.8 },
    texts: ['옆집에서 심하게 싸우는 소리가 나요. 비명도 들려요!', '가족이 흉기를 들고 식구들을 위협하고 있어요.'], lik: { fire: 0.01, traffic: 0.01, search: 0.01, armed: 0.86, medical: 0.09, collapse: 0.01, hazmat: 0.005, water: 0.005 },
    needs: (n, c) => { n.law = c.sev >= 2.2 ? 2 : 1; n.tactical = 0; n.ems = 1; } },
  { type: 'armed', variant: 'burglary', name: '침입 절도', share: 0.14, nature: 'burglar', vague: 'bang', severity: [1, 2], tag: 'life',
    places: { houseS: 4, houseL: 4, villa: 2, shop: 3, cafe: 1, convenience: 1, office: 2, workshop: 1.5, clinic: 0.8, museum: 0.8 },
    texts: ['집에 누가 들어온 것 같아요. 안에서 뒤지는 소리가 나요.', '문이 부서져 있고 안에 모르는 사람이 있어요.'], lik: { fire: 0.02, traffic: 0.01, search: 0.03, armed: 0.9, medical: 0.02, collapse: 0.01, hazmat: 0.005, water: 0.005 },
    needs: (n, c) => { if (c.nat.indexOf('gunshots') >= 0) return; n.law = c.sev >= 1.7 ? 2 : 1; n.tactical = 0; n.ems = c.hurt ? 1 : 0; } },
];
