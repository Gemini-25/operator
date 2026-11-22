// N8 (단계 10) 조건부 연쇄 — 일상 사건이 세계에 남기는 것 (docs/specs/N8-incident-kinds.md §5.6 · 구현 메모 단계 10).
//
// 사용자 결정(2026-11-20 저녁) "인과가 스크립트대로 말고 자연스럽게": 설계서의 K1~K8("X 가 실패하면 확률 p 로 Y")을 옮길 수 있는 것은 세계 상태 → 일반 법칙 → 초과 위험으로 옮겼다.
// 이 파일의 앞쪽 상태 규칙들은 **상태만 놓는다**(사건을 만들지 않는다 — 기록도 남기지 않는다). 사건은 원인을 모르는 법칙(world/laws/kinds.ts · L2 heatSpread · L1 roadCrash)이
// 그 상태로 쌓인 위험이 대상의 문턱을 넘을 때만 낸다 — 증거는 개입 시험(같은 시드에서 그 상태만 되돌리면 그 사건이 없다):
//   K1 wireFire   → wireSpark·wireLeft: 살아 있는 전선의 불꽃이 곁 건물의 L2 heatSpread 칸에 불티를 쌓는다 (오래 살아 있을수록 — 늦은 복구·닫힐 때 남은 전선)
//   K2 mainSink   → mainSoak: 터진 수도관의 물이 이웃 교차로 밑으로 스민다 → 법칙 washout (물이 오래 흐를수록 — 늦게 잠근 관)
//   K3 sinkCrash  → (코드 없음) 싱크홀이 막은 구간의 우회 몰림·밀림을 L1 roadCrash 가 저절로 본다 — 교통의 장부(noteRoadCause 'close')
//   K5 hiveSting  → hiveLeft: 닫힐 때 살아 남은 벌집 → 법칙 strayHarm (그 건물에서 또 쏘인다)
//   K6 dogLoose · K7 animalRoad → looseOut: 찻길로 달아난 동물(신호 'loose') → 법칙 strayHarm(곁 주민을 다치게 한다) · strayRoad(곁 구간의 사고)
// 옮기지 못한 둘(K4 rowdyKnife · K8 snatchAgain)은 이 파일 끝의 이야기 연쇄다 — 붙잡히지 않은 용의자가 다시 범행하는가는 물리 상태의 적분이 아니라 행위자의 선택이고,
// I1-b 가 C10(재범)을 같은 까닭으로 이야기 연쇄로 남겼다(world/rules/risk.ts 머리). 조건(붙잡히지 않음)으로만 걸고, 근처에 경찰이 없고 그 건물이 비었을 때만 일어난다(when — reoffendItem 과 같은 꼴).
//
// 등록 순서 = 결과 (world/rules/index.ts 의 맨 끝). 진실 쪽이다(세계 규칙). 판단 쪽은 world.loose·world.soak 를 읽지 않는다.
import type { Sim } from '../../engine';
import { policeNear } from '../../field/hazards';
import { placeUsable } from '../../placeUse';
import type { Incident, LooseHazard, PlaceKind } from '../../types';
import { registerConsequence, spawnConsequence } from '../consequence';
import { hazardCellFor, hazardImpulse } from '../hazard';
import { SOAK, SPARK, STRAY, flowingMain, liveWire, sparkTargets } from '../kindsExpo';

/** 열린 사건 가운데 이 조건의 현장이 하나라도 있는가 (보관된 현장은 뺀다) */
function anyOpen(sim: Sim, ok: (I: Incident) => boolean): boolean {
  for (const I of sim.incidents) { if (I.phase === 'closed') continue; const s = sim.scenes[I.id]; if (s && !s.archived && ok(I)) return true; }
  return false;
}
const wireOpen = (sim: Sim) => (I: Incident): boolean => liveWire(sim.scenes[I.id]!) !== null;
const mainOpen = (sim: Sim) => (I: Incident): boolean => flowingMain(sim.scenes[I.id]!) !== null;

