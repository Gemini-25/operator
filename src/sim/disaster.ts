// 재난 — 교대 전체에 걸쳐 도시의 상태를 바꾸고, 지금 있는 사건들을 한꺼번에 여러 곳에 일으킨다.
// 사건 하나하나는 평소와 같은 규칙으로 처리된다(관제·지휘·대원의 코드는 재난을 따로 알지 못한다).
// 설계: docs/specs/N6-disaster.md
//
// 재현성: 재난의 모든 난수는 sim.rng.fork('disaster') 에서 나온다. 사건은 createIncident(sim, { ..., rng }) 로 일으킨다.
// 재난이 없는 교대(sim.disaster === null)에서는 이 파일의 어떤 코드도 상태를 바꾸지 않는다.
//
// 단계: calm →(tWarn) warning →(tImpact) impact →(tEnd) aftermath →(tEnd + 120) over.
// 재난은 "세계"다. 도로를 막고(closeEdge), 사건을 일으키고(spawn), 현장을 흔든다(여진). 관제와 현장의 AI 는 그 결과만 본다.

import { coastY, distSeg, edgeName, mountainAt, nodeName, riverDist } from './city';
import { INCIDENT_PLACES } from './cityPlan';
import { DISASTER_KINDS, DISASTER_NAME } from './difficulty';
import type { DisasterKind } from './difficulty';
import type { Sim } from './engine';
import { emit } from './events';
import { createIncident } from './incidents';
import type { SpawnOpts } from './incidents';
import type { Rng } from './rng';
import { scenarioOf } from './scenarios';
import { reallyLinked } from './traffic';
import type { Incident, IncidentType, Place, PlaceKind, RoadEdge, RoadNode } from './types';
import { clamp, fmtClock, josa } from './util';

export type DisasterPhase = 'calm' | 'warning' | 'impact' | 'aftermath' | 'over';
/** 재난이 일으키는 일의 종류 (어디에, 어떤 사건으로 일으킬지는 resolve 가 정한다) */
type What = 'tree' | 'crash' | 'sign' | 'roof' | 'surge' | 'landslide' | 'riverRescue' | 'floodCar' | 'gasLeak'
  | 'collapse' | 'gasblast' | 'fire' | 'elevator' | 'after' | 'wild' | 'houseFire' | 'evac' | 'coast' | 'coastCrash';
export interface DisasterState {
  kind: DisasterKind; name: string;
  phase: DisasterPhase;
  tWarn: number; tImpact: number; tEnd: number;      // 특보 · 충격 시작 · 충격 끝 (sim.t). 예고가 없는 재난은 tWarn === tImpact
  intensity: number;             // 지금의 세기 0..1 (그림과 규칙이 함께 본다)
  rng: Rng;
  spawned: number[];             // 재난이 일으킨 사건 id
  closedEdges: number[];         // 재난이 통제한 도로 구간 (끝나면 풀어야 한다)
  nextAt: number;                // 다음 일(사건·통제)을 일으킬 시각
  // 종류별 자료 (쓰는 재난만 채운다)
  front?: { x: number; y: number; r: number; dx: number; dy: number };      // 산불의 불머리 (dx, dy = 번지는 방향)
  level?: number;                // 홍수의 수위 0..1
  dark?: boolean;                // 정전
  speedMul?: number;             // 긴급 차량 주행 속도에 곱하는 값 (비바람·침수). city.weatherSpeedFactor 가 읽는다
  scar?: number[][];             // 산불이 지나간 자리 [x, y, r] (그림용)
  log: { t: number; text: string }[];      // 보고서용: 실제로 일어난 일
  // ── 공통 ──
  closedTotal: number;           // 지금까지 통제한 구간 수 (보고서)
  queue: { at: number; what: What }[];      // 때가 되면 일으킬 사건. 자리가 없으면(동시 진행 상한) 다음 차례로 미룬다
  timed: { edge: number; until: number }[];      // 정해진 시각에 다시 여는 통제 (지진·해일)
  done: Record<string, number>;  // 한 번만 일어나는 일이 일어난 시각 (산사태, 지하 가스 누출, 정전, 여진 …)
  // ── 홍수 ──
  thr?: number[];                // 구간마다 잠기는 수위 (강에서 먼 구간은 1 을 넘는다 = 잠기지 않는다)
  slowed?: number[];             // 물이 차올라 느려진 구간
  // ── 지진 ──
  epi?: { x: number; y: number };      // 진앙
  shakes?: number[];             // 흔들린 시각 (본진, 여진) — 그림용
  // ── 산불 ──
  from?: { x: number; y: number; name: string };      // 불이 난 산
  to?: { x: number; y: number; name: string };        // 불이 향하는 동네
  speed?: number; run?: number; span?: number;        // 번지는 속도(초당), 지금까지 번진 거리, 동네까지의 거리
  stopped?: string;              // 멈춘 까닭 ('reached' 동네에 닿음 · 'contained' 주불 진화 · 'calm' 바람이 잦아듦)
  // ── 해일 ──
  hit?: number[];                // 물이 덮친 대피 현장 (사건 id). rules/disaster.ts 가 채운다
  swept?: number;                // 물에 휩쓸린 사람 수
}

/** 재난 하나가 일으키는 사건 수의 상한 */
const CAP: Record<DisasterKind, number> = { typhoon: 16, flood: 12, quake: 16, wildfire: 8, tsunami: 9 };
/** 충격이 끝난 뒤 여파가 이어지는 시간(초). 이 뒤에 남은 통제를 모두 푼다 */
export const AFTERMATH = 120;
/** 교대가 끝나기 이만큼 전부터는 새 사건을 일으키지 않는다 (일어난 사건은 끝까지 가야 한다) */
const LAST_SPAWN = 90;

/** 교대가 시작될 때 한 번. 재난이 없으면 null. */
export function initDisaster(sim: Sim): DisasterState | null {
  const choice = sim.difficulty.disaster ?? 'none';
  if (choice === 'none') return null;
  const rng = sim.rng.fork('disaster');
  let kind: DisasterKind;
  if (choice === 'random') { if (!rng.chance(sim.tune.disasterProb)) return null; kind = rng.pick(DISASTER_KINDS); }
  else kind = choice;
  return plan(sim, kind, rng);
}

