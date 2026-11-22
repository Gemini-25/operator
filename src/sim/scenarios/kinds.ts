// 사건 종류 다양화 ① 일상 사건 (docs/specs/N8-incident-kinds.md §4)
// 줄의 순서: 시설(utility) · 동물(animal) · 치안(disturb) · 보호(welfare) · 구조(rescue) · 응급의 갈래(medical) · 비응급(장난·오인·민원).
// 짧은 사건(tag 'daily')은 평소 추첨에 들지 않고 새 난수 흐름 daily 로 따로 추첨한다 (§5.4 — incidents.tickIncidents). 새 시나리오는 card: false (카드 제목에 이름표를 쓰지 않는다 — §5.12).
// SCENARIOS 의 맨 끝에 펼쳐 넣는다 (같은 유형의 기존 시나리오 구간을 밀지 않는다 — 순서가 추첨 결과를 바꾼다). 새 줄은 이 배열의 끝에 §4 의 순서로 붙인다.
//
// 단계 3: 비응급 N1 장난 전화(fire·medical·water 의 prank) · N2 오인 신고(medical·water·armed·hazmat 의 false) — §4.8.
// nature 키('prank:<유형>'·'false:<유형>')는 아무도 말하지 않는 열쇠라 관제의 이름표가 붙지 않는다(natureLabel 이 걸리지 않는다) — 신고자가 말하는 키는 callSystem.natureFor 의
// prank·false 갈래(시나리오 갈래보다 먼저 돈다)가 유형별로 고른다. texts·lik 없음.
// 현장은 field/scenes/kinds.ts 가 등록한다(빈 현장 kindsKit.buildQuiet · 길 위의 잠든 사람 · 물에 뜬 물건 · 폭죽 잔해 · 음식물 냄새).
import { edgeName, findRoute } from '../city';
import type { Sim } from '../engine';
import { emit } from '../events';
import type { Rng } from '../rng';
import type { Scenario } from '../scenarios';
import { addObstacle, canBlock, noteRoadCause } from '../traffic';
import type { District, Incident, RoadEdge } from '../types';

/**
 * (N8 §5.3.8 — 단계 4b) 평소 사건에 붙는 유관 기관의 선택 수요 — 가스 누출에 가스 복구반의 "공급 차단 확인". 분석(analyst — 필요 자원에 utilGas 1)과
 * 지휘 규칙(orders/kinds.ts — 밸브를 막았다고 믿은 뒤 repair)이 함께 본다. 거짓이면 붙이지 않는다(§7.3 의 손잡이).
 * 이 잎 쪽 파일에 둔다: 분석이 orders/kinds.ts 를 import 하면 지휘 규칙의 등록 차례(= 결과)가 바뀐다
 */
export const ATTACH_GAS = true;

/**
 * (§4.2 utility/sinkhole) 생성 때 그 교차로의 구간 하나를 막는다 — 쓰러진 나무(incidents.createIncident 의 tree 갈래)와 같은 일: 고속도로가 아니고, 다른 열린 사건이 잡지 않았고,
 * 우회로가 있고(findRoute), 막아도 도시가 끊기지 않는 구간(canBlock). 닫힘의 주인 = 그 통제 기록 (교통의 장부 — I1-b)
 */
function sinkholeBlock(sim: Sim, I: Incident): void {
  const node = sim.city.nodes[I.truth.nodeId];
  if (!node) return;
  const es = node.edges.map((e) => sim.city.edges[e]).filter((e) => !e.closed && e.cls !== 'highway');
  es.sort((a, b) => (b.arterial ? 1 : 0) - (a.arterial ? 1 : 0) || a.id - b.id);
  for (const e of es) {
    if (sim.incidents.some((J) => J !== I && J.phase !== 'closed' && J.blockedEdge === e.id)) continue;
    if (!findRoute(sim.city, e.a, e.b, 1, e.id) || !canBlock(sim, e)) continue;
    I.blockedEdge = e.id;
    e.closed = true; e.closedReason = 'incident';
    I.blockEv = emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', text: `${edgeName(sim.city, e)} 통행 불가 — 도로가 꺼져 구멍이 생겼습니다.`, imp: 1, truth: true });
    noteRoadCause(sim, e.id, 'close', I.blockEv, I.id);
    return;
  }
}
/** (§4.2) 싱크홀이 닫힐 때: 막았던 구간을 도로 복구 공사로 넘긴다(우회로 확인 — 600초). 닫는 처리(closeIncident)가 사건의 통제를 푼 바로 뒤다 */
function sinkholeRepairRoad(sim: Sim, I: Incident): void {
  if (I.blockedEdge < 0) return;
  addObstacle(sim, { edge: I.blockedEdge, kind: 'roadwork', full: true, dur: 600, known: true });
}

