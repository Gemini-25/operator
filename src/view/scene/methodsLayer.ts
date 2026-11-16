// 대응 방법의 현장 그림 (docs/specs/R2-methods.md §3.7). 화면 계층 — 상태를 읽기만 한다(판단·실행 함수를 부르지 않는다).
// renderScene 이 부른다: 사람을 그리기 전에 보트(drawBoats), 사람을 그린 뒤에 줄·장대(drawMethodFx).
//   단계 1d (수난): 구명줄(끝의 빨간 투척 가방) · 구명환(빨강·흰 고리) · 즉석 부력물(회갈색 점선 줄 끝의 흰 통) · 장대(갈고리) · 줄 확보(헤엄치는 동료까지의 줄) ·
//                   보트(주황 고무보트 1.4×0.7칸 / 구조정이면 회색 단단한 배 1.8×0.8칸)
//   단계 2 (폭파 진입): 문에 붙인 장약·3-2-1 카운트(drawCharges — 사람 뒤), 농성 문 안쪽의 쌓은 가구(drawBarricades — 사람 앞). 폭발은 G5 combat.ts 의 'charge' 갈래
//   뒤 단계가 더한다: 송풍기·지지대·에어백(3·4) …
// 대원의 자세와 손에 든 것은 renderScene.agentPose, 헤엄치는 대원은 sprites.drawSwimmer 가 그린다.

import type { Sim } from '../../sim/engine';
import { T } from '../../sim/types';
import type { FieldAgent, Scene, Task } from '../../sim/types';
import { disc, rr } from './common';
import type { G } from './common';

/** 보간한 위치 (renderScene.ipos 와 같다) */
const ip = (o: { x: number; y: number; px: number; py: number }, a: number): { x: number; y: number } => ({ x: o.px + (o.x - o.px) * a, y: o.py + (o.y - o.py) * a });
/** 던지는 방법의 한 번 시도에서 줄이 손을 떠나는 진행도 (그 전에는 감긴 줄을 들고 팔을 젖힌다 — agentPose 의 'throw') */
export const THROW_RELEASE = 0.45;

/** 대원이 보트 위에 있는가 (구조정·고무보트) */
export function inBoat(a: FieldAgent): boolean { return a.afloat === 'boat' && a.status !== 'left'; }
/** 대원이 헤엄 중인가: 선 칸이 물이고 보트 위가 아니다 (methods.onWater 와 같은 조건 — 화면은 판단부를 부르지 않고 칸을 직접 본다) */
export function swimming(s: Scene, a: FieldAgent): boolean {
  if (a.afloat !== undefined || a.status === 'left') return false;
  const x = Math.round(a.x), y = Math.round(a.y);
  return x >= 0 && y >= 0 && x < s.w && y < s.h && s.tiles[y * s.w + x] === T.WATER;
}

/**
 * 보트: 대원 밑에 위에서 본 배 (사람보다 먼저 그린다). 구조정의 대원이면 회색 단단한 배(1.8×0.8칸, 뾰족한 이물), 그 밖(로프 대원의 고무보트)은 주황 고무보트(1.4×0.7칸).
 * 뱃머리는 대원이 바라보는 쪽. 둘레에 잔물결
 */
