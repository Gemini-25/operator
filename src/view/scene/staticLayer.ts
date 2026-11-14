// 현장의 움직이지 않는 부분을 한 번만 그려 두는 층.
// 바닥 재질(나무·타일·콘크리트·아스팔트·보도블록·풀·흙·물), 두께 있는 벽과 그림자, 창문, 문틀, 가구, 바위, 나무.
// 장치 화소 단위(R = 타일 한 칸의 화소 수)로 그려 고해상도 화면에서도 선명하다.

import { DECOR, T } from '../../sim/types';
import type { Scene } from '../../sim/types';
import { disc, hash2, mix, oval, rr, seg, shade } from './common';
import type { G } from './common';

export interface StaticLayer {
  base: HTMLCanvasElement;
  over: HTMLCanvasElement | null;      // 대원 위에 덮이는 층 (나무 수관)
  R: number; sig: number;
  lamps: { x: number; y: number }[];   // 가로등 (야간 조명용, 타일 좌표)
}

const S = { VOID: 0, GRASS: 1, FOREST: 2, PAVER: 3, CONCRETE: 4, ASPHALT: 5, DIRT: 6, WATER: 7, WOOD: 8, TILE: 9, SLAB: 10, GRAVEL: 11, WALL: 255 } as const;

const isWallish = (t: number): boolean => t === T.WALL || t === T.WINDOW;
const isBuilding = (t: number): boolean => t === T.FLOOR || t === T.FURN || t === T.DOOR || t === T.WALL || t === T.WINDOW;

/** 정적 층이 의존하는 값의 요약. 문이 열리는 정도로는 다시 그리지 않는다. */
export function staticSig(s: Scene): number {
  let h = 2166136261 ^ s.floorMat;
  for (let i = 0; i < s.tiles.length; i++) h = Math.imul(h ^ (s.tiles[i] + s.decor[i] * 16), 16777619);
  return h >>> 0;
}

function surfaceMap(s: Scene, district: string): Uint8Array {
  const n = s.w * s.h, out = new Uint8Array(n);
  const floor = s.floorMat === 1 ? S.TILE : s.floorMat === 2 ? S.SLAB : S.WOOD;
  const ground = s.kind === 'search' ? S.FOREST : s.kind === 'traffic' ? S.GRASS : district === 'commercial' ? S.PAVER : district === 'industrial' ? S.CONCRETE : S.GRASS;
  const at = (x: number, y: number): number => (x < 0 || y < 0 || x >= s.w || y >= s.h ? T.VOID : s.tiles[y * s.w + x]);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const i = y * s.w + x, t = s.tiles[i];
    let v: number;
    if (t === T.FLOOR || t === T.FURN || t === T.DOOR) v = floor;
    else if (isWallish(t)) v = s.decor[i] === DECOR.SHELF ? floor : S.WALL;
    else if (t === T.ROAD) v = S.ASPHALT;
    else if (t === T.VOID) v = S.VOID;
    else {
      v = ground;
      if (s.kind !== 'search') {
        if (at(x, y - 1) === T.ROAD || at(x, y + 1) === T.ROAD) v = s.kind === 'traffic' ? S.GRAVEL : S.PAVER;
        else if (s.kind !== 'traffic' && ground === S.GRASS) {
          // 건물 둘레 한 칸은 포장
          let near = false;
          for (let yy = y - 1; yy <= y + 1 && !near; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (isBuilding(at(xx, yy))) { near = true; break; }
          if (near) v = S.PAVER;
        }
      }
    }
    out[i] = v;
  }
  // 출입구에서 보도까지 이어지는 포장 통로
  if (s.kind !== 'search' && s.kind !== 'traffic') for (const e of s.exits) {
    for (let y = e.y; y < s.h; y++) {
      const t = at(e.x, y);
      if (t === T.ROAD || isBuilding(t)) break;
      if (out[y * s.w + e.x] === S.GRASS) out[y * s.w + e.x] = S.PAVER;
    }
  }
  return out;
}

// ───────────────────────── 바닥 재질 ─────────────────────────
function dots(g: G, tx: number, ty: number, R: number, n: number, salt: number, cols: string[], size: number): void {
  for (let k = 0; k < n; k++) {
    const hx = hash2(tx * 13 + k, ty * 7 + salt), hy = hash2(tx * 5 + salt, ty * 11 + k);
    g.fillStyle = cols[(hash2(tx + k, ty + salt) * cols.length) | 0];
    const d = size * R * (0.6 + 0.8 * hash2(k + salt, tx * 3 + ty));
    g.fillRect((tx + hx) * R, (ty + hy) * R, d, d);
  }
}

