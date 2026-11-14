// 측정 도구 (docs/specs/I1-causality.md §2 — I1-a): 인과 연쇄·시스템 간 영향·재계획·대체 방법·행동 다양성·
// 자원 경쟁·멈춘 시간·결과 다양성과 기록·상태 일치 검사.
//
// 이 파일은 실행되지 않는 순수 모듈이다(sweep.ts 는 import 하면 실행되므로 따로 둔다).
// 시뮬레이션을 고치지 않는다: 교대가 끝난 뒤의 기록·상태와, 교대 중에 1초마다 뜨는 표본(Probe)을 읽기만 한다.
// Probe 는 src/sim 의 함수를 하나도 부르지 않는다(부르면 상태를 바꿀 수 있다 — 공유 버퍼·믿음 갱신).
// 시간·난수를 쓰지 않으므로 같은 시드면 지표도 같다.

import type { Sim } from '../src/sim/engine';
import type { Incident, Needs, Scene, SimEvent, WorkItem } from '../src/sim/types';
import { fmtClock } from '../src/sim/util';

// ───────────────────────── 상수 (§2.2) ─────────────────────────
export const SAMPLE_EVERY = 5;          // 틱 (= 1초). 표본은 step() 뒤에만 뜬다
export const STALL_SEC = 60, FORGOT_SEC = 30, REPEAT_WARN = 6, MIN_SCEN_N = 5;
export const CHAIN_DEPTH_GATE = 4, CHAINED_SHIFT_GATE = 8;
export const STALL_ALLOW = 0;            // 보통 40시드 기준선으로 확인했다. 0 이 아니게 되면 그 수로 두고 래칫 (§2.14)
export const FORGOT_ALLOW = 0;           // 같은 방식의 래칫 (잊힌 사건)
export const REPEAT_MAX = Infinity;      // 기준선을 잰 뒤 정한다 (그 전에는 보고만)
const LIST_CAP = 20;                     // --json 의 목록 상한

export const SYSTEMS = ['call', 'dispatch', 'field', 'road', 'hospital', 'hazard', 'building', 'crew', 'equip', 'infra', 'other', 'aid', 'disaster', 'carry'] as const;
export type SystemId = typeof SYSTEMS[number];
export type SysOf = SystemId | 'origin' | 'none';
export const BASE: ReadonlySet<SystemId> = new Set<SystemId>(['call', 'dispatch', 'field']);

/** Needs 의 여덟 열쇠 (I.unmet 의 합을 객체를 훑지 않고 구한다) */
const NEED_KEYS: readonly (keyof Needs)[] = ['suppression', 'rescue', 'ems', 'law', 'tactical', 'search', 'traffic', 'eod'];
export function unmetSum(I: { unmet: Partial<Needs> }): number { let n = 0; for (const k of NEED_KEYS) n += I.unmet[k] ?? 0; return n; }

// ───────────────────────── 시스템 대응표 (§2.3) ─────────────────────────
/** 규칙 0: I1-b 의 선택 칸 `tag`. 표에 없는 태그는 건너뛴다. carry 는 I2 가 WorldTag 에 더하는 값 (I2 §7 ①) */
export const TAG_SYS: ReadonlyMap<string, SystemId> = new Map<string, SystemId>([
  ['power', 'infra'], ['comms', 'infra'], ['water', 'infra'],
  ['smoke', 'hazard'], ['risk', 'hazard'],
  ['hospital', 'hospital'],
  ['carry', 'carry'],
]);
/** 규칙 1: 문제 코드 → 시스템. 아직 없는 코드(H1·R2·X6·I1-b)도 미리 넣는다. 표에 없는 코드는 field */
export const PROBLEM_SYS: ReadonlyMap<string, SystemId> = (() => {
  const m = new Map<string, SystemId>();
  const put = (sys: SystemId, codes: string): void => { for (const c of codes.split(' ')) m.set(c, sys); };
  put('call', 'CALL_QUEUE CALL_MISINFO CALL_VAGUE WRONG_ADDRESS FALSE_ALARM');
  put('dispatch', 'MISJUDGE_TYPE UNDERESTIMATE OVERESTIMATE NO_UNIT UNDER_DISPATCH BACKUP_LATE');
  put('other', 'DIVERTED');
  put('road', 'ROUTE_BLOCKED TRAFFIC_DELAY');
  put('crew', 'RESPONDER_HURT FATIGUE RESPONDER_KILLED');
  put('equip', 'EQUIP_FAIL WATER_OUT');
  put('hazard', 'ESCALATION HIDDEN_HAZARD SECONDARY_COLLISION SUSPECT_FLED EXPLOSION SUSPECT_DIED');
  put('building', 'STRUCT_COLLAPSE BURNOUT');
  put('hospital', 'HOSPITAL_FULL');
  put('infra', 'INFRA_FAIL');
  put('field', 'PATH_BLOCKED VICTIM_MISSED COMM_FAIL SCENE_MISMATCH LATE_DISCOVERY RECOUNT TIMEOUT METHOD_FAIL DANGER_SIGN WITHDRAWAL');
  return m;
})();
/**
 * 문구 규칙 — 칸이 없어 문구로만 가릴 수 있는 곳. 기록 문구를 바꾸면 tests/causality.test.ts 가 깨진다.
 * T1 지원 요청(dispatcher) · T2 응급실 대기(resources.arrive) · T3 이송 출발(sceneManager 5) 블록) · T4 병원 인계(resources.tickUnits)
 * T5 이어받은 상태 요약(I2) · T6 결원 운용 중단(resources.arrive) · T7 출동 지령(dispatcher.sendUnit)
 */
export const PHRASE = {
  T1: /인근 도시에 지원 요청/,
  T2: /응급실이 붐벼/,
  T3: /싣고 (.+?)(?:으로|로) 출발/,
  T4: /^(\S+): (.+?) 도착, 환자/,
  T5: /^지난 교대에서 이어받은 상태/,
  T6: /대원 전원 부상으로 운용 중단/,
  T7: /^출동 지령: (\S+) → 사건/,
} as const;

/** 기록 하나의 시스템 (§2.3 의 규칙, 위에서부터 첫 번째로 맞는 것) */
export function sysOf(e: SimEvent): SysOf {
  const tag = (e as { tag?: string }).tag;
  if (typeof tag === 'string') { const s = TAG_SYS.get(tag); if (s) return s; }
  if (e.problem) return PROBLEM_SYS.get(e.problem) ?? 'field';
  switch (e.kind) {
    case 'call': return 'call';
    case 'assess': return 'dispatch';
    case 'dispatch': return PHRASE.T1.test(e.text) ? 'aid' : 'dispatch';
    case 'traffic': return 'road';
    case 'hazard': return e.incidentId < 0 ? 'disaster' : 'hazard';
    case 'casualty': return PHRASE.T4.test(e.text) ? 'hospital' : 'field';
    case 'unit': return PHRASE.T2.test(e.text) ? 'hospital' : PHRASE.T6.test(e.text) ? 'crew' : 'field';
    case 'incident': return 'origin';
    case 'shift': return PHRASE.T5.test(e.text) ? 'carry' : 'none';
    default: return 'field';
  }
}
const isSys = (s: SysOf): s is SystemId => s !== 'origin' && s !== 'none';

// ───────────────────────── 기록 그래프 계산 (순수 함수 — 손 계산 테스트용) ─────────────────────────
// 모든 함수는 events[i].id === i 이고 causes 가 언제나 과거를 가리킨다고 본다 (emit 이 그렇게 만든다).

