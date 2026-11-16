// 위험의 현실화 (docs/specs/X6-catastrophe.md §5) — 지휘 규칙. 지휘관의 믿음(a.beliefs — 조짐·불·구조 대상·동료·위험 소품 사실)과
// 지휘 상태(Scene.ops — 조직이 아는 것), 생김새(구역·이웃 구역·건물 칸)만 읽는다. 위험 상태의 진실(구조 건전도·가스 격자·용기의 열)은 읽지 않는다.
//   위험 단계: DANGER_RULES(표 — R3 가 줄을 늘린다) → dangerMap → 구역별 단계(0~3)와 원(용기)
//   단계 1 조짐: 막는 조치를 먼저 · 그 구역의 진압·수색은 한 사람씩
//   단계 2 위험: 진입 금지 구역 (허락된 일만 — ops.ts 의 문 gateBlocks)
//   단계 3 임박: 전원 철수 (명령 + 공기 경적 + 인원 점검) · 건물 단위면 외부 방어
//   다시 들어가는 조건(§5.7) · 제한적 구조 진입(§5.6) · 냉각·가스 재측정·도시가스 차단 요청(§5.8) · 위험 조짐 기록(DANGER_SIGN) · 지원 요청·상황 보고(§5.9)
// (단계 6) 사건의 끝 — 잔해 수색 국면(rubbleStep: 전체 붕괴 30초 · 구획 붕괴 25초 뒤), 다 탄 현장의 외부 확인 종료(extClose), 종료를 막는 것(registerBlocker) — 파일 끝.

import type { Sim } from '../../engine';
import { emit, markRecoveredBy, raiseProblem } from '../../events';
import { T } from '../../types';
import type { CasBelief, Fact, FieldAgent, Incident, MateBelief, NoGoZone, OpsState, Scene, SignBelief } from '../../types';
import { fmtSec, josa } from '../../util';
import { hasKit } from '../../crews';
import { inShadow, regionNameAt, resp, transmit } from '../agents';
import { mkFact } from '../beliefs';
import { pushFx } from '../hazards';
import { OPS_ID, OPS_PAR, SIGN_BASE, bumpZones, gateBlocks, newOps, opsExterior, regionAt, regionNbrs, structScene, zoneLevelAt, zoneMask, zonesVer } from '../ops';
import type { OpsFact } from '../ops';
import { registerBlocker, registerGate, registerOrders } from '../sceneRegistry';
import type { CommandKit } from '../sceneRegistry';

// ───────────────────────── 위험 단계 (§5.2) ─────────────────────────

/** 위험 단계 표의 한 줄이 낸 것: 구역 키·종류·단계(1~3)·구역 목록·원·까닭·근거 사실의 시각(해제한 키를 다시 올릴 때 견준다) */
export interface DangerHit { key: string; kind: NoGoZone['kind']; level: number; regions: number[]; x: number; y: number; r: number; why: string; t: number }
/** 표가 읽는 것 (믿음과 기억만) */
export interface DangerCtx {
  sim: Sim; s: Scene; a: FieldAgent; ops: OpsState;
  signs: Fact[];                                   // 지휘관의 조짐 사실
  fire: (r: number) => number;                     // 구역의 불 믿음
  liveCas: (regions: number[]) => boolean;         // 그 구역들 안에 살아 있는 구조 대상(현장·위중 이하)을 아는가
  rooms: (r: number) => number[];                  // 그 구역과 이웃 **방** (복도는 넣지 않는다 — 조짐이 난 구역 자신이 복도이면 그 복도는 든다)
  indoor: number[];                                // 실내 구역 번호들
}
/** 위험 단계 표의 줄 (R3 가 줄을 늘리고, 이긴 줄을 세려고 id 를 붙인다 — 모양을 바꾸지 않는 선택 칸) */
export interface DangerRule { id?: string; run: (cx: DangerCtx, out: DangerHit[]) => void }

const hit = (out: DangerHit[], key: string, kind: NoGoZone['kind'], level: number, regions: number[], why: string, t: number, x = -1, y = -1, r = 0): void => { out.push({ key, kind, level, regions, x, y, r, why, t }); };
const signsOf = (cx: DangerCtx, kind: SignBelief['kind']): Fact[] => cx.signs.filter((f) => (f.value as SignBelief).kind === kind);

/** 위험 단계 표 (§5.2) — 믿음 → 구역별 단계 */
export const DANGER_RULES: DangerRule[] = [
  // 구조 조짐: 1 기록만 · 2 → 1 · 3 → 3 (그 구역과 이웃 방)
  { run: (cx, out) => { for (const f of signsOf(cx, 'struct')) { const v = f.value as SignBelief; if (v.region < 0) continue; if (v.level === 2) hit(out, `struct:${v.region}`, 'struct', 1, [v.region], '구조 균열·처짐', f.t); else if (v.level >= 3) hit(out, `struct:${v.region}`, 'struct', 3, cx.rooms(v.region), '붕괴 임박', f.t); } } },
  // 그 구역이나 이웃 구역이 25초 안에 무너짐 → 3 (재붕괴 위험)
  { run: (cx, out) => { for (const f of signsOf(cx, 'event')) { const v = f.value as SignBelief; if (v.what === 'partial' && v.region >= 0 && cx.sim.t - f.t <= 25) hit(out, `struct:${v.region}`, 'struct', 3, cx.rooms(v.region), '재붕괴 위험', f.t); } } },
  // 센 불(믿음 ≥ 0.5)이 150초 넘음 → 1 · 260초 넘음 → 3 (그 구역에 살아 있는 구조 대상을 알면 2)
  { run: (cx, out) => {
    for (const k in cx.ops.burnSince) {
      const r = +k, el = cx.sim.t - cx.ops.burnSince[k];
      if (el > 260) hit(out, `struct:${r}`, 'struct', cx.liveCas([r]) ? 2 : 3, [r], '장시간 연소 — 붕괴 우려', cx.ops.burnSince[k] + 260);
      else if (el > 150) hit(out, `struct:${r}`, 'struct', 1, [r], '장시간 연소', cx.ops.burnSince[k] + 150);
    }
  } },
  // 가스 조짐: 1·2 → 1 · 3 → 2 · 2 이상이고 같은 구역·이웃 구역의 불 ≥ 0.15 → 3 (가스 구역과 그 이웃)
  { run: (cx, out) => {
    for (const f of signsOf(cx, 'gas')) {
      const v = f.value as SignBelief;
      if (v.region < 0 || v.level < 1) continue;
      let fire = cx.fire(v.region) >= 0.15;
      if (!fire && v.level >= 2) for (const n of regionNbrs(cx.s)[v.region] ?? []) if (cx.fire(n) >= 0.15) { fire = true; break; }
      if (v.level >= 2 && fire) hit(out, `gas:${v.region}`, 'gas', 3, cx.rooms(v.region), '가스와 불길 — 폭발 위험', f.t);
      else hit(out, `gas:${v.region}`, 'gas', v.level >= 3 ? 2 : 1, [v.region], '가스 농도 위험', f.t);
    }
  } },
  // 가스 용기(haz gas, 살아 있음) + 그 구역 불 ≥ 0.3 → 2 (원 4칸) · 용기 조짐 2 → 2 (원 5칸) · 3 → 3 (원 6칸)
  { run: (cx, out) => {
    for (const f of cx.a.beliefs.list('haz')) {
      const v = f.value as { kind: string; active: boolean; x: number; y: number };
      if (v.kind !== 'gas' || !v.active) continue;
      const rg = regionAt(cx.s, Math.round(v.y) * cx.s.w + Math.round(v.x));
      if (rg >= 0 && cx.fire(rg) >= 0.3) hit(out, `vessel:${f.id}`, 'vessel', 2, [], '용기 곁 불길', f.t, v.x, v.y, 4);
    }
    for (const f of signsOf(cx, 'vessel')) {
      const v = f.value as SignBelief;
      if (v.prop === undefined || v.level < 2) continue;
      hit(out, `vessel:${v.prop}`, 'vessel', v.level >= 3 ? 3 : 2, [], v.level >= 3 ? '용기 폭발 임박' : '용기 가열', f.t, v.x, v.y, v.level >= 3 ? 6 : 5);
    }
  } },
  // 롤오버(fire 조짐 2) → 2 그 방 · 분진 조짐 + 그 구역 불 ≥ 0.3 → 2 (선택 규칙의 조짐 — 단계 9 전에는 들어오지 않는다)
  { run: (cx, out) => {
    for (const f of signsOf(cx, 'fire')) { const v = f.value as SignBelief; if (v.level >= 2 && v.region >= 0) hit(out, `fire:${v.region}`, 'fire', 2, [v.region], '플래시오버 임박', f.t); }
    for (const f of signsOf(cx, 'dust')) { const v = f.value as SignBelief; if (v.level >= 1 && v.region >= 0 && cx.fire(v.region) >= 0.3) hit(out, `dust:${v.region}`, 'dust', 2, [v.region], '분진 폭발 위험', f.t); }
  } },
  // 건물: 조짐 1(신고 내용으로만) 기록만 · 2 → 1 · 3, 또는 구조 조짐 3 인 구역이 둘 이상 → 3 건물 전체(외부 방어)
  { run: (cx, out) => {
    const b = cx.a.beliefs.get('sign', SIGN_BASE.bldg);
    if (b && b.verified) { const lv = (b.value as SignBelief).level; if (lv === 2) hit(out, 'bldg', 'bldg', 1, cx.indoor, '건물 외벽 균열', b.t); else if (lv >= 3) hit(out, 'bldg', 'bldg', 3, cx.indoor, '건물 전체 붕괴 위험', b.t); }
    let n = 0, t = -1;
    for (const f of signsOf(cx, 'struct')) if ((f.value as SignBelief).level >= 3) { n++; t = Math.max(t, f.t); }
    if (n >= 2) hit(out, 'bldg', 'bldg', 3, cx.indoor, `붕괴 임박 구역 ${n}곳`, t);
  } },
  // 다 탄 듯한 건물: 실내 구역의 50% 이상이 불 ≥ 0.6 이고 그 구역들의 센 불이 120초 넘음 → 3 (살아 있는 구조 대상을 알면 2) 건물 전체
  { run: (cx, out) => {
    if (!cx.indoor.length) return;
    let n = 0, t = -1;
    for (const r of cx.indoor) { const b = cx.ops.burnSince[r]; if (cx.fire(r) >= 0.6 && b !== undefined && cx.sim.t - b > 120) { n++; t = Math.max(t, b + 120); } }
    if (n * 2 >= cx.indoor.length) hit(out, 'bldg', 'bldg', cx.liveCas(cx.indoor) ? 2 : 3, cx.indoor, '건물 대부분이 불길에 휩싸임', t);
  } },
];

