// 부대 편성 · 역할 · 개인 장비 (docs/specs/R1-crews.md).
// 부대 종류마다 자리(역할)의 순서가 있고(STAFF), 역할마다 능력의 식·기본 장비·먼저 맡는 일이 있으며(ROLES),
// 장비마다 효과가 있다(KITS). 명부(resources.createRoster·createAidUnit)가 이 표로 대원을 만든다.
//
// 이 파일은 types.ts·util.ts·events.ts 와 타입만 import 한다. resources.ts·field/*·dispatch/* 를 import 하지 않는다
// (resources.ts 가 이 파일을 import 하므로 거꾸로 import 하면 순환이 생겨 초기화 전의 표를 읽는다).
//
// 장비를 읽는 방법은 쓰는 자리에 따라 다르다 (설계서 4절 "장비를 읽는 네 가지 방법"):
//   배정·계획·관제      → hasKit · toolFor · crewHasKit    숨은 고장은 모른다(있는 것으로 본다). 상태를 바꾸지 않는다
//   화면도 부르는 물리  → kitLive                          숨은 고장이면 효과가 없다. 드러내지 않고 기록도 남기지 않는다 (visionOf·detectRadius)
//   효과를 주는 자리    → kitWorks · toolUse               숨은 고장이 이때 드러난다(기록). 시뮬레이션만 부른다 (실행기·perceive)
//   수량                → kitUses · useKit                 useKit 만 상태를 바꾼다
// 표현 계층(src/view·src/ui)이 부르는 함수에서는 kitWorks·toolUse·useKit 을 부르지 않는다 — 그림을 그리는 것만으로 기록과 해시가 바뀐다.

import type { Sim } from './engine';
import { emit, raiseProblem } from './events';
import type { Rng } from './rng';
import type { Facility, Incident, KitId, KitItem, Responder, RoleGroup, RoleId, Scene, Skills, Unit, UnitKind, WorkKind } from './types';
import { clamp, josa } from './util';

// ───────────────────────── 개인 장비 ─────────────────────────
export type ToolUse = 'force' | 'clear' | 'extricate' | 'water';
export interface KitDef {
  name: string;                       // 화면 이름 ('공기호흡기')
  group: 'fire' | 'rescue' | 'med' | 'police' | 'air';      // 대원 정보창의 작은 기호
  tool?: Partial<Record<ToolUse, number>>;     // 일에 쓰는 장비의 성능 (0..1)
  med?: number;                       // 의료 장비 수준 (부대의 medLevel 자리)
  armor?: number;                     // 총격 방호 (부대의 armor 자리)
  faultable?: boolean;                // 교대마다 고장 추첨을 받는다
  uses?: number;                      // (R2) 처음 수량 — 명부가 KitItem.uses 로 복사한다 (단계 1a: kitFor). 섬광탄·테이저·장약·공기는 R1 의 자리(KIT_USES·dealFlashbangs·tn.airFull) 그대로
  batch?: 'r2';                       // (R2) 고장 추첨을 R1 의 흐름(kit·aid:<n>) 밖에서 따로 받는 장비 — kit-r2·aid-r2:<n> (단계 1a: drawFaults 가 건너뛴다)
}
/**
 * 장비 표. 효과의 내용은 설계서 4절 표에 있고, 여기에는 여러 장비가 같은 식으로 견주는 값(tool·med·armor)과 고장 추첨 여부만 둔다.
 * 그 밖의 효과(공기호흡기의 연기 방호, 방패의 +0.3, 폭발물 방호복의 폭발 피해 …)는 그 장비를 보는 자리 하나에 있다.
 */
