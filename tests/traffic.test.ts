// 교통 (docs/specs/T1-traffic.md): 손잡이, 가 보아야 아는 장애물, 불법 주차, 건널목, 뒤로 밀림, 끊기지 않는 도시, 정보 격리
import { readFileSync, readdirSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { findRoute, weatherSpeedFactor } from '../src/sim/city';
import { NORMAL, difficultyKey, difficultyLabel, overallLevel, parseDifficulty, presetOf, tuningOf, validDifficulty } from '../src/sim/difficulty';
import type { Difficulty } from '../src/sim/difficulty';
import { Sim } from '../src/sim/engine';
import { sendUnitTo, tickUnits } from '../src/sim/resources';
import { addObstacle, obstacleAhead, passable, tickTraffic, timeOfDay } from '../src/sim/traffic';
import type { RoadEdge, Unit } from '../src/sim/types';

const QUIET: Difficulty = { ...NORMAL, traffic: 1 };      // 불법 주차가 없는 조건 (장애물을 직접 놓아 보는 시험용)

/** 사건·관제 없이 교통과 부대의 이동만 굴린다 (무작위 교통 사건과 열차는 끈다) */
function bare(seed: string, d: Difficulty = QUIET): Sim {
  const s = new Sim(seed, d);
  s.traffic.nextEvent = Infinity; s.traffic.nextTrainAt = Infinity;
  return s;
}
function tick(s: Sim, n = 1, each?: () => void): void {
  for (let i = 0; i < n; i++) { s.tick++; s.t = s.tick * s.dt; tickTraffic(s); tickUnits(s); if (each) each(); }
}
/** 부대를 그 교차로에 세워 두고 목적지로 보낸다 (사건 없이 — 닿으면 대기 상태가 된다) */
function drive(s: Sim, u: Unit, from: number, to: number): void {
  const n = s.city.nodes[from];
  u.nodeId = from; u.x = u.px = n.x; u.y = u.py = n.y; u.route = null; u.seg = 0; u.segT = 0; u.pendingDest = null; u.curb = null; u.incidentId = null; u.backing = false;
  u.state = 'returning';
  sendUnitTo(s, u, to);
}
/** 그 구간 위에서 a→b 방향으로 본 부대의 위치 (그 구간을 달리는 중이 아니면 null) */
function posOn(s: Sim, u: Unit, e: RoadEdge): number | null {
  if (!u.route || u.seg >= u.route.edges.length || u.route.edges[u.seg] !== e.id) return null;
  return u.route.nodes[u.seg] === e.a ? u.segT : 1 - u.segT;
}

describe('교통 손잡이', () => {
  it('같은 시드 + 같은 조건 = 같은 결과 (교통 손잡이를 포함해)', () => {
    // (교대 길이를 줄여 돌린다 — 재현성은 길이와 무관하다)
    const hashes: string[] = [];
    for (const d of [NORMAL, { ...NORMAL, traffic: 5 }]) {
      const a = new Sim('TR-REP', d, 500), b = new Sim('TR-REP', d, 500);
      a.runToEnd(); b.runToEnd();
      expect(a.report!.hash).toBe(b.report!.hash);
      expect(a.report!.traffic).toEqual(b.report!.traffic);
      hashes.push(a.report!.hash);
    }
    expect(hashes[0]).not.toBe(hashes[1]);      // 손잡이가 결과를 바꾼다
    // 교통 3 은 손잡이가 없는 것과 같다
    const y = new Sim('TR-REP', { ...NORMAL, traffic: 3 }, 500);
    y.runToEnd();
    expect(y.report!.hash).toBe(hashes[0]);
  });
  it('일곱째 숫자가 교통이다. 3 이면 예전의 키·프리셋·종합 난도가 그대로다', () => {
    expect(parseDifficulty('3,3,3,3,3,3,5')!.traffic).toBe(5);
    expect(parseDifficulty('3,3,3,3,3,3')!.traffic).toBeUndefined();
    expect('traffic' in parseDifficulty('4,4,4,2,3')!).toBe(false);
    expect(parseDifficulty('3,3,3,3,3,3,6')).toBeNull(); expect(parseDifficulty('3,3,3,3,3,3,3,3')).toBeNull();
    expect(difficultyKey(NORMAL)).toBe('3-3-3-3-3-3'); expect(difficultyKey({ ...NORMAL, traffic: 3 })).toBe('3-3-3-3-3-3'); expect(difficultyKey({ ...NORMAL, traffic: 4 })).toBe('3-3-3-3-3-3-t4');
    expect(presetOf({ ...NORMAL, traffic: 3 })).toBe('normal'); expect(presetOf({ ...NORMAL, traffic: 5 })).toBeNull();
    expect(difficultyLabel({ ...NORMAL, traffic: 5 })).toBe('사용자 설정 3-3-3-3-3-3-t5');
    expect(validDifficulty({ ...NORMAL, traffic: 5 })).toBe(true); expect(validDifficulty({ ...NORMAL, traffic: 0 })).toBe(false);
    expect(overallLevel({ ...NORMAL, traffic: 3 })).toBe(overallLevel(NORMAL)); expect(overallLevel({ ...NORMAL, traffic: 5 })).toBeGreaterThan(overallLevel(NORMAL));
    const t1 = tuningOf({ ...NORMAL, traffic: 1 }), t3 = tuningOf(NORMAL), t5 = tuningOf({ ...NORMAL, traffic: 5 });
    expect(t3.trafficMul).toBe(1); expect(t3.trafficGap).toBe(1); expect(t3.parkedCount).toBe(3);
    expect(t1.trafficMul).toBeLessThan(1); expect(t5.trafficMul).toBeGreaterThan(1); expect(t5.trafficGap).toBeLessThan(t1.trafficGap); expect(t1.parkedCount).toBe(0);
  });
  it('시간대: 출퇴근 시간에 밀리고 밤에는 한산하다', () => {
    expect(timeOfDay(8 * 3600).tod).toBeCloseTo(1.32, 2); expect(timeOfDay(18 * 3600).name).toBe('퇴근 시간대'); expect(timeOfDay(8.5 * 3600).name).toBe('출근 시간대');
    expect(timeOfDay(13 * 3600).tod).toBeCloseTo(0.82, 2); expect(timeOfDay(13 * 3600).name).toBe('평시');
    expect(timeOfDay(23 * 3600).tod).toBe(0.7); expect(timeOfDay(3 * 3600).name).toBe('심야');
    // 한산한 밤에는 평균 혼잡이 낮보다 낮다 (교대의 시각은 날씨와 함께 시드로 정해진다)
    let night = 0, nn = 0, day = 0, dn = 0;
    for (let k = 0; k < 30; k++) { const s = new Sim('TOD' + k); let c = 0; for (const e of s.city.edges) c += e.cong; c /= s.city.edges.length; if (s.traffic.todName === '심야') { night += c; nn++; } else { day += c; dn++; } }
    expect(nn).toBeGreaterThan(0); expect(dn).toBeGreaterThan(0);
    expect(night / nn).toBeLessThan(day / dn);
  });
});

describe('가 보아야 아는 장애물', () => {
  it('모르는 낙하물: 경로는 그 구간을 지나고, 부대는 그 앞에서 멈춰 알린 뒤 되돌아 다른 길로 도착한다', () => {
    const s = bare('TR-OBS');
    const u = s.units.find((q) => q.kind === 'patrol')!, wf = weatherSpeedFactor(s);
    // 먼 교차로까지의 경로 한가운데에 낙하물을 놓는다
    let dest = -1, far = 0;
    for (const n of s.city.nodes) { const r = findRoute(s.city, u.homeNode, n.id, wf); if (r && r.edges.length > far && r.edges.length <= 12) { far = r.edges.length; dest = n.id; } }
    const r0 = findRoute(s.city, u.homeNode, dest, wf)!;
    expect(r0.edges.length).toBeGreaterThanOrEqual(5);
    let ob = null as ReturnType<typeof addObstacle>, e!: RoadEdge;
    for (let k = 2; k < r0.edges.length - 1 && !ob; k++) { e = s.city.edges[r0.edges[k]]; if (e.gateT !== undefined) continue; ob = addObstacle(s, { edge: e.id, t: 0.5, kind: 'debris', full: true, dur: 5000, known: false }); }
    expect(ob).not.toBeNull();
    expect(e.closed).toBe(true); expect(e.known).toBe(false); expect(e.closedReason).toBe('obstacle');
    // 아직 모른다: 경로 계산은 그 구간을 그대로 지난다
    expect(passable(e, false, s)).toBe(true);
    expect(findRoute(s.city, u.homeNode, dest, wf)!.edges).toEqual(r0.edges);
    drive(s, u, u.homeNode, dest);
    expect(u.route!.edges).toContain(e.id);
    const from = r0.nodes[r0.edges.indexOf(e.id)], at = from === e.a ? ob!.t : 1 - ob!.t;      // 들어가는 방향으로 본 낙하물의 위치
    let backed = false, maxPos = 0, knownAt = -1;
    tick(s, 4000, () => {
      if (u.backing) backed = true;
      if (ob!.known && knownAt < 0) knownAt = s.t;
      if (u.route && u.seg < u.route.edges.length && u.route.edges[u.seg] === e.id && u.route.nodes[u.seg] === from) maxPos = Math.max(maxPos, u.segT);
    });
    expect(maxPos).toBeGreaterThan(at - 10 / e.len - 0.01); expect(maxPos).toBeLessThan(at);      // 그 앞까지 갔지만 넘지 못했다
    expect(backed).toBe(true);
    expect(ob!.known).toBe(true); expect(e.known).toBe(true); expect(knownAt).toBeGreaterThan(0);
    expect(u.state).toBe('available'); expect(u.nodeId).toBe(dest);      // 다른 길로 도착했다
    expect(s.traffic.stats.detours).toBe(1); expect(s.traffic.stats.delaySec).toBeGreaterThan(0);
    // 알려진 뒤에는 모든 경로가 그 구간을 피한다
    expect(passable(e, false, s)).toBe(false);
    expect(findRoute(s.city, u.homeNode, dest, wf)!.edges).not.toContain(e.id);
    expect(s.events.some((ev) => ev.kind === 'traffic' && ev.actor === u.callsign && ev.text.includes('통행 불가'))).toBe(true);
    expect(s.events.some((ev) => ev.kind === 'traffic' && ev.truth && ev.text.includes('아직 아무도 신고하지'))).toBe(true);
  });
  it('시민 제보로도 알려지고, 치워지면 길이 다시 열린다', () => {
    const s = bare('TR-TIP');
    let e!: RoadEdge, ob!: NonNullable<ReturnType<typeof addObstacle>>;
    for (const q of s.city.edges) {
      if (q.cls !== 'street' || q.gateT !== undefined) continue;
      const o = addObstacle(s, { edge: q.id, kind: 'debris', full: true, dur: 60, known: false });      // 우회로가 없는 구간에는 놓이지 않는다
      if (o) { e = q; ob = o; break; }
    }
    expect(ob).toBeTruthy();
    expect(addObstacle(s, { edge: e.id, kind: 'breakdown', full: false, dur: 60, known: true })).toBeNull();      // 한 구간에 장애물은 하나
    ob.tipAt = s.t + 20;
    tick(s, 90); expect(ob.known).toBe(false); expect(e.closed).toBe(true);
    tick(s, 20); expect(ob.known).toBe(true); expect(e.known).toBe(true);
    expect(s.events.some((ev) => ev.actor === '교통정보' && ev.text.startsWith('시민 제보'))).toBe(true);
    tick(s, 220);
    expect(e.closed).toBe(false); expect(e.closedReason).toBeNull(); expect(e.known).toBeUndefined();
    expect(s.traffic.obstacles.length).toBe(0);
    expect(s.events.some((ev) => ev.text.includes('통행 재개'))).toBe(true);
  });
  it('한 차로를 막은 고장 차량: 곁을 지나는 부대가 알리고, 그대로 지나간다', () => {
    const s = bare('TR-LANE');
    const wf = weatherSpeedFactor(s), u = s.units.find((q) => q.kind === 'patrol')!;
    let e!: RoadEdge;
    for (const q of s.city.edges) { if (q.cls !== 'arterial') continue; const r = findRoute(s.city, q.a, q.b, wf); if (r && r.edges.length === 1 && r.edges[0] === q.id) { e = q; break; } }
    const ob = addObstacle(s, { edge: e.id, t: 0.5, kind: 'breakdown', full: false, dur: 400, known: false })!;
    expect(ob).not.toBeNull(); expect(e.closed).toBe(false);
    const c0 = e.cong;
    tick(s, 300);      // 병목: 그 구간이 느려진다
    expect(e.cong).toBeGreaterThan(c0 + 0.4); expect(ob.known).toBe(false);
    drive(s, u, e.a, e.b);
    expect(obstacleAhead(s, u, e, e.a)).toBeNull();      // 길을 막지는 않는다
    tick(s, 600);
    expect(u.nodeId).toBe(e.b); expect(u.state).toBe('available');
    expect(ob.known).toBe(true); expect(s.traffic.stats.detours).toBe(0);
    expect(s.events.some((ev) => ev.kind === 'traffic' && ev.actor === u.callsign && ev.text.includes('한 차로가 막혔습니다'))).toBe(true);
  });
  it('불법 주차: 큰 차는 되돌아가고 작은 차는 지나간다. 알려진 뒤에는 큰 차의 경로만 그 골목을 피한다', () => {
    const s = bare('TR-PARK');
    const wf = weatherSpeedFactor(s);
    const big = s.units.find((q) => q.kind === 'engine')!, small = s.units.find((q) => q.kind === 'patrol')!, amb = s.units.find((q) => q.kind === 'als' || q.kind === 'bls')!;
    expect(big.heavy).toBe(true); expect(small.heavy).toBeFalsy(); expect(amb.heavy).toBeFalsy();
    expect(s.units.filter((q) => q.heavy).map((q) => q.kind).sort().filter((k, i, a) => a.indexOf(k) === i)).toEqual(['engine', 'hazmat', 'ladder', 'rescue']);
    // 곧장 가는 길이 그 골목 하나인 이면 도로
    let e!: RoadEdge, ob = null as ReturnType<typeof addObstacle>;
    for (const q of s.city.edges) {
      if (q.cls !== 'local' || q.gateT !== undefined) continue;
      const r = findRoute(s.city, q.a, q.b, wf, -1, true);
      if (!r || r.edges.length !== 1 || r.edges[0] !== q.id) continue;
      ob = addObstacle(s, { edge: q.id, t: 0.5, kind: 'parked', full: false, heavyOnly: true, dur: Infinity, known: false });
      if (ob) { e = q; break; }
    }
    expect(ob).not.toBeNull();
    expect(e.closed).toBe(false);      // 막힌 길이 아니다
    // 작은 차: 그대로 지나간다 (알려지지도 않는다)
    drive(s, small, e.a, e.b);
    expect(obstacleAhead(s, small, e, e.a)).toBeNull();
    tick(s, 600);
    expect(small.state).toBe('available'); expect(small.nodeId).toBe(e.b);
    expect(ob!.known).toBe(false); expect(s.traffic.stats.detours).toBe(0); expect(s.traffic.stats.obstacles).toBe(0);
    // 큰 차: 가 보고서야 알고, 되돌아 다른 길로 간다
    drive(s, big, e.a, e.b);
    expect(big.route!.edges).toEqual([e.id]);
    expect(obstacleAhead(s, big, e, e.a)).toBe(ob);
    let maxPos = 0;
    tick(s, 3000, () => { const p = posOn(s, big, e); if (p !== null && !big.backing) maxPos = Math.max(maxPos, p); });
    expect(maxPos).toBeLessThan(0.5);
    expect(big.state).toBe('available'); expect(big.nodeId).toBe(e.b);
    expect(ob!.known).toBe(true); expect(e.noHeavy).toBe(true); expect(s.traffic.stats.detours).toBe(1);
    expect(s.traffic.stats.obstacles).toBe(1);      // 발견됐을 때 한 번 센다
    expect(findRoute(s.city, e.a, e.b, wf, -1, true)!.edges).not.toContain(e.id);      // 큰 차의 경로는 피한다
    expect(findRoute(s.city, e.a, e.b, wf, -1, false)!.edges).toEqual([e.id]);         // 작은 차의 경로는 그대로다
    expect(passable(e, true, s)).toBe(false); expect(passable(e, false, s)).toBe(true);
    // 구급차도 지나간다
    drive(s, amb, e.a, e.b); tick(s, 600);
    expect(amb.nodeId).toBe(e.b); expect(s.traffic.stats.detours).toBe(1);
  });
});

describe('건널목과 열차', () => {
  it('건널목이 여섯 곳 이상이고, 차단기가 내려가 있는 동안 어떤 부대도 건널목을 넘지 않는다', () => {
    const s = bare('TR-GATE');
    const tr = s.traffic;
    expect(tr.crossings.length).toBeGreaterThanOrEqual(6);
    for (const c of tr.crossings) { const e = s.city.edges[c.edge]; expect(e.cls === 'street' || e.cls === 'local').toBe(true); expect(e.gateT).toBeGreaterThan(0); expect(e.gateT).toBeLessThan(1); expect(c.s).toBeGreaterThan(0); expect(c.s).toBeLessThan(tr.railLen); }
    // 건널목마다: 열차를 건널목 앞 300 에 두고, 양쪽에서 부대를 들여보낸다
    const cars = s.units.filter((q) => !q.air && !q.sea);
    let checked = 0;
    for (const c of tr.crossings) {
      const e = s.city.edges[c.edge], g = e.gateT!;
      tr.trains.length = 0; tr.trains.push({ pos: c.s - 300, ppos: c.s - 300, dir: 1, speed: 26, len: 110, dwell: 0, called: true });
      const a = cars[checked % cars.length], b = cars[(checked + 1) % cars.length];
      drive(s, a, e.a, e.b); drive(s, b, e.b, e.a);
      if (a.route!.edges[0] !== e.id || b.route!.edges[0] !== e.id) continue;      // 곧장 가는 길이 이 구간이 아니면 건너뛴다
      checked++;
      const w0 = s.traffic.stats.gateWaits;
      let sawDown = false, crossedWhileDown = false, waitedA = false;
      const before = (u: Unit, fromA: boolean): boolean => { const p = posOn(s, u, e); return p !== null && (fromA ? p < g : p > g); };
      let wasA = true, wasB = true;
      tick(s, 600, () => {
        if (c.down) {
          sawDown = true; expect(e.wait).toBeGreaterThan(0);
          const nowA = before(a, true), nowB = before(b, false);
          if ((wasA && !nowA) || (wasB && !nowB)) crossedWhileDown = true;      // 내려가 있는데 건널목 앞에 있던 부대가 넘어갔다
          if (nowA && a.x === a.px && a.y === a.py) waitedA = true;
          wasA = nowA; wasB = nowB;
        } else { wasA = before(a, true); wasB = before(b, false); }
      });
      expect(sawDown).toBe(true); expect(crossedWhileDown).toBe(false); expect(waitedA).toBe(true);
      expect(c.down).toBe(false); expect(e.wait).toBe(0); expect(e.closed).toBe(false);      // 열차가 지나가면 올라간다. 통제는 아니다
      expect(a.state).toBe('available'); expect(a.nodeId).toBe(e.b); expect(b.nodeId).toBe(e.a);      // 올라간 뒤 지나갔다
      expect(s.traffic.stats.gateWaits).toBeGreaterThan(w0);
    }
    expect(checked).toBeGreaterThanOrEqual(4);
    // 경로 계산: 기다리는 시간은 그 건널목에 닿을 즈음까지 남은 만큼만 더한다 (통제가 아니므로 길에서 빼지는 않는다)
    {
      const e = s.city.edges[tr.crossings[0].edge], wf = weatherSpeedFactor(s);
      const near0 = findRoute(s.city, e.a, e.b, wf, e.id)!;      // 이 구간을 빼고 돌아가는 길
      e.wait = 0; const free = findRoute(s.city, e.a, e.b, wf)!;
      e.wait = 12; const held = findRoute(s.city, e.a, e.b, wf)!;
      expect(free.edges).toEqual([e.id]);
      if (near0.time > free.time + 12) { expect(held.edges).toEqual([e.id]); expect(held.time).toBeCloseTo(free.time + 12, 5); }
      let far = -1; for (const n of s.city.nodes) { const r = findRoute(s.city, n.id, e.b, wf); if (r && r.edges.length >= 4 && r.edges[r.edges.length - 1] === e.id && r.time - free.time > 30) { far = n.id; break; } }
      if (far >= 0) { const r1 = findRoute(s.city, far, e.b, wf)!; e.wait = 0; const r0 = findRoute(s.city, far, e.b, wf)!; expect(r1.time).toBeCloseTo(r0.time, 5); }      // 멀리서는 닿기 전에 차단기가 올라간다
      e.wait = 0;
    }
    expect(s.traffic.stats.delaySec).toBeGreaterThan(0);
    expect(s.events.some((ev) => ev.kind === 'traffic' && ev.text.includes('건널목 차단기 대기'))).toBe(true);
  });
  it('열차는 철길 위에서만 움직이고, 역에 한 번 서며, 지나가면 사라진다', () => {
    const s = new Sim('TR-RAIL');
    const tr = s.traffic;
    let seen = 0, dwelled = 0, downs = 0;
    for (let i = 0; i < 6000 && !s.ended; i++) {
      s.step();
      for (const t of tr.trains) { seen++; expect(t.pos).toBeGreaterThanOrEqual(-t.len); expect(t.pos).toBeLessThanOrEqual(tr.railLen + t.len); if (t.dwell > 0) { dwelled++; expect(Math.abs(t.pos - t.dir * t.len / 2 - tr.stationS)).toBeLessThan(1); } }
      for (const c of tr.crossings) { if (c.down) downs++; expect(s.city.edges[c.edge].closed && s.city.edges[c.edge].closedReason === null).toBe(false); }
      expect(tr.trains.length).toBeLessThanOrEqual(2);
    }
    expect(seen).toBeGreaterThan(500); expect(dwelled).toBeGreaterThan(60); expect(downs).toBeGreaterThan(200);
  });
});

describe('정체의 밀림', () => {
  it('간선 한 구간을 막으면 이웃 구간이 밀리고, 풀면 가라앉는다', () => {
    const s = bare('TR-QUEUE');
    const city = s.city;
    const e = city.edges.find((q) => q.cls === 'arterial' && city.nodes[q.a].edges.length >= 3 && city.nodes[q.b].edges.length >= 3 && !city.facilities.some((f) => f.nodeId === q.a || f.nodeId === q.b))!;
    const near: number[] = []; for (const n of [e.a, e.b]) for (const id of city.nodes[n].edges) if (id !== e.id && near.indexOf(id) < 0) near.push(id);
    const avg = (): number => near.reduce((x, id) => x + city.edges[id].cong, 0) / near.length;
    const q = (): number => near.reduce((x, id) => x + s.traffic.queue[id], 0) / near.length;
    tick(s, 300);      // 평소 수준으로 가라앉힌다 (다섯 주기)
    const base = avg();
    expect(q()).toBe(0);
    const ob = addObstacle(s, { edge: e.id, kind: 'roadwork', full: true, dur: 61, known: true })!;
    expect(ob).not.toBeNull();
    tick(s, 300);      // 다섯 주기
    const jammed = avg();
    expect(q()).toBeGreaterThan(0.5);
    expect(jammed).toBeGreaterThan(base + 0.3);
    // 한 다리 건너까지만 번진다: 먼 구간은 그대로다
    const far = city.edges.filter((x) => near.indexOf(x.id) < 0 && x.id !== e.id && !near.some((id) => { const m = city.edges[id]; return m.a === x.a || m.a === x.b || m.b === x.a || m.b === x.b; }));
    for (const x of far) expect(s.traffic.queue[x.id]).toBe(0);
    tick(s, 900);      // 공사가 끝나고 열네 주기
    expect(e.closed).toBe(false);
    expect(q()).toBeLessThan(0.1);
    expect(avg()).toBeLessThan(base + 0.15);
  });
});

describe('도시는 끊기지 않는다', () => {
  it('42교대(교통 1·3·5) 내내 시설 사이에 알려진 상태로 길이 있고, 교통 5 는 교통 1 보다 막히고 대응이 늦다', () => {
    const N = 14;
    const sum = [1, 3, 5].map(() => ({ cong: 0, cn: 0, resp: 0, rn: 0, parked: 0, obstacles: 0, detours: 0, unknown: 0 }));
    for (let k = 0; k < N * 3; k++) {
      const lv = k % 3, traffic = [1, 3, 5][lv], m = sum[lv];
      const s = new Sim('S' + Math.floor(k / 3), traffic === 3 ? NORMAL : { ...NORMAL, traffic });
      const F = s.city.facilities;
      m.parked += s.traffic.obstacles.filter((o) => o.kind === 'parked').length;
      for (let i = 0; i < 9000 && !s.ended; i++) {
        s.step();
        if (i % 100) continue;
        // 아무 두 시설 사이에, 관제가 아는 상태로, 작은 차와 큰 차 모두 길이 있다
        const a = F[(i / 100) % F.length], b = F[((i / 100) * 7 + 3) % F.length];
        expect(findRoute(s.city, a.nodeId, b.nodeId), `${s.seed} t=${s.t} ${a.name}→${b.name}`).not.toBeNull();
        expect(findRoute(s.city, a.nodeId, b.nodeId, 1, -1, true), `${s.seed} t=${s.t} ${a.name}→${b.name} (큰 차)`).not.toBeNull();
        for (const e of s.city.edges) {
          m.cong += e.cong; m.cn++;
          if (e.closed && e.known === false) m.unknown++;
          // 구간의 표시와 장애물 목록이 어긋나지 않는다
          if (!e.closedReason && e.known === undefined && !e.noHeavy) continue;
          const o = s.traffic.obstacles.find((q) => q.edge === e.id);
          if (e.closedReason === 'obstacle' || e.closedReason === 'roadwork') { expect(o && o.full).toBeTruthy(); expect(e.closed).toBe(true); }
          if (e.known === false) expect(o && o.full && !o.known).toBeTruthy();
          if (e.noHeavy) expect(o && o.heavyOnly && o.known).toBeTruthy();
        }
      }
      s.runToEnd();
      expect(s.ended).toBe(true);
      // 교대가 끝났을 때 장애물로 막힌 채 남은 구간에는 치워지는 시각이 있다
      for (const e of s.city.edges) {
        if (e.closedReason !== 'obstacle') continue;
        const o = s.traffic.obstacles.find((q) => q.edge === e.id)!;
        expect(o).toBeTruthy(); expect(isFinite(o.until)).toBe(true);
      }
      // 보고서는 기록된 통계 그대로다
      const r = s.report!;
      expect(r.traffic).toEqual(s.traffic.stats);
      expect(r.summary.some((l) => l.startsWith('교통'))).toBe(true);
      m.obstacles += r.traffic!.obstacles; m.detours += r.traffic!.detours;
      for (const I of s.incidents) if (I.result && I.result.responseTime >= 0) { m.resp += I.result.responseTime; m.rn++; }
    }
    const [lo, mid, hi] = sum;
    expect(lo.parked).toBe(0); expect(mid.parked).toBe(N * 3); expect(hi.parked).toBe(N * 7);
    expect(hi.cong / hi.cn).toBeGreaterThan(lo.cong / lo.cn + 0.15);
    expect(mid.cong / mid.cn).toBeGreaterThan(lo.cong / lo.cn);
    expect(hi.resp / hi.rn).toBeGreaterThan(lo.resp / lo.rn + 2);
    expect(hi.obstacles).toBeGreaterThan(lo.obstacles);
    expect(lo.obstacles + mid.obstacles + hi.obstacles).toBeGreaterThan(40);
    expect(lo.unknown + mid.unknown + hi.unknown).toBeGreaterThan(0);
    expect(lo.detours + mid.detours + hi.detours).toBeGreaterThan(0);
  }, 240000);
});

describe('교통의 정보 격리', () => {
  it('관제(dispatch)는 장애물 목록을 보지 않는다 — 알려진 도로 상태만 경로 계산으로 본다', () => {
    const dir = new URL('../src/sim/dispatch/', import.meta.url);
    for (const f of readdirSync(dir)) {
      const src = readFileSync(new URL(f, dir), 'utf8');
      expect(src.includes('obstacles'), f).toBe(false);
      expect(src.includes('sim.traffic'), f).toBe(false);
    }
    // 경로 계산(city.ts)도 장애물 목록이 아니라 구간에 적힌 알려진 상태만 읽는다
    const city = readFileSync(new URL('../src/sim/city.ts', import.meta.url), 'utf8');
    expect(city.includes('obstacles')).toBe(false); expect(city.includes("from './traffic'")).toBe(false);
  });
  it('교통의 난수는 사건 생성의 난수를 건드리지 않는다: 손잡이를 바꿔도 같은 사건이 같은 순서로 일어난다', () => {
    const sig = (d: Difficulty): string => { const s = new Sim('TR-RNG', d); s.run(1500); return s.incidents.slice(0, 3).map((I) => `${I.truth.type}/${I.truth.variant}@${I.truth.nodeId}`).join(','); };
    expect(sig({ ...NORMAL, traffic: 5 })).toBe(sig({ ...NORMAL, traffic: 1 }));
  });
});