/** 구역 키의 이름 (기록 문구) */
function zoneName(s: Scene, h: { key: string; kind: NoGoZone['kind']; regions: number[]; x: number; y: number }): string {
  if (h.kind === 'bldg') return '건물 전체';
  if (h.kind === 'vessel') return `${regionNameAt(s, h.x, h.y)} 용기 주변`;
  const r0 = +h.key.slice(h.key.indexOf(':') + 1);
  const reg = s.regions[r0];
  return reg ? (h.regions.length > 1 ? `${reg.name} 일대` : reg.name) : '현장';
}

/**
 * 지휘관의 믿음과 기억만으로 구역별 위험 단계(키마다 하나 — 같은 키의 줄은 높은 단계·구역의 합집합·늦은 시각으로 합친다)를 만든다.
 * raw = 해제·제한적 진입을 덮기 전의 단계 (위험 조짐 기록의 가라앉음이 본다)
 */
export function dangerMap(sim: Sim, s: Scene, a: FieldAgent, ops: OpsState): { hits: Map<string, DangerHit>; raw: Map<string, number> } {
  const B = a.beliefs;
  const nb = regionNbrs(s);
  const indoor: number[] = [];
  for (const r of s.regions) if (r.indoor) indoor.push(r.id);
  const cx: DangerCtx = {
    sim, s, a, ops, signs: B.list('sign'), indoor,
    fire: (r) => B.val<number>('fire', r) ?? 0,
    liveCas: (regions) => { for (const f of B.list('cas')) { const c = f.value as CasBelief; if (c.where === 'scene' && c.band < 3 && regions.indexOf(regionAt(s, c.y * s.w + c.x)) >= 0) return true; } return false; },
    rooms: (r) => { const out = [r]; for (const n of nb[r] ?? []) if (s.regions[n].kind === 'room') out.push(n); return out; },
  };
  const list: DangerHit[] = [];
  for (const rule of DANGER_RULES) rule.run(cx, list);
  const hits = new Map<string, DangerHit>(), raw = new Map<string, number>();
  for (const h of list) {
    const cur = hits.get(h.key);
    if (!cur) { hits.set(h.key, { ...h, regions: h.regions.slice() }); continue; }
    if (h.level > cur.level) { cur.level = h.level; cur.why = h.why; if (h.r > 0) { cur.x = h.x; cur.y = h.y; cur.r = h.r; } }
    for (const r of h.regions) if (cur.regions.indexOf(r) < 0) cur.regions.push(r);
    cur.t = Math.max(cur.t, h.t);
  }
  // 원천 차단(밸브 차단을 알거나 도시가스 차단 완료 통보)을 안 지 60초 → 가스 단계 3 은 2 로 (§5.7)
  const cut = cutoffAt(a);
  if (cut >= 0 && sim.t - cut >= 60) for (const h of hits.values()) if (h.kind === 'gas' && h.level >= 3) { h.level = 2; h.why = '원천 차단 — 가스가 빠지는 중'; }
  // 구조 안정 (§5.2 마지막 줄): 건물 단계 3 인데 모든 구역의 불 ≤ 0.3 이고 90초 동안 새 사건·조짐 상승이 없다 → 2
  const bh = hits.get('bldg');
  if (bh && bh.level >= 3 && sim.t - ops.quietSince >= 90 && indoor.every((r) => cx.fire(r) <= 0.3)) { bh.level = 2; bh.why = '구조 안정 — 허락된 일만'; }
  // (단계 6 — §6.1·§5.7) 무너진 건물: 전체 붕괴를 안 지 30초가 지나면 더 무너질 것이 없다 — 구조·건물 단계를 내지 않는다 (잔해 수색 국면).
  // 그 전 30초는 건물 전체가 철수 구역이다 (재붕괴 위험). 잔해 수색을 허락한 구획(ops.rubble)도 구조 단계(센 불 260초 줄 등)를 내지 않는다 — 이미 무너진 구획이다
  const tAll = totalKnownAt(cx.signs);
  for (const [k, h] of hits) {
    if (h.kind !== 'struct' && h.kind !== 'bldg') continue;
    if (tAll >= 0 && sim.t - tAll >= RUBBLE_TOTAL) hits.delete(k);
    else if (h.kind === 'struct' && ops.rubble.length && ops.rubble.indexOf(+k.slice(7)) >= 0) hits.delete(k);
    else if (h.kind === 'bldg' && tAll >= 0) { h.level = 3; h.why = '붕괴 직후 — 2차 붕괴 위험'; h.t = Math.max(h.t, tAll); }
  }
  for (const [k, h] of hits) raw.set(k, h.level);
  // 해제한 키는 그 뒤에 새로 들어온 사실로만 다시 올린다 (같은 낡은 믿음으로 곧바로 다시 단계 3 이 되지 않게 — §5.7)
  for (const [k, h] of hits) { const c = ops.cleared[k]; if (c !== undefined && h.t <= c) hits.delete(k); }
  // 제한적 구조 진입 중인 구역은 40초 동안 단계 2 (§5.6). 그 뒤의 새 조짐이 오르면 끝난다
  for (const [k, h] of hits) { const e = ops.entry[k]; if (e && sim.t < e.until && h.level >= 3 && h.t <= e.last) h.level = 2; }
  return { hits, raw };
}
/** 전체 붕괴 뒤 잔해 수색까지 기다리는 초 (§6.1) · 구획 붕괴 뒤 그 구획의 잔해 수색까지 (이웃에서 새 무너짐이 없어야 한다) */
const RUBBLE_TOTAL = 30, RUBBLE_PART = 25;
/** 전체 붕괴(사건 소리, 또는 늦게 닿아 본 잔해 더미)를 안 시각 (-1 = 모른다) */
function totalKnownAt(signs: Fact[]): number {
  let t = -1;
  for (const f of signs) { const v = f.value as SignBelief; if (v.kind === 'event' && v.what === 'total' && (t < 0 || f.t < t)) t = f.t; }
  return t;
}
/** 원천 차단을 안 시각 (-1 = 모른다): 도시가스 차단 완료 통보, 또는 아는 누출이 모두 멈췄다(멈춘 것을 하나 이상 안다) */
function cutoffAt(a: FieldAgent): number {
  const u = a.beliefs.get('sign', SIGN_BASE.utility);
  if (u) return u.t;
  let off = -1, live = false;
  for (const f of a.beliefs.list('haz')) { const v = f.value as { kind: string; active: boolean }; if (v.kind !== 'leak') continue; if (v.active) live = true; else off = Math.max(off, f.t); }
  return live ? -1 : off;
}

