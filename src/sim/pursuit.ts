// 추격전 — 도주 차량이 도로망을 실제로 달린다.
// 관제는 목격 신고와, 따라붙은 순찰차·헬기의 시야로만 위치를 안다(I.reportedNode). 출동한 부대는 그 위치로 계속 방향을 바꾼다.
// 순찰차가 바짝 붙어 버티거나 앞질러 교차로를 막으면 차가 서고, 그 자리에 현장이 열린다. 놓치면 도시 밖으로 빠져나간다.

import { edgeName, nodeName, weatherSpeedFactor } from './city';
import type { Sim } from './engine';
import { emit, raiseProblem } from './events';
import { createScene } from './field/sceneManager';
import { closeIncident } from './incidents';
import { sendUnitTo } from './resources';
import type { Rng } from './rng';
import type { Incident, Unit } from './types';
import { josa } from './util';

const rngOf = new WeakMap<Incident, Rng>();
const WHO: Record<string, string> = { kidnap: '납치 차량', drunk: '난폭 운전 차량', getaway: '도주 차량' };
/** 납치범이 숨어들 만한 곳: 외진 창고·작업장·농가·펜션 */
const HIDEOUT_KINDS = ['warehouse', 'workshop', 'farmhouse', 'pension', 'storage', 'greenhouse'];

/** 추격전으로 시작하는 사건을 준비한다 (사건 생성 직후). 차는 신고 전화가 걸려 올 즈음 달리기 시작한다. */
export function startPursuit(sim: Sim, I: Incident, kind: 'kidnap' | 'drunk' | 'getaway'): void {
  const rng = sim.rng.fork('pursuit:' + I.id);
  rngOf.set(I, rng);
  const city = sim.city, n = city.nodes[I.truth.nodeId];
  const exits = city.nodes.filter((q) => q.exit);
  // 납치범과 달아나는 무장 용의자는 도시 밖으로 나가는 길 가운데 먼 쪽을 고른다. 난폭 운전자는 정처 없이 달린다
  const far = [...exits].sort((a, b) => Math.hypot(b.x - n.x, b.y - n.y) - Math.hypot(a.x - n.x, a.y - n.y));
  let goal = kind === 'kidnap' || kind === 'getaway' ? far[rng.int(0, Math.min(2, far.length - 1))].id : rng.pick(city.nodes.filter((q) => q.edges.length >= 3)).id;
  const first = n.edges.map((id) => city.edges[id]).filter((e) => !e.closed)[0] ?? city.edges[n.edges[0]];
  // 납치범 열에 넷은 도시를 빠져나가지 않고 은신처로 간다 (따로 뽑는 난수: 나머지 납치 사건의 흐름을 흔들지 않는다)
  let hideout: number | undefined;
  if (kind === 'kidnap') {
    const hr = sim.rng.fork('hideout:' + I.id);
    const cands = city.places.filter((q) => HIDEOUT_KINDS.indexOf(q.kind) >= 0 && !q.open && q.facility < 0 && q.nodeId !== n.id && Math.hypot(q.x + q.w / 2 - n.x, q.y + q.h / 2 - n.y) >= 500);
    if (hr.chance(0.4) && cands.length) { const pl = hr.pick(cands); hideout = pl.id; goal = pl.nodeId; }
  }
  I.pursuit = {
    state: 'driving', kind, from: n.id, to: first.a === n.id ? first.b : first.a, edge: first.id, t: 0, x: n.x, y: n.y, angle: 0, goal,
    startAt: I.firstCallAt + (kind === 'kidnap' ? 2 : 0), nextSight: 0, seenAt: -1, pressure: 0, tracked: false, how: '',
    crashAt: kind === 'drunk' ? I.firstCallAt + rng.range(30, 130) : Infinity, giveUpAt: I.firstCallAt + (kind === 'kidnap' ? 300 : kind === 'getaway' ? 240 : 260), trail: [[n.x, n.y]],
  };
  if (hideout !== undefined) I.pursuit.hideout = hideout;
  if (kind === 'getaway' && rng.chance(0.3)) I.pursuit.crashAt = I.firstCallAt + rng.range(45, 160);      // 서두르다 사고를 내기도 한다
  pickNext(sim, I, rng, -1);
}

