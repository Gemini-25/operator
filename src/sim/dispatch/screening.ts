// 비응급 신고 가려내기 — 접수 AI 의 판단 (docs/specs/N8-incident-kinds.md §5.5)
// 통화가 끝나는 그 틱(callSystem.endCall)에 불러, 장난을 가려내거나(screen) 단순 민원을 다른 기관에 넘기거나(referral)
// 이웃의 열린 사건과 같은 일이면 합친다({ link: 원 사건 id }). 답이 있으면 그 자리에서 closeReason 'screened' 로 닫는다.
// 정보 격리: 진술(I.claims)과 관제가 아는 것(첫 도착 시각 — 부대의 도착 보고, 다른 열린 사건의 평가·알려진 위치)만 읽는다.
// 진실(.truth·s.variant·.dupOf·s.kinds)을 읽지 않는다 (tests/kinds.test.ts 시험 4). 질문의 답(verify·same)은 신고자 모델 kindsCaller.ts 가 만든다.
//
// 단계 3: 장난 가려내기(screen). 단계 10: 민원 이관(referral) · 중복 신고 합치기(link — 질문 same 의 후보 sameCandidate).
import type { Sim } from '../engine';
import type { Claim, Incident } from '../types';

/** 가려낸 결과: 장난 · 민원 이관 · 같은 사건에 합침 · 그대로(null — 지금의 길로 출동한다) */
export type ScreenVerdict = 'screen' | 'referral' | { link: number } | null;

/**
 * 장난 가려내기(N1): 장난 낌새 진술(hazard 'prank' — 진술이 오락가락하고 웃음소리)이 있고, 확인 질문(verify)에 얼버무리거나(evasive) 끊었으면(hangup) screen.
 * 부대가 이미 현장에 닿았으면 가려내지 않는다 — 지금의 현장 확인으로 간다. 그럴듯한 이름을 댔으면(named) 지금처럼 확인 출동
 */
export function decide(sim: Sim, I: Incident): ScreenVerdict {
  if (I.firstArrivalAt >= 0 || I.phase === 'closed') return null;
  let hint = false, dodged = false, link = -1;
  for (const c of I.claims) {
    if (c.topic === 'hazard' && c.value === 'prank') hint = true;
    else if (c.topic === 'verify' && (c.value === 'evasive' || c.value === 'hangup')) dodged = true;
    else if (c.topic === 'same' && typeof c.value === 'number' && c.value >= 0) link = c.value;
  }
  if (hint && dodged) return 'screen';
  // (N4) 신고자가 "같은 사건"이라고 답했다: 그 사건이 아직 열려 있으면 합친다 (닫혔으면 지금의 길 — 출동해 확인한다)
  if (link >= 0 && sim.incidents[link] && sim.incidents[link].phase !== 'closed') return { link };
  if (referable(I.claims)) return 'referral';
  return null;
}

/**
 * (N3) 단순 민원으로 넘길 수 있는가 — 상황 진술이 민원(complaint)뿐이고, 다쳤다·갇혔다·무기·지금 다툰다(hazard 'noise')는 진술이 하나도 없다.
 * 하나라도 있으면 이관하지 않는다 — 분석의 필요 자원이 순찰 한 팀을 낸다(scenarios/kinds.ts 의 referral 줄)
 */
export function referable(claims: readonly Claim[]): boolean {
  let complaint = false;
  for (const c of claims) {
    if (c.topic === 'nature') { if (c.value !== 'complaint') return false; complaint = true; }
    else if ((c.topic === 'injured' || c.topic === 'trapped') && c.value === true) return false;
    else if (c.topic === 'weapon' && c.value !== 'none') return false;
    else if (c.topic === 'hazard' && c.value === 'noise') return false;
  }
  return complaint;
}
/** (N3) 넘길 창구 — 신고자가 말한 민원의 글자로 (층간 소음 · 주차 · 개). 진술만 읽는다 */
export function referralDesk(I: Incident): string {
  for (const c of I.claims) {
    if (c.topic !== 'nature' || c.value !== 'complaint') continue;
    if (/차를|주차/.test(c.text)) return '주차 민원 창구';
    if (/개가|짖/.test(c.text)) return '동물 민원 창구';
    return '이웃 분쟁 조정 창구';
  }
  return '민원 창구';
}

/** (N4) 같은 사건으로 볼 시간 (초) — 이웃 사건의 신고가 이만큼 안이어야 묻는다 (§4.8) */
export const SAME_WINDOW = 300;
/**
 * (N4) 같은 사건 확인 질문(same)의 후보 — 관제가 아는 것만: 이 신고의 평가 유형과 같은 평가 유형의 열린 사건 가운데, 알려진 위치가 이 신고의 위치와 구간 하나로 이웃하고
 * 신고가 SAME_WINDOW 안인 것(가장 최근에 신고된 것). 없으면 null. 진실(원 사건이 무엇인지)은 읽지 않는다 — "네"라는 답은 신고자 모델(kindsCaller.sameAnswer)이 정한다
 */
export function sameCandidate(sim: Sim, J: Incident): Incident | null {
  const as = J.assessment;
  if (!as || !J.locationKnown) return null;
  const here = sim.city.nodes[J.reportedNode];
  if (!here) return null;
  let best: Incident | null = null;
  for (const K of sim.incidents) {
    if (K === J || K.phase === 'closed' || !K.assessment || K.assessment.type !== as.type || !K.locationKnown || K.reportedAt < 0 || sim.t - K.reportedAt > SAME_WINDOW) continue;
    if (K.reportedNode === J.reportedNode) continue;
    let nb = false;
    for (const eid of here.edges) { const e = sim.city.edges[eid]; if (e.a === K.reportedNode || e.b === K.reportedNode) { nb = true; break; } }
    if (!nb) continue;
    if (!best || K.reportedAt > best.reportedAt) best = K;
  }
  return best;
}
