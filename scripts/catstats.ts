// 위험의 현실화(X6) 집계 — scripts/sweep.ts 가 교대마다 부른다 (설계서 X6 §8.3). 상태와 기록을 읽기만 한다: 결과는 바뀌지 않는다.
// 수는 되도록 **기록된 문제**(I.problems)에서 센다 — 뒤 단계가 붕괴·폭발·전소·철수를 기록하기 시작하면 고치지 않아도 값이 들어온다.
// 단계 1 에는 그런 기록이 아직 없으므로 "건물 화재" 분모를 뺀 모든 값이 0 이다.
//   catastrophe: burnout n (x% of N building fires) · total n · partial n (fire n / struct n / blast n) · explosions n (gas n · vessel n · dust n; known n / hidden n)
//                · withdrawals n (re-entry n) · defensive/fire x · ext-close n (wrong n) · sign→event p50 s · crew caught n · signs averted n/m
// --cat 을 붙이면 그림자 줄도 낸다: 사건이 닫힐 때의 위험 상태(Scene.cat — 계산만 한 값)가 문턱을 넘어 있던 현장 수.
//   단계 3·4 가 실제로 일으키기 시작하면 이 줄은 "닫힐 때까지 남아 있던 위험"이 된다.

import type { Sim } from '../src/sim/engine';
import { CAT, bldgLevel, gasClouds } from '../src/sim/field/catastrophe';

export interface CatCount {
  fires: number;                                    // 건물 화재: 화재 유형이고 구조 규칙을 쓰는 실제 건물(c.struct, placeId ≥ 0) — 전소 비율의 분모 (§8.1)
  burnouts: number; totals: number;
  partials: number; partFire: number; partStruct: number; partBlast: number;      // 구획 붕괴와 그 원인(불 · 균열·충격·여진 · 폭발)
  gas: number; vessel: number; dust: number;        // X6 가 일으킨 폭발 (현장의 c.gasN·vesselN·dustN)
  known: number;                                    // 그 가운데 지휘관이 위험을 알았던 것 (EXPLOSION 기록). 나머지가 hidden(HIDDEN_HAZARD)
  withdrawals: number; reentries: number;           // 전원 철수(WITHDRAWAL)와 그 가운데 다시 들어간 것(복구)
  defensive: number;                                // 외부 방어로 바꾼 건물 화재 (지휘 쪽 한계 시간 보탬이 있는 현장)
  extClose: number; extWrong: number;               // 외부 확인 종료와 그 가운데 미발견이 남은 것
  crewCaught: number;                               // 붕괴·폭발에 휘말린 대원 (IncidentResult.catastrophe — 단계 7)
  signs: number; averted: number;                   // 위험 조짐(DANGER_SIGN)과 그 가운데 막은 것(복구)
  gaps: number[];                                   // 조짐을 안 시각 → 붕괴·폭발 시각의 간격(초)
  // 그림자: 사건이 닫힐 때의 위험 상태
  scenes: number;                                   // 위험 상태를 가진 현장 수 (catOf 가 null 이 아닌 현장)
  shBurnt: number; shL3: number; shBldg3: number; shCloud: number; shVent: number; shFull: number;
}
export const catZero = (): CatCount => ({
  fires: 0, burnouts: 0, totals: 0, partials: 0, partFire: 0, partStruct: 0, partBlast: 0, gas: 0, vessel: 0, dust: 0, known: 0,
  withdrawals: 0, reentries: 0, defensive: 0, extClose: 0, extWrong: 0, crewCaught: 0, signs: 0, averted: 0, gaps: [],
  scenes: 0, shBurnt: 0, shL3: 0, shBldg3: 0, shCloud: 0, shVent: 0, shFull: 0,
});

