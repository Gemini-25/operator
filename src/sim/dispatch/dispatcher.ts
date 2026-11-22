// AI Dispatch Coordinator — 필요한 능력별로 가장 적합한 부대를 고른다.
// 가장 가까운 부대가 아니라 (적합도 × 가중치 − 예상 도착 시간 − 피로·장비 상태 − 다른 사건 대비)로 점수를 매긴다.

import type { Sim } from '../engine';
import { emit, markRecovered, raiseProblem } from '../events';
import { hazardSign, transmit } from '../field/agents';
import { mkFact } from '../field/beliefs';
import { mountainAt, nodeName } from '../city';
import { crewHasKit, fieldCrew } from '../crews';
import { coastal, createAidUnit, crewOk, crewReady, dispatchUnit, etaFor, sendUnitTo } from '../resources';
import type { Claim, Incident, KitId, Needs, Problem, RadioMsg, Scene, Unit, UnitKind } from '../types';
import { TYPE_NAME, fmtSec, josa } from '../util';
import { assess, emptyNeeds, needsText, sevName } from './analyst';
import { dispatchPref } from './doctrine';      // (R3 §6.2) 관제 교본의 부대 고르기 가산
import { recordDoc } from '../field/doctrineRun';
import { noteDivert } from '../world/rules/record';      // (I1-b C6) 전환 배정의 실제 영향 — 기록만
/** (R3) 이번 고르기에서 교본 가산을 받은 부대와 그 줄 (pickUnit 안에서만 — 부대 객체의 모양을 바꾸지 않으려 WeakMap) */
const prefOf = new WeakMap<Unit, string>();

const ORDER: (keyof Needs)[] = ['eod', 'tactical', 'law', 'suppression', 'rescue', 'ems', 'traffic', 'search',
  'utilPower', 'utilGas', 'utilWater', 'tow', 'capture',      // (N8 §5.3.5) 새 수요 다섯은 끝에 — 기존 배정 순서 그대로
  'decon'];      // (N9 §5.3.1) 제독 — N8 의 다섯 다음 끝에
const MINCAP: Record<keyof Needs, number> = { suppression: 0.7, rescue: 0.5, ems: 0.7, law: 0.5, tactical: 0.9, search: 0.3, traffic: 0.4, eod: 0.9, utilPower: 0.7, utilGas: 0.7, utilWater: 0.7, tow: 0.7, capture: 0.7, decon: 0.7 };      // (N9) 제독 0.7 — 후보는 제독차(1.0)와 화학 구조차(0.7)
const NEED_LABEL: Record<keyof Needs, string> = { suppression: '진압', rescue: '구조', ems: '구급', law: '경찰', tactical: '경찰 기동', search: '수색', traffic: '교통 통제', eod: '폭발물 처리',
  utilPower: '전력 복구', utilGas: '가스 복구', utilWater: '수도 복구', tow: '견인', capture: '동물 포획', decon: '제독' };

/** 평가된 수요에서 이미 배정된 부대가 덮는 부분을 빼고 남은 수요를 계산한다. */
export function recomputeUnmet(sim: Sim, I: Incident): void {
  if (!I.assessment) return;
  const needs = I.assessment.needs;
  const used = new Set<number>();
  const unmet: Partial<Needs> = {};
  let any = false;
  for (const key of ORDER) {
    for (let k = 0; k < needs[key]; k++) {
      let best = -1, bc = 0;
      for (const uid of I.assigned) { if (used.has(uid)) continue; const c = sim.units[uid].caps[key]; if (c >= MINCAP[key] && c > bc) { bc = c; best = uid; } }
      if (best >= 0) used.add(best); else { unmet[key] = (unmet[key] ?? 0) + 1; any = true; }
    }
  }
  const had = ORDER.some((k) => (I.unmet[k] ?? 0) > 0);
  I.unmet = unmet;
  if (any && !had) { I.unmetSince = sim.t; I.noUnitLogged = false; }
}

function priorityOf(sim: Sim, I: Incident): number {
  const s = sim.scenes[I.id];
  // 현장의 급한 요청은 부대가 배정된 순간이 아니라 닿을 때까지 급하다 (배정되자마자 순위가 떨어져 전환 배정에 빼앗기지 않도록)
  const coming = I.assigned.some((uid) => sim.units[uid].state === 'enroute' || sim.units[uid].state === 'turnout');
  const urgent = s ? s.requests.some((q) => q.urgent && (q.fulfilled < q.count || (coming && sim.t - q.t < 240))) : false;
  // 오래 굶은 수요: 부대가 모자란 교대에서는 새로 들어온 위험한 사건이 늘 앞에 서서, 먼저 기다리던 사건이 끝내 부대를 받지 못한다.
  // 채워지지 않은 수요가 오래 밀릴수록 앞으로 당긴다. 아직 아무 부대도 닿지 않은 사건은 신고 전화가 울린 때부터 센다
  // (접수 대기열에서 기다린 시간도 신고자에게는 똑같이 흘렀다). 부대가 가는 중에도 그대로 두어, 오래 기다린 사건으로 가는 부대가
  // 더 급해 보이는 새 사건으로 전환 배정되지 않게 한다
  const unmet = ORDER.some((k) => (I.unmet[k] ?? 0) > 0);
  // 선착 대응 부대만 닿은 응급 환자는 아직 구급차를 기다리는 사건이다 (구급대원이 닿기 전까지는 아무도 닿지 않은 사건처럼 센다)
  const unserved = I.firstArrivalAt < 0 || (I.coResp !== undefined && !!s && !s.agents.some((a) => sim.units[a.unitId].dept === 'ems'));
  const starved = unserved ? Math.max(unmet ? sim.t - I.unmetSince : 0, sim.t - Math.max(0, I.reportedAt) - 60) : unmet ? sim.t - I.unmetSince - 40 : 0;
  const starve = Math.min(1.5, Math.max(0, starved) / (unserved ? 60 : 160));
  return (I.assessment ? I.assessment.severity : 1) + (urgent ? 0.6 : 0) + Math.min(0.5, (sim.t - Math.max(0, I.reportedAt)) / 240) + starve;
}

