// 현장 위험 상태의 읽기 (docs/specs/G4-scene-legibility.md §5·§6·§7). DOM 이 없는 순수 함수 — 지도·현장·사건 카드가 함께 쓰고 시험이 직접 부른다.
// 관찰자 시점은 진실을, AI 시점은 관제·지휘관이 아는 것(믿음·무전 기록)과 부대가 도착한 뒤의 겉모습을 읽는다(§2.3).
// 상태를 바꾸지 않는다. 비싼 계산은 캐시한다: 현장별 WeakMap<Scene, …>(staticVersion·tick 이 바뀔 때만), 무전 기록은 WeakMap<Sim, …>.

import type { Sim } from '../sim/engine';
import { isIndoor } from '../sim/field/grid';
import { isHeld } from '../sim/field/hazards';
import { SCENARIOS } from '../sim/scenarios';
import { T } from '../sim/types';
import type { Casualty, Incident, Scene } from '../sim/types';
import { dist } from '../sim/util';
import { ICON_PATH } from './icons';
import { HAZARD_MARK, RUIN_MARK } from './marks';

/** 인질 사건의 변형 (인질 구출 칩을 붙이는 곳) */
export const HOSTAGE_VARIANTS = ['hostage', 'siege'];

// ───────────────────────── 무너진 건물 ─────────────────────────
/** 무너진 규모. 열린 값이다(X6 가 열쇠를 더한다) — 모르는 값은 'major' 처럼 그린다 */
export type RuinLevel = 'partial' | 'major' | (string & {});
export interface RuinInfo {
  frac: number;             // 무너진 칸 / 건물 칸 (벽 포함)
  u: number; v: number;     // 무너진 구역 무게중심의 건물 안 상대 위치 (0~1)
  level: RuinLevel;
  secondary: number;        // 2차 붕괴 횟수
  lastFall: number;         // 마지막 무너짐 시각 (없으면 -Infinity)
  material: 'concrete' | 'earth' | 'crane';
}
const isBuildingTile = (t: number): boolean => t === T.FLOOR || t === T.FURN || t === T.DOOR || t === T.STAIR || t === T.WALL || t === T.WINDOW;
const ruinCache = new WeakMap<Scene, { ver: number; nf: number; info: RuinInfo | null }>();

/** 무너진 정도 (진실). 건물 칸이 0 이거나 무너진 칸이 0 이면 null (산사태: 건물 칸이 없다) */
export function ruinInfo(sim: Sim, I: Incident): RuinInfo | null {
  const s = sim.scenes[I.id];
  if (!s) return null;
  const nf = s.falls ? s.falls.length : 0;
  const hit = ruinCache.get(s);
  if (hit && hit.ver === s.staticVersion && hit.nf === nf) return hit.info;
  let info: RuinInfo | null = null;
  let bld = 0, dmg = 0, sx = 0, sy = 0;
  for (let i = 0; i < s.tiles.length; i++) {
    if (isBuildingTile(s.tiles[i])) bld++;
    if (s.damage[i]) { dmg++; sx += i % s.w; sy += (i / s.w) | 0; }
  }
  if (bld > 0 && dmg > 0) {
    const cx = sx / dmg, cy = sy / dmg;
    // 기준 상자: 무게중심에서 가장 가까운 건물 칸에서 시작해 건물 칸을 따라 넓힌 덩어리 (2층 건물은 한 층만)
    let start = -1, bd = Infinity;
    for (let i = 0; i < s.tiles.length; i++) { if (!isBuildingTile(s.tiles[i])) continue; const d = Math.hypot((i % s.w) - cx, ((i / s.w) | 0) - cy); if (d < bd) { bd = d; start = i; } }
    let x0 = s.w, y0 = s.h, x1 = 0, y1 = 0;
    const seen = new Uint8Array(s.w * s.h), st = [start]; seen[start] = 1;
    while (st.length) {
      const c = st.pop()!, x = c % s.w, y = (c / s.w) | 0;
      x0 = Math.min(x0, x); x1 = Math.max(x1, x); y0 = Math.min(y0, y); y1 = Math.max(y1, y);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) continue; const j = ny * s.w + nx; if (!seen[j] && isBuildingTile(s.tiles[j])) { seen[j] = 1; st.push(j); } }
    }
    const clamp01 = (v: number): number => Math.max(0, Math.min(1, v));
    const secondary = s.falls ? s.falls.filter((f) => f.cause === 'secondary').length : 0;
    const frac = dmg / bld;
    info = {
      frac, u: clamp01((cx - x0 + 0.5) / (x1 - x0 + 1)), v: clamp01((cy - y0 + 0.5) / (y1 - y0 + 1)),
      level: frac >= 0.22 || secondary > 0 ? 'major' : 'partial', secondary,
      lastFall: s.falls && s.falls.length ? s.falls[s.falls.length - 1].t : -Infinity,
      material: s.variant === 'landslide' ? 'earth' : s.variant === 'crane' ? 'crane' : 'concrete',
    };
  }
  ruinCache.set(s, { ver: s.staticVersion, nf, info });
  return info;
}

