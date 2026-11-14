// IncidentGenerator + IncidentManager
// 사건 템플릿에 위치·규모·숨은 위험·신고 정확도 등을 조합해 매번 다른 사건을 만든다.

import { findRoute, nodeName } from './city';
import { evaluate } from './debrief';
import { startCall, startNuisanceCall } from './dispatch/callSystem';
import type { Sim } from './engine';
import { emit } from './events';
import { createScene } from './field/sceneManager';
import { releaseUnit } from './resources';
import type { Rng } from './rng';
import type { District, Incident, IncidentType } from './types';
import { OUTCOME_NAME, TYPE_NAME } from './util';

export interface GenState {
  nextAt: number; lastType: IncidentType | null; count: number; lastCreated: number;
  nextNuisanceAt: number;                                        // 다음 비긴급 전화
  chain: { at: number; note: string }[];                         // 연쇄 사건 예약 (도주 용의자의 재범 등)
}
export function initGenerator(rng: Rng): GenState { return { nextAt: rng.range(10, 22), lastType: null, count: 0, lastCreated: 0, nextNuisanceAt: 40, chain: [] }; }

const PLACE: Record<IncidentType, Record<District, string>> = {
  fire: { residential: '다세대 주택', commercial: '상가 건물', industrial: '공장 작업동', outskirts: '외곽 펜션' },
  traffic: { residential: '주택가 교차로', commercial: '도심 교차로', industrial: '공단 진입로', outskirts: '외곽 도로' },
  search: { residential: '근린공원', commercial: '도심 공원', industrial: '공단 뒤 야산', outskirts: '외곽 산책로' },
  armed: { residential: '주택가 편의점', commercial: '상점가 매장', industrial: '공단 매점', outskirts: '외곽 휴게소' },
  medical: { residential: '단독 주택', commercial: '오피스텔', industrial: '기숙사', outskirts: '농가 주택' },
  collapse: { residential: '노후 연립 주택', commercial: '공사 중인 상가', industrial: '노후 창고', outskirts: '외곽 가건물' },
  hazmat: { residential: '주택가 도시가스 정압실', commercial: '상가 지하 기계실', industrial: '화학 공장 배관동', outskirts: '외곽 저장 시설' },
};

