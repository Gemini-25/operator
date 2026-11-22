// N8 사건 종류 다양화의 소품 그림 (docs/specs/N8-incident-kinds.md §5.12). 열쇠는 Prop.skin 의 값이다. 읽기만 한다 — 결과를 바꾸지 않는다.
// 단계 3: 오인 신고의 답 셋 — 물에 뜬 물건(floater) · 터진 폭죽 잔해(fireworks) · 음식물 쓰레기(trash). 단계 4a: 전봇대(pole) · 끊어진 전선(wire) · 위험 반경의 점선 고리(drawHazRings).
// 나머지 스킨(pipe·hole·sign …)은 그 시나리오의 단계가 더한다.
import type { Animal, Scene } from '../../../sim/types';
import type { G } from '../common';
import { disc, hash2, oval, seg } from '../common';
import type { SkinPainter } from '../skins';

/** 물에 뜬 물건: 반쯤 잠긴 마네킹 같은 연한 덩어리와 비닐 봉투 — 물결에 조금 흔들린다 (timeMs 로만) */
const floater: SkinPainter = (g, p, timeMs) => {
  const bob = Math.sin(timeMs / 700 + p.id) * 0.03;
  oval(g, 0, 0.06 + bob, 0.46, 0.2, 'rgba(10,30,50,0.35)');
  oval(g, -0.06, bob, 0.36, 0.13, '#d9c7b0');
  disc(g, 0.3, -0.02 + bob, 0.1, '#e2d2bd');
  oval(g, -0.28, 0.12 + bob, 0.16, 0.1, '#3a3f45', 0.4);
  seg(g, -0.4, 0.2 + bob, 0.42, 0.22 + bob, 0.02, 'rgba(255,255,255,0.35)');
};

/** 터진 폭죽 잔해: 그을린 종이 통과 흩어진 붉은 종이 조각 */
const fireworks: SkinPainter = (g, p) => {
  const h = (k: number): number => hash2(p.id * 31 + k, p.x * 5 + p.y * 11);
  oval(g, 0, 0.04, 0.42, 0.3, 'rgba(30,30,30,0.32)');
  for (let k = 0; k < 3; k++) { const a = h(k) * 6.28; seg(g, Math.cos(a) * 0.05, Math.sin(a) * 0.05, Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0.07, k === 1 ? '#7a2a22' : '#9c3a2c'); disc(g, Math.cos(a) * 0.24, Math.sin(a) * 0.24, 0.035, '#222'); }
  for (let k = 0; k < 7; k++) { const a = h(10 + k) * 6.28, r = 0.18 + 0.24 * h(20 + k); disc(g, Math.cos(a) * r, Math.sin(a) * r, 0.025, k % 2 ? '#d94a3a' : '#e8c34a'); }
};

/** 음식물 쓰레기: 묶인 봉투 두엇과 새어 나온 얼룩 */
const trash: SkinPainter = (g) => {
  oval(g, 0.05, 0.08, 0.4, 0.26, 'rgba(70,55,30,0.35)');
  oval(g, -0.1, 0, 0.22, 0.2, '#4b5a3c');
  oval(g, 0.14, 0.04, 0.18, 0.16, '#5c6b48');
  seg(g, -0.1, -0.2, -0.05, -0.27, 0.04, '#2f3826');
};

/** 전봇대(위에서 본 모습): 둥근 기둥 머리와 가로대, 기운 그림자 — 소품의 각도가 기운 정도다 */
const pole: SkinPainter = (g) => {
  oval(g, 0.22, 0.18, 0.5, 0.16, 'rgba(0,0,0,0.3)', 0.5);
  seg(g, -0.42, -0.04, 0.42, -0.04, 0.09, '#5b4b3a');
  disc(g, -0.36, -0.04, 0.05, '#c9d2da'); disc(g, 0.36, -0.04, 0.05, '#c9d2da');
  disc(g, 0, 0, 0.17, '#7a6a58');
  disc(g, -0.03, -0.03, 0.08, '#9a8a76');
};

