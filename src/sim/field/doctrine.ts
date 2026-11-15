// 대응 교본의 판단부 엔진 (docs/specs/R3-doctrine.md §2). 분야·역할마다 "이 상황 · 이 장비 · 이 상태면 이것을 먼저"를 정한 교본 줄(field/doctrine/*.ts)을,
// 결정이 일어나는 네 자리에서 순수 함수로 판정한다 (§2.3):
//   ① fit    누가 맡는가        agents.fitFor 의 맨 끝 → docFit (늘 보고 모드 — fitFor 는 지휘관이 남에게도 부른다)
//   ② duty·act 지금 무엇을 하나  brain.think → docDuty · docAct · docRetreat · docDrop (자기 모드)
//   ③ method 어떻게 하는가      R2 methods.chooseMethod 의 점수 × docMethodMul (실행부는 자기 모드, methodFit 은 보고 모드)
//   ④ gate   실행 중의 한 걸음   실행기의 그 분기 → docGate (자기 모드)
//
// 이 파일은 **판단만** 한다 — 진실을 읽지 않고 상태를 바꾸지 않고 난수를 쓰지 않는다 (tests/doctrine.test.ts 시험 1·5 가 글자와 행동으로 잡는다):
//   읽어도 되는 것   대원의 믿음(a.beliefs), 현장의 생김새(칸·구역·출입구·대기 지점·통제 지점), 공개 지휘 상태(secureAt·entryOrdered·negotStart …),
//                    조직 정보(부대 상태·장비 수치·명부의 능력치·지구력), 동료의 겉(s.agents 의 상태·임무·자리·짝), 부르는 쪽이 잰 감각(Sense)
//   자기 몸           stateSelf 한 함수 안에서만 (체력·출혈은 그 함수 밖에 나오지 않는다 — 남의 몸은 'crew' 자기 신고로만)
//   읽으면 안 되는 것 소품·구조 대상·용의자의 진실, 칸의 불·연기, 다른 현장, 시나리오 변형, 숨은 고장, 효과·소모 함수
// import 하지 않는 것(값): agents · executor · hazards · methods · methodRun · doctrineRun · crews — agents.fitFor 와 methods.chooseMethod 가 이 파일을 부른다(순환).
//   장비는 gear.ts 의 판단용 함수로만 본다. R2 의 타입(Sense)은 import type 으로만 가져온다.
//
// 단계 0 (틀): 줄이 하나도 없다. 모든 자리가 그대로 돌려준다 — docFit 은 받은 값, docDuty·docAct·docRetreat·docDrop 은 null, docMethodMul 은 1, docGate 는 통과.
// 줄이 없으면 상태를 만들지도 않는다(첫 줄에서 돌아간다). 그래서 결과(기록 해시·a.rng 소비)가 한 글자도 바뀌지 않는다.

import type { Sim } from '../engine';
import { T } from '../types';
import type { CasBelief, CrewBelief, DocActId, DocDept, DocGateId, DocHook, FactType, FieldAgent, KitId, MethodId, Pt, RoleId, Scene, UnitKind, WorkItem, WorkKind } from '../types';
import { dist } from '../util';
import { crewHas, gunOf, groupOf, kitCount, kitHas, kitQty, roleIdOf, seatsLeft } from './gear';
import { losWalls, staticPass, tileOf } from './grid';
import { bandOf } from './injury';
import { DOCTRINE } from './doctrine/registry';
import type { DocCtx, DocEffect, DocFitAns, DocGateAns, DocPhase, DocPick, DocSit, DocState, DocThreat, DoctrineRule } from './doctrine/registry';
import type { Sense } from './methods';

// ───────────────────────── 상수 ─────────────────────────
/** 감각 없음 (보고 모드 — fitFor·methodFit 은 대원이 선 칸을 재지 않는다) */
export const ZERO_SENSE: Sense = { smoke: 0, heat: 0 };
/** 교본의 문턱 (§4 의 상태 표 · §5 · §2.10). 줄의 when 이 읽는 수는 줄의 th 에도 같은 값을 둔다 */
export const DOC = {
  AIR_OUT: 0.30,        // 공기 탈출 (비율)
  AIR_IN: 0.50,         // 위험 실내 일을 다시 맡는 공기 (비율) — 0.20 의 간격
  BAND_BACK: 75,        // 중상 신고가 0 으로 돌아오는 체력 (들어가는 쪽은 H1 bandOf 의 70)
  BLEED: 0.06,          // 출혈로 보는 초당 체력 감소
  UNDER_FIRE: 3,        // 피격 뒤 이 초 동안은 '맞고 있다'
  ROOKIE: 0.3, VETERAN: 0.7,
  MATE_R: 6,            // 혼자인가: 같은 부서 동료를 세는 거리
  BUDDY_NEAR: 2.5,      // 짝이 곁에 있다
  BUDDY_GAP: 0.1,       // 짝이 따라올 수 있는 우선도 차 (§5.2)
  FOLLOW_R: 4,          // 짝이 따라온다 (§5.4 끝)
  WATCH_R: 8,           // 밖 대기조: 출입구에서 이 거리 안 (§5.6)
  WATCH_NEED: 2,        // 밖 대기조의 수 (scba 대원을 태운 소방 부대가 오는 중이면 1)
  STAMINA_NEW: 30,      // 위험 실내 새 일을 맡지 않는 지구력
  COVER_MIN: 3, COVER_MAX: 7.5, COVER_REACH: 12,     // 엄폐 사격 자리: 위협 둘레의 고리, 대원에게서의 거리
  HIDE_R: 4,            // 숨기 자리: 대원 둘레
  THREAT_GAP: 1.8,      // 위협에 이보다 가까운 칸은 자리가 아니다
  CIV_R: 2,             // 시민이 위험하다: 위협 곁의 거리
  BOMB_NEAR: 2,         // 해체 중: 장치 곁의 거리
  W_MEM: 30,            // 판단 지점 timeout 뒤 그 작업을 맡지 않는 초 (docMem 'w:')
} as const;
/** 공기 탈출·짝 따라 나가기 — brain 의 의무 자리가 그 임무 중이면 다른 것을 보지 않는다 (TaskKind 에는 3단계가 더한다) */
export const DOC_DUTY_TASKS: ReadonlySet<string> = new Set<string>(['airOut', 'pairOut']);
/** 짝으로 쓸 수 없는 임무 (§5.2) */
const BUDDY_BUSY: ReadonlySet<string> = new Set<string>(['cover', 'rearm', 'airOut', 'pairOut', 'retreat', 'evacuate', 'rehab']);
/** 밖 대기조로 세지 않는 임무 (§5.6) */
const WATCH_BUSY: ReadonlySet<string> = new Set<string>(['airOut', 'pairOut', 'retreat', 'evacuate', 'rehab', 'pair', 'board']);
/** 위험 실내 일의 종류 (fitFor 의 공기호흡기 제한과 같은 범위 — 대상 구역이 위험 건물 실내일 때) */
const HZ_WORKS: ReadonlySet<WorkKind> = new Set<WorkKind>(['search', 'carry', 'escort', 'extricate', 'mitigate', 'overhaul']);
/** 'crew' 사실 (1단계가 FactType 에 더한다 — 그 전에는 믿음에 없다) */
const CREW_FACT = 'crew' as string as FactType;

