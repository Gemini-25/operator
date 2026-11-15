// 시뮬레이션 전체에서 공유하는 타입 정의.
// 이 파일과 src/sim 아래의 어떤 코드도 DOM / React / Canvas 에 의존하지 않는다.

import type { Rng } from './rng';
import type { BeliefStore } from './field/beliefs';

export interface Pt { x: number; y: number }
export type Dept = 'fire' | 'ems' | 'police';
export type IncidentType = 'fire' | 'traffic' | 'search' | 'armed' | 'medical' | 'collapse' | 'hazmat' | 'water';
export type District = 'residential' | 'commercial' | 'industrial' | 'outskirts';
export type Weather = 'clear' | 'rain' | 'fog' | 'night';

// ───────────────────────── 도시 ─────────────────────────
export interface RoadNode { id: number; x: number; y: number; c: number; r: number; district: District; edges: number[]; key?: string; exit?: boolean }
export interface RoadEdge {
  id: number; a: number; b: number; len: number; speed: number; arterial: boolean;
  cong: number;        // 현재 혼잡 계수 (1 = 원활, 3 = 극심)
  baseCong: number;
  closed: boolean; closedReason: string | null;
  slow: number;        // 사건(사고 현장 등)으로 인한 추가 지연 계수
  name: string;        // 도로 이름
  cls?: 'highway' | 'arterial' | 'street' | 'local';      // 도로 등급
  road?: number;       // 도로 번호 (cityPlan.ROADS)
  seq?: number;        // 그 도로에서 몇 번째 구간인가
  bridge?: boolean;    // 강을 건넌다
  // ── 교통 (traffic.ts) ──
  known?: boolean;     // false = 막혀 있지만(closed) 관제와 부대가 아직 모른다. 없으면 아는 것으로 본다
  bump?: number;       // 밖에서 더하는 혼잡 (재난의 정전, 행사 인파). 교통 모델이 cong 의 목표값에 더한다
  wait?: number;       // 이 구간에서 기다려야 하는 초 (내려온 건널목 차단기)
  gateT?: number;      // 건널목이 있는 구간이면 그 위치 (a→b 로 0..1)
  noHeavy?: boolean;   // 큰 차가 지나지 못한다고 알려진 구간 (불법 주차로 좁아진 골목)
}
export interface Building { x: number; y: number; w: number; h: number; district: District; tone: number }
/** 지도 위의 건물·장소 종류 */
export type PlaceKind =
  | 'houseS' | 'houseL' | 'villa' | 'apartment' | 'officetel' | 'dorm'
  | 'shop' | 'convenience' | 'restaurant' | 'market' | 'mart' | 'bank' | 'office' | 'hotel' | 'church' | 'gasStation'
  | 'factory' | 'warehouse' | 'chemical' | 'utility' | 'construction' | 'storage'
  | 'farmhouse' | 'pension' | 'restStop' | 'greenhouse'
  | 'terminal' | 'hangar' | 'tower'
  | 'fireStation' | 'police' | 'hospital' | 'cityHall' | 'school' | 'logistics'
  | 'park' | 'forest' | 'riverside' | 'reservoir' | 'parking' | 'playground' | 'runway' | 'farmland'
  | 'station' | 'stadium' | 'university' | 'deptStore' | 'cathedral' | 'temple' | 'powerPlant' | 'broadcast' | 'prison' | 'museum' | 'library' | 'busTerminal' | 'ferry' | 'fishMarket'
  | 'lighthouse' | 'amusement' | 'dam' | 'substation' | 'beach' | 'pier' | 'containerYard' | 'campsite' | 'lookout' | 'workshop' | 'clinic' | 'cafe';
