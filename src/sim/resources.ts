// ResourceManager — 부대·대원 명부, 차량 상태와 도시 지도 위 이동.

import { coastY, edgeName, edgeTime, findRoute, nodeName, weatherSpeedFactor } from './city';
import { AIR_KIND, EXTRA_NAMES, ROLES, STAFF, dealFlashbangs, drawBatchFaults, drawFaults, fieldCrew, heliPad, isHovering, kitFor, kitIdsOf, medLevelOf, refillAir, refillGuns, skillsOf, slotsOf } from './crews';
import { recomputeUnmet } from './dispatch/dispatcher';      // 함수 안에서만 부른다 (dispatcher 가 이 파일을 import 한다 — 모듈 맨 위에서 쓰지 않는다)
import type { Sim } from './engine';
import { emit, raiseProblem } from './events';
import { signal } from './world/consequence';      // (I1-b) 병원 인계를 세계에 알린다
import { erLoad, hospitalOf, knownHospital } from './world/state';      // (I1-b C3) 응급실 포화 — startTransport 는 알려진 것(knownHospital)만, arrive 의 응급실 대기는 진실(hospitalOf)
import { canDeploy } from './field/injury';
import { unitArrived } from './field/sceneManager';
import { Rng } from './rng';
import { gateWait, obstacleOnEdge, reportObstacle, stopAhead } from './traffic';
import type { Obstacle } from './traffic';
import type { Dept, Facility, Incident, Needs, Problem, Responder, RoadEdge, Unit, UnitCaps, UnitField, UnitKind } from './types';
import { clamp, fmtSec, josa } from './util';
import { KIT_SHAPE, RESPONDER_SHAPE, UNIT_SHAPE, primeNums } from './shape';      // (R3b N7) 숫자 칸을 만들 때부터 소수 표현으로 — 값은 그대로

const NAMES = ['김도윤', '이서준', '박하준', '최민재', '정지호', '강현우', '윤서연', '한지민', '오수아', '임채원', '신유나', '조은서',
  '배준영', '류시우', '문가은', '송태윤', '황보라', '안지후', '남궁민', '서예린', '권도현', '홍서진', '장하늘', '민지원', '차은우', '표나연', '석민호', '엄지안',
  '여준서', '길하은', '변우진', '탁서윤', '함도경', '채아린', '옥진우', '소유진', '봉재현', '추다은', '공시현', '금나래'];

/** 차량·항공기에 딸린 것 (R1): 환자 자리, 예비 공기통, 호이스트, 물 바구니, 체공 시간 */
interface Fit { seats: number; spareAir: number; hoist?: boolean; bucketMax?: number; fuelMax?: number }
interface UnitDef extends Fit { callsign: string; dept: Dept; kind: UnitKind; field: UnitField; facility: string; caps: UnitCaps; waterMax: number; tool: number; med: number; armor: number; minLevel: number }
// (N8 §5.3.5) 끝의 다섯은 새 수요 열쇠(전력·가스·수도 복구 · 견인 · 동물 포획) — 기본값이 있어 기존 줄은 그대로 컴파일된다. (N9 §5.3.1) 그다음이 제독
const caps = (suppression: number, rescue: number, ems: number, law: number, tactical: number, search: number, traffic: number, eod = 0,
  utilPower = 0, utilGas = 0, utilWater = 0, tow = 0, capture = 0, decon = 0): UnitCaps =>
  ({ suppression, rescue, ems, law, tactical, search, traffic, eod, utilPower, utilGas, utilWater, tow, capture, decon });
// tool·med·armor 는 부대의 대표 성능이다(관제가 본다). 사람이 든 장비는 crews.ts 의 KITS — 현장의 식은 R1 단계 2 부터 사람 값을 쓴다.
const KIND: Record<UnitKind, { dept: Dept; caps: UnitCaps; waterMax: number; tool: number; med: number; armor: number } & Fit> = {
  engine: { dept: 'fire', caps: caps(1.0, 0.55, 0.2, 0, 0, 0.5, 0.4), waterMax: 100, tool: 0.55, med: 0.35, armor: 0.1, seats: 0, spareAir: 4 },
  ladder: { dept: 'fire', caps: caps(1.0, 0.7, 0.2, 0, 0, 0.5, 0.3), waterMax: 140, tool: 0.7, med: 0.35, armor: 0.1, seats: 0, spareAir: 3 },
  rescue: { dept: 'fire', caps: caps(0.75, 1.0, 0.25, 0, 0, 0.8, 0.4), waterMax: 60, tool: 1.0, med: 0.4, armor: 0.1, seats: 0, spareAir: 5 },
  hazmat: { dept: 'fire', caps: caps(0.6, 0.9, 0.3, 0, 0, 0.5, 0.3, 0, 0, 0, 0, 0, 0, 0.7), waterMax: 40, tool: 0.9, med: 0.45, armor: 0.15, seats: 0, spareAir: 4 },      // (N9) 제독 0.7 — 측정·제독 대원(최소 인원에서도 남는다). 제독차가 없을 때 관제의 둘째 후보
  // 헬기 세 종류 (설계서 R1 7.1). 어느 수요에 뜨는지는 dispatcher.airFit 이 정한다 — caps 는 그 헬기가 맡는 수요만 기준(MINCAP)을 넘게 좁혀 두었다
  heli: { dept: 'fire', caps: caps(0, 0.9, 0.4, 0, 0, 0.9, 0), waterMax: 0, tool: 0.6, med: 0.8, armor: 0.05, seats: 1, spareAir: 0, hoist: true, bucketMax: 1, fuelMax: 660 },      // 소방 헬기: 구조·수색 (구급 0.4 는 기준 밑 — 구급차 대신은 의료 헬기가 한다)
  policeHeli: { dept: 'police', caps: caps(0, 0, 0, 0, 0, 1.6, 0), waterMax: 0, tool: 0.1, med: 0.2, armor: 0, seats: 0, spareAir: 0, fuelMax: 720 },      // 경찰 헬기: 하늘의 눈 (수색만)
  medHeli: { dept: 'ems', caps: caps(0, 0.2, 1.2, 0, 0, 0, 0), waterMax: 0, tool: 0.1, med: 1.1, armor: 0, seats: 1, spareAir: 0, fuelMax: 780 },      // 의료 헬기: 의사·간호사, 중환자 한 명
  boat: { dept: 'fire', caps: caps(0, 0.9, 0.5, 0, 0, 0.8, 0), waterMax: 0, tool: 0.8, med: 0.5, armor: 0.05, seats: 0, spareAir: 0 },
  als: { dept: 'ems', caps: caps(0, 0.15, 1.0, 0, 0, 0.3, 0.2), waterMax: 0, tool: 0.1, med: 1.0, armor: 0, seats: 2, spareAir: 0 },
  bls: { dept: 'ems', caps: caps(0, 0.15, 0.8, 0, 0, 0.3, 0.2), waterMax: 0, tool: 0.1, med: 0.75, armor: 0, seats: 2, spareAir: 0 },
  patrol: { dept: 'police', caps: caps(0, 0.15, 0.15, 0.8, 0.5, 0.7, 1.0), waterMax: 0, tool: 0.12, med: 0.25, armor: 0.2, seats: 0, spareAir: 0 },
  tactical: { dept: 'police', caps: caps(0, 0.15, 0.15, 1.0, 1.0, 0.7, 0.7), waterMax: 0, tool: 0.12, med: 0.25, armor: 0.5, seats: 0, spareAir: 0 },
  swat: { dept: 'police', caps: caps(0, 0.15, 0.2, 1.0, 1.4, 0.5, 0.3), waterMax: 0, tool: 0.2, med: 0.3, armor: 0.75, seats: 0, spareAir: 0 },
  eod: { dept: 'police', caps: caps(0, 0.2, 0.15, 0.6, 0.5, 0.4, 0.4, 1), waterMax: 0, tool: 0.3, med: 0.25, armor: 0.6, seats: 0, spareAir: 0 },
  // (N8 §4.9) 새 부대 여덟. 보조 능력은 관제 기준(MINCAP) 아래이거나 dispatcher.kindFit 이 일을 좁힌다 — 평소 사건의 수요에 끼어들지 않게
  powerCrew: { dept: 'civil', caps: caps(0, 0, 0, 0, 0, 0, 0, 0, 1.0), waterMax: 0, tool: 0.3, med: 0.1, armor: 0, seats: 0, spareAir: 0 },      // 전력 복구반 (버킷 트럭)
  gasCrew: { dept: 'civil', caps: caps(0, 0, 0, 0, 0, 0, 0, 0, 0, 1.0), waterMax: 0, tool: 0.3, med: 0.1, armor: 0, seats: 0, spareAir: 0 },      // 가스 복구반
  waterCrew: { dept: 'civil', caps: caps(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.0), waterMax: 0, tool: 0.3, med: 0.1, armor: 0, seats: 0, spareAir: 0 },      // 수도 복구반
  tow: { dept: 'civil', caps: caps(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1.0), waterMax: 0, tool: 0.3, med: 0.1, armor: 0, seats: 0, spareAir: 0 },      // 견인차
  animalCtl: { dept: 'fire', caps: caps(0, 0.3, 0, 0, 0, 0.2, 0, 0, 0, 0, 0, 0, 1.0), waterMax: 0, tool: 0.3, med: 0.3, armor: 0.05, seats: 0, spareAir: 0 },      // 동물 포획팀 (구조 0.3·수색 0.2 는 기준 밑)
  detective: { dept: 'police', caps: caps(0, 0, 0, 0.6, 0, 0.5, 0), waterMax: 0, tool: 0.12, med: 0.25, armor: 0.2, seats: 0, spareAir: 0 },      // 형사 (치안 유형만 — kindFit)
  trafficPol: { dept: 'police', caps: caps(0, 0, 0, 0.4, 0, 0.2, 1.0), waterMax: 0, tool: 0.12, med: 0.25, armor: 0.2, seats: 0, spareAir: 0 },      // 교통 경찰 오토바이 (경찰 0.4·수색 0.2 는 기준 밑)
  k9: { dept: 'police', caps: caps(0, 0, 0, 0.5, 0, 0.9, 0), waterMax: 0, tool: 0.12, med: 0.25, armor: 0.2, seats: 0, spareAir: 0 },      // 경찰견 (실종·보호·치안의 수색만 — kindFit)
  // (N9 §4.8) 새 부대 넷. 보조 능력이 관제 기준(MINCAP)을 넘으므로 dispatcher.kindFit 이 일을 좁힌다(KIND_AUX) — 평소 사건의 1순위가 되지 않게.
  // 기동대의 기동 0.85 는 기준(0.9) 밑이다(섬광탄이 없다 — 인질 사건의 '섬광탄을 가진 기동대' 요청이 기동대 배정으로 멈추지 않게)
  mtnRescue: { dept: 'fire', caps: caps(0, 0.7, 0.35, 0, 0, 0.85, 0), waterMax: 0, tool: 0.7, med: 0.4, armor: 0.05, seats: 0, spareAir: 0 },      // 산악 구조대 (사륜구동 — 산·'산악 조난'만)
  dive: { dept: 'fire', caps: caps(0, 0.8, 0.3, 0, 0, 0.7, 0), waterMax: 0, tool: 0.6, med: 0.35, armor: 0.05, seats: 0, spareAir: 0 },      // 수중 구조대 (보트 받침 승합 — 수난만)
  deconUnit: { dept: 'fire', caps: caps(0.3, 0.45, 0, 0, 0, 0.2, 0, 0, 0, 0, 0, 0, 0, 1.0), waterMax: 40, tool: 0.5, med: 0.45, armor: 0.15, seats: 0, spareAir: 4 },      // 화생방 제독차 (천막 실은 큰 차 — 제독만)
  riotPol: { dept: 'police', caps: caps(0, 0, 0, 0.9, 0.85, 0.25, 0.6), waterMax: 0, tool: 0.15, med: 0.25, armor: 0.45, seats: 0, spareAir: 0 },      // 경찰 기동대 버스 (군중·폭동의 경찰·교통 수요만)
};
/** 큰 차: 불법 주차로 좁아진 골목을 지나지 못한다 (traffic.ts) */
const HEAVY: Partial<Record<UnitKind, boolean>> = { engine: true, ladder: true, rescue: true, hazmat: true, powerCrew: true, waterCrew: true, tow: true,      // (N8) 버킷 트럭·수도 복구차·견인차
  deconUnit: true, riotPol: true };      // (N9) 제독차 · 기동대 버스
