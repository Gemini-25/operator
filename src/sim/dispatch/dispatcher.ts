// AI Dispatch Coordinator — 필요한 능력별로 가장 적합한 부대를 고른다.
// 가장 가까운 부대가 아니라 (적합도 × 가중치 − 예상 도착 시간 − 피로·장비 상태 − 다른 사건 대비)로 점수를 매긴다.

import type { Sim } from '../engine';
import { emit, markRecovered, raiseProblem } from '../events';
import { transmit } from '../field/agents';
import { mkFact } from '../field/beliefs';
import { nodeName } from '../city';
import { crewHasKit, fieldCrew } from '../crews';
import { coastal, createAidUnit, crewReady, dispatchUnit, etaFor, sendUnitTo } from '../resources';
import type { Claim, Incident, Needs, RadioMsg, Scene, Unit } from '../types';
import { TYPE_NAME, fmtSec, josa } from '../util';
import { assess, emptyNeeds, needsText, sevName } from './analyst';

const ORDER: (keyof Needs)[] = ['eod', 'tactical', 'law', 'suppression', 'rescue', 'ems', 'traffic', 'search'];
const MINCAP: Record<keyof Needs, number> = { suppression: 0.7, rescue: 0.5, ems: 0.7, law: 0.5, tactical: 0.9, search: 0.3, traffic: 0.4, eod: 0.9 };
const NEED_LABEL: Record<keyof Needs, string> = { suppression: '진압', rescue: '구조', ems: '구급', law: '경찰', tactical: '경찰 기동', search: '수색', traffic: '교통 통제', eod: '폭발물 처리' };

/** 평가된 수요에서 이미 배정된 부대가 덮는 부분을 빼고 남은 수요를 계산한다. */
export function recomputeUnmet(sim: Sim, I: Incident): void {
  if (!I.assessment) return;
  const needs = I.assessment.needs;
  const used = new Set<number>();
  const unmet: Partial<Needs> = {};
  let any = false;
  for (const key of ORDER) {
    for (let k = 0; k < needs[key]; k++) {
      let best = -1, bc = 0;
      for (const uid of I.assigned) { if (used.has(uid)) continue; const c = sim.units[uid].caps[key]; if (c >= MINCAP[key] && c > bc) { bc = c; best = uid; } }
      if (best >= 0) used.add(best); else { unmet[key] = (unmet[key] ?? 0) + 1; any = true; }
    }
  }
  const had = ORDER.some((k) => (I.unmet[k] ?? 0) > 0);
  I.unmet = unmet;
  if (any && !had) { I.unmetSince = sim.t; I.noUnitLogged = false; }
}

function priorityOf(sim: Sim, I: Incident): number {
  const s = sim.scenes[I.id];
  // 현장의 급한 요청은 부대가 배정된 순간이 아니라 닿을 때까지 급하다 (배정되자마자 순위가 떨어져 전환 배정에 빼앗기지 않도록)
  const coming = I.assigned.some((uid) => sim.units[uid].state === 'enroute' || sim.units[uid].state === 'turnout');
  const urgent = s ? s.requests.some((q) => q.urgent && (q.fulfilled < q.count || (coming && sim.t - q.t < 240))) : false;
  // 오래 굶은 수요: 부대가 모자란 교대에서는 새로 들어온 위험한 사건이 늘 앞에 서서, 먼저 기다리던 사건이 끝내 부대를 받지 못한다.
  // 채워지지 않은 수요가 오래 밀릴수록 앞으로 당긴다. 아직 아무 부대도 닿지 않은 사건은 신고 전화가 울린 때부터 센다
  // (접수 대기열에서 기다린 시간도 신고자에게는 똑같이 흘렀다). 부대가 가는 중에도 그대로 두어, 오래 기다린 사건으로 가는 부대가
  // 더 급해 보이는 새 사건으로 전환 배정되지 않게 한다
  const unmet = ORDER.some((k) => (I.unmet[k] ?? 0) > 0);
  // 선착 대응 부대만 닿은 응급 환자는 아직 구급차를 기다리는 사건이다 (구급대원이 닿기 전까지는 아무도 닿지 않은 사건처럼 센다)
  const unserved = I.firstArrivalAt < 0 || (I.coResp !== undefined && !!s && !s.agents.some((a) => sim.units[a.unitId].dept === 'ems'));
  const starved = unserved ? Math.max(unmet ? sim.t - I.unmetSince : 0, sim.t - Math.max(0, I.reportedAt) - 60) : unmet ? sim.t - I.unmetSince - 40 : 0;
  const starve = Math.min(1.5, Math.max(0, starved) / (unserved ? 60 : 160));
  return (I.assessment ? I.assessment.severity : 1) + (urgent ? 0.6 : 0) + Math.min(0.5, (sim.t - Math.max(0, I.reportedAt)) / 240) + starve;
}

