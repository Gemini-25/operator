// C4 `powerOut` — 전력 (설계서 I1 §3.7 C4 · 국지 구역 값 §3.6c). 정전은 **상태**다 — 사건을 직접 만들지 않는다:
// 꺼진 신호는 혼잡(traffic.addBump — what 1)으로 L1 에, 정전이 닿은 순간 운행 중이던 승강기는 L5(expo.darkened → laws/power.ts)에, 긴 정전은 C8(아래 절)에 닿는다.
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
import { emit, raiseProblem } from '../../events';
import { tileOf } from '../../field/grid';
import { addBump, removeBump } from '../../traffic';
import { T } from '../../types';
import type { Place, Scene, Signal, WorldState, ZoneSpanSrc } from '../../types';
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
  recover: (sim, _z, f, cause) => {
    if (f !== 'power') return;
    endZoneBy(sim, cause, sim.t + COMMS.AFTER, 'comms');      // (b3-10 c) 긴 정전이 넘긴 통신 장애는 전력이 돌아오고 AFTER 초 뒤에 풀린다
    settle(sim, true); syncHospitals(sim);
  },
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
      else if (s.f === 'comms') endZoneBy(sim, s.cause, sim.t + COMMS.AFTER, 'comms');      // (b3-10 c) 방송국·관제탑 사고의 통신 장애 — 원인 종료 + AFTER
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

// ───────────────────────── C8 commsDown — 무전 음영이 늘어난다 (설계서 I1 §3.7 C8 · 상태 결합) ─────────────────────────
// 원인들: (가) 방송국·관제탑 건물의 사건(큰 불·폭발·붕괴·X6) → UTIL_R 안 동네 comms = UTIL_V
//         (나) C4 의 정전이 BACKUP 초 이어짐(통신 기지국 예비 전원이 떨어진다) → 그 정전의 범위(국지면 같은 자리) comms = POWER_V — 알려지는 것은 그 범위 현장의 첫 COMM_FAIL 때
//         (다) 지진(quake — 흔들림은 C4 와 같은 식)이 동네마다 그 동네 통신망의 문턱(흐름 grid:comms:<동네>)을 넘으면 QUAKE_V
//         (라) 태풍 정전이 BACKUP 초 → 모든 동네 STORM_V (동네별 기록 없이 알림 한 줄)
// 회복: 원인이 끝나고 AFTER 초 뒤(정전이 넘긴 것은 전력이 돌아온 뒤 — powerOut 의 recover, 방송국·관제탑은 그 사건이 닫힌 뒤 — powerOut.end), 지진은 t + QUAKE_HOLD.
//   처음 값은 t + HOLD(원인이 끝나지 않아도 풀린다).
// 결과: 그 범위의 열린 현장과 이후 만들어지는 현장에 무전 음영을 더한다(commsDown.shadow — 1초마다 현장을 맞춘다): 바닥 칸의 (1 − comms) × SHADOW 까지를 덩어리(반지름 BLOB_R)로,
//   더한 칸을 s.shadowAdd 에 — 회복 때 원래 0 이던 그 칸만 되돌린다. 고르는 난수 csq:shadow:<현장 id>. 그 뒤의 COMM_FAIL·재배정은 지금 코드가 한다(재계획 field).
//   더한 음영에서 보고가 끊기면(그 COMM_FAIL 의 대원이 더한 칸에 서 있다) 그 사건에 INFRA_FAIL 한 줄(원인 = 그 COMM_FAIL · 통신 장애의 원인 기록) — 정전·통신 장애가 대응을 막았다.
// 현장 음영을 고치는 것은 현장 진실의 변화라 이 파일이 sim.scenes 를 고친다(세계 규칙과 같은 자격). 음영은 매 프레임 그린다 — staticSig 는 고치지 않는다.
// 순환 금지: 정전 → 통신 한 방향뿐이다(통신은 정전을 만들지 않는다). 상한 교대당 CAP 건(네 갈래가 함께 센다). 사건을 만들지 않는다.

