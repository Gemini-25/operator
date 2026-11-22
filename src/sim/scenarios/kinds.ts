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
import type { District, Incident, IncidentType, RoadEdge } from '../types';

/**
 * (N8 §5.3.8 — 단계 4b) 평소 사건에 붙는 유관 기관의 선택 수요 — 가스 누출에 가스 복구반의 "공급 차단 확인". 분석(analyst — 필요 자원에 utilGas 1)과
 * 지휘 규칙(orders/kinds.ts — 밸브를 막았다고 믿은 뒤 repair)이 함께 본다. 거짓이면 붙이지 않는다(§7.3 의 손잡이).
 * 이 잎 쪽 파일에 둔다: 분석이 orders/kinds.ts 를 import 하면 지휘 규칙의 등록 차례(= 결과)가 바뀐다
 */
export const ATTACH_GAS = true;
/** (N8 단계 8·9) 지금 시각(0~24시) — 시나리오의 gate 가 쓴다 (놀이기구는 운영 시간 · 폭염은 한낮) */
export function hourOf(sim: Sim): number { return ((sim.clock / 3600) % 24 + 24) % 24; }
/**
 * (N8 §5.3.8 — 단계 6b) 평소 사건에 붙는 유관 기관의 선택 수요 — 교통사고에 견인차의 "차로를 막은 부서진 차 견인". 분석(필요 자원에 tow 1 — 이름표 '쓰러진 나무'·'맨홀 추락' 은 빼고)과
 * 지휘 규칙(orders/kinds.ts — 견인차가 배정돼 있으면 towAway, 그 차의 clearRoad 보류 · 150초 넘게 오지 않으면 밀어 둠으로 돌아감)이 함께 본다. 거짓이면 붙이지 않는다(§7.3 의 손잡이)
 */
export const ATTACH_TOW = true;
/** (§5.3.8) 견인을 붙이지 않는 교통사고의 이름표 — 부서진 차가 없는 사고 (쓰러진 나무·맨홀 추락) */
export const NO_TOW_LABELS: ReadonlySet<string> = new Set(['쓰러진 나무', '맨홀 추락']);

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
 * (N8 §4.8 N4 — 단계 10) 중복 신고 오인: 추가 신고 차례(incidents.tickIncidents)에 원 사건이 이 유형이고 비응급 변형이 아니면, 흐름 dup:<원 사건> 으로
 * 확률 P × (위치 오류 손잡이 ÷ ADDR0 — 보통 난이도의 값) 만큼 그 추가 신고가 옆 교차로의 새 사건(변형 dup)이 된다. 짧은 사건 손잡이가 0 이면 꺼진다.
 * P 는 §4.8 의 어림(교대당 +0.3건)에 맞췄다: 0.08 이면 보통 60교대에 0.68건/교대 · 비응급 9.7% 라 0.03 으로 — 비응급 6~8%(§7.1)
 */
export const DUP_TYPES: readonly IncidentType[] = ['fire', 'traffic', 'armed', 'collapse', 'hazmat', 'utility', 'animal', 'disturb'];
export const DUP = { P: 0.03, ADDR0: 0.1 };
/** 중복 신고 줄의 신고 키 [정확, 흐릿] — 원 사건이 없을 때(강제 실행)만 쓰인다. 모두 신고자가 말하는 기존 열쇠다 */
const DUP_NATURE: Record<string, [string, string]> = {
  fire: ['flames', 'smoke'], traffic: ['crash', 'bang'], armed: ['fight', 'scream'], collapse: ['collapse', 'rumble'], hazmat: ['gasleak', 'fumes'],
  utility: ['wirefall', 'bang'], animal: ['dogbite', 'scream'], disturb: ['brawl', 'fight'],
};

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

/**
 * (N8 §4.3 animal/escape) 농가 곁 길 위의 교차로: 출동 시설이 아니고 다른 사건이 열려 있지 않으며, 250 안에 농가·비닐하우스가 있는 곳.
 * 없으면 외곽(outskirts) 동네의 교차로, 그래도 없으면 null. 난수는 고를 때 한 번 (streetNode 와 같은 까닭으로 시나리오 표 쪽에 둔다 — 순환 import 를 피한다)
 */
