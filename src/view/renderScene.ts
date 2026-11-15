// 현장 확대 화면 렌더러 (Canvas 2D).
// 대원·구조 대상·용의자·화재·연기·장애물이 실제 시뮬레이션 상태 그대로 그려진다.
// "관찰자 시점"에서는 AI 가 아직 모르는 진실(미발견 구조 대상, 숨은 위험)도 흐리게 보여 준다.
//
// 그리는 순서: 정적 층(바닥·벽·가구) → 바닥 흔적 → 소품·차량 → 연기(아래) → 사람 → 불 → 나무 수관 → 연기(위)
//             → 상공의 헬기 → 어둠과 빛 → 날씨 → 효과·표지·글자.

import { drawDisasterScene } from './city/disasterLayer';
import { SKINS } from './scene/skins';
// (R1) 장비는 읽기만 한다: 고장을 드러내거나 수량을 줄이는 함수는 여기서 부르지 않는다 — 그리는 것만으로 기록이 바뀌면 안 된다 (tests/crews.test.ts ⑬)
import { AIR_LOW, hasKit, isHovering, kitUses } from '../sim/crews';
import type { Sim } from '../sim/engine';
import { visionOf } from '../sim/field/agents';
import { HOSTILE_FOV } from '../sim/field/hazards';
import { T } from '../sim/types';
import type { AirOp, Casualty, FieldAgent, Fx, Hostile, Prop, Scene, Unit } from '../sim/types';
import { DEPT_COLOR, FONT } from './renderCity';
import { alpha, disc, hash2, oval, rr, seg, visPoly } from './scene/common';
import type { G } from './scene/common';
import { beginDark, drawFire, drawFog, drawLight, drawRain, drawScorch, drawSmoke, drawSpray, drawVignette, hole, holePoly, smokeLayer } from './scene/fx';
import { drawDebrisFx, drawDropFx, drawGlassFx } from './scene/fx';
import { CAR_COLORS, VEH_SIZE, beaconColors, civilianLook, drawCar, drawClue, drawCone, drawDebris, drawDoorLeaf, drawEmergency, drawGasTank, drawHeli, drawHydrant, drawLying, drawPerson, drawRoadDebris, drawBus, drawSwimmer, drawUnstable, drawValve, hostileLook, responderLook } from './scene/sprites';
import type { ArmPose, Item, PersonLook } from './scene/sprites';
import { buildStatic, doorHorizontal, staticSig } from './scene/staticLayer';
import type { StaticLayer } from './scene/staticLayer';
import { FX_DRAWN } from './scene/fxBook';
import type { FxBook, FxView } from './scene/fxBook';
import { agentFx, casualtyFlinch, drawAimLines, drawBreachGlow, drawCombatDecals, drawCombatFx, drawCombatHoles, drawCombatLights, drawCountdown, drawCoverBadge, drawCoverBand, drawCuffs, drawNegotiation, drawScreenVeil, drawStunStars, hostileFx, stunMark } from './scene/combat';
import type { CombatView } from './scene/combat';
import { drawBlastScars, drawDangerZones, drawFallMoments, drawFallRing, drawGasEdge, drawRekindle, sceneShake } from './scene/hazardFx';
import type { HazardLabel } from './scene/hazardFx';
import { gasView, hostageState, rekindledRegions } from './hazardState';
import { ruinZones, strokeRuinEdges } from './scene/ruins';
import { TRIAGE, TRIAGE_EDGE, TRIAGE_TEXT, casBand, casDrawn, casSheet, hostileBand, hostileDrawn, hostileSheet, hurtPose, respBand, respLying, respSheet } from './triage';

/** 현장 화면의 시점: 중심(타일 좌표)과 배율(1 = 현장 전체가 보인다) */
export interface SceneCam { x: number; y: number; zoom: number }
export interface SceneOpts { truth: boolean; alpha: number; timeMs: number; selectedRid: number; mini?: boolean; cam?: SceneCam; book?: FxBook
  pick?: { kind: 'cas' | 'hostile'; id: number } | null }      // (H1) 정보창에 띄운 구조 대상·용의자 (흰 점선 고리로 표시한다)
let MINI = false;      // 작은 창으로 그리는 중이면 글자와 세부 묘사를 생략한다
let CLIP_L = -1e9, CLIP_R = 1e9;   // 글자 표지가 화면 밖으로 나가지 않게 하는 한계 (현장 좌표, 화소)
export interface Layout { ts: number; ox: number; oy: number }

export function sceneLayout(s: Scene, w: number, h: number, cam?: SceneCam): Layout {
  const fit = Math.max(6, Math.floor(Math.min(w / (s.w + 0.6), h / (s.h + 0.6))));
  if (!cam || cam.zoom <= 1.001) return { ts: fit, ox: Math.floor((w - fit * s.w) / 2), oy: Math.floor((h - fit * s.h) / 2) };
  const ts = fit * cam.zoom;
  return { ts, ox: w / 2 - cam.x * ts, oy: h / 2 - cam.y * ts };
}