// ───────────────────────── 지휘 상태의 작업 기억 (Scene.ops 밖 — 모양을 바꾸지 않는다) ─────────────────────────
interface OpsWork {
  sent: number;                                    // 마지막으로 무전에 실은 구역 목록의 판
  lowSince: Map<string, number>;                   // 구역 키 → 원하는 단계가 지금 단계보다 낮아진 시각
  lastT: Map<string, number>;                      // 구역 키 → 근거 사실의 마지막 시각 (해제할 때 cleared 에 적는다)
  told: Set<string>;                               // '구조 대상이 남아 있다'를 남긴 구역 키
  danger: Map<string, { detail: string; t: number; done: boolean; calm: boolean }>;      // DANGER_SIGN 을 남긴 키 (가라앉으면 복구, 사건이 나면 미복구로 남긴다). calm = 끝난 뒤 단계가 2 아래로 내려간 적이 있다 (그래야 다시 남긴다)
  evSeen: number;                                  // 상황 보고에 실은 마지막 사건 번호
  resendAt: number;                                // 인원 점검의 마지막 재송신 시각
  reqT: Map<string, number>;                       // 구역 키별 지원 요청 시각
  rubbleAll: boolean;                              // (단계 6) 전체 붕괴의 잔해 수색을 시작했다 (믿음 고치기·기록은 한 번)
}
const WORK = new WeakMap<OpsState, OpsWork>();
function workOf(ops: OpsState): OpsWork {
  let w = WORK.get(ops);
  if (!w) { w = { sent: 0, lowSince: new Map(), lastT: new Map(), told: new Set(), danger: new Map(), evSeen: -1, resendAt: -1, reqT: new Map(), rubbleAll: false }; WORK.set(ops, w); }
  return w;
}
/** 구역 목록을 실어 보낼 지휘 상태 사실 (id 0) */
function opsFact(sim: Sim, ops: OpsState, me: string): Fact {
  const v: OpsFact = { mode: ops.mode, zones: ops.zones.map((z) => ({ key: z.key, kind: z.kind, level: z.level, regions: z.regions, x: z.x, y: z.y, r: z.r })), t: sim.t };
  const n3 = ops.zones.filter((z) => z.level === 3).length, n2 = ops.zones.length - n3;
  return mkFact('ops', OPS_ID, v, me, sim.t, 1, true, ops.zones.length ? `지휘 상태: 철수 구역 ${n3} · 진입 금지 구역 ${n2}` : '지휘 상태: 진입 제한 없음');
}
const live = (b: FieldAgent): boolean => b.status === 'active';
/** 그 구역(들) 안에 서 있는 활동 대원 */
function agentsIn(s: Scene, zones: NoGoZone[]): FieldAgent[] {
  const m = zoneMask(s, zones), out: FieldAgent[] = [];
  for (const b of s.agents) if (live(b) && m[Math.round(b.y) * s.w + Math.round(b.x)] >= 3) out.push(b);
  return out;
}

// ───────────────────────── 문 (§5.3) ─────────────────────────
registerGate((sim, s, a, kind, tg) => s.ops !== undefined && gateBlocks(sim, s, a, kind, tg));

// ───────────────────────── 지휘 규칙 ─────────────────────────
registerOrders((sim, s, I, a, k) => {
  const B = a.beliefs;
  const signs = B.list('sign');
  // 위험 조짐도 지휘 상태도 없으면 할 일이 없다 — 대부분의 현장은 여기서 돌아간다
  if (!s.ops) {
    let any = false;
    for (const f of signs) { const v = f.value as SignBelief; if (f.verified && v.level >= 1 && v.kind !== 'event') { any = true; break; } }
    if (!any && structScene(s)) for (const r of s.regions) if (r.indoor && (B.val<number>('fire', r.id) ?? 0) >= 0.5) { any = true; break; }
    if (!any) for (const f of B.list('haz')) if (f.value.kind === 'gas' && f.value.active) { any = true; break; }
    if (!any) return;
    s.ops = newOps(sim.t);
  }
  const ops = s.ops, wk = workOf(ops), me = resp(sim, a).name;
  // 1) 기억: 구역별로 센 불(믿음 ≥ 0.5)을 처음 본 시각 (0.3 아래로 내려가면 지운다). 실제 건물에서만 — 비행기·선박·산불은 무너지는 건물이 아니다
  if (structScene(s)) for (const r of s.regions) {
    if (!r.indoor) continue;
    const f = B.val<number>('fire', r.id) ?? 0;
    if (f >= 0.5) { if (ops.burnSince[r.id] === undefined) { ops.burnSince[r.id] = sim.t; if (ops.everHot.indexOf(r.id) < 0) ops.everHot.push(r.id); } }
    else if (f < 0.3 && ops.burnSince[r.id] !== undefined) delete ops.burnSince[r.id];
  }
  // 2) 사건 소리(붕괴·폭발): 조용해진 시각을 다시 재고, 지원을 부르고, 관제에 상황을 보고한다 (§5.9)
  noteEvents(sim, s, I, a, k, ops, wk);
  // 2b) (단계 6) 무너진 뒤 잠잠해진 곳의 잔해 수색 (§6.1): 전체 붕괴 30초 뒤 잔해 수색 국면, 구획 붕괴 25초 뒤 그 구획 — 수색 믿음을 낮추고 안에 있던 사람을 '매몰 추정'으로
  rubbleStep(sim, s, I, a, ops, wk);
  // 3) 위험 단계
  const { hits, raw } = dangerMap(sim, s, a, ops);
  dangerSigns(sim, s, I, a, ops, wk, hits, raw);
  // 4) 구역 맞추기: 새로 생겼거나 오른 구역은 그 자리에서 처리(철수 명령), 사라진 구역은 다시 들어가는 조건(§5.7)을 통과해야 지운다
  syncZones(sim, s, I, a, k, ops, wk, hits);
  // 5) 인원 점검 (§5.4)
  if (ops.mode === 'withdraw') parCheck(sim, s, I, a, ops, wk);
  // 5b) (단계 6) 다 탄 현장의 외부 확인 종료 (§6.2)
  extClose(sim, s, I, a, k, ops);
  // 6) 단계 1: 그 구역의 진압·수색은 한 사람씩 (동시에 들어가는 인원을 2명으로)
  for (const h of hits.values()) if (h.level === 1) for (const w of s.board) if ((w.kind === 'suppress' || w.kind === 'search') && (w.status === 'open' || w.status === 'active') && h.regions.indexOf(w.region) >= 0) w.max = 1;
  // 7) 막는 조치 (§5.8)
  prevention(sim, s, I, a, k, ops, hits);
  // 8) 진입 금지 구역 안의 열린 작업을 거둔다 (문이 새로 만들지 않는다). 업고 나오는 중인 운반·동료 구조는 거두지 않는다
  if (ops.zones.length || ops.noExt.length) for (const w of s.board) {
    if (w.status !== 'open' && w.status !== 'active') continue;
    if ((w.kind === 'carry' || w.kind === 'rescueMate' || w.kind === 'load') && w.status === 'active' && s.agents.some((b) => w.assignees.indexOf(b.rid) >= 0 && b.carrying !== -1)) continue;
    if (gateBlocks(sim, s, a, w.kind, w)) w.status = 'cancelled';
  }
  // 9) 외부 방수 자리를 두 번 찾지 못한 구역은 외부 방어가 이어지는 동안 다시 내지 않는다 (§5.5). 밖에서만 하던 까닭이 사라진 구역(구역이 풀렸다)은 기억에서 지운다
  if (ops.noExt.length) { const keep = ops.noExt.filter((r) => opsExterior(s, r)); if (keep.length !== ops.noExt.length) { ops.noExt = keep; bumpZones(ops); } }
  for (const w of s.board) if (w.kind === 'suppress' && (w.status === 'open' || w.status === 'active') && w.fails >= 2 && opsExterior(s, w.region) && ops.noExt.indexOf(w.region) < 0) { ops.noExt.push(w.region); w.status = 'cancelled'; bumpZones(ops); }
  // 10) 구역 목록이 바뀌었으면 지휘 상태 사실을 다시 보낸다 (음영이면 다음 주기에)
  broadcast(sim, s, a, ops, wk, me);
});

/** 구역 목록을 실어 보낸다 (지휘관 자신의 믿음에도). 지휘관이 음영 구역에 있으면 다음 주기에 */
function broadcast(sim: Sim, s: Scene, a: FieldAgent, ops: OpsState, wk: OpsWork, me: string): void {
  const v = zonesVer(ops);
  if (wk.sent === v) return;
  const f = opsFact(sim, ops, me);
  a.beliefs.merge(f);
  if (inShadow(s, a)) return;
  transmit(sim, s, a, -1, 'brief', [f], '', -1, 0, [], true);
  wk.sent = v;
}

