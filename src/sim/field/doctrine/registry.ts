// 대응 교본의 틀 (docs/specs/R3-doctrine.md §2.4·§2.5) — 잎 모듈: 타입과 배열뿐이다.
// field/doctrine.ts(엔진)가 이 파일을 import 하고, 분야별 줄 파일(common·police·fire·ems·special)도 이 파일만 import 한다.
// 줄 파일이 doctrine.ts 를 import 하면 doctrine.ts → 줄 → doctrine.ts 순환에서 배열이 초기화되기 전에 불린다 — 그래서 등록과 배열은 여기에 둔다.
//
// 등록 순서가 결과를 바꾼다(같은 순위의 줄끼리 먼저 등록된 줄이 이긴다 — §2.6). field/doctrine/index.ts 가 common → police → fire → ems → special 로 import 한다.
// 새 줄은 그 분야 파일의 끝에 붙인다 (CLAUDE.md 의 "시나리오의 순서" 함정과 같다).
//
// 단계 0 (틀): 줄이 하나도 없다. DOC_DEPTS_DONE 도 비어 있다 — 분야를 구현하는 단계(2 경찰 · 3 소방 · 4 의료 · 5 특수)가 더한다.

import type { Sim } from '../../engine';
import type { Dept, DocActId, DocDept, DocGateId, DocHook, DocWhy, FieldAgent, IncidentType, KitId, MethodId, RoleGroup, RoleId, Scene, Unit, UnitKind, WorkItem, WorkKind } from '../../types';
import type { Sense } from '../methods';

