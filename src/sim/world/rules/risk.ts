// C10 `suspectZone` — 도주한 무장 용의자 (설계서 I1 §3.7 C10 · L8 — 조건으로 움직이는 이야기 연쇄를 둔다).
//
// 초과 위험 과정으로 바꾸지 않는다: 달아난 용의자가 다시 범행하는가는 물리 상태의 적분이 아니라 행위자의 선택이고, 재범은 사용자가 그대로 두라고 한 이야기 연쇄다.
// 이 규칙이 더하는 것은 구역의 위험 상태다 — 도주는 그 동네의 경계 단계를 올리고(관제의 판단이 바뀐다), 재범 자체는 field/hazards.ts 의 도주 블록이 조건으로 예약한다
// (근처에 경찰이 없을 때만 — reoffendItem).
//
//   신호 'fled'(총을 든 용의자의 도주 — hazards 도주 블록) → 도주 지점(그 사건의 자리)의 동네 risk = max(risk, RISK.V), 회복 RISK.HOLD 초 뒤.
//   알려짐 = 그 도주 기록(SUSPECT_FLED)이 진실이 아니다(부대가 본 도주). 알려지면 관제의 기록 한 줄(tag 'risk' — 측정 도구는 현장 위험으로 센다).
//   관제가 쓰는 곳: 분석 AI 가 새 신고의 구역을 knownZoneOfIncident 로 구하고 knownZone 의 risk 가 있으면 그 동네의 무장 신고에 위험도 +0.3, 경찰 +1 (dispatch/analyst.ts).
// 구역 -1(동네 밖)은 아무것도 하지 않는다. 쿨다운: 동네마다 120초. 난수 없음(확률 판정이 없다 — 흐름 csq:suspectZone:zone:<z>:<n> 는 쓰지 않는다).
// 진실 쪽이다(세계 규칙). 판단 쪽은 world.zones 를 읽지 않는다 — knownZone 만.

import { emit } from '../../events';
import { registerConsequence } from '../consequence';
import { setZone, zoneName, zoneOfXY } from '../state';

/** 구역 위험의 세기 · 회복까지(초) · 같은 동네에 다시 걸리기까지(초) */
export const RISK = { V: 0.6, HOLD: 300, COOLDOWN: 120 };

registerConsequence({
  id: 'suspectZone', label: '무장 용의자 도주', on: ['fled'],
  key: (_sim, sig) => { if (!sig || sig.x < 0) return null; const z = zoneOfXY(sig.x, sig.y); return z >= 0 ? 'zone:' + z : null; },
  cooldown: RISK.COOLDOWN, cap: Infinity, spawns: false,
  test: () => true,
  apply: (c) => {
    const sim = c.sim, sig = c.sig!, z = zoneOfXY(sig.x, sig.y), Z = sim.world.zones[z];
    if (!Z) return;
    const fled = sim.events[sig.ev], known = !!fled && !fled.truth;      // 부대가 본 도주만 관제가 안다 (아무도 닿기 전의 도주는 진실 기록이다)
    const wasKnown = Z.known.risk;
    const worse = setZone(sim, z, 'risk', RISK.V, sim.t + RISK.HOLD, sig.ev, known);
    if (known && (worse || !wasKnown)) {
      emit(sim, { role: 'DISPATCH', actor: '관제', kind: 'dispatch', tag: 'risk', imp: 1, causes: [sig.ev], text: `${zoneName(z)} 일대 무장 용의자 도주 — 인근 신고의 경계 단계를 높입니다.` });
    }
  },
});