/** 한 교대의 집계 (교대가 끝난 뒤에 부른다) */
export function catStats(sim: Sim): CatCount {
  const o = catZero();
  for (const I of sim.incidents) {
    const s = sim.scenes[I.id];
    const c = s ? s.cat : undefined;
    const fire = !!c && c.struct && I.truth.type === 'fire' && I.truth.placeId >= 0;
    if (fire) o.fires++;
    for (const p of I.problems) {
      if (p.code === 'BURNOUT') o.burnouts++;
      else if (p.code === 'STRUCT_COLLAPSE') {
        if (p.detail.startsWith('건물 전체 붕괴')) o.totals++;
        else { o.partials++; if (/달궈짐|골조가 타서/.test(p.detail)) o.partFire++; else if (/폭발/.test(p.detail)) o.partBlast++; else o.partStruct++; }
      } else if (p.code === 'EXPLOSION') o.known++;
      else if (p.code === 'WITHDRAWAL') { o.withdrawals++; if (p.recovered) o.reentries++; }
      else if (p.code === 'DANGER_SIGN') { o.signs++; if (p.recovered) o.averted++; }
      if (p.code === 'STRUCT_COLLAPSE' || p.code === 'EXPLOSION') {
        let at = -1;
        for (const q of I.problems) if (q.code === 'DANGER_SIGN' && q.t <= p.t && q.t > at) at = q.t;
        if (at >= 0) o.gaps.push(p.t - at);
      }
    }
    o.crewCaught += I.result?.catastrophe?.crewCaught ?? 0;
    if (!s) continue;
    const ops = s.ops;
    if (ops) {
      if (fire && ops.limitBonus > 0) o.defensive++;
      if (ops.concluded) { o.extClose++; if ((I.result?.casUndiscovered ?? 0) > 0) o.extWrong++; }
    }
    if (!c) continue;
    o.scenes++;
    o.gas += c.gasN; o.vessel += c.vesselN; o.dust += c.dustN;
    if (c.burntAt >= 0) o.shBurnt++;
    if (c.struct) {
      let weak = false;
      for (const r of s.regions) if (r.indoor && !c.fallen[r.id] && c.integ[r.id] < CAT.L3) { weak = true; break; }
      if (weak) o.shL3++;
      if (bldgLevel(c, s) === 3) o.shBldg3++;
    }
    if (c.gas) { const cl = gasClouds(c, s); if (cl.length && cl[0].length >= CAT.CLOUD_MIN) o.shCloud++; }
    for (const p of s.props) if (p.vessel && !p.exploded) { const h = p.heatLoad ?? 0; if (h >= 1) o.shFull++; else if (h >= CAT.VENT_AT) o.shVent++; }
  }
  return o;
}

/** 여러 교대를 더한다 */
export function sumCat(list: CatCount[]): CatCount {
  const o = catZero();
  for (const c of list) {
    for (const k of Object.keys(o) as (keyof CatCount)[]) { if (k !== 'gaps') (o[k] as number) += c[k] as number; }
    o.gaps.push(...c.gaps);
  }
  return o;
}

const p50 = (a: number[]): number | null => { if (!a.length) return null; const b = a.slice().sort((x, y) => x - y); return b[(b.length - 1) >> 1]; };

/** --json 에 넣는 칸 (줄과 같은 내용) */
export function catJson(c: CatCount): Record<string, number | null> {
  const ex = c.gas + c.vessel + c.dust;
  return {
    buildingFires: c.fires, burnouts: c.burnouts, burnoutShare: +(c.burnouts / Math.max(1, c.fires)).toFixed(3), totals: c.totals,
    partials: c.partials, partialsFire: c.partFire, partialsStruct: c.partStruct, partialsBlast: c.partBlast,
    explosions: ex, gas: c.gas, vessel: c.vessel, dust: c.dust, known: c.known, hidden: Math.max(0, ex - c.known),
    withdrawals: c.withdrawals, reentries: c.reentries, defensivePerFire: +(c.defensive / Math.max(1, c.fires)).toFixed(3),
    extClose: c.extClose, extWrong: c.extWrong, signToEventP50: p50(c.gaps), crewCaught: c.crewCaught, signs: c.signs, averted: c.averted,
  };
}

/** 기본 출력의 한 줄 */
export function catLine(c: CatCount): string {
  const j = catJson(c), gap = j.signToEventP50;
  return `catastrophe: burnout ${c.burnouts} (${((c.burnouts / Math.max(1, c.fires)) * 100).toFixed(1)}% of ${c.fires} building fires) · total ${c.totals} · partial ${c.partials} (fire ${c.partFire} / struct ${c.partStruct} / blast ${c.partBlast})`
    + ` · explosions ${j.explosions} (gas ${c.gas} · vessel ${c.vessel} · dust ${c.dust}; known ${c.known} / hidden ${j.hidden}) · withdrawals ${c.withdrawals} (re-entry ${c.reentries})`
    + ` · defensive/fire ${(c.defensive / Math.max(1, c.fires)).toFixed(2)} · ext-close ${c.extClose} (wrong ${c.extWrong}) · sign→event p50 ${gap === null ? '-' : Math.round(gap) + 's'} · crew caught ${c.crewCaught} · signs averted ${c.averted}/${c.signs}`;
}

/** --cat: 그림자 줄 */
export function catShadowLine(c: CatCount): string {
  return `catastrophe (닫힐 때의 위험 상태 · 현장 ${c.scenes}곳): 전소 문턱을 넘음 ${c.shBurnt} · 임박(건전도 < ${CAT.L3}) 구획이 있음 ${c.shL3} · 건물 조짐 3 ${c.shBldg3} · LEL 구름 ${c.shCloud} · 용기 안전밸브(≥ ${CAT.VENT_AT}) ${c.shVent} · 용기 한계(1.0) ${c.shFull}`;
}
