// X6 위험의 현실화 (docs/specs/X6-catastrophe.md §10). 단계마다 채운다 — 지금은 단계 1(상태만)·2(조짐)·3(세계 — 구조)·4(세계 — 폭발)의 시험이다:
//   단계 1: 자료형, catOf(대상·입구·용기 판별·처음 값), 생김새 도움 함수, 난수 흐름이 부모를 소비하지 않음, 틱의 손 계산.
//   단계 2: §10-3 조짐(관찰·보고 규칙·합치기·무전·외부 관찰의 기억·가스 용기 구멍), §10-6 재현성, 그림(catLayer)이 결과를 바꾸지 않음.
//   단계 3: §10-1 방치하면 무너지고 다 탄다(화재·붕괴), §10-2 ① 보강하면 무너지지 않는다, 구조 충격의 손 계산, 전체 붕괴(§10-5 의 닿음·2층), §10-8 기록 일치(구조 쪽),
//           §10-9 도시 지도(일부), §10-10 층 너머, §10-12 깔린 대원.
//   단계 4: §10-1·§10-2 의 가스(불·구름·차단)와 용기(한계·식음·물), 폭발 손 계산, 처음 가스(collapse/gasblast), 도시가스 차단, CNG·항공유·누출 연료·드럼통, §10-8 폭발 쪽.
//   (단계 1 의 "세계 규칙을 뺀 교대와 같다"는 단계 2 에서, "계산만 한다"·"아직 아무것도 일으키지 않는다"는 단계 3·4 에서 끝났다)
//   단계 5: §10-4 철수(명령·경적·음영·인원 점검·복도), 문(빈 작업·ops.gated)·이동 비용·자기 감각의 철수·피하는 곳·외부 방수 자리, 외부 방어(방치로 닫히지 않음 — §10-5 일부),
//           냉각·가스 재측정·도시가스 차단 요청·관제 재평가. 교대 묶음은 위험 조짐·철수 기록이 지휘 상태·집계와 맞는지 본다.
//   단계 6: §10-5 사건이 끝난다(전체 붕괴·가스 폭발 뒤 16교대 · 한계 시간 보탬 330) · 종료를 막는 것(문이 막은 수색·인원 점검 시한·철수 구역·가스 측정값) ·
//           외부 확인 종료 · 잔해 수색 국면(전체 30초·구획 25초·매몰 추정·공기호흡기·건물 조짐으로 물러나지 않음·늦게 닿은 대원).
// 뒤 단계가 더할 것(설계서 §10 의 번호): 9 의 건물 제외(단계 7) · 11 catOf 의 입구(일부는 아래에 있다).
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fakeCtx, withFakeDom } from './fakeCanvas';
import { hasKit } from '../src/sim/crews';
import { flushOutbox, learn, makeAgent, mateFact, perceive, visionOf } from '../src/sim/field/agents';
import { BeliefStore, mkFact } from '../src/sim/field/beliefs';
import { astar, los, staticPass, tileOf } from '../src/sim/field/grid';
import { vesselLevel, vesselName } from '../src/sim/field/catastrophe';
import { SIGN_BASE } from '../src/sim/field/ops';
import { drawCatOver, drawCatUnder } from '../src/view/scene/catLayer';
import type { FieldAgent, MateBelief, Region, SignBelief } from '../src/sim/types';
import { PROBLEM_SYS } from '../scripts/metrics';
import { catStats } from '../scripts/catstats';
import { PROBLEM_LABEL } from '../src/sim/debrief';
import { NORMAL } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { CAT, LOSS_BLAST, LOSS_BURN, LOSS_CREEP, LOSS_FIRE, LOSS_IMPACT, LOSS_N, LOSS_QUAKE, NO_STRUCT, bldgLevel, burnFracOf, catOf, catRng, catTick, collapseBuilding, collapseRegion, gasClouds, vesselKind } from '../src/sim/field/catastrophe';
import { isIndoor } from '../src/sim/field/grid';
import { applyWater, blast } from '../src/sim/field/hazards';
import { addCas, baseScene, set } from '../src/sim/field/kit';
import { FOOT_FLOOR_EDGE, FOOT_IN, FOOT_SHELL, footprint, regionNbrs } from '../src/sim/field/ops';
import { catRule } from '../src/sim/field/rules/catastrophe';
import { SCENE_RULES } from '../src/sim/field/sceneRegistry';
import { agentHealth, tickScene } from '../src/sim/field/sceneManager';
import { closeIncident, createIncident } from '../src/sim/incidents';
import type { Rng } from '../src/sim/rng';
import { T } from '../src/sim/types';
import type { CatState, Incident, IncidentType, OpsState, Prop, Scene } from '../src/sim/types';

// ───────────────────────── 도움 함수 ─────────────────────────
interface Made { sim: Sim; I: Incident; s: Scene }
/** 사건 하나만 있는 교대: 평소 생성기를 건드리지 않게 따로 만든 흐름으로 일으킨다 */
function make(seed: string, type: IncidentType, variant: string, d: Difficulty = NORMAL): Made {
  const sim = new Sim(seed, d);
  const I = createIncident(sim, { type, variant, rng: sim.rng.fork('t') });
  return { sim, I, s: sim.scenes[I.id]! };
}
/** 조건에 맞는 현장이 나올 때까지 시드를 바꿔 찾는다 (찾은 시드는 고정이다 — 생성이 결정적이므로) */
function find(prefix: string, type: IncidentType, variant: string, ok: (m: Made) => boolean, max = 60): Made {
  for (let k = 0; k < max; k++) { const m = make(prefix + k, type, variant); if (ok(m)) return m; }
  throw new Error(`${type}/${variant}: 조건에 맞는 현장을 찾지 못함`);
}
/** 현장만 돌리기: 다른 하위 시스템은 돌지 않으므로 부대가 오지 않는다 (설계서 §10) */
function runAlone(sim: Sim, s: Scene, seconds: number): void {
  for (let k = 0; k < seconds * 5; k++) { sim.tick++; sim.t = sim.tick * sim.dt; tickScene(sim, s); }
}
/** catTick 을 직접 한 번: 시계를 1초 넘기고, tickFire 가 세는 "타는 칸 수"를 맞춘 뒤 부른다 (규칙은 늘 tickFire 뒤에 돈다) */
function stepCat(m: Made, c: CatState): void {
  m.sim.tick += 5; m.sim.t = m.sim.tick * m.sim.dt;
  let b = 0; for (let i = 0; i < m.s.fire.length; i++) if (m.s.fire[i] > 0) b++;
  m.s.burning = b;
  catTick(m.sim, m.s, m.I, c);
}
/** 난수 흐름의 다음 값 (사본에서 본다 — 원본은 소비하지 않는다) */
function peek(r: Rng): number { const c = Object.create(Object.getPrototypeOf(r)); Object.assign(c, r); return (c as Rng).next(); }
/** X6 의 새 칸(s.cat·s.ops·소품의 vessel·heatK·heatLoad)을 뺀 현장·교대의 상태 */
function worldDigest(sim: Sim, s: Scene): string {
  const arr = (a: ArrayLike<number>): string => Array.prototype.join.call(a, ',');
  return JSON.stringify([
    arr(s.tiles), arr(s.region), arr(s.fire), arr(s.heat), arr(s.fuel), arr(s.smoke), arr(s.burned), arr(s.wet), arr(s.decor), arr(s.decorHp), arr(s.glass), arr(s.damage), arr(s.propAt), arr(s.shadow),
    s.props.map((p) => [p.id, p.kind, p.x, p.y, p.w, p.h, p.blocking, p.locked, p.open, p.skin, p.hp, p.leak, p.leakRate, p.mitigated, p.ignited, p.exploded, p.removed, p.bus, p.real, p.fuse]),
    s.casualties.map((c) => [c.x, c.y, c.health, c.bleed, c.mob, c.where, c.dead, c.trapWork, c.walking, c.causeEvent]),
    s.hostiles.map((h) => [h.x, h.y, h.health, h.state]), s.agents.map((a) => [a.rid, a.x, a.y, a.status]),
    s.regions.map((r) => [r.id, r.tiles.length]), s.board.length, s.radio.length, s.fx.length, s.requests.length, s.staticVersion, s.totalFuelTiles, s.burnedTiles, s.burning, s.fireOutAt, [...s.collapseDone],
    sim.events.length, sim.logHash, sim.incidents.map((I) => [I.phase, I.problems.length, I.lastEvent, I.blockedEdge]), sim.placeMarks.size,
    peek(sim.rng), peek(s.rng), peek(sim.rngGen), peek(sim.rngTraffic),
  ]);
}
const indoorRegs = (s: Scene) => s.regions.filter((r) => r.indoor);
const HZ = 0.8 + 0.2 * 1;      // 보통 난이도의 위험 배율(hazardMul = 1)

// ───────────────────────── 자료형 ─────────────────────────
describe('X6 단계 1: 자료형', () => {
  it('새 문제 코드 다섯에 이름표가 있고 측정 도구가 그 코드의 시스템을 안다', () => {
    for (const code of ['DANGER_SIGN', 'WITHDRAWAL', 'STRUCT_COLLAPSE', 'EXPLOSION', 'BURNOUT'] as const) {
      expect(PROBLEM_LABEL[code], code).toBeTruthy();
      expect(PROBLEM_SYS.has(code), code).toBe(true);
    }
    expect(PROBLEM_SYS.get('STRUCT_COLLAPSE')).toBe('building');
    expect(PROBLEM_SYS.get('EXPLOSION')).toBe('hazard');
  });
  it('위험 상태는 구획·칸 수에 맞는 크기로 만들어지고, 같은 현장에는 하나뿐이다', () => {
    const m = make('X6-T1', 'fire', 'std');
    const c = catOf(m.sim, m.s)!;
    expect(c).not.toBeNull();
    expect(m.s.cat).toBe(c);
    expect(catOf(m.sim, m.s)).toBe(c);
    const R = m.s.regions.length, n = m.s.w * m.s.h;
    expect(c.integ.length).toBe(R);
    expect(c.loss.length).toBe(R * LOSS_N);
    expect(c.hotT.length).toBe(R);
    expect(c.l3Since.length).toBe(R);
    expect(c.fallen.length).toBe(R);
    expect(c.causeEv.length).toBe(R);
    expect(c.foot.length).toBe(n);
    expect(c.foot).toBe(footprint(m.s));      // 지휘 쪽과 같은 배열
    expect(c.damage0.length).toBe(n);
    expect(c.fuelMask.length).toBe(n);
    expect(Array.from(c.l3Since).every((v) => v === -1)).toBe(true);
    expect(Array.from(c.causeEv).every((v) => v === -1)).toBe(true);
    expect([c.struct, c.bldg, c.bldgL3Since, c.burntAt, c.totalAt, c.cloudSince, c.utilityAt, c.dustRegion, c.events, c.limitBonus, c.gasN, c.vesselN, c.dustN])
      .toEqual([true, 1, -1, -1, -1, -1, -1, -1, 0, 0, 0, 0, 0]);
    expect(c.hits).toEqual([]); expect(c.shored).toEqual([]); expect(c.flashed).toEqual([]); expect(c.lastFall).toBeNull();
    expect(c.gas).toBeNull(); expect(c.gasTmp).toBeNull();      // 밸브가 없는 현장은 가스 격자를 만들지 않는다
    expect(c.fuel0).toBeGreaterThanOrEqual(CAT.BURNOUT_MIN);
    // 전소 비율의 분모는 건물 칸 위의 연료 칸뿐이다
    for (let i = 0; i < n; i++) if (c.fuelMask[i]) expect(c.foot[i]).toBeGreaterThanOrEqual(1);
  });
  it('가스 누출 현장은 가스 격자를 갖는다', () => {
    const m = make('X6-T2', 'hazmat', 'std');
    const c = catOf(m.sim, m.s)!;
    expect(c.gas).not.toBeNull();
    expect(c.gas!.length).toBe(m.s.w * m.s.h);
    expect(c.gasTmp!.length).toBe(m.s.w * m.s.h);
  });
  it('건물 상태 지도는 교대마다 비어서 시작한다', () => {
    const a = new Sim('X6-PM');
    expect(a.placeMarks).toBeInstanceOf(Map);
    expect(a.placeMarks.size).toBe(0);
  });
  it('현장·소품·대원의 새 칸은 만들 때부터 있다 (객체 모양이 갈라지지 않는다)', () => {
    const m = find('X6-G', 'fire', 'std', (q) => q.s.props.some((p) => p.kind === 'gas'));
    // 값이 없는 칸도 속성으로는 있어야 한다 — catOf 가 값을 넣을 때 객체의 모양이 바뀌지 않는다
    expect('cat' in m.s && 'ops' in m.s).toBe(true);
    for (const p of m.s.props) expect('vessel' in p && 'heatLoad' in p && 'heatK' in p, p.kind).toBe(true);
  });
});

// ───────────────────────── catOf ─────────────────────────
describe('X6 단계 1: catOf — 대상과 입구 (§10-11)', () => {
  it('실내 구획도 용기도 밸브도 없는 현장과 가짜 사건으로 만든 현장은 null 이고 예외가 없다', () => {
    const sim = new Sim('X6-NULL');
    // tests/destruction.test.ts 의 모양: 사건 목록에 없는 가짜 사건
    const bare = baseScene(sim, { id: 0, truth: { type: 'armed', variant: 'test' } } as never, sim.rng.fork('bare'));
    expect(catOf(sim, bare)).toBeNull();
    expect(catOf(sim, bare)).toBeNull();
    expect(bare.cat).toBeUndefined();
    const room = baseScene(sim, { id: 0, truth: { type: 'armed', variant: 'test' } } as never, sim.rng.fork('room'));
    for (let y = 5; y <= 11; y++) for (let x = 5; x <= 15; x++) set(room, x, y, x === 5 || x === 15 || y === 5 || y === 11 ? T.WALL : T.FLOOR);
    room.regions.push({ id: 0, name: '방', kind: 'room', tiles: [6 * room.w + 6], cx: 10, cy: 8, x0: 6, y0: 6, x1: 14, y1: 10, indoor: true, searchable: true });
    expect(sim.incidents.length).toBe(0);
    expect(() => catOf(sim, room)).not.toThrow();
    expect(catOf(sim, room)).toBeNull();
    // 규칙으로 불러도 같다
    expect(() => catRule(sim, room, { id: 0, phase: 'onscene' } as never)).not.toThrow();
  });
  it('교통사고: 연료가 새는 차량이 있으면 대상이고(차량 점화), 없으면 아니다. 건물이 아니므로 구조 규칙은 쓰지 않는다', () => {
    const leaky = find('X6-TL', 'traffic', 'std', (q) => q.s.props.some((p) => p.kind === 'vehicle' && (p.leakRate ?? 0) > 0) && !q.s.props.some((p) => p.bus));
    const c = catOf(leaky.sim, leaky.s)!;
    expect(c).not.toBeNull();
    expect(c.struct).toBe(false);
    const dry = find('X6-TD', 'traffic', 'std', (q) => !q.s.props.some((p) => p.kind === 'vehicle' && ((p.leakRate ?? 0) > 0 || p.bus)));
    expect(catOf(dry.sim, dry.s)).toBeNull();
  });
  it('용기 판별: 가스 용기 · 일반 버스 · 가운데 동체만이고, 동체 기수·꼬리와 열차 객차는 아니다', () => {
    const fire = find('X6-G', 'fire', 'std', (q) => q.s.props.some((p) => p.kind === 'gas'));
    catOf(fire.sim, fire.s);
    for (const p of fire.s.props) expect(p.vessel, p.kind).toBe(p.kind === 'gas' ? 'cylinder' : undefined);
    const bus = make('X6-BUS', 'traffic', 'bus');
    expect(catOf(bus.sim, bus.s)).not.toBeNull();
    const buses = bus.s.props.filter((p) => p.vessel);
    expect(buses.length).toBe(1);
    expect(buses[0].vessel).toBe('cng');
    expect(buses[0].bus).toBe(true);
    for (const p of bus.s.props) if (p.kind === 'vehicle' && !p.bus) expect(p.vessel).toBeUndefined();
    const plane = make('X6-PL', 'fire', 'plane');
    expect(catOf(plane.sim, plane.s)).not.toBeNull();
    const jets = plane.s.props.filter((p) => p.vessel);
    expect(jets.map((p) => [p.vessel, p.skin])).toEqual([['jet', 'fuselageMid']]);
    expect(plane.s.props.filter((p) => p.bus && p.skin !== 'fuselageMid').length).toBeGreaterThan(0);      // 기수·꼬리도 bus: true 다
    const train = make('X6-TR', 'traffic', 'train');
    catOf(train.sim, train.s);
    expect(train.s.props.some((p) => p.skin === 'trainCar' && p.bus)).toBe(true);
    for (const p of train.s.props) expect(p.vessel).toBeUndefined();
    // 판별 함수는 소품만 본다
    expect(vesselKind({ kind: 'vehicle', bus: true, skin: 'trainCar' } as never)).toBeUndefined();
    expect(vesselKind({ kind: 'vehicle', bus: false } as never)).toBeUndefined();
  });
  it('용기의 열 배율은 어느 입구·어느 시각에 처음 불러도 같다 (0.8~1.25, 처음 열은 0)', () => {
    const a = find('X6-G', 'fire', 'std', (q) => q.s.props.some((p) => p.kind === 'gas'));
    catOf(a.sim, a.s);      // 만들자마자 직접
    const b = find('X6-G', 'fire', 'std', (q) => q.s.props.some((p) => p.kind === 'gas'));
    expect(b.sim.seed).toBe(a.sim.seed);
    expect(b.s.cat).toBeUndefined();
    runAlone(b.sim, b.s, 1);      // 세계 규칙이 첫 틱에
    expect(b.s.cat).toBeDefined();
    const ka = a.s.props.filter((p) => p.vessel).map((p) => p.heatK), kb = b.s.props.filter((p) => p.vessel).map((p) => p.heatK);
    expect(ka.length).toBeGreaterThan(0);
    expect(kb).toEqual(ka);
    for (const k of ka) { expect(k).toBeGreaterThanOrEqual(0.8); expect(k).toBeLessThanOrEqual(1.25); }
    for (const p of a.s.props) if (p.vessel) expect(p.heatLoad).toBe(0);
    // catinit 흐름에서 소품 순서대로 한 번씩
    const init = a.sim.rng.fork('catinit:' + a.s.id);
    expect(ka).toEqual(ka.map(() => init.range(0.8, 1.25)));
  });
  it('구조 규칙은 실제 건물만: 비행기·선박·산불·크레인·승강기 현장은 대상이어도 건물이 아니다', () => {
    expect(NO_STRUCT).toEqual(['ship', 'plane', 'train', 'pileup', 'crane', 'landslide', 'elevator', 'wild']);
    expect(catOf(...((m) => [m.sim, m.s] as const)(make('X6-S1', 'fire', 'std')))!.struct).toBe(true);
    expect(catOf(...((m) => [m.sim, m.s] as const)(make('X6-S2', 'collapse', 'std')))!.struct).toBe(true);
    for (const [type, variant] of [['fire', 'plane'], ['fire', 'ship'], ['fire', 'wild'], ['collapse', 'crane'], ['collapse', 'elevator']] as [IncidentType, string][]) {
      const m = make('X6-S3', type, variant), c = catOf(m.sim, m.s);
      if (c) expect(c.struct, `${type}/${variant}`).toBe(false);
    }
  });
  it('처음 값: 보통 건물은 1, 붕괴 현장은 무너진 자리가 있는 구획 0.75 − 0.05 × 심각도 · 그 이웃 0.85', () => {
    const f = make('X6-I1', 'fire', 'std'), cf = catOf(f.sim, f.s)!;
    for (const r of indoorRegs(f.s)) expect(cf.integ[r.id]).toBe(1);
    const k = find('X6-I', 'collapse', 'std', (q) => indoorRegs(q.s).some((r) => r.tiles.some((i) => q.s.damage[i])) && indoorRegs(q.s).some((r) => !r.tiles.some((i) => q.s.damage[i])));
    const c = catOf(k.sim, k.s)!, nb = regionNbrs(k.s);
    const hurt = (rid: number): boolean => k.s.regions[rid].tiles.some((i) => k.s.damage[i] > 0);
    let saw = 0;
    for (const r of indoorRegs(k.s)) {
      if (hurt(r.id)) { expect(c.integ[r.id]).toBeCloseTo(0.75 - 0.05 * k.I.truth.severity, 5); saw |= 1; }
      else if (nb[r.id].some(hurt)) { expect(c.integ[r.id]).toBeCloseTo(0.85, 5); saw |= 2; }
      else { expect(c.integ[r.id]).toBe(1); saw |= 4; }
    }
    expect(saw & 1).toBe(1);
    // 처음부터 삐걱이지는 않는다(단계 1 문턱 0.6 이상), 건물 전체도 임박이 아니다
    for (const r of indoorRegs(k.s)) expect(c.integ[r.id]).toBeGreaterThanOrEqual(CAT.L1 - 1e-6);
    expect(bldgLevel(c, k.s)).toBeLessThan(3);
    expect(Array.from(c.damage0)).toEqual(Array.from(k.s.damage));
    expect(c.damage0).not.toBe(k.s.damage);      // 사본이다
  });
  it('지진 흔들림은 만든 뒤의 것만 받는다 (지난 흔들림을 소급하지 않는다)', () => {
    const m = make('X6-Q1', 'fire', 'std');
    const shakes = [10, 20];
    m.sim.disaster = { shakes } as never;
    const c = catOf(m.sim, m.s)!;
    expect(c.shakeSeen).toBe(2);
    m.s.fire.fill(0);
    stepCat(m, c);
    for (const r of indoorRegs(m.s)) expect(c.integ[r.id]).toBe(1);
    shakes.push(m.sim.t);
    stepCat(m, c);
    for (const r of indoorRegs(m.s)) { expect(c.integ[r.id]).toBeCloseTo(1 - CAT.QUAKE, 5); expect(c.loss[r.id * LOSS_N + LOSS_QUAKE]).toBeCloseTo(CAT.QUAKE, 5); }
    expect(c.shakeSeen).toBe(3);
    stepCat(m, c);      // 같은 흔들림을 두 번 받지 않는다
    for (const r of indoorRegs(m.s)) expect(c.integ[r.id]).toBeCloseTo(1 - CAT.QUAKE, 5);
  });
});