function paintTile(g: G, kind: number, tx: number, ty: number, R: number): void {
  const px = tx * R, py = ty * R, lw = Math.max(1, R * 0.03);
  switch (kind) {
    case S.WOOD: {
      const rows = 3, rh = R / rows, L = 2.5;
      for (let r = 0; r < rows; r++) {
        const gr = ty * rows + r, off = hash2(gr, 77) * L;
        let x0 = tx;
        while (x0 < tx + 1 - 1e-6) {
          const pi = Math.floor((x0 + off) / L + 1e-6);
          const x1 = Math.min(tx + 1, (pi + 1) * L - off);
          g.fillStyle = mix('#7a5a3a', '#99754c', hash2(pi * 7 + 3, gr));
          g.fillRect(x0 * R, py + r * rh, (x1 - x0) * R + 0.6, rh + 0.6);
          if (x1 < tx + 1 - 1e-6) { g.fillStyle = 'rgba(28,16,6,0.5)'; g.fillRect(x1 * R - lw / 2, py + r * rh, lw, rh); }
          x0 = x1;
        }
        g.fillStyle = 'rgba(28,16,6,0.34)'; g.fillRect(px, py + r * rh, R, lw);
        g.fillStyle = 'rgba(255,230,190,0.07)'; g.fillRect(px, py + r * rh + lw, R, lw);
        g.fillStyle = 'rgba(40,22,8,0.10)';
        for (let k = 0; k < 2; k++) { const gy = py + r * rh + rh * (0.3 + 0.4 * hash2(gr * 3 + k, tx)); g.fillRect(px + R * hash2(tx, gr + k) * 0.5, gy, R * 0.45, Math.max(1, lw * 0.6)); }
      }
      break;
    }
    case S.TILE: {
      g.fillStyle = '#56606a'; g.fillRect(px, py, R + 0.6, R + 0.6);
      const h = R / 2, gp = Math.max(1, R * 0.025);
      for (let sy = 0; sy < 2; sy++) for (let sx = 0; sx < 2; sx++) {
        const k = hash2(tx * 2 + sx, ty * 2 + sy);
        g.fillStyle = mix('#7b8791', '#8d99a3', k);
        g.fillRect(px + sx * h + gp, py + sy * h + gp, h - gp * 2 + 0.5, h - gp * 2 + 0.5);
        g.fillStyle = 'rgba(255,255,255,0.10)'; g.fillRect(px + sx * h + gp, py + sy * h + gp, h - gp * 2, gp * 1.4);
      }
      break;
    }
    case S.SLAB: {
      g.fillStyle = mix('#5e646a', '#696f75', hash2(tx >> 1, ty >> 1)); g.fillRect(px, py, R + 0.6, R + 0.6);
      g.fillStyle = 'rgba(20,22,26,0.4)';
      if (tx % 2 === 0) g.fillRect(px, py, lw, R);
      if (ty % 2 === 0) g.fillRect(px, py, R, lw);
      dots(g, tx, ty, R, 4, 31, ['rgba(255,255,255,0.07)', 'rgba(0,0,0,0.14)'], 0.035);
      if (hash2(tx * 3, ty * 5) > 0.9) oval(g, px + R * 0.5, py + R * 0.5, R * 0.3, R * 0.2, 'rgba(18,18,20,0.22)', hash2(tx, ty) * 3);
      break;
    }
    case S.ASPHALT: {
      g.fillStyle = '#2f343b'; g.fillRect(px, py, R + 0.6, R + 0.6);
      dots(g, tx, ty, R, 9, 3, ['rgba(255,255,255,0.09)', 'rgba(0,0,0,0.22)', 'rgba(255,255,255,0.05)'], 0.03);
      if (hash2(tx * 7, ty * 3) > 0.93) {
        g.strokeStyle = 'rgba(8,10,12,0.55)'; g.lineWidth = lw; g.lineCap = 'round'; g.beginPath();
        let cx = px + R * 0.1, cy = py + R * hash2(tx, ty * 9); g.moveTo(cx, cy);
        for (let k = 0; k < 4; k++) { cx += R * 0.22; cy += R * (hash2(tx + k, ty) - 0.5) * 0.35; g.lineTo(cx, cy); }
        g.stroke();
      }
      break;
    }
    case S.PAVER: {
      g.fillStyle = '#5a626b'; g.fillRect(px, py, R + 0.6, R + 0.6);
      const rows = 4, rh = R / rows, bw = R / 2;
      for (let r = 0; r < rows; r++) {
        const gr = ty * rows + r, off = gr % 2 ? bw / 2 : 0;
        for (let b = -1; b < 3; b++) {
          const bx = px + b * bw + off, x0 = Math.max(px, bx), x1 = Math.min(px + R, bx + bw);
          if (x1 <= x0) continue;
          const id = tx * 2 + b + (gr % 2 ? 1000 : 0);
          g.fillStyle = mix('#626a73', '#737b84', hash2(id, gr));
          g.fillRect(x0 + (bx >= px ? lw * 0.5 : 0), py + r * rh + lw * 0.5, x1 - x0 - (bx >= px ? lw * 0.5 : 0) + 0.3, rh - lw * 0.5 + 0.3);
        }
      }
      break;
    }
    case S.CONCRETE: {
      g.fillStyle = mix('#5b626b', '#646b74', hash2(tx >> 1, (ty >> 1) + 9)); g.fillRect(px, py, R + 0.6, R + 0.6);
      g.fillStyle = 'rgba(20,24,28,0.38)';
      if (tx % 2 === 0) g.fillRect(px, py, lw, R);
      if (ty % 2 === 0) g.fillRect(px, py, R, lw);
      dots(g, tx, ty, R, 5, 17, ['rgba(255,255,255,0.06)', 'rgba(0,0,0,0.16)'], 0.03);
      break;
    }
    case S.GRASS: case S.FOREST: {
      const forest = kind === S.FOREST;
      g.fillStyle = forest ? '#2f4733' : '#3f5f3b'; g.fillRect(px, py, R + 0.6, R + 0.6);
      g.lineCap = 'round'; g.lineWidth = Math.max(1, R * 0.03);
      for (let k = 0; k < 10; k++) {
        const hx = hash2(tx * 17 + k, ty * 3 + 5), hy = hash2(tx * 3 + 9, ty * 19 + k), hk = hash2(tx + k * 7, ty - k);
        g.strokeStyle = hk > 0.5 ? (forest ? 'rgba(86,122,74,0.5)' : 'rgba(112,158,92,0.55)') : 'rgba(22,40,24,0.5)';
        const x = px + hx * R, y = py + hy * R;
        g.beginPath(); g.moveTo(x, y); g.lineTo(x + (hk - 0.5) * R * 0.08, y - R * (0.06 + 0.06 * hk)); g.stroke();
      }
      if (forest) dots(g, tx, ty, R, 5, 41, ['rgba(120,96,54,0.5)', 'rgba(150,120,60,0.4)', 'rgba(20,32,22,0.5)'], 0.045);
      else if (hash2(tx * 9, ty * 4) > 0.9) dots(g, tx, ty, R, 3, 53, ['rgba(240,236,200,0.7)', 'rgba(236,200,96,0.7)'], 0.035);
      break;
    }
    case S.DIRT: {
      g.fillStyle = '#75634a'; g.fillRect(px, py, R + 0.6, R + 0.6);
      dots(g, tx, ty, R, 8, 61, ['rgba(160,140,108,0.5)', 'rgba(52,42,30,0.45)', 'rgba(120,104,80,0.5)'], 0.04);
      break;
    }
    case S.GRAVEL: {
      g.fillStyle = '#65645e'; g.fillRect(px, py, R + 0.6, R + 0.6);
      dots(g, tx, ty, R, 18, 71, ['rgba(150,148,140,0.6)', 'rgba(52,52,48,0.5)', 'rgba(120,118,110,0.6)', 'rgba(88,86,80,0.6)'], 0.045);
      break;
    }
    case S.WATER: {
      g.fillStyle = '#215c7a'; g.fillRect(px, py, R + 0.6, R + 0.6);
      g.strokeStyle = 'rgba(140,205,232,0.3)'; g.lineWidth = Math.max(1, R * 0.035); g.lineCap = 'round';
      for (let k = 0; k < 2; k++) {
        const y = py + R * (0.25 + 0.5 * hash2(tx * 3 + k, ty * 7)), x = px + R * hash2(tx + k, ty * 5) * 0.5;
        g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + R * 0.18, y - R * 0.07, x + R * 0.4, y); g.stroke();
      }
      break;
    }
    default: g.fillStyle = '#0a0e13'; g.fillRect(px, py, R + 0.6, R + 0.6);
  }
}

// ───────────────────────── 가구 ─────────────────────────
const FABRIC = ['#5f7088', '#80594a', '#5b7a68', '#6c6584', '#8a7a52'];
const BOXES = ['#d9694f', '#e8c15a', '#5fa8c9', '#7fbf7a', '#c98ad0', '#e39a52', '#e6e6e6'];

