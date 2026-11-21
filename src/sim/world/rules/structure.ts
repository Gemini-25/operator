// C2 `rubbleRoad` — 잔해는 사건이 끝나도 남는다 (설계서 I1 §3.7 C2). (b3-8) 그 다음에 L3 (가) `shockSpread` — 아래 절.
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
import { addObstacle, noteRoadCause, obstacleOnEdge } from '../../traffic';
import type { Place, PlaceExpo, Signal } from '../../types';
import { registerConsequence } from '../consequence';
import { EMBER, GAS_KINDS, RESIDUAL, SHOCK, burnedPlaces, emberDelta, expoOf, fireTargetOk, heatMul, neighborsOf, neighborsOfPoint, residualOf, shockDelta } from '../expo';
import type { Nb } from '../expo';
import { hazardCellFor, hazardImpulse } from '../hazard';
import { placeState } from '../state';

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
    if (ob.full) noteRoadCause(sim, edge, 'close', ob.ev, sig.inc);      // (b3-5) 교통의 장부: 닫힘의 주인 = 잔해 기록, 주인 사건 = 그 건물의 사건 (닫힌 사건이어도 된다). 한 차로 잔해의 주인은 장애물의 ev 로 읽힌다
  },
});

// ───────────────────────── L3 (가) shockSpread — 붕괴와 폭발은 옆 건물을 흔든다 (설계서 I1 §3.7 L3) ─────────────────────────
// 충격(폭발 · 건물 전체의 붕괴 · 무너진 채 시작하는 사건)이 벽-벽 틈 안의 이웃 건물에 구조 손상 shake 를 남긴다 — 크기는 expo.shockDelta(X6 의 현장 안 식을 밖으로 이은 것).
// 법칙이 아니라 상태다: 사건을 만들지 않고 난수를 쓰지 않는다(배관의 문턱은 expoOf 가 건물마다 한 번). 쿨다운·상한 없음 — 충격이 있을 때마다.
// 그 상태를 읽는 곳: 그 건물의 다음 현장(expo.applyExpo — 처음 건전도·새는 밸브)과 손상이 위험률을 올리는 법칙(b3-8c 의 structFail·pipeLeak).
// 기록: shake 가 처음 SHOCK.S_MIN 을 넘을 때 '금이 갔습니다', 도시가스를 쓰는 건물의 shake 가 그 건물의 배관 문턱을 넘는 순간 '배관이 손상됐습니다' —
//   둘 다 진실(truth — 아무도 보지 못했다)이고 원인은 [가장 크게 보탠 충격의 기록, 이번 충격의 기록] (충격이 둘 쌓여 넘었을 때 기록과 structFail 의 부모가 서로 다른 사건을 가리키지 않게).
// 관제·지휘관은 이 상태를 읽지 않는다 — 그 건물의 사건이 신고될 때 평소처럼, 현장에 닿은 뒤에는 X6 의 조짐과 밸브를 본 대원의 믿음으로만 안다 (§3.8).
// (b3-8c) 같은 폭발 신호(catastrophe data 0 · blast)로 L2 의 불티 항도 준다: 이웃 건물마다 hazardImpulse('heatSpread', …, what 'ember') — 크기는 expo.emberDelta, 대상은 열 항과 같은 조건(expo.fireTargetOk)

/** 가장 크게 보탠 충격의 크기 — 노출 칸마다 (shakeEv·shakeInc 를 바꿀지 견준다. 노출 칸은 교대마다 새로 만들므로 시드를 넘지 않는다) */
const TOP = new WeakMap<PlaceExpo, number>();
const placeLabel = (q: Place): string => (q.open ? q.name : `${q.addr} ${q.name}`);

/** 이 신호가 흔드는 이웃 — 손상이 0 보다 큰 쓸 수 있는 건물만, 가까운 순(같으면 id 순) */
function shocked(sim: Sim, sig: Signal): { id: number; d: number }[] {
  const out: { id: number; d: number }[] = [];
  if (!(shockDelta(sig, 0) > 0)) return out;      // 밖으로 나가지 않는 신호 (구획 하나의 붕괴 · 2차 붕괴 · 전소 · 작은 폭발)
  const nbs: readonly Nb[] = sig.place >= 0 ? neighborsOf(sim, sig.place) : sig.x >= 0 ? neighborsOfPoint(sim, sig.x, sig.y) : [];
  for (let k = 0; k < nbs.length; k++) {
    const d = shockDelta(sig, nbs[k].gap);
    if (!(d > 0)) break;      // 가까운 순이라 이 뒤로는 닿지 않는다
    if (placeState(sim, nbs[k].id)?.usable === false) continue;      // 이미 다 탔거나 무너진 건물은 더 흔들 것이 없다
    out.push({ id: nbs[k].id, d });
  }
  return out;
}

