// ResourceManager — 부대·대원 명부, 차량 상태와 도시 지도 위 이동.

import { edgeName, edgeTime, findRoute, weatherSpeedFactor } from './city';
import type { Sim } from './engine';
import { emit, raiseProblem } from './events';
import { unitArrived } from './field/sceneManager';
import { Rng } from './rng';
import type { Dept, Incident, Responder, Unit, UnitCaps, UnitKind } from './types';
import { clamp, fmtSec } from './util';

const NAMES = ['김도윤', '이서준', '박하준', '최민재', '정지호', '강현우', '윤서연', '한지민', '오수아', '임채원', '신유나', '조은서'];

interface UnitDef { callsign: string; dept: Dept; kind: UnitKind; facility: number; caps: UnitCaps; waterMax: number; tool: number; med: number; armor: number }
const caps = (suppression: number, rescue: number, ems: number, law: number, tactical: number, search: number, traffic: number): UnitCaps =>
  ({ suppression, rescue, ems, law, tactical, search, traffic });
const UNIT_DEFS: UnitDef[] = [
  { callsign: '진압1', dept: 'fire', kind: 'engine', facility: 0, caps: caps(1.0, 0.55, 0.2, 0, 0, 0.5, 0.4), waterMax: 100, tool: 0.55, med: 0.35, armor: 0.1 },
  { callsign: '구조1', dept: 'fire', kind: 'rescue', facility: 1, caps: caps(0.75, 1.0, 0.25, 0, 0, 0.8, 0.4), waterMax: 60, tool: 1.0, med: 0.4, armor: 0.1 },
  { callsign: '구급1', dept: 'ems', kind: 'als', facility: 0, caps: caps(0, 0.15, 1.0, 0, 0, 0.3, 0.2), waterMax: 0, tool: 0.1, med: 1.0, armor: 0 },
  { callsign: '구급2', dept: 'ems', kind: 'bls', facility: 2, caps: caps(0, 0.15, 0.8, 0, 0, 0.3, 0.2), waterMax: 0, tool: 0.1, med: 0.75, armor: 0 },
  { callsign: '순찰1', dept: 'police', kind: 'patrol', facility: 3, caps: caps(0, 0.15, 0.15, 0.8, 0.5, 0.7, 1.0), waterMax: 0, tool: 0.12, med: 0.25, armor: 0.2 },
  { callsign: '기동1', dept: 'police', kind: 'tactical', facility: 4, caps: caps(0, 0.15, 0.15, 1.0, 1.0, 0.7, 0.7), waterMax: 0, tool: 0.12, med: 0.25, armor: 0.5 },
];

export const UNIT_KIND_NAME: Record<UnitKind, string> = { engine: '진압 펌프차', rescue: '구조 공작차', als: '전문 구급차', bls: '일반 구급차', patrol: '순찰차', tactical: '기동 순찰차' };

function traitOf(r: Responder): string {
  const stats: [string, number][] = [['침착함', r.composure], ['판단 빠름', r.judgment], ['체력 좋음', r.fitness], ['협동적', r.teamwork], ['베테랑', r.experience], ['기술 숙련', r.skill]];
  stats.sort((a, b) => b[1] - a[1]);
  const lows: [string, number][] = [['쉽게 동요', r.composure], ['판단 미숙', r.judgment], ['체력 약함', r.fitness], ['독단적', r.teamwork], ['신입', r.experience]];
  lows.sort((a, b) => a[1] - b[1]);
  return lows[0][1] < 0.42 ? `${stats[0][0]} · ${lows[0][0]}` : stats[0][0];
}

