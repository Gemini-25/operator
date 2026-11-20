// 대응 교본 — 의료 표 (docs/specs/R3-doctrine.md §3 · 등록 칸은 §3.6 표 그대로, 이 파일 안의 등록 순서도 그 표의 순서). 구급차·의료 헬기 — E 줄 (4단계, E13·E14 는 6단계)
// 줄은 DocCtx 만 읽는다 (믿음·자기 몸·자기 장비 — tests/doctrine.test.ts 시험 1). 이 파일은 ./registry 와 타입·util 만 import 한다.
// 새 줄은 이 파일의 끝에 registerDoctrine({ id, dept, who, hook, works/gate/methods, kits/noKits, when, effect, rank, why, note, report }) 로 붙인다 (등록 순서가 결과를 바꾼다).
//
// 단계 4 (의료): E01(분류는 1급 응급구조사가 먼저) · E02~E04(위중 환자의 처치 방법 — 제세동기·의사 장비) · E05(경계 밖 처치소 — 기록 전용, 자격은 fitFor 의 treat) ·
//   E08(구급 동료가 처치 중인 환자는 들지 않는다 — 판단 지점 carryHold) · E11(의료 표 대원의 중상) · E12(차로 위 처치 보류 — 판단 지점 laneTreat) ·
//   E18(지친 구급 대원은 위중 처치를 새로 맡지 않는다) · E19(신입 응급구조사는 선임이 있으면 옮기기를 돕는다) · E20(동요한 구급 대원은 경계 밖 처치소에 가지 않는다).
//   지휘 줄 CE1~CE5 의 이름표는 아래 CMD_ROWS (코드는 orders/doctrine.ts · commander.assign · sceneManager 4번 블록).
// 대상 환자는 그 대원의 믿음('cas' 사실 — c.w.cas)으로, 동료의 처치·구급 대원 수는 엔진이 동료의 겉으로 센 c.sit 의 칸(tendCas·medics·alsOn)으로 본다.

import { CMD_ROWS, registerDoctrine } from './registry';
import type { DocCtx } from './registry';
import type { CasBelief, WorkKind } from '../../types';

/** 대상 작업의 환자에 대한 그 대원의 믿음 (없으면 undefined) */
function casOf(c: DocCtx): CasBelief | undefined { return c.w !== null && c.w.cas >= 0 ? c.a.beliefs.val<CasBelief>('cas', c.w.cas) : undefined; }
/** 대상 환자가 위중(band 2)이라고 믿는다 */
const red = (c: DocCtx): boolean => { const cb = casOf(c); return cb !== undefined && cb.band === 2; };
/** 대상 환자가 안전 구역(경계 밖 처치소)에 나와 있다고 믿는다 */
const atSafe = (c: DocCtx): boolean => { const cb = casOf(c); return cb !== undefined && cb.where === 'safe'; };
/**
 * 대상 환자가 차로 줄 위에 있고 그 차로로 차가 들어오는 쪽의 통제 지점이 아직 통제됐다고 모른다 (생김새 s.laneRows·s.controlPts 와 믿음 'ctl').
 * 차로 줄 k = 0 은 동쪽(통제 지점 1)에서, k = 1 은 서쪽(통제 지점 0)에서 차가 들어온다 — 교통사고 현장의 생김새 (hazards.tickLane 과 같은 짝)
 */
function onOpenLane(c: DocCtx, cb: CasBelief): boolean { return openLaneRow(c, cb.y); }
/** 그 줄(y)이 차로 줄이고 그 차로로 차가 들어오는 쪽의 통제 지점이 아직 통제됐다고 모른다 (대상 환자의 자리 — E12 · 대원 자신이 선 자리 — E13) */
function openLaneRow(c: DocCtx, y: number): boolean {
  const rows = c.s.laneRows;
  for (let k = 0; k < rows.length; k++) {
    if (Math.round(y) !== rows[k]) continue;
    const cp = rows.length === 2 ? (k === 0 ? 1 : 0) : k;
    if (c.sit.ctlDone[cp] !== true) return true;
  }
  return false;
}
/** 가벼운 일 (H1 LIGHT_WORK 의 종류 — 처치·동료 처치가 안전 구역일 때만인 것은 c.light 가 본다) */
const LIGHT: WorkKind[] = ['traffic', 'perimeter', 'negotiate', 'interview', 'hookup', 'treat', 'treatMate'];

