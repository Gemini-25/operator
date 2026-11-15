// 부대 편성 · 개인 장비 · 헬기 (docs/specs/R1-crews.md 14절). 번호(①②…)는 설계서의 테스트 번호다.
// 이 파일은 90초 안에 끝나야 한다: 끝까지 돌린 교대는 shiftOf 로 한 번만 돌리고 여러 단언이 나눠 쓴다(읽기만 한다).
import { describe, expect, it } from 'vitest';
import { AIR_KIND, EXTRA_NAMES, KITS, ROLES, STAFF, crewHasKit, fieldCrew, hasFirearm, hasKit, kitUses, minCrew, minField, roleOf, skillsOf, slotsOf, stays, useKit } from '../src/sim/crews';
import { NORMAL } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { createIncident } from '../src/sim/incidents';
import { createAidUnit, crewNames, crewReady } from '../src/sim/resources';
import { Rng } from '../src/sim/rng';
import type { KitId, Needs, RoleId, Unit, UnitKind } from '../src/sim/types';
import { clamp } from '../src/sim/util';

const withRes = (resources: number): Difficulty => ({ ...NORMAL, resources });
/** 끝까지 돈 교대 (같은 조건은 한 번만 돌린다) */
const finished = new Map<string, Sim>();
function shiftOf(seed: string, d: Difficulty = NORMAL, force: string | null = null): Sim {
  const key = seed + '|' + JSON.stringify(d) + '|' + force;
  let s = finished.get(key);
  if (!s) { s = new Sim(seed, d, 1200, { force }); s.runToEnd(); finished.set(key, s); }
  return s;
}
/** 인근 도시 지원 부대를 수요마다 하나씩 만든다 (실제 지원 요청과 같은 길: createAidUnit → sim.aidUsed++) */
const AID_KEYS: (keyof Needs)[] = ['suppression', 'rescue', 'ems', 'law', 'tactical', 'search', 'traffic', 'eod'];
function withAid(sim: Sim, keys: (keyof Needs)[] = AID_KEYS): Unit[] {
  const I = createIncident(sim, { type: 'fire', rng: sim.rng.fork('t') });
  const out: Unit[] = [];
  for (const key of keys) { const u = createAidUnit(sim, key, I); expect(u, `지원 부대(${key})를 만들지 못했다`).not.toBeNull(); sim.aidUsed++; out.push(u!); }
  return out;
}
const rolesOf = (sim: Sim, u: Unit): RoleId[] => u.crew.map((rid) => sim.responders[rid].role!);
/** 현장에 내리는 자리의 대원 (fieldCrew 와 달리 전원이 내리지 않는 부대면 빈 배열) */
const deploying = (sim: Sim, u: Unit): number[] => u.crew.filter((rid) => !stays(sim, rid));
const anyKit = (sim: Sim, u: Unit, ids: KitId[]): boolean => deploying(sim, u).some((rid) => ids.some((id) => hasKit(sim, rid, id)));

