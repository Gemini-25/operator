// 도시 관제 화면 렌더러 (Canvas 2D). 시뮬레이션 상태를 읽어 그리기만 한다.
// 지도(도로·건물)는 월드 좌표로, 표식(사건 핀·차량·라벨)은 화면 픽셀 크기로 그려 어떤 배율에서도 읽힌다.

import { drawDisasterScreen, drawDisasterWorld } from './city/disasterLayer';
import { describeTraffic, drawTrafficScreen, drawTrafficWorld, flowOf } from './city/trafficLayer';
import type { Sim } from '../sim/engine';
import { placeAt } from '../sim/city';
import { KIND_NAME } from '../sim/cityPlan';
import type { Facility, Incident, Place, Unit } from '../sim/types';
import { fmtDur } from '../sim/util';
import type { CityCam } from './camera';
import { buildCityStatic, facilityLot } from './city/staticCity';
import type { CityLamp } from './city/staticCity';
import { drawIcon } from './icons';
import { hash2, mix } from './scene/common';
import { drawLight } from './scene/fx';
import { FACILITY_COLOR, FIELD_COLOR, FIELD_TEXT, drawFacilityBadge, drawFugitive, drawToken, placeLabel } from './city/tokens';
import type { Box } from './city/tokens';
import { facilityMarkKey } from './marks';
import { combatPinJitter, drawCombatPin } from './city/combatPin';
import type { FxBook } from './scene/fxBook';

export const DEPT_COLOR: Record<string, string> = { fire: '#ff7a45', ems: '#2fd39a', police: '#5aa9ff' };
export const TYPE_COLOR: Record<string, string> = { fire: '#ff6b3d', traffic: '#ffc24a', search: '#58d68d', armed: '#b98cff', medical: '#ff7eb6', collapse: '#d6a878', hazmat: '#b6e04a', water: '#4fb8ff', unknown: '#9aa7b4' };
export const OUTCOME_COLOR: Record<string, string> = { success: '#5ad17a', partial: '#ffd166', delayed: '#7cc4ff', unresolved: '#b3a0d6', failed: '#ff5d5d' };
export const FONT = "'Pretendard', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif";

const RESP_LIMIT: Record<string, number> = { fire: 95, armed: 95, traffic: 105, search: 125, medical: 80, collapse: 100, hazmat: 100, water: 90, unknown: 100 };

let staticLayer: { c: HTMLCanvasElement; lamps: CityLamp[] } | null = null;
let staticFor: unknown = null;
/** 이 배율부터 대기 중인 부대를 시설 옆에 하나씩 그린다. 그보다 멀면 시설 이름 옆의 숫자로만 보인다. */
const IDLE_ZOOM = 2;
/** 부대 표식(돌)의 기본 반지름 (화면 화소). 배율에 따라 markScale 만큼 커진다 */
const TOKEN_R = 10;
/** 표식 크기 보정: 가까이 볼수록 조금 커진다 */
function markScale(zoom: number): number { return Math.min(1.35, 0.9 + 0.14 * zoom); }
let labelLayer: { c: HTMLCanvasElement; key: string; ready: boolean } | null = null;
/** 부대가 소속된 시설의 이름 (이름표에 대기 부대 수를 붙일 곳). hostSig 는 그 목록의 지문: 편성(난이도의 부대 규모)이 다르면 이름표의 폭과 자리도 달라진다 */
let hostFor: unknown = null, hostNames = new Set<string>(), hostSig = '';
interface FacLabel { f: Facility; x: number; y: number; key: string; col: string; hosts: boolean; tw: number; box: Box }
const widths = new Map<string, number>();
/** 글자 폭 (같은 글자·크기는 한 번만 잰다) */
function textWidth(ctx: CanvasRenderingContext2D, text: string, fs: number): number {
  const k = fs + '|' + text;
  let v = widths.get(k);
  if (v === undefined) { ctx.font = `600 ${fs}px ${FONT}`; v = ctx.measureText(text).width; widths.set(k, v); }
  return v;
}

function h2(x: number, y: number): number { return hash2(x, y); }

export interface Xf { scale: number; ox: number; oy: number }
export function cityXf(sim: Sim, cam: CityCam, w: number, h: number): Xf {
  const fit = Math.min(w / sim.city.w, h / sim.city.h) * 0.98;
  const scale = fit * cam.zoom;
  return { scale, ox: w / 2 - cam.x * scale, oy: h / 2 - cam.y * scale };
}

export interface CityOpts { focus: number; truth: boolean; timeMs: number; alpha: number; selectedUnit: number; mini?: boolean; hover?: { x: number; y: number } | null; book?: FxBook }

/** 지도에 사건을 그릴 위치. AI 시점에서는 관제가 "알고 있는" 위치(틀릴 수 있다)에 그린다. */
export function incidentXY(sim: Sim, I: Incident, truth: boolean): { x: number; y: number } {
  if (!truth && I.locationKnown && I.reportedNode !== I.truth.nodeId) { const n = sim.city.nodes[I.reportedNode]; return { x: n.x, y: n.y }; }
  return { x: I.truth.x, y: I.truth.y };
}

export function incidentShownType(I: Incident, truth: boolean): string {
  if (I.assessment) return I.assessment.type;
  return truth ? I.truth.type : 'unknown';
}

