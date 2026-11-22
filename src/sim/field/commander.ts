// AI Field Commander — 현장 지휘관.
// 지휘관은 자신의 믿음(직접 본 것 + 무전 보고 + 관제 브리핑)만으로 작업 목록(board)을 만들고,
// 대원에게 임무를 나눠 주고, 지원을 요청하고, 종료를 판단한다. 진실 상태는 읽지 않는다.

import type { Sim } from '../engine';
import { emit, raiseProblem } from '../events';
import { closeIncident } from '../incidents';
import { WORK_SHAPE, primeNums } from '../shape';      // (R3b N7)
import { T } from '../types';
import type { CasBelief, FieldAgent, Incident, MateBelief, Scene, UnitCaps, WorkItem, WorkKind } from '../types';
import { TYPE_NAME, dist, josa } from '../util';
import { TYPE_DEFS } from '../incidentTypes';
import { airShort, capableOf, crewHasKit, fieldCrew, hasFirearm, hasKit, isHovering, kitUses, roleOf, seatsOf, seatsUsed } from '../crews';
import { canCarryPatients, exitName, failedRecently, fitFor, fitParts, hasWork, learn, resp, transmit, workLabel } from './agents';
import { docAssignRecord, docAssignWhy, recordDoc } from './doctrineRun';      // (R3 §2.7) 교본이 바꾼 배정의 까닭 말과 기록 · 지휘 교본 줄의 기록
import { copUsable, cs2Add, docHolds, swatOnScene } from './doctrine';      // (R3 §2.6·§6.1) 교본 임무 중인 대원 건너뛰기 · 쓸 수 있는 경찰 (CP1)
import { DOC_SWITCH } from './doctrine/registry';
import type { DocFitAns } from './doctrine/registry';
import { heardEv, mkFact } from './beliefs';
import { losWalls } from './grid';
import { opsCordon } from './ops';
import { BAND_NAME, HOSTILE_FOV } from './hazards';
import { hosNeedsCare, mateNeedsHospital } from './injury';
import { CAS_HOLDS, CLOSE_BLOCKERS, HOS_HOLDS, ORDER_RULES, PROP_HOLDS, WORK_GATES } from './sceneRegistry';
import type { CommandKit } from './sceneRegistry';

interface Target { region?: number; cas?: number; prop?: number; hostile?: number; tile?: number; mate?: number; animal?: number }      // animal: (N8) 대상 동물

/**
 * (X6 §5.3) 문이 막은 새 작업 대신 돌려주는 빈 작업: 작업판에 넣지 않는다. 얼려 두었다 — 돌려받은 작업을 고치는 코드는 `if (w.id >= 0)` 으로 감싼다
 * (얼린 객체에 쓰면 엄격 모드에서 TypeError 가 나므로 실수가 바로 드러난다)
 */
const GHOST: WorkItem = Object.freeze({
  id: -1, kind: 'sizeup', region: -1, cas: -1, prop: -1, hostile: -1, tile: -1, mate: -1, priority: 0, status: 'cancelled', assignees: Object.freeze([]) as unknown as number[], max: 0,
  createdAt: 0, doneAt: -1, note: '', fails: 0, holdUntil: 0, thorough: false, orderSentAt: Object.freeze({}), cause: -1, failedAt: Object.freeze({}), animal: -1, risky: undefined,
}) as WorkItem;
/** (X6) 계획 주기(syncBoard) 동안의 지휘관과 문이 막은 수. want 는 syncBoard 안에서만 불린다 — 밖에서 불리면 문을 묻지 않는다 */
let gateCmd: FieldAgent | null = null, gateHits = 0;

function want(sim: Sim, s: Scene, kind: WorkKind, tg: Target, priority: number, max = 1, thorough = false, cause = -1): WorkItem {
  const region = tg.region ?? -1, cas = tg.cas ?? -1, prop = tg.prop ?? -1, hostile = tg.hostile ?? -1, tile = tg.tile ?? -1, mate = tg.mate ?? -1, animal = tg.animal ?? -1;
  for (const w of s.board) {
    if (w.kind !== kind || (w.status !== 'open' && w.status !== 'active')) continue;
    if (w.region === region && w.cas === cas && w.prop === prop && w.hostile === hostile && w.tile === tile && w.mate === mate && (w.animal ?? -1) === animal) {
      w.priority = priority; w.max = max; if (thorough) w.thorough = true;
      return w;
    }
  }
  // (X6 §5.3) 진입 금지 구역의 문: 새 작업을 만들기 직전에 묻는다 (있는 작업은 지휘 규칙이 구역을 만들 때 거둔다)
  if (gateCmd && WORK_GATES.length) { const cmd = gateCmd; if (WORK_GATES.some((g) => g(sim, s, cmd, kind, tg))) { gateHits++; return GHOST; } }
  const w: WorkItem = {
    id: s.nextWorkId++, kind, region, cas, prop, hostile, tile, mate, priority, status: 'open', assignees: [], max,
    createdAt: sim.t, doneAt: -1, note: '', fails: 0, holdUntil: 0, thorough, orderSentAt: {}, cause, failedAt: {}, animal, risky: undefined,      // risky: (X6) 제한적 구조 진입 — 지휘 규칙이 고친다
  };
  primeNums(w, WORK_SHAPE);      // (R3b N7) 숫자 칸을 만들 때부터 소수 표현으로 — 값은 그대로 (shape.ts)
  s.board.push(w);
  return w;
}

function cancel(s: Scene, pred: (w: WorkItem) => boolean): void {
  for (const w of s.board) if ((w.status === 'open' || w.status === 'active') && pred(w)) w.status = 'cancelled';
}
/** (R3 속도 — syncBoard) 그 부대에 이미 내려진 탑승 지시의 수 (다친 대원·용의자의 후송 — treatMate·treatSuspect 의 prop — 도 자리를 맡아 둔다) */
function loadsQueued(s: Scene, uid: number): number { let n = 0; for (const w of s.board) if ((w.kind === 'load' || w.kind === 'treatMate' || w.kind === 'treatSuspect') && w.prop === uid && (w.status === 'open' || w.status === 'active')) n++; return n; }
/** (R3 속도 — syncBoard) 그 사람의 끝난 처치 작업 수 */
function treatsDone(s: Scene, cid: number): number { let n = 0; for (const w of s.board) if (w.kind === 'treat' && w.cas === cid && w.status === 'done') n++; return n; }
/** (R3 속도 — syncBoard) 그 사람의 그 종류 작업을 거둔다 (업고 나오는 중인 이송은 두고) */
function clearCas(s: Scene, cid: number, kinds: WorkKind[]): void { cancel(s, (w) => w.cas === cid && kinds.indexOf(w.kind) >= 0 && !(w.kind === 'carry' && w.status === 'active' && s.agents.some((b) => b.carrying === cid))); }

const unitsOnScene = (sim: Sim, s: Scene): number[] => {
  const out: number[] = [];
  for (const a of s.agents) if ((a.status === 'active') && out.indexOf(a.unitId) < 0) out.push(a.unitId);
  return out;
};
function capOnScene(sim: Sim, s: Scene, need: keyof UnitCaps): number {
  let m = 0; for (const uid of unitsOnScene(sim, s)) m = Math.max(m, sim.units[uid].caps[need]);
  return m;
}
/** 그 능력의 부대가 현장에 와 있거나 오고 있는 수 (자기 조직의 부대 상태만 본다). export 는 시험용 */
export function countUnits(sim: Sim, s: Scene, I: Incident, need: keyof UnitCaps, min: number): number {
  let n = 0;
  const on = unitsOnScene(sim, s);
  for (const uid of I.assigned) {
    const u = sim.units[uid];
    if (u.caps[need] < min) continue;
    // 현장 상공에 머무는 헬기는 대원이 없는 부대다: 수색 인력으로만 센다
    // (넓게 세면 상공의 헬기가 '구조 장비 없음'·'구급 부대 없음' 요청을 막는다 — 헬기는 잔해를 들추지도 건물에 들어가지도 못한다)
    if (u.state === 'enroute' || u.state === 'turnout' || on.indexOf(uid) >= 0 || (need === 'search' && u.state === 'onscene' && isHovering(u, s))) n++;
  }
  return n;
}

/**
 * 지원 요청 (R3 §6.1 끝: 보낸 무전의 기록 id 를 돌려준다 — 같은 능력의 요청이 70초 안이거나 아직 채워지지 않아 버렸거나, 음영 구역이라 못 보냈으면 -1.
 * 지휘 교본 줄은 0 이상일 때만 '쓰였다'로 센다)
 */
function request(sim: Sim, s: Scene, I: Incident, a: FieldAgent, need: keyof UnitCaps, reason: string, urgent: boolean): number {
  if (s.requests.some((q) => q.need === need && (q.fulfilled < q.count || sim.t - q.t < 70))) return -1;
  const label: Record<string, string> = { suppression: '진압 부대', rescue: '구조 장비 부대', ems: '구급 부대', law: '경찰 부대', tactical: '경찰 기동 부대', search: '수색 인력', traffic: '교통 통제 인력', eod: '폭발물 처리반',
    utilPower: '전력 복구반', utilGas: '가스 복구반', utilWater: '수도 복구반', tow: '견인차', capture: '동물 포획팀', decon: '제독 부대' };      // (N8 §5.3.5) · (N9 §5.3.1) 제독차 또는 화학 구조차
  const ev = transmit(sim, s, a, -2, 'request', [], `관제, ${label[need]} 추가 지원 요청. 사유: ${reason}.`, -1, 2, [I.lastEvent]);
  if (ev < 0) return -1;     // 음영 구역 — 다음 계획 주기에 재시도
  s.requests.push({ t: sim.t, need, count: 1, reason, eventId: ev, fulfilled: 0, urgent });
  return ev;
}

/** (R3 CP4) 인질이 다쳤다고 믿는가 (현장 기록의 문제 — 지휘관 코드가 이미 읽는 자격) */
const hostHurt = (I: Incident): boolean => I.problems.some((p) => p.detail === '시한이 지나 인질이 다침' || p.detail === '교전 중 인질 피격' || p.detail === '저격 중 인질 피격');
/** (R3 §6.1 CP1) 이 사건으로 오는 경찰 부대의 수 (자기 조직의 부대 상태 — 현장에 닿은 부대는 세지 않는다) */
function lawComing(sim: Sim, I: Incident): number {
  let n = 0;
  for (const uid of I.assigned) { const u = sim.units[uid]; if (u.caps.law >= 0.5 && (u.state === 'enroute' || u.state === 'turnout')) n++; }
  return n;
}
/** (R3 §6.1) 지휘 교본 줄이 요청·결정을 실제로 바꾼 자리의 기록 (지휘관 줄 — 대원 없음. 같은 줄은 30초 안이면 한 줄로 잇는다) */
function docCmd(sim: Sim, I: Incident, rule: string, ev: number): void { recordDoc(sim, I, null, rule, 'cmd', {}, ev); }

function expectedPersons(a: FieldAgent): number {
  let n = 0;
  for (const f of a.beliefs.list('occ')) if (typeof f.value.count === 'number' && f.conf >= 0.35) n = Math.max(n, f.value.count);
  return n;
}

function updateZoneProb(sim: Sim, s: Scene, a: FieldAgent): void {
  const zones = s.regions.filter((r) => r.kind === 'zone');
  const p = zones.map((z) => 0.5 + Math.hypot(z.cx - s.staging.x, z.cy - s.staging.y) / 30);
  const seen = a.beliefs.get('seen', 0);
  if (seen) { const k = zones.findIndex((z) => z.id === seen.value.region); if (k >= 0) p[k] *= 1 + 4 * seen.conf; }
  for (const f of a.beliefs.list('occ')) if (typeof f.value.region === 'number' && f.value.region >= 0) { const k = zones.findIndex((z) => z.id === f.value.region); if (k >= 0) p[k] *= 1 + 2.5 * f.conf; }
  for (const f of a.beliefs.list('clue')) { const k = zones.findIndex((z) => z.id === f.value.region); if (k >= 0) p[k] *= 3; }
  zones.forEach((z, k) => { const c = a.beliefs.val<number>('srch', z.id); if (c !== undefined) p[k] *= Math.max(0.04, 1 - c * 0.92); });
  const sum = p.reduce((x, y) => x + y, 0) || 1;
  s.zoneProb = s.regions.map(() => 0);
  zones.forEach((z, k) => { s.zoneProb[z.id] = p[k] / sum; });
}

/**
 * 진입 계획: 지휘관이 알고 있는 용의자의 위치와 바라보는 방향으로, 들키지 않고 들어갈 출입구를 고른다.
 * 용의자가 등지고 있는 쪽 > 벽에 가려 보이지 않는 쪽 > 가까운 쪽.
 */