const shownType = (I: Incident, truth: boolean): string => (I.assessment ? I.assessment.type : truth ? I.truth.type : 'unknown');

/** 보이는 변형: 관찰자 시점은 보이는 유형이 진실과 같을 때 진실의 변형, AI 시점은 관제가 붙인 이름(label)에 맞는 시나리오의 변형. 없으면 null */
export function shownVariant(I: Incident, truth: boolean): string | null {
  const shown = shownType(I, truth);
  if (truth) return shown === I.truth.type ? I.truth.variant : null;
  const as = I.assessment;
  if (!as || !as.label || shown !== as.type) return null;
  const sc = SCENARIOS.find((q) => q.type === as.type && (q.label ?? q.name) === as.label);
  return sc ? sc.variant : null;
}
const VARIANT_ICON = new Set(['elevator', 'crane', 'landslide', 'gasblast']);
/** 사건 핀·카드 코드 칩의 아이콘 이름: 붕괴 변형 넷은 새 아이콘, 그 밖은 보이는 유형의 아이콘 */
export function pinIcon(I: Incident, truth: boolean): string {
  const shown = shownType(I, truth);
  if (shown === 'collapse') { const v = shownVariant(I, truth); if (v && VARIANT_ICON.has(v)) return v; }
  return shown;
}

/** 이 사건의 무너진 건물이 지금 보이는가. 'confirmed' = 무너진 모습을 안다, 'reported' = 붕괴 신고만 (AI 시점) */
export function ruinSeen(sim: Sim, I: Incident, truth: boolean): 'confirmed' | 'reported' | 'none' {
  if (I.truth.type !== 'collapse' || I.truth.placeId < 0) return 'none';
  const s = sim.scenes[I.id];
  if (!s || !ruinInfo(sim, I)) return 'none';
  if (truth) return 'confirmed';
  if (I.firstArrivalAt >= 0) return 'confirmed';
  if (I.phase === 'closed') return 'none';      // 끝난 사건: AI 시점은 도착했던 사건만 남는다
  const as = I.assessment;
  if (as && as.type === 'collapse' && I.locationKnown && I.reportedNode === I.truth.nodeId && shownVariant(I, false) !== 'elevator') return 'reported';
  return 'none';
}

