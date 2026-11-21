// 위험의 현실화 (설계서 X6): 위험 상태(Scene.cat — 진실)와 그것이 실제로 일으키는 일.
// 이 파일은 "세계"의 규칙이다 (hazards.ts·damage.ts 와 같은 자격: 진실을 읽고 바꾼다). 지휘관·대원의 판단부·관제는 이 파일을 부르지 않고
// s.cat 을 읽지 않는다 — 조짐(sign 사실)으로만 안다.
//
// ── 단계 1 (상태만) · 단계 2 (조짐) · 단계 3 (세계 — 구조) ──────────────────────────────────────────
// 단계 1: 구조 건전도·가스 격자·용기의 열·전소 비율을 Scene.cat 과 소품의 X6 칸(vessel·heatK·heatLoad)에 계산한다.
// 단계 2: 대원이 그 값을 **조짐**으로 알아챈다(perceiveSigns — agents.perceive 가 부른다): 고정 문턱으로 정한 단계를 감각 범위 안에서만 sign 사실로 배운다.
// 단계 3: 구조가 **실제로 무너진다** — 구획 붕괴(collapseRegion)·전체 붕괴(collapseBuilding)·전소 기록(burnout), blast 의 구조 충격(catOnBlast),
//   지도의 건물 상태(markPlace — Sim.placeMarks), 현장 전원이 듣는 소리, 인과 신호(world/consequence.signal). tickFire 의 예전 천장 붕괴는 지웠다.
// 아직 아무도 조짐으로 판단하지 않는다(지휘 규칙은 단계 5). 뒤 단계가 채울 자리는 catTick 의 번호 주석에 적었다:
//   단계 4  가스 폭발(explodeGas)·용기 폭발(ruptureVessel), 드럼통, 차량 누출의 불 점화, 도시가스 차단
// 난수: 한 번만 정하는 준비는 catinit:<현장 id>, 실행 중 판정은 cat:<현장 id> (damage.ts 의 dmg: 와 같은 방식). s.rng·a.rng·sim.rng 를 부르지 않는다.

import { edgeName, findRoute } from '../city';
import type { Sim } from '../engine';
import { emit, raiseProblem } from '../events';
import { TYPE_DEFS } from '../incidentTypes';
import type { Rng } from '../rng';
import { T } from '../types';
import type { CatState, Fact, FieldAgent, FxInfo, Incident, IncidentResult, PlaceMark, Prop, Region, Scene, SignBelief } from '../types';
import { dist, fmtSec, josa, pct } from '../util';
import { hasKit, kitLive, kitWorks } from '../crews';
import { signal } from '../world/consequence';
import { noteRoadCause } from '../traffic';      // (I1-b b3-5) 통제 기록을 교통의 장부에
import { learn, regionNameAt } from './agents';
import { mkFact } from './beliefs';
import { WRECKED } from './damage';
import { astar, doorAt, isIndoor, los, staticPass, tileOf } from './grid';
import { lastFx, noteBoom } from './fxlog';
import { blast, pushFx } from './hazards';
import { hurtCas, hurtHostile, hurtResponder } from './injury';
import { addProp } from './kit';
import { FOOT_FLOOR_EDGE, FOOT_IN, FOOT_SHELL, NO_STRUCT, SIGN_BASE, footprint, regionNbrs } from './ops';
import { RUIN_FURN, RUIN_TOTAL, RUIN_WALL, markRuin, recordFall } from './ruins';
import { preBurnt } from '../placeUse';      // (I2 단계 5) 이어받은 그을음의 처음부터 탄 칸 (잎 모듈)

/** 균형 상수 — 모두 시작값이다 (설계서 §2.9). 균형 단계(8)가 §8.4 의 순서로 맞춘다 */
export const CAT = {
  K_HEAT: 0.0025,                 // 불 세기 1 의 구획이 초당 잃는 건전도
  K_BURN: 0.78,                   // 탄 몫 1 당 상한 감소 (탄 골조는 다시 튼튼해지지 않는다). (단계 8) 1.0 → 0.78: 불로 인한 구획 붕괴를 기준선의 천장 일부 붕괴 건수 ±30% 로 — 82% 넘게 탄 구획만 임박(0.36 아래)이 된다
  K_CREEP: 0.00035,               // 보강 안 된 균열 하나가 초당 깎는 양
  K_HIT_CRUSH: 0.5, K_HIT_BLAST: 0.8,      // blast 충격 배율 (단계 3 의 catOnBlast)
  L1: 0.6, L2: 0.45, L3: 0.36,    // 구조 조짐 단계: 삐걱임 · 균열·처짐 · 임박
  FALL_BASE: 0.01, FALL_SLOPE: 0.5, FALL_GRACE: 4,      // 구획 붕괴 초당 확률 BASE + SLOPE × (L3 − integ), 임박 조짐 뒤 최소 초 (단계 3)
  TOTAL_SHARE: 0.45, TOTAL_BLDG: 0.30,     // 전체 붕괴 문턱 = 건물 조짐 3 의 문턱 (둘은 늘 같이 움직인다)
  TOTAL_GRACE: 6, TOTAL_BASE: 0.02, TOTAL_SLOPE: 0.6, TOTAL_NOW: 0.12,      // 건물 조짐 3 뒤 최소 초 · 초당 확률 BASE + SLOPE × (0.30 − 건전도) · 이 아래면 바로 (단계 3)
  BLDG_L2: 0.5, BLDG_L2_SHARE: 0.25,       // 건물 조짐 2
  SHORE: 0.1,                     // 균열 하나를 보강하면 그 구획이 되찾는 건전도 (탄 몫 상한은 넘지 않는다)
  NBR_FALL: 0.12,                 // 이웃 구획이 무너지면 옮겨 오는 하중 (단계 3)
  QUAKE: 0.08, QUAKE_COLLAPSE: 0.18,       // 지진 흔들림 한 번: 그 밖의 현장 · 붕괴 유형
  INIT_COLLAPSE: 0.75, INIT_SEV: 0.05, INIT_NBR: 0.85, INIT_QUAKE: 0.9,      // 처음 값: 붕괴 현장의 무너진 구획(0.75 − 0.05 × 심각도)·그 이웃, 지진 중의 다른 구획
  WEAR_INTEG: 0.5,               // (I1-b b3-8 · I2) 손상된 건물(s.wear.dmg)의 처음 건전도 상한 1 − WEAR_INTEG × dmg — 손상 0.3 이면 0.85. I2 의 persist 도 이 값을 읽는다
  GAS_SRC: 0.15, GAS_D: 0.12,     // 가스 원천 · 확산
  GAS_DOOR: 0.15, GAS_STAIR: 0.9, // 닫힌 문·계단 너머의 교환 배율
  GAS_SEEP: 0.004, GAS_VENT: 0.12, GAS_MAX: 3,      // 벽 틈으로 새는 몫 · 깨진 창과 열린 바깥문 곁의 환기 · 상한
  GASBLAST_INIT: 1.3,             // 가스 폭발 현장의 밸브 방에 처음부터 차 있는 가스 (단계 4 — 방치 시험으로 정했다: 0.6 이면 깨진 창의 환기로 구름이 끝내 생기지 않는다). (단계 8) 1.0 → 1.3: 깨진 창으로 금방 빠져 2차 폭발이 강제 20교대에 2건(10%)뿐이었다 — 목표 15~40%
  LEL: 1.0,                       // 폭발 하한
  CLOUD_MIN: 3,                   // 구름으로 치는 덩어리의 칸 수 (스파크의 나이를 재기 시작한다)
  SPARK_MAX: 0.012, SPARK_AGE: 90,         // 스파크 초당 상한 · 구름이 생긴 뒤 스파크가 다 커지기까지의 초 (단계 4)
  VESSEL_HEAT: { cylinder: 0.028, drum: 0.020, cng: 0.010, jet: 0.010 } as Record<string, number>,      // 용기 가열
  VESSEL_WET: 0.7, VESSEL_COOL: 0.05, VESSEL_IDLE: 0.012,      // 젖은 용기는 덜 달궈진다 · 물을 맞으면 식는다 · 불이 없으면 저절로 식는다
  VENT_AT: 0.55,                  // 안전밸브 소리(조짐 3)
  BURNOUT: 0.7, BURNOUT_MIN: 30,  // 전소 문턱 · 이보다 연료 칸이 적은 건물은 전소 판정을 하지 않는다
  // (단계 9, 선택) 분진 폭발 §4.5 — dust 가 거짓이면 분진 구획을 정하지 않는다(그러면 아무것도 일어나지 않는다)
  dust: false,
  DUST_P: 0.25, DUST_CAP: 0.9,    // 공장·창고·보관 창고·작업장 화재·붕괴의 분진 구획 확률 min(CAP, P × hazardMul) — catinit 흐름
  DUST_FALL: 0.5, DUST_HIT: 0.5, DUST_HIT_R: 4,      // 점화: 그 구획·이웃 구획이 무너짐 · 충격이 구획 가운데 4칸 안 (확률)
  DUST_FIRE: 0.04, DUST_FIRE_AT: 0.6, DUST_FIRE_SHARE: 0.15,      // 점화: 구획 칸의 15% 이상이 불 0.6 이상이면 초당 0.04
  DUST_DMG: 30,                   // 피해 (반경 3.2 + 0.15 √칸 수)
  // (단계 9, 선택) 플래시오버 §4.7 — flashover 가 거짓이면 계산하지 않는다(롤오버 조짐도 없다)
  flashover: false,
  FO_FIRE: 0.25, FO_SMOKE: 0.7, FO_WET: 0.08, FO_P: 0.05, FO_SET: 0.45,      // 방의 불 몫(불 0.3 이상) ≥ 0.25 · 연기 평균 ≥ 0.7 · 젖음 평균 < 0.08 → 초당 0.05 × fireSpreadMul → 연료 칸 불 0.45
  ROLL_L1: 0.08, ROLL_L1_SMOKE: 0.6, ROLL_L2: 0.15, ROLL_L2_SMOKE: 0.7,     // 롤오버 조짐 1·2: 불 몫 · 연기 평균
};
/** CatState.loss 의 원인 칸 (구획 × LOSS_N) */
export const LOSS_FIRE = 0, LOSS_BURN = 1, LOSS_CREEP = 2, LOSS_IMPACT = 3, LOSS_BLAST = 4, LOSS_QUAKE = 5, LOSS_N = 6;
/** 구조 규칙을 쓰지 않는 변형 (건물이 아니다). 용기·가스 규칙은 쓴다 */
export { NO_STRUCT } from './ops';      // (단계 5) 지휘 쪽(ops.structScene)도 같은 목록을 쓰므로 생김새 도움 함수(ops.ts)로 옮겼다

const RNGS = new WeakMap<Scene, Rng>();
/** 이 현장의 실행 중 판정용 난수 흐름 cat:<현장 id> (붕괴 판정·잔해 자리·사람의 결과·스파크 …). 다른 흐름과 섞이지 않고, 만들 때 부모(sim.rng)를 소비하지 않는다 */
export function catRng(sim: Sim, s: Scene): Rng {
  let r = RNGS.get(s);
  if (!r) { r = sim.rng.fork('cat:' + s.id); RNGS.set(s, r); }
  return r;
}

/** 열을 받으면 터지는 용기인가 — 종류를 돌려준다 (아니면 undefined). bus: true 는 비행기 동체 토막·열차 객차에도 붙어 있으므로 skin 으로 가린다 */
export function vesselKind(p: Prop): Prop['vessel'] {
  if (p.vessel) return p.vessel;
  if (p.kind === 'gas') return 'cylinder';
  if (p.kind === 'vehicle') {
    if (p.skin === 'fuselageMid') return 'jet';      // 날개 연료 탱크가 있는 가운데 동체만
    if (p.bus && !p.skin) return 'cng';              // 일반 교통사고의 버스만
  }
  return undefined;
}

/** 현장마다의 작업 기억 (CatState 밖 — 다시 계산할 수 있는 값뿐이다) */
interface CatWork {
  extDoor: Uint8Array;      // 바깥 칸과 맞닿은 문 칸 (1) — 처음 생김새
  kind: Uint8Array;         // 가스 확산의 칸 종류 (매초 새로 쓴다)
  cells: Int16Array;        // 건물 칸(foot ≥ 1)의 목록 — 가스 단계가 이 칸만 훑는다 (밸브가 없는 현장은 빈 배열)
  burnSeen: number;         // 전소 비율을 마지막으로 센 때의 s.burnedTiles (-1 = 아직)
  burnFrac: number;         // 그때의 비율
  structBurn: number;       // 구획별 탄 몫을 마지막으로 센 때의 s.burnedTiles (-1 = 아직)
  burnR: Float32Array;      // 구획별 탄 몫 (그때의 값 — 탄 칸 수가 그대로면 다시 세지 않는다)
  crackN: Int16Array; shoreN: Int16Array;      // 구획별: 살아 있는 균열 수 · 이번에 새로 보강된 균열 수
  propN: number;            // 아래 세 목록을 만든 때의 s.props 길이 — 소품이 늘면(잔해 …) 다시 훑는다
  vessels: Prop[]; cracks: Prop[]; valves: Prop[];      // 용기 · 균열(unstable) · 밸브 (매초 모든 소품을 훑지 않으려고 따로 둔다)
  leaks: Prop[];            // 연료가 새는 차량 (단계 4 — 곁의 불이 누출 연료에 불을 붙인다)
  dustFell: number;         // (단계 9) 분진 구획과 그 이웃 가운데 무너진 구획 수 (마지막으로 본 때) — 새 무너짐이 점화 ①
  dustHitT: number;         // (단계 9) 분진 점화 ②에서 이미 본 마지막 충격 시각
  rollLv: Int8Array;        // (단계 9) 방마다 롤오버 조짐의 진실 단계 0·1·2 (플래시오버 단계가 매초 쓰고 perceiveSigns 가 읽는다 — 켜지 않으면 늘 0)
  rollOn: boolean;          // rollLv 에 0 아닌 값이 있다 (불이 꺼지면 한 번 비운다)
}
/** 소품 목록이 늘었으면 용기·균열·밸브를 다시 고른다 (소품은 지워지지 않고 끝에 붙기만 한다) */
function syncProps(s: Scene, w: CatWork): void {
  const props = s.props;
  if (props.length === w.propN) return;
  w.vessels.length = 0; w.cracks.length = 0; w.valves.length = 0; w.leaks.length = 0;
  for (let k = 0; k < props.length; k++) {
    const p = props[k];
    if (p.vessel) w.vessels.push(p);
    else if (p.kind === 'unstable') w.cracks.push(p);
    else if (p.kind === 'valve') w.valves.push(p);
    if (p.kind === 'vehicle' && (p.leakRate ?? 0) > 0) w.leaks.push(p);
  }
  w.propN = props.length;
}
const WORK = new WeakMap<CatState, CatWork>();
const NONE = new WeakSet<Scene>();
/** (단계 6) 전체 붕괴의 사건 사실 (현장 전원이 들은 그것) — 늦게 닿은 대원이 잔해 더미를 보고 같은 사실을 배운다 */
const TOTAL_EV = new WeakMap<CatState, Fact>();

/**
 * 이 현장의 위험 상태. 대상이 아니면 null. 처음 부를 때 만든다 — 규칙·blast·perceive·debrief 어느 입구에서 처음 불려도 같은 결과여야 하므로
 * 여기서 쓰는 난수는 catinit:<현장 id> 흐름뿐이고(fork 는 부모를 소비하지 않는다), 뽑는 순서는 고정이다: 용기의 heatK 를 소품 순서대로 → (단계 4) 드럼통 → (단계 9) 분진.
 * 세계 규칙이 현장의 첫 틱에 부르므로 처음 생김새(foot·이웃 구획·damage0·연료 칸)가 들어간다.
 */