const U = (callsign: string, kind: UnitKind, field: UnitField, facility: string, minLevel: number): UnitDef => ({ callsign, kind, field, facility, minLevel, ...KIND[kind] });
// 편성표: 네 분야(경찰·소방·구조·특수)마다 3~6팀. minLevel 은 난이도의 "부대 규모"가 이 값 이상일 때 편성된다
// (1 = 12팀, 2 = 15팀, 3 = 19팀, 4 = 21팀, 5 = 22팀). 줄의 순서를 바꾸면 대원 능력치가 바뀐다(이 순서로 뽑는다).
// 부대마다의 인원과 역할은 crews.ts 의 STAFF (부대 규모 1·2 는 최소 인원, 3~5 는 표준 인원). 새 줄은 끝에 붙인다.
const UNIT_DEFS: UnitDef[] = [
  U('순찰1', 'patrol', 'police', '중부경찰서', 1), U('순찰2', 'patrol', 'police', '서부지구대', 1), U('기동1', 'tactical', 'police', '동부지구대', 1), U('순찰3', 'patrol', 'police', '동부지구대', 2), U('기동2', 'tactical', 'police', '중부경찰서', 4),
  U('진압1', 'engine', 'fire', '중앙소방서', 1), U('진압2', 'engine', 'fire', '서부119안전센터', 1), U('사다리1', 'ladder', 'fire', '공단119안전센터', 1), U('진압3', 'engine', 'fire', '한솔119안전센터', 3), U('진압4', 'engine', 'fire', '공단119안전센터', 5),
  U('구조1', 'rescue', 'rescue', '중앙소방서', 1), U('구급1', 'als', 'rescue', '중앙소방서', 1), U('구급2', 'bls', 'rescue', '서부119안전센터', 1), U('구급3', 'als', 'rescue', '공단119안전센터', 2), U('구조2', 'rescue', 'rescue', '한솔119안전센터', 4),
  U('특공1', 'swat', 'special', '중부경찰서', 1), U('헬기1', 'heli', 'special', '소방항공대', 1), U('화학1', 'hazmat', 'special', '공단119안전센터', 1), U('구조정1', 'boat', 'special', '해양구조대', 2), U('폭발물1', 'eod', 'special', '중부경찰서', 3),
  // (R1) 경찰 헬기는 중부경찰서 옥상, 의료 헬기는 가온대학교병원 옥상에 둔다 (새 시설을 만들지 않는다). 소방 헬기(헬기1)는 특수 분야에 남는다
  U('경찰헬기1', 'policeHeli', 'police', '중부경찰서', 3), U('의료헬기1', 'medHeli', 'rescue', '가온대학교병원', 3),
  // (N8 §4.9 · §5.3.7) 새 부대 여덟 — 끝에 붙인다. minLevel 6 = 어느 부대 규모에서도 편성되지 않는다(단계 2b — 결과 불변). 그래도 이름(EXTRA_NAMES)과
  // roster-v2:<호출부호>:<자리> 흐름의 자리는 차지한다(앞 사람은 바뀌지 않는다). 그 부대를 쓰는 단계가 편성 단계로 내린다:
  // 전력1·가스1·수도1 → 1 (4a·4b — 단계 4a 에 전력1, 4b 에 가스1·수도1 을 내렸다), 견인1 → 2 (6b), 포획1 → 1 (5), 형사1 → 2 (6a), 교통1 → 3 (6a), 경찰견1 → 3 (6a). 시청·물류터미널은 부대가 없던 출동 시설이다
  U('전력1', 'powerCrew', 'civil', '시청', 1), U('가스1', 'gasCrew', 'civil', '시청', 1), U('수도1', 'waterCrew', 'civil', '시청', 1), U('견인1', 'tow', 'civil', '물류터미널', 6),
  U('포획1', 'animalCtl', 'special', '서부119안전센터', 1), U('형사1', 'detective', 'police', '중부경찰서', 2), U('교통1', 'trafficPol', 'police', '동부지구대', 3), U('경찰견1', 'k9', 'police', '서부지구대', 3),      // (N8 단계 6a) 형사 2 · 교통 경찰 3 · 경찰견 3 (6 → 편성)
  // (N9 §4.8 · §5.3.7) 새 부대 넷 — N8 줄 다음 끝에. minLevel 6 = 편성되지 않는다(단계 2 — 결과 불변). 소방 줄 셋(산악·수중·제독)도 펌프 상태(equipment 흐름)를
  // 편성 검사 전에 뽑지만 그 흐름은 이 뒤에 쓰는 곳이 없다. 그 부대를 쓰는 단계가 3 으로 내린다: 기동대1 → 4, 수중1 → 5, 제독1 → 6, 산악1 → 9
  U('산악1', 'mtnRescue', 'rescue', '서부119안전센터', 6), U('수중1', 'dive', 'rescue', '해양구조대', 6), U('제독1', 'deconUnit', 'special', '공단119안전센터', 6), U('기동대1', 'riotPol', 'police', '중부경찰서', 6),
];

export const UNIT_KIND_NAME: Record<UnitKind, string> = { engine: '진압 펌프차', rescue: '구조 공작차', als: '전문 구급차', bls: '일반 구급차', patrol: '순찰차', tactical: '기동 순찰차', ladder: '사다리차', hazmat: '화학 구조차', swat: '특공대 장갑차', eod: '폭발물 처리 차량', heli: '소방 헬기', boat: '구조정', policeHeli: '경찰 헬기', medHeli: '의료 헬기',
  powerCrew: '전력 복구차', gasCrew: '가스 복구차', waterCrew: '수도 복구차', tow: '견인차', animalCtl: '동물 포획차', detective: '형사 차량', trafficPol: '교통 순찰 오토바이', k9: '경찰견 차량',
  mtnRescue: '산악 구조대 차량', dive: '수중 구조대 차량', deconUnit: '화생방 제독차', riotPol: '경찰 기동대 버스' };      // (N9)
export const FIELD_NAME: Record<UnitField, string> = { police: '경찰', fire: '소방', rescue: '구조·구급', special: '특수', civil: '유관 기관' };

export function traitOf(r: Responder): string {
  const stats: [string, number][] = [['침착함', r.composure], ['판단 빠름', r.judgment], ['체력 좋음', r.fitness], ['협동적', r.teamwork], ['베테랑', r.experience], ['기술 숙련', r.skill]];
  stats.sort((a, b) => b[1] - a[1]);
  const lows: [string, number][] = [['쉽게 동요', r.composure], ['판단 미숙', r.judgment], ['체력 약함', r.fitness], ['독단적', r.teamwork], ['신입', r.experience]];
  lows.sort((a, b) => a[1] - b[1]);
  return lows[0][1] < 0.42 ? `${stats[0][0]} · ${lows[0][0]}` : stats[0][0];
}

/** 의료 헬기가 없는 편성에서 소방 헬기의 구급 능력 (관제의 기준 MINCAP.ems 와 같다 — 구급 수요를 맡을 수 있다) */
const HELI_EMS_ALONE = 0.7;
/** 고정 조직 시드: 대원의 기본 능력은 여기서만 나온다 (교대 시드와 무관 — 같은 대원이 매 교대에 등장한다) */
const ROSTER_SEED = 0x51ab7e;
/** R1 전부터 있던 줄의 수. 이 줄들의 0·1번 자리는 예전의 선임·후임이다: 예전 흐름(roster-v1)과 NAMES 를 그대로 쓴다 */
const LEGACY_ROWS = 20;
/** 부대의 새 칸(R1)을 편성표·지원 두 부대 객체에 같은 순서로 넣는다. 헬기의 grounded 는 createRoster 가 날씨로 정한다 */
const fitOf = (d: Fit): Pick<Unit, 'seats' | 'hoist' | 'bucket' | 'bucketMax' | 'fuel' | 'fuelMax' | 'grounded' | 'spareAir' | 'airNeed'> =>
  ({ seats: d.seats, hoist: !!d.hoist, bucket: d.bucketMax ?? 0, bucketMax: d.bucketMax ?? 0, fuel: d.fuelMax ?? 0, fuelMax: d.fuelMax ?? 0, grounded: null, spareAir: d.spareAir, airNeed: undefined });

/**
 * (R3 §2.9) 차에 실은 탄약 상자 (한 상자 = 한 사람의 총기를 가득): 순찰·폭발물 처리반 = 장비 손잡이의 값, 기동 +1, 특공 +2.
 * 경찰 헬기는 0(내리는 사람이 없다), 총을 들지 않는 부대도 0. (N8·N9 의 경찰 부대 — 형사·교통 경찰·경찰견·기동대 버스 — 는 순찰과 같다)
 */
const AMMO_BOX_ADD: Partial<Record<UnitKind, number>> = { patrol: 0, eod: 0, tactical: 1, swat: 2, detective: 0, trafficPol: 0, k9: 0, riotPol: 0 };
function ammoBoxOf(kind: UnitKind, base: number): number { const add = AMMO_BOX_ADD[kind]; return add === undefined ? 0 : base + add; }
/** (R3 §3.2 F10) 예비 펌프: 펌프를 단 부대(물탱크가 있는 종류 — 펌프차·사다리차·구조 공작차·화학 구조차·제독차)만 장비 손잡이의 수, 그 밖은 undefined(펌프가 없다) */
export function sparePumpOf(kind: UnitKind, base: number): number | undefined { return KIND[kind].waterMax > 0 ? base : undefined; }

