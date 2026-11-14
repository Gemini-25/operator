// AI Dispatch Coordinator — 필요한 능력별로 가장 적합한 부대를 고른다.
// 가장 가까운 부대가 아니라 (적합도 × 가중치 − 예상 도착 시간 − 피로·장비 상태 − 다른 사건 대비)로 점수를 매긴다.

import type { Sim } from '../engine';
import { emit, markRecovered, raiseProblem } from '../events';
import { transmit } from '../field/agents';
import { mkFact } from '../field/beliefs';
import { nodeName } from '../city';
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
  const urgent = s ? s.requests.some((q) => q.urgent && q.fulfilled < q.count) : false;
  // 오래 굶은 수요: 부대가 모자란 교대에서는 새로 들어온 위험한 사건이 늘 앞에 서서, 먼저 기다리던 사건이 끝내 부대를 받지 못한다.
  // 채워지지 않은 수요가 오래 밀릴수록 앞으로 당긴다. 아직 아무 부대도 가지 않은 사건은 신고 전화가 울린 때부터 센다
  // (접수 대기열에서 기다린 시간도 신고자에게는 똑같이 흘렀다)
  const unmet = ORDER.some((k) => (I.unmet[k] ?? 0) > 0);
  const never = I.firstArrivalAt < 0 && !I.assigned.length;
  const starved = !unmet ? 0 : never ? Math.max(sim.t - I.unmetSince, sim.t - Math.max(0, I.reportedAt) - 60) : sim.t - I.unmetSince - 40;
  const starve = Math.min(1.5, Math.max(0, starved) / (never ? 60 : 160));
  return (I.assessment ? I.assessment.severity : 1) + (urgent ? 0.6 : 0) + Math.min(0.5, (sim.t - Math.max(0, I.reportedAt)) / 240) + starve;
}

interface Cand { u: Unit; score: number; eta: number; fit: number; divertFrom: Incident | null }

function pickUnit(sim: Sim, I: Incident, key: keyof Needs, minCap: number): { best: Cand | null; nearest: Cand | null } {
  const sev = I.assessment!.severity;
  const cands: Cand[] = [];
  for (const u of sim.units) {
    const fit = u.caps[key];
    if (fit < minCap || crewReady(sim, u) === 0 || u.state === 'oos') continue;
    if (u.sea && !((I.assessment!.type === 'water' || I.assessment!.label === '선박 화재') && coastal(sim, I.reportedNode))) continue;      // 구조정은 바닷가의 수난 사고와 선박 화재에만 나간다
    if (u.air && key !== 'search' && sev < 2.3) continue;                                             // 헬기는 수색이나 큰 사건에만 뜬다
    if (I.assigned.indexOf(u.id) >= 0) continue;
    let divertFrom: Incident | null = null;
    if (u.state === 'enroute' || u.state === 'turnout') {
      const J = u.incidentId !== null ? sim.incidents[u.incidentId] : null;
      if (!J || u.diverted || sev < 2.3) continue;
      const gap = I.priority - J.priority;
      if (gap < (J.assigned.length > 1 ? 0.9 : 1.4)) continue;
      divertFrom = J;
    } else if (u.state !== 'available' && u.state !== 'returning') continue;
    const eta = etaFor(sim, u, I.reportedNode);
    let stamina = 0; for (const rid of u.crew) stamina += sim.responders[rid].stamina; stamina /= u.crew.length;
    let score = fit * 100 - eta * (0.45 + 0.22 * sev) - (100 - stamina) * 0.22;
    if (key === 'suppression' && u.pumpCond < 0.4) score -= 10;
    if (crewReady(sim, u) < u.crew.length) score -= 18;
    if (divertFrom) score -= 28;
    // 같은 부서의 마지막 가용 부대라면, 위험도가 낮은 사건에는 아껴 둔다
    const others = sim.units.filter((q) => q.dept === u.dept && q.id !== u.id && (q.state === 'available' || q.state === 'returning') && crewReady(sim, q) > 0).length;
    if (others === 0 && sev < 1.9) score -= 9;
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

export function tickDispatch(sim: Sim): void {
  if (sim.tick % 5 !== 2) return;
  const open = sim.incidents.filter((I) => I.phase !== 'closed' && I.assessment && I.locationKnown);
  for (const I of open) I.priority = priorityOf(sim, I);
  open.sort((a, b) => b.priority - a.priority || a.id - b.id);
  for (const I of open) {
    if (sim.t < I.unmetSince + 2) continue;      // 배정 판단에 걸리는 시간
    let progressed = false, blocked: (keyof Needs)[] = [];
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
