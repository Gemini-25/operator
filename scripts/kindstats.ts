// 사건 종류 다양화의 지표 줄 `kinds` (N8 §5.15 · §7.1) — scripts/sweep.ts 가 교대마다 부른다. 상태를 읽기만 한다: 결과는 바뀌지 않는다.
//   kinds: 교대당 서로 다른 유형 · 서로 다른 시나리오(유형/변형) · 새 유형(TYPE_ORDER 의 아홉째부터) 사건 수 · 이미 본 시나리오의 되풀이 비율 ·
//          짧은 사건(tag 'daily') 수 · 평소 추첨 사건(태그 daily 가 아니고 부모가 없는 사건) 수 · 비응급 비율(변형 false·prank·referral·dup · FALSE_ALARM · 닫힌 까닭 screened) ·
//          짧은 사건의 현장 시간(첫 도착 → 종료) 중앙값 · 짧은 사건의 배정 부대 평균 ·
//          가동률(경찰 · 소방 · 구급 · 유관 기관 — 1초 표본, 정비·결원(oos) 부대 뺌) · 지상 구급이 0대인 시간의 비율
// 표본: KindsProbe.tick() 을 매 틱 step() 뒤에 부른다 — 5틱(1초)마다 부대를 훑는다.
import type { Sim } from '../src/sim/engine';
import { TYPE_ORDER } from '../src/sim/incidentTypes';
import type { Incident } from '../src/sim/types';

/** 비응급 변형 (N8 §5.5 — 판정·측정 도구가 같은 글자로 본다) */
const BENIGN_VARIANTS: ReadonlySet<string> = new Set(['false', 'prank', 'referral', 'dup']);
/** 원래의 여덟 유형 — 그 뒤(TYPE_ORDER 의 아홉째부터)가 N8·N9 의 새 유형 */
const OLD_TYPES = 8;

export function kindsBenign(I: Incident): boolean {
  return BENIGN_VARIANTS.has(I.truth.variant) || I.closeReason === 'screened' || I.problems.some((p) => p.code === 'FALSE_ALARM');
}

export interface KindsCount {
  incidents: number;
  types: number; scenarios: number; newType: number; repeats: number;
  daily: number; regular: number; benign: number;
  dailyScene: number[];                 // 짧은 사건의 현장 시간(초 — 첫 도착에서 종료까지, 지상 도착이 있던 것만)
  dailyUnits: number; dailyN: number;   // 짧은 사건에 배정된 부대(everAssigned)의 합 · 짧은 사건 수
  secs: number;                         // 표본 수(초)
  busy: Record<string, number>; denom: Record<string, number>;      // 분야별 바쁜 부대 × 초 · 쓸 수 있는 부대 × 초
  emsZero: number;                      // 지상 구급(헬기 아님)이 하나도 가용하지 않은 초
}

const GROUPS = ['police', 'fire', 'ems', 'civil'] as const;

export class KindsProbe {
  private busy: Record<string, number> = { police: 0, fire: 0, ems: 0, civil: 0 };
  private denom: Record<string, number> = { police: 0, fire: 0, ems: 0, civil: 0 };
  private secs = 0;
  private emsZero = 0;
  constructor(private readonly sim: Sim) {}
  tick(): void {
    const sim = this.sim;
    if (sim.tick % 5 !== 0) return;
    this.secs++;
    let emsFree = 0;
    for (const u of sim.units) {
      if (u.state === 'oos') continue;
      const g = u.dept as string;
      if (this.denom[g] === undefined) continue;
      this.denom[g]++;
      if (u.state !== 'available') this.busy[g]++;
      else if (g === 'ems' && !u.air) emsFree++;
    }
    if (emsFree === 0) this.emsZero++;
  }
  done(): { secs: number; busy: Record<string, number>; denom: Record<string, number>; emsZero: number } {
    return { secs: this.secs, busy: { ...this.busy }, denom: { ...this.denom }, emsZero: this.emsZero };
  }
}

