// 이 묶음의 소품 그림. 열쇠는 Prop.skin 의 값이다.
// 좌표계: 소품의 가운데가 원점, 1 = 한 칸, 소품의 각도만큼 이미 돌아가 있다. 차량·버스 그림(sprites.ts)과 같은 선 굵기·색조로 그린다.
import { SH } from '../../../sim/field/kit';
import type { Prop } from '../../../sim/types';
import type { G } from '../common';
import { disc, hash2, oval, rr, seg, shade } from '../common';
import type { SkinPainter } from '../skins';

const HULL = '#dfe4e8', LIVERY = '#3f69a8', GLASS = '#17232e';

/** 찢긴 단면: x = at 에서 dir 쪽(+1 = 오른쪽 끝, -1 = 왼쪽 끝)으로 들쭉날쭉하게 뜯겨 나간 자리 */
function tornEnd(g: G, at: number, dir: number, W: number, seed: number): void {
  const h = (k: number): number => hash2(seed * 13 + k, 7);
  g.fillStyle = 'rgba(14,16,19,0.86)'; g.beginPath(); g.moveTo(at + dir * 0.03, -W / 2 - 0.02);
  for (let k = 0; k <= 7; k++) g.lineTo(at - dir * (0.1 + h(k) * 0.3), -W / 2 + (W * k) / 7);
  g.lineTo(at + dir * 0.03, W / 2 + 0.02); g.closePath(); g.fill();
  // 삐져나온 골조와 전선
  for (let k = 0; k < 4; k++) { const y = (h(20 + k) - 0.5) * (W - 0.2); seg(g, at - dir * 0.12, y, at + dir * (0.08 + h(30 + k) * 0.2), y + (h(40 + k) - 0.5) * 0.2, 0.025, k % 2 ? '#8b97a3' : '#b5564a'); }
  // 흩어진 조각
  for (let k = 0; k < 8; k++) { g.fillStyle = k % 3 ? 'rgba(215,222,228,0.85)' : 'rgba(30,34,38,0.8)'; g.fillRect(at + dir * (0.08 + h(50 + k) * 0.55), (h(60 + k) - 0.5) * (W + 0.5), 0.05, 0.035); }
}

