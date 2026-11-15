// 부상과 사망의 공통 모델 (H1). 구조 대상·대원·용의자 세 부류가 같은 원인 이름(InjuryCause), 같은 중증도 단계(bandOf),
// 같은 기록(Injury)을 쓴다.
//
// 잎 모듈이다: types · rng(타입) · engine(타입) · util · crews(대원의 방호 장비)만 import 한다. agents·hazards·executor·sceneManager·resources 를 import 하지 않는다 —
// hazards.ts 가 bandOf 를, agents.ts 가 hurtF 를 가져가므로 거꾸로 부르면 순환이 생겨 초기화 전의 값을 읽는다 (설계서 H1 §2.2).
//
// 피해는 한 길로만 준다: 구조 대상은 hurtCas·hurtCasTo(단계 3), 대원은 hurtResponder·woundTick(단계 4a), 용의자는 hurtHostile(단계 5).
// 피해 자체의 문구(emit)는 남기지 않는다: 문구는 피해를 준 자리(상태를 바꾸는 그 코드)가 남기고 그 id 를 o.ev 로 넘긴다. 대원의 상태 전이(부상·쓰러짐·순직)는 sceneManager.agentHealth 가 한다.
// 예외는 용의자 하나다: 용의자의 쓰러짐·사망 전이는 hurtHostile 안에서 바로 하고(같은 틱에 다른 대원이 한 번 더 쏘지 않게), 그 문구도 상태를 바꾸는 그 자리 — hurtHostile — 가 남긴다 (설계서 H1 §4.6).
// 단계 4b 가 더한 것: careResponder·needsHospital·mateNeedsHospital·canDeploy·LIGHT_WORK·HOSPITAL_BLEED (처치 식 treatPlan·treatEffect 는 4b 의 준비 커밋).
// 단계 5 가 더한 것: hurtHostile·careHostile·hosNeedsCare·threatOverAt 과 용의자의 상수(HOSTILE_BLEED·HOSTILE_BLEED_MAX·HOSTILE_LEFT·SELF_HARM·SELF_HARM_HIT).
// 단계 6 이 더한 것: outShifts (교대 끝의 결장 표 — 보고서와 I2 가 함께 부른다).

import { armorOf, blastFactor, hasKit, kitUses, kitWorks, medLevelOf } from '../crews';
import type { Sim } from '../engine';
import { emit, raiseProblem } from '../events';
import type { Rng } from '../rng';
import type { Casualty, FieldAgent, Hostile, Incident, Injury, InjuryCause, MateBelief, Responder, Scene, Unit, WorkKind } from '../types';
import { clamp, josa } from '../util';

