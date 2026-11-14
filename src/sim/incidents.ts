// IncidentGenerator + IncidentManager
// 사건 템플릿에 위치·규모·숨은 위험·신고 정확도 등을 조합해 매번 다른 사건을 만든다.

import { edgeName, findRoute, nodeName } from './city';
import { evaluate } from './debrief';
import { startCall, startNuisanceCall } from './dispatch/callSystem';
import type { Sim } from './engine';
import { emit } from './events';
import { createScene } from './field/sceneManager';
import { releaseUnit } from './resources';
import type { Rng } from './rng';
import { INCIDENT_PLACES } from './cityPlan';
import { startPursuit } from './pursuit';
import { SCENARIOS, scenarioName, scenarioOf } from './scenarios';
import type { Scenario } from './scenarios';
import type { Incident, IncidentType, Place, PlaceKind } from './types';
import { OUTCOME_NAME, TYPE_NAME } from './util';

export interface GenState {
  nextAt: number; lastType: IncidentType | null; count: number; lastCreated: number;
  nextNuisanceAt: number;                                        // 다음 비긴급 전화
  chain: { at: number; note: string }[];                         // 연쇄 사건 예약 (도주 용의자의 재범 등)
}
export function initGenerator(rng: Rng): GenState { return { nextAt: rng.range(10, 22), lastType: null, count: 0, lastCreated: 0, nextNuisanceAt: 40, chain: [] }; }

/** 무장 사건의 변형에 따라 잘 일어나는 곳이 다르다 */
const ARMED_BIAS: Record<string, Partial<Record<PlaceKind, number>>> = {
  robbery: { bank: 2.2, convenience: 1.8, gasStation: 1.6, shop: 1.4 },
  dispute: { restaurant: 3, market: 2, hotel: 1.5, bank: 0.2 },
  shooter: { mart: 2.5, market: 2, office: 2, terminal: 2, convenience: 0.4 },
  hostage: { bank: 2, office: 1.6, hotel: 1.5 },
};

const kindCount = new WeakMap<object, Map<string, number>>();
/** 사건이 일어날 건물이나 터를 고른다. 교통사고는 교차로에서 일어나므로 null. */
function pickPlace(sim: Sim, rng: Rng, type: IncidentType, variant: string, busy: Set<number>): Place | null {
  const table = scenarioOf(type, variant)?.places ?? INCIDENT_PLACES[type];
  const used = new Set(sim.incidents.map((I) => I.truth.placeId));
  // 표의 값은 건물 종류 전체의 몫이므로, 그 종류의 건물 수로 나눠 한 채의 비중을 구한다
  if (!kindCount.has(sim.city.places)) { const m = new Map<string, number>(); for (const q of sim.city.places) if (q.facility < 0) m.set(q.kind, (m.get(q.kind) ?? 0) + 1); kindCount.set(sim.city.places, m); }
  const counts = kindCount.get(sim.city.places)!;
  const weigh = (q: Place, strict: boolean): number => {
    let w = (table[q.kind] ?? 0) / (counts.get(q.kind) ?? 1);
    if (w <= 0 || q.facility >= 0) return 0;
    if (strict && (busy.has(q.nodeId) || used.has(q.id))) return 0;
    if (type === 'armed') w *= ARMED_BIAS[variant]?.[q.kind] ?? 1;
    if (type === 'search' && variant === 'hiker' && q.kind !== 'forest') return 0;
    return w;
  };
  let ws = sim.city.places.map((q) => weigh(q, true));
  if (!ws.some((v) => v > 0)) ws = sim.city.places.map((q) => weigh(q, false));
  if (!ws.some((v) => v > 0)) return null;
  return rng.weighted(sim.city.places, ws);
}

