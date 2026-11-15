// 부대 편성 · 개인 장비 · 헬기 (docs/specs/R1-crews.md 14절). 번호(①②…)는 설계서의 테스트 번호다.
// 이 파일은 90초 안에 끝나야 한다: 끝까지 돌린 교대는 shiftOf 로 한 번만 돌리고 여러 단언이 나눠 쓴다(읽기만 한다).
import { describe, expect, it } from 'vitest';
import { AIR_KIND, EXTRA_NAMES, KITS, ROLES, STAFF, armorOf, blastFactor, crewHasKit, fieldCrew, hasFirearm, hasKit, kitLive, kitUses, kitWorks, medLevelOf, minCrew, minField, roleOf, skillsOf, slotsOf, stays, toolFor, toolUse, useKit } from '../src/sim/crews';
import { NORMAL, parseDifficulty } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { fitFor } from '../src/sim/field/agents';
import { isIndoor, tileOf } from '../src/sim/field/grid';
import { blast } from '../src/sim/field/hazards';
import { agentHealth, unitArrived } from '../src/sim/field/sceneManager';
import { createIncident } from '../src/sim/incidents';
import { createAidUnit, crewNames, crewReady } from '../src/sim/resources';
import { Rng } from '../src/sim/rng';
import type { FieldAgent, IncidentType, KitId, Needs, RoleId, Scene, Unit, UnitKind, WorkItem, WorkKind } from '../src/sim/types';
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

/**
 * 매 틱 지켜본 교대 (④·⑤ 가 나눠 쓴다. 같은 조건은 한 번만 돌린다).
 *  bad   = 장비 없이 그 일을 맡은 순간들 (비어 있어야 한다)
 *  held  = 일의 종류 → 그 일을 맡았던 (현장, 대원) → 역할. 하위 작업(진입로 진압·문 개방·잔해 제거)도 그 일로 센다
 *  extr  = 유압 구조대원이 현장에서 활동 중일 때 구출을 맡고 있던 대원의 틱 수 [유압 구조대원, 그 밖]
 */
