// 대응 방법의 현장 그림 (docs/specs/R2-methods.md §3.7). 화면 계층 — 상태를 읽기만 한다(판단·실행 함수를 부르지 않는다).
// renderScene 이 부른다: 사람을 그리기 전에 보트(drawBoats), 사람을 그린 뒤에 줄·장대(drawMethodFx).
//   단계 1d (수난): 구명줄(끝의 빨간 투척 가방) · 구명환(빨강·흰 고리) · 즉석 부력물(회갈색 점선 줄 끝의 흰 통) · 장대(갈고리) · 줄 확보(헤엄치는 동료까지의 줄) ·
//                   보트(주황 고무보트 1.4×0.7칸 / 구조정이면 회색 단단한 배 1.8×0.8칸)
//   단계 2 (폭파 진입): 문에 붙인 장약·3-2-1 카운트(drawCharges — 사람 뒤), 농성 문 안쪽의 쌓은 가구(drawBarricades — 사람 앞). 폭발은 G5 combat.ts 의 'charge' 갈래
//   단계 4·5·6 (화재·무장·누출·통제): 사람 밑(drawMethodGround) — 송풍기와 바람 방향(s.fan · 설치 중인 송풍기 · 맨몸 환기는 바람만), 고가 사다리의 회전대, 저격 자리 표시 /
//                   사람 위(drawMethodOver) — 고가 사다리(가로대), 저격 조준선(관찰자 시점만)과 좁혀지는 조준 고리, 대피 방송의 호 / 효과 — 소화기의 흰 분말 줄기(drawPowder)
//   뒤 단계가 더한다: 지지대·에어백(3) …
// 대원의 자세와 손에 든 것은 renderScene.agentPose, 헤엄치는 대원은 sprites.drawSwimmer 가 그린다.

import type { Sim } from '../../sim/engine';
import { hasKit } from '../../sim/crews';
import { isIndoor, staticPass } from '../../sim/field/grid';
import { T } from '../../sim/types';
import type { FieldAgent, Scene, Task } from '../../sim/types';
import { disc, hash2, rr } from './common';
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

// ───────────────────────── 단계 4·5·6: 화재·무장·누출·통제 (§3.7) ─────────────────────────
const DIR4: readonly (readonly [number, number])[] = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const fanDirAt = new WeakMap<Scene, { key: string; d: [number, number] }>();
/**
 * 송풍기가 바람을 넣는 쪽 (생김새만 — 같은 자리는 다시 셈하지 않는다): 송풍기 칸에서 네 방향으로 두 칸 안에 처음 만나는 실내 칸(바닥·문)이 있는 쪽.
 * 건물 출입구 앞(실외)이면 문 쪽 하나, 방 문(실내 — 환기 후 차단)이면 양쪽 가운데 구역이 더 작은 쪽(밸브가 있는 방). 없으면 위쪽
 */
export function fanDir(s: Scene, fx: number, fy: number): [number, number] {
  const key = fx + ',' + fy + ',' + s.staticVersion, c = fanDirAt.get(s);
  if (c && c.key === key) return c.d;
  let best: [number, number] = [0, -1], bs = -Infinity;
  for (const [dx, dy] of DIR4) {
    for (let k = 1; k <= 2; k++) {
      const x = fx + dx * k, y = fy + dy * k;
      if (x < 0 || y < 0 || x >= s.w || y >= s.h) break;
      const i = y * s.w + x, t = s.tiles[i];
      if (isIndoor(t)) { const r = s.region[i], n = r >= 0 && s.regions[r] ? s.regions[r].tiles.length : 999, sc = -n - k * 0.5; if (sc > bs) { bs = sc; best = [dx, dy]; } break; }
      if (!staticPass(t)) break;
    }
  }
  fanDirAt.set(s, { key, d: best });
  return best;
}
/** 송풍기 기계를 놓는 자리 (칸 단위): 출입구 앞(실외 칸)이면 그 칸, 방 문(실내 칸)이면 바람이 들어가는 반대쪽으로 0.6칸 물러선 곳 */
function fanSpot(s: Scene, fx: number, fy: number, d: readonly [number, number]): { x: number; y: number } {
  const inside = fx >= 0 && fy >= 0 && fx < s.w && fy < s.h && isIndoor(s.tiles[fy * s.w + fx]);
  const back = inside ? 0.6 : 0.05;
  return { x: fx - d[0] * back, y: fy - d[1] * back };
}
/**
 * 송풍기 (위에서 본 기호 — 둥근 덮개 안의 휘어진 꽃잎 날개 다섯이 돌고, 가는 철망 고리가 덮는다.
 * 날개 셋은 멈춘 그림에서 글자 Y 로 읽혀(견본표 24 화소) 다섯으로 늘렸다): 주황 받침 틀 위, 바람이 나가는 쪽(ang)의 반대편에 손잡이.
 * spin = 날개 각도 (설치 중이면 0 — 멈춘 날개), a = 불투명도
 */
