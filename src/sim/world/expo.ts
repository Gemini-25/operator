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
// (b3-8 a·b) 충격의 크기(SHOCK·shockDelta — 상태 규칙 rules/structure.ts 의 shockSpread 와 b3-8c 의 법칙 structFail·pipeLeak 이 함께 쓴다)와
//   applyExpo(현장 생성기가 노출을 읽는 자리 — sceneManager.createScene 의 buildScene 바로 다음). (b3-10 b) darkened — 정전이 건물에 닿은 순간(L5 liftStall 의 충격).

import type { Sim } from '../engine';
import { T } from '../types';
import type { Incident, Place, PlaceExpo, PlaceKind, Scene, Signal } from '../types';
import { addProp } from '../field/kit';
import { INCIDENT_PLACES } from '../cityPlan';
import { scenarioOf } from '../scenarios';
import { hazardImpulse } from './hazard';
import type { HzPart } from './hazard';
import { placeState, zoneOfPlace } from './state';

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

// ───────────────────────── 불이 옮겨붙을 수 있는 건물 (L2 의 열 항과 불티 항이 함께 쓴다 — b3-8c 에서 laws/heat.ts 로부터 옮겼다) ─────────────────────────

/** 건물 종류의 타기 쉬운 정도 M (적지 않은 종류는 1): 시장·창고·작업장·상점 1.3 · 주택·식당·카페·편의점·공장 1 · 아파트·오피스텔·사무용 0.6 */
const MUL: Partial<Record<PlaceKind, number>> = { market: 1.3, fishMarket: 1.3, warehouse: 1.3, workshop: 1.3, shop: 1.3, apartment: 0.6, officetel: 0.6, office: 0.6 };
export function heatMul(kind: PlaceKind): number { return MUL[kind] ?? 1; }

/** 이번 교대에 이미 불이 난 건물 — 화재 사건이 있었거나 현장에 탄 칸이 있다(탈 것이 탔다) */
export function burnedPlaces(sim: Sim): Set<number> {
  const out = new Set<number>();
  for (const J of sim.incidents) {
    const p = J.truth.placeId;
    if (p < 0) continue;
    if (J.truth.type === 'fire') { out.add(p); continue; }
    const s = sim.scenes[J.id];
    if (s && s.burnedTiles > 0) out.add(p);
  }
  return out;
}
/**
 * 옮겨붙은 불의 대상이 될 수 있는 건물인가 (터·출동 시설은 이웃 목록이 이미 뺐다):
 * 화재 현장의 틀이 있는 종류(평소 화재의 장소 표에 있다) · 이번 교대에 아직 불이 나지 않았다(burned) · 쓸 수 있다(전소·전체 붕괴가 아니다)
 */
export function fireTargetOk(sim: Sim, placeId: number, burned: ReadonlySet<number>): boolean {
  const q = sim.city.places[placeId];
  return !!q && (INCIDENT_PLACES.fire[q.kind] ?? 0) > 0 && !burned.has(placeId) && placeState(sim, placeId)?.usable !== false;
}

/**
 * (b3-8c L2 의 불티 항) 폭발 순간 한 번, 이웃 건물에 날아든 불티 — 충격(hazardImpulse)으로 그 건물의 heatSpread 칸에 더한다 (설계서 §3.7 L2):
 *   ΔH = K × M × (mag / 50) × (CELL × size)² / (gap + 6)²    — 반경 6칸·피해 50 의 폭발 → 틈 3 에 0.44(36%) · 틈 7.2 에 0.21(19%) · 틈 25 에 0.04
 *  K       첫 값 (설계서) · NB_MAX 폭발 하나가 불티를 보내는 가까운 건물의 수 (L2 의 열 항과 같은 8채)
 * 법칙이 아니라 충격의 크기다 — 그 칸의 문턱(hz:heatSpread:<건물> — "그 건물이 얼마나 타기 쉬운가")은 열 항과 같다. 주는 자리는 rules/structure.ts 의 shockSpread
 */