// ───────────────────────── 생김새 도움 함수 ─────────────────────────
describe('X6 단계 1: 건물 칸과 이웃 구획 (ops.ts)', () => {
  const tall = find('X6-F', 'fire', 'std', (q) => q.s.stairTo.some((v) => v >= 0));
  it('건물 칸: 실내 칸은 1, 바깥과 맞닿은 벽은 2, 빈 공간과 맞닿은 벽(층 경계)은 3, 그 밖은 0', () => {
    const s = tall.s, f = footprint(s), w = s.w;
    expect(footprint(s)).toBe(f);      // 한 번만 계산한다
    let shell = 0, edge = 0;
    for (let i = 0; i < f.length; i++) {
      const t = s.tiles[i], x = i % w, y = (i / w) | 0;
      if (isIndoor(t)) { expect(f[i]).toBe(FOOT_IN); continue; }
      if (t !== T.WALL && t !== T.WINDOW) { expect(f[i]).toBe(0); continue; }
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => (x + dx < 0 || y + dy < 0 || x + dx >= w || y + dy >= s.h ? -1 : s.tiles[(y + dy) * w + x + dx]));
      if (f[i] === 0) continue;      // 건물에 붙지 않은 벽
      if (nb.some((q) => q === T.VOID)) { expect(f[i]).toBe(FOOT_FLOOR_EDGE); edge++; }
      else if (nb.some((q) => q === -1 || q === T.GROUND || q === T.ROAD || q === T.TREE || q === T.TRAIL)) { expect(f[i]).toBe(FOOT_SHELL); shell++; }
      else expect(f[i]).toBe(FOOT_IN);
    }
    expect(shell).toBeGreaterThan(10);
    expect(edge).toBeGreaterThan(10);      // 2층 건물의 위층 둘레
  });
  it('건물 칸은 처음 생김새다: 벽이 사라져도 다시 계산하지 않는다', () => {
    const m = make('X6-F9', 'fire', 'std'), f = footprint(m.s);
    const before = Array.from(f);
    const wall = before.findIndex((v) => v === FOOT_SHELL);
    m.s.tiles[wall] = T.FLOOR;
    expect(Array.from(footprint(m.s))).toEqual(before);
  });
  it('이웃 구획: 서로 대칭이고, 실내 구획끼리만이고, 층을 건너지 않는다', () => {
    const s = tall.s, nb = regionNbrs(s);
    expect(regionNbrs(s)).toBe(nb);
    expect(nb.length).toBe(s.regions.length);
    const floorOf = (rid: number): string => s.regions[rid].name.slice(0, 2);      // '1층' · '2층'
    let links = 0;
    for (const r of s.regions) for (const q of nb[r.id]) {
      links++;
      expect(q).not.toBe(r.id);
      expect(nb[q]).toContain(r.id);
      expect(s.regions[q].indoor && r.indoor).toBe(true);
      expect(floorOf(q)).toBe(floorOf(r.id));
    }
    expect(links).toBeGreaterThan(6);
    // 복도는 여러 방과 이웃한다 (지휘 규칙이 복도를 구역에 넣지 않는 까닭)
    const cor = s.regions.find((r) => r.kind === 'corridor' && r.indoor);
    if (cor) expect(nb[cor.id].length).toBeGreaterThanOrEqual(2);
    for (const r of s.regions) if (!r.indoor) expect(nb[r.id]).toEqual([]);
  });
});