export function catOf(sim: Sim, s: Scene): CatState | null {
  const have = s.cat;
  if (have) return have;
  if (NONE.has(s)) return null;
  // 첫 검사는 현장 객체만 본다: 실내 구획도, 용기도, 밸브도, 연료가 새는 차량도 없으면 대상이 아니다 (매 틱 모든 현장에서 도는 길)
  const regs = s.regions, props = s.props;
  let target = false, indoor = false;
  for (let k = 0; k < regs.length; k++) if (regs[k].indoor) { target = indoor = true; break; }
  if (!target) for (let k = 0; k < props.length; k++) {
    const p = props[k];
    if (p.kind === 'valve' || (p.kind === 'vehicle' && (p.leakRate ?? 0) > 0) || vesselKind(p)) { target = true; break; }
  }
  if (!target) { NONE.add(s); return null; }
  const I = sim.incidents[s.incidentId] as Incident | undefined;
  if (!I || !I.truth) { NONE.add(s); return null; }      // 시험의 가짜 사건({ id: 0 })으로 만든 현장
  const n = s.w * s.h, R = regs.length;
  const foot = footprint(s), nbrs = regionNbrs(s);
  const init = sim.rng.fork('catinit:' + s.id);
  // 용기 판별과 열 배율 (소품 순서대로 — 순서가 곧 추첨 순서다)
  for (let k = 0; k < props.length; k++) {
    const p = props[k], v = vesselKind(p);
    if (!v) continue;
    p.vessel = v; p.heatK = init.range(0.8, 1.25); p.heatLoad = 0;
  }
  // 드럼통 놓기 (§4.4) — 여기, heatK 다음에 (드럼통의 열 배율은 놓을 때 뽑는다). (단계 9) 분진 구획 — 그다음에
  if (I.truth.type === 'fire') placeDrums(sim, s, I, init);
  const struct = indoor && !s.outdoor && NO_STRUCT.indexOf(s.variant) < 0;
  // 구조 건전도의 처음 값
  const integ = new Float32Array(R).fill(1);
  if (struct) {
    const quake = I.tag === 'disaster:quake';
    const hurt = new Uint8Array(R);
    if (s.kind === 'collapse') for (let r = 0; r < R; r++) {
      if (!regs[r].indoor) continue;
      const tl = regs[r].tiles;
      for (let q = 0; q < tl.length; q++) if (s.damage[tl[q]]) { hurt[r] = 1; break; }
    }
    for (let r = 0; r < R; r++) {
      if (!regs[r].indoor) continue;
      if (hurt[r]) { integ[r] = CAT.INIT_COLLAPSE - CAT.INIT_SEV * I.truth.severity; continue; }
      let by = false;
      for (let q = 0; q < nbrs[r].length; q++) if (hurt[nbrs[r][q]]) { by = true; break; }
      if (by) integ[r] = CAT.INIT_NBR; else if (quake) integ[r] = CAT.INIT_QUAKE;
    }
    // (I1-b b3-8 · I2 §7) 이미 손상된 건물(s.wear — 이웃의 충격·지난 교대): 실내 구획마다 처음 건전도가 1 − WEAR_INTEG × dmg 를 넘지 않는다 (난수 없음 — 손상이 없는 현장은 그대로)
    if (s.wear) for (let r = 0; r < R; r++) if (regs[r].indoor) integ[r] = Math.min(integ[r], 1 - CAT.WEAR_INTEG * s.wear.dmg);
  }
  // 전소 비율의 분모: 건물 칸 위의 연료 칸 (이미 탄 칸도 연료가 있던 칸이다). (I2 단계 5) 지난 교대의 그을음으로 처음부터 탄 칸(persist.applyPlaceWear)은 뺀다 —
  // 분모·분자(burnFracOf 는 이 칸 안의 탄 칸만 센다)에서 함께 빠져 이번 교대에 탄 몫만 센다. 이어받은 상태가 없으면 pre 가 없다 (결과 불변)
  const fuelMask = new Uint8Array(n);
  let fuel0 = 0;
  const pre = s.wear !== undefined && s.wear.pre > 0 ? preBurnt(s) : undefined;
  for (let i = 0; i < n; i++) if (foot[i] >= 1 && (s.fuel[i] > 0 || (s.burned[i] && !(pre !== undefined && pre[i])))) { fuelMask[i] = 1; fuel0++; }
  let valve = false;
  for (let k = 0; k < props.length; k++) if (props[k].kind === 'valve') { valve = true; break; }
  const shakes = sim.disaster ? sim.disaster.shakes : undefined;
  const c: CatState = {
    struct, foot, integ,
    loss: new Float32Array(R * LOSS_N), hotT: new Float32Array(R), l3Since: new Float32Array(R).fill(-1),
    damage0: s.damage.slice(), hits: [], gasN: 0, vesselN: 0, dustN: 0,
    fallen: new Uint8Array(R), bldg: 1, bldgL3Since: -1,
    gas: valve ? new Float32Array(n) : null, gasTmp: valve ? new Float32Array(n) : null, cloudSince: -1,
    fuelMask, fuel0, burntAt: -1, totalAt: -1, lastFall: null, events: 0,
    shakeSeen: shakes ? shakes.length : 0,
    shored: [], limitBonus: 0, dustRegion: -1, dustDone: false, flashed: [], utilityAt: -1,
    causeEv: new Int32Array(R).fill(-1),
  };
  c.bldg = bldgOf(c, s).bldg;
  // 가스 폭발 현장(collapse/gasblast)은 밸브가 있는 방이 처음부터 가스로 차 있다 (§2.5 끝 — 깨진 창의 환기 때문에 새는 가스만으로는 폭발 하한에 닿지 못한다). 결정적 — 난수 없음
  if (c.gas && s.kind === 'collapse' && s.variant === 'gasblast') {
    for (let k = 0; k < props.length; k++) {
      const p = props[k];
      if (p.kind !== 'valve' || p.mitigated || p.ignited) continue;
      const src = sourceTile(s, p), rr = src >= 0 ? s.region[src] : -1;
      if (rr < 0 || !regs[rr].indoor) continue;
      const tl = regs[rr].tiles;
      for (let q = 0; q < tl.length; q++) if (isIndoor(s.tiles[tl[q]]) && c.gas[tl[q]] < CAT.GASBLAST_INIT) c.gas[tl[q]] = CAT.GASBLAST_INIT;
    }
  }
  // 바깥 출입문: 바깥 칸(땅·도로·나무·산길)과 맞닿은 문 칸 — 가스의 환기 항이 쓴다
  const extDoor = new Uint8Array(n);
  if (valve) {
    const w = s.w, h = s.h, t = s.tiles;
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      if (t[i] !== T.DOOR) continue;
      if ((x + 1 < w && outside(t[i + 1])) || (x > 0 && outside(t[i - 1])) || (y + 1 < h && outside(t[i + w])) || (y > 0 && outside(t[i - w]))) extDoor[i] = 1;
    }
  }
  let cells = new Int16Array(0);
  if (valve) { const list: number[] = []; for (let i = 0; i < n; i++) if (foot[i] >= 1) list.push(i); cells = Int16Array.from(list); }
  WORK.set(c, {
    extDoor, kind: valve ? new Uint8Array(n) : extDoor, cells, burnSeen: -1, burnFrac: 0, structBurn: -1, burnR: new Float32Array(R), crackN: new Int16Array(R), shoreN: new Int16Array(R),
    propN: -1, vessels: [], cracks: [], valves: [], leaks: [], dustFell: 0, dustHitT: -1, rollLv: new Int8Array(R), rollOn: false,
  });
  // (단계 9, 선택) 분진 구획 (§4.5) — catinit 흐름에서 용기 열 배율 → 드럼통 다음 차례 (Rng.fork 는 부모를 소비하지 않으므로 앞의 추첨은 그대로다)
  if (CAT.dust) c.dustRegion = pickDust(sim, s, I, init);
  s.cat = c;
  return c;
}
const outside = (t: number): boolean => t === T.GROUND || t === T.ROAD || t === T.TREE || t === T.TRAIL;

/** 화학 드럼이 놓일 확률 (건물 종류별 — 심각도의 hazardMul 을 곱하고 0.95 에서 자른다) */
const DRUM_P: Record<string, number> = { chemical: 0.9, factory: 0.35, storage: 0.35, warehouse: 0.2, workshop: 0.2 };
/**
 * 공업 화재의 화학 드럼 1~3개 (§4.4): 발화실이 아닌 방(불이 없는 방)의 빈 바닥에, 가스 용기처럼 길을 막지 않게 놓는다.
 * 다른 소품·사람이 있는 칸, 문 칸, 곁에 빈 바닥이 하나도 없는 칸은 뺀다(CLAUDE.md "가구 자리에 소품을 놓을 때"). 난수는 catinit 흐름 — 현장 생성기의 흐름은 건드리지 않는다
 */
function placeDrums(sim: Sim, s: Scene, I: Incident, init: Rng): void {
  const p0 = DRUM_P[I.truth.placeKind ?? ''];
  if (!p0 || !init.chance(Math.min(0.95, p0 * sim.tune.hazardMul))) return;
  const n = init.int(1, 3);
  const rooms = s.regions.filter((r) => r.indoor && r.kind === 'room' && r.tiles.length && !r.tiles.some((i) => s.fire[i] > 0));
  if (!rooms.length) return;
  const W = s.w, N = W * s.h, taken = occupied(s), t = s.tiles;
  const free = (j: number): boolean => j >= 0 && j < N && t[j] === T.FLOOR && s.propAt[j] < 0 && !taken[j];
  for (let k = 0; k < n; k++) {
    const r = init.pick(rooms);
    const cands = r.tiles.filter((i) => free(i) && ((i % W + 1 < W && free(i + 1)) || (i % W > 0 && free(i - 1)) || free(i + W) || free(i - W)));
    if (!cands.length) continue;
    const i = init.pick(cands);
    const p = addProp(s, 'gas', i % W, (i / W) | 0, { vessel: 'drum', skin: 'drum' });
    p.heatK = init.range(0.8, 1.25); p.heatLoad = 0;
    taken[i] = 1;
  }
}

/** 분진이 쌓이는 건물 종류 (§4.5) */
const DUST_KIND = ['factory', 'warehouse', 'storage', 'workshop'];
/**
 * (단계 9, 선택) 분진 구획 (§4.5): 화재·붕괴 유형이고 공장·창고·보관 창고·작업장이면 min(0.9, 0.25 × hazardMul) 로 가장 큰 실내 구획 하나 (없으면 -1).
 * catinit 흐름 — 드럼통 다음 차례
 */
function pickDust(sim: Sim, s: Scene, I: Incident, init: Rng): number {
  if ((I.truth.type !== 'fire' && I.truth.type !== 'collapse') || DUST_KIND.indexOf(I.truth.placeKind ?? '') < 0) return -1;
  if (!init.chance(Math.min(CAT.DUST_CAP, CAT.DUST_P * sim.tune.hazardMul))) return -1;
  let best = -1, bn = 0;
  for (const r of s.regions) if (r.indoor && r.tiles.length > bn) { best = r.id; bn = r.tiles.length; }
  return best;
}

/** 건물 전체 건전도와 무너진 몫: 서 있는 실내 구획의 칸 수 가중 평균(무너진 구획은 0 으로 센다) · 무너진 구획의 칸 수 몫 */
export function bldgOf(c: CatState, s: Scene): { bldg: number; fallenShare: number } {
  const regs = s.regions;
  let all = 0, up = 0, down = 0;
  for (let r = 0; r < regs.length; r++) {
    if (!regs[r].indoor) continue;
    const m = regs[r].tiles.length;
    all += m;
    if (c.fallen[r]) down += m; else up += m * c.integ[r];
  }
  return all > 0 ? { bldg: up / all, fallenShare: down / all } : { bldg: 1, fallenShare: 0 };
}

/** 건물 조짐 단계(진실 쪽 값): 0 · 2(외벽 균열이 번짐) · 3(전체 붕괴 임박 — 전체 붕괴의 문턱과 같다). 건물이 아닌 현장은 0 */
export function bldgLevel(c: CatState, s: Scene): number {
  if (!c.struct) return 0;
  const b = bldgOf(c, s);
  if (b.bldg < CAT.TOTAL_BLDG || b.fallenShare >= CAT.TOTAL_SHARE) return 3;
  if (b.bldg < CAT.BLDG_L2 || b.fallenShare >= CAT.BLDG_L2_SHARE) return 2;
  return 0;
}

/** 건물 칸 위의 연료 칸 가운데 탄 칸의 몫 (전소 비율 — 0..1). 건물이 아니거나 연료 칸이 없으면 0 */
export function burnFracOf(c: CatState, s: Scene): number {
  if (!c.struct || c.fuel0 <= 0) return 0;
  const w = WORK.get(c)!;
  if (w.burnSeen !== s.burnedTiles) {
    let b = 0;
    const m = c.fuelMask, bu = s.burned;
    for (let i = 0; i < m.length; i++) if (m[i] && bu[i]) b++;
    w.burnFrac = b / c.fuel0; w.burnSeen = s.burnedTiles;
  }
  return w.burnFrac;
}

/** 소품이 놓인 구획 (그 칸이 어느 구역에도 들지 않으면 맞닿은 실내 구역). 없으면 -1 */
function regionOfProp(s: Scene, p: Prop): number {
  const w = s.w, i = p.y * w + p.x;
  const r = s.region[i];
  if (r >= 0) return r;
  if (p.x + 1 < w && s.region[i + 1] >= 0) return s.region[i + 1];
  if (p.x > 0 && s.region[i - 1] >= 0) return s.region[i - 1];
  if (p.y + 1 < s.h && s.region[i + w] >= 0) return s.region[i + w];
  if (p.y > 0 && s.region[i - w] >= 0) return s.region[i - w];
  return -1;
}

/**
 * 1초에 한 번 (tickFire·tickGas 와 같은 틱, 그 뒤). 순서를 바꾸면 결과가 바뀐다 (설계서 §2.3):
 *   1 지진 흔들림 → 2 도시가스 차단 → 3 가스 → 4 용기의 열 → 5 구조 → 6 전소 판정 → 7 일어나는 일 → 8 (선택) 플래시오버 → 9 지도 기록
 * 단계 1 에서는 1·3·4·5·6 을 **계산만** 한다 (2·7·8·9 는 뒤 단계).
 */
export function catTick(sim: Sim, s: Scene, I: Incident, c: CatState): void {
  const w = WORK.get(c)!;
  syncProps(s, w);
  // 1) 지진 흔들림 반영. 맨 앞에서 낡은 충격 자리를 버린다 (통째로 비우지 않는다 — 7단계의 붕괴가 다음 초의 점화 검사에 닿게)
  if (c.hits.length) c.hits = c.hits.filter((q) => q.t >= sim.t - 1.2);
  const shakes = sim.disaster ? sim.disaster.shakes : undefined;
  const nShake = shakes ? shakes.length : 0;
  if (nShake > c.shakeSeen) {
    if (c.struct) {
      const hit = (s.kind === 'collapse' ? CAT.QUAKE_COLLAPSE : CAT.QUAKE) * (nShake - c.shakeSeen);
      const regs = s.regions;
      for (let r = 0; r < regs.length; r++) {
        if (!regs[r].indoor || c.fallen[r]) continue;
        const v = c.integ[r], nv = v - hit < 0 ? 0 : v - hit;
        c.loss[r * LOSS_N + LOSS_QUAKE] += v - nv; c.integ[r] = nv;
        const dev = sim.disaster ? sim.disaster.lastEv : undefined;      // 원인 기록: 재난 기록(여진 알림)
        if (dev !== undefined && dev >= 0) c.causeEv[r] = dev;
      }
    }
    c.shakeSeen = nShake;
  }
  // 2) 도시가스 차단: s.ops.utilityAsked(지휘 상태 — 단계 5 가 요청한다) → c.utilityAt, 그 시각에 살아 있는 밸브를 모두 차단 + 차단 완료 사실
  if (w.valves.length && c.utilityAt !== -2) utilityStep(sim, s, I, c);
  // 3) 가스: 원천 → 확산 → 손실, 구름의 나이. 폭발 하한을 넘은 구름은 7) 에서 점화원을 본다
  const clouds = c.gas ? gasStep(sim, s, c, w) : null;
  // 4) 용기의 열, 그리고 곁의 불이 새는 연료에 불을 붙인다 (tickLeaks 가 발화를 처리한다)
  if (w.vessels.length) vesselStep(s, w);
  if (w.leaks.length) leakFire(s, w);
  if (c.struct) {
    // 5) 구조: 구획별 손실, 보강 반영, 건물 건전도, 조짐 단계용 값
    structStep(sim, s, I, c, w);
    // 6) 전소 판정: 건물 칸 위의 연료 칸이 70% 넘게 탔다 — BURNOUT 기록·건물 상태·신호 (§4.6)
    if (c.burntAt < 0 && c.fuel0 >= CAT.BURNOUT_MIN && s.burnedTiles > 0 && burnFracOf(c, s) >= CAT.BURNOUT) burnout(sim, s, I, c);
  }
  // 7) 일어나는 일: 가스 폭발 → 용기 폭발 → (단계 9, 선택: 분진 폭발) → 구획 붕괴 → 전체 붕괴. 순서를 지킨다 — 앞의 폭발이 뒤의 붕괴를 앞당긴다
  //    (폭발의 충격이 건전도를 0.05 아래로 떨어뜨린 구획은 조짐 없이 바로 무너진다). 여기서 생긴 붕괴는 c.hits 에 남아 다음 초의 가스 점화원이 된다
  let boom = '';
  if (clouds) for (let k = 0; k < clouds.length; k++) {
    const cl = clouds[k];
    if (c.gas![cl[0]] < CAT.LEL) continue;      // 앞의 폭발이 태워 버렸다 (구름 밖의 가스는 0.4배)
    const at = ignition(sim, s, c, cl, HOW);
    if (at < 0) continue;
    explodeGas(sim, s, I, c, cl, at, HOW[0]);
    boom = '가스 폭발';
  }
  for (let k = 0; k < w.vessels.length; k++) {
    const p = w.vessels[k];
    if (p.exploded || p.removed || (p.heatLoad ?? 0) < 1) continue;
    ruptureVessel(sim, s, I, c, p);
    boom = `${vesselName(p)} 폭발`;
  }
  // (단계 9, 선택) 분진 폭발 — 분진 구획이 있을 때만 (CAT.dust 가 거짓이면 catOf 가 정하지 않는다)
  if (c.dustRegion >= 0 && !c.dustDone && dustStep(sim, s, I, c, w)) boom = boom || '분진 폭발';
  if (c.struct && c.totalAt < 0) fallStep(sim, s, I, c, boom);
  // 8) (단계 9, 선택) 플래시오버 — 타는 칸이 있을 때만. 켜지 않으면 롤오버 조짐도 늘 0 이다
  if (CAT.flashover && s.burning > 0) flashStep(sim, s, I, c, w);
  else if (w.rollOn) { w.rollLv.fill(0); w.rollOn = false; }
  // 9) 지도 기록: Sim.placeMarks 의 탄 비율·잔해 비율 (건물 상태가 있는 현장만)
  if (c.struct && I.truth.placeId >= 0) {
    const pm = sim.placeMarks.get(I.truth.placeId);
    if (pm && pm.incidentId === I.id) { pm.burnFrac = burnFracOf(c, s); pm.ruinFrac = ruinFracOf(c, s); }
  }
}

/**
 * 무너짐의 판정 (§2.4): 구획 — 건전도 0.05 이하면 바로, 아니면 임박(0.36 아래)이 4초 넘게 이어진 구획이 초당 0.01 + 0.5 × (0.36 − 건전도).
 * 그다음 건물 전체 — 건물 조짐 3(건전도 0.30 아래 또는 무너진 몫 45% 이상)이 6초 넘게 이어지면 초당 0.02 + 0.6 × (0.30 − 건전도) (+0.1 무너진 몫 60% 이상),
 * 건전도 0.12 아래면 바로. 그래서 건물 조짐 3 은 언제나 끝내 무너진다. 구획이 무너지면 건물 값이 바뀌므로 다시 센다.
 */
function fallStep(sim: Sim, s: Scene, I: Incident, c: CatState, boom: string): void {
  const regs = s.regions, rng = catRng(sim, s);
  let fell = false;
  for (let r = 0; r < regs.length; r++) {
    const reg = regs[r];
    if (!reg.indoor || c.fallen[r] || !reg.tiles.length) continue;
    const v = c.integ[r];
    if (v <= 0.05 || (c.l3Since[r] >= 0 && sim.t - c.l3Since[r] >= CAT.FALL_GRACE && rng.chance(Math.min(1, CAT.FALL_BASE + CAT.FALL_SLOPE * (CAT.L3 - v))))) {
      collapseRegion(sim, s, I, c, r);
      fell = true;
    }
  }
  const b = bldgOf(c, s);
  if (fell) {
    c.bldg = b.bldg;
    if (b.bldg < CAT.TOTAL_BLDG || b.fallenShare >= CAT.TOTAL_SHARE) { if (c.bldgL3Since < 0) c.bldgL3Since = sim.t; } else c.bldgL3Since = -1;
  }
  if (c.bldgL3Since < 0) return;
  if (b.bldg < CAT.TOTAL_NOW) collapseBuilding(sim, s, I, c, boom || undefined);      // 바로 무너진다 — 같은 초에 폭발이 있었으면 그 충격이 원인이다
  else if (sim.t - c.bldgL3Since >= CAT.TOTAL_GRACE && rng.chance(CAT.TOTAL_BASE + CAT.TOTAL_SLOPE * Math.max(0, CAT.TOTAL_BLDG - b.bldg) + (b.fallenShare >= 0.6 ? 0.1 : 0))) collapseBuilding(sim, s, I, c);
}