export function drawBoats(g: G, sim: Sim, s: Scene, ts: number, alpha: number, time: number): void {
  for (const a of s.agents) {
    if (!inBoat(a)) continue;
    const p = ip(a, alpha), x = (p.x + 0.5) * ts, y = (p.y + 0.5) * ts;
    const fl = Math.hypot(a.fx, a.fy) || 1, ang = Math.atan2(a.fy / fl, a.fx / fl);
    const rigid = sim.units[a.unitId]?.kind === 'boat';
    g.save(); g.translate(x, y); g.scale(ts, ts);
    // 잔물결
    for (let q = 0; q < 2; q++) { const ph = (time * 0.6 + q * 0.5 + a.rid * 0.13) % 1; g.strokeStyle = `rgba(210,240,250,${0.45 * (1 - ph)})`; g.lineWidth = 0.03; g.beginPath(); g.ellipse(0, 0, 0.9 + ph * 0.4, 0.5 + ph * 0.3, ang, 0, 6.2832); g.stroke(); }
    g.rotate(ang);
    if (rigid) {
      const L = 1.8, W = 0.8;
      const hull = (k: number, col: string): void => { g.fillStyle = col; g.beginPath(); g.moveTo((L / 2) * k, 0); g.quadraticCurveTo((L / 2 - 0.3) * k, (-W / 2) * k, 0, (-W / 2) * k); g.lineTo((-L / 2) * k, (-W / 2) * k); g.lineTo((-L / 2) * k, (W / 2) * k); g.lineTo(0, (W / 2) * k); g.quadraticCurveTo((L / 2 - 0.3) * k, (W / 2) * k, (L / 2) * k, 0); g.closePath(); g.fill(); };
      hull(1.06, 'rgba(0,0,0,0.3)'); hull(1, '#8d979f'); hull(0.82, '#4a545c');
      rr(g, -L / 2 + 0.08, -0.12, 0.22, 0.24, 0.04, '#2a3036');      // 기관
      g.fillStyle = '#e0712a'; g.fillRect(-0.2, -W / 2, 0.12, W);      // 주황 띠
    } else {
      const L = 1.4, W = 0.7;
      rr(g, -L / 2 - 0.03, -W / 2 - 0.03, L + 0.06, W + 0.06, W / 2, 'rgba(0,0,0,0.3)');
      rr(g, -L / 2, -W / 2, L, W, W / 2, '#e8642a');      // 주황 튜브
      rr(g, -L / 2 + 0.12, -W / 2 + 0.12, L - 0.24, W - 0.24, (W - 0.24) / 2, '#3a3f45');      // 바닥
      g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 0.025; g.setLineDash([0.08, 0.1]); g.beginPath(); g.ellipse(0, 0, L / 2 - 0.05, W / 2 - 0.05, 0, 0, 6.2832); g.stroke(); g.setLineDash([]);      // 둘레 줄
    }
    g.restore();
  }
}

/**
 * 수난 구조의 줄·장대 (사람을 그린 뒤). 대상은 진실의 위치(그림 — 화면 계층은 상태를 읽기만 한다).
 *   던지는 방법(구명줄·구명환·즉석 부력물): 한 번 시도의 진행도(a.ring)가 줄을 놓는 때(THROW_RELEASE)를 넘으면 대상 쪽으로 날아가 닿고, 다시 감는 동안(phase 1)은 거둬들인다.
 *   장대: 뻗는 동안 대상 쪽으로 최대 2칸, 끝에 갈고리. 줄 확보: 자리를 잡으면 헤엄치는 동료까지 늘어진 줄.
 */
export function drawMethodFx(g: G, s: Scene, ts: number, alpha: number): void {
  const cx = (x: number): number => (x + 0.5) * ts, cy = (y: number): number => (y + 0.5) * ts;
  for (const a of s.agents) {
    const t = a.task;
    if (a.status !== 'active' || !t || t.kind !== 'waterRescue' || !t.method) continue;
    const c = s.casualties[t.cas];
    if (!c || !c.inWater) continue;
    const p = ip(a, alpha), x0 = cx(p.x), y0 = cy(p.y);
    const m = t.method;
    if (m === 'tend') {
      if (t.phase < 1) continue;
      const sw = s.agents.find((b) => b !== a && b.status === 'active' && b.task !== null && b.task.kind === 'waterRescue' && b.task.cas === t.cas && b.task.method === 'swim');
      if (!sw) continue;
      const q = ip(sw, alpha);
      ropeLine(g, x0, y0, cx(q.x), cy(q.y), ts, 1, '#f2e6c0', false);
      continue;
    }
    if (a.ring <= 0.01) continue;
    const q = ip(c, alpha), x1 = cx(q.x), y1 = cy(q.y);
    if (m === 'pole') {
      const d = Math.hypot(x1 - x0, y1 - y0) || 1, len = Math.min(d, 2 * ts) * Math.min(1, a.ring * 3);
      const ux = (x1 - x0) / d, uy = (y1 - y0) / d, ex = x0 + ux * len, ey = y0 + uy * len;
      g.lineCap = 'round';
      g.strokeStyle = 'rgba(0,0,0,0.35)'; g.lineWidth = Math.max(2.5, ts * 0.09); g.beginPath(); g.moveTo(x0, y0); g.lineTo(ex, ey); g.stroke();
      g.strokeStyle = '#c9b48a'; g.lineWidth = Math.max(1.5, ts * 0.055); g.stroke();
      // 갈고리: 끝에서 꺾인 짧은 쇠
      g.strokeStyle = '#aab2b9'; g.lineWidth = Math.max(1.5, ts * 0.05); g.beginPath(); g.moveTo(ex, ey); g.lineTo(ex - uy * ts * 0.18 + ux * ts * 0.06, ey + ux * ts * 0.18 + uy * ts * 0.06); g.stroke();
      continue;
    }
    if (m !== 'rope' && m !== 'ring' && m !== 'improvise') continue;
    // 줄이 날아간 정도: 다시 감는 중(phase 1)이면 거둬들이고, 아니면 놓은 뒤에 대상까지
    const k = t.phase === 1 ? Math.max(0, 1 - a.ring) : Math.max(0, Math.min(1, (a.ring - THROW_RELEASE) / 0.3));
    if (k <= 0) continue;
    const ex = x0 + (x1 - x0) * k, ey = y0 + (y1 - y0) * k;
    if (m === 'improvise') {
      ropeLine(g, x0, y0, ex, ey, ts, 1, '#9c8466', true);      // 옷·끈을 이은 회갈색 점선 줄
      rr(g, ex - ts * 0.09, ey - ts * 0.12, ts * 0.18, ts * 0.24, ts * 0.05, '#eef1f2'); rr(g, ex - ts * 0.04, ey - ts * 0.16, ts * 0.08, ts * 0.05, ts * 0.015, '#5d6870');      // 빈 통
    } else if (m === 'ring') {
      ropeLine(g, x0, y0, ex, ey, ts, 1, '#f2e6c0', false);
      g.strokeStyle = '#e8532f'; g.lineWidth = Math.max(2, ts * 0.08); g.beginPath(); g.arc(ex, ey, ts * 0.16, 0, 7); g.stroke();
      g.strokeStyle = '#ffffff'; g.lineWidth = Math.max(1, ts * 0.03); g.setLineDash([ts * 0.08, ts * 0.17]); g.beginPath(); g.arc(ex, ey, ts * 0.16, 0, 7); g.stroke(); g.setLineDash([]);
    } else {
      ropeLine(g, x0, y0, ex, ey, ts, 1, '#f2e6c0', false);
      rr(g, ex - ts * 0.11, ey - ts * 0.14, ts * 0.22, ts * 0.28, ts * 0.06, '#c8321f'); rr(g, ex - ts * 0.11, ey - ts * 0.04, ts * 0.22, ts * 0.05, ts * 0.01, '#f4f6f7');      // 빨간 투척 가방
      disc(g, ex, ey - ts * 0.15, ts * 0.04, '#23272c');
    }
  }
}

