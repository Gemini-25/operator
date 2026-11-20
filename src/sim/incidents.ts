// IncidentGenerator + IncidentManager
// 사건 템플릿에 위치·규모·숨은 위험·신고 정확도 등을 조합해 매번 다른 사건을 만든다.

import { edgeName, findRoute, nodeName } from './city';
import { evaluate } from './debrief';
import { startCall, startNuisanceCall } from './dispatch/callSystem';
import type { Sim } from './engine';
import { emit } from './events';
import { createScene, settleInjuries } from './field/sceneManager';
import { releaseUnit } from './resources';
import type { Rng } from './rng';
import { INCIDENT_PLACES } from './cityPlan';
import { startPursuit } from './pursuit';
import { disasterGapMul } from './disaster';
import { DEPTH_MAX, chainDepth } from './chain';
import { signal } from './world/consequence';      // (I1-b) 사건의 발생(붕괴)·종료를 세계에 알린다
import { canBlock, noteRoadCause } from './traffic';      // (I1-b b3-5) 길을 닫거나 느리게 한 기록을 교통의 장부에
import { divertUnmet } from './world/rules/record';      // (I1-b C6)
import { SCENARIOS, scenarioName, scenarioOf } from './scenarios';
import type { Scenario } from './scenarios';
import type { HzNote, Incident, IncidentType, Place, PlaceKind } from './types';
import { OUTCOME_NAME, TYPE_NAME } from './util';
import { TYPE_DEFS, TYPE_ORDER } from './incidentTypes';
import { noteClosedPlace } from './field/catastrophe';      // (X6 단계 7) 끝난 화재의 그을린 건물

/** 사건을 정해서 일으킬 때 주는 조건. 비워 두면 평소처럼 추첨한다. */
export interface SpawnOpts {
  note?: string;                 // 발생 기록의 첫머리 (예: '도주한 용의자가 다른 곳에서 다시 범행을 벌입니다')
  type?: IncidentType; variant?: string; severity?: number;
  placeId?: number;              // 이 건물에서
  nodeId?: number;               // 이 교차로에서 (건물 없이 길 위에서)
  tag?: string;                  // Incident.tag (없으면 시나리오의 tag)
  parent?: number;               // 이 사건을 낳은 사건
  rng?: Rng;                     // 이 난수 흐름으로 만든다. 주면 평소 생성기의 상태(lastType)를 건드리지 않는다
  cause?: number;                // (I1-b) 이 사건을 낳은 기록 — 예약하는 순간에 이미 있는 기록이어야 한다. 발생 기록의 causes 와 Incident.cause 가 된다
  csq?: string;                  // (I1-b) 이 사건을 만든 연쇄의 이름 → Incident.csq
  edgeId?: number;               // (I1-b b3-4) 교통사고가 난 구간 — 막히는 구간(I.blockedEdge)을 이 구간으로 먼저 본다 (조건은 설계서 §3.6b (다) — 쓰는 것은 b3-6 의 L1)
  causes?: number[];             // (I1-b b3-4) 원인이 하나가 아닐 때 — cause 다음에 발생 기록의 causes 로 들어간다 (음수·중복은 emit 이 거른다)
  hz?: HzNote;                   // (I1-b b3-4) 이 사건을 낳은 초과 위험의 내력 → Incident.hz (world/hazard.ts 가 예약하는 그 자리에서 적는다)
}
export interface ChainItem { at: number; opts: SpawnOpts; when?: (sim: Sim) => boolean; until?: number; log?: number }
/** (I1-b) 예약했지만 일으키지 않은 연쇄 하나. 기록(emit)은 남기지 않는다 — 일어나지 않은 일이다. 보고서·측정 도구가 수로만 쓴다 */
export interface DroppedChain { t: number; why: 'late' | 'busy' | 'depth' | 'expired' | 'cap'; type?: IncidentType; variant?: string; parent?: number;
  csq?: string }      // (b3-4) 버린 것이 규칙·법칙의 사건이면 그 이름 (측정 도구가 법칙의 것을 가린다)