/** 대상 대원의 상태 (자기 모드 = 자기 몸, 보고 모드 = 남이 아는 만큼 — §2.4 의 표) */
export interface DocState {
  hp: number; band: number; bleeding: boolean;                  // 보고 모드에서 hp = -1 · bleeding = false (쓰지 않는다), band 는 'crew' 신고
  stamina: number; fitness: number; composure: number; experience: number; judgment: number; teamwork: number;
  rookie: boolean; veteran: boolean;             // experience < 0.3 · ≥ 0.7
  hasScba: boolean;                              // scba 를 들었다 (알려진 고장 제외 — gear.kitHas). 공기 잔량과 따로다
  air: number;                                   // 공기 비율 0..1 = gear.kitQty(scba) / sim.tune.airFull. scba 가 없으면 1
  spareAir: number;                              // 자기 부대의 예비 공기통
  gun: KitId | null;                             // 가진 총 (gear.gunOf — sniper > rifle > pistol)
  ammo: number; mag: number; magSize: number; perShot: number;   // 그 총의 탄 (총이 없으면 ammo = -1. 탄을 세지 않는 동안은 Infinity)
  ammoLow: boolean; ammoCrit: boolean;           // 마지막 탄창 / 발사 2회 이하
  reloading: boolean; ammoBox: number;           // 재장전 중 / 자기 부대의 탄약 상자
  shaken: boolean; underFire: boolean; inCover: boolean; carrying: boolean;
  buddy: FieldAgent | null; buddyNear: boolean;  // 쓸 수 있는 짝 (§5.2), 짝이 2.5칸 안
  mates: number;                                 // 같은 Dept 의 다른 활동 대원 가운데 6칸 안의 수
  alone: boolean;                                // buddy === null && mates === 0
  backup: boolean;                               // 같은 Dept 부대가 이 사건으로 오는 중 (I.assigned · u.state — 조직 정보)
}
/** 믿음 속 가장 가까운 활동 용의자 */
export interface DocThreat { id: number; x: number; y: number; d: number; weapon: 'gun' | 'knife' | 'none'; state: string; hostage: boolean; facing: number }
/** 상황 (믿음·생김새·공개 지휘 상태) */
export interface DocSit {
  kind: IncidentType; label: string;             // 유형, 관제의 이름표 (I.assessment 의 이름 — 변형의 진실이 아니다)
  phase: DocPhase;
  hot: boolean; outdoor: boolean; secure: boolean;
  threat: DocThreat | null;
  civAtRisk: boolean;                            // 믿음: 위협 2칸 안에 살아 있는 구조 대상, 또는 교전 중 총기 용의자와 같은 구역의 다친 구조 대상·인질
  inHazard: boolean;                             // 자기 자리가 위험 건물 실내 (fitFor 의 fireRisk 와 같은 믿음 판정)
  victimInside: boolean;                         // 믿음: 위험 건물 안에 살아 있는 구조 대상, 또는 신고 인원(occ) > 찾은 수
  danger: number;                                // X6: 믿음 ops 사실의 자기 구역 단계 (없으면 0)
  wDanger: number;                               // X6: 대상 작업 w 의 구역 단계 (w 가 없거나 구역이 없으면 danger 와 같다)
  ctlDone: boolean[];                            // 통제 지점별 교통 통제 끝 (ctl 사실)
  liveBomb: { x: number; y: number; d: number } | null;   // 믿음 haz bomb active (가장 가까운 것)
  defusing: boolean;                             // 동료의 겉: 누군가의 defuse 임무가 장치 곁(2칸)에서 진행 중
  patients: number;                              // 믿음: 처치·탑승을 기다리는 band ≥ 1 구조 대상 수
  seatsLeft: number;                             // 현장 부대의 남은 환자 자리 합 (gear.seatsLeft — 조직 정보)
  negotSec: number; entryOrdered: boolean;       // s.negotStart 부터의 초(협상 전이면 0), s.entryOrdered
  lanes2nd: boolean;                             // 이 현장 기록에 2차 사고가 있었다 (I.problems 의 SECONDARY_COLLISION)
  gunThreat: boolean;                            // (2단계) 믿음: 활동 중인 총기 용의자가 있다 (P22)
  fightThreat: boolean;                          // (2단계) 믿음: 교전(fight) 중인 용의자가 있다 (P08)
  bangOnScene: boolean;                          // (2단계) 동료의 장비(조직 정보): 현장의 활동 경찰 가운데 섬광탄을 가진 사람이 있다 (P14)
  bangComing: boolean;                           // (2단계) 조직 정보: 섬광탄을 실은 경찰 부대가 이 사건으로 오는 중 (P14 의 기다림 상한 40초)
  tendCas: number[];                             // (4단계) 동료의 겉: 다른 활동 구급 대원이 곁에 앉아 처치하고 있는 구조 대상 id (E08)
  medics: number;                                // (4단계) 동료의 겉: 다른 활동 구급 대원의 수 (E11 — 혼자면 배율을 걸지 않는다)
  alsOn: boolean;                                // (4단계) 명부: 다른 활동 대원 가운데 1급 응급구조사·의사가 있다 (E19)
  robotOn: boolean;                              // (5단계) 동료의 장비(조직 정보): 살아 있는 장치(liveBomb)가 있고 현장의 활동 대원 가운데 작동하는 로봇(알려진 고장 아님)을 든 사람이 있다 (S06b)
  bombPinned: boolean;                           // (5단계) 믿음: 살아 있는 장치 6칸 안에 옮길 수 없는 사람(거동 불가·갇힌 구조 대상, 인질을 붙든 용의자)이 있다 (S07)
  scbaOn: number;                                // (5단계) 동료의 장비(조직 정보): 화재 현장의 활동 대원 가운데 공기호흡기를 든 사람의 수 (자기 포함 — 화재 현장이 아니면 0. S19)
}
export type DocPhase = 'arrive' | 'sizeup' | 'standoff' | 'entry' | 'assault' | 'interior' | 'care' | 'transport' | 'traffic' | 'withdraw' | 'idle';
/** 교본 줄이 받는 단 하나의 입력. 줄의 when 은 이것만 읽는다 */
export interface DocCtx {
  sim: Sim; s: Scene; a: FieldAgent; u: Unit; dept: DocDept; role: RoleId | null; group: RoleGroup | null;
  mode: 'self' | 'report';                       // 자기 모드(대원 자신의 판단 — duty·act·gate·실행부의 방법 고르기) / 보고 모드(fit · methodFit — 남에게도 불린다)
  w: WorkItem | null;                            // fit·gate 의 대상 작업 (없으면 null)
  hz: boolean;                                   // (1단계) w 가 위험 실내 일인가 (§3 읽는 법의 HZ — 수색·이송·대피 안내·구출·누출 조치·잔불 정리이고 대상 구역이 위험 건물 실내 — 엔진의 hazWork). w 가 없으면 false
  wRisky: boolean;                               // (1단계) w 의 대상 구역이 위험 건물 실내인가 (종류와 상관없이 — G01 의 '위험 구역의 동료 구조'). w 가 없으면 false
  light: boolean;                                // (1단계) w 가 가벼운 일인가 (H1 LIGHT_WORK — 처치·동료 처치는 대상이 안전 구역에 있을 때만, injury.ts 의 정본 그대로). w 가 없으면 false
  st: DocState; sit: DocSit;
  sense: Sense;                                  // R2 의 Sense — 대원이 선 칸의 연기·열 (부르는 쪽이 잰다. 보고 모드에서는 0)
  dng: number;                                   // brain 의 위험 점수 (duty·act 자리에서 brain 이 넘긴다. 다른 자리에서는 0)
  has: (id: KitId) => boolean;                   // gear.kitHas — 들었는가 (알려진 고장 제외, 수량 무관)
  kit: (id: KitId) => number;                    // gear.kitCount (R2 — scba 는 0/1, 수량 장비는 남은 수)
  m?: { reach: number; flow: number; weak: boolean; tile: number };      // 방법 자리: R2 chooseMethod 가 사본에 채운다 (부르는 쪽은 채우지 않는다)
  see?: { stunned?: boolean };                   // 판단 지점 자리: 실행부가 시야 안에서 잰 것 (docGate 의 see — 용의자가 무력화된 것이 보인다)
  tg: DocThreat | null;                          // (2단계) 대상 용의자의 믿음: 대상 작업(없으면 지금 임무)의 용의자, 그것이 없으면 가장 가까운 활동 용의자(sit.threat)
  pack: { n: number; near: number; far: number };   // (2단계) 같은 용의자(tg)의 검거·교전을 맡은 다른 활동 동료의 수 · 그 가운데 2.6칸 안 · 2.6칸 밖 (동료의 겉 — P01~P03·P07·P14)
  dngSign: number;                               // (2단계) brain 의 위험 점수 가운데 X6 조짐의 몫 (act 자리에서 brain 이 넘긴다 — P11. 다른 자리에서는 0)
  hideSpot: () => { x: number; y: number } | null;   // (2단계) 숨을 자리 (자기 모드에서만 — 엔진의 coverSpot(…, 숨기)를 tg 에 대해 한 번만 잰다. 보고 모드·위협이 없으면 null)
  solo: boolean;                                 // (2단계) 혼자 규칙에서 빠지는 역할인가 (엔진의 SOLO_OK — 저격·관측수·처리 요원·기관원·사다리 조작원·구급 운전원·관측관 …)
  wBomb: number;                                 // (5단계) 대상 작업 w 의 자리(믿음)에서 가장 가까운 살아 있는 장치(믿음)까지의 거리 (w·장치가 없거나 자리를 모르면 Infinity — S08)
  pair: () => DocPair;                           // (3단계) 짝·짝의 일 — 엔진이 처음 물을 때 한 번 잰다(늦게). 줄은 이 함수로만 짝을 본다 (§5)
  watch: () => { n: number; need: number };      // (3단계) 밖 대기조 (§5.6): 대원에게 가장 가까운 출입구의 outsideWatch 수 · 필요한 수 watchNeed (2, 공기호흡기 대원을 태운 소방 부대가 오는 중이면 1) — 늦게 한 번
  unitIn: () => number;                          // (합치기 — 5단계 S11) 자기 부대의 다른 활동 대원 가운데 위험 건물 실내(이 대원의 믿음으로 본 위험 구역)에 선 사람의 수 (동료의 겉) — 늦게 한 번
}
/**
 * (3단계 — 소방) 짝과 밖 대기조 (§5.2·§5.4·§5.6). 엔진(doctrine.ts)이 그 대원의 믿음·동료의 겉·조직 정보로 잰다 — 줄 파일은 엔진을 import 할 수 없어서 값으로 넘긴다
 */
