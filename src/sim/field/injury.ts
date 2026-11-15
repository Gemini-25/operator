// 부상과 사망의 공통 모델 (H1). 구조 대상·대원·용의자 세 부류가 같은 원인 이름(InjuryCause), 같은 중증도 단계(bandOf),
// 같은 기록(Injury)을 쓴다.
//
// 잎 모듈이다: types · rng(타입) · engine(타입)만 import 한다. agents·hazards·executor·sceneManager·resources 를 import 하지 않는다 —
// hazards.ts 가 bandOf 를 다시 내보내므로 거꾸로 부르면 순환이 생겨 초기화 전의 값을 읽는다 (설계서 H1 §2.2).
//
// 단계 1(지금): **기록만 한다.** 체력·출혈을 바꾸는 식은 각 자리에 그대로 있고, 여기 함수들은 이미 계산된 값을 Injury 에 적을 뿐이다.
// 난수를 부르지 않고(injuryRng 는 뒤 단계가 쓴다) 기록(emit)도 남기지 않는다 — 결과와 기록 해시는 바뀌지 않는다.
// 뒤 단계가 여기에 더한다: hurtCas·hurtResponder·hurtHostile·protection·hurtF·treatEffect·needsHospital·mateNeedsHospital·threatOverAt·outShifts·LIGHT_WORK.

import type { Sim } from '../engine';
import type { Rng } from '../rng';
import type { Casualty, Hostile, Incident, Injury, InjuryCause, Responder, Scene } from '../types';

export const CAUSE_NAME: Record<InjuryCause, string> = {
  gunshot: '총상', stab: '자상', blunt: '타박상', burn: '화상', smoke: '연기 흡입', toxic: '유독 가스 흡입', fall: '추락', crush: '잔해 깔림', blast: '폭발',
  drown: '익수', electric: '감전', exhaustion: '열 탈진', vehicle: '차량 충격', exposure: '실외 노출', illness: '급성 질환',
};

/** 중증도 단계: 0 경상(>70) · 1 중상(41~70) · 2 위중(1~40) · 3 사망(≤0). 함수 선언으로 둔다 (순환 import 에서도 끌어올려져 안전하다) */
export function bandOf(h: number): number { return h <= 0 ? 3 : h > 70 ? 0 : h > 40 ? 1 : 2; }

const injuryRngs = new WeakMap<Scene, Map<string, Rng>>();
/**
 * 부상 규칙의 목적별 난수 흐름 injury:<현장 id>:<목적>.
 * 목적 = 'trap'(2차 붕괴 갇힘) · 'extricate'(구출 중 사고) · 'fall'(잔해 바닥) · 'fight'(몸싸움) · 'down'(용의자 문턱의 남는 체력) · 'self'(자해) · 'electric'.
 * 한 흐름을 여럿이 나눠 쓰면 뒤 단계에서 소비자가 늘 때마다 앞 단계의 결과가 밀린다 — 새 소비자는 새 이름을 쓰고, 정한 이름은 바꾸지 않는다.
 * fork 는 부모 흐름의 상태를 바꾸지 않으므로 언제 처음 만들어도 다른 흐름은 흔들리지 않는다.
 */
export function injuryRng(sim: Sim, s: Scene, purpose: string): Rng {
  let m = injuryRngs.get(s);
  if (!m) { m = new Map(); injuryRngs.set(s, m); }
  let r = m.get(purpose);
  if (!r) { r = sim.rng.fork('injury:' + s.id + ':' + purpose); m.set(purpose, r); }
  return r;
}

/**
 * 기록만 한다 (체력은 건드리지 않는다). 같은 원인은 한 줄로 합친다: dmg 를 더하고, sev 는 닿은 가장 나쁜 단계, last 는 지금.
 * by·byKind·ev 는 그 원인으로 처음 다쳤을 때의 것을 남긴다. 돌려주는 배열을 그 사람의 injuries 에 다시 넣는다(없으면 여기서 만든다).
 */
export function noteInjury(list: Injury[] | undefined, cause: InjuryCause, dmg: number, t: number, sevAfter: number, by = -1, byKind: Injury['byKind'] = 'world', ev = -1): Injury[] {
  if (!list) return [{ cause, dmg, sev: sevAfter, t, last: t, by, byKind, ev }];
  for (let k = 0; k < list.length; k++) {
    const j = list[k];
    if (j.cause !== cause) continue;
    j.dmg += dmg; j.last = t;
    if (sevAfter > j.sev) j.sev = sevAfter;
    if (j.ev < 0 && ev >= 0) j.ev = ev;
    return list;
  }
  list.push({ cause, dmg, sev: sevAfter, t, last: t, by, byKind, ev });
  return list;
}