/** (§2.4 나) L(e) = 1 + max L(원인), 원인이 없으면 1 */
export function causeDepths(events: readonly SimEvent[]): Int32Array {
  const L = new Int32Array(events.length);
  for (let i = 0; i < events.length; i++) {
    let m = 0;
    for (const c of events[i].causes) if (c >= 0 && c < i && L[c] > m) m = L[c];
    L[i] = 1 + m;
  }
  return L;
}
/** 사건별 L 의 최댓값 (기록이 없으면 0) */
export function causesDepthByIncident(events: readonly SimEvent[], L: Int32Array, nInc: number): number[] {
  const out = new Array<number>(nInc).fill(0);
  for (const e of events) if (e.incidentId >= 0 && e.incidentId < nInc && L[e.id] > out[e.incidentId]) out[e.incidentId] = L[e.id];
  return out;
}
/** 사건 사이의 원인 간선 수와, 사건 없는 기록 → 사건 기록 간선 수 */
export function linkCounts(events: readonly SimEvent[], sys: readonly SysOf[]): { cross: number; world: number } {
  let cross = 0, world = 0;
  for (const e of events) {
    if (e.incidentId < 0) continue;
    for (const c of e.causes) {
      const ce = events[c];
      if (!ce) continue;
      if (ce.incidentId >= 0 && ce.incidentId !== e.incidentId) cross++;
      else if (ce.incidentId < 0 && isSys(sys[c])) world++;
    }
  }
  return { cross, world };
}
/** (§2.5 나) 간선 c → e 의 무게: 다른 사건으로, 또는 기본 세 시스템 밖의 새 시스템으로 넘어가면 1 */
export function spreadWeight(c: SimEvent, e: SimEvent, sc: SysOf, se: SysOf): 0 | 1 {
  if (e.incidentId >= 0 && e.incidentId !== c.incidentId) return 1;
  if (isSys(se) && !BASE.has(se) && se !== sc) return 1;
  return 0;
}
export interface SpreadGraph { raw: Int32Array; next: Int32Array }
/** F(e) = 자식 쪽으로 가는 길의 무게 합 최댓값, next[e] = 그 길의 다음 기록(같은 값이면 id 가 작은 자식) */
export function spreadGraph(events: readonly SimEvent[], sys: readonly SysOf[]): SpreadGraph {
  const n = events.length;
  const head = new Int32Array(n).fill(-1), link: number[] = [], to: number[] = [];
  // 자식 목록 (id 오름차순으로 넣었다가 거꾸로 이어지므로, 아래에서 같은 값일 때 작은 id 를 고른다)
  for (let i = 0; i < n; i++) for (const c of events[i].causes) if (c >= 0 && c < i) { to.push(i); link.push(head[c]); head[c] = to.length - 1; }
  const raw = new Int32Array(n), next = new Int32Array(n).fill(-1);
  for (let i = n - 1; i >= 0; i--) {
    let best = 0, bn = -1;
    for (let k = head[i]; k >= 0; k = link[k]) {
      const ch = to[k];
      const v = spreadWeight(events[i], events[ch], sys[i], sys[ch]) + raw[ch];
      if (bn < 0 || v > best || (v === best && ch < bn)) { best = v; bn = ch; }
    }
    raw[i] = best; next[i] = bn;
  }
  return { raw, next };
}
/** next[] 로 되짚은 길 (시작 기록 포함). 마지막 무게 1 간선 뒤의 꼬리는 자른다 */
export function spreadPath(events: readonly SimEvent[], sys: readonly SysOf[], g: SpreadGraph, start: number): number[] {
  const path = [start];
  let lastW = 0, x = start;
  for (let guard = 0; guard < 10000 && g.next[x] >= 0; guard++) {
    const y = g.next[x];
    path.push(y);
    if (spreadWeight(events[x], events[y], sys[x], sys[y])) lastW = path.length;
    x = y;
  }
  return path.slice(0, Math.max(1, lastW));
}
/** 길에서 무게 1 간선이 가리키는 기록의 (사건, 시스템) 쌍 가운데 서로 다른 것의 수 */
export function spreadDistinct(events: readonly SimEvent[], sys: readonly SysOf[], path: readonly number[]): number {
  const seen = new Set<string>();
  for (let k = 1; k < path.length; k++) {
    const c = path[k - 1], e = path[k];
    if (spreadWeight(events[c], events[e], sys[c], sys[e])) seen.add(events[e].incidentId + ':' + sys[e]);
  }
  return seen.size;
}
export interface SpreadBest { distinct: number; raw: number; start: number }
/** 사건별 확산 단계(distinct 최대, 같으면 raw 가 큰 것)와 사건 없는 기록에서 시작한 확산(world) */
export function spreadByIncident(events: readonly SimEvent[], sys: readonly SysOf[], nInc: number, g = spreadGraph(events, sys)): { inc: SpreadBest[]; world: SpreadBest; graph: SpreadGraph } {
  const inc: SpreadBest[] = [];
  for (let k = 0; k < nInc; k++) inc.push({ distinct: 0, raw: 0, start: -1 });
  const world: SpreadBest = { distinct: 0, raw: 0, start: -1 };
  for (const e of events) {
    const raw = g.raw[e.id];
    let tgt: SpreadBest | null = null;
    if (e.incidentId >= 0 && e.incidentId < nInc) tgt = inc[e.incidentId];
    else if (e.incidentId < 0 && isSys(sys[e.id])) tgt = world;
    if (!tgt) continue;
    if (raw <= 0) { if (tgt.start < 0) tgt.start = e.id; continue; }
    const d = spreadDistinct(events, sys, spreadPath(events, sys, g, e.id));
    if (d > tgt.distinct || (d === tgt.distinct && raw > tgt.raw) || tgt.start < 0) { tgt.distinct = d; tgt.raw = raw; tgt.start = e.id; }
  }
  return { inc, world, graph: g };
}
/**
 * 사건별 시스템 집합 가운데 기록으로 정해지는 몫: 그 사건 기록의 시스템 ∪ 그 기록이 원인으로 가리키는 사건 없는 기록의 시스템
 * ∪ (다른 사건 기록을 원인으로 가리키면) other
 */
export function eventSystems(events: readonly SimEvent[], sys: readonly SysOf[], nInc: number): Set<SystemId>[] {
  const S: Set<SystemId>[] = [];
  for (let k = 0; k < nInc; k++) S.push(new Set<SystemId>());
  for (const e of events) {
    if (e.incidentId < 0 || e.incidentId >= nInc) continue;
    const set = S[e.incidentId], s = sys[e.id];
    if (isSys(s)) set.add(s);
    for (const c of e.causes) {
      const ce = events[c];
      if (!ce) continue;
      if (ce.incidentId < 0) { const cs = sys[c]; if (isSys(cs)) set.add(cs); }
      else if (ce.incidentId !== e.incidentId) set.add('other');
    }
  }
  return S;
}
const WORLD_SYS: ReadonlySet<SysOf> = new Set<SysOf>(['road', 'hospital', 'infra', 'building', 'disaster', 'other', 'aid', 'carry']);
/** (§2.6) 재계획 신호 기록이 다른 시스템의 변화에서 왔는가: 원인을 너비 우선으로 거슬러 서로 다른 조상 30개까지 본다 */
export function fromWorldOf(events: readonly SimEvent[], sys: readonly SysOf[], sig: number): boolean {
  const se = events[sig];
  if (!se) return false;
  const seen = new Set<number>([sig]);
  let frontier = [sig], count = 0;
  while (frontier.length && count < 30) {
    const lvl: number[] = [];
    for (const x of frontier) for (const c of events[x].causes) if (c >= 0 && !seen.has(c)) { seen.add(c); lvl.push(c); }
    lvl.sort((a, b) => b - a);
    const nextF: number[] = [];
    for (const c of lvl) {
      if (count >= 30) break;
      count++; nextF.push(c);
      if (WORLD_SYS.has(sys[c]) || events[c].incidentId !== se.incidentId) return true;
    }
    frontier = nextF;
  }
  return false;
}

// ───────────────────────── 전환 배정 (§2.9) ─────────────────────────
export interface EtaEntry { unit: number; t: number; fromInc: number; fromEta: number }
export interface DivertRow { j: number; i: number; unit: number; t: number; pe: number; hurt: boolean; eta: number | null; lostSec: number | null; refillSec: number | null }
interface DivertInc { id: number; problems: { code: string; t: number; eventId: number }[]; firstArrivalAt: number; closedAt: number; dispatchLog: number[] }
/**
 * DIVERTED 하나 = 전환 하나. 받는 사건과 부대는 그 문제 기록 바로 뒤의 첫 출동 기록(kind 'dispatch', role 'DISPATCH')에서 읽는다.
 * 그 기록이 같은 시각·다른 사건·출동 지령 문구(T7)가 아니면 일치 검사 C4 위반이다.
 */
export function divertAnalysis(events: readonly SimEvent[], incidents: readonly DivertInc[], units: readonly { callsign: string }[], etaLog: readonly EtaEntry[] | null, endT: number): { rows: DivertRow[]; c4: number } {
  const byCall = new Map<string, number>();
  units.forEach((u, k) => byCall.set(u.callsign, k));
  const rows: DivertRow[] = [];
  let c4 = 0;
  for (const J of incidents) for (const p of J.problems) {
    if (p.code !== 'DIVERTED') continue;
    const pe = p.eventId;
    let k = pe + 1, found = -1;
    for (; k < events.length && events[k].t <= p.t; k++) if (events[k].kind === 'dispatch' && events[k].role === 'DISPATCH') { found = k; break; }
    const de = found >= 0 ? events[found] : null;
    const m = de ? PHRASE.T7.exec(de.text) : null;
    const ok = !!de && !!m && de.t === p.t && de.incidentId >= 0 && de.incidentId !== J.id;
    if (!ok) c4++;
    const unit = ok ? byCall.get(m![1]) ?? -1 : -1;
    const hurt = J.firstArrivalAt < 0 || J.firstArrivalAt > p.t;
    let eta: number | null = null;
    if (etaLog && unit >= 0) for (const x of etaLog) if (x.unit === unit && x.fromInc === J.id && x.t >= p.t) { eta = x.fromEta; break; }
    const arrive = J.firstArrivalAt >= 0 ? J.firstArrivalAt : J.closedAt >= 0 ? J.closedAt : endT;
    const lostSec = hurt && eta !== null ? Math.max(0, arrive - eta) : null;
    let refillSec: number | null = null;
    for (const id of J.dispatchLog) if (id > pe) { refillSec = (events[id]?.t ?? p.t) - p.t; break; }
    rows.push({ j: J.id, i: ok ? de!.incidentId : -1, unit, t: p.t, pe, hurt, eta, lostSec, refillSec });
  }
  return { rows, c4 };
}

// ───────────────────────── 잊힌 사건 (§2.10 나) ─────────────────────────
interface WaitInc { phase: string; assigned: readonly number[]; pursuit?: { state: string } | undefined; assessment: unknown; locationKnown: boolean; unmet: Partial<Needs> }
/** 'forgot' = 통화가 끝났는데 아무도 맡지 않았다(위치·평가가 있고 대기열도 아니다), 'unloc' = 위치·평가를 모른 채 남았다 */
export function waitState(I: WaitInc, liveCall: boolean): 'forgot' | 'unloc' | null {
  const c1 = (I.phase === 'call' && !liveCall) || I.phase === 'dispatched';
  if (!c1 || I.assigned.length > 0 || I.pursuit?.state === 'driving') return null;
  if (!I.assessment || !I.locationKnown) return 'unloc';
  return unmetSum(I) === 0 ? 'forgot' : null;
}