export interface GenState {
  nextAt: number; lastType: IncidentType | null; count: number; lastCreated: number;
  nextNuisanceAt: number;                                        // 다음 비긴급 전화
  /** 이어지는 사건 예약 (도주 용의자의 재범, 연쇄 방화, 은신처 제보, (I1-b) 인과 규칙이 만드는 사건). at 순서로 넣지 않아도 된다.
   *  (I1-b §3.5) when 이 있으면 때가 됐을 때 조건이 맞아야 일어난다: 거짓이면 5초 뒤 다시 보고, until 이 지나면 버린다('expired').
   *  when 은 sim 의 상태만 읽는 함수여야 한다(바깥 변수를 바꾸지 않는다). log 는 world.log 의 줄 번호 — 사건이 되면 그 줄의 made 를 채운다 */
  chain: ChainItem[];
  majorAt: number;                                               // 대형 사고가 일어날 시각 (Infinity = 이번 교대에는 없다). engine 이 정한다
  forced: boolean;                                               // 강제 발생(sim.force)을 이미 일으켰는가
  dropped: DroppedChain[];                                       // (I1-b) 버린 예약 — 교대 끝 150초 안('late')·열린 사건이 많음('busy')·깊이 상한('depth')·조건이 끝내 맞지 않음('expired')·교대 상한('cap')
}
export function initGenerator(rng: Rng): GenState { return { nextAt: rng.range(10, 22), lastType: null, count: 0, lastCreated: 0, nextNuisanceAt: 40, chain: [], majorAt: Infinity, forced: false, dropped: [] }; }

/** 무장 사건의 변형에 따라 잘 일어나는 곳이 다르다 */
const ARMED_BIAS: Record<string, Partial<Record<PlaceKind, number>>> = {
  robbery: { bank: 2.2, convenience: 1.8, gasStation: 1.6, shop: 1.4 },
  dispute: { restaurant: 3, market: 2, hotel: 1.5, bank: 0.2 },
  shooter: { mart: 2.5, market: 2, office: 2, terminal: 2, convenience: 0.4 },
  hostage: { bank: 2, office: 1.6, hotel: 1.5 },
};

/** (I1-b) 발생할 때 'collapse' 신호를 보내는 붕괴 사건의 변형 — 처음부터 무너져 있는 큰 붕괴 (설계서 I1 §3.4 의 신호 표) */
const COLLAPSE_AT_START = new Set(['crane', 'gasblast', 'landslide']);

const kindCount = new WeakMap<object, Map<string, number>>();
/** 사건이 일어날 건물이나 터를 고른다. 교통사고는 교차로에서 일어나므로 null. */
/**
 * (X6 §7.1) 이 교대에 통째로 무너졌거나 다 탄 건물인가 (Sim.placeMarks) — 그 건물에서는 새 사건을 내지 않는다.
 * 부르는 곳 셋: pickPlace(엄격·대안 추첨 모두) · createIncident 의 정해 준 건물(재난·은신처의 길) · pursuit 의 은신처 후보. I2 단계 5 가 이 셋을 placeUsable(sim, id) 로 바꾼다
 */
export function placeGone(sim: Sim, id: number): boolean {
  if (!sim.placeMarks.size) return false;
  const pm = sim.placeMarks.get(id);
  return pm !== undefined && (pm.state === 'collapsed' || pm.state === 'burnt');
}