describe('① 편성표대로 만들어진다', () => {
  it('부대 규모 3·5 는 표준 인원, 1·2 는 최소 인원이고 0번 자리가 부대장이다', () => {
    for (const lv of [1, 2, 3, 4, 5]) {
      const sim = new Sim('CREW', withRes(lv));
      let total = 0;
      for (const u of sim.units) {
        const st = STAFF[u.kind], want = slotsOf(u.kind, lv <= 2).map((k) => st.std[k]);
        expect(rolesOf(sim, u), `규모 ${lv} ${u.callsign}`).toEqual(want);
        if (lv <= 2) { expect(want).toEqual(st.std.filter((_, k) => st.minDrop.indexOf(k) < 0)); expect(u.crew.length).toBe(minCrew(u.kind)); }
        else expect(want).toEqual(st.std);
        total += want.length;
        u.crew.forEach((rid, k) => {
          const r = sim.responders[rid];
          expect(r.senior, `${u.callsign} ${k}번 자리`).toBe(k === 0);
          expect(r.unitId).toBe(u.id); expect(r.dept).toBe(u.dept); expect(r.id).toBe(rid);
          expect(r.kit!.map((it) => it.id)).toEqual(ROLES[r.role!].kit);      // 역할의 기본 장비를 그 순서로 든다
        });
        expect(stays(sim, u.crew[0]), `${u.callsign}: 부대장은 내리는 자리`).toBe(false);
      }
      expect(sim.responders.length, `규모 ${lv} 총원`).toBe(total);
    }
  });
  it('최소 인원에서 빼는 자리는 표 안의 번호이고 부대장(0번)은 빼지 않는다', () => {
    for (const kind of Object.keys(STAFF) as UnitKind[]) {
      const st = STAFF[kind];
      for (const k of st.minDrop) { expect(k).toBeGreaterThan(0); expect(k).toBeLessThan(st.std.length); }
      expect(new Set(st.minDrop).size).toBe(st.minDrop.length);
      expect(minField(kind)).toBeGreaterThan(0); expect(minField(kind)).toBeLessThanOrEqual(minCrew(kind));
    }
    expect(minCrew('engine')).toBe(3); expect(minCrew('rescue')).toBe(4); expect(minCrew('swat')).toBe(4);
    expect(minField('heli')).toBe(2);      // 최소 편성(구조대원 둘 + 기장)에서 내리는 자리는 둘
    expect(minField('boat')).toBe(2);
  });
  it('내리지 않는 자리(조종사·정장)는 인원에는 들지만 내리는 대원으로 세지 않는다', () => {
    const sim = new Sim('CREW', withRes(5));
    const heli = sim.units.find((u) => u.kind === 'heli')!, boat = sim.units.find((u) => u.kind === 'boat')!;
    expect(heli.crew.length).toBe(4); expect(fieldCrew(sim, heli).length).toBe(2); expect(crewReady(sim, heli)).toBe(2);
    expect(boat.crew.length).toBe(3); expect(fieldCrew(sim, boat).length).toBe(2);
    expect(crewNames(sim, heli).split('·').length).toBe(2);
    expect(heli.air).toBe(true); expect(AIR_KIND.has(heli.kind)).toBe(true); expect(boat.air).toBe(false);
    // 다친 대원은 내릴 수 있는 수에서 빠진다. 조종사가 다쳐도 내릴 수 있는 수는 그대로다
    sim.responders[heli.crew[0]].status = 'injured'; expect(crewReady(sim, heli)).toBe(1);
    sim.responders[heli.crew[2]].status = 'injured'; expect(crewReady(sim, heli)).toBe(1);
  });
  it('섬광탄·테이저·장약은 사람 몫이고, 부대의 섬광탄 수는 그 합이다', () => {
    for (const eq of [1, 3, 5]) for (const lv of [1, 3]) {
      const sim = new Sim('CREW', { ...NORMAL, equipment: eq, resources: lv });
      const all = [...sim.units, ...withAid(sim, ['tactical', 'law'])];
      for (const u of all) {
        const sum = u.crew.reduce((n, rid) => n + (hasKit(sim, rid, 'flashbang') ? kitUses(sim, rid, 'flashbang') : 0), 0);
        expect(sum, `${u.callsign} 섬광탄 합`).toBe(u.flashbangs);
        const share = u.kind === 'tactical' ? (u.aid ? Math.min(2, sim.tune.flashbangs) : sim.tune.flashbangs) : u.kind === 'swat' ? sim.tune.flashbangs + 2 : 0;
        expect(u.flashbangs, `${u.callsign} 부대 몫`).toBe(share);
        // 자리 순서대로 하나씩 돌려 나눈다: 가진 수의 차이는 많아야 1 이고 앞자리가 더 많다
        const held = u.crew.filter((rid) => hasKit(sim, rid, 'flashbang')).map((rid) => kitUses(sim, rid, 'flashbang'));
        for (let k = 1; k < held.length; k++) { expect(held[k - 1]).toBeGreaterThanOrEqual(held[k]); expect(held[0] - held[k]).toBeLessThanOrEqual(1); }
        for (const rid of u.crew) {
          if (hasKit(sim, rid, 'taser')) expect(kitUses(sim, rid, 'taser')).toBe(2);
          if (hasKit(sim, rid, 'charge')) expect(kitUses(sim, rid, 'charge')).toBe(2);
          for (const it of sim.responders[rid].kit!) { expect(it.fault).toBe(false); expect(it.faultKnown).toBe(false); }      // 고장 추첨은 단계 6
        }
      }
    }
    // 수량을 쓰면 사람 몫과 부대의 합이 함께 준다. 0 밑으로 내려가지 않는다
    const sim = new Sim('CREW');
    const tac = sim.units.find((u) => u.kind === 'tactical')!, who = tac.crew.find((rid) => kitUses(sim, rid, 'flashbang') > 0)!;
    const before = tac.flashbangs, mine = kitUses(sim, who, 'flashbang');
    useKit(sim, who, 'flashbang'); expect(kitUses(sim, who, 'flashbang')).toBe(mine - 1); expect(tac.flashbangs).toBe(before - 1);
    useKit(sim, who, 'flashbang', 9); expect(kitUses(sim, who, 'flashbang')).toBe(0); expect(tac.flashbangs).toBe(before - mine);
    expect(kitUses(sim, tac.crew[0], 'flashbang')).toBe(0);      // 조장은 섬광탄을 들지 않는다
    expect(hasKit(sim, tac.crew[0], 'flashbang')).toBe(false);
    // 알려진 고장은 없는 것으로 본다. 숨은 고장은 모른다(있는 것으로 본다)
    const lead = sim.units.find((u) => u.kind === 'engine')!.crew[0], tic = sim.responders[lead].kit!.find((it) => it.id === 'tic')!;
    tic.fault = true; expect(hasKit(sim, lead, 'tic')).toBe(true);
    tic.faultKnown = true; expect(hasKit(sim, lead, 'tic')).toBe(false);
  });
});