/** 지도 마우스 정보의 한 줄 (그 건물에서 난 가장 최근의 붕괴) */
export function ruinLine(sim: Sim, placeId: number, truth: boolean): string | null {
  for (let k = sim.incidents.length - 1; k >= 0; k--) {
    const I = sim.incidents[k];
    if (I.truth.placeId !== placeId) continue;
    const seen = ruinSeen(sim, I, truth);
    if (seen === 'none') continue;
    if (seen === 'reported') return '붕괴 신고 — 아직 확인 전';
    const r = ruinInfo(sim, I)!;
    const p = Math.round(r.frac * 100);
    return r.level === 'partial' ? `무너짐 — 건물의 약 ${p}%` : `크게 무너짐 — 약 ${p}%${r.secondary ? ` · 2차 붕괴 ${r.secondary}회` : ''}`;
  }
  return null;
}
/** 규모 열쇠 → 기호 (모르는 열쇠는 major) */
export const ruinMark = (level: RuinLevel): string => RUIN_MARK[level] ?? RUIN_MARK.major;
/** AI 시점에서 볼 수 있는 2차 붕괴 횟수 (첫 도착 뒤의 것만) */
export function seenSecondary(sim: Sim, I: Incident, truth: boolean): { n: number; last: number } {
  const s = sim.scenes[I.id];
  let n = 0, last = -Infinity;
  if (!s || !s.falls) return { n, last };
  for (const f of s.falls) { if (f.cause !== 'secondary') continue; if (!truth && (I.firstArrivalAt < 0 || f.t < I.firstArrivalAt)) continue; n++; last = f.t; }
  return { n, last };
}

// ───────────────────────── 가스가 찬 범위 ─────────────────────────
export interface GasView {
  gas: Uint8Array | null;   // 칸별 가스 (1). 연두로 그린다. null = 가스 없음
  leaking: boolean;         // 새는 밸브가 있다 (가스 규칙이 도는 현장)
  dense: number;            // 실내 칸 가운데 smoke > 0.6 인 칸 수 (tickGas 의 폭발 판정과 같은 식)
  denseMask: Uint8Array;
  edges: number[];          // denseMask 경계 선분 [x0, y0, x1, y1, …] (칸 모서리 좌표)
  cx: number; cy: number;   // 짙은 칸의 무게중심
}
const gasCache = new WeakMap<Scene, { tick: number; view: GasView }>();
/** 가스가 찬 칸과 폭발 판정 범위. tick 이 바뀔 때만 다시 센다 (가스 확산은 1초에 한 번) */
export function gasView(s: Scene, tick: number): GasView {
  const hit = gasCache.get(s);
  if (hit && hit.tick === tick) return hit.view;
  const n = s.w * s.h;
  const valves = s.props.filter((p) => p.kind === 'valve');
  const leakV = valves.filter((p) => !p.mitigated && !p.ignited && !!p.leakRate);
  const gasRule = s.kind === 'hazmat' || (!!s.rules && s.rules.indexOf('gas') >= 0);
  let gas: Uint8Array | null = null;
  if (s.kind === 'hazmat' && !valves.some((p) => p.ignited)) {
    gas = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (s.smoke[i] >= 0.06) gas[i] = 1;
  } else if (gasRule && leakV.length) {
    // 밸브가 설명하는 농도: 밸브 칸에서 벽이 아닌 칸으로 넓혀 가며 leakRate × 0.86^걸음 (연기 확산의 실내 감쇠와 같다)
    const g = new Float32Array(n);
    for (const p of leakV) {
      const step = new Int16Array(n).fill(-1), q = [p.y * s.w + p.x]; step[q[0]] = 0;
      for (let k = 0; k < q.length; k++) {
        const c = q[k], val = p.leakRate! * Math.pow(0.86, step[c]);
        if (val > g[c]) g[c] = val;
        if (val < 0.05) continue;
        const x = c % s.w, y = (c / s.w) | 0;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) continue; const j = ny * s.w + nx; if (step[j] < 0 && s.tiles[j] !== T.WALL) { step[j] = step[c] + 1; q.push(j); } }
      }
    }
    gas = new Uint8Array(n);
    for (let i = 0; i < n; i++) if (s.smoke[i] >= 0.12 && g[i] >= 0.6 * s.smoke[i]) gas[i] = 1;
    for (const p of leakV) gas[p.y * s.w + p.x] = 1;      // 새는 밸브 칸은 늘 가스
  }
  const denseMask = new Uint8Array(n);
  let dense = 0, sx = 0, sy = 0;
  for (let i = 0; i < n; i++) if (s.smoke[i] > 0.6 && isIndoor(s.tiles[i])) { denseMask[i] = 1; dense++; sx += i % s.w; sy += (i / s.w) | 0; }
  const edges: number[] = [];
  if (dense && gasRule && leakV.length) {
    const m = (x: number, y: number): boolean => x >= 0 && y >= 0 && x < s.w && y < s.h && denseMask[y * s.w + x] === 1;
    for (let y = 0; y <= s.h; y++) { let run = -1; for (let x = 0; x <= s.w; x++) { const on = x < s.w && m(x, y - 1) !== m(x, y); if (on && run < 0) run = x; if (!on && run >= 0) { edges.push(run, y, x, y); run = -1; } } }
    for (let x = 0; x <= s.w; x++) { let run = -1; for (let y = 0; y <= s.h; y++) { const on = y < s.h && m(x - 1, y) !== m(x, y); if (on && run < 0) run = y; if (!on && run >= 0) { edges.push(x, run, x, y); run = -1; } } }
  }
  const view: GasView = { gas, leaking: gasRule && leakV.length > 0, dense, denseMask, edges, cx: dense ? sx / dense : 0, cy: dense ? sy / dense : 0 };
  gasCache.set(s, { tick, view });
  return view;
}

