// 현장 효과: 화염, 연기, 물줄기, 빛, 날씨. 모두 시뮬레이션 상태(불·연기 격자, 효과 목록)를 읽어 그릴 뿐이다.

import type { Scene } from '../../sim/types';
import { hash2 } from './common';
import type { G } from './common';

function canvas(w: number, h: number): [HTMLCanvasElement, G] { const c = document.createElement('canvas'); c.width = w; c.height = h; return [c, c.getContext('2d')!]; }

function radial(size: number, stops: [number, string][]): HTMLCanvasElement {
  const [c, g] = canvas(size, size);
  const gr = g.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  for (const [p, col] of stops) gr.addColorStop(p, col);
  g.fillStyle = gr; g.fillRect(0, 0, size, size);
  return c;
}
/** 위로 솟는 불꽃 모양: 부드러운 원을 위로 갈수록 작게 겹친다. */
function flame(inner: string, outer: string): HTMLCanvasElement {
  const [c, g] = canvas(64, 96);
  g.globalCompositeOperation = 'lighter';
  for (let k = 0; k < 7; k++) {
    const cy = 70 - k * 9.5, r = 25 - k * 3.2;
    const gr = g.createRadialGradient(32, cy, 0, 32, cy, r);
    gr.addColorStop(0, inner); gr.addColorStop(0.55, outer); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.globalAlpha = 0.55 - k * 0.04; g.fillRect(0, 0, 64, 96);
  }
  return c;
}
/** 뭉게뭉게한 연기 덩어리 */
function puffSprite(r: number, gC: number, b: number): HTMLCanvasElement {
  const [c, g] = canvas(96, 96);
  for (let k = 0; k < 7; k++) {
    const a = (k / 7) * 6.2832, d = k === 0 ? 0 : 17 + 6 * hash2(k, r), cx = 48 + Math.cos(a) * d, cy = 48 + Math.sin(a) * d, rad = k === 0 ? 34 : 20 + 8 * hash2(r, k);
    const gr = g.createRadialGradient(cx, cy, 0, cx, cy, rad);
    gr.addColorStop(0, `rgba(${r},${gC},${b},0.6)`); gr.addColorStop(0.6, `rgba(${r},${gC},${b},0.28)`); gr.addColorStop(1, `rgba(${r},${gC},${b},0)`);
    g.fillStyle = gr; g.fillRect(0, 0, 96, 96);
  }
  return c;
}

let spr: { glow: HTMLCanvasElement; flameA: HTMLCanvasElement; flameB: HTMLCanvasElement; puff: HTMLCanvasElement; puffDark: HTMLCanvasElement; mist: HTMLCanvasElement; scorch: HTMLCanvasElement } | null = null;
function sprites() {
  if (!spr) {
    const [sc, sg] = canvas(96, 96);
    for (let k = 0; k < 9; k++) {
      const a = (k / 9) * 6.2832, d = k === 0 ? 0 : 20 + 9 * hash2(k, 3), cx = 48 + Math.cos(a) * d, cy = 48 + Math.sin(a) * d, rad = k === 0 ? 36 : 14 + 12 * hash2(5, k);
      const gr = sg.createRadialGradient(cx, cy, 0, cx, cy, rad);
      gr.addColorStop(0, 'rgba(6,5,5,0.75)'); gr.addColorStop(0.7, 'rgba(10,8,7,0.4)'); gr.addColorStop(1, 'rgba(10,8,7,0)');
      sg.fillStyle = gr; sg.fillRect(0, 0, 96, 96);
    }
    spr = {
      glow: radial(64, [[0, 'rgba(255,170,70,0.9)'], [0.4, 'rgba(255,95,30,0.5)'], [1, 'rgba(255,60,20,0)']]),
      flameA: flame('rgba(255,150,50,1)', 'rgba(255,70,20,0.6)'),
      flameB: flame('rgba(255,250,215,1)', 'rgba(255,205,90,0.7)'),
      puff: puffSprite(176, 180, 186), puffDark: puffSprite(58, 58, 62), mist: puffSprite(200, 230, 250), scorch: sc,
    };
  }
  return spr;
}

