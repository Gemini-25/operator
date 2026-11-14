// 대형 사고 (docs/specs/N5-major.md): 여섯 시나리오의 현장, 교대당 많아야 한 번이라는 틀, 시나리오별 고유한 규칙, 재현성
import { describe, expect, it } from 'vitest';
import { NORMAL } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { createIncident } from '../src/sim/incidents';
import { SCENARIOS, scenarioOf } from '../src/sim/scenarios';
import { SCENE_BUILDERS } from '../src/sim/field/sceneRegistry';
import { T } from '../src/sim/types';
import type { Incident, IncidentType, Scene } from '../src/sim/types';
import { MAJOR_SKINS } from '../src/view/scene/skins/major';

const MAJORS: { type: IncidentType; variant: string; cas: [number, number] }[] = [
  { type: 'fire', variant: 'plane', cas: [10, 14] },
  { type: 'traffic', variant: 'train', cas: [10, 14] },
  { type: 'traffic', variant: 'pileup', cas: [8, 12] },
  { type: 'collapse', variant: 'gasblast', cas: [6, 9] },
  { type: 'collapse', variant: 'crane', cas: [3, 5] },
  { type: 'fire', variant: 'ship', cas: [5, 8] },
];

/** 교대를 조금 굴린 뒤 그 시나리오를 정해서 일으킨다 */
function spawn(seed: string, type: IncidentType, variant: string): { sim: Sim; I: Incident; sc: Scene } {
  const sim = new Sim(seed);
  sim.run(60);
  const I = createIncident(sim, { type, variant, rng: sim.rng.fork('major-test') });
  return { sim, I, sc: sim.scenes[I.id]! };
}

/** 대기 지점에서 걸어서 닿는 칸. 잔해와 문은 치우거나 열 수 있고, 차량·배관 같은 고정 소품과 가구·물·벽은 막힌 칸이다 */
function reach(sc: Scene): Uint8Array {
  const seen = new Uint8Array(sc.w * sc.h);
  const pass = (i: number): boolean => {
    const t = sc.tiles[i];
    if (t !== T.FLOOR && t !== T.DOOR && t !== T.GROUND && t !== T.ROAD && t !== T.STAIR && t !== T.TREE && t !== T.TRAIL) return false;
    const p = sc.propAt[i];
    return p < 0 || sc.props[p].kind === 'door' || sc.props[p].kind === 'debris';
  };
  const st = [sc.staging.y * sc.w + sc.staging.x];
  seen[st[0]] = 1;
  while (st.length) {
    const c = st.pop()!, x = c % sc.w, y = (c / sc.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= sc.w || ny >= sc.h) continue;
      const j = ny * sc.w + nx;
      if (!seen[j] && pass(j)) { seen[j] = 1; st.push(j); }
    }
    const sl = sc.stairTo[c];
    if (sl >= 0 && !seen[sl]) { seen[sl] = 1; st.push(sl); }
  }
  return seen;
}
const walkable = (t: number): boolean => t === T.FLOOR || t === T.DOOR || t === T.GROUND || t === T.ROAD || t === T.STAIR;

