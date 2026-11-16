// 대응 방법의 판단부 (docs/specs/R2-methods.md §3). 한 임무(WorkKind)를 이루는 여러 방법 가운데 하나를,
// 그 일을 맡은 대원이 자기 장비 · 자기 능력 · 자기가 본 상황으로 고른다.
//
// 이 파일은 **판단만** 한다 — 진실을 읽지 않고 상태를 바꾸지 않는다 (tests/methods.test.ts 시험 1 이 글자로 잡는다):
//   읽어도 되는 것   대원의 믿음(a.beliefs), 현장의 생김새(칸·구역·출입구·대기 지점·s.kind·s.rules·s.quay), 공개된 것(날씨·특보·sim.t·지휘 상태),
//                    자기 몸(명부의 능력치·상태), gear.ts 의 판단용 함수(알려진 고장만 반영), 동료가 하는 일(s.agents 의 임무·방법·대상·위치),
//                    실행부가 대원이 선 칸에서 재서 넘긴 감각(Sense)
//   읽으면 안 되는 것 소품·구조 대상·용의자의 진실, 칸의 불·연기, 다른 현장, 시나리오 변형, 숨은 고장, 효과·소모 함수 (금지어는 시험 1 의 목록)
// import 하지 않는 것: agents.ts · hazards.ts · executor.ts · methodRun.ts · crews.ts (agents.fitFor 가 이 파일을 부른다 — 순환을 만들지 않는다. 장비는 gear.ts 로만)
//
// 고르는 때 (§3.2): 처음(startMethod) · 도착 재선택 한 번(recheckOnArrive) · 바꿀 때 셋(실패 · 고장 · 조건 상실 3초 — switchMethod) · 예정된 전환.
// "더 좋은 방법이 보이면 바꾼다"는 없다 (대원이 두 방법 사이를 오간다). 실행부는 methodRun.ts.
//
// 단계 0 (틀)에서 표의 모든 줄을 두고 can 을 NOT_YET(거짓)으로 비워 두었다. 방법을 구현하는 단계가 그 줄의 can·situ·skill 을 채운다
// (수난 1a~1c · 문 2 · 구출·탐지 3 · 화재 4 · 무장 5 · 응급·가스 6). 켜진 줄: 단계 1a — 수난 구조의 물가 방법 여섯(hand·pole·ring·rope·improvise·catch),
// 단계 1b — 헤엄(swim)·줄 확보(tend), 단계 1c — 보트(boat). 물 위의 이동 비용 swimCost·boatCost 는 실행기(executor.costFor)가 쓴다.
// 배정(agents.fitFor 의 waterRescue)이 methodFit 을, 실행부(methodRun.runWaterRescue)가 chooseMethod·methodStillFits 를 부른다.

import type { Sim } from '../engine';
import { hashStr } from '../rng';
import { T } from '../types';
import type { CasBelief, FieldAgent, KitId, MethodId, MethodWhy, Responder, Scene, SignBelief, Task, Unit, UnitKind, WorkItem, WorkKind } from '../types';
import { clamp, josa } from '../util';
import { SHARED, hoistOver, kitCount, kitName, swimBonus } from './gear';
import { staticPass, tileOf } from './grid';
import type { CostFn } from './grid';
import { docCtx, docMethodMul, hasDoc } from './doctrine';      // (R3) 교본 배율 — doctrine.ts 는 이 파일을 값으로 import 하지 않는다 (순환 없음)
import type { DocCtx } from './doctrine/registry';

// ───────────────────────── 자료형 ─────────────────────────
/** 대원이 선 칸의 감각 (실행부가 methodRun.senseOf 로 재서 넘긴다. 배정용 methodFit 에서는 0) */
export interface Sense { smoke: number; heat: number }
/** 방법의 대상 (없으면 -1) */
export interface MTarget { cas: number; prop: number; hostile: number; region: number; tile: number }
/** 고른 결과: 방법 · 까닭 · 후보와 점수(점수 내림차순) · (noGear 면) 빠진 장비 */
export interface MethodPick { m: MethodId; why: MethodWhy; cands: { m: MethodId; score: number }[]; missing?: KitId }
/** R3 의 교본 입력 (doctrine.ts 의 docCtx 가 만든다 — 타입은 doctrine/registry.ts). 실행부는 자기 모드로 넘기고, methodFit 은 안에서 보고 모드로 만든다. 없으면 null */
export type { DocCtx } from './doctrine/registry';
export const NO_SENSE: Sense = { smoke: 0, heat: 0 };

/** chooseMethod 안에서만 만든다 (내보내지 않는다 — 진실을 판단에 끼워 넣을 길을 모양으로 막는다) */
interface MethodCtx {
  sim: Sim; s: Scene; a: FieldAgent; r: Responder; u: Unit; work: WorkKind; t: Task | null; tg: MTarget;
  cb: CasBelief | null;            // a.beliefs 의 대상 구조 대상 (없으면 null)
  bank: { x: number; y: number; d: number } | null;   // 대상 믿음 위치에서 가장 가까운, 대원이 걸어서 닿는 뭍 칸 (수난 구조만)
  reach: number;                   // bank?.d ?? Infinity
  flow: number;                    // 믿음 속 떠내려가는 속도 (사람이 떠내려가는 모습으로 본 물살)
  weak: boolean;                   // 믿음 band ≥ 2 (위중 — 줄을 잡을 힘이 없을 수 있다)
  sense: Sense;
  mates: FieldAgent[];             // 같은 임무·같은 대상을 맡은 활동 동료
  ops: any | null;                 // (X6) a.beliefs 의 ops 사실(id 0)의 값, 없으면 null
  dc: DocCtx | null;               // (R3) 교본 입력, 없으면 null
  caution: number;                 // 위험을 꺼리는 정도 0.5..1.1 (침착하고 경험 많은 대원은 낮다)
}
export interface MethodDef {
  id: MethodId; work: WorkKind[];
  name: string;        // 패널·보고서의 이름 ('구명줄 투척')
  short: string;       // 보고서 요약 줄의 짧은 이름 ('구명줄')
  label: string;       // 대원 머리 위 (12자 안)
  noun: string;        // 보고서 문장에 끼우는 말 ('구명줄로', '헤엄쳐 들어가')
  kits: KitId[];       // 이 가운데 하나라도 있어야 한다 (빈 배열 = 맨몸으로 된다)
  altUnit?: UnitKind[];   // 이 부대의 대원이면 kits 없이도 된다 (OR) — boat: 구조정
  needUnit?: UnitKind[];  // 이 부대의 대원이어야 한다 (AND) — aerial: 사다리차
  pref: number;        // 교본상 선호 0..1 — 위험이 적은 방법이 높다
  risk: number;        // 대원 위험 0..1 (고를 때 감점. 다친 대원은 0 보다 큰 방법을 고르지 않는다)
  plain: boolean;      // 평소 방법: 보고서 문장·요약 줄에 넣지 않고, 시작을 따로 알리지 않는다
  record?: boolean;    // 기록 전용: 고르지 않는다 (R1 이 이미 하는 행동, 지금의 분기 이름). 시작도 알리지 않는다 — plain 값은 보고서에만 쓴다
  can: (c: MethodCtx) => boolean;        // 상황 조건 (믿음·생김새·자기 몸·동료). 장비는 넣지 않는다 — kits·altUnit·needUnit 에만
  situ?: (c: MethodCtx) => number;       // 상황 배율 (없으면 1)
  skill?: (c: MethodCtx) => number;      // 사람 배율 (없으면 1)
}