const lightCache = new Map<string, HTMLCanvasElement>();
/** 색깔 있는 빛 (가산 혼합으로 그린다) */
export function lightSprite(col: string): HTMLCanvasElement {
  let c = lightCache.get(col);
  if (!c) { c = radial(128, [[0, col + 'ff'], [0.25, col + '99'], [0.6, col + '33'], [1, col + '00']]); lightCache.set(col, c); }
  return c;
}
export function drawLight(g: G, x: number, y: number, r: number, col: string, a: number): void {
  if (a <= 0.004) return;
  g.globalAlpha = Math.min(1, a); g.drawImage(lightSprite(col), x - r, y - r, r * 2, r * 2);
}

/** 그을음 (불에 탄 칸) */
export function drawScorch(g: G, s: Scene, ts: number): void {
  const sp = sprites();
  for (let i = 0; i < s.burned.length; i++) {
    if (!s.burned[i]) continue;
    const x = ((i % s.w) + 0.5) * ts, y = (((i / s.w) | 0) + 0.5) * ts, d = ts * (1.5 + 0.35 * hash2(i, 77));
    g.drawImage(sp.scorch, x - d / 2, y - d / 2, d, d);
  }
}

export function drawFire(g: G, s: Scene, ts: number, time: number, mini: boolean): void {
  const sp = sprites();
  g.globalCompositeOperation = 'lighter';
  for (let i = 0; i < s.fire.length; i++) {
    const f = s.fire[i]; if (f < 0.03) continue;
    const x = ((i % s.w) + 0.5) * ts, y = (((i / s.w) | 0) + 0.5) * ts;
    const d = ts * (1.5 + 1.2 * f) * (0.94 + 0.06 * Math.sin(time * 11 + i));
    g.globalAlpha = Math.min(0.9, 0.3 + 0.55 * f);
    g.drawImage(sp.glow, x - d / 2, y - d / 2, d, d);
    if (mini) continue;
    const n = f > 0.5 ? 3 : 2;
    for (let k = 0; k < n; k++) {
      const h1 = hash2(i * 3 + k, 11), h2 = hash2(i * 5 + k, 13), ph = time * (7 + 4 * h1) + h2 * 6.28;
      const fl = 0.78 + 0.22 * Math.sin(ph) + 0.1 * Math.sin(ph * 2.3 + 1);
      const w = ts * (0.5 + 0.55 * f) * (0.75 + 0.5 * h2), hgt = w * (1.35 + 0.55 * fl);
      const ox = (h1 - 0.5) * ts * 0.72 + Math.sin(time * 2.1 + k + i) * ts * 0.05, oy = (h2 - 0.5) * ts * 0.5;
      g.globalAlpha = Math.min(1, 0.55 + 0.5 * f);
      g.drawImage(sp.flameA, x + ox - w / 2, y + oy - hgt * 0.74, w, hgt);
      if (f > 0.25) { g.globalAlpha = Math.min(1, f * 1.1) * (0.7 + 0.3 * fl); g.drawImage(sp.flameB, x + ox - w * 0.28, y + oy - hgt * 0.42, w * 0.56, hgt * 0.6); }
    }
    if (f > 0.4) {
      for (let k = 0; k < 3; k++) {
        const ph = (time * (0.5 + 0.35 * hash2(i, k)) + hash2(k, i)) % 1;
        g.globalAlpha = (1 - ph) * 0.9; g.fillStyle = k ? '#ffd27a' : '#ff9a4a';
        const sz = Math.max(1.5, ts * 0.05);
        g.fillRect(x + (hash2(i * 3, k) - 0.5) * ts * 0.9 + Math.sin(time * 3 + i + k) * ts * 0.16, y - ph * ts * 2.1, sz, sz);
      }
    }
  }
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1;
}

/** 연기를 직접 그린다 (작은 창용). */
export function drawSmoke(g: G, s: Scene, ts: number, time: number): boolean {
  const sp = sprites();
  let any = false;
  for (let i = 0; i < s.smoke.length; i++) {
    const v = s.smoke[i]; if (v < 0.06) continue;
    any = true;
    const x = ((i % s.w) + 0.5) * ts, y = (((i / s.w) | 0) + 0.5) * ts;
    const dense = v > 0.55;
    const ph = time * 0.45 + i * 1.7;
    const d = ts * (1.9 + 0.35 * Math.sin(ph * 1.3));
    g.globalAlpha = Math.min(0.72, v * 0.6);
    g.drawImage(dense ? sp.puffDark : sp.puff, x - d / 2 + Math.sin(ph) * ts * 0.16, y - d / 2 + Math.cos(ph * 0.8) * ts * 0.12, d, d);
    if (dense) { g.globalAlpha = Math.min(0.5, (v - 0.4) * 0.6); g.drawImage(sp.puff, x - d * 0.4 + Math.cos(ph * 1.1) * ts * 0.2, y - d * 0.4 + Math.sin(ph * 0.7) * ts * 0.2, d * 0.8, d * 0.8); }
  }
  g.globalAlpha = 1;
  return any;
}

