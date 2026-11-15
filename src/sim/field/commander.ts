// AI Field Commander — 현장 지휘관.
// 지휘관은 자신의 믿음(직접 본 것 + 무전 보고 + 관제 브리핑)만으로 작업 목록(board)을 만들고,
// 대원에게 임무를 나눠 주고, 지원을 요청하고, 종료를 판단한다. 진실 상태는 읽지 않는다.

import type { Sim } from '../engine';
import { emit, raiseProblem } from '../events';
import { closeIncident } from '../incidents';
import { T } from '../types';
import type { CasBelief, FieldAgent, Incident, MateBelief, Scene, UnitCaps, WorkItem, WorkKind } from '../types';
import { TYPE_NAME, dist, josa } from '../util';
import { TYPE_DEFS } from '../incidentTypes';
import { airShort, capableOf, crewHasKit, fieldCrew, hasFirearm, hasKit, isHovering, kitUses, roleOf, seatsOf, seatsUsed } from '../crews';
import { canCarryPatients, exitName, failedRecently, fitFor, hasWork, learn, resp, transmit, workLabel } from './agents';
import { heardEv, mkFact } from './beliefs';
import { losWalls } from './grid';
import { BAND_NAME, HOSTILE_FOV } from './hazards';
import { hosNeedsCare, mateNeedsHospital } from './injury';
import { CAS_HOLDS, CLOSE_BLOCKERS, ORDER_RULES, PROP_HOLDS } from './sceneRegistry';
import type { CommandKit } from './sceneRegistry';

interface Target { region?: number; cas?: number; prop?: number; hostile?: number; tile?: number; mate?: number; animal?: number }      // animal: (N8) 대상 동물

function want(sim: Sim, s: Scene, kind: WorkKind, tg: Target, priority: number, max = 1, thorough = false, cause = -1): WorkItem {
  const region = tg.region ?? -1, cas = tg.cas ?? -1, prop = tg.prop ?? -1, hostile = tg.hostile ?? -1, tile = tg.tile ?? -1, mate = tg.mate ?? -1, animal = tg.animal ?? -1;
  for (const w of s.board) {
    if (w.kind !== kind || (w.status !== 'open' && w.status !== 'active')) continue;
    if (w.region === region && w.cas === cas && w.prop === prop && w.hostile === hostile && w.tile === tile && w.mate === mate && (w.animal ?? -1) === animal) {
      w.priority = priority; w.max = max; if (thorough) w.thorough = true;
      return w;
    }
  }
  const w: WorkItem = {
    id: s.nextWorkId++, kind, region, cas, prop, hostile, tile, mate, priority, status: 'open', assignees: [], max,
    createdAt: sim.t, doneAt: -1, note: '', fails: 0, holdUntil: 0, thorough, orderSentAt: {}, cause, failedAt: {}, animal,
  };
  s.board.push(w);
  return w;
}

function cancel(s: Scene, pred: (w: WorkItem) => boolean): void {
  for (const w of s.board) if ((w.status === 'open' || w.status === 'active') && pred(w)) w.status = 'cancelled';
}

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

function request(sim: Sim, s: Scene, I: Incident, a: FieldAgent, need: keyof UnitCaps, reason: string, urgent: boolean): void {
  if (s.requests.some((q) => q.need === need && (q.fulfilled < q.count || sim.t - q.t < 70))) return;
  const label: Record<string, string> = { suppression: '진압 부대', rescue: '구조 장비 부대', ems: '구급 부대', law: '경찰 부대', tactical: '경찰 기동 부대', search: '수색 인력', traffic: '교통 통제 인력', eod: '폭발물 처리반' };
  const ev = transmit(sim, s, a, -2, 'request', [], `관제, ${label[need]} 추가 지원 요청. 사유: ${reason}.`, -1, 2, [I.lastEvent]);
  if (ev < 0) return;     // 음영 구역 — 다음 계획 주기에 재시도
  s.requests.push({ t: sim.t, need, count: 1, reason, eventId: ev, fulfilled: 0, urgent });
}

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
const NEED_MIN: Record<keyof UnitCaps, number> = { suppression: 0.7, rescue: 0.5, ems: 0.7, law: 0.5, tactical: 0.9, search: 0.3, traffic: 0.4, eod: 0.9 };