/** 처진 줄 한 가닥 (그림자 + 줄). dashed 면 점선 (이은 옷) */
function ropeLine(g: G, x0: number, y0: number, x1: number, y1: number, ts: number, sag: number, col: string, dashed: boolean): void {
  const mx = (x0 + x1) / 2 + ts * 0.3 * sag, my = (y0 + y1) / 2 + ts * 0.2 * sag;
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = Math.max(2, ts * 0.07);
  g.beginPath(); g.moveTo(x0, y0); g.quadraticCurveTo(mx, my, x1, y1); g.stroke();
  g.strokeStyle = col; g.lineWidth = Math.max(1.5, ts * 0.04);
  if (dashed) g.setLineDash([ts * 0.12, ts * 0.07]);
  g.stroke();
  if (dashed) g.setLineDash([]);
}

// ───────────────────────── 단계 2: 폭파 진입 (§4.2a) ─────────────────────────
/** 장약을 다루는 문·잔해 임무 (본 임무 force·clear 또는 이동 중 하위 작업) — 없으면 null */
function chargeTask(a: FieldAgent): Task | null {
  const t = a.task;
  if (!t || a.status === 'left') return null;
  const k = t.sub && (t.sub.kind === 'force' || t.sub.kind === 'clear') ? t.sub : t.kind === 'force' || t.kind === 'clear' ? t : null;
  return k && k.method === 'charge' && k.tile >= 0 ? k : null;
}
/**
 * 문에 붙인 장약(작은 회색 띠 + 깜박이는 빨간 점 — 설치하는 동안은 띠가 진행도만큼 자란다)과 3-2-1 카운트(문 위의 숫자, 0.5초씩).
 * 사람을 그린 뒤에 그린다. 폭발 그림은 G5 의 진입 효과('breach' 의 'charge' 갈래 — combat.ts)
 */
