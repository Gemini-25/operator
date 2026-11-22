// 사건 유형의 자료 (docs/specs/N8-incident-kinds.md §5.1 — 단계 1, 결과 불변).
// 예전에는 유형 하나가 공용 파일 스무 곳의 분기·표(한계 시간·대응 기준·첫 신고 지연·추가 신고·질문·가능도의 열 …)에 흩어져 있었다.
// 이 표 한 곳에 모아, 새 유형은 IncidentType 에 한 줄 + 여기 한 줄(tsc 가 강제한다)로 시작한다.
// 여덟 유형의 값은 옮기기 전 코드의 값을 글자 그대로 옮겼다 — 같은 시드·같은 난이도의 기록 해시가 한 글자도 같다 (tests/kinds.test.ts 시험 2).
//
// 잎 모듈이다: types 만 가져온다 (util·analyst·callSystem·incidents·sceneManager·화면이 이 파일을 가져간다 — 서로 부르게 되지 않게).
// 색은 시뮬레이션 쪽 표에 넣지 않는다 — view/typeStyle.ts.

import type { IncidentType, InjuryCause, Needs, Scene, Topic } from './types';

/**
 * 유형의 순서. 분석 AI 의 가설 순서·가능도 배열(likRow)의 열 순서·평소 추첨의 가중 순서·확률 막대의 순서가 모두 이것이다.
 * 새 유형은 **끝에만** 붙인다(중간에 끼우면 평소 추첨과 분석의 결과가 모두 바뀐다).
 */
export const TYPE_ORDER: readonly IncidentType[] = ['fire', 'traffic', 'search', 'armed', 'medical', 'collapse', 'hazmat', 'water',
  'utility',      // (N8 단계 4a) 시설 사고 — 평소 추첨 가중 0 (짧은 사건 흐름 daily 로만 나온다)
  'animal',      // (N8 단계 5) 동물 — 평소 추첨 가중 0 (짧은 사건 흐름으로만)
  'disturb',      // (N8 단계 6a) 치안 — 평소 추첨 가중 0 (짧은 사건 흐름으로만)
  'welfare'];      // (N8 단계 7) 보호 — 평소 추첨 가중 0 (짧은 사건 흐름으로만)

/** 유형 → TYPE_ORDER 의 자리 (분석 AI 의 숫자 색인 lp[…] 대신) */
export const typeIdx = {} as Record<IncidentType, number>;
TYPE_ORDER.forEach((t, k) => { typeIdx[t] = k; });

export interface TypeDef {
  name: string;                  // 화면·기록의 이름 (util.TYPE_NAME 이 이 칸으로 만들어진다)
  limit: number;                 // 현장 한계 시간(초) — sceneManager 7번 블록 (시나리오의 limit·버스 변형의 가산은 따로)
  respLimit: number;             // 대응 지연의 기준(초) — debrief 의 판정, 화면 핀의 경과 고리
  delay: [number, number];       // 발생 → 첫 신고(초). 시나리오가 delay 를 적었으면 그것이 먼저다
  follow: number;                // 추가 신고가 걸려 올 확률 (장난·오인 신고는 0)
  weight: number | 'armed';      // 평소 추첨의 가중 ('armed' = 난이도의 tune.armedWeight)
  fallback?: string;             // 시나리오 몫이 걸리지 않았을 때의 변형 (새 유형만 — 여덟 유형은 incidents.createIncident 의 갈래가 정한다)
  atNode: number;                // 신고된 곳이 교차로일 때 이 유형일 사전 확률의 배율 (analyst.placePrior)
  alwaysShow: boolean;           // 판단 요약 패널의 확률 막대에 늘 보인다 (아니면 3% 이상일 때만)
  indoorRisk: boolean;           // 위험한 건물: 실내 일은 공기호흡기를 멘 대원만 (agents.fitBase·agentCost)
  roomSearch: boolean;           // 방 수색 규칙 (commander.syncBoard 의 실내 구역 수색)
  zoneSearch: boolean;           // 구역 확률 수색 (commander.syncBoard·canClose, 7번 블록, 신고자의 마지막 목격 구역, 상공 헬기의 한가함)
  wander: boolean;               // 걷는 대상 (hazards.tickWander 를 돌린다)
  outdoor: boolean;              // 바깥 현장 (builders.sealPockets 를 건너뛴다)
  question: Partial<Record<Topic, string>>;      // 접수 AI 의 질문 문구 가운데 이 유형의 것 (없는 주제는 callSystem 의 공통 문구)
  topicValue: Partial<Record<Topic, number>>;    // 접수 AI 가 이 유형을 가설로 둘 때 주제마다 물을 가치 — **열쇠의 순서가 같은 값끼리의 순서다**(먼저 적은 주제를 먼저 묻는다)
  trappedYes?: string;           // 신고자의 갇힘 진술 (예). 없으면 callSystem 의 공통 문구
  trappedNo?: string;            // 〃 (아니오)
  baseNeeds?: Partial<Needs>;    // (새 유형만 — N8 §5.2) 분석의 필요 자원 기본값
  cause?: InjuryCause;           // (새 유형만 — N8 §5.2) 구조 대상의 처음 부상 원인 기본값 (H1 initialCause)
  floorHp: number;               // 구조 대상의 체력 하한 (0 = 없음 — N8 §5.13 의 보호 유형만 20)
}