function createIncident(sim: Sim, chainNote = ''): Incident {
  const rng = sim.rngGen, g = sim.gen, tn = sim.tune;
  const types: IncidentType[] = ['fire', 'traffic', 'search', 'armed', 'medical', 'collapse', 'hazmat'];
  const w = [0.27, 0.24, 0.17, tn.armedWeight, 0.2, 0.075, 0.085].map((v, k) => (types[k] === g.lastType ? v * 0.3 : v));
  const type = chainNote ? 'armed' : rng.weighted(types, w);
  g.lastType = type;
  let severity = rng.weighted([1, 2, 3], tn.sevWeights);
  let variant = 'std';
  if (chainNote) { variant = 'robbery'; severity = Math.max(2, severity); }
  else if (type === 'armed') {
    variant = rng.weighted(['robbery', 'dispute', 'shooter', 'hostage'], [0.4, 0.28, tn.shooterWeight, 0.16]);
    if (variant === 'shooter' || variant === 'hostage') severity = 3; else if (variant === 'dispute') severity = Math.min(severity, 2);
    else severity = Math.max(2, severity);
    // 장난 전화: 실제로는 아무 일도 없다
    if (rng.chance(tn.falseAlarmProb * 0.8)) { variant = 'prank'; severity = 1; }
  } else if (type === 'search') variant = rng.chance(0.45) ? 'wander' : 'hiker';
  else if (type === 'medical') variant = severity >= 3 ? 'arrest' : severity === 2 ? 'trauma' : 'faint';
  else if (type === 'fire' && rng.chance(tn.falseAlarmProb)) { variant = 'false'; severity = 1; }      // 오인 신고: 탄 음식, 경보 오작동
  // 위치
  const busy = new Set(sim.incidents.filter((I) => I.phase !== 'closed').map((I) => I.truth.nodeId));
  const fac = new Set(sim.city.facilities.map((f) => f.nodeId));
  const ok = (d: District): boolean => type === 'search' ? d === 'outskirts' : type === 'armed' ? d === 'commercial' || d === 'residential' : type === 'fire' ? d !== 'outskirts' || rng.chance(0.2) : type === 'medical' ? d !== 'industrial' || rng.chance(0.3) : type === 'hazmat' ? d === 'industrial' || d === 'commercial' || rng.chance(0.25) : type === 'collapse' ? d !== 'outskirts' || rng.chance(0.3) : true;
  let cands = sim.city.nodes.filter((n) => !busy.has(n.id) && !fac.has(n.id) && ok(n.district) && (type !== 'traffic' || n.edges.length >= 3));
  if (!cands.length) cands = sim.city.nodes.filter((n) => !busy.has(n.id) && !fac.has(n.id));
  const node = rng.pick(cands);
  const id = sim.incidents.length;
  const code = (id + 1 < 10 ? '0' : '') + (id + 1);
  const I: Incident = {
    id, code,
    truth: { type, variant, severity, nodeId: node.id, x: node.x, y: node.y, district: node.district, label: `${nodeName(sim.city, node.id)} ${PLACE[type][node.district]}` },
    createdAt: sim.t, phase: 'unreported', reportedAt: -1, answeredAt: -1, claims: [], locationKnown: false, assessment: null,
    assigned: [], everAssigned: [], unmet: {}, unmetSince: 0, noUnitLogged: false,
    firstDispatchAt: -1, firstArrivalAt: -1, closedAt: -1, fieldVerified: false, fieldType: null, priority: 1,
    problems: [], result: null, lastEvent: -1, rootEvent: -1, callEvents: [], callsCount: 0, closeReason: '', interest: 0,
    blockedEdge: -1, followupAt: Infinity, firstCallAt: 0, firstAssess: null, fieldNeedsSeen: 0, dispatchLog: [],
    reportedNode: node.id, addressFixed: false,
  };
  sim.incidents.push(I);
  createScene(sim, I);
  { const sc = sim.scenes[I.id]; if (sc && sc.placeName) I.truth.label = `${nodeName(sim.city, node.id)} ${sc.placeName}`; }      // 현장을 만들면서 정해진 장소 이름
  const delay = type === 'fire' ? rng.range(6, 16) : type === 'traffic' ? rng.range(3, 8) : type === 'search' ? rng.range(1, 3) : type === 'medical' ? rng.range(2, 6) : type === 'collapse' ? rng.range(3, 8) : type === 'hazmat' ? rng.range(8, 20) : rng.range(4, 11);
  I.firstCallAt = sim.t + delay;
  const benign = variant === 'false' || variant === 'prank';
  const pFollow = benign ? 0 : type === 'fire' ? 0.6 : type === 'traffic' ? 0.5 : type === 'armed' ? 0.42 : type === 'collapse' ? 0.55 : type === 'hazmat' ? 0.4 : 0.12;
  if (rng.chance(pFollow)) I.followupAt = I.firstCallAt + rng.range(24, 55);
  if (type === 'traffic') {
    // 사고 지점 도로는 느려지고, 통제가 끝나면 전면 차단된다(우회로가 있는 도로만)
    const es = node.edges.map((e) => sim.city.edges[e]).filter((e) => !e.closed);
    es.sort((a, b) => (b.arterial ? 1 : 0) - (a.arterial ? 1 : 0) || a.id - b.id);
    for (const e of es) { if (findRoute(sim.city, e.a, e.b, 1, e.id)) { I.blockedEdge = e.id; e.slow += 1.4; break; } }
  }
  const what = variant === 'false' ? '실제 화재는 없음 — 오인 신고가 들어올 예정' : variant === 'prank' ? '실제 사건은 없음 — 장난 전화가 걸려 올 예정' : `${TYPE_NAME[type]}`;
  I.rootEvent = emit(sim, { inc: id, role: 'SYSTEM', actor: '도시', kind: 'incident', imp: 1, truth: true, text: chainNote ? `${chainNote} — ${I.truth.label}.` : `사건 발생 — ${I.truth.label} (${what}). 아직 신고되지 않았습니다.` });
  return I;
}

