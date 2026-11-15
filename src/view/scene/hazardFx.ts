// 현장 위험의 매 프레임 그림 (docs/specs/G4-scene-legibility.md §4.2~4.3, §4.8, §7).
// 2차 붕괴 위험 범위·진행 고리, 무너지는 순간(그림자·떨어지는 덩어리·먼지 기둥·충격 고리·가라앉는 먼지·불티), 흔들림.
// 무너짐은 폭발과 달라 보여야 한다: 흙빛 먼지와 그림자뿐, 가산 혼합·주황·흰 빛을 쓰지 않는다(천장 붕괴의 불티만 불씨 색).
// 상태(s.falls · 균열 소품 · 지휘관의 믿음)만 읽는다. renderScene 을 import 하지 않는다(서로 부르게 된다) — 글자 표지는 목록으로 돌려준다.

import type { Sim } from '../../sim/engine';
import type { FieldAgent, Scene } from '../../sim/types';
import type { GasView } from '../hazardState';
import { hash2 } from './common';
import type { G } from './common';
import { g4Sprites } from './fx';

/** 글자 표지 (현장 좌표 화소, renderScene 이 자기 pill() 로 그린다) */
export interface HazardLabel { x: number; y: number; text: string; color: string }

// ───────────────────────── 흔들림 ─────────────────────────
/** 원인별 흔들림 크기(칸). 모르는 원인(X6 가 더할 'partial'·'total')은 가장 가까운 기존 값 'secondary' 처럼 */
const SHAKE_A: Record<string, number> = { secondary: 0.16, ceiling: 0.1, zone: 0.12 };
const SHAKE_CAP = 0.16;

/** 무너짐과 지진이 현장 그림을 미는 양 (칸 단위, 합쳐 0.16칸 이하). 작은 창·동작 줄이기 설정이면 0 */
export function fallShake(sim: Sim, s: Scene, mini: boolean, reduced: boolean, alpha = 0): { x: number; y: number } {
  if (mini || reduced) return { x: 0, y: 0 };
  const now = sim.t + alpha * sim.dt;
  let x = 0, y = 0;
  const falls = s.falls;
  if (falls && falls.length) {
    const f = falls[falls.length - 1], age = now - f.t;
    if (age >= 0 && age < 0.6) { const A = (SHAKE_A[f.cause] ?? SHAKE_A.secondary) * (1 - age / 0.6) ** 2; x += A * Math.sin(age * 97); y += A * Math.cos(age * 83); }
  }
  const d = sim.disaster;
  if (d && d.kind === 'quake' && d.shakes && d.shakes.length) {
    const age = now - d.shakes[d.shakes.length - 1];
    if (age >= 0 && age < 0.9) { const A = (s.kind === 'collapse' ? 0.14 : 0.08) * (1 - age / 0.9) ** 2; x += A * Math.sin(age * 71 + 1); y += A * Math.cos(age * 59 + 2); }
  }
  const m = Math.hypot(x, y);
  if (m > SHAKE_CAP) { x *= SHAKE_CAP / m; y *= SHAKE_CAP / m; }
  return { x, y };
}
/** 흔들림은 한 함수, 한 번의 translate: G4 몫(fallShake)에 G5 몫(extra, 칸 단위 — 동작 줄이기·작은 창이면 undefined)을 더한다. 합은 자르지 않는다 */
export function sceneShake(sim: Sim, s: Scene, mini: boolean, extra: { x: number; y: number } | undefined, reduced: boolean, alpha = 0): { x: number; y: number } {
  const a = fallShake(sim, s, mini, reduced, alpha);
  return extra ? { x: a.x + extra.x, y: a.y + extra.y } : a;
}

// ───────────────────────── 무너지기 전: 2차 붕괴 위험 ─────────────────────────
interface DangerOpts { truth: boolean; timeMs: number; mini: boolean; cmd: FieldAgent | undefined }