interface Cand { u: Unit; score: number; eta: number; fit: number; divertFrom: Incident | null }

/**
 * 장비 가산: 그 사건에 맞는 장비를 든 대원이 있는 부대를 조금 앞세운다 — 수난 사고의 구조 수요에는 구조 로프·구명환(+12),
 * 붕괴의 구조 수요에는 탐지 장비(+8). 관제가 아는 것만 본다: 평가한 유형과 자기 조직의 편성·장비(hasKit — 숨은 고장은 모른다).
 */
export function kitBonus(sim: Sim, u: Unit, I: Incident, key: keyof Needs): number {
  if (key !== 'rescue') return 0;
  const type = I.assessment!.type;
  if (type === 'water') return crewHasKit(sim, u, 'rope') || crewHasKit(sim, u, 'ring') ? 12 : 0;
  if (type === 'collapse') return crewHasKit(sim, u, 'searchKit') ? 8 : 0;
  return 0;
}

/** 추격전으로 평가한 사건의 관제 이름 (scenarios 의 납치·도주 차량) */
const CHASE_LABEL: Record<string, boolean> = { '납치': true, '도주 차량': true };
/** 의료 헬기를 띄우는 문턱: 가용 지상 구급 부대 가운데 가장 빠른 것의 예상 도착이 이보다 늦다 (초). 너무 자주 뜨면 올린다 */
const MED_HELI_ETA = 100;
/**
 * 헬기를 이 사건의 이 수요에 보내는가 — 0 이면 보내지 않고, 아니면 적합도에 곱하는 값 (설계서 R1 7.2).
 * 헬기의 일은 이 함수가 정한다: u.air 만 보고 보내면 경찰 헬기가 환자를 싣거나 의료 헬기가 수색에 뜬다.
 * 관제가 아는 것만 읽는다: 평가(I.assessment), 날씨, 자기 조직의 부대 상태(뜰 수 없는 이유·연료·위치), 헬기가 알린 '상공 임무 종료'(I.airDone), 접수한 현장 요청.
 *  - 모든 헬기: 뜰 수 없거나(안개·밤·강풍), 연료가 다녀올 만큼 남지 않았거나, 이 사건에서 이미 상공 임무를 마치고 돌아갔으면 0
 *  - 경찰 헬기: 수색 수요만 — 추격전(납치·도주 차량)과 무장·실종 사건은 1, 수난·붕괴·화재는 0.5(산불은 0). 현장 상공에 머물며 살핀다
 *  - 소방 헬기: 수색 수요는 실종·수난·붕괴·화재(산불은 낮 1.2, 밤에는 뜨지 않는다), 구조 수요는 위험도 2.3 이상이거나 수난 사고.
 *    구급 수요는 의료 헬기가 없는 편성(부대 규모 1·2 — 그때만 구급 능력이 기준을 넘는다)에서만, 큰 사건이거나 구급차를 60초 넘게 기다렸을 때
 *  - 의료 헬기: 구급 수요 — 밤이 아니고, 위험도 2.3 이상이거나 구급차를 60초 넘게 기다렸거나 현장이 급히 구급을 요청했거나 지상 구급차가 멀 때
 */
