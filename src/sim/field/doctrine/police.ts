// 대응 교본 — 경찰 표 (docs/specs/R3-doctrine.md §3.1 · 등록 칸은 §3.6 표 그대로, 이 파일 안의 등록 순서도 그 표의 순서). 순찰·기동, who.dept police 인 줄은 특공·폭발물 대원에게도 — P 줄 (2단계)
// 줄은 DocCtx 만 읽는다 (믿음·자기 몸·자기 장비 — tests/doctrine.test.ts 시험 1). 이 파일은 ./registry 와 타입·util 만 import 한다.
// 새 줄은 이 파일의 끝에 registerDoctrine({ id, dept, who, hook, works/gate/methods, kits/noKits, when, effect, rank, why, note, report }) 로 붙인다 (등록 순서가 결과를 바꾼다).
//
// 단계 2 (경찰): P01·P02·P03(흉기 상대에게 붙기 — arrest 의 closeIn) · P05(엄폐 사격 자리) · P07(혼자 방·동시 진입 보류) · P08·P09·P10(탄약 — 보급·엄폐) · P11(피격 — 후퇴 대신 엄폐) ·
//   P12(경찰 표 대원의 중상) · P14(섬광탄 없는 인질 덮침 제한 — engage 의 closeIn) · P15(마지막 섬광탄 아끼기) · P16(협상 중 교전 — 엄폐) · P22(탄 위급 — 총기 상대 위치를 넘긴다).
//   P17·P17b(확보 전 무장 현장의 수색은 짝과 함께 — 짝 맺기와 판단 지점 interiorEntry 가 3단계)·P20(교통 통제의 차량 차단 — 방법 blockLane 이 6단계)은 그 단계가 이 파일 끝에 붙인다.
// 지휘·관제·추격 줄(CP1~CP4 · D3·D6·D7)의 이름표도 여기 둔다 (코드는 commander.ts · orders/doctrine.ts · dispatch/doctrine.ts).

import { CMD_ROWS, registerDoctrine } from './registry';
import type { DocCtx, DocThreat } from './registry';
import type { WorkKind } from '../../types';

/** 가벼운 일 가운데 협상을 뺀 것 (H1 LIGHT_WORK — 처치·동료 처치가 안전 구역일 때만인 것은 c.light 가 본다) */
const LIGHT_NO_NEG: WorkKind[] = ['traffic', 'perimeter', 'interview', 'hookup', 'treat', 'treatMate'];
/** 대상 용의자 (대상 작업·지금 임무의 용의자, 없으면 가장 가까운 활동 용의자) */
const tgt = (c: DocCtx): DocThreat | null => c.tg ?? c.sit.threat;
/** 믿음 속 가장 가까운 위협이 교전 중인 총기 용의자 */
const gunFight = (c: DocCtx): boolean => c.sit.threat !== null && c.sit.threat.weapon === 'gun' && c.sit.threat.state === 'fight';
/** 흉기(또는 맨손)를 들고 맞서는(fight) 대상 */
const melee = (c: DocCtx, bare: boolean): boolean => { const t = tgt(c); return t !== null && t.state === 'fight' && (t.weapon === 'knife' || (bare && t.weapon === 'none')); };
/** 믿음 속 대상이 대원을 등졌다 (바라보는 쪽과 대원 쪽의 차가 100° 넘게) */
const facingAway = (c: DocCtx): boolean => {
  const t = tgt(c);
  if (t === null) return false;
  let d = Math.abs(Math.atan2(c.a.y - t.y, c.a.x - t.x) - t.facing) % (2 * Math.PI);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d > (100 * Math.PI) / 180;
};
/** 시야 안에서 대상이 무력화된 것이 보인다 (실행부가 잰 see — 테이저·비살상탄·섬광탄에 맞은 그 몇 초는 붙을 때다: P01~P03 은 이때 막지 않는다) */
const stunned = (c: DocCtx): boolean => c.see !== undefined && c.see.stunned === true;
/** 탄을 세는 총을 들었다 */
const gun = (c: DocCtx): boolean => c.st.gun !== null;
/**
 * 기다림의 상한 (초). 본문 §3.6 의 시작값은 P02 20(지원 옴 30) · P03 6 · P07 60(지원 옴 120)이다. 2단계 측정에서 무장 강제 묶음(총격범)의 한계 시간이 늘어
 * §8.4 의 2번 손잡이를 그 순서로 돌렸다: P02 20 → 12초(지원 옴 30 → 18) → P03 6 → 3초 → P07 의 지원 없음 60 → 40초 (설계서 끝 구현 메모 '단계 2')
 */