/** 구조 건전도 한 초 (§2.4): 불의 열·보강 안 된 균열이 깎고, 탄 몫이 상한을 내리고, 보강이 조금 되돌린다 */
function structStep(sim: Sim, s: Scene, I: Incident, c: CatState, w: CatWork): void {
  const regs = s.regions, props = w.cracks, R = regs.length;
  const crackN = w.crackN, shoreN = w.shoreN;
  let cracks = 0, shored = 0;
  for (let k = 0; k < props.length; k++) {
    const p = props[k];
    const r = regionOfProp(s, p);
    if (p.mitigated) {
      if (c.shored.indexOf(p.id) >= 0) continue;
      c.shored.push(p.id);      // 한 번만 반영한다 (실행기를 고치지 않는다 — 보강이든 R2 의 지지대든 p.mitigated 로 끝난다)
      if (r >= 0) { if (!shored) shoreN.fill(0); shoreN[r]++; shored++; }
    } else if ((p.leakRate ?? 0) > 0 && r >= 0) { if (!cracks) crackN.fill(0); crackN[r]++; cracks++; }
  }
  // 칸을 훑는 것은 타는 칸이 있을 때(열·젖은 정도)와 탄 칸 수가 바뀌었을 때(탄 몫)뿐이다 — 대부분의 현장은 구획마다 몇 줄로 끝난다.
  // s.burning 은 같은 틱의 tickFire 가 방금 센 값이다 (규칙은 tickFire 뒤에 돈다). 건전도 자체는 매초 다시 읽으므로 밖에서 고친 값(충격·시험)도 바로 반영된다.
  const fireOn = s.burning > 0, recount = s.burnedTiles !== w.structBurn;
  w.structBurn = s.burnedTiles;
  const hz = 0.8 + 0.2 * sim.tune.hazardMul;
  const fire = s.fire, burned = s.burned, wet = s.wet, burnR = w.burnR;
  let all = 0, up = 0, down = 0;
  for (let r = 0; r < R; r++) {
    const reg = regs[r];
    if (!reg.indoor) continue;
    const tl = reg.tiles, m = tl.length;
    all += m;
    if (c.fallen[r]) { down += m; continue; }
    if (!m) continue;
    let hot = 0, hotN = 0, wetS = 0;
    if (fireOn) {
      let burn = 0;
      for (let q = 0; q < m; q++) {
        const i = tl[q], f = fire[i];
        if (f >= 0.3) { hot += f; hotN++; }
        burn += burned[i]; wetS += wet[i];
      }
      burnR[r] = burn / m;
    } else if (recount) {
      let burn = 0;
      for (let q = 0; q < m; q++) burn += burned[tl[q]];
      burnR[r] = burn / m;
    }
    const wetF = Math.min(1, (2 * wetS) / m);
    const lFire = CAT.K_HEAT * (hot / m) * (1 - 0.6 * wetF) * hz;
    const lCreep = cracks ? crackN[r] * CAT.K_CREEP * hz : 0;
    let v = c.integ[r] - lFire - lCreep;
    const o = r * LOSS_N;
    c.loss[o + LOSS_FIRE] += lFire; c.loss[o + LOSS_CREEP] += lCreep;
    const cap = 1 - CAT.K_BURN * burnR[r];
    if (v > cap) { c.loss[o + LOSS_BURN] += v - cap; v = cap; }
    if (shored && shoreN[r]) v = Math.min(cap, v + CAT.SHORE * shoreN[r]);
    if (v < 0) v = 0;
    c.integ[r] = v;
    if (hotN > 0 && hotN >= 0.3 * m) c.hotT[r] += 1;
    // 원인 기록: 불이 이 구획을 깎고 있으면 그 불이 번진 기록 (충격·폭발·여진의 기록은 단계 3 의 catOnBlast 가 적는다)
    if (lFire > 0) c.causeEv[r] = s.lastSpreadEvent >= 0 ? s.lastSpreadEvent : I.lastEvent >= 0 ? I.lastEvent : I.rootEvent;      // 아직 아무 기록도 없는 사건(신고 전)은 발생 기록
    if (v < CAT.L3) { if (c.l3Since[r] < 0) c.l3Since[r] = sim.t; } else c.l3Since[r] = -1;
    up += m * v;
  }
  c.bldg = all > 0 ? up / all : 1;
  const share = all > 0 ? down / all : 0;
  if (c.bldg < CAT.TOTAL_BLDG || share >= CAT.TOTAL_SHARE) { if (c.bldgL3Since < 0) c.bldgL3Since = sim.t; } else c.bldgL3Since = -1;
}

/** 용기의 열 한 초 (§2.6): 곁의 불이 달구고, 젖으면 덜 달궈지며 식는다. 터진 용기는 건너뛴다 */
function vesselStep(s: Scene, w: CatWork): void {
  const props = w.vessels, W = s.w, H = s.h, fire = s.fire, wet = s.wet;
  for (let k = 0; k < props.length; k++) {
    const p = props[k], v = p.vessel;
    if (!v || p.exploded) continue;
    let heat = p.heatLoad ?? 0;
    // near = 용기 칸(차량은 차체 칸)과 그 1.5칸 안의 불 최댓값 (용기 자기 칸은 × 1.25). wetN = 용기 칸과 4 이웃의 젖은 정도 평균
    const x0 = p.x, y0 = p.y, x1 = p.x + p.w - 1, y1 = p.y + p.h - 1;
    let near = 0, wetS = 0, wetM = 0;
    for (let y = Math.max(0, y0 - 2); y <= Math.min(H - 1, y1 + 2); y++) for (let x = Math.max(0, x0 - 2); x <= Math.min(W - 1, x1 + 2); x++) {
      const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0, dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
      const i = y * W + x;
      if (dx + dy <= 1) { wetS += wet[i]; wetM++; }
      if (dx * dx + dy * dy > 2.25) continue;
      const f = dx + dy === 0 ? fire[i] * 1.25 : fire[i];
      if (f > near) near = f;
    }
    const wetN = wetM ? wetS / wetM : 0;
    heat += (CAT.VESSEL_HEAT[v] ?? 0) * near * (1 - CAT.VESSEL_WET * wetN) * (p.heatK ?? 1);
    heat -= CAT.VESSEL_COOL * wetN;
    if (near < 0.1) heat -= CAT.VESSEL_IDLE;
    p.heatLoad = heat < 0 ? 0 : heat > 1 ? 1 : heat;
  }
}

/**
 * 차량 연료 누출과 불 (§2.6 끝): 새는 연료에 곁의 불이 붙는다 — 발화 전인 누출 차량의 차체 1.5칸 안 불 최댓값이 0.3 이상이면 누출 진행(leak)을 0.015 × 불만큼 더한다.
 * 발화(불·기록)는 tickLeaks 가 그대로 한다. 차량은 용기가 아니면 터지지 않는다 (휘발유 탱크는 압력 용기가 아니다)
 */
function leakFire(s: Scene, w: CatWork): void {
  const list = w.leaks;
  for (let k = 0; k < list.length; k++) {
    const p = list[k];
    if (p.mitigated || p.ignited || !p.leakRate) continue;
    const near = vesselNear(s, p);
    if (near >= 0.3) p.leak = (p.leak ?? 0) + 0.015 * near;
  }
}

/** 가스가 나오는 칸: 밸브 칸이 실내 칸이면 그 칸, 아니면 맞닿은 첫 실내 칸 (없으면 -1) */
function sourceTile(s: Scene, p: Prop): number {
  const w = s.w, i = p.y * w + p.x, t = s.tiles;
  if (isIndoor(t[i])) return i;
  if (p.x + 1 < w && isIndoor(t[i + 1])) return i + 1;
  if (p.x > 0 && isIndoor(t[i - 1])) return i - 1;
  if (p.y + 1 < s.h && isIndoor(t[i + w])) return i + w;
  if (p.y > 0 && isIndoor(t[i - w])) return i - w;
  return -1;
}

// 가스 확산의 칸 종류 (CatWork.kind): 0 = 가스가 없는 칸(벽·바깥·닫힌 바깥문), 1 = 가스 칸, 2 = 닫힌 안쪽 문(가스 칸이지만 0.15배로만 주고받는다),
// 3 = 깨진 창(가스는 없고 곁의 칸을 환기한다), 4 = 열린 바깥 출입문(가스 칸이고 자신과 곁의 칸을 환기한다)
const G_NONE = 0, G_OPEN = 1, G_SHUT = 2, G_BROKEN = 3, G_EXIT = 4;
const holdsGas = (k: number): boolean => k === G_OPEN || k === G_SHUT || k === G_EXIT;

/**
 * 가연성 가스 한 초 (§2.5): 연기 격자와 따로 굴린다 — 밀폐된 곳에서는 시간이 지날수록 쌓인다.
 * 가스는 실내 칸(바닥·문·가구·계단)에만 있고, 가스 칸끼리만 주고받는다(합이 보존된다). 벽 틈으로 조금 새고, 깨진 창·열린 바깥문 곁에서 빠진다.
 * 모든 칸이 0.001 아래이고 살아 있는 밸브가 없으면 건너뛴다.
 */
function gasStep(sim: Sim, s: Scene, c: CatState, w: CatWork): number[][] | null {
  const g = c.gas!, tmp = c.gasTmp!, props = w.valves;
  let live = false;
  for (let k = 0; k < props.length; k++) {
    const p = props[k];
    if (p.mitigated || p.ignited || !p.leakRate) continue;
    live = true;
    const i = sourceTile(s, p);
    if (i >= 0) g[i] += CAT.GAS_SRC * p.leakRate * (0.75 + 0.25 * sim.tune.hazardMul);
  }
  // 건물 칸(처음 생김새의 foot ≥ 1 — 실내 칸과 그 둘레의 벽·창)만 훑는다: 가스 칸과 깨진 창은 모두 그 안에 있고, 그 밖의 칸은 늘 "가스가 없는 칸"(0)이다
  const W = s.w, n = W * s.h, t = s.tiles, kind = w.kind, ext = w.extDoor, glass = s.glass, stairTo = s.stairTo, cells = w.cells, M = cells.length;
  if (!live) {
    let any = false;
    for (let q = 0; q < M; q++) if (g[cells[q]] >= 0.001) { any = true; break; }
    if (!any) { c.cloudSince = -1; return null; }      // 새는 밸브도 남은 가스도 없다
  }
  for (let q = 0; q < M; q++) {
    const i = cells[q], ti = t[i];
    if (ti === T.DOOR) {
      const d = doorAt(s, i), shut = !!d && !d.open;
      kind[i] = ext[i] ? (shut ? G_NONE : G_EXIT) : shut ? G_SHUT : G_OPEN;
    } else if (isIndoor(ti)) kind[i] = G_OPEN;
    else kind[i] = ti === T.WINDOW && glass[i] ? G_BROKEN : G_NONE;
  }
  // 확산: 가스 칸끼리만
  const D = CAT.GAS_D;
  for (let q = 0; q < M; q++) {
    const i = cells[q], ki = kind[i];
    if (!holdsGas(ki)) continue;
    const gi = g[i], x = i % W;
    let acc = 0;
    if (x + 1 < W) { const kj = kind[i + 1]; if (holdsGas(kj)) acc += (ki === G_SHUT || kj === G_SHUT ? CAT.GAS_DOOR : 1) * (g[i + 1] - gi); }
    if (x > 0) { const kj = kind[i - 1]; if (holdsGas(kj)) acc += (ki === G_SHUT || kj === G_SHUT ? CAT.GAS_DOOR : 1) * (g[i - 1] - gi); }
    if (i + W < n) { const kj = kind[i + W]; if (holdsGas(kj)) acc += (ki === G_SHUT || kj === G_SHUT ? CAT.GAS_DOOR : 1) * (g[i + W] - gi); }
    if (i >= W) { const kj = kind[i - W]; if (holdsGas(kj)) acc += (ki === G_SHUT || kj === G_SHUT ? CAT.GAS_DOOR : 1) * (g[i - W] - gi); }
    const st = stairTo[i];
    if (st >= 0 && holdsGas(kind[st])) acc += CAT.GAS_STAIR * (g[st] - gi);      // 계단을 타고 다른 층으로
    tmp[i] = gi + D * acc;
  }
  // 손실과 환기, 상한
  let peak = 0;
  const fan = s.fan && sim.t < s.fan.until ? s.fan : null;      // (R2 §4.8·§10) 돌고 있는 송풍기 — 그 출입구 3칸 안의 가스 칸 × (1 − 0.3 × power)
  for (let q = 0; q < M; q++) {
    const i = cells[q], ki = kind[i];
    if (!holdsGas(ki)) { g[i] = 0; continue; }
    const x = i % W;
    let v = tmp[i] * (1 - CAT.GAS_SEEP);
    let vent = ki === G_EXIT;
    if (!vent && x + 1 < W) { const kj = kind[i + 1]; vent = kj === G_BROKEN || kj === G_EXIT; }
    if (!vent && x > 0) { const kj = kind[i - 1]; vent = kj === G_BROKEN || kj === G_EXIT; }
    if (!vent && i + W < n) { const kj = kind[i + W]; vent = kj === G_BROKEN || kj === G_EXIT; }
    if (!vent && i >= W) { const kj = kind[i - W]; vent = kj === G_BROKEN || kj === G_EXIT; }
    if (vent) v *= 1 - CAT.GAS_VENT;
    if (fan !== null) { const fx = x - fan.x, fy = ((i / W) | 0) - fan.y; if (fx * fx + fy * fy <= 9) v *= 1 - 0.3 * fan.power; }
    if (v > CAT.GAS_MAX) v = CAT.GAS_MAX; else if (v < 1e-5) v = 0;
    g[i] = v;
    if (v > peak) peak = v;
  }
  // 구름의 나이: 폭발 하한을 넘은 칸이 CLOUD_MIN 개 이상 이어져 있는 동안. 구름들(큰 것부터)을 돌려준다 — catTick 7) 이 점화원을 본다
  const big = peak >= CAT.LEL ? gasClouds(c, s) : null;
  if (big && big.length && big[0].length >= CAT.CLOUD_MIN) { if (c.cloudSince < 0) c.cloudSince = sim.t; } else c.cloudSince = -1;
  return big && big.length ? big : null;
}

/** 폭발 하한을 넘은 칸이 4 이웃으로 이어진 덩어리들 (큰 것부터, 같으면 앞 칸이 먼저인 것부터). 가스가 없는 현장은 빈 배열 */
export function gasClouds(c: CatState, s: Scene): number[][] {
  const g = c.gas;
  if (!g) return [];
  const W = s.w, H = s.h, n = W * H, lel = CAT.LEL;
  const seen = new Uint8Array(n), out: number[][] = [];
  for (let i0 = 0; i0 < n; i0++) {
    if (seen[i0] || g[i0] < lel) continue;
    const comp: number[] = [i0];
    seen[i0] = 1;
    for (let q = 0; q < comp.length; q++) {
      const i = comp[q], x = i % W, y = (i / W) | 0;
      if (x + 1 < W && !seen[i + 1] && g[i + 1] >= lel) { seen[i + 1] = 1; comp.push(i + 1); }
      if (x > 0 && !seen[i - 1] && g[i - 1] >= lel) { seen[i - 1] = 1; comp.push(i - 1); }
      if (y + 1 < H && !seen[i + W] && g[i + W] >= lel) { seen[i + W] = 1; comp.push(i + W); }
      if (y > 0 && !seen[i - W] && g[i - W] >= lel) { seen[i - W] = 1; comp.push(i - W); }
    }
    out.push(comp);
  }
  out.sort((a, b) => b.length - a.length || a[0] - b[0]);
  return out;
}

// ───────────────────────── 일어나는 일 — 구조 (단계 3 — 설계서 §4.1·§4.2·§4.6·§7.1) ─────────────────────────
// 상태를 바꾸는 그 자리에서 기록한다. 사람에게 피해를 주는 함수는 기록을 먼저 남겨 ev 를 얻고, 그 뒤 모든 hurt* 에 { ev } 를 넘긴다 (H1 의 a.hurtEv·c.causeEvent 가 그 기록이 된다).
// 난수는 cat:<현장 id> 흐름(catRng)만 쓴다. 구획 붕괴에서 뽑는 순서: 벽(칸 순서) → 잔해(칸 순서) → 구조 대상(id 순서) → 대원(목록 순서) → 경계의 구조 대상 → 경계의 대원 → 용의자.

const D8X = [1, -1, 0, 0, 1, 1, -1, -1], D8Y = [0, 0, 1, -1, 1, -1, 1, -1];
const isWallT = (t: number): boolean => t === T.WALL || t === T.WINDOW;

/** 원인 칸의 문구 (§4.1). 불: 그 구획이 불에 휩싸였던 시간, 탄 몫: 그때의 비율 */
function lossText(c: CatState, w: CatWork | undefined, r: number, slot: number): string {
  if (slot === LOSS_FIRE) return c.hotT[r] >= 1 ? `불에 ${fmtSec(c.hotT[r])} 동안 달궈짐` : '불길에 달궈짐';
  if (slot === LOSS_BURN) return `골조가 타서 약해짐(탄 몫 ${pct(w ? w.burnR[r] : 0)})`;
  if (slot === LOSS_CREEP) return '보강하지 않은 균열';
  if (slot === LOSS_IMPACT) return '잔해·낙하물의 충격';
  if (slot === LOSS_BLAST) return '폭발 충격';
  return '여진';
}
/** 구획 장부(loss)의 가장 큰 칸 (같으면 앞 칸) */
function topLoss(c: CatState, r: number): number {
  const o = r * LOSS_N;
  let best = 0;
  for (let k = 1; k < LOSS_N; k++) if (c.loss[o + k] > c.loss[o + best]) best = k;
  return best;
}

/**
 * blast 가 끝에 부른다 (설계서 §2.4 의 "한 번에 깎이는 것"·§2.5 의 점화 2): 가운데가 radius + 2 안인 서 있는 실내 구획마다
 * K_HIT × dmg/100 × (1 − d/(radius+2)) 를 깎고(무너져 내린 것 crush 는 0.5, 폭발은 0.8), 가스 점화를 위해 충격 자리를 남긴다.
 * 위험 상태가 없는 현장(시험의 가짜 사건 포함)과 닫힌 사건에서는 아무것도 하지 않는다.
 */
export function catOnBlast(sim: Sim, s: Scene, I: Incident, x: number, y: number, radius: number, dmg: number, ev: number, cause: string): void {
  if (I.phase === 'closed') return;
  const c = s.cat ?? catOf(sim, s);
  if (!c) return;
  c.hits.push({ t: sim.t, x, y });
  if (!c.struct) return;
  const crush = cause === 'crush', k = crush ? CAT.K_HIT_CRUSH : CAT.K_HIT_BLAST, slot = crush ? LOSS_IMPACT : LOSS_BLAST, R = radius + 2;
  const regs = s.regions;
  for (let r = 0; r < regs.length; r++) {
    const reg = regs[r];
    if (!reg.indoor || c.fallen[r]) continue;
    const d = dist(x, y, reg.cx, reg.cy);
    if (d >= R) continue;
    const v = c.integ[r], nv = Math.max(0, v - k * (dmg / 100) * (1 - d / R));
    c.loss[r * LOSS_N + slot] += v - nv; c.integ[r] = nv;
    if (ev >= 0) c.causeEv[r] = ev;
  }
}