// ───────────────────────── 방법 표 ─────────────────────────
/** 실행부가 아직 없는 방법: 고르지 않는다. 그 방법을 구현하는 단계가 조건으로 바꾼다 */
export const NOT_YET = (): boolean => false;
type Extra = Partial<Pick<MethodDef, 'altUnit' | 'needUnit' | 'record' | 'can' | 'situ' | 'skill'>>;
const row = (id: MethodId, work: WorkKind[], name: string, short: string, label: string, noun: string, kits: KitId[], pref: number, risk: number, plain: boolean, x: Extra = {}): MethodDef =>
  ({ id, work, name, short, label, noun, kits, altUnit: x.altUnit, needUnit: x.needUnit, pref, risk, plain, record: x.record, can: x.can ?? NOT_YET, situ: x.situ, skill: x.skill });
const REC: Extra = { record: true };

// ── 수난 구조의 조건·배율 (§4.1) — 대상의 위치·물살·위중은 모두 믿음에서(MethodCtx 의 reach·flow·weak) ──
/** 닿는 거리 (칸): 손 1.2 · 장대 2.0 · 구명환 2.8 · 구명줄·즉석 부력물 3.6(THROW_REACH) */
export const HAND_REACH = 1.2, POLE_REACH = 2.0, RING_REACH = 2.8;
/** 헤엄쳐 들어갈 수 있는 수영 능력의 문턱 (구명조끼를 입으면 낮다 — §4.1 swim) */
export const SWIM_MIN = 0.35, SWIM_MIN_PFD = 0.25;
/** 하류 차단: 대상이 기다릴 자리에 닿는 예상(초)이 이 안이면 그대로, 늦은 쪽(SOON~LATE)은 점수 ×0.5, 넘으면 고르지 않는다 */
export const CATCH_SOON = 40, CATCH_LATE = 90;
/** 같은 대상에게 헤엄쳐 들어간 동료가 있다 — 던지는 방법은 그 동료에게 걸린다 */
const mateSwims = (c: MethodCtx): boolean => { for (let k = 0; k < c.mates.length; k++) if (c.mates[k].task!.method === 'swim') return true; return false; };
/** 같은 부대에서 보트를 쓰는 동료가 있다 (부대마다 보트는 한 척 — 고무보트·구조정) */
const unitBoats = (c: MethodCtx): boolean => {
  const ag = c.s.agents;
  for (let k = 0; k < ag.length; k++) { const b = ag[k]; if (b !== c.a && b.unitId === c.a.unitId && b.status === 'active' && b.task !== null && b.task.method === 'boat') return true; }
  return false;
};
/** 던지는 방법(구명환·구명줄)의 상황 배율: 위중 ×0.35 · 빠른 물살 ×0.85 · 밤·비·안개 ×0.9 */
const throwSitu = (c: MethodCtx): number => (c.weak ? 0.35 : 1) * (c.flow >= FAST_FLOW ? 0.85 : 1) * (c.sim.weather !== 'clear' ? 0.9 : 1);
/** 사람 배율: 던지기 0.8 + 0.4 × 구조 능력, 뻗기 0.9 + 0.2 × 구조 능력 */
const throwSkill = (c: MethodCtx): number => 0.8 + 0.4 * c.r.skills.rescue;
const reachSkill = (c: MethodCtx): number => 0.9 + 0.2 * c.r.skills.rescue;
/**
 * 하류 차단의 예상 시간(초): 믿음 속 대상이 떠내려가고 있고(drift > 0) 같은 줄 하류 8칸 안에 대원이 걸어서 닿는 뭍(다리·굽은 물가)이 있으면
 * 대상이 그 앞 칸에 닿기까지 (점 − 1 − x) / drift. 아니면 Infinity
 */
function catchEta(c: MethodCtx): number {
  if (c.cb === null || !(c.flow > 0)) return Infinity;
  const pt = catchPoint(c.s, c.cb.x, c.cb.y, c.a);
  return pt === null ? Infinity : Math.max(0, pt.x - 1 - c.cb.x) / c.flow;
}

// ── 문·통로의 조건·배율 (§4.2·§4.2a) — 대상 칸(tg.tile)의 생김새와 믿음만 ──
/** 늘 고를 수 있다 (맨몸·평소 방법과, 장비만 있으면 되는 방법) */
const ALWAYS = (): boolean => true;
/** 무장 현장에서 믿음에 대치·교전 중인 용의자가 있으면 시끄러운 방법(발차기·충격기) ×0.7 — 까닭 quiet 는 조용한 방법(할리건·유압)이 이겼을 때 */
const quietMul = (c: MethodCtx): number => (c.s.kind === 'armed' && hotBelief(c.a) ? 0.7 : 1);
/** 폭파 진입의 거리 (칸): 믿음 속 사람이 이 안에 없어야 한다 · 가스·분진·구조 조짐과 살아 있는 장치가 이 안에 없어야 한다 */
export const CHARGE_NEAR = 2.5, CHARGE_FAR = 6;
/** 그 칸의 네 이웃에 문 칸이 있는가 (문을 막은 잔해 — 생김새) */
function byDoor(s: Scene, i: number): boolean {
  const w = s.w, x = i % w;
  return (x > 0 && s.tiles[i - 1] === T.DOOR) || (x < w - 1 && s.tiles[i + 1] === T.DOOR) || (i >= w && s.tiles[i - w] === T.DOOR) || (i + w < s.tiles.length && s.tiles[i + w] === T.DOOR);
}
/** 문(또는 잔해) 칸 양쪽의 구역 (생김새) */
function sidesOf(s: Scene, i: number): number[] {
  const w = s.w, out: number[] = [];
  for (const j of [i, i - 1, i + 1, i - w, i + w]) if (j >= 0 && j < s.region.length && s.region[j] >= 0 && out.indexOf(s.region[j]) < 0) out.push(s.region[j]);
  return out;
}
/**
 * 폭파 진입을 고를 수 있는가 (§4.2a 의 조건 ①~⑤ — 믿음·생김새·동료의 겉만. 장비는 kits: ['charge']):
 *   대상: 문은 믿음 blk 'locked', 잔해는 믿음 blk 'debris' 이고 네 이웃에 문 칸(문을 막은 것 — 복도를 가로지른 잔해는 아니다)
 *   ① 믿음 속 살아 있는 구조 대상(인질 포함)이 2.5칸 안에 없고, 같은 칸을 다른 동료가 맡고 있지 않다(문·잔해 임무나 하위 작업)
 *   ② 믿음 속 가스·분진 조짐(단계 ≥ 1)이 6칸 안이나 문 양쪽 구역에 없고(자리를 모르는 조짐은 어디든 막는다), 살아 있는 누출이 6칸 안에 없다
 *   ③ 살아 있는 장치(폭발물)가 6칸 안에 없다 ④ 붕괴 현장이 아니고 구조 조짐(단계 ≥ 1)이 6칸 안에 없다 ⑤ 무장 현장은 진입이 정해진 뒤에만
 */
function chargeOk(c: MethodCtx): boolean {
  const s = c.s, i = c.tg.tile;
  if (i < 0 || s.kind === 'collapse') return false;
  if (s.kind === 'armed' && !s.entryOrdered) return false;
  const blk = c.a.beliefs.val<string>('blk', i);
  if (c.work === 'force' ? blk !== 'locked' : blk !== 'debris' || !byDoor(s, i)) return false;
  const x = i % s.w, y = (i / s.w) | 0;
  const cs = c.a.beliefs.list('cas');
  for (let k = 0; k < cs.length; k++) { const v = cs[k].value as CasBelief; if (v.band < 3 && v.where === 'scene' && Math.hypot(v.x - x, v.y - y) <= CHARGE_NEAR) return false; }
  const ag = s.agents;
  for (let k = 0; k < ag.length; k++) {
    const b = ag[k], bt = b.task;
    if (b === c.a || b.status !== 'active' || bt === null) continue;
    if (((bt.kind === 'force' || bt.kind === 'clear') && bt.tile === i) || (bt.sub !== null && bt.sub.tile === i)) return false;
  }
  const sides = sidesOf(s, i);
  const sg = c.a.beliefs.list('sign');
  for (let k = 0; k < sg.length; k++) {
    const v = sg[k].value as SignBelief;
    if (v.level < 1 || (v.kind !== 'gas' && v.kind !== 'dust' && v.kind !== 'struct' && v.kind !== 'bldg')) continue;
    if (v.x < 0 || Math.hypot(v.x - x, v.y - y) <= CHARGE_FAR || ((v.kind === 'gas' || v.kind === 'dust') && sides.indexOf(v.region) >= 0)) return false;
  }
  const hz = c.a.beliefs.list('haz');
  for (let k = 0; k < hz.length; k++) {
    const v = hz[k].value as { kind: string; active: boolean; x: number; y: number };
    if (v.active && (v.kind === 'bomb' || v.kind === 'leak' || v.kind === 'gas') && Math.hypot(v.x - x, v.y - y) <= CHARGE_FAR) return false;
  }
  return true;
}