export const KITS: Record<KitId, KitDef> = {
  scba: { name: '공기호흡기', group: 'fire' },
  turnout: { name: '방화복', group: 'fire', armor: 0.1 },
  hose: { name: '관창·소방 호스', group: 'fire' },
  tic: { name: '열화상 카메라', group: 'fire', faultable: true },
  irons: { name: '할리건·도끼', group: 'rescue', tool: { force: 0.9, clear: 0.6, extricate: 0.45 } },
  spreader: { name: '유압 구조기', group: 'rescue', tool: { force: 0.8, clear: 0.7, extricate: 1.0 }, faultable: true },
  breachKit: { name: '파괴 장비(램·할리건)', group: 'police', tool: { force: 1.0, clear: 0.4 } },
  lightRescue: { name: '휴대 구조 장비', group: 'rescue', tool: { force: 0.6, clear: 0.6, extricate: 0.6, water: 0.6 } },
  searchKit: { name: '탐지 장비(음향·영상)', group: 'rescue', faultable: true },
  rope: { name: '구조 로프', group: 'rescue', tool: { water: 0.9 } },
  ring: { name: '구명환', group: 'rescue', tool: { water: 0.8 } },
  pumpPanel: { name: '펌프 조작', group: 'fire' },
  plugKit: { name: '누출 차단 장비', group: 'fire' },
  gasMeter: { name: '가스 측정기', group: 'fire' },
  bag: { name: '기본 응급 가방', group: 'med', med: 0.75 },
  alsBag: { name: '전문 응급 가방', group: 'med', med: 1.0 },
  doctorKit: { name: '의사 장비(약물·수혈)', group: 'med', med: 1.1 },
  aed: { name: '제세동기', group: 'med', faultable: true },
  stretcher: { name: '들것', group: 'med' },
  spineBoard: { name: '척추 고정판', group: 'med' },
  pistol: { name: '권총', group: 'police' },
  rifle: { name: '소총', group: 'police' },
  sniper: { name: '저격 소총', group: 'police' },
  taser: { name: '테이저', group: 'police', faultable: true },
  flashbang: { name: '섬광탄', group: 'police' },
  vest: { name: '방검·방탄 조끼', group: 'police', armor: 0.25 },
  plate: { name: '전술 방탄 조끼', group: 'police', armor: 0.6 },
  shield: { name: '방탄 방패', group: 'police' },      // 교전·봉쇄 중 +0.3 은 armorOf 가 따로 더한다 (가장 좋은 방호와 겨루는 값이 아니다)
  bombSuit: { name: '폭발물 방호복', group: 'police', armor: 0.6 },
  eodKit: { name: '해체 공구', group: 'police' },
  robot: { name: '원격 로봇', group: 'police', faultable: true },
  megaphone: { name: '확성기', group: 'police' },
  baton: { name: '경광봉', group: 'police' },
  flir: { name: '공중 열영상', group: 'air' },
  searchlight: { name: '탐조등', group: 'air', faultable: true },
  // 폭파 장약: R1 에서는 효과가 없다. tool 값을 두지 않는다(두면 문 개방 속도가 바뀐다). 고장 추첨도 받지 않는다. 쓰는 것은 R2 §4.2a
  charge: { name: '폭파 장약', group: 'police' },
  // ── (R2 §3.3) 대응 방법이 쓰는 장비 아홉 가지. 단계 0 에는 표에만 있다 — 어느 역할도 들지 않는다(역할의 기본 장비에는 단계 1a·3·4·5 가 끝에 붙인다).
  //    고장 나는 것(raft·fan·airbag)은 batch 'r2': R1 의 고장 추첨 순서에 끼지 않고 따로 뽑는다 ──
  pole: { name: '갈고리 장대', group: 'rescue', tool: { water: 0.7 } },
  pfd: { name: '구명조끼', group: 'rescue' },
  drysuit: { name: '드라이슈트', group: 'rescue' },
  raft: { name: '구조용 고무보트', group: 'rescue', faultable: true, batch: 'r2' },
  extinguisher: { name: '소화기', group: 'fire', uses: 1 },      // 한 개 = 12초 분사
  fan: { name: '송풍기', group: 'fire', faultable: true, batch: 'r2' },
  airbag: { name: '구조용 에어백', group: 'rescue', faultable: true, batch: 'r2' },
  shoring: { name: '지지대', group: 'rescue' },
  beanbag: { name: '비살상탄 발사기', group: 'police', uses: 3 },      // 발
};
/** 처음에 채워 두는 수량 (섬광탄은 부대 몫을 dealFlashbangs 가 나눈다. 공기호흡기의 공기는 kitFor 가 장비 손잡이의 값 tn.airFull 로 채운다) */
const KIT_USES: Partial<Record<KitId, number>> = { taser: 2, charge: 2 };