function furniture(g: G, kind: number, h: number, woodFloor: boolean): void {
  // 단위 좌표: 타일 한 칸 = 1, 원점은 칸의 중심, 벽 쪽이 -y
  const hv = (k: number): number => hash2((h * 1e6) | 0, k);
  const body = (draw: () => void): void => {
    g.save(); g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = SHADOW_R * 0.2; g.shadowOffsetX = SHADOW_R * 0.05; g.shadowOffsetY = SHADOW_R * 0.08; draw(); g.restore();
  };
  const wood = woodFloor ? '#5d442e' : '#8b6b47', woodTop = woodFloor ? '#6f5339' : '#a07d55';
  switch (kind) {
    case DECOR.BED: {
      const bl = ['#4d6a90', '#7c4b55', '#4e7b63', '#8d7c4a', '#646c7a'][(hv(1) * 5) | 0];
      body(() => rr(g, -0.44, -0.49, 0.88, 0.96, 0.05, '#4a3524'));
      rr(g, -0.4, -0.42, 0.8, 0.87, 0.06, '#ebe6da');
      rr(g, -0.27, -0.38, 0.54, 0.2, 0.07, '#ffffff');
      rr(g, -0.27, -0.2, 0.54, 0.02, 0.01, 'rgba(0,0,0,0.12)');
      rr(g, -0.4, -0.1, 0.8, 0.55, 0.05, bl);
      rr(g, -0.4, -0.1, 0.8, 0.08, 0.03, shade(bl, 0.25));
      seg(g, -0.2, 0.06, -0.1, 0.4, 0.012, 'rgba(0,0,0,0.14)'); seg(g, 0.16, 0.02, 0.22, 0.42, 0.012, 'rgba(0,0,0,0.12)');
      g.fillStyle = '#3a2819'; g.fillRect(-0.46, -0.5, 0.92, 0.07);
      break;
    }
    case DECOR.DESK: {
      body(() => rr(g, -0.47, -0.47, 0.94, 0.48, 0.03, wood));
      rr(g, -0.45, -0.45, 0.9, 0.44, 0.02, woodTop);
      rr(g, -0.19, -0.44, 0.38, 0.045, 0.01, '#14181d'); rr(g, -0.05, -0.4, 0.1, 0.05, 0.01, '#2a3038');
      rr(g, -0.17, -0.25, 0.34, 0.1, 0.02, '#262c33'); rr(g, -0.155, -0.24, 0.31, 0.08, 0.01, '#3a424c');
      g.save(); g.translate(0.31, -0.28); g.rotate(0.3); rr(g, -0.07, -0.09, 0.14, 0.18, 0.005, '#f1efe8'); g.restore();
      disc(g, -0.33, -0.3, 0.045, '#d8d2c4'); disc(g, -0.33, -0.3, 0.028, '#4a3222');
      body(() => disc(g, 0.02, 0.24, 0.16, '#252c34'));
      disc(g, 0.02, 0.24, 0.125, '#39434e');
      rr(g, -0.14, 0.34, 0.32, 0.08, 0.04, '#1b2128');
      break;
    }
    case DECOR.TABLE: {
      for (const [sx, sy] of [[-0.36, 0.02], [0.36, 0.02], [0, 0.38]]) { body(() => disc(g, sx, sy, 0.095, '#3b434c')); disc(g, sx, sy, 0.07, '#56616d'); }
      body(() => disc(g, 0, -0.06, 0.33, wood));
      disc(g, 0, -0.06, 0.3, woodTop);
      g.strokeStyle = 'rgba(255,240,210,0.12)'; g.lineWidth = 0.015; g.beginPath(); g.arc(0, -0.06, 0.24, 3.4, 4.9); g.stroke();
      disc(g, -0.12, -0.1, 0.075, '#f2efe8'); disc(g, -0.12, -0.1, 0.05, '#dcd7cb');
      disc(g, 0.13, 0.02, 0.075, '#f2efe8'); disc(g, 0.13, 0.02, 0.05, '#dcd7cb');
      disc(g, 0.04, -0.2, 0.035, '#c9d6e2'); disc(g, 0.04, -0.2, 0.022, '#6d4a2c');
      break;
    }
    case DECOR.SOFA: {
      const f = FABRIC[(hv(2) * FABRIC.length) | 0];
      body(() => rr(g, -0.48, -0.46, 0.96, 0.8, 0.09, shade(f, -0.22)));
      rr(g, -0.48, -0.46, 0.96, 0.24, 0.09, shade(f, -0.3));
      rr(g, -0.48, -0.3, 0.16, 0.64, 0.07, shade(f, -0.12)); rr(g, 0.32, -0.3, 0.16, 0.64, 0.07, shade(f, -0.12));
      rr(g, -0.31, -0.24, 0.305, 0.55, 0.06, f); rr(g, 0.005, -0.24, 0.305, 0.55, 0.06, f);
      rr(g, -0.29, -0.22, 0.265, 0.12, 0.05, shade(f, 0.14)); rr(g, 0.025, -0.22, 0.265, 0.12, 0.05, shade(f, 0.14));
      g.save(); g.translate(-0.2, -0.02); g.rotate(0.35); rr(g, -0.08, -0.08, 0.16, 0.16, 0.03, ['#e3c467', '#d9785c', '#8fc3b0'][(hv(3) * 3) | 0]); g.restore();
      break;
    }
    case DECOR.CABINET: {
      const c = woodFloor ? '#6b5237' : '#7f8993';
      body(() => rr(g, -0.47, -0.48, 0.94, 0.46, 0.02, shade(c, -0.25)));
      rr(g, -0.45, -0.47, 0.9, 0.4, 0.015, c);
      g.fillStyle = 'rgba(0,0,0,0.28)'; g.fillRect(-0.151, -0.47, 0.012, 0.4); g.fillRect(0.149, -0.47, 0.012, 0.4);
      g.fillStyle = 'rgba(255,255,255,0.14)'; g.fillRect(-0.45, -0.47, 0.9, 0.03);
      for (const hx of [-0.3, 0, 0.3]) rr(g, hx - 0.03, -0.06, 0.06, 0.018, 0.008, '#d6d0c2');
      if (hv(4) > 0.4) { rr(g, -0.36, -0.42, 0.2, 0.14, 0.01, '#b55b46'); rr(g, -0.34, -0.4, 0.2, 0.14, 0.01, '#d3c7a2'); }
      if (hv(5) > 0.5) { disc(g, 0.28, -0.3, 0.07, '#a8643f'); disc(g, 0.28, -0.3, 0.05, '#4f8a55'); }
      break;
    }
    case DECOR.CRATE: {
      const crate = (x: number, y: number, sz: number, c: string): void => {
        body(() => rr(g, x - sz / 2, y - sz / 2, sz, sz, 0.015, shade(c, -0.3)));
        rr(g, x - sz / 2 + 0.03, y - sz / 2 + 0.03, sz - 0.06, sz - 0.06, 0.01, c);
        g.fillStyle = 'rgba(40,24,8,0.3)';
        for (let k = 1; k < 4; k++) g.fillRect(x - sz / 2 + 0.03, y - sz / 2 + (sz * k) / 4, sz - 0.06, 0.014);
        seg(g, x - sz / 2 + 0.06, y - sz / 2 + 0.06, x + sz / 2 - 0.06, y + sz / 2 - 0.06, 0.045, shade(c, -0.18));
        seg(g, x - sz / 2 + 0.06, y - sz / 2 + 0.06, x + sz / 2 - 0.06, y + sz / 2 - 0.06, 0.02, shade(c, 0.12));
      };
      crate(-0.02, -0.04, 0.84, '#a37d4c');
      if (hv(6) > 0.45) { g.save(); g.translate(0.1, 0.02); g.rotate(0.22); crate(0, 0, 0.46, '#b48d58'); g.restore(); }
      break;
    }
    case DECOR.MACHINE: {
      body(() => rr(g, -0.47, -0.47, 0.94, 0.9, 0.04, '#3f4a52'));
      rr(g, -0.44, -0.44, 0.88, 0.84, 0.03, '#5c6972');
      rr(g, -0.4, -0.4, 0.5, 0.5, 0.03, '#6f7d86');
      g.fillStyle = 'rgba(20,26,30,0.55)'; for (let k = 0; k < 5; k++) g.fillRect(-0.36, -0.35 + k * 0.09, 0.42, 0.035);
      disc(g, 0.25, -0.2, 0.15, '#333c43'); disc(g, 0.25, -0.2, 0.1, '#4d5860'); disc(g, 0.25, -0.2, 0.04, '#232a30');
      rr(g, -0.4, 0.16, 0.8, 0.14, 0.02, '#20262b');
      disc(g, -0.3, 0.23, 0.03, '#5ad17a'); disc(g, -0.2, 0.23, 0.03, '#ffd166'); disc(g, -0.1, 0.23, 0.03, '#ff5d5d');
      rr(g, 0.06, 0.19, 0.28, 0.08, 0.01, '#33414b');
      g.save(); g.beginPath(); g.rect(-0.44, 0.33, 0.88, 0.07); g.clip();
      for (let k = -1; k < 12; k++) { g.fillStyle = k % 2 ? '#1c1c1c' : '#e8b93a'; g.beginPath(); g.moveTo(-0.44 + k * 0.09, 0.4); g.lineTo(-0.35 + k * 0.09, 0.4); g.lineTo(-0.29 + k * 0.09, 0.33); g.lineTo(-0.38 + k * 0.09, 0.33); g.closePath(); g.fill(); }
      g.restore();
      break;
    }
    case DECOR.COUNTER: {
      body(() => rr(g, -0.5, -0.47, 1.0, 0.54, 0.02, '#77716a'));
      rr(g, -0.5, -0.47, 1.0, 0.48, 0.02, '#c2bcb0');
      g.fillStyle = 'rgba(255,255,255,0.16)'; g.fillRect(-0.5, -0.47, 1.0, 0.035);
      const v = hv(7);
      if (v < 0.4) { rr(g, -0.17, -0.38, 0.34, 0.28, 0.03, '#252b32'); rr(g, -0.12, -0.35, 0.24, 0.1, 0.01, '#5fd1a0'); rr(g, -0.12, -0.22, 0.24, 0.09, 0.01, '#3b444e'); }
      else if (v < 0.75) { for (let k = 0; k < 3; k++) rr(g, -0.36 + k * 0.25, -0.36 + 0.05 * hv(8 + k), 0.2, 0.2, 0.015, BOXES[(hv(11 + k) * BOXES.length) | 0]); }
      else { disc(g, -0.2, -0.24, 0.1, '#d9dee2'); disc(g, -0.2, -0.24, 0.07, '#aab3ba'); rr(g, 0.08, -0.36, 0.26, 0.2, 0.01, '#e9e4d5'); }
      break;
    }
    case DECOR.PLANT: {
      body(() => disc(g, 0, 0, 0.21, '#8f5334'));
      disc(g, 0, 0, 0.18, '#b56b45'); disc(g, 0, 0, 0.14, '#33241a');
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * 6.2832 + hv(20) * 2, len = 0.24 + 0.1 * hv(21 + k);
        g.save(); g.rotate(a);
        oval(g, len * 0.6, 0, len * 0.62, 0.075, k % 2 ? '#3f8a50' : '#56a364');
        seg(g, 0.04, 0, len * 1.1, 0, 0.012, 'rgba(20,60,30,0.6)');
        g.restore();
      }
      disc(g, 0, 0, 0.05, '#6fbf7a');
      break;
    }
    case DECOR.KITCHEN: {
      const v = hv(30);
      if (v > 0.7) {
        body(() => rr(g, -0.42, -0.48, 0.84, 0.66, 0.05, '#c4cad0'));
        rr(g, -0.4, -0.46, 0.8, 0.6, 0.04, '#eceff1');
        g.fillStyle = 'rgba(0,0,0,0.16)'; g.fillRect(-0.4, 0.1, 0.8, 0.014);
        rr(g, 0.26, -0.3, 0.035, 0.3, 0.015, '#9aa3ab');
        break;
      }
      body(() => rr(g, -0.5, -0.48, 1.0, 0.6, 0.02, '#8b8f93'));
      rr(g, -0.5, -0.48, 1.0, 0.55, 0.02, '#cdc8bd');
      g.fillStyle = '#8f969c'; g.fillRect(-0.5, -0.5, 1.0, 0.055);
      if (v < 0.35) {
        rr(g, -0.3, -0.38, 0.6, 0.36, 0.05, '#a9b3bb'); rr(g, -0.26, -0.34, 0.52, 0.28, 0.04, '#7c8790');
        disc(g, 0, -0.2, 0.03, '#454d55');
        seg(g, 0, -0.42, 0, -0.3, 0.035, '#d5dade'); disc(g, 0, -0.43, 0.035, '#c2c8cd');
      } else {
        rr(g, -0.36, -0.4, 0.72, 0.42, 0.03, '#1b2025');
        for (const [bx, by] of [[-0.2, -0.3], [0.2, -0.3], [-0.2, -0.09], [0.2, -0.09]]) { g.strokeStyle = '#69727b'; g.lineWidth = 0.022; g.beginPath(); g.arc(bx, by, 0.07, 0, 6.2832); g.stroke(); disc(g, bx, by, 0.025, '#3d454d'); }
        if (hv(31) > 0.5) { disc(g, -0.2, -0.3, 0.085, '#5a6168'); disc(g, -0.2, -0.3, 0.065, '#30363c'); seg(g, -0.13, -0.24, -0.02, -0.14, 0.03, '#23282d'); }
      }
      break;
    }
    case DECOR.SHELF: {
      body(() => rr(g, -0.49, -0.47, 0.98, 0.42, 0.015, '#3d454e'));
      rr(g, -0.47, -0.45, 0.94, 0.36, 0.01, '#59636e');
      for (let r = 0; r < 2; r++) for (let k = 0; k < 6; k++) rr(g, -0.45 + k * 0.152, -0.435 + r * 0.175, 0.13, 0.15, 0.012, BOXES[(hv(40 + r * 7 + k) * BOXES.length) | 0]);
      break;
    }
  }
}
let SHADOW_R = 32;

