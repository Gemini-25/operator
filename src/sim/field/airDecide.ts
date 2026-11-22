// 상공의 헬기가 무엇을 할지 정한다 (docs/specs/R1-crews.md 7.3).
// 이 파일은 판단만 한다: 읽는 것은 좁힌 입력(AirView) 하나뿐이고, 그 안에는 믿음(관측자·지휘관)과 지휘관의 작업판,
// 지형, 자기 부대의 장비 상태만 들어 있다. 현장의 진실(구조 대상·용의자·소품·불·연기, 숨은 고장)은 읽지 않는다 —
// tests/crews.test.ts ⑬ 이 이 파일의 소스를 검사한다. 실행(이동·인양·투하·관측)은 field/rules/air.ts 가 한다.
//
// 작업판을 무전 없이 읽는 것은 의도한 예외다: 작업판은 지휘관의 지시 목록이라 조직이 아는 정보이고,
// 상공의 헬기는 지상과 따로인 항공 무전으로 지시를 받는다고 보고 지연·음영 없이 읽는다 (지상 대원도 brain 에서 작업판을 직접 읽는다).

import type { Sim } from '../engine';
import { T } from '../types';
import type { AirOp, CasBelief, FieldAgent, IncidentType, Region, WorkItem } from '../types';
import { outstanding } from './commander';
import { TYPE_DEFS } from '../incidentTypes';

export interface AirTerrain { w: number; h: number; tiles: Uint8Array; region: Int16Array; regions: Region[] }
/** airDecide 가 받는 것의 전부 (air.ts 가 만들어 넘긴다) */
export interface AirView {
  op: AirOp;                          // 이 헬기의 상공 작업 (지금 하던 일을 이어 갈지 볼 때 읽는다)
  eye: FieldAgent;                    // 이 헬기의 관측자 — 그 믿음만 읽는다
  board: WorkItem[];                  // 지휘관의 작업판
  cmd: FieldAgent | null;             // 활동 중인 지휘관 — 그 믿음만 읽는다
  terrain: AirTerrain;                // 지형 (칸의 종류와 구역)
  kind: IncidentType;                 // 현장의 성격 (지휘관이 도착해서 직접 보는 것과 같다 — 상공에서도 보인다)
  night: boolean;
  others: AirOp[];                    // 같은 현장 상공의 다른 헬기 (같은 대상을 둘이 잡지 않는다)
  incoming: boolean;                  // 이 사건에 오고 있는 다른 부대가 있다
  hoist: boolean;                     // 호이스트가 있다 (자기 부대의 장비)
  bucket: boolean;                    // 물 바구니를 달았다 (자기 부대의 장비)
  leg: number;                        // 훑기의 몇째 구간을 가는 중인가 (air.ts 가 닿을 때마다 하나씩 올린다)
}
/** 정한 일. watch 는 (tx, ty) 로 가며 살피고, hoist·bucket 은 target 을 air.ts 가 실행한다 */
export interface AirPlan {
  mode: AirOp['mode'];
  target: number;                     // hoist: 구조 대상 id, bucket: 구역 id, watch: -1
  workId: number;                     // 작업판의 작업 (스스로 고른 일이면 -1)
  tx: number; ty: number;             // watch 가 향할 자리 (칸)
  sweep: boolean;                     // 줄지어 훑는 중이다 (닿으면 다음 구간으로)
  busy: boolean;                      // 할 일이 있다. false 면 air.ts 가 한가해진 시간을 재고, 오래되면 복귀시킨다
}

const live = (w: WorkItem): boolean => w.status === 'open' || w.status === 'active';
/** 물속에 있다고 믿는 사람인가 (지휘관이 수난 구조를 내는 조건과 같다) */
function inWaterBelief(t: AirTerrain, c: CasBelief): boolean {
  return c.where === 'scene' && c.mob === 'trapped' && c.band < 3 && t.tiles[c.y * t.w + c.x] === T.WATER;
}
/** (N8 단계 8 §5.11) 호이스트로 건질 수 있다고 믿는 사람: 물속이거나 높은 자리(믿음 perch > 0 — 외벽·놀이기구) */
function hoistable(t: AirTerrain, c: CasBelief): boolean {
  return inWaterBelief(t, c) || (c.where === 'scene' && c.mob === 'trapped' && c.band < 3 && (c.perch ?? 0) > 0);
}