// ───────────────────────── 역할 ─────────────────────────
export interface RoleDef {
  name: string;                       // 화면 이름 ('관창수')
  group: RoleGroup;                   // 그림 묶음
  skills: (s: number) => Skills;      // 능력의 식 (s = 그 대원의 skill). 0..1 로 자르는 것은 skillsOf 가 한다
  kit: KitId[];                       // 기본 장비. 이 순서로 든다 — 고장 추첨도 이 순서이므로 새 장비는 끝에 붙인다
  prefer: Partial<Record<WorkKind, number>>;      // 먼저 맡는 일(+)·피하는 일(−). 맡을 수 있을 때만 fitFor 에 더한다(자격을 만들지 않는다)
  stays?: boolean;                    // 현장에 내리지 않는 자리 (조종사·정장·관측관): FieldAgent 가 되지 않는다
  exp?: [number, number];             // 새 자리의 경험 범위 (없으면 0번 자리 .6~.97, 그 밖 .2~.75)
}
const sk = (fire: number, rescue: number, medical: number, law: number): Skills => ({ fire, rescue, medical, law });
export const ROLES: Record<RoleId, RoleDef> = {
  // ── 경찰 ──
  patrolLead: { name: '순찰 팀장', group: 'lead', skills: (s) => sk(0.05, 0.22, 0.25, s + 0.04), kit: ['pistol', 'taser', 'vest', 'megaphone', 'aed'], prefer: { negotiate: 0.15, interview: 0.15 } },
  officer: { name: '순찰 경관', group: 'officer', skills: (s) => sk(0.05, 0.22, 0.22, s), kit: ['pistol', 'taser', 'vest', 'baton'], prefer: { traffic: 0.15, perimeter: 0.1, arrest: 0.1 } },
  tacLead: { name: '기동 조장', group: 'lead', skills: (s) => sk(0.05, 0.22, 0.22, s + 0.06), kit: ['pistol', 'plate', 'megaphone'], prefer: { negotiate: 0.1 } },
  tacOfficer: { name: '기동대원', group: 'officer', skills: (s) => sk(0.05, 0.22, 0.22, s + 0.06), kit: ['rifle', 'plate', 'flashbang'], prefer: { engage: 0.15, arrest: 0.1 } },
  swatLead: { name: '특공 팀장', group: 'lead', skills: (s) => sk(0.05, 0.25, 0.25, s + 0.12), kit: ['pistol', 'plate', 'flashbang'], prefer: { negotiate: 0.05 } },
  shield: { name: '방패수', group: 'shield', skills: (s) => sk(0.05, 0.22, 0.22, s + 0.1), kit: ['pistol', 'plate', 'shield'], prefer: { engage: 0.2 } },
  breacher: { name: '진입대원(파괴)', group: 'entry', skills: (s) => sk(0.05, 0.35, 0.22, s + 0.1), kit: ['rifle', 'plate', 'breachKit', 'flashbang', 'charge'], prefer: { force: 0.3, engage: 0.1 } },
  assaulter: { name: '진입대원', group: 'officer', skills: (s) => sk(0.05, 0.22, 0.22, s + 0.12), kit: ['rifle', 'plate', 'flashbang'], prefer: { engage: 0.15 } },
  marksman: { name: '저격·관측수', group: 'marksman', skills: (s) => sk(0.05, 0.2, 0.2, s + 0.15), kit: ['sniper', 'plate'], prefer: { perimeter: 0.3, engage: -0.15 } },
  bombTech: { name: '폭발물 처리 요원', group: 'bomb', skills: (s) => sk(0.05, 0.3, 0.22, s - 0.15), kit: ['bombSuit', 'eodKit', 'charge'], prefer: { defuse: 0.3 } },
  // 권총을 빼지 않는다: 최소 인원 처리반(처리 요원·로봇 조작 요원)에서 "law ≥ 0.5 ⇒ 총기 대원"을 지키는 사람이 그뿐이다. 무장 사건의 인원 문턱은 묶음 bomb 을 세지 않는다
  robotOp: { name: '로봇 조작 요원', group: 'bomb', skills: (s) => sk(0.05, 0.25, 0.22, s - 0.05), kit: ['robot', 'pistol', 'vest'], prefer: { perimeter: 0.1 } },
  eodGuard: { name: '경계 요원', group: 'officer', skills: (s) => sk(0.05, 0.22, 0.22, s), kit: ['pistol', 'vest', 'megaphone'], prefer: { perimeter: 0.2 } },
  observer: { name: '전술 관측관', group: 'observer', skills: (s) => sk(0.05, 0.2, 0.2, s), kit: ['flir', 'searchlight'], prefer: {}, stays: true, exp: [0.4, 0.9] },
  pilot: { name: '기장', group: 'pilot', skills: () => sk(0.05, 0.2, 0.2, 0.05), kit: [], prefer: {}, stays: true, exp: [0.55, 0.95] },
  copilot: { name: '부기장', group: 'pilot', skills: () => sk(0.05, 0.2, 0.2, 0.05), kit: [], prefer: {}, stays: true, exp: [0.3, 0.8] },
  // ── 소방 ──
  fireLead: { name: '진압 팀장', group: 'lead', skills: (s) => sk(s, s * 0.7, 0.35, 0.05), kit: ['scba', 'turnout', 'tic', 'irons', 'aed'], prefer: { search: 0.1, force: 0.1 } },
  nozzle: { name: '관창수', group: 'nozzle', skills: (s) => sk(s + 0.05, s * 0.55, 0.3, 0.05), kit: ['scba', 'turnout', 'hose'], prefer: { suppress: 0.15, overhaul: 0.1 } },
  firefighter: { name: '진입대원', group: 'entry', skills: (s) => sk(s * 0.95, s * 0.7, 0.3, 0.05), kit: ['scba', 'turnout', 'hose', 'irons', 'rope'], prefer: { search: 0.1, force: 0.1, carry: 0.05 } },
  engineer: { name: '기관원', group: 'engineer', skills: (s) => sk(s * 0.8, s * 0.5, 0.3, 0.05), kit: ['scba', 'turnout', 'pumpPanel'], prefer: { hookup: 0.3, traffic: 0.1, clearRoad: 0.1, search: -0.25 } },
  ladderLead: { name: '사다리 팀장', group: 'lead', skills: (s) => sk(s, s * 0.7, 0.35, 0.05), kit: ['scba', 'turnout', 'tic', 'irons'], prefer: { search: 0.1, force: 0.1 } },
  ladderOp: { name: '사다리 조작원', group: 'engineer', skills: (s) => sk(s * 0.85, s * 0.5, 0.3, 0.05), kit: ['scba', 'turnout', 'pumpPanel', 'hose'], prefer: { hookup: 0.3, search: -0.2 } },
  // ── 구조·화학·항공·수난 ──
  rescueLead: { name: '구조 팀장', group: 'lead', skills: (s) => sk(s * 0.7, s, 0.4, 0.05), kit: ['scba', 'turnout', 'searchKit', 'irons'], prefer: { search: 0.1 } },
  extricator: { name: '구조대원(유압)', group: 'rescue', skills: (s) => sk(s * 0.7, s + 0.04, 0.35, 0.05), kit: ['scba', 'turnout', 'spreader'], prefer: { extricate: 0.25, clear: 0.15 } },
  searcher: { name: '구조대원(탐지)', group: 'search', skills: (s) => sk(s * 0.7, s, 0.35, 0.05), kit: ['scba', 'turnout', 'searchKit', 'irons'], prefer: { search: 0.2 } },
  ropeTech: { name: '구조대원(로프)', group: 'water', skills: (s) => sk(s * 0.6, s, 0.35, 0.05), kit: ['scba', 'turnout', 'rope', 'ring', 'hose'], prefer: { waterRescue: 0.3 } },
  hazLead: { name: '화학 팀장', group: 'lead', skills: (s) => sk(s * 0.7, s * 0.92, 0.4, 0.05), kit: ['scba', 'turnout', 'gasMeter', 'irons'], prefer: { search: 0.05 } },
  hazTech: { name: '화학 보호복 대원', group: 'hazmat', skills: (s) => sk(s * 0.7, s * 0.9, 0.4, 0.05), kit: ['scba', 'turnout', 'plugKit'], prefer: { mitigate: 0.3 } },
  decon: { name: '측정·제독 대원', group: 'hazmat', skills: (s) => sk(s * 0.6, s * 0.85, 0.4, 0.05), kit: ['scba', 'turnout', 'gasMeter', 'hose'], prefer: { search: 0.1, escort: 0.1 } },
  airRescuer: { name: '항공 구조대원', group: 'rescue', skills: (s) => sk(0.15, s, 0.55, 0.05), kit: ['scba', 'turnout', 'lightRescue', 'bag', 'rope'], prefer: {} },
  boatRescuer: { name: '수난 구조대원', group: 'water', skills: (s) => sk(0.1, s, 0.45, 0.05), kit: ['rope', 'ring'], prefer: { waterRescue: 0.3 } },
  boatLead: { name: '정장', group: 'pilot', skills: () => sk(0.1, 0.3, 0.3, 0.05), kit: [], prefer: {}, stays: true, exp: [0.5, 0.95] },
  // ── 구급·의료 ──
  paramedic: { name: '1급 응급구조사', group: 'medic', skills: (s) => sk(0.05, 0.25, s + 0.08, 0.05), kit: ['alsBag', 'aed'], prefer: { treat: 0.15 } },
  emt: { name: '응급구조사', group: 'medic', skills: (s) => sk(0.05, 0.25, s, 0.05), kit: ['bag', 'spineBoard'], prefer: { treat: 0.1, carry: 0.05 } },
  emsDriver: { name: '구급 운전원', group: 'medic', skills: (s) => sk(0.05, 0.3, s * 0.85, 0.05), kit: ['stretcher'], prefer: { load: 0.2, carry: 0.1 } },
  doctor: { name: '의사', group: 'doctor', skills: (s) => sk(0.05, 0.2, Math.min(1, s + 0.2), 0.05), kit: ['doctorKit', 'aed'], prefer: { treat: 0.3, carry: -0.2 }, exp: [0.5, 0.9] },
  flightNurse: { name: '항공 간호사', group: 'medic', skills: (s) => sk(0.05, 0.25, s + 0.1, 0.05), kit: ['alsBag', 'stretcher'], prefer: { treat: 0.15, load: 0.15 } },
};
/** 역할을 모르는 대원(시험에서 손으로 만든 명부 등)에게 쓰는 부서별 기본 역할 */
const DEPT_ROLE: Record<Responder['dept'], RoleId> = { police: 'officer', fire: 'firefighter', ems: 'emt' };

