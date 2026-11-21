// 건물의 노출 상태 · 이웃 (설계서 I1 §3.6c). 사건이 없던 건물이 이웃의 불·폭발·붕괴에서 받는 것을 sim.world.expo 에 둔다 —
// X6 의 Sim.placeMarks("그 건물에서 난 사건이 남긴 가장 무거운 상태 하나")는 넓히지 않는다.
//
// 이 파일은 등록이 없는 파일이다(§3.4): 법칙(world/laws/*)·상태 규칙(world/rules/*)과 다른 모듈(sceneManager·disaster·catastrophe …)이 함께 부르는 함수를 여기에 둔다 —
// 법칙·규칙 파일을 다른 모듈이 import 하면 그 파일의 등록이 모음 파일의 차례보다 먼저 실행된다.
//
// 지키는 것:
//  · 도시 지도(city.places)를 고치지 않는다. 이웃 목록은 도시 열쇠의 WeakMap 에 두고 다시 쓴다 — 도시는 고정이고 이 값은 시드와 무관하다(건물의 생김새뿐).
//  · 시드에 따라 달라지는 값은 sim.world 안에만 둔다(배관의 문턱 pipeThr). 도시 열쇠의 캐시에 두면 앞서 돈 시드의 값이 다음 시드에 쓰인다 (§3.6c — 시험: A 다음의 B).
//  · 진실 쪽이다. 판단(관제·지휘관·대원)은 이 파일의 함수와 world.expo 를 읽지 않는다 (§3.8 — tests/hazard.test.ts 가 글자로 본다).
//
// 채우는 단계: b3-7 이웃(neighborsOf·neighborsOfPoint — L2 의 열원 곁) · expoOf(노출 칸을 만든다 — 쓰는 것은 b3-8 의 충격, b3-12 의 침수).
// (b3-8 a) 충격의 크기(SHOCK·shockDelta — 상태 규칙 rules/structure.ts 의 shockSpread 와 b3-8c 의 법칙 structFail·pipeLeak 이 함께 쓴다).
// applyExpo(현장 생성기가 노출을 읽는 자리)는 b3-8 b, darkened(정전이 닿은 순간)는 b3-10 이 더한다.

import type { Sim } from '../engine';
import type { Place, PlaceExpo, PlaceKind, Signal } from '../types';

/** 이웃으로 치는 벽-벽 틈 (도시 좌표). 조사: 가장 가까운 이웃까지의 틈은 최소 2.0 · 중앙값 7.2 · p90 23.4 — 같은 편 옆집은 2~12, 길 건너는 20~35 */
export const NB_REACH = 30;

/**
 * (b3-8 L3 (가)) 붕괴와 폭발이 이웃 건물에 남기는 구조 손상 shake (0..1) — 모두 첫 값 (설계서 §3.7 L3). 균형은 hazstats 의 hazard-shock 줄로 다시 맞춘다:
 *  K        폭발: X6 의 현장 안 식(catOnBlast — K_HIT_BLAST)을 밖으로 그대로 잇는다: Δ = K × mag/100 × max(0, 1 − d/(size + 2)), d = gap/CELL + PAD (칸).
 *           반경 6칸·피해 50 → 틈 3 에 0.22 · 틈 7.2 에 0.12 · 틈 12 넘으면 0
 *  CELL     현장 1칸 ≈ 도시 좌표 2 (표본 9건의 범위 1.2~4.0 — 첫 판은 상수) · PAD 폭발 자리에서 그 건물의 벽까지 어림 2칸
 *  TOTAL    건물 전체가 무너졌을 때(collapseBuilding — 'catastrophe' 신호 data 1 · mag ≥ 1)만: 틈 REACH 안의 이웃에 TOTAL × (1 − gap/REACH) (틈 3 에 0.48 · 7.2 에 0.31)
 *  START    무너진 채 시작하는 사건(크레인·가스 폭발·산사태 — 'collapse' 신호, 크기 ≥ START_SIZE): START × (1 − gap/REACH). 2차 붕괴(≤ 3칸)·구획 하나의 붕괴는 밖으로 나가지 않는다
 *  S_MIN    금 기록과 structFail(b3-8c)의 문턱. 배관은 건물마다의 문턱 pipeThr(0.2 + 0.6u — expoOf)
 * 한 번의 충격이 S_MIN 과 배관 문턱의 아래쪽을 넘을 수 있어야 한다는 것이 이 값들의 조건이다(설계서 — 초안의 0.25·0.15 × (1 − g/8) 은 가장 좁은 틈에서도 닿지 못했다)
 */
