// 현장 확대 화면 렌더러 (Canvas 2D).
// 대원·구조 대상·용의자·화재·연기·장애물이 실제 시뮬레이션 상태 그대로 그려진다.
// "관찰자 시점"에서는 AI 가 아직 모르는 진실(미발견 구조 대상, 숨은 위험)도 흐리게 보여 준다.
//
// 그리는 순서: 정적 층(바닥·벽·가구) → 바닥 흔적 → 소품·차량 → 연기(아래) → 사람 → 불 → 나무 수관 → 연기(위)
//             → 어둠과 빛 → 날씨 → 효과·표지·글자.

import { drawDisasterScene } from './city/disasterLayer';
import { SKINS } from './scene/skins';
import type { Sim } from '../sim/engine';
import { visionOf } from '../sim/field/agents';
import { HOSTILE_FOV } from '../sim/field/hazards';
import { T } from '../sim/types';
import type { Casualty, FieldAgent, Hostile, Prop, Scene, Unit } from '../sim/types';
import { DEPT_COLOR, FONT } from './renderCity';
import { alpha, disc, hash2, oval, rr, seg, visPoly } from './scene/common';
import type { G } from './scene/common';
import { beginDark, drawFire, drawFog, drawLight, drawRain, drawScorch, drawSmoke, drawSpray, drawVignette, hole, holePoly, smokeLayer } from './scene/fx';
import { drawDebrisFx, drawGlassFx } from './scene/fx';
import { CAR_COLORS, VEH_SIZE, beaconColors, civilianLook, drawCar, drawClue, drawCone, drawDebris, drawDoorLeaf, drawEmergency, drawGasTank, drawHydrant, drawLying, drawPerson, drawRoadDebris, drawBus, drawSwimmer, drawUnstable, drawValve, hostileLook, responderLook } from './scene/sprites';
import type { ArmPose, Item, PersonLook } from './scene/sprites';
import { buildStatic, doorHorizontal, staticSig } from './scene/staticLayer';
import type { StaticLayer } from './scene/staticLayer';

/** 현장 화면의 시점: 중심(타일 좌표)과 배율(1 = 현장 전체가 보인다) */
export interface SceneCam { x: number; y: number; zoom: number }
export interface SceneOpts { truth: boolean; alpha: number; timeMs: number; selectedRid: number; mini?: boolean; cam?: SceneCam }
let MINI = false;      // 작은 창으로 그리는 중이면 글자와 세부 묘사를 생략한다
let CLIP_L = -1e9, CLIP_R = 1e9;   // 글자 표지가 화면 밖으로 나가지 않게 하는 한계 (현장 좌표, 화소)
export interface Layout { ts: number; ox: number; oy: number }

export function sceneLayout(s: Scene, w: number, h: number, cam?: SceneCam): Layout {
  const fit = Math.max(6, Math.floor(Math.min(w / (s.w + 0.6), h / (s.h + 0.6))));
  if (!cam || cam.zoom <= 1.001) return { ts: fit, ox: Math.floor((w - fit * s.w) / 2), oy: Math.floor((h - fit * s.h) / 2) };
  const ts = fit * cam.zoom;
  return { ts, ox: w / 2 - cam.x * ts, oy: h / 2 - cam.y * ts };
}

const BAND_COLOR = ['#5ad17a', '#ffd166', '#ff5d5d', '#7d8791'];
const BG = '#070b10';

// ───────────────────────── 정적 층 캐시 ─────────────────────────
const cache = new Map<string, { layer: StaticLayer; key: Scene; ver: number }>();
function getStatic(sim: Sim, s: Scene, R: number): StaticLayer {
  const k = s.id + ':' + R;
  let e = cache.get(k);
  if (e && e.key === s) {
    if (e.ver !== s.staticVersion) { e.ver = s.staticVersion; if (staticSig(s) !== e.layer.sig) e = undefined; }
  } else e = undefined;
  if (!e) {
    e = { layer: buildStatic(s, R, sim.incidents[s.incidentId].truth.district), key: s, ver: s.staticVersion };
    cache.delete(k);
  } else cache.delete(k);
  cache.set(k, e);                                       // 최근에 쓴 것이 뒤로 간다
  let px = 0; for (const v of cache.values()) px += v.layer.base.width * v.layer.base.height * (v.layer.over ? 2 : 1);
  for (const key of cache.keys()) { if (px <= 26e6 || cache.size <= 2) break; const v = cache.get(key)!; if (v === e) continue; px -= v.layer.base.width * v.layer.base.height * (v.layer.over ? 2 : 1); cache.delete(key); }
  return e.layer;
}

const parkCache = new WeakMap<Scene, number>();
/** 출동 차량이 서는 줄의 세로 위치 (타일 단위, 화소 = 값 × ts) */
function parkY(s: Scene): number {
  let v = parkCache.get(s);
  if (v === undefined) {
    if (s.kind === 'search') v = s.staging.y - 1.2;
    else if (s.kind === 'traffic') v = 12.62;
    else {
      // 도로의 연석 쪽 차로
      let top = -1; for (let y = 0; y < s.h; y++) if (s.tiles[y * s.w] === T.ROAD) { top = y; break; }
      v = top >= 0 ? top + 0.88 : Math.min(s.h - 0.7, s.staging.y + 2.05);
    }
    parkCache.set(s, v);
  }
  return v;
}

const doorAnim = new WeakMap<Prop, { v: number; t: number }>();
function doorOpenness(p: Prop, timeMs: number): number {
  const target = p.open ? 1 : 0;
  let st = doorAnim.get(p);
  if (!st) { st = { v: target, t: timeMs }; doorAnim.set(p, st); return target; }
  const dt = Math.min(0.1, Math.max(0, (timeMs - st.t) / 1000)); st.t = timeMs;
  st.v += Math.max(-dt * 4.5, Math.min(dt * 4.5, target - st.v));
  return st.v;
}

let canopyTmp: HTMLCanvasElement | null = null;

function pill(ctx: G, text: string, x: number, y: number, fs: number, fg: string, bg = 'rgba(8,13,18,0.82)'): void {
  if (MINI) return;
  ctx.font = `600 ${fs}px ${FONT}`;
  const w = ctx.measureText(text).width + fs * 0.8;
  x = Math.max(CLIP_L + w / 2 + 4, Math.min(CLIP_R - w / 2 - 4, x));
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x - w / 2, y - fs * 0.78, w, fs * 1.5, fs * 0.45); ctx.fill();
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + fs * 0.04);
}

const ipos = (o: { x: number; y: number; px: number; py: number }, a: number): { x: number; y: number } => ({ x: o.px + (o.x - o.px) * a, y: o.py + (o.y - o.py) * a });

const lookCache = new Map<string, PersonLook>();
function lookOf(key: string, make: () => PersonLook): PersonLook { let l = lookCache.get(key); if (!l) { l = make(); lookCache.set(key, l); if (lookCache.size > 400) lookCache.clear(); } return l; }

function agentPose(a: FieldAgent, u: Unit, moving: boolean): { arms: ArmPose; item: Item } {
  const tk = a.task ? a.task.kind : 'standby';
  const gun: Item = u.kind === 'tactical' ? 'rifle' : 'pistol';
  if (a.carrying >= 0 || a.carrying <= -2) return { arms: 'drag', item: 'none' };
  if (tk === 'engage' || tk === 'perimeter') return { arms: 'aim', item: gun };
  if (tk === 'suppress') return { arms: 'hose', item: 'none' };
  if (moving) return { arms: 'side', item: 'none' };
  const busy = a.ring > 0.01;
  switch (tk) {
    case 'treat': case 'rescueMate': case 'carry': case 'load': return { arms: busy ? 'kneel' : 'side', item: 'none' };
    case 'force': case 'clear': case 'clearRoad': return { arms: busy ? 'work' : 'side', item: 'axe' };
    case 'extricate': return { arms: busy ? 'work' : 'side', item: 'spreader' };
    case 'traffic': return { arms: 'baton', item: 'none' };
    case 'negotiate': return { arms: 'megaphone', item: 'none' };
    case 'arrest': return { arms: busy ? 'work' : 'aim', item: busy ? 'none' : gun };
    case 'hookup': case 'mitigate': return { arms: busy ? 'work' : 'side', item: 'none' };
    default: return { arms: 'side', item: 'none' };
  }
}

