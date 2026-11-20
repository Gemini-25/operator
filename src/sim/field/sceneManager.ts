// FieldSceneManager — 현장 공간의 생성과 매 틱 갱신.
// 현장은 사건이 "발생한 순간"부터 살아 있다. 부대가 도착하기 전에도 불은 번지고 부상자는 악화된다.

import { fieldReport } from '../dispatch/dispatcher';
import type { Sim } from '../engine';
import { emit, raiseProblem } from '../events';
import { closeIncident } from '../incidents';
import { noteRoadCause } from '../traffic';      // (I1-b b3-5) 통제 기록을 교통의 장부에
import { noteDeparture, releaseUnit, startTransport, transportWhy } from '../resources';
import { scenarioOf } from '../scenarios';
import { TYPE_DEFS } from '../incidentTypes';
import { AIR_LOW, fieldCrew, hasKit, isHovering, kitUses, roleOf, useKit } from '../crews';
import './scenes';
import { PENDING_RULES, SCENE_RULES } from './sceneRegistry';
import type { FieldAgent, Incident, MateBelief, Scene, Unit, UnitCaps } from '../types';
import { fmtSec, josa } from '../util';
import { BeliefStore, mergeHeard } from './beliefs';
import { briefFacts, flushOutbox, learn, learnQuiet, makeAgent, mateFact } from './agents';
import { think } from './brain';
import { outstanding, riderText } from './commander';
import { buildScene } from './builders';
import { act, finishTask } from './executor';
import { staticPass, tileOf } from './grid';
import { tickCasualties, tickCollapse, tickCrush, tickFire, tickGas, tickHostiles, tickLane, tickLeaks, tickLift, tickMedical, tickWander, tickWater } from './hazards';
import { CAUSE_NAME, DOWN_AT, canDeploy, hurtCauseNow, hurtResponder, initInjuries, mustRetreat, needsHospital, smokeCause, woundTick } from './injury';
import type { HurtOpts } from './injury';

/**
 * (N8 단계 2a — 설계서 §5.7) 남은 일 등록의 답: 줄 가운데 처음으로 null 이 아닌 수요. 그 수요를 채울 부대(능력 0.7 이상)가 이미 이 사건에 배정돼
 * 현장에 있거나 오는 중이면 그 수요 대신 통제 부대(현장의 주관 분야가 소방이면 진압, 그 밖은 경찰)를 부른다 — 와 있는 복구반은 지휘할 부대가 없어 일을 못 하고,
 * 그 부대를 다시 부르면 onscene 이라 배정되지 않아 NO_UNIT·지원 요청이 되풀이된다. 줄은 믿음만 읽는다(orders/<묶음>.ts). 줄이 없으면 null
 */
function pendingNeed(sim: Sim, s: Scene, I: Incident, last: FieldAgent): keyof UnitCaps | null {
  let need: keyof UnitCaps | null = null;
  for (const rule of PENDING_RULES) { need = rule(sim, s, last); if (need !== null) break; }
  if (need === null) return null;
  const k = need;
  const here = I.assigned.some((uid) => { const u = sim.units[uid]; return u.caps[k] >= 0.7 && (u.state === 'onscene' || u.state === 'enroute' || u.state === 'turnout'); });
  return here ? (s.leadDept === 'fire' ? 'suppression' : 'law') : need;
}

export function createScene(sim: Sim, I: Incident): Scene {
  const s = buildScene(sim, I, sim.rng.fork('scene:' + I.id));
  initInjuries(sim, s, I);      // (H1) 처음부터 다쳐 있는 사람의 원인을 적는다 — 기록만, 난수를 부르지 않는다
  s.allIdleSince = -1; s.rollCallAt = -1e9;      // 지휘관이 쓰는 칸은 만들 때 채워 둔다 (도중에 속성이 생기면 현장 객체의 모양이 바뀌어 매 틱 도는 코드가 느려진다)
  s.air = []; s.light = null; s.airAt = -1;      // (R1) 상공의 헬기가 쓰는 칸 — 쓰는 것은 단계 4·5 부터
  sim.scenes[I.id] = s;
  return s;
}