/** 교대 하나 (끝난 Sim 과 그 교대의 표본) */
export function kindsStats(sim: Sim, probe: KindsProbe | null): KindsCount {
  const types = new Set<string>(), scen = new Set<string>();
  let newType = 0, repeats = 0, daily = 0, regular = 0, benign = 0, dailyUnits = 0;
  const dailyScene: number[] = [];
  for (const I of sim.incidents) {
    const key = `${I.truth.type}/${I.truth.variant}`;
    if (scen.has(key)) repeats++;
    scen.add(key); types.add(I.truth.type);
    if (TYPE_ORDER.indexOf(I.truth.type) >= OLD_TYPES) newType++;
    if (I.tag === 'daily') {
      daily++; dailyUnits += I.everAssigned.length;
      if (I.firstArrivalAt >= 0 && I.closedAt >= 0) dailyScene.push(I.closedAt - I.firstArrivalAt);
    } else if (I.parent === undefined) regular++;
    if (kindsBenign(I)) benign++;
  }
  const p = probe ? probe.done() : null;
  return {
    incidents: sim.incidents.length, types: types.size, scenarios: scen.size, newType, repeats, daily, regular, benign,
    dailyScene, dailyUnits, dailyN: daily,
    secs: p ? p.secs : 0, busy: p ? p.busy : {}, denom: p ? p.denom : {}, emsZero: p ? p.emsZero : 0,
  };
}

export interface KindsSum {
  shifts: number; incidents: number;
  types: number; scenarios: number; newType: number; repeatShare: number;
  daily: number; regular: number; benignShare: number; benign: number;
  dailySceneMedian: number | null; dailyUnitsAvg: number | null;
  util: Record<string, number | null>; emsZeroShare: number | null;
}

export function sumKinds(list: readonly KindsCount[]): KindsSum {
  const n = Math.max(1, list.length);
  let inc = 0, types = 0, scen = 0, newType = 0, rep = 0, daily = 0, regular = 0, benign = 0, du = 0, dn = 0, secs = 0, emsZero = 0;
  const scene: number[] = [];
  const busy: Record<string, number> = {}, denom: Record<string, number> = {};
  for (const k of list) {
    inc += k.incidents; types += k.types; scen += k.scenarios; newType += k.newType; rep += k.repeats; daily += k.daily; regular += k.regular; benign += k.benign;
    du += k.dailyUnits; dn += k.dailyN; secs += k.secs; emsZero += k.emsZero;
    for (const v of k.dailyScene) scene.push(v);
    for (const g of GROUPS) { busy[g] = (busy[g] ?? 0) + (k.busy[g] ?? 0); denom[g] = (denom[g] ?? 0) + (k.denom[g] ?? 0); }
  }
  scene.sort((a, b) => a - b);
  const med = scene.length ? (scene.length % 2 ? scene[(scene.length - 1) / 2] : (scene[scene.length / 2 - 1] + scene[scene.length / 2]) / 2) : null;
  const util: Record<string, number | null> = {};
  for (const g of GROUPS) util[g] = secs > 0 && (denom[g] ?? 0) > 0 ? +((busy[g] ?? 0) / denom[g]).toFixed(3) : null;
  return {
    shifts: list.length, incidents: inc,
    types: +(types / n).toFixed(2), scenarios: +(scen / n).toFixed(2), newType: +(newType / n).toFixed(2), repeatShare: +(rep / Math.max(1, inc)).toFixed(3),
    daily: +(daily / n).toFixed(2), regular: +(regular / n).toFixed(2), benign: +(benign / n).toFixed(2), benignShare: +(benign / Math.max(1, inc)).toFixed(3),
    dailySceneMedian: med === null ? null : Math.round(med), dailyUnitsAvg: dn ? +(du / dn).toFixed(2) : null,
    util, emsZeroShare: secs > 0 ? +(emsZero / secs).toFixed(3) : null,
  };
}

const pct = (v: number | null): string => (v === null ? 'n/a' : `${Math.round(v * 100)}%`);
export function kindsLine(k: KindsSum): string {
  return `kinds: types ${k.types}/shift · scenarios ${k.scenarios}/shift · new-type ${k.newType}/shift · repeat ${pct(k.repeatShare)} · daily ${k.daily}/shift · regular ${k.regular}/shift · benign ${k.benign}/shift (${pct(k.benignShare)})`
    + ` · daily scene median ${k.dailySceneMedian === null ? 'n/a' : k.dailySceneMedian + 's'} · daily units ${k.dailyUnitsAvg === null ? 'n/a' : k.dailyUnitsAvg}`
    + ` · util police ${pct(k.util.police)} fire ${pct(k.util.fire)} ems ${pct(k.util.ems)} civil ${pct(k.util.civil)} · ground ems 0 ${pct(k.emsZeroShare)}`;
}
export function kindsJson(k: KindsSum): Record<string, unknown> { return { ...k }; }