/**
 * (b3-8c — L2 의 불티 항) 이 폭발 신호가 불티를 보내는 이웃 — 옮겨붙은 불의 대상이 될 수 있는 건물만(expo.fireTargetOk — L2 의 열 항과 같은 조건), 가까운 순으로 EMBER.NB_MAX 채까지.
 * 폭발이 아니면(붕괴·전소) 없다. 크기는 expo.emberDelta — 틈이 멀수록 작지만 0 이 되지는 않는다(이웃 목록의 틈 30 까지)
 */
function embered(sim: Sim, sig: Signal): { id: number; dH: number }[] {
  const out: { id: number; dH: number }[] = [];
  if (!(emberDelta(sig, 0, 1) > 0)) return out;
  const nbs: readonly Nb[] = sig.place >= 0 ? neighborsOf(sim, sig.place) : sig.x >= 0 ? neighborsOfPoint(sim, sig.x, sig.y) : [];
  const burned = burnedPlaces(sim), places = sim.city.places;
  for (let k = 0; k < nbs.length && out.length < EMBER.NB_MAX; k++) {
    if (!fireTargetOk(sim, nbs[k].id, burned)) continue;
    const dH = emberDelta(sig, nbs[k].gap, heatMul(places[nbs[k].id].kind));
    if (dH > 0) out.push({ id: nbs[k].id, dH });
  }
  return out;
}

registerConsequence({
  id: 'shockSpread', label: '충격 손상', on: ['catastrophe', 'blast', 'collapse'],
  key: (_sim, sig) => (sig && sig.ev >= 0 ? 'ev:' + sig.ev : null),
  cooldown: 0, cap: Infinity, spawns: false,
  test: (c) => shocked(c.sim, c.sig!).length > 0 || embered(c.sim, c.sig!).length > 0,
  apply: (c) => {
    const sim = c.sim, sig = c.sig!, places = sim.city.places;
    const I = sig.inc >= 0 ? sim.incidents[sig.inc] : undefined;
    const src = sig.place >= 0 && places[sig.place] ? placeLabel(places[sig.place]) : I ? I.truth.label : '현장';
    const what = sig.kind === 'catastrophe' ? (sig.data === 1 ? '붕괴' : '폭발') : sig.kind === 'collapse' ? '붕괴' : '폭발';
    for (const { id, d } of shocked(sim, sig)) {
      const ex = expoOf(sim, id), was = ex.shake, q = places[id];
      ex.shake = Math.min(1, was + d);
      if (d > (TOP.get(ex) ?? 0)) { TOP.set(ex, d); ex.shakeEv = sig.ev; ex.shakeInc = sig.inc; }
      if (was < SHOCK.S_MIN && ex.shake >= SHOCK.S_MIN) {
        emit(sim, { role: 'SYSTEM', actor: '도시', kind: 'hazard', tag: 'struct', imp: 1, truth: true, causes: [ex.shakeEv, sig.ev], text: `${src} ${what}의 충격으로 옆 ${placeLabel(q)}에 금이 갔습니다.` });
      }
      if (!ex.pipe && GAS_KINDS.has(q.kind) && ex.shake >= ex.pipeThr) {
        ex.pipe = true;
        ex.pipeEv = emit(sim, { role: 'SYSTEM', actor: '도시', kind: 'hazard', tag: 'struct', imp: 1, truth: true, causes: [ex.shakeEv, sig.ev], text: `${placeLabel(q)}의 가스 배관이 충격으로 손상됐습니다.` });
      }
    }
    // (b3-8c) 폭발의 불티: 이웃 건물의 heatSpread 칸에 한 번의 충격으로 더한다 — 문턱("그 건물이 얼마나 타기 쉬운가")은 열 항과 같은 칸이다.
    // 금을 먼저 적는다: 불티가 그 자리에서 문턱을 넘어 불이 나면 그 현장이 금 간 채로 시작한다(applyExpo). 기록은 남기지 않는다 — 불이 붙으면 그 사건의 발생 기록이 이 폭발 기록을 원인으로 갖는다
    for (const { id, dH } of embered(sim, sig)) hazardImpulse(sim, 'heatSpread', id, dH, { rate: dH, ev: sig.ev, inc: sig.inc, what: 'ember', ref: sig.place });
  },
});