function planEntry(s: Scene, hv: { x: number; y: number; facing?: number }): { exit: number; text: string } {
  const name = (k: number): string => exitName(s, k);
  if (s.exits.length < 2) return { exit: 0, text: '' };
  let best = 0, bs = -1e9, why = '';
  s.exits.forEach((e, k) => {
    let behind = false;
    if (typeof hv.facing === 'number') {
      let d = Math.abs(Math.atan2(e.y - hv.y, e.x - hv.x) - hv.facing) % (Math.PI * 2);
      if (d > Math.PI) d = Math.PI * 2 - d;
      behind = d > HOSTILE_FOV;
    }
    const hiddenByWall = !losWalls(s, hv.x, hv.y, e.x, e.y);
    const sc = (behind ? 2 : 0) + (hiddenByWall ? 1 : 0) - dist(e.x, e.y, hv.x, hv.y) * 0.04;
    if (sc > bs) { bs = sc; best = k; why = behind ? '용의자가 등지고 있는 쪽이다' : hiddenByWall ? '용의자 위치에서 벽에 가려 보이지 않는 쪽이다' : '용의자와 가장 가깝다'; }
  });
  return { exit: best, text: ` 진입 지점은 ${name(best)} — ${why}.` };
}

const josaLocal = (w: string): string => `${w}으로`;

/** 관제가 그 능력의 부대로 치는 최소 적합도 (dispatcher.ts 의 MINCAP 과 같다) */
const NEED_MIN: Record<keyof UnitCaps, number> = { suppression: 0.7, rescue: 0.5, ems: 0.7, law: 0.5, tactical: 0.9, search: 0.3, traffic: 0.4, eod: 0.9, utilPower: 0.7, utilGas: 0.7, utilWater: 0.7, tow: 0.7, capture: 0.7, decon: 0.7 };

/**
 * 이 작업을 할 수 있는 대원을 보내 줄 부대의 능력. 아무나 할 수 있는 일이면 null.
 * a = 지휘관 (N8 §5.3.5 — 시설물 복구의 수요는 믿음 속 시설물의 종류·관의 갈래로 정한다). 소품의 생김새(kind·skin)는 읽어도 되고 진실 칸은 읽지 않는다
 */
/** (N8 단계 7) 보호 유형의 재수색 상한 (실종은 3) — 걷는 대상이 다 본 구역으로 돌아와도 찾을 때까지 */
export const WELFARE_ROUNDS = 8;
function needFor(s: Scene, w: WorkItem, hotArmed: boolean, a: FieldAgent): keyof UnitCaps | null {
  switch (w.kind) {
    case 'suppress': case 'hookup': case 'overhaul': return 'suppression';
    case 'mitigate': {
      // 균열부, (N8) 간판·구멍·매트 터는 구조 부대(최소 인원에서도 로프·유압 대원이 있다). 그 밖(밸브 …)은 진압
      const p = w.prop >= 0 ? s.props[w.prop] : undefined;
      if (w.prop < 0 && w.tile >= 0) return null;      // (X6 §5.7) 가스 재측정(칸만 있는 작업): 측정기는 관제 요청으로 부를 수 없다 — 진압 부대를 헛되이 부르지 않는다
      return p && (p.kind === 'unstable' || p.skin === 'sign' || p.skin === 'hole' || p.skin === 'matSite') ? 'rescue' : 'suppression';
    }
    case 'repair': {
      // (N8) 믿음의 시설물: 전선 → 전력 복구, 가스 관·가스 누출 현장의 밸브(공급 차단 확인) → 가스 복구, 그 밖(물 관·모름) → 수도 복구
      const hz = w.prop >= 0 ? a.beliefs.val<{ kind?: string; pipe?: string }>('haz', w.prop) : undefined;
      if (hz && hz.kind === 'wire') return 'utilPower';
      if ((hz && hz.kind === 'pipe' && hz.pipe === 'gas') || (w.prop >= 0 && s.props[w.prop] && s.props[w.prop].kind === 'valve')) return 'utilGas';
      return 'utilWater';
    }
    case 'towAway': return 'tow';
    case 'clearRoad': return 'traffic';      // (N8 단계 6b) 차로 정리를 맡을 사람이 없으면(경찰이 다치고 구급차가 떠났다 — 보통 S49 에서 156초 교착) 교통 통제 인력을 부른다
    case 'capture': return w.prop >= 0 && s.props[w.prop] && s.props[w.prop].skin === 'hive' ? 'suppression' : 'capture';      // 벌집은 보호복을 든 관창수 (진압 수요)
    case 'persuade': case 'cordon': return 'law';
    case 'extricate': case 'waterRescue': case 'clear': case 'force': return 'rescue';
    case 'treat': case 'load': return 'ems';
    case 'carry': case 'escort': return hotArmed ? 'law' : 'rescue';      // 위험한 건물 안은 소방만, 안전 확보 전의 무장 현장은 경찰만
    case 'search': return hotArmed ? 'law' : 'rescue';
    case 'perimeter': case 'engage': case 'arrest': case 'negotiate': return 'law';
    case 'rescueMate': return hotArmed ? 'law' : 'rescue';      // 쓰러진 동료: 안전 확보 전의 무장 현장은 경찰만, 위험한 건물 안은 공기호흡기를 멘 대원만 들어간다 (fitFor)
    case 'defuse': return 'eod';
    case 'decontam': return 'decon';      // (N9 §5.3.1) 제독 — 맡는 사람(fitFor)·실행은 단계 6
    default: return null;
  }
}

/**
 * 이 작업을 맡을 수 있는 사람이 현장에 있거나 오고 있는가 (장비·부서·알려진 장비 상태만 — 진실을 읽지 않는다).
 *  현장 쪽: fitFor > 0 인 활동 대원. 장비 자격이 fitFor 에 들어 있으므로 저절로 따른다
 *           (방금 이 작업에 닿지 못한 대원은 치지 않는다: 소화전에 갇혀 닿지 못하는 진압 대원 → 진압 부대 지원 요청)
 *  오는 쪽: 그 능력의 부대이고, 그 일을 할 장비를 가진 내리는 대원이 있다 (crews.capableOf)
 */
export function anyCapable(sim: Sim, s: Scene, I: Incident, w: WorkItem, need: keyof UnitCaps): boolean {
  // 공기가 문턱 아래라 지금은 맡지 못해도(fitFor 0) 그 부대에 예비 공기통이 남아 있으면 바꾸고 와서 맡는다 — 그런 대원도 맡을 수 있는 사람이다.
  // 공기도 예비도 없으면 아니다 (그때는 그 일을 할 부대를 부른다). 공기 잔량과 예비 공기통은 자기 조직의 장비 상태다
  if (s.agents.some((b) => b.status === 'active' && !sim.units[b.unitId].boardOrder && !failedRecently(sim, w, b.rid)
    && (fitFor(sim, s, b, w) > 0 || (airShort(sim, b.rid) && (sim.units[b.unitId].spareAir ?? 0) > 0 && fitFor(sim, s, b, w, true) > 0)))) return true;
  // (N8 §5.3.3) 소품을 대상으로 하는 일은 대상의 생김새(skin, 없으면 kind)까지 넘긴다 — 같은 임무라도 대상마다 맡는 장비가 다르다 (간판·구멍·매트 터·벌집·전선·관)
  const p = (w.kind === 'mitigate' || w.kind === 'repair' || w.kind === 'capture' || w.kind === 'towAway') && w.prop >= 0 ? s.props[w.prop] : undefined;
  const what = p ? p.skin ?? p.kind : undefined;
  return I.assigned.some((uid) => {
    const u = sim.units[uid];
    return (u.state === 'enroute' || u.state === 'turnout') && u.caps[need] >= NEED_MIN[need] && fieldCrew(sim, u).some((rid) => sim.responders[rid].status === 'ok' && capableOf(sim, rid, w.kind, what));
  });
}