// ───────────────────────── 일치 검사 (§2.12) ─────────────────────────
/** C5: 이송 출발 문구(T3)의 병원 = 같은 부대의 다음 인계 문구(T4)의 병원. 다음 T4 가 없거나 환자 0명 출발은 건너뛴다 */
export function checkC5(events: readonly SimEvent[]): { bad: number; n: number } {
  let bad = 0, n = 0;
  const open = new Map<string, string | null>();      // 부대 → 출발 문구의 병원 (null = 비교하지 않는 출발)
  for (const e of events) {
    const t3 = PHRASE.T3.exec(e.text);
    if (t3) {
      const zero = /환자 0명 싣고/.test(e.text);
      open.set(e.actor, zero ? null : t3[1]);
      continue;
    }
    const t4 = PHRASE.T4.exec(e.text);
    if (t4 && open.has(e.actor)) {
      const h = open.get(e.actor)!;
      open.delete(e.actor);
      if (h === null) continue;
      n++;
      if (h !== t4[2]) bad++;
    }
  }
  return { bad, n };
}

// ───────────────────────── 표본 (Probe) ─────────────────────────
interface Snap { disc: (string | number)[]; fire: number; cont: number[] }
interface StallBest { len: number; start: number; active: number; open: string; last: number }

/** 틱 표본 (읽기만). runWithProbe 가 SAMPLE_EVERY 틱마다 sample() 을 부른다 */
export class Probe {
  readonly sim: Sim;
  failed = false;
  errors = 0;
  samples = 0;
  // 지표 1: 버린 예약·재난 큐
  dropped = 0; disasterSkipped = 0; disasterCleared = 0;
  // 지표 6: 바쁜 부대 비율의 최댓값, 전환 전의 예정 도착, 응급실 경쟁
  peakBusy = 0;
  readonly etaLog: EtaEntry[] = [];
  erCross = 0;
  /** 표본으로 다른 사건의 영향(응급실 대기·다른 사건이 느리게 한 구간)을 본 사건 */
  readonly otherInc = new Set<number>();
  /** 표본으로 지난 교대의 복구 공사 구간을 지난 출동을 본 사건 (I2) */
  readonly carryInc = new Set<number>();
  // 지표 7: 사건별
  readonly stallBest: (StallBest | null)[] = [];
  readonly forgotBest: number[] = [];
  readonly unlocBest: number[] = [];
  readonly idleSec: number[] = [];
  readonly queueSec: number[] = [];

  private evIdx = 0;
  private prevChain: unknown[] = [];
  private prevIncN = 0;
  private prevQueue: unknown[] = [];
  private prevSpawned = 0;
  private uInc: number[] = [];
  private uEta: number[] = [];
  private callIdx = new Map<string, number>();
  private callN = -1;
  private stallStart: number[] = [];
  private snaps: (Snap | null)[] = [];
  private evFlag: number[] = [];
  private lastImp: number[] = [];
  private forgotStart: number[] = [];
  private unlocStart: number[] = [];
  private liveStamp: number[] = [];
  private erPending: number[] = [];

  constructor(sim: Sim) { this.sim = sim; this.prevIncN = sim.incidents.length; }

  private grow(n: number): void {
    while (this.stallBest.length < n) {
      this.stallBest.push(null); this.forgotBest.push(0); this.unlocBest.push(0); this.idleSec.push(0); this.queueSec.push(0);
      this.stallStart.push(-1); this.snaps.push(null); this.evFlag.push(0); this.lastImp.push(-1); this.forgotStart.push(-1); this.unlocStart.push(-1); this.liveStamp.push(-1);
    }
  }

  sample(): void {
    const sim = this.sim, now = sim.t, dtS = sim.dt * SAMPLE_EVERY;
    this.samples++;
    const nInc = sim.incidents.length;
    this.grow(nInc);
    // 1) 새 기록: 진전 신호(중요도 1 이상, 진실이 아닌 것)와 응급실 대기(T2)
    const evs = sim.events;
    for (let k = this.evIdx; k < evs.length; k++) {
      const e = evs[k];
      if (e.incidentId >= 0 && e.incidentId < nInc && !e.truth && e.importance >= 1) { this.evFlag[e.incidentId] = 1; this.lastImp[e.incidentId] = e.id; }
      if (e.kind === 'unit' && PHRASE.T2.test(e.text)) this.erPending.push(e.id);
    }
    this.evIdx = evs.length;
    // 2) 버린 예약 (근사): 사라진 예약을 (부모, 유형, 변형)으로 묶어 그 사이 새로 생긴 사건과 짝짓는다
    const chain = sim.gen.chain;
    if (this.prevChain.length) {
      const gone = new Map<string, number>();
      for (const c of this.prevChain) if ((chain as unknown[]).indexOf(c) < 0) {
        const o = (c as { opts: { parent?: number; type?: string; variant?: string } }).opts;
        const key = `${o.parent ?? ''}|${o.type ?? ''}|${o.variant ?? ''}`;
        gone.set(key, (gone.get(key) ?? 0) + 1);
      }
      if (gone.size) {
        const made = new Map<string, number>();
        for (let k = this.prevIncN; k < nInc; k++) { const J = sim.incidents[k]; const key = `${J.parent ?? ''}|${J.truth.type}|${J.truth.variant}`; made.set(key, (made.get(key) ?? 0) + 1); }
        for (const [key, g] of gone) this.dropped += Math.max(0, g - (made.get(key) ?? 0));
      }
    }
    this.prevChain = chain.length ? chain.slice() : [];
    this.prevIncN = nInc;
    // 3) 재난 큐 (근사): 사라진 항목 − 그 사이 재난이 일으킨 사건. 통째로 비운 것(3개 이상이 사라지고 길이 0)은 따로
    const d = sim.disaster;
    if (d) {
      const q = d.queue as unknown[];
      let gone = 0;
      for (const it of this.prevQueue) if (q.indexOf(it) < 0) gone++;
      const net = Math.max(0, gone - (d.spawned.length - this.prevSpawned));
      if (gone >= 3 && q.length === 0) this.disasterCleared += net; else this.disasterSkipped += net;
      this.prevQueue = q.length ? q.slice() : [];
      this.prevSpawned = d.spawned.length;
    }
    // 4) 부대: 바쁜 비율, 배정이 바뀐 부대의 직전 예정 도착, 남은 경로
    const units = sim.units;
    let busy = 0, denom = 0;
    for (let ui = 0; ui < units.length; ui++) {
      const u = units[ui];
      if (u.state !== 'oos') { denom++; if (u.state !== 'available') busy++; }
      const cur = u.incidentId ?? -1;
      if (ui < this.uInc.length) {
        if (this.uInc[ui] !== cur && this.uInc[ui] >= 0) this.etaLog.push({ unit: ui, t: now, fromInc: this.uInc[ui], fromEta: this.uEta[ui] });
        this.uInc[ui] = cur; this.uEta[ui] = u.estArrive;
      } else { this.uInc.push(cur); this.uEta.push(u.estArrive); }
    }
    if (denom > 0 && busy / denom > this.peakBusy) this.peakBusy = busy / denom;
    // 응급실 대기: 같은 교차로에서 인계 중인 다른 부대가 다른 사건의 환자를 싣고 왔는가
    if (this.erPending.length) {
      if (this.callN !== units.length) { this.callIdx.clear(); for (let ui = 0; ui < units.length; ui++) this.callIdx.set(units[ui].callsign, ui); this.callN = units.length; }
      for (const id of this.erPending) {
        const e = evs[id], ui = this.callIdx.get(e.actor);
        if (ui === undefined) continue;
        const u = units[ui];
        let cross = false;
        for (const q of units) {
          if (q === u || q.state !== 'hospital' || q.nodeId !== u.nodeId || q.patientsIncident === null || q.patientsIncident === e.incidentId) continue;
          cross = true; this.otherInc.add(q.patientsIncident);
        }
        if (cross) { this.erCross++; if (e.incidentId >= 0) this.otherInc.add(e.incidentId); }
      }
      this.erPending.length = 0;
    }
    // 다른 열린 사건이 느리게 한 구간(blockedEdge, slow > 0), 지난 교대의 복구 공사 구간('repair')을 남은 경로에 둔 출동
    const blocked: number[] = [];
    for (let k = 0; k < nInc; k++) { const J = sim.incidents[k]; if (J.phase !== 'closed' && J.blockedEdge >= 0 && sim.city.edges[J.blockedEdge].slow > 0) blocked.push(J.blockedEdge, J.id); }
    for (const u of units) {
      if (u.state !== 'enroute' || u.incidentId === null || !u.route) continue;
      const I = u.incidentId, es = u.route.edges;
      for (let k = Math.max(0, u.seg); k < es.length; k++) {
        const eid = es[k];
        for (let b = 0; b < blocked.length; b += 2) if (blocked[b] === eid && blocked[b + 1] !== I) this.otherInc.add(I);
        if (sim.city.edges[eid].closedReason === 'repair') this.carryInc.add(I);
      }
    }
    // 5) 사건: 멈춤 시계·잊힌 사건·느슨한 대기
    const stamp = this.samples;
    for (const c of sim.calls) if (c.incidentId >= 0 && c.incidentId < nInc && (c.state === 'ringing' || c.state === 'active')) this.liveStamp[c.incidentId] = stamp;
    for (let k = 0; k < nInc; k++) {
      const I = sim.incidents[k];
      const flag = this.evFlag[k]; this.evFlag[k] = 0;
      if (I.phase === 'closed' || I.phase === 'unreported') { this.stallStart[k] = -1; this.snaps[k] = null; this.forgotStart[k] = -1; this.unlocStart[k] = -1; continue; }
      // (나) 잊힌 사건 / 위치를 모르는 사건
      const ws = waitState(I, this.liveStamp[k] === stamp);
      if (ws === 'forgot') { if (this.forgotStart[k] < 0) this.forgotStart[k] = now; this.forgotBest[k] = Math.max(this.forgotBest[k], now - this.forgotStart[k]); } else this.forgotStart[k] = -1;
      if (ws === 'unloc') { if (this.unlocStart[k] < 0) this.unlocStart[k] = now; this.unlocBest[k] = Math.max(this.unlocBest[k], now - this.unlocStart[k]); } else this.unlocStart[k] = -1;
      // (가) 엄격한 멈춤 · (다) 느슨한 대기
      const s = sim.scenes[k];
      let running = false;
      if (s && I.phase === 'onscene' && !(I.pursuit && I.pursuit.state === 'driving')) {
        let active = 0, idle = true;
        for (const a of s.agents) if (a.status === 'active') { active++; if (a.task && a.task.kind !== 'standby' && a.task.kind !== 'rehab') idle = false; }
        if (active > 0) {
          if (idle) this.idleSec[k] += dtS;
          let coming = false;
          for (const uid of I.assigned) { const st = units[uid].state; if (st === 'enroute' || st === 'turnout') { coming = true; break; } }
          const queued = unmetSum(I) > 0;
          if (queued) this.queueSec[k] += dtS;
          if (!coming && !queued) {
            running = true;
            const prev = this.snaps[k];
            const snap = takeSnap(sim, I, s, prev);
            if (this.stallStart[k] < 0 || flag || !prev || progressed(prev, snap)) this.stallStart[k] = now;
            this.snaps[k] = snap;
            const len = now - this.stallStart[k];
            const best = this.stallBest[k];
            if (len > 0 && (!best || len > best.len)) this.stallBest[k] = { len, start: this.stallStart[k], active, open: openWork(s.board), last: this.lastImp[k] };
          }
        }
      }
      if (!running) { this.stallStart[k] = -1; this.snaps[k] = null; }
    }
  }
}

