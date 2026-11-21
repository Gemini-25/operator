// C4 `powerOut` — 전력 (설계서 I1 §3.7 C4 · 국지 구역 값 §3.6c). 정전은 **상태**다 — 사건을 직접 만들지 않는다:
// 꺼진 신호는 혼잡(traffic.addBump — what 1)으로 L1 에, 정전이 닿은 순간 운행 중이던 승강기는 L5(expo.darkened → laws/power.ts)에, 긴 정전은 C8(b3-10 c)에 닿는다.
//
// 원인들 (등록하는 규칙 셋 — 같은 파일 안의 차례가 등록 차례다):
//   powerOut       사건의 신호(큰 불 · 폭발 · 붕괴 · X6 의 폭발·붕괴·전소)를 받는다:
//                  (가) 변전소·발전소 건물의 사건 → 그 건물 UTIL_R 안에 가운데가 있는 동네 **전체** power = 0
//                  (라) 붕괴·폭발 자리의 끊긴 전선 — 그 자리가 받은 충격(expo.shockDelta(sig, 0) — L3 의 식에 틈 0)이 그 자리 전선의 문턱(흐름 grid:line:<건물>,
//                       길 위면 grid:line:n<교차로> — 쓸 때마다 다시 계산)을 넘을 때만 **국지 정전**(state.setZoneArea — 원이 닿는 동네마다 같은 자리)
//   powerOut.grid  재난의 신호를 받는다: 태풍 정전(blackout data 1 — 모든 동네, 곧바로 알려짐, 동네별 기록 없음 · data 0 — 그 정전을 원인으로 가진 동네를 되돌린다),
//                  지진(quake — 동네마다 흔들림 mag × (1 − 거리/QUAKE_R) 이 그 동네 전력망의 문턱(흐름 grid:power:<동네>)을 넘으면)
//   powerOut.end   원인 사건이 닫혔다(closed) — 그 사건을 주인으로 가진 정전의 회복 시각을 END 초 뒤로 당긴다(state.endZoneBy — setZone 은 늦추기만 한다).
//                  정전을 거는 규칙이 closed 도 받으면 그 규칙의 쿨다운·상한에 먹혀(틀은 test 앞에서 본다) 동네의 전력 0 과 꺼진 신호가 교대 끝까지 남는다 — 그래서 따로 둔다
//   powerOut.tell  (1초마다) 알림이 나갈 때가 된 정전을 관제에 알린다(그때 known — 그 전에는 진실만 바뀐다: 진실이 바뀐 기록은 원인 기록 자신이다)
// 회복: until 을 Infinity 로 두지 않는다 — 사건의 정전은 처음부터 t + HOLD(원인 사건이 끝나지 않아도 복구된다), 지진은 t + QUAKE_HOLD. 회복은 world/state.recoverWorld 가 하고
//   이 파일의 recover 가 그 건(world.spans 의 한 줄)이 모든 동네에서 끝났는지 보아 얹은 혼잡을 **한 번** 거두고(removeBump) 복구 기록을 남긴다.
//   (recover 는 동네·칸마다 불린다 — 거기서 구간의 bump 를 동네마다 빼면 동네 셋에 걸친 정전이 다른 원인의 bump 까지 깎는다)
// 같은 동네의 겹침은 setZone 이 막는다(이미 꺼진 곳은 다시 걸리지 않고 알림도 다시 남지 않는다).
// 정전 범위 안의 병원은 발전기로 돌아 응급실 수용이 HOSP_CUT 줄어든다(C3 와 맞물린다 — syncHospitals: 상태에서 다시 계산한다).
// 기간·알림 지연의 난수는 이 발동의 흐름 csq:<규칙>:<열쇠>:<n> — "일어나는가"의 주사위가 아니라 내용이다. 문턱은 자리마다 fork 로 다시 계산한다(시드에 따라 달라지는 값을 도시 캐시에 두지 않는다 — §3.6c).
// 진실 쪽이다(세계 규칙). 관제는 knownZone 의 power 로만 안다(분석 AI — 정전 구역의 교통사고·승강기 신고). 판단부는 world.zones·world.spans 를 읽지 않는다 (§3.8).