/** 키 큰 진열대 (시야를 가리는 벽 칸). 세로로 이어진 줄을 기준으로 양쪽에 상품이 놓인다. */
function tallShelf(g: G, h: number): void {
  const hv = (k: number): number => hash2((h * 1e6) | 0, k);
  g.save(); g.shadowColor = 'rgba(0,0,0,0.55)'; g.shadowBlur = SHADOW_R * 0.3; g.shadowOffsetX = SHADOW_R * 0.08; g.shadowOffsetY = SHADOW_R * 0.12;
  rr(g, -0.44, -0.5, 0.88, 1.0, 0.015, '#343b44'); g.restore();
  rr(g, -0.42, -0.5, 0.84, 1.0, 0.01, '#4d5661');
  g.fillStyle = '#2a3038'; g.fillRect(-0.03, -0.5, 0.06, 1.0);
  for (let side = 0; side < 2; side++) for (let k = 0; k < 4; k++) {
    const x = side ? 0.05 : -0.4, y = -0.47 + k * 0.24;
    rr(g, x, y, 0.35, 0.2, 0.015, BOXES[(hv(60 + side * 5 + k) * BOXES.length) | 0]);
    g.fillStyle = 'rgba(0,0,0,0.18)'; g.fillRect(x + 0.17, y, 0.012, 0.2);
  }
}

// ───────────────────────── 벽 ─────────────────────────
interface WallGeo { hw: Float32Array; connected: (x: number, y: number) => boolean }

function wallGeo(s: Scene): WallGeo {
  const n = s.w * s.h, hw = new Float32Array(n);
  const part = (x: number, y: number): boolean => {
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) return false;
    const i = y * s.w + x, t = s.tiles[i];
    return (isWallish(t) && s.decor[i] !== DECOR.SHELF) || t === T.DOOR;
  };
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    if (!part(x, y)) continue;
    let ext = false;
    for (let yy = y - 1; yy <= y + 1 && !ext; yy++) for (let xx = x - 1; xx <= x + 1; xx++) {
      if (xx < 0 || yy < 0 || xx >= s.w || yy >= s.h || !isBuilding(s.tiles[yy * s.w + xx])) { ext = true; break; }
    }
    hw[y * s.w + x] = ext ? 0.27 : 0.17;
  }
  return { hw, connected: part };
}