export const P02_WAIT = 12, P02_WAIT_BACKUP = 18, P03_WAIT = 3, P07_WAIT = 40, P07_WAIT_BACKUP = 120;

registerDoctrine(
  {
    id: 'P01', dept: 'police', name: '테이저 먼저 — 무력화 뒤 둘이 붙는다', short: '테이저 대기',
    who: { dept: ['police'] }, hook: 'gate', works: ['arrest'], gate: 'closeIn', kits: ['taser'],
    when: (c) => { const t = tgt(c); return melee(c, true) && t !== null && t.d <= 4 && c.pack.near >= 1 && !stunned(c); },
    effect: { kind: 'block', maxWait: 8 },
    th: { d: 4, near: 2.6, wait: 8 }, rank: 1, why: 'kit',
    note: '테이저 준비 — {mate}, 맞으면 같이 붙는다.', outNote: '테이저가 듣지 않습니다 — 붙습니다.',
  },
  {
    id: 'P02', dept: 'police', name: '흉기 상대 혼자 — 거리 유지하며 지원 대기', short: '거리 유지',
    who: { dept: ['police'] }, hook: 'gate', works: ['arrest'], gate: 'closeIn', noKits: ['taser', 'beanbag'],
    when: (c) => melee(c, false) && c.pack.n === 0 && !stunned(c),
    unless: (c) => c.sit.civAtRisk,      // 예외: 시민이 위협 2칸 안 — 바로 덮친다
    effect: { kind: 'block', maxWait: (c) => (c.st.backup ? P02_WAIT_BACKUP : P02_WAIT) },
    th: { stand: 3, wait: P02_WAIT, waitBackup: P02_WAIT_BACKUP }, rank: 1, why: 'alone',
    note: '흉기 소지 — 거리 유지하며 지원 기다립니다.', excNote: '시민이 위험합니다 — 바로 제압!', outNote: '더 기다릴 수 없습니다 — 제압합니다.',
    report: '{name} 대원은 테이저가 없어 흉기를 든 용의자와 거리를 두고 {n}초 동안 지원을 기다렸습니다.',
  },
  {
    id: 'P03', dept: 'police', name: '흉기 상대 — 동료와 동시에 덮친다', short: '동시 제압 대기',
    who: { dept: ['police'] }, hook: 'gate', works: ['arrest'], gate: 'closeIn', noKits: ['taser'],
    when: (c) => melee(c, true) && c.pack.n >= 1 && c.pack.near === 0 && !stunned(c),
    effect: { kind: 'block', maxWait: P03_WAIT },
    th: { stand: 3, near: 2.6, wait: P03_WAIT }, rank: 2, why: 'buddy',
    note: '둘이 동시에 들어갑니다!',
  },
  {
    id: 'P05', dept: 'police', name: '엄폐 사격', short: '엄폐 사격',
    who: { dept: ['police'] }, hook: 'gate', works: ['engage'], gate: 'coverFire',
    when: (c) => { const t = tgt(c); return gun(c) && t !== null && t.weapon === 'gun' && c.sit.entryOrdered; },
    effect: { kind: 'choose', opt: 'cover' },
    th: { ringMin: 3, ringMax: 7.5 }, rank: 1, why: 'danger',
  },
  {
    id: 'P07', dept: 'police', name: '혼자 방 진입 금지', short: '단독 진입 보류',
    who: { dept: ['police'] }, hook: 'gate', works: ['engage'], gate: ['roomEntry', 'breach'],
    when: (c) => !c.solo && c.pack.near === 0,
    unless: (c) => gunFight(c) && c.sit.civAtRisk,      // 예외: 총격범이 쏘고 있고 시민이 위험하다 — 혼자라도 들어간다
    effect: { kind: 'block', maxWait: (c) => (c.st.backup ? P07_WAIT_BACKUP : P07_WAIT) },
    th: { near: 2.6, wait: P07_WAIT, waitBackup: P07_WAIT_BACKUP }, rank: 2, why: 'alone',
    note: '혼자 들어가지 않습니다. 동료를 기다립니다.', excNote: '총격이 계속됩니다 — 혼자 들어갑니다.', outNote: '지원이 오지 않습니다 — 진입합니다.',
    report: '{name} 대원은 혼자 남아 방에 들어가지 않고 {n}초 동안 동료를 기다렸습니다.',
  },
  {
    id: 'P08', dept: 'police', name: '탄약 보급', short: '탄약 보급',
    who: { dept: ['police'] }, hook: 'act',
    when: (c) => gun(c) && c.st.ammoBox > 0 && ((c.st.ammoLow && !c.sit.fightThreat) || (c.st.ammoCrit && !c.st.underFire)),
    effect: { kind: 'act', act: 'rearm', score: (c) => (c.st.ammoCrit ? 0.97 : 0.78) },
    th: { score: 0.78, crit: 0.97 }, rank: 1, why: 'lowAmmo',
    note: '탄약 보급 받으러 차량으로 갑니다.',
  },
  {
    id: 'P09', dept: 'police', name: '탄약 바닥 — 엄폐', short: '탄약 바닥 — 엄폐',
    who: { dept: ['police'] }, hook: 'act',
    when: (c) => gun(c) && gunFight(c) && c.st.ammoCrit && (c.st.underFire || c.st.ammoBox === 0) && c.hideSpot() !== null,
    effect: { kind: 'act', act: 'cover', score: 0.97 },
    th: { score: 0.97 }, rank: 0, why: 'lowAmmo',
    note: '탄약 바닥 — 엄폐합니다!',
  },
  {
    id: 'P10', dept: 'police', name: '재장전은 엄폐해서', short: '재장전 — 엄폐',
    who: { dept: ['police'] }, hook: 'act',
    when: (c) => gun(c) && c.st.reloading && c.st.underFire && !c.st.inCover && tgt(c) !== null,
    effect: { kind: 'act', act: 'cover', score: 0.97 },
    th: { score: 0.97 }, rank: 1, why: 'lowAmmo',
    note: '재장전 — 엄폐!',
  },
  {
    id: 'P11', dept: 'police', name: '피격 — 후퇴 대신 엄폐', short: '피격 — 엄폐',
    who: { dept: ['police'] }, hook: 'act', swap: 'retreat',
    when: (c) => c.st.underFire && c.st.hp >= 40 && c.st.hp < 70 && !c.st.bleeding && !c.st.inCover && c.dngSign === 0 && c.hideSpot() !== null,
    effect: { kind: 'act', act: 'cover', score: (c) => c.dng },
    th: { hpLo: 40, hpHi: 70 }, rank: 1, why: 'danger',
    note: '피격 — 엄폐!',
  },
  {
    id: 'P12', dept: 'police', name: '중상 — 검거·교전 줄이고 가벼운 일로', short: '가벼운 임무',
    who: { doc: ['police'] },      // 특수·소방·의료 표 대원은 G01·F14·E11 (한 대원에게 부상 줄이 둘 걸리지 않는다)
    hook: 'fit', works: ['engage', 'arrest', 'negotiate', ...LIGHT_NO_NEG],
    when: (c) => c.st.band >= 1,
    effect: [
      { kind: 'fitMul', mul: 0.35, works: ['engage', 'arrest'] },
      { kind: 'fitAdd', add: 0.15, works: LIGHT_NO_NEG, when: (c) => c.light },
      { kind: 'fitAdd', add: 0.2, works: ['negotiate'], when: (c) => c.st.composure >= 0.6 },
    ],
    th: { band: 1, mul: 0.35, add: 0.15, negotiate: 0.2, composure: 0.6 }, rank: 1, why: 'hurt',
  },
  {
    id: 'P14', dept: 'police', name: '섬광탄 없는 인질 덮침 제한', short: '섬광탄 없음 — 엄폐 대기',
    who: { dept: ['police'] }, hook: 'gate', works: ['engage'], gate: 'closeIn',
    when: (c) => { const t = tgt(c); return t !== null && t.weapon === 'gun' && t.hostage && !c.sit.bangOnScene; },
    unless: (c) => c.pack.near >= 1 && facingAway(c),      // 예외: 동료가 곁에 있고 용의자가 등졌다 — 바로 덮친다
    effect: { kind: 'block', maxWait: (c) => (c.sit.bangComing ? 40 : 20) },
    th: { near: 2.6, angle: 100, wait: 20, waitBang: 40 }, rank: 1, why: 'hostage',
    note: '섬광탄 없음 — 인질 위험, 엄폐 대기.', excNote: '등졌다 — 지금!', outNote: '더 기다릴 수 없습니다 — 접근해 제압합니다.',
  },
  {
    id: 'P15', dept: 'police', name: '마지막 섬광탄은 방 진입에', short: '섬광탄 아낌',
    hook: 'gate', works: ['engage'], gate: 'bangUse', kits: ['flashbang'],
    when: (c) => { const t = tgt(c); return c.kit('flashbang') === 1 && c.sit.entryOrdered && (t === null || t.d > 3); },
    effect: { kind: 'choose', opt: 'save' },
    th: { left: 1, d: 3 }, rank: 3, why: 'kit',
    note: '마지막 섬광탄 — 방 진입에 아낍니다.',
  },
  {
    id: 'P16', dept: 'police', name: '협상 중 교전 — 엄폐', short: '협상 중단 — 엄폐',
    who: { dept: ['police'] }, hook: 'act',
    // 이미 엄폐한 협상 자리(executor 'negotiate' 의 '위치 사수 — 엄폐 상태에서 응사')에서는 걸리지 않는다: 그 자리를 떠나 숨으면 응사가 끊겨 총격범이 다른 대원을 쏜다
    // (2단계 측정 — 강제 armed/siege 의 다친 대원이 이 줄 하나로 26 → 36). 본문 §3.1 은 그 자리에서 '서 있기만 한다'고 보았다
    when: (c) => { const t = tgt(c); return c.a.task !== null && c.a.task.kind === 'negotiate' && t !== null && t.state === 'fight' && !c.st.inCover && c.hideSpot() !== null; },
    effect: { kind: 'act', act: 'cover', score: 0.93 },
    th: { score: 0.93 }, rank: 1, why: 'danger',
    note: '교전 — 엄폐하고 계속 부릅니다.',
  },
  {
    id: 'P22', dept: 'police', name: '탄약 위급 — 총기 상대 위치를 넘긴다', short: '탄약 부족',
    who: { dept: ['police'] }, hook: 'fit', works: ['engage', 'perimeter', 'traffic', 'interview'],
    when: (c) => gun(c) && c.st.ammoCrit && c.sit.gunThreat,
    effect: [
      { kind: 'fitMul', mul: 0, works: ['engage', 'perimeter'], drop: true, when: (c) => c.w === null || c.w.kind !== 'engage' || (c.tg !== null && c.tg.weapon === 'gun') },
      { kind: 'fitAdd', add: 0.15, works: ['traffic', 'interview'] },
    ],
    th: { add: 0.15 }, rank: 1, why: 'lowAmmo',
    dropNote: '탄약이 없어 위치를 넘깁니다.',
  },
);

