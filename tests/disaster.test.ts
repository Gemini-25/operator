// 재난 (docs/specs/N6-disaster.md): 다섯 종류의 일정·사건·도로 통제, 재난 없는 교대의 불변, 새 시나리오 셋의 현장
import { describe, expect, it } from 'vitest';
import { findRoute, mountainAt } from '../src/sim/city';
import { NORMAL } from '../src/sim/difficulty';
import type { DisasterKind } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { closeIncident, createIncident } from '../src/sim/incidents';
import { scenarioOf } from '../src/sim/scenarios';
import { addObstacle } from '../src/sim/traffic';
import { T } from '../src/sim/types';
import type { Scene } from '../src/sim/types';

const dz = (seed: string, kind: DisasterKind): Sim => new Sim(seed, { ...NORMAL, disaster: kind });
const MIN: Record<DisasterKind, number> = { typhoon: 8, flood: 5, quake: 9, wildfire: 3, tsunami: 5 };
const MAX: Record<DisasterKind, number> = { typhoon: 16, flood: 12, quake: 16, wildfire: 8, tsunami: 9 };
const KINDS: DisasterKind[] = ['typhoon', 'flood', 'quake', 'wildfire', 'tsunami'];

/** 대기 지점에서 걸어서 닿는 칸 (치울 수 있는 잔해와 문은 지나간다고 본다) */
function reach(s: Scene): Uint8Array {
  const seen = new Uint8Array(s.w * s.h);
  const pass = (i: number): boolean => {
    const t = s.tiles[i];
    if (!(t === T.FLOOR || t === T.DOOR || t === T.GROUND || t === T.ROAD || t === T.TREE || t === T.TRAIL)) return false;
    const p = s.propAt[i] >= 0 ? s.props[s.propAt[i]] : null;
    return !p || p.kind === 'door' || p.kind === 'debris';
  };
  const st = [s.staging.y * s.w + s.staging.x]; seen[st[0]] = 1;
  while (st.length) {
    const c = st.pop()!, x = c % s.w, y = (c / s.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) continue; const j = ny * s.w + nx; if (!seen[j] && pass(j)) { seen[j] = 1; st.push(j); } }
  }
  return seen;
}
/** 그 사람 곁(자기 칸이나 이웃 칸)까지 걸어서 닿는가 */
function reachable(s: Scene, seen: Uint8Array, x: number, y: number): boolean {
  for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) if (xx >= 0 && yy >= 0 && xx < s.w && yy < s.h && seen[yy * s.w + xx]) return true;
  return false;
}