// ───────────────────────── 사건 소리 (§3.5 의 사실) → 조용해진 시각 · 지원 요청 · 상황 보고 (§5.9) ─────────────────────────
function noteEvents(sim: Sim, s: Scene, I: Incident, a: FieldAgent, k: CommandKit, ops: OpsState, wk: OpsWork): void {
  const fresh: Fact[] = [];
  for (const f of a.beliefs.list('sign')) { const v = f.value as SignBelief; if (v.kind === 'event' && f.id >= SIGN_BASE.event && f.id - SIGN_BASE.event > wk.evSeen) fresh.push(f); }
  if (!fresh.length) return;
  fresh.sort((p, q) => p.id - q.id);
  wk.evSeen = fresh[fresh.length - 1].id - SIGN_BASE.event;
  ops.quietSince = sim.t;
  let fell = false, boom = false, total = false;
  const what: string[] = [];
  for (const f of fresh) {
    const v = f.value as SignBelief;
    if (v.what === 'partial') { fell = true; what.push(`${s.regions[v.region]?.name ?? '건물 일부'} 붕괴`); }
    else if (v.what === 'total') { fell = true; total = true; what.push('건물 전체 붕괴'); }
    else if (v.what === 'gas' || v.what === 'vessel' || v.what === 'dust') { boom = true; what.push('폭발 발생'); }
  }
  if (!what.length) return;
  if (fell && k.countUnits('rescue', 0.5) < 2) k.request('rescue', '건물 붕괴 — 매몰자 구조', true);
  if (boom) k.request('ems', '폭발 — 부상자 다수 예상', true);
  sitrepX(sim, s, I, a, ops, what.filter((t, i, arr) => arr.indexOf(t) === i).join('·'), fresh);
  void total;
}
/** 관제에 상황 보고 (§5.9): 무슨 일 · 지금의 대응 · 매몰 추정 수. 사실에 사건을 싣는다 (관제가 위험도를 다시 매긴다 — dispatcher.fieldReport) */
function sitrepX(sim: Sim, s: Scene, I: Incident, a: FieldAgent, ops: OpsState, what: string, facts: Fact[]): void {
  let buried = 0;
  for (const f of a.beliefs.list('cas')) { const c = f.value as CasBelief; if (c.where === 'scene' && c.band < 3 && c.mob === 'trapped') buried++; }
  for (const f of a.beliefs.list('mate')) { const m = f.value as MateBelief; if (m.status === 'down' && !m.dead && m.trapped) buried++; }
  const mode = ops.mode === 'defensive' ? '외부 방어로 전환' : ops.mode === 'withdraw' ? '전원 철수 중' : ops.mode === 'rubble' ? '잔해 수색 시작' : '내부 대응 계속';
  transmit(sim, s, a, -2, 'sitrep', facts, `관제, ${what}. ${mode}, 매몰 추정 ${buried}명.`, -1, 2, [I.lastEvent]);
  void s;
}

// ───────────────────────── 위험 조짐 기록 (§5.8 끝) ─────────────────────────
const KIND_LABEL: Record<NoGoZone['kind'], string> = { struct: '붕괴 조짐', gas: '가스 농도', vessel: '용기 가열', bldg: '건물 붕괴 조짐', fire: '플래시오버 조짐', dust: '분진 폭발 위험' };
const KIND_FIX: Record<NoGoZone['kind'], string> = { struct: '보강·진압', gas: '차단·환기', vessel: '냉각', bldg: '진압', fire: '진압', dust: '진압' };
/**
 * 지휘관이 위험 단계 2 이상을 (구역 키마다) 처음 알면 DANGER_SIGN. raiseProblem 은 상세로 중복을 거르지 않으므로 여기서 거른다.
 * 사건 없이 가라앉으면(그 키의 단계가 1 이하로 20초 — 해제·진입을 덮기 전의 단계, 또는 가스면 원천 차단을 앎) 복구. 그 자리에서 붕괴·폭발이 나면 미복구로 남는다
 */
function dangerSigns(sim: Sim, s: Scene, I: Incident, a: FieldAgent, ops: OpsState, wk: OpsWork, hits: Map<string, DangerHit>, raw: Map<string, number>): void {
  for (const [key, lv] of raw) {
    if (lv < 2) continue;
    const d = wk.danger.get(key);
    if (d && (!d.done || !d.calm)) continue;      // 이미 남겼다 / 끝난 뒤 한 번도 가라앉지 않았다 (원천 차단으로 막은 뒤에도 측정값이 높게 남는다 — 같은 위험을 되풀이해 남기지 않는다)
    const h = hits.get(key) ?? { key, kind: key.split(':')[0] as NoGoZone['kind'], regions: [], x: -1, y: -1 };
    const detail = `${KIND_LABEL[h.kind]} — ${zoneName(s, h)}`;
    if (I.problems.some((p) => p.code === 'DANGER_SIGN' && p.detail === detail && !p.recovered)) { wk.danger.set(key, { detail, t: sim.t, done: false, calm: false }); continue; }
    raiseProblem(sim, I, 'DANGER_SIGN', detail, { role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, imp: 2, causes: [I.lastEvent], text: `위험 조짐: ${detail}. 대응 방식을 바꿉니다.` }, false);
    wk.danger.set(key, { detail, t: sim.t, done: false, calm: false });
    delete ops.calmSince[key];
  }
  const cut = cutoffAt(a);
  for (const [key, d] of wk.danger) {
    if (d.done) { if ((raw.get(key) ?? 0) < 2) d.calm = true; continue; }
    // 그 자리에서 붕괴·폭발이 일어났다: 막지 못했다 — 미복구로 남긴다 (보고서가 "조짐 → 결과" 사슬을 쓴다)
    if (struck(s, a, key, d.t)) { d.done = true; continue; }
    const lv = raw.get(key) ?? 0;
    const kind = key.split(':')[0] as NoGoZone['kind'];
    if (kind === 'gas' && cut >= 0) { markRecoveredBy(I, 'DANGER_SIGN', d.detail, `${a.beliefs.get('sign', SIGN_BASE.utility) ? '도시가스 차단' : '밸브 차단'} — 막음`); d.done = true; continue; }
    if (lv >= 2) { delete ops.calmSince[key]; continue; }
    if (ops.calmSince[key] === undefined) { ops.calmSince[key] = sim.t; continue; }
    if (sim.t - ops.calmSince[key] < 20) continue;
    markRecoveredBy(I, 'DANGER_SIGN', d.detail, `${KIND_FIX[kind]} — 막음`);
    d.done = true;
  }
}
/** 그 키의 자리에서 t 뒤에 붕괴·폭발이 일어났는가 (지휘관이 들은 사건 소리로) */
function struck(s: Scene, a: FieldAgent, key: string, t: number): boolean {
  const kind = key.split(':')[0], id = +key.slice(key.indexOf(':') + 1);
  for (const f of a.beliefs.list('sign')) {
    const v = f.value as SignBelief;
    if (v.kind !== 'event' || f.t < t) continue;
    if (v.what === 'total') return true;
    if (kind === 'bldg' && v.what === 'partial') return true;      // 건물 단위의 위험은 어느 구획이 무너져도 막지 못한 것이다
    if (kind === 'vessel' && v.what === 'vessel' && v.prop === id) return true;
    if ((kind === 'struct' || kind === 'gas' || kind === 'fire' || kind === 'dust') && v.region >= 0 && (v.region === id || (regionNbrs(s)[id] ?? []).indexOf(v.region) >= 0)) return true;
  }
  return false;
}

