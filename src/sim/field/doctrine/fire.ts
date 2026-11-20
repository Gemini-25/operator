// 대응 교본 — 소방 표 (docs/specs/R3-doctrine.md §3 · 등록 칸은 §3.6 표 그대로, 이 파일 안의 등록 순서도 그 표의 순서). 펌프차·구조 공작차, kits scba 인 줄은 화학·사다리차·소방 헬기 대원에게도 — F 줄 (3단계)
// 줄은 DocCtx 만 읽는다 (믿음·자기 몸·자기 장비 — tests/doctrine.test.ts 시험 1). 이 파일은 ./registry 와 타입·util 만 import 한다.
// 새 줄은 이 파일의 끝에 registerDoctrine({ id, dept, who, hook, works/gate/methods, kits/noKits, when, effect, rank, why, note, report }) 로 붙인다 (등록 순서가 결과를 바꾼다).
//
// 단계 3 (소방): F01(공기 30% 미만 — 공기 탈출 의무) · F02(짝이 나가면 따라 나간다 — 의무) · F03·F03b(공기 50% 미만 — 위험 실내 일·실내 진압 빼기) ·
//   F04·F04b·F04c(짝 없이 위험 실내에 들어가지 않는다 — fit·방법·판단 지점 interiorEntry) · F05·F05b(2인 밖 대기조 확인 전 진입 보류 — 판단 지점·방법) ·
//   F06(열화상을 든 대원이 연기 찬 구역 수색을 먼저) · F07(열화상 없이 짙은 연기 — 벽 더듬기 수색) · F08(용수 30% 아래 — 끊어 쏘기) · F09(물이 떨어진 관창수 — 수색·구조·이송) ·
//   F12(구명조끼 없이 빠른 물살에 헤엄치지 않는다 — 모든 분야) · F13(방화복 없이 위험 단계 1 구역의 일을 맡지 않는다) · F14(소방 표 대원의 중상) · F16(신입은 짝이 앞장선다).
//   F18(교통사고 현장의 소방차 차로 막기)은 방법 blockLane 이 생기는 6단계가 이 파일 끝에 붙인다. F10·F11·F17·F19 는 '있음'(지금·R1·R2·X6) — 등록하지 않는다(F10 의 예비 펌프 수는 brain·executor, 지휘는 CF3).
// 지휘·관제 줄(CF1~CF7 · D5, 그리고 특수 표의 관제 줄 D4 — 코드가 3단계라 이름표를 여기 둔다)의 이름표도 여기 둔다 (코드는 commander.ts · orders/doctrine.ts · orders/catastrophe.ts · dispatch/doctrine.ts).

import { CMD_ROWS, DOC_SWITCH, registerDoctrine } from './registry';
import type { DocCtx } from './registry';
import type { CasBelief, WorkKind } from '../../types';
import { dist } from '../../util';

/** 위험 실내 일의 종류 (§3 읽는 법의 HZ — 대상 구역이 위험 건물 실내인지는 c.hz 가 본다) */
const HZ: WorkKind[] = ['search', 'carry', 'escort', 'extricate', 'mitigate', 'overhaul'];
/** 가벼운 일 (H1 LIGHT_WORK 의 종류 — 처치·동료 처치가 안전 구역일 때만인 것은 c.light 가 본다) */
const LIGHT: WorkKind[] = ['traffic', 'perimeter', 'negotiate', 'interview', 'hookup', 'treat', 'treatMate'];
/** 공기 탈출·공기 문턱 (비율 — 엔진의 DOC.AIR_OUT·AIR_IN 과 같은 값. 시험이 둘이 같은지 본다) */
export const F_AIR_OUT = 0.30, F_AIR_IN = 0.50;
/** 들어서려는 일이 위험 실내인가: 위험 실내 일(c.hz), 또는 대상 구역이 위험 건물 실내인 진압 (판단 지점·방법 자리 — 진압은 실내 방법만 이 판단 지점에 온다) */
const inside = (c: DocCtx): boolean => c.hz || (c.w !== null && c.w.kind === 'suppress' && c.wRisky);
/** 업으려는 대상이 3칸 안이다 (F04·F04c 의 예외 — 믿음 속 구조 대상의 자리) */
const carryNear = (c: DocCtx): boolean => {
  if (c.w === null || c.w.kind !== 'carry' || c.w.cas < 0) return false;
  const cb = c.a.beliefs.val<CasBelief>('cas', c.w.cas);
  return cb !== undefined && dist(c.a.x, c.a.y, cb.x, cb.y) <= 3;
};
/**
 * 안에 사람이 있을 수 있다 (F05·F05b 의 예외 — §8.4 의 1번 손잡이를 돌렸다: 본문은 믿음 속 요구조자(sit.victimInside)만, 3단계 측정 뒤 신고 인원이 불명인 것도 "있을 수 있다"로).
 * 믿음 속 요구조자가 있거나, 신고 인원의 사실(occ)이 없거나 수가 불명이다
 */