// ───────────────────────── K1 — 살아 있는 전선의 불꽃 (L2 heatSpread 의 불티 항) ─────────────────────────
// 전선이 살아 있는 동안 1초마다 곁 건물(벽까지 SPARK.REACH 안, 옮겨붙을 수 있는 건물)의 heatSpread 칸에 불티를 더한다 — 몫 { ev: 그 사건의 발생 기록, inc, what 'spark' }.
// 상태만 본다(전선 소품이 살아 있는가) — 그 사건의 유형·변형·누가 늦었는가를 묻지 않는다. 기록·난수 없음
registerConsequence({
  id: 'wireSpark', label: '전선 불꽃', on: 'tick',
  key: (sim) => (anyOpen(sim, wireOpen(sim)) ? 'tick' : null),
  cooldown: 0, cap: Infinity, spawns: false, silent: true,
  test: () => true,
  apply: (c) => {
    const sim = c.sim;
    for (const I of sim.incidents) {
      if (I.phase === 'closed') continue;
      const s = sim.scenes[I.id];
      if (!s || s.archived || !liveWire(s)) continue;
      for (const t of sparkTargets(sim, I.truth.x, I.truth.y)) hazardImpulse(sim, 'heatSpread', t.id, t.dH, { rate: t.dH, ev: I.rootEvent, inc: I.id, what: 'spark', ref: -1 });
    }
  },
});
// 닫힐 때 전선이 아직 살아 있으면(한계 시간·방치·무대응) 그 뒤 SPARK.LEFT 초 동안 튈 불티를 닫힌 꼴로 한 번에 더한다 — 넘으면 넘는 시각(남은 문턱 ÷ 1초의 불티)만큼 미뤄 예약한다(L7 의 잔열과 같은 꼴)
registerConsequence({
  id: 'wireLeft', label: '남은 전선', on: ['closed'],
  key: (sim, sig) => { if (!sig || sig.inc < 0) return null; const s = sim.scenes[sig.inc]; return s && liveWire(s) ? 'inc:' + sig.inc : null; },
  cooldown: 0, cap: Infinity, spawns: false, silent: true,
  test: (c) => c.sim.incidents[c.sig!.inc].closeReason !== 'shiftend',
  apply: (c) => {
    const sim = c.sim, I = sim.incidents[c.sig!.inc];
    for (const t of sparkTargets(sim, I.truth.x, I.truth.y)) {
      const cell = hazardCellFor(sim, 'heatSpread', t.id);
      if (!cell || cell.done) continue;
      const Hinf = t.dH * SPARK.LEFT, need = cell.thr - cell.H;
      const delay = Hinf >= need ? Math.max(SPARK.MIN_DELAY, need / t.dH) : 0;
      hazardImpulse(sim, 'heatSpread', t.id, Hinf, { rate: Hinf, ev: I.rootEvent, inc: I.id, what: 'spark', ref: -1 }, delay);
    }
  },
});

// ───────────────────────── K2 — 길 밑으로 스민 물 (법칙 washout) ─────────────────────────
// 물이 흐르는 관이 있는 열린 현장마다 그 교차로의 이웃 교차로에 1초에 1 씩 쌓고(world.soak — 처음 흘려 보낸 사건의 기록이 주인), 이번 초에 물이 들지 않은 교차로는 SOAK.DRAIN 씩 빠진다(0 이면 지운다)
registerConsequence({
  id: 'mainSoak', label: '스민 물', on: 'tick',
  key: (sim) => { for (const _k in sim.world.soak) return 'tick'; return anyOpen(sim, mainOpen(sim)) ? 'tick' : null; },
  cooldown: 0, cap: Infinity, spawns: false, silent: true,
  test: () => true,
  apply: (c) => {
    const sim = c.sim, soak = sim.world.soak, fed: number[] = [];
    for (const I of sim.incidents) {
      if (I.phase === 'closed') continue;
      const s = sim.scenes[I.id];
      if (!s || s.archived || !flowingMain(s)) continue;
      const here = sim.city.nodes[I.truth.nodeId];
      for (const eid of here.edges) {
        const e = sim.city.edges[eid], nb = e.a === here.id ? e.b : e.a;
        if (fed.indexOf(nb) >= 0) continue;
        fed.push(nb);
        const w = soak[nb] ?? (soak[nb] = { v: 0, ev: I.rootEvent, inc: I.id });
        w.v += 1;
      }
    }
    for (const k in soak) {
      if (fed.indexOf(+k) >= 0) continue;
      const w = soak[k];
      w.v -= SOAK.DRAIN;
      if (w.v <= 0) delete soak[k];
    }
  },
});

