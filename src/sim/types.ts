// 시뮬레이션 전체에서 공유하는 타입 정의.
// 이 파일과 src/sim 아래의 어떤 코드도 DOM / React / Canvas 에 의존하지 않는다.

import type { Rng } from './rng';
import type { BeliefStore } from './field/beliefs';

export interface Pt { x: number; y: number }
export type Dept = 'fire' | 'ems' | 'police'
  | 'civil';      // (N8 §5.3) 유관 기관(전력·가스·수도 복구반·견인차): 지휘하지 않고 첫 도착으로 세지 않으며 자기 일(repair·towAway)만 한다
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
  | 'lighthouse' | 'amusement' | 'dam' | 'substation' | 'beach' | 'pier' | 'containerYard' | 'campsite' | 'lookout' | 'workshop' | 'clinic' | 'cafe'
  | 'subway' | 'concertHall' | 'bankHQ';      // (N9 §4.9) 지하철역 출입구 · 공연장 · 은행 본점 — cityPlan.LATE_LANDMARKS 로 덧붙인다(단계 3). 단계 1 은 이름표만 (사건 장소 표에 넣는 것은 그 종류를 쓰는 단계 4·5·6·7)
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
  health: number; stamina: number; status: 'ok' | 'injured' | 'down'
    | 'off';                          // (I2) 이번 교대에 나오지 않음 (결장·공석 — persist.ts). 현장에 내리지 않고 crewReady 에 세지 않는다
  xpGained: number; incidentsWorked: number;
  // ── 역할과 개인 장비 (R1, crews.ts) ──
  role?: RoleId;                      // 부대 안의 자리 (crews.ts ROLES)
  kit?: KitItem[];                    // 이 사람이 든 장비. 순서 = 역할의 기본 장비 순서 (고장 추첨도 이 순서로 한다)
  // ── 부상 (H1, field/injury.ts) ── 교대 내내 유지되는 상태. 없으면 "다친 적 없음"
  injuries?: Injury[];                // 원인마다 한 줄
  bleed?: number; bleed0?: number;    // 상처로 인한 초당 체력 감소, 처치 전 값
  treatQ?: number;                    // 받은 처치 (0 없음 … 1 전문)
  dead?: boolean;                     // 순직. status 는 'down' 그대로 둔다
  tDown?: number; tDead?: number;     // 쓰러진 시각, 숨진 시각
  care?: 'aboard' | 'hospital';       // 후송 중 / 병원 인계됨
  deathCause?: InjuryCause;
  bleedCause?: InjuryCause;           // 지금의 bleed 를 만든 원인 (상처 악화를 이 원인으로 적는다 — 구조 대상·용의자의 같은 칸과 같다)
}

// ── 대원의 역할과 개인 장비 (R1) ──
export type RoleId =
  | 'patrolLead' | 'officer' | 'tacLead' | 'tacOfficer' | 'swatLead' | 'shield' | 'breacher' | 'assaulter' | 'marksman'
  | 'bombTech' | 'robotOp' | 'eodGuard' | 'observer' | 'pilot' | 'copilot'
  | 'fireLead' | 'nozzle' | 'firefighter' | 'engineer' | 'ladderLead' | 'ladderOp'
  | 'rescueLead' | 'extricator' | 'searcher' | 'ropeTech' | 'hazLead' | 'hazTech' | 'decon' | 'airRescuer' | 'boatRescuer' | 'boatLead'
  | 'paramedic' | 'emt' | 'emsDriver' | 'doctor' | 'flightNurse'
  | 'utilLead' | 'lineman' | 'gasTech' | 'plumber' | 'towDriver' | 'catcherLead' | 'catcher' | 'detective' | 'motorOfficer' | 'k9Handler'      // (N8 §4.9) 복구반장·전력·가스·수도 기사·견인 기사·포획 팀장·포획 요원·형사·교통 순찰 대원·경찰견 핸들러
  | 'mtnLead' | 'mtnRescuer' | 'diveLead' | 'diver' | 'deconLead' | 'deconTech' | 'riotLead' | 'riotShield' | 'riotGrab';      // (N9 §4.8) 산악 구조 팀장·대원 · 잠수 팀장·대원 · 제독 팀장·대원 · 기동대 소대장·방패 대원·검거 대원 (지금 역할 shield·tacOfficer 와 이름이 겹치지 않게)
/** 역할의 그림 묶음 (부대 목록의 역할 점, 대원 그림) */
export type RoleGroup = 'lead' | 'officer' | 'shield' | 'entry' | 'marksman' | 'bomb' | 'observer' | 'pilot' | 'nozzle' | 'engineer' | 'rescue' | 'search' | 'water' | 'hazmat' | 'medic' | 'doctor'
  | 'civil';      // (N8) 유관 기관의 기사 (복구반장·기사·견인 기사)
export type KitId =
  | 'scba' | 'turnout' | 'hose' | 'tic' | 'irons' | 'spreader' | 'breachKit' | 'lightRescue' | 'searchKit' | 'rope' | 'ring'
  | 'pumpPanel' | 'plugKit' | 'gasMeter'
  | 'bag' | 'alsBag' | 'doctorKit' | 'aed' | 'stretcher' | 'spineBoard'
  | 'pistol' | 'rifle' | 'sniper' | 'taser' | 'flashbang' | 'vest' | 'plate' | 'shield' | 'bombSuit' | 'eodKit' | 'robot' | 'megaphone' | 'baton'
  | 'flir' | 'searchlight'
  | 'pole' | 'pfd' | 'drysuit' | 'raft' | 'extinguisher' | 'fan' | 'airbag' | 'shoring' | 'beanbag'      // (R2 §3.3) 갈고리 장대·구명조끼·드라이슈트·고무보트·소화기·송풍기·에어백·지지대·비살상탄 발사기 — 표(KITS)에만 있고 역할에는 단계 1a~5 가 붙인다
  | 'charge'             // 폭파 장약 — R1 은 들려 두기만 한다. 쓰는 것은 R2 §4.2a (사용자 결정 2026-11-15)
  | 'insulKit' | 'voltDetector' | 'valveKey' | 'pumpSet' | 'towKit' | 'dart' | 'catchpole' | 'net' | 'beeSuit' | 'jumpMat' | 'dog'      // (N8 §4.9) 절연 장비·검전기·밸브 키·배수 펌프·견인 장비·마취총·올가미·포획망·벌 보호복·안전 매트·경찰견
  | 'mtnKit' | 'diveKit' | 'deconKit' | 'oilBoom';      // (N9 §4.8) 산악 장비 · 잠수 장비 · 제독 장비 · 오일펜스
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
  | 'policeHeli' | 'medHeli'       // (R1) 경찰 헬기 · 의료 헬기. 'heli' 는 그대로 소방 헬기다
  | 'powerCrew' | 'gasCrew' | 'waterCrew' | 'tow' | 'animalCtl' | 'detective' | 'trafficPol' | 'k9'      // (N8 §4.9) 전력·가스·수도 복구반 · 견인차 · 동물 포획팀 · 형사 · 교통 경찰 · 경찰견 (단계 2b 는 편성하지 않는다 — minLevel 6)
  | 'mtnRescue' | 'dive' | 'deconUnit' | 'riotPol';      // (N9 §4.8) 산악 구조대 · 수중 구조대 · 화생방 제독차 · 경찰 기동대 (단계 2 는 편성하지 않는다 — minLevel 6)
/** 부대의 분야 (편성표와 화면의 묶음) */
export type UnitField = 'police' | 'fire' | 'rescue' | 'special'
  | 'civil';      // (N8) 유관 기관 (화면 묶음)
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
  // ── 부상 대원·용의자의 후송 (H1) ──
  aboard?: { kind: 'mate' | 'suspect'; id: number; inc: number; t: number }[];   // 구조 대상이 아닌 환자 (대원 rid · 용의자 id). 자리 셈에는 다른 부대의 대원과 용의자만 넣는다
  firstLoadAt?: number;               // 이번 이송에 처음 사람을 태운 시각 (부대 자신의 기록)
  oosEv?: number;                     // 이 부대의 마지막 RESPONDER_HURT·RESPONDER_KILLED 기록 — 운용 중단 기록의 원인으로 쓴다
}

// ───────────────────────── 정보(Belief) ─────────────────────────
export type FactType = 'cas' | 'fire' | 'srch' | 'blk' | 'hos' | 'haz' | 'occ' | 'ctl' | 'clue' | 'seen' | 'type' | 'secure' | 'mate' | 'evid'
  | 'ovh'          // 구역별 잔불 정리를 마친 시각 (값 1)
  | 'sign'         // (X6) 조짐: 구조 약화·가스 농도·용기 가열·불꽃 역류·분진, 그리고 붕괴·폭발 소리 (값 SignBelief)
  | 'ops'          // (X6) 지휘 상태: id 0 = 전술 모드와 진입 금지 구역, id 100 + rid = 그 대원의 인원 점검 응답
  | 'ani'          // (N8) 본 동물: id = Animal.id, 값 AniBelief (시야 밖으로 나가면 마지막 자리가 남는다)
  | 'crew';        // (R3 1단계) 대원 자신의 몸 상태 신고: id = rid, 값 CrewBelief (지휘관·동료는 남의 몸을 이것으로만 안다)
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
/** (H1) 지휘관이 아는 동료의 상태 ('mate' 사실의 값). X6 가 끝에 trapped?: boolean 을 더한다 */
export interface MateBelief { x: number; y: number; status: 'down' | 'hurt' | 'safe' | 'evac' | 'light'; band: number; bleeding: boolean; tq: 0 | 1 | 2; dead: boolean; wasDown: boolean; since: number }
//   'light' = 처치 뒤 가벼운 일로 돌아온 다친 동료 — 처치·후송·구조의 대상이 아니다

