// 현장 위의 위험 그림 (설계서 X6 §7.3) — 결과 불변: 상태를 읽기만 한다.
//   drawCatUnder: 정보 표지 단계(어둠·날씨 위 — 밤과 안개에도 묻히지 않는다, G4 §2.8)에서 구획 건전도 빗금·가스 등고선·용기의 열 고리를 그린다.
//   drawCatOver:  새 글자 표지 단계(효과 뒤, 대원 이름표 앞)에서 그릴 글자 표지를 돌려준다 — renderScene 의 pill() 이 그린다.
// 관찰자 시점은 진실(Scene.cat — 건전도·가스·용기의 열)을, AI 시점은 지휘관이 아는 조짐(sign 사실)을 그린다(숫자 없이 같은 색).
// s.cat 이 없는 현장(아직 위험 상태를 만들지 않았거나 대상이 아님)은 아무것도 그리지 않는다 — 여기서 위험 상태를 만들지 않는다(만들면 그림이 결과를 바꾼다).
// 모양으로 G4 와 가른다: 무너진 구역 경계는 G4 의 #d6a878 점선, 2차 붕괴 위험 범위는 G4 의 #ffd166 점선 — 건전도는 구획 **안쪽의 빗금**이다.
// 진입 금지 구역(지휘 상태 Scene.ops — 조직이 아는 것이라 두 시점이 같다): 두 색이 번갈아 드는 굵은 테이프 실선 — 단계 2 주황·검정, 단계 3 빨강·흰색
// (G4 의 2차 붕괴 위험 범위 #ffd166 점선과 모양으로 가른다), 구역 위 '진입 금지' / '철수' 표지. 철수 중인 대원의 이름표 '철수'는 실행기가 정한다(a.label)

import type { Sim } from '../../sim/engine';
import { CAT, rollLevel, structLevel } from '../../sim/field/catastrophe';
import type { FieldAgent, NoGoZone, Prop, Region, Scene, SignBelief } from '../../sim/types';
import type { G } from './common';
import type { HazardLabel } from './hazardFx';
import { gasView } from '../hazardState';

export interface CatView { truth: boolean; timeMs: number; mini: boolean; cmd: FieldAgent | undefined }

/** 구조 조짐 단계별 빗금 색: 1 삐걱임(옅은 모래색) · 2 균열·처짐(주황) · 3 임박(빨강, 맥박) */
const HATCH = ['', '#d9c38a', '#ff9a3d', '#ff4d4d'];
const GAS_WARN = '#f4d35e', GAS_LEL = '#ff5d5d', DUST = '#d9b26f';

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

/** 진입 금지 구역 테이프의 두 색 (단계 2 · 3) */
const TAPE: Record<number, [string, string]> = { 2: ['#ff9f1c', '#1b1b1b'], 3: ['#ff3b3b', '#f4f4f4'] };
/** 구역 칸 덩어리의 경계를 두 색이 번갈아 드는 굵은 실선으로 (원 구역은 원) */
function tapeZone(g: G, s: Scene, z: NoGoZone, ts: number): void {
  const [c1, c2] = TAPE[z.level] ?? TAPE[2];
  const w = s.w, h = s.h, lw = Math.max(2.5, ts * 0.13), dash = Math.max(4, ts * 0.32);
  g.save();
  g.beginPath();
  if (z.regions.length) {
    const inZ = new Uint8Array(w * h);
    for (const r of z.regions) { const reg = s.regions[r]; if (reg) for (const i of reg.tiles) inZ[i] = 1; }
    for (let y = 0, i = 0; y < h; y++) for (let x = 0; x < w; x++, i++) {
      if (!inZ[i]) continue;
      const X = x * ts, Y = y * ts;
      if (x + 1 >= w || !inZ[i + 1]) { g.moveTo(X + ts, Y); g.lineTo(X + ts, Y + ts); }
      if (x <= 0 || !inZ[i - 1]) { g.moveTo(X, Y); g.lineTo(X, Y + ts); }
      if (y + 1 >= h || !inZ[i + w]) { g.moveTo(X, Y + ts); g.lineTo(X + ts, Y + ts); }
      if (y <= 0 || !inZ[i - w]) { g.moveTo(X, Y); g.lineTo(X + ts, Y); }
    }
  }
  if (z.r > 0) { g.moveTo((z.x + 0.5) * ts + z.r * ts, (z.y + 0.5) * ts); g.arc((z.x + 0.5) * ts, (z.y + 0.5) * ts, z.r * ts, 0, Math.PI * 2); }
  g.lineWidth = lw; g.setLineDash([]); g.strokeStyle = c2; g.stroke();
  g.setLineDash([dash, dash]); g.strokeStyle = c1; g.stroke();
  g.setLineDash([]);
  g.restore();
}
/** 구역 표지의 자리 (첫 구역의 가운데 아래 — 구역 이름·'수색 n%' 글자 밑, 원이면 원 위).
 *  (단계 10) 예전에는 가운데 + 0.6 이라 표지가 '수색 n%' 글자(가운데 + 0.36칸, renderScene)를 덮었다 */
