// 결과 평가 — 사건별 최종 판정과 원인 분석, 교대 종료 보고서.
// 판정은 AI 가 믿는 내용이 아니라 엔진의 진실 상태로 내린다(지휘관이 놓친 구조 대상도 여기서 드러난다).
// 원인 설명 문장은 시뮬레이션 중 실제로 기록된 문제(Problem)와 타임라인에서만 만든다.

import { scenarioName } from './scenarios';
import { personaName } from './dispatch/callSystem';
import { sevName } from './dispatch/analyst';
import { difficultyLabel } from './difficulty';
import { disasterSummary } from './disaster';
import type { Sim } from './engine';
import type { Incident, IncidentResult, Outcome, Problem, ProblemCode, ShiftReport } from './types';
import { TYPE_NAME, fmtSec, josa, pct } from './util';

export const PROBLEM_LABEL: Record<ProblemCode, string> = {
  CALL_QUEUE: '신고 대기', CALL_MISINFO: '신고자의 잘못된 정보', CALL_VAGUE: '불명확한 신고', MISJUDGE_TYPE: '사건 유형 오판', UNDERESTIMATE: '위험도 과소평가', OVERESTIMATE: '위험도 과대평가',
  NO_UNIT: '가용 부대 부족', UNDER_DISPATCH: '전문 부대 없이 대응 시작', DIVERTED: '부대 전환 배정', ROUTE_BLOCKED: '이동 경로 통제', TRAFFIC_DELAY: '교통 지연',
  PATH_BLOCKED: '현장 진입로 차단', VICTIM_MISSED: '수색에서 대상 누락', EQUIP_FAIL: '장비 고장', WATER_OUT: '용수 소진', RESPONDER_HURT: '대원 부상', COMM_FAIL: '무전 전달 실패',
  ESCALATION: '상황 악화', BACKUP_LATE: '지원 지연', SCENE_MISMATCH: '신고와 다른 현장 상황', SUSPECT_FLED: '용의자 도주', SECONDARY_COLLISION: '2차 사고', LATE_DISCOVERY: '구조 대상 발견 지연',
  TIMEOUT: '대응 시간 초과', FATIGUE: '대원 체력 고갈', HIDDEN_HAZARD: '숨겨진 위험 발현', RECOUNT: '인원 불일치 재수색', WRONG_ADDRESS: '신고 위치 오류', FALSE_ALARM: '허위·오인 신고',
};

const RESP_LIMIT: Record<string, number> = { fire: 95, armed: 95, traffic: 105, search: 125, medical: 80, collapse: 100, hazmat: 100, water: 90 };

function addProblem(I: Incident, code: ProblemCode, t: number, eventId: number, detail: string, recovered = false, recoveryText = ''): void {
  if (I.problems.some((p) => p.code === code && p.detail === detail)) return;
  I.problems.push({ code, t, eventId, detail, recovered, recoveryText });
}