interface Watched { sim: Sim; bad: string[]; held: Map<string, Map<string, RoleId>>; extr: [number, number]; indoorWork: number; bangsOff: number; twoDoor: number; shieldAtMain: number }
const HAZ_BUILDING: Partial<Record<IncidentType, boolean>> = { fire: true, hazmat: true, collapse: true };
const watchedRuns = new Map<string, Watched>();
function watch(seed: string, d: Difficulty, force: string | null): Watched {
  const key = seed + '|' + JSON.stringify(d) + '|' + force;
  const hit = watchedRuns.get(key);
  if (hit) return hit;
  const sim = new Sim(seed, d, 1200, { force });
  const w: Watched = { sim, bad: [], held: new Map(), extr: [0, 0], indoorWork: 0, bangsOff: 0, twoDoor: 0, shieldAtMain: 0 };
  const note = (text: string): void => { if (w.bad.length < 12) w.bad.push(`${seed} t=${sim.t.toFixed(1)} ${text}`); };
  let n = 0;
  while (!sim.ended && n++ < 20000) {
    sim.step();
    for (const s of sim.scenes) {
      if (!s || s.archived) continue;
      const spreaderOn = s.agents.some((b) => b.status === 'active' && sim.responders[b.rid].role === 'extricator');
      const twoDoor = s.entryExit2 >= 0 && s.breachAt >= 0 && !s.breachDone;      // 두 문 동시 진입을 앞두고 문 앞에 모이는 중
      let n1 = 0, n2 = 0;
      for (const a of s.agents) {
        if (a.status !== 'active' || !a.task) continue;
        const r = sim.responders[a.rid], who = `${r.name}(${r.role})`;
        if (twoDoor && a.task.kind === 'engage' && a.task.tile >= 0) {
          if (a.task.tile === s.entryExit) n1++; else if (a.task.tile === s.entryExit2) n2++;
          if (hasKit(sim, a.rid, 'shield')) { if (a.task.tile === s.entryExit) w.shieldAtMain++; else note(`${who} 방패수가 주 출입구가 아닌 문으로`); }
        }
        // 급수 연결·예비 펌프 교체: 그 부대에서 펌프를 맡은 대원이 활동 중이면 그 사람만
        if ((a.task.kind === 'hookup' || a.task.kind === 'resupply') && !hasKit(sim, a.rid, 'pumpPanel') && s.agents.some((b) => b.unitId === a.unitId && b.status === 'active' && hasKit(sim, b.rid, 'pumpPanel'))) note(`${who} 펌프를 맡은 대원이 있는데 ${a.task.kind}`);
        const kinds = a.task.sub ? [a.task.kind, a.task.sub.kind] : [a.task.kind];
        for (const k of kinds) {
          let m = w.held.get(k); if (!m) { m = new Map(); w.held.set(k, m); }
          m.set(s.id + ':' + a.rid, r.role!);
          if ((k === 'suppress' || k === 'overhaul') && !hasKit(sim, a.rid, 'hose')) note(`${who} 관창 없이 ${k}`);
          if (k === 'defuse' && !hasKit(sim, a.rid, 'eodKit')) note(`${who} 해체 공구 없이 해체`);
          if ((k === 'engage' || k === 'perimeter') && !hasFirearm(sim, a.rid)) note(`${who} 총기 없이 ${k}`);
        }
        const k = a.task.kind;
        if (HAZ_BUILDING[s.kind] && (k === 'search' || k === 'extricate' || k === 'carry' || k === 'escort') && isIndoor(s.tiles[tileOf(s, a.x, a.y)])) {
          w.indoorWork++;
          if (!hasKit(sim, a.rid, 'scba')) note(`${who} 공기호흡기 없이 ${s.kind} 건물 안에서 ${k}${a.carrying < 0 && k === 'carry' ? '(보조)' : ''}`);
        }
        if (k === 'extricate' && spreaderOn) w.extr[r.role === 'extricator' ? 0 : 1]++;
      }
      if (n1 > 0 && n2 > 0) w.twoDoor++;
    }
    // 섬광탄은 사람 몫이다: 쓴 뒤에도 부대의 수는 사람 몫의 합이다
    if (sim.tick % 25 === 0) for (const u of sim.units) if (u.flashbangs !== u.crew.reduce((x, rid) => x + (hasKit(sim, rid, 'flashbang') ? kitUses(sim, rid, 'flashbang') : 0), 0)) w.bangsOff++;
  }
  watchedRuns.set(key, w);
  return w;
}
const SEV5 = parseDifficulty('3,5,3,3,3,3')!;
/** 현장을 하나 만들고 부대를 내려 세운다 (fitFor·피해 식의 단위 시험용) */
function sceneWith(seed: string, type: IncidentType, kinds: UnitKind[], d: Difficulty = withRes(5)): { sim: Sim; s: Scene; agents: (kind: UnitKind) => FieldAgent[] } {
  const sim = new Sim(seed, d);
  const I = createIncident(sim, { type, rng: sim.rng.fork('t') });
  const s = sim.scenes[I.id]!;
  for (const kind of kinds) unitArrived(sim, I, sim.units.find((u) => u.kind === kind)!);
  return { sim, s, agents: (kind) => s.agents.filter((a) => sim.units[a.unitId].kind === kind) };
}
const work = (sim: Sim, kind: WorkKind, tg: Partial<WorkItem> = {}): WorkItem => ({
  id: 0, kind, region: -1, cas: -1, prop: -1, hostile: -1, tile: -1, mate: -1, priority: 0.8, status: 'open', assignees: [], max: 1,
  createdAt: sim.t - 60, doneAt: -1, note: '', fails: 0, holdUntil: 0, thorough: false, orderSentAt: {}, cause: -1, failedAt: {}, ...tg,
});
const roleAgent = (sim: Sim, list: FieldAgent[], role: RoleId): FieldAgent => list.find((a) => sim.responders[a.rid].role === role)!;
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
        // 부대장(0번 자리)은 내리는 자리다 — 전원이 내리지 않는 부대(단계 4 의 경찰 헬기)만 예외
        if (deploying(sim, u).length > 0) expect(stays(sim, u.crew[0]), `${u.callsign}: 부대장은 내리는 자리`).toBe(false);
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
    const SEATS: Record<string, number> = { als: 2, bls: 2, heli: 1, medHeli: 1 };      // 구급차 2, 소방·의료 헬기 1, 나머지 0 (의료 헬기는 단계 4 에 생긴다)
    const sim = new Sim('CREW', withRes(5));
    for (const u of sim.units) {
      expect(u.seats, u.callsign).toBe(SEATS[u.kind] ?? 0);
      expect((u.spareAir ?? 0) > 0, `${u.callsign} 예비 공기통`).toBe(u.kind === 'engine' || u.kind === 'ladder' || u.kind === 'rescue' || u.kind === 'hazmat');
    }
  });
});