/**
 * 통신 장애의 크기와 시간 (설계서 §3.7 C8 의 첫 값 — BACKUP 만 다르다):
 *  UTIL_R · UTIL_V   방송국·관제탑 사고가 닿는 동네 · 그 값 / POWER_V 긴 정전 / QUAKE_V 지진 / STORM_V 태풍 정전
 *  BACKUP   정전이 이만큼 이어지면 기지국 예비 전원이 떨어진다 — 본문의 120 이 아니다: 태풍 정전이 꼭 120초이고(disaster.lightsOn) 그 틱의 신호가 1초 블록보다 먼저 처리돼 (라)가 영영 걸리지 않는다
 *  AFTER    원인이 끝난 뒤 풀리기까지 · QUAKE_HOLD 지진의 통신 장애 · HOLD 원인이 끝나지 않아도 풀리기까지
 *  QUAKE_THR 동네 통신망의 문턱 = a + b × u · SHADOW 더하는 음영(바닥 칸의 (1 − comms) × SHADOW 까지) · BLOBS 덩어리 수 [lo, hi] · BLOB_R 덩어리 반지름(칸) · CAP 교대당
 *  KEEP_STAGE · KEEP_SAFE  대기 지점(부대 차량)·안전 구역에서 이만큼(칸) 안에는 음영을 더하지 않는다 — 차량 무전이 닿는다. 더하면 대기 지점에 서서 지시를 기다리는 대원이
 *           영영 지시를 받지 못해 같은 지시가 5초마다 되풀이되고(보통 S21 — 64번) 보고를 쥔 채 서 있는 대원 때문에 현장이 멈췄다(보통 S20 — 188초)
 */
export const COMMS = {
  UTIL_R: 800, UTIL_V: 0.4, POWER_V: 0.6, QUAKE_V: 0.5, STORM_V: 0.7,
  BACKUP: 100, AFTER: 180, QUAKE_HOLD: 300, HOLD: 600,
  QUAKE_THR: [0.35, 0.5] as [number, number],
  SHADOW: 0.3, BLOBS: [3, 5] as [number, number], BLOB_R: [2, 3] as [number, number], CAP: 3,
  KEEP_STAGE: 7, KEEP_SAFE: 5,
};
const COMM_KINDS: Record<string, boolean> = { broadcast: true, tower: true };
const COMMS_N = 'commsDown.spans';      // world.count 의 칸 — 이번 교대에 연 통신 장애 건수 (네 갈래가 함께 센다 — 규칙의 count 는 발동 수라 따로 둔다)
const commsN = (sim: Sim): number => sim.world.count[COMMS_N] ?? 0;

function commsSpan(sim: Sim, cause: number, inc: number, src: ZoneSpanSrc, label: string, told: boolean): void {
  sim.world.count[COMMS_N] = commsN(sim) + 1;
  sim.world.spans.push({ f: 'comms', cause, inc, bump: -1, src, since: sim.t, tellAt: -1, told, label, next: false });
}
const tellComms = (sim: Sim, causes: number[], text: string): number => emit(sim, { role: 'SYSTEM', actor: '통신사', kind: 'hazard', tag: 'comms', imp: 2, causes, text });

/** (가)·(다) 이 신호가 흔드는 통신 — 방송국·관제탑의 사건이면 그 곁 동네, 지진이면 문턱을 넘은 동네. 없으면 빈 목록 */
function commsPlan(sim: Sim, sig: Signal): { src: 'comm' | 'quake'; zones: number[]; q: Place | null } {
  const zs = sim.world.zones, out: number[] = [];
  if (sig.kind === 'quake') {
    if (sig.x < 0) return { src: 'quake', zones: out, q: null };
    for (let z = 0; z < zs.length; z++) {
      const shake = sig.mag * Math.max(0, 1 - Math.hypot(DISTRICTS[z].x - sig.x, DISTRICTS[z].y - sig.y) / POWER.QUAKE_R);
      if (!(shake > 0) || zs[z].comms <= COMMS.QUAKE_V) continue;
      if (shake > COMMS.QUAKE_THR[0] + COMMS.QUAKE_THR[1] * sim.rng.fork('grid:comms:' + z).next()) out.push(z);
    }
    return { src: 'quake', zones: out, q: null };
  }
  const q = sig.place >= 0 ? sim.city.places[sig.place] : undefined;
  if (!q || !COMM_KINDS[q.kind]) return { src: 'comm', zones: out, q: null };
  const cx = q.x + q.w / 2, cy = q.y + q.h / 2;
  for (let z = 0; z < zs.length; z++) if (Math.hypot(DISTRICTS[z].x - cx, DISTRICTS[z].y - cy) <= COMMS.UTIL_R && zs[z].comms > COMMS.UTIL_V) out.push(z);
  return { src: 'comm', zones: out, q };
}