const BAND_COLOR = TRIAGE;      // (H1) 중증도 색은 view/triage.ts 한 곳: 초록 · 노랑 · 빨강 · 검정(사망 — 밝은 테두리 TRIAGE_EDGE, 흰 글씨 TRIAGE_TEXT)
let reducedQ: { matches: boolean } | null | undefined;
/** prefers-reduced-motion: 흔들림을 끄고 화면 막을 옅게 (시험 환경에는 matchMedia 가 없다) */
function reducedMotion(): boolean {
  if (reducedQ === undefined) reducedQ = typeof matchMedia === 'function' ? matchMedia('(prefers-reduced-motion: reduce)') : null;
  return !!reducedQ && reducedQ.matches;
}
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
/** (G5) 진입 연출의 문짝 열림: 방법마다 빠르기와 튕김(1 을 넘는다)이 다르다. age = 연출 시계로 연 지 얼마 */
function kickOpen(how: string, age: number): number | null {
  if (how === 'open' || age < 0) return null;
  if (how === 'push') return age < 0.15 ? Math.min(1, age * 9) : null;
  if (how === 'hydraulic') return age < 0.4 ? Math.min(1, age * 6) : null;
  const peak = how === 'kick' ? 1.12 : 1.18, rise = peak / 22, end = how === 'kick' ? 0.3 : 0.35;
  if (age < rise) return age * 22;
  if (age < end) return peak - (peak - 1) * ((age - rise) / (end - rise));
  return null;
}
function doorOpenness(p: Prop, timeMs: number, kick?: { age: number; how: string } | null): number {
  const target = p.open ? 1 : 0;
  let st = doorAnim.get(p);
  if (kick) { const v = kickOpen(kick.how, kick.age); if (v !== null) { if (!st) { st = { v, t: timeMs }; doorAnim.set(p, st); } st.v = v; st.t = timeMs; return v; } }
  if (!st) { st = { v: target, t: timeMs }; doorAnim.set(p, st); return target; }
  const dt = Math.min(0.1, Math.max(0, (timeMs - st.t) / 1000)); st.t = timeMs;
  if (st.v > 1) st.v = Math.max(1, st.v - dt * 2);
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

/**
 * (H1) 중증도 딱지: 분류 색의 둥근 네모. 글자(구조 대상의 이름표)가 있으면 안에 쓰고, 처치를 받았으면 오른쪽 위에 흰 십자를 얹는다.
 * 검정(사망) 딱지는 밝은 테두리와 흰 글씨로 어두운 배경에서도 읽힌다. 대원·용의자의 딱지는 글자 없이 색만이다.
 */
function triageBadge(ctx: G, x: number, y: number, r: number, b: number, ts: number, text = '', cross = false, dashed = false): void {
  ctx.fillStyle = TRIAGE[b]; ctx.strokeStyle = TRIAGE_EDGE[b]; ctx.lineWidth = Math.max(1.5, ts * 0.05);
  if (dashed) ctx.setLineDash([3, 3]);
  ctx.beginPath(); ctx.roundRect(x - r, y - r, r * 2, r * 2, r * 0.45); ctx.fill(); ctx.stroke(); ctx.setLineDash([]);
  if (text) { ctx.fillStyle = TRIAGE_TEXT[b]; ctx.font = `800 ${Math.round(r * 1.35)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 1); }
  if (cross) { ctx.fillStyle = '#ffffff'; ctx.fillRect(x + r - ts * 0.02, y - r - ts * 0.11, ts * 0.05, ts * 0.17); ctx.fillRect(x + r - ts * 0.08, y - r - ts * 0.05, ts * 0.17, ts * 0.05); }
}

const lookCache = new Map<string, PersonLook>();
function lookOf(key: string, make: () => PersonLook): PersonLook { let l = lookCache.get(key); if (!l) { l = make(); lookCache.set(key, l); if (lookCache.size > 400) lookCache.clear(); } return l; }

/**
 * 대원의 자세와 손에 든 것. 손에 든 것은 부대 종류가 아니라 그 대원이 든 장비에서 고른다 (R1 10절):
 * 읽기만 한다 — hasKit(알려진 고장이 아닌 장비)만 보고 kitWorks 는 부르지 않는다(그리는 것만으로 고장이 드러나면 안 된다).
 * 총은 저격 소총 > 소총 > 권총. 방패수는 교전·봉쇄·이동 때 방패를 앞세운다. 테이저를 쏜 직후 1초는 테이저를 겨눈다.
 */
function agentPose(sim: Sim, s: Scene, a: FieldAgent, moving: boolean): { arms: ArmPose; item: Item } {
  const tk = a.task ? a.task.kind : 'standby';
  const rid = a.rid;
  const gun: Item = hasKit(sim, rid, 'sniper') ? 'sniper' : hasKit(sim, rid, 'rifle') ? 'rifle' : 'pistol';
  // 문을 여는 도구: 파괴 장비면 공성추, 할리건·도끼 묶음이면 할리건, 그 밖에는 도끼
  const opener: Item = hasKit(sim, rid, 'breachKit') ? 'ram' : hasKit(sim, rid, 'irons') ? 'halligan' : 'axe';
  if (a.carrying >= 0 || a.carrying <= -2) return { arms: 'drag', item: 'none' };
  if (sim.t - (a.taserAt ?? -99) < 1) return { arms: 'aim', item: 'taser' };
  // (G5) 길 위의 잠긴 문을 강제로 여는 중(하위 작업): 도구를 든다
  if (a.task && a.task.sub && a.task.sub.kind === 'force' && !moving) return { arms: 'work', item: opener };
  const shield = hasKit(sim, rid, 'shield');
  if (tk === 'engage' || tk === 'perimeter') return { arms: 'aim', item: shield ? 'shield' : gun };
  if (tk === 'suppress' || (tk === 'overhaul' && !moving)) return { arms: 'hose', item: 'none' };
  // 연기 속에서 수색하거나 움직이는 동안 열화상 카메라를 든 대원은 그것을 들여다본다
  if ((moving || tk === 'search') && hasKit(sim, rid, 'tic') && s.smoke[Math.round(a.y) * s.w + Math.round(a.x)] > 0.3) return { arms: 'megaphone', item: 'tic' };
  if (moving) return shield && s.kind === 'armed' ? { arms: 'aim', item: 'shield' } : { arms: 'side', item: 'none' };
  const busy = a.ring > 0.01;
  switch (tk) {
    case 'treat': {
      // 처치: 제세동기를 쓸 환자(심정지·건강 25 미만)면 주황 상자, 전문 응급 가방·의사 장비면 큰 빨간 가방, 그 밖에는 작은 구급 상자
      const c = a.task && a.task.cas >= 0 ? s.casualties[a.task.cas] : undefined;
      const shock = !!c && hasKit(sim, rid, 'aed') && ((s.kind === 'medical' && s.variant === 'arrest') || c.health < 25);
      return { arms: busy ? 'kneel' : 'side', item: !busy ? 'none' : shock ? 'aed' : hasKit(sim, rid, 'alsBag') || hasKit(sim, rid, 'doctorKit') ? 'bigbag' : 'none' };
    }
    case 'rescueMate': case 'carry': case 'load': return { arms: busy ? 'kneel' : 'side', item: 'none' };
    case 'force': return { arms: busy ? 'work' : 'side', item: busy ? opener : 'none' };
    case 'clear': case 'clearRoad': return { arms: busy ? 'work' : 'side', item: hasKit(sim, rid, 'irons') ? 'halligan' : 'axe' };
    case 'extricate': return { arms: busy ? 'work' : 'side', item: hasKit(sim, rid, 'spreader') ? 'spreader' : hasKit(sim, rid, 'irons') ? 'halligan' : 'none' };      // 유압 구조기는 든 사람만 — 없으면 할리건이나 맨손
    case 'traffic': return { arms: 'baton', item: 'none' };
    case 'negotiate': return { arms: 'megaphone', item: 'none' };
    case 'arrest': return { arms: busy ? 'work' : 'aim', item: busy ? 'none' : gun };
    case 'hookup': case 'mitigate': case 'swapAir': return { arms: busy ? 'work' : 'side', item: 'none' };
    default: return { arms: 'side', item: 'none' };
  }
}

/** 옮기는 사람이나 곁(2칸 안)에서 같은 이송을 돕는 사람이 들것을 가졌는가 (실행기의 판정과 같다 — 들것이 있을 때만 들것을 그린다) */
function hasLitter(sim: Sim, s: Scene, carrier: FieldAgent): boolean {
  if (hasKit(sim, carrier.rid, 'stretcher')) return true;
  const t = carrier.task;
  if (t) for (const b of s.agents) if (b !== carrier && b.status === 'active' && b.task && b.task.kind === t.kind && b.task.workId === t.workId && Math.hypot(b.x - carrier.x, b.y - carrier.y) < 2 && hasKit(sim, b.rid, 'stretcher')) return true;
  return false;
}

// ── 상공의 헬기 (R1) ──
/** 떠 있는 높이: 몸체를 이만큼(칸) 왼쪽 위로 올려 그린다. 그림자가 땅 위의 제 자리(AirOp.x, y)에 떨어진다 */
const ALT_X = 0.77, ALT_Y = 0.92;
const airHeading = new WeakMap<AirOp, number>();
/** 몸체 가운데가 이 줄(칸)보다 위로 올라가지 않는다 — 현장 맨 위쪽에 뜬 헬기가 화면 위의 덧글 밑으로 들어가지 않게 높이를 줄인다 */
const AIR_TOP = 0.2;
/** 두 헬기의 몸체 사이에 두는 거리(칸) */
const AIR_SEP = 3.0;
/** 화면 위쪽의 덧글(시점·사건 제목 두 줄)이 가리는 높이(화소) — 그 밑에 들어갈 상공 헬기의 이름표는 몸체 아래에 단다 */
const TOP_UI = 104;
type AirDraw = { op: AirOp; u: Unit; gx: number; gy: number; bx: number; by: number; lift: number };
/** 헬기마다 지금 그린 자리(칸)와 비켜 그린 정도 — 그림만의 상태다(시뮬레이션의 AirOp 는 고치지 않는다). 누르기(hitScene)가 같은 자리를 쓴다 */
const airDrawn = new WeakMap<AirOp, { dx: number; dy: number; at: number; bx: number; by: number }>();
/**
 * 가까이 뜬 헬기의 몸체가 겹치지 않게 한 대를 옆으로 비켜 그린다.
 * 일하는 헬기(호이스트·물 투하)는 제자리, 살피는 헬기가 비킨다(같으면 번호가 큰 쪽). 그림자도 함께 옮긴다.
 * 갑자기 튀지 않게 실제 시간으로 따라간다.
 */
function spreadAirs(airs: AirDraw[], ts: number, timeMs: number): void {
  const order = airs.length > 1 ? airs.slice().sort((a, b) => (a.op.mode === 'watch' ? 1 : 0) - (b.op.mode === 'watch' ? 1 : 0) || a.u.id - b.u.id) : airs;
  for (let i = 0; i < order.length; i++) {
    const A = order[i];
    let wx = 0, wy = 0;
    for (let j = 0; j < i; j++) {
      const P = order[j];
      const vx = (A.bx - P.bx) / ts + wx, vy = (A.by - P.by) / ts + wy, d = Math.hypot(vx, vy);
      if (d >= AIR_SEP) continue;
      const ux = d > 0.05 ? vx / d : 0.8, uy = d > 0.05 ? vy / d : 0.6;
      wx += ux * (AIR_SEP - d); wy += uy * (AIR_SEP - d);
    }
    let m = airDrawn.get(A.op);
    if (!m) { m = { dx: wx, dy: wy, at: timeMs, bx: 0, by: 0 }; airDrawn.set(A.op, m); }
    else { const k = 1 - Math.exp(-Math.max(0, Math.min(200, timeMs - m.at)) / 160); m.dx += (wx - m.dx) * k; m.dy += (wy - m.dy) * k; m.at = timeMs; }
    if (m.dx || m.dy) {
      const sy = Math.max(m.dy * ts, (AIR_TOP + 0.5) * ts - A.by);      // 비켜도 현장 위쪽 밖으로는 나가지 않는다
      A.bx += m.dx * ts; A.gx += m.dx * ts; A.by += sy; A.gy += sy;
    }
    m.bx = A.bx / ts - 0.5; m.by = A.by / ts - 0.5;
  }
}
type SceneLabel = { x: number; y: number; text: string; col: string };
/** 이름표가 피해 가는 고정 글자의 자리 (가운데 x·y, 너비·높이 — 화소) */
type LabelBox = { x: number; y: number; w: number; h: number };
/**
 * 같은 글자의 이름표가 겹치면 하나로 모은다 (대기 지점에 여럿이 모이면 "대기"가 겹겹이 쌓여 읽을 수 없다).
 * 자리는 모인 것들의 가운데·맨 위. 분야가 섞였으면 글자색을 중립색으로 쓴다(이름표의 색 = 분야).
 */
function mergeLabels(ctx: G, labels: SceneLabel[], fs: number, ts: number, pinned: readonly LabelBox[] = []): SceneLabel[] {
  if (MINI || (labels.length < 2 && !pinned.length)) return labels;
  ctx.font = `600 ${fs}px ${FONT}`;
  type M = SceneLabel & { w: number; n: number };
  let out: M[] = labels.map((l) => ({ x: l.x, y: l.y, text: l.text, col: l.col, w: ctx.measureText(l.text).width + fs * 0.8, n: 1 }));
  const near = ts * 0.45;      // 겹치지 않아도 바로 곁(반 칸)의 같은 이름표는 한 무리로 본다
  for (let pass = 0; pass < 4; pass++) {      // 모으면 자리가 옮겨져 새로 겹칠 수 있다 — 몇 번 되풀이한다
    const next: M[] = [];
    let merged = false;
    for (const l of out) {
      let hit: M | null = null;
      for (const q of next) if (q.text === l.text && Math.abs(q.x - l.x) < (q.w + l.w) / 2 + near && Math.abs(q.y - l.y) < fs * 1.5 + near) { hit = q; break; }
      if (hit) { hit.x = (hit.x * hit.n + l.x * l.n) / (hit.n + l.n); hit.y = Math.min(hit.y, l.y); hit.n += l.n; if (hit.col !== l.col) hit.col = '#d6e2ee'; merged = true; }
      else next.push(l);
    }
    out = next;
    if (!merged) break;
  }
  // 글자가 다른 이름표끼리 겹치면 뒤의 것을 한 줄 위로 올린다 (많아야 두 줄).
  // (H1 단계 7) 먼저 그려진 고정 글자(용의자의 상태 알약)도 피한다 — 쓰러진 용의자를 처치하는 대원의 이름표가 그 알약을 덮어 둘 다 읽히지 않았다
  for (let i = 0; i < out.length; i++) {
    const l = out[i];
    for (let up = 0; up < 2; up++) {
      let clash = false;
      for (let j = 0; j < i; j++) { const q = out[j]; if (Math.abs(q.x - l.x) < (q.w + l.w) / 2 && Math.abs(q.y - l.y) < fs * 1.5) { clash = true; break; } }
      if (!clash) for (const p of pinned) if (Math.abs(p.x - l.x) < (p.w + l.w) / 2 && Math.abs(p.y - l.y) < (p.h + fs * 1.5) / 2) { clash = true; break; }
      if (!clash) break;
      l.y -= fs * 1.6;
    }
  }
  return out;
}
/** 상공 작업의 할 일을 사람이 읽는 말로 (현장의 이름표와 대원 정보창이 함께 쓴다) */
export function airOpLabel(s: Scene, op: AirOp): string {
  if (op.phase === 'away') return '물 뜨러 감';
  if (op.mode === 'hoist') return op.phase === 'work' ? '호이스트 인양 중' : '인양 위치로 이동';
  if (op.mode === 'bucket') return '공중 물 투하';
  return s.light ? '상공 감시 · 탐조등' : '상공 감시';
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
  const book = o.book;
  // (G5) 교전 그림: 연출 기억(book)이 있으면 combat.ts 가 연출 시계로 그린다. 없으면(시험·옛 호출) 효과 기록을 시뮬레이션 나이로 그린다
  const cv: CombatView | null = book ? { g: ctx, sim, s, book, ts, alpha: o.alpha, mini: MINI, truth: o.truth, reduced: reducedMotion(), H: h, time } : null;
  const view: FxView = { cx: (w / 2 - L.ox) / ts - 0.5, cy: (h / 2 - L.oy) / ts - 0.5, hw: w / 2 / ts, hh: h / 2 / ts };
  let cms = 0;
  const timed = (fn: () => void): void => { if (MINI) { fn(); return; } const t0 = performance.now(); fn(); cms += performance.now() - t0; };
  /** 효과 기록과 그 나이(시뮬레이션 초). 연출 기억이 있으면 G5 가 그리는 종류는 빼고(combat.ts 가 그린다) 나머지만 */
  const fxAges = (): [Fx, number][] => { const out: [Fx, number][] = []; for (const f of s.fx) if (!book || !FX_DRAWN.has(f.kind)) out.push([f, sim.t - f.t]); return out; };

  ctx.save();
  ctx.fillStyle = BG; ctx.fillRect(0, 0, w, h);
  ctx.translate(L.ox, L.oy);
  // 흔들림 (칸 단위 → 화소, 한 번의 translate): G4 무너짐·지진 몫 + G5 폭발 몫(동작 줄이기·작은 창이면 없음)
  const sh = sceneShake(sim, s, MINI, cv && !cv.reduced ? cv.book.shake(s.id, ts, view) : undefined, cv ? cv.reduced : reducedMotion(), o.alpha); if (sh.x || sh.y) ctx.translate(sh.x * ts, sh.y * ts);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(layer.base, 0, 0, W, H);

  // ── 바닥 흔적: 그을음, 젖은 바닥 ──
  drawScorch(ctx, s, ts);
  drawBlastScars(ctx, s, ts, MINI);      // (G4) 터진 폭발물·불붙은 밸브의 바닥 자국
  for (let i = 0; i < s.wet.length; i++) {
    const v = s.wet[i]; if (v <= 0.25 || s.burned[i]) continue;
    const x = cx(i % s.w), y = cy((i / s.w) | 0);
    oval(ctx, x, y, ts * 0.66, ts * 0.56, `rgba(110,170,225,${Math.min(0.2, v * 0.2)})`, hash2(i, 3) * 3);
    if (!MINI) oval(ctx, x - ts * 0.12, y - ts * 0.1, ts * 0.2, ts * 0.07, `rgba(230,245,255,${Math.min(0.16, v * 0.14)})`, 0.5);
  }
  if (cv) timed(() => drawCombatDecals(cv));      // (G5) 남는 그림: 탄흔·그을음·빈 깡통
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

  if (cv) timed(() => drawAimLines(cv));      // (G5) 겨누는 선, 확성기 파동, 인질 끌기 화살

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
      const open = doorOpenness(p, o.timeMs, book ? book.doorKick(s.id, p.id) : null);
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
        // 맥박 고리는 AI 시점에서만 (관찰자 시점은 정보 표지 단계의 진행 고리 — scene/hazardFx.ts)
        if (!o.truth) { ctx.strokeStyle = `rgba(255,${Math.round(200 - 110 * lk)},80,${0.35 + 0.45 * pr})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx(p.x), cy(p.y), ts * (0.52 + 0.07 * pr), 0, 7); ctx.stroke(); }
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
  const parked = sim.units.filter((u) => u.incidentId === s.incidentId && u.state === 'onscene' && !isHovering(u, s));      // 상공에 머무는 헬기는 줄에 서지 않는다 (아래 '상공의 헬기')
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
  // 가스가 찬 칸은 연두 덩어리로, 불 연기·먼지는 회색으로 (G4 — hazardState.gasView: 가스 누출 현장은 연기 칸 전부, 그 밖은 새는 밸브가 설명하는 칸)
  const gv = gasView(s, sim.tick);
  const smoke = MINI ? null : smokeLayer(s, ts, time, gv.gas);
  if (MINI) drawSmoke(ctx, s, ts, time, gv.gas); else if (smoke) ctx.drawImage(smoke, 0, 0, W, H);

  // ── 사람: 구조 대상 → 용의자 → 대원 ──
  const carrierOf = new Map<number, FieldAgent>();
  for (const a of s.agents) if (a.carrying >= 0 && a.status !== 'left') carrierOf.set(a.carrying, a);
  const chips: { x: number; y: number; c: Casualty; known: boolean; b: number }[] = [];
  for (const c of s.casualties) {
    if (!casDrawn(c)) continue;      // 차에 실렸거나 병원에 갔거나, 물살에 현장 밖으로 떠내려간 사람(c.lost)은 그리지 않는다
    const known = c.tDiscovered >= 0;
    if (!known && !o.truth) continue;
    const p = ipos(c, o.alpha);
    const x = cx(p.x), y = cy(p.y);
    const b = casBand(c);
    chips.push({ x, y, c, known, b });
    if (MINI) { rr(ctx, x - ts * 0.3, y - ts * 0.3, ts * 0.6, ts * 0.6, ts * 0.15, BAND_COLOR[b]); if (b === 3) { ctx.strokeStyle = TRIAGE_EDGE[3]; ctx.lineWidth = 1; ctx.strokeRect(x - ts * 0.3 + 0.5, y - ts * 0.3 + 0.5, ts * 0.6 - 1, ts * 0.6 - 1); } continue; }
    if (c.inVehicle !== null && c.where === 'scene') continue;             // 차 안에 있다: 표지만 보인다
    const lk = lookOf('c' + s.id + ':' + c.id, () => civilianLook(s.id * 977 + c.id * 31 + 1));
    const ghost = known ? 1 : 0.45;
    const carrier = carrierOf.get(c.id);
    if (b === 2 && !c.dead) { ctx.strokeStyle = `rgba(255,93,93,${0.25 + 0.3 * Math.abs(Math.sin(time * 4))})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, ts * (0.46 + 0.08 * Math.abs(Math.sin(time * 4))), 0, 7); ctx.stroke(); }
    // (G4) 인질의 상태: 붙잡힘(빨강) · 구출 기회(노랑 깜박임)는 발밑 고리. 자세는 겉모습이라 늘 따른다. AI 시점은 그 용의자가 보일 때만 고리
    const hs = c.hostage ? hostageState(sim, s, c) : null;
    const captive = !!hs && hs.state !== 'freed';
    if (hs && (hs.state === 'held' || hs.state === 'window') && (o.truth || (hs.by >= 0 && !s.hostiles[hs.by].hidden))) {
      const win = hs.state === 'window';
      ctx.strokeStyle = win ? alpha('#ffd166', 0.45 + 0.5 * Math.abs(Math.sin(time * 6))) : 'rgba(255,93,93,0.85)'; ctx.lineWidth = Math.max(1.5, ts * 0.06);
      ctx.beginPath(); ctx.ellipse(x, y + ts * 0.12, ts * 0.4, ts * 0.3, 0, 0, 7); ctx.stroke();
    }
    if (c.inWater && !c.dead) { drawSwimmer(ctx, x, y, ts, lk, time + c.id, ghost); continue; }
    const upright = !c.dead && c.mob === 'mobile' && c.where !== 'carried' && c.health > 40;
    if (upright) {
      const mv = Math.abs(c.x - c.px) + Math.abs(c.y - c.py) > 0.005;
      const ang = mv ? Math.atan2(c.y - c.py, c.x - c.px) : hash2(c.id, s.id + 3) * 6.28;
      drawPerson(ctx, x, y, ang, ts, lk, { step: time * 10 + c.id, moving: mv, arms: captive ? 'back' : c.panic && mv ? 'up' : 'side', t: time, scale: captive ? 0.9 : 0.96, ghost, flinch: cv ? casualtyFlinch(cv, c.id, c.x, c.y) : undefined });
    } else {
      const ang = carrier ? Math.atan2(carrier.fy, carrier.fx) : hash2(c.id * 7, s.id) * 6.28;
      drawLying(ctx, x, y, ang, ts, lk, { variant: hash2(c.id, 5), sheet: casSheet(c), stretcher: c.where === 'carried' && !!carrier && hasLitter(sim, s, carrier), bandage: c.treated && !c.dead, ghost });      // 들것은 가진 사람이 옮길 때만 (없으면 끌어서 옮긴다). 덮개는 확인된(발견된) 사망부터 (H1)
      if (c.mob === 'trapped' && !c.dead && c.where === 'scene') {
        // 깔려 있다: 다리 쪽에 잔해
        ctx.save(); ctx.translate(x - Math.cos(ang) * ts * 0.3, y - Math.sin(ang) * ts * 0.3); ctx.scale(ts * 0.62, ts * 0.62); ctx.globalAlpha = ghost; drawDebris(ctx, c.id + 50); ctx.restore();
      }
    }
  }
  const hosChips: { x: number; y: number; b: number; cross: boolean; hidden: boolean }[] = [];      // (H1) 다친·쓰러진 용의자의 딱지
  for (const hst of s.hostiles) {
    if (!hostileDrawn(hst)) continue;      // 달아났거나 차에 실려 간 용의자는 그리지 않는다
    if (hst.hidden && !o.truth) continue;
    const p = ipos(hst, o.alpha);
    const x = cx(p.x), y = cy(p.y);
    const col = hst.state === 'fight' ? '#ff3355' : hst.state === 'flee' ? '#ff9f43' : hst.state === 'surrendered' ? '#ffd166' : hst.state === 'arrested' ? '#8b97a3' : hst.state === 'down' ? '#59626d' : '#e0486b';
    // (H1) 누운 용의자: 쓰러졌거나(검거된 채 쓰러진 것 포함) 숨졌다. 덮개는 확인된 사망부터 — 그 전까지 숨진 용의자는 위중(빨강)으로 보인다
    const hLying = hst.state === 'down' || hst.dead === true || hst.tDown !== undefined, hSheet = hostileSheet(sim, hst, o.truth, cmd);
    { const hb = hSheet ? 3 : Math.min(2, hostileBand(hst)); if (hLying || hb >= 1) hosChips.push({ x, y, b: hb, cross: (hst.treatQ ?? 0) > 0 && !hSheet, hidden: hst.hidden }); }
    const stunned = sim.t < hst.stunUntil;
    ctx.globalAlpha = hst.hidden ? 0.5 : 1;
    if (MINI) { ctx.fillStyle = col; ctx.beginPath(); ctx.moveTo(x, y - ts * 0.4); ctx.lineTo(x + ts * 0.38, y + ts * 0.32); ctx.lineTo(x - ts * 0.38, y + ts * 0.32); ctx.closePath(); ctx.fill(); ctx.globalAlpha = 1; continue; }
    if (hst.hostageId >= 0 && (hst.state === 'hold' || hst.state === 'fight')) {
      // 용의자 → 짝인 인질 점선: 색은 그 인질의 상태 (G4 — 붙잡힘 빨강 · 구출 기회 노랑 점점선 · 지켜봄 주황, 풀려났거나 혼자 갇힌 인질에게는 긋지 않는다)
      const hc = s.casualties[hst.hostageId], st = hc.hostage ? hostageState(sim, s, hc).state : 'held';
      if (st === 'held' || st === 'window' || st === 'guarded') {
        ctx.strokeStyle = st === 'held' ? 'rgba(255,93,93,0.8)' : st === 'window' ? alpha('#ffd166', 0.45 + 0.5 * Math.abs(Math.sin(time * 6))) : alpha('#ff9f43', 0.8);
        ctx.lineWidth = 1.5; ctx.setLineDash(st === 'window' ? [1.5, 3] : [3, 3]);
        ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(cx(hc.x), cy(hc.y)); ctx.stroke(); ctx.setLineDash([]);
      }
    }
    // 발밑 표지: 위협 대상임을 한눈에
    ctx.fillStyle = alpha(col, 0.16); ctx.strokeStyle = alpha(col, hst.state === 'fight' ? 0.5 + 0.4 * Math.abs(Math.sin(time * 6)) : 0.7); ctx.lineWidth = Math.max(1.5, ts * 0.05);
    ctx.beginPath(); ctx.arc(x, y, ts * (hst.state === 'fight' ? 0.47 + 0.05 * Math.abs(Math.sin(time * 6)) : 0.45), 0, 7); ctx.fill(); ctx.stroke();
    const lk = lookOf('h' + s.id + ':' + hst.id, () => hostileLook(s.id * 53 + hst.id * 7));
    if (hLying) {
      // 옮겨지는 중(그 틱에 자리가 바뀌었다)이면 옮기는 대원 쪽으로 눕히고, 그 대원이나 곁의 대원이 들것을 가졌으면 들것 위에 (구조 대상과 같은 규칙)
      const moved = Math.abs(hst.x - hst.px) + Math.abs(hst.y - hst.py) > 0.005;
      let mover: FieldAgent | undefined;
      if (moved) { let bd = 1.4; for (const a of s.agents) { if (a.status !== 'active') continue; const d = Math.hypot(a.x - hst.x, a.y - hst.y); if (d < bd) { bd = d; mover = a; } } }
      drawLying(ctx, x, y, mover ? Math.atan2(mover.fy, mover.fx) : hash2(hst.id, s.id) * 6.28, ts, lk, { variant: hash2(hst.id, 9), sheet: hSheet, stretcher: !!mover && hasLitter(sim, s, mover), bandage: (hst.treatQ ?? 0) > 0 && !hSheet });
    } else {
      const mv = Math.abs(hst.x - hst.px) + Math.abs(hst.y - hst.py) > 0.005;
      const ang = hst.state === 'flee' && mv ? Math.atan2(hst.y - hst.py, hst.x - hst.px) : hst.facing;
      const armed = hst.weapon !== 'none';
      const hurt = hurtPose(hst.health, 60);      // (H1) 다친 자세: 체력 60 아래부터 (사기·속도가 떨어지는 문턱과 같다)
      const arms0: ArmPose = hst.state === 'surrendered' ? 'up' : hst.state === 'arrested' ? 'back' : stunned ? 'side' : (hst.state === 'hold' || hst.state === 'fight') && armed ? 'aim' : 'side';
      const arms: ArmPose = hurt > 0 && arms0 === 'side' ? 'clutch' : arms0;
      const hf = cv ? hostileFx(cv, hst) : null;
      const off = hf ? { x: (hf.flinch?.x ?? 0) + (hf.lunge?.x ?? 0) + (hf.jitter?.x ?? 0), y: (hf.flinch?.y ?? 0) + (hf.lunge?.y ?? 0) + (hf.jitter?.y ?? 0) } : undefined;
      drawPerson(ctx, x, y, ang, ts, lk, { step: time * 12 + hst.id, moving: mv, arms, item: hst.weapon === 'gun' ? 'pistol' : hst.weapon === 'knife' ? 'knife' : 'none', t: time, scale: hst.state === 'arrested' ? 0.9 : 1, cuffed: hst.state === 'arrested', recoil: hf?.recoil, flinch: off && (off.x || off.y) ? off : undefined, hurt: hurt > 0 ? hurt : undefined });
    }
    const mark = stunned && cv ? stunMark(cv, hst) : 'dots';
    if (stunned && mark === 'star') drawStunStars(ctx, x, y, ts, time, Math.min(1, (hst.stunUntil - sim.t) / 1.2 + 0.25));
    else if (stunned && mark === 'dots') for (let k = 0; k < 4; k++) { const an = time * 5 + k * 1.57; ctx.fillStyle = '#fff3b0'; const sz = Math.max(2, ts * 0.08); ctx.fillRect(x + Math.cos(an) * ts * 0.34 - sz / 2, y - ts * 0.1 + Math.sin(an) * ts * 0.2 - sz / 2, sz, sz); }
    ctx.globalAlpha = 1;
  }
  const labels: { x: number; y: number; text: string; col: string }[] = [];
  const respChips: { x: number; y: number; b: number; cross: boolean }[] = [];      // (H1) 다친 대원의 딱지
  const draggerOf = new Map<number, FieldAgent>();      // (H1) 쓰러진 대원 rid → 그 대원을 끌고 가는 동료 (carrying = -(rid+2))
  for (const a of s.agents) if (a.carrying <= -2 && a.status !== 'left') draggerOf.set(-a.carrying - 2, a);
  for (const a of s.agents) {
    if (a.status === 'left') continue;
    const p = ipos(a, o.alpha);
    const moving = Math.abs(a.x - a.px) + Math.abs(a.y - a.py) > 0.01 && a.status === 'active';
    const x = cx(p.x), y = cy(p.y);
    const rsp = sim.responders[a.rid], u = sim.units[a.unitId];
    const col = DEPT_COLOR[rsp.dept];
    const sel = a.rid === o.selectedRid;
    if (MINI) {
      disc(ctx, x, y, ts * 0.46, '#0b1219'); disc(ctx, x, y, ts * 0.34, respLying(a, rsp) ? '#59626d' : col);
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
    // (H1) 물러난 다친 대원을 흐리게 그리지 않는다 — 자세(눕거나 앉음)와 딱지로 읽힌다
    const lying = respLying(a, rsp), shroud = lying && respSheet(sim, rsp, o.truth, cmd);
    { const rb = shroud ? 3 : Math.min(2, respBand(rsp)); if (rb >= 1 || lying) respChips.push({ x, y, b: Math.max(1, rb), cross: (rsp.treatQ ?? 0) > 0 && !shroud }); }
    // 발밑 표지: 소속 색
    const fl = Math.hypot(a.fx, a.fy) || 1, ang = Math.atan2(a.fy / fl, a.fx / fl);
    if (sim.t - a.underFireT < 1.2) disc(ctx, x, y, ts * 0.6, 'rgba(255,70,70,0.3)');
    const af = cv && a.status !== 'down' ? agentFx(cv, a) : null;
    if (af && af.glow) drawBreachGlow(ctx, x, y, ts, af.glow);
    if (cv && a.inCover && s.kind === 'armed' && a.status === 'active') drawCoverBand(cv, a, x, y);
    ctx.fillStyle = alpha(col, 0.14); ctx.strokeStyle = sel ? '#ffffff' : alpha(col, 0.85); ctx.lineWidth = sel ? Math.max(2, ts * 0.08) : Math.max(1.5, ts * 0.05);
    ctx.beginPath(); ctx.arc(x, y, ts * 0.44, 0, 7); ctx.fill(); ctx.stroke();
    if (a.isCommander) { ctx.strokeStyle = '#ffd166'; ctx.lineWidth = Math.max(1.5, ts * 0.05); ctx.setLineDash([ts * 0.14, ts * 0.1]); ctx.beginPath(); ctx.arc(x, y, ts * 0.54, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    const lk = lookOf('a' + a.rid + ':' + u.kind + ':' + (rsp.role ?? ''), () => responderLook(rsp.dept, u.kind, a.rid * 13 + 7, rsp.role));
    if (lying) {
      // (H1) 쓰러진 대원, 쓰러졌다가 안전 구역으로 옮겨진 대원(예전에는 다시 서 있게 그려졌다). 동료가 끌고 가는 중이면 그쪽으로 눕히고, 들것을 가졌으면 들것 위에
      const dragger = draggerOf.get(a.rid);
      drawLying(ctx, x, y, dragger ? Math.atan2(dragger.fy, dragger.fx) : hash2(a.rid, 77) * 6.28, ts, lk, { variant: hash2(a.rid, 5), sheet: shroud, stretcher: !!dragger && hasLitter(sim, s, dragger), bandage: (rsp.treatQ ?? 0) > 0 && !shroud });
      // 아직 구조되지 못한 쓰러진 대원: 빨간 맥박 고리 (숨졌으면 없다)
      if (a.status === 'down' && !rsp.dead) { ctx.strokeStyle = `rgba(255,93,93,${0.5 + 0.4 * Math.abs(Math.sin(time * 4))})`; ctx.lineWidth = 2.5; ctx.beginPath(); ctx.arc(x, y, ts * 0.56, 0, 7); ctx.stroke(); }
    } else {
      const pose = agentPose(sim, s, a, moving);
      if (af && af.throwAct !== undefined) { pose.arms = 'throw'; pose.item = 'none'; }
      else if (af && af.ram) { pose.arms = 'work'; pose.item = 'ram'; }
      else if (af && af.irons) { pose.arms = 'work'; pose.item = 'halligan'; }
      const off = af ? { x: (af.flinch?.x ?? 0) + (af.jitter?.x ?? 0), y: (af.flinch?.y ?? 0) + (af.jitter?.y ?? 0) } : undefined;
      // (H1) 다친 자세: 중상(체력 70 이하)부터 걸음이 줄고 몸이 기운다. 손이 비었으면 옆구리를 붙들고, 대기 지점으로 물러난 대원은 앉는다
      const hurt = hurtPose(rsp.health, 70), sit = a.status === 'withdrawn';
      if (hurt > 0 && (pose.arms === 'side' || sit)) { pose.arms = 'clutch'; pose.item = 'none'; }
      drawPerson(ctx, x, y, ang, ts, lk, { step: time * 11 + a.rid, moving, arms: pose.arms, item: pose.item, t: time + a.rid * 0.37, recoil: af?.recoil, act: af?.throwAct, crouch: sit || (a.inCover && s.kind === 'armed' && !moving && pose.arms === 'aim'), flinch: off && (off.x || off.y) ? off : undefined, hurt: hurt > 0 ? hurt : undefined });
      if (a.inCover && s.kind === 'armed') drawCoverBadge(ctx, x + ts * 0.36, y + ts * 0.34, ts);      // (G5) 엄폐: 반쪽 벽 기호
      // (R1) 공기 잔량 60초 아래: 머리 위 왼쪽의 작은 주황 점 (깜박이지 않는다)
      if (hasKit(sim, a.rid, 'scba') && kitUses(sim, a.rid, 'scba') < AIR_LOW) { disc(ctx, x - ts * 0.36, y - ts * 0.38, ts * 0.115, '#0b1219'); disc(ctx, x - ts * 0.36, y - ts * 0.38, ts * 0.08, kitUses(sim, a.rid, 'scba') <= 0 ? '#ff5d5d' : '#ff9f43'); }
      if (a.ring > 0.01) {
        ctx.strokeStyle = 'rgba(8,13,18,0.6)'; ctx.lineWidth = Math.max(3, ts * 0.11); ctx.beginPath(); ctx.arc(x, y, ts * 0.62, 0, 7); ctx.stroke();
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, ts * 0.07); ctx.lineCap = 'round'; ctx.beginPath(); ctx.arc(x, y, ts * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, a.ring)); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    if (a.label) labels.push({ x, y: y - ts * 0.82, text: (a.isCommander ? '★ ' : '') + (sel ? rsp.name + ' · ' : '') + (a.label.length > 13 ? a.label.slice(0, 12) + '…' : a.label), col: a.status === 'down' && !shroud ? '#ff5d5d' : col });
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
  // ── 무너지는 순간의 몸통: 그림자·떨어지는 덩어리·먼지 기둥·가라앉는 먼지·불티 (G4, 빛 없음) ──
  drawFallMoments(ctx, sim, s, ts, o.alpha, MINI);

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

  // ── 상공의 헬기 (R1): 이 사건에 와 있는 부대의 상공 작업만 그린다. 물을 뜨러 간 동안(away)은 현장에 없다 ──
  // 땅 위의 자리(AirOp.x, y)에 그림자가 떨어지고 몸체는 높이만큼 왼쪽 위에 뜬다. 호이스트 줄·물 바구니는 몸체에서 땅 위의 자리로 내려온다
  const airs: AirDraw[] = [];
  if (s.air) for (const op of s.air) {
    const u = sim.units[op.unitId];
    if (u.state !== 'onscene' || u.incidentId !== s.incidentId || op.phase === 'away') continue;
    const tx = op.px + (op.x - op.px) * o.alpha, ty = op.py + (op.y - op.py) * o.alpha;
    const lift = Math.max(0, Math.min(1, (ty - AIR_TOP) / ALT_Y));      // 현장 맨 위쪽에서는 낮게 뜬 것으로 그린다 (몸체가 현장 밖으로 나가지 않게)
    airs.push({ op, u, gx: cx(tx), gy: cy(ty), bx: cx(tx - ALT_X * lift), by: cy(ty - ALT_Y * lift), lift });
  }
  spreadAirs(airs, ts, o.timeMs);
  for (const A of airs) {
    const op = A.op, u = A.u;
    // 기수: 움직이는 쪽을 본다 (멈춰 있으면 마지막으로 보던 쪽)
    const mvx = op.x - op.px, mvy = op.y - op.py;
    let ang = airHeading.get(op) ?? 0;
    if (Math.abs(mvx) + Math.abs(mvy) > 0.02) { ang = Math.atan2(mvy, mvx); airHeading.set(op, ang); }
    if (op.mode === 'hoist' && op.phase === 'work') {
      // 호이스트 줄과 매달린 구조대원: 내려가서(앞 35%) 사람을 붙들고, 끝에(뒤 20%) 함께 올라온다
      const c = op.target >= 0 ? s.casualties[op.target] : undefined;
      const tx = c ? cx(c.px + (c.x - c.px) * o.alpha) : A.gx, ty = c ? cy(c.py + (c.y - c.py) * o.alpha) : A.gy;
      const q = op.need > 0 ? Math.min(1, op.progress / op.need) : 0;
      const along = q < 0.35 ? q / 0.35 : q > 0.8 ? 1 - ((q - 0.8) / 0.2) * 0.75 : 1;
      const hx = A.bx + (tx - A.bx) * along, hy = A.by + (ty - A.by) * along;
      ctx.lineCap = 'round'; ctx.strokeStyle = 'rgba(0,0,0,0.4)'; ctx.lineWidth = Math.max(2, ts * 0.07); ctx.beginPath(); ctx.moveTo(A.bx, A.by); ctx.lineTo(hx, hy); ctx.stroke();
      ctx.strokeStyle = '#e8edf2'; ctx.lineWidth = Math.max(1, ts * 0.035); ctx.stroke();
      if (!MINI) { disc(ctx, hx, hy, ts * 0.2, '#0b1219'); disc(ctx, hx, hy, ts * 0.16, '#d9742a'); disc(ctx, hx, hy, ts * 0.08, '#f2f2ee'); }      // 주황 구조복과 흰 헬멧
      if (!MINI) { ctx.strokeStyle = 'rgba(8,13,18,0.6)'; ctx.lineWidth = Math.max(3, ts * 0.1); ctx.beginPath(); ctx.arc(tx, ty, ts * 0.62, 0, 7); ctx.stroke(); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, ts * 0.06); ctx.beginPath(); ctx.arc(tx, ty, ts * 0.62, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * q); ctx.stroke(); }
    } else if ((u.bucketMax ?? 0) > 0 && op.mode === 'bucket') {
      // 물 바구니: 몸체 밑에 줄로 매달려 흔들린다. 물이 차 있으면 파랗다
      const sw = Math.sin(time * 2.2 + u.id) * ts * 0.14;
      const hang = 0.62 * Math.max(0.4, A.lift);
      const px = A.bx + ALT_X * ts * hang + sw, py = A.by + ALT_Y * ts * hang;
      ctx.lineCap = 'round'; ctx.strokeStyle = '#cfd6dc'; ctx.lineWidth = Math.max(1, ts * 0.03); ctx.beginPath(); ctx.moveTo(A.bx, A.by); ctx.lineTo(px, py); ctx.stroke();
      disc(ctx, px, py, ts * 0.27, '#8f3a14'); disc(ctx, px, py, ts * 0.22, '#f07a2a'); disc(ctx, px, py, ts * 0.15, (u.bucket ?? 0) > 0 ? '#58b6ff' : '#3a2416');
    }
    drawHeli(ctx, A.bx, A.by, ang, ts, true, o.timeMs, u.kind, ALT_X * A.lift);
    const picked = o.selectedRid >= 0 && sim.responders[o.selectedRid] && sim.responders[o.selectedRid].unitId === u.id;
    if (picked && !MINI) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(2, ts * 0.07); ctx.setLineDash([ts * 0.2, ts * 0.14]); ctx.beginPath(); ctx.arc(A.bx, A.by, ts * 1.75, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
  }

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
    // (R1) 상공의 헬기와 탐조등이 비추는 원: 원 안은 환하다
    for (const A of airs) hole(dg, A.bx * k, A.by * k, ts * 2.4 * k, 0.8);
    if (s.light && airs.length) hole(dg, cx(s.light.x) * k, cy(s.light.y) * k, ts * (s.light.r + 0.9) * k, 0.95);
    if (night) for (const l of layer.lamps) hole(dg, cx(l.x) * k, cy(l.y) * k, ts * 3.8 * k, 0.85);
    hole(dg, (s.safe.x + 0.45) * ts * k, (s.safe.y + 0.4) * ts * k, ts * 3 * k, 0.7);
    for (let i = 0; i < s.fire.length; i++) if (s.fire[i] > 0.2) hole(dg, cx(i % s.w) * k, cy((i / s.w) | 0) * k, ts * (1.9 + 2.5 * s.fire[i]) * k, 0.65);
    for (const c of s.cars) hole(dg, (c.x + 0.5 + c.dir * 2.2) * ts * k, cy(c.row) * k, ts * 2.8 * k, 0.75);
    if (cv) drawCombatHoles(cv, dg, k);
    else for (const [f, age] of fxAges()) {
      if (f.kind === 'shot' && age >= 0 && age < 0.25) hole(dg, cx(f.x) * k, cy(f.y) * k, ts * 2.6 * k, 0.8);
      else if ((f.kind === 'flash' || f.kind === 'boom') && age >= 0 && age < f.ttl) hole(dg, cx(f.x) * k, cy(f.y) * k, ts * 6.5 * k, 1 - age / f.ttl);
    }
    // (G4) 무너진 자리의 어둠을 몇 초 옅게 걷는다 — 빛이 아니다 (투명도 0.3 이하). 먼지 기둥이 밤에도 보이게
    for (const f of s.falls ?? []) { const age = (sim.t + o.alpha * sim.dt) - f.t; if (age >= 0 && age < 4) hole(dg, cx(f.x) * k, cy(f.y) * k, ts * f.r * 1.3 * k, 0.3 * (1 - age / 4)); }
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
    // (R1) 헬기의 항법등과 탐조등: 몸체에서 땅 위의 원까지 옅은 원뿔, 원 안의 흰 빛
    for (const A of airs) {
      const on = Math.floor(o.timeMs / 420) % 2 === 0;
      drawLight(ctx, A.bx, A.by, ts * 1.3, on ? '#ff5d5d' : '#7dffb0', 0.35 * nk);
    }
    if (s.light && airs.length) {
      const src = airs.find((A) => A.u.kind === 'policeHeli') ?? airs[0];
      const lx = cx(s.light.x), ly = cy(s.light.y), lr = s.light.r * ts;
      const d = Math.hypot(lx - src.bx, ly - src.by) || 1, ux = (lx - src.bx) / d, uy = (ly - src.by) / d;
      ctx.fillStyle = 'rgba(255,248,214,0.07)'; ctx.beginPath(); ctx.moveTo(src.bx, src.by); ctx.lineTo(lx - uy * lr, ly + ux * lr); ctx.lineTo(lx + uy * lr, ly - ux * lr); ctx.closePath(); ctx.fill();
      drawLight(ctx, lx, ly, lr * 1.15, '#fff6d8', 0.2);
      ctx.strokeStyle = 'rgba(255,246,216,0.28)'; ctx.lineWidth = Math.max(1, ts * 0.04); ctx.beginPath(); ctx.arc(lx, ly, lr, 0, 7); ctx.stroke();
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
    if (cv) timed(() => drawCombatLights(cv));
    else for (const [f, age] of fxAges()) {
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

  // ── 정보 표지 (G4): 어둠·날씨 뒤라 밤과 안개에도 보인다 ──
  if (night && !MINI) { const rz = ruinZones(s); if (rz.count) strokeRuinEdges(ctx, rz, ts, 0.45); }      // 밤에는 고정 층의 붕괴 구역 경계가 어둠에 묻힌다: 같은 선분을 한 번 더
  drawDangerZones(ctx, sim, s, ts, { truth: o.truth, timeMs: o.timeMs, mini: MINI, cmd });
  drawFallRing(ctx, sim, s, ts, o.alpha, MINI);
  const hzLabels: HazardLabel[] = [];
  if (o.truth) for (const l of drawGasEdge(ctx, ts, o.timeMs, gv, MINI)) hzLabels.push(l);      // 짙은 가스 경계 (관찰자 시점)
  for (const l of drawRekindle(ctx, s, ts, o.timeMs, MINI ? [] : rekindledRegions(sim, s, o.truth), o.truth, MINI)) hzLabels.push(l);      // 되살아난 불

  // 지휘관이 정한 진입 지점
  if (!MINI && s.entryOrdered && !s.breachDone) for (const [k, label] of [[s.entryExit, s.entryExit2 >= 0 ? '1조 진입' : '진입 지점'], [s.entryExit2, '2조 진입']] as [number, string][]) {
    if (k < 0 || k >= s.exits.length) continue;
    const e = s.exits[k], x = cx(e.x), y = cy(e.y), pr = 0.5 + 0.5 * Math.sin(time * 5);
    const left = s.breachAt - (sim.t + o.alpha * sim.dt);
    if (cv && left <= 3) { drawCountdown(cv, e.x, e.y, left); continue; }      // (G5) 3-2-1, 신호 대기
    ctx.strokeStyle = `rgba(90,169,255,${0.5 + 0.4 * pr})`; ctx.lineWidth = Math.max(2, ts * 0.07); ctx.setLineDash([ts * 0.2, ts * 0.14]);
    ctx.beginPath(); ctx.arc(x, y, ts * (0.9 + 0.1 * pr), 0, 7); ctx.stroke(); ctx.setLineDash([]);
    pill(ctx, `${label} · ${Math.max(0, Math.ceil(s.breachAt - sim.t))}초`, x, y + ts * (e.y < s.h / 2 ? -1.25 : 1.25), ts * 0.3, '#9fd0ff');
  }

  // ── 구조 대상 표지: 중증도 색 딱지, 상태 막대 ──
  if (!MINI) for (const q of chips) {
    const c = q.c, r = ts * 0.2, x = q.x + ts * 0.36, y = q.y - ts * 0.38;
    ctx.globalAlpha = q.known ? 1 : 0.55;
    triageBadge(ctx, x, y, r, q.b, ts, q.known ? c.label : '?', c.treated && !c.dead, !q.known);      // (H1) 사망은 검정 딱지(밝은 테두리·흰 글씨), 처치를 받았으면 흰 십자
    if (c.mob === 'trapped' && !c.dead && c.where === 'scene') pill(ctx, c.inWater ? (c.drift ? '표류 중' : '물속 — 걸려 있음') : c.inVehicle !== null ? (s.variant === 'plane' ? '동체에 갇힘' : s.variant === 'train' ? '객차에 갇힘' : '차량에 갇힘') : '매몰', q.x, q.y + ts * 0.62, ts * 0.25, c.inWater ? '#9fd8ff' : '#e8f0f7');
    if (!c.dead && (c.where === 'scene' || c.where === 'safe')) {
      const bw = ts * 0.56, bx = q.x - bw / 2, by = q.y + ts * 0.36, bh = Math.max(3, ts * 0.085);
      rr(ctx, bx - 1, by - 1, bw + 2, bh + 2, bh / 2, 'rgba(8,13,18,0.85)');
      rr(ctx, bx, by, Math.max(bh, bw * Math.max(0, c.health / 100)), bh, bh / 2, BAND_COLOR[q.b]);
    }
    ctx.globalAlpha = 1;
  }
  // 용의자 표지
  // (H1) 정보창에 띄운 사람: 흰 점선 고리
  if (!MINI && o.pick) {
    const who = o.pick.kind === 'cas' ? s.casualties[o.pick.id] : s.hostiles[o.pick.id];
    const shown = who && (o.pick.kind === 'cas' ? casDrawn(who as Casualty) && (o.truth || (who as Casualty).tDiscovered >= 0) : hostileDrawn(who as Hostile) && (o.truth || !(who as Hostile).hidden));
    if (who && shown) { const p = ipos(who, o.alpha); ctx.strokeStyle = '#ffffff'; ctx.lineWidth = Math.max(1.5, ts * 0.05); ctx.setLineDash([ts * 0.16, ts * 0.12]); ctx.beginPath(); ctx.arc(cx(p.x), cy(p.y), ts * 0.62, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
  }
  // (H1) 다친 대원과 다친·쓰러진 용의자의 딱지: 구조 대상과 같은 분류 색, 글자 없이 색과 (처치를 받았으면) 흰 십자
  if (!MINI) {
    for (const q of respChips) triageBadge(ctx, q.x + ts * 0.36, q.y - ts * 0.38, ts * 0.13, q.b, ts, '', q.cross);
    for (const q of hosChips) { ctx.globalAlpha = q.hidden ? 0.6 : 1; triageBadge(ctx, q.x - ts * 0.36, q.y - ts * 0.38, ts * 0.13, q.b, ts, '', q.cross); ctx.globalAlpha = 1; }      // 용의자의 딱지는 왼쪽 위 (붙잡힌 인질의 딱지와 겹치지 않게)
  }
  const hosPills: LabelBox[] = [];
  if (!MINI) for (const hst of s.hostiles) {
    if (!hostileDrawn(hst) || (hst.hidden && !o.truth)) continue;
    const p = ipos(hst, o.alpha), x = cx(p.x), y = cy(p.y);
    const col = hst.state === 'fight' ? '#ff3355' : hst.state === 'flee' ? '#ff9f43' : hst.state === 'surrendered' ? '#ffd166' : hst.state === 'arrested' ? '#8b97a3' : hst.state === 'down' ? '#8b97a3' : '#ff7a94';
    const stunned = sim.t < hst.stunUntil;
    // (H1) 쓰러진 용의자는 '쓰러짐', 사망이 확인되면 '사망' (예전에는 둘 다 '제압')
    const stt = hostileSheet(sim, hst, o.truth, cmd) ? '사망' : stunned ? '무력화' : hst.hidden ? '(숨음)' : hst.state === 'hold' ? (hst.hostageId >= 0 ? '인질 대치' : '대치') : hst.state === 'fight' ? '교전' : hst.state === 'flee' ? '도주' : hst.state === 'surrendered' ? '투항' : hst.state === 'arrested' ? (hst.tDown !== undefined ? '검거 · 쓰러짐' : '검거') : '쓰러짐';
    const wp = hst.weapon === 'gun' ? '총' : hst.weapon === 'knife' ? '칼' : '';
    ctx.globalAlpha = hst.hidden ? 0.6 : 1;
    // (H1 단계 7) 곁에 선(쓰러진) 다른 용의자의 알약과 겹치면 한 줄 위로 (많아야 두 줄). 대원 이름표는 이 알약들을 피한다(mergeLabels)
    const hText = `${hst.label}${wp ? '·' + wp : ''} · ${stt}`, hFs = ts * 0.27;
    ctx.font = `600 ${hFs}px ${FONT}`;
    const hBox: LabelBox = { x, y: y - ts * 0.8, w: ctx.measureText(hText).width + hFs * 0.8, h: hFs * 1.5 };
    for (let up = 0; up < 2 && hosPills.some((q) => Math.abs(q.x - hBox.x) < (q.w + hBox.w) / 2 && Math.abs(q.y - hBox.y) < (q.h + hBox.h) / 2); up++) hBox.y -= hFs * 1.6;
    pill(ctx, hText, x, hBox.y, hFs, col);
    hosPills.push(hBox);
    if (hst.state === 'hold' || hst.state === 'fight') {
      const bw = ts * 0.6, bh = Math.max(3, ts * 0.085);
      rr(ctx, x - bw / 2 - 1, y + ts * 0.54 - 1, bw + 2, bh + 2, bh / 2, 'rgba(8,13,18,0.85)');
      rr(ctx, x - bw / 2, y + ts * 0.54, Math.max(bh, bw * Math.max(0, Math.min(1, hst.morale))), bh, bh / 2, '#ffb454');
    }
    ctx.globalAlpha = 1;
  }

  // ── 효과 ──
  if (cv) timed(() => drawCombatFx(cv));
  for (const [f, age] of fxAges()) {
    if (age < 0 || age > f.ttl) continue;
    const k = age / f.ttl;
    // 'collapse'(G4)는 여기서 그리지 않는다: 무너짐은 s.falls 로 그린다(drawFallMoments·drawFallRing). 이 효과는 카메라·자동 감속·소리만 본다
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
      // 피 없이: 짧게 퍼지는 흰 고리와 회색 먼지 몇 점 (G5)
      for (let q = 0; q < 5; q++) { const a = hash2(q, (f.t * 10) | 0) * 6.28, d = ts * (0.15 + 0.4 * k); ctx.fillStyle = `rgba(175,175,170,${0.7 * (1 - k)})`; const sz = Math.max(2, ts * 0.06); ctx.fillRect(x + Math.cos(a) * d, y + Math.sin(a) * d, sz, sz); }
      ctx.strokeStyle = `rgba(255,250,235,${0.8 * (1 - k)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, ts * (0.2 + 0.4 * k), 0, 7); ctx.stroke();
    } else if (f.kind === 'glass') {
      if (!MINI) drawGlassFx(ctx, f, ts, k);
    } else if (f.kind === 'debris') {
      if (!MINI) drawDebrisFx(ctx, s, f, ts, k);
    } else if (f.kind === 'drop') {
      drawDropFx(ctx, f, ts, k, MINI);      // (R1) 헬기의 물 투하: 쏟아지는 물 띠와 물보라
    } else if (f.kind === 'text') {
      ctx.globalAlpha = Math.min(1, (1 - k) * 2);
      pill(ctx, f.text ?? '', cx(f.x), cy(f.y) - ts * (0.5 + 0.9 * k), ts * 0.34, f.color ?? '#ffffff', 'rgba(8,13,18,0.9)');
    }
    ctx.globalAlpha = 1;
  }
  if (cv) timed(() => { drawNegotiation(cv); drawCuffs(cv); });      // (G5) 말풍선, 수갑 기호
  for (const l of hzLabels) pill(ctx, l.text, l.x, l.y, Math.max(10, ts * 0.3), l.color);      // (G4) 새 글자 표지: 가스 고임·되살아난 불
  for (const l of mergeLabels(ctx, labels, Math.max(10, ts * 0.28), ts, hosPills)) pill(ctx, l.text, l.x, l.y, Math.max(10, ts * 0.28), l.col);      // (R1) 같은 이름표가 겹치면 하나로
  // (R1) 상공의 헬기: 호출부호와 하는 일. 두 헬기가 한 자리에 떠 있으면 이름표를 위로 쌓는다(겹쳐 읽히지 않게)
  if (!MINI) {
    const fs = Math.max(10, ts * 0.3), put: { x: number; y: number; w: number }[] = [];
    ctx.font = `600 ${fs}px ${FONT}`;
    const topEdge = TOP_UI - L.oy;      // 이보다 위는 화면 위쪽의 덧글에 가린다 (현장 좌표)
    for (const A of airs) {
      const text = `${A.u.callsign} · ${airOpLabel(s, A.op)}`, w = ctx.measureText(text).width + fs * 0.8;
      let y = A.by - ts * 1.2;
      if (y - fs * 0.8 < topEdge) y = A.by + ts * 1.3;      // 위에 자리가 없으면 몸체 아래에
      for (let pass = 0; pass < 3; pass++) for (const q of put) if (Math.abs(q.x - A.bx) < (q.w + w) / 2 + 4 && Math.abs(q.y - y) < fs * 1.6) y = q.y - fs * 1.7;
      put.push({ x: A.bx, y, w });
      pill(ctx, text, A.bx, y, fs, DEPT_COLOR[A.u.dept]);
    }
  }

  // 지도 가장자리를 배경으로 녹인다
  if (!MINI) {
    const e = ts * 0.5;
    const fade = (x0: number, y0: number, x1: number, y1: number, rx: number, ry: number, rw: number, rh: number): void => { const gr = ctx.createLinearGradient(x0, y0, x1, y1); gr.addColorStop(0, BG); gr.addColorStop(1, 'rgba(7,11,16,0)'); ctx.fillStyle = gr; ctx.fillRect(rx, ry, rw, rh); };
    fade(0, 0, e, 0, -1, -1, e + 1, H + 2); fade(W, 0, W - e, 0, W - e, -1, e + 1, H + 2);
    fade(0, 0, 0, e, -1, -1, W + 2, e + 1); fade(0, H, 0, H - e, -1, H - e, W + 2, e + 1);
  }
  ctx.restore();
  if (!MINI) drawVignette(ctx, w, h);
  if (cv && !MINI) { timed(() => drawScreenVeil(ctx, cv.book, s.id, w, h, view, cv.reduced)); cv.book.drawMs = cms; }      // (G5) 관찰자 흰 막·폭발 주황 막
  void seg;
}

/**
 * 현장 화면에서 누른 자리의 사람: 대원(rid) · 구조 대상(cas) · 용의자(hostile). 없으면 -1.
 * truth 가 false(AI 시점)면 화면에 그려지지 않는 사람(미발견 구조 대상, 숨은 용의자)은 잡히지 않는다 (H1 — 관찰 대상 선택일 뿐이다).
 */
export function hitScene(sim: Sim, s: Scene, w: number, h: number, px: number, py: number, cam?: SceneCam, truth = true): { rid: number; cas: number; hostile: number } {
  const L = sceneLayout(s, w, h, cam);
  const tx = (px - L.ox) / L.ts - 0.5, ty = (py - L.oy) / L.ts - 0.5;
  let rid = -1, bd = 0.75;
  for (const a of s.agents) { if (a.status === 'left') continue; const d = Math.hypot(a.x - tx, a.y - ty); if (d < bd) { bd = d; rid = a.rid; } }
  // (R1) 상공의 헬기를 누르면 그 관측자를 고른다 (지상 대원이 더 가까우면 그 대원). 몸체는 땅 위의 자리보다 왼쪽 위에 떠 있다
  if (rid < 0 && s.air) for (const op of s.air) {
    const u = sim.units[op.unitId];
    if (u.state !== 'onscene' || u.incidentId !== s.incidentId || op.phase === 'away') continue;
    const b = airDrawn.get(op);      // 마지막으로 그린 몸체 자리 (가장자리에서 낮춰 그리거나 옆으로 비켜 그렸을 수 있다)
    if (Math.hypot((b ? b.bx : op.x - ALT_X) - tx, (b ? b.by : op.y - ALT_Y) - ty) < 1.3) rid = op.eye.rid;
  }
  let cas = -1, cd = 0.6;
  for (const c of s.casualties) { if (!casDrawn(c) || (!truth && c.tDiscovered < 0)) continue; const d = Math.hypot(c.x - tx, c.y - ty); if (d < cd) { cd = d; cas = c.id; } }
  let hostile = -1, hd = 0.65;
  for (const q of s.hostiles) { if (!hostileDrawn(q) || (!truth && q.hidden)) continue; const d = Math.hypot(q.x - tx, q.y - ty); if (d < hd) { hd = d; hostile = q.id; } }
  return { rid, cas, hostile };
}

export type { FieldAgent, Hostile };