// ───────────────────────── 부상 (H1, field/injury.ts) ─────────────────────────
/** 다친 원인 (세 부류 공통). 화면·보고서의 이름은 injury.ts 의 CAUSE_NAME */
export type InjuryCause =
  | 'gunshot' | 'stab' | 'blunt'                 // 총상 · 자상(흉기) · 타박상(맨손, 제압 중 맞섬)
  | 'burn' | 'smoke' | 'toxic'                   // 화상 · 연기 흡입 · 유독 가스 흡입(가스 누출 현장)
  | 'fall' | 'crush' | 'blast'                   // 추락·미끄러짐 · 잔해 깔림·낙하물 · 폭발
  | 'drown' | 'electric' | 'exhaustion'          // 익수 · 감전 · 탈진(열 탈진)
  | 'vehicle' | 'exposure' | 'illness'           // 차량 충격 · 실외 노출(저체온·탈수) · 급성 질환
  | 'animal';                                    // (N8) 동물·벌 피해 (물림·받힘·쏘임)
/** 한 사람이 한 원인으로 입은 피해. 원인마다 한 줄로 합친다 (연기처럼 매 틱 더해지는 피해가 배열을 늘리지 않게) */
export interface Injury {
  cause: InjuryCause;
  dmg: number;        // 이 원인으로 깎인 체력의 합 (방호를 뺀 뒤)
  sev: number;        // 이 원인으로 다친 뒤 닿은 가장 나쁜 중증도 (0 경상 · 1 중상 · 2 위중 · 3 사망)
  t: number;          // 처음 다친 시각
  last: number;       // 마지막으로 더해진 시각
  by: number;         // 가해자 (byKind 에 따라 용의자 id 또는 대원 rid). 없으면 -1
  byKind: 'hostile' | 'responder' | 'world' | 'initial';
  ev: number;         // 이 부상을 처음 남긴 기록 (없으면 -1)
}
/** 교대 끝의 명부 상태 — I2(교대 간 지속)가 다음 교대의 입력을 만들 때 읽는다. I2 는 name 을 열쇠로 쓴다(rid 는 부대 규모 손잡이에 따라 바뀐다) */
export interface RosterOut { rid: number; name: string; health: number; band: number; dead: boolean; hospital: boolean; out: number; cause: InjuryCause | null }

// ───────────────────────── 현장 ─────────────────────────
export const T = { VOID: 0, GROUND: 1, ROAD: 2, FLOOR: 3, WALL: 4, WINDOW: 5, TREE: 6, WATER: 7, ROCK: 8, DOOR: 9, TRAIL: 10, FURN: 11, STAIR: 12,
  LEDGE: 13,      // (N8 §5.11) 높은 자리 — 사람이 서 있을 수 있지만 걸어서 오가지 못한다(grid.staticPass 거짓), 시야는 통한다, 실내·바닥이 아니다
} as const;
/** 가구 종류 (Scene.decor). 가구는 지나갈 수 없지만 시야는 가리지 않고, 엄폐물이 되며, 불에 탄다. */
export const DECOR = { NONE: 0, BED: 1, DESK: 2, TABLE: 3, SOFA: 4, CABINET: 5, CRATE: 6, MACHINE: 7, COUNTER: 8, PLANT: 9, KITCHEN: 10, SHELF: 11 } as const;

export interface Region {
  id: number; name: string; kind: 'room' | 'corridor' | 'zone' | 'wreck' | 'verge'
    | 'pen' | 'shade' | 'roof' | 'basement';      // (N8) 우리(가축을 모는 곳) · 그늘(폭염 환자를 옮기는 곳) · 옥상 · 지하(수도관 파열의 지하 주차장)
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
  // ── 부상 기록 (H1) ──
  injuries?: Injury[];
  bleedCause?: InjuryCause;       // 지금의 bleed 를 만든 원인 (매 틱 악화를 이 원인으로 적는다). 없으면 그 항은 기록하지 않는다
  deathCause?: InjuryCause;       // 숨지게 한 원인. 한 번 정해지면 바꾸지 않는다
  lost?: boolean;                 // 물살에 휩쓸려 현장 밖으로 떠내려갔다 (tickWater 가 세운다 — 화면이 그리지 않을 사람을 가린다)
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
  // ── 부상 (H1) ──
  injuries?: Injury[];
  bleed?: number; bleed0?: number; treatQ?: number; tTreated?: number;
  dead?: boolean;                 // state 는 그대로('down' 또는 'arrested') 두고 따로 표시한다
  tDown?: number; tDead?: number;
  where?: 'scene' | 'aboard' | 'hospital';      // 없으면 scene
  bleedCause?: InjuryCause; deathCause?: InjuryCause;
  selfHarmRolled?: boolean;       // 자해 추첨을 이미 했다 (용의자마다 한 번)
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
  src?: 'bomb' | 'gas' | 'tank' | 'collapse' | 'fuel'
    | 'drum' | 'cng' | 'jet' | 'dust';      // (X6) 화학 드럼 · CNG 버스 · 항공유 · 분진 폭발
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
  | 'drop'           // (R1) 헬기의 물 투하: field/rules/air.ts 가 남긴다 (x,y → x2,y2 = 물이 떨어진 띠의 두 끝)
  | 'horn';          // (X6) 철수 신호 (소리·카메라·자동 감속이 본다). 남기는 것은 단계 5 의 지휘 규칙
  t: number; x: number; y: number; x2?: number; y2?: number; text?: string; color?: string; ttl: number }

export type WorkKind =
  | 'sizeup' | 'search' | 'suppress' | 'hookup' | 'clear' | 'force' | 'extricate' | 'treat' | 'carry' | 'load'
  | 'traffic' | 'mitigate' | 'perimeter' | 'negotiate' | 'engage' | 'arrest' | 'interview' | 'clearRoad' | 'rescueMate' | 'escort' | 'waterRescue'
  | 'defuse'        // 폭발물 해체 (폭발물 처리반만)
  | 'overhaul'      // 잔불 정리: 불이 꺼졌다고 본 방을 다시 돌며 남은 불씨를 찾아 적신다 (소방만)
  | 'hoist' | 'airDrop'      // (R1) 공중 임무: 호이스트 인양 · 공중 물 투하. 지휘관이 작업판에 올리고 field/rules/air.ts 가 가져간다. 지상 대원은 맡지 않는다(fitFor = 0)
  | 'treatMate'      // (H1) 다친 대원 처치. 태울 차(prop)가 정해져 있고 병원이 필요하면 이어서 그 차에 태운다 (구급 분야, 또는 의료 가방을 든 대원)
  | 'treatSuspect'      // (H1) 쓰러진·다친 용의자 처치. 태울 차(prop)가 내 차이고 자리가 있으면 이어서 그 차에 태운다 (경찰은 언제든, 구급대원은 안전 확보 뒤)
  | 'repair' | 'towAway' | 'capture' | 'persuade' | 'cordon'      // (N8) 시설물 복구(유관 기관) · 견인 · 동물 포획 · 위기자 설득 · 통제(위협이 없는 현장에서 한 칸을 지킨다 — tile = 격자 칸 번호). 단계 2a 에는 자리만 (fitFor 0, 실행부는 빈 갈래)
  | 'decontam';      // (N9 §5.5) 오염된 구조 대상 제독 (대상 = cas). 단계 1 에는 자리만 (workLabel '제독' · fitFor 0 · 실행부는 빈 갈래) — 맡는 사람·실행은 단계 6
