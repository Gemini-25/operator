// 현장 확대 화면 렌더러 (Canvas 2D).
// 대원·구조 대상·용의자·화재·연기·장애물이 실제 시뮬레이션 상태 그대로 그려진다.
// "관찰자 시점"에서는 AI 가 아직 모르는 진실(미발견 구조 대상, 숨은 위험)도 흐리게 보여 준다.

import type { Sim } from '../sim/engine';
import { visionOf } from '../sim/field/agents';
import { HOSTILE_FOV } from '../sim/field/hazards';
import { T } from '../sim/types';
import type { FieldAgent, Scene } from '../sim/types';
import { drawVehicle } from './icons';
import { DEPT_COLOR, FONT } from './renderCity';

export interface SceneOpts { truth: boolean; alpha: number; timeMs: number; selectedRid: number; mini?: boolean }
let MINI = false;      // 작은 창으로 그리는 중이면 글자 라벨을 생략한다
export interface Layout { ts: number; ox: number; oy: number }

export function sceneLayout(s: Scene, w: number, h: number): Layout {
  const ts = Math.max(6, Math.floor(Math.min(w / (s.w + 0.6), h / (s.h + 0.6))));
  return { ts, ox: Math.floor((w - ts * s.w) / 2), oy: Math.floor((h - ts * s.h) / 2) };
}

const BAND_COLOR = ['#5ad17a', '#ffd166', '#ff5d5d', '#59626d'];
const cache = new Map<number, { c: HTMLCanvasElement; ver: number; ts: number; key: Scene }>();
let glow: HTMLCanvasElement | null = null, glowCore: HTMLCanvasElement | null = null, smokeSpr: HTMLCanvasElement | null = null;
let dark: HTMLCanvasElement | null = null;

function sprite(stops: [number, string][]): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = c.height = 64;
  const g = c.getContext('2d')!;
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  for (const [p, col] of stops) gr.addColorStop(p, col);
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  return c;
}