export const EMBER = { K: 0.25, NB_MAX: 8 };
/** 폭발 신호 하나가 틈 gap · 타기 쉬운 정도 mul 의 이웃에 주는 불티 (폭발이 아니면 0) */
export function emberDelta(sig: Signal, gap: number, mul: number): number {
  if (!((sig.kind === 'catastrophe' && sig.data === 0) || sig.kind === 'blast')) return 0;
  const r = SHOCK.CELL * sig.size, g = gap + 6;
  return EMBER.K * mul * (sig.mag / 50) * (r * r) / (g * g);
}

/**
 * (b3-9 L7) 닫힌 현장에 실제로 남은 불씨와 열 — 식어 가는 동안의 재발화 위험 (설계서 §3.7 L7. 틱 없이 닫힌 꼴의 식 — 주는 자리는 rules/structure.ts 의 residualHeat):
 *   e0 = Σ(불 > FIRE_MIN 인 칸의 불 세기) + HEAT_W × Σ(열 > HEAT_MIN 인 칸의 열), 칸마다 × (1 − 젖음)
 *   e(Δt) = e0 × exp(−Δt / τ) 로 식고 위험률 λ = K × e — 누적 H(Δt) = K × e0 × τ × (1 − exp(−Δt / τ)), 끝내 닿는 값 H∞ = K × e0 × τ
 *  K      첫 값 (e0 = 3 — 불씨 다섯 칸과 뜨거운 칸 여섯쯤 — 이면 H∞ = 0.54, 42%) · TAU 식는 시간(초) · TAU_RAIN 비가 오면 · MIN_DELAY 다시 붙기까지 적어도
 * 잔불 정리를 마친 구역은 열 0 · 젖음 0.9 라 저절로 0 이다 — "잔불 정리를 했는가"를 따로 묻지 않는다(상태가 말한다).
 * 그 건물 안(실내 구역)의 칸만 센다 — 건물 현장의 불 요약(hazards.fireLoad)과 같은 규칙: 산불 현장의 타는 숲·마당의 불은 그 건물의 잔불이 아니다. 길 위의 현장(건물 없음)은 부르지 않는다
 */
export const RESIDUAL = { K: 1.0e-3, TAU: 180, TAU_RAIN: 120, MIN_DELAY: 60, FIRE_MIN: 0.04, HEAT_MIN: 0.5, HEAT_W: 0.25 };
export function residualOf(s: Scene): number {
  const fire = s.fire, heat = s.heat, wet = s.wet;
  let e = 0;
  for (let i = 0; i < fire.length; i++) {
    const f = fire[i], h = heat[i];
    if (!(f > RESIDUAL.FIRE_MIN) && !(h > RESIDUAL.HEAT_MIN)) continue;
    const r = s.region[i];
    if (r < 0 || !s.regions[r].indoor) continue;
    const dry = 1 - wet[i];
    if (f > RESIDUAL.FIRE_MIN) e += f * dry;
    if (h > RESIDUAL.HEAT_MIN) e += RESIDUAL.HEAT_W * h * dry;
  }
  return e;
}

/** 노출 칸 — 없으면 만든다. 배관의 문턱(그 건물의 배관이 얼마나 약한가)은 만들 때 한 번: 흐름 hz:pipe:<건물> 의 첫 값 (fork 는 부모 흐름을 쓰지 않는다) */
export function expoOf(sim: Sim, placeId: number): PlaceExpo {
  const ex = sim.world.expo;
  let e = ex[placeId];
  if (!e) e = ex[placeId] = { shake: 0, shakeEv: -1, shakeInc: -1, pipe: false, pipeEv: -1, pipeThr: 0.2 + 0.6 * sim.rng.fork('hz:pipe:' + placeId).next(), wet: false, wetEv: -1, dark: -1 };
  return e;
}

// ───────────────────────── (b3-8 L3 (나)) 손상된 건물의 다음 현장 ─────────────────────────

/** 새는 밸브의 세기 — 가스 폭발 현장의 밸브(scenes/major.ts)와 같은 범위 */
export const EXPO_LEAK: [number, number] = [0.5, 0.64];