export type TaskKind = WorkKind | 'retreat' | 'rehab' | 'resupply' | 'board' | 'standby' | 'moveSignal' | 'swapAir'      // swapAir = 공기통 교체 (R1 9절)
  | 'evacuate'      // (X6) 철수 이동: 단계 3 구역 밖, 대개 대기 지점으로 (철수 명령·자기 감각의 임박 조짐 — brain.think 의 의무)
  | 'ashore'      // (R2 1b) 물 위의 대원(헤엄 중·보트 위)이 뭍으로 돌아간다 (brain.think 의 물 위 가드 · 헤엄 사고 뒤)
  | 'cover' | 'rearm';      // (R3 2단계) 교본 행동: 엄폐(숨기 — 쏘지 않고 엄폐 자리에서 기다림) · 탄약 보급(대기 지점의 차에서 탄약 상자). 실행은 doctrineRun

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
  // ── 부상 (H1) ──
  hurtEv?: number;                            // 마지막으로 다친 기록 — RESPONDER_HURT 의 원인으로 쓴다 (lastBlockEvent 대신)
  hpTick?: number;                            // 이 틱이 시작될 때의 체력 — 대원 문턱의 기준
  lastTile?: number;                          // 마지막으로 서 있던 칸 — 잔해 바닥에 "새로 들어섰는가"
  fellOnce?: boolean;                         // 이 현장에서 잔해 바닥 추락을 이미 겪었다 (대원당 사건당 한 번)
  lightBack?: boolean;                        // 이 현장에서 가벼운 일로 이미 한 번 돌아왔다 (다시 물러나면 다시 돌아오지 않는다)
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
  rules?: ('collapse' | 'gas' | 'water' | 'perch' | 'sightline')[];      // 유형의 규칙에 더해 돌릴 세계 규칙 (예: 가스 폭발 현장 = 붕괴 + 가스, 선박 화재 = 화재 + 표류). (N8) 'perch' = 높은 자리가 있는 현장 — sceneManager 는 보지 않고 N8 의 규칙·crews.isHovering 이 본다. (N9 §5.4) 'sightline' = 사선이 열린 바깥 현장(옥상 총격·수송차 — 무장 용의자의 위험 반경) — 생김새, 단계 8 부터 생성기가 넣는다
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
export type Topic = 'location' | 'nature' | 'injured' | 'count' | 'trapped' | 'hazard' | 'weapon' | 'detail'
  | 'verify' | 'same';      // (N8) 장난 낌새를 확인하는 질문 · 이웃의 열린 사건과 같은 일인가 (묻는 것은 단계 3·10 — 답은 kindsCaller 가 만든다)
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
  | 'DANGER_SIGN' | 'WITHDRAWAL' | 'STRUCT_COLLAPSE' | 'EXPLOSION' | 'BURNOUT'      // (X6) 위험 조짐(막으면 복구) · 전원 철수(다시 들어가면 복구) · 구조물 붕괴 · 폭발(지휘관이 몰랐던 위험이면 HIDDEN_HAZARD) · 건물 전소
  | 'CALL_QUEUE' | 'CALL_MISINFO' | 'CALL_VAGUE' | 'MISJUDGE_TYPE' | 'UNDERESTIMATE' | 'OVERESTIMATE'
  | 'METHOD_FAIL'      // (R2) 대응 방법이 실패해 다른 방법으로 바꿨다 (같은 대상에서 되풀이되면 Problem.times 만 는다)
  | 'NO_UNIT' | 'UNDER_DISPATCH' | 'DIVERTED' | 'ROUTE_BLOCKED' | 'TRAFFIC_DELAY'
  | 'PATH_BLOCKED' | 'VICTIM_MISSED' | 'EQUIP_FAIL' | 'WATER_OUT' | 'RESPONDER_HURT' | 'COMM_FAIL'
  | 'ESCALATION' | 'BACKUP_LATE' | 'SCENE_MISMATCH' | 'SUSPECT_FLED' | 'SECONDARY_COLLISION' | 'LATE_DISCOVERY'
  | 'TIMEOUT' | 'FATIGUE' | 'HIDDEN_HAZARD' | 'RECOUNT' | 'WRONG_ADDRESS' | 'FALSE_ALARM'
  | 'RESPONDER_KILLED'      // (H1) 대원 순직
  | 'SUSPECT_DIED'      // (H1) 용의자 사망
  | 'UTIL_LATE' | 'ANIMAL_LOST'      // (N8) 유관 기관이 오지 못해 대신한 조치로 끝냄 (원격 차단·제수밸브) · 동물을 찻길로 놓침
  | 'DECON_LATE';      // (N9 §5.5) 제독 지연 — 제독차가 오지 못해 대체 제독으로 했다(복구됨) · 노출자가 격리 구역을 벗어나 오염이 번졌다. 단계 1 은 이름표·order 의 자리·PROBLEM_SYS 만 (남기는 것·문장 틀은 단계 6)
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
  // ── 부상과 사망 (H1) ──
  respondersDown?: number; respondersKilled?: number; suspectsHurt?: number; suspectsDead?: number;
  deathCauses?: Partial<Record<InjuryCause, number>>;      // 숨진 구조 대상의 원인 집계
}
/** 추격전: 도주 차량이 도로망을 달리는 동안의 상태 (pursuit.ts) */
export interface Pursuit {
  state: 'driving' | 'stopped' | 'escaped'; kind: 'kidnap' | 'drunk' | 'getaway'
    | 'cartheft';      // (N8) 차량 절도 — 세운 뒤 도보 도주 (단계 6b)
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
  respondersHurt: { name: string; callsign: string; status: string; role?: string;      // role = 역할 이름 (R1)
    rid?: number; band?: number; cause?: InjuryCause | null; dead?: boolean; hospital?: boolean; out?: number }[];      // (H1) 교대 끝의 중증도·주된 원인·순직·병원 인계·다음 교대 결장 예상
  equipFailures: number;
  delayCauses: { code: ProblemCode; label: string; count: number }[];
  incidents: { id: number; code: string; type: IncidentType; name?: string; reportedType: IncidentType | null; label: string; result: IncidentResult; start: number; end: number }[];
  summary: string[];
  major?: number;                  // 대형 사고 건수
  traffic?: { jams: number; closures: number; obstacles: number; detours: number; delaySec: number; gateWaits: number };      // 교통 통계 (traffic.ts)
  disaster?: { name: string; lines: string[] };      // 재난이 있었던 교대의 요약 (disaster.ts)
  air?: AirStats;                  // (R1) 헬기 통계
  respondersKilled?: { name: string; callsign: string; cause: InjuryCause | null; incident: string }[];      // (H1) 순직
  suspectsHurt?: number; suspectsDead?: number;      // (H1)
  roster?: RosterOut[];            // (H1) 교대 끝의 명부 상태 (인근 도시 지원 대원 제외)
  hash: string;
}

/** (G4) 그림용 기록: 무너진 순간 하나. field/ruins.ts 의 recordFall 만 만든다 */
export interface FallRecord {
  t: number; x: number; y: number; r: number; region: number;
  cause: 'zone' | 'secondary' | 'ceiling'      // 마지막 줄에 둔다 — X6 가 끝에 새 줄로 | 'partial' | 'total' 을 덧붙인다
    | 'partial' | 'total';      // (X6) 구획 붕괴(불이 아닌 원인 — 불이면 'ceiling') · 건물 전체 붕괴
}

// ───────────────────────── 대응 방법 (R2) ─────────────────────────
/** 같은 임무를 이루는 여러 방법. 내용(조건·속도·위험·문구)은 field/methods.ts 의 METHOD 표 */
export type MethodId =
  | 'hand' | 'pole' | 'ring' | 'rope' | 'improvise' | 'catch' | 'swim' | 'tend' | 'boat' | 'hoist'   // 수난 구조 (waterRescue · hoist 는 R1 의 공중 임무)
  | 'kick' | 'irons' | 'ram' | 'hydraulic' | 'handClear' | 'toolClear' | 'charge'                      // 문·통로 (force·clear, 이동 중 하위 작업). charge = 폭파 진입 (사용자 결정 2026-11-15 — G5 BreachHow 'charge' 와 같은 이름)
  | 'manual' | 'basic' | 'spread' | 'roof' | 'rapid' | 'haul' | 'tunnel' | 'airbag' | 'shore'          // 구출 (extricate)
  | 'call' | 'listen' | 'line' | 'hail' | 'thermal'                                                     // 수색·탐지 (search)
  | 'interior' | 'defensive' | 'aerial' | 'extinguisher' | 'ventilate'                                  // 화재 (suppress)
  | 'chase' | 'breach' | 'bang' | 'tackle' | 'cover' | 'taser' | 'shield' | 'beanbag' | 'sniper'       // 무장 (engage · arrest)
  | 'stay' | 'rush' | 'airlift'                                                                         // 응급 (treat · 이송 수단)
  | 'seal' | 'ventFirst' | 'cordon' | 'announce'                                                        // 누출 조치·통제 (mitigate · perimeter)
  | 'air' | 'drone' | 'dog'                                                                             // 야외 수색 (기록 전용·7단계)
  | 'dive' | 'boom' | 'shieldLine' | 'deconTent' | 'hoseWash'      // (N9 §5.12) 잠수 · 오일펜스 · 방패 저지선(cordon) · 제독 텐트 · 물 세척(decontam). 단계 1 은 표의 줄만 (can = NOT_YET)
  | 'robotDefuse' | 'suitDefuse' | 'bareDefuse';      // (R3 5단계 §3.7) 해체 defuse: 로봇 원격 · 방호복 · 맨몸 (실행은 doctrineRun.runDefuse)
/** 왜 이 방법을 골랐는가 (기록 문구·보고서 문장이 쓴다). usual = 평소 선택(교본 줄과 무관) */
export type MethodWhy = 'usual' | 'near' | 'noGear' | 'tooFar' | 'weak' | 'fast' | 'failed' | 'broken' | 'danger' | 'quiet' | 'team'      // R3 가 이 줄 끝에 상태 까닭 여섯을 더한다 (R3 §2.1·§3.7)
  | 'hurt' | 'alone' | 'lowAir' | 'lowAmmo' | 'shaken' | 'tired';      // (R3 1단계) 교본 줄이 1등을 바꾼 까닭 (field/doctrine.ts 의 docWhyMethod — §3.7 의 사상 표)