describe('② 2명이 아닌 부대가 있다', () => {
  it('기본 편성에서 인원 수가 세 가지 이상이고, 2명이 아닌 부대가 절반을 넘는다', () => {
    const sim = new Sim('CREW');
    const sizes = sim.units.map((u) => u.crew.length);
    expect(new Set(sizes).size).toBeGreaterThanOrEqual(3);
    expect(Math.min(...sizes)).toBe(2); expect(Math.max(...sizes)).toBe(5);
    expect(sizes.filter((n) => n !== 2).length).toBeGreaterThan(sim.units.length / 2);
    // 역할 표: 이름과 장비 이름이 모두 있고, 능력의 식은 0..1 안에 든다
    for (const id of Object.keys(ROLES) as RoleId[]) {
      const def = ROLES[id];
      expect(def.name.length).toBeGreaterThan(0);
      for (const k of def.kit) expect(KITS[k].name.length, `${id} 의 ${k}`).toBeGreaterThan(0);
      expect(new Set(def.kit).size).toBe(def.kit.length);
      for (const s of [0.3, 0.6, 0.98]) for (const v of Object.values(skillsOf(id, s))) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThanOrEqual(1); }
      if (def.stays) expect(def.kit.some((k) => KITS[k].group !== 'air'), `${id}: 내리지 않는 자리는 현장 장비를 들지 않는다`).toBe(false);
    }
  });
});

describe('③ 능력과 장비가 어긋나지 않는다', () => {
  it('능력(caps)이 기준을 넘는 부대에는 그 일을 할 장비를 가진 내리는 대원이 있다 (부대 규모 1·3·5, 지원 부대 포함)', () => {
    for (const lv of [1, 3, 5]) {
      const sim = new Sim('CREW', withRes(lv));
      const aid = withAid(sim);
      expect(new Set(aid.map((u) => u.kind)).size).toBeGreaterThanOrEqual(5);
      for (const u of [...sim.units, ...aid]) {
        const tag = `규모 ${lv} ${u.callsign}(${u.kind})`;
        if (u.caps.suppression >= 0.7) expect(anyKit(sim, u, ['hose']), `${tag}: 관창`).toBe(true);
        if (u.caps.ems >= 0.7) expect(anyKit(sim, u, ['bag', 'alsBag', 'doctorKit']), `${tag}: 의료 장비`).toBe(true);
        if (u.caps.eod >= 0.9) expect(anyKit(sim, u, ['eodKit']), `${tag}: 해체 공구`).toBe(true);
        if (u.caps.law >= 0.5) expect(deploying(sim, u).some((rid) => hasFirearm(sim, rid)), `${tag}: 총기`).toBe(true);
        if (u.caps.rescue >= 0.5) expect(anyKit(sim, u, ['irons', 'spreader', 'lightRescue', 'rope', 'ring']), `${tag}: 구조 장비`).toBe(true);
        if (u.dept === 'fire' && u.kind !== 'boat') expect(anyKit(sim, u, ['scba']), `${tag}: 공기호흡기`).toBe(true);
        if (u.caps.search >= 0.3) expect(deploying(sim, u).length > 0 || AIR_KIND.has(u.kind), `${tag}: 내리는 대원이 있거나 상공 부대`).toBe(true);
        // crewHasKit 은 같은 것을 부대 단위로 본다
        if (u.caps.suppression >= 0.7) expect(crewHasKit(sim, u, 'hose')).toBe(true);
      }
      // 지원 부대는 그 종류의 최소 인원 편성이고, 차량에 딸린 칸(환자 자리·예비 공기통)도 편성표 부대와 같다
      for (const u of aid) {
        expect(rolesOf(sim, u), u.callsign).toEqual(slotsOf(u.kind, true).map((k) => STAFF[u.kind].std[k]));
        const own = new Sim('CREW', withRes(5)).units.find((q) => q.kind === u.kind)!;
        expect(u.seats).toBe(own.seats); expect(u.spareAir).toBe(own.spareAir);
        expect(sim.responders[u.crew[0]].senior).toBe(true);
      }
      expect(aid.find((u) => u.kind === 'bls')!.seats).toBe(2);
    }
  });
  it('환자 자리와 예비 공기통은 종류를 따른다', () => {
    const sim = new Sim('CREW', withRes(5));
    for (const u of sim.units) {
      expect(u.seats, u.callsign).toBe(u.kind === 'als' || u.kind === 'bls' ? 2 : u.kind === 'heli' ? 1 : 0);
      expect((u.spareAir ?? 0) > 0, `${u.callsign} 예비 공기통`).toBe(u.kind === 'engine' || u.kind === 'ladder' || u.kind === 'rescue' || u.kind === 'hazmat');
    }
  });
});

