// 현장 렌더러 공용 도구: 결정적 해시, 색 계산, 시야 다각형.
// 표현 계층 전용. 시뮬레이션 상태를 읽기만 한다.

import { doorAt } from '../../sim/field/grid';
import { T } from '../../sim/types';
import type { Scene } from '../../sim/types';

export function hash2(x: number, y: number): number {
  let h = (Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263)) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

const rgbCache = new Map<string, [number, number, number]>();
export function rgb(hex: string): [number, number, number] {
  let c = rgbCache.get(hex);
  if (!c) {
    const v = hex.length === 4 ? hex.slice(1).split('').map((d) => parseInt(d + d, 16)) : [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];
    c = [v[0], v[1], v[2]]; rgbCache.set(hex, c);
  }
  return c;
}
/** 두 색을 섞는다 (k = 0 → a, 1 → b) */
export function mix(a: string, b: string, k: number): string {
  const p = rgb(a), q = rgb(b);
  return `rgb(${Math.round(p[0] + (q[0] - p[0]) * k)},${Math.round(p[1] + (q[1] - p[1]) * k)},${Math.round(p[2] + (q[2] - p[2]) * k)})`;
}
/** k < 0 어둡게, k > 0 밝게 */
export function shade(hex: string, k: number): string { return k < 0 ? mix(hex, '#000000', -k) : mix(hex, '#ffffff', k); }
export function alpha(hex: string, a: number): string { const p = rgb(hex); return `rgba(${p[0]},${p[1]},${p[2]},${a})`; }

export type G = CanvasRenderingContext2D;
export function rr(g: G, x: number, y: number, w: number, h: number, r: number, col: string): void {
  g.fillStyle = col; g.beginPath(); g.roundRect(x, y, w, h, r); g.fill();
}
export function disc(g: G, x: number, y: number, r: number, col: string): void {
  g.fillStyle = col; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
}
export function oval(g: G, x: number, y: number, rx: number, ry: number, col: string, rot = 0): void {
  g.fillStyle = col; g.beginPath(); g.ellipse(x, y, rx, ry, rot, 0, 6.2832); g.fill();
}
export function seg(g: G, x0: number, y0: number, x1: number, y1: number, w: number, col: string): void {
  g.strokeStyle = col; g.lineWidth = w; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
}

/** 시야를 막는 타일인가 (시뮬레이션의 los 와 같은 규칙: 벽·바위·닫힌 문) */
export function blocksSight(s: Scene, tx: number, ty: number): boolean {
  if (tx < 0 || ty < 0 || tx >= s.w || ty >= s.h) return true;
  const i = ty * s.w + tx, t = s.tiles[i];
  if (t === T.WALL || t === T.ROCK) return true;
  if (t === T.DOOR) { const d = doorAt(s, i); return !!d && !d.open; }
  return false;
}

/**
 * (x, y) 에서 a0..a1 방향으로 보이는 영역의 다각형 (타일 좌표, 타일 중심 기준).
 * 벽에 닿으면 거기서 끊긴다. out 은 [x0, y0, x1, y1, …] 로 채워진다.
 */
export function visPoly(s: Scene, x: number, y: number, a0: number, a1: number, range: number, out: number[]): void {
  out.length = 0;
  const n = Math.max(8, Math.ceil(((a1 - a0) / 6.2832) * 96));
  const step = 0.16;
  for (let k = 0; k <= n; k++) {
    const a = a0 + ((a1 - a0) * k) / n, dx = Math.cos(a), dy = Math.sin(a);
    let d = 0;
    while (d < range) {
      const nd = Math.min(range, d + step);
      if (blocksSight(s, Math.round(x + dx * nd), Math.round(y + dy * nd))) { d = Math.min(range, d + step * 0.6); break; }
      d = nd;
    }
    out.push(x + dx * d, y + dy * d);
  }
}