/**
 * 방법 표 (§4). Record 라 MethodId 를 늘리면 컴파일이 줄을 강제한다. 같은 점수면 이 표의 순서가 이긴다.
 * 수치(pref·risk)는 설계서의 시작값이다. 조건(can)·배율(situ·skill)은 그 방법을 구현하는 단계가 채운다.
 */
export const METHOD: Record<MethodId, MethodDef> = {
  // ── 수난 구조 waterRescue (§4.1): 뻗기 → 던지기 → 배로 → 들어가기. 단계 1a 가 물가 방법 여섯(hand·pole·ring·rope·improvise·catch)을 켰다 ──
  hand: row('hand', ['waterRescue'], '손 뻗어 붙잡기', '손', '손 뻗어 붙잡기', '손을 뻗어 붙잡아', [], 1.0, 0, true,
    { can: (c) => c.reach <= HAND_REACH && !c.s.quay, situ: (c) => (c.weak ? 0.7 : 1), skill: reachSkill }),      // 안벽(선박 화재의 부두)에서는 손이 물에 닿지 않는다
  pole: row('pole', ['waterRescue'], '장대 뻗기', '장대', '장대 뻗기', '갈고리 장대로', ['pole'], 0.92, 0, true,
    { can: (c) => c.reach <= POLE_REACH, situ: (c) => (c.weak ? 0.8 : 1), skill: reachSkill }),
  ring: row('ring', ['waterRescue'], '구명환 투척', '구명환', '구명환 투척', '구명환을 던져', ['ring'], 0.84, 0, false,
    { can: (c) => c.reach <= RING_REACH && !mateSwims(c), situ: throwSitu, skill: throwSkill }),
  rope: row('rope', ['waterRescue'], '구명줄 투척', '구명줄', '구조 줄 투척', '구명줄로', ['rope'], 0.85, 0, true,      // 지금의 방법
    { can: (c) => c.reach <= THROW_REACH && !mateSwims(c), situ: throwSitu, skill: throwSkill }),
  improvise: row('improvise', ['waterRescue'], '즉석 부력물', '즉석 부력물', '즉석 부력물 투척', '옷과 끈을 이어 던져', [], 0.5, 0, false,      // 누구나 고를 수 있는 맨몸 방법 (옷·끈을 이은 줄과 빈 통)
    { can: (c) => c.reach <= THROW_REACH && !mateSwims(c), situ: (c) => (c.weak ? 0.35 : 1) * (c.reach > 2.4 ? 0.6 : 1) * (c.sim.weather !== 'clear' ? 0.9 : 1), skill: throwSkill }),
  catch: row('catch', ['waterRescue'], '하류에서 기다렸다 붙잡기', '하류 차단', '하류에서 대기', '하류에서 기다렸다 붙잡아', [], 0.8, 0, false,
    { can: (c) => catchEta(c) <= CATCH_LATE, situ: (c) => (catchEta(c) > CATCH_SOON ? 0.5 : 1) * (c.weak ? 0.8 : 1) * (c.flow >= FAST_FLOW ? 1.3 : 1) }),
  // 단계 1b: 헤엄과 줄 확보. 헤엄은 수영 능력이 문턱(구명조끼가 있으면 낮다)을 넘고 손이 닿지 않는 대상에게 — 구명조끼는 "있어야 하는" 장비가 아니라 kits 에 넣지 않는다(실제 소지로 본다)
  swim: row('swim', ['waterRescue'], '헤엄쳐 접근', '헤엄', '헤엄쳐 접근', '헤엄쳐 들어가', [], 0.45, 0.3, false,
    { can: (c) => c.reach > HAND_REACH && !mateSwims(c) && swimOf(c.sim, c.a) >= (kitCount(c.sim, c.a.rid, 'pfd') > 0 ? SWIM_MIN_PFD : SWIM_MIN),      // 한 대상에 헤엄은 한 사람 (§4.1 "동료와의 조건": 줄이 있으면 줄 확보, 없으면 손·장대만 남는다)
      situ: (c) => (c.weak ? 1.15 : 1) * (c.flow >= FAST_FLOW ? 0.6 : 1) * (c.reach > THROW_REACH ? 1.3 : 1) * (c.s.quay ? 0.8 : 1) * (hoistOver(c.sim, c.s) ? 0.7 : 1),      // 상공 헬기 ×0.7 — R3 를 합칠 때 지운다(R3 S15 가 대신한다)
      skill: (c) => 0.5 + swimOf(c.sim, c.a) }),
  tend: row('tend', ['waterRescue'], '구조자 줄 확보', '줄 확보', '구조자 줄 확보', '헤엄치는 동료의 줄을 잡아', ['rope'], 0.9, 0, false,
    { can: mateSwims }),      // 같은 대상에게 헤엄쳐 들어가는 동료가 있다 (줄을 잡아 주면 그 동료의 사고율 ×0.5)
  // 단계 1c: 보트 — 고무보트(로프 대원)를 들었거나 구조정의 대원이면. 같은 부대에서 보트를 쓰는 동료가 없을 때 (한 부대에 보트 한 척)
  boat: row('boat', ['waterRescue'], '보트 접근', '보트', '보트 접근', '보트로 다가가', ['raft'], 0.78, 0.08, false,
    { altUnit: ['boat'], can: (c) => !unitBoats(c), situ: (c) => (c.weak ? 1.15 : 1) * (c.flow >= FAST_FLOW ? 1.1 : 1) * (c.reach > THROW_REACH ? 1.2 : 1) }),
  hoist: row('hoist', ['hoist'], '헬기 호이스트', '호이스트', '호이스트 인양', '호이스트로 끌어올려', [], 0, 0, false, REC),      // R1 의 공중 임무 — methodRun.recordAir 가 기록만 한다
  // ── 문·통로 force·clear, 이동 중 하위 작업 (§4.2·§4.2a). 단계 2 가 켰다 — 속도는 실행부(methodRun.blockerRate), 폭파 진입은 methodRun.runCharge ──
  kick: row('kick', ['force'], '발로 차기·어깨', '발차기', '문 걷어차기', '발로 차', [], 0.5, 0, false,      // 맨몸 방법 (늘 남는다)
    { can: ALWAYS, situ: quietMul }),
  irons: row('irons', ['force'], '할리건·도끼', '할리건', '문 강제 개방', '할리건으로', ['irons'], 0.85, 0, true, { can: ALWAYS }),      // 조용하다
  ram: row('ram', ['force'], '충격기', '충격기', '충격기 개방', '충격기로', ['breachKit'], 0.8, 0, false,      // 경찰은 0.9 (교본 선호) — 끝날 때 13칸 안의 용의자가 문 쪽을 돌아본다
    { can: ALWAYS, situ: (c) => quietMul(c) * (c.r.dept === 'police' ? 0.9 / 0.8 : 1) }),
  hydraulic: row('hydraulic', ['force'], '유압 개방기', '유압 개방', '유압 개방', '유압 개방기로', ['spreader'], 0.9, 0, false, { can: ALWAYS }),      // 시작할 때 장비 확인 (숨은 고장 → broken)
  handClear: row('handClear', ['clear'], '손으로 치우기', '손 제거', '잔해 제거', '손으로 잔해를 치워', [], 0.55, 0, true, { can: ALWAYS }),      // 맨몸 방법 (늘 남는다)
  toolClear: row('toolClear', ['clear'], '장비로 절단·지렛대', '장비 제거', '잔해 절단', '장비로 잔해를 잘라', ['spreader', 'irons', 'lightRescue', 'breachKit'], 0.8, 0, true, { can: ALWAYS }),
  charge: row('charge', ['force', 'clear'], '폭파 진입', '폭파', '폭파 진입', '폭파 장약으로', ['charge'], 0.8, 0.1, false,      // 사용자 결정 2026-11-15 (§4.2a) — 조건일 때만. 진입 순간 ×1.3 · 문을 막은 잔해 ×1.4 (시끄러운 방법의 ×0.7 은 걸지 않는다)
    { can: chargeOk, situ: (c) => (c.s.kind === 'armed' && c.s.entryOrdered ? 1.3 : 1) * (c.work === 'clear' ? 1.4 : 1) }),
  // ── 구출 extricate (§4.3) ──
  manual: row('manual', ['extricate'], '수동 구출', '수동 구출', '수동 구출', '맨손으로 끌어내', [], 0.5, 0, false),
  basic: row('basic', ['extricate'], '손 공구 구출', '손 공구', '구조 작업', '손 공구로', ['irons', 'lightRescue'], 0.7, 0, true),
  spread: row('spread', ['extricate'], '문 벌리기', '문 벌리기', '유압 전개', '유압 구조기로 문을 벌려', ['spreader'], 0.85, 0, true),
  roof: row('roof', ['extricate'], '지붕 절단', '지붕 절단', '지붕 절단', '지붕을 잘라 내', ['spreader'], 0.8, 0, false),
  rapid: row('rapid', ['extricate'], '급박 구출', '급박 구출', '급박 구출', '급히 끌어내', [], 0.95, 0.05, false),      // risk 는 "0 보다 크다"만 설계서에 있다 — 값은 단계 3 이 정한다
  haul: row('haul', ['extricate'], '줄로 끌어올리기', '끌어올리기', '줄로 끌어올리기', '줄로 끌어올려', ['rope'], 0.9, 0, false),
  tunnel: row('tunnel', ['extricate'], '손으로 파기', '손 파기', '잔해 파내기', '손으로 잔해를 파내', [], 0.5, 0.1, false),      // risk: 위와 같다
  airbag: row('airbag', ['extricate'], '에어백 들기', '에어백', '에어백 설치', '에어백으로 들어 올려', ['airbag'], 0.85, 0, false),
  shore: row('shore', ['extricate'], '지지대 먼저', '지지대', '지지대 설치', '지지대를 먼저 세우고', ['shoring'], 0.9, 0, false),
  // ── 수색·탐지 search (§4.4) ──
  call: row('call', ['search'], '호출·청취 수색', '호출 수색', '수색', '부르며 훑어', [], 0.6, 0, true),      // 지금의 방법 (실내·붕괴)
  listen: row('listen', ['search'], '청음 탐지', '청음', '청음 탐지', '청음 장비로', ['searchKit'], 0.85, 0, false),
  line: row('line', ['search'], '줄 수색', '줄 수색', '수색', '줄지어 훑어', [], 0.6, 0, true),      // 지금의 방법 (야외)
  hail: row('hail', ['search'], '확성기 호출 수색', '확성기', '확성기 호출', '확성기로 불러', ['megaphone'], 0.75, 0, false),
  thermal: row('thermal', ['search'], '열화상 수색', '열화상', '열화상 수색', '열화상 카메라로', ['tic'], 0.8, 0, false),
  // ── 화재 suppress (§4.5): 다섯의 risk 는 모두 0 (노출은 실행의 연기·열 피해로 따로 들어간다) ──
  interior: row('interior', ['suppress'], '내부 공격', '내부 공격', '화재 진압', '안으로 들어가', ['hose'], 0.85, 0, true),      // 지금의 방법
  defensive: row('defensive', ['suppress'], '외부 방어 방수', '외부 방수', '외부 방수', '밖에서 방수해', ['hose'], 0.7, 0, false),
  aerial: row('aerial', ['suppress'], '고가 사다리 방수', '고가 방수', '고가 방수', '고가 사다리에서 방수해', ['hose'], 0.8, 0, false, { needUnit: ['ladder'] }),
  extinguisher: row('extinguisher', ['suppress'], '소화기', '소화기', '소화기 분사', '소화기로', ['extinguisher'], 0.6, 0, false),
  ventilate: row('ventilate', ['suppress'], '배연(송풍기)', '배연', '배연 설치', '송풍기로 연기를 빼고', ['fan'], 0.75, 0, false),
  // ── 무장 engage·arrest (§4.6): 지금의 분기와 R1 의 행동은 기록 전용, 새 방법은 비살상탄·저격 둘 ──
  chase: row('chase', ['engage'], '추격 검거', '추격', '추격', '뒤쫓아', [], 0, 0, true, REC),
  breach: row('breach', ['engage'], '진입 제압', '진입', '진입', '진입해', [], 0, 0, true, REC),
  bang: row('bang', ['engage'], '섬광탄 제압', '섬광탄', '섬광탄', '섬광탄으로 무력화한 뒤', ['flashbang'], 0, 0, false, REC),
  tackle: row('tackle', ['engage', 'arrest'], '덮쳐 제압', '덮치기', '제압', '덮쳐', [], 0, 0, true, REC),
  cover: row('cover', ['engage'], '엄폐 사격', '엄폐 사격', '엄폐 사격', '엄폐 사격으로', [], 0, 0, true, REC),
  taser: row('taser', ['engage', 'arrest'], '테이저', '테이저', '테이저', '테이저로 무력화한 뒤', ['taser'], 0, 0, false, REC),
  shield: row('shield', ['engage', 'arrest'], '방패 밀착 제압', '방패', '방패 제압', '방패로 밀어붙여', ['shield'], 0, 0, false, REC),
  beanbag: row('beanbag', ['engage', 'arrest'], '비살상탄', '비살상탄', '비살상탄 조준', '비살상탄으로 무력화한 뒤', ['beanbag'], 0.8, 0, false),
  sniper: row('sniper', ['engage'], '결정적 저격', '저격', '저격 조준', '저격으로', ['sniper'], 0.6, 0, false),
  // ── 응급 treat · 이송 수단 load (§4.7) ──
  stay: row('stay', ['treat'], '현장 안정 후 이송', '현장 처치', '응급 처치', '현장에서 안정시켜', [], 0.8, 0, true),      // 지금의 방법
  rush: row('rush', ['treat'], '즉시 이송', '즉시 이송', '즉시 이송 준비', '최소한만 처치하고 곧바로', ['bag', 'alsBag', 'doctorKit'], 0.9, 0, false),
  airlift: row('airlift', ['load'], '헬기 이송', '헬기 이송', '헬기 탑승', '헬기로', [], 0, 0, false, REC),
  // ── 누출 조치 mitigate · 통제 perimeter (§4.8) ──
  seal: row('seal', ['mitigate'], '누출 조치', '누출 조치', '위험 요소 조치', '직접', [], 0.8, 0, true),      // 지금의 방법 (밸브 차단·균열 보강·연료 차단)
  ventFirst: row('ventFirst', ['mitigate'], '환기 후 차단', '환기 후 차단', '환기 후 차단', '먼저 환기한 뒤', [], 0.75, 0, false),
  cordon: row('cordon', ['perimeter'], '출입구 통제', '출입 통제', '출입구 통제', '출입구를 막아', [], 0.7, 0, true),      // 지금의 방법
  announce: row('announce', ['perimeter'], '대피 방송', '대피 방송', '대피 방송', '확성기로', ['megaphone'], 0.8, 0, false),
  // ── 야외 수색 (§4.9 — 7단계, 선택) ──
  air: row('air', ['search'], '공중 수색', '공중 수색', '공중 수색', '상공에서', [], 0, 0, false, REC),      // R1 경찰 헬기의 관측자 — 기록 전용
  drone: row('drone', ['search'], '드론 열화상', '드론', '드론 수색', '드론으로', [], 0.8, 0, false),      // 장비가 생기면 kits 를 채운다
  dog: row('dog', ['search'], '탐지견', '탐지견', '탐지견 수색', '탐지견으로', [], 0.85, 0, false),      // 부대가 생기면 needUnit 을 채운다
  // ── (N9 §5.12) 새 방법 다섯 — 단계 1 은 줄만(can = NOT_YET). 수치(pref·risk)는 시작값이고, 조건·배율·장비는 그 방법을 쓰는 단계가 채운다 ──
  // 잠수: 물에 잠긴 차·선실 안의 사람(믿음 sunk · haz sunk)에게 3칸 안에서 25초 (단계 5). 장비는 diveKit(단계 2 에 생긴다)으로 바꾼다 — 지금은 있는 드라이슈트만 적어 둔다
  dive: row('dive', ['waterRescue', 'extricate', 'search'], '잠수 구조', '잠수', '잠수 구조', '잠수해 들어가', ['drysuit'], 0.8, 0.1, false),
  // 오일펜스: 기름 유출의 펜스 자리(boomSite)에 편다 (단계 9). 장비 oilBoom 은 단계 2 에 생긴다 — 그때 kits 를 채운다
  boom: row('boom', ['mitigate'], '오일펜스 전개', '오일펜스', '오일펜스 전개', '오일펜스를 펼쳐', [], 0.85, 0, false),
  // 방패 저지선: 군중의 흐름 자리를 막는 cordon (N8 의 임무 — 막는 정도 0.8, 단계 4)
  shieldLine: row('shieldLine', ['cordon'], '방패 저지선', '방패 저지선', '방패 저지선', '방패로 줄을 지어', ['shield'], 0.85, 0, false),
  // 제독 텐트 · 물 세척: 오염된 구조 대상의 제독 15초 · 45초 (단계 6). 제독 장비 deconKit 은 단계 2 에 생긴다 — 그때 deconTent 의 kits 를 채운다
  deconTent: row('deconTent', ['decontam'], '제독 텐트', '제독 텐트', '제독 텐트', '제독 텐트에서 씻어', [], 0.9, 0, false),
  hoseWash: row('hoseWash', ['decontam'], '물 세척 제독', '물 세척', '물 세척 제독', '호스로 씻어 내', ['hose'], 0.5, 0, false),
};
/** 표의 순서 (같은 점수면 앞이 이긴다) */
export const METHOD_ORDER: MethodId[] = Object.keys(METHOD) as MethodId[];
let byWork: Partial<Record<WorkKind, MethodId[]>> | null = null;
/** 그 임무의 방법들 (표의 순서, 기록 전용 포함). 방법이 없는 임무면 빈 배열 */
export function methodsOf(work: WorkKind): MethodId[] {
  if (!byWork) {
    byWork = {};
    for (const m of Object.keys(METHOD) as MethodId[]) for (const w of METHOD[m].work) (byWork[w] ??= []).push(m);
  }
  return byWork[work] ?? [];
}

