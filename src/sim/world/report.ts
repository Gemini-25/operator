// 보고서가 내력을 읽는 법 (설계서 I1 §3.9 — b4). debrief.buildReport 가 부른다.
//
// 모든 문장은 기록에서만 만든다: I.parent · I.cause · I.csq · I.hz(사건이 날 때 그 자리에서 적어 둔 내력) · Problem.ref · sim.events · world.log · gen.dropped.
// **법칙의 이름으로 쓰지 않고 상태의 내력으로 쓴다** — "몰린 길의 사고 법칙"이 아니라 "○○로 통제(사건 07 쓰러진 나무) 뒤 △△로에 차량이 몰린 동안(약 140초) 난 사고".
// 문장은 (법칙, 갈래)로 고르고, "약 N초"는 그 몫의 hz.at − since 다(칸에 초과가 처음 생긴 시각이 아니라 그 원인이 이 대상에 걸린 시각부터 — §3.6a).
// 자식 줄의 괄호는 **그 부모가 주인인 몫**의 갈래를 짧게 읽은 말이다(자식의 주된 몫이 다른 원인일 수 있다).
// 교대 요약의 '인과:' 줄은 법칙 사건이나 이야기 연쇄가 있을 때만, 법칙의 수는 hazardLabel 로 읽는다.
//
// 읽기만 한다(판정·기록·난수를 건드리지 않는다 — 교대 끝의 보고서와 시험만 부른다). 진실 쪽 자료(world.expo)는 교대 요약의 숫자에만 쓴다.
// 이 파일에는 등록이 없다(world/rules·world/laws 를 import 하지 않는다 — 법칙의 이름표는 world/hazard.ts 의 hazardLabel 로).

import { CHAIN_MAX, chainLen } from '../chain';
import { edgeName } from '../city';
import type { Sim } from '../engine';
import { scenarioName } from '../scenarios';
import type { HazardLawId, HzSrc, HzWhat, Incident, ShiftReport } from '../types';
import { josa } from '../util';
import { SHOCK } from './expo';
import { HZ, hazardLabel } from './hazard';
import { zoneName, zoneOfPlace } from './state';

/** 이야기 연쇄의 이름 (사용자 결정으로 남긴 대본 — b0 의 csq 넷) */
export const STORY_NAME: Record<string, string> = { reoffend: '달아난 용의자의 재범', getaway: '도주 차량', hideout: '납치범의 은신처', arson: '연쇄 방화' };
/** 갈래의 짧은 말 — 자식 줄의 괄호 · 사건 카드의 내력 칩(view 가 같은 표를 쓴다) */
export const HZ_SHORT: Record<HzWhat, string> = {
  divert: '몰린 길', queue: '밀린 길', lane: '막힌 차로', jam: '정체', crowd: '인파', dark: '꺼진 신호', haze: '연기', level: '차오른 물',
  heat: '옮겨붙음', ember: '불티', shake: '금 간 건물', pipe: '끊긴 배관', residual: '되살아남', outage: '정전', smoke: '연기',
};
/** 문장이 가리키는 것 (시험이 모두 있는지 본다 — §3.9 끝 "문장마다 가리키는 기록이 있어야 한다") */
export interface ChainLine {
  text: string;
  kind: 'hz' | 'story' | 'wear' | 'children' | 'divert' | 'blocked' | 'hospital' | 'infra';
  ev: number[]; inc: number[]; edge: number[]; place: number[];
  n?: number;            // 'hz' 줄의 "약 N초" (없으면 undefined)
}
/** 한 사건의 사슬 문장은 많아야 이만큼 (사건 분석의 9줄 상한과 따로 센다) */
export const CHAIN_LINES = 4;

const incName = (J: Incident): string => `사건 ${J.code} ${scenarioName(J.truth.type, J.truth.variant)}`;
const shortName = (J: Incident): string => `${J.code} ${scenarioName(J.truth.type, J.truth.variant)}`;
const edgeOf = (sim: Sim, id: number): string => (id >= 0 && sim.city.edges[id] ? edgeName(sim.city, sim.city.edges[id]) : '그 구간');
const placeOf = (sim: Sim, id: number): string => (id >= 0 && sim.city.places[id] ? sim.city.places[id].name : '그 건물');
/** "약 N초" — 10초 단위 (그 몫의 at − since) */
const secOf = (at: number, since: number): number => Math.max(10, Math.round(Math.max(0, at - since) / 10) * 10);

