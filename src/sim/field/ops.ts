// 지휘 상태(Scene.ops)와 현장 생김새의 도움 함수 (설계서 X6 §2.4·§5).
// 이 파일은 **진실을 읽지 않는다**: s.cat·s.fire·s.props·s.casualties 를 보지 않고, 타일·구역·계단(생김새)과 지휘 상태만 읽는다.
// 그래서 세계 규칙(field/catastrophe.ts)과 지휘 쪽(지휘 규칙·대원의 판단부)이 같은 함수를 함께 쓸 수 있다.
//
// 단계 1 에는 생김새 도움 함수 둘만 있었다. 단계 2 가 조짐·지휘 상태 사실의 id 공간(SIGN_BASE·OPS_ID·OPS_PAR)과 지휘 상태 사실의 값(OpsFact)을 더했다.
// 단계 5 가 지휘 상태 쪽(newOps·zoneMask·zoneLevelAt·regionLevel·reachMask·gateBlocks·opsExterior·opsCordon·evacPoint·exteriorSpots)을 더했다.
// 잔해 수색 국면의 inRubble·isRubbleMode 는 단계 6 이 더한다.

import type { Sim } from '../engine';
import { T } from '../types';
import type { CasBelief, FieldAgent, MateBelief, NoGoZone, OpsState, Scene, WorkKind } from '../types';
import { dist } from '../util';
import { isIndoor, losWalls, staticPass } from './grid';
import type { WorkTarget } from './sceneRegistry';

/**
 * 조짐 사실('sign')의 id 공간 (설계서 §3.2). 구획 번호·소품 id 를 더해 쓴다:
 *   struct = 구획 번호(0~998) · gas = 1000 + 구획 번호 (신고로 만든 위치 모르는 가스 조짐은 gasUnknown 1999 — 1000 + (−1) 이 struct 공간과 겹치지 않게)
 *   vessel = 2000 + 소품 id · fire = 3000 + 구획 번호 · dust = 4000 + 구획 번호 · bldg = 5000 · 도시가스 차단 완료(event, what 'utility') = 5001 · event = 6000 + 사건 번호
 */
export const SIGN_BASE = { struct: 0, gas: 1000, gasUnknown: 1999, vessel: 2000, fire: 3000, dust: 4000, bldg: 5000, utility: 5001, event: 6000 } as const;
/** 지휘 상태 사실('ops')의 id: 0 = 전술 모드와 진입 금지 구역(지휘관이 보낸다), 100 + rid = 그 대원의 인원 점검 응답(철수를 마친 대원이 조용히 보낸다) */
export const OPS_ID = 0, OPS_PAR = 100;
/** 'ops' 사실 id 0 의 값 — 지휘관이 보내는 전술 모드와 진입 금지 구역 (구역의 기록·까닭·시각은 싣지 않는다). R3 의 doctrine.opsLevel 이 zones[].regions·level 을 읽는다 */
export interface OpsFact { mode: OpsState['mode']; zones: Pick<NoGoZone, 'key' | 'kind' | 'level' | 'regions' | 'x' | 'y' | 'r'>[]; t: number }
/** 'ops' 사실 id 100 + rid 의 값 — 인원 점검 응답 */
export interface ParFact { par: true; t: number }

/** footprint 의 값 */
export const FOOT_OUT = 0, FOOT_IN = 1, FOOT_SHELL = 2, FOOT_FLOOR_EDGE = 3;

const isWall = (t: number): boolean => t === T.WALL || t === T.WINDOW;
const isOutside = (t: number): boolean => t === T.GROUND || t === T.ROAD || t === T.TREE || t === T.TRAIL;