/** 보강하지 않은 균열마다 위험 범위(무너지면 다치는 반경 2.6칸)·진행 고리·곧 무너짐 알갱이. 어둠·날씨 뒤의 정보 표지 단계에서 부른다 */
export function drawDangerZones(g: G, sim: Sim, s: Scene, ts: number, o: DangerOpts): void {
  const cx = (x: number): number => (x + 0.5) * ts, cy = (y: number): number => (y + 0.5) * ts;
  const t = o.timeMs / 1000;
  let saved = false;      // save/restore 는 그릴 균열이 있을 때 한 번만 (헤드리스 소프트웨어 그리기에서 save 가 비싸다)
  for (const p of s.props) {
    if (p.kind !== 'unstable' || p.mitigated || p.removed) continue;
    const known = !!(o.cmd && o.cmd.beliefs.get('haz', p.id));
    if (!o.truth && !known) continue;
    const lk = Math.max(0, Math.min(1, p.leak ?? 0));
    const x = cx(p.x), y = cy(p.y);
    const a0 = (o.truth ? 0.5 + 0.4 * lk : 0.7) * (o.truth && !known ? 0.55 : 1);
    if (!saved) { g.save(); saved = true; }
    g.lineCap = 'butt';
    if (o.mini) {
      g.globalAlpha = a0; g.strokeStyle = '#ffd166'; g.lineWidth = 1;
      g.beginPath(); g.arc(x, y, 2.6 * ts, 0, 6.2832); g.stroke();
      continue;
    }
    // 위험 범위: 바깥 어두운 띠 위에 도는 노란 점선 (통제선 테이프)
    g.globalAlpha = a0;
    g.strokeStyle = 'rgba(8,13,18,0.55)'; g.lineWidth = ts * 0.16; g.setLineDash([]);
    g.beginPath(); g.arc(x, y, 2.6 * ts, 0, 6.2832); g.stroke();
    g.strokeStyle = '#ffd166'; g.lineWidth = ts * 0.09; g.setLineDash([ts * 0.32, ts * 0.22]); g.lineDashOffset = -o.timeMs / 80;
    g.beginPath(); g.arc(x, y, 2.6 * ts, 0, 6.2832); g.stroke();
    g.setLineDash([]); g.lineDashOffset = 0;
    if (o.truth) {
      // 진행 고리: 위에서 시계 방향으로 leak × 360°
      g.globalAlpha = known ? 1 : 0.7;
      g.strokeStyle = 'rgba(8,13,18,0.7)'; g.lineWidth = ts * 0.14;
      g.beginPath(); g.arc(x, y, 0.66 * ts, 0, 6.2832); g.stroke();
      g.strokeStyle = `rgb(255,${Math.round(200 - 110 * lk)},80)`; g.lineWidth = ts * 0.08; g.lineCap = 'round';
      if (lk > 0.003) { g.beginPath(); g.arc(x, y, 0.66 * ts, -Math.PI / 2, -Math.PI / 2 + lk * 6.2832); g.stroke(); }
      // 곧 무너짐: 균열 둘레 1칸 안에 먼지 알갱이가 떨어진다
      if (lk > 0.75) {
        for (let k = 0; k < 4; k++) {
          const ph = (t / 1.2 + hash2(p.id, k)) % 1;
          const gx = x + (hash2(p.id * 7 + k, 3) - 0.5) * 2 * ts, gy = y + (hash2(p.id * 5 + k, 9) - 0.5) * 2 * ts - (1 - ph) * 0.5 * ts;
          g.globalAlpha = 0.85 * (1 - ph * 0.6); g.fillStyle = 'rgb(214,200,170)';
          const sz = Math.max(2, ts * 0.07); g.fillRect(gx - sz / 2, gy - sz / 2, sz, sz);
        }
      }
    }
  }
  if (saved) g.restore();
  // (X6) 예전의 '불난 방의 천장 붕괴 위험' 점선(탄 칸 45% 이상)은 지웠다 — 천장 붕괴 판정이 구조 건전도로 바뀌었고, 그 위험은 catLayer 의 건전도 빗금이 그린다 (X6 §7.3)
}

// ───────────────────────── 무너지는 순간 ─────────────────────────
const DUST = 'rgb(196,178,146)';
const CHUNK_COLS = ['#6a645b', '#8d867a', '#a59d90', '#57524b'];
const easeOut = (k: number): number => 1 - (1 - k) * (1 - k);