function zoneAnchor(s: Scene, z: NoGoZone): [number, number] {
  if (z.regions.length && s.regions[z.regions[0]]) { const reg = s.regions[z.regions[0]]; return [reg.cx, reg.cy + (reg.kind === 'zone' ? 1.25 : 0.9)]; }
  return [z.x, z.y - Math.max(1, z.r * 0.7)];
}
/** 건물 전체의 표지 자리: 실내 구역들의 가운데 줄, 맨 윗 구역의 바로 위 벽 줄 (방 안의 구역 이름·수색% 글자와 겹치지 않게).
 *  위가 현장 끝이면 맨 아래 구역의 바로 아래 */
function bldgAnchor(s: Scene): [number, number] | null {
  let bx = 0, n = 0, y0 = Infinity, y1 = -Infinity;
  for (const r of s.regions) if (r.indoor) { bx += r.cx; n++; if (r.y0 < y0) y0 = r.y0; if (r.y1 > y1) y1 = r.y1; }
  if (!n) return null;
  return [bx / n, y0 >= 1.5 ? y0 - 1 : y1 + 1];
}

/** (§7.3, 단계 10) 잔해에 깔린 대원: 누운 사람 그림 위에 잔해 조각 셋(판 하나·덩어리 둘). 피는 그리지 않는다 — 이름표 '잔해에 깔림'과 빨간 맥박 고리가 함께 읽힌다.
 *  x, y 는 화면 좌표(사람 가운데), seed 는 대원마다 고정 (a.rid) */