// ───────────────────────── K5 · K6 · K7 — 풀린 위험 (법칙 strayHarm · strayRoad) ─────────────────────────
// 닫힐 때 살아 남은 벌집: 그 건물의 풀린 위험 한 줄(tau Infinity — 그 교대에 남는다). 기록의 주인 = 종료 기록 (교대 끝으로 닫힌 사건은 뺀다 — 이어질 시간이 없다)
registerConsequence({
  id: 'hiveLeft', label: '남은 벌집', on: ['closed'],
  key: (sim, sig) => {
    if (!sig || sig.inc < 0 || sig.place < 0) return null;
    const s = sim.scenes[sig.inc];
    if (!s) return null;
    for (const p of s.props) if (p.kind === 'fixture' && p.skin === 'hive' && p.live === true) return 'inc:' + sig.inc;
    return null;
  },
  cooldown: 0, cap: Infinity, spawns: false, silent: true,
  test: (c) => c.sim.incidents[c.sig!.inc].closeReason !== 'shiftend',
  apply: (c) => {
    const sim = c.sim, sig = c.sig!, I = sim.incidents[sig.inc];
    sim.world.loose.push({ what: 'hive', kind: 'hive', x: sig.x, y: sig.y, node: I.truth.nodeId, place: sig.place, ev: sig.ev, inc: sig.inc, since: sim.t, tau: Infinity });
  },
});
// 찻길로 달아난 동물(신호 'loose' — 그 ANIMAL_LOST 기록이 주인): 그 교차로 둘레를 돌아다니는 풀린 위험 한 줄 (그 종류의 TAU 로 멀어진다)
registerConsequence({
  id: 'looseOut', label: '풀린 동물', on: ['loose'],
  key: (_sim, sig) => (sig && sig.ev >= 0 && sig.inc >= 0 ? 'ev:' + sig.ev : null),
  cooldown: 0, cap: Infinity, spawns: false, silent: true,
  test: (c) => { const s = c.sim.scenes[c.sig!.inc]; return !!s && !!s.animals && s.animals.some((a) => a.id === c.sig!.data); },
  apply: (c) => {
    const sim = c.sim, sig = c.sig!, I = sim.incidents[sig.inc], a = sim.scenes[sig.inc]!.animals!.find((q) => q.id === sig.data)!;
    const L: LooseHazard = { what: 'stray', kind: a.kind, x: sig.x, y: sig.y, node: I.truth.nodeId, place: -1, ev: sig.ev, inc: sig.inc, since: sim.t, tau: STRAY.TAU[a.kind] ?? 300 };
    sim.world.loose.push(L);
  },
});

// ───────────────────────── K4 · K8 — 붙잡히지 않은 용의자 (이야기 연쇄 — 법칙으로 옮기지 않는다) ─────────────────────────
/**
 * 붙잡히지 않은 용의자가 다시 범행할 확률 · 다시 범행하는 건물의 종류와 거리 · 예약에서 사건까지(초) · 경찰이 곁에 있어 미룰 수 있는 마감(초)
 *  rowdy  (K4) 주취 소란의 붙잡히지 않은 주취자가 가까운 식당·편의점에서 흉기를 든 시비로
 *  snatch (K8) 달아난 날치기범이 다른 시장·역·터미널에서 또
 */