interface Cand { u: Unit; score: number; eta: number; fit: number; divertFrom: Incident | null; doc?: string }      // doc: (R3 §6.2) 관제 교본의 가산이 이 부대를 고르게 했다 (그 줄 — sendUnit 이 지령 기록과 함께 센다)
/** 무거운 일이 필요한 수요: 걸을 수 있는 다친 대원만 남은 부대가 1순위로 가지 않는다 (경찰·교통 통제 수요는 봉쇄·협상·면담·교통 통제로 할 수 있어 넣지 않는다) */
const HEAVY_NEED: ReadonlySet<keyof Needs> = new Set<keyof Needs>(['suppression', 'rescue', 'ems', 'tactical', 'search', 'eod']);

/**
 * 장비 가산: 그 사건에 맞는 장비를 든 대원이 있는 부대를 조금 앞세운다 — 수난 사고의 구조 수요에는 구조 로프·구명환(+12),
 * 붕괴의 구조 수요에는 탐지 장비(+8). 관제가 아는 것만 본다: 평가한 유형과 자기 조직의 편성·장비(hasKit — 숨은 고장은 모른다).
 */
export function kitBonus(sim: Sim, u: Unit, I: Incident, key: keyof Needs): number {
  let b = 0;
  if (key === 'rescue') {
    const type = I.assessment!.type;
    if (type === 'water') b = crewHasKit(sim, u, 'rope') || crewHasKit(sim, u, 'ring') ? 12 : 0;
    else if (type === 'collapse') b = crewHasKit(sim, u, 'searchKit') ? 8 : 0;
  }
  // (N8 §5.3.4) 이름표 가점: 관제가 붙인 이름표(신고자가 정확한 말을 했을 때만)와 수요 열쇠가 맞으면 그 종류·그 장비의 부대를 앞세운다
  if (LABEL_BONUS.length) {
    const label = I.assessment!.label;
    if (label !== undefined) for (const row of LABEL_BONUS) if (row.label === label && row.key === key && (row.kind === undefined || row.kind === u.kind) && (row.kit === undefined || crewHasKit(sim, u, row.kit))) b += row.bonus;
  }
  return b;
}
/**
 * (N8 §5.3.4) 이름표 가점의 표 — 단계 2b 에는 비어 있다(줄을 내는 시나리오가 없다). 줄은 그 시나리오를 넣는 단계가 끝에 붙인다:
 * '떨어질 듯한 간판'·'외벽 작업자 고립'·'멈춘 놀이기구' → suppression · ladder +12 · '가축 탈출' → traffic · trafficPol +8 · '날치기' → search · k9 +10, law · detective +10 ·
 * '수거책 잠복' → law · detective +15 · '치매 노인 실종' → search · k9 +10 · '출산 임박' → ems · alsBag +8 · '위기자' → rescue · jumpMat +20 · '싱크홀' → rescue · rescue(부대) +15 ·
 * '떨어질 듯한 간판' → rescue · rope +10. 기존 두 줄(수난·붕괴의 구조 수요)은 위에 글자 그대로 둔다
 */
/** (N8 §5.3.8) 유관 기관의 수요 열쇠 — 시설 사고가 아닌 사건에서는 선택 수요다 */
const CIVIL_KEYS: ReadonlySet<keyof Needs> = new Set<keyof Needs>(['utilPower', 'utilGas', 'utilWater', 'tow']);
export const LABEL_BONUS: { label: string; key: keyof Needs; kind?: UnitKind; kit?: KitId; bonus: number }[] = [
  // ── (N8 §5.3.4 — 단계 4b) 시설 사고의 이름표: 떨어질 듯한 간판의 진압 수요에 사다리차, 구조 수요에 로프 · 싱크홀의 구조 수요에 구조대 ──
  { label: '떨어질 듯한 간판', key: 'suppression', kind: 'ladder', bonus: 12 }, { label: '싱크홀', key: 'rescue', kind: 'rescue', bonus: 15 }, { label: '떨어질 듯한 간판', key: 'rescue', kit: 'rope', bonus: 10 },
  // ── (N9 §5.3.3) 큰 사건의 이름표 — 단계 2 에 줄을 넣는다. 이름표를 내는 시나리오(N9 단계 4~9)가 아직 없고, 줄이 앞세우는 새 부대는 편성되지 않았다 —
  //    걸리는 줄이 없어 결과가 바뀌지 않는다('집단 난동'(폭동 — 지금 있는 이름표)의 줄은 기동대에만 붙는다). 이름표는 설계서 §4.0 의 글자 그대로 ──
  { label: '압사 위험', key: 'law', kind: 'riotPol', bonus: 25 }, { label: '시위 충돌', key: 'law', kind: 'riotPol', bonus: 25 },
  { label: '행사장 환자 다발', key: 'law', kind: 'riotPol', bonus: 25 }, { label: '집단 난동', key: 'law', kind: 'riotPol', bonus: 25 },
  { label: '여객선 사고', key: 'rescue', kit: 'diveKit', bonus: 15 }, { label: '어선 사고', key: 'rescue', kit: 'diveKit', bonus: 15 }, { label: '침수 지하차도', key: 'rescue', kit: 'diveKit', bonus: 15 },
  { label: '밀폐 공간 질식', key: 'rescue', kit: 'gasMeter', bonus: 15 }, { label: '일산화탄소 중독', key: 'rescue', kit: 'gasMeter', bonus: 15 },
  { label: '화학 탱크로리', key: 'rescue', kind: 'hazmat', bonus: 20 },
  { label: '기계 끼임', key: 'ems', kit: 'alsBag', bonus: 8 },
  { label: '금고털이', key: 'search', kind: 'k9', bonus: 10 }, { label: '금고털이', key: 'law', kind: 'detective', bonus: 10 },
  { label: '강풍 낙하물', key: 'suppression', kind: 'ladder', bonus: 12 },
  { label: '기름 유출', key: 'rescue', kit: 'oilBoom', bonus: 20 }, { label: '기름 유출', key: 'rescue', kit: 'plugKit', bonus: 15 },
  { label: '산악 조난', key: 'rescue', kit: 'mtnKit', bonus: 20 }, { label: '산악 조난', key: 'search', kit: 'mtnKit', bonus: 20 },
];