const maybeInside = (c: DocCtx): boolean => { if (c.sit.victimInside) return true; const o = c.a.beliefs.val<{ count: number | null }>('occ', 0); return o === undefined || o.count === null; };
/** 지휘관이 정한 외부 방어 중인가 (믿음 속 지휘 상태 ops 사실 — id 0 의 mode) — 그때는 모두 밖에서 방수하므로 짝을 따지지 않는다 */
const exteriorMode = (c: DocCtx): boolean => { const o = c.a.beliefs.val<{ mode?: string }>('ops', 0); return o !== undefined && o.mode === 'defensive'; };
/** 기다림의 상한 (초): 지원이 오면 30, 아니면 20 (§4.4 interiorEntry) */
const entryWait = (c: DocCtx): number => (c.st.backup ? 30 : 20);
/** 자기 부대의 물 몫 (물탱크가 없으면 1 — 조직 정보) */
const waterShare = (c: DocCtx): number => (c.u.waterMax > 0 ? c.u.water / c.u.waterMax : 1);

registerDoctrine(
  {
    id: 'F01', dept: 'fire', name: '공기 30% 미만 — 짝과 함께 탈출', short: '공기 탈출',
    hook: 'duty', kits: ['scba'],
    when: (c) => (c.sit.inHazard || c.sense.smoke > 0.25) && c.st.air < F_AIR_OUT && !c.st.carrying && !(c.a.task !== null && c.a.task.kind === 'swapAir'),      // R1 의 공기통 교체로 이미 나가는 중이면 그대로
    effect: { kind: 'duty', act: 'airOut' },
    th: { air: F_AIR_OUT, smoke: 0.25 }, rank: 0, why: 'lowAir',
    note: '공기 30% 미만 — {mate}, 같이 나간다.',
    report: '{name} 대원은 공기 잔량이 30% 아래로 떨어지자 건물 밖으로 나와 공기통을 바꿨습니다.',
  },
  {
    id: 'F02', dept: 'fire', name: '짝이 나가면 따라 나간다', short: '짝 따라 나감',
    hook: 'duty', kits: ['scba'],
    when: (c) => c.sit.inHazard && !c.st.carrying && c.pair().rawOut,
    effect: { kind: 'duty', act: 'pairOut' },
    rank: 0, why: 'buddy',
    note: '{mate} 따라 나갑니다.',
  },
  {
    id: 'F03', dept: 'fire', name: '공기 50% 미만 — 위험 실내 새 일 맡지 않기', short: '공기 부족 — 진입 제외',
    hook: 'fit', works: HZ, kits: ['scba'],
    when: (c) => c.hz && c.st.air < F_AIR_IN,
    effect: { kind: 'fitMul', mul: 0 },
    th: { air: F_AIR_IN }, rank: 1, why: 'lowAir',
  },
  {
    id: 'F03b', dept: 'fire', name: '공기 50% 미만 — 실내 진압 빼기', short: '공기 부족 — 외부 방수',
    hook: 'method', works: ['suppress'], methods: ['interior', 'pulse'], kits: ['scba'],
    when: (c) => c.st.air < F_AIR_IN,
    effect: { kind: 'methodMul', mul: 0 },
    th: { air: F_AIR_IN }, rank: 1, why: 'lowAir',
  },
  {
    id: 'F04', dept: 'fire', name: '짝 없이 위험 실내에 들어가지 않는다', short: '짝 없음',
    hook: 'fit', works: [...HZ, 'suppress'], kits: ['scba'],
    // (3단계 측정 — 본문은 진압의 fit 을 막지 않고 실내 방법만 뺐다(F04b)) 위험 건물 실내의 진압도 짝이 따라올 수 없으면 맡지 않는다 — 지휘관 판단의 외부 방어(믿음 속 지휘 상태)는 예외.
    //   본문대로 두면 같은 부대의 관창수 둘이 서로 다른 구역의 진압을 받아 둘 다 혼자가 되어 둘 다 밖에서 방수했다(화재 진압이 크게 늦어졌다). 맡지 않은 관창수는 짝 동행(G08)으로 짝의 진압을 함께 한다
    //   (합치기 — 주 세션 결정 (라)) 혼자 서는 역할(기관원·사다리 조작원 — SOLO_OK)도 짝 없이는 위험 실내 일을 맡지 않는다: 본문 §5.1 은 그들을 F04 에서 뺐으나, 그러면 그들이 혼자 실내로 들어가
    //   (강제 fire/std 의 장면당 0.27명) 밖 대기조가 비고 F05 가 뒤에 온 진입조를 막았다. 짝(진압 팀장)이 따라오면 둘이 들어간다. 스위치 DOC_SWITCH.SOLO_IN (registry) — 구현 메모의 수치.
    //   (균형 — 사용자 결정 2026-11-16) 기본은 true(본문 §5.1 — 혼자 서는 역할은 이 줄에서 빠진다). 실내의 손은 건물 화재 첫 출동의 펌프차 한 대(관제 교본 — dispatch/doctrine.ts)로 메운다
    when: (c) => (c.hz || (c.w !== null && c.w.kind === 'suppress' && c.wRisky && !exteriorMode(c))) && (!DOC_SWITCH.SOLO_IN || !c.solo) && c.pair().forW === null,
    unless: carryNear,      // 예외: 믿음 속 구조 대상이 3칸 안이면 그 사람의 이송은 맡는다
    effect: { kind: 'fitMul', mul: 0 },
    th: { near: 3 }, rank: 2, why: 'alone',
  },
  {
    id: 'F04b', dept: 'fire', name: '짝 없이 실내 진압하지 않는다', short: '짝 없음 — 외부 방수',
    hook: 'method', works: ['suppress'], methods: ['interior', 'pulse'], kits: ['scba'],
    when: (c) => (!DOC_SWITCH.SOLO_IN || !c.solo) && c.wRisky && c.pair().forW === null,      // (합치기 (라)) 혼자 서는 역할도 — F04 와 같다
    effect: { kind: 'methodMul', mul: 0 },
    rank: 2, why: 'alone',
  },
  {
    id: 'F04c', dept: 'fire', name: '짝이 따라올 때까지 문턱에서 기다린다', short: '짝 기다림',
    hook: 'gate', works: [...HZ, 'suppress'], gate: 'interiorEntry', kits: ['scba'],
    when: (c) => inside(c) && (!DOC_SWITCH.SOLO_IN || !c.solo) && !c.pair().follows,      // (합치기 (라)) 혼자 서는 역할도 — F04 와 같다
    unless: carryNear,
    effect: { kind: 'block', maxWait: entryWait },
    th: { follow: 4, wait: 20, waitBackup: 30 }, rank: 2, why: 'buddy',
    note: '짝 없이 들어가지 않습니다.', outNote: '짝이 오지 않습니다 — 임무를 넘깁니다.',
    report: '{name} 대원은 짝을 기다리며 진입을 {n}초 미뤘습니다.',
  },
  {
    id: 'F05', dept: 'fire', name: '2인 대기조 확인 전 진입 보류', short: '대기조 확인 전 진입 보류',
    hook: 'gate', works: [...HZ, 'suppress'], gate: 'interiorEntry', kits: ['scba'],
    when: (c) => inside(c) && c.watch().n < c.watch().need,
    unless: maybeInside,      // 예외: 믿음 속 요구조자(구조 대상·신고 인원 > 찾은 수) 또는 신고 인원 불명 — 짝만 있으면 들어간다
    effect: { kind: 'block', maxWait: entryWait },
    th: { need: 1, watchR: 12, wait: 20, waitBackup: 30 }, rank: 2, why: 'outside',      // (3단계 측정) need 2 → 1·watchR 8 → 12 — DOC.WATCH_NEED·WATCH_R 의 메모
    note: '대기조 확인 전 진입 보류.', excNote: '요구조자 있음 — 대기조 없이 진입합니다.', outNote: '대기조가 갖춰지지 않습니다 — 진입을 거둡니다.',
    report: '{name} 대원은 밖에 대기조가 없어 진입을 {n}초 미뤘습니다.',
  },
  {
    id: 'F05b', dept: 'fire', name: '대기조 없이 실내 진압하지 않는다', short: '대기조 없음 — 외부 방수',
    hook: 'method', works: ['suppress'], methods: ['interior', 'pulse'], kits: ['scba'],
    when: (c) => c.wRisky && !maybeInside(c) && c.watch().n < c.watch().need,
    effect: { kind: 'methodMul', mul: 0 },
    rank: 2, why: 'outside',
  },
  {
    id: 'F06', dept: 'fire', name: '열화상 대원이 연기 찬 구역 수색을 먼저', short: '열화상 수색',
    who: { dept: ['fire'] }, hook: 'fit', works: ['search'], kits: ['tic'],
    when: (c) => c.w !== null && c.w.region >= 0 && (c.a.beliefs.val<number>('fire', c.w.region) ?? 0) > 0.25,
    effect: { kind: 'fitAdd', add: 0.15 },
    th: { fire: 0.25, add: 0.15 }, rank: 3, why: 'kit',
  },
  {
    id: 'F07', dept: 'fire', name: '열화상 없이 짙은 연기 — 벽 더듬기 수색', short: '벽 더듬기',
    hook: 'method', works: ['search'], methods: ['feel'], noKits: ['tic'],
    when: (c) => c.w !== null && c.w.region >= 0 && c.s.regions[c.w.region] !== undefined && c.s.regions[c.w.region].indoor && c.sense.smoke > 0.5,
    effect: { kind: 'methodMul', mul: 1.6 },
    th: { smoke: 0.5, mul: 1.6 }, rank: 3, why: 'noKit',
  },
  {
    id: 'F08', dept: 'fire', name: '용수 30% 아래 — 끊어 쏘기', short: '끊어 쏘기',
    hook: 'method', works: ['suppress'], methods: ['pulse'], kits: ['hose'],
    when: (c) => !c.u.hydrant && waterShare(c) < 0.3,
    effect: { kind: 'methodMul', mul: 1.6 },
    th: { water: 0.3, mul: 1.6 }, rank: 3, why: 'kit',
  },
  {
    id: 'F09', dept: 'fire', name: '물이 떨어진 관창수 — 수색·구조·이송을 돕는다', short: '용수 없음 — 수색·구조',
    hook: 'fit', works: ['search', 'carry', 'extricate', 'escort'], kits: ['hose'],
    when: (c) => c.u.waterMax > 0 && c.u.water <= 0 && !c.u.hydrant,
    effect: { kind: 'fitAdd', add: 0.1 },
    th: { add: 0.1 }, rank: 3, why: 'kit',
  },
  {
    id: 'F12', dept: 'fire', name: '구명조끼 없이 빠른 물살에 헤엄치지 않는다', short: '구명조끼 없음 — 헤엄 금지',
    hook: 'method', works: ['waterRescue'], methods: ['swim'], noKits: ['pfd'],
    when: (c) => c.m !== undefined && c.m.flow >= 0.07,
    effect: { kind: 'methodMul', mul: 0 },
    th: { flow: 0.07 }, rank: 0, why: 'danger',
  },
  {
    id: 'F13', dept: 'fire', name: '방화복 없이 위험 단계 1 구역의 일을 맡지 않는다', short: '방화복 없음',
    hook: 'fit', noKits: ['turnout'],
    when: (c) => c.sit.wDanger >= 1,
    effect: { kind: 'fitMul', mul: 0 },
    th: { level: 1 }, rank: 1, why: 'noKit',
  },
  {
    id: 'F14', dept: 'fire', name: '중상 — 위험 실내 일 줄이고 가벼운 일로', short: '가벼운 임무',
    who: { doc: ['fire'] },      // 경찰·의료·특수 표 대원은 P12·E11·G01 (한 대원에게 부상 줄이 둘 걸리지 않는다)
    hook: 'fit', works: [...HZ, 'suppress', ...LIGHT],
    when: (c) => c.st.band >= 1,
    effect: [
      { kind: 'fitMul', mul: 0.35, works: HZ, when: (c) => c.hz },
      { kind: 'fitMul', mul: 0.6, works: ['suppress'] },
      { kind: 'fitAdd', add: 0.2, works: LIGHT, when: (c) => c.light },
    ],
    th: { band: 1, mul: 0.35, suppress: 0.6, add: 0.2 }, rank: 1, why: 'hurt',
  },
  {
    id: 'F16', dept: 'fire', name: '신입은 짝이 앞장선다', short: '신입 — 짝 앞장',
    who: { dept: ['fire'] }, hook: 'fit', works: ['search'],
    when: (c) => c.st.rookie && c.hz && c.st.buddy !== null && !c.pair().rookie,
    effect: { kind: 'fitMul', mul: 0.5 },
    th: { rookie: 0.3, mul: 0.5 }, rank: 2, why: 'buddy',
  },
);