/** 현장 하나의 표본: 이산 칸(작업판·구조 대상·용의자·배정 부대·대원 임무), 불 칸 수, 대원 위치·진행도 */
function takeSnap(sim: Sim, I: Incident, s: Scene, prev: Snap | null): Snap {
  const disc: (string | number)[] = [];
  disc.push(s.board.length);
  for (const w of s.board) disc.push(w.status, w.assignees.length);
  disc.push(s.casualties.length);
  for (const c of s.casualties) disc.push(c.where, c.treated ? 1 : 0, c.dead ? 1 : 0, c.mob);
  disc.push(s.hostiles.length);
  for (const h of s.hostiles) disc.push(h.state);
  disc.push(I.assigned.length);
  for (const uid of I.assigned) disc.push(uid, sim.units[uid].state);
  disc.push(s.agents.length);
  const cont: number[] = [];
  for (const a of s.agents) {
    disc.push(a.status, a.task ? a.task.kind : '', a.task ? a.task.phase : -1);
    cont.push(a.x, a.y, a.ring, a.task ? a.task.progress : 0);
  }
  // 불 칸 수 (fire > 0.2). 마지막 화재 틱에 타는 칸이 하나도 없었고(s.burning) 직전 표본도 0 이면 훑지 않는다
  let fire = 0;
  if (s.burning > 0 || (prev !== null && prev.fire > 0)) { const f = s.fire; for (let i = 0; i < f.length; i++) if (f[i] > 0.2) fire++; }
  return { disc, fire, cont };
}
/** 직전 표본 이후 진전이 있었는가 (§2.10 의 진전 신호 표 — 기록 신호는 Probe 가 따로 본다) */
function progressed(a: Snap, b: Snap): boolean {
  if (a.disc.length !== b.disc.length) return true;
  for (let i = 0; i < a.disc.length; i++) if (a.disc[i] !== b.disc[i]) return true;
  if (b.fire < a.fire) return true;
  if (a.cont.length !== b.cont.length) return true;
  for (let i = 0; i < a.cont.length; i += 4) {
    if (Math.hypot(b.cont[i] - a.cont[i], b.cont[i + 1] - a.cont[i + 1]) > 1.5) return true;
    if (Math.abs(b.cont[i + 2] - a.cont[i + 2]) > 0.01 || Math.abs(b.cont[i + 3] - a.cont[i + 3]) > 0.01) return true;
  }
  return false;
}
function openWork(board: readonly WorkItem[]): string {
  const kinds: string[] = [];
  let n = 0;
  for (const w of board) if (w.status === 'open' || w.status === 'active') { n++; if (kinds.indexOf(w.kind) < 0) kinds.push(w.kind); }
  return n ? `${n} (${kinds.slice(0, 4).join(',')}${kinds.length > 4 ? ',…' : ''})` : '0';
}

/** runToEnd 와 같은 순서로 step() 만 부르고, SAMPLE_EVERY 틱마다 표본을 뜬다. 표본의 예외는 시뮬레이션을 막지 않는다 */
export function runWithProbe(sim: Sim, maxTicks = 20000): Probe {
  const probe = new Probe(sim);
  let n = 0;
  while (!sim.ended && n++ < maxTicks) {
    sim.step();
    if (!probe.failed && sim.tick % SAMPLE_EVERY === 0) {
      try { probe.sample(); } catch { probe.failed = true; probe.errors++; }
    }
  }
  return probe;
}

// ───────────────────────── 교대 하나의 지표 ─────────────────────────
const NOISE: ReadonlySet<string> = new Set(['CALL_QUEUE', 'CALL_VAGUE', 'CALL_MISINFO', 'UNDER_DISPATCH', 'OVERESTIMATE', 'FALSE_ALARM']);
const CONTENTION = ['NO_UNIT', 'CALL_QUEUE', 'DIVERTED', 'BACKUP_LATE'] as const;
const REPLAN_FIELD_REC: ReadonlySet<string> = new Set(['PATH_BLOCKED', 'WATER_OUT', 'EQUIP_FAIL', 'DANGER_SIGN']);
const REPLAN_FIELD_ANY: ReadonlySet<string> = new Set(['COMM_FAIL', 'VICTIM_MISSED', 'RECOUNT', 'SCENE_MISMATCH', 'METHOD_FAIL', 'WITHDRAWAL']);
const REPLAN_DISPATCH_REC: ReadonlySet<string> = new Set(['MISJUDGE_TYPE']);
const REPLAN_DISPATCH_ANY: ReadonlySet<string> = new Set(['HOSPITAL_FULL']);
const REPLAN_ROUTE_ANY: ReadonlySet<string> = new Set(['ROUTE_BLOCKED']);
/** 같은 목적의 다른 작업 (§2.7). 나머지 작업은 대체 수단이 없다 */
export const PURPOSE: Readonly<Record<string, string>> = { negotiate: 'subdue', engage: 'subdue', arrest: 'subdue', carry: 'move', escort: 'move' };

/** R2 의 MethodUse (있으면 읽는다) */
interface MethodUseLike { t: number; work: string; method: string; ok: boolean; cas: number; prop: number; hostile: number; region: number; tile: number }

export interface IncRow {
  seed: string; id: number; code: string; scen: string; benign: boolean;
  parentDepth: number; rooted: number; causesDepth: number;
  systems: SystemId[]; spread: number; spreadRaw: number; spreadPath: string | null;
  replan: { field: boolean; dispatch: boolean; route: boolean; codes: string[] }; cancelled: number; fromWorld: number;
  alt: { itemsN: number; itemsRetry: number; itemsAlt: number; pathN: number; pathRec: number; equipN: number; equipRec: number; waterN: number; waterRec: number };
  methods: { groups: number; altOk: number; ok: [string, string][] } | null;
  done: [string, number][]; order: string;
  outcome: string; story: string; contention: string[];
  idleSec: number | null; queueSec: number | null;
  repeat: number; repeatText: string;
}
export interface StallCand { kind: 'STALL' | 'FORGOT' | 'UNLOC'; seed: string; code: string; scen: string; clock: string; t: number; len: number; active: number; open: string; last: string; end: string }
export interface ShiftMetrics {
  seed: string; sampled: boolean; probeErrors: number;
  incidents: IncRow[];
  chained: number; maxParentDepth: number;
  dropped: number | null; disasterSkipped: number | null; disasterCleared: number | null;
  crossLinks: number; worldLinks: number; spreadWorld: number; spreadWorldRaw: number;
  aidUsed: number; peakOpen: number; peakBusy: number | null;
  divert: DivertRow[]; erWaits: number; erCross: number | null;
  consistency: { C1: number; C2: number; C3: number; C4: number; C5: number; C5n: number };
  stall: StallCand[] | null; forgotten: StallCand[] | null; unlocated: StallCand[] | null;
}

function parentDepthOf(incs: readonly Incident[], I: Incident): { depth: number; root: Incident } {
  let d = 0, x = I;
  while (x.parent !== undefined && d < 50) { const p = incs[x.parent]; if (!p) break; x = p; d++; }
  return { depth: d, root: x };
}
const isDisasterTag = (I: Incident): boolean => typeof I.tag === 'string' && I.tag.startsWith('disaster:');
export function isBenign(I: Incident): boolean { return I.truth.variant === 'false' || I.truth.variant === 'prank' || I.problems.some((p) => p.code === 'FALSE_ALARM'); }
function evLabel(sim: Sim, e: SimEvent, sys: SysOf, texts: boolean): string {
  const code = e.incidentId >= 0 ? '#' + (sim.incidents[e.incidentId]?.code ?? '?') : '#--';
  return `${code}:${sys}${texts ? ` "${e.text.slice(0, 40)}"` : ''}`;
}

