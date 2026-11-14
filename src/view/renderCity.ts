// 도시 관제 화면 렌더러 (Canvas 2D). 시뮬레이션 상태를 읽어 그리기만 한다.
// 지도(도로·건물)는 월드 좌표로, 표식(사건 핀·차량·라벨)은 화면 픽셀 크기로 그려 어떤 배율에서도 읽힌다.

import type { Sim } from '../sim/engine';
import type { Incident, Unit } from '../sim/types';
import { fmtDur } from '../sim/util';
import type { CityCam } from './camera';
import { drawIcon, drawVehicle } from './icons';

export const DEPT_COLOR: Record<string, string> = { fire: '#ff7a45', ems: '#2fd39a', police: '#5aa9ff' };
export const TYPE_COLOR: Record<string, string> = { fire: '#ff6b3d', traffic: '#ffc24a', search: '#58d68d', armed: '#b98cff', medical: '#ff7eb6', unknown: '#9aa7b4' };
export const OUTCOME_COLOR: Record<string, string> = { success: '#5ad17a', partial: '#ffd166', delayed: '#7cc4ff', unresolved: '#b3a0d6', failed: '#ff5d5d' };
export const FONT = "'Pretendard', 'Noto Sans KR', 'Apple SD Gothic Neo', 'Malgun Gothic', system-ui, sans-serif";

const DISTRICT_TINT: Record<string, string> = { residential: 'rgba(90,140,200,0.075)', commercial: 'rgba(220,180,90,0.065)', industrial: 'rgba(190,120,100,0.075)', outskirts: 'rgba(70,150,100,0.055)' };
const BUILD_COLOR: Record<string, [number, number, number]> = { residential: [46, 62, 82], commercial: [66, 66, 76], industrial: [72, 58, 54], outskirts: [48, 64, 56] };
const RESP_LIMIT: Record<string, number> = { fire: 95, armed: 95, traffic: 105, search: 125, medical: 80, unknown: 100 };

let staticLayer: HTMLCanvasElement | null = null;
let staticFor: unknown = null;