export function unitArrived(sim: Sim, I: Incident, u: Unit): void {
  const s = sim.scenes[I.id]!;
  // (I2) 결원 도착: 지난 교대에서 이어받은 결장(off)이 있는 부대면 도착 기록의 원인을 이어받은 상태 요약 기록으로 잇는다 (문구 그대로 — causes 는 해시에 들지 않는다. 이어받은 상태가 없으면 off 가 없다)
  const shortEv = sim.carryState.on && u.crew.some((rid) => sim.responders[rid].status === 'off') ? [sim.carryState.event] : undefined;
  if (isHovering(u, s)) {
    // 상공에 머무는 부대(경찰 헬기 …): 아무도 내리지 않는다. 지휘관이 되지 않고, 현장 도착 시각(s.arrivedAt·I.firstArrivalAt)도 정하지 않는다 —
    // 상공 도착은 s.airAt 에만 적는다. 한계 시간과 방치는 둘 가운데 먼저인 시각부터 재고(onAt), 무대응 종료는 둘 다 없을 때만이다
    if ((s.airAt ?? -1) < 0) s.airAt = sim.t;
    emit(sim, { inc: I.id, role: 'UNIT', actor: u.callsign, kind: 'arrive', imp: 2, causes: shortEv, text: `${u.callsign} 현장 상공 도착.` });
    return;
  }
  // 현장 도착 시각은 지상 대원이 처음 내릴 때 정한다 (설계서 R1 6.1). 유관 기관(civil — N8 §5.3.2)은 첫 도착으로 세지 않는다:
  // 한계 시간의 시계(onAt)와 판정의 대응 시간이 복구반 도착으로 시작되지 않는다 (혼자 먼저 닿으면 resources.arrive 가 길가에서 기다리게 한다)
  const firstGround = s.arrivedAt < 0 && u.dept !== 'civil';
  if (firstGround) { s.arrivedAt = sim.t; I.firstArrivalAt = sim.t; I.phase = 'onscene'; }
  const node = sim.city.nodes[I.truth.nodeId];
  const slot = I.everAssigned.indexOf(u.id);
  if (!u.curb && !u.air && !u.sea) { u.x = node.x + 16 * Math.cos(slot * 1.3); u.y = node.y + 16 * Math.sin(slot * 1.3); u.px = u.x; u.py = u.y; }      // 건물 앞 길가에 세운 차량은 그 자리에 둔다
  const brief = briefFacts(sim, I);
  const cmd = s.agents.find((a) => a.rid === s.commanderRid && a.status === 'active');
  const prevCmd = s.agents.find((a) => a.rid === s.commanderRid);
  // 내리는 사람: 내리는 자리(조종사·정장은 차에 남는다) 가운데 걸을 수 있는 대원 — 온전한 대원과 걸을 수 있는 다친 대원 (배정의 crewReady 와 같은 술어).
  // 다친 대원은 가벼운 일만 맡는다 (agents.fitFor). 쓰러진 대원·병원으로 후송된 대원은 내리지 않는다
  const crew = fieldCrew(sim, u).filter((rid) => canDeploy(sim.responders[rid]));
  s.agents = s.agents.filter((a) => u.crew.indexOf(a.rid) < 0);      // 같은 대원이 다시 온 경우 이전 기록 정리
  crew.forEach((rid, k) => {
    const r = sim.responders[rid];
    const n = s.agents.length;
    // 내리는 자리: 대기 지점 둘레에 다섯 칸 × 세 줄. 그 칸에 설 수 없으면(벽·물·격자 밖) 대기 지점에 그대로 선다
    let ax = s.staging.x + (n % 5) * 0.7 - 1.4, ay = s.staging.y + (Math.floor(n / 5) % 3) * 0.7;
    if (ax < -0.5 || ay < -0.5 || ax >= s.w - 0.5 || ay >= s.h - 0.5 || !staticPass(s.tiles[tileOf(s, ax, ay)])) { ax = s.staging.x; ay = s.staging.y; }
    const a = makeAgent(sim, rid, u.id, ax, ay, sim.t + 0.4 + k * 0.3, sim.rng.fork(`agent:${I.id}:${rid}`));
    for (const f of brief) a.beliefs.merge(f);
    if (cmd) for (const f of cmd.beliefs.all()) a.beliefs.merge(BeliefStore.relay(f));
    else if (prevCmd) for (const f of prevCmd.beliefs.all()) a.beliefs.merge(BeliefStore.relay(f));      // 관제가 이전 지휘관의 보고를 전달
    if (r.status === 'injured') a.label = '부상 — 가벼운 일';
    s.agents.push(a);
    r.incidentsWorked++;
  });
  pairUp(sim, s, u);      // (R3 §5.1) 짝 맺기 — 부대가 내린 뒤 한 번 (역할 쌍, 최소 인원 부대는 min 열)
  // 누가 내렸는가: 실제로 내린 사람의 첫째(역할과 이름)와 나머지 인원. 한 명이면 이름만
  const names = crew.length > 1 ? `${roleOf(sim, crew[0]).name} ${sim.responders[crew[0]].name} 외 ${crew.length - 1}명` : crew.length ? sim.responders[crew[0]].name : '';
  const took = I.reportedAt >= 0 ? Math.round(sim.t - I.reportedAt) : 0;
  emit(sim, { inc: I.id, role: 'UNIT', actor: u.callsign, kind: 'arrive', imp: firstGround ? 3 : 2, causes: shortEv, text: firstGround ? `${u.callsign} 현장 도착 (${names}). 신고 접수 후 ${took}초.` : `${u.callsign} 현장 합류 (${names}).` });
  if (firstGround) divertArrived(sim, I);      // (I1-b C6) 이 사건으로 오던 부대를 빼앗긴 적이 있으면: 첫 도착이 예정보다 얼마나 늦었는가 (DIVERTED 의 ref.lost, 10초 넘으면 기록)
  if (!crew.length) return;
  // 다친 채 내린 대원은 자기 상태를 알린다(소리 없이): 지휘관이 가벼운 일만 맡길 수 있는 대원임을 안다
  for (const rid of crew) if (sim.responders[rid].status === 'injured') { const b = s.agents.find((q) => q.rid === rid)!; learnQuiet(sim, b, mateFact(sim, s, b, 'light', sim.responders[rid].name, 0)); }
  const senior = s.agents.find((a) => a.rid === crew[0])!;
  if (!cmd) {
    if (u.dept !== 'civil') setCommander(sim, s, I, senior, '현장 지휘를 맡습니다. 현장 평가부터 실시합니다.');      // (N8) 유관 기관은 지휘하지 않는다
  } else if (sim.responders[cmd.rid].dept !== s.leadDept && u.dept === s.leadDept) {
    for (const f of cmd.beliefs.all()) senior.beliefs.merge(BeliefStore.relay(f));
    cmd.isCommander = false;
    // 주관 부서가 아닌 대원이 멀리서 한 현장 평가는 다시 한다
    if (s.sizeupDone) { s.sizeupDone = false; s.mismatchLogged = false; }
    setCommander(sim, s, I, senior, `${sim.responders[cmd.rid].name}에게서 지휘권을 인수합니다. 현재까지의 상황을 인계받았습니다.`);
  }
}

function setCommander(sim: Sim, s: Scene, I: Incident, a: FieldAgent, text: string): number {
  for (const b of s.agents) b.isCommander = false;
  a.isCommander = true; s.commanderRid = a.rid; a.planT = sim.t + 0.6;
  // 현장 평가는 지휘관 본인이 한다. 이전 지휘관이 하던 평가는 중단시킨다.
  if (!s.sizeupDone) for (const w of s.board) if (w.kind === 'sizeup' && (w.status === 'open' || w.status === 'active')) w.status = 'cancelled';
  return emit(sim, { inc: I.id, role: 'COMMANDER', actor: sim.responders[a.rid].name, rid: a.rid, kind: 'command', imp: 2, text });      // 기록 id (R3 CE5 의 교본 기록이 쓴다)
}

