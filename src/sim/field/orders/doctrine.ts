// 대응 교본 (docs/specs/R3-doctrine.md §6.1) 의 지휘 규칙. 지휘관의 믿음과 작업판·조직 정보만 읽는다 — 진실을 읽지 않는다
// (tests/ext.test.ts 와 tests/doctrine.test.ts 시험 1 이 이 파일의 주석이 아닌 줄을 글자로 검사한다. 주석은 줄 주석으로만 쓰고, 어떤 주석에도 그 시험의 금지어를 쓰지 않는다).
// 남의 몸은 대원의 자기 신고('crew' 사실)로만 안다.
//
// 단계 0 (틀): 아무것도 등록하지 않았다. 지휘 줄(CP·CF·CE·CS)은 그 분야의 단계가 registerOrders 로 채우고, 이름표는 doctrine/registry.ts 의 CMD_ROWS 에 둔다.
// 단계 2 (경찰): CP2(흉기 난동 — 쓸 수 있는 경찰이 둘이 안 되고 오는 경찰 부대가 없으면 22초를 기다리지 않고 부른다) · CP3(탄 위급 신고가 있는데 현장 경찰 부대의 탄약 상자가 모두 비었다).
//   CP1(쓸 수 있는 경찰로 문턱)·CP4(섬광탄 없는 인질 진입 보류)는 commander.ts 의 무장 블록에 있다(그 문턱의 수를 바꾸는 자리라서). 요청은 commander.request 가 돌려준 기록 id 가 0 이상일 때만 센다.

import type { CrewBelief, FieldAgent, HosBelief, Incident, Scene } from '../../types';
import type { Sim } from '../../engine';
import { registerOrders } from '../sceneRegistry';
import { copUsable } from '../doctrine';
import { groupOf, gunOf } from '../gear';
import { recordDoc } from '../doctrineRun';

/** 이 사건으로 오는 경찰 부대의 수 (조직 정보 — 현장에 닿은 부대는 세지 않는다) */
function lawComing(sim: Sim, I: Incident): number {
  let n = 0;
  for (const uid of I.assigned) { const u = sim.units[uid]; if (u.caps.law >= 0.5 && (u.state === 'enroute' || u.state === 'turnout')) n++; }
  return n;
}
/** 지휘관이 아는 쓸 수 있는 경찰의 수: 총을 든 활동 경찰(폭발물 처리 요원·로봇 조작 요원 빼고, 걸을 수 있는 다친 대원 빼고) 가운데 중상 신고·탄 위급이 아닌 사람 (commander 의 CP1 과 같은 셈) */
function usableCops(sim: Sim, s: Scene, a: FieldAgent): number {
  let n = 0;
  for (const b of s.agents) {
    const r = sim.responders[b.rid];
    if (b.status !== 'active' || r.dept !== 'police' || r.status === 'injured' || gunOf(sim, b.rid) === null || groupOf(sim, b.rid) === 'bomb') continue;
    if (copUsable(sim, a, b)) n++;
  }
  return n;
}

registerOrders((sim, s, I, a, k) => {
  // CP2: 흉기 난동 — 맞서는 흉기 용의자가 있고 쓸 수 있는 경찰이 둘이 안 되며 오는 경찰 부대가 없다
  const hos = a.beliefs.list('hos');
  let knifeFight = false;
  for (const f of hos) { const v = f.value as HosBelief; if (v.weapon === 'knife' && v.state === 'fight') { knifeFight = true; break; } }
  if (knifeFight && usableCops(sim, s, a) < 2 && lawComing(sim, I) === 0) {
    const ev = k.request('law', '흉기 난동 — 2인 제압 인력 부족', true);
    if (ev >= 0) recordDoc(sim, I, null, 'CP2', 'cmd', {}, ev);
  }
  // CP3: 탄 위급 신고(자기 신고 'crew' 의 ammo 2)가 있는데 현장 경찰 부대의 탄약 상자가 모두 비었다
  let crit = false;
  for (const f of a.beliefs.list('crew')) { const v = f.value as CrewBelief; if (v.ammo === 2) { crit = true; break; } }
  if (crit) {
    let boxes = 0, any = false;
    for (const uid of k.unitsOnScene()) { const u = sim.units[uid]; if (u.dept !== 'police' || u.ammoBoxMax === undefined || u.ammoBoxMax <= 0) continue; any = true; boxes += u.ammoBox ?? 0; }
    if (any && boxes === 0) {
      const ev = k.request('law', '탄약 보급 필요', false);
      if (ev >= 0) recordDoc(sim, I, null, 'CP3', 'cmd', {}, ev);
    }
  }
});