/**
 * 임무별 갈래 — 고를 것이 없을 때(chooseMethod 가 null) 무엇을 하는가 (§3.4).
 *   refuse    맡지 않는다(methodFit 0). 실행 중이면 finish(false, 'nomethod') — 수난 구조 (R3 가 해체를 더한다)
 *   always    늘 남는 맨몸·평소 방법이 있어 null 이 생기지 않는다 — 문·잔해·구출·수색·처치·누출 조치·통제
 *   optional  선택 임무: 방법을 비운 채 지금 코드로 이어 간다(끝내지 않는다) — 진압·교전·검거·탑승·호이스트
 * 표에 없는 임무는 방법이 없다.
 */
export const WORK_MODE: Partial<Record<WorkKind, 'refuse' | 'always' | 'optional'>> = {
  waterRescue: 'refuse',
  force: 'always', clear: 'always', extricate: 'always', search: 'always', treat: 'always', mitigate: 'always', perimeter: 'always',
  suppress: 'optional', engage: 'optional', arrest: 'optional', load: 'optional', hoist: 'optional',
  cordon: 'always', decontam: 'always',      // (N9 §5.12) 방패가 없어도 통제는 맡는다 · 물 세척이 늘 남는다 — 단계 1 은 표의 값만 (methodRun 을 부르는 곳이 아직 없다)
};
/** 대상 믿음이 없으면(아직 못 봤다) 후보가 없는 임무 (R3 가 해체를 더한다) */
const NEEDS_CAS: Partial<Record<WorkKind, boolean>> = { waterRescue: true, extricate: true };

