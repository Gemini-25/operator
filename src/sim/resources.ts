// ResourceManager — 부대·대원 명부, 차량 상태와 도시 지도 위 이동.

import { coastY, edgeName, edgeTime, findRoute, nodeName, weatherSpeedFactor } from './city';
import type { Sim } from './engine';
import { emit, raiseProblem } from './events';
import { unitArrived } from './field/sceneManager';
import { Rng } from './rng';
import { gateWait, reportObstacle, stopAhead } from './traffic';
import type { Obstacle } from './traffic';
import type { Dept, Incident, Needs, Responder, RoadEdge, Unit, UnitCaps, UnitField, UnitKind } from './types';
import { clamp, fmtSec, josa } from './util';

const NAMES = ['김도윤', '이서준', '박하준', '최민재', '정지호', '강현우', '윤서연', '한지민', '오수아', '임채원', '신유나', '조은서',
  '배준영', '류시우', '문가은', '송태윤', '황보라', '안지후', '남궁민', '서예린', '권도현', '홍서진', '장하늘', '민지원', '차은우', '표나연', '석민호', '엄지안',
  '여준서', '길하은', '변우진', '탁서윤', '함도경', '채아린', '옥진우', '소유진', '봉재현', '추다은', '공시현', '금나래'];

interface UnitDef { callsign: string; dept: Dept; kind: UnitKind; field: UnitField; facility: string; caps: UnitCaps; waterMax: number; tool: number; med: number; armor: number; minLevel: number }
const caps = (suppression: number, rescue: number, ems: number, law: number, tactical: number, search: number, traffic: number, eod = 0): UnitCaps =>
  ({ suppression, rescue, ems, law, tactical, search, traffic, eod });
const KIND: Record<UnitKind, { dept: Dept; caps: UnitCaps; waterMax: number; tool: number; med: number; armor: number }> = {
  engine: { dept: 'fire', caps: caps(1.0, 0.55, 0.2, 0, 0, 0.5, 0.4), waterMax: 100, tool: 0.55, med: 0.35, armor: 0.1 },
  ladder: { dept: 'fire', caps: caps(1.0, 0.7, 0.2, 0, 0, 0.5, 0.3), waterMax: 140, tool: 0.7, med: 0.35, armor: 0.1 },
  rescue: { dept: 'fire', caps: caps(0.75, 1.0, 0.25, 0, 0, 0.8, 0.4), waterMax: 60, tool: 1.0, med: 0.4, armor: 0.1 },
  hazmat: { dept: 'fire', caps: caps(0.6, 0.9, 0.3, 0, 0, 0.5, 0.3), waterMax: 40, tool: 0.9, med: 0.45, armor: 0.15 },
  heli: { dept: 'fire', caps: caps(0, 0.8, 0.7, 0, 0, 1.5, 0), waterMax: 0, tool: 0.6, med: 0.8, armor: 0.05 },
  boat: { dept: 'fire', caps: caps(0, 0.9, 0.5, 0, 0, 0.8, 0), waterMax: 0, tool: 0.8, med: 0.5, armor: 0.05 },
  als: { dept: 'ems', caps: caps(0, 0.15, 1.0, 0, 0, 0.3, 0.2), waterMax: 0, tool: 0.1, med: 1.0, armor: 0 },
  bls: { dept: 'ems', caps: caps(0, 0.15, 0.8, 0, 0, 0.3, 0.2), waterMax: 0, tool: 0.1, med: 0.75, armor: 0 },
  patrol: { dept: 'police', caps: caps(0, 0.15, 0.15, 0.8, 0.5, 0.7, 1.0), waterMax: 0, tool: 0.12, med: 0.25, armor: 0.2 },
  tactical: { dept: 'police', caps: caps(0, 0.15, 0.15, 1.0, 1.0, 0.7, 0.7), waterMax: 0, tool: 0.12, med: 0.25, armor: 0.5 },
  swat: { dept: 'police', caps: caps(0, 0.15, 0.2, 1.0, 1.4, 0.5, 0.3), waterMax: 0, tool: 0.2, med: 0.3, armor: 0.75 },
  eod: { dept: 'police', caps: caps(0, 0.2, 0.15, 0.6, 0.5, 0.4, 0.4, 1), waterMax: 0, tool: 0.3, med: 0.25, armor: 0.6 },
};
/** 큰 차: 불법 주차로 좁아진 골목을 지나지 못한다 (traffic.ts) */
const HEAVY: Partial<Record<UnitKind, boolean>> = { engine: true, ladder: true, rescue: true, hazmat: true };
const U = (callsign: string, kind: UnitKind, field: UnitField, facility: string, minLevel: number): UnitDef => ({ callsign, kind, field, facility, minLevel, ...KIND[kind] });
// 편성표: 네 분야(경찰·소방·구조·특수)마다 3~5팀. minLevel 은 난이도의 "부대 규모"가 이 값 이상일 때 편성된다
// (1 = 12팀, 2 = 15팀, 3 = 17팀, 4 = 19팀, 5 = 20팀). 줄의 순서를 바꾸면 대원 능력치가 바뀐다(이 순서로 뽑는다).
const UNIT_DEFS: UnitDef[] = [
  U('순찰1', 'patrol', 'police', '중부경찰서', 1), U('순찰2', 'patrol', 'police', '서부지구대', 1), U('기동1', 'tactical', 'police', '동부지구대', 1), U('순찰3', 'patrol', 'police', '동부지구대', 2), U('기동2', 'tactical', 'police', '중부경찰서', 4),
  U('진압1', 'engine', 'fire', '중앙소방서', 1), U('진압2', 'engine', 'fire', '서부119안전센터', 1), U('사다리1', 'ladder', 'fire', '공단119안전센터', 1), U('진압3', 'engine', 'fire', '한솔119안전센터', 3), U('진압4', 'engine', 'fire', '공단119안전센터', 5),
  U('구조1', 'rescue', 'rescue', '중앙소방서', 1), U('구급1', 'als', 'rescue', '중앙소방서', 1), U('구급2', 'bls', 'rescue', '서부119안전센터', 1), U('구급3', 'als', 'rescue', '공단119안전센터', 2), U('구조2', 'rescue', 'rescue', '한솔119안전센터', 4),
  U('특공1', 'swat', 'special', '중부경찰서', 1), U('헬기1', 'heli', 'special', '소방항공대', 1), U('화학1', 'hazmat', 'special', '공단119안전센터', 1), U('구조정1', 'boat', 'special', '해양구조대', 2), U('폭발물1', 'eod', 'special', '중부경찰서', 3),
];