describe('대형 사고의 틀', () => {
  it('여섯 시나리오가 표에 있고, 저마다 현장 생성기와 신고 문구를 갖는다', () => {
    const majors = SCENARIOS.filter((q) => q.tag === 'major');
    expect(majors.map((q) => `${q.type}/${q.variant}`).sort()).toEqual(MAJORS.map((m) => `${m.type}/${m.variant}`).sort());
    for (const q of majors) {
      expect(SCENE_BUILDERS[`${q.type}/${q.variant}`], q.variant).toBeTruthy();
      expect(q.share).toBeGreaterThan(0);
      expect(q.severity).toEqual([3, 3]);
      expect(q.texts!.length).toBe(2); expect(q.lik!.length).toBe(8);
      expect(q.lik![['fire', 'traffic', 'search', 'armed', 'medical', 'collapse', 'hazmat', 'water'].indexOf(q.type)]).toBeGreaterThanOrEqual(0.6);      // 자기 유형의 가능도가 가장 높다
      expect(q.limit).toBeGreaterThan(0); expect(q.needs).toBeTruthy();
      expect(q.places || q.node, `${q.variant}: 일어나는 곳`).toBeTruthy();
    }
  });

  it('보통 난이도에서는 교대의 절반쯤에 한 번 일어나고, 한 교대에 둘은 없다. 심각도가 낮으면 드물다', () => {
    let n = 0, low = 0;
    const kinds = new Set<string>();
    for (let k = 0; k < 30; k++) {
      const s = new Sim('N5-' + k); s.runToEnd();
      const m = s.incidents.filter((I) => I.tag === 'major');
      expect(m.length, s.seed).toBeLessThanOrEqual(1);
      expect(s.report!.major).toBe(m.length);
      for (const I of m) {
        n++; kinds.add(I.truth.variant);
        expect(I.truth.severity).toBe(3);
        expect(I.phase).toBe('closed'); expect(I.result).not.toBeNull();
        expect(s.events[I.rootEvent].importance).toBe(3);      // 발생 기록은 결정적 장면으로 남는다
      }
      const q = new Sim('N5-' + k, { ...NORMAL, severity: 1 }); q.runToEnd();
      low += q.incidents.filter((I) => I.tag === 'major').length;
    }
    expect(n).toBeGreaterThanOrEqual(8); expect(n).toBeLessThanOrEqual(22);      // 확률 45%
    expect(low).toBeLessThanOrEqual(10);                                          // 확률 15%
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  }, 300000);

  it('평소 추첨에는 대형 사고가 섞이지 않는다 (대형 사고가 일어나지 않은 교대의 사건에는 그 변형이 없다)', () => {
    const variants = new Set(MAJORS.map((m) => m.variant));
    for (let k = 0; k < 8; k++) {
      const s = new Sim('N5-' + k); s.runToEnd();
      for (const I of s.incidents) if (I.tag !== 'major') expect(variants.has(I.truth.variant), `${s.seed} ${I.truth.type}/${I.truth.variant}`).toBe(false);
    }
  }, 120000);
});