/** 건물 상태를 지도에 남긴다 (실제 건물 현장만 — §7.1). 더 무거운 상태가 이미 있으면 그대로 둔다 */
const MARK_RANK: Record<PlaceMark['state'], number> = { scorched: 0, blasted: 1, partial: 2, burnt: 3, collapsed: 4 };
export function markPlace(sim: Sim, s: Scene, I: Incident, c: CatState, state: PlaceMark['state']): void {
  if (!c.struct || I.truth.placeId < 0) return;
  const id = I.truth.placeId, cur = sim.placeMarks.get(id);
  if (cur && MARK_RANK[cur.state] >= MARK_RANK[state]) return;
  sim.placeMarks.set(id, { placeId: id, state, t: sim.t, incidentId: I.id, burnFrac: burnFracOf(c, s), ruinFrac: ruinFracOf(c, s) });
}
/** 사건 중에 무너진 칸의 몫: damage 칸 가운데 처음(damage0)에는 없던 칸 / 건물 칸(층 경계 제외) */
export function ruinFracOf(c: CatState, s: Scene): number {
  const f = c.foot, d = s.damage, d0 = c.damage0;
  let all = 0, ruin = 0;
  for (let i = 0; i < f.length; i++) {
    if (f[i] === 0 || f[i] === FOOT_FLOOR_EDGE) continue;
    all++;
    if (d[i] && !d0[i]) ruin++;
  }
  return all ? ruin / all : 0;
}

/** 현장 어디서나 들리는 일 (§3.5): 그 일을 일으킨 함수가 상태를 바꾼 직후 현장 전원에게. 음영 구역의 대원은 듣지 못한다 (deliverRadio). 무전 문구는 없다 — 기록이 이미 알렸다 */
function hearAll(sim: Sim, s: Scene, ev: number, facts: Fact[]): void {
  s.radio.push({ id: s.nextMsgId++, t: sim.t, deliverAt: sim.t + 0.6, from: -1, to: -1, kind: 'report', facts, workId: -1, text: '', eventId: ev });
}
const signFact = (sim: Sim, id: number, v: SignBelief, text: string): Fact => mkFact('sign', id, v, '현장', sim.t, 1, true, text);

/** 사람이 선 칸 (대원·구조 대상·용의자)과 막지 않는 소품이 놓인 칸 — 잔해를 놓지 않는다 */
function occupied(s: Scene): Uint8Array {
  const n = s.w * s.h, o = new Uint8Array(n);
  for (const a of s.agents) if (a.status !== 'left') o[tileOf(s, a.x, a.y)] = 1;
  for (const c of s.casualties) if (c.where === 'scene' || c.where === 'carried') o[tileOf(s, c.x, c.y)] = 1;
  for (const h of s.hostiles) if (h.state !== 'escaped' && (h.where === undefined || h.where === 'scene')) o[tileOf(s, h.x, h.y)] = 1;
  for (const p of s.props) {
    if (p.removed || p.blocking) continue;
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (x >= 0 && y >= 0 && x < s.w && y < s.h) o[y * s.w + x] = 1;
  }
  return o;
}
/** 지형이 바뀌었다: 모든 대원과 스스로 대피 중인 구조 대상이 길을 다시 짠다 (해일 규칙의 선례) */
function replanAll(s: Scene): void {
  for (const a of s.agents) a.path = null;
  for (const q of s.casualties) if (q.walking) q.path = null;
}

/**
 * 구획 붕괴 (§4.1): 천장·바닥이 무너진다. 가구는 부서져 바닥이 되고(N7 규약), 안쪽 벽의 35% 가 무너지고, 빈 바닥의 25% 에 잔해가 쌓인다.
 * 안의 사람은 숨지거나 갇히거나 다치고(대원은 35% 깔린다 — 쓰러짐은 agentHealth 가 한다), 경계 1칸 안의 사람도 다치고 갇힌다.
 * 이웃 구획에 하중이 옮겨 가고(−0.12), 무너지는 순간의 소리를 현장 전원이 듣는다. 돌려주는 값은 기록 id.
 */
export function collapseRegion(sim: Sim, s: Scene, I: Incident, c: CatState, r: number, why?: string): number {
  const reg = s.regions[r], rng = catRng(sim, s), w = WORK.get(c), W = s.w, H = s.h, n = W * H;
  const top = topLoss(c, r);
  const fireCause = top === LOSS_FIRE || top === LOSS_BURN;
  // 기록 (먼저 — 아래 모든 hurt* 가 이 ev 를 받는다)
  const ev = raiseProblem(sim, I, 'STRUCT_COLLAPSE', `${reg.name} 천장·바닥 붕괴 — ${why ?? lossText(c, w, r, top)}`,
    { role: 'SYSTEM', actor: '현장', imp: 3, truth: s.arrivedAt < 0, causes: [c.causeEv[r]], text: `굉음! ${reg.name}의 천장과 바닥이 무너져 내렸습니다.` }, false);
  // 구획 안·경계 1칸 (사람의 자리는 바뀌기 전의 구획으로 본다)
  const inR = new Uint8Array(n), band = new Uint8Array(n);
  const tl0 = reg.tiles.slice();
  for (let q = 0; q < tl0.length; q++) inR[tl0[q]] = 1;
  for (let q = 0; q < tl0.length; q++) {
    const i = tl0[q], x = i % W, y = (i / W) | 0;
    for (let d = 0; d < 8; d++) { const xx = x + D8X[d], yy = y + D8Y[d]; if (xx >= 0 && yy >= 0 && xx < W && yy < H && !inR[yy * W + xx]) band[yy * W + xx] = 1; }
  }
  // 구획 칸: 가구는 부서진 바닥(N7 규약 — decor 는 남긴다), 연료 상한, 무너진 자리, 덮여 숨이 죽는 불, 먼지
  const t = s.tiles;
  for (let q = 0; q < tl0.length; q++) {
    const i = tl0[q];
    if (t[i] === T.FURN) { t[i] = T.FLOOR; s.decorHp[i] = WRECKED; markRuin(s, i, RUIN_FURN + s.decor[i]); }
    if (s.fuel[i] > 0.5) s.fuel[i] = 0.5;
    s.damage[i] = 1; s.fire[i] *= 0.6;
    if (s.smoke[i] < 0.7) s.smoke[i] = 0.7;
  }
  // 안쪽 벽: 구획 칸과 4 이웃인 벽 가운데 바깥벽·층 경계가 아닌 것의 35% (칸 순서로 뽑는다). 새 바닥은 이 구획의 잔해 바닥이 된다
  const walls: number[] = [];
  for (let q = 0; q < tl0.length; q++) {
    const i = tl0[q], x = i % W;
    if (x + 1 < W && t[i + 1] === T.WALL && c.foot[i + 1] === FOOT_IN) walls.push(i + 1);
    if (x > 0 && t[i - 1] === T.WALL && c.foot[i - 1] === FOOT_IN) walls.push(i - 1);
    if (i + W < n && t[i + W] === T.WALL && c.foot[i + W] === FOOT_IN) walls.push(i + W);
    if (i >= W && t[i - W] === T.WALL && c.foot[i - W] === FOOT_IN) walls.push(i - W);
  }
  walls.sort((a, b) => a - b);
  let fell = tl0.length;
  for (let q = 0; q < walls.length; q++) {
    const i = walls[q];
    if (q > 0 && walls[q - 1] === i) continue;
    if (!rng.chance(0.35)) continue;
    t[i] = T.FLOOR; s.damage[i] = 1; markRuin(s, i, RUIN_WALL);
    if (s.region[i] >= 0 && s.region[i] !== r) { const o = s.regions[s.region[i]].tiles, k = o.indexOf(i); if (k >= 0) o.splice(k, 1); }
    if (s.region[i] !== r) { s.region[i] = r; reg.tiles.push(i); }
    fell++;
  }
  // 잔해: 구획의 빈 바닥(사람·막지 않는 소품이 없고 문이 아닌 칸)의 25%
  const occ = occupied(s);
  for (let q = 0; q < reg.tiles.length; q++) {
    const i = reg.tiles[q];
    if (t[i] !== T.FLOOR || s.propAt[i] >= 0 || occ[i]) continue;
    if (rng.chance(0.25)) addProp(s, 'debris', i % W, (i / W) | 0, { blocking: true, hp: rng.range(9, 15) });
  }
  // 구조 대상
  for (const q of s.casualties) {
    if (q.dead || q.health <= 0) continue;
    if (q.where === 'carried') {
      const by = s.agents.find((a) => a.carrying === q.id);
      if (by && inR[tileOf(s, by.x, by.y)]) hurtCas(sim, s, I, q, rng.range(8, 20), 'crush', { ev });
      continue;
    }
    if (q.where !== 'scene' || q.inWater || !inR[tileOf(s, q.x, q.y)]) continue;
    const u = rng.next();
    if (u < 0.12) hurtCas(sim, s, I, q, q.health + 5, 'crush', { ev });
    else if (u < 0.67) { q.mob = 'trapped'; q.trapWork = Math.max(q.trapWork, rng.range(12, 22)); q.walking = false; q.path = null; hurtCas(sim, s, I, q, rng.range(12, 30), 'crush', { ev }); }
    else { q.path = null; hurtCas(sim, s, I, q, rng.range(15, 35), 'crush', { ev, immobile: true }); }
  }
  // 대원: 다치고 35% 는 깔린다 (상태 전이는 agentHealth 가 한다 — §4.8)
  for (const a of s.agents) {
    if (a.status === 'left' || sim.responders[a.rid].dead || !inR[tileOf(s, a.x, a.y)]) continue;
    hurtResponder(sim, s, I, a, rng.range(30, 60), 'crush', { ev });
    if (rng.chance(0.35)) { a.trapped = rng.range(6, 12); a.trapEv = ev; }
  }
  // 경계 1칸 안: 구조 대상은 다치고 (업혀 있지 않고 물속이 아니면) 갇힌다. 대원은 다치기만 한다
  for (const q of s.casualties) {
    if (q.dead || q.health <= 0) continue;
    const at = q.where === 'carried' ? s.agents.find((a) => a.carrying === q.id) : q.where === 'scene' ? q : undefined;
    if (!at || !band[tileOf(s, at.x, at.y)]) continue;
    hurtCas(sim, s, I, q, rng.range(5, 12), 'crush', { ev });
    if (q.where === 'scene' && !q.inWater) { q.mob = 'trapped'; q.trapWork = Math.max(q.trapWork, rng.range(6, 10)); q.walking = false; q.path = null; }
  }
  for (const a of s.agents) {
    if (a.status === 'left' || sim.responders[a.rid].dead || !band[tileOf(s, a.x, a.y)]) continue;
    hurtResponder(sim, s, I, a, rng.range(8, 18), 'crush', { ev });
  }
  for (const h of s.hostiles) {
    if (h.dead || h.state === 'escaped' || (h.where !== undefined && h.where !== 'scene') || !inR[tileOf(s, h.x, h.y)]) continue;
    hurtHostile(sim, s, I, h, rng.range(25, 55), 'crush', { ev });
  }
  // 상태: 무너짐, 이웃 구획에 옮겨 오는 하중, 충격 자리(가스 점화), 한계 시간 보탬, 길 다시 짜기
  c.fallen[r] = 1; c.l3Since[r] = -1;
  const nb = regionNbrs(s)[r];
  for (let k = 0; k < nb.length; k++) {
    const m = nb[k];
    if (c.fallen[m]) continue;
    const v = c.integ[m], nv = Math.max(0, v - CAT.NBR_FALL);
    c.loss[m * LOSS_N + LOSS_IMPACT] += v - nv; c.integ[m] = nv; c.causeEv[m] = ev;
  }
  c.lastFall = { t: sim.t, x: reg.cx, y: reg.cy, region: r };
  c.hits.push({ t: sim.t, x: reg.cx, y: reg.cy });
  c.limitBonus += 60;
  replanAll(s);
  s.staticVersion++;
  recordFall(sim, s, reg.cx, reg.cy, Math.max(reg.x1 - reg.x0 + 1, reg.y1 - reg.y0 + 1) / 2, fireCause ? 'ceiling' : 'partial');      // (G4) 불로 무너진 천장은 G4 의 'ceiling' 그림을 이어받는다 (§7.5)
  // 현장 전원이 듣는다: 무너짐 + 그 구획의 구조 조짐은 이제 없다(down — 무너진 구획의 "임박" 믿음이 남지 않게)
  hearAll(sim, s, ev, [
    signFact(sim, SIGN_BASE.event + c.events++, { kind: 'event', level: 3, region: r, x: reg.cx, y: reg.cy, what: 'partial' }, `굉음! ${reg.name} 무너짐`),
    signFact(sim, SIGN_BASE.struct + r, { kind: 'struct', level: 0, region: r, x: reg.cx, y: reg.cy, down: true }, fallenText(reg.name)),
  ]);
  markPlace(sim, s, I, c, 'partial');
  let inTiles = 0; for (const rg of s.regions) if (rg.indoor) inTiles += rg.tiles.length;
  signal(sim, 'catastrophe', { inc: I.id, ev, cx: reg.cx, cy: reg.cy, size: fell, place: I.truth.placeId, data: 1, mag: Math.min(0.99, fell / Math.max(1, inTiles)) });      // (I1-b b3-8) mag = 이번에 무너진 몫(< 1) — 기록·측정용. 충격 규칙(shockSpread)은 mag ≥ 1(건물 전체)만 받는다
  return ev;
}
const fallenText = (name: string): string => `${name} 무너져 내림 — 더 무너질 것 없음`;

/** 건물 가운데 바닥 칸: 실내 구획 가운데들의 평균에 가장 가까운, 지나갈 수 있는 실내 칸 */
function centerFloor(s: Scene): number {
  const [bx, by] = bldgCenter(s);
  const W = s.w;
  let best = -1, bd = 1e9;
  for (let i = 0; i < s.tiles.length; i++) {
    if (!isIndoor(s.tiles[i]) || s.tiles[i] === T.FURN) continue;
    const d = dist(i % W, (i / W) | 0, bx, by);
    if (d < bd) { bd = d; best = i; }
  }
  return best;
}
/** 잔해가 덮은 길 (§4.2): 사건 동안만 통제한다 — closeIncident 가 연다. 큰 차 기준 우회로가 있는 구간만 (CLAUDE.md 교통 함정) */
function blockRoad(sim: Sim, I: Incident): void {
  if (I.blockedEdge >= 0) return;
  const node = sim.city.nodes[I.truth.nodeId];
  if (!node) return;
  // (I1-b b3-8) 그 건물이 면한 길(Place.edgeId)을 먼저 본다 — 사건 교차로의 구간 순서대로만 보면 면하지 않은 구간이 막히고, 사건 뒤의 잔해(C2)도 그 구간에 남는다
  const face = I.truth.placeId >= 0 ? sim.city.places[I.truth.placeId]?.edgeId ?? -1 : -1;
  const order = face >= 0 && sim.city.edges[face] ? [face, ...node.edges.filter((k) => k !== face)] : node.edges;
  for (const k of order) {
    const e = sim.city.edges[k];
    if (e.closed || !findRoute(sim.city, e.a, e.b, 1, e.id, true)) continue;
    e.slow += 1.4; e.closed = true; e.closedReason = 'incident';      // known 은 건드리지 않는다
    I.blockedEdge = e.id;
    I.blockEv = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '교통정보', kind: 'traffic', imp: 1, text: `건물 붕괴 잔해로 ${edgeName(sim.city, e)} 통제` });      // (I1-b) 통제 기록 — 그 구간 앞의 ROUTE_BLOCKED 가 원인으로 가리킨다
    noteRoadCause(sim, e.id, 'close', I.blockEv, I.id);      // (I1-b b3-5) 교통의 장부: 닫힘의 주인
    return;
  }
}

/**
 * 건물 전체 붕괴 (§4.2): 안쪽 벽 전부와 바깥벽의 55% 가 무너지고(출입구는 반드시 열린다), 층 경계 벽·계단은 남는다.
 * 건물 칸은 하나의 잔해 바닥이 되고, 잔해는 성기게(심각도 3 에서 약 19%) — 출입구에서 가운데로 가는 길은 비워 둔다. 바깥벽 곁으로 잔해가 쏟아진다.
 * blastWhy = 폭발로 바로 무너졌을 때 그 폭발의 이름 (원인 문구 '${이름}의 충격', 숨질 확률 40%). 돌려주는 값은 기록 id.
 * 뽑는 순서: 벽(칸 순서) → 잔해(칸 순서) → 쏟아짐(칸 순서) → 구조 대상(id 순서) → 대원(목록 순서) → 용의자.
 */