export const UNIT_KIND_NAME: Record<UnitKind, string> = { engine: '진압 펌프차', rescue: '구조 공작차', als: '전문 구급차', bls: '일반 구급차', patrol: '순찰차', tactical: '기동 순찰차', ladder: '사다리차', hazmat: '화학 구조차', swat: '특공대 장갑차', eod: '폭발물 처리 차량', heli: '구조 헬기', boat: '구조정' };
export const FIELD_NAME: Record<UnitField, string> = { police: '경찰', fire: '소방', rescue: '구조·구급', special: '특수' };

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
  UNIT_DEFS.forEach((d, di) => {
    const f = sim.city.facilities.find((q) => q.name === d.facility)!;
    const home = sim.city.nodes[f.nodeId];
    const include = d.minLevel <= tn.unitLevel;
    const uid = sim.units.length;
    const crew: number[] = [];
    for (let k = 0; k < 2; k++) {
      // 편성되지 않는 부대도 난수는 똑같이 뽑는다(부대 규모를 바꿔도 같은 대원은 같은 능력치를 갖도록)
      const senior = k === 0;
      const st = () => clamp(rosterRng.range(0.3, 0.95), 0, 1);
      const exp = senior ? rosterRng.range(0.6, 0.97) : rosterRng.range(0.12, 0.6);
      const skill = clamp(st() * 0.6 + exp * 0.4 + 0.05, 0.3, 0.98);
      const r: Responder = {
        id: sim.responders.length, name: NAMES[di * 2 + k], dept: d.dept, unitId: uid, senior,
        skill, judgment: clamp(st() * 0.65 + exp * 0.35, 0.2, 0.98), composure: st(), fitness: st(), teamwork: st(), experience: exp,
        skills: { fire: 0.05, rescue: 0.2, medical: 0.2, law: 0.05 },
        trait: '', health: 100, stamina: tn.startStamina, status: 'ok', xpGained: 0, incidentsWorked: 0,
      };
      if (d.kind === 'heli' || d.kind === 'boat') r.skills = { fire: 0.15, rescue: skill, medical: d.kind === 'heli' ? 0.55 : 0.45, law: 0.05 };
      else if (d.kind === 'hazmat') r.skills = { fire: skill * 0.7, rescue: skill * 0.92, medical: 0.4, law: 0.05 };
      else if (d.dept === 'fire') r.skills = d.kind === 'rescue' ? { fire: skill * 0.75, rescue: skill, medical: 0.35, law: 0.05 } : { fire: skill, rescue: skill * 0.6, medical: 0.3, law: 0.05 };
      else if (d.dept === 'ems') r.skills = { fire: 0.05, rescue: 0.25, medical: clamp(skill + (d.kind === 'als' ? 0.08 : 0), 0, 1), law: 0.05 };
      else r.skills = { fire: 0.05, rescue: 0.22, medical: 0.22, law: clamp(skill + (d.kind === 'swat' ? 0.12 : d.kind === 'tactical' ? 0.06 : d.kind === 'eod' ? -0.08 : 0), 0, 1) };
      r.trait = traitOf(r);
      if (include) { crew.push(r.id); sim.responders.push(r); }
    }
    const pump = d.dept === 'fire' ? equipRng.range(tn.pumpMin, tn.pumpMax) : 1;
    if (!include) return;
    const u: Unit = {
      id: uid, callsign: d.callsign, dept: d.dept, kind: d.kind, crew, homeNode: f.nodeId, homeName: f.name,
      state: 'available', x: home.x, y: home.y, px: home.x, py: home.y, nodeId: f.nodeId,
      route: null, seg: 0, segT: 0, pendingDest: null, destNode: null, incidentId: null, timer: 0,
      caps: d.caps, water: d.waterMax * tn.waterMul, waterMax: d.waterMax * tn.waterMul, hydrant: false,
      pumpCond: pump, pumpFailed: false,
      tool: Math.min(1.15, d.tool * tn.toolMul), medLevel: Math.min(1.1, d.med * tn.medMul), armor: Math.min(0.8, d.armor * tn.armorMul),
      flashbangs: d.kind === 'tactical' ? tn.flashbangs : d.kind === 'swat' ? tn.flashbangs + 2 : 0,
      patients: [], patientsIncident: null,
      dispatchedAt: -1, estArrive: -1, diverted: false, busyTime: 0, runs: 0, boardOrder: null,
      field: d.field, air: d.kind === 'heli', sea: d.kind === 'boat',
    };
    if (u.air || u.sea) { u.x = u.px = f.x + 30; u.y = u.py = u.sea ? coastY(f.x + 30) + SEA_OFF : f.y - 20; }
    if (HEAVY[d.kind]) u.heavy = true;
    sim.units.push(u);
  });
}