// ───────────────────────── 편성표 ─────────────────────────
export interface StaffDef {
  std: RoleId[];          // 표준 인원의 자리 순서 = crew 순서. 0번 자리가 부대장
  minDrop: number[];      // 최소 인원(부대 규모 1·2, 지원 부대)에서 빼는 자리 번호
}
/**
 * 부대 종류별 자리. 처음 20줄(UNIT_DEFS)의 0·1번 자리는 R1 전의 선임·후임이다(이름·기본 능력이 그대로다).
 * 2번 자리부터는 roster-v2:<호출부호>:<자리> 흐름과 EXTRA_NAMES 를 쓰므로 **새 자리는 끝에 붙인다**(끼워 넣으면 뒤의 사람이 바뀐다).
 * 최소 인원에서 빼는 자리는 "능력(caps)이 기준을 넘는 부대에는 그 일을 할 장비를 가진 대원이 있다"(tests/crews.test.ts ③)를 깨지 않게 골랐다.
 * 경찰 헬기는 전원이 내리지 않는 부대다(기장·부기장·관측관) — 현장 상공에 머문다(isHovering).
 */
export const STAFF: Record<UnitKind, StaffDef> = {
  patrol: { std: ['patrolLead', 'officer'], minDrop: [] },
  tactical: { std: ['tacLead', 'tacOfficer', 'tacOfficer'], minDrop: [2] },
  engine: { std: ['fireLead', 'nozzle', 'firefighter', 'engineer'], minDrop: [2] },
  ladder: { std: ['ladderLead', 'nozzle', 'ladderOp'], minDrop: [2] },
  rescue: { std: ['rescueLead', 'extricator', 'extricator', 'searcher', 'ropeTech'], minDrop: [3] },
  als: { std: ['paramedic', 'emt', 'emsDriver'], minDrop: [1] },
  bls: { std: ['emt', 'emsDriver'], minDrop: [] },
  swat: { std: ['swatLead', 'shield', 'breacher', 'assaulter', 'marksman'], minDrop: [4] },
  heli: { std: ['airRescuer', 'airRescuer', 'pilot', 'copilot'], minDrop: [3] },
  hazmat: { std: ['hazLead', 'hazTech', 'hazTech', 'decon'], minDrop: [2] },
  boat: { std: ['boatRescuer', 'boatRescuer', 'boatLead'], minDrop: [] },
  eod: { std: ['bombTech', 'robotOp', 'eodGuard'], minDrop: [2] },
  policeHeli: { std: ['pilot', 'copilot', 'observer'], minDrop: [1] },
  medHeli: { std: ['doctor', 'flightNurse', 'pilot', 'copilot'], minDrop: [3] },
};
/** 항공 부대의 종류 (소방 · 경찰 · 의료 헬기). 명부(createRoster)와 지도 표식(view)이 함께 쓴다 */
export const AIR_KIND: Set<UnitKind> = new Set<UnitKind>(['heli', 'policeHeli', 'medHeli']);
/**
 * 이 부대는 그 현장의 상공에 머무는가 (내려앉지 않는다 — 아무도 내리지 않는 '대원 없는 현장 부대'). 종류와 현장만 본다: 상태는 부르는 쪽이 따로 본다.
 * 경찰 헬기는 언제나 상공에 머문다(관측·탐조등). 소방 헬기는 물이 있는 현장(수난 사고, 물의 규칙이 도는 현장)과 산불 현장에서 상공에 머물며
 * 호이스트로 사람을 건지고 물을 뿌린다 — 그 밖의 현장에는 내려앉아 대원이 일한다. 의료 헬기는 언제나 내려앉는다.
 * 상공의 일은 field/rules/air.ts 가 굴린다.
 */