/** 방법을 쓴 기록 한 줄 (보고서는 이것과 Problem 으로만 방법을 말한다). field/methodRun.ts 의 recordMethod·recordAir 만 만든다 */
export interface MethodUse {
  t0: number;                                     // 이 방법을 시작한 시각 (구출 시간 = t − t0)
  t: number; rid: number; unitId: number; work: WorkKind; method: MethodId; why: MethodWhy;
  ok: boolean;                                    // true = 이 방법으로 끝냈다, false = 이 방법을 접었다 (실패·고장·조건 상실)
  cas: number; prop: number; hostile: number; region: number; tile: number;   // 대상 (없으면 -1). 문·잔해 하위 작업은 tile 과 prop = s.propAt[tile], work = 하위 작업의 kind
  missing?: KitId;                                // why === 'noGear' 일 때 빠진 장비 (보고서 '…이 없었음')
  eventId: number;                                // 그때 남긴 기록 (접은 줄이면 그 문제 기록)
}
// (R2) 있는 자료형에 더하는 칸 — 모두 선택 칸이다. 인터페이스 합치기로 여기 한곳에 모았다 (X6 블록·G5 의 Fx.c 와 같은 방식).
// 객체 모양: 생성 리터럴에도 undefined 로 넣었다 — Task 는 executor.makeTask, FieldAgent 는 agents.makeAgent, Casualty 는 kit.addCas 와 hazards 의 주변 시민,
// Hostile 은 kit.addHostile, Scene 은 kit.baseScene, Incident 는 incidents.createIncident, Problem 은 events.raiseProblem.
// TaskKind 의 'ashore'(물 위의 대원이 뭍으로 돌아간다)는 그것을 쓰는 단계 1b 가 넣는다 (TaskKind 줄이 WorkKind 의 끝 줄과 맞닿아 있다 — H1 이 그 끝에 줄을 더한다).
export interface Task {
  method?: MethodId; mwhy?: MethodWhy; missing?: KitId;   // 지금 쓰는 방법, 고른 까닭, (noGear 면) 빠진 장비
  tried?: MethodId[];                             // 이 임무에서 접은 방법 (다시 고르지 않는다. 모두 접었으면 비운다)
  entryDoor?: number;                             // engage: 방 진입에서 잠긴 문을 여는 중인 그 문 id (§4.2a — 단계 2)
  mtry?: number;                                  // 지금 방법을 시도한 횟수 (투척이 빗나간 횟수 등)
  mbad?: number;                                  // 고른 방법의 조건이 맞지 않은 지 몇 초 (3초면 바꾼다)
  mt0?: number;                                   // 지금 방법을 시작한 시각 (MethodUse.t0)
  marr?: boolean;                                 // 도착 재선택을 이미 했다
  mcands?: { m: MethodId; score: number }[];      // 고를 때의 후보와 점수 (패널이 보여 준다)
}
export interface FieldAgent {
  afloat?: 'boat';                                // 보트에 타고 있다 (헤엄은 "선 칸이 물" 로 판단하므로 칸이 없다)
  mrng?: Rng;                                     // 방법 판정 난수 method:<사건>:<rid>:<k> (처음 쓸 때 만든다 — methodRun.mrng)
  mfail?: { k: string; m: MethodId; until: number }[];   // 접은 방법의 기억 (대상 열쇠 targetKey, 그 시각까지 다시 고르지 않는다. 고장은 Infinity)
  msaid?: MethodId[];                             // 이 사건에서 시작을 알린 탐지 방법 (한 번만 알린다)
  wetSince?: number;                              // 물 칸에 들어간 시각 (뭍이면 undefined)
  wetTired?: boolean;                             // 이번에 물에 들어가 '지침' 사고를 이미 겪었다
}
export interface Casualty {
  freedHow?: MethodId; freedBy?: number;          // 어떤 방법으로 누가 구했는가 (보고서 타임라인)
  rush?: boolean;                                 // 구급 대원이 즉시 이송을 정했다
}
export interface CasBelief {                      // perceive 가 본 것 — agents.casFact 가 채운다 (water 는 단계 0 부터, drift 는 1a, veh·pit 는 3, rush 는 6)
  water?: boolean;                                // 물속
  drift?: number;                                 // 떠내려가는 속도 (본 그대로). 단계 1a 가 채운다 — 걸려 멈추는 순간 이 값만 달라져 무전 자료가 한 번 더 오간다(결과가 바뀐다)
  veh?: number;                                   // 갇힌 차량 소품의 id (차 안이 아니면 없음) — 같은 차의 고립자 세기
  pit?: boolean;                                  // 구덩이(맨홀) 아래 — 줄로 끌어올려야 한다
  rush?: boolean;
}
export interface Hostile {
  stunHow?: MethodId;                             // 마지막으로 무력화한 수단 ('bang'·'taser'·'beanbag') — 검거 기록이 쓴다
}
export interface Problem {
  times?: number;                                 // 같은 작업·같은 대상에서 되풀이된 횟수 (METHOD_FAIL 만, 없으면 1)
}
export interface Scene {
  flow?: number;                                  // 물살 (칸/초). field/rules/methods.ts 가 관리한다
  quay?: boolean;                                 // 물가가 높은 안벽이다 (선박 화재의 부두). field/rules/methods.ts 가 처음 한 번 정한다
  fan?: { x: number; y: number; until: number; rid: number; power: number } | null;   // 돌고 있는 송풍기 (power 1, 맨몸 환기 0.5)
}
export interface Incident {
  methods?: MethodUse[];
}
export interface ShiftReport {
  methods?: Partial<Record<MethodId, number>>;    // 이 교대에 성공한 방법별 횟수 (평소 방법 포함)
}

// ───────────────────────── 위험의 현실화 (X6) ─────────────────────────
/** 현장의 위험 상태 (진실). field/catastrophe.ts 만 만들고 바꾼다.
 *  지휘관·대원의 판단부·관제는 읽지 않는다 — 조짐(sign 사실)으로만 안다 */
export interface CatState {
  struct: boolean;              // 구조 규칙을 쓰는 건물 현장인가 (전소·전체 붕괴·지도의 건물 상태도 이 현장만)
  foot: Uint8Array;             // 칸별 (ops.ts 의 footprint(s) 가 처음 생김새로 한 번 계산한 같은 배열):
                                //   0 바깥 · 1 건물 안(실내 칸과 안쪽 벽) · 2 바깥벽·창(바깥과 맞닿은 벽) · 3 층 경계(VOID 와 맞닿은 벽·창 — 어떤 붕괴도 바꾸지 않는다)
  integ: Float32Array;          // 구획(s.regions 번호)별 구조 건전도 1(멀쩡) … 0. 실내 구획만 뜻이 있다
  loss: Float32Array;           // 구획 × 6 원인(LOSS_FIRE · BURN · CREEP · IMPACT · BLAST · QUAKE)의 누적 손실 — 보고서의 원인 문장
  hotT: Float32Array;           // 구획별 '불에 휩싸인'(칸의 30% 이상이 불 0.3 이상) 누적 초 — 원인 문장
  l3Since: Float32Array;        // 구획별 '붕괴 임박'(integ < L3)이 시작된 시각 (-1)
  damage0: Uint8Array;          // 처음(현장 생성 때)의 s.damage 사본 — 사건 중에 무너진 칸만 재산 피해로 센다
  hits: { t: number; x: number; y: number }[];   // 최근의 충격(blast·구획 붕괴·전체 붕괴) 자리 — 가스 점화용.
                                //   통째로 비우지 않고 매초 t ≥ sim.t − 1.2 인 것만 남긴다
  gasN: number; vesselN: number; dustN: number;  // X6 가 일으킨 폭발 수 (종류별 — 기록 수와 견준다. 폭발물은 세지 않는다)
  fallen: Uint8Array;           // 구획별 무너짐 (1)
  bldg: number;                 // 건물 전체 건전도 (서 있는 구획의 칸 수 가중 평균, 무너진 구획은 0 으로 센다)
  bldgL3Since: number;
  gas: Float32Array | null;     // 칸별 가연성 가스 (1 = 폭발 하한 LEL). 밸브가 있는 현장만 만든다
  gasTmp: Float32Array | null;
  cloudSince: number;           // LEL 구름(N ≥ 3)이 생겨 이어진 시작 시각 (-1) — 스파크의 나이 항
  fuelMask: Uint8Array;         // catOf 때 건물 칸(foot ≥ 1)이고 연료가 있던 칸 (1) — 전소 비율의 분모·분자를 이 칸으로만 센다
  fuel0: number;                // fuelMask 의 칸 수 (30 미만이면 전소 판정을 하지 않는다)
  burntAt: number;              // 전소 판정 시각 (-1)
  totalAt: number;              // 전체 붕괴 시각 (-1)
  lastFall: { t: number; x: number; y: number; region: number } | null;
  events: number;               // 붕괴·폭발이 일어난 수 (소리 사실의 번호)
  shakeSeen: number;            // 반영한 지진 흔들림 수 (sim.disaster.shakes 의 길이). 처음 값은 catOf 를 만들 때의 길이
                                //   (안 그러면 본진 뒤에 생긴 현장이 지난 흔들림을 한꺼번에 소급해 받는다)
  shored: number[];             // 보강을 이미 반영한 균열 id
  limitBonus: number;           // 세계 쪽 한계 시간 보탬(붕괴마다). 지휘 쪽 보탬은 OpsState.limitBonus — 7번 블록이 둘을 합친다
  dustRegion: number; dustDone: boolean;   // 분진이 쌓인 구획 (-1)과 이미 터졌는가 (선택)
  flashed: number[];            // 플래시오버가 난 구획 (선택)
  utilityAt: number;            // 도시가스 공급이 끊길 시각 (-1 아직 요청 없음, -2 이미 끊김)
  causeEv: Int32Array;          // 구획별 손실을 가장 크게 만든 마지막 기록 (붕괴 기록의 causes)
}
/** 지휘 상태: 전술 모드와 진입 금지 구역. 지휘관이 정하고 모두가 읽는다 (s.entryOrdered 와 같은 자격 — 조직이 아는 것) */
export interface OpsState {
  mode: 'interior' | 'withdraw' | 'defensive' | 'rubble';
  since: number; reason: string; ev: number;     // 마지막 전환 시각 · 까닭 · 기록
  zones: NoGoZone[];
  parAt: number; parAsked: number[]; parOk: number[]; parTries: number;   // 인원 점검 (parAsked 에는 명령 때 active 인 대원만)
  parDue: number;                                // 인원 점검 시한 (parAt + 70). 이 시각까지만 'withdraw' 가 종료를 막는다
  burnSince: Record<number, number>;             // 지휘관의 기억: 구역별로 센 불(믿음 ≥ 0.5)을 처음 본 시각 (0.3 아래로 내려가면 지운다)
  everHot: number[];                             // 한 번이라도 burnSince 에 들어간 구역 (지우지 않는다 — 외부 확인 종료가 쓴다)
  quietSince: number;                            // 마지막으로 위험 단계가 오른 뒤 조용해진 시각
  calmSince: Record<string, number>;             // DANGER_SIGN 키별로 조짐이 1 이하로 가라앉은 시각
  utilityAsked: number;                          // 도시가스 차단을 요청한 시각 (-1)
  concluded: boolean;                            // 외부 확인 종료를 결정했다
  reentries: number;
  rubble: number[];                              // 무너진 뒤 잔해 수색을 허락한 구역
  entry: Record<string, { until: number; n: number; last: number }>;   // 구역 키별 제한적 구조 진입: 끝 시각 · 횟수 · 마지막 시각
  gated: number;                                 // 지난 계획 주기에 문(registerGate)이 막은 want 수 — 0 보다 크면 종료를 막는다
  noExt: number[];                               // 외부 방수 자리를 두 번 찾지 못한 구역 — 외부 방수를 다시 내지 않는다
  cleared: Record<string, number>;               // 해제한 구역 키 → 해제 때 그 조짐 사실의 시각. 그 뒤의 새 사실로만 다시 올린다
  limitBonus: number;                            // 지휘 쪽 한계 시간 보탬 (외부 방어로 처음 바꿀 때 +150)
}
export interface NoGoZone {
  key: string;                                   // 'struct:3' · 'gas:5' · 'vessel:12' · 'bldg' · 'fire:4' · 'dust:2'
  kind: 'struct' | 'gas' | 'vessel' | 'fire' | 'bldg' | 'dust';
  level: 2 | 3;                                  // 2 = 새 진입 금지(허락된 일만) · 3 = 전원 철수
  regions: number[]; x: number; y: number; r: number;   // 구역 목록과 원 (r = 0 이면 원 없음)
  since: number; why: string; ev: number;
}
/** 조짐 사실(sign)의 값 */
export interface SignBelief {
  kind: 'struct' | 'bldg' | 'gas' | 'vessel' | 'fire' | 'dust' | 'event';
  level: number;                                 // 0 없음 · 1 조짐 · 2 위험 · 3 임박 (event 는 3)
  region: number; x: number; y: number;
  lel?: number;                                  // 가스: 측정값 (% LEL, 5 단위). 냄새로만 안 것은 없음
  prop?: number;                                 // 용기 id
  what?: 'partial' | 'total' | 'gas' | 'vessel' | 'dust' | 'burnout' | 'flashover'
    | 'utility';                                 // event 의 종류. 'utility' = 도시가스사의 공급 차단 완료 통보 (level 0, id 5001)
  down?: boolean;                                // 확인된 하향: 앞 단계를 알아챌 수 있는 감각 범위 안에서 그 단계가 사라진 것을 본 보고.
                                                 //   믿음을 합칠 때 단계가 내려가는 사실은 이것이 참일 때만 덮는다
}
/** 지도에 남는 건물 상태 (이 교대 동안). Sim.placeMarks */
export interface PlaceMark { placeId: number; state: 'scorched' | 'blasted' | 'partial' | 'burnt' | 'collapsed'; t: number; incidentId: number; burnFrac: number; ruinFrac: number }