/** 동체 토막. 기수는 +x 쪽, 꼬리는 -x 쪽이다 */
function fuselage(g: G, p: Prop, part: 'nose' | 'mid' | 'tail', truth: boolean): void {
  const L = p.w + 0.5, W = 1.16, x0 = -L / 2, x1 = L / 2, seed = p.id + 3;
  const h = (k: number): number => hash2(seed * 17 + k, 11);
  // 새는 연료 (관찰자 시점에서만 보인다. 조치하면 흡착포가 덮인다)
  if (p.leakRate && !p.ignited) {
    const lk = p.leak ?? 0;
    if (p.mitigated) { rr(g, -0.5, W / 2 + 0.05, 0.9, 0.34, 0.05, 'rgba(226,222,196,0.75)'); rr(g, -0.2, W / 2 + 0.2, 0.7, 0.3, 0.05, 'rgba(210,206,180,0.7)'); }
    else if (truth) {
      oval(g, 0.1, W / 2 + 0.25, 0.6 + 0.9 * lk, 0.3 + 0.3 * lk, 'rgba(24,20,10,0.55)', 0.15);
      oval(g, 0, W / 2 + 0.2, 0.42 + 0.65 * lk, 0.2 + 0.2 * lk, 'rgba(150,120,40,0.4)', 0.15);
      oval(g, -0.1, W / 2 + 0.16, 0.18 + 0.3 * lk, 0.06, 'rgba(210,160,230,0.28)', 0.3);
    }
  }
  // 그림자
  g.save(); g.translate(0.09, 0.13); rr(g, x0, -W / 2, L, W, 0.3, 'rgba(0,0,0,0.38)'); g.restore();
  if (part === 'mid') {
    // 날개 뿌리: 양쪽으로 짧게 남은 날개, 끝은 찢겨 그을렸다
    for (const sd of [-1, 1]) {
      g.fillStyle = shade(HULL, -0.42); g.beginPath(); g.moveTo(-0.75, sd * 0.4); g.lineTo(0.55, sd * 0.4); g.lineTo(0.2, sd * 1.32); g.lineTo(-0.5, sd * 1.38); g.closePath(); g.fill();
      g.fillStyle = shade(HULL, -0.08); g.beginPath(); g.moveTo(-0.7, sd * 0.42); g.lineTo(0.48, sd * 0.42); g.lineTo(0.16, sd * 1.26); g.lineTo(-0.46, sd * 1.32); g.closePath(); g.fill();
      seg(g, -0.52, sd * 0.6, -0.36, sd * 1.24, 0.02, 'rgba(60,68,76,0.6)');
      g.fillStyle = 'rgba(18,16,14,0.7)'; g.beginPath(); g.moveTo(0.26, sd * 1.14);
      for (let k = 0; k <= 5; k++) g.lineTo(0.22 - k * 0.15, sd * (1.3 + (h(k + (sd > 0 ? 9 : 0)) - 0.5) * 0.18));
      g.lineTo(-0.56, sd * 1.14); g.closePath(); g.fill();
    }
  }
  if (part === 'tail') {
    // 수평 꼬리날개
    for (const sd of [-1, 1]) {
      g.fillStyle = shade(HULL, -0.4); g.beginPath(); g.moveTo(x0 + 0.3, sd * 0.3); g.lineTo(x0 + 0.95, sd * 0.36); g.lineTo(x0 + 0.5, sd * 1.02); g.lineTo(x0 + 0.12, sd * 1.02); g.closePath(); g.fill();
      g.fillStyle = shade(HULL, -0.06); g.beginPath(); g.moveTo(x0 + 0.34, sd * 0.32); g.lineTo(x0 + 0.88, sd * 0.38); g.lineTo(x0 + 0.48, sd * 0.96); g.lineTo(x0 + 0.17, sd * 0.96); g.closePath(); g.fill();
    }
  }
  // 몸통: 기수는 앞이 둥글게, 꼬리는 뒤가 가늘게
  const body = (inset: number, col: string): void => {
    g.fillStyle = col; g.beginPath();
    const a = x0 + inset, b = x1 - inset, w = W / 2 - inset;
    if (part === 'nose') { g.moveTo(a, -w); g.lineTo(b - 0.75, -w); g.quadraticCurveTo(b + 0.05, -w * 0.9, b, 0); g.quadraticCurveTo(b + 0.05, w * 0.9, b - 0.75, w); g.lineTo(a, w); }
    else if (part === 'tail') { g.moveTo(b, -w); g.lineTo(a + 1.0, -w); g.quadraticCurveTo(a + 0.15, -w * 0.5, a, -w * 0.18); g.lineTo(a, w * 0.18); g.quadraticCurveTo(a + 0.15, w * 0.5, a + 1.0, w); g.lineTo(b, w); }
    else { g.moveTo(a, -w); g.lineTo(b, -w); g.lineTo(b, w); g.lineTo(a, w); }
    g.closePath(); g.fill();
  };
  body(0, shade(HULL, -0.45)); body(0.035, HULL);
  rr(g, x0 + (part === 'tail' ? 0.7 : 0.18), -0.2, L - (part === 'mid' ? 0.36 : 1.0), 0.4, 0.2, '#f4f6f8');      // 지붕의 밝은 띠
  // 도색 띠와 창문 줄
  const wa = x0 + (part === 'tail' ? 1.05 : 0.22), wb = x1 - (part === 'nose' ? 0.95 : 0.22);
  for (const sd of [-1, 1]) {
    g.fillStyle = LIVERY; g.fillRect(wa, sd * (W / 2 - 0.3) - 0.025, wb - wa, 0.05);
    for (let x = wa + 0.06; x < wb - 0.1; x += 0.27) rr(g, x, sd * (W / 2 - 0.17) - 0.045, 0.14, 0.09, 0.03, GLASS);
  }
  if (part === 'nose') {
    // 조종석 창
    g.fillStyle = GLASS; g.beginPath(); g.moveTo(x1 - 0.62, -0.36); g.quadraticCurveTo(x1 - 0.22, -0.3, x1 - 0.2, 0); g.quadraticCurveTo(x1 - 0.22, 0.3, x1 - 0.62, 0.36); g.lineTo(x1 - 0.5, 0); g.closePath(); g.fill();
    seg(g, x1 - 0.42, -0.2, x1 - 0.3, -0.06, 0.02, 'rgba(170,215,240,0.4)');
    tornEnd(g, x0, -1, W, seed);
  } else if (part === 'tail') {
    seg(g, x0 + 0.1, 0, x0 + 1.05, 0, 0.09, shade(LIVERY, -0.2)); seg(g, x0 + 0.14, 0, x0 + 1.0, 0, 0.04, LIVERY);      // 수직 꼬리날개 (위에서 보면 한 줄)
    tornEnd(g, x1, 1, W, seed);
  } else { tornEnd(g, x0, -1, W, seed); tornEnd(g, x1, 1, W, seed + 5); }
  // 그을음
  for (let k = 0; k < 4; k++) oval(g, (h(k) - 0.5) * L * 0.8, (h(k + 4) - 0.5) * W * 0.7, 0.2 + 0.25 * h(k + 8), 0.12 + 0.12 * h(k + 12), 'rgba(22,20,18,0.28)', h(k + 16) * 3);
  if (p.ignited) rr(g, x0, -W / 2, L, W, 0.3, 'rgba(14,12,10,0.55)');      // 불에 탔다
}

