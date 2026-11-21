// 대응 교본 — 특수 표 (docs/specs/R3-doctrine.md §3 · 등록 칸은 §3.6 표 그대로, 이 파일 안의 등록 순서도 그 표의 순서). 특공·폭발물·화학·소방 헬기·구조정·사다리차 — S 줄 (5단계)
// 줄은 DocCtx 만 읽는다 (믿음·자기 몸·자기 장비 — tests/doctrine.test.ts 시험 1). 이 파일은 ./registry 와 타입·util 만 import 한다.
// 새 줄은 이 파일의 끝에 registerDoctrine({ id, dept, who, hook, works/gate/methods, kits/noKits, when, effect, rank, why, note, report }) 로 붙인다 (등록 순서가 결과를 바꾼다).
//
// 단계 0 (틀): 아직 개인 줄이 없다 (S 줄은 5단계).
// 단계 2: 관제 줄 D2(폭발물 처리반을 인질극 진입조로 보내지 않는다 — 코드는 dispatch/doctrine.ts)의 이름표만 둔다 (§6.2 표의 분야가 특수다).
// 단계 5 (특수): S01(방패 선두 줄 서기 — breach 의 고르기) · S02(저격수는 진입조에 덜) · S05(섬광탄을 든 사람이 진입조 먼저) · S06·S06b(로봇 먼저) · S07(맨몸 해체는 둘 가운데 하나일 때만) ·
//   S08(해체 중 장치 반경 6칸의 일 금지) · S13(구조정 — 보트 먼저·바다에서 헤엄 금지) · S15(호이스트가 같은 대상을 맡으면 헤엄 줄이기) · S19(사다리 조작원은 실내 수색을 덜) ·
//   S21(로봇이 없는 로봇 조작 요원은 출입 통제) · S22(특공 팀장 — 결정 전 협상, 뒤 진입 지휘) · S23(다치거나 동요한 처리 요원은 손으로 해체하지 않는다) · S24(동요·중상 저격수는 쏘지 않는다) ·
//   S25(지친 수난·항공 구조대원은 헤엄 금지) · S26(인질 위치를 모르면 폭파 진입을 하지 않는다) · S03(진입 결정 전 무장 현장의 잠긴 문을 함부로 열지 않는다 — 판단 지점 forceDoor).
//   S10·S11(화학대의 짝·대기조 — 측정기 대원이 수색을 먼저 · 팀장은 밖 대기조)은 3단계의 짝 맺기(pairUp) 위에 선다 — 합치는 작업자가 S03 다음에 붙였다.
//   지휘·관제 줄 CS1(해체 반경 비우기 — orders/doctrine.ts)·CS2(특공이 있으면 진입조 가산 — commander.assign)·D1(가스 현장의 화학 구조차 — dispatch/doctrine.ts)의 이름표도 여기 둔다.

import { CMD_ROWS, registerDoctrine } from './registry';
import type { DocCtx } from './registry';
import type { WorkKind } from '../../types';

CMD_ROWS.push(
  { id: 'D2', dept: 'special', hook: 'dispatch', name: '폭발물 처리반을 경찰 수요에 아낀다', short: '처리반 아낌', why: 'protocol' },
);

/** 위험 실내 일의 종류 (§3 읽는 법의 HZ — 대상 구역이 위험 건물 실내인지는 c.hz 가 본다. S11) */
const HZ: WorkKind[] = ['search', 'carry', 'escort', 'extricate', 'mitigate', 'overhaul'];
/** 장치 반경 (칸 — S07·S08, 엔진의 BOMB_R 과 같은 값) */
const BOMB_R = 6;
/** 해체 중에 장치 반경 안에서 맡지 않는 일 (S08 — 해체·출입 통제·반경 밖으로 옮기는 일(이송·대피 안내·동료 구조)을 뺀 것). 장치가 나는 현장에서 생기는 일만 적는다 */
const S08_WORKS: WorkKind[] = ['search', 'treat', 'interview', 'extricate', 'mitigate', 'clear', 'force', 'suppress', 'overhaul', 'engage', 'arrest', 'negotiate', 'treatMate', 'treatSuspect'];
/** 해일이 덮쳤다 (공개 — 재난 특보) */
const tsunami = (c: DocCtx): boolean => c.sim.disaster !== null && c.sim.disaster.kind === 'tsunami' && c.sim.disaster.phase !== 'calm';
/** R2 결정적 저격의 조건 (methods.sniperOk 와 같은 믿음 — 인질을 붙잡고 교전 · 협상 60초 넘은 대치): 그때는 저격수가 교전을 맡아야 저격을 고를 수 있다 */
const sniperMoment = (c: DocCtx): boolean => { const t = c.sit.threat; return t !== null && t.weapon === 'gun' && ((t.hostage && t.state === 'fight') || c.sit.negotSec > 60); };
/**
 * (S26) 인질 위치를 모른다: 믿음 속 인질을 붙든 활동 용의자 가운데 그 믿음이 10초보다 낡았거나 그 자리가 대상 문(c.m.tile)에서 4칸 안인 사람이 있다
 * (인질은 용의자 곁에 있다 — "문 뒤에 있을지 모른다"를 믿음의 나이와 거리로 본다). 관제의 이름표가 인질극인데 인질을 붙든 용의자를 하나도 모르면 그것도 모르는 것이다
 */