registerDoctrine(
  {
    id: 'E01', dept: 'ems', name: '다수 사상자 — 분류는 선임 구급 대원이 먼저', short: '분류 먼저',
    hook: 'fit', works: ['triage'],
    when: () => true,      // 분류 작업이 있을 때(지휘 CE1 — 믿음 속 기다리는 환자 4명 이상 또는 관제의 다수 사상자 판단)
    effect: [
      { kind: 'fitAdd', add: 0.3, when: (c) => c.role === 'paramedic' },
      { kind: 'fitAdd', add: 0.2, when: (c) => c.role === 'emt' },
      { kind: 'fitAdd', add: 0.1, when: (c) => c.role === 'doctor' },
    ],
    th: { paramedic: 0.3, emt: 0.2, doctor: 0.1 }, rank: 2, why: 'triage', note: '다수 사상자 — 먼저 분류합니다.',
  },
  {
    id: 'E02', dept: 'ems', name: '위중 · 거동 불가 — 제세동기로 현장 소생 후 이송', short: '제세동기 — 현장 소생',
    hook: 'method', works: ['treat'], methods: ['stay'], kits: ['aed'],
    when: (c) => { const cb = casOf(c); return cb !== undefined && cb.band === 2 && cb.mob !== 'mobile'; },
    effect: { kind: 'methodMul', mul: 1.3 },
    th: { band: 2, mul: 1.3 }, rank: 3, why: 'kit', note: '제세동기 준비 — 현장에서 소생술.',
  },
  {
    id: 'E03', dept: 'ems', name: '위중 · 제세동기 없음 — 가슴 압박하며 바로 이송', short: '제세동기 없음 — 즉시 이송',
    hook: 'method', works: ['treat'], methods: ['rush'], noKits: ['aed'],
    when: red,
    effect: { kind: 'methodMul', mul: 1.5 },
    th: { band: 2, mul: 1.5 }, rank: 3, why: 'noKit', note: '제세동기 없음 — 가슴 압박하며 바로 이송합니다.',
  },
  {
    id: 'E04', dept: 'ems', name: '의사·항공 간호사 — 위중 환자는 현장 전문 처치 후 이송', short: '현장 전문 처치',
    who: { roles: ['doctor', 'flightNurse'] },
    hook: 'method', works: ['treat'], methods: ['stay', 'rush'], kits: ['doctorKit', 'alsBag'],
    when: red,
    effect: [{ kind: 'methodMul', mul: 1.3, methods: ['stay'] }, { kind: 'methodMul', mul: 0.7, methods: ['rush'] }],
    th: { stay: 1.3, rush: 0.7 }, rank: 3, why: 'kit', note: '현장에서 전문 처치 후 이송합니다.',
  },
  {
    // 기록 전용(배율 1): 안전 확보 전의 무장 현장에서 안전 구역의 환자를 구급 대원이 맡는 자격은 agents.fitFor 의 treat 기본 규칙이 연다(교본은 0 을 열지 못한다).
    // 이 줄은 그 처치를 센다 — 실행기의 처치가 그 현장에서 처음 한 번 문구와 함께 남긴다(doctrineRun.careMark)
    id: 'E05', dept: 'ems', name: '경계 밖 처치소 — 안전 구역의 환자는 구급 대원이 처치', short: '경계 밖 처치소',
    who: { dept: ['ems'] },
    hook: 'fit', works: ['treat'],
    when: (c) => c.sit.hot && atSafe(c),
    effect: { kind: 'fitMul', mul: 1 },
    rank: 2, why: 'protocol', note: '경계 밖 처치소에서 처치합니다.',
  },
  {
    id: 'E08', dept: 'ems', name: '구급 대원이 처치 중인 환자는 들지 않는다', short: '처치 대기',
    hook: 'gate', gate: 'carryHold', works: ['carry'],
    when: (c) => c.w !== null && c.sit.tendCas.indexOf(c.w.cas) >= 0 && c.sense.smoke <= 0.3 && c.sense.heat <= 0.3 && !c.sit.inHazard && c.sit.wDanger < 2,      // 예외(연기·열·위험 건물 실내·X6 단계 2 이상)는 when 안에 — 그때는 먼저 옮긴다
    effect: { kind: 'block', maxWait: 15 },
    th: { smoke: 0.3, heat: 0.3, wait: 15 }, rank: 2, why: 'protocol', note: '처치 끝나면 옮기겠습니다.',
  },
  {
    id: 'E11', dept: 'ems', name: '중상 — 현장 처치 줄이고 안전 구역의 가벼운 일로', short: '부상 — 안전 구역 처치',
    who: { doc: ['ems'] },      // 경찰·소방·특수 표 대원은 P12·F14·G01 (한 대원에게 부상 줄이 둘 걸리지 않는다)
    hook: 'fit', works: LIGHT,
    when: (c) => c.st.band >= 1 && c.sit.medics > 0,      // 현장에 다른 활동 구급 대원이 없으면 배율을 걸지 않는다
    effect: [
      { kind: 'fitMul', mul: 0.5, works: ['treat'], when: (c) => !c.light },      // 안전 구역 밖의 현장 처치
      { kind: 'fitAdd', add: 0.2, when: (c) => c.light },      // 가벼운 일 (안전 구역의 처치·동료 처치 포함) — 들어 싣기(load)는 무거운 일이라 더하지 않는다
    ],
    th: { band: 1, mul: 0.5, add: 0.2 }, rank: 1, why: 'hurt',
  },
  {
    id: 'E12', dept: 'ems', name: '차로 통제 전 — 차로 위에서 처치하지 않는다', short: '차로 통제 대기',
    hook: 'gate', gate: 'laneTreat', works: ['treat'],
    when: (c) => { const cb = casOf(c); return cb !== undefined && cb.where === 'scene' && onOpenLane(c, cb) && !(cb.mob === 'trapped' && cb.veh !== undefined); },      // 차 안에 갇힌 환자(구출 전)는 막지 않는다 (§3.6)
    effect: { kind: 'block', maxWait: 20 },
    th: { wait: 20 }, rank: 1, why: 'danger', note: '차로 통제 전 — 차로 밖으로 옮긴 뒤 처치합니다.', outNote: '더 기다릴 수 없습니다 — 그 자리에서 처치합니다.',
  },
  {
    id: 'E18', dept: 'ems', name: '지친 구급 대원 — 위중 처치를 새로 맡지 않는다', short: '지침 — 위중 처치 넘김',
    who: { dept: ['ems'] },
    hook: 'fit', works: ['treat'],
    when: (c) => red(c) && c.st.stamina < 30,      // 지구력은 조직 정보 (하던 처치는 지금처럼 22 까지)
    effect: { kind: 'fitMul', mul: 0.3 },
    th: { stamina: 30, mul: 0.3 }, rank: 2, why: 'tired',
  },
  {
    id: 'E19', dept: 'ems', name: '신입 응급구조사 — 선임이 위중 처치, 신입은 옮기기', short: '신입 — 이송 보조',
    who: { roles: ['emt'] },
    hook: 'fit', works: ['treat', 'load', 'carry'],
    when: (c) => c.st.rookie && c.sit.alsOn,      // 현장에 1급 응급구조사·의사가 활동 중 (혼자면 걸지 않는다)
    effect: [{ kind: 'fitMul', mul: 0.6, works: ['treat'], when: red }, { kind: 'fitAdd', add: 0.1, works: ['load', 'carry'] }],
    th: { rookie: 0.3, mul: 0.6, add: 0.1 }, rank: 3, why: 'protocol',
  },
  {
    id: 'E20', dept: 'ems', name: '동요한 구급 대원은 경계 밖 처치소에 가지 않는다', short: '동요 — 경계 처치 제외',
    who: { dept: ['ems'] },
    hook: 'fit', works: ['treat'],
    when: (c) => c.st.shaken && c.sit.hot && atSafe(c),
    effect: { kind: 'fitMul', mul: 0 },
    rank: 1, why: 'shaken',
  },
);