const ROLL_CALL: Record<string, boolean> = { cas: true, hos: true, haz: true, mate: true, fire: true, srch: true, ovh: true, ctl: true, evid: true, sign: true };

function deliverRadio(sim: Sim, s: Scene, I: Incident): void {
  if (!s.radio.length) return;
  for (let k = 0; k < s.radio.length; k++) {
    const m = s.radio[k];
    if (m.deliverAt > sim.t) continue;
    s.radio.splice(k--, 1);
    if (m.to === -2) { fieldReport(sim, I, s, m); continue; }
    for (const b of s.agents) {
      if (b.rid === m.from) continue;
      if (b.status !== 'active' && b.status !== 'withdrawn') continue;
      if (m.to >= 0 && b.rid !== m.to) continue;
      if (s.shadow[tileOf(s, b.x, b.y)]) continue;      // 음영 구역의 대원은 듣지 못한다
      if (b.isCommander) for (const f of m.facts) mergeHeard(b.beliefs, BeliefStore.relay(f), m.eventId);      // (I1-b) 지휘관은 사실을 실어 온 무전 기록을 기억한다 (작업 원인 — 기록만)
      else for (const f of m.facts) b.beliefs.merge(BeliefStore.relay(f));
      // (X6 §3.5) 단계를 낮추는 조짐(down)을 들은 대원은 자기 관찰의 기억도 그 단계로 고친다 (무너진 구획의 "임박"을 다시 "올라감"으로 착각하지 않게)
      for (const f of m.facts) if (f.type === 'sign' && f.value.down) (b.signObs ?? (b.signObs = {}))[f.id] = f.value.level;
      if (m.kind === 'rollcall' && b.status === 'active') {
        // 확인 무전: 자기가 알고 있는 상황을 다시 보고한다 (음영 구역에서 지휘관이 놓친 보고를 되살린다). 무전 문구는 남기지 않는다
        for (const f of b.beliefs.all()) if (ROLL_CALL[f.type]) { b.quiet.add(f.key); learn(sim, b, f, true, true); }
      }
      if (m.kind === 'order' && m.to === b.rid) {
        const w = s.board[m.workId];
        if (w && (w.status === 'open' || w.status === 'active')) b.orderWork = m.workId;
      }
    }
  }
}

/** 매 틱 피해 (문턱·출혈 없음) — 틱마다 객체를 새로 만들지 않는다 */
const TICK: HurtOpts = { tick: true };
/** 처치를 받고 안전 구역에 물러나 있는 대원의 상처 악화 배율 (§2.6) */
export const SAFE_BLEED = 0.6;

/**
 * 대원의 몸: 선 칸의 연기·불이 주는 피해, 상처의 악화, 그리고 상태 전이(부상 → 쓰러짐 → 순직). 전이는 이 한 곳에서만 한다 (설계서 H1 §3.2).
 * 방호는 부서가 아니라 든 장비가 정한다(injury.protection): 공기호흡기(연기), 방화복(불).
 * 공기호흡기의 공기는 연기 속(0.25 초과)에 있는 동안만 준다 — 체력이 좋을수록 천천히(초당 1.25 − 0.5 × fitness).
 * 공기가 떨어지면 공기호흡기의 연기 방호가 없다(메지 않은 사람과 같은 피해). 방호가 남은 공기를 읽으므로 소모가 먼저다.
 * 여기서는 사실만 기록한다 — 바꾸러 갈지, 물러날지는 대원의 판단(brain.ts)이다.
 * 숨진 대원은 더 바뀌지 않고, 사건이 끝난 뒤(판정 뒤)에는 악화도 전이도 없다 (§2.6).
 */
export function agentHealth(sim: Sim, s: Scene, I: Incident, a: FieldAgent): void {
  if (a.status === 'left') return;
  const r = sim.responders[a.rid];
  if (r.dead) return;
  if (I.phase === 'closed') return;
  const i = tileOf(s, a.x, a.y);
  const smoke = s.smoke[i], fire = s.fire[i];
  if (smoke > 0.25) {
    a.smokeT += sim.dt;
    let scba = hasKit(sim, a.rid, 'scba');
    if (scba) {
      const before = kitUses(sim, a.rid, 'scba');      // 공기를 세지 않는 장비면 Infinity
      if (before <= 0) scba = false;      // 빈 통: 방호가 없다
      else if (before !== Infinity) {
        useKit(sim, a.rid, 'scba', sim.dt * (1.25 - 0.5 * r.fitness));
        const left = kitUses(sim, a.rid, 'scba');
        // 쓰러진 대원의 통도 줄지만 스스로 알리지는 못한다 (기록은 일하고 있는 대원의 것만)
        if (a.status !== 'down') {
          if (before >= AIR_LOW && left < AIR_LOW) emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'radio', imp: 1, text: `${r.name}: 공기 잔량 ${AIR_LOW}초 미만.` });
          if (left <= 0) emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'radio', imp: 2, text: `${r.name}: 공기통이 비었습니다.` });
        }
      }
    }
    hurtResponder(sim, s, I, a, 1.3 * smoke * sim.dt * (dragging(a) ? CARRY.dragSmoke : 1), smokeCause(s), TICK);      // 가스 누출 현장의 연기는 유독 가스로 적는다 · (R3 6단계 — 끌기) 낮게 끌어 나가는 대원은 연기 피해 ×0.5
    if (scba) r.stamina = Math.max(0, r.stamina - 0.22 * smoke * sim.dt);      // 공기호흡기를 메고 연기 속에서 일하면 지친다
  } else a.smokeT = Math.max(0, a.smokeT - sim.dt * 2);
  if (fire > 0.4) hurtResponder(sim, s, I, a, 9 * fire * sim.dt, 'burn', TICK);
  // 상처 악화 (§2.6): 현장에 있는 동안(일하는 중·쓰러져 있는 중·끌려가는 중·안전 구역에서 기다리는 중) 출혈이 체력을 깎는다.
  // 처치를 받고 안전 구역에 물러나 있으면 0.6배. 차에 타면(left — 후송 중·병원) 멈춘다: 이 함수는 첫 줄에서 돌아간다
  woundTick(sim, r, a.status === 'withdrawn' && (r.treatQ ?? 0) > 0 ? SAFE_BLEED : 1);
  settle(sim, s, I, a);
}