/** 흩어진 기체 잔해: 찢긴 외판, 바퀴, 좌석 */
function planeDebris(g: G, p: Prop): void {
  const h = (k: number): number => hash2(p.id * 29 + k, 5);
  oval(g, 0.04, 0.06, 0.5, 0.36, 'rgba(0,0,0,0.3)');
  for (let k = 0; k < 3; k++) {
    const cx = (h(k) - 0.5) * 0.6, cy = (h(k + 3) - 0.5) * 0.5, r = 0.16 + 0.14 * h(k + 6), a = h(k + 9) * 6.28;
    g.fillStyle = shade(HULL, -0.4); g.beginPath();
    for (let q = 0; q < 4; q++) { const aa = a + q * 1.57 + (h(k * 4 + q + 12) - 0.5) * 0.7, rad = r * (0.75 + 0.6 * h(k * 4 + q + 30)) + 0.02; if (q) g.lineTo(cx + Math.cos(aa) * rad, cy + Math.sin(aa) * rad); else g.moveTo(cx + Math.cos(aa) * rad, cy + Math.sin(aa) * rad); }
    g.closePath(); g.fill();
    g.fillStyle = k === 1 ? shade(LIVERY, 0.1) : HULL; g.beginPath();
    for (let q = 0; q < 4; q++) { const aa = a + q * 1.57 + (h(k * 4 + q + 12) - 0.5) * 0.7, rad = r * (0.75 + 0.6 * h(k * 4 + q + 30)); if (q) g.lineTo(cx + Math.cos(aa) * rad, cy + Math.sin(aa) * rad); else g.moveTo(cx + Math.cos(aa) * rad, cy + Math.sin(aa) * rad); }
    g.closePath(); g.fill();
  }
  if (h(50) > 0.4) { disc(g, 0.26, 0.18, 0.12, '#15181b'); disc(g, 0.26, 0.18, 0.06, '#8d97a1'); }
  if (h(51) > 0.5) { rr(g, -0.36, 0.1, 0.2, 0.22, 0.04, '#2f4a78'); rr(g, -0.36, 0.1, 0.2, 0.07, 0.03, '#3f69a8'); }
  for (let k = 0; k < 5; k++) { g.fillStyle = 'rgba(215,222,228,0.8)'; g.fillRect((h(60 + k) - 0.5) * 0.9, (h(70 + k) - 0.5) * 0.8, 0.045, 0.03); }
}