describe('대형 사고의 현장', () => {
  it('여섯 현장 모두: 모든 바닥에 걸어서 닿고, 사람 수가 정해진 범위 안이고, 누구에게든 닿을 수 있다', () => {
    for (const m of MAJORS) for (const seed of ['MA', 'MB', 'MC', 'MD', 'ME', 'MF']) {
      const { I, sc } = spawn(seed, m.type, m.variant), tag = `${m.type}/${m.variant} ${seed}`;
      expect(I.tag).toBe('major'); expect(I.truth.variant).toBe(m.variant); expect(sc.variant).toBe(m.variant);
      expect(sc.casualties.length, tag).toBeGreaterThanOrEqual(m.cas[0]); expect(sc.casualties.length, tag).toBeLessThanOrEqual(m.cas[1]);
      const seen = reach(sc);
      // 걸을 수 있는 바닥(물·가구·벽·고정 소품이 놓인 칸 제외)은 모두 대기 지점과 이어져 있다
      let cut = 0;
      for (let i = 0; i < sc.tiles.length; i++) {
        const p = sc.propAt[i];
        if (walkable(sc.tiles[i]) && !seen[i] && (p < 0 || sc.props[p].kind === 'door' || sc.props[p].kind === 'debris')) cut++;
      }
      expect(cut, `${tag}: 닿지 못하는 바닥`).toBe(0);
      // 대기 지점·안전 구역·관측 지점·출입구는 걸을 수 있는 땅이다
      for (const p of [sc.staging, sc.safe, sc.vantage, ...sc.exits, ...sc.spots]) expect(walkable(sc.tiles[p.y * sc.w + p.x]), `${tag}: (${p.x},${p.y})`).toBe(true);
      // 사람마다: 곁(1.5칸)에 닿을 수 있는 칸이 있다. 물에 빠진 사람은 줄이 닿는 거리(3.6칸)에 물가가 있다
      for (const c of sc.casualties) {
        const need = c.inWater ? 3.6 : 1.5;
        let ok = false;
        for (let i = 0; i < seen.length && !ok; i++) if (seen[i] && Math.hypot((i % sc.w) - c.x, ((i / sc.w) | 0) - c.y) <= need) ok = true;
        expect(ok, `${tag}: 구조 대상 ${c.label} (${c.x},${c.y})`).toBe(true);
        if (c.inWater) expect(sc.tiles[c.y * sc.w + c.x]).toBe(T.WATER);
        if (c.inVehicle !== null) expect(sc.props[c.inVehicle].occupants).toContain(c.id);
      }
      // 소품의 모습(skin)마다 그림이 등록돼 있다
      for (const p of sc.props) if (p.skin) expect(MAJOR_SKINS[p.skin], `${tag}: ${p.skin}`).toBeTypeOf('function');
      // 고정 소품은 겹치지 않는다
      const used = new Set<number>();
      for (const p of sc.props) if (p.blocking) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) { const i = y * sc.w + x; expect(used.has(i), `${tag}: 소품이 겹친다 (${x},${y})`).toBe(false); used.add(i); }
    }
  });

  it('일으킨 대형 사고는 끝까지 가고, 사람이 많으면 구급 부대를 더 부른다', () => {
    let extraEms = 0, total = 0, saved = 0;
    for (const m of MAJORS) for (const seed of ['MG', 'MH']) {
      const { sim, I, sc } = spawn(seed, m.type, m.variant);
      sim.runToEnd();
      expect(sim.ended).toBe(true);
      expect(I.phase, `${m.variant} ${seed}`).toBe('closed'); expect(I.result).not.toBeNull();
      expect(I.everAssigned.length, `${m.variant} ${seed}: 출동 부대`).toBeGreaterThanOrEqual(3);
      total += I.result!.casTotal; saved += I.result!.casSaved;
      if (sc.requests.some((q) => q.need === 'ems' && q.reason.indexOf('구급 부대가 더 필요') >= 0)) extraEms++;
    }
    expect(saved / total).toBeGreaterThan(0.6);
    expect(extraEms).toBeGreaterThanOrEqual(2);
  }, 240000);
});