export const TYPE_DEFS: Record<IncidentType, TypeDef> = {
  fire: {
    name: '건물 화재', limit: 430, respLimit: 95, delay: [6, 16], follow: 0.6, weight: 0.27, atNode: 0.75, alwaysShow: true,
    indoorRisk: true, roomSearch: true, zoneSearch: false, wander: false, outdoor: false,
    question: { count: '건물 안에 몇 명이나 있습니까?', trapped: '건물 안에 아직 사람이 남아 있습니까?', hazard: '불이 번지고 있습니까? 위험물이 있습니까?', detail: '사람이 있는 위치를 아십니까?' },
    topicValue: { trapped: 0.92, count: 0.7, detail: 0.66, hazard: 0.62, injured: 0.5 },
    trappedYes: '안에 아직 사람이 있어요!', trappedNo: '사람들은 다 나온 것 같아요.', floorHp: 0,
  },
  traffic: {
    name: '교통사고', limit: 400, respLimit: 105, delay: [3, 8], follow: 0.5, weight: 0.24, atNode: 1.5, alwaysShow: true,
    indoorRisk: false, roomSearch: false, zoneSearch: false, wander: false, outdoor: true,
    question: { count: '다친 사람은 모두 몇 명입니까?', trapped: '차 안에 갇힌 사람이 있습니까?', hazard: '연료가 새거나 연기가 나는 차량이 있습니까?', detail: '차 밖으로 튕겨 나간 사람이 있습니까?' },
    topicValue: { injured: 0.9, trapped: 0.84, count: 0.62, hazard: 0.6, detail: 0.5 },
    trappedYes: '차 안에 사람이 끼어서 못 나와요.', trappedNo: '다들 차 밖으로 나왔어요.', floorHp: 0,
  },
  search: {
    name: '실종·조난', limit: 470, respLimit: 125, delay: [1, 3], follow: 0.12, weight: 0.17, atNode: 0.75, alwaysShow: true,
    indoorRisk: false, roomSearch: false, zoneSearch: true, wander: true, outdoor: true,
    question: { count: '찾는 분은 몇 명입니까?', detail: '마지막으로 본 곳이 어디입니까?' },
    topicValue: { detail: 0.92, injured: 0.6, count: 0.55 },
    floorHp: 0,      // 갇힘 진술은 묻지 않는다 (makeCaller 가 실종 사건을 건너뛴다)
  },
  armed: {
    name: '무장 사건', limit: 400, respLimit: 95, delay: [4, 11], follow: 0.42, weight: 'armed', atNode: 0.75, alwaysShow: true,
    indoorRisk: false, roomSearch: true, zoneSearch: false, wander: false, outdoor: false,
    question: { count: '안에 있는 사람은 몇 명입니까?', trapped: '가게 안에 못 나온 사람이 있습니까?', detail: '용의자는 몇 명입니까?' },
    topicValue: { weapon: 0.95, injured: 0.82, detail: 0.7, trapped: 0.64, count: 0.5 },
    trappedYes: '가게 안에 사람들이 못 나오고 있어요.', trappedNo: '안에 다른 사람은 없는 것 같아요.', floorHp: 0,
  },
  medical: {
    name: '응급 환자', limit: 300, respLimit: 80, delay: [2, 6], follow: 0.12, weight: 0.2, atNode: 0.75, alwaysShow: true,
    indoorRisk: false, roomSearch: true, zoneSearch: false, wander: false, outdoor: false,
    question: { injured: '환자가 의식이 있습니까? 불러 보세요.', count: '환자는 몇 명입니까?', detail: '환자가 숨을 쉬고 있습니까? 가슴이 오르내리는지 보세요.' },
    topicValue: { detail: 0.95, injured: 0.85, count: 0.3 },
    floorHp: 0,      // 신고자 진술은 응급 전용 갈래가 만든다 (갇힘 문구를 쓰지 않는다)
  },
  collapse: {
    name: '건물 붕괴', limit: 470, respLimit: 100, delay: [3, 8], follow: 0.55, weight: 0.075, atNode: 0.75, alwaysShow: false,
    indoorRisk: true, roomSearch: true, zoneSearch: false, wander: false, outdoor: false,
    question: { count: '건물 안에 몇 명이나 있었습니까?', trapped: '잔해에 깔리거나 갇힌 사람이 있습니까?', hazard: '건물이 더 무너질 것 같습니까?' },
    topicValue: { trapped: 0.94, count: 0.8, injured: 0.62, hazard: 0.6 },
    trappedYes: '잔해 밑에 사람이 깔려 있어요!', trappedNo: '사람들은 다 나온 것 같아요.', floorHp: 0,
  },
  hazmat: {
    name: '가스 누출', limit: 430, respLimit: 100, delay: [8, 20], follow: 0.4, weight: 0.085, atNode: 0.75, alwaysShow: false,
    indoorRisk: true, roomSearch: true, zoneSearch: false, wander: false, outdoor: false,
    question: { count: '건물 안에 몇 명이나 있습니까?', trapped: '건물 안에 아직 사람이 남아 있습니까?', hazard: '가스가 계속 새고 있습니까? 근처에 불씨가 있습니까?' },
    topicValue: { hazard: 0.88, trapped: 0.86, count: 0.7, injured: 0.6 },
    trappedYes: '안에 아직 사람이 있어요!', trappedNo: '사람들은 다 나온 것 같아요.', floorHp: 0,
  },
  water: {
    name: '수난 사고', limit: 380, respLimit: 90, delay: [2, 6], follow: 0.3, weight: 0.07, atNode: 0.75, alwaysShow: false,
    indoorRisk: false, roomSearch: true, zoneSearch: false, wander: false, outdoor: true,
    question: { count: '물에 빠진 사람은 몇 명입니까?', trapped: '아직 물속에 있습니까, 물 밖으로 나왔습니까?', hazard: '물살이 셉니까? 떠내려가고 있습니까?' },
    topicValue: { trapped: 0.95, count: 0.82, hazard: 0.6, injured: 0.35 },
    trappedYes: '물에 빠져서 못 나오고 있어요!', trappedNo: '다들 물 밖으로 나온 것 같아요.', floorHp: 0,
  },
  // ── (N8 단계 4a — 설계서 §4.1) 시설 사고: 끊어진 전선·수도관 파열·싱크홀·간판. 위험을 지키며 유관 기관 복구반을 기다리는 사건 — 짧은 사건 흐름(daily)으로만 나온다(평소 가중 0).
  //    한계·대응 기준·지연·추가 신고·교차로 사전 확률은 설계서 표의 시작값. 방 수색은 수도관 파열의 지하(단계 4b), 바깥 현장(sealPockets 건너뜀)
  utility: {
    name: '시설 사고', limit: 360, respLimit: 110, delay: [3, 9], follow: 0.35, weight: 0, atNode: 1.0, alwaysShow: false,
    indoorRisk: false, roomSearch: true, zoneSearch: false, wander: false, outdoor: true,
    question: { trapped: '차 안이나 구멍에 갇힌 사람이 있습니까?', hazard: '불꽃이 튀거나 물이 계속 나옵니까?', detail: '정확히 무엇이 떨어지거나 꺼졌습니까?' },
    topicValue: { hazard: 0.9, injured: 0.8, trapped: 0.7, count: 0.4 },
    trappedYes: '차 안에 사람이 못 나오고 있어요.', trappedNo: '사람은 다 피했어요.',
    baseNeeds: { suppression: 1, traffic: 1 }, cause: 'electric', floorHp: 0,
  },
  // ── (N8 단계 5 — 설계서 §4.1) 동물: 멧돼지·벌집·개 물림·가축 탈출. 대상이 사람이 아닌 움직이는 것 — 몰아 가두고 쏘지 않는다. 짧은 사건 흐름(daily)으로만(평소 가중 0) ──
  animal: {
    name: '동물', limit: 330, respLimit: 120, delay: [2, 8], follow: 0.4, weight: 0, atNode: 0.9, alwaysShow: false,
    indoorRisk: false, roomSearch: false, zoneSearch: false, wander: false, outdoor: true,
    question: { trapped: '사람이 갇혀 있습니까?', hazard: '동물이 사람에게 달려듭니까?', detail: '몇 마리이고 어디로 갔습니까?' },
    topicValue: { detail: 0.85, injured: 0.8, hazard: 0.7, count: 0.5 },
    trappedYes: '사람이 못 움직이고 있어요.', trappedNo: '다들 피했어요.',
    baseNeeds: { law: 1 }, cause: 'animal', floorHp: 0,
  },
  // ── (N8 단계 6a — 설계서 §4.1) 치안: 주취 소란·폭행 시비·날치기. 총·흉기가 없는 경찰 일상 — 용의자는 늘 맨손이고 지금의 봉쇄·협상·검거를 그대로 탄다. 짧은 사건 흐름(daily)으로만(평소 가중 0) ──
  disturb: {
    name: '치안', limit: 300, respLimit: 95, delay: [2, 6], follow: 0.3, weight: 0, atNode: 0.9, alwaysShow: false,
    indoorRisk: false, roomSearch: false, zoneSearch: false, wander: false, outdoor: false,
    question: { count: '몇 명이 싸우고 있습니까?', detail: '그 사람들은 어디로 갔습니까?' },
    topicValue: { weapon: 0.9, injured: 0.8, count: 0.6, detail: 0.5 },
    baseNeeds: { law: 1 }, cause: 'blunt', floorHp: 0,
  },
  // ── (N8 단계 7 — 설계서 §4.1·§4.5) 보호: 치매 노인·미아. 사람을 찾고 지키는 사건 — 검거·교전이 없다. 구역 확률 수색(구역이 있는 현장)·걷는 대상·체력 하한 20(§5.13) ──
  welfare: {
    name: '보호', limit: 360, respLimit: 100, delay: [2, 10], follow: 0.15, weight: 0, atNode: 0.8, alwaysShow: false,
    indoorRisk: false, roomSearch: true, zoneSearch: true, wander: true, outdoor: false,
    question: { count: '마지막으로 본 게 언제입니까?', hazard: '위험한 곳 가까이 있습니까?', detail: '어떤 옷을 입었습니까?' },
    topicValue: { detail: 0.92, hazard: 0.7, injured: 0.5 },
    baseNeeds: { search: 1 }, cause: 'illness', floorHp: 20,
  },
};

