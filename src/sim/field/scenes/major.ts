// 대형 사고의 현장 (docs/specs/N5-major.md)
// registerScene('유형', '변형', (sim, I, rng) => Scene) 으로 등록한다. 만드는 도구는 ../kit, ../plans, ../builders 에서 가져온다.
// 모두 지금 있는 규칙(구출·처치·이송·진압·수난 구조·도로 정리) 위에서 규모만 키운다: 사람이 탄 탈것은 vehicle 소품이고 그 둘레가 wreck 구역이다.

import type { Sim } from '../../engine';
import type { Rng } from '../../rng';
import { T } from '../../types';
import type { Incident, Prop, Scene } from '../../types';
import { tidx } from '../grid';
import { SH, SW, addCas, addProp, addRegion, baseScene, get, set } from '../kit';
import { registerScene } from '../sceneRegistry';

/** 길가에 나무를 흩뿌린다 (도로 8~11줄의 위아래 수풀) */
function vergeTrees(s: Scene, rng: Rng, n: number): void {
  const tree = (x: number, y: number): void => { if (get(s, x, y) === T.GROUND) set(s, x, y, T.TREE); };
  for (let k = 0; k < n; k++) {
    const cx = rng.int(1, SW - 2), cy = rng.chance(0.5) ? rng.int(0, 5) : rng.int(14, SH - 1);
    tree(cx, cy); if (rng.chance(0.6)) tree(Math.min(SW - 1, cx + 1), cy);
  }
}

/** 교통사고 현장의 틀: 가로지르는 도로(8~11줄)와 양쪽 수풀, 길 남쪽의 대기 지점과 안전 구역 */
function roadFrame(sim: Sim, I: Incident, rng: Rng, trees: number): Scene {
  const s = baseScene(sim, I, rng);
  for (let y = 8; y <= 11; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.ROAD);
  vergeTrees(s, rng, trees);
  s.staging = { x: 3, y: 13 }; s.safe = { x: 6, y: 14 }; s.vantage = { x: 8, y: 12 };
  for (let y = 13; y <= 15; y++) for (let x = 2; x <= 8; x++) if (get(s, x, y) === T.TREE) set(s, x, y, T.GROUND);      // 대기 지점과 안전 구역은 비워 둔다
  s.leadDept = 'fire';
  return s;
}

/** 탈것에 탄 사람 하나: 갇힘·중상은 안에, 경상은 스스로 나와 길가에 서 있다 */
function rider(s: Scene, rng: Rng, w: Prop, k: number, kind: 'trapped' | 'immobile' | 'mobile', outX: number, outY: number, ease: number): void {
  const vx = w.w >= w.h ? w.x + (k % w.w) : w.x, vy = w.w >= w.h ? w.y : w.y + (k % w.h);
  if (kind === 'trapped') {
    const c = addCas(s, vx, vy, 'trapped', rng.range(48, 76), rng.range(0.16, 0.3) * ease, 0.3, { inVehicle: w.id });
    c.trapWork = rng.range(12, 20); w.occupants!.push(c.id);
  } else if (kind === 'immobile') {
    const c = addCas(s, vx, vy, 'immobile', rng.range(50, 80), rng.range(0.12, 0.24) * ease, 0.3, { inVehicle: w.id });
    w.occupants!.push(c.id);
  } else addCas(s, Math.max(1, Math.min(SW - 2, outX)), outY, 'mobile', rng.range(72, 96), rng.range(0, 0.05), 0);
}

/** (x, y) 에서 가장 가까운, 걸을 수 있고 소품이 없고 사람이 서 있지 않은 칸 */
function freeNear(s: Scene, x: number, y: number): { x: number; y: number } {
  const ok = (xx: number, yy: number): boolean => xx >= 1 && yy >= 0 && xx < SW - 1 && yy < SH && (get(s, xx, yy) === T.GROUND || get(s, xx, yy) === T.ROAD || get(s, xx, yy) === T.FLOOR) && s.propAt[tidx(s, xx, yy)] < 0 && !s.casualties.some((c) => Math.round(c.x) === xx && Math.round(c.y) === yy);
  for (let r = 0; r < 8; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
    if (ok(x + dx, y + dy)) return { x: x + dx, y: y + dy };
  }
  return { x, y };
}