/** 조직 명부의 열쇠 한 자리 (I2 — 교대 간 지속): 그 자리의 원래 이름, 소속 호출부호, 표준 자리 번호 */
export interface RosterKey { name: string; callsign: string; slot: number }
let rosterKeyList: RosterKey[] | null = null;
/**
 * 조직 명부의 모든 자리 (I2 §2.4·§10.2): 편성표(UNIT_DEFS) 줄 순서 × 표준 자리(STAFF[kind].std) 순서. 난수를 쓰지 않는다.
 * 편성되지 않는 부대·최소 인원에서 빠지는 자리도 들어 있다 — 부대 규모 손잡이와 상관없는 "조직의 사람"이다 (교대 간 지속의 열쇠는 이름이다).
 * 이름은 처음 20줄의 0·1번 자리가 NAMES[줄 × 2 + 자리], 그 밖의 자리는 EXTRA_NAMES 를 표준 자리 첨자로 (설계서 R1 5절).
 * createRoster 도 이 목록에서 이름을 읽는다 — 같은 식이 두 곳에 있지 않게. 처음 부를 때 한 번 만든다
 */
export function rosterKeys(): readonly RosterKey[] {
  if (rosterKeyList) return rosterKeyList;
  const out: RosterKey[] = [];
  let extra = 0;                           // EXTRA_NAMES 의 첨자: 표준 표의 자리마다 하나 (편성되지 않은 줄, 빠진 자리도 자기 번호를 차지한다)
  UNIT_DEFS.forEach((d, di) => {
    const std = STAFF[d.kind].std;
    for (let k = 0; k < std.length; k++) out.push({ name: di < LEGACY_ROWS && k < 2 ? NAMES[di * 2 + k] : EXTRA_NAMES[extra++], callsign: d.callsign, slot: k });
  });
  rosterKeyList = out;
  return out;
}

/**
 * 대원 능력은 고정된 조직 시드에서 만든다(같은 대원이 매 교대에 등장). 장비 상태는 교대 시드에서 만든다.
 * 부대마다의 자리는 crews.ts 의 STAFF 를 따른다. 능력의 난수는 두 흐름이다 (설계서 R1 5절):
 *  - 처음 20줄의 0·1번 자리: roster-v1 에서 줄 순서대로 한 명당 6번(경험 → 능력 다섯). 편성되지 않는 부대도 똑같이 뽑는다.
 *  - 그 밖의 자리: 자리마다 따로 roster-v2:<호출부호>:<자리>. 다른 부대의 인원과 상관없이 같은 사람 = 같은 능력치다.
 */
export function createRoster(sim: Sim): void {
  const rosterRng = new Rng(ROSTER_SEED).fork('roster-v1');
  const equipRng = sim.rng.fork('equipment');
  const tn = sim.tune;
  const minimal = tn.unitLevel <= 2;      // 부대 규모 1·2 는 최소 인원으로 나간다
  // 의료 헬기가 편성되지 않는 부대 규모(1·2)에서는 소방 헬기가 예전처럼 구급차를 대신할 수 있다 (구급 능력 0.7 = 관제의 기준. 설계서 R1 17절의 위험과 그 대책).
  // 능력 표(KIND)는 같은 종류의 부대가 함께 쓰는 객체이므로 그 헬기 것만 따로 만든다
  const medHeliFielded = UNIT_DEFS.some((q) => q.kind === 'medHeli' && q.minLevel <= tn.unitLevel);
  const keys = rosterKeys();               // (I2) 이름은 조직 명부의 열쇠에서 — 편성표 줄 × 표준 자리마다 하나 (편성되지 않은 줄, 빠진 자리도 자기 번호를 차지한다)
  let ki = 0;
  UNIT_DEFS.forEach((d, di) => {
    const f = sim.city.facilities.find((q) => q.name === d.facility)!;
    const home = sim.city.nodes[f.nodeId];
    const include = d.minLevel <= tn.unitLevel;
    const uid = sim.units.length;
    const crew: number[] = [], members: Responder[] = [];
    const staff = STAFF[d.kind];
    for (let k = 0; k < staff.std.length; k++) {
      const role = staff.std[k], def = ROLES[role];
      const legacy = di < LEGACY_ROWS && k < 2;
      // 편성되지 않는 부대·빠지는 자리도 난수는 똑같이 뽑는다(부대 규모를 바꿔도 같은 대원은 같은 능력치를 갖도록)
      const rng = legacy ? rosterRng : new Rng(ROSTER_SEED).fork(`roster-v2:${d.callsign}:${k}`);
      const name = keys[ki++].name;      // 처음 20줄의 0·1번 자리는 NAMES, 그 밖은 EXTRA_NAMES (rosterKeys)
      const senior = k === 0;
      const st = () => clamp(rng.range(0.3, 0.95), 0, 1);
      const exp = legacy ? (senior ? rng.range(0.6, 0.97) : rng.range(0.12, 0.6))
        : def.exp ? rng.range(def.exp[0], def.exp[1]) : senior ? rng.range(0.6, 0.97) : rng.range(0.2, 0.75);
      const skill = clamp(st() * 0.6 + exp * 0.4 + 0.05, 0.3, 0.98);
      const r: Responder = {
        id: sim.responders.length, name, dept: d.dept, unitId: uid, senior,
        skill, judgment: clamp(st() * 0.65 + exp * 0.35, 0.2, 0.98), composure: st(), fitness: st(), teamwork: st(), experience: exp,
        skills: skillsOf(role, skill),      // 능력은 역할의 식으로만 정한다 (추가 난수 없음)
        trait: '', health: 100, stamina: tn.startStamina, status: 'ok', xpGained: 0, incidentsWorked: 0,
        role, kit: kitFor(role, tn.airFull, kitIdsOf(d.kind, k)),      // 공기통은 장비 손잡이의 용량으로 가득 채워 나간다. 장비는 역할의 기본 장비 (복구반장만 부대마다 — kitIdsOf)
        injuries: undefined, bleed: undefined, bleed0: undefined, treatQ: undefined, dead: undefined, tDown: undefined, tDead: undefined, care: undefined, deathCause: undefined, bleedCause: undefined,      // (H1) 부상 — 없으면 "다친 적 없음"
        seat: undefined, relief: undefined, carryOut: undefined, carryCause: undefined,      // (I2) 이어받은 상태 — persist.ts 가 채운다 (단계 2)
      };
      r.trait = traitOf(r);
      primeNums(r, RESPONDER_SHAPE); for (const it of r.kit ?? []) primeNums(it, KIT_SHAPE);      // (R3b N7)
      if (include && !(minimal && staff.minDrop.indexOf(k) >= 0)) { crew.push(r.id); sim.responders.push(r); members.push(r); }
    }
    const pump = d.dept === 'fire' ? equipRng.range(tn.pumpMin, tn.pumpMax) : 1;
    if (!include) return;
    // 섬광탄은 사람 몫으로 나눈다. 부대의 flashbangs 는 그 합이다
    const bangs = dealFlashbangs(members, d.kind === 'tactical' ? tn.flashbangs : d.kind === 'swat' ? tn.flashbangs + 2 : 0);
    const u: Unit = {
      id: uid, callsign: d.callsign, dept: d.dept, kind: d.kind, crew, homeNode: f.nodeId, homeName: f.name,
      state: 'available', x: home.x, y: home.y, px: home.x, py: home.y, nodeId: f.nodeId,
      route: null, seg: 0, segT: 0, pendingDest: null, destNode: null, incidentId: null, timer: 0,
      caps: d.kind === 'heli' && !medHeliFielded ? { ...d.caps, ems: HELI_EMS_ALONE } : d.caps, water: d.waterMax * tn.waterMul, waterMax: d.waterMax * tn.waterMul, hydrant: false,
      pumpCond: pump, pumpFailed: false,
      tool: Math.min(1.15, d.tool * tn.toolMul), medLevel: Math.min(1.1, d.med * tn.medMul), armor: Math.min(0.8, d.armor * tn.armorMul),
      flashbangs: bangs,
      patients: [], patientsIncident: null,
      dispatchedAt: -1, estArrive: -1, diverted: false, busyTime: 0, runs: 0, boardOrder: null,
      field: d.field, air: AIR_KIND.has(d.kind), sea: d.kind === 'boat',
      aid: undefined, heavy: undefined, backing: undefined, curb: undefined, curbT: undefined, parking: undefined,      // 나중에 붙는 칸을 미리 비워 둔다: 모든 부대가 같은 모양의 객체가 된다
      ...fitOf(d),
      aboard: undefined, firstLoadAt: undefined, oosEv: undefined,      // (H1) 부상 대원·용의자의 후송 — 쓰는 것은 단계 4b 부터
      ammoBox: ammoBoxOf(d.kind, tn.ammoBox), ammoBoxMax: ammoBoxOf(d.kind, tn.ammoBox), sparePump: sparePumpOf(d.kind, tn.sparePump),      // (R3) 탄약 상자(2단계 — 장비 손잡이)·예비 펌프(3단계 — 장비 손잡이, 물탱크가 있는 부대만)
      readyAt: undefined, oosWhy: undefined, pumpFails: 0,      // (I2) 정비 중인 부대의 운용 시각·oos 의 이유(단계 3·2)·이번 교대의 펌프 고장 수(단계 3)
    };
    if (u.sea) { u.x = u.px = f.x + 30; u.y = u.py = coastY(f.x + 30) + SEA_OFF; }
    if (u.air) {
      const [hx, hy] = heliPad(sim, f); u.x = u.px = hx; u.y = u.py = hy;
      // 뜨지 못하는 날씨: 안개에는 어느 헬기도, 밤에는 의료 헬기가 뜨지 않는다 (교대 내내). 태풍의 강풍은 tickUnits 가 본다
      u.grounded = sim.weather === 'fog' ? 'fog' : d.kind === 'medHeli' && sim.weather === 'night' ? 'night' : null;
      if (u.grounded && sim.airStats.grounded !== 'fog') sim.airStats.grounded = u.grounded;
    }
    if (HEAVY[d.kind]) u.heavy = true;
    primeNums(u, UNIT_SHAPE);      // (R3b N7)
    sim.units.push(u);
  });
  // 개인 장비의 고장 추첨: 교대 흐름 'kit' 하나로, 편성된 대원만 (대원 순서 × 장비 순서). 고장은 처음 쓰려 할 때 드러난다
  drawFaults(sim.rng.fork('kit'), sim.responders, tn.kitFault);
  // (N9 §5.12) 잠수 장비(batch 'n9')는 kit 의 추첨 순서에 끼지 않고 그 뒤에 따로 kit-n9 흐름에서 같은 순서·같은 확률로 뽑는다 (든 대원이 편성되지 않으면 한 번도 뽑지 않는다)
  drawBatchFaults(sim.rng.fork('kit-n9'), sim.responders, tn.kitFault, 'n9');
  // (R2 §3.3) 대응 방법의 고장 나는 장비(batch 'r2' — 고무보트·송풍기·에어백)도 따로 kit-r2 흐름에서 (역할 장비 끝에 붙여도 kit 의 뒤 장비 고장이 밀리지 않는다)
  drawBatchFaults(sim.rng.fork('kit-r2'), sim.responders, tn.kitFault, 'r2');
  // (N8 단계 5) 마취총(batch 'n8')도 kit 의 추첨 순서에 끼지 않고 따로 kit-n8 흐름에서 (편성표 끝의 포획팀이 교대 흐름 kit 을 쓰면 그 뒤에 붙을 줄의 고장이 바뀐다)
  drawBatchFaults(sim.rng.fork('kit-n8'), sim.responders, tn.kitFault, 'n8');
}