const AID_NAMES = ['한도현', '서지우', '문태윤', '양서아', '고준혁', '배하린', '남건우', '유채원', '심재민', '노은서', '하승우', '전소율', '곽민석', '우다인', '진현수', '방예린'];
const AID_KIND: Record<keyof Needs, UnitKind> = { suppression: 'engine', rescue: 'rescue', ems: 'bls', law: 'patrol', tactical: 'tactical', search: 'patrol', traffic: 'patrol', eod: 'eod' };
const AID_CALL: Partial<Record<UnitKind, string>> = { engine: '지원진압', rescue: '지원구조', als: '지원구급', bls: '지원구급', patrol: '지원순찰', tactical: '지원기동', eod: '지원폭발물' };

/**
 * 인근 도시 지원 부대를 만든다. 도시 가장자리의 교차로 가운데 사건 현장에 가장 빨리 닿는 곳에서 출발한다.
 * 임무를 마치고 그 자리로 돌아가면 관할로 복귀한 것으로 보고 다시 쓰지 않는다.
 */
export function createAidUnit(sim: Sim, key: keyof Needs, I: Incident): Unit | null {
  const kind = AID_KIND[key], d = UNIT_DEFS.find((q) => q.kind === kind)!;
  const wf = weatherSpeedFactor(sim);
  let home = -1, bt = Infinity;
  for (const n of sim.city.nodes) {
    if (!n.exit) continue;      // 도시 밖으로 이어지는 길의 끝에서 들어온다
    const rt = findRoute(sim.city, n.id, I.reportedNode, wf);
    if (rt && rt.time < bt) { bt = rt.time; home = n.id; }
  }
  if (home < 0) return null;
  const rng = sim.rng.fork('aid:' + sim.aidUsed), tn = sim.tune;
  const uid = sim.units.length, crew: number[] = [];
  for (let k = 0; k < 2; k++) {
    const senior = k === 0;
    const st = (): number => clamp(rng.range(0.3, 0.9), 0, 1);
    const exp = senior ? rng.range(0.55, 0.9) : rng.range(0.15, 0.55);
    const skill = clamp(st() * 0.6 + exp * 0.4 + 0.05, 0.3, 0.95);
    const r: Responder = {
      id: sim.responders.length, name: AID_NAMES[(sim.aidUsed * 2 + k) % AID_NAMES.length], dept: d.dept, unitId: uid, senior,
      skill, judgment: clamp(st() * 0.65 + exp * 0.35, 0.2, 0.95), composure: st(), fitness: st(), teamwork: st() * 0.85, experience: exp,
      skills: { fire: 0.05, rescue: 0.2, medical: 0.2, law: 0.05 },
      trait: '', health: 100, stamina: 88, status: 'ok', xpGained: 0, incidentsWorked: 0,
    };
    if (d.dept === 'fire') r.skills = kind === 'rescue' ? { fire: skill * 0.75, rescue: skill, medical: 0.35, law: 0.05 } : { fire: skill, rescue: skill * 0.6, medical: 0.3, law: 0.05 };
    else if (d.dept === 'ems') r.skills = { fire: 0.05, rescue: 0.25, medical: skill, law: 0.05 };
    else r.skills = { fire: 0.05, rescue: 0.22, medical: 0.22, law: clamp(skill + (kind === 'tactical' ? 0.06 : 0), 0, 1) };
    r.trait = traitOf(r);
    crew.push(r.id); sim.responders.push(r);
  }
  const n = sim.city.nodes[home];
  const same = sim.units.filter((q) => q.aid && q.kind === kind).length;
  const u: Unit = {
    id: uid, callsign: (AID_CALL[kind] ?? '지원') + (same + 1), dept: d.dept, kind, crew, homeNode: home, homeName: '인근 도시',
    state: 'available', x: n.x, y: n.y, px: n.x, py: n.y, nodeId: home,
    route: null, seg: 0, segT: 0, pendingDest: null, destNode: null, incidentId: null, timer: 0,
    caps: d.caps, water: d.waterMax * tn.waterMul, waterMax: d.waterMax * tn.waterMul, hydrant: false,
    pumpCond: d.dept === 'fire' ? rng.range(0.6, 0.95) : 1, pumpFailed: false,
    tool: Math.min(1.15, d.tool * tn.toolMul), medLevel: Math.min(1.1, d.med * tn.medMul), armor: Math.min(0.8, d.armor * tn.armorMul),
    flashbangs: kind === 'tactical' ? Math.min(2, tn.flashbangs) : 0,
    patients: [], patientsIncident: null,
    dispatchedAt: -1, estArrive: -1, diverted: false, busyTime: 0, runs: 0, boardOrder: null, aid: true,
  };
  if (HEAVY[kind]) u.heavy = true;
  sim.units.push(u);
  return u;
}

