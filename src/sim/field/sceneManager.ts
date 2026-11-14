// FieldSceneManager — 현장 공간의 생성과 매 틱 갱신.
// 현장은 사건이 "발생한 순간"부터 살아 있다. 부대가 도착하기 전에도 불은 번지고 부상자는 악화된다.

import { fieldReport } from '../dispatch/dispatcher';
import type { Sim } from '../engine';
import { emit, raiseProblem } from '../events';
import { closeIncident } from '../incidents';
import { releaseUnit, startTransport } from '../resources';
import type { Fact, FieldAgent, Incident, Scene, Unit } from '../types';
import { TYPE_NAME } from '../util';
import { BeliefStore, mkFact } from './beliefs';
import { think } from './brain';
import { outstanding } from './commander';
import { buildScene } from './builders';
import { act, finishTask } from './executor';
import { tileOf } from './grid';
import { tickCasualties, tickCollapse, tickFire, tickGas, tickHostiles, tickLane, tickLeaks, tickWater } from './hazards';

export function createScene(sim: Sim, I: Incident): Scene {
  const s = buildScene(sim, I, sim.rng.fork('scene:' + I.id));
  sim.scenes[I.id] = s;
  return s;
}

/** 관제가 출동 부대에 전달하는 브리핑. 신고자 진술에서 나온 미확인 정보다. */
export function briefFacts(sim: Sim, I: Incident): Fact[] {
  const out: Fact[] = [];
  const s = sim.scenes[I.id]!;
  const last = (topic: string) => { for (let k = I.claims.length - 1; k >= 0; k--) if (I.claims[k].topic === topic) return I.claims[k]; return null; };
  const as = I.assessment;
  if (as) out.push(mkFact('type', 0, as.type, '관제', sim.t, as.typeConf, false, `관제 판단: ${TYPE_NAME[as.type]} (신뢰도 ${Math.round(as.typeConf * 100)}%)`));
  const cnt = last('count'), inj = last('injured'), trap = last('trapped'), det = last('detail');
  let count: number | null = null, conf = 0.4;
  if (cnt && typeof cnt.value === 'number') { count = cnt.value; conf = cnt.conf; }
  else if (inj && inj.value === true) { count = 1; conf = inj.conf * 0.8; }
  else if (trap && trap.value === true) { count = 1; conf = trap.conf * 0.8; }
  let region = -1;
  if (det && det.value && typeof det.value.region === 'number' && det.value.region < s.regions.length) region = det.value.region;
  if (count !== null || region >= 0) {
    const where = region >= 0 ? ` · 위치 추정: ${s.regions[region].name}` : '';
    out.push(mkFact('occ', 0, { count, region, trapped: !!(trap && trap.value === true) }, '신고자', sim.t, conf, false, `신고 내용: ${count !== null ? `요구조자 약 ${count}명` : '요구조자 수 불명'}${where}`));
  }
  return out;
}