function pickPlace(sim: Sim, rng: Rng, type: IncidentType, variant: string, busy: Set<number>): Place | null {
  const table = scenarioOf(type, variant)?.places ?? INCIDENT_PLACES[type];
  const used = new Set(sim.incidents.map((I) => I.truth.placeId));
  // 표의 값은 건물 종류 전체의 몫이므로, 그 종류의 건물 수로 나눠 한 채의 비중을 구한다
  if (!kindCount.has(sim.city.places)) { const m = new Map<string, number>(); for (const q of sim.city.places) if (q.facility < 0) m.set(q.kind, (m.get(q.kind) ?? 0) + 1); kindCount.set(sim.city.places, m); }
  const counts = kindCount.get(sim.city.places)!;
  const weigh = (q: Place, strict: boolean): number => {
    let w = (table[q.kind] ?? 0) / (counts.get(q.kind) ?? 1);
    if (w <= 0 || q.facility >= 0 || placeGone(sim, q.id)) return 0;      // (X6) 무너졌거나 다 탄 건물은 대안 추첨에서도 뺀다
    if (strict && (busy.has(q.nodeId) || used.has(q.id))) return 0;
    if (type === 'armed') w *= ARMED_BIAS[variant]?.[q.kind] ?? 1;
    if (type === 'search' && variant === 'hiker' && q.kind !== 'forest') return 0;
    return w;
  };
  let ws = sim.city.places.map((q) => weigh(q, true));
  if (!ws.some((v) => v > 0)) ws = sim.city.places.map((q) => weigh(q, false));
  if (!ws.some((v) => v > 0)) return null;
  return rng.weighted(sim.city.places, ws);
}

/**
 * 사건을 하나 일으킨다. opts 가 비어 있으면 평소의 추첨(유형 → 시나리오 → 규모 → 장소)이고,
 * 정해 주면 그 유형·시나리오·장소로 일으킨다 (이어지는 사건, 대형 사고, 재난, 시험).
 */