/** 대원 능력은 고정된 조직 시드에서 만든다(같은 대원이 매 교대에 등장). 장비 상태는 교대 시드에서 만든다. */
export function createRoster(sim: Sim): void {
  const rosterRng = new Rng(0x51ab7e).fork('roster-v1');
  const equipRng = sim.rng.fork('equipment');
  const tn = sim.tune;
  let rid = 0;
  UNIT_DEFS.forEach((d, i) => {
    const f = sim.city.facilities[d.facility];
    const home = sim.city.nodes[f.nodeId];
    const crew: number[] = [];
    for (let k = 0; k < 2; k++) {
      const senior = k === 0;
      const st = () => clamp(rosterRng.range(0.3, 0.95), 0, 1);
      const exp = senior ? rosterRng.range(0.6, 0.97) : rosterRng.range(0.12, 0.6);
      const skill = clamp(st() * 0.6 + exp * 0.4 + 0.05, 0.3, 0.98);
      const r: Responder = {
        id: rid, name: NAMES[rid], dept: d.dept, unitId: i, senior,
        skill, judgment: clamp(st() * 0.65 + exp * 0.35, 0.2, 0.98), composure: st(), fitness: st(), teamwork: st(), experience: exp,
        skills: { fire: 0.05, rescue: 0.2, medical: 0.2, law: 0.05 },
        trait: '', health: 100, stamina: tn.startStamina, status: 'ok', xpGained: 0, incidentsWorked: 0,
      };
      if (d.dept === 'fire') r.skills = d.kind === 'rescue' ? { fire: skill * 0.75, rescue: skill, medical: 0.35, law: 0.05 } : { fire: skill, rescue: skill * 0.6, medical: 0.3, law: 0.05 };
      else if (d.dept === 'ems') r.skills = { fire: 0.05, rescue: 0.25, medical: clamp(skill + (d.kind === 'als' ? 0.08 : 0), 0, 1), law: 0.05 };
      else r.skills = { fire: 0.05, rescue: 0.22, medical: 0.22, law: clamp(skill + (d.kind === 'tactical' ? 0.06 : 0), 0, 1) };
      r.trait = traitOf(r);
      sim.responders.push(r);
      crew.push(rid++);
    }
    const u: Unit = {
      id: i, callsign: d.callsign, dept: d.dept, kind: d.kind, crew, homeNode: f.nodeId, homeName: f.name,
      state: 'available', x: home.x, y: home.y, px: home.x, py: home.y, nodeId: f.nodeId,
      route: null, seg: 0, segT: 0, pendingDest: null, destNode: null, incidentId: null, timer: 0,
      caps: d.caps, water: d.waterMax * tn.waterMul, waterMax: d.waterMax * tn.waterMul, hydrant: false,
      pumpCond: d.dept === 'fire' ? equipRng.range(tn.pumpMin, tn.pumpMax) : 1, pumpFailed: false,
      tool: Math.min(1.15, d.tool * tn.toolMul), medLevel: Math.min(1.1, d.med * tn.medMul), armor: Math.min(0.8, d.armor * tn.armorMul),
      patients: [], patientsIncident: null,
      dispatchedAt: -1, estArrive: -1, diverted: false, busyTime: 0, runs: 0, boardOrder: null,
    };
    sim.units.push(u);
  });
}

export function crewNames(sim: Sim, u: Unit): string { return u.crew.map((r) => sim.responders[r].name).join('·'); }
export function crewReady(sim: Sim, u: Unit): number { return u.crew.filter((r) => sim.responders[r].status === 'ok').length; }

/** 현재 상태에서 목적지까지 예상 소요 시간(초). 관제 AI 가 배정 판단에 사용한다. */
export function etaFor(sim: Sim, u: Unit, destNode: number): number {
  const wf = weatherSpeedFactor(sim);
  let from = u.nodeId, extra = 0;
  if (u.state === 'available') extra = 6;
  if (u.route && u.seg < u.route.edges.length && (u.state === 'enroute' || u.state === 'returning' || u.state === 'transport')) {
    const e = sim.city.edges[u.route.edges[u.seg]];
    extra += (1 - u.segT) * edgeTime(e, wf);
    from = u.route.nodes[u.seg + 1];
  }
  const r = findRoute(sim.city, from, destNode, wf);
  return r ? r.time + extra : 9999;
}

function setRoute(sim: Sim, u: Unit, to: number): void {
  u.destNode = to; u.seg = 0; u.segT = 0;
  u.route = u.nodeId === to ? null : findRoute(sim.city, u.nodeId, to, weatherSpeedFactor(sim));
}

/** 목적지 설정. 구간 주행 중이면 다음 교차로까지는 그대로 달린 뒤 새 경로를 잡는다. */
export function sendUnitTo(sim: Sim, u: Unit, destNode: number): void {
  if (u.route && u.seg < u.route.edges.length && u.segT > 0) { u.pendingDest = destNode; u.destNode = destNode; return; }
  u.pendingDest = null;
  setRoute(sim, u, destNode);
}