/** 장애물 알림의 글자 → 그 라벨 (traffic.OBSTACLE_LABEL — 알림은 장애물을 놓는 그 자리에서 남는다) */
const OBST_WORD: [RegExp, string][] = [[/건물 잔해/, '건물 잔해'], [/공사/, '도로 공사'], [/고장 난 차량|고장 차량/, '고장 차량'], [/화물이 떨어|낙하물/, '낙하물'], [/불법 주차/, '불법 주차']];

/**
 * 몫의 {원인}: 주인 사건이 있으면 `사건 {코드} {이름}`, 장애물이면 그 라벨, 재난이면 재난 이름, 정체·인파면 그 말 — 그 몫의 기록에서 읽는다.
 * 기록이 없으면(장부의 구멍 — 관문이 0 을 지킨다) '까닭이 기록되지 않은 혼잡'
 */
export function causeWord(sim: Sim, ev: number, inc: number): string {
  const J = inc >= 0 ? sim.incidents[inc] : undefined;
  if (J) return incName(J);
  const e = ev >= 0 ? sim.events[ev] : undefined;
  if (!e) return '까닭이 기록되지 않은 혼잡';
  if (e.incidentId >= 0 && sim.incidents[e.incidentId]) return incName(sim.incidents[e.incidentId]);
  for (const [re, w] of OBST_WORD) if (re.test(e.text)) return w;
  if (/정체/.test(e.text)) return '정체';
  { const m = /^(.+) 주변에 인파/.exec(e.text); if (m) return `${m[1]} 주변 인파`; }
  if (sim.disaster && e.incidentId < 0 && (e.kind === 'hazard' || /통제 —/.test(e.text))) return sim.disaster.name;      // 재난 알림 · 재난이 막은 구간(disaster.closeEdge)
  if (e.tag === 'power') return '정전';
  if (e.tag === 'smoke') return '연기';
  return `${e.actor} 알림`;
}

/** 큰 몫(전체의 1/3 이상) 가운데 기록이 없는 것이 있는가 — 장부의 구멍 */
function bigHole(src: readonly HzSrc[]): boolean {
  let total = 0;
  for (const s of src) total += s.w;
  return src.some((s) => s.ev < 0 && s.w >= total * HZ.PARENT_SHARE);
}