export function drawFanMachine(g: G, x: number, y: number, ts: number, ang: number, spin: number, a: number): void {
  const R = ts * 0.32;
  g.save(); g.translate(x, y); g.rotate(ang); g.globalAlpha *= a;
  rr(g, -R * 1.12 + ts * 0.04, -R * 1.12 + ts * 0.05, R * 2.24, R * 2.24, R * 0.4, 'rgba(0,0,0,0.35)');      // 그림자
  rr(g, -R * 1.12, -R * 1.12, R * 2.24, R * 2.24, R * 0.4, '#d9642a');      // 받침 틀 (주황)
  rr(g, -R * 1.12, -R * 1.12, R * 0.5, R * 2.24, R * 0.25, '#a8461a');      // 뒤쪽 손잡이 (바람이 나가는 쪽의 반대)
  disc(g, 0, 0, R, '#1b2025');      // 덮개 안
  g.fillStyle = '#c9d0d6';
  for (let b = 0; b < 5; b++) {
    const t = spin + (b * Math.PI * 2) / 5, at = (k: number, r: number): [number, number] => [Math.cos(t + k) * R * r, Math.sin(t + k) * R * r];
    const p0 = at(0, 0.24), c1 = at(1.0, 0.8), p1 = at(0.82, 0.94), c2 = at(0.12, 0.72);      // 넓게 휜 꽃잎 (가늘면 별 모양으로 읽힌다)
    g.beginPath(); g.moveTo(p0[0], p0[1]); g.quadraticCurveTo(c1[0], c1[1], p1[0], p1[1]); g.quadraticCurveTo(c2[0], c2[1], p0[0], p0[1]); g.fill();
  }
  disc(g, 0, 0, R * 0.24, '#f0b84a');      // 축
  g.strokeStyle = 'rgba(255,255,255,0.3)'; g.lineWidth = Math.max(1, ts * 0.022);
  g.beginPath(); g.arc(0, 0, R * 0.62, 0, 6.2832); g.stroke();      // 철망 고리
  g.beginPath(); g.arc(0, 0, R, 0, 6.2832); g.stroke();      // 덮개 테
  g.restore();
}
/** 바람 줄기: (x, y) 에서 (dx, dy) 쪽으로 흘러가는 짧은 선들(가운데 줄에는 화살촉). 송풍기는 세 줄 3.6칸, 맨몸 환기(power 0.5)는 옅은 두 줄 2.4칸 */
function drawWind(g: G, x: number, y: number, dx: number, dy: number, ts: number, time: number, power: number, a: number): void {
  const nx = -dy, ny = dx, strong = power >= 1;
  const lanes = strong ? [-0.3, 0, 0.3] : [-0.18, 0.18];
  const L = (strong ? 3.6 : 2.4) * ts, seg = ts * (strong ? 0.6 : 0.45);
  g.lineCap = 'round';
  for (let li = 0; li < lanes.length; li++) for (let q = 0; q < 2; q++) {
    const ph = (time * (strong ? 1.1 : 0.7) + q * 0.5 + li * 0.29) % 1;
    const al = a * (strong ? 0.75 : 0.5) * Math.sin(Math.PI * ph);
    if (al <= 0.02) continue;
    const spread = lanes[li] * ts * (1 + 0.7 * ph), d0 = ts * 0.3 + L * ph, d1 = d0 + seg;
    const x0 = x + dx * d0 + nx * spread, y0 = y + dy * d0 + ny * spread, x1 = x + dx * d1 + nx * spread * 1.08, y1 = y + dy * d1 + ny * spread * 1.08;
    const head = lanes[li] === 0 || (!strong && li === 0), h = ts * 0.14;      // 화살촉: 흐르는 쪽
    const path = (): void => {
      g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1);
      if (head) { g.moveTo(x1 - dx * h + nx * h * 0.8, y1 - dy * h + ny * h * 0.8); g.lineTo(x1, y1); g.lineTo(x1 - dx * h - nx * h * 0.8, y1 - dy * h - ny * h * 0.8); }
    };
    const lw = Math.max(1, ts * (strong ? 0.05 : 0.035));
    g.strokeStyle = `rgba(8,13,18,${0.45 * al})`; g.lineWidth = lw + 2; path(); g.stroke();      // 밝은 바닥에서도 보이게 어두운 테
    g.strokeStyle = `rgba(196,236,255,${al})`; g.lineWidth = lw; path(); g.stroke();
  }
}
/** 송풍기를 설치하는 중인 대원의 임무 (배연·환기 후 차단의 설치 — phase 5. 맨몸 환기면 null) */
function fanBeingSet(sim: Sim, a: FieldAgent): Task | null {
  const t = a.task;
  if (a.status !== 'active' || !t || t.phase !== 5) return null;
  if (t.kind === 'suppress' && t.method === 'ventilate') return t;
  if (t.kind === 'mitigate' && t.method === 'ventFirst' && hasKit(sim, a.rid, 'fan')) return t;
  return null;
}
/** 고가 사다리 방수의 자리에 서서 쏘는 중인가 (자리 t.tx, t.ty 에 닿았고 대상 불 칸이 있다) */
function aerialAt(a: FieldAgent): Task | null {
  const t = a.task;
  if (a.status !== 'active' || !t || t.kind !== 'suppress' || t.method !== 'aerial' || t.phase !== 1 || t.tile < 0) return null;
  return Math.hypot(a.x - t.tx, a.y - t.ty) <= 0.7 ? t : null;
}
/** (N8 단계 8 의 남은 그림) 높은 자리의 사람에게 사다리를 편 사다리 구조 — 땅 칸(ground)에 닿아 일하는 중 (실행기 perchRescue 의 진행 t.progress > 0) */
function ladderRescueAt(s: Scene, a: FieldAgent): Task | null {
  const t = a.task;
  if (a.status !== 'active' || !t || t.kind !== 'extricate' || t.method !== 'ladder' || !(t.progress > 0) || t.cas < 0) return null;
  const c = s.casualties[t.cas];
  return c && !c.dead && c.where === 'scene' && s.kinds && s.kinds.perch && s.kinds.perch.some((p) => p.cas === c.id) ? t : null;
}
/** 그 부대의 대원이 사다리를 펴 쓰고 있는가 (고가 사다리 방수 또는 높은 자리 구조) — 대기 줄의 사다리차를 '편' 모습으로 그린다 (renderScene → sprites.drawEmergency) */
export function ladderDeployed(s: Scene, unitId: number): boolean {
  for (const a of s.agents) if (a.unitId === unitId && (aerialAt(a) || ladderRescueAt(s, a))) return true;
  return false;
}
/** 사다리차의 회전대 (칸 단위): 대원 옆 0.55칸 — 사다리가 대원 위를 지나지 않게 겨눈 쪽의 왼편. ux, uy = 대상 불 칸 쪽 */
function turntable(s: Scene, a: FieldAgent, t: Task): { x: number; y: number; ux: number; uy: number } {
  const tx = t.tile % s.w, ty = (t.tile / s.w) | 0, d = Math.hypot(tx - a.x, ty - a.y) || 1, ux = (tx - a.x) / d, uy = (ty - a.y) / d;
  return { x: a.x + uy * 0.55 - ux * 0.15, y: a.y - ux * 0.55 - uy * 0.15, ux, uy };
}
/** 사다리 끝 (칸 단위): 회전대에서 대상 불 칸까지 가는 선이 처음 만나는 창·문·벽 칸의 가운데 (없으면 불 칸 0.8칸 앞) */
function ladderTip(s: Scene, x0: number, y0: number, x1: number, y1: number): { x: number; y: number } {
  const d = Math.hypot(x1 - x0, y1 - y0) || 1, n = Math.max(1, Math.ceil(d / 0.2));
  for (let q = 1; q <= n; q++) {
    const x = Math.round(x0 + ((x1 - x0) * q) / n), y = Math.round(y0 + ((y1 - y0) * q) / n);
    if (x < 0 || y < 0 || x >= s.w || y >= s.h) break;
    const t = s.tiles[y * s.w + x];
    if (t === T.WINDOW || t === T.WALL || t === T.DOOR) return { x, y };
  }
  return { x: x1 - ((x1 - x0) / d) * 0.8, y: y1 - ((y1 - y0) / d) * 0.8 };
}
/** 저격 자리를 정한 저격수의 임무 (t.range === 1 — 정했다는 표시, 자리는 t.tx, t.ty) */
function sniperOf(a: FieldAgent): Task | null {
  const t = a.task;
  return a.status === 'active' && t && t.kind === 'engage' && t.method === 'sniper' && t.range === 1 ? t : null;
}
/** 저격 자리에 닿아 조준하는가 (renderScene 이 몸을 낮춰 그린다) */
export function sniperSet(a: FieldAgent): boolean { const t = sniperOf(a); return t !== null && Math.hypot(a.x - t.tx, a.y - t.ty) <= 0.7; }
/** 출입구 통제 자리에서 대피 방송을 하는 중인가 */
function announcing(a: FieldAgent): boolean {
  const t = a.task;
  return a.status === 'active' && !!t && t.kind === 'perimeter' && t.method === 'announce' && a.spot >= 0 && Math.abs(a.x - a.px) + Math.abs(a.y - a.py) < 0.01;
}