/** 끊어진 전선: 전봇대 쪽에서 늘어진 검은 선 한 가닥(3칸 남짓의 띠) — 살아 있으면 끝에서 불꽃이 깜박인다 (timeMs 로만 — 결과 불변) */
const wire: SkinPainter = (g, p, timeMs) => {
  const ex = 1.15, ey = 0.22;
  g.save();
  g.strokeStyle = '#15181c'; g.lineWidth = 0.07; g.lineCap = 'round';
  g.beginPath(); g.moveTo(-1.5, -0.55); g.quadraticCurveTo(-0.6, 0.45, 0.2, 0.05); g.quadraticCurveTo(0.7, -0.2, ex, ey); g.stroke();
  g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 0.02;
  g.beginPath(); g.moveTo(-1.5, -0.57); g.quadraticCurveTo(-0.6, 0.43, 0.2, 0.03); g.stroke();
  g.restore();
  if (!p.live) { disc(g, ex, ey, 0.05, '#3a3f45'); return; }
  const t = timeMs / 1000, on = Math.sin(t * 23 + p.id) > -0.2;
  disc(g, ex, ey, 0.18 + 0.05 * Math.sin(t * 31), on ? 'rgba(255,236,140,0.45)' : 'rgba(255,236,140,0.15)');
  if (on) for (let k = 0; k < 5; k++) { const a = hash2(p.id + k, Math.floor(t * 12)) * 6.28, r = 0.12 + 0.2 * hash2(k, Math.floor(t * 12) + 7); seg(g, ex, ey, ex + Math.cos(a) * r, ey + Math.sin(a) * r, 0.025, k % 2 ? '#fff6c2' : '#ffd23f'); }
  disc(g, ex, ey, 0.05, '#fffbe0');
};