// ───────────────────────── 문구 ─────────────────────────
/** 방법을 시작하며 하는 말 (§3.6). 기록 전용 방법은 시작을 알리지 않으므로 비워 둔다 */
export const SAY: Record<MethodId, string> = {
  hand: '손을 뻗어 붙잡겠습니다.', pole: '갈고리 장대를 뻗겠습니다.', ring: '구명환을 던지겠습니다.', rope: '구명줄을 던지겠습니다.',
  improvise: '옷을 이어 던지겠습니다.', catch: '하류에서 기다렸다 붙잡겠습니다.', swim: '헤엄쳐 들어가겠습니다.', tend: '헤엄치는 동료의 줄을 잡겠습니다.',
  boat: '보트를 띄우겠습니다.', hoist: '',
  kick: '장비 없이 문을 걷어차 열겠습니다.', irons: '할리건으로 문을 따겠습니다.', ram: '충격기로 문을 부수겠습니다.', hydraulic: '유압 개방기로 문을 열겠습니다.',
  handClear: '손으로 잔해를 치우겠습니다.', toolClear: '장비로 잔해를 잘라 내겠습니다.', charge: '장약 설치합니다. 물러서십시오.',
  manual: '장비 없이 손으로 끌어내겠습니다.', basic: '손 공구로 구출하겠습니다.', spread: '유압 구조기로 문을 벌리겠습니다.', roof: '지붕을 잘라 내겠습니다.',
  rapid: '급박 구출합니다. 바로 끌어내겠습니다.', haul: '줄을 내려 끌어올리겠습니다.', tunnel: '손으로 잔해를 파내겠습니다.', airbag: '에어백으로 들어 올리겠습니다.',
  shore: '지지대부터 세우겠습니다.',
  call: '부르며 수색하겠습니다.', listen: '청음 장비로 탐지하겠습니다.', line: '줄지어 수색하겠습니다.', hail: '확성기로 부르며 수색하겠습니다.', thermal: '열화상 카메라로 훑겠습니다.',
  interior: '안으로 들어가 진압하겠습니다.', defensive: '밖에서 방수하겠습니다.', aerial: '고가 사다리에서 방수하겠습니다.', extinguisher: '소화기로 끄겠습니다.',
  ventilate: '송풍기를 설치해 연기를 빼겠습니다.',
  chase: '', breach: '', bang: '', tackle: '', cover: '', taser: '', shield: '',
  beanbag: '비살상탄으로 무력화하겠습니다.', sniper: '저격 자리를 잡겠습니다.',
  stay: '현장에서 처치하겠습니다.', rush: '즉시 이송합니다. 최소한만 처치하겠습니다.', airlift: '',
  seal: '누출을 막겠습니다.', ventFirst: '먼저 환기한 뒤 차단하겠습니다.', cordon: '출입구를 통제하겠습니다.', announce: '주변에 대피 방송을 합니다.',
  air: '', drone: '드론을 띄우겠습니다.', dog: '탐지견을 풀겠습니다.',
  dive: '잠수해 들어가겠습니다.', boom: '오일펜스를 펼치겠습니다.', shieldLine: '방패로 저지선을 치겠습니다.', deconTent: '제독 텐트에서 씻기겠습니다.', hoseWash: '호스로 씻어 내겠습니다.',      // (N9)
};
/** 까닭을 먼저 말하는 한 문장 (없으면 빈 글). failed·broken·tooFar·team 으로 바꿀 때의 말은 실행부(switchMethod)가 사유로 만든다 */
function whySay(why: MethodWhy, missing: KitId | undefined): string {
  switch (why) {
    case 'noGear': return missing ? `${josa(kitName(missing), '이/가')} 없습니다.` : '';
    case 'tooFar': return '던져서 닿지 않는 거리입니다.';
    case 'weak': return '대상이 줄을 잡을 힘이 없습니다.';
    case 'fast': return '물살이 빠릅니다.';
    case 'danger': return '추가 위험이 있습니다.';
    case 'quiet': return '소리를 내면 안 됩니다.';
    default: return '';
  }
}
/** 시작 문구: "구조 로프가 없습니다. 헤엄쳐 들어가겠습니다." */
export function sayStart(m: MethodId, why: MethodWhy, missing?: KitId): string {
  const head = whySay(why, missing);
  return head ? `${head} ${SAY[m]}` : SAY[m];
}
/** 까닭을 짧게 (패널: "헤엄쳐 접근 — 구조 로프 없음"). 평소 선택·가까움은 빈 글 */
export function whyNote(why: MethodWhy | undefined, missing?: KitId): string {
  switch (why) {
    case 'noGear': return missing ? `${kitName(missing)} 없음` : '장비 없음';
    case 'tooFar': return '던져서 닿지 않는 거리';
    case 'weak': return '대상이 줄을 못 잡음';
    case 'fast': return '빠른 물살';
    case 'failed': return '앞 방법 실패';
    case 'broken': return '장비 고장';
    case 'danger': return '추가 위험';
    case 'quiet': return '소리를 내지 않으려';
    case 'team': return '동료와 짝';
    default: return '';
  }
}

