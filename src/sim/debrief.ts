// 결과 평가 — 사건별 최종 판정과 원인 분석, 교대 종료 보고서.
// 판정은 AI 가 믿는 내용이 아니라 엔진의 진실 상태로 내린다(지휘관이 놓친 구조 대상도 여기서 드러난다).
// 원인 설명 문장은 시뮬레이션 중 실제로 기록된 문제(Problem)와 타임라인에서만 만든다.

import { scenarioName } from './scenarios';
import { TYPE_DEFS } from './incidentTypes';
import { personaName } from './dispatch/callSystem';
import { sevName } from './dispatch/analyst';
import { difficultyLabel } from './difficulty';
import { disasterSummary } from './disaster';
import { methodFailLine, methodLines, methodSummary, methodTally } from './field/methodReport';      // (R2) 대응 방법의 문장과 집계
import { roleOf } from './crews';
import { CAUSE_NAME, bandOf, mainCause, outShifts, threatOverAt } from './field/injury';
import { VERDICT_RULES } from './field/sceneRegistry';      // (N8) 판정 등록 — 묶음의 세계 규칙이 새 위험을 등급에 넣는다
import { X6_BOOM_DETAIL, catHazardActive, catSummary, propertyLossOf } from './field/catastrophe';      // (X6 단계 7) 재산 피해·남은 위험·요약
import type { Sim } from './engine';
import type { Incident, IncidentResult, InjuryCause, Outcome, Problem, ProblemCode, RosterOut, ShiftReport } from './types';
import { TYPE_NAME, fmtSec, josa, pct } from './util';

export const PROBLEM_LABEL: Record<ProblemCode, string> = {
  DANGER_SIGN: '위험 조짐', WITHDRAWAL: '전원 철수', STRUCT_COLLAPSE: '구조물 붕괴', EXPLOSION: '폭발', BURNOUT: '건물 전소',      // (X6) 이름표만 — order 의 자리와 문장 틀은 단계 7
  CALL_QUEUE: '신고 대기', CALL_MISINFO: '신고자의 잘못된 정보', CALL_VAGUE: '불명확한 신고', MISJUDGE_TYPE: '사건 유형 오판', UNDERESTIMATE: '위험도 과소평가', OVERESTIMATE: '위험도 과대평가',
  NO_UNIT: '가용 부대 부족', UNDER_DISPATCH: '전문 부대 없이 대응 시작', DIVERTED: '부대 전환 배정', ROUTE_BLOCKED: '이동 경로 통제', TRAFFIC_DELAY: '교통 지연',
  PATH_BLOCKED: '현장 진입로 차단', VICTIM_MISSED: '수색에서 대상 누락', EQUIP_FAIL: '장비 고장', WATER_OUT: '용수 소진', RESPONDER_HURT: '대원 부상', COMM_FAIL: '무전 전달 실패',
  METHOD_FAIL: '대응 방법 실패·변경',      // (R2) 문장 틀과 order 의 자리(EQUIP_FAIL 바로 다음)는 evaluate 안
  ESCALATION: '상황 악화', BACKUP_LATE: '지원 지연', SCENE_MISMATCH: '신고와 다른 현장 상황', SUSPECT_FLED: '용의자 도주', SECONDARY_COLLISION: '2차 사고', LATE_DISCOVERY: '구조 대상 발견 지연',
  TIMEOUT: '대응 시간 초과', FATIGUE: '대원 체력 고갈', HIDDEN_HAZARD: '숨겨진 위험 발현', RECOUNT: '인원 불일치 재수색', WRONG_ADDRESS: '신고 위치 오류', FALSE_ALARM: '허위·오인 신고',
  RESPONDER_KILLED: '대원 순직', SUSPECT_DIED: '용의자 사망',
  UTIL_LATE: '유관 기관 지연(대신한 조치)', ANIMAL_LOST: '동물 놓침',      // (N8) 이름표만 — order 의 자리와 문장 틀은 그 코드를 남기는 단계(4a·5)
  DECON_LATE: '제독 지연',      // (N9 §5.5) 이름표와 order 의 자리(아래 splice — 지원 지연 다음)만. 문장 틀 T 와 남기는 곳은 단계 6
};

