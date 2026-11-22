// H1 부상과 사망 (docs/specs/H1-injuries.md §11). 번호는 설계서의 시험 번호다.
// 단계 1(기록만)·단계 2(화면)·단계 3(구조 대상)까지의 시험이 들어 있다 — 뒤 단계가 같은 번호 아래에 덧붙인다(3 방호, 4 문턱, 5 순직 빈도, 6 구조·후송, 7 용의자 처치, 12~15).
// 단계 1 의 시험은 파일 앞쪽(1·2·처음 원인·장부·9·11·객체 모양·8), 단계 2 의 시험은 뒤쪽(10·중증도 색·읽는 함수·현장 그림)이다.
// 단계 3 의 시험: "2. hurtCas", "9" 의 뒤쪽(판정 뒤에는 멈춘다), 설계서에 번호가 없는 규칙은 §5 의 이름으로 "5. …" 다섯 묶음(사건 중 새 부상 · 구출 중 사고 · 스스로 대피하다 · 문구와 원인), "11" 의 지진 교대.
// 단계 4a(대원)의 시험은 파일 끝("단계 4a: 대원" 아래): 3 방호 · 4 문턱 · 상태 전이 · 다치는 자리 · 동료의 상태(mate 사실) · 지휘관 · 실행기(후퇴·동료 구조) · 8 · 9 · 5 · 11.
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { NORMAL, PRESETS } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { closeIncident, createIncident } from '../src/sim/incidents';
import { createAidUnit, crewOk, crewReady, tickUnits } from '../src/sim/resources';
import { armorOf, fieldCrew, minField, seatsOf, seatsUsed } from '../src/sim/crews';
import { PROBLEM_LABEL, buildReport, evaluate } from '../src/sim/debrief';
import { scenarioName } from '../src/sim/scenarios';
import { injuryJson, injuryStats, sumInjury } from '../scripts/injurystats';
import { emit } from '../src/sim/events';
import { TRAP_R, TRAP_WORK, band, blast, tickCasualties, tickCollapse, tickGas, tickHostiles, tickLane, tickWater } from '../src/sim/field/hazards';
import { FIGHT_HIT, MISHAP, act, makeTask, moveSpeed } from '../src/sim/field/executor';
import { los, staticPass, tileOf } from '../src/sim/field/grid';
import { commanderThink, outstanding, riderText } from '../src/sim/field/commander';
import { think } from '../src/sim/field/brain';
import { FALL_HIT, FALL_P, HEAT_DMG, HEAT_STAMINA, HOSTILE_CARED, WALK_STOP, hostileHazards, responderHazards } from '../src/sim/field/rules/injury';
import { SELF_EVAC_WAIT, TS_MAX_DONE } from '../src/sim/field/orders/injury';
import { PHRASE, checkC5, sysOf } from '../scripts/metrics';
import { fmtSec, josa } from '../src/sim/util';
import { detonate } from '../src/sim/field/rules/crime';
import {
  BLEED_PER_DMG, CAUSE_NAME, DOWN_AT, DOWN_BLEED_CAP, HOSPITAL_BLEED, HOSTILE_BLEED, HOSTILE_BLEED_MAX, HOSTILE_LEFT, HURT_AT, LIGHT_WORK, SELF_HARM, hosNeedsCare, hurtHostile, outShifts, threatOverAt, MATE_BLEED_MAX, MATE_FLOOR, MATE_LETHAL_FROM, MATE_RETREAT_BLEED, MATE_RETREAT_HP,
  bandOf, canDeploy, hurtCas, hurtCasTo, hurtCauseNow, hurtF, hurtResponder, initialCause, injuryRng, mainCause, mateNeedsHospital, mustRetreat, needsHospital, noteCasHurt, noteInjury, protection, smokeCause, woundTick,
} from '../src/sim/field/injury';
import { fitFor, hosFact, makeAgent, mateFact, mateStatus, perceive, staminaF } from '../src/sim/field/agents';
import { addCas, addHostile } from '../src/sim/field/kit';
import { BeliefStore, mkFact } from '../src/sim/field/beliefs';
import { SAFE_BLEED, agentHealth, settleInjuries, tickScene, unitArrived } from '../src/sim/field/sceneManager';
import { T } from '../src/sim/types';
import type { Casualty, FieldAgent, Hostile, Incident, IncidentType, Injury, InjuryCause, MateBelief, Prop, Responder, RoleId, Scene, SimEvent, Unit, UnitKind, WorkItem } from '../src/sim/types';
import { CameraDirector } from '../src/view/camera';
import { TRIAGE, TRIAGE_EDGE, TRIAGE_NAME, TRIAGE_TEXT, agentStateText, careName, casBand, casDrawn, casInfo, casSheet, hostileBand, hostileDrawn, hostileInfo, hostileSheet, hurtPose, injuryLine, isLoss, reportHurtText, respBand, respLying, respSheet, respStateText } from '../src/view/triage';
import { fakeCtx, withFakeDom } from './fakeCanvas';

// ───────────────────────── 도우미 ─────────────────────────
const sumDmg = (list: Injury[] | undefined): number => (list ?? []).reduce((a, j) => a + j.dmg, 0);
const scenesOf = (sim: Sim): Scene[] => sim.scenes.filter((s): s is Scene => s !== null);
const shift = (seed: string, d: Difficulty = NORMAL, force: string | null = null): Sim => { const sim = new Sim(seed, d, 1200, { force }); sim.runToEnd(40000); return sim; };
/** 사건 하나를 정해서 일으키고 그 현장을 돌려준다 */
function sceneOf(seed: string, type: IncidentType, variant?: string): { sim: Sim; s: Scene } {
  const sim = new Sim(seed);
  const I = createIncident(sim, { type, variant, rng: sim.rng.fork('t') });
  return { sim, s: sim.scenes[I.id]! };
}

// 교대를 여러 번 돌리는 묶음은 한 번 돌려 나눠 쓴다
const HARSH: Difficulty = { ...NORMAL, threat: 5, severity: 5, equipment: 1 };
let shooter: Sim[] = [], harsh: Sim[] = [], plain: Sim[] = [];
beforeAll(() => {
  for (let k = 0; k < 8; k++) shooter.push(shift('INJ' + k, NORMAL, 'armed/shooter'));
  for (let k = 0; k < 8; k++) harsh.push(shift('INJ' + k, HARSH));
  for (let k = 0; k < 4; k++) plain.push(shift('INJ' + k));
}, 120000);
const all = (): Sim[] => [...shooter, ...harsh, ...plain];

// ───────────────────────── 1. 세 부류 모두 다친다 (기록) ─────────────────────────
describe('1. 세 부류 모두 부상 기록이 남는다', () => {
  it('총격범 8교대: 총상 기록이 있는 구조 대상과 부상 기록이 있는 용의자가 있고, 모든 사건이 끝난다', () => {
    let casShot = 0, hosHurt = 0;
    for (const sim of shooter) {
      expect(sim.incidents.every((I) => I.phase === 'closed' && I.result !== null), sim.seed).toBe(true);
      if (scenesOf(sim).some((s) => s.casualties.some((c) => (c.injuries ?? []).some((j) => j.cause === 'gunshot')))) casShot++;
      if (scenesOf(sim).some((s) => s.hostiles.some((h) => (h.injuries ?? []).length > 0))) hosHurt++;
    }
    expect(casShot).toBeGreaterThanOrEqual(1);
    expect(hosHurt).toBeGreaterThanOrEqual(1);
  });
  it('위협 5·심각도 5·장비 1 의 8교대: 중상 이상(sev ≥ 1)의 부상 기록이 있는 대원이 있다', () => {
    let hurt = 0;
    for (const sim of harsh) {
      expect(sim.incidents.every((I) => I.phase === 'closed'), sim.seed).toBe(true);
      hurt += sim.responders.filter((r) => (r.injuries ?? []).some((j) => j.sev >= 1)).length;
    }
    expect(hurt).toBeGreaterThanOrEqual(1);
  });
  it('가해자가 적힌다: 용의자의 총상은 쏜 대원, 대원의 총상·자상은 그 용의자', () => {
    const hosRows = shooter.flatMap((sim) => scenesOf(sim).flatMap((s) => s.hostiles.flatMap((h) => (h.injuries ?? []).filter((j) => j.cause === 'gunshot').map((j) => ({ sim, j })))));
    expect(hosRows.length).toBeGreaterThan(0);
    for (const { sim, j } of hosRows) { expect(j.byKind).toBe('responder'); expect(sim.responders[j.by], '쏜 대원').toBeTruthy(); }
    const respRows = all().flatMap((sim) => sim.responders.flatMap((r) => (r.injuries ?? []).filter((j) => j.cause === 'gunshot' || j.cause === 'stab' || j.cause === 'blunt')));
    expect(respRows.length).toBeGreaterThan(0);
    for (const j of respRows) { expect(j.byKind).toBe('hostile'); expect(j.by).toBeGreaterThanOrEqual(0); }
  });
});

// ───────────────────────── 2. 원인별 기록 ─────────────────────────
describe('2. 기록의 모양', () => {
  it('bandOf 는 예전의 band 와 전 구간에서 같고, hazards.band 는 bandOf 그 자체다', () => {
    const old = (h: number): number => (h <= 0 ? 3 : h > 70 ? 0 : h > 40 ? 1 : 2);
    for (let h = -20; h <= 120; h += 0.25) expect(bandOf(h), String(h)).toBe(old(h));
    expect(band).toBe(bandOf);
    expect([bandOf(100), bandOf(70.01), bandOf(70), bandOf(40.01), bandOf(40), bandOf(0.01), bandOf(0)]).toEqual([0, 0, 1, 1, 2, 2, 3]);
  });
  it('같은 원인은 한 줄로 합쳐지고(dmg 가 더해진다), sev 는 닿은 가장 나쁜 단계, 처음의 가해자·기록이 남는다', () => {
    let list = noteInjury(undefined, 'smoke', 2, 10, 0);
    list = noteInjury(list, 'smoke', 3, 11, 1);
    list = noteInjury(list, 'gunshot', 30, 12, 2, 4, 'hostile', 77);
    list = noteInjury(list, 'smoke', 1, 13, 0);
    list = noteInjury(list, 'gunshot', 20, 14, 1, 9, 'hostile', 99);
    expect(list.length).toBe(2);
    expect(list[0]).toEqual({ cause: 'smoke', dmg: 6, sev: 1, t: 10, last: 13, by: -1, byKind: 'world', ev: -1 });
    expect(list[1]).toEqual({ cause: 'gunshot', dmg: 50, sev: 2, t: 12, last: 14, by: 4, byKind: 'hostile', ev: 77 });
    expect(mainCause(list)).toBe('gunshot');
    expect(mainCause(undefined)).toBeNull(); expect(mainCause([])).toBeNull();
  });
  it('한 번 피해의 기록: 깎인 만큼만 적고, 키운 출혈의 원인과 숨지게 한 원인을 적는다 — 체력·출혈은 건드리지 않는다', () => {
    const { s } = sceneOf('INJ-rec', 'armed', 'hostage');
    const c = addCas(s, 5, 5, 'mobile', 100, 0, 0);
    // 다치지 않았으면 아무것도 남지 않는다
    noteCasHurt(c, 'gunshot', 100, 0, 3);
    expect(c.injuries).toBeUndefined(); expect(c.bleedCause).toBeUndefined(); expect(c.deathCause).toBeUndefined();
    // 30 을 잃고 출혈이 커졌다 (그 자리의 식이 이미 바꾼 뒤에 부른다)
    c.health = 70; c.bleed = 0.18;
    noteCasHurt(c, 'gunshot', 100, 0, 4, 2, 'hostile', 55);
    expect(c.injuries).toEqual([{ cause: 'gunshot', dmg: 30, sev: 1, t: 4, last: 4, by: 2, byKind: 'hostile', ev: 55 }]);
    expect(c.bleedCause).toBe('gunshot'); expect(c.deathCause).toBeUndefined();
    expect([c.health, c.bleed]).toEqual([70, 0.18]);
    // 출혈을 키우지 않은 피해는 출혈 원인을 바꾸지 않는다. 0 이하가 되면 숨지게 한 원인이 정해지고, 그 뒤로 바뀌지 않는다
    c.health = -5;
    noteCasHurt(c, 'blast', 70, 0.18, 5);
    expect(c.bleedCause).toBe('gunshot'); expect(c.deathCause).toBe('blast');
    expect(c.injuries!.find((j) => j.cause === 'blast')).toMatchObject({ dmg: 75, sev: 3 });
    c.health = -9;
    noteCasHurt(c, 'burn', -5, 0.18, 6);
    expect(c.deathCause).toBe('blast');
    // 대원의 피해는 단계 4a 부터 hurtResponder 가, 용의자의 피해는 단계 5 부터 hurtHostile 이 적는다 — 아래 "4. 대원" · "단계 5"
  });
  it('원인의 이름이 모두 있다', () => {
    const causes: InjuryCause[] = ['gunshot', 'stab', 'blunt', 'burn', 'smoke', 'toxic', 'fall', 'crush', 'blast', 'drown', 'electric', 'exhaustion', 'vehicle', 'exposure', 'illness',
      'animal'];      // (N8 단계 2a) 동물·벌 피해
    for (const k of causes) expect(CAUSE_NAME[k], k).toBeTruthy();
    expect(Object.keys(CAUSE_NAME).length).toBe(causes.length);
  });
});

// ───────────────────────── 2. 원인별 기록 — 구조 대상의 피해는 hurtCas 한 길로 (단계 3) ─────────────────────────
describe('2. hurtCas — 구조 대상의 피해는 한 길로만 준다', () => {
  const CAUSES: InjuryCause[] = ['gunshot', 'stab', 'blunt', 'burn', 'smoke', 'toxic', 'fall', 'crush', 'blast', 'drown', 'electric', 'exhaustion', 'vehicle', 'exposure', 'illness'];
  it('원인마다 한 줄씩 생기고, 같은 원인은 한 줄로 합쳐지며(dmg 가 더해진다), sev 가 그때의 bandOf 와 맞는다', () => {
    const { sim, s } = sceneOf('INJ-hurt', 'fire');
    const I = sim.incidents[s.incidentId];
    const c = addCas(s, 5, 5, 'mobile', 100, 0, 0);
    let hp = 100;
    for (const cause of CAUSES) {
      hurtCas(sim, s, I, c, 2, cause);
      hp -= 2;
      expect(c.health).toBe(hp);
      expect(c.injuries!.filter((j) => j.cause === cause)).toEqual([{ cause, dmg: 2, sev: bandOf(hp), t: sim.t, last: sim.t, by: -1, byKind: 'world', ev: -1 }]);
    }
    expect(c.injuries!.length).toBe(CAUSES.length);
    hurtCas(sim, s, I, c, 35, 'smoke');      // 70 → 35: 위중
    expect(c.injuries!.length).toBe(CAUSES.length);
    expect(c.injuries!.find((j) => j.cause === 'smoke')).toMatchObject({ dmg: 37, sev: 2 });
    expect(c.health).toBe(35);
    expect(sumDmg(c.injuries)).toBeCloseTo(100 - c.health, 9);
    // 피해 자체의 문구는 남기지 않는다 (문구는 피해를 준 자리가 남긴다)
    const n = sim.events.length;
    hurtCas(sim, s, I, c, 1, 'burn');
    expect(sim.events.length).toBe(n);
  });
  it('가해자·기록 id·출혈·거동: o.ev 는 causeEvent 로, o.bleed 는 그 값 이상으로(원인도 그 원인으로), o.immobile 은 걷던 사람을 세우고 갇힌 사람은 그대로 둔다', () => {
    const { sim, s } = sceneOf('INJ-hurt2', 'armed', 'hostage');
    const I = sim.incidents[s.incidentId];
    const c = addCas(s, 5, 5, 'mobile', 100, 0, 0);
    c.walking = true; c.path = [1, 2, 3];
    hurtCas(sim, s, I, c, 30, 'gunshot', { by: 2, byKind: 'hostile', ev: 55, bleed: 0.18, immobile: true });
    expect(c.injuries).toEqual([{ cause: 'gunshot', dmg: 30, sev: 1, t: sim.t, last: sim.t, by: 2, byKind: 'hostile', ev: 55 }]);
    expect([c.health, c.bleed, c.bleed0, c.bleedCause, c.causeEvent]).toEqual([70, 0.18, 0.18, 'gunshot', 55]);
    expect([c.mob, c.walking, c.path]).toEqual(['immobile', false, null]);
    // 더 약한 출혈은 올리지 않고 원인도 바꾸지 않는다. 기록 id 가 없으면 causeEvent 를 건드리지 않는다
    hurtCas(sim, s, I, c, 5, 'blast', { bleed: 0.1 });
    expect([c.bleed, c.bleedCause, c.causeEvent]).toEqual([0.18, 'gunshot', 55]);
    // 갇힌 사람은 갇힌 채로 있다
    const t = addCas(s, 6, 5, 'trapped', 90, 0, 0);
    hurtCas(sim, s, I, t, 5, 'crush', { immobile: true });
    expect(t.mob).toBe('trapped');
  });
  it('0 이하가 되면 숨지게 한 원인을 그 자리에서 적고(사망 처리는 다음 틱의 악화 규칙이 한다), 숨진 사람은 더 다치지 않는다', () => {
    const { sim, s } = sceneOf('INJ-hurt3', 'fire');
    const I = sim.incidents[s.incidentId];
    const c = addCas(s, 5, 5, 'immobile', 20, 0, 0);
    hurtCas(sim, s, I, c, 26, 'blast');
    expect(c.health).toBe(-6); expect(c.dead).toBe(false); expect(c.deathCause).toBe('blast');
    hurtCas(sim, s, I, c, 3, 'burn');      // 아직 dead 가 아니다: 기록은 이어지지만 숨지게 한 원인은 바뀌지 않는다
    expect(c.deathCause).toBe('blast');
    c.dead = true;
    const snap = JSON.stringify([c.health, c.injuries, c.bleed]);
    hurtCas(sim, s, I, c, 50, 'gunshot', { bleed: 0.5, immobile: true, ev: 9 });
    expect(JSON.stringify([c.health, c.injuries, c.bleed])).toBe(snap);
    expect(c.causeEvent).not.toBe(9);
  });
  it('hurtCasTo: 깎은 뒤의 체력을 받는다 — 하한·상한이 걸린 자리의 예전 식과 끝자리까지 같고, 지금보다 높은 값으로 체력을 올리지 않는다', () => {
    const { sim, s } = sceneOf('INJ-hurt4', 'water');
    const I = sim.incidents[s.incidentId];
    const c = addCas(s, 5, 5, 'immobile', 30.123456789, 0, 0);
    const x = 20.987654321;
    const want = Math.max(8, c.health - x);
    hurtCasTo(sim, s, I, c, Math.max(8, c.health - x), 'drown');
    expect(c.health).toBe(want);
    expect(c.injuries![0].dmg).toBe(30.123456789 - want);
    // 하한보다 이미 낮은 사람: 예전 식은 체력을 하한까지 올렸다 — 다치는 일로 체력이 오르지는 않는다
    c.health = 3;
    hurtCasTo(sim, s, I, c, Math.max(8, c.health - 30), 'drown');
    expect(c.health).toBe(3);
    hurtCasTo(sim, s, I, c, Math.min(c.health, 55), 'illness');      // "그 값까지 떨어진다": 이미 더 낮으면 그대로
    expect(c.health).toBe(3);
    expect(c.injuries!.length).toBe(1);
  });
  it('구조 대상의 체력을 직접 깎는 줄이 남아 있지 않다 — 매 틱 악화, 사망 처리, 처치, 처음 상태를 만드는 자리만 예외다', () => {
    const files = ['hazards.ts', 'executor.ts', 'agents.ts', 'sceneManager.ts', 'commander.ts', 'brain.ts', ...readdirSync('src/sim/field/rules').map((f) => 'rules/' + f)].map((f) => 'src/sim/field/' + f).concat(['src/sim/resources.ts', 'src/sim/pursuit.ts', 'src/sim/incidents.ts', 'src/sim/disaster.ts']);
    const ALLOW = [
      'c.health -= d * dt;',                                             // tickCasualties 의 매 틱 악화 (noteDecay 로 적는다)
      'c.health = 0; c.dead = true; c.tDead = sim.t; c.walking = false;',      // tickCasualties 의 사망 처리
      'c.dead = true; c.health = 0; c.tDead = sim.t; c.inWater = false;',      // tickWater: 떠내려가 숨짐 (바로 앞 줄이 hurtCasTo)
      'c.health = Math.min(100, c.health + fx.heal);',                   // 처치 (오른다 — injury.treatEffect 의 값)
    ];
    const bad: string[] = [];
    for (const f of files) {
      readFileSync(f, 'utf8').split('\n').forEach((line, k) => {
        if (!/\b(c|cas|target|struck|v|victim)\.health\s*(-=|\*=|\/=|=[^=])/.test(line)) return;
        if (ALLOW.some((a) => line.includes(a))) return;
        bad.push(`${f}:${k + 1} ${line.trim().slice(0, 90)}`);
      });
    }
    expect(bad).toEqual([]);
  });
});

// ───────────────────────── 처음 상태의 원인 (§2.3) ─────────────────────────
describe('처음 상태의 원인', () => {
  const table: [IncidentType, string | undefined, InjuryCause][] = [
    ['fire', undefined, 'smoke'], ['traffic', undefined, 'vehicle'], ['traffic', 'bus', 'vehicle'], ['traffic', 'manhole', 'fall'], ['traffic', 'tree', 'crush'],
    ['medical', 'trauma', 'blunt'], ['medical', 'arrest', 'illness'], ['collapse', undefined, 'crush'], ['collapse', 'elevator', 'crush'], ['collapse', 'gasblast', 'blast'],
    ['hazmat', undefined, 'toxic'], ['search', 'hiker', 'exposure'], ['water', undefined, 'drown'], ['armed', 'shooter', 'gunshot'], ['armed', 'robbery', 'gunshot'], ['armed', 'domestic', 'blunt'],
    ['armed', 'bomb', 'blunt'],      // 폭발물 현장의 사람들은 멀쩡하게 시작한다 (기록이 붙지 않는 쪽을 본다)
    ['utility', 'wire', 'electric'],      // (N8 §5.14) 감전된 행인 — 전선이 덮친 차 안의 사람은 멀쩡하다
    ['utility', 'sinkhole', 'fall'], ['utility', 'sign', 'crush'],      // (단계 4b) 구멍에 빠진 사람 · 떨어진 간판에 다친 행인 (수도관의 지하 사람은 멀쩡하게 시작한다)
    ['welfare', 'dementia', 'exposure'],      // (단계 7) 길 잃은 치매 노인 — 노출
    ['rescue', 'facade', 'fall'], ['rescue', 'pit', 'fall'], ['rescue', 'ride', 'illness'],      // (단계 8) 매달린 작업자·구덩이에 빠진 사람 — 추락 · 멈춘 놀이기구의 승객 — 급성 질환
    ['medical', 'poison', 'illness'], ['medical', 'overdose', 'illness'], ['medical', 'birth', 'illness'], ['medical', 'heat', 'exhaustion'],      // (단계 9) 응급의 갈래 넷
  ];
  it('현장이 만들어질 때 다쳐 있는 사람(체력 < 100 이거나 출혈 > 0)에게만 처음 원인의 기록 한 줄과 출혈 원인이 붙는다', () => {
    let hurtSeen = 0, wholeSeen = 0;
    for (const [type, variant, want] of table) for (let k = 0; k < 3; k++) {
      const { sim, s } = sceneOf(`INJ-init-${k}`, type, variant);
      const I = sim.incidents[s.incidentId];
      for (const c of s.casualties) {
        const tag = `${type}/${variant ?? '-'} ${c.label}`;
        if (c.health >= 100 && c.bleed <= 0) { wholeSeen++; expect(c.injuries, tag).toBeUndefined(); expect(c.bleedCause, tag).toBeUndefined(); continue; }
        hurtSeen++;
        const cause = initialCause(s, I, c);
        // 표: 물속이면 익수, 차 안이면 차량 충격, 그 밖에는 변형·유형의 원인
        expect(cause, tag).toBe(c.inWater ? 'drown' : c.inVehicle !== null && !(type === 'traffic' && (variant === 'manhole' || variant === 'tree')) && !(type === 'medical' && variant === 'trauma') && !(type === 'collapse' && variant === 'gasblast') ? 'vehicle' : want);
        expect(c.injuries, tag).toEqual([{ cause, dmg: Math.max(0, 100 - c.health), sev: bandOf(c.health), t: sim.t, last: sim.t, by: -1, byKind: 'initial', ev: -1 }]);
        expect(c.bleedCause, tag).toBe(c.bleed > 0 ? cause : undefined);
        expect(c.deathCause, tag).toBeUndefined();
      }
      for (const h of s.hostiles) expect(h.injuries, `${type}/${variant} ${h.label}`).toBeUndefined();      // 용의자는 추격전 사고가 아니면 멀쩡하게 시작한다
    }
    expect(hurtSeen).toBeGreaterThan(40); expect(wholeSeen).toBeGreaterThan(0);
  });
  it('가스 누출 현장과 가스 규칙이 얹힌 현장의 연기는 유독 가스로 적는다', () => {
    expect(smokeCause(sceneOf('INJ-sm', 'hazmat').s)).toBe('toxic');
    expect(smokeCause(sceneOf('INJ-sm', 'collapse', 'gasblast').s)).toBe('toxic');
    expect(smokeCause(sceneOf('INJ-sm', 'fire').s)).toBe('smoke');
    expect(smokeCause(sceneOf('INJ-sm', 'collapse').s)).toBe('smoke');
  });
  it('추격전 사고로 선 도주 용의자는 차량 충격으로 다친 채 시작한다', () => {
    let seen = 0;
    for (let k = 0; k < 30 && seen < 2; k++) {
      const sim = shift('INJ-get' + k, NORMAL, 'armed/getaway');
      for (const s of scenesOf(sim)) {
        const I = sim.incidents[s.incidentId];
        if (!I.pursuit || I.pursuit.how !== 'crash') continue;
        for (const h of s.hostiles) {
          const first = (h.injuries ?? [])[0];
          if (!first || first.byKind !== 'initial') continue;
          seen++;
          expect(first.cause).toBe('vehicle');
          expect(first.dmg).toBeGreaterThanOrEqual(22 - 1e-9); expect(first.dmg).toBeLessThanOrEqual(52 + 1e-9);      // 처음 체력 48~78
        }
      }
    }
    expect(seen).toBeGreaterThanOrEqual(1);
  }, 120000);
});

// ───────────────────────── 장부: 기록과 체력이 맞는다 (피해 자리를 빠뜨리지 않았다) ─────────────────────────
describe('장부 — 깎인 체력은 모두 원인과 함께 적힌다', () => {
  it('처치를 받지 않은 구조 대상: Σ(기록) = 100 − 체력. 숨진 사람은 넘친 만큼만 더 크다', () => {
    let n = 0, deadN = 0;
    for (const sim of all()) for (const s of scenesOf(sim)) for (const c of s.casualties) {
      if (c.treated || c.tTreated >= 0) continue;      // 처치는 체력을 올린다 (기록은 깎인 것만 센다)
      n++;
      const sum = sumDmg(c.injuries), tag = `${sim.seed} ${sim.incidents[s.incidentId].code} ${c.label}`;
      if (c.dead) { deadN++; expect(sum, tag).toBeGreaterThanOrEqual(100 - 1e-6); expect(sum, tag).toBeLessThan(160); }
      else expect(Math.abs(sum - (100 - c.health)), tag).toBeLessThan(1e-6);
    }
    expect(n).toBeGreaterThan(300); expect(deadN).toBeGreaterThan(5);
  });
  it('용의자: Σ(기록) = 100 − 체력. 숨진 용의자는 넘친 만큼만 더 크고, 처치를 받은 용의자는 오른 만큼 더 크다 (단계 5)', () => {
    let hurt = 0;
    for (const sim of all()) for (const s of scenesOf(sim)) for (const h of s.hostiles) {
      const sum = sumDmg(h.injuries), want = 100 - h.health, tag = `${sim.seed} ${h.label}`;
      if (h.dead) { expect(h.health, tag).toBe(0); expect(sum, tag).toBeGreaterThanOrEqual(100 - 1e-6); expect(sum, tag).toBeLessThan(160); }
      else if (h.tTreated !== undefined) expect(sum, tag).toBeGreaterThanOrEqual(want - 1e-6);
      else expect(Math.abs(sum - want), tag).toBeLessThan(1e-6);
      if (h.health < 100) hurt++;
    }
    expect(hurt).toBeGreaterThan(3);
  });
  it('대원: Σ(기록) = 100 − 체력. 순직한 대원은 넘친 만큼만 더 크다 (체력 하한 1 은 단계 4a 에서 없어졌다). 처치를 받은 대원은 오른 만큼 더 크다 (단계 4b)', () => {
    let hurt = 0, treated = 0;
    for (const sim of all()) {
      // 처치를 받은 대원 (처치는 체력을 올린다 — 기록은 깎인 것만 센다): 그 처치를 남긴 기록의 이름으로 가린다
      const healed = new Set<string>();
      for (const e of sim.events) { const m = /^(\S+) 대원 응급 처치 완료\.$/.exec(e.text); if (m) healed.add(m[1]); }
      for (const r of sim.responders) {
        const sum = sumDmg(r.injuries), want = 100 - r.health, tag = `${sim.seed} ${r.name}`;
        if (r.dead) { expect(sum, tag).toBeGreaterThanOrEqual(100 - 1e-6); expect(sum, tag).toBeLessThan(160); }
        else if (healed.has(r.name)) { treated++; expect(sum, tag).toBeGreaterThanOrEqual(want - 1e-6); }
        else expect(Math.abs(sum - want), tag).toBeLessThan(1e-6);
        if (r.health < 100) hurt++;
        for (const j of r.injuries ?? []) expect(j.sev, tag).toBeLessThanOrEqual(r.dead ? 3 : 2);      // 사망(3)은 숨진 대원의 기록에만
      }
    }
    expect(hurt).toBeGreaterThan(20);
    expect(treated, '처치를 받은 대원이 있다 (단계 4b — 표본 확인)').toBeGreaterThan(0);
  });
  it('살아 있는데 악화 중인 사람은 그 악화의 원인을 안다 (출혈 원인이 빈 채로 피를 흘리는 사람이 없다)', () => {
    for (const sim of all()) for (const s of scenesOf(sim)) for (const c of s.casualties) if (c.bleed > 0) expect(c.bleedCause, `${sim.seed} ${sim.incidents[s.incidentId].code} ${c.label}`).toBeTruthy();
  });
});

// ───────────────────────── 9. 가짜 연출 없음 (기록 부분) ─────────────────────────
describe('9. 숨진 사람의 원인', () => {
  it('숨진 구조 대상은 모두 숨지게 한 원인이 있고, 그 원인의 기록 줄이 있다', () => {
    let dead = 0;
    for (const sim of all()) for (const s of scenesOf(sim)) for (const c of s.casualties) {
      const tag = `${sim.seed} ${sim.incidents[s.incidentId].code} ${c.label}`;
      if (!c.dead) { expect(c.deathCause, tag).toBeUndefined(); continue; }
      dead++;
      expect(c.deathCause, tag).toBeTruthy();
      expect((c.injuries ?? []).some((j) => j.cause === c.deathCause), tag).toBe(true);
      expect(Math.max(...c.injuries!.map((j) => j.sev)), tag).toBe(3);
    }
    expect(dead).toBeGreaterThan(10);
  });
  it('물살에 휩쓸려 현장 밖으로 떠내려간 사람: lost 가 서고 원인은 익수다. 물속에서 현장 안에 있는 사람은 lost 가 아니다', () => {
    const { sim, s } = sceneOf('INJ-water', 'water');
    const I = sim.incidents[s.incidentId];
    const c = s.casualties.find((q) => q.inWater)!;
    expect(c).toBeTruthy(); expect(c.lost).toBeUndefined();
    const hp = c.health;
    c.drift = 5; c.x = s.w - 1.25;      // 다음 틱에 현장 끝을 넘는다
    sim.tick++; sim.t = sim.tick * sim.dt;
    tickWater(sim, s, I);
    expect(c.dead).toBe(true); expect(c.lost).toBe(true); expect(c.deathCause).toBe('drown');
    expect(c.injuries!.find((j) => j.cause === 'drown')!.sev).toBe(3);
    expect(sumDmg(c.injuries)).toBeCloseTo(100, 6);
    expect(hp).toBeGreaterThan(0);
    for (const q of s.casualties) if (q !== c) expect(q.lost).toBeUndefined();
  });
  // ── 단계 3: 사건이 끝나면(판정 뒤) 구조 대상의 악화·사망 판정이 멈춘다 (§2.6) ──
  it('모든 구조 대상의 사망 시각과 사망 기록(생체 반응 소실 · 떠내려감)의 시각 ≤ 그 사건의 closedAt', () => {
    let dead = 0, recs = 0;
    for (const sim of all()) {
      for (const s of scenesOf(sim)) {
        const I = sim.incidents[s.incidentId];
        for (const c of s.casualties) if (c.dead) { dead++; expect(c.tDead, `${sim.seed} ${I.code} ${c.label}`).toBeLessThanOrEqual(I.closedAt); }
      }
      for (const e of sim.events) {
        if (e.role !== 'SYSTEM' || e.kind !== 'casualty' || !/생체 반응 소실|생체 반응이 사라졌습니다|떠내려갔습니다/.test(e.text)) continue;      // 구조 대상의 사망 기록만 (대원의 순직 기록도 '생체 반응 소실' 이라고 쓴다 — 아래 "9. 가짜 연출 없음 — 순직" 이 본다)
        recs++;
        expect(e.t, `${sim.seed} ${e.text}`).toBeLessThanOrEqual(sim.incidents[e.incidentId].closedAt);
      }
    }
    expect(dead).toBeGreaterThan(10); expect(recs).toBe(dead);
  });
  it('판정 뒤에는 악화가 멈추고 hurtCas 도 아무것도 하지 않는다 — 대피 이동만 남는다', () => {
    const { sim, s } = sceneOf('INJ-closed', 'fire');
    const I = sim.incidents[s.incidentId];
    const c = addCas(s, s.staging.x + 2, s.staging.y, 'immobile', 30, 0.5, 0);      // 대기 지점 곁의 길 위 (현장 안)
    const walker = addCas(s, s.staging.x + 5, s.staging.y, 'mobile', 90, 0.3, 0);
    walker.walking = true;
    const step = (): void => { sim.tick++; sim.t = sim.tick * sim.dt; tickCasualties(sim, s, I); };
    step();
    expect(c.health).toBeLessThan(30); expect(walker.health).toBeLessThan(90);      // 열려 있는 동안에는 나빠진다
    I.phase = 'closed'; I.closedAt = sim.t;
    const hp = c.health, hpW = walker.health, x0 = walker.x, y0 = walker.y, n = sim.events.length;
    for (let k = 0; k < 40; k++) step();
    expect(c.health).toBe(hp); expect(walker.health).toBe(hpW);
    expect(Math.hypot(walker.x - x0, walker.y - y0)).toBeGreaterThan(0.5);      // 걷던 사람은 계속 걷는다
    hurtCas(sim, s, I, c, 500, 'blast', { bleed: 0.9, immobile: true, ev: 3 });
    expect([c.health, c.bleed, c.dead, c.deathCause]).toEqual([hp, 0.5, false, undefined]);
    // 이미 0 이하였던 사람도 판정 뒤에는 숨진 것으로 바뀌지 않는다 (판정과 기록이 어긋나지 않게)
    c.health = -3;
    for (let k = 0; k < 5; k++) step();
    expect(c.dead).toBe(false);
    expect(sim.events.slice(n).some((e) => /생체 반응/.test(e.text))).toBe(false);
  });
  it('판정 뒤에는 세계 규칙도 사람을 다치게 하지 않는다: 떠내려가 숨지지 않고, 주변 시민이 새로 쓰러지지 않는다', () => {
    const w = sceneOf('INJ-closed-w', 'water');
    const Iw = w.sim.incidents[w.s.incidentId];
    const c = w.s.casualties.find((q) => q.inWater)!;
    c.drift = 5; c.x = w.s.w - 1.25;
    Iw.phase = 'closed'; Iw.closedAt = w.sim.t;
    w.sim.tick++; w.sim.t = w.sim.tick * w.sim.dt;
    tickWater(w.sim, w.s, Iw);
    expect([c.dead, c.lost, c.inWater]).toEqual([false, undefined, true]);
    // 가스 누출 현장 열두 곳: 열려 있을 때는 주변 시민이 쓰러지는 조건(위의 '사건 중에 붙는 주변 시민' 시험과 같다)에서, 닫힌 뒤에는 한 명도 생기지 않는다
    for (let k = 0; k < 12; k++) {
      const { sim, s } = sceneOf('INJ-gas' + k, 'hazmat');
      const I = sim.incidents[s.incidentId];
      s.arrivedAt = 0;
      I.phase = 'closed'; I.closedAt = sim.t;
      const n0 = s.casualties.length;
      for (let q = 0; q < 400; q++) { sim.tick++; sim.t = sim.tick * sim.dt; for (const e of s.exits) s.smoke[e.y * s.w + e.x] = Math.max(s.smoke[e.y * s.w + e.x], 0.5); tickGas(sim, s, I); }
      expect(s.casualties.length, 'INJ-gas' + k).toBe(n0);
    }
  });
});