describe('⑦ 같은 사람 = 같은 능력', () => {
  it('부대 규모가 달라도 같은 이름의 대원은 같은 능력치를 갖는다 (셋째 자리 이후 포함)', () => {
    const sims = [1, 2, 3, 4, 5].map((lv) => new Sim('CREW', withRes(lv)));
    const big = sims[4];
    const byName = new Map(big.responders.map((r) => [r.name, r]));
    let later = 0;
    for (const sim of sims) for (const u of sim.units) u.crew.forEach((rid) => {
      const r = sim.responders[rid], q = byName.get(r.name)!;
      expect(q, `${r.name} 이 규모 5 에 없다`).toBeTruthy();
      expect(q.skill).toBe(r.skill); expect(q.judgment).toBe(r.judgment); expect(q.experience).toBe(r.experience); expect(q.role).toBe(r.role);
      expect(big.units[q.unitId].callsign).toBe(u.callsign);      // 같은 사람은 같은 부대의 같은 자리다
      if (EXTRA_NAMES.indexOf(r.name) >= 0) later++;      // 셋째 자리 이후의 사람
    });
    expect(later).toBeGreaterThan(60);
    // 교대(시드)가 달라도 명부는 같다
    const other = new Sim('OTHER-SEED', withRes(5));
    expect(other.responders.map((r) => r.name + r.skill)).toEqual(big.responders.map((r) => r.name + r.skill));
  });
  it('이름이 모두 다르다 — 인근 도시 지원을 여덟 번 받은 뒤에도', () => {
    const sim = new Sim('CREW', withRes(5));
    expect(new Set(sim.responders.map((r) => r.name)).size).toBe(sim.responders.length);
    expect(new Set(EXTRA_NAMES).size).toBe(EXTRA_NAMES.length);
    // 표준 편성의 셋째 자리부터(와 새 줄의 모든 자리)가 EXTRA_NAMES 를 쓴다: 표의 이름이 모자라지 않다
    for (const r of sim.responders) expect(typeof r.name === 'string' && r.name.length >= 2, `이름 없음 (rid ${r.id})`).toBe(true);
    const aid = withAid(sim);      // 지원 한도는 5회, 재난 때 3회 더 (disaster.ts)
    expect(aid.length).toBe(8);
    expect(new Set(sim.responders.map((r) => r.name)).size).toBe(sim.responders.length);
  });
  it('처음 20줄의 0·1번 자리 40명은 R1 전과 같은 기본 능력을 갖는다', () => {
    const sim = new Sim('CREW', withRes(5));
    // R1 전의 방식 그대로: 고정 시드의 roster-v1 에서 줄 순서 × 두 명, 한 명당 6번(경험 → 능력 다섯)
    const rng = new Rng(0x51ab7e).fork('roster-v1');
    for (let di = 0; di < 20; di++) for (let k = 0; k < 2; k++) {
      const st = (): number => clamp(rng.range(0.3, 0.95), 0, 1);
      const exp = k === 0 ? rng.range(0.6, 0.97) : rng.range(0.12, 0.6);
      const skill = clamp(st() * 0.6 + exp * 0.4 + 0.05, 0.3, 0.98), judgment = clamp(st() * 0.65 + exp * 0.35, 0.2, 0.98);
      const composure = st(), fitness = st(), teamwork = st();
      const r = sim.responders[sim.units[di].crew[k]];
      const tag = `${sim.units[di].callsign} ${k}번 자리 ${r.name}`;
      expect(r.skill, tag).toBe(skill); expect(r.judgment, tag).toBe(judgment); expect(r.experience, tag).toBe(exp);
      expect(r.composure, tag).toBe(composure); expect(r.fitness, tag).toBe(fitness); expect(r.teamwork, tag).toBe(teamwork);
    }
    // 능력(skills)은 역할의 식으로만 정해진다
    for (const r of sim.responders) expect(r.skills).toEqual(skillsOf(r.role!, r.skill));
  });
});

