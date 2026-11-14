// 시뮬레이션 전체에서 공유하는 타입 정의.
// 이 파일과 src/sim 아래의 어떤 코드도 DOM / React / Canvas 에 의존하지 않는다.

import type { Rng } from './rng';
import type { BeliefStore } from './field/beliefs';

export interface Pt { x: number; y: number }
export type Dept = 'fire' | 'ems' | 'police';
export type IncidentType = 'fire' | 'traffic' | 'search' | 'armed' | 'medical' | 'collapse' | 'hazmat';
export type District = 'residential' | 'commercial' | 'industrial' | 'outskirts';
export type Weather = 'clear' | 'rain' | 'fog' | 'night';

// ───────────────────────── 도시 ─────────────────────────
export interface RoadNode { id: number; x: number; y: number; c: number; r: number; district: District; edges: number[] }
export interface RoadEdge {
  id: number; a: number; b: number; len: number; speed: number; arterial: boolean;
  cong: number;        // 현재 혼잡 계수 (1 = 원활, 3 = 극심)
  baseCong: number;
  closed: boolean; closedReason: string | null;
  slow: number;        // 사건(사고 현장 등)으로 인한 추가 지연 계수
}
export interface Building { x: number; y: number; w: number; h: number; district: District; tone: number }
export interface Facility { id: number; kind: 'fireStation' | 'police' | 'hospital' | 'public'; name: string; nodeId: number; x: number; y: number }
export interface Park { x: number; y: number; r: number }
export interface City {
  w: number; h: number;
  nodes: RoadNode[]; edges: RoadEdge[]; buildings: Building[]; facilities: Facility[]; parks: Park[];
  districts: { district: District; name: string; x: number; y: number; w: number; h: number }[];
}
export interface Route { nodes: number[]; edges: number[]; time: number }

// ───────────────────────── 대원 / 부대 ─────────────────────────
export interface Skills { fire: number; rescue: number; medical: number; law: number }
export interface Responder {
  id: number; name: string; dept: Dept; unitId: number; senior: boolean;
  // 기본 능력 (0..1)
  skill: number; judgment: number; composure: number; fitness: number; teamwork: number; experience: number;
  skills: Skills;
  trait: string;
  // 교대 내내 유지되는 상태
  health: number; stamina: number; status: 'ok' | 'injured' | 'down';
  xpGained: number; incidentsWorked: number;
}

export type UnitKind = 'engine' | 'rescue' | 'als' | 'bls' | 'patrol' | 'tactical';
export type UnitState = 'available' | 'turnout' | 'enroute' | 'onscene' | 'transport' | 'hospital' | 'returning' | 'oos';
export interface UnitCaps { suppression: number; rescue: number; ems: number; law: number; tactical: number; search: number; traffic: number }
export interface Unit {
  id: number; callsign: string; dept: Dept; kind: UnitKind; crew: number[];
  homeNode: number; homeName: string;
  state: UnitState;
  x: number; y: number; px: number; py: number;
  nodeId: number;                     // 마지막으로 통과한(혹은 현재 있는) 노드
  route: Route | null; seg: number; segT: number;
  pendingDest: number | null;         // 구간 주행 중 목적지가 바뀐 경우 다음 노드에서 재탐색
  destNode: number | null;
  incidentId: number | null;
  timer: number;                      // turnout / 병원 인계 대기
  caps: UnitCaps;
  // 장비 상태
  water: number; waterMax: number; hydrant: boolean;
  pumpCond: number; pumpFailed: boolean;
  tool: number;                       // 구조 장비 성능 (0..1)
  medLevel: number; armor: number; flashbangs: number;
  patients: number[];                 // 이송 중인 구조 대상 (casualty id)
  patientsIncident: number | null;
  // 통계
  dispatchedAt: number; estArrive: number; diverted: boolean;
  busyTime: number; runs: number;
  boardOrder: 'release' | 'transport' | null;
  aid?: boolean;                      // 인근 도시에서 지원 온 부대 (임무를 마치면 관할로 돌아간다)
}