export function createIncident(sim: Sim, opts: SpawnOpts = {}): Incident {
  const rng = opts.rng ?? sim.rngGen, g = sim.gen, tn = sim.tune;
  const chainNote = opts.note ?? '';
  // 유형의 가중은 표(incidentTypes.TYPE_DEFS)에서 — 무장은 난이도의 값. 직전과 같은 유형은 ×0.3
  const w = TYPE_ORDER.map((t) => { const d = TYPE_DEFS[t].weight, v = d === 'armed' ? tn.armedWeight : d; return t === g.lastType ? v * 0.3 : v; });
  const type = opts.type ?? rng.weighted(TYPE_ORDER, w);
  if (!opts.rng) g.lastType = type;
  let severity = rng.weighted([1, 2, 3], tn.sevWeights);
  let variant = 'std';
  // 시나리오: 유형 안에서 정해진 몫만큼 다른 모습의 사건이 된다 (scenarios.ts). 대형 사고와 재난의 시나리오는 평소 추첨에 들어가지 않는다
  let special: Scenario | null = null;
  if (opts.variant) { variant = opts.variant; special = scenarioOf(type, variant) ?? null; }
  else { const cs = SCENARIOS.filter((q) => q.type === type && q.tag !== 'major' && q.tag !== 'disaster'); if (cs.length) { let r = rng.next(); for (const q of cs) { if (q.gate && !q.gate(sim)) continue; r -= q.share; if (r < 0) { special = q; break; } } } }
  if (special) { variant = special.variant; severity = rng.int(special.severity[0], special.severity[1]); }
  else if (opts.variant) { if (type === 'armed' && variant === 'robbery') severity = Math.max(2, severity); else if (variant === 'shooter' || variant === 'hostage') severity = 3; }
  else if (type === 'armed') {
    variant = rng.weighted(['robbery', 'dispute', 'shooter', 'hostage'], [0.4, 0.28, tn.shooterWeight, 0.16]);
    if (variant === 'shooter' || variant === 'hostage') severity = 3; else if (variant === 'dispute') severity = Math.min(severity, 2);
    else severity = Math.max(2, severity);
    // 장난 전화: 실제로는 아무 일도 없다
    if (rng.chance(tn.falseAlarmProb * 0.8)) { variant = 'prank'; severity = 1; }
  } else if (type === 'search') variant = rng.chance(0.45) ? 'wander' : 'hiker';
  else if (type === 'traffic' && severity >= 2 && rng.chance(severity >= 3 ? 0.28 : 0.06)) { variant = 'bus'; severity = 3; }      // 버스가 낀 다수 사상자 사고
  else if (type === 'medical') variant = severity >= 3 ? 'arrest' : severity === 2 ? 'trauma' : 'faint';
  else if (type === 'fire' && rng.chance(tn.falseAlarmProb)) { variant = 'false'; severity = 1; }      // 오인 신고: 탄 음식, 경보 오작동
  if (opts.severity) severity = opts.severity;
  // 위치: 유형에 맞는 건물이나 터를 고른다 (교통사고는 교차로)
  const busy = new Set(sim.incidents.filter((I) => I.phase !== 'closed').map((I) => I.truth.nodeId));
  // 정해 준 자리가 있으면 그곳, 길 위에서 일어나는 시나리오면 그 교차로, 아니면 유형에 맞는 건물
  // (X6 §7.1) 정해 준 건물이 이 교대에 무너졌거나 다 탔으면 그 유형의 건물을 다시 고른다 (재난·은신처는 pickPlace 를 거치지 않는다 — 그 경우에만 사건 흐름을 한 번 더 쓴다)
  const fixedPlace = opts.placeId !== undefined && !placeGone(sim, opts.placeId) ? opts.placeId : undefined;
  const fixedNode = opts.nodeId ?? (fixedPlace === undefined && opts.placeId === undefined ? special?.node?.(sim, rng, busy) ?? null : null);
  const place = fixedPlace !== undefined ? sim.city.places[fixedPlace] : fixedNode !== null || type === 'traffic' ? null : pickPlace(sim, rng, type, variant, busy);
  let node = place ? sim.city.nodes[place.nodeId] : fixedNode !== null ? sim.city.nodes[fixedNode] : null;
  if (!node) {
    const fac = new Set(sim.city.facilities.map((f) => f.nodeId));
    let cands = sim.city.nodes.filter((n) => !busy.has(n.id) && !fac.has(n.id) && n.edges.length >= 3);
    if (!cands.length) cands = sim.city.nodes.filter((n) => !busy.has(n.id));
    node = rng.pick(cands);
  }
  const label = place ? (place.open ? `${place.name} (${place.addr})` : `${place.addr} ${place.name}`) : `${nodeName(sim.city, node.id)} 교차로`;
  const id = sim.incidents.length;
  const code = (id + 1 < 10 ? '0' : '') + (id + 1);
  const I: Incident = {
    id, code,
    truth: { type, variant, severity, nodeId: node.id, x: place ? place.x + place.w / 2 : node.x, y: place ? place.y + place.h / 2 : node.y, district: place ? place.district : node.district, label, placeId: place ? place.id : -1, placeKind: place ? place.kind : null },
    createdAt: sim.t, phase: 'unreported', reportedAt: -1, answeredAt: -1, claims: [], locationKnown: false, assessment: null,
    assigned: [], everAssigned: [], unmet: {}, unmetSince: 0, noUnitLogged: false,
    firstDispatchAt: -1, firstArrivalAt: -1, closedAt: -1, fieldVerified: false, fieldType: null, priority: 1,
    problems: [], result: null, lastEvent: -1, rootEvent: -1, callEvents: [], callsCount: 0, closeReason: '', interest: 0,
    blockedEdge: -1, followupAt: Infinity, firstCallAt: 0, firstAssess: null, fieldNeedsSeen: 0, dispatchLog: [],
    methods: undefined,      // (R2) 방법을 쓴 기록 — 처음 남길 때 배열이 된다 (methodRun.recordMethod)
    reportedNode: node.id, addressFixed: false,
    pursuit: undefined, tag: undefined, parent: undefined, aidUnit: undefined, coResp: undefined,      // 나중에 붙는 칸을 미리 비워 둔다 (모든 사건이 같은 모양)
    airDone: undefined,      // (R1) "상공 임무 종료"로 풀려난 헬기 종류 — 쓰는 것은 단계 5 부터
    cause: undefined, csq: undefined, blockedBy: undefined, blockEv: undefined, divertWait: undefined,      // (I1-b) 인과 기록 — 판단은 읽지 않는다
    hz: undefined,      // (I1-b b3-4) 초과 위험의 내력 — 법칙이 낸 사건에만 (기록 전용)
    docs: undefined, trackBy: undefined, reportedPrev: undefined, reportedNodeAt: undefined,      // (R3) 교본 기록(처음 남길 때 배열 — doctrineRun.recordDoc)·추격의 보고 칸(2단계)
    dupOf: undefined,      // (N8) 중복 신고 오인의 원 사건 — 진실 (단계 10)
    fieldRisk: undefined,      // (X6 §5.9) 현장 상황 보고로 관제가 올린 위험도 — dispatcher.fieldReport 가 채운다
  };
  { const tag = opts.tag ?? special?.tag; if (tag) I.tag = tag; if (opts.parent !== undefined) I.parent = opts.parent; }
  if (opts.cause !== undefined && opts.cause >= 0) I.cause = opts.cause;
  if (opts.csq) I.csq = opts.csq;
  if (opts.hz) I.hz = opts.hz;
  sim.incidents.push(I);
  createScene(sim, I);
  { const sc = sim.scenes[I.id]; if (sc && sc.placeName && !place) I.truth.label = `${nodeName(sim.city, node.id)} ${sc.placeName}`; }      // 교차로 사고: 현장을 만들면서 정해진 이름
  const dl = special?.delay ?? TYPE_DEFS[type].delay;      // 발생 → 첫 신고: 시나리오가 적었으면 그것, 아니면 유형의 값
  const delay = rng.range(dl[0], dl[1]);
  I.firstCallAt = sim.t + delay;
  const benign = variant === 'false' || variant === 'prank';
  const pFollow = benign ? 0 : TYPE_DEFS[type].follow;
  if (rng.chance(pFollow)) I.followupAt = I.firstCallAt + rng.range(24, 55);
  if (type === 'traffic') {
    // 사고 지점 도로는 느려지고, 통제가 끝나면 전면 차단된다(우회로가 있는 도로만)
    const es = node.edges.map((e) => sim.city.edges[e]).filter((e) => !e.closed && e.cls !== 'highway');
    es.sort((a, b) => (b.arterial ? 1 : 0) - (a.arterial ? 1 : 0) || a.id - b.id);
    // (I1-b §3.6b (다)) 사고가 난 구간을 정해 주었으면(법칙이 낸 사고 — 차가 몰린 바로 그 구간) 그 구간을 먼저 본다: 이 교차로에 닿아 있고, 닫히지 않았고, 고속도로가 아니며,
    // 다른 열린 사건이 잡은 구간이 아니고(둘이 같은 구간을 잡으면 먼저 닫히는 사건이 감속과 통제를 풀어 남은 사건의 기록과 도로 상태가 어긋난다),
    // 막아도 도시가 끊기지 않는다(canBlock — 실제 상태에서, 열린 사건들이 잡은 구간도 막힌 것으로 치고). 아니면 지금 규칙(간선 먼저 · 번호 작은 것)으로 고르되,
    // 법칙이 낸 사고는 그때도 같은 두 조건을 본다 — 통제 하나의 이웃·우회로에 사고가 잇달아 나므로 알려진 통제만 보는 findRoute 로는 교차로 하나의 구간들이 차례로 닫혀 끊길 수 있다.
    // 평소 추첨은 구간을 정해 주지 않으므로 그대로다
    const law = opts.edgeId !== undefined;
    const held = (eid: number): boolean => { for (const J of sim.incidents) if (J !== I && J.phase !== 'closed' && J.blockedEdge === eid) return true; return false; };
    const pre = law ? sim.city.edges[opts.edgeId!] : undefined;
    if (pre && !pre.closed && pre.cls !== 'highway' && (pre.a === node.id || pre.b === node.id) && !held(pre.id) && canBlock(sim, pre)) { I.blockedEdge = pre.id; pre.slow += 1.4; }
    else for (const e of es) { if (findRoute(sim.city, e.a, e.b, 1, e.id) && (!law || (!held(e.id) && canBlock(sim, e)))) { I.blockedEdge = e.id; e.slow += 1.4; break; } }
    if (variant === 'tree' && I.blockedEdge >= 0) {
      // 쓰러진 나무가 길을 막았다: 치울 때까지 그 구간은 지나갈 수 없다. 이웃한 길이 밀리고 우회로에 차가 몰리는 것은 교통 모델의 일반 규칙이 한다
      // (I1-b §3.6b — 예전에는 여기서 이웃 구간의 혼잡에 0.7 을 손으로 더했다. 닫힌 까닭이 무엇이든 같은 규칙이다)
      const e = sim.city.edges[I.blockedEdge];
      e.closed = true; e.closedReason = 'incident';
      I.blockEv = emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', text: `${edgeName(sim.city, e)} 통행 불가 — 쓰러진 나무가 길을 막았습니다.`, imp: 1, truth: true });      // (I1-b) 통제 기록: 다른 사건의 ROUTE_BLOCKED 가 원인으로 가리킨다
      noteRoadCause(sim, e.id, 'close', I.blockEv, I.id);      // (I1-b b3-5) 닫힘의 주인 = 통제 기록 (감속의 주인은 아래의 발생 기록 — 항이 달라 서로 덮지 않는다)
    }
  }
  const what = variant === 'false' ? '실제 화재는 없음 — 오인 신고가 들어올 예정' : variant === 'prank' ? '실제 사건은 없음 — 장난 전화가 걸려 올 예정' : scenarioName(type, variant) === TYPE_NAME[type] ? TYPE_NAME[type] : `${TYPE_NAME[type]} · ${scenarioName(type, variant)}`;
  if (variant === 'kidnap' || variant === 'drunk' || variant === 'getaway') startPursuit(sim, I, variant);
  special?.onCreate?.(sim, I);
  I.rootEvent = emit(sim, { inc: id, role: 'SYSTEM', actor: '도시', kind: 'incident', imp: special?.tag === 'major' ? 3 : 1, truth: true, causes: I.cause !== undefined ? (opts.causes ? [I.cause, ...opts.causes] : [I.cause]) : opts.causes, text:chainNote ? `${chainNote} — ${I.truth.label}.` : `사건 발생 — ${I.truth.label} (${what}). 아직 신고되지 않았습니다.` });
  // (I1-b b3-5) 교통사고가 느리게 한 구간(slow += 1.4): 감속의 주인 = 발생 기록 — 그 구간이 뿌리가 된 밀림이 이 사건의 것이 된다 (기록 id 를 담기만 한다)
  if (type === 'traffic' && I.blockedEdge >= 0) noteRoadCause(sim, I.blockedEdge, 'slow', I.rootEvent, I.id);
  // (I1-b §3.4) 무너진 채로 시작하는 사건(크레인 붕괴·가스 폭발·산사태): 발생이 곧 붕괴다 — 신호의 기록은 발생 기록, 크기는 처음부터 무너져 있는 칸 수
  if (type === 'collapse' && COLLAPSE_AT_START.has(variant)) {
    const dm = sim.scenes[id]?.damage; let fell = 0;
    if (dm) for (let i = 0; i < dm.length; i++) if (dm[i]) fell++;
    if (fell > 0) signal(sim, 'collapse', { inc: id, ev: I.rootEvent, size: fell, place: I.truth.placeId });
  }
  return I;
}

