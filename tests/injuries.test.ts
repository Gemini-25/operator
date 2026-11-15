// H1 부상과 사망 (docs/specs/H1-injuries.md §11). 번호는 설계서의 시험 번호다.
// 단계 1(기록만)·단계 2(화면)까지의 시험이 들어 있다 — 뒤 단계가 같은 번호 아래에 덧붙인다(3 방호, 4 문턱, 5 순직 빈도, 6 구조·후송, 7 용의자 처치, 12~15).
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
import type { Casualty, IncidentType, Injury, InjuryCause, Responder, Scene } from '../src/sim/types';

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