CMD_ROWS.push(
  { id: 'CE1', dept: 'ems', hook: 'cmd', name: '다수 사상자 — 분류부터, 중상 처치는 분류 뒤', short: '분류 먼저', why: 'triage' },
  { id: 'CE2', dept: 'ems', hook: 'cmd', name: '비구급 대원의 처치를 구급 대원이 넘겨받는다', short: '처치 넘겨받기', why: 'protocol' },
  { id: 'CE3', dept: 'ems', hook: 'cmd', name: '자리 하나 — 더 위중한 환자 먼저 탑승', short: '위중 먼저 탑승', why: 'triage' },
  { id: 'CE4', dept: 'ems', hook: 'cmd', name: '위중 환자 · 자리 없음 · 구급차가 멀다 — 항공 이송 요청', short: '항공 이송 요청', why: 'danger' },
  { id: 'CE5', dept: 'ems', hook: 'cmd', name: '이송 출발 전에 지휘를 넘긴다', short: '지휘 넘김', why: 'protocol' },
);

// ── (6단계) 이송 — 척추 고정(E13 · 판단 지점 carryStart)과 끌기(E14 · 방법 drag). 판단 지점과 방법이 6단계에 생겼다 (§3.3·§3.6·§3.7) ──
/** 대상 환자가 거동 불가라고 믿는다 (갇힌 사람은 옮길 수 없다 — 이송 임무가 없다) */
const cantWalk = (c: DocCtx): boolean => { const cb = casOf(c); return cb !== undefined && cb.mob === 'immobile'; };
registerDoctrine(
  {
    // 교통사고·붕괴 현장의 거동 불가 환자를 처음 들 때 — 척추 고정판을 든 대원은 들기 전에 3초 고정한다(실행기가 c.immob 을 적는다 — doctrineRun.runCarry).
    // 선 자리의 연기·열이 짙으면 고정하지 않고 바로 옮긴다. 환자가 통제되지 않은 차로 위에 있거나 대원 자신이 그런 차로에 서 있어도 그렇다
    // (E12 와 같은 판정 — 차가 들어오는 차로에 3초 더 서 있지 않는다: 먼저 차로 밖으로. 버스 곁의 환자를 드는 자리가 차로 줄이었다).
    // 고정하지 않고 옮기면 꺼낸 사람(차·잔해)은 옮기는 동안 더 나빠진다 (R1 의 고정판 효과 — 조건을 '고정했는가'로)
    id: 'E13', dept: 'ems', name: '교통사고·붕괴 — 척추 고정 후 이송', short: '척추 고정',
    hook: 'gate', gate: 'carryStart', works: ['carry'], kits: ['spineBoard'],
    when: (c) => { const cb = casOf(c); return (c.s.kind === 'traffic' || c.s.kind === 'collapse') && cb !== undefined && cb.mob === 'immobile' && !onOpenLane(c, cb) && !openLaneRow(c, c.a.y) && c.sense.smoke <= 0.3 && c.sense.heat <= 0.3; },
    effect: { kind: 'choose', opt: 'immobilize' },
    th: { sec: 3, smoke: 0.3, heat: 0.3 }, rank: 3, why: 'kit', note: '척추 고정 후 이송합니다.',
  },
  {
    // 들것 없이 혼자, 선 자리의 연기가 짙다 — 업지 않고 낮게 끌어 나간다 (끌기 0.5 × 1.6 = 0.80 > 업기 0.70). 옮기는 동안 대상·대원의 연기 피해 ×0.5, 속도는 혼자 업기의 ×0.85
    id: 'E14', dept: 'ems', name: '들것 없이 혼자 · 짙은 연기 — 낮게 끌어 나간다', short: '끌기',
    hook: 'method', works: ['carry'], methods: ['drag'], noKits: ['stretcher'],
    when: (c) => c.st.alone && c.sense.smoke > 0.3 && cantWalk(c),
    effect: { kind: 'methodMul', mul: 1.6 },
    th: { smoke: 0.3, mul: 1.6 }, rank: 1, why: 'danger',
  },
);