/**
 * 상태 전이: 체력 0 이하 → 순직, 15 이하 → 쓰러짐, 물러나야 하는 몸(체력 40 아래, 또는 출혈이 크고 70 아래) → 부상.
 * 기록은 상태를 바꾸는 이 자리에서 남긴다. 원인 낱말은 이 틱에 가장 크게 깎은 항(없으면 지금까지의 가장 큰 원인), 원인 기록은 마지막으로 다친 기록(a.hurtEv).
 */
function settle(sim: Sim, s: Scene, I: Incident, a: FieldAgent): void {
  const r = sim.responders[a.rid];
  if (r.dead) return;
  if (r.health <= 0) { fallen(sim, s, I, a); return; }
  const trapped = (a.trapped ?? 0) > 0;      // (X6 §4.8) 무너진 잔해에 깔린 대원은 체력과 상관없이 쓰러진다 — 붕괴 함수는 a.trapped·a.trapEv 만 세우고 전이는 여기서 한다
  if ((r.health <= DOWN_AT || trapped) && r.status !== 'down') {
    if (a.task) finishTask(sim, s, a, false, 'preempt');
    // 안전 구역에서 기다리던 대원은 그 자리에 그대로 있다 (기록 없음 — 이미 부상으로 알렸다)
    const wasSafe = a.status === 'withdrawn';
    a.status = wasSafe ? 'withdrawn' : 'down'; r.status = 'down'; a.label = trapped ? '잔해에 깔림' : '쓰러짐';
    r.tDown ??= sim.t;
    if (!wasSafe) {
      sim.units[a.unitId].oosEv = trapped
        ? raiseProblem(sim, I, 'RESPONDER_HURT', `${r.name} 대원 쓰러짐 (잔해 깔림)`, { role: 'SYSTEM', actor: '현장', rid: r.id, imp: 3, causes: [a.trapEv ?? -1], text: `${r.name} 대원이 무너진 잔해에 깔렸습니다! 구조가 필요합니다.` }, false)
        : raiseProblem(sim, I, 'RESPONDER_HURT', `${r.name} 대원 쓰러짐${causeNote(sim, a)}`, { role: 'SYSTEM', actor: '현장', rid: r.id, imp: 3, causes: [a.hurtEv ?? -1], text: `${r.name} 대원이 쓰러졌습니다! 즉시 구조가 필요합니다.` }, false);
    }
  } else if (r.status === 'ok' && mustRetreat(r)) {
    r.status = 'injured';
    sim.units[a.unitId].oosEv = raiseProblem(sim, I, 'RESPONDER_HURT', `${r.name} 대원 부상${causeNote(sim, a)}`, { role: 'RESPONDER', actor: r.name, rid: r.id, imp: 2, causes: [a.hurtEv ?? -1], text: `${r.name} 부상. 임무 수행이 어렵습니다.` }, false);
    // 물러나는 대원은 말할 수 있다: 자기 상태를 알린다. 보고 대기열을 거치므로 음영 구역이면 재전송 경로를 탄다. 무전 문구는 남기지 않는다(위 기록이 이미 알렸다)
    if (a.status === 'active') learnQuiet(sim, a, mateFact(sim, s, a, 'hurt', r.name, 0));
  } else if (a.status === 'withdrawn' && r.status === 'injured' && !a.lightBack && I.phase !== 'closed' && !needsHospital(r)
    && !sim.units[a.unitId].boardOrder && !s.board.some((w) => w.kind === 'treatMate' && w.mate === a.rid && (w.status === 'active' || (w.status === 'done' && w.doneAt >= sim.t)))) {
    // (처치가 방금 이 틱에 끝났으면 다음 틱에 돌아온다 — 처치한 대원의 보고('안전 구역')와 같은 시각이면 늦게 닿은 그 보고가 '가벼운 일' 보고를 덮어쓴다)
    // 가벼운 일로 복귀 (§3.6a — 사용자 결정 "가벼운 일은 계속"): 대기 지점으로 물러났던 다친 대원이 병원이 필요 없는 몸이 되면
    // (쓰러진 적 없음 · 출혈이 병원 문턱 아래 · 체력 40 초과 — 물러날 때는 늘 병원이 필요한 몸이므로 대개 처치를 받은 뒤다) 그 현장에서 한 번 가벼운 일로 돌아온다.
    // 다시 물러나면 그 현장에서는 돌아오지 않는다(a.lightBack).
    // 병원이 필요한 대원은 그대로 남아 후송을 기다린다. 누가 처치하고 있는 중에는 기다린다. 자기 부대가 떠나려는 중이면 함께 탄다
    a.status = 'active'; a.lightBack = true; a.task = null; a.orderWork = -1; a.label = '부상 — 가벼운 일'; a.idleSince = sim.t; a.nextThink = sim.t + 0.5;
    learnQuiet(sim, a, mateFact(sim, s, a, 'light', r.name, 0)); flushOutbox(sim, s, a);
    emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, causes: [a.hurtEv ?? -1], text: '처치 받음. 가벼운 임무로 복귀합니다.' });
  }
}

/** 기록에 붙는 원인 낱말: ' (총상)'. 이 틱에 가장 크게 깎은 항, 없으면 지금까지의 가장 큰 원인 */
function causeNote(sim: Sim, a: FieldAgent): string {
  const cause = hurtCauseNow(sim.responders[a.rid], sim.t);
  return cause ? ` (${CAUSE_NAME[cause]})` : '';
}