/** 재난의 일정을 짠다. 교대 길이 L 에 맞춰 특보·충격·끝의 시각을 정하고, 종류별 자료를 준비한다. */
function plan(sim: Sim, kind: DisasterKind, rng: Rng): DisasterState {
  const L = sim.shiftLen;
  const d: DisasterState = {
    kind, name: DISASTER_NAME[kind], phase: 'calm', tWarn: 0, tImpact: 0, tEnd: 0, intensity: 0, rng,
    spawned: [], closedEdges: [], nextAt: Infinity, log: [], closedTotal: 0, queue: [], timed: [], done: {},
  };
  if (kind === 'typhoon') { d.tWarn = L * rng.range(0.1, 0.18); d.tImpact = d.tWarn + rng.range(90, 120); d.tEnd = d.tImpact + 420; }
  else if (kind === 'flood') {
    d.tWarn = L * rng.range(0.12, 0.2); d.tImpact = d.tWarn + 60; d.tEnd = d.tImpact + FLOOD_RISE + FLOOD_HOLD + FLOOD_FALL;
    d.level = 0; d.slowed = [];
    // 구간마다 잠기는 수위 = (강에서 가장 가까운 점까지의 거리) ÷ 80. 다리는 수위 0.9 에서 잠긴다
    const c = sim.city;
    d.thr = c.edges.map((e) => {
      if (e.bridge) return 0.9;
      const A = c.nodes[e.a], B = c.nodes[e.b];
      let m = Infinity;
      for (let q = 0; q <= 8; q++) m = Math.min(m, riverDist(A.x + ((B.x - A.x) * q) / 8, A.y + ((B.y - A.y) * q) / 8));
      return Math.max(0.25, m / 80);
    });
  } else if (kind === 'quake') { d.tWarn = d.tImpact = L * rng.range(0.2, 0.5); d.tEnd = d.tImpact + 420; d.shakes = []; }
  else if (kind === 'wildfire') {
    d.tWarn = d.tImpact = L * rng.range(0.1, 0.2); d.tEnd = d.tImpact + 640;
    // 산 하나의 중턱에서 시작해 가장 가까운 동네(외곽이 아닌 교차로) 쪽으로 번진다
    const c = sim.city, ms = c.mountains ?? [];
    const townOf = (q: { x: number; y: number }): { n: RoadNode; d: number } => {
      let n: RoadNode = c.nodes[0], best = Infinity;
      for (const v of c.nodes) { if (v.district === 'outskirts') continue; const dd = Math.hypot(v.x - q.x, v.y - q.y); if (dd < best) { best = dd; n = v; } }
      return { n, d: best };
    };
    // 동네에서 먼 산일수록 잘 뽑힌다 (불이 오래 번져야 막아 낼 틈이 있다)
    const m = ms.length ? rng.weighted(ms, ms.map((q) => townOf(q).d ** 2)) : { name: '야산', x: c.w * 0.2, y: c.h * 0.2, rx: 200, ry: 150 };
    const town = townOf(m), tn = town.n, bd = town.d;
    const dx = (tn.x - m.x) / (bd || 1), dy = (tn.y - m.y) / (bd || 1);
    const foot = Math.min(bd * 0.3, 0.3 * Math.sqrt(1 / ((dx / m.rx) ** 2 + (dy / m.ry) ** 2)));      // 산 가운데에서 조금 내려온 중턱에서 난다
    d.from = { x: m.x, y: m.y, name: m.name };
    // 동네 이름: 그 교차로에서 가장 가까운(반지름에 견주어) 동
    let dong = nodeName(c, tn.id), dd = Infinity;
    for (const q of c.districts) { const v = Math.hypot(q.x + q.w / 2 - tn.x, q.y + q.h / 2 - tn.y) / Math.max(1, q.w / 2); if (v < dd) { dd = v; dong = q.name; } }
    d.to = { x: tn.x, y: tn.y, name: dong };
    d.front = { x: m.x + dx * foot, y: m.y + dy * foot, r: 60, dx, dy };
    d.speed = rng.range(1.1, 1.5); d.run = 0; d.span = Math.max(60, bd - foot);
    d.scar = [[d.front.x, d.front.y, 60]];
  } else { d.tWarn = L * rng.range(0.15, 0.4); d.tImpact = d.tWarn + 150; d.tEnd = d.tImpact + 90; d.hit = []; d.swept = 0; }
  return d;
}

// ───────────────────────── 공통 뼈대 ─────────────────────────

const has = (t: IncidentType, v: string): boolean => !!scenarioOf(t, v);

/** 재난안전본부·기상청의 알림. 보고서에 남길 일이면 d.log 에도 적는다 */
function tell(sim: Sim, d: DisasterState, text: string, actor = '재난안전본부', log = true): void {
  emit(sim, { role: 'SYSTEM', actor, kind: 'hazard', imp: 3, text });
  if (log) d.log.push({ t: sim.t, text });
}

function openCount(sim: Sim): number { let n = 0; for (const I of sim.incidents) if (I.phase !== 'closed') n++; return n; }
/** 지금 사건을 더 일으켜도 되는가: 교대 끝이 아니고, 재난의 상한과 동시 진행 상한 안이다 */
function canSpawn(sim: Sim, d: DisasterState): boolean {
  return sim.t < sim.shiftLen - LAST_SPAWN && d.spawned.length < CAP[d.kind] && openCount(sim) < sim.tune.maxConcurrent + 4;
}
/** 사건을 일으킨다. 상한에 걸리면 그 차례를 건너뛴다(null). */
function spawn(sim: Sim, d: DisasterState, opts: SpawnOpts): Incident | null {
  if (!canSpawn(sim, d)) return null;
  const I = createIncident(sim, { ...opts, tag: 'disaster:' + d.kind, rng: d.rng });
  d.spawned.push(I.id);
  return I;
}
/** 종류를 정해 일으킨다: 자리(건물·교차로)를 고르고 spawn 한다. 마땅한 자리가 없어도 건너뛴다 */
function raise(sim: Sim, d: DisasterState, what: What): Incident | null {
  if (!canSpawn(sim, d)) return null;
  const opts = resolve(sim, d, what);
  return opts ? spawn(sim, d, opts) : null;
}

/**
 * 이 구간을 막아도 양 끝이 다른 길로 이어지는가. 진행 중인 사건이 곧 막을 구간도 막힌 것으로 본다.
 * 재난은 세계이므로 **실제 상태**로 본다: 아직 아무도 모르는 낙하물이 놓인 길(경로 계산은 지나갈 수 있다고 본다)은 돌아갈 길이 아니다.
 * dry = 다리를 건너지 않고도 이어져야 한다 (강가의 길을 닫을 때: 다리 하나에만 매달린 교차로를 만들지 않는다)
 */