// ───────────────────────── 지형 (생김새만) ─────────────────────────
const COMPS = new WeakMap<Scene, { v: number; comp: Int32Array }>();
/**
 * 뭍 칸(걸어 다닐 수 있는 칸)의 연결 성분 번호. 다리·문·계단으로 이어진 칸은 같은 성분이고, 뭍이 아닌 칸은 -1.
 * 생김새가 바뀔 때(s.staticVersion)만 다시 칠한다 — 같은 입력 = 같은 값. 돌려준 배열을 고치지 않는다.
 */
export function landComp(s: Scene): Int32Array {
  const hit = COMPS.get(s);
  if (hit && hit.v === s.staticVersion) return hit.comp;
  const n = s.w * s.h, w = s.w, comp = new Int32Array(n).fill(-1), stack: number[] = [];
  let id = 0;
  for (let i = 0; i < n; i++) {
    if (comp[i] >= 0 || !staticPass(s.tiles[i])) continue;
    comp[i] = id; stack.push(i);
    while (stack.length) {
      const c = stack.pop()!, x = c % w;
      // 대각선 이동은 두 직교 칸이 모두 열려 있어야 하므로(grid.astar) 네 방향 연결이 곧 걸어서 닿는 범위다
      if (x > 0 && comp[c - 1] < 0 && staticPass(s.tiles[c - 1])) { comp[c - 1] = id; stack.push(c - 1); }
      if (x < w - 1 && comp[c + 1] < 0 && staticPass(s.tiles[c + 1])) { comp[c + 1] = id; stack.push(c + 1); }
      if (c >= w && comp[c - w] < 0 && staticPass(s.tiles[c - w])) { comp[c - w] = id; stack.push(c - w); }
      if (c + w < n && comp[c + w] < 0 && staticPass(s.tiles[c + w])) { comp[c + w] = id; stack.push(c + w); }
      const st = s.stairTo[c];
      if (st >= 0 && comp[st] < 0 && staticPass(s.tiles[st])) { comp[st] = id; stack.push(st); }
    }
    id++;
  }
  COMPS.set(s, { v: s.staticVersion, comp });
  return comp;
}
/** (x, y) 에서 반경 R 안의 가장 가까운 뭍 칸 (want ≥ 0 이면 그 성분의 칸만). 같은 거리면 칸 번호가 작은 쪽 */
function nearestLand(s: Scene, x: number, y: number, R: number, comp: Int32Array | null, want: number): { x: number; y: number; d: number } | null {
  const x0 = Math.max(0, Math.floor(x - R)), x1 = Math.min(s.w - 1, Math.ceil(x + R)), y0 = Math.max(0, Math.floor(y - R)), y1 = Math.min(s.h - 1, Math.ceil(y + R));
  let bi = -1, bd = R * R + 1e-9;
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    const i = ty * s.w + tx;
    if (!staticPass(s.tiles[i]) || (comp !== null && comp[i] !== want)) continue;
    const d = (tx - x) * (tx - x) + (ty - y) * (ty - y);
    if (d < bd) { bd = d; bi = i; }
  }
  return bi < 0 ? null : { x: bi % s.w, y: (bi / s.w) | 0, d: Math.sqrt(bd) };
}
/** 대원이 물 칸에 서 있다 (보트 위가 아니다) — "헤엄 중" */
export function onWater(s: Scene, a: FieldAgent): boolean { return a.afloat === undefined && s.tiles[tileOf(s, a.x, a.y)] === T.WATER; }
/** 물 칸을 헤엄쳐 지나는 값 (걷는 칸의 바탕 값 0 보다 비싸다 — 돌아갈 뭍 길이 가까우면 걷는다) */
export const SWIM_COST = 2.2;
/**
 * 헤엄 비용 (§3.5 executor.costFor): 물 칸은 SWIM_COST, 그 밖은 바탕 비용(agents.agentCost — 믿음의 장애물·불·연기) 그대로.
 * 칸마다 한 번만 불린다(astar 의 비용 함수는 순수해야 한다) — 바탕 비용은 물이 아닌 칸에서만 부른다
 */
export function swimCost(s: Scene, base: CostFn): CostFn { const tiles = s.tiles; return (i: number): number => (tiles[i] === T.WATER ? SWIM_COST : base(i)); }
/**
 * 보트 비용 (§3.5 executor.costFor — 단계 1c): 물 칸 0, 그 밖은 지나갈 수 없다(-1). 그래서 보트의 이동 목표는 늘 물 칸이어야 한다 —
 * 뭍에 대는 이동은 뭍 칸을 가운데로 range 1.5 를 주어 둘레의 물 칸에서 멈춘다(astar 는 목표 칸의 비용이 0 이상이어야 끝난다). 다리 밑은 지나지 못한다(다리 칸은 뭍이다)
 */
export function boatCost(s: Scene): CostFn { const tiles = s.tiles; return (i: number): number => (tiles[i] === T.WATER ? 0 : -1); }
/**
 * (x, y) 에서 가장 가까운 뭍 칸과 그 거리 d. from 이 있으면 from 과 같은 뭍 성분의 칸만
 * (from 이 물 위면 from 에서 가장 가까운 뭍 칸의 성분 — 다리로 이어진 건너편 둔치도 같은 성분이다).
 * 반경 maxR 안에 없으면 격자 전체로 넓히고, 그래도 없으면 null — 부르는 쪽이 s.safe → s.staging 으로 대신한다.
 */