/** 가능도 표에 적지 않은 유형의 값 (그 신고 내용이 그 유형일 가능도가 거의 없다) */
export const LIK_FLOOR = 0.01;
/** 신고 내용 하나가 각 유형일 가능도 — 유형 이름으로 적는다 (적지 않은 유형은 LIK_FLOOR) */
export type LikMap = Partial<Record<IncidentType, number>>;

// 열쇠(표의 줄)마다 한 번만 만든다: 분석 AI 는 진술마다 이 배열을 읽는다. 표의 줄은 모듈을 읽을 때 정해지고 고치지 않는다
const likRows = new WeakMap<LikMap, number[]>();
/** 가능도를 TYPE_ORDER 순서의 배열로 (길이 = TYPE_ORDER.length, 빠진 칸은 LIK_FLOOR) */
export function likRow(m: LikMap): number[] {
  let row = likRows.get(m);
  if (!row) { row = TYPE_ORDER.map((t) => m[t] ?? LIK_FLOOR); likRows.set(m, row); }
  return row;
}

/**
 * (N9 §5.14) 구조 대상의 체력 하한 — 유형의 값(TYPE_DEFS.floorHp — N8 의 보호 유형 20)과 장면의 값(s.kinds2.floorHp — N9 의 차량 돌진·지하철 선로 추락 20)
 * 가운데 큰 쪽. 0 이면 하한이 없다. 하한을 읽는 자리(N8 단계 7 의 hazards.tickCasualties 악화·tickWander·welfareRule, N9 의 규칙이 hurtCas 뒤에 자르는 자리)는
 * 모두 이 함수 하나로 읽는다 — TYPE_DEFS[…].floorHp 를 직접 읽지 않는다. 단계 1 에는 부르는 곳이 없다(둘 다 0 — 결과 불변)
 */
export function floorOf(s: Pick<Scene, 'kind' | 'kinds2'>): number { return Math.max(TYPE_DEFS[s.kind].floorHp, s.kinds2?.floorHp ?? 0); }