/** 무너지는 순간의 몸통 (불 뒤, 나무 수관 앞): 내려앉는 그림자 → 떨어지는 덩어리 → 먼지 기둥 → 가라앉는 먼지, 천장 붕괴면 불티 */
export function drawFallMoments(g: G, sim: Sim, s: Scene, ts: number, alpha: number, mini: boolean): void {
  const falls = s.falls;
  if (!falls || !falls.length) return;
  const now = sim.t + alpha * sim.dt;
  if (!falls.some((f) => now - f.t >= 0 && now - f.t < 25)) return;
  const cx = (x: number): number => (x + 0.5) * ts, cy = (y: number): number => (y + 0.5) * ts;
  g.save();
  for (let n = 0; n < falls.length; n++) {
    const f = falls[n], age = now - f.t;
    if (age < 0 || age >= 25) continue;
    const x = cx(f.x), y = cy(f.y), R = f.r * ts, seed = n * 131 + Math.round(f.t * 5);
    // 3~25초: 가라앉는 먼지 (작은 창에도)
    if (age >= 3) { g.globalAlpha = 0.22 * (1 - (age - 3) / 22); g.fillStyle = DUST; g.beginPath(); g.arc(x, y, 1.1 * R, 0, 6.2832); g.fill(); g.globalAlpha = 1; continue; }
    if (mini) continue;
    // 0~0.35초: 떨어지는 천장의 그림자가 커진다
    if (age < 0.35) { const k = age / 0.35; g.globalAlpha = 1; g.fillStyle = `rgba(10,8,6,${(0.45 * (1 - k)).toFixed(3)})`; g.beginPath(); g.arc(x, y, R * 0.9 * (0.5 + 0.5 * k), 0, 6.2832); g.fill(); }
    // 0.1~3초: 먼지 기둥 (먼지 덩어리 10개가 퍼지며 떠오른다)
    if (age >= 0.1) {
      const k = (age - 0.1) / 2.9, e = easeOut(k), sp = g4Sprites().dust;
      for (let q = 0; q < 10; q++) {
        const an = hash2(seed, q) * 6.2832, d = R * (0.2 + 0.9 * e) * (0.55 + 0.45 * hash2(seed + 3, q)), sz = ts * (1.2 + 2.2 * e) * (0.75 + 0.5 * hash2(q, seed + 7));
        g.globalAlpha = 0.65 * Math.pow(1 - k, 1.3);
        g.drawImage(sp, x + Math.cos(an) * d - sz / 2, y + Math.sin(an) * d - 0.3 * ts * e - sz / 2, sz, sz);
      }
    }
    // 0~0.5초: 떨어지는 덩어리 7개 (1.2칸 위·1.6배 크기에서 가속해 내려와 0.45초에 닿고 사라진다 — 고정 층의 잔해가 받는다)
    if (age < 0.45) {
      const k = age / 0.45, fall = k * k;
      for (let q = 0; q < 7; q++) {
        const an = hash2(seed + 11, q) * 6.2832, dd = Math.sqrt(hash2(q, seed + 13)) * 0.8 * R;
        const lx = x + Math.cos(an) * dd, ly = y + Math.sin(an) * dd, lift = (1 - fall) * 1.2 * ts, sc = 1.6 - 0.6 * fall;
        const r = ts * (0.12 + 0.08 * hash2(seed, q + 20)) * sc;
        g.globalAlpha = 0.35 * fall; g.fillStyle = '#000000'; g.beginPath(); g.ellipse(lx, ly, r * 0.9, r * 0.6, 0, 0, 6.2832); g.fill();
        g.globalAlpha = 1; g.fillStyle = CHUNK_COLS[q % CHUNK_COLS.length];
        g.beginPath();
        for (let v = 0; v < 6; v++) { const a = (v / 6) * 6.2832 + hash2(q, seed) * 3 + k * 2, rad = r * (0.65 + 0.45 * hash2(seed + v, q)); if (v) g.lineTo(lx + Math.cos(a) * rad, ly - lift + Math.sin(a) * rad); else g.moveTo(lx + Math.cos(a) * rad, ly - lift + Math.sin(a) * rad); }
        g.closePath(); g.fill();
        g.fillStyle = 'rgba(255,255,255,0.16)'; g.beginPath(); g.arc(lx - r * 0.25, ly - lift - r * 0.25, r * 0.35, 0, 6.2832); g.fill();
      }
    }
    // 0~1.2초 (천장 붕괴만): 불티가 튀어 올랐다 떨어진다
    if (f.cause === 'ceiling' && age < 1.2) {
      const k = age / 1.2;
      for (let q = 0; q < 8; q++) {
        const an = hash2(seed + 21, q) * 6.2832, d = R * 0.6 * easeOut(k) * (0.4 + 0.6 * hash2(q, seed + 23)), up = Math.sin(k * Math.PI) * ts * (0.5 + 0.6 * hash2(seed, q + 40));
        g.globalAlpha = 1 - k; g.fillStyle = q % 2 ? '#ffd27a' : '#ff9a4a';
        const sz = Math.max(1.5, ts * 0.06); g.fillRect(x + Math.cos(an) * d - sz / 2, y + Math.sin(an) * d - up - sz / 2, sz, sz);
      }
    }
  }
  g.restore();
}