export function collapseBuilding(sim: Sim, s: Scene, I: Incident, c: CatState, blastWhy?: string): number {
  const rng = catRng(sim, s), wk = WORK.get(c), W = s.w, H = s.h, n = W * H, regs = s.regions, foot = c.foot, t = s.tiles;
  // 원인: 폭발이면 그 폭발, 전소 뒤면 그것, 아니면 무너진 구획들의 장부 합에서 가장 큰 칸 (무너진 구획이 없으면 모든 구획)
  let anyFallen = false;
  for (let r = 0; r < regs.length; r++) if (regs[r].indoor && c.fallen[r]) { anyFallen = true; break; }
  const sum = new Float64Array(LOSS_N);
  let bestR = -1, bestV = -1;
  for (let r = 0; r < regs.length; r++) {
    if (!regs[r].indoor || (anyFallen && !c.fallen[r])) continue;
    let tot = 0;
    for (let k = 0; k < LOSS_N; k++) { const v = c.loss[r * LOSS_N + k]; sum[k] += v; tot += v; }
    if (tot > bestV) { bestV = tot; bestR = r; }
  }
  let top = 0;
  for (let k = 1; k < LOSS_N; k++) if (sum[k] > sum[top]) top = k;
  const why = blastWhy ? `${blastWhy}의 충격` : c.burntAt >= 0 ? '건물이 전소된 뒤 골조가 버티지 못함'
    : top === LOSS_FIRE ? '불에 오래 달궈진 골조가 버티지 못함' : top === LOSS_BURN ? '골조가 타서 약해짐' : lossText(c, wk, Math.max(0, bestR), top);
  const ev = raiseProblem(sim, I, 'STRUCT_COLLAPSE', `건물 전체 붕괴 — ${why}`,
    { role: 'SYSTEM', actor: '현장', imp: 3, truth: s.arrivedAt < 0, causes: [bestR >= 0 ? c.causeEv[bestR] : -1], text: '굉음! 건물 전체가 무너져 내렸습니다.' }, false);
  const bld = new Uint8Array(n);      // 건물 칸 (층 경계 제외) — 처음 생김새
  for (let i = 0; i < n; i++) if (foot[i] === FOOT_IN || foot[i] === FOOT_SHELL) bld[i] = 1;
  // 출입구에 붙은 문 칸과 그 양옆 한 칸은 반드시 연다
  const force = new Uint8Array(n);
  for (const e of s.exits) {
    for (let d = 0; d < 4; d++) {
      const x = e.x + D8X[d], y = e.y + D8Y[d];
      if (x < 0 || y < 0 || x >= W || y >= H || !bld[y * W + x]) continue;
      const i = y * W + x;
      force[i] = 1;
      if (D8X[d] !== 0) { if (y > 0) force[i - W] = 1; if (y + 1 < H) force[i + W] = 1; } else { if (x > 0) force[i - 1] = 1; if (x + 1 < W) force[i + 1] = 1; }
    }
  }
  const conv: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!bld[i]) continue;
    const ti = t[i];
    if (isWallT(ti)) {
      if (foot[i] === FOOT_IN || force[i] || rng.chance(0.55)) { t[i] = T.FLOOR; s.glass[i] = 0; markRuin(s, i, RUIN_WALL); conv.push(i); }      // 깨진 창 자료는 창 칸에만 (N7)
    } else if (ti === T.FURN) { t[i] = T.FLOOR; s.decorHp[i] = WRECKED; markRuin(s, i, RUIN_FURN + s.decor[i]); }
    else if (ti === T.DOOR) {
      const d = s.propAt[i] >= 0 ? s.props[s.propAt[i]] : doorAt(s, i);
      if (d && d.kind === 'door') { d.removed = true; d.blocking = false; d.open = true; d.locked = false; if (s.propAt[i] === d.id) s.propAt[i] = -1; }
      t[i] = T.FLOOR;
    }
  }
  // 새 바닥 칸의 구역: 4 이웃 실내 칸의 구역 가운데 가장 작은 번호 (없으면 -1 — 바깥 칸과 같다). 구역은 지우지 않는다
  for (let q = 0; q < conv.length; q++) {
    const i = conv[q], x = i % W;
    let m = -1;
    for (let d = 0; d < 4; d++) {
      if ((d === 0 && x + 1 >= W) || (d === 1 && x === 0)) continue;
      const j = d === 0 ? i + 1 : d === 1 ? i - 1 : d === 2 ? i + W : i - W;
      if (j < 0 || j >= n || !isIndoor(t[j])) continue;
      const rg = s.region[j];
      if (rg >= 0 && regs[rg].indoor && (m < 0 || rg < m)) m = rg;
    }
    if (s.region[i] === m) continue;
    if (s.region[i] >= 0) { const o = regs[s.region[i]].tiles, k = o.indexOf(i); if (k >= 0) o.splice(k, 1); }
    if (m >= 0) regs[m].tiles.push(i);
    s.region[i] = m;
  }
  // 모든 건물 칸: 무너진 자리, 잔해 속 불씨, 먼지. 바닥 칸은 (G4) 전체 붕괴의 잔해로 적는다 (아직 0 인 칸에만 — 벽·가구였던 칸은 그 모습을 지킨다)
  for (let i = 0; i < n; i++) {
    if (!bld[i]) continue;
    s.damage[i] = 1; s.fire[i] *= 0.5;
    if (s.fuel[i] > 0.5) s.fuel[i] = 0.5;
    if (s.smoke[i] < 0.8) s.smoke[i] = 0.8;
    if (t[i] === T.FLOOR) markRuin(s, i, RUIN_TOTAL);
  }
  // 잔해: 출입구 3칸 안과, 잔해를 놓기 전에 낸 출입구 → 건물 가운데의 길(잔해 수색의 통로 — 한계 시간에 걸리지 않게)은 비운다
  const keep = new Uint8Array(n), occ = occupied(s);
  const ctr = centerFloor(s);
  if (ctr >= 0) for (const e of s.exits) {
    const p = astar(s, e.x, e.y, ctr % W, (ctr / W) | 0, 0, (i) => (staticPass(t[i]) ? (s.propAt[i] >= 0 ? 3 : 0) : -1));
    if (p) for (let q = 0; q < p.length; q++) keep[p[q]] = 1;
  }
  const nearExit = (x: number, y: number, r: number): boolean => { for (const e of s.exits) if (dist(x, y, e.x, e.y) <= r) return true; return false; };
  const pD = 0.10 + 0.03 * I.truth.severity;
  for (let i = 0; i < n; i++) {
    if (!bld[i] || t[i] !== T.FLOOR || s.propAt[i] >= 0 || occ[i] || keep[i]) continue;
    const x = i % W, y = (i / W) | 0;
    if (nearExit(x, y, 3)) continue;
    if (rng.chance(pD)) addProp(s, 'debris', x, y, { blocking: true, hp: rng.range(10, 18) });
  }
  // 바깥으로 쏟아짐: 바깥벽 곁 1칸의 바깥 칸 (사람이 선 칸·출입구 2칸 안·대기 지점·안전 구역 2칸 안·엄폐 자리·소화전은 뺀다). 사람이 선 칸은 잔해 대신 피해
  const spill = new Uint8Array(n), shell = shellTiles(s);
  for (let q = 0; q < shell.length; q++) {
    const i = shell[q], x = i % W, y = (i / W) | 0;
    for (let d = 0; d < 8; d++) { const xx = x + D8X[d], yy = y + D8Y[d]; if (xx >= 0 && yy >= 0 && xx < W && yy < H && foot[yy * W + xx] === 0 && staticPass(t[yy * W + xx])) spill[yy * W + xx] = 1; }
  }
  const skip = new Uint8Array(n);
  for (const p of s.props) if (p.kind === 'hydrant' && !p.removed) skip[p.y * W + p.x] = 1;
  for (const sp of s.spots) { const x = Math.round(sp.x), y = Math.round(sp.y); if (x >= 0 && y >= 0 && x < W && y < H) skip[y * W + x] = 1; }
  for (let i = 0; i < n; i++) {
    if (!spill[i] || occ[i] || skip[i] || s.propAt[i] >= 0) continue;
    const x = i % W, y = (i / W) | 0;
    if (nearExit(x, y, 2) || dist(x, y, s.staging.x, s.staging.y) <= 2 || dist(x, y, s.safe.x, s.safe.y) <= 2) continue;
    if (rng.chance(0.3)) addProp(s, 'debris', x, y, { blocking: true, hp: rng.range(10, 18) });
  }
  // 구조 대상: 건물 칸 안 — 숨짐(폭발이거나 그 구획이 거의 무너져 있었으면 40%, 아니면 18%) · 나머지의 70% 갇힘 · 30% 못 걷게 됨. 바깥벽 곁은 쏟아진 잔해에 맞는다
  for (const q of s.casualties) {
    if (q.dead || q.health <= 0) continue;
    if (q.where === 'carried') {
      const by = s.agents.find((a) => a.carrying === q.id);
      if (by && bld[tileOf(s, by.x, by.y)]) hurtCas(sim, s, I, q, rng.range(8, 20), 'crush', { ev });
      continue;
    }
    if (q.where !== 'scene' || q.inWater) continue;
    const ti = tileOf(s, q.x, q.y);
    if (bld[ti]) {
      const rg = s.region[ti];
      const pDie = blastWhy || (rg >= 0 && regs[rg].indoor && c.integ[rg] <= 0.1) ? 0.4 : 0.18;
      q.path = null;
      if (rng.chance(pDie)) hurtCas(sim, s, I, q, q.health + 5, 'crush', { ev });
      else if (rng.chance(0.7)) { q.mob = 'trapped'; q.trapWork = Math.max(q.trapWork, rng.range(18, 32)); q.walking = false; hurtCas(sim, s, I, q, rng.range(12, 30), 'crush', { ev }); }
      else hurtCas(sim, s, I, q, rng.range(15, 35), 'crush', { ev, immobile: true });
    } else if (spill[ti]) hurtCas(sim, s, I, q, rng.range(10, 25), 'crush', { ev });
  }
  // 대원: 건물 칸 안 — 60% 는 깔리고(55~95), 40% 는 밀려나 덜 다친다(25~45). 바깥벽 곁의 대원은 쏟아진 잔해에 맞는다
  for (const a of s.agents) {
    if (a.status === 'left' || sim.responders[a.rid].dead) continue;
    const ti = tileOf(s, a.x, a.y);
    if (bld[ti]) {
      if (rng.chance(0.6)) { hurtResponder(sim, s, I, a, rng.range(55, 95), 'crush', { ev }); a.trapped = rng.range(10, 18); a.trapEv = ev; }
      else {
        hurtResponder(sim, s, I, a, rng.range(25, 45), 'crush', { ev });
        // 가장 가까운 빈 바닥으로 밀려난다 (선 칸이 그대로 걸을 수 있는 빈 칸이면 그 자리 — 잔해는 사람이 선 칸에 놓지 않으므로 대개 그렇다)
        if (!staticPass(t[ti]) || s.propAt[ti] >= 0) {
          let best = -1, bd = 1e9;
          for (let j = 0; j < n; j++) { if (!staticPass(t[j]) || s.propAt[j] >= 0) continue; const d = dist(a.x, a.y, j % W, (j / W) | 0); if (d < bd) { bd = d; best = j; } }
          if (best >= 0) { a.x = best % W; a.y = (best / W) | 0; }
        }
      }
    } else if (spill[ti]) hurtResponder(sim, s, I, a, rng.range(10, 25), 'crush', { ev });
  }
  for (const h of s.hostiles) {
    if (h.dead || h.state === 'escaped' || (h.where !== undefined && h.where !== 'scene') || !bld[tileOf(s, h.x, h.y)]) continue;
    hurtHostile(sim, s, I, h, rng.range(40, 80), 'crush', { ev });
  }
  // 상태
  const was: number[] = [];
  for (let r = 0; r < regs.length; r++) { if (!regs[r].indoor) continue; if (!c.fallen[r] && c.integ[r] < SIGN.TIC_L1) was.push(r); c.fallen[r] = 1; c.l3Since[r] = -1; }
  c.totalAt = sim.t; c.bldg = 0;
  const [bx, by] = bldgCenter(s);
  c.hits.push({ t: sim.t, x: bx, y: by });
  c.limitBonus += 180;
  replanAll(s);
  s.staticVersion++;
  blockRoad(sim, I);
  let x0 = W, y0 = H, x1 = -1, y1 = -1;
  for (const rg of regs) if (rg.indoor) { x0 = Math.min(x0, rg.x0); y0 = Math.min(y0, rg.y0); x1 = Math.max(x1, rg.x1); y1 = Math.max(y1, rg.y1); }
  recordFall(sim, s, bx, by, Math.max(2, Math.max(x1 - x0 + 1, y1 - y0 + 1) / 2), 'total');      // (G4)
  // 현장 전원이 듣는다: 전체 붕괴 + 건물 조짐 3, 그리고 아직 서 있던 구획의 구조 조짐은 이제 없다(down)
  const facts: Fact[] = [
    signFact(sim, SIGN_BASE.event + c.events++, { kind: 'event', level: 3, region: -1, x: bx, y: by, what: 'total' }, '굉음! 건물 전체 무너짐'),
    signFact(sim, SIGN_BASE.bldg, { kind: 'bldg', level: 3, region: -1, x: bx, y: by }, '건물 전체 붕괴'),
  ];
  TOTAL_EV.set(c, facts[0]);      // (단계 6) 소리를 듣지 못한 대원도 잔해 더미를 보면 이 사건을 안다 (perceiveSigns)
  for (const r of was) facts.push(signFact(sim, SIGN_BASE.struct + r, { kind: 'struct', level: 0, region: r, x: regs[r].cx, y: regs[r].cy, down: true }, fallenText(regs[r].name)));
  hearAll(sim, s, ev, facts);
  markPlace(sim, s, I, c, 'collapsed');
  let size = 0; for (let i = 0; i < n; i++) if (bld[i]) size++;
  signal(sim, 'catastrophe', { inc: I.id, ev, cx: bx, cy: by, size, place: I.truth.placeId, data: 1, mag: 1 });      // (I1-b b3-8) 건물 전체 — 충격이 이웃 건물로 나간다(world/rules/structure.ts 의 shockSpread)
  return ev;
}

/** 전소의 사슬 문구 (§4.6): 그때까지 기록된 문제에서, 이 순서로 처음 맞는 것. 근거가 된 문제의 기록을 함께 돌려준다 */
function burnoutChain(sim: Sim, s: Scene, I: Incident): [string, number] {
  const open = (code: string): number => { for (const p of I.problems) if (p.code === code && !p.recovered) return p.eventId; return -1; };
  let e = open('WATER_OUT');
  if (e >= 0) return ['용수가 끊긴 동안 불이 번짐', e];
  e = open('NO_UNIT'); if (e < 0) e = open('UNDER_DISPATCH');
  if (e >= 0) return ['진압 부대가 모자라 불길을 잡지 못함', e];
  if (s.ops && s.ops.mode === 'defensive') return ['외부 방어로 바꾼 뒤 안쪽 방까지 물이 닿지 않음', s.ops.ev];
  const limit = TYPE_DEFS[I.truth.type].respLimit;
  if (I.reportedAt >= 0 && (I.firstArrivalAt >= 0 ? I.firstArrivalAt - I.reportedAt : sim.t - I.reportedAt) > limit) return ['첫 부대가 늦게 도착해 불이 커짐', I.rootEvent];
  return ['불이 진압 속도보다 빨리 번짐', I.lastEvent];
}
/** 전소 (§4.6): 조용히 일어난다 — 현장 전원 소리는 없다(지휘관의 외부 관찰이 건물 조짐을 본다) */
function burnout(sim: Sim, s: Scene, I: Incident, c: CatState): void {
  c.burntAt = sim.t;
  const [chain, cause] = burnoutChain(sim, s, I);
  const ev = raiseProblem(sim, I, 'BURNOUT', `건물 전소 — ${chain}`, { role: 'SYSTEM', actor: '현장', imp: 3, truth: s.arrivedAt < 0, causes: [cause], text: '건물이 사실상 전소됐습니다. 남은 골조의 붕괴가 우려됩니다.' }, false);
  markPlace(sim, s, I, c, 'burnt');
  signal(sim, 'catastrophe', { inc: I.id, ev, size: 0, place: I.truth.placeId, data: 2, mag: 0 });      // (I1-b b3-8) 전소는 충격이 없다
}

// ───────────────────────── 일어나는 일 — 폭발 (단계 4 — 설계서 §2.5·§2.6·§4.3·§4.4) ─────────────────────────
// 기록 코드는 지휘관이 그 위험을 알았는가로 가른다 — 알았으면 EXPLOSION, 몰랐으면 HIDDEN_HAZARD(신고에 없던 위험).
// 세계 규칙이 지휘관의 믿음을 읽는 것은 **기록 코드를 고르는 데만** 쓴다 (판정·보고서의 재료 — 일어나는 일에는 영향이 없다. debrief 와 같은 자격).

/** 지금의 지휘관 (없으면 null) */
function commanderOf(s: Scene): FieldAgent | null {
  for (const a of s.agents) if (a.isCommander && a.rid === s.commanderRid && a.status !== 'left') return a;
  return null;
}
/** 문이 날아간다 (§4.3): 반경 안의 문 소품은 열리고 잠금이 풀린다 — 잠겨 막고 있던 문은 길을 비운다 */
function blowDoors(s: Scene, x: number, y: number, r: number): void {
  for (const p of s.props) {
    if (p.kind !== 'door' || p.removed || dist(p.x, p.y, x, y) > r) continue;
    p.open = true;
    if (p.locked || p.blocking) { p.locked = false; p.blocking = false; const i = p.y * s.w + p.x; if (s.propAt[i] === p.id) s.propAt[i] = -1; }
  }
}

/**
 * 가스 구름의 점화원 (§2.5) — 위에서부터 하나라도 맞으면 그 칸(점화된 칸)을 돌려준다. 없으면 -1.
 *   1 불: 구름 칸의 불 ≥ 0.15, 또는 구름 칸의 4 이웃에 불 ≥ 0.3 (확률 없음)
 *   2 무너짐·충격: 최근 1.2초의 충격 자리(c.hits)가 구름에서 3칸 안 (확률 없음)
 *   3 알 수 없는 스파크: 구름이 셋 이상이면 초당 min(0.012, 0.0012 × N × hazardMul) × min(1, 나이/90) — 막 생긴 구름에는 거의 없다
 * how 에 점화원 번호(1·2·3)를 적는다
 */
function ignition(sim: Sim, s: Scene, c: CatState, cloud: number[], how: number[]): number {
  const W = s.w, n = W * s.h, fire = s.fire;
  for (let q = 0; q < cloud.length; q++) {
    const i = cloud[q], x = i % W;
    if (fire[i] >= 0.15) { how[0] = 1; return i; }
    if ((x + 1 < W && fire[i + 1] >= 0.3) || (x > 0 && fire[i - 1] >= 0.3) || (i + W < n && fire[i + W] >= 0.3) || (i >= W && fire[i - W] >= 0.3)) { how[0] = 1; return i; }
  }
  for (let k = 0; k < c.hits.length; k++) {
    const h = c.hits[k];
    if (h.t < sim.t - 1.2) continue;
    let best = -1, bd = 3.0001;
    for (let q = 0; q < cloud.length; q++) { const i = cloud[q], d = dist(i % W, (i / W) | 0, h.x, h.y); if (d < bd) { bd = d; best = i; } }
    if (best >= 0) { how[0] = 2; return best; }
  }
  const N = cloud.length;
  if (N < CAT.CLOUD_MIN || c.cloudSince < 0) return -1;
  const age = sim.t - c.cloudSince;
  if (!catRng(sim, s).chance(Math.min(CAT.SPARK_MAX, 0.0012 * N * sim.tune.hazardMul) * Math.min(1, age / CAT.SPARK_AGE))) return -1;
  how[0] = 3;
  let sx = 0, sy = 0;
  for (let q = 0; q < N; q++) { sx += cloud[q] % W; sy += (cloud[q] / W) | 0; }
  sx /= N; sy /= N;
  let best = cloud[0], bd = 1e9;
  for (let q = 0; q < N; q++) { const i = cloud[q], d = dist(i % W, (i / W) | 0, sx, sy); if (d < bd) { bd = d; best = i; } }
  return best;
}
const IGNITE_TEXT = ['', '불길이 가스에 닿음', '무너지며 튄 불꽃', '원인 모를 불꽃(전기·정전기)'];
const HOW: number[] = [0];

/**
 * 가스 폭발 (§4.3): 폭발 하한을 넘은 구름이 점화된다. 크기는 구름 칸 수 N 으로 — 반경 clamp(2.0 + 0.55√N, 2.6, 6.0), 피해 clamp(18 + 4.5√N, 24, 55).
 * 구름 칸에 불이 붙고, 구름은 타 버리고(나머지 가스 × 0.4), 반경 안의 문이 날아가고, 가장 가까운 살아 있는 밸브가 불붙는다(누출이 멈춘다).
 * 돌려주는 값은 기록 id
 */