/** 차량이 화면에 그려지는 위치와 방향 (대기 중인 차량은 소속 시설 옆에 나란히 세운다) */
export function unitScreen(sim: Sim, u: Unit, xf: Xf, alpha: number, len: number): { x: number; y: number; angle: number } {
  const city = sim.city;
  if (u.air || u.sea) {
    // 헬기와 구조정은 길 위에 서지 않는다: 실제 위치에, 가는 방향을 보고 그린다
    const x = (u.px + (u.x - u.px) * alpha) * xf.scale + xf.ox, y = (u.py + (u.y - u.py) * alpha) * xf.scale + xf.oy;
    const moving = Math.abs(u.x - u.px) + Math.abs(u.y - u.py) > 0.01;
    return { x, y, angle: moving ? Math.atan2(u.y - u.py, u.x - u.px) : u.sea ? 0 : -0.5 };
  }
  if (u.state === 'available' || u.state === 'oos') {
    const f = city.facilities.find((q) => q.name === u.homeName);
    if (!f) { const n = city.nodes[u.homeNode]; return { x: n.x * xf.scale + xf.ox, y: n.y * xf.scale + xf.oy, angle: 0 }; }      // 인근 도시 지원 부대: 도시 가장자리
    let k = 0; for (const q of sim.units) { if (q.id === u.id) break; if (q.homeName === u.homeName && !q.air && !q.sea && (q.state === 'available' || q.state === 'oos')) k++; }
    return { x: f.x * xf.scale + xf.ox + 16 + len * 0.62 + (k >> 1) * (len + 3), y: f.y * xf.scale + xf.oy + (k & 1) * (len - 1), angle: 0 };      // 두 줄로 세운다 (둥근 돌이 서로 겹치지 않게)
  }
  if (u.state === 'onscene' && u.incidentId !== null) {
    const I = sim.incidents[u.incidentId];
    const k = I.everAssigned.indexOf(u.id);
    if (u.curb) {
      // 건물 앞 길가에 줄지어 선다 (도로 방향으로)
      const n = city.nodes[u.nodeId], dx = (u.curb.x - n.x) / u.curb.len, dy = (u.curb.y - n.y) / u.curb.len;
      const on = I.assigned.filter((q) => sim.units[q].state === 'onscene'), j = on.indexOf(u.id) - (on.length - 1) / 2;
      const side = (I.truth.x - u.curb.x) * -dy + (I.truth.y - u.curb.y) * dx > 0 ? 1 : -1;
      return { x: u.x * xf.scale + xf.ox + dx * j * (len + 4) - dy * side * 4, y: u.y * xf.scale + xf.oy + dy * j * (len + 4) + dx * side * 4, angle: Math.atan2(dy, dx) };
    }
    const a = -Math.PI / 2 + (k - 1) * 0.75;
    return { x: I.truth.x * xf.scale + xf.ox + Math.cos(a) * 40, y: I.truth.y * xf.scale + xf.oy + Math.sin(a) * 40 + 4, angle: 0 };
  }
  const x = (u.px + (u.x - u.px) * alpha) * xf.scale + xf.ox, y = (u.py + (u.y - u.py) * alpha) * xf.scale + xf.oy;
  let angle = 0;
  if (u.curb) { const n = city.nodes[u.nodeId]; angle = Math.atan2(u.curb.y - n.y, u.curb.x - n.x) + (u.parking ? 0 : Math.PI); }
  else if (u.route && u.seg < u.route.edges.length) { const A = city.nodes[u.route.nodes[u.seg]], B = city.nodes[u.route.nodes[u.seg + 1]]; angle = Math.atan2(B.y - A.y, B.x - A.x); }
  return { x, y, angle };
}

function label(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, fs: number, fg: string, bg = 'rgba(8,13,18,0.86)', border?: string): void {
  ctx.font = `600 ${fs}px ${FONT}`;
  const w = ctx.measureText(text).width + fs * 0.9;
  ctx.fillStyle = bg; ctx.beginPath(); ctx.roundRect(x - w / 2, y - fs * 0.78, w, fs * 1.5, fs * 0.45); ctx.fill();
  if (border) { ctx.strokeStyle = border; ctx.lineWidth = 1; ctx.stroke(); }
  ctx.fillStyle = fg; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(text, x, y + 0.5);
}

