// 비응급 신고 가려내기 — 접수 AI 의 판단 (docs/specs/N8-incident-kinds.md §5.5)
// 통화가 끝나는 그 틱(callSystem.endCall)에 불러, 장난을 가려내거나(screen) 단순 민원을 다른 기관에 넘기거나(referral)
// 이웃의 열린 사건과 같은 일이면 합친다({ link: 원 사건 id }). 답이 있으면 그 자리에서 closeReason 'screened' 로 닫는다.
// 정보 격리: 진술(I.claims)과 관제가 아는 것(첫 도착 시각 — 부대의 도착 보고, 다른 열린 사건의 평가·알려진 위치)만 읽는다.
// 진실(.truth·s.variant·.dupOf·s.kinds)을 읽지 않는다 (tests/kinds.test.ts 시험 4). 질문의 답(verify·same)은 신고자 모델 kindsCaller.ts 가 만든다.
//
// 단계 3: 장난 가려내기(screen). 민원 이관·중복 신고는 단계 10.
import type { Sim } from '../engine';
import type { Incident } from '../types';

/** 가려낸 결과: 장난 · 민원 이관 · 같은 사건에 합침 · 그대로(null — 지금의 길로 출동한다) */
export type ScreenVerdict = 'screen' | 'referral' | { link: number } | null;

/**
 * 장난 가려내기(N1): 장난 낌새 진술(hazard 'prank' — 진술이 오락가락하고 웃음소리)이 있고, 확인 질문(verify)에 얼버무리거나(evasive) 끊었으면(hangup) screen.
 * 부대가 이미 현장에 닿았으면 가려내지 않는다 — 지금의 현장 확인으로 간다. 그럴듯한 이름을 댔으면(named) 지금처럼 확인 출동
 */
export function decide(sim: Sim, I: Incident): ScreenVerdict {
  void sim;
  if (I.firstArrivalAt >= 0 || I.phase === 'closed') return null;
  let hint = false, dodged = false;
  for (const c of I.claims) {
    if (c.topic === 'hazard' && c.value === 'prank') hint = true;
    else if (c.topic === 'verify' && (c.value === 'evasive' || c.value === 'hangup')) dodged = true;
  }
  return hint && dodged ? 'screen' : null;
}