export const SHOCK = { K: 0.8, CELL: 2, PAD: 2, TOTAL: 0.6, START: 0.35, REACH: 15, START_SIZE: 10, S_MIN: 0.1 };

/** 도시가스를 쓰는 건물 종류 (배관이 끊길 수 있는 건물): 주택·다세대·아파트·오피스텔·식당·카페·상점·시장·편의점·호텔 */
export const GAS_KINDS: ReadonlySet<PlaceKind> = new Set<PlaceKind>(['houseS', 'houseL', 'villa', 'apartment', 'officetel', 'restaurant', 'cafe', 'shop', 'market', 'convenience', 'hotel']);

/**
 * 신호 하나가 벽-벽 틈 gap 의 이웃에 주는 구조 손상 (0 = 닿지 않는다 — 틈이 멀수록 작다). 받는 신호: 폭발('catastrophe' data 0 · 'blast' — mag = 피해량, size = 반경(칸)),
 * 건물 전체의 붕괴('catastrophe' data 1 이고 mag ≥ 1), 무너진 채 시작하는 사건('collapse' 이고 크기 ≥ START_SIZE). 그 밖(구획 붕괴 mag < 1 · 2차 붕괴 · 전소)은 0
 */
export function shockDelta(sig: Signal, gap: number): number {
  if ((sig.kind === 'catastrophe' && sig.data === 0) || sig.kind === 'blast') {
    const d = gap / SHOCK.CELL + SHOCK.PAD, R = sig.size + 2;
    return d < R ? SHOCK.K * (sig.mag / 100) * (1 - d / R) : 0;
  }
  if (sig.kind === 'catastrophe' && sig.data === 1 && sig.mag >= 1) return gap < SHOCK.REACH ? SHOCK.TOTAL * (1 - gap / SHOCK.REACH) : 0;
  if (sig.kind === 'collapse' && sig.size >= SHOCK.START_SIZE) return gap < SHOCK.REACH ? SHOCK.START * (1 - gap / SHOCK.REACH) : 0;
  return 0;
}

/** 이웃 하나: 건물 id 와 벽-벽 틈(도시 좌표) */
export interface Nb { id: number; gap: number }

/** 노출 칸 — 없으면 만든다. 배관의 문턱(그 건물의 배관이 얼마나 약한가)은 만들 때 한 번: 흐름 hz:pipe:<건물> 의 첫 값 (fork 는 부모 흐름을 쓰지 않는다) */
export function expoOf(sim: Sim, placeId: number): PlaceExpo {
  const ex = sim.world.expo;
  let e = ex[placeId];
  if (!e) e = ex[placeId] = { shake: 0, shakeEv: -1, shakeInc: -1, pipe: false, pipeEv: -1, pipeThr: 0.2 + 0.6 * sim.rng.fork('hz:pipe:' + placeId).next(), wet: false, wetEv: -1, dark: -1 };
  return e;
}

// ───────────────────────── 이웃 (시드와 무관 — 도시 열쇠의 캐시) ─────────────────────────