/** 법칙 사건의 주된 몫으로 한 문장 (법칙, 갈래로 고른다) */
function hzSentence(sim: Sim, law: HazardLawId, target: number, at: number, s: HzSrc, out: ChainLine): string {
  const c = causeWord(sim, s.ev, s.inc), N = secOf(at, s.since);
  const road = law === 'roadCrash', tgtE = edgeOf(sim, target), tgtP = placeOf(sim, target);
  if (road) out.edge.push(target); else out.place.push(target);
  switch (s.what) {
    case 'divert': out.edge.push(s.ref); out.n = N; return `${edgeOf(sim, s.ref)} 통제(${c}) 뒤 ${tgtE}에 차량이 몰린 동안(약 ${N}초) 난 사고입니다.`;
    case 'queue': {
      out.edge.push(s.ref);
      const e = s.ev >= 0 ? sim.events[s.ev] : undefined;
      // 밀림의 뿌리를 만든 항: 닫힘(통제 기록) · 사건의 감속(발생 기록) · 정체 · 얹은 혼잡(인파 — 그 말이 곧 원인이다)
      if (e && /인파/.test(e.text)) return `${edgeOf(sim, s.ref)}의 ${josa(c, '으로/로')} 차가 밀려 있던 ${tgtE}에서 난 사고입니다.`;
      const w = e && /정체/.test(e.text) ? '정체' : e && e.kind === 'incident' ? '사고' : '통제';
      // 뿌리가 그 구간 자신이다(먼저 난 사고로 느려진 구간에 차가 밀렸다 — 교통 모델의 밀림은 뿌리 구간에도 한 다리 건너 찬다): 같은 이름을 두 번 쓰지 않는다
      if (s.ref === target) return `${tgtE}의 ${w}(${c})로 밀려 있던 그 구간에서 난 사고입니다.`;
      return `${edgeOf(sim, s.ref)}의 ${w}(${c})로 차가 밀려 있던 ${tgtE}에서 난 사고입니다.`;
    }
    case 'lane': return `한 차로가 막힌 ${tgtE}에서 난 사고입니다(${c}).`;
    case 'jam': return `정체 중이던 ${tgtE}에서 난 사고입니다.`;
    case 'crowd': return `행사 인파로 막힌 ${tgtE}에서 난 사고입니다(${c}).`;
    case 'dark': return `정전(${c})으로 신호등이 꺼진 ${tgtE}에서 난 사고입니다.`;
    case 'haze': return `${c}의 연기가 덮은 ${tgtE}에서 난 사고입니다.`;
    case 'level': return road ? `불어난 물이 차오르던 ${tgtE}에서 난 사고입니다(${c}).` : `불어난 물에 ${tgtP} 지하가 잠겨 전기가 끊긴 순간 승강기가 멈췄습니다.`;
    case 'heat': if (s.ref >= 0) out.place.push(s.ref); out.n = N; return `${c}의 불이 ${N}초 넘게 이어지는 동안 바로 옆 ${tgtP}에 옮겨붙었습니다.`;
    case 'ember': return `${c} 폭발의 불티가 옆 ${tgtP}에 옮겨붙었습니다.`;
    case 'shake': out.n = N; return `${c}의 충격으로 금이 가 있던 ${josa(tgtP, '이/가')} ${N}초 뒤 내려앉았습니다.`;
    case 'pipe': return `${c}의 충격으로 손상된 ${tgtP}의 배관에서 가스가 샜습니다.`;
    case 'residual': out.n = N; return `${josa(c, '이/가')} 끝난 뒤 남은 불씨가 ${N}초 만에 ${tgtP}에서 되살아났습니다.`;
    case 'outage': return `${s.ref >= 0 ? zoneName(s.ref) : tgtP} 정전(${c}) 순간 ${tgtP}에서 운행 중이던 승강기가 멈췄습니다.`;
    case 'smoke': out.n = N; return `${c}의 연기가 ${N}초 동안 덮은 ${zoneName(zoneOfPlace(sim, target))}에서 난 호흡 곤란입니다(${tgtP}).`;
  }
  return `${tgtE}에서 난 사고입니다(${c}).`;
}
/** 둘째 몫의 짧은 말 — "(… 도 겹쳤습니다)" */
function alsoPhrase(sim: Sim, s: HzSrc): string {
  const c = causeWord(sim, s.ev, s.inc);
  switch (s.what) {
    case 'divert': return `${edgeOf(sim, s.ref)} 통제(${c})로 몰린 차`;
    case 'queue': return `${edgeOf(sim, s.ref)}에서 밀려 온 차`;
    case 'lane': return `한 차로가 막힌 것(${c})`;
    case 'jam': return '정체';
    case 'crowd': return c;
    case 'dark': return `${josa(c, '으로/로')} 꺼진 신호`;
    case 'haze': return `${c}의 연기`;
    case 'level': return '차오르는 물';
    case 'heat': return `${c}의 불`;
    case 'ember': return `${c}의 불티`;
    case 'shake': return `${c}의 충격`;
    case 'pipe': return `${c}의 배관 손상`;
    case 'residual': return `${c}의 남은 불씨`;
    case 'outage': return `${josa(c, '으로/로')} 끊긴 전기`;
    case 'smoke': return `${c}의 연기`;
  }
  return c;
}

/** 이 사건의 부모가 주인인 몫의 짧은 말 (자식 줄의 괄호). 이야기 연쇄면 그 이름 */
function childTag(J: Incident, parentId: number): string {
  if (J.csq && STORY_NAME[J.csq]) return STORY_NAME[J.csq];
  if (J.hz) {
    let best: HzSrc | null = null;
    for (const s of J.hz.src) if (s.inc === parentId && (!best || s.w > best.w)) best = s;
    if (best) return HZ_SHORT[best.what];
    const l = hazardLabel(J.hz.law);
    if (l) return l;
  }
  return '이어진 사건';
}

/**
 * 한 사건의 사슬 문장 (많아야 CHAIN_LINES 줄) — 무엇이 그 사건을 낳았고, 그 사건이 무엇을 낳았고, 다른 사건과 세계 상태가 그 사건을 어떻게 늦췄는가.
 * 교대 끝이 아니어도 부를 수 있다(시험) — 그때는 그 순간까지의 기록으로 쓴다
 */