/** 믿음 → 작업 목록 */
function syncBoard(sim: Sim, s: Scene, I: Incident, a: FieldAgent): void {
  gateCmd = a; gateHits = 0;      // (X6 §5.3) 이 계획 주기의 문
  const B = a.beliefs;
  const cas = B.list('cas');
  const fires = B.list('fire');
  const hos = B.list('hos');
  // 무장 사건의 인원 문턱에 드는 사람: 총기를 든 활동 중인 경찰. 폭발물 처리 요원·로봇 조작 요원은 (권총이 있어도) 역할로 뺀다
  // 걸을 수 있는 다친 경관(조직이 아는 상태)은 문턱에 넣지 않는다: 봉쇄는 서도 진입·검거는 맡지 못한다 (가벼운 일만 — agents.fitFor)
  const armedCops = s.agents.filter((b) => b.status === 'active' && sim.responders[b.rid].dept === 'police' && hasFirearm(sim, b.rid) && roleOf(sim, b.rid).group !== 'bomb');
  const police = armedCops.filter((b) => sim.responders[b.rid].status !== 'injured');
  // (R3 §6.1 CP1) 쓸 수 있는 경찰: 머릿수에서 중상 신고·탄 위급인 대원을 뺀 수 — 흉기 검거 문턱·진입 결정(100초 시간 예비 규칙 빼고)·두 문 진입에 쓴다.
  // 시간 예비 규칙(다친 경찰 둘만 남아도 언젠가는 들어가게 — 모든 사건은 끝난다)과 봉쇄 자리 수(출렁이면 봉쇄를 거뒀다 다시 내는 왕복)는 머릿수 그대로
  let usable = 0;
  for (const b of police) if (copUsable(sim, a, b)) usable++;
  const cp1 = usable !== police.length;      // CP1 이 문턱의 수를 바꾸었다 (그 문턱이 결정을 바꾸었을 때만 센다 — docCmd)
  let lightCops = 0;      // 가벼운 일을 한다고 알린 다친 경관 (본인의 보고 — mate 사실 light. 후퇴 중·안전 구역의 경관은 출입구를 지키지 못한다)
  for (const b of armedCops) if (sim.responders[b.rid].status === 'injured' && lightDuty(a, b)) lightCops++;
  if (!s.sizeupDone) want(sim, s, 'sizeup', {}, 0.96);
  // 이 사건 상공에 머무는 헬기가 할 수 있는 일 (자기 조직의 부대 상태): 호이스트 인양, 공중 물 투하(밤에는 뿌리지 않는다).
  // 공중 임무(hoist·airDrop)는 지상 대원이 맡지 못한다(fitFor 0) — 상공에 그 일을 할 부대가 있을 때만 작업판에 올리고, 없어지면 거둔다.
  // 남겨 두면 열린 작업 때문에 종료를 선언하지 못한다(canClose). 헬기가 다시 오면 다시 낸다
  let hoistUp = false, bucketUp = false;
  for (const uid of I.assigned) {
    const u = sim.units[uid];
    if (u.state !== 'onscene' || !isHovering(u, s)) continue;
    if (u.hoist) hoistUp = true;
    if ((u.bucketMax ?? 0) > 0 && sim.weather !== 'night') bucketUp = true;
  }
  if (!hoistUp) cancel(s, (w) => w.kind === 'hoist');
  if (!bucketUp) cancel(s, (w) => w.kind === 'airDrop');

  // ── 화재 ──
  let fireSum = 0, fireRegions = 0;
  for (const f of fires) {
    if (f.value > 0.05) {
      fireSum += f.value; fireRegions++;
      const near = cas.some((c) => c.value.where === 'scene' && c.value.band < 3 && s.region[c.value.y * s.w + c.value.x] === f.id);
      want(sim, s, 'suppress', { region: f.id }, 0.56 + 0.24 * f.value + (near ? 0.14 : 0), f.value > 0.5 ? 2 : 1);
      if (bucketUp && !s.regions[f.id].indoor) want(sim, s, 'airDrop', { region: f.id }, 0.7 + 0.2 * f.value, 1);      // 바깥 구역의 불: 상공의 헬기가 물을 뿌린다 (지상의 진압과 함께)
    } else for (const w of s.board) if ((w.kind === 'suppress' || w.kind === 'airDrop') && w.region === f.id && (w.status === 'open' || w.status === 'active')) { w.status = 'done'; w.doneAt = sim.t; }
  }
  if (fireRegions > 0 && s.props.some((p) => p.kind === 'hydrant')) {
    for (const uid of unitsOnScene(sim, s)) {
      const u = sim.units[uid];
      if (u.dept === 'fire' && !u.hydrant && u.water < u.waterMax * 0.4) want(sim, s, 'hookup', { prop: uid }, 0.8);
    }
  }

  // ── 용의자 ──
  const active = hos.filter((h) => h.value.state === 'hold' || h.value.state === 'fight' || h.value.state === 'flee');
  const surrendered = hos.filter((h) => h.value.state === 'surrendered');
  const threat = active.length > 0 || surrendered.length > 0;
  if (threat && s.secureAt >= 0) s.secureAt = -1;
  // (I1-b) cause = 그 사실을 실어 온 무전 기록 (heardEv) — 지시 무전의 causes 에만 들어간다
  for (const h of surrendered) {
    if (HOS_HOLDS.length && HOS_HOLDS.some((f) => f(sim, s, a, h.id, h.value))) continue;      // (N9) 보류: 묶음 규칙이 맡은 용의자(시위의 주최자 …)에게는 핵심 규칙이 일을 내지 않는다 — 줄이 없으면 그대로
    want(sim, s, 'arrest', { hostile: h.id }, 0.93, 1, false, heardEv(h));
  }
  for (const h of active) {
    if (HOS_HOLDS.length && HOS_HOLDS.some((f) => f(sim, s, a, h.id, h.value))) continue;      // (N9) 보류 — 위협 셈(threat)에는 그대로 든다
    if (h.value.state === 'flee') { want(sim, s, 'engage', { hostile: h.id }, 0.95, 2, false, heardEv(h)); continue; }
    // 진입이 결정되면 진입조 둘을 먼저 채우고, 남는 경찰만 출입구를 지킨다
    // (봉쇄에 묶인 대원은 진입 지시보다 봉쇄를 계속하므로, 경찰이 둘뿐이면 아무도 들어가지 않는다)
    // 다친 경관은 진입조에 들지 못하므로 출입구를 지킨다: 진입이 정해지면 온전한 경관이 맡을 자리(okPosts)는 예전 그대로이고, 다친 경관 몫으로 더한 자리는 우선도를 낮춘다 —
    // 그 자리를 온전한 경관이 잡고 있으면 진입(0.9)이 0.22 넘게 높아 빼 오고, 빈자리는 손이 빈 다친 경관이 맡는다 (우선도 차이 0.22 규칙의 교착을 피한다)
    const okPosts = s.entryOrdered ? Math.min(s.exits.length, Math.max(0, police.length - 2)) : s.exits.length;
    const posts = Math.min(s.exits.length, okPosts + (s.entryOrdered ? lightCops : 0));
    s.exits.forEach((_, k) => { if (k < posts) want(sim, s, 'perimeter', { tile: k }, k < okPosts ? 0.76 - k * 0.05 : 0.5 - k * 0.02); });
    if (posts < s.exits.length) cancel(s, (w) => w.kind === 'perimeter' && w.tile >= posts);
    const gun = h.value.weapon === 'gun';
    if (s.negotStart < 0) s.negotStart = sim.t;
    const waited = sim.t - s.negotStart;
    if (!gun) {
      if (h.value.state === 'fight' && usable >= 2) {
        // 흉기를 휘두르는 상대와는 말이 통하지 않는다 — 협상을 접고 둘이 붙어 제압한다
        // (협상을 붙들고 있으면 봉쇄·협상에 손이 다 묶여 검거할 사람이 남지 않는다)
        cancel(s, (w) => w.kind === 'negotiate' && w.hostile === h.id);
        want(sim, s, 'arrest', { hostile: h.id }, 0.86, 2);
        continue;
      }
      want(sim, s, 'negotiate', { hostile: h.id }, 0.8);
      if (police.length >= 2 || waited > 25) want(sim, s, 'arrest', { hostile: h.id }, 0.72);
      continue;
    }
    if (!s.entryOrdered) {
      want(sim, s, 'negotiate', { hostile: h.id }, 0.73);
      const crit = cas.some((c) => c.value.where === 'scene' && c.value.band === 2);
      const fighting = h.value.state === 'fight';
      const hostage = !!h.value.hostage;
      const hasBang = s.agents.some((b) => b.status === 'active' && kitUses(sim, b.rid, 'flashbang') > 0);      // 섬광탄은 사람 몫이다 (자기 조직의 장비 상태 — 지휘관이 알아도 된다)
      let why = '';
      if (hostage) {
        // 인질 사건: 섣불리 들어가지 않는다. 섬광탄을 가진 부대가 오거나, 인질이 다쳤거나, 협상이 한계에 이르렀을 때만
        if (I.problems.some((p) => p.detail === '시한이 지나 인질이 다침') && usable >= 2) why = '인질이 다쳐 더 기다릴 수 없음';
        else if (hasBang && usable >= 3 && waited > 18) why = '섬광탄을 가진 기동대가 도착해 진입 조건이 갖춰짐';
        else if (waited > 125 && usable >= 3) {
          // (R3 §6.1 CP4) 섬광탄 없는 인질 진입을 하지 않는다: 섬광탄을 가진 사람이 있거나 인질이 다쳤다고 믿을 때만. 그 밖에는 협상을 잇고 기동대를 부른다(아래 지금 규칙)
          if (!DOC_SWITCH.CP4 || hasBang || hostHurt(I)) why = '협상이 길어져 시한이 임박';      // (CP4 — 확인 필요: 균형. 끄면 125초 줄이 지금처럼 진입한다 — §8.4 의 2번 손잡이)
          else docCmd(sim, I, 'CP4', -1);
        }
        if (!I.assigned.some((uid) => sim.units[uid].caps.tactical >= 0.9)) request(sim, s, I, a, 'tactical', '인질 사건 — 섬광탄을 가진 기동대 필요', true);
      } else if (crit && usable >= 2 && waited > 12) why = '내부에 위중한 부상자가 있어 더 기다릴 수 없음';
      else if (fighting && usable >= 2 && waited > 8 && cas.some((c) => c.value.where === 'scene' && c.value.band >= 1 && c.value.band < 3)) why = '총격이 이어지고 내부에 부상자가 있음';
      else if (fighting && usable >= 3 && waited > 22) why = '용의자가 계속 발포하고 협상에 응하지 않음';
      else if (waited > 60 && usable >= 3) why = '협상에 진전이 없고 진입 인원이 확보됨';
      else if (waited > 100 && police.length >= 2) why = '장시간 대치로 더 이상의 지연은 위험';      // 시간 예비 규칙 — 머릿수 그대로 (CP1)
      if (why) {
        s.entryOrdered = true; s.breachAt = sim.t + 9; s.breachDone = false;
        const plan = planEntry(s, h.value);
        s.entryExit = plan.exit;
        // 인원이 넉넉하면 두 문으로 나눠 동시에 들어간다 (용의자는 한쪽만 볼 수 있다)
        const two = usable >= 4 && s.exits.length >= 2;
        if (cp1 && (police.length >= 4) !== two && s.exits.length >= 2) docCmd(sim, I, 'CP1', -1);      // 쓸 수 있는 경찰이 모자라 한 문으로 들어간다
        s.entryExit2 = two ? (plan.exit === 0 ? 1 : 0) : -1;
        if (two) s.breachAt = sim.t + 15;
        const name = (k: number): string => exitName(s, k);
        emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 3, causes: [I.lastEvent], text: `진입 결정. ${why}.${plan.text}${two ? ` 2조는 ${josaLocal(name(s.entryExit2))} 돌아가 같은 신호에 들어간다.` : ''} 진입조는 문 앞에 모였다가 신호에 맞춰 동시에 진입하라.` });
      }
    }
    if (s.entryOrdered) { want(sim, s, 'engage', { hostile: h.id }, 0.9, 3); cancel(s, (w) => w.kind === 'negotiate' && w.hostile === h.id); }
  }
  // 가스 누출: 새는 동안에는 경찰이 출입구를 지켜 주변 시민의 접근을 막는다
  const liveBomb = B.list('haz').some((f) => f.value.kind === 'bomb' && f.value.active);      // 폭발물로 보이는 물건이 아직 처리되지 않았다
  const gasCordon = s.kind === 'hazmat' && B.list('haz').some((f) => f.value.kind === 'leak' && f.value.active);
  const cordon = gasCordon || liveBomb || opsCordon(s);      // (X6 §5.3) 건물·가스·용기의 철수 구역이 있거나 외부 방어 중이면 경찰이 출입구에서 사람을 막는다
  if (cordon) s.exits.forEach((_, k) => want(sim, s, 'perimeter', { tile: k }, 0.62 - k * 0.04));
  if (!threat && !cordon) cancel(s, (w) => w.kind === 'perimeter' || w.kind === 'negotiate' || w.kind === 'engage');
  else if (!threat) cancel(s, (w) => w.kind === 'negotiate' || w.kind === 'engage');

  // ── 수색 ──
  const expected = expectedPersons(a);
  const found = cas.length;
  const th = s.researchRound > 0 ? 0.9 : 0.72;
  const hotArmed = s.kind === 'armed' && s.secureAt < 0;
  let pendingSearch = 0;
  if (TYPE_DEFS[s.kind].zoneSearch) {      // 구역 확률 수색 (incidentTypes — 실종)
    updateZoneProb(sim, s, a);
    const targetsFound = cas.length;
    if (targetsFound < Math.max(1, expected)) {
      const zones = s.regions.filter((r) => r.kind === 'zone' && r.searchable);      // (N8 단계 7) 수색하지 않는 구역(도심 틀의 찻길)은 빼고 — 실종 현장은 모두 수색 구역이라 그대로
      let maxP = 0; for (const z of zones) maxP = Math.max(maxP, s.zoneProb[z.id]);
      for (const z of zones) {
        const c = B.val<number>('srch', z.id) ?? -1;
        if (c >= th) continue;
        pendingSearch++;
        want(sim, s, 'search', { region: z.id }, 0.36 + 0.5 * (s.zoneProb[z.id] / (maxP || 1)), 1, s.researchRound > 0 || c >= 0);
      }
      if (pendingSearch === 0 && s.researchRound < (s.kind === 'welfare' ? WELFARE_ROUNDS : 3)) {      // (N8 단계 7) 도심을 걷는 보호 대상은 다 본 구역으로 다시 걸어 들어온다 — 재수색을 더 돈다
        s.researchRound++;
        // 모든 구역을 봤는데도 못 찾았다 → 놓쳤다고 보고 확인율을 낮춰 정밀 재수색
        const redo = [];
        for (const z of zones) { const f = B.get('srch', z.id); if (f) { const nf = mkFact('srch', z.id, Math.min(f.value, 0.45), '지휘관 재평가', sim.t, 0.5, true, `${z.name} 재수색 필요`); B.merge(nf); redo.push(nf); } }
        if (redo.length) transmit(sim, s, a, -1, 'report', redo, '', -1, 0, [], true);
        if (s.researchRound <= 3) raiseProblem(sim, I, 'VICTIM_MISSED', '전 구역 1차 수색에서 대상을 찾지 못함', { role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, imp: 2, text: `전 구역을 수색했지만 대상을 찾지 못했습니다. 탐색 범위를 재조정하고 간격을 좁혀 정밀 재수색합니다 (${s.researchRound}차).` }, false);
      }
    } else cancel(s, (w) => w.kind === 'search');
  } else {
    const activeThreat = active.length > 0 || surrendered.length > 0;
    const wrecksPending = s.regions.some((r) => r.kind === 'wreck' && (B.val<number>('srch', r.id) ?? -1) < 0.6);
    const evid = B.list('evid').some((f) => f.value.kind === 'emptySeat');
    if (s.kind === 'armed' && (activeThreat || !s.sizeupDone)) cancel(s, (w) => w.kind === 'search');
    for (const r of s.regions) {
      if (!r.searchable) continue;
      const c = B.val<number>('srch', r.id) ?? -1;
      if (s.kind === 'armed' && (activeThreat || !s.sizeupDone)) continue;
      if (r.kind === 'wreck') { if (c < 0.6) { pendingSearch++; want(sim, s, 'search', { region: r.id }, 0.78); } continue; }
      if (r.kind === 'verge') {
        if (c >= th) continue;
        if (evid || (!wrecksPending && expected > found)) { pendingSearch++; want(sim, s, 'search', { region: r.id }, 0.64, 1, sim.weather !== 'clear' || c >= 0); }
        continue;
      }
      if (!TYPE_DEFS[s.kind].roomSearch) continue;      // 방 수색을 하는 유형 (incidentTypes)
      if (s.kind === 'water' && found >= Math.max(1, expected)) continue;      // 신고된 인원을 모두 찾았으면 물가 수색을 멈춘다
      if (s.kind === 'medical' && found >= 1) continue;      // 환자를 찾았으면 더 수색하지 않는다
      if (c >= th) continue;
      const fl = B.val<number>('fire', r.id) ?? 0;
      pendingSearch++;
      if (fl > 0.75) continue;      // 화세가 너무 강함 — 진압 후 수색
      let pr = hotArmed ? 0.7 : 0.52;
      for (const f of B.list('occ')) if (f.value.region === r.id) pr += 0.22 * f.conf;
      if (fl > 0.05) pr += 0.1;
      for (const f of fires) if (f.value > 0.3 && f.id !== r.id && Math.abs(s.regions[f.id].cx - r.cx) + Math.abs(s.regions[f.id].cy - r.cy) < 9) { pr += 0.1; break; }
      want(sim, s, 'search', { region: r.id }, Math.min(0.88, pr), 1, c >= 0 || s.researchRound > 0);
    }
    if ((s.kind === 'fire' || s.kind === 'traffic' || s.kind === 'collapse' || s.kind === 'hazmat') && pendingSearch === 0 && expected > found && s.researchRound < 1 && s.sizeupDone) {
      s.researchRound = 1;
      // 수색을 마친 구역의 확인율을 낮춰 잡고(=놓쳤을 수 있다고 보고) 간격을 좁혀 다시 본다
      const redo = [];
      for (const r of s.regions) { const f = B.get('srch', r.id); if (f && r.searchable && r.kind !== 'wreck') { const nf = mkFact('srch', r.id, Math.min(f.value, 0.5), '지휘관 재평가', sim.t, 0.5, true, `${r.name} 재수색 필요`); B.merge(nf); redo.push(nf); } }
      if (redo.length) transmit(sim, s, a, -1, 'report', redo, '', -1, 0, [], true);
      raiseProblem(sim, I, 'RECOUNT', `신고 인원 ${expected}명, 확인 ${found}명`, { role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, imp: 2, text: `인원 불일치: 신고된 인원은 ${expected}명인데 ${found}명만 확인했습니다. 놓친 사람이 있을 수 있습니다 — 전 구역 정밀 재수색.` }, false);
    }
    if (s.kind === 'armed' && !activeThreat && pendingSearch === 0 && s.secureAt < 0 && s.sizeupDone && !liveBomb) {
      s.secureAt = sim.t;
      learn(sim, a, mkFact('secure', 0, true, resp(sim, a).name, sim.t, 1, true, '현장 안전 확보 — 구급·구조 인력 진입 가능'));
      emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 2, text: '건물 내부 수색 완료. 현장 안전 확보를 선언합니다. 구급대 진입하라.' });
    }
  }

  if (s.kind === 'medical' && found >= 1) cancel(s, (w) => w.kind === 'search');
  // 이미 충분히 확인된 구역에 대한 수색 지시는 거둔다
  for (const w of s.board) if (w.kind === 'search' && w.status === 'open') {
    const c = B.val<number>('srch', w.region) ?? -1;
    if (c >= (s.regions[w.region].kind === 'wreck' ? 0.6 : th)) w.status = 'cancelled';
  }

  const allDry = fireRegions > 0 && countUnits(sim, s, I, 'suppression', 0.7) > 0
    && !I.assigned.some((uid) => { const u = sim.units[uid]; return u.caps.suppression >= 0.7 && (u.state === 'enroute' || u.state === 'turnout' || (!u.pumpFailed && (u.water > 0 || u.hydrant))); });
  const checks = new Set<number>();
  if (allDry) for (const f of fires) if (f.value > 0.05 && sim.t - f.t > 20) checks.add(f.id);
  // ── 잔불 정리 ──
  // 알려진 불이 모두 꺼지고 수색이 끝나면, 불이 났던 구역과 그 가까운 실내 구역을 한 번 더 돌며 남은 불씨를 끈다.
  // 진압을 확인할 때 구역의 일부만 보기 때문에, 보지 못한 구석의 불씨가 되살아날 수 있다.
  if (fires.length && fireRegions === 0 && pendingSearch === 0 && s.sizeupDone && !hotArmed) {
    for (const r of s.regions) {
      let lastFire = -1;      // 이 구역이나 가까운 구역의 화재 보고 가운데 가장 늦은 것
      for (const f of fires) {
        const q = s.regions[f.id];
        if (f.id === r.id || (r.indoor && q.indoor && Math.abs(q.cx - r.cx) + Math.abs(q.cy - r.cy) <= 7)) lastFire = Math.max(lastFire, f.t);
      }
      if (lastFire < 0) continue;
      const done = B.get('ovh', r.id);
      const skip = (done && done.t >= lastFire)
        || s.board.some((w) => w.kind === 'overhaul' && w.region === r.id && (w.fails >= 2 || (w.status === 'done' && sim.t - w.doneAt < 12)));      // 닿지 못하는 구역은 두 번 시도하고 넘어간다 / 막 끝낸 보고를 기다린다
      if (skip) { cancel(s, (w) => w.kind === 'overhaul' && w.region === r.id); continue; }
      want(sim, s, 'overhaul', { region: r.id }, 0.5);
    }
  } else cancel(s, (w) => w.kind === 'overhaul' && w.status === 'open' && !checks.has(w.region));
  // 불 확인: 현장의 진압 부대가 모두 물이 떨어졌고 오는 부대도 없다. 진압 임무는 물이 있어야 맡을 수 있으므로,
  // 불이 저절로 사그라들어도 아무도 가서 보지 않아 "불이 났다"는 믿음이 낡은 채 남는다. 한동안 소식이 없는 구역에 소방대원을 보내 확인한다
  for (const r of checks) want(sim, s, 'overhaul', { region: r }, 0.55);

  // ── 구조 대상 ──
  const hasMedicAny = s.agents.some((b) => b.status === 'active' && sim.responders[b.rid].dept === 'ems');
  // 환자를 싣고 병원으로 갈 수 있는 부대: 환자 자리가 남은 부대 (seatsOf — 구급차 2명, 헬기 1명)
  const ambulances = unitsOnScene(sim, s).filter((uid) => canCarryPatients(sim, sim.units[uid]) && !sim.units[uid].boardOrder);
  // 그 부대에 이미 내려진 탑승 지시의 수 (실린 환자 + 이것이 자리 수를 넘지 않게 한다)
  // (R3 속도) 그 부대에 내려진 탑승 지시의 수(loadsQueued)·그 사람의 끝난 처치 수(treatsDone)·작업 거두기(clearCas)는 모듈 함수 — 부를 때마다 이름 붙은 닫힘을 만들지 않는다 (tsx 의 __name)
  // 처치를 두 번 마쳤는데(기본 처치 + 구급대원이 다시 봄) 아직 기본 처치로 보고된다: 현장의 구급대원이 더 해 줄 수 있는 처치가 없다.
  // (구급대원은 자기가 더 낫게 할 수 없으면 손대지 않고 상태만 다시 보고한다 — 그대로 두면 같은 처치 지시와 같은 보고를 끝없이 주고받는다)
  for (const f of cas) {
    const c = f.value as CasBelief;
    if (CAS_HOLDS.length && CAS_HOLDS.some((h) => h(sim, s, a, f.id, c))) continue;      // (N8) 보류: 묶음 규칙이 맡은 사람(위험 반경 안·높은 자리)에게는 핵심 규칙이 일을 내지 않는다 — 줄이 없으면 그대로
    const dead = c.band === 3;
    if (dead || c.where === 'loaded' || c.where === 'hospital') {
      clearCas(s, f.id, ['extricate', 'treat', 'carry', 'load', 'hoist']);
      // 호이스트로 물에서 곧바로 실려 간 사람: 지상의 수난 구조 지시도 거둔다 (지상에서 건진 사람은 그 작업이 이미 끝나 있다)
      if (!dead) cancel(s, (w) => w.kind === 'waterRescue' && w.cas === f.id);
      continue;
    }
    const urg = c.band * 0.06;
    const cev = heardEv(f);      // (I1-b) 이 구조 대상 소식을 실어 온 무전 기록 — 아래 작업의 원인 (기록만)
    const afloat =c.where === 'scene' && c.mob === 'trapped' && s.tiles[c.y * s.w + c.x] === T.WATER;      // 물속에 있다고 믿는다
    if (hoistUp && !afloat) cancel(s, (w) => w.kind === 'hoist' && w.cas === f.id);      // 물 밖으로 나왔다
    // 총을 든 용의자 바로 곁에 있는 사람(인질)은 위협이 사라지기 전에는 손댈 수 없다
    if (c.where === 'scene' && active.some((h) => h.value.weapon === 'gun' && Math.hypot(h.value.x - c.x, h.value.y - c.y) <= 3.6)) { clearCas(s, f.id, ['treat', 'carry', 'extricate']); continue; }
    if (c.where === 'scene') {
      if (afloat) {
        want(sim, s, 'waterRescue', { cas: f.id }, 0.9 + urg, 2, false, cev);      // 물속: 물가에서 줄을 던져 끌어낸다
        if (hoistUp) want(sim, s, 'hoist', { cas: f.id }, 0.92 + urg, 1, false, cev);      // 상공에 호이스트를 단 헬기가 있으면 함께 낸다 — 먼저 끝나는 쪽이 이긴다
        continue;
      }
      // 갇혀 있다: 구출이 먼저다. 갇히기 전에 낸 이송·동행 지시는 거둔다 (2차 붕괴로 다시 갇힌 사람 — 두면 '대상이 그 위치에 없다'는 실패가 구출이 끝날 때까지 되풀이된다)
      if (c.mob === 'trapped') { clearCas(s, f.id, ['carry', 'escort']); want(sim, s, 'extricate', { cas: f.id }, 0.82 + urg, 2, false, cev); continue; }
      if (c.mob === 'mobile') {                // 스스로 대피 중 — 한참 지나도 도착 보고가 없으면 확인하러 보낸다
        if (sim.t - f.t > 32) want(sim, s, 'escort', { cas: f.id }, 0.62 + urg, 1, false, cev);
        continue;
      }
      const rg = s.region[c.y * s.w + c.x];
      const indoorHazard = s.kind === 'fire' || s.kind === 'hazmat' || s.kind === 'collapse' || (rg >= 0 && (B.val<number>('fire', rg) ?? 0) > 0.1);
      const hasMedic = s.agents.some((b) => b.status === 'active' && sim.responders[b.rid].dept === 'ems');
      // 처치가 필요한가: 아직 아무 처치도 못 받았거나, 기본 처치만 받았는데 구급대원이 와 있다
      const needTreat = !c.rush && c.band >= 1 && (c.tq === 0 || (c.tq === 1 && hasMedic && treatsDone(s, f.id) < 2));      // !c.rush: (R2 §4.7) 즉시 이송을 정한 환자는 처치를 더 내지 않는다
      const treatHere = hasMedic || (s.kind === 'medical' && c.tq === 0);      // 응급 환자는 누구든 먼저 손을 쓴다
      if (!indoorHazard && needTreat && treatHere && !hotArmed) { want(sim, s, 'treat', { cas: f.id }, 0.8 + urg, 1, false, cev); want(sim, s, 'carry', { cas: f.id }, 0.5, 2, false, cev); }
      else { cancel(s, (w) => w.kind === 'treat' && w.cas === f.id && w.status === 'open'); want(sim, s, 'carry', { cas: f.id }, 0.84 + urg, 2, false, cev); }
    } else if (c.where === 'safe') {
      if (!c.rush && c.band >= 1 && (c.tq === 0 || (c.tq === 1 && hasMedicAny && treatsDone(s, f.id) < 2))) want(sim, s, 'treat', { cas: f.id }, 0.72 + urg, 1, false, cev);      // !c.rush: (R2 §4.7)
      else cancel(s, (w) => w.kind === 'treat' && w.cas === f.id && w.status === 'open');
      if (c.band >= 1 && ambulances.length) {
        const already = s.board.some((w) => w.kind === 'load' && w.cas === f.id && (w.status === 'open' || w.status === 'active'));
        if (!already) {
          // 위중 환자는 자리가 남은 헬기를 먼저, 그 밖의 환자는 지상 구급차를 먼저 고른다 (헬기의 한 자리를 위중 환자에게 남긴다)
          const airFirst = c.band === 2;
          let best = -1;
          for (let pass = 0; pass < 2 && best < 0; pass++) for (const uid of ambulances) {
            const q = sim.units[uid];
            if ((!!q.air === airFirst) !== (pass === 0)) continue;
            if (seatsUsed(sim, q) + loadsQueued(s, uid) < seatsOf(q)) { best = uid; break; }
          }
          if (best >= 0) want(sim, s, 'load', { cas: f.id, prop: best }, c.rush ? 0.97 : (c.treated ? 0.7 : 0.5) + urg, 1, false, cev);      // (R2 §4.7) 즉시 이송이면 탑승이 먼저 (0.97)
        }
      }
    }
  }
  // ── 쓰러진 동료 ── 쓰러진 줄 알면 가장 먼저 구한다. 숨진 줄 알면 수습은 산 사람의 일보다 뒤다(0.55).
  // 더는 쓰러져 있지 않다고 알거나(안전 구역·후송), 자기 부대와 함께 현장을 떠난 동료(조직이 아는 부대의 출발)의 구조 지시는 거둔다
  for (const f of B.list('mate')) {
    const v = f.value as MateBelief;
    if (v.status === 'down' && onScene(s, f.id)) want(sim, s, 'rescueMate', { mate: f.id }, v.dead ? 0.55 : 0.97, 2, false, heardEv(f));
    else cancel(s, (w) => w.kind === 'rescueMate' && w.mate === f.id);
  }

  // ── 교통 통제 / 위험 조치 / 도로 정리 ──
  if (s.laneRows.length) {
    const hit = I.problems.some((p) => p.code === 'SECONDARY_COLLISION');
    s.controlPts.forEach((_, k) => { if (!B.get('ctl', k)) want(sim, s, 'traffic', { tile: k }, hit ? 0.9 : 0.74); });
  }
  for (const f of B.list('haz')) if (f.value.kind === 'leak') { if (f.value.active) want(sim, s, 'mitigate', { prop: f.id }, 0.86, 1, false, heardEv(f)); else cancel(s, (w) => w.kind === 'mitigate' && w.prop === f.id); }
  if (s.kind === 'traffic' && s.sizeupDone) {
    const unresolved = cas.some((f) => f.value.band < 3 && (f.value.where === 'scene' || f.value.where === 'carried'));
    if (!unresolved && pendingSearch === 0 && fireRegions === 0) {
      for (const p of s.props) {
        if (PROP_HOLDS.length && PROP_HOLDS.some((h) => h(sim, s, a, p.id))) continue;      // (N8) 보류: 견인차가 맡은 차는 핵심 규칙이 밀어 두지 않는다 — 줄이 없으면 그대로
        if ((p.kind === 'vehicle' && !p.cleared) || (p.kind === 'roadDebris' && !p.removed)) want(sim, s, 'clearRoad', { prop: p.id }, p.kind === 'vehicle' ? 0.42 : 0.36);
      }
    }
  }
  for (const f of B.list('evid')) if (f.value.kind === 'witness' && !f.value.done) want(sim, s, 'interview', { prop: f.id }, 0.82, 1, false, heardEv(f));

  // ── 지원 요청 ──
  const fireUnits = countUnits(sim, s, I, 'suppression', 0.7);
  // 현장의 진압 부대가 모두 물이 떨어졌거나 펌프가 멈췄고 오는 부대도 없다 (길 위의 현장에는 소화전이 없다)
  const dry = fireUnits > 0 && !I.assigned.some((uid) => { const u = sim.units[uid]; return u.caps.suppression >= 0.7 && (u.state === 'enroute' || u.state === 'turnout' || (!u.pumpFailed && (u.water > 0 || u.hydrant))); });
  if (fireRegions > 0 && fireUnits === 0) request(sim, s, I, a, 'suppression', '화재가 확인됐으나 진압 부대가 없음', true);
  else if (fireRegions > 0 && dry) {
    // (R3 §6.1 CF3) 펌프 고장이고 그 부대의 예비 펌프가 바닥났다 → '펌프 고장 — 진압 부대 교체' (교본 줄로 센다). 물이 떨어졌으면 지금 문구.
    // 펌프가 멈췄어도 예비 펌프가 남았으면 부르지 않는다 — 펌프를 맡은 대원이 바꾼다 (brain 의 예비 펌프 교체 — F10). 예비를 세지 않는 부대(undefined)는 지금처럼 부른다
    let pumpDead = false, waterOut = false, asked = false;      // asked = 교체를 이미 부른 펌프차가 있다 (그 교체가 용수 부족도 푼다 — 용수 요청을 따로 내지 않는다)
    for (const uid of I.assigned) { const q = sim.units[uid]; if (q.caps.suppression < 0.7 || q.state !== 'onscene' || q.incidentId !== I.id) continue; if (q.pumpFailed) { if (q.sparePump !== undefined && q.sparePump <= 0) { if (!cf3Asked(I).has(q.id)) { pumpDead = true; cf3Asked(I).add(q.id); } else asked = true; } else if (q.sparePump === undefined) waterOut = true; } else if (q.water <= 0 && !q.hydrant) waterOut = true; }
    if (pumpDead) { const ev = request(sim, s, I, a, 'suppression', '펌프 고장 — 진압 부대 교체', true); if (ev >= 0) docCmd(sim, I, 'CF3', ev); }
    else if (waterOut && !asked) request(sim, s, I, a, 'suppression', '진압 부대의 용수가 떨어짐', true);
  }
  else if ((fireSum >= 2.0 || fireRegions >= 3) && fireUnits < 2) request(sim, s, I, a, 'suppression', `화재가 ${fireRegions}개 구역으로 확대`, true);
  if (cas.some((f) => f.value.mob === 'trapped' && f.value.band < 3 && f.value.where === 'scene') && countUnits(sim, s, I, 'rescue', 0.5) === 0) request(sim, s, I, a, 'rescue', '고립된 구조 대상이 있으나 구조 장비가 없음', true);
  // 가스가 찼거나 무너질 수 있는 건물: 공기호흡기를 멘 대원이 현장에도, 오는 부대에도 없으면 아무도 들어갈 수 없다 (자기 조직의 편성·장비만 본다)
  if ((s.kind === 'hazmat' || s.kind === 'collapse') && s.sizeupDone
    && !s.agents.some((b) => b.status === 'active' && hasKit(sim, b.rid, 'scba'))
    && !I.assigned.some((uid) => { const u = sim.units[uid]; return (u.state === 'enroute' || u.state === 'turnout') && crewHasKit(sim, u, 'scba'); })) request(sim, s, I, a, 'rescue', s.kind === 'hazmat' ? '가스가 찬 건물에 진입할 소방 부대가 없음' : '붕괴 건물에 진입할 구조 부대가 없음', true);
  const patients = cas.filter((f) => f.value.band >= 1 && f.value.band < 3 && (f.value.where === 'scene' || f.value.where === 'carried' || f.value.where === 'safe'));
  const emsUnits = countUnits(sim, s, I, 'ems', 0.7);
  // 구급 부대가 한 대뿐인데 부상자가 그 부대의 환자 자리보다 많다 (구급차 2명, 헬기 1명 — 와 있거나 오고 있는 구급 부대의 자리를 더한다)
  let emsSeats = 0;
  if (emsUnits === 1) { const on = unitsOnScene(sim, s); for (const uid of I.assigned) { const u = sim.units[uid]; if (u.caps.ems >= 0.7 && (u.state === 'enroute' || u.state === 'turnout' || on.indexOf(uid) >= 0)) emsSeats += seatsOf(u); } }
  if (patients.length > 0 && emsUnits === 0) request(sim, s, I, a, 'ems', `부상자 ${patients.length}명 확인, 구급 부대 없음`, patients.some((f) => f.value.band === 2));
  else if (emsUnits === 1 && patients.length > emsSeats) request(sim, s, I, a, 'ems', `부상자 ${patients.length}명으로 구급 부대 1대로 감당 불가`, true);
  if (B.list('mate').some((f) => f.value.status === 'down' && !f.value.dead && onScene(s, f.id)) && emsUnits === 0) request(sim, s, I, a, 'ems', '대원 부상', true);
  const gunActive = active.some((h) => h.value.weapon === 'gun');
  const lawUnits = countUnits(sim, s, I, 'law', 0.5);
  // (R3 §6.1 CP1) 쓸 수 있는 경찰이 이 사건의 가장 낮은 문턱(흉기·총기 둘)보다 적고 오는 경찰 부대가 없으면 제압 인력을 부른다
  if (active.length > 0 && usable < 2 && police.length > usable && lawComing(sim, I) === 0) { const ev = request(sim, s, I, a, 'law', '제압 가능 인력 부족', true); if (ev >= 0) docCmd(sim, I, 'CP1', ev); }
  if (gunActive && lawUnits < 2) request(sim, s, I, a, lawUnits === 0 ? 'law' : 'tactical', '총기를 소지한 용의자와 대치 중, 인원 부족', true);
  else if (active.length > 0 && lawUnits === 0) request(sim, s, I, a, 'law', '용의자 대응 인력 없음', true);
  else if (active.length > 0 && lawUnits === 1 && s.negotStart >= 0 && sim.t - s.negotStart > 22) request(sim, s, I, a, 'law', '한 팀으로는 말을 걸면서 붙잡을 수 없음', false);      // 한 사람은 말을 걸고 한 사람은 길목을 지키면 붙잡을 손이 없다
  if (cordon && lawUnits === 0 && s.sizeupDone) request(sim, s, I, a, 'law', liveBomb ? '폭발물로 보이는 물건이 있는 건물 주변을 통제할 인력이 없음' : gasCordon ? '가스가 새는 건물 주변을 통제할 인력이 없음' : '붕괴·폭발 위험 반경을 통제할 인력이 없음', false);
  // 무장 사건 현장은 안전을 확보하기 전까지 경찰만 수색할 수 있다
  if (hotArmed && pendingSearch > 0 && lawUnits === 0 && s.sizeupDone) request(sim, s, I, a, 'law', '건물 안을 수색해 안전을 확보할 경찰이 없음', true);
  if (s.laneRows.length && lawUnits === 0 && !s.controlDone.every(Boolean) && cas.length > 0 && s.sizeupDone) request(sim, s, I, a, 'traffic', '차량 통행이 계속되는데 교통 통제 인력이 없음', false);
  if (s.kind === 'search' && cas.length === 0 && s.arrivedAt >= 0 && sim.t - s.arrivedAt > 75 && countUnits(sim, s, I, 'search', 0.3) < 3) request(sim, s, I, a, 'search', '수색 범위에 비해 인력 부족', false);
  // 맡을 사람이 없는 작업: 한참 열려 있는데 현장의 누구도 맡을 수 없고, 그 일을 할 부대도 오고 있지 않으면 그 능력의 부대를 부른다
  // (예: 헬기 대원만 있는 가스 누출 현장의 밸브 차단, 경찰이 모두 떠난 무장 현장의 수색)
  for (const w of s.board) {
    if (w.status !== 'open' || w.assignees.length || sim.t - w.createdAt < 20 || sim.t < w.holdUntil) continue;
    const need = needFor(s, w, hotArmed, a);
    if (!need) continue;
    if (w.kind === 'rescueMate' && B.val<MateBelief>('mate', w.mate)?.dead) continue;      // 숨진 동료의 수습 때문에 다른 곳의 부대를 부르지 않는다 (맡을 사람이 생기면 하고, 없으면 종료도 막지 않는다 — recoveryStuck)
    if (anyCapable(sim, s, I, w, need)) continue;
    request(sim, s, I, a, need, `${josa(workLabel(s, w, sim), '을/를')} 맡을 대원이 없음`, w.priority >= 0.85);
    break;
  }
  // ── 묶음별 지휘 규칙 (field/orders/*) ──
  if (ORDER_RULES.length) {
    const kit = commandKitOf(sim, s, I, a);
    for (const rule of ORDER_RULES) rule(sim, s, I, a, kit);
  }
  if (s.ops) s.ops.gated = gateHits;      // (X6 §5.3) 지난 계획 주기에 문이 막은 수 — 종료를 막는 것(단계 6)이 읽는다
  gateCmd = null;
}