export function unitArrived(sim: Sim, I: Incident, u: Unit): void {
  const s = sim.scenes[I.id]!;
  const first = s.arrivedAt < 0;
  if (first) { s.arrivedAt = sim.t; I.firstArrivalAt = sim.t; I.phase = 'onscene'; }
  const node = sim.city.nodes[I.truth.nodeId];
  const slot = I.everAssigned.indexOf(u.id);
  if (!u.curb && !u.air && !u.sea) { u.x = node.x + 16 * Math.cos(slot * 1.3); u.y = node.y + 16 * Math.sin(slot * 1.3); u.px = u.x; u.py = u.y; }      // 건물 앞 길가에 세운 차량은 그 자리에 둔다
  const brief = briefFacts(sim, I);
  const cmd = s.agents.find((a) => a.rid === s.commanderRid && a.status === 'active');
  const prevCmd = s.agents.find((a) => a.rid === s.commanderRid);
  const crew = u.crew.filter((rid) => sim.responders[rid].status === 'ok');
  s.agents = s.agents.filter((a) => u.crew.indexOf(a.rid) < 0);      // 같은 대원이 다시 온 경우 이전 기록 정리
  crew.forEach((rid, k) => {
    const r = sim.responders[rid];
    const n = s.agents.length;
    const a: FieldAgent = {
      rid, unitId: u.id, isCommander: false,
      x: s.staging.x + (n % 3) * 0.8 - 0.8, y: s.staging.y + Math.floor(n / 3) % 3 * 0.8, px: 0, py: 0, fx: 1, fy: 0,
      path: null, pathI: 0, pathGoal: -1, task: null, orderWork: -1,
      beliefs: new BeliefStore(), outbox: [], outboxSince: 0, shadowSince: -1, commFailLogged: false,
      nextThink: sim.t + 0.4 + k * 0.4, nextPerceive: 0, carrying: -1, inCover: false, cooldown: 1,
      status: 'active', candidates: [], label: '도착', ring: 0, arrivedAt: sim.t, lastBlockEvent: -1, idleSince: sim.t,
      stuckT: 0, lastX: 0, lastY: 0, rng: sim.rng.fork(`agent:${I.id}:${rid}`), planT: 0, equipIssue: 'none', smokeT: 0, climb: 0, rehabLogAt: -99,
      pendingBlock: -1, underFireT: -99, spot: -1, quiet: new Set(), lastRetreatLog: -99,
    };
    a.px = a.x; a.py = a.y;
    for (const f of brief) a.beliefs.merge(f);
    if (cmd) for (const f of cmd.beliefs.all()) a.beliefs.merge(BeliefStore.relay(f));
    else if (prevCmd) for (const f of prevCmd.beliefs.all()) a.beliefs.merge(BeliefStore.relay(f));      // 관제가 이전 지휘관의 보고를 전달
    s.agents.push(a);
    r.incidentsWorked++;
  });
  const names = crew.map((rid) => sim.responders[rid].name).join('·');
  const took = I.reportedAt >= 0 ? Math.round(sim.t - I.reportedAt) : 0;
  emit(sim, { inc: I.id, role: 'UNIT', actor: u.callsign, kind: 'arrive', imp: first ? 3 : 2, text: first ? `${u.callsign} 현장 도착 (${names}). 신고 접수 후 ${took}초.` : `${u.callsign} 현장 합류 (${names}).` });
  if (!crew.length) return;
  const senior = s.agents.find((a) => a.rid === crew[0])!;
  if (!cmd) {
    setCommander(sim, s, I, senior, '현장 지휘를 맡습니다. 현장 평가부터 실시합니다.');
  } else if (sim.responders[cmd.rid].dept !== s.leadDept && u.dept === s.leadDept) {
    for (const f of cmd.beliefs.all()) senior.beliefs.merge(BeliefStore.relay(f));
    cmd.isCommander = false;
    // 주관 부서가 아닌 대원이 멀리서 한 현장 평가는 다시 한다
    if (s.sizeupDone) { s.sizeupDone = false; s.mismatchLogged = false; }
    setCommander(sim, s, I, senior, `${sim.responders[cmd.rid].name}에게서 지휘권을 인수합니다. 현재까지의 상황을 인계받았습니다.`);
  }
}

function setCommander(sim: Sim, s: Scene, I: Incident, a: FieldAgent, text: string): void {
  for (const b of s.agents) b.isCommander = false;
  a.isCommander = true; s.commanderRid = a.rid; a.planT = sim.t + 0.6;
  // 현장 평가는 지휘관 본인이 한다. 이전 지휘관이 하던 평가는 중단시킨다.
  if (!s.sizeupDone) for (const w of s.board) if (w.kind === 'sizeup' && (w.status === 'open' || w.status === 'active')) w.status = 'cancelled';
  emit(sim, { inc: I.id, role: 'COMMANDER', actor: sim.responders[a.rid].name, rid: a.rid, kind: 'command', imp: 2, text });
}

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
      for (const f of m.facts) b.beliefs.merge(BeliefStore.relay(f));
      if (m.kind === 'order' && m.to === b.rid) {
        const w = s.board[m.workId];
        if (w && (w.status === 'open' || w.status === 'active')) b.orderWork = m.workId;
      }
    }
  }
}