describe('시나리오별 규칙', () => {
  it('다중 추돌: 사건 동안 고속도로 구간이 통제되고, 끝나면 풀린다', () => {
    for (const seed of ['MA', 'MB', 'MC']) {
      const { sim, I, sc } = spawn(seed, 'traffic', 'pileup');
      expect(I.truth.placeId).toBe(-1);
      expect(sim.city.nodes[I.truth.nodeId].edges.some((e) => sim.city.edges[e].cls === 'highway')).toBe(true);
      expect(I.blockedEdge, seed).toBeGreaterThanOrEqual(0);
      const e = sim.city.edges[I.blockedEdge];
      expect(e.cls).toBe('highway'); expect(e.closed).toBe(true); expect(e.closedReason).toBe('incident');
      expect(sim.events.some((ev) => ev.kind === 'traffic' && ev.text.indexOf('전면 통제') >= 0 && ev.text.indexOf('다중 추돌') >= 0)).toBe(true);
      // 평소 교통사고가 느리게 만들던 다른 구간은 되돌려져 있다
      for (const k of sim.city.nodes[I.truth.nodeId].edges) if (k !== e.id) expect(sim.city.edges[k].slow).toBe(0);
      expect(sc.props.filter((p) => p.kind === 'vehicle').length).toBeGreaterThanOrEqual(5);
      expect(sc.props.filter((p) => p.kind === 'vehicle' && p.leakRate).length).toBe(2);
      expect(sc.laneRows.length).toBe(2);      // 옆 차로로는 차가 계속 지나간다
      for (let k = 0; k < 9000 && I.phase !== 'closed'; k++) sim.step();
      expect(I.phase).toBe('closed');
      expect(e.closedReason).not.toBe('incident'); expect(e.slow).toBe(0);
      if (e.closedReason === null) expect(e.closed).toBe(false);
    }
  }, 120000);

  it('열차 탈선: 철길 곁의 교차로에서 일어나고, 객차는 치울 대상이 아니며, 지나가는 차가 없다', () => {
    const { sim, I, sc } = spawn('MA', 'traffic', 'train');
    const n = sim.city.nodes[I.truth.nodeId], rail = sim.city.rail!;
    let d = Infinity;
    for (let i = 0; i < rail.length - 1; i++) {
      const [ax, ay] = rail[i], [bx, by] = rail[i + 1], t = Math.max(0, Math.min(1, ((n.x - ax) * (bx - ax) + (n.y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2)));
      d = Math.min(d, Math.hypot(n.x - (ax + (bx - ax) * t), n.y - (ay + (by - ay) * t)));
    }
    expect(d).toBeLessThan(150);
    const cars = sc.props.filter((p) => p.skin === 'trainCar');
    expect(cars.length).toBeGreaterThanOrEqual(2); expect(cars.length).toBeLessThanOrEqual(3);
    expect(cars.every((p) => p.cleared)).toBe(true);
    expect(cars.filter((p) => p.color === 0).length).toBe(1);      // 선로를 함께 그리는 객차는 하나
    expect(sc.props.filter((p) => p.kind === 'vehicle' && !p.skin).length).toBe(1);      // 건널목에서 받힌 승용차
    expect(sc.laneRows.length).toBe(0); expect(sc.controlPts.length).toBe(0);
    sim.runToEnd();
    expect(sc.board.some((w) => w.kind === 'traffic')).toBe(false);
    expect(sc.board.some((w) => w.kind === 'clearRoad' && sc.props[w.prop].skin === 'trainCar')).toBe(false);
  }, 60000);

  it('선박 화재: 물에 빠진 사람을 부두에서 끌어내고, 바닷가이므로 구조정도 나간다', () => {
    let rescued = 0, inWater = 0, boats = 0, works = 0;
    for (const seed of ['MA', 'MB', 'MC', 'MD']) {
      const { sim, I, sc } = spawn(seed, 'fire', 'ship');
      const swimmers = sc.casualties.filter((c) => c.inWater);
      expect(swimmers.length, seed).toBeGreaterThanOrEqual(2);
      expect(sc.rules).toContain('water');
      expect(sc.props.some((p) => p.kind === 'cover' && p.skin === 'shipHull' && !p.blocking)).toBe(true);
      expect(sc.regions.filter((r) => r.kind === 'room' && r.indoor).length).toBeGreaterThanOrEqual(3);
      expect(sc.fire.some((v) => v > 0)).toBe(true);
      inWater += swimmers.length;
      sim.runToEnd();
      rescued += swimmers.filter((c) => !c.inWater && c.tFreed >= 0).length;
      works += sc.board.filter((w) => w.kind === 'waterRescue' && w.status === 'done').length;
      if (I.everAssigned.some((u) => sim.units[u].sea)) boats++;
    }
    expect(works).toBeGreaterThanOrEqual(4);
    expect(rescued).toBeGreaterThanOrEqual(Math.ceil(inWater * 0.6));
    expect(boats).toBeGreaterThanOrEqual(1);
  }, 120000);

  it('가스 폭발: 붕괴 현장에 불과 새는 배관이 더해지고 가스 규칙이 돈다. 크레인 붕괴: 팔은 치울 수 있는 잔해다', () => {
    for (const seed of ['MA', 'MB', 'MC']) {
      const g = spawn(seed, 'collapse', 'gasblast').sc;
      expect(g.rules).toContain('gas');
      const valves = g.props.filter((p) => p.kind === 'valve');
      expect(valves.length).toBe(1); expect(valves[0].leakRate).toBeGreaterThan(0); expect(valves[0].blocking).toBe(true);
      expect(g.damage.some((v) => v === 1)).toBe(true);
      expect(g.fire.filter((v) => v > 0).length).toBeGreaterThanOrEqual(3);
      expect(g.casualties.filter((c) => c.bystander2).length).toBeGreaterThanOrEqual(2);
      // 불은 사람이 쓰러져 있는 자리 바로 곁에서 시작하지 않는다
      for (let i = 0; i < g.fire.length; i++) if (g.fire[i] > 0) for (const c of g.casualties) expect(Math.hypot((i % g.w) - c.x, ((i / g.w) | 0) - c.y)).toBeGreaterThanOrEqual(2.5);
      const c = spawn(seed, 'collapse', 'crane').sc;
      const boom = c.props.filter((p) => p.skin === 'craneBoom');
      expect(boom.length).toBeGreaterThanOrEqual(6); expect(boom.length).toBeLessThanOrEqual(9);
      expect(boom.every((p) => p.kind === 'debris' && p.blocking && p.hp >= 12)).toBe(true);
      expect(boom.some((p) => c.tiles[p.y * c.w + p.x] === T.ROAD)).toBe(true);      // 끝은 길 위에 걸쳐 있다
      expect(c.props.filter((p) => p.kind === 'unstable').length).toBe(2);
      expect(c.casualties.filter((q) => q.mob === 'trapped').length).toBe(2);
    }
  });

  it('비행기 추락: 동체 세 토막과 불붙은 연료, 새는 가운데 토막. 동체를 살핀 뒤에는 가장자리도 수색한다', () => {
    let vergeSearched = 0;
    for (const seed of ['MA', 'MB', 'MC']) {
      const { sim, sc } = spawn(seed, 'fire', 'plane');
      expect(sc.props.filter((p) => p.kind === 'vehicle').map((p) => p.skin).sort()).toEqual(['fuselageMid', 'fuselageNose', 'fuselageTail']);
      expect(sc.props.find((p) => p.skin === 'fuselageMid')!.leakRate).toBeGreaterThan(0);
      const burning = sc.fire.filter((v) => v > 0).length;
      expect(burning).toBeGreaterThanOrEqual(6); expect(burning).toBeLessThanOrEqual(10);
      expect(sc.regions.filter((r) => r.kind === 'verge').length).toBe(2);
      expect(sc.casualties.filter((c) => c.concealment >= 0.55).length).toBeGreaterThanOrEqual(1);      // 튕겨 나간 사람
      sim.runToEnd();
      if (sc.board.some((w) => w.kind === 'search' && sc.regions[w.region].kind === 'verge' && w.status === 'done')) vergeSearched++;
    }
    expect(vergeSearched).toBeGreaterThanOrEqual(2);
  }, 120000);
});

describe('재현성', () => {
  it('대형 사고를 일으킨 교대도 같은 시드면 같은 기록을 남긴다', () => {
    for (const force of ['fire/plane', 'fire/ship', 'collapse/gasblast']) {
      const a = new Sim('MR1', NORMAL, 1200, { force }); a.runToEnd();
      const b = new Sim('MR1', NORMAL, 1200, { force }); b.runToEnd();
      expect(a.report!.hash, force).toBe(b.report!.hash);
      expect(a.events.length).toBe(b.events.length);
      expect(a.incidents.some((I) => `${I.truth.type}/${I.truth.variant}` === force && I.createdAt < 16)).toBe(true);
      expect(scenarioOf(force.split('/')[0] as IncidentType, force.split('/')[1])!.tag).toBe('major');
    }
  }, 120000);
});