/**
 * (R3 속도) 묶음별 지휘 규칙에 넘기는 도구 — 지휘관(현장 대원 객체)마다 한 번 만든다. 닫힘이 잡는 sim·s·I·a 는 그 대원에게 늘 같으므로 결과는 같다
 * (계획 주기마다 이름 붙은 닫힘 다섯을 새로 만들면 헤드리스 실행기(tsx)가 그때마다 __name 을 부른다)
 */
const KITS = new WeakMap<FieldAgent, CommandKit>();
function commandKitOf(sim: Sim, s: Scene, I: Incident, a: FieldAgent): CommandKit {
  let kit = KITS.get(a);
  if (kit === undefined) {
    kit = {
      want: (kind, tg, priority, max = 1, thorough = false) => want(sim, s, kind, tg, priority, max, thorough),
      cancel: (pred) => cancel(s, pred),
      request: (need, reason, urgent) => request(sim, s, I, a, need, reason, urgent),
      countUnits: (need, min) => countUnits(sim, s, I, need, min),
      unitsOnScene: () => unitsOnScene(sim, s),
    };
    KITS.set(a, kit);
  }
  return kit;
}
/** 작업 배정 */
/** 작업판의 일을 대원에게 맡긴다 (commanderThink 가 판단마다 부른다. 내보낸 것은 시험 — R3 시험 2-e 의 교본 전후 1등 비교 — 이 직접 부르기 위해서다) */
export function assign(sim: Sim, s: Scene, I: Incident, a: FieldAgent): void {
  const me = resp(sim, a);
  // 응답 없는 지시 확인
  for (const w of s.board) {
    if (w.status !== 'active') continue;
    for (let k = w.assignees.length - 1; k >= 0; k--) {
      const rid = w.assignees[k];
      const b = s.agents.find((q) => q.rid === rid);
      if (!b || b.status !== 'active') { w.assignees.splice(k, 1); continue; }
      // 지시는 받았지만 휴식·장비 교체 같은 제 몸 추스르기에 매여 손을 못 대고 있다: 한참 지나면 다른 대원에게 넘긴다
      // (그대로 두면 작업이 "맡은 사람 있음"으로 남아, 쉬는 대원 곁에서 손이 빈 대원들이 기다리기만 한다)
      const busyElse = b.orderWork === w.id && b.task !== null && b.task.workId < 0 && b.task.kind !== 'standby';
      if ((b.task && b.task.workId === w.id) || (b.orderWork === w.id && !busyElse)) continue;
      const sent = w.orderSentAt[rid] ?? sim.t;
      if (sim.t - sent < (busyElse ? 8 : 4.5)) continue;
      w.assignees.splice(k, 1);
      if (busyElse) b.orderWork = -1;
      if (rid !== a.rid && !b.task) {
        raiseProblem(sim, I, 'COMM_FAIL', `${sim.responders[rid].name}에게 보낸 지시 미수신`, { role: 'COMMANDER', actor: me.name, rid: a.rid, imp: 1, text: `${sim.responders[rid].name}, 응답 없음. 지시가 전달되지 않은 것으로 판단하고 임무를 재배정합니다.` }, false);
        w.holdUntil = sim.t + 2;
      }
    }
    if (!w.assignees.length) w.status = 'open';
  }
  const items = s.board.filter((w) => (w.status === 'open' || w.status === 'active') && w.assignees.length < w.max && sim.t >= w.holdUntil);
  items.sort((x, y) => y.priority - x.priority || x.id - y.id);
  const taken = new Set<number>();
  // (R3 §6.1 CF7) 현장에 다른 공기호흡기 대원(알려진 고장 아님 — 조직 정보)이 둘 이상이면 지휘관 자신은 위험 실내 일을 맡지 않는다 (지휘관 감점 −0.18 위에 그 일만 뺀다)
  let scbaOthers = 0;
  for (const b of s.agents) if (b !== a && b.status === 'active' && hasKit(sim, b.rid, 'scba')) scbaOthers++;
  const swatOn = swatOnScene(sim, s);      // (R3 §6.1 CS2 — 5단계) 특공이 현장에 있으면 진입조는 특공·기동대, 순찰은 봉쇄 쪽으로 (배정 점수 가산)
  for (let pass = 0; pass < 2; pass++) {
    for (const w of items) {
      if (pass === 0 && w.assignees.length > 0) continue;
      if (pass === 1 && (w.assignees.length === 0 || w.assignees.length >= w.max)) continue;
      let best: FieldAgent | null = null, bs = 0;
      let bestAns: DocFitAns | null = null, baseBest: FieldAgent | null = null, bsB = 0, baseAns: DocFitAns | null = null;      // (R3 §2.7) 교본 전의 적합도로 센 1등도 함께 센다
      let cf7Sc = -1;      // (R3 CF7) 위험 실내 일에서 뺀 지휘관 자신의 점수 (그가 1등이었으면 CF7 이 배정을 바꾼 것이다)
      const cf7 = scbaOthers >= 2 && inJob(sim, s, a, w);
      let bestNoCs: FieldAgent | null = null, bsN = 0;      // (CS2) 가산 없이 센 1등
      for (const b of s.agents) {
        if (b.status !== 'active' || taken.has(b.rid) || w.assignees.indexOf(b.rid) >= 0) continue;
        if (sim.units[b.unitId].boardOrder) continue;
        if (b.task && b.task.kind === 'rehab' && sim.responders[b.rid].stamina < 40) continue;      // 지친 대원은 어느 정도 회복할 때까지 지시를 받지 않는다 (brain.ts 의 휴식 붙잡기)
        if (b.task && (b.task.kind === 'resupply' || b.task.kind === 'swapAir')) continue;      // 예비 장비·공기통으로 바꾸는 중(8~11초 남짓): 끝날 때까지 기다린다. 지시로 빼 오면 교체를 처음부터 다시 시작하며 같은 말을 되풀이한다
        if (b.task && b.task.kind === 'evacuate') continue;      // (X6) 철수 중인 대원은 밖에 닿을 때까지 지시를 받지 않는다 (think 가 철수를 붙잡으므로 지시가 '응답 없음'으로 끝난다)
        if (b.task && docHolds(s, b) && !pairTakes(sim, s, a, b, w)) continue;      // (R3 §2.6) 교본 임무(엄폐·탄약 보급·공기 탈출·짝 따라 나가기, 짝이 위험 실내에 있는 동안의 짝 동행) 중인 대원은 빼 오지 않는다 — 짧고 스스로 끝난다 (3단계: 짝 동행이 짝의 이웃 구역 위험 실내 일을 받는 것은 된다 — 둘이 붙어 일한다)
        if (sim.responders[b.rid].status === 'injured' && !lightDuty(a, b)) continue;      // 부상을 알린 대원은 후퇴 중이다 (brain.ts 의 부상 후퇴 붙잡기) — 지시해도 받지 못하고 재지시만 되풀이된다. 가벼운 일을 한다고 알린 다친 대원에게는 지시한다(맡을 수 있는 일은 fitFor 가 거른다). 조직이 아는 상태와 믿음만 본다 — 남의 체력을 읽지 않는다
        if (failedRecently(sim, w, b.rid)) continue;      // 이 작업에 닿지 못했거나 위험해서 물러난 대원: 한동안 다른 대원에게 맡기거나 기다린다
        const fp = fitParts(sim, s, b, w);      // fit = fitFor 와 같은 값, base = 교본 전의 값 (R3)
        const fit = fp.fit;
        if (fp.base <= 0) continue;
        // 이미 일하는 중이면 우선순위 차이가 클 때만 빼 온다
        let curPr = -1;
        const curW = b.task && b.task.workId >= 0 ? s.board[b.task.workId] : b.orderWork >= 0 ? s.board[b.orderWork] : null;
        if (curW && (curW.status === 'active' || curW.status === 'open')) curPr = curW.priority;
        else if (hasWork(b) && b.task!.kind !== 'rehab') curPr = 0.6;
        if (b.carrying !== -1) continue;
        if (curPr >= 0 && (pass === 1 || w.priority < curPr + 0.22) && !(b === a && w.kind === 'sizeup')) continue;      // 지휘를 넘겨받은 지휘관은 하던 일(봉쇄 등)을 두고 현장 평가부터 다시 한다
        if (b === a && w.kind !== 'sizeup') { if (pass === 1) continue; }
        const r = sim.responders[b.rid];
        const d = dist(b.x, b.y, targetX(s, w, a), targetY(s, w, a));
        let sc = fit * 0.5 + (1 - Math.min(1, d / 34)) * 0.22 + (r.stamina / 100) * 0.1 + r.experience * 0.08 + (curPr < 0 ? 0.12 : 0);
        if (b === a && w.kind !== 'sizeup') sc -= 0.18;      // 지휘관은 가급적 지휘에 집중
        if (b === a && cf7) { if (fit > 0) cf7Sc = Math.max(cf7Sc, sc); continue; }      // (R3 CF7) 지휘관은 밖에 — 위험 실내 일은 다른 대원에게
        const cs2 = swatOn ? cs2Add(sim, b, w) : 0;      // (CS2) 적합도 교본의 1등 비교(아래 scB)와 따로 센다
        if (fit > 0 && sc > bsN) { bsN = sc; bestNoCs = b; }
        sc += cs2;
        if (fit > 0 && sc > bs) { bs = sc; best = b; bestAns = fp; }
        let scB = sc;      // 교본 전의 점수 (적합도만 교본 전의 값으로 — 교본이 바꾸지 않았으면 sc 그대로)
        if (fp.base !== fit) { scB = fp.base * 0.5 + (1 - Math.min(1, d / 34)) * 0.22 + (r.stamina / 100) * 0.1 + r.experience * 0.08 + (curPr < 0 ? 0.12 : 0) + cs2; if (b === a && w.kind !== 'sizeup') scB -= 0.18; }
        if (scB > bsB) { bsB = scB; baseBest = b; baseAns = fp; }
      }
      // (R3 §2.7) 교본이 배정을 바꿨는가: 교본을 넣은 1등과 교본 전의 1등이 다르면 지시 무전 끝에 까닭 말을 붙이고 바꾼 줄을 기록한다 (같으면 아무것도 남기지 않는다)
      const docChanged = best !== baseBest;
      if (!best) { if (docChanged) docAssignRecord(sim, I, null, null, baseBest, baseAns, w, -1); continue; }
      taken.add(best.rid);
      w.assignees.push(best.rid); w.status = 'active'; w.orderSentAt[best.rid] = sim.t;
      const br = sim.responders[best.rid];
      if (best === a) { a.orderWork = w.id; if (docChanged) docAssignRecord(sim, I, best, bestAns, baseBest, baseAns, w, -1); continue; }
      const redo = w.fails > 0 ? ' (재지시)' : '';
      const docWhy = docChanged ? docAssignWhy(bestAns) : '';
      const ordEv = transmit(sim, s, a, best.rid, 'order', [], `${br.name}, ${workLabel(s, w, sim)}${w.kind === 'search' || w.kind === 'suppress' || w.kind === 'carry' ? ' 실시' : ' 맡아라'}${redo}${docWhy ? ' ' + docWhy : ''}.`, w.id, w.priority > 0.8 ? 1 : 0, w.cause >= 0 ? [w.cause] : []);
      if (docChanged) docAssignRecord(sim, I, best, bestAns, baseBest, baseAns, w, ordEv);
      if (cf7Sc > bs && ordEv >= 0) recordDoc(sim, I, null, 'CF7', 'cmd', { work: w.kind, tgt: 'w:' + w.id }, ordEv);      // (R3 CF7) 지휘관이 1등이었는데 밖에 남았다
      if (inJob(sim, s, a, w)) pairAssign(sim, s, a, best, w, items, taken);      // (합치기 (나)) 짝에게도 곁의 일을 함께 준다 — 둘째 자리
      if (swatOn && bestNoCs !== null && bestNoCs !== best) recordDoc(sim, I, null, 'CS2', 'cmd', { work: w.kind, tgt: 'w:' + w.id }, ordEv);      // (CS2) 가산이 고른 사람을 바꾸었다
    }
  }
  // 교대: 구출을 맡은 사람이 다 찼는데(먼저 닿은 대원이 맨손으로 붙들고 있다), 손이 빈 대원 가운데 훨씬 나은 장비를 든 사람이 있으면
  // (뒤에 닿은 구조대의 유압 구조기) 그 사람을 보낸다. 닿으면 그 자리에서 가장 서툰 사람과 자리를 바꾼다(executor 의 구출 임무 — relieve).
  // 한 작업의 사람 수(max)는 그대로다: 넘겨받는 동안만 한 명이 더 붙는다. 적합도는 든 장비로만 본다(fitFor — 숨은 고장은 모른다)
  for (const w of s.board) {
    if (w.kind !== 'extricate' || w.status !== 'active' || w.assignees.length !== w.max || sim.t < w.holdUntil) continue;
    let low = Infinity;
    for (const rid of w.assignees) { const b = s.agents.find((q) => q.rid === rid); if (b) low = Math.min(low, fitFor(sim, s, b, w)); }
    let best: FieldAgent | null = null, bf = low + RELIEF_GAP;
    for (const b of s.agents) {
      if (b === a || b.status !== 'active' || taken.has(b.rid) || w.assignees.indexOf(b.rid) >= 0 || sim.units[b.unitId].boardOrder) continue;
      if (hasWork(b) || b.orderWork >= 0 || b.carrying !== -1 || sim.responders[b.rid].status === 'injured' || failedRecently(sim, w, b.rid)) continue;      // 손이 빈 대원만 (다친 대원은 구출을 넘겨받지 않는다)
      const fit = fitFor(sim, s, b, w);
      if (fit >= bf) { bf = fit; best = b; }
    }
    if (!best) continue;
    taken.add(best.rid);
    w.assignees.push(best.rid); w.orderSentAt[best.rid] = sim.t;
    transmit(sim, s, a, best.rid, 'order', [], `${sim.responders[best.rid].name}, ${workLabel(s, w, sim)} 넘겨받아라 — 장비를 갖춘 대원으로 교대한다.`, w.id, 1, w.cause >= 0 ? [w.cause] : []);
  }
  handoverCare(sim, s, I, a, taken);
}
/**
 * (R3 §6.1 CE2) 처치 넘겨받기: 처치를 맡은 사람이 모두 구급 분야가 아닌데(선착한 소방·경찰의 기본 처치) 손이 빈 구급 대원이 있으면 그 대원에게 같은 작업을 지시한다
 * (담당자 둘을 잠깐 허락 — 작업의 사람 수 max 를 넘긴다). 지휘관 코드는 비구급 대원의 임무를 끝내지 않는다: 구급 대원이 환자 곁(1.5칸)에 오면
 * 비구급 대원이 스스로 손을 뗀다(실행기 case 'treat' — doctrineRun.tryHandover). 적합도는 든 장비·명부로만 본다(fitFor)
 */