/** 교대 하나. probe 가 없거나 실패했으면 표본 항목은 null */
export function shiftMetrics(sim: Sim, probe: Probe | null, opts: { texts?: boolean } = {}): ShiftMetrics {
  const P = probe && !probe.failed ? probe : null;
  const events = sim.events, incs = sim.incidents, nInc = incs.length;
  const sys: SysOf[] = new Array(events.length);
  for (let i = 0; i < events.length; i++) sys[i] = sysOf(events[i]);
  const byInc: number[][] = [];
  for (let k = 0; k < nInc; k++) byInc.push([]);
  for (const e of events) if (e.incidentId >= 0 && e.incidentId < nInc) byInc[e.incidentId].push(e.id);
  const L = causeDepths(events);
  const cDepth = causesDepthByIncident(events, L, nInc);
  const links = linkCounts(events, sys);
  const sp = spreadByIncident(events, sys, nInc);
  const evSys = eventSystems(events, sys, nInc);
  const dv = divertAnalysis(events, incs, sim.units, P ? P.etaLog : null, sim.t);
  const received = new Set<number>();
  for (const r of dv.rows) if (r.i >= 0) received.add(r.i);
  const hasChild = new Set<number>();
  for (const I of incs) if (I.parent !== undefined) hasChild.add(I.parent);
  const marks = (sim as { placeMarks?: Map<number, unknown> }).placeMarks;
  const carryPlaces = (sim as { carryState?: { places?: Map<number, unknown> } }).carryState?.places;

  const rows: IncRow[] = [];
  let chained = 0, maxParentDepth = 0;
  for (const I of incs) {
    const s = sim.scenes[I.id];
    const benign = isBenign(I);
    const pd = parentDepthOf(incs, I);
    if (I.parent !== undefined) chained++;
    if (pd.depth > maxParentDepth) maxParentDepth = pd.depth;
    const rooted = pd.depth + (isDisasterTag(pd.root) ? 1 : 0);
    // 시스템 집합 S(I)
    const S = new Set<SystemId>(evSys[I.id]);
    if (I.blockedEdge >= 0) S.add('road');
    if (s && s.casualties.some((c) => c.tHospital >= 0)) S.add('hospital');
    if (s && (s.glass.indexOf(1) >= 0 || s.decorHp.indexOf(255) >= 0 || s.burnedTiles > 0)) S.add('building');
    if (marks && I.truth.placeId >= 0 && marks.has(I.truth.placeId)) S.add('building');
    if (I.parent !== undefined || hasChild.has(I.id) || received.has(I.id) || I.problems.some((p) => p.code === 'DIVERTED')) S.add('other');
    if (P && P.otherInc.has(I.id)) S.add('other');
    if (I.aidUnit !== undefined) S.add('aid');
    if (isDisasterTag(I)) S.add('disaster');
    if (carryPlaces && I.truth.placeId >= 0 && carryPlaces.has(I.truth.placeId)) S.add('carry');
    if (P && P.carryInc.has(I.id)) S.add('carry');
    // I2 §7 ②: 이어받은 건물 손상이 있는 현장, 결장한 대원이 있는 부대가 나간 사건 (칸이 없어도 컴파일되게 읽는다)
    if ((s as { wear?: unknown } | null | undefined)?.wear) S.add('carry');
    for (const uid of I.everAssigned) { const u = sim.units[uid]; if (u && u.crew.some((rid) => (sim.responders[rid]?.status as string) === 'off')) { S.add('carry'); break; } }
    const systems = SYSTEMS.filter((x) => S.has(x));
    // 확산
    const best = sp.inc[I.id];
    let spreadPathStr: string | null = null;
    if (best.distinct > 0 && best.start >= 0) {
      const path = spreadPath(events, sys, sp.graph, best.start);
      const shown = path.slice(0, 12).map((id) => evLabel(sim, events[id], sys[id], !!opts.texts));
      spreadPathStr = `${sim.seed} #${I.code} ${I.truth.type}/${I.truth.variant} spread ${best.distinct} (raw ${best.raw}): ${shown.join(' → ')}${path.length > 12 ? ' → …' : ''}`;
    }
    // 재계획
    const codes = new Set<string>();
    const sigs: number[] = [];
    let rf = false, rd = false, rr = false;
    for (const p of I.problems) {
      let hit = false;
      if ((REPLAN_FIELD_REC.has(p.code) && p.recovered) || REPLAN_FIELD_ANY.has(p.code)) { rf = true; hit = true; }
      else if ((REPLAN_DISPATCH_REC.has(p.code) && p.recovered) || REPLAN_DISPATCH_ANY.has(p.code)) { rd = true; hit = true; }
      else if (REPLAN_ROUTE_ANY.has(p.code)) { rr = true; hit = true; }
      if (hit) { codes.add(p.code); if (p.eventId >= 0) sigs.push(p.eventId); }
    }
    const fa = I.firstAssess, as = I.assessment;
    if (fa && as && (fa.type !== as.type || Math.abs(fa.severity - as.severity) >= 1)) {
      rd = true; codes.add('ASSESS');
      if (I.firstArrivalAt >= 0) for (const id of byInc[I.id]) { const e = events[id]; if (e.kind === 'assess' && e.t >= I.firstArrivalAt) { sigs.push(id); break; } }
    }
    let fromWorld = 0;
    for (const id of sigs) if (fromWorldOf(events, sys, id)) fromWorld++;
    let cancelled = 0;
    if (s) for (const w of s.board) if (w.status === 'cancelled') cancelled++;
    // 대체 방법
    const alt = { itemsN: 0, itemsRetry: 0, itemsAlt: 0, pathN: 0, pathRec: 0, equipN: 0, equipRec: 0, waterN: 0, waterRec: 0 };
    if (s) for (const w of s.board) {
      if (w.fails <= 0) continue;
      alt.itemsN++;
      if (w.status === 'done') { alt.itemsRetry++; continue; }
      const pu = PURPOSE[w.kind];
      if (pu && s.board.some((w2) => w2.kind !== w.kind && PURPOSE[w2.kind] === pu && w2.status === 'done' && w2.doneAt >= w.createdAt
        && w2.cas === w.cas && w2.hostile === w.hostile && w2.prop === w.prop && w2.region === w.region && w2.tile === w.tile && w2.mate === w.mate)) alt.itemsAlt++;
    }
    for (const p of I.problems) {
      if (p.code === 'PATH_BLOCKED') { alt.pathN++; if (p.recovered) alt.pathRec++; }
      else if (p.code === 'EQUIP_FAIL') { alt.equipN++; if (p.recovered) alt.equipRec++; }
      else if (p.code === 'WATER_OUT') { alt.waterN++; if (p.recovered) alt.waterRec++; }
    }
    // R2 의 방법 기록 (있으면)
    let methods: IncRow['methods'] = null;
    const mu = (I as { methods?: MethodUseLike[] }).methods;
    if (Array.isArray(mu) && mu.length) {
      const groups = new Map<string, MethodUseLike[]>();
      for (const m of mu) { const key = `${m.work}|${m.cas}|${m.prop}|${m.hostile}|${m.region}|${m.tile}`; const g = groups.get(key); if (g) g.push(m); else groups.set(key, [m]); }
      let ng = 0, altOk = 0;
      for (const g of groups.values()) {
        const failed = g.filter((m) => !m.ok);
        if (!failed.length) continue;
        ng++;
        const bad = new Set(failed.map((m) => m.method)), t0 = Math.min(...failed.map((m) => m.t));
        if (g.some((m) => m.ok && m.t > t0 && !bad.has(m.method))) altOk++;
      }
      methods = { groups: ng, altOk, ok: mu.filter((m) => m.ok).map((m): [string, string] => [m.work, m.method]) };
    }
    // 행동
    const doneMap = new Map<string, number>();
    const doneItems: WorkItem[] = [];
    if (s) for (const w of s.board) if (w.status === 'done') { doneMap.set(w.kind, (doneMap.get(w.kind) ?? 0) + 1); doneItems.push(w); }
    doneItems.sort((a, b) => a.doneAt - b.doneAt || a.id - b.id);
    const order: string[] = [];
    for (const w of doneItems) if (order.indexOf(w.kind) < 0) order.push(w.kind);
    // 결과 다양성
    let main: { code: string; t: number } | null = null;
    for (const p of I.problems) if (!NOISE.has(p.code) && (!main || p.t < main.t)) main = p;
    const outcome = I.result ? I.result.outcome : 'unresolved';
    // 반복
    const rep = new Map<string, number>();
    let repeat = 0, repeatText = '';
    for (const id of byInc[I.id]) {
      const e = events[id];
      if (e.importance < 1) continue;
      const key = e.actor + '\u0000' + e.text, v = (rep.get(key) ?? 0) + 1;
      rep.set(key, v);
      if (v > repeat) { repeat = v; repeatText = `${e.actor}: ${e.text}`; }
    }
    rows.push({
      seed: sim.seed, id: I.id, code: I.code, scen: `${I.truth.type}/${I.truth.variant}`, benign,
      parentDepth: pd.depth, rooted, causesDepth: cDepth[I.id],
      systems, spread: best.distinct, spreadRaw: best.raw, spreadPath: spreadPathStr,
      replan: { field: rf, dispatch: rd, route: rr, codes: Array.from(codes).sort() }, cancelled, fromWorld,
      alt, methods,
      done: Array.from(doneMap.entries()).sort((a, b) => (a[0] < b[0] ? -1 : 1)), order: order.join(','),
      outcome, story: `${outcome}|${main ? main.code : 'none'}`,
      contention: CONTENTION.filter((c) => I.problems.some((p) => p.code === c)),
      idleSec: P ? P.idleSec[I.id] ?? 0 : null, queueSec: P ? P.queueSec[I.id] ?? 0 : null,
      repeat, repeatText,
    });
  }
  // 교대 단위: 최대 동시 사건 (사후)
  const pts: [number, number][] = [];
  for (const I of incs) { pts.push([I.createdAt, 1]); pts.push([I.closedAt >= 0 ? I.closedAt : sim.t, -1]); }
  pts.sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  let open = 0, peakOpen = 0;
  for (const [, d] of pts) { open += d; if (open > peakOpen) peakOpen = open; }
  // 일치 검사
  let C1 = 0, C2 = 0, C3 = 0;
  for (const I of incs) {
    for (const p of I.problems) if (p.eventId >= 0 && events[p.eventId]?.incidentId !== I.id) C1++;
    let res = 0, t4 = false;
    for (const id of byInc[I.id]) { const e = events[id]; if (e.kind === 'resolve' && e.actor === '사건 관리') res++; if (PHRASE.T4.test(e.text)) t4 = true; }
    if (res !== (I.phase === 'closed' ? 1 : 0)) C2++;
    const s = sim.scenes[I.id];
    if (s && s.casualties.some((c) => c.tHospital >= 0) && !t4) C3++;
  }
  const c5 = checkC5(events);
  let erWaits = 0;
  for (const e of events) if (e.kind === 'unit' && PHRASE.T2.test(e.text)) erWaits++;
  // 멈춘 시간 후보
  let stall: StallCand[] | null = null, forgotten: StallCand[] | null = null, unlocated: StallCand[] | null = null;
  if (P) {
    stall = []; forgotten = []; unlocated = [];
    for (const I of incs) {
      const end = `${I.closeReason || 'open'}/${I.result ? I.result.outcome : '-'}`, scen = `${I.truth.type}/${I.truth.variant}`;
      const b = P.stallBest[I.id];
      if (b && b.len > STALL_SEC) stall.push({ kind: 'STALL', seed: sim.seed, code: '#' + I.code, scen, clock: fmtClock(sim.startTod + b.start), t: Math.round(b.start), len: Math.round(b.len), active: b.active, open: b.open, last: b.last >= 0 ? events[b.last].text : '', end });
      const f = P.forgotBest[I.id] ?? 0;
      if (f >= FORGOT_SEC) forgotten.push({ kind: 'FORGOT', seed: sim.seed, code: '#' + I.code, scen, clock: '', t: -1, len: Math.round(f), active: 0, open: I.phase, last: '', end });
      const u = P.unlocBest[I.id] ?? 0;
      if (u >= FORGOT_SEC) unlocated.push({ kind: 'UNLOC', seed: sim.seed, code: '#' + I.code, scen, clock: '', t: -1, len: Math.round(u), active: 0, open: I.phase, last: '', end });
    }
  }
  return {
    seed: sim.seed, sampled: !!P, probeErrors: probe ? probe.errors : 0,
    incidents: rows, chained, maxParentDepth,
    dropped: P ? P.dropped : null, disasterSkipped: P ? P.disasterSkipped : null, disasterCleared: P ? P.disasterCleared : null,
    crossLinks: links.cross, worldLinks: links.world, spreadWorld: sp.world.distinct, spreadWorldRaw: sp.world.raw,
    aidUsed: sim.aidUsed, peakOpen, peakBusy: P ? P.peakBusy : null,
    divert: dv.rows, erWaits, erCross: P ? P.erCross : null,
    consistency: { C1, C2, C3, C4: dv.c4, C5: c5.bad, C5n: c5.n },
    stall, forgotten, unlocated,
  };
}