// 지원 부대의 이름: 지원 한 번에 네 칸씩 쓴다(지원 종류의 최소 인원은 많아야 4명). 지원은 교대당 많아야 5회, 재난 때 3회 더(disaster.ts) — 8회 × 4칸
const AID_NAMES = ['한도현', '서지우', '문태윤', '양서아', '고준혁', '배하린', '남건우', '유채원', '심재민', '노은서', '하승우', '전소율', '곽민석', '우다인', '진현수', '방예린',
  '국태린', '마하겸', '도은결', '위서담', '기서후', '나도겸', '라온유', '모아진', '범준기', '빈세현', '사윤호', '어진솔', '예다함', '은가람', '인태오', '피세온',
  // (N8 §4.9) 새 지원 수요 넷(전력·가스·수도·포획) × 4칸 — 끝에 붙인다. 교대당 지원은 많아야 8회(aidUsed 0~7 → 첨자 0~31)라 앞의 이름이 바뀌지 않는다
  '강서율', '구하진', '길도담', '나은후', '단서연', '류하온', '맹지섭', '목하늘', '방지오', '서한별', '소이안', '안도유', '옥서진', '육하람', '장도경', '편지안',
  // (N9 §4.8) 새 지원 수요 하나(제독) × 4칸 — 끝에 붙인다 (교대당 지원 8회 안에서는 앞의 이름이 그대로다)
  '권이준', '소하윤', '차서진', '하은별'];
const AID_KIND: Record<keyof Needs, UnitKind> = { suppression: 'engine', rescue: 'rescue', ems: 'bls', law: 'patrol', tactical: 'tactical', search: 'patrol', traffic: 'patrol', eod: 'eod',
  utilPower: 'powerCrew', utilGas: 'gasCrew', utilWater: 'waterCrew', tow: 'tow', capture: 'animalCtl',      // (N8) 견인은 지원을 부르지 않는다(§5.3.8 — 밀어 둠이 언제나 있다): AID_KIND.tow 는 표를 채우려고만 둔다
  decon: 'deconUnit' };      // (N9 §5.3.1) 지원 제독차 (최소 인원 — 팀장·제독 대원 둘)
const AID_CALL: Partial<Record<UnitKind, string>> = { engine: '지원진압', rescue: '지원구조', als: '지원구급', bls: '지원구급', patrol: '지원순찰', tactical: '지원기동', eod: '지원폭발물',
  powerCrew: '지원전력', gasCrew: '지원가스', waterCrew: '지원수도', animalCtl: '지원포획', deconUnit: '지원제독' };

/**
 * 인근 도시 지원 부대를 만든다. 도시 가장자리의 교차로 가운데 사건 현장에 가장 빨리 닿는 곳에서 출발한다.
 * 임무를 마치고 그 자리로 돌아가면 관할로 복귀한 것으로 보고 다시 쓰지 않는다.
 */
export function createAidUnit(sim: Sim, key: keyof Needs, I: Incident): Unit | null {
  const kind = AID_KIND[key], d = UNIT_DEFS.find((q) => q.kind === kind)!;
  const wf = weatherSpeedFactor(sim);
  let home = -1, bt = Infinity;
  for (const n of sim.city.nodes) {
    if (!n.exit) continue;      // 도시 밖으로 이어지는 길의 끝에서 들어온다
    const rt = findRoute(sim.city, n.id, I.reportedNode, wf);
    if (rt && rt.time < bt) { bt = rt.time; home = n.id; }
  }
  if (home < 0) return null;
  const rng = sim.rng.fork('aid:' + sim.aidUsed), tn = sim.tune;
  const uid = sim.units.length, crew: number[] = [], members: Responder[] = [];
  // 지원 부대는 그 종류의 최소 인원 편성이다(급히 꾸린 팀). 역할·장비는 편성표 그대로.
  // 난수(aid:<n>)의 순서: 대원(자리 순서, 한 명당 경험 1 + 능력 5) → 펌프 상태 → 개인 장비 고장 추첨
  const staff = STAFF[kind];
  slotsOf(kind, true).forEach((slot, k) => {
    const role = staff.std[slot];
    const senior = slot === 0;
    const st = (): number => clamp(rng.range(0.3, 0.9), 0, 1);
    const exp = senior ? rng.range(0.55, 0.9) : rng.range(0.15, 0.55);      // 역할의 경험 범위(exp)는 쓰지 않는다 (지원 종류에는 조종사가 없다)
    const skill = clamp(st() * 0.6 + exp * 0.4 + 0.05, 0.3, 0.95);
    const r: Responder = {
      id: sim.responders.length, name: AID_NAMES[(sim.aidUsed * 4 + k) % AID_NAMES.length], dept: d.dept, unitId: uid, senior,
      skill, judgment: clamp(st() * 0.65 + exp * 0.35, 0.2, 0.95), composure: st(), fitness: st(), teamwork: st() * 0.85, experience: exp,
      skills: skillsOf(role, skill),
      trait: '', health: 100, stamina: 88, status: 'ok', xpGained: 0, incidentsWorked: 0,
      role, kit: kitFor(role, tn.airFull, kitIdsOf(kind, slot)),
      injuries: undefined, bleed: undefined, bleed0: undefined, treatQ: undefined, dead: undefined, tDown: undefined, tDead: undefined, care: undefined, deathCause: undefined, bleedCause: undefined,      // (H1) 편성표 대원과 같은 칸, 같은 순서
      seat: undefined, relief: undefined, carryOut: undefined, carryCause: undefined,      // (I2) 편성표 대원과 같은 칸, 같은 순서
    };
    r.trait = traitOf(r);
    primeNums(r, RESPONDER_SHAPE); for (const it of r.kit ?? []) primeNums(it, KIT_SHAPE);      // (R3b N7)
    crew.push(r.id); sim.responders.push(r); members.push(r);
  });
  const bangs = dealFlashbangs(members, kind === 'tactical' ? Math.min(2, tn.flashbangs) : 0);
  const n = sim.city.nodes[home];
  const same = sim.units.filter((q) => q.aid && q.kind === kind).length;
  const u: Unit = {
    id: uid, callsign: (AID_CALL[kind] ?? '지원') + (same + 1), dept: d.dept, kind, crew, homeNode: home, homeName: '인근 도시',
    state: 'available', x: n.x, y: n.y, px: n.x, py: n.y, nodeId: home,
    route: null, seg: 0, segT: 0, pendingDest: null, destNode: null, incidentId: null, timer: 0,
    caps: d.caps, water: d.waterMax * tn.waterMul, waterMax: d.waterMax * tn.waterMul, hydrant: false,
    pumpCond: d.dept === 'fire' ? rng.range(0.6, 0.95) : 1, pumpFailed: false,
    tool: Math.min(1.15, d.tool * tn.toolMul), medLevel: Math.min(1.1, d.med * tn.medMul), armor: Math.min(0.8, d.armor * tn.armorMul),
    flashbangs: bangs,
    patients: [], patientsIncident: null,
    dispatchedAt: -1, estArrive: -1, diverted: false, busyTime: 0, runs: 0, boardOrder: null,
    field: undefined, air: undefined, sea: undefined, aid: true, heavy: undefined, backing: undefined, curb: undefined, curbT: undefined, parking: undefined,      // 편성표 부대와 같은 칸, 같은 순서
    ...fitOf(d),      // 환자 자리·예비 공기통도 편성표 부대와 같게 (빠뜨리면 지원 구급차가 환자를 싣지 못한다)
    aboard: undefined, firstLoadAt: undefined, oosEv: undefined,      // (H1) 편성표 부대와 같은 칸, 같은 순서
    ammoBox: ammoBoxOf(kind, tn.ammoBox), ammoBoxMax: ammoBoxOf(kind, tn.ammoBox), sparePump: sparePumpOf(kind, tn.sparePump),      // (R3) 편성표 부대와 같은 칸, 같은 순서
    readyAt: undefined, oosWhy: undefined, pumpFails: 0,      // (I2) 편성표 부대와 같은 칸, 같은 순서
  };
  if (HEAVY[kind]) u.heavy = true;
  drawFaults(rng, members, tn.kitFault);      // 펌프 상태 다음에 뽑는다 (같은 흐름 aid:<n> 의 끝)
  drawBatchFaults(sim.rng.fork('aid-n9:' + sim.aidUsed), members, tn.kitFault, 'n9');      // (N9) 잠수 장비는 따로 (지원 종류에는 그 장비를 든 자리가 없다 — 지금은 한 번도 뽑지 않는다)
  drawBatchFaults(sim.rng.fork('aid-r2:' + sim.aidUsed), members, tn.kitFault, 'r2');
  drawBatchFaults(sim.rng.fork('aid-n8:' + sim.aidUsed), members, tn.kitFault, 'n8');      // (N8 단계 5) 지원 포획팀의 마취총      // (R2 §3.3) 대응 방법의 고장 나는 장비도 따로 (지원 구조대의 로프 대원이 든 고무보트)
  primeNums(u, UNIT_SHAPE);      // (R3b N7)
  sim.units.push(u);
  return u;
}

/** 현장에 내리는 대원의 이름 (조종사·정장처럼 내리지 않는 자리는 뺀다) */
export function crewNames(sim: Sim, u: Unit): string { return fieldCrew(sim, u).map((r) => sim.responders[r].name).join('·'); }
/** 온전한 대원 수: 내리는 자리(fieldCrew) 가운데 다치지 않았고(status 'ok') 병원으로 후송되지 않은 사람 (H1 §3.6) */
export function crewOk(sim: Sim, u: Unit): number {
  const fc = fieldCrew(sim, u);
  let n = 0; for (let k = 0; k < fc.length; k++) { const r = sim.responders[fc[k]]; if (r.status === 'ok' && r.care === undefined) n++; }
  return n;
}
/**
 * 걸을 수 있는 대원 수 = 지금 현장에 내릴 수 있는 대원 수 (온전한 대원 + 걸을 수 있는 다친 대원). 0 이면 배정에서 빠진다 —
 * 운용 중단 규칙이 아니라 움직일 사람이 없어서다: 전원 순직, 또는 살아 있는 대원이 모두 쓰러졌거나 병원으로 후송됐다 (H1 §3.6, 사용자 결정 2026-11-15:
 * 부대는 대원이 모두 숨졌을 때만 운용을 멈춘다 — 다치거나 일부가 숨진 부대는 배정 점수만 깎인다). sceneManager.unitArrived 가 내리는 사람과 같은 술어다(injury.canDeploy)
 */