/** (N8 §5.3.4) 일을 kindFit 으로 좁히는 새 부대 — 관제 기준을 넘는 보조 능력이 평소 사건의 수요에 끼어들지 않게 */
export const KIND_AUX: ReadonlySet<UnitKind> = new Set<UnitKind>(['animalCtl', 'detective', 'trafficPol', 'k9',
  'mtnRescue', 'dive', 'deconUnit', 'riotPol']);      // (N9 §5.3.2) 산악·수중·제독·기동대 — 산악의 수색 0.85·수중의 구조 0.8·기동대의 경찰 0.9 가 기준을 넘는다
/** 경찰견이 나가는 수색 수요의 평가 유형 (보호·치안은 그 유형이 생기는 단계 6a·7 부터 걸린다 — 글자로 둔다) */
const K9_TYPES: ReadonlySet<string> = new Set<string>(['search', 'welfare', 'disturb']);
/** 형사가 나가는 경찰 수요의 평가 유형 (치안 — 단계 6a 부터) */
const DETECTIVE_TYPES: ReadonlySet<string> = new Set<string>(['disturb']);
/** (N9 §5.3.2) 수중 구조대가 나가는 이름표 (평가 유형 수난 밖 — 선박 화재는 화재, 지하차도·여객선·어선의 흐릿한 평가) */
const DIVE_LABELS: ReadonlySet<string> = new Set<string>(['침수 지하차도', '여객선 사고', '선박 화재', '어선 사고']);
/** (N9 §5.3.2) 산 — 신고 교차로가 이만큼 산 안쪽이면 산악 구조대가 실종·구조 사건에 0.6 으로 나간다 (지도는 공개된 지형이다 — staticCity 가 터널 입구를 그리는 값과 같다) */
const MTN_AT = 0.35;
/**
 * (N8 §5.3.4) 새 부대를 이 사건의 이 수요에 보내는가 — 0 이면 보내지 않고, 아니면 적합도에 곱하는 값 (airFit 과 같은 꼴). 관제가 아는 것(평가 유형)만 읽는다.
 *  형사: 평가 유형이 치안인 사건의 경찰 수요만 · 경찰견: 실종·보호·치안의 수색 수요만(응급의 선착 대응·무장의 경찰 수요에 나가지 않는다)
 *  교통 경찰: 교통 수요만(모든 유형 — 교통 통제는 그 부대의 본래 일이다) · 동물 포획팀: 동물 포획 수요만. 유관 기관은 자기 열쇠 말고는 능력이 0 이라 따로 거르지 않는다
 *  (N9 §5.3.2) 산악 구조대: 이름표 '산악 조난' 의 구조·수색 1, 산의 교차로로 신고된 실종·구조 유형 0.6 · 수중 구조대: 수난 유형이거나 네 이름표의 구조·수색 ·
 *  제독차: 제독 수요만 · 기동대: 군중 유형이거나 이름표 '집단 난동'(폭동)의 경찰·교통 수요만(기동 0.85 는 기준 밑이라 기동 수요의 후보가 되지 않는다) ·
 *  형사·경찰견: 이름표 '금고털이'(무장 유형)의 경찰·수색 수요에도
 */
export function kindFit(sim: Sim, u: Unit, I: Incident, key: keyof Needs): number {
  const type: string = I.assessment!.type;
  switch (u.kind) {
    case 'detective': return key === 'law' && (DETECTIVE_TYPES.has(type) || I.assessment!.label === '금고털이') ? 1 : 0;      // (N9) 금고털이는 무장 유형이다
    case 'k9': return key === 'search' && (K9_TYPES.has(type) || I.assessment!.label === '금고털이') ? 1 : 0;
    case 'trafficPol': return key === 'traffic' ? 1 : 0;
    case 'animalCtl': return key === 'capture' ? 1 : 0;
    // ── (N9 §5.3.2) 새 부대 넷. 관제가 아는 것(평가 유형·이름표·신고 위치의 지형)만 읽는다. 유형 'rescue'·'crowd' 는 N8·N9 가 더할 유형이라 글자로 견준다 ──
    case 'mtnRescue': {
      if (key !== 'rescue' && key !== 'search') return 0;
      if (I.assessment!.label === '산악 조난') return 1;
      if (type !== 'search' && type !== 'rescue') return 0;
      const n = sim.city.nodes[I.reportedNode];
      return n && mountainAt(n.x, n.y) >= MTN_AT ? 0.6 : 0;
    }
    case 'dive': return (key === 'rescue' || key === 'search') && (type === 'water' || DIVE_LABELS.has(I.assessment!.label ?? '')) ? 1 : 0;
    case 'deconUnit': return key === 'decon' ? 1 : 0;
    case 'riotPol': return (key === 'law' || key === 'traffic') && (type === 'crowd' || I.assessment!.label === '집단 난동') ? 1 : 0;
    default: return 1;
  }
}
/** (N8 §5.3.4) 예비 부대 셈에서 빼는 부대: 유관 기관과 일을 좁힌 새 부대 (포획팀이 소방 예비로 세어져 마지막 펌프차가 나가지 않게) */
export const notSpare = (u: Unit): boolean => u.dept === 'civil' || KIND_AUX.has(u.kind);