// 지휘·관제·추격 줄의 이름표 (§6 — 기록·측정이 이름을 찾는다). 경찰 분야
CMD_ROWS.push(
  { id: 'CP1', dept: 'police', hook: 'cmd', name: '쓸 수 있는 경찰로 진입·검거 문턱', short: '제압 인력 부족', why: 'hurt' },
  { id: 'CP2', dept: 'police', hook: 'cmd', name: '흉기 난동 — 2인 제압 인력 요청', short: '2인 제압 요청', why: 'alone' },
  { id: 'CP3', dept: 'police', hook: 'cmd', name: '탄약 보급 요청', short: '탄약 보급 요청', why: 'lowAmmo' },
  { id: 'CP4', dept: 'police', hook: 'cmd', name: '섬광탄 없는 인질 진입 보류', short: '인질 진입 보류', why: 'hostage' },
  { id: 'D3', dept: 'police', hook: 'dispatch', name: '흉기 신고 — 경찰 둘', short: '흉기 신고 경찰 둘', why: 'danger' },
  { id: 'D6', dept: 'police', hook: 'dispatch', name: '인질극 — 특공이 없으면 기동대 둘', short: '기동대 둘', why: 'hostage' },
  { id: 'D7', dept: 'police', hook: 'chase', name: '추격 — 따라가기와 앞막기', short: '추격 앞막기', why: 'team' },
);