function createIncident(sim: Sim, chainNote = ''): Incident {
  const rng = sim.rngGen, g = sim.gen, tn = sim.tune;
  const types: IncidentType[] = ['fire', 'traffic', 'search', 'armed', 'medical', 'collapse', 'hazmat', 'water'];
  const w = [0.27, 0.24, 0.17, tn.armedWeight, 0.2, 0.075, 0.085, 0.07].map((v, k) => (types[k] === g.lastType ? v * 0.3 : v));
  const type = chainNote ? 'armed' : rng.weighted(types, w);
  g.lastType = type;
  let severity = rng.weighted([1, 2, 3], tn.sevWeights);
  let variant = 'std';
  // 시나리오: 유형 안에서 정해진 몫만큼 다른 모습의 사건이 된다 (scenarios.ts)
  let special: Scenario | null = null;
  { const cs = SCENARIOS.filter((q) => q.type === type); if (cs.length && !chainNote) { let r = rng.next(); for (const q of cs) { r -= q.share; if (r < 0) { special = q; break; } } } }
  if (special) { variant = special.variant; severity = rng.int(special.severity[0], special.severity[1]); }
  else if (chainNote) { variant = 'robbery'; severity = Math.max(2, severity); }
  else if (type === 'armed') {
    variant = rng.weighted(['robbery', 'dispute', 'shooter', 'hostage'], [0.4, 0.28, tn.shooterWeight, 0.16]);
    if (variant === 'shooter' || variant === 'hostage') severity = 3; else if (variant === 'dispute') severity = Math.min(severity, 2);
    else severity = Math.max(2, severity);
    // 장난 전화: 실제로는 아무 일도 없다
    if (rng.chance(tn.falseAlarmProb * 0.8)) { variant = 'prank'; severity = 1; }
  } else if (type === 'search') variant = rng.chance(0.45) ? 'wander' : 'hiker';
  else if (type === 'traffic' && severity >= 2 && rng.chance(severity >= 3 ? 0.28 : 0.06)) { variant = 'bus'; severity = 3; }      // 버스가 낀 다수 사상자 사고
  else if (type === 'medical') variant = severity >= 3 ? 'arrest' : severity === 2 ? 'trauma' : 'faint';
  else if (type === 'fire' && rng.chance(tn.falseAlarmProb)) { variant = 'false'; severity = 1; }      // 오인 신고: 탄 음식, 경보 오작동
  // 위치: 유형에 맞는 건물이나 터를 고른다 (교통사고는 교차로)
  const busy = new Set(sim.incidents.filter((I) => I.phase !== 'closed').map((I) => I.truth.nodeId));
  const place = type === 'traffic' ? null : pickPlace(sim, rng, type, variant, busy);
  let node = place ? sim.city.nodes[place.nodeId] : null;
  if (!node) {
    const fac = new Set(sim.city.facilities.map((f) => f.nodeId));
    let cands = sim.city.nodes.filter((n) => !busy.has(n.id) && !fac.has(n.id) && n.edges.length >= 3);
    if (!cands.length) cands = sim.city.nodes.filter((n) => !busy.has(n.id));
    node = rng.pick(cands);
  }
  const label = place ? (place.open ? `${place.name} (${place.addr})` : `${place.addr} ${place.name}`) : `${nodeName(sim.city, node.id)} 교차로`;
  const id = sim.incidents.length;
  const code = (id + 1 < 10 ? '0' : '') + (id + 1);
  const I: Incident = {
    id, code,
    truth: { type, variant, severity, nodeId: node.id, x: place ? place.x + place.w / 2 : node.x, y: place ? place.y + place.h / 2 : node.y, district: place ? place.district : node.district, label, placeId: place ? place.id : -1, placeKind: place ? place.kind : null },
    createdAt: sim.t, phase: 'unreported', reportedAt: -1, answeredAt: -1, claims: [], locationKnown: false, assessment: null,
    assigned: [], everAssigned: [], unmet: {}, unmetSince: 0, noUnitLogged: false,
    firstDispatchAt: -1, firstArrivalAt: -1, closedAt: -1, fieldVerified: false, fieldType: null, priority: 1,
    problems: [], result: null, lastEvent: -1, rootEvent: -1, callEvents: [], callsCount: 0, closeReason: '', interest: 0,
    blockedEdge: -1, followupAt: Infinity, firstCallAt: 0, firstAssess: null, fieldNeedsSeen: 0, dispatchLog: [],
    reportedNode: node.id, addressFixed: false,
  };
  sim.incidents.push(I);
  createScene(sim, I);
  { const sc = sim.scenes[I.id]; if (sc && sc.placeName && !place) I.truth.label = `${nodeName(sim.city, node.id)} ${sc.placeName}`; }      // 교차로 사고: 현장을 만들면서 정해진 이름
  const delay = type === 'fire' ? rng.range(6, 16) : type === 'traffic' ? rng.range(3, 8) : type === 'search' ? rng.range(1, 3) : type === 'medical' ? rng.range(2, 6) : type === 'collapse' ? rng.range(3, 8) : type === 'water' ? rng.range(2, 6) : type === 'hazmat' ? rng.range(8, 20) : rng.range(4, 11);
  I.firstCallAt = sim.t + delay;
  const benign = variant === 'false' || variant === 'prank';
  const pFollow = benign ? 0 : type === 'fire' ? 0.6 : type === 'traffic' ? 0.5 : type === 'armed' ? 0.42 : type === 'collapse' ? 0.55 : type === 'hazmat' ? 0.4 : type === 'water' ? 0.3 : 0.12;
  if (rng.chance(pFollow)) I.followupAt = I.firstCallAt + rng.range(24, 55);
  if (type === 'traffic') {
    // 사고 지점 도로는 느려지고, 통제가 끝나면 전면 차단된다(우회로가 있는 도로만)
    const es = node.edges.map((e) => sim.city.edges[e]).filter((e) => !e.closed && e.cls !== 'highway');
    es.sort((a, b) => (b.arterial ? 1 : 0) - (a.arterial ? 1 : 0) || a.id - b.id);
    for (const e of es) { if (findRoute(sim.city, e.a, e.b, 1, e.id)) { I.blockedEdge = e.id; e.slow += 1.4; break; } }
    if (variant === 'tree' && I.blockedEdge >= 0) {
      // 쓰러진 나무가 길을 막았다: 치울 때까지 그 구간은 지나갈 수 없고, 이웃한 길이 밀린다
      const e = sim.city.edges[I.blockedEdge];
      e.closed = true; e.closedReason = 'incident';
      for (const k of node.edges) if (k !== e.id) sim.city.edges[k].cong = Math.min(3, sim.city.edges[k].cong + 0.7);
      emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', text: `${edgeName(sim.city, e)} 통행 불가 — 쓰러진 나무가 길을 막았습니다.`, imp: 1, truth: true });
    }
  }
  const what = variant === 'false' ? '실제 화재는 없음 — 오인 신고가 들어올 예정' : variant === 'prank' ? '실제 사건은 없음 — 장난 전화가 걸려 올 예정' : scenarioName(type, variant) === TYPE_NAME[type] ? TYPE_NAME[type] : `${TYPE_NAME[type]} · ${scenarioName(type, variant)}`;
  if (variant === 'kidnap' || variant === 'drunk') startPursuit(sim, I, variant);
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
  if (open >= tn.maxConcurrent - 1 && avail <= 3) { g.nextAt = sim.t + 22; return; }
  createIncident(sim);
  g.count++; g.lastCreated = sim.t;
  g.nextAt = sim.t + sim.rngGen.range(50, 108) * tn.gapMul * (avail <= 5 ? 1.2 : 1);      // 조직이 커진 만큼 사건도 잦다 (보통에서 교대당 12건쯤)
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
