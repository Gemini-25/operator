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
import { createAidUnit } from '../src/sim/resources';
import { armorOf } from '../src/sim/crews';
import { PROBLEM_LABEL } from '../src/sim/debrief';
import { emit } from '../src/sim/events';
import { TRAP_R, TRAP_WORK, band, blast, tickCasualties, tickCollapse, tickGas, tickHostiles, tickLane, tickWater } from '../src/sim/field/hazards';
import { MISHAP, act, makeTask, moveSpeed } from '../src/sim/field/executor';
import { commanderThink, outstanding } from '../src/sim/field/commander';
import { WALK_STOP } from '../src/sim/field/rules/injury';
import { fmtSec, josa } from '../src/sim/util';
import { detonate } from '../src/sim/field/rules/crime';
import {
  BLEED_PER_DMG, CAUSE_NAME, DOWN_AT, DOWN_BLEED_CAP, HURT_AT, MATE_BLEED_MAX, MATE_FLOOR, MATE_LETHAL_FROM, MATE_RETREAT_BLEED, MATE_RETREAT_HP,
  bandOf, hurtCas, hurtCasTo, hurtCauseNow, hurtF, hurtResponder, initialCause, injuryRng, mainCause, mustRetreat, noteCasHurt, noteHostileHurt, noteInjury, protection, smokeCause, woundTick,
} from '../src/sim/field/injury';
import { fitFor, makeAgent, mateFact, mateStatus, perceive, staminaF } from '../src/sim/field/agents';
import { addCas, addHostile } from '../src/sim/field/kit';
import { mkFact } from '../src/sim/field/beliefs';
import { agentHealth, settleInjuries, tickScene, unitArrived } from '../src/sim/field/sceneManager';
import { T } from '../src/sim/types';
import type { Casualty, FieldAgent, Hostile, Incident, IncidentType, Injury, InjuryCause, MateBelief, Prop, Responder, RoleId, Scene, SimEvent, UnitKind, WorkItem } from '../src/sim/types';
import { CameraDirector } from '../src/view/camera';
import { TRIAGE, TRIAGE_EDGE, TRIAGE_NAME, TRIAGE_TEXT, agentStateText, careName, casBand, casDrawn, casInfo, casSheet, hostileBand, hostileDrawn, hostileInfo, hostileSheet, hurtPose, injuryLine, isLoss, respBand, respLying, respSheet, respStateText } from '../src/view/triage';
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
    // 용의자: 지금 모델에서는 숨지지 않으므로 sev 는 위중(2)까지 (대원의 피해는 단계 4a 부터 hurtResponder 가 적는다 — 아래 "4. 대원")
    const h = addHostile(s, 6, 6, 'gun', 0.5, 0.5, false, 1e9);
    h.health = -8;
    noteHostileHurt(h, 'gunshot', 100, 7, 3, 'responder');
    expect(h.injuries).toEqual([{ cause: 'gunshot', dmg: 108, sev: 2, t: 7, last: 7, by: 3, byKind: 'responder', ev: -1 }]);
  });
  it('원인의 이름이 모두 있다', () => {
    const causes: InjuryCause[] = ['gunshot', 'stab', 'blunt', 'burn', 'smoke', 'toxic', 'fall', 'crush', 'blast', 'drown', 'electric', 'exhaustion', 'vehicle', 'exposure', 'illness'];
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
      'c.health = Math.min(100, c.health + 15);',                        // 처치 (오른다)
      'c.health = Math.min(100, c.health + 8 * q);',
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
  it('용의자: Σ(기록) = 100 − 체력', () => {
    let hurt = 0;
    for (const sim of all()) for (const s of scenesOf(sim)) for (const h of s.hostiles) {
      expect(Math.abs(sumDmg(h.injuries) - (100 - h.health)), `${sim.seed} ${h.label}`).toBeLessThan(1e-6);
      if (h.health < 100) hurt++;
    }
    expect(hurt).toBeGreaterThan(3);
  });
  it('대원: Σ(기록) = 100 − 체력. 순직한 대원은 넘친 만큼만 더 크다 (체력 하한 1 은 단계 4a 에서 없어졌다)', () => {
    let hurt = 0;
    for (const sim of all()) for (const r of sim.responders) {
      const sum = sumDmg(r.injuries), want = 100 - r.health, tag = `${sim.seed} ${r.name}`;
      if (r.dead) { expect(sum, tag).toBeGreaterThanOrEqual(100 - 1e-6); expect(sum, tag).toBeLessThan(160); }
      else expect(Math.abs(sum - want), tag).toBeLessThan(1e-6);
      if (r.health < 100) hurt++;
      for (const j of r.injuries ?? []) expect(j.sev, tag).toBeLessThanOrEqual(r.dead ? 3 : 2);      // 사망(3)은 숨진 대원의 기록에만
    }
    expect(hurt).toBeGreaterThan(20);
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
        if (e.role !== 'SYSTEM' || !/생체 반응 소실|생체 반응이 사라졌습니다|떠내려갔습니다/.test(e.text)) continue;
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
    for (const seed of ['S5', 'S8']) {
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
    const a = shift('W6', QUAKE), b = shift('W6', QUAKE);
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
    // 지금 방호가 없는 원인
    for (const cause of ['blunt', 'vehicle', 'drown', 'exposure', 'illness', 'exhaustion'] as InjuryCause[]) for (const a of [ff, cop, tech]) expect(P(a, cause), cause).toBe(0);
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
    // 심각도 손잡이가 출혈을 키운다
    expect([1, 2, 3, 4, 5].map((sv) => new Sim('INJ-mul', { ...NORMAL, severity: sv }).tune.injuryMul)).toEqual([0.75, 0.9, 1, 1.12, 1.25]);
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
  it('상처 악화: 현장에 있는 동안 출혈이 체력을 깎는다(쓰러져 있어도). 안전 구역으로 물러난 대원의 출혈은 멈춰 둔다 — 단계 4b 가 푼다', () => {
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
    expect(r.health).toBe(h2);
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
    r.bleed = 0.05; r.treatQ = 0.3; r.tDown = 3;
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
    const st = (x: FieldAgent['status']): string => { const keep = b.status; b.status = x; const v = mateStatus(b); b.status = keep; return v; };
    expect([st('down'), st('withdrawn'), st('left'), st('active')]).toEqual(['down', 'safe', 'evac', 'hurt']);
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
    // 다시 멀어져도 되돌리지 않는다
    a.x = s.staging.x + 1; a.outbox.length = 0;
    perceive(sim, s, a);
    expect(a.beliefs.val<MateBelief>('mate', b.rid)!.dead).toBe(true); expect(a.outbox.length).toBe(0);
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