export function isHovering(u: Unit, s: Scene): boolean {
  if (u.kind === 'policeHeli') return true;
  return u.kind === 'heli' && (s.kind === 'water' || (s.rules !== undefined && s.rules.indexOf('water') >= 0) || (s.kind === 'fire' && s.variant === 'wild'));
}
/** 그 시설의 헬기 착륙 자리 (지도 좌표). 병원은 부지 안의 착륙장, 그 밖(항공대·경찰서)은 건물 옆 */
export function heliPad(_sim: Sim, f: Facility): [number, number] { return f.kind === 'hospital' ? [f.x - 5, f.y - 3] : [f.x + 30, f.y - 20]; }

/**
 * 처음 20줄의 0·1번 자리 말고 모든 자리의 이름. (편성표의 줄 순서 × 표준 표의 자리 순서)로 차례로 쓴다.
 * 첨자는 표준 표의 자리로 고정한다: 편성되지 않은 줄, 최소 인원에서 빠진 자리도 자기 번호를 차지한다(앞으로 당기지 않는다).
 * 그래야 부대 규모와 상관없이 같은 이름 = 같은 능력치(roster-v2:<호출부호>:<자리>)다. NAMES·AID_NAMES(resources.ts)와 겹치지 않는다.
 */
export const EXTRA_NAMES = ['구본호', '나윤슬', '도해찬', '마서율', '반지성', '백승아', '사공진', '선우람', '설하윤', '성도진', '손예찬', '송하람',
  '심지율', '양태호', '염소희', '오세린', '우지환', '원채린', '유건희', '윤다온', '이로하', '임하준', '장세아', '전도하',
  '정이든', '제갈윤', '조서하', '주원석', '지예솔', '진태경', '천소율', '최한결', '태은호', '편서우', '하도율', '허은재'];

/** 편성되는 자리 번호 (표준 표의 번호 그대로). minimal 이면 최소 인원 — minDrop 을 뺀다 */
export function slotsOf(kind: UnitKind, minimal: boolean): number[] {
  const st = STAFF[kind], out: number[] = [];
  for (let k = 0; k < st.std.length; k++) if (!minimal || st.minDrop.indexOf(k) < 0) out.push(k);
  return out;
}
/** 최소 인원 표의 인원 (내리지 않는 자리까지 센다 — 편성 인원의 설명·테스트용. I2 의 예비 인력 기준은 minField 를 쓴다) */
export function minCrew(kind: UnitKind): number { return STAFF[kind].std.length - STAFF[kind].minDrop.length; }
/**
 * 내리는 자리의 최소 수: 최소 편성 가운데 내리지 않는 자리(stays)가 아닌 역할의 수.
 * 모두 내리지 않는 부대(경찰 헬기)면 최소 편성의 자리 수 — fieldCrew 와 같은 규칙이다.
 */
export function minField(kind: UnitKind): number {
  const st = STAFF[kind];
  let n = 0; for (const k of slotsOf(kind, true)) if (!ROLES[st.std[k]].stays) n++;
  return n > 0 ? n : minCrew(kind);
}
/** 역할의 능력 식에 skill 을 넣은 값 (0..1 로 자른다). 명부와 I2 의 성장이 함께 쓴다 */
export function skillsOf(role: RoleId, skill: number): Skills {
  const v = ROLES[role].skills(skill);
  return { fire: clamp(v.fire, 0, 1), rescue: clamp(v.rescue, 0, 1), medical: clamp(v.medical, 0, 1), law: clamp(v.law, 0, 1) };
}
/**
 * 역할의 기본 장비를 든 상태로 만든다 (모든 장비 항목이 같은 칸을 같은 순서로 갖는다).
 * air = 공기호흡기 한 통의 공기(초, tn.airFull). 주지 않으면 공기를 세지 않는다(줄지 않는다 — 손으로 만든 명부·시험용).
 */