// ───────────────────────── 누구: 분야 · 짝 ─────────────────────────
/** 대원의 교본 분야 = 역할로 정한다 (§2.2). 사다리차의 팀장·조작원은 특수 표 */
const DOC_OF_ROLE: Partial<Record<RoleId, DocDept>> = {
  patrolLead: 'police', officer: 'police', tacLead: 'police', tacOfficer: 'police', observer: 'police',
  fireLead: 'fire', nozzle: 'fire', firefighter: 'fire', engineer: 'fire', rescueLead: 'fire', extricator: 'fire', searcher: 'fire', ropeTech: 'fire',
  paramedic: 'ems', emt: 'ems', emsDriver: 'ems', doctor: 'ems', flightNurse: 'ems',
  swatLead: 'special', shield: 'special', breacher: 'special', assaulter: 'special', marksman: 'special', bombTech: 'special', robotOp: 'special', eodGuard: 'special',
  hazLead: 'special', hazTech: 'special', decon: 'special', airRescuer: 'special', boatRescuer: 'special', ladderLead: 'special', ladderOp: 'special',
  // (N8 §5.14) 새 역할 — 유관 기관은 공통 표, 포획은 특수 표, 형사·교통 경찰·핸들러는 경찰 표
  utilLead: 'common', lineman: 'common', gasTech: 'common', plumber: 'common', towDriver: 'common', catcherLead: 'special', catcher: 'special', detective: 'police', motorOfficer: 'police', k9Handler: 'police',
  // (N9 §5.12) 새 역할 아홉 — 부대의 분야와 같다 (산악·수중 소방, 제독 특수, 기동대 경찰)
  mtnLead: 'fire', mtnRescuer: 'fire', diveLead: 'fire', diver: 'fire', deconLead: 'special', deconTech: 'special', riotLead: 'police', riotShield: 'police', riotGrab: 'police',
};
/** 표에 없는 자리(조종사·부기장·정장 — 내리지 않는 자리)는 부대로 */
const DOC_OF_UNIT: Record<UnitKind, DocDept> = {
  patrol: 'police', tactical: 'police', policeHeli: 'police', engine: 'fire', rescue: 'fire', als: 'ems', bls: 'ems', medHeli: 'ems',
  swat: 'special', eod: 'special', hazmat: 'special', heli: 'special', boat: 'special', ladder: 'special',
  powerCrew: 'common', gasCrew: 'common', waterCrew: 'common', tow: 'common', animalCtl: 'special', detective: 'police', trafficPol: 'police', k9: 'police',      // (N8 §5.14)
  mtnRescue: 'fire', dive: 'fire', deconUnit: 'special', riotPol: 'police',      // (N9 §5.12)
};
export function docDeptOf(sim: Sim, rid: number): DocDept {
  const role = roleIdOf(sim, rid);
  const d = role !== null ? DOC_OF_ROLE[role] : undefined;
  return d ?? DOC_OF_UNIT[sim.units[sim.responders[rid].unitId].kind];
}
/**
 * 짝 표 (§5.1 — 역할 쌍). 같은 역할이 둘인 부대는 crew 순서로 가린다(첫째 쌍이 먼저 가져간다).
 * 최소 인원 부대(u.crew.length === minCrew)는 min 열을 쓴다. 짝 맺기(pairUp — 부대가 내린 뒤 한 번)는 3단계 doctrineRun 이 한다.
 */
export const PAIRS: Partial<Record<UnitKind, { std: [RoleId, RoleId][]; min: [RoleId, RoleId][] }>> = {
  patrol: { std: [['patrolLead', 'officer']], min: [['patrolLead', 'officer']] },
  tactical: { std: [['tacOfficer', 'tacOfficer']], min: [['tacLead', 'tacOfficer']] },
  swat: { std: [['shield', 'assaulter'], ['breacher', 'swatLead']], min: [['shield', 'assaulter'], ['breacher', 'swatLead']] },
  eod: { std: [['robotOp', 'eodGuard']], min: [] },
  engine: { std: [['nozzle', 'firefighter'], ['fireLead', 'engineer']], min: [['nozzle', 'fireLead']] },
  ladder: { std: [['nozzle', 'ladderLead']], min: [['nozzle', 'ladderLead']] },
  rescue: { std: [['extricator', 'extricator'], ['searcher', 'ropeTech']], min: [['extricator', 'extricator'], ['ropeTech', 'rescueLead']] },
  hazmat: { std: [['hazTech', 'decon'], ['hazLead', 'hazTech']], min: [['hazTech', 'decon']] },
  als: { std: [['paramedic', 'emt']], min: [] },
  bls: { std: [['emt', 'emsDriver']], min: [['emt', 'emsDriver']] },
  medHeli: { std: [['doctor', 'flightNurse']], min: [['doctor', 'flightNurse']] },
  heli: { std: [['airRescuer', 'airRescuer']], min: [['airRescuer', 'airRescuer']] },
  boat: { std: [['boatRescuer', 'boatRescuer']], min: [['boatRescuer', 'boatRescuer']] },
  // (N8 §5.14) 경찰견은 최소 인원이면 핸들러 혼자다 (min 없음)
  detective: { std: [['detective', 'detective']], min: [['detective', 'detective']] },
  k9: { std: [['k9Handler', 'officer']], min: [] },
  animalCtl: { std: [['catcherLead', 'catcher']], min: [['catcherLead', 'catcher']] },
  // (N9 §5.12) 방패 대원은 둘씩 · 잠수는 둘이(한 사람이 물가에서 줄을 잡는다). 수중 구조대의 최소 인원(팀장 + 대원 하나)은 팀장과 짝을 짓는다
  riotPol: { std: [['riotShield', 'riotShield']], min: [['riotShield', 'riotShield']] },
  dive: { std: [['diver', 'diver']], min: [['diveLead', 'diver']] },
};
/** 혼자 규칙에서 빠지는 역할 — 원래 혼자 서는 자리 (§5.1 끝). F04·P07·P17·G08 이 걸리지 않고 다시 맺지도 않는다 */
export const SOLO_OK: ReadonlySet<RoleId> = new Set<RoleId>(['marksman', 'bombTech', 'engineer', 'ladderOp', 'emsDriver', 'observer',
  'towDriver', 'motorOfficer']);      // (N8) 견인 기사·교통 순찰 대원 — 원래 혼자 다니는 자리