/** 돌려 놓인 건물의 네 꼭짓점 (가운데를 축으로 rot 만큼 — city.placeAt 과 같은 변환) */
function corners(q: Place): number[] {
  const cx = q.x + q.w / 2, cy = q.y + q.h / 2, r = q.rot ?? 0, c = Math.cos(r), s = Math.sin(r), hw = q.w / 2, hh = q.h / 2;
  const out: number[] = [];
  for (const [lx, ly] of [[-hw, -hh], [hw, -hh], [hw, hh], [-hw, hh]]) out.push(cx + lx * c - ly * s, cy + lx * s + ly * c);
  return out;
}
/** 점에서 건물 벽까지의 거리 (안이면 0) — 점을 건물의 축으로 돌려 놓고 상자까지 잰다 */
export function pointGap(q: Place, x: number, y: number): number {
  const cx = q.x + q.w / 2, cy = q.y + q.h / 2, r = q.rot ?? 0;
  let lx = x - cx, ly = y - cy;
  if (r) { const c = Math.cos(-r), s = Math.sin(-r), tx = lx * c - ly * s; ly = lx * s + ly * c; lx = tx; }
  const dx = Math.max(0, Math.abs(lx) - q.w / 2), dy = Math.max(0, Math.abs(ly) - q.h / 2);
  return Math.hypot(dx, dy);
}
/** 두 건물의 벽-벽 틈: 겹치지 않는 두 볼록 사각형의 거리는 한쪽 꼭짓점에서 다른 쪽까지의 거리 가운데 가장 작은 것이다 (건물은 겹치지 않는다 — 도시 시험) */
export function wallGap(a: Place, b: Place): number {
  let g = Infinity;
  const ca = corners(a), cb = corners(b);
  for (let k = 0; k < 8; k += 2) { const d = pointGap(b, ca[k], ca[k + 1]); if (d < g) g = d; }
  for (let k = 0; k < 8; k += 2) { const d = pointGap(a, cb[k], cb[k + 1]); if (d < g) g = d; }
  return g;
}
const halfDiag = (q: Place): number => Math.hypot(q.w, q.h) / 2;
/** 이웃이 될 수 있는 건물: 터(공원·숲·하천 …)와 출동 시설은 뺀다 */
const isBuilding = (q: Place): boolean => !q.open && q.facility < 0;

const NB_OF = new WeakMap<Place[], Map<number, readonly Nb[]>>();
const NB_PT = new WeakMap<Place[], Map<string, readonly Nb[]>>();
const byGap = (a: Nb, b: Nb): number => a.gap - b.gap || a.id - b.id;

/** 그 건물의 이웃: 벽-벽 틈 NB_REACH 안의 건물, 가까운 순(같으면 id 순). 터·출동 시설·그 건물 자신은 뺀다. 건물마다 처음 한 번 만들어 둔다 */
export function neighborsOf(sim: Sim, placeId: number): readonly Nb[] {
  const places = sim.city.places;
  let tab = NB_OF.get(places);
  if (!tab) NB_OF.set(places, (tab = new Map()));
  const hit = tab.get(placeId);
  if (hit) return hit;
  const p = places[placeId], out: Nb[] = [];
  if (p) {
    const px = p.x + p.w / 2, py = p.y + p.h / 2, pr = halfDiag(p);
    for (const q of places) {
      if (q.id === placeId || !isBuilding(q)) continue;
      if (Math.hypot(q.x + q.w / 2 - px, q.y + q.h / 2 - py) - pr - halfDiag(q) > NB_REACH) continue;
      const g = wallGap(p, q);
      if (g <= NB_REACH) out.push({ id: q.id, gap: g });
    }
    out.sort(byGap);
  }
  tab.set(placeId, out);
  return out;
}
/** 길 위의 사건(차량 화재·폭발물 …)의 이웃: 그 점에서 벽까지의 거리 NB_REACH 안의 건물, 가까운 순. 점마다 처음 한 번 만들어 둔다 */
export function neighborsOfPoint(sim: Sim, x: number, y: number): readonly Nb[] {
  const places = sim.city.places;
  let tab = NB_PT.get(places);
  if (!tab) NB_PT.set(places, (tab = new Map()));
  const key = x + ',' + y, hit = tab.get(key);
  if (hit) return hit;
  const out: Nb[] = [];
  for (const q of places) {
    if (!isBuilding(q)) continue;
    if (Math.hypot(q.x + q.w / 2 - x, q.y + q.h / 2 - y) - halfDiag(q) > NB_REACH) continue;
    const g = pointGap(q, x, y);
    if (g <= NB_REACH) out.push({ id: q.id, gap: g });
  }
  out.sort(byGap);
  tab.set(key, out);
  return out;
}