/** 지도 위의 건물 한 채 또는 터 하나. 모든 건물에 종류·이름·주소가 있고, 사건은 이 중 한 곳에서 일어난다. */
export interface Place extends Building {
  id: number; kind: PlaceKind; name: string; addr: string;
  block: number;            // 블록 번호 (행 * 8 + 열)
  dong: string;             // 동 이름
  nodeId: number;           // 차량이 닿는 교차로
  cx: number; cy: number;   // 차를 대는 길가 지점
  open: boolean;            // 건물이 아닌 터(공원·숲·하천·주차장 등)
  floors: number;           // 층수 (지도의 그림자 길이)
  facility: number;         // 출동 시설이면 그 번호, 아니면 -1
  rot?: number;             // 가운데를 축으로 돌린 각도(라디안). 도로를 따라 비스듬히 놓인 건물
  rank?: number;            // 눈에 띄는 정도: 3 = 멀리서도 이름이 보인다, 0 = 마우스를 올려야 보인다
  edgeId?: number;          // 면한 도로 구간
}
export interface Alley { x0: number; y0: number; x1: number; y1: number; name: string }
export interface CityBlock { c: number; r: number; use: string; dong: string; name: string; x0: number; y0: number; x1: number; y1: number }
export interface Facility { id: number; kind: 'fireStation' | 'police' | 'hospital' | 'public'; name: string; nodeId: number; x: number; y: number }
export interface Park { x: number; y: number; r: number }
export interface City {
  w: number; h: number;
  nodes: RoadNode[]; edges: RoadEdge[]; buildings: Building[]; facilities: Facility[]; parks: Park[];
  districts: { district: District; name: string; x: number; y: number; w: number; h: number }[];
  places: Place[];                    // 모든 건물과 터
  alleys: Alley[];                    // 블록 안의 골목 (차량이 다니는 도로망에는 들어가지 않는다)
  blocks: CityBlock[];                // 도로 사이의 칸과 그 쓰임새
  river: { pts: number[][]; w: number; name: string };      // 하천의 중심선 (pts 의 세 번째 값은 그 지점의 폭)
  coast?: number[][];                 // 해안선 (이 선보다 남쪽이 바다)
  rail?: number[][];                  // 철길
  mountains?: { name: string; x: number; y: number; rx: number; ry: number }[];
  lake?: { x: number; y: number; rx: number; ry: number; name: string };
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
  // ── 역할과 개인 장비 (R1, crews.ts) ──
  role?: RoleId;                      // 부대 안의 자리 (crews.ts ROLES)
  kit?: KitItem[];                    // 이 사람이 든 장비. 순서 = 역할의 기본 장비 순서 (고장 추첨도 이 순서로 한다)
}

// ── 대원의 역할과 개인 장비 (R1) ──
export type RoleId =
  | 'patrolLead' | 'officer' | 'tacLead' | 'tacOfficer' | 'swatLead' | 'shield' | 'breacher' | 'assaulter' | 'marksman'
  | 'bombTech' | 'robotOp' | 'eodGuard' | 'observer' | 'pilot' | 'copilot'
  | 'fireLead' | 'nozzle' | 'firefighter' | 'engineer' | 'ladderLead' | 'ladderOp'
  | 'rescueLead' | 'extricator' | 'searcher' | 'ropeTech' | 'hazLead' | 'hazTech' | 'decon' | 'airRescuer' | 'boatRescuer' | 'boatLead'
  | 'paramedic' | 'emt' | 'emsDriver' | 'doctor' | 'flightNurse';
/** 역할의 그림 묶음 (부대 목록의 역할 점, 대원 그림) */
export type RoleGroup = 'lead' | 'officer' | 'shield' | 'entry' | 'marksman' | 'bomb' | 'observer' | 'pilot' | 'nozzle' | 'engineer' | 'rescue' | 'search' | 'water' | 'hazmat' | 'medic' | 'doctor';
export type KitId =
  | 'scba' | 'turnout' | 'hose' | 'tic' | 'irons' | 'spreader' | 'breachKit' | 'lightRescue' | 'searchKit' | 'rope' | 'ring'
  | 'pumpPanel' | 'plugKit' | 'gasMeter'
  | 'bag' | 'alsBag' | 'doctorKit' | 'aed' | 'stretcher' | 'spineBoard'
  | 'pistol' | 'rifle' | 'sniper' | 'taser' | 'flashbang' | 'vest' | 'plate' | 'shield' | 'bombSuit' | 'eodKit' | 'robot' | 'megaphone' | 'baton'
  | 'flir' | 'searchlight'
  | 'charge';            // 폭파 장약 — R1 은 들려 두기만 한다. 쓰는 것은 R2 §4.2a (사용자 결정 2026-11-15)