export function crewNames(sim: Sim, u: Unit): string { return u.crew.map((r) => sim.responders[r].name).join('·'); }
export function crewReady(sim: Sim, u: Unit): number { return u.crew.filter((r) => sim.responders[r].status === 'ok').length; }

const AIR_SPEED = 66, SEA_SPEED = 30, SEA_OFF = 46;
/** 바닷가의 교차로인가 (구조정이 닿을 수 있다) */
export function coastal(sim: Sim, nodeId: number): boolean { const n = sim.city.nodes[nodeId]; return coastY(n.x) - n.y < 280; }
/** 헬기·구조정이 향하는 지점. 사건 현장이면 그 건물 앞, 아니면 교차로(구조정은 그 앞바다). */
function offroadTarget(sim: Sim, u: Unit, destNode: number): [number, number] {
  const n = sim.city.nodes[destNode];
  let tx = n.x, ty = n.y;
  if (u.state === 'enroute' && u.incidentId !== null) { const I = sim.incidents[u.incidentId]; if (I.truth.nodeId === destNode && I.truth.placeId >= 0) { const pl = sim.city.places[I.truth.placeId]; tx = pl.x + pl.w / 2; ty = pl.y + pl.h / 2; } }
  else if (destNode === u.homeNode) { const f = sim.city.facilities.find((q) => q.name === u.homeName); if (f) { tx = f.x + 30; ty = f.y - 20; } }
  if (u.sea) ty = coastY(tx) + SEA_OFF;
  return [tx, ty];
}