describe('④ 장비가 없으면 그 일을 맡지 않는다', () => {
  it('진압·잔불 정리는 관창, 해체는 해체 공구, 교전·봉쇄는 총기, 위험한 건물 안의 수색·구출·이송은 공기호흡기를 든 대원만 맡는다 (매 틱)', () => {
    const runs = [watch('K1', SEV5, 'fire'), watch('K2', SEV5, 'fire'), watch('K1', NORMAL, 'hazmat'), watch('K2', NORMAL, 'collapse'), watch('K1', NORMAL, 'armed/bomb'), watch('K3', NORMAL, 'armed/siege')];
    let indoor = 0;
    const seen = new Set<string>();
    for (const w of runs) {
      expect(w.sim.ended).toBe(true);
      expect(w.bad, w.bad.join('\n')).toEqual([]);
      expect(w.bangsOff, '부대의 섬광탄 수 = 사람 몫의 합').toBe(0);
      indoor += w.indoorWork;
      for (const k of w.held.keys()) seen.add(k);
    }
    // 검사한 일이 실제로 있었다
    for (const k of ['suppress', 'search', 'carry', 'defuse', 'perimeter', 'engage']) expect(seen.has(k), `${k} 를 맡은 대원이 있었다`).toBe(true);
    expect(indoor).toBeGreaterThan(500);
  }, 60000);
  it('두 문 동시 진입: 진입조가 두 문으로 나뉘고 방패수는 주 출입구에 선다', () => {
    let both = 0, shield = 0;
    for (const w of [watch('K4', NORMAL, 'armed/siege'), watch('K6', NORMAL, 'armed/siege')]) { expect(w.bad, w.bad.join('\n')).toEqual([]); both += w.twoDoor; shield += w.shieldAtMain; }
    expect(both, '두 문에 모두 진입조가 선 틱').toBeGreaterThan(50);
    expect(shield, '주 출입구에 선 방패수').toBeGreaterThan(50);
  }, 60000);
  it('fitFor: 관창을 빼면 진압·잔불 정리가 0, 공기호흡기를 빼면 위험한 건물 안 수색이 0, 총기·해체 공구도 같다', () => {
    const { sim, s, agents } = sceneWith('KIT', 'fire', ['engine', 'patrol', 'eod', 'als']);
    const room = s.regions.find((r) => r.indoor && r.searchable)!;
    const strip = (rid: number, id: KitId): void => { sim.responders[rid].kit = sim.responders[rid].kit!.filter((it) => it.id !== id); };
    const noz = roleAgent(sim, agents('engine'), 'nozzle'), lead = roleAgent(sim, agents('engine'), 'fireLead'), eng = roleAgent(sim, agents('engine'), 'engineer');
    const sup = work(sim, 'suppress', { region: room.id }), ovh = work(sim, 'overhaul', { region: room.id }), srch = work(sim, 'search', { region: room.id });
    expect(fitFor(sim, s, noz, sup)).toBeGreaterThan(0); expect(fitFor(sim, s, noz, ovh)).toBeGreaterThan(0);
    expect(fitFor(sim, s, lead, sup), '팀장은 관창을 들지 않는다').toBe(0); expect(fitFor(sim, s, eng, sup)).toBe(0);
    // 역할 선호는 맡을 수 있을 때만 더한다: 관창수의 진압 = 능력 + 0.15
    expect(fitFor(sim, s, noz, sup)).toBeCloseTo(sim.responders[noz.rid].skills.fire + 0.15, 9);
    strip(noz.rid, 'hose');
    expect(fitFor(sim, s, noz, sup)).toBe(0); expect(fitFor(sim, s, noz, ovh)).toBe(0);
    // 위험한 건물 안: 공기호흡기
    expect(fitFor(sim, s, lead, srch)).toBeGreaterThan(0);
    for (const a of [...agents('patrol'), ...agents('als')]) expect(fitFor(sim, s, a, srch), sim.responders[a.rid].role).toBe(0);
    strip(lead.rid, 'scba'); expect(fitFor(sim, s, lead, srch)).toBe(0);
    // 기관원은 수색을 피하지만(−0.25) 자격은 남는다. 급수 연결은 먼저 맡는다
    expect(fitFor(sim, s, eng, srch)).toBeGreaterThan(0);
    const hook = work(sim, 'hookup', { prop: eng.unitId });
    expect(fitFor(sim, s, eng, hook)).toBeCloseTo(1.1, 9);
    expect(fitFor(sim, s, lead, hook), '펌프를 맡은 대원이 활동 중이면 급수 연결은 그 사람의 일이다').toBe(0);
    eng.status = 'down'; expect(fitFor(sim, s, lead, hook), '쓰러졌으면 그 부대의 누구나').toBeCloseTo(0.8, 9); eng.status = 'active';
    expect(fitFor(sim, s, agents('patrol')[0], hook)).toBe(0);
    // 총기·테이저·해체 공구
    const tech = roleAgent(sim, agents('eod'), 'bombTech'), robot = roleAgent(sim, agents('eod'), 'robotOp'), cop = roleAgent(sim, agents('patrol'), 'officer');
    const per = work(sim, 'perimeter', { tile: 0 }), arr = work(sim, 'arrest', { hostile: 0 }), def = work(sim, 'defuse', { prop: 0 });
    expect(fitFor(sim, s, tech, per), '처리 요원은 총기가 없다').toBe(0); expect(fitFor(sim, s, tech, arr)).toBe(0);
    expect(fitFor(sim, s, tech, def)).toBeGreaterThan(0); expect(fitFor(sim, s, robot, def)).toBe(0); expect(fitFor(sim, s, robot, per)).toBeGreaterThan(0);
    expect(fitFor(sim, s, cop, per)).toBeGreaterThan(0);
    strip(cop.rid, 'pistol');
    expect(fitFor(sim, s, cop, per)).toBe(0); expect(fitFor(sim, s, cop, arr), '테이저로 검거는 맡는다').toBeGreaterThan(0);
    strip(cop.rid, 'taser'); expect(fitFor(sim, s, cop, arr)).toBe(0);
    strip(tech.rid, 'eodKit'); expect(fitFor(sim, s, tech, def)).toBe(0);
    // 처치: 든 의료 장비의 수준 (없으면 부서의 기본 교육)
    const para = roleAgent(sim, agents('als'), 'paramedic'), drv = roleAgent(sim, agents('als'), 'emsDriver');
    expect(medLevelOf(sim, para.rid)).toBe(1); expect(medLevelOf(sim, drv.rid)).toBe(0.5); expect(medLevelOf(sim, cop.rid)).toBe(0.25); expect(medLevelOf(sim, lead.rid)).toBe(0.35);
  });
  it('숨은 고장은 배정에 새지 않는다: 드러나기 전의 적합도는 고장이 없을 때와 같고, 드러나면 맨손 값이 된다', () => {
    const { sim, s, agents } = sceneWith('KIT', 'traffic', ['rescue']);
    const I = sim.incidents[s.incidentId];
    const ex = roleAgent(sim, agents('rescue'), 'extricator'), r = sim.responders[ex.rid];
    const item = r.kit!.find((it) => it.id === 'spreader')!;
    const jobs = [work(sim, 'extricate', { cas: 0 }), work(sim, 'clear', { tile: 5 }), work(sim, 'force', { tile: 5 })];
    const fits = (): number[] => jobs.map((w) => fitFor(sim, s, ex, w));
    const sound = fits();
    expect(toolFor(sim, ex.rid, 'extricate')).toBe(1);
    item.fault = true;      // 숨은 고장
    expect(fits()).toEqual(sound);
    expect(hasKit(sim, ex.rid, 'spreader')).toBe(true); expect(toolFor(sim, ex.rid, 'extricate')).toBe(1);
    expect(kitLive(sim, ex.rid, 'spreader'), '세계의 물리는 고장을 안다').toBe(false);
    const ev = sim.events.length, hash = sim.logHash;
    expect(fits()).toEqual(sound); expect(kitLive(sim, ex.rid, 'spreader')).toBe(false);
    expect(sim.events.length, '계획·물리 함수는 기록을 남기지 않는다').toBe(ev); expect(sim.logHash).toBe(hash); expect(item.faultKnown).toBe(false);
    // 효과를 주려 할 때 드러난다: 한 번만 기록하고, 다음으로 좋은 장비(없으면 맨손)로 넘어간다
    expect(toolUse(sim, ex.rid, 'extricate', I)).toBe(0.12);
    expect(item.faultKnown).toBe(true);
    expect(sim.events.length).toBe(ev + 1);
    expect(sim.events[ev].problem).toBe('EQUIP_FAIL'); expect(sim.events[ev].text).toBe('유압 구조기가 작동하지 않습니다.'); expect(sim.events[ev].rid).toBe(ex.rid);
    expect(I.problems.filter((p) => p.code === 'EQUIP_FAIL').map((p) => p.detail)).toEqual([`${r.name}의 유압 구조기가 고장`]);
    expect(toolUse(sim, ex.rid, 'extricate', I)).toBe(0.12); expect(kitWorks(sim, ex.rid, 'spreader', I)).toBe(false);
    expect(sim.events.length, '같은 대원·같은 장비는 한 번만').toBe(ev + 1);
    expect(hasKit(sim, ex.rid, 'spreader')).toBe(false);
    const bare = r.skills.rescue * (0.35 + 0.65 * 0.12);
    expect(fits()[0]).toBeCloseTo(Math.max(0.05, bare) + 0.25, 9);                       // 구출: 맨손 값 + 역할 선호
    expect(fits()[1]).toBeCloseTo(0.3 + r.skills.rescue * 0.5 + 0.12 * 0.3 + 0.15, 9);   // 잔해 제거
    expect(fits()[2]).toBeCloseTo(0.3 + r.skills.rescue * 0.5 + 0.12 * 0.3, 9);          // 문 개방
    // 도구가 둘이면 고장 난 것 다음으로 좋은 것을 쓴다 (구조 팀장: 탐지 장비 + 할리건)
    const lead = roleAgent(sim, agents('rescue'), 'rescueLead');
    expect(toolFor(sim, lead.rid, 'force')).toBe(0.9); expect(toolUse(sim, lead.rid, 'force', I)).toBe(0.9);
    // 장비 손잡이가 성능을 곱한다 (상한 1.15), 맨손은 그대로
    const low = new Sim('KIT', { ...NORMAL, equipment: 1 }), high = new Sim('KIT', { ...NORMAL, equipment: 5 });
    const exOf = (x: Sim): number => x.responders.find((q) => q.role === 'extricator')!.id, copOf = (x: Sim): number => x.responders.find((q) => q.role === 'officer')!.id;
    expect(toolFor(low, exOf(low), 'extricate')).toBeCloseTo(0.6, 9); expect(toolFor(high, exOf(high), 'extricate')).toBe(1.15);
    expect(toolFor(low, copOf(low), 'force')).toBe(0.12); expect(toolFor(high, copOf(high), 'force')).toBe(0.12);
  });
});