export function tickIncidents(sim: Sim): void {
  const g = sim.gen;
  let open = 0;
  for (const I of sim.incidents) {
    if (I.phase === 'closed') continue;
    open++;
    if (I.phase === 'unreported' && sim.t >= I.firstCallAt) startCall(sim, I, false);
    if (sim.t >= I.followupAt && I.phase !== 'unreported') { I.followupAt = Infinity; startCall(sim, I, true); }
    // 무대응 종료: 지상 부대도, 상공의 헬기도 닿지 못했을 때만 (헬기가 현장 위에 떠 있는데 '어떤 부대도 닿지 못했다'고 닫지 않는다)
    if (I.firstArrivalAt < 0 && I.reportedAt >= 0 && sim.t - I.reportedAt > 330 && !((sim.scenes[I.id]?.airAt ?? -1) >= 0)) closeIncident(sim, I, 'noresponse');
  }
  const tn = sim.tune;
  // 사건과 무관한 비긴급 전화: 접수 회선을 잠시 점유한다
  if (sim.t >= g.nextNuisanceAt && sim.t < sim.shiftLen - 60) {
    g.nextNuisanceAt = sim.t + tn.nuisanceGap * sim.rngNuisance.range(0.55, 1.5);
    startNuisanceCall(sim);
  }
  // 이어지는 사건 (예약된 것 가운데 때가 된 것 하나)
  if (g.chain.length) {
    const k = g.chain.findIndex((c) => sim.t >= c.at);
    if (k >= 0) {
      const c = g.chain[k];
      if (c.when && !c.when(sim)) {
        // (I1-b §3.5) 조건으로 일어나는 연쇄: 때가 됐는데 조건이 맞지 않는다 — 기한이 지났으면 버리고, 아니면 5초 뒤 다시 본다 (이번 틱에는 다른 예약도 꺼내지 않는다)
        if (c.until !== undefined && sim.t >= c.until) { g.chain.splice(k, 1); g.dropped.push({ t: sim.t, why: 'expired', type: c.opts.type, variant: c.opts.variant, parent: c.opts.parent, csq: c.opts.csq }); }
        else c.at = sim.t + 5;
      } else {
        g.chain.splice(k, 1);
        const late = sim.t >= sim.shiftLen - 150;
        // (I1-b b1) 깊이 상한(chain.DEPTH_MAX — 정본은 canChain): 예약하는 자리가 모두 canChain 을 보므로 지금은 걸리지 않는다. 그 확인 없이 예약한 것이 있어도 사슬이 더 길어지지 않게 꺼낼 때 한 번 더 본다
        const deep = c.opts.parent !== undefined && chainDepth(sim, c.opts.parent) + 1 > DEPTH_MAX;
        // (I1-b b3-4) 법칙이 낸 사건(opts.hz)의 건물이 예약과 꺼냄 사이에 전소·전체 붕괴했다: 만들지 않는다 — createIncident 는 그런 건물이면 그 유형의 다른 건물을 다시 고르는데,
        // 그 갈래를 타면 원인은 옆 건물의 불·정전인데 자리는 무관한 건물인 기록이 남는다 (§3.6a "건물에 내는 사건의 공통 조건")
        const gone = c.opts.hz !== undefined && c.opts.placeId !== undefined && placeGone(sim, c.opts.placeId);
        if (!late && open <= tn.maxConcurrent && !deep && !gone) { const J = createIncident(sim, c.opts); if (c.log !== undefined) { const rec = sim.world.log[c.log]; if (rec) rec.made = J.id; } }      // 인과 규칙이 예약한 사건: 그 결과 줄에 만든 사건을 적는다
        else g.dropped.push({ t: sim.t, why: late ? 'late' : open > tn.maxConcurrent ? 'busy' : deep ? 'depth' : 'expired', type: c.opts.type, variant: c.opts.variant, parent: c.opts.parent, csq: c.opts.csq });      // (I1-b) 버린 예약은 배열에만 (기록은 남기지 않는다)
      }
    }
  }
  // 대형 사고: 교대마다 많아야 한 번. 언제·무엇인지는 별도의 난수 흐름으로 정한다 (평소 사건의 추첨을 흔들지 않는다)
  if (sim.t >= g.majorAt) {
    if (sim.t >= sim.shiftLen - 240) g.majorAt = Infinity;
    else if (open > tn.maxConcurrent) g.majorAt = sim.t + 20;
    else {
      g.majorAt = Infinity;
      const cs = SCENARIOS.filter((q) => q.tag === 'major' && (!q.gate || q.gate(sim)));
      if (cs.length) { const q = sim.rngMajor.weighted(cs, cs.map((c) => c.share)); createIncident(sim, { type: q.type, variant: q.variant, rng: sim.rngMajor }); }
    }
  }
  // 강제 발생: 시험·확인용 (sweep --force, 주소의 ?force=). 교대 시작 15초 뒤에 그 시나리오를 한 번 일으킨다
  if (sim.force && !g.forced && sim.t >= 15) {
    g.forced = true;
    const [ft, fv] = sim.force.split('/');
    createIncident(sim, { type: ft as IncidentType, variant: fv || undefined, rng: sim.rng.fork('force') });
  }
  // 생성: 진행 중인 사건 수와 가용 자원에 어느 정도 영향을 받는다
  if (sim.t >= sim.shiftLen - 150 || g.count >= tn.maxIncidents) return;
  if (sim.t < g.nextAt) {
    if (open === 0 && g.count > 0 && sim.t - g.lastCreated > 75 && g.nextAt - sim.t > 25) g.nextAt = sim.t + sim.rngGen.range(8, 22);
    return;
  }
  if (open >= tn.maxConcurrent) { g.nextAt = sim.t + 18; return; }
  const avail = sim.units.filter((u) => u.state === 'available').length;
  if (open >= tn.maxConcurrent - 1 && avail <= 3) { g.nextAt = sim.t + 22; return; }
  createIncident(sim);
  g.count++; g.lastCreated = sim.t;
  g.nextAt = sim.t + sim.rngGen.range(50, 108) * tn.gapMul * (avail <= 5 ? 1.2 : 1) * disasterGapMul(sim);      // 조직이 커진 만큼 사건도 잦다 (보통에서 교대당 12건쯤)
}