export interface DocPair {
  raw: FieldAgent | null;                        // 짝(a.buddy) — 쓸 수 있는가와 상관없이 (F02: 짝이 나가면 따라 나간다). 같은 현장에 없으면 null
  rawOut: boolean;                               // 그 짝이 나가는 중이다: 공기 탈출·짝 따라 나가기·후퇴·철수 임무, 또는 물러나 후송을 기다린다(withdrawn) (F02)
  forW: FieldAgent | null;                       // 쓸 수 있는 짝 가운데 대상 작업 w 에 따라올 수 있는 짝 (§5.2 의 buddyOf(w) — F04·P17. w 가 없으면 buddyOf())
  follows: boolean;                              // 짝이 따라온다 (§5.4 끝 — F04c·P17b): 짝의 임무가 나를 따르는 짝 동행이거나 같은·이웃 구역의 위험 실내 일이고, 4칸 안
  rookie: boolean;                               // 쓸 수 있는 짝이 신입이다 (경험 < 0.3 — 명부, F16)
  job: { w: WorkItem; p: number; hz: boolean; hot: boolean } | null;   // 쓸 수 있는 짝이 맡은 작업판 일 (G08): 우선도 · 위험 실내 일인가 · 확보 전 무장 현장의 수색인가 (이 대원의 믿음으로)
  canFollow: boolean;                            // 이 대원이 그 일에 따라 들어갈 수 있다: 위험 실내면 공기호흡기(공기 AIR_IN 이상), 확보 전 수색이면 총을 든 경찰, 걸을 수 있는 다친 대원이 아니다 (조직 정보·자기 장비)
  myP: number;                                   // 이 대원이 지금 맡은 작업판 일의 우선도 (-1 = 손이 빔 — 임무 없음·대기, 9 = 작업판 밖의 일에 묶여 있다 — 휴식·장비 교체 …)
  myIn: boolean;                                 // 이 대원이 지금 맡은 일이 위험 실내로 들어가는 일이다 (그 일은 짝 동행으로 놓지 않는다 — §3.5 G08 의 "바깥 일")
  alt: boolean;                                  // 짝의 일과 같은·이웃 구역에 이 대원이 맡을 수 있는 빈 위험 실내 일이 있다 (G08 의 예외 — 그 일을 맡으면 §5.4 끝의 "짝이 따라온다"로 센다)
  ordered: boolean;                              // (합치기 (나)) 이 대원이 받은 지시(공개 지휘 상태)가 짝의 일과 같은·이웃 구역의 위험 실내 일이다 — 짝 동행 대신 그 일을 한다 (G08 의 예외, 짝 동행의 끝)
}