/** 먼지 충격 고리 (0~0.8초): 빠르게 퍼졌다 느려지며 멈추는 반지름이 곧 다치는 범위. 정보 표지 단계에서 부른다 */
export function drawFallRing(g: G, sim: Sim, s: Scene, ts: number, alpha: number, mini: boolean): void {
  const falls = s.falls;
  if (!falls || !falls.length) return;
  const now = sim.t + alpha * sim.dt;
  if (!falls.some((f) => now - f.t >= 0 && now - f.t < 0.8)) return;
  g.save();
  for (const f of falls) {
    const age = now - f.t;
    if (age < 0 || age >= 0.8) continue;
    const k = age / 0.8, e = easeOut(k);
    g.strokeStyle = `rgba(214,200,170,${(0.7 * (1 - k)).toFixed(3)})`;
    g.lineWidth = mini ? 1 : Math.max(1, ts * 0.12 * (1 - k));
    g.beginPath(); g.arc((f.x + 0.5) * ts, (f.y + 0.5) * ts, ts * (0.4 + (f.r - 0.4) * e), 0, 6.2832); g.stroke();
  }
  g.restore();
}

// ───────────────────────── 가스가 찬 범위 ─────────────────────────
/** 짙은 가스 경계(관찰자 시점, 새는 밸브가 있을 때): 폭발 판정 칸(실내 smoke > 0.6)의 경계를 흐르는 연두 점선으로. 10칸 이상이면 표지를 돌려준다 */
export function drawGasEdge(g: G, ts: number, timeMs: number, gv: GasView, mini: boolean): HazardLabel[] {
  if (mini || !gv.leaking || !gv.edges.length) return [];
  g.save();
  g.beginPath(); for (let e = 0; e < gv.edges.length; e += 4) { g.moveTo(gv.edges[e] * ts, gv.edges[e + 1] * ts); g.lineTo(gv.edges[e + 2] * ts, gv.edges[e + 3] * ts); }
  g.strokeStyle = 'rgba(8,13,18,0.5)'; g.lineWidth = Math.max(1.5, ts * 0.05) + 2; g.setLineDash([]); g.stroke();
  g.strokeStyle = '#d6f06a'; g.lineWidth = Math.max(1.5, ts * 0.05); g.setLineDash([ts * 0.24, ts * 0.16]); g.lineDashOffset = -timeMs / 90; g.stroke();
  g.restore();
  return gv.dense >= 10 ? [{ x: (gv.cx + 0.5) * ts, y: (gv.cy + 0.5) * ts, text: '가스 고임 — 폭발 위험', color: '#ff5d5d' }] : [];
}

// ───────────────────────── 되살아난 불 ─────────────────────────
/** 되살아난 불이 있는 방의 테두리 (주황 점선 둥근 사각형)와 표지. 관찰자: '다시 붙은 불 — 지휘관은 모름', AI: '잔불 되살아남' */
export function drawRekindle(g: G, s: Scene, ts: number, timeMs: number, ids: number[], truth: boolean, mini: boolean): HazardLabel[] {
  if (mini || !ids.length) return [];
  const out: HazardLabel[] = [];
  g.save();
  g.strokeStyle = '#ff6b3d'; g.lineWidth = Math.max(1.5, ts * 0.06); g.setLineDash([ts * 0.26, ts * 0.16]); g.lineDashOffset = -timeMs / 70;
  for (const id of ids) {
    const r = s.regions[id];
    if (!r) continue;
    const m = ts * 0.1;
    g.globalAlpha = 0.65 + 0.3 * Math.abs(Math.sin(timeMs / 380));
    g.beginPath(); g.roundRect(r.x0 * ts + m, r.y0 * ts + m, (r.x1 - r.x0 + 1) * ts - 2 * m, (r.y1 - r.y0 + 1) * ts - 2 * m, ts * 0.3); g.stroke();
    out.push({ x: (r.cx + 0.5) * ts, y: (r.cy + 0.5) * ts + ts * 0.62, text: truth ? '다시 붙은 불 — 지휘관은 모름' : '잔불 되살아남', color: '#ff9a6a' });
  }
  g.restore();
  return out;
}