export function crewReady(sim: Sim, u: Unit): number {
  const fc = fieldCrew(sim, u);
  let n = 0; for (let k = 0; k < fc.length; k++) if (canDeploy(sim.responders[fc[k]])) n++;
  return n;
}

const AIR_SPEED = 66, SEA_SPEED = 30, SEA_OFF = 46;
/** 바닷가의 교차로인가 (구조정이 닿을 수 있다) */
export function coastal(sim: Sim, nodeId: number): boolean { const n = sim.city.nodes[nodeId]; return coastY(n.x) - n.y < 280; }
/** 헬기·구조정이 향하는 지점. 사건 현장이면 그 건물 앞, 헬기가 병원이나 집으로 가면 그 착륙 자리, 아니면 교차로(구조정은 그 앞바다). */
function offroadTarget(sim: Sim, u: Unit, destNode: number): [number, number] {
  const n = sim.city.nodes[destNode];
  let tx = n.x, ty = n.y;
  if (u.state === 'enroute' && u.incidentId !== null) { const I = sim.incidents[u.incidentId]; if (I.truth.nodeId === destNode && I.truth.placeId >= 0) { const pl = sim.city.places[I.truth.placeId]; tx = pl.x + pl.w / 2; ty = pl.y + pl.h / 2; } }
  else if (u.air && u.state === 'transport') { const f = sim.city.facilities.find((q) => q.kind === 'hospital' && q.nodeId === destNode); if (f) [tx, ty] = heliPad(sim, f); }      // 병원으로 가는 헬기는 병원 교차로가 아니라 그 병원의 착륙장에 내린다
  else if (destNode === u.homeNode) { const f = sim.city.facilities.find((q) => q.name === u.homeName); if (f) { if (u.air) [tx, ty] = heliPad(sim, f); else { tx = f.x + 30; ty = f.y - 20; } } }
  if (u.sea) ty = coastY(tx) + SEA_OFF;
  return [tx, ty];
}

/** 현재 상태에서 목적지까지 예상 소요 시간(초). 관제 AI 가 배정 판단에 사용한다. */
export function etaFor(sim: Sim, u: Unit, destNode: number): number {
  const wf = weatherSpeedFactor(sim);
  if (u.air || u.sea) { const n = sim.city.nodes[destNode], d = u.sea ? Math.abs(n.x - u.x) * 1.04 : Math.hypot(n.x - u.x, n.y - u.y); return d / ((u.air ? AIR_SPEED : SEA_SPEED) * wf) + (u.state === 'available' ? 10 : 0); }
  let from = u.nodeId, extra = 0;
  if (u.state === 'available') extra = 6;
  if (u.route && u.seg < u.route.edges.length && (u.state === 'enroute' || u.state === 'returning' || u.state === 'transport')) {
    const e = sim.city.edges[u.route.edges[u.seg]];
    extra += (1 - u.segT) * congFor(u, e, wf);
    from = u.route.nodes[u.seg + 1];
  }
  if (u.curb && !u.parking) extra += ((u.curbT ?? 0) * u.curb.len) / (CURB_SPEED * wf);
  const r = findRoute(sim.city, from, destNode, wf, -1, u.heavy);
  return r ? r.time + extra : 9999;
}

/**
 * (I1-b 0단계) 출동 중에 만난 통제의 기록: 구간·부대, 그 구간을 막은 사건(closedReason 'incident' 인 구간을 blockedEdge 로 가진 열린 사건)과 그 사건의 통제 기록.
 * 기록(ROUTE_BLOCKED 의 ref·causes)에만 쓴다 — 길을 고르는 판단은 이것을 읽지 않는다
 */
/**
 * (N8 §4.9 — 단계 6a) 부대가 그 구간을 지나는 시간: city.edgeTime 을 감싼다(고치지 않는다). 교통 경찰의 오토바이는 가벼운 차라 정체를 덜 탄다 —
 * 혼잡 계수를 1 + (cong − 1) × 0.5 대신 1 + (cong − 1) × 0.5 × 0.4 로. 실제 주행(tickUnits)·되돌기·관제의 도착 예상(etaFor)이 같은 식을 쓴다. 길 고르기(findRoute)는 그대로
 */
export const BIKE_CONG = 0.4;
export function congFor(u: Unit, e: RoadEdge, wf: number): number {
  if (u.kind !== 'trafficPol') return edgeTime(e, wf, u.heavy);
  const wait = e.wait ?? 0, run = edgeTime(e, wf, false) - wait;
  const full = 1 + (e.cong - 1) * 0.5 + e.slow, bike = 1 + (e.cong - 1) * 0.5 * BIKE_CONG + e.slow;
  return run * (bike / full) + wait;
}
function blockRef(sim: Sim, u: Unit, e: RoadEdge): { ref: Problem['ref']; causes: number[] } {
  let J: Incident | null = null;
  if (e.closedReason === 'incident') for (let k = sim.incidents.length - 1; k >= 0; k--) { const q = sim.incidents[k]; if (q.blockedEdge === e.id && q.phase !== 'closed') { J = q; break; } }
  if (J) return { ref: { inc: J.id, unit: u.id, edge: e.id }, causes: J.blockEv !== undefined ? [J.blockEv] : [] };
  // (I1-b C2) 길을 막은 것이 기록과 함께 놓인 장애물(건물 잔해)이면 그 기록을 원인으로 잇는다. 막은 사건 = 그 기록의 원인(종료 기록·폭발 기록)이 가리키는 사건
  const o = obstacleOnEdge(sim, e.id);
  if (!o || o.ev === undefined) return { ref: { inc: undefined, unit: u.id, edge: e.id }, causes: [] };
  let inc: number | undefined;
  const cs = sim.events[o.ev].causes;
  for (let k = 0; k < cs.length; k++) if (sim.events[cs[k]].incidentId >= 0) { inc = sim.events[cs[k]].incidentId; break; }
  return { ref: { inc, unit: u.id, edge: e.id }, causes: [o.ev] };
}

function setRoute(sim: Sim, u: Unit, to: number): void {
  u.destNode = to; u.seg = 0; u.segT = 0; u.backing = false;
  u.route = u.nodeId === to ? null : findRoute(sim.city, u.nodeId, to, weatherSpeedFactor(sim), -1, u.heavy);
}

/**
 * 길을 막은 것(traffic.ts 의 장애물) 앞에서 되돌아 나온다: 들어온 교차로로 되짚어 가서 다른 길로 간다.
 * 아직 알려지지 않은 것이면 이 부대가 무전으로 알린다(그 뒤로는 모든 경로 계산이 그 구간을 피한다).
 */
function turnBack(sim: Sim, u: Unit, e: RoadEdge, o: Obstacle, wf: number): void {
  const city = sim.city, rt = u.route!, A = rt.nodes[u.seg], B = rt.nodes[u.seg + 1];
  if (!o.known) reportObstacle(sim, o, u.callsign);
  const et = Math.max(0.5, congFor(u, e, wf) - (e.wait ?? 0)), back = u.segT * et;
  let remainT = (1 - u.segT) * et; for (let k = u.seg + 1; k < rt.edges.length; k++) remainT += congFor(u, city.edges[rt.edges[k]], wf);
  const alt = findRoute(city, A, u.destNode!, wf, -1, u.heavy);
  if (u.state === 'enroute' && u.incidentId !== null) {
    const br = blockRef(sim, u, e);
    raiseProblem(sim, sim.incidents[u.incidentId], 'ROUTE_BLOCKED', `${u.callsign} 이동 경로(${edgeName(city, e)}) 막힘 — ${o.label}`, {
      role: 'UNIT', actor: u.callsign, text: `${u.callsign}: ${edgeName(city, e)} — ${josa(o.label, '으로/로')} 지나갈 수 없습니다. 되돌아 우회합니다.`, imp: 2, causes: br.causes,
    }, false, br.ref);
  }
  sim.traffic.stats.detours++; sim.traffic.stats.delaySec += Math.max(0, back + (alt ? alt.time : 0) - remainT);
  // 경로가 없으면 들어온 교차로까지만 되돌아가 기다린다 (아래의 "경로가 끊겨 대기"가 다시 시도한다)
  u.route = { nodes: [B, A, ...(alt ? alt.nodes.slice(1) : [])], edges: [e.id, ...(alt ? alt.edges : [])], time: back + (alt ? alt.time : 0) };
  u.seg = 0; u.segT = 1 - u.segT; u.backing = true;
}

/** 목적지 설정. 구간 주행 중이면 다음 교차로까지는 그대로 달린 뒤 새 경로를 잡는다. */
export function sendUnitTo(sim: Sim, u: Unit, destNode: number): void {
  if (u.air || u.sea) { u.pendingDest = null; u.destNode = destNode; u.route = null; u.seg = 0; u.segT = 0; return; }
  if (u.route && u.seg < u.route.edges.length && u.segT > 0) { u.pendingDest = destNode; u.destNode = destNode; return; }
  u.pendingDest = null;
  setRoute(sim, u, destNode);
}

export function dispatchUnit(sim: Sim, u: Unit, I: Incident, eta: number): void {
  const wasMoving = u.state === 'returning' || u.state === 'enroute';
  u.incidentId = I.id; u.dispatchedAt = sim.t; u.estArrive = sim.t + eta; u.runs++;
  u.boardOrder = null;
  if (wasMoving) { u.state = 'enroute'; sendUnitTo(sim, u, I.reportedNode); }
  else {
    // 출동 준비 시간은 부대장(내리는 자리의 첫 사람)의 경험으로 — (I2) 결장(off)한 사람이면 나온 첫 사람. 결장이 없으면 fieldCrew 의 첫 사람 = u.crew[0] (0번 자리는 내리는 자리)
    const lead = fieldCrew(sim, u).find((rid) => sim.responders[rid].status !== 'off') ?? u.crew[0];
    u.state = 'turnout'; u.timer = 5 + (1 - sim.responders[lead].experience) * 3; u.destNode = I.reportedNode;
  }
  if (I.assigned.indexOf(u.id) < 0) I.assigned.push(u.id);
  if (I.everAssigned.indexOf(u.id) < 0) I.everAssigned.push(u.id);
  if (u.air) { sim.airStats.sorties++; sim.airStats.byKind[u.kind] = (sim.airStats.byKind[u.kind] ?? 0) + 1; }      // 헬기 출동 횟수 (보고서)
}