// ───────────────────────── 정보(Belief) ─────────────────────────
export type FactType = 'cas' | 'fire' | 'srch' | 'blk' | 'hos' | 'haz' | 'occ' | 'ctl' | 'clue' | 'seen' | 'type' | 'secure' | 'mate' | 'evid';
export interface Fact {
  key: string; type: FactType; id: number;
  value: any;
  src: string;        // 정보 출처 (신고자 / 관제 / 대원 이름)
  t: number;          // 확인 시각
  conf: number;       // 신뢰도 0..1
  verified: boolean;  // 직접 관찰로 확인되었는가
  text: string;       // 사람이 읽을 수 있는 내용
}
export interface CasBelief { x: number; y: number; mob: Mobility; band: number; where: CasWhere; treated: boolean; trappedDone: boolean; tq: number }   // tq: 0 미처치, 1 기본 처치, 2 전문 처치

// ───────────────────────── 현장 ─────────────────────────
export const T = { VOID: 0, GROUND: 1, ROAD: 2, FLOOR: 3, WALL: 4, WINDOW: 5, TREE: 6, WATER: 7, ROCK: 8, DOOR: 9, TRAIL: 10, FURN: 11, STAIR: 12 } as const;
/** 가구 종류 (Scene.decor). 가구는 지나갈 수 없지만 시야는 가리지 않고, 엄폐물이 되며, 불에 탄다. */
export const DECOR = { NONE: 0, BED: 1, DESK: 2, TABLE: 3, SOFA: 4, CABINET: 5, CRATE: 6, MACHINE: 7, COUNTER: 8, PLANT: 9, KITCHEN: 10, SHELF: 11 } as const;

export interface Region {
  id: number; name: string; kind: 'room' | 'corridor' | 'zone' | 'wreck' | 'verge';
  tiles: number[]; cx: number; cy: number;
  x0: number; y0: number; x1: number; y1: number;
  indoor: boolean; searchable: boolean;
}
export type PropKind = 'debris' | 'door' | 'vehicle' | 'hydrant' | 'gas' | 'cover' | 'clue' | 'witness' | 'roadDebris'
  | 'unstable'      // 금이 간 구조물: 보강(mitigate)하지 않으면 leak 가 1 에 이를 때마다 2차 붕괴가 난다
  | 'valve';        // 가스가 새는 배관: 차단(mitigate)할 때까지 leakRate 세기로 가스를 내뿜는다
