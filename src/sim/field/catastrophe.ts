// 위험의 현실화 (설계서 X6): 위험 상태(Scene.cat — 진실)와 그것이 실제로 일으키는 일.
// 이 파일은 "세계"의 규칙이다 (hazards.ts·damage.ts 와 같은 자격: 진실을 읽고 바꾼다). 지휘관·대원의 판단부·관제는 이 파일을 부르지 않고
// s.cat 을 읽지 않는다 — 조짐(sign 사실)으로만 안다.
//
// ── 단계 1 (상태만) ──────────────────────────────────────────────────────────────────────────────
// 지금은 **계산만 한다**: 구조 건전도·가스 격자·용기의 열·전소 비율을 Scene.cat 과 소품의 X6 칸(vessel·heatK·heatLoad)에 적을 뿐,
// 타일·불·연기·사람·소품의 다른 칸·기록·작업판을 하나도 바꾸지 않는다. 그래서 결과(기록 해시)는 이 파일이 없을 때와 한 글자도 같다.
// 예전 규칙(tickFire 의 천장 붕괴·가스 용기 폭발, tickGas 의 폭발 판정)은 그대로 돈다 — 여기 숫자는 아직 그림자다.
// 뒤 단계가 채울 자리는 catTick 의 번호 주석에 적었다:
//   단계 2  perceiveSigns(+ structLevel·gasReading·vesselLevel) — 조짐이 사실로 들어온다
//   단계 3  구획·전체 붕괴(collapseRegion·collapseBuilding), 전소 기록, catOnBlast, placeMarks, 신호
//   단계 4  가스 폭발(explodeGas)·용기 폭발(ruptureVessel), 드럼통, 차량 누출의 불 점화, 도시가스 차단
// 난수: 한 번만 정하는 준비는 catinit:<현장 id>, 실행 중 판정은 cat:<현장 id> (damage.ts 의 dmg: 와 같은 방식). s.rng·a.rng·sim.rng 를 부르지 않는다.

import type { Sim } from '../engine';
import type { Rng } from '../rng';
import { T } from '../types';
import type { CatState, Incident, Prop, Scene } from '../types';
import { doorAt, isIndoor } from './grid';
import { footprint, regionNbrs } from './ops';

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