/** 선로 한 줄: 소품 좌표계를 풀고 현장 좌표(칸)로 돌아가, 그 열을 따라 현장 위에서 아래까지 그린다. 도로(8~11줄) 위는 건널목이다 */
function railTrack(g: G, p: Prop): void {
  g.save();
  g.rotate(-(p.angle ?? 0)); g.translate(-(p.x + (p.w - 1) / 2 + 0.5), -(p.y + (p.h - 1) / 2 + 0.5));
  const cx = p.x + 0.5;
  for (const [ya, yb] of [[0, 8], [12, SH]]) {
    // 자갈 도상과 침목
    rr(g, cx - 0.62, ya, 1.24, yb - ya, 0.04, 'rgba(92,88,80,0.9)');
    for (let k = 0; k < 60; k++) { const yy = ya + hash2(k, p.x + ya) * (yb - ya), xx = cx - 0.58 + hash2(k * 3, p.x + 7) * 1.16; g.fillStyle = k % 2 ? 'rgba(132,126,114,0.8)' : 'rgba(58,56,52,0.7)'; g.fillRect(xx, yy, 0.05, 0.04); }
    for (let y = ya + 0.2; y < yb; y += 0.42) rr(g, cx - 0.5, y, 1.0, 0.13, 0.02, '#4d3c2c');
  }
  // 건널목 깔판
  rr(g, cx - 0.56, 8, 1.12, 4, 0.02, 'rgba(60,62,66,0.85)');
  g.fillStyle = 'rgba(240,190,70,0.55)'; g.fillRect(cx - 0.56, 8, 0.05, 4); g.fillRect(cx + 0.51, 8, 0.05, 4);
  // 레일
  for (const off of [-0.29, 0.29]) { seg(g, cx + off, 0.02, cx + off, SH - 0.02, 0.085, '#3b4148'); seg(g, cx + off, 0.02, cx + off, SH - 0.02, 0.035, '#aeb7c0'); }
  g.restore();
}