/** dmg 가 가장 큰 원인 (같으면 먼저 다친 쪽). 기록이 없으면 null */
export function mainCause(list: Injury[] | undefined): InjuryCause | null {
  if (!list || !list.length) return null;
  let best = list[0];
  for (let k = 1; k < list.length; k++) if (list[k].dmg > best.dmg) best = list[k];
  return best.cause;
}

/** 가스 누출 현장(유형이 가스 누출이거나 가스 규칙이 얹힌 현장)의 s.smoke 는 연기가 아니라 유독 가스로 적는다 */
export function smokeCause(s: Scene): InjuryCause {
  return s.kind === 'hazmat' || (s.rules !== undefined && s.rules.indexOf('gas') >= 0) ? 'toxic' : 'smoke';
}

// ───────────────────────── 한 번 피해의 기록 (단계 1) ─────────────────────────
// 피해를 주는 자리는 식을 그대로 두고, 바꾸기 전의 값(hp0, bleed0)을 잡아 두었다가 바꾼 뒤에 아래 함수를 한 줄 부른다.
// 깎인 양은 (앞 − 뒤)로 센다 — 그 자리의 난수·연산 순서를 건드리지 않는다. 뒤 단계가 이 줄들을 hurt* 로 바꾼다.

/**
 * 구조 대상이 방금 다쳤다: 깎인 체력을 그 원인으로 적는다. 그 자리가 출혈(bleed)을 키웠으면 지금의 출혈 원인도 그 원인으로 바꾸고,
 * 체력이 0 이하가 됐으면 숨지게 한 원인을 적는다(이미 있으면 그대로 — 사망 처리는 지금처럼 tickCasualties 가 다음 틱에 한다).
 */
export function noteCasHurt(c: Casualty, cause: InjuryCause, hp0: number, bleed0: number, t: number, by = -1, byKind: Injury['byKind'] = 'world', ev = -1): void {
  const dmg = hp0 - c.health;
  if (dmg > 0) c.injuries = noteInjury(c.injuries, cause, dmg, t, bandOf(c.health), by, byKind, ev);
  if (c.bleed > bleed0) c.bleedCause = cause;
  if (c.health <= 0 && c.deathCause === undefined) c.deathCause = cause;
}
/**
 * 대원이 방금 다쳤다: 깎인 체력을 그 원인으로 적는다 (방호를 뺀 뒤의 값이다 — 그 자리의 식이 이미 뺐다).
 * 지금 모델에서 대원은 숨지지 않으므로(체력 하한 1 — agentHealth) 숨지지 않은 대원의 sev 는 위중(2)까지만 적는다.
 */
export function noteRespHurt(r: Responder, cause: InjuryCause, hp0: number, t: number, by = -1, byKind: Injury['byKind'] = 'world', ev = -1): void {
  const dmg = hp0 - r.health;
  if (dmg > 0) r.injuries = noteInjury(r.injuries, cause, dmg, t, r.dead ? 3 : Math.min(2, bandOf(r.health)), by, byKind, ev);
}
/** 용의자가 방금 다쳤다. 지금 모델에서 체력 0 이하는 '제압'(쓰러짐)이지 사망이 아니다 — 숨지지 않은 용의자의 sev 는 위중(2)까지만 적는다 */
export function noteHostileHurt(h: Hostile, cause: InjuryCause, hp0: number, t: number, by = -1, byKind: Injury['byKind'] = 'world', ev = -1): void {
  const dmg = hp0 - h.health;
  if (dmg > 0) h.injuries = noteInjury(h.injuries, cause, dmg, t, h.dead ? 3 : Math.min(2, bandOf(h.health)), by, byKind, ev);
}

// ───────────────────────── 구조 대상의 매 틱 악화 (단계 1) ─────────────────────────
/**
 * tickCasualties 가 방금 깎은 한 틱의 악화를 항별로 적는다 (초당 값 × dt). 식은 그쪽에 그대로 있고 여기서는 같은 항을 받아 적기만 한다.
 *   wound = 상처(bleed) 항 — c.bleedCause 가 없으면 적지 않는다 · smoke = 연기(가스 현장이면 유독 가스) · burn = 불 · expo = 실외 노출
 */