export const S26_AGE = 10, S26_NEAR = 4;
function hostageUnknown(c: DocCtx): boolean {
  const tile = c.m !== undefined ? c.m.tile : -1;
  const tx = tile >= 0 ? tile % c.s.w : -1, ty = tile >= 0 ? (tile / c.s.w) | 0 : -1;
  let any = false;
  for (const f of c.a.beliefs.list('hos')) {
    const v = f.value as { x: number; y: number; state: string; hostage: boolean };
    if (!v.hostage || (v.state !== 'hold' && v.state !== 'fight')) continue;
    any = true;
    if (c.sim.t - f.t > S26_AGE || tile < 0 || Math.hypot(v.x - tx, v.y - ty) <= S26_NEAR) return true;
  }
  return !any;
}
/** (S26) 믿음 속에 인질을 붙든 활동 용의자가 있다 */
const holdsHostage = (c: DocCtx): boolean => c.a.beliefs.list('hos').some((f) => f.value.hostage === true && (f.value.state === 'hold' || f.value.state === 'fight'));
/** (S26) 관제의 이름표가 인질극이다 (공개 — 신고로 붙인 이름) */
const hostageLabel = (c: DocCtx): boolean => /^인질극/.test(c.sit.label);
/** (S15) 같은 대상의 호이스트 작업이 작업판에 열려 있다 (공개 지휘 상태) */
const hoistOpen = (c: DocCtx): boolean => { const w = c.w; return w !== null && w.cas >= 0 && c.s.board.some((b) => b.kind === 'hoist' && b.cas === w.cas && (b.status === 'open' || b.status === 'active')); };
/** (S03) 기다림의 상한 (초) — 지원이 오면 길게 */
export const S03_WAIT = 30, S03_WAIT_BACKUP = 45;