/** 현장을 떠나 복귀한다. */
export function releaseUnit(sim: Sim, u: Unit): void {
  if (u.incidentId !== null) {
    const I = sim.incidents[u.incidentId];
    const k = I.assigned.indexOf(u.id); if (k >= 0) I.assigned.splice(k, 1);
  }
  u.incidentId = null; u.boardOrder = null; u.diverted = false;
  u.hydrant = false;
  if (crewReady(sim, u) === 0) { u.state = 'returning'; sendUnitTo(sim, u, u.homeNode); return; }
  u.state = 'returning';
  sendUnitTo(sim, u, u.homeNode);
}

/** (I1-b C3) 알려진 포화 병원의 예상 도착에 더해 견주는 초 — 훨씬 가까우면 그래도 간다. world/rules/hospital.ts 의 ER.PENALTY 와 같은 값(그 파일이 이 파일을 불러서 여기에 둔다) */
export const ER_PENALTY = 240;
/** (I1-b C3) 이번 이송의 기록 전용 꼬리표 — 부대 객체의 모양을 바꾸지 않으려 따로 둔다 (판단은 읽지 않는다). tripWhy = 먼 병원을 고른 까닭이 된 기록들, tripEv = 출발 기록 */
const tripWhy = new WeakMap<Unit, number[]>(), tripEv = new WeakMap<Unit, number>();
/** 이번 출발의 원인 기록 (포화로 먼 병원을 골랐을 때만 — 그 알림과 HOSPITAL_FULL 기록). 출발 기록의 causes 에 넣는다 */
export function transportWhy(u: Unit): number[] | undefined { return tripWhy.get(u); }
/** 출발 기록을 남긴 자리가 알린다 — 응급실에서 이 부대 뒤에 선 부대의 대기 기록이 원인으로 가리킨다 */
export function noteDeparture(u: Unit, ev: number): void { tripEv.set(u, ev); }

/**
 * 환자를 싣고 병원으로 떠난다. 고른 병원을 돌려준다 — 출발 기록이 그 이름을 쓴다(기록의 병원 = 실제로 가는 병원).
 * 관제 쪽 결정이다: 병원의 상태는 병원이 알린 것만 안다(knownHospital — 세계 상태를 직접 읽지 않는다. tests/causality.test.ts 가 이 함수의 본문을 글자로 본다)
 */
export function startTransport(sim: Sim, u: Unit): Facility {
  // 가장 빨리 닿는 병원으로 간다. (I1-b C3) 포화를 알린 병원은 ER_PENALTY 초만큼 멀리 본다
  let hosp = sim.city.facilities.find((f) => f.kind === 'hospital')!, bt = Infinity, near = hosp, nt = Infinity, ht = Infinity, full = -1;
  for (const f of sim.city.facilities) {
    if (f.kind !== 'hospital') continue;
    const t = etaFor(sim, u, f.nodeId), kh = knownHospital(sim, f.id), pen = kh !== null && kh.divert ? ER_PENALTY : 0;
    if (t < nt) { nt = t; near = f; full = pen > 0 ? kh!.ev : -1; }      // near = 포화가 아니었다면 갔을 병원
    if (t + pen < bt) { bt = t + pen; hosp = f; ht = t; }
  }
  u.state = 'transport';
  sendUnitTo(sim, u, hosp.nodeId);
  if (u.air) sim.airStats.airLifts += u.patients.length;      // 공중 이송 = 헬기가 병원으로 싣고 간 환자 수. 세는 곳은 여기 하나다 (어느 길로 떠나든 이 함수를 지난다)
  tripWhy.delete(u); tripEv.delete(u);
  if (hosp !== near && full >= 0) {
    // 포화 알림 때문에 더 먼 병원을 골랐다: 그 환자의 사건에 남긴다 (원인 = 그 알림). 출발 기록이 이 기록을 원인으로 잇는다
    const why = [full], add = Math.max(0, Math.round(ht - nt));
    const inc = u.patientsIncident ?? (u.aboard && u.aboard.length ? u.aboard[0].inc : -1);
    if (inc >= 0) why.push(raiseProblem(sim, sim.incidents[inc], 'HOSPITAL_FULL', `${near.name} 포화로 ${josa(hosp.name, '으로/로')} 이송 (약 +${add}초)`, {
      role: 'DISPATCH', actor: '배정 AI', imp: 1, causes: [full], text: `${near.name} 응급실 포화 — ${josa(u.callsign, '은/는')} ${josa(hosp.name, '으로/로')} 갑니다 (약 +${add}초).`,
    }, false, { fac: near.id, unit: u.id, lost: add }));
    tripWhy.set(u, why);
  }
  return hosp;
}

/**
 * 헬기가 임무를 접고 돌아간다: 연료가 모자라거나('fuel'), 태풍의 강풍으로 뜰 수 없게 됐다('storm').
 * 거는 때: 출동 중(enroute·turnout)이거나 현장 상공에 머무는 중(onscene 이고 isHovering)일 때, 한 번만 — 부른 뒤에는 returning(또는 transport)이라 다시 걸리지 않는다.
 * 내려앉아 대원이 내려 있는 헬기, 환자를 싣고 병원으로 가는 헬기(transport), 돌아가는 헬기(returning)에는 걸지 않는다:
 * releaseUnit 은 환자를 보지 않으므로 이송 중에 부르면 환자를 실은 채 돌아가 병원 인계가 영영 일어나지 않는다.
 * 그 헬기가 맡았던 수요(u.airNeed — dispatcher.sendUnit 이 적는다)는 관제의 전환 배정과 같은 방식으로 되돌려, 다른 부대가 그 칸을 메우게 한다.
 */
export function airRtb(sim: Sim, u: Unit, reason: 'fuel' | 'storm'): void {
  const I = u.incidentId !== null ? sim.incidents[u.incidentId] : null, key = u.airNeed;
  emit(sim, { inc: I ? I.id : -1, role: 'UNIT', actor: u.callsign, kind: 'unit', imp: 2, text: reason === 'fuel' ? `${u.callsign}: 연료가 부족해 복귀합니다.` : `${u.callsign}: 강풍으로 복귀합니다.` });
  if (reason === 'fuel') sim.airStats.rtb++;
  if (u.patients.length > 0) {
    // 상공에서 환자를 태웠다(호이스트): 병원부터 간다
    if (I) { const k = I.assigned.indexOf(u.id); if (k >= 0) I.assigned.splice(k, 1); }
    u.incidentId = null; u.boardOrder = null;
    startTransport(sim, u);
  } else releaseUnit(sim, u);
  u.airNeed = undefined;
  if (I && I.phase !== 'closed' && key) {
    if (!I.fieldVerified) recomputeUnmet(sim, I); else I.unmet[key] = (I.unmet[key] ?? 0) + 1;
    I.unmetSince = sim.t; I.noUnitLogged = false;
  }
}

const CURB_SPEED = 42;      // 길가로 붙을 때의 속도 (지도 단위/초)
/** (I1-b C3) 붐빔: 응급실 체류가 한도의 절반을 넘는 한 명마다 인계가 이만큼 늦어진다 (world/rules/hospital.ts 의 ER.CROWD_SEC 와 같은 값) */
export const ER_CROWD_SEC = 3;
/** (I1-b C3) 앞에 선 차 없이 체류만으로 늦어질 때, 이만큼(초) 넘게 늦어져야 응급실 대기 기록을 남긴다 */
const ER_CROWD_NOTE = 9;
/** (N8) 통제 부대를 기다린다고 알린 유관 기관 차량과 그 사건 (기록을 한 번만 남기는 표시 — 부대 객체의 모양을 바꾸지 않으려고 따로 둔다) */
const civilHeld = new WeakMap<Unit, Incident>();
function curbPos(sim: Sim, u: Unit): void {
  const n = sim.city.nodes[u.nodeId], k = u.curbT ?? 0;
  u.x = n.x + (u.curb!.x - n.x) * k; u.y = n.y + (u.curb!.y - n.y) * k;
}