export function drawCity(ctx: CanvasRenderingContext2D, sim: Sim, cam: CityCam, w: number, h: number, o: CityOpts): void {
  if (!staticLayer || staticFor !== sim) { staticLayer = buildCityStatic(sim); staticFor = sim; }
  const night = sim.weather === 'night';
  const xf = cityXf(sim, cam, w, h);
  const city = sim.city;
  const mini = !!o.mini;
  const zs = mini ? 1 : markScale(cam.zoom);     // 표식 크기 보정
  const sx = (wx: number) => wx * xf.scale + xf.ox, sy = (wy: number) => wy * xf.scale + xf.oy;

  // ── 월드 레이어 ──
  ctx.save();
  ctx.fillStyle = '#060a0f'; ctx.fillRect(0, 0, w, h);
  ctx.translate(xf.ox, xf.oy); ctx.scale(xf.scale, xf.scale);
  ctx.imageSmoothingEnabled = true; ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(staticLayer.c, 0, 0, city.w, city.h);
  ctx.lineCap = 'round';
  // 도로 상태: 혼잡 띠(노랑·주황·빨강), 통제(빨간 점선), 열차와 건널목 차단기 (view/city/trafficLayer.ts)
  drawTrafficWorld(ctx, sim, { timeMs: o.timeMs, scale: xf.scale, truth: o.truth, alpha: o.alpha, mini });
  // 출동 경로
  for (const u of sim.units) {
    if (!u.route || (u.state !== 'enroute' && u.state !== 'transport' && u.state !== 'returning')) continue;
    const px = u.px + (u.x - u.px) * o.alpha, py = u.py + (u.y - u.py) * o.alpha;
    const mine = u.incidentId !== null && u.incidentId === o.focus && u.state !== 'returning';
    ctx.strokeStyle = FIELD_COLOR[u.field ?? 'police']; ctx.globalAlpha = u.state === 'returning' ? 0.12 : mine ? 0.9 : 0.3;
    ctx.lineWidth = (mine ? 3.4 : 2) / Math.max(0.6, xf.scale * 1.4); ctx.setLineDash([10, 9]); ctx.lineDashOffset = -(o.timeMs / 35) % 19;
    ctx.beginPath(); ctx.moveTo(px, py);
    for (let k = u.seg + 1; k < u.route.nodes.length; k++) { const n = city.nodes[u.route.nodes[k]]; ctx.lineTo(n.x, n.y); }
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  drawDisasterWorld(ctx, sim, o.timeMs, xf.scale);
  ctx.restore();

  // ── 날씨 ──
  if (!mini) {
    if (sim.weather === 'night') { ctx.fillStyle = 'rgba(6,10,28,0.12)'; ctx.fillRect(0, 0, w, h); }
    else if (sim.weather === 'fog') { const gr = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.9); gr.addColorStop(0, 'rgba(190,200,210,0.05)'); gr.addColorStop(1, 'rgba(190,200,210,0.2)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h); }
    else if (sim.weather === 'rain') {
      ctx.strokeStyle = 'rgba(170,200,235,0.2)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let k = 0; k < 90; k++) { const x = (h2(k, 1) * w + o.timeMs * 0.12) % w, y = (h2(k, 2) * h + o.timeMs * 0.55 * (0.7 + h2(k, 3) * 0.6)) % h; ctx.moveTo(x, y); ctx.lineTo(x + 3, y + 13); }
      ctx.stroke();
    }
  }
  drawDisasterScreen(ctx, sim, w, h, o.timeMs, mini);

  // ── 화면 레이어: 도로 이름, 건물 이름, 시설, 사건, 차량 ──
  const onScreen = (q: { x: number; y: number; w: number; h: number }): boolean => sx(q.x + q.w) > 0 && sx(q.x) < w && sy(q.y + q.h) > 0 && sy(q.y) < h;
  // 시설 배지와 이름표의 자리. 이름표는 배지의 오른쪽·왼쪽·아래·위 가운데 다른 배지·이름표와 겹치지 않는 첫 자리에 둔다.
  // 시점이 같으면 자리도 같다(대기 부대 수와 무관) — 한 번 그려 두는 건물 이름 층이 이 자리를 피해 그려도 어긋나지 않는다.
  const facs: FacLabel[] = [];
  let facBoxes: Box[] = [];
  if (!mini) {
    if (hostFor !== sim) { hostFor = sim; hostNames = new Set(sim.units.map((u) => u.homeName)); hostSig = [...hostNames].sort().join(','); }
    const bs = 20 * zs, fs = Math.round(11 * zs), lh = fs * 1.55, boxes: Box[] = [];
    for (const f of city.facilities) {
      const lot = facilityLot(f), x = sx(lot.x) - bs * 0.1, y = sy(lot.y) - bs * 0.1;
      if (x < -200 || x > w + 200 || y < -60 || y > h + 60) continue;
      const key = facilityMarkKey(f.kind, f.name), hosts = hostNames.has(f.name);
      facs.push({ f, x, y, key, col: FACILITY_COLOR[key], hosts, tw: textWidth(ctx, f.name, fs), box: { x0: 0, y0: 0, x1: 0, y1: 0 } });
      boxes.push({ x0: x - bs / 2 - 1, y0: y - bs / 2 - 1, x1: x + bs / 2 + 1, y1: y + bs / 2 + 1 });
    }
    for (const L of facs) { L.box = placeLabel(boxes, L.x, L.y, bs / 2, L.tw + fs * 0.9 + (L.hosts ? lh * 0.95 : 0), lh); boxes.push(L.box); }
    facBoxes = boxes;
  }
  // 이름표는 글자 테두리를 그리는 비용이 크다. 시점이 멈춰 있으면 한 번 그려 둔 층을 다시 쓰고, 움직이는 동안에는 중요한 이름만 그린다.
  const drawLabels = (lg: CanvasRenderingContext2D, full: boolean): void => {
    const halo = (text: string, x: number, y: number, fs: number, fg: string, weight = 600): void => {
    lg.font = `${weight} ${fs}px ${FONT}`; lg.textAlign = 'center'; lg.textBaseline = 'middle';
    lg.lineJoin = 'round'; lg.strokeStyle = 'rgba(6,10,14,0.85)'; lg.lineWidth = Math.max(2.5, fs * 0.3); lg.strokeText(text, x, y); lg.fillStyle = fg; lg.fillText(text, x, y);
    };
    // 도로 이름: 길을 따라 기울여 쓴다 (멀리서는 큰길만)
    for (const e of full ? city.edges : []) {
      if (cam.zoom < 1.6 && !(e.arterial && (e.seq ?? 0) % 3 === 1)) continue;
      if (cam.zoom < 2.6 && (!e.arterial || (e.seq ?? 0) % 2)) continue;
      if (cam.zoom < 3.6 && e.cls === 'local') continue;
      const A = city.nodes[e.a], B = city.nodes[e.b];
      const mx = sx((A.x + B.x) / 2), my = sy((A.y + B.y) / 2);
      if (mx < -40 || mx > w + 40 || my < -40 || my > h + 40) continue;
      let ang = Math.atan2(B.y - A.y, B.x - A.x); if (ang > Math.PI / 2) ang -= Math.PI; else if (ang < -Math.PI / 2) ang += Math.PI;
      const off = ((e.arterial ? 13 : 9.5) * xf.scale + 7);
      lg.save(); lg.translate(mx, my); lg.rotate(ang); halo(e.name, 0, -off, Math.min(13, 9.5 + cam.zoom), e.arterial ? 'rgba(232,214,160,0.8)' : 'rgba(190,205,220,0.66)'); lg.restore();
    }
    if (full && cam.zoom >= 4) for (const a of city.alleys) { const mx = sx((a.x0 + a.x1) / 2), my = sy(a.y0); if (mx > 0 && mx < w && my > 0 && my < h) halo(a.name, mx, my, 9.5, 'rgba(170,185,198,0.6)', 500); }
    // 동네 이름(흐리게)과 강 이름
    if (full && cam.zoom >= 1.15 && cam.zoom <= 3.4) for (const d of city.districts) { const cx = sx(d.x + d.w / 2), cy = sy(d.y + d.h * 0.2); if (cx > 0 && cx < w && cy > 0 && cy < h) halo(d.name, cx, cy, 11.5 * zs, 'rgba(190,205,220,0.36)', 700); }
    { const RV = city.river.pts, mid = RV[Math.floor(RV.length * 0.55)], nx = RV[Math.floor(RV.length * 0.55) + 1]; lg.save(); lg.translate(sx(mid[0]), sy(mid[1])); lg.rotate(Math.atan2(nx[1] - mid[1], nx[0] - mid[0])); halo(city.river.name, 30, 0, 11.5 * zs, 'rgba(160,215,240,0.85)', 700); lg.restore(); }
    // 건물과 터의 이름: 멀리서는 도시에 하나뿐인 곳만, 가까이 갈수록 더 많이 (주택은 마우스를 올려야 보인다)
    {
      const need = !full ? 3 : cam.zoom >= 3.6 ? 1 : cam.zoom >= 2.1 ? 2 : 3;
      const cands: Place[] = [];
      for (const q of city.places) { if (q.facility >= 0 || (q.rank ?? 0) < need || q.kind === 'riverside') continue; if (onScreen(q)) cands.push(q); }
      cands.sort((a, b2) => (b2.rank ?? 0) - (a.rank ?? 0) || b2.w * b2.h - a.w * a.h);
      const taken: number[][] = facBoxes.map((b) => [b.x0 - 2, b.y0 - 1, b.x1 + 2, b.y1 + 1]);      // 시설 배지와 이름표가 놓인 자리는 비워 둔다
      for (const q of cands) {
        const big = (q.rank ?? 0) >= 3, text = q.kind === 'apartment' ? q.name.split(' ').pop()! : q.name.replace(/^가온공항 /, big ? '가온공항 ' : ''), fs = big ? 11.5 * zs : q.kind === 'apartment' ? 9.5 : 10;
        lg.font = `${big ? 700 : 600} ${fs}px ${FONT}`;
        const cx = sx(q.x + q.w / 2), cy = sy(q.y + q.h / 2), tw = lg.measureText(text).width / 2 + 4, th = fs * 0.75;
        if (taken.some((r) => cx - tw < r[2] && cx + tw > r[0] && cy - th < r[3] && cy + th > r[1])) continue;
        taken.push([cx - tw, cy - th, cx + tw, cy + th]);
        halo(text, cx, cy, fs, big ? (q.open ? 'rgba(200,236,210,0.95)' : 'rgba(240,244,248,0.95)') : PLACE_TINT[q.kind] ?? 'rgba(214,224,234,0.86)', big ? 700 : 600);
      }
    }
  };
  if (!mini) {
    const dpr = ctx.getTransform().a || 1, key = `${cam.x.toFixed(1)}|${cam.y.toFixed(1)}|${cam.zoom.toFixed(3)}|${w}|${h}|${dpr}|${hostSig}`;      // 시설 이름표의 자리(hostSig)가 달라지면 건물 이름 층도 다시 그린다
    if (!labelLayer || labelLayer.key !== key) { labelLayer = { c: labelLayer ? labelLayer.c : document.createElement('canvas'), key, ready: false }; drawLabels(ctx, false); }
    else {
      if (!labelLayer.ready) { const lc = labelLayer.c; lc.width = Math.round(w * dpr); lc.height = Math.round(h * dpr); const lg = lc.getContext('2d')!; lg.setTransform(dpr, 0, 0, dpr, 0, 0); drawLabels(lg, true); labelLayer.ready = true; }
      ctx.drawImage(labelLayer.c, 0, 0, w, h);
    }
    // 사건이 난 건물: 테두리가 깜박인다
    for (const I of sim.incidents) {
      if (I.phase === 'closed' || I.truth.placeId < 0 || (I.phase === 'unreported' && !o.truth)) continue;
      if (!o.truth && (!I.locationKnown || I.reportedNode !== I.truth.nodeId)) continue;
      const q = city.places[I.truth.placeId], pulse = 0.5 + 0.5 * Math.sin(o.timeMs / 260);
      ctx.strokeStyle = TYPE_COLOR[incidentShownType(I, o.truth)]; ctx.globalAlpha = 0.45 + 0.5 * pulse; ctx.lineWidth = 2;
      ctx.save(); ctx.translate(sx(q.x + q.w / 2), sy(q.y + q.h / 2)); ctx.rotate(q.rot ?? 0);
      ctx.beginPath(); ctx.roundRect((-q.w / 2) * xf.scale - 3, (-q.h / 2) * xf.scale - 3, q.w * xf.scale + 6, q.h * xf.scale + 6, 4); ctx.stroke(); ctx.restore(); ctx.globalAlpha = 1;
    }
  }
  drawTrafficScreen(ctx, sim, xf, { timeMs: o.timeMs, truth: o.truth, zs, mini });      // 장애물 표식, 통제 구간의 진입 금지 표시
  for (const f of city.facilities) {
    // 시설: 축소 창에서는 색 네모, 지도에서는 기호가 든 네모 배지 + 이름표(+ 대기 중인 부대 수)
    if (!mini) break;
    const lot = facilityLot(f);
    ctx.fillStyle = FACILITY_COLOR[f.kind] ?? FACILITY_COLOR.public; ctx.beginPath(); ctx.roundRect(sx(lot.x) - 3.5, sy(lot.y) - 3.5, 7, 7, 2); ctx.fill();
  }
  for (const L of facs) {
    const bs = 20 * zs, fs = Math.round(11 * zs), b = L.box, lh = b.y1 - b.y0, cy = (b.y0 + b.y1) / 2;
    drawFacilityBadge(ctx, L.x, L.y, bs, L.key, L.col);
    ctx.fillStyle = 'rgba(8,13,18,0.8)'; ctx.beginPath(); ctx.roundRect(b.x0, b.y0, b.x1 - b.x0, lh, lh * 0.32); ctx.fill();
    ctx.font = `600 ${fs}px ${FONT}`; ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
    ctx.fillStyle = 'rgba(226,236,246,0.94)'; ctx.fillText(L.f.name, b.x0 + fs * 0.45, cy + 0.5);
    if (L.hosts) {
      // 대기 중인 부대 수 (수량이므로 숫자 그대로)
      const waiting = sim.units.filter((u) => u.homeName === L.f.name && u.state === 'available').length;
      const br = lh * 0.36, bx = b.x1 - lh * 0.5;
      ctx.fillStyle = waiting ? L.col : 'rgba(120,138,156,0.3)'; ctx.beginPath(); ctx.arc(bx, cy, br, 0, 6.2832); ctx.fill();
      ctx.fillStyle = waiting ? '#0b1219' : 'rgba(200,212,223,0.75)'; ctx.font = `800 ${Math.round(fs * 0.9)}px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(String(waiting), bx, cy + 0.5);
    }
  }
  // 사건 핀
  for (const I of sim.incidents) {
    const ip = incidentXY(sim, I, o.truth);
    const x = sx(ip.x), y = sy(ip.y);
    if (o.truth && !mini && I.phase !== 'closed' && I.locationKnown && I.reportedNode !== I.truth.nodeId) {
      // 관찰자 시점: 관제가 잘못 알고 있는 위치를 흐리게 표시
      const n = city.nodes[I.reportedNode], gx = sx(n.x), gy = sy(n.y);
      ctx.strokeStyle = 'rgba(255,93,93,0.75)'; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.arc(gx, gy, 15 * zs, 0, 7); ctx.moveTo(gx, gy); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
      label(ctx, `${I.pursuit ? '마지막으로 알려진 위치' : '신고된 위치 (오류)'} · ${I.code}`, gx, gy - 24 * zs, 10.5 * zs, '#ff9a9a', 'rgba(8,13,18,0.86)', 'rgba(255,93,93,0.6)');
    }
    if (I.phase === 'closed') {
      if (mini || !I.result) continue;
      ctx.globalAlpha = 0.55; ctx.fillStyle = OUTCOME_COLOR[I.result.outcome];
      ctx.beginPath(); ctx.arc(x, y, 5, 0, 7); ctx.fill(); ctx.globalAlpha = 1;
      continue;
    }
    if (I.phase === 'unreported' && !o.truth) continue;
    const type = incidentShownType(I, o.truth);
    const col = I.phase === 'unreported' ? '#6b7785' : TYPE_COLOR[type];
    const focused = I.id === o.focus;
    const r = mini ? 5 : 16 * zs;
    const t = (o.timeMs / 1000) % 1.6;
    for (let k = 0; k < 2; k++) {
      const ph = (t / 1.6 + k * 0.5) % 1;
      ctx.strokeStyle = col; ctx.globalAlpha = (1 - ph) * (I.phase === 'unreported' ? 0.3 : 0.7); ctx.lineWidth = mini ? 1 : 2;
      ctx.beginPath(); ctx.arc(x, y, r + 2 + ph * (mini ? 9 : 30 * zs), 0, 7); ctx.stroke();
    }
    if (I.tag === 'major' && (o.truth || I.firstArrivalAt >= 0 || !!I.assessment?.label)) {      // 대형 사고: 바깥으로 천천히 퍼지는 주황 고리를 하나 더 두른다 (AI 시점에서는 관제가 알아본 뒤부터)
      const ph = (o.timeMs / 2600) % 1;
      ctx.strokeStyle = '#ff8a3c'; ctx.globalAlpha = 0.85 * (1 - ph); ctx.lineWidth = mini ? 1.5 : 3;
      ctx.beginPath(); ctx.arc(x, y, r + (mini ? 4 : 10 * zs) + ph * (mini ? 12 : 44 * zs), 0, 7); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    if (o.book) drawCombatPin(ctx, o.book, sim, I, x, y, r, zs, { truth: o.truth, mini, timeMs: o.timeMs });      // (G5) 교전 표시
    if (mini) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); if (focused) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, 7); ctx.stroke(); } continue; }
    const pj = o.book ? combatPinJitter(o.book, sim, I, o.truth) : null;
    if (pj) { ctx.save(); ctx.translate(pj.x, pj.y); }
    if (I.phase !== 'unreported') { ctx.globalCompositeOperation = 'lighter'; drawLight(ctx, x, y, r * 3.4, col, 0.3 + 0.12 * Math.sin(o.timeMs / 300)); ctx.globalCompositeOperation = 'source-over'; ctx.globalAlpha = 1; }
    // 핀: 어두운 바탕 + 유형색 테 + 유형 아이콘. 그림자와 테의 굵기는 부대 표식과 같은 비례다
    const plw = Math.max(2, r * 0.17);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.beginPath(); ctx.arc(x + r * 0.1, y + r * 0.18, r + plw * 0.5, 0, 7); ctx.fill();
    const pg = ctx.createRadialGradient(x - r * 0.3, y - r * 0.4, 1, x, y, r);
    pg.addColorStop(0, mix(col, '#0d151d', 0.72)); pg.addColorStop(1, '#0b1219');
    ctx.fillStyle = pg; ctx.strokeStyle = col; ctx.lineWidth = plw;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke();
    drawIcon(ctx, I.phase === 'call' && !I.assessment ? 'phone' : type, x, y, r * 1.2, col);
    // 경과 링: 신고 후 첫 도착까지는 기준 시간 대비 진행도, 도착 후에는 초록
    if (I.reportedAt >= 0) {
      const arrived = I.firstArrivalAt >= 0;
      const frac = arrived ? 1 : Math.min(1, (sim.t - I.reportedAt) / RESP_LIMIT[type]);
      ctx.strokeStyle = arrived ? '#5ad17a' : frac >= 1 ? '#ff5d5d' : frac > 0.7 ? '#ffb454' : '#e8f0f7'; ctx.lineWidth = Math.max(2, r * 0.14);
      ctx.beginPath(); ctx.arc(x, y, r + plw * 0.5 + r * 0.2, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
    }
    if (focused) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.lineDashOffset = -o.timeMs / 60; ctx.beginPath(); ctx.arc(x, y, r + plw + r * 0.46, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    label(ctx, I.phase === 'unreported' ? '미신고' : I.code, x + r * 0.95, y - r * 0.95, 10.5 * zs, '#0b1219', col);
    const st = I.pursuit && I.pursuit.state === 'driving' && I.phase !== 'unreported' ? `추격 중 · ${I.assigned.length}팀${I.pursuit.tracked ? ' · 시야 확보' : ''}` : I.phase === 'unreported' ? '아직 신고되지 않음' : I.phase === 'call' ? '신고 통화 중' : I.phase === 'onscene' ? `현장 대응 ${fmtDur(sim.t - I.firstArrivalAt)}` : I.assigned.length ? `출동 ${I.assigned.length}대 · ${fmtDur(sim.t - I.reportedAt)}` : `배정 대기 ${fmtDur(sim.t - I.reportedAt)}`;
    label(ctx, st, x, y + r + 16 * zs, 11 * zs, I.phase === 'unreported' ? '#9aa7b4' : '#e8f0f7', 'rgba(8,13,18,0.86)', I.phase === 'unreported' ? undefined : col);
    if (pj) ctx.restore();
  }
  // 부대: 둥근 표식 (색 = 분야, 기호 = 종류, 아래의 점 = 번호, 테 = 상태). 대기 중인 부대는 가까이 볼 때만 하나씩 그린다
  const tr = mini ? 3.2 : TOKEN_R * zs, len = tr * 2 + 3;
  for (const u of sim.units) {
    if (u.aid && u.state === 'oos') continue;      // 관할로 돌아간 지원 부대
    const idle = u.state === 'available' || u.state === 'oos';
    if (mini && (idle || u.state === 'onscene')) continue;
    if (idle && cam.zoom < IDLE_ZOOM && !u.air && !u.sea && u.id !== o.selectedUnit) continue;
    const p = unitScreen(sim, u, xf, o.alpha, len);
    drawToken(ctx, p.x, p.y, tr, { field: u.field ?? (u.dept === 'police' ? 'police' : u.dept === 'ems' ? 'rescue' : 'fire'), kind: u.kind, state: u.state, no: +(u.callsign.match(/\d+$/) ?? ['0'])[0], timeMs: o.timeMs, angle: p.angle, selected: u.id === o.selectedUnit, mini });
    if (mini || idle || u.state === 'onscene') continue;
    if (cam.zoom >= 1.8 || (u.incidentId !== null && u.incidentId === o.focus) || u.id === o.selectedUnit) {
      const eta = u.state === 'enroute' ? ` ${Math.max(0, Math.round(u.estArrive - sim.t))}초` : u.state === 'transport' ? ' 이송' : u.state === 'returning' ? ' 복귀' : '';
      label(ctx, u.callsign + eta, p.x, p.y - tr * 1.62 - 7, 10 * zs, FIELD_TEXT[u.field ?? (u.dept === 'police' ? 'police' : u.dept === 'ems' ? 'rescue' : 'fire')]);      // 분야가 없는 지원 부대도 돌과 같은 색
    }
  }
  // 도주 차량: 관찰자 시점에서는 늘 보이고, AI 시점에서는 부대의 시야에 있을 때만 보인다
  for (const I of sim.incidents) {
    const p = I.pursuit;
    if (!p || p.state !== 'driving' || I.phase === 'closed' || sim.t < p.startAt || (!o.truth && !p.tracked)) continue;
    const x = sx(p.x), y = sy(p.y);
    if (!mini && p.trail.length) {
      ctx.strokeStyle = 'rgba(255,93,93,0.4)'; ctx.lineWidth = 2.5; ctx.setLineDash([3, 6]); ctx.beginPath();
      p.trail.forEach((q, i) => (i ? ctx.lineTo(sx(q[0]), sy(q[1])) : ctx.moveTo(sx(q[0]), sy(q[1])))); ctx.lineTo(x, y); ctx.stroke(); ctx.setLineDash([]);
    }
    if (mini) { ctx.fillStyle = '#ff5d5d'; ctx.beginPath(); ctx.arc(x, y, 3.5, 0, 7); ctx.fill(); continue; }
    drawFugitive(ctx, x, y, tr * 1.1, o.timeMs);
    label(ctx, `${p.kind === 'kidnap' ? '납치 차량' : p.kind === 'getaway' ? '도주 차량' : '난폭 운전 차량'} · ${I.code}`, x, y - tr * 1.1 - 13, 10.5 * zs, '#ffd0d0', 'rgba(60,12,12,0.9)', 'rgba(255,93,93,0.8)');
  }
  // 마우스를 올린 건물·터·도로의 정보
  if (!mini && o.hover) {
    const wx = (o.hover.x - xf.ox) / xf.scale, wy = (o.hover.y - xf.oy) / xf.scale;
    const info = describeAt(sim, wx, wy, o.truth, xf.scale);
    if (info) {
      if (info.place && info.place.kind !== 'riverside' && info.place.kind !== 'farmland' && info.place.kind !== 'forest' && info.place.kind !== 'reservoir' && info.place.kind !== 'beach') { const q = info.place; ctx.save(); ctx.translate(sx(q.x + q.w / 2), sy(q.y + q.h / 2)); ctx.rotate(q.rot ?? 0); ctx.strokeStyle = 'rgba(255,255,255,0.9)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.roundRect((-q.w / 2) * xf.scale - 2, (-q.h / 2) * xf.scale - 2, q.w * xf.scale + 4, q.h * xf.scale + 4, 3); ctx.stroke(); ctx.restore(); }
      ctx.font = `700 12.5px ${FONT}`; const w1 = ctx.measureText(info.title).width;
      ctx.font = `500 11px ${FONT}`; const w2 = Math.max(...info.lines.map((t) => ctx.measureText(t).width), 0);
      const bw = Math.max(w1, w2) + 20, bh = 26 + info.lines.length * 15;
      const bx = Math.min(w - bw - 6, o.hover.x + 16), by = Math.min(h - bh - 6, o.hover.y + 18);
      ctx.save(); ctx.shadowColor = 'rgba(0,0,0,0.6)'; ctx.shadowBlur = 12; ctx.shadowOffsetY = 3;
      ctx.fillStyle = 'rgba(10,16,22,0.94)'; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 7); ctx.fill(); ctx.restore();
      ctx.strokeStyle = info.color; ctx.lineWidth = 1; ctx.beginPath(); ctx.roundRect(bx, by, bw, bh, 7); ctx.stroke();
      ctx.fillStyle = info.color; ctx.fillRect(bx, by + 7, 3, bh - 14);
      ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
      ctx.font = `700 12.5px ${FONT}`; ctx.fillStyle = '#eef4fa'; ctx.fillText(info.title, bx + 11, by + 14);
      ctx.font = `500 11px ${FONT}`; info.lines.forEach((t, i) => { ctx.fillStyle = i === info.lines.length - 1 && info.alert ? '#ffb454' : 'rgba(190,205,220,0.9)'; ctx.fillText(t, bx + 11, by + 31 + i * 15); });
    }
  }
}

const PLACE_TINT: Partial<Record<string, string>> = {
  bank: 'rgba(240,214,130,0.95)', convenience: 'rgba(150,230,180,0.92)', restaurant: 'rgba(255,190,150,0.9)', mart: 'rgba(255,170,160,0.95)', market: 'rgba(160,230,215,0.92)',
  hotel: 'rgba(230,200,180,0.9)', chemical: 'rgba(220,235,140,0.92)', storage: 'rgba(220,235,140,0.85)', construction: 'rgba(240,200,120,0.92)', gasStation: 'rgba(255,170,160,0.9)',
  terminal: 'rgba(180,220,245,0.95)', hangar: 'rgba(180,220,245,0.85)',
};

export interface MapInfo { title: string; lines: string[]; color: string; place: Place | null; alert: boolean }
/** 지도의 그 지점에 무엇이 있는가: 길 위의 장애물·건널목·열차가 먼저, 다음이 건물·터, 없으면 도로와 골목 */
export function describeAt(sim: Sim, wx: number, wy: number, truth = true, scale = 1): MapInfo | null {
  const city = sim.city;
  const tinfo = describeTraffic(sim, wx, wy, truth, Math.max(7, 11 / scale));
  if (tinfo) return { ...tinfo, place: null };
  const q = placeAt(city, wx, wy);
  const distSeg = (x0: number, y0: number, x1: number, y1: number): number => { const dx = x1 - x0, dy = y1 - y0, t = Math.max(0, Math.min(1, ((wx - x0) * dx + (wy - y0) * dy) / (dx * dx + dy * dy))); return Math.hypot(wx - x0 - dx * t, wy - y0 - dy * t); };
  if (!q || q.open) {
    for (const e of city.edges) { const A = city.nodes[e.a], B = city.nodes[e.b]; if (distSeg(A.x, A.y, B.x, B.y) < (e.arterial ? 11 : 8)) { const flow = flowOf(e, truth); return { title: e.name, lines: [`${e.cls === 'highway' ? '고속화 도로' : e.cls === 'arterial' ? '간선 도로' : e.cls === 'local' ? '이면 도로' : '일반 도로'}${e.bridge ? ' · 다리' : ''}${e.gateT !== undefined ? ' · 건널목' : ''}`, `지금: ${flow === '극심' ? '극심한 정체' : flow}${flow === '통제' ? ' 중' : ''}`], color: '#e8d6a0', place: null, alert: flow === '통제' || flow === '극심' }; } }
    for (const a of city.alleys) if (distSeg(a.x0, a.y0, a.x1, a.y1) < 4.5) return { title: a.name, lines: ['골목 — 차량은 큰길에 세우고 걸어 들어간다'], color: '#9fb0c0', place: null, alert: false };
  }
  if (!q) return null;
  const lines = [`${KIND_NAME[q.kind]} · ${q.open ? q.dong : `${q.dong} ${q.addr}`}`];
  if (!q.open && q.floors > 1) lines[0] += ` · ${q.floors}층`;
  const here = sim.incidents.filter((I) => I.truth.placeId === q.id && I.phase !== 'unreported');
  const open = here.find((I) => I.phase !== 'closed');
  if (open) lines.push(`사건 ${open.code} 진행 중`); else if (here.length) lines.push(`이번 교대에 사건 ${here.map((I) => I.code).join(', ')} 발생`);
  return { title: q.name, lines, color: open ? '#ffb454' : q.open ? '#58d68d' : '#7cc4ff', place: q, alert: !!open };
}

export function hitCity(sim: Sim, cam: CityCam, w: number, h: number, px: number, py: number, truthView = true): { incident: number; unit: number; wx: number; wy: number } {
  const xf = cityXf(sim, cam, w, h);
  const wx = (px - xf.ox) / xf.scale, wy = (py - xf.oy) / xf.scale;
  let incident = -1, bd = 30;
  for (const I of sim.incidents) {
    if (I.phase === 'unreported') continue;
    const ip = incidentXY(sim, I, truthView);
    const d = Math.hypot(ip.x * xf.scale + xf.ox - px, ip.y * xf.scale + xf.oy - py);
    if (d < bd) { bd = d; incident = I.id; }
  }
  // 부대: 그릴 때와 같은 크기·같은 자리로 잰다 (돌의 반지름 + 상태 테의 여유)
  const tr = TOKEN_R * markScale(cam.zoom);
  let unit = -1, ud = tr + 7;
  for (const u of sim.units) { if (u.aid && u.state === 'oos') continue; if ((u.state === 'available' || u.state === 'oos') && cam.zoom < IDLE_ZOOM && !u.air && !u.sea) continue; const p = unitScreen(sim, u, xf, 1, tr * 2 + 3); const d = Math.hypot(p.x - px, p.y - py); if (d < ud) { ud = d; unit = u.id; } }
  return { incident, unit, wx, wy };
}