function handoverCare(sim: Sim, s: Scene, I: Incident, a: FieldAgent, taken: Set<number>): void {
  for (const w of s.board) {
    if (w.kind !== 'treat' || w.status !== 'active' || !w.assignees.length || sim.t < w.holdUntil) continue;
    if (w.assignees.some((rid) => sim.responders[rid].dept === 'ems')) continue;
    let best: FieldAgent | null = null, bf = 0;
    for (const b of s.agents) {
      if (b === a || b.status !== 'active' || taken.has(b.rid) || w.assignees.indexOf(b.rid) >= 0 || sim.units[b.unitId].boardOrder) continue;
      const r = sim.responders[b.rid];
      if (r.dept !== 'ems' || r.status === 'injured' || hasWork(b) || b.orderWork >= 0 || b.carrying !== -1 || failedRecently(sim, w, b.rid)) continue;      // 손이 빈 구급 대원만
      const fit = fitFor(sim, s, b, w);
      if (fit > bf) { bf = fit; best = b; }
    }
    if (!best) continue;
    taken.add(best.rid);
    w.assignees.push(best.rid); w.orderSentAt[best.rid] = sim.t;
    const ev = transmit(sim, s, a, best.rid, 'order', [], `${sim.responders[best.rid].name}, ${workLabel(s, w, sim)} 넘겨받아라.`, w.id, 1, w.cause >= 0 ? [w.cause] : []);
    if (ev >= 0) docCmd(sim, I, 'CE2', ev);
  }
}
/** 그 다친 대원이 가벼운 일을 하고 있다고 지휘관이 아는가 (본인의 보고 — mate 사실 'light'. 후퇴 중·안전 구역이면 아니다) */
function lightDuty(a: FieldAgent, b: FieldAgent): boolean {
  const v = a.beliefs.val<MateBelief>('mate', b.rid);
  return v !== undefined && v.status === 'light';
}
/** 구출을 넘겨받게 하는 적합도 차이 (맨손 0.1 안팎, 할리건 0.2~0.45, 유압 구조기 0.6~1.2 — 맨손은 손에 익은 할리건이나 유압 구조기가, 할리건은 유압 구조기가 넘겨받는다) */
const RELIEF_GAP = 0.3;