/** 객차. 세로로 긴 것은 서 있고(지붕이 보인다), 가로로 긴 것은 옆으로 누웠다(옆면과 바닥의 대차가 보인다). color 0 번이 선로를 함께 그린다 */
function trainCar(g: G, p: Prop): void {
  if ((p.color ?? 0) === 0) railTrack(g, p);
  const tipped = p.w > p.h, L = Math.max(p.w, p.h) + 0.56, W = tipped ? 1.12 : 1.0, x0 = -L / 2, col = '#c9d0d6', seed = p.id + 11;
  const h = (k: number): number => hash2(seed * 13 + k, 7);
  if ((p.color ?? 0) !== 0) {
    // 선로를 벗어난 객차 밑: 파헤쳐진 자갈과 휜 레일 토막
    oval(g, 0, 0.1, L * 0.56, W * 0.78, 'rgba(70,64,54,0.5)', 0.05);
    seg(g, x0 + 0.2, W / 2 + 0.12, x0 + L * 0.55, W / 2 + 0.3, 0.06, '#3b4148'); seg(g, x0 + 0.2, W / 2 + 0.12, x0 + L * 0.55, W / 2 + 0.3, 0.025, '#aeb7c0');
    for (let k = 0; k < 3; k++) rr(g, x0 + 0.3 + k * 0.5, W / 2 + 0.08 + k * 0.06, 0.12, 0.34, 0.02, '#4d3c2c');
  }
  g.save(); g.translate(0.09, 0.13); rr(g, x0, -W / 2, L, W, 0.12, 'rgba(0,0,0,0.4)'); g.restore();
  if (tipped) {
    // 바닥 쪽(아래 변)으로 드러난 대차와 바퀴
    rr(g, x0 + 0.1, W / 2 - 0.1, L - 0.2, 0.2, 0.03, '#23282d');
    for (const bx of [x0 + L * 0.2, x0 + L * 0.8]) { rr(g, bx - 0.34, W / 2 - 0.04, 0.68, 0.2, 0.04, '#15181b'); disc(g, bx - 0.2, W / 2 + 0.1, 0.1, '#30363c'); disc(g, bx + 0.2, W / 2 + 0.1, 0.1, '#30363c'); disc(g, bx - 0.2, W / 2 + 0.1, 0.04, '#8d97a1'); disc(g, bx + 0.2, W / 2 + 0.1, 0.04, '#8d97a1'); }
    rr(g, x0, -W / 2, L, W - 0.08, 0.1, shade(col, -0.45)); rr(g, x0 + 0.03, -W / 2 + 0.03, L - 0.06, W - 0.14, 0.08, col);
    g.fillStyle = LIVERY; g.fillRect(x0 + 0.03, 0.14, L - 0.06, 0.16);
    // 옆면의 큰 창과 출입문
    for (let x = x0 + 0.5; x < L / 2 - 0.5; x += 0.48) rr(g, x, -0.3, 0.34, 0.32, 0.04, GLASS);
    for (const dx of [x0 + 0.14, L / 2 - 0.42]) { rr(g, dx, -0.34, 0.28, 0.66, 0.03, shade(col, -0.2)); rr(g, dx + 0.05, -0.3, 0.18, 0.24, 0.02, GLASS); }
    // 깨진 유리와 금
    g.strokeStyle = 'rgba(235,245,250,0.6)'; g.lineWidth = 0.014; g.lineCap = 'round'; g.beginPath();
    for (let k = 0; k < 6; k++) { const x = x0 + 0.6 + h(k) * (L - 1.4), y = -0.14 + (h(k + 6) - 0.5) * 0.1; g.moveTo(x, y); g.lineTo(x + (h(k + 12) - 0.5) * 0.3, y + (h(k + 18) - 0.5) * 0.28); }
    g.stroke();
  } else {
    rr(g, x0, -W / 2, L, W, 0.12, shade(col, -0.45)); rr(g, x0 + 0.03, -W / 2 + 0.03, L - 0.06, W - 0.06, 0.1, col);
    for (const sd of [-1, 1]) {
      rr(g, x0 + 0.12, sd * (W / 2 - 0.13) - 0.05, L - 0.24, 0.1, 0.03, GLASS);      // 옆 유리
      for (let k = 1; k < 8; k++) { g.fillStyle = col; g.fillRect(x0 + 0.12 + ((L - 0.24) * k) / 8 - 0.012, sd * (W / 2 - 0.13) - 0.05, 0.024, 0.1); }
      g.fillStyle = LIVERY; g.fillRect(x0 + 0.05, sd * (W / 2 - 0.26) - 0.02, L - 0.1, 0.04);
    }
    rr(g, x0 + 0.16, -W / 2 + 0.3, L - 0.32, W - 0.6, 0.08, shade(col, 0.2));      // 지붕
    for (let k = 0; k < 3; k++) rr(g, x0 + L * (0.22 + k * 0.28) - 0.2, -0.13, 0.4, 0.26, 0.04, shade(col, -0.12));      // 환기 장치
    rr(g, x0 - 0.06, -0.09, 0.1, 0.18, 0.02, '#23282d'); rr(g, L / 2 - 0.04, -0.09, 0.1, 0.18, 0.02, '#23282d');      // 연결기
  }
  // 찌그러진 앞머리와 흩어진 조각
  g.fillStyle = 'rgba(14,16,19,0.82)'; g.beginPath(); g.moveTo(L / 2 + 0.02, -W / 2 - 0.02);
  for (let k = 0; k <= 6; k++) g.lineTo(L / 2 - 0.1 - h(30 + k) * 0.24, -W / 2 + (W * k) / 6);
  g.lineTo(L / 2 + 0.02, W / 2 + 0.02); g.closePath(); g.fill();
  for (let k = 0; k < 10; k++) { g.fillStyle = k % 3 ? 'rgba(200,235,245,0.8)' : 'rgba(30,34,38,0.8)'; g.fillRect(L / 2 - 0.1 + h(40 + k) * 0.6, (h(50 + k) - 0.5) * (W + 0.6), 0.04, 0.03); }
}