export function kitFor(role: RoleId, air?: number): KitItem[] {
  return ROLES[role].kit.map((id) => ({ id, uses: id === 'scba' ? air : KIT_USES[id], fault: false, faultKnown: false }));
}
/**
 * 개인 장비의 고장 추첨 (설계서 9절): 대원 순서 × 든 장비의 순서대로, 고장 추첨을 받는 장비(KITS 의 faultable)마다 확률 p.
 * 고장 난 장비는 효과가 없고(kitLive), 처음 효과를 주려 할 때 드러난다(kitWorks·toolUse). 그때까지는 조직이 모른다(hasKit 은 참).
 * 난수는 부르는 쪽이 준다: 편성표 부대는 교대 흐름 'kit' 하나, 지원 부대는 자기 흐름 aid:<n> 의 끝(대원 → 펌프 → 고장).
 * 돌려주는 값 = 고장 난 장비 수.
 */
export function drawFaults(rng: Rng, crew: Responder[], p: number): number {
  let n = 0;
  for (const r of crew) for (const it of r.kit ?? []) if (KITS[it.id].faultable && rng.chance(p)) { it.fault = true; n++; }
  return n;
}
/**
 * 부대 몫의 섬광탄을 섬광탄 장비를 든 사람에게 자리 순서대로 하나씩 돌려 나눈다 (2 → 기동대원 1·1, 4 → 팀장 2·진입(파괴) 1·진입 1).
 * 0 개를 받은 사람의 항목도 남긴다(uses 0). 돌려주는 값 = 나눠 준 합 — 부대의 u.flashbangs 를 이 값으로 맞춘다.
 */
export function dealFlashbangs(crew: Responder[], n: number): number {
  const items: KitItem[] = [];
  for (const r of crew) for (const it of r.kit ?? []) if (it.id === 'flashbang') { it.uses = 0; items.push(it); }
  if (!items.length) return 0;
  let sum = 0;
  for (let k = 0; k < n; k++) { items[k % items.length].uses!++; sum++; }
  return sum;
}

// ───────────────────────── 읽는 함수 ─────────────────────────
export function roleOf(sim: Sim, rid: number): RoleDef { const r = sim.responders[rid]; return ROLES[r.role ?? DEPT_ROLE[r.dept]]; }
/** 현장에 내리지 않는 자리인가 (조종사·정장·관측관) */
export function stays(sim: Sim, rid: number): boolean { return roleOf(sim, rid).stays === true; }
/** 내리는 자리의 대원만 (자리 순서). 전원이 내리지 않는 부대(경찰 헬기)면 전원 */
export function fieldCrew(sim: Sim, u: Unit): number[] {
  const out: number[] = [];
  for (let k = 0; k < u.crew.length; k++) if (!stays(sim, u.crew[k])) out.push(u.crew[k]);
  return out.length ? out : u.crew;
}
function itemOf(sim: Sim, rid: number, id: KitId): KitItem | null {
  const kit = sim.responders[rid].kit;
  if (kit) for (let k = 0; k < kit.length; k++) if (kit[k].id === id) return kit[k];
  return null;
}
/** 들고 있고, 알려진 고장이 아니다 (배정·관제 판단용 — 숨은 고장은 모른다) */
export function hasKit(sim: Sim, rid: number, id: KitId): boolean { const it = itemOf(sim, rid, id); return it !== null && !it.faultKnown; }
/** 남은 수량. 들고 있지 않으면 0, 수량을 세지 않는 장비(또는 아직 채우지 않은 공기)면 Infinity */
export function kitUses(sim: Sim, rid: number, id: KitId): number { const it = itemOf(sim, rid, id); return it === null ? 0 : it.uses === undefined ? Infinity : it.uses; }
/** 수량을 줄인다. 섬광탄이면 부대의 u.flashbangs(그 부대가 가진 합)도 같이 줄인다 */
export function useKit(sim: Sim, rid: number, id: KitId, n = 1): void {
  const it = itemOf(sim, rid, id);
  if (it === null || it.uses === undefined) return;
  const used = Math.min(it.uses, n);
  it.uses -= used;
  if (id === 'flashbang') { const u = sim.units[sim.responders[rid].unitId]; u.flashbangs = Math.max(0, u.flashbangs - used); }
}
/** 총기(권총·소총·저격 소총)를 들었는가 */
export function hasFirearm(sim: Sim, rid: number): boolean { return hasKit(sim, rid, 'pistol') || hasKit(sim, rid, 'rifle') || hasKit(sim, rid, 'sniper'); }
/** 그 장비를 든 내리는 대원이 부대에 있는가. okOnly 면 지금 일할 수 있는(status 'ok') 대원만 센다 */
export function crewHasKit(sim: Sim, u: Unit, id: KitId, okOnly = true): boolean {
  const fc = fieldCrew(sim, u);
  for (let k = 0; k < fc.length; k++) if ((!okOnly || sim.responders[fc[k]].status === 'ok') && hasKit(sim, fc[k], id)) return true;
  return false;
}