export function airFit(sim: Sim, u: Unit, I: Incident, key: keyof Needs): number {
  if (u.grounded) return 0;
  if (sim.disaster !== null && sim.disaster.kind === 'typhoon' && sim.disaster.phase === 'impact') return 0;      // 강풍이 닥친 바로 그 틱 (u.grounded 는 이 뒤의 tickUnits 가 적는다)
  if ((u.fuel ?? 0) < etaFor(sim, u, I.reportedNode) * 2 + 90) return 0;
  if (I.airDone && I.airDone.indexOf(u.kind) >= 0) return 0;
  const as = I.assessment!, type = as.type, night = sim.weather === 'night';
  if (u.kind === 'policeHeli') {
    if (key !== 'search') return 0;
    if (CHASE_LABEL[as.label ?? '']) return 1;
    if (type === 'armed' || type === 'search') return 1;      // 무장·실종 현장 상공의 관측 (밤에는 탐조등)
    if (type === 'water' || type === 'collapse' || type === 'fire') return as.label === '산불' ? 0 : 0.5;      // 바깥을 살필 눈. 산불은 물 바구니를 단 소방 헬기의 일이다
    return 0;      // 응급 환자의 선착 대응 등
  }
  if (u.kind === 'heli') {      // 소방 헬기
    if (key === 'search') {
      if (type !== 'search' && type !== 'water' && type !== 'collapse' && type !== 'fire') return 0;      // 무장 사건·응급 환자의 선착 대응에는 뜨지 않는다
      return as.label === '산불' ? (night ? 0 : 1.2) : 1;
    }
    if (key === 'rescue') return as.severity >= 2.3 || type === 'water' ? 1 : 0;
    // 구급 수요: 의료 헬기가 편성돼 있으면 그쪽의 일이다(소방 헬기의 구급 능력은 기준 밑이라 여기까지 오지 않는다).
    // 의료 헬기가 없는 편성(부대 규모 1·2)에서만 예전 규칙대로 — 큰 사건이거나 구급차를 60초 넘게 기다린 환자에게 뜬다
    if (key === 'ems') return u.caps.ems >= MINCAP.ems && (as.severity >= 2.3 || sim.t - I.unmetSince > 60) ? 1 : 0;
    return 0;
  }
  if (u.kind === 'medHeli') {
    if (key !== 'ems' || night) return 0;
    if (as.severity >= 2.3 || sim.t - I.unmetSince > 60) return 1;
    const s = sim.scenes[I.id];
    if (s) for (let k = 0; k < I.fieldNeedsSeen && k < s.requests.length; k++) { const q = s.requests[k]; if (q.need === 'ems' && q.urgent && q.fulfilled < q.count) return 1; }      // 관제가 접수한 급한 구급 요청이 아직 채워지지 않았다
    let near = Infinity;
    for (const q of sim.units) {
      if (q.air || q.caps.ems < MINCAP.ems || (q.state !== 'available' && q.state !== 'returning') || crewReady(sim, q) === 0 || I.assigned.indexOf(q.id) >= 0) continue;
      near = Math.min(near, etaFor(sim, q, I.reportedNode));
    }
    return near > MED_HELI_ETA ? 1 : 0;      // 지금 보낼 수 있는 지상 구급차가 없거나 멀다
  }
  return 0;
}