/**
 * 짧은 사건 줄(tag 'daily')의 가중 합 — 다 만든 뒤의 값(시설 2.5 · 동물 2.85 · 치안 4.15 · 보호 2.5 · N1 0.5 · N2 0.9 · N3 0.6 — §4.0).
 * 상수로 둔다: 가족이 하나씩 들어오는 동안 차례의 나머지는 "걸린 줄 없음"으로 지나가 중간 단계의 짧은 사건 수가 그 가족의 몫만큼만 는다 (§5.4).
 * 가중을 고치면 이 상수도 고친다 (시험 6: 줄의 가중 합 ≤ DAILY_TOTAL, 단계 11 의 완료 조건: = DAILY_TOTAL)
 */
export const DAILY_TOTAL = 14.0;

/**
 * 길 위에서 일어나는 짧은 사건의 교차로: 출동 시설이 아니고, 다른 사건이 열려 있지 않으며(busy), 그 등급의 구간이 닿고 그 동네 성격인 곳.
 * 그런 곳이 없으면 동네 성격을 보지 않고, 그래도 없으면 null (기본 규칙 — 교차로 셋 이상이 닿는 곳). 난수는 고를 때 한 번
 */
export function streetNode(sim: Sim, rng: Rng, busy: Set<number>, cls: NonNullable<RoadEdge['cls']>[], dist: District[]): number | null {
  const c = sim.city;
  const fac = new Set<number>();
  for (const f of c.facilities) fac.add(f.nodeId);
  const pool: number[] = [], loose: number[] = [];
  for (const n of c.nodes) {
    if (busy.has(n.id) || fac.has(n.id)) continue;
    let ok = false;
    for (const e of n.edges) { const k = c.edges[e].cls; if (k !== undefined && cls.indexOf(k) >= 0) { ok = true; break; } }
    if (!ok) continue;
    loose.push(n.id);
    if (dist.indexOf(n.district) >= 0) pool.push(n.id);
  }
  const from = pool.length ? pool : loose;
  return from.length ? rng.pick(from) : null;
}