import { DISTRICTS } from '../../cityPlan';
import type { Sim } from '../../engine';
import { emit } from '../../events';
import { addBump, removeBump } from '../../traffic';
import type { Place, Signal, WorldState, ZoneSpanSrc } from '../../types';
import { registerConsequence } from '../consequence';
import { darkened, liftPlaces, shockDelta } from '../expo';
import { HOSPITAL_CAP, ZONE_DEFAULT, endZoneBy, isDark, setZone, setZoneArea, zoneAt, zoneName, zoneOfXY } from '../state';

/**
 * 정전의 크기와 시간 (설계서 §3.7 C4 의 첫 값):
 *  UTIL_R     변전소 · 발전소 사고가 끄는 동네(가운데까지의 거리)
 *  HOLD       사건의 정전이 원인 사건이 끝나지 않아도 복구되기까지(초) · QUAKE_HOLD 지진의 정전 · END 원인 사건이 닫힌 뒤 복구까지 [lo, hi]
 *  TELL       정전이 관제에 알려지기까지 [lo, hi] · DARK_BUMP 꺼진 신호가 얹는 혼잡(태풍의 것과 같다)
 *  QUAKE_R    지진의 흔들림이 닿는 거리 · QUAKE_THR 동네 전력망의 문턱 = a + b × u
 *  LINE_THR   자리 전선의 문턱 = a + b × u · LINE_R 국지 정전의 반경(폭발 a + b × 반경(칸) · 전체 붕괴 · 무너진 채 시작한 사건)
 *  HOSP_CUT   정전 범위 안의 병원이 줄이는 응급실 수용 · CAP 사건의 정전(powerOut)의 교대 상한
 */
export const POWER = {
  UTIL_R: { substation: 700, powerPlant: 1100 } as Record<string, number>,
  HOLD: 600, QUAKE_HOLD: 240, END: [60, 120] as [number, number],
  TELL: [20, 40] as [number, number], DARK_BUMP: 0.4,
  QUAKE_R: 900, QUAKE_THR: [0.3, 0.5] as [number, number],
  LINE_THR: [0.15, 0.6] as [number, number], LINE_R: { blastA: 30, blastB: 8, total: 90, start: 70 },
  HOSP_CUT: 2, CAP: 6,
};

type Span = WorldState['spans'][number];
const placeLabel = (q: Place): string => (q.open ? q.name : `${q.addr} ${q.name}`);
const zonesLabel = (zs: readonly number[]): string => `${zs.map(zoneName).join('·')} 일대`;

/**
 * 동네 전체 값을 넣는다 — 이미 다른 원인으로 나빠져 있고 이번 값이 더 나쁘지 않으면 아무것도 하지 않는다
 * (state.setZone 의 b2 갈래는 그때도 회복 시각을 늦추고 알려짐을 켠다 — 다른 원인의 정전이 이 원인의 회복 시각을 늘리거나 알리기 전의 정전을 알려진 것으로 만들지 않게)
 */
function put(sim: Sim, z: number, f: Span['f'], v: number, until: number, cause: number, known: boolean): boolean {
  const Z = sim.world.zones[z];
  if (!Z) return false;
  const cur = Z[f], low = ZONE_DEFAULT[f] === 1;
  if (cur !== ZONE_DEFAULT[f] && !(low ? v < cur : v > cur)) return false;
  return setZone(sim, z, f, v, until, cause, known);
}

/** 지금 그 원인으로 값이 나빠져 있는 동네 */
function zonesOf(sim: Sim, f: Span['f'], cause: number): number[] {
  const out: number[] = [];
  const zs = sim.world.zones;
  for (let z = 0; z < zs.length; z++) if (zs[z].cause[f] === cause && zs[z][f] !== ZONE_DEFAULT[f]) out.push(z);
  return out;
}