export function noteDecay(c: Casualty, s: Scene, wound: number, smoke: number, burn: number, expo: number, dt: number, t: number): void {
  const sev = bandOf(c.health);
  if (wound > 0 && c.bleedCause !== undefined) c.injuries = noteInjury(c.injuries, c.bleedCause, wound * dt, t, sev);
  if (smoke > 0) c.injuries = noteInjury(c.injuries, smokeCause(s), smoke * dt, t, sev);
  if (burn > 0) c.injuries = noteInjury(c.injuries, 'burn', burn * dt, t, sev);
  if (expo > 0) c.injuries = noteInjury(c.injuries, 'exposure', expo * dt, t, sev);
}
/**
 * 악화로 숨진 틱의 원인: 그 틱의 가장 큰 항. 상처 항이 가장 큰데 출혈 원인을 모르면 다음으로 큰 항,
 * 그것도 없으면 지금까지의 가장 큰 원인, 그래도 없으면 그 현장의 처음 원인.
 */
export function decayCause(c: Casualty, s: Scene, I: Incident, wound: number, smoke: number, burn: number, expo: number): InjuryCause {
  let best: InjuryCause | null = null, bv = 0;
  if (wound > bv && c.bleedCause !== undefined) { bv = wound; best = c.bleedCause; }
  if (smoke > bv) { bv = smoke; best = smokeCause(s); }
  if (burn > bv) { bv = burn; best = 'burn'; }
  if (expo > bv) { bv = expo; best = 'exposure'; }
  return best ?? mainCause(c.injuries) ?? initialCause(s, I, c);
}

// ───────────────────────── 처음 상태의 원인 ─────────────────────────
/** 현장이 만들어질 때 이미 다쳐 있던 구조 대상의 원인 — 변형을 먼저, 그다음 유형을 본다 (설계서 H1 §2.3 의 표, 위에서 처음 맞는 줄) */
export function initialCause(s: Scene, I: Incident, c: Casualty): InjuryCause {
  const type = I.truth.type, v = I.truth.variant;
  if (c.inWater) return 'drown';
  if (type === 'traffic' && v === 'manhole') return 'fall';
  if (type === 'traffic' && v === 'tree') return 'crush';
  if (type === 'medical' && v === 'trauma') return 'blunt';
  if (type === 'collapse' && v === 'gasblast') return 'blast';
  if (c.inVehicle !== null || type === 'traffic') return 'vehicle';
  switch (type) {
    case 'fire': return 'smoke';
    case 'collapse': return 'crush';
    case 'hazmat': return 'toxic';
    case 'search': return 'exposure';
    case 'medical': return 'illness';
    case 'water': return 'drown';
    default: return v === 'shooter' || v === 'robbery' ? 'gunshot' : 'blunt';      // 무장: 총격범·강도는 총상, 그 밖(가정 폭력·폭동 …)은 타박상
  }
}
/**
 * 현장이 만들어진 직후 처음 상태의 원인을 붙인다. sceneManager.createScene 이 buildScene 바로 뒤에 한 번 부른다
 * (추격전의 차가 서서 현장을 다시 만들 때도 createScene 을 거친다).
 * 다친 사람(체력 < 100 이거나 출혈 > 0)에게만 injuries 한 줄(byKind 'initial', dmg = 100 − 체력)과 bleedCause 를 붙인다.
 * 난수를 부르지 않고 injuries·bleedCause 말고는 쓰지 않는다 — 결과는 바뀌지 않는다.
 * 사건 중에 붙는 사람(가스 노출 시민·해일에 휩쓸린 사람)은 그 사람을 만들거나 다치게 한 코드가 원인을 적는다.
 */
export function initInjuries(sim: Sim, s: Scene, I: Incident): void {
  for (let k = 0; k < s.casualties.length; k++) {
    const c = s.casualties[k];
    if (c.health >= 100 && c.bleed <= 0) continue;
    const cause = initialCause(s, I, c);
    c.injuries = noteInjury(c.injuries, cause, Math.max(0, 100 - c.health), sim.t, bandOf(c.health), -1, 'initial');
    if (c.bleed > 0) c.bleedCause = cause;
  }
  for (let k = 0; k < s.hostiles.length; k++) {
    const h = s.hostiles[k];
    if (h.health >= 100) continue;
    // 처음부터 다친 용의자는 지금 추격전 사고로 선 도주 용의자뿐이다
    h.injuries = noteInjury(h.injuries, I.pursuit ? 'vehicle' : 'blunt', 100 - h.health, sim.t, bandOf(h.health), -1, 'initial');
  }
}