function pickUnit(sim: Sim, I: Incident, key: keyof Needs, minCap: number): { best: Cand | null; nearest: Cand | null } {
  const sev = I.assessment!.severity;
  const cands: Cand[] = [];
  for (const u of sim.units) {
    let fit = u.caps[key];
    if (fit < minCap || crewReady(sim, u) === 0 || u.state === 'oos') continue;
    if (u.sea && !((I.assessment!.type === 'water' || I.assessment!.label === '선박 화재') && coastal(sim, I.reportedNode))) continue;      // 구조정은 바닷가의 수난 사고와 선박 화재에만 나간다
    if (I.assigned.indexOf(u.id) >= 0) continue;
    if (u.air) { const m = airFit(sim, u, I, key); if (m <= 0) continue; fit *= m; }      // 헬기는 종류마다 맡는 수요가 다르다 (airFit)
    let divertFrom: Incident | null = null;
    if (u.state === 'enroute' || u.state === 'turnout') {
      const J = u.incidentId !== null ? sim.incidents[u.incidentId] : null;
      if (!J || u.diverted || sev < 2.3) continue;
      // 방금 부대를 빼앗긴 사건에서는 다시 빼 오지 않는다 (번갈아 빼앗기면 그 사건에는 끝내 아무도 닿지 못한다)
      if (J.problems.some((p) => p.code === 'DIVERTED' && sim.t - p.t < 120)) continue;
      const gap = I.priority - J.priority;
      if (gap < (J.assigned.filter((uid) => uid !== J.coResp).length > 1 ? 0.9 : 1.4)) continue;      // 선착 대응으로 함께 간 소방차는 세지 않는다 (그 사건의 하나뿐인 구급차를 쉽게 빼앗지 않게)
      divertFrom = J;
    } else if (u.state !== 'available' && u.state !== 'returning') continue;
    const eta = etaFor(sim, u, I.reportedNode);
    const fc = fieldCrew(sim, u);      // 현장에 내리는 자리만 본다 (조종사·정장 때문에 늘 감점되지 않게)
    let stamina = 0; for (const rid of fc) stamina += sim.responders[rid].stamina; stamina /= fc.length;
    let score = fit * 100 - eta * (0.45 + 0.22 * sev) - (100 - stamina) * 0.22;
    if (key === 'suppression' && u.pumpCond < 0.4) score -= 10;
    if (crewReady(sim, u) < fc.length) score -= 18;
    score += kitBonus(sim, u, I, key);
    if (divertFrom) score -= 28;
    // 같은 부서의 마지막 가용 부대라면, 위험도가 낮은 사건에는 아껴 둔다.
    // 헬기는 '남은 부대'로 세지 않고(경찰·의료 헬기가 남아 있다고 지상 부대를 다 내보내지 않게), 헬기 자신에게도 걸지 않는다
    if (!u.air && sev < 1.9) {
      const others = sim.units.filter((q) => q.dept === u.dept && q.id !== u.id && !q.air && (q.state === 'available' || q.state === 'returning') && crewReady(sim, q) > 0).length;
      if (others === 0) score -= 9;
    }
    cands.push({ u, score, eta, fit, divertFrom });
  }
  if (!cands.length) return { best: null, nearest: null };
  let best = cands[0], nearest = cands[0];
  for (const c of cands) { if (c.score > best.score) best = c; if (c.eta < nearest.eta) nearest = c; }
  return { best, nearest };
}