/** 이번 건이 꺼뜨린 구간: 가운데가 그 건의 동네에 있고 지금 그 점이 정전인 구간 (구역 밖·다른 원인으로 이미 꺼진 동네는 빼고) */
function darkEdges(sim: Sim, zones: readonly number[]): number[] {
  const out: number[] = [];
  const c = sim.city;
  for (const e of c.edges) {
    const A = c.nodes[e.a], B = c.nodes[e.b], x = (A.x + B.x) / 2, y = (A.y + B.y) / 2;
    if (zones.indexOf(zoneOfXY(x, y)) < 0 || zoneAt(sim, 'power', x, y) >= 0.5) continue;
    out.push(e.id);
  }
  return out;
}

/** 병원의 응급실 수용을 상태에서 다시 계산한다: 정전 범위 안의 병원은 발전기로 돌아 HOSP_CUT 줄어든다 (C3 의 포화 판정이 그 값을 읽는다) */
function syncHospitals(sim: Sim): void {
  const hs = sim.world.hospitals;
  for (let k = 0; k < hs.length; k++) {
    const H = hs[k], f = sim.city.facilities[H.fac];
    if (!f) continue;
    const base = HOSPITAL_CAP[Math.min(k, HOSPITAL_CAP.length - 1)];
    const want = base - (zoneAt(sim, 'power', f.x, f.y) < 0.5 ? POWER.HOSP_CUT : 0);
    if (H.cap !== want) H.cap = want;
  }
}

/** (b3-10 b) 지금 불이 들어와 있는 승강기 건물 — 정전을 걸기 전에 적어 두고, 건 뒤에 꺼진 것만 L5 에 알린다(정전이 닿은 **순간** — 이미 꺼져 있던 건물은 다시 받지 않는다) */
function litLifts(sim: Sim): number[] { return liftPlaces(sim).filter((p) => !isDark(sim, p)); }
function liftsOut(sim: Sim, lit: readonly number[], cause: number, inc: number): void {
  const now = lit.filter((p) => isDark(sim, p));
  if (now.length) darkened(sim, now, { rate: 0, ev: cause, inc, what: 'outage', ref: -1 });
}

/** 한 건을 장부에 적는다 (꺼진 신호의 혼잡은 그 건마다 한 번 — 끝날 때 한 번 거둔다) */
function openSpan(sim: Sim, f: Span['f'], cause: number, inc: number, src: ZoneSpanSrc, zones: readonly number[], label: string, tellAt: number, bump: boolean): Span {
  const edges = bump ? darkEdges(sim, zones) : [];
  const sp: Span = { f, cause, inc, bump: edges.length ? addBump(sim, edges, POWER.DARK_BUMP, cause, 1, inc) : -1, src, since: sim.t, tellAt, told: false, label, next: false };
  sim.world.spans.push(sp);
  return sp;
}

/**
 * 끝난 건을 거둔다: 그 원인으로 나빠진 동네가 하나도 남지 않은 줄 — 얹은 혼잡을 한 번 빼고, 알려졌던 정전이 회복으로 끝났으면 복구 기록 한 줄.
 * (다른 건이 자리를 가져가 끝난 것 — 더 나쁘거나 더 넓은 정전 — 은 복구가 아니라 기록하지 않는다)
 */
function settle(sim: Sim, recovered: boolean): void {
  const sp = sim.world.spans;
  for (let k = 0; k < sp.length; k++) {
    const s = sp[k];
    if (s.f !== 'power' || zonesOf(sim, 'power', s.cause).length) continue;
    removeBump(sim, s.bump);
    if (recovered && s.told) {      // 태풍 정전은 알리지 않는다(재난 알림이 알렸다 — told 가 거짓)
      emit(sim, { role: 'SYSTEM', actor: '한국전력', kind: 'hazard', tag: 'power', imp: 1, causes: [s.cause], text: `${s.label} 전력 복구.` });
    }
    sp.splice(k--, 1);
  }
}