export function dispatchUnit(sim: Sim, u: Unit, I: Incident, eta: number): void {
  const wasMoving = u.state === 'returning' || u.state === 'enroute';
  u.incidentId = I.id; u.dispatchedAt = sim.t; u.estArrive = sim.t + eta; u.runs++;
  u.boardOrder = null;
  if (wasMoving) { u.state = 'enroute'; sendUnitTo(sim, u, I.truth.nodeId); }
  else { u.state = 'turnout'; u.timer = 5 + (1 - sim.responders[u.crew[0]].experience) * 3; u.destNode = I.truth.nodeId; }
  if (I.assigned.indexOf(u.id) < 0) I.assigned.push(u.id);
  if (I.everAssigned.indexOf(u.id) < 0) I.everAssigned.push(u.id);
}

/** 현장을 떠나 복귀한다. */
export function releaseUnit(sim: Sim, u: Unit): void {
  if (u.incidentId !== null) {
    const I = sim.incidents[u.incidentId];
    const k = I.assigned.indexOf(u.id); if (k >= 0) I.assigned.splice(k, 1);
  }
  u.incidentId = null; u.boardOrder = null; u.diverted = false;
  u.hydrant = false;
  if (crewReady(sim, u) === 0) { u.state = 'returning'; sendUnitTo(sim, u, u.homeNode); return; }
  u.state = 'returning';
  sendUnitTo(sim, u, u.homeNode);
}

export function startTransport(sim: Sim, u: Unit): void {
  const hosp = sim.city.facilities.find((f) => f.kind === 'hospital')!;
  u.state = 'transport';
  sendUnitTo(sim, u, hosp.nodeId);
}

function arrive(sim: Sim, u: Unit): void {
  u.route = null; u.seg = 0; u.segT = 0;
  const n = sim.city.nodes[u.nodeId];
  u.x = n.x; u.y = n.y;
  if (u.state === 'enroute') {
    const I = u.incidentId !== null ? sim.incidents[u.incidentId] : null;
    if (!I || I.phase === 'closed') { releaseUnit(sim, u); return; }
    const took = sim.t - u.dispatchedAt, est = u.estArrive - u.dispatchedAt;
    if (took > est * 1.35 + 6) {
      raiseProblem(sim, I, 'TRAFFIC_DELAY', `${u.callsign} 도착이 예상보다 ${fmtSec(took - est)} 지연`, {
        role: 'UNIT', actor: u.callsign, text: `${u.callsign}: 교통 상황으로 예상보다 ${fmtSec(took - est)} 늦게 도착.`, imp: 1,
      });
    }
    u.state = 'onscene';
    unitArrived(sim, I, u);
  } else if (u.state === 'transport') {
    u.state = 'hospital'; u.timer = 8;
  } else if (u.state === 'returning') {
    u.water = u.waterMax; u.hydrant = false;
    if (u.pumpFailed) { u.pumpFailed = false; u.pumpCond = 0.55; }
    u.state = crewReady(sim, u) === 0 ? 'oos' : 'available';
    if (u.state === 'oos') emit(sim, { role: 'UNIT', actor: u.callsign, kind: 'unit', text: `${u.callsign} 대원 전원 부상으로 운용 중단.`, imp: 2 });
  }
}