// ───────────────────────── 구역 맞추기 · 철수 · 다시 들어가기 (§5.3·§5.4·§5.7) ─────────────────────────
function syncZones(sim: Sim, s: Scene, I: Incident, a: FieldAgent, k: CommandKit, ops: OpsState, wk: OpsWork, hits: Map<string, DangerHit>): void {
  // 새로 생겼거나 오른 구역
  for (const h of hits.values()) {
    if (h.level < 2) continue;
    wk.lastT.set(h.key, h.t);
    const z = ops.zones.find((q) => q.key === h.key);
    if (z) {
      // 구역의 넓이가 바뀌었다 (이웃 방이 더해지는 등)
      if (z.regions.length !== h.regions.length || z.regions.some((r, i) => r !== h.regions[i]) || z.r !== h.r) { z.regions = h.regions.slice(); z.x = h.x; z.y = h.y; z.r = h.r; bumpZones(ops); }
      if (h.level > z.level) raise(sim, s, I, a, k, ops, wk, z, h);
      continue;
    }
    const nz: NoGoZone = { key: h.key, kind: h.kind, level: h.level as 2 | 3, regions: h.regions.slice(), x: h.x, y: h.y, r: h.r, since: sim.t, why: h.why, ev: -1 };
    if (h.level >= 3) { if (!withdraw(sim, s, I, a, k, ops, wk, nz, h)) continue; }
    ops.zones.push(nz); bumpZones(ops);
    if (nz.level === 2) emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 2, causes: [I.lastEvent], text: `${zoneName(s, nz)} 진입 금지 — ${h.why}. 허락된 일만 들어간다.` });
    onNewZone(sim, s, I, a, k, ops, wk, nz);
  }
  // 낮아졌거나 사라진 구역: 다시 들어가는 조건 (§5.7)
  for (let q = ops.zones.length - 1; q >= 0; q--) {
    const z = ops.zones[q], h = hits.get(z.key), want = h ? h.level : 0;
    if (want >= z.level) { wk.lowSince.delete(z.key); if (z.level === 2 && h && sim.t - z.since >= 180 && cap180(sim, s, a, z, h)) release(sim, s, I, a, ops, wk, q, '변화 없음 — 조심스럽게 재진입'); continue; }
    const low = wk.lowSince.get(z.key) ?? sim.t;
    if (!wk.lowSince.has(z.key)) wk.lowSince.set(z.key, low);
    const el = sim.t - low;
    let go = false, why = '';
    if (z.kind === 'struct') {
      if (fallenIn(a, z)) { go = true; why = '무너진 뒤 잠잠해짐'; }
      else if (el >= 40) { go = true; why = '붕괴 조짐이 가라앉음'; }
    } else if (z.kind === 'gas') { go = true; why = want === 0 ? '가스 농도가 낮아짐' : '원천 차단 — 가스가 빠지는 중'; }
    else if (z.kind === 'vessel') {
      if (want === 0) { go = true; why = a.beliefs.list('sign').some((f) => (f.value as SignBelief).kind === 'event' && (f.value as SignBelief).what === 'vessel' && `vessel:${(f.value as SignBelief).prop}` === z.key) ? '용기가 터짐' : '용기가 식음'; }
      else if (el >= 20) { go = true; why = '안전밸브 소리가 멎음'; }
    } else if (z.kind === 'fire' || z.kind === 'dust') { go = true; why = '불길이 잦아듦'; }
    else if (z.kind === 'bldg') {
      const tAll = totalKnownAt(a.beliefs.list('sign'));
      if (tAll >= 0 && sim.t - tAll >= RUBBLE_TOTAL) { go = true; why = '붕괴가 멎음 — 잔해 수색'; }      // (단계 6) 무너진 건물은 잔해 수색 국면으로 (§6.1)
      else if (want === 0 && el >= 40) { go = true; why = '건물 붕괴 조짐이 가라앉음'; }
      else if (want === 2 && z.level === 3) { go = true; why = '구조 안정'; }
    }
    if (!go) continue;
    if (want >= 2) lower(sim, s, I, a, ops, z, want as 2, why);
    else release(sim, s, I, a, ops, wk, q, why);
    wk.lowSince.delete(z.key);
  }
  // 건물 단위의 철수 구역이 없으면 외부 방어를 푼다 (인원 점검 중은 그 끝에서)
  if (ops.mode === 'defensive' && !ops.zones.some((z) => z.kind === 'bldg' && z.level === 3)) setMode(sim, s, I, a, ops, 'interior', '내부 진입 재개');
  // 제한적 구조 진입 (§5.6)
  for (const z of ops.zones) if (z.level === 3 || (ops.entry[z.key] && sim.t < ops.entry[z.key].until)) limitedEntry(sim, s, I, a, k, ops, z, hits.get(z.key));
}
/** 단계 2 구역의 상한 (§5.7): 180초 동안 그 구역의 조짐이 오르지 않았고 그 구역과 이웃 구역의 불 ≤ 0.3 */
function cap180(sim: Sim, s: Scene, a: FieldAgent, z: NoGoZone, h: DangerHit): boolean {
  if (sim.t - h.t < 180) return false;
  const B = a.beliefs;
  for (const r of z.regions) {
    if ((B.val<number>('fire', r) ?? 0) > 0.3) return false;
    for (const n of regionNbrs(s)[r] ?? []) if ((B.val<number>('fire', n) ?? 0) > 0.3) return false;
  }
  if (z.r > 0) { const rg = regionAt(s, Math.round(z.y) * s.w + Math.round(z.x)); if (rg >= 0 && (B.val<number>('fire', rg) ?? 0) > 0.3) return false; }
  return true;
}
/** 구획 구역의 구역이 무너졌다 (사건 소리 — 그 구획의 무너짐, 또는 (단계 6) 건물 전체 붕괴) */
function fallenIn(a: FieldAgent, z: NoGoZone): boolean {
  const r0 = +z.key.slice(z.key.indexOf(':') + 1);
  for (const f of a.beliefs.list('sign')) { const v = f.value as SignBelief; if (v.kind === 'event' && (v.what === 'total' || (v.what === 'partial' && v.region === r0))) return true; }
  return false;
}
/** 구역이 생겼다: 남은 구조 대상을 알리고(한 번), 건물 단위면 외부 방어(처음 바꿀 때 한계 시간 +150 — 지휘 쪽 보탬)와 방수 부대 */
function onNewZone(sim: Sim, s: Scene, I: Incident, a: FieldAgent, k: CommandKit, ops: OpsState, wk: OpsWork, z: NoGoZone): void {
  if (z.level === 3 && !wk.told.has(z.key)) {
    let n = 0;
    const m = zoneMask(s, [z]);
    for (const f of a.beliefs.list('cas')) { const c = f.value as CasBelief; if (c.where === 'scene' && c.band < 3 && m[c.y * s.w + c.x] >= 3) n++; }
    if (n) {
      wk.told.add(z.key);
      emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 2, text: `구조 대상 ${n}명이 ${zoneName(s, z)}에 남아 있습니다 — ${z.kind === 'struct' || z.kind === 'bldg' ? '무너진 뒤 잔해에서 구조합니다' : '위험이 가라앉는 대로 들어갑니다'}.` });
    }
  }
  if (z.kind === 'bldg' && z.level === 3) {
    if (ops.limitBonus === 0) ops.limitBonus += 150;
    if (ops.mode !== 'withdraw') setMode(sim, s, I, a, ops, 'defensive', z.why);      // 인원 점검 중이면 그 끝에서 외부 방어로
    k.request('suppression', '외부 방어 — 방수 부대 추가', true);
  }
}
/**
 * 전원 철수 명령 (§5.4): 그 구역 안에 대원이 있으면 명령 무전(지휘 상태 사실을 싣는다) → 공기 경적(28칸 안의 활동 대원 모두에게 음영과 관계없이 같은 사실) →
 * WITHDRAWAL(구역 키마다 하나 — 다시 오른 구역은 미복구 기록이 남아 있으면 새로 남기지 않는다) → 인원 점검. 지휘관이 음영 구역이면(명령 무전이 나가지 않으면) 아무것도 남기지 않고
 * 다음 주기에 다시 한다 (돌려주는 값 false). 안에 대원이 없으면 구역만 만든다
 */
function withdraw(sim: Sim, s: Scene, I: Incident, a: FieldAgent, k: CommandKit, ops: OpsState, wk: OpsWork, z: NoGoZone, h: DangerHit): boolean {
  const inside = agentsIn(s, [z]);
  if (!inside.length) return true;
  const me = resp(sim, a).name, name = zoneName(s, z);
  const lv0 = z.level;
  z.level = 3;
  const tmp = ops.zones.indexOf(z) < 0;
  if (tmp) ops.zones.push(z);
  const f = opsFact(sim, ops, me);
  if (tmp) ops.zones.pop();
  const ds = wk.danger.get(z.key);
  const dsEv = ds ? I.problems.find((p) => p.code === 'DANGER_SIGN' && p.detail === ds.detail)?.eventId ?? -1 : -1;
  const ev = transmit(sim, s, a, -1, 'order', [f], `전원 철수! ${name} — ${h.why}. 즉시 밖으로 나와 인원 점검.`, -1, 3, [dsEv >= 0 ? dsEv : I.lastEvent]);
  if (ev < 0) { z.level = lv0; return false; }
  a.beliefs.merge(f);
  // 공기 경적: 무전이 아니라 소리다 — 음영 구역의 대원도 듣는다 (대원의 위치는 조직이 안다. 무전 문구는 명령 한 줄뿐)
  pushFx(sim, s, 'horn', a.x, a.y, undefined, undefined, undefined, undefined, 3);
  for (const b of s.agents) if (b !== a && live(b) && Math.hypot(b.x - a.x, b.y - a.y) <= 28) b.beliefs.merge(f);
  const detail = `${h.why}으로 ${name} 전원 철수`;
  if (!I.problems.some((p) => p.code === 'WITHDRAWAL' && p.detail === detail && !p.recovered)) z.ev = raiseProblem(sim, I, 'WITHDRAWAL', detail, { role: 'COMMANDER', actor: me, rid: a.rid, imp: 3, causes: [ev], text: `${detail} — 인원 점검을 시작합니다.` }, false);
  z.why = h.why;
  if (z.kind === 'bldg') { ops.reason = h.why; ops.ev = z.ev; }
  // 인원 점검: 그 안의 활동 대원 (쓰러진·떠난 대원은 응답할 수 없다)
  const asked = inside.filter((b) => b !== a).map((b) => b.rid);
  if (ops.mode !== 'withdraw') { ops.parAsked = []; ops.parOk = []; }
  for (const rid of asked) if (ops.parAsked.indexOf(rid) < 0) ops.parAsked.push(rid);
  ops.parAt = sim.t; ops.parDue = sim.t + 70; ops.parTries = 0; wk.resendAt = -1;
  setMode(sim, s, I, a, ops, 'withdraw', h.why);
  ops.quietSince = sim.t;
  wk.sent = -1;      // 다음 broadcast 가 판을 맞춘다 (명령에 이미 실었다)
  void k;
  return true;
}
/** 구역의 단계가 올랐다 (2 → 3): 철수 명령 (안에 대원이 없으면 단계만) */
function raise(sim: Sim, s: Scene, I: Incident, a: FieldAgent, k: CommandKit, ops: OpsState, wk: OpsWork, z: NoGoZone, h: DangerHit): void {
  if (h.level >= 3 && !withdraw(sim, s, I, a, k, ops, wk, z, h)) return;
  z.level = h.level as 2 | 3; z.why = h.why; bumpZones(ops);
  ops.quietSince = sim.t;
  onNewZone(sim, s, I, a, k, ops, wk, z);
}
/** 단계를 내린다 (3 → 2) */
function lower(sim: Sim, s: Scene, I: Incident, a: FieldAgent, ops: OpsState, z: NoGoZone, to: 2, why: string): void {
  z.level = to; bumpZones(ops);
  emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 2, text: `${zoneName(s, z)} 철수 해제, 진입 금지로 낮춥니다 — ${why}.` });
}
/** 구역을 푼다 (§5.7): 그때의 근거 사실 시각을 적어 두고(그 뒤의 새 사실로만 다시 올린다), 철수 기록을 복구하고, 다시 보낸다 */
function release(sim: Sim, s: Scene, I: Incident, a: FieldAgent, ops: OpsState, wk: OpsWork, q: number, why: string): void {
  const z = ops.zones[q];
  ops.cleared[z.key] = wk.lastT.get(z.key) ?? sim.t;
  ops.zones.splice(q, 1); bumpZones(ops);
  if (z.ev >= 0) { const p = I.problems.find((x) => x.eventId === z.ev); if (p && !p.recovered) markRecoveredBy(I, 'WITHDRAWAL', p.detail, `${fmtSec(sim.t - z.since)} 뒤 ${why} — 다시 진입`); }
  ops.reentries++;
  delete ops.entry[z.key];
  emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 2, text: `${zoneName(s, z)} 진입 재개 — ${why}.` });
}
/** 전술 모드를 바꾼다 (interior 로 돌아가면 외부 방수 실패 기억을 비운다) */
function setMode(sim: Sim, s: Scene, I: Incident, a: FieldAgent, ops: OpsState, mode: OpsState['mode'], why: string): void {
  if (ops.mode === mode) return;
  const was = ops.mode;
  ops.mode = mode; ops.since = sim.t; ops.reason = why; bumpZones(ops);
  if (mode === 'interior' || mode === 'rubble') ops.noExt = [];
  if (mode === 'interior') { if (was === 'defensive') emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 2, text: `외부 방어를 풀고 내부 진입을 재개합니다 — ${why}.` }); }
  if (mode === 'defensive') emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 3, text: `외부 방어로 전환합니다 — ${why}. 건물 밖에서 방수하라.` });
  // 모드가 바뀌면 관제에 상황 보고 (§5.9 — 사건 사실이 없으므로 관제의 위험도는 바뀌지 않는다)
  if (mode === 'defensive' || (mode === 'withdraw' && was === 'interior') || mode === 'rubble') sitrepX(sim, s, I, a, ops, mode === 'defensive' ? '건물 전체 붕괴 위험' : mode === 'rubble' ? '건물 붕괴가 멎음' : `${why}`, []);
}