function arrive(sim: Sim, u: Unit): void {
  u.route = null; u.seg = 0; u.segT = 0;
  const n = sim.city.nodes[u.nodeId];
  const parked = !!u.curb && (u.curbT ?? 0) >= 1;
  if (!parked && !u.air && !u.sea) { u.x = n.x; u.y = n.y; }
  if (u.state === 'enroute') {
    const I = u.incidentId !== null ? sim.incidents[u.incidentId] : null;
    if (!I || I.phase === 'closed') { releaseUnit(sim, u); return; }
    if (I.pursuit && I.pursuit.state === 'driving') return;      // 추격 중: 알려진 위치에 닿았지만 차는 이미 지나갔다. 다음 위치가 전해질 때까지 그 자리에서 기다린다
    if (u.nodeId !== I.truth.nodeId) {
      // 신고된 위치에 와 보니 현장이 없다 → 관제가 신고자에게 다시 확인해 위치를 바로잡는다
      if (!I.addressFixed) {
        I.addressFixed = true;
        const wrong = I.reportedNode; I.reportedNode = I.truth.nodeId;
        const ev = raiseProblem(sim, I, 'WRONG_ADDRESS', `신고 위치(${nodeName(sim.city, wrong)})에 현장이 없음`, { role: 'UNIT', actor: u.callsign, imp: 3, causes: I.callEvents.slice(0, 2), text: `${u.callsign}: 신고 위치에 도착했지만 현장이 없습니다. 위치 재확인 바랍니다.` }, false);
        emit(sim, { inc: I.id, role: 'CALL_TAKER', actor: '신고 접수 AI', kind: 'call', imp: 2, causes: [ev], text: `신고자에게 다시 확인했습니다. 실제 위치는 ${nodeName(sim.city, I.truth.nodeId)}입니다. 출동 부대에 정정 전달.` });
        for (const uid of I.assigned) { const q = sim.units[uid]; if (q.id !== u.id && q.state === 'enroute') sendUnitTo(sim, q, I.reportedNode); else if (q.state === 'turnout') q.destNode = I.reportedNode; }
      }
      u.state = 'turnout'; u.timer = 7; u.destNode = I.truth.nodeId;
      u.estArrive = sim.t + 7 + etaFor(sim, { ...u, state: 'available' } as Unit, I.truth.nodeId);
      u.dispatchedAt = Math.min(u.dispatchedAt, sim.t);
      return;
    }
    // 교차로에 닿았으면 그 건물 앞 길가까지 마저 간다
    const pl = I.truth.placeId >= 0 ? sim.city.places[I.truth.placeId] : null;
    if (pl && !u.curb && !u.air && !u.sea) {
      const len = Math.hypot(pl.cx - n.x, pl.cy - n.y);
      if (len > 8) { u.curb = { x: pl.cx, y: pl.cy, len }; u.curbT = 0; u.parking = true; return; }
    }
    const took = sim.t - u.dispatchedAt, est = u.estArrive - u.dispatchedAt;
    const held = u.dept === 'civil' && civilHeld.get(u) === I;      // (N8) 길가에서 기다리다 들어가는 유관 기관 차량 — 늦음은 처음 닿았을 때 한 번만 본다
    if (!held && took > est * 1.35 + 6 && !I.pursuit) {
      // (I1-b 0단계) 지나온 구간은 여기서 알 수 없다(경로는 이미 지웠다). 이번 출동에서 이 부대가 남긴 마지막 ROUTE_BLOCKED 가 있으면 그것을 원인으로 잇고 구간·막은 사건을 이어받는다 (없으면 혼잡만으로 늦은 것 — 비워 둔다)
      let rb: Problem | null = null;
      for (let k = I.problems.length - 1; k >= 0; k--) { const p = I.problems[k]; if (p.code === 'ROUTE_BLOCKED' && p.ref !== undefined && p.ref.unit === u.id && p.t >= u.dispatchedAt) { rb = p; break; } }
      raiseProblem(sim, I, 'TRAFFIC_DELAY', `${u.callsign} 도착이 예상보다 ${fmtSec(took - est)} 지연`, {
        role: 'UNIT', actor: u.callsign, text: `${u.callsign}: 교통 상황으로 예상보다 ${fmtSec(took - est)} 늦게 도착.`, imp: 1, causes: rb ? [rb.eventId] : undefined,
      }, true, rb ? { inc: rb.ref!.inc, unit: u.id, edge: rb.ref!.edge } : { unit: u.id });
    }
    // (N8 §5.3.2) 유관 기관(civil)이 혼자 먼저 닿았다: 지휘관이 없으면 작업판이 없어 할 일이 없다. 현장에 들어가지 않고 길가에서 통제 부대(소방·경찰)를 기다린다 —
    // 상태는 enroute 그대로라 tickUnits 가 매 틱 이 함수를 다시 부르고, 지상 대원이 처음 내린 다음 틱(또는 상공 도착이 있으면)에 들어간다. 기록은 한 번만
    if (u.dept === 'civil' && I.firstArrivalAt < 0 && (sim.scenes[I.id]?.airAt ?? -1) < 0) {
      if (!held) { civilHeld.set(u, I); emit(sim, { inc: I.id, role: 'UNIT', actor: u.callsign, kind: 'unit', imp: 1, text: `${u.callsign}: 현장 도착 — 통제 부대를 기다립니다.` }); }
      if (u.curb) u.parking = true;      // 길가에 선 채로 (tickUnits 의 길가 갈래가 다음 틱에 다시 이 함수를 부른다 — 떠나는 갈래로 빠지지 않게)
      return;
    }
    u.state = 'onscene';
    unitArrived(sim, I, u);
  } else if (u.state === 'transport') {
    // 응급실이 붐비면(먼저 온 구급차가 인계 중이면) 인계가 늦어진다
    const ahead = sim.units.filter((q) => q.id !== u.id && q.state === 'hospital' && q.nodeId === u.nodeId), waiting = ahead.length;
    const riders = u.aboard ? u.aboard.length : 0;      // 다친 대원도 인계에 시간이 든다
    // (I1-b C3 결과 1) 응급실에 머무는 환자가 한도의 절반을 넘으면 넘는 한 명마다 ER_CROWD_SEC 초 — 세계 규칙 쪽이라 병원의 진실(체류)을 읽는다
    const hf = sim.city.facilities.find((f) => f.kind === 'hospital' && f.nodeId === u.nodeId), H = hf ? hospitalOf(sim, hf.id) : null;
    const load = H ? erLoad(H, sim.t) : 0, crowd = H ? Math.max(0, Math.ceil(load - H.cap / 2)) : 0;
    u.state = 'hospital'; u.timer = 8 + waiting * 9 + Math.max(0, u.patients.length + riders - 1) * 3 + crowd * ER_CROWD_SEC;
    if (waiting > 0 || crowd * ER_CROWD_SEC >= ER_CROWD_NOTE) {
      // (I1-b C3 결과 5) 원인: 앞에서 인계 중인 부대의 출발 기록(다른 사건의 구급차 → 이 사건의 대기), 체류로 늦어졌으면 그 병원의 마지막 인계 기록.
      // 앞에 선 차가 없을 때는 체류만으로 ER_CROWD_NOTE 초(앞에 한 대가 있는 것과 같은 지연) 넘게 늦어질 때만 알린다 — 몇 초의 지연마다 기록하지 않는다
      const why: number[] = [];
      for (const q of ahead) { const dv = tripEv.get(q); if (dv !== undefined) why.push(dv); }
      if (crowd > 0) why.push(H!.lastEv);
      emit(sim, { inc: u.patientsIncident ?? (riders > 0 ? u.aboard![0].inc : -1), role: 'UNIT', actor: u.callsign, kind: 'unit', imp: 1, causes: why,
        text: waiting > 0 ? `${u.callsign}: 응급실이 붐벼 환자 인계가 늦어집니다 (앞에 ${waiting}대).` : `${u.callsign}: 응급실이 붐벼 환자 인계가 늦어집니다 (응급실에 환자 ${load}명).` });
    }
  } else if (u.state === 'returning') {
    u.water = u.waterMax; u.hydrant = false;
    if (u.air) { u.fuel = u.fuelMax; u.bucket = u.bucketMax; }      // 집에 닿은 헬기는 연료와 물 바구니를 채운다
    // 집에 닿으면 예비 공기통을 다시 싣고 대원의 공기통도 가득 채운다
    if (KIND[u.kind].spareAir > 0) u.spareAir = KIND[u.kind].spareAir;
    for (let ci = 0; ci < u.crew.length; ci++) refillAir(sim, u.crew[ci]);
    // (R3 §2.9) 탄약 상자를 다시 싣고 대원의 총기도 가득 (공기통과 같은 자리)
    if (u.ammoBoxMax !== undefined) u.ammoBox = u.ammoBoxMax;
    if (u.sparePump !== undefined) u.sparePump = sparePumpOf(u.kind, sim.tune.sparePump);      // (R3 F10) 예비 펌프도 다시 싣는다
    for (let ci = 0; ci < u.crew.length; ci++) refillGuns(sim, u.crew[ci]);
    if (u.pumpFailed) { u.pumpFailed = false; u.pumpCond = 0.55; }
    u.state = crewReady(sim, u) === 0 || u.aid ? 'oos' : 'available';
    if (u.aid) emit(sim, { role: 'UNIT', actor: u.callsign, kind: 'unit', text: `${u.callsign}: 지원 임무를 마치고 관할로 복귀했습니다.`, imp: 1 });
    else if (u.state === 'oos') {
      // 걸을 수 있는 대원이 한 명도 없다 (crewReady 0). 까닭은 그 자리의 상태로 가린다: 모두 숨졌다 / 숨지지 않은 대원이 모두 병원으로 갔다 / (드물게) 쓰러진 채 남았다.
      // 다쳐도 걸을 수 있으면 나가므로 '전원 부상'은 더는 까닭이 아니다. 원인은 그 부대의 마지막 부상·순직 기록(u.oosEv)
      // (I2) 결장(off)한 사람은 '숨진 대원'도 '남은 대원'도 아니다 — 이번 교대에 나온 사람만 본다 (문구는 그대로)
      const fc = fieldCrew(sim, u);
      let alive = 0, cared = 0;
      for (let k = 0; k < fc.length; k++) { const r = sim.responders[fc[k]]; if (r.status === 'off') continue; if (!r.dead) { alive++; if (r.care !== undefined) cared++; } }
      const why = alive === 0 ? '대원 전원 순직 — 운용 중단.' : cared === alive ? '남은 대원 모두 병원 이송 — 운용 중단.' : '걸을 수 있는 대원이 없어 운용 중단.';
      emit(sim, { role: 'UNIT', actor: u.callsign, kind: 'unit', text: `${u.callsign} ${why}`, imp: 2, causes: [u.oosEv ?? -1] });
    }
  }
}