/**
 * 현장 생성기가 노출을 읽는 자리 — sceneManager.createScene 의 buildScene 바로 다음. 그 건물에 노출 칸이 없으면 아무것도 하지 않는다(만들지 않는다 — 노출이 없는 교대는 그대로다).
 * 법칙이 아니라 처음 상태다: 평소 추첨이든 법칙이든 그 건물의 모든 사건에 걸린다.
 *  · shake > 0 → s.wear = { dmg: shake, cause: 'shock', inc: 가장 크게 흔든 사건의 코드 } — X6 의 catOf 가 처음 구조 건전도를 1 − CAT.WEAR_INTEG × dmg 아래로 둔다
 *    (불이 나면 삐걱임·균열·임박이 그만큼 빨리 오고 X6 가 실제로 무너뜨린다. 지휘관은 그 조짐으로만 안다 — s.wear 는 진실 전용이라 판단부는 읽지 않는다)
 *  · pipe → 새는 밸브 소품 하나 (X6 의 가스 격자와 폭발은 밸브 소품만으로 돈다 — 불이 가스에 닿으면 X6 가 폭발시킨다).
 *    **s.rules 는 고치지 않는다** — 판단부가 생김새로 읽는 칸이고(경찰의 확성기 방법·교본 줄) injury.smokeCause 가 연기 피해를 유독 가스로 정하는 칸이다.
 *    그래서 옛 가스 규칙(hazards.tickGas)은 이 현장에서 돌지 않는다. 대원은 밸브를 본 뒤의 haz 믿음과 X6 의 가스 조짐으로만 안다. 난수는 새 흐름 expo:<사건>
 */
export function applyExpo(sim: Sim, s: Scene, I: Incident): void {
  const p = I.truth.placeId;
  if (p < 0) return;
  const ex = sim.world.expo[p];
  if (!ex) return;
  if (ex.shake > 0) s.wear = { dmg: ex.shake, soot: 0, cause: 'shock', inc: ex.shakeInc >= 0 ? sim.incidents[ex.shakeInc]?.code ?? '' : '', pre: 0 };
  // (b3-8c) 이미 새는 배관이 있는 현장(가스 누출 현장 — 그 건물의 끊긴 배관이 낸 누출 사건이 그렇다)에는 더 놓지 않는다: 그 배관이 그 손상이다 (밸브 둘이면 누출을 두 번 센다)
  if (ex.pipe && !s.props.some((q) => q.kind === 'valve' && (q.leakRate ?? 0) > 0)) leakValve(sim, s, I);
}

/** 대기 지점에서 걸어서 닿는 칸 (잔해·문 소품은 치우거나 열 수 있다고 보고, 밸브·차량 같은 고정 소품은 막힌 칸으로 본다 — scenes/major.ts 의 reachable 과 같은 규칙) */
function reachFrom(s: Scene): Uint8Array {
  const W = s.w, H = s.h, t = s.tiles, seen = new Uint8Array(W * H);
  const pass = (i: number): boolean => {
    const ti = t[i];
    if (ti !== T.FLOOR && ti !== T.DOOR && ti !== T.GROUND && ti !== T.ROAD && ti !== T.STAIR && ti !== T.TREE && ti !== T.TRAIL) return false;
    const q = s.propAt[i];
    return q < 0 || s.props[q].kind === 'door' || s.props[q].kind === 'debris';
  };
  const x0 = Math.round(s.staging.x), y0 = Math.round(s.staging.y);
  if (x0 < 0 || y0 < 0 || x0 >= W || y0 >= H) return seen;
  const st = [y0 * W + x0];
  seen[st[0]] = 1;
  while (st.length) {
    const c = st.pop()!, x = c % W, y = (c / W) | 0;
    if (x + 1 < W && !seen[c + 1] && pass(c + 1)) { seen[c + 1] = 1; st.push(c + 1); }
    if (x > 0 && !seen[c - 1] && pass(c - 1)) { seen[c - 1] = 1; st.push(c - 1); }
    if (y + 1 < H && !seen[c + W] && pass(c + W)) { seen[c + W] = 1; st.push(c + W); }
    if (y > 0 && !seen[c - W] && pass(c - W)) { seen[c - W] = 1; st.push(c - W); }
    const sl = s.stairTo[c];
    if (sl >= 0 && !seen[sl]) { seen[sl] = 1; st.push(sl); }
  }
  return seen;
}
/** 걸어서 닿지 못하는 바닥 칸 수 */
function cutFloors(s: Scene): number {
  const v = reachFrom(s);
  let n = 0;
  for (let i = 0; i < v.length; i++) if (s.tiles[i] === T.FLOOR && !v[i]) n++;
  return n;
}