export function tickUnits(sim: Sim): void {
  const city = sim.city, dt = sim.dt, wf = weatherSpeedFactor(sim);
  for (const u of sim.units) {
    u.px = u.x; u.py = u.y;
    if (u.state !== 'available' && u.state !== 'oos') u.busyTime += dt;
    if (u.state === 'available' || u.state === 'returning') {
      const rate = u.state === 'available' ? 0.55 : 0.2;
      for (const rid of u.crew) { const r = sim.responders[rid]; if (r.status === 'ok') r.stamina = Math.min(100, r.stamina + rate * dt); }
    }
    if (u.state === 'transport' && u.patientsIncident !== null) {
      // 이송 중 처치: 탑승 후 몇 초 뒤 구급대원이 차 안에서 응급 처치를 마친다
      const sc = sim.scenes[u.patientsIncident];
      if (sc) for (const cid of u.patients) {
        const c = sc.casualties[cid];
        if (!c.treated && !c.dead && sim.t - c.tLoaded > 6) { c.treated = true; c.tTreated = sim.t; c.bleed *= 1 - 0.9 * Math.min(1, u.medLevel * 0.95); }
      }
    }
    if (u.state === 'available' || u.state === 'oos' || u.state === 'onscene') continue;
    if (u.state === 'turnout') {
      u.timer -= dt;
      if (u.timer <= 0) { u.state = 'enroute'; setRoute(sim, u, u.destNode!); if (!u.route && u.nodeId === u.destNode) arrive(sim, u); }
      continue;
    }
    if (u.state === 'hospital') {
      u.timer -= dt;
      if (u.timer <= 0) {
        const I = u.patientsIncident !== null ? sim.incidents[u.patientsIncident] : null;
        const scene = I ? sim.scenes[I.id] : null;
        if (scene) {
          for (const cid of u.patients) {
            const c = scene.casualties[cid];
            if (!c.dead) { c.where = 'hospital'; c.tHospital = sim.t; }
          }
          const alive = u.patients.filter((cid) => !scene.casualties[cid].dead).length;
          emit(sim, { inc: I!.id, role: 'UNIT', actor: u.callsign, kind: 'casualty', text: `${u.callsign}: 시립병원 도착, 환자 ${alive}명 인계 완료.`, imp: 1 });
        }
        u.patients = []; u.patientsIncident = null;
        releaseUnit(sim, u);
      }
      continue;
    }
    // 이동 (enroute / transport / returning)
    if (!u.route) {
      if (u.destNode === null || u.nodeId === u.destNode) { arrive(sim, u); continue; }
      setRoute(sim, u, u.destNode);       // 경로가 끊겨 대기 중이었다면 재시도
      if (!u.route) continue;
    }
    let budget = dt;
    let guard = 0;
    while (budget > 0 && u.route && guard++ < 8) {
      const e = city.edges[u.route.edges[u.seg]];
      const et = Math.max(0.5, edgeTime(e, wf));
      const remain = (1 - u.segT) * et;
      if (budget < remain) { u.segT += budget / et; budget = 0; break; }
      budget -= remain;
      u.nodeId = u.route.nodes[u.seg + 1];
      u.seg++; u.segT = 0;
      if (u.pendingDest !== null) { const d = u.pendingDest; u.pendingDest = null; setRoute(sim, u, d); if (!u.route) { if (u.nodeId === d) arrive(sim, u); break; } continue; }
      if (u.seg >= u.route.edges.length) { arrive(sim, u); break; }
      // 교차로 통과 시 경로 재검토: 다음 구간이 통제됐거나 훨씬 빠른 길이 생겼는가
      const next = city.edges[u.route.edges[u.seg]];
      let remainT = 0; for (let k = u.seg; k < u.route.edges.length; k++) remainT += edgeTime(city.edges[u.route.edges[k]], wf);
      const alt = findRoute(city, u.nodeId, u.destNode!, wf);
      if (next.closed) {
        if (alt) {
          const add = Math.max(0, alt.time - remainT);
          if (u.state === 'enroute' && u.incidentId !== null) {
            raiseProblem(sim, sim.incidents[u.incidentId], 'ROUTE_BLOCKED', `${u.callsign} 이동 경로(${edgeName(city, next)}) 통제`, {
              role: 'UNIT', actor: u.callsign, text: `${u.callsign}: ${edgeName(city, next)} 통제 확인. 우회 경로로 변경합니다 (약 ${fmtSec(add)} 추가).`, imp: 2,
            }, false);
          }
          u.route = alt; u.seg = 0; u.segT = 0;
        } else { u.route = null; break; }
      } else if (alt && alt.time < remainT * 0.8) {
        u.route = alt; u.seg = 0; u.segT = 0;
      }
    }
    if (u.route && u.seg < u.route.edges.length) {
      const A = city.nodes[u.route.nodes[u.seg]], B = city.nodes[u.route.nodes[u.seg + 1]];
      u.x = A.x + (B.x - A.x) * u.segT; u.y = A.y + (B.y - A.y) * u.segT;
    } else if ((u.state as string) !== 'onscene') {
      const n = city.nodes[u.nodeId]; u.x = n.x; u.y = n.y;
    }
  }
}