function agentHealth(sim: Sim, s: Scene, I: Incident, a: FieldAgent): void {
  if (a.status === 'left') return;
  const r = sim.responders[a.rid];
  const i = tileOf(s, a.x, a.y);
  const smoke = s.smoke[i], fire = s.fire[i];
  if (smoke > 0.25) {
    a.smokeT += sim.dt;
    r.health -= (r.dept === 'fire' ? 0.1 : 1.3) * smoke * sim.dt;
    if (r.dept === 'fire') r.stamina = Math.max(0, r.stamina - 0.22 * smoke * sim.dt);
  } else a.smokeT = Math.max(0, a.smokeT - sim.dt * 2);
  if (fire > 0.4) r.health -= (r.dept === 'fire' ? 2.6 : 9) * fire * sim.dt;
  if (r.health < 1) r.health = 1;
  if (r.health <= 15 && a.status !== 'down') {
    if (a.task) finishTask(sim, s, a, false, 'preempt');
    const wasSafe = a.status === 'withdrawn';
    a.status = wasSafe ? 'withdrawn' : 'down'; r.status = 'down'; a.label = '쓰러짐';
    if (!wasSafe) {
      raiseProblem(sim, I, 'RESPONDER_HURT', `${r.name} 대원 중상`, { role: 'SYSTEM', actor: '현장', rid: r.id, imp: 3, causes: [a.lastBlockEvent], text: `${r.name} 대원이 쓰러졌습니다! 즉시 구조가 필요합니다.` }, false);
    }
  } else if (r.health < 40 && r.status === 'ok') {
    r.status = 'injured';
    raiseProblem(sim, I, 'RESPONDER_HURT', `${r.name} 대원 부상`, { role: 'RESPONDER', actor: r.name, rid: r.id, imp: 2, causes: [a.lastBlockEvent], text: `${r.name} 부상. 임무 수행이 어렵습니다.` }, false);
  }
}

const LIMIT: Record<string, number> = { fire: 430, traffic: 400, search: 470, armed: 400, medical: 300, collapse: 470, hazmat: 430, water: 380 };