/** 효과 하나. fit·method 효과는 자기 works·methods·when 을 더 가질 수 있다 (한 줄이 일마다 다른 배율을 줄 때) */
export type DocEffect =
  | { kind: 'fitMul'; mul: number; works?: WorkKind[]; when?: (c: DocCtx) => boolean; drop?: boolean }   // 곱한다. 0 = 그 일을 맡지 않는다. drop = 하던 그 임무도 놓는다. mul 1 = 기록 전용
  | { kind: 'fitAdd'; add: number; works?: WorkKind[]; when?: (c: DocCtx) => boolean }                   // 0 이 아닐 때만 더한다 (선호가 자격을 만들지 않는다)
  | { kind: 'duty'; act: DocActId }                                  // 의무 — 점수 없이 그 자리에서 바꾼다
  | { kind: 'act'; act: DocActId; score: number | ((c: DocCtx) => number) }
  | { kind: 'methodMul'; mul: number; methods?: MethodId[]; when?: (c: DocCtx) => boolean }              // R2 방법 점수에 곱한다. 0 = 후보에서 뺀다
  | { kind: 'block'; maxWait: number | ((c: DocCtx) => number) }    // 판단 지점에서 막는다. maxWait 초가 지나면 timeout 갈래 (§4.4)
  | { kind: 'choose'; opt: 'cover' | 'save' | 'stack' | 'immobilize' };   // 판단 지점에서 막지 않고 갈래만 고른다