// ── (3단계) 확보 전 무장 현장의 실내 수색은 짝과 함께 (P17 — 짝 맺기 pairUp·판단 지점 interiorEntry 가 3단계에 생겼다. §3.1·§3.6) ──
registerDoctrine(
  {
    id: 'P17', dept: 'police', name: '확보 전 건물 수색은 짝과 함께', short: '짝 없음 — 수색 제외',
    who: { dept: ['police'] }, hook: 'fit', works: ['search'],
    when: (c) => c.sit.hot && !c.solo && c.w !== null && c.w.region >= 0 && c.s.regions[c.w.region] !== undefined && c.s.regions[c.w.region].indoor && c.pair().forW === null,
    effect: { kind: 'fitMul', mul: 0 },
    rank: 2, why: 'alone',
  },
  {
    id: 'P17b', dept: 'police', name: '확보 전 건물 — 짝이 따라올 때까지 문턱에서', short: '짝 기다림',
    who: { dept: ['police'] }, hook: 'gate', works: ['search'], gate: 'interiorEntry',
    when: (c) => c.sit.hot && !c.solo && !c.pair().follows,
    effect: { kind: 'block', maxWait: (c) => (c.st.backup ? 30 : 20) },
    th: { follow: 4, wait: 20, waitBackup: 30 }, rank: 2, why: 'buddy',
    note: '짝을 기다립니다.', outNote: '짝이 오지 않습니다 — 수색을 넘깁니다.',
  },
);

// ── (6단계) 교통 통제의 방법 — 차량 차단 (P20. 방법 blockLane 이 6단계에 생겼다 — §3.1·§3.6·§3.7) ──
registerDoctrine(
  {
    // 2차 사고가 이미 났거나 밤·비·안개면 순찰차로 차로 입구를 막고 선 뒤 통제한다 (차량 차단 0.6 × 1.5 = 0.90 > 통제 0.75). 설치 +3초, 그동안 그 방향 차의 부주의 ×0.4 (doctrineRun.runTraffic · hazards.tickLane)
    id: 'P20', dept: 'police', name: '2차 사고 뒤·밤·비·안개 — 차량으로 차로 입구를 막고 통제', short: '차량 차단',
    who: { dept: ['police'] }, hook: 'method', works: ['traffic'], methods: ['blockLane'],
    when: (c) => c.sit.lanes2nd || c.sim.weather !== 'clear',
    effect: { kind: 'methodMul', mul: 1.5 },
    th: { mul: 1.5 }, rank: 3, why: 'danger',
  },
);