/** 순직. 원인과 경과는 숨지는 이 자리에서 상태로 만든다 — 보고서의 문장은 이 detail 을 그대로 쓴다 */
function fallen(sim: Sim, s: Scene, I: Incident, a: FieldAgent): void {
  const r = sim.responders[a.rid];
  const cause = r.deathCause ?? hurtCauseNow(r, sim.t) ?? 'blunt';
  const carried = s.agents.some((b) => b.carrying === -(a.rid + 2));      // 동료가 끌고 나오던 중이었다
  if (a.task) finishTask(sim, s, a, false, 'preempt');      // 업고 있던 사람을 내려놓는다 (쓰러질 때와 같다)
  r.dead = true; r.tDead = sim.t; r.health = 0; r.status = 'down'; r.deathCause = cause;
  const safe = a.status === 'withdrawn';
  if (!safe) a.status = 'down';
  a.label = '';
  let detail = `${r.name} 대원(${sim.units[a.unitId].callsign}) — ${CAUSE_NAME[cause]}`;
  if (safe) detail += ', 안전 구역에서 후송을 기다리던 중';
  else if (r.tDown !== undefined) detail += carried ? `, 쓰러진 뒤 ${fmtSec(sim.t - r.tDown)} 만에 구조되던 중` : `, 쓰러진 뒤 ${fmtSec(sim.t - r.tDown)} 동안 구조되지 못함`;
  sim.units[a.unitId].oosEv = raiseProblem(sim, I, 'RESPONDER_KILLED', detail, { role: 'SYSTEM', actor: '현장', rid: r.id, imp: 3, causes: [a.hurtEv ?? -1], text: `${r.name} 대원 생체 반응 소실.` }, false);
}

/**
 * 판정 직전에 밀린 상태 전이를 마친다 — incidents.closeIncident 가 evaluate 앞에서 부른다.
 * 한 번 피해(폭발·총격·2차 사고)는 그 틱의 환경 단계에서 체력을 깎고, 전이는 뒤의 대원 단계(agentHealth)가 한다. 그 사이에 사건이 닫히면
 * (같은 틱에 지휘관이 종료를 선언했거나, 세계 규칙이 닫았다) 판정 뒤에는 전이가 없으므로 "체력 0 이하인데 숨지지 않은 대원"·"쓰러질 체력인데 멀쩡한 대원"이 남는다.
 * 새 피해는 주지 않는다 — 이미 깎인 체력의 결과만 적는다. 기록의 시각은 종료 시각과 같고 판정(evaluate)에 들어간다.
 */
export function settleInjuries(sim: Sim, s: Scene, I: Incident): void {
  for (let k = 0; k < s.agents.length; k++) { const a = s.agents[k]; if (a.status !== 'left') settle(sim, s, I, a); }
}

/** 이 현장에 내린 그 부대의 대원 가운데 병원이 필요한 사람이 있는가 (진실 — 부대가 떠날 때 병원부터 갈지를 정한다) */
function crewNeedsHospital(sim: Sim, s: Scene, u: Unit): boolean {
  for (let k = 0; k < s.agents.length; k++) if (s.agents[k].unitId === u.id && needsHospital(sim.responders[s.agents[k].rid])) return true;
  return false;
}

/** 부대가 처음 닿은 시각: 지상 대원이 처음 내린 시각(s.arrivedAt)과 상공 부대가 처음 닿은 시각(s.airAt) 가운데 먼저. 둘 다 없으면 -1 */
function onAt(s: Scene): number { const g = s.arrivedAt, a = s.airAt ?? -1; return g < 0 ? a : a < 0 ? g : Math.min(g, a); }
/** 이 사건 상공에서 대상이 있는 호이스트·물 투하 작업 중인 부대가 있는가 (감시만 하는 헬기는 치지 않는다 — 치면 종료·추가 요청·방치가 모두 막힌다) */
function airBusy(s: Scene): boolean {
  const air = s.air;
  if (air) for (let k = 0; k < air.length; k++) if ((air[k].mode === 'hoist' || air[k].mode === 'bucket') && air[k].idleSince < 0) return true;
  return false;
}