export function chainLines(sim: Sim, I: Incident): ChainLine[] {
  const out: ChainLine[] = [];
  const line = (kind: ChainLine['kind']): ChainLine => ({ text: '', kind, ev: [], inc: [], edge: [], place: [] });
  // ① 무엇이 이 사건을 낳았나 — 법칙(상태의 내력) 또는 이야기 연쇄
  if (I.hz && I.hz.src.length) {
    const L = line('hz'), s0 = I.hz.src[0];
    if (s0.ev >= 0) L.ev.push(s0.ev);
    if (s0.inc >= 0) L.inc.push(s0.inc);
    let t = hzSentence(sim, I.hz.law, I.hz.target, I.hz.at, s0, L);
    const s1 = I.hz.src[1];
    if (s1 && s1.ev >= 0 && s1.ev !== s0.ev) {      // 같은 기록의 몫(인파가 그 구간에도 얹혔다 따위)은 같은 원인이라 덧붙이지 않는다 — 기록 없는 몫은 아래 구멍 문장이 말한다
      t = t.slice(0, -1) + ` (${alsoPhrase(sim, s1)}도 겹쳤습니다).`;
      if (s1.ev >= 0) L.ev.push(s1.ev);
      if (s1.inc >= 0) L.inc.push(s1.inc);
    }
    if (bigHole(I.hz.src)) t = t.slice(0, -1) + ' (까닭이 기록되지 않은 혼잡도 겹쳤습니다).';
    L.text = t;
    out.push(L);
  } else if (I.parent !== undefined && I.csq && STORY_NAME[I.csq] && sim.incidents[I.parent]) {
    const P = sim.incidents[I.parent], L = line('story');
    L.inc.push(P.id);
    if (I.cause !== undefined && I.cause >= 0) L.ev.push(I.cause);
    L.text = `${incName(P)}에서 이어졌습니다 — ${STORY_NAME[I.csq]}.`;
    out.push(L);
  }
  // ② 그 건물이 이미 금이 가 있었다 (현장의 wear — 왜 빨리 무너졌는가)
  const s = sim.scenes[I.id];
  if (s && s.wear && s.wear.cause === 'shock' && s.wear.inc) {
    const L = line('wear'), K = sim.incidents.find((J) => J.code === s.wear!.inc);
    if (K) L.inc.push(K.id);
    if (I.truth.placeId >= 0) L.place.push(I.truth.placeId);
    L.text = `이 건물은 사건 ${s.wear.inc}의 충격으로 이미 금이 가 있었습니다.`;
    out.push(L);
  }
  // ③ 이 사건이 낳은 사건
  const kids = sim.incidents.filter((J) => J.parent === I.id);
  if (kids.length) {
    const L = line('children');
    for (const J of kids) L.inc.push(J.id);
    L.text = `이 사건에서 이어진 사건: ${kids.slice(0, 4).map((J) => `${shortName(J)}(${childTag(J, I.id)})`).join(', ')}${kids.length > 4 ? ` 외 ${kids.length - 4}건` : ''}.`;
    out.push(L);
  }
  // ④ 정전·통신 장애가 대응을 막았다 (INFRA_FAIL — 그 원인 기록을 거슬러 그 장애를 만든 사건)
  const inf = I.problems.find((p) => p.code === 'INFRA_FAIL');
  if (inf) {
    const L = line('infra'), m = /^(.+?) 통신 장애\((.+)\)로/.exec(inf.detail);
    L.ev.push(inf.eventId);
    const origin = originOf(sim, inf.eventId, I.id);
    if (origin) L.inc.push(origin.id);
    const where = m ? m[1] : '그 일대', why = m ? m[2] : '';
    const what = /지진/.test(why) ? '지진' : /방송|관제/.test(why) ? '방송·관제 시설 사고' : /태풍/.test(why) ? '태풍 정전' : '정전';
    const pp = josa(what, '으로/로').slice(what.length);      // 괄호 뒤의 조사는 앞말에 맞춘다
    L.text = `${where} ${what}${origin ? `(${incName(origin)})` : sim.disaster && !what.includes(sim.disaster.name) ? `(${sim.disaster.name})` : ''}${pp} 무전이 끊기는 구역이 늘었습니다.`;
    out.push(L);
  }
  // ⑤ 다른 사건으로 돌려진 부대 (C6 — 그 DIVERTED 의 ref.lost)
  for (const p of I.problems) {
    if (p.code !== 'DIVERTED' || !p.ref || p.ref.lost === undefined || p.ref.lost < 10 || p.ref.unit === undefined || p.ref.inc === undefined) continue;
    const u = sim.units[p.ref.unit], J = sim.incidents[p.ref.inc];
    if (!u || !J) continue;
    const L = line('divert');
    L.ev.push(p.eventId); L.inc.push(J.id);
    const nm = scenarioName(J.truth.type, J.truth.variant), pp = josa(nm, '으로/로').slice(nm.length);      // 괄호 뒤의 조사는 이름에 맞춘다
    L.text = `${josa(u.callsign, '이/가')} 사건 ${J.code}(${nm})${pp} 돌려져 첫 도착이 약 ${p.ref.lost}초 늦었습니다.`;
    out.push(L);
    break;
  }
  // ⑥ 다른 사건에 묶인 부대 (NO_UNIT 의 blockedBy)
  if (I.blockedBy && I.blockedBy.length) {
    const p = I.problems.find((q) => q.code === 'NO_UNIT');
    if (p) {
      const L = line('blocked'), need = /^가용 (.+) 부대 없음/.exec(p.detail)?.[1] ?? '필요한';
      L.ev.push(p.eventId);
      for (const id of I.blockedBy) L.inc.push(id);
      const waited = p.recovered ? Number(/(\d+)초 뒤/.exec(p.recoveryText)?.[1] ?? NaN) : (I.closedAt >= 0 ? I.closedAt : sim.t) - p.t;
      const codes = I.blockedBy.slice(0, 3).map((id) => sim.incidents[id].code).join('·');
      L.text = `${need} 부대가 사건 ${codes}${I.blockedBy.length > 3 ? ' 등' : ''}에 묶여 ${Number.isFinite(waited) ? `${Math.max(0, Math.round(waited))}초 동안 ` : ''}배정하지 못했습니다.`;
      out.push(L);
    }
  }
  // ⑦ 사건이 닫힌 뒤의 응급실 포화 (닫히기 전의 것은 사건 분석의 문장이 이미 쓴다 — evaluate)
  for (const p of I.problems) {
    if (p.code !== 'HOSPITAL_FULL' || I.closedAt < 0 || p.t < I.closedAt) continue;
    const m = /^(.+) 포화로 (이송 중 )?(.+?)(?:으로|로) (?:이송|목적지 변경) \(약 \+(\d+)초\)$/.exec(p.detail);
    const L = line('hospital');
    L.ev.push(p.eventId);
    L.text = m ? (m[2] ? `${m[1]} 응급실 포화로 이송 중 목적지를 ${josa(m[3], '으로/로')} 바꿨습니다(약 +${m[4]}초).` : `${m[1]} 응급실 포화로 ${josa(m[3], '으로/로')} 이송했습니다(약 +${m[4]}초).`) : `응급실 포화: ${p.detail}.`;
    out.push(L);
    break;
  }
  return out.slice(0, CHAIN_LINES);
}