describe('재난: 다섯 종류', () => {
  for (const kind of KINDS) {
    it(`${kind}: 두 교대가 예외 없이 끝나고, 사건 수가 범위 안이며, 통제와 혼잡이 모두 풀린다`, () => {
      for (const seed of ['DZ-1', 'DZ-2']) {
        const s = dz(seed, kind);
        s.runToEnd();
        const d = s.disaster!;
        expect(s.report, `${kind} ${seed}`).not.toBeNull();
        for (const I of s.incidents) { expect(I.phase).toBe('closed'); expect(I.result).not.toBeNull(); }
        expect(d.spawned.length, `${kind} ${seed} 사건 수`).toBeGreaterThanOrEqual(MIN[kind]);
        expect(d.spawned.length, `${kind} ${seed} 사건 수`).toBeLessThanOrEqual(MAX[kind]);
        for (const id of d.spawned) expect(s.incidents[id].tag).toBe('disaster:' + kind);
        expect(d.phase).toBe('over');
        expect(d.closedEdges.length).toBe(0);
        for (const e of s.city.edges) {
          expect(e.closedReason === 'disaster', `${kind} ${seed} ${e.name} 통제가 남았다`).toBe(false);
          expect(e.bump ?? 0, `${kind} ${seed} ${e.name} 혼잡이 남았다`).toBe(0);
          expect(e.slow, `${kind} ${seed} ${e.name} 감속이 남았다`).toBeLessThan(0.01);
        }
        // 보고서: 실제로 일어난 일만
        const rep = s.report!.disaster!;
        expect(rep.name).toBe(d.name);
        expect(rep.lines[0]).toContain(`재난 사건 ${d.spawned.length}건`);
        if (d.closedTotal) expect(rep.lines[0]).toContain(`도로 ${d.closedTotal}구간 통제`);
      }
    }, 60000);
  }

  it('재현성: 같은 시드·같은 재난은 같은 기록을 만든다', () => {
    for (const kind of ['quake', 'tsunami'] as DisasterKind[]) {
      const a = dz('DZ-R', kind), b = dz('DZ-R', kind);
      a.runToEnd(); b.runToEnd();
      expect(a.report!.hash).toBe(b.report!.hash);
      expect(a.disaster!.spawned).toEqual(b.disaster!.spawned);
    }
  }, 60000);

  it('재난 없음: 선택하지 않은 교대와 한 글자도 다르지 않고, 무작위는 심각도에 따라 드물게 일어난다', () => {
    const a = new Sim('DZ-N'), b = new Sim('DZ-N', { ...NORMAL, disaster: 'none' });
    a.runToEnd(); b.runToEnd();
    expect(b.disaster).toBeNull();
    expect(b.report!.hash).toBe(a.report!.hash);
    expect(b.report!.disaster).toBeUndefined();
    let n = 0;
    const kinds = new Set<string>();
    for (let k = 0; k < 20; k++) { const d = new Sim('DZ-RAND' + k, { ...NORMAL, severity: 5, disaster: 'random' }).disaster; if (d) { n++; kinds.add(d.kind); } }
    expect(n).toBeGreaterThanOrEqual(3); expect(n).toBeLessThanOrEqual(10);
    expect(kinds.size).toBeGreaterThanOrEqual(2);
  }, 60000);

  it('교대가 재난 도중에 끝나도 통제가 남지 않는다 (짧은 교대)', () => {
    for (const kind of ['flood', 'typhoon', 'wildfire'] as DisasterKind[]) {
      const s = new Sim('DZ-CUT', { ...NORMAL, disaster: kind }, 420);
      s.runToEnd();
      expect(s.report).not.toBeNull();
      for (const e of s.city.edges) { expect(e.closedReason === 'disaster').toBe(false); expect(e.bump ?? 0).toBe(0); expect(e.slow).toBeLessThan(0.01); }
      expect(s.disaster!.speedMul).toBeUndefined();
    }
  }, 60000);
});