const FOOT = new WeakMap<Scene, Uint8Array>();
/**
 * 건물 칸 (칸별 0~3). **처음 부를 때의 생김새**로 한 번 계산해 둔다 — 무너져도 다시 계산하지 않는다(원래 모습).
 * 세계 규칙이 현장의 첫 틱에 부르므로(catOf) 원래 생김새가 들어간다.
 *   0 바깥
 *   1 건물 안: 실내 칸(바닥·문·가구·계단)과 그 8 이웃의 벽·창 (안쪽 벽)
 *   2 바깥벽: 그 벽·창 가운데 4 이웃에 바깥 칸(땅·도로·나무·산길)이 있는 것. 격자 밖과 맞닿은 벽도 바깥벽으로 본다
 *   3 층 경계: 4 이웃에 빈 공간(T.VOID)이 있는 벽·창 — 2 보다 먼저 판정한다. 2층 건물의 위층은 둘레가 빈 공간뿐이라
 *     이것이 없으면 위층 외벽이 모두 안쪽 벽이 된다. 어떤 붕괴도 이 칸을 바꾸지 않는다 (두 층 사이 4칸 이상을 지킨다)
 */
export function footprint(s: Scene): Uint8Array {
  let f = FOOT.get(s);
  if (f) return f;
  const w = s.w, h = s.h, t = s.tiles;
  f = new Uint8Array(w * h);
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    const ti = t[i];
    if (isIndoor(ti)) { f[i] = FOOT_IN; continue; }
    if (!isWall(ti)) continue;
    let near = false;
    for (let yy = y - 1; yy <= y + 1 && !near; yy++) for (let xx = x - 1; xx <= x + 1; xx++) {
      if (xx < 0 || yy < 0 || xx >= w || yy >= h || (xx === x && yy === y)) continue;
      if (isIndoor(t[yy * w + xx])) { near = true; break; }
    }
    if (!near) continue;
    let edge = false, shell = false;
    for (let d = 0; d < 4; d++) {
      const xx = x + (d === 0 ? 1 : d === 1 ? -1 : 0), yy = y + (d === 2 ? 1 : d === 3 ? -1 : 0);
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) { shell = true; continue; }
      const tj = t[yy * w + xx];
      if (tj === T.VOID) edge = true; else if (isOutside(tj)) shell = true;
    }
    f[i] = edge ? FOOT_FLOOR_EDGE : shell ? FOOT_SHELL : FOOT_IN;
  }
  FOOT.set(s, f);
  return f;
}

const NBRS = new WeakMap<Scene, number[][]>();
/**
 * 이웃 구획 (구역 번호 → 이웃한 실내 구역 번호들, 오름차순). **처음 부를 때의 생김새**로 한 번 계산해 둔다 —
 * 붕괴 뒤의 타일로 다시 계산하면 지휘 쪽이 보지 못한 붕괴를 이웃 관계로 알게 된다.
 * 두 실내 구역이 이웃인 경우:
 *   · 두 구역의 칸이 벽(또는 창) 한 칸을 사이에 두고 마주 본다 (4방향, 벽 너머 두 칸째)
 *   · 문 칸 하나로 이어진다 (문 칸과 그 4 이웃 칸의 구역들)
 *   · 벽 없이 맞닿아 있다 (꺾인 복도처럼 한 공간을 둘로 나눈 구역)
 * 빈 공간(T.VOID) 너머와 계단(stairTo)으로는 이웃이 아니다. 실내가 아닌 구역(마당·길가)은 넣지 않는다.
 * 처음 값(붕괴 현장의 곁 구획)·하중 이동·진입 금지 구역의 범위·소리가 모두 이것을 쓴다.
 */