// ───────────────────────── 장비의 효과 ─────────────────────────
/**
 * 들고 있고 실제로 작동한다 (= 고장이 아니다. 숨은 고장도 본다). 드러내지 않고 기록도 남기지 않는다.
 * 세계의 물리 가운데 표현 계층도 부르는 함수(visionOf·detectRadius)만 쓴다 — 배정·판단에서 쓰면 숨은 고장이 샌다.
 */
export function kitLive(sim: Sim, rid: number, id: KitId): boolean { const it = itemOf(sim, rid, id); return it !== null && !it.fault; }
/**
 * 효과를 줄 때만 부른다: 들고 있고 작동하면 true. 숨은 고장이면 **이때 드러나** 기록을 남기고 false (같은 대원·같은 장비는 한 번만).
 * 기록은 상태(faultKnown)를 바꾸는 바로 이 자리에서 남긴다. 표현 계층이 부르는 함수에서는 부르지 않는다.
 */
export function kitWorks(sim: Sim, rid: number, id: KitId, I?: Incident): boolean {
  const it = itemOf(sim, rid, id);
  if (it === null || it.faultKnown) return false;
  if (!it.fault) return true;
  it.faultKnown = true;      // 이때부터 조직이 안다 (hasKit 이 false 가 된다)
  const r = sim.responders[rid], name = KITS[id].name;
  if (I) raiseProblem(sim, I, 'EQUIP_FAIL', `${r.name}의 ${josa(name, '이/가')} 고장`, { role: 'RESPONDER', actor: r.name, rid: r.id, imp: 1, text: `${josa(name, '이/가')} 작동하지 않습니다.` }, false);
  else emit(sim, { role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'problem', problem: 'EQUIP_FAIL', imp: 1, text: `${josa(name, '이/가')} 작동하지 않습니다.` });
  return false;
}
/** 장비 없이 맨손으로 하는 일의 성능 */
const BARE_HANDS = 0.12;
/** 그 일에 쓸 수 있는 장비 가운데 가장 좋은 것 (알려진 고장은 뺀다. 같은 값이면 먼저 든 것). 없으면 null */
function bestTool(sim: Sim, rid: number, use: ToolUse): KitId | null {
  const kit = sim.responders[rid].kit;
  let best: KitId | null = null, bv = 0;
  if (kit) for (let k = 0; k < kit.length; k++) {
    const it = kit[k], tool = KITS[it.id].tool;
    if (!tool || it.faultKnown) continue;
    const v = tool[use];
    if (v !== undefined && v > bv) { bv = v; best = it.id; }
  }
  return best;
}
const toolValue = (sim: Sim, id: KitId, use: ToolUse): number => Math.min(1.15, KITS[id].tool![use]! * sim.tune.toolMul);
/**
 * 계획용: 알려진 고장만 뺀 장비 가운데 가장 좋은 값 × 장비 손잡이(toolMul), 상한 1.15. 없으면 맨손 0.12.
 * fitFor·agentCost·관제가 쓴다 — 숨은 고장은 모른다.
 */
export function toolFor(sim: Sim, rid: number, use: ToolUse): number {
  const id = bestTool(sim, rid, use);
  return id === null ? BARE_HANDS : toolValue(sim, id, use);
}
/**
 * 실행기 전용: toolFor 의 순서대로 고른 장비에 kitWorks 를 부른다. 숨은 고장이 드러나면 다음으로 좋은 장비로, 다 없으면 맨손 0.12.
 * (효과 자리에서 toolFor 를 쓰면 고장 난 유압 구조기가 끝내 효과를 내거나, 효과 없이 드러나지도 않는다.)
 */
export function toolUse(sim: Sim, rid: number, use: ToolUse, I: Incident): number {
  for (;;) {
    const id = bestTool(sim, rid, use);
    if (id === null) return BARE_HANDS;
    if (kitWorks(sim, rid, id, I)) return toolValue(sim, id, use);      // 고장이 드러났으면 faultKnown 이 되어 다음 바퀴에서 빠진다
  }
}
/** 의료 장비가 없는 대원의 처치 수준 (부서의 기본 교육) */
const MED_BASE: Record<Responder['dept'], number> = { police: 0.25, fire: 0.35, ems: 0.5 };
/** 가장 좋은 의료 장비 × 장비 손잡이(medMul), 상한 1.1. 없으면 부서 기본값 (경찰 .25 · 소방 .35 · 구급 .5) */
export function medLevelOf(sim: Sim, rid: number): number {
  const r = sim.responders[rid], kit = r.kit;
  let m = 0;
  if (kit) for (let k = 0; k < kit.length; k++) { const v = KITS[kit[k].id].med; if (v !== undefined && v > m && !kit[k].faultKnown) m = v; }
  return m > 0 ? Math.min(1.1, m * sim.tune.medMul) : MED_BASE[r.dept];
}
/** 방패가 교전·봉쇄 중에 더하는 방호 */
const SHIELD_ARMOR = 0.3;
/** 총격 방호: 가장 좋은 방호 장비 (교전·봉쇄 중이면 + 방패) × 장비 손잡이(armorMul), 상한 0.8 */
export function armorOf(sim: Sim, rid: number, engaging: boolean): number {
  const kit = sim.responders[rid].kit;
  let m = 0, shield = false;
  if (kit) for (let k = 0; k < kit.length; k++) {
    if (kit[k].faultKnown) continue;
    const v = KITS[kit[k].id].armor;
    if (v !== undefined && v > m) m = v;
    if (kit[k].id === 'shield') shield = true;
  }
  if (engaging && shield) m += SHIELD_ARMOR;
  return Math.min(0.8, m * sim.tune.armorMul);
}
/** 폭발 피해에 곱하는 값: 폭발물 방호복 .35 · 방화복 .7 · 그 밖 1 */
export function blastFactor(sim: Sim, rid: number): number { return hasKit(sim, rid, 'bombSuit') ? 0.35 : hasKit(sim, rid, 'turnout') ? 0.7 : 1; }
/** 환자 자리 (구급차 2, 소방·의료 헬기 1, 나머지 0) */
export function seatsOf(u: Unit): number { return u.seats ?? 0; }
/**
 * 쓰인 환자 자리 (H1 §3.4-5): 실은 구조 대상 + 구조 대상이 아닌 환자(u.aboard — 다친 대원·용의자) 가운데 다른 부대의 대원과 용의자.
 * 자기 부대의 다친 대원은 원래 자기 자리에 타므로 세지 않는다 (자기 대원을 태우고 병원으로 가는 경찰차가 "자리 0"에 걸리지 않게).
 * 자리를 따지는 곳은 모두 seatsUsed(sim, u) 와 seatsOf(u) 를 견준다 — u.patients.length 를 직접 견주지 않는다.
 */