/** 현재 상태에서 목적지까지 예상 소요 시간(초). 관제 AI 가 배정 판단에 사용한다. */
export function etaFor(sim: Sim, u: Unit, destNode: number): number {
  const wf = weatherSpeedFactor(sim);
  if (u.air || u.sea) { const n = sim.city.nodes[destNode], d = u.sea ? Math.abs(n.x - u.x) * 1.04 : Math.hypot(n.x - u.x, n.y - u.y); return d / ((u.air ? AIR_SPEED : SEA_SPEED) * wf) + (u.state === 'available' ? 10 : 0); }
  let from = u.nodeId, extra = 0;
  if (u.state === 'available') extra = 6;
  if (u.route && u.seg < u.route.edges.length && (u.state === 'enroute' || u.state === 'returning' || u.state === 'transport')) {
    const e = sim.city.edges[u.route.edges[u.seg]];
    extra += (1 - u.segT) * edgeTime(e, wf, u.heavy);
    from = u.route.nodes[u.seg + 1];
  }
  if (u.curb && !u.parking) extra += ((u.curbT ?? 0) * u.curb.len) / (CURB_SPEED * wf);
  const r = findRoute(sim.city, from, destNode, wf, -1, u.heavy);
  return r ? r.time + extra : 9999;
}

function setRoute(sim: Sim, u: Unit, to: number): void {
  u.destNode = to; u.seg = 0; u.segT = 0; u.backing = false;
  u.route = u.nodeId === to ? null : findRoute(sim.city, u.nodeId, to, weatherSpeedFactor(sim), -1, u.heavy);
}

/**
 * 길을 막은 것(traffic.ts 의 장애물) 앞에서 되돌아 나온다: 들어온 교차로로 되짚어 가서 다른 길로 간다.
 * 아직 알려지지 않은 것이면 이 부대가 무전으로 알린다(그 뒤로는 모든 경로 계산이 그 구간을 피한다).
 */
function turnBack(sim: Sim, u: Unit, e: RoadEdge, o: Obstacle, wf: number): void {
  const city = sim.city, rt = u.route!, A = rt.nodes[u.seg], B = rt.nodes[u.seg + 1];
  if (!o.known) reportObstacle(sim, o, u.callsign);
  const et = Math.max(0.5, edgeTime(e, wf, u.heavy) - (e.wait ?? 0)), back = u.segT * et;
  let remainT = (1 - u.segT) * et; for (let k = u.seg + 1; k < rt.edges.length; k++) remainT += edgeTime(city.edges[rt.edges[k]], wf, u.heavy);
  const alt = findRoute(city, A, u.destNode!, wf, -1, u.heavy);
  if (u.state === 'enroute' && u.incidentId !== null) {
    raiseProblem(sim, sim.incidents[u.incidentId], 'ROUTE_BLOCKED', `${u.callsign} 이동 경로(${edgeName(city, e)}) 막힘 — ${o.label}`, {
      role: 'UNIT', actor: u.callsign, text: `${u.callsign}: ${edgeName(city, e)} — ${josa(o.label, '으로/로')} 지나갈 수 없습니다. 되돌아 우회합니다.`, imp: 2,
    }, false);
  }
  sim.traffic.stats.detours++; sim.traffic.stats.delaySec += Math.max(0, back + (alt ? alt.time : 0) - remainT);
  // 경로가 없으면 들어온 교차로까지만 되돌아가 기다린다 (아래의 "경로가 끊겨 대기"가 다시 시도한다)
  u.route = { nodes: [B, A, ...(alt ? alt.nodes.slice(1) : [])], edges: [e.id, ...(alt ? alt.edges : [])], time: back + (alt ? alt.time : 0) };
  u.seg = 0; u.segT = 1 - u.segT; u.backing = true;
}