export interface Prop {
  id: number; kind: PropKind; x: number; y: number; w: number; h: number;
  blocking: boolean;
  locked?: boolean; open?: boolean;          // door
  hp: number;                                // 제거/개방에 필요한 작업량 (남은 양)
  leak?: number; leakRate?: number; mitigated?: boolean; ignited?: boolean;   // vehicle
  occupants?: number[]; emptySeat?: boolean; cleared?: boolean; angle?: number; color?: number;
  exploded?: boolean;                        // gas
  found?: boolean; dirRegion?: number;       // clue
  interviewed?: boolean; lastSeenRegion?: number; accurate?: boolean;  // witness
  removed?: boolean;
}
export type Mobility = 'mobile' | 'immobile' | 'trapped';
export type CasWhere = 'scene' | 'carried' | 'safe' | 'loaded' | 'hospital';
export interface Casualty {
  id: number; label: string;
  x: number; y: number; px: number; py: number;
  health: number; bleed: number; mob: Mobility; trapWork: number;
  concealment: number; inVehicle: number | null;
  where: CasWhere; treated: boolean; treatProg: number; dead: boolean;
  treatQ: number;           // 받은 처치의 수준 (0 없음 … 1 전문 처치)
  bleed0: number;           // 처치 전 악화 속도
  bystander: boolean;       // 신고자가 안내에 따라 돌보고 있다 (도착 전 악화 완화)
  walking: boolean; path: number[] | null; pathI: number; panic: boolean;
  wander: boolean; wanderT: number;
  isTarget: boolean;        // 수색 대상
  hostage: boolean;
  climb?: number;           // 계단을 오르내리는 데 쓴 시간 (스스로 대피 중)
  // 진실 기반 타임라인 (보고서용)
  tDiscovered: number; tFreed: number; tTreated: number; tSafe: number; tLoaded: number; tDead: number; tHospital: number;
  discoveredBy: number;
  causeEvent: number;       // 상태 악화의 주된 원인 이벤트
}
export interface Hostile {
  id: number; label: string;
  x: number; y: number; px: number; py: number;
  health: number; morale: number; aggression: number; skill: number;
  weapon: 'gun' | 'knife' | 'none';
  state: 'hold' | 'fight' | 'flee' | 'surrendered' | 'arrested' | 'down' | 'escaped';
  hidden: boolean; cooldown: number; fleeAt: number;
  facing: number;           // 바라보는 방향(라디안). 시야각 밖은 보지 못한다
  lookAt: number;           // 다음에 시선을 돌릴 시각
  stunUntil: number;        // 섬광탄 등으로 무력화된 시각까지
  hostageId: number;        // 붙잡고 있는 인질 (casualty id, -1 없음)
  deadline: number;         // 인질 사건의 시한
  alertUntil: number;       // 경계 상태(전방위 인지) 유지 시각
  path: number[] | null; pathI: number; negot: number; seenOfficers: number;
  targetRid: number;
}
export interface PassingCar { x: number; px: number; row: number; dir: number; speed: number; distracted: boolean; stopped: boolean; hit: boolean }
export interface Fx { kind: 'shot' | 'spray' | 'radio' | 'text' | 'boom' | 'hit' | 'flash'; t: number; x: number; y: number; x2?: number; y2?: number; text?: string; color?: string; ttl: number }

export type WorkKind =
  | 'sizeup' | 'search' | 'suppress' | 'hookup' | 'clear' | 'force' | 'extricate' | 'treat' | 'carry' | 'load'
  | 'traffic' | 'mitigate' | 'perimeter' | 'negotiate' | 'engage' | 'arrest' | 'interview' | 'clearRoad' | 'rescueMate' | 'escort';
export type TaskKind = WorkKind | 'retreat' | 'rehab' | 'resupply' | 'board' | 'standby' | 'moveSignal';

export interface WorkItem {
  id: number; kind: WorkKind;
  region: number; cas: number; prop: number; hostile: number; tile: number; mate: number;
  priority: number;              // 0..1
  status: 'open' | 'active' | 'done' | 'failed' | 'cancelled';
  assignees: number[]; max: number;
  createdAt: number; doneAt: number;
  note: string; fails: number; holdUntil: number;
  thorough: boolean;
  orderSentAt: Record<number, number>;   // rid → 지시 송신 시각 (수신 확인용)
  cause: number;                 // 이 작업을 만든 이벤트
}

export interface Task {
  kind: TaskKind; workId: number;
  region: number; cas: number; prop: number; hostile: number; tile: number; mate: number;
  phase: number; progress: number; need: number;
  tx: number; ty: number; range: number;
  pts: number[] | null; ptI: number; covered: Set<number> | null;
  startedAt: number; selfAssigned: boolean; thorough: boolean;
  wait: number; sub: Task | null; fails: number; label: string;
  repathAt: number;
}

export interface Candidate { label: string; score: number; chosen: boolean }