function sendUnit(sim: Sim, I: Incident, key: keyof Needs, c: Cand, nearest: Cand | null): void {
  const u = c.u;
  if (c.divertFrom) {
    const J = c.divertFrom;
    const k = J.assigned.indexOf(u.id); if (k >= 0) J.assigned.splice(k, 1);
    u.diverted = true;
    raiseProblem(sim, J, 'DIVERTED', `${josa(u.callsign, '이/가')} 더 긴급한 사건 ${josa(I.code, '으로/로')} 전환 배정`, { role: 'DISPATCH', actor: '배정 AI', imp: 2, text: `${josa(u.callsign, '을/를')} 더 긴급한 사건 ${josa(I.code, '으로/로')} 전환 배정합니다. 사건 ${josa(J.code, '은/는')} 대체 부대를 찾습니다.` }, false);
    if (!J.fieldVerified) recomputeUnmet(sim, J); else { J.unmet[key] = (J.unmet[key] ?? 0) + 1; J.unmetSince = sim.t; J.noUnitLogged = false; }
  }
  const first = I.firstDispatchAt < 0;
  dispatchUnit(sim, u, I, c.eta);
  if (u.air) u.airNeed = key;      // 헬기가 이번 출동에서 맡은 수요: 연료·강풍으로 돌아가면 resources.airRtb 가 이 수요를 되돌린다
  let why = `${I.assessment!.type === 'medical' && key === 'search' ? '선착 대응' : NEED_LABEL[key]} 수요, 적합도 ${Math.round(c.fit * 100)}%, 예상 도착 ${fmtSec(c.eta)}`;
  if (nearest && nearest.u.id !== u.id && nearest.eta < c.eta - 5) why += `. 더 가까운 ${nearest.u.callsign}(${fmtSec(nearest.eta)})보다 ${c.fit > nearest.fit ? '전문성이 높아' : '상태가 좋아'} 선택`;
  const ev = emit(sim, { inc: I.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 2, causes: [I.lastEvent], text: `출동 지령: ${u.callsign} → 사건 ${I.code} (${TYPE_NAME[I.assessment!.type]}, 위험도 ${sevName(I.assessment!.severity)}). ${why}.` });
  I.dispatchLog.push(ev);
  if (first) {
    I.firstDispatchAt = sim.t;
    I.firstAssess = { type: I.assessment!.type, severity: I.assessment!.severity, t: sim.t, eventId: ev };
  }
  if (I.phase === 'call' || I.phase === 'pending') I.phase = 'dispatched';
  const s = sim.scenes[I.id];
  if (s) for (const q of s.requests) if ((q.need === key || (key === 'law' && q.need === 'tactical')) && q.fulfilled < q.count) { q.fulfilled++; break; }
  if (I.noUnitLogged) {
    const wait = sim.t - I.unmetSince;
    const pe = markRecovered(I, 'NO_UNIT', `${Math.round(wait)}초 뒤 ${u.callsign} 배정`);
    if (wait > 40) raiseProblem(sim, I, 'BACKUP_LATE', `${NEED_LABEL[key]} 지원이 ${Math.round(wait)}초 늦게 배정됨`, { role: 'DISPATCH', actor: '배정 AI', imp: 1, causes: [pe], text: `${NEED_LABEL[key]} 지원이 요청 후 ${Math.round(wait)}초 만에 배정됐습니다.` }, false);
  }
}

/**
 * 중증 응급 환자의 선착 대응(동시 출동, '펌뷸런스'): 구급차가 모두 나가 있거나 멀면, 가장 가까운 소방 펌프차·사다리차·구조대를 함께 보낸다.
 * 소방대원은 기본 처치(지혈·가슴 압박)를 할 수 있다(지휘관: 응급 환자는 누구든 먼저 손을 쓴다). 구급차는 따로 계속 찾고, 닿으면 넘긴다.
 * 순찰차는 보내지 않는다 (호흡이 없는 환자에게는 analyst 가 선착 대응 수요로 가장 가까운 부대를 이미 함께 보낸다).
 * 관제가 아는 것만 쓴다: 부대의 위치·상태와 신고된 위치(I.reportedNode). 다른 사건에서 빼 오지 않고, 그 분야의 마지막 가용 부대는 남겨 둔다.
 */
export const CO_RESPOND = {
  sev: 1.7,      // 중증으로 본 환자에게만 (의식 없음·낙상 출혈·호흡 없음). 가벼운 실신에는 구급차를 기다린다
  eta: 50,       // 가장 나은 구급차의 예상 도착이 이보다 늦으면(또는 가용 구급차가 없으면) 선착 대응을 붙인다 (초)
  gain: 15,      // 선착 대응 부대가 구급차보다 적어도 이만큼 먼저 닿아야 보낸다 (초)
};
function firstResponder(sim: Sim, I: Incident): void {
  if (I.assessment!.severity < CO_RESPOND.sev) return;
  const amb = pickUnit(sim, I, 'ems', MINCAP.ems).best;
  if (amb && amb.eta <= CO_RESPOND.eta) return;
  let best: Unit | null = null, be = 1e9, beta = 0;
  for (const u of sim.units) {
    if (u.kind !== 'engine' && u.kind !== 'ladder' && u.kind !== 'rescue') continue;      // 소방의 지상 부대만 (특수 부대 — 화학·헬기·구조정 — 는 아껴 둔다)
    if (u.aid || (u.state !== 'available' && u.state !== 'returning') || crewReady(sim, u) === 0 || I.assigned.indexOf(u.id) >= 0) continue;
    const spare = sim.units.some((q) => q.id !== u.id && q.dept === u.dept && !q.air && !q.sea && (q.state === 'available' || q.state === 'returning') && crewReady(sim, q) > 0);
    if (!spare) continue;
    const eta = etaFor(sim, u, I.reportedNode);
    if (eta < be) { be = eta; best = u; beta = eta; }
  }
  if (!best || (amb && beta > amb.eta - CO_RESPOND.gain)) return;
  I.coResp = best.id;
  emit(sim, { inc: I.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 2, causes: [I.lastEvent], text: amb
    ? `구급차가 멀어(가장 나은 ${amb.u.callsign} 예상 ${fmtSec(amb.eta)}) 가까운 ${josa(best.callsign, '을/를')} 선착 대응으로 함께 보냅니다. 기본 처치를 먼저 시작합니다.`
    : `지금 보낼 수 있는 구급차가 없습니다. 가까운 ${josa(best.callsign, '을/를')} 선착 대응으로 먼저 보내고 구급차를 계속 찾습니다.` });
  sendUnit(sim, I, 'search', { u: best, score: 0, eta: beta, fit: best.caps.search, divertFrom: null }, null);
}