// ───────────────────────── 몸 상태의 신고 ─────────────────────────
/** 중상의 간격 (§2.4): H1 bandOf 의 경계를 그대로 두고, 0 으로 내려오는 쪽에만 75 의 간격을 얹는다 */
export function bandHyst(hp: number, prev: number): number { const b = bandOf(hp); return b === 0 && prev >= 1 && hp < DOC.BAND_BACK ? 1 : b; }
/** 자기 신고의 서명 (band · air · ammo · shaken) — 서명이 바뀔 때만 신고한다 (1단계 selfReport) */
export function crewSigOf(v: CrewBelief): string { return `${v.band}${v.air}${v.ammo}${v.shaken ? 1 : 0}`; }
/** 서명에서 지난 신고의 중증도 (신고한 적이 없으면 0) */
export function sigBand(sig: string | undefined): number { return sig === undefined || !sig.length ? 0 : +sig[0]; }
/** 남이 아는 그 대원의 몸: 'crew' 자기 신고 (없으면 멀쩡한 것으로) */
function reported(b: FieldAgent): CrewBelief | undefined { return b.beliefs.val<CrewBelief>(CREW_FACT, b.rid); }

// ───────────────────────── 믿음으로 본 자리 ─────────────────────────
/** 불이 났거나 가스·붕괴 현장의 건물 안 (agents.fitFor 의 fireRisk 와 같은 믿음 판정) */
function fireRisk(s: Scene, a: FieldAgent, rg: number): boolean { return rg >= 0 && ((a.beliefs.val<number>('fire', rg) ?? 0) > 0.25 || s.kind === 'fire' || s.kind === 'hazmat' || s.kind === 'collapse'); }
/** 그 구역이 위험 건물 실내인가 (a 의 믿음으로) */
function riskyRegion(s: Scene, a: FieldAgent, rg: number): boolean { return rg >= 0 && s.regions[rg] !== undefined && s.regions[rg].indoor && fireRisk(s, a, rg); }
/** 그 자리가 위험 건물 실내인가 */
function riskyAt(s: Scene, a: FieldAgent, x: number, y: number): boolean { return riskyRegion(s, a, s.region[tileOf(s, x, y)]); }
/** 작업의 대상 구역 (구역 → 믿음 속 구조 대상·동료·위험물의 자리 → 칸). 모르면 -1 */
export function regionOfWork(s: Scene, a: FieldAgent, w: WorkItem): number {
  if (w.region >= 0) return w.region;
  if (w.cas >= 0) { const cb = a.beliefs.val<CasBelief>('cas', w.cas); if (cb) return s.region[tileOf(s, cb.x, cb.y)]; }
  if (w.mate >= 0) { const mb = a.beliefs.val<{ x: number; y: number }>('mate', w.mate); if (mb) return s.region[tileOf(s, mb.x, mb.y)]; }
  if (w.prop >= 0) { const hb = a.beliefs.val<{ x: number; y: number }>('haz', w.prop); if (hb) return s.region[tileOf(s, hb.x, hb.y)]; }
  if (w.tile >= 0) return s.region[w.tile];
  return -1;
}
/** 위험 실내 일인가 (§3 읽는 법의 HZ — 종류가 수색·이송·대피 안내·구출·누출 조치·잔불 정리이고 대상 구역이 위험 건물 실내) */
export function hazWork(_sim: Sim, s: Scene, a: FieldAgent, w: WorkItem): boolean { return HZ_WORKS.has(w.kind) && riskyRegion(s, a, regionOfWork(s, a, w)); }
/** 같은 구역이거나 맞닿은 구역 (상자가 1칸 안에서 겹친다) */
function regionsNear(s: Scene, r1: number, r2: number): boolean {
  if (r1 < 0 || r2 < 0) return false;
  if (r1 === r2) return true;
  const p = s.regions[r1], q = s.regions[r2];
  return p !== undefined && q !== undefined && p.x0 <= q.x1 + 1 && q.x0 <= p.x1 + 1 && p.y0 <= q.y1 + 1 && q.y0 <= p.y1 + 1;
}
/** (X6) 믿음 속 지휘 상태(ops 사실 id 0)의 진입 금지 구역에서 그 구역의 단계 (없으면 0) */
function opsLevel(a: FieldAgent, rg: number): number {
  if (rg < 0) return 0;
  const ops = a.beliefs.val<{ zones?: { regions: number[]; level: number }[] }>('ops', 0);
  if (!ops || !ops.zones) return 0;
  let lv = 0;
  for (let k = 0; k < ops.zones.length; k++) { const z = ops.zones[k]; if (z.level > lv && z.regions.indexOf(rg) >= 0) lv = z.level; }
  return lv;
}
const airOf = (sim: Sim, rid: number): number => (kitHas(sim, rid, 'scba') ? Math.min(1, kitQty(sim, rid, 'scba') / sim.tune.airFull) : 1);

// ───────────────────────── 짝 · 밖 대기조 ─────────────────────────
/** 같은 현장에서 그 rid 의 대원 (활동 중인 사람을 먼저) */
function agentOf(s: Scene, rid: number, not: FieldAgent): FieldAgent | null {
  let best: FieldAgent | null = null;
  for (let k = 0; k < s.agents.length; k++) { const b = s.agents[k]; if (b === not || b.rid !== rid || b.status === 'left') continue; if (best === null || (b.status === 'active' && best.status !== 'active')) best = b; }
  return best;
}
/**
 * 쓸 수 있는 짝 (§5.2): a.buddy 가 활동 중이고, 부대에 철수·이송 지시가 없고, 업고 있지 않고, 상태 행동(엄폐·보급·탈출·후퇴·철수·휴식) 중이 아니며, 신고 band < 2.
 * w 가 위험 실내 일이면 짝도 공기호흡기를 멨고 공기가 AIR_IN 이상이다(조직 정보). w 가 있으면 하나 더 — 짝이 실제로 따라올 수 있어야 한다:
 * 손이 비었거나(임무 없음·대기·나를 따르는 짝 동행), 짝의 지금 일 우선도 < w 의 우선도 − 0.1, 또는 짝이 이미 같은·이웃 구역의 위험 실내 일을 맡았다.
 */