// ───────────────────────── 여러 교대 모으기 ─────────────────────────
export function entropy(counts: Iterable<number>): number {
  let n = 0; const arr: number[] = [];
  for (const c of counts) if (c > 0) { arr.push(c); n += c; }
  let h = 0;
  for (const c of arr) { const p = c / n; h -= p * Math.log2(p); }
  return h;
}
const r2 = (v: number): number => Math.round(v * 100) / 100;
const r3 = (v: number): number => Math.round(v * 1000) / 1000;
const avgOf = (xs: number[]): number => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export interface ScenRow { scen: string; n: number; all: number; actionH: number; orderVariety: number; outcomeH: number; storyH: number; storyDistinct: number; spreadMax: number }
export interface MetricsSummary {
  errors: number; shifts: number; incidents: number;
  chain: {
    parentDepth: Record<string, number>; maxParentDepth: number; chained: number; chainedPerShift: number; maxChainedInShift: number;
    rooted: Record<string, number>; dropped: number | null; disasterSkipped: number | null; disasterCleared: number | null;
    causesDepth: { avg: number; max: number; hist: Record<string, number> }; crossIncidentLinks: number; worldLinks: number;
  };
  systems: { avg: number; extraAvg: number; share: Record<string, number>; spread: { hist: Record<string, number>; max: number; ge3: number; rawMax: number; rawGe3: number; world: number; examples: string[] } };
  replan: { share: number; field: number; dispatch: number; route: number; byCode: Record<string, number>; cancelledPerIncident: number; fromWorld: number };
  alt: { failures: number; itemsRetry: number; retryRate: number; altRate: number; gaveUpRate: number; items: [number, number]; path: [number, number]; equip: [number, number]; water: [number, number]; methods: { groups: number; altOk: number; rate: number } | null };
  actions: { entropy: number; kinds: number; orderVariety: number; lowest: [string, number, number][]; methodEntropy: number | null };
  contention: {
    share: number; byCode: Record<string, number>; aidPerShift: number; peakOpenAvg: number; peakBusyAvg: number | null;
    divert: { n: number; hurt: number; lostSec: number; noEta: number; refillAvg: number; refillMissing: number }; erWaits: number; erCross: number | null;
  };
  stall: {
    candidates: number | null; maxSec: number | null; allow: number; forgotten: number | null; forgotAllow: number; unlocated: number | null;
    idleSecPerIncident: number | null; queueWaitSecPerIncident: number | null; repeatMax: number;
    list: StallCand[]; repeats: string[];
  };
  variety: { outcomeEntropy: number; storyEntropy: number; storyDistinct: number; flat: string[] };
  consistency: { C1: number; C2: number; C3: number; C4: number; C5: number; C5n: number };
  /** --metrics 의 시나리오별 표 (JSON 에는 넣지 않는다) */
  scenarios: ScenRow[];
}