// (X6) 있는 자료형에 더하는 칸 — 모두 선택 칸이다. 인터페이스 합치기로 여기 한곳에 모았다 (G5 의 Fx.c 와 같은 방식. 뜻은 각 인터페이스의 끝에 붙인 것과 같다).
// 객체 모양: 그 칸을 쓰기 시작하는 단계가 생성 리터럴에도 undefined 로 넣는다 — Scene·Prop 은 kit.ts(baseScene·PROP_BLANK), FieldAgent 는 agents.makeAgent 에 넣었다.
// WorkItem.risky(commander.want 의 리터럴)·Incident.fieldRisk(incidents.createIncident 의 리터럴)는 그 칸을 쓰기 시작하는 단계 5 가 넣는다.
export interface Scene {
  cat?: CatState;
  ops?: OpsState;
}
export interface Prop {
  vessel?: 'cylinder' | 'drum' | 'cng' | 'jet'    // 열을 받으면 터지는 용기. gas 소품은 없으면 cylinder (catOf 가 처음 한 번 적는다)
    | 'tank';      // (N9 §5.12) 탱크로리의 탱크 — 단계 1 은 이름만 (VESSEL_HEAT 의 값·이름은 그것을 놓는 단계 6)
  heatLoad?: number;                               // 용기가 받은 열 0..1 (1 이면 터진다)
  heatK?: number;                                  // 용기마다 다른 열 배율 (0.8~1.25, 처음 볼 때 정한다)
}
export interface MateBelief {
  trapped?: boolean;                               // 깔린 동료 (mate 사실의 값 — 본 사람이 알린다)
}
export interface FieldAgent {
  trapped?: number;                                // 잔해에 깔린 대원의 남은 구출 작업량 (없거나 0 = 깔리지 않음)
  trapEv?: number;                                 // 깔리게 한 붕괴 기록 (agentHealth 의 쓰러짐 기록 causes)
  avoid?: { regions: number[]; x: number; y: number; r: number; until: number };   // 조짐을 보고 물러난 대원이 한동안 피하는 곳
  opsSeen?: number;                                // 마지막으로 따른 철수 명령의 시각 (기록 중복 방지)
  signObs?: Record<number, number>;                // 조짐 사실 id → 이 대원이 자기 감각으로 마지막에 관찰한 단계 (전달받은 믿음과 견주지 않는다)
  extSeen?: { hot: Float32Array; cov: Float32Array; cov0: Float32Array };   // 벽 너머 외부 관찰의 기억 (perceive 의 throughWalls 갈래가 쓴다):
                                                   //   구획별 마지막으로 불 ≥ 0.25 를 본 시각 · 마지막으로 관찰 범위에 든 시각 · 처음 범위에 든 시각 (-1)
}
export interface WorkItem {
  risky?: boolean;                                 // 제한적 구조 진입 — 건강한 소방 대원만 맡는다
}
export interface Incident {
  fieldRisk?: { sev: number; risks: string[] };    // 현장 상황 보고(sitrep)로 관제가 올린 위험도와 위험 문자열 — assess 가 다시 평가할 때 합친다
}
export interface IncidentResult {
  catastrophe?: { burnout: boolean; total: boolean; partial: number; explosions: number; withdrew: boolean; averted: number; crewCaught: number;
    hazard?: boolean };      // (단계 7) hazard = 판정에서 위험이 남았는가 (외부 확인 종료의 정확도를 잰다 — 측정 줄 ext-close 의 wrong)
}
export interface ShiftReport {
  catastrophe?: { burnouts: number; totals: number; partials: number; explosions: number; withdrawals: number; averted: number; crewCaught: number };
  placeMarks?: PlaceMark[];
}

// ───────────────────────── 인과 기록 (I1-b 0단계 — 기록만 잇는다) ─────────────────────────
// 있는 자료형에 더하는 칸 — 모두 선택 칸이다(X6 와 같은 인터페이스 합치기). 시뮬레이션의 판단은 이 칸들을 읽지 않는다:
// 기록(causes)·보고서·측정 도구(scripts/metrics.ts)만 읽는다. 그래서 채워도 결과(logHash)가 바뀌지 않는다 (docs/specs/I1-causality.md §3.11 0단계).
// 객체 모양: Incident 의 네 칸은 incidents.createIncident 의 리터럴에, Problem.ref 는 events.raiseProblem·debrief.addProblem·agents 의 LATE_DISCOVERY 리터럴에 undefined 로 넣었다.
export interface Incident {
  cause?: number;              // 이 사건을 낳은 기록 (발생 기록의 causes 에 들어간다) — 재범·도주 차량·은신처는 SUSPECT_FLED, 방화는 앞 불의 마지막 기록, 재난 사건은 마지막 재난 알림
  csq?: string;                // 이 사건을 만든 연쇄 ('reoffend' · 'getaway' · 'hideout' · 'arson'). I1-b b3 부터 인과 규칙의 id 도 여기에 ('blastSpread' …)
  blockedBy?: number[];        // 수요를 막은 사건들 (NO_UNIT 때 그 능력의 부대를 잡고 있던 사건, 처음 막힌 차례부터 쌓는다)
  blockEv?: number;            // 이 사건이 도로를 막을 때 남긴 통제 기록 (교통사고 전면 통제·쓰러진 나무·다중 추돌·산사태). 다른 사건의 ROUTE_BLOCKED 가 원인으로 가리킨다
}
export interface Problem {
  ref?: { inc?: number; unit?: number; edge?: number; fac?: number; lost?: number };    // 관련 사건·부대·구간·병원, 늘어난 초 (lost 는 b3-1 의 C6 이 채운다)
}

// ───────────────────────── 대응 교본 (R3 0단계 — 틀) ─────────────────────────
// 교본 줄(field/doctrine/*.ts)이 쓰는 자료형과, 있는 자료형에 더하는 선택 칸 (docs/specs/R3-doctrine.md §2.1). 0단계는 틀만이다 — 줄이 없어 아무것도 이 칸을 채우지 않는다.
// 합집합(FactType 'crew' · TaskKind 'cover'·'rearm'·'airOut'·'pairOut'·'pair' · WorkKind 'triage' · MethodId 열 개 · MethodWhy 여섯)은 그것을 쓰는 단계가 그 줄 끝에 새 줄로 더한다.
// 객체 모양: FieldAgent 는 agents.makeAgent, Task 는 executor.makeTask, Unit 은 resources 의 두 리터럴, Scene 은 kit.baseScene, Incident 는 incidents.createIncident 에 같은 순서로 넣었다.
/** 교본 표의 분야. 부대 분야(UnitField)와 다르다 — 사다리차는 부대 분야가 소방이지만 교본은 특수 표에 있다 (§2.2) */
export type DocDept = 'common' | 'police' | 'fire' | 'ems' | 'special';
/** 교본이 걸리는 자리 (§2.3) */
export type DocHook = 'fit' | 'duty' | 'act' | 'method' | 'gate' | 'cmd' | 'dispatch' | 'chase';
/** 교본이 내는 상태 행동 (같은 이름의 TaskKind 로 실행한다 — 그 행동을 쓰는 단계가 TaskKind 에 더한다) */
export type DocActId = 'airOut' | 'pairOut' | 'cover' | 'rearm' | 'pair';
/** 실행기가 교본에 묻는 판단 지점 (§2.3 ④) */
export type DocGateId = 'interiorEntry' | 'roomEntry' | 'breach' | 'closeIn' | 'coverFire' | 'bangUse' | 'carryHold' | 'carryStart' | 'laneTreat'
  | 'forceDoor';      // (R3 5단계 S03) 진입 결정 전 무장 현장의 잠긴 문을 열려는 걸음 (executor.moveTo 의 문 강제 개방 하위 작업 앞)