// ───────────────────────── 정보 격리 (§10-7) ─────────────────────────
describe('X6: 위험 상태(진실)는 세계 규칙만 읽는다', () => {
  const strip = (code: string): string => code.replace(/\/\*[\s\S]*?\*\//g, '').split('\n').filter((l) => !l.trim().startsWith('//')).map((l) => l.replace(/\s\/\/ .*$/, '')).join('\n');
  const read = (rel: string): string => strip(readFileSync(new URL('../src/sim/' + rel, import.meta.url), 'utf8'));
  const dir = (rel: string): string[] => readdirSync(new URL('../src/sim/' + rel, import.meta.url)).filter((f) => f.endsWith('.ts')).map((f) => rel + f);
  it('지휘관·대원의 판단부·지휘 규칙·지휘 상태 도움 함수·관제는 s.cat·건전도·용기의 열·가스 격자를 읽지 않는다', () => {
    const files = ['field/commander.ts', 'field/brain.ts', 'field/ops.ts', 'field/airDecide.ts', ...dir('field/orders/'), ...dir('dispatch/')];
    expect(files.length).toBeGreaterThan(8);
    for (const f of files) {
      const src = read(f);
      for (const bad of [/\.cat\b/, /heatLoad/, /\binteg\b/, /cat\.gas/, /catOf\(/]) expect(bad.test(src), `${f}: ${bad}`).toBe(false);
    }
  });
  it('생김새 도움 함수(ops.ts)는 불·소품·사람·진실을 읽지 않는다', () => {
    const src = read('field/ops.ts');
    for (const bad of ['.fire', '.smoke', '.props', '.casualties', '.hostiles', '.agents', '.truth', 'sim.scenes']) expect(src.includes(bad), bad).toBe(false);
  });
});

// ───────────────────────── 난수 흐름 ─────────────────────────
describe('X6 단계 1: 새 난수 흐름은 부모를 소비하지 않는다', () => {
  it('catOf 와 catRng 를 불러도 교대·현장·대원의 흐름은 그대로다', () => {
    const m = find('X6-G', 'fire', 'std', (q) => q.s.props.some((p) => p.kind === 'gas'));
    const before = [peek(m.sim.rng), peek(m.sim.rngGen), peek(m.sim.rngTraffic), peek(m.sim.rngMajor), peek(m.sim.rngNuisance), peek(m.s.rng)];
    catOf(m.sim, m.s);
    const r = catRng(m.sim, m.s);
    for (let k = 0; k < 20; k++) r.next();
    expect([peek(m.sim.rng), peek(m.sim.rngGen), peek(m.sim.rngTraffic), peek(m.sim.rngMajor), peek(m.sim.rngNuisance), peek(m.s.rng)]).toEqual(before);
  });
  it('catRng 는 현장마다 하나이고 cat:<현장 id> 흐름이다', () => {
    const a = make('X6-R1', 'fire', 'std'), b = make('X6-R1', 'fire', 'std');
    expect(catRng(a.sim, a.s)).toBe(catRng(a.sim, a.s));
    const want = a.sim.rng.fork('cat:' + a.s.id);
    const xs = [0, 1, 2].map(() => catRng(a.sim, a.s).next());
    expect(xs).toEqual([0, 1, 2].map(() => want.next()));
    // 같은 시드의 다른 교대에서도 같은 값으로 시작한다 (언제 처음 부르든)
    runAlone(b.sim, b.s, 30);
    expect([0, 1, 2].map(() => catRng(b.sim, b.s).next())).toEqual(xs);
  });
});

// ───────────────────────── 계산만 하는 틱 ─────────────────────────
describe('X6 단계 1: 틱은 계산만 한다 — 손 계산', () => {
  /** 불을 모두 끄고 탄 자리를 지운 화재 현장과, 칸이 여섯 넘는 방 하나 */
  function quiet(seed: string) {
    const m = make(seed, 'fire', 'std');
    m.s.fire.fill(0); m.s.burned.fill(0); m.s.burnedTiles = 0; m.s.wet.fill(0); m.s.heat.fill(0);
    const c = catOf(m.sim, m.s)!;
    const r = indoorRegs(m.s).filter((q) => q.kind === 'room' && q.tiles.length >= 6).sort((p, q) => q.tiles.length - p.tiles.length)[0];
    return { m, c, r };
  }
  it('불의 열: 구획이 통째로 타면 초당 K_HEAT 만큼, 젖어 있으면 0.4배로 깎인다', () => {
    const { m, c, r } = quiet('X6-H1');
    for (const i of r.tiles) m.s.fire[i] = 1;
    stepCat(m, c);
    expect(c.integ[r.id]).toBeCloseTo(1 - CAT.K_HEAT * HZ, 6);
    expect(c.loss[r.id * LOSS_N + LOSS_FIRE]).toBeCloseTo(CAT.K_HEAT * HZ, 6);
    expect(c.hotT[r.id]).toBe(1);
    for (const i of r.tiles) m.s.wet[i] = 1;
    stepCat(m, c);
    expect(c.integ[r.id]).toBeCloseTo(1 - CAT.K_HEAT * HZ * 1.4, 6);
    expect(c.hotT[r.id]).toBe(2);
    // 약한 불(0.3 미만)은 골조를 깎지 않는다
    for (const i of r.tiles) { m.s.fire[i] = 0.29; m.s.wet[i] = 0; }
    const v = c.integ[r.id];
    stepCat(m, c);
    expect(c.integ[r.id]).toBe(v);
    expect(c.hotT[r.id]).toBe(2);
  });
  it('탄 몫이 상한을 내린다: 방의 절반이 타면 0.5 를 넘지 못하고, 불이 꺼져도 되돌아오지 않는다', () => {
    const { m, c, r } = quiet('X6-H2');
    const half = r.tiles.slice(0, Math.floor(r.tiles.length / 2));
    for (const i of half) m.s.burned[i] = 1;
    m.s.burnedTiles = half.length;
    stepCat(m, c);
    const cap = 1 - half.length / r.tiles.length;
    expect(c.integ[r.id]).toBeCloseTo(cap, 6);
    expect(c.loss[r.id * LOSS_N + LOSS_BURN]).toBeCloseTo(1 - cap, 6);
    for (let k = 0; k < 5; k++) stepCat(m, c);
    expect(c.integ[r.id]).toBeCloseTo(cap, 6);
    // 건물 건전도 = 서 있는 구획의 칸 수 가중 평균
    let all = 0, up = 0;
    for (const q of indoorRegs(m.s)) { all += q.tiles.length; up += q.tiles.length * c.integ[q.id]; }
    expect(c.bldg).toBeCloseTo(up / all, 6);
  });
  it('임박 시각: 건전도가 0.36 아래로 내려간 때를 적고, 다시 올라가면 지운다. 건물 전체도 같다', () => {
    const { m, c, r } = quiet('X6-H3');
    c.integ[r.id] = 0.3;
    stepCat(m, c);
    const t0 = m.sim.t;
    expect(c.l3Since[r.id]).toBeCloseTo(t0, 3);
    stepCat(m, c); stepCat(m, c);
    expect(c.l3Since[r.id]).toBeCloseTo(t0, 3);      // 이어지는 동안 그대로
    c.integ[r.id] = 0.5;
    stepCat(m, c);
    expect(c.l3Since[r.id]).toBe(-1);
    expect(c.bldgL3Since).toBe(-1);
    for (const q of indoorRegs(m.s)) c.integ[q.id] = 0.2;
    stepCat(m, c);
    expect(c.bldgL3Since).toBeCloseTo(m.sim.t, 3);
    expect(bldgLevel(c, m.s)).toBe(3);
    for (const q of indoorRegs(m.s)) c.integ[q.id] = 0.48;
    stepCat(m, c);
    expect(c.bldgL3Since).toBe(-1);
    expect(bldgLevel(c, m.s)).toBe(2);
  });
  it('균열: 보강하지 않으면 초당 K_CREEP 씩 깎고, 보강하면 멈추며 +0.1 을 한 번만 되찾는다', () => {
    const k = find('X6-C', 'collapse', 'std', (q) => q.s.props.some((p) => p.kind === 'unstable' && (p.leakRate ?? 0) > 0 && q.s.region[p.y * q.s.w + p.x] >= 0 && q.s.regions[q.s.region[p.y * q.s.w + p.x]].indoor));
    k.s.fire.fill(0); k.s.burned.fill(0); k.s.burnedTiles = 0;
    const c = catOf(k.sim, k.s)!;
    const cracks = k.s.props.filter((p) => p.kind === 'unstable' && (p.leakRate ?? 0) > 0);
    const p = cracks.find((q) => k.s.region[q.y * k.s.w + q.x] >= 0 && k.s.regions[k.s.region[q.y * k.s.w + q.x]].indoor)!;
    const rid = k.s.region[p.y * k.s.w + p.x];
    const here = cracks.filter((q) => k.s.region[q.y * k.s.w + q.x] === rid).length;
    const v0 = c.integ[rid];
    for (let t = 0; t < 10; t++) stepCat(k, c);
    expect(c.integ[rid]).toBeCloseTo(v0 - 10 * here * CAT.K_CREEP * HZ, 5);
    expect(c.loss[rid * LOSS_N + LOSS_CREEP]).toBeCloseTo(10 * here * CAT.K_CREEP * HZ, 5);
    for (const q of cracks) q.mitigated = true;
    const v1 = c.integ[rid];
    stepCat(k, c);
    expect(c.integ[rid]).toBeCloseTo(Math.min(1, v1 + CAT.SHORE * here), 5);
    expect(c.shored.slice().sort((a, b) => a - b)).toEqual(cracks.map((q) => q.id).sort((a, b) => a - b));
    const v2 = c.integ[rid];
    for (let t = 0; t < 10; t++) stepCat(k, c);
    expect(c.integ[rid]).toBe(v2);      // 더 깎이지도, 다시 오르지도 않는다
  });
  it('용기의 열: 곁의 불이 달구고(안전밸브 단계가 한계보다 먼저) 한계에서 터진다(§10-1 — 단계 4). 물을 맞으면 오르지 않고, 불이 꺼지면 식는다', () => {
    const fresh = (): { m: Made; c: CatState; p: Prop; side: number } => {
      const m = find('X6-G', 'fire', 'std', (q) => q.s.props.some((p) => p.kind === 'gas'));
      m.s.fire.fill(0); m.s.wet.fill(0);
      const c = catOf(m.sim, m.s)!;
      const p = m.s.props.find((q) => q.vessel === 'cylinder')!;
      const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => (p.y + dy) * m.s.w + p.x + dx)[0];
      return { m, c, p, side };
    };
    {
      const { m, c, p, side } = fresh();
      let ventAt = -1, fullAt = -1;
      for (let t = 1; t <= 80 && !p.exploded; t++) {
        m.s.fire.fill(0); m.s.fire[side] = 0.8;      // 바로 옆 칸 하나의 불을 0.8 로 유지한다 (자기 칸의 1.25배를 피한다)
        stepCat(m, c);
        if (ventAt < 0 && p.heatLoad! >= CAT.VENT_AT) ventAt = t;
        if (fullAt < 0 && p.heatLoad! >= 1) fullAt = t;
      }
      const rate = CAT.VESSEL_HEAT.cylinder * 0.8 * p.heatK!;
      expect(ventAt).toBe(Math.ceil(CAT.VENT_AT / rate - 1e-6));
      expect(fullAt).toBe(Math.ceil(1 / rate - 1e-6));
      expect(ventAt).toBeLessThan(fullAt);
      expect(fullAt).toBeGreaterThanOrEqual(20); expect(fullAt).toBeLessThanOrEqual(80);
      expect(p.heatLoad).toBe(1);      // 넘치지 않는다
      expect(p.exploded).toBe(true);      // 한계에 닿은 그 초에 터진다 (단계 4)
      expect(c.vesselN).toBe(1);
      const rec = m.I.problems.find((q) => q.detail === '보관 중이던 가스 용기 폭발')!;
      expect(rec.code).toBe('HIDDEN_HAZARD');      // 지휘관이 없다 — 몰랐던 위험
      expect(m.sim.events[rec.eventId].text).toBe('폭발! 불길에 달궈진 가스 용기가 터졌습니다.');
      // 둘레 2.3칸의 연료 칸에 불, 폭발 그림 꼬리표, 현장 전원이 들을 소리
      expect(m.s.fx.some((f) => f.kind === 'boom' && f.c?.src === 'tank' && f.c?.r === 3.6)).toBe(true);
      const msg = m.s.radio.find((q) => q.eventId === rec.eventId)!;
      expect(msg.facts.some((f) => f.type === 'haz' && f.id === p.id && f.value.active === false)).toBe(true);
      expect(msg.facts.some((f) => f.type === 'sign' && f.id === SIGN_BASE.vessel + p.id && f.value.level === 0 && f.value.down)).toBe(true);
      let lit = 0; for (let y = p.y - 2; y <= p.y + 2; y++) for (let x = p.x - 2; x <= p.x + 2; x++) { const j = y * m.s.w + x; if (Math.hypot(x - p.x, y - p.y) <= 2.3 && m.s.fuel[j] > 0 && m.s.fire[j] >= 0.85) lit++; }
      expect(lit).toBeGreaterThan(0);
      // 터진 용기는 다시 터지지 않는다
      for (let t = 0; t < 5; t++) { m.s.fire[side] = 0.8; stepCat(m, c); }
      expect(c.vesselN).toBe(1);
    }
    {
      // 불이 꺼지면 초당 0.012 씩 식는다
      const { m, c, p, side } = fresh();
      for (let t = 0; t < 20; t++) { m.s.fire.fill(0); m.s.fire[side] = 0.8; stepCat(m, c); }
      const h0 = p.heatLoad!;
      expect(h0).toBeGreaterThan(0.2);
      m.s.fire.fill(0);
      for (let t = 0; t < 10; t++) stepCat(m, c);
      expect(p.heatLoad).toBeCloseTo(h0 - 10 * CAT.VESSEL_IDLE, 5);
      // 매초 물을 뿌리면 같은 불 곁에서도 달궈지지 않는다 (§10-2 ③ — 폭발 없음)
      p.heatLoad = 0;
      let peakHeat = 0;
      for (let t = 1; t <= 80; t++) {
        m.s.fire.fill(0); m.s.fire[side] = 0.8;
        applyWater(m.s, p.x, p.y, 0.3);
        m.s.fire[side] = 0.8;
        stepCat(m, c);
        peakHeat = Math.max(peakHeat, p.heatLoad!);
      }
      expect(peakHeat).toBeLessThan(0.3);
      expect(p.exploded).toBeFalsy();
    }
  });
  it('가스: 실내 칸에만 있고, 가스 칸끼리만 주고받으며(합이 보존된다) 벽 틈으로 초당 0.4% 가 샌다', () => {
    const m = make('X6-GS1', 'hazmat', 'std');
    const c = catOf(m.sim, m.s)!, g = c.gas!, s = m.s, w = s.w;
    for (const p of s.props) if (p.kind === 'valve') p.mitigated = true;      // 원천 없이
    // 바깥 출입문(환기)에서 다섯 칸 넘게 떨어지고 문과 맞닿지 않은 바닥 칸 하나에 가스를 놓는다 (창은 깨지지 않았으므로 막힌 칸이다)
    const out = (t: number): boolean => t === T.GROUND || t === T.ROAD || t === T.TREE || t === T.TRAIL;
    const exits: number[] = [];
    for (let i = 0; i < g.length; i++) if (s.tiles[i] === T.DOOR && [1, -1, w, -w].some((d) => i + d >= 0 && i + d < g.length && out(s.tiles[i + d]))) exits.push(i);
    const far = (i: number): boolean => {
      const x = i % w, y = (i / w) | 0;
      if ([1, -1, w, -w].some((d) => s.tiles[i + d] === T.DOOR || s.tiles[i + d] === T.STAIR)) return false;
      return exits.every((e) => Math.abs((e % w) - x) + Math.abs(((e / w) | 0) - y) > 5);
    };
    let at = -1;
    for (let i = w; i < g.length - w && at < 0; i++) if (s.tiles[i] === T.FLOOR && far(i)) at = i;
    expect(at).toBeGreaterThanOrEqual(0);
    g[at] = 1;
    stepCat(m, c);
    let sum = 0; for (let i = 0; i < g.length; i++) { sum += g[i]; if (g[i] > 0) expect(isIndoor(s.tiles[i])).toBe(true); }
    expect(sum).toBeCloseTo(1 - CAT.GAS_SEEP, 5);
    // 한 걸음: 가운데 칸은 이웃 가스 칸 수 × D 만큼 내준다
    let nb = 0; for (const d of [1, -1, w, -w]) if (isIndoor(s.tiles[at + d])) nb++;
    expect(g[at]).toBeCloseTo((1 - CAT.GAS_D * nb) * (1 - CAT.GAS_SEEP), 5);
    stepCat(m, c); stepCat(m, c);
    let sum3 = 0; for (let i = 0; i < g.length; i++) sum3 += g[i];
    expect(sum3).toBeCloseTo(Math.pow(1 - CAT.GAS_SEEP, 3), 4);
  });
  it('가스: 새는 밸브가 있으면 쌓이고, 차단하면 줄어든다. 폭발 하한을 넘은 칸이 셋 이상 이어지면 구름의 나이를 잰다', () => {
    const m = find('X6-GS', 'hazmat', 'std', (q) => q.s.props.some((p) => p.kind === 'valve' && (p.leakRate ?? 0) >= 0.6));
    const c = catOf(m.sim, m.s)!, g = c.gas!;
    const max = (): number => { let v = 0; for (let i = 0; i < g.length; i++) if (g[i] > v) v = g[i]; return v; };
    for (let t = 0; t < 30; t++) stepCat(m, c);
    const m30 = max();
    expect(m30).toBeGreaterThan(0.1);
    for (let i = 0; i < g.length; i++) { expect(g[i]).toBeLessThanOrEqual(CAT.GAS_MAX); if (g[i] > 0) expect(isIndoor(m.s.tiles[i])).toBe(true); }
    for (const p of m.s.props) if (p.kind === 'valve') p.mitigated = true;
    for (let t = 0; t < 60; t++) stepCat(m, c);
    expect(max()).toBeLessThan(m30);
    // 구름: 이어진 세 칸을 폭발 하한 위로 올리면 나이를 재기 시작하고, 사라지면 지운다
    expect(c.cloudSince).toBe(-1);
    const v = m.s.props.find((p) => p.kind === 'valve')!;
    const row: number[] = [];
    for (let i = 0; i < g.length && row.length < 3; i++) { if (m.s.tiles[i] === T.FLOOR && m.s.tiles[i + 1] === T.FLOOR && m.s.tiles[i + 2] === T.FLOOR && (i % m.s.w) + 2 < m.s.w) row.push(i, i + 1, i + 2); }
    g.fill(0);
    for (const i of row) g[i] = 3;      // 한 걸음에 많아야 0.12 × 이웃 셋 × 3 을 내준다 — 셋 다 폭발 하한 위에 남는다
    expect(gasClouds(c, m.s)).toEqual([row]);
    stepCat(m, c);
    expect(gasClouds(c, m.s)[0].length).toBeGreaterThanOrEqual(CAT.CLOUD_MIN);
    const born = m.sim.t;
    expect(c.cloudSince).toBeCloseTo(born, 3);
    for (const i of row) g[i] = 3;
    stepCat(m, c);
    expect(c.cloudSince).toBeCloseTo(born, 3);      // 이어지는 동안 그대로
    g.fill(0);
    stepCat(m, c);
    expect(c.cloudSince).toBe(-1);
    expect(gasClouds(c, m.s)).toEqual([]);
    expect(v.ignited).toBeFalsy();      // 점화원이 없으면 터지지 않는다 (불·충격이 없고, 막 생긴 구름에는 스파크도 없다 — 나이 0)
  });
  it('전소 판정: 건물 칸 위의 연료 칸이 70% 넘게 타면 그 시각에 한 번 BURNOUT 을 남기고 건물 상태를 지도에 적는다 (단계 3)', () => {
    const { m, c } = quiet('X6-B1');
    const fuelTiles: number[] = [];
    for (let i = 0; i < c.fuelMask.length; i++) if (c.fuelMask[i]) fuelTiles.push(i);
    expect(fuelTiles.length).toBe(c.fuel0);
    const burn = (k: number): void => { for (let q = 0; q < fuelTiles.length; q++) m.s.burned[fuelTiles[q]] = q < k ? 1 : 0; m.s.burnedTiles = k; };
    const burnouts = (): number => m.I.problems.filter((p) => p.code === 'BURNOUT').length;
    burn(Math.ceil(c.fuel0 * 0.7) - 1);
    stepCat(m, c);
    expect(burnFracOf(c, m.s)).toBeLessThan(CAT.BURNOUT);
    expect(c.burntAt).toBe(-1);
    expect(burnouts()).toBe(0);
    burn(Math.ceil(c.fuel0 * 0.7));
    stepCat(m, c);
    expect(burnFracOf(c, m.s)).toBeGreaterThanOrEqual(CAT.BURNOUT);
    expect(c.burntAt).toBeCloseTo(m.sim.t, 3);
    const at = c.burntAt;
    burn(c.fuel0);
    stepCat(m, c);
    expect(c.burntAt).toBe(at);      // 한 번만
    expect(burnFracOf(c, m.s)).toBe(1);
    expect(burnouts()).toBe(1);
    const p = m.I.problems.find((q) => q.code === 'BURNOUT')!;
    expect(p.detail).toMatch(/^건물 전소 — /);
    expect(p.t).toBeCloseTo(at, 3);
    expect(m.sim.events[p.eventId].text).toContain('전소');
    const mark = m.sim.placeMarks.get(m.I.truth.placeId)!;
    expect(['burnt', 'collapsed']).toContain(mark.state);      // 다 탄 방은 그 자리에서 무너질 수 있다 (탄 몫 상한 0)
    expect(mark.incidentId).toBe(m.I.id);
    expect(mark.burnFrac).toBe(1);
  });
});

// ───────────────────────── 세계 — 구조 (단계 3) ─────────────────────────
/** X6 의 폭발 기록 문구 (HIDDEN_HAZARD 로 남을 때 — 지휘관이 몰랐던 위험): 가스 구름 · 용기 넷 · (단계 9) 분진 */
const X6_BOOM = /^(누출된 가스 폭발 — |보관 중이던 가스 용기 폭발$|화학 드럼 파열$|CNG 버스 가스 용기 폭발$|항공유 폭발$|분진 폭발)/;
/** X6 가 남긴 기록의 수 (현장별): 구획 붕괴 · 전체 붕괴 · 전소 · 폭발 (EXPLOSION 전부 + X6 문구의 HIDDEN_HAZARD) */
function x6Count(I: Incident): { partial: number; total: number; burnout: number; boom: number } {
  let partial = 0, total = 0, burnout = 0, boom = 0;
  for (const p of I.problems) {
    if (p.code === 'BURNOUT') burnout++;
    else if (p.code === 'STRUCT_COLLAPSE') { if (p.detail.startsWith('건물 전체 붕괴')) total++; else partial++; }
    else if (p.code === 'EXPLOSION' || (p.code === 'HIDDEN_HAZARD' && X6_BOOM.test(p.detail))) boom++;
  }
  return { partial, total, burnout, boom };
}
/**
 * §10-8 가짜 연출 없음: STRUCT_COLLAPSE 기록 = 하나씩 무너진 구획 수 + 전체 붕괴 수, BURNOUT 은 전소 판정이 난 실제 건물 현장에 정확히 하나,
 * X6 의 폭발 기록 = 현장의 c.gasN + c.vesselN + c.dustN (소품 깃발로 세지 않는다), 닫힌 뒤에는 0건
 */
function checkHonest(sim: Sim): { partial: number; total: number; burnout: number; boom: number } {
  const sum = { partial: 0, total: 0, burnout: 0, boom: 0 };
  for (const I of sim.incidents) {
    const s = sim.scenes[I.id];
    const n = x6Count(I);
    sum.partial += n.partial; sum.total += n.total; sum.burnout += n.burnout; sum.boom += n.boom;
    const c = s?.cat;
    if (!c) { expect(n.partial + n.total + n.burnout + n.boom, I.code).toBe(0); continue; }
    expect(n.boom, I.code).toBe(c.gasN + c.vesselN + c.dustN);
    if (I.phase === 'closed') for (const p of I.problems) if (p.code === 'EXPLOSION' || (p.code === 'HIDDEN_HAZARD' && X6_BOOM.test(p.detail))) expect(p.t, I.code).toBeLessThanOrEqual(I.closedAt + 1e-9);
    const fallen = s!.regions.filter((r) => r.indoor && c.fallen[r.id]).length;
    if (c.totalAt < 0) { expect(n.partial, I.code).toBe(fallen); expect(n.total, I.code).toBe(0); }
    else { expect(n.total, I.code).toBe(1); expect(n.partial, I.code).toBeLessThanOrEqual(fallen); }
    expect(n.burnout, I.code).toBe(c.burntAt >= 0 ? 1 : 0);
    if (n.partial + n.total + n.burnout) expect(c.struct, I.code).toBe(true);
    if (I.phase === 'closed') for (const p of I.problems) if (p.code === 'STRUCT_COLLAPSE' || p.code === 'BURNOUT') expect(p.t, I.code).toBeLessThanOrEqual(I.closedAt + 1e-9);
  }
  return sum;
}
/** 2층 건물 화재 현장 (빈 공간과 계단이 있다) */
const tall = (prefix: string): Made => find(prefix, 'fire', 'std', (q) => q.s.tiles.some((v) => v === T.VOID) && q.s.stairTo.some((v) => v >= 0));
/** 걸을 수 있는 칸끼리 4방향으로 이은 덩어리 번호 (계단은 잇지 않는다 — 층을 가른다) */
function floorsOf(s: Scene): Int32Array {
  const lab = new Int32Array(s.w * s.h).fill(-1);
  let k = 0;
  for (let i0 = 0; i0 < lab.length; i0++) {
    if (lab[i0] >= 0 || !staticPass(s.tiles[i0])) continue;
    const q = [i0]; lab[i0] = k;
    for (let h = 0; h < q.length; h++) {
      const i = q[h], x = i % s.w;
      for (const j of [x + 1 < s.w ? i + 1 : -1, x > 0 ? i - 1 : -1, i + s.w < lab.length ? i + s.w : -1, i - s.w]) if (j >= 0 && lab[j] < 0 && staticPass(s.tiles[j])) { lab[j] = k; q.push(j); }
    }
    k++;
  }
  return lab;
}

describe('X6 단계 3: 세계 — 방치하면 무너지고 다 탄다 (§10-1)', () => {
  it('방치된 화재: 900초 혼자 두면 전소(BURNOUT) 기록·구획 붕괴·건물 상태(전소 또는 전체 붕괴)가 남는다', () => {
    const m = make('X6-T1', 'fire', 'std');
    runAlone(m.sim, m.s, 900);
    const c = m.s.cat!;
    expect(c.burntAt).toBeGreaterThanOrEqual(0);
    const n = x6Count(m.I);
    expect(n.burnout).toBe(1);
    expect(n.partial + n.total).toBeGreaterThanOrEqual(1);
    expect(['burnt', 'collapsed']).toContain(m.sim.placeMarks.get(m.I.truth.placeId)?.state);
    // 불로 무너진 구획의 원인 문구와 그림 기록 (G4 의 'ceiling' 을 이어받는다)
    expect(m.I.problems.some((p) => p.code === 'STRUCT_COLLAPSE' && /달궈짐|골조가 타서/.test(p.detail))).toBe(true);
    expect((m.s.falls ?? []).some((f) => f.cause === 'ceiling')).toBe(true);
    // 예전 규칙(천장 일부 붕괴)은 더는 없다
    expect(m.I.problems.some((p) => p.code === 'ESCALATION' && p.detail.endsWith('천장 일부 붕괴'))).toBe(false);
    checkHonest(m.sim);
    // 원인 사슬: 붕괴 기록은 그 구획을 깎은 기록을 원인으로 가리킨다
    const first = m.I.problems.find((p) => p.code === 'STRUCT_COLLAPSE')!;
    expect(m.sim.events[first.eventId].causes.length).toBeGreaterThan(0);
  });
  it('붕괴 현장: 무너진 자리가 있는 구획의 건전도를 0.2 로 두면 60초 안에 무너지고, 그 안의 구조 대상은 숨지거나 갇히거나 못 걷게 된다', () => {
    const pickRegion = (q: Made): Region | undefined => {
      const c = catOf(q.sim, q.s)!;
      return indoorRegs(q.s).find((r) => c.integ[r.id] < 0.8 && q.s.casualties.some((x) => x.where === 'scene' && !x.dead && q.s.region[tileOf(q.s, x.x, x.y)] === r.id));
    };
    const m = find('X6-T2', 'collapse', 'std', (q) => pickRegion(q) !== undefined);
    const c = catOf(m.sim, m.s)!, r = pickRegion(m)!;
    c.integ[r.id] = 0.2;
    for (let k = 0; k < 60 * 5 && !c.fallen[r.id]; k++) { m.sim.tick++; m.sim.t = m.sim.tick * m.sim.dt; tickScene(m.sim, m.s); }
    expect(c.fallen[r.id]).toBe(1);
    const p = m.I.problems.find((q) => q.code === 'STRUCT_COLLAPSE' && q.detail.startsWith(r.name))!;
    expect(p).toBeTruthy();
    const inside = m.s.casualties.filter((x) => x.where === 'scene' && m.s.region[tileOf(m.s, x.x, x.y)] === r.id);
    expect(inside.length).toBeGreaterThan(0);
    for (const x of inside) {
      expect(x.health <= 0 || x.dead || x.mob === 'trapped' || x.mob === 'immobile', x.label).toBe(true);
      if (!x.dead) expect(x.causeEvent, x.label).toBe(p.eventId);      // 피해의 원인은 그 붕괴 기록이다 ({ ev })
    }
    // 무너진 칸 · 한계 시간 보탬 · 지도 · 그림 기록
    expect(r.tiles.every((i) => m.s.damage[i] === 1)).toBe(true);
    expect(c.limitBonus).toBeGreaterThanOrEqual(60);
    expect(['partial', 'collapsed']).toContain(m.sim.placeMarks.get(m.I.truth.placeId)?.state);
    expect(m.s.falls!.some((f) => f.cause === 'partial' || f.cause === 'ceiling')).toBe(true);
  });
  it('조치하면 무너지지 않는다 (§10-2 ①): 균열을 모두 보강하고 건전도 0.5 면 300초 동안 구획 붕괴가 없다', () => {
    const m = find('X6-T3', 'collapse', 'std', (q) => q.s.props.some((p) => p.kind === 'unstable') && !q.s.fire.some((v) => v > 0) && !q.s.props.some((p) => p.kind === 'valve' || p.kind === 'gas'));
    const c = catOf(m.sim, m.s)!;
    for (const p of m.s.props) if (p.kind === 'unstable') p.mitigated = true;
    for (const r of indoorRegs(m.s)) c.integ[r.id] = Math.min(c.integ[r.id], 0.5);
    runAlone(m.sim, m.s, 300);
    expect(x6Count(m.I).partial + x6Count(m.I).total).toBe(0);
    expect(Array.from(c.fallen).every((v) => v === 0)).toBe(true);
    expect(m.I.problems.some((p) => p.code === 'ESCALATION' && p.detail.endsWith('2차 붕괴'))).toBe(false);
  });
});

describe('X6 단계 3: 세계 — 충격·전체 붕괴·층 (§10-5·§10-9·§10-10)', () => {
  it('blast 의 구조 충격 (손 계산): 2차 붕괴(28, 무너져 내림)는 가운데 구획을 0.14, 폭발물(55, 폭발)은 0.44 깎고 충격 자리를 남긴다', () => {
    const m = make('X6-H1', 'fire', 'std');
    m.s.fire.fill(0);
    const c = catOf(m.sim, m.s)!;
    const r = indoorRegs(m.s).filter((q) => q.kind === 'room').sort((p, q) => q.tiles.length - p.tiles.length)[0];
    const v0 = c.integ[r.id];
    blast(m.sim, m.s, m.I, r.cx, r.cy, 2.6, 28, 7, 'crush');
    expect(v0 - c.integ[r.id]).toBeCloseTo(CAT.K_HIT_CRUSH * 0.28, 6);
    expect(c.loss[r.id * LOSS_N + LOSS_IMPACT]).toBeCloseTo(0.14, 6);
    expect(c.causeEv[r.id]).toBe(7);
    const v1 = c.integ[r.id];
    blast(m.sim, m.s, m.I, r.cx, r.cy, 3.4, 55, 8);
    expect(v1 - c.integ[r.id]).toBeCloseTo(CAT.K_HIT_BLAST * 0.55, 6);
    expect(c.loss[r.id * LOSS_N + LOSS_BLAST]).toBeCloseTo(0.44, 6);
    expect(c.hits.length).toBe(2);
    expect(c.hits[1]).toEqual({ t: m.sim.t, x: r.cx, y: r.cy });
    // 멀리 떨어진 구획(가운데가 반경 + 2 밖)은 그대로다
    for (const q of indoorRegs(m.s)) if (Math.hypot(q.cx - r.cx, q.cy - r.cy) >= 3.4 + 2) expect(c.integ[q.id]).toBe(1);
  });
  it('전체 붕괴: 안쪽 벽은 모두·바깥벽은 일부 사라지고 문은 열리며, 대기 지점에서 모든 바닥 칸에 닿는다(잔해는 치울 수 있다). 길이 통제되고 지도에 남는다', () => {
    const m = make('X6-H2', 'fire', 'std');
    const c = catOf(m.sim, m.s)!, s = m.s;
    const tiles0 = s.tiles.slice();
    const ev = collapseBuilding(m.sim, s, m.I, c);
    expect(m.sim.events[ev].problem).toBe('STRUCT_COLLAPSE');
    expect(c.totalAt).toBeCloseTo(m.sim.t, 6);
    expect(indoorRegs(s).every((r) => c.fallen[r.id] === 1)).toBe(true);
    let shell = 0, shellLeft = 0;
    for (let i = 0; i < s.tiles.length; i++) {
      if (c.foot[i] === FOOT_IN && (tiles0[i] === T.WALL || tiles0[i] === T.WINDOW)) expect(s.tiles[i]).toBe(T.FLOOR);
      if (c.foot[i] === FOOT_SHELL) { shell++; if (s.tiles[i] === T.WALL || s.tiles[i] === T.WINDOW) shellLeft++; }
      if (c.foot[i] === FOOT_FLOOR_EDGE) expect(s.tiles[i]).toBe(tiles0[i]);
      if (tiles0[i] === T.STAIR) expect(s.tiles[i]).toBe(T.STAIR);
      if (tiles0[i] === T.DOOR || tiles0[i] === T.FURN) expect(s.tiles[i]).toBe(T.FLOOR);
    }
    expect(shellLeft).toBeGreaterThan(0); expect(shellLeft).toBeLessThan(shell);      // 그루터기가 남는다
    for (const p of s.props) if (p.kind === 'door') { expect(p.removed).toBe(true); expect(p.blocking).toBe(false); }
    // 모든 바닥 칸에 대기 지점에서 닿는다 (잔해 소품은 지나갈 수 있는 것으로 본다 — 치울 수 있다)
    const cost = (j: number): number => (staticPass(s.tiles[j]) ? (s.propAt[j] >= 0 && s.props[s.propAt[j]].kind !== 'debris' ? -1 : 0) : -1);
    let unreached = 0, floors = 0;
    for (let i = 0; i < s.tiles.length; i++) {
      if (!staticPass(s.tiles[i]) || c.foot[i] === 0) continue;
      floors++;
      if (!astar(s, s.staging.x, s.staging.y, i % s.w, (i / s.w) | 0, 0, cost)) unreached++;
    }
    expect(floors).toBeGreaterThan(50);
    expect(unreached).toBe(0);
    // 길: 큰 차가 돌아갈 수 있는 구간 하나를 사건 동안 막는다 (known 은 건드리지 않는다)
    expect(m.I.blockedEdge).toBeGreaterThanOrEqual(0);
    const e = m.sim.city.edges[m.I.blockedEdge];
    expect(e.closed).toBe(true); expect(e.closedReason).toBe('incident');
    expect(m.sim.events[m.I.blockEv!].text).toMatch(/^건물 붕괴 잔해로 .* 통제$/);
    expect(m.sim.placeMarks.get(m.I.truth.placeId)?.state).toBe('collapsed');
    expect(c.limitBonus).toBe(180);
    expect(s.falls!.some((f) => f.cause === 'total')).toBe(true);
    // 현장 전원이 들을 소리: 전체 붕괴 + 건물 조짐 3
    const msg = s.radio.find((q) => q.eventId === ev)!;
    expect(msg.to).toBe(-1);
    expect(msg.facts.some((f) => f.type === 'sign' && f.value.kind === 'event' && f.value.what === 'total')).toBe(true);
    expect(msg.facts.some((f) => f.type === 'sign' && f.id === SIGN_BASE.bldg && f.value.level === 3)).toBe(true);
    closeIncident(m.sim, m.I, 'resolved');
    expect(e.closed).toBe(false);
  });
  it('2층 건물의 전체 붕괴: 빈 공간과 맞닿은 벽(층 경계)은 그대로이고 위층과 그 밖의 바닥은 4칸 이상 떨어져 있다. 계단으로 위층 잔해에 오른다', () => {
    const m = tall('X6-H3');
    const c = catOf(m.sim, m.s)!, s = m.s;
    const before = floorsOf(s);
    const st = s.stairTo.findIndex((v) => v >= 0);
    const upper = before[s.stairTo[st]];
    expect(upper).not.toBe(before[st]);
    const tiles0 = s.tiles.slice();
    collapseBuilding(m.sim, s, m.I, c);
    for (let i = 0; i < s.tiles.length; i++) if (c.foot[i] === FOOT_FLOOR_EDGE) expect(s.tiles[i]).toBe(tiles0[i]);
    const after = floorsOf(s);
    const upLab = new Set<number>();
    for (let i = 0; i < s.tiles.length; i++) if (before[i] === upper) upLab.add(after[i]);
    const up: number[] = [], rest: number[] = [];
    // 1층 바닥 = 위층이 아닌 건물 칸 가운데 걸을 수 있는 칸 (바깥 땅은 처음부터 위층 곁에 있을 수 있다 — 층 사이 4칸의 전제는 두 층의 바닥 사이다)
    for (let i = 0; i < s.tiles.length; i++) { if (after[i] < 0) continue; if (upLab.has(after[i])) up.push(i); else if (c.foot[i] !== 0) rest.push(i); }
    expect(up.length).toBeGreaterThan(10); expect(rest.length).toBeGreaterThan(10);
    let dmin = 1e9;
    for (const i of up) for (const j of rest) dmin = Math.min(dmin, Math.max(Math.abs((i % s.w) - (j % s.w)), Math.abs(((i / s.w) | 0) - ((j / s.w) | 0))));
    expect(dmin).toBeGreaterThanOrEqual(4);
    expect(s.tiles[st]).toBe(T.STAIR);
    expect(s.stairTo[st]).toBeGreaterThanOrEqual(0);
  });
  it('층 너머 (§10-10): 2층 건물의 1층에서 반경 6 의 폭발이 나도 빈 공간 너머 2층의 대원·구조 대상은 다치지 않는다', () => {
    const m = tall('X6-H4');
    const s = m.s, lab = floorsOf(s);
    const st = s.stairTo.findIndex((v) => v >= 0);
    const upper = lab[s.stairTo[st]], lower = lab[st];
    // 1층 칸 하나와 5칸 안의 2층 칸 하나
    let pair: [number, number] | null = null;
    for (let i = 0; i < s.tiles.length && !pair; i++) {
      if (lab[i] !== lower || s.tiles[i] !== T.FLOOR) continue;
      for (let j = 0; j < s.tiles.length; j++) if (lab[j] === upper && s.tiles[j] === T.FLOOR && s.propAt[j] < 0 && Math.hypot((i % s.w) - (j % s.w), ((i / s.w) | 0) - ((j / s.w) | 0)) <= 5) { pair = [i, j]; break; }
    }
    expect(pair).not.toBeNull();
    const [bi, ui] = pair!;
    const rid = m.sim.responders.find((r) => r.dept === 'fire')!.id;
    const a = agentAt(m, rid, ui % s.w, (ui / s.w) | 0);
    s.agents.push(a);
    const q = addCas(s, ui % s.w, (ui / s.w) | 0, 'mobile', 90, 0, 0.1);
    const hp = m.sim.responders[rid].health;
    blast(m.sim, s, m.I, bi % s.w, (bi / s.w) | 0, 6, 50, -1);
    expect(m.sim.responders[rid].health).toBe(hp);
    expect(q.health).toBe(90);
    // 같은 층이면 다친다 (검사가 무딘 것이 아님을 확인)
    const q2 = addCas(s, bi % s.w, (bi / s.w) | 0, 'mobile', 90, 0, 0.1);
    blast(m.sim, s, m.I, bi % s.w, (bi / s.w) | 0, 6, 50, -1);
    expect(q2.health).toBeLessThan(90);
  });
  it('도시 지도는 그대로이고(건물 상태는 교대의 자료), 건물이 아닌 현장(비행기·선박·산불)은 지도에 남지 않는다 (§10-9)', () => {
    const m = make('X6-H5', 'fire', 'std');
    const sig = (sim: Sim): string => JSON.stringify(sim.city.places.map((p) => [p.x, p.y, p.w, p.h, p.kind]));
    const before = sig(m.sim), n0 = m.sim.city.places.length;
    collapseBuilding(m.sim, m.s, m.I, catOf(m.sim, m.s)!);
    expect(m.sim.placeMarks.size).toBe(1);
    expect(m.sim.city.places.length).toBe(n0);
    expect(sig(m.sim)).toBe(before);
    expect(new Sim('X6-H5').placeMarks.size).toBe(0);
    for (const v of ['plane', 'ship', 'wild']) {
      const q = make('X6-H6' + v, 'fire', v);
      runAlone(q.sim, q.s, 500);
      expect(q.s.cat?.struct ?? false, v).toBe(false);
      expect(q.sim.placeMarks.size, v).toBe(0);
      const n = x6Count(q.I);
      expect(n.partial + n.total + n.burnout, v).toBe(0);
    }
  });
});

describe('X6 단계 3: 깔린 대원 (§10-12)', () => {
  /** 화재 현장의 가장 큰 방에 소방 대원 여럿을 세우고 그 방을 무너뜨린다 — 깔린 대원과 깔리지 않은 대원이 함께 나오는 시드를 찾는다 */
  function crushed(): { m: Made; agents: FieldAgent[]; ev: number; downed: FieldAgent } {
    for (let k = 0; k < 40; k++) {
      const m = make('X6-K' + k, 'fire', 'std');
      m.s.fire.fill(0);
      const c = catOf(m.sim, m.s)!;
      const r = indoorRegs(m.s).filter((q) => q.kind === 'room').sort((p, q) => q.tiles.length - p.tiles.length)[0];
      const spots = r.tiles.filter((i) => m.s.tiles[i] === T.FLOOR && m.s.propAt[i] < 0).slice(0, 7);
      const rids = fireRids(m.sim).slice(0, spots.length);
      const agents = rids.map((rid, q) => { const a = agentAt(m, rid, spots[q] % m.s.w, (spots[q] / m.s.w) | 0); m.s.agents.push(a); return a; });
      // 하나는 이미 쓰러져 있다 (기록이 더해지지 않아야 한다)
      const downed = agents[agents.length - 1];
      downed.status = 'down'; m.sim.responders[downed.rid].status = 'down';
      for (const a of agents) a.hpTick = m.sim.responders[a.rid].health;
      const ev = collapseRegion(m.sim, m.s, m.I, c, r.id);
      const tr = agents.filter((a) => (a.trapped ?? 0) > 0 && a !== downed);
      if (tr.length && tr.length < agents.length - 1 && (downed.trapped ?? 0) > 0) return { m, agents, ev, downed };
    }
    throw new Error('깔린 대원과 깔리지 않은 대원이 함께 나오는 시드를 찾지 못함');
  }
  it('구획 붕괴로 깔린 대원은 같은 틱의 agentHealth 에서 쓰러지고 RESPONDER_HURT "… 쓰러짐 (잔해 깔림)" 이 하나, 원인은 그 붕괴 기록이다. 이미 쓰러진 대원에게는 기록이 더해지지 않는다', () => {
    const { m, agents, ev, downed } = crushed();
    for (const a of agents) agentHealth(m.sim, m.s, m.I, a);
    for (const a of agents) {
      const r = m.sim.responders[a.rid];
      const recs = m.I.problems.filter((p) => p.code === 'RESPONDER_HURT' && p.detail.startsWith(`${r.name} 대원 쓰러짐 (잔해 깔림)`));
      expect(r.injuries?.some((j) => j.cause === 'crush' && j.ev === ev), r.name).toBe(true);      // 피해의 원인은 그 붕괴 기록이다 ({ ev })
      expect(r.health, r.name).toBeGreaterThan(0);      // 멀쩡하던 대원은 한 번에 숨지지 않는다 (H1 문턱)
      if (a === downed) { expect(recs.length).toBe(0); continue; }
      if ((a.trapped ?? 0) > 0) {
        expect(a.status).toBe('down'); expect(r.status).toBe('down'); expect(a.label).toBe('잔해에 깔림');
        expect(recs.length).toBe(1);
        expect(m.sim.events[recs[0].eventId].causes).toEqual([ev]);
        expect(a.trapEv).toBe(ev);
      } else expect(recs.length).toBe(0);
    }
  });
  it('동료가 보면 mate 사실에 깔렸다는 것이 붙고, 쓰러졌다고만 알던 동료에게도 그것은 새 소식이다', () => {
    const { m, agents, downed } = crushed();
    for (const a of agents) agentHealth(m.sim, m.s, m.I, a);
    const victim = agents.find((a) => a !== downed && (a.trapped ?? 0) > 0)!;
    const f = mateFact(m.sim, m.s, victim, 'down', '시험', 1);
    expect((f.value as MateBelief).trapped).toBe(true);
    expect(f.text).toContain('잔해에 깔림');
    const watcher = agentAt(m, m.sim.responders.find((r) => r.dept === 'ems')!.id, victim.x, victim.y);
    const plain = mateFact(m.sim, m.s, victim, 'down', '시험', 1);
    (plain.value as MateBelief).trapped = false;
    learn(m.sim, watcher, plain);
    watcher.outbox.length = 0;
    learn(m.sim, watcher, f);
    expect(watcher.outbox.some((q) => q.type === 'mate' && q.id === victim.rid)).toBe(true);
  });
});

// ───────────────────────── 세계 — 폭발 (단계 4) ─────────────────────────
/** 그 소품이 있는 실내 구획 (소품 칸이 구역 밖이면 맞닿은 실내 구역) */
function propRegion(s: Scene, p: Prop): number {
  const i = p.y * s.w + p.x;
  for (const j of [i, i + 1, i - 1, i + s.w, i - s.w]) { const r = s.region[j]; if (r >= 0 && s.regions[r].indoor) return r; }
  return -1;
}
const gasMax = (c: CatState): number => { let v = 0; for (const x of c.gas!) if (x > v) v = x; return v; };

describe('X6 단계 4: 세계 — 가스가 쌓이고 점화원이 닿으면 터진다 (§10-1·§10-2 ②)', () => {
  const leaky = (prefix: string): Made => find(prefix, 'hazmat', 'std', (q) => q.s.props.some((p) => p.kind === 'valve' && (p.leakRate ?? 0) >= 0.8));
  it('밸브 곁 방에 불을 두면 400초 안에 누출된 가스가 폭발하고 밸브가 불붙는다 — 기록이 먼저, 그 기록이 사람 피해의 원인이다', () => {
    const m = leaky('X6-E1'), s = m.s;
    const v = s.props.find((p) => p.kind === 'valve' && (p.leakRate ?? 0) >= 0.8)!;
    const vr = propRegion(s, v);
    // 밸브 곁 방(이웃한 방)의 연료가 있는 칸 셋에 불 0.6. 밸브 방 자체에 불을 두면 센 불이 그 방의 창을 깨뜨려 가스가 빠져나가 구름이 생기지 않는다(방치 시험)
    const fuelFar = (k: number): number[] => s.regions[k].tiles.filter((i) => s.fuel[i] > 0 && Math.hypot((i % s.w) - v.x, ((i / s.w) | 0) - v.y) > 2);
    const r = regionNbrs(s)[vr].find((k) => s.regions[k].kind === 'room' && fuelFar(k).length >= 3)!;
    expect(r).toBeGreaterThanOrEqual(0);
    const spots = fuelFar(r).slice(0, 3);
    expect(spots.length).toBe(3);
    for (const i of spots) s.fire[i] = 0.6;
    const q = addCas(s, v.x, v.y, 'immobile', 90, 0, 0.1);
    q.x = s.regions[r].cx; q.y = s.regions[r].cy;
    let boom = -1;
    for (let k = 0; k < 400 * 5 && boom < 0; k++) {
      m.sim.tick++; m.sim.t = m.sim.tick * m.sim.dt; tickScene(m.sim, s);
      if (s.cat!.gasN > 0) boom = m.sim.t;
    }
    expect(boom).toBeGreaterThan(0);
    const rec = m.I.problems.find((p) => (p.code === 'EXPLOSION' || p.code === 'HIDDEN_HAZARD') && p.detail.startsWith('누출된 가스 폭발 — '))!;
    expect(rec).toBeTruthy();
    expect(rec.code).toBe('HIDDEN_HAZARD');      // 지휘관이 없다 — 몰랐던 위험
    expect(v.ignited).toBe(true);
    expect(m.sim.events[rec.eventId].text).toMatch(/^폭발! .*에 고여 있던 가스에 불이 붙었습니다\.$/);
    expect(s.fx.some((f) => f.kind === 'boom' && f.c?.src === 'gas')).toBe(true);
    checkHonest(m.sim);
    // 구름은 타 버렸다 (구름 칸 0, 나머지 0.4배) — 터진 직후 폭발 하한을 넘은 칸이 없다
    expect(gasClouds(s.cat!, s).filter((cl) => cl.length >= CAT.CLOUD_MIN).length).toBe(0);
    const hit = q.injuries?.find((j) => j.cause === 'blast');      // 폭발에 다쳤다면 그 원인은 폭발 기록이다 ({ ev } — 기록이 먼저)
    if (hit) expect(hit.ev).toBe(rec.eventId);
  });
  it('불이 없어도 400초 안에 폭발 하한을 넘은 구름(셋 이상 이어진 칸)이 생긴다. 밸브를 30초에 잠그면 400초 동안 터지지 않고 가스가 줄어든다', () => {
    const m = leaky('X6-E2');
    let cloud = -1;
    for (let k = 0; k < 400 * 5 && cloud < 0; k++) {
      m.sim.tick++; m.sim.t = m.sim.tick * m.sim.dt; tickScene(m.sim, m.s);
      if (m.s.cat && gasClouds(m.s.cat, m.s).some((cl) => cl.length >= CAT.CLOUD_MIN)) cloud = m.sim.t;
    }
    expect(cloud).toBeGreaterThan(0);
    const n = leaky('X6-E2');
    runAlone(n.sim, n.s, 30);
    for (const p of n.s.props) if (p.kind === 'valve') p.mitigated = true;
    runAlone(n.sim, n.s, 30);
    const g60 = gasMax(n.s.cat!);
    runAlone(n.sim, n.s, 340);
    expect(n.s.cat!.gasN).toBe(0);
    expect(n.I.problems.some((p) => p.detail.startsWith('누출된 가스 폭발'))).toBe(false);
    expect(gasMax(n.s.cat!)).toBeLessThan(g60);
  });
  it('폭발의 크기는 구름 칸 수로 정한다 (손 계산): 반경 2.0 + 0.55√N (2.6~6), 피해 18 + 4.5√N (24~55). 반경 안의 잠긴 문이 날아가고, 지휘관이 알았으면 EXPLOSION', () => {
    const m = leaky('X6-E3'), s = m.s, c = catOf(m.sim, s)!;
    const v = s.props.find((p) => p.kind === 'valve' && (p.leakRate ?? 0) >= 0.8)!;
    const r = propRegion(s, v);
    const cloud = s.regions[r].tiles.filter((i) => isIndoor(s.tiles[i]) && s.tiles[i] !== T.DOOR).slice(0, 16);
    c.gas!.fill(0);
    for (const i of cloud) c.gas![i] = 1.5;
    // 지휘관: 그 밸브가 샌다는 것을 안다
    const cmd = agentAt(m, m.sim.responders.find((q) => q.dept === 'fire')!.id, s.staging.x, s.staging.y);
    cmd.isCommander = true; s.commanderRid = cmd.rid; s.agents.push(cmd);
    cmd.beliefs.merge(mkFact('haz', v.id, { kind: 'leak', active: true, x: v.x, y: v.y }, '시험', m.sim.t, 1, true, ''));
    // 잠긴 문 하나를 구름 곁에
    const door = s.props.find((p) => p.kind === 'door' && Math.hypot(p.x - s.regions[r].cx, p.y - s.regions[r].cy) <= 4);
    if (door) { door.locked = true; door.blocking = true; door.open = false; s.propAt[door.y * s.w + door.x] = door.id; }
    s.fire[cloud[0]] = 0.5;      // 점화원: 구름 칸의 불
    const N = gasClouds(c, s).find((cl) => cl.indexOf(cloud[0]) >= 0)!.length;      // 점화된 구름의 칸 수 (한 걸음 확산해도 1.5 의 칸은 하한 위에 남는다)
    stepCat(m, c);
    expect(c.gasN).toBe(1);
    const rec = m.I.problems.find((p) => p.detail.startsWith('누출된 가스 폭발 — '))!;
    expect(rec.code).toBe('EXPLOSION');
    expect(rec.detail).toBe('누출된 가스 폭발 — 불길이 가스에 닿음');
    const fx = s.fx.find((f) => f.kind === 'boom' && f.c?.src === 'gas')!;
    expect(fx.c!.r).toBeCloseTo(Math.min(6, Math.max(2.6, 2.0 + 0.55 * Math.sqrt(N))), 6);
    if (door && Math.hypot(door.x - (cloud[0] % s.w), door.y - ((cloud[0] / s.w) | 0)) <= fx.c!.r!) { expect(door.open).toBe(true); expect(door.locked).toBe(false); expect(s.propAt[door.y * s.w + door.x]).toBe(-1); }
    expect(v.ignited).toBe(true);
    for (const i of cloud) expect(c.gas![i]).toBe(0);
  });
  it('가스 폭발 현장(collapse/gasblast)은 밸브가 있는 방이 처음부터 가스로 차 있다 (결정적 — 난수 없음)', () => {
    const m = make('X6-E4', 'collapse', 'gasblast');
    const c = catOf(m.sim, m.s)!;
    const v = m.s.props.find((p) => p.kind === 'valve')!;
    const r = propRegion(m.s, v);
    expect(r).toBeGreaterThanOrEqual(0);
    for (const i of m.s.regions[r].tiles) if (isIndoor(m.s.tiles[i])) expect(c.gas![i]).toBeGreaterThanOrEqual(CAT.GASBLAST_INIT);
    expect(peek(m.sim.rng)).toBe(peek(make('X6-E4', 'collapse', 'gasblast').sim.rng));
  });
  it('도시가스 공급 차단: 요청(지휘 상태)한 뒤 90~150초에 한 번만 살아 있는 밸브를 모두 잠그고, 차단 완료 사실을 현장 전원에게 알린다 (밸브마다 알리지 않는다)', () => {
    const m = leaky('X6-E5'), s = m.s, c = catOf(m.sim, s)!;
    const asked = m.sim.t;
    s.ops = { utilityAsked: asked } as unknown as OpsState;      // 지휘 쪽(단계 5)이 요청한 것과 같다 — 세계는 이 칸만 읽는다
    let done = -1;
    for (let k = 0; k < 200 && done < 0; k++) { stepCat(m, c); if (c.utilityAt === -2) done = m.sim.t; }
    expect(done - asked).toBeGreaterThanOrEqual(90 - 1);
    expect(done - asked).toBeLessThanOrEqual(150 + 1);
    for (const p of s.props) if (p.kind === 'valve') expect(p.mitigated || p.ignited).toBe(true);
    const e = m.sim.events.filter((q) => q.text === '도시가스사: 공급 차단 완료 — 누출이 멈춥니다.');
    expect(e.length).toBe(1);
    const msg = s.radio.find((q) => q.eventId === e[0].id)!;
    expect(msg.to).toBe(-1);
    expect(msg.facts.length).toBe(1);
    expect(msg.facts[0].type).toBe('sign'); expect(msg.facts[0].id).toBe(SIGN_BASE.utility); expect(msg.facts[0].value.what).toBe('utility');
    for (let k = 0; k < 30; k++) stepCat(m, c);
    expect(m.sim.events.filter((q) => q.text.startsWith('도시가스사')).length).toBe(1);
  });
});

describe('X6 단계 4: 세계 — 용기·차량·드럼통 (§2.6·§4.4)', () => {
  /** 차량 둘레(차체 1칸 안)에 불 v 를 둔다 */
  const ring = (s: Scene, p: Prop, v: number): void => {
    for (let y = p.y - 1; y <= p.y + p.h; y++) for (let x = p.x - 1; x <= p.x + p.w; x++) { if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue; const j = y * s.w + x; if (s.fuel[j] <= 0) s.fuel[j] = 0.5; s.fire[j] = v; }
  };
  it('일반 버스(CNG): 불길에 싸이면 열이 쌓여 터지고, 차 안의 사람이 그 폭발로 다친다', () => {
    const m = find('X6-V1', 'traffic', 'bus', (q) => q.s.props.some((p) => p.vessel === 'cng' || (p.kind === 'vehicle' && p.bus && !p.skin)));
    const c = catOf(m.sim, m.s)!;
    const bus = m.s.props.find((p) => p.vessel === 'cng')!;
    const inside = m.s.casualties.filter((q) => q.inVehicle === bus.id && !q.dead);
    const hp0 = inside.map((q) => q.health);
    let t = 0;
    for (; t < 200 && !bus.exploded; t++) { ring(m.s, bus, 1); stepCat(m, c); }
    expect(bus.exploded).toBe(true); expect(bus.ignited).toBe(true);
    const rate = CAT.VESSEL_HEAT.cng * 1.25 * bus.heatK!;
    expect(t).toBeLessThanOrEqual(Math.ceil(1 / (CAT.VESSEL_HEAT.cng * 1.0 * bus.heatK!)) + 1);
    expect(t).toBeGreaterThanOrEqual(Math.floor(1 / rate) - 1);
    const rec = m.I.problems.find((p) => p.detail === 'CNG 버스 가스 용기 폭발')!;
    expect(rec).toBeTruthy();
    expect(m.sim.events[rec.eventId].text).toBe('폭발! 불길에 달궈진 CNG 용기가 터졌습니다.');
    inside.forEach((q, k) => { if (!q.dead) { expect(q.health).toBeLessThan(hp0[k]); expect(q.causeEvent).toBe(rec.eventId); } });
    expect(c.vesselN).toBe(1);
    expect(m.s.fx.some((f) => f.kind === 'boom' && f.c?.src === 'cng')).toBe(true);
  });
  it('비행기 가운데 동체(항공유)도 터지고 둘레 땅에 연료가 번진다. 동체 기수·꼬리는 터지지 않는다', () => {
    const m = make('X6-V2', 'fire', 'plane');
    const c = catOf(m.sim, m.s)!;
    const mid = m.s.props.find((p) => p.vessel === 'jet')!;
    const ends = m.s.props.filter((p) => p.skin === 'fuselageNose' || p.skin === 'fuselageTail');
    for (let t = 0; t < 200 && !mid.exploded; t++) { ring(m.s, mid, 1); for (const e of ends) ring(m.s, e, 1); stepCat(m, c); }
    expect(mid.exploded).toBe(true);
    expect(m.I.problems.some((p) => p.detail === '항공유 폭발')).toBe(true);
    for (const e of ends) { expect(e.vessel).toBeUndefined(); expect(e.exploded).toBeFalsy(); }
    expect(m.sim.placeMarks.size).toBe(0);      // 활주로는 건물이 아니다
  });
  it('새는 차량 연료에 곁의 불이 붙는다: 차체 1.5칸 안 불이 0.3 이상이면 누출 진행이 초당 0.015 × 불만큼 더 오른다 (발화는 tickLeaks)', () => {
    const m = find('X6-V3', 'traffic', 'std', (q) => q.s.props.some((p) => p.kind === 'vehicle' && (p.leakRate ?? 0) > 0 && !p.vessel));
    const c = catOf(m.sim, m.s)!;
    const car = m.s.props.find((p) => p.kind === 'vehicle' && (p.leakRate ?? 0) > 0 && !p.vessel)!;
    m.s.fire.fill(0);
    const l0 = car.leak ?? 0;
    stepCat(m, c);
    expect(car.leak ?? 0).toBe(l0);      // 불이 없으면 X6 는 더하지 않는다
    const j = car.y * m.s.w + car.x - 1;
    m.s.fire[j] = 0.5;
    stepCat(m, c);
    expect((car.leak ?? 0) - l0).toBeCloseTo(0.015 * 0.5, 6);
    expect(car.exploded).toBeFalsy();      // 보통 차는 터지지 않는다 (휘발유 탱크는 압력 용기가 아니다)
  });
  it('공업 화재의 화학 드럼: 화학 공장 화재에는 불이 없는 방의 빈 바닥에 1~3개 놓이고(길을 막지 않는다), 어느 입구로 처음 만들어도 같다', () => {
    const sim0 = new Sim('X6-D0');
    const chem = sim0.city.places.filter((p) => p.kind === 'chemical');
    expect(chem.length).toBeGreaterThan(0);
    let found: Made | null = null;
    for (let k = 0; k < 20 && !found; k++) {
      const sim = new Sim('X6-D' + k);
      const I = createIncident(sim, { type: 'fire', variant: 'std', placeId: chem[k % chem.length].id, rng: sim.rng.fork('t') });
      const s = sim.scenes[I.id]!;
      if (I.truth.placeKind !== 'chemical') continue;
      catOf(sim, s);
      if (s.props.some((p) => p.skin === 'drum')) found = { sim, I, s };
    }
    expect(found).not.toBeNull();
    const { sim, I, s } = found!;
    const drums = s.props.filter((p) => p.skin === 'drum');
    expect(drums.length).toBeGreaterThanOrEqual(1); expect(drums.length).toBeLessThanOrEqual(3);
    for (const d of drums) {
      expect(d.kind).toBe('gas'); expect(d.vessel).toBe('drum'); expect(d.blocking).toBe(false);
      expect(d.heatK!).toBeGreaterThanOrEqual(0.8); expect(d.heatK!).toBeLessThanOrEqual(1.25);
      const i = d.y * s.w + d.x;
      expect(s.tiles[i]).toBe(T.FLOOR);
      expect(s.regions[s.region[i]].tiles.some((j) => s.fire[j] > 0)).toBe(false);
      expect(s.props.filter((p) => p.x === d.x && p.y === d.y).length).toBe(1);
      expect([1, -1, s.w, -s.w].some((dd) => s.tiles[i + dd] === T.FLOOR && s.propAt[i + dd] < 0)).toBe(true);
      expect(vesselName(d)).toBe('드럼통');
    }
    // 같은 현장을 perceive 입구로 처음 만들어도 같은 드럼통 (catinit 흐름 — 부모를 소비하지 않는다)
    const sim2 = new Sim(sim.seed);
    const I2 = createIncident(sim2, { type: 'fire', variant: 'std', placeId: I.truth.placeId, rng: sim2.rng.fork('t') });
    const s2 = sim2.scenes[I2.id]!;
    const a = agentAt({ sim: sim2, I: I2, s: s2 }, sim2.responders.find((r) => r.dept === 'fire')!.id, s2.staging.x, s2.staging.y);
    s2.agents.push(a);
    perceive(sim2, s2, a);
    expect(JSON.stringify(s2.props.filter((p) => p.skin === 'drum').map((p) => [p.x, p.y, p.heatK]))).toBe(JSON.stringify(drums.map((p) => [p.x, p.y, p.heatK])));
    // 터지면 화학 드럼 파열 — 둘레에 유독 연기
    const c = s.cat!, d = drums[0];
    d.heatLoad = 1; s.fire[d.y * s.w + d.x + 1] = 0.8;      // 한계의 열 + 곁의 불 (불이 없으면 그 초에 식어 1 아래가 된다)
    stepCat({ sim, I, s }, c);
    expect(d.exploded).toBe(true);
    expect(I.problems.some((p) => p.detail === '화학 드럼 파열')).toBe(true);
    expect(s.smoke[d.y * s.w + d.x]).toBeGreaterThanOrEqual(0.9 - 1e-6);
  });
});

// ───────────────────────── 교대 단위 (단계 2 부터) ─────────────────────────
describe('X6 단계 2: 교대 — 재현성과 아직 일어나지 않는 일', () => {
  // 단계 1 의 "세계 규칙을 뺀 교대와 같다"는 단계 2 에서 끝났다: 조짐이 사실로 들어오면 무전 문구(기록)가 바뀐다 (perceive 가 조짐을 보므로 규칙을 빼도 같지 않다).
  // 대신 §10-6(재현성)과 "세계는 아직 아무것도 일으키지 않는다"(단계 3·4 가 뒤집는다)를 본다
  const cases: [string, Difficulty, string | null][] = [['S1', NORMAL, null], ['F0', NORMAL, 'fire/std'], ['F1', NORMAL, 'collapse/gasblast'], ['F2', NORMAL, 'hazmat/std'], ['X0', { ...NORMAL, frequency: 5, severity: 5, threat: 5, equipment: 1, info: 5, resources: 1 }, null]];
  const shift = (seed: string, d: Difficulty, force: string | null): Sim => { const sim = new Sim(seed, d, 1200, { force }); sim.runToEnd(); return sim; };
  const state = (sim: Sim): string => JSON.stringify([
    sim.report!.hash, sim.events.length, sim.tick,
    sim.incidents.map((I) => [I.closeReason, I.closedAt, I.result?.outcome, I.result?.casSaved, I.result?.casLost, I.result?.propertyLoss, I.problems.map((p) => [p.code, p.t, p.recovered])]),
    sim.responders.map((r) => [r.health, r.stamina, r.status]), sim.units.map((u) => [u.state, u.x, u.y, u.water, u.runs]),
    sim.scenes.map((s) => (s ? [s.burnedTiles, s.staticVersion, s.props.length, s.casualties.map((c) => [c.health, c.where, c.dead]), peek(s.rng), s.agents.map((a) => [a.rid, a.signObs ? Object.entries(a.signObs).join(';') : '-'])] : null)), peek(sim.rng),
  ]);
  const runs = cases.map(([seed, d, f]) => shift(seed, d, f));
  it('§10-6 재현성: 같은 시드·같은 난이도·같은 강제는 기록 해시와 상태가 같다 (조짐 관찰의 기억까지)', () => {
    for (let q = 0; q < cases.length; q++) {
      const again = shift(...cases[q]);
      expect(again.report!.hash, cases[q][0]).toBe(runs[q].report!.hash);
      expect(state(again), cases[q][0]).toBe(state(runs[q]));
    }
  });
  it('그 교대들에서 조짐은 지휘관에게까지 들어왔고, 세계는 실제로 무너뜨리고 터뜨린다 — 기록·건물 상태·집계가 서로 맞고(§10-8), 지휘관이 조짐으로 판단한 기록(위험 조짐·철수)이 지휘 상태와 맞는다 (단계 5)', () => {
    let signs = 0, cmdSigns = 0, scenes = 0, moved = 0, radio = 0, fell = 0, booms = 0, withdrew = 0, dsigns = 0, opsScenes = 0;
    for (const sim of runs) {
      for (const s of sim.scenes) {
        if (!s) continue;
        for (const a of s.agents) { const l = a.beliefs.list('sign'); signs += l.length; if (a.isCommander) cmdSigns += l.length; }
        if (!s.cat) continue;
        scenes++;
        if (s.cat.struct && indoorRegs(s).some((r) => s.cat!.integ[r.id] < 1)) moved++;
      }
      radio += sim.events.filter((e) => /삐걱이는 소리|균열·처짐|붕괴 임박|가스 농도 LEL|가스 냄새|안전밸브|불길에 직접|전체 붕괴 위험/.test(e.text)).length;
      // 단계 3: 구조가 실제로 무너진다. 기록은 무너진 구획·전체 붕괴·전소 판정과 하나씩 맞는다 (가짜 연출 없음)
      const n = checkHonest(sim);
      fell += n.partial + n.total;
      const st = catStats(sim);
      expect([st.partials, st.totals, st.burnouts]).toEqual([n.partial, n.total, n.burnout]);
      // 건물 상태: 무너지거나 다 탄 실제 건물마다 하나 (그 밖의 현장은 없다)
      for (const [id, mk] of sim.placeMarks) {
        const I = sim.incidents[mk.incidentId];
        expect(I.truth.placeId).toBe(id);
        expect(sim.scenes[I.id]!.cat!.struct).toBe(true);
        const k = x6Count(I);
        if (mk.state === 'scorched') { expect(I.truth.type).toBe('fire'); expect(I.phase).toBe('closed'); expect(mk.burnFrac).toBeGreaterThanOrEqual(0.15); }      // (단계 7) 끝난 화재의 그을린 건물
        else expect(k.partial + k.total + k.burnout + k.boom).toBeGreaterThan(0);
      }
      // 폭발(단계 4): 집계가 기록과 맞는다. 예전 규칙의 폭발 문구('누출된 가스에 불이 붙어 폭발')는 더는 없다
      expect(st.gas + st.vessel + st.dust).toBe(n.boom);
      expect(st.known).toBe(sim.incidents.reduce((k, I) => k + I.problems.filter((p) => p.code === 'EXPLOSION').length, 0));
      booms += n.boom;
      expect(sim.events.some((e) => e.problem === 'HIDDEN_HAZARD' && e.text.startsWith('폭발! 고여 있던 가스에 불이 붙었습니다'))).toBe(false);
      // (단계 5) 지휘관이 조짐으로 판단한다: 위험 조짐·전원 철수 기록은 지휘 상태(Scene.ops)가 있는 현장에만 있고, 집계와 맞는다.
      // 철수 기록마다 그 사건의 지휘 상태에 철수가 있었고(구역의 기록 = 그 문제), 다시 들어간 것은 복구로 남는다
      const prob = (code: string): number => sim.incidents.reduce((k, I) => k + I.problems.filter((p) => p.code === code).length, 0);
      expect([st.withdrawals, st.signs]).toEqual([prob('WITHDRAWAL'), prob('DANGER_SIGN')]);
      expect(st.reentries).toBe(sim.incidents.reduce((k, I) => k + I.problems.filter((p) => p.code === 'WITHDRAWAL' && p.recovered).length, 0));
      for (const I of sim.incidents) if (I.problems.some((p) => p.code === 'WITHDRAWAL' || p.code === 'DANGER_SIGN')) expect(sim.scenes[I.id]!.ops, I.code).toBeDefined();
      withdrew += st.withdrawals; dsigns += st.signs; opsScenes += sim.scenes.filter((s) => s && s.ops).length;
      // (단계 7) 교대 보고서의 칸: 사건 결과의 요약을 더한 값과 교대 끝의 건물 상태
      const rc = sim.report!.catastrophe!;
      expect([rc.burnouts, rc.totals, rc.partials, rc.explosions, rc.withdrawals]).toEqual([st.burnouts, st.totals, st.partials, n.boom, st.withdrawals]);
      expect(rc.averted).toBe(st.averted);
      expect(rc.crewCaught).toBe(st.crewCaught);
      expect(sim.report!.placeMarks?.length ?? 0).toBe(sim.placeMarks.size);
      for (const I of sim.incidents) if (sim.scenes[I.id]?.cat || sim.scenes[I.id]?.ops) expect(I.result!.catastrophe, I.code).toBeDefined(); else expect(I.result!.catastrophe).toBeUndefined();
      expect(st.scenes).toBe(sim.scenes.filter((s) => s && s.cat).length);
    }
    expect(dsigns).toBeGreaterThan(0);
    expect(opsScenes).toBeGreaterThan(0);
    void withdrew;
    expect(scenes).toBeGreaterThan(20);
    expect(moved).toBeGreaterThan(2);
    expect(signs).toBeGreaterThan(10);
    expect(cmdSigns).toBeGreaterThan(0);
    expect(radio).toBeGreaterThan(3);
    expect(fell).toBeGreaterThan(0);
    expect(booms).toBeGreaterThanOrEqual(0);      // 다섯 교대에 폭발이 없을 수 있다 — 폭발의 시험은 아래 '세계 — 폭발' 묶음이 한다
  });
  it('사건이 닫힌 뒤에는 계산도 멈춘다 (판정 뒤에는 아무것도 일어나지 않는다)', () => {
    const sim = runs[1];
    const s = sim.scenes.find((q) => q && q.cat && q.cat.struct && sim.incidents[q.incidentId].phase === 'closed')!;
    const I = sim.incidents[s.incidentId], c = s.cat!;
    const before = JSON.stringify([Array.from(c.integ), Array.from(c.hotT), Array.from(c.loss), c.bldg, c.burntAt, s.props.map((p) => p.heatLoad)]);
    for (const i of indoorRegs(s)[0].tiles) s.fire[i] = 1;
    s.burning = 5;
    const tick0 = sim.tick;
    for (let k = 0; k < 10; k++) { sim.tick++; catRule(sim, s, I); }
    sim.tick = tick0;
    expect(JSON.stringify([Array.from(c.integ), Array.from(c.hotT), Array.from(c.loss), c.bldg, c.burntAt, s.props.map((p) => p.heatLoad)])).toBe(before);
  });
});

// ───────────────────────── 조짐 (§10-3) ─────────────────────────
/** 시험용 대원: 그 대원을 (x, y) 에 세운다. 판단력은 0.5 로 맞춘다 (소리·눈의 거리 보정 0) */
function agentAt(m: Made, rid: number, x: number, y: number): FieldAgent {
  m.sim.responders[rid].judgment = 0.5;
  return makeAgent(m.sim, rid, m.sim.responders[rid].unitId, x, y, m.sim.t, m.sim.rng.fork('ta:' + rid));
}
/** 조건에 맞는 걸을 수 있는 칸 (위에서부터 첫 칸) */
function tileWhere(s: Scene, ok: (x: number, y: number, i: number) => boolean): [number, number] {
  for (let y = 0; y < s.h; y++) for (let x = 0; x < s.w; x++) { const i = y * s.w + x; if (staticPass(s.tiles[i]) && s.propAt[i] < 0 && ok(x, y, i)) return [x, y]; }
  throw new Error('칸을 찾지 못함');
}
/** 그 구획 칸 가운데 하나라도 (x, y) 에서 보이는가 */
const seesAny = (s: Scene, reg: { tiles: number[] }, x: number, y: number): boolean => reg.tiles.some((i) => los(s, x, y, i % s.w, (i / s.w) | 0));
/** (x, y) 에서 4칸 안·시야 안인 그 구획 칸의 몫 */
const seenShare = (s: Scene, reg: { tiles: number[] }, x: number, y: number): number => reg.tiles.filter((i) => { const tx = i % s.w, ty = (i / s.w) | 0; return Math.hypot(tx - x, ty - y) <= 4 && los(s, x, y, tx, ty); }).length / reg.tiles.length;
const signOf = (a: FieldAgent, id: number): SignBelief | undefined => a.beliefs.val<SignBelief>('sign', id);
/** 건물 화재 현장에서 이웃 방이 있는 방 하나 (복도가 아닌 두 방) */
function roomPair(s: Scene): { r: Region; n: Region } {
  const nb = regionNbrs(s);
  for (const r of s.regions) {
    if (!r.indoor || r.kind !== 'room' || r.tiles.length < 8) continue;
    for (const k of nb[r.id]) { const n = s.regions[k]; if (n.kind === 'room' && n.tiles.length >= 6) return { r, n }; }
  }
  throw new Error('이웃한 방 둘을 찾지 못함');
}
const fireRids = (sim: Sim): number[] => sim.responders.filter((r) => r.dept === 'fire').map((r) => r.id);
/** 시험 배치: 이웃 방이 있는 방 r, 그 이웃 방 n, 벽 너머 6.5~8.5칸(r 도 이웃 구획도 아니고 r 이 하나도 보이지 않는 칸) b, 15칸 넘게 떨어져 r 이 보이지 않는 칸 far */
function layout(s: Scene): { r: Region; n: Region; b: [number, number]; far: [number, number] } | null {
  try {
    const { r, n } = roomPair(s), nb = regionNbrs(s);
    const b = tileWhere(s, (x, y, i) => { const d = Math.hypot(x - r.cx, y - r.cy); return d >= 6.5 && d <= 8.5 && s.region[i] !== r.id && nb[r.id].indexOf(s.region[i]) < 0 && !seesAny(s, r, x, y); });
    const far = tileWhere(s, (x, y) => Math.hypot(x - r.cx, y - r.cy) > 15 && !seesAny(s, r, x, y));
    return { r, n, b, far };
  } catch { return null; }
}
const findLayout = (prefix: string): Made & { L: NonNullable<ReturnType<typeof layout>> } => {
  const m = find(prefix, 'fire', 'std', (q) => q.sim.weather === 'clear' && layout(q.s) !== null);
  return { ...m, L: layout(m.s)! };
};

describe('X6 단계 2: 조짐이 사실로 들어온다 (§10-3)', () => {
  it('구획의 건전도가 0.4 면 그 방을 보는 대원의 다음 판단에 단계 2 조짐이 있고, 3초 안에 지휘관의 믿음에도 있다', () => {
    const sim = new Sim('X6-S3', NORMAL, 1200, { force: 'collapse/std' });
    let pick: { s: Scene; a: FieldAgent; cmd: FieldAgent; r: number } | null = null;
    for (let k = 0; k < 4000 && !pick; k++) {
      sim.step();
      if (k % 5) continue;
      for (const s of sim.scenes) {
        if (!s || s.kind !== 'collapse' || !s.cat || s.arrivedAt < 0 || sim.t - s.arrivedAt < 15) continue;
        const cmd = s.agents.find((a) => a.isCommander && a.status === 'active');
        if (!cmd || s.shadow[tileOf(s, cmd.x, cmd.y)]) continue;
        for (const a of s.agents) {
          if (a === cmd || a.status !== 'active' || s.shadow[tileOf(s, a.x, a.y)]) continue;
          const r = s.region[tileOf(s, a.x, a.y)];
          if (r < 0 || s.regions[r].kind !== 'room' || s.cat.fallen[r] || s.cat.integ[r] < CAT.L1 || cmd.beliefs.get('sign', r)) continue;
          if (seenShare(s, s.regions[r], Math.round(a.x), Math.round(a.y)) < 0.4) continue;      // 넉넉히 30% 를 넘게 보는 자리
          pick = { s, a, cmd, r }; break;
        }
        if (pick) break;
      }
    }
    expect(pick).not.toBeNull();
    const { s, a, cmd, r } = pick!;
    sim.responders[a.rid].judgment = 0.5;      // 눈의 거리 4칸 그대로 (판단력 보정 0)
    s.cat!.integ[r] = 0.4;
    perceive(sim, s, a);      // 그 대원의 다음 판단 (think 가 맨 먼저 perceive 를 부른다)
    const v = signOf(a, r)!;
    expect(v).toBeTruthy();
    expect(v.kind).toBe('struct'); expect(v.region).toBe(r); expect(v.level).toBeGreaterThanOrEqual(2);
    expect(a.beliefs.get('sign', r)!.verified).toBe(true);
    expect(a.outbox.some((f) => f.type === 'sign' && f.id === r)).toBe(true);
    for (let k = 0; k < 15 && (signOf(cmd, r)?.level ?? 0) < 2; k++) sim.step();      // 15틱 = 3초
    expect(signOf(cmd, r)?.level ?? 0).toBeGreaterThanOrEqual(2);
    // 무전 문구에 실렸고 중요한 보고(imp 1)다 — 묶음 보고(5초)를 기다리지 않았다
    const e = sim.events.find((q) => q.incidentId === s.incidentId && q.text.includes(`${s.regions[r].name} 천장 균열·처짐`));
    expect(e).toBeTruthy();
    expect(e!.importance).toBe(1);
  });
  it('0.3 이면 단계 3(임박)을 10칸 안의 대원 모두가 듣는다 — 벽 너머도. 15칸 넘게 떨어져 그 구획이 보이지 않는 대원은 모른다', () => {
    const m = findLayout('X6-SB');
    const s = m.s, c = catOf(m.sim, s)!, { r, b, far } = m.L;
    const ids = fireRids(m.sim);
    const [ax, ay] = tileWhere(s, (x, y, i) => s.region[i] === r.id);
    const A = agentAt(m, ids[0], ax, ay), B = agentAt(m, ids[1], b[0], b[1]), C = agentAt(m, ids[2], far[0], far[1]);
    c.integ[r.id] = 0.3;
    for (const q of [A, B, C]) perceive(m.sim, s, q);
    for (const q of [A, B]) {
      expect(signOf(q, r.id)?.level).toBe(3);
      expect(q.beliefs.get('sign', r.id)!.text).toContain('붕괴 임박');
      expect(q.signObs![r.id]).toBe(3);
    }
    expect(signOf(C, r.id)).toBeUndefined();
    expect(C.signObs?.[r.id]).toBeUndefined();
    // 0.55 (삐걱임 — 단계 1): 처음 듣는 벽 너머 7칸의 대원은 그 구획·이웃 구획에 있지 않아 삐걱임을 듣지 못하고(관찰 없음),
    // 3 을 들었던 그 구획 안의 A 는 삐걱임으로 내려간 것을 확인한다(임박의 감각 조건이 지금도 맞다 — 확인된 하향)
    const B2 = agentAt(m, ids[3], b[0], b[1]);
    c.integ[r.id] = 0.55;
    m.sim.t += 1;
    perceive(m.sim, s, B2); perceive(m.sim, s, A);
    expect(signOf(B2, r.id)).toBeUndefined();
    expect(B2.signObs?.[r.id]).toBeUndefined();
    expect(signOf(A, r.id)?.level).toBe(1);
    expect(signOf(A, r.id)?.down).toBe(true);
  });
  it('가스: 측정기를 든 대원만 측정값(lel)을 안다. 맨몸의 대원은 냄새로 단계 1 만(미확인)이고, 그것이 측정값을 덮지 않는다', () => {
    const m = make('X6-SG', 'hazmat', 'std');
    const s = m.s, c = catOf(m.sim, s)!;
    expect(c.gas).not.toBeNull();
    const reg = indoorRegs(s).find((q) => q.kind === 'room' && q.tiles.length >= 6)!;
    for (const i of reg.tiles) c.gas![i] = 0.3;
    const meterRid = m.sim.responders.find((q) => hasKit(m.sim, q.id, 'gasMeter'))!.id;
    const bareRid = m.sim.responders.find((q) => q.dept === 'fire' && !hasKit(m.sim, q.id, 'gasMeter'))!.id;
    const [x, y] = tileWhere(s, (_x, _y, i) => s.region[i] === reg.id);
    const M = agentAt(m, meterRid, x, y), N = agentAt(m, bareRid, x, y);
    perceive(m.sim, s, M); perceive(m.sim, s, N);
    const id = SIGN_BASE.gas + reg.id;
    const mv = signOf(M, id)!, nv = signOf(N, id)!;
    expect([mv.kind, mv.level, mv.lel, M.beliefs.get('sign', id)!.verified]).toEqual(['gas', 2, 30, true]);
    expect(M.beliefs.get('sign', id)!.text).toContain('LEL 30%');
    expect([nv.kind, nv.level, nv.lel, N.beliefs.get('sign', id)!.verified]).toEqual(['gas', 1, undefined, false]);
    expect(N.beliefs.get('sign', id)!.text).toContain('가스 냄새');
    // 측정값을 아는 믿음 위에 냄새는 덮이지 않는다
    expect(M.beliefs.merge(BeliefStore.relay(N.beliefs.get('sign', id)!))).toBe(false);
    expect(signOf(M, id)!.lel).toBe(30);
    // 측정값만 바뀐 것(같은 단계)은 믿음에 합치되 보고하지 않는다
    M.outbox.length = 0;
    for (const i of reg.tiles) c.gas![i] = 0.42;
    perceive(m.sim, s, M);
    expect(signOf(M, id)!.lel).toBe(40);
    expect(M.outbox.some((f) => f.key === 'sign:' + id)).toBe(false);
    // 단계가 내려가면 측정기 대원은 확인된 하향으로 보고한다
    for (const i of reg.tiles) c.gas![i] = 0.05;
    perceive(m.sim, s, M);
    expect(signOf(M, id)!.level).toBe(0);
    expect(signOf(M, id)!.down).toBe(true);
    expect(M.outbox.some((f) => f.key === 'sign:' + id)).toBe(true);
  });
  it('하향이 깜박이지 않는다: 소리로만 듣는 대원의 단계 1 보고는 지휘관의 "임박"을 끌어내리지 못하고, 확인된 하향(down)만 내린다', () => {
    const m = findLayout('X6-SF');
    const s = m.s, c = catOf(m.sim, s)!;
    for (let i = 0; i < s.fire.length; i++) s.fire[i] = 0;      // 열화상 문턱이 끼지 않게
    const { r, n } = m.L;
    const ids = fireRids(m.sim);
    const [ax, ay] = tileWhere(s, (x, y, i) => s.region[i] === r.id);
    const [hx, hy] = tileWhere(s, (x, y, i) => s.region[i] === n.id && Math.hypot(x - r.cx, y - r.cy) <= 5.5 && seenShare(s, r, x, y) < 0.2);
    const A = agentAt(m, ids[0], ax, ay), H = agentAt(m, ids[1], hx, hy);
    const cmdStore = new BeliefStore();
    c.integ[r.id] = 0.3;
    perceive(m.sim, s, A);
    expect(signOf(A, r.id)!.level).toBe(3);
    cmdStore.merge(BeliefStore.relay(A.beliefs.get('sign', r.id)!));
    const t3 = cmdStore.get('sign', r.id)!.t;
    // 건전도가 0.5 로 올랐다(보강) — 이웃 방에서 소리로만 듣는 H 는 삐걱임(1)을 처음 듣는다: 하향이 아니다
    c.integ[r.id] = 0.5;
    m.sim.t += 1;
    perceive(m.sim, s, H);
    const hf = H.beliefs.get('sign', r.id)!;
    expect(hf.value.level).toBe(1);
    expect(hf.value.down).toBeUndefined();
    expect(cmdStore.merge(BeliefStore.relay(hf))).toBe(false);
    expect(cmdStore.val<SignBelief>('sign', r.id)!.level).toBe(3);
    expect(cmdStore.get('sign', r.id)!.t).toBe(t3);
    // 0.7 로 오르고, 3 을 들었던 A 가 다시 보면 확인된 하향 → 지휘관의 믿음이 내려간다
    c.integ[r.id] = 0.7;
    m.sim.t += 1;
    perceive(m.sim, s, A);
    const af = A.beliefs.get('sign', r.id)!;
    expect(af.value.down).toBe(true);
    expect(af.value.level).toBeLessThan(3);
    expect(A.outbox.some((f) => f.key === af.key)).toBe(true);
    expect(cmdStore.merge(BeliefStore.relay(af))).toBe(true);
    expect(cmdStore.val<SignBelief>('sign', r.id)!.level).toBe(af.value.level);
  });
  it('구역 밖에서 임박 조짐을 듣던 대원은 그 소리가 멎은 것을 안다 — 상한 2 의 확인된 하향 (§5.7)', () => {
    const m = findLayout('X6-SB');
    const s = m.s, c = catOf(m.sim, s)!, { r, b } = m.L;
    for (let i = 0; i < s.fire.length; i++) s.fire[i] = 0;
    const B = agentAt(m, fireRids(m.sim)[0], b[0], b[1]);
    c.integ[r.id] = 0.3; perceive(m.sim, s, B);
    expect(signOf(B, r.id)!.level).toBe(3);
    c.integ[r.id] = 0.8; m.sim.t += 1; perceive(m.sim, s, B);
    const f = signOf(B, r.id)!;
    expect([f.level, f.down]).toEqual([2, true]);
    expect(B.beliefs.get('sign', r.id)!.text).toContain('붕괴 임박 징후 멎음');
    // 다시 보아도 같은 말을 되풀이하지 않는다
    B.outbox.length = 0; m.sim.t += 1; perceive(m.sim, s, B);
    expect(B.outbox.length).toBe(0);
  });
  it('용기: 불길에 직접 노출(눈 4칸)과 안전밸브 소리(7칸, 벽 너머) — 열이 오르기 전에는 아무 말도 없다', () => {
    const m = find('X6-G', 'fire', 'std', (q) => q.s.props.some((p) => p.kind === 'gas'));
    const s = m.s; catOf(m.sim, s);
    const p = s.props.find((q) => q.kind === 'gas')!;
    const ids = fireRids(m.sim);
    const [nx, ny] = tileWhere(s, (x, y) => Math.hypot(x - p.x, y - p.y) <= 2.5 && Math.hypot(x - p.x, y - p.y) >= 1 && los(s, x, y, p.x, p.y));
    const [fx, fy] = tileWhere(s, (x, y) => { const d = Math.hypot(x - p.x, y - p.y); return d >= 5 && d <= 6.5 && !los(s, x, y, p.x, p.y); });
    const Near = agentAt(m, ids[0], nx, ny), Far = agentAt(m, ids[1], fx, fy);
    const id = SIGN_BASE.vessel + p.id;
    perceive(m.sim, s, Near);
    expect(signOf(Near, id)).toBeUndefined();
    // 불길이 닿고 열이 0.3: 곁에서 보는 대원만 (2)
    for (let i = 0; i < s.fire.length; i++) s.fire[i] = 0;
    s.fire[p.y * s.w + p.x] = 0.6; p.heatLoad = 0.35;
    expect(vesselLevel(s, p)).toBe(2);
    perceive(m.sim, s, Near); perceive(m.sim, s, Far);
    expect(signOf(Near, id)!.level).toBe(2);
    expect(signOf(Far, id)).toBeUndefined();
    // 안전밸브(0.55): 벽 너머 6칸의 대원도 듣는다
    p.heatLoad = 0.6;
    perceive(m.sim, s, Near); perceive(m.sim, s, Far);
    expect(signOf(Near, id)!.level).toBe(3);
    expect(signOf(Far, id)!.level).toBe(3);
    expect(Far.beliefs.get('sign', id)!.text).toContain('안전밸브 작동음');
    expect(vesselName(p)).toBe('가스 용기');
  });
  it('터진 가스 용기를 아직 살아 있다고 믿는 대원은 본 순간 바로잡는다 (예전에는 영영 active 로 남았다)', () => {
    const m = find('X6-G', 'fire', 'std', (q) => q.s.props.some((p) => p.kind === 'gas'));
    const s = m.s;
    const p = s.props.find((q) => q.kind === 'gas')!;
    const [x, y] = tileWhere(s, (tx, ty) => Math.hypot(tx - p.x, ty - p.y) <= 2.5 && Math.hypot(tx - p.x, ty - p.y) >= 1 && los(s, tx, ty, p.x, p.y));
    const A = agentAt(m, fireRids(m.sim)[0], x, y);
    perceive(m.sim, s, A);
    expect(A.beliefs.val<{ active: boolean }>('haz', p.id)!.active).toBe(true);
    p.exploded = true;
    m.sim.t += 1;
    perceive(m.sim, s, A);
    const f = A.beliefs.get('haz', p.id)!;
    expect(f.value.active).toBe(false);
    expect(f.text).toBe('가스 용기 폭발 확인');
  });
  it('합치기 규칙: 확인된 조짐의 단계는 down 이 붙은 사실로만 내려가고, 미확인 사실은 확인된 것을 덮지 않는다', () => {
    const b = new BeliefStore();
    const mk = (lv: number, t: number, down?: boolean, verified = true) => mkFact('sign', 7, { kind: 'struct', level: lv, region: 7, x: 1, y: 1, down } as SignBelief, '시험', t, 1, verified, 's');
    expect(b.merge(mk(3, 10))).toBe(true);
    expect(b.merge(mk(1, 11))).toBe(false);
    expect([b.val<SignBelief>('sign', 7)!.level, b.get('sign', 7)!.t]).toEqual([3, 10]);
    expect(b.merge(mk(2, 12, true))).toBe(true);
    expect(b.val<SignBelief>('sign', 7)!.level).toBe(2);
    expect(b.merge(mk(3, 13))).toBe(true);      // 올라가는 것은 언제나
    expect(b.merge(mk(0, 14, false, false))).toBe(false);      // 미확인은 확인된 것을 덮지 않는다
    expect(b.merge(mk(0, 15, true))).toBe(true);
    expect(b.val<SignBelief>('sign', 7)!.level).toBe(0);
  });
  it('단계 2 이상은 바로(중요 보고), 단계 1 은 묶음 보고로 보낸다', () => {
    const m = find('X6-SB', 'fire', 'std', (q) => { try { roomPair(q.s); return true; } catch { return false; } });
    const s = m.s;
    const [x, y] = tileWhere(s, (_x, _y, i) => !s.shadow[i] && s.region[i] >= 0);
    const A = agentAt(m, fireRids(m.sim)[0], x, y);
    const r0 = s.radio.length;
    learn(m.sim, A, mkFact('sign', 3, { kind: 'struct', level: 1, region: 3, x: 1, y: 1 } as SignBelief, '시험', m.sim.t, 1, true, '시험 구획 천장에서 삐걱이는 소리 — 구조 약화 조짐'));
    flushOutbox(m.sim, s, A);
    expect(s.radio.length).toBe(r0);      // 5초를 기다린다
    learn(m.sim, A, mkFact('sign', 4, { kind: 'struct', level: 2, region: 4, x: 1, y: 1 } as SignBelief, '시험', m.sim.t, 1, true, '시험 구획 천장 균열·처짐 — 붕괴 위험'));
    flushOutbox(m.sim, s, A);
    expect(s.radio.length).toBe(r0 + 1);
    const msg = s.radio[s.radio.length - 1];
    expect(msg.facts.map((f) => f.id).sort()).toEqual([3, 4]);
    const e = m.sim.events[msg.eventId];
    expect(e.text).toContain('균열·처짐');
    expect(e.importance).toBe(1);
  });
  it('들은 조짐이 단계를 낮추면(down) 받은 대원의 관찰 기억도 그 단계가 된다. 확인 무전에는 조짐도 다시 보고한다', () => {
    const m = find('X6-SB', 'fire', 'std', (q) => { try { roomPair(q.s); return true; } catch { return false; } });
    const s = m.s;
    const [x, y] = tileWhere(s, (_x, _y, i) => !s.shadow[i] && s.region[i] >= 0);
    const ids = fireRids(m.sim);
    const A = agentAt(m, ids[0], x, y), B = agentAt(m, ids[1], x, y);
    A.nextThink = B.nextThink = 1e9;      // 이 틱에 판단하지 않게 (무전 배달만 본다)
    s.agents.push(A, B);
    B.signObs = { 5: 3 };
    B.beliefs.merge(mkFact('sign', 5, { kind: 'struct', level: 3, region: 5, x: 1, y: 1 } as SignBelief, '시험', m.sim.t, 1, true, '시험'));
    s.radio.push({ id: s.nextMsgId++, t: m.sim.t, deliverAt: m.sim.t, from: A.rid, to: -1, kind: 'report', facts: [mkFact('sign', 5, { kind: 'struct', level: 0, region: 5, x: 1, y: 1, down: true } as SignBelief, '시험', m.sim.t, 1, true, '시험 구획 구조 이상 징후 없음')], workId: -1, text: '', eventId: -1 });
    tickScene(m.sim, s);
    expect(B.signObs![5]).toBe(0);
    expect(B.beliefs.val<SignBelief>('sign', 5)!.level).toBe(0);
    // 확인 무전: B 가 아는 조짐을 다시 보고 대기열에 넣는다
    B.outbox.length = 0;
    s.radio.push({ id: s.nextMsgId++, t: m.sim.t, deliverAt: m.sim.t, from: A.rid, to: -1, kind: 'rollcall', facts: [], workId: -1, text: '', eventId: -1 });
    tickScene(m.sim, s);
    expect(B.outbox.some((f) => f.type === 'sign' && f.id === 5)).toBe(true);
  });
  it('외부 관찰의 기억(extSeen): 벽 너머 관찰이 덮은 실내 구획과 센 불을 본 시각을 적는다', () => {
    const m = findLayout('X6-SB');
    const s = m.s, { r } = m.L;
    for (let i = 0; i < s.fire.length; i++) s.fire[i] = 0;
    for (const i of r.tiles.slice(0, 3)) s.fire[i] = 0.6;
    s.burning = 3;
    const A = agentAt(m, fireRids(m.sim)[0], 0, 0);
    const [x, y] = tileWhere(s, (tx, ty, i) => { if (isIndoor(s.tiles[i])) return false; A.x = tx; A.y = ty; const d = Math.hypot(tx - r.cx, ty - r.cy); return d <= 9 && d + 1 < 2.4 * visionOf(m.sim, s, A); });
    A.x = A.px = x; A.y = A.py = y;
    perceive(m.sim, s, A);
    expect(A.extSeen).toBeUndefined();      // 보통 관찰은 기억을 만들지 않는다
    m.sim.t += 2;
    perceive(m.sim, s, A, 2.4, true);
    const e = A.extSeen!;
    expect(e.cov.length).toBe(s.regions.length);
    expect(e.cov[r.id]).toBeCloseTo(m.sim.t, 3);
    expect(e.cov0[r.id]).toBeCloseTo(m.sim.t, 3);
    expect(e.hot[r.id]).toBeCloseTo(m.sim.t, 3);
    // 불이 꺼진 뒤의 관찰: 덮은 시각은 새로 적히고 처음 시각과 센 불의 시각은 그대로
    const t0 = m.sim.t;
    for (let i = 0; i < s.fire.length; i++) s.fire[i] = 0;
    m.sim.t += 7;
    perceive(m.sim, s, A, 2.4, true);
    expect(e.cov[r.id]).toBeCloseTo(m.sim.t, 3);
    expect(e.cov0[r.id]).toBeCloseTo(t0, 3);
    expect(e.hot[r.id]).toBeCloseTo(t0, 3);
    for (const q of s.regions) if (!q.indoor) expect(e.cov[q.id]).toBe(-1);
  });
  it('상공의 관측자는 조짐을 보지 않는다', () => {
    const m = find('X6-SB', 'fire', 'std', (q) => { try { roomPair(q.s); return true; } catch { return false; } });
    const s = m.s, c = catOf(m.sim, s)!;
    const { r } = roomPair(s);
    const [x, y] = tileWhere(s, (_x, _y, i) => s.region[i] === r.id);
    const A = agentAt(m, fireRids(m.sim)[0], x, y);
    A.aloft = true;
    c.integ[r.id] = 0.3;
    perceive(m.sim, s, A);
    expect(A.beliefs.list('sign').length).toBe(0);
    expect(A.signObs).toBeUndefined();
  });
});

// ───────────────────────── 그림 (§7.3 — 결과 불변) ─────────────────────────
describe('X6 단계 2: 현장 위의 위험 그림 (catLayer)', () => {
  it('관찰자·AI 시점 모두 예외 없이 그리고, 그려도 시뮬레이션은 한 글자도 바뀌지 않는다. 위험 상태가 없는 현장에는 아무것도 하지 않는다', async () => {
    const m = find('X6-G', 'fire', 'std', (q) => q.s.props.some((p) => p.kind === 'gas'));
    const s = m.s;
    // 위험 상태가 없으면 만들지도 않는다 (그림이 위험 상태를 만들면 결과가 바뀐다)
    await withFakeDom(() => { drawCatUnder(fakeCtx(), m.sim, s, 24, { truth: true, timeMs: 0, mini: false, cmd: undefined }); });
    expect(s.cat).toBeUndefined();
    const c = catOf(m.sim, s)!;
    const rs = indoorRegs(s);
    c.integ[rs[0].id] = 0.3; c.integ[rs[1 % rs.length].id] = 0.42; c.integ[rs[2 % rs.length].id] = 0.55;
    const p = s.props.find((q) => q.vessel)!; p.heatLoad = 0.7;
    const cmd = agentAt(m, fireRids(m.sim)[0], 3, 17);
    cmd.isCommander = true;
    cmd.beliefs.merge(mkFact('sign', rs[0].id, { kind: 'struct', level: 3, region: rs[0].id, x: rs[0].cx, y: rs[0].cy } as SignBelief, '시험', 0, 1, true, ''));
    cmd.beliefs.merge(mkFact('sign', SIGN_BASE.vessel + p.id, { kind: 'vessel', level: 3, region: 0, x: p.x, y: p.y, prop: p.id } as SignBelief, '시험', 0, 1, true, ''));
    cmd.beliefs.merge(mkFact('sign', SIGN_BASE.gas + rs[0].id, { kind: 'gas', level: 2, region: rs[0].id, x: rs[0].cx, y: rs[0].cy, lel: 35 } as SignBelief, '시험', 0, 1, true, ''));
    const g = make('X6-SG', 'hazmat', 'std'), gc = catOf(g.sim, g.s)!;
    for (const i of indoorRegs(g.s)[0].tiles) gc.gas![i] = 1.2;
    const before = [worldDigest(m.sim, s), worldDigest(g.sim, g.s), JSON.stringify([Array.from(c.integ), p.heatLoad, Array.from(gc.gas!)])];
    const out: string[] = [];
    await withFakeDom(() => {
      for (const truth of [true, false]) for (const [sim, sc] of [[m.sim, s], [g.sim, g.s]] as [Sim, Scene][]) {
        const o = { truth, timeMs: 1234, mini: false, cmd: sc === s ? cmd : undefined };
        drawCatUnder(fakeCtx(), sim, sc, 24, o);
        for (const l of drawCatOver(sim, sc, 24, o)) out.push(`${truth ? 'T' : 'A'}:${l.text}`);
      }
    });
    expect([worldDigest(m.sim, s), worldDigest(g.sim, g.s), JSON.stringify([Array.from(c.integ), p.heatLoad, Array.from(gc.gas!)])]).toEqual(before);
    expect(out).toContain('T:붕괴 임박');
    expect(out.some((t) => t.startsWith('T:구조 약화'))).toBe(true);
    expect(out).toContain('T:LEL 초과');
    expect(out).toContain('A:붕괴 임박');
    expect(out).toContain('A:LEL 35%');
    // 작은 창(mini)은 표지를 내지 않는다
    expect(drawCatOver(m.sim, s, 24, { truth: true, timeMs: 0, mini: true, cmd })).toEqual([]);
  });
});

// ───────────────────────── 단계 5: AI 의 반응 (§10-4 · §5) ─────────────────────────
import { agentCost, fitFor, workLabel } from '../src/sim/field/agents';
import { commanderThink } from '../src/sim/field/commander';
import { think } from '../src/sim/field/brain';
import { dangerMap } from '../src/sim/field/orders/catastrophe';
import { OPS_ID, OPS_PAR, exteriorSpots, gateBlocks, nearBuilding, newOps, opsExterior, zoneMask } from '../src/sim/field/ops';
import type { OpsFact } from '../src/sim/field/ops';
import { fieldReport } from '../src/sim/dispatch/dispatcher';
import { assess } from '../src/sim/dispatch/analyst';
import type { NoGoZone, WorkItem } from '../src/sim/types';

/** 강제 교대를 돌려, 현장 평가를 마쳤고(지휘관은 음영 밖) 지휘관이 아닌 활동 대원이 실내 방에 서 있는 때를 찾는다 */
function liveInside(prefix: string, force = 'fire/std', need = 1): { sim: Sim; s: Scene; I: Incident; cmd: FieldAgent; b: FieldAgent; r: Region } {
  const [ft, fv] = force.split('/');
  for (let k = 0; k < 40; k++) {
    const sim = new Sim(prefix + k, NORMAL, 1200, { force });
    for (let n = 0; n < 6000 && !sim.ended; n++) {
      sim.step();
      const I = sim.incidents.find((q) => q.truth.type === ft && q.truth.variant === fv);
      if (!I) continue;
      if (I.phase === 'closed') break;
      const s = sim.scenes[I.id];
      if (!s || !s.sizeupDone || (s.ops && s.ops.zones.length)) continue;
      const cmd = s.agents.find((a) => a.isCommander && a.status === 'active');
      if (!cmd || s.shadow[tileOf(s, cmd.x, cmd.y)]) continue;
      for (const b of s.agents) {
        if (b === cmd || b.status !== 'active' || b.carrying !== -1 || (b.task && b.task.kind === 'evacuate')) continue;
        const rg = s.region[tileOf(s, b.x, b.y)];
        if (rg < 0 || !s.regions[rg].indoor || s.regions[rg].kind !== 'room') continue;
        const inside = s.agents.filter((q) => q !== cmd && q.status === 'active' && s.region[tileOf(s, q.x, q.y)] === rg).length;
        if (inside >= need) return { sim, s, I, cmd, b, r: s.regions[rg] };
      }
    }
  }
  throw new Error('조건에 맞는 교대를 찾지 못함');
}
const struct3 = (sim: Sim, r: Region) => mkFact('sign', SIGN_BASE.struct + r.id, { kind: 'struct', level: 3, region: r.id, x: r.cx, y: r.cy } as SignBelief, '시험', sim.t, 1, true, `${r.name} 붕괴 임박 (시험)`);
/** 지휘관 하나만 있는 현장 (현장 평가는 끝난 것으로) */
function withCmd(m: Made, rid: number): FieldAgent {
  const cmd = agentAt(m, rid, m.s.staging.x, m.s.staging.y);
  cmd.isCommander = true; m.s.commanderRid = rid; m.s.agents.push(cmd); m.s.sizeupDone = true; m.s.mismatchLogged = true;
  m.s.shadow.fill(0);
  return cmd;
}
const zoneOf = (s: Scene, key: string): NoGoZone | undefined => s.ops?.zones.find((z) => z.key === key);

describe('X6 단계 5: 지휘관이 철수를 명령한다 (§10-4)', () => {
  it('지휘관의 믿음에 구조 조짐 3 을 넣으면 두 계획 주기 안에 철수 구역·WITHDRAWAL·철수 명령·경적이 생기고, 음영 구역의 대원도 경적으로 알아 30초 안에 구역 밖에 나와 인원 점검에 응답한다. 그 구역의 일은 다시 생기지 않는다', () => {
    const { sim, s, I, cmd, b, r } = liveInside('X6-W');
    for (const i of r.tiles) s.shadow[i] = 1;      // 그 방은 무전 음영 — 무전은 못 듣지만 경적은 들린다
    cmd.beliefs.merge(struct3(sim, r));
    const ev0 = sim.events.length, t0 = sim.t;
    let horn = false, zoneAt = -1;
    for (let k = 0; k < 8 * 5; k++) { sim.step(); if (s.fx.some((f) => f.kind === 'horn')) horn = true; if (zoneAt < 0 && zoneOf(s, `struct:${r.id}`)) zoneAt = sim.t; }
    const z = zoneOf(s, `struct:${r.id}`)!;
    expect(z.level).toBe(3);
    expect(z.regions).toContain(r.id);
    expect(I.problems.some((p) => p.code === 'WITHDRAWAL' && p.detail.includes(r.name))).toBe(true);
    expect(sim.events.slice(ev0).some((e) => e.text.startsWith('전원 철수!') && e.text.includes(r.name))).toBe(true);
    expect(horn).toBe(true);
    expect(b.beliefs.val<OpsFact>('ops', OPS_ID)?.zones.some((q) => q.key === z.key)).toBe(true);      // 음영 구역이어도 경적으로 안다
    // 30초 안에 구역 밖 (구역 칸이 아닌 곳)
    let out = -1;
    for (let k = 0; k < 30 * 5 && out < 0; k++) { sim.step(); if (b.status !== 'active' || zoneMask(s, s.ops!.zones)[tileOf(s, b.x, b.y)] < 3) out = sim.t; }
    expect(out).toBeGreaterThan(0);
    expect(out - t0).toBeLessThan(40);
    // 인원 점검 응답 (조용한 보고 — 묶음 보고 5초 + 무전)
    let par = false;
    for (let k = 0; k < 20 * 5 && !par; k++) { sim.step(); if (b.status !== 'active' || cmd.beliefs.get('ops', OPS_PAR + b.rid)) par = true; }
    expect(par).toBe(true);
    // 그 구역을 대상으로 하는 새 일은 허락된 것(밖에서 하는 진압·냉각)뿐이다
    const zm = zoneMask(s, s.ops!.zones);
    const fresh = s.board.filter((w) => w.createdAt > zoneAt + 0.01 && w.region >= 0 && s.regions[w.region].tiles.some((i) => zm[i] >= 3));
    expect(fresh.every((w) => w.kind === 'suppress' || w.kind === 'mitigate'), fresh.map((w) => w.kind).join(',')).toBe(true);
  });

  it('지휘관이 무전 음영 구역에 있으면 철수 기록도 경적도 남기지 않고, 음영을 벗어난 뒤 남긴다', () => {
    const { sim, s, I, cmd, r } = liveInside('X6-WS');
    s.shadow.fill(1);
    cmd.beliefs.merge(struct3(sim, r));
    let horn = false;
    for (let k = 0; k < 8 * 5; k++) { sim.step(); if (s.fx.some((f) => f.kind === 'horn')) horn = true; }
    expect(I.problems.some((p) => p.code === 'WITHDRAWAL')).toBe(false);
    expect(horn).toBe(false);
    expect(zoneOf(s, `struct:${r.id}`)).toBeUndefined();      // 안에 대원이 있는 철수 구역은 명령이 나간 뒤에만 만든다
    s.shadow.fill(0);
    for (let k = 0; k < 8 * 5; k++) { sim.step(); if (s.fx.some((f) => f.kind === 'horn')) horn = true; }
    expect(I.problems.some((p) => p.code === 'WITHDRAWAL')).toBe(true);
    expect(horn).toBe(true);
  });

  it('인원 점검이 끝난다: 응답할 수 없는 대원(쓰러짐)은 점검에서 빠지고, 끝내 응답하지 않는 대원이 있으면 세 번 다시 묻고 "인원 점검 미완료" 와 함께 철수 모드를 벗어난다', () => {
    const { sim, s, cmd, b, r } = liveInside('X6-P');
    cmd.beliefs.merge(struct3(sim, r));
    for (let k = 0; k < 8 * 5 && !(s.ops && s.ops.mode === 'withdraw'); k++) sim.step();
    const ops = s.ops!;
    expect(ops.mode).toBe('withdraw');
    expect(ops.parAsked).toContain(b.rid);
    // 다른 대원 하나를 쓰러뜨린다 (있으면) — 점검에서 빠진다
    const other = s.agents.find((q) => q !== b && q !== cmd && ops.parAsked.indexOf(q.rid) >= 0);
    if (other) { other.status = 'down'; sim.responders[other.rid].status = 'down'; }
    // b 는 끝내 나오지 못한다 (매 틱 방 한가운데로 되돌린다 — 응답이 없다)
    const ev0 = sim.events.length;
    for (let k = 0; k < 80 * 5 && ops.mode === 'withdraw'; k++) { b.x = r.cx; b.y = r.cy; b.path = null; sim.responders[b.rid].health = 100; sim.step(); }
    if (other) expect(ops.parAsked).not.toContain(other.rid);
    expect(ops.mode).not.toBe('withdraw');
    expect(sim.events.slice(ev0).filter((e) => e.text.startsWith('인원 점검:')).length).toBeLessThanOrEqual(3);
    expect(sim.events.slice(ev0).some((e) => e.text.startsWith('인원 점검 미완료'))).toBe(true);
    expect(sim.t).toBeLessThanOrEqual(ops.parDue + 4);
  });

  it('건물 조짐 3 이면 건물 전체 철수 → 외부 방어(한계 시간 보탬 +150 을 적는다)이고, 외부 방어로 60초 넘게 있어도 대원은 활동 중이라 방치로 닫히지 않는다 (§5.5·§6.4)', () => {
    const { sim, s, I, cmd } = liveInside('X6-D');
    const [bx, by] = [Math.round(s.regions.filter((r) => r.indoor).reduce((k, r) => k + r.cx, 0) / s.regions.filter((r) => r.indoor).length), 5];
    const pin = () => cmd.beliefs.merge(mkFact('sign', SIGN_BASE.bldg, { kind: 'bldg', level: 3, region: -1, x: bx, y: by } as SignBelief, '시험', sim.t, 1, true, '건물 외벽 균열이 번지고 기울어짐 — 전체 붕괴 임박! (시험)'));
    pin();
    for (let k = 0; k < 75 * 5 && I.phase !== 'closed'; k++) { if (k % 25 === 0 && cmd.status === 'active') pin(); sim.step(); }
    expect(zoneOf(s, 'bldg')?.level).toBe(3);
    expect(['defensive', 'withdraw']).toContain(s.ops!.mode);
    expect(s.ops!.limitBonus).toBe(150);
    expect(I.closeReason).not.toBe('abandoned');
    expect(s.agents.some((a) => a.status === 'active')).toBe(true);
    expect(I.problems.some((p) => p.code === 'WITHDRAWAL' && p.detail.includes('건물 전체'))).toBe(true);
  });

  it('복도는 같이 막히지 않는다: 방 하나의 붕괴 임박은 그 방과 이웃 방만 구역이 된다 (조짐이 난 구역 자신이 복도면 그 복도는 든다)', () => {
    const m = find('X6-C', 'fire', 'std', (q) => q.s.regions.some((r) => r.kind === 'room' && regionNbrs(q.s)[r.id].some((n) => q.s.regions[n].kind === 'corridor')));
    const room = m.s.regions.find((r) => r.kind === 'room' && regionNbrs(m.s)[r.id].some((n) => m.s.regions[n].kind === 'corridor'))!;
    const cmd = withCmd(m, fireRids(m.sim)[0]);
    cmd.beliefs.merge(struct3(m.sim, room));
    const { hits } = dangerMap(m.sim, m.s, cmd, newOps(0));
    const h = hits.get(`struct:${room.id}`)!;
    expect(h.level).toBe(3);
    expect(h.regions).toContain(room.id);
    for (const r of h.regions) expect(r === room.id || m.s.regions[r].kind === 'room').toBe(true);
    const cor = m.s.regions.find((r) => r.kind === 'corridor')!;
    cmd.beliefs.merge(struct3(m.sim, cor));
    expect(dangerMap(m.sim, m.s, cmd, newOps(0)).hits.get(`struct:${cor.id}`)!.regions).toContain(cor.id);
  });
});

describe('X6 단계 5: 문·이동 비용·물러남 (§5.1·§5.3)', () => {
  it('문: 단계 3 구역 안의 수색은 작업판에 생기지 않고(빈 작업 — 작업판이 불어나지 않는다) 그 수가 ops.gated 에 남는다. 진압은 밖에서 하므로 막지 않는다', () => {
    const m = make('X6-G5', 'fire', 'std');
    const cmd = withCmd(m, fireRids(m.sim)[0]);
    const room = m.s.regions.find((r) => r.indoor && r.searchable && r.kind === 'room')!;
    const ops = m.s.ops = newOps(m.sim.t);
    ops.zones.push({ key: `struct:${room.id}`, kind: 'struct', level: 3, regions: [room.id], x: -1, y: -1, r: 0, since: m.sim.t, why: '시험', ev: -1 });
    commanderThink(m.sim, m.s, cmd);
    const n1 = m.s.board.length;
    commanderThink(m.sim, m.s, cmd);
    expect(m.s.board.some((w) => w.kind === 'search' && w.region === room.id)).toBe(false);
    expect(m.s.board.length).toBe(n1);
    expect(ops.gated).toBeGreaterThan(0);
    expect(gateBlocks(m.sim, m.s, cmd, 'search', { region: room.id })).toBe(true);
    expect(gateBlocks(m.sim, m.s, cmd, 'suppress', { region: room.id })).toBe(false);
    expect(opsExterior(m.s, room.id)).toBe(true);
    // 단계 2 는 허락된 일만
    ops.zones[0].level = 2;
    expect(gateBlocks(m.sim, m.s, cmd, 'search', { region: room.id })).toBe(true);
    expect(gateBlocks(m.sim, m.s, cmd, 'suppress', { region: room.id })).toBe(false);
  });

  it('이동 비용: 믿음 속 단계 3 구역 칸은 지나갈 수 없다 — 철수 중·그 안에 서 있는 대원은 예외. 피하는 곳은 +20', () => {
    const m = make('X6-AC', 'fire', 'std');
    const room = m.s.regions.find((r) => r.indoor && r.kind === 'room' && r.tiles.length >= 6)!;
    const zones = [{ key: `struct:${room.id}`, kind: 'struct' as const, level: 3 as const, regions: [room.id], x: -1, y: -1, r: 0 }];
    const a = agentAt(m, fireRids(m.sim)[0], m.s.staging.x, m.s.staging.y);
    a.beliefs.merge(mkFact('ops', OPS_ID, { mode: 'withdraw', zones, t: 1 } as OpsFact, '시험', 1, 1, true, ''));
    const i = room.tiles[0];
    expect(agentCost(m.sim, m.s, a)(i)).toBe(-1);
    a.task = { ...({} as object), kind: 'evacuate', workId: -1 } as never;
    expect(agentCost(m.sim, m.s, a)(i)).toBeGreaterThanOrEqual(0);
    a.task = null;
    const inside = agentAt(m, fireRids(m.sim)[1], room.cx, room.cy);
    inside.beliefs.merge(mkFact('ops', OPS_ID, { mode: 'withdraw', zones, t: 1 } as OpsFact, '시험', 1, 1, true, ''));
    expect(agentCost(m.sim, m.s, inside)(i)).toBeGreaterThanOrEqual(0);
    const c0 = agentCost(m.sim, m.s, inside)(i);
    inside.avoid = { regions: [room.id], x: -1, y: -1, r: 0, until: m.sim.t + 30 };
    expect(agentCost(m.sim, m.s, inside)(i) - c0).toBeCloseTo(20, 5);
  });

  it('자기 감각의 붕괴 임박: 그 방에 서 있는 대원은 다음 판단에 철수를 맡고(의무), 30초 동안 그 방과 이웃 방을 피한다 — 그 방의 수색을 맡지 않는다', () => {
    const m = make('X6-SD', 'fire', 'std');
    const room = m.s.regions.find((r) => r.indoor && r.kind === 'room' && r.searchable && r.tiles.length >= 6)!;
    const cmd = withCmd(m, fireRids(m.sim)[0]);
    const a = agentAt(m, fireRids(m.sim)[1], room.cx, room.cy);
    m.s.agents.push(a);
    a.beliefs.merge(struct3(m.sim, room));
    think(m.sim, m.s, a);
    expect(a.task?.kind).toBe('evacuate');
    expect(a.avoid?.regions).toContain(room.id);
    expect(a.avoid!.until).toBeCloseTo(m.sim.t + 30, 5);
    const w: WorkItem = { id: 0, kind: 'search', region: room.id, cas: -1, prop: -1, hostile: -1, tile: -1, mate: -1, priority: 0.6, status: 'open', assignees: [], max: 1, createdAt: 0, doneAt: -1, note: '', fails: 0, holdUntil: 0, thorough: false, orderSentAt: {}, cause: -1, failedAt: {}, animal: -1, risky: undefined };
    expect(fitFor(m.sim, m.s, a, w)).toBe(0);
    void cmd;
  });

  it('외부 방수 자리: 실내가 아니고 지나갈 수 있으며, 구조 위험이면 건물 칸에서 2칸 넘게 떨어져 있고, 그 구획 칸 하나에 시야선이 5.5칸 안에서 닿는다', () => {
    const m = find('X6-EX', 'fire', 'std', (q) => q.s.regions.some((r) => r.indoor && exteriorSpots(q.s, r.id, true).length > 0));
    const room = m.s.regions.find((r) => r.indoor && exteriorSpots(m.s, r.id, true).length > 0)!;
    const near = nearBuilding(m.s);
    for (const i of exteriorSpots(m.s, room.id, true)) {
      expect(isIndoor(m.s.tiles[i])).toBe(false);
      expect(staticPass(m.s.tiles[i])).toBe(true);
      expect(near[i]).toBe(0);
      const x = i % m.s.w, y = (i / m.s.w) | 0;
      expect(room.tiles.some((j) => Math.hypot((j % m.s.w) - x, ((j / m.s.w) | 0) - y) <= 5.5)).toBe(true);
    }
  });
});

describe('X6 단계 5: 막는 조치·가스·관제 (§5.7·§5.8·§5.9)', () => {
  it('가스 용기 곁에 불이 있다고 알면 냉각(0.9 이상)을 내고 원 4칸의 진입 금지 구역을 만든다. 냉각은 진압과 같은 자격이다', () => {
    const m = find('X6-CL', 'fire', 'std', (q) => q.s.props.some((p) => p.kind === 'gas' && q.s.region[p.y * q.s.w + p.x] >= 0));
    const p = m.s.props.find((q) => q.kind === 'gas' && m.s.region[q.y * m.s.w + q.x] >= 0)!;
    const rg = m.s.region[p.y * m.s.w + p.x];
    const cmd = withCmd(m, fireRids(m.sim)[0]);
    cmd.beliefs.merge(mkFact('haz', p.id, { kind: 'gas', active: true, x: p.x, y: p.y }, '시험', m.sim.t, 1, true, ''));
    cmd.beliefs.merge(mkFact('fire', rg, 0.6, '시험', m.sim.t, 1, true, ''));
    commanderThink(m.sim, m.s, cmd);
    const w = m.s.board.find((q) => q.kind === 'mitigate' && q.prop === p.id)!;
    expect(w).toBeDefined();
    expect(w.priority).toBeGreaterThanOrEqual(0.9);
    expect(workLabel(m.s, w)).toMatch(/냉각/);
    const z = zoneOf(m.s, `vessel:${p.id}`)!;
    expect([z.level, z.r]).toEqual([2, 4]);
    const hose = m.sim.responders.find((r) => r.dept === 'fire' && hasKit(m.sim, r.id, 'hose'))!;
    const noHose = m.sim.responders.find((r) => r.dept === 'police')!;
    expect(fitFor(m.sim, m.s, agentAt(m, hose.id, 3, 17), w)).toBeGreaterThan(0);
    expect(fitFor(m.sim, m.s, agentAt(m, noHose.id, 3, 17), w)).toBe(0);
  });

  it('가스 단계 3 구역: 측정기를 든 대원이 현장에 있으면 문턱(구역 밖)에서 재측정을 내고, 그 일은 측정기를 든 대원만 맡는다. 밸브를 덮어 잠그러 갈 수 없으면 도시가스 차단을 한 번 요청한다', () => {
    const m = make('X6-GM', 'hazmat', 'std');
    const valve = m.s.props.find((p) => p.kind === 'valve')!;
    const rg = m.s.region[valve.y * m.s.w + valve.x] >= 0 ? m.s.region[valve.y * m.s.w + valve.x] : m.s.regions.find((r) => r.indoor)!.id;
    const meterRid = m.sim.responders.find((r) => hasKit(m.sim, r.id, 'gasMeter'))!.id;
    const cmd = withCmd(m, meterRid);
    const reg = m.s.regions[rg];
    cmd.beliefs.merge(mkFact('sign', SIGN_BASE.gas + rg, { kind: 'gas', level: 3, region: rg, x: reg.cx, y: reg.cy, lel: 70 } as SignBelief, '시험', m.sim.t, 1, true, ''));
    commanderThink(m.sim, m.s, cmd);
    expect(zoneOf(m.s, `gas:${rg}`)?.level).toBe(2);
    const w = m.s.board.find((q) => q.kind === 'mitigate' && q.prop < 0 && q.region === rg)!;
    expect(w).toBeDefined();
    expect(m.s.region[w.tile]).not.toBe(rg);
    expect(workLabel(m.s, w)).toMatch(/가스 재측정/);
    expect(fitFor(m.sim, m.s, cmd, w)).toBeGreaterThan(0);
    const plain = m.sim.responders.find((r) => r.dept === 'fire' && !hasKit(m.sim, r.id, 'gasMeter'))!;
    expect(fitFor(m.sim, m.s, agentAt(m, plain.id, 3, 17), w)).toBe(0);
    // 가스 조짐 2 이상인데 밸브 위치를 모른다 → 도시가스 차단 요청 (한 사건에 한 번)
    expect(m.s.ops!.utilityAsked).toBeGreaterThanOrEqual(0);
    // 불이 곁에 있다고 알면 단계 3 (가스와 불길 — 폭발 위험). 밸브를 알아도 다시 요청하지 않는다
    cmd.beliefs.merge(mkFact('fire', rg, 0.4, '시험', m.sim.t, 1, true, ''));
    cmd.beliefs.merge(mkFact('haz', valve.id, { kind: 'leak', active: true, x: valve.x, y: valve.y }, '시험', m.sim.t, 1, true, ''));
    commanderThink(m.sim, m.s, cmd);
    commanderThink(m.sim, m.s, cmd);
    expect(zoneOf(m.s, `gas:${rg}`)?.level).toBe(3);
    expect(m.sim.events.filter((e) => e.text.startsWith('관제, 도시가스 공급 차단 요청')).length).toBe(1);
    // 단계 3 구역이 덮은 밸브는 문이 막는다 (가스 용기 냉각·진압만 밖에서)
    expect(gateBlocks(m.sim, m.s, cmd, 'mitigate', { prop: valve.id })).toBe(true);
  });

  it('관제: 붕괴·폭발 사실이 실린 현장 상황 보고는 위험도를 다음 문턱까지 올리고 위험을 더한다. 새 신고 진술로 다시 평가해도 지워지지 않는다', () => {
    const m = make('X6-FR', 'fire', 'std');
    assess(m.sim, m.I, '시험');
    const before = m.I.assessment!.severity;
    const f = mkFact('sign', SIGN_BASE.event, { kind: 'event', level: 3, region: 0, x: 1, y: 1, what: 'partial' } as SignBelief, '현장', m.sim.t, 1, true, '');
    fieldReport(m.sim, m.I, m.s, { id: 0, t: m.sim.t, deliverAt: m.sim.t, from: -1, to: -2, kind: 'sitrep', facts: [f], workId: -1, text: '', eventId: -1 });
    expect(m.I.fieldRisk!.risks).toContain('건물 붕괴');
    expect(m.I.fieldRisk!.sev).toBeGreaterThan(before);
    expect(m.I.assessment!.severity).toBeGreaterThanOrEqual(m.I.fieldRisk!.sev);
    expect(m.I.assessment!.risks).toContain('건물 붕괴');
    assess(m.sim, m.I, '새 신고');
    expect(m.I.assessment!.severity).toBeGreaterThanOrEqual(m.I.fieldRisk!.sev);
    expect(m.I.assessment!.risks).toContain('건물 붕괴');
  });
});

// ───────────────────────── 단계 6: 사건의 끝 (§6·§10-5) ─────────────────────────
import { CLOSE_BLOCKERS } from '../src/sim/field/sceneRegistry';
import { explodeGas } from '../src/sim/field/catastrophe';
import { inRubble, isRubbleMode } from '../src/sim/field/ops';
import { TYPE_DEFS } from '../src/sim/incidentTypes';
import { scenarioOf } from '../src/sim/scenarios';
import type { CasBelief } from '../src/sim/types';

const blocked = (m: Made, a: FieldAgent): boolean => CLOSE_BLOCKERS.some((b) => b(m.sim, m.s, a));
/** 시계를 그 초로 (지휘관의 판단만 직접 부르는 시험) */
const tickTo = (m: Made, t: number): void => { m.sim.tick = Math.round(t / m.sim.dt); m.sim.t = m.sim.tick * m.sim.dt; };
const searchItem = (region: number): WorkItem => ({ id: 0, kind: 'search', region, cas: -1, prop: -1, hostile: -1, tile: -1, mate: -1, priority: 0.6, status: 'open', assignees: [], max: 1, createdAt: 0, doneAt: -1, note: '', fails: 0, holdUntil: 0, thorough: false, orderSentAt: {}, cause: -1, failedAt: {}, animal: -1, risky: undefined });
const totalFact = (t: number, x = 1, y = 1) => mkFact('sign', SIGN_BASE.event, { kind: 'event', level: 3, region: -1, x, y, what: 'total' } as SignBelief, '시험', t, 1, true, '굉음! 건물 전체 무너짐 (시험)');
const bldg3 = (t: number) => mkFact('sign', SIGN_BASE.bldg, { kind: 'bldg', level: 3, region: -1, x: 1, y: 1 } as SignBelief, '시험', t, 1, true, '건물 전체 붕괴 (시험)');
const casIn = (r: Region, t: number, id: number) => mkFact('cas', id, { x: Math.round(r.cx), y: Math.round(r.cy), mob: 'immobile', band: 1, where: 'scene', treated: false, trappedDone: true, tq: 0, water: false } as CasBelief, '시험', t, 1, true, '');

describe('X6 단계 6: 일어난 뒤 사건이 끝난다 (§10-5)', () => {
  it('첫 도착 뒤 건물 전체 붕괴(화재·붕괴)나 가스 폭발(가스 누출·가스 폭발 현장)을 일으켜도 그 사건은 교대 상한 전에 닫힌다 — 한계 시간 16교대 가운데 2건 이하, 방치 0건', () => {
    const out: { force: string; k: number; reason: string; fired: boolean }[] = [];
    for (const force of ['fire/std', 'collapse/std', 'hazmat/std', 'collapse/gasblast']) {
      const [ft, fv] = force.split('/');
      for (let k = 0; k < 4; k++) {
        const sim = new Sim('X6-E' + k, NORMAL, 1200, { force });
        let fired = false, I: Incident | undefined;
        for (let n = 0; n < 9000 && !sim.ended; n++) {
          sim.step();
          I = sim.incidents.find((q) => q.truth.type === ft && q.truth.variant === fv);
          if (!I) continue;
          if (I.phase === 'closed') break;
          const s = sim.scenes[I.id];
          if (fired || !s || s.arrivedAt < 0 || sim.t - s.arrivedAt < 5) continue;
          const c = catOf(sim, s);
          if (!c) continue;
          if (ft === 'hazmat' || fv === 'gasblast') {
            const v = s.props.find((p) => p.kind === 'valve');
            if (!v) { fired = true; continue; }
            let rg = s.region[v.y * s.w + v.x];
            if (rg < 0 || !s.regions[rg].indoor) rg = s.regions.find((r) => r.indoor)!.id;
            const cloud = s.regions[rg].tiles.filter((i) => isIndoor(s.tiles[i]));
            for (const i of cloud) c.gas![i] = 1.5;
            explodeGas(sim, s, I, c, cloud, cloud[0], 3);
          } else if (c.struct) collapseBuilding(sim, s, I, c);
          fired = true;
        }
        expect(I, `${force} ${k}`).toBeDefined();
        expect(I!.phase, `${force} ${k}`).toBe('closed');
        expect(I!.closedAt).toBeLessThanOrEqual(sim.hardCap);
        out.push({ force, k, reason: I!.closeReason ?? '', fired });
      }
    }
    expect(out.filter((o) => o.fired).length).toBeGreaterThanOrEqual(14);
    expect(out.filter((o) => o.reason === 'timeout').length, JSON.stringify(out)).toBeLessThanOrEqual(2);
    expect(out.filter((o) => o.reason === 'abandoned' || o.reason === 'shiftend').length, JSON.stringify(out)).toBe(0);
  }, 180_000);

  it('한계 시간 보탬: 세계 쪽(붕괴)과 지휘 쪽(외부 방어)을 합쳐 330초까지 늦춘다 (§6.4)', () => {
    const run = (cat: number, ops: number, over: number): string => {
      const m = make('X6-LB', 'fire', 'std');
      withCmd(m, fireRids(m.sim)[0]);
      tickTo(m, 2000);
      const base = TYPE_DEFS[m.s.kind].limit + (scenarioOf(m.I.truth.type, m.I.truth.variant)?.limit ?? 0);
      const c = catOf(m.sim, m.s)!;
      c.limitBonus = cat;
      if (ops) { m.s.ops = newOps(m.sim.t); m.s.ops.limitBonus = ops; }
      m.s.arrivedAt = m.sim.t - (base + over);
      tickScene(m.sim, m.s);
      return m.I.phase === 'closed' ? m.I.closeReason ?? 'closed' : 'open';
    };
    expect(run(0, 0, 200)).toBe('timeout');
    expect(run(180, 0, 200)).toBe('timeout');      // 세계 쪽만 180 — 200 을 덮지 못한다
    expect(run(180, 150, 200)).toBe('open');        // 합 330
    expect(run(240, 150, 320)).toBe('open');        // 합 390 → 330 에서 자른다
    expect(run(240, 150, 335)).toBe('timeout');
  });
});

describe('X6 단계 6: 종료를 막는 것 (§6.2)', () => {
  it('문이 막은 수색이 있는 동안 상황 종료가 선언되지 않고, 낮은 측정값이 들어와 구역이 풀리면 수색이 나간 뒤 끝난다', () => {
    const m = make('X6-GB6', 'hazmat', 'std');
    const plain = m.sim.responders.find((r) => r.dept === 'fire' && !hasKit(m.sim, r.id, 'gasMeter'))!;
    const cmd = withCmd(m, plain.id);      // 측정기가 없다 — 재측정이 나가지 않으므로 종료를 막는 것은 문 하나다
    const rooms = m.s.regions.filter((r) => r.indoor && r.searchable);
    const rg = rooms[0];
    tickTo(m, 100);
    for (const r of rooms) if (r !== rg) cmd.beliefs.merge(mkFact('srch', r.id, 1, '시험', m.sim.t, 1, true, ''));
    cmd.beliefs.merge(mkFact('sign', SIGN_BASE.gas + rg.id, { kind: 'gas', level: 3, region: rg.id, x: rg.cx, y: rg.cy, lel: 70 } as SignBelief, '시험', m.sim.t, 1, true, ''));
    for (let k = 0; k < 4; k++) { commanderThink(m.sim, m.s, cmd); tickTo(m, m.sim.t + 4); }
    expect(zoneOf(m.s, `gas:${rg.id}`)?.level).toBe(2);
    expect(m.s.board.some((w) => w.kind === 'search' && w.region === rg.id && (w.status === 'open' || w.status === 'active'))).toBe(false);      // 구역이 생긴 주기에 거두었고 문이 다시 만들지 않는다
    expect(m.s.ops!.gated).toBeGreaterThan(0);
    expect(blocked(m, cmd)).toBe(true);
    expect(m.I.phase).not.toBe('closed');
    // 낮은 측정값(확인된 하향)이 들어오면 구역이 풀리고 수색이 나간다
    cmd.beliefs.merge(mkFact('sign', SIGN_BASE.gas + rg.id, { kind: 'gas', level: 0, region: rg.id, x: rg.cx, y: rg.cy, lel: 5, down: true } as SignBelief, '시험', m.sim.t, 1, true, ''));
    commanderThink(m.sim, m.s, cmd);
    expect(zoneOf(m.s, `gas:${rg.id}`)).toBeUndefined();
    tickTo(m, m.sim.t + 1);
    commanderThink(m.sim, m.s, cmd);      // 구역은 지휘 규칙(계획 주기의 끝)이 풀므로 수색은 다음 주기에 나간다
    expect(m.s.board.some((w) => w.kind === 'search' && w.region === rg.id && (w.status === 'open' || w.status === 'active'))).toBe(true);
    expect(m.s.ops!.gated).toBe(0);
    // 그 수색이 끝나면(확인율 1 — 맡은 일도 끝) 종료한다
    cmd.beliefs.merge(mkFact('srch', rg.id, 1, '시험', m.sim.t, 1, true, ''));
    for (const w of m.s.board) if (w.kind === 'search' && w.region === rg.id && (w.status === 'open' || w.status === 'active')) { w.status = 'done'; w.doneAt = m.sim.t; }
    cmd.task = null;
    for (let k = 0; k < 4 && m.I.phase !== 'closed'; k++) { tickTo(m, m.sim.t + 4); commanderThink(m.sim, m.s, cmd); }
    expect(m.I.closeReason, m.s.board.filter((w) => w.status === 'open' || w.status === 'active').map((w) => w.kind).join(',') + ' ' + blocked(m, cmd)).toBe('resolved');
  });

  it('인원 점검 중에는 시한(parDue)까지만, 철수 구역(단계 3)이 있으면 끝까지 막는다. 원천을 막았다고 알면 남은 가스의 측정값으로는 막지 않는다', () => {
    const m = make('X6-BL', 'hazmat', 'std');
    const cmd = withCmd(m, fireRids(m.sim)[0]);
    tickTo(m, 200);
    const ops = m.s.ops = newOps(m.sim.t);
    expect(blocked(m, cmd)).toBe(false);
    ops.mode = 'withdraw'; ops.parDue = m.sim.t + 10;
    expect(blocked(m, cmd)).toBe(true);
    ops.parDue = m.sim.t - 1;
    expect(blocked(m, cmd)).toBe(false);
    ops.mode = 'interior';
    ops.zones.push({ key: 'struct:0', kind: 'struct', level: 3, regions: [0], x: -1, y: -1, r: 0, since: m.sim.t, why: '시험', ev: -1 });
    expect(blocked(m, cmd)).toBe(true);
    ops.zones.length = 0;
    const rg = m.s.regions.find((r) => r.indoor)!;
    cmd.beliefs.merge(mkFact('sign', SIGN_BASE.gas + rg.id, { kind: 'gas', level: 2, region: rg.id, x: rg.cx, y: rg.cy, lel: 40 } as SignBelief, '시험', m.sim.t, 1, true, ''));
    expect(blocked(m, cmd)).toBe(true);      // 90초 안의 가스 2 — 누출을 막았는지 모른다
    const valve = m.s.props.find((p) => p.kind === 'valve')!;
    cmd.beliefs.merge(mkFact('haz', valve.id, { kind: 'leak', active: false, x: valve.x, y: valve.y }, '시험', m.sim.t, 1, true, ''));
    expect(blocked(m, cmd)).toBe(false);     // 원천 차단을 안다 — 남은 가스는 빠지는 중
    cmd.beliefs.merge(mkFact('haz', valve.id, { kind: 'leak', active: true, x: valve.x, y: valve.y }, '시험', m.sim.t + 1, 1, true, ''));
    expect(blocked(m, cmd)).toBe(true);
    tickTo(m, m.sim.t + 91);
    expect(blocked(m, cmd)).toBe(false);     // 오래된 측정값으로는 막지 않는다
    ops.concluded = true; ops.mode = 'withdraw'; ops.parDue = m.sim.t + 10;
    expect(blocked(m, cmd)).toBe(false);     // 외부 확인 종료를 정했으면 풀린다
  });
});

describe('X6 단계 6: 다 탄 현장의 외부 확인 종료 (§6.2)', () => {
  const setup = (seed: string) => {
    const m = find(seed, 'fire', 'std', (q) => q.sim.weather === 'clear');
    const cmd = withCmd(m, fireRids(m.sim)[0]);
    tickTo(m, 300);
    const indoor = m.s.regions.filter((r) => r.indoor).map((r) => r.id);
    const ops = m.s.ops = newOps(m.sim.t);
    ops.mode = 'defensive';
    ops.zones.push({ key: 'bldg', kind: 'bldg', level: 3, regions: indoor.slice(), x: -1, y: -1, r: 0, since: m.sim.t - 100, why: '시험', ev: -1 });
    for (const r of indoor) { ops.burnSince[r] = m.sim.t - 200; ops.everHot.push(r); cmd.beliefs.merge(mkFact('fire', r, 0.8, '시험', m.sim.t - 100, 1, true, '')); }
    cmd.beliefs.merge(bldg3(m.sim.t - 100));
    const n = m.s.regions.length;
    cmd.extSeen = { hot: new Float32Array(n).fill(-1), cov: new Float32Array(n).fill(m.sim.t - 2), cov0: new Float32Array(n).fill(m.sim.t - 100) };
    m.s.fire.fill(0);
    return { m, cmd, indoor };
  };

  it('외부 관찰이 60초 넘게 센 불을 보지 못했으면 불 믿음을 0(확인된 사실)으로 합치고 외부 확인 종료를 정한다 — 종료 차단이 풀려 사건이 끝난다', () => {
    const { m, cmd, indoor } = setup('X6-XC');
    commanderThink(m.sim, m.s, cmd);
    expect(m.s.ops!.concluded).toBe(true);
    for (const r of indoor) { const f = cmd.beliefs.get('fire', r)!; expect(f.value).toBe(0); expect(f.verified).toBe(true); }
    expect(m.sim.events.some((e) => e.text.startsWith('건물이 전소되어 내부 확인이 불가합니다.'))).toBe(true);
    expect(blocked(m, cmd)).toBe(false);
    for (let k = 0; k < 4 && m.I.phase !== 'closed'; k++) { tickTo(m, m.sim.t + 4); commanderThink(m.sim, m.s, cmd); }
    expect(m.I.closeReason).toBe('resolved');
  });

  it('60초 안에 센 불을 보았거나, 아직 60초를 지켜보지 못했거나, 안에 살아 있는 구조 대상을 알면 정하지 않는다', () => {
    {
      const { m, cmd, indoor } = setup('X6-XC');
      cmd.extSeen!.hot[indoor[0]] = m.sim.t - 30;
      commanderThink(m.sim, m.s, cmd);
      expect(m.s.ops!.concluded).toBe(false);
    }
    {
      const { m, cmd, indoor } = setup('X6-XC');
      cmd.extSeen!.cov0[indoor[indoor.length - 1]] = m.sim.t - 20;
      commanderThink(m.sim, m.s, cmd);
      expect(m.s.ops!.concluded).toBe(false);
    }
    {
      const { m, cmd, indoor } = setup('X6-XC');
      cmd.beliefs.merge(casIn(m.s.regions[indoor[0]], m.sim.t, m.s.casualties[0].id));
      commanderThink(m.sim, m.s, cmd);
      expect(m.s.ops!.concluded).toBe(false);
    }
  });
});

describe('X6 단계 6: 무너진 현장 — 잔해 수색 국면 (§6.1)', () => {
  it('전체 붕괴를 안 지 30초가 지나면 잔해 수색 국면: 기록·수색 믿음 0.3·안에 있던 사람은 매몰 추정, 구조·건물 단계는 더 내지 않고, 잔해 구역은 공기호흡기를 멘 대원만 수색한다', () => {
    const m = make('X6-RB', 'fire', 'std');
    const cmd = withCmd(m, fireRids(m.sim)[0]);
    tickTo(m, 300);
    const r = m.s.regions.find((q) => q.indoor && q.searchable && q.kind === 'room')!;
    const c = m.s.casualties[0];
    cmd.beliefs.merge(mkFact('srch', r.id, 1, '시험', m.sim.t - 60, 1, true, ''));
    cmd.beliefs.merge(casIn(r, m.sim.t - 60, c.id));
    cmd.beliefs.merge(totalFact(m.sim.t - 10));
    cmd.beliefs.merge(bldg3(m.sim.t - 10));
    commanderThink(m.sim, m.s, cmd);
    expect(m.s.ops!.mode).not.toBe('rubble');      // 아직 30초가 지나지 않았다 — 건물 전체가 철수 구역
    expect(zoneOf(m.s, 'bldg')?.level).toBe(3);
    tickTo(m, m.sim.t + 25);
    commanderThink(m.sim, m.s, cmd);
    expect(m.s.ops!.mode).toBe('rubble');
    expect(isRubbleMode(m.s)).toBe(true);
    expect(inRubble(m.s, r.id)).toBe(true);
    expect(zoneOf(m.s, 'bldg')).toBeUndefined();
    expect(m.sim.events.some((e) => e.text === '붕괴가 멎었습니다. 잔해 수색을 시작한다 — 소방·구조 대원만 진입.')).toBe(true);
    expect(cmd.beliefs.val<number>('srch', r.id)).toBeCloseTo(0.3, 5);
    const cb = cmd.beliefs.val<CasBelief>('cas', c.id)!;
    expect([cb.mob, cb.trappedDone]).toEqual(['trapped', false]);
    const { hits } = dangerMap(m.sim, m.s, cmd, m.s.ops!);
    expect([...hits.values()].some((h) => h.kind === 'bldg' || h.kind === 'struct')).toBe(false);
    const police = m.sim.responders.find((q) => q.dept === 'police' && !hasKit(m.sim, q.id, 'scba'))!;
    const scba = m.sim.responders.find((q) => q.dept === 'fire' && hasKit(m.sim, q.id, 'scba'))!;
    expect(fitFor(m.sim, m.s, agentAt(m, police.id, 3, 17), searchItem(r.id))).toBe(0);
    expect(fitFor(m.sim, m.s, agentAt(m, scba.id, 3, 17), searchItem(r.id))).toBeGreaterThan(0);
  });

  it('통째로 무너진 건물 위의 대원은 건물 조짐 3 으로 물러나지 않는다 (무너진 지 30초 뒤). 그 전에는 물러난다', () => {
    const fresh = (age: number): FieldAgent => {
      const m = make('X6-RB2', 'fire', 'std');
      withCmd(m, fireRids(m.sim)[0]);
      tickTo(m, 300);
      const r = m.s.regions.find((q) => q.indoor && q.kind === 'room')!;
      const a = agentAt(m, fireRids(m.sim)[1], r.cx, r.cy);
      m.s.agents.push(a);
      a.beliefs.merge(bldg3(m.sim.t - 40));
      a.beliefs.merge(totalFact(m.sim.t - age));
      think(m.sim, m.s, a);
      return a;
    };
    expect(fresh(5).task?.kind).toBe('evacuate');
    expect(fresh(40).task?.kind).not.toBe('evacuate');
  });

  it('구획 붕괴는 그 구획과 이웃에서 25초 동안 새 무너짐이 없으면 그 구획만 잔해 구역이 된다', () => {
    const m = make('X6-RB3', 'fire', 'std');
    const cmd = withCmd(m, fireRids(m.sim)[0]);
    tickTo(m, 300);
    m.s.ops = newOps(m.sim.t);
    const r = m.s.regions.find((q) => q.indoor && q.searchable && q.kind === 'room')!;
    cmd.beliefs.merge(mkFact('srch', r.id, 1, '시험', m.sim.t - 60, 1, true, ''));
    cmd.beliefs.merge(mkFact('sign', SIGN_BASE.event + 3, { kind: 'event', level: 3, region: r.id, x: r.cx, y: r.cy, what: 'partial' } as SignBelief, '시험', m.sim.t - 10, 1, true, ''));
    commanderThink(m.sim, m.s, cmd);
    expect(m.s.ops!.rubble).not.toContain(r.id);
    tickTo(m, m.sim.t + 16);
    commanderThink(m.sim, m.s, cmd);
    expect(m.s.ops!.rubble).toEqual([r.id]);
    expect(m.s.ops!.mode).not.toBe('rubble');
    expect(inRubble(m.s, r.id)).toBe(true);
    expect(m.s.regions.filter((q) => q.indoor && q.id !== r.id).every((q) => !inRubble(m.s, q.id))).toBe(true);
    expect(m.sim.events.some((e) => e.text === `${r.name} 붕괴가 멎었습니다. 잔해 수색을 시작한다 — 소방·구조 대원만 진입.`)).toBe(true);
    expect(cmd.beliefs.val<number>('srch', r.id)).toBeCloseTo(0.3, 5);
  });

  it('무너지는 소리를 듣지 못한 대원(늦게 닿은 부대)도 잔해 더미를 보면 전체 붕괴를 안다 — 시각은 본 때', () => {
    const m = find('X6-LT', 'fire', 'std', (q) => q.sim.weather === 'clear');
    const c = catOf(m.sim, m.s)!;
    collapseBuilding(m.sim, m.s, m.I, c);
    tickTo(m, m.sim.t + 50);
    // 바깥벽이 보이는 바깥 칸: 건물 칸이 아니고, 6칸 안·시야 안의 바깥벽 칸이 셋 이상
    const foot = footprint(m.s), shell: number[] = [];
    for (let i = 0; i < foot.length; i++) if (foot[i] === FOOT_SHELL) shell.push(i);
    const [x, y] = tileWhere(m.s, (tx, ty, i) => foot[i] === 0 && !isIndoor(m.s.tiles[i]) && shell.filter((j) => Math.hypot((j % m.s.w) - tx, ((j / m.s.w) | 0) - ty) <= 6 && los(m.s, tx, ty, j % m.s.w, (j / m.s.w) | 0)).length >= 3);
    const a = agentAt(m, fireRids(m.sim)[0], x, y);
    m.s.agents.push(a);
    perceive(m.sim, m.s, a);
    const ev = a.beliefs.list('sign').find((f) => (f.value as SignBelief).kind === 'event' && (f.value as SignBelief).what === 'total');
    expect(ev).toBeDefined();
    expect(ev!.t).toBeCloseTo(m.sim.t, 5);
  });
});

// ───────────────────────── 단계 7: 판정·보고서·지도 (§6.5·§6.6·§7) ─────────────────────────
import { catHazardActive, propertyLossOf } from '../src/sim/field/catastrophe';
import { hurtCas } from '../src/sim/field/injury';
import { INCIDENT_PLACES } from '../src/sim/cityPlan';
import { raiseProblem } from '../src/sim/events';
import { placeGone } from '../src/sim/incidents';
import { ruinInfo, ruinMark, ruinSeen } from '../src/view/hazardState';
import { drawRuinsWorld } from '../src/view/city/ruinLayer';
import { RUIN_MARK } from '../src/view/marks';
import { DECISIVE } from '../src/view/scene/fxBook';
import type { PlaceMark } from '../src/sim/types';

const mark = (sim: Sim, placeId: number, state: PlaceMark['state'], incidentId = -1): void => { sim.placeMarks.set(placeId, { placeId, state, t: sim.t, incidentId, burnFrac: 0, ruinFrac: 0 }); };

describe('X6 단계 7: 판정 — 재산 피해·남은 위험 (§6.5)', () => {
  it('재산 피해: X6 일이 없는 화재는 예전 식(탄 비율)과 같고, 전소·전체 붕괴는 1, 화재가 아닌 현장의 폭발은 0.3 이상. 위험 상태가 없는 현장은 예전 식', () => {
    const m = make('X6-PL', 'fire', 'std');
    const c = catOf(m.sim, m.s)!;
    m.s.burnedTiles = 7;
    expect(propertyLossOf(m.s)).toBeCloseTo(7 / Math.max(1, m.s.totalFuelTiles), 9);
    c.burntAt = 10;
    expect(propertyLossOf(m.s)).toBe(1);
    c.burntAt = -1; c.totalAt = 20;
    expect(propertyLossOf(m.s)).toBe(1);
    const h = make('X6-PL2', 'hazmat', 'std');
    const hc = catOf(h.sim, h.s)!;
    expect(propertyLossOf(h.s)).toBe(0);
    hc.vesselN = 1;
    expect(propertyLossOf(h.s)).toBeGreaterThanOrEqual(0.3);
    const md = make('X6-PL3', 'medical', 'std');
    expect(md.s.cat).toBeUndefined();
    expect(propertyLossOf(md.s)).toBe(md.s.props.some((p) => p.ignited) ? 0.4 : 0);
  });

  it('남은 위험: 서 있는 건물의 보강하지 않은 균열 · 달궈진 채 곁에 불이 있는 용기 · 폭발 하한 구름', () => {
    const m = find('X6-HA', 'collapse', 'std', (q) => q.s.props.some((p) => p.kind === 'unstable'));
    const c = catOf(m.sim, m.s)!;
    expect(catHazardActive(m.s)).toBe(true);
    for (const p of m.s.props) if (p.kind === 'unstable') p.mitigated = true;
    expect(catHazardActive(m.s)).toBe(false);
    c.totalAt = 5;
    for (const p of m.s.props) if (p.kind === 'unstable') p.mitigated = false;
    expect(catHazardActive(m.s)).toBe(false);      // 통째로 무너진 뒤의 균열은 남은 위험이 아니다
    const h = make('X6-HA2', 'hazmat', 'std');
    const hc = catOf(h.sim, h.s)!;
    expect(catHazardActive(h.s)).toBe(false);
    hc.gas![h.s.regions.find((r) => r.indoor)!.tiles[0]] = 1.2;
    expect(catHazardActive(h.s)).toBe(true);
    const f = find('X6-HA3', 'fire', 'std', (q) => q.s.props.some((p) => p.kind === 'gas'));
    catOf(f.sim, f.s);
    const p = f.s.props.find((q) => q.vessel)!;
    p.heatLoad = 0.5;
    expect(catHazardActive(f.s)).toBe(false);      // 곁에 불이 없다
    f.s.fire[p.y * f.s.w + p.x] = 0.6;
    expect(catHazardActive(f.s)).toBe(true);
  });
});

describe('X6 단계 7: 사건 결과·문장·한 줄 요약 (§6.5·§6.6)', () => {
  it('전체 붕괴에 휘말린 대원과 숨진 구조 대상: 결과의 요약(전체 붕괴·휘말린 대원)·원인 사슬 문장·사망 문장의 붕괴 상세·한 줄 요약(건물 붕괴·소실률)', () => {
    const m = find('X6-RS', 'fire', 'std', (q) => q.s.casualties.length > 0);
    const c = catOf(m.sim, m.s)!;
    tickTo(m, 200);
    const r = m.s.regions.find((q) => q.indoor && q.kind === 'room')!;
    const a = agentAt(m, fireRids(m.sim)[0], r.cx, r.cy);
    m.s.agents.push(a);
    m.s.arrivedAt = 100; m.I.firstArrivalAt = 100;
    const ev = collapseBuilding(m.sim, m.s, m.I, c);
    const victim = m.s.casualties.find((q) => !q.dead)!;
    if (victim) hurtCas(m.sim, m.s, m.I, victim, victim.health + 5, 'crush', { ev });
    for (let k = 0; k < 5; k++) { m.sim.tick++; m.sim.t = m.sim.tick * m.sim.dt; tickScene(m.sim, m.s); }      // 숨짐·쓰러짐의 전이는 틱에서
    closeIncident(m.sim, m.I, 'resolved');
    const res = m.I.result!;
    expect(res.catastrophe!.total).toBe(true);
    expect(res.catastrophe!.crewCaught).toBe(1);
    expect(res.propertyLoss).toBe(1);
    expect(res.headline).toContain('건물 붕괴');
    expect(res.headline).toContain('소실률 100%');
    expect(res.analysis.some((l) => l.startsWith('구조물이 무너졌습니다: 건물 전체 붕괴'))).toBe(true);
    if (victim) expect(res.analysis.some((l) => l.includes(`구조 대상 ${victim.label}`) && l.includes('— 건물 전체 붕괴)')), JSON.stringify([res.analysis, victim.deathCause, victim.causeEvent, ev])).toBe(true);
  });

  it('위험 조짐(막음·못 막음)·전원 철수·폭발 문장은 기록된 문제에서만 만든다 — 조짐 뒤의 붕괴는 그 간격을, 알던 위험의 폭발은 끝나지 않은 조치를 말한다', () => {
    const m = make('X6-SN', 'hazmat', 'std');
    catOf(m.sim, m.s);
    tickTo(m, 100);
    const opt = { role: 'COMMANDER' as const, actor: '시험', imp: 2, text: '시험' };
    raiseProblem(m.sim, m.I, 'DANGER_SIGN', '가스 농도 — 1층 공정실 1', opt, false);
    m.I.problems[m.I.problems.length - 1].recovered = true; m.I.problems[m.I.problems.length - 1].recoveryText = '차단·환기 — 막음';
    raiseProblem(m.sim, m.I, 'DANGER_SIGN', '용기 가열 — 1층 창고 용기 주변', opt, false);
    tickTo(m, 130);
    raiseProblem(m.sim, m.I, 'WITHDRAWAL', '용기 폭발 임박으로 1층 창고 용기 주변 전원 철수', opt, false);
    raiseProblem(m.sim, m.I, 'EXPLOSION', '보관 중이던 가스 용기 폭발', { role: 'SYSTEM', actor: '현장', imp: 3, text: '시험' }, false);
    closeIncident(m.sim, m.I, 'resolved');
    const A = m.I.result!.analysis;
    expect(A.some((l) => l.includes('위험 조짐을 보고 막았습니다: 가스 농도 — 1층 공정실 1 → 차단·환기 — 막음'))).toBe(true);
    expect(A.some((l) => l.includes('조짐이 있었지만 막지 못했습니다: 용기 가열 — 1층 창고 용기 주변'))).toBe(true);
    expect(A.some((l) => l === '용기 폭발 임박으로 1층 창고 용기 주변 전원 철수 — 끝까지 밖에서 대응했습니다.')).toBe(true);
    expect(A.some((l) => l.startsWith('폭발이 일어났습니다: 보관 중이던 가스 용기 폭발.') && l.includes('냉각이 끝나기 전이었습니다'))).toBe(true);
    // 결과 문장(폭발)은 철수·조짐 문장보다 앞이다 (9줄 컷 — §5.10)
    expect(A.findIndex((l) => l.startsWith('폭발이 일어났습니다'))).toBeLessThan(A.findIndex((l) => l.includes('전원 철수')));
    expect(m.I.result!.catastrophe!.withdrew).toBe(true);
    expect(m.I.result!.catastrophe!.averted).toBe(1);
  });

  it('끝난 화재: 건물 상태가 없는데 15% 넘게 탔으면 그을린 건물로 남긴다 (실제 건물의 화재만)', () => {
    const m = make('X6-SC', 'fire', 'std');
    const c = catOf(m.sim, m.s)!;
    let n = 0;
    for (let i = 0; i < c.fuelMask.length && n < Math.ceil(c.fuel0 * 0.2); i++) if (c.fuelMask[i]) { m.s.burned[i] = 1; n++; }
    m.s.burnedTiles = n;
    closeIncident(m.sim, m.I, 'resolved');
    expect(m.sim.placeMarks.get(m.I.truth.placeId)?.state).toBe('scorched');
    const q = make('X6-SC2', 'fire', 'std');
    closeIncident(q.sim, q.I, 'resolved');
    expect(q.sim.placeMarks.size).toBe(0);      // 거의 타지 않았다
  });
});

describe('X6 단계 7: 무너졌거나 다 탄 건물에서는 그 교대에 새 사건이 나지 않는다 (§10-9)', () => {
  it('평소 추첨(pickPlace)은 그 건물을 빼고, 건물을 정해 일으켜도(재난·은신처의 길) 다른 건물에서 난다', () => {
    const sim = new Sim('X6-PG', NORMAL);
    const table = scenarioOf('fire', 'std')?.places ?? INCIDENT_PLACES.fire;
    const ok = sim.city.places.filter((q) => q.facility < 0 && (table[q.kind] ?? 0) > 0);
    const keep = ok[0];
    for (const q of ok) if (q !== keep) mark(sim, q.id, q.id % 2 ? 'collapsed' : 'burnt');
    expect(placeGone(sim, ok[1].id)).toBe(true);
    expect(placeGone(sim, keep.id)).toBe(false);
    for (let k = 0; k < 3; k++) expect(createIncident(sim, { type: 'fire', variant: 'std', rng: sim.rng.fork('pg' + k) }).truth.placeId).toBe(keep.id);
    const I = createIncident(sim, { type: 'fire', variant: 'std', placeId: ok[1].id, rng: sim.rng.fork('pg-fixed') });
    expect(I.truth.placeId).not.toBe(ok[1].id);
    expect(I.truth.placeId).toBe(keep.id);
    // 일부 무너짐·폭발 흔적·그을림은 빼지 않는다
    mark(sim, ok[2].id, 'partial');
    expect(placeGone(sim, ok[2].id)).toBe(false);
    expect(createIncident(sim, { type: 'fire', variant: 'std', placeId: ok[2].id, rng: sim.rng.fork('pg-p') }).truth.placeId).toBe(ok[2].id);
  });
});

describe('X6 단계 7: 지도의 건물 상태·소리·카메라 (§7.2·§7.4 — 결과 불변)', () => {
  it('건물 상태를 남긴 사건(화재)은 관찰자 시점에서 바로, AI 시점에서는 부대가 닿았던 사건만 보인다. 상태 → 규모 열쇠 (전체 붕괴·전소·폭발 흔적·그을림)', () => {
    const m = make('X6-MP', 'fire', 'std');
    catOf(m.sim, m.s);
    expect(ruinSeen(m.sim, m.I, true)).toBe('none');
    mark(m.sim, m.I.truth.placeId, 'burnt', m.I.id);
    expect(ruinSeen(m.sim, m.I, true)).toBe('confirmed');
    expect(ruinSeen(m.sim, m.I, false)).toBe('none');
    m.I.firstArrivalAt = 50;
    expect(ruinSeen(m.sim, m.I, false)).toBe('confirmed');
    expect(ruinInfo(m.sim, m.I)!.level).toBe('burnt');
    for (const [st, lv] of [['collapsed', 'total'], ['blasted', 'blasted'], ['scorched', 'scorched']] as const) { mark(m.sim, m.I.truth.placeId, st, m.I.id); expect(ruinInfo(m.sim, m.I)!.level).toBe(lv); }
    expect(ruinMark('total')).toBe(RUIN_MARK.total);
    expect(ruinMark('burnt')).toBe(RUIN_MARK.burnt);
    expect(ruinMark('scorched')).toBe(RUIN_MARK.burnt);
    expect(ruinMark('blasted')).toBe(RUIN_MARK.partial);
    // 다른 사건이 남긴 상태는 이 사건의 것이 아니다
    m.sim.placeMarks.get(m.I.truth.placeId)!.incidentId = m.I.id + 99;
    expect(ruinSeen(m.sim, m.I, true)).toBe('none');
  });

  it('지도 덧그림(전체 붕괴·전소·폭발 흔적·그을림)은 예외 없이 그리고 시뮬레이션을 바꾸지 않는다. 철수 경적은 결정적 순간이다', async () => {
    const m = make('X6-MD', 'fire', 'std');
    catOf(m.sim, m.s);
    m.I.phase = 'closed';
    const before = [m.sim.events.length, m.sim.logHash];
    for (const st of ['collapsed', 'burnt', 'blasted', 'scorched', 'partial'] as const) {
      mark(m.sim, m.I.truth.placeId, st, m.I.id);
      await withFakeDom(() => { drawRuinsWorld(fakeCtx(), m.sim, { truth: true, timeMs: 1234, scale: 6, mini: false }); drawRuinsWorld(fakeCtx(), m.sim, { truth: false, timeMs: 0, scale: 0.5, mini: false }); });
    }
    expect([m.sim.events.length, m.sim.logHash]).toEqual(before);
    expect(DECISIVE.has('horn')).toBe(true);
  });
});