registerDoctrine(
  {
    id: 'S01', dept: 'special', name: '방패 선두 줄 서기', short: '방패 선두',
    who: { units: ['swat'] }, hook: 'gate', works: ['engage'], gate: 'breach', kits: ['shield'],
    when: (c) => c.st.band === 0 && !c.st.shaken,      // 그 문의 진입조에서 방패를 든 대원 자신에게 묻는다 (executor.breach — 다치거나 동요한 방패수는 선두에 서지 않는다)
    effect: { kind: 'choose', opt: 'stack' },
    th: { gap: 0.6 }, rank: 2, why: 'protocol',
  },
  {
    id: 'S02', dept: 'special', name: '저격수는 진입조에 들지 않는다', short: '저격 자리 지킴',
    hook: 'fit', works: ['engage', 'perimeter'], kits: ['sniper'],
    when: (c) => c.sit.kind === 'armed',
    effect: [
      { kind: 'fitMul', mul: 0.3, works: ['engage'], when: (c) => !sniperMoment(c) },      // 결정적 저격 조건이면 깎지 않는다 (저격은 교전 임무 안의 R2 방법)
      { kind: 'fitAdd', add: 0.1, works: ['perimeter'] },
    ],
    th: { mul: 0.3, add: 0.1 }, rank: 3, why: 'kit',
  },
  {
    id: 'S05', dept: 'special', name: '섬광탄을 든 사람이 진입조 먼저', short: '섬광탄 진입조',
    who: { dept: ['police'] }, hook: 'fit', works: ['engage'], kits: ['flashbang'],
    when: (c) => c.sit.entryOrdered,
    effect: { kind: 'fitAdd', add: 0.1 },
    th: { add: 0.1 }, rank: 3, why: 'kit',
  },
  {
    id: 'S06', dept: 'special', name: '로봇 먼저', short: '로봇 먼저',
    hook: 'method', works: ['defuse'], methods: ['robotDefuse'], kits: ['robot'],
    when: (c) => c.sit.liveBomb !== null,
    effect: { kind: 'methodMul', mul: 1.3 },
    th: { mul: 1.3, reach: 8 }, rank: 3, why: 'kit',
  },
  {
    id: 'S06b', dept: 'special', name: '로봇이 있으면 처리 요원은 기다린다', short: '로봇 먼저',
    who: { roles: ['bombTech'] }, hook: 'fit', works: ['defuse'],
    when: (c) => c.sit.liveBomb !== null && c.sit.robotOn,
    effect: { kind: 'fitMul', mul: 0.4 },
    th: { mul: 0.4 }, rank: 3, why: 'kit',
  },
  {
    id: 'S07', dept: 'special', name: '맨몸 해체는 둘 가운데 하나일 때만', short: '맨몸 해체',
    who: { roles: ['bombTech'] }, hook: 'method', works: ['defuse'], methods: ['bareDefuse'], noKits: ['robot'],
    when: () => true,
    effect: [
      { kind: 'methodMul', mul: 0, when: (c) => c.has('bombSuit') && !c.sit.bombPinned },      // 방호복이 있고 옮길 수 없는 사람도 곁에 없다 — 맨몸으로 하지 않는다
      { kind: 'methodMul', mul: 2, when: (c) => c.has('bombSuit') && c.sit.bombPinned },       // 옮길 수 없는 사람이 장치 6칸 안 — 방호복을 벗고 더 빨리 (방호복 해체보다 먼저)
    ],
    th: { near: BOMB_R, mul: 2 }, rank: 0, why: 'danger',
  },
  {
    id: 'S08', dept: 'special', name: '해체 중 장치 반경 비우기', short: '해체 반경',
    hook: 'fit', works: S08_WORKS,
    when: (c) => c.sit.liveBomb !== null && c.sit.defusing && c.wBomb <= BOMB_R,
    effect: { kind: 'fitMul', mul: 0 },
    th: { r: BOMB_R }, rank: 0, why: 'danger',
  },
  {
    id: 'S13', dept: 'special', name: '구조정 — 보트 먼저, 바다에서 헤엄 금지', short: '보트 먼저',
    who: { units: ['boat'] }, hook: 'method', works: ['waterRescue'], methods: ['boat', 'swim'],
    when: (c) => c.sit.kind === 'water' || tsunami(c) || (c.m !== undefined && c.m.flow >= 0.07),      // 구조정은 바닷가의 수난에만 나간다 (관제 — dispatcher.pickUnit)
    effect: [
      { kind: 'methodMul', mul: 1.3, methods: ['boat'] },
      { kind: 'methodMul', mul: 0, methods: ['swim'] },      // 바다·해일 — 구조정이 나가는 곳은 늘 바닷가다
    ],
    th: { flow: 0.07, mul: 1.3 }, rank: 0, why: 'danger',
  },
  {
    id: 'S15', dept: 'special', name: '호이스트가 맡은 대상에는 헤엄을 줄인다', short: '호이스트와 겹치지 않게',
    hook: 'method', works: ['waterRescue'], methods: ['swim', 'tend', 'catch'],
    when: hoistOpen,
    effect: [
      { kind: 'methodMul', mul: 0.5, methods: ['swim'] },      // (R2 의 상공 헬기 ×0.7 을 대신한다 — methods.ts 의 swim 에서 지웠다)
      { kind: 'methodMul', mul: 1.2, methods: ['tend', 'catch'] },
    ],
    th: { swim: 0.5, rope: 1.2 }, rank: 2, why: 'team',
  },
  {
    id: 'S19', dept: 'special', name: '사다리 조작원은 실내 수색을 덜', short: '사다리 지킴',
    who: { roles: ['ladderOp'] }, hook: 'fit', works: ['search'],
    when: (c) => c.sit.kind === 'fire' && c.sit.scbaOn - (c.st.hasScba ? 1 : 0) >= 2,
    effect: { kind: 'fitMul', mul: 0.3 },
    th: { mul: 0.3, others: 2 }, rank: 3, why: 'protocol',
  },
  {
    id: 'S21', dept: 'special', name: '로봇이 없으면 출입 통제', short: '로봇 고장 — 통제',
    who: { roles: ['robotOp'] }, hook: 'fit', works: ['perimeter'], noKits: ['robot'],
    when: (c) => c.sit.liveBomb !== null,
    effect: { kind: 'fitAdd', add: 0.2 },
    th: { add: 0.2 }, rank: 3, why: 'noKit',
  },
  {
    id: 'S22', dept: 'special', name: '특공 팀장 — 결정 전 협상, 뒤 진입 지휘', short: '특공 지휘',
    who: { roles: ['swatLead'] }, hook: 'fit', works: ['negotiate', 'engage'],
    when: (c) => c.sit.kind === 'armed',
    effect: [
      { kind: 'fitAdd', add: 0.15, works: ['negotiate'], when: (c) => !c.sit.entryOrdered },
      { kind: 'fitAdd', add: 0.1, works: ['engage'], when: (c) => c.sit.entryOrdered },
    ],
    th: { negotiate: 0.15, engage: 0.1 }, rank: 3, why: 'protocol',
  },
  {
    id: 'S23', dept: 'special', name: '다치거나 동요하면 손으로 해체하지 않는다', short: '해체 넘김',
    who: { roles: ['bombTech'] }, hook: 'method', works: ['defuse'], methods: ['suitDefuse', 'bareDefuse'],
    when: (c) => c.st.band >= 1 || c.st.shaken,
    effect: { kind: 'methodMul', mul: 0 },
    th: { band: 1 }, rank: 1, why: 'hurt',
    note: '손이 떨립니다 — 해체를 넘기겠습니다.',
  },
  {
    id: 'S24', dept: 'special', name: '흔들리는 손으로 저격하지 않는다', short: '저격 보류',
    who: { roles: ['marksman'] }, hook: 'method', works: ['engage'], methods: ['sniper'],
    when: (c) => c.st.shaken || c.st.band >= 1,
    effect: { kind: 'methodMul', mul: 0 },
    th: { band: 1 }, rank: 1, why: 'shaken',
  },
  {
    id: 'S25', dept: 'special', name: '지친 구조대원은 헤엄치지 않는다', short: '지침 — 헤엄 금지',
    who: { groups: ['water', 'rescue'] }, hook: 'method', works: ['waterRescue'], methods: ['swim'],
    when: (c) => c.st.stamina < 30,
    effect: { kind: 'methodMul', mul: 0 },
    th: { stamina: 30 }, rank: 1, why: 'tired',
  },
  {
    id: 'S26', dept: 'special', name: '인질 위치를 모르면 폭파하지 않는다', short: '폭파 보류',
    who: { roles: ['breacher', 'bombTech'] }, hook: 'method', works: ['force', 'clear'], methods: ['charge'], kits: ['charge'],
    when: (c) => holdsHostage(c) || hostageLabel(c),
    effect: [
      { kind: 'methodMul', mul: 0, when: hostageUnknown },
      { kind: 'methodMul', mul: 1.2, when: (c) => !hostageUnknown(c) && c.sit.entryOrdered },      // 문이 한 번에 열려 인질 곁의 용의자에게 닿는 틈이 짧다
    ],
    th: { age: S26_AGE, near: S26_NEAR, mul: 1.2 }, rank: 0, why: 'hostage',
  },
  {
    // (본문 §3.4 의 S03 은 "있음(R2)" — R2 의 조용한 개방·진입 순간의 충격기·폭파. 5단계가 R2 의 '폭파 진입 0건'을 받으며 판단 지점 하나를 더했다 — 설계서 끝 구현 메모)
    id: 'S03', dept: 'special', name: '진입 결정 전에는 잠긴 문을 함부로 열지 않는다', short: '잠긴 방 — 진입 보류',
    who: { dept: ['police'] }, hook: 'gate', gate: 'forceDoor',
    when: (c) => c.sit.hot && !c.sit.entryOrdered && (c.a.task === null || (c.a.task.kind !== 'engage' && c.a.task.kind !== 'arrest')),      // 도주 용의자를 쫓는 교전·검거는 막지 않는다
    effect: { kind: 'block', maxWait: (c) => (c.st.backup ? S03_WAIT_BACKUP : S03_WAIT) },
    th: { wait: S03_WAIT, waitBackup: S03_WAIT_BACKUP }, rank: 2, why: 'protocol',
    note: '잠긴 방입니다. 진입 결정 전에는 열지 않습니다.', outNote: '더 기다릴 수 없습니다 — 문을 엽니다.',
  },
  // (합치기 — 3단계의 짝 맺기 위에 선다) 화학대의 안쪽 짝·밖 대기조 (§5.1 의 화학 줄: [보호복 대원(첫째), 측정·제독 대원] 안 · [화학 팀장, 보호복 대원(둘째)] 밖)
  {
    id: 'S10', dept: 'special', name: '측정기를 든 화학 대원이 가스 현장 실내 수색을 먼저', short: '측정기 수색',
    who: { units: ['hazmat'] }, hook: 'fit', works: ['search'], kits: ['gasMeter'],
    when: (c) => c.sit.kind === 'hazmat' && c.hz,
    effect: { kind: 'fitAdd', add: 0.15 },
    th: { add: 0.15 }, rank: 3, why: 'kit',
  },
  {
    id: 'S11', dept: 'special', name: '화학 팀장은 밖 대기조로 남는다', short: '팀장 대기조',
    who: { roles: ['hazLead'] }, hook: 'fit', works: HZ,
    when: (c) => c.hz && c.unitIn() > 0,      // 자기 부대의 안쪽 짝이 위험 실내에 있다 (동료의 겉) — 짝이 나오면 풀린다. 밖의 팀장은 밖 대기조로 세어진다(엔진의 outsideWatch)
    effect: { kind: 'fitMul', mul: 0.3 },
    th: { mul: 0.3 }, rank: 2, why: 'outside',
  },
);