/**
 * 사람 밑에 그리는 방법 그림 (보트 다음): 돌고 있는 송풍기와 바람(s.fan — 맨몸 환기는 바람만), 설치 중인 송풍기(멈춘 날개, 진행만큼 진해진다),
 * 고가 사다리의 회전대(빨간 받침), 저격 자리(가는 원과 네 눈금 — 가는 중이면 점선, 닿으면 실선)
 */
export function drawMethodGround(g: G, sim: Sim, s: Scene, ts: number, alpha: number, time: number): void {
  const px = (v: number): number => (v + 0.5) * ts;
  const f = s.fan;
  const fanOn = !!f && sim.t < f.until;
  if (f && fanOn) {
    const d = fanDir(s, f.x, f.y), sp = fanSpot(s, f.x, f.y, d);
    if (f.power >= 1) {
      drawWind(g, px(sp.x), px(sp.y), d[0], d[1], ts, time, f.power, 1);
      drawFanMachine(g, px(sp.x), px(sp.y), ts, Math.atan2(d[1], d[0]), time * 14, 1);
    } else drawWind(g, px(f.x - d[0] * 0.5), px(f.y - d[1] * 0.5), d[0], d[1], ts, time, f.power, 1);      // 맨몸 환기: 열어 둔 문으로 드는 바람만
  }
  for (const a of s.agents) {
    const vt = fanBeingSet(sim, a);
    if (vt && !(f && fanOn && f.x === vt.tx && f.y === vt.ty)) {
      const d = fanDir(s, vt.tx, vt.ty), sp = fanSpot(s, vt.tx, vt.ty, d);
      drawFanMachine(g, px(sp.x), px(sp.y), ts, Math.atan2(d[1], d[0]), 0, 0.35 + 0.65 * Math.min(1, Math.max(0, a.ring)));
    }
    const lr = ladderRescueAt(s, a);
    if (lr) {      // (N8) 높은 자리 구조의 회전대: 대원 곁, 그 사람 쪽을 본다
      const c = s.casualties[lr.cas], q = ip(a, alpha), d = Math.hypot(c.x - a.x, c.y - a.y) || 1, ux = (c.x - a.x) / d, uy = (c.y - a.y) / d;
      g.save(); g.translate(px(q.x + uy * 0.55 - ux * 0.15), px(q.y - ux * 0.55 - uy * 0.15)); g.rotate(Math.atan2(uy, ux));
      rr(g, -ts * 0.36 + ts * 0.04, -ts * 0.3 + ts * 0.05, ts * 0.72, ts * 0.6, ts * 0.12, 'rgba(0,0,0,0.35)');
      rr(g, -ts * 0.36, -ts * 0.3, ts * 0.72, ts * 0.6, ts * 0.12, '#c8321f');
      disc(g, 0, 0, ts * 0.2, '#3a4148'); disc(g, 0, 0, ts * 0.1, '#8f979e');
      g.restore();
    }
    const at = aerialAt(a);
    if (at) {
      const b = turntable(s, a, at), q = ip(a, alpha), bx = px(b.x + (q.x - a.x)), by = px(b.y + (q.y - a.y));
      g.save(); g.translate(bx, by); g.rotate(Math.atan2(b.uy, b.ux));
      rr(g, -ts * 0.36 + ts * 0.04, -ts * 0.3 + ts * 0.05, ts * 0.72, ts * 0.6, ts * 0.12, 'rgba(0,0,0,0.35)');
      rr(g, -ts * 0.36, -ts * 0.3, ts * 0.72, ts * 0.6, ts * 0.12, '#c8321f');      // 사다리차의 회전대 (빨강)
      disc(g, 0, 0, ts * 0.2, '#3a4148'); disc(g, 0, 0, ts * 0.1, '#8f979e');
      g.restore();
    }
    const st = sniperOf(a);
    if (st) {
      const x = px(st.tx), y = px(st.ty), on = Math.hypot(a.x - st.tx, a.y - st.ty) <= 0.7, r = ts * 0.46;
      g.strokeStyle = `rgba(150,200,255,${on ? 0.85 : 0.55})`; g.lineWidth = Math.max(1, ts * 0.045); g.lineCap = 'round';
      if (!on) g.setLineDash([ts * 0.1, ts * 0.08]);
      g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.stroke(); g.setLineDash([]);
      for (let k = 0; k < 4; k++) { const c = Math.cos((k * Math.PI) / 2), sn = Math.sin((k * Math.PI) / 2); g.beginPath(); g.moveTo(x + c * r * 0.78, y + sn * r * 0.78); g.lineTo(x + c * r * 1.28, y + sn * r * 1.28); g.stroke(); }
    }
  }
}