/** 추격전으로 평가한 사건의 관제 이름 (scenarios 의 납치·도주 차량) */
const CHASE_LABEL: Record<string, boolean> = { '납치': true, '도주 차량': true };
/** 의료 헬기를 띄우는 문턱: 가용 지상 구급 부대 가운데 가장 빠른 것의 예상 도착이 이보다 늦다 (초). 너무 자주 뜨면 올린다 */
const MED_HELI_ETA = 100;
/**
 * 헬기를 이 사건의 이 수요에 보내는가 — 0 이면 보내지 않고, 아니면 적합도에 곱하는 값 (설계서 R1 7.2).
 * 헬기의 일은 이 함수가 정한다: u.air 만 보고 보내면 경찰 헬기가 환자를 싣거나 의료 헬기가 수색에 뜬다.
 * 관제가 아는 것만 읽는다: 평가(I.assessment), 날씨, 자기 조직의 부대 상태(뜰 수 없는 이유·연료·위치), 헬기가 알린 '상공 임무 종료'(I.airDone), 접수한 현장 요청.
 *  - 모든 헬기: 뜰 수 없거나(안개·밤·강풍), 연료가 다녀올 만큼 남지 않았거나, 이 사건에서 이미 상공 임무를 마치고 돌아갔으면 0
 *  - 경찰 헬기: 수색 수요만 — 추격전(납치·도주 차량)과 무장·실종 사건은 1, 수난·붕괴·화재는 0.5(산불은 0). 현장 상공에 머물며 살핀다
 *  - 소방 헬기: 수색 수요는 실종·수난·붕괴·화재(산불은 낮 1.2, 밤에는 뜨지 않는다), 구조 수요는 위험도 2.3 이상이거나 수난 사고.
 *    구급 수요는 의료 헬기가 없는 편성(부대 규모 1·2 — 그때만 구급 능력이 기준을 넘는다)에서만, 큰 사건이거나 구급차를 60초 넘게 기다렸을 때
 *  - 의료 헬기: 구급 수요 — 밤이 아니고, 위험도 2.3 이상이거나 구급차를 60초 넘게 기다렸거나 현장이 급히 구급을 요청했거나 지상 구급차가 멀 때
 */
export function airFit(sim: Sim, u: Unit, I: Incident, key: keyof Needs): number {
  if (u.grounded) return 0;
  if (sim.disaster !== null && sim.disaster.kind === 'typhoon' && sim.disaster.phase === 'impact') return 0;      // 강풍이 닥친 바로 그 틱 (u.grounded 는 이 뒤의 tickUnits 가 적는다)
  if ((u.fuel ?? 0) < etaFor(sim, u, I.reportedNode) * 2 + 90) return 0;
  if (I.airDone && I.airDone.indexOf(u.kind) >= 0) return 0;
  const as = I.assessment!, type = as.type, night = sim.weather === 'night';
  if (u.kind === 'policeHeli') {
    if (key !== 'search') return 0;
    if (CHASE_LABEL[as.label ?? '']) return 1;
    if (type === 'armed' || type === 'search') return 1;      // 무장·실종 현장 상공의 관측 (밤에는 탐조등)
    if (type === 'water' || type === 'collapse' || type === 'fire') return as.label === '산불' ? 0 : 0.5;      // 바깥을 살필 눈. 산불은 물 바구니를 단 소방 헬기의 일이다
    return 0;      // 응급 환자의 선착 대응 등
  }
  if (u.kind === 'heli') {      // 소방 헬기
    if (key === 'search') {
      if (type !== 'search' && type !== 'water' && type !== 'collapse' && type !== 'fire') return 0;      // 무장 사건·응급 환자의 선착 대응에는 뜨지 않는다
      return as.label === '산불' ? (night ? 0 : 1.2) : 1;
    }
    if (key === 'rescue') return as.severity >= 2.3 || type === 'water' ? 1 : 0;
    // 구급 수요: 의료 헬기가 편성돼 있으면 그쪽의 일이다(소방 헬기의 구급 능력은 기준 밑이라 여기까지 오지 않는다).
    // 의료 헬기가 없는 편성(부대 규모 1·2)에서만 예전 규칙대로 — 큰 사건이거나 구급차를 60초 넘게 기다린 환자에게 뜬다
    if (key === 'ems') return u.caps.ems >= MINCAP.ems && (as.severity >= 2.3 || sim.t - I.unmetSince > 60) ? 1 : 0;
    return 0;
  }
  if (u.kind === 'medHeli') {
    if (key !== 'ems' || night) return 0;
    if (as.severity >= 2.3 || sim.t - I.unmetSince > 60) return 1;
    const s = sim.scenes[I.id];
    if (s) for (let k = 0; k < I.fieldNeedsSeen && k < s.requests.length; k++) { const q = s.requests[k]; if (q.need === 'ems' && q.urgent && q.fulfilled < q.count) return 1; }      // 관제가 접수한 급한 구급 요청이 아직 채워지지 않았다
    let near = Infinity;
    for (const q of sim.units) {
      if (q.air || q.caps.ems < MINCAP.ems || (q.state !== 'available' && q.state !== 'returning') || crewReady(sim, q) === 0 || I.assigned.indexOf(q.id) >= 0) continue;
      near = Math.min(near, etaFor(sim, q, I.reportedNode));
    }
    return near > MED_HELI_ETA ? 1 : 0;      // 지금 보낼 수 있는 지상 구급차가 없거나 멀다
  }
  return 0;
}