export function drawTrappedDebris(g: G, x: number, y: number, ts: number, seed: number): void {
  const h = (k: number): number => { let v = (Math.imul(seed + 101 * k, 374761393) ^ 0x5bd1e995) | 0; v = Math.imul(v ^ (v >>> 13), 1274126177); return ((v ^ (v >>> 16)) >>> 0) / 4294967296; };
  g.save();
  g.translate(x, y); g.scale(ts, ts);
  g.setLineDash([]);
  // 넘어진 판(들보) 하나 — 몸을 비스듬히 가로지른다
  const a = -0.6 + h(1) * 1.2;
  g.save(); g.rotate(a);
  g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(-0.4, -0.05, 0.84, 0.18);
  g.fillStyle = '#6b543a'; g.fillRect(-0.42, -0.1, 0.84, 0.16);
  g.strokeStyle = '#2a2018'; g.lineWidth = 0.025; g.strokeRect(-0.42, -0.1, 0.84, 0.16);
  g.restore();
  // 콘크리트 덩어리 둘
  const cols = ['#8d857a', '#a39a8c'];
  for (let k = 0; k < 2; k++) {
    const cx = (k ? 0.18 : -0.2) + (h(2 + k) - 0.5) * 0.12, cy = (k ? -0.14 : 0.16) + (h(4 + k) - 0.5) * 0.1, r = 0.11 + 0.05 * h(6 + k);
    g.fillStyle = cols[k]; g.strokeStyle = '#2b2a28'; g.lineWidth = 0.022;
    g.beginPath();
    for (let q = 0; q < 6; q++) { const t = (q / 6) * 6.2832 + h(8 + k) * 3, rad = r * (0.72 + 0.45 * h(10 + k * 7 + q)); if (q) g.lineTo(cx + Math.cos(t) * rad, cy + Math.sin(t) * rad); else g.moveTo(cx + Math.cos(t) * rad, cy + Math.sin(t) * rad); }
    g.closePath(); g.fill(); g.stroke();
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
  if (o.mini) return;
  if (s.ops) for (const z of s.ops.zones) tapeZone(g, s, z, ts);      // 진입 금지 구역 (두 시점 같다 — 지휘 상태는 조직이 안다)
  const c = s.cat;
  if (!c) return;
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
  const c = s.cat, out: HazardLabel[] = [];
  if (o.mini) return out;
  const t = o.timeMs / 1000, at = (x: number, y: number): [number, number] => [(x + 0.5) * ts, (y + 0.5) * ts];
  if (s.ops) {
    // 건물 전체(bldg) 구역과 외부 방어는 건물 위 벽 줄에 한 표지로, 그 밖의 구역은 첫 구역 가운데 아래 — 같은 자리에 둘이면 한 줄씩 내린다
    const defensive = s.ops.mode === 'defensive', ba = bldgAnchor(s);
    let bldgDone = false;
    const used: [number, number][] = [];
    for (const z of s.ops.zones) {
      const lab = z.level === 3 ? '철수' : '진입 금지', col = z.level === 3 ? '#ff5d5d' : '#ffb347';
      if (z.kind === 'bldg' && ba) {
        if (bldgDone) continue;
        bldgDone = true;
        const [x, y] = at(ba[0], ba[1]);
        out.push({ x, y, text: defensive ? `${lab} · 외부 방어` : lab, color: col });
        continue;
      }
      const [zx, zy0] = zoneAnchor(s, z);
      let zy = zy0;
      while (used.some(([ux, uy]) => Math.abs(ux - zx) < 1.5 && Math.abs(uy - zy) < 0.5)) zy += 0.55;
      used.push([zx, zy]);
      const [x, y] = at(zx, zy);
      out.push({ x, y, text: lab, color: col });
    }
    if (defensive && !bldgDone && ba) { const [x, y] = at(ba[0], ba[1]); out.push({ x, y, text: '외부 방어', color: '#ff7a59' }); }
  }
  if (!c) return out;
  if (o.truth) {
    if (c.struct) for (const reg of s.regions) {
      if (!reg.indoor || c.fallen[reg.id]) continue;
      const lv = structLevel(c, reg.id);
      const [x, y] = at(reg.cx, reg.cy - 0.5);      // 구역 이름·수색% 글자(가운데와 그 아래) 위에
      if (lv === 3) out.push({ x, y, text: '붕괴 임박', color: '#ff5d5d' });
      else if (lv === 2) out.push({ x, y, text: `구조 약화 · 건전도 ${Math.round(c.integ[reg.id] * 100)}%`, color: '#ffb066' });
    }
    if (c.gas && !gasView(s, sim.tick).danger) {
      // LEL 을 넘은 칸이 있으면 그 칸들의 가운데에 한 번. (단계 10) 폭발 하한 구름(셋 이상)이면 G4 의 가스 경계 표지
      // '가스 LEL 초과 — 폭발 위험'(hazardFx.drawGasEdge — 같은 c.gas 기준)이 같은 자리에 나가므로 겹쳐 내지 않는다
      let n = 0, sx = 0, sy = 0;
      for (let i = 0; i < c.gas.length; i++) if (c.gas[i] >= CAT.LEL) { n++; sx += i % s.w; sy += (i / s.w) | 0; }
      if (n) { const [x, y] = at(sx / n, sy / n); out.push({ x, y, text: 'LEL 초과', color: GAS_LEL }); }
    }
    for (const p of s.props) {
      if (!p.vessel || p.exploded || p.removed || (p.heatLoad ?? 0) < CAT.VENT_AT || Math.sin(t * 9) <= -0.2) continue;
      const [x, y] = at(p.x + (p.w - 1) / 2, p.y - 0.4);
      out.push({ x, y: y - ts * 0.5, text: '안전밸브 작동', color: '#ff7a59' });
    }
    // (단계 9, 선택) 분진 구획 · 롤오버 — 켜져 있을 때만 생긴다
    if (c.dustRegion >= 0 && !c.dustDone) { const reg = s.regions[c.dustRegion]; if (reg) { const [x, y] = at(reg.cx, reg.cy - 1.1); out.push({ x, y, text: '분진 쌓임', color: DUST }); } }
    for (const reg of s.regions) if (rollLevel(c, reg.id) >= 2) { const [x, y] = at(reg.cx, reg.cy - 1.1); out.push({ x, y, text: '롤오버', color: '#ff5d5d' }); }
    return out;
  }
  for (const v of cmdSigns(o)) {
    if (v.region >= s.regions.length) continue;
    if (v.kind === 'struct' && v.level >= 2 && v.region >= 0) {
      const reg = s.regions[v.region];
      if (!reg.indoor || c.fallen[reg.id]) continue;
      const [x, y] = at(reg.cx, reg.cy - 0.5);      // 구역 이름·수색% 글자(가운데와 그 아래) 위에
      out.push({ x, y, text: v.level >= 3 ? '붕괴 임박' : '균열·처짐', color: v.level >= 3 ? '#ff5d5d' : '#ffb066' });
    } else if (v.kind === 'gas' && v.region >= 0 && v.level >= 1) {
      const reg = s.regions[v.region];
      const [x, y] = at(reg.cx, reg.cy - 0.5);      // 구역 이름·수색% 글자(가운데와 그 아래) 위에
      out.push({ x, y: y - ts * 0.6, text: v.lel !== undefined ? `LEL ${v.lel}%` : '가스 냄새', color: v.level >= 3 ? GAS_LEL : GAS_WARN });
    } else if (v.kind === 'vessel' && v.level >= 3 && v.prop !== undefined && Math.sin(t * 9) > -0.2) {
      const p = s.props[v.prop];
      if (!p || p.removed) continue;
      const [x, y] = at(p.x + (p.w - 1) / 2, p.y - 0.4);
      out.push({ x, y: y - ts * 0.5, text: '안전밸브 작동', color: '#ff7a59' });
    } else if ((v.kind === 'dust' && v.level >= 1) || (v.kind === 'fire' && v.level >= 2)) {
      const reg = s.regions[v.region];
      if (!reg) continue;
      const [x, y] = at(reg.cx, reg.cy - 1.1);
      out.push({ x, y, text: v.kind === 'dust' ? '분진 폭발 위험' : '롤오버', color: v.kind === 'dust' ? DUST : '#ff5d5d' });
    }
  }
  return out;
}