function detour(sim: Sim, e: RoadEdge, dry = false): boolean {
  const c = sim.city, held: RoadEdge[] = [];
  for (const I of sim.incidents) { if (I.phase === 'closed' || I.blockedEdge < 0 || I.blockedEdge === e.id) continue; const b = c.edges[I.blockedEdge]; if (!b.closed) { b.closed = true; held.push(b); } }
  if (dry) for (const b of c.edges) if (b.bridge && !b.closed && b.id !== e.id) { b.closed = true; held.push(b); }
  const ok = reallyLinked(sim, e.a, e.b, e.id);
  for (const b of held) b.closed = false;
  return ok;
}
/** 구간을 통제한다. 우회로가 있을 때만(강 서쪽이 고립되거나 막다른 길이 끊기지 않게) */
function closeEdge(sim: Sim, d: DisasterState, e: RoadEdge, why: string, dry = false): boolean {
  if (e.closed || !detour(sim, e, dry)) return false;
  e.closed = true; e.closedReason = 'disaster';
  d.closedEdges.push(e.id); d.closedTotal++;
  emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', imp: 1, text: `${edgeName(sim.city, e)} 통제 — ${why}.` });
  return true;
}
/** 재난이 통제한 구간을 연다 (사건이나 공사가 통제한 구간은 건드리지 않는다). pred 를 주면 그 구간만 */
function reopenEdges(sim: Sim, d: DisasterState, pred?: (e: RoadEdge) => boolean): void {
  for (let k = d.closedEdges.length - 1; k >= 0; k--) {
    const e = sim.city.edges[d.closedEdges[k]];
    if (pred && !pred(e)) continue;
    d.closedEdges.splice(k, 1);
    if (e.closedReason !== 'disaster') continue;
    e.closed = false; e.closedReason = null;
    emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', imp: 0, text: `${edgeName(sim.city, e)} 통제 해제.` });
  }
}

/** 정전: 신호등이 꺼져 모든 구간이 밀린다. 교통 모델이 bump 를 더해 혼잡을 정한다(cong 을 직접 고치지 않는다) */
const DARK_BUMP = 0.4;
function lightsOut(sim: Sim, d: DisasterState): void {
  d.dark = true; d.done.dark = sim.t;
  for (const e of sim.city.edges) e.bump = (e.bump ?? 0) + DARK_BUMP;
  tell(sim, d, '강풍에 송전선이 끊겨 도시 곳곳이 정전됐습니다. 신호등이 꺼져 도로가 밀립니다.');
}
function lightsOn(sim: Sim, d: DisasterState, quiet = false): void {
  if (!d.dark) return;
  d.dark = false;
  for (const e of sim.city.edges) { const v = (e.bump ?? 0) - DARK_BUMP; e.bump = v < 1e-9 ? 0 : v; }
  if (!quiet) tell(sim, d, '전력이 복구됐습니다. 신호등이 다시 켜집니다.', '재난안전본부', false);
}

/** 매 틱, 사건 생성(tickIncidents)보다 먼저. */
export function tickDisaster(sim: Sim): void {
  const d = sim.disaster;
  if (!d || d.phase === 'over') return;
  // 교대가 끝났다: 새 일은 일으키지 않고, 남은 통제와 혼잡을 모두 푼다
  if (sim.t >= sim.shiftLen) { if (d.phase !== 'calm') finish(sim, d, true); return; }
  if (d.phase === 'calm') {
    if (sim.t < d.tWarn) return;
    if (d.tWarn < d.tImpact) { d.phase = 'warning'; onWarn(sim, d); }
  }
  if ((d.phase === 'calm' || d.phase === 'warning') && sim.t >= d.tImpact) { d.phase = 'impact'; onImpact(sim, d); }
  if (d.phase === 'impact') {
    if (d.kind === 'typhoon') tickTyphoon(sim, d);
    else if (d.kind === 'flood') tickFlood(sim, d);
    else if (d.kind === 'quake') tickQuake(sim, d);
    else if (d.kind === 'wildfire') tickWildfire(sim, d);
    if (sim.t >= d.tEnd) { d.phase = 'aftermath'; onEnd(sim, d); }
  }
  if (d.kind === 'flood' && (d.phase === 'impact' || d.phase === 'aftermath')) floodRoads(sim, d);
  if (d.kind === 'wildfire' && (d.phase === 'impact' || d.phase === 'aftermath')) fireRoads(sim, d);
  if (d.dark && sim.t >= d.done.dark + 120) lightsOn(sim, d);
  // 정해진 시각에 여는 통제
  for (let k = d.timed.length - 1; k >= 0; k--) if (sim.t >= d.timed[k].until) { const id = d.timed[k].edge; d.timed.splice(k, 1); reopenEdges(sim, d, (e) => e.id === id); }
  // 때가 된 사건 (한 틱에 하나). 자리가 없으면 4초 뒤에 다시 본다
  if (d.queue.length && sim.t >= d.queue[0].at) {
    if (sim.t >= sim.shiftLen - LAST_SPAWN || d.spawned.length >= CAP[d.kind]) d.queue.length = 0;
    else if (!canSpawn(sim, d)) d.queue[0].at = sim.t + 4;
    else { const q = d.queue.shift()!; raise(sim, d, q.what); }
  }
  if (d.phase === 'aftermath' && sim.t >= d.tEnd + AFTERMATH) { finish(sim, d, false); return; }
  d.intensity = intensityOf(sim, d);
}

/** 지금의 세기 0..1 */
function intensityOf(sim: Sim, d: DisasterState): number {
  const t = sim.t;
  const fade = d.phase === 'aftermath' ? clamp(1 - (t - d.tEnd) / AFTERMATH, 0, 1) : 1;
  if (d.kind === 'flood') return clamp(d.level ?? 0, 0, 1);
  if (d.phase === 'warning') return 0.15 + 0.25 * clamp((t - d.tWarn) / Math.max(1, d.tImpact - d.tWarn), 0, 1);
  if (d.kind === 'typhoon') return d.phase === 'impact' ? 0.4 + 0.6 * Math.sin(Math.PI * clamp((t - d.tImpact) / (d.tEnd - d.tImpact), 0, 1)) : 0.4 * fade;
  if (d.kind === 'quake') { const last = d.shakes && d.shakes.length ? d.shakes[d.shakes.length - 1] : d.tImpact; return (0.2 + 0.8 * Math.exp(-(t - last) / 12)) * fade; }
  if (d.kind === 'wildfire') return (0.4 + 0.6 * clamp(((d.front?.r ?? 60) - 60) / 120, 0, 1)) * fade;
  return d.phase === 'impact' ? 1 : 0.5 * fade;
}