/** 고가 사다리 한 대 (화소 좌표): 그림자 · 가로대 · 두 난간(끝으로 갈수록 좁다) · 세 마디의 이음매 */
function drawLadder(g: G, ax: number, ay: number, bx: number, by: number, ts: number): void {
  const dx = bx - ax, dy = by - ay, L = Math.hypot(dx, dy) || 1, ux = dx / L, uy = dy / L, nx = -uy, ny = ux, hw = ts * 0.15, sh = ts * 0.12;
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = hw * 2 + ts * 0.06; g.beginPath(); g.moveTo(ax + sh, ay + sh * 1.3); g.lineTo(bx + sh, by + sh * 1.3); g.stroke();
  g.strokeStyle = '#7d868e'; g.lineWidth = Math.max(1, ts * 0.035);
  for (let d = ts * 0.22; d < L - ts * 0.05; d += ts * 0.26) { const k = hw * (1 - (0.25 * d) / L); g.beginPath(); g.moveTo(ax + ux * d + nx * k, ay + uy * d + ny * k); g.lineTo(ax + ux * d - nx * k, ay + uy * d - ny * k); g.stroke(); }
  const rail = Math.max(1.5, ts * 0.055);
  for (const [col, w] of [['#2a3036', rail + 2], ['#dfe4e8', rail]] as [string, number][]) {      // 난간: 어두운 테 위에 밝은 쇠 (밝은 바닥에서도 보인다)
    g.strokeStyle = col; g.lineWidth = w;
    for (const sg of [-1, 1]) { g.beginPath(); g.moveTo(ax + nx * hw * sg, ay + ny * hw * sg); g.lineTo(bx + nx * hw * 0.75 * sg, by + ny * hw * 0.75 * sg); g.stroke(); }
  }
  g.strokeStyle = '#5b636b'; g.lineWidth = Math.max(1.5, ts * 0.06);
  for (const k of [1 / 3, 2 / 3]) { const x = ax + dx * k, y = ay + dy * k, w = hw * (1 - 0.25 * k) * 1.15; g.beginPath(); g.moveTo(x + nx * w, y + ny * w); g.lineTo(x - nx * w, y - ny * w); g.stroke(); }
}