/**
 * 끊긴 배관 — 새는 밸브 하나를 놓는다 (CLAUDE.md "소품은 길을 막는다"·"가구 자리에 소품을 놓을 때"):
 *  ① 실내 구획의 가구 자리 가운데 벽(위·아래)에 붙고, 곁에 걸어서 닿는 빈 바닥이 있고(옆에 서서 잠근다), 불·소품·계단이 없는 칸 — 가구는 이미 길을 막고 있었으므로 길이 끊기지 않는다
 *  ② 없으면 벽에 붙은 빈 바닥 가운데 막아도 어느 바닥도 끊기지 않는 칸 (16곳까지 본다)
 *  둘 다 없으면 놓지 않는다(그 현장의 생김새가 받지 못한다). 돌려주는 값 = 놓았는가
 */
function leakValve(sim: Sim, s: Scene, I: Incident): boolean {
  const rng = sim.rng.fork('expo:' + I.id), W = s.w, t = s.tiles, n = t.length;
  const seen = reachFrom(s);
  const stand = (i: number): boolean => {
    const x = i % W;
    return (x + 1 < W && t[i + 1] === T.FLOOR && s.propAt[i + 1] < 0 && seen[i + 1] === 1) || (x > 0 && t[i - 1] === T.FLOOR && s.propAt[i - 1] < 0 && seen[i - 1] === 1)
      || (i + W < n && t[i + W] === T.FLOOR && s.propAt[i + W] < 0 && seen[i + W] === 1) || (i >= W && t[i - W] === T.FLOOR && s.propAt[i - W] < 0 && seen[i - W] === 1);
  };
  const furn: number[] = [], bare: number[] = [];
  for (let i = 0; i < n; i++) {
    const r = s.region[i];
    if (r < 0 || !s.regions[r].indoor || s.propAt[i] >= 0 || s.fire[i] > 0 || s.stairTo[i] >= 0) continue;
    const wall = (i >= W && t[i - W] === T.WALL) || (i + W < n && t[i + W] === T.WALL);
    if (!wall || !stand(i)) continue;
    if (t[i] === T.FURN) furn.push(i); else if (t[i] === T.FLOOR && seen[i]) bare.push(i);
  }
  let at = furn.length ? rng.pick(furn) : -1;
  if (at < 0 && bare.length) {
    const base = cutFloors(s);
    for (const i of rng.shuffle(bare).slice(0, 16)) {
      t[i] = T.WALL;
      const ok = cutFloors(s) === base;
      t[i] = T.FLOOR;
      if (ok) { at = i; break; }
    }
  }
  if (at < 0) return false;
  if (t[at] === T.FURN) { t[at] = T.FLOOR; s.decor[at] = 0; }
  addProp(s, 'valve', at % W, (at / W) | 0, { blocking: true, leakRate: rng.range(EXPO_LEAK[0], EXPO_LEAK[1]) });
  return true;
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

// ───────────────────────── (b3-10 b — L5 liftStall) 정전이 닿은 순간 운행 중이던 승강기 ─────────────────────────

/**
 * 승강기에 사람이 타고 있을 기대값의 크기 (설계서 §3.7 L5 — 첫 값. 법칙 파일이 아니라 여기 둔다: 정전을 거는 규칙(rules/infra.ts)이 이 파일의 darkened 를 부른다 —
 * 규칙 파일이 법칙 파일을 import 하면 등록 차례가 import 차례에 묶인다. 시험이 RIDE 를 키워 쓴다):
 *   ΔH = RIDE × min(FLOOR_MAX, floors / FLOOR_DIV) × occ(종류, 시간대)
 *   occ = 주거(아파트·오피스텔) 1 (출근·퇴근 1.5 · 심야 0.4) · 사무용 1.5 (심야 0.1) · 호텔·그 밖 1
 *  어림: 도시 전체 정전 → 약 1.2건 · 한 동네 0.5건 · 국지(반경 90 — 4층 이상 1~3채) 0.02 안팎. 승강기 갇힘의 평소율은 교대당 0.25건
 *  FLOORS 승강기가 있다고 보는 층수 (4층 이상)
 */
export const LIFT = { RIDE: 0.006, FLOOR_DIV: 6, FLOOR_MAX: 3, FLOORS: 4 };
const RESIDENT: ReadonlySet<PlaceKind> = new Set<PlaceKind>(['apartment', 'officetel']);
/** 그 시각(하루의 초)에 그 종류의 건물 승강기가 붐비는 정도 */
export function liftOcc(kind: PlaceKind, clock: number): number {
  const h = ((clock / 3600) % 24 + 24) % 24;
  const night = h >= 23 || h < 5, rush = (h >= 7 && h < 9.5) || (h >= 17 && h < 19.5);
  if (RESIDENT.has(kind)) return night ? 0.4 : rush ? 1.5 : 1;
  if (kind === 'office') return night ? 0.1 : 1.5;
  return 1;
}
const LIFT_OF = new WeakMap<Place[], number[]>();
/**
 * 정전에 승강기가 멈출 수 있는 건물: FLOORS 층 이상이고 **승강기 갇힘 시나리오가 받는 종류**(scenarioOf('collapse', 'elevator').places) — 건물 id 순.
 * 시드와 무관한 도시의 생김새라 도시 열쇠의 캐시에 둔다
 */
export function liftPlaces(sim: Sim): readonly number[] {
  const places = sim.city.places;
  let out = LIFT_OF.get(places);
  if (out) return out;
  const kinds = scenarioOf('collapse', 'elevator')?.places ?? {};
  out = [];
  for (const q of places) if (!q.open && (q.floors ?? 1) >= LIFT.FLOORS && (kinds[q.kind] ?? 0) > 0) out.push(q.id);
  LIFT_OF.set(places, out);
  return out;
}
/** 그 건물의 승강기에 정전이 닿은 순간의 충격 크기 (대상이 아니면 0) */
export function liftDelta(sim: Sim, placeId: number): number {
  const q = sim.city.places[placeId];
  if (!q || q.open || (q.floors ?? 1) < LIFT.FLOORS) return 0;
  return LIFT.RIDE * Math.min(LIFT.FLOOR_MAX, q.floors / LIFT.FLOOR_DIV) * liftOcc(q.kind, sim.startTod + sim.t);
}
/**
 * 건물에 정전이 닿은 순간 — 정전을 거는 규칙들(rules/infra.ts 의 C4 · b3-12 의 잠긴 지하)이 그 순간 새로 꺼진 건물 목록과 그 정전의 몫(원인 기록 · 주인 사건 · 갈래)을 넘긴다.
 * 건물마다 L5 liftStall 의 칸에 충격을 더한다(hazard.hazardImpulse — 문턱은 hz:liftStall:<건물>: "누가 껐는가"와 무관하다).
 * 대상: liftPlaces 의 건물이고 쓸 수 있는 건물(전소·전체 붕괴가 아니다). ref = 그 건물의 동네(정전 구역 — 보고서의 "{동네} 정전")
 */
export function darkened(sim: Sim, placeIds: readonly number[], part: HzPart): void {
  const kinds = scenarioOf('collapse', 'elevator')?.places ?? {};
  for (const id of placeIds) {
    const q = sim.city.places[id];
    if (!q || (kinds[q.kind] ?? 0) <= 0 || placeState(sim, id)?.usable === false) continue;
    const dH = liftDelta(sim, id);
    if (!(dH > 0)) continue;
    hazardImpulse(sim, 'liftStall', id, dH, { rate: dH, ev: part.ev, inc: part.inc, what: part.what, ref: zoneOfPlace(sim, id) });
  }
}
