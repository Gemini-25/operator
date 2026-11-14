// 재난 (docs/specs/N6-disaster.md) 의 세계 규칙. 진실을 읽고 바꾼다 (hazards.ts 와 같은 자격).
// registerRule((sim, s, I) => { ... }) 로 등록한다. 자기 현장이 아니면 첫 줄에서 돌아간다.

import type { Sim } from '../../engine';
import { raiseProblem } from '../../events';
import { T } from '../../types';
import type { Incident, Scene } from '../../types';
import { staticPass, tidx } from '../grid';
import { pushFx } from '../hazards';
import { registerRule } from '../sceneRegistry';

/**
 * 해일이 해안 대피 현장을 덮친다 (현장마다 한 번).
 * 뭍의 물가 쪽 절반이 물에 잠기고, 그때까지 그 자리에 남아 있던 사람은 물에 휩쓸린다(물가에서 줄을 던져 끌어내야 한다).
 * 그 자리에 있던 대원은 뭍 쪽으로 떠밀려 올라오며 다친다. 대피를 먼저 끝낸 현장(사건이 닫힌 현장)에는 아무 일도 없다.
 */
registerRule((sim, s, I) => {
  const d = sim.disaster;
  if (!d || d.kind !== 'tsunami' || d.phase !== 'impact' || s.kind !== 'water' || s.variant !== 'evac' || I.phase === 'closed') return;
  if (!d.hit) d.hit = [];
  if (d.hit.indexOf(I.id) >= 0) return;
  d.hit.push(I.id);
  d.swept = (d.swept ?? 0) + swamp(sim, s, I);
});

/**
 * 산불 현장의 바람 (1초에 한 번, 건물 화재의 번짐에 더해진다).
 * 불씨가 날려 대각선 쪽 나무와 풀로도 옮겨붙고, 탈 것이 없는 한 칸(숲길)쯤은 건너뛴다.
 * 바람은 불이 난 가장자리에서 오두막과 길 쪽으로 분다: 그쪽으로는 빨리, 반대쪽으로는 더디게 번진다.
 */
const WIND = [1, 0, -1, 0, 0, 1, 0, -1, 1, 1, 1, -1, -1, 1, -1, -1];
registerRule((sim, s) => {
  if (s.kind !== 'fire' || s.variant !== 'wild' || s.burning <= 0 || (sim.tick + s.id) % 5 !== 0) return;
  const w = s.w, h = s.h, k = sim.tune.fireSpreadMul;
  const open = (i: number): boolean => s.tiles[i] === T.TREE || s.tiles[i] === T.GROUND;
  const toward = (x: number, y: number): number => Math.hypot(x - s.safe.x, y - s.safe.y);
  const heat = (j: number, v: number): void => { s.heat[j] += v * (1 - s.wet[j]); if (s.heat[j] >= 1) { s.fire[j] = 0.15; s.heat[j] = 0; } };
  for (let i = 0; i < w * h; i++) {
    const f = s.fire[i];
    if (f < 0.35 || !open(i)) continue;
    const x = i % w, y = (i / w) | 0, d0 = toward(x, y);
    for (let q = 0; q < 8; q++) {
      const nx = x + WIND[q * 2], ny = y + WIND[q * 2 + 1];
      if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
      const j = ny * w + nx, down = toward(nx, ny) < d0;
      if (open(j) && s.fuel[j] > 0 && s.fire[j] <= 0) { heat(j, (q < 4 ? 0.05 : 0.035) * k * f * (down ? 1.5 : 0.5)); continue; }
      // 탈 것이 없는 한 칸 너머 (바람이 부는 쪽으로만)
      if (q >= 4 || !down || s.fuel[j] > 0 || s.tiles[j] === T.WALL || s.tiles[j] === T.WINDOW) continue;
      const fx = nx + WIND[q * 2], fy = ny + WIND[q * 2 + 1];
      if (fx < 0 || fy < 0 || fx >= w || fy >= h) continue;
      const j2 = fy * w + fx;
      if (open(j2) && s.fuel[j2] > 0 && s.fire[j2] <= 0) heat(j2, 0.02 * k * f);
    }
  }
});