export function tickScene(sim: Sim, s: Scene): void {
  if (s.archived) return;
  const I = sim.incidents[s.incidentId];
  // 1) 환경
  if (I.phase !== 'closed' || s.agents.some((a) => a.status !== 'left')) {
    tickCasualties(sim, s, I);
    tickHostiles(sim, s, I);
    tickLane(sim, s, I);
    tickLeaks(sim, s, I);
    if (s.kind === 'collapse') tickCollapse(sim, s, I);
    if (s.kind === 'water') tickWater(sim, s, I);
    if ((sim.tick + s.id) % 5 === 0) { tickFire(sim, s, I); if (s.kind === 'hazmat') tickGas(sim, s, I); }
  }
  // 2) 무전
  deliverRadio(sim, s, I);
  // 3) 대원
  for (const a of s.agents) {
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
    if (!cmd || cmd.status !== 'active') {
      const cands = s.agents.filter((a) => a.status === 'active');
      if (cands.length) {
        cands.sort((x, y) => (sim.responders[y.rid].dept === s.leadDept ? 1 : 0) - (sim.responders[x.rid].dept === s.leadDept ? 1 : 0) || sim.responders[y.rid].experience - sim.responders[x.rid].experience || x.rid - y.rid);
        if (cmd) for (const f of cmd.beliefs.all()) cands[0].beliefs.merge(BeliefStore.relay(f));
        setCommander(sim, s, I, cands[0], cmd ? `${sim.responders[cmd.rid].name} 지휘 불능. 지휘권을 승계합니다.` : '현장 지휘를 맡습니다.');
      }
    }
  }
  // 5) 부대 출발 (철수 / 병원 이송)
  if (I.phase === 'closed') for (const a of s.agents) { const u = sim.units[a.unitId]; if (a.status !== 'left' && !u.boardOrder) u.boardOrder = u.patients.length ? 'transport' : 'release'; }
  for (const u of sim.units) {
    if (u.state !== 'onscene' || u.incidentId !== I.id || !u.boardOrder) continue;
    const mates = s.agents.filter((b) => b.unitId === u.id && b.status !== 'left');
    if (mates.some((b) => b.status === 'active')) continue;
    for (const b of mates) { b.status = 'left'; b.task = null; b.label = ''; }
    if (u.boardOrder === 'transport') {
      const k = I.assigned.indexOf(u.id); if (k >= 0) I.assigned.splice(k, 1);
      emit(sim, { inc: I.id, role: 'UNIT', actor: u.callsign, kind: 'unit', imp: 1, text: `${u.callsign} 환자 ${u.patients.length}명 싣고 시립병원으로 출발.` });
      u.boardOrder = null; u.incidentId = null;
      startTransport(sim, u);
    } else {
      emit(sim, { inc: I.id, role: 'UNIT', actor: u.callsign, kind: 'unit', imp: 0, text: `${u.callsign} 현장 철수, 복귀합니다.` });
      releaseUnit(sim, u);
    }
  }
  // 6) 사고 현장 도로 통제 반영
  if (s.laneRows.length && I.blockedEdge >= 0 && I.phase !== 'closed') {
    const e = sim.city.edges[I.blockedEdge];
    if (s.controlDone.every(Boolean) && !e.closed) { e.closed = true; e.closedReason = 'incident'; emit(sim, { inc: I.id, role: 'SYSTEM', actor: '교통정보', kind: 'traffic', imp: 0, text: '사고 구간 전면 통제. 주변 차량은 우회합니다.' }); }
  }
  // 7) 한계 시간 / 방치
  if (I.phase !== 'closed' && s.arrivedAt >= 0) {
    const anyActive = s.agents.some((a) => a.status === 'active');
    if (sim.t - s.arrivedAt > LIMIT[s.kind] + (s.variant === 'bus' ? 170 : 0)) {      // 다수 사상자 사고는 이송에 시간이 더 걸린다
      emit(sim, { inc: I.id, role: 'COMMANDER', actor: s.commanderRid >= 0 ? sim.responders[s.commanderRid].name : '현장', kind: 'command', imp: 2, text: '대응 한계 시간을 넘겼습니다. 현 상태로 현장을 인계하고 철수합니다.' });
      closeIncident(sim, I, 'timeout');
    } else if (!anyActive && !I.assigned.some((uid) => sim.units[uid].state === 'enroute' || sim.units[uid].state === 'turnout')) {
      if (s.idleSince < 0) {
        // 현장에 남은 대원이 없다(예: 구급차가 환자를 싣고 떠남). 마지막 지휘관이 알고 있던 상황으로 판단한다
        s.idleSince = sim.t;
        const last = s.agents.find((a) => a.rid === s.commanderRid);
        const o = last ? outstanding(last) : null;
        if (last && o && s.sizeupDone && o.patients === 0 && !o.fire && !o.hostile && !(s.kind === 'search' && o.search) && !(s.kind === 'armed' && s.secureAt < 0)) {
          emit(sim, { inc: I.id, role: 'COMMANDER', actor: sim.responders[last.rid].name, rid: last.rid, kind: 'command', imp: 2, text: '현장에 남은 임무가 없습니다. 환자 이송과 함께 상황 종료를 선언합니다.' });
          closeIncident(sim, I, 'resolved');
        } else if (o && (o.patients > 0 || o.fire || o.hostile)) {
          const need = o.hostile ? 'law' : o.fire ? 'suppression' : 'ems';
          I.unmet[need] = Math.max(I.unmet[need] ?? 0, 1); I.unmetSince = sim.t; I.noUnitLogged = false;
          emit(sim, { inc: I.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 2, causes: [I.lastEvent], text: `사건 ${I.code}: 현장에 남은 부대가 없는데 아직 끝나지 않았습니다. 추가 부대를 찾습니다.` });
        }
      }
      if ((I.phase as string) !== 'closed' && sim.t - s.idleSince > 60) closeIncident(sim, I, 'abandoned');
    } else s.idleSince = -1;
  }
  // 8) 정리
  if (s.fx.length && sim.t - s.fx[0].t > 4) s.fx.shift();
  if (I.phase === 'closed' && s.agents.every((a) => a.status === 'left')) s.archived = true;
}