function onWarn(sim: Sim, d: DisasterState): void {
  const eta = fmtEta(d.tImpact - sim.t);
  if (d.kind === 'typhoon') { d.speedMul = 0.92; tell(sim, d, `태풍 특보 발령. 약 ${eta} 뒤 강한 비바람이 도시에 닿습니다. 긴급 차량의 주행이 느려집니다.`, '기상청'); }
  else if (d.kind === 'flood') tell(sim, d, `홍수 경보 발령. ${sim.city.river.name}의 수위가 빠르게 오르고 있습니다. 약 ${eta} 뒤부터 강가의 도로가 잠기기 시작합니다.`, '기상청');
  else if (d.kind === 'tsunami') {
    tell(sim, d, `해일 경보 발령. 약 ${eta} 뒤 해안에 닿습니다. 바닷가에 남은 사람들을 뭍으로 옮겨야 합니다.`, '기상청');
    const n = has('water', 'evac') ? d.rng.int(2, 3) : 0;
    for (let k = 0; k < n; k++) d.queue.push({ at: sim.t + 1 + k * 3, what: 'evac' });
  }
}

function onImpact(sim: Sim, d: DisasterState): void {
  const c = sim.city, rng = d.rng;
  if (d.kind === 'typhoon') {
    d.speedMul = 0.85; d.nextAt = sim.t + rng.range(5, 10);
    tell(sim, d, '태풍이 도시를 지나고 있습니다. 쓰러진 나무와 침수 신고가 잇따를 것으로 보입니다.', '기상청');
  } else if (d.kind === 'flood') {
    d.nextAt = sim.t + rng.range(20, 30);
    tell(sim, d, `${josa(c.river.name, '이/가')} 넘치기 시작했습니다. 강에서 가까운 도로부터 차례로 잠깁니다.`);
  } else if (d.kind === 'quake') {
    const urban = c.nodes.filter((n) => n.district !== 'outskirts');
    const en = rng.pick(urban.length ? urban : c.nodes);
    d.epi = { x: en.x + rng.range(-60, 60), y: en.y + rng.range(-60, 60) };
    d.shakes = [sim.t];
    sim.tune.aidUnits += 3;      // 인근 도시가 지원을 더 보낸다 (aidUsed 를 음수로 두면 지원 부대의 이름표 번호가 어긋난다)
    tell(sim, d, `지진 발생! 진앙은 ${nodeName(c, en.id)} 부근. 도시 전역이 크게 흔들렸고, 여러 곳에서 한꺼번에 피해 신고가 들어옵니다. 인근 도시에 지원을 더 요청했습니다.`, '기상청');
    // 25초에 걸쳐 쏟아진다
    const items: What[] = [];
    const nCol = rng.int(3, 4);
    for (let k = 0; k < nCol; k++) items.push('collapse');
    items.push(has('collapse', 'gasblast') ? 'gasblast' : 'collapse', 'fire', 'fire', 'gasLeak', 'gasLeak', 'elevator', 'elevator', 'elevator', 'crash', 'crash');
    rng.shuffle(items);
    items.forEach((what, k) => d.queue.push({ at: sim.t + 1 + (k * 24) / items.length, what }));
    // 갈라진 도로 3~5구간 (다리 제외, 200~400초)
    const nCut = rng.int(3, 5);
    const prox = (e: RoadEdge): number => { const A = c.nodes[e.a], B = c.nodes[e.b]; return Math.exp(-Math.hypot((A.x + B.x) / 2 - d.epi!.x, (A.y + B.y) / 2 - d.epi!.y) / 600); };
    for (let k = 0, tries = 0; k < nCut && tries < 24; tries++) {
      const cands = c.edges.filter((e) => !e.closed && !e.bridge && e.cls !== 'highway');
      if (!cands.length) break;
      const e = rng.weighted(cands, cands.map(prox));
      if (closeEdge(sim, d, e, '지진으로 도로가 갈라졌습니다')) { d.timed.push({ edge: e.id, until: sim.t + rng.range(200, 400) }); k++; }
    }
    d.done.aftershockAt = sim.t + rng.range(120, 200);
  } else if (d.kind === 'wildfire') {
    d.nextAt = sim.t + 2;
    tell(sim, d, `${d.from!.name}에서 산불 발생. 바람을 타고 ${d.to!.name} 쪽으로 번지고 있습니다.`);
  } else {
    tell(sim, d, '해일이 해안을 덮쳤습니다. 바닷가의 도로를 통제합니다.');
    const n = rng.int(3, 4);
    let at = sim.t + 4;
    for (let k = 0; k < n; k++) { d.queue.push({ at, what: 'coast' }); at += rng.range(5, 9); if (k === 0) d.queue.push({ at: at - 2, what: 'coastCrash' }); }
    // 해안 구간 (양 끝 교차로가 모두 바닷가) 200초 통제
    for (const e of c.edges) {
      const A = c.nodes[e.a], B = c.nodes[e.b];
      if (coastY(A.x) - A.y < 200 && coastY(B.x) - B.y < 200 && closeEdge(sim, d, e, '해일이 도로를 덮쳤습니다')) d.timed.push({ edge: e.id, until: sim.t + 200 });
    }
  }
}

function onEnd(sim: Sim, d: DisasterState): void {
  if (d.kind === 'typhoon') { d.speedMul = 0.93; tell(sim, d, '태풍이 도시를 벗어났습니다. 비바람이 잦아듭니다.', '기상청', false); }
  else if (d.kind === 'flood') tell(sim, d, `${sim.city.river.name}의 수위가 내려가고 있습니다. 잠겼던 도로가 차례로 열립니다.`, '재난안전본부', false);
  else if (d.kind === 'quake') tell(sim, d, '지진 피해 신고가 잦아들었습니다. 갈라진 도로의 복구가 끝나 갑니다.', '재난안전본부', false);
  else if (d.kind === 'wildfire') { if (!d.stopped) { d.stopped = 'calm'; tell(sim, d, '바람이 잦아들어 산불이 더 번지지 않습니다.'); } }
  else tell(sim, d, '바닷물이 빠지고 있습니다.', '기상청', false);
}