/**
 * 사람 위에 그리는 방법 그림 (줄·장대 다음): 고가 사다리(회전대에서 대상 쪽 창까지 — 대원은 회전대의 조작대에서 방수하고 오르지 않는다),
 * 저격 조준선(관찰자 시점만 — G5 는 이 대원의 겨누는 선을 그리지 않는다)과 조준이 끝나 갈수록 좁혀지는 고리, 대피 방송의 호 셋(확성기 앞으로 퍼진다)
 */
export function drawMethodOver(g: G, sim: Sim, s: Scene, ts: number, alpha: number, time: number, truth: boolean): void {
  const px = (v: number): number => (v + 0.5) * ts;
  for (const a of s.agents) {
    const lr = ladderRescueAt(s, a);
    if (lr) {      // (N8) 회전대에서 높은 자리의 그 사람 곁까지 (사람 칸 0.35칸 앞에서 멈춘다 — 사람 그림을 덮지 않게)
      const c = s.casualties[lr.cas], q = ip(a, alpha), d0 = Math.hypot(c.x - a.x, c.y - a.y) || 1, ux = (c.x - a.x) / d0, uy = (c.y - a.y) / d0;
      const bx = q.x + uy * 0.55 - ux * 0.15, by = q.y - ux * 0.55 - uy * 0.15, d = Math.hypot(c.x - bx, c.y - by) || 1;
      drawLadder(g, px(bx), px(by), px(c.x - ((c.x - bx) / d) * 0.35), px(c.y - ((c.y - by) / d) * 0.35), ts);
      continue;
    }
    const at = aerialAt(a);
    if (at) {
      const b = turntable(s, a, at), q = ip(a, alpha), ox = q.x - a.x, oy = q.y - a.y;
      const fx = at.tile % s.w, fy = (at.tile / s.w) | 0, tip = ladderTip(s, b.x, b.y, fx, fy);
      const dl = Math.hypot(tip.x - b.x, tip.y - b.y) || 1, over = Math.min(0.45, Math.max(0, Math.hypot(fx - tip.x, fy - tip.y) - 0.3));      // 끝은 창턱을 조금 넘는다 (창 너머로 걸친 사다리)
      drawLadder(g, px(b.x + ox), px(b.y + oy), px(tip.x + ((tip.x - b.x) / dl) * over), px(tip.y + ((tip.y - b.y) / dl) * over), ts);
      continue;
    }
    const st = sniperOf(a);
    if (st && truth && sniperSet(a)) {
      const h = s.hostiles[st.hostile];
      if (!h || (h.state !== 'hold' && h.state !== 'fight') || sim.t < h.stunUntil) continue;
      const ap = ip(a, alpha), hp = ip(h, alpha), d = Math.hypot(hp.x - ap.x, hp.y - ap.y) || 1, ux = (hp.x - ap.x) / d, uy = (hp.y - ap.y) / d;
      const k = a.ring > 0 && a.ring <= 1.01 ? Math.min(1, a.ring) : 0;      // 조준 진행 (6초)
      g.strokeStyle = `rgba(150,200,255,${0.35 + 0.35 * k})`; g.lineWidth = Math.max(1, ts * 0.03); g.lineCap = 'round';
      g.setLineDash([ts * 0.06, ts * 0.12]);
      g.beginPath(); g.moveTo(px(ap.x + ux * 0.9), px(ap.y + uy * 0.9)); g.lineTo(px(hp.x - ux * 0.45), px(hp.y - uy * 0.45)); g.stroke(); g.setLineDash([]);
      const r = ts * (0.7 - 0.4 * k), x = px(hp.x), y = px(hp.y);
      g.strokeStyle = k > 0.85 ? 'rgba(255,110,96,0.9)' : `rgba(150,200,255,${0.5 + 0.4 * k})`; g.lineWidth = Math.max(1, ts * 0.04);
      g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.stroke();
      for (let j = 0; j < 4; j++) { const c = Math.cos((j * Math.PI) / 2 + Math.PI / 4), sn = Math.sin((j * Math.PI) / 2 + Math.PI / 4); g.beginPath(); g.moveTo(x + c * r * 0.55, y + sn * r * 0.55); g.lineTo(x + c * r * 1.2, y + sn * r * 1.2); g.stroke(); }
      continue;
    }
    if (announcing(a)) {
      const q = ip(a, alpha), fl = Math.hypot(a.fx, a.fy) || 1, dir = Math.atan2(a.fy / fl, a.fx / fl);
      const ox = px(q.x) + Math.cos(dir) * ts * 0.5, oy = px(q.y) + Math.sin(dir) * ts * 0.5;
      g.lineCap = 'round';
      const lw = Math.max(1, ts * 0.045);
      for (let j = 0; j < 3; j++) {
        const ph = (time * 0.8 + j / 3) % 1, r = ts * (0.22 + 1.5 * ph), span = 0.5 + 0.3 * ph, al = 0.75 * (1 - ph);      // 멀어질수록 넓게 퍼진다 (같은 크기의 호가 나란하면 글자 ')' 처럼 읽힌다)
        g.beginPath(); g.arc(ox, oy, r, dir - span, dir + span);
        g.strokeStyle = `rgba(8,13,18,${0.45 * al})`; g.lineWidth = lw + 2; g.stroke();      // 밝은 바닥에서도 보이게 어두운 테
        g.strokeStyle = `rgba(255,226,160,${al})`; g.lineWidth = lw; g.stroke();
      }
    }
  }
}