/** 목적지 설정. 구간 주행 중이면 다음 교차로까지는 그대로 달린 뒤 새 경로를 잡는다. */
export function sendUnitTo(sim: Sim, u: Unit, destNode: number): void {
  if (u.air || u.sea) { u.pendingDest = null; u.destNode = destNode; u.route = null; u.seg = 0; u.segT = 0; return; }
  if (u.route && u.seg < u.route.edges.length && u.segT > 0) { u.pendingDest = destNode; u.destNode = destNode; return; }
  u.pendingDest = null;
  setRoute(sim, u, destNode);
}

export function dispatchUnit(sim: Sim, u: Unit, I: Incident, eta: number): void {
  const wasMoving = u.state === 'returning' || u.state === 'enroute';
  u.incidentId = I.id; u.dispatchedAt = sim.t; u.estArrive = sim.t + eta; u.runs++;
  u.boardOrder = null;
  if (wasMoving) { u.state = 'enroute'; sendUnitTo(sim, u, I.reportedNode); }
  else { u.state = 'turnout'; u.timer = 5 + (1 - sim.responders[u.crew[0]].experience) * 3; u.destNode = I.reportedNode; }
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
  // 가장 빨리 닿는 병원으로 간다
  let hosp = sim.city.facilities.find((f) => f.kind === 'hospital')!, bt = Infinity;
  for (const f of sim.city.facilities) { if (f.kind !== 'hospital') continue; const t = etaFor(sim, u, f.nodeId); if (t < bt) { bt = t; hosp = f; } }
  u.state = 'transport';
  sendUnitTo(sim, u, hosp.nodeId);
}

const CURB_SPEED = 42;      // 길가로 붙을 때의 속도 (지도 단위/초)
function curbPos(sim: Sim, u: Unit): void {
  const n = sim.city.nodes[u.nodeId], k = u.curbT ?? 0;
  u.x = n.x + (u.curb!.x - n.x) * k; u.y = n.y + (u.curb!.y - n.y) * k;
}

