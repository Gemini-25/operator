// H1 부상과 사망 (docs/specs/H1-injuries.md §11). 번호는 설계서의 시험 번호다.
// 단계 1(기록만)·단계 2(화면)까지의 시험이 들어 있다 — 뒤 단계가 같은 번호 아래에 덧붙인다(3 방호, 4 문턱, 5 순직 빈도, 6 구조·후송, 7 용의자 처치, 12~15).
// 단계 1 의 시험은 파일 앞쪽(1·2·처음 원인·장부·9·11·객체 모양·8), 단계 2 의 시험은 뒤쪽(10·중증도 색·읽는 함수·현장 그림)이다.
import { readFileSync, readdirSync } from 'node:fs';
import { beforeAll, describe, expect, it } from 'vitest';
import { NORMAL } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { createIncident } from '../src/sim/incidents';
import { createAidUnit } from '../src/sim/resources';
import { band, tickGas, tickWater } from '../src/sim/field/hazards';
import { CAUSE_NAME, bandOf, initialCause, injuryRng, mainCause, noteCasHurt, noteHostileHurt, noteInjury, noteRespHurt, smokeCause } from '../src/sim/field/injury';
import { makeAgent } from '../src/sim/field/agents';
import { addCas, addHostile } from '../src/sim/field/kit';
import { mkFact } from '../src/sim/field/beliefs';
import { unitArrived } from '../src/sim/field/sceneManager';
import type { Casualty, FieldAgent, IncidentType, Injury, InjuryCause, Responder, Scene, SimEvent, UnitKind } from '../src/sim/types';
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
    // 대원·용의자: 지금 모델에서는 숨지지 않으므로 sev 는 위중(2)까지
    const h = addHostile(s, 6, 6, 'gun', 0.5, 0.5, false, 1e9);
    h.health = -8;
    noteHostileHurt(h, 'gunshot', 100, 7, 3, 'responder');
    expect(h.injuries).toEqual([{ cause: 'gunshot', dmg: 108, sev: 2, t: 7, last: 7, by: 3, byKind: 'responder', ev: -1 }]);
    const r = { health: 0.5, injuries: undefined, dead: undefined } as unknown as Responder;
    noteRespHurt(r, 'vehicle', 40, 8);
    expect(r.injuries![0]).toMatchObject({ cause: 'vehicle', dmg: 39.5, sev: 2 });
  });
  it('원인의 이름이 모두 있다', () => {
    const causes: InjuryCause[] = ['gunshot', 'stab', 'blunt', 'burn', 'smoke', 'toxic', 'fall', 'crush', 'blast', 'drown', 'electric', 'exhaustion', 'vehicle', 'exposure', 'illness'];
    for (const k of causes) expect(CAUSE_NAME[k], k).toBeTruthy();
    expect(Object.keys(CAUSE_NAME).length).toBe(causes.length);
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
  it('대원: Σ(기록) = 100 − 체력 (체력이 하한 1 에 걸린 대원은 넘친 만큼 더 크다)', () => {
    let hurt = 0;
    for (const sim of all()) for (const r of sim.responders) {
      const sum = sumDmg(r.injuries), want = 100 - r.health, tag = `${sim.seed} ${r.name}`;
      if (r.health > 1 + 1e-9) expect(Math.abs(sum - want), tag).toBeLessThan(1e-6);
      else expect(sum, tag).toBeGreaterThanOrEqual(want - 1e-6);
      if (r.health < 100) hurt++;
      for (const j of r.injuries ?? []) expect(j.sev, tag).toBeLessThanOrEqual(2);      // 지금 모델에서 대원은 숨지지 않는다
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