/** (4b) 터진 수도관: 깨진 맨홀 뚜껑 둘레로 솟는 물줄기 — 살아 있으면 물방울이 튀어 오른다 (timeMs 로만), 잠기면 젖은 자국만 */
const pipe: SkinPainter = (g, p, timeMs) => {
  oval(g, 0, 0.08, 0.5, 0.36, 'rgba(70,110,150,0.35)');
  disc(g, 0, 0, 0.26, '#3b4249'); disc(g, 0, 0, 0.18, '#22282d');
  seg(g, -0.22, -0.05, 0.2, 0.08, 0.04, '#5c656d');
  if (!p.live) return;
  const t = timeMs / 1000;
  for (let k = 0; k < 7; k++) {
    const ph = (t * 1.6 + k / 7) % 1, a = hash2(p.id + k, 3) * 6.28, r = 0.08 + 0.42 * ph;
    disc(g, Math.cos(a) * r, Math.sin(a) * r - 0.35 * Math.sin(ph * Math.PI), 0.07 * (1 - ph) + 0.02, k % 2 ? 'rgba(180,220,255,0.85)' : 'rgba(120,180,240,0.8)');
  }
  disc(g, 0, -0.12, 0.1, 'rgba(210,235,255,0.9)');
};
/** (4b) 싱크홀 표지: 구멍 칸(T.VOID)은 고정 층이 검게 그린다 — 여기서는 가운데의 깊이(어두운 원)와 금 간 가장자리, 보강했으면 지지대 둘 */
const hole: SkinPainter = (g, p) => {
  disc(g, 0, 0, 0.55, 'rgba(0,0,0,0.55)');
  for (let k = 0; k < 6; k++) { const a = hash2(p.id, k) * 6.28, r0 = 0.9 + 0.3 * hash2(k, p.id); seg(g, Math.cos(a) * r0, Math.sin(a) * r0, Math.cos(a + 0.3) * (r0 + 0.5), Math.sin(a + 0.3) * (r0 + 0.5), 0.035, 'rgba(40,32,24,0.85)'); }
  if (p.mitigated) { seg(g, -1.2, -0.9, -0.6, -0.4, 0.09, '#c08a3e'); seg(g, 1.2, 0.9, 0.6, 0.4, 0.09, '#c08a3e'); }
};
/** (4b) 매달린 간판: 기운 판(흔들림 = leak — 많이 흔들릴수록 기울고 떤다, timeMs 로만), 떨어졌거나 고정했으면 반듯하게 */
const sign: SkinPainter = (g, p, timeMs) => {
  const sway = p.live ? (0.15 + 0.5 * (p.leak ?? 0)) * Math.sin(timeMs / (260 - 120 * (p.leak ?? 0)) + p.id) : 0;
  g.save(); g.rotate(sway * 0.35 + (p.live ? 0.12 : 0));
  oval(g, 0.1, 0.2, 0.62, 0.18, 'rgba(0,0,0,0.3)');
  g.fillStyle = p.mitigated ? '#3d6f8f' : '#b0413e'; g.fillRect(-0.55, -0.22, 1.1, 0.4);
  g.fillStyle = 'rgba(255,240,200,0.85)'; g.fillRect(-0.42, -0.1, 0.84, 0.14);
  if (p.mitigated) { seg(g, -0.5, -0.22, -0.5, -0.5, 0.04, '#e8e2d0'); seg(g, 0.5, -0.22, 0.5, -0.5, 0.04, '#e8e2d0'); }
  g.restore();
};
/** (4b) 떨어진 간판 잔해: 깨진 판 조각과 뒤틀린 틀 */
const signDebris: SkinPainter = (g, p) => {
  oval(g, 0, 0.06, 0.5, 0.3, 'rgba(0,0,0,0.3)');
  g.save(); g.rotate(0.4 + hash2(p.id, 1)); g.fillStyle = '#9a3936'; g.fillRect(-0.4, -0.16, 0.7, 0.3); g.restore();
  seg(g, -0.35, 0.2, 0.3, -0.25, 0.04, '#6b6f74');
  for (let k = 0; k < 4; k++) disc(g, (hash2(p.id + k, 5) - 0.5) * 0.8, (hash2(k, p.id + 9) - 0.5) * 0.6, 0.05, '#d8d0c0');
};

/** (N8 단계 5) 벌집: 처마 밑의 회색 종이 벌집과 둘레를 도는 벌 떼(살아 있을 때만 — 점이 timeMs 로 돈다). 떼어 냈으면 아무것도 그리지 않는다 */
const hive: SkinPainter = (g, p, timeMs) => {
  if (p.live !== true) return;
  oval(g, 0, 0.02, 0.26, 0.32, '#8a7f6e');
  for (let k = -2; k <= 2; k++) seg(g, -0.22, k * 0.1, 0.22, k * 0.1, 0.018, 'rgba(60,50,40,0.45)');
  disc(g, 0, 0.3, 0.05, '#2c261f');
  for (let k = 0; k < 9; k++) {
    const a = (timeMs / 900) * (k % 2 ? 1 : -1) + k * 0.7, r = 0.45 + 0.35 * hash2(p.id * 13 + k, 7);
    disc(g, Math.cos(a) * r, Math.sin(a) * r * 0.8, 0.035, k % 3 ? '#e8b923' : '#2a2a2a');
  }
};
export const KINDS_SKINS: Record<string, SkinPainter> = { floater, fireworks, trash, pole, wire, pipe, hole, sign, signDebris, hive };

/**
 * (4b §4.2 utility/main) 지하 주차장 위의 침수 막 — 침수(s.kinds.flood)만큼 짙은 푸른 막과 물결. 진실이지만 눈에 보이는 물이라 두 시점 같다(결과 불변 — 읽기만)
 */