export function reachOf(s: Scene, x: number, y: number, maxR = 4, from: FieldAgent | null = null): { x: number; y: number; d: number } | null {
  let comp: Int32Array | null = null, want = -1;
  if (from) {
    comp = landComp(s);
    want = comp[tileOf(s, from.x, from.y)];
    if (want < 0) { const near = nearestLand(s, from.x, from.y, s.w + s.h, null, -1); want = near ? comp[near.y * s.w + near.x] : -1; }
    if (want < 0) return null;
  }
  return nearestLand(s, x, y, maxR, comp, want) ?? nearestLand(s, x, y, s.w + s.h, comp, want);
}
/**
 * 하류에서 기다릴 자리: (x, y) 의 같은 줄 하류(+x) span 칸 안에서 물이 끝나는 첫 칸이 뭍이면 그 칸 (다리·굽은 물가).
 * from 이 있으면 from 과 같은 뭍 성분이어야 한다. 물이 뭍이 아닌 것(벽·바위·현장 끝)에서 끝나면 null. d = 거기까지의 칸 수.
 */
export function catchPoint(s: Scene, x: number, y: number, from: FieldAgent | null = null, span = 8): { x: number; y: number; d: number } | null {
  const cx = Math.round(x), cy = Math.min(s.h - 1, Math.max(0, Math.round(y)));
  for (let d = 1; d <= span; d++) {
    const tx = cx + d;
    if (tx >= s.w) return null;
    const i = cy * s.w + tx;
    if (s.tiles[i] === T.WATER) continue;
    if (!staticPass(s.tiles[i])) return null;
    if (from) {
      const comp = landComp(s);
      let want = comp[tileOf(s, from.x, from.y)];
      if (want < 0) { const near = nearestLand(s, from.x, from.y, s.w + s.h, null, -1); want = near ? comp[near.y * s.w + near.x] : -1; }
      if (comp[i] !== want) return null;
    }
    return { x: tx, y: cy, d };
  }
  return null;
}
/** 대상 열쇠: 같은 일·같은 대상인가 (a.mfail · I.methods 의 앞선 실패 맞추기). 'waterRescue:c3' · 'force:t412' · 'engage:h1' · 'mitigate:p7' · 'search:r2' */
export function targetKey(work: WorkKind | string, tg: MTarget): string {
  return work + ':' + (tg.cas >= 0 ? 'c' + tg.cas : tg.tile >= 0 ? 't' + tg.tile : tg.hostile >= 0 ? 'h' + tg.hostile : tg.prop >= 0 ? 'p' + tg.prop : tg.region >= 0 ? 'r' + tg.region : '-');
}

// ───────────────────────── 사람 ─────────────────────────
/**
 * 수영 능력 0..1 (§3.3). 사람별 칸이 없으므로 함수로: 체력 · 구조 능력 · 역할 보정 · 개인차.
 * 개인차는 난수 흐름이 아니라 이름의 해시다 — 명부 난수(roster-v1·v2)를 건드리지 않고, 같은 사람은 늘 같은 값이다.
 */
export function swimOf(sim: Sim, a: FieldAgent): number {
  const r = sim.responders[a.rid];
  const own = ((hashStr(r.name + ':swim') % 1000) / 1000 - 0.5) * 0.3;
  return clamp(0.15 + 0.45 * r.fitness + 0.3 * r.skills.rescue + swimBonus(sim, a.rid) + own, 0, 1);
}

// ───────────────────────── 고르기 ─────────────────────────
/** 같은 부대의 활동 대원 가운데 지금 그 장비를 쓰는 방법을 하고 있는 수 (자기 제외). 장비가 부대 몫일 때(SHARED)만 쓴다 */
function matesUsing(c: MethodCtx, id: KitId): number {
  let n = 0;
  const ag = c.s.agents;
  for (let k = 0; k < ag.length; k++) {
    const b = ag[k];
    if (b === c.a || b.unitId !== c.a.unitId || b.status !== 'active' || !b.task || !b.task.method) continue;
    if (METHOD[b.task.method].kits.indexOf(id) >= 0) n++;
  }
  return n;
}
/** 판단부의 장비 판정은 이것 하나다 (§3.3). ignoreKits 면 장비를 따지지 않는다 — noGear 까닭을 "장비를 빼고 다시 셈한 1등"으로 구할 때 */
function canUse(c: MethodCtx, m: MethodId, ignoreKits = false): boolean {
  const d = METHOD[m];
  if (d.needUnit && d.needUnit.indexOf(c.u.kind) < 0) return false;          // AND: 이 부대여야 한다
  if (ignoreKits || !d.kits.length) return true;
  if (d.altUnit && d.altUnit.indexOf(c.u.kind) >= 0) return true;            // OR: 이 부대면 장비 없이도 된다
  for (let k = 0; k < d.kits.length; k++) if (kitCount(c.sim, c.a.rid, d.kits[k]) - (SHARED ? matesUsing(c, d.kits[k]) : 0) > 0) return true;
  return false;
}
/** 그 대상에 대해 그 방법을 접은 기억이 살아 있는가. brokenOnly 면 고장(끝나지 않는 기억)만 본다 */
function remembered(c: MethodCtx, key: string, m: MethodId, brokenOnly: boolean): boolean {
  const mf = c.a.mfail;
  if (!mf) return false;
  for (let k = 0; k < mf.length; k++) {
    const q = mf[k];
    if (q.m !== m || q.k !== key) continue;
    if (brokenOnly ? q.until === Infinity : q.until > c.sim.t) return true;      // 시간이 지난 기억은 무시만 한다 (지우는 것은 실행부)
  }
  return false;
}
/** 후보와 점수 (점수 내림차순, 같으면 표의 순서). 점수 = pref × situ × skill × (1 − risk × caution) */
function rank(c: MethodCtx, key: string, tried: MethodId[] | null, brokenOnly: boolean, ignoreKits: boolean): { m: MethodId; score: number }[] {
  const out: { m: MethodId; score: number }[] = [];
  const list = methodsOf(c.work);
  const hurt = c.r.status === 'injured';      // 걸을 수 있는 다친 대원은 위험한 방법을 고르지 않는다 (H1 "가벼운 일은 계속" — 가벼운 일 안의 위험한 방법까지 막는 안전장치)
  const dm: DocCtx | null = c.dc ? { ...c.dc, m: { reach: c.reach, flow: c.flow, weak: c.weak, tile: c.tg.tile } } : null;      // (R3) 교본 배율은 받은 dc 의 사본으로 (dc 를 고치지 않는다)
  for (let k = 0; k < list.length; k++) {
    const m = list[k], d = METHOD[m];
    if (d.record || (hurt && d.risk > 0)) continue;
    if (tried !== null && tried.indexOf(m) >= 0) continue;
    if (remembered(c, key, m, brokenOnly)) continue;
    if (!canUse(c, m, ignoreKits) || !d.can(c)) continue;
    const score = d.pref * (d.situ ? d.situ(c) : 1) * (d.skill ? d.skill(c) : 1) * (1 - d.risk * c.caution) * (dm !== null ? docMethodMul(dm, m) : 1);      // (R3) × 교본 배율 (줄이 없으면 1)
    if (!(score > 0)) continue;
    let at = out.length;
    while (at > 0 && out[at - 1].score < score) at--;      // 같은 점수면 먼저 온(표에서 앞선) 방법 뒤에 선다
    out.splice(at, 0, { m, score });
  }
  return out;
}
const sameTarget = (t: Task, tg: MTarget): boolean => t.cas === tg.cas && t.prop === tg.prop && t.hostile === tg.hostile && t.region === tg.region && t.tile === tg.tile;
function makeCtx(sim: Sim, s: Scene, a: FieldAgent, work: WorkKind, tg: MTarget, t: Task | null, sense: Sense, dc: DocCtx | null): MethodCtx {
  const r = sim.responders[a.rid], u = sim.units[a.unitId];
  const cb = tg.cas >= 0 ? a.beliefs.val<CasBelief>('cas', tg.cas) ?? null : null;
  const bank = cb !== null && work === 'waterRescue' ? reachOf(s, cb.x, cb.y, 4, a) : null;
  const mates: FieldAgent[] = [];
  const ag = s.agents;
  for (let k = 0; k < ag.length; k++) { const b = ag[k]; if (b !== a && b.status === 'active' && b.task !== null && b.task.kind === work && sameTarget(b.task, tg)) mates.push(b); }
  const ops = a.beliefs.get('ops', 0);
  return {
    sim, s, a, r, u, work, t, tg, cb, bank, reach: bank ? bank.d : Infinity, flow: cb !== null ? cb.drift ?? 0 : 0, weak: cb !== null && cb.band >= 2,
    sense, mates, ops: ops ? ops.value : null, dc, caution: clamp(1.1 - 0.3 * r.composure - 0.3 * r.experience, 0.5, 1.1),
  };
}
/** 믿음 속에 대치·교전 중인 용의자가 있는가 (무장 현장의 "조용히") */
function hotBelief(a: FieldAgent): boolean {
  const hs = a.beliefs.list('hos');
  for (let k = 0; k < hs.length; k++) { const st = hs[k].value.state; if (st === 'hold' || st === 'fight') return true; }
  return false;
}
// 까닭을 가르는 묶음 (§3.4 의 3~9)
const WHY_WEAK: ReadonlySet<MethodId> = new Set<MethodId>(['swim', 'boat', 'pole', 'catch']);            // 잡을 힘이 필요 없는 방법
const WHY_DANGER: ReadonlySet<MethodId> = new Set<MethodId>(['rapid', 'shore', 'defensive', 'ventFirst', 'ventilate']);   // 위험 조건으로 점수가 오르는 방법
const WHY_QUIET: ReadonlySet<MethodId> = new Set<MethodId>(['irons', 'hydraulic']);
const LOUD: ReadonlySet<MethodId> = new Set<MethodId>(['kick', 'ram']);
const WHY_FAST: ReadonlySet<MethodId> = new Set<MethodId>(['catch', 'boat']);
const WHY_FAR: ReadonlySet<MethodId> = new Set<MethodId>(['swim', 'boat', 'catch']);
const WHY_NEAR: ReadonlySet<MethodId> = new Set<MethodId>(['hand', 'pole']);
const WHY_TEAM: ReadonlySet<MethodId> = new Set<MethodId>(['tend', 'roof']);
/** 빠른 물살로 보는 믿음 속 떠내려가는 속도 (칸/초) */
export const FAST_FLOW = 0.07;
/** 던져서 닿는 거리 (칸) — 지금의 구명줄 사거리 */
export const THROW_REACH = 3.6;