function swamp(sim: Sim, s: Scene, I: Incident): number {
  const rng = s.rng;
  // 뭍의 줄: 길(위쪽) 아래부터 바다(아래쪽) 위까지. 그 가운데부터 아래가 잠긴다
  let top = 0; while (top < s.h && s.tiles[tidx(s, 0, top)] === T.ROAD) top++;
  let sea = s.h; for (let y = top; y < s.h; y++) if (s.tiles[tidx(s, 0, y)] === T.WATER) { sea = y; break; }
  const half = Math.ceil((top + sea) / 2);
  for (let y = half; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const i = tidx(s, x, y);
    if (s.tiles[i] === T.WATER || s.propAt[i] >= 0) continue;
    s.tiles[i] = T.WATER; s.decor[i] = 0; s.fuel[i] = 0; s.fire[i] = 0;
  }
  s.staticVersion++;
  for (const r of s.regions) if (r.searchable && !r.tiles.some((i) => staticPass(s.tiles[i]))) r.searchable = false;      // 통째로 잠긴 구역은 더 살필 수 없다
  const dry = (x: number): { x: number; y: number } => {
    for (let y = half - 1; y >= top; y--) for (const dx of [0, 1, -1, 2, -2, 3, -3]) { const xx = Math.max(0, Math.min(s.w - 1, x + dx)); const i = tidx(s, xx, y); if (staticPass(s.tiles[i]) && s.propAt[i] < 0) return { x: xx, y }; }
    return { x: s.safe.x, y: s.safe.y };
  };
  let swept = 0;
  for (const c of s.casualties) {
    if (c.dead || c.where !== 'scene' || Math.round(c.y) < half) continue;
    swept++;
    c.inWater = true; c.mob = 'trapped'; c.trapWork = 0; c.walking = false; c.path = null; c.inVehicle = null;
    c.health = Math.max(8, c.health - rng.range(25, 45));
    c.bleed = Math.max(c.bleed, rng.range(0.13, 0.2) * sim.tune.bleedMul); c.bleed0 = c.bleed;
    c.drift = 0.1;
    // 밀려든 물에 뭍 쪽으로 떠밀린다: 새 물가에서 줄이 닿는 곳 (동쪽 끝에 있던 사람도 곧바로 떠내려가지는 않게 안쪽으로 당긴다)
    c.x = Math.max(1, Math.min(s.w - 10, Math.round(c.x))); c.y = Math.min(s.h - 1, half + rng.int(0, 2)); c.px = c.x; c.py = c.y;
  }
  const ev = raiseProblem(sim, I, 'ESCALATION', '해일이 덮침', {
    role: 'SYSTEM', actor: '현장', imp: 3, truth: s.arrivedAt < 0,
    text: swept ? `해일이 덮쳤습니다! 물가 쪽이 물에 잠기고, 아직 남아 있던 ${swept}명이 물에 휩쓸렸습니다.` : '해일이 덮쳤습니다! 물가 쪽이 물에 잠겼습니다. 남아 있던 사람은 없습니다.',
  }, false);
  for (const c of s.casualties) if (c.inWater && !c.dead && c.causeEvent < 0) c.causeEvent = ev;
  for (const a of s.agents) {
    if (a.status === 'left') continue;
    a.path = null; a.pathGoal = -1;      // 지형이 바뀌었다: 길을 다시 찾는다
    if (Math.round(a.y) < half) continue;
    const p = dry(Math.round(a.x));
    a.x = p.x; a.y = p.y; a.px = p.x; a.py = p.y;
    sim.responders[a.rid].health -= rng.range(10, 22);
    a.lastBlockEvent = ev;
  }
  pushFx(sim, s, 'text', s.w / 2, half - 1.2, undefined, undefined, '해일!', '#9fd8ff', 3);
  return swept;
}
