// C3 `hospitalLoad` — 응급실 포화 (설계서 I1 §3.7 C3). 난수를 쓰지 않는다.
//
// 상태(sim.world.hospitals — 진실): 병원마다 응급실 체류 환자(stays: 병동으로 옮겨질 시각)와 포화(divert).
//   병원 인계('delivered' 신호 — 지상 구급차·헬기 이송이 같은 길)마다 산 환자와 함께 인계한 다친 대원·용의자가 ER.STAY 초 동안 병상을 쓴다.
//   체류가 한도에 닿으면 병원이 포화를 알리고(tag 'hospital'), 한도 − ER.RELIEF 로 내려가면 수용 재개를 알린다. 바뀐 지 ER.HOLD 초 안에는 다시 바꾸지 않는다.
// 결과:
//   1 붐빔 — 인계 시간이 체류에 따라 늘어난다 (resources.arrive 의 응급실 대기: ER.CROWD_SEC × max(0, 체류 − 한도/2))
//   2 포화 알림·수용 재개 — 이 파일의 hospitalLoad
//   3 새 이송은 알려진 포화 병원을 ER.PENALTY 초만큼 멀리 본다 (resources.startTransport — knownHospital 만 읽는다), 먼 병원을 고르면 HOSPITAL_FULL
//   4 이송 중 목적지 변경 — 포화가 알려지는 순간 그 병원으로 가던 부대 가운데 다른 병원이 ER.REROUTE_MAX 초 넘게 멀지 않은 부대 (이 파일의 reroute)
//   5 응급실 대기 기록의 원인 — 앞에서 인계 중인 부대의 출발 기록 (resources.arrive)
//
// 정보 격리 (§3.8): 포화는 병원이 알리는 순간 관제가 안다(known). 관제 쪽(startTransport)은 world/state.ts 의 knownHospital 만 쓴다.
// 이 파일은 진실 쪽이다. reroute 의 etaFor(안에서 findRoute — 모듈 버퍼를 쓴다)는 tickWorld 의 규칙 처리 단계에서만 불린다: 다른 findRoute 호출 안에서 부르지 않는다.

import type { Sim } from '../../engine';
import { emit, raiseProblem } from '../../events';
import { ER_CROWD_SEC, ER_PENALTY, etaFor, sendUnitTo } from '../../resources';
import type { Facility, HospitalState } from '../../types';
import { josa } from '../../util';
import { registerConsequence } from '../consequence';
import { erLoad, hospitalOf, knownHospital } from '../state';

/** 균형 상수. 범위를 벗어나면 §4 의 차례로: 한도(state.HOSPITAL_CAP) → 벌점 → 체류 */
export const ER = {
  STAY: 300,          // 인계된 환자가 응급실에 머무는 시간 (초)
  RELIEF: 2,          // 체류가 한도 − 이 값 이하로 내려가면 수용 재개
  HOLD: 60,           // 포화·재개가 바뀐 뒤 다시 바뀌지 않는 시간 (오락가락 방지)
  PENALTY: ER_PENALTY,       // (240) 알려진 포화 병원의 예상 도착에 더해 견주는 초 — 그래도 훨씬 가까우면 간다 (값은 그것을 쓰는 resources.startTransport 옆에 있다)
  REROUTE_MAX: 120,   // 이송 중 목적지 변경: 다른 병원이 지금 목적지보다 이만큼 넘게 멀면 그대로 간다
  CROWD_SEC: ER_CROWD_SEC,   // (3) 붐빔: 체류가 한도의 절반을 넘는 한 명마다 인계가 이만큼 늦어진다 (resources.arrive)
};

/** 지금 포화·재개가 바뀌어야 하는 첫 병원 (병원 목록의 차례, 없으면 -1) — 한 번(1초)에 한 곳씩 바뀐다 */
function pending(sim: Sim): number {
  const hs = sim.world.hospitals, t = sim.t;
  for (let k = 0; k < hs.length; k++) {
    const H = hs[k];
    if (H.since >= 0 && t - H.since < ER.HOLD) continue;
    const load = erLoad(H, t);
    if (H.divert ? load <= H.cap - ER.RELIEF : load >= H.cap) return k;
  }
  return -1;
}