/** 벽 도형(사각형 모음)을 경로에 넣는다. k 는 두께 배율. */
function wallPath(s: Scene, geo: WallGeo, R: number, k: number): Path2D {
  const p = new Path2D();
  const add = (x: number, y: number, w: number, h: number): void => p.rect(x * R, y * R, w * R, h * R);
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const i = y * s.w + x, h0 = geo.hw[i];
    if (!h0) continue;
    const t = s.tiles[i], hw = h0 * k;
    const l = geo.connected(x - 1, y), r = geo.connected(x + 1, y), u = geo.connected(x, y - 1), d = geo.connected(x, y + 1);
    if (t === T.DOOR) {
      const J = 0.1;                                    // 문설주
      if (l || r) { add(x, y + 0.5 - hw, J, hw * 2); add(x + 1 - J, y + 0.5 - hw, J, hw * 2); }
      else { add(x + 0.5 - hw, y, hw * 2, J); add(x + 0.5 - hw, y + 1 - J, hw * 2, J); }
      continue;
    }
    add(x + 0.5 - hw, y + 0.5 - hw, hw * 2, hw * 2);
    const arm = (nx: number, ny: number): number => Math.min(h0, geo.hw[ny * s.w + nx]) * k;
    if (l) { const a = arm(x - 1, y); add(x, y + 0.5 - a, 0.5, a * 2); }
    if (r) { const a = arm(x + 1, y); add(x + 0.5, y + 0.5 - a, 0.5, a * 2); }
    if (u) { const a = arm(x, y - 1); add(x + 0.5 - a, y, a * 2, 0.5); }
    if (d) { const a = arm(x, y + 1); add(x + 0.5 - a, y + 0.5, a * 2, 0.5); }
  }
  return p;
}

/** 문이 놓인 방향: 벽이 좌우로 이어지면 true (문은 위아래로 지나간다) */
export function doorHorizontal(s: Scene, x: number, y: number): boolean {
  const w = (xx: number, yy: number): boolean => xx >= 0 && yy >= 0 && xx < s.w && yy < s.h && isWallish(s.tiles[yy * s.w + xx]);
  return w(x - 1, y) || w(x + 1, y);
}

// ───────────────────────── 조립 ─────────────────────────
let grain: HTMLCanvasElement | null = null;
function grainCanvas(): HTMLCanvasElement {
  if (grain) return grain;
  const c = document.createElement('canvas'); c.width = c.height = 160;
  const g = c.getContext('2d')!, im = g.createImageData(160, 160);
  for (let i = 0; i < 160 * 160; i++) { const v = 128 + (hash2(i, 9173) - 0.5) * 120; im.data[i * 4] = im.data[i * 4 + 1] = im.data[i * 4 + 2] = v; im.data[i * 4 + 3] = 255; }
  g.putImageData(im, 0, 0);
  return (grain = c);
}

function tree(g: G, x: number, y: number, R: number, h: number): void {
  // 수관: 어두운 덩어리 위에 밝은 덩어리를 왼쪽 위로 겹쳐 입체감을 낸다
  const tones = h > 0.66 ? ['#1d4a2c', '#2a6238', '#3a7c46', '#4f9656'] : h > 0.33 ? ['#234b27', '#33642f', '#467e3a', '#5c9648'] : ['#1f4433', '#2c5a40', '#3a7250', '#4c8a60'];
  const blobs = 6;
  for (let layer = 0; layer < 4; layer++) {
    const rad = R * (0.56 - layer * 0.11), off = -layer * R * 0.055;
    for (let k = 0; k < blobs; k++) {
      const a = (k / blobs) * 6.2832 + h * 6, d = R * (0.27 - layer * 0.05) * (0.6 + 0.6 * hash2((h * 9999) | 0, k + layer * 7));
      disc(g, x + Math.cos(a) * d + off, y + Math.sin(a) * d + off, rad * (0.62 + 0.3 * hash2(k, (h * 7777) | 0)), tones[layer]);
    }
  }
  for (let k = 0; k < 5; k++) disc(g, x + (hash2(k, (h * 555) | 0) - 0.6) * R * 0.5, y + (hash2((h * 333) | 0, k) - 0.6) * R * 0.5, R * 0.035, 'rgba(190,230,150,0.35)');
}