function pickUnit(sim: Sim, I: Incident, key: keyof Needs, minCap: number): { best: Cand | null; nearest: Cand | null } {
  const sev = I.assessment!.severity;
  const cands: Cand[] = [];
  for (const u of sim.units) {
    let fit = u.caps[key];
    if (fit < minCap || crewReady(sim, u) === 0 || u.state === 'oos') continue;
    if (u.sea && !((I.assessment!.type === 'water' || I.assessment!.label === '선박 화재') && coastal(sim, I.reportedNode))) continue;      // 구조정은 바닷가의 수난 사고와 선박 화재에만 나간다
    if (I.assigned.indexOf(u.id) >= 0) continue;
    if (u.air) { const m = airFit(sim, u, I, key); if (m <= 0) continue; fit *= m; }      // 헬기는 종류마다 맡는 수요가 다르다 (airFit)
    if (KIND_AUX.has(u.kind)) { const m = kindFit(sim, u, I, key); if (m <= 0) continue; fit *= m; }      // (N8) 새 부대는 자기 일만 (kindFit)
    let divertFrom: Incident | null = null;
    if (u.state === 'enroute' || u.state === 'turnout') {
      const J = u.incidentId !== null ? sim.incidents[u.incidentId] : null;
      if (!J || u.diverted || sev < 2.3) continue;
      // 방금 부대를 빼앗긴 사건에서는 다시 빼 오지 않는다 (번갈아 빼앗기면 그 사건에는 끝내 아무도 닿지 못한다)
      if (J.problems.some((p) => p.code === 'DIVERTED' && sim.t - p.t < 120)) continue;
      const gap = I.priority - J.priority;
      if (gap < (J.assigned.filter((uid) => uid !== J.coResp).length > 1 ? 0.9 : 1.4)) continue;      // 선착 대응으로 함께 간 소방차는 세지 않는다 (그 사건의 하나뿐인 구급차를 쉽게 빼앗지 않게)
      divertFrom = J;
    } else if (u.state !== 'available' && u.state !== 'returning') continue;
    const eta = etaFor(sim, u, I.reportedNode);
    const fc = fieldCrew(sim, u);      // 현장에 내리는 자리만 본다 (조종사·정장 때문에 늘 감점되지 않게)
    let stamina = 0; for (const rid of fc) stamina += sim.responders[rid].stamina; stamina /= fc.length;
    let score = fit * 100 - eta * (0.45 + 0.22 * sev) - (100 - stamina) * 0.22;
    if (key === 'suppression' && u.pumpCond < 0.4) score -= 10;
    // 결원: 온전한 대원이 정원보다 적으면 한 번 감점한다 (다쳤거나 일부가 숨진 부대도 계속 나간다 — H1 §3.6).
    // 걸을 수 있는 다친 대원만 남은 부대는 가벼운 일만 할 수 있으므로 무거운 일이 필요한 수요에는 더 뒤로 미룬다 — 빼지는 않는다(다른 후보가 없으면 간다).
    // 관제가 읽는 것은 자기 조직의 대원 상태(명부)뿐이다
    const ok = crewOk(sim, u);
    if (ok < fc.length) score -= 18;
    if (ok === 0 && HEAVY_NEED.has(key)) score -= 25;
    score += kitBonus(sim, u, I, key);
    if (divertFrom) score -= 28;
    const pref = dispatchPref(sim, I, u, key);      // (R3 §6.2) 관제 교본의 가산 (D2)
    if (pref.add !== 0) { score += pref.add; prefOf.set(u, pref.rule!); } else prefOf.delete(u);
    // 같은 부서의 마지막 가용 부대라면, 위험도가 낮은 사건에는 아껴 둔다.
    // 헬기는 '남은 부대'로 세지 않고(경찰·의료 헬기가 남아 있다고 지상 부대를 다 내보내지 않게), 헬기 자신에게도 걸지 않는다
    if (!u.air && sev < 1.9 && !notSpare(u)) {      // (N8) 유관 기관·새 부대는 감점하지 않고 남은 부대로도 세지 않는다
      const others = sim.units.filter((q) => q.dept === u.dept && q.id !== u.id && !q.air && !notSpare(q) && (q.state === 'available' || q.state === 'returning') && crewReady(sim, q) > 0).length;
      if (others === 0) score -= 9;
    }
    cands.push({ u, score, eta, fit, divertFrom });
  }
  if (!cands.length) return { best: null, nearest: null };
  let best = cands[0], nearest = cands[0], base = cands[0], baseS = -Infinity;
  for (const c of cands) {
    if (c.score > best.score) best = c; if (c.eta < nearest.eta) nearest = c;
    const r = prefOf.get(c.u), s0 = r !== undefined ? c.score - dispatchPref(sim, I, c.u, key).add : c.score;      // 교본 가산 전의 점수
    if (s0 > baseS) { baseS = s0; base = c; }
  }
  // (R3 §2.7 의 '쓰였다') 교본 가산이 고른 부대를 바꾸었으면: 밀려난 부대에 걸린 줄(감점) 또는 뽑힌 부대에 걸린 줄(가산)
  if (base !== best) { const r = prefOf.get(base.u) ?? prefOf.get(best.u); if (r !== undefined) best.doc = r; }
  return { best, nearest };
}

function sendUnit(sim: Sim, I: Incident, key: keyof Needs, c: Cand, nearest: Cand | null): void {
  const u = c.u;
  if (c.divertFrom) {
    const J = c.divertFrom;
    const k = J.assigned.indexOf(u.id); if (k >= 0) J.assigned.splice(k, 1);
    u.diverted = true;
    // (I1-b 0단계) 원인 = 받는 사건의 마지막 기록(사건 사이 원인 간선), ref = 받는 사건·부대 — 기록만
    const dev = raiseProblem(sim, J, 'DIVERTED', `${josa(u.callsign, '이/가')} 더 긴급한 사건 ${josa(I.code, '으로/로')} 전환 배정`, { role: 'DISPATCH', actor: '배정 AI', imp: 2, causes: [I.lastEvent], text: `${josa(u.callsign, '을/를')} 더 긴급한 사건 ${josa(I.code, '으로/로')} 전환 배정합니다. 사건 ${josa(J.code, '은/는')} 대체 부대를 찾습니다.` }, false, { inc: I.id, unit: u.id });
    noteDivert(sim, J, u, dev);      // (I1-b C6) 빼앗긴 부대의 예정 도착을 J 에 기억한다 — 아래의 dispatchUnit 이 그 값을 새 사건의 것으로 덮어쓰기 전에. 기록만 (배정 판단은 읽지 않는다)
    if (!J.fieldVerified) recomputeUnmet(sim, J); else { J.unmet[key] = (J.unmet[key] ?? 0) + 1; J.unmetSince = sim.t; J.noUnitLogged = false; }
  }
  const first = I.firstDispatchAt < 0;
  dispatchUnit(sim, u, I, c.eta);
  if (u.air) u.airNeed = key;      // 헬기가 이번 출동에서 맡은 수요: 연료·강풍으로 돌아가면 resources.airRtb 가 이 수요를 되돌린다
  let why = `${I.assessment!.type === 'medical' && key === 'search' ? '선착 대응' : NEED_LABEL[key]} 수요, 적합도 ${Math.round(c.fit * 100)}%, 예상 도착 ${fmtSec(c.eta)}`;
  if (nearest && nearest.u.id !== u.id && nearest.eta < c.eta - 5) why += `. 더 가까운 ${nearest.u.callsign}(${fmtSec(nearest.eta)})보다 ${c.fit > nearest.fit ? '전문성이 높아' : '상태가 좋아'} 선택`;
  const ev = emit(sim, { inc: I.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 2, causes: [I.lastEvent], text: `출동 지령: ${u.callsign} → 사건 ${I.code} (${TYPE_NAME[I.assessment!.type]}, 위험도 ${sevName(I.assessment!.severity)}). ${why}.` });
  I.dispatchLog.push(ev);
  if (c.doc !== undefined) recordDoc(sim, I, null, c.doc, 'dispatch', {}, ev);      // (R3 §6.2) 관제 교본이 바꾼 고르기
  if (first) {
    I.firstDispatchAt = sim.t;
    I.firstAssess = { type: I.assessment!.type, severity: I.assessment!.severity, t: sim.t, eventId: ev };
  }
  if (I.phase === 'call' || I.phase === 'pending') I.phase = 'dispatched';
  const s = sim.scenes[I.id];
  if (s) for (const q of s.requests) if ((q.need === key || (key === 'law' && q.need === 'tactical')) && q.fulfilled < q.count) { q.fulfilled++; break; }
  if (I.noUnitLogged) {
    const wait = sim.t - I.unmetSince;
    const pe = markRecovered(I, 'NO_UNIT', `${Math.round(wait)}초 뒤 ${u.callsign} 배정`);
    if (wait > 40) raiseProblem(sim, I, 'BACKUP_LATE', `${NEED_LABEL[key]} 지원이 ${Math.round(wait)}초 늦게 배정됨`, { role: 'DISPATCH', actor: '배정 AI', imp: 1, causes: [pe], text: `${NEED_LABEL[key]} 지원이 요청 후 ${Math.round(wait)}초 만에 배정됐습니다.` }, false);
  }
}