/** 쓰러진 크레인 팔의 한 토막: 노란 격자 트러스. color 1 = 기초 쪽(운전실과 선회 장치), 99 = 끝(갈고리) */
function craneBoom(g: G, p: Prop): void {
  const Y = '#e0a82e', D = '#7a5a12', a = -0.78, b = 0.78, w = 0.25;
  seg(g, a + 0.06, w + 0.1, b + 0.06, w + 0.1, 0.12, 'rgba(0,0,0,0.32)'); seg(g, a + 0.06, -w + 0.1, b + 0.06, -w + 0.1, 0.12, 'rgba(0,0,0,0.32)');
  // 격자 (지그재그 사재)와 가로대
  g.lineCap = 'round';
  for (let k = 0; k < 4; k++) { const xa = a + ((b - a) * k) / 4, xb = a + ((b - a) * (k + 1)) / 4; seg(g, xa, k % 2 ? w : -w, xb, k % 2 ? -w : w, 0.06, D); seg(g, xa, k % 2 ? w : -w, xb, k % 2 ? -w : w, 0.03, Y); }
  for (let k = 0; k <= 4; k += 2) { const x = a + ((b - a) * k) / 4; seg(g, x, -w, x, w, 0.05, D); seg(g, x, -w, x, w, 0.025, shade(Y, 0.15)); }
  // 위아래 현재
  for (const yy of [-w, w]) { seg(g, a, yy, b, yy, 0.12, D); seg(g, a, yy, b, yy, 0.07, Y); seg(g, a, yy - 0.015, b, yy - 0.015, 0.02, shade(Y, 0.35)); }
  if (p.color === 1) {
    // 기초 쪽: 선회 장치와 운전실, 뒤로 뻗은 평형추 팔
    seg(g, a - 1.3, 0, a - 0.5, 0, 0.3, D); seg(g, a - 1.3, 0, a - 0.5, 0, 0.22, shade(Y, -0.1));
    rr(g, a - 1.5, -0.3, 0.42, 0.6, 0.04, '#4a5058'); rr(g, a - 1.46, -0.26, 0.34, 0.52, 0.03, '#7d868f');
    rr(g, a - 0.62, -0.42, 0.62, 0.84, 0.06, '#2b3138'); rr(g, a - 0.56, -0.36, 0.5, 0.72, 0.05, '#59626c');
    rr(g, a - 0.5, 0.44, 0.46, 0.4, 0.05, shade(Y, -0.3)); rr(g, a - 0.46, 0.48, 0.38, 0.32, 0.04, Y); rr(g, a - 0.4, 0.62, 0.26, 0.14, 0.02, GLASS);
  } else if (p.color === 99) {
    // 끝: 도르래와 늘어진 줄, 갈고리
    rr(g, b - 0.06, -w - 0.06, 0.16, w * 2 + 0.12, 0.03, D); rr(g, b - 0.03, -w - 0.03, 0.1, w * 2 + 0.06, 0.02, Y);
    seg(g, b - 0.3, 0, b + 0.5, 0.36, 0.025, '#23282d');
    disc(g, b + 0.52, 0.38, 0.13, '#23282d'); disc(g, b + 0.52, 0.38, 0.08, '#c7392f');
  }
}

