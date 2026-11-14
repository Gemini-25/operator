// 강력 범죄: 폭발물, 대형 인질극, 폭동, 연쇄 방화 (docs/specs/N4b-crime.md)
// 이 파일은 scenarios.ts 가 맨 먼저 불러온다. 신고·사건·추격(callSystem · incidents · pursuit)을 여기서 불러오면 가져오기가 돌아 표가 만들어지기 전에 쓰이므로,
// 형(type)과 events 만 가져온다.
import type { Sim } from '../engine';
import { emit } from '../events';
import type { Scenario } from '../scenarios';
import type { Incident, Needs, Place, PlaceKind } from '../types';

// ── 폭발물 ──
// 협박 전화(bombthreat)와 진짜 폭발물(bomb)은 신고 내용이 같다: 관제는 둘을 구별하지 못하고, 현장을 뒤져 봐야 안다.
const BOMB_PLACES: Partial<Record<PlaceKind, number>> = { station: 3, terminal: 3, deptStore: 3, busTerminal: 2, ferry: 1, mart: 2, bank: 2, office: 3, hotel: 1.5, stadium: 1.5, broadcast: 1, university: 2, market: 1.5, powerPlant: 0.6 };
const bombNeeds = (n: Needs): void => { n.law = 2; n.eod = 1; n.ems = 1; n.suppression = 1; n.tactical = 0; };      // 수색·통제할 경찰, 처리반, 터졌을 때를 대비한 구급·진압

// ── 연쇄 방화 ──
const ARSON_PLACES: Partial<Record<PlaceKind, number>> = { shop: 4, warehouse: 3, market: 3, storage: 2, workshop: 2, convenience: 2, restaurant: 2, villa: 1.5 };
const ARSON_MAX = 3;      // 한 방화범이 내는 불은 많아야 세 번
/** 이 불이 연쇄의 몇 번째인가 (낳은 사건을 거슬러 올라가며 센다) */
export function arsonDepth(sim: Sim, I: Incident): number {
  let d = 1;
  for (let J = I; J.parent !== undefined && sim.incidents[J.parent].truth.variant === 'arson' && d < 9; J = sim.incidents[J.parent]) d++;
  return d;
}
/**
 * 방화 사건이 끝난 뒤: 목격자의 말을 들었으면 방화범이 잡힐 수 있고(연쇄가 이어질수록 단서가 쌓여 잘 잡힌다),
 * 못 잡았으면 가까운 같은 종류의 건물에서 불이 또 난다.
 */
function arsonNext(sim: Sim, I: Incident, reason: string): void {
  const s = sim.scenes[I.id];
  if (!s || reason === 'shiftend') return;
  const rng = sim.rng.fork('arson:' + I.id), depth = arsonDepth(sim, I);
  const heard = s.props.some((p) => p.kind === 'witness' && p.interviewed);
  if (heard && rng.chance(0.55 + 0.15 * (depth - 1))) {
    emit(sim, { inc: I.id, role: 'UNIT', actor: '경찰', kind: 'recovery', imp: 2, text: '방화 용의자 검거 — 목격자 진술로 인근에서 붙잡혔습니다.' });
    return;
  }
  if (depth >= ARSON_MAX) {
    emit(sim, { inc: I.id, role: 'SYSTEM', actor: '상황실', kind: 'incident', imp: 1, text: `방화범은 끝내 잡히지 않았습니다. ${depth}번째 불을 끝으로 자취를 감췄습니다.` });
    return;
  }
  // 다음 불: 600 안의 같은 종류 건물 (없으면 가장 가까운 것). 이미 사건이 났던 건물은 피한다
  const used = new Set(sim.incidents.map((J) => J.truth.placeId));
  const kind = I.truth.placeKind, d = (q: Place): number => Math.hypot(q.x + q.w / 2 - I.truth.x, q.y + q.h / 2 - I.truth.y);
  let pool = sim.city.places.filter((q) => q.kind === kind && !q.open && q.facility < 0 && !used.has(q.id));
  if (!pool.length) pool = sim.city.places.filter((q) => (ARSON_PLACES[q.kind] ?? 0) > 0 && !q.open && q.facility < 0 && !used.has(q.id));
  if (!pool.length) return;
  const near = pool.filter((q) => d(q) <= 600);
  const next = near.length ? rng.pick(near) : pool.reduce((a, b) => (d(b) < d(a) ? b : a));
  sim.gen.chain.push({ at: sim.t + rng.range(60, 120), opts: { type: 'fire', variant: 'arson', placeId: next.id, parent: I.id, note: '연쇄 방화로 보이는 불이 또 났습니다', rng: sim.rng.fork('arson-next:' + I.id) } });
}

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
  // ── 도주 차량: 총을 든 용의자가 현장을 빠져나가 차로 달아난다 (hazards.tickHostiles 가 예약한다). 추격전은 pursuit.ts, 시작은 incidents.createIncident ──
  { type: 'armed', variant: 'getaway', name: '도주 차량', share: 0, nature: 'getaway', vague: 'scream', severity: [2, 3], tag: 'crime', label: '도주 차량', delay: [1, 3],
    places: { bank: 3, convenience: 3, gasStation: 2, shop: 2, mart: 1, cafe: 0.5 },
    texts: ['총을 든 사람이 차를 타고 달아나고 있어요!', '방금 강도가 차로 도망쳤어요. 엄청 빨리 달려요!'], lik: [0.005, 0.07, 0.03, 0.86, 0.015, 0.005, 0.005, 0.01],
    needs: (n) => { n.law = 2; n.tactical = 1; n.search = 1; n.ems = 0; } },      // 쫓을 순찰차 둘, 기동대, 하늘에서 볼 헬기
  // ── 폭동: 여럿이 몰려 부수고 싸운다. 주동자 둘만 흉기를 들었고 나머지는 맨손이다 ──
  { type: 'armed', variant: 'riot', name: '폭동', share: 0.04, nature: 'riot', vague: 'scream', severity: [2, 3], tag: 'crime', label: '집단 난동', limit: 120,
    places: { stadium: 4, market: 3, busTerminal: 1.5, university: 1.5, station: 1.5, mart: 1 },
    texts: ['사람들이 떼로 몰려 부수고 싸우고 있어요!', '난동이 커졌어요. 불도 붙였어요!'], lik: [0.06, 0.01, 0.005, 0.86, 0.04, 0.01, 0.01, 0.005],
    needs: (n) => { n.law = 3; n.tactical = 1; n.ems = 1; n.suppression = 1; } },
  // ── 연쇄 방화: 여느 화재처럼 끄되, 경찰이 목격자의 말을 듣지 못하면 가까운 곳에서 또 불이 난다 (많아야 세 번) ──
  { type: 'fire', variant: 'arson', name: '방화', share: 0.1, nature: 'arson', vague: 'smoke', severity: [1, 3], tag: 'crime', label: '방화', places: ARSON_PLACES,
    texts: ['누가 불을 지르고 달아났어요!', '가게 뒤에서 누가 뭘 뿌리고 불을 붙였어요!'], lik: [0.82, 0.01, 0.005, 0.12, 0.01, 0.01, 0.02, 0.005],
    // 불길을 본 신고와 같은 규모로 보내고(관제의 위험도 계산은 '불길' 신고에만 가산점을 준다), 목격자를 만날 경찰을 더한다
    needs: (n, c) => { n.law = Math.max(n.law, 1); if (c.hurt || c.trapped || c.sev >= 1.65) n.ems = Math.max(n.ems, 1); if (c.sev >= 1.95) n.suppression = Math.max(n.suppression, 2); },
    onClose: arsonNext },
];