export function drawScene(ctx: G, sim: Sim, s: Scene, w: number, h: number, o: SceneOpts): void {
  const L = sceneLayout(s, w, h, o.cam);
  const ts = L.ts;
  MINI = !!o.mini;
  CLIP_L = -L.ox; CLIP_R = w - L.ox;
  const dpr = Math.abs(ctx.getTransform().a) || 1;
  // 정적 층의 해상도: 전체 보기에서는 화면과 1:1 (가장 선명하고 가볍다), 확대했을 때는 배율과 무관하게 고정된 고해상도 층
  const fitTs = sceneLayout(s, w, h).ts;
  const zoomed = !MINI && !!o.cam && o.cam.zoom > 1.001;
  const R = zoomed ? Math.min(96, Math.max(32, Math.round(fitTs * dpr * 1.8))) : Math.max(6, Math.round(fitTs * dpr));
  const layer = getStatic(sim, s, R);
  const W = s.w * ts, H = s.h * ts;
  const time = o.timeMs / 1000;
  const cx = (x: number): number => (x + 0.5) * ts, cy = (y: number): number => (y + 0.5) * ts;
  const cmd = s.agents.find((a) => a.isCommander);
  const night = sim.weather === 'night';
  const tAt = (x: number, y: number): number => (x < 0 || y < 0 || x >= s.w || y >= s.h ? T.VOID : s.tiles[y * s.w + x]);

  ctx.save();
  ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
  ctx.translate(L.ox, L.oy);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(layer.base, 0, 0, W, H);

  // ── 바닥 흔적: 그을음, 젖은 바닥 ──
  drawScorch(ctx, s, ts);
  for (let i = 0; i < s.wet.length; i++) {
    const v = s.wet[i]; if (v <= 0.25 || s.burned[i]) continue;
    const x = cx(i % s.w), y = cy((i / s.w) | 0);
    oval(ctx, x, y, ts * 0.66, ts * 0.56, `rgba(110,170,225,${Math.min(0.2, v * 0.2)})`, hash2(i, 3) * 3);
    if (!MINI) oval(ctx, x - ts * 0.12, y - ts * 0.1, ts * 0.2, ts * 0.07, `rgba(230,245,255,${Math.min(0.16, v * 0.14)})`, 0.5);
  }
  // 무전 음영 구역 (관찰자 시점)
  if (o.truth) {
    ctx.strokeStyle = 'rgba(185,140,255,0.22)'; ctx.lineWidth = 1;
    for (let i = 0; i < s.shadow.length; i++) if (s.shadow[i]) { const x = (i % s.w) * ts, y = ((i / s.w) | 0) * ts; ctx.beginPath(); ctx.moveTo(x, y + ts); ctx.lineTo(x + ts, y); ctx.stroke(); }
  }
  // 통제 지점: 설치 전에는 계획선만, 설치 뒤에는 고깔과 띠
  s.controlPts.forEach((p, k) => {
    const done = s.controlDone[k], x = cx(p.x);
    ctx.strokeStyle = done ? 'rgba(255,170,60,0.75)' : 'rgba(255,170,60,0.28)'; ctx.lineWidth = Math.max(1.5, ts * 0.06); ctx.setLineDash([ts * 0.22, ts * 0.16]);
    ctx.beginPath(); ctx.moveTo(x, 8.15 * ts); ctx.lineTo(x, 11.85 * ts); ctx.stroke(); ctx.setLineDash([]);
    if (done) {
      for (let q = 0; q < 4; q++) { ctx.save(); ctx.translate(x, (8.5 + q) * ts); ctx.scale(ts, ts); drawCone(ctx); ctx.restore(); }
      pill(ctx, '통제', x, 7.7 * ts, ts * 0.32, '#ffb454');
    }
  });

  // ── 시야 부채꼴 (용의자) ──
  const poly: number[] = [];
  const tracePoly = (): void => { ctx.beginPath(); for (let i = 0; i < poly.length; i += 2) { if (i) ctx.lineTo(cx(poly[i]), cy(poly[i + 1])); else ctx.moveTo(cx(poly[i]), cy(poly[i + 1])); } };
  if (!MINI) for (const hst of s.hostiles) {
    if (hst.state !== 'hold' && hst.state !== 'fight') continue;
    if ((hst.hidden && !o.truth) || sim.t < hst.stunUntil) continue;
    const p = ipos(hst, o.alpha), alert = sim.t < hst.alertUntil, range = alert ? 6 : 7;
    if (alert) visPoly(s, p.x, p.y, 0, 6.2832, range, poly); else visPoly(s, p.x, p.y, hst.facing - HOSTILE_FOV, hst.facing + HOSTILE_FOV, range, poly);
    const gr = ctx.createRadialGradient(cx(p.x), cy(p.y), ts * 0.3, cx(p.x), cy(p.y), ts * range);
    const c0 = alert ? '255,80,80' : '255,196,80';
    gr.addColorStop(0, `rgba(${c0},0.2)`); gr.addColorStop(1, `rgba(${c0},0.03)`);
    ctx.fillStyle = gr; ctx.beginPath(); ctx.moveTo(cx(p.x), cy(p.y)); for (let i = 0; i < poly.length; i += 2) ctx.lineTo(cx(poly[i]), cy(poly[i + 1])); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = `rgba(${c0},0.32)`; ctx.lineWidth = 1; ctx.stroke();
  }

  // ── 소품 ──
  const unit = (fn: () => void, x: number, y: number, rot = 0): void => { ctx.save(); ctx.translate(x, y); if (rot) ctx.rotate(rot); ctx.scale(ts, ts); fn(); ctx.restore(); };
  for (const p of s.props) {
    if (p.removed) continue;
    const idx = p.y * s.w + p.x;
    // 다른 모습을 입힌 소품: 등록된 그림으로 그린다 (view/scene/skins.ts)
    if (p.skin && SKINS[p.skin]) { const paint = SKINS[p.skin]; unit(() => paint(ctx, p, o.timeMs, o.truth, sim.t), cx(p.x + (p.w - 1) / 2), cy(p.y + (p.h - 1) / 2), p.angle ?? 0); continue; }
    if (p.kind === 'door') {
      const hor = doorHorizontal(s, p.x, p.y);
      const score = (x: number, y: number): number => { const t = tAt(x, y); if (t !== T.FLOOR && t !== T.FURN) return 0; const r = s.region[y * s.w + x]; return 2 + (r >= 0 && s.regions[r] && s.regions[r].kind === 'room' ? 1 : 0); };
      const side = hor ? (score(p.x, p.y + 1) >= score(p.x, p.y - 1) ? 1 : -1) : (score(p.x - 1, p.y) >= score(p.x + 1, p.y) ? 1 : -1);
      const lockKnown = !!p.locked && (o.truth || !!(cmd && cmd.beliefs.get('blk', idx)));
      const open = doorOpenness(p, o.timeMs);
      unit(() => drawDoorLeaf(ctx, open, side, !!s.burned[idx], lockKnown), cx(p.x), cy(p.y), hor ? 0 : Math.PI / 2);
    } else if (p.kind === 'debris') {
      unit(() => drawDebris(ctx, p.id), cx(p.x), cy(p.y));
    } else if (p.kind === 'vehicle' || p.kind === 'cover') {
      const vx = p.x * ts + (p.w * ts) / 2, vy = cy(p.y);
      if (p.leakRate && !p.mitigated && !p.ignited && (o.truth || (cmd && cmd.beliefs.get('haz', p.id)))) {
        const known = !!(cmd && cmd.beliefs.get('haz', p.id)), lk = p.leak ?? 0;
        ctx.globalAlpha = known ? 1 : 0.55;
        oval(ctx, vx + ts * 0.1, vy + ts * 0.5, ts * (0.55 + 0.8 * lk), ts * (0.3 + 0.25 * lk), 'rgba(24,20,10,0.6)', 0.2);
        oval(ctx, vx, vy + ts * 0.46, ts * (0.4 + 0.6 * lk), ts * (0.2 + 0.18 * lk), 'rgba(150,120,40,0.4)', 0.2);
        oval(ctx, vx - ts * 0.1, vy + ts * 0.42, ts * (0.16 + 0.3 * lk), ts * 0.06, 'rgba(210,160,230,0.25)', 0.3);
        pill(ctx, known ? `연료 누출 ${Math.round(lk * 100)}%` : `(미확인) 누출 ${Math.round(lk * 100)}%`, vx, vy + ts * 1.15, ts * 0.3, '#ffd166');
        ctx.globalAlpha = 1;
      }
      if (p.bus) drawBus(ctx, vx, vy, p.angle ?? 0, ts, p.w * 1.04, ['#3f8a5c', '#3f69a8', '#c9a23a', '#b5564a', '#5f9a82'][(p.color ?? 0) % 5], p.id);
      else drawCar(ctx, vx, vy, p.angle ?? 0, ts, Math.max(1.7, p.w * 0.98), CAR_COLORS[(p.color ?? 0) % CAR_COLORS.length], { wreck: p.kind === 'vehicle', dim: !!p.cleared, seed: p.id });
    } else if (p.kind === 'hydrant') {
      unit(() => drawHydrant(ctx), cx(p.x), cy(p.y));
      pill(ctx, '소화전', cx(p.x), cy(p.y) + ts * 0.66, ts * 0.28, '#ffb4a8');
    } else if (p.kind === 'gas') {
      const known = !!(cmd && cmd.beliefs.get('haz', p.id));
      if (p.exploded) { unit(() => drawGasTank(ctx, true), cx(p.x), cy(p.y)); continue; }
      if (!(o.truth || known)) continue;
      ctx.globalAlpha = known ? 1 : 0.55;
      unit(() => drawGasTank(ctx, false), cx(p.x), cy(p.y));
      if (!MINI) {
        const pr = 0.5 + 0.5 * Math.sin(time * 4);
        ctx.strokeStyle = `rgba(255,209,102,${0.35 + 0.4 * pr})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx(p.x), cy(p.y), ts * (0.36 + 0.06 * pr), 0, 7); ctx.stroke();
        pill(ctx, known ? '가스 용기' : '(미확인) 가스 용기', cx(p.x), cy(p.y) - ts * 0.6, ts * 0.27, '#ffd166');
      }
      ctx.globalAlpha = 1;
    } else if (p.kind === 'clue') {
      if (!p.found && !o.truth) continue;
      ctx.globalAlpha = p.found ? 1 : 0.45;
      unit(() => drawClue(ctx, p.id), cx(p.x), cy(p.y));
      if (p.found && !MINI) { ctx.strokeStyle = 'rgba(255,209,102,0.7)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]); ctx.beginPath(); ctx.arc(cx(p.x), cy(p.y), ts * 0.42, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
      ctx.globalAlpha = 1;
    } else if (p.kind === 'witness') {
      const lk = lookOf('w' + s.id + ':' + p.id, () => civilianLook(s.id * 131 + p.id * 17 + 5));
      if (MINI) disc(ctx, cx(p.x), cy(p.y), ts * 0.3, '#d6e2ee');
      else drawPerson(ctx, cx(p.x), cy(p.y), hash2(p.id, s.id) * 6.28, ts, lk, { step: 0, moving: false, arms: p.interviewed ? 'side' : 'up', t: time, ghost: p.interviewed ? 0.6 : 1 });
      pill(ctx, p.interviewed ? '목격자 (청취 완료)' : '목격자', cx(p.x), cy(p.y) + ts * 0.66, ts * 0.27, '#c8d4df');
    } else if (p.kind === 'roadDebris') {
      unit(() => drawRoadDebris(ctx, p.id), cx(p.x), cy(p.y));
    } else if (p.kind === 'unstable') {
      // 금이 간 구조물: 지휘관이 알게 되기 전에는 관찰자 시점에서만 보인다
      const known = !!(cmd && cmd.beliefs.get('haz', p.id));
      if (!(o.truth || known)) continue;
      ctx.globalAlpha = known ? 1 : 0.55;
      unit(() => drawUnstable(ctx, !!p.mitigated, p.id), cx(p.x), cy(p.y));
      if (!p.mitigated && !MINI) {
        const lk = p.leak ?? 0, pr = 0.5 + 0.5 * Math.sin(time * (3 + 6 * lk));
        ctx.strokeStyle = `rgba(255,${Math.round(200 - 110 * lk)},80,${0.35 + 0.45 * pr})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx(p.x), cy(p.y), ts * (0.52 + 0.07 * pr), 0, 7); ctx.stroke();
        pill(ctx, known ? '균열 — 붕괴 위험' : '(미확인) 균열', cx(p.x), cy(p.y) - ts * 0.72, ts * 0.27, '#ffd166');
      }
      ctx.globalAlpha = 1;
    } else if (p.kind === 'valve') {
      const known = !!(cmd && cmd.beliefs.get('haz', p.id));
      const wallAbove = tAt(p.x, p.y - 1) === T.WALL, wallBelow = tAt(p.x, p.y + 1) === T.WALL;
      unit(() => drawValve(ctx, p.ignited ? 2 : p.mitigated ? 1 : 0), cx(p.x), cy(p.y) + (wallAbove ? -ts * 0.14 : wallBelow ? ts * 0.14 : 0));
      if (!p.mitigated && !p.ignited && !MINI) {
        // 새어 나오는 가스
        for (let k = 0; k < 4; k++) { const ph = (time * 0.9 + k / 4) % 1, a = k * 1.7 + (wallAbove ? 1.57 : wallBelow ? -1.57 : 0); ctx.fillStyle = `rgba(206,232,110,${0.5 * (1 - ph)})`; ctx.beginPath(); ctx.arc(cx(p.x) + Math.cos(a) * ph * ts * 0.9, cy(p.y) + Math.sin(a) * ph * ts * 0.9, ts * (0.1 + 0.26 * ph), 0, 7); ctx.fill(); }
        if (o.truth || known) pill(ctx, known ? '가스 누출' : '(미확인) 가스 누출', cx(p.x), cy(p.y) - ts * 0.72, ts * 0.27, '#d6f06a');
      }
    }
  }

  // ── 현장에 도착해 있는 출동 차량 ──
  const parked = sim.units.filter((u) => u.incidentId === s.incidentId && u.state === 'onscene');
  const rowY = parkY(s) * ts;
  const vpos: { u: Unit; x: number; y: number; L: number; W: number }[] = [];
  let cursor = s.kind === 'search' || s.kind === 'traffic' ? 0.35 : s.staging.x + 1.35;      // 건물 현장: 대원이 내리는 자리(대기 지점) 바로 앞쪽에 줄지어 선다
  for (const u of parked) { const [vl, vw] = VEH_SIZE[u.kind]; vpos.push({ u, x: (cursor + vl / 2) * ts, y: rowY, L: vl, W: vw }); cursor += vl + 0.42; }
  // 소화전에 연결한 수관
  const hyd = s.props.find((p) => p.kind === 'hydrant');
  if (hyd && !MINI) for (const v of vpos) {
    if (!v.u.hydrant) continue;
    const x0 = cx(hyd.x), y0 = cy(hyd.y), x1 = v.x - v.L * ts * 0.2, y1 = v.y - v.W * ts * 0.5;
    const path = (): void => { ctx.beginPath(); ctx.moveTo(x0, y0); ctx.bezierCurveTo(x0 - ts * 2, y0 + ts * 1.6, x1 + ts * 3, y1 - ts * 1.8, x1, y1); };
    ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = ts * 0.16; path(); ctx.stroke();
    ctx.strokeStyle = '#c7a03a'; ctx.lineWidth = ts * 0.1; path(); ctx.stroke();
    ctx.strokeStyle = 'rgba(255,240,190,0.35)'; ctx.lineWidth = ts * 0.03; path(); ctx.stroke();
  }
  for (const v of vpos) {
    drawEmergency(ctx, v.x, v.y, 0, ts, v.u.kind, v.u.dept, true, o.timeMs);
    pill(ctx, v.u.callsign, v.x, v.y + ts * (v.W / 2 + 0.34), ts * 0.3, DEPT_COLOR[v.u.dept]);
  }
  // 통과 차량
  for (const c of s.cars) {
    const x = (c.px + (c.x - c.px) * o.alpha + 0.5) * ts, y = cy(c.row);
    const col = c.hit ? '#b5564a' : CAR_COLORS[(hash2((c.speed * 1000) | 0, c.row) * CAR_COLORS.length) | 0];
    drawCar(ctx, x, y, c.dir > 0 ? 0 : Math.PI, ts, 1.9, col, { seed: (c.speed * 977) | 0, lights: night, wreck: c.hit });
    if (c.distracted && o.truth && !MINI) pill(ctx, '부주의', x, y - ts * 0.7, ts * 0.26, '#d9a35a');
  }

  // ── 연기 (아래층) ──
  // 가스 누출 현장의 연기 격자는 새어 나온 가스다 (불이 붙기 전까지는 연두색으로 그린다)
  const gasTint = s.kind === 'hazmat' && !s.props.some((p) => p.kind === 'valve' && p.ignited) ? 'rgba(198,226,92,0.62)' : undefined;
  const smoke = MINI ? null : smokeLayer(s, ts, time, gasTint);
  if (MINI) drawSmoke(ctx, s, ts, time); else if (smoke) ctx.drawImage(smoke, 0, 0, W, H);

  // ── 사람: 구조 대상 → 용의자 → 대원 ──
  const carrierOf = new Map<number, FieldAgent>();
  for (const a of s.agents) if (a.carrying >= 0 && a.status !== 'left') carrierOf.set(a.carrying, a);
  const chips: { x: number; y: number; c: Casualty; known: boolean; b: number }[] = [];
  for (const c of s.casualties) {
    if (c.where === 'loaded' || c.where === 'hospital') continue;
    const known = c.tDiscovered >= 0;
    if (!known && !o.truth) continue;
    const p = ipos(c, o.alpha);
    const x = cx(p.x), y = cy(p.y);
    const b = c.dead ? 3 : c.health > 70 ? 0 : c.health > 40 ? 1 : 2;
    chips.push({ x, y, c, known, b });
    if (MINI) { rr(ctx, x - ts * 0.3, y - ts * 0.3, ts * 0.6, ts * 0.6, ts * 0.15, BAND_COLOR[b]); continue; }
    if (c.inVehicle !== null && c.where === 'scene') continue;             // 차 안에 있다: 표지만 보인다
    const lk = lookOf('c' + s.id + ':' + c.id, () => civilianLook(s.id * 977 + c.id * 31 + 1));
    const ghost = known ? 1 : 0.45;
    const carrier = carrierOf.get(c.id);
    if (b === 2 && !c.dead) { ctx.strokeStyle = `rgba(255,93,93,${0.25 + 0.3 * Math.abs(Math.sin(time * 4))})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, ts * (0.46 + 0.08 * Math.abs(Math.sin(time * 4))), 0, 7); ctx.stroke(); }
    if (c.inWater && !c.dead) { drawSwimmer(ctx, x, y, ts, lk, time + c.id, ghost); continue; }
    const upright = !c.dead && c.mob === 'mobile' && c.where !== 'carried' && c.health > 40;
    if (upright) {
      const mv = Math.abs(c.x - c.px) + Math.abs(c.y - c.py) > 0.005;
      const ang = mv ? Math.atan2(c.y - c.py, c.x - c.px) : hash2(c.id, s.id + 3) * 6.28;
      drawPerson(ctx, x, y, ang, ts, lk, { step: time * 10 + c.id, moving: mv, arms: c.hostage && c.where === 'scene' ? 'back' : c.panic && mv ? 'up' : 'side', t: time, scale: c.hostage && c.where === 'scene' ? 0.9 : 0.96, ghost });
    } else {
      const ang = carrier ? Math.atan2(carrier.fy, carrier.fx) : hash2(c.id * 7, s.id) * 6.28;
      const hurt = c.dead ? 0 : Math.max(0, (70 - c.health) / 70) * (c.treated ? 0.3 : 1);
      drawLying(ctx, x, y, ang, ts, lk, { variant: hash2(c.id, 5), sheet: c.dead, stretcher: c.where === 'carried', bandage: c.treated && !c.dead, blood: c.where === 'scene' && s.kind !== 'fire' ? hurt * 0.8 : 0, ghost });
      if (c.mob === 'trapped' && !c.dead && c.where === 'scene') {
        // 깔려 있다: 다리 쪽에 잔해
        ctx.save(); ctx.translate(x - Math.cos(ang) * ts * 0.3, y - Math.sin(ang) * ts * 0.3); ctx.scale(ts * 0.62, ts * 0.62); ctx.globalAlpha = ghost; drawDebris(ctx, c.id + 50); ctx.restore();
      }
    }
  }
  for (const hst of s.hostiles) {
    if (hst.state === 'escaped') continue;
    if (hst.hidden && !o.truth) continue;
    const p = ipos(hst, o.alpha);
    const x = cx(p.x), y = cy(p.y);
    const col = hst.state === 'fight' ? '#ff3355' : hst.state === 'flee' ? '#ff9f43' : hst.state === 'surrendered' ? '#ffd166' : hst.state === 'arrested' ? '#8b97a3' : hst.state === 'down' ? '#59626d' : '#e0486b';
    const stunned = sim.t < hst.stunUntil;
    ctx.globalAlpha = hst.hidden ? 0.5 : 1;
    if (MINI) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - ts * 0.4); ctx.lineTo(x + ts * 0.38, y + ts * 0.32); ctx.lineTo(x - ts * 0.38, y + ts * 0.32); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; continue; }
    if (hst.hostageId >= 0 && (hst.state === 'hold' || hst.state === 'fight')) {
      const hc = s.casualties[hst.hostageId];
      ctx.strokeStyle = 'rgba(255,93,93,0.8)'; ctx.lineWidth = 1.5; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx(hc.x), cy(hc.y)); ctx.stroke(); ctx.setLineDash([]);
    }
    // 발밑 표지: 위협 대상임을 한눈에
    ctx.fillStyle = alpha(col, 0.16); ctx.strokeStyle = alpha(col, hst.state === 'fight' ? 0.5 + 0.4 * Math.abs(Math.sin(time * 6)) : 0.7); ctx.lineWidth = Math.max(1.5, ts * 0.05);
    ctx.beginPath(); ctx.arc(x, y, ts * (hst.state === 'fight' ? 0.47 + 0.05 * Math.abs(Math.sin(time * 6)) : 0.45), 0, 7); ctx.fill(); ctx.stroke();
    const lk = lookOf('h' + s.id + ':' + hst.id, () => hostileLook(s.id * 53 + hst.id * 7));
    if (hst.state === 'down') drawLying(ctx, x, y, hash2(hst.id, s.id) * 6.28, ts, lk, { variant: hash2(hst.id, 9), blood: 0.5 });
    else {
      const mv = Math.abs(hst.x - hst.px) + Math.abs(hst.y - hst.py) > 0.005;
      const ang = hst.state === 'flee' && mv ? Math.atan2(hst.y - hst.py, hst.x - hst.px) : hst.facing;
      const armed = hst.weapon !== 'none';
      const arms: ArmPose = hst.state === 'surrendered' ? 'up' : hst.state === 'arrested' ? 'back' : stunned ? 'side' : (hst.state === 'hold' || hst.state === 'fight') && armed ? 'aim' : 'side';
      drawPerson(ctx, x, y, ang, ts, lk, { step: time * 12 + hst.id, moving: mv, arms, item: hst.weapon === 'gun' ? 'pistol' : hst.weapon === 'knife' ? 'knife' : 'none', t: time, scale: hst.state === 'arrested' ? 0.9 : 1 });
    }
    if (stunned) for (let k = 0; k < 4; k++) { const an = time * 5 + k * 1.57; ctx.fillStyle = '#fff3b0'; const sz = Math.max(2, ts * 0.08); ctx.fillRect(x + Math.cos(an) * ts * 0.34 - sz / 2, y - ts * 0.1 + Math.sin(an) * ts * 0.2 - sz / 2, sz, sz); }
    ctx.globalAlpha = 1;
  }
  const labels: { x: number; y: number; text: string; col: string }[] = [];
  for (const a of s.agents) {
    if (a.status === 'left') continue;
    const p = ipos(a, o.alpha);
    const moving = Math.abs(a.x - a.px) + Math.abs(a.y - a.py) > 0.01 && a.status === 'active';
    const x = cx(p.x), y = cy(p.y);
    const rsp = sim.responders[a.rid], u = sim.units[a.unitId];
    const col = DEPT_COLOR[rsp.dept];
    const sel = a.rid === o.selectedRid;
    if (MINI) {
      disc(ctx, x, y, ts * 0.46, '#0b1219'); disc(ctx, x, y, ts * 0.34, a.status === 'down' ? '#59626d' : col);
      continue;
    }
    if (sel && a.path && a.pathI < a.path.length) {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]);
      ctx.beginPath(); ctx.moveTo(x, y);
      for (let k = a.pathI; k < a.path.length; k++) ctx.lineTo(cx(a.path[k] % s.w), cy((a.path[k] / s.w) | 0));
      ctx.stroke(); ctx.setLineDash([]);
    }
    if (sel && a.status === 'active') {
      // 선택한 대원이 지금 볼 수 있는 범위 (벽에 가려진 곳은 빠진다)
      visPoly(s, p.x, p.y, 0, 6.2832, visionOf(sim, s, a), poly);
      ctx.fillStyle = 'rgba(255,255,255,0.05)'; ctx.strokeStyle = 'rgba(255,255,255,0.3)'; ctx.lineWidth = 1; ctx.setLineDash([3, 5]);
      tracePoly(); ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    }
    ctx.globalAlpha = a.status === 'withdrawn' ? 0.6 : 1;
    // 발밑 표지: 소속 색
    const fl = Math.hypot(a.fx, a.fy) || 1, ang = Math.atan2(a.fy / fl, a.fx / fl);
    if (sim.t - a.underFireT < 1.2) disc(ctx, x, y, ts * 0.6, 'rgba(255,70,70,0.3)');
    ctx.fillStyle = alpha(col, 0.14); ctx.strokeStyle = sel ? '#ffffff' : alpha(col, 0.85); ctx.lineWidth = sel ? Math.max(2, ts * 0.08) : Math.max(1.5, ts * 0.05);
    ctx.beginPath(); ctx.arc(x, y, ts * 0.44, 0, 7); ctx.fill(); ctx.stroke();
    if (a.isCommander) { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = Math.max(1.5, ts * 0.05); ctx.setLineDash([ts * 0.14, ts * 0.1]); ctx.beginPath(); ctx.arc(x, y, ts * 0.54, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    const lk = lookOf('a' + a.rid + ':' + u.kind, () => responderLook(rsp.dept, u.kind, a.rid * 13 + 7));
    if (a.status === 'down') {
      drawLying(ctx, x, y, hash2(a.rid, 77) * 6.28, ts, lk, { variant: hash2(a.rid, 5), blood: 0.3 });
      ctx.strokeStyle = `rgba(255,93,93,${0.5 + 0.4 * Math.abs(Math.sin(time * 4))})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, ts * 0.56, 0, 7); ctx.stroke();
    } else {
      const pose = agentPose(a, u, moving);
      drawPerson(ctx, x, y, ang, ts, lk, { step: time * 11 + a.rid, moving, arms: pose.arms, item: pose.item, t: time + a.rid * 0.37 });
      if (a.inCover && s.kind === 'armed') { rr(ctx, x + ts * 0.26, y + ts * 0.24, ts * 0.2, ts * 0.2, ts * 0.05, '#e8f0f7'); ctx.fillStyle = '#0b1219'; ctx.font = `800 ${Math.round(ts * 0.15)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('엄', x + ts * 0.36, y + ts * 0.35); }
      if (a.ring > 0.01) {
        ctx.strokeStyle = 'rgba(8,13,18,0.6)'; ctx.lineWidth = Math.max(3, ts * 0.11); ctx.beginPath(); ctx.arc(x, y, ts * 0.62, 0, 7); ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, ts * 0.07); ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(x, y, ts * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, a.ring)); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    if (a.label) labels.push({ x, y: y - ts * 0.82, text: (a.isCommander ? '★ ' : '') + (sel ? rsp.name + ' · ' : '') + (a.label.length > 13 ? a.label.slice(0, 12) + '…' : a.label), col: a.status === 'down' ? '#ff5d5d' : col });
    else if (sel) labels.push({ x, y: y - ts * 0.82, text: rsp.name, col });
  }

  // 구조 줄: 물가의 대원에서 물속의 사람까지
  if (!MINI) for (const a of s.agents) {
    if (a.status !== 'active' || !a.task || a.task.kind !== 'waterRescue' || a.ring <= 0.01) continue;
    const c = s.casualties[a.task.cas];
    if (!c || !c.inWater) continue;
    const p = ipos(a, o.alpha), q = ipos(c, o.alpha);
    const x0 = cx(p.x), y0 = cy(p.y), x1 = cx(q.x), y1 = cy(q.y), k = Math.min(1, a.ring * 2.2);
    const ex = x0 + (x1 - x0) * k, ey = y0 + (y1 - y0) * k;
    ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = Math.max(2, ts * 0.07);
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.quadraticCurveTo((x0 + ex) / 2 + ts * 0.3, (y0 + ey) / 2 + ts * 0.2, ex, ey); ctx.stroke();
    ctx.strokeStyle = '#f2e6c0'; ctx.lineWidth = Math.max(1.5, ts * 0.04); ctx.stroke();
    ctx.strokeStyle = '#e8532f'; ctx.lineWidth = Math.max(2, ts * 0.08); ctx.beginPath(); ctx.arc(ex, ey, ts * 0.16, 0, 7); ctx.stroke();
    ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1, ts * 0.03); ctx.setLineDash([ts * 0.08, ts * 0.17]); ctx.beginPath(); ctx.arc(ex, ey, ts * 0.16, 0, 7); ctx.stroke(); ctx.setLineDash([]);
  }

  // ── 불 ──
  drawFire(ctx, s, ts, time, MINI);

  // ── 나무 수관: 사람이 있는 자리는 뚫어 보여 준다 ──
  if (layer.over) {
    if (MINI) { ctx.globalAlpha = 0.85; ctx.drawImage(layer.over, 0, 0, W, H); ctx.globalAlpha = 1; }
    else {
      if (!canopyTmp) canopyTmp = document.createElement('canvas');
      if (canopyTmp.width !== layer.over.width || canopyTmp.height !== layer.over.height) { canopyTmp.width = layer.over.width; canopyTmp.height = layer.over.height; }
      const tg = canopyTmp.getContext('2d')!;
      tg.globalCompositeOperation = 'copy'; tg.drawImage(layer.over, 0, 0);
      tg.globalCompositeOperation = 'destination-out';
      const punch = (x: number, y: number, r: number): void => hole(tg, (x + 0.5) * R, (y + 0.5) * R, r * R, 0.85);
      for (const a of s.agents) { if (a.status === 'left') continue; const p = ipos(a, o.alpha); punch(p.x, p.y, 1.7); }
      for (const q of chips) punch((q.x / ts) - 0.5, (q.y / ts) - 0.5, 1.3);
      for (const hst of s.hostiles) { if (hst.state === 'escaped' || (hst.hidden && !o.truth)) continue; punch(hst.x, hst.y, 1.3); }
      for (const p of s.props) if ((p.kind === 'clue' && (p.found || o.truth)) || p.kind === 'witness') punch(p.x, p.y, 1.1);
      for (const v of vpos) punch(v.x / ts - 0.5, v.y / ts - 0.5, 1.9);
      ctx.drawImage(canopyTmp, 0, 0, W, H);
    }
  }
  // ── 연기 (위층): 사람 위로 옅게 한 겹 더 ──
  if (smoke) { ctx.globalAlpha = 0.4; ctx.drawImage(smoke, 0, 0, W, H); ctx.globalAlpha = 1; }

  // ── 어둠과 빛 ──
  // 밤에는 손전등·불빛·차량·가로등 주변만 밝다. AI 시점의 무장 사건에서는 대원이 지금 보고 있는 곳만 밝다.
  const fog = !o.truth && s.kind === 'armed' && s.agents.some((a) => a.status !== 'left');
  if (MINI) { if (night) { ctx.fillStyle = 'rgba(3,6,20,0.4)'; ctx.fillRect(0, 0, W, H); } }
  else if (night || fog) {
    const D = beginDark(W, H, night ? 'rgba(4,8,24,0.72)' : 'rgba(5,9,15,0.56)');
    const dg = D.g, k = D.sc;
    const pts: number[] = [];
    if (night) { dg.fillStyle = 'rgba(0,0,0,0.3)'; for (const r of s.regions) if (r.indoor) dg.fillRect(r.x0 * ts * k, r.y0 * ts * k, (r.x1 - r.x0 + 1) * ts * k, (r.y1 - r.y0 + 1) * ts * k); }
    for (const a of s.agents) {
      if (a.status === 'left') continue;
      const p = ipos(a, o.alpha), ax = cx(p.x) * k, ay = cy(p.y) * k;
      if (fog) {
        const vr = visionOf(sim, s, a) * 1.1 + 0.6;
        visPoly(s, p.x, p.y, 0, 6.2832, vr, poly);
        pts.length = 0; for (let i = 0; i < poly.length; i += 2) pts.push(cx(poly[i]) * k, cy(poly[i + 1]) * k);
        holePoly(dg, ax, ay, pts, vr * ts * k, night ? 0.92 : 1);
      } else {
        hole(dg, ax, ay, ts * 1.7 * k, 0.75);
        if (a.status !== 'down') {
          const fl = Math.hypot(a.fx, a.fy) || 1, ang = Math.atan2(a.fy / fl, a.fx / fl);
          visPoly(s, p.x, p.y, ang - 0.55, ang + 0.55, 6.5, poly);
          pts.length = 0; for (let i = 0; i < poly.length; i += 2) pts.push(cx(poly[i]) * k, cy(poly[i + 1]) * k);
          holePoly(dg, ax, ay, pts, ts * 6.5 * k, 0.9);
        }
      }
    }
    for (const v of vpos) { hole(dg, v.x * k, v.y * k, ts * 3.2 * k, 0.85); if (night) hole(dg, (v.x + ts * (v.L / 2 + 2.2)) * k, v.y * k, ts * 2.8 * k, 0.7); }
    if (night) for (const l of layer.lamps) hole(dg, cx(l.x) * k, cy(l.y) * k, ts * 3.8 * k, 0.85);
    hole(dg, (s.safe.x + 0.45) * ts * k, (s.safe.y + 0.4) * ts * k, ts * 3 * k, 0.7);
    for (let i = 0; i < s.fire.length; i++) if (s.fire[i] > 0.2) hole(dg, cx(i % s.w) * k, cy((i / s.w) | 0) * k, ts * (1.9 + 2.5 * s.fire[i]) * k, 0.65);
    for (const c of s.cars) hole(dg, (c.x + 0.5 + c.dir * 2.2) * ts * k, cy(c.row) * k, ts * 2.8 * k, 0.75);
    for (const f of s.fx) {
      const age = sim.t - f.t;
      if (f.kind === 'shot' && age >= 0 && age < 0.25) hole(dg, cx(f.x) * k, cy(f.y) * k, ts * 2.6 * k, 0.8);
      else if ((f.kind === 'flash' || f.kind === 'boom') && age >= 0 && age < f.ttl) hole(dg, cx(f.x) * k, cy(f.y) * k, ts * 6.5 * k, 1 - age / f.ttl);
    }
    ctx.drawImage(D.c, 0, 0, W, H);
  }
  // 색이 있는 빛: 경광등, 불빛, 가로등, 총구 섬광
  ctx.globalCompositeOperation = 'lighter';
  const nk = night ? 1 : 0.42;
  if (!MINI) {
    for (const v of vpos) {
      const [ca, cb] = beaconColors(v.u.dept), ph = time * 7 + v.u.id * 1.3;
      const lx = v.x + ts * v.L * 0.12;
      drawLight(ctx, lx + Math.cos(ph) * ts * 0.7, v.y + Math.sin(ph) * ts * 0.7, ts * 2.5, ca, 0.5 * nk * (0.55 + 0.45 * Math.sin(ph * 1.7)));
      drawLight(ctx, lx - Math.cos(ph) * ts * 0.7, v.y - Math.sin(ph) * ts * 0.7, ts * 2.5, cb, 0.5 * nk * (0.55 - 0.45 * Math.sin(ph * 1.7)));
    }
    if (night) {
      for (const l of layer.lamps) drawLight(ctx, cx(l.x), cy(l.y), ts * 3.4, '#ffd9a0', 0.2);
      for (const c of s.cars) drawLight(ctx, (c.x + 0.5 + c.dir * 1.9) * ts, cy(c.row), ts * 2.2, '#fff1c8', 0.22);
      for (const v of vpos) drawLight(ctx, v.x + ts * (v.L / 2 + 1.6), v.y, ts * 2.2, '#fff1c8', 0.16);
    }
    // 불빛: 3×3 칸 묶음마다 하나씩 (칸마다 그리면 겹쳐 그리는 양이 지나치게 많다)
    for (let gy = 0; gy < s.h; gy += 3) for (let gx = 0; gx < s.w; gx += 3) {
      let sum = 0, mx = 0, my = 0;
      for (let y = gy; y < Math.min(s.h, gy + 3); y++) for (let x = gx; x < Math.min(s.w, gx + 3); x++) { const f = s.fire[y * s.w + x]; if (f > 0.15) { sum += f; mx += x * f; my += y * f; } }
      if (sum < 0.3) continue;
      drawLight(ctx, cx(mx / sum), cy(my / sum), ts * (3 + Math.min(3.2, sum * 0.7)), '#ff8a3c', Math.min(0.5, 0.12 + sum * 0.06) * (night ? 1.5 : 0.8) * (0.92 + 0.08 * Math.sin(time * 9 + gx + gy)));
    }
    for (const f of s.fx) {
      const age = sim.t - f.t;
      if (f.kind === 'shot' && age >= 0 && age < 0.2) drawLight(ctx, cx(f.x), cy(f.y), ts * 1.9, '#ffe2a0', 0.7 * (1 - age / 0.2));
    }
  }
  ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;

  // ── 날씨 ──
  if (sim.weather === 'fog') drawFog(ctx, W, H, o.timeMs, MINI);
  else if (sim.weather === 'rain') { ctx.save(); ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip(); drawRain(ctx, W, H, o.timeMs, MINI); ctx.restore(); }
  drawDisasterScene(ctx, sim, s, W, H, o.timeMs, MINI);

  // ── 지휘관의 판단: 수색 확률, 수색 확인율 ──
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  if (!MINI) for (const r of s.regions) {
    if (r.kind === 'wreck') continue;
    const zone = r.kind === 'zone';
    ctx.fillStyle = zone ? 'rgba(225,238,248,0.34)' : 'rgba(225,238,248,0.42)';
    ctx.font = `600 ${Math.round(ts * (zone ? 0.5 : 0.34))}px ${FONT}`;
    ctx.fillText(r.name, cx(r.cx), cy(r.cy) - (r.kind === 'room' ? ts * 0.1 : 0));
    if (zone) { ctx.strokeStyle = 'rgba(190,215,235,0.14)'; ctx.lineWidth = 1; ctx.setLineDash([4, 6]); ctx.strokeRect(r.x0 * ts, r.y0 * ts, (r.x1 - r.x0 + 1) * ts, (r.y1 - r.y0 + 1) * ts); ctx.setLineDash([]); }
  }
  if (cmd) for (const r of s.regions) {
    if (!r.searchable) continue;
    const conf = cmd.beliefs.val<number>('srch', r.id);
    if (s.kind === 'search' && s.zoneProb[r.id] > 0 && conf === undefined) {
      // 지휘관이 가능성이 높다고 보는 구역
      const a = Math.min(0.2, s.zoneProb[r.id] * 0.42), m = ts * 0.14;
      ctx.fillStyle = `rgba(79,209,197,${a})`; ctx.beginPath(); ctx.roundRect(r.x0 * ts + m, r.y0 * ts + m, (r.x1 - r.x0 + 1) * ts - m * 2, (r.y1 - r.y0 + 1) * ts - m * 2, ts * 0.5); ctx.fill();
      ctx.strokeStyle = `rgba(120,235,222,${Math.min(0.6, a * 2.6)})`; ctx.lineWidth = 1.5; ctx.setLineDash([ts * 0.3, ts * 0.22]); ctx.stroke(); ctx.setLineDash([]);
    }
    if (conf !== undefined && r.kind !== 'wreck' && !MINI) {
      ctx.font = `700 ${Math.round(ts * 0.3)}px ${FONT}`;
      ctx.fillStyle = conf >= 0.72 ? 'rgba(110,225,140,0.9)' : 'rgba(255,190,96,0.92)';
      ctx.fillText(`수색 ${Math.round(conf * 100)}%`, cx(r.cx), cy(r.cy) + ts * (r.kind === 'zone' ? 0.7 : 0.36));
    }
  }
  if (!MINI) { ctx.font = `700 ${Math.round(ts * 0.3)}px ${FONT}`; ctx.fillStyle = 'rgba(190,255,215,0.75)'; ctx.fillText('안전 구역', (s.safe.x + 0.45) * ts, (s.safe.y - 0.84) * ts); }

  // 지휘관이 정한 진입 지점
  if (!MINI && s.entryOrdered && !s.breachDone) for (const [k, label] of [[s.entryExit, s.entryExit2 >= 0 ? '1조 진입' : '진입 지점'], [s.entryExit2, '2조 진입']] as [number, string][]) {
    if (k < 0 || k >= s.exits.length) continue;
    const e = s.exits[k], x = cx(e.x), y = cy(e.y), pr = 0.5 + 0.5 * Math.sin(time * 5);
    ctx.strokeStyle = `rgba(90,169,255,${0.5 + 0.4 * pr})`; ctx.lineWidth = Math.max(2, ts * 0.07); ctx.setLineDash([ts * 0.2, ts * 0.14]);
    ctx.beginPath(); ctx.arc(x, y, ts * (0.9 + 0.1 * pr), 0, 7); ctx.stroke(); ctx.setLineDash([]);
    pill(ctx, `${label} · ${Math.max(0, Math.ceil(s.breachAt - sim.t))}초`, x, y + ts * (e.y < s.h / 2 ? -1.25 : 1.25), ts * 0.3, '#9fd0ff');
  }

  // ── 구조 대상 표지: 중증도 색 딱지, 상태 막대 ──
  if (!MINI) for (const q of chips) {
    const c = q.c, r = ts * 0.2, x = q.x + ts * 0.36, y = q.y - ts * 0.38;
    ctx.globalAlpha = q.known ? 1 : 0.55;
    ctx.fillStyle = BAND_COLOR[q.b]; ctx.strokeStyle = '#0b1219'; ctx.lineWidth = Math.max(1.5, ts * 0.05);
    if (!q.known) ctx.setLineDash([3, 3]);
    ctx.beginPath(); ctx.roundRect(x - r, y - r, r * 2, r * 2, r * 0.45); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = '#0b1219'; ctx.font = `800 ${Math.round(ts * 0.27)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    ctx.fillText(q.known ? c.label : '?', x, y + 1);
    if (c.mob === 'trapped' && !c.dead && c.where === 'scene') pill(ctx, c.inWater ? (c.drift ? '표류 중' : '물속 — 걸려 있음') : c.inVehicle !== null ? '차량에 갇힘' : '매몰', q.x, q.y + ts * 0.62, ts * 0.25, c.inWater ? '#9fd8ff' : '#e8f0f7');
    if (c.treated && !c.dead) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + r - ts * 0.02, y - r - ts * 0.11, ts * 0.05, ts * 0.17); ctx.fillRect(x + r - ts * 0.08, y - r - ts * 0.05, ts * 0.17, ts * 0.05); }
    if (!c.dead && (c.where === 'scene' || c.where === 'safe')) {
      const bw = ts * 0.56, bx = q.x - bw / 2, by = q.y + ts * 0.36, bh = Math.max(3, ts * 0.085);
      rr(ctx, bx - 1, by - 1, bw + 2, bh + 2, bh / 2, 'rgba(8,13,18,0.85)');
      rr(ctx, bx, by, Math.max(bh, bw * Math.max(0, c.health / 100)), bh, bh / 2, BAND_COLOR[q.b]);
    }
    ctx.globalAlpha = 1;
  }
  // 용의자 표지
  if (!MINI) for (const hst of s.hostiles) {
    if (hst.state === 'escaped' || (hst.hidden && !o.truth)) continue;
    const p = ipos(hst, o.alpha), x = cx(p.x), y = cy(p.y);
    const col = hst.state === 'fight' ? '#ff3355' : hst.state === 'flee' ? '#ff9f43' : hst.state === 'surrendered' ? '#ffd166' : hst.state === 'arrested' ? '#8b97a3' : hst.state === 'down' ? '#8b97a3' : '#ff7a94';
    const stunned = sim.t < hst.stunUntil;
    const stt = stunned ? '무력화' : hst.hidden ? '(숨음)' : hst.state === 'hold' ? (hst.hostageId >= 0 ? '인질 대치' : '대치') : hst.state === 'fight' ? '교전' : hst.state === 'flee' ? '도주' : hst.state === 'surrendered' ? '투항' : hst.state === 'arrested' ? '검거' : '제압';
    const wp = hst.weapon === 'gun' ? '총' : hst.weapon === 'knife' ? '칼' : '';
    ctx.globalAlpha = hst.hidden ? 0.6 : 1;
    pill(ctx, `${hst.label}${wp ? '·' + wp : ''} · ${stt}`, x, y - ts * 0.8, ts * 0.27, col);
    if (hst.state === 'hold' || hst.state === 'fight') {
      const bw = ts * 0.6, bh = Math.max(3, ts * 0.085);
      rr(ctx, x - bw / 2 - 1, y + ts * 0.54 - 1, bw + 2, bh + 2, bh / 2, 'rgba(8,13,18,0.85)');
      rr(ctx, x - bw / 2, y + ts * 0.54, Math.max(bh, bw * Math.max(0, Math.min(1, hst.morale))), bh, bh / 2, '#ffb454');
    }
    ctx.globalAlpha = 1;
  }

  // ── 효과 ──
  for (const f of s.fx) {
    const age = sim.t - f.t;
    if (age < 0 || age > f.ttl) continue;
    const k = age / f.ttl;
    if (f.kind === 'shot') {
      const x0 = cx(f.x), y0 = cy(f.y), x1 = cx(f.x2!), y1 = cy(f.y2!);
      const hd = Math.min(1, k * 2.4), tl = Math.max(0, hd - 0.45);
      ctx.lineCap = 'round';
      ctx.strokeStyle = alpha('#ffe9a8', 0.35 * (1 - k)); ctx.lineWidth = Math.max(1, ts * 0.03); ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.stroke();
      ctx.strokeStyle = f.color ?? '#fff3c0'; ctx.globalAlpha = 1 - k * 0.6; ctx.lineWidth = Math.max(2, ts * 0.07);
      ctx.beginPath(); ctx.moveTo(x0 + (x1 - x0) * tl, y0 + (y1 - y0) * tl); ctx.lineTo(x0 + (x1 - x0) * hd, y0 + (y1 - y0) * hd); ctx.stroke();
      if (k < 0.35) {
        // 총구 화염
        const a = Math.atan2(y1 - y0, x1 - x0), sz = ts * 0.42 * (1 - k / 0.35);
        ctx.save(); ctx.translate(x0, y0); ctx.rotate(a); ctx.fillStyle = '#fff6d0';
        ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(sz * 0.5, -sz * 0.28); ctx.lineTo(sz * 1.3, 0); ctx.lineTo(sz * 0.5, sz * 0.28); ctx.closePath(); ctx.fill();
        ctx.fillStyle = '#ffb347'; ctx.beginPath(); ctx.arc(0, 0, sz * 0.3, 0, 7); ctx.fill(); ctx.restore();
      }
    } else if (f.kind === 'spray') {
      drawSpray(ctx, cx(f.x), cy(f.y), cx(f.x2!), cy(f.y2!), ts, k, time);
    } else if (f.kind === 'radio') {
      if (MINI) continue;
      ctx.strokeStyle = 'rgba(124,196,255,0.85)'; ctx.globalAlpha = 1 - k; ctx.lineWidth = 1.5;
      for (let q = 0; q < 2; q++) { ctx.beginPath(); ctx.arc(cx(f.x), cy(f.y) - ts * 0.3, ts * (0.3 + 0.7 * k + q * 0.22), -2.2, -0.94); ctx.stroke(); }
    } else if (f.kind === 'flash') {
      ctx.fillStyle = `rgba(255,255,240,${0.85 * (1 - k)})`; ctx.beginPath(); ctx.arc(cx(f.x), cy(f.y), ts * (1 + 4.6 * k), 0, 7); ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${1 - k})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx(f.x), cy(f.y), ts * 5.2 * k, 0, 7); ctx.stroke();
    } else if (f.kind === 'boom') {
      const x = cx(f.x), y = cy(f.y);
      ctx.globalCompositeOperation = 'lighter';
      drawLight(ctx, x, y, ts * (1.5 + 4.5 * k), '#ff9a3c', 0.9 * (1 - k));
      drawLight(ctx, x, y, ts * (0.8 + 2.2 * k), '#fff0c0', 0.9 * (1 - k));
      ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1;
      ctx.strokeStyle = `rgba(255,220,160,${0.8 * (1 - k)})`; ctx.lineWidth = Math.max(2, ts * 0.1 * (1 - k)); ctx.beginPath(); ctx.arc(x, y, ts * (0.6 + 3.6 * k), 0, 7); ctx.stroke();
      for (let q = 0; q < 10; q++) { const a = hash2(q, (f.t * 10) | 0) * 6.28, d = ts * (0.5 + 3.2 * k) * (0.5 + hash2(q * 3, 7)); ctx.fillStyle = `rgba(40,34,30,${1 - k})`; const sz = Math.max(2, ts * 0.09); ctx.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, sz, sz); }
    } else if (f.kind === 'hit') {
      const x = cx(f.x), y = cy(f.y);
      for (let q = 0; q < 6; q++) { const a = hash2(q, (f.t * 10) | 0) * 6.28, d = ts * (0.15 + 0.5 * k); ctx.fillStyle = `rgba(230,50,50,${0.9 * (1 - k)})`; const sz = Math.max(2, ts * 0.07); ctx.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, sz, sz); }
      ctx.strokeStyle = `rgba(255,90,90,${0.8 * (1 - k)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, ts * (0.25 + 0.4 * k), 0, 7); ctx.stroke();
    } else if (f.kind === 'glass') {
      if (!MINI) drawGlassFx(ctx, f, ts, k);
    } else if (f.kind === 'debris') {
      if (!MINI) drawDebrisFx(ctx, s, f, ts, k);
    } else if (f.kind === 'text') {
      ctx.globalAlpha = Math.min(1, (1 - k) * 2);
      pill(ctx, f.text ?? '', cx(f.x), cy(f.y) - ts * (0.5 + 0.9 * k), ts * 0.34, f.color ?? '#ffffff', 'rgba(8,13,18,0.9)');
    }
    ctx.globalAlpha = 1;
  }
  for (const l of labels) pill(ctx, l.text, l.x, l.y, Math.max(10, ts * 0.28), l.col);

  // 지도 가장자리를 배경으로 녹인다
  if (!MINI) {
    const e = ts * 0.5;
    const fade = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number): void => { const gr = ctx.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, BG); gr.addColorStop(1, 'rgba(7,11,16,0)'); ctx.fillStyle = gr; ctx.fillRect(rx, ry, rw, rh); };
    fade(0, 0, e, 0, -1, -1, e + 1, H + 2); fade(W, 0, W - e, 0, W - e, -1, e + 1, H + 2);
    fade(0, 0, 0, e, -1, -1, W + 2, e + 1); fade(0, H, 0, H - e, -1, H - e, W + 2, e + 1);
  }
  ctx.restore();
  if (!MINI) drawVignette(ctx, w, h);
  void seg;
}

export function hitScene(sim: Sim, s: Scene, w: number, h: number, px: number, py: number, cam?: SceneCam): { rid: number; cas: number } {
  const L = sceneLayout(s, w, h, cam);
  const tx = (px - L.ox) / L.ts - 0.5, ty = (py - L.oy) / L.ts - 0.5;
  let rid = -1, bd = 0.75;
  for (const a of s.agents) { if (a.status === 'left') continue; const d = Math.hypot(a.x - tx, a.y - ty); if (d < bd) { bd = d; rid = a.rid; } }
  let cas = -1, cd = 0.6;
  for (const c of s.casualties) { if (c.where === 'loaded' || c.where === 'hospital') continue; const d = Math.hypot(c.x - tx, c.y - ty); if (d < cd) { cd = d; cas = c.id; } }
  return { rid, cas };
}

export type { FieldAgent, Hostile };