// ───────────────────────── 되살아난 불 ─────────────────────────
const REKINDLE_TEXT = '꺼진 줄 알았던 불이 다시';
const radioCache = new WeakMap<Sim, { next: number; last: Map<number, Map<number, number>> }>();
/** 무전 기록에서 '꺼진 줄 알았던 불이 다시' 를 찾아 사건·방별 마지막 시각을 둔다 (기록은 뒤에 붙기만 한다 — 새 것만 훑는다) */
function rekindleRadio(sim: Sim): Map<number, Map<number, number>> {
  let c = radioCache.get(sim);
  if (!c) { c = { next: 0, last: new Map() }; radioCache.set(sim, c); }
  for (; c.next < sim.events.length; c.next++) {
    const e = sim.events[c.next];
    if (e.kind !== 'radio' || e.incidentId < 0 || e.text.indexOf(REKINDLE_TEXT) < 0) continue;
    const s = sim.scenes[e.incidentId];
    if (!s) continue;
    let best: { id: number; len: number } | null = null;
    for (const r of s.regions) if (e.text.startsWith(r.name + '에서') && (!best || r.name.length > best.len)) best = { id: r.id, len: r.name.length };
    if (!best) continue;
    let m = c.last.get(e.incidentId);
    if (!m) { m = new Map(); c.last.set(e.incidentId, m); }
    m.set(best.id, e.t);
  }
  return c.last;
}
const rekCache = new WeakMap<Scene, { tick: number; truth: boolean; ids: number[] }>();
/** 되살아난 불이 있는 방 (구역 번호). 관찰자: 지휘관은 꺼졌다고 알지만(≤ 0.05) 진실의 불이 0.1 이상. AI: '다시 번지고 있습니다' 무전 뒤 15초 */
export function rekindledRegions(sim: Sim, s: Scene, truth: boolean): number[] {
  const hit = rekCache.get(s);
  if (hit && hit.tick === sim.tick && hit.truth === truth) return hit.ids;
  const ids: number[] = [];
  if (truth) {
    const cmd = s.agents.find((a) => a.isCommander);
    if (cmd) for (const r of s.regions) {
      if (!r.indoor) continue;
      const b = cmd.beliefs.val<number>('fire', r.id);
      if (b === undefined || b > 0.05) continue;
      let mx = 0; for (const i of r.tiles) if (s.fire[i] > mx) mx = s.fire[i];
      if (mx >= 0.1) ids.push(r.id);
    }
  } else {
    const m = rekindleRadio(sim).get(s.incidentId);
    if (m) for (const [rid, t] of m) if (sim.t - t >= 0 && sim.t - t < 15) ids.push(rid);
  }
  rekCache.set(s, { tick: sim.tick, truth, ids });
  return ids;
}