function targetX(s: Scene, w: WorkItem, a: FieldAgent): number {
  if (w.region >= 0) return s.regions[w.region].cx;
  if (w.cas >= 0) { const c = a.beliefs.val<CasBelief>('cas', w.cas); if (c) return c.x; }
  if (w.kind === 'traffic') return s.controlPts[w.tile].x;
  if (w.kind === 'cordon') return w.tile % s.w;      // (N8 §5.10) 통제의 대상은 격자 칸 번호
  if ((w.animal ?? -1) >= 0) { const v = a.beliefs.val<{ x: number }>('ani', w.animal!); if (v) return v.x; }      // (N8 단계 5) 믿음 속 동물의 자리
  if (w.kind === 'perimeter') return s.exits[w.tile].x;
  if (w.kind === 'hookup' || w.kind === 'load') return s.staging.x;
  if (w.kind === 'treatMate') { const m = a.beliefs.val<MateBelief>('mate', w.mate); if (m) return m.x; }
  if (w.kind === 'treatSuspect') { const h = a.beliefs.val<any>('hos', w.hostile); if (h) return h.x; }      // prop 은 태울 차(부대 id)라 소품이 아니다
  if (w.prop >= 0 && s.props[w.prop]) return s.props[w.prop].x;
  if (w.hostile >= 0) { const h = a.beliefs.val<any>('hos', w.hostile); if (h) return h.x; }
  return s.staging.x;
}
function targetY(s: Scene, w: WorkItem, a: FieldAgent): number {
  if (w.region >= 0) return s.regions[w.region].cy;
  if (w.cas >= 0) { const c = a.beliefs.val<CasBelief>('cas', w.cas); if (c) return c.y; }
  if (w.kind === 'traffic') return s.controlPts[w.tile].y;
  if (w.kind === 'cordon') return (w.tile / s.w) | 0;
  if ((w.animal ?? -1) >= 0) { const v = a.beliefs.val<{ y: number }>('ani', w.animal!); if (v) return v.y; }
  if (w.kind === 'perimeter') return s.exits[w.tile].y;
  if (w.kind === 'hookup' || w.kind === 'load') return s.staging.y;
  if (w.kind === 'treatMate') { const m = a.beliefs.val<MateBelief>('mate', w.mate); if (m) return m.y; }
  if (w.kind === 'treatSuspect') { const h = a.beliefs.val<any>('hos', w.hostile); if (h) return h.y; }
  if (w.prop >= 0 && s.props[w.prop]) return s.props[w.prop].y;
  if (w.hostile >= 0) { const h = a.beliefs.val<any>('hos', w.hostile); if (h) return h.y; }
  return s.staging.y;
}