/** 대원 한 사람이 든 장비 하나 */
export interface KitItem {
  id: KitId;
  uses?: number;        // 남은 수량: 섬광탄·테이저 카트리지는 개수, 공기호흡기는 남은 초
  fault?: boolean;      // 이번 교대에 고장 나 있다 (처음 쓰려 할 때 드러난다)
  faultKnown?: boolean; // 고장이 드러났다 (이때부터 조직이 안다)
}
/** 현장 상공에 머무는 헬기의 일 (field/rules/air.ts 가 굴린다) */
export interface AirOp {
  unitId: number; mode: 'watch' | 'hoist' | 'bucket';
  x: number; y: number; px: number; py: number;       // 현장 격자 위의 자리 (칸)
  phase: 'hover' | 'work' | 'away' | 'leave';          // away = 물을 뜨러 감 (현장 밖)
  target: number;                                      // hoist: casualty id, bucket: region id, 없으면 -1
  workId: number;                                      // 지휘관 작업판의 작업 (없으면 -1)
  progress: number; need: number;
  backAt: number;                                      // away 에서 돌아오는 시각
  idleSince: number;                                   // 할 일이 없어진 시각 (-1 = 일하는 중)
  eye: FieldAgent;                                     // 공중 관측자 — s.agents 에 넣지 않는다
}
export interface AirStats { sorties: number; byKind: Record<string, number>; hoists: number; drops: number; airLifts: number; rtb: number; tracked: number; grounded: string | null }

export type UnitKind = 'engine' | 'rescue' | 'als' | 'bls' | 'patrol' | 'tactical' | 'ladder' | 'hazmat' | 'swat' | 'eod' | 'heli' | 'boat'
  | 'policeHeli' | 'medHeli';      // (R1) 경찰 헬기 · 의료 헬기. 'heli' 는 그대로 소방 헬기다
/** 부대의 분야 (편성표와 화면의 묶음) */
export type UnitField = 'police' | 'fire' | 'rescue' | 'special';
export type UnitState = 'available' | 'turnout' | 'enroute' | 'onscene' | 'transport' | 'hospital' | 'returning' | 'oos';
export interface UnitCaps { suppression: number; rescue: number; ems: number; law: number; tactical: number; search: number; traffic: number; eod: number }
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
  // 교차로에서 건물 앞 길가까지의 마지막 구간 (curbT: 0 = 교차로, 1 = 길가)
  curb?: { x: number; y: number; len: number } | null; curbT?: number; parking?: boolean;
  field?: UnitField;
  air?: boolean;       // 헬기: 도로와 상관없이 곧장 날아간다
  sea?: boolean;       // 구조정: 해안을 따라 바다로 간다 (바닷가의 수난 사고에만 나간다)
  busyTime: number; runs: number;
  boardOrder: 'release' | 'transport' | null;
  aid?: boolean;                      // 인근 도시에서 지원 온 부대 (임무를 마치면 관할로 돌아간다)
  heavy?: boolean;                    // 큰 차 (펌프차·사다리차·구조 공작차·화학차): 좁아진 골목을 지나지 못한다
  backing?: boolean;                  // 막힌 길에서 되돌아 나오는 중
  // ── 편성·헬기 (R1) ──
  seats?: number;                     // 환자 자리 (구급차 2, 소방·의료 헬기 1, 나머지 0). 읽을 때는 seatsOf 하나로 (crews.ts)
  hoist?: boolean;                    // 호이스트가 있다 (소방 헬기)
  bucket?: number; bucketMax?: number;        // 물 바구니에 담긴 투하 횟수 / 한 번에 담는 횟수 (소방 헬기 1)
  fuel?: number; fuelMax?: number;            // 헬기의 남은 체공 시간(초)
  grounded?: 'fog' | 'night' | 'storm' | null;      // 지금 뜰 수 없는 이유
  spareAir?: number;                  // 차에 실은 예비 공기통 수
  airNeed?: keyof Needs;              // 헬기가 이번 출동에서 맡은 수요 (dispatcher.sendUnit 이 적는다. airRtb 가 되돌린다)
}