/** 재난을 끝낸다: 남은 통제·혼잡·감속을 모두 되돌린다. cut = 교대가 먼저 끝났다 */
function finish(sim: Sim, d: DisasterState, cut: boolean): void {
  d.timed.length = 0; d.queue.length = 0;
  const stillCut = d.closedEdges.length > 0;
  reopenEdges(sim, d);
  lightsOn(sim, d, true);
  if (d.slowed) { for (const id of d.slowed) { const e = sim.city.edges[id]; e.slow = Math.max(0, e.slow - FLOOD_SLOW); } d.slowed = []; }
  if (d.level !== undefined) d.level = 0;
  d.speedMul = undefined;
  d.phase = 'over'; d.intensity = 0;
  if (!cut) emit(sim, { role: 'SYSTEM', actor: '재난안전본부', kind: 'hazard', imp: 2, text: `${d.name} 대응 단계를 마칩니다.${stillCut ? ' 통제했던 도로를 모두 엽니다.' : ''}` });
}

const fmtEta = (sec: number): string => { const s = Math.max(0, Math.round(sec)); return s >= 60 ? `${Math.floor(s / 60)}분${s % 60 ? ` ${s % 60}초` : ''}` : `${s}초`; };

// ───────────────────────── 자리 고르기 ─────────────────────────

type W = Partial<Record<PlaceKind, number>>;
interface Geo { river: Float32Array; coast: Float32Array; count: Map<string, number> }
const geoCache = new WeakMap<object, Geo>();
/** 건물마다 강·바다까지의 거리, 종류별 건물 수 (지도는 고정이라 한 번만 구한다) */
function geoOf(sim: Sim): Geo {
  const ps = sim.city.places;
  let g = geoCache.get(ps);
  if (!g) {
    g = { river: new Float32Array(ps.length), coast: new Float32Array(ps.length), count: new Map() };
    for (const q of ps) {
      const x = q.x + q.w / 2, y = q.y + q.h / 2;
      g.river[q.id] = riverDist(x, y); g.coast[q.id] = coastY(x) - y;
      if (q.facility < 0) g.count.set(q.kind, (g.count.get(q.kind) ?? 0) + 1);
    }
    geoCache.set(ps, g);
  }
  return g;
}
const cx = (q: Place): number => q.x + q.w / 2, cy = (q: Place): number => q.y + q.h / 2;

/** 건물이나 터를 고른다. 사건이 진행 중인 건물은 쓰지 않고, 사건이 진행 중인 교차로에 딸린 건물도 되도록 피한다 */
function pickPlace(sim: Sim, d: DisasterState, weight: (q: Place) => number): Place | null {
  const nodes = new Set<number>(), used = new Set<number>();
  for (const I of sim.incidents) if (I.phase !== 'closed') { nodes.add(I.truth.nodeId); if (I.truth.placeId >= 0) used.add(I.truth.placeId); }
  const ps = sim.city.places;
  const ws = ps.map((q) => (q.facility >= 0 || used.has(q.id) ? 0 : Math.max(0, weight(q))));
  const strict = ws.map((v, k) => (nodes.has(ps[k].nodeId) ? 0 : v));
  if (strict.some((v) => v > 0)) return d.rng.weighted(ps, strict);
  return ws.some((v) => v > 0) ? d.rng.weighted(ps, ws) : null;
}
/** 교차로를 고른다 (사건이 진행 중이거나 출동 시설 앞인 곳은 뺀다) */
function pickNode(sim: Sim, d: DisasterState, weight: (n: RoadNode) => number): RoadNode | null {
  const busy = new Set<number>();
  for (const I of sim.incidents) if (I.phase !== 'closed') busy.add(I.truth.nodeId);
  for (const f of sim.city.facilities) busy.add(f.nodeId);
  const ns = sim.city.nodes;
  const ws = ns.map((n) => (busy.has(n.id) ? 0 : Math.max(0, weight(n))));
  return ws.some((v) => v > 0) ? d.rng.weighted(ns, ws) : null;
}

const HOMES: W = { houseS: 4, houseL: 2, villa: 3, farmhouse: 1.5, apartment: 2 };
const WILD_KINDS: W = { forest: 3, pension: 2, campsite: 2, temple: 2, farmhouse: 1.5, lookout: 2 };
const WILD_NEAR: W = { houseS: 1, houseL: 1, greenhouse: 0.6, cafe: 0.6 };      // 산자락의 집 (마땅한 숲·펜션이 없을 때)
const EVAC_KINDS: W = { beach: 4, pier: 2, fishMarket: 1.5, ferry: 1.5 };
const COAST_KINDS: W = { beach: 3, pier: 3, riverside: 2, lighthouse: 2, fishMarket: 2, ferry: 2, containerYard: 1.5, amusement: 1.5, hotel: 1, campsite: 1, forest: 0.6, pension: 0.25, restaurant: 0.25, cafe: 0.2, houseS: 0.1 };
const SEV3 = [0.3, 0.5, 0.2];