export function evaluate(sim: Sim, I: Incident, reason: string): IncidentResult {
  const s = sim.scenes[I.id]!;
  const cas = s.casualties;
  let saved = 0, lost = 0, undiscovered = 0, critical = 0, left = 0;
  for (const c of cas) {
    if (c.dead) lost++;
    else if (c.tDiscovered < 0) undiscovered++;
    else if (c.where === 'safe' || c.where === 'loaded' || c.where === 'hospital' || c.walking) { saved++; if (c.health < 40) critical++; }
    else left++;
  }
  const propertyLoss = s.kind === 'fire' ? s.burnedTiles / Math.max(1, s.totalFuelTiles) : s.props.some((p) => p.ignited) ? 0.4 : 0;
  const hurtRids = new Set<number>();
  let downCount = 0;
  for (const ev of sim.events) if (ev.incidentId === I.id && ev.problem === 'RESPONDER_HURT' && ev.rid >= 0) { if (!hurtRids.has(ev.rid)) hurtRids.add(ev.rid); }
  for (const rid of hurtRids) if (sim.responders[rid].status === 'down') downCount++;
  const suspectsTotal = s.hostiles.length;
  const caught = s.hostiles.filter((h) => h.state === 'arrested' || h.state === 'down').length;
  const escaped = suspectsTotal - caught;
  let flames = 0; for (let i = 0; i < s.fire.length; i++) if (s.fire[i] > 0.2) flames++;      // 꺼져 가는 잔불은 제외
  const hazardActive = flames > 0 || s.hostiles.some((h) => h.state === 'hold' || h.state === 'fight') || s.props.some((p) => p.kind === 'valve' && !p.mitigated && !p.ignited)
    || s.props.some((p) => p.kind === 'bomb' && p.real && !p.mitigated && !p.exploded);      // 처리되지 않은 진짜 폭발물
  const responseTime = I.firstArrivalAt >= 0 && I.reportedAt >= 0 ? I.firstArrivalAt - I.reportedAt : -1;
  const dispatchTime = I.firstDispatchAt >= 0 && I.reportedAt >= 0 ? I.firstDispatchAt - I.reportedAt : -1;
  const truth = I.truth;

  // ── 사후 분석: 신고 정보와 초기 판단을 진실과 비교 ──
  const wrongNotes: string[] = [];
  for (const c of I.claims) if (!c.truthful && c.note && wrongNotes.indexOf(c.note) < 0) wrongNotes.push(c.note);
  const firstCall = sim.calls.find((c) => c.incidentId === I.id);
  if (wrongNotes.length) addProblem(I, 'CALL_MISINFO', I.reportedAt, I.callEvents[0] ?? -1, wrongNotes.join('; '));
  const fa = I.firstAssess;
  if (fa && fa.type !== truth.type) addProblem(I, 'MISJUDGE_TYPE', fa.t, fa.eventId, `${josa(TYPE_NAME[fa.type], '으로/로')} 판단했으나 실제는 ${TYPE_NAME[truth.type]}`, !!I.fieldType, I.fieldType ? '현장 지휘관 보고로 수정' : '');
  if (fa && fa.type === truth.type && fa.severity < truth.severity - 0.75) addProblem(I, 'UNDERESTIMATE', fa.t, fa.eventId, `초기 위험도를 '${sevName(fa.severity)}' 수준으로 평가했으나 실제 규모는 '${sevName(truth.severity + 0.2)}' 수준`);
  if (fa && fa.type === truth.type && fa.severity > truth.severity + 1.0) addProblem(I, 'OVERESTIMATE', fa.t, fa.eventId, `초기 위험도를 '${sevName(fa.severity)}' 수준으로 평가했으나 실제는 '${sevName(truth.severity - 0.2)}' 수준`);
  if (s.requests.length && I.firstArrivalAt >= 0) addProblem(I, 'UNDER_DISPATCH', s.requests[0].t, s.requests[0].eventId, `현장에서 추가 지원 ${s.requests.length}회 요청 (${s.requests.map((q) => q.reason).slice(0, 2).join(' / ')})`, s.requests.every((q) => q.fulfilled >= q.count), s.requests.every((q) => q.fulfilled >= q.count) ? '요청한 지원이 모두 배정됨' : '일부 지원은 끝내 배정되지 못함');
  if (reason === 'timeout') addProblem(I, 'TIMEOUT', sim.t, -1, '대응 한계 시간 안에 상황을 끝내지 못함');
  const benign = truth.variant === 'false' || truth.variant === 'prank';
  if (benign) addProblem(I, 'FALSE_ALARM', I.reportedAt, I.callEvents[0] ?? -1, truth.variant === 'prank' ? '장난 전화였고 실제 사건은 없었음' : '냄새·연기만 있었고 실제 화재는 없었음', true, `확인에 부대 ${I.everAssigned.length}대가 ${fmtSec(Math.max(0, sim.t - Math.max(0, I.firstDispatchAt)))} 동안 묶임`);
  // 폭파 협박·수상한 물건: 진짜 장치가 없었다면 허위 신고다 (확인하기 전에는 아무도 알 수 없었다)
  const noBomb = (truth.variant === 'bombthreat' || truth.variant === 'package') && !s.props.some((p) => p.kind === 'bomb' && p.real);
  if (noBomb) addProblem(I, 'FALSE_ALARM', I.reportedAt, I.callEvents[0] ?? -1, truth.variant === 'bombthreat' ? '협박 전화였고 폭발물은 없었음' : '수상한 물건은 폭발물이 아니었음', true, `확인에 부대 ${I.everAssigned.length}대가 ${fmtSec(Math.max(0, sim.t - Math.max(0, I.firstDispatchAt)))} 동안 묶임`);

  // ── 판정 ──
  let bad = 0;
  bad += lost * 2 + undiscovered * 1.5 + left * 1;
  bad += downCount * 1.5 + (hurtRids.size - downCount) * 0.75;
  if (s.kind === 'armed' || suspectsTotal > 0) bad += escaped * 1.25;
  bad += propertyLoss > 0.6 ? 1 : propertyLoss > 0.35 ? 0.5 : 0;
  if (hazardActive) bad += 1.5;
  let grade: IncidentResult['grade'];
  const objectiveOpen = hazardActive || undiscovered > 0 || left > 0 || (s.kind === 'search' && cas.every((c) => c.tDiscovered < 0));
  if (reason === 'noresponse') grade = lost > 0 ? 'failed' : 'unresolved';
  else if (cas.length > 0 && lost >= Math.max(1, Math.ceil(cas.length / 2))) grade = 'failed';
  else if (bad >= 4.5) grade = 'failed';
  else if ((reason === 'timeout' || reason === 'abandoned' || reason === 'shiftend') && objectiveOpen) grade = 'unresolved';
  else if (s.kind === 'armed' && suspectsTotal > 0 && caught === 0 && lost === 0) grade = 'unresolved';
  else if (bad > 0.01) grade = 'partial';
  else grade = 'success';
  if (I.pursuit && I.pursuit.state === 'escaped') grade = I.pursuit.kind === 'kidnap' ? 'failed' : 'unresolved';      // 납치된 사람을 되찾지 못했다 / 난폭 운전자를 놓쳤다
  const limit = RESP_LIMIT[truth.type];
  const delayed = !I.pursuit && (responseTime < 0 || responseTime > limit || I.problems.some((p) => p.code === 'BACKUP_LATE'));      // 추격전은 차를 세운 뒤에야 현장이 생긴다
  const outcome: Outcome = grade === 'success' && delayed ? 'delayed' : grade;

  // ── 설명 ──
  const A: string[] = [];
  if (reason === 'noresponse') A.push(`신고 접수 후 ${fmtSec(sim.t - I.reportedAt)}이 지나도록 어떤 부대도 현장에 도착하지 못했습니다.`);
  else if (responseTime >= 0) A.push(`신고 접수 ${fmtSec(dispatchTime)} 만에 첫 출동 지령이 내려졌고, ${fmtSec(responseTime)} 만에 첫 부대가 도착했습니다${responseTime > limit ? ` (기준 ${fmtSec(limit)} 초과)` : ''}.`);
  if (wrongNotes.length && firstCall) A.push(`최초 신고자(${personaName(firstCall.caller.persona)})의 정보가 실제와 달랐습니다: ${wrongNotes.slice(0, 2).join('; ')}.`);
  const order: ProblemCode[] = ['CALL_QUEUE', 'CALL_VAGUE', 'MISJUDGE_TYPE', 'UNDERESTIMATE', 'OVERESTIMATE', 'NO_UNIT', 'DIVERTED', 'ROUTE_BLOCKED', 'TRAFFIC_DELAY', 'SCENE_MISMATCH', 'UNDER_DISPATCH', 'BACKUP_LATE',
    'WRONG_ADDRESS', 'FALSE_ALARM', 'PATH_BLOCKED', 'COMM_FAIL', 'RECOUNT', 'VICTIM_MISSED', 'EQUIP_FAIL', 'WATER_OUT', 'HIDDEN_HAZARD', 'ESCALATION', 'SECONDARY_COLLISION', 'RESPONDER_HURT', 'FATIGUE', 'SUSPECT_FLED', 'LATE_DISCOVERY', 'TIMEOUT'];
  const T: Partial<Record<ProblemCode, (ps: Problem[]) => string>> = {
    CALL_QUEUE: (ps) => `신고 전화가 다른 통화 처리 때문에 ${ps[0].detail} 대기했습니다.`,
    CALL_VAGUE: () => '신고자가 상황을 제대로 설명하지 못해 초기 정보가 불확실했습니다.',
    MISJUDGE_TYPE: (ps) => `상황 분석 단계에서 사건 유형을 잘못 판단했습니다 — ${ps[0].detail}${ps[0].recovered ? ` (${ps[0].recoveryText})` : ''}.`,
    UNDERESTIMATE: (ps) => `상황 분석 단계에서 추가 위험이 반영되지 않았습니다 — ${ps[0].detail}.`,
    OVERESTIMATE: (ps) => `초기 평가가 실제보다 과했습니다 — ${ps[0].detail}. 자원이 필요 이상으로 묶였습니다.`,
    NO_UNIT: (ps) => `${ps[0].detail} 상태가 발생했습니다${ps[0].recovered ? ` (${ps[0].recoveryText})` : ' — 끝내 배정되지 못했습니다'}.`,
    DIVERTED: (ps) => `${ps[0].detail}되어 대응 인력이 줄었습니다.`,
    ROUTE_BLOCKED: (ps) => `출동 중 ${ps.length > 1 ? `${ps.length}차례 ` : ''}도로 통제를 만나 우회했습니다 (${ps[0].detail}).`,
    TRAFFIC_DELAY: (ps) => `교통 상황으로 도착이 늦어졌습니다 (${ps[0].detail}).`,
    SCENE_MISMATCH: (ps) => `현장 도착 후 신고와 다른 상황이 확인되어 계획을 바꿨습니다 — ${ps.map((p) => p.detail).slice(0, 2).join(' / ')}.`,
    UNDER_DISPATCH: (ps) => `최초 배정 자원으로는 부족해 ${ps[0].detail}. ${ps[0].recoveryText}.`,
    BACKUP_LATE: (ps) => `${ps[0].detail}.`,
    PATH_BLOCKED: (ps) => { const rec = ps.filter((p) => p.recovered); return `현장에서 진입 경로가 ${ps.length}차례 막혔습니다 (${ps[0].detail})${rec.length ? ` — ${rec[0].recoveryText}` : ' — 해결하지 못했습니다'}.`; },
    COMM_FAIL: (ps) => `무전 전달 실패가 ${ps.length}차례 있었습니다 (${ps[0].detail})${ps[0].recovered ? ` — ${ps[0].recoveryText}` : ''}.`,
    WRONG_ADDRESS: (ps) => `신고자가 위치를 틀리게 말해 부대가 엉뚱한 곳으로 먼저 갔습니다 (${ps[0].detail}). 재확인 후 실제 위치로 다시 이동했습니다.`,
    FALSE_ALARM: (ps) => `${ps[0].detail}. ${ps[0].recoveryText}.`,
    RECOUNT: (ps) => { const later = cas.filter((c) => c.tDiscovered > ps[0].t).length; return `신고 인원과 확인 인원이 달라(${ps[0].detail}) 전 구역을 재수색했습니다 — ${later ? `재수색에서 ${later}명을 추가로 찾았습니다` : '추가 인원은 없었습니다. 신고 정보가 부정확했습니다'}.`; },
    VICTIM_MISSED: (ps) => `1차 수색에서 대상을 놓쳤습니다 (${ps[0].detail}). 탐색 범위를 재조정해 재수색했습니다.`,
    EQUIP_FAIL: (ps) => `${ps[0].detail}${ps[0].recovered ? ` — ${ps[0].recoveryText}` : ' — 복구하지 못했습니다'}.`,
    WATER_OUT: (ps) => `${ps[0].detail}${ps[0].recovered ? ` — ${ps[0].recoveryText}` : ''}.`,
    HIDDEN_HAZARD: (ps) => `신고에 없던 위험이 현실화됐습니다: ${ps.map((p) => p.detail).join(', ')}.`,
    ESCALATION: (ps) => `대응 도중 상황이 악화됐습니다: ${ps.map((p) => p.detail).slice(0, 3).join(', ')}.`,
    SECONDARY_COLLISION: (ps) => `${ps[0].detail}가 발생했습니다. 교통 통제가 완료되기 전이었습니다.`,
    RESPONDER_HURT: (ps) => `대원 피해: ${ps.map((p) => p.detail).filter((v, i, arr) => arr.indexOf(v) === i).join(', ')}.`,
    FATIGUE: (ps) => `${ps[0].detail}.`,
    SUSPECT_FLED: (ps) => `${ps.map((p) => p.detail).join(', ')}${s.arrivedAt < 0 || ps[0].t < s.arrivedAt ? ' — 부대 도착 전이었습니다' : ' — 출입구 봉쇄가 완성되기 전이었습니다'}.`,
    LATE_DISCOVERY: (ps) => `${ps[0].detail}.`,
    TIMEOUT: (ps) => `${ps[0].detail}.`,
  };
  for (const code of order) {
    const ps = I.problems.filter((p) => p.code === code);
    if (!ps.length || A.length >= 9) continue;
    const f = T[code];
    if (f) A.push(f(ps));
  }
  for (const c of cas) {
    if (A.length >= 11) break;
    if (c.dead) {
      if (s.arrivedAt < 0 || c.tDead < s.arrivedAt) A.push(`구조 대상 ${josa(c.label, '은/는')} 첫 부대가 도착하기 전에 이미 숨졌습니다${responseTime > limit ? ' — 도착 지연이 결정적이었습니다' : ''}.`);
      else if (c.tDiscovered < 0 || c.tDiscovered > c.tDead) A.push(`구조 대상 ${josa(c.label, '은/는')} 도착 ${fmtSec(c.tDead - s.arrivedAt)} 뒤, 발견되기 전에 숨졌습니다.`);
      else {
        const found = c.tDiscovered - (s.arrivedAt >= 0 ? s.arrivedAt : c.tDiscovered);
        A.push(`구조 대상 ${josa(c.label, '은/는')} 도착 ${fmtSec(Math.max(0, found))} 뒤 발견됐지만${c.tTreated < 0 ? ' 처치를 받기 전에' : c.tLoaded < 0 ? ' 이송 전에' : ''} 숨졌습니다.`);
      }
    } else if (c.tDiscovered < 0) A.push(`구조 대상 ${josa(c.label, '은/는')} 발견되지 못한 채 현장에 남았습니다 — 지휘관은 이 사실을 모른 채 상황을 종료했습니다.`);
  }
  // 한 줄 요약
  const hl: string[] = [];
  { const b = s.props.find((p) => p.kind === 'bomb'); if (noBomb) hl.push(truth.variant === 'bombthreat' ? '허위 협박 — 폭발물 없음' : b && !b.mitigated ? '폭발물은 아니었으나 확인하지 못함' : '확인 결과 폭발물 아님'); else if (b && b.real) hl.push(b.mitigated ? '폭발물 해체' : b.exploded ? '폭발물 폭발' : '폭발물 미처리'); }
  if (benign) hl.push(truth.variant === 'prank' ? '장난 전화 — 실제 사건 없음' : '오인 신고 — 실제 화재 없음');
  else if (cas.length) hl.push(`요구조자 ${cas.length}명 중 ${saved}명 구조${lost ? `, ${lost}명 사망` : ''}${undiscovered ? `, ${undiscovered}명 미발견` : ''}${left ? `, ${left}명 구조 미완료` : ''}`);
  else hl.push('인명 피해 없음');
  if (s.kind === 'fire') hl.push(`소실률 ${pct(propertyLoss)}`);
  if (suspectsTotal) hl.push(`용의자 ${suspectsTotal}명 중 ${caught}명 검거`);
  if (hurtRids.size) hl.push(`대원 ${hurtRids.size}명 부상`);
  const troubles = I.problems.filter((p) => p.code !== 'CALL_MISINFO' && p.code !== 'OVERESTIMATE' && p.code !== 'LATE_DISCOVERY' && p.code !== 'FALSE_ALARM').length;
  if (benign) A.push('출동한 부대가 직접 확인하고 이상 없음으로 종결했습니다.');
  else if (outcome === 'success') A.push(troubles === 0 ? '큰 문제 없이 목표를 모두 달성했습니다.' : troubles >= 3 ? '여러 문제가 겹쳤지만 그때마다 계획을 바꿔 목표를 모두 달성했습니다.' : '도중에 문제가 있었지만 수습하고 목표를 모두 달성했습니다.');
  else if (outcome === 'delayed') A.push('결과는 좋았지만 대응이 기준보다 늦었습니다.');
  return {
    outcome, delayed, grade, casTotal: cas.length, casSaved: saved, casLost: lost, casUndiscovered: undiscovered, casCritical: critical,
    propertyLoss, respondersHurt: hurtRids.size, suspectsTotal, suspectsCaught: caught, suspectsEscaped: escaped,
    responseTime, dispatchTime, duration: sim.t - I.createdAt, analysis: A, headline: hl.join(' · ') + '.',
  };
}