// ───────────────────────── 정보(Belief) ─────────────────────────
export type FactType = 'cas' | 'fire' | 'srch' | 'blk' | 'hos' | 'haz' | 'occ' | 'ctl' | 'clue' | 'seen' | 'type' | 'secure' | 'mate' | 'evid'
  | 'ovh';         // 구역별 잔불 정리를 마친 시각 (값 1)
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
  | 'valve'         // 가스가 새는 배관: 차단(mitigate)할 때까지 leakRate 세기로 가스를 내뿜는다
  | 'bomb';         // 폭발물로 보이는 물건: real 이면 fuse 시각에 터진다. 해체(defuse)하면 mitigated
export interface Prop {
  id: number; kind: PropKind; x: number; y: number; w: number; h: number;
  blocking: boolean;
  locked?: boolean; open?: boolean;          // door
  skin?: string;                             // 같은 규칙에 다른 모습: 'tree'(쓰러진 나무 줄기), 'manhole'(열린 맨홀)
  hp: number;                                // 제거/개방에 필요한 작업량 (남은 양)
  leak?: number; leakRate?: number; mitigated?: boolean; ignited?: boolean;   // vehicle
  occupants?: number[]; emptySeat?: boolean; cleared?: boolean; angle?: number; color?: number;
  exploded?: boolean;                        // gas
  found?: boolean; dirRegion?: number;       // clue
  interviewed?: boolean; lastSeenRegion?: number; accurate?: boolean;  // witness
  removed?: boolean;
  entered?: boolean;                         // door: 진입조가 이 방 문으로 이미 진입했다
  bus?: boolean;                             // vehicle: 버스 (다수 사상자 사고)
  real?: boolean; fuse?: number;             // bomb: 진짜 장치인가, 터지는 시각(sim.t)
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
  bystander2?: boolean;     // 사건 도중 현장 밖에서 다가와 피해를 입은 주변 시민
  inWater?: boolean;        // 물에 빠져 있다 (수난 사고): 물가에서 줄을 던져 끌어내야 한다
  drift?: number;           // 떠내려가는 속도 (칸/초, +x 방향)
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
  moveAt: number;           // 다음에 자리를 옮길 수 있는 시각 (엄폐 이동)
  shotAt: number;           // 마지막으로 사격을 받은 시각
  retreated: boolean;       // 인질을 끌고 이미 한 번 물러났다
  dragging: boolean;        // 지금 인질을 끌고 옮기는 중
  path: number[] | null; pathI: number; negot: number; seenOfficers: number;
  targetRid: number;
}
export interface PassingCar { x: number; px: number; row: number; dir: number; speed: number; distracted: boolean; stopped: boolean; hit: boolean }
// ── 교전 연출 기록 (G5) ── 시뮬레이션은 이 칸들을 읽지 않는다. 그림(view/scene/fxBook.ts)과 소리(view/audioCombat.ts)만 읽는다.
export type FxWeapon = 'pistol' | 'rifle' | 'hgun' | 'knife' | 'blunt'     // hgun = 용의자의 총
  | 'sniper' | 'taser'                   // R1 의 개인 장비 이름(KitId)과 같다
  | 'beanbag';                           // R2 의 비살상탄
export type FxResult = 'hit' | 'miss' | 'cover';
export type FxStop = 'body' | 'wall' | 'door' | 'furn' | 'far'
  | 'shield';                            // R1 의 방패에 맞음
export type BreachHow = 'open' | 'push' | 'kick' | 'ram' | 'irons' | 'hydraulic'   // 문 방법 이름은 R2 의 MethodId 와 같다(irons = 할리건·도끼)
  | 'charge';                            // 폭파 진입: 시뮬레이션이 실제 폭발 효과를 적용할 때만. 지금은 부르는 곳이 없다