describe('현장에 내리는 사람 (설계서 6.1)', () => {
  it('내리지 않는 자리는 현장에 서지 않고, 도착 기록은 실제로 내린 첫 사람의 역할과 이름을 쓴다', () => {
    let arrivals = 0, big = 0;
    for (const seed of ['S1', 'S2']) {
      const sim = shiftOf(seed);
      for (const s of sim.scenes) {
        if (!s) continue;
        for (const a of s.agents) {
          expect(stays(sim, a.rid), `${seed}: ${sim.responders[a.rid].name} 은 내리지 않는 자리다`).toBe(false);
          expect(a.aloft).toBe(false);
        }
        const perUnit = new Map<number, number>();
        for (const a of s.agents) perUnit.set(a.unitId, (perUnit.get(a.unitId) ?? 0) + 1);
        for (const [uid, n] of perUnit) { expect(n).toBeLessThanOrEqual(fieldCrew(sim, sim.units[uid]).length); if (n > 2) big++; }
      }
      for (const e of sim.events) {
        if (e.kind !== 'arrive') continue;
        arrivals++;
        const u = sim.units.find((q) => q.callsign === e.actor)!;
        // "(역할 이름 외 n명)" 이거나, 한 명이면 "(이름)"
        const crew = fieldCrew(sim, u).map((rid) => sim.responders[rid]);
        const lead = crew.find((r) => e.text.includes(r.name));
        expect(lead, e.text).toBeTruthy();
        const others = /외 (\d+)명\)/.exec(e.text);
        if (others) { expect(e.text).toContain(`(${roleOf(sim, lead!.id).name} ${lead!.name} 외 ${others[1]}명)`); expect(+others[1]).toBeGreaterThan(0); expect(+others[1]).toBeLessThan(crew.length); }
        else expect(e.text).toContain(`(${lead!.name})`);
        for (const r of u.crew.map((rid) => sim.responders[rid])) if (stays(sim, r.id)) expect(e.text.includes(r.name), `${e.text}: 내리지 않는 ${r.name}`).toBe(false);
      }
    }
    expect(arrivals).toBeGreaterThan(40);
    expect(big).toBeGreaterThan(10);      // 셋 넘게 내린 부대가 실제로 있다
  });
});

describe('⑮ 재현성', () => {
  it('같은 시드·같은 조건은 같은 결과를 만든다 (강제 발생·재난 포함)', () => {
    const cases: [string, Difficulty, string | null][] = [
      ['S1', NORMAL, null], ['S3', withRes(1), null], ['S3', NORMAL, 'armed/kidnap'], ['S5', NORMAL, 'water/std'], ['S2', { ...NORMAL, disaster: 'wildfire' }, null],
    ];
    for (const [seed, d, force] of cases) {
      const a = shiftOf(seed, d, force);
      const b = new Sim(seed, d, 1200, { force }); b.runToEnd();
      expect(a.ended && b.ended).toBe(true);
      expect(b.report!.hash, `${seed} ${force ?? ''}`).toBe(a.report!.hash);
      expect(b.events.length).toBe(a.events.length);
      expect(b.responders.length).toBe(a.responders.length);
    }
  }, 60000);
});