describe('재난: 종류별 규칙', () => {
  it('태풍: 특보 뒤 주행이 느려지고, 가장 셀 때 정전으로 모든 구간이 밀렸다가 돌아온다', () => {
    const s = dz('DZ-T', 'typhoon'), d = s.disaster!;
    expect(d.tWarn).toBeGreaterThanOrEqual(120); expect(d.tImpact - d.tWarn).toBeGreaterThanOrEqual(90); expect(d.tEnd - d.tImpact).toBe(420);
    while (s.t < d.tWarn + 2) s.step();
    expect(d.phase).toBe('warning'); expect(d.speedMul).toBeLessThan(1);
    while (s.t < d.tImpact + 160) s.step();
    expect(d.phase).toBe('impact'); expect(d.dark).toBe(true);
    for (const e of s.city.edges) expect(e.bump).toBeCloseTo(0.4, 6);
    while (s.t < d.tImpact + 280) s.step();
    expect(d.dark).toBe(false);
    for (const e of s.city.edges) expect(e.bump ?? 0).toBe(0);
    expect(d.intensity).toBeGreaterThan(0.4);
    s.runToEnd();
    const kinds = new Set(d.spawned.map((id) => `${s.incidents[id].truth.type}/${s.incidents[id].truth.variant}`));
    expect(kinds.has('traffic/tree')).toBe(true);
    expect(kinds.size).toBeGreaterThanOrEqual(3);
  }, 60000);

  it('홍수: 수위가 오르면 강가의 길부터 잠기고, 가장 높을 때에도 강 양쪽이 이어져 있으며, 물이 빠지면 열린다', () => {
    const s = dz('DZ-F', 'flood'), d = s.disaster!;
    while (s.t < d.tImpact + 150) s.step();
    const half = s.city.edges.filter((e) => e.closedReason === 'disaster').length;
    while (s.t < d.tImpact + 330) s.step();
    expect(d.level).toBeCloseTo(1, 5);
    const flooded = s.city.edges.filter((e) => e.closedReason === 'disaster');
    expect(flooded.length).toBeGreaterThan(half);
    expect(flooded.length).toBeGreaterThanOrEqual(5);
    expect(flooded.some((e) => e.bridge)).toBe(true);
    expect(s.city.edges.some((e) => e.bridge && !e.closed)).toBe(true);      // 다리가 모두 닫히지는 않는다
    for (const e of flooded) expect(d.thr![e.id]).toBeLessThanOrEqual(1);
    expect(d.slowed!.length).toBeGreaterThan(flooded.length);
    const fs = s.city.facilities;
    for (const a of fs) for (const b of fs) if (a.id < b.id) expect(findRoute(s.city, a.nodeId, b.nodeId), `${a.name} → ${b.name}`).not.toBeNull();
    for (const n of s.city.nodes) expect(findRoute(s.city, fs[0].nodeId, n.id), `교차로 ${n.id}`).not.toBeNull();
    s.runToEnd();
    expect(s.city.edges.filter((e) => e.closedReason === 'disaster').length).toBe(0);
    expect(d.closedTotal).toBeGreaterThanOrEqual(flooded.length);
  }, 60000);

  it('지진: 충격 뒤 30초 안에 사건이 8건 이상 열리고, 도로가 갈라지고, 지원이 늘고, 여진이 온다', () => {
    const s = dz('DZ-Q', 'quake'), d = s.disaster!;
    const aid0 = s.tune.aidUnits;
    expect(d.tWarn).toBe(d.tImpact);
    while (s.t < d.tImpact + 30) s.step();
    expect(s.incidents.filter((I) => I.phase !== 'closed').length).toBeGreaterThanOrEqual(8);
    expect(d.spawned.length).toBeGreaterThanOrEqual(5);
    expect(d.epi).toBeDefined();
    expect(s.tune.aidUnits).toBe(aid0 + 3);
    const cut = s.city.edges.filter((e) => e.closedReason === 'disaster');
    expect(cut.length).toBeGreaterThanOrEqual(3); expect(cut.length).toBeLessThanOrEqual(5);
    expect(cut.some((e) => e.bridge)).toBe(false);
    while (s.t < d.tImpact + 210) s.step();
    expect(d.shakes!.length).toBe(2);      // 본진과 여진
    s.runToEnd();
    const types = new Set(d.spawned.map((id) => s.incidents[id].truth.type));
    expect(types.has('collapse')).toBe(true); expect(types.has('fire')).toBe(true);
  }, 60000);

  it('산불: 불머리가 동네 쪽으로 나아가며 탄 자리가 자라고, 산불 현장이 열리고, 닿거나 막아 내면 멈춘다', () => {
    const s = dz('DZ-W', 'wildfire'), d = s.disaster!;
    const x0 = d.front!.x, y0 = d.front!.y, gap0 = Math.hypot(d.to!.x - x0, d.to!.y - y0);
    while (s.t < d.tImpact + 5) s.step();
    const scar0 = d.scar!.length;
    expect(d.spawned.length).toBe(1);
    expect(s.incidents[d.spawned[0]].truth.variant).toBe('wild');
    while (s.t < d.tImpact + 90 && !d.stopped) s.step();
    expect(d.scar!.length).toBeGreaterThan(scar0);
    expect(Math.hypot(d.to!.x - d.front!.x, d.to!.y - d.front!.y)).toBeLessThan(gap0);
    expect(d.front!.r).toBeGreaterThan(60);
    s.runToEnd();
    expect(['reached', 'contained', 'calm']).toContain(d.stopped);
    if (d.stopped === 'reached') expect(d.spawned.filter((id) => s.incidents[id].truth.variant === 'std').length).toBeGreaterThanOrEqual(1);
  }, 60000);

  it('해일: 경보와 함께 대피 현장이 열리고, 닿기 전에 끝낸 현장에는 물에 빠진 사람이 없다', () => {
    for (const seed of ['DZ-S1', 'DZ-S2', 'DZ-S3']) {
      const s = dz(seed, 'tsunami'), d = s.disaster!;
      while (s.t < d.tWarn + 12) s.step();
      const evac = s.incidents.filter((I) => I.truth.variant === 'evac');
      expect(evac.length).toBeGreaterThanOrEqual(2); expect(evac.length).toBeLessThanOrEqual(3);
      expect(new Set(evac.map((I) => I.truth.placeId)).size).toBe(evac.length);      // 서로 다른 곳
      while (s.t < d.tImpact + 2) s.step();
      for (const I of evac) {
        const sc = s.scenes[I.id]!;
        const before = I.phase === 'closed' && I.closedAt < d.tImpact;
        expect(d.hit!.indexOf(I.id) >= 0).toBe(!before);
        if (before) { expect(sc.casualties.every((c) => !c.inWater)).toBe(true); expect(sc.tiles[10 * sc.w + 5]).toBe(T.TRAIL); }
        else expect(sc.tiles[10 * sc.w + 5]).toBe(T.WATER);
      }
      const cut = s.city.edges.filter((e) => e.closedReason === 'disaster').length;
      expect(cut).toBeGreaterThanOrEqual(1);
      s.runToEnd();
      expect(d.spawned.filter((id) => s.incidents[id].truth.type === 'water' && s.incidents[id].truth.variant === 'std').length).toBeGreaterThanOrEqual(2);
    }
  }, 60000);

  it('해일이 닿을 때까지 남아 있던 사람은 물에 휩쓸리고, 물가에서 끌어내야 한다', () => {
    let pulled = 0, swept = 0;
    for (const seed of ['DZ-H1', 'DZ-H2']) {
      const s = dz(seed, 'tsunami'), d = s.disaster!;
      while (s.t < d.tWarn + 8) s.step();
      const evac = s.incidents.filter((I) => I.truth.variant === 'evac');
      expect(evac.length).toBeGreaterThanOrEqual(2);
      // 부대가 닿기 전에 해일이 온 것으로 만든다 (일정만 당긴다)
      d.tImpact = s.t + 1; d.tEnd = d.tImpact + 90;
      s.run(15);
      expect(d.phase).toBe('impact');
      for (const I of evac) {
        const sc = s.scenes[I.id]!;
        expect(d.hit).toContain(I.id);
        const inW = sc.casualties.filter((c) => c.inWater);
        expect(inW.length).toBeGreaterThanOrEqual(4);      // 모래밭과 부두에 있던 사람들
        for (const c of inW) { expect(c.mob).toBe('trapped'); expect(sc.tiles[Math.round(c.y) * sc.w + Math.round(c.x)]).toBe(T.WATER); expect(c.drift).toBeGreaterThan(0); }
        for (let x = 0; x < sc.w; x++) { expect(sc.tiles[8 * sc.w + x]).not.toBe(T.WATER); expect(sc.tiles[9 * sc.w + x]).toBe(T.WATER); }
        expect(I.problems.some((p) => p.code === 'ESCALATION' && p.detail === '해일이 덮침')).toBe(true);
        swept += inW.length;
      }
      expect(d.swept).toBe(evac.reduce((n, I) => n + s.scenes[I.id]!.casualties.filter((c) => c.inWater).length, 0));
      s.runToEnd();
      for (const I of evac) { expect(I.phase).toBe('closed'); for (const c of s.scenes[I.id]!.casualties) if (!c.dead && c.tFreed >= 0) pulled++; }
      expect(s.report!.disaster!.lines.some((l) => l.includes('물에 휩쓸렸습니다'))).toBe(true);
    }
    expect(swept).toBeGreaterThanOrEqual(16);
    expect(pulled).toBeGreaterThanOrEqual(2);      // 일부는 물가에서 끌어낸다
  }, 60000);
});