export function drawCharges(g: G, s: Scene, ts: number, time: number): void {
  for (const a of s.agents) {
    const t = chargeTask(a);
    if (t === null) continue;
    const dx = t.tile % s.w, dy = (t.tile / s.w) | 0;
    const placing = t.phase === 0, frac = placing ? Math.min(1, t.progress / 5) : 1;
    if (placing && frac <= 0) continue;
    // 대원이 선 쪽의 문 면 (설치한 쪽): 가로 벽의 문(좌우가 벽)이면 위·아래 면, 세로 벽의 문이면 좌·우 면
    const wallAt = (i: number): boolean => s.tiles[i] === T.WALL || s.tiles[i] === T.WINDOW;
    const wallLR = dx > 0 && dx < s.w - 1 && wallAt(t.tile - 1) && wallAt(t.tile + 1);
    const ox = wallLR ? 0 : Math.sign(a.x - dx) || 1, oy = wallLR ? Math.sign(a.y - dy) || 1 : 0;
    const side = placing ? 0.32 : 0.3;
    const cx = (dx + 0.5 + ox * side) * ts, cy = (dy + 0.5 + oy * side) * ts;
    const L = ts * 0.5 * frac, W = Math.max(2, ts * 0.1);
    g.fillStyle = 'rgba(0,0,0,0.45)';
    if (ox === 0) g.fillRect(cx - L / 2 - 1, cy - W / 2 - 1, L + 2, W + 2); else g.fillRect(cx - W / 2 - 1, cy - L / 2 - 1, W + 2, L + 2);
    g.fillStyle = '#8e969c';
    if (ox === 0) g.fillRect(cx - L / 2, cy - W / 2, L, W); else g.fillRect(cx - W / 2, cy - L / 2, W, L);
    if (!placing || frac > 0.6) {
      const on = Math.floor(time * (t.phase === 3 ? 8 : 3)) % 2 === 0;
      disc(g, cx, cy, Math.max(1.5, ts * 0.06), on ? '#ff3b30' : '#6a1a16');
    }
    if (t.phase === 3) {
      const n = Math.max(1, 3 - Math.floor(t.progress / 0.5));
      // 숫자는 장약을 붙인 쪽(진입조가 물러선 쪽)으로 한 칸 — 문 안쪽에 그리면 방 안의 사람·이름표를 덮는다. 카운트는 반경(CHARGE.clear 2.5칸)에 동료가 없을 때만 돌므로 그 자리에 대원은 없다
      const fs = Math.max(11, ts * 0.7), tx = (dx + 0.5 + ox * 1.05) * ts, ty = (dy + 0.5 + oy * 1.05) * ts;
      g.font = `800 ${fs}px system-ui, sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle';
      g.lineWidth = Math.max(2, fs * 0.16); g.strokeStyle = 'rgba(8,13,18,0.9)'; g.strokeText(String(n), tx, ty);
      g.fillStyle = n === 1 ? '#ff6b5c' : '#ffd166'; g.fillText(String(n), tx, ty);
    }
  }
}
/**
 * 농성 문 잠금으로 막은 문(skin 'barricade', 아직 막혀 있다): 문 안쪽 칸에 쌓은 가구 몇 개 (관찰자에게만 보이는 진실 — 대원의 믿음에는 그냥 잠긴 문이다).
 * 안쪽 = 문 양쪽 가운데 구역이 더 작은 쪽(인질을 붙잡은 방). 사람보다 먼저 그린다
 */
export function drawBarricades(g: G, s: Scene, ts: number): void {
  for (const p of s.props) {
    if (p.kind !== 'door' || p.skin !== 'barricade' || !p.blocking) continue;
    let bx = 0, by = 0, bn = Infinity;
    for (const [ox, oy] of [[0, -1], [0, 1], [-1, 0], [1, 0]]) {
      const j = (p.y + oy) * s.w + (p.x + ox), r = s.region[j];
      if (r === undefined || r < 0) continue;
      const n = s.regions[r].tiles.length;
      if (n < bn) { bn = n; bx = ox; by = oy; }
    }
    if (bn === Infinity) continue;
    const px = -by, py = bx;      // 문 면을 따라
    const boxes: [number, number, number, number, string][] = [[0.62, 0, 0.7, 0.3, '#8a6440'], [0.98, 0.3, 0.36, 0.34, '#a07a4e'], [0.95, -0.36, 0.32, 0.3, '#6b4f34']];
    for (const [d, o, w, h, col] of boxes) {
      const x = (p.x + 0.5 + bx * d + px * o) * ts, y = (p.y + 0.5 + by * d + py * o) * ts;
      const W = (bx === 0 ? w : h) * ts, H = (bx === 0 ? h : w) * ts;
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x - W / 2 + 1.5, y - H / 2 + 1.5, W, H);
      rr(g, x - W / 2, y - H / 2, W, H, Math.max(1, ts * 0.04), col);
      g.fillStyle = 'rgba(255,235,200,0.25)'; g.fillRect(x - W / 2 + 1, y - H / 2 + 1, W - 2, Math.max(1, H * 0.22));      // 윗면의 밝은 띠
      g.strokeStyle = 'rgba(0,0,0,0.45)'; g.lineWidth = 1; g.strokeRect(x - W / 2 + 0.5, y - H / 2 + 0.5, W - 1, H - 1);
    }
  }
}