export function drawFlood(g: G, s: Scene, ts: number, timeMs: number, mini: boolean): void {
  if (mini || s.kind !== 'utility' || !s.kinds || s.kinds.base === undefined) return;
  const f = s.kinds.flood ?? 0, reg = s.regions[s.kinds.base];
  if (!(f > 0.02) || !reg) return;
  g.save();
  g.fillStyle = `rgba(40,110,190,${(0.12 + 0.5 * f).toFixed(3)})`;
  for (const i of reg.tiles) g.fillRect((i % s.w) * ts, ((i / s.w) | 0) * ts, ts, ts);
  g.strokeStyle = 'rgba(200,230,255,0.35)'; g.lineWidth = Math.max(1, ts * 0.04);
  const t = timeMs / 900;
  for (let y = reg.y0; y <= reg.y1; y++) { g.beginPath(); for (let x = reg.x0; x <= reg.x1 + 1; x += 0.5) { const yy = (y + 0.5 + 0.12 * Math.sin(x * 2 + t + y)) * ts; if (x === reg.x0) g.moveTo(x * ts, yy); else g.lineTo(x * ts, yy); } g.stroke(); }
  g.restore();
}

/** 위험 반경을 가진 시설물의 생김새 (단계 4a 전선 — 4b 가 더한다) */
const RING_SKINS: ReadonlySet<string> = new Set(['wire', 'sign']);      // 4b: 매달린 간판의 낙하 구역(반경 2)
/**
 * (N8 §4.2 · §5.12) 살아 있는 시설물의 위험 반경 — 점선 고리. 관찰자 시점에서만(진실의 반경 s.kinds.hazR), 매 프레임 조금씩 돈다(timeMs 로만 — 결과 불변).
 * 현장 좌표(칸 가운데 = (x + 0.5) · ts)에서 그린다. 판단 쪽 반경(믿음 haz.r)은 그리지 않는다 — 대원이 서는 통제 자리가 그것을 보여 준다
 */
export function drawHazRings(g: G, s: Scene, ts: number, truth: boolean, timeMs: number, mini: boolean): void {
  if (!truth || mini || s.kind !== 'utility' || !s.kinds) return;
  const r = s.kinds.hazR ?? 0;
  if (!(r > 0)) return;
  for (const p of s.props) {
    if (p.removed || p.kind !== 'fixture' || p.live !== true || !p.skin || !RING_SKINS.has(p.skin)) continue;
    const x = (p.x + 0.5) * ts, y = (p.y + 0.5) * ts;
    g.save();
    g.setLineDash([ts * 0.32, ts * 0.22]); g.lineDashOffset = -(timeMs / 1000) * ts * 0.6;
    g.lineWidth = Math.max(1, ts * 0.07); g.strokeStyle = 'rgba(255,214,64,0.85)';
    g.beginPath(); g.arc(x, y, r * ts, 0, Math.PI * 2); g.stroke();
    g.setLineDash([]); g.fillStyle = 'rgba(255,214,64,0.07)'; g.fill();
    g.restore();
  }
}


/** 동물 몸빛 (위에서 본 몸통·머리) */
const ANI_LOOK: Record<Animal['kind'], { body: string; head: string; len: number; wid: number }> = {
  boar: { body: '#5a4632', head: '#3f3123', len: 0.42, wid: 0.22 },
  dog: { body: '#b08a5a', head: '#8c6a40', len: 0.34, wid: 0.15 },
  cow: { body: '#ece6dc', head: '#d8d0c4', len: 0.5, wid: 0.26 },
  pig: { body: '#e7a8a0', head: '#d99189', len: 0.36, wid: 0.2 },
};
/**
 * (N8 §4.3 — 단계 5) 동물 그림: 위에서 본 몸통과 머리, 걸음에 맞춰 다리가 움직인다. 마취되면 옆으로 누운 자세(다리 뻗음), 잡히면 그물(격자).
 * 마취 화살은 그리지 않는다(사람을 겨누는 그림과 헷갈리지 않게). 나간 동물은 그리지 않고, AI 시점에서는 숨은 개를 그리지 않는다. 읽기만 한다 — 결과 불변
 */