/**
 * 소화기의 흰 분말 줄기 (효과 'spray' 가운데 색이 있는 것 — 물줄기는 색이 없다): 분사구에서 넓어지는 흰 부채꼴, 바깥으로 퍼지는 분말 덩이, 끝에 뭉친 구름.
 * 물줄기(fx.drawSpray — 푸른 선과 물안개)와 모양·색이 다르다. k = 효과의 경과 비율(0..1)
 */
export function drawPowder(g: G, x0: number, y0: number, x1: number, y1: number, ts: number, k: number, time: number): void {
  const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1, ux = dx / len, uy = dy / len, nx = -uy, ny = ux;
  const a = 1 - k * 0.7, sx = x0 + ux * ts * 0.45, sy = y0 + uy * ts * 0.45, L = Math.max(ts * 0.3, len - ts * 0.45);
  const w0 = ts * 0.05, w1 = ts * 0.5;
  const cone = (w: number, col: string): void => {
    g.fillStyle = col; g.beginPath();
    g.moveTo(sx + nx * w0, sy + ny * w0); g.lineTo(sx + ux * L + nx * w, sy + uy * L + ny * w);
    g.quadraticCurveTo(sx + ux * (L + ts * 0.25), sy + uy * (L + ts * 0.25), sx + ux * L - nx * w, sy + uy * L - ny * w);
    g.lineTo(sx - nx * w0, sy - ny * w0); g.closePath(); g.fill();
  };
  cone(w1, `rgba(232,234,232,${0.28 * a})`);
  cone(w1 * 0.45, `rgba(250,250,248,${0.45 * a})`);
  for (let q = 0; q < 9; q++) {
    const t = (time * 1.9 + q / 9) % 1, off = (hash2(q, 11) - 0.5) * 1.6;
    disc(g, sx + ux * L * t + nx * off * w1 * t, sy + uy * L * t + ny * off * w1 * t, ts * (0.05 + 0.14 * t), `rgba(246,246,242,${0.6 * (1 - 0.6 * t) * a})`);
  }
  for (let q = 0; q < 4; q++) disc(g, x1 + (hash2(q, 5) - 0.5) * ts * 0.55, y1 + (hash2(q, 7) - 0.5) * ts * 0.55, ts * (0.24 + 0.12 * hash2(q, 9)) * (1 + 0.6 * k), `rgba(238,238,234,${0.35 * a})`);
}
