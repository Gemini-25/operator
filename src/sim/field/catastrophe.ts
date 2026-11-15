// 위험의 현실화 (설계서 X6): 위험 상태(Scene.cat — 진실)와 그것이 실제로 일으키는 일.
// 이 파일은 "세계"의 규칙이다 (hazards.ts·damage.ts 와 같은 자격: 진실을 읽고 바꾼다). 지휘관·대원의 판단부·관제는 이 파일을 부르지 않고
// s.cat 을 읽지 않는다 — 조짐(sign 사실)으로만 안다.
//
// ── 단계 1 (상태만) · 단계 2 (조짐) ──────────────────────────────────────────────────────────────
// 세계 쪽은 아직 **계산만 한다**: 구조 건전도·가스 격자·용기의 열·전소 비율을 Scene.cat 과 소품의 X6 칸(vessel·heatK·heatLoad)에 적을 뿐,
// 타일·불·연기·사람·소품의 다른 칸·기록·작업판을 하나도 바꾸지 않는다.
// 예전 규칙(tickFire 의 천장 붕괴·가스 용기 폭발, tickGas 의 폭발 판정)은 그대로 돈다 — 여기 숫자는 아직 그림자다.
// 단계 2 부터 대원이 그 값을 **조짐**으로 알아챈다(perceiveSigns — agents.perceive 가 부른다): 고정 문턱으로 정한 단계를 감각 범위 안에서만 sign 사실로 배운다.
// 그래서 무전 문구(기록)는 바뀌지만, 아직 아무도 그 사실로 판단하지 않는다(지휘 규칙은 단계 5).
// 뒤 단계가 채울 자리는 catTick 의 번호 주석에 적었다:
//   단계 3  구획·전체 붕괴(collapseRegion·collapseBuilding), 전소 기록, catOnBlast, placeMarks, 신호
//   단계 4  가스 폭발(explodeGas)·용기 폭발(ruptureVessel), 드럼통, 차량 누출의 불 점화, 도시가스 차단
// 난수: 한 번만 정하는 준비는 catinit:<현장 id>, 실행 중 판정은 cat:<현장 id> (damage.ts 의 dmg: 와 같은 방식). s.rng·a.rng·sim.rng 를 부르지 않는다.

import type { Sim } from '../engine';
import type { Rng } from '../rng';
import { T } from '../types';
import type { CatState, FieldAgent, Incident, Prop, Region, Scene, SignBelief } from '../types';
import { dist } from '../util';
import { hasKit, kitLive, kitWorks } from '../crews';
import { learn, regionNameAt } from './agents';
import { mkFact } from './beliefs';
import { doorAt, isIndoor, los, tileOf } from './grid';
import { FOOT_SHELL, SIGN_BASE, footprint, regionNbrs } from './ops';