export function tickDispatch(sim: Sim): void {
  if (sim.tick % 5 !== 2) return;
  const open = sim.incidents.filter((I) => I.phase !== 'closed' && I.assessment && I.locationKnown);
  for (const I of open) I.priority = priorityOf(sim, I);
  open.sort((a, b) => b.priority - a.priority || a.id - b.id);
  for (const I of open) {
    if (sim.t < I.unmetSince + 2) continue;      // 배정 판단에 걸리는 시간
    let progressed = false, blocked: (keyof Needs)[] = [];
    if (I.assessment!.type === 'medical' && I.coResp === undefined && (I.unmet.ems ?? 0) > 0 && I.firstArrivalAt < 0 && !I.assigned.some((uid) => sim.units[uid].dept !== 'ems')) firstResponder(sim, I);
    for (const key of ORDER) {
      while ((I.unmet[key] ?? 0) > 0) {
        let { best, nearest } = pickUnit(sim, I, key, MINCAP[key]);
        if (!best && key === 'tactical') ({ best, nearest } = pickUnit(sim, I, 'law', MINCAP.law));
        if (!best) { blocked.push(key); break; }
        I.unmet[key]!--;
        sendUnit(sim, I, key, best, nearest);
        progressed = true;
      }
    }
    if (blocked.length && !I.noUnitLogged) {
      I.noUnitLogged = true;
      const partial = I.assigned.length > 0;
      raiseProblem(sim, I, 'NO_UNIT', `가용 ${blocked.map((k) => NEED_LABEL[k]).join('·')} 부대 없음`, {
        role: 'DISPATCH', actor: '배정 AI', imp: 2, causes: [I.lastEvent],
        text: `사건 ${I.code}: 가용 ${blocked.map((k) => NEED_LABEL[k]).join('·')} 부대가 없습니다. ${partial ? '현재 배정된 부대로 우선 대응하고' : '출동 가능한 부대가 생길 때까지'} 대기열에 올립니다.`,
      }, false);
    }
    if (!blocked.length && progressed) I.noUnitLogged = false;
    // 인근 도시 지원: 가용 부대가 없어 한참 밀린 수요가 있으면(사건당 한 번, 교대당 정해진 횟수 안에서) 외부 부대를 부른다
    if (blocked.length && I.aidUnit === undefined && sim.aidUsed < sim.tune.aidUnits && sim.t - I.unmetSince >= AID_WAIT && (I.unmet[blocked[0]] ?? 0) > 0) {
      const key = blocked[0];
      const u = createAidUnit(sim, key, I);
      if (u) {
        sim.aidUsed++; I.aidUnit = u.id;
        emit(sim, { inc: I.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 2, causes: [I.lastEvent], text: `인근 도시에 지원 요청: 가용 ${NEED_LABEL[key]} 부대가 ${Math.round(sim.t - I.unmetSince)}초째 없습니다. ${josa(u.callsign, '이/가')} ${nodeName(sim.city, u.homeNode)} 방면에서 들어옵니다 (이번 교대 지원 ${sim.aidUsed}/${sim.tune.aidUnits}회).` });
        I.unmet[key]!--;
        sendUnit(sim, I, key, { u, score: 0, eta: etaFor(sim, u, I.reportedNode) + AID_DELAY, fit: u.caps[key], divertFrom: null }, null);
        u.timer += AID_DELAY;      // 지원 요청이 접수되어 출발하기까지
      }
    }
  }
}
const AID_WAIT = 30, AID_DELAY = 18;