/**
 * 중증 응급 환자의 선착 대응(동시 출동, '펌뷸런스'): 구급차가 모두 나가 있거나 멀면, 가장 가까운 소방 펌프차·사다리차·구조대를 함께 보낸다.
 * 소방대원은 기본 처치(지혈·가슴 압박)를 할 수 있다(지휘관: 응급 환자는 누구든 먼저 손을 쓴다). 구급차는 따로 계속 찾고, 닿으면 넘긴다.
 * 순찰차는 보내지 않는다 (호흡이 없는 환자에게는 analyst 가 선착 대응 수요로 가장 가까운 부대를 이미 함께 보낸다).
 * 관제가 아는 것만 쓴다: 부대의 위치·상태와 신고된 위치(I.reportedNode). 다른 사건에서 빼 오지 않고, 그 분야의 마지막 가용 부대는 남겨 둔다.
 */
export const CO_RESPOND = {
  sev: 1.7,      // 중증으로 본 환자에게만 (의식 없음·낙상 출혈·호흡 없음). 가벼운 실신에는 구급차를 기다린다
  eta: 50,       // 가장 나은 구급차의 예상 도착이 이보다 늦으면(또는 가용 구급차가 없으면) 선착 대응을 붙인다 (초)
  gain: 15,      // 선착 대응 부대가 구급차보다 적어도 이만큼 먼저 닿아야 보낸다 (초)
};
function firstResponder(sim: Sim, I: Incident): void {
  if (I.assessment!.severity < CO_RESPOND.sev) return;
  const amb = pickUnit(sim, I, 'ems', MINCAP.ems).best;
  if (amb && amb.eta <= CO_RESPOND.eta) return;
  let best: Unit | null = null, be = 1e9, beta = 0;
  for (const u of sim.units) {
    if (u.kind !== 'engine' && u.kind !== 'ladder' && u.kind !== 'rescue') continue;      // 소방의 지상 부대만 (특수 부대 — 화학·헬기·구조정 — 는 아껴 둔다)
    if (u.aid || (u.state !== 'available' && u.state !== 'returning') || crewOk(sim, u) === 0 || I.assigned.indexOf(u.id) >= 0) continue;      // 선착 대응은 집 안의 환자를 처치하는 일이다 — 온전한 대원이 있는 부대만
    const spare = sim.units.some((q) => q.id !== u.id && q.dept === u.dept && !q.air && !q.sea && !notSpare(q) && (q.state === 'available' || q.state === 'returning') && crewReady(sim, q) > 0);      // (N8) 포획팀을 소방 예비로 세지 않는다
    if (!spare) continue;
    const eta = etaFor(sim, u, I.reportedNode);
    if (eta < be) { be = eta; best = u; beta = eta; }
  }
  if (!best || (amb && beta > amb.eta - CO_RESPOND.gain)) return;
  I.coResp = best.id;
  emit(sim, { inc: I.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 2, causes: [I.lastEvent], text: amb
    ? `구급차가 멀어(가장 나은 ${amb.u.callsign} 예상 ${fmtSec(amb.eta)}) 가까운 ${josa(best.callsign, '을/를')} 선착 대응으로 함께 보냅니다. 기본 처치를 먼저 시작합니다.`
    : `지금 보낼 수 있는 구급차가 없습니다. 가까운 ${josa(best.callsign, '을/를')} 선착 대응으로 먼저 보내고 구급차를 계속 찾습니다.` });
  sendUnit(sim, I, 'search', { u: best, score: 0, eta: beta, fit: best.caps.search, divertFrom: null }, null);
}