// ───────────────────────── 단계 3: 사건 중 새 부상 (§5.1) ─────────────────────────
/** 붕괴 현장 가운데 아직 무너지지 않은 균열 구조물이 있고 그 둘레가 빈 현장 */
function collapseScene(tag: string): { sim: Sim; s: Scene; I: Incident; p: Prop } {
  for (let k = 0; k < 40; k++) {
    const { sim, s } = sceneOf(tag + k, 'collapse', 'std');
    const p = s.props.find((q) => q.kind === 'unstable' && !q.mitigated && (q.leakRate ?? 0) > 0);
    if (!p || p.x < 4 || p.y < 4 || p.x > s.w - 5 || p.y > s.h - 5) continue;
    return { sim, s, I: sim.incidents[s.incidentId], p };
  }
  throw new Error('균열 구조물이 있는 붕괴 현장을 찾지 못했다');
}
describe('5. 사건 중 새 부상 — 폭발은 고르게, 2차 붕괴는 곁의 사람을 가둔다', () => {
  it('폭발(blast)에 휩쓸려 체력이 80 아래가 된 사람은 걷던 사람도 쓰러지고 피를 흘린다 (갇힌 사람은 그대로, 80 이상 남은 사람은 그대로)', () => {
    const { sim, s } = sceneOf('INJ-blast', 'fire');
    const I = sim.incidents[s.incidentId];
    const cx = 8, cy = 8, R = 3.6, D = 34;      // 가스 용기 폭발의 반경과 피해
    const near = addCas(s, cx + 1, cy, 'mobile', 95, 0, 0); near.walking = true; near.path = [1, 2];
    const edge = addCas(s, cx + 3.5, cy, 'mobile', 100, 0, 0); edge.walking = true;
    const trapped = addCas(s, cx, cy + 1, 'trapped', 90, 0.01, 0);
    const bleeder = addCas(s, cx - 1, cy, 'immobile', 60, 0.9, 0);
    blast(sim, s, I, cx, cy, R, D, 77);
    const want = (d: number): number => (0.09 + 0.09 * (1 - d / R)) * sim.tune.bleedMul;
    expect(near.health).toBeCloseTo(95 - D * 0.8 * (1 - 1 / (R + 1)), 9);
    expect([near.mob, near.walking, near.path, near.bleedCause, near.causeEvent]).toEqual(['immobile', false, null, 'blast', 77]);
    expect(near.bleed).toBeCloseTo(want(1), 12); expect(near.bleed0).toBe(near.bleed);
    expect(near.injuries!.map((j) => [j.cause, j.ev])).toEqual([['blast', 77]]);
    // 가장자리: 다치기는 했지만 80 이상 남았다 — 계속 걷는다
    expect(edge.health).toBeLessThan(100); expect(edge.health).toBeGreaterThanOrEqual(80);
    expect([edge.mob, edge.walking, edge.bleed]).toEqual(['mobile', true, 0]);
    // 갇힌 사람은 갇힌 채로 피를 흘린다. 이미 더 크게 피를 흘리던 사람의 출혈은 줄지 않고 원인도 그대로다
    expect(trapped.mob).toBe('trapped'); expect(trapped.bleed).toBeCloseTo(want(1), 12);
    expect(bleeder.bleed).toBe(0.9); expect(bleeder.bleedCause).toBeUndefined();
  });
  it('무너져 내린 것(천장·2차 붕괴 — 원인 crush)에는 그 규칙을 걸지 않는다: 체력만 깎인다', () => {
    const { sim, s } = sceneOf('INJ-crushblast', 'fire');
    const I = sim.incidents[s.incidentId];
    const c = addCas(s, 9, 8, 'mobile', 70, 0, 0); c.walking = true;
    blast(sim, s, I, 8, 8, 2.2, 22, 5, 'crush');
    expect(c.health).toBeLessThan(70);
    expect([c.mob, c.walking, c.bleed, c.bleedCause]).toEqual(['mobile', true, 0, undefined]);
    expect(c.injuries!.map((j) => j.cause)).toEqual(['crush']);
  });
  it('폭발물도 같은 규칙으로 간다 (detonate 가 따로 하던 일을 blast 가 한다)', () => {
    const { sim, s } = sceneOf('INJ-bomb', 'armed', 'bomb');
    const I = sim.incidents[s.incidentId];
    const p = s.props.find((q) => q.kind === 'bomb')!;
    expect(p).toBeTruthy();
    const c = addCas(s, p.x + 1, p.y, 'mobile', 100, 0, 0); c.walking = true;
    detonate(sim, s, I, p);
    expect(c.health).toBeCloseTo(100 - 55 * 0.8 * (1 - 1 / 4.4), 9);
    expect([c.mob, c.walking, c.bleedCause]).toEqual(['immobile', false, 'blast']);
    expect(c.bleed).toBeCloseTo((0.09 + 0.09 * (1 - 1 / 3.4)) * sim.tune.bleedMul, 12);
    expect(c.causeEvent).toBeGreaterThanOrEqual(0);
    expect(sim.events[c.causeEvent].text).toMatch(/폭발물이 터졌습니다/);
  });
  it('2차 붕괴: 무너진 자리 1.6칸 안의 사람은 갇힌다 (걷던 사람도 멈춘다) — 업혀 있는 사람, 이미 갇힌 사람, 그보다 먼 사람은 그대로', () => {
    const { sim, s, I, p } = collapseScene('INJ-col');
    const near = addCas(s, p.x + 1, p.y, 'mobile', 100, 0, 0); near.walking = true; near.path = [1, 2];
    const lying = addCas(s, p.x, p.y + 1.5, 'immobile', 80, 0.05, 0);
    const far = addCas(s, p.x + 2.4, p.y, 'immobile', 100, 0, 0);
    const already = addCas(s, p.x - 1, p.y, 'trapped', 90, 0, 0);
    const carried = addCas(s, p.x, p.y - 1, 'immobile', 90, 0, 0); carried.where = 'carried';
    const first = sim.rng.fork('injury:' + s.id + ':trap').range(TRAP_WORK[0], TRAP_WORK[1]);
    p.leak = 1;
    sim.tick++; sim.t = sim.tick * sim.dt;
    tickCollapse(sim, s, I);
    expect(sim.events.some((e) => /2차 붕괴!/.test(e.text))).toBe(true);
    expect([near.mob, near.walking, near.path]).toEqual(['trapped', false, null]);
    expect(near.trapWork).toBe(first);      // 목적별 흐름 injury:<현장>:trap 의 첫 값
    expect(lying.mob).toBe('trapped');
    for (const c of [near, lying]) { expect(c.trapWork).toBeGreaterThanOrEqual(TRAP_WORK[0]); expect(c.trapWork).toBeLessThanOrEqual(TRAP_WORK[1]); expect(c.injuries!.some((j) => j.cause === 'crush')).toBe(true); }
    expect(far.mob).toBe('immobile'); expect(far.health).toBeLessThan(100);      // 피해는 입지만(반경 2.6) 갇히지는 않는다
    expect([already.mob, already.trapWork]).toEqual(['trapped', 14]);
    expect(carried.mob).toBe('immobile'); expect(carried.health).toBe(90);
    expect(TRAP_R).toBe(1.6);
  });
  it('판정 뒤의 2차 붕괴는 사람을 가두지도 다치게 하지도 않는다', () => {
    const { sim, s, I, p } = collapseScene('INJ-col');
    const near = addCas(s, p.x + 1, p.y, 'mobile', 100, 0, 0);
    I.phase = 'closed'; I.closedAt = sim.t;
    p.leak = 1;
    sim.tick++; sim.t = sim.tick * sim.dt;
    tickCollapse(sim, s, I);
    expect([near.mob, near.health, near.injuries]).toEqual(['mobile', 100, undefined]);
  });
  it('옮기러 간 사람이 갇혀 있으면 실행기가 그 사실을 강제로 다시 알리고 끝낸다 (지휘관의 낡은 믿음으로 같은 지시가 되풀이되지 않게)', () => {
    const { sim, s, I, p } = collapseScene('INJ-carry');
    unitArrived(sim, I, sim.units.find((u) => u.kind === 'rescue')!);
    const a = s.agents.find((b) => b.status === 'active')!;
    const c = addCas(s, p.x + 1, p.y, 'immobile', 80, 0.05, 0);
    c.tDiscovered = sim.t;
    a.beliefs.merge(mkFact('cas', c.id, { x: c.x, y: c.y, mob: 'immobile', band: 0, where: 'scene', treated: false, tq: 0 }, 't', sim.t, 1, true, ''));
    const w: WorkItem = { id: s.nextWorkId++, kind: 'carry', region: -1, cas: c.id, prop: -1, hostile: -1, tile: -1, mate: -1, priority: 0.84, status: 'active', assignees: [a.rid], max: 2, createdAt: sim.t, doneAt: -1, note: '', fails: 0, holdUntil: 0, thorough: false, orderSentAt: {}, cause: -1, failedAt: {} };
    s.board[w.id] = w;
    a.task = makeTask('carry', '이송', w);
    c.mob = 'trapped'; c.trapWork = 8;      // 맡은 뒤에 갇혔다
    a.outbox.length = 0;
    act(sim, s, a);
    expect(a.task).toBeNull();
    expect(w.status).toBe('open'); expect(w.fails).toBe(1);
    expect((a.beliefs.get('cas', c.id)!.value as { mob: string }).mob).toBe('trapped');
    expect(a.outbox.some((f) => f.type === 'cas' && f.id === c.id && (f.value as { mob: string }).mob === 'trapped')).toBe(true);
  });
  it('지휘관은 갇힌 줄 알게 된 사람의 이송·동행 지시를 거두고 구출을 낸다 (두면 같은 실패가 구출이 끝날 때까지 되풀이된다)', () => {
    const { sim, s, I, p } = collapseScene('INJ-carry');
    unitArrived(sim, I, sim.units.find((u) => u.kind === 'rescue')!);
    const cmd = s.agents.find((b) => b.isCommander)!;
    const c = addCas(s, p.x + 1, p.y, 'trapped', 60, 0.05, 0);
    c.tDiscovered = sim.t;
    cmd.beliefs.merge(mkFact('cas', c.id, { x: c.x, y: c.y, mob: 'trapped', band: 1, where: 'scene', treated: false, tq: 0 }, 't', sim.t, 1, true, ''));
    const item = (kind: 'carry' | 'escort'): WorkItem => {
      const w: WorkItem = { id: s.nextWorkId++, kind, region: -1, cas: c.id, prop: -1, hostile: -1, tile: -1, mate: -1, priority: 0.84, status: 'open', assignees: [], max: 2, createdAt: sim.t, doneAt: -1, note: '', fails: 0, holdUntil: 0, thorough: false, orderSentAt: {}, cause: -1, failedAt: {} };
      s.board[w.id] = w; return w;
    };
    const carry = item('carry'), escort = item('escort');
    s.sizeupDone = true;
    commanderThink(sim, s, cmd);
    expect([carry.status, escort.status]).toEqual(['cancelled', 'cancelled']);
    expect(s.board.some((w) => w.kind === 'extricate' && w.cas === c.id && (w.status === 'open' || w.status === 'active'))).toBe(true);
  });
});

/** 대원 하나가 곁에 갇힌 사람을 구출하게 해 놓고 끝날 때까지 돌린다. 위험 배율(hazardMul)을 바꿔 사고를 반드시 내거나 반드시 막는다 */
function extricateOnce(type: IncidentType, variant: string | undefined, hazardMul: number, closed = false): { sim: Sim; s: Scene; c: Casualty; hp0: number; n0: number; done: boolean } {
  const { sim, s } = type === 'collapse' && variant === 'std' ? collapseScene('INJ-ext') : sceneOf('INJ-ext', type, variant);
  const I = sim.incidents[s.incidentId];
  unitArrived(sim, I, sim.units.find((u) => u.kind === 'rescue')!);
  const a = s.agents.find((b) => b.status === 'active')!;
  s.agents = [a];      // 교대(더 알맞은 대원이 넘겨받기)가 끼어들지 않게 혼자 둔다
  const c = addCas(s, Math.round(a.x), Math.round(a.y) + 1, 'trapped', 80, 0, 0);
  c.trapWork = 0.05; c.tDiscovered = sim.t;
  const w: WorkItem = { id: s.nextWorkId++, kind: 'extricate', region: -1, cas: c.id, prop: -1, hostile: -1, tile: -1, mate: -1, priority: 0.82, status: 'active', assignees: [a.rid], max: 2, createdAt: sim.t, doneAt: -1, note: '', fails: 0, holdUntil: 0, thorough: false, orderSentAt: {}, cause: -1, failedAt: {} };
  s.board[w.id] = w;
  a.task = makeTask('extricate', '구출', w);
  (sim.tune as { hazardMul: number }).hazardMul = hazardMul;
  if (closed) { I.phase = 'closed'; I.closedAt = sim.t; }
  const n0 = sim.events.length;
  for (let k = 0; k < 60 && c.mob === 'trapped'; k++) { sim.tick++; sim.t = sim.tick * sim.dt; act(sim, s, a); }
  return { sim, s, c, hp0: 80, n0, done: c.mob !== 'trapped' };
}
describe('5. 구출 중 사고 — 붕괴 현장에서 구출을 마칠 때 잔해가 내려앉을 수 있다', () => {
  it('사고가 나면: 잔해 깔림 6~14 를 더 입고, 그 기록이 구출 완료 기록 앞에 남으며 부상 기록·causeEvent 가 그 기록을 가리킨다', () => {
    const { sim, s, c, hp0, n0, done } = extricateOnce('collapse', 'std', 1000);
    expect(done).toBe(true);
    const evs = sim.events.slice(n0);
    const acc = evs.find((e) => /^구출 도중 잔해가 내려앉아 구조 대상 .+[이가] 더 다쳤습니다\.$/.test(e.text))!;
    const fin = evs.find((e) => /구출 완료/.test(e.text))!;
    expect(acc).toBeTruthy(); expect(fin).toBeTruthy();
    expect(acc.id).toBeLessThan(fin.id);
    expect([acc.kind, acc.importance, acc.role]).toEqual(['hazard', 2, 'SYSTEM']);
    expect(hp0 - c.health).toBeGreaterThanOrEqual(MISHAP.hit[0]); expect(hp0 - c.health).toBeLessThanOrEqual(MISHAP.hit[1]);
    expect(c.injuries).toEqual([{ cause: 'crush', dmg: hp0 - c.health, sev: bandOf(c.health), t: acc.t, last: acc.t, by: -1, byKind: 'world', ev: acc.id }]);
    expect(c.causeEvent).toBe(acc.id);
    // 목적별 흐름 injury:<현장>:extricate 에서 확률, 피해 순서로 뽑았다
    const probe = sim.rng.fork('injury:' + s.id + ':extricate'); probe.next();
    expect(hp0 - c.health).toBeCloseTo(probe.range(MISHAP.hit[0], MISHAP.hit[1]), 9);
  });
  it('사고가 없으면 아무것도 남지 않는다. 붕괴 현장이 아닌 곳(차에 낀 사람)과 승강기, 판정 뒤에는 추첨도 하지 않는다', () => {
    const quiet = extricateOnce('collapse', 'std', 0);
    expect(quiet.done).toBe(true);
    expect([quiet.c.health, quiet.c.injuries]).toEqual([80, undefined]);
    expect(quiet.sim.events.slice(quiet.n0).some((e) => /구출 도중/.test(e.text))).toBe(false);
    for (const [type, variant, closed] of [['traffic', 'std', false], ['collapse', 'elevator', false], ['collapse', 'std', true]] as [IncidentType, string, boolean][]) {
      const r = extricateOnce(type, variant, 1000, closed);
      const tag = `${type}/${variant}${closed ? ' (판정 뒤)' : ''}`;
      expect(r.done, tag).toBe(true);
      expect([r.c.health, r.c.injuries], tag).toEqual([80, undefined]);
      // 흐름을 건드리지 않았다: 다음에 뽑히는 값이 새로 만든 흐름의 첫 값과 같다
      expect(injuryRng(r.sim, r.s, 'extricate').next(), tag).toBe(r.sim.rng.fork('injury:' + r.s.id + ':extricate').next());
    }
  });
});

describe('5. 스스로 대피하다 다치는 경우 — 위중(체력 40 이하)이 되면 멈춘다 (§5.2)', () => {
  const stepScene = (sim: Sim, s: Scene): void => { sim.tick++; sim.t = sim.tick * sim.dt; tickScene(sim, s); };
  it('걷던 사람이 체력 40 이하가 되면 쓰러진다: 거동 불가가 되고, 관찰자만 아는 기록 하나가 원인과 함께 남는다', () => {
    const { sim, s } = sceneOf('INJ-walk', 'fire');
    const c = addCas(s, s.staging.x + 4, s.staging.y, 'mobile', 40.5, 4, 0);      // 대기 지점 곁의 길 위 (현장 안)
    c.walking = true; c.bleedCause = 'smoke';
    const ok = addCas(s, s.staging.x + 5, s.staging.y, 'mobile', 47, 4, 0);      // 40 위: 계속 걷는다
    ok.walking = true; ok.bleedCause = 'smoke';
    const still = addCas(s, s.staging.x + 6, s.staging.y, 'mobile', 30, 0, 0);      // 걷고 있지 않은 사람은 건드리지 않는다
    const n0 = sim.events.length;
    stepScene(sim, s);
    expect(c.health).toBeLessThanOrEqual(WALK_STOP);
    expect([c.walking, c.mob, c.path]).toEqual([false, 'immobile', null]);
    const recs = sim.events.slice(n0).filter((e) => /^대피하던 구조 대상 /.test(e.text));
    expect(recs.map((e) => e.text)).toEqual([`대피하던 구조 대상 ${josa(c.label, '이/가')} 연기 흡입으로 쓰러졌습니다.`]);
    expect([recs[0].kind, recs[0].importance, recs[0].truth, recs[0].role]).toEqual(['casualty', 2, true, 'SYSTEM']);
    expect(c.causeEvent).toBe(recs[0].id);
    expect([ok.walking, ok.mob]).toEqual([true, 'mobile']);
    expect([still.walking, still.mob]).toEqual([false, 'mobile']);
    // 한 번만 남는다
    for (let k = 0; k < 10; k++) stepScene(sim, s);
    expect(sim.events.slice(n0).filter((e) => new RegExp(`^대피하던 구조 대상 ${c.label}`).test(e.text)).length).toBe(1);
  });
  it('원인은 지금 선 자리에서 가장 크게 깎는 항이다 (불 속이면 화상). 판정 뒤에는 쓰러지지 않는다', () => {
    const { sim, s } = sceneOf('INJ-walk2', 'fire');
    const c = addCas(s, s.staging.x + 4, s.staging.y, 'mobile', 40.2, 0.2, 0);
    c.walking = true; c.bleedCause = 'smoke';
    for (let y = Math.max(0, c.y - 2); y <= Math.min(s.h - 1, c.y + 2); y++) for (let x = Math.max(0, c.x - 2); x <= Math.min(s.w - 1, c.x + 2); x++) { s.fire[y * s.w + x] = 0.45; s.fuel[y * s.w + x] = 1; }      // 한 걸음 옮겨도 불 속이다
    stepScene(sim, s);
    expect(sim.events.some((e) => e.text === `대피하던 구조 대상 ${josa(c.label, '이/가')} 화상으로 쓰러졌습니다.`)).toBe(true);
    const closed = sceneOf('INJ-walk3', 'fire');
    const I = closed.sim.incidents[closed.s.incidentId];
    const d = addCas(closed.s, closed.s.staging.x + 4, closed.s.staging.y, 'mobile', 30, 0, 0);
    d.walking = true;
    I.phase = 'closed'; I.closedAt = closed.sim.t;
    closed.s.agents.push(makeAgent(closed.sim, 0, 0, closed.s.staging.x, closed.s.staging.y, 1e9, closed.sim.rng.fork('t')));      // 대원이 남아 있어 환경 단계가 도는 닫힌 현장
    stepScene(closed.sim, closed.s);
    expect([d.walking, d.mob]).toEqual([true, 'mobile']);
  });
  it('현장이 비었을 때의 종료 판단(outstanding): 대피 중이라던 사람의 소식이 32초 넘게 끊겼으면 남은 일로 센다', () => {
    const { sim, s } = sceneOf('INJ-out', 'fire');
    const a = makeAgent(sim, 0, 0, s.staging.x, s.staging.y, 1e9, sim.rng.fork('t'));
    const fact = (id: number, mob: 'mobile' | 'immobile', where: 'scene' | 'safe', band: number, t: number): void => { a.beliefs.merge(mkFact('cas', id, { x: 3, y: 3, mob, band, where, treated: false, trappedDone: false, tq: 0 }, 't', t, 1, true, '')); };
    fact(0, 'mobile', 'scene', 1, 100);
    expect(outstanding(a).patients).toBe(0);              // 시각을 주지 않으면 예전 그대로 (상공의 감시 판단이 쓴다)
    expect(outstanding(a, 120).patients).toBe(0);         // 방금 대피를 시작했다
    expect(outstanding(a, 132).patients).toBe(0);
    expect(outstanding(a, 132.2).patients).toBe(1);       // 32초 넘게 소식이 없다: 대피하다 쓰러졌을 수 있다
    fact(1, 'mobile', 'safe', 1, 0);                      // 안전 구역에 닿은 걸을 수 있는 사람은 예전처럼 남은 일이 아니다
    fact(2, 'mobile', 'safe', 0, 0);
    expect(outstanding(a, 500).patients).toBe(1);
    fact(3, 'immobile', 'scene', 2, 0);
    expect(outstanding(a, 500).patients).toBe(2);
  });
  it('현장이 비면(7번 블록): 소식이 끊긴 "대피 중"이 있으면 끝내지 않고 추가 부대를 찾고, 방금 대피를 시작한 사람뿐이면 예전처럼 끝낸다', () => {
    const run = (age: number): { sim: Sim; I: Incident; texts: string[] } => {
      const { sim, s } = sceneOf('INJ-empty', 'medical');
      const I = sim.incidents[s.incidentId];
      sim.tick = 1000; sim.t = sim.tick * sim.dt;
      unitArrived(sim, I, sim.units.find((u) => u.kind === 'als')!);
      const cmd = s.agents.find((b) => b.isCommander)!;
      s.sizeupDone = true;
      for (const c of s.casualties) cmd.beliefs.merge(mkFact('cas', c.id, { x: 3, y: 3, mob: 'mobile', band: 1, where: 'scene', treated: false, trappedDone: false, tq: 0 }, 't', sim.t - age, 1, true, ''));
      for (const b of s.agents) { b.status = 'left'; b.task = null; }      // 구급차가 환자를 싣고 떠난 것처럼 현장을 비운다
      const n0 = sim.events.length;
      sim.tick++; sim.t = sim.tick * sim.dt;
      tickScene(sim, s);
      return { sim, I, texts: sim.events.slice(n0).map((e) => e.text) };
    };
    const stale = run(100);
    expect(stale.I.phase).not.toBe('closed');
    expect(stale.texts.some((t) => /현장에 남은 부대가 없는데 아직 끝나지 않았습니다/.test(t))).toBe(true);
    expect(stale.I.unmet.ems).toBeGreaterThanOrEqual(1);
    const fresh = run(10);
    expect(fresh.I.phase).toBe('closed'); expect(fresh.I.closeReason).toBe('resolved');
  });
});

describe('5. 문구와 원인 — 사망 기록의 원인, 물에서 건진 뒤의 악화, 조사 (§5.3)', () => {
  it('구조 대상의 사망 기록에는 숨지게 한 원인이 괄호로 붙는다 (발견된 사람·미발견 모두)', () => {
    let seen = 0, unseen = 0;
    for (const sim of all()) for (const s of scenesOf(sim)) for (const c of s.casualties) {
      if (!c.dead || c.lost) continue;
      const name = CAUSE_NAME[c.deathCause!];
      const texts = sim.events.filter((e) => e.incidentId === s.incidentId && e.role === 'SYSTEM' && e.kind === 'casualty' && e.importance === 3).map((e) => e.text);
      const known = `구조 대상 ${c.label}: 생체 반응 소실 (${name}). 구조에 실패했습니다.`, hidden = `(미발견) 구조 대상 ${c.label}의 생체 반응이 사라졌습니다 (${name}).`;
      const hit = texts.filter((t) => t === known || t === hidden);
      expect(hit.length, `${sim.seed} ${sim.incidents[s.incidentId].code} ${c.label}: ${texts.join(' / ')}`).toBe(1);
      if (hit[0] === known) seen++; else unseen++;
    }
    expect(seen).toBeGreaterThan(3); expect(unseen).toBeGreaterThan(3);
  });
  it('물에서 건져 낸 사람에게 남는 악화는 익수가 아니라 실외 노출(저체온)이다 — 물가의 구조 줄과 헬기의 호이스트 모두', () => {
    let hoists = 0, freed = 0;
    // (R2 1a) S7 을 더했다: 물가 방법이 갈린 뒤 S5·S8 의 물가 구조는 헬기의 호이스트가 먼저 끝난다 (줄이 없는 구급대원의 즉석 부력물이 구명줄보다 느리다)
    for (const seed of ['S5', 'S8', 'S7']) {
      const sim = shift(seed, NORMAL, 'water/std');
      hoists += sim.airStats.hoists;
      for (const s of scenesOf(sim)) if (s.kind === 'water') for (const c of s.casualties) {
        if (c.tFreed < 0) { if (c.inWater) expect(c.bleedCause, `${seed} ${c.label}`).toBe('drown'); continue; }
        freed++;
        expect(c.bleedCause, `${seed} ${c.label}`).toBe('exposure');
        expect((c.injuries ?? []).some((j) => j.cause === 'drown'), `${seed} ${c.label}`).toBe(true);      // 물속에 있던 동안은 익수로 적혀 있다
      }
    }
    expect(hoists).toBeGreaterThanOrEqual(2);      // 호이스트로 건진 사람이 있다
    expect(freed).toBeGreaterThan(hoists);         // 물가에서 줄로 건진 사람도 있다
  });
  it('이름표 뒤의 조사는 josa 로 붙는다: 떠내려간 사람(미발견), 용의자가 다치게 한 기록', () => {
    const { sim, s } = sceneOf('INJ-water', 'water');
    const I = sim.incidents[s.incidentId];
    const c = s.casualties.find((q) => q.inWater)!;
    c.label = 'L';      // 받침이 있는 이름표 (엘)
    c.drift = 5; c.x = s.w - 1.25;
    sim.tick++; sim.t = sim.tick * sim.dt;
    tickWater(sim, s, I);
    expect(sim.events[sim.events.length - 1].text).toBe('(미발견) 구조 대상 L이 물살에 휩쓸려 떠내려갔습니다.');
    const src = readFileSync('src/sim/field/hazards.ts', 'utf8');
    for (const fn of ['panicShot', 'tickWater']) expect(src.slice(src.indexOf('export function ' + fn + '('), src.indexOf('\n}\n', src.indexOf('export function ' + fn + '('))), fn).not.toMatch(/\$\{[a-z]+\.label\}[가이는은를을] /);
    // 인질 시한·총격범의 문구 (tickHostiles 안)
    for (const key of ['요구가 받아들여지지 않자', '건물 안의 시민을 쐈습니다']) { const line = src.split('\n').find((l) => l.includes(key))!; expect(line, key).toContain("josa(h.label, '이/가')"); }
  });
});

// ───────────────────────── 11. 재현성 ─────────────────────────
describe('11. 재현성과 목적별 난수 흐름', () => {
  it('같은 시드·같은 강제 시나리오는 기록 해시와 부상 기록이 같다', () => {
    const a = shooter[0], b = shift('INJ0', NORMAL, 'armed/shooter');
    expect(b.report!.hash).toBe(a.report!.hash);
    const dump = (sim: Sim): string => JSON.stringify([sim.responders.map((r) => r.injuries ?? null), scenesOf(sim).map((s) => [s.casualties.map((c) => [c.injuries ?? null, c.bleedCause ?? null, c.deathCause ?? null]), s.hostiles.map((h) => h.injuries ?? null)])]);
    expect(dump(b)).toBe(dump(a));
    expect(dump(a)).toContain('gunshot');
  });
  it('injuryRng 를 쓰는 규칙(2차 붕괴 곁의 갇힘)이 일어난 교대도 같다 — 지진 교대 둘', () => {
    const QUAKE: Difficulty = { ...NORMAL, disaster: 'quake' };
    // (N8 단계 6a) W6 → W5: 경찰 새 부대 셋(형사·교통 경찰·경찰견)이 편성돼 W6 의 2차 붕괴 곁에 갇힌 사람이 없어졌다 — 갇힘 흐름을 쓰는 지진 교대로 (기준은 그대로)
    // (N8 단계 8·9) W5 → W1: 구조 유형이 평소 추첨에 들어 W5 의 2차 붕괴 곁에 갇힌 사람이 없어졌다 — W0~W9 가운데 갇힘 흐름을 쓰는 W1·W9 의 앞쪽으로 (기준은 그대로)
    // (N8 단계 10) W1 → W4: 중복 신고·조건부 연쇄가 들어 W1 의 2차 붕괴 곁에 갇힌 사람이 없어졌다 — W0~W11 가운데 갇힘 흐름을 쓰는 W4·W6·W8~W10 의 앞쪽으로 (기준은 그대로)
    // (N8 단계 11) W4 → W0: 짧은 사건 수(보통 5 → 4)가 바뀌어 W4 의 2차 붕괴 곁에 갇힌 사람이 없어졌다 — W0~W9 가운데 갇힘 흐름을 쓰는 W0·W1·W5·W6·W8·W9 의 앞쪽으로 (기준은 그대로)
    const a = shift('W0', QUAKE), b = shift('W0', QUAKE);
    expect(b.report!.hash).toBe(a.report!.hash);
    expect(a.events.some((e) => /^2차 붕괴!/.test(e.text))).toBe(true);
    // 갇힘 흐름이 실제로 쓰였다: 어느 현장에서는 다음 값이 새 흐름의 첫 값과 다르다
    const used = (sim: Sim): number => scenesOf(sim).filter((s) => injuryRng(sim, s, 'trap').next() !== sim.rng.fork('injury:' + s.id + ':trap').next()).length;
    expect(used(a)).toBeGreaterThanOrEqual(1);
    const dump = (sim: Sim): string => JSON.stringify(scenesOf(sim).map((s) => s.casualties.map((c) => [c.health, c.mob, c.trapWork, c.injuries ?? null, c.deathCause ?? null])));
    expect(dump(b)).toBe(dump(a));
  });
  it('injuryRng: 목적마다 흐름이 따로다 — 한쪽을 몇 번 뽑아도 다른 쪽의 첫 값이 같고, 현장의 다른 흐름을 건드리지 않는다', () => {
    const mk = (): { sim: Sim; s: Scene } => sceneOf('INJ-rng', 'collapse');
    const a = mk(), b = mk();
    const before = [a.s.rng.next(), a.sim.rng.next()];
    for (let k = 0; k < 7; k++) injuryRng(a.sim, a.s, 'trap').next();
    expect(injuryRng(a.sim, a.s, 'fall').next()).toBe(injuryRng(b.sim, b.s, 'fall').next());
    expect(injuryRng(a.sim, a.s, 'trap')).toBe(injuryRng(a.sim, a.s, 'trap'));      // 같은 흐름을 이어 쓴다
    expect(injuryRng(a.sim, a.s, 'trap')).not.toBe(injuryRng(a.sim, a.s, 'fall'));
    expect(injuryRng(b.sim, b.s, 'trap').next()).not.toBe(injuryRng(b.sim, b.s, 'extricate').next());
    // 현장 흐름·교대 흐름은 그대로다 (fork 는 부모의 상태를 바꾸지 않는다)
    expect([b.s.rng.next(), b.sim.rng.next()]).toEqual(before);
  });
});

// ───────────────────────── 객체 모양 (P1) ─────────────────────────
describe('객체 모양 — 새 선택 칸은 만들 때부터 같은 순서로 있다', () => {
  const own = (o: object, keys: string[]): void => { for (const k of keys) expect(Object.prototype.hasOwnProperty.call(o, k), k).toBe(true); };
  it('구조 대상·용의자·대원 개체·명부의 대원·부대', () => {
    const { sim, s } = sceneOf('INJ-shape', 'hazmat');
    const c = addCas(s, 3, 3, 'mobile', 100, 0, 0), h = addHostile(s, 4, 4, 'knife', 0.5, 0.5, false, 1e9);
    own(c, ['injuries', 'bleedCause', 'deathCause', 'lost']);
    own(h, ['injuries', 'bleed', 'bleed0', 'treatQ', 'tTreated', 'dead', 'tDown', 'tDead', 'where', 'bleedCause', 'deathCause', 'selfHarmRolled']);
    own(makeAgent(sim, 0, 0, 1, 1, 0, sim.rng.fork('x')), ['hurtEv', 'hpTick', 'lastTile', 'fellOnce', 'lightBack']);
    for (const r of sim.responders) own(r, ['injuries', 'bleed', 'bleed0', 'treatQ', 'dead', 'tDown', 'tDead', 'care', 'deathCause']);
    for (const u of sim.units) own(u, ['aboard', 'firstLoadAt', 'oosEv']);
    // 인근 도시 지원 부대와 그 대원은 편성표의 것과 칸·순서가 같다
    const I = sim.incidents[s.incidentId];
    const n0 = sim.responders.length;
    const aid = createAidUnit(sim, 'ems', I)!;
    expect(aid).toBeTruthy();
    expect(Object.keys(aid)).toEqual(Object.keys(sim.units[0]));
    expect(Object.keys(sim.responders[n0])).toEqual(Object.keys(sim.responders[0]));
  });
  it('사건 중에 붙는 주변 시민(가스 노출)은 처음부터 있던 구조 대상과 칸·순서가 같고, 만든 자리가 원인(유독 가스)을 적는다', () => {
    let made: { c: Casualty; first: Casualty } | null = null;
    for (let k = 0; k < 12 && !made; k++) {
      const { sim, s } = sceneOf('INJ-gas' + k, 'hazmat');
      const I = sim.incidents[s.incidentId];
      s.arrivedAt = 0;      // 주변 시민은 부대가 닿은 뒤에만 다가온다
      for (const e of s.exits) s.smoke[Math.max(0, Math.min(s.h - 1, e.y)) * s.w + Math.max(0, Math.min(s.w - 1, e.x))] = 0.5;
      const n0 = s.casualties.length;
      for (let q = 0; q < 400 && s.casualties.length === n0; q++) { sim.tick++; sim.t = sim.tick * sim.dt; for (const e of s.exits) s.smoke[e.y * s.w + e.x] = Math.max(s.smoke[e.y * s.w + e.x], 0.5); tickGas(sim, s, I); }
      if (s.casualties.length > n0 && n0 > 0) made = { c: s.casualties[n0], first: s.casualties[0] };
    }
    expect(made, '가스에 노출된 주변 시민이 한 번도 생기지 않았다').not.toBeNull();
    const { c, first } = made!;
    expect(c.bystander2).toBe(true);
    expect(Object.keys(c)).toEqual(Object.keys(first));
    expect(c.bleedCause).toBe('toxic');
    expect(c.injuries).toEqual([{ cause: 'toxic', dmg: 100 - c.health, sev: bandOf(c.health), t: c.injuries![0].t, last: c.injuries![0].t, by: -1, byKind: 'world', ev: c.causeEvent }]);
    expect(c.causeEvent).toBeGreaterThanOrEqual(0);
  });
});