/** 호이스트로 건질 사람: 작업판의 호이스트 작업(우선순위 순), 지휘관이 없으면 관측자가 본 물속의 사람(위중한 사람 먼저) */
function pickHoist(v: AirView): { target: number; workId: number } | null {
  if (!v.hoist) return null;
  const taken = (cid: number): boolean => v.others.some((o) => o.mode === 'hoist' && o.target === cid);
  let best: WorkItem | null = null;
  for (const w of v.board) {
    if (w.kind !== 'hoist' || !live(w) || taken(w.cas)) continue;
    if (w.cas === v.op.target && v.op.mode === 'hoist') return { target: w.cas, workId: w.id };      // 하던 인양은 끝까지 한다
    if (!best || w.priority > best.priority) best = w;
  }
  if (best) return { target: best.cas, workId: best.id };
  if (v.cmd) return null;      // 지휘관이 있으면 그 지시를 따른다
  let bid = -1, bb = -1;
  for (const f of v.eye.beliefs.list('cas')) {
    const c = f.value as CasBelief;
    if (!hoistable(v.terrain, c) || taken(f.id)) continue;
    if (f.id === v.op.target && v.op.mode === 'hoist') return { target: f.id, workId: -1 };
    if (c.band > bb) { bb = c.band; bid = f.id; }
  }
  return bid >= 0 ? { target: bid, workId: -1 } : null;
}

/** 물을 뿌릴 구역: 작업판의 공중 물 투하 작업(우선순위 순), 없으면 관측자가 본 불이 가장 센 바깥 구역. 밤에는 투하하지 않는다 */
function pickBucket(v: AirView): { target: number; workId: number } | null {
  if (!v.bucket || v.night) return null;
  const taken = (rg: number): boolean => v.others.some((o) => o.mode === 'bucket' && o.target === rg);
  let best: WorkItem | null = null;
  for (const w of v.board) {
    if (w.kind !== 'airDrop' || !live(w) || taken(w.region)) continue;
    if (!best || w.priority > best.priority) best = w;
  }
  if (best) return { target: best.region, workId: best.id };
  let rid = -1, bv = 0.05;
  for (const f of v.eye.beliefs.list('fire')) {
    if (f.id >= v.terrain.regions.length || v.terrain.regions[f.id].indoor || taken(f.id)) continue;
    if (f.value > bv) { bv = f.value; rid = f.id; }
  }
  return rid >= 0 ? { target: rid, workId: -1 } : null;
}

/** 훑는 줄 (3칸 간격). 수난 현장은 물이 있는 줄만 — 없으면 모든 줄 */
function sweepRows(t: AirTerrain, alongWater: boolean): number[] {
  const all: number[] = [];
  for (let y = 1; y <= t.h - 2; y += 3) all.push(y);
  if (!alongWater) return all;
  const wet = all.filter((y) => {
    for (let yy = Math.max(0, y - 1); yy <= Math.min(t.h - 1, y + 1); yy++) for (let x = 0; x < t.w; x++) if (t.tiles[yy * t.w + x] === T.WATER) return true;
    return false;
  });
  return wet.length ? wet : all;
}
/** 훑기의 k 번째 구간의 끝 자리: 한 줄을 끝까지 간 뒤 다음 줄로 내려가 되돌아온다 (난수 없음) */
function sweepPoint(t: AirTerrain, alongWater: boolean, leg: number): { x: number; y: number } {
  const rows = sweepRows(t, alongWater), n = rows.length * 2, k = ((leg % n) + n) % n;
  return { x: (((k + 1) >> 1) & 1) === 1 ? t.w - 2 : 1, y: rows[k >> 1] };
}
/** 그 자리에서 시작하기에 가장 가까운 훑기 구간 (상공에 처음 닿았을 때) */
export function nearestLeg(t: AirTerrain, kind: IncidentType, x: number, y: number): number {
  const n = sweepRows(t, kind === 'water').length * 2;
  let best = 0, bd = Infinity;
  for (let k = 0; k < n; k++) { const p = sweepPoint(t, kind === 'water', k); const d = Math.hypot(p.x - x, p.y - y); if (d < bd) { bd = d; best = k; } }
  return best;
}