export function tickDispatch(sim: Sim): void {
  if (sim.tick % 5 !== 2) return;
  const open = sim.incidents.filter((I) => I.phase !== 'closed' && I.assessment && I.locationKnown);
  for (const I of open) I.priority = priorityOf(sim, I);
  open.sort((a, b) => b.priority - a.priority || a.id - b.id);
  for (const I of open) {
    if (sim.t < I.unmetSince + 2) continue;      // 배정 판단에 걸리는 시간
    let progressed = false, blocked: (keyof Needs)[] = [];
    if (I.assessment!.type === 'medical' && I.coResp === undefined && (I.unmet.ems ?? 0) > 0 && I.firstArrivalAt < 0 && !I.assigned.some((uid) => sim.units[uid].dept !== 'ems')) firstResponder(sim, I);
    for (const key of ORDER) {
      while ((I.unmet[key] ?? 0) > 0) {
        let { best, nearest } = pickUnit(sim, I, key, MINCAP[key]);
        if (!best && key === 'tactical') ({ best, nearest } = pickUnit(sim, I, 'law', MINCAP.law));
        if (!best && CIVIL_KEYS.has(key) && I.assessment!.type !== 'utility') { I.unmet[key] = 0; break; }      // (N8 §5.3.8) 평소 사건에 붙는 유관 기관은 선택 수요 — 보낼 차가 없으면 지운다 (대기열·NO_UNIT·지원 없음)
        if (!best) { blocked.push(key); break; }
        I.unmet[key]!--;
        sendUnit(sim, I, key, best, nearest);
        progressed = true;
      }
    }
    if (blocked.length && !I.noUnitLogged) {
      I.noUnitLogged = true;
      const partial = I.assigned.length > 0;
      const why = blockersOf(sim, I, blocked);
      raiseProblem(sim, I, 'NO_UNIT', `가용 ${blocked.map((k) => NEED_LABEL[k]).join('·')} 부대 없음`, {
        role: 'DISPATCH', actor: '배정 AI', imp: 2, causes: [I.lastEvent, ...why.causes],
        text: `사건 ${I.code}: 가용 ${blocked.map((k) => NEED_LABEL[k]).join('·')} 부대가 없습니다. ${partial ? '현재 배정된 부대로 우선 대응하고' : '출동 가능한 부대가 생길 때까지'} 대기열에 올립니다.`,
      }, false, why.ref);
    }
    if (!blocked.length && progressed) I.noUnitLogged = false;
    // 인근 도시 지원: 가용 부대가 없어 한참 밀린 수요가 있으면(사건당 한 번, 교대당 정해진 횟수 안에서) 외부 부대를 부른다
    if (blocked.length && I.aidUnit === undefined && sim.aidUsed < sim.tune.aidUnits && sim.t - I.unmetSince >= AID_WAIT && (I.unmet[blocked[0]] ?? 0) > 0) {
      const key = blocked[0];
      const u = createAidUnit(sim, key, I);
      if (u) {
        sim.aidUsed++; I.aidUnit = u.id;
        emit(sim, { inc: I.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 2, causes: [I.lastEvent], text: `인근 도시에 지원 요청: 가용 ${NEED_LABEL[key]} 부대가 ${Math.round(sim.t - I.unmetSince)}초째 없습니다. ${josa(u.callsign, '이/가')} ${nodeName(sim.city, u.homeNode)} 방면에서 들어옵니다 (이번 교대 지원 ${sim.aidUsed}/${sim.tune.aidUnits}회).` });
        I.unmet[key]!--;
        sendUnit(sim, I, key, { u, score: 0, eta: etaFor(sim, u, I.reportedNode) + AID_DELAY, fit: u.caps[key], divertFrom: null }, null);
        u.timer += AID_DELAY;      // 지원 요청이 접수되어 출발하기까지
      }
    }
  }
}
const AID_WAIT = 30, AID_DELAY = 18;

/**
 * (I1-b 0단계) 부족의 귀속 — 기록만(NO_UNIT 의 causes·ref, I.blockedBy). 배정 판단은 이것을 읽지 않는다.
 * 막힌 수요를 채울 수 있는(능력이 기준 이상인) 지상 부대 가운데 다른 사건에 묶인 것: 그 사건을 I.blockedBy 에, 그 사건의 마지막 출동 지령을 원인에.
 * 결원으로 운용을 멈춘 부대(oos, 지원 부대 제외): ref.unit 과 그 부대의 운용 중단 기록(문구 규칙 T6)을 원인에 — 그 기록 id 는 어디에도 두지 않으므로
 * 기록을 끝에서부터 그 부대의 마지막 부상·순직 기록(u.oosEv, H1)까지만 거슬러 찾는다(NO_UNIT 이 날 때만이라 드물다).
 * 관제가 아는 것만 쓴다: 자기 조직의 부대 상태·배정, 자기가 낸 지령과 받은 운용 중단 보고. export 는 시험용
 */
export function blockersOf(sim: Sim, I: Incident, keys: (keyof Needs)[]): { causes: number[]; ref: Problem['ref'] } {
  const causes: number[] = [];
  let inc = -1, oos = -1;
  for (const u of sim.units) {
    if (u.air || u.sea) continue;
    let can = false;
    for (const k of keys) if (u.caps[k] >= MINCAP[k] || (k === 'tactical' && u.caps.law >= MINCAP.law)) { can = true; break; }
    if (!can) continue;
    if (u.state === 'oos') {
      if (u.aid || u.oosEv === undefined || oos >= 0) continue;
      oos = u.id;
      let rec = u.oosEv;
      for (let k = sim.events.length - 1; k > u.oosEv; k--) { const e = sim.events[k]; if (e.kind === 'unit' && e.incidentId < 0 && e.actor === u.callsign && /운용 중단/.test(e.text)) { rec = e.id; break; } }
      causes.push(rec);
      continue;
    }
    const jid = u.incidentId ?? (u.state === 'transport' || u.state === 'hospital' ? u.patientsIncident : null);
    if (jid === null || jid === I.id) continue;
    const J = sim.incidents[jid];
    if (!I.blockedBy) I.blockedBy = [];
    if (I.blockedBy.indexOf(J.id) < 0) I.blockedBy.push(J.id);
    if (inc < 0) inc = J.id;
    if (J.dispatchLog.length) causes.push(J.dispatchLog[J.dispatchLog.length - 1]);
  }
  return { causes, ref: inc >= 0 || oos >= 0 ? { inc: inc >= 0 ? inc : undefined, unit: oos >= 0 ? oos : undefined } : undefined };
}