export function buddyOf(sim: Sim, s: Scene, a: FieldAgent, w: WorkItem | null = null): FieldAgent | null {
  const id = a.buddy;
  if (id === undefined || id < 0) return null;
  const b = agentOf(s, id, a);
  if (b === null || b.status !== 'active' || b.carrying !== -1 || sim.units[b.unitId].boardOrder) return null;
  const bt = b.task, bk: string | null = bt ? bt.kind : null;
  if (bk !== null && BUDDY_BUSY.has(bk)) return null;
  const rb = reported(b);
  if (rb !== undefined && rb.band >= 2) return null;
  if (w === null) return b;
  if (hazWork(sim, s, a, w) && (!kitHas(sim, b.rid, 'scba') || airOf(sim, b.rid) < DOC.AIR_IN)) return null;
  if (bt === null || bk === 'standby' || (bk === 'pair' && b.buddy === a.rid)) return b;
  const bw = bt.workId >= 0 ? s.board[bt.workId] ?? null : null;
  if (bw === null) return null;
  if (bw.priority < w.priority - DOC.BUDDY_GAP) return b;
  if (hazWork(sim, s, a, bw) && regionsNear(s, regionOfWork(s, a, bw), regionOfWork(s, a, w))) return b;
  return null;
}
/**
 * 밖 대기조의 수 (§5.6): 들어서려는 출입구 ex 에서 8칸 안의, 위험 건물 실내 밖에 선 다른 활동 대원 가운데 공기호흡기를 멨고 공기가 AIR_IN 이상이며
 * 업고 있지 않고 탈출·후퇴·철수·휴식·짝 동행·탑승 중이 아니고 위험 실내 일을 맡지 않은 사람. a 의 짝과 a 를 따르는 짝 동행은 세지 않는다.
 */
export function outsideWatch(sim: Sim, s: Scene, a: FieldAgent, ex: Pt): number {
  let n = 0;
  for (let k = 0; k < s.agents.length; k++) {
    const b = s.agents[k];
    if (b === a || b.status !== 'active' || b.rid === a.buddy || b.carrying !== -1) continue;
    const bk: string | null = b.task ? b.task.kind : null;
    if (bk === 'pair' && b.buddy === a.rid) continue;
    if (bk !== null && WATCH_BUSY.has(bk)) continue;
    if (!kitHas(sim, b.rid, 'scba') || airOf(sim, b.rid) < DOC.AIR_IN) continue;
    if (riskyAt(s, a, b.x, b.y) || dist(b.x, b.y, ex.x, ex.y) > DOC.WATCH_R) continue;
    if (b.task !== null && b.task.workId >= 0) { const bw = s.board[b.task.workId]; if (bw && hazWork(sim, s, a, bw)) continue; }
    n++;
  }
  return n;
}
/** 밖 대기조의 필요한 수: 2, 같은 사건으로 공기호흡기 대원을 태운 소방 부대가 오는 중이면 1 (조직 정보) */
export function watchNeed(sim: Sim, s: Scene): number {
  const I = sim.incidents[s.incidentId];
  for (let k = 0; k < I.assigned.length; k++) { const u = sim.units[I.assigned[k]]; if ((u.state === 'enroute' || u.state === 'turnout') && u.dept === 'fire' && crewHas(sim, u, 'scba')) return 1; }
  return DOC.WATCH_NEED;
}