function hash2(x: number, y: number): number { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

function buildStatic(s: Scene, ts: number): HTMLCanvasElement {
  const c = document.createElement('canvas'); c.width = s.w * ts; c.height = s.h * ts;
  const g = c.getContext('2d')!;
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    const t = s.tiles[y * s.w + x];
    const px = x * ts, py = y * ts, r = hash2(x, y);
    const base = t === T.ROAD ? '#222b35' : t === T.FLOOR || t === T.DOOR ? '#1d2935' : t === T.WATER ? '#143f60' : t === T.TRAIL ? '#2a2a24' : (x + y) % 2 ? '#141e27' : '#15202a';
    g.fillStyle = base; g.fillRect(px, py, ts, ts);
    if (t === T.FLOOR || t === T.DOOR) { g.strokeStyle = 'rgba(255,255,255,0.035)'; g.lineWidth = 1; g.strokeRect(px + 0.5, py + 0.5, ts - 1, ts - 1); }
    else if (t === T.WALL) {
      g.fillStyle = '#566575'; g.fillRect(px, py, ts, ts);
      g.fillStyle = '#6c7d8f'; g.fillRect(px, py, ts, Math.max(2, ts * 0.22));
      g.fillStyle = 'rgba(0,0,0,0.22)'; g.fillRect(px, py + ts - 2, ts, 2);
    } else if (t === T.WINDOW) {
      g.fillStyle = '#566575'; g.fillRect(px, py, ts, ts);
      g.fillStyle = '#7fd6ee'; g.globalAlpha = 0.55; g.fillRect(px + 2, py + ts * 0.3, ts - 4, ts * 0.4); g.globalAlpha = 1;
    } else if (t === T.TREE) {
      for (let k = 0; k < 3; k++) {
        const rx = px + ts * (0.25 + 0.5 * hash2(x * 3 + k, y)), ry = py + ts * (0.25 + 0.5 * hash2(x, y * 3 + k));
        g.fillStyle = k === 0 ? '#1f4d36' : k === 1 ? '#27603f' : '#2f7049';
        g.beginPath(); g.arc(rx, ry, ts * (0.3 + 0.12 * r), 0, 7); g.fill();
      }
    } else if (t === T.WATER) {
      g.strokeStyle = 'rgba(140,200,240,0.25)'; g.lineWidth = 1.2;
      g.beginPath(); g.moveTo(px + ts * 0.15, py + ts * (0.3 + 0.3 * r)); g.quadraticCurveTo(px + ts * 0.5, py + ts * (0.1 + 0.3 * r), px + ts * 0.85, py + ts * (0.3 + 0.3 * r)); g.stroke();
    } else if (t === T.ROCK) {
      g.fillStyle = '#4a545f'; g.beginPath(); g.ellipse(px + ts / 2, py + ts / 2, ts * 0.42, ts * 0.34, r * 3, 0, 7); g.fill();
      g.fillStyle = '#5e6a76'; g.beginPath(); g.ellipse(px + ts * 0.42, py + ts * 0.42, ts * 0.2, ts * 0.15, r * 3, 0, 7); g.fill();
    } else if (t === T.GROUND && r > 0.86) { g.fillStyle = 'rgba(90,140,110,0.18)'; g.fillRect(px + ts * 0.3, py + ts * 0.4, 2, 2); }
  }
  // 벽 그림자 (오른쪽·아래로 드리운다)
  const solid = (x: number, y: number): boolean => { if (x < 0 || y < 0 || x >= s.w || y >= s.h) return false; const t = s.tiles[y * s.w + x]; return t === T.WALL || t === T.WINDOW; };
  g.fillStyle = 'rgba(0,0,0,0.3)';
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) {
    if (!solid(x, y)) continue;
    if (!solid(x + 1, y)) g.fillRect((x + 1) * ts, y * ts + ts * 0.22, ts * 0.2, ts * (solid(x + 1, y + 1) ? 0.78 : 1));
    if (!solid(x, y + 1)) g.fillRect(x * ts + ts * 0.2, (y + 1) * ts, ts * (solid(x + 1, y + 1) ? 0.8 : 1), ts * 0.24);
  }
  // 차선
  if (s.kind === 'traffic') {
    g.strokeStyle = 'rgba(240,240,220,0.4)'; g.lineWidth = 2; g.setLineDash([ts * 0.6, ts * 0.6]);
    for (const yy of [9, 11]) { g.beginPath(); g.moveTo(0, yy * ts); g.lineTo(s.w * ts, yy * ts); g.stroke(); }
    g.setLineDash([]); g.strokeStyle = 'rgba(255,205,90,0.6)'; g.beginPath(); g.moveTo(0, 10 * ts); g.lineTo(s.w * ts, 10 * ts); g.stroke();
    g.strokeStyle = 'rgba(240,240,220,0.5)'; g.beginPath(); g.moveTo(0, 8 * ts); g.lineTo(s.w * ts, 8 * ts); g.moveTo(0, 12 * ts); g.lineTo(s.w * ts, 12 * ts); g.stroke();
  }
  // 구역 이름
  g.textAlign = 'center'; g.textBaseline = 'middle';
  for (const r of s.regions) {
    if (r.kind === 'wreck') continue;
    g.fillStyle = r.kind === 'zone' ? 'rgba(200,220,235,0.2)' : 'rgba(200,220,235,0.3)';
    g.font = `600 ${Math.round(ts * (r.kind === 'zone' ? 0.6 : 0.42))}px ${FONT}`;
    g.fillText(r.name, (r.cx + 0.5) * ts, (r.cy + 0.5) * ts - (r.kind === 'room' ? ts * 0.1 : 0));
    if (r.kind === 'zone') { g.strokeStyle = 'rgba(160,190,210,0.1)'; g.lineWidth = 1; g.setLineDash([4, 6]); g.strokeRect(r.x0 * ts, r.y0 * ts, (r.x1 - r.x0 + 1) * ts, (r.y1 - r.y0 + 1) * ts); g.setLineDash([]); }
  }
  // 대기 지점 / 안전 구역
  const zone = (x: number, y: number, col: string, label: string) => {
    g.strokeStyle = col; g.lineWidth = 1.5; g.setLineDash([5, 4]);
    g.strokeRect((x - 1) * ts + 2, (y - 0.6) * ts + 2, ts * 3 - 4, ts * 2.2 - 4); g.setLineDash([]);
    g.fillStyle = col; g.font = `600 ${Math.round(ts * 0.34)}px ${FONT}`; g.textBaseline = 'bottom';
    g.fillText(label, (x + 0.5) * ts, (y - 0.6) * ts);
  };
  zone(s.safe.x, s.safe.y, 'rgba(90,209,122,0.55)', '안전 구역');
  zone(s.staging.x, s.staging.y, 'rgba(124,196,255,0.5)', '차량 대기');
  return c;
}

function pill(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fs: number, fg: string, bg = 'rgba(8,13,18,0.82)'): void {
  if (MINI) return;
  ctx.font = `600 ${fs}px ${FONT}`;
  const w = ctx.measureText(text).width + fs * 0.7;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x - w / 2, y - fs * 0.75, w, fs * 1.4, fs * 0.4); ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y);
}

const ipos = (o: { x: number; y: number; px: number; py: number }, a: number): { x: number; y: number } => ({ x: o.px + (o.x - o.px) * a, y: o.py + (o.y - o.py) * a });