export function regionNbrs(s: Scene): number[][] {
  let out = NBRS.get(s);
  if (out) return out;
  const w = s.w, h = s.h, t = s.tiles, reg = s.region, regs = s.regions;
  const sets: Set<number>[] = regs.map(() => new Set<number>());
  const link = (a: number, b: number): void => {
    if (a < 0 || b < 0 || a === b || !regs[a].indoor || !regs[b].indoor) return;
    sets[a].add(b); sets[b].add(a);
  };
  const DX = [1, -1, 0, 0], DY = [0, 0, 1, -1];
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    const ti = t[i];
    if (!isIndoor(ti)) continue;
    const a = reg[i];
    for (let d = 0; d < 4; d++) {
      const xx = x + DX[d], yy = y + DY[d];
      if (xx < 0 || yy < 0 || xx >= w || yy >= h) continue;
      const j = yy * w + xx, tj = t[j];
      if (isIndoor(tj)) {
        // 맞닿은 두 실내 칸: 구역이 다르면 이웃 (문 칸이든 열린 경계든)
        link(a, reg[j]);
        // 문 칸은 어느 구역에도 들지 않았을 수 있다: 문 건너편 칸과 잇는다
        if (tj === T.DOOR && a >= 0) for (let e = 0; e < 4; e++) {
          const x2 = xx + DX[e], y2 = yy + DY[e];
          if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) continue;
          const k = y2 * w + x2;
          if (isIndoor(t[k])) link(a, reg[k]);
        }
      } else if (isWall(tj)) {
        const x2 = xx + DX[d], y2 = yy + DY[d];
        if (x2 < 0 || y2 < 0 || x2 >= w || y2 >= h) continue;
        const k = y2 * w + x2;
        if (isIndoor(t[k])) link(a, reg[k]);
      }
    }
  }
  out = sets.map((q) => Array.from(q).sort((p, r) => p - r));
  NBRS.set(s, out);
  return out;
}

// ───────────────────────── (단계 5) 지휘 상태 — 설계서 §5 ─────────────────────────

/** 구조 규칙을 쓰지 않는 변형 (선박·비행기·열차·다중 추돌·크레인·산사태·승강기·산불). catastrophe.ts 가 다시 내보낸다 */
export const NO_STRUCT = ['ship', 'plane', 'train', 'pileup', 'crane', 'landslide', 'elevator', 'wild'];
/** 실제 건물 현장인가 (생김새 — 실내 구획이 있고, 길 위가 아니고, 구조 규칙을 쓰는 변형). 세계 쪽의 CatState.struct 와 같은 술어 */
export function structScene(s: Scene): boolean { return !s.outdoor && NO_STRUCT.indexOf(s.variant) < 0 && s.regions.some((r) => r.indoor); }

/** 새 지휘 상태 (모든 칸을 같은 순서로) */
export function newOps(t: number): OpsState {
  return {
    mode: 'interior', since: t, reason: '', ev: -1, zones: [],
    parAt: -1, parAsked: [], parOk: [], parTries: 0, parDue: -1,
    burnSince: {}, everHot: [], quietSince: t, calmSince: {}, utilityAsked: -1, concluded: false, reentries: 0, rubble: [],
    entry: {}, gated: 0, noExt: [], cleared: {}, limitBonus: 0,
  };
}

/** 구역 목록의 판(版): 지휘 규칙이 구역을 바꿀 때마다 올린다 (끊긴 곳의 계산을 다시 쓰는 열쇠) */
const ZVER = new WeakMap<OpsState, number>();
/** 구역을 고친 쪽이 부른다: 판을 올리고, 그 구역 목록(배열 — 제자리에서 고친다)의 칸 계산을 버린다 */
export function bumpZones(ops: OpsState): void { ZVER.set(ops, (ZVER.get(ops) ?? 0) + 1); MASK.delete(ops.zones); }
export const zonesVer = (ops: OpsState): number => ZVER.get(ops) ?? 0;

/** 구역의 생김새 (지휘 상태의 NoGoZone 과 믿음 속 ops 사실의 구역이 함께 쓴다) */
export type ZoneLike = Pick<NoGoZone, 'level' | 'regions' | 'x' | 'y' | 'r'>;
const MASK = new WeakMap<object, { v: number; m: Uint8Array }>();
/**
 * 칸별 구역 단계 (0 없음 · 2 진입 금지 · 3 철수). 구역 목록(배열 객체)과 지형(staticVersion)이 같으면 다시 쓴다 —
 * 믿음 속 ops 사실은 무전으로 옮겨도 값 객체가 같으므로(BeliefStore.relay 는 얕은 복사) 한 번 보낸 구역은 한 번만 계산한다.
 * 구획 구역은 구획의 지금 칸(무너지며 더해진 칸 포함), 원 구역은 원 안의 모든 칸
 */