let soft: HTMLCanvasElement | null = null;
/**
 * 연기를 낮은 해상도의 별도 층에 그려 돌려준다(연기는 원래 흐릿하므로 화질 손실이 없고 훨씬 가볍다).
 * 연기가 없으면 null. 같은 층을 사람 아래에 한 번, 위에 옅게 한 번 덮는다.
 */
export function smokeLayer(s: Scene, ts: number, time: number, tint?: string): HTMLCanvasElement | null {
  let any = false; for (let i = 0; i < s.smoke.length; i++) if (s.smoke[i] >= 0.06) { any = true; break; }
  if (!any) return null;
  const q = 1 / 3, w = Math.max(2, Math.ceil(s.w * ts * q)), h = Math.max(2, Math.ceil(s.h * ts * q));
  if (!soft) soft = document.createElement('canvas');
  if (soft.width !== w || soft.height !== h) { soft.width = w; soft.height = h; }
  const g = soft.getContext('2d')!;
  g.globalCompositeOperation = 'source-over'; g.clearRect(0, 0, w, h);
  drawSmoke(g, s, ts * q, time);
  if (tint) { g.globalCompositeOperation = 'source-atop'; g.fillStyle = tint; g.fillRect(0, 0, w, h); g.globalCompositeOperation = 'source-over'; }
  return soft;
}

/** 물줄기: 관창에서 목표까지. k 는 효과의 경과 비율(0..1). */
export function drawSpray(g: G, x0: number, y0: number, x1: number, y1: number, ts: number, k: number, time: number): void {
  const sp = sprites();
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, nx = -dy / len, ny = dx / len;
  const a = 1 - k * 0.7;
  g.lineCap = 'round';
  const wob = Math.sin(time * 20) * ts * 0.03;
  const mx = (x0 + x1) / 2 + nx * wob, my = (y0 + y1) / 2 + ny * wob;
  const path = (): void => { g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(mx, my, x1, y1); };
  g.strokeStyle = `rgba(120,190,245,${0.3 * a})`; g.lineWidth = ts * 0.2; path(); g.stroke();
  g.strokeStyle = `rgba(170,220,255,${0.65 * a})`; g.lineWidth = ts * 0.1; path(); g.stroke();
  g.strokeStyle = `rgba(245,252,255,${0.85 * a})`; g.lineWidth = Math.max(1, ts * 0.035); path(); g.stroke();
  for (let q = 0; q < 7; q++) {
    const t = (time * 2.6 + q / 7) % 1, jx = (hash2(q, 3) - 0.5) * ts * 0.3 * t;
    g.fillStyle = `rgba(215,240,255,${0.8 * a})`;
    const sz = Math.max(1.5, ts * 0.05);
    g.fillRect(x0 + dx * t + nx * jx, y0 + dy * t + ny * jx, sz, sz);
  }
  const d = ts * (1.1 + 0.7 * k);
  g.globalAlpha = 0.55 * a; g.drawImage(sp.mist, x1 - d / 2, y1 - d / 2, d, d); g.globalAlpha = 1;
}

