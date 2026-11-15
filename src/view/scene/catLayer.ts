// 현장 위의 위험 그림 (설계서 X6 §7.3) — 결과 불변: 상태를 읽기만 한다.
//   drawCatUnder: 정보 표지 단계(어둠·날씨 위 — 밤과 안개에도 묻히지 않는다, G4 §2.8)에서 구획 건전도 빗금·가스 등고선·용기의 열 고리를 그린다.
//   drawCatOver:  새 글자 표지 단계(효과 뒤, 대원 이름표 앞)에서 그릴 글자 표지를 돌려준다 — renderScene 의 pill() 이 그린다.
// 관찰자 시점은 진실(Scene.cat — 건전도·가스·용기의 열)을, AI 시점은 지휘관이 아는 조짐(sign 사실)을 그린다(숫자 없이 같은 색).
// s.cat 이 없는 현장(아직 위험 상태를 만들지 않았거나 대상이 아님)은 아무것도 그리지 않는다 — 여기서 위험 상태를 만들지 않는다(만들면 그림이 결과를 바꾼다).
// 모양으로 G4 와 가른다: 무너진 구역 경계는 G4 의 #d6a878 점선, 2차 붕괴 위험 범위는 G4 의 #ffd166 점선 — 건전도는 구획 **안쪽의 빗금**이다.
// (단계 5 가 진입 금지 구역의 테이프 실선·철수 대원 표지를 여기에 더한다)

import type { Sim } from '../../sim/engine';
import { CAT, structLevel } from '../../sim/field/catastrophe';
import type { FieldAgent, Prop, Region, Scene, SignBelief } from '../../sim/types';
import type { G } from './common';
import type { HazardLabel } from './hazardFx';

export interface CatView { truth: boolean; timeMs: number; mini: boolean; cmd: FieldAgent | undefined }

/** 구조 조짐 단계별 빗금 색: 1 삐걱임(옅은 모래색) · 2 균열·처짐(주황) · 3 임박(빨강, 맥박) */
const HATCH = ['', '#d9c38a', '#ff9a3d', '#ff4d4d'];
const GAS_WARN = '#f4d35e', GAS_LEL = '#ff5d5d';

/** 그 구획 칸만큼 오린 영역에 사선 빗금 */
function hatchRegion(g: G, s: Scene, reg: Region, ts: number, col: string, a: number): void {
  const w = s.w, tl = reg.tiles;
  if (!tl.length) return;
  g.save();
  g.beginPath();
  for (let q = 0; q < tl.length; q++) { const i = tl[q]; g.rect((i % w) * ts, ((i / w) | 0) * ts, ts, ts); }
  g.clip();
  const x0 = reg.x0 * ts, y0 = reg.y0 * ts, x1 = (reg.x1 + 1) * ts, y1 = (reg.y1 + 1) * ts, step = Math.max(5, ts * 0.42);
  g.strokeStyle = col; g.globalAlpha = a; g.lineWidth = Math.max(1, ts * 0.06); g.setLineDash([]);
  g.beginPath();
  for (let d = x0 - (y1 - y0); d < x1; d += step) { g.moveTo(d, y1); g.lineTo(d + (y1 - y0), y0); }
  g.stroke();
  g.restore();
}

/** 문턱 th 를 넘은 칸 덩어리의 경계 선분 (4방향) */
function contour(g: G, s: Scene, gas: Float32Array, th: number, ts: number, col: string, width: number): boolean {
  const w = s.w, h = s.h;
  let any = false;
  g.beginPath();
  for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
    if (gas[i] < th) continue;
    any = true;
    const X = x * ts, Y = y * ts;
    if (x + 1 >= w || gas[i + 1] < th) { g.moveTo(X + ts, Y); g.lineTo(X + ts, Y + ts); }
    if (x <= 0 || gas[i - 1] < th) { g.moveTo(X, Y); g.lineTo(X, Y + ts); }
    if (y + 1 >= h || gas[i + w] < th) { g.moveTo(X, Y + ts); g.lineTo(X + ts, Y + ts); }
    if (y <= 0 || gas[i - w] < th) { g.moveTo(X, Y); g.lineTo(X + ts, Y); }
  }
  if (!any) return false;
  g.strokeStyle = 'rgba(8,13,18,0.55)'; g.lineWidth = width + 2; g.setLineDash([]); g.stroke();
  g.strokeStyle = col; g.lineWidth = width; g.stroke();
  return true;
}

/** 용기 둘레 고리: fill(0..1)만큼 채운 호 (노랑 → 빨강). blink 면 깜박인다 */
function vesselRing(g: G, p: Prop, ts: number, fill: number, blink: boolean, t: number): void {
  const x = (p.x + (p.w - 1) / 2 + 0.5) * ts, y = (p.y + (p.h - 1) / 2 + 0.5) * ts;
  const r = Math.max(p.w, p.h) * ts * 0.5 + ts * 0.18;
  const on = !blink || Math.sin(t * 9) > -0.2;
  g.save();
  g.setLineDash([]);
  g.lineWidth = Math.max(2, ts * 0.09);
  g.strokeStyle = 'rgba(8,13,18,0.6)'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
  g.lineWidth = Math.max(1.5, ts * 0.07);
  g.strokeStyle = 'rgba(255,209,102,0.45)'; g.beginPath(); g.arc(x, y, r, 0, Math.PI * 2); g.stroke();
  if (fill > 0 && on) {
    const k = Math.min(1, fill), gr = Math.round(209 - 150 * k), b = Math.round(102 - 60 * k);
    g.strokeStyle = `rgb(255,${gr},${b})`; g.lineWidth = Math.max(2.5, ts * 0.12);
    g.beginPath(); g.arc(x, y, r, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * k); g.stroke();
  }
  g.restore();
}