/** 교본 행동의 까닭 — 보고서·패널의 말 (§7.3 의 WHY_DOC) */
export type DocWhy = 'alone' | 'buddy' | 'outside' | 'hurt' | 'tired' | 'shaken' | 'lowAir' | 'lowAmmo' | 'noKit' | 'kit' | 'civ' | 'hostage' | 'danger' | 'triage' | 'backup' | 'protocol' | 'team';
/** 대원 자신의 몸 상태 신고 ('crew' 사실의 값 — 1단계). 지휘관·동료는 남의 몸을 이것으로만 안다 (§2.4) */
export interface CrewBelief {
  band: number;          // 신고한 중증도 0~2 (중상 문턱에 간격이 있다 — §4)
  air: 0 | 1 | 2;        // 공기: 0 넉넉함(≥ AIR_IN) · 1 낮음 · 2 위급(< AIR_OUT). scba 가 없으면 0
  ammo: 0 | 1 | 2;       // 탄: 0 넉넉함 · 1 마지막 탄창 · 2 위급(발사 2회 이하) 또는 0. 총이 없으면 0
  shaken: boolean;       // 동요 중
  t: number;
}
/** 교본을 쓴 기록 한 줄 (보고서·측정은 이것으로만 교본을 말한다). field/doctrineRun.ts 의 recordDoc 만 만든다 */
export interface DocUse {
  t: number; t1: number;               // 시작·끝 (기다림처럼 길이가 있는 것. 한 순간이면 t1 = t)
  rid: number; unitId: number; rule: string; hook: DocHook;
  act?: DocActId; gate?: DocGateId; method?: MethodId; work?: WorkKind;
  mate: number;                        // 짝·함께한 대원 rid (없으면 -1)
  tgt: string;                         // 대상 열쇠 (R2 targetKey 와 같은 모양, 없으면 '')
  eventId: number;                     // 그때 남긴 기록 (기록 없이 센 것은 -1)
  say: boolean;                        // 보고서 문장 후보인가 (§7.3)
}
export interface KitItem {
  mag?: number;                        // 총기: 지금 탄창에 남은 탄 (uses 는 가진 탄 전부 — 탄창 포함). 2단계가 명부에서 채운다
}
export interface FieldAgent {
  buddy?: number;                                              // 짝의 rid (-1 = 짝 없음). makeAgent 는 -1, 부대가 내린 뒤 pairUp 이 맺는다 (3단계)
  doc?: { rule: string; act: DocActId; since: number } | null; // 지금 따르는 교본 행동 (패널·계속 점수)
  docMem?: { rule: string; key: string; until: number }[];     // 교본 기억: key 'w:<작업 id>' = 그 작업을 그때까지 맡지 않는다 · 그 밖(대상 열쇠) = 그 줄을 그 대상에 다시 걸지 않는다
  shaken?: number;                                             // 동요가 끝나는 시각 (없거나 지났으면 동요 아님)
  shakenOff?: number;                                          // 동요가 끝난 시각 — 10초 동안 다시 동요하지 않는다
  reloadUntil?: number;                                        // 재장전이 끝나는 시각 (그 전에는 쏘지 않는다)
  crewSig?: string;                                            // 마지막으로 신고한 몸 상태의 서명 (doctrine.crewSigOf — 같은 신고를 되풀이하지 않는다)
}
export interface Task {
  docRule?: string;                    // 이 임무를 연(또는 막고 있는) 교본 줄
  gateAt?: number;                     // 판단 지점에서 막히기 시작한 시각 (-1 = 막히지 않음)
  gateId?: DocGateId;                  // 막고 있는 판단 지점
  gateSaid?: boolean;                  // 막힘을 이미 알렸다 (한 번만)
  cvX?: number; cvY?: number;          // 고른 엄폐 자리 (§2.10 — 다시 고르는 조건이 될 때까지 그대로. 못 찾았으면 NaN)
  cvTx?: number; cvTy?: number; cvLost?: number;   // 고를 때의 위협 믿음 위치, 시야를 잃은 시각 (-1)
}
export interface Unit {
  ammoBox?: number; ammoBoxMax?: number;   // 차에 실은 탄약 상자 (한 상자 = 한 사람의 총기를 가득 채움) — 2단계
  sparePump?: number;                      // 남은 예비 펌프 (지금은 무제한 — 3단계 F10)
}
export interface Scene {
  triageAt?: number;                   // 분류가 끝난 시각 (-1 = 아직). 지휘 상태 — s.secureAt 과 같은 자격 (4단계)
  laneShield?: number[] | null;        // 차량으로 막은 통제 지점 (6단계 blockLane)
}
export interface Incident {
  docs?: DocUse[];                     // 교본을 쓴 기록 (처음 남길 때 배열이 된다 — doctrineRun.recordDoc)
  trackBy?: 'air' | 'ground' | null;   // 추격전: 지금 차를 보고 있는 쪽 (2단계 — 공개 정보)
  reportedPrev?: number;               // 그 전에 알려진 교차로 (값이 바뀔 때만 적는다 — 2단계)
  reportedNodeAt?: number;             // 알려진 위치가 마지막으로 보고된 시각 (2단계)
}
export interface ShiftReport {
  doctrine?: Record<string, number>;                     // 이 교대에 교본 줄이 쓰인 횟수 (번호별 — 1단계 buildReport)
  docSplit?: Record<string, Record<string, number>>;     // '분야|국면|임무' → (고른 것 → 횟수) (1단계)
}

// ───────────────────────── 교대 간 지속 (I2 — sim/persist.ts) ─────────────────────────
// docs/specs/I2-persistence.md §2.1. 있는 자료형에 더하는 칸은 모두 선택 칸이다(X6·R3 와 같은 인터페이스 합치기). Responder.status 의 'off' 는 그 합집합 끝에 새 줄로 넣었다.
// 객체 모양: Responder 의 네 칸은 resources.createRoster·createAidUnit 의 대원 리터럴에, Unit 의 세 칸은 두 부대 리터럴에 같은 순서로 넣었다
// (pumpFails 는 0). Scene.wear 는 그 칸을 쓰기 시작하는 단계 5 가 field/sceneManager.createScene 에 넣는다.
// (I1-b 의 WorldTag 에 'carry' 를 더하는 것은 WorldTag 가 생긴 뒤 — 지금은 WorldTag·SimEvent.tag 가 없다. 설계서 끝 "구현 메모"의 이어받을 자리)
/**
 * 다음 교대가 이어받는 상태 — Sim 생성자의 입력(extra.carry). 회복·수리·보충을 이미 반영한 "다음 교대가 시작할 때의 상태"다.
 * JSON 으로 저장·복원할 수 있는 꼴만 쓴다: Map·Set·typed array·Infinity·NaN·undefined 값을 넣지 않는다(선택 칸은 아예 빼 둔다).
 * 판(v)이 다르면 persist.readCarryover 가 옮기거나(옮기는 함수가 있을 때) 읽지 않는다.
 */