// ───────────────────────── 판단 입력 DocCtx ─────────────────────────
/** 두 모드에 같은 칸 (조직 정보·명부·동료의 겉). 몸의 칸은 보고 모드의 값(-1·0·false)으로 채워 둔다 */
function baseState(sim: Sim, s: Scene, a: FieldAgent): DocState {
  const r = sim.responders[a.rid], u = sim.units[a.unitId], rid = a.rid;
  const hasScba = kitHas(sim, rid, 'scba');
  const g = gunOf(sim, rid);
  const ammo = g ? g.ammo : -1, magSize = g ? g.magSize : 0, perShot = g ? g.perShot : 1;
  const counted = g !== null && ammo !== Infinity;      // 탄을 세는가 (2단계 전에는 총기에 수량이 없다)
  const buddy = buddyOf(sim, s, a);
  let mates = 0;
  for (let k = 0; k < s.agents.length; k++) { const b = s.agents[k]; if (b !== a && b.status === 'active' && sim.responders[b.rid].dept === r.dept && dist(a.x, a.y, b.x, b.y) <= DOC.MATE_R) mates++; }
  let backup = false;
  const I = sim.incidents[s.incidentId];
  for (let k = 0; k < I.assigned.length; k++) { const q = sim.units[I.assigned[k]]; if (q.id !== u.id && q.dept === r.dept && (q.state === 'enroute' || q.state === 'turnout')) { backup = true; break; } }
  return {
    hp: -1, band: 0, bleeding: false,
    stamina: r.stamina, fitness: r.fitness, composure: r.composure, experience: r.experience, judgment: r.judgment, teamwork: r.teamwork,
    rookie: r.experience < DOC.ROOKIE, veteran: r.experience >= DOC.VETERAN,
    hasScba, air: airOf(sim, rid), spareAir: u.spareAir ?? 0,
    gun: g ? g.id : null, ammo, mag: g ? g.mag : 0, magSize, perShot,
    ammoLow: counted && ammo <= magSize, ammoCrit: counted && ammo <= 2 * perShot,
    reloading: false, ammoBox: u.ammoBox ?? 0,
    shaken: false, underFire: false, inCover: false, carrying: a.carrying !== -1,
    buddy, buddyNear: buddy !== null && dist(a.x, a.y, buddy.x, buddy.y) <= DOC.BUDDY_NEAR,
    mates, alone: buddy === null && mates === 0, backup,
  };
}
/** 자기 모드: 대원 자신의 몸 (체력·출혈·동요·피격·엄폐·재장전). 남의 몸을 읽는 길은 이 함수 하나뿐이다 — 시험 1 이 글자로 본다 */
export function stateSelf(sim: Sim, s: Scene, a: FieldAgent): DocState {
  const st = baseState(sim, s, a);
  const r = sim.responders[a.rid];
  const hp = r.health;
  st.hp = hp;
  st.band = bandHyst(hp, sigBand(a.crewSig));
  st.bleeding = (r.bleed ?? 0) >= DOC.BLEED;
  st.shaken = a.shaken !== undefined && a.shaken > sim.t;
  st.underFire = sim.t - a.underFireT < DOC.UNDER_FIRE;
  st.inCover = a.inCover;
  st.reloading = a.reloadUntil !== undefined && a.reloadUntil > sim.t;
  return st;
}
/** 보고 모드: 남이 아는 만큼 — 몸은 그 대원의 'crew' 자기 신고로만 (없으면 0·false), 체력·출혈은 쓰지 않는다(-1·false), 맞고 있는지는 모른다 */
export function stateReported(sim: Sim, s: Scene, b: FieldAgent): DocState {
  const st = baseState(sim, s, b);
  const v = reported(b);
  if (v !== undefined) { st.band = v.band; st.shaken = v.shaken; }
  return st;
}
/** 국면 (§2.4 표 — 자기 임무와 공개 지휘 상태). arrive·sizeup·transport·idle 은 split 의 열쇠에만 쓴다 */
export function phaseOf(sim: Sim, s: Scene, a: FieldAgent): DocPhase {
  const t = a.task;
  if (t === null) return a.candidates.length ? 'idle' : 'arrive';
  const k: string = t.kind;
  switch (k) {
    case 'sizeup': return 'sizeup';
    case 'negotiate': case 'perimeter': return 'standoff';
    case 'arrest': { const h = a.beliefs.val<{ weapon: string; state: string }>('hos', t.hostile); return h && h.weapon !== 'gun' && h.state === 'fight' ? 'standoff' : 'idle'; }
    case 'engage': {
      const h = a.beliefs.val<{ state: string }>('hos', t.hostile);
      if (!s.entryOrdered || (h && h.state === 'flee')) return 'assault';
      const rg = s.region[tileOf(s, a.x, a.y)];
      return rg >= 0 && s.regions[rg] !== undefined && s.regions[rg].indoor ? 'assault' : 'entry';
    }
    case 'search': case 'suppress': case 'extricate': case 'carry': case 'escort': case 'mitigate': case 'overhaul':
      return riskyAt(s, a, a.x, a.y) || riskyRegion(s, a, t.region) ? 'interior' : 'idle';
    case 'pair': return 'interior';
    case 'treat': case 'treatMate': case 'triage': return 'care';
    case 'load': return 'transport';
    case 'board': return sim.units[a.unitId].boardOrder === 'transport' ? 'transport' : 'withdraw';
    case 'traffic': case 'clearRoad': return 'traffic';
    case 'retreat': case 'evacuate': case 'airOut': case 'pairOut': return 'withdraw';
    default: return 'idle';
  }
}
/** 상황 (믿음·생김새·공개 지휘 상태). wDanger 는 docCtx 가 작업마다 채운다 (여기서는 danger 와 같다) */
export function docSit(sim: Sim, s: Scene, a: FieldAgent): DocSit {
  const I = sim.incidents[s.incidentId];
  const myRg = s.region[tileOf(s, a.x, a.y)];
  // 믿음 속 가장 가까운 활동 용의자
  let threat: DocThreat | null = null;
  const hs = a.beliefs.list('hos');
  for (let k = 0; k < hs.length; k++) {
    const v = hs[k].value as { x: number; y: number; weapon: 'gun' | 'knife' | 'none'; state: string; hostage: boolean; facing: number };
    if (v.state !== 'hold' && v.state !== 'fight' && v.state !== 'flee') continue;
    const d = dist(a.x, a.y, v.x, v.y);
    if (threat === null || d < threat.d) threat = { id: hs[k].id, x: v.x, y: v.y, d, weapon: v.weapon, state: v.state, hostage: v.hostage, facing: v.facing };
  }
  // 구조 대상의 믿음: 위협 곁·총격전 구역의 시민, 위험 건물 안의 사람, 기다리는 환자
  const cs = a.beliefs.list('cas');
  let civAtRisk = false, victimInside = false, patients = 0;
  for (let k = 0; k < cs.length; k++) {
    const c = cs[k].value as CasBelief;
    if (c.band >= 3) continue;      // 숨졌다
    if (c.where === 'scene') {
      if (threat !== null && dist(c.x, c.y, threat.x, threat.y) <= DOC.CIV_R) civAtRisk = true;
      if (riskyAt(s, a, c.x, c.y)) victimInside = true;
    }
    if (c.band >= 1 && (c.where === 'scene' || c.where === 'safe')) patients++;
  }
  if (!civAtRisk) for (let k = 0; k < hs.length && !civAtRisk; k++) {
    const v = hs[k].value as { x: number; y: number; weapon: string; state: string };
    if (v.weapon !== 'gun' || v.state !== 'fight') continue;
    const hr = s.region[tileOf(s, v.x, v.y)];
    if (hr < 0) continue;
    for (let q = 0; q < cs.length; q++) { const c = cs[q].value as CasBelief; if (c.band >= 1 && c.band < 3 && c.where === 'scene' && s.region[tileOf(s, c.x, c.y)] === hr) { civAtRisk = true; break; } }
  }
  const occ = a.beliefs.val<{ count: number | null }>('occ', 0);
  if (!victimInside && occ && occ.count !== null && occ.count > cs.length) victimInside = true;
  // 위험물: 살아 있는 장치 (가장 가까운 것)
  let liveBomb: { x: number; y: number; d: number } | null = null;
  const hz = a.beliefs.list('haz');
  for (let k = 0; k < hz.length; k++) { const v = hz[k].value as { kind: string; active: boolean; x: number; y: number }; if (v.kind !== 'bomb' || !v.active) continue; const d = dist(a.x, a.y, v.x, v.y); if (liveBomb === null || d < liveBomb.d) liveBomb = { x: v.x, y: v.y, d }; }
  let defusing = false;
  if (liveBomb !== null) for (let k = 0; k < s.agents.length; k++) { const b = s.agents[k]; if (b.status === 'active' && b.task !== null && b.task.kind === 'defuse' && dist(b.x, b.y, liveBomb.x, liveBomb.y) <= DOC.BOMB_NEAR) { defusing = true; break; } }
  // 통제 지점·환자 자리·기록의 2차 사고
  const ctlDone: boolean[] = [];
  for (let k = 0; k < s.controlPts.length; k++) ctlDone.push(a.beliefs.val<boolean>('ctl', k) === true);
  let seats = 0;
  for (let k = 0; k < I.assigned.length; k++) { const u = sim.units[I.assigned[k]]; if (u.state === 'onscene' && u.incidentId === I.id) seats += seatsLeft(sim, u); }
  let lanes2nd = false;
  for (let k = 0; k < I.problems.length; k++) if (I.problems[k].code === 'SECONDARY_COLLISION') { lanes2nd = true; break; }
  const danger = opsLevel(a, myRg);
  return {
    kind: s.kind, label: I.assessment ? I.assessment.label ?? '' : '', phase: phaseOf(sim, s, a),
    hot: s.kind === 'armed' && s.secureAt < 0, outdoor: s.outdoor === true, secure: s.secureAt >= 0,
    threat, civAtRisk, inHazard: riskyRegion(s, a, myRg), victimInside, danger, wDanger: danger, ctlDone, liveBomb, defusing,
    patients, seatsLeft: seats, negotSec: s.negotStart >= 0 ? sim.t - s.negotStart : 0, entryOrdered: s.entryOrdered, lanes2nd,
  };
}
/** 틱마다 한 번 만든 상태·상황 (모드별로 따로 — 같은 틱에 지휘관이 보고 모드로, 본인이 자기 모드로 불러도 서로 덮지 않는다).
 *  부르는 쪽이 넘기는 값(sense·dng·w)은 담지 않는다 — DocCtx 의 칸이다 */
