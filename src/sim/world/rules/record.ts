// C6 `divertRecord` — 전환 배정의 실제 영향 (설계서 I1 §3.7 C6). 기록 규칙이다: 상태를 바꾸지 않고, 난수·쿨다운·상한이 없다(일이 있을 때마다).
//
// 관제가 사건 J 로 가던 부대를 더 급한 사건으로 돌리면(dispatcher.sendUnit 의 전환 블록) 그 부대의 예정 도착을 J 에 기억해 두고,
// J 의 첫 도착 때 "예정보다 얼마나 늦었는가"를 그 DIVERTED 문제의 ref.lost 에 적는다. 10초 넘게 늦었으면 기록 한 줄(원인 = 그 DIVERTED 기록).
// 끝내 아무도 닿지 못하고 닫힌 사건은 닫힌 시각까지를 ref.lost 에만 적는다(기록은 남기지 않는다 — 보고서가 ref.lost 로 쓴다).
// 부족의 귀속(NO_UNIT 의 blockedBy·원인)은 0단계가 dispatcher.blockersOf 로 이미 이었다.
//
// 정보 격리: 전환은 관제 자신의 결정이고(§3.8 표의 마지막 줄) 여기서 읽는 것은 관제가 아는 것뿐이다 — 자기가 준 예정 도착(u.estArrive), 부대의 도착 보고.
// 판단은 이 칸들을 읽지 않는다(기록·보고서·측정 전용). 세계 상태를 읽지 않으므로 관제·현장 파일이 이 파일을 불러도 된다.

import type { Sim } from '../../engine';
import { emit } from '../../events';
import type { Incident, Unit } from '../../types';

/** 첫 도착이 예정보다 이만큼(초) 넘게 늦었을 때만 기록을 남긴다 (그 아래는 ref.lost 에만) */
export const DIVERT_LATE_MIN = 10;

/**
 * 전환 배정의 순간 (dispatcher.sendUnit — dispatchUnit 이 예정 도착을 새 사건의 것으로 덮어쓰기 전에 부른다).
 * J 에 아직 아무도 닿지 않았을 때만 기억한다: 재는 것은 "첫 도착이 늦어진 시간"이다(이미 부대가 닿은 사건에서 빼 간 지원은 인력이 줄 뿐 첫 도착을 늦추지 않는다)
 */
export function noteDivert(sim: Sim, J: Incident, u: Unit, ev: number): void {
  if (J.firstArrivalAt >= 0) return;
  (J.divertWait ??= []).push({ unit: u.id, t: sim.t, eta: u.estArrive, ev });
}

/** 기억해 둔 전환마다 늘어난 시간을 그 DIVERTED 문제의 ref.lost 에 적는다. 돌려주는 값 = 기록을 남길 만큼 늦은 전환들의 기록과 그 가운데 가장 큰 지연 */
function settle(J: Incident, at: number): { late: number[]; max: number } {
  const late: number[] = [];
  let max = 0;
  const dw = J.divertWait!;
  for (let k = 0; k < dw.length; k++) {
    const lost = Math.max(0, Math.round(at - dw[k].eta));
    for (let i = J.problems.length - 1; i >= 0; i--) { const p = J.problems[i]; if (p.code === 'DIVERTED' && p.eventId === dw[k].ev) { if (p.ref) p.ref.lost = lost; else p.ref = { lost }; break; } }
    if (lost >= DIVERT_LATE_MIN) { late.push(dw[k].ev); if (lost > max) max = lost; }
  }
  J.divertWait = undefined;
  return { late, max };
}

/** J 의 첫 도착 (sceneManager.unitArrived — 지상 대원이 처음 내린 틱, 도착 기록 다음): 지연을 재고, 10초 넘게 늦었으면 기록한다 */
export function divertArrived(sim: Sim, J: Incident): void {
  if (!J.divertWait || !J.divertWait.length) return;
  const r = settle(J, sim.t);
  if (r.late.length) emit(sim, { inc: J.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 1, causes: r.late, text: `사건 ${J.code}: 전환 배정 뒤 첫 도착이 예정보다 약 ${r.max}초 늦었습니다.` });
}

/** 아무도 닿지 못한 채 닫혔다 (incidents.closeIncident): 닫힌 시각까지를 ref.lost 에만 적는다 — 기록은 남기지 않는다 */
export function divertUnmet(sim: Sim, J: Incident): void {
  if (!J.divertWait || !J.divertWait.length) return;
  settle(J, sim.t);
}