export function closeIncident(sim: Sim, I: Incident, reason: 'resolved' | 'timeout' | 'noresponse' | 'abandoned' | 'shiftend'): void {
  if (I.phase === 'closed') return;
  const s = sim.scenes[I.id]!;
  settleInjuries(sim, s, I);      // (H1) 판정 직전에 밀린 대원의 상태 전이를 마친다 — 판정 뒤에는 전이가 없다
  I.phase = 'closed'; I.closedAt = sim.t; I.closeReason = reason;
  divertUnmet(sim, I);      // (I1-b C6) 빼앗긴 부대의 자리를 끝내 아무도 메우지 못했다: 닫힌 시각까지를 DIVERTED 의 ref.lost 에 (기록은 남기지 않는다)
  s.closing = true;
  I.unmet = {};
  if (I.blockedEdge >= 0) {
    const e = sim.city.edges[I.blockedEdge];
    e.slow = Math.max(0, e.slow - 1.4);
    if (e.closedReason === 'incident') { e.closed = false; e.closedReason = null; }
  }
  for (const c of sim.calls) if (c.incidentId === I.id && c.state === 'ringing') c.state = 'done';
  for (const uid of I.assigned.slice()) {
    const u = sim.units[uid];
    if (u.state === 'enroute' || u.state === 'turnout') {
      const wasTurnout = u.state === 'turnout';
      releaseUnit(sim, u);
      if (wasTurnout) u.state = 'available';
      emit(sim, { inc: I.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 0, text: `${u.callsign} 출동 취소 — 사건 ${I.code} 종료.` });
    }
  }
  I.result = evaluate(sim, I, reason);
  scenarioOf(I.truth.type, I.truth.variant)?.onClose?.(sim, I, reason);
  const closeEv = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '사건 관리', kind: 'resolve', imp: 3, causes: [I.lastEvent], text: `사건 ${I.code} 종료 — ${OUTCOME_NAME[I.result.outcome]}. ${I.result.headline}` });
  signal(sim, 'closed', { inc: I.id, ev: closeEv, place: I.truth.placeId });      // (I1-b) 종료 기록 다음 — 남는 잔해·재발화 같은 "사건이 끝난 뒤" 의 규칙이 받는다
  noteClosedPlace(sim, I);      // (X6 §7.1) 실제 건물의 화재가 닫혔고 건물 상태가 없는데 15% 넘게 탔으면 그을린 건물
}