// ───────────────────────── (b3-8c) pipeShut — 끊긴 배관을 잠갔다 (설계서 I1 §3.6c · §3.7 L3 (다)) ─────────────────────────
// 끊긴 배관이 낸 누출 사건(법칙 pipeLeak 의 사건 — Incident.hz.law)이 '해결'로 닫히면 그 건물의 배관 손상(expo.pipe)을 거둔다 — 밸브를 잠갔다.
// 거두지 않으면 '밸브 차단' 기록을 남긴 그 건물의 다음 현장에 새는 밸브가 또 놓여 기록과 상태가 어긋난다. 한계 시간·방치·출동 없음·교대 끝으로 닫힌 누출은 아직 새고 있다(그대로 둔다).
// 금(shake)은 그대로 남는다. 상태만 바꾼다 — 기록은 남기지 않는다(밸브를 잠근 기록은 현장의 누출 조치가 이미 남겼다). 난수 없음, 쿨다운·상한 없음.
registerConsequence({
  id: 'pipeShut', label: '배관 차단', on: ['closed'],
  key: (sim, sig) => (sig && sig.place >= 0 && sig.inc >= 0 && sim.incidents[sig.inc]?.hz?.law === 'pipeLeak' ? 'place:' + sig.place : null),
  cooldown: 0, cap: Infinity, spawns: false,
  test: (c) => { const I = c.sim.incidents[c.sig!.inc], e = c.sim.world.expo[c.sig!.place]; return !!I && I.closeReason === 'resolved' && !!e && e.pipe; },
  apply: (c) => { c.sim.world.expo[c.sig!.place].pipe = false; },
});

// ───────────────────────── (b3-9) residualHeat — 닫힌 현장에 남은 열 (설계서 I1 §3.7 L7 — 법칙은 world/laws/ember.ts 의 rekindle) ─────────────────────────
// 사건이 닫히는 순간(신호 'closed') 그 건물 현장에 실제로 남은 불씨와 열 e0(expo.residualOf)이 식어 가는 동안 끝내 닿는 위험 H∞ = K × e0 × τ 를
// 그 건물의 rekindle 칸에 충격으로 한 번 더한다. 문턱을 넘으면 넘는 시각 Δt* = −τ × ln(1 − 남은 문턱 / H∞) 뒤(적어도 MIN_DELAY)로 미뤄 예약한다 — 틱마다 적분하지 않는다.
// 빼는 것: 교대 끝으로 닫힌 사건 · 길 위의 현장(건물이 없다) · 전소·전체 붕괴 건물(placeState — 더 탈 것이 없다) · 남은 열이 없는 현장.
// 상태만 본다 — 그 사건의 유형·종료 사유(교대 끝 말고)·잔불 정리 여부를 묻지 않는다. 난수 없음(문턱은 칸이 뽑는다). 기록은 남기지 않는다 — 다시 붙으면 그 사건의 발생 기록이 종료 기록을 원인으로 갖는다
function residualE0(sim: Sim, sig: Signal): number {
  const I = sim.incidents[sig.inc], s = sim.scenes[sig.inc];
  if (!I || !s || I.closeReason === 'shiftend' || sig.place < 0) return 0;
  if (placeState(sim, sig.place)?.usable === false) return 0;
  return residualOf(s);
}
registerConsequence({
  id: 'residualHeat', label: '남은 열', on: ['closed'],
  key: (_sim, sig) => (sig && sig.inc >= 0 && sig.place >= 0 ? 'inc:' + sig.inc : null),
  cooldown: 0, cap: Infinity, spawns: false,
  test: (c) => residualE0(c.sim, c.sig!) > 0 && hazardCellFor(c.sim, 'rekindle', c.sig!.place) !== null,
  apply: (c) => {
    const sim = c.sim, sig = c.sig!, e0 = residualE0(sim, sig), cell = hazardCellFor(sim, 'rekindle', sig.place);
    if (!cell || cell.done) return;
    const tau = sim.weather === 'rain' ? RESIDUAL.TAU_RAIN : RESIDUAL.TAU, Hinf = RESIDUAL.K * e0 * tau, need = cell.thr - cell.H;
    // 넘는 시각: H(Δt) = H∞ × (1 − exp(−Δt/τ)) 가 남은 문턱에 닿는 때. 끝내 닿지 못하면(H∞ < 남은 문턱) 충격은 칸에 H 만 남긴다 — 사건도 기록도 없다
    const delay = Hinf >= need ? Math.max(RESIDUAL.MIN_DELAY, -tau * Math.log(Math.max(1e-9, 1 - need / Hinf))) : 0;
    hazardImpulse(sim, 'rekindle', sig.place, Hinf, { rate: Hinf, ev: sig.ev, inc: sig.inc, what: 'residual', ref: sig.place }, delay);
  },
});