export type ArrestHow = 'chase' | 'stunned' | 'tackle' | 'surrender';
export interface FxInfo {
  side?: 0 | 1;                          // 0 = 대원 쪽, 1 = 용의자 쪽
  by?: number;                           // 쏜·던진·진입한·검거한 사람: side 0 이면 대원 rid, 1 이면 용의자 id
  wpn?: FxWeapon;
  res?: FxResult;                        // 사격·근접·테이저의 결과
  ix?: number; iy?: number;              // 사격: 그려지는 탄이 멈춘 자리(칸 좌표, 소수)
  stop?: FxStop;                         // 사격: 무엇에 멈췄나
  tk?: 0 | 1 | 2; target?: number;       // 맞은 사람: 0 대원(rid) · 1 용의자(id) · 2 구조 대상(id)
  arm?: number;                          // 맞은 대원 부대의 방호(Unit.armor, 0..1)
  ox?: number; oy?: number;              // 힘이 온 곳: 피격은 쏜 자리, 섬광탄은 던진 사람, 진입은 진입조 쪽, 검거는 대원
  r?: number;                            // 반경(칸): 섬광탄 효과 반경, 폭발 피해 반경
  n?: number;                            // 섬광탄: 무력화한 용의자 수 · 진입: 함께 들어간 인원
  src?: 'bomb' | 'gas' | 'tank' | 'collapse' | 'fuel';
  door?: number;                         // 진입·강제 개방한 문(소품 id, 문 없는 출입구는 -1)
  how?: BreachHow;
  sync?: boolean;                        // 진입: 지휘관의 동시 진입 신호에 맞춘 진입(breach)
  forced?: boolean;                      // 진입: 잠긴 문을 부숴 열었다
  arrest?: ArrestHow;
}
/** (G5) 인터페이스 합치기: 아래 한 줄짜리 Fx 에 꼬리표 칸을 더한다 */
export interface Fx { c?: FxInfo }
export interface Fx { kind: 'shot' | 'spray' | 'radio' | 'text' | 'boom' | 'hit' | 'flash' | 'glass' | 'debris' | 'melee' | 'breach' | 'cuff' | 'taser'
  | 'collapse'       // (G4) 무너짐: field/ruins.ts 의 recordFall 만 남긴다. 그림은 Scene.falls 로 그리고, 이 효과는 카메라·자동 감속·소리만 본다
  | 'drop';          // (R1) 헬기의 물 투하: field/rules/air.ts 가 남긴다 (x,y → x2,y2 = 물이 떨어진 띠의 두 끝)
  t: number; x: number; y: number; x2?: number; y2?: number; text?: string; color?: string; ttl: number }

export type WorkKind =
  | 'sizeup' | 'search' | 'suppress' | 'hookup' | 'clear' | 'force' | 'extricate' | 'treat' | 'carry' | 'load'
  | 'traffic' | 'mitigate' | 'perimeter' | 'negotiate' | 'engage' | 'arrest' | 'interview' | 'clearRoad' | 'rescueMate' | 'escort' | 'waterRescue'
  | 'defuse'        // 폭발물 해체 (폭발물 처리반만)
  | 'overhaul'      // 잔불 정리: 불이 꺼졌다고 본 방을 다시 돌며 남은 불씨를 찾아 적신다 (소방만)
  | 'hoist' | 'airDrop';      // (R1) 공중 임무: 호이스트 인양 · 공중 물 투하. 지휘관이 작업판에 올리고 field/rules/air.ts 가 가져간다. 지상 대원은 맡지 않는다(fitFor = 0)
export type TaskKind = WorkKind | 'retreat' | 'rehab' | 'resupply' | 'board' | 'standby' | 'moveSignal' | 'swapAir';      // swapAir = 공기통 교체 (R1 9절)

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
  failedAt: Record<number, number>;      // rid → 그 대원이 이 작업을 마지막으로 실패하거나 위험해서 내려놓은 시각 (한동안 같은 대원에게 다시 맡기지 않는다 — agents.failedRecently)
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
  rehabLogAt: number;                         // 마지막으로 "체력 고갈"을 알린 시각 (같은 말을 되풀이하지 않는다)
  spot: number;                               // 점유 중인 엄폐 위치 인덱스
  quiet: Set<string>;                         // 이미 별도 이벤트로 알린 정보(무전 문구에서 생략)
  lastRetreatLog: number;
  equipRetryAt: number;                       // 이 시각 전에는 장비 문제(소화전 연결)를 스스로 다시 시도하지 않는다 (닿지 못해 실패한 뒤)
  // ── R1 ──
  aloft?: boolean;                            // 공중 관측자 (AirOp.eye). 걷지 않고 무전 음영을 받지 않는다
  taserAt?: number;                           // 마지막으로 테이저를 쏜 시각 (사격 대기 a.cooldown 과 따로)
}