/** 실제 상태(아직 아무도 모르는 통제까지 막힌 것으로)에서 첫 시설의 교차로에서 닿지 못하는 교차로 수 */
function cutOff(s: Sim): number {
  const c = s.city, seen = new Uint8Array(c.nodes.length), st = [c.facilities[0].nodeId];
  seen[st[0]] = 1; let n = 1;
  while (st.length) { const v = st.pop()!; for (const id of c.nodes[v].edges) { const e = c.edges[id]; if (e.closed) continue; const w = e.a === v ? e.b : e.a; if (!seen[w]) { seen[w] = 1; n++; st.push(w); } } }
  return c.nodes.length - n;
}

describe('재난과 교통이 맞물리는 자리', () => {
  it('홍수: 아직 아무도 모르는 낙하물이 놓인 다리를 돌아갈 길로 믿고 나머지 다리를 모두 닫지 않는다', () => {
    // 경로 계산(findRoute)은 모르는 낙하물을 지나갈 수 있는 길로 본다. 재난은 세계이므로 실제 상태로 우회로를 확인해야 한다
    // (고치기 전: 다른 다리가 모두 잠겨 강 건너편이 통째로 끊겼고, 교통의 '하나 남은 길' 규칙이 1초 안에 낙하물을 치워서야 이어졌다)
    const s = dz('DZ-X1', 'flood'), d = s.disaster!;
    s.traffic.nextEvent = Infinity; s.gen.nextAt = Infinity; s.gen.majorAt = Infinity;      // 낙하물은 직접 놓고, 다른 사건은 일으키지 않는다
    while (s.t < d.tImpact + 200) { s.step(); d.nextAt = Infinity; }
    expect(d.level).toBeGreaterThan(0.5); expect(d.level).toBeLessThan(0.9);      // 다리는 아직 잠기지 않았다
    const bridges = s.city.edges.filter((e) => e.bridge);
    expect(bridges.every((e) => !e.closed)).toBe(true);
    let ob = null as ReturnType<typeof addObstacle>;
    for (const b of bridges) { ob = addObstacle(s, { edge: b.id, kind: 'debris', full: true, dur: 380, known: false }); if (ob) break; }
    expect(ob).not.toBeNull();
    const blocked = s.city.edges[ob!.edge];
    let worst = 0, minOpen = bridges.length;
    while (s.t < d.tImpact + 400) {
      s.step(); d.nextAt = Infinity;
      worst = Math.max(worst, cutOff(s));
      minOpen = Math.min(minOpen, bridges.filter((e) => !e.closed).length);
    }
    expect(d.level).toBeCloseTo(1, 5);
    expect(worst).toBe(0);      // 어느 틱에도 끊기지 않았다
    expect(minOpen).toBeGreaterThanOrEqual(1);      // 실제로 건널 수 있는 다리가 하나는 남아 있었다
    expect(bridges.filter((e) => e.closedReason === 'disaster').length).toBeGreaterThanOrEqual(2);      // 그래도 다른 다리들은 잠겼다
    expect(blocked.closedReason).toBe('obstacle'); expect(s.traffic.obstacles.indexOf(ob!)).toBeGreaterThanOrEqual(0);      // 낙하물은 그대로 있다
    expect(s.events.some((ev) => ev.text.includes('하나 남은 길'))).toBe(false);      // 서둘러 치울 일이 없었다
  }, 60000);

  it('산사태: 돌아갈 길에 아직 아무도 모르는 낙하물이 있으면 그 구간을 덮지 않는다. 사건이 어떻게 끝나든 덮었던 구간은 열린다', () => {
    const probe = new Sim('DZ-X2');
    // 산자락 교차로 가운데, 막아도 돌아갈 길이 있는 곳
    const hill = probe.city.nodes.filter((n) => mountainAt(n.x, n.y) > 0.12);
    const pick = (s: Sim): { node: number; edge: number; via: number[] } | null => {
      for (const n of hill) for (const id of n.edges) { const e = s.city.edges[id]; if (e.cls === 'highway') continue; const r = findRoute(s.city, e.a, e.b, 1, e.id); if (r) return { node: n.id, edge: id, via: r.edges }; }
      return null;
    };
    const spot = pick(probe)!;
    expect(spot).not.toBeNull();
    // 1) 평소: 그 구간을 덮고, 사건이 한계 시간·방치·무대응·교대 끝 어느 쪽으로 끝나도 다시 열린다
    for (const reason of ['timeout', 'abandoned', 'noresponse', 'shiftend'] as const) {
      const s = new Sim('DZ-X2');
      const I = createIncident(s, { type: 'collapse', variant: 'landslide', nodeId: spot.node, rng: s.rng.fork('x') });
      expect(I.blockedEdge).toBeGreaterThanOrEqual(0);
      const e = s.city.edges[I.blockedEdge];
      expect(e.closed).toBe(true); expect(e.closedReason).toBe('incident'); expect(e.slow).toBeGreaterThan(1);
      closeIncident(s, I, reason);
      expect(e.closed, reason).toBe(false); expect(e.closedReason).toBeNull(); expect(e.slow).toBeLessThan(0.01);
      expect(cutOff(s)).toBe(0);
    }
    // 2) 돌아갈 길 한가운데에 모르는 낙하물이 있다: 덮으면 그 동네가 끊기므로 덮지 않는다
    const s = new Sim('DZ-X2');
    s.traffic.nextEvent = Infinity;
    let placed = 0;
    for (const id of spot.via) {
      const ob = addObstacle(s, { edge: id, kind: 'debris', full: true, dur: 600, known: false });
      if (!ob) continue;
      placed++;
      const before = s.city.edges.filter((e) => e.closedReason === 'incident').length;
      const I = createIncident(s, { type: 'collapse', variant: 'landslide', nodeId: spot.node, rng: s.rng.fork('y' + id) });
      expect(cutOff(s), `낙하물 ${id}`).toBe(0);
      if (I.blockedEdge >= 0) expect(s.city.edges[I.blockedEdge].closed).toBe(true);
      else expect(s.city.edges.filter((e) => e.closedReason === 'incident').length).toBe(before);
      closeIncident(s, I, 'resolved');
      // 낙하물을 치우고 다음 자리로
      const e = s.city.edges[id]; e.closed = false; e.closedReason = null; e.known = undefined; s.traffic.obstacles.splice(s.traffic.obstacles.indexOf(ob), 1);
    }
    expect(placed).toBeGreaterThanOrEqual(1);
  }, 60000);
});