/** 여러 교대를 모은다. null(shiftMetrics 의 예외)은 건너뛰고 오류 수에 1 */
export function summarize(list: readonly (ShiftMetrics | null)[]): MetricsSummary {
  let errors = 0;
  const shifts: ShiftMetrics[] = [];
  for (const m of list) { if (!m) { errors++; continue; } errors += m.probeErrors; shifts.push(m); }
  const all: IncRow[] = [], real: IncRow[] = [];
  for (const m of shifts) for (const r of m.incidents) { all.push(r); if (!r.benign) real.push(r); }
  const sampled = shifts.filter((m) => m.sampled);
  const shareOf = (rs: IncRow[], f: (r: IncRow) => boolean): number => (rs.length ? rs.filter(f).length / rs.length : 0);
  // 지표 1
  const parentDepth: Record<string, number> = { 0: 0, 1: 0, 2: 0, '3+': 0 };
  const rooted: Record<string, number> = {};
  const cdHist: Record<string, number> = {};
  let cdSum = 0, cdMax = 0;
  for (const r of all) {
    parentDepth[r.parentDepth >= 3 ? '3+' : String(r.parentDepth)]++;
    rooted[String(r.rooted)] = (rooted[String(r.rooted)] ?? 0) + 1;
    cdHist[String(r.causesDepth)] = (cdHist[String(r.causesDepth)] ?? 0) + 1;
    cdSum += r.causesDepth; if (r.causesDepth > cdMax) cdMax = r.causesDepth;
  }
  const sumN = (f: (m: ShiftMetrics) => number | null): number | null => { if (!sampled.length) return null; let v = 0; for (const m of sampled) v += f(m) ?? 0; return v; };
  const chain = {
    parentDepth, maxParentDepth: Math.max(0, ...shifts.map((m) => m.maxParentDepth)),
    chained: shifts.reduce((a, m) => a + m.chained, 0), chainedPerShift: r2(avgOf(shifts.map((m) => m.chained))), maxChainedInShift: Math.max(0, ...shifts.map((m) => m.chained)),
    rooted, dropped: sumN((m) => m.dropped), disasterSkipped: sumN((m) => m.disasterSkipped), disasterCleared: sumN((m) => m.disasterCleared),
    causesDepth: { avg: r2(cdSum / Math.max(1, all.length)), max: cdMax, hist: cdHist },
    crossIncidentLinks: shifts.reduce((a, m) => a + m.crossLinks, 0), worldLinks: shifts.reduce((a, m) => a + m.worldLinks, 0),
  };
  // 지표 2
  const share: Record<string, number> = {};
  for (const id of SYSTEMS) share[id] = r3(shareOf(real, (r) => r.systems.indexOf(id) >= 0));
  const spHist: Record<string, number> = {};
  for (const r of all) spHist[String(r.spread)] = (spHist[String(r.spread)] ?? 0) + 1;
  const ex = all.filter((r) => r.spreadPath).sort((a, b) => b.spread - a.spread || b.spreadRaw - a.spreadRaw);
  const systems = {
    avg: r2(avgOf(real.map((r) => r.systems.length))), extraAvg: r2(avgOf(real.map((r) => r.systems.filter((x) => !BASE.has(x)).length))), share,
    spread: {
      hist: spHist, max: Math.max(0, ...all.map((r) => r.spread)), ge3: all.filter((r) => r.spread >= 3).length,
      rawMax: Math.max(0, ...all.map((r) => r.spreadRaw)), rawGe3: all.filter((r) => r.spreadRaw >= 3).length,
      world: Math.max(0, ...shifts.map((m) => m.spreadWorld)), examples: ex.map((r) => r.spreadPath!),
    },
  };
  // 지표 3
  const byCode: Record<string, number> = {};
  for (const r of real) for (const c of r.replan.codes) byCode[c] = (byCode[c] ?? 0) + 1;
  const replan = {
    share: r3(shareOf(real, (r) => r.replan.field || r.replan.dispatch || r.replan.route)),
    field: r3(shareOf(real, (r) => r.replan.field)), dispatch: r3(shareOf(real, (r) => r.replan.dispatch)), route: r3(shareOf(real, (r) => r.replan.route)),
    byCode, cancelledPerIncident: r2(avgOf(real.map((r) => r.cancelled))), fromWorld: real.reduce((a, r) => a + r.fromWorld, 0),
  };
  // 지표 4
  let iN = 0, iR = 0, iA = 0, pN = 0, pR = 0, eN = 0, eR = 0, wN = 0, wR = 0;
  for (const r of real) { iN += r.alt.itemsN; iR += r.alt.itemsRetry; iA += r.alt.itemsAlt; pN += r.alt.pathN; pR += r.alt.pathRec; eN += r.alt.equipN; eR += r.alt.equipRec; wN += r.alt.waterN; wR += r.alt.waterRec; }
  const F = iN + pR + eN + wN, altOk = iA + pR + eR + wR;
  let mg = 0, ma = 0, anyMethods = false;
  for (const r of real) if (r.methods) { anyMethods = true; mg += r.methods.groups; ma += r.methods.altOk; }
  const alt = {
    failures: F, itemsRetry: iR, retryRate: r3(F ? iR / F : 0), altRate: r3(F ? altOk / F : 0), gaveUpRate: r3(F ? (F - iR - altOk) / F : 0),
    items: [iN, iA] as [number, number], path: [pN, pR] as [number, number], equip: [eN, eR] as [number, number], water: [wN, wR] as [number, number],
    methods: anyMethods ? { groups: mg, altOk: ma, rate: r3(mg ? ma / mg : 0) } : null,
  };
  // 시나리오별 (지표 5·8 과 표)
  const scenMap = new Map<string, IncRow[]>(), scenAll = new Map<string, IncRow[]>();
  for (const r of real) { const g = scenMap.get(r.scen); if (g) g.push(r); else scenMap.set(r.scen, [r]); }
  for (const r of all) { const g = scenAll.get(r.scen); if (g) g.push(r); else scenAll.set(r.scen, [r]); }
  const scenarios: ScenRow[] = [];
  for (const scen of Array.from(scenAll.keys()).sort()) {
    const rs = scenMap.get(scen) ?? [];
    const kinds = new Map<string, number>(), orders = new Set<string>(), k1 = new Map<string, number>(), k2 = new Map<string, number>();
    for (const r of rs) {
      for (const [k, v] of r.done) kinds.set(k, (kinds.get(k) ?? 0) + v);
      orders.add(r.order);
      k1.set(r.outcome, (k1.get(r.outcome) ?? 0) + 1); k2.set(r.story, (k2.get(r.story) ?? 0) + 1);
    }
    const n = rs.length;
    scenarios.push({
      scen, n, all: scenAll.get(scen)!.length, actionH: entropy(kinds.values()), orderVariety: n ? orders.size / n : 0,
      outcomeH: entropy(k1.values()), storyH: entropy(k2.values()), storyDistinct: n ? k2.size / n : 0,
      spreadMax: Math.max(0, ...scenAll.get(scen)!.map((r) => r.spread)),
    });
  }
  const big = scenarios.filter((s) => s.n >= MIN_SCEN_N), wsum = big.reduce((a, s) => a + s.n, 0);
  const wavg = (f: (s: ScenRow) => number): number => (wsum ? big.reduce((a, s) => a + s.n * f(s), 0) / wsum : 0);
  const allKinds = new Set<string>();
  for (const r of real) for (const [k] of r.done) allKinds.add(k);
  let methodEntropy: number | null = null;
  if (anyMethods) {
    const byWork = new Map<string, Map<string, number>>();
    for (const r of real) if (r.methods) for (const [w, m] of r.methods.ok) { let g = byWork.get(w); if (!g) { g = new Map(); byWork.set(w, g); } g.set(m, (g.get(m) ?? 0) + 1); }
    let tot = 0, acc = 0;
    for (const g of byWork.values()) { let c = 0; for (const v of g.values()) c += v; tot += c; acc += c * entropy(g.values()); }
    methodEntropy = r2(tot ? acc / tot : 0);
  }
  const actions = {
    entropy: r2(wavg((s) => s.actionH)), kinds: allKinds.size, orderVariety: r2(wavg((s) => s.orderVariety)),
    lowest: big.slice().sort((a, b) => a.actionH - b.actionH || (a.scen < b.scen ? -1 : 1)).slice(0, 3).map((s): [string, number, number] => [s.scen, r2(s.actionH), s.n]),
    methodEntropy,
  };
  const variety = {
    outcomeEntropy: r2(wavg((s) => s.outcomeH)), storyEntropy: r2(wavg((s) => s.storyH)), storyDistinct: r2(wavg((s) => s.storyDistinct)),
    flat: scenarios.filter((s) => s.n >= 10 && s.outcomeH === 0).map((s) => s.scen),
  };
  // 지표 6
  const cByCode: Record<string, number> = {};
  for (const c of CONTENTION) cByCode[c] = r3(shareOf(real, (r) => r.contention.indexOf(c) >= 0));
  const dvRows = shifts.flatMap((m) => m.divert);
  const lost = dvRows.filter((d) => d.lostSec !== null), refill = dvRows.filter((d) => d.refillSec !== null);
  const contention = {
    share: r3(shareOf(real, (r) => r.contention.length > 0)), byCode: cByCode,
    aidPerShift: r2(avgOf(shifts.map((m) => m.aidUsed))), peakOpenAvg: r2(avgOf(shifts.map((m) => m.peakOpen))),
    peakBusyAvg: sampled.length ? r3(avgOf(sampled.map((m) => m.peakBusy ?? 0))) : null,
    divert: {
      n: dvRows.length, hurt: dvRows.filter((d) => d.hurt).length, lostSec: Math.round(lost.reduce((a, d) => a + d.lostSec!, 0)),
      noEta: dvRows.filter((d) => d.eta === null).length, refillAvg: r2(avgOf(refill.map((d) => d.refillSec!))), refillMissing: dvRows.length - refill.length,
    },
    erWaits: shifts.reduce((a, m) => a + m.erWaits, 0), erCross: sumN((m) => m.erCross),
  };
  // 지표 7
  const st = sampled.flatMap((m) => m.stall ?? []), fg = sampled.flatMap((m) => m.forgotten ?? []), ul = sampled.flatMap((m) => m.unlocated ?? []);
  const realSampled = sampled.flatMap((m) => m.incidents.filter((r) => !r.benign));
  const repeats = all.filter((r) => r.repeat >= REPEAT_WARN).sort((a, b) => b.repeat - a.repeat).map((r) => `${r.seed} #${r.code} x${r.repeat} ${r.repeatText}`);
  const stall = {
    candidates: sampled.length ? st.length : null, maxSec: sampled.length ? Math.max(0, ...st.map((c) => c.len)) : null, allow: STALL_ALLOW,
    forgotten: sampled.length ? fg.length : null, forgotAllow: FORGOT_ALLOW, unlocated: sampled.length ? ul.length : null,
    idleSecPerIncident: sampled.length ? r2(avgOf(realSampled.map((r) => r.idleSec ?? 0))) : null,
    queueWaitSecPerIncident: sampled.length ? r2(avgOf(realSampled.map((r) => r.queueSec ?? 0))) : null,
    repeatMax: Math.max(0, ...all.map((r) => r.repeat)),
    list: [...st, ...fg, ...ul], repeats,
  };
  const consistency = { C1: 0, C2: 0, C3: 0, C4: 0, C5: 0, C5n: 0 };
  for (const m of shifts) { consistency.C1 += m.consistency.C1; consistency.C2 += m.consistency.C2; consistency.C3 += m.consistency.C3; consistency.C4 += m.consistency.C4; consistency.C5 += m.consistency.C5; consistency.C5n += m.consistency.C5n; }
  return { errors, shifts: shifts.length, incidents: all.length, chain, systems, replan, alt, actions, contention, stall, variety, consistency, scenarios };
}

/** --json 의 metrics: 시나리오 표는 빼고, 목록은 20개에서 자른다 */
export function metricsJson(m: MetricsSummary): Record<string, unknown> {
  const { scenarios: _s, shifts: _n, incidents: _i, ...rest } = m;
  return {
    ...rest,
    systems: { ...m.systems, spread: { ...m.systems.spread, examples: m.systems.spread.examples.slice(0, LIST_CAP) } },
    stall: { ...m.stall, list: m.stall.list.slice(0, LIST_CAP), repeats: m.stall.repeats.slice(0, LIST_CAP) },
  };
}