export function tickScene(sim: Sim, s: Scene): void {
  if (s.archived) return;
  const I = sim.incidents[s.incidentId];
  if (I.pursuit && I.pursuit.state === 'driving') return;      // 차가 아직 달리고 있다: 현장은 차가 선 뒤에 열린다
  // 대원 문턱의 기준: 이 틱이 시작될 때의 체력 (같은 틱에 피해가 몇 번 겹쳐도 첫 피해 전의 체력으로 본다 — injury.hurtResponder)
  for (let ai = 0; ai < s.agents.length; ai++) { const a = s.agents[ai]; if (a.status !== 'left') a.hpTick = sim.responders[a.rid].health; }
  // 1) 환경
  if (I.phase !== 'closed' || s.agents.some((a) => a.status !== 'left')) {
    tickCasualties(sim, s, I);
    tickHostiles(sim, s, I);
    tickLane(sim, s, I);
    tickLeaks(sim, s, I);
    const also = s.rules;
    if (s.kind === 'collapse' || (also && also.indexOf('collapse') >= 0)) tickCollapse(sim, s, I);
    if (s.kind === 'water' || (also && also.indexOf('water') >= 0)) tickWater(sim, s, I);
    if (TYPE_DEFS[s.kind].wander) tickWander(sim, s, I);
    if (s.kind === 'medical') tickMedical(sim, s, I);
    if (s.kind === 'collapse') { if (s.variant === 'elevator') tickLift(sim, s, I); else tickCrush(sim, s, I); }
    if ((sim.tick + s.id) % 5 === 0) { tickFire(sim, s, I); if (s.kind === 'hazmat' || (also && also.indexOf('gas') >= 0)) tickGas(sim, s, I); }
    for (let ri = 0; ri < SCENE_RULES.length; ri++) { const rule = SCENE_RULES[ri]; rule(sim, s, I); }      // 묶음별 세계 규칙 (field/rules/*)
  }
  // 2) 무전
  deliverRadio(sim, s, I);
  // 3) 대원
  const agents = s.agents;      // 매 틱 도는 순회는 색인으로 (최적화되기 전 단계에서 반복자 객체를 만들지 않는다. 순서·결과는 같다)
  for (let ai = 0; ai < agents.length; ai++) { const a = agents[ai];
    if (a.status === 'left') continue;
    agentHealth(sim, s, I, a);
    if (a.status === 'active' && sim.t >= a.nextThink) {
      think(sim, s, a);
      a.nextThink = sim.t + 0.5 + 0.7 * (1 - sim.responders[a.rid].experience);
    }
    act(sim, s, a);
  }
  // 4) 지휘권 승계
  if (I.phase !== 'closed' && s.agents.length) {
    const cmd = s.agents.find((a) => a.rid === s.commanderRid);
    // (R3 CE5) 지휘관의 부대에 철수·이송 지시가 섰다: 타기 전에 지휘를 넘긴다 — 후보는 그런 지시가 선 부대의 대원(지휘관 자신 포함)을 뺀 활동 대원, 없으면 넘기지 않는다(떠난 뒤 지금 경로)
    const leaving = cmd !== undefined && cmd.status === 'active' && sim.units[cmd.unitId].boardOrder !== null;
    if (!cmd || cmd.status !== 'active' || leaving) {
      const cands = s.agents.filter((a) => a.status === 'active' && sim.responders[a.rid].dept !== 'civil' && !(leaving && sim.units[a.unitId].boardOrder !== null));      // (N8) 유관 기관 대원은 지휘권을 승계하지 않는다
      if (leaving && cands.length) { cmdHandover(sim, s, I, cmd!, cands); }
      else if (!leaving && cands.length) {
        cands.sort((x, y) => (sim.responders[y.rid].dept === s.leadDept ? 1 : 0) - (sim.responders[x.rid].dept === s.leadDept ? 1 : 0) || sim.responders[y.rid].experience - sim.responders[x.rid].experience || x.rid - y.rid);
        if (cmd) for (const f of cmd.beliefs.all()) cands[0].beliefs.merge(BeliefStore.relay(f));
        // 승계자가 옛 지휘관의 상태를 알고 있으면(본 사람의 보고, 물러나며 본인이 알린 것) 그 까닭을 말한다. 모르면 예전 문구
        const mb = cmd ? cands[0].beliefs.val<MateBelief>('mate', cmd.rid) : undefined;
        const why = mb ? `${sim.responders[cmd!.rid].name} 대원 ${mb.dead ? '순직' : mb.status === 'down' ? '쓰러짐' : '부상'}으로 지휘 불능. 지휘권을 승계합니다.` : '';
        setCommander(sim, s, I, cands[0], cmd ? why || `${sim.responders[cmd.rid].name} 지휘 불능. 지휘권을 승계합니다.` : '현장 지휘를 맡습니다.');
      }
    }
  }
  // 5) 부대 출발 (철수 / 병원 이송)
  if (I.phase === 'closed') {
    // 사건이 끝났다: 남은 부대에 떠나라는 지시를 준다. 환자나 다친 대원을 태웠거나, 병원이 필요한 대원이 있으면 병원부터 간다
    for (const a of s.agents) { const u = sim.units[a.unitId]; if (a.status !== 'left' && !u.boardOrder) u.boardOrder = u.patients.length || (u.aboard !== undefined && u.aboard.length > 0) || crewNeedsHospital(sim, s, u) ? 'transport' : 'release'; }
    // 대원이 남지 않은 채 이 사건에 와 있는 부대(상공의 헬기 등)도 떠나보낸다 — 대원이 없다고 닫힌 사건 위에 영영 남지 않게
    for (let ui = 0; ui < sim.units.length; ui++) { const u = sim.units[ui];
      if (u.state === 'onscene' && u.incidentId === I.id && !u.boardOrder && !s.agents.some((b) => b.unitId === u.id && b.status !== 'left')) u.boardOrder = u.patients.length || (u.aboard !== undefined && u.aboard.length > 0) ? 'transport' : 'release';
    }
  }
  for (let ui = 0; ui < sim.units.length; ui++) { const u = sim.units[ui];
    if (u.state !== 'onscene' || u.incidentId !== I.id) continue;
    if (!u.boardOrder) {
      // 안전장치 (H1 §3.4-3): 대원이 이 현장에 내렸던 부대인데 모두 차에 탔고(다친 대원이 구급차에 실려 간 뒤 남은 사람이 없다) 떠나라는 지시가 없다.
      // 지시는 현장에 남은 대원을 거쳐서만 정해지므로, 그대로 두면 그 차량은 교대 끝까지 현장에 남는다. 상공에 머무는 부대는 내린 대원이 없어 걸리지 않는다
      let had = false, gone = true;
      for (let k = 0; k < s.agents.length; k++) if (s.agents[k].unitId === u.id) { had = true; if (s.agents[k].status !== 'left') { gone = false; break; } }
      if (!had || !gone) continue;
      u.boardOrder = 'release';
    }
    const mates = s.agents.filter((b) => b.unitId === u.id && b.status !== 'left');
    if (mates.some((b) => b.status === 'active')) continue;
    for (const b of mates) { b.status = 'left'; b.task = null; b.label = ''; }
    // 상공에 있던 부대면 그 상공 작업(AirOp)도 지운다 (사건이 닫힌 뒤에는 세계 규칙이 돌지 않아 air.ts 가 스스로 치우지 못한다)
    if (s.air && s.air.length) { for (let k = s.air.length - 1; k >= 0; k--) if (s.air[k].unitId === u.id) s.air.splice(k, 1); if (!s.air.length) s.light = null; }      // 탐조등도 함께 꺼진다
    // 떠나는 부대의 대원 가운데 병원이 필요한 사람(쓰러졌던 대원 · 피를 흘리는 대원 · 체력 40 이하 — 진실)은 그 차에 실려 병원부터 간다.
    // 숨진 대원은 싣지 않는다(부대와 함께 복귀한다). 이미 구급차에 실려 간 대원은 빠진다(needsHospital 이 care 를 본다)
    for (let k = 0; k < s.agents.length; k++) {
      const b = s.agents[k];
      if (b.unitId !== u.id) continue;
      const r = sim.responders[b.rid];
      if (!needsHospital(r)) continue;
      r.care = 'aboard'; (u.aboard ??= []).push({ kind: 'mate', id: r.id, inc: I.id, t: sim.t }); u.firstLoadAt ??= sim.t;
      // 물러날 만큼은 아니던 상처(피만 흘리던 대원)도 병원으로 실려 가면 다친 대원이다 — 조직이 아는 상태를 맞춘다 (아래의 출발 기록이 '부상 대원'으로 적는다)
      if (r.status === 'ok') r.status = 'injured';
    }
    if (u.boardOrder === 'transport' || u.patients.length > 0 || (u.aboard !== undefined && u.aboard.length > 0)) {      // 철수 지시 뒤에 환자를 태웠어도, 다친 대원을 태웠어도 병원부터 간다
      const k = I.assigned.indexOf(u.id); if (k >= 0) I.assigned.splice(k, 1);
      u.boardOrder = null; u.incidentId = null;
      const hosp = startTransport(sim, u);      // 가장 빨리 닿는 병원을 고른다 — 기록에는 실제로 가는 그 병원을 쓴다
      const who = riderText(u);      // 환자 · 부상 대원 · 용의자 (H1 — 실은 사람마다)
      noteDeparture(u, emit(sim, { inc: I.id, role: 'UNIT', actor: u.callsign, kind: 'unit', imp: 1, causes: transportWhy(u), text: `${u.callsign} ${who} 싣고 ${josa(hosp.name, '으로/로')} 출발.` }));      // (I1-b C3) 포화로 먼 병원을 골랐으면 그 알림이 원인
    } else {
      emit(sim, { inc: I.id, role: 'UNIT', actor: u.callsign, kind: 'unit', imp: 0, text: `${u.callsign} 현장 철수, 복귀합니다.` });
      releaseUnit(sim, u);
    }
  }
  // 6) 사고 현장 도로 통제 반영
  if (s.laneRows.length && I.blockedEdge >= 0 && I.phase !== 'closed') {
    const e = sim.city.edges[I.blockedEdge];
    if (s.controlDone.every(Boolean) && !e.closed) { e.closed = true; e.closedReason = 'incident'; I.blockEv = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '교통정보', kind: 'traffic', imp: 0, text: '사고 구간 전면 통제. 주변 차량은 우회합니다.' }); noteRoadCause(sim, e.id, 'close', I.blockEv, I.id); }      // (I1-b) 통제 기록 id — 교통의 장부에도 (닫힘의 주인)
  }
  // 7) 한계 시간 / 방치
  const on = onAt(s);      // 지상이든 상공이든 부대가 처음 닿은 때부터 잰다 — 헬기만 떠 있어도 사건은 반드시 끝난다
  if (I.phase !== 'closed' && on >= 0) {
    // (N8 §5.3.2) 유관 기관 대원은 일하는 동안만(작업을 쥐었고 대기가 아니다) 센다 — 고치던 복구반이 끝내기 전에 닫거나 다시 부르지 않고,
    // 손을 놓은 복구반만 남은 현장이 '대원이 있으니 기다린다'에 갇히지도 않는다
    const anyActive = s.agents.some((a) => a.status === 'active' && (sim.responders[a.rid].dept !== 'civil' || (a.task !== null && a.task.kind !== 'standby'))) || airBusy(s);
    // (X6 §6.4) 무너진 건물을 파내거나 외부 방어로 다 탈 때까지 기다리는 시간: 세계 쪽(구획 붕괴 +60 · 전체 붕괴 +180)과 지휘 쪽(외부 방어로 처음 바꿀 때 +150)을 합쳐 330초까지.
    // 교대 상한(engine.hardCap)은 그대로다 — 보탬이 그 뒤로 미루는 사건은 교대 끝에 닫힌다
    const catBonus = s.cat !== undefined || s.ops !== undefined ? Math.min(330, (s.cat?.limitBonus ?? 0) + (s.ops?.limitBonus ?? 0)) : 0;
    if (sim.t - on > TYPE_DEFS[s.kind].limit + (s.variant === 'bus' ? 170 : 0) + (scenarioOf(I.truth.type, I.truth.variant)?.limit ?? 0) + catBonus) {      // 다수 사상자 사고는 이송에 시간이 더 걸린다
      emit(sim, { inc: I.id, role: 'COMMANDER', actor: s.commanderRid >= 0 ? sim.responders[s.commanderRid].name : '현장', kind: 'command', imp: 2, text: '대응 한계 시간을 넘겼습니다. 현 상태로 현장을 인계하고 철수합니다.' });
      closeIncident(sim, I, 'timeout');
    } else if (!anyActive && !I.assigned.some((uid) => sim.units[uid].state === 'enroute' || sim.units[uid].state === 'turnout')) {
      if (s.idleSince < 0) {
        // 현장에 남은 대원이 없다(예: 구급차가 환자를 싣고 떠남). 마지막 지휘관이 알고 있던 상황으로 판단한다
        s.idleSince = sim.t;
        const last = s.agents.find((a) => a.rid === s.commanderRid);
        // (N8 §5.3.2) 남은 유관 기관 대원이 본 시설물 사실(haz)을 마지막 지휘관의 믿음에 넘긴 뒤 판단한다 — 지휘관이 떠난 뒤 복구반이 고친 것을 모르는 낡은 믿음으로
        // 같은 복구반을 다시 부르지 않게 (지휘권 승계 때 믿음을 넘기는 길과 같다). 유관 기관 대원이 없으면 아무것도 하지 않는다
        if (last) for (const b of s.agents) if (b.status !== 'left' && sim.responders[b.rid].dept === 'civil') for (const f of b.beliefs.list('haz')) last.beliefs.merge(BeliefStore.relay(f));
        const o = last ? outstanding(last, sim.t, s) : null;      // 대피 중이라던 사람의 소식이 오래 끊겼으면 남은 일로 센다 (H1 §5.2). 쓰러진 채 현장에 남은 동료도 남은 일이다 (§3.5)
        // 현장 평가를 마친 현장만 이렇게 끝낸다. 실종 현장을 상공의 헬기가 살핀 뒤라면 평가를 마치지 못했어도 같다 —
        // 하늘에서 먼저 다 찾아 주면 지상 부대가 평가를 건너뛰고 환자부터 싣고 떠나, 남은 일이 없는데도 '방치'로 닫혔다
        const surveyed = s.sizeupDone || (TYPE_DEFS[s.kind].zoneSearch && (s.airAt ?? -1) >= 0);
        // (N8) 남은 일 등록: 묶음 규칙이 마지막 지휘관의 믿음으로 본 끝나지 않은 일(살아 있는 시설물·풀린 동물·높은 자리의 사람)의 수요. 줄이 없으면 null — 아래는 지금 그대로
        const pend = last && PENDING_RULES.length ? pendingNeed(sim, s, I, last) : null;
        if (last && o && surveyed && o.patients === 0 && o.mates === 0 && !o.fire && !o.hostile && !(TYPE_DEFS[s.kind].zoneSearch && o.search) && !(s.kind === 'armed' && s.secureAt < 0) && pend === null) {
          emit(sim, { inc: I.id, role: 'COMMANDER', actor: sim.responders[last.rid].name, rid: last.rid, kind: 'command', imp: 2, text: '현장에 남은 임무가 없습니다. 환자 이송과 함께 상황 종료를 선언합니다.' });
          closeIncident(sim, I, 'resolved');
        } else if (o && (o.patients > 0 || o.fire || o.hostile || o.mates > 0)) {
          // 쓰러진 동료가 남았으면 구하러 들어갈 수 있는 부대를 부른다: 불·가스·붕괴 현장은 공기호흡기를 멘 구조 부대, 그 밖은 구급 부대.
          // 안전 구역에서 후송을 기다리는 다친 동료만 남았으면 구급 부대 (처치·후송 — orders/injury.ts)
          const need = o.hostile ? 'law' : o.fire ? 'suppression' : o.patients === 0 && o.matesDown > 0 && TYPE_DEFS[s.kind].indoorRisk ? 'rescue' : 'ems';
          I.unmet[need] = Math.max(I.unmet[need] ?? 0, 1); I.unmetSince = sim.t; I.noUnitLogged = false;
          emit(sim, { inc: I.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 2, causes: [I.lastEvent], text: `사건 ${I.code}: 현장에 남은 부대가 없는데 아직 끝나지 않았습니다. 추가 부대를 찾습니다.` });
        } else if (pend !== null) {
          // (N8) 남은 일의 수요로 같은 일을 한다 (문구는 측정 도구의 문구 규칙 때문에 그대로)
          I.unmet[pend] = Math.max(I.unmet[pend] ?? 0, 1); I.unmetSince = sim.t; I.noUnitLogged = false;
          emit(sim, { inc: I.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 2, causes: [I.lastEvent], text: `사건 ${I.code}: 현장에 남은 부대가 없는데 아직 끝나지 않았습니다. 추가 부대를 찾습니다.` });
        }
      }
      if ((I.phase as string) !== 'closed' && sim.t - s.idleSince > 60) closeIncident(sim, I, 'abandoned');
    } else s.idleSince = -1;
  }
  // 8) 정리
  if (s.fx.length && sim.t - s.fx[0].t > 4) s.fx.shift();
  // 이 사건에 아직 와 있는 부대가 있으면 보관하지 않는다: 7)번이 이 틱에 사건을 닫았으면 5)번은 이미 지나갔다.
  // 지상 대원이 없으면 여기서 곧바로 보관되고, 다음 틱부터는 5)번이 돌지 않아 상공의 헬기가 닫힌 사건 위에 남는다
  if (I.phase === 'closed' && s.agents.every((a) => a.status === 'left') && !sim.units.some((u) => u.state === 'onscene' && u.incidentId === I.id)) s.archived = true;
}