// ───────────────────────── 붙잡힌 인질 ─────────────────────────
export type HostageState = 'held' | 'window' | 'guarded' | 'confined' | 'freed';
/** 인질(c.hostage)의 상태와 그 상태를 만든 용의자 (-1 = 없음). 'held' 는 hazards.isHeld 와 같은 판정 — 어느 용의자든 본다 */
export function hostageState(sim: Sim, s: Scene, c: Casualty): { state: HostageState; by: number } {
  if (c.dead || c.where !== 'scene') return { state: 'freed', by: -1 };
  const near = (r: number, gun: boolean, stunned: boolean | null): number => {
    let best = -1, bd = Infinity;
    for (const h of s.hostiles) {
      if (h.state !== 'hold' && h.state !== 'fight') continue;
      if (gun && h.weapon !== 'gun') continue;
      if (stunned !== null && (sim.t < h.stunUntil) !== stunned) continue;
      const d = dist(h.x, h.y, c.x, c.y);
      if (d <= r && d < bd) { bd = d; best = h.id; }
    }
    return best;
  };
  if (isHeld(sim, s, c.id)) return { state: 'held', by: near(3.2, true, false) };
  const win = near(3.2, true, true);
  if (win >= 0) return { state: 'window', by: win };
  if (c.walking) return { state: 'freed', by: -1 };
  const g = near(5, false, false);
  if (g >= 0) return { state: 'guarded', by: g };
  return { state: 'confined', by: -1 };
}

// ───────────────────────── 사건 카드의 위험 칩 ─────────────────────────
export interface HazardChip { key: string; mark: string; text: string; color: string; tone: 'info' | 'warn' | 'bad' | 'ok' }
const fireCache = new WeakMap<Scene, { tick: number; n: number }>();
function fireRooms(sim: Sim, s: Scene): number {
  const hit = fireCache.get(s);
  if (hit && hit.tick === sim.tick) return hit.n;
  let n = 0;
  if (s.burning > 0) for (const r of s.regions) { if (!r.indoor) continue; for (const i of r.tiles) if (s.fire[i] >= 0.1) { n++; break; } }
  fireCache.set(s, { tick: sim.tick, n });
  return n;
}
const ORDER = ['secondary', 'gasDense', 'hostage', 'bomb', 'ruin', 'crack', 'fire', 'gas'];