export interface Carryover {
  v: 1;
  shift: number;                         // 이 상태로 시작하는 교대가 조직의 몇 번째 교대인가 (새 조직의 첫 교대 = 1 이고 그 교대가 만든 상태 = 2)
  city: string;                          // 도시 지문 (persist.cityKey). 지금 도시와 다르면 places·roads 를 버린다
  from: { seed: string; hash: string; diff: string };    // 이 상태를 만든 교대 (화면·검증용. 결과에 쓰지 않고 지문에도 넣지 않는다)
  crew: CrewCarry[];
  units: UnitCarry[];
  stock: Partial<Record<StockId, number>>;               // 서(署) 창고에 남은 소모품 — 이번 교대에 지급하고 남는 것까지 포함한 수
  places: PlaceCarry[];
  roads: RoadCarry[];
}
export type StockId = 'flashbang';
/** 대원 한 사람. 열쇠는 자리(seat ?? name) — 명부에서 이름은 모두 다르다 */
export interface CrewCarry {
  name: string;                          // 이 사람의 이름
  seat?: string;                         // 신임 대원만: 이 사람이 앉은 명부 자리의 원래 이름 (없으면 name 이 자리)
  callsign: string;                      // 만들 때의 소속 (화면용 — 열쇠가 아니다)
  out: number;                           // 앞으로 빠지는 교대 수, 이번 교대 포함 (0 = 나온다 · -1 = 순직)
  cause: string | null;                  // 결장 이유 — H1 의 InjuryCause
  health: number;                        // 이번 교대를 시작할 때의 체력 (결장 중이면 돌아올 때의 체력)
  dExp: number; dSkill: number;          // 기본 능력(조직 시드)에 더한 경험·숙련. 누적 (상한 EXP_CAP · SKILL_CAP)
  shifts: number; incidents: number;     // 경력: 나온 교대 수, 다룬 사건 수 (화면·문장)
  replaceIn?: number;                    // out === -1 일 때: 신임 대원이 이 자리에 오기까지 남은 교대
  recruit?: RecruitBase;                 // 신임 대원: 조직 시드에 없는 사람의 기본 능력
  kitFault?: string[];                   // 점검에서 드러나지 않아 이번 교대에도 고장인 개인 장비 (KitId)
}
export interface RecruitBase { skill: number; judgment: number; composure: number; fitness: number; teamwork: number; experience: number }
/** 부대 하나. 열쇠는 호출부호 (편성표 UNIT_DEFS 에서 모두 다르다). 인근 도시 지원 부대는 넣지 않는다 */
export interface UnitCarry {
  callsign: string;
  pump?: number;                         // 소방 부대: 펌프 상태 0..1 (적용할 때 장비 손잡이의 범위 pumpMin..pumpMax 로 자른다)
  service?: { readyAt: number; why: 'pump' | 'vehicle' };    // 정비 중: 교대 시작 뒤 readyAt 초까지 'oos'
}
/** 건물 한 채의 남은 피해. 열쇠는 Place.id (도시가 고정이라 열쇠가 된다 — city 지문으로 확인) */
export interface PlaceCarry {
  id: number;
  state: 'marked' | 'closed' | 'ruin';   // 흔적만 남음(사용) · 출입 통제(복구 공사) · 무너짐. 열린 터(q.open)는 marked 만 (§3.6)
  dmg: number; soot: number;             // 구조 손상 0..1 · 그을음 0..1
  repair: number;                        // closed·ruin 이 풀리기까지 남은 교대, 이번 교대 포함 (marked 면 0)
  cause: 'fire' | 'collapse' | 'blast' | 'burnout';
  inc: string;                           // 원인 사건 ("조직 3번째 교대 · 04 화재") — 문장용
  since: number;                         // 생긴 교대
  spot?: [number, number];               // 무너진 자리의 건물 안 상대 위치 0..1 (그림용 — G4 의 u·v)
  mark?: 'scorched' | 'blasted' | 'partial' | 'burnt' | 'collapsed';   // 이 상태를 만든 X6 의 건물 상태 (그림용 — X6 가 없으면 빼 둔다)
  opened?: true;                         // 이번 교대를 앞두고 출입 통제가 풀렸다 (문장용, 한 번만)
}
/** 도로 한 구간의 복구 공사. 열쇠는 RoadEdge.id */
export interface RoadCarry {
  edge: number;
  why: 'crack' | 'washout' | 'flood' | 'fire' | 'mud' | 'tree' | 'debris' | 'surface';
  lane: boolean;                         // true = 한 차로 공사(느려질 뿐 — slow), false = 전면 통제(closed)
  left: number;                          // 남은 교대, 이번 교대 포함 (1 = 이번 교대 안에 openAt 에 끝난다, 2 = 이번 교대 내내)
  openAt: number;                        // left === 1 일 때 끝나는 시각 (교대 시작 뒤 초, 60..900)
  inc: string; since: number;
}
/** 화면·보고서용 요약 (persist.carrySummary) */
export interface CarrySummary { shift: number; absent: number; fallen: number; service: number; marked: number; closed: number; ruin: number; roads: number; grown: number }
export interface Responder {
  seat?: string;                           // 신임 대원이 앉은 명부 자리 (persist 가 채운다)
  relief?: boolean;                        // 본부 예비 인력 (이번 교대만 — 이어받지 않는다)
  carryOut?: number;                       // status 'off' 일 때 남은 결장 교대 (-1 = 공석)
  carryCause?: string | null;              // status 'off' 일 때 결장 이유
}
export interface Unit {
  readyAt?: number;                        // 정비 중인 부대가 운용에 들어가는 시각 (persist.tickCarry 가 본다)
  oosWhy?: string;                         // 'oos' 의 이유 (화면용: '정비 중' · '결원')
  pumpFails?: number;                      // 이번 교대에 펌프가 고장 난 횟수 (executor 의 펌프 고장 자리가 센다 — 단계 3. 결과에 쓰지 않는다)
}
export interface Scene {
  wear?: { dmg: number; soot: number; cause: string; inc: string; pre: number };      // 이어받은 건물 상태 (persist.applyPlaceWear 가 현장을 만든 직후 채운다 — 단계 5. pre = 처음부터 탄 칸으로 둔 수)
}
export interface ShiftReport {
  carry?: { shift: number; key: string; lines: string[] };   // 이어받은 상태와 그 영향 — 이어받은 상태로 시작한 교대만 (단계 7)
  carryNext?: CarrySummary;                                  // 다음 교대로 넘기는 것 (단계 7)
}

// ───────────────────────── 사건 종류 다양화 (N8 단계 2a — 자료형만) ─────────────────────────
// docs/specs/N8-incident-kinds.md §5.8. 새 진실의 자리는 Scene.kinds·Scene.animals·소품의 live·sub·용의자의 hideUntil·asleep·구조 대상의 quietLoss·Incident.dupOf 다 —
// 판단 파일(commander·brain 판단부·orders/*·dispatch/analyst·dispatcher·screening·methods·airDecide·doctrine/kinds)은 읽지 않는다 (tests/kinds.test.ts 시험 4).
// 단계 2a 에는 아무도 채우지 않는다(N8 의 현장이 없다) — 그래서 결과가 바뀌지 않는다. 객체 모양: Scene 은 kit.baseScene·sceneManager.createScene,
// Prop 은 kit.PROP_BLANK, Casualty 는 kit.addCas·hazards 의 주변 시민 리터럴, Hostile 은 kit.addHostile, Incident 는 incidents.createIncident,
// WorkItem 은 commander.want 의 리터럴에 같은 순서로 넣는다 (CLAUDE.md "자주 도는 객체의 모양").
// 합집합에 더한 줄(같은 파일 위쪽, 각 줄 끝에 새 줄로): FactType 'ani' · InjuryCause 'animal' · T.LEDGE · Region.kind 넷 · WorkKind 다섯 · Scene.rules 'perch'
// · Topic 'verify'·'same' · ProblemCode 'UTIL_LATE'·'ANIMAL_LOST' · Pursuit.kind 'cartheft'. 새 유형·부대·역할·장비·분야('civil')·수요 열쇠는 단계 2b 와 4a~8.
/** 동물 (사람이 아니다 — s.hostiles 에 넣지 않는다). 만드는 곳은 kindsKit.addAnimal 하나, 모든 칸을 채운다 (단계 5) */
export interface Animal {
  id: number; kind: 'boar' | 'dog' | 'cow' | 'pig'; label: string;
  x: number; y: number; px: number; py: number; facing: number;
  path: number[] | null; pathI: number;
  state: 'roam' | 'alert' | 'flee' | 'charge' | 'hide' | 'sedated' | 'caught' | 'gone';
  agit: number;                 // 흥분 0..1
  sedate: number;               // 맞은 마취의 진행 0..1 (1 이 되면 sedated)
  via: 'wild' | 'road' | null;  // gone 일 때 나간 출구의 종류
  bull: boolean;                // 돌진하는 황소 (escape) — 늘 채운다
}
/** 'ani' 사실의 값 — 본 대원의 믿음 */
export interface AniBelief { kind: Animal['kind']; x: number; y: number; state: 'loose' | 'sedated' | 'caught' | 'gone'; via?: 'wild' | 'road' }
/** Scene.kinds — 진실 (판단 파일은 읽지 않는다). 시나리오가 쓰는 칸만 채우고 나머지는 undefined */
export interface KindsState {
  told?: boolean; remoteAt?: number;              // 전선: 차 안 사람이 "내리지 말라"를 들었다 · 원격 차단 시각
  flood?: number;                                 // 수도관: 지하 침수 0..1
  headInjury?: boolean;                           // 주취자: 머리 부상
  arriveAt?: number; expectHidden?: boolean;      // 잠복: 수거책이 들어올 시각 · 날치기: 처음부터 숨겨 둔 용의자
  crisis?: number; stage?: number; drop?: number; // 위기자: 위기 정도 · 단계 · 떨어지면 닿는 칸
  key?: number;                                   // 문 잠긴 집: 열쇠가 오는 시각
  perch?: { cas: number; x: number; y: number; h: number; ground: number; top: number }[];   // 높은 자리 (§5.11 — h 높이 단계 1~3, ground 사다리를 펴는 땅 칸, top 하강을 시작하는 위쪽 칸)
  depth?: number; badAir?: boolean;               // 구덩이: 깊이 · 나쁜 공기
  power?: number;                                 // 놀이기구: 전원이 돌아올 시각 (돌아오지 않으면 Infinity)
  agitated?: number;                              // 약물 과다: 흥분이 끝나는 시각
  birthAt?: number; coached?: boolean;            // 출산: 시각 · 신고자 안내를 따랐다
}
export interface Scene {
  animals?: Animal[];                             // 동물 현장만 배열 (그 밖은 undefined)
  exitKind?: ('road' | 'wild')[];                 // s.exits 와 같은 순서 — 동물이 나가면 찻길 / 산·들 (생김새라 판단부도 읽는다)
  kinds?: KindsState;                             // N8 시나리오의 진실
}
export interface Prop {
  live?: boolean;                                 // fixture: 살아 있는 시설물 (전선·관·구멍·간판·벌집 …) — 진실
  sub?: string;                                   // fixture: 진실의 갈래 (관의 물·가스, 우물의 좁음). 믿음에는 다른 이름의 칸(haz 의 pipe·crack·narrow)으로 옮겨 적는다
}
export interface Casualty {
  quietLoss?: boolean;                            // 보호 유형에서 숨지는 단 하나의 길 (§5.13 — 그리지 않고 기록 한 줄). lost 를 다시 쓰지 않는다
}
export interface Hostile {
  group?: 'A' | 'B';                              // 폭행 시비의 두 무리
  hideUntil?: number;                             // 날치기: 숨은 자리에서 나갈 시각
  asleep?: boolean;                               // 잠든 취객 (state 는 'hold' 그대로)
}
export interface CasBelief {
  perch?: number;                                 // 높은 자리의 높이 단계 (0 또는 없음 = 높은 자리가 아니다)
  stage?: number;                                 // 위기자 설득의 단계 (설득하는 대원이 본 정수)
}
export interface WorkItem {
  animal?: number;                                // 대상 동물의 id (없으면 -1) — 임무 capture. commander.want·orders/injury 의 PROBE 리터럴은 늘 -1 로 채운다(객체 모양).
                                                  // 설계서(§5.8)는 필수 칸이지만, 앞 묶음(X6·R2·R3·I1-b·I2)이 합쳐지기 전에 들어가는 준비 단계라 선택 칸으로 둔다 —
                                                  // 필수면 그 묶음들이 새로 쓰는 작업 항목 리터럴(시험의 work() 도우미 등)이 모두 tsc 에 걸린다. 읽을 때는 (w.animal ?? -1)
}
export interface Incident {
  dupOf?: number;                                 // 중복 신고 오인: 원 사건의 id — 진실 (접수 AI·관제는 읽지 않는다 — 단계 10)
}