/** 기록의 원인을 거슬러(넓이 우선, 몇 단계까지) 다른 사건의 기록을 찾는다 — 정전·통신 장애를 만든 사건 */
function originOf(sim: Sim, ev: number, self: number): Incident | null {
  const seen = new Set<number>([ev]);
  let front = [ev];
  for (let d = 0; d < 6 && front.length; d++) {
    const next: number[] = [];
    for (const k of front) {
      const e = sim.events[k];
      if (!e) continue;
      if (k !== ev && e.incidentId >= 0 && e.incidentId !== self) return sim.incidents[e.incidentId];
      for (const c of e.causes) if (c >= 0 && !seen.has(c)) { seen.add(c); next.push(c); }
    }
    front = next;
  }
  return null;
}

const STORY = (J: Incident): boolean => !!J.csq && STORY_NAME[J.csq] !== undefined;

/** 가장 긴 사슬 (뿌리 → 끝) — 사건이 둘 이상일 때만 */
function longestChain(sim: Sim): Incident[] {
  let best: Incident | null = null, bl = 1;
  for (const J of sim.incidents) { if (J.parent === undefined) continue; const n = chainLen(sim, J); if (n > bl) { bl = n; best = J; } }
  if (!best) return [];
  const path: Incident[] = [];
  for (let J: Incident | undefined = best; J && path.length < CHAIN_MAX + 2; J = J.parent !== undefined ? sim.incidents[J.parent] : undefined) path.unshift(J);
  return path;
}

