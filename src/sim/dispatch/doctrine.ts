// 대응 교본 — 관제 (docs/specs/R3-doctrine.md §6.2). 관제 코드라 진실 금지 구역이다: 평가(I.assessment)·접수한 신고(claims)·조직 정보(부대 상태)·공개 지도·
// 보고된 위치(I.reportedNode·reportedPrev·reportedNodeAt·trackBy)만 읽는다 (tests/doctrine.test.ts 시험 1 이 이 파일의 주석이 아닌 줄을 글자로 검사한다 — 주석에도 그 시험의 금지어를 쓰지 않는다).
// 이 파일은 판단만 한다 — 부대를 보내거나 기록을 남기는 것은 부르는 쪽(dispatcher.pickUnit·sendUnit, analyst.assess, pursuit.tickPursuits)이 한다.
//
// 단계 2 (경찰): D2(경찰 수요에 폭발물 처리반을 아낀다) · D3(흉기 신고 — 경찰 둘) · D6(인질극 — 특공이 없으면 기동대 둘, 확인 필요: 균형) · D7(추격 — 따라가기와 앞막기 = 표의 P18·P19).
// 뒤 단계가 더한다: D1(가스 현장의 화학 구조차 — 5단계) · D4(2층 화재의 사다리차)·D5(바닷가가 아닌 수난의 구조 공작차 — 3단계).

import type { Sim } from '../engine';
import type { Incident, IncidentType, Needs, Unit } from '../types';
import { edgeTime, weatherSpeedFactor } from '../city';
import { crewReady, etaFor } from '../resources';

/** D2: 경찰 수요에서 폭발물 처리반을 덜 고르는 감점 (이 사건에 폭발물 처리 수요가 없을 때 — 처리반을 인질극 진입조로 보내지 않는다) */
export const D2_EOD = -40;
/**
 * 부대 고르기 가산 (dispatcher.pickUnit 의 점수에 더한다). 쓰인 줄의 id 를 함께 돌려준다 (가산이 0 이면 rule 은 null).
 * 이 가산이 실제로 고른 부대를 바꾸었는지는 pickUnit 이 가산 전후의 1등을 견주어 정한다(§2.7 의 '쓰였다')
 */
export function dispatchPref(_sim: Sim, I: Incident, u: Unit, need: keyof Needs): { add: number; rule: string | null } {
  if (need === 'law' && u.kind === 'eod' && !(I.assessment && (I.assessment.needs.eod ?? 0) > 0)) return { add: D2_EOD, rule: 'D2' };
  return { add: 0, rule: null };
}
/** 인질극 이름표 (관제가 붙이는 이름 — analyst 의 label) */
const HOSTAGE_LABEL = /^인질극/;
/** 특공이 나갈 수 있는가 (조직 정보 — 집에 있거나 돌아가는 중이고 걸을 수 있는 대원이 있다) */
function swatFree(sim: Sim): boolean {
  for (const u of sim.units) if (u.kind === 'swat' && (u.state === 'available' || u.state === 'returning') && crewReady(sim, u) > 0) return true;
  return false;
}
/**
 * 수요 보정 (analyst.assess — 시나리오 수요 다음, 장난 전화가 아닐 때). needs 를 고치고 바꾼 줄의 id 를 돌려준다.
 *  D3 무장이고 접수한 무기 주제가 흉기면 경찰 수요 2 (둘이 함께 붙는다 — 경찰 교본 P02·P03)
 *  D6 무장 위험도 ≥ 2.4 이고 이름표가 인질극이며 특공이 나갈 수 없으면 기동 수요 2 (진입이 예상된다 — 확인 필요: 균형)
 */
export function docNeeds(sim: Sim, type: IncidentType, sev: number, knife: boolean, label: string | undefined, needs: Needs): string[] {
  const used: string[] = [];
  if (type !== 'armed') return used;
  if (knife && needs.law < 2) { needs.law = 2; used.push('D3'); }
  if (D6_ON && sev >= 2.4 && label !== undefined && HOSTAGE_LABEL.test(label) && needs.tactical === 1 && !swatFree(sim)) { needs.tactical = 2; used.push('D6'); }
  return used;
}
/** D6 을 켜 둘지 (설계서 §6.2 "확인 필요 — 균형") */
const D6_ON = true;