/** 무엇을, 어디에, 어떤 사건으로 일으킬지 정한다 (마땅한 자리가 없으면 null) */
function resolve(sim: Sim, d: DisasterState, what: What): SpawnOpts | null {
  const rng = d.rng, g = geoOf(sim), k = d.kind;
  const per = (table: W) => (q: Place): number => (table[q.kind] ?? 0) / (g.count.get(q.kind) ?? 1);      // 표의 값은 그 종류 전체의 몫이다
  const near = (x: number, y: number, scale: number) => (px: number, py: number): number => Math.exp(-Math.hypot(px - x, py - y) / scale);
  const epi = d.epi ? near(d.epi.x, d.epi.y, 700) : (): number => 1;
  const atPlace = (q: Place | null, o: SpawnOpts): SpawnOpts | null => (q ? { ...o, placeId: q.id } : null);
  const atNode = (n: RoadNode | null, o: SpawnOpts): SpawnOpts | null => (n ? { ...o, nodeId: n.id } : null);
  const crossing = (n: RoadNode): number => (n.edges.length >= 3 ? 1 : n.edges.length === 2 ? 0.3 : 0);
  switch (what) {
    case 'tree':
      return atNode(pickNode(sim, d, crossing), { type: 'traffic', variant: has('traffic', 'tree') ? 'tree' : 'std', severity: rng.int(1, 2), note: '강풍에 가로수가 쓰러져 길을 막았습니다' });
    case 'crash':
      return atNode(pickNode(sim, d, (n) => crossing(n) * (k === 'quake' ? epi(n.x, n.y) : 1)), { type: 'traffic', variant: 'std', severity: rng.int(1, 2), note: k === 'quake' ? '지진에 놀란 차량들이 충돌했습니다' : '비바람에 차량이 미끄러져 충돌했습니다' });
    case 'sign':
      // 응급 환자 현장은 집 안의 모습이므로 집에서 일으킨다 (날아든 간판·지붕 조각에 맞은 주민)
      return atPlace(pickPlace(sim, d, per(INCIDENT_PLACES.medical)), { type: 'medical', variant: 'trauma', severity: 2, note: '강풍에 날아든 간판에 사람이 맞아 다쳤습니다' });
    case 'roof':
      return atPlace(pickPlace(sim, d, per({ houseS: 3, villa: 2, houseL: 1, farmhouse: 1 })), { type: 'collapse', variant: 'std', severity: 1, note: '강풍에 지붕이 내려앉았습니다' });
    case 'surge':
      return atPlace(pickPlace(sim, d, per({ riverside: 3, pier: 2, beach: 2 })), { type: 'water', variant: 'std', severity: rng.int(1, 2), note: '불어난 물에 사람이 휩쓸렸습니다' });
    case 'landslide': {
      const note = k === 'typhoon' ? '비에 젖은 비탈이 무너져 도로를 덮쳤습니다' : '물을 머금은 비탈이 무너져 도로를 덮쳤습니다';
      if (has('collapse', 'landslide')) return { type: 'collapse', variant: 'landslide', severity: rng.int(2, 3), note };
      return atPlace(pickPlace(sim, d, (q) => (q.kind === 'farmhouse' || q.kind === 'pension' ? mountainAt(cx(q), cy(q)) + 0.05 : 0)), { type: 'collapse', variant: 'std', severity: 2, note });
    }
    case 'riverRescue': {
      // 강변 터가 먼저, 모두 쓰이고 있으면 강에서 90 안의 건물
      const q = pickPlace(sim, d, (p) => (p.kind === 'riverside' ? 1 : 0)) ?? pickPlace(sim, d, (p) => (!p.open && g.river[p.id] < 90 ? 1 : 0));
      return atPlace(q, { type: 'water', variant: 'std', severity: rng.weighted([1, 2, 3], SEV3), note: '불어난 강물에 사람이 휩쓸렸습니다' });
    }
    case 'floodCar': {
      const n = pickNode(sim, d, (m) => (riverDist(m.x, m.y) < 120 && m.edges.length >= 2 ? 1 : 0)) ?? pickNode(sim, d, (m) => (riverDist(m.x, m.y) < 240 && m.edges.length >= 2 ? 1 : 0));
      return atNode(n, { type: 'traffic', variant: 'std', severity: rng.int(1, 2), note: '물에 잠긴 도로에서 차량들이 뒤엉켰습니다' });
    }
    case 'gasLeak': {
      const table = per(INCIDENT_PLACES.hazmat);
      const q = k === 'flood' ? pickPlace(sim, d, (p) => (g.river[p.id] < 420 ? table(p) : 0)) ?? pickPlace(sim, d, table) : pickPlace(sim, d, (p) => table(p) * epi(cx(p), cy(p)));
      return atPlace(q, { type: 'hazmat', variant: 'std', severity: k === 'flood' ? rng.int(1, 2) : rng.weighted([1, 2, 3], [0.4, 0.45, 0.15]), note: k === 'flood' ? '물에 잠긴 지하에서 가스가 새기 시작했습니다' : '지진으로 가스 배관이 끊어졌습니다' });
    }
    case 'collapse': case 'gasblast': {
      const blast = what === 'gasblast' && has('collapse', 'gasblast');
      const table = per((blast ? scenarioOf('collapse', 'gasblast')!.places : undefined) ?? INCIDENT_PLACES.collapse);
      const o: SpawnOpts = blast ? { type: 'collapse', variant: 'gasblast', note: '지진으로 새어 나온 가스가 폭발했습니다' } : { type: 'collapse', variant: 'std', severity: rng.int(2, 3), note: '지진으로 건물이 무너졌습니다' };
      return atPlace(pickPlace(sim, d, (p) => table(p) * epi(cx(p), cy(p))), o);
    }
    case 'fire': {
      const table = per(INCIDENT_PLACES.fire);
      return atPlace(pickPlace(sim, d, (p) => table(p) * epi(cx(p), cy(p))), { type: 'fire', variant: 'std', severity: rng.weighted([1, 2, 3], [0.45, 0.4, 0.15]), note: '지진으로 불이 났습니다' });
    }
    case 'elevator': {
      const el = has('collapse', 'elevator');
      const table = per((el ? scenarioOf('collapse', 'elevator')!.places : undefined) ?? { apartment: 6, office: 5, officetel: 4 });
      return atPlace(pickPlace(sim, d, (p) => table(p) * epi(cx(p), cy(p))), el ? { type: 'collapse', variant: 'elevator', note: '지진으로 승강기가 멈췄습니다' } : { type: 'collapse', variant: 'std', severity: 1, note: '지진으로 건물 일부가 내려앉았습니다' });
    }
    case 'after': {
      if (rng.chance(0.6)) { const table = per(INCIDENT_PLACES.collapse); return atPlace(pickPlace(sim, d, (p) => table(p) * epi(cx(p), cy(p))), { type: 'collapse', variant: 'std', severity: rng.int(1, 2), note: '여진으로 금이 가 있던 건물이 무너졌습니다' }); }
      return atNode(pickNode(sim, d, (n) => crossing(n) * epi(n.x, n.y)), { type: 'traffic', variant: 'std', severity: rng.int(1, 2), note: '여진에 놀란 차량들이 충돌했습니다' });
    }
    case 'wild': {
      if (!has('fire', 'wild')) return null;
      const f = d.front!, reach = Math.max(150, f.r + 40);
      const by = (table: W, lim: number) => (p: Place): number => { const dd = Math.hypot(cx(p) - f.x, cy(p) - f.y); return dd <= lim ? (table[p.kind] ?? 0) / (1 + dd / 100) : 0; };
      const q = pickPlace(sim, d, by(WILD_KINDS, reach)) ?? pickPlace(sim, d, by(WILD_NEAR, reach + 30)) ?? pickPlace(sim, d, by(WILD_KINDS, 460));
      return atPlace(q, { type: 'fire', variant: 'wild', severity: rng.int(2, 3), note: '산불이 번져 왔습니다' });
    }
    case 'houseFire': {
      const t = d.to!, by = (table: W, lim: number) => (p: Place): number => { const dd = Math.hypot(cx(p) - t.x, cy(p) - t.y); return dd <= lim ? (table[p.kind] ?? 0) / (1 + dd / 80) : 0; };
      const q = pickPlace(sim, d, by({ ...HOMES, pension: 2 }, 260)) ?? pickPlace(sim, d, by(INCIDENT_PLACES.fire, 420));
      return atPlace(q, { type: 'fire', variant: 'std', severity: 2, note: '산불이 건물로 옮겨붙었습니다' });
    }
    case 'evac':
      return atPlace(pickPlace(sim, d, per(EVAC_KINDS)), { type: 'water', variant: 'evac', severity: rng.int(2, 3), note: '해일 경보가 났는데 바닷가에 사람들이 남아 있습니다' });
    case 'coast':
      return atPlace(pickPlace(sim, d, (p) => (g.coast[p.id] < 170 ? (COAST_KINDS[p.kind] ?? 0) : 0)), { type: 'water', variant: 'std', severity: rng.weighted([1, 2, 3], [0.3, 0.45, 0.25]), note: '해일에 사람이 휩쓸렸습니다' });
    case 'coastCrash':
      return atNode(pickNode(sim, d, (n) => (coastY(n.x) - n.y < 260 ? crossing(n) : 0)), { type: 'traffic', variant: 'std', severity: rng.int(1, 2), note: '밀려든 바닷물에 차량들이 떠밀려 부딪쳤습니다' });
  }
}

