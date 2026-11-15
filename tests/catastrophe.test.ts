// X6 위험의 현실화 (docs/specs/X6-catastrophe.md §10). 단계마다 채운다 — 지금은 단계 1(상태만)·단계 2(조짐)의 시험이다:
//   단계 1: 자료형, catOf(대상·입구·용기 판별·처음 값), 생김새 도움 함수, 난수 흐름이 부모를 소비하지 않음, 계산만 하는 틱이 상태를 바꾸지 않음(손 계산과 함께).
//   단계 2: §10-3 조짐(관찰·보고 규칙·합치기·무전·외부 관찰의 기억·가스 용기 구멍), §10-6 재현성, 그림(catLayer)이 결과를 바꾸지 않음.
//   (단계 1 의 "세계 규칙을 뺀 교대와 같다"는 단계 2 에서 끝났다 — 조짐이 사실로 들어오면 무전 문구가 바뀐다)
// 뒤 단계가 더할 것(설계서 §10 의 번호): 1 방치하면 일어난다 · 2 조치하면 일어나지 않는다 · 4 철수 · 5 사건이 끝난다 · 7 정보 격리(일부는 아래에 있다) ·
//   8 가짜 연출 없음 · 9 도시 지도 · 10 층 너머 · 11 catOf 의 입구(일부는 아래에 있다) · 12 깔린 대원.
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fakeCtx, withFakeDom } from './fakeCanvas';
import { hasKit } from '../src/sim/crews';
import { flushOutbox, learn, makeAgent, perceive, visionOf } from '../src/sim/field/agents';
import { BeliefStore, mkFact } from '../src/sim/field/beliefs';
import { los, staticPass, tileOf } from '../src/sim/field/grid';
import { vesselLevel, vesselName } from '../src/sim/field/catastrophe';
import { SIGN_BASE } from '../src/sim/field/ops';
import { drawCatOver, drawCatUnder } from '../src/view/scene/catLayer';
import type { FieldAgent, Region, SignBelief } from '../src/sim/types';
import { PROBLEM_SYS } from '../scripts/metrics';
import { catStats } from '../scripts/catstats';
import { PROBLEM_LABEL } from '../src/sim/debrief';
import { NORMAL } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { CAT, LOSS_BURN, LOSS_CREEP, LOSS_FIRE, LOSS_N, LOSS_QUAKE, NO_STRUCT, bldgLevel, burnFracOf, catOf, catRng, catTick, gasClouds, vesselKind } from '../src/sim/field/catastrophe';
import { isIndoor } from '../src/sim/field/grid';
import { applyWater } from '../src/sim/field/hazards';
import { baseScene, set } from '../src/sim/field/kit';
import { FOOT_FLOOR_EDGE, FOOT_IN, FOOT_SHELL, footprint, regionNbrs } from '../src/sim/field/ops';
import { catRule } from '../src/sim/field/rules/catastrophe';
import { SCENE_RULES } from '../src/sim/field/sceneRegistry';
import { tickScene } from '../src/sim/field/sceneManager';
import { createIncident } from '../src/sim/incidents';
import type { Rng } from '../src/sim/rng';
import { T } from '../src/sim/types';
import type { CatState, Incident, IncidentType, Scene } from '../src/sim/types';

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
  it('용기의 열: 곁의 불이 달구고(안전밸브 단계가 한계보다 먼저), 물을 맞으면 오르지 않고, 불이 꺼지면 식는다', () => {
    const m = find('X6-G', 'fire', 'std', (q) => q.s.props.some((p) => p.kind === 'gas'));
    m.s.fire.fill(0); m.s.wet.fill(0);
    const c = catOf(m.sim, m.s)!;
    const p = m.s.props.find((q) => q.vessel === 'cylinder')!;
    const side = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => (p.y + dy) * m.s.w + p.x + dx)[0];
    let ventAt = -1, fullAt = -1;
    for (let t = 1; t <= 80; t++) {
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
    expect(p.exploded).toBeFalsy();      // 단계 1 은 터뜨리지 않는다
    // 불이 꺼지면 초당 0.012 씩 식는다
    m.s.fire.fill(0);
    for (let t = 0; t < 10; t++) stepCat(m, c);
    expect(p.heatLoad).toBeCloseTo(1 - 10 * CAT.VESSEL_IDLE, 5);
    // 매초 물을 뿌리면 같은 불 곁에서도 달궈지지 않는다
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
    expect(v.ignited).toBeFalsy();      // 단계 1 은 터뜨리지 않는다
  });
  it('전소 판정: 건물 칸 위의 연료 칸이 70% 넘게 타면 시각만 적는다 (기록은 아직 없다)', () => {
    const { m, c } = quiet('X6-B1');
    const fuelTiles: number[] = [];
    for (let i = 0; i < c.fuelMask.length; i++) if (c.fuelMask[i]) fuelTiles.push(i);
    expect(fuelTiles.length).toBe(c.fuel0);
    const burn = (k: number): void => { for (let q = 0; q < fuelTiles.length; q++) m.s.burned[fuelTiles[q]] = q < k ? 1 : 0; m.s.burnedTiles = k; };
    const ev0 = m.sim.events.length;
    burn(Math.ceil(c.fuel0 * 0.7) - 1);
    stepCat(m, c);
    expect(burnFracOf(c, m.s)).toBeLessThan(CAT.BURNOUT);
    expect(c.burntAt).toBe(-1);
    burn(Math.ceil(c.fuel0 * 0.7));
    stepCat(m, c);
    expect(burnFracOf(c, m.s)).toBeGreaterThanOrEqual(CAT.BURNOUT);
    expect(c.burntAt).toBeCloseTo(m.sim.t, 3);
    const at = c.burntAt;
    burn(c.fuel0);
    stepCat(m, c);
    expect(c.burntAt).toBe(at);      // 한 번만
    expect(burnFracOf(c, m.s)).toBe(1);
    expect(m.sim.events.length).toBe(ev0);
    expect(m.I.problems.length).toBe(0);
    expect(m.sim.placeMarks.size).toBe(0);
  });
  it('방치된 화재: 틱이 몇백 번 돌아 위험 상태는 자라지만, 세계는 규칙이 없을 때와 한 칸도 다르지 않다', () => {
    // 같은 현장 둘: 하나는 세계 규칙(계산만 하는 틱)과 함께, 하나는 그 규칙을 뺀 채 400초를 혼자 돌린다
    const a = find('X6-G', 'fire', 'std', (q) => q.s.props.some((p) => p.kind === 'gas'));
    const b = find('X6-G', 'fire', 'std', (q) => q.s.props.some((p) => p.kind === 'gas'));
    runAlone(a.sim, a.s, 400);
    const k = SCENE_RULES.indexOf(catRule);
    expect(k).toBeGreaterThanOrEqual(0);
    SCENE_RULES.splice(k, 1);
    try { runAlone(b.sim, b.s, 400); } finally { SCENE_RULES.splice(k, 0, catRule); }
    expect(b.s.cat).toBeUndefined();
    expect(worldDigest(a.sim, a.s)).toBe(worldDigest(b.sim, b.s));
    // 그동안 위험 상태는 실제로 계산됐다
    const c = a.s.cat!;
    expect(a.s.burnedTiles).toBeGreaterThan(20);
    expect(Math.min(...indoorRegs(a.s).map((r) => c.integ[r.id]))).toBeLessThan(CAT.L3);
    expect(Math.max(...Array.from(c.hotT))).toBeGreaterThan(10);
    expect(Math.max(...Array.from(c.l3Since))).toBeGreaterThan(0);
    expect(c.bldg).toBeLessThan(1);
    expect(burnFracOf(c, a.s)).toBeGreaterThan(0.1);
    // 그리고 X6 의 일은 아직 하나도 일어나지 않았다
    expect([c.gasN, c.vesselN, c.dustN, c.events, c.totalAt, c.limitBonus]).toEqual([0, 0, 0, 0, -1, 0]);
    expect(Array.from(c.fallen).some((v) => v > 0)).toBe(false);
    expect(a.sim.events.some((e) => e.problem === 'STRUCT_COLLAPSE' || e.problem === 'EXPLOSION' || e.problem === 'BURNOUT' || e.problem === 'DANGER_SIGN' || e.problem === 'WITHDRAWAL')).toBe(false);
    expect(a.sim.placeMarks.size).toBe(0);
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
  it('그 교대들에서 조짐은 지휘관에게까지 들어왔고, 세계는 아직 아무것도 일으키지 않는다 (붕괴·폭발·전소·철수·건물 상태 0)', () => {
    let signs = 0, cmdSigns = 0, scenes = 0, moved = 0, radio = 0;
    for (const sim of runs) {
      for (const s of sim.scenes) {
        if (!s) continue;
        for (const a of s.agents) { const l = a.beliefs.list('sign'); signs += l.length; if (a.isCommander) cmdSigns += l.length; }
        if (!s.cat) continue;
        scenes++;
        if (s.cat.struct && indoorRegs(s).some((r) => s.cat!.integ[r.id] < 1)) moved++;
      }
      radio += sim.events.filter((e) => /삐걱이는 소리|균열·처짐|붕괴 임박|가스 농도 LEL|가스 냄새|안전밸브|불길에 직접|전체 붕괴 위험/.test(e.text)).length;
      expect(sim.events.some((e) => e.problem === 'STRUCT_COLLAPSE' || e.problem === 'EXPLOSION' || e.problem === 'BURNOUT' || e.problem === 'DANGER_SIGN' || e.problem === 'WITHDRAWAL')).toBe(false);
      expect(sim.placeMarks.size).toBe(0);
      expect(sim.report!.catastrophe).toBeUndefined();
      expect(sim.report!.placeMarks).toBeUndefined();
      const st = catStats(sim);
      expect([st.burnouts, st.totals, st.partials, st.gas, st.vessel, st.dust, st.known, st.withdrawals, st.reentries, st.defensive, st.extClose, st.crewCaught, st.signs, st.averted, st.gaps.length])
        .toEqual([0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
      expect(st.scenes).toBe(sim.scenes.filter((s) => s && s.cat).length);
      // 아직 아무도 조짐으로 판단하지 않는다: 지휘 상태(Scene.ops)는 생기지 않는다 (단계 5)
      expect(sim.scenes.every((s) => !s || s.ops === undefined)).toBe(true);
    }
    expect(scenes).toBeGreaterThan(20);
    expect(moved).toBeGreaterThan(2);
    expect(signs).toBeGreaterThan(10);
    expect(cmdSigns).toBeGreaterThan(0);
    expect(radio).toBeGreaterThan(3);
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