describe('⑤ 역할이 배정에 쓰인다', () => {
  it('급수 연결은 기관원·사다리 조작원이, 구출은 유압 구조대원이, 해체는 처리 요원이 맡는다', () => {
    // 급수 연결: 큰 화재를 일으킨 교대 셋
    const hook = new Map<string, RoleId>();
    let fires = 0;
    for (const seed of ['K1', 'K2', 'K4']) {
      const w = watch(seed, SEV5, 'fire');
      fires += w.sim.incidents.filter((I) => I.truth.type === 'fire').length;
      for (const [k, v] of w.held.get('hookup') ?? []) hook.set(seed + k, v);
    }
    expect(fires).toBeGreaterThanOrEqual(6);
    const pumpers = [...hook.values()].filter((role) => role === 'engineer' || role === 'ladderOp').length;
    expect(hook.size, '급수 연결을 맡은 대원').toBeGreaterThanOrEqual(4);
    expect(pumpers / hook.size, `급수 연결 ${pumpers}/${hook.size}: ${[...hook.values()].join(',')}`).toBeGreaterThanOrEqual(0.6);
    // 구출: 유압 구조대원이 현장에 있는 동안 구출을 맡고 있던 시간 가운데 유압 구조대원의 몫
    let mine = 0, others = 0;
    for (const w of [watch('K1', SEV5, 'traffic'), watch('K2', SEV5, 'traffic'), watch('K2', NORMAL, 'collapse'), watch('K5', SEV5, 'collapse')]) { mine += w.extr[0]; others += w.extr[1]; }
    expect(mine + others, '구조 공작차가 온 현장의 구출 작업').toBeGreaterThan(200);
    expect(mine / (mine + others), `유압 구조대원 ${mine} / 그 밖 ${others}`).toBeGreaterThanOrEqual(0.5);
    // 해체: 처리 요원만
    let defusers = 0;
    for (const w of [watch('K1', NORMAL, 'armed/bomb'), watch('K2', NORMAL, 'armed/bomb')]) for (const role of (w.held.get('defuse') ?? new Map<string, RoleId>()).values()) { defusers++; expect(role).toBe('bombTech'); }
    expect(defusers).toBeGreaterThan(0);
  }, 60000);
});