export const CAUSE_NAME: Record<InjuryCause, string> = {
  gunshot: '총상', stab: '자상', blunt: '타박상', burn: '화상', smoke: '연기 흡입', toxic: '유독 가스 흡입', fall: '추락', crush: '잔해 깔림', blast: '폭발',
  drown: '익수', electric: '감전', exhaustion: '열 탈진', vehicle: '차량 충격', exposure: '실외 노출', illness: '급성 질환',
  animal: '동물·벌 피해',      // (N8) 물림·받힘·쏘임
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

// ───────────────────────── 피해는 한 길로만 (단계 3: 구조 대상) ─────────────────────────
/**
 * hurt* 가 받는 선택 사항. 구조 대상(hurtCas)이 쓰는 것은 by·byKind·ev·bleed·immobile 이고, tick·down 은 대원·용의자용이다(단계 4a·5).
 *   by·byKind  가해자 (용의자 id 또는 대원 rid) — 기록에만 남는다
 *   ev         피해를 준 자리가 이미 남긴 기록 id — Injury.ev 와 구조 대상의 causeEvent 에 넣는다 (hurt* 는 피해 자체의 문구를 남기지 않는다)
 *   tick       매 틱 피해 (문턱 없음)
 *   bleed      구조 대상의 bleed 를 이 값 이상으로 올린다 (처치 전 값 bleed0 도 지금 값으로 맞춘다 — 새 상처는 다시 처치할 수 있다)
 *   immobile   구조 대상을 걷지 못하게 한다 (걷던 사람은 멈추고, 갇힌 사람은 그대로 갇혀 있다)
 *   down       한 번에 쓰러뜨린다 (대원·용의자)
 */
export interface HurtOpts { by?: number; byKind?: Injury['byKind']; ev?: number; tick?: boolean; bleed?: number; immobile?: boolean; down?: boolean }

/**
 * 구조 대상이 다친다: 체력을 amount 만큼 깎고 그 원인으로 적는다. 구조 대상의 체력을 깎는 자리는 모두 이 함수(또는 hurtCasTo)를 거친다 —
 * 매 틱 악화(hazards.tickCasualties)만 자기 식을 그대로 두고 noteDecay 로 적는다.
 * 숨졌거나 사건이 끝났으면 아무것도 하지 않는다 (§2.6 — 판정 뒤에는 누구도 더 다치지 않는다. 기록을 남기는 자리는 부르기 전에 스스로 가린다).
 * 체력이 0 이하가 되면 숨지게 한 원인을 적는다 — 사망 처리(dead·기록)는 지금처럼 tickCasualties 가 다음 틱에 한다.
 * 피해 자체의 문구는 남기지 않는다: 문구는 피해를 준 자리가 남기고 그 id 를 o.ev 로 넘긴다 (로그 중복).
 */
export function hurtCas(sim: Sim, s: Scene, I: Incident, c: Casualty, amount: number, cause: InjuryCause, o?: HurtOpts): void {
  hurtCasTo(sim, s, I, c, c.health - amount, cause, o);
}
/**
 * hurtCas 와 같되 깎을 양 대신 **깎은 뒤의 체력**을 받는다. 하한·상한을 두고 깎는 자리가 쓴다 —
 * `Math.max(8, c.health - x)`(이 일만으로는 숨지지 않는다)나 `Math.min(c.health, hp)`(이 값까지 떨어진다)를 그대로 넘기면
 * 부동소수점 끝자리까지 예전 식과 같다(양으로 바꿔 넘기면 h − (h − m) 이 m 과 한 끝자리 다를 수 있다).
 * 지금보다 높은 값은 무시한다 — 다치는 일로 체력이 오르지는 않는다.
 */
export function hurtCasTo(sim: Sim, s: Scene, I: Incident, c: Casualty, to: number, cause: InjuryCause, o?: HurtOpts): void {
  if (c.dead || I.phase === 'closed') return;
  const hp0 = c.health;
  if (to < hp0) {
    c.health = to;
    c.injuries = noteInjury(c.injuries, cause, hp0 - to, sim.t, bandOf(to), o?.by ?? -1, o?.byKind ?? 'world', o?.ev ?? -1);
  }
  if (o !== undefined) {
    if (o.bleed !== undefined) { if (o.bleed > c.bleed) { c.bleed = o.bleed; c.bleedCause = cause; } c.bleed0 = c.bleed; }
    if (o.immobile) { if (c.mob === 'mobile') c.mob = 'immobile'; c.walking = false; c.path = null; }
    if (o.ev !== undefined && o.ev >= 0) c.causeEvent = o.ev;
  }
  if (c.health <= 0 && c.deathCause === undefined) c.deathCause = cause;
}

// ───────────────────────── 대원 (단계 4a) ─────────────────────────
/** 대원·용의자가 쓰러지는 체력 */
export const DOWN_AT = 15;
/** 대원이 물러나는 체력 (이 아래면 후퇴한다 — brain.ts 의 후퇴 붙잡기, 지휘관의 지시 제외와 같은 기준) */
export const HURT_AT = 40;
/**
 * 출혈로 물러나는 조건: 상처 출혈이 이 값 이상이고 체력이 MATE_RETREAT_HP 아래일 때 (둘 다). 균형 손잡이 1번 (§9.3).
 * 설계서의 처음 값은 0.06 — 순찰 경관이 큰 총알 한 발(방호 뒤 30 초과)에 물러나는 값이었다. 재 보니 물러나는 대원이 너무 많았다
 * (보통 60교대의 다친 대원 0.17 → 0.55/교대, 무장 사건 성공률 −11%p, 극한 3.6/교대 — 흉기에 세 번 베인 대원도 물러났다).
 * 0.09 면 총알은 두 번째 명중에(한 발의 출혈은 0.084 이하), 흉기는 체력 40 아래가 되기 전에는 물러나지 않는다(자상의 출혈 0.0015 × 60 = 0.09).
 */
export const MATE_RETREAT_BLEED = 0.09, MATE_RETREAT_HP = 70;
/** 대원 문턱: 이 틱이 시작될 때 체력이 이 값 이상이던 대원은 "한 번" 피해가 그 틱에 몇 번 겹쳐도 숨지지 않는다 (체력 MATE_FLOOR 로 남아 쓰러진다) */
export const MATE_LETHAL_FROM = 41, MATE_FLOOR = 8;
/** 쓰러질 만큼 다친(체력 DOWN_AT 이하) 대원의 출혈 상한 — 체력 8 에서 200초, 15 에서 375초 (동료가 닿을 시간) */
export const DOWN_BLEED_CAP = 0.04;
/** 대원의 상처 출혈 상한 (초당) */
export const MATE_BLEED_MAX = 0.12;
/** 피해 1 마다 얻는 상처 출혈 (대원·용의자의 "한 번" 피해만 — 매 틱 피해는 출혈을 만들지 않는다). 구조 대상의 bleed 는 각 자리가 직접 정한다 (§2.3) */
export const BLEED_PER_DMG: Record<InjuryCause, number> = {
  gunshot: 0.0024, stab: 0.0015, blunt: 0.0003, burn: 0.0006, smoke: 0, toxic: 0, fall: 0.0008, crush: 0.001, blast: 0.0012,
  drown: 0, electric: 0.0005, exhaustion: 0, vehicle: 0.0015, exposure: 0, illness: 0,
  animal: 0.0003,      // (N8) 타박상(blunt)과 같다 — 물림·쏘임은 출혈이 크지 않다
};

/** 다친 대원은 느려진다: 체력 70 이상은 1, 40 에서 0.75. agents.staminaF 에 곱한다 (이동·작업 진도·사격이 함께 바뀐다). 자기 몸이다 */
export function hurtF(r: Responder): number { return 0.75 + 0.25 * clamp((r.health - HURT_AT) / 30, 0, 1); }
/** 물러나야 하는 몸인가: 체력 40 아래, 또는 상처 출혈이 크고(≥ 0.06) 체력이 70 아래. 대원이 자기 몸으로 판단한다 (brain·executor 의 후퇴, agentHealth 의 부상 전이) */
export function mustRetreat(r: Responder): boolean {
  return r.health < HURT_AT || ((r.bleed ?? 0) >= MATE_RETREAT_BLEED && r.health < MATE_RETREAT_HP);
}

/**
 * 방호: 피해에서 빼는 몫(0~0.95). 대원이 받는 피해 = 방호 전 피해 × (1 − 몫). 입은 장비가 정한다 (R1 의 사람 장비 — 부대 값이 아니다).
 * 읽기만 한다: 방호 장비(조끼·방화복·공기호흡기·방호복)는 고장 추첨을 받지 않으므로 hasKit 으로 본다 (kitWorks 처럼 기록을 남기지 않는다 — 화면이 불러도 된다).
 * 예전 식을 그대로 옮긴 몫 (단계 4a-1):
 *   총상  armorOf × 0.6 (방패는 교전·봉쇄 중에만 — engaging)
 *   화상  방화복 1 − 2.6/9            연기·유독 가스  공기호흡기에 공기가 남았을 때 1 − 0.1/1.3 (통이 비면 0)
 *   폭발·잔해  1 − blastFactor (폭발물 방호복 0.65 · 방화복 0.3 — 천장·2차 붕괴가 blast 로 주던 몫 그대로)
 * 예전에는 방호가 없던 몫 (단계 4a-2, §2.4 "새로" 열 — 균형 변경):
 *   자상  armorOf × 0.5 (흉기에도 조끼가 듣는다)       유독 가스  화학 보호복 대원(hazTech)은 0.95 (공기가 남았을 때)
 *   잔해  방검·방탄 조끼 0.1 (방화복 0.3·방호복 0.65 보다 작으므로 더 큰 쪽)       추락  방화복 0.2       감전  방화복 0.4
 *   타박상·차량·익수·탈진·실외 노출·질환에는 방호가 없다 (익수는 R2 의 사고 식이 구명조끼·드라이슈트로 이미 줄인다)
 * u 는 지금 쓰지 않는다 (R1 이 부대 값을 사람 장비로 옮겼다) — 서명은 설계서 그대로 둔다.
 */
export function protection(sim: Sim, r: Responder, u: Unit, cause: InjuryCause, engaging = false): number {
  const rid = r.id;
  switch (cause) {
    case 'gunshot': return armorOf(sim, rid, engaging) * 0.6;
    case 'stab': return armorOf(sim, rid, engaging) * 0.5;
    case 'burn': return hasKit(sim, rid, 'turnout') ? 1 - 2.6 / 9 : 0;
    case 'smoke': return hasKit(sim, rid, 'scba') && kitUses(sim, rid, 'scba') > 0 ? 1 - 0.1 / 1.3 : 0;
    case 'toxic': return hasKit(sim, rid, 'scba') && kitUses(sim, rid, 'scba') > 0 ? (r.role === 'hazTech' ? 0.95 : 1 - 0.1 / 1.3) : 0;
    case 'blast': return 1 - blastFactor(sim, rid);
    case 'crush': return Math.max(1 - blastFactor(sim, rid), hasKit(sim, rid, 'vest') || hasKit(sim, rid, 'plate') ? 0.1 : 0);
    case 'fall': return hasKit(sim, rid, 'turnout') ? 0.2 : 0;
    case 'electric': return hasKit(sim, rid, 'turnout') ? 0.4 : 0;      // (N8) 절연 장비 insulKit 0.9 는 그 장비가 생기는 단계 2b 에 이 줄 앞에 더한다
    case 'animal': return hasKit(sim, rid, 'turnout') ? 0.3 : 0;      // (N8) 방화복이 물림·쏘임을 조금 막는다. 벌 보호복 beeSuit 0.95 는 그 장비가 생기는 단계 2b 에 더한다
    default: return 0;
  }
}

/** 이 틱에 그 대원을 가장 크게 깎은 원인 (부상·쓰러짐·순직 기록의 원인 낱말). 대원 객체의 모양을 바꾸지 않으려고 따로 둔다 */
const tickHurt = new WeakMap<Responder, { t: number; cause: InjuryCause; dmg: number }>();
function noteTick(r: Responder, t: number, cause: InjuryCause, dmg: number): void {
  const e = tickHurt.get(r);
  if (!e) { tickHurt.set(r, { t, cause, dmg }); return; }
  if (e.t !== t || dmg > e.dmg) { e.t = t; e.cause = cause; e.dmg = dmg; }
}
/** 이 틱의 가장 큰 피해 항의 원인. 이 틱에 다치지 않았으면 지금까지의 가장 큰 원인(없으면 null) */
export function hurtCauseNow(r: Responder, t: number): InjuryCause | null {
  const e = tickHurt.get(r);
  return e && e.t === t ? e.cause : mainCause(r.injuries);
}

/**
 * 대원이 다친다: 방호를 빼고(protection), 문턱을 걸고, 새 상처의 출혈을 더하고, 그 원인으로 적는다. 깎인 양을 돌려준다.
 * 대원의 체력을 깎는 자리는 모두 이 함수(와 상처 악화 woundTick)를 거친다. 상태 전이(부상·쓰러짐·순직)와 그 기록은 하지 않는다 —
 * sceneManager.agentHealth 가 같은 틱에 한다. 숨졌거나 사건이 끝났으면 아무것도 하지 않는다 (§2.6 — 기록을 남기는 자리는 부르기 전에 스스로 가린다).
 *   o.tick  매 틱 피해(연기·불): 문턱도 출혈도 없다
 *   한 번 피해: ① 대원 문턱 — 이 틱이 시작될 때(a.hpTick) 체력이 41 이상이던 대원은 0 아래로 가지 않고 8 로 남는다(같은 틱에 몇 번 겹쳐도).
 *              ② 출혈 = min(0.12, 출혈 + 계수 × 방호 뒤 피해 × injuryMul), 처치 전 값도 그 값으로, 받은 처치는 0 으로(새 상처는 다시 처치할 수 있다).
 *              ③ 체력이 15 이하로 남으면 출혈은 0.04 이하.
 *   o.down  한 번에 쓰러뜨린다 (체력을 15 이하로 — 감전). 문턱 때문에 0 아래로는 가지 않는다
 *   o.ev    피해를 준 자리가 이미 남긴 기록 id — Injury.ev 와 a.hurtEv(RESPONDER_HURT·RESPONDER_KILLED 의 원인)에 넣는다
 */
export function hurtResponder(sim: Sim, s: Scene, I: Incident, a: FieldAgent, raw: number, cause: InjuryCause, o?: HurtOpts): number {
  const r = sim.responders[a.rid];
  if (r.dead || I.phase === 'closed' || a.status === 'left') return 0;
  const tick = o !== undefined && o.tick === true;
  const engaging = a.task !== null && (a.task.kind === 'engage' || a.task.kind === 'perimeter');      // 방패는 교전·봉쇄 임무 중에만 세운다
  const dmg = raw * (1 - protection(sim, r, sim.units[a.unitId], cause, engaging));
  let after = r.health - dmg;
  if (!tick) {
    if (o !== undefined && o.down === true && after > DOWN_AT) after = DOWN_AT;
    if ((a.hpTick ?? r.health) >= MATE_LETHAL_FROM && after <= 0) after = Math.min(r.health, MATE_FLOOR);      // 대원 문턱 (다치는 일로 체력이 오르지는 않는다)
  }
  if (!(after < r.health)) return 0;
  const took = r.health - after;
  r.health = after;
  if (!tick) {
    const k = BLEED_PER_DMG[cause];
    if (k > 0) {
      const b = Math.min(MATE_BLEED_MAX, (r.bleed ?? 0) + k * dmg * sim.tune.injuryMul);
      r.bleed = b; r.bleed0 = b; r.treatQ = 0; r.bleedCause = cause;
    }
    if (after <= DOWN_AT && (r.bleed ?? 0) > DOWN_BLEED_CAP) { r.bleed = DOWN_BLEED_CAP; r.bleed0 = DOWN_BLEED_CAP; }
    if (after <= 0 && r.deathCause === undefined) r.deathCause = cause;      // 이미 크게 다친 대원이 한 번 더 크게 다쳤다 — 순직 처리는 agentHealth 가 이 틱에 한다
  }
  const ev = o !== undefined && o.ev !== undefined ? o.ev : -1;
  r.injuries = noteInjury(r.injuries, cause, took, sim.t, bandOf(after), o?.by ?? -1, o?.byKind ?? 'world', ev);
  if (ev >= 0) a.hurtEv = ev;
  noteTick(r, sim.t, cause, took);
  return took;
}
/**
 * 상처 악화 한 틱: 대원의 출혈이 체력을 깎는다 (방호도 문턱도 없다). k = 배율 (현장·끌려가는 중 1 — §2.6). 깎인 양을 돌려준다.
 * 판정 뒤에 멈추는 것은 부르는 쪽(agentHealth)이 본다.
 */
export function woundTick(sim: Sim, r: Responder, k: number): number {
  const b = r.bleed ?? 0;
  if (b <= 0 || k <= 0 || r.dead) return 0;
  const d = b * k * sim.dt;
  r.health -= d;
  const cause = r.bleedCause ?? mainCause(r.injuries) ?? 'blunt';
  r.injuries = noteInjury(r.injuries, cause, d, sim.t, bandOf(r.health));
  noteTick(r, sim.t, cause, d);
  return d;
}

// ───────────────────────── 처치 (세 부류가 같은 식 — §2.6) ─────────────────────────
/**
 * 처치의 질 — 계획용. 그 대원의 의료 능력과 든 의료 장비로 어림한다: q = clamp(medical × (0.5 + 0.5 × 장비 수준) × 1.15, 0.2, 1).
 * 제세동기는 심정지 환자(응급 현장의 심정지 변형)나 체력 25 미만인 사람의 처치 질을 0.2 올린다(상한 1).
 * 든 장비로만 본다(hasKit — 숨은 고장을 모른다, 드러내지도 않는다): "다시 볼 가치가 있는가"를 정하는 데 쓴다.
 */
export function treatPlan(sim: Sim, s: Scene, rid: number, health: number): number {
  const r = sim.responders[rid];
  const q0 = clamp(r.skills.medical * (0.5 + 0.5 * medLevelOf(sim, rid)) * 1.15, 0.2, 1);
  const shock = (s.kind === 'medical' && s.variant === 'arrest') || health < 25;
  return shock && hasKit(sim, rid, 'aed') ? Math.min(1, q0 + 0.2) : q0;
}
/**
 * 처치를 마치는 순간의 질과 효과 — 효과 자리다(제세동기·의사 장비의 숨은 고장은 이때 드러난다: kitWorks, I 는 그 고장 기록의 사건).
 *   had   이미 받은 처치의 질 (처음이면 −1)
 *   돌려주는 값: q 처치의 질 · heal 오르는 체력(처음 처치면 8q, 의사 장비가 위중한 사람(체력 40 미만)을 볼 때는 15) · bleedK 처치 전 출혈에 곱하는 값(1 − 0.9q, 의사 장비 1 − 0.95q)
 *   앞선 처치보다 나아진 것이 없으면(제세동기가 듣지 않았다) null — 처치의 수준을 낮추지 않는다.
 * 구조 대상(executor 의 treat)·다친 대원(treatMate)·용의자(treatSuspect — 단계 5)가 함께 쓴다.
 */
export function treatEffect(sim: Sim, s: Scene, I: Incident, rid: number, health: number, had = -1): { q: number; heal: number; bleedK: number } | null {
  const r = sim.responders[rid];
  const q0 = clamp(r.skills.medical * (0.5 + 0.5 * medLevelOf(sim, rid)) * 1.15, 0.2, 1);
  const shock = (s.kind === 'medical' && s.variant === 'arrest') || health < 25;
  const q = shock && kitWorks(sim, rid, 'aed', I) ? Math.min(1, q0 + 0.2) : q0;
  if (had >= 0 && q <= had) return null;
  const doc = kitWorks(sim, rid, 'doctorKit', I);      // 의사 장비(약물·수혈): 위중한 사람을 더 끌어올리고 악화를 더 늦춘다
  return { q, heal: doc && health < 40 ? 15 : had < 0 ? 8 * q : 0, bleedK: 1 - (doc ? 0.95 : 0.9) * q };
}

/** 처치를 받은 대원: 체력이 오르고(heal), 출혈은 처치 전 값 × bleedK, 받은 처치의 질을 적는다. 대원의 체력을 고치는 줄은 이 파일에만 둔다 */
export function careResponder(r: Responder, fx: { q: number; heal: number; bleedK: number }): void {
  if (fx.heal > 0) r.health = Math.min(100, r.health + fx.heal);
  r.treatQ = fx.q; r.bleed = (r.bleed0 ?? r.bleed ?? 0) * fx.bleedK;
}

// ───────────────────────── 후송 (단계 4b — §3.4) ─────────────────────────
/**
 * 병원이 필요한 상처의 출혈(초당). 이보다 적게 흘리는 상처는 현장에서 처치하고 일을 계속한다. 균형 손잡이.
 * 설계서의 처음 값은 0.01 — "피가 멎었는가"였다. 재 보니(60교대) 흉기에 한 번 베인 경관(0.015~0.03)과 총알 한 발을 맞은 대원(0.03~0.09)이
 * 사건이 끝날 때마다 모두 병원으로 실려 가(보통 1.5 · 어려움 2.9 · 극한 5.4명/교대), 가벼운 일로 돌아오는 대원이 180교대에 한 명도 없었다 —
 * 처치를 받아도 출혈이 0.01 아래로 내려가지 않는다(0.09 × (1 − 0.9q)).
 * 그래서 출혈로 물러나는 문턱(MATE_RETREAT_BLEED)과 같은 값으로 둔다: 출혈로 물러난 대원은 처치(출혈 × (1 − 0.9q))를 받으면 병원이 필요 없는 몸이 되어
 * 가벼운 일로 돌아오고(§3.6a), 물러날 만큼 흘리지 않는 상처(흉기 한두 번, 방호복 위의 총상 한 발)는 일을 계속한다. 병원으로 가는 것은
 * 쓰러졌던 대원 · 체력 40 이하 · 처치를 받지 못한 큰 출혈이다.
 */
export const HOSPITAL_BLEED = MATE_RETREAT_BLEED;
/**
 * 병원이 필요한 몸인가 — **진실**. 쓰러진 적이 있거나, 상처에서 피가 많이 나거나(HOSPITAL_BLEED 이상), 체력이 40 이하다. 숨졌거나 이미 후송 중·병원 인계된 사람은 아니다.
 * sceneManager(부대가 떠날 때 태울 사람, 가벼운 일로 돌아올 수 있는가)·실행기(처치 뒤 태울 것인가)·보고서·화면만 쓴다.
 * 지휘 쪽(commander.ts·orders/*·dispatch/*)은 부르지 않는다 — 같은 판단을 믿음으로 하는 mateNeedsHospital 을 쓴다.
 */
export function needsHospital(r: Responder): boolean {
  return !r.dead && r.care === undefined && (r.tDown !== undefined || (r.bleed ?? 0) >= HOSPITAL_BLEED || r.health <= HURT_AT);
}
/** 병원이 필요한 동료인가 — **믿음**. 'mate' 사실의 값만 본다: 위중이거나, 피를 많이 흘리거나(bleeding — 곁에서 본 사람이 HOSPITAL_BLEED 로 가린다), 쓰러졌던 동료. 숨졌거나 이미 후송된 동료는 아니다 */
export function mateNeedsHospital(v: MateBelief): boolean {
  return !v.dead && v.status !== 'evac' && (v.band >= 2 || v.bleeding || v.wasDown);
}
/**
 * 현장에 내릴 수 있는 대원인가 = 걸을 수 있는 대원 (§3.6 — 사용자 결정 2026-11-15): 온전한 대원과 걸을 수 있는 다친 대원(status 'injured').
 * 쓰러진 대원('down' — 순직 포함), 병원으로 후송된 대원(care), I2 의 결장('off')은 아니다. 조직이 아는 상태다(명부·후송 기록).
 * 배정(resources.crewReady)과 내리는 사람(sceneManager.unitArrived)이 같은 술어를 쓴다 — 따로 적으면 "배정은 됐는데 아무도 내리지 않는 부대"가 생긴다.
 */
export function canDeploy(r: Responder): boolean {
  return !r.dead && r.care === undefined && (r.status === 'ok' || r.status === 'injured');
}
/**
 * 걸을 수 있는 다친 대원(status 'injured')이 맡을 수 있는 가벼운 일 — 정본 (사용자 결정 2026-11-15 "가벼운 일은 계속", §2.5).
 * 교통 통제 · 출입구 봉쇄·통제 · 협상 · 목격자 면담 · 바깥의 소화전 연결, 그리고 대상이 안전 구역에 있는 처치(treat·treatMate — fitFor 가 본다).
 * R3 의 부상 줄이 같은 목록을 쓴다.
 */
export const LIGHT_WORK: ReadonlySet<WorkKind> = new Set<WorkKind>(['traffic', 'perimeter', 'negotiate', 'interview', 'hookup', 'treat', 'treatMate']);

// ───────────────────────── 용의자 (단계 5 — §4) ─────────────────────────
/** 용의자 상처의 출혈 배율 (대원과 같은 계수 BLEED_PER_DMG 에 곱한다). 균형 손잡이 3번의 둘째 (§9.3) */
export const HOSTILE_BLEED = 0.35;
/** 용의자의 상처 출혈 상한 (초당) */
export const HOSTILE_BLEED_MAX = 0.15;
/**
 * 용의자 문턱: 아직 쓰러지지 않은(체력 DOWN_AT 초과) 용의자가 "한 번" 피해로 0 아래까지 가면, 숨지지 않고 이 범위의 체력으로 남아 쓰러진다 (흐름 injury:<현장>:down).
 * 쓰러진 뒤 숨지기까지의 시간을 정한다 — 균형 손잡이 3번의 첫째 (§9.3). 문턱이 없으면 총에 맞아 쓰러지는 용의자의 약 78% 가 그 순간 이미 0 이하였다 (§1)
 */
export const HOSTILE_LEFT: readonly [number, number] = [4, 15];
/**
 * 투항 대신 스스로를 해칠 확률 — **사용자 결정(2026-11-15): 끈다 (0).** 조정하는 손잡이가 아니다: 값을 올리려면 사용자의 새 결정이 있어야 한다 (§4.5·§12.2-8).
 * 경로는 남겨 둔다 — 0 에서는 추첨(injury:<현장>:self)이 늘 거짓이라 투항이 예전처럼 일어나고, 그 흐름 밖의 결과는 바뀌지 않는다
 */
export const SELF_HARM = 0;
/** 자해의 피해 범위 (SELF_HARM 이 0 이 아닐 때만 쓰인다) */
export const SELF_HARM_HIT: readonly [number, number] = [22, 38];

/**
 * 용의자가 다친다: 문턱을 걸고, 새 상처의 출혈을 더하고, 그 원인으로 적은 뒤 쓰러짐·사망 전이를 그 자리에서 한다. 용의자의 체력을 깎는 자리는 모두 이 함수를 거친다.
 * 숨졌거나 · 사건이 끝났거나 · 현장을 벗어났거나(도주) · 차에 실렸으면 아무것도 하지 않는다 (§2.6·§2.7).
 *   o.tick  매 틱 피해(불·연기·가스·상처 악화 — rules/injury.ts): 문턱도 새 출혈도 없다 (쓰러진 뒤에는 이것으로 숨질 수 있다)
 *   한 번 피해: ① 용의자 문턱 — 아직 쓰러지지 않은(체력 15 초과) 용의자는 0 아래로 가지 않고 HOSTILE_LEFT 범위의 체력으로 남는다 (흐름 injury:<현장>:down).
 *              ② 출혈 = min(0.15, 출혈 + 계수 × 피해 × injuryMul × HOSTILE_BLEED), 처치 전 값도 그 값으로, 받은 처치는 0 으로 (새 상처는 다시 처치할 수 있다).
 *   o.down  한 번에 쓰러뜨린다 (체력을 15 이하로 — 감전 30%, R2 의 저격, 자해). 문턱 때문에 0 아래로는 가지 않는다
 *   o.ev    피해를 준 자리가 이미 남긴 기록 id — Injury.ev 와 쓰러짐·사망 기록의 원인으로 쓴다
 * 전이 (§4.1): 체력 15 이하가 처음 되면 쓰러진다(tDown, 상태 'down' — 검거된 용의자는 'arrested' 그대로) — 같은 틱에 다른 대원이 한 번 더 쏘지 않게 여기서 바로 세운다.
 * 0 이하가 되면 숨진다(dead·tDead·deathCause, 체력 0). 둘 다 그 문구를 이 자리에서 남긴다 (상태를 바꾸는 바로 그 코드 — §4.6)
 */
export function hurtHostile(sim: Sim, s: Scene, I: Incident, h: Hostile, amount: number, cause: InjuryCause, o?: HurtOpts): void {
  if (h.dead || I.phase === 'closed' || h.state === 'escaped' || (h.where !== undefined && h.where !== 'scene')) return;
  const tick = o !== undefined && o.tick === true;
  let after = h.health - amount;
  if (!tick) {
    if (o !== undefined && o.down === true && after > DOWN_AT) after = DOWN_AT;
    // 용의자 문턱: 쓰러지지 않은 용의자는 한 번 피해로 숨지지 않는다 (다치는 일로 체력이 오르지는 않는다)
    if (after <= 0 && h.tDown === undefined && h.health > DOWN_AT) after = Math.min(h.health, injuryRng(sim, s, 'down').range(HOSTILE_LEFT[0], HOSTILE_LEFT[1]));
  }
  if (!(after < h.health)) return;
  const took = h.health - after;
  h.health = after;
  if (!tick) {
    const k = BLEED_PER_DMG[cause];
    if (k > 0) {
      const b = Math.min(HOSTILE_BLEED_MAX, (h.bleed ?? 0) + k * amount * sim.tune.injuryMul * HOSTILE_BLEED);
      h.bleed = b; h.bleed0 = b; h.treatQ = 0; h.bleedCause = cause;
    }
  }
  const ev = o !== undefined && o.ev !== undefined ? o.ev : -1;
  h.injuries = noteInjury(h.injuries, cause, took, sim.t, bandOf(after), o?.by ?? -1, o?.byKind ?? 'world', ev);
  settleHostile(sim, I, h, cause, ev);
}
/**
 * 용의자의 쓰러짐·사망 전이와 그 문구 (hurtHostile 이 부른다 — tickHostiles 의 안전장치도 같은 함수를 쓴다).
 * 쓰러짐: 총상이면 '○○이 총상을 입고 쓰러졌습니다 — 무력화.'(hazard · 3 — 결정적 순간), 그 밖은 '○○이 ${원인}으로 쓰러졌습니다.'(hazard · 2).
 * 사망: SUSPECT_DIED '○○ 사망 (원인, 처치 전|처치 후)', 기록 문구 '○○ 생체 반응 소실.' (problem · 3)
 */
export function settleHostile(sim: Sim, I: Incident, h: Hostile, cause: InjuryCause, ev = -1): void {
  if (h.health <= DOWN_AT && h.tDown === undefined) {
    h.tDown = sim.t;
    if (h.state !== 'arrested') { h.state = 'down'; h.path = null; h.dragging = false; }
    const dEv = emit(sim, {
      inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: cause === 'gunshot' ? 3 : 2, causes: [ev],
      text: cause === 'gunshot' ? `${josa(h.label, '이/가')} 총상을 입고 쓰러졌습니다 — 무력화.` : `${josa(h.label, '이/가')} ${josa(CAUSE_NAME[cause], '으로/로')} 쓰러졌습니다.`,
    });
    // 기록이 없던 상처(대원의 사격은 따로 기록을 남기지 않는다)는 이 쓰러짐 기록을 원인으로 잇는다 — 뒤에 그 상처로 숨지면 사망 기록이 여기로 거슬러 간다
    if (h.injuries) for (let k = 0; k < h.injuries.length; k++) if (h.injuries[k].cause === cause && h.injuries[k].ev < 0) h.injuries[k].ev = dEv;
  }
  if (h.health <= 0 && !h.dead) {
    h.dead = true; h.tDead = sim.t; h.health = 0;
    if (h.deathCause === undefined) h.deathCause = cause;
    let why = ev;
    if (why < 0 && h.injuries) for (let k = 0; k < h.injuries.length; k++) if (h.injuries[k].cause === h.deathCause) why = h.injuries[k].ev;
    raiseProblem(sim, I, 'SUSPECT_DIED', `${h.label} 사망 (${CAUSE_NAME[h.deathCause]}, ${h.tTreated !== undefined ? '처치 후' : '처치 전'})`, {
      role: 'SYSTEM', actor: '현장', imp: 3, causes: [why], text: `${h.label} 생체 반응 소실.`,
    }, false);
  }
}
/** 처치를 받은 용의자: 체력이 오르고(heal), 출혈은 처치 전 값 × bleedK, 받은 처치의 질과 처음 처치 받은 시각을 적는다 (대원의 careResponder 와 같은 식 — 세 부류가 같은 처치 공식) */
export function careHostile(sim: Sim, h: Hostile, fx: { q: number; heal: number; bleedK: number }): void {
  if (fx.heal > 0) h.health = Math.min(100, h.health + fx.heal);
  h.treatQ = fx.q; h.bleed = (h.bleed0 ?? h.bleed ?? 0) * fx.bleedK;
  if (h.tTreated === undefined) h.tTreated = sim.t;
}
/**
 * 처치가 필요한 다친 용의자인가 — **믿음**. 'hos' 사실의 값만 본다: 숨지지 않았고 현장에 있고(차에 실리지 않았다), 쓰러졌거나 중상 이상(band ≥ 1 — 모르면 위중으로 본다).
 * 지휘 쪽(orders/injury.ts·commander.ts)이 쓴다 — 용의자의 체력·출혈(진실)을 읽지 않는다
 */
export function hosNeedsCare(v: { state: string; dead?: boolean; band?: number; where?: string }): boolean {
  if (v.dead || (v.where !== undefined && v.where !== 'scene') || v.state === 'escaped') return false;
  // 중증도를 모르는 사실은 대원이 직접 보지 못한 제보뿐이다(풀려난 인질의 말 — rules/crime.ts, 늘 '대치 중'). 맞서는 용의자를 그런 말만으로 다친 사람으로 세지 않는다 —
  // 세면 다수 사상자 다시 세기(orders/injury.ts)가 보지도 못한 용의자를 부상자로 넣어 구급 부대를 더 부른다 (H1 검토). 쓰러졌거나 붙잡힌 용의자는 모르면 위중으로 본다(§4.3)
  const active = v.state === 'hold' || v.state === 'fight' || v.state === 'flee';
  return v.state === 'down' || (v.band ?? (active ? 0 : 2)) >= 1;
}
/**
 * 위협이 끝난 시각: 무장 현장은 지휘관의 안전 확보 선언(s.secureAt), 그 밖의 현장(추격전·음주 운전 — secureAt 이 정해지지 않는다)은 첫 도착(s.arrivedAt). 없으면 −1.
 * 이 시각 뒤에 숨진 용의자는 "위협이 끝난 뒤 다친 사람을 돌보지 못한 것"이다 (§4.4 — 판정의 벌점과 보고서 문장이 쓴다)
 */
export function threatOverAt(s: Scene): number {
  return s.kind === 'armed' ? s.secureAt : s.arrivedAt;
}

// ───────────────────────── 교대가 끝난 뒤 (단계 6 — §3.7) ─────────────────────────
/**
 * 다음 교대에 빠지는 교대 수 (제안 값 — §3.7 의 표). 보고서(debrief.buildReport — 명부 roster·대원 목록)와 I2(교대 간 지속)가 함께 부른다 —
 * 같은 표가 두 곳에 있지 않게. 쓰러진 적은 tDown 으로 본다.
 *   순직 −1 (가용 인원에서 빠진다) · 후송(병원 인계 또는 교대 끝에 후송 중) 쓰러진 적 있음 3 / 없음 2 · 쓰러진 채 후송 아님 3 · 다침(병원 안 감) 1 · 온전 0
 */
export function outShifts(r: Responder): number {
  if (r.dead) return -1;
  if (r.care !== undefined) return r.tDown !== undefined ? 3 : 2;
  if (r.tDown !== undefined) return 3;
  return r.status === 'injured' || r.status === 'down' ? 1 : 0;
}

// ───────────────────────── 한 번 피해의 기록 (단계 1) ─────────────────────────
// 피해를 주는 자리는 식을 그대로 두고, 바꾸기 전의 값(hp0, bleed0)을 잡아 두었다가 바꾼 뒤에 아래 함수를 한 줄 부른다.
// 깎인 양은 (앞 − 뒤)로 센다 — 그 자리의 난수·연산 순서를 건드리지 않는다. 뒤 단계가 이 줄들을 hurt* 로 바꿨다
// (구조 대상의 자리는 단계 3 에서 hurtCas 로, 대원의 자리는 단계 4a 에서 hurtResponder 로, 용의자의 자리는 단계 5 에서 hurtHostile 로 — noteCasHurt 는 시험만 쓴다).

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