/** 균형 상수 — 모두 시작값이다 (설계서 §2.9). 균형 단계(8)가 §8.4 의 순서로 맞춘다 */
export const CAT = {
  K_HEAT: 0.0025,                 // 불 세기 1 의 구획이 초당 잃는 건전도
  K_BURN: 1.0,                    // 탄 몫 1 당 상한 감소 (탄 골조는 다시 튼튼해지지 않는다)
  K_CREEP: 0.00035,               // 보강 안 된 균열 하나가 초당 깎는 양
  K_HIT_CRUSH: 0.5, K_HIT_BLAST: 0.8,      // blast 충격 배율 (단계 3 의 catOnBlast)
  L1: 0.6, L2: 0.45, L3: 0.36,    // 구조 조짐 단계: 삐걱임 · 균열·처짐 · 임박
  FALL_BASE: 0.01, FALL_SLOPE: 0.5, FALL_GRACE: 4,      // 구획 붕괴 초당 확률 BASE + SLOPE × (L3 − integ), 임박 조짐 뒤 최소 초 (단계 3)
  TOTAL_SHARE: 0.45, TOTAL_BLDG: 0.30,     // 전체 붕괴 문턱 = 건물 조짐 3 의 문턱 (둘은 늘 같이 움직인다)
  BLDG_L2: 0.5, BLDG_L2_SHARE: 0.25,       // 건물 조짐 2
  SHORE: 0.1,                     // 균열 하나를 보강하면 그 구획이 되찾는 건전도 (탄 몫 상한은 넘지 않는다)
  NBR_FALL: 0.12,                 // 이웃 구획이 무너지면 옮겨 오는 하중 (단계 3)
  QUAKE: 0.08, QUAKE_COLLAPSE: 0.18,       // 지진 흔들림 한 번: 그 밖의 현장 · 붕괴 유형
  INIT_COLLAPSE: 0.75, INIT_SEV: 0.05, INIT_NBR: 0.85, INIT_QUAKE: 0.9,      // 처음 값: 붕괴 현장의 무너진 구획(0.75 − 0.05 × 심각도)·그 이웃, 지진 중의 다른 구획
  GAS_SRC: 0.15, GAS_D: 0.12,     // 가스 원천 · 확산
  GAS_DOOR: 0.15, GAS_STAIR: 0.9, // 닫힌 문·계단 너머의 교환 배율
  GAS_SEEP: 0.004, GAS_VENT: 0.12, GAS_MAX: 3,      // 벽 틈으로 새는 몫 · 깨진 창과 열린 바깥문 곁의 환기 · 상한
  LEL: 1.0,                       // 폭발 하한
  CLOUD_MIN: 3,                   // 구름으로 치는 덩어리의 칸 수 (스파크의 나이를 재기 시작한다)
  SPARK_MAX: 0.012, SPARK_AGE: 90,         // 스파크 초당 상한 · 구름이 생긴 뒤 스파크가 다 커지기까지의 초 (단계 4)
  VESSEL_HEAT: { cylinder: 0.028, drum: 0.020, cng: 0.010, jet: 0.010 } as Record<string, number>,      // 용기 가열
  VESSEL_WET: 0.7, VESSEL_COOL: 0.05, VESSEL_IDLE: 0.012,      // 젖은 용기는 덜 달궈진다 · 물을 맞으면 식는다 · 불이 없으면 저절로 식는다
  VENT_AT: 0.55,                  // 안전밸브 소리(조짐 3)
  BURNOUT: 0.7, BURNOUT_MIN: 30,  // 전소 문턱 · 이보다 연료 칸이 적은 건물은 전소 판정을 하지 않는다
};
/** CatState.loss 의 원인 칸 (구획 × LOSS_N) */
export const LOSS_FIRE = 0, LOSS_BURN = 1, LOSS_CREEP = 2, LOSS_IMPACT = 3, LOSS_BLAST = 4, LOSS_QUAKE = 5, LOSS_N = 6;
/** 구조 규칙을 쓰지 않는 변형 (건물이 아니다). 용기·가스 규칙은 쓴다 */
export const NO_STRUCT = ['ship', 'plane', 'train', 'pileup', 'crane', 'landslide', 'elevator', 'wild'];

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
}
/** 소품 목록이 늘었으면 용기·균열·밸브를 다시 고른다 (소품은 지워지지 않고 끝에 붙기만 한다) */
function syncProps(s: Scene, w: CatWork): void {
  const props = s.props;
  if (props.length === w.propN) return;
  w.vessels.length = 0; w.cracks.length = 0; w.valves.length = 0;
  for (let k = 0; k < props.length; k++) {
    const p = props[k];
    if (p.vessel) w.vessels.push(p);
    else if (p.kind === 'unstable') w.cracks.push(p);
    else if (p.kind === 'valve') w.valves.push(p);
  }
  w.propN = props.length;
}
const WORK = new WeakMap<CatState, CatWork>();
const NONE = new WeakSet<Scene>();

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
  // (단계 4) 드럼통 놓기 — 여기, heatK 다음에. (단계 9) 분진 구획 — 그다음에
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
  }
  // 전소 비율의 분모: 건물 칸 위의 연료 칸 (이미 탄 칸도 연료가 있던 칸이다)
  const fuelMask = new Uint8Array(n);
  let fuel0 = 0;
  for (let i = 0; i < n; i++) if (foot[i] >= 1 && (s.fuel[i] > 0 || s.burned[i])) { fuelMask[i] = 1; fuel0++; }
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
    propN: -1, vessels: [], cracks: [], valves: [],
  });
  s.cat = c;
  return c;
}
const outside = (t: number): boolean => t === T.GROUND || t === T.ROAD || t === T.TREE || t === T.TRAIL;

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
      }
    }
    c.shakeSeen = nShake;
  }
  // 2) (단계 4) 도시가스 차단: s.ops.utilityAsked → c.utilityAt, 그 시각에 살아 있는 밸브를 모두 mitigated 로 + 차단 완료 사실
  // 3) 가스: 원천 → 확산 → 손실, 구름의 나이. (단계 4) 구름 + 점화원 → explodeGas
  if (c.gas) gasStep(sim, s, c, w);
  // 4) 용기의 열. (단계 4) heatLoad ≥ 1 → ruptureVessel, 차량 누출의 불 점화
  if (w.vessels.length) vesselStep(s, w);
  if (c.struct) {
    // 5) 구조: 구획별 손실, 보강 반영, 건물 건전도, 조짐 단계용 값
    structStep(sim, s, I, c, w);
    // 6) 전소 판정 — 지금은 시각만 적는다. (단계 3) 여기서 BURNOUT 기록·placeMarks·신호
    if (c.burntAt < 0 && c.fuel0 >= CAT.BURNOUT_MIN && s.burnedTiles > 0 && burnFracOf(c, s) >= CAT.BURNOUT) c.burntAt = sim.t;
  }
  // 7) (단계 3·4) 일어나는 일: 가스 폭발 → 용기 폭발 → (분진 폭발) → 구획 붕괴 → 전체 붕괴
  // 8) (단계 9, 선택) 플래시오버
  // 9) (단계 3) 지도 기록: Sim.placeMarks 의 탄 비율·잔해 비율
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
    if (lFire > 0) c.causeEv[r] = s.lastSpreadEvent >= 0 ? s.lastSpreadEvent : I.lastEvent;
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
function gasStep(sim: Sim, s: Scene, c: CatState, w: CatWork): void {
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
    if (!any) { c.cloudSince = -1; return; }      // 새는 밸브도 남은 가스도 없다
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
    if (v > CAT.GAS_MAX) v = CAT.GAS_MAX; else if (v < 1e-5) v = 0;
    g[i] = v;
    if (v > peak) peak = v;
  }
  // 구름의 나이: 폭발 하한을 넘은 칸이 CLOUD_MIN 개 이상 이어져 있는 동안. (단계 4) 여기서 구름마다 점화원을 본다
  const big = peak >= CAT.LEL ? gasClouds(c, s) : null;
  if (big && big.length && big[0].length >= CAT.CLOUD_MIN) { if (c.cloudSince < 0) c.cloudSince = sim.t; } else c.cloudSince = -1;
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