interface DocCache { tick: number; self: DocState | null; rep: DocState | null; sit: DocSit | null }
let CACHE = new WeakMap<FieldAgent, DocCache>();
function cacheOf(sim: Sim, a: FieldAgent): DocCache {
  let c = CACHE.get(a);
  if (c === undefined || c.tick !== sim.tick) { c = { tick: sim.tick, self: null, rep: null, sit: null }; CACHE.set(a, c); }
  return c;
}
/** 담아 둔 상태를 버린다 (같은 틱 안에서 대원의 상태를 손으로 바꾼 시험이 쓴다). a 가 없으면 모두 */
export function docForget(a?: FieldAgent): void { if (a === undefined) CACHE = new WeakMap(); else CACHE.delete(a); }
/** 교본 줄이 받는 입력을 만든다. mode = 'self'(자기 몸) | 'report'(남이 아는 만큼). w = 대상 작업, sense = 대원이 선 칸의 감각, dng = brain 의 위험 점수 */
export function docCtx(sim: Sim, s: Scene, a: FieldAgent, mode: 'self' | 'report', w: WorkItem | null = null, sense: Sense = ZERO_SENSE, dng = 0): DocCtx {
  const ch = cacheOf(sim, a);
  const st = mode === 'self' ? (ch.self ??= stateSelf(sim, s, a)) : (ch.rep ??= stateReported(sim, s, a));
  let sit = (ch.sit ??= docSit(sim, s, a));
  if (w !== null) { const wd = opsLevel(a, regionOfWork(s, a, w)); if (wd !== sit.wDanger) sit = { ...sit, wDanger: wd }; }
  const rid = a.rid;
  return {
    sim, s, a, u: sim.units[a.unitId], dept: docDeptOf(sim, rid), role: roleIdOf(sim, rid), group: groupOf(sim, rid),
    mode, w, st, sit, sense, dng,
    has: (id: KitId) => kitHas(sim, rid, id), kit: (id: KitId) => kitCount(sim, rid, id),
    m: undefined, see: undefined,
  };
}

// ───────────────────────── 줄 고르기 ─────────────────────────
const EMPTY: DoctrineRule[] = [];
const GATE_OK: DocGateAns = Object.freeze({ ok: true, rule: null, wait: 0, opt: null }) as DocGateAns;
/** (자리, 일) 별로 나눈 줄 목록. 등록이 바뀌면(시험이 줄을 잠깐 넣고 빼면) 다시 만든다 */
let IDX_N = -1;
let IDX = new Map<string, DoctrineRule[]>();
function rulesFor(hook: DocHook, work: WorkKind | null = null): DoctrineRule[] {
  if (IDX_N !== DOCTRINE.length) { IDX = new Map(); IDX_N = DOCTRINE.length; }
  const key = work === null ? hook : hook + '|' + work;
  let list = IDX.get(key);
  if (list === undefined) {
    list = [];
    for (let k = 0; k < DOCTRINE.length; k++) { const r = DOCTRINE[k]; if (r.hook === hook && (work === null || !r.works || r.works.indexOf(work) >= 0)) list.push(r); }
    if (!list.length) list = EMPTY;
    IDX.set(key, list);
  }
  return list;
}
/** 그 자리에 줄이 하나라도 있는가 (없으면 부르는 쪽이 입력을 만들지 않아도 된다) */
export function hasDoc(hook: DocHook): boolean { return DOCTRINE.length > 0 && rulesFor(hook).length > 0; }
const effectsOf = (r: DoctrineRule): DocEffect[] => (Array.isArray(r.effect) ? r.effect : [r.effect]);
/** 장비를 쓸 수 있는가 (§2.5 kits): 들었고, 공기호흡기가 아니면 수량이 남았다 (공기호흡기는 들었는지만 — 남은 공기는 when 이 st.air 로) */
const usable = (c: DocCtx, id: KitId): boolean => (id === 'scba' ? c.has(id) : c.kit(id) > 0);
function whoOk(c: DocCtx, r: DoctrineRule): boolean {
  const w = r.who;
  if (!w) return true;
  if (w.dept && w.dept.indexOf(c.sim.responders[c.a.rid].dept) < 0) return false;
  if (w.doc && w.doc.indexOf(c.dept) < 0) return false;
  if (w.roles && (c.role === null || w.roles.indexOf(c.role) < 0)) return false;
  if (w.groups && (c.group === null || w.groups.indexOf(c.group) < 0)) return false;
  if (w.units && w.units.indexOf(c.u.kind) < 0) return false;
  return true;
}
/** 그 줄이 이 입력에 걸리는가: 누구 · 장비(kits·noKits) · 상황·상태(when) */
export function applies(c: DocCtx, r: DoctrineRule): boolean {
  if (!whoOk(c, r)) return false;
  if (r.kits && !r.kits.some((id) => usable(c, id))) return false;
  if (r.noKits && r.noKits.some((id) => usable(c, id))) return false;
  return r.when(c);
}
/** 교본 기억: 그 작업을 맡지 않는다 ('w:<작업 id>' — 판단 지점 timeout 뒤 30초) */
function memWork(sim: Sim, a: FieldAgent, wid: number): boolean {
  const mem = a.docMem;
  if (mem === undefined) return false;
  const key = 'w:' + wid;
  for (let k = 0; k < mem.length; k++) if (mem[k].key === key && mem[k].until > sim.t) return true;
  return false;
}
/** 교본 기억: 그 행동 줄을 그 대상(위협)에 다시 걸지 않는다 ('*' 는 모든 대상) */
function memRule(sim: Sim, a: FieldAgent, rule: string, tgt: string): boolean {
  const mem = a.docMem;
  if (mem === undefined) return false;
  for (let k = 0; k < mem.length; k++) { const q = mem[k]; if (q.rule === rule && q.until > sim.t && (q.key === tgt || q.key === '*')) return true; }
  return false;
}
/** 행동 줄의 기본 대상 열쇠: 믿음 속 가장 가까운 위협 ('h:<id>'), 없으면 '' */
export function docTarget(c: DocCtx): string { return c.sit.threat !== null ? 'h:' + c.sit.threat.id : ''; }

