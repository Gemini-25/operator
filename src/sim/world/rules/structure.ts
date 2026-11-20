// C2 `rubbleRoad` — 잔해는 사건이 끝나도 남는다 (설계서 I1 §3.7 C2).
//
// X6 은 건물이 통째로 무너지면 사건 교차로의 한 구간을 사건 동안만 막고(I.blockedEdge), 사건이 끝나면 closeIncident 가 연다 —
// 그대로면 무너진 건물의 잔해가 사건 종료와 함께 사라진다. 이 규칙이 그 사이를 잇는다:
//   (가) 사건 뒤에 남는 잔해 — 신호 'closed': 그 사건이 건물을 무너뜨렸거나(collapsed) 터뜨렸으면(blasted — X6 의 Sim.placeMarks),
//        X6 이 막았던 구간(없으면 그 건물이 면한 구간)에 잔해가 남는다. 종료 보고로 관제가 곧바로 안다(known).
//   (나) X6 이 막지 않은 큰 폭발 — 신호 'catastrophe'(폭발)·'blast'(반경 RUBBLE.BLAST_R 이상 — 폭발물): 그 사건이 길을 막고 있지 않으면
//        건물이 면한 구간에 잔해가 쏟아진다. 현장에 대원이 있으면 알려지고, 없으면 T1 의 "가 보아야 아는 장애물"이다(부대의 보고·시민 제보).
// 길을 막는 것은 traffic.addObstacle 로만 한다(우회로를 확인한다 — 도시가 끊기면 거절된다). 거절되면 한 차로만 막는다. 밀림은 교통 모델이 퍼뜨린다.
// 기록은 놓은 그 자리에서 남기고(원인 = 종료 기록 / 폭발 기록) 그 id 를 장애물의 ev 에 둔다 — 그 앞에서 되돌아선 부대의 ROUTE_BLOCKED 가 그것을 원인으로 잇는다.
//
// 진실 쪽이다(세계 규칙). 관제가 아는 길은 지금의 교통 모델 그대로다: findRoute·etaFor 는 알려진 통제만 피한다 (§3.8).
// G4 의 기록 전용 칸(s.falls·ruin)은 읽지 않는다 — 건물 상태는 X6 이 상태를 바꾸는 자리에서 적은 Sim.placeMarks 로만 본다.

import { edgeName } from '../../city';
import type { Sim } from '../../engine';
import { emit } from '../../events';
import { addObstacle, obstacleOnEdge } from '../../traffic';
import type { Signal } from '../../types';
import { registerConsequence } from '../consequence';

/** 균형 상수 */
export const RUBBLE = {
  DUR: [240, 420] as [number, number],      // 치워지기까지 (초)
  TIP: [35, 70] as [number, number],        // 아무도 모르는 잔해에 시민 제보가 들어오기까지 (초) — T1 의 낙하물과 같다
  BLAST_R: 3.2,                             // 'blast' 신호(폭발물)가 잔해를 쏟는 반경(칸). 본문의 4 로는 폭발물(반경 3.4)이 영영 걸리지 않는다
  COOLDOWN: 600,                            // 건물마다 (초)
  CAP: 6,                                   // 교대당
};

/** 이 신호가 잔해를 남길 구간 (없으면 -1) */
function target(sim: Sim, sig: Signal): number {
  const I = sim.incidents[sig.inc], pl = sim.city.places[sig.place];
  if (!I || !pl) return -1;
  let edge = -1;
  if (sig.kind === 'closed') {
    // (가) 이 사건이 그 건물을 무너뜨렸거나 터뜨렸다 (건물 상태를 적은 사건이 이 사건일 때만 — 앞 사건이 남긴 상태로 뒤 사건이 잔해를 또 남기지 않는다)
    const pm = sim.placeMarks.get(sig.place);
    if (!pm || pm.incidentId !== I.id || (pm.state !== 'collapsed' && pm.state !== 'blasted')) return -1;
    edge = I.blockedEdge >= 0 ? I.blockedEdge : pl.edgeId ?? -1;
  } else {
    // (나) 폭발: X6 이 막은 구간이 없고(전체 붕괴가 아니다) 사건이 아직 열려 있다
    if (sig.kind === 'catastrophe' ? sig.data !== 0 : sig.size < RUBBLE.BLAST_R) return -1;
    if (I.phase === 'closed' || I.blockedEdge >= 0) return -1;
    edge = pl.edgeId ?? -1;
  }
  if (edge < 0 || !sim.city.edges[edge] || obstacleOnEdge(sim, edge)) return -1;      // 그 구간에 이미 다른 것이 놓여 있으면 더 놓지 않는다
  return edge;
}

registerConsequence({
  id: 'rubbleRoad', label: '건물 잔해', on: ['closed', 'blast', 'catastrophe'],
  key: (_sim, sig) => (sig && sig.place >= 0 && sig.inc >= 0 ? 'place:' + sig.place : null),
  cooldown: RUBBLE.COOLDOWN, cap: RUBBLE.CAP, spawns: false,
  test: (c) => target(c.sim, c.sig!) >= 0,
  apply: (c) => {
    const sim = c.sim, sig = c.sig!, edge = target(sim, sig), s = sim.scenes[sig.inc];
    // 사건 뒤에 남는 잔해는 종료 보고로 알려진다. 폭발의 잔해는 현장에 대원이 있을 때만 — 없으면 아무도 모른다
    const known = sig.kind === 'closed' || (!!s && s.agents.some((a) => a.status === 'active'));
    const dur = c.rng.range(RUBBLE.DUR[0], RUBBLE.DUR[1]);
    const ob = addObstacle(sim, { edge, kind: 'rubble', full: true, dur, known, quiet: true })
      ?? addObstacle(sim, { edge, kind: 'rubble', full: false, dur, known, quiet: true });      // 전면 통제가 도시를 끊으면 한 차로만
    if (!ob) return;
    const name = edgeName(sim.city, sim.city.edges[edge]);
    if (known) ob.ev = emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', imp: 1, causes: [sig.ev], text: `${name} 건물 잔해로 ${ob.full ? '전면' : '한 차로'} 통제.` });
    else {
      // 진실만 바뀌었다: 부대가 가서 보거나(ROUTE_BLOCKED) 제보가 들어와야 관제가 안다
      ob.tipAt = sim.t + c.rng.range(RUBBLE.TIP[0], RUBBLE.TIP[1]);
      ob.ev = emit(sim, { role: 'SYSTEM', actor: '도시', kind: 'traffic', imp: 1, truth: true, causes: [sig.ev], text: `${name}에 건물 잔해가 쏟아져 ${ob.full ? '길이 막혔습니다' : '한 차로가 막혔습니다'}. 아직 아무도 신고하지 않았습니다.` });
    }
  },
});