/** 사건 카드에 붙일 위험 칩 (많아야 넷, 우선순위: 2차 붕괴 > 가스 고임 > 인질 > 폭발물 > 붕괴 > 균열 > 불 > 가스 누출) */
export function hazardChips(sim: Sim, I: Incident, truth: boolean): HazardChip[] {
  const s = sim.scenes[I.id];
  if (!s) return [];
  const out: HazardChip[] = [];
  const cmd = s.agents.find((a) => a.isCommander);
  const haz = cmd ? cmd.beliefs.list('haz') : [];
  // 붕괴·2차 붕괴
  const seen = ruinSeen(sim, I, truth), info = seen !== 'none' ? ruinInfo(sim, I) : null;
  if (info) {
    if (seen === 'reported') out.push({ key: 'ruin', mark: RUIN_MARK.partial, text: '붕괴 신고', color: '#d6a878', tone: 'info' });
    else {
      out.push({ key: 'ruin', mark: ruinMark(info.level), text: info.level === 'partial' ? '일부 붕괴' : '크게 붕괴', color: '#d6a878', tone: 'info' });
      const sec = seenSecondary(sim, I, truth);
      if (sec.n > 0) out.push({ key: 'secondary', mark: RUIN_MARK.major, text: `2차 붕괴 ${sec.n}회`, color: '#ff5d5d', tone: 'bad' });
    }
  }
  // 균열 (남은 것 · 보강한 것)
  {
    let left = 0, shored = 0;
    if (truth) { for (const p of s.props) if (p.kind === 'unstable' && !p.removed) { if (p.mitigated) shored++; else left++; } }
    else for (const f of haz) { const p = s.props[f.id]; if (!p || p.kind !== 'unstable') continue; if (f.value.active) left++; else shored++; }
    if (left + shored > 0) out.push({ key: 'crack', mark: HAZARD_MARK.crack, text: `균열 ${left} · 보강 ${shored}`, color: left > 0 ? '#ffd166' : '#5ad17a', tone: left > 0 ? 'warn' : 'ok' });
  }
  // 가스
  if (truth) {
    const gv = gasView(s, sim.tick);
    if (gv.leaking) out.push(gv.dense >= 10 ? { key: 'gasDense', mark: HAZARD_MARK.gas, text: '가스 고임 — 폭발 위험', color: '#ff5d5d', tone: 'bad' } : { key: 'gas', mark: HAZARD_MARK.gas, text: '가스 누출', color: '#d6f06a', tone: 'info' });
  } else if (haz.some((f) => { const p = s.props[f.id]; return !!p && p.kind === 'valve' && f.value.active; })) out.push({ key: 'gas', mark: HAZARD_MARK.gas, text: '가스 누출', color: '#d6f06a', tone: 'info' });
  // 불
  {
    let n = 0;
    if (truth) n = fireRooms(sim, s);
    else if (cmd) for (const f of cmd.beliefs.list('fire')) if ((f.value as number) > 0.05) n++;
    const rek = n > 0 && rekindledRegions(sim, s, truth).length > 0;
    if (n > 0) out.push({ key: 'fire', mark: ICON_PATH.fire, text: `불 ${n}곳${rek ? ' · 되살아남' : ''}`, color: '#ff6b3d', tone: rek ? 'bad' : 'warn' });
  }
  // 폭발물 (남은 것 · 처리한 것 · 터진 것). 터진 자리는 겉모습이므로 AI 시점도 진실의 exploded 로 가른다
  {
    let n = 0, m = 0, k = 0;
    if (truth) { for (const p of s.props) if (p.kind === 'bomb') { if (p.exploded) k++; else if (p.mitigated) m++; else n++; } }
    else for (const f of haz) { if (f.value.kind !== 'bomb') continue; if (f.value.active) n++; else if (s.props[f.id] && s.props[f.id].exploded) k++; else m++; }
    if (n + m + k > 0) out.push({ key: 'bomb', mark: HAZARD_MARK.bombHazard, text: `폭발물 ${n}${m ? ` · 처리 ${m}` : ''}${k ? ` · 터짐 ${k}` : ''}`, color: n > 0 || k > 0 ? '#ff5d5d' : '#5ad17a', tone: n > 0 || k > 0 ? 'bad' : 'ok' });
  }
  // 인질
  if (truth) {
    let held = 0, win = false;
    for (const c of s.casualties) { if (!c.hostage) continue; const st = hostageState(sim, s, c).state; if (st === 'held' || st === 'window') { held++; if (st === 'window') win = true; } }
    if (held > 0) out.push({ key: 'hostage', mark: HAZARD_MARK.hostage, text: `인질 붙잡힘 ${held}${win ? ' · 구출 기회' : ''}`, color: win ? '#ffd166' : '#ff5d5d', tone: win ? 'warn' : 'bad' });
    else if (HOSTAGE_VARIANTS.indexOf(s.variant) >= 0) {
      const freed = s.casualties.filter((c) => c.hostage && !c.dead && (c.where === 'safe' || c.where === 'loaded' || c.where === 'hospital')).length;
      if (freed > 0) out.push({ key: 'hostage', mark: HAZARD_MARK.hostage, text: `인질 구출 ${freed}`, color: '#5ad17a', tone: 'ok' });
    }
  } else if (cmd && cmd.beliefs.list('hos').some((f) => f.value.hostage && (f.value.state === 'hold' || f.value.state === 'fight'))) out.push({ key: 'hostage', mark: HAZARD_MARK.hostage, text: '인질 붙잡힘', color: '#ff5d5d', tone: 'bad' });
  out.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
  return out.slice(0, 4);
}