// (R3b D1 — docs/specs/R3b-followup.md §5.2) 잠긴 방 문은 파괴 담당이 연다: 장약을 든 진입대원(파괴)이 진입 결정 뒤 믿음 속 잠긴 방 문(총기 위협의 방)으로 간다.
// 지금은 문을 여는 사람을 그 문에 모인 진입조에서만 골라(executor.lockedRoomDoor) 봉쇄·이송을 하던 진입대원(파괴)이 문에 오지 않았다 — 폭파 진입 0건의 첫 겹.
// 고르는 것은 문을 여는 사람까지다: 문에서 어떤 방법으로 열지는 그 자리의 R2 고르기(조건 ①~⑤)와 S26 이 정한다(인질 방이면 충격기 — 사용자 결정 그대로)
/** (S30) 하던 일을 두고 문으로 가지 않는 임무 — 이미 진입조다(교전) · 검거 중 · 문·잔해를 여는 중 */
const S30_KEEP: readonly string[] = ['engage', 'arrest', 'force', 'clear'];
registerDoctrine(
  {
    id: 'S30', dept: 'special', name: '잠긴 방 문은 파괴 담당이 연다', short: '파괴 담당 — 문 개방',
    who: { roles: ['breacher'] }, hook: 'act', kits: ['charge'],
    when: (c) => c.sit.kind === 'armed' && c.sit.entryOrdered && c.sit.gunThreat && c.st.band === 0 && (c.a.task === null || S30_KEEP.indexOf(c.a.task.kind) < 0) && c.breachDoor() >= 0,
    effect: { kind: 'act', act: 'force', score: 0.93 },      // 봉쇄 계속(0.5 + 0.4 × 0.76 + 0.08 = 0.884)에서 스스로 나온다 · 교전 계속(0.94)에는 걸지 않는다(위 S30_KEEP)
    th: { score: 0.93 }, rank: 2, why: 'kit',
    note: '잠긴 방 문 — 파괴 장비로 제가 엽니다.',
  },
);

// 지휘·관제 줄의 이름표 (§6 — 기록·측정이 이름을 찾는다). 특수 분야
CMD_ROWS.push(
  { id: 'CS1', dept: 'special', hook: 'cmd', name: '해체 시작 — 장치 반경 비우기', short: '해체 반경 비움', why: 'danger' },
  { id: 'CS2', dept: 'special', hook: 'cmd', name: '특공이 있으면 진입조는 특공·기동대', short: '특공 진입조', why: 'protocol' },
  { id: 'D1', dept: 'special', hook: 'dispatch', name: '가스 누출 — 화학 구조차', short: '화학대 출동', why: 'protocol' },
);
