// 현장 격자 유틸리티: 통행 가능 여부, 시야(LOS), A* 경로 탐색.

import { T } from '../types';
import type { Scene } from '../types';

export const tileX = (s: Scene, i: number): number => i % s.w;
export const tileY = (s: Scene, i: number): number => (i / s.w) | 0;
export const tidx = (s: Scene, x: number, y: number): number => y * s.w + x;
export const inb = (s: Scene, x: number, y: number): boolean => x >= 0 && y >= 0 && x < s.w && y < s.h;
/** 실수 좌표 → 타일 인덱스 */
export const tileOf = (s: Scene, x: number, y: number): number => {
  const tx = Math.min(s.w - 1, Math.max(0, Math.round(x))), ty = Math.min(s.h - 1, Math.max(0, Math.round(y)));
  return ty * s.w + tx;
};

export function staticPass(t: number): boolean {
  return t === T.GROUND || t === T.ROAD || t === T.FLOOR || t === T.TREE || t === T.DOOR || t === T.TRAIL;
}
export function isIndoor(t: number): boolean { return t === T.FLOOR || t === T.DOOR; }

/** 진실 기준: 지금 이 타일에 들어갈 수 있는가 (화재 제외) */
export function truthWalkable(s: Scene, i: number): boolean {
  return staticPass(s.tiles[i]) && s.propAt[i] < 0;
}

/** 시야선. 벽/닫힌 문에 막힌다(창문은 통과). */
export function los(s: Scene, x0: number, y0: number, x1: number, y1: number): boolean {
  let ax = Math.round(x0), ay = Math.round(y0);
  const bx = Math.round(x1), by = Math.round(y1);
  const dx = Math.abs(bx - ax), dy = Math.abs(by - ay);
  const sx = ax < bx ? 1 : -1, sy = ay < by ? 1 : -1;
  let err = dx - dy;
  let guard = 0;
  while ((ax !== bx || ay !== by) && guard++ < 80) {
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; ax += sx; }
    if (e2 < dx) { err += dx; ay += sy; }
    if (ax === bx && ay === by) break;
    const i = ay * s.w + ax;
    const t = s.tiles[i];
    if (t === T.WALL || t === T.ROCK) return false;
    if (t === T.DOOR) { const d = doorAt(s, i); if (d && !d.open) return false; }
  }
  return true;
}

const doorCache = new WeakMap<Scene, Map<number, number>>();
export function doorAt(s: Scene, i: number) {
  let m = doorCache.get(s);
  if (!m) { m = new Map(); for (const p of s.props) if (p.kind === 'door') m.set(p.y * s.w + p.x, p.id); doorCache.set(s, m); }
  const id = m.get(i);
  return id === undefined ? null : s.props[id];
}

// ── A* (8방향, 이진 힙) ──
const MAXN = 4096;
const gArr = new Float32Array(MAXN);
const fArr = new Float32Array(MAXN);
const came = new Int32Array(MAXN);
const state = new Uint8Array(MAXN);   // 0 미방문, 1 open, 2 closed
const heap = new Int32Array(MAXN * 4);
let heapN = 0;
function hpush(i: number): void {
  let k = heapN++; heap[k] = i;
  while (k > 0) { const p = (k - 1) >> 1; if (fArr[heap[p]] <= fArr[heap[k]]) break; const t = heap[p]; heap[p] = heap[k]; heap[k] = t; k = p; }
}
function hpop(): number {
  const top = heap[0]; heapN--;
  if (heapN > 0) {
    heap[0] = heap[heapN]; let k = 0;
    for (;;) {
      const l = 2 * k + 1, r = l + 1; let m = k;
      if (l < heapN && fArr[heap[l]] < fArr[heap[m]]) m = l;
      if (r < heapN && fArr[heap[r]] < fArr[heap[m]]) m = r;
      if (m === k) break;
      const t = heap[m]; heap[m] = heap[k]; heap[k] = t; k = m;
    }
  }
  return top;
}
const DX = [1, -1, 0, 0, 1, 1, -1, -1];
const DY = [0, 0, 1, -1, 1, -1, 1, -1];

export type CostFn = (i: number) => number;   // 추가 비용 (음수 = 통과 불가)

/**
 * (sx,sy) 에서 (tx,ty) 로부터 range 이내의 통행 가능 타일까지의 경로.
 * 반환: 시작 타일을 제외한 타일 인덱스 배열. 이미 도달해 있으면 빈 배열. 경로가 없으면 null.
 * needLos 가 true 면 목표 타일에서 (tx,ty) 로 시야가 통해야 한다.
 */
export function astar(s: Scene, sx: number, sy: number, tx: number, ty: number, range: number, cost: CostFn, needLos = false, costOut?: { v: number }): number[] | null {
  const w = s.w, h = s.h, n = w * h;
  const start = tileOf(s, sx, sy);
  state.fill(0, 0, n);
  heapN = 0;
  const r2 = range * range + 0.01;
  const isGoal = (i: number): boolean => {
    const x = i % w, y = (i / w) | 0;
    const dx = x - tx, dy = y - ty;
    if (dx * dx + dy * dy > r2) return false;
    if (needLos && !los(s, x, y, tx, ty)) return false;
    return true;
  };
  const hfn = (i: number): number => {
    const dx = Math.abs((i % w) - tx), dy = Math.abs(((i / w) | 0) - ty);
    const o = Math.max(dx, dy) + 0.414 * Math.min(dx, dy) - range;
    return o > 0 ? o : 0;
  };
  gArr[start] = 0; fArr[start] = hfn(start); came[start] = -1; state[start] = 1; hpush(start);
  while (heapN > 0) {
    const cur = hpop();
    if (state[cur] === 2) continue;
    state[cur] = 2;
    if (isGoal(cur) && (cur === start || cost(cur) >= 0)) {
      const path: number[] = [];
      let c = cur;
      while (c !== start && c >= 0) { path.push(c); c = came[c]; }
      path.reverse();
      if (costOut) costOut.v = gArr[cur];
      return path;
    }
    const cx = cur % w, cy = (cur / w) | 0;
    for (let d = 0; d < 8; d++) {
      const nx = cx + DX[d], ny = cy + DY[d];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const ni = ny * w + nx;
      if (state[ni] === 2) continue;
      const c = cost(ni);
      if (c < 0) continue;
      if (d >= 4) {
        // 대각선은 양쪽 직교 타일이 모두 열려 있어야 한다
        if (cost(cy * w + nx) < 0 || cost(ny * w + cx) < 0) continue;
      }
      const ng = gArr[cur] + (d >= 4 ? 1.414 : 1) + c;
      if (state[ni] === 0 || ng < gArr[ni]) {
        gArr[ni] = ng; fArr[ni] = ng + hfn(ni); came[ni] = cur; state[ni] = 1; hpush(ni);
      }
    }
  }
  return null;
}

/** 진실 기준 이동 비용 (시민·용의자 등 환경 개체용) */
export function truthCost(s: Scene): CostFn {
  return (i: number) => {
    if (!staticPass(s.tiles[i])) return -1;
    if (s.propAt[i] >= 0) return -1;
    if (s.fire[i] > 0.5) return -1;
    return s.fire[i] > 0.1 ? 3 : 0;
  };
}

/** 구역 안에서 걸어 들어갈 수 있는 타일 수 */
export function walkableCount(s: Scene, tiles: number[]): number {
  let n = 0; for (const i of tiles) if (staticPass(s.tiles[i])) n++;
  return n;
}