export function buildStatic(s: Scene, R: number, district: string): StaticLayer {
  SHADOW_R = R;
  const W = s.w * R, H = s.h * R;
  const base = document.createElement('canvas'); base.width = W; base.height = H;
  const g = base.getContext('2d')!;
  const surf = surfaceMap(s, district);
  const sAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= s.w || y >= s.h ? S.VOID : surf[y * s.w + x]);
  const tAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= s.w || y >= s.h ? T.VOID : s.tiles[y * s.w + x]);
  const lw = Math.max(1, R * 0.03);

  // 1) 바닥. 벽 칸은 네 귀퉁이를 각각 이웃한 바닥으로 채운다(벽은 칸보다 얇게 그리므로).
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const k = surf[y * s.w + x];
    if (k !== S.WALL) { paintTile(g, k, x, y, R); continue; }
    for (let q = 0; q < 4; q++) {
      const dx = q % 2 ? 1 : -1, dy = q >= 2 ? 1 : -1;
      const sh = sAt(x + dx, y), sv = sAt(x, y + dy), sd = sAt(x + dx, y + dy);
      let pick: number = sv !== S.WALL && sv !== S.VOID ? sv : sh !== S.WALL && sh !== S.VOID ? sh : sd !== S.WALL && sd !== S.VOID ? sd : S.VOID;
      if (pick === S.VOID) { const any = [sAt(x - 1, y), sAt(x + 1, y), sAt(x, y - 1), sAt(x, y + 1)].find((v) => v !== S.WALL && v !== S.VOID); pick = any ?? S.CONCRETE; }
      g.save(); g.beginPath(); g.rect((x + (dx > 0 ? 0.5 : 0)) * R, (y + (dy > 0 ? 0.5 : 0)) * R, R / 2 + 0.6, R / 2 + 0.6); g.clip();
      paintTile(g, pick, x, y, R);
      g.restore();
    }
  }
  // 1-1) 개울과 흙길: 칸 모양이 드러나지 않게 굵은 선으로 이어 그린다
  {
    const isWater = (x: number, y: number): boolean => {
      const t = tAt(x, y);
      if (t === T.WATER) return true;
      // 개울을 건너는 길(다리) 아래로도 물은 흐른다
      if (t !== T.TRAIL) return false;
      let n = 0; for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (tAt(x + dx, y + dy) === T.WATER) n++;
      return n >= 2 || (n === 1 && (y === 0 || y === s.h - 1));
    };
    const isTrail = (x: number, y: number): boolean => tAt(x, y) === T.TRAIL;
    const trace = (test: (x: number, y: number) => boolean): Path2D => {
      const p = new Path2D();
      for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
        if (!test(x, y)) continue;
        const cx = (x + 0.5) * R, cy = (y + 0.5) * R;
        p.moveTo(cx, cy); p.lineTo(cx + 0.01, cy);
        if (test(x + 1, y)) { p.moveTo(cx, cy); p.lineTo(cx + R, cy); }
        if (test(x, y + 1)) { p.moveTo(cx, cy); p.lineTo(cx, cy + R); }
        // 화면 밖으로 이어지는 것처럼 가장자리까지 뻗는다
        if (x === 0) { p.moveTo(cx, cy); p.lineTo(-R, cy); } else if (x === s.w - 1) { p.moveTo(cx, cy); p.lineTo(W + R, cy); }
        if (y === 0) { p.moveTo(cx, cy); p.lineTo(cx, -R); } else if (y === s.h - 1) { p.moveTo(cx, cy); p.lineTo(cx, H + R); }
      }
      return p;
    };
    g.save(); g.lineCap = 'round'; g.lineJoin = 'round';
    const trail = trace(isTrail), water = trace(isWater);
    g.strokeStyle = 'rgba(96,82,60,0.4)'; g.lineWidth = R * 1.02; g.stroke(trail);
    g.strokeStyle = '#75634a'; g.lineWidth = R * 0.8; g.stroke(trail);
    g.strokeStyle = 'rgba(140,122,94,0.5)'; g.lineWidth = R * 0.42; g.stroke(trail);
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      if (!isTrail(x, y)) continue;
      for (let k = 0; k < 6; k++) {
        const hx = 0.5 + (hash2(x * 13 + k, y * 7 + 61) - 0.5) * 0.6, hy = 0.5 + (hash2(x * 5 + 61, y * 11 + k) - 0.5) * 0.6;
        g.fillStyle = ['rgba(165,146,112,0.6)', 'rgba(52,42,30,0.5)', 'rgba(120,104,80,0.6)'][k % 3];
        const d = R * (0.03 + 0.03 * hash2(k, x + y)); g.fillRect((x + hx) * R, (y + hy) * R, d, d);
      }
    }
    g.strokeStyle = 'rgba(22,32,24,0.55)'; g.lineWidth = R * 1.08; g.stroke(water);
    g.strokeStyle = 'rgba(176,214,222,0.55)'; g.lineWidth = R * 0.94; g.stroke(water);
    g.strokeStyle = '#1f5874'; g.lineWidth = R * 0.86; g.stroke(water);
    g.strokeStyle = '#2a6f8f'; g.lineWidth = R * 0.5; g.stroke(water);
    g.strokeStyle = 'rgba(150,212,236,0.32)'; g.lineWidth = Math.max(1, R * 0.035);
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      if (!isWater(x, y)) continue;
      for (let k = 0; k < 2; k++) {
        const yy = (y + 0.3 + 0.4 * hash2(x * 3 + k, y * 7)) * R, xx = (x + 0.22 + hash2(x + k, y * 5) * 0.3) * R;
        g.beginPath(); g.moveTo(xx, yy); g.quadraticCurveTo(xx + R * 0.12, yy - R * 0.06, xx + R * 0.28, yy); g.stroke();
      }
    }
    // 다리: 물 위를 지나는 길에 나무 상판
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      if (!isTrail(x, y) || !isWater(x, y)) continue;
      const across = tAt(x, y - 1) === T.WATER || tAt(x, y + 1) === T.WATER;          // 물이 위아래로 흐른다 → 다리는 좌우로 놓인다
      g.save(); g.translate((x + 0.5) * R, (y + 0.5) * R); if (!across) g.rotate(Math.PI / 2); g.scale(R, R);
      rr(g, -0.62, -0.36, 1.3, 0.78, 0.03, 'rgba(0,0,0,0.35)');
      rr(g, -0.66, -0.4, 1.32, 0.8, 0.03, '#6b4f33');
      for (let k = 0; k < 8; k++) { g.fillStyle = k % 2 ? '#8a6a45' : '#7d5f3d'; g.fillRect(-0.64 + k * 0.16, -0.38, 0.15, 0.76); }
      g.fillStyle = '#4a3522'; g.fillRect(-0.66, -0.42, 1.32, 0.06); g.fillRect(-0.66, 0.36, 1.32, 0.06);
      g.restore();
    }
    g.restore();
  }
  // 2) 큰 얼룩과 잔 입자: 재질이 칸 단위로 반복되어 보이지 않게 한다
  const blot = document.createElement('canvas'); blot.width = s.w * 2; blot.height = s.h * 2;
  const bg = blot.getContext('2d')!, bim = bg.createImageData(blot.width, blot.height);
  for (let i = 0; i < blot.width * blot.height; i++) { const v = 96 + hash2(i, s.id * 31 + 7) * 96; bim.data[i * 4] = bim.data[i * 4 + 1] = bim.data[i * 4 + 2] = v; bim.data[i * 4 + 3] = 255; }
  bg.putImageData(bim, 0, 0);
  g.save(); g.imageSmoothingEnabled = true; g.imageSmoothingQuality = 'high';
  g.globalCompositeOperation = 'soft-light'; g.globalAlpha = 0.5; g.drawImage(blot, 0, 0, W, H);
  g.globalCompositeOperation = 'overlay'; g.globalAlpha = 0.16; g.fillStyle = g.createPattern(grainCanvas(), 'repeat')!; g.fillRect(0, 0, W, H);
  g.restore();

  // 3) 재질 경계: 연석, 물가, 흙길 가장자리
  const soft = (k: number): boolean => k === S.GRASS || k === S.FOREST;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const a = sAt(x, y);
    if (a === S.WALL || a === S.VOID) continue;
    for (const [dx, dy] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) {
      const b = sAt(x + dx, y + dy);
      if (b === a || b === S.WALL || b === S.VOID) continue;
      // 이 칸(a) 안쪽, 이웃(b)과 맞닿은 변을 따라 띠를 그린다
      const strip = (w: number, col: string, inset = 0): void => {
        g.fillStyle = col;
        if (dx === 1) g.fillRect((x + 1) * R - (w + inset) * R, y * R, w * R, R);
        else if (dx === -1) g.fillRect(x * R + inset * R, y * R, w * R, R);
        else if (dy === 1) g.fillRect(x * R, (y + 1) * R - (w + inset) * R, R, w * R);
        else g.fillRect(x * R, y * R + inset * R, R, w * R);
      };
      if (b === S.ASPHALT && a !== S.ASPHALT) { strip(0.1, '#9aa1a8'); strip(0.025, 'rgba(255,255,255,0.25)', 0.075); strip(0.02, 'rgba(0,0,0,0.35)'); }
      else if (a === S.ASPHALT) strip(0.05, 'rgba(0,0,0,0.22)');
      else if (soft(a) && b === S.GRAVEL) {
        for (let k = 0; k < 4; k++) {
          const t = (k + hash2(x * 7 + k, y * 3 + dx)) / 4, rad = R * (0.08 + 0.1 * hash2(x + k, y * 5 + dy));
          const ex = dx ? (dx > 0 ? x + 1 : x) : x + t, ey = dy ? (dy > 0 ? y + 1 : y) : y + t;
          disc(g, ex * R, ey * R, rad, '#5f5e58');
        }
      } else if (soft(a) && !soft(b)) strip(0.03, 'rgba(14,26,14,0.4)');
    }
  }
  // 4) 도로 표시
  g.save();
  if (s.kind === 'traffic') {
    g.strokeStyle = 'rgba(236,236,224,0.72)'; g.lineWidth = R * 0.07; g.setLineDash([R * 0.9, R * 0.9]);
    for (const yy of [9, 11]) { g.beginPath(); g.moveTo(0, yy * R); g.lineTo(W, yy * R); g.stroke(); }
    g.setLineDash([]);
    g.strokeStyle = 'rgba(240,190,70,0.85)'; g.lineWidth = R * 0.055;
    for (const off of [-0.07, 0.07]) { g.beginPath(); g.moveTo(0, (10 + off) * R); g.lineTo(W, (10 + off) * R); g.stroke(); }
    g.strokeStyle = 'rgba(236,236,224,0.7)'; g.lineWidth = R * 0.06;
    for (const yy of [8.16, 11.84]) { g.beginPath(); g.moveTo(0, yy * R); g.lineTo(W, yy * R); g.stroke(); }
  } else {
    let top = -1; for (let y = 0; y < s.h; y++) if (tAt(0, y) === T.ROAD) { top = y; break; }
    if (top >= 0) {
      let bottom = top; while (bottom + 1 < s.h && tAt(0, bottom + 1) === T.ROAD) bottom++;
      g.strokeStyle = 'rgba(236,236,224,0.6)'; g.lineWidth = R * 0.06;
      g.beginPath(); g.moveTo(0, (top + 0.2) * R); g.lineTo(W, (top + 0.2) * R); g.stroke();
      if (bottom + 1 < s.h) { g.beginPath(); g.moveTo(0, (bottom + 0.8) * R); g.lineTo(W, (bottom + 0.8) * R); g.stroke(); }
      g.strokeStyle = bottom + 1 < s.h ? 'rgba(240,190,70,0.8)' : 'rgba(236,236,224,0.66)'; g.lineWidth = R * 0.07; g.setLineDash([R * 1.0, R * 0.9]);
      const mid = bottom + 1 < s.h ? (top + bottom + 1) / 2 : top + 1.55;
      g.beginPath(); g.moveTo(0, mid * R); g.lineTo(W, mid * R); g.stroke(); g.setLineDash([]);
      // 맨홀
      const mx = 6 + Math.floor(hash2(s.id, 5) * (s.w - 12)), my = top + 0.9;
      disc(g, (mx + 0.5) * R, (my + 0.5) * R, R * 0.3, '#22262b'); disc(g, (mx + 0.5) * R, (my + 0.5) * R, R * 0.26, '#3a4047');
      g.strokeStyle = 'rgba(0,0,0,0.4)'; g.lineWidth = lw;
      for (let k = -2; k <= 2; k++) { g.beginPath(); g.moveTo((mx + 0.5 + k * 0.09) * R, (my + 0.3) * R); g.lineTo((mx + 0.5 + k * 0.09) * R, (my + 0.7) * R); g.stroke(); }
    }
  }
  g.restore();
  // 타이어 자국·기름 얼룩 (교통사고)
  if (s.kind === 'traffic') {
    g.save(); g.strokeStyle = 'rgba(8,9,10,0.4)'; g.lineWidth = R * 0.09; g.lineCap = 'round';
    for (const p of s.props) {
      if (p.kind !== 'vehicle') continue;
      const cx = (p.x + p.w / 2) * R, cy = (p.y + 0.5) * R, a = (p.angle ?? 0) + Math.PI + (hash2(p.id, 3) - 0.5) * 0.5;
      for (const o of [-0.26, 0.26]) {
        g.beginPath(); g.moveTo(cx - Math.sin(a) * o * R, cy + Math.cos(a) * o * R);
        g.quadraticCurveTo(cx + Math.cos(a) * R * 1.6 - Math.sin(a) * o * R, cy + Math.sin(a) * R * 1.6 + Math.cos(a) * o * R + R * 0.3, cx + Math.cos(a) * R * 3.4 - Math.sin(a) * o * R, cy + Math.sin(a) * R * 3.4 + Math.cos(a) * o * R);
        g.stroke();
      }
    }
    g.restore();
  }

  // 5) 구역 표시: 안전 구역(응급 처치 깔개), 차량 대기 지점
  {
    const tx = Math.max(0.12, s.safe.x - 1.15) * R, ty = (s.safe.y - 0.6) * R, tw = 3.2 * R, th = 2.05 * R;
    g.save(); g.shadowColor = 'rgba(0,0,0,0.4)'; g.shadowBlur = R * 0.2; g.shadowOffsetY = R * 0.05;
    rr(g, tx, ty, tw, th, R * 0.08, '#2f7d58'); g.restore();
    rr(g, tx + R * 0.06, ty + R * 0.06, tw - R * 0.12, th - R * 0.12, R * 0.05, '#3a9469');
    g.strokeStyle = 'rgba(255,255,255,0.35)'; g.lineWidth = lw * 1.4; g.setLineDash([R * 0.18, R * 0.12]);
    g.strokeRect(tx + R * 0.16, ty + R * 0.16, tw - R * 0.32, th - R * 0.32); g.setLineDash([]);
    g.strokeStyle = 'rgba(10,40,26,0.25)'; g.lineWidth = lw;
    for (let k = 1; k < 4; k++) { g.beginPath(); g.moveTo(tx + (tw * k) / 4, ty + R * 0.06); g.lineTo(tx + (tw * k) / 4 + R * 0.04, ty + th - R * 0.06); g.stroke(); }
    for (const [gx, gy] of [[0.1, 0.1], [0.9, 0.1], [0.1, 0.9], [0.9, 0.9]]) { disc(g, tx + tw * gx * 0.94 + tw * 0.03, ty + th * gy * 0.9 + th * 0.05, R * 0.045, '#c9d3cf'); disc(g, tx + tw * gx * 0.94 + tw * 0.03, ty + th * gy * 0.9 + th * 0.05, R * 0.02, '#234a37'); }
    // 흰 십자
    const cxp = tx + tw - R * 0.42, cyp = ty + R * 0.42;
    rr(g, cxp - R * 0.2, cyp - R * 0.2, R * 0.4, R * 0.4, R * 0.06, 'rgba(255,255,255,0.92)');
    g.fillStyle = '#d6433a'; g.fillRect(cxp - R * 0.05, cyp - R * 0.14, R * 0.1, R * 0.28); g.fillRect(cxp - R * 0.14, cyp - R * 0.05, R * 0.28, R * 0.1);
  }
  // 6) 가로등
  const lamps: { x: number; y: number }[] = [];
  if (s.kind !== 'traffic' && s.kind !== 'search') {
    for (let y = 1; y < s.h; y++) {
      if (tAt(0, y) !== T.ROAD || tAt(0, y - 1) === T.ROAD) continue;
      for (const lx of [1, 9, 17, 25]) {
        const x = lx + ((hash2(s.id, lx) * 2) | 0);
        if (tAt(x, y - 1) !== T.GROUND) continue;
        const px = (x + 0.5) * R, py = (y - 0.42) * R;
        oval(g, px + R * 0.1, py + R * 0.3, R * 0.08, R * 0.26, 'rgba(0,0,0,0.25)');
        seg(g, px, py, px, py + R * 0.4, R * 0.06, '#353d46'); seg(g, px, py, px, py + R * 0.4, R * 0.025, '#77828d');
        rr(g, px - R * 0.075, py + R * 0.32, R * 0.15, R * 0.2, R * 0.04, '#aeb7c0'); rr(g, px - R * 0.045, py + R * 0.36, R * 0.09, R * 0.12, R * 0.025, '#fff3c4');
        disc(g, px, py, R * 0.08, '#2b3138'); disc(g, px, py, R * 0.045, '#59626c');
        lamps.push({ x, y: y - 0.5 });
      }
      break;
    }
  }
  // 바위
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    if (s.tiles[y * s.w + x] !== T.ROCK) continue;
    const cx = (x + 0.5) * R, cy = (y + 0.5) * R, h0 = hash2(x * 31, y * 17);
    const poly = (k: number, ox: number, oy: number): void => {
      g.beginPath();
      for (let q = 0; q < 8; q++) { const a = (q / 8) * 6.2832 + h0 * 3, rad = R * k * (0.75 + 0.35 * hash2(x * 5 + q, y * 3)); const px = cx + ox + Math.cos(a) * rad, py = cy + oy + Math.sin(a) * rad * 0.86; if (q) g.lineTo(px, py); else g.moveTo(px, py); }
      g.closePath(); g.fill();
    };
    g.save(); g.shadowColor = 'rgba(0,0,0,0.5)'; g.shadowBlur = R * 0.25; g.shadowOffsetX = R * 0.08; g.shadowOffsetY = R * 0.12; g.fillStyle = '#59616a'; poly(0.46, 0, 0); g.restore();
    g.fillStyle = '#7b848d'; poly(0.36, -R * 0.05, -R * 0.06);
    g.fillStyle = '#99a2aa'; poly(0.2, -R * 0.12, -R * 0.12);
    seg(g, cx - R * 0.05, cy + R * 0.05, cx + R * 0.22, cy + R * 0.18, lw, 'rgba(30,34,40,0.45)');
  }
  // 나무: 밑동과 땅에 드리운 그림자는 바닥 층에, 수관은 덮개 층에
  let hasTree = false;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    if (s.tiles[y * s.w + x] !== T.TREE) continue;
    hasTree = true;
    const cx = (x + 0.5) * R, cy = (y + 0.5) * R;
    oval(g, cx + R * 0.2, cy + R * 0.26, R * 0.62, R * 0.56, 'rgba(6,14,8,0.34)');
    disc(g, cx, cy, R * 0.12, '#3a2a1b'); disc(g, cx - R * 0.02, cy - R * 0.02, R * 0.07, '#5a4129');
  }

  // 7) 건물: 벽 그림자 → 가구 → 벽 → 창 → 문턱
  const geo = wallGeo(s);
  const full = wallPath(s, geo, R, 1);
  g.save(); g.shadowColor = 'rgba(0,0,0,0.6)'; g.shadowBlur = R * 0.5; g.shadowOffsetX = R * 0.12; g.shadowOffsetY = R * 0.17; g.fillStyle = '#10141a'; g.fill(full); g.restore();
  g.save(); g.shadowColor = 'rgba(0,0,0,0.35)'; g.shadowBlur = R * 0.3; g.fillStyle = '#10141a'; g.fill(full); g.restore();
  const woodFloor = s.floorMat === 0;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const i = y * s.w + x, d = s.decor[i];
    if (!d) continue;
    g.save(); g.translate((x + 0.5) * R, (y + 0.5) * R); g.scale(R, R);
    if (isWallish(s.tiles[i])) {
      const vertical = (tAt(x, y - 1) === T.WALL && s.decor[(y - 1) * s.w + x] === DECOR.SHELF) || (tAt(x, y + 1) === T.WALL && s.decor[(y + 1) * s.w + x] === DECOR.SHELF);
      if (!vertical) g.rotate(Math.PI / 2);
      tallShelf(g, hash2(x * 91, y * 53));
    } else if (s.tiles[i] === T.FURN) {
      const wl = (xx: number, yy: number): boolean => isWallish(tAt(xx, yy)) && s.decor[yy * s.w + xx] !== DECOR.SHELF;
      const ang = wl(x, y - 1) ? 0 : wl(x + 1, y) ? Math.PI / 2 : wl(x, y + 1) ? Math.PI : wl(x - 1, y) ? -Math.PI / 2 : 0;
      g.rotate(ang);
      furniture(g, d, hash2(x * 91, y * 53), woodFloor);
    }
    g.restore();
  }
  g.lineJoin = 'miter';
  g.strokeStyle = '#151a20'; g.lineWidth = Math.max(2, R * 0.07); g.stroke(full);
  g.fillStyle = '#8f99a3'; g.fill(full);
  g.fillStyle = '#bcc5cd'; g.fill(wallPath(s, geo, R, 0.56));
  g.fillStyle = 'rgba(255,255,255,0.18)'; g.fill(wallPath(s, geo, R, 0.18));
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const i = y * s.w + x, t = s.tiles[i];
    if (t === T.WINDOW) {
      const hw = geo.hw[i] * 0.62, hor = doorHorizontal(s, x, y) || !(geo.connected(x, y - 1) || geo.connected(x, y + 1));
      g.save(); g.translate((x + 0.5) * R, (y + 0.5) * R); if (!hor) g.rotate(Math.PI / 2); g.scale(R, R);
      rr(g, -0.46, -hw, 0.92, hw * 2, 0.02, '#20303c');
      rr(g, -0.44, -hw * 0.72, 0.88, hw * 1.44, 0.015, '#86d3ee');
      g.fillStyle = 'rgba(255,255,255,0.55)'; g.fillRect(-0.44, -hw * 0.72, 0.88, hw * 0.4);
      g.fillStyle = '#20303c'; g.fillRect(-0.012, -hw, 0.024, hw * 2);
      g.restore();
    } else if (t === T.DOOR) {
      const hw = geo.hw[i], hor = doorHorizontal(s, x, y);
      g.save(); g.translate((x + 0.5) * R, (y + 0.5) * R); if (!hor) g.rotate(Math.PI / 2); g.scale(R, R);
      g.fillStyle = 'rgba(0,0,0,0.2)'; g.fillRect(-0.4, -hw, 0.8, hw * 2);
      g.fillStyle = 'rgba(255,255,255,0.1)'; g.fillRect(-0.4, -hw, 0.8, 0.02); g.fillRect(-0.4, hw - 0.02, 0.8, 0.02);
      g.restore();
    }
  }
  // 출입구 앞 디딤판
  for (const e of s.exits) {
    if (isBuilding(tAt(e.x, e.y)) || tAt(e.x, e.y) === T.VOID) continue;
    rr(g, (e.x + 0.06) * R, (e.y + 0.06) * R, R * 0.88, R * 0.88, R * 0.06, 'rgba(160,168,176,0.5)');
    g.strokeStyle = 'rgba(20,24,28,0.4)'; g.lineWidth = lw; g.strokeRect((e.x + 0.06) * R, (e.y + 0.06) * R, R * 0.88, R * 0.88);
    g.fillStyle = 'rgba(40,46,52,0.5)'; for (let k = 0; k < 4; k++) g.fillRect((e.x + 0.16) * R, (e.y + 0.22 + k * 0.17) * R, R * 0.68, R * 0.05);
  }

  let over: HTMLCanvasElement | null = null;
  if (hasTree) {
    over = document.createElement('canvas'); over.width = W; over.height = H;
    const og = over.getContext('2d')!;
    for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
      if (s.tiles[y * s.w + x] !== T.TREE) continue;
      const jx = (hash2(x * 3, y * 7) - 0.5) * 0.24, jy = (hash2(x * 11, y * 5) - 0.5) * 0.24;
      tree(og, (x + 0.5 + jx) * R, (y + 0.5 + jy) * R, R, hash2(x * 37 + 1, y * 61 + 3));
    }
  }
  return { base, over, R, sig: staticSig(s), lamps };
}