/** 살필 자리: 용의자가 있다고 믿으면 그 위를 돌고(달아나는 사람 먼저), 물속의 사람을 알면 그 하류에 머물고, 그 밖에는 바깥을 줄지어 훑는다 */
function watchPoint(sim: Sim, v: AirView): { tx: number; ty: number; sweep: boolean } {
  const t = v.terrain;
  const clampX = (x: number): number => Math.max(0.5, Math.min(t.w - 1.5, x)), clampY = (y: number): number => Math.max(0.5, Math.min(t.h - 1.5, y));
  let hx = -1, hy = -1, rank = 0;
  const look = (a: FieldAgent | null): void => {
    if (!a) return;
    for (const f of a.beliefs.list('hos')) {
      const st = f.value.state, r = st === 'flee' ? 3 : st === 'fight' ? 2 : st === 'hold' ? 1 : 0;
      if (r > rank) { rank = r; hx = f.value.x; hy = f.value.y; }
    }
  };
  look(v.eye); look(v.cmd);      // 관측자가 직접 본 것 먼저, 같은 급이면 지휘관이 아는 것
  if (rank > 0) {
    const th = sim.t * (WATCH_SPEED / ORBIT_R) + v.op.unitId;      // 반지름 4칸의 원을 초당 2.5칸으로
    return { tx: clampX(hx + ORBIT_R * Math.cos(th)), ty: clampY(hy + ORBIT_R * Math.sin(th)), sweep: false };
  }
  let wx = -1, wy = -1, wb = -1;
  const wet = (a: FieldAgent | null): void => {
    if (!a) return;
    for (const f of a.beliefs.list('cas')) { const c = f.value as CasBelief; if (inWaterBelief(t, c) && c.band > wb) { wb = c.band; wx = c.x; wy = c.y; } }
  };
  wet(v.eye); wet(v.cmd);
  if (wb >= 0) return { tx: clampX(wx + 2), ty: clampY(wy), sweep: false };      // 떠내려가는 쪽(+x)에서 지켜본다
  const p = sweepPoint(t, v.kind === 'water', v.leg);
  return { tx: p.x, ty: p.y, sweep: true };
}
/** 상공에서 살피며 도는 속도(칸/초)와 용의자 위를 도는 반지름(칸) */
export const WATCH_SPEED = 2.5;
const ORBIT_R = 4;

/**
 * 살피는 일이 남았는가 — 믿음으로 정한다. "바깥을 훑기"는 언제나 할 수 있으므로 이 기준이 없으면 감시 헬기는 영영 한가해지지 않는다.
 *  지휘관이 있으면: 그 믿음에 용의자가 남았거나, 무장 현장의 안전 확보를 선언하기 전이거나, 실종·수난 현장에서 아직 아무도 찾지 못했거나,
 *                   물속에 사람이 있다고 알거나, 작업판에 바깥 구역의 수색이 열려 있을 때
 *  지휘관이 없으면: 이 사건에 오고 있는 다른 부대가 있을 때 (지상 부대보다 먼저 닿은 헬기는 그들이 올 때까지 하늘에서 찾는다)
 */
function watchBusy(v: AirView): boolean {
  if (!v.cmd) return v.incoming;
  const o = outstanding(v.cmd);
  if (o.hostile) return true;
  if (v.kind === 'armed' && v.cmd.beliefs.get('secure', 0) === undefined) return true;
  if ((TYPE_DEFS[v.kind].zoneSearch || v.kind === 'water') && o.search) return true;
  for (const f of v.cmd.beliefs.list('cas')) if (hoistable(v.terrain, f.value as CasBelief)) return true;
  for (const w of v.board) if (w.kind === 'search' && live(w) && w.region >= 0 && !v.terrain.regions[w.region].indoor) return true;
  return false;
}

/** 이 헬기가 지금 할 일을 고른다: 호이스트 인양 > 공중 물 투하 > 살피기 */
export function airDecide(sim: Sim, v: AirView): AirPlan {
  const h = pickHoist(v);
  if (h) return { mode: 'hoist', target: h.target, workId: h.workId, tx: v.op.x, ty: v.op.y, sweep: false, busy: true };
  const b = pickBucket(v);
  if (b) return { mode: 'bucket', target: b.target, workId: b.workId, tx: v.op.x, ty: v.op.y, sweep: false, busy: true };
  const w = watchPoint(sim, v);
  return { mode: 'watch', target: -1, workId: -1, tx: w.tx, ty: w.ty, sweep: w.sweep, busy: watchBusy(v) };
}