export const KINDS: Scenario[] = [
  // ── 시설 사고 utility (§4.2 — 단계 4a·4b). 위험을 지키며 유관 기관 복구반을 기다리는 사건: 소방·경찰이 위험 반경을 통제하고, 끝내는 것은 복구반의 repair ──
  { type: 'utility', variant: 'wire', name: '끊어진 전선', share: 0.7, nature: 'wirefall', vague: 'bang', severity: [1, 3], tag: 'daily', card: false,
    texts: ['전선이 끊어져서 길에 늘어져 있어요! 불꽃이 막 튀어요.', '트럭이 지나가다 전깃줄을 걸어서 끊었어요. 차 위에 전선이 떨어졌어요!', '전봇대가 기울면서 전선이 바닥에 깔렸어요. 사람들이 가까이 가려고 해요.'],
    lik: { utility: 0.82, traffic: 0.06, fire: 0.06, medical: 0.02, collapse: 0.02, armed: 0.01, hazmat: 0.01 },
    node: (sim, rng, busy) => streetNode(sim, rng, busy, ['arterial', 'street'], ['residential', 'commercial']),
    // 차 안에 사람이 있다고 하면 차로 통제(순찰·교통 경찰), 다쳤다는 진술은 위험도 2 이상일 때만 처음부터 구급 (그 밖은 지휘관이 본 뒤 부른다)
    needs: (n, c) => { n.suppression = 1; n.utilPower = 1; n.traffic = c.trapped ? 1 : 0; n.ems = c.hurt && c.sev >= 2 ? 1 : 0; n.law = 0; } },
  // (단계 4b) 수도관 파열·지하 침수 — 도심 교차로, 곁 건물의 지하 주차장에 물이 찬다. 순찰이 통제와 차로를 맡고, 끝내는 것은 수도 복구반 (오지 못하면 120초 뒤 소방의 제수밸브)
  { type: 'utility', variant: 'main', name: '수도관 파열', share: 0.45, nature: 'watermain', vague: 'rumble', severity: [1, 3], tag: 'daily', card: false,
    texts: ['도로 한가운데서 물이 분수처럼 솟아요! 길이 물바다예요.', '수도관이 터졌는지 물이 지하 주차장으로 막 쏟아져 들어가요.', '길에서 물이 콸콸 나오는데 땅도 좀 내려앉은 것 같아요.'],
    lik: { utility: 0.8, traffic: 0.06, water: 0.06, collapse: 0.05, medical: 0.01, fire: 0.01, hazmat: 0.01 },
    node: (sim, rng, busy) => streetNode(sim, rng, busy, ['arterial'], ['commercial']),
    needs: (n, c) => { n.utilWater = 1; n.law = 1; n.rescue = c.trapped ? 1 : 0; n.ems = c.hurt && c.sev >= 2 ? 1 : 0; } },
  // (단계 4b) 싱크홀 — 넓어지는 구멍, 가장자리 보강 뒤 줄로 끌어올리기, 밑의 관이 무엇인지 보고 맞는 복구반. 생성 때 그 교차로의 구간 하나를 막고, 닫힐 때 복구 공사로 넘긴다
  { type: 'utility', variant: 'sinkhole', name: '싱크홀', share: 0.35, nature: 'sinkhole', vague: 'rumble', severity: [1, 3], tag: 'daily', card: false,
    texts: ['도로가 갑자기 푹 꺼졌어요! 차가 구멍에 빠졌어요!', '길 한가운데 큰 구멍이 생겼는데 사람이 떨어진 것 같아요.', '땅이 꺼지면서 구멍이 점점 커지고 있어요. 근처 사람들 피해야 할 것 같아요.'],
    lik: { utility: 0.62, traffic: 0.2, collapse: 0.14, water: 0.01, medical: 0.01, fire: 0.01, armed: 0.01 },
    node: (sim, rng, busy) => streetNode(sim, rng, busy, ['arterial', 'street'], ['commercial', 'residential', 'industrial']),
    needs: (n, c) => { n.rescue = 1; n.law = 1; n.utilWater = 1; n.ems = c.hurt && c.sev >= 2 ? 1 : 0; },
    onCreate: sinkholeBlock, onClose: (sim, I) => sinkholeRepairRoad(sim, I) },
  // (단계 4b) 떨어질 듯한 간판 — 통제 먼저, 사다리차(또는 로프 대원)로 고정. 늦으면 떨어져 아래 사람이 다친다
  { type: 'utility', variant: 'sign', name: '떨어질 듯한 간판', share: 1.0, nature: 'signfall', vague: 'bang', severity: [1, 2], tag: 'daily', card: false,
    texts: ['가게 간판이 바람에 덜렁거리면서 떨어지려고 해요! 밑으로 사람들이 다녀요.', '건물 외벽 판넬이 반쯤 떨어져서 흔들려요.', '간판 하나가 벌써 떨어져서 사람이 다쳤어요. 옆에 것도 떨어질 것 같아요.'],
    lik: { utility: 0.7, collapse: 0.15, traffic: 0.06, medical: 0.04, armed: 0.02, fire: 0.01, hazmat: 0.01 },
    places: { shop: 4, restaurant: 4, office: 3, cafe: 2, convenience: 1.5, hotel: 1, market: 1 },
    needs: (n, c) => { n.suppression = 1; n.law = 1; n.ems = c.hurt && c.sev >= 2 ? 1 : 0; } },
  // ── 비응급 N1 장난 전화 (§4.8 — 기존 armed/prank 는 평소 추첨 그대로) ──
  { type: 'fire', variant: 'prank', name: '장난 전화', share: 0.2, nature: 'prank:fire', vague: 'flames', severity: [1, 1], tag: 'daily', card: false },
  { type: 'medical', variant: 'prank', name: '장난 전화', share: 0.15, nature: 'prank:medical', vague: 'notbreathing', severity: [1, 1], tag: 'daily', card: false },
  { type: 'water', variant: 'prank', name: '장난 전화', share: 0.15, nature: 'prank:water', vague: 'drowning', severity: [1, 1], tag: 'daily', card: false },
  // ── 비응급 N2 오인 신고 (§4.8 — 기존 fire/false 는 평소 추첨 그대로) ──
  // 길에서 잠든 취객을 쓰러진 사람으로: 길 위에서 일으킨다 (장소가 없으면 pickPlace 가 응급의 장소(주택)를 골라 지도의 자리와 현장이 어긋난다)
  { type: 'medical', variant: 'false', name: '오인 신고', share: 0.3, nature: 'false:medical', vague: 'collapsed', severity: [1, 1], tag: 'daily', card: false,
    node: (sim, rng, busy) => streetNode(sim, rng, busy, ['street', 'arterial'], ['commercial', 'residential']) },
  { type: 'water', variant: 'false', name: '오인 신고', share: 0.2, nature: 'false:water', vague: 'drowning', severity: [1, 1], tag: 'daily', card: false },      // 물에 뜬 마네킹·쓰레기 봉투
  { type: 'armed', variant: 'false', name: '오인 신고', share: 0.25, nature: 'false:armed', vague: 'scream', severity: [1, 1], tag: 'daily', card: false },      // 폭죽·타이어 소리를 총소리로
  { type: 'hazmat', variant: 'false', name: '오인 신고', share: 0.15, nature: 'false:hazmat', vague: 'fumes', severity: [1, 1], tag: 'daily', card: false,      // 음식물·하수 냄새를 가스로
    places: { villa: 3, apartment: 3, restaurant: 2, houseS: 2 } },
];