// ───────────────────────── 8. 정보 격리 (지금 지켜지는 부분) ─────────────────────────
describe('8. 정보 격리 — 지휘·관제는 남의 부상 기록을 읽지 않는다', () => {
  const code = (path: string): string => readFileSync(path, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const files = ['src/sim/field/commander.ts', ...readdirSync('src/sim/dispatch').map((f) => 'src/sim/dispatch/' + f), ...readdirSync('src/sim/field/orders').map((f) => 'src/sim/field/orders/' + f)];
  it('commander·dispatch·orders 에 .injuries / .bleed 읽기가 없다', () => {
    for (const f of files) expect(/\.(injuries|bleed)\b/.test(code(f)), f).toBe(false);
  });
  it('같은 파일들이 injury 모듈에서 진실을 읽는 함수를 가져오지 않는다', () => {
    for (const f of files) {
      const imports = code(f).split('\n').filter((l) => /^import .*injury'/.test(l)).join('\n');
      for (const bad of ['needsHospital', 'hurtF', 'mainCause', 'noteInjury', 'noteCasHurt', 'noteRespHurt', 'noteHostileHurt', 'initInjuries']) expect(imports.includes(bad), `${f}: ${bad}`).toBe(false);
    }
  });
  it('injury.ts 는 잎 모듈이다: agents·hazards·executor·sceneManager·resources 를 가져오지 않는다', () => {
    const src = code('src/sim/field/injury.ts');
    for (const bad of ["'./agents'", "'./hazards'", "'./executor'", "'./sceneManager'", "'../resources'", "'./commander'", "'./brain'"]) expect(src.includes(bad), bad).toBe(false);
    expect(/export function bandOf\(/.test(src)).toBe(true);      // 선언이어야 순환 import 에서도 끌어올려진다
  });
});

// ═════════════════════════ 단계 2: 화면 ═════════════════════════
/** 무장 사건 현장에 부대를 내려 세운다 (화면 함수의 단위 시험용) */
function staffed(seed: string, kinds: UnitKind[] = ['patrol', 'tactical', 'als']): { sim: Sim; s: Scene; cmd: FieldAgent } {
  const { sim, s } = sceneOf(seed, 'armed', 'hostage');
  const I = sim.incidents[s.incidentId];
  for (const k of kinds) unitArrived(sim, I, sim.units.find((u) => u.kind === k)!);
  return { sim, s, cmd: s.agents.find((a) => a.isCommander)! };
}

// ───────────────────────── 10. 잔혹한 묘사 없음 ─────────────────────────
describe('10. 잔혹한 묘사 없음', () => {
  const walk = (dir: string): string[] => readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(`${dir}/${e.name}`) : [`${dir}/${e.name}`]));
  it('renderScene 에 blood: 가 없고, sprites 에 짙은 붉은 웅덩이 색이 없고, src/view 어디에도 붉은 피격 조각·고리의 색이 없다', () => {
    expect(readFileSync('src/view/renderScene.ts', 'utf8')).not.toContain('blood:');
    const sprites = readFileSync('src/view/scene/sprites.ts', 'utf8');
    for (const bad of ['rgba(110,18,22', 'rgba(140,24,28']) expect(sprites.includes(bad), bad).toBe(false);
    const files = walk('src/view');
    expect(files.length).toBeGreaterThan(20);
    for (const f of files) { const src = readFileSync(f, 'utf8'); for (const bad of ['rgba(230,50,50', 'rgba(255,90,90']) expect(src.includes(bad), `${f}: ${bad}`).toBe(false); }
  });
});

// ───────────────────────── 중증도 색 (§8.1) ─────────────────────────
describe('화면 — 중증도 색은 view/triage.ts 한 곳', () => {
  it('초록·노랑·빨강·검정. 검정 딱지는 밝은 테두리와 흰 글씨', () => {
    expect(TRIAGE).toEqual(['#5ad17a', '#ffd166', '#ff5d5d', '#14181d']);
    expect(TRIAGE_EDGE[3]).toBe('#cfd6dc'); expect(TRIAGE_TEXT[3]).toBe('#e8f0f7');
    expect(TRIAGE_NAME).toEqual(['경상', '중상', '위중', '사망']);
    for (const arr of [TRIAGE, TRIAGE_EDGE, TRIAGE_TEXT, TRIAGE_NAME]) expect(arr.length).toBe(4);
  });
  it('현장 그림·패널·범례·styles.css 가 같은 값을 쓴다 (예전의 회색 사망색이 남아 있지 않다)', () => {
    const rs = readFileSync('src/view/renderScene.ts', 'utf8');
    expect(rs).toContain('const BAND_COLOR = TRIAGE;');
    expect(rs).not.toContain('#7d8791');
    expect(rs).not.toContain('c.health > 70 ? 0 : c.health > 40 ? 1 : 2');      // 손으로 다시 쓴 중증도 식 대신 casBand(bandOf)
    const css = readFileSync('src/ui/styles.css', 'utf8');
    const at = css.indexOf('/* ── injuries ──');
    expect(at).toBeGreaterThan(0);
    const block = css.slice(at);
    for (let k = 0; k < 3; k++) expect(block).toContain(`.band-${k} { color: ${TRIAGE[k]}; }`);
    expect(/\.band-3 \{[^}]*background: #14181d[^}]*\}/.test(block)).toBe(true);
    expect(/\.band-3 \{[^}]*#cfd6dc[^}]*\}/.test(block)).toBe(true);
    for (const cls of ['.ticker.loss', '.ev.loss', '.cchip.dead', '.legend i.sq.dead', '.legend i.litter', '.legend i.sheet']) expect(block).toContain(cls);
    const app = readFileSync('src/ui/App.tsx', 'utf8');
    for (const word of ['사망', '들것', '덮개', 'TRIAGE[0]', 'TRIAGE[1]', 'TRIAGE[2]']) expect(app).toContain(word);
    expect(app).not.toContain("background: '#5ad17a'");
    expect(readFileSync('src/ui/panels.tsx', 'utf8')).toContain('const BAND = TRIAGE_NAME;');
  });
});

// ───────────────────────── 무엇을 어떻게 보일까 (§8.2·§8.4) ─────────────────────────
describe('화면 — 사람의 상태를 읽는 함수 (읽기만 한다)', () => {
  it('중증도: 숨진 사람만 검정이다 — 쓰러진(제압된) 용의자와 체력이 바닥인 대원은 위중', () => {
    const { sim, s } = staffed('INJ-band');
    const c = s.casualties[0], h = s.hostiles[0], r = sim.responders[s.agents[0].rid];
    c.health = 85; expect(casBand(c)).toBe(0); c.health = 55; expect(casBand(c)).toBe(1); c.health = 12; expect(casBand(c)).toBe(2);
    c.health = 0; expect(casBand(c)).toBe(2); c.dead = true; expect(casBand(c)).toBe(3);
    h.health = -9; h.state = 'down'; expect(hostileBand(h)).toBe(2); h.dead = true; expect(hostileBand(h)).toBe(3);
    r.health = 1; expect(respBand(r)).toBe(2); r.health = 66; expect(respBand(r)).toBe(1); r.dead = true; expect(respBand(r)).toBe(3);
    // 다친 자세: 대원은 중상(70 이하)부터, 용의자는 60 아래부터
    expect(hurtPose(100, 70)).toBe(0); expect(hurtPose(70.5, 70)).toBe(0); expect(hurtPose(70, 70)).toBeGreaterThan(0); expect(hurtPose(20, 70)).toBe(1);
    expect(hurtPose(61, 60)).toBe(0); expect(hurtPose(40, 60)).toBeGreaterThan(hurtPose(58, 60));
  });
  it('덮개는 확인된 사망부터: 구조 대상은 발견된 뒤, 대원·용의자는 관찰자 시점 3초 뒤 / AI 시점은 지휘관이 숨진 줄 알 때', () => {
    const { sim, s, cmd } = staffed('INJ-sheet');
    const c = s.casualties[0];
    c.dead = true; c.health = 0; c.tDead = sim.t; c.tDiscovered = -1;
    expect(casSheet(c)).toBe(false);
    c.tDiscovered = sim.t; expect(casSheet(c)).toBe(true);
    // 그리지 않는 사람: 차에 실렸거나, 물살에 현장 밖으로 떠내려갔다
    expect(casDrawn(c)).toBe(true); c.lost = true; expect(casDrawn(c)).toBe(false); c.lost = undefined; c.where = 'loaded'; expect(casDrawn(c)).toBe(false);
    const h = s.hostiles[0];
    h.health = -5; h.state = 'down';
    expect(hostileSheet(sim, h, true, cmd)).toBe(false);      // 쓰러졌을 뿐이다
    h.dead = true; h.tDead = sim.t;
    expect(hostileSheet(sim, h, true, cmd)).toBe(false);      // 관찰자 시점: 3초 뒤부터
    sim.t += 3.2;
    expect(hostileSheet(sim, h, true, cmd)).toBe(true);
    expect(hostileSheet(sim, h, false, cmd)).toBe(false);     // AI 시점: 지휘관이 아직 모른다
    cmd.beliefs.merge(mkFact('hos', h.id, { x: 0, y: 0, weapon: 'gun', state: 'down', hostage: false, facing: 0, dead: true }, '시험', sim.t, 1, true, ''));
    expect(hostileSheet(sim, h, false, cmd)).toBe(true);
    expect(hostileDrawn(h)).toBe(true); h.where = 'aboard'; expect(hostileDrawn(h)).toBe(false); h.where = undefined; h.state = 'escaped'; expect(hostileDrawn(h)).toBe(false);
    // 대원: 쓰러졌다가 안전 구역으로 옮겨진 뒤에도 누워 있다 (예전에는 다시 서 있게 그려졌다). 걸어서 물러난 대원은 눕지 않는다
    const a = s.agents.find((q) => q !== cmd)!, r = sim.responders[a.rid];
    expect(respLying(a, r)).toBe(false);
    a.status = 'down'; r.status = 'down'; r.health = 10; expect(respLying(a, r)).toBe(true);
    a.status = 'withdrawn'; expect(respLying(a, r)).toBe(true);
    r.status = 'injured'; r.health = 35; expect(respLying(a, r)).toBe(false);
    expect(respSheet(sim, r, true, cmd)).toBe(false);
    r.dead = true; r.status = 'down'; r.tDead = sim.t;
    expect(respLying(a, r)).toBe(true);
    expect(respSheet(sim, r, true, cmd)).toBe(false); sim.t += 3; expect(respSheet(sim, r, true, cmd)).toBe(true);
    expect(respSheet(sim, r, false, cmd)).toBe(false);
    cmd.beliefs.merge(mkFact('mate', r.id, { x: 0, y: 0, status: 'down', band: 3, bleeding: false, tq: 0, dead: true, wasDown: true, since: sim.t }, '시험', sim.t, 1, true, ''));
    expect(respSheet(sim, r, false, cmd)).toBe(true);
    expect(respSheet(sim, r, false, undefined)).toBe(false);      // 지휘관이 없으면 아는 사람도 없다
  });
  it('글: 원인별 피해는 큰 것부터, 상태는 순직 > 병원 인계 > 후송 중 > 쓰러짐 > 부상', () => {
    let list = noteInjury(undefined, 'smoke', 8.4, 1, 0);
    list = noteInjury(list, 'gunshot', 31.6, 2, 1, 0, 'hostile');
    list = noteInjury(list, 'burn', 0.2, 3, 1);
    expect(injuryLine(list)).toBe('총상 32 · 연기 흡입 8');      // 반올림해 0 인 화상은 빠진다
    expect(injuryLine(undefined)).toBe(''); expect(injuryLine([])).toBe('');
    expect(injuryLine(noteInjury(undefined, 'illness', 0, 1, 0, -1, 'initial'))).toBe('급성 질환');      // 깎인 것이 없어도 원인은 보인다
    expect([careName(undefined), careName(0), careName(0.3), careName(0.8)]).toEqual(['없음', '없음', '기본 처치', '전문 처치']);
    const { sim, s } = staffed('INJ-text');
    const a = s.agents[0], r = sim.responders[a.rid];
    expect(respStateText(r)).toBe('');
    r.status = 'injured'; expect(respStateText(r)).toBe('부상');
    r.status = 'down'; expect(respStateText(r)).toBe('쓰러짐');
    a.status = 'withdrawn'; expect(agentStateText(a, r)).toBe('쓰러짐 — 후송 대기');
    r.treatQ = 0.4; expect(agentStateText(a, r)).toBe('처치 받음 — 후송 대기');
    r.care = 'aboard'; expect(respStateText(r)).toBe('후송 중');
    r.care = 'hospital'; expect(respStateText(r)).toBe('병원 인계');
    r.dead = true; expect(respStateText(r)).toBe('순직'); expect(agentStateText(a, r)).toBe('순직');
  });
  it('순직·사망 기록은 loss 로 가린다 (빨간 경고가 아니다): 구조 대상의 사망 기록과, 뒤 단계가 더할 순직·용의자 사망', () => {
    const ev = (kind: string, importance: number, problem: string | null): SimEvent => ({ id: 0, t: 0, incidentId: 0, role: 'SYSTEM', actor: '현장', kind, text: '', causes: [], problem, importance, truth: false, rid: -1 } as unknown as SimEvent);
    expect(isLoss(ev('casualty', 3, null))).toBe(true);
    expect(isLoss(ev('casualty', 2, null))).toBe(false);      // 발견·안전 구역 도착 기록은 아니다
    expect(isLoss(ev('problem', 3, 'RESPONDER_KILLED'))).toBe(true);
    expect(isLoss(ev('problem', 3, 'SUSPECT_DIED'))).toBe(true);
    expect(isLoss(ev('problem', 3, 'RESPONDER_HURT'))).toBe(false);
    // 실제 교대의 사망 기록이 모두 잡힌다
    const deaths = all().flatMap((sim) => sim.events.filter((e) => /생체 반응 소실|생체 반응이 사라졌습니다|떠내려갔습니다/.test(e.text) && e.role === 'SYSTEM'));
    expect(deaths.length).toBeGreaterThan(10);
    for (const e of deaths) expect(isLoss(e), e.text).toBe(true);
  });
  it('정보창: 관찰자 시점은 진실(체력·원인별 부상·경과)을, AI 시점은 지휘관이 아는 것만 보인다', () => {
    const { sim, s, cmd } = staffed('INJ-card');
    const c = addCas(s, 6, 6, 'immobile', 30, 0.2, 0);
    c.injuries = noteInjury(noteInjury(undefined, 'gunshot', 62, 5, 2, 0, 'hostile'), 'smoke', 8, 6, 2); c.bleedCause = 'gunshot'; c.tDiscovered = 4;
    const t = casInfo(sim, s, c, true, cmd);
    expect(t.title).toBe(`구조 대상 ${c.label}`);
    expect([t.band, t.health, t.known]).toEqual([2, 30, true]);
    expect(t.rows.find((r) => r.k === '부상')!.v).toBe('총상 62 · 연기 흡입 8');
    expect(t.rows.find((r) => r.k === '악화')!.v).toContain('총상');
    expect(t.times.map((r) => r.k)).toEqual(['발견']);
    // AI 시점: 지휘관에게 보고되지 않았으면 아무것도 보이지 않는다
    const none = casInfo(sim, s, c, false, cmd);
    expect([none.known, none.band, none.health, none.rows.length, none.times.length]).toEqual([false, null, null, 0, 0]);
    // 지휘관이 낡은 보고(중상)를 갖고 있으면 그 내용만 — 진실(위중·총상·체력)은 새지 않는다
    cmd.beliefs.merge(mkFact('cas', c.id, { x: 6, y: 6, mob: 'immobile', band: 1, where: 'scene', treated: false, trappedDone: true, tq: 0 }, '김대원', sim.t, 1, true, ''));
    const ai = casInfo(sim, s, c, false, cmd);
    expect([ai.known, ai.band, ai.health, ai.times.length]).toEqual([true, 1, null, 0]);
    expect(ai.rows.find((r) => r.k === '중증도')!.v).toBe('중상');
    expect(JSON.stringify(ai)).not.toContain('총상'); expect(JSON.stringify(ai)).not.toContain('연기');
    expect(ai.note).toContain('김대원');
    expect(casInfo(sim, s, c, false, undefined).known).toBe(false);
    // 숨진 사람: 숨진 원인과 사망 시각
    c.dead = true; c.health = 0; c.deathCause = 'gunshot'; c.tDead = 9;
    const d = casInfo(sim, s, c, true, cmd);
    expect(d.band).toBe(3); expect(d.rows.find((r) => r.k === '숨진 원인')!.v).toBe('총상'); expect(d.times.map((r) => r.k)).toEqual(['발견', '사망']);
    // 용의자
    const h = s.hostiles[0];
    h.health = 40; h.injuries = noteInjury(undefined, 'gunshot', 60, 3, 2, 1, 'responder'); h.state = 'fight'; h.hidden = false;
    const ht = hostileInfo(sim, s, h, true, cmd);
    expect([ht.band, ht.health]).toEqual([2, 40]);
    expect(ht.rows.find((r) => r.k === '부상')!.v).toBe('위중 — 총상 60');
    expect(ht.rows.find((r) => r.k === '상태')!.v).toBe('교전');
    const hn = hostileInfo(sim, s, h, false, undefined);
    expect([hn.known, hn.band, hn.health, hn.rows.length]).toEqual([false, null, null, 0]);
    cmd.beliefs.merge(mkFact('hos', h.id, { x: 0, y: 0, weapon: 'gun', state: 'hold', hostage: true, facing: 0 }, '박대원', sim.t, 1, true, ''));
    const ha = hostileInfo(sim, s, h, false, cmd);
    expect(ha.rows.find((r) => r.k === '상태')!.v).toBe('대치');      // 지휘관이 아는 상태(대치)이지 진실(교전)이 아니다
    expect([ha.band, ha.health]).toEqual([null, null]);
    expect(JSON.stringify(ha)).not.toContain('총상');
    // 멀쩡한 용의자에게는 딱지가 없다
    const h2 = addHostile(s, 9, 9, 'knife', 0.5, 0.5, false, 1e9);
    expect(hostileInfo(sim, s, h2, true, cmd).band).toBeNull();
  });
});

describe('화면 — 현장 그림과 누르기, 자동 확대', () => {
  it('다친·쓰러진·숨진 사람, 덮개·들것·딱지를 그려도 예외가 없고 기록·상태가 그대로다. 누르면 구조 대상·용의자가 잡힌다(AI 시점은 보이는 사람만)', async () => {
    await withFakeDom(async () => {
      const { drawScene, hitScene, sceneLayout } = await import('../src/view/renderScene');
      const { sim, s } = staffed('INJ-draw', ['patrol', 'tactical', 'als', 'engine']);
      sim.run(3);
      const A = s.agents;
      expect(A.length).toBeGreaterThanOrEqual(7);
      const R = (k: number): Responder => sim.responders[A[k].rid];
      // 대원: 쓰러짐 · 끌려가는 중 · 안전 구역에 누움 · 걸어서 물러나 앉음 · 순직(덮개) · 다친 채 걷는 중 · 처치 받음
      A[1].status = 'down'; R(1).status = 'down'; R(1).health = 9; R(1).injuries = noteInjury(undefined, 'gunshot', 91, 1, 2, 0, 'hostile'); A[1].x = 8; A[1].y = 14; A[1].px = 7.9; A[1].py = 14;
      A[0].carrying = -(A[1].rid + 2); A[0].x = 8.5; A[0].y = 14;
      A[2].status = 'withdrawn'; R(2).status = 'down'; R(2).health = 12; R(2).treatQ = 0.7;
      A[3].status = 'withdrawn'; R(3).status = 'injured'; R(3).health = 34;
      A[4].status = 'down'; R(4).status = 'down'; R(4).health = 0; R(4).dead = true; R(4).tDead = sim.t - 10;
      R(5).health = 55; A[5].px = A[5].x - 0.1;
      R(6).health = 20; R(6).bleed = 0.05;
      // 용의자: 쓰러져 옮겨지는 중(처치 받음) · 숨짐(덮개) · 다친 채 교전 · 검거된 채 쓰러짐 · 차에 실림(그리지 않는다) · 숨어 있음
      const h0 = s.hostiles[0];
      h0.state = 'down'; h0.health = -3; h0.treatQ = 0.3; h0.x = 12; h0.y = 6; h0.px = 11.8; h0.py = 6; h0.hidden = false; h0.hostageId = -1;
      A[6].x = 12.5; A[6].y = 6;
      const hd = addHostile(s, 14, 6, 'gun', 0.5, 0.5, false, 1e9); hd.state = 'down'; hd.health = 0; hd.dead = true; hd.tDead = sim.t - 20;
      const hh = addHostile(s, 16, 6, 'knife', 0.5, 0.5, false, 1e9); hh.state = 'fight'; hh.health = 45;
      const ha = addHostile(s, 18, 6, 'none', 0.5, 0.5, false, 1e9); ha.state = 'arrested'; ha.health = 8; ha.tDown = sim.t - 4;
      const hg = addHostile(s, 20, 6, 'gun', 0.5, 0.5, false, 1e9); hg.state = 'down'; hg.health = 5; hg.where = 'aboard';
      const hid = addHostile(s, 22, 6, 'gun', 0.5, 0.5, true, 1e9);
      // 구조 대상: 확인된 사망(덮개) · 미발견 사망 · 떠내려감(그리지 않는다) · 처치 받고 누움 · 걷는 경상
      const cd = addCas(s, 10, 10, 'immobile', 0, 0, 0); cd.dead = true; cd.tDead = sim.t - 5; cd.tDiscovered = sim.t - 30; cd.deathCause = 'gunshot';
      const cu = addCas(s, 12, 10, 'immobile', 0, 0, 0); cu.dead = true; cu.tDead = sim.t - 5; cu.deathCause = 'smoke';
      const cl = addCas(s, 14, 10, 'trapped', 0, 0, 0); cl.dead = true; cl.lost = true; cl.tDiscovered = 1;
      const ct = addCas(s, 16, 10, 'immobile', 35, 0.1, 0); ct.treated = true; ct.treatQ = 0.8; ct.tDiscovered = 1;
      const cw = addCas(s, 18, 10, 'mobile', 90, 0, 0); cw.tDiscovered = 1; cw.walking = true; cw.px = 17.9;
      const state = (): string => JSON.stringify({
        ev: sim.events.length, hash: sim.logHash, tick: sim.tick,
        r: sim.responders.map((r) => [r.health, r.stamina, r.status, r.injuries ?? null, r.kit!.map((it) => [it.uses, it.fault, it.faultKnown])]),
        c: s.casualties.map((c) => [c.x, c.y, c.health, c.where, c.dead, c.injuries ?? null, c.bleedCause ?? null]),
        h: s.hostiles.map((h) => [h.x, h.y, h.health, h.state, h.injuries ?? null]), a: A.map((a) => [a.x, a.y, a.status, a.carrying, a.beliefs.facts.size]),
      });
      const before = state();
      const ctx = fakeCtx();
      const views: Record<string, unknown>[] = [
        { truth: true }, { truth: false }, { truth: true, mini: true }, { truth: false, mini: true },
        { truth: true, cam: { x: 12, y: 8, zoom: 2.2 }, pick: { kind: 'cas', id: cd.id } }, { truth: false, pick: { kind: 'hostile', id: h0.id } },
        { truth: true, pick: { kind: 'cas', id: cl.id } }, { truth: false, pick: { kind: 'hostile', id: hid.id } }, { truth: true, pick: { kind: 'hostile', id: 999 } },
      ];
      for (const o of views) drawScene(ctx, sim, s, 1200, 800, { alpha: 0.5, timeMs: 1234, selectedRid: A[1].rid, ...o } as never);
      expect(state()).toBe(before);
      // 누르기: 구조 대상·용의자가 잡힌다
      const L = sceneLayout(s, 1200, 800);
      const at = (x: number, y: number, truth = true): { rid: number; cas: number; hostile: number } => hitScene(sim, s, 1200, 800, L.ox + (x + 0.5) * L.ts, L.oy + (y + 0.5) * L.ts, undefined, truth);
      expect(at(10, 10).cas).toBe(cd.id);
      expect(at(14, 6).hostile).toBe(hd.id);
      expect(at(16, 6).hostile).toBe(hh.id);
      expect(at(14, 10).cas).not.toBe(cl.id);       // 떠내려간 사람은 화면에 없다
      expect(at(20, 6).hostile).not.toBe(hg.id);    // 차에 실려 간 용의자도 없다
      // AI 시점: 미발견 구조 대상과 숨은 용의자는 잡히지 않는다 (관찰자 시점에서는 잡힌다)
      expect(at(12, 10, true).cas).toBe(cu.id); expect(at(12, 10, false).cas).not.toBe(cu.id);
      expect(at(22, 6, true).hostile).toBe(hid.id); expect(at(22, 6, false).hostile).toBe(-1);
      expect(at(8, 14).rid).toBe(A[1].rid);         // 대원은 지금처럼
      expect(state()).toBe(before);
    });
  }, 60000);
  it('자동 확대: 쓰러진 대원도 화면에 든다 (임무가 없어 빠지던 것)', () => {
    const { sim, s } = staffed('INJ-cam', ['patrol', 'tactical']);
    const I = sim.incidents[s.incidentId];
    for (const h of s.hostiles) h.hidden = true;      // 다른 무게를 없앤다
    for (const c of s.casualties) c.tDiscovered = -1;
    s.fx.length = 0;
    const A = s.agents;
    for (const a of A) { a.task = null; a.x = 4; a.y = 4; }
    // 두 대원이 한쪽 구석에서 일하고, 한 대원이 반대쪽 구석에 있다
    for (const k of [0, 1]) { A[k].task = { kind: 'search' } as never; A[k].x = 3 + k; A[k].y = 3; }
    A[2].x = 26; A[2].y = 16;
    const d = new CameraDirector();
    d.focus = I.id;
    const frame = (): { x: number; y: number; zoom: number } => (d as unknown as { frameAction: (q: Sim) => { x: number; y: number; zoom: number } }).frameAction(sim);
    const idle = frame();
    A[2].status = 'down';
    const down = frame();
    expect(idle.zoom).toBeGreaterThan(1.15);                  // 일하는 두 대원 쪽으로 확대돼 있었다
    expect(down.zoom < idle.zoom || down.x > idle.x + 2).toBe(true);      // 쓰러진 대원 쪽으로 넓어지거나 옮겨 간다
    A[2].status = 'left';
    expect(frame()).toEqual(idle);                            // 떠난 대원은 세지 않는다
  });
});

// ═════════════════════════ 단계 4a: 대원 ═════════════════════════
/** 현장에 부대를 내려 세우고, 종류·역할로 대원을 고른다 */
function crewScene(seed: string, type: IncidentType, variant: string | undefined, kinds: UnitKind[]): { sim: Sim; s: Scene; I: Incident; of: (kind: UnitKind, role?: RoleId) => FieldAgent } {
  const { sim, s } = sceneOf(seed, type, variant);
  const I = sim.incidents[s.incidentId];
  for (const k of kinds) unitArrived(sim, I, sim.units.find((u) => u.kind === k)!);
  const of = (kind: UnitKind, role?: RoleId): FieldAgent => {
    const a = s.agents.find((q) => sim.units[q.unitId].kind === kind && (!role || sim.responders[q.rid].role === role));
    if (!a) throw new Error(`${kind}/${role ?? '*'} 대원 없음`);
    return a;
  };
  return { sim, s, I, of };
}
const tickOnce = (sim: Sim, s: Scene): void => { sim.tick++; sim.t = sim.tick * sim.dt; tickScene(sim, s); };
/** 그 대원을 다친 적 없는 상태로 되돌린다 (체력만 hp 로) */
function fresh(sim: Sim, a: FieldAgent, hp = 100): Responder {
  const r = sim.responders[a.rid];
  r.health = hp; r.status = 'ok'; r.bleed = undefined; r.bleed0 = undefined; r.treatQ = undefined; r.injuries = undefined; r.dead = undefined; r.tDown = undefined; r.tDead = undefined; r.deathCause = undefined; r.bleedCause = undefined;
  a.status = 'active'; a.hpTick = hp; a.hurtEv = undefined;
  return r;
}
const mark = (sim: Sim, I: Incident, text = '시험 기록'): number => emit(sim, { inc: I.id, role: 'SYSTEM', actor: '시험', kind: 'hazard', text });
const rel = (got: number, want: number, tag = ''): void => { expect(Math.abs(got - want) / Math.abs(want), `${tag} ${got} ≠ ${want}`).toBeLessThan(1e-9); };
const workItem = (s: Scene, kind: WorkItem['kind'], t: number, extra: Partial<WorkItem> = {}): WorkItem => {
  const w: WorkItem = { id: s.nextWorkId++, kind, region: -1, cas: -1, prop: -1, hostile: -1, tile: -1, mate: -1, priority: 0.9, status: 'open', assignees: [], max: 2, createdAt: t, doneAt: -1, note: '', fails: 0, holdUntil: 0, thorough: false, orderSentAt: {}, cause: -1, failedAt: {}, ...extra };
  s.board[w.id] = w;
  return w;
};

// ───────────────────────── 3. 방호 ─────────────────────────
describe('3. 방호 — 대원이 받는 피해는 입은 장비가 줄인다 (§2.4)', () => {
  it('총상: 특공대 < 순찰 < 구급. 값은 예전 식(방호 × 0.6)과 같고, 방패는 교전·봉쇄 중에만 더한다', () => {
    const { sim, s, I, of } = crewScene('INJ-prot', 'armed', 'hostage', ['swat', 'patrol', 'als', 'engine']);
    const hit = (a: FieldAgent, raw: number, cause: InjuryCause): number => { fresh(sim, a); return hurtResponder(sim, s, I, a, raw, cause); };
    const swat = of('swat', 'assaulter'), cop = of('patrol', 'officer'), medic = of('als', 'paramedic'), ff = of('engine', 'nozzle'), sh = of('swat', 'shield');
    for (const a of [swat, cop, medic, ff, sh]) a.task = null;
    const g = [swat, cop, medic].map((a) => hit(a, 30, 'gunshot'));
    expect(g[0]).toBeLessThan(g[1]); expect(g[1]).toBeLessThan(g[2]);
    rel(g[0], 30 * (1 - armorOf(sim, swat.rid, false) * 0.6), '특공'); rel(g[0], 30 * (1 - 0.6 * 0.6), '전술 방탄 조끼');
    rel(g[1], 30 * (1 - 0.25 * 0.6), '순찰');
    expect(g[2]).toBe(30);
    rel(hit(ff, 30, 'gunshot'), 30 * (1 - armorOf(sim, ff.rid, false) * 0.6), '소방 — 방화복의 방호 값도 같은 식으로');
    expect(armorOf(sim, ff.rid, false)).toBeCloseTo(0.1, 9);
    const bare = hit(sh, 30, 'gunshot');
    sh.task = makeTask('engage', '대응');
    const up = hit(sh, 30, 'gunshot');
    sh.task = null;
    rel(bare, 30 * (1 - 0.6 * 0.6), '방패를 세우지 않음'); rel(up, 30 * (1 - 0.8 * 0.6), '방패를 세움 (상한 0.8)');
    // protection 은 읽기만 한다: 같은 값을 그대로 돌려준다
    const u = sim.units[cop.unitId], r = sim.responders[cop.rid];
    rel(protection(sim, r, u, 'gunshot'), 0.25 * 0.6);
    expect(protection(sim, sim.responders[medic.rid], sim.units[medic.unitId], 'gunshot')).toBe(0);
  });
  it('화상·연기: 방화복과 공기가 남은 공기호흡기. 폭발·잔해: 폭발물 방호복과 방화복. 값은 예전 식과 같다 (상대 오차 1e-9)', () => {
    const { sim, s, I, of } = crewScene('INJ-prot2', 'armed', 'bomb', ['engine', 'patrol', 'eod']);
    const ff = of('engine', 'nozzle'), cop = of('patrol', 'officer'), tech = of('eod', 'bombTech');
    const P = (a: FieldAgent, cause: InjuryCause): number => protection(sim, sim.responders[a.rid], sim.units[a.unitId], cause);
    rel(P(ff, 'burn'), 1 - 2.6 / 9); expect(P(cop, 'burn')).toBe(0);
    rel(P(ff, 'smoke'), 1 - 0.1 / 1.3); rel(P(ff, 'toxic'), 1 - 0.1 / 1.3); expect(P(cop, 'smoke')).toBe(0); expect(P(cop, 'toxic')).toBe(0);
    rel(P(tech, 'blast'), 0.65); rel(P(ff, 'blast'), 0.3); expect(P(cop, 'blast')).toBe(0);
    rel(P(ff, 'crush'), 0.3); rel(P(tech, 'crush'), 0.65);
    // 매 틱 피해로 넘겨도 같은 값이다: 소방 0.1 × 연기, 2.6 × 불 / 그 밖 1.3 × 연기, 9 × 불
    const tick = (a: FieldAgent, raw: number, cause: InjuryCause): number => { fresh(sim, a); return hurtResponder(sim, s, I, a, raw, cause, { tick: true }); };
    rel(tick(ff, 1.3 * 0.8 * 0.2, 'smoke'), 0.1 * 0.8 * 0.2); rel(tick(ff, 9 * 0.6 * 0.2, 'burn'), 2.6 * 0.6 * 0.2);
    rel(tick(cop, 1.3 * 0.8 * 0.2, 'smoke'), 1.3 * 0.8 * 0.2); rel(tick(cop, 9 * 0.6 * 0.2, 'burn'), 9 * 0.6 * 0.2);
    expect(tick(ff, 1, 'smoke')).toBeLessThan(tick(cop, 1, 'smoke')); expect(tick(ff, 1, 'burn')).toBeLessThan(tick(cop, 1, 'burn'));
    // 공기통이 비면 연기 방호가 없다 (R1 의 규칙 그대로)
    const tank = sim.responders[ff.rid].kit!.find((it) => it.id === 'scba')!;
    const full = tank.uses;
    tank.uses = 0; expect(P(ff, 'smoke')).toBe(0); expect(P(ff, 'toxic')).toBe(0);
    tank.uses = full;
    // 방호가 없는 원인
    for (const cause of ['blunt', 'vehicle', 'drown', 'exposure', 'illness', 'exhaustion'] as InjuryCause[]) for (const a of [ff, cop, tech]) expect(P(a, cause), cause).toBe(0);
  });
  it('새 방호값(단계 4a-2): 자상은 조끼가(기동 < 순찰 < 구급), 유독 가스는 화학 보호복이(화학 ≤ 소방 < 경찰), 잔해는 조끼도, 추락·감전은 방화복이 줄인다', () => {
    const { sim, s, I, of } = crewScene('INJ-prot3', 'armed', 'hostage', ['tactical', 'patrol', 'als', 'engine', 'hazmat', 'eod', 'swat']);
    const P = (a: FieldAgent, cause: InjuryCause, engaging = false): number => protection(sim, sim.responders[a.rid], sim.units[a.unitId], cause, engaging);
    const hit = (a: FieldAgent, raw: number, cause: InjuryCause): number => { fresh(sim, a); return hurtResponder(sim, s, I, a, raw, cause); };
    const tac = of('tactical', 'tacOfficer'), cop = of('patrol', 'officer'), medic = of('als', 'emt'), ff = of('engine', 'nozzle');
    const haz = of('hazmat', 'hazTech'), hazLead = of('hazmat', 'hazLead'), tech = of('eod', 'bombTech'), sh = of('swat', 'shield');
    for (const a of [tac, cop, medic, ff, haz, hazLead, tech, sh]) a.task = null;
    // 자상: 조끼의 방호 × 0.5 (예전에는 흉기에 방호가 없었다)
    rel(P(tac, 'stab'), 0.6 * 0.5); rel(P(cop, 'stab'), 0.25 * 0.5); expect(P(medic, 'stab')).toBe(0);
    const st = [tac, cop, medic].map((a) => hit(a, 20, 'stab'));
    expect(st[0]).toBeLessThan(st[1]); expect(st[1]).toBeLessThan(st[2]);
    rel(st[0], 20 * (1 - 0.3)); rel(st[1], 20 * (1 - 0.125)); expect(st[2]).toBe(20);
    rel(P(sh, 'stab'), 0.6 * 0.5); rel(P(sh, 'stab', true), 0.8 * 0.5);      // 방패는 교전·봉쇄 중에만
    sh.task = makeTask('perimeter', '봉쇄'); rel(hit(sh, 20, 'stab'), 20 * (1 - 0.4)); sh.task = null;
    rel(P(tac, 'stab'), armorOf(sim, tac.rid, false) * 0.5);
    // 유독 가스: 화학 보호복 대원 0.95, 그 밖의 공기호흡기 0.923, 없으면 0. 연기에는 보호복이 더 듣지 않는다
    rel(P(haz, 'toxic'), 0.95); rel(P(hazLead, 'toxic'), 1 - 0.1 / 1.3); rel(P(ff, 'toxic'), 1 - 0.1 / 1.3); expect(P(cop, 'toxic')).toBe(0);
    expect(P(haz, 'toxic')).toBeGreaterThanOrEqual(P(ff, 'toxic')); expect(P(ff, 'toxic')).toBeGreaterThan(P(cop, 'toxic'));
    rel(P(haz, 'smoke'), 1 - 0.1 / 1.3);
    const tank = sim.responders[haz.rid].kit!.find((it) => it.id === 'scba')!, full = tank.uses;
    tank.uses = 0; expect(P(haz, 'toxic'), '공기가 떨어지면 보호복도 소용없다').toBe(0); tank.uses = full;
    // 폭발: 폭발물 처리반 < 소방 < 순찰 = 구급 (R1 의 blastFactor 그대로 — 조끼는 폭발을 줄이지 않는다)
    const bl = [tech, ff, cop, medic].map((a) => hit(a, 20, 'blast'));
    expect(bl[0]).toBeLessThan(bl[1]); expect(bl[1]).toBeLessThan(bl[2]); expect(bl[2]).toBe(bl[3]);
    // 잔해: 조끼 0.1 — 방화복(0.3)·방호복(0.65)은 예전 그대로
    rel(P(cop, 'crush'), 0.1); rel(P(tac, 'crush'), 0.1); rel(P(ff, 'crush'), 0.3); rel(P(tech, 'crush'), 0.65); expect(P(medic, 'crush')).toBe(0);
    // 추락·감전: 방화복
    rel(P(ff, 'fall'), 0.2); rel(P(ff, 'electric'), 0.4);
    for (const a of [cop, tac, medic]) { expect(P(a, 'fall')).toBe(0); expect(P(a, 'electric')).toBe(0); }
    // 장비 손잡이(armorMul)가 조끼의 값을 바꾸면 자상의 방호도 따라간다
    (sim.tune as { armorMul: number }).armorMul = 0.5;
    rel(P(cop, 'stab'), 0.25 * 0.5 * 0.5);
  });
});

// ───────────────────────── 4. 문턱 ─────────────────────────
describe('4. 문턱 — 멀쩡하던 대원은 한 틱 안에 숨지지 않는다 (§2.6)', () => {
  it('① 체력 100 에 200 의 총상: 숨지지 않고 체력 8, 출혈은 상한 0.04. 다음 틱에 쓰러지고 RESPONDER_HURT 가 원인과 함께 남는다', () => {
    const { sim, s, I, of } = crewScene('INJ-th1', 'medical', undefined, ['als']);
    const a = of('als', 'emt'), r = fresh(sim, a);
    const ev = mark(sim, I);
    const took = hurtResponder(sim, s, I, a, 200, 'gunshot', { by: 3, byKind: 'hostile', ev });
    expect([r.health, took, r.dead]).toEqual([MATE_FLOOR, 100 - MATE_FLOOR, undefined]);
    expect(r.bleed).toBe(DOWN_BLEED_CAP); expect(r.bleed0).toBe(DOWN_BLEED_CAP); expect(r.bleedCause).toBe('gunshot');
    expect(r.injuries).toEqual([{ cause: 'gunshot', dmg: 100 - MATE_FLOOR, sev: 2, t: sim.t, last: sim.t, by: 3, byKind: 'hostile', ev }]);
    expect(a.hurtEv).toBe(ev);
    expect(r.status).toBe('ok');      // 상태 전이는 hurtResponder 가 하지 않는다
    const n0 = sim.events.length;
    tickOnce(sim, s);
    expect([a.status, r.status, r.tDown]).toEqual(['down', 'down', sim.t]);
    const hurt = sim.events.slice(n0).filter((e) => e.problem === 'RESPONDER_HURT');
    expect(hurt.length).toBe(1);
    expect([hurt[0].rid, hurt[0].importance, hurt[0].causes]).toEqual([r.id, 3, [ev]]);
    expect(I.problems.filter((p) => p.code === 'RESPONDER_HURT').map((p) => p.detail)).toEqual([`${r.name} 대원 쓰러짐 (총상)`]);
    expect(sim.events.some((e) => e.problem === 'RESPONDER_KILLED')).toBe(false);
  });
  it('② 같은 틱에 두 번 맞아도: 체력 60 에 35 를 두 번 → 체력 8, 다음 틱에 쓰러짐(순직 아님), RESPONDER_HURT 하나', () => {
    const { sim, s, I, of } = crewScene('INJ-th2', 'medical', undefined, ['als']);
    const a = of('als', 'emt'), r = fresh(sim, a, 60);
    expect(hurtResponder(sim, s, I, a, 35, 'gunshot')).toBe(35);
    expect(r.health).toBe(25);
    expect(hurtResponder(sim, s, I, a, 35, 'gunshot')).toBe(25 - MATE_FLOOR);      // 이 틱이 시작될 때(60)는 멀쩡했다
    expect(r.health).toBe(MATE_FLOOR);
    expect(hurtResponder(sim, s, I, a, 35, 'gunshot'), '세 번째도 숨지게 하지 않고, 체력을 올리지도 않는다').toBe(0);
    expect(r.health).toBe(MATE_FLOOR);
    expect(r.bleed!).toBeLessThanOrEqual(DOWN_BLEED_CAP);
    // 문턱은 체력을 올리지 않는다: 같은 틱의 다른 피해(연기·불)로 이미 8 아래인 대원이 한 번 더 맞아도 그대로다
    r.health = 5;
    const rows = JSON.stringify(r.injuries);
    expect(hurtResponder(sim, s, I, a, 35, 'gunshot')).toBe(0);
    expect(r.health).toBe(5); expect(JSON.stringify(r.injuries)).toBe(rows);
    r.health = MATE_FLOOR;
    const n0 = sim.events.length;
    tickOnce(sim, s);
    expect([a.status, r.status, r.dead]).toEqual(['down', 'down', undefined]);
    expect(sim.events.slice(n0).filter((e) => e.problem === 'RESPONDER_HURT').length).toBe(1);
    expect(sim.events.some((e) => e.problem === 'RESPONDER_KILLED')).toBe(false);
  });
  it('③ 이미 크게 다친 대원(이 틱 시작 때 30)이 한 번 더 크게 다치면 순직한다: RESPONDER_KILLED 하나, 대원은 down 인 채 dead', () => {
    const { sim, s, I, of } = crewScene('INJ-th3', 'medical', undefined, ['als']);
    const a = of('als', 'emt'), r = fresh(sim, a, 30);
    r.status = 'injured';
    const ev = mark(sim, I);
    expect(hurtResponder(sim, s, I, a, 60, 'gunshot', { ev })).toBe(60);
    expect(r.health).toBe(-30); expect(r.deathCause).toBe('gunshot'); expect(r.dead).toBeUndefined();
    const n0 = sim.events.length;
    tickOnce(sim, s);
    expect([r.dead, r.status, r.health, r.tDead, a.status, a.label]).toEqual([true, 'down', 0, sim.t, 'down', '']);
    const killed = sim.events.slice(n0).filter((e) => e.problem === 'RESPONDER_KILLED');
    expect(killed.length).toBe(1);
    expect([killed[0].rid, killed[0].importance, killed[0].causes, killed[0].text, killed[0].role]).toEqual([r.id, 3, [ev], `${r.name} 대원 생체 반응 소실.`, 'SYSTEM']);
    expect(I.problems.filter((p) => p.code === 'RESPONDER_KILLED').map((p) => p.detail)).toEqual([`${r.name} 대원(${sim.units[a.unitId].callsign}) — 총상`]);
    // 숨진 대원은 더 바뀌지 않고 더 다치지 않는다
    const inj = JSON.stringify(r.injuries);
    expect(hurtResponder(sim, s, I, a, 50, 'blast')).toBe(0);
    for (let k = 0; k < 10; k++) tickOnce(sim, s);
    expect(JSON.stringify(r.injuries)).toBe(inj);
    expect(sim.events.filter((e) => e.problem === 'RESPONDER_KILLED').length).toBe(1);
    expect(r.health).toBe(0);
    // 숨지게 한 원인은 그 한 번 피해다 — 그 뒤(다음 틱)의 상처 악화가 아니다
    const b = of('als', 'paramedic'), q = fresh(sim, b, 30);
    q.status = 'injured'; q.bleed = 0.05; q.bleedCause = 'gunshot'; q.injuries = noteInjury(undefined, 'gunshot', 70, sim.t, 2, 0, 'hostile');
    hurtResponder(sim, s, I, b, 60, 'drown');
    tickOnce(sim, s);
    expect([q.dead, q.deathCause]).toEqual([true, 'drown']);
    expect(I.problems.some((p) => p.code === 'RESPONDER_KILLED' && p.detail === `${q.name} 대원(${sim.units[b.unitId].callsign}) — 익수`)).toBe(true);
  });
  it('문턱의 기준은 이 틱이 시작될 때의 체력이다 (tickScene 이 환경 단계 앞에서 적는다). 매 틱 피해에는 문턱이 없다', () => {
    const { sim, s, I, of } = crewScene('INJ-th4', 'medical', undefined, ['als']);
    const a = of('als', 'emt'), r = fresh(sim, a, 77);
    a.hpTick = undefined;
    tickOnce(sim, s);
    expect(a.hpTick).toBe(77);
    // 41 이상이면 걸리고(8 로 남는다), 그 아래면 걸리지 않는다
    fresh(sim, a, MATE_LETHAL_FROM); hurtResponder(sim, s, I, a, 90, 'vehicle'); expect(r.health).toBe(MATE_FLOOR);
    fresh(sim, a, MATE_LETHAL_FROM - 0.5); hurtResponder(sim, s, I, a, 90, 'vehicle'); expect(r.health).toBeLessThan(0);
    // 매 틱 피해(연기·불)는 그대로 0 아래로 간다
    fresh(sim, a, 100); expect(hurtResponder(sim, s, I, a, 130, 'burn', { tick: true })).toBe(130); expect(r.health).toBe(-30);
    expect(r.bleed, '매 틱 피해는 상처 출혈을 만들지 않는다').toBeUndefined();
  });
  it('새 상처의 출혈: 계수 × 방호 뒤 피해 × injuryMul 을 더한다(상한 0.12). 처치 전 값도 그 값으로, 받은 처치는 0 으로. 체력 15 이하로 남으면 0.04 이하', () => {
    const { sim, s, I, of } = crewScene('INJ-bleed', 'armed', 'hostage', ['patrol', 'als']);
    const cop = of('patrol', 'officer'), medic = of('als', 'emt');
    for (const a of [cop, medic]) a.task = null;
    let r = fresh(sim, medic);
    hurtResponder(sim, s, I, medic, 20, 'gunshot');
    rel(r.bleed!, BLEED_PER_DMG.gunshot * 20); expect(r.bleed0).toBe(r.bleed); expect(r.treatQ).toBe(0); expect(r.bleedCause).toBe('gunshot');
    r.treatQ = 0.8; r.bleed = r.bleed! * 0.3;      // 처치를 받았다
    hurtResponder(sim, s, I, medic, 10, 'stab');
    rel(r.bleed!, BLEED_PER_DMG.gunshot * 20 * 0.3 + BLEED_PER_DMG.stab * 10); expect(r.bleed0).toBe(r.bleed); expect(r.treatQ, '새 상처는 다시 처치할 수 있다').toBe(0); expect(r.bleedCause).toBe('stab');
    // 방호 뒤의 피해로 센다 (순찰 경관의 조끼)
    r = fresh(sim, cop);
    hurtResponder(sim, s, I, cop, 20, 'gunshot');
    rel(r.bleed!, BLEED_PER_DMG.gunshot * 20 * (1 - 0.25 * 0.6));
    // 상한
    r = fresh(sim, medic); hurtResponder(sim, s, I, medic, 35, 'gunshot'); hurtResponder(sim, s, I, medic, 35, 'vehicle');
    expect(r.health).toBe(30); expect(r.bleed).toBe(MATE_BLEED_MAX);
    // 쓰러질 만큼 다쳤으면 0.04 이하 (문턱이 걸렸든 아니든)
    r = fresh(sim, medic, 45); r.bleed = 0.1; r.bleed0 = 0.1;
    hurtResponder(sim, s, I, medic, 41, 'blunt');
    expect(r.health).toBe(4); expect(r.bleed).toBe(DOWN_BLEED_CAP); expect(r.bleed0).toBe(DOWN_BLEED_CAP);
    // 심각도 손잡이가 출혈을 정한다 (단계 7: 보통보다 위쪽은 보통과 같다 — 균형 손잡이 2)
    expect([1, 2, 3, 4, 5].map((sv) => new Sim('INJ-mul', { ...NORMAL, severity: sv }).tune.injuryMul)).toEqual([0.75, 0.9, 1, 1, 1]);
    (sim.tune as { injuryMul: number }).injuryMul = 1.25;
    r = fresh(sim, medic); hurtResponder(sim, s, I, medic, 20, 'gunshot');
    rel(r.bleed!, BLEED_PER_DMG.gunshot * 20 * 1.25);
    // 출혈을 만들지 않는 원인
    r = fresh(sim, medic); hurtResponder(sim, s, I, medic, 20, 'drown'); expect(r.bleed).toBeUndefined();
  });
});

// ───────────────────────── 대원의 상태 전이 (§3.2) ─────────────────────────
describe('대원의 상태 전이 — 부상 · 쓰러짐 · 순직은 agentHealth 한 곳에서 (§3.2)', () => {
  it('물러나야 하는 몸: 체력 40 아래, 또는 출혈이 크고 체력이 낮을 때(둘 다). 다친 대원은 느려진다(hurtF)', () => {
    const body = (health: number, bleed?: number): Responder => ({ health, bleed } as unknown as Responder);
    expect(mustRetreat(body(HURT_AT - 0.1))).toBe(true); expect(mustRetreat(body(HURT_AT))).toBe(false);
    expect(mustRetreat(body(MATE_RETREAT_HP - 0.1, MATE_RETREAT_BLEED))).toBe(true);
    expect(mustRetreat(body(MATE_RETREAT_HP, 0.12)), '출혈이 커도 체력이 남아 있으면 계속 일한다').toBe(false);
    expect(mustRetreat(body(MATE_RETREAT_HP - 0.1, MATE_RETREAT_BLEED - 0.001)), '체력이 낮아도 출혈이 작으면 계속 일한다').toBe(false);
    expect([100, 70, 55, 40, 10].map((h) => hurtF(body(h)))).toEqual([1, 1, 0.875, 0.75, 0.75]);
    const { sim, s, of } = crewScene('INJ-slow', 'medical', undefined, ['als']);
    const a = of('als', 'emt'), r = fresh(sim, a);
    r.stamina = 100;
    const v0 = moveSpeed(sim, s, a), f0 = staminaF(r);
    r.health = 85; expect(staminaF(r)).toBe(f0); expect(moveSpeed(sim, s, a)).toBe(v0);      // 70 이상은 그대로
    r.health = 40; rel(staminaF(r), f0 * 0.75); rel(moveSpeed(sim, s, a), v0 * 0.75);
  });
  it('부상: RESPONDER_HURT "○○ 대원 부상 (원인)" 한 번 — 원인 기록은 마지막으로 다친 기록. 본인이 자기 상태를 소리 없이 알린다 (mate 사실 hurt)', () => {
    const { sim, s, I, of } = crewScene('INJ-hurt', 'medical', undefined, ['als']);
    const a = of('als', 'emt'), r = fresh(sim, a);
    const ev = mark(sim, I);
    // 출혈로 물러나는 조건을 만든다 (체력은 40 위)
    r.health = MATE_RETREAT_HP - 1; r.bleed = MATE_RETREAT_BLEED + 0.01; r.bleed0 = r.bleed; r.bleedCause = 'gunshot'; a.hurtEv = ev;
    r.injuries = noteInjury(undefined, 'gunshot', 100 - r.health, sim.t, 1, 0, 'hostile', ev);
    a.outbox.length = 0;
    const n0 = sim.events.length;
    agentHealth(sim, s, I, a);
    expect(r.status).toBe('injured'); expect(a.status).toBe('active');
    const hurt = sim.events.slice(n0).filter((e) => e.problem === 'RESPONDER_HURT');
    expect(hurt.length).toBe(1);
    expect([hurt[0].rid, hurt[0].importance, hurt[0].causes, hurt[0].role, hurt[0].text]).toEqual([r.id, 2, [ev], 'RESPONDER', `${r.name} 부상. 임무 수행이 어렵습니다.`]);
    expect(I.problems.filter((p) => p.code === 'RESPONDER_HURT').map((p) => p.detail)).toEqual([`${r.name} 대원 부상 (총상)`]);
    const me = a.beliefs.val<MateBelief>('mate', a.rid)!;
    expect([me.status, me.band, me.bleeding, me.dead, me.wasDown, me.since]).toEqual(['hurt', 1, true, false, false, sim.t]);
    expect(a.outbox.some((f) => f.type === 'mate' && f.id === a.rid)).toBe(true);
    expect(a.quiet.has('mate:' + a.rid), '무전 문구에는 싣지 않는다 (위 기록이 이미 알렸다)').toBe(true);
    for (let k = 0; k < 5; k++) agentHealth(sim, s, I, a);
    expect(sim.events.slice(n0).filter((e) => e.problem === 'RESPONDER_HURT').length).toBe(1);
    // 체력 40 아래: 원인은 이 틱에 가장 크게 깎은 항 (연기 속이면 연기 흡입)
    const b = of('als', 'paramedic'), q = fresh(sim, b, 40.05);
    s.smoke[Math.round(b.y) * s.w + Math.round(b.x)] = 0.9;
    agentHealth(sim, s, I, b);
    expect(q.status).toBe('injured');
    expect(I.problems.some((p) => p.code === 'RESPONDER_HURT' && p.detail === `${q.name} 대원 부상 (연기 흡입)`)).toBe(true);
    expect(sim.events.filter((e) => e.problem === 'RESPONDER_HURT' && e.rid === q.id)[0].causes, '매 틱 피해에는 원인 기록이 없다').toEqual([]);
  });
  it('쓰러짐: 쓰러진 시각은 처음 한 번만 적는다. 안전 구역에서 기다리던 대원은 기록 없이 그 자리에 있다', () => {
    const { sim, s, I, of } = crewScene('INJ-down', 'medical', undefined, ['als']);
    const a = of('als', 'emt'), r = fresh(sim, a, DOWN_AT);
    a.task = makeTask('standby', '대기');
    agentHealth(sim, s, I, a);
    expect([a.status, r.status, a.label, a.task, r.tDown]).toEqual(['down', 'down', '쓰러짐', null, sim.t]);
    const t0 = sim.t;
    for (let k = 0; k < 20; k++) { sim.tick++; sim.t = sim.tick * sim.dt; agentHealth(sim, s, I, a); }
    expect(r.tDown).toBe(t0);
    expect(sim.events.filter((e) => e.problem === 'RESPONDER_HURT' && e.rid === r.id).length).toBe(1);
    // 안전 구역(withdrawn)에서 15 이하가 된 대원
    const b = of('als', 'paramedic'), q = fresh(sim, b, 30);
    q.status = 'injured'; b.status = 'withdrawn';
    q.health = 12;
    const n0 = sim.events.length;
    agentHealth(sim, s, I, b);
    expect([b.status, q.status, q.tDown]).toEqual(['withdrawn', 'down', sim.t]);
    expect(sim.events.length).toBe(n0);
    const t1 = sim.t;
    for (let k = 0; k < 20; k++) { sim.tick++; sim.t = sim.tick * sim.dt; agentHealth(sim, s, I, b); }
    expect(q.tDown).toBe(t1); expect(sim.events.length).toBe(n0);
  });
  it('순직의 기록은 그 자리의 상태로 만든다: 쓰러진 채 구조되지 못함 / 구조되던 중 / 안전 구역에서 후송을 기다리던 중', () => {
    const { sim, s, I, of } = crewScene('INJ-kia', 'fire', undefined, ['engine', 'als']);
    const died = (a: FieldAgent): string => I.problems.filter((p) => p.code === 'RESPONDER_KILLED').map((p) => p.detail).filter((d) => d.startsWith(sim.responders[a.rid].name)).join('|');
    // ① 불 속에 쓰러져 구조되지 못했다 (화상)
    const a = of('als', 'emt'), r = fresh(sim, a, 14);
    const i = Math.round(a.y) * s.w + Math.round(a.x);
    agentHealth(sim, s, I, a);
    expect(a.status).toBe('down');
    s.fire[i] = 1;
    while (!r.dead && sim.tick < 400) { sim.tick++; sim.t = sim.tick * sim.dt; agentHealth(sim, s, I, a); }
    s.fire[i] = 0;
    expect(r.dead).toBe(true); expect(r.deathCause).toBe('burn'); expect(r.tDead).toBe(sim.t);
    expect(died(a)).toBe(`${r.name} 대원(${sim.units[a.unitId].callsign}) — 화상, 쓰러진 뒤 ${fmtSec(sim.t - r.tDown!)} 동안 구조되지 못함`);
    // ② 끌려 나오던 중
    const b = of('als', 'paramedic'), q = fresh(sim, b, 10);
    agentHealth(sim, s, I, b);
    const rescuer = of('engine', 'firefighter');
    rescuer.carrying = -(b.rid + 2);
    q.health = -1; q.deathCause = undefined;
    agentHealth(sim, s, I, b);
    expect(died(b)).toMatch(/, 쓰러진 뒤 .+ 만에 구조되던 중$/);
    rescuer.carrying = -1;
    // ③ 안전 구역에서 (출혈 원인으로)
    const c = of('engine', 'nozzle'), p = fresh(sim, c, 9);
    p.status = 'injured'; c.status = 'withdrawn';
    agentHealth(sim, s, I, c);
    p.bleedCause = 'gunshot'; p.injuries = noteInjury(undefined, 'gunshot', 91, sim.t, 2, 0, 'hostile');
    p.health = -0.5;
    agentHealth(sim, s, I, c);
    expect([p.dead, c.status, c.label, p.deathCause]).toEqual([true, 'withdrawn', '', 'gunshot']);
    expect(died(c)).toBe(`${p.name} 대원(${sim.units[c.unitId].callsign}) — 총상, 안전 구역에서 후송을 기다리던 중`);
    // 기록은 대원마다 하나
    for (const x of [a, b, c]) expect(sim.events.filter((e) => e.problem === 'RESPONDER_KILLED' && e.rid === x.rid).length).toBe(1);
    // 보고서의 문장은 그 기록에서만 만든다
    closeIncident(sim, I, 'resolved');
    const line = I.result!.analysis.find((t) => t.startsWith('순직: '))!;
    expect(line).toBe(`순직: ${I.problems.filter((x) => x.code === 'RESPONDER_KILLED').map((x) => x.detail).join(' / ')}.`);
    expect(I.result!.analysis.indexOf(line), '순직은 분석의 앞머리에 온다 (잘리지 않게)').toBeLessThanOrEqual(1);
    expect(PROBLEM_LABEL.RESPONDER_KILLED).toBe('대원 순직');
  });
  it('상처 악화: 현장에 있는 동안 출혈이 체력을 깎는다(쓰러져 있어도, 안전 구역에서 기다려도). 처치를 받고 안전 구역에 있으면 0.6배 (§2.6 — 단계 4b 가 4a 의 임시 정지를 풀었다)', () => {
    const { sim, s, I, of } = crewScene('INJ-wound', 'medical', undefined, ['als']);
    const a = of('als', 'emt'), r = fresh(sim, a, 80);
    r.bleed = 0.05; r.bleedCause = 'stab';
    for (let k = 0; k < 50; k++) agentHealth(sim, s, I, a);      // 10초
    rel(80 - r.health, 0.05 * 10);
    expect(r.injuries!.find((j) => j.cause === 'stab')!.dmg).toBeCloseTo(0.5, 9);
    a.status = 'down'; r.status = 'down';
    const h1 = r.health;
    for (let k = 0; k < 50; k++) agentHealth(sim, s, I, a);
    rel(h1 - r.health, 0.05 * 10);
    a.status = 'withdrawn';
    const h2 = r.health;
    for (let k = 0; k < 50; k++) agentHealth(sim, s, I, a);
    rel(h2 - r.health, 0.05 * 10, '안전 구역 — 처치 전');
    r.treatQ = 0.5;
    const h3 = r.health;
    for (let k = 0; k < 50; k++) agentHealth(sim, s, I, a);
    rel(h3 - r.health, 0.05 * SAFE_BLEED * 10, '안전 구역 — 처치 뒤');
    expect(SAFE_BLEED).toBe(0.6);
    a.status = 'left';
    const h4 = r.health;
    for (let k = 0; k < 50; k++) agentHealth(sim, s, I, a);
    expect(r.health, '차에 타면(후송 중·병원) 멈춘다').toBe(h4);
    a.status = 'withdrawn';
    // woundTick: 출혈 원인을 모르면 지금까지의 가장 큰 원인으로 적는다
    const q = { health: 50, bleed: 0.1, injuries: noteInjury(undefined, 'vehicle', 50, 0, 1), dead: undefined, bleedCause: undefined } as unknown as Responder;
    expect(woundTick(sim, q, 1)).toBeCloseTo(0.1 * sim.dt, 12);
    expect(q.injuries!.length).toBe(1); expect(q.injuries![0].cause).toBe('vehicle');
    expect(woundTick(sim, q, 0)).toBe(0);
  });
  it('판정 뒤에는 악화도 전이도 없고 hurtResponder 도 아무것도 하지 않는다. 밀린 전이는 판정 직전에 마친다 (closeIncident)', () => {
    const { sim, s, I, of } = crewScene('INJ-closed', 'medical', undefined, ['als']);
    const a = of('als', 'emt'), r = fresh(sim, a);
    const b = of('als', 'paramedic'), q = fresh(sim, b, 30);
    // 이 틱의 환경 단계에서 다쳤고, 대원 단계가 돌기 전에 사건이 닫힌다
    hurtResponder(sim, s, I, a, 200, 'vehicle');      // 문턱 → 8: 쓰러질 체력
    q.status = 'injured'; hurtResponder(sim, s, I, b, 80, 'vehicle');      // 이미 다친 대원 → 0 아래
    const n0 = sim.events.length;
    closeIncident(sim, I, 'resolved');
    expect([a.status, r.status, r.tDown]).toEqual(['down', 'down', sim.t]);
    expect([q.dead, q.tDead]).toEqual([true, sim.t]);
    const recs = sim.events.slice(n0).filter((e) => e.problem === 'RESPONDER_HURT' || e.problem === 'RESPONDER_KILLED');
    expect(recs.map((e) => e.problem).sort()).toEqual(['RESPONDER_HURT', 'RESPONDER_KILLED']);
    for (const e of recs) expect(e.t).toBeLessThanOrEqual(I.closedAt);
    expect(I.result!.respondersHurt, '판정에 들어간다').toBe(1);
    // 닫힌 뒤
    const c = of('als', 'emsDriver'), p = fresh(sim, c, 20);
    p.bleed = 0.1;
    s.smoke[Math.round(c.y) * s.w + Math.round(c.x)] = 1; s.fire[Math.round(c.y) * s.w + Math.round(c.x)] = 1;
    const n1 = sim.events.length;
    expect(hurtResponder(sim, s, I, c, 50, 'blast')).toBe(0);
    for (let k = 0; k < 20; k++) tickOnce(sim, s);
    expect([p.health, p.status, p.injuries]).toEqual([20, 'ok', undefined]);
    expect(sim.events.slice(n1).some((e) => e.problem === 'RESPONDER_HURT' || e.problem === 'RESPONDER_KILLED')).toBe(false);
  });
});

// ───────────────────────── 다치는 자리 (§3.1) ─────────────────────────
describe('대원이 다치는 자리 — 모두 hurtResponder 를 거친다 (§3.1)', () => {
  it('폭발: 방호를 빼고 원인과 기록을 적는다. 숨진 대원은 건너뛴다', () => {
    const { sim, s, I, of } = crewScene('INJ-blastR', 'armed', 'bomb', ['engine', 'patrol', 'eod']);
    const ff = of('engine', 'nozzle'), cop = of('patrol', 'officer'), tech = of('eod', 'bombTech'), gone = of('patrol', 'patrolLead');
    const x = s.staging.x + 3, y = s.staging.y;
    for (const a of [ff, cop, tech, gone]) { fresh(sim, a); a.x = x; a.y = y; a.task = null; }
    const dead = sim.responders[gone.rid]; dead.dead = true; dead.health = 0; dead.status = 'down'; gone.status = 'down'; gone.lastBlockEvent = -1;
    const ev = mark(sim, I);
    blast(sim, s, I, x, y, 3, 20, ev);
    rel(100 - sim.responders[cop.rid].health, 20); rel(100 - sim.responders[ff.rid].health, 20 * 0.7); rel(100 - sim.responders[tech.rid].health, 20 * 0.35);
    for (const a of [ff, cop, tech]) { expect(sim.responders[a.rid].injuries![0]).toMatchObject({ cause: 'blast', ev, byKind: 'world' }); expect(a.hurtEv).toBe(ev); expect(a.lastBlockEvent).toBe(ev); }
    expect([dead.health, dead.injuries, gone.lastBlockEvent]).toEqual([0, undefined, -1]);
    blast(sim, s, I, x, y, 3, 20, ev, 'crush');
    expect(sim.responders[cop.rid].injuries!.map((j) => j.cause)).toEqual(['blast', 'crush']);
  });
  it('2차 사고: 차량 충격으로 적고 SECONDARY_COLLISION 이 원인 기록이다. 숨진 대원은 치지 않고, 판정 뒤에는 기록도 남기지 않는다', () => {
    const run = (dead: boolean, closed: boolean): { sim: Sim; r: Responder; a: FieldAgent; n: number } => {
      const { sim, s, I, of } = crewScene('INJ-lane', 'traffic', 'std', ['patrol']);
      const a = of('patrol', 'officer'), r = fresh(sim, a);
      for (const b of s.agents) if (b !== a) { b.x = 0; b.y = 0; }
      const row = s.laneRows[0];
      a.x = 10; a.y = row; a.status = dead ? 'down' : 'active';
      if (dead) { r.dead = true; r.health = 0; r.status = 'down'; }
      if (closed) { I.phase = 'closed'; I.closedAt = sim.t; }
      s.nextCarAt = 1e9; s.cars.length = 0;
      s.cars.push({ x: 9.2, px: 9.2, row, dir: 1, speed: 2, distracted: true, stopped: false, hit: false });
      const n0 = sim.events.length;
      tickLane(sim, s, I);
      return { sim, r, a, n: sim.events.slice(n0).filter((e) => e.problem === 'SECONDARY_COLLISION').length };
    };
    const live = run(false, false);
    expect(live.n).toBe(1);
    expect(live.r.health).toBeLessThanOrEqual(72); expect(live.r.health).toBeGreaterThanOrEqual(56);
    const ev = live.sim.events.filter((e) => e.problem === 'SECONDARY_COLLISION')[0];
    expect(live.r.injuries).toEqual([{ cause: 'vehicle', dmg: 100 - live.r.health, sev: 1, t: live.sim.t, last: live.sim.t, by: -1, byKind: 'world', ev: ev.id }]);
    expect(live.a.hurtEv).toBe(ev.id);
    rel(live.r.bleed!, BLEED_PER_DMG.vehicle * (100 - live.r.health));
    expect(run(true, false).n, '숨진 대원').toBe(0);
    const shut = run(false, true);
    expect([shut.n, shut.r.health, shut.r.injuries]).toEqual([0, 100, undefined]);
  });
  it('흉기·맨손 피습: "○○ 피습 (흉기)" 기록이 남고 그 기록이 부상의 원인 기록이 된다 (자상 · 가해자)', () => {
    const hit = (weapon: 'knife' | 'none', closed = false): { sim: Sim; r: Responder; a: FieldAgent; h: Hostile; texts: SimEvent[] } => {
      const { sim, s, I, of } = crewScene('INJ-stab', 'armed', 'domestic', ['patrol']);
      const a = of('patrol', 'officer'), r = fresh(sim, a);
      for (const b of s.agents) if (b !== a) { b.status = 'left'; }
      s.hostiles.length = 0;
      const h = addHostile(s, s.staging.x + 2, s.staging.y, weapon, 0.9, 0.5, false, 1e9);
      a.x = h.x + 1; a.y = h.y; a.px = a.x; a.py = a.y; a.task = null;
      h.state = 'fight'; h.cooldown = 0; h.facing = 0; h.alertUntil = 1e9; h.morale = 1;
      sim.tick = 100; sim.t = sim.tick * sim.dt;
      if (closed) { I.phase = 'closed'; I.closedAt = sim.t; }
      const n0 = sim.events.length;
      tickHostiles(sim, s, I);
      return { sim, r, a, h, texts: sim.events.slice(n0) };
    };
    const k = hit('knife');
    const rec = k.texts.find((e) => e.text === `${k.r.name} 피습 (흉기).`)!;
    expect(rec).toBeTruthy();
    expect([rec.kind, rec.importance, rec.rid, rec.role]).toEqual(['hazard', 2, k.r.id, 'RESPONDER']);
    expect(k.r.injuries!.length).toBe(1);
    expect(k.r.injuries![0]).toMatchObject({ cause: 'stab', by: k.h.id, byKind: 'hostile', ev: rec.id });
    expect(k.a.hurtEv).toBe(rec.id);
    expect(100 - k.r.health).toBeGreaterThanOrEqual(8 * 1.4 * 0.8); expect(100 - k.r.health).toBeLessThanOrEqual(16 * 1.4);
    const f = hit('none');
    expect(f.texts.some((e) => e.text === `${f.r.name} 피습 (맨손).`)).toBe(true);
    expect(f.r.injuries![0].cause).toBe('blunt');
    const shut = hit('knife', true);
    expect(shut.texts.some((e) => /피습/.test(e.text))).toBe(false); expect(shut.r.health).toBe(100);
  });
  it('대원의 체력을 직접 깎는 줄이 남아 있지 않다 — hurtResponder·woundTick 과 순직 처리만 예외다', () => {
    const files = ['src/sim/field/hazards.ts', 'src/sim/field/sceneManager.ts', 'src/sim/field/executor.ts', 'src/sim/field/rules/disaster.ts', 'src/sim/field/rules/crime.ts', 'src/sim/field/rules/air.ts', 'src/sim/field/rules/injury.ts', 'src/sim/field/brain.ts', 'src/sim/field/commander.ts', 'src/sim/pursuit.ts'];
    for (const f of files) {
      const lines = readFileSync(f, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//'));
      for (const l of lines) {
        if (!/\b(r|q|br|me|rsp)\.health\s*(-=|=[^=])/.test(l) && !/responders\[[^\]]*\]\.health\s*(-=|=[^=])/.test(l)) continue;
        expect(/r\.dead = true; r\.tDead = sim\.t; r\.health = 0;/.test(l), `${f}: ${l.trim()}`).toBe(true);      // 순직 처리 한 줄(sceneManager.fallen)만
      }
    }
    const inj = readFileSync('src/sim/field/injury.ts', 'utf8');
    expect((inj.match(/r\.health = after;/g) ?? []).length).toBe(1);
    expect((inj.match(/r\.health -= d;/g) ?? []).length).toBe(1);
  });
});

// ───────────────────────── 동료의 상태를 아는 길 (§3.2 · §6.1) ─────────────────────────
describe('동료의 상태 — 본 대원의 보고와 다친 본인의 보고로만 안다 (mate 사실)', () => {
  it('mateFact: 숨졌는지는 2칸 안에서만, 중증도는 3칸 안에서만 실제 값이다. 멀리서는 쓰러진 것만 보인다', () => {
    const { sim, s, of } = crewScene('INJ-mate', 'medical', undefined, ['als']);
    const b = of('als', 'emt'), r = fresh(sim, b, 55);
    const val = (status: MateBelief['status'], d: number): MateBelief => mateFact(sim, s, b, status, '시험', d).value as MateBelief;
    expect(val('hurt', 0)).toEqual({ x: Math.round(b.x), y: Math.round(b.y), status: 'hurt', band: 1, bleeding: false, tq: 0, dead: false, wasDown: false, since: sim.t });
    r.bleed = HOSPITAL_BLEED - 0.001; r.treatQ = 0.3; r.tDown = 3;
    expect(val('safe', 0).bleeding, '병원이 필요한 문턱(HOSPITAL_BLEED) 아래의 출혈은 bleeding 이 아니다 (단계 4b)').toBe(false);
    r.bleed = HOSPITAL_BLEED;
    expect(val('safe', 3)).toMatchObject({ band: 1, bleeding: true, tq: 1, wasDown: true });
    expect(val('safe', 3.1)).toMatchObject({ band: 1, bleeding: false });      // 3칸 밖: 쓰러지지 않았으면 중상으로 적는다
    expect(val('down', 3.1).band).toBe(2);                                    // 쓰러졌으면 위중으로 적는다
    r.treatQ = 0.7; expect(val('safe', 0).tq).toBe(2);
    r.health = 10; expect(val('down', 2.5).band).toBe(2);
    // 숨진 동료
    r.dead = true; r.health = 0;
    expect(val('down', 2.1)).toMatchObject({ dead: false, band: 2 });      // 2칸 밖에서는 숨진 줄 모른다 — 사망(3)으로 적지 않는다
    expect(val('down', 2)).toMatchObject({ dead: true, band: 3 });
    expect(mateFact(sim, s, b, 'down', '시험', 1).text).toBe(`${r.name} 대원 생체 반응 없음`);
    r.dead = undefined; r.health = 10;
    expect(mateFact(sim, s, b, 'down', '시험', 5).text).toBe(`${r.name} 대원 쓰러짐 — 구조 필요`);
    // 지금 상태 → 사실의 status
    const st = (x: FieldAgent['status']): string => { const keep = b.status; b.status = x; const v = mateStatus(sim, b); b.status = keep; return v; };
    expect([st('down'), st('withdrawn'), st('left'), st('active')]).toEqual(['down', 'safe', 'evac', 'hurt']);      // 체력 10: 걷고 있으면 물러나는 중이다
    r.health = 60; r.bleed = 0; expect(st('active'), '물러날 몸이 아닌 채 걷는 다친 대원은 가벼운 일을 하는 중이다').toBe('light');
    r.bleed = MATE_RETREAT_BLEED; expect(st('active'), '출혈이 커서 물러나는 중').toBe('hurt');
    r.health = 10;
  });
  it('perceive: 쓰러진 동료는 시야 안이면 보고, 숨진 것은 곁(2칸)에서만 안다. 숨진 줄 안 뒤에는 먼 관찰로 되돌리지 않는다', () => {
    const { sim, s, of } = crewScene('INJ-see', 'medical', undefined, ['als']);
    const a = of('als', 'paramedic'), b = of('als', 'emt'), r = fresh(sim, b, 10);
    for (const q of s.agents) if (q !== a && q !== b) q.status = 'left';
    const y = s.staging.y;
    b.x = s.staging.x + 6; b.y = y; b.status = 'down'; r.status = 'down'; r.tDown = sim.t;
    a.x = s.staging.x + 1; a.y = y; a.outbox.length = 0; a.quiet.clear();
    perceive(sim, s, a);
    let v = a.beliefs.val<MateBelief>('mate', b.rid)!;
    expect([v.status, v.dead, v.band]).toEqual(['down', false, 2]);
    expect(a.outbox.some((f) => f.type === 'mate' && f.id === b.rid)).toBe(true); expect(a.quiet.has('mate:' + b.rid), '쓰러진 것은 말로 알린다').toBe(false);
    // 그 동료가 숨졌다: 5칸 밖에서는 달라진 것이 없다
    r.dead = true; r.health = 0;
    a.outbox.length = 0;
    perceive(sim, s, a);
    expect(a.beliefs.val<MateBelief>('mate', b.rid)!.dead).toBe(false); expect(a.outbox.length).toBe(0);
    // 곁에 가면 안다
    a.x = b.x - 1.5;
    perceive(sim, s, a);
    v = a.beliefs.val<MateBelief>('mate', b.rid)!;
    expect([v.status, v.dead, v.band]).toEqual(['down', true, 3]);
    expect(a.outbox.some((f) => f.type === 'mate' && f.id === b.rid && (f.value as MateBelief).dead)).toBe(true);
    // 다시 멀어져도 되돌리지 않는다 — 숨진 것은 볼 수 없지만 중증도는 보이는 거리(2~3칸)에서도, 그보다 멀리서도
    for (const back of [2.5, 5]) {
      a.x = b.x - back; a.outbox.length = 0;
      perceive(sim, s, a);
      expect(a.beliefs.val<MateBelief>('mate', b.rid)!.dead, `${back}칸`).toBe(true); expect(a.outbox.length, `${back}칸`).toBe(0);
    }
  });
  it('perceive: 안전 구역으로 물러난 동료는 바로 곁(2칸)에서만 살핀다 — 소리 없이, 달라진 것이 있을 때만', () => {
    const { sim, s, of } = crewScene('INJ-see2', 'medical', undefined, ['als']);
    const a = of('als', 'paramedic'), b = of('als', 'emt'), r = fresh(sim, b, 30);
    for (const q of s.agents) if (q !== a && q !== b) q.status = 'left';
    b.x = s.staging.x + 5; b.y = s.staging.y; b.status = 'withdrawn'; r.status = 'injured';
    a.x = b.x - 3; a.y = b.y; a.outbox.length = 0; a.quiet.clear();
    perceive(sim, s, a);
    expect(a.beliefs.get('mate', b.rid)).toBeUndefined();
    a.x = b.x - 1.8;
    perceive(sim, s, a);
    const v = a.beliefs.val<MateBelief>('mate', b.rid)!;
    expect([v.status, v.band, v.dead]).toEqual(['safe', 2, false]);
    expect(a.quiet.has('mate:' + b.rid)).toBe(true);
    a.outbox.length = 0;
    perceive(sim, s, a);
    expect(a.outbox.length, '달라진 것이 없으면 다시 알리지 않는다').toBe(0);
    // 그 자리에서 숨졌다: 곁의 대원이 알아본다 (말로 알린다)
    r.dead = true; r.health = 0; a.quiet.clear();
    perceive(sim, s, a);
    expect(a.beliefs.val<MateBelief>('mate', b.rid)!.dead).toBe(true);
    expect(a.quiet.has('mate:' + b.rid)).toBe(false);
    expect(a.outbox.some((f) => f.type === 'mate' && f.text === `${r.name} 대원 생체 반응 없음`)).toBe(true);
  });
  it('쓰러진 동료 구조의 자격: 자기 자신은 아니고, 안전 확보 전의 무장 현장은 경찰만, 불·가스·붕괴 위험 구역 안은 공기호흡기를 멘 대원만', () => {
    // 무장 현장 (안전 확보 전)
    const hot = crewScene('INJ-fitA', 'armed', 'hostage', ['patrol', 'als', 'engine']);
    const cop = hot.of('patrol', 'officer'), lead = hot.of('patrol', 'patrolLead'), medic = hot.of('als', 'emt'), ffA = hot.of('engine', 'nozzle');
    const wA = workItem(hot.s, 'rescueMate', hot.sim.t, { mate: lead.rid });
    expect(hot.s.secureAt).toBeLessThan(0);
    expect(fitFor(hot.sim, hot.s, cop, wA)).toBeGreaterThan(0);
    expect(fitFor(hot.sim, hot.s, lead, wA), '자기 자신').toBe(0);
    expect(fitFor(hot.sim, hot.s, medic, wA)).toBe(0); expect(fitFor(hot.sim, hot.s, ffA, wA)).toBe(0);
    hot.s.secureAt = hot.sim.t;
    expect(fitFor(hot.sim, hot.s, medic, wA), '안전 확보 뒤에는 누구나').toBeGreaterThan(0);
    // 화재 현장: 믿음 속 위치가 건물 안이면 공기호흡기를 멘 대원만
    const fire = crewScene('INJ-fitB', 'fire', undefined, ['engine', 'patrol', 'als']);
    const ff = fire.of('engine', 'nozzle'), cop2 = fire.of('patrol', 'officer'), down = fire.of('engine', 'firefighter');
    const room = fire.s.regions.find((q) => q.indoor)!;
    const spot = room.tiles[0];
    const wB = workItem(fire.s, 'rescueMate', fire.sim.t, { mate: down.rid });
    const believe = (x: number, y: number): void => { for (const a of [ff, cop2]) a.beliefs.merge(mkFact('mate', down.rid, { x, y, status: 'down', band: 2, bleeding: false, tq: 0, dead: false, wasDown: true, since: fire.sim.t }, '시험', fire.sim.t + x * 0.001 + y, 1, true, '')); };
    believe(spot % fire.s.w, (spot / fire.s.w) | 0);
    expect(fitFor(fire.sim, fire.s, ff, wB)).toBeGreaterThan(0);
    expect(fitFor(fire.sim, fire.s, cop2, wB), '공기호흡기 없이 불난 건물 안으로 들어가지 않는다').toBe(0);
    const tank = fire.sim.responders[ff.rid].kit!.find((it) => it.id === 'scba')!;
    const full = tank.uses; tank.uses = 10;
    expect(fitFor(fire.sim, fire.s, ff, wB), '공기가 문턱 아래면 통을 바꾼 뒤에').toBe(0);
    tank.uses = full;
    fire.sim.t += 100;
    believe(Math.round(fire.s.staging.x), Math.round(fire.s.staging.y));      // 바깥(대기 지점)에 쓰러져 있다고 안다
    expect(fitFor(fire.sim, fire.s, cop2, wB)).toBeGreaterThan(0);
  });
});

// ───────────────────────── 지휘관 (§3.4-1 · §3.5) ─────────────────────────
describe('지휘관 — 쓰러진 동료의 구조와 수습, 현장이 비었을 때', () => {
  const mateBelief = (sim: Sim, cmd: FieldAgent, b: FieldAgent, over: Partial<MateBelief>, dt = 0): void => {
    cmd.beliefs.merge(mkFact('mate', b.rid, { x: Math.round(b.x), y: Math.round(b.y), status: 'down', band: 2, bleeding: false, tq: 0, dead: false, wasDown: true, since: sim.t, ...over }, '시험', sim.t + dt, 1, true, ''));
  };
  const open = (s: Scene, rid: number): WorkItem | undefined => s.board.find((w) => w.kind === 'rescueMate' && w.mate === rid && (w.status === 'open' || w.status === 'active'));
  it('쓰러진 줄 알면 0.97(둘), 숨진 줄 알면 수습 0.55. 더는 쓰러져 있지 않다고 알거나 자기 부대와 함께 떠났으면 거둔다', () => {
    const { sim, s, of } = crewScene('INJ-cmd', 'traffic', 'std', ['engine', 'als']);
    const cmd = s.agents.find((a) => a.isCommander)!, b = of('als', 'emt');
    s.sizeupDone = true;
    b.status = 'down'; sim.responders[b.rid].status = 'down';
    mateBelief(sim, cmd, b, {});
    commanderThink(sim, s, cmd);
    expect([open(s, b.rid)!.priority, open(s, b.rid)!.max]).toEqual([0.97, 2]);
    sim.t += 3; mateBelief(sim, cmd, b, { dead: true, band: 3 });
    commanderThink(sim, s, cmd);
    expect(open(s, b.rid)!.priority).toBe(0.55);
    sim.t += 3; mateBelief(sim, cmd, b, { status: 'safe' });
    commanderThink(sim, s, cmd);
    expect(open(s, b.rid)).toBeUndefined();
    // 다시 쓰러져 있다고 알지만, 그 대원은 자기 부대와 함께 현장을 떠났다
    sim.t += 3; mateBelief(sim, cmd, b, {});
    b.status = 'left';
    commanderThink(sim, s, cmd);
    expect(open(s, b.rid)).toBeUndefined();
    expect(outstanding(cmd, sim.t, s).mates).toBe(0); expect(outstanding(cmd, sim.t).mates, '현장을 주지 않으면 믿음만으로 센다').toBe(1);
    b.status = 'down';
    expect(outstanding(cmd, sim.t, s).mates).toBe(1);
    sim.t += 3; mateBelief(sim, cmd, b, { dead: true, band: 3 });
    expect(outstanding(cmd, sim.t, s).mates, '숨진 동료만 남았으면 남은 일이 아니다').toBe(0);
  });
  it('쓰러진 동료가 남았으면 종료를 선언하지 않는다. 숨진 동료의 수습은 맡을 수 있는 대원이 있을 때만 종료를 막는다', () => {
    const stage = (): { sim: Sim; s: Scene; I: Incident; cmd: FieldAgent; b: FieldAgent } => {
      const { sim, s, I, of } = crewScene('INJ-close', 'medical', undefined, ['als']);
      const cmd = s.agents.find((a) => a.isCommander)!, b = of('als', 'emt');
      s.sizeupDone = true; s.mismatchLogged = true;
      for (const c of s.casualties) cmd.beliefs.merge(mkFact('cas', c.id, { x: 3, y: 3, mob: 'mobile', band: 0, where: 'safe', treated: false, trappedDone: true, tq: 0 }, '시험', sim.t, 1, true, ''));
      for (const q of s.agents) { q.task = null; q.nextThink = 1e9; }
      b.status = 'down'; sim.responders[b.rid].status = 'down';
      return { sim, s, I, cmd, b };
    };
    const closes = (x: { sim: Sim; s: Scene; I: Incident; cmd: FieldAgent }): boolean => { for (let k = 0; k < 3 && x.I.phase !== 'closed'; k++) { commanderThink(x.sim, x.s, x.cmd); x.sim.t += 4; } return x.I.phase === 'closed'; };
    // 지휘관이 아무것도 모르면 끝낸다 (기준)
    const none = stage();
    none.b.status = 'active';
    expect(closes(none)).toBe(true);
    // 쓰러진 동료를 알고 있으면 끝내지 않는다
    const live = stage();
    mateBelief(live.sim, live.cmd, live.b, {});
    for (const q of live.s.agents) if (q !== live.b) q.status = q === live.cmd ? 'active' : 'left';
    live.s.board.length = 0;
    // 구조를 맡을 대원이 지휘관뿐이다 — 맡겨지지 않게 실패 기억을 넣어 둔다
    expect(closes(live)).toBe(false);
    // 숨진 줄 알고, 수습을 맡을 수 있는 대원이 있으면(지휘관 자신) 끝내지 않는다
    const dead = stage();
    mateBelief(dead.sim, dead.cmd, dead.b, { dead: true, band: 3 });
    expect(closes(dead)).toBe(false);
    // 아직 아무도 맡지 않았어도(잠깐 보류 중) 맡을 수 있는 대원이 있으면 막는다
    const held = stage();
    mateBelief(held.sim, held.cmd, held.b, { dead: true, band: 3 });
    commanderThink(held.sim, held.s, held.cmd);
    const hw = open(held.s, held.b.rid)!;
    hw.assignees.length = 0; hw.status = 'open'; hw.holdUntil = held.sim.t + 1000;
    for (const q of held.s.agents) { q.orderWork = -1; q.task = null; }
    held.sim.t += 4;
    expect(closes(held)).toBe(false);
    expect(hw.assignees.length).toBe(0);
    // 맡을 수 있는 대원이 없으면(방금 닿지 못했다) 수습은 종료를 막지 않는다
    const stuck = stage();
    mateBelief(stuck.sim, stuck.cmd, stuck.b, { dead: true, band: 3 });
    commanderThink(stuck.sim, stuck.s, stuck.cmd);
    const w = open(stuck.s, stuck.b.rid)!;
    for (const q of stuck.s.agents) { w.failedAt[q.rid] = stuck.sim.t + 100; }
    w.assignees.length = 0; w.status = 'open';
    for (const q of stuck.s.agents) { q.orderWork = -1; q.task = null; }
    stuck.sim.t += 4;
    expect(closes(stuck)).toBe(true);
  });
  it('구하러 갈 사람이 없으면 그 일을 할 부대를 부른다 — 쓰러진 동료일 때만. 숨진 동료의 수습 때문에 다른 곳의 부대를 부르지는 않는다', () => {
    const run = (dead: boolean): string[] => {
      const { sim, s, of } = crewScene('INJ-need', 'medical', undefined, ['als']);
      const cmd = s.agents.find((a) => a.isCommander)!, b = of('als', 'emt');
      s.sizeupDone = true; s.mismatchLogged = true;
      for (const q of s.agents) { q.task = null; q.nextThink = 1e9; }
      b.status = 'down'; sim.responders[b.rid].status = 'down';
      mateBelief(sim, cmd, b, dead ? { dead: true, band: 3 } : {});
      commanderThink(sim, s, cmd);
      const w = open(s, b.rid)!;
      // 현장의 누구도 닿지 못했다 (방금 실패) — 25초 넘게 열려 있다
      w.createdAt = sim.t - 30; w.assignees.length = 0; w.status = 'open';
      for (const q of s.agents) { w.failedAt[q.rid] = sim.t + 100; q.orderWork = -1; q.task = null; }
      sim.t += 4;
      commanderThink(sim, s, cmd);
      return s.requests.map((q) => `${q.need}: ${q.reason}`);
    };
    expect(run(false)).toContain('rescue: 동료 구조를 맡을 대원이 없음');
    expect(run(true).some((t) => /동료 구조/.test(t))).toBe(false);
  });
  it('현장이 비면(7번 블록): 쓰러진 동료가 남았으면 끝내지 않고 구하러 갈 부대를 찾는다 — 불·가스·붕괴 현장은 구조 부대, 그 밖은 구급 부대', () => {
    const run = (type: IncidentType, known: boolean): { I: Incident; texts: string[] } => {
      const { sim, s, I, of } = crewScene('INJ-empty2', type, undefined, [type === 'fire' ? 'engine' : 'als']);
      sim.tick = 1000; sim.t = sim.tick * sim.dt;
      const cmd = s.agents.find((a) => a.isCommander)!;
      const b = s.agents.find((a) => a !== cmd)!;
      void of;
      s.sizeupDone = true;
      for (const c of s.casualties) cmd.beliefs.merge(mkFact('cas', c.id, { x: 3, y: 3, mob: 'mobile', band: 0, where: 'safe', treated: false, trappedDone: true, tq: 0 }, '시험', sim.t, 1, true, ''));
      for (const q of s.agents) { q.status = 'left'; q.task = null; }
      b.status = 'down'; sim.responders[b.rid].status = 'down'; sim.responders[b.rid].health = 12; sim.responders[b.rid].tDown = sim.t;
      if (known) mateBelief(sim, cmd, b, {});
      const n0 = sim.events.length;
      sim.tick++; sim.t = sim.tick * sim.dt;
      tickScene(sim, s);
      return { I, texts: sim.events.slice(n0).map((e) => e.text) };
    };
    const med = run('medical', true);
    expect(med.I.phase).not.toBe('closed');
    expect(med.texts.some((t) => /현장에 남은 부대가 없는데 아직 끝나지 않았습니다/.test(t))).toBe(true);
    expect(med.I.unmet.ems).toBeGreaterThanOrEqual(1);
    const fire = run('fire', true);
    expect(fire.I.phase).not.toBe('closed');
    expect(fire.I.unmet.rescue ?? 0).toBeGreaterThanOrEqual(1);
    // 마지막 지휘관이 그 사실을 모르면 예전처럼 끝난다 (믿음으로만 판단한다)
    const blind = run('medical', false);
    expect(blind.I.phase).toBe('closed');
  });
  it('지휘권 승계: 승계자가 옛 지휘관의 상태를 알면 그 까닭을 말한다 (순직 · 쓰러짐 · 부상). 모르면 예전 문구', () => {
    const run = (over: Partial<MateBelief> | null): string => {
      const { sim, s, I } = crewScene('INJ-succ', 'traffic', 'std', ['patrol']);
      void I;
      const cmd = s.agents.find((a) => a.isCommander)!, next = s.agents.find((a) => a !== cmd)!;
      for (const q of s.agents) { q.nextThink = 1e9; q.task = null; }
      cmd.status = 'down'; sim.responders[cmd.rid].status = 'down'; sim.responders[cmd.rid].health = 12; sim.responders[cmd.rid].tDown = sim.t;
      if (over) next.beliefs.merge(mkFact('mate', cmd.rid, { x: 0, y: 0, status: 'down', band: 2, bleeding: false, tq: 0, dead: false, wasDown: true, since: sim.t, ...over }, '시험', sim.t, 1, true, ''));
      const n0 = sim.events.length;
      tickOnce(sim, s);
      expect(s.commanderRid).toBe(next.rid);
      return sim.events.slice(n0).find((e) => e.role === 'COMMANDER' && /지휘권을 승계합니다/.test(e.text))!.text.replace(sim.responders[cmd.rid].name, '○○');
    };
    expect(run(null)).toBe('○○ 지휘 불능. 지휘권을 승계합니다.');
    expect(run({})).toBe('○○ 대원 쓰러짐으로 지휘 불능. 지휘권을 승계합니다.');
    expect(run({ dead: true, band: 3 })).toBe('○○ 대원 순직으로 지휘 불능. 지휘권을 승계합니다.');
    expect(run({ status: 'hurt' })).toBe('○○ 대원 부상으로 지휘 불능. 지휘권을 승계합니다.');
  });
});

// ───────────────────────── 실행기: 후퇴와 동료 구조 (§3.2 · §3.4-1) ─────────────────────────
describe('실행기 — 다친 대원의 후퇴와 쓰러진 동료의 구조', () => {
  /** 대원 하나에게 임무를 주고 끝날 때까지(또는 n 틱) 돌린다 — 몸(agentHealth)도 함께 */
  const drive = (sim: Sim, s: Scene, I: Incident, a: FieldAgent, n: number, until: () => boolean): void => {
    for (let k = 0; k < n && !until(); k++) { sim.tick++; sim.t = sim.tick * sim.dt; agentHealth(sim, s, I, a); act(sim, s, a); }
  };
  it('후퇴: 물러나야 하는 몸이면 대기 지점에서 후송을 기다리고(withdrawn), 안전 구역에 닿았음을 스스로 알린다 — 출혈로 물러난 대원도', () => {
    const { sim, s, I, of } = crewScene('INJ-ret', 'traffic', 'std', ['als']);
    const a = of('als', 'emt'), r = fresh(sim, a, MATE_RETREAT_HP - 5);
    r.bleed = MATE_RETREAT_BLEED + 0.01; r.bleedCause = 'gunshot'; r.injuries = noteInjury(undefined, 'gunshot', 100 - r.health, sim.t, 1, 0, 'hostile');
    expect(r.health).toBeGreaterThan(HURT_AT);
    a.x = s.staging.x + 6; a.y = s.staging.y; a.px = a.x; a.py = a.y;
    a.task = makeTask('retreat', '후퇴'); a.outbox.length = 0; s.radio.length = 0;
    drive(sim, s, I, a, 200, () => a.status === 'withdrawn');
    expect([a.status, a.label, a.task]).toEqual(['withdrawn', '부상 — 후송 대기', null]);
    expect(Math.hypot(a.x - s.staging.x, a.y - s.staging.y)).toBeLessThanOrEqual(2.6);
    const me = a.beliefs.val<MateBelief>('mate', a.rid)!;
    expect([me.status, me.bleeding]).toEqual(['safe', true]);
    // 물러난 대원은 더 판단하지 않으므로 그 자리에서 무전으로 보낸다 (소리 없이)
    expect(a.outbox.length).toBe(0);
    expect(s.radio.some((m) => m.from === a.rid && m.facts.some((f) => f.type === 'mate' && f.id === a.rid && (f.value as MateBelief).status === 'safe'))).toBe(true);
    // 다치지 않은 대원(위험해서 물러남)은 대기 지점에 닿아도 그대로 일한다
    const b = of('als', 'paramedic'); fresh(sim, b);
    b.x = s.staging.x + 6; b.y = s.staging.y; b.task = makeTask('retreat', '후퇴');
    drive(sim, s, I, b, 200, () => b.task === null);
    expect([b.status, b.task]).toEqual(['active', null]);
  });
  it('판단: 출혈이 커서 물러나야 하는 몸이면(체력은 40 위) 하던 일을 놓고 후퇴를 고른다. 부상 후퇴는 한 번만 알린다', () => {
    const { sim, s, I, of } = crewScene('INJ-think', 'traffic', 'std', ['als']);
    const a = of('als', 'emt'), r = fresh(sim, a, MATE_RETREAT_HP - 5);
    expect(r.health).toBeGreaterThan(HURT_AT);
    a.task = makeTask('standby', '대기');
    const n0 = sim.events.length;
    const said = (): number => sim.events.slice(n0).filter((e) => e.rid === r.id && e.text === '부상으로 더 이상 임무 수행 불가. 후퇴합니다.').length;
    think(sim, s, a);
    expect(a.task?.kind, '출혈이 없으면 물러나지 않는다').not.toBe('retreat');
    r.bleed = MATE_RETREAT_BLEED + 0.01; r.bleedCause = 'gunshot';
    const ev = mark(sim, I); a.hurtEv = ev;
    think(sim, s, a);
    expect(a.task?.kind).toBe('retreat');
    expect(said()).toBe(1);
    expect(sim.events.slice(n0).find((e) => e.text === '부상으로 더 이상 임무 수행 불가. 후퇴합니다.')!.causes, '원인 기록은 마지막으로 다친 기록').toEqual([ev]);
    // 후퇴 임무가 도중에 끝나(길 위의 불을 끄다 물이 떨어졌다) 다시 고르더라도 같은 말을 되풀이하지 않는다
    a.task = null;
    think(sim, s, a);
    expect(s.agents.find((q) => q.rid === a.rid)!.task?.kind).toBe('retreat');
    expect(said()).toBe(1);
  });
  it('물러나는 길은 불길도 뚫는다: 불에 막혀 길이 없으면 제자리에서 타지 않고 불을 지나 나온다 (지나는 동안의 화상은 입는다)', () => {
    const { sim, s, I, of } = crewScene('INJ-esc', 'traffic', 'std', ['als']);
    const a = of('als', 'emt'), r = fresh(sim, a, 38);
    r.status = 'injured';
    a.x = s.staging.x + 6; a.y = s.staging.y; a.px = a.x; a.py = a.y;
    // 대원과 대기 지점 사이를 불의 띠가 가른다 (현장의 위에서 아래까지 — 돌아갈 길이 없다)
    const bx = Math.round(s.staging.x) + 3;
    for (let y = 0; y < s.h; y++) s.fire[y * s.w + bx] = 0.9;
    a.task = makeTask('retreat', '후퇴');
    const hp0 = r.health;
    drive(sim, s, I, a, 300, () => a.status !== 'active');
    expect(a.status).toBe('withdrawn');
    expect(r.health).toBeLessThan(hp0);
    expect(r.injuries!.some((j) => j.cause === 'burn')).toBe(true);
    expect(sim.events.some((e) => /퇴로가 막혀/.test(e.text))).toBe(false);
    // 다른 임무는 예전처럼 불 앞에서 멈춘다 (끌 수 없는 불은 지나가지 않는다)
    const b = of('als', 'paramedic'); fresh(sim, b);
    b.x = s.staging.x + 6; b.y = s.staging.y; b.px = b.x; b.py = b.y;
    b.task = makeTask('rehab', '휴식');
    drive(sim, s, I, b, 100, () => false);
    expect(b.x).toBeGreaterThan(bx);
  });
  it('사방이 막혀 길이 없으면: 다친 대원은 제자리에서 "후송 대기"가 되지 않고 길이 열리기를 기다린다 (한 번만 알린다)', () => {
    const { sim, s, I, of } = crewScene('INJ-wall', 'traffic', 'std', ['als']);
    const a = of('als', 'emt'), r = fresh(sim, a, 35);
    r.status = 'injured';
    const ax = Math.round(s.staging.x) + 6, ay = Math.round(s.staging.y);
    a.x = ax; a.y = ay; a.px = ax; a.py = ay;
    const saved: [number, number][] = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if (dx || dy) { const i = (ay + dy) * s.w + ax + dx; saved.push([i, s.tiles[i]]); s.tiles[i] = T.WALL; }
    a.task = makeTask('retreat', '후퇴');
    const n0 = sim.events.length;
    drive(sim, s, I, a, 150, () => false);
    expect([a.status, a.task?.kind]).toEqual(['active', 'retreat']);
    expect(sim.events.slice(n0).filter((e) => e.text === '퇴로가 막혀 나갈 수 없습니다. 길이 열리기를 기다립니다.').length).toBe(1);
    // 길이 열리면 나간다
    for (const [i, t] of saved) s.tiles[i] = t;
    drive(sim, s, I, a, 300, () => a.status !== 'active');
    expect(a.status).toBe('withdrawn');
  });
  it('쓰러진 동료를 안전 구역으로 옮긴다. 숨진 동료는 수습해 옮긴다 — 끌고 온 대원이 곁에서 본 대로 알린다', () => {
    const run = (dead: boolean): { sim: Sim; a: FieldAgent; b: FieldAgent; texts: string[] } => {
      const { sim, s, I, of } = crewScene('INJ-resc', 'traffic', 'std', ['als']);
      const a = of('als', 'paramedic'), b = of('als', 'emt'), q = fresh(sim, b, 10);
      fresh(sim, a);
      for (const x of s.agents) if (x !== a && x !== b) x.status = 'left';
      b.x = s.staging.x + 5; b.y = s.staging.y; b.status = 'down'; q.status = 'down'; q.tDown = sim.t; b.label = '쓰러짐';
      if (dead) { q.dead = true; q.health = 0; b.label = ''; }
      const w = workItem(s, 'rescueMate', sim.t, { mate: b.rid, status: 'active', assignees: [a.rid] });
      a.task = makeTask('rescueMate', '동료 구조', w);
      const n0 = sim.events.length;
      drive(sim, s, I, a, 400, () => a.task === null);
      expect(w.status).toBe('done');
      return { sim, a, b, texts: sim.events.slice(n0).map((e) => e.text) };
    };
    const live = run(false);
    expect(live.b.status).toBe('withdrawn');
    expect(live.texts).toContain(`쓰러진 ${live.sim.responders[live.b.rid].name} 대원을 안전 구역으로 옮겼습니다.`);
    expect(live.a.beliefs.val<MateBelief>('mate', live.b.rid)).toMatchObject({ status: 'safe', dead: false, band: 2, wasDown: true });
    const gone = run(true);
    expect([gone.b.status, gone.b.label]).toEqual(['withdrawn', '']);
    expect(gone.texts).toContain(`순직한 ${gone.sim.responders[gone.b.rid].name} 대원을 안전 구역으로 옮겼습니다.`);
    expect(gone.a.beliefs.val<MateBelief>('mate', gone.b.rid)).toMatchObject({ status: 'safe', dead: true, band: 3 });
  });
  it('구하러 갔는데 더는 쓰러져 있지 않으면 본 대로 다시 알리고 끝낸다 (낡은 믿음으로 같은 지시가 되풀이되지 않게). 물 위의 동료는 기다린다', () => {
    const { sim, s, I, of } = crewScene('INJ-resc2', 'traffic', 'std', ['als']);
    const a = of('als', 'paramedic'), b = of('als', 'emt');
    fresh(sim, a); fresh(sim, b, 30);
    b.status = 'withdrawn'; sim.responders[b.rid].status = 'injured';
    b.x = a.x + 1; b.y = a.y;
    a.beliefs.merge(mkFact('mate', b.rid, { x: Math.round(b.x), y: Math.round(b.y), status: 'safe', band: 2, bleeding: false, tq: 0, dead: false, wasDown: false, since: sim.t }, '시험', sim.t, 1, true, ''));
    const w = workItem(s, 'rescueMate', sim.t, { mate: b.rid, status: 'active', assignees: [a.rid] });
    a.task = makeTask('rescueMate', '동료 구조', w);
    a.outbox.length = 0;
    act(sim, s, a);
    expect(a.task).toBeNull(); expect(w.status).toBe('done');
    expect(a.outbox.some((f) => f.type === 'mate' && f.id === b.rid && (f.value as MateBelief).status === 'safe'), '같은 내용이어도 강제로 다시 보고한다').toBe(true);
    expect(a.quiet.has('mate:' + b.rid)).toBe(true);
    // 자기 부대와 함께 떠난 동료 → evac
    b.status = 'left';
    const w2 = workItem(s, 'rescueMate', sim.t, { mate: b.rid, status: 'active', assignees: [a.rid] });
    a.task = makeTask('rescueMate', '동료 구조', w2); a.outbox.length = 0;
    act(sim, s, a);
    expect((a.beliefs.val<MateBelief>('mate', b.rid)!).status).toBe('evac');
    // 물 위에 쓰러진 동료: 끝내지 않고 기다린다 (실패로 끝내면 보류와 재지시가 되풀이된다)
    b.status = 'down';
    const i = Math.round(b.y) * s.w + Math.round(b.x), keep = s.tiles[i];
    s.tiles[i] = T.WATER;
    const w3 = workItem(s, 'rescueMate', sim.t, { mate: b.rid, status: 'active', assignees: [a.rid] });
    a.task = makeTask('rescueMate', '동료 구조', w3);
    const ax = a.x, ay = a.y;
    for (let k = 0; k < 20; k++) act(sim, s, a);
    expect([a.task?.kind, a.label, w3.status, w3.fails, a.x, a.y]).toEqual(['rescueMate', '물가 대기', 'active', 0, ax, ay]);
    s.tiles[i] = keep;
    void I;
  });
});

// ───────────────────────── 8·9·5·11 (대원) ─────────────────────────
describe('8. 정보 격리 — 지휘·관제는 남의 몸을 읽지 않는다 (대원)', () => {
  const code = (path: string): string => readFileSync(path, 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
  const files = ['src/sim/field/commander.ts', ...readdirSync('src/sim/dispatch').map((f) => 'src/sim/dispatch/' + f), ...readdirSync('src/sim/field/orders').map((f) => 'src/sim/field/orders/' + f)];
  it('commander·dispatch·orders·brain 에 명부에서 남의 체력·사망·출혈·후송·쓰러진 시각을 읽는 줄이 없다', () => {
    const re = /responders\[[^\]]*\]\.(health|dead|bleed|care|tDown)/;
    for (const f of [...files, 'src/sim/field/brain.ts']) expect(re.test(code(f)), f).toBe(false);
  });
  it('같은 파일들이 injury 모듈에서 가져오는 것은 믿음 쪽 함수뿐이고, bandOf 에 체력을 넣지 않는다', () => {
    for (const f of files) {
      const src = code(f);
      const imports = src.split('\n').filter((l) => /^import .*injury'/.test(l)).join('\n');
      for (const bad of ['hurtResponder', 'woundTick', 'protection', 'hurtCauseNow', 'mustRetreat']) expect(imports.includes(bad), `${f}: ${bad}`).toBe(false);
      expect(/bandOf\([^)]*\.health/.test(src), f).toBe(false);
    }
    // 대원은 자기 몸으로 물러날지를 정한다 (brain 은 mustRetreat 를 써도 된다 — resp(sim, a) 로 얻은 자기 몸)
    expect(code('src/sim/field/brain.ts')).toContain('mustRetreat(r)');
  });
});

describe('9. 가짜 연출 없음 — 순직', () => {
  let extra: Sim[] = [];
  beforeAll(() => { extra = [shift('S22', PRESETS.extreme.d), shift('S14', PRESETS.extreme.d)]; }, 60000);
  it('숨진 대원마다 그 대원의 RESPONDER_KILLED 기록이 정확히 하나, 그 시각은 사건의 종료 시각 이전이고 숨진 시각과 같다', () => {
    let dead = 0;
    for (const sim of [...all(), ...extra]) {
      const killed = sim.events.filter((e) => e.problem === 'RESPONDER_KILLED');
      for (const r of sim.responders) {
        const mine = killed.filter((e) => e.rid === r.id);
        expect(mine.length, `${sim.seed} ${r.name}`).toBe(r.dead ? 1 : 0);
        if (!r.dead) continue;
        dead++;
        expect(mine[0].t).toBe(r.tDead);
        expect(mine[0].t).toBeLessThanOrEqual(sim.incidents[mine[0].incidentId].closedAt);
        expect([r.status, r.health]).toEqual(['down', 0]);
        expect(r.deathCause, r.name).toBeTruthy();
        expect((r.injuries ?? []).some((j) => j.cause === r.deathCause), `${r.name}: 숨지게 한 원인의 기록 줄`).toBe(true);
        expect(sumDmg(r.injuries)).toBeGreaterThanOrEqual(100 - 1e-6);
      }
      // 2차 사고의 대원은 그때 살아 있었다
      for (const e of sim.events) if (e.problem === 'SECONDARY_COLLISION' && e.rid >= 0) { const r = sim.responders[e.rid]; expect(!r.dead || r.tDead! >= e.t, `${sim.seed} ${r.name}`).toBe(true); }
      // RESPONDER_HURT 도 종료 시각 이전
      for (const e of sim.events) if (e.problem === 'RESPONDER_HURT') expect(e.t, sim.seed).toBeLessThanOrEqual(sim.incidents[e.incidentId].closedAt);
    }
    void dead;
  });
  it('체력이 0 이하인데 숨지지 않은 대원, 쓰러질 체력인데 멀쩡한 대원이 교대 끝에 남지 않는다', () => {
    for (const sim of [...all(), ...extra]) for (const r of sim.responders) {
      const tag = `${sim.seed} ${r.name} hp ${r.health}`;
      if (!r.dead) expect(r.health, tag).toBeGreaterThan(0);
      if (r.health <= DOWN_AT) expect(r.status, tag).toBe('down');
      if (r.status === 'ok') expect(mustRetreat(r), tag).toBe(false);
      if (r.dead) expect(r.health, tag).toBe(0);
    }
  });
});

describe('5. 대원의 순직은 드물다', () => {
  it('보통 24교대에서 순직 1명 이하. 다친 대원은 교대당 0.1~0.7명', () => {
    const sims = [...plain];
    for (let k = 4; k < 24; k++) sims.push(shift('INJ' + k));
    let dead = 0, hurt = 0;
    for (const sim of sims) { dead += sim.responders.filter((r) => r.dead).length; hurt += sim.responders.filter((r) => r.status !== 'ok').length; }
    expect(dead).toBeLessThanOrEqual(1);
    expect(hurt / sims.length).toBeGreaterThan(0.1); expect(hurt / sims.length).toBeLessThan(0.7);
  }, 120000);
});

describe('11. 재현성 — 대원이 다치는 교대', () => {
  it('같은 시드·같은 난이도는 기록 해시와 대원의 부상 기록이 같다 (위협 5·심각도 5·장비 1)', () => {
    const a = harsh[2], b = shift('INJ2', HARSH);
    expect(b.report!.hash).toBe(a.report!.hash);
    const dump = (sim: Sim): string => JSON.stringify(sim.responders.map((r) => [r.health, r.status, r.bleed, r.dead, r.tDown, r.injuries]));
    expect(dump(b)).toBe(dump(a));
    expect(a.responders.some((r) => (r.injuries ?? []).length > 0)).toBe(true);
  }, 60000);
});

// ═════════════════════════ 단계 4b: 대원 — 후송 ═════════════════════════
/** crewScene 의 부대를 그 사건에 배정된 현장 부대로 만든다 (관제가 보낸 것처럼 — 5)번 블록·countUnits 가 그 부대를 본다) */
function assignAll(sim: Sim, I: Incident, kinds: UnitKind[]): void {
  for (const k of kinds) { const u = sim.units.find((q) => q.kind === k)!; u.state = 'onscene'; u.incidentId = I.id; if (I.assigned.indexOf(u.id) < 0) I.assigned.push(u.id); if (I.everAssigned.indexOf(u.id) < 0) I.everAssigned.push(u.id); }
}
/** 지휘관의 믿음에 동료의 상태를 넣는다 */
function mateKnown(sim: Sim, cmd: FieldAgent, b: FieldAgent, over: Partial<MateBelief>): void {
  cmd.beliefs.merge(mkFact('mate', b.rid, { x: Math.round(b.x), y: Math.round(b.y), status: 'safe', band: 1, bleeding: true, tq: 0, dead: false, wasDown: false, since: sim.t, ...over }, '시험', sim.t, 1, true, ''));
}
const liveTM = (s: Scene, rid: number): WorkItem[] => s.board.filter((w) => w.kind === 'treatMate' && w.mate === rid && (w.status === 'open' || w.status === 'active'));
/** 집에 있는 부대 하나를 복귀시켜 도착하게 한다 (resources.arrive 의 복귀 갈래) */
function homeArrive(seed: string, kind: UnitKind, setup: (sim: Sim, u: Unit) => void): { sim: Sim; u: Unit; texts: SimEvent[] } {
  const sim = new Sim(seed, NORMAL, 1200);
  const u = sim.units.find((q) => q.kind === kind)!;
  setup(sim, u);
  u.state = 'returning'; u.destNode = u.homeNode;
  const n0 = sim.events.length;
  sim.step();
  return { sim, u, texts: sim.events.slice(n0).filter((e) => e.actor === u.callsign) };
}

describe('단계 4b — 병원이 필요한 몸과 걸을 수 있는 대원 (§2.7 · §3.6)', () => {
  it('needsHospital(진실): 쓰러진 적 · 큰 출혈(HOSPITAL_BLEED) · 체력 40 이하. 숨졌거나 후송 중·인계됐으면 아니다. mateNeedsHospital(믿음)도 같은 판단이다', () => {
    const r = { health: 60, bleed: 0, dead: undefined, care: undefined, tDown: undefined, status: 'injured' } as unknown as Responder;
    expect(needsHospital(r)).toBe(false);
    r.bleed = HOSPITAL_BLEED; expect(needsHospital(r)).toBe(true);
    r.bleed = HOSPITAL_BLEED - 1e-6; expect(needsHospital(r)).toBe(false);
    r.health = HURT_AT; expect(needsHospital(r)).toBe(true);
    r.health = HURT_AT + 0.01; expect(needsHospital(r)).toBe(false);
    r.tDown = 5; expect(needsHospital(r)).toBe(true);
    r.care = 'aboard'; expect(needsHospital(r)).toBe(false);
    r.care = undefined; r.dead = true; expect(needsHospital(r)).toBe(false);
    const v = (o: Partial<MateBelief>): MateBelief => ({ x: 0, y: 0, status: 'safe', band: 1, bleeding: false, tq: 0, dead: false, wasDown: false, since: 0, ...o });
    expect([v({}), v({ band: 2 }), v({ bleeding: true }), v({ wasDown: true }), v({ band: 2, status: 'evac' }), v({ band: 2, dead: true })].map(mateNeedsHospital)).toEqual([false, true, true, true, false, false]);
    expect(HOSPITAL_BLEED).toBe(MATE_RETREAT_BLEED);      // 출혈로 물러난 대원은 처치를 받으면(출혈 × (1 − 0.9q)) 병원이 필요 없는 몸이 된다
  });
  it('canDeploy · crewReady(걸을 수 있는 대원) · crewOk(온전한 대원) — 2인 순찰차, 헬기·구조정은 내리지 않는 자리를 세지 않는다 (시험 12 ②③④⑤)', () => {
    const sim = new Sim('INJ-crew', NORMAL, 1200);
    const p = sim.units.find((q) => q.kind === 'patrol')!;
    const fc = fieldCrew(sim, p), [r0, r1] = fc.map((rid) => sim.responders[rid]);
    expect(fc.length).toBe(2); expect(minField('patrol')).toBe(2);
    expect([crewReady(sim, p), crewOk(sim, p)]).toEqual([2, 2]);
    r0.status = 'injured'; r0.health = 55;
    expect([crewReady(sim, p), crewOk(sim, p)], '② 부상 한 명').toEqual([2, 1]);
    r1.status = 'injured'; r1.health = 55;
    expect([crewReady(sim, p), crewOk(sim, p)], '③ 둘 다 걸을 수 있는 부상').toEqual([2, 0]);
    r0.status = 'down'; r0.dead = true; r0.health = 0;
    expect(crewReady(sim, p), '① 순직 한 명 — 남은 대원으로 나간다').toBe(1);
    r1.status = 'down'; r1.dead = true; r1.health = 0;
    expect(crewReady(sim, p), '④ 전원 순직').toBe(0);
    r0.dead = undefined; r1.dead = undefined; r0.health = 10; r1.health = 10;
    expect(crewReady(sim, p), '살아 있는 대원이 모두 쓰러졌다(후송 전)').toBe(0);
    r0.status = 'injured'; r1.status = 'injured'; r0.health = 50; r1.health = 50; r0.care = 'hospital'; r1.care = 'hospital';
    expect([crewReady(sim, p), crewOk(sim, p)], '⑤ 모두 병원으로 후송됐다').toEqual([0, 0]);
    expect([canDeploy(r0), canDeploy({ ...r0, care: undefined } as Responder)]).toEqual([false, true]);
    for (const kind of ['heli', 'boat'] as UnitKind[]) {
      const u = sim.units.find((q) => q.kind === kind);
      if (!u) continue;
      expect(crewReady(sim, u), kind).toBe(fieldCrew(sim, u).length);
      expect(fieldCrew(sim, u).length, kind).toBeLessThan(u.crew.length);      // 조종사·정장은 내리지 않는다
    }
  });
  it('복귀해 기지에 닿았을 때: 걸을 수 있는 대원이 하나라도 있으면 운용을 멈추지 않는다. 멈추는 까닭은 셋 — 전원 순직 · 남은 대원 모두 병원 이송 · 걸을 수 있는 대원 없음', () => {
    const mk = (f: (r: Responder, k: number) => void) => (sim: Sim, u: Unit): void => { fieldCrew(sim, u).forEach((rid, k) => f(sim.responders[rid], k)); };
    const one = homeArrive('S1', 'patrol', mk((r, k) => { if (k === 0) { r.status = 'down'; r.dead = true; r.health = 0; } }));
    expect(one.u.state, '① 순직 한 명').toBe('available'); expect(one.texts.some((e) => /운용 중단/.test(e.text))).toBe(false);
    const hurt = homeArrive('S1', 'patrol', mk((r) => { r.status = 'injured'; r.health = 55; }));
    expect(hurt.u.state, '③ 둘 다 다쳤지만 걷는다').toBe('available'); expect(hurt.texts.some((e) => /운용 중단/.test(e.text))).toBe(false);
    const dead = homeArrive('S1', 'patrol', (sim, u) => { mk((r) => { r.status = 'down'; r.dead = true; r.health = 0; })(sim, u); u.oosEv = 3; });
    expect(dead.u.state).toBe('oos');
    const de = dead.texts.find((e) => /운용 중단/.test(e.text))!;
    expect(de.text).toBe(`${dead.u.callsign} 대원 전원 순직 — 운용 중단.`); expect(de.causes).toEqual([3]);
    const hosp = homeArrive('S1', 'patrol', mk((r, k) => { if (k === 0) { r.status = 'down'; r.dead = true; r.health = 0; } else { r.status = 'injured'; r.care = 'hospital'; } }));
    expect(hosp.u.state).toBe('oos'); expect(hosp.texts.map((e) => e.text)).toContain(`${hosp.u.callsign} 남은 대원 모두 병원 이송 — 운용 중단.`);
    const down = homeArrive('S1', 'patrol', mk((r) => { r.status = 'down'; r.health = 10; r.tDown = 0; }));
    expect(down.u.state).toBe('oos'); expect(down.texts.map((e) => e.text)).toContain(`${down.u.callsign} 걸을 수 있는 대원이 없어 운용 중단.`);
    for (const x of [dead, hosp, down]) { const e = x.texts.find((q) => /운용 중단/.test(q.text))!; expect(PHRASE.T6.test(e.text), e.text).toBe(true); expect(sysOf(e)).toBe('crew'); }
    expect(dead.sim.events.some((e) => /전원 부상/.test(e.text))).toBe(false);
  });
  it('④ 전원 순직한 부대: 실제로 숨지게 하면 그 뒤 어느 사건에도 배정되지 않고, 기지에 닿으면 운용 중단 기록의 원인이 마지막 순직 기록(= u.oosEv)이다', () => {
    const { sim, s, I } = crewScene('INJ-alldead', 'traffic', 'std', ['patrol']);
    const p = sim.units.find((q) => q.kind === 'patrol')!;
    assignAll(sim, I, ['patrol']);
    const crew = s.agents.filter((a) => a.unitId === p.id);
    expect(crew.length).toBe(2);
    for (const a of crew) { fresh(sim, a, 30); hurtResponder(sim, s, I, a, 200, 'gunshot'); agentHealth(sim, s, I, a); }
    expect(crew.every((a) => sim.responders[a.rid].dead)).toBe(true);
    const kills = sim.events.filter((e) => e.problem === 'RESPONDER_KILLED');
    expect(kills.length).toBe(2);
    expect(p.oosEv).toBe(kills[1].id);
    expect(crewReady(sim, p)).toBe(0);
    const t0 = sim.t;
    for (let n = 0; n < 6000 && p.state !== 'oos'; n++) sim.step();
    expect(p.state).toBe('oos');
    for (const J of sim.incidents) if (J.createdAt > t0) expect(J.everAssigned.indexOf(p.id), J.code).toBe(-1);
    const e = sim.events.find((q) => q.actor === p.callsign && /운용 중단/.test(q.text))!;
    expect(e.text).toBe(`${p.callsign} 대원 전원 순직 — 운용 중단.`);
    expect(e.causes).toEqual([kills[1].id]);
  }, 60000);
  it('쓰인 자리(seatsUsed): 실은 구조 대상 + 다른 부대의 다친 대원. 자기 부대의 다친 대원은 원래 자리에 탄다', () => {
    const sim = new Sim('INJ-seat', NORMAL, 1200);
    const als = sim.units.find((q) => q.kind === 'als')!, p = sim.units.find((q) => q.kind === 'patrol')!;
    expect(seatsUsed(sim, als)).toBe(0);
    als.aboard = [{ kind: 'mate', id: als.crew[0], inc: 0, t: 0 }];
    expect(seatsUsed(sim, als), '자기 부대 대원').toBe(0);
    als.aboard.push({ kind: 'mate', id: p.crew[0], inc: 0, t: 0 });
    expect(seatsUsed(sim, als), '다른 부대 대원').toBe(1);
    als.patients = [0];
    expect(seatsUsed(sim, als)).toBe(2); expect(seatsUsed(sim, als) >= seatsOf(als)).toBe(true);
    p.aboard = [{ kind: 'mate', id: p.crew[1], inc: 0, t: 0 }];
    expect([seatsOf(p), seatsUsed(sim, p)], '자기 대원을 태운 순찰차는 "자리 0" 에 걸리지 않는다').toEqual([0, 0]);
  });
});

describe('단계 4b — 다친 대원은 가벼운 일만 (§2.5 · §3.6 · 시험 12 ③)', () => {
  it('fitFor: 걸을 수 있는 다친 대원(injured)에게 무거운 일은 0, 가벼운 일(교통 통제)은 맡는다. 처치 보조는 대상이 안전 구역에 있을 때만. 목록은 injury.LIGHT_WORK 한 곳', () => {
    const { sim, s, of } = crewScene('INJ-lw', 'traffic', 'std', ['patrol', 'als']);
    const a = of('patrol'), r = fresh(sim, a, 55);
    expect([...LIGHT_WORK].sort()).toEqual(['cordon', 'hookup', 'interview', 'negotiate', 'perimeter', 'persuade', 'traffic', 'treat', 'treatMate']);      // persuade: (N8 단계 9) 설득
    const tw = workItem(s, 'traffic', sim.t, { tile: 0 });
    expect(fitFor(sim, s, a, tw)).toBeGreaterThan(0);
    r.status = 'injured';
    expect(fitFor(sim, s, a, tw), '교통 통제는 가벼운 일').toBeGreaterThan(0);
    const heavy: WorkItem['kind'][] = ['search', 'engage', 'arrest', 'carry', 'load', 'rescueMate', 'extricate', 'suppress', 'clearRoad'];
    for (const kind of heavy) expect(fitFor(sim, s, a, workItem(s, kind, sim.t, { region: 0, cas: 0, hostile: 0, mate: of('als').rid, prop: -1 })), kind).toBe(0);
    // 처치 보조는 대상이 안전 구역에 나와 있을 때만 (다친 구급대원)
    const m = of('als'), mr = fresh(sim, m, 50);
    mr.status = 'injured'; m.status = 'withdrawn';
    const b2 = s.agents.find((q) => q.unitId === m.unitId && q !== m)!;
    fresh(sim, b2, 55); sim.responders[b2.rid].status = 'injured';
    const tm = workItem(s, 'treatMate', sim.t, { mate: m.rid, max: 1 });
    b2.beliefs.merge(mkFact('mate', m.rid, { x: 1, y: 1, status: 'hurt', band: 1, bleeding: true, tq: 0, dead: false, wasDown: false, since: sim.t }, '시험', sim.t, 1, true, ''));
    expect(fitFor(sim, s, b2, tm), '후퇴 중인 동료는 다친 구급대원이 보지 않는다').toBe(0);
    b2.beliefs.merge(mkFact('mate', m.rid, { x: 1, y: 1, status: 'safe', band: 1, bleeding: true, tq: 0, dead: false, wasDown: false, since: sim.t + 1 }, '시험', sim.t + 1, 1, true, ''));
    expect(fitFor(sim, s, b2, tm), '안전 구역의 동료는 다친 구급대원도 처치를 돕는다').toBeGreaterThan(0);
  });
  it('다친 채 내린 대원: 이름표 "부상 — 가벼운 일", 본인이 소리 없이 알린다(mate 사실 light)', () => {
    const { sim, s } = sceneOf('INJ-arrive', 'traffic', 'std');
    const I = sim.incidents[s.incidentId];
    const p = sim.units.find((q) => q.kind === 'patrol')!;
    for (const rid of fieldCrew(sim, p)) { const r = sim.responders[rid]; r.status = 'injured'; r.health = 55; }
    unitArrived(sim, I, p);
    const crew = s.agents.filter((a) => a.unitId === p.id);
    expect(crew.length).toBe(2);
    for (const a of crew) {
      expect(a.label).toBe('부상 — 가벼운 일');
      expect(a.beliefs.val<MateBelief>('mate', a.rid)?.status).toBe('light');
      expect(a.outbox.some((f) => f.type === 'mate' && f.id === a.rid)).toBe(true);
    }
  });
  it('③ 걸을 수 있는 다친 대원만 남은 순찰차는 배정에서 빠지지 않는다 — 다른 경찰 부대가 모두 멈춘 교대에서 경찰 사건에 나가 내리고, 맡는 일은 가벼운 일뿐이다(지휘관의 현장 평가는 예외)', () => {
    const sim = new Sim('INJ-light', NORMAL, 1200);
    const p = sim.units.find((q) => q.kind === 'patrol')!;
    for (const q of sim.units) if (q !== p && q.dept === 'police') q.state = 'oos';
    for (const rid of fieldCrew(sim, p)) { const r = sim.responders[rid]; r.status = 'injured'; r.health = 55; }
    expect([crewReady(sim, p), crewOk(sim, p)]).toEqual([2, 0]);
    const crew = new Set(fieldCrew(sim, p));
    createIncident(sim, { type: 'armed', variant: 'domestic', rng: sim.rng.fork('t4b') });
    let landed = 0, checks = 0;
    for (let n = 0; n < 5000 && !sim.ended; n++) {
      sim.step();
      if (n % 100 !== 0) continue;
      for (const s of scenesOf(sim)) for (const a of s.agents) {
        if (!crew.has(a.rid) || a.status !== 'active') continue;
        landed++;
        if (a.task && a.task.workId >= 0 && a.task.kind !== 'sizeup') { checks++; expect(LIGHT_WORK.has(a.task.kind as WorkItem['kind']), `${a.task.kind} (t=${sim.t})`).toBe(true); }
      }
    }
    expect(sim.incidents.some((J) => J.everAssigned.indexOf(p.id) >= 0), '배정됐다').toBe(true);
    expect(landed, '현장에 내렸다').toBeGreaterThan(0);
    expect(checks, '일을 맡았다').toBeGreaterThan(0);
  }, 60000);
});

describe('단계 4b — 다친 동료의 처치와 후송 (§3.4-2 · orders/injury.ts)', () => {
  it('지휘관: 대상당 한 항목(우선도 0.8 + 0.06 × band, 태울 차 = 자리가 남은 구급차). 자리가 차면 처치만, 가벼운 일로 돌아왔다·후송됐다고 알면 거둔다', () => {
    const { sim, s, I, of } = crewScene('INJ-tm', 'traffic', 'std', ['patrol', 'als']);
    assignAll(sim, I, ['patrol', 'als']);
    const cmd = s.agents.find((a) => a.isCommander)!;
    const als = sim.units.find((q) => q.kind === 'als')!;
    const b = s.agents.find((a) => a.unitId !== als.id && a !== cmd)!;
    s.sizeupDone = true; s.mismatchLogged = true;
    for (const q of s.agents) { q.nextThink = 1e9; q.task = null; }
    const r = fresh(sim, b, 55); r.status = 'injured'; r.bleed = 0.1; b.status = 'withdrawn';
    mateKnown(sim, cmd, b, {});
    // 아직 끝낼 수 없는 현장으로 둔다 (실을 구조 대상이 남았다 — 시험 도중 종료가 선언되지 않게)
    cmd.beliefs.merge(mkFact('cas', s.casualties[0].id, { x: 3, y: 3, mob: 'immobile', band: 1, where: 'scene', treated: false, trappedDone: true, tq: 0 }, '시험', sim.t, 1, true, ''));
    commanderThink(sim, s, cmd);
    commanderThink(sim, s, cmd);
    const items = liveTM(s, b.rid);
    expect(items.length, '대상당 한 항목').toBe(1);
    expect(items[0].priority).toBeCloseTo(0.86, 12); expect([items[0].max, items[0].prop]).toEqual([1, als.id]);
    // 맡을 사람: 구급대원 (경찰은 의료 가방이 없다), 다친 본인은 아니다
    expect(fitFor(sim, s, of('als'), items[0])).toBeGreaterThan(0);
    expect(fitFor(sim, s, b, items[0])).toBe(0);
    if (cmd.unitId !== als.id) expect(fitFor(sim, s, cmd, items[0])).toBe(0);
    // 자리가 찼다: 처치만 (열린 항목의 태울 차를 고쳐 쓴다 — 새 항목을 만들지 않는다)
    items[0].status = 'open'; items[0].assignees.length = 0;
    als.patients = [0, 1];
    commanderThink(sim, s, cmd);
    expect(liveTM(s, b.rid).map((w) => [w.id, w.prop])).toEqual([[items[0].id, -1]]);
    als.patients = []; als.boardOrder = null;      // (자리가 찬 구급차에는 지휘관이 출발 지시를 냈다 — 시험을 위해 되돌린다)
    // 가벼운 일로 돌아왔다고 알면 거둔다
    sim.t += 1; mateKnown(sim, cmd, b, { status: 'light', bleeding: false, band: 1, tq: 2 });
    commanderThink(sim, s, cmd);
    expect(liveTM(s, b.rid).length).toBe(0);
    // 다시 후송이 필요하다고 알면 열고, 후송됐다고 알면 거둔다
    sim.t += 1; mateKnown(sim, cmd, b, {}); commanderThink(sim, s, cmd); expect(liveTM(s, b.rid).length).toBe(1);
    sim.t += 1; mateKnown(sim, cmd, b, { status: 'evac' }); commanderThink(sim, s, cmd); expect(liveTM(s, b.rid).length).toBe(0);
  });
  it('맡을 사람이 없으면 항목을 열지 않고 구급 부대를 부른다. 20초 넘게 기다렸고 구급 부대가 없으면 그 대원의 부대가 직접 싣고 간다(주관 분야의 마지막 부대는 아니다)', () => {
    const { sim, s, I } = crewScene('INJ-self', 'traffic', 'std', ['patrol', 'tactical']);
    assignAll(sim, I, ['patrol', 'tactical']);
    const cmd = s.agents.find((a) => a.isCommander)!;
    const b = s.agents.find((a) => a.unitId !== cmd.unitId)!;
    const bu = sim.units[b.unitId];
    s.sizeupDone = true; s.mismatchLogged = true;
    for (const q of s.agents) { q.nextThink = 1e9; q.task = null; }
    const r = fresh(sim, b, 55); r.status = 'injured'; r.bleed = 0.1; b.status = 'withdrawn';
    mateKnown(sim, cmd, b, {});
    commanderThink(sim, s, cmd);
    expect(liveTM(s, b.rid).length, '맡을 사람이 없다 — 열어 두면 종료를 막는다').toBe(0);
    expect(s.requests.some((q) => q.need === 'ems' && q.reason === '부상 대원 후송')).toBe(true);
    expect(bu.boardOrder, '아직 20초가 지나지 않았다').toBeFalsy();
    sim.t += SELF_EVAC_WAIT + 1;
    const n0 = sim.events.length;
    commanderThink(sim, s, cmd);
    expect(bu.boardOrder).toBe('transport');
    expect(sim.events.slice(n0).map((e) => e.text)).toContain(`${bu.callsign}, 부상 대원을 태우고 병원으로 이동하라.`);
    expect(sim.units[cmd.unitId].boardOrder, '지휘관의 부대는 남는다').toBeFalsy();
    // 그 부대가 현장의 마지막 주관 분야 부대면 빼지 않는다 (교통사고의 주관 분야는 소방이다 — 경찰이 주관하는 무장 현장, 안전 확보 뒤)
    expect(s.leadDept).not.toBe('police');
    const solo = crewScene('INJ-self2', 'armed', 'domestic', ['patrol']);
    assignAll(solo.sim, solo.I, ['patrol']);
    expect(solo.s.leadDept).toBe('police');
    solo.s.secureAt = 0;
    const c2 = solo.s.agents.find((a) => a.isCommander)!, b2 = solo.s.agents.find((a) => a !== c2)!;
    solo.s.sizeupDone = true; solo.s.mismatchLogged = true;
    for (const q of solo.s.agents) { q.nextThink = 1e9; q.task = null; }
    const r2 = fresh(solo.sim, b2, 55); r2.status = 'injured'; r2.bleed = 0.1; b2.status = 'withdrawn';
    mateKnown(solo.sim, c2, b2, {});
    solo.sim.t += SELF_EVAC_WAIT + 1;
    commanderThink(solo.sim, solo.s, c2);
    expect(solo.sim.units[b2.unitId].boardOrder).toBeFalsy();
  });
  it('실행기: 처치를 마친 뒤 병원이 필요 없으면 태우지 않고(가벼운 일로 돌아온다), 필요하면 끌고 가 태운다 — 쓰러졌던 대원은 들것으로. 남은 사람이 없는 부대는 철수시킨다', () => {
    const run = (wasDown: boolean, lastOfUnit: boolean) => {
      const { sim, s, I } = crewScene('INJ-exe', 'medical', undefined, ['als', 'patrol']);
      assignAll(sim, I, ['als', 'patrol']);
      const als = sim.units.find((q) => q.kind === 'als')!, p = sim.units.find((q) => q.kind === 'patrol')!;
      for (const q of s.agents) { q.nextThink = 1e9; q.task = null; q.planT = 1e9; }
      const medic = s.agents.find((a) => a.unitId === als.id)!;
      const [b, other] = s.agents.filter((a) => a.unitId === p.id);
      const r = fresh(sim, b, 60); r.status = wasDown ? 'down' : 'injured'; r.bleed = 0.1; r.bleed0 = 0.1; r.bleedCause = 'gunshot'; if (wasDown) r.tDown = sim.t - 30;
      b.status = 'withdrawn'; b.x = s.staging.x + 1; b.y = s.staging.y;
      if (lastOfUnit) other.status = 'left';
      const w = workItem(s, 'treatMate', sim.t, { mate: b.rid, prop: als.id, max: 1 });
      medic.task = makeTask('treatMate', '시험', w); w.status = 'active'; w.assignees.push(medic.rid);
      const n0 = sim.events.length;
      let dragged = false;
      for (let n = 0; n < 600 && medic.task; n++) { tickOnce(sim, s); if (medic.carrying === -(b.rid + 2)) dragged = true; }
      for (let n = 0; n < 3; n++) tickOnce(sim, s);      // 가벼운 일로 돌아오는 것은 처치가 끝난 틱의 다음 틱부터다
      return { sim, s, als, p, b, r, medic, texts: sim.events.slice(n0).map((e) => e.text), dragged };
    };
    const lite = run(false, false);
    expect(lite.texts).toContain(`${lite.r.name} 대원 응급 처치 완료.`);
    expect(lite.r.treatQ ?? 0).toBeGreaterThan(0); expect(lite.r.bleed ?? 0).toBeLessThan(HOSPITAL_BLEED);
    expect(lite.b.status, '병원이 필요 없으면 태우지 않는다 — 가벼운 일로 돌아온다').toBe('active');
    expect(lite.texts).toContain('처치 받음. 가벼운 임무로 복귀합니다.');
    expect(lite.als.aboard ?? []).toEqual([]);
    const evac = run(true, true);
    expect(evac.texts).toContain(`${evac.r.name} 대원 ${evac.als.callsign}에 탑승 — 병원 후송.`);
    expect(evac.dragged, '쓰러졌던 대원은 들것으로').toBe(true);
    expect([evac.b.status, evac.r.care]).toEqual(['left', 'aboard']);
    expect(evac.als.aboard!.map((e) => [e.kind, e.id])).toEqual([['mate', evac.b.rid]]);
    expect(evac.als.firstLoadAt).toBeDefined(); expect(seatsUsed(evac.sim, evac.als)).toBe(1);
    expect(evac.medic.carrying).toBe(-1);
    expect(evac.medic.beliefs.val<MateBelief>('mate', evac.b.rid)?.status).toBe('evac');
    expect(evac.p.state, '현장에 남은 사람이 없는 부대는 철수한다 (고아 부대)').toBe('returning');
    expect(evac.texts).toContain(`${evac.p.callsign} 현장 철수, 복귀합니다.`);
    expect(lite.p.state, '남은 동료가 있으면 그대로').toBe('onscene');
  });
  it('출발: 다친 대원만 태운 구급차도 떠난다(10초 뒤). 지휘관은 실은 사람의 진실을 읽지 않는다 — 부대의 기록(firstLoadAt·aboard)으로 정한다', () => {
    const { sim, s, I } = crewScene('INJ-go', 'medical', undefined, ['als', 'patrol']);
    assignAll(sim, I, ['als', 'patrol']);
    const cmd = s.agents.find((a) => a.isCommander)!;
    const als = sim.units.find((q) => q.kind === 'als')!, p = sim.units.find((q) => q.kind === 'patrol')!;
    s.sizeupDone = true;
    for (const q of s.agents) { q.nextThink = 1e9; q.task = null; }
    const b = s.agents.find((a) => a.unitId === p.id)!;
    b.status = 'left'; sim.responders[b.rid].care = 'aboard';
    als.aboard = [{ kind: 'mate', id: b.rid, inc: I.id, t: sim.t }]; als.firstLoadAt = sim.t;
    for (const c of s.casualties) cmd.beliefs.merge(mkFact('cas', c.id, { x: 3, y: 3, mob: 'immobile', band: 1, where: 'scene', treated: false, trappedDone: true, tq: 0 }, '시험', sim.t, 1, true, ''));
    commanderThink(sim, s, cmd);
    expect(als.boardOrder, '방금 태웠다 — 실을 사람이 남았으면 기다린다').toBeFalsy();
    sim.t += 11;
    const n0 = sim.events.length;
    commanderThink(sim, s, cmd);
    expect(als.boardOrder).toBe('transport');
    expect(sim.events.slice(n0).map((e) => e.text)).toContain(`${als.callsign}, 부상 대원 1명 병원 이송 출발하라.`);
    // 정보 격리: commander.ts 에는 구조 대상·용의자의 진실 읽기가 남지 않았다 (firstLoad·redAboard 를 부대 기록과 믿음으로 바꿨다 — 시험 8 의 4b 줄)
    const src = readFileSync('src/sim/field/commander.ts', 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
    expect(src).not.toMatch(/s\.casualties/); expect(src).not.toMatch(/s\.hostiles/);
  });
  it('부대가 떠날 때(5번 블록): 병원이 필요한 대원은 그 차에 실려 병원부터 간다 — 숨진 대원은 싣지 않는다. 병원에서 인계되고, 사람이 남지 않은 부대는 운용을 멈춘다', () => {
    const { sim, s, I } = crewScene('INJ-depart', 'medical', undefined, ['als', 'patrol']);
    assignAll(sim, I, ['als', 'patrol']);
    const p = sim.units.find((q) => q.kind === 'patrol')!;
    const [b, c] = s.agents.filter((a) => a.unitId === p.id);
    const rb = fresh(sim, b, 35); rb.status = 'injured'; b.status = 'withdrawn';
    const rc = fresh(sim, c, 0); rc.dead = true; rc.status = 'down'; rc.tDead = sim.t; c.status = 'down';
    closeIncident(sim, I, 'resolved');
    for (let n = 0; n < 3000 && p.state === 'onscene'; n++) tickOnce(sim, s);
    expect(p.state).toBe('transport');
    expect([rb.care, rc.care]).toEqual(['aboard', undefined]);
    expect(p.aboard!.map((e) => e.id)).toEqual([b.rid]);
    const dep = sim.events.find((e) => e.actor === p.callsign && /싣고/.test(e.text))!;
    expect(dep.text).toMatch(new RegExp(`^${p.callsign} 부상 대원 1명 싣고 .+(으로|로) 출발\\.$`));
    expect(PHRASE.T3.test(dep.text)).toBe(true);
    for (let n = 0; n < 8000 && p.state !== 'oos' && p.state !== 'available'; n++) sim.step();
    expect([rb.care, rb.bleed]).toEqual(['hospital', 0]);
    expect(p.aboard).toEqual([]); expect(p.firstLoadAt).toBeUndefined();
    const hand = sim.events.find((e) => e.actor === p.callsign && /인계 완료/.test(e.text))!;
    expect(hand.text).toMatch(/: .+ 도착, 부상 대원 1명 인계 완료\.$/);
    expect(PHRASE.T4.test(hand.text)).toBe(true); expect(sysOf(hand)).toBe('hospital');
    expect(checkC5(sim.events).bad).toBe(0);
    expect(p.state, '숨지지 않은 대원이 모두 병원으로 갔다').toBe('oos');
    expect(sim.events.some((e) => e.text === `${p.callsign} 남은 대원 모두 병원 이송 — 운용 중단.`)).toBe(true);
  }, 60000);
  it('안전장치: 이 현장에 내렸던 부대의 대원이 모두 차에 탔는데 떠나라는 지시가 없으면 철수시킨다 (사건이 아직 열려 있어도)', () => {
    const { sim, s, I } = crewScene('INJ-orphan', 'medical', undefined, ['als', 'patrol']);
    assignAll(sim, I, ['als', 'patrol']);
    const p = sim.units.find((q) => q.kind === 'patrol')!;
    for (const a of s.agents) if (a.unitId === p.id) a.status = 'left';
    tickOnce(sim, s);
    expect(p.state).toBe('returning');
    expect(I.phase).not.toBe('closed');
  });
  it('가벼운 일로 복귀(§3.6a, 시험 12 ⑥): 출혈로 물러난 대원이 병원이 필요 없는 몸이 되면 한 번 돌아온다. 다시 물러나면 그 현장에서는 돌아오지 않는다. 병원이 필요하면 남는다', () => {
    const { sim, s, I, of } = crewScene('INJ-back', 'medical', undefined, ['als', 'patrol']);
    assignAll(sim, I, ['als', 'patrol']);
    for (const q of s.agents) { q.nextThink = 1e9; q.planT = 1e9; q.task = null; }
    const b = of('patrol'), r = fresh(sim, b, 60);
    r.bleed = 0.1; r.bleedCause = 'gunshot';
    agentHealth(sim, s, I, b);
    expect(r.status).toBe('injured');
    b.task = null; b.status = 'withdrawn';
    tickOnce(sim, s);
    expect(b.status, '출혈이 남은(병원이 필요한) 대원은 기다린다').toBe('withdrawn');
    r.bleed = 0.005;
    const n0 = sim.events.length;
    tickOnce(sim, s);
    expect(b.status).toBe('active'); expect(b.lightBack).toBe(true);
    expect(sim.events.slice(n0).filter((e) => e.text === '처치 받음. 가벼운 임무로 복귀합니다.').length).toBe(1);
    expect(b.beliefs.val<MateBelief>('mate', b.rid)?.status).toBe('light');
    // 지휘관이 알게 되면 그 대원의 처치를 열지 않는다
    const cmd = s.agents.find((a) => a.isCommander)!;
    for (let k = 0; k < 40; k++) tickOnce(sim, s);
    if (cmd !== b) { s.sizeupDone = true; commanderThink(sim, s, cmd); expect(cmd.beliefs.val<MateBelief>('mate', b.rid)?.status).toBe('light'); }
    expect(liveTM(s, b.rid).length).toBe(0);
    // 다시 물러나면 돌아오지 않는다
    b.status = 'withdrawn'; b.task = null; r.health = 35;
    tickOnce(sim, s);
    r.health = 60; r.bleed = 0;
    for (let k = 0; k < 5; k++) tickOnce(sim, s);
    expect(b.status).toBe('withdrawn');
  });
});

describe('6 · 13. 쓰러진 대원은 구조되고 후송된다 · 고아 부대 없음', () => {
  it('6. 응급 현장에서 구급차 대원 하나를 쓰러뜨리면: 동료가 안전 구역으로 옮기고 → 처치하고 → 차에 태워 → 병원에 인계한다 (숨지면 RESPONDER_KILLED). 끝에 그 대원은 차에 탔다', () => {
    let checked = 0;
    for (let k = 0; k < 8 && checked < 2; k++) {
      const sim = new Sim('INJ-evac' + k, NORMAL, 1200, { force: 'medical' });
      let victim: FieldAgent | null = null, I: Incident | undefined;
      for (let n = 0; n < 4000 && !victim && !sim.ended; n++) {
        sim.step();
        I ??= sim.incidents.find((J) => J.truth.type === 'medical' && J.createdAt >= 15 && J.createdAt < 16);
        if (!I || I.phase === 'closed') continue;
        const s = sim.scenes[I.id]!;
        for (const a of s.agents) {
          const u = sim.units[a.unitId];
          if (a.status !== 'active' || a.isCommander || (u.kind !== 'als' && u.kind !== 'bls') || u.boardOrder) continue;
          if (!s.agents.some((q) => q !== a && q.unitId === a.unitId && q.status === 'active')) continue;
          victim = a; break;
        }
        if (victim) { victim.hpTick = sim.responders[victim.rid].health; hurtResponder(sim, s, I, victim, 500, 'blunt'); }
      }
      if (!victim || !I) continue;
      sim.runToEnd(40000);
      checked++;
      const r = sim.responders[victim.rid];
      const tag = `${sim.seed} ${r.name}`;
      expect(victim.status, tag).toBe('left');
      expect(sim.events.some((e) => e.text === `쓰러진 ${r.name} 대원을 안전 구역으로 옮겼습니다.` || e.text === `순직한 ${r.name} 대원을 안전 구역으로 옮겼습니다.`), `${tag} 구조`).toBe(true);
      if (r.dead) expect(sim.events.filter((e) => e.problem === 'RESPONDER_KILLED' && e.rid === r.id).length, tag).toBe(1);
      else {
        expect(r.care, `${tag} 후송`).toBe('hospital');
        expect(sim.events.some((e) => /부상 대원 \d+명 인계 완료/.test(e.text)), `${tag} 인계 기록`).toBe(true);
      }
    }
    expect(checked).toBeGreaterThanOrEqual(2);
  }, 120000);
  it('13. 교대가 끝났을 때 이미 닫혀 보관된 사건에 남아 있는 부대가 없다 (총격범 둘 · 보통 둘)', () => {
    for (const sim of [shooter[0], shooter[1], plain[0], plain[1]]) {
      const stuck = sim.units.filter((u) => u.state === 'onscene' && u.incidentId !== null && sim.incidents[u.incidentId].phase === 'closed' && sim.scenes[u.incidentId]?.archived);
      expect(stuck.map((u) => u.callsign), sim.seed).toEqual([]);
    }
  });
});

describe('단계 4b — 고친 곳 (다친 경관이 지키는 출입구 · 가벼운 일 보고의 순서)', () => {
  it('진입이 정해진 무장 현장: 다친 경관 몫으로 더한 출입구 자리는 우선도가 낮아(0.5 −) 그 자리를 잡은 온전한 경관을 진입(0.9)이 빼 올 수 있다 — 0.22 규칙의 교착을 피한다', () => {
    const { sim, s, I } = crewScene('INJ-posts', 'armed', 'robbery', ['patrol', 'tactical']);
    assignAll(sim, I, ['patrol', 'tactical']);
    const cmd = s.agents.find((a) => a.isCommander)!;
    s.sizeupDone = true; s.mismatchLogged = true; s.entryOrdered = true;
    for (const q of s.agents) { q.nextThink = 1e9; q.task = null; }
    const h = s.hostiles[0];
    cmd.beliefs.merge(mkFact('hos', h.id, { x: Math.round(h.x), y: Math.round(h.y), weapon: 'gun', state: 'hold', hostage: false, facing: 0 }, '시험', sim.t, 1, true, ''));
    const cops = s.agents.filter((a) => sim.responders[a.rid].dept === 'police');
    expect(cops.length).toBeGreaterThanOrEqual(5);
    const hurt = cops.filter((a) => a !== cmd).slice(0, cops.length - 2);      // 온전한 경관 둘만 남긴다
    for (const b of hurt) { const r = fresh(sim, b, 60); r.status = 'injured'; }
    const posts = (): [number, number][] => s.board.filter((w) => w.kind === 'perimeter' && (w.status === 'open' || w.status === 'active')).map((w) => [w.tile, +w.priority.toFixed(2)]);
    // 지휘관이 그 경관들이 가벼운 일을 한다고 모르면(후퇴 중·안전 구역) 예전처럼: 온전한 경관 둘은 진입조라 출입구를 비운다
    for (const b of hurt) mateKnown(sim, cmd, b, { status: 'safe', bleeding: false });
    commanderThink(sim, s, cmd);
    expect(posts()).toEqual([]);
    // 가벼운 일을 한다고 알면: 다친 경관 몫의 자리가 낮은 우선도로 열린다
    sim.t += 1;
    for (const b of hurt) mateKnown(sim, cmd, b, { status: 'light', bleeding: false });
    commanderThink(sim, s, cmd);
    const p = posts();
    expect(p.length).toBe(Math.min(s.exits.length, hurt.length));
    for (const [, pri] of p) { expect(pri).toBeLessThanOrEqual(0.5); expect(0.9 - pri).toBeGreaterThanOrEqual(0.22); }
  });
  it('가벼운 일로 돌아오는 것은 처치가 끝난 틱의 다음 틱부터다 (처치한 대원의 "안전 구역" 보고보다 늦은 시각이라야 지휘관의 믿음에서 이긴다)', () => {
    const { sim, s, I, of } = crewScene('INJ-order', 'medical', undefined, ['als', 'patrol']);
    assignAll(sim, I, ['als', 'patrol']);
    for (const q of s.agents) { q.nextThink = 1e9; q.task = null; q.planT = 1e9; }
    const b = of('patrol'), r = fresh(sim, b, 60);
    r.status = 'injured'; r.bleed = 0.005; b.status = 'withdrawn';
    const w = workItem(s, 'treatMate', sim.t, { mate: b.rid, max: 1 });
    w.status = 'done'; w.doneAt = sim.t + sim.dt;      // 다음 틱에 끝난 처치
    tickOnce(sim, s);
    expect(b.status, '처치가 끝난 그 틱에는 돌아오지 않는다').toBe('withdrawn');
    tickOnce(sim, s);
    expect(b.status).toBe('active');
  });
});

/** 붕괴 현장에 구조·진압 부대를 내려 세운다 */
const collapseCrew = (): { sim: Sim; s: Scene; I: Incident } => { const { sim, s, I } = crewScene('INJ-rubble', 'collapse', 'std', ['rescue', 'engine']); for (const q of s.agents) { q.nextThink = 1e9; q.task = null; } return { sim, s, I }; };
describe('단계 4c — 대원의 새 규칙: 열 탈진 · 잔해 바닥 추락 · 몸싸움 (§2.3 · §4.2)', () => {
  it('열 탈진: 지친(지구력 ≤ 10) 소방 대원이 열 속(곁 1칸의 불 ≥ 0.3 또는 선 칸의 연기 ≥ 0.4)에 있으면 초당 0.5. 쓰러질 체력(15) 아래로는 가지 않는다. 경찰·지치지 않은 대원·열 밖은 아니다', () => {
    const { sim, s, I, of } = crewScene('INJ-heat', 'fire', undefined, ['engine', 'patrol']);
    for (const q of s.agents) { q.nextThink = 1e9; q.task = null; }
    const f = of('engine'), rf = fresh(sim, f, 80), p = of('patrol'), rp = fresh(sim, p, 80);
    expect(rf.dept).toBe('fire');
    rf.stamina = 5; rp.stamina = 5;
    const fi = tileOf(s, f.x, f.y), pi = tileOf(s, p.x, p.y);
    s.fire.fill(0); s.smoke.fill(0);
    responderHazards(sim, s, I);
    expect([rf.health, rp.health], '열 밖').toEqual([80, 80]);
    s.smoke[fi] = 0.45; s.smoke[pi] = 0.45;
    for (let k = 0; k < 10; k++) responderHazards(sim, s, I);
    rel(80 - rf.health, HEAT_DMG * sim.dt * 10, '연기 속 탈진');
    expect(rp.health, '경찰은 열 탈진 규칙의 대상이 아니다').toBe(80);
    expect(rf.injuries!.map((j) => j.cause)).toEqual(['exhaustion']);
    // 곁 1칸의 불도 열이다
    s.smoke[fi] = 0; const h1 = rf.health;
    const nb = fi + 1 < s.w * s.h ? fi + 1 : fi - 1; s.fire[nb] = 0.35;
    responderHazards(sim, s, I);
    rel(h1 - rf.health, HEAT_DMG * sim.dt, '곁의 불');
    // 지치지 않았으면 아니다
    rf.stamina = HEAT_STAMINA + 1; const h2 = rf.health;
    responderHazards(sim, s, I);
    expect(rf.health).toBe(h2);
    // 쓰러질 체력 아래로는 가지 않는다 (탈진으로 숨지지 않는다)
    rf.stamina = 5; rf.health = DOWN_AT + 0.05;
    for (let k = 0; k < 20; k++) responderHazards(sim, s, I);
    expect(rf.health).toBe(DOWN_AT);
  });
  it('잔해 바닥 추락: 붕괴 현장의 잔해 칸에 새로 들어설 때만 추첨한다(흐름 injury:<현장>:fall). 걸리면 기록이 먼저 남고 그 기록이 원인이다. 대원마다 사건당 한 번', () => {
    const { sim, s, I } = collapseCrew();
    const a = s.agents.find((q) => q.status === 'active')!;
    const r = fresh(sim, a, 90);
    const here = tileOf(s, a.x, a.y);
    // 처음 본 칸은 들어선 것으로 치지 않는다
    s.damage[here] = 1; a.lastTile = undefined;
    sim.tune.hazardMul = 1e6;      // 확률을 1 로 (시험)
    responderHazards(sim, s, I);
    expect(a.fellOnce).toBeFalsy(); expect(a.lastTile).toBe(here);
    responderHazards(sim, s, I);
    expect(a.fellOnce, '같은 칸에 서 있으면 추첨하지 않는다').toBeFalsy();
    // 다른 칸에서 잔해 칸으로 들어선다
    a.lastTile = here + 1;
    const n0 = sim.events.length;
    responderHazards(sim, s, I);
    expect(a.fellOnce).toBe(true);
    const e = sim.events.slice(n0).find((q) => q.text === `${r.name} 대원 잔해 위에서 미끄러져 다침.`)!;
    expect(e).toBeDefined(); expect(e.kind).toBe('hazard'); expect(e.importance).toBe(1);
    const fall = r.injuries!.find((j) => j.cause === 'fall')!;
    const prot = protection(sim, r, sim.units[a.unitId], 'fall');
    expect(fall.dmg).toBeGreaterThanOrEqual(FALL_HIT[0] * (1 - prot) - 1e-9); expect(fall.dmg).toBeLessThanOrEqual(FALL_HIT[1] * (1 - prot) + 1e-9);
    expect([fall.ev, a.hurtEv]).toEqual([e.id, e.id]);
    // 사건당 한 번
    a.lastTile = here + 1; const h = r.health;
    responderHazards(sim, s, I);
    expect(r.health).toBe(h);
    // 활동 중이 아닌 대원(끌려가는 쓰러진 대원)·잔해가 아닌 칸은 추첨하지 않는다
    const b = s.agents.find((q) => q !== a && q.status === 'active')!;
    fresh(sim, b, 90); b.lastTile = here + 1; b.x = a.x; b.y = a.y; b.status = 'down';
    responderHazards(sim, s, I);
    expect(b.fellOnce).toBeFalsy();
    b.status = 'active'; s.damage[here] = 0; b.lastTile = here + 1;
    responderHazards(sim, s, I);
    expect(b.fellOnce).toBeFalsy();
    expect(FALL_P).toBe(0.002);
  });
  it('잔해 바닥 추락은 붕괴 현장에만 있다 — 다른 현장의 잔해 칸(무너진 자리)은 추첨하지 않는다', () => {
    const { sim, s, I, of } = crewScene('INJ-nofall', 'fire', undefined, ['engine']);
    const a = of('engine'); fresh(sim, a, 90);
    const here = tileOf(s, a.x, a.y);
    s.damage[here] = 1; a.lastTile = here + 1; sim.tune.hazardMul = 1e6;
    responderHazards(sim, s, I);
    expect(a.fellOnce).toBeFalsy();
  });
  const fightScene = (seed: string, kind: 'engage' | 'arrest', state: 'fight' | 'surrendered', stunned: boolean) => {
    const { sim, s, I, of } = crewScene(seed, 'armed', 'domestic', ['patrol']);
    for (const q of s.agents) { q.nextThink = 1e9; q.task = null; q.planT = 1e9; }
    const a = of('patrol'), r = fresh(sim, a, 90);
    const h = s.hostiles[0];
    h.weapon = 'knife'; h.state = state; h.stunUntil = stunned ? sim.t + 30 : -1; h.health = 100; h.injuries = undefined;
    a.x = h.x; a.y = h.y; a.taserAt = sim.t;      // 테이저는 막 쏜 뒤다 (몸싸움만 본다)
    const w = workItem(s, kind, sim.t, { hostile: h.id, max: 1 });
    a.task = makeTask(kind, '시험', w); w.status = 'active'; w.assignees.push(a.rid);
    const n0 = sim.events.length;
    for (let k = 0; k < 60 && a.task; k++) act(sim, s, a);
    return { sim, s, I, a, r, h, texts: sim.events.slice(n0).map((e) => e.text) };
  };
  it('몸싸움: 맞서던(fight) 상대를 덮쳐 검거하면 양쪽이 타박상 3~8 (흐름 injury:<현장>:fight — 대원 몫, 용의자 몫 순서). 기록은 "…가 저항해 몸싸움 끝에 검거." 가 검거 문구를 대신한다 — engage 와 arrest', () => {
    for (const kind of ['engage', 'arrest'] as const) {
      const x = fightScene('INJ-fight-' + kind, kind, 'fight', false);
      const tag = kind;
      expect(x.h.state, tag).toBe('arrested');
      const line = `${josa(x.h.label, '이/가')} 저항해 몸싸움 끝에 검거.`;
      expect(x.texts, tag).toContain(line);
      expect(x.texts.some((t) => t === `${x.h.label} 검거!` || t === `${x.h.label} 검거 완료.`), tag).toBe(false);
      // 같은 흐름을 새로 갈라 뽑으면 같은 값이다 (대원 몫 → 용의자 몫)
      const ref = x.sim.rng.fork('injury:' + x.s.id + ':fight');
      const toMe = ref.range(FIGHT_HIT[0], FIGHT_HIT[1]), toHim = ref.range(FIGHT_HIT[0], FIGHT_HIT[1]);
      const mine = x.r.injuries!.find((j) => j.cause === 'blunt')!;
      rel(mine.dmg, toMe, `${tag} 대원`); expect([mine.by, mine.byKind]).toEqual([x.h.id, 'hostile']);
      const his = x.h.injuries!.find((j) => j.cause === 'blunt')!;
      rel(his.dmg, toHim, `${tag} 용의자`); expect([his.by, his.byKind]).toEqual([x.r.id, 'responder']);
      rel(100 - x.h.health, toHim, `${tag} 용의자 체력`);
      const ev = x.sim.events.find((e) => e.text === line)!;
      expect([ev.kind, ev.importance, mine.ev, his.ev]).toEqual(['resolve', 3, ev.id, ev.id]);
    }
  });
  it('몸싸움이 없는 검거: 무력화된(섬광탄·테이저) 상대, 투항한 상대는 맞서지 않는다 — 예전 검거 문구 그대로, 아무도 다치지 않는다', () => {
    const stun = fightScene('INJ-fight-stun', 'engage', 'fight', true);
    expect(stun.texts).toContain(`${stun.h.label} 검거!`);
    expect(stun.r.injuries ?? []).toEqual([]); expect(stun.h.health).toBe(100);
    const sur = fightScene('INJ-fight-sur', 'arrest', 'surrendered', false);
    expect(sur.texts).toContain(`${sur.h.label} 검거 완료.`);
    expect(sur.r.injuries ?? []).toEqual([]); expect(sur.h.health).toBe(100);
  });
});

// ═════════════════════════ 단계 5: 용의자 ═════════════════════════
/** 무장 현장 하나와 그 첫 용의자 (다치지 않은 상태로). 다른 용의자는 검거된 것으로 둔다 (시험 도중 아무도 쏘지 않게) */
function suspectScene(seed: string, variant = 'hostage', kinds: UnitKind[] = []): { sim: Sim; s: Scene; I: Incident; h: Hostile; of: (kind: UnitKind, role?: RoleId) => FieldAgent } {
  const { sim, s, I, of } = crewScene(seed, 'armed', variant, kinds);
  const h = s.hostiles[0];
  h.health = 100; h.injuries = undefined; h.bleed = undefined; h.bleed0 = undefined; h.treatQ = undefined; h.tTreated = undefined; h.tDown = undefined; h.hostageId = -1; h.hidden = false;
  for (const q of s.hostiles) if (q !== h) q.state = 'arrested';
  return { sim, s, I, h, of };
}
const liveTS = (s: Scene, hid: number): WorkItem[] => s.board.filter((w) => w.kind === 'treatSuspect' && w.hostile === hid && (w.status === 'open' || w.status === 'active'));
/** 지휘관의 믿음에 용의자의 상태를 넣는다 */
function hosKnown(sim: Sim, cmd: FieldAgent, h: Hostile, over: Record<string, unknown>): void {
  cmd.beliefs.merge(mkFact('hos', h.id, { x: Math.round(h.x), y: Math.round(h.y), weapon: h.weapon, state: 'down', hostage: false, facing: 0, dead: false, band: 2, tq: 0, where: 'scene', ...over }, '시험', sim.t, 1, true, ''));
}

describe('단계 5 — 용의자의 부상 모델: hurtHostile (§2.6 · §4.1 · §4.6)', () => {
  it('④ 문턱: 체력 100 의 용의자에게 200 의 총상 → 숨지지 않고 HOSTILE_LEFT 범위(흐름 injury:<현장>:down 의 첫 값), 같은 호출 안에서 쓰러진다. 쓰러진(체력 10) 용의자에게 폭발 30 → 숨진다 — SUSPECT_DIED 하나', () => {
    const { sim, s, I, h } = suspectScene('INJ-h4');
    const n0 = sim.events.length;
    hurtHostile(sim, s, I, h, 200, 'gunshot', { by: 3, byKind: 'responder' });
    expect(h.dead).toBeFalsy();
    expect(h.health).toBe(sim.rng.fork('injury:' + s.id + ':down').range(HOSTILE_LEFT[0], HOSTILE_LEFT[1]));
    expect(h.health).toBeGreaterThanOrEqual(HOSTILE_LEFT[0]); expect(h.health).toBeLessThanOrEqual(HOSTILE_LEFT[1]);
    expect([h.state, h.tDown]).toEqual(['down', sim.t]);
    const evs = sim.events.slice(n0);
    expect(evs.map((e) => e.text)).toEqual([`${josa(h.label, '이/가')} 총상을 입고 쓰러졌습니다 — 무력화.`]);
    expect([evs[0].kind, evs[0].importance]).toEqual(['hazard', 3]);
    expect(h.injuries).toEqual([{ cause: 'gunshot', dmg: 100 - h.health, sev: 2, t: sim.t, last: sim.t, by: 3, byKind: 'responder', ev: evs[0].id }]);      // 기록이 없던 상처는 쓰러짐 기록을 원인으로 잇는다
    // 쓰러진 뒤에는 문턱이 없다
    h.health = 10;
    const n1 = sim.events.length;
    const ev = mark(sim, I, '시험 폭발');
    hurtHostile(sim, s, I, h, 30, 'blast', { ev });
    expect([h.dead, h.health, h.tDead, h.deathCause]).toEqual([true, 0, sim.t, 'blast']);
    const died = sim.events.slice(n1).filter((e) => e.problem === 'SUSPECT_DIED');
    expect(died.map((e) => [e.text, e.importance, e.causes])).toEqual([[`${h.label} 생체 반응 소실.`, 3, [ev]]]);
    expect(I.problems.filter((p) => p.code === 'SUSPECT_DIED').map((p) => p.detail)).toEqual([`${h.label} 사망 (폭발, 처치 전)`]);
    // 숨진 사람은 더 다치지 않는다
    const sum = sumDmg(h.injuries);
    hurtHostile(sim, s, I, h, 30, 'blast');
    expect([sumDmg(h.injuries), sim.events.filter((e) => e.problem === 'SUSPECT_DIED').length]).toEqual([sum, 1]);
  });
  it('새 상처의 출혈: 계수 × 피해 × injuryMul × HOSTILE_BLEED (상한 0.15), 처치 전 값도 그 값으로, 받은 처치는 0 으로. 매 틱 피해는 출혈도 문턱도 없다. down 은 한 번에 15 이하로', () => {
    const { sim, s, I, h } = suspectScene('INJ-hbleed');
    hurtHostile(sim, s, I, h, 30, 'gunshot');
    rel(h.bleed!, BLEED_PER_DMG.gunshot * 30 * sim.tune.injuryMul * HOSTILE_BLEED, '출혈');
    expect([h.bleed0, h.treatQ, h.bleedCause]).toEqual([h.bleed, 0, 'gunshot']);
    h.treatQ = 0.4;
    for (let k = 0; k < 5; k++) hurtHostile(sim, s, I, h, 10, 'gunshot');
    expect(h.bleed).toBeLessThanOrEqual(HOSTILE_BLEED_MAX); expect(h.treatQ).toBe(0);
    // 매 틱 피해: 출혈을 만들지 않고, 쓰러지지 않은 용의자도 문턱 없이 숨질 수 있다 (쓰러짐이 먼저 기록된다 — 그 밖의 원인은 imp 2)
    const t = suspectScene('INJ-htick');
    t.h.health = 20;
    hurtHostile(t.sim, t.s, t.I, t.h, 30, 'burn', { tick: true });
    expect([t.h.dead, t.h.bleed ?? 0]).toEqual([true, 0]);
    const fell = t.sim.events.filter((e) => e.text === `${josa(t.h.label, '이/가')} 화상으로 쓰러졌습니다.`);
    expect(fell.map((e) => e.importance)).toEqual([2]);
    // down: 한 번에 15 이하로 (문턱 때문에 0 아래로는 가지 않는다)
    const d = suspectScene('INJ-hdown');
    hurtHostile(d.sim, d.s, d.I, d.h, 5, 'electric', { down: true });
    expect([d.h.health, d.h.state]).toEqual([DOWN_AT, 'down']);
  });
  it('쓰러짐의 상태: 맞서던·투항한 용의자는 down, 검거된 용의자는 arrested 그대로(tDown 만). 숨졌거나·판정 뒤·달아남·차에 실림이면 아무것도 하지 않는다', () => {
    for (const st of ['hold', 'fight', 'flee', 'surrendered', 'arrested'] as const) {
      const { sim, s, I, h } = suspectScene('INJ-hst-' + st);
      h.state = st; h.path = [1, 2]; h.health = 20;
      hurtHostile(sim, s, I, h, 10, 'blunt');
      expect(h.state, st).toBe(st === 'arrested' ? 'arrested' : 'down');
      expect(h.tDown, st).toBe(sim.t);
      if (st !== 'arrested') expect(h.path, st).toBeNull();
    }
    const cases: [string, (h: Hostile, I: Incident) => void][] = [
      ['숨짐', (h) => { h.dead = true; }], ['판정 뒤', (_h, I) => { I.phase = 'closed'; }], ['달아남', (h) => { h.state = 'escaped'; }], ['차에 실림', (h) => { h.where = 'aboard'; }], ['병원', (h) => { h.where = 'hospital'; }],
    ];
    for (const [tag, set] of cases) {
      const { sim, s, I, h } = suspectScene('INJ-hno');
      set(h, I);
      const n0 = sim.events.length;
      hurtHostile(sim, s, I, h, 50, 'gunshot');
      expect([h.health, h.injuries, sim.events.length - n0], tag).toEqual([100, undefined, 0]);
    }
  });
  it('용의자의 체력을 직접 깎는 줄이 남아 있지 않다 — hurtHostile 과 처치(careHostile)만 고친다 (현장을 만드는 자리 제외)', () => {
    for (const f of ['src/sim/field/hazards.ts', 'src/sim/field/executor.ts', 'src/sim/field/rules/injury.ts', 'src/sim/field/rules/crime.ts', 'src/sim/field/rules/disaster.ts', 'src/sim/field/sceneManager.ts', 'src/sim/resources.ts']) {
      expect(readFileSync(f, 'utf8'), f).not.toMatch(/\bh\.health\s*(-|\+)?=(?!=)/);
    }
  });
});

describe('단계 5 — 용의자가 다치는 자리 (§4.2 · §5.1)', () => {
  it('폭발: 용의자도 ×0.8 로 맞는다 (예전에는 건너뛰었다). 쓰러지지 않은 용의자는 큰 폭발에도 한 번에 숨지지 않는다', () => {
    const { sim, s, I, h } = suspectScene('INJ-hblast');
    const ev = mark(sim, I, '시험 폭발');
    blast(sim, s, I, h.x + 1, h.y, 3.6, 34, ev);
    rel(100 - h.health, 34 * 0.8 * (1 - 1 / 4.6), '폭발 피해');
    expect(h.injuries![0]).toMatchObject({ cause: 'blast', ev });
    const big = suspectScene('INJ-hblast2');
    blast(big.sim, big.s, big.I, big.h.x, big.h.y, 3.4, 500, mark(big.sim, big.I));
    expect(big.h.dead).toBeFalsy(); expect(big.h.state).toBe('down');
  });
  it('불·연기·유독 가스·상처 출혈(rules/injury.ts): 구조 대상과 같은 계수. 처치를 받고 붙잡혀 있으면 출혈은 0.6배. 달아났거나 차에 실렸으면 아니다', () => {
    const { sim, s, I, h } = suspectScene('INJ-henv');
    const i = tileOf(s, h.x, h.y);
    s.fire[i] = 0.5; s.smoke[i] = 0.4;
    hostileHazards(sim, s, I);
    rel(100 - h.health, (2.6 * s.fire[i] + 0.36 * s.smoke[i]) * sim.dt, '불 + 연기');      // (칸 값은 Float32 — 다시 읽은 값으로 견준다)
    expect(h.injuries!.map((j) => j.cause).sort()).toEqual(['burn', 'smoke']);
    s.fire[i] = 0; s.smoke[i] = 0;
    // 상처 출혈: 원인은 출혈 원인으로. 처치를 받고 검거돼 있으면 0.6배
    h.bleed = 0.1; h.bleed0 = 0.1; h.bleedCause = 'gunshot';
    let hp = h.health; hostileHazards(sim, s, I); rel(hp - h.health, 0.1 * sim.dt, '출혈 1배');
    h.state = 'arrested'; h.treatQ = 0.5;
    hp = h.health; hostileHazards(sim, s, I); rel(hp - h.health, 0.1 * HOSTILE_CARED * sim.dt, '출혈 0.6배');
    for (const set of [(q: Hostile) => { q.state = 'escaped'; }, (q: Hostile) => { q.where = 'aboard'; }]) {
      const x = suspectScene('INJ-henv2'); x.h.bleed = 0.1; x.h.bleedCause = 'gunshot'; set(x.h);
      hostileHazards(x.sim, x.s, x.I); expect(x.h.health).toBe(100);
    }
    // 가스 누출 현장의 연기는 유독 가스 (0.62 배)
    const g = suspectScene('INJ-hgas'); g.s.kind = 'hazmat'; g.s.smoke[tileOf(g.s, g.h.x, g.h.y)] = 0.5;
    hostileHazards(g.sim, g.s, g.I);
    rel(100 - g.h.health, 0.62 * g.s.smoke[tileOf(g.s, g.h.x, g.h.y)] * g.sim.dt, '유독 가스'); expect(g.h.injuries![0].cause).toBe('toxic');
  });
  it('출혈로 숨진다: 쓰러진 용의자의 출혈이 체력을 다 깎으면 SUSPECT_DIED 하나 — 그 원인 기록은 쓰러짐 기록으로 거슬러 간다. 판정 뒤에는 멈춘다 (세계 규칙 첫 줄)', () => {
    const { sim, s, I, h } = suspectScene('INJ-hbleedout');
    hurtHostile(sim, s, I, h, 200, 'gunshot', { by: 1, byKind: 'responder' });
    const down = sim.events.find((e) => e.text.includes('총상을 입고 쓰러졌습니다'))!;
    h.bleed = 0.15;
    for (let k = 0; k < 2000 && !h.dead; k++) hostileHazards(sim, s, I);
    expect(h.dead).toBe(true); expect(h.deathCause).toBe('gunshot');
    const died = sim.events.filter((e) => e.problem === 'SUSPECT_DIED');
    expect(died.length).toBe(1); expect(died[0].causes).toEqual([down.id]);
    const x = suspectScene('INJ-hbleedclosed');
    x.h.bleed = 0.15; x.h.bleedCause = 'gunshot'; x.I.phase = 'closed';
    tickOnce(x.sim, x.s);
    expect(x.h.health).toBe(100);
  });
  it('사격: 대원의 명중은 hurtHostile(총상, 가해자 = 쏜 대원) — 쓰러짐은 쏜 그 틱에 서고, 쓰러지는 순간 숨진 용의자는 없다(문턱). 테이저는 감전 2 만 — 체력을 1 아래로 내리지 않는다', () => {
    const rows = shooter.flatMap((sim) => scenesOf(sim).flatMap((s) => s.hostiles.flatMap((h) => (h.injuries ?? []).filter((j) => j.cause === 'gunshot' && j.byKind === 'responder').map((j) => ({ sim, j })))));
    expect(rows.length).toBeGreaterThan(0);
    for (const { sim, j } of rows) expect(sim.responders[j.by], '쏜 대원').toBeTruthy();
    for (const sim of shooter) for (const s of scenesOf(sim)) for (const h of s.hostiles) if (h.dead) expect(h.tDead, `${sim.seed} ${h.label}`).toBeGreaterThan(h.tDown!);
    expect(readFileSync('src/sim/field/executor.ts', 'utf8')).toMatch(/Math\.min\(TASER_HIT, h\.health - 1\), 'electric'/);
  });
});

describe('단계 5 — 용의자의 상태를 아는 길: hos 사실 (§4.3 · §6.1)', () => {
  it('hosFact(…, d): 숨졌는지는 2칸 안에서만 안다. 중증도는 보이는 그대로(위중까지), 받은 처치·있는 곳도 적는다. 상태 글은 쓰러짐 · 사망', () => {
    const { sim, s, h } = suspectScene('INJ-hfact');
    h.state = 'down'; h.health = 0; h.dead = true; h.tDown = 1; h.treatQ = 0.3;
    const far = hosFact(sim, s, h, '시험', 5).value, near = hosFact(sim, s, h, '시험', 1.5).value;
    expect([far.dead, far.band, far.tq, far.where]).toEqual([false, 2, 1, 'scene']);
    expect([near.dead, near.band]).toEqual([true, 3]);
    expect(hosFact(sim, s, h, '시험', 5).text).toContain('쓰러짐'); expect(hosFact(sim, s, h, '시험', 1).text).toContain('사망');
    h.dead = false; h.health = 55; h.state = 'arrested'; h.tDown = undefined; h.treatQ = 0.7;
    expect(hosFact(sim, s, h, '시험', 9).value).toMatchObject({ band: 1, tq: 2 });
  });
  it('perceive: 차에 실린 용의자는 보지 않고, 숨진 줄 안 뒤에는 먼 관찰로 되돌리지 않는다', () => {
    const { sim, s, h, of } = suspectScene('INJ-hperc', 'hostage', ['patrol']);
    const a = of('patrol');
    a.x = h.x; a.y = h.y;
    h.state = 'down'; h.health = 0; h.dead = true; h.tDown = 1;
    perceive(sim, s, a);
    expect(a.beliefs.val<any>('hos', h.id)?.dead).toBe(true);
    // 3칸 밖의 보이는 자리에서 다시 본다
    let moved = false;
    for (let y = 0; y < s.h && !moved; y++) for (let x = 0; x < s.w && !moved; x++) {
      const d = Math.hypot(x - h.x, y - h.y);
      if (d <= 3 || d > 12 || !staticPass(s.tiles[y * s.w + x]) || !los(s, x, y, h.x, h.y)) continue;
      a.x = x; a.y = y; moved = true;
    }
    expect(moved, '시험 자리').toBe(true);
    perceive(sim, s, a);
    expect(a.beliefs.val<any>('hos', h.id)?.dead, '멀리서 다시 보아도 숨진 그대로').toBe(true);
    const b = suspectScene('INJ-hperc2', 'hostage', ['patrol']);
    const pa = b.of('patrol'); pa.x = b.h.x; pa.y = b.h.y;
    b.h.where = 'aboard';
    perceive(b.sim, b.s, pa);
    expect(pa.beliefs.get('hos', b.h.id)).toBeUndefined();
  });
});

describe('단계 5 — 처치와 이송: treatSuspect (§4.3)', () => {
  it('fitFor: 경찰은 언제든, 구급대원은 안전 확보 뒤에만, 소방은 아니다. 걸을 수 있는 다친 대원은 맡지 않는다(가벼운 일이 아니다). 태울 차가 정해진 일은 그 차의 대원만, 기본 처치 뒤는 전문 처치를 할 수 있는 대원만', () => {
    const { sim, s, h, of } = suspectScene('INJ-tsfit', 'hostage', ['patrol', 'als', 'engine']);
    const cop = of('patrol'), medic = of('als'), ff = of('engine');
    const als = sim.units.find((q) => q.kind === 'als')!;
    const w = workItem(s, 'treatSuspect', sim.t, { hostile: h.id, max: 1 });
    for (const q of [cop, medic, ff]) hosKnown(sim, q, h, {});
    s.secureAt = -1;
    expect(fitFor(sim, s, cop, w)).toBeGreaterThan(0);
    expect(fitFor(sim, s, medic, w), '안전 확보 전').toBe(0);
    expect(fitFor(sim, s, ff, w)).toBe(0);
    s.secureAt = sim.t;
    expect(fitFor(sim, s, medic, w), '안전 확보 뒤').toBeGreaterThan(0);
    sim.responders[cop.rid].status = 'injured';
    expect(fitFor(sim, s, cop, w), '다친 경관').toBe(0);
    sim.responders[cop.rid].status = 'ok';
    expect(LIGHT_WORK.has('treatSuspect')).toBe(false);
    // 태울 차가 정해진 일 + 이미 기본 처치를 받았다: 그 차의 대원만
    for (const q of [cop, medic]) hosKnown(sim, q, h, { tq: 1 });
    w.prop = als.id;
    expect(fitFor(sim, s, medic, w)).toBeGreaterThan(0);
    expect(fitFor(sim, s, cop, w)).toBe(0);
    w.prop = -1;
    expect(fitFor(sim, s, cop, w), '기본 처치 뒤 — 경찰은 더 나은 처치를 하지 못한다').toBe(0);
  });
  it('지휘관: 맞서는 용의자가 없을 때 쓰러진·다친 용의자마다 한 항목(0.74 + 0.06 × band). 태울 차는 더 무겁거나 같은 사람이 기다리지 않을 때만. 숨짐·실림·맞서는 용의자가 있으면 거둔다', () => {
    const { sim, s, I, h } = suspectScene('INJ-tsord', 'hostage', ['patrol', 'als']);
    assignAll(sim, I, ['patrol', 'als']);
    const cmd = s.agents.find((a) => a.isCommander)!;
    const als = sim.units.find((q) => q.kind === 'als')!;
    s.sizeupDone = true; s.mismatchLogged = true; s.secureAt = sim.t;
    for (const q of s.agents) { q.nextThink = 1e9; q.task = null; }
    for (const q of s.hostiles) if (q !== h) hosKnown(sim, cmd, q, { state: 'arrested', band: 0 });
    // 아직 끝낼 수 없는 현장으로 둔다 (불이 남았다 — 시험 도중 종료가 선언되지 않게)
    cmd.beliefs.merge(mkFact('fire', 0, 0.5, '시험', sim.t, 1, true, ''));
    hosKnown(sim, cmd, h, { band: 2 });
    commanderThink(sim, s, cmd); commanderThink(sim, s, cmd);
    const items = liveTS(s, h.id);
    expect(items.length, '대상당 한 항목').toBe(1);
    expect(items[0].priority).toBeCloseTo(0.86, 12); expect([items[0].max, items[0].prop]).toEqual([1, als.id]);
    // 같은 중증도의 구조 대상이 기다리면 처치만 (열린 항목의 태울 차를 고쳐 쓴다 — 새 항목을 만들지 않는다)
    items[0].status = 'open'; items[0].assignees.length = 0;
    cmd.beliefs.merge(mkFact('cas', s.casualties[0].id, { x: 3, y: 3, mob: 'immobile', band: 2, where: 'safe', treated: false, trappedDone: true, tq: 0 }, '시험', sim.t, 1, true, ''));
    commanderThink(sim, s, cmd);
    expect(liveTS(s, h.id).map((w) => [w.id, w.prop])).toEqual([[items[0].id, -1]]);
    // 맞서는 용의자가 있다고 알면 거둔다 (위협이 끝난 뒤의 일이다)
    const other = addHostile(s, h.x, h.y, 'gun', 0.5, 0.5, false, 1e9);
    sim.t += 1; hosKnown(sim, cmd, other, { state: 'hold', band: 0 }); commanderThink(sim, s, cmd);
    expect(liveTS(s, h.id).length).toBe(0);
    other.state = 'arrested'; sim.t += 1; hosKnown(sim, cmd, other, { state: 'arrested', band: 0 }); commanderThink(sim, s, cmd);
    expect(liveTS(s, h.id).length).toBe(1);
    // 숨졌다·실렸다고 알면 거둔다
    sim.t += 1; hosKnown(sim, cmd, h, { dead: true, band: 3 }); commanderThink(sim, s, cmd); expect(liveTS(s, h.id).length).toBe(0);
    sim.t += 1; hosKnown(sim, cmd, h, { dead: false, where: 'aboard' }); commanderThink(sim, s, cmd); expect(liveTS(s, h.id).length).toBe(0);
    // 다치지 않은(경상) 검거 용의자에게는 내지 않는다
    sim.t += 1; hosKnown(sim, cmd, h, { state: 'arrested', band: 0, where: 'scene' }); commanderThink(sim, s, cmd); expect(liveTS(s, h.id).length).toBe(0);
    expect(hosNeedsCare({ state: 'arrested', band: 0 })).toBe(false); expect(hosNeedsCare({ state: 'down', band: 0 })).toBe(true); expect(hosNeedsCare({ state: 'arrested' }), '모르면 위중').toBe(true);
  });
  it('맡을 사람이 없으면 열지 않는다 (경찰도 구급대원도 없는 현장 — 열어 두면 종료를 막는다)', () => {
    const { sim, s, I, h } = suspectScene('INJ-tsnone', 'hostage', ['engine']);
    assignAll(sim, I, ['engine']);
    const cmd = s.agents.find((a) => a.isCommander)!;
    s.sizeupDone = true; s.secureAt = sim.t;
    for (const q of s.agents) { q.nextThink = 1e9; q.task = null; }
    for (const q of s.hostiles) hosKnown(sim, cmd, q, q === h ? { band: 2 } : { state: 'arrested', band: 0 });
    commanderThink(sim, s, cmd);
    expect(liveTS(s, h.id).length).toBe(0);
  });
  it('실행기: 처치하고(같은 식 — 체력 +8q, 출혈 × (1 − 0.9q), tTreated), 태울 차가 내 차이고 자리가 있으면 차까지 옮겨 태운다. 병원에서 인계되고 그 문구가 병원 인계 규칙(T4)에 맞는다', () => {
    const run = (prop: boolean) => {
      const { sim, s, I, h, of } = suspectScene('INJ-tsrun', 'hostage', ['als', 'patrol']);
      assignAll(sim, I, ['als', 'patrol']);
      const als = sim.units.find((q) => q.kind === 'als')!;
      for (const q of s.agents) { q.nextThink = 1e9; q.task = null; q.planT = 1e9; }
      const medic = of('als');
      s.secureAt = sim.t;
      h.state = 'down'; h.health = 12; h.tDown = sim.t; h.bleed = 0.08; h.bleed0 = 0.08; h.bleedCause = 'gunshot'; h.x = s.staging.x + 2; h.y = s.staging.y;
      const w = workItem(s, 'treatSuspect', sim.t, { hostile: h.id, prop: prop ? als.id : -1, max: 1 });
      medic.task = makeTask('treatSuspect', '시험', w); w.status = 'active'; w.assignees.push(medic.rid);
      const n0 = sim.events.length;
      for (let n = 0; n < 600 && medic.task; n++) tickOnce(sim, s);
      return { sim, s, I, h, als, medic, texts: sim.events.slice(n0) };
    };
    const t = run(false);
    const done = t.texts.find((e) => e.text === `${t.h.label} 응급 처치 완료.`)!;
    expect(done).toBeTruthy(); expect(done.rid).toBe(t.medic.rid);
    expect(t.h.tTreated).toBeDefined(); expect(t.h.treatQ ?? 0).toBeGreaterThan(0);
    expect(t.h.bleed!).toBeLessThan(0.08 * 0.9);
    expect([t.h.where ?? 'scene', t.als.aboard ?? []]).toEqual(['scene', []]);
    expect(t.medic.beliefs.val<any>('hos', t.h.id)?.tq).toBeGreaterThan(0);
    const l = run(true);
    expect(l.texts.map((e) => e.text)).toContain(`${josa(l.h.label, '을/를')} ${l.als.callsign}에 태워 병원으로.`);
    expect(l.h.where).toBe('aboard');
    expect(l.als.aboard!.map((e) => [e.kind, e.id])).toEqual([['suspect', l.h.id]]);
    expect(l.als.firstLoadAt).toBeDefined(); expect(seatsUsed(l.sim, l.als)).toBe(1);
    expect(l.medic.beliefs.val<any>('hos', l.h.id)?.where).toBe('aboard');
    // 실린 뒤에는 피를 흘리지 않는다
    const hp = l.h.health; hostileHazards(l.sim, l.s, l.I); expect(l.h.health).toBe(hp);
    // 출발 지시·출발 기록의 글: 실은 사람마다
    expect(riderText(l.als)).toBe('용의자 1명');
    expect(riderText({ patients: [1], aboard: [{ kind: 'mate' }, { kind: 'suspect' }] })).toBe('환자 1명·부상 대원 1명·용의자 1명');
    expect(riderText({ patients: [], aboard: [{ kind: 'mate' }] })).toBe('부상 대원 1명');
    expect(riderText({ patients: [] })).toBe('환자 0명');
    // 병원 인계: 용의자만 태운 차 (patientsIncident 가 없다)
    l.als.state = 'hospital'; l.als.timer = 0; l.als.nodeId = l.sim.city.facilities.find((f) => f.kind === 'hospital')!.nodeId;
    const n1 = l.sim.events.length;
    tickUnits(l.sim);
    const hand = l.sim.events.slice(n1).find((e) => /인계 완료/.test(e.text))!;
    expect(hand.text).toMatch(/용의자 1명 인계 완료\.$/); expect(PHRASE.T4.test(hand.text)).toBe(true);
    expect([l.h.where, l.als.aboard]).toEqual(['hospital', []]);
  });
  it('처치할 수 없으면(숨졌다) 본 대로 다시 알리고 끝낸다 (낡은 믿음으로 같은 지시가 되풀이되지 않게)', () => {
    const { sim, s, h, of } = suspectScene('INJ-tsgone', 'hostage', ['patrol']);
    const cop = of('patrol');
    for (const q of s.agents) { q.nextThink = 1e9; q.task = null; q.planT = 1e9; }
    h.state = 'down'; h.dead = true; h.health = 0; h.tDown = 1; h.tDead = 2;
    cop.x = h.x; cop.y = h.y;
    const w = workItem(s, 'treatSuspect', sim.t, { hostile: h.id, max: 1 });
    cop.task = makeTask('treatSuspect', '시험', w); w.status = 'active'; w.assignees.push(cop.rid);
    act(sim, s, cop);
    expect(cop.task).toBeNull(); expect(w.status).toBe('done');
    expect(cop.beliefs.val<any>('hos', h.id)?.dead).toBe(true);
    expect(cop.outbox.some((f) => f.type === 'hos' && f.id === h.id), '강제 보고').toBe(true);
  });
});

describe('단계 5 — 자해 경로는 꺼져 있다 (SELF_HARM = 0, 사용자 결정 2026-11-15)', () => {
  it('값은 0 이다. 조건이 맞는 용의자도 투항한다 — 추첨은 한 번만(자기 흐름 injury:<현장>:self 에서), 다른 흐름은 건드리지 않는다', () => {
    expect(SELF_HARM).toBe(0);
    const { sim, s, I, h } = suspectScene('INJ-self');
    h.weapon = 'gun'; h.aggression = 0.9; h.morale = 0.1; h.state = 'hold'; h.stunUntil = -1; h.hostageId = -1;
    tickHostiles(sim, s, I);
    expect(h.state).toBe('surrendered'); expect(h.selfHarmRolled).toBe(true); expect(h.health).toBe(100);
    expect(sim.events.some((e) => e.text.includes('스스로를 해쳤습니다'))).toBe(false);
    // 같은 흐름을 새로 갈라 한 번 뽑은 뒤의 값이, 현장이 쓴 흐름의 다음 값과 같다 (꼭 한 번만 뽑았다)
    const ref = sim.rng.fork('injury:' + s.id + ':self'); ref.next();
    expect(injuryRng(sim, s, 'self').next()).toBe(ref.next());
    // 다시 투항 판정이 돌아도 추첨하지 않는다 (용의자마다 한 번)
    h.state = 'hold'; h.morale = 0.1;
    const ref2 = sim.rng.fork('injury:' + s.id + ':self'); ref2.next(); ref2.next();
    tickHostiles(sim, s, I);
    expect(injuryRng(sim, s, 'self').next()).toBe(ref2.next());
  });
});

describe('7 · 9. 용의자 — 총격범 교대에서 (§11-7 · §11-9)', () => {
  it('7. 쓰러진 용의자: 숨졌으면 SUSPECT_DIED 하나, 그 시각은 쓰러진 시각보다 늦다(즉사 없음). 처치 기록의 대원은 경찰이거나 안전 확보 뒤의 구급대원이다', () => {
    let downN = 0, treated = 0;
    for (const sim of shooter) for (const s of scenesOf(sim)) {
      const I = sim.incidents[s.incidentId];
      for (const h of s.hostiles) {
        if (h.tDown === undefined) continue;
        downN++;
        const died = sim.events.filter((e) => e.incidentId === I.id && e.problem === 'SUSPECT_DIED' && e.text === `${h.label} 생체 반응 소실.`);
        if (h.dead) { expect(died.length, `${sim.seed} ${I.code} ${h.label}`).toBe(1); expect(h.tDead!, `${sim.seed} ${I.code}`).toBeGreaterThan(h.tDown); }
        else expect(died.length).toBe(0);
      }
      for (const e of sim.events) {
        if (e.incidentId !== I.id || !/^용의자 \d+ 응급 처치 완료\.$/.test(e.text)) continue;
        treated++;
        const r = sim.responders[e.rid];
        const ok = r.dept === 'police' || (r.dept === 'ems' && (s.kind !== 'armed' || (s.secureAt >= 0 && e.t >= s.secureAt)));
        expect(ok, `${sim.seed} ${I.code} ${r.name}(${r.dept}) t=${e.t} secure=${s.secureAt}`).toBe(true);
      }
    }
    expect(downN, '표본: 쓰러진 용의자가 있다').toBeGreaterThan(0);
    expect(treated, '표본: 처치를 받은 용의자가 있다').toBeGreaterThan(0);
  });
  it('9. 숨진 용의자마다 SUSPECT_DIED 기록이 정확히 하나, 그 시각은 사건의 종료 시각 이전이고 숨진 시각과 같다 (모든 교대)', () => {
    for (const sim of all()) for (const s of scenesOf(sim)) {
      const I = sim.incidents[s.incidentId];
      for (const h of s.hostiles) {
        const died = sim.events.filter((e) => e.incidentId === I.id && e.problem === 'SUSPECT_DIED' && e.text === `${h.label} 생체 반응 소실.`);
        expect(died.length, `${sim.seed} ${I.code} ${h.label}`).toBe(h.dead ? 1 : 0);
        if (h.dead) { expect(died[0].t).toBe(h.tDead); expect(died[0].t).toBeLessThanOrEqual(I.closedAt); expect(h.deathCause).toBeTruthy(); }
      }
    }
  });
  it('보고서 문장: 숨진 용의자는 기록(쓰러짐·처치·숨진 시각, 부상 기록)으로 — 위협이 끝난 뒤면 그 뒤 얼마 동안 돌보지 못했는지를 말한다', () => {
    const { sim, s, I, h } = suspectScene('INJ-hdeb');
    s.secureAt = 100; h.state = 'down'; h.tDown = 90; h.dead = true; h.tDead = 180; h.health = 0; h.deathCause = 'gunshot';
    h.injuries = [{ cause: 'gunshot', dmg: 100, sev: 3, t: 90, last: 180, by: 0, byKind: 'responder', ev: -1 }];
    I.problems.push({ code: 'SUSPECT_DIED', t: 180, eventId: -1, detail: `${h.label} 사망 (총상, 처치 전)`, recovered: false, recoveryText: '', times: undefined });
    I.phase = 'closed'; I.closedAt = 200;
    const res = evaluate(sim, I, 'resolved');
    expect(res.analysis).toContain(`${josa(h.label, '은/는')} 교전 중 총상을 입고 쓰러졌고, 현장 안전 확보 뒤 ${fmtSec(80)} 동안 처치를 받지 못하고 숨졌습니다.`);
    h.tTreated = 120; h.tDead = 95;
    expect(evaluate(sim, I, 'resolved').analysis).toContain(`${josa(h.label, '은/는')} 교전 중 총상을 입고 쓰러졌고, 처치를 받았지만 숨졌습니다.`);
    expect(PROBLEM_LABEL.SUSPECT_DIED).toBe('용의자 사망');
  });
});

describe('단계 5 — 고침: 숨진 용의자는 가서 보고 알린다 · 지시의 상한 (같은 지시가 수백 번 되풀이되던 것)', () => {
  it('맡은 용의자가 멀리서 숨져 있으면 곁(2칸 안)까지 가서 숨진 것을 알리고 끝낸다 — 멀리서 본 대로 알리면 지휘관은 처치가 필요한 줄 알고 지시를 되풀이한다', () => {
    const { sim, s, h, of } = suspectScene('INJ-tsfar', 'hostage', ['patrol']);
    const cop = of('patrol');
    for (const q of s.agents) { q.nextThink = 1e9; q.task = null; q.planT = 1e9; }
    h.state = 'down'; h.dead = true; h.health = 0; h.tDown = 1; h.tDead = 2; h.x = s.staging.x + 6; h.y = s.staging.y;
    cop.x = s.staging.x; cop.y = s.staging.y;
    const w = workItem(s, 'treatSuspect', sim.t, { hostile: h.id, max: 1 });
    cop.task = makeTask('treatSuspect', '시험', w); w.status = 'active'; w.assignees.push(cop.rid);
    act(sim, s, cop);
    expect(cop.task, '멀리서 바로 끝내지 않는다').not.toBeNull();
    for (let n = 0; n < 200 && cop.task; n++) act(sim, s, cop);
    expect(cop.task).toBeNull(); expect(w.status).toBe('done');
    expect(Math.hypot(cop.x - h.x, cop.y - h.y)).toBeLessThanOrEqual(2);
    expect(cop.beliefs.val<any>('hos', h.id)?.dead).toBe(true);
  });
  it('한 용의자에게 낸 지시를 TS_MAX_DONE 번 마쳤으면 더 내지 않는다', () => {
    const { sim, s, I, h } = suspectScene('INJ-tscap', 'hostage', ['patrol', 'als']);
    assignAll(sim, I, ['patrol', 'als']);
    const cmd = s.agents.find((a) => a.isCommander)!;
    s.sizeupDone = true; s.mismatchLogged = true; s.secureAt = sim.t;
    for (const q of s.agents) { q.nextThink = 1e9; q.task = null; }
    for (const q of s.hostiles) if (q !== h) hosKnown(sim, cmd, q, { state: 'arrested', band: 0 });
    cmd.beliefs.merge(mkFact('fire', 0, 0.5, '시험', sim.t, 1, true, ''));
    hosKnown(sim, cmd, h, { band: 2 });
    commanderThink(sim, s, cmd);
    expect(liveTS(s, h.id).length).toBe(1);
    for (let k = 0; k < TS_MAX_DONE; k++) {
      for (const w of liveTS(s, h.id)) { w.status = 'done'; w.doneAt = sim.t; }
      commanderThink(sim, s, cmd);
    }
    expect(liveTS(s, h.id).length, '상한').toBe(0);
    expect(s.board.filter((w) => w.kind === 'treatSuspect' && w.hostile === h.id && w.status === 'done').length).toBe(TS_MAX_DONE);
  });
});

// ═════════════════════════ 검토에서 고친 것 ═════════════════════════
describe('검토 — 멀리서 다시 본 쓰러진 용의자는 곁에서 본 보고를 덮지 않는다 (숨진 용의자에게 처치 지시가 되풀이되던 것)', () => {
  /** 2칸 밖에서 보이는 자리에 쓰러진 용의자를 둔다 */
  const setup = (seed: string) => {
    const { sim, s, h, of } = suspectScene(seed, 'hostage', ['patrol']);
    const cop = of('patrol');
    for (const q of s.agents) { q.nextThink = 1e9; q.task = null; q.planT = 1e9; }
    cop.x = s.staging.x; cop.y = s.staging.y;
    h.x = s.staging.x + 6; h.y = s.staging.y;
    return { sim, s, h, cop };
  };
  it('지휘관이 6칸 밖에서 쓰러진 용의자를 매 틱 다시 보고 있어도, 곁에서 숨진 것을 본 대원의 무전 보고(1.2초 늦게 닿는다)를 받아들인다', () => {
    const { sim, s, h, cop } = setup('INJ-rv-far');
    expect(los(s, cop.x, cop.y, h.x, h.y)).toBe(true);
    h.state = 'down'; h.tDown = sim.t; h.health = 5;
    perceive(sim, s, cop);
    expect(cop.beliefs.val<any>('hos', h.id)).toMatchObject({ state: 'down', dead: false });
    sim.t += 1;
    h.dead = true; h.health = 0; h.tDead = sim.t;
    const near = hosFact(sim, s, h, '곁의 대원', 1);      // 곁(2칸 안)에서 본 대원의 보고 — 숨진 것을 안다
    expect(near.value.dead).toBe(true);
    for (let k = 0; k < 6; k++) { sim.t += 0.2; perceive(sim, s, cop); }      // 무전이 닿는 동안 지휘관은 멀리서 계속 본다 (숨진 것은 보이지 않는다)
    expect(cop.beliefs.val<any>('hos', h.id)?.dead).toBe(false);
    cop.beliefs.merge(BeliefStore.relay(near));      // 무전이 닿는다 (deliverRadio 와 같은 합치기)
    expect(cop.beliefs.val<any>('hos', h.id)?.dead, '곁에서 본 보고가 이긴다 — 예전에는 먼 관찰의 새 시각에 밀려 버려졌다').toBe(true);
    sim.t += 0.2; perceive(sim, s, cop);
    expect(cop.beliefs.val<any>('hos', h.id)?.dead, '먼 관찰로 되돌리지 않는다').toBe(true);
  });
  it('검거된 채 숨진 용의자도 같다. 달라진 것(처치·상태)이 보이면 멀리서도 새로 안다', () => {
    const { sim, s, h, cop } = setup('INJ-rv-arr');
    h.state = 'arrested'; h.tDown = sim.t; h.health = 6;
    perceive(sim, s, cop);
    const t0 = cop.beliefs.get('hos', h.id)!.t;
    sim.t += 2; perceive(sim, s, cop);
    expect(cop.beliefs.get('hos', h.id)!.t, '달라진 것이 없으면 시각을 덮지 않는다').toBe(t0);
    h.treatQ = 0.3; h.tTreated = sim.t;
    sim.t += 0.2; perceive(sim, s, cop);
    expect(cop.beliefs.val<any>('hos', h.id)?.tq, '받은 처치는 멀리서도 보인다').toBe(1);
  });
  it('맡은 용의자가 이미 차에 실려 갔으면(실은 대원의 보고가 아직 닿지 않았다) 본 대로 강제로 알리고 끝낸다 — 알리지 않고 끝내면 지휘관이 같은 지시를 되풀이한다', () => {
    const { sim, s, h, cop } = setup('INJ-rv-abd');
    h.state = 'arrested'; h.tDown = sim.t; h.health = 20; h.treatQ = 0.7; h.where = 'aboard';
    const w = workItem(s, 'treatSuspect', sim.t, { hostile: h.id, max: 1 });
    cop.task = makeTask('treatSuspect', '시험', w); w.status = 'active'; w.assignees.push(cop.rid);
    act(sim, s, cop);
    expect(cop.task).toBeNull(); expect(w.status).toBe('done');
    expect(cop.beliefs.val<any>('hos', h.id)?.where).toBe('aboard');
    expect(cop.outbox.some((f) => f.type === 'hos' && f.id === h.id && f.value.where === 'aboard'), '강제 보고가 대기열에 있다').toBe(true);
    expect(hosNeedsCare(cop.beliefs.val<any>('hos', h.id)), '그 보고를 받은 지휘관은 더 내지 않는다').toBe(false);
  });
  it('맞서는 용의자는 멀리서 볼 때마다 새로 안다 (자리·시각) — 이 규칙은 쓰러졌거나 붙잡혀 움직이지 않는 용의자만', () => {
    const { sim, s, h, cop } = setup('INJ-rv-act');
    h.state = 'hold';
    perceive(sim, s, cop);
    const t0 = cop.beliefs.get('hos', h.id)!.t;
    sim.t += 2;
    perceive(sim, s, cop);
    expect(cop.beliefs.get('hos', h.id)!.t).toBeGreaterThan(t0);
  });
});

describe('검토 — 보지 못한 용의자를 부상자로 세지 않는다 (풀려난 인질의 제보)', () => {
  it('hosNeedsCare: 중증도를 모르는 맞서는 용의자(제보뿐)는 아니다. 보고 알게 된 중상 이상·쓰러짐·붙잡힘(모르면 위중)은 그대로', () => {
    expect(hosNeedsCare({ state: 'hold' }), '풀려난 인질의 말 — 다쳤는지 모른다').toBe(false);
    expect(hosNeedsCare({ state: 'fight' })).toBe(false);
    expect(hosNeedsCare({ state: 'hold', band: 1 }), '다친 채 맞서는 것을 보았다').toBe(true);
    expect(hosNeedsCare({ state: 'arrested' }), '붙잡힌 용의자는 모르면 위중').toBe(true);
    expect(hosNeedsCare({ state: 'down' })).toBe(true);
  });
  it('다수 사상자 다시 세기: 대형 인질극에서 풀려난 인질이 알린 용의자는 부상자 수에 들지 않는다', () => {
    const { sim, s, I } = suspectScene('INJ-rv-mci', 'siege', ['patrol']);
    const cmd = s.agents.find((a) => a.isCommander)!;
    for (const q of s.agents) { q.nextThink = 1e9; q.task = null; }
    s.sizeupDone = true; s.mismatchLogged = true;
    // 구급차 두 대가 오는 중이다 (지휘관의 다른 구급 요청 규칙 — 구급 부대 없음 · 한 대로 감당 불가 — 이 먼저 나가 이 규칙을 가리지 않게)
    for (const u of sim.units.filter((q) => q.kind === 'als' || q.kind === 'bls').slice(0, 2)) { u.state = 'enroute'; u.incidentId = I.id; I.assigned.push(u.id); }
    expect(I.assigned.filter((uid) => sim.units[uid].caps.ems >= 0.7).length).toBe(2);
    // 구조 대상 넷(중상)을 알고, 용의자 둘은 풀려난 인질의 말로만 안다 (rules/crime.ts 의 사실 — 중증도 칸이 없다)
    for (let k = 0; k < 4; k++) cmd.beliefs.merge(mkFact('cas', 100 + k, { x: s.staging.x, y: s.staging.y, mob: 'immobile', band: 1, where: 'safe', treated: true, trappedDone: true, tq: 1, water: false }, '시험', sim.t, 1, true, ''));
    for (const h of s.hostiles.slice(0, 2)) cmd.beliefs.merge(mkFact('hos', h.id, { x: Math.round(h.x), y: Math.round(h.y), weapon: 'gun', state: 'hold', hostage: false, facing: 0 }, '풀려난 인질', sim.t, 0.8, false, ''));
    const n0 = sim.events.length;
    commanderThink(sim, s, cmd);
    expect(sim.events.slice(n0).some((e) => /대원·용의자 포함/.test(e.text)), '보지 못한 용의자를 세면 넷 + 둘 = 여섯이라 구급을 더 부른다').toBe(false);
    void I;
  });
});

describe('검토 — 시험 8 의 빠졌던 줄: orders/injury.ts 는 명부에서 소속·분야·이름만 읽는다 (§11-8 셋째 줄)', () => {
  it('sim.responders[…] 뒤에는 .unitId · .dept · .name 만 온다 (변수에 담아 읽는 것도 막힌다)', () => {
    const src = readFileSync('src/sim/field/orders/injury.ts', 'utf8').split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
    expect(/responders\[[^\]]*\](?!\.(unitId|dept|name)\b)/.test(src)).toBe(false);
    expect(/responders\[[^\]]*\]\.unitId/.test(src), '이 파일은 실제로 명부를 읽는다 — 검사가 헛돌지 않는다').toBe(true);
  });
});

// ═════════════════════════ 단계 6: 판정·보고서 ═════════════════════════
describe('단계 6 — 사건 판정 (§7.1)', () => {
  it('③ 순직은 RESPONDER_HURT 와 따로 센다 — 앞선 부상 기록 없이 순직해도 respondersKilled = 1, 벌점 3 (다른 문제가 없어도 부분 성공)', () => {
    const { sim, s, I, of } = crewScene('INJ-ev-kill', 'medical', undefined, ['als']);
    const a = of('als', 'emt'), r = fresh(sim, a, 30);
    r.status = 'injured';      // 앞선 RESPONDER_HURT 기록이 없는 다친 대원
    hurtResponder(sim, s, I, a, 60, 'gunshot', { ev: mark(sim, I) });
    tickOnce(sim, s);
    expect(r.dead).toBe(true);
    const res = evaluate(sim, I, 'resolved');
    expect([res.respondersKilled, res.respondersDown, res.respondersHurt]).toEqual([1, 0, 0]);
    expect(res.grade).not.toBe('success');
    expect(res.headline).toContain('대원 1명 순직');
    expect(res.analysis[0].startsWith('순직: ') || res.analysis.some((x) => x.startsWith('순직: '))).toBe(true);
  });
  it('쓰러짐·부상·순직의 셈: 순직한 대원은 쓰러짐으로 세지 않는다 (예전에는 status down 이라 1.5 로 셌다). 한 줄 요약은 "대원 n명 부상, m명 순직"', () => {
    const { sim, s, I, of } = crewScene('INJ-ev-mix', 'medical', undefined, ['als', 'patrol']);
    const hurtOne = of('patrol', 'patrolLead'), dying = of('als', 'emt');
    const r1 = fresh(sim, hurtOne, 100), r2 = fresh(sim, dying, 100);
    // 대원 하나는 부상(물러남), 하나는 쓰러진 뒤 순직
    hurtResponder(sim, s, I, hurtOne, 65, 'gunshot', { ev: mark(sim, I) }); tickOnce(sim, s);
    hurtResponder(sim, s, I, dying, 200, 'gunshot', { ev: mark(sim, I) }); tickOnce(sim, s);
    expect([r1.status, r2.status, r2.dead]).toEqual(['injured', 'down', undefined]);
    r2.health = 0.001; dying.hpTick = 0.001;
    hurtResponder(sim, s, I, dying, 5, 'gunshot', { ev: mark(sim, I) }); tickOnce(sim, s);
    expect(r2.dead).toBe(true);
    const res = evaluate(sim, I, 'resolved');
    expect([res.respondersHurt, res.respondersDown, res.respondersKilled]).toEqual([2, 0, 1]);      // respondersHurt 는 예전 뜻 그대로 (RESPONDER_HURT 가 난 대원 수)
    expect(res.headline).toContain('대원 1명 부상, 1명 순직');
  });
  it('용의자: 교전 중에 숨진 용의자는 벌점이 없고, 위협이 끝난 뒤(안전 확보 뒤) 숨지면 0.5. 쓰러진·숨진 용의자는 검거로 센다. 한 줄 요약에 (사망 k)', () => {
    const grade = (tDead: number): { res: ReturnType<typeof evaluate>; base: ReturnType<typeof evaluate> } => {
      const { sim, s, I, h } = suspectScene('INJ-ev-sus');
      for (const q of s.hostiles) q.state = 'arrested';
      for (const c of s.casualties) { c.where = 'safe'; c.tDiscovered = 1; c.health = 100; }
      s.secureAt = 100;
      const base = evaluate(sim, I, 'resolved');
      h.state = 'down'; h.tDown = 50; h.dead = true; h.tDead = tDead; h.health = 0; h.deathCause = 'gunshot';
      h.injuries = [{ cause: 'gunshot', dmg: 100, sev: 3, t: 50, last: tDead, by: 0, byKind: 'responder', ev: -1 }];
      return { res: evaluate(sim, I, 'resolved'), base };
    };
    const during = grade(80), after = grade(160);
    expect([during.res.suspectsDead, during.res.suspectsHurt, during.res.suspectsCaught]).toEqual([1, 1, during.base.suspectsCaught]);
    expect(during.res.grade, '교전 중 사망 — 벌점 없음').toBe(during.base.grade);
    expect(during.res.headline).toMatch(/용의자 \d+명 중 \d+명 검거 \(사망 1\)/);
    if (after.base.grade === 'success') expect(after.res.grade, '위협이 끝난 뒤 사망 — 0.5').toBe('partial');
    expect(threatOverAt({ kind: 'armed', secureAt: 100, arrivedAt: 20 } as Scene)).toBe(100);
    expect(threatOverAt({ kind: 'traffic', secureAt: -1, arrivedAt: 20 } as Scene)).toBe(20);
  });
  it('숨진 구조 대상의 원인 집계(deathCauses)와 사망 문장의 원인 — 사망 기록에 적힌 그 원인', () => {
    const { sim, s } = sceneOf('INJ-ev-cas', 'fire');
    const I2 = sim.incidents[s.incidentId];
    const [c1, c2] = s.casualties;
    for (const [c, why] of [[c1, 'smoke'], [c2, 'burn']] as [Casualty, InjuryCause][]) if (c) { c.dead = true; c.health = 0; c.deathCause = why; c.tDead = 5; }
    const res = evaluate(sim, I2, 'resolved');
    const want: Record<string, number> = {}; if (c1) want.smoke = 1; if (c2) want.burn = 1;
    expect(res.deathCauses).toEqual(want);
    if (c1) expect(res.analysis.some((x) => x.includes(`구조 대상 ${josa(c1.label, '은/는')}`) && x.includes('(연기 흡입)'))).toBe(true);
  });
});

describe('단계 6 — 교대 보고서 (§3.7 · §7.3)', () => {
  it('outShifts: 순직 −1 · 후송(병원·후송 중) 쓰러진 적 있음 3 / 없음 2 · 쓰러진 채 후송 아님 3 · 다침 1 · 온전 0', () => {
    const r = { dead: undefined, care: undefined, tDown: undefined, status: 'ok' } as unknown as Responder;
    expect(outShifts(r)).toBe(0);
    expect(outShifts({ ...r, status: 'injured' })).toBe(1);
    expect(outShifts({ ...r, status: 'down', tDown: 5 })).toBe(3);
    expect(outShifts({ ...r, status: 'injured', care: 'hospital' })).toBe(2);
    expect(outShifts({ ...r, status: 'down', care: 'hospital', tDown: 5 })).toBe(3);
    expect(outShifts({ ...r, status: 'injured', care: 'aboard' })).toBe(2);
    expect(outShifts({ ...r, status: 'down', dead: true, tDown: 5 })).toBe(-1);
  });
  it('대원 목록: 상태 글은 순직 · 쓰러짐 · 부상, 교대 끝의 중증도 · 주된 원인 · 병원 이송 · 결장 예상. 순직 목록과 명부(인근 도시 지원 대원 제외), 요약 줄 — 순직은 첫 줄 바로 다음', () => {
    const sim = new Sim('INJ-rep', NORMAL, 1200);
    sim.runToEnd();
    const pick = sim.responders.filter((q) => !sim.units[q.unitId].aid);
    const [a, b, c] = pick;
    for (const q of [a, b, c]) { q.care = undefined; q.tDown = undefined; q.dead = undefined; q.deathCause = undefined; }
    a.status = 'down'; a.dead = true; a.health = 0; a.tDown = 100; a.tDead = 150; a.deathCause = 'burn'; a.injuries = [{ cause: 'burn', dmg: 100, sev: 3, t: 90, last: 150, by: -1, byKind: 'world', ev: -1 }];
    b.status = 'injured'; b.health = 35; b.care = 'hospital'; b.injuries = [{ cause: 'gunshot', dmg: 65, sev: 2, t: 90, last: 90, by: 0, byKind: 'hostile', ev: -1 }];
    c.status = 'injured'; c.health = 62; c.injuries = [{ cause: 'stab', dmg: 38, sev: 1, t: 90, last: 90, by: 0, byKind: 'hostile', ev: -1 }];
    const I0 = sim.incidents[0];
    sim.events.push({ id: sim.events.length, t: 150, incidentId: I0.id, role: 'SYSTEM', actor: '현장', kind: 'problem', text: `${a.name} 대원 생체 반응 소실.`, causes: [], problem: 'RESPONDER_KILLED', importance: 3, truth: false, rid: a.id });
    const rep = buildReport(sim);
    const row = (q: Responder) => rep.respondersHurt.find((x) => x.rid === q.id)!;
    expect(row(a)).toMatchObject({ status: '순직', band: 3, cause: 'burn', dead: true, out: -1 });
    expect(row(b)).toMatchObject({ status: '부상', band: 2, cause: 'gunshot', dead: false, hospital: true, out: 2 });
    expect(row(c)).toMatchObject({ status: '부상', band: 1, cause: 'stab', hospital: false, out: 1 });
    expect(rep.respondersKilled).toEqual([{ name: a.name, callsign: sim.units[a.unitId].callsign, cause: 'burn', incident: I0.code }]);
    expect(rep.summary[1]).toBe(`순직: ${a.name} 대원(${sim.units[a.unitId].callsign}, 사건 ${I0.code} ${scenarioName(I0.truth.type, I0.truth.variant)}).`);
    expect(rep.summary.some((x) => /^대원 피해: 부상 \d+명\(병원 이송 \d+명\)\.$/.test(x))).toBe(true);
    // 명부: 인근 도시 지원 대원은 빼고, 모든 편성표 대원 — outShifts 와 같은 결장 예상
    expect(rep.roster!.length).toBe(pick.length);
    for (const x of rep.roster!) expect(x.out).toBe(outShifts(sim.responders[x.rid]));
    expect(rep.roster!.find((x) => x.rid === a.id)).toMatchObject({ dead: true, health: 0, band: 3, cause: 'burn', name: a.name });
    // 보고서 화면의 줄
    expect(reportHurtText(row(b), rep.respondersKilled)).toBe('위중 · 총상 · 병원 이송 · 결장 예상 2');
    expect(reportHurtText(row(a), rep.respondersKilled)).toBe(`순직 · 화상 · 사건 ${I0.code}`);
    expect(reportHurtText(row(c), rep.respondersKilled)).toBe('중상 · 자상 · 결장 예상 1');
  });
  it('용의자 줄과 구조 대상의 원인 집계: 다친 용의자·숨진 용의자는 사건 판정의 합, 숨진 구조 대상의 원인은 큰 것부터', () => {
    let saw = false;
    for (const sim of all()) {
      const rep = sim.report!;
      let hurt = 0, dead = 0;
      for (const x of rep.incidents) { hurt += x.result.suspectsHurt ?? 0; dead += x.result.suspectsDead ?? 0; }
      expect([rep.suspectsHurt, rep.suspectsDead], sim.seed).toEqual([hurt, dead]);
      if (hurt) { saw = true; expect(rep.summary).toContain(dead ? `용의자 ${hurt}명이 다쳤고 그중 ${dead}명이 숨졌습니다.` : `용의자 ${hurt}명이 다쳤습니다.`); }
      if (rep.casLost) expect(rep.summary.some((x) => /명은 구하지 못했습니다\(.+ \d+(, .+ \d+)*\)\./.test(x)), sim.seed).toBe(true);
    }
    expect(saw, '표본: 다친 용의자가 있는 교대').toBe(true);
  });
  it('sweep 의 집계(scripts/injurystats.ts): 교대 상태를 읽기만 하고, 보고서의 값과 맞는다', () => {
    const sim = shooter[0];
    const hash = sim.report!.hash, n = sim.events.length;
    const c = injuryStats(sim);
    expect([sim.report!.hash, sim.events.length]).toEqual([hash, n]);
    expect(c.respHurt).toBe(sim.report!.respondersHurt.length);
    expect(c.respKilled).toBe(sim.responders.filter((r) => r.dead).length);
    expect([c.susHurt, c.susDead]).toEqual([sim.report!.suspectsHurt, sim.report!.suspectsDead]);
    const j = injuryJson(sumInjury(shooter.map(injuryStats)));
    for (const k of ['respondersKilledPerShift', 'respondersDownPerShift', 'suspectsHurt', 'suspectsDead', 'suspectsDownByGunDiedShare', 'suspectsInstantDeathShare', 'debrisFallsPerCollapse', 'deathCauses', 'crewOutPerShift', 'unitsWithKilledPerShift', 'lightReturnsPerShift']) expect(j, k).toHaveProperty(k);
    expect(j.suspectsInstantDeathShare === null || j.suspectsInstantDeathShare === 0, '즉사 없음 (용의자 문턱)').toBe(true);
  });
});

// ───────────────────────── 단계 7 — 화면 마무리 (결과 불변) ─────────────────────────
describe('단계 7 — 화면 마무리', () => {
  /** 글자를 적는 자리를 모으는 가짜 맥락 (글자 폭 = 글자 수 × 7 화소) */
  const recCtx = (out: { text: string; x: number; y: number }[]): CanvasRenderingContext2D => {
    const base = fakeCtx() as unknown as Record<string | symbol, unknown>;
    return new Proxy({}, {
      get(_t, k) {
        if (k === 'fillText') return (text: string, x: number, y: number) => { out.push({ text, x, y }); };
        if (k === 'measureText') return (text: string) => ({ width: text.length * 7 });
        return base[k];
      },
      set(_t, k, v) { base[k] = v; return true; },
    }) as CanvasRenderingContext2D;
  };
  it('대원 이름표는 쓰러진 용의자의 상태 알약을 덮지 않고, 곁에 쓰러진 두 용의자의 알약도 서로 겹치지 않는다 (그림만 — 상태 그대로)', async () => {
    await withFakeDom(async () => {
      const { drawScene } = await import('../src/view/renderScene');
      const { sim, s } = staffed('INJ-pill7');
      sim.run(3);
      const a = s.agents[0];
      const h0 = s.hostiles[0];
      h0.state = 'arrested'; h0.health = 9; h0.tDown = sim.t - 5; h0.x = h0.px = 12; h0.y = h0.py = 6; h0.hidden = false; h0.hostageId = -1;
      const h1 = addHostile(s, 12.4, 6, 'gun', 0.5, 0.5, false, 1e9); h1.state = 'down'; h1.health = 7; h1.tDown = sim.t - 3;
      a.x = a.px = 12.1; a.y = a.py = 6; a.label = `${h0.label} 응급 처치`;
      const look = (): string => JSON.stringify([sim.logHash, sim.events.length, s.hostiles.map((h) => [h.x, h.y, h.state, h.health]), s.agents.map((b) => [b.x, b.y, b.label])]);
      const before = look();
      const texts: { text: string; x: number; y: number }[] = [];
      drawScene(recCtx(texts), sim, s, 1200, 800, { truth: true, alpha: 1, timeMs: 0, selectedRid: -1 } as never);
      expect(look()).toBe(before);
      const p0 = texts.find((t) => t.text.startsWith(`${h0.label}·`)), p1 = texts.find((t) => t.text.startsWith(`${h1.label}·`));
      const lab = texts.find((t) => t.text.includes('응급 처치'));
      expect(!!(p0 && p1 && lab), texts.map((t) => t.text).join(' | ')).toBe(true);
      const clash = (p: { text: string; x: number; y: number }, q: { text: string; x: number; y: number }): boolean =>
        Math.abs(p.x - q.x) < (p.text.length + q.text.length) * 3.5 && Math.abs(p.y - q.y) < 12;
      expect(clash(p0!, p1!), `${p0!.text} / ${p1!.text}`).toBe(false);
      expect(clash(lab!, p0!) || clash(lab!, p1!), lab!.text).toBe(false);
    });
  }, 60000);
  it('숨진 용의자의 정보창에는 악화 줄이 없다 (구조 대상과 같은 규칙)', () => {
    const { sim, s, cmd } = staffed('INJ-card7');
    const h = s.hostiles[0];
    h.health = 30; h.injuries = noteInjury(undefined, 'gunshot', 70, 3, 2, 1, 'responder'); h.bleed = 0.03; h.bleedCause = 'gunshot'; h.state = 'down'; h.tDown = 3; h.hidden = false;
    expect(hostileInfo(sim, s, h, true, cmd).rows.find((r) => r.k === '악화')!.v).toBe('총상');
    h.dead = true; h.health = 0; h.deathCause = 'gunshot'; h.tDead = 9;
    const d = hostileInfo(sim, s, h, true, cmd);
    expect(d.rows.some((r) => r.k === '악화')).toBe(false);
    expect(d.rows.find((r) => r.k === '숨진 원인')!.v).toBe('총상');
  });
});