/** 이 신호가 끄는 것 — (가) 변전소·발전소면 동네 전체, (라) 자리 전선이 끊기면 국지. 없으면 null */
function planOf(sim: Sim, sig: Signal): { src: 'util'; zones: number[]; q: Place } | { src: 'line'; at: { x: number; y: number; r: number }; q: Place | null } | null {
  const q = sig.place >= 0 ? sim.city.places[sig.place] : undefined;
  if (q && POWER.UTIL_R[q.kind] !== undefined) {
    const cx = q.x + q.w / 2, cy = q.y + q.h / 2, R = POWER.UTIL_R[q.kind], zones: number[] = [];
    for (let z = 0; z < DISTRICTS.length; z++) if (Math.hypot(DISTRICTS[z].x - cx, DISTRICTS[z].y - cy) <= R && sim.world.zones[z].power > 0) zones.push(z);
    if (zones.length) return { src: 'util', zones, q };
  }
  if (sig.kind === 'fireBig' || sig.x < 0) return null;
  const shock = shockDelta(sig, 0);
  if (!(shock > 0)) return null;
  const I = sig.inc >= 0 ? sim.incidents[sig.inc] : undefined;
  const key = q ? 'grid:line:' + q.id : I ? 'grid:line:n' + I.truth.nodeId : null;
  if (key === null) return null;
  const thr = POWER.LINE_THR[0] + POWER.LINE_THR[1] * sim.rng.fork(key).next();      // 그 자리 전선이 얼마나 약한가 — 자리마다 한 번(같은 이름 = 같은 값)
  if (shock <= thr) return null;
  const L = POWER.LINE_R;
  const r = sig.kind === 'catastrophe' && sig.data === 1 ? L.total : sig.kind === 'collapse' ? L.start : L.blastA + L.blastB * sig.size;
  return { src: 'line', at: { x: sig.x, y: sig.y, r }, q: q ?? null };
}

registerConsequence({
  id: 'powerOut', label: '정전', on: ['fireBig', 'blast', 'collapse', 'catastrophe'],
  key: (_sim, sig) => (sig && sig.ev >= 0 ? 'ev:' + sig.ev : null),
  cooldown: 0, cap: POWER.CAP, spawns: false,
  test: (c) => planOf(c.sim, c.sig!) !== null,
  apply: (c) => {
    const sim = c.sim, sig = c.sig!, plan = planOf(sim, sig);
    if (!plan) return;
    const until = sim.t + POWER.HOLD, lit = litLifts(sim);
    let zones: number[], label: string;
    if (plan.src === 'util') {
      zones = plan.zones.filter((z) => put(sim, z, 'power', 0, until, sig.ev, false));
      label = zonesLabel(zones);
    } else {
      zones = setZoneArea(sim, 'power', 0, until, sig.ev, false, plan.at);
      const I = sig.inc >= 0 ? sim.incidents[sig.inc] : undefined;
      label = `${plan.q ? placeLabel(plan.q) : I ? I.truth.label : '사고 현장'} 주변`;
    }
    if (!zones.length) return;
    openSpan(sim, 'power', sig.ev, sig.inc, plan.src, zones, label, sim.t + c.rng.range(POWER.TELL[0], POWER.TELL[1]), true);
    settle(sim, false);      // 자리를 빼앗긴 앞 건(더 넓은 정전이 같은 동네를 가져갔다)이 있으면 거둔다
    syncHospitals(sim);
    liftsOut(sim, lit, sig.ev, sig.inc);      // (b3-10 b) 정전이 닿은 순간 운행 중이던 승강기 — L5
  },
  // 회복(그 동네 값이 회복 시각을 지나 처음 값으로): 그 건이 모든 동네에서 끝났으면 얹은 혼잡을 한 번 거두고 복구 기록 — 병원 수용도 다시 계산한다
  recover: (sim, _z, f) => { if (f !== 'power') return; settle(sim, true); syncHospitals(sim); },
});