export function tickIncidents(sim: Sim): void {
  const g = sim.gen;
  let open = 0;
  for (const I of sim.incidents) {
    if (I.phase === 'closed') continue;
    open++;
    if (I.phase === 'unreported' && sim.t >= I.firstCallAt) startCall(sim, I, false);
    if (sim.t >= I.followupAt && I.phase !== 'unreported') { I.followupAt = Infinity; startCall(sim, I, true); }
    if (I.firstArrivalAt < 0 && I.reportedAt >= 0 && sim.t - I.reportedAt > 330) closeIncident(sim, I, 'noresponse');
  }
  const tn = sim.tune;
  // 사건과 무관한 비긴급 전화: 접수 회선을 잠시 점유한다
  if (sim.t >= g.nextNuisanceAt && sim.t < sim.shiftLen - 60) {
    g.nextNuisanceAt = sim.t + tn.nuisanceGap * sim.rngNuisance.range(0.55, 1.5);
    startNuisanceCall(sim);
  }
  // 연쇄 사건
  if (g.chain.length && sim.t >= g.chain[0].at) {
    const c = g.chain.shift()!;
    if (sim.t < sim.shiftLen - 150 && open <= tn.maxConcurrent) createIncident(sim, c.note);
  }
  // 생성: 진행 중인 사건 수와 가용 자원에 어느 정도 영향을 받는다
  if (sim.t >= sim.shiftLen - 150 || g.count >= tn.maxIncidents) return;
  if (sim.t < g.nextAt) {
    if (open === 0 && g.count > 0 && sim.t - g.lastCreated > 75 && g.nextAt - sim.t > 25) g.nextAt = sim.t + sim.rngGen.range(8, 22);
    return;
  }
  if (open >= tn.maxConcurrent) { g.nextAt = sim.t + 18; return; }
  const avail = sim.units.filter((u) => u.state === 'available').length;
  if (open >= tn.maxConcurrent - 1 && avail <= 1) { g.nextAt = sim.t + 22; return; }
  createIncident(sim);
  g.count++; g.lastCreated = sim.t;
  g.nextAt = sim.t + sim.rngGen.range(105, 215) * tn.gapMul * (avail <= 2 ? 1.2 : 1);
}

export function closeIncident(sim: Sim, I: Incident, reason: 'resolved' | 'timeout' | 'noresponse' | 'abandoned' | 'shiftend'): void {
  if (I.phase === 'closed') return;
  const s = sim.scenes[I.id]!;
  I.phase = 'closed'; I.closedAt = sim.t; I.closeReason = reason;
  s.closing = true;
  I.unmet = {};
  if (I.blockedEdge >= 0) {
    const e = sim.city.edges[I.blockedEdge];
    e.slow = Math.max(0, e.slow - 1.4);
    if (e.closedReason === 'incident') { e.closed = false; e.closedReason = null; }
  }
  for (const c of sim.calls) if (c.incidentId === I.id && c.state === 'ringing') c.state = 'done';
  for (const uid of I.assigned.slice()) {
    const u = sim.units[uid];
    if (u.state === 'enroute' || u.state === 'turnout') {
      const wasTurnout = u.state === 'turnout';
      releaseUnit(sim, u);
      if (wasTurnout) u.state = 'available';
      emit(sim, { inc: I.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 0, text: `${u.callsign} 출동 취소 — 사건 ${I.code} 종료.` });
    }
  }
  I.result = evaluate(sim, I, reason);
  emit(sim, { inc: I.id, role: 'SYSTEM', actor: '사건 관리', kind: 'resolve', imp: 3, causes: [I.lastEvent], text: `사건 ${I.code} 종료 — ${OUTCOME_NAME[I.result.outcome]}. ${I.result.headline}` });
}