// ───────────────────────── 어둠과 빛 ─────────────────────────
let dark: HTMLCanvasElement | null = null;
/** 어둠 층을 준비한다. 반환된 맥락에 destination-out 으로 밝은 곳을 뚫은 뒤 본 화면에 덮는다. 좌표는 sc 배(절반 해상도). */
export function beginDark(W: number, H: number, fill: string): { c: HTMLCanvasElement; g: G; sc: number } {
  const sc = 0.5, w = Math.max(2, Math.ceil(W * sc)), h = Math.max(2, Math.ceil(H * sc));
  if (!dark) dark = document.createElement('canvas');
  if (dark.width !== w || dark.height !== h) { dark.width = w; dark.height = h; }
  const g = dark.getContext('2d')!;
  g.globalCompositeOperation = 'source-over'; g.globalAlpha = 1; g.clearRect(0, 0, w, h);
  g.fillStyle = fill; g.fillRect(0, 0, w, h);
  g.globalCompositeOperation = 'destination-out';
  return { c: dark, g, sc };
}
export function hole(g: G, x: number, y: number, r: number, k: number): void {
  const gr = g.createRadialGradient(x, y, r * 0.12, x, y, r);
  gr.addColorStop(0, `rgba(0,0,0,${k})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill();
}
/** 다각형 모양으로 밝힌다. pts = [x0, y0, …] (이미 어둠 층 좌표). 중심에서 멀수록 옅어진다. */
export function holePoly(g: G, cx: number, cy: number, pts: number[], r: number, k: number): void {
  const gr = g.createRadialGradient(cx, cy, r * 0.1, cx, cy, r);
  gr.addColorStop(0, `rgba(0,0,0,${k})`); gr.addColorStop(0.75, `rgba(0,0,0,${k * 0.8})`); gr.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = gr; g.beginPath(); g.moveTo(cx, cy);
  for (let i = 0; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
  g.closePath(); g.fill();
}

// ───────────────────────── 날씨 ─────────────────────────
export function drawRain(g: G, W: number, H: number, timeMs: number, mini: boolean): void {
  g.strokeStyle = 'rgba(180,208,238,0.26)'; g.lineWidth = 1; g.beginPath();
  const n = mini ? 30 : 150;
  for (let k = 0; k < n; k++) {
    const x = (hash2(k, 1) * W + timeMs * 0.12) % W, y = (hash2(k, 2) * H + timeMs * 0.7 * (0.7 + hash2(k, 3) * 0.6)) % H;
    g.moveTo(x, y); g.lineTo(x + 3, y + 13);
  }
  g.stroke();
  if (mini) return;
  // 바닥에 튀는 물방울
  g.strokeStyle = 'rgba(200,225,245,0.3)';
  for (let k = 0; k < 36; k++) {
    const ph = (timeMs * 0.0016 + hash2(k, 9)) % 1, cyc = Math.floor(timeMs * 0.0016 + hash2(k, 9));
    const x = hash2(k * 7 + cyc, 4) * W, y = hash2(k * 3, cyc + 5) * H;
    g.globalAlpha = 1 - ph; g.beginPath(); g.ellipse(x, y, 2 + ph * 7, 1 + ph * 3.5, 0, 0, 6.2832); g.stroke();
  }
  g.globalAlpha = 1;
  g.fillStyle = 'rgba(40,60,90,0.1)'; g.fillRect(0, 0, W, H);
}
let fogC: HTMLCanvasElement | null = null;
export function drawFog(g: G, W: number, H: number, timeMs: number, mini: boolean): void {
  g.fillStyle = 'rgba(196,205,214,0.14)'; g.fillRect(0, 0, W, H);
  if (mini) return;
  // 흘러가는 안개 덩어리: 낮은 해상도로 그린 뒤 늘려 덮는다
  const q = 0.25, w = Math.max(2, Math.ceil(W * q)), h = Math.max(2, Math.ceil(H * q));
  if (!fogC) fogC = document.createElement('canvas');
  if (fogC.width !== w || fogC.height !== h) { fogC.width = w; fogC.height = h; }
  const fg = fogC.getContext('2d')!, sp = sprites();
  fg.clearRect(0, 0, w, h);
  for (let k = 0; k < 7; k++) {
    const d = Math.max(w, h) * (0.45 + 0.3 * hash2(k, 21));
    const x = ((hash2(k, 22) * (w + d) + timeMs * 0.0016 * (0.5 + hash2(k, 23))) % (w + d)) - d / 2, y = hash2(k, 24) * h;
    fg.globalAlpha = 0.5; fg.drawImage(sp.puff, x - d / 2, y - d / 2, d, d);
  }
  g.globalAlpha = 0.85; g.drawImage(fogC, 0, 0, W, H); g.globalAlpha = 1;
}
/** 화면 가장자리를 어둡게 눌러 준다 */
export function drawVignette(g: G, w: number, h: number): void {
  const gr = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.78);
  gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.5)');
  g.fillStyle = gr; g.fillRect(0, 0, w, h);
}