// ───────────────────────── 태풍 ─────────────────────────
// 충격 420초 동안 14~22초마다 하나씩: 쓰러진 나무, 날아든 간판, 내려앉은 지붕, 강변·부두 침수, 교통사고, 산사태(한 번).
// 세기가 가장 높을 때 120초 동안 정전.
function tickTyphoon(sim: Sim, d: DisasterState): void {
  if (!d.done.dark && sim.t >= d.tImpact + 150) lightsOut(sim, d);
  if (sim.t < d.nextAt) return;
  d.nextAt = sim.t + d.rng.range(14, 22);
  const what = d.rng.weighted<What>(['tree', 'sign', 'roof', 'surge', 'crash', 'landslide'], [0.35, 0.15, 0.12, 0.18, 0.1, d.done.landslide ? 0 : 0.1]);
  if (raise(sim, d, what) && what === 'landslide') d.done.landslide = sim.t;
}

// ───────────────────────── 홍수 ─────────────────────────
// 수위가 300초에 걸쳐 0 → 1, 120초 유지, 240초에 걸쳐 0.3 까지 내려간 뒤 여파 동안 0 으로.
// 수위가 구간 문턱의 0.7 을 넘으면 그 구간이 느려지고, 문턱을 넘으면 잠긴다(우회로가 있을 때만). 내려가면 거꾸로 열린다.
const FLOOD_RISE = 300, FLOOD_HOLD = 120, FLOOD_FALL = 240, FLOOD_SLOW = 0.8;
function floodLevel(d: DisasterState, t: number): number {
  const u = t - d.tImpact;
  if (u <= 0) return 0;
  if (u < FLOOD_RISE) return u / FLOOD_RISE;
  if (u < FLOOD_RISE + FLOOD_HOLD) return 1;
  if (u < FLOOD_RISE + FLOOD_HOLD + FLOOD_FALL) return 1 - (0.7 * (u - FLOOD_RISE - FLOOD_HOLD)) / FLOOD_FALL;
  return Math.max(0, 0.3 * (1 - (t - d.tEnd) / AFTERMATH));
}
function floodRoads(sim: Sim, d: DisasterState): void {
  const lv = (d.level = floodLevel(d, sim.t));
  if (sim.tick % 10 !== 0) return;      // 2초마다 살핀다
  const thr = d.thr!, slowed = d.slowed!;
  for (const e of sim.city.edges) {
    const th = thr[e.id];
    if (th > 1.45) continue;      // 강에서 먼 구간
    const k = slowed.indexOf(e.id);
    if (k < 0 && lv > th * 0.7) { e.slow += FLOOD_SLOW; slowed.push(e.id); }
    else if (k >= 0 && lv < th * 0.7 - 0.03) { e.slow = Math.max(0, e.slow - FLOOD_SLOW); slowed.splice(k, 1); }
    // 강가의 길은 다리 없이도 돌아갈 수 있을 때만 닫는다 (그래야 다리가 잠길 때 그 다리에만 매달린 교차로가 없다)
    if (!e.closed && (e.bridge ? lv >= th : lv > th)) closeEdge(sim, d, e, e.bridge ? '강물이 다리 상판까지 차올랐습니다' : '도로가 물에 잠겼습니다', !e.bridge);
    else if (e.closed && e.closedReason === 'disaster' && lv < th - 0.05) reopenEdges(sim, d, (q) => q.id === e.id);
  }
}
function tickFlood(sim: Sim, d: DisasterState): void {
  if (sim.t < d.nextAt) return;
  d.nextAt = sim.t + d.rng.range(25, 40);
  const what = d.rng.weighted<What>(['riverRescue', 'floodCar', 'gasLeak', 'landslide'], [0.5, 0.3, d.done.gasLeak ? 0 : 0.1, d.done.landslide ? 0 : 0.1]);
  if (raise(sim, d, what) && (what === 'gasLeak' || what === 'landslide')) d.done[what] = sim.t;
}

// ───────────────────────── 지진 ─────────────────────────
// 예고 없이 25초에 걸쳐 쏟아진다(onImpact 가 d.queue 에 넣는다). 120~200초 뒤 여진:
// 진행 중인 붕괴 현장의 금 간 구조물이 곧 다시 무너지고(세계 규칙), 새 사건이 1~2건 더 난다.
function tickQuake(sim: Sim, d: DisasterState): void {
  if (d.done.aftershock || sim.t < d.done.aftershockAt) return;
  d.done.aftershock = sim.t; d.shakes!.push(sim.t);
  let cracked = 0;
  for (const I of sim.incidents) {
    if (I.phase === 'closed' || I.truth.type !== 'collapse') continue;
    const s = sim.scenes[I.id];
    if (!s) continue;
    for (const p of s.props) if (p.kind === 'unstable' && !p.mitigated && p.leakRate) { p.leak = Math.max(p.leak ?? 0, 0.95); cracked++; }
  }
  tell(sim, d, `여진 발생.${cracked ? ` 붕괴 현장의 금 간 구조물 ${cracked}곳이 다시 흔들립니다.` : ''} 추가 피해 신고가 들어옵니다.`, '기상청');
  const n = d.rng.int(1, 2);
  for (let k = 0; k < n; k++) d.queue.push({ at: sim.t + 3 + k * 6, what: 'after' });
}