export function explodeGas(sim: Sim, s: Scene, I: Incident, c: CatState, cloud: number[], at: number, how: number): number {
  const W = s.w, g = c.gas!, N = cloud.length, cx = at % W, cy = (at / W) | 0;
  const r = Math.min(6, Math.max(2.6, 2.0 + 0.55 * Math.sqrt(N))), dmg = Math.min(55, Math.max(24, 18 + 4.5 * Math.sqrt(N)));
  // 불붙을 밸브: 구름 무게중심에 가장 가까운 살아 있는 밸브 (이미 차단했거나 도시가스가 끊긴 뒤 남은 구름이면 없다)
  let sx = 0, sy = 0;
  for (let q = 0; q < N; q++) { sx += cloud[q] % W; sy += (cloud[q] / W) | 0; }
  sx /= N; sy /= N;
  const wk = WORK.get(c)!;
  let valve: Prop | null = null, vd = 1e9;
  for (const p of wk.valves) { if (p.mitigated || p.ignited) continue; const d = dist(p.x, p.y, sx, sy); if (d < vd) { vd = d; valve = p; } }
  // 구름이 든 구획들
  const regs: number[] = [];
  for (let q = 0; q < N; q++) { const rg = regionAtTile(s, cloud[q]); if (rg >= 0 && regs.indexOf(rg) < 0) regs.push(rg); }
  regs.sort((a, b) => a - b);
  const rg0 = regionAtTile(s, at), where = rg0 >= 0 ? s.regions[rg0].name : '건물 안';
  // 기록 (먼저 — blast 와 그 안의 hurt* 가 이 ev 를 받는다)
  const cmd = commanderOf(s);
  let knew = false;
  if (cmd) {
    if (valve && cmd.beliefs.get('haz', valve.id)) knew = true;
    for (let k = 0; k < regs.length && !knew; k++) { const v = cmd.beliefs.val<SignBelief>('sign', SIGN_BASE.gas + regs[k]); if (v && v.level >= 1) knew = true; }
  }
  const ev = raiseProblem(sim, I, knew ? 'EXPLOSION' : 'HIDDEN_HAZARD', `누출된 가스 폭발 — ${IGNITE_TEXT[how]}`,
    { role: 'SYSTEM', actor: '현장', imp: 3, truth: s.arrivedAt < 0, text: `폭발! ${where}에 고여 있던 가스에 불이 붙었습니다.` }, false);
  c.gasN++;
  // 구름이 탄다: 구름 칸에 불, 나머지 가스는 0.4배
  const inC = new Uint8Array(g.length);
  for (let q = 0; q < N; q++) {
    const i = cloud[q];
    inC[i] = 1;
    if (s.fuel[i] > 0) { if (s.fire[i] < 0.6) s.fire[i] = 0.6; }
    else { s.fuel[i] = 0.4; s.fire[i] = 0.5; }
    g[i] = 0;
  }
  for (let i = 0; i < g.length; i++) if (!inC[i] && g[i] > 0) g[i] *= 0.4;
  if (valve) valve.ignited = true;
  blowDoors(s, cx, cy, r);
  blast(sim, s, I, cx, cy, r, dmg, ev, 'blast', false, true);      // (I1-b) noSignal — 이 폭발은 아래의 'catastrophe' 신호 하나로 간다
  pushFx(sim, s, 'boom', cx, cy, undefined, undefined, undefined, undefined, 1.6);
  noteBoom(lastFx(sim, s, 'boom'), r, 'gas');
  s.staticVersion++;
  // 현장 전원이 듣는다: 폭발 + 밸브는 불붙었다(지금의 발화와 같은 뜻) + 그 구획들의 가스는 타 버렸다(down)
  const facts: Fact[] = [signFact(sim, SIGN_BASE.event + c.events++, { kind: 'event', level: 3, region: rg0, x: cx, y: cy, what: 'gas' }, `폭발! ${where}`)];
  if (valve) facts.push(mkFact('haz', valve.id, { kind: 'leak', active: false, x: valve.x, y: valve.y }, '현장', sim.t, 1, true, '누출 가스 발화'));
  for (const rg of regs) facts.push(signFact(sim, SIGN_BASE.gas + rg, { kind: 'gas', level: 0, region: rg, x: s.regions[rg].cx, y: s.regions[rg].cy, down: true }, `${s.regions[rg].name} 가스 연소 — 남은 가스 없음`));
  hearAll(sim, s, ev, facts);
  markPlace(sim, s, I, c, 'blasted');
  signal(sim, 'catastrophe', { inc: I.id, ev, cx, cy, size: r, place: I.truth.placeId, data: 0, mag: dmg });      // (I1-b b3-8) mag = 피해량
  return ev;
}

/** 용기 종류별 폭발 (§4.4): 반경 · 피해 · 기록 문구 · 그림 꼬리표 */
const VESSEL_BOOM: Record<string, { r: number; dmg: number; detail: string; src: NonNullable<FxInfo['src']> }> = {
  cylinder: { r: 3.6, dmg: 34, detail: '보관 중이던 가스 용기 폭발', src: 'tank' },
  drum: { r: 2.8, dmg: 26, detail: '화학 드럼 파열', src: 'drum' },
  cng: { r: 3.0, dmg: 30, detail: 'CNG 버스 가스 용기 폭발', src: 'cng' },
  jet: { r: 3.4, dmg: 32, detail: '항공유 폭발', src: 'jet' },
};
/**
 * 용기 폭발 (§4.4): 열이 1 에 닿은 용기가 터진다. 가스 용기는 둘레 2.3칸 연료 칸에 불 0.85, 화학 드럼은 2칸 안 바닥·가구에 불 0.7 과 유독 연기,
 * CNG 버스는 차체 둘레에 불 0.8 과 탑승자 피해, 항공유는 동체·날개 쪽 연료 칸에 불 0.9 와 둘레 땅에 번지는 연료. 돌려주는 값은 기록 id
 */
export function ruptureVessel(sim: Sim, s: Scene, I: Incident, c: CatState, p: Prop): number {
  const v = p.vessel ?? 'cylinder', spec = VESSEL_BOOM[v] ?? VESSEL_BOOM.cylinder, W = s.w, H = s.h;
  const cx = p.x + (p.w - 1) / 2, cy = p.y + (p.h - 1) / 2;
  const cmd = commanderOf(s);
  let knew = false;
  if (cmd) {
    if (cmd.beliefs.get('haz', p.id)) knew = true;
    const sv = cmd.beliefs.val<SignBelief>('sign', SIGN_BASE.vessel + p.id);
    if (sv && sv.level >= 2) knew = true;
  }
  const nm = vesselName(p);
  const ev = raiseProblem(sim, I, knew ? 'EXPLOSION' : 'HIDDEN_HAZARD', spec.detail,
    { role: 'SYSTEM', actor: '현장', imp: 3, truth: s.arrivedAt < 0, text: `폭발! 불길에 달궈진 ${josa(nm, '이/가')} 터졌습니다.` }, false);
  p.exploded = true;
  if (p.kind === 'vehicle') p.ignited = true;
  c.vesselN++;
  const rng = catRng(sim, s);
  const x0 = Math.max(0, Math.floor(cx - 4)), x1 = Math.min(W - 1, Math.ceil(cx + 4)), y0 = Math.max(0, Math.floor(cy - 4)), y1 = Math.min(H - 1, Math.ceil(cy + 4));
  const onBody = (x: number, y: number): boolean => x >= p.x && x < p.x + p.w && y >= p.y && y < p.y + p.h;
  const nearBody = (x: number, y: number): number => { const dx = x < p.x ? p.x - x : x >= p.x + p.w ? x - (p.x + p.w - 1) : 0, dy = y < p.y ? p.y - y : y >= p.y + p.h ? y - (p.y + p.h - 1) : 0; return Math.hypot(dx, dy); };
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const j = y * W + x, t = s.tiles[j];
    if (v === 'cylinder') { if (s.fuel[j] > 0 && dist(x, y, p.x, p.y) <= 2.3 && s.fire[j] < 0.85) s.fire[j] = 0.85; }
    else if (v === 'drum') {
      const d = dist(x, y, p.x, p.y);
      if (d <= 2.0 && (t === T.FLOOR || t === T.FURN)) { if (s.fuel[j] <= 0) s.fuel[j] = 0.5; if (s.fire[j] < 0.7) s.fire[j] = 0.7; }
      if (d <= 3 && t !== T.WALL && t !== T.VOID && s.smoke[j] < 0.9) s.smoke[j] = 0.9;      // 유독 연기
    } else if (v === 'cng') {
      if (nearBody(x, y) <= 1 && staticPass(t)) { if (s.fuel[j] < 0.5) s.fuel[j] = 0.5; if (s.fire[j] < 0.8) s.fire[j] = 0.8; }
    } else {
      const d = nearBody(x, y);
      if (d <= 1 && s.fuel[j] > 0) { if (s.fire[j] < 0.9) s.fire[j] = 0.9; }
      else if (onBody(x, y)) { if (s.fuel[j] < 0.5) s.fuel[j] = 0.5; if (s.fire[j] < 0.9) s.fire[j] = 0.9; }
      else if (d <= 3 && s.fuel[j] <= 0 && (t === T.GROUND || t === T.ROAD || t === T.TRAIL)) { s.fuel[j] = 0.5; s.fire[j] = 0.6; }      // 번지는 항공유
    }
  }
  if (p.kind === 'vehicle') for (const q of s.casualties) if (q.inVehicle === p.id && !q.dead) hurtCas(sim, s, I, q, rng.range(20, 40), 'blast', { ev });      // 같은 차·동체의 탑승자
  blowDoors(s, cx, cy, spec.r);
  blast(sim, s, I, cx, cy, spec.r, spec.dmg, ev, 'blast', false, true);      // (I1-b) noSignal
  pushFx(sim, s, 'boom', cx, cy, undefined, undefined, undefined, undefined, 1.6);
  noteBoom(lastFx(sim, s, 'boom'), spec.r, spec.src);
  s.staticVersion++;
  // 현장 전원이 듣는다: 폭발 + 그 용기는 이제 없다(haz active:false · 용기 조짐 0 down)
  const rg = regionOfProp(s, p), where = rg >= 0 ? s.regions[rg].name : regionNameAt(s, p.x, p.y);
  const facts: Fact[] = [signFact(sim, SIGN_BASE.event + c.events++, { kind: 'event', level: 3, region: rg, x: p.x, y: p.y, prop: p.id, what: 'vessel' }, `폭발! ${where} ${nm}`)];
  if (p.kind === 'gas') facts.push(mkFact('haz', p.id, { kind: 'gas', active: false, x: p.x, y: p.y }, '현장', sim.t, 1, true, `${nm} 폭발 확인`));
  else if ((p.leakRate ?? 0) > 0) facts.push(mkFact('haz', p.id, { kind: 'leak', active: false, x: p.x, y: p.y }, '현장', sim.t, 1, true, '누출 연료 발화'));
  facts.push(signFact(sim, SIGN_BASE.vessel + p.id, { kind: 'vessel', level: 0, region: rg, x: p.x, y: p.y, prop: p.id, down: true }, `${where} ${nm} 폭발 — 더는 위험 없음`));
  hearAll(sim, s, ev, facts);
  markPlace(sim, s, I, c, 'blasted');
  signal(sim, 'catastrophe', { inc: I.id, ev, cx, cy, size: spec.r, place: I.truth.placeId, data: 0, mag: spec.dmg });      // (I1-b b3-8) mag = 피해량
  return ev;
}

// ───────────────────────── (단계 9, 선택) 분진 폭발 §4.5 · 플래시오버 §4.7 ─────────────────────────

const DUST_TEXT = ['', '무너지며 날린 분진에 불이 붙음', '폭발 충격에 날린 분진에 불이 붙음', '불길이 쌓인 분진에 닿음'];
/**
 * 분진 점화 (§4.5) — 한 초에 한 번. ① 그 구획이나 이웃 구획이 새로 무너짐 → 0.5, ② 새 충격(c.hits)이 구획 가운데 4칸 안 → 0.5 (①로 굴린 초에는
 * 같은 무너짐의 충격 자리를 다시 굴리지 않는다), ③ 구획 칸의 15% 이상이 불 0.6 이상 → 초당 0.04. 터지면 참
 */
function dustStep(sim: Sim, s: Scene, I: Incident, c: CatState, w: CatWork): boolean {
  const r = c.dustRegion, reg = s.regions[r];
  if (!reg || !reg.tiles.length) return false;
  const rng = catRng(sim, s), nb = regionNbrs(s)[r] ?? [];
  let fell = c.fallen[r];
  for (let k = 0; k < nb.length; k++) fell += c.fallen[nb[k]];
  let hitNew = false, lastT = w.dustHitT;
  for (let k = 0; k < c.hits.length; k++) {
    const h = c.hits[k];
    if (h.t <= w.dustHitT) continue;
    if (h.t > lastT) lastT = h.t;
    if (dist(h.x, h.y, reg.cx, reg.cy) <= CAT.DUST_HIT_R) hitNew = true;
  }
  w.dustHitT = lastT;
  let how = 0;
  if (fell > w.dustFell) { w.dustFell = fell; if (rng.chance(CAT.DUST_FALL)) how = 1; }
  else if (hitNew && rng.chance(CAT.DUST_HIT)) how = 2;
  if (!how && s.burning > 0) {
    const tl = reg.tiles, f = s.fire;
    let hot = 0;
    for (let q = 0; q < tl.length; q++) if (f[tl[q]] >= CAT.DUST_FIRE_AT) hot++;
    if (hot >= CAT.DUST_FIRE_SHARE * tl.length && rng.chance(CAT.DUST_FIRE)) how = 3;
  }
  if (!how) return false;
  explodeDust(sim, s, I, c, how);
  return true;
}
/**
 * 분진 폭발 (§4.5): 구획 가운데에서 반경 3.2 + 0.15 √칸 수 · 피해 30, 구획의 연료 칸에 불 0.6. 지휘관이 분진 조짐을 알았으면 EXPLOSION, 몰랐으면 HIDDEN_HAZARD.
 * 기록이 먼저다 (blast 와 그 안의 hurt* 가 이 ev 를 받는다). 돌려주는 값은 기록 id
 */
export function explodeDust(sim: Sim, s: Scene, I: Incident, c: CatState, how: number): number {
  const r = c.dustRegion, reg = s.regions[r], n = reg.tiles.length;
  const rad = 3.2 + 0.15 * Math.sqrt(n), cx = reg.cx, cy = reg.cy;
  const cmd = commanderOf(s);
  const v = cmd ? cmd.beliefs.val<SignBelief>('sign', SIGN_BASE.dust + r) : undefined;
  const ev = raiseProblem(sim, I, v && v.level >= 1 ? 'EXPLOSION' : 'HIDDEN_HAZARD', `분진 폭발 — ${DUST_TEXT[how]}`,
    { role: 'SYSTEM', actor: '현장', imp: 3, truth: s.arrivedAt < 0, text: `폭발! ${reg.name}에 쌓여 있던 분진이 터졌습니다.` }, false);
  c.dustDone = true; c.dustN++;
  const tl = reg.tiles;
  for (let q = 0; q < tl.length; q++) { const i = tl[q]; if (s.fuel[i] > 0 && s.fire[i] < 0.6) s.fire[i] = 0.6; }
  blowDoors(s, cx, cy, rad);
  blast(sim, s, I, cx, cy, rad, CAT.DUST_DMG, ev, 'blast', false, true);      // (I1-b) noSignal
  pushFx(sim, s, 'boom', cx, cy, undefined, undefined, undefined, undefined, 1.6);
  noteBoom(lastFx(sim, s, 'boom'), rad, 'dust');
  s.staticVersion++;
  hearAll(sim, s, ev, [
    signFact(sim, SIGN_BASE.event + c.events++, { kind: 'event', level: 3, region: r, x: cx, y: cy, what: 'dust' }, `폭발! ${reg.name} 분진 폭발`),
    signFact(sim, SIGN_BASE.dust + r, { kind: 'dust', level: 0, region: r, x: cx, y: cy, down: true }, `${reg.name} 분진 폭발 — 남은 분진 없음`),
  ]);
  markPlace(sim, s, I, c, 'blasted');
  signal(sim, 'catastrophe', { inc: I.id, ev, cx, cy, size: rad, place: I.truth.placeId, data: 0, mag: CAT.DUST_DMG });      // (I1-b b3-8) mag = 피해량
  return ev;
}
/**
 * 플래시오버 (§4.7) — 한 초에 한 번, 타는 칸이 있을 때만. 방(실내 'room')마다 불 몫(불 0.3 이상 칸)·연기 평균·젖음 평균을 세어
 * 롤오버 조짐의 진실 단계(w.rollLv — 1: 불 몫 ≥ 0.08·연기 ≥ 0.6, 2: ≥ 0.15·≥ 0.7, 이미 일어난 방은 0)를 적고,
 * 불 몫 ≥ 0.25 · 연기 ≥ 0.7 · 젖음 < 0.08 (안에서 물을 뿌리면 일어나지 않는다) 이면 초당 0.05 × fireSpreadMul 로 그 방의 불 없는 연료 칸이 모두 불 0.45
 */
function flashStep(sim: Sim, s: Scene, I: Incident, c: CatState, w: CatWork): void {
  const regs = s.regions, fire = s.fire, smoke = s.smoke, wet = s.wet, lv = w.rollLv;
  let on = false;
  for (let r = 0; r < regs.length; r++) {
    const reg = regs[r];
    if (!reg.indoor || reg.kind !== 'room' || c.fallen[r]) { lv[r] = 0; continue; }
    const tl = reg.tiles, m = tl.length;
    if (!m || c.flashed.indexOf(r) >= 0) { lv[r] = 0; continue; }
    let f3 = 0, sm = 0, wt = 0;
    for (let q = 0; q < m; q++) { const i = tl[q]; if (fire[i] >= 0.3) f3++; sm += smoke[i]; wt += wet[i]; }
    const share = f3 / m, smk = sm / m, wa = wt / m;
    lv[r] = share >= CAT.ROLL_L2 && smk >= CAT.ROLL_L2_SMOKE ? 2 : share >= CAT.ROLL_L1 && smk >= CAT.ROLL_L1_SMOKE ? 1 : 0;
    if (lv[r]) on = true;
    if (share < CAT.FO_FIRE || smk < CAT.FO_SMOKE || wa >= CAT.FO_WET) continue;
    if (!catRng(sim, s).chance(CAT.FO_P * sim.tune.fireSpreadMul)) continue;
    // 기록 (먼저) — 방 안 대원은 agentHealth 의 불 피해를 그대로 받는다 (따로 주지 않는다)
    const ev = raiseProblem(sim, I, 'ESCALATION', `${reg.name} 플래시오버`,
      { role: 'SYSTEM', actor: '현장', imp: 3, truth: s.arrivedAt < 0, text: `${reg.name} 전체가 한순간에 불길에 휩싸였습니다 (플래시오버)!` }, false);
    for (let q = 0; q < m; q++) { const i = tl[q]; if (s.fuel[i] > 0 && fire[i] <= 0) { fire[i] = CAT.FO_SET; s.heat[i] = 0; } }
    c.flashed.push(r); lv[r] = 0;
    hearAll(sim, s, ev, [
      signFact(sim, SIGN_BASE.event + c.events++, { kind: 'event', level: 3, region: r, x: reg.cx, y: reg.cy, what: 'flashover' }, `${reg.name} 플래시오버!`),
      signFact(sim, SIGN_BASE.fire + r, { kind: 'fire', level: 0, region: r, x: reg.cx, y: reg.cy, down: true }, `${reg.name} 플래시오버 — 방 전체 연소`),
    ]);
  }
  w.rollOn = on;
}

/**
 * 도시가스 공급 차단 (§2.3-2): 지휘관이 요청하면(s.ops.utilityAsked — 단계 5) 90~150초 뒤 한 번만 살아 있는 밸브를 모두 차단하고,
 * 현장 전원에게 차단 완료 사실(sign 5001)을 알린다. 밸브마다 haz 를 알리지 않는다 — 아직 모르는 밸브의 위치가 새어 나간다
 */