function h2(x: number, y: number): number { let h = (x * 374761393 + y * 668265263) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

function buildStatic(sim: Sim): HTMLCanvasElement {
  const night = sim.weather === 'night';
  const c = document.createElement('canvas');
  c.width = sim.city.w; c.height = sim.city.h;
  const g = c.getContext('2d')!;
  g.fillStyle = night ? '#080d14' : '#0b1219'; g.fillRect(0, 0, c.width, c.height);
  // 은은한 격자 (관제 지도 느낌)
  g.strokeStyle = 'rgba(120,150,180,0.035)'; g.lineWidth = 1;
  for (let x = 0; x < c.width; x += 80) { g.beginPath(); g.moveTo(x, 0); g.lineTo(x, c.height); g.stroke(); }
  for (let y = 0; y < c.height; y += 80) { g.beginPath(); g.moveTo(0, y); g.lineTo(c.width, y); g.stroke(); }
  for (const d of sim.city.districts) { g.fillStyle = DISTRICT_TINT[d.district]; g.fillRect(d.x, d.y, d.w, d.h); }
  for (const p of sim.city.parks) {
    const gr = g.createRadialGradient(p.x, p.y, 4, p.x, p.y, p.r);
    gr.addColorStop(0, 'rgba(52,104,72,0.6)'); gr.addColorStop(1, 'rgba(40,80,58,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(p.x, p.y, p.r, 0, Math.PI * 2); g.fill();
    for (let k = 0; k < 7; k++) { const a = h2(Math.round(p.x) + k, Math.round(p.y)) * 6.28, rr = h2(Math.round(p.y) + k, Math.round(p.x)) * p.r * 0.7; g.fillStyle = 'rgba(70,130,90,0.5)'; g.beginPath(); g.arc(p.x + Math.cos(a) * rr, p.y + Math.sin(a) * rr, 7 + 5 * h2(k, Math.round(p.x)), 0, 7); g.fill(); }
  }
  for (const b of sim.city.buildings) {
    const [r, gg, bb] = BUILD_COLOR[b.district];
    const k = (0.82 + b.tone * 0.36) * (night ? 0.72 : 1);
    g.fillStyle = 'rgba(0,0,0,0.38)'; g.fillRect(b.x + 5, b.y + 6, b.w, b.h);
    g.fillStyle = `rgb(${Math.round(r * k)},${Math.round(gg * k)},${Math.round(bb * k)})`;
    g.fillRect(b.x, b.y, b.w, b.h);
    g.fillStyle = 'rgba(255,255,255,0.06)'; g.fillRect(b.x, b.y, b.w, 2.5); g.fillRect(b.x, b.y, 2.5, b.h);
    g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 1; g.strokeRect(b.x + 6.5, b.y + 6.5, Math.max(1, b.w - 13), Math.max(1, b.h - 13));
    if (night) {
      for (let wy = b.y + 8; wy < b.y + b.h - 8; wy += 13) for (let wx = b.x + 8; wx < b.x + b.w - 8; wx += 13) {
        if (h2(Math.round(wx), Math.round(wy)) < 0.3) { g.fillStyle = 'rgba(255,214,130,0.7)'; g.fillRect(wx, wy, 4, 4); }
      }
    }
  }
  g.font = `700 34px ${FONT}`; g.textAlign = 'left'; g.textBaseline = 'top';
  for (const d of sim.city.districts) { g.fillStyle = 'rgba(190,210,230,0.15)'; g.fillText(d.name, d.x + 18, d.y + 14); }
  return c;
}

export interface Xf { scale: number; ox: number; oy: number }
export function cityXf(sim: Sim, cam: CityCam, w: number, h: number): Xf {
  const fit = Math.min(w / sim.city.w, h / sim.city.h) * 0.98;
  const scale = fit * cam.zoom;
  return { scale, ox: w / 2 - cam.x * scale, oy: h / 2 - cam.y * scale };
}

export interface CityOpts { focus: number; truth: boolean; timeMs: number; alpha: number; selectedUnit: number; mini?: boolean }

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
  if (u.state === 'available' || u.state === 'oos') {
    const f = city.facilities.find((q) => q.nodeId === u.homeNode)!;
    let k = 0; for (const q of sim.units) { if (q.id === u.id) break; if (q.homeNode === u.homeNode) k++; }
    return { x: f.x * xf.scale + xf.ox + 16 + len * 0.62 + k * (len + 5), y: f.y * xf.scale + xf.oy, angle: 0 };
  }
  if (u.state === 'onscene' && u.incidentId !== null) {
    const I = sim.incidents[u.incidentId];
    const k = I.everAssigned.indexOf(u.id);
    const a = -Math.PI / 2 + (k - 1) * 0.75;
    return { x: I.truth.x * xf.scale + xf.ox + Math.cos(a) * 40, y: I.truth.y * xf.scale + xf.oy + Math.sin(a) * 40 + 4, angle: 0 };
  }
  const x = (u.px + (u.x - u.px) * alpha) * xf.scale + xf.ox, y = (u.py + (u.y - u.py) * alpha) * xf.scale + xf.oy;
  let angle = 0;
  if (u.route && u.seg < u.route.edges.length) { const A = city.nodes[u.route.nodes[u.seg]], B = city.nodes[u.route.nodes[u.seg + 1]]; angle = Math.atan2(B.y - A.y, B.x - A.x); }
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
  if (!staticLayer || staticFor !== sim) { staticLayer = buildStatic(sim); staticFor = sim; }
  const xf = cityXf(sim, cam, w, h);
  const city = sim.city;
  const mini = !!o.mini;
  const zs = mini ? 1 : Math.min(1.35, 0.9 + 0.14 * cam.zoom);     // 표식 크기 보정
  const sx = (wx: number) => wx * xf.scale + xf.ox, sy = (wy: number) => wy * xf.scale + xf.oy;

  // ── 월드 레이어 ──
  ctx.save();
  ctx.fillStyle = '#060a0f'; ctx.fillRect(0, 0, w, h);
  ctx.translate(xf.ox, xf.oy); ctx.scale(xf.scale, xf.scale);
  ctx.imageSmoothingEnabled = true;
  ctx.drawImage(staticLayer, 0, 0);
  ctx.lineCap = 'round';
  for (const e of city.edges) {
    const A = city.nodes[e.a], B = city.nodes[e.b];
    ctx.strokeStyle = '#0a1016'; ctx.lineWidth = e.arterial ? 19 : 13;
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  }
  for (const e of city.edges) {
    const A = city.nodes[e.a], B = city.nodes[e.b];
    ctx.strokeStyle = e.arterial ? '#3a4958' : '#2b3743'; ctx.lineWidth = e.arterial ? 14 : 9;
    ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
  }
  for (const e of city.edges) {
    const A = city.nodes[e.a], B = city.nodes[e.b];
    const load = e.cong + e.slow;
    if (e.closed) {
      ctx.strokeStyle = '#ff5d5d'; ctx.lineWidth = 4.5; ctx.setLineDash([10, 9]);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.setLineDash([]);
    } else if (load > 1.55) {
      ctx.strokeStyle = load > 2.3 ? 'rgba(255,93,93,0.8)' : 'rgba(255,180,84,0.6)';
      ctx.lineWidth = 3.5;
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke();
    } else if (e.arterial) {
      ctx.strokeStyle = 'rgba(200,215,230,0.2)'; ctx.lineWidth = 1.5; ctx.setLineDash([12, 12]);
      ctx.beginPath(); ctx.moveTo(A.x, A.y); ctx.lineTo(B.x, B.y); ctx.stroke(); ctx.setLineDash([]);
    }
  }
  // 출동 경로
  for (const u of sim.units) {
    if (!u.route || (u.state !== 'enroute' && u.state !== 'transport' && u.state !== 'returning')) continue;
    const px = u.px + (u.x - u.px) * o.alpha, py = u.py + (u.y - u.py) * o.alpha;
    ctx.strokeStyle = DEPT_COLOR[u.dept]; ctx.globalAlpha = u.state === 'returning' ? 0.2 : 0.85;
    ctx.lineWidth = (u.state === 'returning' ? 2 : 3.5) / Math.max(0.6, xf.scale * 1.4); ctx.setLineDash([10, 9]); ctx.lineDashOffset = -(o.timeMs / 35) % 19;
    ctx.beginPath(); ctx.moveTo(px, py);
    for (let k = u.seg + 1; k < u.route.nodes.length; k++) { const n = city.nodes[u.route.nodes[k]]; ctx.lineTo(n.x, n.y); }
    ctx.stroke(); ctx.setLineDash([]); ctx.globalAlpha = 1;
  }
  ctx.restore();

  // ── 날씨 ──
  if (!mini) {
    if (sim.weather === 'night') { ctx.fillStyle = 'rgba(6,10,28,0.3)'; ctx.fillRect(0, 0, w, h); }
    else if (sim.weather === 'fog') { const gr = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.9); gr.addColorStop(0, 'rgba(190,200,210,0.05)'); gr.addColorStop(1, 'rgba(190,200,210,0.2)'); ctx.fillStyle = gr; ctx.fillRect(0, 0, w, h); }
    else if (sim.weather === 'rain') {
      ctx.strokeStyle = 'rgba(170,200,235,0.2)'; ctx.lineWidth = 1; ctx.beginPath();
      for (let k = 0; k < 90; k++) { const x = (h2(k, 1) * w + o.timeMs * 0.12) % w, y = (h2(k, 2) * h + o.timeMs * 0.55 * (0.7 + h2(k, 3) * 0.6)) % h; ctx.moveTo(x, y); ctx.lineTo(x + 3, y + 13); }
      ctx.stroke();
    }
  }

  // ── 화면 레이어: 도로명, 시설, 사건, 차량 ──
  if (!mini && cam.zoom > 1.35) {
    ctx.font = `600 11px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillStyle = 'rgba(180,198,214,0.5)';
    for (const e of city.edges) {
      if (!e.arterial || e.id % 2) continue;
      const A = city.nodes[e.a], B = city.nodes[e.b];
      const horiz = A.r === B.r;
      ctx.fillText(horiz ? `${A.r + 1}번가` : `${String.fromCharCode(65 + A.c)}로`, sx((A.x + B.x) / 2) + (horiz ? 0 : 20), sy((A.y + B.y) / 2) + (horiz ? -13 : 0));
    }
  }
  for (const e of city.edges) {
    if (!e.closed || mini) continue;
    const A = city.nodes[e.a], B = city.nodes[e.b];
    const mx = sx((A.x + B.x) / 2), my = sy((A.y + B.y) / 2);
    ctx.fillStyle = '#ff5d5d'; ctx.beginPath(); ctx.arc(mx, my, 8, 0, 7); ctx.fill(); ctx.fillStyle = '#0b1219'; ctx.fillRect(mx - 5, my - 1.5, 10, 3);
  }
  for (const f of city.facilities) {
    const col = f.kind === 'fireStation' ? DEPT_COLOR.fire : f.kind === 'police' ? DEPT_COLOR.police : f.kind === 'hospital' ? DEPT_COLOR.ems : '#8fa1b3';
    const s = mini ? 7 : 19 * zs, x = sx(f.x), y = sy(f.y);
    ctx.fillStyle = '#0d151d'; ctx.strokeStyle = col; ctx.lineWidth = mini ? 1.2 : 2;
    ctx.beginPath(); ctx.roundRect(x - s / 2, y - s / 2, s, s, s * 0.22); ctx.fill(); ctx.stroke();
    if (mini) continue;
    ctx.fillStyle = col; ctx.font = `800 ${Math.round(11 * zs)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    if (f.kind === 'hospital') { ctx.fillRect(x - s * 0.28, y - s * 0.08, s * 0.56, s * 0.16); ctx.fillRect(x - s * 0.08, y - s * 0.28, s * 0.16, s * 0.56); }
    else ctx.fillText(f.kind === 'fireStation' ? '119' : f.kind === 'police' ? '112' : '공', x, y + 0.5);
    ctx.font = `600 ${Math.round(11 * zs)}px ${FONT}`; ctx.fillStyle = 'rgba(214,226,238,0.85)'; ctx.textBaseline = 'top';
    ctx.fillText(f.name, x, y + s / 2 + 3);
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
      label(ctx, `신고된 위치 (오류) · ${I.code}`, gx, gy - 24 * zs, 10.5 * zs, '#ff9a9a', 'rgba(8,13,18,0.86)', 'rgba(255,93,93,0.6)');
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
    ctx.globalAlpha = 1;
    if (mini) { ctx.fillStyle = col; ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); if (focused) { ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(x, y, r + 2.5, 0, 7); ctx.stroke(); } continue; }
    ctx.fillStyle = 'rgba(0,0,0,0.4)'; ctx.beginPath(); ctx.arc(x + 2, y + 3, r, 0, 7); ctx.fill();
    ctx.fillStyle = '#0d151d'; ctx.strokeStyle = col; ctx.lineWidth = 3;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 7); ctx.fill(); ctx.stroke();
    drawIcon(ctx, I.phase === 'call' && !I.assessment ? 'phone' : type, x, y, r * 1.25, col);
    // 경과 링: 신고 후 첫 도착까지는 기준 시간 대비 진행도, 도착 후에는 초록
    if (I.reportedAt >= 0) {
      const arrived = I.firstArrivalAt >= 0;
      const frac = arrived ? 1 : Math.min(1, (sim.t - I.reportedAt) / RESP_LIMIT[type]);
      ctx.strokeStyle = arrived ? '#5ad17a' : frac >= 1 ? '#ff5d5d' : frac > 0.7 ? '#ffb454' : '#e8f0f7'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(x, y, r + 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac); ctx.stroke();
    }
    if (focused) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.setLineDash([4, 4]); ctx.lineDashOffset = -o.timeMs / 60; ctx.beginPath(); ctx.arc(x, y, r + 10, 0, 7); ctx.stroke(); ctx.setLineDash([]); }
    label(ctx, I.phase === 'unreported' ? '미신고' : I.code, x + r * 0.95, y - r * 0.95, 10.5 * zs, '#0b1219', col);
    const st = I.phase === 'unreported' ? '아직 신고되지 않음' : I.phase === 'call' ? '신고 통화 중' : I.phase === 'onscene' ? `현장 대응 ${fmtDur(sim.t - I.firstArrivalAt)}` : I.assigned.length ? `출동 ${I.assigned.length}대 · ${fmtDur(sim.t - I.reportedAt)}` : `배정 대기 ${fmtDur(sim.t - I.reportedAt)}`;
    label(ctx, st, x, y + r + 16 * zs, 11 * zs, I.phase === 'unreported' ? '#9aa7b4' : '#e8f0f7', 'rgba(8,13,18,0.86)', I.phase === 'unreported' ? undefined : col);
  }
  // 차량
  const len = mini ? 9 : 27 * zs, wid = mini ? 5 : 13 * zs;
  for (const u of sim.units) {
    if (mini && (u.state === 'available' || u.state === 'onscene' || u.state === 'oos')) continue;
    const p = unitScreen(sim, u, xf, o.alpha, len);
    const moving = u.state === 'enroute' || u.state === 'transport';
    if (mini) { ctx.fillStyle = DEPT_COLOR[u.dept]; ctx.beginPath(); ctx.arc(p.x, p.y, 3, 0, 7); ctx.fill(); continue; }
    drawVehicle(ctx, p.x, p.y, len, wid, u.dept, p.angle, moving || u.state === 'onscene', o.timeMs, u.state === 'available' || u.state === 'oos' || u.state === 'returning');
    if (u.id === o.selectedUnit) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, len * 0.75, 0, 7); ctx.stroke(); }
    if (u.state !== 'available' && u.state !== 'onscene') {
      const eta = u.state === 'enroute' ? ` ${Math.max(0, Math.round(u.estArrive - sim.t))}초` : u.state === 'transport' ? ' 이송' : u.state === 'returning' ? ' 복귀' : '';
      label(ctx, u.callsign + eta, p.x, p.y - wid - 9, 10.5 * zs, DEPT_COLOR[u.dept]);
    }
  }
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
  let unit = -1, ud = 20;
  for (const u of sim.units) { const p = unitScreen(sim, u, xf, 1, 27); const d = Math.hypot(p.x - px, p.y - py); if (d < ud) { ud = d; unit = u.id; } }
  return { incident, unit, wx, wy };
}