registerConsequence({
  id: 'commsDown', label: '통신 장애', on: ['fireBig', 'blast', 'collapse', 'catastrophe', 'quake'],
  key: (_sim, sig) => (sig && sig.ev >= 0 ? 'ev:' + sig.ev : null),
  cooldown: 0, cap: Infinity, spawns: false,
  test: (c) => commsN(c.sim) < COMMS.CAP && commsPlan(c.sim, c.sig!).zones.length > 0,
  apply: (c) => {
    const sim = c.sim, sig = c.sig!, plan = commsPlan(sim, sig);
    const quake = plan.src === 'quake', v = quake ? COMMS.QUAKE_V : COMMS.UTIL_V, until = sim.t + (quake ? COMMS.QUAKE_HOLD : COMMS.HOLD);
    const zones = plan.zones.filter((z) => put(sim, z, 'comms', v, until, sig.ev, true));
    if (!zones.length) return;
    const label = zonesLabel(zones);
    commsSpan(sim, sig.ev, quake ? -1 : sig.inc, plan.src, label, true);
    tellComms(sim, [sig.ev], `${quake ? '지진으로' : `${plan.q ? placeLabel(plan.q) : '시설'} 사고로`} ${label} 통신 장애 — 무전이 끊기는 곳이 늘었습니다.`);
  },
  // 회복: 그 건이 모든 동네에서 끝났으면 장부에서 거두고, 알려졌던 것이면 복구 기록 한 줄 (현장의 음영은 commsDown.shadow 가 다음 1초에 되돌린다)
  recover: (sim, _z, f, cause) => {
    if (f !== 'comms') return;
    const sp = sim.world.spans;
    for (let k = 0; k < sp.length; k++) {
      const s = sp[k];
      if (s.f !== 'comms' || s.cause !== cause || zonesOf(sim, 'comms', cause).length) continue;
      if (s.told) emit(sim, { role: 'SYSTEM', actor: '통신사', kind: 'hazard', tag: 'comms', imp: 1, causes: [cause], text: `${s.label} 통신 복구.` });
      sp.splice(k--, 1);
    }
  },
});

registerConsequence({
  id: 'commsDown.power', label: '통신 장애(긴 정전)', on: 'tick',
  key: (sim) => (sim.world.spans.some((s) => s.f === 'power' && !s.next && sim.t - (s.since ?? sim.t) >= COMMS.BACKUP) ? 'power' : null),
  cooldown: 0, cap: Infinity, spawns: false, silent: true,
  test: () => true,
  apply: (c) => {
    const sim = c.sim, zs = sim.world.zones;
    for (const s of sim.world.spans.slice()) {
      if (s.f !== 'power' || s.next || sim.t - (s.since ?? sim.t) < COMMS.BACKUP) continue;
      s.next = true;
      if (commsN(sim) >= COMMS.CAP) continue;
      const storm = s.src === 'blackout', v = storm ? COMMS.STORM_V : COMMS.POWER_V, until = sim.t + COMMS.HOLD;
      const zones = zonesOf(sim, 'power', s.cause).filter((z) => {
        const at = zs[z].at ? zs[z].at!.power : undefined;
        return at ? setZone(sim, z, 'comms', v, until, s.cause, storm, at) : put(sim, z, 'comms', v, until, s.cause, storm);
      });
      if (!zones.length) continue;
      // (라) 태풍 정전: 모든 동네 — 알림 한 줄로 곧바로 알려진다. (나) 그 밖: 그 범위 현장의 첫 COMM_FAIL 이 나올 때 알려진다 (commsDown.shadow)
      commsSpan(sim, s.cause, s.inc, storm ? 'blackout' : 'power', storm ? '도시 곳곳' : s.label ?? zonesLabel(zones), storm);
      if (storm) tellComms(sim, [s.cause], '정전이 길어져 도시 곳곳의 통신 기지국 예비 전원이 떨어졌습니다 — 무전이 끊기는 곳이 늘었습니다.');
    }
  },
});