/**
 * 방법을 고른다. 상태를 바꾸지 않고 난수를 쓰지 않는다 — 같은 상황 = 같은 선택 (다양성은 장비·능력·상황의 차이에서 나온다).
 * 후보: 그 임무의 방법이고, 기록 전용이 아니고, 장비(canUse)와 상황(can)이 맞고, 이 임무에서 접지 않았고(t.tried), 그 대상에 대한 접은 기억(a.mfail)이 없는 것.
 * 하나도 없으면 차례로 넓힌다: ① t.tried 를 무시 ② 고장이 아닌 a.mfail 기억을 무시 ③ null (선택 임무는 null 이 정상이다).
 * 까닭은 위에서부터 처음 맞는 것: noGear(장비를 따지지 않은 1등이 장비 때문에 빠졌다) · weak · danger · quiet · fast · tooFar · near · team · usual.
 * 실패·고장·조건 상실로 바꿀 때의 까닭(failed·broken·tooFar·team)은 실행부(switchMethod)가 덮어쓴다.
 * dc: R3 의 교본 입력 — 실행부가 자기 모드 docCtx(…, 'self') 로 넘긴다(없으면 null). 점수에 × docMethodMul(사본, m) — 교본 줄이 없으면 1.
 */
export function chooseMethod(sim: Sim, s: Scene, a: FieldAgent, work: WorkKind, tg: MTarget, t: Task | null, sense: Sense, dc: DocCtx | null = null): MethodPick | null {
  if (!methodsOf(work).length) return null;
  const c = makeCtx(sim, s, a, work, tg, t, sense, dc);
  if (NEEDS_CAS[work] && c.cb === null) return null;      // 대상을 아직 못 봤다 — 지휘관도 믿음으로 본 대상에게만 일을 낸다
  const key = targetKey(work, tg);
  let tried = t !== null && t.tried !== undefined && t.tried.length ? t.tried : null, brokenOnly = false;
  let cands = rank(c, key, tried, false, false);
  if (!cands.length && tried !== null) { tried = null; cands = rank(c, key, null, false, false); }                                   // ① 다 써 봤으면 처음부터 다시
  if (!cands.length && a.mfail !== undefined && a.mfail.length) { brokenOnly = true; cands = rank(c, key, null, true, false); }     // ② 접은 기억을 무시 (고장은 빼고)
  if (!cands.length) return null;
  const top = cands[0].m;
  const free = rank(c, key, tried, brokenOnly, true)[0];      // 장비를 따지지 않고 다시 셈한 1등 (needUnit 은 그대로 따진다)
  if (free !== undefined && free.m !== top && !canUse(c, free.m)) return { m: top, why: 'noGear', cands, missing: METHOD[free.m].kits[0] };
  let why: MethodWhy = 'usual';
  if (c.weak && WHY_WEAK.has(top)) why = 'weak';
  else if (WHY_DANGER.has(top)) why = 'danger';
  else if (WHY_QUIET.has(top) && s.kind === 'armed' && cands.some((q) => LOUD.has(q.m)) && hotBelief(a)) why = 'quiet';
  else if (c.flow >= FAST_FLOW && WHY_FAST.has(top)) why = 'fast';
  else if (c.reach > THROW_REACH && WHY_FAR.has(top)) why = 'tooFar';
  else if (WHY_NEAR.has(top)) why = 'near';
  else if (WHY_TEAM.has(top)) why = 'team';
  return { m: top, why, cands, missing: undefined };
}
/**
 * 실행부의 1초 재확인 (§4.1): 고른 방법을 지금도 쓸 수 있는가 — 장비(canUse)와 상황 조건(can)만 본다(점수·다른 방법은 보지 않는다 — "더 좋은 방법이 보이면 바꾼다"는 없다).
 * 대상 믿음이 없으면 참이다(믿음을 잃은 것만으로 바꾸지 않는다). 상태를 바꾸지 않는다.
 */
export function methodStillFits(sim: Sim, s: Scene, a: FieldAgent, work: WorkKind, tg: MTarget, t: Task | null, m: MethodId, sense: Sense = NO_SENSE): boolean {
  const c = makeCtx(sim, s, a, work, tg, t, sense, null);
  if (NEEDS_CAS[work] && c.cb === null) return true;
  return canUse(c, m) && METHOD[m].can(c);
}
/** 작업 항목의 대상 */
export function targetOfWork(w: WorkItem): MTarget { return { cas: w.cas, prop: w.prop, hostile: w.hostile, region: w.region, tile: w.tile }; }
/**
 * 그 대원이 그 작업에 지금 쓸 수 있는 가장 좋은 방법의 점수 (없으면 0) — 배정(agents.fitFor)이 쓴다.
 * 임무를 맡기 전이므로 t = null, 감각은 0 이다. 장비는 알려진 고장만 보므로 숨은 고장이 있는 대원의 값은 고장이 없는 대원과 같다.
 */
export function methodFit(sim: Sim, s: Scene, a: FieldAgent, w: WorkItem): number {
  if (!methodsOf(w.kind).length) return 0;
  const tg = targetOfWork(w);
  const c = makeCtx(sim, s, a, w.kind, tg, null, NO_SENSE, hasDoc('method') ? docCtx(sim, s, a, 'report', w) : null);      // (R3) 남에게도 불리므로 보고 모드 (방법 줄이 없으면 만들지 않는다)
  if (NEEDS_CAS[w.kind] && c.cb === null) return 0;
  const key = targetKey(w.kind, tg);
  let cands = rank(c, key, null, false, false);
  if (!cands.length && a.mfail !== undefined && a.mfail.length) cands = rank(c, key, null, true, false);
  return cands.length ? cands[0].score : 0;
}