const ground = (u: Unit): boolean => u.dept === 'police' && !u.air && !u.sea;

/** 교차로에서 다음에 달릴 길을 고른다: 목표에 가까워지고, 큰길이고, 덜 막히고, 순찰차가 없는 쪽 */
function pickNext(sim: Sim, I: Incident, rng: Rng, cameFrom: number): void {
  const p = I.pursuit!, city = sim.city, n = city.nodes[p.from], G = city.nodes[p.goal];
  let opts = n.edges.map((id) => city.edges[id]).filter((e) => !e.closed && e.id !== cameFrom);
  if (!opts.length) opts = n.edges.map((id) => city.edges[id]);      // 막다른 길: 되돌아 나온다
  const chasers = I.assigned.map((uid) => sim.units[uid]).filter((u) => ground(u) && u.state === 'enroute');
  let best = opts[0], bs = -Infinity;
  for (const e of opts) {
    const O = city.nodes[e.a === n.id ? e.b : e.a];
    let s = -Math.hypot(O.x - G.x, O.y - G.y) / 110 + (e.cls === 'highway' ? 1.2 : e.arterial ? 0.6 : 0) - (e.cong + e.slow) * 0.5 + rng.range(0, p.kind === 'drunk' ? 5 : 1.2);
    for (const u of chasers) { if (Math.hypot(u.x - O.x, u.y - O.y) < 170) s -= 4; if (Math.hypot(u.x - (n.x + O.x) / 2, u.y - (n.y + O.y) / 2) < 90) s -= 3; }
    if (O.edges.length === 1 && O.id !== p.goal) s -= 6;      // 막다른 길로는 들어가지 않는다
    if (s > bs) { bs = s; best = e; }
  }
  p.edge = best.id; p.to = best.a === n.id ? best.b : best.a; p.t = 0;
}

function nearestNode(sim: Sim, x: number, y: number): number {
  let b = 0, bd = Infinity;
  for (const n of sim.city.nodes) { const d = Math.hypot(n.x - x, n.y - y); if (d < bd) { bd = d; b = n.id; } }
  return b;
}

/** 차가 섰다: 그 자리에 현장을 연다 */
function stop(sim: Sim, I: Incident, nodeId: number, how: 'caught' | 'block' | 'crash' | 'cornered', by: Unit | null): void {
  const p = I.pursuit!, n = sim.city.nodes[nodeId];
  p.state = 'stopped'; p.how = how; p.x = n.x; p.y = n.y;
  I.truth.nodeId = nodeId; I.truth.x = n.x; I.truth.y = n.y; I.truth.placeId = -1; I.truth.placeKind = null; I.truth.district = n.district;
  I.truth.label = `${nodeName(sim.city, nodeId)} ${how === 'crash' ? '사고 현장' : '검거 현장'}`;
  I.reportedNode = nodeId; I.locationKnown = true;
  createScene(sim, I);      // 세운 자리의 현장을 이제 만든다 (사고로 멈췄으면 다친 사람이 있다)
  const who = WHO[p.kind];
  const text = how === 'crash' ? `${josa(who, '이/가')} ${nodeName(sim.city, nodeId)}에서 사고를 내고 멈췄습니다.` : how === 'cornered' ? `${by!.callsign}: 숨을 곳으로 들어가려던 ${josa(who, '을/를')} 놓치지 않고 따라가 세웠습니다 — ${nodeName(sim.city, nodeId)}.` : how === 'block' ? `${by!.callsign}: 앞을 막아 ${josa(who, '을/를')} 세웠습니다 — ${nodeName(sim.city, nodeId)}.` : `${by!.callsign}: 바짝 붙어 ${josa(who, '을/를')} 세웠습니다 — ${nodeName(sim.city, nodeId)}.`;
  I.lastEvent = emit(sim, { inc: I.id, role: how === 'crash' ? 'SYSTEM' : 'UNIT', actor: how === 'crash' ? '교통정보' : by!.callsign, kind: 'unit', imp: 3, causes: [I.lastEvent], text });
  for (const uid of I.assigned) { const u = sim.units[uid]; if (u.state === 'enroute') sendUnitTo(sim, u, nodeId); else if (u.state === 'turnout') u.destNode = nodeId; }
}