/**
 * 이송 중 목적지 변경 (결과 4 — 새 정보로 계획을 바꾼다): 포화가 알려진 병원으로 가던 부대 가운데, 포화가 알려지지 않은 다른 병원까지 남은 시간이
 * 지금 목적지보다 ER.REROUTE_MAX 초 넘게 길지 않은 부대는 그 병원으로 간다. 기록은 문구 규칙 T8(scripts/metrics.ts)이 잡는다 — 일치 검사 C5 가 출발로 친다
 */
function reroute(sim: Sim, H: HospitalState, full: Facility): void {
  const fs = sim.city.facilities;
  for (let ui = 0; ui < sim.units.length; ui++) {
    const u = sim.units[ui];
    if (u.state !== 'transport' || u.destNode !== full.nodeId) continue;
    const cur = etaFor(sim, u, full.nodeId);
    let alt: Facility | null = null, at = Infinity;
    for (let k = 0; k < fs.length; k++) {
      const f = fs[k];
      if (f.kind !== 'hospital' || f.id === full.id || f.nodeId === full.nodeId) continue;
      const kh = knownHospital(sim, f.id);
      if (kh && kh.divert) continue;
      const t = etaFor(sim, u, f.nodeId);
      if (t < at) { at = t; alt = f; }
    }
    if (!alt || at - cur > ER.REROUTE_MAX) continue;
    sendUnitTo(sim, u, alt.nodeId);
    const add = Math.max(0, Math.round(at - cur));
    const inc = u.patientsIncident ?? (u.aboard && u.aboard.length ? u.aboard[0].inc : -1);
    const text = `${u.callsign}: ${full.name} 포화 소식 — ${josa(alt.name, '으로/로')} 목적지 변경.`;
    if (inc >= 0) raiseProblem(sim, sim.incidents[inc], 'HOSPITAL_FULL', `${full.name} 포화로 이송 중 ${josa(alt.name, '으로/로')} 목적지 변경 (약 +${add}초)`, { role: 'UNIT', actor: u.callsign, imp: 1, causes: [H.cause], text }, false, { fac: full.id, unit: u.id, lost: add });
    else emit(sim, { role: 'UNIT', actor: u.callsign, kind: 'unit', imp: 1, causes: [H.cause], text });
  }
}

// 인계마다: 응급실 체류에 더한다 (상태만 쌓는다 — world.log 에 줄을 남기지 않는다)
registerConsequence({
  id: 'hospitalIntake', label: '응급실 체류', on: ['delivered'], silent: true,
  key: (_sim, sig) => (sig && sig.place >= 0 ? 'fac:' + sig.place : null),
  cooldown: 0, cap: Infinity, spawns: false,
  test: (c) => c.sig!.data + c.sig!.size > 0 && hospitalOf(c.sim, c.sig!.place) !== null,
  apply: (c) => {
    const sig = c.sig!, H = hospitalOf(c.sim, sig.place)!;
    for (let k = sig.data + sig.size; k > 0; k--) H.stays.push(sig.t + ER.STAY);      // 산 환자(data)와 함께 인계한 다친 대원·용의자(size) — 모두 병상을 쓴다
    H.lastEv = sig.ev;
  },
});

// 1초에 한 번: 포화·수용 재개 (한 번에 한 병원). 열쇠가 그 병원이라 world.log 의 줄 = 바뀐 횟수
registerConsequence({
  id: 'hospitalLoad', label: '응급실 포화', on: 'tick',
  key: (sim) => { const k = pending(sim); return k >= 0 ? 'fac:' + sim.world.hospitals[k].fac : null; },
  cooldown: 0, cap: Infinity, spawns: false,
  test: () => true,
  apply: (c) => {
    const sim = c.sim, H = sim.world.hospitals[pending(sim)], f = sim.city.facilities[H.fac];
    if (!H.divert) {
      // 포화: 병원이 곧바로 알린다 (원인 = 마지막 인계 기록). 그 병원으로 가던 부대는 목적지를 다시 본다
      H.divert = true; H.known = true; H.since = sim.t;
      H.cause = emit(sim, { role: 'SYSTEM', actor: f.name, kind: 'unit', tag: 'hospital', imp: 2, causes: [H.lastEv], text: `${f.name} 응급실 포화 — 당분간 중증 환자만 받습니다.` });
      reroute(sim, H, f);
    } else {
      H.divert = false; H.since = sim.t;
      H.cause = emit(sim, { role: 'SYSTEM', actor: f.name, kind: 'unit', tag: 'hospital', imp: 1, causes: [H.cause], text: `${f.name} 응급실 수용 재개.` });
    }
  },
});