export function drawAnimals(g: G, s: Scene, ts: number, alpha: number, time: number, truth: boolean, mini: boolean): void {
  const list = s.animals;
  if (!list || !list.length) return;
  for (const a of list) {
    if (a.state === 'gone' || (a.state === 'hide' && !truth)) continue;
    const x = (a.px + (a.x - a.px) * alpha + 0.5) * ts, y = (a.py + (a.y - a.py) * alpha + 0.5) * ts;
    const lk = ANI_LOOK[a.kind];
    if (mini) { g.fillStyle = lk.body; g.fillRect(x - ts * 0.25, y - ts * 0.2, ts * 0.5, ts * 0.4); continue; }
    const moving = Math.abs(a.x - a.px) + Math.abs(a.y - a.py) > 0.001;
    const down = a.state === 'sedated' || a.state === 'caught';
    g.save();
    g.translate(x, y); g.scale(ts, ts); g.rotate(a.facing);
    oval(g, 0.03, 0.05, lk.len + 0.06, lk.wid + 0.05, 'rgba(0,0,0,0.25)');
    const step = moving && !down ? Math.sin(time * 12 + a.id) * 0.07 : 0;
    // 다리 넷: 앞뒤 × 좌우. 걸으면 대각선 짝이 엇갈려 움직이고, 누우면 한쪽으로 뻗는다
    for (const fx of [0.6, -0.6]) for (const side of [-1, 1]) {
      const bx = fx * lk.len, sw = (fx > 0 ? 1 : -1) * side * step;
      if (down) { if (side > 0) seg(g, bx, lk.wid * 0.6, bx + 0.05, lk.wid + 0.2, 0.05, lk.head); continue; }
      seg(g, bx, side * lk.wid * 0.7, bx + sw, side * (lk.wid + 0.09), 0.05, lk.head);
    }
    oval(g, 0, 0, lk.len, down ? lk.wid * 1.1 : lk.wid, lk.body);
    if (a.kind === 'cow') { disc(g, -0.12, -0.06, 0.08, '#3b332b'); disc(g, 0.14, 0.08, 0.06, '#3b332b'); }
    if (a.kind === 'boar') seg(g, -lk.len * 0.8, 0, lk.len * 0.5, 0, 0.05, '#2c2219');      // 등 갈기
    oval(g, lk.len + 0.08, 0, 0.13, lk.wid * 0.7, lk.head);
    if (a.kind === 'pig' || a.kind === 'boar') disc(g, lk.len + 0.19, 0, 0.05, a.kind === 'pig' ? '#c97b74' : '#2c2219');
    if (a.kind === 'cow' || a.kind === 'boar') { seg(g, lk.len + 0.12, -0.08, lk.len + 0.16, -0.16, 0.025, a.kind === 'boar' ? '#e8e0cc' : '#cfc7b4'); seg(g, lk.len + 0.12, 0.08, lk.len + 0.16, 0.16, 0.025, a.kind === 'boar' ? '#e8e0cc' : '#cfc7b4'); }
    if (a.state === 'charge') { g.strokeStyle = 'rgba(255,90,60,0.7)'; g.lineWidth = 0.04; g.beginPath(); g.arc(0, 0, lk.len + 0.18, -0.6, 0.6); g.stroke(); }
    if (a.state === 'caught') {
      g.strokeStyle = 'rgba(230,230,210,0.85)'; g.lineWidth = 0.025;
      for (let k = -3; k <= 3; k++) { g.beginPath(); g.moveTo(k * 0.12 - 0.2, -0.3); g.lineTo(k * 0.12 + 0.2, 0.3); g.stroke(); g.beginPath(); g.moveTo(k * 0.12 + 0.2, -0.3); g.lineTo(k * 0.12 - 0.2, 0.3); g.stroke(); }
    }
    g.restore();
  }
}