// ───────────────────────── 폭발 자리 ─────────────────────────
/** 터진 폭발물(크기 1)·불붙은 밸브(0.6)의 바닥 자국. 그을음 바로 뒤에서 매 프레임 (소품 수만큼 — 가볍다). 작은 창은 검은 자국만 */
export function drawBlastScars(g: G, s: Scene, ts: number, mini: boolean): void {
  for (const p of s.props) {
    const sc = p.kind === 'bomb' && p.exploded ? 1 : p.kind === 'valve' && p.ignited ? 0.6 : 0;
    if (!sc) continue;
    g.save(); g.translate((p.x + 0.5) * ts, (p.y + 0.5) * ts); g.scale(ts, ts);
    drawBlastScar(g, p.id, sc, mini, p.kind === 'bomb');
    g.restore();
  }
}
/** 폭발 자국 하나 (칸 단위 좌표, 가운데가 원점). 모양은 소품 번호 해시라 다시 그려도 같다 */
export function drawBlastScar(g: G, seed: number, scale: number, mini = false, bag = true): void {
  const hv = (k: number): number => hash2(seed * 37 + k, 6151);
  // 들쭉날쭉한 검은 자국 (반지름 0.9칸)
  g.fillStyle = 'rgba(6,5,5,0.75)'; g.beginPath();
  const n = 16;
  for (let k = 0; k < n; k++) { const a = (k / n) * 6.2832, r = 0.9 * scale * (k % 2 ? 0.62 + 0.25 * hv(k) : 0.9 + 0.2 * hv(k)); if (k) g.lineTo(Math.cos(a) * r, Math.sin(a) * r); else g.moveTo(Math.cos(a) * r, Math.sin(a) * r); }
  g.closePath(); g.fill();
  if (mini) return;
  // 1.6칸까지 뻗는 방사형 금 6~8줄
  g.strokeStyle = 'rgba(20,18,16,0.7)'; g.lineWidth = 0.035; g.lineCap = 'round'; g.lineJoin = 'round';
  const nc = 6 + Math.floor(hv(50) * 3);
  for (let k = 0; k < nc; k++) {
    const a = (k / nc) * 6.2832 + (hv(60 + k) - 0.5) * 0.6, L = 1.6 * scale * (0.65 + 0.35 * hv(70 + k));
    g.beginPath(); g.moveTo(Math.cos(a) * 0.5 * scale, Math.sin(a) * 0.5 * scale);
    for (let q = 1; q <= 3; q++) { const t = 0.5 * scale + ((L - 0.5 * scale) * q) / 3, j = (hv(80 + k * 4 + q) - 0.5) * 0.25; g.lineTo(Math.cos(a + j) * t, Math.sin(a + j) * t); }
    g.stroke();
  }
  // 찢어진 가방·상자 조각 3~4개 (폭발물만)
  if (bag) {
    const cols = ['#3d3a35', '#5a4a3a', '#2b2b2e', '#6b5a44'];
    const nb = 3 + (hv(90) > 0.5 ? 1 : 0);
    for (let k = 0; k < nb; k++) {
      const a = hv(100 + k) * 6.2832, d = (0.7 + 0.6 * hv(110 + k)) * scale;
      g.save(); g.translate(Math.cos(a) * d, Math.sin(a) * d); g.rotate(hv(120 + k) * 3);
      const w = 0.16 + 0.1 * hv(130 + k), h = 0.08 + 0.06 * hv(140 + k);
      g.fillStyle = cols[k % cols.length]; g.beginPath(); g.moveTo(-w / 2, -h / 2); g.lineTo(w / 2, -h / 2 + 0.02); g.lineTo(w / 2 - 0.03, h / 2); g.lineTo(-w / 2 + 0.02, h / 2 - 0.01); g.closePath(); g.fill();
      g.restore();
    }
  }
}