// ───────────────────────── ① fit ─────────────────────────
/**
 * fit 자리의 자세한 답 (보고 모드). 걸리는 fitMul 을 모두 곱하고(하나라도 0 이면 0 — 금지가 선호를 이긴다), 그 값이 0 보다 크면 fitAdd 를 더해 max(0.02, …).
 * 교본은 기본 자격을 열지 못한다: fit ≤ 0 이면 그대로. 걸린 줄이 없으면 fit 그대로(값을 건드리지 않는다).
 */
export function docFitRules(sim: Sim, s: Scene, a: FieldAgent, w: WorkItem, fit: number): DocFitAns {
  const out: DocFitAns = { fit, base: fit, hits: [] };
  if (fit <= 0) return out;
  if (memWork(sim, a, w.id)) { out.fit = 0; return out; }
  const rules = rulesFor('fit', w.kind);
  if (!rules.length) return out;
  const c = docCtx(sim, s, a, 'report', w);
  let mul = 1, add = 0;
  for (let k = 0; k < rules.length; k++) {
    const r = rules[k];
    if (!applies(c, r)) continue;
    let rm = 1, ra = 0, drop = false, any = false;
    for (const e of effectsOf(r)) {
      if (e.kind !== 'fitMul' && e.kind !== 'fitAdd') continue;
      if (e.works && e.works.indexOf(w.kind) < 0) continue;
      if (e.when && !e.when(c)) continue;
      any = true;
      if (e.kind === 'fitMul') { rm *= e.mul; if (e.drop && e.mul === 0) drop = true; } else ra += e.add;
    }
    if (!any) continue;
    mul *= rm; add += ra;
    out.hits.push({ rule: r, mul: rm, add: ra, drop });
  }
  if (out.hits.length) out.fit = mul > 0 ? Math.max(0.02, fit * mul + add) : 0;
  return out;
}
/** agents.fitFor 의 맨 끝: 교본을 넣은 적합도. 줄이 없으면 받은 값을 그대로 돌려준다 */
export function docFit(sim: Sim, s: Scene, a: FieldAgent, w: WorkItem, fit: number): number {
  if (fit <= 0) return fit;
  if (a.docMem !== undefined && memWork(sim, a, w.id)) return 0;
  if (DOCTRINE.length === 0 || !rulesFor('fit', w.kind).length) return fit;
  return docFitRules(sim, s, a, w, fit).fit;
}
/** 놓기 (§2.6): 지금 임무의 작업에 drop 표시 금지가 걸리는가 (보고 모드). 걸린 줄, 없으면 null */
export function docDrop(sim: Sim, s: Scene, a: FieldAgent): DoctrineRule | null {
  const t = a.task;
  if (DOCTRINE.length === 0 || t === null || t.workId < 0) return null;
  const w = s.board[t.workId];
  if (!w) return null;
  const rules = rulesFor('fit', w.kind);
  if (!rules.length) return null;
  let c: DocCtx | null = null;
  for (let k = 0; k < rules.length; k++) {
    const r = rules[k];
    const drops = effectsOf(r).filter((e) => e.kind === 'fitMul' && e.drop === true && e.mul === 0 && (!e.works || e.works.indexOf(w.kind) >= 0));
    if (!drops.length) continue;
    c ??= docCtx(sim, s, a, 'report', w);
    if (!applies(c, r)) continue;
    for (const e of drops) if (!(e as { when?: (c: DocCtx) => boolean }).when || (e as { when: (c: DocCtx) => boolean }).when(c)) return r;
  }
  return null;
}

// ───────────────────────── ② duty · act ─────────────────────────
/** 한 판단에 교본 후보 하나: 걸리는 줄 가운데 rank 가 가장 작은 것, 같으면 등록 순서 (§2.6) */
function pickAct(sim: Sim, s: Scene, a: FieldAgent, hook: 'duty' | 'act', swap: boolean, sense: Sense, dng: number): DocPick | null {
  if (DOCTRINE.length === 0) return null;
  const rules = rulesFor(hook);
  if (!rules.length || a.carrying !== -1) return null;      // 업고 있는 대원에게는 의무·행동을 걸지 않는다 — 그 운반이 곧 나가는 길이다 (G07)
  let c: DocCtx | null = null, best: DocPick | null = null;
  for (let k = 0; k < rules.length; k++) {
    const r = rules[k];
    if ((r.swap === 'retreat') !== swap || (best !== null && r.rank >= best.rule.rank)) continue;
    c ??= docCtx(sim, s, a, 'self', null, sense, dng);
    if (!applies(c, r) || memRule(sim, a, r.id, docTarget(c))) continue;
    for (const e of effectsOf(r)) {
      if (hook === 'duty' && e.kind === 'duty') { best = { rule: r, act: e.act, score: Infinity }; break; }
      if (hook === 'act' && e.kind === 'act') { best = { rule: r, act: e.act, score: typeof e.score === 'function' ? e.score(c) : e.score }; break; }
    }
  }
  return best;
}
/** 의무 (brain 의 의무 자리 — X6 철수 다음): 점수 없이 그 자리에서 바꾼다. 없으면 null */
export function docDuty(sim: Sim, s: Scene, a: FieldAgent, sense: Sense = ZERO_SENSE, dng = 0): DocPick | null { return pickAct(sim, s, a, 'duty', false, sense, dng); }
/** 교본 행동 후보 하나 (brain 의 점수 후보 — 공기통 교체 다음). 없으면 null */
export function docAct(sim: Sim, s: Scene, a: FieldAgent, sense: Sense = ZERO_SENSE, dng = 0): DocPick | null { return pickAct(sim, s, a, 'act', false, sense, dng); }
/** 후퇴 후보를 바꿔 끼우는 줄 (P11 — swap 'retreat'). 걸리면 그 행동, 없으면 null(후퇴 그대로) */
export function docRetreat(sim: Sim, s: Scene, a: FieldAgent, dng: number, sense: Sense = ZERO_SENSE): DocPick | null { return pickAct(sim, s, a, 'act', true, sense, dng); }