export interface RadioMsg {
  id: number; t: number; deliverAt: number; from: number;   // from rid (-1 = 관제)
  to: number;                                               // rid, -1 = 현장 전체, -2 = 관제
  kind: 'report' | 'order' | 'request' | 'sitrep' | 'brief'
    | 'rollcall';      // 지휘관의 확인 무전: 받은 대원은 자기가 아는 상황을 다시 보고한다
  facts: Fact[]; workId: number; text: string; eventId: number;
}

export interface ResourceRequest { t: number; need: keyof UnitCaps; count: number; reason: string; eventId: number; fulfilled: number; urgent: boolean }

export interface Scene {
  outdoor?: boolean;        // 건물이 아니라 길 위의 현장 (출입구 대신 길목)
  rules?: ('collapse' | 'gas' | 'water')[];      // 유형의 규칙에 더해 돌릴 세계 규칙 (예: 가스 폭발 현장 = 붕괴 + 가스, 선박 화재 = 화재 + 표류)
  glass: Uint8Array;                  // 깨진 창 (1 = 깨짐). 창 칸에만 뜻이 있다
  decorHp: Uint8Array;                // 가구가 받은 피해 (0 = 멀쩡하거나 가구가 아님 · 1…200 = 닳음 · 255 = 부서져 바닥이 됨). field/damage.ts
  id: number; incidentId: number; kind: IncidentType; variant: string;
  w: number; h: number;
  tiles: Uint8Array; region: Int16Array;
  fire: Float32Array; heat: Float32Array; fuel: Float32Array; smoke: Float32Array; burned: Uint8Array; wet: Float32Array;
  shadow: Uint8Array;                 // 무전 음영 구역
  decor: Uint8Array;                  // 가구 종류 (DECOR)
  damage: Uint8Array;                 // 무너져 내린 자리 (붕괴 사건: 잔해가 깔린 바닥)
  placeName?: string;                 // 현장을 만들면서 정해진 장소 이름 (사건 이름표에 쓴다)
  stairTo: Int16Array;                // 계단 칸 → 이어진 다른 층의 계단 칸 (-1 = 계단 아님). 층은 같은 격자 안에 나란히 놓인다
  entryExit: number;                  // 지휘관이 고른 진입 출입구 (s.exits 의 번호, -1 = 아직 정하지 않음)
  entryExit2: number;                 // 두 문 동시 진입일 때 2조의 출입구 (-1 = 한 문으로만 진입)
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
  allIdleSince?: number;              // (지휘관) 현장의 모든 대원이 손을 놓고 있기 시작한 시각 (-1 = 누군가 일하는 중)
  rollCallAt?: number;                // (지휘관) 마지막 확인 무전 시각
  ruin?: Uint8Array;        // (G4) 그림용 기록 — 무너진 자리의 원래 모습(field/ruins.ts). 시뮬레이션은 읽지 않는다.
                            // 0 없음 · 1 넘어간 벽 · 8 2차 붕괴로 잔해가 쏟아진 칸 · 9 천장이 내려앉은 칸 · 16+DECOR 깔린 가구(키 큰 진열대 포함)
  falls?: FallRecord[];     // (G4) 그림용 기록 — 무너진 순간들(시각 순, 많아야 32). 시뮬레이션은 읽지 않는다
  // ── 상공의 헬기 (R1) ──
  air?: AirOp[];
  light?: { x: number; y: number; r: number } | null;      // 경찰 헬기 탐조등이 비추는 곳 (밤)
  airAt?: number;           // 상공 부대가 처음 닿은 시각 (없으면 -1/undefined). s.arrivedAt 은 지금 뜻 그대로 지상 대원이 처음 내린 시각
  clearVision?: number;     // 그 현장의 맑은 날 바깥 시야 (baseScene 7.5, 실종 현장 3.8). 탐조등이 쓴다
}