// ───────────────────────── D7 추격 — 따라가기와 앞막기 (= 표의 P18·P19) ─────────────────────────
export type ChaseRole = { role: 'follow' | 'block'; node: number };
/** 셋째부터 앞막기로 돌리는, 알려진 위치 곁의 지상 부대 거리 (헬기가 없을 때) */
export const CHASE_NEAR = 42;
/** 앞막기 부대가 예상 교차로에 차보다 이만큼 늦게 닿으면 따라가기로 */
export const CHASE_LATE = 1.5;
/** 지상 경찰 부대 (헬기·구조정이 아닌) */
const ground = (u: Unit): boolean => u.dept === 'police' && !u.air && !u.sea;
/**
 * 예상 교차로 (공개 도로망): 알려진 위치(I.reportedNode)의 이웃 가운데, 그 전에 알려진 위치 → 알려진 위치 방향과 가장 곧게 이어지는 곳.
 * 그 전 위치를 모르거나 알려진 통제로 막힌 길뿐이면 -1
 */
export function predictNode(sim: Sim, I: Incident): number {
  const city = sim.city, prev = I.reportedPrev, cur = I.reportedNode;
  if (prev === undefined || prev < 0 || prev === cur || cur < 0) return -1;
  const P = city.nodes[prev], C = city.nodes[cur];
  const dx = C.x - P.x, dy = C.y - P.y, dl = Math.hypot(dx, dy) || 1;
  let best = -1, bc = -Infinity;
  for (const eid of C.edges) {
    const e = city.edges[eid];
    if (e.closed && e.known !== false) continue;      // 알려진 통제는 피한다 (아직 아무도 모르는 통제는 모른다)
    const o = e.a === cur ? e.b : e.a;
    if (o === prev) continue;
    const O = city.nodes[o];
    const ox = O.x - C.x, oy = O.y - C.y, ol = Math.hypot(ox, oy) || 1;
    const cos = (dx * ox + dy * oy) / (dl * ol);
    if (cos > bc || (cos === bc && o < best)) { bc = cos; best = o; }
  }
  return best;
}
/**
 * 추격 역할 (pursuit.tickPursuits 의 "알려진 위치로 방향을 바꾼다" 줄이 부른다): 이 사건으로 가는 지상 경찰 부대마다 따라가기(알려진 위치) / 앞막기(예상 교차로).
 *  헬기가 차를 보고 있으면(trackBy 'air') 알려진 위치에 가장 가까운 지상 부대 하나만 따라가고 나머지는 앞막기.
 *  헬기가 없으면 알려진 위치 42 안의 지상 부대가 둘 이상일 때 셋째부터 앞막기.
 *  앞막기 부대가 예상 교차로에 차의 도착 예상보다 1.5배 넘게 늦으면 따라가기. 차의 도착 예상은 공개 정보로만 — 알려진 위치에서 예상 교차로까지의 구간 시간에서
 *  마지막 보고 뒤 지난 시간을 뺀 값(0 아래면 따라가기). 예상 교차로가 없으면 모두 따라가기
 */
export function chaseRoles(sim: Sim, I: Incident): Map<number, ChaseRole> {
  const out = new Map<number, ChaseRole>();
  const city = sim.city, known = I.reportedNode;
  if (known < 0) return out;
  const K = city.nodes[known];
  const units: Unit[] = [];
  for (const uid of I.assigned) { const u = sim.units[uid]; if (ground(u) && u.state === 'enroute') units.push(u); }
  if (!units.length) return out;
  units.sort((p, q) => Math.hypot(p.x - K.x, p.y - K.y) - Math.hypot(q.x - K.x, q.y - K.y) || p.id - q.id);
  const pred = predictNode(sim, I);
  let carEta = 0;
  if (pred >= 0) {
    const eid = K.edges.find((id) => { const e = city.edges[id]; return (e.a === known && e.b === pred) || (e.b === known && e.a === pred); });
    if (eid !== undefined) carEta = edgeTime(city.edges[eid], weatherSpeedFactor(sim)) - (sim.t - (I.reportedNodeAt ?? sim.t));
  }
  let from = Infinity;
  if (I.trackBy === 'air') from = 1;
  else { let near = 0; for (const u of units) if (Math.hypot(u.x - K.x, u.y - K.y) < CHASE_NEAR) near++; if (near >= 2) from = 2; }
  for (let k = 0; k < units.length; k++) {
    const u = units[k];
    let role: 'follow' | 'block' = k >= from && pred >= 0 && carEta > 0 ? 'block' : 'follow';
    if (role === 'block' && etaFor(sim, u, pred) > CHASE_LATE * carEta) role = 'follow';
    out.set(u.id, { role, node: role === 'block' ? pred : known });
  }
  return out;
}