export function seatsUsed(sim: Sim, u: Unit): number {
  let n = u.patients.length;
  const ab = u.aboard;
  if (ab) for (let k = 0; k < ab.length; k++) if (ab[k].kind !== 'mate' || sim.responders[ab[k].id].unitId !== u.id) n++;
  return n;
}
/** 연기 속 일(위험한 건물 안의 수색·구출·이송, 진압·잔불 정리)을 새로 맡기에 공기가 모자란 문턱(초). R3 가 비율로 넓힌다 */
export const AIR_MIN = 45;
/** 공기 잔량 경고(초): 이 밑으로 떨어지면 기록을 남기고, 예비 공기통이 있으면 바꾸러 나간다 (brain.ts) */
export const AIR_LOW = 60;
/**
 * 공기가 모자란가: 공기호흡기를 멨는데 남은 공기가 문턱(AIR_MIN) 아래다. 공기호흡기가 없거나 공기를 세지 않는 대원은 해당 없음(false).
 * 자기 장비의 상태라 배정·판단(fitFor)이 읽어도 된다.
 */
export function airShort(sim: Sim, rid: number): boolean { const it = itemOf(sim, rid, 'scba'); return it !== null && it.uses !== undefined && it.uses < AIR_MIN; }
/** 공기호흡기로 연기 속에 들어갈 수 있는가: 메고 있고(알려진 고장이 아니다) 공기가 문턱 이상 남았다 */
export function scbaReady(sim: Sim, rid: number): boolean { return hasKit(sim, rid, 'scba') && !airShort(sim, rid); }
/** 공기통을 가득 채운다 (예비 공기통으로 바꿨거나, 부대가 집에 돌아왔다). 공기를 세지 않는 대원은 그대로다 */
export function refillAir(sim: Sim, rid: number): void { const it = itemOf(sim, rid, 'scba'); if (it !== null && it.uses !== undefined) it.uses = sim.tune.airFull; }
/**
 * 이 대원이 그 일을 할 장비를 갖췄는가 — 장비·부서와 **알려진 장비 상태**만 본다(숨은 고장은 모른다. 공기 잔량과 예비 공기통은 자기 조직의 상태다).
 * 오고 있는 부대에 그 일을 할 사람이 있는지 볼 때 쓴다(commander.anyCapable). 현장의 대원은 fitFor 가 본다.
 * 표에 없는 일은 true: 위험한 건물 안의 일은 현장 쪽 fitFor 와 "능력과 장비가 어긋나지 않는다"(tests/crews.test.ts ③)가 맡는다.
 */
export function capableOf(sim: Sim, rid: number, kind: WorkKind): boolean {
  switch (kind) {
    case 'suppress': case 'overhaul': {
      if (!hasKit(sim, rid, 'hose')) return false;
      // 공기가 된다: 공기호흡기가 없거나, 공기를 세지 않거나, 문턱 이상 남았거나, 그 부대에 예비 공기통이 있다
      return !airShort(sim, rid) || (sim.units[sim.responders[rid].unitId].spareAir ?? 0) > 0;
    }
    case 'defuse': return hasKit(sim, rid, 'eodKit');
    case 'engage': case 'perimeter': return hasFirearm(sim, rid);
    case 'arrest': return hasFirearm(sim, rid) || hasKit(sim, rid, 'taser');
    default: return true;
  }
}
const kitRngs = new WeakMap<Scene, Rng>();
/**
 * 개인 장비의 판정에 쓰는 현장별 난수 흐름 kit:<현장 id> (테이저 명중 등). 현장의 s.rng 는 명중·용의자 행동이 쓰는 흐름이라
 * 새 판정이나 효과 그림의 흔들림을 거기서 뽑으면 모든 교전 결과가 바뀐다 — 새 코드는 이 흐름만 쓴다.
 */
export function kitRng(sim: Sim, s: Scene): Rng {
  let r = kitRngs.get(s);
  if (!r) { r = sim.rng.fork('kit:' + s.id); kitRngs.set(s, r); }
  return r;
}