/**
 * 인원 점검 (§5.4-5·6): 철수를 마친 대원은 조용히 응답(ops 100 + rid)한다. 25초 뒤 미확인 대원이 있으면 명령을 다시 보낸다(10초 간격, 3번까지).
 * 쓰러졌다고 아는 대원·활동하지 않는 대원은 점검에서 뺀다(쓰러진 동료는 rescueMate 로 — 구역이 풀리거나 제한적 진입이 될 때까지는 문이 막는다).
 * 모두 응답했거나, 세 번째 재송신 뒤 10초가 지났거나, 시한(parDue)이 지나면 끝 — 모드는 건물 단위 철수 구역이 있으면 외부 방어, 없으면 내부
 */
function parCheck(sim: Sim, s: Scene, I: Incident, a: FieldAgent, ops: OpsState, wk: OpsWork): void {
  const B = a.beliefs, me = resp(sim, a).name;
  ops.parAsked = ops.parAsked.filter((rid) => {
    const b = s.agents.find((q) => q.rid === rid);
    const mb = B.val<MateBelief>('mate', rid);
    return !!b && live(b) && !(mb && mb.status === 'down');
  });
  for (const rid of ops.parAsked) { const f = B.get('ops', OPS_PAR + rid); if (f && (f.value as { t: number }).t >= ops.parAt && ops.parOk.indexOf(rid) < 0) ops.parOk.push(rid); }
  const missing = ops.parAsked.filter((rid) => ops.parOk.indexOf(rid) < 0);
  const names = (l: number[]): string => l.map((rid) => sim.responders[rid].name).join(', ');
  const done = (): void => {
    if (ops.zones.some((z) => z.kind === 'bldg' && z.level === 3)) setMode(sim, s, I, a, ops, 'defensive', ops.reason || '인원 점검 완료');
    else if (rubbleReady(sim, a)) enterRubble(sim, s, I, a, ops, wk);      // (단계 6) 무너진 건물이면 잔해 수색 국면으로
    else setMode(sim, s, I, a, ops, 'interior', ops.reason || '인원 점검 완료');
  };
  if (!missing.length) {
    emit(sim, { inc: I.id, role: 'COMMANDER', actor: me, rid: a.rid, kind: 'command', imp: 1, text: `인원 점검 완료 — 철수 대원 ${ops.parOk.length}명 전원 확인.` });
    done(); return;
  }
  if (sim.t >= ops.parDue || (ops.parTries >= 3 && sim.t - wk.resendAt >= 10)) {
    emit(sim, { inc: I.id, role: 'COMMANDER', actor: me, rid: a.rid, kind: 'command', imp: 3, text: `인원 점검 미완료 — ${missing.length}명 미확인 (${names(missing)}). 위치 파악을 계속합니다.` });
    done(); return;
  }
  if (sim.t - ops.parAt >= 25 && ops.parTries < 3 && (wk.resendAt < 0 || sim.t - wk.resendAt >= 10)) {
    const f = opsFact(sim, ops, me);
    const ev = transmit(sim, s, a, -1, 'order', [f], `인원 점검: ${missing.length}명 미확인 — ${names(missing)}. 응답하라.`, -1, 2, []);
    if (ev < 0) return;      // 음영 — 다음 주기에
    ops.parTries++; wk.resendAt = sim.t;
  }
}

/**
 * 제한적 구조 진입 (§5.6): 단계 3 구역이 60초 넘게 이어지는데 그 안에 살아 있는 구조 대상(위중 이하) 또는 쓰러진 동료(숨지지 않음)를 알고,
 * 그 60초 동안 새 조짐·사건이 없었다면 그 구역을 40초 동안 단계 2 로 낮추고 가장 가까운 대상 하나에 건강한 소방 대원 둘을 보낸다(risky).
 * 마지막 진입 뒤 90초 동안 새 조짐이 없으면 다시 할 수 있다 (구역마다 3번까지)
 */
function limitedEntry(sim: Sim, s: Scene, I: Incident, a: FieldAgent, k: CommandKit, ops: OpsState, z: NoGoZone, h: DangerHit | undefined): void {
  const e = ops.entry[z.key];
  if (e && sim.t < e.until) return;      // 진입 중 (dangerMap 이 단계 2 로 덮는다)
  if (!h || (e && e.n >= 3)) return;
  const quiet = sim.t - Math.max(h.t, ops.quietSince);
  if (sim.t - z.since < 60 || quiet < 60 || (e && sim.t - e.last < 90)) return;
  const m = zoneMask(s, [z]);
  const B = a.beliefs;
  let best: { kind: 'carry' | 'extricate' | 'rescueMate'; cas: number; mate: number; d: number; who: string } | null = null;
  for (const f of B.list('cas')) {
    const c = f.value as CasBelief;
    if (c.where !== 'scene' || c.band >= 3 || c.water || m[c.y * s.w + c.x] < 3) continue;
    const d = Math.hypot(c.x - s.staging.x, c.y - s.staging.y);
    if (!best || d < best.d) best = { kind: c.mob === 'trapped' ? 'extricate' : 'carry', cas: f.id, mate: -1, d, who: '구조 대상' };
  }
  for (const f of B.list('mate')) {
    const v = f.value as MateBelief;
    if (v.status !== 'down' || v.dead || m[v.y * s.w + v.x] < 3) continue;
    const d = Math.hypot(v.x - s.staging.x, v.y - s.staging.y);
    if (!best || d < best.d) best = { kind: 'rescueMate', cas: -1, mate: f.id, d, who: '동료' };
  }
  if (!best) return;
  ops.entry[z.key] = { until: sim.t + 40, n: (e ? e.n : 0) + 1, last: sim.t };
  z.level = 2; bumpZones(ops);
  const w = k.want(best.kind, best.cas >= 0 ? { cas: best.cas } : { mate: best.mate }, 0.93, 2);
  if (w.id >= 0) w.risky = true;
  emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 3, causes: [z.ev], text: `${zoneName(s, z)}에 ${josa(best.who, '이/가')} 있습니다. 2명만 들어가 40초 안에 데리고 나온다.` });
}