// ───────────────────────── 사건 종류 다양화 (N8 단계 2b — 새 부대의 자리) ─────────────────────────
// docs/specs/N8-incident-kinds.md §5.3. 새 수요 열쇠 다섯 — 서로 바꿔 쓸 수 없어 따로 둔다(하나로 묶으면 능력만 보고 고르는 recomputeUnmet 이
// 가스 사고에 전력 복구반을 보낸다). 단계 2b 에는 이 열쇠를 내는 곳이 없고 그 능력의 부대도 편성되지 않는다(UNIT_DEFS 의 minLevel 6) — 결과가 바뀌지 않는다.
// 열쇠 하나가 지나는 자리: resources.caps()·AID_KIND/AID_CALL · analyst.NEED_NAME·emptyNeeds · dispatcher.ORDER(끝)·MINCAP·NEED_LABEL ·
// commander.request 의 이름표·NEED_MIN·needFor · scripts/metrics.ts NEED_KEYS (빠뜨리면 복구반만 기다리는 사건이 '잊힌 사건'으로 잡힌다)
export interface UnitCaps { utilPower: number; utilGas: number; utilWater: number; tow: number; capture: number }      // 전력 복구 · 가스 복구 · 수도 복구 · 견인 · 동물 포획
export interface Needs { utilPower: number; utilGas: number; utilWater: number; tow: number; capture: number }

// ───────────────────────── 사건 종류 다양화 ② 큰 사건·새 장소 (N9 단계 1 — 자료형만) ─────────────────────────
// docs/specs/N9-major-kinds.md §5.4~§5.7·§5.10·§5.14·§5.16. 새 진실의 자리는 Scene.kinds2(Kinds2State)와 용의자의 crowdRole·dispersed 다 —
// 판단 파일(commander·brain 판단부·orders/*·dispatch/analyst·dispatcher·screening·methods·airDecide·doctrine/kinds2)은 읽지 않는다
// (tests/kinds2.test.ts 시험 4 — 글자 .kinds2·kinds2?·.contamIds·.underIds·.deconned·crowdRole·dispersed …). 믿음에 옮겨 적을 때는 진실 칸과 다른 이름
// (CasBelief.dirty·sunk, HosBelief.tag·threw). 생김새(누구나 본다 — 판단부도 읽는다): Scene.windDir·Scene.flowSpots·s.rules 의 'sightline'.
// 단계 1 에는 아무도 채우지 않는다(N9 의 현장이 없다) — 그래서 결과가 바뀌지 않는다. 객체 모양: Scene 은 kit.baseScene, Hostile 은 kit.addHostile 의 리터럴 끝에 undefined 로 넣었다.
// 합집합에 더한 줄(같은 파일 위쪽): PlaceKind 셋 · WorkKind 'decontam' · ProblemCode 'DECON_LATE' · MethodId 다섯 · Scene.rules 'sightline' · Prop.vessel 'tank'.
// 새 유형(crowd — 단계 4)·부대·역할·장비·수요 열쇠(decon — 단계 2)는 뒤 단계.
/** 생김새: 군중 현장의 흐름 자리 — 이 칸에 서면 from 구역에서 into 구역으로 가는 흐름을 막는다 (계단·통로 입구·가운데 띠의 가장자리). 판단부도 읽는다 */
export interface FlowSpot { tile: number; into: number; from: number }      // tile = 격자 칸 번호, into·from = 현장 구역 id (-1 = 현장 밖)
/** 진실: 군중 구역 하나의 사람 수와 흐름 (s.kinds2.crowd.zones) */
export interface CrowdZone {
  region: number;                                 // 현장 구역 id (배치는 s.regions·s.flowSpots — 생김새)
  count: number; cap: number; press: number;      // 사람 수 · 편히 설 수 있는 수 · count / cap
  links: { to: number; gate: number; rate: number }[];   // to = 다른 군중 구역의 번호(-1 = 현장 밖으로), gate = 문 소품 id(-1 = 문 없음), rate = 초당 사람
  fallen: number;                                 // 여기서 넘어진 사람 수
  side: '' | 'A' | 'B' | 'M';                     // 시위의 편 (M = 가운데 띠)
}
/** 진실: 군중 현장의 상태. heat = 시위의 기세 (압사·행사장은 0) */
export interface CrowdState { zones: CrowdZone[]; spawned: number; maxSpawn: number; heat: number }
/**
 * Scene.kinds2 — N9 시나리오의 진실 (판단 파일은 읽지 않는다). 시나리오가 쓰는 칸만 채우고 나머지는 undefined.
 * 시나리오 하나에만 있는 칸(train·tilt·oil·flood·plane·drone·escapeAt·highPos·tunnelEdge — 설계서 §4)은 그 시나리오의 단계가 이 인터페이스에 더한다(인터페이스 합치기)
 */
export interface Kinds2State {
  tox?: Float32Array;                             // 독성 공기의 칸별 농도 0..1.5 (0.3 넘으면 위험) — 불이 붙지 않는다, 가스 모델과 따로 (§5.4 — 단계 6)
  crowd?: CrowdState;                             // 군중 (§5.6 — 단계 4)
  contamIds?: Set<number>;                        // 오염된 구조 대상 id (§5.5 — 구조 대상의 모양을 바꾸지 않으려고 현장 쪽 집합에 둔다, 단계 6)
  deconned?: Set<number>;                         // 제독을 마친 구조 대상 id
  underIds?: Set<number>;                         // 물에 잠긴 차·선실 안의 구조 대상 id — 잠수(dive)로만 닿는다. inWater 가 아니다 (§5.10 — 단계 5)
  floorHp?: number;                               // 구조 대상 체력 하한의 장면 값 (§5.14 — 돌진·지하철 20). 읽는 곳은 incidentTypes.floorOf 하나
}
/** 'hos' 사실의 값 — agents.hosFact 가 채우는 모양에 이름을 붙였다(지금 칸 그대로 + N9 의 믿음 칸 둘). hosFact 에 칸을 더하면 여기에도 더한다 */
export interface HosBelief {
  x: number; y: number; weapon: Hostile['weapon']; state: Hostile['state']; hostage: boolean; facing: number;
  dead: boolean; band: number; tq: number; where: NonNullable<Hostile['where']>;
  tag?: 'organizer' | 'agitator';                 // (N9) 본 역할 — 주최자의 완장·확성기, 선동자의 행동 (진실 crowdRole 과 다른 이름). 채우는 것은 단계 4 의 hosFact
  threw?: boolean;                                // (N9) 던지는 것을 보았다 — 세계 규칙이 본 대원들에게 강제로 넣는다 (단계 4)
}
export interface Scene {
  kinds2?: Kinds2State;                           // N9 시나리오의 진실
  windDir?: number;                               // 생김새: 그 현장의 고정된 바람·환기 방향(라디안 — 터널·탱크로리). 깃발·연기로 누구나 본다 — 판단부도 읽는다 (§5.7)
  flowSpots?: FlowSpot[];                         // 생김새: 군중 현장의 흐름 자리 (§5.6)
}
export interface Hostile {
  crowdRole?: 'organizer' | 'agitator';           // 시위의 주최자 · 선동자 — 진실 (단계 4)
  dispersed?: boolean;                            // 해산해 무리와 함께 걸어 나간다 — 판정의 용의자 셈·위험 판정에서 빠진다 (debrief.evaluate — §5.15)
}
export interface CasBelief {
  dirty?: boolean;                                // 오염돼 보인다 (2칸 안에서 본 그대로 · 믿음 속 오염 구역 안에서 본 사람 — 진실 contamIds 와 다른 이름, 단계 6)
  sunk?: boolean;                                 // 물에 잠긴 차·선실 안 (잠수 대원이 찾았다 — 진실 underIds 와 다른 이름, 단계 5)
}

// ───────────────────────── 사건 종류 다양화 ② (N9 단계 2 — 새 부대의 자리) ─────────────────────────
// docs/specs/N9-major-kinds.md §5.3.1. 새 수요 열쇠 하나 — 제독은 다른 일로 바꿔 쓸 수 없어 따로 둔다(진압·구조 수요로 두면 제독차가 화재·교통에 나간다).
// 단계 2 에는 이 열쇠를 내는 곳이 없고 제독차도 편성되지 않는다(UNIT_DEFS 의 minLevel 6) — 결과가 바뀌지 않는다. 화학 구조차의 decon 0.7 은 제독차가 없을 때의 둘째 후보다.
// 열쇠가 지나는 자리(N8 의 다섯과 같다): resources.caps()·AID_KIND/AID_CALL · analyst.NEED_NAME·emptyNeeds · dispatcher.ORDER(끝)·MINCAP·NEED_LABEL ·
// commander.request 의 이름표·NEED_MIN·needFor(decontam → decon) · scripts/metrics.ts NEED_KEYS
export interface UnitCaps { decon: number }      // 제독
export interface Needs { decon: number }