export interface DoctrineRule {
  id: string;            // 'P07' — 표 글자 + 번호. 한 줄이 두 자리에 걸리면 같은 번호에 글자를 붙여 따로 등록한다('F04'·'F04b'). 측정·보고서는 앞 세 글자로 묶어 센다
  dept: DocDept;         // 어느 표의 줄인가
  name: string;          // 패널 이름 ('혼자 방 진입 금지')
  short: string;         // 요약 줄의 짧은 이름 ('단독 진입 보류')
  who?: { dept?: Dept[]; doc?: DocDept[]; roles?: RoleId[]; groups?: RoleGroup[]; units?: UnitKind[] };   // 없으면 누구나. 칸끼리는 그리고(AND)
  hook: DocHook;
  swap?: 'retreat';      // act 줄 가운데 docAct 후보가 아니라 후퇴 후보를 바꿔 끼우는 줄 (P11 — docRetreat 가 본다)
  works?: WorkKind[];    // fit·method·gate: 이 임무만 (없으면 모두). 효과의 works 는 그 안에서 더 좁힌다
  gate?: DocGateId | DocGateId[];   // gate 줄의 판단 지점
  methods?: MethodId[];  // method 줄이 배율을 주는 방법 (효과의 methods 가 있으면 그것)
  kits?: KitId[];        // 이 가운데 하나라도 쓸 수 있어야 걸린다 (scba 는 들었는지만 — 남은 공기는 when 이 st.air 로)
  noKits?: KitId[];      // 이 가운데 아무것도 쓸 수 없어야 걸린다 — '장비 때문에'를 센다 (까닭 noKit)
  when: (c: DocCtx) => boolean;      // 상황·상태 술어. DocCtx 만 읽는다. 예외는 여기 또는 아래 unless 에 넣는다 (§2.6 — "허락" 줄을 따로 두지 않는다)
  unless?: (c: DocCtx) => boolean;   // (2단계) 같은 줄의 예외: 참이면 이 줄이 걸리지 않는다 (when 의 '그리고 아니다'와 같다). 따로 두는 까닭은 기록뿐이다 —
                                     //   판단 지점이 "예외가 처음 결정을 바꾼 때"(§2.7)를 알고 excNote 를 한 번 남긴다
  excNote?: string;                  // (2단계) 예외로 막지 않았을 때의 기록 문구 (판단 지점 — 임무마다 한 번)
  outNote?: string;                  // (2단계) 기다림이 상한에 닿았을 때의 기록 문구 (판단 지점 — §4.4 의 timeout 갈래)
  dropNote?: string;                 // (2단계) drop 금지가 하던 임무를 놓게 했을 때의 기록 문구 (brain 의 docDrop 자리 — 같은 대원·같은 줄 20초에 한 번)
  effect: DocEffect | DocEffect[];
  th?: Record<string, number>;       // 문턱 상수 (when 이 읽는 수 — 표·패널·테스트가 같은 값을 본다)
  rank: 0 | 1 | 2 | 3;               // 0 생명 · 1 보호 · 2 짝·지원·절차 · 3 장비·효율
  why: DocWhy;
  note?: string;                     // 기록 문구 템플릿 ({name}·{mate}·{new}·{n}·{m}·{k}·{s}) — 없으면 기록 없이 센다
  report?: string;                   // 보고서 문장 템플릿 (§7.3) — 없으면 보고서에 싣지 않는다
}
/** 개인 교본 줄 (등록 순서 그대로) */
export const DOCTRINE: DoctrineRule[] = [];
export function registerDoctrine(...rules: DoctrineRule[]): void { for (const r of rules) DOCTRINE.push(r); }
/** 지휘·관제·추격 줄의 이름표 (코드는 orders/doctrine.ts · dispatch/doctrine.ts · orders/catastrophe.ts 에 있다. 기록·측정만 이 표로 이름을 찾는다) */
export const CMD_ROWS: { id: string; dept: DocDept; hook: 'cmd' | 'dispatch' | 'chase'; name: string; short: string; why: DocWhy }[] = [];
/**
 * (2단계) 지휘·관제 줄 가운데 설계서가 "확인 필요 — 균형"으로 적은 것의 스위치 (§6.1 CP4 · §6.2 D6 · §8.4 의 손잡이 — D7 의 앞막기).
 * 코드는 commander.ts · dispatch/doctrine.ts 에 있고 이 값만 본다 (줄을 끄는 균형 손잡이 — 측정·시험이 바꿔 볼 수 있게 한 곳에 둔다)
 */