// ───────────────────────── 신고 / 관제 ─────────────────────────
export type Persona = 'calm' | 'panicked' | 'confused' | 'partial' | 'wrong' | 'prank';
export type Topic = 'location' | 'nature' | 'injured' | 'count' | 'trapped' | 'hazard' | 'weapon' | 'detail';
export interface Claim { topic: Topic; value: any; conf: number; text: string; truthful: boolean; callId: number; note: string; placeKind?: PlaceKind | 'intersection' }
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
export interface Needs { suppression: number; rescue: number; ems: number; law: number; tactical: number; search: number; traffic: number; eod: number }
export interface Assessment {
  type: IncidentType; typeConf: number; probs: Record<IncidentType, number>;
  severity: number;          // 1..3
  confidence: number;
  needs: Needs; risks: string[]; summary: string; t: number; revision: number;
  label?: string;            // 신고 내용으로 붙인 이름 (예: 승강기 갇힘). 없으면 유형 이름을 쓴다
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
/** 추격전: 도주 차량이 도로망을 달리는 동안의 상태 (pursuit.ts) */
export interface Pursuit {
  state: 'driving' | 'stopped' | 'escaped'; kind: 'kidnap' | 'drunk' | 'getaway';
  hideout?: number;            // 납치범이 향하는 은신처 (건물 id). 없으면 도시 밖으로 달아난다
  from: number; to: number; edge: number; t: number;      // 지금 달리는 구간(교차로 → 교차로)과 그 위의 위치 0..1
  x: number; y: number; angle: number;
  goal: number;                // 향하는 교차로
  startAt: number; nextSight: number; seenAt: number;      // 달리기 시작한 시각, 다음 목격 신고, 부대가 마지막으로 본 시각
  pressure: number; tracked: boolean;                      // 바짝 붙은 순찰차가 쌓은 압박, 지금 부대의 시야 안에 있는가
  crashAt: number; giveUpAt: number;                       // 스스로 사고를 내는 시각(난폭 운전), 이때까지 못 잡으면 놓친다
  how: string;                 // 어떻게 섰는가: caught(따라붙음) · block(앞을 막음) · crash(사고)
  trail: number[][];           // 지나온 교차로 (그림용)
}
export interface Incident {
  pursuit?: Pursuit;
  tag?: string;              // 묶음: life · chase · crime · major(대형 사고) · 'disaster:typhoon' 처럼 재난에 딸린 사건. 없으면 예전부터 있던 사건
  parent?: number;           // 이 사건을 낳은 사건 (도주한 용의자의 재범, 연쇄 방화, 은신처)
  id: number; code: string;
  // ── 진실 (엔진만 사용. AI 는 접근 금지) ──
  truth: { type: IncidentType; variant: string; severity: number; nodeId: number; x: number; y: number; district: District; label: string; placeId: number; placeKind: PlaceKind | null };
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
  coResp?: number;                    // 응급 환자: 구급차가 멀어 함께 보낸 선착 대응 부대 (사건당 한 번, dispatcher.firstResponder)
  airDone?: UnitKind[];               // (R1) 이 사건에서 "상공 임무 종료"로 풀려난 헬기 종류 (관제가 같은 종류를 다시 보내지 않는다)
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
  respondersHurt: { name: string; callsign: string; status: string; role?: string }[];      // role = 역할 이름 (R1)
  equipFailures: number;
  delayCauses: { code: ProblemCode; label: string; count: number }[];
  incidents: { id: number; code: string; type: IncidentType; name?: string; reportedType: IncidentType | null; label: string; result: IncidentResult; start: number; end: number }[];
  summary: string[];
  major?: number;                  // 대형 사고 건수
  traffic?: { jams: number; closures: number; obstacles: number; detours: number; delaySec: number; gateWaits: number };      // 교통 통계 (traffic.ts)
  disaster?: { name: string; lines: string[] };      // 재난이 있었던 교대의 요약 (disaster.ts)
  air?: AirStats;                  // (R1) 헬기 통계
  hash: string;
}

/** (G4) 그림용 기록: 무너진 순간 하나. field/ruins.ts 의 recordFall 만 만든다 */
export interface FallRecord {
  t: number; x: number; y: number; r: number; region: number;
  cause: 'zone' | 'secondary' | 'ceiling'      // 마지막 줄에 둔다 — X6 가 끝에 새 줄로 | 'partial' | 'total' 을 덧붙인다
}