// ───────────────────────── 열차 탈선 ─────────────────────────
// 건널목에서 승용차를 들이받은 열차가 선로를 벗어났다. 철길은 위아래로, 도로는 좌우로 지난다.
// 맨 뒤 객차는 선로 위에 서 있고, 가운데 객차는 건널목 위에서 틀어졌고, 선두 객차는 길을 지나 옆으로 누웠다.
registerScene('traffic', 'train', (sim, I, rng) => {
  const s = roadFrame(sim, I, rng, 12);
  const X = rng.int(14, 17);      // 철길이 지나는 열
  for (let y = 0; y < SH; y++) for (let x = X - 1; x <= X + 1; x++) if (get(s, x, y) === T.TREE) set(s, x, y, T.GROUND);      // 선로 둘레는 자갈밭이다
  const cars: Prop[] = [];
  // 객차는 손으로 치울 수 없다: 처음부터 도로 정리 대상에서 빼 둔다(cleared). color 는 객차 번호이고 0 번이 레일을 함께 그린다
  const car = (x: number, y: number, w: number, h: number, angle: number, name: string): Prop => {
    const p = addProp(s, 'vehicle', x, y, { w, h, blocking: true, hp: 10, leak: 0, leakRate: 0, occupants: [], angle, color: cars.length, bus: true, skin: 'trainCar', cleared: true });
    cars.push(p);
    addRegion(s, name, 'wreck', x - 1, y - 1, x + w, y + h, false, true);
    return p;
  };
  const three = rng.chance(0.6), east = rng.chance(0.5);
  car(X, 2, 1, 3, Math.PI / 2 + rng.range(-0.02, 0.02), three ? '객차 3호' : '객차 2호');
  if (three) car(X, 8, 1, 3, Math.PI / 2 + rng.range(0.14, 0.3) * (east ? -1 : 1), '객차 2호');
  const lead = car(east ? X + 1 : X - 3, 13, 3, 1, rng.range(0.12, 0.38) * (east ? 1 : -1), '객차 1호');
  for (let x = lead.x - 1; x <= lead.x + 3; x++) for (let y = 12; y <= 14; y++) if (get(s, x, y) === T.TREE) set(s, x, y, T.GROUND);
  // 건널목에서 받힌 승용차: 열차에 밀려 길 위에 멈췄다
  const ax = east ? X + 2 : X - 3, ay = rng.pick([9, 10]);
  const auto = addProp(s, 'vehicle', ax, ay, { w: 2, h: 1, blocking: true, hp: 10, leak: 0, leakRate: 0, occupants: [], angle: rng.range(0.5, 1.1) * (east ? 1 : -1), color: rng.int(0, 7) });
  addRegion(s, '건널목 승용차', 'wreck', ax - 1, ay - 1, ax + 2, ay + 1, false, true);
  addRegion(s, '북측 수풀', 'verge', 6, 2, 24, 6, false, true);
  addRegion(s, '남측 수풀', 'verge', 8, 13, 24, 17, false, true);
  // 사람: 모두 10~14명. 승용차에 1~2명, 나머지는 객차에 (갇힘 3~4, 중상 4~5, 경상은 스스로 빠져나와 선로 가에 있다)
  const total = rng.int(10, 14), inAuto = rng.int(1, 2), riders = total - inAuto;
  for (let k = 0; k < inAuto; k++) rider(s, rng, auto, k, rng.chance(0.5) ? 'trapped' : 'immobile', 0, 0, 0.8);
  const nT = rng.int(3, 4), nI = Math.min(rng.int(4, 5), riders - nT);
  const kinds: ('trapped' | 'immobile' | 'mobile')[] = [];
  for (let k = 0; k < riders; k++) kinds.push(k < nT ? 'trapped' : k < nT + nI ? 'immobile' : 'mobile');
  const seat = cars.map(() => 0), weight = cars.map((c) => (c === lead ? 2.2 : 1));      // 넘어진 선두 객차에 사람이 가장 많다
  for (const kind of kinds) {
    const q = rng.weighted(cars.map((_, i) => i), weight), w = cars[q], k = seat[q]++;
    const out = w.w >= w.h ? freeNear(s, w.x + (k % 3), w.y + rng.pick([-1, 1])) : freeNear(s, w.x + rng.pick([-2, 2]), w.y + (k % 3));
    rider(s, rng, w, k, kind, out.x, out.y, 0.7);
  }
  const nd = rng.int(3, 5);
  for (let k = 0; k < nd; k++) { const p = freeNear(s, rng.int(X - 4, X + 5), rng.int(8, 11)); addProp(s, 'roadDebris', p.x, p.y, { hp: 4 }); }
  s.placeName = '열차 탈선 사고 현장';
  // 건널목이 막혀 지나가는 차가 없다: 차로 통제 임무는 생기지 않는다
  s.controlPts = []; s.controlDone = []; s.laneRows = []; s.trafficFlow = 0; s.nextCarAt = Infinity;
  return s;
});