export function drawScene(ctx: CanvasRenderingContext2D, sim: Sim, s: Scene, w: number, h: number, o: SceneOpts): void {
  const L = sceneLayout(s, w, h);
  const ts = L.ts;
  MINI = !!o.mini;
  if (!glow) { glow = sprite([[0, 'rgba(255,170,60,0.95)'], [0.45, 'rgba(255,90,30,0.55)'], [1, 'rgba(255,60,20,0)']]); glowCore = sprite([[0, 'rgba(255,250,210,0.95)'], [0.5, 'rgba(255,200,90,0.5)'], [1, 'rgba(255,180,60,0)']]); smokeSpr = sprite([[0, 'rgba(165,170,178,0.9)'], [0.6, 'rgba(150,155,162,0.45)'], [1, 'rgba(140,145,150,0)']]); }
  let st = cache.get(s.id);
  if (!st || st.ver !== s.staticVersion || st.ts !== ts || st.key !== s) { st = { c: buildStatic(s, ts), ver: s.staticVersion, ts, key: s }; cache.set(s.id, st); if (cache.size > 12) cache.delete(cache.keys().next().value!); }
  ctx.save();
  ctx.fillStyle = '#070b10'; ctx.fillRect(0, 0, w, h);
  ctx.translate(L.ox, L.oy);
  ctx.drawImage(st.c, 0, 0);
  const time = o.timeMs / 1000;
  const cx = (x: number) => (x + 0.5) * ts, cy = (y: number) => (y + 0.5) * ts;
  const cmd = s.agents.find((a) => a.isCommander);
  const I = sim.incidents[s.incidentId];

  // 지휘관의 판단 오버레이: 수색 확률 / 수색 확인율
  if (cmd) {
    for (const r of s.regions) {
      if (!r.searchable) continue;
      const conf = cmd.beliefs.val<number>('srch', r.id);
      if (s.kind === 'search' && s.zoneProb[r.id] > 0 && conf === undefined) { ctx.fillStyle = `rgba(79,209,197,${Math.min(0.26, s.zoneProb[r.id] * 0.55)})`; ctx.fillRect(r.x0 * ts, r.y0 * ts, (r.x1 - r.x0 + 1) * ts, (r.y1 - r.y0 + 1) * ts); }
      if (conf !== undefined && r.kind !== 'wreck' && !MINI) {
        ctx.font = `600 ${Math.round(ts * 0.32)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
        ctx.fillStyle = conf >= 0.72 ? 'rgba(90,209,122,0.8)' : 'rgba(255,180,84,0.85)';
        ctx.fillText(`수색 ${Math.round(conf * 100)}%`, cx(r.cx), cy(r.cy) + ts * (r.kind === 'zone' ? 0.75 : 0.42));
      }
    }
  }
  // 무전 음영 구역 (관찰자 시점)
  if (o.truth) {
    ctx.strokeStyle = 'rgba(185,140,255,0.22)'; ctx.lineWidth = 1;
    for (let i = 0; i < s.shadow.length; i++) if (s.shadow[i]) { const x = (i % s.w) * ts, y = ((i / s.w) | 0) * ts; ctx.beginPath(); ctx.moveTo(x, y + ts); ctx.lineTo(x + ts, y); ctx.stroke(); }
  }
  // 소실 / 젖은 바닥
  for (let i = 0; i < s.burned.length; i++) {
    if (s.burned[i]) { ctx.fillStyle = 'rgba(5,5,6,0.62)'; ctx.fillRect((i % s.w) * ts, ((i / s.w) | 0) * ts, ts, ts); }
    else if (s.wet[i] > 0.25) { ctx.fillStyle = `rgba(90,160,220,${Math.min(0.22, s.wet[i] * 0.22)})`; ctx.fillRect((i % s.w) * ts, ((i / s.w) | 0) * ts, ts, ts); }
  }
  // 통제 지점
  s.controlPts.forEach((p, k) => {
    const done = s.controlDone[k];
    ctx.globalAlpha = done ? 1 : 0.35;
    for (let q = -1; q <= 2; q++) { ctx.fillStyle = '#ff9f43'; ctx.beginPath(); const x = cx(p.x), y = cy(8 + q + 0.5); ctx.moveTo(x, y - ts * 0.25); ctx.lineTo(x + ts * 0.18, y + ts * 0.2); ctx.lineTo(x - ts * 0.18, y + ts * 0.2); ctx.closePath(); ctx.fill(); }
    ctx.globalAlpha = 1;
    if (done) pill(ctx, '통제', cx(p.x), cy(7) - ts * 0.3, ts * 0.32, '#ffb454');
  });
  // 소품
  for (const p of s.props) {
    if (p.removed) continue;
    const x = p.x * ts, y = p.y * ts;
    if (p.kind === 'door') {
      const vertical = s.tiles[p.y * s.w + p.x - 1] !== T.WALL && s.tiles[p.y * s.w + p.x + 1] !== T.WALL ? true : false;
      ctx.fillStyle = p.locked ? (o.truth || (cmd && cmd.beliefs.get('blk', p.y * s.w + p.x)) ? '#ff5d5d' : '#b08a5a') : p.open ? 'rgba(176,138,90,0.35)' : '#b08a5a';
      if (vertical) ctx.fillRect(x + ts * 0.38, y + 1, ts * 0.24, ts - 2); else ctx.fillRect(x + 1, y + ts * 0.38, ts - 2, ts * 0.24);
      if (p.blocking && p.hp > 0 && p.hp < 11) { /* 강제 개방 중 */ }
    } else if (p.kind === 'debris') {
      ctx.fillStyle = '#6e5a48';
      for (let k = 0; k < 5; k++) { const rx = x + ts * (0.2 + 0.6 * hash2(p.id * 7 + k, 1)), ry = y + ts * (0.2 + 0.6 * hash2(p.id * 7 + k, 2)); ctx.beginPath(); ctx.arc(rx, ry, ts * (0.14 + 0.1 * hash2(p.id, k)), 0, 7); ctx.fill(); }
      ctx.strokeStyle = '#3d3229'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(x + 3, y + ts - 4); ctx.lineTo(x + ts - 3, y + 4); ctx.stroke();
    } else if (p.kind === 'vehicle' || p.kind === 'cover') {
      const cols = ['#8fa3b8', '#c9b458', '#b86a5a', '#6aa58c', '#9a86c4'];
      ctx.save(); ctx.translate(x + (p.w * ts) / 2, y + ts / 2); ctx.rotate(p.angle ?? 0);
      ctx.fillStyle = p.cleared ? '#56606b' : cols[p.color ?? 0];
      ctx.beginPath(); ctx.roundRect(-(p.w * ts) / 2 + 2, -ts * 0.38, p.w * ts - 4, ts * 0.76, ts * 0.16); ctx.fill();
      ctx.fillStyle = 'rgba(10,16,22,0.55)'; ctx.fillRect(-ts * 0.25, -ts * 0.3, ts * 0.6, ts * 0.6);
      if (p.kind === 'vehicle' && !p.cleared) { ctx.strokeStyle = 'rgba(10,16,22,0.7)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-ts * 0.8, -ts * 0.3); ctx.lineTo(-ts * 0.55, 0); ctx.lineTo(-ts * 0.8, ts * 0.3); ctx.stroke(); }
      ctx.restore();
      if (p.leakRate && !p.mitigated && !p.ignited && (o.truth || (cmd && cmd.beliefs.get('haz', p.id)))) {
        const known = !!(cmd && cmd.beliefs.get('haz', p.id));
        ctx.globalAlpha = known ? 0.9 : 0.5;
        ctx.fillStyle = 'rgba(190,150,40,0.5)'; ctx.beginPath(); ctx.ellipse(x + ts, y + ts * 1.05, ts * (0.5 + 0.7 * (p.leak ?? 0)), ts * 0.28, 0, 0, 7); ctx.fill();
        pill(ctx, known ? `연료 누출 ${Math.round((p.leak ?? 0) * 100)}%` : `(미확인) 누출 ${Math.round((p.leak ?? 0) * 100)}%`, x + ts, y + ts * 1.6, ts * 0.3, '#ffd166');
        ctx.globalAlpha = 1;
      }
    } else if (p.kind === 'hydrant') {
      ctx.fillStyle = '#d9483b'; ctx.beginPath(); ctx.arc(cx(p.x), cy(p.y), ts * 0.24, 0, 7); ctx.fill();
      ctx.fillStyle = '#ffd6c9'; ctx.fillRect(cx(p.x) - ts * 0.08, cy(p.y) - ts * 0.08, ts * 0.16, ts * 0.16);
      pill(ctx, '소화전', cx(p.x), cy(p.y) + ts * 0.62, ts * 0.3, '#ffb4a8');
    } else if (p.kind === 'gas') {
      const known = !!(cmd && cmd.beliefs.get('haz', p.id));
      if (p.exploded || !(o.truth || known)) continue;
      ctx.globalAlpha = known ? 1 : 0.55;
      ctx.fillStyle = '#ffd166'; ctx.beginPath(); ctx.moveTo(cx(p.x), cy(p.y) - ts * 0.34); ctx.lineTo(cx(p.x) + ts * 0.34, cy(p.y)); ctx.lineTo(cx(p.x), cy(p.y) + ts * 0.34); ctx.lineTo(cx(p.x) - ts * 0.34, cy(p.y)); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#1a1205'; ctx.font = `800 ${Math.round(ts * 0.4)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('!', cx(p.x), cy(p.y) + 1);
      ctx.globalAlpha = 1;
    } else if (p.kind === 'clue') {
      if (!p.found && !o.truth) continue;
      ctx.globalAlpha = p.found ? 1 : 0.4; ctx.fillStyle = '#ffd166';
      ctx.beginPath(); ctx.ellipse(cx(p.x) - ts * 0.1, cy(p.y), ts * 0.09, ts * 0.15, 0.3, 0, 7); ctx.fill();
      ctx.beginPath(); ctx.ellipse(cx(p.x) + ts * 0.12, cy(p.y) - ts * 0.14, ts * 0.09, ts * 0.15, 0.3, 0, 7); ctx.fill();
      ctx.globalAlpha = 1;
    } else if (p.kind === 'witness') {
      ctx.fillStyle = p.interviewed ? '#7d8b99' : '#d6e2ee'; ctx.beginPath(); ctx.arc(cx(p.x), cy(p.y) - ts * 0.08, ts * 0.17, 0, 7); ctx.fill();
      ctx.fillRect(cx(p.x) - ts * 0.16, cy(p.y) + ts * 0.1, ts * 0.32, ts * 0.22);
      pill(ctx, '목격자', cx(p.x), cy(p.y) + ts * 0.7, ts * 0.28, '#c8d4df');
    } else if (p.kind === 'roadDebris') {
      ctx.fillStyle = '#8b97a3';
      for (let k = 0; k < 4; k++) ctx.fillRect(x + ts * (0.15 + 0.7 * hash2(p.id * 5 + k, 3)), y + ts * (0.15 + 0.7 * hash2(p.id * 5 + k, 4)), 3, 2);
    }
  }
  // 현장에 도착해 있는 출동 차량
  const parked = sim.units.filter((u) => u.incidentId === s.incidentId && u.state === 'onscene');
  const rowY = s.kind === 'search' ? s.staging.y - 1.7 : Math.min(s.h - 0.75, s.staging.y + 1.55);
  const lit: { x: number; y: number }[] = [];
  parked.forEach((u, k) => {
    const vx = cx(0.6 + k * 2.45), vy = cy(rowY);
    drawVehicle(ctx, vx, vy, ts * 2.1, ts * 0.95, u.dept, 0, true, o.timeMs);
    pill(ctx, u.callsign, vx, vy + ts * 0.85, ts * 0.3, DEPT_COLOR[u.dept]);
    lit.push({ x: vx, y: vy });
  });
  // 통과 차량
  for (const c of s.cars) {
    const x = (c.px + (c.x - c.px) * o.alpha + 0.5) * ts, y = cy(c.row);
    ctx.fillStyle = c.hit ? '#ff5d5d' : c.distracted && o.truth ? '#d9a35a' : '#aebbc7';
    ctx.beginPath(); ctx.roundRect(x - ts * 0.75, y - ts * 0.3, ts * 1.5, ts * 0.6, ts * 0.14); ctx.fill();
    ctx.fillStyle = 'rgba(255,245,200,0.8)'; ctx.fillRect(x + c.dir * ts * 0.62 - 2, y - ts * 0.2, 4, ts * 0.4);
  }
  // 연기
  for (let i = 0; i < s.smoke.length; i++) {
    const v = s.smoke[i]; if (v < 0.06) continue;
    const x = i % s.w, y = (i / s.w) | 0;
    ctx.globalAlpha = Math.min(0.62, v * 0.55);
    const d = ts * (1.7 + 0.25 * Math.sin(time * 0.9 + i));
    ctx.drawImage(smokeSpr!, cx(x) - d / 2 + Math.sin(time * 0.5 + i * 1.7) * ts * 0.08, cy(y) - d / 2, d, d);
  }
  ctx.globalAlpha = 1;
  // 화재
  ctx.globalCompositeOperation = 'lighter';
  for (let i = 0; i < s.fire.length; i++) {
    const f = s.fire[i]; if (f < 0.03) continue;
    const x = i % s.w, y = (i / s.w) | 0;
    const fl = 0.82 + 0.18 * Math.sin(time * 9 + i * 2.3) + 0.08 * Math.sin(time * 17 + i);
    const d = ts * (1.1 + 1.0 * f) * fl;
    ctx.globalAlpha = Math.min(1, 0.45 + f * 0.6);
    ctx.drawImage(glow!, cx(x) - d / 2, cy(y) - d / 2, d, d);
    if (f > 0.35) { const d2 = ts * (0.4 + 0.5 * f) * fl; ctx.globalAlpha = f; ctx.drawImage(glowCore!, cx(x) - d2 / 2, cy(y) - d2 / 2 - ts * 0.08, d2, d2); }
    if (f > 0.45) {
      // 불티
      for (let k = 0; k < 2; k++) {
        const ph = (time * (0.55 + 0.3 * hash2(i, k)) + hash2(k, i)) % 1;
        ctx.globalAlpha = (1 - ph) * 0.9; ctx.fillStyle = k ? '#ffd27a' : '#ff9a4a';
        ctx.fillRect(cx(x) + (hash2(i * 3, k) - 0.5) * ts * 0.9 + Math.sin(time * 3 + i + k) * ts * 0.12, cy(y) - ph * ts * 1.9, 2, 2);
      }
    }
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;

  // 구조 대상
  for (const c of s.casualties) {
    if (c.where === 'loaded' || c.where === 'hospital') continue;
    const known = c.tDiscovered >= 0;
    if (!known && !o.truth) continue;
    const p = ipos(c, o.alpha);
    const x = cx(p.x), y = cy(p.y), r = ts * 0.26;
    const b = c.dead ? 3 : c.health > 70 ? 0 : c.health > 40 ? 1 : 2;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(x + 2, y + r * 0.9, r * 0.95, r * 0.4, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = known ? 1 : 0.5;
    if (b === 2 && !c.dead) { ctx.strokeStyle = 'rgba(255,93,93,0.5)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 3 + 3 * Math.abs(Math.sin(time * 4)), 0, 7); ctx.stroke(); }
    ctx.fillStyle = BAND_COLOR[b]; ctx.strokeStyle = '#0b1219'; ctx.lineWidth = 2;
    if (!known) ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.roundRect(x - r, y - r, r * 2, r * 2, r * 0.45); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#0b1219'; ctx.font = `800 ${Math.round(ts * 0.34)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(known ? c.label : '?', x, y + 1);
    if (c.mob === 'trapped') { ctx.strokeStyle = '#e8f0f7'; ctx.lineWidth = 2; ctx.strokeRect(x - r - 3, y - r - 3, r * 2 + 6, r * 2 + 6); }
    if (c.treated && !c.dead) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + r - 3, y - r - 4, 6, 2); ctx.fillRect(x + r - 1, y - r - 6, 2, 6); }
    if (!c.dead && (c.where === 'scene' || c.where === 'safe')) {
      // 상태 막대
      ctx.fillStyle = 'rgba(8,13,18,0.8)'; ctx.fillRect(x - r, y + r + 2, r * 2, 3);
      ctx.fillStyle = BAND_COLOR[b]; ctx.fillRect(x - r, y + r + 2, r * 2 * Math.max(0, c.health / 100), 3);
    }
    ctx.globalAlpha = 1;
  }
  // 용의자
  for (const hst of s.hostiles) {
    if (hst.state === 'escaped') continue;
    if (hst.hidden && !o.truth) continue;
    const p = ipos(hst, o.alpha);
    const x = cx(p.x), y = cy(p.y), r = ts * 0.33;
    const col = hst.state === 'fight' ? '#ff3355' : hst.state === 'flee' ? '#ff9f43' : hst.state === 'surrendered' ? '#ffd166' : hst.state === 'arrested' ? '#7d8b99' : hst.state === 'down' ? '#454d57' : '#e0486b';
    const stunned = sim.t < hst.stunUntil;
    if ((hst.state === 'hold' || hst.state === 'fight') && !stunned && !MINI) {
      // 시야: 평소에는 바라보는 방향의 부채꼴, 경계 중에는 사방
      const alert = sim.t < hst.alertUntil;
      ctx.fillStyle = alert ? 'rgba(255,90,90,0.07)' : 'rgba(255,200,90,0.09)';
      ctx.strokeStyle = alert ? 'rgba(255,90,90,0.3)' : 'rgba(255,200,90,0.35)'; ctx.lineWidth = 1;
      ctx.beginPath();
      if (alert) ctx.arc(x, y, ts * 6, 0, 7);
      else { ctx.moveTo(x, y); ctx.arc(x, y, ts * 7, hst.facing - HOSTILE_FOV, hst.facing + HOSTILE_FOV); ctx.closePath(); }
      ctx.fill(); ctx.stroke();
    }
    if (hst.hostageId >= 0 && (hst.state === 'hold' || hst.state === 'fight')) {
      const hc = s.casualties[hst.hostageId];
      ctx.strokeStyle = 'rgba(255,93,93,0.8)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx(hc.x), cy(hc.y)); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.globalAlpha = hst.hidden ? 0.45 : 1;
    if (stunned) { for (let k = 0; k < 3; k++) { const an = time * 5 + k * 2.1; ctx.fillStyle = '#fff3b0'; ctx.fillRect(x + Math.cos(an) * r * 1.2 - 1.5, y - r * 1.1 + Math.sin(an) * r * 0.4 - 1.5, 3, 3); } }
    if (hst.state === 'fight') { ctx.strokeStyle = 'rgba(255,51,85,0.55)'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, r + 4 + 3 * Math.abs(Math.sin(time * 6)), 0, 7); ctx.stroke(); }
    ctx.fillStyle = col; ctx.strokeStyle = '#0b1219'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y + r * 0.8); ctx.lineTo(x - r, y + r * 0.8); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#0b1219'; ctx.font = `800 ${Math.round(ts * 0.3)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(hst.weapon === 'gun' ? '총' : hst.weapon === 'knife' ? '칼' : '·', x, y + r * 0.2);
    const stt = stunned ? '무력화' : hst.hidden ? '(숨음)' : hst.state === 'hold' ? (hst.hostageId >= 0 ? '인질 대치' : '대치') : hst.state === 'fight' ? '교전' : hst.state === 'flee' ? '도주' : hst.state === 'surrendered' ? '투항' : hst.state === 'arrested' ? '검거' : '제압';
    pill(ctx, `${hst.label} · ${stt}`, x, y - r - ts * 0.3, ts * 0.28, col);
    if (hst.state === 'hold' || hst.state === 'fight') { ctx.fillStyle = 'rgba(8,13,18,0.8)'; ctx.fillRect(x - r, y + r + 2, r * 2, 3); ctx.fillStyle = '#ffb454'; ctx.fillRect(x - r, y + r + 2, r * 2 * Math.max(0, Math.min(1, hst.morale)), 3); }
    ctx.globalAlpha = 1;
  }
  // 대원
  const labels: { x: number; y: number; text: string; col: string }[] = [];
  for (const a of s.agents) {
    if (a.status === 'left') continue;
    const p = ipos(a, o.alpha);
    const moving = Math.abs(a.x - a.px) + Math.abs(a.y - a.py) > 0.01 && a.status === 'active';
    const stepPh = time * 11 + a.rid;
    const x = cx(p.x), y = cy(p.y) + (moving ? Math.sin(stepPh * 2) * ts * 0.025 : 0), r = ts * 0.34;
    const rsp = sim.responders[a.rid];
    if (moving && !MINI) {
      // 발걸음: 진행 방향의 좌우로 번갈아 디딘다
      const fl0 = Math.hypot(a.fx, a.fy) || 1, nx = -a.fy / fl0, ny = a.fx / fl0, sw = Math.sin(stepPh);
      ctx.fillStyle = 'rgba(10,16,22,0.75)';
      for (const side of [-1, 1]) { const off = side * sw * ts * 0.14; ctx.beginPath(); ctx.ellipse(x + nx * side * r * 0.45 + (a.fx / fl0) * off, y + ny * side * r * 0.45 + (a.fy / fl0) * off + r * 0.55, r * 0.26, r * 0.17, 0, 0, 7); ctx.fill(); }
    }
    if (a.carrying >= 0 && !MINI) {
      // 들것: 옮기는 대원과 구조 대상을 잇는다
      const cc = s.casualties[a.carrying], cp = ipos(cc, o.alpha);
      ctx.strokeStyle = 'rgba(232,240,247,0.7)'; ctx.lineWidth = Math.max(2, ts * 0.1);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx(cp.x), cy(cp.y)); ctx.stroke();
    }
    if (!moving && a.ring > 0.01 && a.status === 'active' && !MINI) {
      // 작업 중: 손 쓰는 쪽에 작은 불티가 튄다
      const fl1 = Math.hypot(a.fx, a.fy) || 1;
      for (let k = 0; k < 3; k++) {
        const ph = (time * 2.2 + k / 3 + a.rid * 0.37) % 1;
        ctx.fillStyle = `rgba(255,236,170,${1 - ph})`;
        ctx.fillRect(x + (a.fx / fl1) * r * 1.25 + Math.cos(k * 2.1 + a.rid) * ph * ts * 0.3, y + (a.fy / fl1) * r * 1.25 + Math.sin(k * 2.1 + a.rid) * ph * ts * 0.3, 2, 2);
      }
    }
    const col = DEPT_COLOR[rsp.dept];
    if (a.rid === o.selectedRid && a.path && a.pathI < a.path.length) {
      ctx.strokeStyle = 'rgba(255,255,255,0.45)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = a.pathI; k < a.path.length; k++) ctx.lineTo(cx(a.path[k] % s.w), cy((a.path[k] / s.w) | 0));
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (a.rid === o.selectedRid && a.status === 'active') {
      // 선택한 대원의 인지 범위
      const vr = visionOf(sim, s, a) * ts;
      ctx.strokeStyle = 'rgba(255,255,255,0.28)'; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
      ctx.beginPath(); ctx.arc(x, y, vr, 0, 7); ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,255,255,0.035)'; ctx.beginPath(); ctx.arc(x, y, vr, 0, 7); ctx.fill();
    }
    ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.beginPath(); ctx.ellipse(x + 2, y + r * 0.85, r * 0.95, r * 0.42, 0, 0, 7); ctx.fill();
    ctx.globalAlpha = a.status === 'withdrawn' ? 0.6 : 1;
    if (a.status === 'down') {
      ctx.fillStyle = '#59626d'; ctx.strokeStyle = '#ff5d5d'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(x - r * 0.5, y - r * 0.5); ctx.lineTo(x + r * 0.5, y + r * 0.5); ctx.moveTo(x + r * 0.5, y - r * 0.5); ctx.lineTo(x - r * 0.5, y + r * 0.5); ctx.stroke();
    } else {
      if (sim.t - a.underFireT < 1.2) { ctx.fillStyle = 'rgba(255,80,80,0.35)'; ctx.beginPath(); ctx.arc(x, y, r + 6, 0, 7); ctx.fill(); }
      const fl = Math.hypot(a.fx, a.fy) || 1;
      ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x + (a.fx / fl) * (r + ts * 0.16), y + (a.fy / fl) * (r + ts * 0.16)); ctx.lineTo(x - (a.fy / fl) * r * 0.5, y + (a.fx / fl) * r * 0.5); ctx.lineTo(x + (a.fy / fl) * r * 0.5, y - (a.fx / fl) * r * 0.5); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = a.rid === o.selectedRid ? '#ffffff' : '#0b1219'; ctx.lineWidth = a.rid === o.selectedRid ? 3 : 2;
      ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke();
      if (a.isCommander) { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = 2; ctx.setLineDash([4, 3]); ctx.beginPath(); ctx.arc(x, y, r + 4, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
      if (a.inCover && s.kind === 'armed') { ctx.fillStyle = '#e8f0f7'; ctx.beginPath(); ctx.arc(x + r * 0.8, y + r * 0.8, ts * 0.09, 0, 7); ctx.fill(); }
      if (a.ring > 0.01) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, a.ring)); ctx.stroke(); }
    }
    ctx.fillStyle = '#0b1219'; ctx.font = `800 ${Math.round(ts * 0.36)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(rsp.name[0], x, y + 1);
    ctx.globalAlpha = 1;
    if (a.label) labels.push({ x, y: y - r - ts * 0.34, text: (a.isCommander ? '★ ' : '') + (a.label.length > 13 ? a.label.slice(0, 12) + '…' : a.label), col: a.status === 'down' ? '#ff5d5d' : col });
  }
  // 날씨와 야간 조명: 밤에는 대원의 시야(손전등), 불빛, 차량 주변만 밝다
  const fog = !o.truth && s.kind === 'armed' && s.agents.some((a) => a.status !== 'left');      // AI 시점: 대원이 지금 보고 있는 곳만 밝다
  if (sim.weather === 'night' && MINI) { ctx.fillStyle = 'rgba(3,6,18,0.3)'; ctx.fillRect(0, 0, s.w * ts, s.h * ts); }
  else if ((sim.weather === 'night' || fog) && !MINI) {
    if (!dark || dark.width !== s.w * ts || dark.height !== s.h * ts) { dark = document.createElement('canvas'); dark.width = s.w * ts; dark.height = s.h * ts; }
    const dg = dark.getContext('2d')!;
    dg.globalCompositeOperation = 'source-over'; dg.clearRect(0, 0, dark.width, dark.height);
    dg.fillStyle = sim.weather === 'night' ? 'rgba(3,6,18,0.6)' : 'rgba(6,10,16,0.55)'; dg.fillRect(0, 0, dark.width, dark.height);
    dg.globalCompositeOperation = 'destination-out';
    const hole = (x: number, y: number, r: number, k = 1) => { const gr = dg.createRadialGradient(x, y, r * 0.15, x, y, r); gr.addColorStop(0, `rgba(0,0,0,${k})`); gr.addColorStop(1, 'rgba(0,0,0,0)'); dg.fillStyle = gr; dg.beginPath(); dg.arc(x, y, r, 0, 7); dg.fill(); };
    for (const a of s.agents) { if (a.status === 'left') continue; const p = ipos(a, o.alpha); hole(cx(p.x), cy(p.y), visionOf(sim, s, a) * ts * 1.15 + ts); }
    for (const v of lit) hole(v.x, v.y, ts * 3.6);
    hole(cx(s.safe.x), cy(s.safe.y), ts * 3, 0.7);
    for (let i = 0; i < s.fire.length; i++) if (s.fire[i] > 0.2) hole(cx(i % s.w), cy((i / s.w) | 0), ts * (1.8 + 2.4 * s.fire[i]), 0.6);
    for (const c of s.cars) hole((c.x + 0.5 + c.dir * 2) * ts, cy(c.row), ts * 2.6, 0.7);
    ctx.drawImage(dark, 0, 0);
  } else if (sim.weather === 'fog') {
    ctx.fillStyle = 'rgba(188,198,208,0.13)'; ctx.fillRect(0, 0, s.w * ts, s.h * ts);
  } else if (sim.weather === 'rain') {
    ctx.strokeStyle = 'rgba(170,200,235,0.22)'; ctx.lineWidth = 1; ctx.beginPath();
    const W = s.w * ts, H = s.h * ts;
    for (let k = 0; k < 110; k++) { const x = (hash2(k, 1) * W + o.timeMs * 0.1) % W, y = (hash2(k, 2) * H + o.timeMs * 0.6 * (0.7 + hash2(k, 3) * 0.6)) % H; ctx.moveTo(x, y); ctx.lineTo(x + 3, y + 12); }
    ctx.stroke();
  }
  // 효과
  for (const f of s.fx) {
    const age = sim.t - f.t;
    if (age < 0 || age > f.ttl) continue;
    const k = age / f.ttl;
    if (f.kind === 'shot') {
      ctx.strokeStyle = f.color ?? '#ffe08a'; ctx.globalAlpha = 1 - k; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.moveTo(cx(f.x), cy(f.y)); ctx.lineTo(cx(f.x2!), cy(f.y2!)); ctx.stroke();
      ctx.fillStyle = '#fff6d0'; ctx.beginPath(); ctx.arc(cx(f.x), cy(f.y), ts * 0.16 * (1 - k), 0, 7); ctx.fill();
    } else if (f.kind === 'spray') {
      ctx.strokeStyle = 'rgba(120,200,255,0.85)'; ctx.globalAlpha = 1 - k; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(cx(f.x), cy(f.y)); ctx.lineTo(cx(f.x2!), cy(f.y2!)); ctx.stroke();
      ctx.fillStyle = 'rgba(160,220,255,0.7)'; ctx.beginPath(); ctx.arc(cx(f.x2!), cy(f.y2!), ts * (0.2 + 0.4 * k), 0, 7); ctx.fill();
    } else if (f.kind === 'radio') {
      ctx.strokeStyle = 'rgba(124,196,255,0.8)'; ctx.globalAlpha = 1 - k; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.arc(cx(f.x), cy(f.y), ts * (0.4 + 0.9 * k), 0, 7); ctx.stroke();
    } else if (f.kind === 'flash') {
      ctx.fillStyle = `rgba(255,255,240,${0.85 * (1 - k)})`; ctx.beginPath(); ctx.arc(cx(f.x), cy(f.y), ts * (1 + 4.6 * k), 0, 7); ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx(f.x), cy(f.y), ts * 5.2 * k, 0, 7); ctx.stroke();
    } else if (f.kind === 'boom') {
      ctx.fillStyle = `rgba(255,${Math.round(200 - 120 * k)},60,${0.7 * (1 - k)})`; ctx.beginPath(); ctx.arc(cx(f.x), cy(f.y), ts * (0.8 + 3.2 * k), 0, 7); ctx.fill();
    } else if (f.kind === 'hit') {
      ctx.fillStyle = `rgba(255,70,70,${0.8 * (1 - k)})`; ctx.beginPath(); ctx.arc(cx(f.x), cy(f.y), ts * (0.3 + 0.5 * k), 0, 7); ctx.fill();
    } else if (f.kind === 'text') {
      ctx.globalAlpha = Math.min(1, (1 - k) * 2);
      pill(ctx, f.text ?? '', cx(f.x), cy(f.y) - ts * 0.9 * k, ts * 0.36, f.color ?? '#ffffff', 'rgba(8,13,18,0.9)');
    }
    ctx.globalAlpha = 1;
  }
  for (const l of labels) pill(ctx, l.text, l.x, l.y, Math.max(10, ts * 0.29), l.col);
  void I;
  ctx.restore();
}

export function hitScene(sim: Sim, s: Scene, w: number, h: number, px: number, py: number): { rid: number; cas: number } {
  const L = sceneLayout(s, w, h);
  const tx = (px - L.ox) / L.ts - 0.5, ty = (py - L.oy) / L.ts - 0.5;
  let rid = -1, bd = 0.75;
  for (const a of s.agents) { if (a.status === 'left') continue; const d = Math.hypot(a.x - tx, a.y - ty); if (d < bd) { bd = d; rid = a.rid; } }
  let cas = -1, cd = 0.6;
  for (const c of s.casualties) { if (c.where === 'loaded' || c.where === 'hospital') continue; const d = Math.hypot(c.x - tx, c.y - ty); if (d < cd) { cd = d; cas = c.id; } }
  return { rid, cas };
}

export type { FieldAgent };