export function tickUnits(sim: Sim): void {
  const city = sim.city, dt = sim.dt, wf = weatherSpeedFactor(sim);
  for (let ui = 0; ui < sim.units.length; ui++) { const u = sim.units[ui];      // 색인 순회: 최적화 전 단계에서 반복자 객체를 만들지 않는다 (순서는 같다)
    u.px = u.x; u.py = u.y;
    if (u.state !== 'available' && u.state !== 'oos') u.busyTime += dt;
    if (u.state === 'available' || u.state === 'returning') {
      const rate = u.state === 'available' ? 0.55 : 0.2;
      for (let ci = 0; ci < u.crew.length; ci++) { const r = sim.responders[u.crew[ci]]; if (r.status === 'ok' || (r.status === 'injured' && r.care === undefined)) r.stamina = Math.min(100, r.stamina + rate * dt); }      // 걸을 수 있는 다친 대원도 쉰다 (H1 §3.6 — 부대에 남아 다음 현장에 내린다)
    }
    if (u.state === 'transport' && u.patientsIncident !== null) {
      // 이송 중 처치: 탑승 후 몇 초 뒤 구급대원이 차 안에서 응급 처치를 마친다
      const sc = sim.scenes[u.patientsIncident];
      // 차 안의 처치 수준은 함께 탄 대원(내리는 자리) 가운데 가장 좋은 의료 장비를 든 사람의 것이다
      let med = 0; if (sc && u.patients.length) { const fc = fieldCrew(sim, u); for (let k = 0; k < fc.length; k++) { const q = sim.responders[fc[k]]; if (!q.dead && q.status !== 'off') med = Math.max(med, medLevelOf(sim, fc[k])); } }      // 순직한 대원은 처치하지 못한다 (H1). (I2) 결장한 대원은 차에 타지 않았다
      if (sc) for (const cid of u.patients) {
        const c = sc.casualties[cid];
        const q = Math.min(1, med * 0.95);
        if (!c.dead && sim.t - c.tLoaded > 6 && q > c.treatQ + 0.05) { c.treated = true; if (c.tTreated < 0) c.tTreated = sim.t; c.treatQ = q; c.bleed = c.bleed0 * (1 - 0.9 * q); }
      }
    }
    if (u.air) {
      // 태풍의 충격 단계에는 헬기가 뜨지 못한다. 단계가 지나면 다시 뜬다 (안개·밤은 교대 내내 — createRoster)
      const storm = sim.disaster !== null && sim.disaster.kind === 'typhoon' && sim.disaster.phase === 'impact';
      if (storm && !u.grounded) {
        u.grounded = 'storm'; if (sim.airStats.grounded === null) sim.airStats.grounded = 'storm';
        // 출동 중이거나 상공에 있던 헬기는 돌아간다 (환자를 싣고 병원으로 가는 중이면 병원까지 간다. 내려앉아 대원이 내려 있으면 그대로 일한다)
        if (u.state === 'enroute' || u.state === 'turnout' || (u.state === 'onscene' && u.incidentId !== null && isHovering(u, sim.scenes[u.incidentId]!))) airRtb(sim, u, 'storm');
      } else if (!storm && u.grounded === 'storm') u.grounded = null;
      // 이동 중의 연료 (상공에 머무는 동안의 연료는 field/rules/air.ts 가 줄인다 — 단계 5. 내려앉아 있는 동안은 줄지 않는다)
      if (u.state === 'enroute' || u.state === 'transport' || u.state === 'returning') {
        u.fuel = Math.max(0, (u.fuel ?? 0) - dt);
        if (u.state === 'enroute' && u.fuel < etaFor(sim, u, u.homeNode) + 40) airRtb(sim, u, 'fuel');      // 집까지 갈 만큼만 남았다 (병원으로 가는 길과 돌아가는 길에는 걸지 않는다)
      }
    }
    if (u.state === 'available' || u.state === 'oos' || u.state === 'onscene') continue;
    if (u.state === 'turnout') {
      u.timer -= dt;
      if (u.timer <= 0) {
        u.state = 'enroute';
        // 헬기·구조정은 길로 다니지 않는다: 도로 경로를 잡지 않는다 (잡아도 움직임에는 쓰이지 않고 지도에 도로 점선만 잘못 그려졌다)
        if (u.air || u.sea) sendUnitTo(sim, u, u.destNode!); else setRoute(sim, u, u.destNode!);
        if (!u.route && u.nodeId === u.destNode) arrive(sim, u);
      }
      continue;
    }
    if (u.state === 'hospital') {
      u.timer -= dt;
      if (u.timer <= 0) {
        const I = u.patientsIncident !== null ? sim.incidents[u.patientsIncident] : null;
        const scene = I ? sim.scenes[I.id] : null;
        const parts: string[] = [];
        let alive = 0;      // (I1-b) 산 채로 인계한 구조 대상 — 'delivered' 신호의 data
        if (scene) {
          for (const cid of u.patients) {
            const c = scene.casualties[cid];
            if (!c.dead) { c.where = 'hospital'; c.tHospital = sim.t; }
          }
          alive = u.patients.filter((cid) => !scene.casualties[cid].dead).length;
          parts.push(`환자 ${alive}명`);
        }
        // 구조 대상이 아닌 환자(다친 대원·용의자)의 인계 — 그 사람들만 태운 차량은 patientsIncident 가 없으므로 위의 갈래 밖에서 한다 (H1 §3.4-4)
        const ab = u.aboard;
        let mates = 0, sus = 0, abInc = -1;
        if (ab && ab.length) {
          abInc = ab[0].inc;
          for (let k = 0; k < ab.length; k++) {
            if (ab[k].kind === 'mate') { const r = sim.responders[ab[k].id]; r.care = 'hospital'; r.bleed = 0; mates++; }
            else { const hs = sim.scenes[ab[k].inc]; const h = hs ? hs.hostiles[ab[k].id] : undefined; if (h && !h.dead) { h.where = 'hospital'; h.bleed = 0; } sus++; }      // 용의자: 병원 인계 뒤의 경찰 인계는 모델 밖이다 (H1 §4.3)
          }
          ab.length = 0;
        }
        if (mates > 0) parts.push(`부상 대원 ${mates}명`);
        if (sus > 0) parts.push(`용의자 ${sus}명`);
        if (parts.length) {
          const hosp = sim.city.facilities.find((f) => f.kind === 'hospital' && f.nodeId === u.nodeId);
          const hev = emit(sim, { inc: I ? I.id : abInc, role: 'UNIT', actor: u.callsign, kind: 'casualty', text: `${u.callsign}: ${hosp?.name ?? '병원'} 도착, ${parts.join('·')} 인계 완료.`, imp: 1 });
          // (I1-b §3.4) 병원 인계: 그 인계 기록과 함께 — place 병원 시설, data 산 환자 수(구조 대상만), size 함께 인계한 다친 대원·용의자 수(병상은 쓴다). 자리는 병원. 지상 구급차·헬기 이송이 같은 길이다
          signal(sim, 'delivered', { inc: I ? I.id : abInc, ev: hev, x: hosp?.x, y: hosp?.y, place: hosp ? hosp.id : -1, data: alive, size: mates + sus });
        }
        u.patients = []; u.patientsIncident = null; u.firstLoadAt = undefined;
        releaseUnit(sim, u);
      }
      continue;
    }
    if (u.air || u.sea) {
      // 헬기는 곧장 날고, 구조정은 해안을 따라 간다
      const dest = u.destNode ?? u.homeNode, [tx, ty] = offroadTarget(sim, u, dest);
      if (u.air) {
        const d = Math.hypot(tx - u.x, ty - u.y), step = AIR_SPEED * wf * dt;
        if (d <= step) { u.x = tx; u.y = ty; u.nodeId = dest; arrive(sim, u); } else { u.x += ((tx - u.x) / d) * step; u.y += ((ty - u.y) / d) * step; }
      } else {
        const d = Math.abs(tx - u.x), step = SEA_SPEED * wf * dt;
        if (d <= step) { u.x = tx; u.y = ty; u.nodeId = dest; arrive(sim, u); } else { u.x += Math.sign(tx - u.x) * step; u.y = coastY(u.x) + SEA_OFF; }
      }
      continue;
    }
    if (u.curb) {
      const step = (dt * CURB_SPEED * wf) / u.curb.len;
      if (u.parking && u.state === 'enroute' && u.destNode === u.nodeId) {
        // 건물 앞 길가로 붙는다
        u.curbT = Math.min(1, (u.curbT ?? 0) + step); curbPos(sim, u);
        if (u.curbT >= 1) { u.parking = false; arrive(sim, u); }
        continue;
      }
      // 떠날 때는 길가에서 교차로로 돌아 나온 뒤 경로를 따른다
      u.parking = false;
      u.curbT = Math.max(0, (u.curbT ?? 0) - step); curbPos(sim, u);
      if (u.curbT <= 0) u.curb = null;
      continue;
    }
    // 이동 (enroute / transport / returning)
    if (!u.route) {
      if (u.destNode === null || u.nodeId === u.destNode) { arrive(sim, u); continue; }
      setRoute(sim, u, u.destNode);       // 경로가 끊겨 대기 중이었다면 재시도
      if (!u.route) continue;
    }
    // 경로는 떠날 때 잡지만 길가에서 교차로로 나오는 데 몇 초가 걸린다. 그 사이에 첫 구간이 통제됐다고 알려졌으면(재난·사건·공사) 들어서기 전에 다시 잡는다
    if (u.segT === 0 && !u.backing && u.seg < u.route.edges.length) {
      const first = city.edges[u.route.edges[u.seg]];
      if ((first.closed && first.known !== false) || (u.heavy && first.noHeavy)) {
        const alt = findRoute(city, u.nodeId, u.destNode!, wf, -1, u.heavy);
        if (alt && u.state === 'enroute' && u.incidentId !== null) {
          const br = blockRef(sim, u, first);
          raiseProblem(sim, sim.incidents[u.incidentId], 'ROUTE_BLOCKED', `${u.callsign} 이동 경로(${edgeName(city, first)}) 통제`, {
            role: 'UNIT', actor: u.callsign, text: `${u.callsign}: ${edgeName(city, first)} 통제 확인. 우회 경로로 변경합니다.`, imp: 2, causes: br.causes,
          }, false, br.ref);
        }
        u.route = alt; u.seg = 0; u.segT = 0;
        if (!u.route) continue;      // 길이 끊겼다: 여기서 기다린다 (위의 재시도가 다시 본다)
      }
    }
    let budget = dt;
    let guard = 0;
    while (budget > 0 && u.route && guard++ < 8) {
      const e = city.edges[u.route.edges[u.seg]];
      const et = Math.max(0.5, congFor(u, e, wf) - (e.wait ?? 0));      // 달리는 시간만 (차단기 앞에서 기다리는 시간은 아래에서 실제로 선다)
      // 교통: 내려온 건널목 차단기 앞에서는 기다리고, 길을 막은 것에 닿으면 되돌아 나온다
      const stop = stopAhead(sim, u, e, u.route.nodes[u.seg]);
      if (stop && u.segT + budget / et >= stop.at) {
        budget -= Math.max(0, stop.at - u.segT) * et; u.segT = Math.max(u.segT, stop.at);
        if (stop.o) { turnBack(sim, u, e, stop.o, wf); continue; }
        gateWait(sim, u, e); break;
      }
      const remain = (1 - u.segT) * et;
      if (budget < remain) { u.segT += budget / et; budget = 0; break; }
      budget -= remain;
      u.nodeId = u.route.nodes[u.seg + 1];
      u.seg++; u.segT = 0; u.backing = false;
      if (u.pendingDest !== null) { const d = u.pendingDest; u.pendingDest = null; setRoute(sim, u, d); if (!u.route) { if (u.nodeId === d) arrive(sim, u); break; } continue; }
      if (u.seg >= u.route.edges.length) { if (u.nodeId !== u.destNode) { u.route = null; break; } arrive(sim, u); break; }      // 되돌아 나왔지만 다른 길이 없다: 여기서 기다린다
      // 교차로 통과 시 경로 재검토: 다음 구간이 통제됐다고 알려졌거나 훨씬 빠른 길이 생겼는가 (모르는 통제는 가 보아야 안다)
      const next = city.edges[u.route.edges[u.seg]];
      let remainT = 0; for (let k = u.seg; k < u.route.edges.length; k++) { const q = city.edges[u.route.edges[k]]; remainT += congFor(u, q, wf) - Math.min(q.wait ?? 0, remainT); }      // findRoute 와 같은 셈법
      const alt = findRoute(city, u.nodeId, u.destNode!, wf, -1, u.heavy);
      if ((next.closed && next.known !== false) || (u.heavy && next.noHeavy)) {
        if (alt) {
          const add = Math.max(0, alt.time - remainT);
          if (u.state === 'enroute' && u.incidentId !== null) {
            const br = blockRef(sim, u, next);
            raiseProblem(sim, sim.incidents[u.incidentId], 'ROUTE_BLOCKED', `${u.callsign} 이동 경로(${edgeName(city, next)}) 통제`, {
              role: 'UNIT', actor: u.callsign, text: `${u.callsign}: ${edgeName(city, next)} 통제 확인. 우회 경로로 변경합니다 (약 ${fmtSec(add)} 추가).`, imp: 2, causes: br.causes,
            }, false, br.ref);
          }
          u.route = alt; u.seg = 0; u.segT = 0;
        } else { u.route = null; break; }
      } else if (alt && alt.time < remainT * 0.8) {
        u.route = alt; u.seg = 0; u.segT = 0;
      }
    }
    if (u.route && u.seg < u.route.edges.length) {
      const A = city.nodes[u.route.nodes[u.seg]], B = city.nodes[u.route.nodes[u.seg + 1]];
      u.x = A.x + (B.x - A.x) * u.segT; u.y = A.y + (B.y - A.y) * u.segT;
    } else if ((u.state as string) !== 'onscene') {
      const n = city.nodes[u.nodeId]; u.x = n.x; u.y = n.y;
    }
  }
}