describe('재난에 딸린 시나리오', () => {
  it('세 시나리오는 평소에 추첨되지 않고, 정해서 일으키면 끝까지 간다', () => {
    for (const [t, v] of [['fire', 'wild'], ['collapse', 'landslide'], ['water', 'evac']] as const) {
      const sc = scenarioOf(t, v)!;
      expect(sc.tag).toBe('disaster'); expect(sc.share).toBe(0);
      const s = new Sim('DZ-FORCE', NORMAL, 1200, { force: `${t}/${v}` });
      s.runToEnd();
      const I = s.incidents.find((q) => q.truth.type === t && q.truth.variant === v)!;
      expect(I, `${t}/${v}`).toBeDefined();
      expect(I.phase).toBe('closed');
      expect(s.incidents.filter((q) => q.truth.variant === v).length).toBe(1);
    }
  }, 60000);

  it('산불 현장: 숲 다섯 구역과 오두막, 가장자리의 불, 불에서 떨어진 사람들 — 모두 걸어서 닿는다', () => {
    const s = new Sim('DZ-SC1');
    const places = s.city.places.filter((q) => q.facility < 0 && (q.kind === 'pension' || q.kind === 'forest' || q.kind === 'farmhouse'));
    for (let k = 0; k < 24; k++) {
      const I = createIncident(s, { type: 'fire', variant: 'wild', placeId: places[(k * 7) % places.length].id, rng: s.rng.fork('w' + k) });
      const sc = s.scenes[I.id]!;
      const rooms = sc.regions.filter((r) => r.kind === 'room'), zones = sc.regions.filter((r) => r.kind === 'zone' && r.searchable);
      expect(rooms.length).toBeGreaterThanOrEqual(2); expect(rooms.length).toBeLessThanOrEqual(3);
      expect(zones.length).toBe(5);
      for (const z of zones) expect(z.tiles.length).toBeGreaterThan(10);
      let fire = 0, trees = 0, fuelTrees = 0;
      for (let i = 0; i < sc.tiles.length; i++) { if (sc.fire[i] > 0) { fire++; expect(sc.region[i]).toBeGreaterThanOrEqual(0); expect(sc.regions[sc.region[i]].kind).toBe('zone'); } if (sc.tiles[i] === T.TREE) { trees++; if (sc.fuel[i] > 0) fuelTrees++; } }
      expect(fire).toBeGreaterThanOrEqual(3);
      expect(trees).toBeGreaterThan(30); expect(fuelTrees / trees).toBeGreaterThan(0.7);
      expect(sc.totalFuelTiles).toBeGreaterThan(120);
      expect(sc.casualties.length).toBeGreaterThanOrEqual(2); expect(sc.casualties.length).toBeLessThanOrEqual(4);
      const seen = reach(sc);
      for (const c of sc.casualties) {
        expect(reachable(sc, seen, c.x, c.y), `산불 ${k} 구조 대상 ${c.label}`).toBe(true);
        for (let i = 0; i < sc.fire.length; i++) if (sc.fire[i] > 0) expect(Math.hypot((i % sc.w) - c.x, ((i / sc.w) | 0) - c.y)).toBeGreaterThan(5);
      }
      for (const r of rooms) expect(r.tiles.some((i) => seen[i])).toBe(true);
      expect(sc.fire[sc.staging.y * sc.w + sc.staging.x]).toBe(0);
      expect(sc.fuel[sc.safe.y * sc.w + sc.safe.x]).toBe(0);
    }
  }, 60000);

  it('산불 현장의 불은 바람을 타고 번진다 (아무도 끄지 않으면 숲이 탄다)', () => {
    const s = new Sim('DZ-SC2');
    const q = s.city.places.find((p) => p.kind === 'forest')!;
    const I = createIncident(s, { type: 'fire', variant: 'wild', placeId: q.id, rng: s.rng.fork('w') });
    const sc = s.scenes[I.id]!;
    I.firstCallAt = Infinity;      // 신고가 들어오지 않게 둔다
    const count = (): number => { let n = 0; for (let i = 0; i < sc.fire.length; i++) if (sc.fire[i] > 0.05 || sc.burned[i]) n++; return n; };
    const n0 = count();
    s.run(5 * 150);
    expect(count()).toBeGreaterThan(n0 + 25);
  }, 60000);

  it('산사태: 길을 덮은 흙더미 밑에 차가 묻혀 있고, 파내면 닿는다. 우회로가 있으면 그 구간이 막혔다가 끝나면 열린다', () => {
    const s = new Sim('DZ-SC3');
    let blocked = 0;
    for (let k = 0; k < 16; k++) {
      const I = createIncident(s, { type: 'collapse', variant: 'landslide', rng: s.rng.fork('l' + k) });
      const sc = s.scenes[I.id]!;
      expect(I.truth.placeId).toBe(-1);
      expect(I.truth.label).toContain('산사태');
      const mud = sc.props.filter((p) => p.kind === 'debris' && p.skin === 'mud'), cars = sc.props.filter((p) => p.kind === 'vehicle');
      expect(mud.length).toBeGreaterThanOrEqual(8);
      expect(cars.length).toBeGreaterThanOrEqual(1); expect(cars.length).toBeLessThanOrEqual(2);
      for (const p of mud) expect(p.blocking).toBe(true);
      for (const car of cars) {
        expect(car.occupants!.length).toBeGreaterThanOrEqual(1);
        // 차는 흙더미에 둘러싸여 있다
        for (let y = car.y - 1; y <= car.y + 1; y++) for (let x = car.x - 1; x <= car.x + car.w; x++) expect(sc.propAt[y * sc.w + x]).toBeGreaterThanOrEqual(0);
      }
      const seen = reach(sc);
      for (const c of sc.casualties) expect(reachable(sc, seen, Math.round(c.x), Math.round(c.y)), `산사태 ${k} 구조 대상 ${c.label}`).toBe(true);
      expect(sc.laneRows.length).toBe(0);
      if (I.blockedEdge >= 0) { blocked++; expect(s.city.edges[I.blockedEdge].closed).toBe(true); expect(s.city.edges[I.blockedEdge].closedReason).toBe('incident'); }
    }
    s.runToEnd();
    for (const I of s.incidents) if (I.blockedEdge >= 0) expect(s.city.edges[I.blockedEdge].closedReason === 'incident').toBe(false);
    expect(blocked).toBeGreaterThanOrEqual(1);      // 산자락의 교차로 가운데 우회로가 있는 곳이 있다
  }, 60000);

  it('해안 대피: 모두 뭍(모래밭과 부두)에 있고, 못 걷는 사람이 섞여 있으며, 닿을 수 있다', () => {
    const s = new Sim('DZ-SC4');
    const places = s.city.places.filter((q) => q.kind === 'beach' || q.kind === 'pier' || q.kind === 'fishMarket' || q.kind === 'ferry');
    expect(places.length).toBeGreaterThanOrEqual(3);
    for (let k = 0; k < 16; k++) {
      const I = createIncident(s, { type: 'water', variant: 'evac', placeId: places[k % places.length].id, rng: s.rng.fork('e' + k) });
      const sc = s.scenes[I.id]!;
      expect(sc.casualties.length).toBeGreaterThanOrEqual(5); expect(sc.casualties.length).toBeLessThanOrEqual(10);
      expect(sc.casualties.some((c) => c.mob === 'immobile')).toBe(true);
      expect(sc.casualties.filter((c) => c.mob === 'mobile').length).toBeGreaterThanOrEqual(4);
      const seen = reach(sc);
      for (const c of sc.casualties) { expect(c.inWater).toBeFalsy(); expect(sc.tiles[c.y * sc.w + c.x]).toBe(T.TRAIL); expect(seen[c.y * sc.w + c.x]).toBe(1); }
      for (let x = 0; x < sc.w; x++) expect(sc.tiles[19 * sc.w + x]).toBe(T.WATER);
      expect(seen[sc.safe.y * sc.w + sc.safe.x]).toBe(1);
      expect(sc.regions.filter((r) => r.searchable).length).toBe(2);
    }
  }, 60000);
});