export interface FieldAgent {
  rid: number; unitId: number; isCommander: boolean;
  x: number; y: number; px: number; py: number; fx: number; fy: number;
  path: number[] | null; pathI: number; pathGoal: number;
  task: Task | null; orderWork: number;      // 지휘관이 지시한 WorkItem id (-1 없음)
  beliefs: BeliefStore;
  outbox: Fact[]; outboxSince: number; shadowSince: number; commFailLogged: boolean;
  nextThink: number; nextPerceive: number;
  carrying: number;                          // casualty id 또는 -1 (대원 구조 시 -(rid+2))
  inCover: boolean; cooldown: number;
  status: 'active' | 'withdrawn' | 'down' | 'boarding' | 'left';
  candidates: Candidate[];
  label: string; ring: number;               // 화면 표시용 (현재 행동, 진행도)
  arrivedAt: number; lastBlockEvent: number; idleSince: number;
  stuckT: number; lastX: number; lastY: number;
  rng: Rng;
  planT: number;                              // (지휘관) 다음 계획 수립 시각
  equipIssue: 'none' | 'pump' | 'water';
  smokeT: number;
  pendingBlock: number;                       // 방금 발견한 장애물 타일 (우회/제거 결정 대기)
  underFireT: number;                         // 마지막으로 피격 위협을 받은 시각
  climb: number;                              // 계단을 오르내리는 데 쓴 시간
  spot: number;                               // 점유 중인 엄폐 위치 인덱스
  quiet: Set<string>;                         // 이미 별도 이벤트로 알린 정보(무전 문구에서 생략)
  lastRetreatLog: number;
}

export interface RadioMsg {
  id: number; t: number; deliverAt: number; from: number;   // from rid (-1 = 관제)
  to: number;                                               // rid, -1 = 현장 전체, -2 = 관제
  kind: 'report' | 'order' | 'request' | 'sitrep' | 'brief';
  facts: Fact[]; workId: number; text: string; eventId: number;
}

export interface ResourceRequest { t: number; need: keyof UnitCaps; count: number; reason: string; eventId: number; fulfilled: number; urgent: boolean }

export interface Scene {
  id: number; incidentId: number; kind: IncidentType; variant: string;
  w: number; h: number;
  tiles: Uint8Array; region: Int16Array;
  fire: Float32Array; heat: Float32Array; fuel: Float32Array; smoke: Float32Array; burned: Uint8Array; wet: Float32Array;
  shadow: Uint8Array;                 // 무전 음영 구역
  decor: Uint8Array;                  // 가구 종류 (DECOR)
  damage: Uint8Array;                 // 무너져 내린 자리 (붕괴 사건: 잔해가 깔린 바닥)
  stairTo: Int16Array;                // 계단 칸 → 이어진 다른 층의 계단 칸 (-1 = 계단 아님). 층은 같은 격자 안에 나란히 놓인다
  entryExit: number;                  // 지휘관이 고른 진입 출입구 (s.exits 의 번호, -1 = 아직 정하지 않음)
  floorMat: number;                   // 실내 바닥 재질 (0 나무, 1 타일, 2 콘크리트)
  propAt: Int16Array;                 // 타일 → blocking prop id (-1)
  regions: Region[]; props: Prop[]; casualties: Casualty[]; hostiles: Hostile[];
  agents: FieldAgent[];
  staging: Pt; safe: Pt; vantage: Pt;
  exits: Pt[];                        // 건물 출입구 (무장 사건: 봉쇄 지점)
  spots: { x: number; y: number; exit: number; taken: number }[];   // 엄폐 위치 (exit = 감시하는 출입구, -1 = 정면 협상 위치)
  controlPts: Pt[]; controlDone: boolean[]; laneRows: number[]; cars: PassingCar[]; nextCarAt: number; trafficFlow: number;
  indoorVision: number; outdoorVision: number; exposure: number;
  startedAt: number; arrivedAt: number;
  commanderRid: number; leadDept: Dept;
  board: WorkItem[]; nextWorkId: number;
  radio: RadioMsg[]; nextMsgId: number;
  requests: ResourceRequest[];
  zoneProb: number[];                 // 수색 구역별 존재 확률 (지휘관 판단)
  fx: Fx[];
  rng: Rng;
  totalFuelTiles: number; burnedTiles: number; burning: number;
  secureAt: number; fireOutAt: number; lastSitrep: number; sizeupDone: boolean; closing: boolean;
  entryOrdered: boolean; negotStart: number; researchRound: number; lastSpreadEvent: number;
  collapseDone: Set<number>;
  mismatchLogged: boolean; closedCheckAt: number;
  staticVersion: number;              // 렌더 캐시 무효화용
  breachAt: number;                   // 진입조가 문 앞에 모여 동시에 들어가기로 한 시각 (-1 없음)
  breachDone: boolean;
  bangAt: number;                     // 마지막 섬광탄 사용 시각
  archived: boolean;                  // 사건 종료 후 모든 부대가 떠남 → 더 이상 갱신하지 않음
  idleSince: number;
}