export const DOC_SWITCH = { CP4: true, D6: true, D7: true,
  SOLO_IN: false };      // (합치기 — 주 세션 결정 (라)) 혼자 서는 역할(기관원·사다리 조작원)의 위험 실내 단독 작업: false = 하지 않는다 — 짝이 따라올 때만(F04·F04b·F04c), true = 본문 §5.1(그 역할을 F04 에서 뺀다)
/** 줄이 다 들어간 분야 — 시험 8 의 "분야마다 12줄 이상"은 여기 든 분야만 본다 (단계마다 그 분야를 더한다 — 2단계 경찰) */
export const DOC_DEPTS_DONE: DocDept[] = ['police',
  'fire',      // (3단계 소방)
  'special'];      // (5단계 특수) — 의료(4단계)는 파일 끝에서 push 한다

/** 판단 지점의 답: ok = 그 걸음을 해도 된다 · rule = 막은(알릴) 줄 · wait = 막은 줄들의 maxWait 가운데 가장 긴 값 · opt = choose 줄이 고른 갈래 */
export interface DocGateAns { ok: boolean; rule: string | null; wait: number; opt: string | null; exc: string | null }      // exc = (2단계) 예외(unless)가 아니었다면 막았을 줄 (막는 줄이 없을 때만)
/** 의무·행동 후보 하나 (한 판단에 하나 — §2.6) */
export interface DocPick { rule: DoctrineRule; act: DocActId; score: number }
/** fit 자리의 자세한 답: fit = 교본을 넣은 값, base = 교본 전의 값, hits = 걸린 줄과 그 줄이 준 배율·가산 (assign 의 1등 비교가 쓴다 — §2.7) */
export interface DocFitAns { fit: number; base: number; hits: { rule: DoctrineRule; mul: number; add: number; drop: boolean }[] }

/** 줄 번호(앞 세 글자)로 묶은 이름 (패널·보고서). 개인 줄이 없으면 지휘·관제 줄에서 찾는다 */
export function ruleName(id: string): { name: string; short: string } | null {
  for (let k = 0; k < DOCTRINE.length; k++) if (DOCTRINE[k].id === id) return DOCTRINE[k];
  for (let k = 0; k < CMD_ROWS.length; k++) if (CMD_ROWS[k].id === id) return CMD_ROWS[k];
  return null;
}

// (4단계 의료) 줄이 다 들어간 분야에 의료를 더한다 — 3·4·5 단계를 나란히 돌려 합치므로 위의 배열 글자를 고치지 않고 파일 끝에 줄을 더한다
DOC_DEPTS_DONE.push('ems');