export function buildReport(sim: Sim): ShiftReport {
  const counts: Record<Outcome, number> = { success: 0, partial: 0, delayed: 0, unresolved: 0, failed: 0 };
  let rSum = 0, rN = 0, dSum = 0, dN = 0, casTotal = 0, casSaved = 0, casLost = 0, casUnd = 0;
  const causeCount = new Map<ProblemCode, number>();
  const incidents: ShiftReport['incidents'] = [];
  for (const I of sim.incidents) {
    const r = I.result;
    if (!r) continue;
    counts[r.outcome]++;
    if (r.responseTime >= 0) { rSum += r.responseTime; rN++; }
    if (r.dispatchTime >= 0) { dSum += r.dispatchTime; dN++; }
    casTotal += r.casTotal; casSaved += r.casSaved; casLost += r.casLost; casUnd += r.casUndiscovered;
    const seen = new Set<ProblemCode>();
    for (const p of I.problems) { if (seen.has(p.code)) continue; seen.add(p.code); causeCount.set(p.code, (causeCount.get(p.code) ?? 0) + 1); }
    incidents.push({ id: I.id, code: I.code, type: I.truth.type, name: scenarioName(I.truth.type, I.truth.variant), reportedType: I.firstAssess ? I.firstAssess.type : null, label: I.truth.label, result: r, start: I.createdAt, end: I.closedAt });
  }
  const dur = sim.t;
  const unitUtil = sim.units.map((u) => ({ callsign: u.callsign, util: u.busyTime / Math.max(1, dur), runs: u.runs }));
  const utilization = unitUtil.reduce((x, y) => x + y.util, 0) / unitUtil.length;
  const hurt = sim.responders.filter((r) => r.status !== 'ok').map((r) => ({ name: r.name, callsign: sim.units[r.unitId].callsign, status: r.status === 'down' ? '중상' : '부상' }));
  const equip = sim.events.filter((e) => e.problem === 'EQUIP_FAIL').length;
  const delayCauses = Array.from(causeCount.entries()).map(([code, count]) => ({ code, label: PROBLEM_LABEL[code], count })).sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : 1));
  const n = incidents.length;
  const good = counts.success + counts.delayed;
  const summary: string[] = [];
  summary.push(`이번 교대에서 ${n}건의 사건을 처리했습니다. 성공 ${counts.success}건, 부분 성공 ${counts.partial}건, 대응 지연 ${counts.delayed}건, 미해결 ${counts.unresolved}건, 실패 ${counts.failed}건.`);
  if (casTotal) summary.push(`요구조자 ${casTotal}명 중 ${casSaved}명을 구조했습니다 (구조율 ${pct(casSaved / casTotal)}).${casLost ? ` ${casLost}명은 구하지 못했습니다.` : ''}${casUnd ? ` ${casUnd}명은 발견하지 못했습니다.` : ''}`);
  if (delayCauses.length) summary.push(`가장 자주 발생한 문제: ${delayCauses.slice(0, 3).map((c) => `${c.label}(${c.count}건)`).join(', ')}.`);
  if (n && good === n) summary.push('모든 사건을 목표대로 해결한 교대였습니다.');
  return {
    major: sim.incidents.filter((I) => I.tag === 'major').length, disaster: disasterSummary(sim),
    seed: sim.seed, duration: dur, weather: sim.weather, difficulty: { ...sim.difficulty }, difficultyLabel: difficultyLabel(sim.difficulty), totalCalls: sim.calls.length, totalIncidents: n, counts,
    avgResponse: rN ? rSum / rN : -1, avgDispatch: dN ? dSum / dN : -1, utilization, unitUtil,
    casTotal, casSaved, casLost, casUndiscovered: casUnd, respondersHurt: hurt, equipFailures: equip, delayCauses, incidents, summary,
    hash: sim.logHash.toString(16),
  };
}