/** 현장 평가 직후: 관제가 알려준 내용과 실제가 다른가 */
function checkMismatch(sim: Sim, s: Scene, I: Incident, a: FieldAgent): void {
  s.mismatchLogged = true;
  const B = a.beliefs, me = resp(sim, a);
  const diffs: string[] = [];
  const as = I.assessment;
  const seenType = s.kind;       // 지휘관은 도착해서 사건의 성격을 직접 본다
  learn(sim, a, mkFact('type', 0, seenType, me.name, sim.t, 1, true, `현장 확인: ${TYPE_NAME[seenType]}`), false);
  if (as && as.type !== seenType) diffs.push(`신고는 ${TYPE_NAME[as.type]}였으나 실제는 ${TYPE_NAME[seenType]}`);
  const hos = B.list('hos');
  const gunSeen = hos.some((h) => h.value.weapon === 'gun');
  const claimWeapon = I.claims.filter((c) => c.topic === 'weapon').pop();
  if (gunSeen && (!claimWeapon || claimWeapon.value !== 'gun')) diffs.push('신고에 없던 총기 소지 용의자 확인');
  if (!gunSeen && hos.length > 0 && claimWeapon && claimWeapon.value === 'gun') diffs.push('신고와 달리 총기는 확인되지 않음');
  const fires = B.list('fire').filter((f) => f.value > 0.05);
  if (as && as.severity < 2 && (fires.length >= 2 || fires.some((f) => f.value >= 0.8))) diffs.push(`화재 규모가 신고보다 큼 (${fires.length}개 구역)`);
  if (as && as.type === 'fire' && seenType === 'fire' && fires.length === 0 && s.burning === 0) diffs.push('도착 시 화염은 보이지 않음');
  const trapped = B.list('cas').filter((f) => f.value.mob === 'trapped').length;
  const claimTrap = I.claims.filter((c) => c.topic === 'trapped').pop();
  if (trapped > 0 && (!claimTrap || claimTrap.value !== true)) diffs.push(`신고에 없던 고립자 ${trapped}명 확인`);
  if (diffs.length) {
    raiseProblem(sim, I, 'SCENE_MISMATCH', diffs.join(', '), { role: 'COMMANDER', actor: me.name, rid: a.rid, imp: 3, causes: I.callEvents.slice(-2), text: `현장 평가 완료. 최초 신고 내용과 다른 상황이 확인됐습니다: ${diffs.join(' / ')}.` }, false);
  } else {
    emit(sim, { inc: I.id, role: 'COMMANDER', actor: me.name, rid: a.rid, kind: 'command', imp: 1, text: '현장 평가 완료. 신고 내용과 대체로 일치합니다. 대응을 시작합니다.' });
  }
  sitrep(sim, s, I, a, true);
}

function sitrep(sim: Sim, s: Scene, I: Incident, a: FieldAgent, force = false): void {
  if (!force && sim.t - s.lastSitrep < 45) return;
  const B = a.beliefs;
  const cas = B.list('cas');
  const fires = B.list('fire').filter((f) => f.value > 0.05);
  const hos = B.list('hos').filter((h) => h.value.state === 'hold' || h.value.state === 'fight' || h.value.state === 'flee');
  const parts: string[] = [];
  if (fires.length) parts.push(`화재 ${fires.length}개 구역`);
  if (cas.length) { const bands = [0, 0, 0, 0]; for (const c of cas) bands[c.value.band]++; parts.push(`구조 대상 ${cas.length}명 확인(${bands.map((n, k) => (n ? `${BAND_NAME[k]} ${n}` : '')).filter(Boolean).join(', ')})`); }
  if (hos.length) parts.push(`용의자 ${hos.length}명 대치 중`);
  if (!parts.length) parts.push(TYPE_DEFS[s.kind].zoneSearch ? '대상 수색 중' : '특이 사항 없음');
  const ev = transmit(sim, s, a, -2, 'sitrep', [], `관제, 현장 상황 보고: ${parts.join(', ')}.`, -1, 0);
  if (ev < 0) return;
  s.lastSitrep = sim.t;
}

/** 그 대원이 아직 이 현장에 있는가 (자기 부대와 함께 떠나지 않았다) — 부대의 출발은 조직이 아는 사실이다 */
function onScene(s: Scene, rid: number): boolean {
  for (let k = 0; k < s.agents.length; k++) if (s.agents[k].rid === rid) return s.agents[k].status !== 'left';
  return false;
}
/**
 * 숨진 동료의 수습인데 지금 현장의 누구도 맡을 수 없다 (불 속·교전 중인 건물 안 — 들어갈 자격이 없거나 방금 닿지 못했다).
 * 이런 수습은 종료를 막지 않는다: 닿을 수 없는 자리의 수습 때문에 한계 시간까지 끌지 않는다 (부대가 떠날 때 함께 복귀한다).
 */
function recoveryStuck(sim: Sim, s: Scene, a: FieldAgent, w: WorkItem): boolean {
  if (w.kind !== 'rescueMate' || w.assignees.length > 0) return false;
  const v = a.beliefs.val<MateBelief>('mate', w.mate);
  if (!v || !v.dead) return false;
  return !s.agents.some((b) => b.status === 'active' && !failedRecently(sim, w, b.rid) && fitFor(sim, s, b, w) > 0);
}

function canClose(sim: Sim, s: Scene, a: FieldAgent): boolean {
  if (!s.sizeupDone) return false;
  const B = a.beliefs;
  if (s.board.some((w) => (w.status === 'open' || w.status === 'active') && !recoveryStuck(sim, s, a, w))) return false;
  if (B.list('fire').some((f) => f.value > 0.05)) return false;
  for (const f of B.list('cas')) {
    const c = f.value as CasBelief;
    if (c.band === 3 || c.where === 'loaded' || c.where === 'hospital') continue;
    if (c.where === 'safe' && c.band === 0) continue;
    return false;
  }
  if (B.list('hos').some((h) => h.value.state === 'hold' || h.value.state === 'fight' || h.value.state === 'flee' || h.value.state === 'surrendered')) return false;
  if (s.kind === 'armed' && s.secureAt < 0) return false;
  if (TYPE_DEFS[s.kind].zoneSearch && B.list('cas').length < 1) return false;
  if (B.list('mate').some((f) => f.value.status === 'down' && !f.value.dead && onScene(s, f.id))) return false;      // 쓰러진 동료를 두고 끝내지 않는다 (숨진 동료의 수습은 위의 작업 항목이 막는다)
  for (const blocked of CLOSE_BLOCKERS) if (blocked(sim, s, a)) return false;
  return true;
}

function manageAmbulances(sim: Sim, s: Scene, I: Incident, a: FieldAgent): void {
  const cas = a.beliefs.list('cas');
  // 병원이 필요하다고 아는 다친 동료 가운데 아직 현장에 있는 사람 (실을 사람이 남았는가를 볼 때 구조 대상과 함께 센다 — H1 §3.4-5)
  let matesWaiting = 0;
  for (const f of a.beliefs.list('mate')) if (mateNeedsHospital(f.value as MateBelief) && onScene(s, f.id)) matesWaiting++;
  // 처치·이송이 필요하다고 아는 용의자 (위협이 끝났을 때만 — 맞서는 용의자가 있으면 그 처치는 아직 시작하지 않는다)
  const hosB = a.beliefs.list('hos');
  const hosWaiting = hosB.some((h) => h.value.state === 'hold' || h.value.state === 'fight' || h.value.state === 'flee') ? 0 : hosB.filter((h) => hosNeedsCare(h.value)).length;
  for (const uid of unitsOnScene(sim, s)) {
    const u = sim.units[uid];
    const riders = u.aboard ? u.aboard.length : 0;      // 구조 대상이 아닌 환자 (다친 대원·용의자) — 부대 자신의 기록
    if (seatsOf(u) === 0 || (!u.patients.length && !riders) || u.boardOrder) continue;      // 환자 자리가 있는 부대만 (구급차·헬기). 다친 대원·용의자만 태운 차도 출발한다
    const full = seatsUsed(sim, u) >= seatsOf(u);      // 자리가 찼으면 바로 떠난다 (남은 탑승 지시는 아래에서 거둔다 — 다른 부대로 다시 낸다)
    const waiting = cas.filter((f) => f.value.band >= 1 && f.value.band < 3 && (f.value.where === 'scene' || f.value.where === 'carried' || f.value.where === 'safe')).length + matesWaiting + hosWaiting;
    const loading = s.board.some((w) => (w.kind === 'load' || w.kind === 'treatMate' || w.kind === 'treatSuspect') && w.prop === uid && (w.status === 'open' || w.status === 'active'));
    const waited = sim.t - (u.firstLoadAt ?? sim.t);      // 이번 이송에 처음 사람을 태운 뒤 지난 시간 — 부대 자신의 기록 (실은 사람의 진실을 읽지 않는다)
    // 위중 환자를 실었다고 알고 있거나(실은 대원의 보고 — 진실을 읽지 않는다) 다친 대원을 태웠다: 10초 뒤 출발한다
    const redAboard = riders > 0 || u.patients.some((cid) => { const b = a.beliefs.val<CasBelief>('cas', cid); return !!b && b.band === 2; });
    if (!full && loading && waited < 30) continue;
    if (full || waiting === 0 || (redAboard && waited > 10) || waited > 35) {
      u.boardOrder = 'transport';
      cancel(s, (w) => (w.kind === 'load' || w.kind === 'treatMate' || w.kind === 'treatSuspect') && w.prop === uid);
      const who = riderText(u);
      emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 1, text: `${u.callsign}, ${who} 병원 이송 출발하라.` });
    }
  }
}