export function zoneMask(s: Scene, zones: readonly ZoneLike[]): Uint8Array {
  const c = MASK.get(zones);
  if (c && c.v === s.staticVersion) return c.m;
  const w = s.w, h = s.h, m = new Uint8Array(w * h);
  for (let k = 0; k < zones.length; k++) {
    const z = zones[k], lv = z.level;
    for (let q = 0; q < z.regions.length; q++) {
      const reg = s.regions[z.regions[q]];
      if (!reg) continue;
      const tl = reg.tiles;
      for (let j = 0; j < tl.length; j++) if (m[tl[j]] < lv) m[tl[j]] = lv;
    }
    if (z.r > 0) {
      const rr = z.r * z.r;
      for (let y = Math.max(0, Math.floor(z.y - z.r)); y <= Math.min(h - 1, Math.ceil(z.y + z.r)); y++) for (let x = Math.max(0, Math.floor(z.x - z.r)); x <= Math.min(w - 1, Math.ceil(z.x + z.r)); x++) {
        const dx = x - z.x, dy = y - z.y;
        if (dx * dx + dy * dy <= rr) { const i = y * w + x; if (m[i] < lv) m[i] = lv; }
      }
    }
  }
  MASK.set(zones, { v: s.staticVersion, m });
  return m;
}
/** 칸 i 의 구역 단계 */
export const zoneLevelAt = (s: Scene, zones: readonly ZoneLike[], i: number): number => (zones.length && i >= 0 ? zoneMask(s, zones)[i] : 0);
/** 구획 r 이 든 구획 구역의 가장 높은 단계 (원 구역은 보지 않는다 — 원은 칸으로 본다) */
export function regionLevel(zones: readonly ZoneLike[], r: number): number {
  let lv = 0;
  if (r < 0) return 0;
  for (let k = 0; k < zones.length; k++) { const z = zones[k]; if (z.level > lv && z.regions.indexOf(r) >= 0) lv = z.level; }
  return lv;
}
/** 칸이 든 구역 (구역이 없는 실내 칸 — 문턱 — 이면 맞닿은 실내 구역) */
export function regionAt(s: Scene, i: number): number {
  if (i < 0) return -1;
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

const REACH = new WeakMap<Scene, { zv: number; sv: number; ops: OpsState; m: Uint8Array }>();
/**
 * 끊긴 곳 (§5.3 ③): 출입구(와 대기 지점)에서 지나갈 수 있는 칸을 따라 **단계 3 구역 칸을 빼고** 채워 나가 닿는 칸 (1).
 * 닿지 않는 곳의 일은 단계 3 칸을 지나야만 닿는다 — 단계 3 칸은 지나갈 수 없으므로(agents.agentCost) 그 너머의 일은 문이 막는다.
 * 구역 목록의 판이나 지형이 바뀔 때만 다시 계산한다. 계단은 이어진 칸으로 건너간다
 */
export function reachMask(s: Scene, ops: OpsState): Uint8Array {
  const zv = zonesVer(ops), c = REACH.get(s);
  if (c && c.ops === ops && c.zv === zv && c.sv === s.staticVersion) return c.m;
  const w = s.w, n = w * s.h, t = s.tiles, st = s.stairTo;
  const zm = zoneMask(s, ops.zones), m = new Uint8Array(n), q: number[] = [];
  const push = (i: number): void => { if (i >= 0 && i < n && !m[i] && zm[i] < 3 && staticPass(t[i])) { m[i] = 1; q.push(i); } };
  for (const e of s.exits) push(Math.round(e.y) * w + Math.round(e.x));
  push(Math.round(s.staging.y) * w + Math.round(s.staging.x));
  for (let k = 0; k < q.length; k++) {
    const i = q[k], x = i % w;
    if (x + 1 < w) push(i + 1);
    if (x > 0) push(i - 1);
    if (i + w < n) push(i + w);
    if (i >= w) push(i - w);
    if (st[i] >= 0) push(st[i]);
  }
  REACH.set(s, { zv, sv: s.staticVersion, ops, m });
  return m;
}
/** 구획 r 에 단계 3 구역을 지나지 않고 닿는가 (칸 하나라도) */
export function regionReachable(s: Scene, ops: OpsState, r: number): boolean {
  if (r < 0 || !ops.zones.length) return true;
  const m = reachMask(s, ops), tl = s.regions[r].tiles;
  for (let q = 0; q < tl.length; q++) if (m[tl[q]]) return true;
  return false;
}

/** 단계 2 구역에서도 나가는 일 (§5.3): 막는 조치·진압·아는 구조 대상의 이송·구출·물에서 건지기·동료 구조. 공중 임무는 문이 막지 않는다 */
export const ALLOWED2: ReadonlySet<WorkKind> = new Set<WorkKind>(['mitigate', 'suppress', 'carry', 'extricate', 'waterRescue', 'rescueMate']);
/** 자리가 현장 밖이거나 대상이 소품이 아닌 일 — 문이 보지 않는다 (급수 연결·탑승의 prop 은 부대 id 다) */
const NO_TARGET: ReadonlySet<WorkKind> = new Set<WorkKind>(['sizeup', 'hookup', 'load', 'traffic', 'interview', 'clearRoad', 'hoist', 'airDrop', 'repair', 'towAway', 'capture', 'cordon']);
/** 지휘관(또는 그 대원)이 그 소품을 가스 용기·드럼통(haz gas)으로 아는가 — 냉각은 외부에서도 할 수 있다 */
export const gasPropKnown = (a: FieldAgent, prop: number): boolean => prop >= 0 && a.beliefs.val<{ kind?: string }>('haz', prop)?.kind === 'gas';

/** 작업 대상의 칸 (믿음 속 위치). 구획 대상이면 −2 (구획으로 본다), 알 수 없거나 현장 밖이면 −1 */
export function targetTile(s: Scene, a: FieldAgent, kind: WorkKind, tg: WorkTarget): number {
  const B = a.beliefs, w = s.w;
  const at = (v: { x: number; y: number } | undefined): number => (v ? Math.round(v.y) * w + Math.round(v.x) : -1);
  if (kind === 'mitigate' && (tg.prop ?? -1) < 0 && (tg.tile ?? -1) >= 0) return tg.tile!;      // 가스 재측정: 그 문턱 칸
  if ((tg.region ?? -1) >= 0) return -2;
  if (kind === 'perimeter' && (tg.tile ?? -1) >= 0) { const e = s.exits[tg.tile!]; return e ? Math.round(e.y) * w + Math.round(e.x) : -1; }      // 출입구 통제: 그 출입구 칸 (철수 구역이 덮으면 갈 수 없다)
  if (NO_TARGET.has(kind)) return -1;
  if (kind === 'treatMate' || (tg.mate ?? -1) >= 0) { const m = B.val<MateBelief>('mate', tg.mate ?? -1); return m && m.status !== 'safe' && m.status !== 'evac' ? at(m) : -1; }
  if (kind === 'treatSuspect' || (tg.hostile ?? -1) >= 0) return at(B.val<{ x: number; y: number }>('hos', tg.hostile ?? -1));
  if ((tg.cas ?? -1) >= 0) { const c = B.val<CasBelief>('cas', tg.cas!); return c && (c.where === 'scene' || c.where === 'carried') ? at(c) : -1; }
  if ((tg.prop ?? -1) >= 0) return at(B.val<{ x: number; y: number }>('haz', tg.prop!));
  return -1;
}

/**
 * 문 (§5.3): 이 작업을 지금 새로 내면 안 되는가 — 지휘 상태(s.ops)·생김새·지휘관의 믿음(대상의 위치)만 읽는다.
 *   ① 대상이 단계 2 구역 안이고 허락된 일이 아님  ② 대상이 단계 3 구역 안 (진압·가스 용기 냉각은 밖에서 하므로 예외)
 *   ③ 대상이 단계 3 구역을 지나지 않고는 닿을 수 없는 곳 (밖에서 하는 진압·냉각은 예외)
 *   그리고 외부 방수 자리를 두 번 찾지 못한 구획의 진압 (§5.5 — ops.noExt)
 * agents.fitFor 도 같은 판정을 안전망으로 쓴다 (이미 맡은 일이 구역 안이 되면 0)
 */
export function gateBlocks(sim: Sim, s: Scene, a: FieldAgent, kind: WorkKind, tg: WorkTarget): boolean {
  void sim;
  const ops = s.ops;
  if (!ops || (!ops.zones.length && !ops.noExt.length)) return false;
  const ti = targetTile(s, a, kind, tg);
  if (ti === -1) return false;
  const region = ti === -2 ? tg.region! : regionAt(s, ti);
  const ext = kind === 'suppress' || (kind === 'mitigate' && gasPropKnown(a, tg.prop ?? -1));
  if (kind === 'suppress' && region >= 0 && ops.noExt.indexOf(region) >= 0 && opsExterior(s, region)) return true;      // 밖에서만 할 수 있는 동안만 (안으로 들어갈 수 있게 되면 다시 낸다)
  if (!ops.zones.length) return false;
  let lv = ti === -2 ? regionLevel(ops.zones, region) : zoneLevelAt(s, ops.zones, ti);
  if (ti === -2 && lv < 3) { const reg = s.regions[region]; if (reg) lv = Math.max(lv, zoneLevelAt(s, ops.zones, Math.round(reg.cy) * s.w + Math.round(reg.cx))); }
  if (lv >= 3) return !ext;
  if (lv === 2) return !ALLOWED2.has(kind);
  const reach = ti === -2 ? regionReachable(s, ops, region) : reachMask(s, ops)[ti] === 1 || (region >= 0 && regionReachable(s, ops, region));
  return !reach && !ext;
}

/**
 * 밖에서 방수하는가 (§5.5): 외부 방어 중이거나, 그 구획이 단계 2·3 구역이거나, 단계 3 구역 너머라 들어갈 수 없다.
 * (단계 2 에서 그 구획 안에서 이미 진압하던 대원은 실행기가 안에서 잇게 한다)
 */
export function opsExterior(s: Scene, region: number): boolean {
  const ops = s.ops;
  if (!ops) return false;
  if (ops.mode === 'defensive') return true;
  if (!ops.zones.length || region < 0) return false;
  return regionLevel(ops.zones, region) >= 2 || !regionReachable(s, ops, region);
}
/** 출입구 통제가 필요한가 (§5.3): 건물·가스·용기 구역 가운데 단계 3 이 있거나 외부 방어 중 (통제 자리가 있는 현장만) */
export function opsCordon(s: Scene): boolean {
  const ops = s.ops;
  if (!ops || !s.spots.length) return false;      // 출입구 통제 자리(s.spots)가 있는 현장만 — 없으면 봉쇄 임무가 설 곳을 찾지 못해 '진입 경로를 찾지 못했습니다'를 되풀이한다 (평면 생성기의 화재·붕괴 현장)
  if (ops.mode === 'defensive') return true;
  for (const z of ops.zones) if (z.level === 3 && (z.kind === 'bldg' || z.kind === 'gas' || z.kind === 'vessel')) return true;
  return false;
}

const NEAR = new WeakMap<Scene, Uint8Array>();
/** 처음 생김새의 건물 칸(footprint ≥ 1)에서 2칸 안인 칸 (1) — 철수 지점·외부 방수 자리가 피한다 */
export function nearBuilding(s: Scene): Uint8Array {
  let m = NEAR.get(s);
  if (m) return m;
  const f = footprint(s), w = s.w, h = s.h;
  m = new Uint8Array(w * h);
  for (let i = 0; i < f.length; i++) {
    if (!f[i]) continue;
    const x = i % w, y = (i / w) | 0;
    for (let yy = Math.max(0, y - 2); yy <= Math.min(h - 1, y + 2); yy++) for (let xx = Math.max(0, x - 2); xx <= Math.min(w - 1, x + 2); xx++) if ((xx - x) * (xx - x) + (yy - y) * (yy - y) <= 4) m[yy * w + xx] = 1;
  }
  NEAR.set(s, m);
  return m;
}
/**
 * 철수 지점 (§5.1): 단계 3 구역 밖이고 건물 칸에서 2칸 넘게 떨어진 바깥 칸 — 대기 지점 → 안전 구역 → 도로 줄(y 18)의 칸 순서로 처음 맞는 것.
 * 하나도 없으면 대기 지점
 */
export function evacPoint(s: Scene, zones: readonly ZoneLike[]): { x: number; y: number } {
  const w = s.w, h = s.h, near = nearBuilding(s);
  const ok = (x: number, y: number): boolean => {
    const tx = Math.round(x), ty = Math.round(y);
    if (tx < 0 || ty < 0 || tx >= w || ty >= h) return false;
    const i = ty * w + tx;
    return staticPass(s.tiles[i]) && !isIndoor(s.tiles[i]) && !near[i] && zoneLevelAt(s, zones, i) < 3;
  };
  if (ok(s.staging.x, s.staging.y)) return s.staging;
  if (ok(s.safe.x, s.safe.y)) return s.safe;
  const y = Math.min(h - 1, 18);
  for (let x = 0; x < w; x++) if (ok(x, y)) return { x, y };
  return s.staging;
}

const EXT = new WeakMap<Scene, Map<number, { sv: number; list: Int32Array }>>();
/** 외부 방수가 닿는 거리 (칸) */
export const EXT_RANGE = 5.5;
/**
 * 외부 방수의 후보 자리 (§5.5 — 생김새만): 실내가 아니고 지나갈 수 있는 칸 가운데 그 구획 칸 하나에 벽에 막히지 않는 시야선(창·문·무너진 벽 너머)이
 * 5.5칸 안에서 닿는 칸. far = 건물 칸에서 2칸 넘게 떨어진 칸만 (구조 위험 때문에 물러선 방수). 구획·조건마다 처음 한 번 계산하고, 지형이 바뀌면 다시.
 * 실제로 불이 있는 칸을 고르는 것은 실행기다(진실). 단계 3 구역 칸은 부르는 쪽이 지금의 구역으로 거른다
 */
export function exteriorSpots(s: Scene, region: number, far: boolean): Int32Array {
  let m = EXT.get(s);
  if (!m) { m = new Map(); EXT.set(s, m); }
  const key = region * 2 + (far ? 1 : 0), c = m.get(key);
  if (c && c.sv === s.staticVersion) return c.list;
  const reg = s.regions[region], w = s.w, h = s.h, near = nearBuilding(s), out: number[] = [];
  if (reg) {
    const R = EXT_RANGE, tl = reg.tiles;
    for (let y = Math.max(0, Math.floor(reg.y0 - R)); y <= Math.min(h - 1, Math.ceil(reg.y1 + R)); y++) for (let x = Math.max(0, Math.floor(reg.x0 - R)); x <= Math.min(w - 1, Math.ceil(reg.x1 + R)); x++) {
      const i = y * w + x, ti = s.tiles[i];
      if (!staticPass(ti) || isIndoor(ti) || (far && near[i])) continue;
      for (let q = 0; q < tl.length; q++) {
        const j = tl[q], jx = j % w, jy = (j / w) | 0;
        if (dist(x, y, jx, jy) <= R && losWalls(s, x, y, jx, jy)) { out.push(i); break; }
      }
    }
  }
  const list = Int32Array.from(out);
  m.set(key, { sv: s.staticVersion, list });
  return list;
}