function arrive(sim: Sim, u: Unit): void {
  u.route = null; u.seg = 0; u.segT = 0;
  const n = sim.city.nodes[u.nodeId];
  const parked = !!u.curb && (u.curbT ?? 0) >= 1;
  if (!parked && !u.air && !u.sea) { u.x = n.x; u.y = n.y; }
  if (u.state === 'enroute') {
    const I = u.incidentId !== null ? sim.incidents[u.incidentId] : null;
    if (!I || I.phase === 'closed') { releaseUnit(sim, u); return; }
    if (I.pursuit && I.pursuit.state === 'driving') return;      // 추격 중: 알려진 위치에 닿았지만 차는 이미 지나갔다. 다음 위치가 전해질 때까지 그 자리에서 기다린다
    if (u.nodeId !== I.truth.nodeId) {
      // 신고된 위치에 와 보니 현장이 없다 → 관제가 신고자에게 다시 확인해 위치를 바로잡는다
      if (!I.addressFixed) {
        I.addressFixed = true;
        const wrong = I.reportedNode; I.reportedNode = I.truth.nodeId;
        const ev = raiseProblem(sim, I, 'WRONG_ADDRESS', `신고 위치(${nodeName(sim.city, wrong)})에 현장이 없음`, { role: 'UNIT', actor: u.callsign, imp: 3, causes: I.callEvents.slice(0, 2), text: `${u.callsign}: 신고 위치에 도착했지만 현장이 없습니다. 위치 재확인 바랍니다.` }, false);
        emit(sim, { inc: I.id, role: 'CALL_TAKER', actor: '신고 접수 AI', kind: 'call', imp: 2, causes: [ev], text: `신고자에게 다시 확인했습니다. 실제 위치는 ${nodeName(sim.city, I.truth.nodeId)}입니다. 출동 부대에 정정 전달.` });
        for (const uid of I.assigned) { const q = sim.units[uid]; if (q.id !== u.id && q.state === 'enroute') sendUnitTo(sim, q, I.reportedNode); else if (q.state === 'turnout') q.destNode = I.reportedNode; }
      }
      u.state = 'turnout'; u.timer = 7; u.destNode = I.truth.nodeId;
      u.estArrive = sim.t + 7 + etaFor(sim, { ...u, state: 'available' } as Unit, I.truth.nodeId);
      u.dispatchedAt = Math.min(u.dispatchedAt, sim.t);
      return;
    }
    // 교차로에 닿았으면 그 건물 앞 길가까지 마저 간다
    const pl = I.truth.placeId >= 0 ? sim.city.places[I.truth.placeId] : null;
    if (pl && !u.curb && !u.air && !u.sea) {
      const len = Math.hypot(pl.cx - n.x, pl.cy - n.y);
      if (len > 8) { u.curb = { x: pl.cx, y: pl.cy, len }; u.curbT = 0; u.parking = true; return; }
    }
    const took = sim.t - u.dispatchedAt, est = u.estArrive - u.dispatchedAt;
    if (took > est * 1.35 + 6 && !I.pursuit) {
      raiseProblem(sim, I, 'TRAFFIC_DELAY', `${u.callsign} 도착이 예상보다 ${fmtSec(took - est)} 지연`, {
        role: 'UNIT', actor: u.callsign, text: `${u.callsign}: 교통 상황으로 예상보다 ${fmtSec(took - est)} 늦게 도착.`, imp: 1,
      });
    }
    u.state = 'onscene';
    unitArrived(sim, I, u);
  } else if (u.state === 'transport') {
    // 응급실이 붐비면(먼저 온 구급차가 인계 중이면) 인계가 늦어진다
    const waiting = sim.units.filter((q) => q.id !== u.id && q.state === 'hospital' && q.nodeId === u.nodeId).length;
    u.state = 'hospital'; u.timer = 8 + waiting * 9 + Math.max(0, u.patients.length - 1) * 3;
    if (waiting > 0) emit(sim, { inc: u.patientsIncident ?? -1, role: 'UNIT', actor: u.callsign, kind: 'unit', imp: 1, text: `${u.callsign}: 응급실이 붐벼 환자 인계가 늦어집니다 (앞에 ${waiting}대).` });
  } else if (u.state === 'returning') {
    u.water = u.waterMax; u.hydrant = false;
    if (u.pumpFailed) { u.pumpFailed = false; u.pumpCond = 0.55; }
    u.state = crewReady(sim, u) === 0 || u.aid ? 'oos' : 'available';
    if (u.aid) emit(sim, { role: 'UNIT', actor: u.callsign, kind: 'unit', text: `${u.callsign}: 지원 임무를 마치고 관할로 복귀했습니다.`, imp: 1 });
    else if (u.state === 'oos') emit(sim, { role: 'UNIT', actor: u.callsign, kind: 'unit', text: `${u.callsign} 대원 전원 부상으로 운용 중단.`, imp: 2 });
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
        const q = Math.min(1, u.medLevel * 0.95);
        if (!c.dead && sim.t - c.tLoaded > 6 && q > c.treatQ + 0.05) { c.treated = true; if (c.tTreated < 0) c.tTreated = sim.t; c.treatQ = q; c.bleed = c.bleed0 * (1 - 0.9 * q); }
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
          emit(sim, { inc: I!.id, role: 'UNIT', actor: u.callsign, kind: 'casualty', text: `${u.callsign}: ${sim.city.facilities.find((f) => f.kind === 'hospital' && f.nodeId === u.nodeId)?.name ?? '병원'} 도착, 환자 ${alive}명 인계 완료.`, imp: 1 });
        }
        u.patients = []; u.patientsIncident = null;
        releaseUnit(sim, u);
      }
      continue;
    }
    if (u.air || u.sea) {
      // 헬기는 곧장 날고, 구조정은 해안을 따라 간다
      const dest = u.destNode ?? u.homeNode, [tx, ty] = offroadTarget(sim, u, dest);
      if (u.air) {
        const d = Math.hypot(tx - u.x, ty - u.y), step = AIR_SPEED * wf * dt;
        if (d <= step) { u.x = tx; u.y = ty; u.nodeId = dest; arrive(sim, u); } else { u.x += ((tx - u.x) / d) * step; u.y += ((ty - u.y) / d) * step; }
      } else {
        const d = Math.abs(tx - u.x), step = SEA_SPEED * wf * dt;
        if (d <= step) { u.x = tx; u.y = ty; u.nodeId = dest; arrive(sim, u); } else { u.x += Math.sign(tx - u.x) * step; u.y = coastY(u.x) + SEA_OFF; }
      }
      continue;
    }
    if (u.curb) {
      const step = (dt * CURB_SPEED * wf) / u.curb.len;
      if (u.parking && u.state === 'enroute' && u.destNode === u.nodeId) {
        // 건물 앞 길가로 붙는다
        u.curbT = Math.min(1, (u.curbT ?? 0) + step); curbPos(sim, u);
        if (u.curbT >= 1) { u.parking = false; arrive(sim, u); }
        continue;
      }
      // 떠날 때는 길가에서 교차로로 돌아 나온 뒤 경로를 따른다
      u.parking = false;
      u.curbT = Math.max(0, (u.curbT ?? 0) - step); curbPos(sim, u);
      if (u.curbT <= 0) u.curb = null;
      continue;
    }
    // 이동 (enroute / transport / returning)
    if (!u.route) {
      if (u.destNode === null || u.nodeId === u.destNode) { arrive(sim, u); continue; }
      setRoute(sim, u, u.destNode);       // 경로가 끊겨 대기 중이었다면 재시도
      if (!u.route) continue;
    }
    // 경로는 떠날 때 잡지만 길가에서 교차로로 나오는 데 몇 초가 걸린다. 그 사이에 첫 구간이 통제됐다고 알려졌으면(재난·사건·공사) 들어서기 전에 다시 잡는다
    if (u.segT === 0 && !u.backing && u.seg < u.route.edges.length) {
      const first = city.edges[u.route.edges[u.seg]];
      if ((first.closed && first.known !== false) || (u.heavy && first.noHeavy)) {
        const alt = findRoute(city, u.nodeId, u.destNode!, wf, -1, u.heavy);
        if (alt && u.state === 'enroute' && u.incidentId !== null) {
          raiseProblem(sim, sim.incidents[u.incidentId], 'ROUTE_BLOCKED', `${u.callsign} 이동 경로(${edgeName(city, first)}) 통제`, {
            role: 'UNIT', actor: u.callsign, text: `${u.callsign}: ${edgeName(city, first)} 통제 확인. 우회 경로로 변경합니다.`, imp: 2,
          }, false);
        }
        u.route = alt; u.seg = 0; u.segT = 0;
        if (!u.route) continue;      // 길이 끊겼다: 여기서 기다린다 (위의 재시도가 다시 본다)
      }
    }
    let budget = dt;
    let guard = 0;
    while (budget > 0 && u.route && guard++ < 8) {
      const e = city.edges[u.route.edges[u.seg]];
      const et = Math.max(0.5, edgeTime(e, wf, u.heavy) - (e.wait ?? 0));      // 달리는 시간만 (차단기 앞에서 기다리는 시간은 아래에서 실제로 선다)
      // 교통: 내려온 건널목 차단기 앞에서는 기다리고, 길을 막은 것에 닿으면 되돌아 나온다
      const stop = stopAhead(sim, u, e, u.route.nodes[u.seg]);
      if (stop && u.segT + budget / et >= stop.at) {
        budget -= Math.max(0, stop.at - u.segT) * et; u.segT = Math.max(u.segT, stop.at);
        if (stop.o) { turnBack(sim, u, e, stop.o, wf); continue; }
        gateWait(sim, u, e); break;
      }
      const remain = (1 - u.segT) * et;
      if (budget < remain) { u.segT += budget / et; budget = 0; break; }
      budget -= remain;
      u.nodeId = u.route.nodes[u.seg + 1];
      u.seg++; u.segT = 0; u.backing = false;
      if (u.pendingDest !== null) { const d = u.pendingDest; u.pendingDest = null; setRoute(sim, u, d); if (!u.route) { if (u.nodeId === d) arrive(sim, u); break; } continue; }
      if (u.seg >= u.route.edges.length) { if (u.nodeId !== u.destNode) { u.route = null; break; } arrive(sim, u); break; }      // 되돌아 나왔지만 다른 길이 없다: 여기서 기다린다
      // 교차로 통과 시 경로 재검토: 다음 구간이 통제됐다고 알려졌거나 훨씬 빠른 길이 생겼는가 (모르는 통제는 가 보아야 안다)
      const next = city.edges[u.route.edges[u.seg]];
      let remainT = 0; for (let k = u.seg; k < u.route.edges.length; k++) { const q = city.edges[u.route.edges[k]]; remainT += edgeTime(q, wf, u.heavy) - Math.min(q.wait ?? 0, remainT); }      // findRoute 와 같은 셈법
      const alt = findRoute(city, u.nodeId, u.destNode!, wf, -1, u.heavy);
      if ((next.closed && next.known !== false) || (u.heavy && next.noHeavy)) {
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