export function tickPursuits(sim: Sim): void {
  const city = sim.city, dt = sim.dt, wf = weatherSpeedFactor(sim) / Math.max(0.6, sim.tune.vehicleSpeedMul);      // 도주 차량은 장비 상태와 무관하다
  for (const I of sim.incidents) {
    const p = I.pursuit;
    if (!p || p.state !== 'driving' || I.phase === 'closed' || sim.t < p.startAt) continue;
    const rng = rngOf.get(I)!;
    if (I.truth.placeId >= 0) { I.truth.placeId = -1; I.truth.placeKind = null; }      // 이제 그 건물의 사건이 아니라 달리는 차의 사건이다
    // 달린다: 일반 차량이므로 정체의 영향을 그대로 받는다
    const e = city.edges[p.edge], A = city.nodes[p.from], B = city.nodes[p.to];
    const v = (e.speed * (p.kind === 'drunk' ? 0.74 : 0.98) * wf) / (1 + (e.cong - 1) * 0.9 + e.slow * 0.6);
    p.t += (v * dt) / e.len;
    p.x = A.x + (B.x - A.x) * Math.min(1, p.t); p.y = A.y + (B.y - A.y) * Math.min(1, p.t); p.angle = Math.atan2(B.y - A.y, B.x - A.x);
    I.truth.x = p.x; I.truth.y = p.y; I.truth.nodeId = p.t > 0.5 ? p.to : p.from;
    // 시야: 순찰차는 가까이에서, 헬기는 멀리서도 본다. 보고 있는 동안에는 위치가 계속 전해진다
    let near = 0, closest: Unit | null = null, cd = Infinity;
    p.tracked = false;
    for (const uid of I.assigned) {
      const u = sim.units[uid];
      if (u.state !== 'enroute' || !(ground(u) || u.air)) continue;
      const d = Math.hypot(u.x - p.x, u.y - p.y);
      if (d < (u.air ? 430 : 175)) p.tracked = true;
      if (ground(u)) { if (d < 42) near++; if (d < cd) { cd = d; closest = u; } }
    }
    if (p.tracked) { if (p.seenAt < 0) I.lastEvent = emit(sim, { inc: I.id, role: 'UNIT', actor: closest && cd < 175 ? closest.callsign : '헬기', kind: 'unit', imp: 2, causes: [I.lastEvent], text: `${WHO[p.kind]} 발견 — ${edgeName(city, e)}에서 추격을 시작합니다.` }); p.seenAt = sim.t; I.reportedNode = p.to; I.locationKnown = true; }
    else if (sim.t >= p.nextSight) {
      // 시민의 목격 신고: 방금 지나간 길을 알려 온다
      p.nextSight = sim.t + rng.range(9, 19);
      if (I.reportedAt >= 0 && rng.chance(0.62)) { I.reportedNode = p.to; I.locationKnown = true; emit(sim, { inc: I.id, role: 'CALL_TAKER', actor: '신고 접수 AI', kind: 'call', imp: 1, causes: [I.lastEvent], text: `목격 신고: ${josa(WHO[p.kind], '이/가')} ${edgeName(city, e)}을 지나 ${nodeName(city, p.to)} 쪽으로 달리고 있습니다.` }); }
    }
    // 따라붙은 순찰차가 버티면 차를 세운다 (둘이 붙으면 더 빨리)
    if (near > 0) p.pressure += dt * (near >= 2 ? 2.2 : 1); else p.pressure = Math.max(0, p.pressure - dt * 0.5);
    if (p.pressure >= (p.kind === 'drunk' ? 5 : 8)) { stop(sim, I, nearestNode(sim, p.x, p.y), 'caught', closest); continue; }
    // 출동한 부대는 알려진 위치로 방향을 바꾼다
    for (const uid of I.assigned) { const u = sim.units[uid]; if (u.state === 'enroute' && u.destNode !== I.reportedNode) sendUnitTo(sim, u, I.reportedNode); else if (u.state === 'turnout') u.destNode = I.reportedNode; }
    if (p.t < 1) continue;
    // 교차로에 닿았다
    p.trail.push([B.x, B.y]); if (p.trail.length > 14) p.trail.shift();
    const blocker = I.assigned.map((uid) => sim.units[uid]).find((u) => ground(u) && u.state === 'enroute' && Math.hypot(u.x - B.x, u.y - B.y) < 24);
    if (blocker) { stop(sim, I, B.id, 'block', blocker); continue; }
    if (sim.t >= p.crashAt) { stop(sim, I, B.id, 'crash', null); continue; }
    if (p.hideout !== undefined && B.id === p.goal) {
      // 은신처 앞에 닿았다: 부대가 보고 있으면 그 자리에 세우고, 아무도 보지 못했으면 숨어든다 (나중에 그곳에서 제보가 들어온다)
      const watcher = closest && cd < 175 ? closest : I.assigned.map((uid) => sim.units[uid]).find((u) => u.state === 'enroute' && u.air && Math.hypot(u.x - p.x, u.y - p.y) < 430) ?? null;
      if (p.tracked && watcher) { stop(sim, I, B.id, 'cornered', watcher); continue; }
      const den = city.places[p.hideout];
      p.state = 'escaped'; p.how = 'hideout';
      emit(sim, { inc: I.id, role: 'SYSTEM', actor: '도시', kind: 'incident', imp: 1, truth: true, text: `납치범이 붙잡은 사람을 데리고 ${den.name}에 숨어들었습니다.` });
      raiseProblem(sim, I, 'SUSPECT_FLED', '납치 차량을 놓침', { role: 'SYSTEM', actor: '교통정보', imp: 3, causes: [I.lastEvent], text: `${josa(WHO[p.kind], '이/가')} ${nodeName(city, B.id)} 부근에서 자취를 감췄습니다. 추격 실패.` }, false);
      closeIncident(sim, I, 'abandoned');
      sim.gen.chain.push({ at: sim.t + rng.range(40, 90), opts: { type: 'armed', variant: 'hostage', placeId: p.hideout, parent: I.id, note: '납치범이 숨어든 곳에서 제보가 들어옵니다', rng: sim.rng.fork('hideout-call:' + I.id) } });
      continue;
    }
    if ((B.exit && B.id === p.goal) || sim.t >= p.giveUpAt) {
      // 놓쳤다
      p.state = 'escaped';
      raiseProblem(sim, I, 'SUSPECT_FLED', B.exit ? `${josa(WHO[p.kind], '이/가')} ${nodeName(city, B.id)}에서 도시를 빠져나감` : `${josa(WHO[p.kind], '을/를')} 끝내 찾지 못함`, { role: 'SYSTEM', actor: '교통정보', imp: 3, causes: [I.lastEvent], text: B.exit ? `${josa(WHO[p.kind], '이/가')} ${nodeName(city, B.id)}을 지나 도시 밖으로 빠져나갔습니다. 추격 실패.` : `${WHO[p.kind]}의 행방을 놓쳤습니다.` }, false);
      closeIncident(sim, I, 'abandoned');
      continue;
    }
    if (p.kind === 'drunk' && B.id === p.goal) p.goal = rng.pick(city.nodes.filter((q) => q.edges.length >= 3)).id;
    p.from = B.id;
    pickNext(sim, I, rng, p.edge);
  }
}