/** 관제가 아는 위치가 바뀌었다: 그 사건으로 가는 부대의 목적지를 고친다. */
export function redirectUnits(sim: Sim, I: Incident): void {
  const names: string[] = [];
  for (const uid of I.assigned) {
    const u = sim.units[uid];
    if (u.state === 'enroute') { sendUnitTo(sim, u, I.reportedNode); names.push(u.callsign); }
    else if (u.state === 'turnout') { u.destNode = I.reportedNode; names.push(u.callsign); }
  }
  if (names.length) emit(sim, { inc: I.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 2, causes: [I.lastEvent], text: `위치 정정: ${names.join(', ')} 목적지를 ${josa(nodeName(sim.city, I.reportedNode), '으로/로')} 변경.` });
}

/** 현장 지휘관의 무전(상황 보고·지원 요청)을 관제가 수신했다. */
export function fieldReport(sim: Sim, I: Incident, s: Scene, m: RadioMsg): void {
  if (I.phase === 'closed') return;
  I.fieldVerified = true;
  const cmd = s.agents.find((a) => a.rid === m.from);
  const tb = cmd ? cmd.beliefs.get('type', 0) : undefined;
  if (tb && tb.verified && I.assessment && tb.value !== I.assessment.type) {
    I.fieldType = tb.value;
    assess(sim, I, '현장 지휘관 보고');
    // (R3 균형) 응급 환자로 보고 함께 보낸 선착 대응 부대(coResp)는 현장이 응급이 아니라고 알리면 보통의 배정 부대다 —
    //   선착 대응으로 남겨 두면 우선순위가 그 사건을 '구급대원이 닿지 않은 사건'으로 계속 셌다(쓰러진 사람이 있다던 가스 누출). 이미 닿은 뒤라 다시 붙지 않는다(firstArrivalAt)
    if (I.coResp !== undefined && I.assessment.type !== 'medical') I.coResp = undefined;
  }
  // (X6 §5.9) 현장 상황 보고에 붕괴·폭발·전소 사실이 실려 왔다: 위험도를 다음 문턱까지 올리고 위험을 더한 뒤 다시 평가한다 (지휘관이 보낸 것만 — 진실 아님)
  if (m.kind === 'sitrep') {
    const ev = m.facts.filter((f) => f.type === 'sign' && f.value && f.value.kind === 'event');
    if (ev.length && I.assessment) {
      const fr = I.fieldRisk ?? (I.fieldRisk = { sev: 0, risks: [] });
      const what: string[] = [];
      let added = false;
      for (const f of ev) {
        const w = f.value.what as string;
        const r = w === 'partial' || w === 'total' ? '건물 붕괴' : w === 'gas' || w === 'vessel' || w === 'dust' ? '폭발 발생' : w === 'burnout' ? '건물 전소' : '';
        if (r && what.indexOf(r) < 0) what.push(r);
        if (r && fr.risks.indexOf(r) < 0) { fr.risks.push(r); added = true; }
      }
      if (what.length) {
        const was = I.assessment.severity, prev = Math.max(was, fr.sev);
        fr.sev = Math.min(3, prev < 1.7 ? 1.7 : prev < 2.4 ? 2.4 : 3);
        // 이미 가장 높은 위험도이고 새 위험도 없으면 다시 평가하지 않는다 (같은 기록을 되풀이하지 않게)
        if (added || sevName(fr.sev) !== sevName(was)) {
          emit(sim, { inc: I.id, role: 'ANALYST', actor: '상황 분석 AI', kind: 'assess', imp: 2, causes: [m.eventId], text: `현장 보고 반영: ${what.join('·')} — 위험도 ${sevName(was)} → ${sevName(Math.max(was, fr.sev))}.` });
          assess(sim, I, '현장 상황 보고');
        }
      }
    }
  }
  while (I.fieldNeedsSeen < s.requests.length) {
    const q = s.requests[I.fieldNeedsSeen++];
    I.unmet[q.need] = Math.max(I.unmet[q.need] ?? 0, q.count);
    I.unmetSince = sim.t; I.noUnitLogged = false;
    emit(sim, { inc: I.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 1, causes: [q.eventId], text: `현장 지원 요청 접수 (${NEED_LABEL[q.need]}). 가용 부대를 확인합니다.` });
  }
}

/** 부대가 출동한 뒤 들어온 추가 신고 내용을 현장에 전달한다. */
export function briefUpdate(sim: Sim, I: Incident, c: Claim): void {
  const s = sim.scenes[I.id];
  if (!s || !s.agents.length) return;
  if (c.topic === 'hazard') {
    // (X6 §3.6) 위험 진술(아직도 뭐가 계속 떨어져요 · 가스가 새요)은 미확인 조짐으로 현장에 넘긴다 (위치 모르는 화재의 가스통은 넘기지 않는다)
    const f = hazardSign(sim, I, c);
    if (f) transmit(sim, s, null, -1, 'brief', [f], `현장 지휘관, 추가 신고 내용 전달: ${f.text.replace('신고 내용: ', '')} (미확인).`, -1, 1, I.callEvents.slice(-1));
    return;
  }
  if (c.topic !== 'count' && c.topic !== 'trapped' && c.topic !== 'detail' && c.topic !== 'injured') return;
  let count: number | null = null, region = -1;
  for (const q of I.claims) {
    if (q.topic === 'count' && typeof q.value === 'number') count = count === null ? q.value : Math.max(count, q.value);
    if (q.topic === 'detail' && q.value && typeof q.value.region === 'number') region = q.value.region;
    if ((q.topic === 'injured' || q.topic === 'trapped') && q.value === true && count === null) count = 1;
  }
  if (count === null && region < 0) return;
  const where = region >= 0 && region < s.regions.length ? ` · ${s.regions[region].name} 부근` : '';
  const f = mkFact('occ', 1 + c.callId, { count, region, trapped: c.topic === 'trapped' && c.value === true }, '추가 신고', sim.t, c.conf, false, `추가 신고: ${count !== null ? `요구조자 약 ${count}명` : '요구조자 위치 정보'}${where}`);
  transmit(sim, s, null, -1, 'brief', [f], `현장 지휘관, 추가 신고 내용 전달: ${f.text.replace('추가 신고: ', '')} (미확인).`, -1, 1, I.callEvents.slice(-1));
}

export { emptyNeeds, needsText };