/** 지휘관이 아는 조짐 (AI 시점) */
function cmdSigns(o: CatView): SignBelief[] {
  if (!o.cmd) return [];
  const l = o.cmd.beliefs.list('sign'), out: SignBelief[] = [];
  for (let k = 0; k < l.length; k++) out.push(l[k].value as SignBelief);
  return out;
}

/** 정보 표지 단계: 구획 건전도 빗금 · 가스 등고선 · 용기의 열 고리 */
export function drawCatUnder(g: G, sim: Sim, s: Scene, ts: number, o: CatView): void {
  void sim;
  const c = s.cat;
  if (!c || o.mini) return;
  const t = o.timeMs / 1000, pulse = 0.5 + 0.5 * Math.sin(t * 6);
  if (o.truth) {
    if (c.struct) for (const reg of s.regions) {
      if (!reg.indoor || c.fallen[reg.id]) continue;
      const lv = structLevel(c, reg.id);
      if (lv > 0) hatchRegion(g, s, reg, ts, HATCH[lv], lv === 3 ? 0.35 + 0.35 * pulse : lv === 2 ? 0.45 : 0.32);
    }
    if (c.gas) {
      contour(g, s, c.gas, 0.25, ts, GAS_WARN, Math.max(1.5, ts * 0.05));
      contour(g, s, c.gas, CAT.LEL, ts, GAS_LEL, Math.max(2, ts * 0.08));
    }
    for (const p of s.props) {
      if (!p.vessel || p.exploded || p.removed) continue;
      const h = p.heatLoad ?? 0;
      if (h > 0.02) vesselRing(g, p, ts, h, h >= CAT.VENT_AT, t);
    }
    return;
  }
  for (const v of cmdSigns(o)) {
    if (v.kind === 'struct' && v.level > 0 && v.region >= 0 && v.region < s.regions.length) {
      const reg = s.regions[v.region];
      if (reg.indoor && !c.fallen[reg.id]) hatchRegion(g, s, reg, ts, HATCH[Math.min(3, v.level)], v.level >= 3 ? 0.35 + 0.35 * pulse : v.level === 2 ? 0.45 : 0.32);
    } else if (v.kind === 'vessel' && v.level >= 2 && v.prop !== undefined) {
      const p = s.props[v.prop];
      if (p && !p.removed) vesselRing(g, p, ts, 0, v.level >= 3, t);
    }
  }
}

/** 새 글자 표지 단계의 표지 (renderScene 이 pill 로 그린다) */
export function drawCatOver(sim: Sim, s: Scene, ts: number, o: CatView): HazardLabel[] {
  void sim;
  const c = s.cat, out: HazardLabel[] = [];
  if (!c || o.mini) return out;
  const t = o.timeMs / 1000, at = (x: number, y: number): [number, number] => [(x + 0.5) * ts, (y + 0.5) * ts];
  if (o.truth) {
    if (c.struct) for (const reg of s.regions) {
      if (!reg.indoor || c.fallen[reg.id]) continue;
      const lv = structLevel(c, reg.id);
      const [x, y] = at(reg.cx, reg.cy);
      if (lv === 3) out.push({ x, y, text: '붕괴 임박', color: '#ff5d5d' });
      else if (lv === 2) out.push({ x, y, text: `구조 약화 · 건전도 ${Math.round(c.integ[reg.id] * 100)}%`, color: '#ffb066' });
    }
    if (c.gas) {
      // LEL 을 넘은 칸이 있으면 그 칸들의 가운데에 한 번
      let n = 0, sx = 0, sy = 0;
      for (let i = 0; i < c.gas.length; i++) if (c.gas[i] >= CAT.LEL) { n++; sx += i % s.w; sy += (i / s.w) | 0; }
      if (n) { const [x, y] = at(sx / n, sy / n); out.push({ x, y, text: 'LEL 초과', color: GAS_LEL }); }
    }
    for (const p of s.props) {
      if (!p.vessel || p.exploded || p.removed || (p.heatLoad ?? 0) < CAT.VENT_AT || Math.sin(t * 9) <= -0.2) continue;
      const [x, y] = at(p.x + (p.w - 1) / 2, p.y - 0.4);
      out.push({ x, y: y - ts * 0.5, text: '안전밸브 작동', color: '#ff7a59' });
    }
    return out;
  }
  for (const v of cmdSigns(o)) {
    if (v.region >= s.regions.length) continue;
    if (v.kind === 'struct' && v.level >= 2 && v.region >= 0) {
      const reg = s.regions[v.region];
      if (!reg.indoor || c.fallen[reg.id]) continue;
      const [x, y] = at(reg.cx, reg.cy);
      out.push({ x, y, text: v.level >= 3 ? '붕괴 임박' : '균열·처짐', color: v.level >= 3 ? '#ff5d5d' : '#ffb066' });
    } else if (v.kind === 'gas' && v.region >= 0 && v.level >= 1) {
      const reg = s.regions[v.region];
      const [x, y] = at(reg.cx, reg.cy);
      out.push({ x, y: y + ts * 0.55, text: v.lel !== undefined ? `LEL ${v.lel}%` : '가스 냄새', color: v.level >= 3 ? GAS_LEL : GAS_WARN });
    } else if (v.kind === 'vessel' && v.level >= 3 && v.prop !== undefined && Math.sin(t * 9) > -0.2) {
      const p = s.props[v.prop];
      if (!p || p.removed) continue;
      const [x, y] = at(p.x + (p.w - 1) / 2, p.y - 0.4);
      out.push({ x, y: y - ts * 0.5, text: '안전밸브 작동', color: '#ff7a59' });
    }
  }
  return out;
}