// ───────────────────────── 막는 조치 (§5.8) ─────────────────────────
function prevention(sim: Sim, s: Scene, I: Incident, a: FieldAgent, k: CommandKit, ops: OpsState, hits: Map<string, DangerHit>): void {
  const B = a.beliefs;
  const fire = (r: number): number => B.val<number>('fire', r) ?? 0;
  const signAt = (kind: 'struct' | 'gas', r: number): number => { const v = B.val<SignBelief>('sign', (kind === 'gas' ? SIGN_BASE.gas : SIGN_BASE.struct) + r); return v ? v.level : 0; };
  // 균열·밸브: 지금 그대로(0.86) — 그 구역의 구조 조짐이 2 면 0.92, 가스 조짐이 2 이상이면 0.93
  for (const f of B.list('haz')) {
    const v = f.value as { kind: string; active: boolean; x: number; y: number };
    if (v.kind !== 'leak' || !v.active) continue;
    const rg = regionAt(s, Math.round(v.y) * s.w + Math.round(v.x));
    if (rg < 0) continue;
    const pr = signAt('gas', rg) >= 2 ? 0.93 : signAt('struct', rg) >= 2 ? 0.92 : 0;
    if (pr) for (const w of s.board) if (w.kind === 'mitigate' && w.prop === f.id && (w.status === 'open' || w.status === 'active')) w.priority = Math.max(w.priority, pr);
  }
  // 가스 용기·드럼통: 살아 있고 그 구역 불 ≥ 0.2 또는 용기 조짐 ≥ 2 → 냉각. 그 구역의 진압은 0.9 이상 (불을 끄는 것이 곧 식히는 것이다 — 0.22 규칙)
  for (const f of B.list('haz')) {
    const v = f.value as { kind: string; active: boolean; x: number; y: number };
    if (v.kind !== 'gas') continue;
    const key = `cool:${f.id}`;
    if (!v.active) { k.cancel((w) => w.kind === 'mitigate' && w.prop === f.id); delete ops.calmSince[key]; continue; }
    const rg = regionAt(s, Math.round(v.y) * s.w + Math.round(v.x));
    const vs = B.val<SignBelief>('sign', SIGN_BASE.vessel + f.id), lv = vs ? vs.level : 0;
    // 방금 식혔다(냉각 완료 — 용기 조짐 0 을 받았다): 조짐이 다시 오르기 전에는 30초 동안 다시 내지 않는다 (같은 구역의 먼 불 때문에 식은 용기에 냉각을 되풀이하지 않게)
    const cooled = s.board.some((w) => w.kind === 'mitigate' && w.prop === f.id && w.status === 'done' && sim.t - w.doneAt < 30);
    if (((rg >= 0 && fire(rg) >= 0.2) || lv >= 2) && !(cooled && lv < 2)) {
      delete ops.calmSince[key];
      k.want('mitigate', { prop: f.id }, 0.9 + 0.03 * lv, 1);
      if (rg >= 0) for (const w of s.board) if (w.kind === 'suppress' && w.region === rg && (w.status === 'open' || w.status === 'active')) w.priority = Math.max(w.priority, 0.9);
    } else {
      if (ops.calmSince[key] === undefined) ops.calmSince[key] = sim.t;
      else if (sim.t - ops.calmSince[key] >= 20) k.cancel((w) => w.kind === 'mitigate' && w.prop === f.id);
    }
  }
  // 가스 단계 2 이상 + 불: 그 불을 먼저 끈다 (점화원 제거 — 진압 +0.12)
  for (const f of B.list('sign')) {
    const v = f.value as SignBelief;
    if (v.kind !== 'gas' || v.level < 2 || v.region < 0) continue;
    const near = [v.region, ...(regionNbrs(s)[v.region] ?? [])];
    for (const w of s.board) if (w.kind === 'suppress' && near.indexOf(w.region) >= 0 && (w.status === 'open' || w.status === 'active')) w.priority = Math.min(0.99, w.priority + 0.12);
  }
  // 가스 재측정 (§5.7): 가스 구역마다 그 구획의 문턱(단계 3 구역 밖)에서 — 측정기를 든 활동 대원이 현장에 있을 때만 (없으면 거둔다)
  const meter = s.agents.some((b) => live(b) && hasKit(sim, b.rid, 'gasMeter'));
  for (const z of ops.zones) {
    if (z.kind !== 'gas') continue;
    const r0 = +z.key.slice(4);
    if (!meter) { k.cancel((w) => w.kind === 'mitigate' && w.prop < 0 && w.region === r0); continue; }
    if (s.board.some((w) => w.kind === 'mitigate' && w.prop < 0 && w.region === r0 && w.status === 'done' && sim.t - w.doneAt < 20)) continue;      // 방금 쟀는데 아직 위험했다 — 20초 뒤 다시
    const th = threshold(s, ops, r0);
    if (th >= 0) k.want('mitigate', { region: r0, tile: th }, 0.7, 1);
  }
  // 도시가스 공급 차단 요청 (§5.8): 가스 단계 3 구역이 아는 밸브를 덮어 차단하러 갈 수 없거나, 가스 조짐 2 이상인데 밸브 위치를 모른다 — 한 사건에 한 번
  if (ops.utilityAsked < 0) {
    let why = '';
    const leaks = B.list('haz').filter((f) => f.value.kind === 'leak' && f.value.active);
    const gas2 = B.list('sign').some((f) => (f.value as SignBelief).kind === 'gas' && (f.value as SignBelief).level >= 2 && (f.value as SignBelief).region >= 0 && f.verified);
    for (const f of leaks) { const i = Math.round(f.value.y) * s.w + Math.round(f.value.x); if (signAt('gas', regionAt(s, i)) >= 1 && zoneLevelAt(s, ops.zones, i) >= 3) { why = '가스가 찬 구역에 밸브가 있어 접근 불가'; break; } }
    if (!why && gas2 && !leaks.length && !B.list('haz').some((f) => f.value.kind === 'leak')) why = '누출 지점을 찾지 못함';
    if (why) {
      const ev = transmit(sim, s, a, -2, 'request', [], `관제, 도시가스 공급 차단 요청 — ${why}.`, -1, 2, [I.lastEvent]);
      if (ev >= 0) ops.utilityAsked = sim.t;
    }
  }
  void hits;
}
/** 가스 구획 r 의 문턱 칸: r 의 칸과 4방향으로 맞닿은 r 밖의 문·바닥 칸 가운데 단계 3 구역 밖 (문 먼저, 칸 번호 순서 — 결정적) */
function threshold(s: Scene, ops: OpsState, r: number): number {
  const reg = s.regions[r];
  if (!reg) return -1;
  const w = s.w, n = w * s.h, zm = zoneMask(s, ops.zones);
  let door = -1, floor = -1, own = -1;
  for (const i of reg.tiles) {
    const x = i % w;
    for (let d = 0; d < 4; d++) {
      const j = d === 0 ? (x + 1 < w ? i + 1 : -1) : d === 1 ? (x > 0 ? i - 1 : -1) : d === 2 ? (i + w < n ? i + w : -1) : i - w;
      if (j < 0 || s.region[j] === r) continue;
      const t = s.tiles[j];
      // (단계 6) 그 구획의 문 칸이 구획 안에 들어 있는 건물: 바깥과 맞닿은 그 문 칸 자체가 문턱이다 (단계 2 구역 칸은 재측정이 허락된 자리다 — 철수 구역 칸만 뺀다)
      if (s.tiles[i] === T.DOOR && zm[i] < 3 && (t === T.FLOOR || t === T.DOOR || t === T.STAIR) && (own < 0 || i < own)) own = i;      // 계단참과 맞닿은 문도 (측정기는 서 있는 칸의 구획을 읽는다 — 계단 칸에서는 이 구획을 읽지 못한다)
      if (zm[j] >= 3) continue;
      if (t === T.DOOR && (door < 0 || j < door)) door = j;
      else if (t === T.FLOOR && (floor < 0 || j < floor)) floor = j;
    }
  }
  return door >= 0 ? door : floor >= 0 ? floor : own;
}

// ───────────────────────── (단계 6) 사건의 끝 — 잔해 수색 국면 · 외부 확인 종료 · 종료를 막는 것 (§6.1·§6.2) ─────────────────────────

/** 전체 붕괴를 안 지 30초가 지났는가 (잔해 수색 국면으로 갈 때) */
const rubbleReady = (sim: Sim, a: FieldAgent): boolean => { const t = totalKnownAt(a.beliefs.list('sign')); return t >= 0 && sim.t - t >= RUBBLE_TOTAL; };

/**
 * 무너진 뒤의 믿음을 고친다 (§6.1 — 낡은 믿음 함정): 그 구획들의 수색 확인율을 0.3 으로 낮추고(그 위였으면), 그 안에 있던 것으로 아는 구조 대상(현장·위중 이하)을
 * '매몰 추정'(갇힘)으로 바꾼다. 지휘 쪽이 덮는 사실은 확인된(verified) 사실 · 지금 시각이다 (아니면 merge 가 거부한다). 대원들에게 조용히 보낸다.
 * 실제로 갇히지 않았으면 구출(extricate)을 시작할 때 실행기가 강제 보고로 바로잡는다
 */