export const AGAIN = {
  rowdy: { P: 0.3, R: 300, kinds: { restaurant: 1, convenience: 1 } as Partial<Record<PlaceKind, number>>, delay: [90, 200] as [number, number], wait: 240 },
  snatch: { P: 0.25, R: 600, kinds: { market: 1, station: 1, busTerminal: 1 } as Partial<Record<PlaceKind, number>>, delay: [120, 300] as [number, number], wait: 240 },
};
/** 붙잡히지 않은 용의자가 있는가 (검거·투항·쓰러짐·사망이 아닌 사람) · 그 도주 기록 (없으면 -1) */
function loose(sim: Sim, I: Incident): { any: boolean; ev: number } {
  const s = sim.scenes[I.id];
  let any = false;
  if (s) for (const h of s.hostiles) if (h.state !== 'arrested' && h.state !== 'surrendered' && h.state !== 'down' && h.health > 0) any = true;
  let ev = -1;
  for (const p of I.problems) if (p.code === 'SUSPECT_FLED') { ev = p.eventId; break; }
  return { any, ev };
}
/** 다시 범행할 건물 후보: 그 사건 자리에서 R 안의 그 종류 건물 — 쓸 수 있고(placeUsable) 이번 교대에 사건이 없던 곳 */
function againPlaces(sim: Sim, I: Incident, R: number, kinds: Partial<Record<PlaceKind, number>>): number[] {
  const used = new Set<number>();
  for (const J of sim.incidents) if (J.truth.placeId >= 0) used.add(J.truth.placeId);
  const out: number[] = [];
  for (const q of sim.city.places) {
    if (!(kinds[q.kind] ?? 0) || q.open || q.facility >= 0 || used.has(q.id) || !placeUsable(sim, q.id)) continue;
    if (Math.hypot(q.x + q.w / 2 - I.truth.x, q.y + q.h / 2 - I.truth.y) <= R) out.push(q.id);
  }
  return out;
}
const placeBusy = (sim: Sim, id: number): boolean => sim.incidents.some((J) => J.phase !== 'closed' && J.truth.placeId === id);
function again(name: 'rowdy' | 'snatch', type: 'armed' | 'disturb', variant: string, note: string, fledOnly: boolean): void {
  const A = AGAIN[name];
  registerConsequence({
    id: name === 'rowdy' ? 'rowdyKnife' : 'snatchAgain', label: name === 'rowdy' ? '다시 나타난 취객' : '달아난 날치기범의 재범', on: ['closed'],
    key: (sim, sig) => {
      if (!sig || sig.inc < 0) return null;
      const I = sim.incidents[sig.inc];
      if (I.truth.type !== 'disturb' || I.truth.variant !== name || I.closeReason === 'shiftend') return null;
      const l = loose(sim, I);
      return l.any && (!fledOnly || l.ev >= 0) ? 'inc:' + sig.inc : null;
    },
    cooldown: 0, cap: Infinity, spawns: true,
    test: (c) => c.rng.chance(A.P) && againPlaces(c.sim, c.sim.incidents[c.sig!.inc], A.R, A.kinds).length > 0,
    apply: (c) => {
      const sim = c.sim, I = sim.incidents[c.sig!.inc], l = loose(sim, I);
      const placeId = c.rng.pick(againPlaces(sim, I, A.R, A.kinds));
      spawnConsequence(sim, c, { type, variant, placeId, parent: I.id, tag: type === 'disturb' ? 'daily' : undefined, note, cause: l.ev >= 0 ? l.ev : c.sig!.ev }, A.delay,
        (s) => !policeNear(s, placeId) && !placeBusy(s, placeId), A.wait);
    },
  });
}
again('rowdy', 'armed', 'dispute', '소란을 피우다 붙잡히지 않은 취객이 흉기를 들고 다시 시비를 겁니다', false);
again('snatch', 'disturb', 'snatch', '달아났던 날치기범이 다른 곳에서 또 가방을 채 갔습니다', true);