// ───────────────────────── 산불 ─────────────────────────
// 불머리가 산기슭에서 동네 쪽으로 번진다(헬기가 산불 현장에 떠 있으면 느려진다). 지나간 자리는 d.scar 에 남는다.
// 70~100초마다 불머리 가까운 숲·펜션·농가에 산불 현장이 열린다. 동네에 닿으면 주택 화재 2건을 내고 멈추고,
// 산불 현장 셋을 잘 막아 내면 "주불 진화"로 멈춘다.
function tickWildfire(sim: Sim, d: DisasterState): void {
  const f = d.front!;
  if (d.stopped) return;
  let heli = false, good = 0;
  for (const u of sim.units) if ((u.bucketMax ?? 0) > 0 && u.state === 'onscene' && u.incidentId !== null && d.spawned.indexOf(u.incidentId) >= 0) { heli = true; break; }      // 물 바구니를 단 헬기(소방 헬기)만 — 경찰·의료 헬기는 불머리를 늦추지 못한다
  for (const id of d.spawned) { const I = sim.incidents[id]; if (I.truth.variant === 'wild' && I.result && (I.result.outcome === 'success' || I.result.outcome === 'partial' || I.result.outcome === 'delayed')) good++; }
  // 헬기가 산불 현장에 떠 있으면 느려지고, 산불 현장을 하나 막아 낼 때마다 조금씩 더 느려진다
  const step = d.speed! * (heli ? 0.7 : 1) * 0.85 ** good * sim.dt;
  f.x += f.dx * step; f.y += f.dy * step; d.run! += step;
  f.r = 60 + 120 * clamp(d.run! / d.span!, 0, 1);
  const last = d.scar![d.scar!.length - 1];
  if (Math.hypot(f.x - last[0], f.y - last[1]) >= 26) d.scar!.push([f.x, f.y, f.r]);
  if (good >= 3) {
    d.stopped = 'contained'; d.tEnd = sim.t;
    tell(sim, d, `주불 진화. 산불 현장 ${good}곳을 막아 내 불길이 ${d.to!.name}에 닿기 전에 멈췄습니다.`);
    return;
  }
  if (d.run! >= d.span!) {
    d.stopped = 'reached'; d.tEnd = sim.t;
    tell(sim, d, `산불이 ${d.to!.name}까지 내려왔습니다. 건물로 불이 옮겨붙고 있습니다.`);
    d.queue.push({ at: sim.t + 1, what: 'houseFire' }, { at: sim.t + 5, what: 'houseFire' });
    return;
  }
  if (sim.t < d.nextAt) return;
  d.nextAt = sim.t + d.rng.range(70, 100);
  raise(sim, d, 'wild');
}
/** 불머리 안의 구간은 통제하고, 불길이 지나가면 연다 (2초마다) */
function fireRoads(sim: Sim, d: DisasterState): void {
  if (sim.tick % 10 !== 0) return;
  const f = d.front!, c = sim.city;
  const far = (e: RoadEdge): number => { const A = c.nodes[e.a], B = c.nodes[e.b]; return distSeg(f.x, f.y, A.x, A.y, B.x, B.y); };
  if (!d.stopped) for (const e of c.edges) if (!e.closed && far(e) < f.r * 0.75) closeEdge(sim, d, e, '산불이 도로까지 번졌습니다');
  if (d.closedEdges.length) reopenEdges(sim, d, (e) => far(e) > f.r + 30);
}

/** 평소 사건이 생기는 간격에 곱하는 값 (재난 중에는 평소 사건이 뜸해진다) */
export function disasterGapMul(sim: Sim): number { const d = sim.disaster; return d && (d.phase === 'impact' || d.phase === 'warning') ? 1.6 : 1; }

/** 교대 보고서에 넣을 요약 (재난이 없었으면 undefined). 실제로 일어난 일(d.log)과 재난이 일으킨 사건의 결과만 쓴다 */
export function disasterSummary(sim: Sim): { name: string; lines: string[] } | undefined {
  const d = sim.disaster;
  if (!d || d.phase === 'calm') return undefined;
  const ck = (t: number): string => fmtClock(sim.startTod + t).slice(0, 5);
  const lines: string[] = [];
  const hitAt = sim.t >= d.tImpact && d.phase !== 'warning';
  const until = Math.min(d.tEnd, sim.t);
  let head = d.tWarn < d.tImpact ? `${ck(d.tWarn)} ${d.kind === 'typhoon' ? '특보' : '경보'}` : '';
  if (hitAt) head += `${head ? ', ' : ''}${ck(d.tImpact)}${until - d.tImpact >= 60 ? `~${ck(until)}` : ''} ${d.kind === 'quake' ? '발생' : d.kind === 'wildfire' ? '확산' : '충격'}`;
  else head += ' (충격 전에 교대가 끝났습니다)';
  const n = d.spawned.length, cnt = { success: 0, partial: 0, delayed: 0, unresolved: 0, failed: 0 };
  for (const id of d.spawned) { const r = sim.incidents[id].result; if (r) cnt[r.outcome]++; }
  const parts: string[] = [];
  if (cnt.success) parts.push(`성공 ${cnt.success}`); if (cnt.partial) parts.push(`부분 성공 ${cnt.partial}`); if (cnt.delayed) parts.push(`대응 지연 ${cnt.delayed}`);
  if (cnt.unresolved) parts.push(`미해결 ${cnt.unresolved}`); if (cnt.failed) parts.push(`실패 ${cnt.failed}`);
  lines.push(`${d.name} — ${head}. ${n ? `재난 사건 ${n}건 가운데 ${parts.join(', ')}.` : '재난으로 일어난 사건은 없었습니다.'}${d.closedTotal ? ` 도로 ${d.closedTotal}구간 통제.` : ''}`);
  if (d.kind === 'tsunami' && d.hit && hitAt) lines.push(!d.hit.length ? '해일이 닿기 전에 대피 현장을 모두 끝냈습니다.' : d.swept ? `해일이 닿을 때까지 끝내지 못한 대피 현장 ${d.hit.length}곳에서 ${d.swept}명이 물에 휩쓸렸습니다.` : `해일이 닿을 때 대피 현장 ${d.hit.length}곳이 아직 열려 있었지만, 물가에 남아 있던 사람은 없었습니다.`);
  for (const l of d.log) lines.push(`${ck(l.t)} ${l.text}`);
  return { name: d.name, lines };
}