registerConsequence({
  id: 'powerOut.grid', label: '정전(재난)', on: ['blackout', 'quake'],
  key: (_sim, sig) => (sig ? sig.kind + ':' + sig.data : null),
  cooldown: 0, cap: Infinity, spawns: false,
  test: (c) => {
    const sig = c.sig!;
    if (sig.kind === 'blackout') return sig.data === 1 ? sig.ev >= 0 : c.sim.world.spans.some((s) => s.src === 'blackout');
    return sig.ev >= 0 && sig.x >= 0;
  },
  apply: (c) => {
    const sim = c.sim, sig = c.sig!, zs = sim.world.zones;
    if (sig.kind === 'blackout') {
      if (sig.data === 1) {
        // 태풍의 정전: 모든 동네 — 재난 알림이 이미 알렸다(곧바로 known). 동네별 알림·복구 기록은 남기지 않는다. 꺼진 신호의 혼잡은 재난이 이미 얹었다(두 번 얹지 않는다)
        const zones: number[] = [], lit = litLifts(sim);
        for (let z = 0; z < zs.length; z++) if (put(sim, z, 'power', 0, sim.t + POWER.HOLD, sig.ev, true)) zones.push(z);
        if (zones.length) { openSpan(sim, 'power', sig.ev, -1, 'blackout', zones, '도시 전역', -1, false); liftsOut(sim, lit, sig.ev, -1); }
      } else {
        for (const s of sim.world.spans) if (s.src === 'blackout') endZoneBy(sim, s.cause, sim.t, 'power');      // 전력 복구 — 회복은 이 1초의 recoverWorld 가 한다
      }
      settle(sim, false);
      syncHospitals(sim);
      return;
    }
    // 지진: 동네마다 흔들림이 그 동네 전력망의 문턱을 넘으면 (여진은 mag 0.6 — 본진에서 꺼지지 않은 동네 가운데 문턱이 낮은 곳만. 이미 꺼진 곳은 setZone 이 다시 받지 않는다)
    const zones: number[] = [], lit = litLifts(sim);
    for (let z = 0; z < zs.length; z++) {
      const shake = sig.mag * Math.max(0, 1 - Math.hypot(DISTRICTS[z].x - sig.x, DISTRICTS[z].y - sig.y) / POWER.QUAKE_R);
      if (!(shake > 0)) continue;
      const thr = POWER.QUAKE_THR[0] + POWER.QUAKE_THR[1] * sim.rng.fork('grid:power:' + z).next();
      if (shake > thr && put(sim, z, 'power', 0, sim.t + POWER.QUAKE_HOLD, sig.ev, false)) zones.push(z);
    }
    if (!zones.length) return;
    openSpan(sim, 'power', sig.ev, -1, 'quake', zones, zonesLabel(zones), sim.t + c.rng.range(POWER.TELL[0], POWER.TELL[1]), true);
    settle(sim, false);
    syncHospitals(sim);
    liftsOut(sim, lit, sig.ev, -1);
  },
});

registerConsequence({
  id: 'powerOut.end', label: '정전 원인 종료', on: ['closed'],
  key: (sim, sig) => (sig && sig.inc >= 0 && sim.world.spans.some((s) => s.inc === sig.inc && s.src !== 'power') ? 'inc:' + sig.inc : null),
  cooldown: 0, cap: Infinity, spawns: false, silent: true,
  test: () => true,
  apply: (c) => {
    const sim = c.sim, sig = c.sig!;
    for (const s of sim.world.spans) {
      if (s.inc !== sig.inc || s.src === 'power') continue;
      if (s.f === 'power') endZoneBy(sim, s.cause, sim.t + c.rng.range(POWER.END[0], POWER.END[1]), 'power');
    }
  },
});

registerConsequence({
  id: 'powerOut.tell', label: '정전 알림', on: 'tick',
  key: (sim) => (sim.world.spans.some((s) => (s.tellAt ?? -1) >= 0 && sim.t >= s.tellAt!) ? 'tell' : null),
  cooldown: 0, cap: Infinity, spawns: false, silent: true,
  test: () => true,
  apply: (c) => {
    const sim = c.sim;
    for (const s of sim.world.spans) {
      if (s.f !== 'power' || (s.tellAt ?? -1) < 0 || sim.t < s.tellAt!) continue;
      s.tellAt = -1;
      const zones = zonesOf(sim, 'power', s.cause);
      if (!zones.length) continue;      // 알리기 전에 끝났다 — 알릴 것이 없다
      for (const z of zones) sim.world.zones[z].known.power = true;
      s.told = true;
      const local = s.src === 'line';
      emit(sim, { role: 'SYSTEM', actor: '한국전력', kind: 'hazard', tag: 'power', imp: 2, causes: [s.cause], text: `${s.label} 정전 — ${local ? '인근 ' : ''}신호등이 꺼졌습니다.` });
    }
  },
});