/** 관제가 아는 위치가 바뀌었다: 그 사건으로 가는 부대의 목적지를 고친다. */
export function redirectUnits(sim: Sim, I: Incident): void {
  const names: string[] = [];
  for (const uid of I.assigned) {
    const u = sim.units[uid];
    if (u.state === 'enroute') { sendUnitTo(sim, u, I.reportedNode); names.push(u.callsign); }
    else if (u.state === 'turnout') { u.destNode = I.reportedNode; names.push(u.callsign); }
  }
  if (names.length) emit(sim, { inc: I.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 2, causes: [I.lastEvent], text: `위치 정정: ${names.join(', ')} 목적지를 ${josa(nodeName(sim.city, I.reportedNode), '으로/로')} 변경.` });
}

/** 현장 지휘관의 무전(상황 보고·지원 요청)을 관제가 수신했다. */
export function fieldReport(sim: Sim, I: Incident, s: Scene, m: RadioMsg): void {
  if (I.phase === 'closed') return;
  I.fieldVerified = true;
  const cmd = s.agents.find((a) => a.rid === m.from);
  const tb = cmd ? cmd.beliefs.get('type', 0) : undefined;
  if (tb && tb.verified && I.assessment && tb.value !== I.assessment.type) {
    I.fieldType = tb.value;
    assess(sim, I, '현장 지휘관 보고');
  }
  while (I.fieldNeedsSeen < s.requests.length) {
    const q = s.requests[I.fieldNeedsSeen++];
    I.unmet[q.need] = Math.max(I.unmet[q.need] ?? 0, q.count);
    I.unmetSince = sim.t; I.noUnitLogged = false;
    emit(sim, { inc: I.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 1, causes: [q.eventId], text: `현장 지원 요청 접수 (${NEED_LABEL[q.need]}). 가용 부대를 확인합니다.` });
  }
}

/** 부대가 출동한 뒤 들어온 추가 신고 내용을 현장에 전달한다. */
export function briefUpdate(sim: Sim, I: Incident, c: Claim): void {
  const s = sim.scenes[I.id];
  if (!s || !s.agents.length) return;
  if (c.topic !== 'count' && c.topic !== 'trapped' && c.topic !== 'detail' && c.topic !== 'injured') return;
  let count: number | null = null, region = -1;
  for (const q of I.claims) {
    if (q.topic === 'count' && typeof q.value === 'number') count = count === null ? q.value : Math.max(count, q.value);
    if (q.topic === 'detail' && q.value && typeof q.value.region === 'number') region = q.value.region;
    if ((q.topic === 'injured' || q.topic === 'trapped') && q.value === true && count === null) count = 1;
  }
  if (count === null && region < 0) return;
  const where = region >= 0 && region < s.regions.length ? ` · ${s.regions[region].name} 부근` : '';
  const f = mkFact('occ', 1 + c.callId, { count, region, trapped: c.topic === 'trapped' && c.value === true }, '추가 신고', sim.t, c.conf, false, `추가 신고: ${count !== null ? `요구조자 약 ${count}명` : '요구조자 위치 정보'}${where}`);
  transmit(sim, s, null, -1, 'brief', [f], `현장 지휘관, 추가 신고 내용 전달: ${f.text.replace('추가 신고: ', '')} (미확인).`, -1, 1, I.callEvents.slice(-1));
}

export { emptyNeeds, needsText };