/** 선체 윤곽: 벽으로 된 배(가로 w, 세로 h 칸)의 바깥을 두른다. 뱃머리는 +x 쪽으로 뾰족하고 고물은 둥글다. color = 건널판이 걸린 자리(왼쪽에서 몇 칸째) */
function shipHull(g: G, p: Prop): void {
  const hx = p.w / 2 - 0.5, hy = p.h / 2 - 0.5;      // 벽 한가운데 줄
  const ix = hx + 0.27, iy = hy + 0.27;                // 벽의 바깥 면
  const oy = hy + 0.47, bow = hx + 3.1, stern = hx + 0.95;
  const outer = (k: number): void => {
    g.moveTo(-hx, -oy * k); g.lineTo(hx - 0.2, -oy * k);
    g.quadraticCurveTo(hx + 1.7 * k, -oy * 0.82 * k, bow * (k === 1 ? 1 : 0.985), 0);
    g.quadraticCurveTo(hx + 1.7 * k, oy * 0.82 * k, hx - 0.2, oy * k);
    g.lineTo(-hx, oy * k); g.quadraticCurveTo(-stern * (k === 1 ? 1 : 0.985), oy * 0.9 * k, -stern * (k === 1 ? 1 : 0.985), 0); g.quadraticCurveTo(-stern * (k === 1 ? 1 : 0.985), -oy * 0.9 * k, -hx, -oy * k);
    g.closePath();
  };
  // 물에 비친 그림자와 선체 (안쪽의 방은 비워 둔다: 바닥과 벽은 고정 층이 그린다)
  g.save(); g.translate(0.12, 0.2); g.fillStyle = 'rgba(0,0,0,0.3)'; g.beginPath(); outer(1.03); g.fill(); g.restore();
  g.fillStyle = '#1f2a33'; g.beginPath(); outer(1.03); g.rect(-ix, -iy, ix * 2, iy * 2); g.fill('evenodd');
  g.fillStyle = '#7d8a94'; g.beginPath(); outer(0.94); g.rect(-ix, -iy, ix * 2, iy * 2); g.fill('evenodd');
  g.fillStyle = '#b8473c'; g.beginPath(); g.moveTo(hx + 0.2, -oy * 0.6); g.quadraticCurveTo(hx + 1.6, -oy * 0.6, bow - 0.5, 0); g.quadraticCurveTo(hx + 1.6, oy * 0.6, hx + 0.2, oy * 0.6); g.closePath(); g.fill();      // 뱃머리 갑판
  // 뱃머리의 양묘기와 닻줄, 난간 기둥
  rr(g, hx + 0.7, -0.26, 0.5, 0.52, 0.06, '#2b3138'); disc(g, hx + 0.95, 0, 0.16, '#59626c'); disc(g, hx + 0.95, 0, 0.07, '#23282d');
  seg(g, hx + 1.15, 0, bow - 0.6, 0, 0.04, '#23282d');
  for (let k = 0; k < 5; k++) { const t = k / 4; disc(g, hx + 0.4 + t * 1.9, -oy * (0.68 - 0.6 * t), 0.045, '#dfe4e8'); disc(g, hx + 0.4 + t * 1.9, oy * (0.68 - 0.6 * t), 0.045, '#dfe4e8'); }
  // 고물: 계선주와 구명환
  disc(g, -hx - 0.55, -0.5, 0.1, '#23282d'); disc(g, -hx - 0.55, 0.5, 0.1, '#23282d');
  disc(g, -hx - 0.6, 0, 0.15, '#e0712a'); disc(g, -hx - 0.6, 0, 0.08, '#7d8a94');
  // 뱃전의 방현재(타이어)
  for (let x = -hx + 1; x < hx; x += 2.4) { disc(g, x, -oy - 0.02, 0.13, '#15181b'); disc(g, x, -oy - 0.02, 0.06, '#3a4046'); }
  // 건널판: 난간과 디딤목 (바닥은 고정 층의 바닥 칸이다), 부두에 맨 줄
  const gx = -p.w / 2 + (p.color ?? 0), top = -p.h / 2 - 1;
  g.fillStyle = 'rgba(0,0,0,0.25)'; for (let k = 0; k < 5; k++) g.fillRect(gx + 0.06, top + 0.1 + k * 0.22, 1.88, 0.03);
  for (const rx of [gx + 0.03, gx + 1.97]) { seg(g, rx, top - 0.08, rx, -iy + 0.02, 0.07, '#23282d'); seg(g, rx, top - 0.08, rx, -iy + 0.02, 0.03, '#e0a82e'); }
  for (const [mx, tx] of [[hx - 0.3, hx + 1.6], [-hx + 0.2, -hx - 1.2]]) { seg(g, mx, -oy, tx, top - 0.12, 0.035, '#8a7a5c'); disc(g, tx, top - 0.14, 0.12, '#23282d'); disc(g, tx, top - 0.14, 0.06, '#59626c'); }
}

export const MAJOR_SKINS: Record<string, SkinPainter> = {
  fuselageNose: (g, p, _t, truth) => fuselage(g, p, 'nose', truth),
  fuselageMid: (g, p, _t, truth) => fuselage(g, p, 'mid', truth),
  fuselageTail: (g, p, _t, truth) => fuselage(g, p, 'tail', truth),
  planeDebris: (g, p) => planeDebris(g, p),
  trainCar: (g, p) => trainCar(g, p),
  craneBoom: (g, p) => craneBoom(g, p),
  shipHull: (g, p) => shipHull(g, p),
};