describe('⑥ 방호가 장비를 따른다', () => {
  it('연기·불 속에 같은 시간 서 있으면 공기호흡기·방화복을 갖춘 대원이 덜 다친다', () => {
    const { sim, s, agents } = sceneWith('KIT', 'fire', ['engine', 'patrol', 'als']);
    const I = sim.incidents[s.incidentId];
    const ff = roleAgent(sim, agents('engine'), 'nozzle'), cop = agents('patrol')[0], medic = agents('als')[0];
    const stand = (smoke: number, fire: number, secs: number): number[] => {
      const three = [ff, cop, medic];
      for (const a of three) { sim.responders[a.rid].health = 100; a.status = 'active'; sim.responders[a.rid].status = 'ok'; }
      const before = three.map((a) => sim.responders[a.rid].health);
      for (const a of three) { const i = tileOf(s, a.x, a.y); s.smoke[i] = smoke; s.fire[i] = fire; }
      for (let k = 0; k < secs / sim.dt; k++) for (const a of three) agentHealth(sim, s, I, a);
      return three.map((a, k) => before[k] - sim.responders[a.rid].health);
    };
    const [fs, cs, ms] = stand(0.8, 0, 20);
    expect(fs).toBeGreaterThan(0); expect(fs).toBeLessThan(cs * 0.2); expect(cs).toBeCloseTo(ms, 6);      // 0.1 대 1.3
    expect(fs).toBeCloseTo(0.1 * 0.8 * 20, 4); expect(cs).toBeCloseTo(1.3 * 0.8 * 20, 4);
    const [ff2, cf2] = stand(0, 0.6, 4);
    expect(ff2).toBeCloseTo(2.6 * 0.6 * 4, 4); expect(cf2).toBeCloseTo(9 * 0.6 * 4, 4);      // 방화복 2.6 대 9
    // 장비를 벗기면 같은 사람이 같은 피해를 본다 (부서가 아니라 장비다)
    sim.responders[ff.rid].kit = sim.responders[ff.rid].kit!.filter((it) => it.id !== 'scba' && it.id !== 'turnout');
    const [bare, cop2] = stand(0.8, 0, 10);
    expect(bare).toBeCloseTo(cop2, 6);
  });
  it('총격 방호와 폭발 피해는 입은 장비가 정한다', () => {
    const { sim, s, agents } = sceneWith('KIT', 'armed', ['swat', 'eod', 'patrol', 'engine', 'als']);
    const I = sim.incidents[s.incidentId];
    const by = (kind: UnitKind, role: RoleId): number => roleAgent(sim, agents(kind), role).rid;
    const shield = by('swat', 'shield'), assault = by('swat', 'assaulter'), cop = by('patrol', 'officer'), tech = by('eod', 'bombTech'), ff = by('engine', 'nozzle'), medic = agents('als')[0].rid;
    expect(armorOf(sim, assault, false)).toBeCloseTo(0.6, 9); expect(armorOf(sim, assault, true)).toBeCloseTo(0.6, 9);
    expect(armorOf(sim, shield, false)).toBeCloseTo(0.6, 9); expect(armorOf(sim, shield, true)).toBe(0.8);      // 방패는 교전·봉쇄 중에만 (0.6 + 0.3 → 상한 0.8)
    expect(armorOf(sim, cop, true)).toBeCloseTo(0.25, 9); expect(armorOf(sim, ff, true)).toBeCloseTo(0.1, 9); expect(armorOf(sim, medic, true)).toBe(0);
    expect(armorOf(sim, tech, false)).toBeCloseTo(0.6, 9);
    expect(blastFactor(sim, tech)).toBe(0.35); expect(blastFactor(sim, ff)).toBe(0.7); expect(blastFactor(sim, cop)).toBe(1);
    // 장비 손잡이: 방호 배율
    const low = new Sim('KIT', { ...NORMAL, equipment: 1 });
    expect(armorOf(low, low.responders.find((q) => q.role === 'tacOfficer')!.id, false)).toBeCloseTo(0.3, 9);
    // 같은 자리에서 같은 폭발을 맞으면 방호복 < 방화복 < 그 밖
    const three = [tech, ff, cop].map((rid) => s.agents.find((a) => a.rid === rid)!);
    for (const a of three) { a.x = s.staging.x; a.y = s.staging.y; sim.responders[a.rid].health = 100; }
    for (const a of s.agents) if (three.indexOf(a) < 0) { a.x = 0; a.y = 0; }
    blast(sim, s, I, s.staging.x, s.staging.y, 3, 40, -1);
    const lost = three.map((a) => 100 - sim.responders[a.rid].health);
    expect(lost[0]).toBeCloseTo(40 * 0.35, 6); expect(lost[1]).toBeCloseTo(40 * 0.7, 6); expect(lost[2]).toBeCloseTo(40, 6);
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
        if (e.kind !== 'arrive' || e.text.includes('상공 도착')) continue;      // 상공에 머무는 헬기(단계 4 부터)는 아무도 내리지 않는다 — 이름이 없다
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