// ───────────────────────── 다중 추돌 ─────────────────────────
// 고속도로에서 차 5~7대가 연달아 부딪쳤다. 두 대에서 기름이 새고, 옆 차로로는 차가 계속 지나간다 (교통 통제가 급하다).
registerScene('traffic', 'pileup', (sim, I, rng) => {
  const s = roadFrame(sim, I, rng, 14);
  const n = rng.int(5, 7), truckK = rng.int(0, n - 1);
  const wrecks: Prop[] = [];
  for (let k = 0; k < n; k++) {
    const truck = k === truckK, y = k % 2 ? 10 : 9;
    const x = 7 + (k >> 1) * 4 + (k % 2 ? 2 : 0) + rng.int(-1, 0);
    const p = addProp(s, 'vehicle', x, y, { w: truck ? 3 : 2, h: 1, blocking: true, hp: 10, leak: 0, leakRate: 0, occupants: [], angle: truck ? rng.range(-0.12, 0.12) : rng.range(-0.45, 0.45), color: rng.int(0, 7), bus: false });
    wrecks.push(p);
    addRegion(s, truck ? '화물차' : `차량 ${k + 1}`, 'wreck', p.x - 1, y - 1, p.x + p.w, y + 1, false, true);
  }
  addRegion(s, '북측 수풀', 'verge', 6, 2, 24, 6, false, true);
  addRegion(s, '남측 수풀', 'verge', 8, 13, 24, 17, false, true);
  // 탑승자 8~12명: 차마다 한 명은 타고 있고, 나머지는 여기저기 나뉜다
  const total = rng.int(8, 12), seats = wrecks.map(() => 1);
  for (let k = n; k < total; k++) {
    const open = wrecks.map((_, q) => q).filter((q) => seats[q] < (q === truckK ? 2 : 3));
    seats[rng.pick(open)]++;
  }
  wrecks.forEach((w, q) => {
    for (let k = 0; k < seats[q]; k++) {
      const roll = rng.next();
      rider(s, rng, w, k, roll < 0.3 ? 'trapped' : roll < 0.65 ? 'immobile' : 'mobile', w.x + (k % 3) + rng.int(-1, 1), w.y === 9 ? 7 : 12, 0.7);
    }
  });
  // 두 대에서 연료가 샌다 (조치하지 않으면 불이 붙는다)
  const leaky = rng.shuffle(wrecks.slice()).slice(0, 2);
  leaky[0].leak = 0.12; leaky[0].leakRate = rng.range(0.0048, 0.0075);
  leaky[1].leak = 0.05; leaky[1].leakRate = rng.range(0.0035, 0.0058);
  const nd = rng.int(4, 6);
  for (let k = 0; k < nd; k++) addProp(s, 'roadDebris', rng.int(6, 24), rng.int(8, 11), { hp: 4 });
  s.placeName = '다중 추돌 사고 현장';
  s.controlPts = [{ x: 2, y: 10 }, { x: 27, y: 9 }]; s.controlDone = [false, false];
  s.laneRows = [8, 11];
  const node = sim.city.nodes[I.truth.nodeId];
  let cong = 1.2; for (const eid of node.edges) cong = Math.max(cong, sim.city.edges[eid].cong);
  s.trafficFlow = cong / 2;
  s.nextCarAt = sim.t + 4;
  return s;
});