const LV_STRUCT = [1, 2, 3] as const, LV_VESSEL = [2, 3] as const, LV_BLDG = [2, 3] as const;
/**
 * 관찰·보고 규칙 (설계서 §3.1) — 사실 id 하나에 대해. 결과는 out 에 [보고할 단계(-1 = 없음), down(1), 새 관찰 단계(-1 = 그대로)].
 *   obs = 진실 단계(tl) 이하의 단계 가운데 그 단계를 알아채는 감각 조건(cond)이 지금 맞는 가장 높은 단계.
 *         진실이 가장 낮은 단계 아래(0)이고 가장 낮은 단계의 감각 조건이 맞으면 obs = 0. 어느 것도 맞지 않으면 관찰 없음.
 *   관찰이 없어도 진실보다 높은 단계의 감각 조건이 맞으면 "그 단계는 없다"는 것은 안다 — 그 단계 바로 아래를 상한(bound)으로 본다.
 *         소리 10칸의 임박 조짐이 멎은 것을 구역 밖에서 듣는 경우다 (§5.7 "단계 3 의 감각은 소리 10칸이라 구역 밖에서 확인할 수 있다").
 *   비교는 자기 감각으로 마지막에 관찰한 단계(prev = a.signObs[id])와 한다(전달받은 믿음과 견주지 않는다): 올라가면 보고,
 *   내려갔고 prev 단계의 감각 조건이 지금 맞으면 down(확인된 하향)으로 보고, 그 밖은 보고하지 않는다.
 * cond[l] = 단계 l 의 감각 조건이 지금 맞는가 (매 대원·매 판단마다 도는 길이라 함수를 만들지 않고 배열로 받는다)
 */
function judge(tl: number, prev: number | undefined, levels: readonly number[], cond: readonly boolean[], out: number[]): void {
  out[0] = -1; out[1] = 0; out[2] = -1;
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
      judge(tl, prev, LV_STRUCT, cond, o);
      if (o[2] >= 0) setObs(a, id, o[2]);
      if (o[0] < 0) continue;
      const lv = o[0], down = o[1] === 1;
      const outside = lv >= 3 && !down && outsideMe && seesRegionShell(s, a, reg, SIGN.HEAR_RUMBLE + jb);
      reportSign(sim, a, me, id, { kind: 'struct', level: lv, region: r, x: reg.cx, y: reg.cy, down: down || undefined }, structText(reg.name, lv, down, outside));
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
        reportSign(sim, a, me, id, { kind: 'bldg', level: o[0], region: -1, x: bx, y: by, down: down || undefined }, bldgText(o[0], down));
      }
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
      judge(tl, prev, LV_VESSEL, cond, o);
      if (o[2] >= 0) setObs(a, id, o[2]);
      if (o[0] < 0) continue;
      const down = o[1] === 1;
      reportSign(sim, a, me, id, { kind: 'vessel', level: o[0], region: regionOfProp(s, p), x: p.x, y: p.y, prop: p.id, down: down || undefined }, vesselText(p, regionNameAt(s, p.x, p.y), o[0], down));
    }
  }
}