export function farmNode(sim: Sim, rng: Rng, busy: Set<number>): number | null {
  const c = sim.city;
  const fac = new Set<number>();
  for (const f of c.facilities) fac.add(f.nodeId);
  const farms: { x: number; y: number }[] = [];
  for (const q of c.places) if (q.kind === 'farmhouse' || q.kind === 'greenhouse') farms.push({ x: q.x + q.w / 2, y: q.y + q.h / 2 });
  const pool: number[] = [], loose: number[] = [];
  for (const n of c.nodes) {
    if (busy.has(n.id) || fac.has(n.id) || n.edges.length < 2) continue;
    let near = false;
    for (const f of farms) if (Math.hypot(f.x - n.x, f.y - n.y) <= 250) { near = true; break; }
    if (near) pool.push(n.id); else if (n.district === 'outskirts') loose.push(n.id);
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
  // ── 동물 animal (§4.3 — 단계 5). 대상이 사람이 아닌 움직이는 것 — 쏘지 않고 몰아 가둔다(마취·포획·쫓아냄). 끝은 포획 · 산으로 쫓아냄 · 길로 놓침 ──
  { type: 'animal', variant: 'boar', name: '멧돼지 출몰', share: 0.55, nature: 'boar', vague: 'scream', severity: [1, 2], tag: 'daily', card: false,
    texts: ['멧돼지가 마을로 내려왔어요! 골목을 막 돌아다녀요.', '집 앞 텃밭에 멧돼지 두 마리가 있어요. 사람을 보고 씩씩거려요.', '공원에 멧돼지가 나타났는데 아이들이 근처에 있어요!'],
    lik: { animal: 0.88, medical: 0.03, armed: 0.02, traffic: 0.02, search: 0.02 },
    places: { farmhouse: 4, greenhouse: 2, pension: 2, houseS: 2, park: 1.5, campsite: 1, temple: 0.8, university: 0.5 },
    needs: (n, c) => { n.capture = 1; n.law = 1; n.ems = c.hurt && c.sev >= 2 ? 1 : 0; } },
  // 벌집 — 보호복을 입은 대원만 다가간다(펌프차·사다리차의 관창수, 구조 부대의 로프 대원). 떼어 내는 동안 위험 반경이 커진다, 여러 번 쏘인 사람의 급변
  { type: 'animal', variant: 'hive', name: '벌집', share: 1.1, nature: 'hive', vague: 'scream', severity: [1, 2], tag: 'daily', card: false,
    texts: ['처마 밑에 말벌집이 엄청 커요. 아이가 쏘였어요!', '학교 창틀에 벌집이 있어서 아이들이 못 지나가요.', '벌한테 여러 방 쏘였는데 숨이 좀 차요…'],
    lik: { animal: 0.75, medical: 0.2, armed: 0.01, fire: 0.01 },
    places: { houseS: 4, pension: 2, farmhouse: 2, villa: 1, school: 1.5, park: 1.5, campsite: 1, temple: 0.8 },
    needs: (n, c) => { n.suppression = 1; n.ems = c.hurt && c.sev >= 2 ? 1 : 0; } },
  // 개 물림 — 다친 사람 처치와 개 포획을 함께, 숨는 개, 주인 면담이 개가 간 곳을 좁힌다
  { type: 'animal', variant: 'dogbite', name: '개 물림', share: 0.9, nature: 'dogbite', vague: 'scream', severity: [1, 2], tag: 'daily', card: false,
    texts: ['큰 개가 풀려서 사람을 물었어요! 아직 돌아다녀요.', '목줄 없는 개가 아이를 물고 골목으로 도망갔어요.', '동네에 사나운 개가 돌아다니면서 사람들한테 달려들어요.'],
    lik: { animal: 0.82, medical: 0.1, armed: 0.04, traffic: 0.01 },
    places: { villa: 3, apartment: 3, houseS: 3, park: 2, school: 1, market: 0.8 },
    needs: (n, c) => { n.capture = 1; n.law = 1; n.ems = c.hurt && c.sev >= 2 ? 1 : 0; } },
  // 가축 탈출(도로) — 지도에 동물원이 없어 농가 가축으로 읽는다(§12.2). 여러 마리를 우리로 모는 줄 · 지나는 차 · 일부만 잡히는 결말
  { type: 'animal', variant: 'escape', name: '가축 탈출', share: 0.3, nature: 'livestock', vague: 'bang', severity: [1, 2], tag: 'daily', card: false, limit: 60,
    texts: ['소들이 축사를 뚫고 나와서 도로에 서 있어요! 차들이 급정거해요.', '돼지 여러 마리가 찻길로 나왔어요.', '트럭에서 소가 떨어져서 도로를 막고 있어요.'],
    lik: { animal: 0.8, traffic: 0.16, medical: 0.01, armed: 0.01 },
    node: (sim, rng, busy) => farmNode(sim, rng, busy),
    needs: (n) => { n.capture = 1; n.traffic = 1; } },
  // ── 치안 disturb (§4.4 — 단계 6a). 총·흉기가 없는 경찰 일상 — 용의자는 늘 맨손이고 지금의 봉쇄·협상·검거를 탄다. 끝은 훈방·보호 조치·검거·병원 ──
  // 주취 소란 — 달래기 · 보호 조치냐 체포냐 병원이냐 · 잠든 취객 깨우기 (변형 이름 drunk 는 추격전 줄에 걸려 rowdy — §12.2)
  { type: 'disturb', variant: 'rowdy', name: '주취 소란', share: 1.4, nature: 'rowdy', vague: 'fight', severity: [1, 2], tag: 'daily', card: false,
    texts: ['술 취한 사람이 가게에서 소리 지르고 물건을 던져요.', '편의점 앞에서 취객이 지나가는 사람들한테 시비를 걸어요.', '취한 사람이 길바닥에 누워서 일어나질 않아요. 아까는 소리를 지르더니…'],
    lik: { disturb: 0.78, armed: 0.12, medical: 0.08 },
    places: { restaurant: 4, convenience: 3, cafe: 1, market: 1, busTerminal: 0.8, station: 0.6 },
    needs: (n, c) => { n.law = 1; n.tactical = 0; n.ems = c.hurt && c.sev >= 2 ? 1 : 0; } },
  // 폭행 시비·집단 난투 — 두 무리를 떼어 놓는 자리(가운데) · 한 팀뿐인 경찰의 기다림
  { type: 'disturb', variant: 'brawl', name: '폭행 시비', share: 1.0, nature: 'brawl', vague: 'fight', severity: [1, 3], tag: 'daily', card: false,
    texts: ['술집 앞에서 여러 명이 패싸움을 하고 있어요!', '두 무리가 주먹질을 하고 있어요. 한 사람은 쓰러졌어요.', '경기 끝나고 사람들끼리 시비가 붙어서 싸움이 커지고 있어요.'],
    lik: { disturb: 0.8, armed: 0.14, medical: 0.04 },
    places: { restaurant: 3, market: 2, stadium: 1.5, busTerminal: 1, university: 1, station: 1 },
    needs: (n, c) => { n.law = c.sev >= 2 ? 2 : 1; n.tactical = 0; n.ems = c.hurt && c.sev >= 2 ? 1 : 0; } },
  // 날치기 도보 추격 — 숨은 용의자 · 목격자가 가리키는 골목 · 출구를 먼저 막는 교통 경찰·형사 · 경찰견 · 들키면 도보 추격
  { type: 'disturb', variant: 'snatch', name: '날치기', share: 0.9, nature: 'snatch', vague: 'scream', severity: [1, 2], tag: 'daily', card: false,
    texts: ['가방을 날치기당했어요! 저쪽 골목으로 뛰어갔어요!', '오토바이 탄 사람이 할머니 가방을 채 가서 할머니가 넘어지셨어요.', '소매치기예요! 검은 옷 입은 남자가 시장 안으로 도망쳤어요.'],
    lik: { disturb: 0.84, armed: 0.08, medical: 0.05, traffic: 0.01 },
    places: { market: 3, station: 2, busTerminal: 2, shop: 2, convenience: 1, mart: 1 },
    needs: (n, c) => { n.law = 1; n.search = 1; n.ems = c.hurt && c.sev >= 2 ? 1 : 0; } },
  // (단계 6b) 보이스피싱 수거책 잠복 — 사복 형사의 잠복 · 제복이 보이면 수거책이 달아난다 · 약속 시각까지의 기다림 (초안의 무전취식을 바꿨다 — §12.2-4).
  // 수거책은 약속 시각(s.kinds.arriveAt)에야 현장에 나타난다 — 그 전에는 s.hostiles 에 없다(세계 규칙 scamRule 이 만든다)
  { type: 'disturb', variant: 'scam', name: '수거책 잠복', share: 0.4, nature: 'scam', vague: 'suspicious', severity: [1, 1], tag: 'daily', card: false, limit: 60,
    texts: ['어머니가 검찰이라는 사람한테 현금을 가져다주기로 했대요. 사기 같아요!', '은행 앞에서 누구를 만나 돈을 건네기로 했는데 아무래도 보이스피싱 같아요.', '현금 받으러 온다는 사람이 곧 편의점 앞에 온대요.'],
    lik: { disturb: 0.86, armed: 0.06, medical: 0.01 },
    places: { convenience: 3, bank: 2, cafe: 2, station: 1, busTerminal: 1 },
    needs: (n) => { n.law = 1; n.search = 0; } },
  // (단계 6b) 차량 절도 — 추격전(pursuit.ts — Pursuit.kind 'cartheft')에 교통 경찰의 앞지르기가 붙고, 차가 서면 운전자가 차를 버리고 걸어서 달아난다(도보 추격).
  // 주차장에서 달리는 차로 시작한다(incidents.createIncident 의 startPursuit 줄). 사고로 섰으면 부서진 차의 견인(선택 수요 — 지휘 규칙)
  { type: 'disturb', variant: 'cartheft', name: '차량 절도', share: 0.45, nature: 'cartheft', vague: 'bang', severity: [2, 2], tag: 'daily', card: false,
    texts: ['주차해 둔 제 차를 누가 몰고 가 버렸어요! 방금요!', '주유소에서 시동 걸어 둔 차를 누가 타고 도망갔어요.', '차 도둑이에요. 흰색 승용차가 큰길 쪽으로 빠져나갔어요.'],
    lik: { disturb: 0.7, traffic: 0.2, armed: 0.08 },
    places: { parking: 4, gasStation: 0.5, mart: 1, apartment: 1 },
    needs: (n) => { n.law = 2; n.search = 1; n.traffic = 0; n.tow = 0; } },
  // ── 보호 (§4.5 — 단계 7). 사연·의도를 말하는 문구는 넣지 않는다(§5.13) ──
  { type: 'welfare', variant: 'dementia', name: '치매 노인 실종', share: 0.45, nature: 'dementia', vague: 'missing', severity: [1, 2], tag: 'daily', card: false, limit: 60,
    texts: ['치매가 있는 아버지가 집을 나가셨는데 연락이 안 돼요.', '요양원에서 어르신 한 분이 안 보이세요. 한 시간쯤 됐어요.', '시장 쪽에서 길을 잃고 헤매시는 할머니를 봤어요.'],
    lik: { welfare: 0.72, search: 0.24, medical: 0.02, armed: 0.01 },
    places: { houseS: 3, villa: 3, apartment: 3, market: 1.5, park: 1, station: 0.5, busTerminal: 0.5 },
    needs: (n) => { n.search = 2; } },
  { type: 'welfare', variant: 'lostchild', name: '미아', share: 0.8, nature: 'lostchild', vague: 'missing', severity: [1, 1], tag: 'daily', card: false,
    texts: ['아이를 잃어버렸어요! 마트에서 잠깐 한눈판 사이에요.', '놀이공원에서 일곱 살 아이가 안 보여요.', '공원에서 놀던 아이가 없어졌어요. 노란 옷을 입었어요.'],
    lik: { welfare: 0.8, search: 0.15, water: 0.02, armed: 0.01 },
    places: { mart: 3, deptStore: 2, park: 2, market: 1.5, station: 1, amusement: 1 },
    needs: (n) => { n.search = 1; n.law = 0; } },
  // ── 구조 (§4.6 — 단계 8). 평소 추첨(tag 'kinds' — daily 가 아니다): 유형 rescue 의 가중 0.06 안에서 몫 0.45 · 0.2 · 0.1 (합 0.75 — 나머지 0.25 는 TYPE_DEFS.rescue.fallback 'pit') ──
  { type: 'rescue', variant: 'facade', name: '외벽 작업자 고립', share: 0.45, nature: 'facade', vague: 'scream', severity: [2, 3], tag: 'kinds', card: false,
    texts: ['건물 외벽 청소하던 곤돌라가 기울어서 사람이 매달려 있어요!', '아파트 외벽에서 작업하던 사람이 줄에 매달린 채 못 움직여요.', '공사장 비계에 사람이 걸려서 내려오지를 못해요.'],
    lik: { rescue: 0.82, collapse: 0.08, medical: 0.05, fire: 0.03, welfare: 0.01 },
    places: { apartment: 3, office: 3, officetel: 2, construction: 1.5, hotel: 1, deptStore: 0.8, university: 0.6 },
    needs: (n) => { n.rescue = 1; n.suppression = 1; n.ems = 1; } },
  { type: 'rescue', variant: 'pit', name: '구덩이 추락', share: 0.2, nature: 'pit', vague: 'scream', severity: [2, 3], tag: 'kinds', card: false,
    texts: ['공사장 구덩이에 사람이 떨어졌어요! 아래서 소리가 나요.', '밭에 있는 오래된 우물에 사람이 빠졌어요!', '배수로에 사람이 떨어져서 못 올라와요. 물이 조금 차 있어요.'],
    lik: { rescue: 0.74, medical: 0.1, traffic: 0.08, water: 0.05, collapse: 0.02 },
    places: { farmhouse: 3, construction: 2, greenhouse: 1.5, riverside: 1, park: 1, forest: 0.5 },
    needs: (n) => { n.rescue = 1; n.ems = 1; } },
  { type: 'rescue', variant: 'ride', name: '멈춘 놀이기구', share: 0.1, nature: 'ride', vague: 'scream', severity: [2, 3], tag: 'kinds', card: false, limit: 120,
    texts: ['놀이기구가 꼭대기에서 멈췄어요! 사람들이 매달려 있어요.', '관람차가 멈춘 지 한참 됐는데 안 움직여요. 안에 아이들도 있어요.', '롤러코스터가 중간에 서 버렸어요. 승객들이 무서워해요.'],
    lik: { rescue: 0.8, collapse: 0.1, medical: 0.05, welfare: 0.02, fire: 0.01 },
    places: { amusement: 1 },
    gate: (sim) => { const h = hourOf(sim); return h >= 10 && h < 20; },      // 낮만 (운영 시간)
    needs: (n) => { n.rescue = 2; n.suppression = 1; n.ems = 1; } },
  // ── 응급의 갈래 넷 (§4.7 — 단계 9). 평소 추첨(tag 'kinds'): 응급 몫 0.12 · 0.12 · 0.08 · 0.10 (합 0.42 — 나머지 0.58 은 지금의 세 갈래). 의도·사연은 말하지 않는다(§5.13) ──
  { type: 'medical', variant: 'poison', name: '집단 식중독', share: 0.12, nature: 'poison', vague: 'collapsed', severity: [2, 3], tag: 'kinds', card: false, limit: 150,
    texts: ['식당에서 밥 먹은 사람들이 단체로 토하고 배를 움켜쥐고 있어요!', '회사 구내식당 점심 먹고 여러 명이 쓰러졌어요.', '기숙사 학생들이 밤새 설사하고 열이 나요. 열 명 가까이 돼요.'],
    lik: { medical: 0.84, hazmat: 0.08, fire: 0.02, welfare: 0.02, armed: 0.01 },
    places: { restaurant: 4, school: 1, dorm: 1, university: 1, hotel: 1, factory: 0.5 },
    needs: (n) => { n.ems = 2; n.rescue = 0; n.suppression = 0; } },
  { type: 'medical', variant: 'overdose', name: '약물 과다', share: 0.12, nature: 'overdose', vague: 'collapsed', severity: [2, 3], tag: 'kinds', card: false,
    texts: ['친구가 약을 많이 먹은 것 같은데 의식이 흐려요.', '숙소 방에 사람이 쓰러져 있는데 옆에 약봉지가 잔뜩 있어요.', '길에 누가 쓰러져서 몸을 떠는데 뭘 먹은 것 같아요.'],
    lik: { medical: 0.88, hazmat: 0.04, armed: 0.04, welfare: 0.02, disturb: 0.01 },
    places: { villa: 2, officetel: 2, hotel: 2, apartment: 1, houseS: 1 },
    needs: (n) => { n.ems = 1; n.law = 1; } },
  { type: 'medical', variant: 'birth', name: '출산 임박', share: 0.08, nature: 'birth', vague: 'collapsed', severity: [2, 2], tag: 'kinds', card: false,
    texts: ['아내가 진통이 너무 빨라요. 병원까지 못 갈 것 같아요!', '양수가 터졌는데 아기가 나올 것 같대요!', '택시 안에서 산모가 진통을 해요. 도와주세요!'],
    lik: { medical: 0.94, welfare: 0.02, traffic: 0.01 },
    places: { houseS: 3, villa: 3, apartment: 3, officetel: 1 },
    needs: (n) => { n.ems = 1; } },
  { type: 'medical', variant: 'heat', name: '폭염 환자', share: 0.1, nature: 'heat', vague: 'collapsed', severity: [1, 2], tag: 'kinds', card: false,
    texts: ['공사장에서 일하던 사람이 더위 먹고 쓰러졌어요.', '비닐하우스에서 할머니가 어지럽다며 주저앉으셨어요. 몸이 불덩이예요.', '행사장 줄 서 있던 사람들이 하나둘 쓰러져요.'],
    lik: { medical: 0.9, welfare: 0.03, hazmat: 0.03, fire: 0.01 },
    places: { construction: 2, greenhouse: 2, park: 2, farmhouse: 1, market: 1, stadium: 0.6 },
    gate: (sim) => { const h = hourOf(sim); return sim.weather === 'clear' && h >= 11 && h < 18; },      // 낮·맑음만 (날씨에 폭염 값이 없다 — 시각·장소로 건다)
    needs: (n) => { n.ems = 1; } },
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
  // ── 비응급 N3 단순 민원 이관 (§4.8 — 단계 10) — 접수 AI 가 "지금 위급한가"를 묻고 아니면 창구로 넘긴다(dispatch/screening.ts 의 referral — 출동 없이 접수 단계 종료).
  //    신고자의 20% 는 "지금도 소리 지르고 난리"를 덧붙인다(과장 — kindsCaller) → 넘기지 않고 순찰 한 팀이 가서 이웃 둘을 면담하고 끝낸다(현장 중재).
  //    문구는 비긴급 전화(callSystem.NUISANCE — 음악 소음·주차 시비)와 겹치지 않게. 신고자가 말하는 키(complaint)라 이름표 '단순 민원'이 붙는다 ──
  { type: 'disturb', variant: 'referral', name: '단순 민원', share: 0.6, nature: 'complaint', vague: 'complaint', severity: [1, 1], tag: 'daily', card: false,
    places: { villa: 3, apartment: 3, houseS: 2, shop: 1 },
    texts: ['윗집에서 밤마다 쿵쿵거려서 잠을 못 자요.', '가게 앞에 차를 며칠째 세워 놔서 장사를 못 하겠어요.', '옆집 개가 하루 종일 짖어요.'],
    lik: { disturb: 0.7, animal: 0.15, utility: 0.08, welfare: 0.05 },
    needs: (n, c) => { n.law = c.noise || c.hurt || c.trapped ? 1 : 0; n.search = 0; n.ems = 0; n.tactical = 0; } },
  // ── (N8 §4.8 N4 — 단계 10) 중복 신고 오인의 줄: 몫 0 — 평소·짧은 사건 추첨에 들지 않고 incidents.dupCall 이 정해서만 일으킨다(현장은 scenes/kinds.ts 의 빈 길).
  //    신고자는 원 사건의 진실로 말하므로(kindsCaller.dupSource) nature·vague 는 원 사건이 없을 때(강제 실행)만 쓰는 그 유형의 흔한 열쇠다 ──
  ...DUP_TYPES.map((t): Scenario => ({ type: t, variant: 'dup', name: '중복 신고', share: 0, nature: DUP_NATURE[t][0], vague: DUP_NATURE[t][1], severity: [1, 1], tag: 'daily', card: false })),
];