function utilityStep(sim: Sim, s: Scene, I: Incident, c: CatState): void {
  const ops = s.ops;
  if (c.utilityAt === -1 && ops && ops.utilityAsked >= 0) c.utilityAt = ops.utilityAsked + catRng(sim, s).range(90, 150);
  if (c.utilityAt < 0 || sim.t < c.utilityAt) return;
  c.utilityAt = -2;
  const wk = WORK.get(c)!;
  for (const p of wk.valves) if (!p.mitigated && !p.ignited) p.mitigated = true;
  const ev = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '도시가스사', kind: 'recovery', imp: 2, text: '도시가스사: 공급 차단 완료 — 누출이 멈춥니다.' });
  s.radio.push({ id: s.nextMsgId++, t: sim.t, deliverAt: sim.t + 0.6, from: -1, to: -1, kind: 'brief', workId: -1, text: '', eventId: ev,
    facts: [mkFact('sign', SIGN_BASE.utility, { kind: 'event', what: 'utility', level: 0, region: -1, x: -1, y: -1 }, '도시가스사', sim.t, 1, true, '도시가스 공급 차단 완료')] });
}

// ───────────────────────── 조짐 (단계 2 — 설계서 §3) ─────────────────────────
// 진실의 값에서 **고정 문턱**으로 단계를 정하고(대원에 따라 문턱이 달라지지 않는다 — 열화상만 예외), 대원의 감각 범위 안에 있을 때만 사실이 된다.
// 판단력이 좋은 대원은 조금 멀리서 알아챈다: 소리·눈의 거리에 + 2 × (판단력 − 0.5) 칸 (난수 없이).
// 진실을 숫자로 넘기는 것은 가스 측정기의 값(lel, 5 단위)뿐이다. 건전도·열은 단계로만 넘긴다.

/** 조짐의 감각 상수 (설계서 §3.1 의 표) */
export const SIGN = {
  TIC_L1: 0.7, TIC_L2: 0.5,       // 열화상으로 불타는 구획을 볼 때의 구조 조짐 1·2 문턱 (장비가 문턱을 바꾸는 유일한 경우)
  HEAR_CREAK: 6,                  // 구조 1(삐걱임): 그 구획이나 이웃 구획 안에서, 구획 가운데에서 이 칸 안 (벽 너머도)
  SEE_CRACK: 4, SEE_SHARE: 0.3,   // 구조 2(균열·처짐): 이 칸 안·시야 안인 칸이 그 구획 칸의 이 몫 이상
  HEAR_RUMBLE: 10,                // 구조 3(임박): 구획 가운데에서 이 칸 안 누구나 (벽 너머도)
  GAS_L1: 0.10, GAS_L2: 0.25, GAS_L3: 0.60,      // 가스 조짐 문턱 (그 구획 칸의 가스 최댓값, LEL = 1)
  VESSEL_HEAT2: 0.3, VESSEL_FIRE2: 0.5, SEE_VESSEL: 4,      // 용기 2: 열 ≥ 0.3 이고 곁 불 ≥ 0.5 — 4칸 안·시야
  HEAR_VENT: 7,                   // 용기 3(안전밸브 = CAT.VENT_AT): 7칸 안 (벽 너머도)
  SEE_SHELL: 3,                   // 건물 2·3: 건물 바깥 칸에서 바깥벽 칸이 이만큼 보인다
  SEE_ROLL: 6,                    // (단계 9) 롤오버 1·2: 그 방 칸이 이 칸 안·시야 안에 (구획 칸의 SEE_SHARE 몫)
  SEE_DUST: 5,                    // (단계 9) 분진: 그 구획 칸이 이 칸 안·시야 안에 (구획 칸의 SEE_SHARE 몫)
};

/** 구조 조짐 단계(진실 쪽): 0 · 1 삐걱임 · 2 균열·처짐 · 3 임박. 무너진 구획은 0 (더 무너질 것이 없다). tic = 열화상으로 불타는 구획을 본다(1·2 를 0.7·0.5 에서) */
export function structLevel(c: CatState, r: number, tic = false): number {
  if (c.fallen[r]) return 0;
  const v = c.integ[r];
  return v < CAT.L3 ? 3 : v < (tic ? SIGN.TIC_L2 : CAT.L2) ? 2 : v < (tic ? SIGN.TIC_L1 : CAT.L1) ? 1 : 0;
}
/** 가스 측정값: 그 구획 칸의 가스 최댓값으로 정한 단계와 % LEL (5 단위). 구획 하나에 값 하나 — 같은 구획을 대원마다 다르게 읽지 않는다 */
export function gasReading(c: CatState, s: Scene, r: number): { level: number; lel: number } {
  const g = c.gas;
  if (!g || r < 0) return { level: 0, lel: 0 };
  const tl = s.regions[r].tiles;
  let m = 0;
  for (let q = 0; q < tl.length; q++) { const v = g[tl[q]]; if (v > m) m = v; }
  return { level: m >= SIGN.GAS_L3 ? 3 : m >= SIGN.GAS_L2 ? 2 : m >= SIGN.GAS_L1 ? 1 : 0, lel: Math.round((m * 100) / 5) * 5 };
}
/** 용기 칸(차량은 차체 칸)과 그 1.5칸 안의 불 최댓값 (용기 자기 칸은 × 1.25 — vesselStep 의 near 와 같은 식) */
export function vesselNear(s: Scene, p: Prop): number {
  const W = s.w, H = s.h, fire = s.fire;
  const x0 = p.x, y0 = p.y, x1 = p.x + p.w - 1, y1 = p.y + p.h - 1;
  let near = 0;
  for (let y = Math.max(0, y0 - 2); y <= Math.min(H - 1, y1 + 2); y++) for (let x = Math.max(0, x0 - 2); x <= Math.min(W - 1, x1 + 2); x++) {
    const dx = x < x0 ? x0 - x : x > x1 ? x - x1 : 0, dy = y < y0 ? y0 - y : y > y1 ? y - y1 : 0;
    if (dx * dx + dy * dy > 2.25) continue;
    const f = dx + dy === 0 ? fire[y * W + x] * 1.25 : fire[y * W + x];
    if (f > near) near = f;
  }
  return near;
}
/** 용기 조짐 단계(진실 쪽): 0 · 2 불길에 직접 노출(열 ≥ 0.3, 곁 불 ≥ 0.5) · 3 안전밸브(열 ≥ 0.55). 터진 용기는 0 */
export function vesselLevel(s: Scene, p: Prop): number {
  if (!p.vessel || p.exploded) return 0;
  const h = p.heatLoad ?? 0;
  if (h >= CAT.VENT_AT) return 3;
  return h >= SIGN.VESSEL_HEAT2 && vesselNear(s, p) >= SIGN.VESSEL_FIRE2 ? 2 : 0;
}
/** 용기를 부르는 이름 (가스 용기 · 드럼통 · CNG 용기 · 항공유 탱크) */
export function vesselName(p: Prop): string {
  const v = p.vessel ?? vesselKind(p);
  return v === 'drum' || p.skin === 'drum' ? '드럼통' : v === 'cng' ? 'CNG 용기' : v === 'jet' ? '항공유 탱크' : '가스 용기';
}

const LV_STRUCT = [1, 2, 3] as const, LV_VESSEL = [2, 3] as const, LV_BLDG = [2, 3] as const, LV_ROLL = [1, 2] as const, LV_DUST = [1] as const;
/**
 * 관찰·보고 규칙 (설계서 §3.1) — 사실 id 하나에 대해. 결과는 out 에 [보고할 단계(-1 = 없음), down(1), 새 관찰 단계(-1 = 그대로)].
 *   obs = 진실 단계(tl) 이하의 단계 가운데 그 단계를 알아채는 감각 조건(cond)이 지금 맞는 가장 높은 단계.
 *         진실이 가장 낮은 단계 아래(0)이고 가장 낮은 단계의 감각 조건이 맞으면 obs = 0. 어느 것도 맞지 않으면 관찰 없음.
 *   관찰이 없어도 진실보다 높은 단계의 감각 조건이 맞으면 "그 단계는 없다"는 것은 안다 — 그 단계 바로 아래를 상한(bound)으로 본다.
 *         소리 10칸의 임박 조짐이 멎은 것을 구역 밖에서 듣는 경우다 (§5.7 "단계 3 의 감각은 소리 10칸이라 구역 밖에서 확인할 수 있다").
 *   비교는 자기 감각으로 마지막에 관찰한 단계(prev = a.signObs[id])와 한다(전달받은 믿음과 견주지 않는다): 올라가면 보고,
 *   내려갔고 prev 단계의 감각 조건이 지금 맞으면 down(확인된 하향)으로 보고, 그 밖은 보고하지 않는다.
 * cond[l] = 단계 l 의 감각 조건이 지금 맞는가 (매 대원·매 판단마다 도는 길이라 함수를 만들지 않고 배열로 받는다)
 * gone = 그 대상이 이제 없다 (무너진 구획 · 터진 용기): 어느 단계의 감각 조건이든 맞으면 "없다"(0)를 본다 — 상한 하향(bound)을 쓰지 않는다.
 *   (검토에서 고침) 터진 용기를 7칸 안에서 듣던 대원이 "안전밸브 소리 멎음 — 불길은 아직 닿아 있음"(단계 2, down)을 보고해 폭발 소리의 단계 0 을 덮고,
 *   지휘관이 터진 용기 둘레에 진입 금지 구역을 끝까지 남겼다
 */
function judge(tl: number, prev: number | undefined, levels: readonly number[], cond: readonly boolean[], out: number[], gone = false): void {
  out[0] = -1; out[1] = 0; out[2] = -1;
  if (gone) {
    let any = false;
    for (let k = 0; k < levels.length; k++) if (cond[levels[k]]) { any = true; break; }
    if (!any) return;
    if (prev !== undefined && prev > 0) { out[0] = 0; out[1] = 1; }
    out[2] = 0;
    return;
  }
  let ob = -1;
  for (let k = levels.length - 1; k >= 0; k--) { const l = levels[k]; if (l <= tl && cond[l]) { ob = l; break; } }
  if (ob < 0 && tl < levels[0] && cond[levels[0]]) ob = 0;
  if (ob >= 0) {
    if (ob > (prev ?? 0)) out[0] = ob;
    else if (prev !== undefined && ob < prev && cond[prev]) { out[0] = ob; out[1] = 1; }
    out[2] = ob;
    return;
  }
  if (prev === undefined) return;
  for (let k = 0; k < levels.length; k++) {
    const l = levels[k];
    if (l <= tl || !cond[l]) continue;
    const bound = k > 0 ? levels[k - 1] : 0;
    if (prev > bound) { out[0] = bound; out[1] = 1; out[2] = bound; }
    return;
  }
}
const JUDGE: number[] = [-1, 0, -1];
const COND: boolean[] = [false, false, false, false];
const ALL: readonly boolean[] = [true, true, true, true];
const READ: number[] = [];      // 가스 측정기가 읽는 구획 (다시 쓰는 버퍼)
/** 조짐 사실 하나를 배운다 (새 소식이면 보고 대기열에 — learn) */
function reportSign(sim: Sim, a: FieldAgent, me: string, id: number, val: SignBelief, text: string, verified = true): void {
  learn(sim, a, mkFact('sign', id, val, me, sim.t, 1, verified, text));
}
function setObs(a: FieldAgent, id: number, lv: number): void { (a.signObs ?? (a.signObs = {}))[id] = lv; }

/** 칸이 든 구역 (구역이 없는 실내 칸 — 문턱 — 이면 맞닿은 실내 구역) */
function regionAtTile(s: Scene, i: number): number {
  const r = s.region[i];
  if (r >= 0) return r;
  if (!isIndoor(s.tiles[i])) return -1;
  const w = s.w, x = i % w, reg = s.region, regs = s.regions;
  if (x + 1 < w && reg[i + 1] >= 0 && regs[reg[i + 1]].indoor) return reg[i + 1];
  if (x > 0 && reg[i - 1] >= 0 && regs[reg[i - 1]].indoor) return reg[i - 1];
  if (i + w < reg.length && reg[i + w] >= 0 && regs[reg[i + w]].indoor) return reg[i + w];
  if (i >= w && reg[i - w] >= 0 && regs[reg[i - w]].indoor) return reg[i - w];
  return -1;
}
/** 그 구획 칸 가운데 within 칸 안이고 시야 안인 칸이 SEE_SHARE 몫 이상인가 (구조 2 의 눈 — 일부만 보고 판단하지 않는다) */
function seesRegion(s: Scene, a: FieldAgent, reg: Region, within: number): boolean {
  if (reg.x0 - a.x > within || a.x - reg.x1 > within || reg.y0 - a.y > within || a.y - reg.y1 > within) return false;
  const tl = reg.tiles, w = s.w, need = Math.max(1, Math.ceil(SIGN.SEE_SHARE * tl.length));
  let n = 0;
  for (let q = 0; q < tl.length; q++) {
    const i = tl[q], x = i % w, y = (i / w) | 0;
    if (dist(a.x, a.y, x, y) > within || !los(s, a.x, a.y, x, y)) continue;
    if (++n >= need) return true;
  }
  return false;
}
/**
 * 불에 달궈진 구획인가 (열화상의 문턱 효과): 불 0.3 이상인 칸이 있거나 이미 탄 칸이 있다. 탄 칸을 함께 보는 것은
 * 불이 옮겨 다니며 그 구획을 떠났다 돌아올 때마다 열화상 대원의 문턱이 0.7 ↔ 0.6 으로 바뀌어 "삐걱임 ↔ 이상 없음"을 되풀이하지 않게 하려는 것이다
 * (달궈진 골조는 불이 잠시 비켜도 식지 않는다)
 */
function regionBurning(s: Scene, reg: Region): boolean {
  const tl = reg.tiles, f = s.fire, b = s.burned;
  for (let q = 0; q < tl.length; q++) if (f[tl[q]] >= 0.3 || b[tl[q]]) return true;
  return false;
}
const SHELL = new WeakMap<Scene, Int32Array>();
/** 바깥벽 칸(footprint 2)의 목록 — 처음 생김새로 한 번 */
function shellTiles(s: Scene): Int32Array {
  let l = SHELL.get(s);
  if (l) return l;
  const f = footprint(s), out: number[] = [];
  for (let i = 0; i < f.length; i++) if (f[i] === FOOT_SHELL) out.push(i);
  l = Int32Array.from(out);
  SHELL.set(s, l);
  return l;
}
/** 바깥벽 칸이 within 칸 안·시야 안에 need 개 이상 보이는가 */
function seesShell(s: Scene, a: FieldAgent, within: number, need: number): boolean {
  const l = shellTiles(s), w = s.w;
  let n = 0;
  for (let q = 0; q < l.length; q++) {
    const i = l[q], x = i % w, y = (i / w) | 0;
    if (dist(a.x, a.y, x, y) > within || !los(s, a.x, a.y, x, y)) continue;
    if (++n >= need) return true;
  }
  return false;
}
/** 그 구획에 맞닿은 바깥벽이 보이는가 (밖에서 듣는 임박 조짐을 '외벽 균열'로 부른다) */
function seesRegionShell(s: Scene, a: FieldAgent, reg: Region, within: number): boolean {
  const f = footprint(s), w = s.w, h = s.h, tl = reg.tiles;
  for (let q = 0; q < tl.length; q++) {
    const i = tl[q], x = i % w, y = (i / w) | 0;
    for (let d = 0; d < 4; d++) {
      const xx = x + (d === 0 ? 1 : d === 1 ? -1 : 0), yy = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      if (f[yy * w + xx] === FOOT_SHELL && dist(a.x, a.y, xx, yy) <= within && los(s, a.x, a.y, xx, yy)) return true;
    }
  }
  return false;
}
/** 건물 가운데 (실내 구획 가운데들의 평균) */
function bldgCenter(s: Scene): [number, number] {
  let x = 0, y = 0, n = 0;
  for (const r of s.regions) if (r.indoor) { x += r.cx; y += r.cy; n++; }
  return n ? [Math.round(x / n), Math.round(y / n)] : [-1, -1];
}

function structText(name: string, level: number, down: boolean, outside: boolean): string {
  if (down) return level >= 2 ? `${name} 붕괴 임박 징후 멎음 — 균열·처짐은 남아 있음` : level === 1 ? `${name} 균열·처짐 보이지 않음` : `${name} 구조 이상 징후 없음`;
  return level >= 3 ? (outside ? `${name} 외벽 균열 — 붕괴 임박!` : `${name} 굉음 — 천장이 내려앉고 있음, 붕괴 임박!`) : level === 2 ? `${name} 천장 균열·처짐 — 붕괴 위험` : `${name} 천장에서 삐걱이는 소리 — 구조 약화 조짐`;
}
function vesselText(p: Prop, where: string, level: number, down: boolean): string {
  const nm = vesselName(p), drum = nm === '드럼통';
  if (down) return level >= 2 ? `${where} ${nm} ${drum ? '부풀음이 가라앉음' : '안전밸브 소리 멎음'} — 불길은 아직 닿아 있음` : `${where} ${nm} 열기 가라앉음`;
  if (level >= 3) return drum ? `${where} 드럼통이 부풀어 오름 — 파열 임박!` : `${where} 안전밸브 작동음 — ${nm} 폭발 임박!`;
  return p.vessel === 'cng' ? 'CNG 용기 쪽으로 불길이 번짐 — 냉각 필요' : p.vessel === 'jet' ? '동체 연료 탱크 쪽으로 불길이 번짐 — 냉각 필요' : drum ? `${where} 드럼통이 불길에 휩싸임 — 냉각 필요` : `${where} 가스 용기가 불길에 직접 노출 — 냉각 필요`;
}
function bldgText(level: number, down: boolean): string {
  if (down) return level >= 2 ? '건물 기울어짐이 멈춤 — 외벽 균열은 남아 있음' : '건물 외벽 이상 없음';
  return level >= 3 ? '건물 외벽 균열이 번지고 기울어짐 — 전체 붕괴 임박!' : '건물 외벽 균열이 번지고 기울어짐 — 전체 붕괴 위험';
}

/**
 * 조짐을 본다 (agents.perceive 가 소품 반복문 뒤에 부른다 — 진실을 읽어도 되는 자리). 설계서 §3.1·§3.3.
 *   struct: 구획별 건전도 → 삐걱임(소리 — 그 구획·이웃 구획 안, 6칸) · 균열·처짐(눈 — 4칸 안 시야 30%) · 임박(소리 — 10칸, 벽 너머도)
 *   gas:    구획별 가스 최댓값 → 측정기를 든 대원이 그 구획 칸이나 문턱에 서면 단계와 % LEL. 측정기가 없으면 자기 칸의 냄새로 단계 1만(미확인)
 *   vessel: 용기의 열 → 불길에 직접 노출(눈 — 4칸 시야) · 안전밸브(소리 — 7칸, 벽 너머도)
 *   bldg:   건물 건전도·무너진 몫 → 건물 바깥 칸에서 바깥벽 칸이 셋 이상 보이면 (지휘관의 7초 외부 관찰에서도 같은 함수가 돈다)
 * 상공의 관측자는 소리를 듣지 못하고 지붕 밑을 보지 못한다 — 조짐을 보지 않는다. 외부 관찰(throughWalls)이라고 감각이 달라지지는 않는다:
 * 소리는 원래 벽을 넘고, 눈의 조건은 시야선을 본다(외부 관찰이 벽 너머로 보는 것은 불뿐이다).
 */