// (R3 3단계) 짝 맺기 — 부대가 내린 뒤 한 번 (doctrineRun.pairUp)
import { pairUp } from './doctrineRun';
import { divertArrived } from '../world/rules/record';      // (I1-b C6)
// (R3 6단계) 끌기 — 낮게 끌어 나가는 대원의 연기 피해 (agentHealth)
import { CARRY, dragging } from './doctrineRun';
// ── (R3 4단계 CE5) 이송 출발 전에 지휘를 넘긴다 — 4번 블록이 부른다. 고르는 순서는 지금의 승계(주관 부서 → 경험 → rid)와 같다 ──
import { recordDoc } from './doctrineRun';
function cmdHandover(sim: Sim, s: Scene, I: Incident, cmd: FieldAgent, cands: FieldAgent[]): void {
  cands.sort((x, y) => (sim.responders[y.rid].dept === s.leadDept ? 1 : 0) - (sim.responders[x.rid].dept === s.leadDept ? 1 : 0) || sim.responders[y.rid].experience - sim.responders[x.rid].experience || x.rid - y.rid);
  const nw = cands[0];
  for (const f of cmd.beliefs.all()) nw.beliefs.merge(BeliefStore.relay(f));
  const was = sim.responders[cmd.rid].name, now = sim.responders[nw.rid].name;
  const ev = setCommander(sim, s, I, nw, `${was} → ${now}: 지휘 넘김 — ${sim.units[cmd.unitId].callsign} ${sim.units[cmd.unitId].boardOrder === 'transport' ? '이송 출발' : '철수'}. ${now} 지휘권 인수.`);
  recordDoc(sim, I, null, 'CE5', 'cmd', {}, ev);
}