function addProblem(I: Incident, code: ProblemCode, t: number, eventId: number, detail: string, recovered = false, recoveryText = ''): void {
  if (I.problems.some((p) => p.code === code && p.detail === detail)) return;
  I.problems.push({ code, t, eventId, detail, recovered, recoveryText, times: undefined, ref: undefined });      // times·ref: raiseProblem 과 같은 모양 (I1-b)
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
  const propertyLoss = propertyLossOf(s);      // (X6 §6.5) 전소·전체 붕괴 1, 그 밖은 탄 비율·무너진 몫·폭발의 최댓값 — 위험 상태가 없으면 예전 식(화재는 탄 비율, 그 밖은 불붙은 소품 0.4)
  // 대원 피해 (H1 §7.1): 순직은 이 사건의 RESPONDER_KILLED 기록으로 따로 센다 — 문턱 때문에 순직한 대원에게는 대개 앞선 RESPONDER_HURT 가 있지만, 집계는 그 가정에 기대지 않는다.
  // 쓰러짐 = RESPONDER_HURT 가 난 대원 가운데 순직하지 않고 쓰러져 있는 대원, 부상 = 나머지
  const hurtRids = new Set<number>(), killed = new Set<number>();
  for (const ev of sim.events) {
    if (ev.incidentId !== I.id || ev.rid < 0) continue;
    if (ev.problem === 'RESPONDER_HURT') hurtRids.add(ev.rid);
    else if (ev.problem === 'RESPONDER_KILLED') killed.add(ev.rid);
  }
  let downCount = 0, hurtOnly = 0;
  for (const rid of hurtRids) { if (killed.has(rid)) continue; if (sim.responders[rid].status === 'down') downCount++; else hurtOnly++; }
  // (N9 §5.15) 해산한 용의자(dispersed — 시위의 주최자·던지지 않은 선동자)는 용의자 셈에서 뺀다: 도주로 벌점을 받지 않고 해산이 성공이 된다. 없으면 예전 그대로
  const counted = s.hostiles.some((h) => h.dispersed === true) ? s.hostiles.filter((h) => h.dispersed !== true) : s.hostiles;
  const suspectsTotal = counted.length;
  const caught = counted.filter((h) => h.state === 'arrested' || h.state === 'down').length;      // 쓰러진·숨진 용의자도 검거로 센다 (§4.4)
  const escaped = suspectsTotal - caught;
  // 용의자 피해: 이 사건에서 다친 용의자(처음부터 다쳐 있던 몫은 빼고 — 숨진 용의자 포함), 숨진 용의자, 그 가운데 위협이 끝난 뒤에 숨진 용의자 (§4.4)
  const over = threatOverAt(s);
  let suspectsHurt = 0, suspectsDead = 0, deadAfter = 0;
  for (const h of s.hostiles) {
    if (h.dead || (h.injuries !== undefined && h.injuries.some((j) => j.byKind !== 'initial'))) suspectsHurt++;
    if (h.dead) { suspectsDead++; if (over >= 0 && h.tDead !== undefined && h.tDead > over) deadAfter++; }
  }
  // 숨진 구조 대상의 원인 (숨지게 한 원인 — 사망 기록에 적힌 그 원인)
  const deathCauses: Partial<Record<InjuryCause, number>> = {};
  for (const c of cas) if (c.dead && c.deathCause) deathCauses[c.deathCause] = (deathCauses[c.deathCause] ?? 0) + 1;
  let flames = 0; for (let i = 0; i < s.fire.length; i++) if (s.fire[i] > 0.2) flames++;      // 꺼져 가는 잔불은 제외
  // (N9 §5.15) 해산한 용의자(dispersed)는 대치·교전으로 세지 않는다
  let hazardActive = flames > 0 || s.hostiles.some((h) => (h.state === 'hold' || h.state === 'fight') && h.dispersed !== true) || s.props.some((p) => p.kind === 'valve' && !p.mitigated && !p.ignited)
    || s.props.some((p) => p.kind === 'bomb' && p.real && !p.mitigated && !p.exploded)      // 처리되지 않은 진짜 폭발물
    || catHazardActive(s);      // (X6 §6.5) 서 있는 건물의 보강하지 않은 균열 · 달궈진 채 곁에 불이 있는 용기 · 폭발 하한 구름
  // (N8) 판정 등록(field/sceneRegistry.registerVerdict): 살아 있는 시설물·풀린 동물처럼 위의 식이 모르는 위험. open 이면 위험이 남은 것으로(벌점 1.5 와 목표 미완이 아래 식 그대로 따라온다),
  // bad 는 벌점에 더하고, delayed 는 대응 지연으로 센다. 등록된 줄이 없으면 아무것도 바뀌지 않는다
  let vBad = 0, vDelayed = false;
  for (const rule of VERDICT_RULES) {
    const v = rule(sim, s, I);
    if (!v) continue;
    if (v.open) hazardActive = true;
    if (v.bad) vBad += v.bad;
    if (v.delayed) vDelayed = true;
  }
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
  bad += killed.size * 3 + downCount * 1.5 + hurtOnly * 0.75;      // 순직 3 (다른 문제가 없어도 부분 성공, 하나 더 겹치면 실패) · 쓰러짐 1.5 · 부상 0.75
  bad += deadAfter * 0.5;      // 위협이 끝난 뒤 숨진 용의자 — 다친 사람을 돌보지 못한 것이다. 교전 중에 숨진 용의자는 벌점이 없다 (§4.4)
  if (s.kind === 'armed' || suspectsTotal > 0) bad += escaped * 1.25;
  bad += propertyLoss > 0.6 ? 1 : propertyLoss > 0.35 ? 0.5 : 0;
  if (hazardActive) bad += 1.5;
  bad += vBad;      // (N8) 판정 등록의 벌점
  let grade: IncidentResult['grade'];
  const objectiveOpen = hazardActive || undiscovered > 0 || left > 0 || (s.kind === 'search' && cas.every((c) => c.tDiscovered < 0))
    || s.props.some((p) => p.kind === 'bomb' && !p.mitigated && !p.exploded);      // 수상한 물건을 끝내 확인하지 못했다 (가짜였더라도 아무도 그것을 알지 못한 채 끝났다)
  if (reason === 'noresponse') grade = lost > 0 ? 'failed' : 'unresolved';
  else if (cas.length > 0 && lost >= Math.max(1, Math.ceil(cas.length / 2))) grade = 'failed';
  else if (bad >= 4.5) grade = 'failed';
  else if ((reason === 'timeout' || reason === 'abandoned' || reason === 'shiftend') && objectiveOpen) grade = 'unresolved';
  else if (s.kind === 'armed' && suspectsTotal > 0 && caught === 0 && lost === 0) grade = 'unresolved';
  else if (bad > 0.01) grade = 'partial';
  else grade = 'success';
  if (I.pursuit && I.pursuit.state === 'escaped') grade = I.pursuit.kind === 'kidnap' && I.pursuit.how !== 'hideout' ? 'failed' : 'unresolved';      // 납치된 사람을 되찾지 못했다 / 난폭 운전자를 놓쳤다 / 은신처에 숨어든 납치는 이어지는 인질 사건이 결말을 낸다
  const limit = TYPE_DEFS[truth.type].respLimit;
  const delayed = !I.pursuit && (responseTime < 0 || responseTime > limit || I.problems.some((p) => p.code === 'BACKUP_LATE') || vDelayed);      // 추격전은 차를 세운 뒤에야 현장이 생긴다. vDelayed: (N8) 판정 등록
  const outcome: Outcome = grade === 'success' && delayed ? 'delayed' : grade;

  // ── 설명 ──
  const A: string[] = [];
  if (reason === 'noresponse') A.push(`신고 접수 후 ${fmtSec(sim.t - I.reportedAt)}이 지나도록 어떤 부대도 현장에 도착하지 못했습니다.`);
  else if (responseTime >= 0) A.push(`신고 접수 ${fmtSec(dispatchTime)} 만에 첫 출동 지령이 내려졌고, ${fmtSec(responseTime)} 만에 첫 부대가 도착했습니다${responseTime > limit ? ` (기준 ${fmtSec(limit)} 초과)` : ''}.`);
  // 헬기만 왔던 사건: 상공 도착은 현장 도착(대응 시간)에 넣지 않는다 — 지상 대원이 내린 적이 없으면 그렇게 적는다
  else if ((s.airAt ?? -1) >= 0 && I.reportedAt >= 0) A.push(`헬기가 신고 접수 ${fmtSec(Math.max(0, s.airAt! - I.reportedAt))} 만에 현장 상공에 도착했지만, 지상 부대는 현장에 닿지 못했습니다.`);
  if (wrongNotes.length && firstCall) A.push(`최초 신고자(${personaName(firstCall.caller.persona)})의 정보가 실제와 달랐습니다: ${wrongNotes.slice(0, 2).join('; ')}.`);
  // 순직은 맨 앞에 둔다: 분석 문장이 9줄에서 잘려도 빠지지 않는다 (H1 §3.8)
  const order: ProblemCode[] = ['RESPONDER_KILLED', 'CALL_QUEUE', 'CALL_VAGUE', 'MISJUDGE_TYPE', 'UNDERESTIMATE', 'OVERESTIMATE', 'NO_UNIT', 'DIVERTED', 'ROUTE_BLOCKED', 'TRAFFIC_DELAY', 'SCENE_MISMATCH', 'UNDER_DISPATCH', 'BACKUP_LATE',
    'WRONG_ADDRESS', 'FALSE_ALARM', 'PATH_BLOCKED', 'COMM_FAIL', 'RECOUNT', 'VICTIM_MISSED', 'EQUIP_FAIL', 'WATER_OUT', 'BURNOUT', 'STRUCT_COLLAPSE', 'EXPLOSION', 'HIDDEN_HAZARD', 'ESCALATION', 'SUSPECT_DIED', 'SECONDARY_COLLISION', 'RESPONDER_HURT',
    'WITHDRAWAL', 'DANGER_SIGN', 'FATIGUE', 'SUSPECT_FLED', 'LATE_DISCOVERY', 'TIMEOUT'];      // (X6 §5.10) 결과 문장(전소·붕괴·폭발)은 숨겨진 위험 앞, 철수·조짐은 대원 피해 뒤 — 9줄 컷에서 H1 의 문장이 밀리지 않게
  const T: Partial<Record<ProblemCode, (ps: Problem[]) => string>> = {
    RESPONDER_KILLED: (ps) => `순직: ${ps.map((p) => p.detail).join(' / ')}.`,      // 원인과 경과는 숨지는 그 자리에서 상태로 만든 detail 에 들어 있다 (sceneManager.agentHealth)
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
    // 용의자 사망 (H1 §7.2): 숨진 용의자마다 기록(쓰러진·처치·숨진 시각과 부상 기록)으로 — 위협이 끝난 뒤(안전 확보·첫 도착)면 그 뒤 얼마 동안 돌보지 못했는지를 말한다
    SUSPECT_DIED: (ps) => {
      const over = threatOverAt(s), lines: string[] = [];
      for (const h of s.hostiles) {
        if (!h.dead || h.tDead === undefined) continue;
        const main = mainCause(h.injuries) ?? h.deathCause ?? 'gunshot', death = h.deathCause ?? main;
        const hit = `${josa(h.label, '은/는')} ${s.kind === 'armed' && (over < 0 || (h.tDown ?? h.tDead) <= over) ? '교전 중 ' : ''}${josa(CAUSE_NAME[main], '을/를')} 입고 쓰러졌고`;
        const tail = death !== main ? ` (${CAUSE_NAME[death]})` : '';
        if (over >= 0 && h.tDead > over) lines.push(`${hit}, ${s.kind === 'armed' ? '현장 안전 확보' : '대원 도착'} 뒤 ${fmtSec(h.tDead - over)} 동안 ${h.tTreated !== undefined ? '처치를 받았지만 이송되지 못하고' : '처치를 받지 못하고'} 숨졌습니다${tail}`);
        else lines.push(`${hit}, ${h.tTreated !== undefined ? '처치를 받았지만' : '처치를 받기 전에'} 숨졌습니다${tail}`);
      }
      return lines.length ? `${lines.join('. ')}.` : `${ps.map((p) => p.detail).join(' / ')}.`;
    },
    SECONDARY_COLLISION: (ps) => `${ps[0].detail}가 발생했습니다. 교통 통제가 완료되기 전이었습니다.`,
    RESPONDER_HURT: (ps) => `대원 피해: ${ps.map((p) => p.detail).filter((v, i, arr) => arr.indexOf(v) === i).join(', ')}.`,
    FATIGUE: (ps) => `${ps[0].detail}.`,
    SUSPECT_FLED: (ps) => `${ps.map((p) => p.detail).join(', ')}${s.arrivedAt < 0 || ps[0].t < s.arrivedAt ? ' — 부대 도착 전이었습니다' : ' — 출입구 봉쇄가 완성되기 전이었습니다'}.`,
    LATE_DISCOVERY: (ps) => `${ps[0].detail}.`,
    TIMEOUT: (ps) => `${ps[0].detail}.`,
    // (X6 §6.6) 위험의 현실화 — 기록된 문제에서만 만든다
    DANGER_SIGN: (ps) => {
      const rec = ps.filter((p) => p.recovered), open = ps.filter((p) => !p.recovered), out: string[] = [];
      const more = (n: number): string => (n > 2 ? ` 외 ${n - 2}건` : '');
      if (rec.length) out.push(`위험 조짐을 보고 막았습니다: ${rec.slice(0, 2).map((p) => `${p.detail} → ${p.recoveryText}`).join(', ')}${more(rec.length)}.`);
      if (open.length) out.push(`조짐이 있었지만 막지 못했습니다: ${open.slice(0, 2).map((p) => p.detail).join(', ')}${more(open.length)}.`);
      return out.join(' ');
    },
    WITHDRAWAL: (ps) => {
      const one = (p: Problem): string => `${p.detail} — ${p.recovered ? p.recoveryText : '끝까지 밖에서 대응했습니다'}`;
      return ps.length > 1 ? `전원 철수가 ${ps.length}번 있었습니다: ${ps.slice(0, 2).map(one).join(' / ')}.` : `${one(ps[0])}.`;
    },
    BURNOUT: (ps) => `${ps[0].detail}.`,
    STRUCT_COLLAPSE: (ps) => {
      let line = `구조물이 무너졌습니다: ${ps.slice(0, 3).map((p) => p.detail).join(', ')}${ps.length > 3 ? ` 외 ${ps.length - 3}건` : ''}.`;
      // 같은 구역의 막지 못한 붕괴 조짐: 조짐을 안 지 얼마 뒤였는가 (첫 붕괴)
      const p0 = ps[0], total = p0.detail.startsWith('건물 전체 붕괴'), where = total ? '' : p0.detail.split(' 천장·바닥 붕괴')[0];
      const sign = I.problems.find((q) => q.code === 'DANGER_SIGN' && !q.recovered && q.t <= p0.t && (q.detail.startsWith('건물 붕괴 조짐') || (q.detail.startsWith('붕괴 조짐') && (total || q.detail.includes(where)))));
      if (sign) line += ` 붕괴 조짐이 확인된 지 ${fmtSec(p0.t - sign.t)} 뒤였습니다.`;
      return line;
    },
    EXPLOSION: (ps) => {
      let line = `폭발이 일어났습니다: ${ps.slice(0, 3).map((p) => p.detail).join(', ')}${ps.length > 3 ? ` 외 ${ps.length - 3}건` : ''}.`;
      const p0 = ps[0], gas = p0.detail.startsWith('누출된 가스');
      const sign = I.problems.find((q) => q.code === 'DANGER_SIGN' && !q.recovered && q.t <= p0.t && q.detail.startsWith(gas ? '가스 농도' : '용기 가열'));
      if (sign) line += ` 위험을 알고 있었지만 ${josa(gas ? '차단·환기' : '냉각', '이/가')} 끝나기 전이었습니다.`;
      return line;
    },
  };
  // (R2) 대응 방법 실패·변경: 장비 고장 바로 다음 자리. 위의 order·T 글자를 다른 묶음(H1·X6)이 함께 고치고 있어 여기서 끼운다 — 합쳐진 뒤에는 글자 안으로 옮겨도 된다
  order.splice(order.indexOf('EQUIP_FAIL') + 1, 0, 'METHOD_FAIL'); T.METHOD_FAIL = methodFailLine;
  // (N9 §5.5) 제독 지연: 지원 지연(BACKUP_LATE) 바로 다음 자리 — 같은 까닭(order 글자를 X6 가 고치는 중)으로 여기서 끼운다. 문장 틀 T.DECON_LATE 는 단계 6 이 넣는다(그 전에는 이 코드가 남지 않는다)
  order.splice(order.indexOf('BACKUP_LATE') + 1, 0, 'DECON_LATE');
  for (const code of order) {
    const ps = I.problems.filter((p) => p.code === code);
    if (!ps.length || A.length >= 9) continue;
    const f = T[code];
    if (f) A.push(f(ps));
  }
  for (const c of cas) {
    if (A.length >= 11) break;
    if (c.dead) {
      // (X6 §6.6) 무너짐·폭발로 숨졌으면 그 기록의 상세를 짧게 붙인다 (그 사람의 원인 기록이 그 붕괴·폭발이다 — hurtCas 가 넘겨받은 ev 로 적는다)
      //  숨짐 기록이 그 원인 기록을 causes 로 잇는 경우가 있어(원인 기록이 숨짐 기록으로 바뀐다) 한 단계 거슬러 본다
      const x6Of = (ev: number) => I.problems.find((p) => p.eventId === ev && (p.code === 'STRUCT_COLLAPSE' || p.code === 'EXPLOSION' || (p.code === 'HIDDEN_HAZARD' && X6_BOOM_DETAIL.test(p.detail))));
      let x6 = c.deathCause === 'crush' || c.deathCause === 'blast' ? x6Of(c.causeEvent) : undefined;
      if (!x6 && (c.deathCause === 'crush' || c.deathCause === 'blast') && c.causeEvent >= 0 && sim.events[c.causeEvent]) for (const k of sim.events[c.causeEvent].causes) { x6 = x6Of(k); if (x6) break; }
      const why = c.deathCause ? ` (${CAUSE_NAME[c.deathCause]}${x6 ? ` — ${x6.detail.split(' — ')[0]}` : ''})` : '';      // 숨지게 한 원인 — 사망 기록에 적힌 그 원인 (H1 §7.2)
      if (s.arrivedAt < 0 || c.tDead < s.arrivedAt) A.push(`구조 대상 ${josa(c.label, '은/는')} 첫 부대가 도착하기 전에 이미 숨졌습니다${why}${responseTime > limit ? ' — 도착 지연이 결정적이었습니다' : ''}.`);
      else if (c.tDiscovered < 0 || c.tDiscovered > c.tDead) A.push(`구조 대상 ${josa(c.label, '은/는')} 도착 ${fmtSec(c.tDead - s.arrivedAt)} 뒤, 발견되기 전에 숨졌습니다${why}.`);
      else {
        const found = c.tDiscovered - (s.arrivedAt >= 0 ? s.arrivedAt : c.tDiscovered);
        A.push(`구조 대상 ${josa(c.label, '은/는')} 도착 ${fmtSec(Math.max(0, found))} 뒤 발견됐지만${c.tTreated < 0 ? ' 처치를 받기 전에' : c.tLoaded < 0 ? ' 이송 전에' : ''} 숨졌습니다${why}.`);
      }
    } else if (c.tDiscovered < 0) A.push(`구조 대상 ${josa(c.label, '은/는')} 발견되지 못한 채 현장에 남았습니다 — 지휘관은 이 사실을 모른 채 상황을 종료했습니다.`);
  }
  for (const line of methodLines(sim, I, s)) if (A.length < 12) A.push(line);      // (R2) 평소와 다른 방법으로 끝낸 것 (최대 2문장 — 기록된 I.methods 에서만)
  // 한 줄 요약
  const hl: string[] = [];
  { const b = s.props.find((p) => p.kind === 'bomb'); if (noBomb) hl.push(truth.variant === 'bombthreat' ? '허위 협박 — 폭발물 없음' : b && !b.mitigated ? '폭발물은 아니었으나 확인하지 못함' : '확인 결과 폭발물 아님'); else if (b && b.real) hl.push(b.mitigated ? '폭발물 해체' : b.exploded ? '폭발물 폭발' : '폭발물 미처리'); }
  if (benign) hl.push(truth.variant === 'prank' ? '장난 전화 — 실제 사건 없음' : '오인 신고 — 실제 화재 없음');
  else if (cas.length) hl.push(`요구조자 ${cas.length}명 중 ${saved}명 구조${lost ? `, ${lost}명 사망` : ''}${undiscovered ? `, ${undiscovered}명 미발견` : ''}${left ? `, ${left}명 구조 미완료` : ''}`);
  else hl.push('인명 피해 없음');
  const cs = catSummary(sim, s, I, hazardActive);      // (X6 §6.5·§6.6) 건물 전소 · 건물 붕괴 · 폭발 n회, 소실률은 화재가 아니어도 재산 피해가 있으면
  if (cs) { if (cs.burnout) hl.push('건물 전소'); if (cs.total) hl.push('건물 붕괴'); else if (cs.partial) hl.push(`일부 붕괴 ${cs.partial}곳`); if (cs.explosions) hl.push(`폭발 ${cs.explosions}회`); }
  if (s.kind === 'fire' || propertyLoss > 0) hl.push(`소실률 ${pct(propertyLoss)}`);
  if (suspectsTotal) hl.push(`용의자 ${suspectsTotal}명 중 ${caught}명 검거${suspectsDead ? ` (사망 ${suspectsDead})` : ''}`);
  { const hurtN = downCount + hurtOnly; if (hurtN) hl.push(`대원 ${hurtN}명 부상${killed.size ? `, ${killed.size}명 순직` : ''}`); else if (killed.size) hl.push(`대원 ${killed.size}명 순직`); }
  const troubles = I.problems.filter((p) => p.code !== 'CALL_MISINFO' && p.code !== 'OVERESTIMATE' && p.code !== 'LATE_DISCOVERY' && p.code !== 'FALSE_ALARM').length;
  if (benign) A.push('출동한 부대가 직접 확인하고 이상 없음으로 종결했습니다.');
  else if (outcome === 'success') A.push(troubles === 0 ? '큰 문제 없이 목표를 모두 달성했습니다.' : troubles >= 3 ? '여러 문제가 겹쳤지만 그때마다 계획을 바꿔 목표를 모두 달성했습니다.' : '도중에 문제가 있었지만 수습하고 목표를 모두 달성했습니다.');
  else if (outcome === 'delayed') A.push('결과는 좋았지만 대응이 기준보다 늦었습니다.');
  return {
    outcome, delayed, grade, casTotal: cas.length, casSaved: saved, casLost: lost, casUndiscovered: undiscovered, casCritical: critical,
    propertyLoss, respondersHurt: hurtRids.size, suspectsTotal, suspectsCaught: caught, suspectsEscaped: escaped,
    responseTime, dispatchTime, duration: sim.t - I.createdAt, analysis: A, headline: hl.join(' · ') + '.',
    respondersDown: downCount, respondersKilled: killed.size, suspectsHurt, suspectsDead, deathCauses,      // (H1)
    catastrophe: cs,      // (X6) 위험 상태도 지휘 상태도 없는 현장은 undefined
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
  // (N8 §5.3.4) 평균 가동률은 유관 기관(civil)을 빼고 센다 — 드물게 나가는 복구반·견인차가 숫자를 끌어내리지 않게 (편성된 유관 기관이 없으면 예전 식 그대로)
  const counted = sim.units.some((u) => u.dept === 'civil') ? unitUtil.filter((_, k) => sim.units[k].dept !== 'civil') : unitUtil;
  const utilization = counted.reduce((x, y) => x + y.util, 0) / counted.length;
  // 대원 피해 (H1 §7.3): 상태 글은 순직 · 쓰러짐 · 부상 (예전에는 쓰러짐을 '중상'으로 적어 중증도 이름과 겹쳤다).
  // 교대 끝의 중증도·주된 원인·순직·병원 이송(후송 중 포함)·다음 교대 결장 예상(outShifts)을 함께 적는다
  const hurt = sim.responders.filter((r) => r.status !== 'ok' && r.status !== 'off').map((r) => ({      // (I2) 결장(off)은 이번 교대에 다친 사람이 아니다
    name: r.name, callsign: sim.units[r.unitId].callsign, status: r.dead ? '순직' : r.status === 'down' ? '쓰러짐' : '부상', role: roleOf(sim, r.id).name,
    rid: r.id, band: r.dead ? 3 : Math.min(2, bandOf(r.health)), cause: r.dead ? r.deathCause ?? mainCause(r.injuries) : mainCause(r.injuries), dead: r.dead === true, hospital: r.care !== undefined, out: outShifts(r),
  }));
  // 순직: 그 기록(RESPONDER_KILLED)이 난 사건과 함께
  const killedList: NonNullable<ShiftReport['respondersKilled']> = [];
  for (const e of sim.events) {
    if (e.problem !== 'RESPONDER_KILLED' || e.rid < 0) continue;
    const r = sim.responders[e.rid];
    killedList.push({ name: r.name, callsign: sim.units[r.unitId].callsign, cause: r.deathCause ?? mainCause(r.injuries), incident: e.incidentId >= 0 ? sim.incidents[e.incidentId].code : '' });
  }
  // 교대 끝의 명부 (I2 가 다음 교대의 입력을 만들 때 읽는다 — 인근 도시 지원 대원은 뺀다)
  const roster: RosterOut[] = [];
  for (const r of sim.responders) {
    if (sim.units[r.unitId].aid) continue;
    roster.push({ rid: r.id, name: r.name, health: r.dead ? 0 : r.health, band: r.dead ? 3 : Math.min(2, bandOf(r.health)), dead: r.dead === true, hospital: r.care !== undefined, out: outShifts(r), cause: r.dead ? r.deathCause ?? mainCause(r.injuries) : mainCause(r.injuries) });
  }
  // 용의자 피해와 숨진 구조 대상의 원인 (사건 판정에 적힌 값의 합)
  let susHurt = 0, susDead = 0;
  const causeTally: Partial<Record<InjuryCause, number>> = {};
  for (const I of sim.incidents) {
    const res = I.result;
    if (!res) continue;
    susHurt += res.suspectsHurt ?? 0; susDead += res.suspectsDead ?? 0;
    if (res.deathCauses) for (const k of Object.keys(res.deathCauses) as InjuryCause[]) causeTally[k] = (causeTally[k] ?? 0) + (res.deathCauses[k] ?? 0);
  }
  // (X6 §6.6) 위험의 현실화: 사건 결과의 요약을 더한다
  const cat = { burnouts: 0, totals: 0, partials: 0, explosions: 0, withdrawals: 0, averted: 0, crewCaught: 0 };
  for (const I of sim.incidents) {
    const k = I.result?.catastrophe;
    if (!k) continue;
    if (k.burnout) cat.burnouts++;
    if (k.total) cat.totals++;
    cat.partials += k.partial; cat.explosions += k.explosions; cat.averted += k.averted; cat.crewCaught += k.crewCaught;
    for (const p of I.problems) if (p.code === 'WITHDRAWAL') cat.withdrawals++;
  }
  const equip = sim.events.filter((e) => e.problem === 'EQUIP_FAIL').length;
  const delayCauses = Array.from(causeCount.entries()).map(([code, count]) => ({ code, label: PROBLEM_LABEL[code], count })).sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : 1));
  const n = incidents.length;
  const good = counts.success + counts.delayed;
  const summary: string[] = [];
  summary.push(`이번 교대에서 ${n}건의 사건을 처리했습니다. 성공 ${counts.success}건, 부분 성공 ${counts.partial}건, 대응 지연 ${counts.delayed}건, 미해결 ${counts.unresolved}건, 실패 ${counts.failed}건.`);
  // 순직은 첫 줄 바로 다음에 둔다 (H1 §7.3) — 담담하게, 기록에 적힌 것만
  if (killedList.length) summary.push(`순직: ${killedList.map((k) => { const I = sim.incidents.find((J) => J.code === k.incident); return `${k.name} 대원(${k.callsign}${I ? `, 사건 ${I.code} ${scenarioName(I.truth.type, I.truth.variant)}` : ''})`; }).join(', ')}.`);
  // 숨진 구조 대상의 원인 집계를 붙인다: "… 6명은 구하지 못했습니다(연기 흡입 4, 총상 2)."
  const tally = (Object.keys(causeTally) as InjuryCause[]).sort((a, b) => (causeTally[b] ?? 0) - (causeTally[a] ?? 0) || (a < b ? -1 : 1)).map((k) => `${CAUSE_NAME[k]} ${causeTally[k]}`).join(', ');
  if (casTotal) summary.push(`요구조자 ${casTotal}명 중 ${casSaved}명을 구조했습니다 (구조율 ${pct(casSaved / casTotal)}).${casLost ? ` ${casLost}명은 구하지 못했습니다${tally ? `(${tally})` : ''}.` : ''}${casUnd ? ` ${casUnd}명은 발견하지 못했습니다.` : ''}`);
  // 대원 피해: 순직을 뺀 다친 대원과 그 가운데 병원으로 옮겨진 수
  { const alive = hurt.filter((x) => !x.dead); if (alive.length) { const hosp = alive.filter((x) => x.hospital).length; summary.push(`대원 피해: 부상 ${alive.length}명${hosp ? `(병원 이송 ${hosp}명)` : ''}.`); } }
  if (susHurt) summary.push(susDead ? `용의자 ${susHurt}명이 다쳤고 그중 ${susDead}명이 숨졌습니다.` : `용의자 ${susHurt}명이 다쳤습니다.`);
  if (delayCauses.length) summary.push(`가장 자주 발생한 문제: ${delayCauses.slice(0, 3).map((c) => `${c.label}(${c.count}건)`).join(', ')}.`);
  if (n && good === n) summary.push('모든 사건을 목표대로 해결한 교대였습니다.');
  if (cat.burnouts + cat.totals + cat.explosions + cat.withdrawals + cat.averted > 0) summary.push(`이번 교대에 건물 ${cat.burnouts}곳이 전소되고 ${cat.totals}곳이 무너졌습니다. 폭발 ${cat.explosions}건. 위험 조짐을 보고 전원 철수한 것이 ${cat.withdrawals}번, 막아 낸 조짐이 ${cat.averted}건입니다.`);      // (X6)
  const methods = methodTally(sim);      // (R2) 성공한 방법별 횟수 (평소 방법 포함). 요약 줄은 평소 방법이 아닌 것만, 하나도 없으면 넣지 않는다
  { const line = methodSummary(methods); if (line) summary.push(line); }
  // 교통: 기록된 통계로만 쓴다 (traffic.ts)
  const tf = { ...sim.traffic.stats };
  if (tf.jams + tf.closures + tf.obstacles + tf.detours + tf.gateWaits === 0) summary.push('교통으로 인한 지연은 없었습니다.');
  else summary.push(`교통: 정체 ${tf.jams}건·통제 ${tf.closures}건·장애물 ${tf.obstacles}건. ${tf.detours + tf.gateWaits === 0 ? '길이 막혀 되돌아가거나 건널목에서 기다린 출동은 없었습니다.' : `길이 막혀 되돌아간 출동 ${tf.detours}회, 건널목 대기 ${tf.gateWaits}회 (합쳐 약 ${Math.round(tf.delaySec)}초 지연).`}`);
  // 헬기: 기록된 통계로만 쓴다 (sim.airStats — 상태를 바꾸는 자리에서 센 값)
  const air = { ...sim.airStats, byKind: { ...sim.airStats.byKind } };
  if (air.sorties > 0) summary.push(`헬기: 출동 ${air.sorties}회(경찰 ${air.byKind.policeHeli ?? 0} · 소방 ${air.byKind.heli ?? 0} · 의료 ${air.byKind.medHeli ?? 0}), 호이스트 인양 ${air.hoists}명, 물 투하 ${air.drops}회, 공중 이송 ${air.airLifts}명, 연료 부족 복귀 ${air.rtb}회.`);
  if (air.grounded === 'fog') summary.push('안개로 헬기가 뜨지 못했습니다.');
  else if (air.grounded === 'night') summary.push('밤이라 의료 헬기는 뜨지 못했습니다.');
  else if (air.grounded === 'storm') summary.push('태풍의 강풍으로 헬기가 한동안 뜨지 못했습니다.');
  return {
    traffic: tf, air,
    major: sim.incidents.filter((I) => I.tag === 'major').length, disaster: disasterSummary(sim),
    seed: sim.seed, duration: dur, weather: sim.weather, difficulty: { ...sim.difficulty }, difficultyLabel: difficultyLabel(sim.difficulty), totalCalls: sim.calls.length, totalIncidents: n, counts,
    methods,      // (R2)
    avgResponse: rN ? rSum / rN : -1, avgDispatch: dN ? dSum / dN : -1, utilization, unitUtil,
    casTotal, casSaved, casLost, casUndiscovered: casUnd, respondersHurt: hurt, equipFailures: equip, delayCauses, incidents, summary,
    respondersKilled: killedList, suspectsHurt: susHurt, suspectsDead: susDead, roster,      // (H1)
    catastrophe: cat, placeMarks: sim.placeMarks.size ? Array.from(sim.placeMarks.values()).map((m) => ({ ...m })) : undefined,      // (X6) 건물 상태는 이 교대의 자료 — 이어받는 것은 I2
    hash: sim.logHash.toString(16),
  };
}