// ───────────────────────── ③ method ─────────────────────────
/** R2 방법 점수에 곱하는 교본 배율 (0 = 후보에서 뺀다). 받은 dc 를 고치지 않는다. 줄이 없으면 1 */
export function docMethodMul(dc: DocCtx, m: MethodId): number {
  if (DOCTRINE.length === 0) return 1;
  const rules = rulesFor('method');
  if (!rules.length) return 1;
  let mul = 1;
  for (let k = 0; k < rules.length; k++) {
    const r = rules[k];
    if (r.works && dc.w !== null && r.works.indexOf(dc.w.kind) < 0) continue;
    let ok: boolean | null = null;
    for (const e of effectsOf(r)) {
      if (e.kind !== 'methodMul') continue;
      const ms = e.methods ?? r.methods;
      if (ms && ms.indexOf(m) < 0) continue;
      if (ok === null) ok = applies(dc, r);
      if (!ok) break;
      if (e.when && !e.when(dc)) continue;
      mul *= e.mul;
    }
  }
  return mul;
}

// ───────────────────────── ④ gate ─────────────────────────
/**
 * 실행기의 판단 지점 (자기 모드): 막는 줄이 하나라도 있으면 ok = false, 알리는 줄은 rank 가 가장 작은 것, wait = 막은 줄들의 maxWait 가운데 가장 긴 값.
 * choose 줄은 막지 않고 opt 만 돌려준다. see = 실행부가 시야 안에서 잰 것 (용의자가 무력화된 것이 보인다 — perceive 와 같은 자격). 줄이 없으면 늘 통과
 */
export function docGate(sim: Sim, s: Scene, a: FieldAgent, gate: DocGateId, sense: Sense = ZERO_SENSE, see?: { stunned?: boolean }): DocGateAns {
  if (DOCTRINE.length === 0) return GATE_OK;
  const rules = rulesFor('gate');
  if (!rules.length) return GATE_OK;
  const t = a.task;
  let c: DocCtx | null = null;
  let blocker: DoctrineRule | null = null, wait = 0, opt: string | null = null, optRank = 9;
  for (let k = 0; k < rules.length; k++) {
    const r = rules[k];
    const g = r.gate;
    if (g === undefined || (Array.isArray(g) ? g.indexOf(gate) < 0 : g !== gate)) continue;
    if (r.works && (t === null || r.works.indexOf(t.kind as WorkKind) < 0)) continue;
    if (c === null) { c = docCtx(sim, s, a, 'self', t !== null && t.workId >= 0 ? s.board[t.workId] ?? null : null, sense); c.see = see; }
    if (!applies(c, r)) continue;
    for (const e of effectsOf(r)) {
      if (e.kind === 'block') { const mw = typeof e.maxWait === 'function' ? e.maxWait(c) : e.maxWait; if (mw > wait) wait = mw; if (blocker === null || r.rank < blocker.rank) blocker = r; }
      else if (e.kind === 'choose' && r.rank < optRank) { opt = e.opt; optRank = r.rank; }
    }
  }
  if (blocker === null && opt === null) return GATE_OK;
  return { ok: blocker === null, rule: blocker !== null ? blocker.id : null, wait, opt };
}

// ───────────────────────── 바탕: 엄폐 자리 (§2.10) ─────────────────────────
/** 엄폐가 되는 칸: 벽·창·바위·가구 (s.tiles 만 — 소품은 보지 않는다. 실행기의 엄폐 판정과 같은 칸 종류) */
export function coverTileAt(s: Scene, x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= s.w || y >= s.h) return false;
  const t = s.tiles[y * s.w + x];
  return t === T.WALL || t === T.WINDOW || t === T.ROCK || t === T.FURN;
}
/** 그 칸에서 위협 쪽 이웃 세 칸 가운데 하나가 엄폐 칸인가 */
function shielded(s: Scene, px: number, py: number, tx: number, ty: number): boolean {
  const sx = Math.sign(Math.round(tx) - px), sy = Math.sign(Math.round(ty) - py);
  if (sx !== 0 && sy !== 0) return coverTileAt(s, px + sx, py) || coverTileAt(s, px, py + sy) || coverTileAt(s, px + sx, py + sy);
  if (sx !== 0) return coverTileAt(s, px + sx, py - 1) || coverTileAt(s, px + sx, py) || coverTileAt(s, px + sx, py + 1);
  if (sy !== 0) return coverTileAt(s, px - 1, py + sy) || coverTileAt(s, px, py + sy) || coverTileAt(s, px + 1, py + sy);
  return false;
}
/**
 * 엄폐 자리 (생김새와 믿음 속 위협 위치 t 만으로). wantLos(엄폐 사격): 위협 둘레 3~7.5칸의 고리에서 위협이 보이고 대원에게서 12칸 안.
 * !wantLos(숨기): 대원 둘레 4칸 안에서 벽에 가려 위협과 서로 보이지 않는 칸. 둘 다 위협에서 1.8칸 넘게 떨어지고 위협 쪽 이웃에 엄폐 칸이 있어야 한다.
 * 대원에게 가까운 순, 같으면 칸 번호가 작은 쪽. 없으면 null — 부르는 쪽이 지금 동작으로 간다
 */
export function coverSpot(s: Scene, ax: number, ay: number, tx: number, ty: number, wantLos: boolean): { x: number; y: number } | null {
  const R = wantLos ? DOC.COVER_MAX : DOC.HIDE_R;
  const cx = wantLos ? tx : ax, cy = wantLos ? ty : ay;
  const x0 = Math.max(0, Math.floor(cx - R)), x1 = Math.min(s.w - 1, Math.ceil(cx + R));
  const y0 = Math.max(0, Math.floor(cy - R)), y1 = Math.min(s.h - 1, Math.ceil(cy + R));
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    if (!staticPass(s.tiles[y * s.w + x])) continue;
    const dt = dist(x, y, tx, ty);
    if (dt <= DOC.THREAT_GAP) continue;
    const da = dist(ax, ay, x, y);
    if (da >= bd) continue;
    if (wantLos) { if (dt < DOC.COVER_MIN || dt > DOC.COVER_MAX || da > DOC.COVER_REACH || !losWalls(s, x, y, tx, ty)) continue; }
    else if (da > DOC.HIDE_R || losWalls(s, x, y, tx, ty)) continue;
    if (!shielded(s, x, y, tx, ty)) continue;
    best = { x, y }; bd = da;
  }
  return best;
}