// ───────────────────────── 신고 / 관제 ─────────────────────────
export type Persona = 'calm' | 'panicked' | 'confused' | 'partial' | 'wrong' | 'prank';
export type Topic = 'location' | 'nature' | 'injured' | 'count' | 'trapped' | 'hazard' | 'weapon' | 'detail';
export interface Claim { topic: Topic; value: any; conf: number; text: string; truthful: boolean; callId: number; note: string }
export interface Caller {
  name: string; persona: Persona;
  knows: Partial<Record<Topic, Claim>>;      // 신고자가 (정확하든 아니든) 믿고 있는 내용
  patience: number;                           // 응답 가능한 질문 수
  answerTime: number;
}
export interface CallLine { t: number; who: 'CALLER' | 'CALL_TAKER'; text: string }
export interface Call {
  id: number; incidentId: number; caller: Caller;
  state: 'ringing' | 'active' | 'done';
  ringAt: number; answeredAt: number; endedAt: number;
  transcript: CallLine[];
  asked: Topic[]; pending: Topic | null; nextAt: number; phase: 'ask' | 'wait'; retries: number;
  linkedTo: number;   // 기존 사건에 병합된 추가 신고면 그 사건 id
  kind: 'incident' | 'nuisance';      // nuisance = 사건과 무관한 비긴급 전화 (incidentId = -1)
  instructed: boolean;                // 도착 전 안내를 했는가
  script: string[]; scriptI: number;  // 비긴급 전화의 대사
  rng: Rng; isFollowup: boolean; eventId: number;
}
export interface Needs { suppression: number; rescue: number; ems: number; law: number; tactical: number; search: number; traffic: number }
export interface Assessment {
  type: IncidentType; typeConf: number; probs: Record<IncidentType, number>;
  severity: number;          // 1..3
  confidence: number;
  needs: Needs; risks: string[]; summary: string; t: number; revision: number;
}

export type ProblemCode =
  | 'CALL_QUEUE' | 'CALL_MISINFO' | 'CALL_VAGUE' | 'MISJUDGE_TYPE' | 'UNDERESTIMATE' | 'OVERESTIMATE'
  | 'NO_UNIT' | 'UNDER_DISPATCH' | 'DIVERTED' | 'ROUTE_BLOCKED' | 'TRAFFIC_DELAY'
  | 'PATH_BLOCKED' | 'VICTIM_MISSED' | 'EQUIP_FAIL' | 'WATER_OUT' | 'RESPONDER_HURT' | 'COMM_FAIL'
  | 'ESCALATION' | 'BACKUP_LATE' | 'SCENE_MISMATCH' | 'SUSPECT_FLED' | 'SECONDARY_COLLISION' | 'LATE_DISCOVERY'
  | 'TIMEOUT' | 'FATIGUE' | 'HIDDEN_HAZARD' | 'RECOUNT' | 'WRONG_ADDRESS' | 'FALSE_ALARM';
export interface Problem { code: ProblemCode; t: number; eventId: number; detail: string; recovered: boolean; recoveryText: string }