/** 이 작업을 할 수 있는 대원을 보내 줄 부대의 능력. 아무나 할 수 있는 일이면 null */
function needFor(s: Scene, w: WorkItem, hotArmed: boolean): keyof UnitCaps | null {
  switch (w.kind) {
    case 'suppress': case 'hookup': case 'overhaul': return 'suppression';
    case 'mitigate': return w.prop >= 0 && s.props[w.prop] && s.props[w.prop].kind === 'unstable' ? 'rescue' : 'suppression';
    case 'extricate': case 'waterRescue': case 'clear': case 'force': return 'rescue';
    case 'treat': case 'load': return 'ems';
    case 'carry': case 'escort': return hotArmed ? 'law' : 'rescue';      // 위험한 건물 안은 소방만, 안전 확보 전의 무장 현장은 경찰만
    case 'search': return hotArmed ? 'law' : 'rescue';
    case 'perimeter': case 'engage': case 'arrest': case 'negotiate': return 'law';
    case 'rescueMate': return hotArmed ? 'law' : 'rescue';      // 쓰러진 동료: 안전 확보 전의 무장 현장은 경찰만, 위험한 건물 안은 공기호흡기를 멘 대원만 들어간다 (fitFor)
    case 'defuse': return 'eod';
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
  return I.assigned.some((uid) => {
    const u = sim.units[uid];
    return (u.state === 'enroute' || u.state === 'turnout') && u.caps[need] >= NEED_MIN[need] && fieldCrew(sim, u).some((rid) => sim.responders[rid].status === 'ok' && capableOf(sim, rid, w.kind));
  });
}

/** 믿음 → 작업 목록 */
function syncBoard(sim: Sim, s: Scene, I: Incident, a: FieldAgent): void {
  const B = a.beliefs;
  const cas = B.list('cas');
  const fires = B.list('fire');
  const hos = B.list('hos');
  // 무장 사건의 인원 문턱에 드는 사람: 총기를 든 활동 중인 경찰. 폭발물 처리 요원·로봇 조작 요원은 (권총이 있어도) 역할로 뺀다
  // 걸을 수 있는 다친 경관(조직이 아는 상태)은 문턱에 넣지 않는다: 봉쇄는 서도 진입·검거는 맡지 못한다 (가벼운 일만 — agents.fitFor)
  const armedCops = s.agents.filter((b) => b.status === 'active' && sim.responders[b.rid].dept === 'police' && hasFirearm(sim, b.rid) && roleOf(sim, b.rid).group !== 'bomb');
  const police = armedCops.filter((b) => sim.responders[b.rid].status !== 'injured');
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
  for (const h of surrendered) want(sim, s, 'arrest', { hostile: h.id }, 0.93, 1, false, heardEv(h));
  for (const h of active) {
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
      if (h.value.state === 'fight' && police.length >= 2) {
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
        if (I.problems.some((p) => p.detail === '시한이 지나 인질이 다침') && police.length >= 2) why = '인질이 다쳐 더 기다릴 수 없음';
        else if (hasBang && police.length >= 3 && waited > 18) why = '섬광탄을 가진 기동대가 도착해 진입 조건이 갖춰짐';
        else if (waited > 125 && police.length >= 3) why = '협상이 길어져 시한이 임박';
        if (!I.assigned.some((uid) => sim.units[uid].caps.tactical >= 0.9)) request(sim, s, I, a, 'tactical', '인질 사건 — 섬광탄을 가진 기동대 필요', true);
      } else if (crit && police.length >= 2 && waited > 12) why = '내부에 위중한 부상자가 있어 더 기다릴 수 없음';
      else if (fighting && police.length >= 2 && waited > 8 && cas.some((c) => c.value.where === 'scene' && c.value.band >= 1 && c.value.band < 3)) why = '총격이 이어지고 내부에 부상자가 있음';
      else if (fighting && police.length >= 3 && waited > 22) why = '용의자가 계속 발포하고 협상에 응하지 않음';
      else if (waited > 60 && police.length >= 3) why = '협상에 진전이 없고 진입 인원이 확보됨';
      else if (waited > 100 && police.length >= 2) why = '장시간 대치로 더 이상의 지연은 위험';
      if (why) {
        s.entryOrdered = true; s.breachAt = sim.t + 9; s.breachDone = false;
        const plan = planEntry(s, h.value);
        s.entryExit = plan.exit;
        // 인원이 넉넉하면 두 문으로 나눠 동시에 들어간다 (용의자는 한쪽만 볼 수 있다)
        const two = police.length >= 4 && s.exits.length >= 2;
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
  const cordon = (s.kind === 'hazmat' && B.list('haz').some((f) => f.value.kind === 'leak' && f.value.active)) || liveBomb;
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
      const zones = s.regions.filter((r) => r.kind === 'zone');
      let maxP = 0; for (const z of zones) maxP = Math.max(maxP, s.zoneProb[z.id]);
      for (const z of zones) {
        const c = B.val<number>('srch', z.id) ?? -1;
        if (c >= th) continue;
        pendingSearch++;
        want(sim, s, 'search', { region: z.id }, 0.36 + 0.5 * (s.zoneProb[z.id] / (maxP || 1)), 1, s.researchRound > 0 || c >= 0);
      }
      if (pendingSearch === 0 && s.researchRound < 3) {
        s.researchRound++;
        // 모든 구역을 봤는데도 못 찾았다 → 놓쳤다고 보고 확인율을 낮춰 정밀 재수색
        const redo = [];
        for (const z of zones) { const f = B.get('srch', z.id); if (f) { const nf = mkFact('srch', z.id, Math.min(f.value, 0.45), '지휘관 재평가', sim.t, 0.5, true, `${z.name} 재수색 필요`); B.merge(nf); redo.push(nf); } }
        if (redo.length) transmit(sim, s, a, -1, 'report', redo, '', -1, 0, [], true);
        raiseProblem(sim, I, 'VICTIM_MISSED', '전 구역 1차 수색에서 대상을 찾지 못함', { role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, imp: 2, text: `전 구역을 수색했지만 대상을 찾지 못했습니다. 탐색 범위를 재조정하고 간격을 좁혀 정밀 재수색합니다 (${s.researchRound}차).` }, false);
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
  const loadsQueued = (uid: number): number => { let n = 0; for (const w of s.board) if ((w.kind === 'load' || w.kind === 'treatMate' || w.kind === 'treatSuspect') && w.prop === uid && (w.status === 'open' || w.status === 'active')) n++; return n; };      // 다친 대원·용의자의 후송(treatMate·treatSuspect 의 prop)도 자리를 맡아 둔다
  // 처치를 두 번 마쳤는데(기본 처치 + 구급대원이 다시 봄) 아직 기본 처치로 보고된다: 현장의 구급대원이 더 해 줄 수 있는 처치가 없다.
  // (구급대원은 자기가 더 낫게 할 수 없으면 손대지 않고 상태만 다시 보고한다 — 그대로 두면 같은 처치 지시와 같은 보고를 끝없이 주고받는다)
  const treatsDone = (cid: number): number => { let n = 0; for (const w of s.board) if (w.kind === 'treat' && w.cas === cid && w.status === 'done') n++; return n; };
  for (const f of cas) {
    const c = f.value as CasBelief;
    if (CAS_HOLDS.length && CAS_HOLDS.some((h) => h(sim, s, a, f.id, c))) continue;      // (N8) 보류: 묶음 규칙이 맡은 사람(위험 반경 안·높은 자리)에게는 핵심 규칙이 일을 내지 않는다 — 줄이 없으면 그대로
    const dead = c.band === 3;
    const clear = (kinds: WorkKind[]) => cancel(s, (w) => w.cas === f.id && kinds.indexOf(w.kind) >= 0 && !(w.kind === 'carry' && w.status === 'active' && s.agents.some((b) => b.carrying === f.id)));
    if (dead || c.where === 'loaded' || c.where === 'hospital') {
      clear(['extricate', 'treat', 'carry', 'load', 'hoist']);
      // 호이스트로 물에서 곧바로 실려 간 사람: 지상의 수난 구조 지시도 거둔다 (지상에서 건진 사람은 그 작업이 이미 끝나 있다)
      if (!dead) cancel(s, (w) => w.kind === 'waterRescue' && w.cas === f.id);
      continue;
    }
    const urg = c.band * 0.06;
    const cev = heardEv(f);      // (I1-b) 이 구조 대상 소식을 실어 온 무전 기록 — 아래 작업의 원인 (기록만)
    const afloat =c.where === 'scene' && c.mob === 'trapped' && s.tiles[c.y * s.w + c.x] === T.WATER;      // 물속에 있다고 믿는다
    if (hoistUp && !afloat) cancel(s, (w) => w.kind === 'hoist' && w.cas === f.id);      // 물 밖으로 나왔다
    // 총을 든 용의자 바로 곁에 있는 사람(인질)은 위협이 사라지기 전에는 손댈 수 없다
    if (c.where === 'scene' && active.some((h) => h.value.weapon === 'gun' && Math.hypot(h.value.x - c.x, h.value.y - c.y) <= 3.6)) { clear(['treat', 'carry', 'extricate']); continue; }
    if (c.where === 'scene') {
      if (afloat) {
        want(sim, s, 'waterRescue', { cas: f.id }, 0.9 + urg, 2, false, cev);      // 물속: 물가에서 줄을 던져 끌어낸다
        if (hoistUp) want(sim, s, 'hoist', { cas: f.id }, 0.92 + urg, 1, false, cev);      // 상공에 호이스트를 단 헬기가 있으면 함께 낸다 — 먼저 끝나는 쪽이 이긴다
        continue;
      }
      // 갇혀 있다: 구출이 먼저다. 갇히기 전에 낸 이송·동행 지시는 거둔다 (2차 붕괴로 다시 갇힌 사람 — 두면 '대상이 그 위치에 없다'는 실패가 구출이 끝날 때까지 되풀이된다)
      if (c.mob === 'trapped') { clear(['carry', 'escort']); want(sim, s, 'extricate', { cas: f.id }, 0.82 + urg, 2, false, cev); continue; }
      if (c.mob === 'mobile') {                // 스스로 대피 중 — 한참 지나도 도착 보고가 없으면 확인하러 보낸다
        if (sim.t - f.t > 32) want(sim, s, 'escort', { cas: f.id }, 0.62 + urg, 1, false, cev);
        continue;
      }
      const rg = s.region[c.y * s.w + c.x];
      const indoorHazard = s.kind === 'fire' || s.kind === 'hazmat' || s.kind === 'collapse' || (rg >= 0 && (B.val<number>('fire', rg) ?? 0) > 0.1);
      const hasMedic = s.agents.some((b) => b.status === 'active' && sim.responders[b.rid].dept === 'ems');
      // 처치가 필요한가: 아직 아무 처치도 못 받았거나, 기본 처치만 받았는데 구급대원이 와 있다
      const needTreat = c.band >= 1 && (c.tq === 0 || (c.tq === 1 && hasMedic && treatsDone(f.id) < 2));
      const treatHere = hasMedic || (s.kind === 'medical' && c.tq === 0);      // 응급 환자는 누구든 먼저 손을 쓴다
      if (!indoorHazard && needTreat && treatHere && !hotArmed) { want(sim, s, 'treat', { cas: f.id }, 0.8 + urg, 1, false, cev); want(sim, s, 'carry', { cas: f.id }, 0.5, 2, false, cev); }
      else { cancel(s, (w) => w.kind === 'treat' && w.cas === f.id && w.status === 'open'); want(sim, s, 'carry', { cas: f.id }, 0.84 + urg, 2, false, cev); }
    } else if (c.where === 'safe') {
      if (c.band >= 1 && (c.tq === 0 || (c.tq === 1 && hasMedicAny && treatsDone(f.id) < 2))) want(sim, s, 'treat', { cas: f.id }, 0.72 + urg, 1, false, cev);
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
            if (seatsUsed(sim, q) + loadsQueued(uid) < seatsOf(q)) { best = uid; break; }
          }
          if (best >= 0) want(sim, s, 'load', { cas: f.id, prop: best }, (c.treated ? 0.7 : 0.5) + urg, 1, false, cev);
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
  else if (fireRegions > 0 && dry) request(sim, s, I, a, 'suppression', '진압 부대의 용수가 떨어짐', true);
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
  if (gunActive && lawUnits < 2) request(sim, s, I, a, lawUnits === 0 ? 'law' : 'tactical', '총기를 소지한 용의자와 대치 중, 인원 부족', true);
  else if (active.length > 0 && lawUnits === 0) request(sim, s, I, a, 'law', '용의자 대응 인력 없음', true);
  else if (active.length > 0 && lawUnits === 1 && s.negotStart >= 0 && sim.t - s.negotStart > 22) request(sim, s, I, a, 'law', '한 팀으로는 말을 걸면서 붙잡을 수 없음', false);      // 한 사람은 말을 걸고 한 사람은 길목을 지키면 붙잡을 손이 없다
  if (cordon && lawUnits === 0 && s.sizeupDone) request(sim, s, I, a, 'law', liveBomb ? '폭발물로 보이는 물건이 있는 건물 주변을 통제할 인력이 없음' : '가스가 새는 건물 주변을 통제할 인력이 없음', false);
  // 무장 사건 현장은 안전을 확보하기 전까지 경찰만 수색할 수 있다
  if (hotArmed && pendingSearch > 0 && lawUnits === 0 && s.sizeupDone) request(sim, s, I, a, 'law', '건물 안을 수색해 안전을 확보할 경찰이 없음', true);
  if (s.laneRows.length && lawUnits === 0 && !s.controlDone.every(Boolean) && cas.length > 0 && s.sizeupDone) request(sim, s, I, a, 'traffic', '차량 통행이 계속되는데 교통 통제 인력이 없음', false);
  if (s.kind === 'search' && cas.length === 0 && s.arrivedAt >= 0 && sim.t - s.arrivedAt > 75 && countUnits(sim, s, I, 'search', 0.3) < 3) request(sim, s, I, a, 'search', '수색 범위에 비해 인력 부족', false);
  // 맡을 사람이 없는 작업: 한참 열려 있는데 현장의 누구도 맡을 수 없고, 그 일을 할 부대도 오고 있지 않으면 그 능력의 부대를 부른다
  // (예: 헬기 대원만 있는 가스 누출 현장의 밸브 차단, 경찰이 모두 떠난 무장 현장의 수색)
  for (const w of s.board) {
    if (w.status !== 'open' || w.assignees.length || sim.t - w.createdAt < 20 || sim.t < w.holdUntil) continue;
    const need = needFor(s, w, hotArmed);
    if (!need) continue;
    if (w.kind === 'rescueMate' && B.val<MateBelief>('mate', w.mate)?.dead) continue;      // 숨진 동료의 수습 때문에 다른 곳의 부대를 부르지 않는다 (맡을 사람이 생기면 하고, 없으면 종료도 막지 않는다 — recoveryStuck)
    if (anyCapable(sim, s, I, w, need)) continue;
    request(sim, s, I, a, need, `${josa(workLabel(s, w, sim), '을/를')} 맡을 대원이 없음`, w.priority >= 0.85);
    break;
  }
  // ── 묶음별 지휘 규칙 (field/orders/*) ──
  if (ORDER_RULES.length) {
    const kit: CommandKit = {
      want: (kind, tg, priority, max = 1, thorough = false) => want(sim, s, kind, tg, priority, max, thorough),
      cancel: (pred) => cancel(s, pred),
      request: (need, reason, urgent) => request(sim, s, I, a, need, reason, urgent),
      countUnits: (need, min) => countUnits(sim, s, I, need, min),
      unitsOnScene: () => unitsOnScene(sim, s),
    };
    for (const rule of ORDER_RULES) rule(sim, s, I, a, kit);
  }
}

/** 작업 배정 */
function assign(sim: Sim, s: Scene, I: Incident, a: FieldAgent): void {
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
  for (let pass = 0; pass < 2; pass++) {
    for (const w of items) {
      if (pass === 0 && w.assignees.length > 0) continue;
      if (pass === 1 && (w.assignees.length === 0 || w.assignees.length >= w.max)) continue;
      let best: FieldAgent | null = null, bs = 0;
      for (const b of s.agents) {
        if (b.status !== 'active' || taken.has(b.rid) || w.assignees.indexOf(b.rid) >= 0) continue;
        if (sim.units[b.unitId].boardOrder) continue;
        if (b.task && b.task.kind === 'rehab' && sim.responders[b.rid].stamina < 40) continue;      // 지친 대원은 어느 정도 회복할 때까지 지시를 받지 않는다 (brain.ts 의 휴식 붙잡기)
        if (b.task && (b.task.kind === 'resupply' || b.task.kind === 'swapAir')) continue;      // 예비 장비·공기통으로 바꾸는 중(8~11초 남짓): 끝날 때까지 기다린다. 지시로 빼 오면 교체를 처음부터 다시 시작하며 같은 말을 되풀이한다
        if (sim.responders[b.rid].status === 'injured' && !lightDuty(a, b)) continue;      // 부상을 알린 대원은 후퇴 중이다 (brain.ts 의 부상 후퇴 붙잡기) — 지시해도 받지 못하고 재지시만 되풀이된다. 가벼운 일을 한다고 알린 다친 대원에게는 지시한다(맡을 수 있는 일은 fitFor 가 거른다). 조직이 아는 상태와 믿음만 본다 — 남의 체력을 읽지 않는다
        if (failedRecently(sim, w, b.rid)) continue;      // 이 작업에 닿지 못했거나 위험해서 물러난 대원: 한동안 다른 대원에게 맡기거나 기다린다
        const fit = fitFor(sim, s, b, w);
        if (fit <= 0) continue;
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
        if (sc > bs) { bs = sc; best = b; }
      }
      if (!best) continue;
      taken.add(best.rid);
      w.assignees.push(best.rid); w.status = 'active'; w.orderSentAt[best.rid] = sim.t;
      const br = sim.responders[best.rid];
      if (best === a) { a.orderWork = w.id; continue; }
      const redo = w.fails > 0 ? ' (재지시)' : '';
      transmit(sim, s, a, best.rid, 'order', [], `${br.name}, ${workLabel(s, w, sim)}${w.kind === 'search' || w.kind === 'suppress' || w.kind === 'carry' ? ' 실시' : ' 맡아라'}${redo}.`, w.id, w.priority > 0.8 ? 1 : 0, w.cause >= 0 ? [w.cause] : []);
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
    hostile: B.list('hos').some((h) => h.value.state === 'hold' || h.value.state === 'fight' || h.value.state === 'flee' || h.value.state === 'surrendered'),
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