function rubbleBeliefs(sim: Sim, s: Scene, a: FieldAgent, regions: number[]): void {
  const B = a.beliefs, me = resp(sim, a).name, out: Fact[] = [];
  for (const r of regions) {
    const f = B.get('srch', r);
    if (!f || f.value <= 0.3) continue;
    const nf = mkFact('srch', r, 0.3, me, sim.t, 0.5, true, `${s.regions[r].name} 붕괴 후 재수색`);
    B.merge(nf); out.push(nf);
  }
  for (const f of B.list('cas')) {
    const c = f.value as CasBelief;
    if (c.where !== 'scene' || c.band >= 3 || c.water || c.mob === 'trapped') continue;
    const rg = regionAt(s, c.y * s.w + c.x);
    if (rg < 0 || regions.indexOf(rg) < 0) continue;
    const nf = mkFact('cas', f.id, { ...c, mob: 'trapped', trappedDone: false }, me, sim.t, 0.5, true, `구조 대상: ${s.regions[rg].name} — 붕괴 후 매몰 추정`);
    B.merge(nf); out.push(nf);
  }
  if (out.length) transmit(sim, s, a, -1, 'report', out, '', -1, 0, [], true);
}
/** 전체 붕괴의 잔해 수색 국면으로 (§6.1): 모드 · 기록 · 모든 실내 구획의 믿음 고치기 (한 번) */
function enterRubble(sim: Sim, s: Scene, I: Incident, a: FieldAgent, ops: OpsState, wk: OpsWork): void {
  setMode(sim, s, I, a, ops, 'rubble', '붕괴가 멎음');
  if (wk.rubbleAll) return;
  wk.rubbleAll = true;
  emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 3, causes: [I.lastEvent], text: '붕괴가 멎었습니다. 잔해 수색을 시작한다 — 소방·구조 대원만 진입.' });
  const all: number[] = [];
  for (const r of s.regions) if (r.indoor) all.push(r.id);
  rubbleBeliefs(sim, s, a, all);
}
/**
 * 잔해 수색 (§6.1): 전체 붕괴를 안 지 30초 → 잔해 수색 국면(인원 점검 중이면 그 끝에서). 구획 붕괴는 그 구획과 이웃 구획에서 25초 동안 새 무너짐이 없으면
 * 그 구획을 ops.rubble 에 넣는다 (잔해 구역 — 소방·구조만 들어간다, agents.fitFor 의 inRubble). 둘 다 수색 믿음을 고친다
 */
function rubbleStep(sim: Sim, s: Scene, I: Incident, a: FieldAgent, ops: OpsState, wk: OpsWork): void {
  const signs = a.beliefs.list('sign');
  const tAll = totalKnownAt(signs);
  if (tAll >= 0) {
    if (sim.t - tAll >= RUBBLE_TOTAL && ops.mode !== 'rubble' && ops.mode !== 'withdraw') enterRubble(sim, s, I, a, ops, wk);
    return;      // 건물이 통째로 무너졌으면 구획마다 따로 하지 않는다 (잔해 수색 국면이 모든 실내 구획을 덮는다)
  }
  let last: Map<number, number> | null = null;      // 구획 → 그 구획의 마지막 무너짐 시각
  for (const f of signs) {
    const v = f.value as SignBelief;
    if (v.kind !== 'event' || v.what !== 'partial' || v.region < 0) continue;
    if (!last) last = new Map();
    last.set(v.region, Math.max(last.get(v.region) ?? -1, f.t));
  }
  if (!last) return;
  const nb = regionNbrs(s), fresh: number[] = [];
  for (const [r, t0] of last) {
    if (ops.rubble.indexOf(r) >= 0) continue;
    let t = t0;
    for (const n of nb[r] ?? []) { const tn = last.get(n); if (tn !== undefined && tn > t) t = tn; }
    if (sim.t - t >= RUBBLE_PART) fresh.push(r);
  }
  if (!fresh.length) return;
  fresh.sort((p, q) => p - q);
  for (const r of fresh) ops.rubble.push(r);
  const names = fresh.map((r) => s.regions[r].name).join('·');
  emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 3, causes: [I.lastEvent], text: `${names} 붕괴가 멎었습니다. 잔해 수색을 시작한다 — 소방·구조 대원만 진입.` });
  rubbleBeliefs(sim, s, a, fresh);
}

/**
 * 외부 확인 종료 (§6.2): 다 탄 건물은 안쪽 구역이 철수 구역으로 남아 들어가 불이 꺼진 것을 확인할 수 없다. 그래서 지휘관이 밖에서 확인한다 — 조건(모두):
 *   외부 방어 중이거나 단계 3 구역이 있다 · 다 탔다고 볼 근거(건물 조짐 2 이상, 또는 센 불을 본 적이 있는 구역이 실내 구역의 60% 이상) ·
 *   그 안에 살아 있는 구조 대상을 모른다 · 지휘관 자신의 외부 관찰 기억(extSeen)이 대상 구역 모두에서 "60초 동안 센 불 없음"(마지막 7초 관찰이 덮었고, 60초 넘게 관찰해 왔다).
 * 그러면 그 구역들의 불 믿음을 0(확인된 사실 · 신뢰도 0.6 · 지금)으로 합치고 남은 수색·잔불 정리·진압을 거둔 뒤 ops.concluded — 종료 차단이 풀리고 canClose 가 판단한다.
 * 판정은 진실로 한다(남은 불·미발견 사람은 그대로 드러난다). 전체 붕괴한 현장은 이 길이 아니라 잔해 수색으로 간다
 */
function extClose(sim: Sim, s: Scene, I: Incident, a: FieldAgent, k: CommandKit, ops: OpsState): void {
  if (ops.concluded || ops.mode === 'rubble' || !structScene(s)) return;
  const l3 = ops.zones.filter((z) => z.level === 3);
  if (ops.mode !== 'defensive' && !l3.length) return;
  const B = a.beliefs, e = a.extSeen;
  if (!e) return;
  if (totalKnownAt(B.list('sign')) >= 0) return;
  const indoor: number[] = [];
  for (const r of s.regions) if (r.indoor) indoor.push(r.id);
  const bs = B.get('sign', SIGN_BASE.bldg);
  const burnt = (bs !== undefined && bs.verified && (bs.value as SignBelief).level >= 2) || (indoor.length > 0 && ops.everHot.length >= 0.6 * indoor.length);
  if (!burnt) return;
  // 대상 구역: 단계 3 구역과 센 불을 본 적이 있는 구역 (외부 방어 중이면 건물 전체)
  const targets: number[] = [];
  for (const z of l3) for (const r of z.regions) if (s.regions[r] && s.regions[r].indoor && targets.indexOf(r) < 0) targets.push(r);
  for (const r of ops.everHot) if (targets.indexOf(r) < 0) targets.push(r);
  if (ops.mode === 'defensive') for (const r of indoor) if (targets.indexOf(r) < 0) targets.push(r);
  if (!targets.length) return;
  for (const f of B.list('cas')) { const c = f.value as CasBelief; if (c.where === 'scene' && c.band < 3 && targets.indexOf(regionAt(s, c.y * s.w + c.x)) >= 0) return; }
  for (const r of targets) {
    if (e.hot[r] >= sim.t - 60) return;              // 60초 안에 센 불을 보았다
    if (e.cov[r] < sim.t - 8) return;                // 마지막 7초 관찰이 그 구역을 덮지 못했다
    if (e.cov0[r] < 0 || e.cov0[r] > sim.t - 60) return;      // 아직 60초 넘게 지켜보지 못했다
  }
  const me = resp(sim, a).name, out: Fact[] = [];
  for (const r of targets) {
    if ((B.val<number>('fire', r) ?? 0) <= 0) continue;
    const nf = mkFact('fire', r, 0, me, sim.t, 0.6, true, `${s.regions[r].name} 외부 관찰 — 불길 없음(추정)`);
    B.merge(nf); out.push(nf);
  }
  k.cancel((w) => (w.kind === 'search' || w.kind === 'overhaul' || w.kind === 'suppress') && targets.indexOf(w.region) >= 0);
  ops.concluded = true; bumpZones(ops);
  if (out.length) transmit(sim, s, a, -1, 'report', out, '', -1, 0, [], true);
  emit(sim, { inc: I.id, role: 'COMMANDER', actor: me, rid: a.rid, kind: 'command', imp: 3, causes: [I.lastEvent], text: '건물이 전소되어 내부 확인이 불가합니다. 외부에서 불길이 없음을 확인했습니다. 현장을 경계 인력에 인계하고 철수합니다.' });
}

/**
 * 종료를 막는 것 (§6.2): 지휘 상태가 있고 외부 확인 종료를 정하지 않았으면 —
 *   인원 점검 중(시한까지만) · 단계 3 구역이 있다 · 지난 계획 주기에 문이 막은 일이 있다(수색하지 않은 진입 금지 구역을 남긴 채 끝내지 않는다) ·
 *   가스 조짐 2 이상을 90초 안에 읽었다 (오래된 측정값으로는 막지 않는다 — 아무도 다시 재지 않으면 영영 막히므로).
 * 구역 해제(§5.7 — 단계 2 의 180초 상한 포함)·외부 확인 종료·한계 시간이 끝을 보장한다
 */
registerBlocker((sim, s, a) => {
  const ops = s.ops;
  if (!ops || ops.concluded) return false;
  if (ops.mode === 'withdraw' && sim.t < ops.parDue) return true;
  for (const z of ops.zones) if (z.level === 3) return true;
  if (ops.gated > 0) return true;
  // 가스: 원천을 막았다고 알면(밸브 차단·도시가스 차단 완료 — 아는 누출이 모두 멈췄다) 남은 가스는 빠지는 중이다 — 측정값으로 막지 않는다
  // (막으면 원천을 잠근 뒤 위험 수준 아래로 내려가기를 기다리며 대원 모두가 90초 동안 손을 놓는다 — 측정 도구의 교착 후보)
  if (cutoffAt(a) < 0) for (const f of a.beliefs.list('sign')) { const v = f.value as SignBelief; if (v.kind === 'gas' && v.level >= 2 && v.region >= 0 && f.verified && sim.t - f.t <= 90) return true; }
  return false;
});