// 지휘·관제 줄의 이름표 (§6 — 기록·측정이 이름을 찾는다). 소방 분야 (CF1~CF7 · D5) — 그리고 특수 분야의 관제 줄 D4(사다리차 — §6.2 표의 분야가 특수다. 코드가 3단계라 이 파일에 둔다)
CMD_ROWS.push(
  { id: 'CF1', dept: 'fire', hook: 'cmd', name: '2인 대기조 확보 요청', short: '대기조 요청', why: 'outside' },
  { id: 'CF2', dept: 'fire', hook: 'cmd', name: '공기통 예비 소진 — 진압 부대 요청', short: '예비 공기 요청', why: 'lowAir' },
  { id: 'CF3', dept: 'fire', hook: 'cmd', name: '펌프 고장 — 진압 부대 교체', short: '펌프 교체 요청', why: 'noKit' },
  { id: 'CF4', dept: 'fire', hook: 'cmd', name: '유압 장비 고장 — 구조 장비 요청', short: '구조 장비 요청', why: 'noKit' },
  { id: 'CF5', dept: 'fire', hook: 'cmd', name: '측정기 없는 가스와 불씨 — 진입 금지', short: '잴 수 없는 가스', why: 'danger' },
  { id: 'CF6', dept: 'fire', hook: 'cmd', name: '예비 공기 없는 센 불 — 진입 인원 줄이기', short: '예비 공기 없음', why: 'lowAir' },
  { id: 'CF7', dept: 'fire', hook: 'cmd', name: '지휘관은 위험 실내 일을 맡지 않는다', short: '지휘관 밖에', why: 'protocol' },
  { id: 'D5', dept: 'fire', hook: 'dispatch', name: '바닷가가 아닌 수난 — 구조 공작차', short: '수난 구조 공작차', why: 'kit' },
  { id: 'D4', dept: 'special', hook: 'dispatch', name: '2층 화재 — 사다리차', short: '2층 화재 사다리차', why: 'kit' },
  // (균형 — 사용자 결정 2026-11-16) 2인 진입 + 밖 2인 대기로 줄어든 실내의 손을 첫 출동으로 메운다 (코드는 dispatch/doctrine.ts docNeeds)
  { id: 'D8', dept: 'fire', hook: 'dispatch', name: '건물 화재 — 첫 출동에 펌프차 하나 더', short: '건물 화재 펌프차 더', why: 'team' },
);

// ── (6단계) 교통 통제의 방법 — 소방차로 차로 막기 (F18. 방법 blockLane 이 6단계에 생겼다 — §3.2·§3.6·§3.7) ──
registerDoctrine(
  {
    // 교통사고 현장에 차량 화재나 연료 누출이 있다고 믿으면(불 믿음 · haz leak) 펌프차·사다리차 대원은 큰 차로 차로 입구를 막고 통제한다 (그 지점이 통제 전인지는 방법의 조건이 본다)
    id: 'F18', dept: 'fire', name: '교통사고의 차량 화재·연료 누출 — 소방차로 차로 입구를 막고 통제', short: '소방차 차단',
    who: { units: ['engine', 'ladder'] }, hook: 'method', works: ['traffic'], methods: ['blockLane'],
    when: (c) => c.s.kind === 'traffic' && (c.a.beliefs.list('haz').some((f) => f.value.kind === 'leak' && f.value.active) || c.a.beliefs.list('fire').some((f) => (f.value as number) > 0)),
    effect: { kind: 'methodMul', mul: 1.5 },
    th: { mul: 1.5 }, rank: 3, why: 'danger',
  },
);