export function perceiveSigns(sim: Sim, s: Scene, a: FieldAgent, v: number): void {
  if (a.aloft) return;
  const c = s.cat ?? catOf(sim, s);
  if (!c) return;
  // 이 함수는 모든 대원의 판단마다 돈다: 대부분의 구획·용기는 알 것이 없으므로 값싸게 거르고, 함수(클로저)를 만들지 않는다
  const obs = a.signObs, regs = s.regions, R = regs.length, o = JUDGE, cond = COND;
  const rsp = sim.responders[a.rid], me = rsp.name, jb = 2 * (rsp.judgment - 0.5);
  const ai = tileOf(s, a.x, a.y), ar = regionAtTile(s, ai), outsideMe = c.foot[ai] === 0 && !isIndoor(s.tiles[ai]);
  // ── 구조 (구획) ──
  if (c.struct) {
    let minInteg = 1, anyFallen = false, tic = -1;      // 열화상: 처음 필요할 때 한 번 본다 (kitLive — 드러내지 않는다. 드러나는 자리는 perceive 의 연기 속 한 곳)
    for (let r = 0; r < R; r++) {
      const reg = regs[r];
      if (!reg.indoor) continue;
      if (c.fallen[r]) anyFallen = true; else if (c.integ[r] < minInteg) minInteg = c.integ[r];
      const id = SIGN_BASE.struct + r, prev = obs ? obs[id] : undefined, had = prev !== undefined && prev > 0;
      if (c.integ[r] >= SIGN.TIC_L1 && !had) continue;      // 열화상으로도 단계 0 이고 전에 본 것도 없다 — 알 것이 없다
      let ticOn = false;
      if (c.integ[r] < SIGN.TIC_L1 && !c.fallen[r]) {
        if (tic < 0) tic = kitLive(sim, a.rid, 'tic') ? 1 : 0;
        ticOn = tic === 1 && regionBurning(s, reg);
      }
      const tl = structLevel(c, r, ticOn);
      if (tl === 0 && !had) continue;
      const d = dist(a.x, a.y, reg.cx, reg.cy);
      cond[1] = (ar === r || (ar >= 0 && regionNbrs(s)[r].indexOf(ar) >= 0)) && d <= SIGN.HEAR_CREAK + jb;
      cond[3] = d <= SIGN.HEAR_RUMBLE + jb;
      // 눈(2)은 단계 2 가 있거나 전에 2 이상을 보았을 때만 본다 — 그 밖에는 판정에 쓰이지 않는다(judge 의 주석)
      cond[2] = (tl >= 2 || (prev !== undefined && prev >= 2)) && seesRegion(s, a, reg, SIGN.SEE_CRACK + jb);
      judge(tl, prev, LV_STRUCT, cond, o, c.fallen[r] === 1);
      if (o[2] >= 0) setObs(a, id, o[2]);
      if (o[0] < 0) continue;
      const lv = o[0], down = o[1] === 1;
      const outside = lv >= 3 && !down && outsideMe && seesRegionShell(s, a, reg, SIGN.HEAR_RUMBLE + jb);
      reportSign(sim, a, me, id, { kind: 'struct', level: lv, region: r, x: reg.cx, y: reg.cy, down: down || undefined }, down && c.fallen[r] ? fallenText(reg.name) : structText(reg.name, lv, down, outside));
    }
    // ── 건물 전체 ── (무너진 구획이 없고 모든 구획이 0.5 이상이면 건물 건전도도 0.5 이상 — 단계 0)
    const id = SIGN_BASE.bldg, prev = obs ? obs[id] : undefined;
    const tl = !anyFallen && minInteg >= CAT.BLDG_L2 ? 0 : bldgLevel(c, s);
    if (tl > 0 || (prev !== undefined && prev > 0)) {
      cond[2] = cond[3] = outsideMe && seesShell(s, a, v, SIGN.SEE_SHELL);
      judge(tl, prev, LV_BLDG, cond, o);
      if (o[2] >= 0) setObs(a, id, o[2]);
      if (o[0] >= 0) {
        const [bx, by] = bldgCenter(s), down = o[1] === 1;
        reportSign(sim, a, me, id, { kind: 'bldg', level: o[0], region: -1, x: bx, y: by, down: down || undefined }, c.totalAt >= 0 ? '건물 전체 붕괴 — 잔해 더미' : bldgText(o[0], down));
      }
      // (단계 6) 이미 무너진 건물: 무너지는 소리를 듣지 못한 대원(늦게 닿은 부대·그때 음영 구역에 있던 대원)도 잔해 더미를 보면(바깥벽 셋 이상이 보이거나 잔해 위에 서 있으면)
      // 그 사건(전체 붕괴)을 안다 — 지휘 규칙의 잔해 수색 국면(§6.1)이 이 사실을 읽는다. 시각은 본 때다 (언제 무너졌는지는 모른다)
      const tf = c.totalAt >= 0 ? TOTAL_EV.get(c) : undefined;
      if (tf && (cond[2] || c.foot[ai] >= FOOT_IN) && !a.beliefs.get('sign', tf.id)) learn(sim, a, mkFact('sign', tf.id, tf.value, me, sim.t, 1, true, '건물이 무너져 있음 — 잔해 더미'));
    }
  }
  // ── 가스 (구획) ──
  if (c.gas) {
    const ti = s.tiles[ai], w = s.w, x = ai % w, reg = s.region, read = READ;
    // 읽는 구획: 서 있는 구획, 그리고 문·바닥 칸에 서 있으면 4 이웃 칸의 구획 (문턱에서 그 구획을 한 번 훑은 값)
    read.length = 0;
    const cand0 = reg[ai], cand1 = ti === T.DOOR || ti === T.FLOOR;
    for (let k = 0; k < 5; k++) {
      const rr = k === 0 ? cand0 : !cand1 ? -1 : k === 1 ? (x + 1 < w ? reg[ai + 1] : -1) : k === 2 ? (x > 0 ? reg[ai - 1] : -1) : k === 3 ? (ai + w < reg.length ? reg[ai + w] : -1) : ai >= w ? reg[ai - w] : -1;
      if (rr >= 0 && regs[rr].indoor && read.indexOf(rr) < 0) read.push(rr);
    }
    let meter = hasKit(sim, a.rid, 'gasMeter');
    if (meter && read.length && !kitWorks(sim, a.rid, 'gasMeter', sim.incidents[s.incidentId])) meter = false;      // 값을 읽을 때 숨은 고장이 드러난다 (R1 — 효과의 자리)
    if (meter) {
      for (let k = 0; k < read.length; k++) {
        const rr = read[k], id = SIGN_BASE.gas + rr, prev = obs ? obs[id] : undefined;
        const g = gasReading(c, s, rr);
        judge(g.level, prev, LV_STRUCT, ALL, o);      // 측정기는 모든 단계의 감각 조건이 같다(지금 맞다) — 내려간 값도 확인된 하향이다
        setObs(a, id, g.level);
        const cur = o[0] < 0 ? a.beliefs.val<SignBelief>('sign', id) : undefined;
        // 같은 단계: 측정값(lel)만 바뀌었으면 믿음에 합치되 보고하지 않는다 (significant 가 단계만 본다)
        if (o[0] < 0 && !(cur && cur.level === g.level && cur.lel !== g.lel)) continue;
        const rg = regs[rr], down = o[1] === 1;
        const text = down && g.level === 0 ? `${rg.name} 가스 농도 LEL ${g.lel}% — 위험 수준 아래` : `${rg.name} 가스 농도 LEL ${g.lel}%`;
        reportSign(sim, a, me, id, { kind: 'gas', level: g.level, region: rr, x: rg.cx, y: rg.cy, lel: g.lel, down: down || undefined }, text);
      }
    } else if (ar >= 0 && c.gas[ai] >= SIGN.GAS_L1) {
      // 냄새: 자기 칸의 가스가 단계 1 문턱을 넘으면 단계 1 만 (측정값 없음 · 미확인 — 측정값을 덮지 않는다 · 하향 보고도 없다)
      const id = SIGN_BASE.gas + ar, prev = obs ? obs[id] : undefined;
      if (prev === undefined || prev < 1) {
        setObs(a, id, 1);
        const rg = regs[ar];
        reportSign(sim, a, me, id, { kind: 'gas', level: 1, region: ar, x: rg.cx, y: rg.cy }, `${rg.name} 가스 냄새`, false);
      }
    }
  }
  // ── 용기 ──
  const wk = WORK.get(c);
  if (wk) {
    syncProps(s, wk);
    const vs = wk.vessels;
    for (let k = 0; k < vs.length; k++) {
      const p = vs[k];
      if (p.removed) continue;
      const id = SIGN_BASE.vessel + p.id, prev = obs ? obs[id] : undefined, had = prev !== undefined && prev > 0;
      if ((p.exploded || (p.heatLoad ?? 0) < SIGN.VESSEL_HEAT2) && !had) continue;
      const tl = vesselLevel(s, p);
      if (tl === 0 && !had) continue;
      // 차량은 차체의 가장 가까운 칸까지
      const nx = Math.max(p.x, Math.min(p.x + p.w - 1, Math.round(a.x))), ny = Math.max(p.y, Math.min(p.y + p.h - 1, Math.round(a.y)));
      const d = dist(a.x, a.y, nx, ny);
      cond[3] = d <= SIGN.HEAR_VENT + jb;
      cond[2] = d <= SIGN.SEE_VESSEL + jb && los(s, a.x, a.y, nx, ny);
      judge(tl, prev, LV_VESSEL, cond, o, !!p.exploded);
      if (o[2] >= 0) setObs(a, id, o[2]);
      if (o[0] < 0) continue;
      const down = o[1] === 1, where = regionNameAt(s, p.x, p.y);
      reportSign(sim, a, me, id, { kind: 'vessel', level: o[0], region: regionOfProp(s, p), x: p.x, y: p.y, prop: p.id, down: down || undefined }, p.exploded ? `${where} ${vesselName(p)} 폭발 — 더는 위험 없음` : vesselText(p, where, o[0], down));
    }
    // ── (단계 9, 선택) 롤오버 (방) ── 진실 단계는 플래시오버 단계가 매초 적어 둔 값 (켜지 않으면 늘 0 — 알 것이 없다)
    const rl = wk.rollLv;
    if (wk.rollOn || obs) for (let r = 0; r < R; r++) {
      const tl = rl[r], id = SIGN_BASE.fire + r, prev = obs ? obs[id] : undefined;
      if (tl === 0 && !(prev !== undefined && prev > 0)) continue;
      const reg = regs[r];
      cond[1] = cond[2] = seesRegion(s, a, reg, SIGN.SEE_ROLL + jb);
      judge(tl, prev, LV_ROLL, cond, o);
      if (o[2] >= 0) setObs(a, id, o[2]);
      if (o[0] < 0) continue;
      const down = o[1] === 1;
      reportSign(sim, a, me, id, { kind: 'fire', level: o[0], region: r, x: reg.cx, y: reg.cy, down: down || undefined }, rollText(reg.name, o[0], down));
    }
  }
  // ── (단계 9, 선택) 분진 ── 분진 구획이 있을 때만 (터진 뒤에는 단계 0 — 본 적이 있으면 하향)
  if (c.dustRegion >= 0) {
    const r = c.dustRegion, reg = regs[r], id = SIGN_BASE.dust + r, prev = obs ? obs[id] : undefined;
    const tl = c.dustDone ? 0 : 1;
    if (reg && (tl > 0 || (prev !== undefined && prev > 0))) {
      cond[1] = seesRegion(s, a, reg, SIGN.SEE_DUST + jb);
      judge(tl, prev, LV_DUST, cond, o);
      if (o[2] >= 0) setObs(a, id, o[2]);
      if (o[0] >= 0) reportSign(sim, a, me, id, { kind: 'dust', level: o[0], region: r, x: reg.cx, y: reg.cy, down: o[1] === 1 || undefined },
        o[0] >= 1 ? `${reg.name} 분진이 두껍게 쌓여 있음 — 분진 폭발 위험` : `${reg.name} 분진 폭발 — 남은 분진 없음`);
    }
  }
}
/** (단계 9) 방의 롤오버 조짐 진실 단계 0·1·2 (읽기 함수 — 관찰자 시점 그림이 부른다. 플래시오버를 켜지 않으면 늘 0) */
export function rollLevel(c: CatState, r: number): number { const w = WORK.get(c); return w ? w.rollLv[r] ?? 0 : 0; }
/** 롤오버 조짐 문구 (§3.1 표의 fire 줄) */
function rollText(name: string, level: number, down: boolean): string {
  if (level >= 2) return `${name} 천장 연기층에 불꽃(롤오버) — 플래시오버 임박`;
  if (level === 1) return down ? `${name} 롤오버 징후 가라앉음 — 짙은 연기는 남아 있음` : `${name} 짙은 검은 연기가 맥동하며 뿜어 나옴`;
  return `${name} 롤오버 징후 없음`;
}

// ───────────────────────── (단계 7) 판정·보고서·지도 — 설계서 §6.5·§6.6·§7.1 ─────────────────────────
// 판정(debrief.evaluate)이 부른다 — 진실로 판정한다. 위험 상태는 만들지 않고 읽기만 한다(s.cat 이 없는 현장은 예전 식 그대로):
// 세계 규칙이 사건이 열려 있는 동안 매 틱 catOf 를 부르므로 대상 현장에는 이미 있다. 판정 자리에서 catOf 를 부르면 드럼통을 놓는 등 현장을 바꿀 수 있다.

/** X6 가 남긴 폭발 기록의 상세 (HIDDEN_HAZARD 가운데 X6 의 것을 가린다 — 측정 도구·시험과 같은 글귀) */
export const X6_BOOM_DETAIL = /^(누출된 가스 폭발 — |보관 중이던 가스 용기 폭발$|화학 드럼 파열$|CNG 버스 가스 용기 폭발$|항공유 폭발$|분진 폭발)/;

/**
 * 재산 피해 (§6.5): 전소·전체 붕괴 = 1. 그 밖은 max(탄 비율, 사건 중에 무너진 칸의 몫 × 1.2, 폭발이 있었으면 0.3) — 화재가 아니면 불붙은 소품 0.4 도 (예전 식).
 * 탄 비율은 화재 유형이면 지금처럼 탄 칸 / 탈 수 있는 칸, 그 밖의 유형은 실제 건물(c.struct)이면 건물 칸의 탄 비율, 아니면 0. 상한 1.
 * 화재 유형에서 X6 일이 없었으면 예전 식(탄 비율)과 같다. 위험 상태가 없는 현장은 예전 식 그대로
 */
export function propertyLossOf(s: Scene): number {
  const fire = s.kind === 'fire';
  const old = fire ? s.burnedTiles / Math.max(1, s.totalFuelTiles) : s.props.some((p) => p.ignited) ? 0.4 : 0;
  const c = s.cat;
  if (!c) return old;
  if (c.burntAt >= 0 || c.totalAt >= 0) return 1;
  const burn = fire ? s.burnedTiles / Math.max(1, s.totalFuelTiles) : c.struct ? burnFracOf(c, s) : 0;
  const ruin = c.struct ? ruinFracOf(c, s) * 1.2 : 0;
  const boom = c.gasN + c.vesselN + c.dustN > 0 ? 0.3 : 0;
  const ign = !fire && s.props.some((p) => p.ignited) ? 0.4 : 0;
  return Math.min(1, Math.max(burn, ruin, boom, ign));
}

/** 위험이 남았는가 (§6.5 — debrief.evaluate 의 hazardActive 에 더한다): 서 있는 건물의 보강하지 않은 균열 · 열 0.3 이상이고 곁에 불이 있는 용기 · 폭발 하한 구름(가스 ≥ 1 칸) */
export function catHazardActive(s: Scene): boolean {
  const c = s.cat;
  if (!c) return false;
  for (const p of s.props) {
    if (p.removed) continue;
    if (p.kind === 'unstable' && !p.mitigated && c.struct && c.totalAt < 0) return true;
    if (p.vessel && !p.exploded && (p.heatLoad ?? 0) >= 0.3 && vesselNear(s, p) >= 0.1) return true;
  }
  if (c.gas) { const g = c.gas; for (let i = 0; i < g.length; i++) if (g[i] >= CAT.LEL) return true; }
  return false;
}

/**
 * 사건 결과의 위험의 현실화 요약 (IncidentResult.catastrophe — §6.5): 전소·전체 붕괴 · 구획 붕괴 수 · 폭발 수 · 철수했는가 · 막아 낸 조짐(DANGER_SIGN 복구) ·
 * 휘말린 대원 (붕괴·폭발 기록이 원인인 RESPONDER_HURT ∪ RESPONDER_KILLED 의 대원 수 — 숨진 대원은 순직 기록만 남을 수 있어 합쳐 센다) · 위험이 남았는가(판정의 값).
 * 위험 상태도 지휘 상태도 없는 현장은 undefined
 */
export function catSummary(sim: Sim, s: Scene, I: Incident, hazard: boolean): NonNullable<IncidentResult['catastrophe']> | undefined {
  const c = s.cat;
  if (!c && !s.ops) return undefined;
  let partial = 0, withdrew = false, averted = 0;
  const x6 = new Set<number>();
  for (const p of I.problems) {
    if (p.code === 'STRUCT_COLLAPSE') { x6.add(p.eventId); if (!p.detail.startsWith('건물 전체 붕괴')) partial++; }
    else if (p.code === 'EXPLOSION' || (p.code === 'HIDDEN_HAZARD' && X6_BOOM_DETAIL.test(p.detail))) x6.add(p.eventId);
    else if (p.code === 'WITHDRAWAL') withdrew = true;
    else if (p.code === 'DANGER_SIGN' && p.recovered) averted++;
  }
  const caught = new Set<number>();
  if (x6.size) for (const e of sim.events) {
    if (e.incidentId !== I.id || e.rid < 0 || (e.problem !== 'RESPONDER_HURT' && e.problem !== 'RESPONDER_KILLED')) continue;
    for (const k of e.causes) if (x6.has(k)) { caught.add(e.rid); break; }
  }
  return { burnout: !!c && c.burntAt >= 0, total: !!c && c.totalAt >= 0, partial, explosions: c ? c.gasN + c.vesselN + c.dustN : 0, withdrew, averted, crewCaught: caught.size, hazard };
}

/** 사건이 닫힐 때 (§7.1 — incidents.closeIncident 끝): 실제 건물의 화재가 닫혔고 건물 상태가 아직 없는데 탄 비율이 0.15 이상이면 '그을린 건물' */
export function noteClosedPlace(sim: Sim, I: Incident): void {
  if (I.truth.type !== 'fire' || I.truth.placeId < 0) return;
  const s = sim.scenes[I.id], c = s ? s.cat : undefined;
  if (!s || !c || !c.struct) return;
  const pm = sim.placeMarks.get(I.truth.placeId);
  if (pm && pm.incidentId === I.id) return;
  if (burnFracOf(c, s) >= 0.15) markPlace(sim, s, I, c, 'scorched');
}