export type IncidentPhase = 'unreported' | 'call' | 'pending' | 'dispatched' | 'onscene' | 'closed';
export type Outcome = 'success' | 'partial' | 'delayed' | 'unresolved' | 'failed';
export interface IncidentResult {
  outcome: Outcome; delayed: boolean; grade: 'success' | 'partial' | 'unresolved' | 'failed';
  casTotal: number; casSaved: number; casLost: number; casUndiscovered: number; casCritical: number;
  propertyLoss: number;            // 0..1
  respondersHurt: number;
  suspectsTotal: number; suspectsCaught: number; suspectsEscaped: number;
  responseTime: number;            // 신고 접수 → 첫 도착
  dispatchTime: number;            // 신고 접수 → 첫 출동 지령
  duration: number;                // 발생 → 종료
  analysis: string[];              // 원인·경과 설명 문장
  headline: string;
}
export interface Incident {
  id: number; code: string;
  // ── 진실 (엔진만 사용. AI 는 접근 금지) ──
  truth: { type: IncidentType; variant: string; severity: number; nodeId: number; x: number; y: number; district: District; label: string };
  createdAt: number;
  // ── 관제가 아는 내용 ──
  phase: IncidentPhase;
  reportedAt: number;              // 첫 신고 수신(벨 울림) 시각
  answeredAt: number;
  claims: Claim[];                 // 신고자 진술 누적
  locationKnown: boolean;
  assessment: Assessment | null;
  assigned: number[];              // 현재 배정 부대
  everAssigned: number[];
  unmet: Partial<Needs>;           // 채워지지 않은 수요
  unmetSince: number; noUnitLogged: boolean;
  firstDispatchAt: number; firstArrivalAt: number; closedAt: number;
  fieldVerified: boolean;          // 현장 보고로 평가가 갱신되었는가
  fieldType: IncidentType | null;
  priority: number;
  problems: Problem[];
  result: IncidentResult | null;
  lastEvent: number;               // 인과 연결용 최근 이벤트
  rootEvent: number;
  callEvents: number[];
  callsCount: number;
  closeReason: string;
  interest: number;                // 카메라 연출용 흥미도 누적 (표현 계층에서만 읽음)
  blockedEdge: number;
  followupAt: number;
  reportedNode: number;            // 관제가 알고 있는 위치 (신고자가 틀리게 말하면 실제와 다르다)
  addressFixed: boolean;           // 위치 오류가 바로잡혔는가
  firstCallAt: number;             // (엔진) 첫 신고 전화가 걸려 올 시각
  firstAssess: { type: IncidentType; severity: number; t: number; eventId: number } | null;
  fieldNeedsSeen: number;          // 처리한 현장 지원 요청 수
  dispatchLog: number[];           // 출동 지령 이벤트
  aidUnit?: number;                   // 이 사건에 요청한 인근 도시 지원 부대 (사건당 한 번)
}

// ───────────────────────── 이벤트 로그 ─────────────────────────
export type Role = 'SYSTEM' | 'CALLER' | 'CALL_TAKER' | 'ANALYST' | 'DISPATCH' | 'COMMANDER' | 'RESPONDER' | 'UNIT';
export type EventKind = 'incident' | 'call' | 'assess' | 'dispatch' | 'unit' | 'arrive' | 'command' | 'radio' | 'action'
  | 'problem' | 'recovery' | 'casualty' | 'resolve' | 'traffic' | 'shift' | 'hazard';
export interface SimEvent {
  id: number; t: number; incidentId: number; role: Role; actor: string; kind: EventKind; text: string;
  causes: number[]; problem: ProblemCode | null;
  importance: number;      // 0 일상, 1 주요, 2 중요, 3 결정적
  truth: boolean;          // 관찰자만 아는 사실(엔진 진실)인가
  rid: number;             // 관련 대원 (-1)
}

export interface ShiftReport {
  seed: string; duration: number; weather: Weather;
  difficulty: { frequency: number; severity: number; threat: number; equipment: number; info: number; resources: number }; difficultyLabel: string;
  totalCalls: number; totalIncidents: number;
  counts: Record<Outcome, number>;
  avgResponse: number; avgDispatch: number;
  utilization: number; unitUtil: { callsign: string; util: number; runs: number }[];
  casTotal: number; casSaved: number; casLost: number; casUndiscovered: number;
  respondersHurt: { name: string; callsign: string; status: string }[];
  equipFailures: number;
  delayCauses: { code: ProblemCode; label: string; count: number }[];
  incidents: { id: number; code: string; type: IncidentType; reportedType: IncidentType | null; label: string; result: IncidentResult; start: number; end: number }[];
  summary: string[];
  hash: string;
}