/** 세계 상태의 숫자와 줄 (ShiftReport.world) — '인과:' 줄과 '세계 상태:' 줄 */
export function worldReport(sim: Sim): NonNullable<ShiftReport['world']> {
  const w = sim.world, log = w.log;
  let spawned = 0;
  for (const r of log) if (r.made >= 0) spawned++;
  // 정전·통신 장애는 실제로 연 건수다(rules/infra.ts 가 world.count 에 센다) — world.log 의 줄은 규칙의 발동 수라 태풍 정전의 복구(blackout data 0)·아무 동네도
  // 끄지 못한 여진까지 센다(검토에서 고쳤다: 태풍 정전 한 번이 '정전 2회'였다). 연기는 동네로 번진 건수 = 연기 알림 기록(tag smoke — 연기 한 건에 한 번. smokePlume 은 장부 줄을 남기지 않는다)
  const outages = w.count['powerOut.spans'] ?? 0, commsDown = w.count['commsDown.spans'] ?? 0;
  let hospitalDiverts = 0, smoke = 0;
  for (const e of sim.events) { if (e.tag === 'hospital' && /응급실 포화 —/.test(e.text)) hospitalDiverts++; else if (e.tag === 'smoke') smoke++; }
  let rerouted = 0, diverts = 0, lostSum = 0;
  for (const J of sim.incidents) for (const p of J.problems) {
    if (p.code === 'HOSPITAL_FULL') rerouted++;
    else if (p.code === 'DIVERTED') { diverts++; lostSum += p.ref?.lost ?? 0; }
  }
  const lines: string[] = [];
  // 인과: 법칙 사건이나 이야기 연쇄가 있을 때만
  const laws = sim.incidents.filter((J) => J.hz !== undefined), story = sim.incidents.filter(STORY);
  if (laws.length + story.length > 0) {
    const pieces: string[] = [];
    if (laws.length) {
      const by = new Map<string, number>();
      for (const J of laws) by.set(J.hz!.law, (by.get(J.hz!.law) ?? 0) + 1);
      pieces.push(`상태에서 난 사건 ${laws.length}건(${[...by.entries()].map(([k, n]) => `${hazardLabel(k) ?? k} ${n}`).join(' · ')})`);
    }
    const path = longestChain(sim);
    if (path.length >= 2) pieces.push(`가장 긴 사슬 ${path.length}단계 — ${path.map(shortName).join(' → ')}`);
    if (story.length) pieces.push(`이야기 연쇄 ${story.length}건`);
    if (diverts) pieces.push(`전환 배정 ${diverts}회${lostSum >= 1 ? `(늦어진 시간 합 ${Math.round(lostSum)}초)` : ''}`);
    if (rerouted) pieces.push(`병원 우회 이송 ${rerouted}회`);
    if (outages) pieces.push(`정전 ${outages}회`);
    const dropped = sim.gen.dropped.length;
    if (dropped) pieces.push(`조건은 맞았지만 상한·부하로 일어나지 않은 것 ${dropped}건`);
    lines.push(`인과: ${pieces.join(', ')}.`);
  }
  // 세계 상태: 사건이 없던 건물이 이웃에서 받은 것과 기반 시설
  let cracked = 0, pipes = 0, wet = 0;
  for (const k in w.expo) { const e = w.expo[k]; if (e.shake >= SHOCK.S_MIN) cracked++; if (e.pipeEv >= 0) pipes++; if (e.wet) wet++; }
  const st: string[] = [];
  if (outages) st.push(`정전 ${outages}회`);
  if (commsDown) st.push(`통신 장애 ${commsDown}회`);
  if (hospitalDiverts) st.push(`응급실 포화 ${hospitalDiverts}회`);
  if (smoke) st.push(`연기 ${smoke}건`);
  if (cracked) st.push(`금 간 건물 ${cracked}채`);
  if (pipes) st.push(`끊긴 배관 ${pipes}곳`);
  if (wet) st.push(`지하가 잠긴 건물 ${wet}채`);
  if (st.length) lines.push(`세계 상태: ${st.join(' · ')}.`);
  return { outages, commsDown, hospitalDiverts, rerouted, spawned, lines };
}