const floorish = (ti: number): boolean => ti === T.FLOOR || ti === T.GROUND || ti === T.ROAD || ti === T.TRAIL;
/** 통신 장애의 현장 음영: 바닥 칸(대기 지점·안전 구역 곁은 뺀다)의 (1 − comms) × SHADOW 까지를 덩어리로 골라 음영으로 — 원래 음영이 아니던 칸만 (고른 칸을 돌려준다. 덩어리가 다 차면 그보다 적을 수 있다) */
function addShadow(sim: Sim, s: Scene, comms: number): number[] {
  const out: number[] = [], t = s.tiles, W = s.w, floor: number[] = [];
  const kept = (i: number): boolean => { const x = i % W + 0.5, y = ((i / W) | 0) + 0.5; return Math.hypot(x - s.staging.x, y - s.staging.y) < COMMS.KEEP_STAGE || Math.hypot(x - s.safe.x, y - s.safe.y) < COMMS.KEEP_SAFE; };
  for (let i = 0; i < t.length; i++) if (floorish(t[i]) && !s.shadow[i] && !kept(i)) floor.push(i);
  const want = Math.round((1 - comms) * COMMS.SHADOW * floor.length);
  if (want <= 0) return out;
  const rng = sim.rng.fork('csq:shadow:' + s.id), seen = new Uint8Array(t.length);
  const nb = rng.int(COMMS.BLOBS[0], COMMS.BLOBS[1]);
  for (let b = 0; b < nb && out.length < want; b++) {
    const c0 = rng.pick(floor), cx = c0 % W, cy = (c0 / W) | 0, r = rng.range(COMMS.BLOB_R[0], COMMS.BLOB_R[1]), R = Math.ceil(r);
    for (let dy = -R; dy <= R && out.length < want; dy++) for (let dx = -R; dx <= R && out.length < want; dx++) {
      const x = cx + dx, y = cy + dy;
      if (x < 0 || y < 0 || x >= W || y >= s.h || dx * dx + dy * dy > r * r) continue;
      const i = y * W + x;
      if (seen[i] || s.shadow[i] || !floorish(t[i]) || kept(i)) continue;
      seen[i] = 1; out.push(i);
    }
  }
  for (const i of out) s.shadow[i] = 1;
  return out;
}
/** INFRA_FAIL 의 까닭 말 (그 통신 장애를 만든 길) */
const WHY: Record<string, string> = { power: '정전이 길어져 기지국 예비 전원이 떨어졌다', blackout: '태풍 정전이 길어졌다', quake: '지진', comm: '방송·관제 시설 사고' };

registerConsequence({
  id: 'commsDown.shadow', label: '무전 음영', on: 'tick',
  key: (sim) => {
    for (const Z of sim.world.zones) if (Z.comms < 1) return 'shadow';
    for (const I of sim.incidents) if (sim.scenes[I.id]?.shadowAdd) return 'shadow';
    return null;
  },
  cooldown: 0, cap: Infinity, spawns: false, silent: true,
  test: () => true,
  apply: (c) => {
    const sim = c.sim;
    for (const I of sim.incidents) {
      const s = sim.scenes[I.id];
      if (!s || (I.pursuit && I.pursuit.state === 'driving')) continue;
      const v = zoneAt(sim, 'comms', I.truth.x, I.truth.y);
      if (v >= 1) { if (s.shadowAdd) { for (const i of s.shadowAdd) s.shadow[i] = 0; s.shadowAdd = undefined; } continue; }      // 회복 — 원래 0 이던 그 칸만 되돌린다
      if (I.phase === 'closed') continue;
      if (!s.shadowAdd) { s.shadowAdd = addShadow(sim, s, v); continue; }
      if (!s.shadowAdd.length || I.problems.some((p) => p.code === 'INFRA_FAIL')) continue;
      // 더한 음영에서 보고가 끊겼다 (이 1초 안의 COMM_FAIL 가운데 그 대원이 더한 칸에 서 있는 것) — 정전·통신 장애가 대응을 막았다
      for (const p of I.problems) {
        if (p.code !== 'COMM_FAIL' || p.t < sim.t - 1.2 || p.eventId < 0) continue;
        const e = sim.events[p.eventId];
        if (!e || e.role !== 'RESPONDER' || e.rid < 0) continue;
        const a = s.agents.find((q) => q.rid === e.rid);
        if (!a || s.shadowAdd.indexOf(tileOf(s, a.x, a.y)) < 0) continue;
        const Z = sim.world.zones[zoneOfXY(I.truth.x, I.truth.y)];
        const cause = Z ? Z.cause.comms : -1, sp = sim.world.spans.find((q) => q.f === 'comms' && q.cause === cause);
        const label = sp?.label ?? '그 일대', why = WHY[sp?.src ?? 'comm'] ?? '통신 장애';
        if (Z && !Z.known.comms && sp) {
          // (나) 긴 정전이 넘긴 통신 장애가 처음 드러났다 — 그 COMM_FAIL 을 원인으로 관제에 알려진다
          for (const z of zonesOf(sim, 'comms', cause)) sim.world.zones[z].known.comms = true;
          sp.told = true;
          tellComms(sim, [p.eventId, cause], `${label} 정전이 길어져 통신 기지국이 멈췄습니다 — 무전이 끊기는 곳이 늘었습니다.`);
        }
        const detail = `${label} 통신 장애(${why})로 무전 음영이 늘어 보고가 끊겼습니다`;
        raiseProblem(sim, I, 'INFRA_FAIL', detail, { role: 'SYSTEM', actor: '통신사', imp: 1, causes: [p.eventId, cause], text: `${detail}.` });
        break;
      }
    }
  },
});