/** 실은 사람의 글: '환자 n명·부상 대원 m명·용의자 k명' (0 인 항은 뺀다 — 부대 자신의 기록으로). 출발 지시(manageAmbulances)와 출발 기록(sceneManager 5)번 블록)이 같은 글을 쓴다 */
export function riderText(u: { patients: number[]; aboard?: { kind: 'mate' | 'suspect' }[] }): string {
  let mates = 0, sus = 0;
  if (u.aboard) for (let k = 0; k < u.aboard.length; k++) { if (u.aboard[k].kind === 'mate') mates++; else sus++; }
  const parts: string[] = [];
  if (u.patients.length || (!mates && !sus)) parts.push(`환자 ${u.patients.length}명`);
  if (mates) parts.push(`부상 대원 ${mates}명`);
  if (sus) parts.push(`용의자 ${sus}명`);
  return parts.join('·');
}
/** 스스로 대피 중이라던 사람의 소식이 이만큼(초) 끊기면 대피를 마친 것으로 치지 않는다 — 동행 확인(escort)을 보내는 기준과 같다 */
const MOBILE_STALE = 32;
/**
 * 지휘관의 믿음 기준으로 아직 남은 일. 현장을 비우게 될 때(환자 이송 등) 종료할지 판단하는 데 쓴다.
 * now 를 주면(현장이 비었을 때의 종료 판단): 현장에서 스스로 대피 중이라던 사람 가운데 소식이 MOBILE_STALE 초 넘게 끊긴 사람을 남은 일로 센다 —
 * 대피하다 쓰러졌을 수 있다(H1 §5.2). 주지 않으면 예전처럼 대피 중인 사람을 모두 뺀다.
 * mates = 믿음상 쓰러져 있는(숨지지 않은) 동료의 수 (H1 §3.5) — 현장이 비었는데 쓰러진 동료가 남았으면 끝내지 않고 구하러 갈 부대를 찾는다.
 */
export function outstanding(a: FieldAgent, now = -1, s?: Scene): { patients: number; fire: boolean; hostile: boolean; search: boolean; mates: number; matesDown: number } {
  const B = a.beliefs;
  let patients = 0;
  for (const f of B.list('cas')) {
    const c = f.value as CasBelief;
    if (c.band === 3 || c.where === 'loaded' || c.where === 'hospital' || (c.where === 'safe' && c.band === 0)) continue;
    if (c.mob === 'mobile' && !(now >= 0 && c.where === 'scene' && now - f.t > MOBILE_STALE)) continue;
    patients++;
  }
  // 쓰러진 채 현장에 남은 동료 (숨진 줄 아는 동료는 세지 않는다 — 수습 임무를 따로 만들지 않고, 부대가 떠날 때 함께 복귀한다).
  // s 를 주면 자기 부대와 함께 이미 떠난 동료를 뺀다. 병원이 필요하다고 아는 다친 동료(후퇴 중·안전 구역 — 가벼운 일로 돌아온 동료와 후송된 동료는 아니다)도 남은 일이다 (§3.5)
  let mates = 0, matesDown = 0;
  for (const f of B.list('mate')) {
    const v = f.value as MateBelief;
    if (v.dead || (s && !onScene(s, f.id))) continue;
    if (v.status === 'down') { mates++; matesDown++; }
    else if ((v.status === 'hurt' || v.status === 'safe') && mateNeedsHospital(v)) mates++;
  }
  return {
    patients, mates, matesDown,
    fire: B.list('fire').some((f) => f.value > 0.05),
    hostile: B.list('hos').some((h) => h.value.state === 'hold' || h.value.state === 'fight' || h.value.state === 'flee' || h.value.state === 'surrendered' || h.value.state === 'asleep'),      // asleep: (N8 단계 6a) 잠든 취객도 남은 일이다
    search: B.list('cas').length === 0,
  };
}

/**
 * 확인 무전: 현장의 대원이 모두 손을 놓고 있는데 지휘관이 보기에는 아직 끝낼 수 없다.
 * 음영 구역에 있던 지휘관이 보고를 놓쳤을 수 있으므로(발견한 사람, 꺼진 불), 전 대원에게 아는 상황을 다시 보고하게 한다.
 */
function rollCall(sim: Sim, s: Scene, a: FieldAgent, closable: boolean): void {
  const crew = s.agents.filter((b) => b.status === 'active');
  const idle = !closable && s.sizeupDone && crew.length >= 2 && crew.every((b) => !b.task || b.task.kind === 'standby' || b.task.kind === 'rehab');
  if (!idle) { s.allIdleSince = -1; return; }
  if (s.allIdleSince === undefined || s.allIdleSince < 0) s.allIdleSince = sim.t;
  if (sim.t - s.allIdleSince < 12 || (s.rollCallAt ?? -1e9) >= s.allIdleSince) return;      // 손을 놓은 동안 한 번만 묻는다
  const ev = transmit(sim, s, a, -1, 'rollcall', [], '전 대원, 지금까지 확인한 구조 대상과 위험 요소를 다시 보고하라.', -1, 1);
  if (ev >= 0) s.rollCallAt = sim.t;
}

export function commanderThink(sim: Sim, s: Scene, a: FieldAgent): void {
  const I = sim.incidents[s.incidentId];
  if (I.phase === 'closed' || s.closing) return;
  syncBoard(sim, s, I, a);
  if (s.sizeupDone && !s.mismatchLogged) checkMismatch(sim, s, I, a);
  manageAmbulances(sim, s, I, a);
  assign(sim, s, I, a);
  if (s.sizeupDone) sitrep(sim, s, I, a);
  const closable = canClose(sim, s, a);
  rollCall(sim, s, a, closable);
  // 종료 판단: 두 번 연속으로 조건이 충족돼야 한다
  if (closable) {
    if (s.closedCheckAt > 0 && sim.t - s.closedCheckAt >= 3) {
      emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 2, text: '확인된 위험과 구조 대상 처리가 끝났습니다. 상황 종료를 선언합니다. 전 부대 철수.' });
      closeIncident(sim, I, 'resolved');
    } else if (s.closedCheckAt <= 0) s.closedCheckAt = sim.t;
  } else s.closedCheckAt = 0;
}

// (R3 3단계 CF7) 위험 실내로 들어가는 일인가 (판단부 — 믿음만)
import { inJob } from './doctrine';
/**
 * (R3 3단계 — 측정이 찾은 것) 짝 동행 중인 대원 b 에게 위험 실내 일 w 를 줄 수 있는가: w 가 위험 실내로 들어가는 일이고 그 구역이 b 의 짝이 맡은 일의 구역과 같거나 이웃이다
 * (짝이 곁의 방에서 일한다 — 짝 규칙(buddyOf)이 짝으로 치는 자리). 그러지 않으면 짝을 따라 들어간 대원이 그 자리에 묶여 실내의 손이 절반이 되었다. 믿음·작업판·동료의 겉만 읽는다
 */
/** (R3 CF3) 펌프 고장 — 진압 부대 교체를 이미 부른 펌프차 (사건마다 — 교체 한 대면 되므로 같은 차로 다시 부르지 않는다. 관제가 보낼 부대가 없으면 72초마다 같은 요청이 되풀이되었다 — tests/loops.test.ts) */
const CF3_ASKED = new WeakMap<Incident, Set<number>>();
function cf3Asked(I: Incident): Set<number> { let m = CF3_ASKED.get(I); if (m === undefined) { m = new Set(); CF3_ASKED.set(I, m); } return m; }
/**
 * (합치기 — 주 세션 결정 (나): 짝은 일하면서 함께 다닌다) 위험 실내 일 w 를 best 에게 맡긴 바로 그 자리에서, best 의 짝에게도 같은·이웃 구역의 위험 실내 일을 함께 준다 —
 * w 에 자리가 남았으면 그 둘째 자리(이송·구출·센 불의 진압은 둘이 맡는다), 아니면 곁의 빈 위험 실내 일(이웃 방의 수색·진압 …) 가운데 우선도가 가장 높은 것.
 * 짝이 손이 비었거나(짝 동행 포함) 바깥의 낮은 일(w 의 우선도 − 0.1 아래)을 하고 있을 때만. 맡길 일이 없으면 짝은 지금처럼 짝 동행(G08)으로 따라간다.
 * 짝이 순수한 따라가기로 손을 놓으면 실내의 일손이 절반이 되었다(강제 fire/std — 장면당 짝 동행 1.6명). 작업의 사람 수(max)는 그대로다. 믿음·작업판·동료의 겉·조직 정보만 읽는다
 */
/** 짝에게 함께 주는 일의 종류 — 둘이 같은 몫을 하는 일만 (구출·누출 조치는 장비·역할이 갈라 맡을 사람을 정한다: 짝에게 둘째 자리를 주면 유압 구조대원이 밀렸다 — tests/crews.test.ts ⑤) */
const PAIR_SLOT: ReadonlySet<WorkKind> = new Set<WorkKind>(['search', 'suppress', 'overhaul']);
function pairAssign(sim: Sim, s: Scene, a: FieldAgent, best: FieldAgent, w: WorkItem, items: WorkItem[], taken: Set<number>): void {
  const mid = best.buddy;
  if (mid === undefined || mid < 0 || taken.has(mid)) return;
  const m = s.agents.find((q) => q.rid === mid && q.status === 'active');
  if (!m || m === a || sim.units[m.unitId].boardOrder || m.carrying !== -1 || sim.responders[m.rid].status === 'injured') return;
  if (m.task && m.task.kind !== 'pair' && m.task.kind !== 'standby' && (docHolds(s, m) || m.task.workId < 0)) return;      // 상태 행동·휴식·장비 교체 … 중이면 두고 본다
  const cur = m.task && m.task.workId >= 0 ? s.board[m.task.workId] : m.orderWork >= 0 ? s.board[m.orderWork] : undefined;
  if (cur && (cur.status === 'open' || cur.status === 'active') && (inJob(sim, s, a, cur, m.task) || cur.priority >= w.priority - 0.1)) return;      // 자기 위험 실내 일·더 급한 바깥 일은 그대로
  // 짝이 먼저 맡을 일이 따로 열려 있으면(역할이 앞세우는 일 — 유압 구조대원의 구출 …) 그 일을 두고 짝을 데려가지 않는다 (tests/crews.test.ts ⑤)
  const pref = roleOf(sim, m.rid).prefer;
  for (const w3 of items) if ((pref[w3.kind] ?? 0) >= 0.2 && w3.assignees.length < w3.max && !taken.has(m.rid) && fitFor(sim, s, m, w3) > 0) return;
  let pick: WorkItem | null = null;
  for (const w2 of items) {
    if ((w2.status !== 'open' && w2.status !== 'active') || w2.assignees.length >= w2.max || w2.assignees.indexOf(m.rid) >= 0 || sim.t < w2.holdUntil) continue;
    if (!PAIR_SLOT.has(w2.kind) || !inJob(sim, s, a, w2) || !nearWork(s, a, w, w2) || failedRecently(sim, w2, m.rid)) continue;
    if (pick !== null && w2.priority <= pick.priority) continue;
    if (fitFor(sim, s, m, w2) <= 0) continue;
    pick = w2;
  }
  if (pick === null) return;
  taken.add(m.rid);
  pick.assignees.push(m.rid); pick.status = 'active'; pick.orderSentAt[m.rid] = sim.t;
  const mn = sim.responders[m.rid].name, bn = sim.responders[best.rid].name;
  transmit(sim, s, a, m.rid, 'order', [], `${mn}, ${workLabel(s, pick, sim)}${pick.kind === 'search' || pick.kind === 'suppress' || pick.kind === 'carry' ? ' 실시' : ' 맡아라'} — ${josa(bn, '과/와')} 짝으로.`, pick.id, pick.priority > 0.8 ? 1 : 0, pick.cause >= 0 ? [pick.cause] : []);
}
function pairTakes(sim: Sim, s: Scene, a: FieldAgent, b: FieldAgent, w: WorkItem): boolean {
  if (b.task === null || b.task.kind !== 'pair' || b.buddy === undefined || b.buddy < 0 || !inJob(sim, s, a, w)) return false;
  const m = s.agents.find((q) => q.rid === b.buddy && q.status === 'active');
  if (!m || !m.task || m.task.workId < 0) return false;
  const mw = s.board[m.task.workId];
  return mw !== undefined && nearWork(s, a, mw, w);
}
import { nearWork } from './doctrine';