// ───────────────────────── 출력 ─────────────────────────
const pc = (v: number): string => `${Math.round(v * 100)}%`;
const na = (v: number | null, f: (x: number) => string = String): string => (v === null ? 'n/a' : f(v));
export function stallLine(c: StallCand): string {
  if (c.kind === 'STALL') return `  STALL ${c.seed} ${c.code} ${c.scen} ${c.clock} (t=${c.t}s) ${c.len}s — active ${c.active}, open work ${c.open}, last "${c.last}" → ${c.end}`;
  return `  ${c.kind} ${c.seed} ${c.code} ${c.scen} ${c.len}s (phase ${c.open}) → ${c.end}`;
}
/** 글자 출력 줄: 접두어 아홉 개(chain:·systems:·replan:·alt:·actions:·contention:·stall:·variety:·consistency:)와 후보 줄 */
export function formatLines(m: MetricsSummary, verbose: boolean): string[] {
  const out: string[] = [];
  const c = m.chain, pdh = c.parentDepth;
  const rootedN = Object.entries(c.rooted).reduce((a, [k, v]) => a + (Number(k) >= 1 ? v : 0), 0);
  const rootedMax = Math.max(0, ...Object.keys(c.rooted).map(Number));
  out.push(`chain: parent depth 0:${pdh['0']} 1:${pdh['1']} 2:${pdh['2']} 3+:${pdh['3+']} (max ${c.maxParentDepth}, chained ${c.chainedPerShift.toFixed(2)}/shift, max/shift ${c.maxChainedInShift}, dropped ${na(c.dropped)}, disaster skipped ${na(c.disasterSkipped)} cleared ${na(c.disasterCleared)}) · rooted 1+:${rootedN} (max ${rootedMax}) · causes depth avg ${c.causesDepth.avg} max ${c.causesDepth.max} · cross-incident links ${c.crossIncidentLinks} · world links ${c.worldLinks}`);
  const sy = m.systems;
  const order = SYSTEMS.filter((x) => !BASE.has(x)).slice().sort((a, b) => (sy.share[b] ?? 0) - (sy.share[a] ?? 0) || SYSTEMS.indexOf(a) - SYSTEMS.indexOf(b));
  const hist = Object.keys(sy.spread.hist).map(Number).sort((a, b) => a - b).map((k) => `${k}:${sy.spread.hist[String(k)]}`).join(' ');
  out.push(`systems: avg ${sy.avg} (extra ${sy.extraAvg}) · ${order.map((x) => `${x} ${pc(sy.share[x] ?? 0)}`).join(' ')} · spread ${hist || '-'} (≥3: ${sy.spread.ge3}, max ${sy.spread.max}, raw max ${sy.spread.rawMax}, world ${sy.spread.world})`);
  const rp = m.replan;
  const codes = Object.entries(rp.byCode).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1)).map(([k, v]) => `${k} ${v}`).join(' ');
  out.push(`replan: ${pc(rp.share)} (field ${pc(rp.field)}, dispatch ${pc(rp.dispatch)}, route ${pc(rp.route)}) · from world ${rp.fromWorld} · cancelled ${rp.cancelledPerIncident}/incident · ${codes || '-'}`);
  const al = m.alt;
  out.push(`alt: failures ${al.failures} → retry ${pc(al.retryRate)} · alt ${pc(al.altRate)} · gave up ${pc(al.gaveUpRate)} (items ${al.items[0]}: retry ${al.itemsRetry} alt ${al.items[1]} · path ${al.path[1]}/${al.path[0]} · equip ${al.equip[1]}/${al.equip[0]} · water ${al.water[1]}/${al.water[0]})${al.methods ? ` · methods ${al.methods.altOk}/${al.methods.groups}` : ''}`);
  const ac = m.actions;
  out.push(`actions: entropy ${ac.entropy} bits · kinds ${ac.kinds} · order variety ${ac.orderVariety} · lowest ${ac.lowest.map(([s, h, n]) => `${s} ${h} (n ${n})`).join(', ') || '-'}${ac.methodEntropy !== null ? ` · method entropy ${ac.methodEntropy}` : ''}`);
  const ct = m.contention;
  out.push(`contention: ${pc(ct.share)} of incidents (${CONTENTION.map((k) => `${k} ${pc(ct.byCode[k] ?? 0)}`).join(' ')}) · aid ${ct.aidPerShift}/shift · peak open ${ct.peakOpenAvg} · peak busy ${na(ct.peakBusyAvg, pc)} · diverted ${ct.divert.n} (hurt ${ct.divert.hurt}, lost ${ct.divert.lostSec}s, no eta ${ct.divert.noEta}, refill ${ct.divert.refillAvg}s, missing ${ct.divert.refillMissing}) · ER waits ${ct.erWaits} (cross ${na(ct.erCross)})`);
  const s = m.stall;
  out.push(`stall: candidates ${na(s.candidates)} (max ${na(s.maxSec)}s, allow ${s.allow}) · forgotten ${na(s.forgotten)} (allow ${s.forgotAllow}) · unlocated ${na(s.unlocated)} · idle ${na(s.idleSecPerIncident)}s/incident · queue wait ${na(s.queueWaitSecPerIncident)}s/incident · repeat max ${s.repeatMax}`);
  const v = m.variety;
  out.push(`variety: outcome ${v.outcomeEntropy} bits · story ${v.storyEntropy} bits · distinct ${v.storyDistinct}/incident · flat ${v.flat.length ? v.flat.join(',') : 'none'}`);
  const k = m.consistency;
  out.push(`consistency: C1 ${k.C1} · C2 ${k.C2} · C3 ${k.C3} · C4 ${k.C4} · C5 ${k.C5}/${k.C5n} (보고만) · metric errors ${m.errors}`);
  // 후보 줄: STALL·FORGOT 은 언제나 모두, REPEAT·SPREAD 는 기본 3개, UNLOC 은 --metrics 에서만
  for (const x of s.list) if (x.kind !== 'UNLOC') out.push(stallLine(x));
  if (verbose) for (const x of s.list) if (x.kind === 'UNLOC') out.push(stallLine(x));
  for (const r of verbose ? s.repeats : s.repeats.slice(0, 3)) out.push(`  REPEAT ${r}`);
  for (const e of verbose ? sy.spread.examples : sy.spread.examples.slice(0, 3)) out.push(`  SPREAD ${e}`);
  if (verbose) {
    out.push('  scenarios (n · actions H · order variety · outcome H · story H · distinct · spread max):');
    for (const r of m.scenarios) out.push(`    ${r.scen.padEnd(22)} ${String(r.n).padStart(4)}${r.all !== r.n ? `(+${r.all - r.n})` : ''} · ${r.actionH.toFixed(2)} · ${r.orderVariety.toFixed(2)} · ${r.outcomeH.toFixed(2)} · ${r.storyH.toFixed(2)} · ${r.storyDistinct.toFixed(2)} · ${r.spreadMax}${r.n < MIN_SCEN_N ? ' *' : ''}`);
  }
  return out;
}

/** 관문 실패 문구 (빈 배열이면 통과). baseline = 보통 기본 조건 (§2.14) */
export function checkMetrics(m: MetricsSummary, opts: { baseline: boolean }): string[] {
  const f: string[] = [];
  if (m.errors > 0) f.push(`지표 계산 오류 ${m.errors}건`);
  if (m.chain.maxParentDepth > CHAIN_DEPTH_GATE) f.push(`연쇄 깊이 ${m.chain.maxParentDepth} > ${CHAIN_DEPTH_GATE}`);
  if (m.chain.maxChainedInShift > CHAINED_SHIFT_GATE) f.push(`한 교대의 연쇄 사건 ${m.chain.maxChainedInShift}건 > ${CHAINED_SHIFT_GATE}`);
  for (const k of ['C1', 'C2', 'C3', 'C4'] as const) if (m.consistency[k] > 0) f.push(`기록·상태 불일치 ${k} ${m.consistency[k]}건`);
  if (opts.baseline) {
    const st = m.stall;
    const first = (kind: string): string => st.list.filter((c) => c.kind === kind).slice(0, 3).map((c) => `${c.seed} ${c.code}`).join(', ');
    if (st.candidates !== null && st.candidates > STALL_ALLOW) f.push(`교착 후보 ${st.candidates}건 > 허용 ${STALL_ALLOW} (${first('STALL')})`);
    if (st.forgotten !== null && st.forgotten > FORGOT_ALLOW) f.push(`잊힌 사건 ${st.forgotten}건 > 허용 ${FORGOT_ALLOW} (${first('FORGOT')})`);
  }
  return f;
}

// ───────────────────────── --log --metrics: 사슬을 읽는 도구 ─────────────────────────
/** 사건마다 가장 긴 원인 사슬과 확산 길을 기록 문구와 함께 */
export function chainReport(sim: Sim): string[] {
  const events = sim.events, out: string[] = [];
  const sys = events.map(sysOf), L = causeDepths(events);
  const sp = spreadByIncident(events, sys, sim.incidents.length);
  const line = (id: number): string => { const e = events[id]; return `      ${fmtClock(sim.startTod + e.t)} ${evLabel(sim, e, sys[id], false)} ${e.truth ? '(진실) ' : ''}${e.role}/${e.actor}: ${e.text}`; };
  for (const I of sim.incidents) {
    let top = -1;
    for (const e of events) if (e.incidentId === I.id && (top < 0 || L[e.id] > L[top])) top = e.id;
    out.push(`[#${I.code}] ${I.truth.type}/${I.truth.variant} — 원인 사슬 ${top >= 0 ? L[top] : 0}단계, 확산 ${sp.inc[I.id].distinct} (raw ${sp.inc[I.id].raw})`);
    if (top >= 0) {
      const path = [top];
      let x = top;
      while (events[x].causes.length) { let b = -1; for (const c of events[x].causes) if (b < 0 || L[c] > L[b]) b = c; if (b < 0) break; path.push(b); x = b; }
      out.push('    원인 사슬:');
      for (const id of path.reverse()) out.push(line(id));
    }
    const b = sp.inc[I.id];
    if (b.distinct > 0) { out.push('    확산 길:'); for (const id of spreadPath(events, sys, sp.graph, b.start)) out.push(line(id)); }
  }
  return out;
}

