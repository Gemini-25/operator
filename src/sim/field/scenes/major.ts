// 대형 사고의 현장 (docs/specs/N5-major.md)
// registerScene('유형', '변형', (sim, I, rng) => Scene) 으로 등록한다. 만드는 도구는 ../kit, ../plans, ../builders 에서 가져온다.
// 모두 지금 있는 규칙(구출·처치·이송·진압·수난 구조·도로 정리) 위에서 규모만 키운다: 사람이 탄 탈것은 vehicle 소품이고 그 둘레가 wreck 구역이다.

import type { Sim } from '../../engine';
import type { Rng } from '../../rng';
import { DECOR, T } from '../../types';
import type { Incident, Prop, Region, Scene } from '../../types';
import { buildCollapse } from '../builders';
import { tidx } from '../grid';
import { SH, SW, addCas, addProp, addRegion, baseScene, freeTileIn, get, set } from '../kit';
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

/** 대기 지점에서 걸어서 닿는 칸. 잔해와 잠긴 문은 치우거나 열 수 있다고 보고, 밸브·차량 같은 고정 소품은 막힌 칸으로 본다 */
function reachable(s: Scene): Uint8Array {
  const seen = new Uint8Array(s.w * s.h);
  const pass = (i: number): boolean => {
    const t = s.tiles[i];
    if (t !== T.FLOOR && t !== T.DOOR && t !== T.GROUND && t !== T.ROAD && t !== T.STAIR && t !== T.TREE && t !== T.TRAIL) return false;
    const p = s.propAt[i];
    return p < 0 || s.props[p].kind === 'door' || s.props[p].kind === 'debris';
  };
  const st = [tidx(s, s.staging.x, s.staging.y)];
  seen[st[0]] = 1;
  while (st.length) {
    const c = st.pop()!, x = c % s.w, y = (c / s.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) continue;
      const j = ny * s.w + nx;
      if (!seen[j] && pass(j)) { seen[j] = 1; st.push(j); }
    }
    const sl = s.stairTo[c];
    if (sl >= 0 && !seen[sl]) { seen[sl] = 1; st.push(sl); }
  }
  return seen;
}

// ───────────────────────── 가스 폭발 ─────────────────────────
// 붕괴 현장에 덧붙인다: 무너진 자리 옆방의 불, 아직 새고 있는 가스 배관, 건물 앞 길에서 다친 행인.
// 가스 규칙(s.rules)이 함께 돌아, 배관을 잠그기 전에는 고인 가스가 다시 터질 수 있다.
registerScene('collapse', 'gasblast', (sim, I, rng) => {
  const s = buildCollapse(sim, I, rng);
  const rooms = s.regions.filter((r) => r.kind === 'room' && r.indoor);
  let zx = 0, zy = 0, zn = 0;
  for (let i = 0; i < s.damage.length; i++) if (s.damage[i]) { zx += i % SW; zy += (i / SW) | 0; zn++; }
  zx /= Math.max(1, zn); zy /= Math.max(1, zn);
  const wrecked = (r: Region): number => (r.tiles.filter((i) => s.damage[i]).length > r.tiles.length * 0.5 ? 1 : 0);
  const far = (r: Region): number => Math.hypot(r.cx - zx, r.cy - zy);
  const byZone = (a: Region, b: Region): number => wrecked(a) - wrecked(b) || far(a) - far(b) || a.id - b.id;
  // 1) 불: 무너진 자리에서 가장 가까운 성한 방의 가구 3~5칸. 사람이 쓰러져 있는 곳 바로 곁에서는 시작하지 않는다
  const clear = (i: number, d: number): boolean => !s.casualties.some((c) => Math.hypot(c.x - (i % SW), c.y - ((i / SW) | 0)) < d);
  const kindling = (r: Region, d: number): number[] => rng.shuffle(r.tiles.filter((i) => s.tiles[i] === T.FURN && clear(i, d))).concat(rng.shuffle(r.tiles.filter((i) => s.tiles[i] === T.FLOOR && s.propAt[i] < 0 && clear(i, d))));
  const ordered = rooms.slice().sort(byZone);
  let fireRoom = ordered[0], burn: number[] = [];
  for (const d of [4, 2.6]) {
    for (const r of ordered) { const c = kindling(r, d); if (c.length >= 3) { fireRoom = r; burn = c; break; } }
    if (burn.length) break;
  }
  for (const i of burn.slice(0, rng.int(3, 5))) {
    if (s.fuel[i] <= 0) { s.fuel[i] = 0.5; s.totalFuelTiles++; }
    s.fire[i] = rng.range(0.35, 0.55);
  }
  // 2) 새는 배관: 벽에 붙은 가구 자리에 놓는다. 옆에 서서 잠글 수 있도록 바로 옆 칸 하나는 걸어서 닿는 빈 바닥이어야 한다
  const seen = reachable(s);
  const standable = (i: number): boolean => [1, -1, SW, -SW].some((d) => s.tiles[i + d] === T.FLOOR && s.propAt[i + d] < 0 && seen[i + d] === 1);
  const crowd = (r: Region): number => s.casualties.filter((c) => s.region[tidx(s, c.x, c.y)] === r.id).length;
  const others = rng.shuffle(rooms.filter((r) => r !== fireRoom)).sort((a, b) => crowd(a) - crowd(b));      // 되도록 사람이 없는 방의 배관
  let at = -1;
  for (const r of others) {
    const spots = r.tiles.filter((i) => s.tiles[i] === T.FURN && s.fire[i] <= 0 && (s.tiles[i - SW] === T.WALL || s.tiles[i + SW] === T.WALL) && standable(i));
    if (spots.length) { at = rng.pick(spots); break; }
  }
  if (at < 0) for (const r of others.concat([fireRoom])) {
    const spots = r.tiles.filter((i) => s.tiles[i] === T.FURN && s.fire[i] <= 0 && standable(i));
    if (spots.length) { at = rng.pick(spots); break; }
  }
  if (at >= 0) {
    s.tiles[at] = T.FLOOR; s.decor[at] = 0;
    addProp(s, 'valve', at % SW, (at / SW) | 0, { blocking: true, leakRate: rng.range(0.55, 0.7) });
    // 폭발에 깨진 창
    for (let i = 0; i < s.tiles.length; i++) if (s.tiles[i] === T.WINDOW && Math.hypot((i % SW) - (at % SW), ((i / SW) | 0) - ((at / SW) | 0)) <= 6) s.glass[i] = 1;
  }
  // 3) 건물 앞 길에서 다친 행인 2~3명 (가스 규칙이 세는 "주변 시민"에 들어간다: 새는 가스에 쓰러지는 사람은 그만큼 덜 생긴다)
  addRegion(s, '건물 앞 길', 'zone', 0, 14, SW - 1, 16, false, true);
  const nBy = rng.int(2, 3);
  for (let k = 0; k < nBy; k++) {
    const p = freeNear(s, rng.int(6, 15), rng.int(15, 16));      // 도착한 부대가 내리자마자 보이는 자리 (건물 앞, 대기 지점 쪽)
    const walk = rng.chance(0.4);
    addCas(s, p.x, p.y, walk ? 'mobile' : 'immobile', walk ? rng.range(74, 94) : rng.range(50, 78), walk ? rng.range(0, 0.03) : rng.range(0.06, 0.14), 0.05, { bystander2: true });
  }
  s.rules = ['gas'];
  return s;
});

// ───────────────────────── 크레인 붕괴 ─────────────────────────
// 공사장: 울타리 안의 자재 마당과 짓다 만 골조. 타워 크레인의 팔이 마당에서 울타리를 넘어 길까지 비스듬히 쓰러졌다.
// 팔은 치울 수 있는 잔해(skin 'craneBoom')이고, 골조의 금 간 자리(unstable)는 받쳐 두지 않으면 다시 무너져 내린다.
registerScene('collapse', 'crane', (sim, I, rng) => {
  const s = baseScene(sim, I, rng);
  for (let y = 17; y < SH; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.ROAD);
  s.floorMat = 2;
  const F = { x0: 6, y0: 1, x1: 25, y1: 13 };      // 울타리
  for (let x = F.x0; x <= F.x1; x++) { set(s, x, F.y0, T.WALL); set(s, x, F.y1, T.WALL); }
  for (let y = F.y0; y <= F.y1; y++) { set(s, F.x0, y, T.WALL); set(s, F.x1, y, T.WALL); }
  const gx = rng.int(9, 12), gy = rng.int(4, 9);      // 남쪽 정문(두 칸)과 서쪽 쪽문
  set(s, gx, F.y1, T.GROUND); set(s, gx + 1, F.y1, T.GROUND); set(s, F.x0, gy, T.GROUND);
  // 짓다 만 골조: 바닥 판과 띄엄띄엄 선 기둥, 올리다 만 벽
  const B = { x0: 8, y0: 3, x1: 14, y1: 9 };
  for (let y = B.y0; y <= B.y1; y++) for (let x = B.x0; x <= B.x1; x++) set(s, x, y, T.FLOOR);
  for (const px of [8, 11, 14]) for (const py of [3, 6, 9]) set(s, px, py, T.WALL);
  for (const [x, y] of [[9, 3], [10, 3], [12, 3], [8, 4], [8, 5]]) set(s, x, y, T.WALL);
  // 크레인: 기초(마스트)에서 남동쪽으로 넘어간 팔. 끝은 언제나 길 위에 걸친다
  const n = rng.int(6, 9), tipX = rng.int(25, 27);
  const mast = { x: tipX - n, y: 17 - n };
  set(s, mast.x, mast.y, T.WALL);
  // 마당의 자재 더미
  for (let k = 0; k < 4; k++) {
    const x = rng.int(16, 23), y = rng.int(2, 5), i = tidx(s, x, y);
    if (s.tiles[i] !== T.GROUND || Math.abs(x - mast.x) + Math.abs(y - mast.y) < 3) continue;
    s.tiles[i] = T.FURN; s.decor[i] = rng.pick([DECOR.CRATE, DECOR.CRATE, DECOR.MACHINE]);
  }
  const frame = addRegion(s, '짓다 만 골조', 'room', B.x0, B.y0, B.x1, B.y1, true, true);
  const yard = addRegion(s, '자재 마당', 'zone', F.x0 + 1, F.y0 + 1, F.x1 - 1, F.y1 - 1, false, true);
  yard.tiles = yard.tiles.filter((i) => s.tiles[i] !== T.FLOOR);      // 골조 안은 마당 수색에 넣지 않는다 (무너질 수 있는 곳은 소방만 들어간다)
  addRegion(s, '공사장 앞 길', 'zone', 0, 14, SW - 1, 16, false, false);
  const boom: Prop[] = [];
  for (let k = 1; k <= n; k++) {
    const x = mast.x + k, y = mast.y + k, i = tidx(s, x, y);
    if (s.tiles[i] === T.WALL) s.tiles[i] = T.GROUND;      // 팔에 눌려 넘어간 울타리
    s.damage[i] = 1;
    boom.push(addProp(s, 'debris', x, y, { blocking: true, hp: rng.range(12, 21), skin: 'craneBoom', angle: Math.PI / 4 }));
  }
  // 작업자 3~5명: 둘은 팔에 깔렸고, 나머지는 골조에서 떨어지거나 마당·길에서 다쳤다
  const total = rng.int(3, 5);
  const inside = boom.filter((p) => p.y < F.y1);
  const under: number[] = [];
  for (const p of inside) for (const [dx, dy] of [[-1, 0], [0, 1], [1, 0], [0, -1]]) {
    const x = p.x + dx, y = p.y + dy, i = tidx(s, x, y);
    if (x > F.x0 && x < F.x1 && y > F.y0 && y < F.y1 && s.tiles[i] === T.GROUND && s.propAt[i] < 0 && under.indexOf(i) < 0) under.push(i);
  }
  rng.shuffle(under);
  for (let k = 0; k < 2 && k < under.length; k++) {
    const i = under[k];
    s.damage[i] = 1;
    const c = addCas(s, i % SW, (i / SW) | 0, 'trapped', rng.range(46, 80), rng.range(0.08, 0.19), rng.range(0.3, 0.5));
    c.trapWork = rng.range(14, 22);
  }
  if (total >= 3) { const i = freeTileIn(s, frame, rng); addCas(s, i % SW, (i / SW) | 0, 'immobile', rng.range(48, 80), rng.range(0.07, 0.16), rng.range(0.2, 0.4)); }
  if (total >= 4) { const p = freeNear(s, mast.x - 1, mast.y - 1); addCas(s, p.x, p.y, rng.chance(0.6) ? 'immobile' : 'mobile', rng.range(55, 88), rng.range(0.04, 0.13), rng.range(0.1, 0.3)); }
  if (total >= 5) { const p = freeNear(s, tipX, 15); const walk = rng.chance(0.5); addCas(s, p.x, p.y, walk ? 'mobile' : 'immobile', walk ? rng.range(74, 94) : rng.range(52, 80), walk ? 0.02 : rng.range(0.06, 0.14), 0.05); }
  // 금 간 골조 두 곳: 기둥 곁
  const cracks = frame.tiles.filter((i) => s.tiles[i] === T.FLOOR && [1, -1, SW, -SW].some((d) => s.tiles[i + d] === T.WALL) && !s.casualties.some((c) => tidx(s, c.x, c.y) === i));
  rng.shuffle(cracks);
  for (let k = 0; k < 2 && k < cracks.length; k++) addProp(s, 'unstable', cracks[k] % SW, (cracks[k] / SW) | 0, { leak: rng.range(0, 0.25), leakRate: rng.range(0.0045, 0.008) * (0.8 + 0.2 * sim.tune.hazardMul) });
  const nd = rng.int(2, 3);
  for (let k = 0; k < nd; k++) { const p = freeNear(s, tipX + rng.int(-3, 1), rng.int(17, 19)); addProp(s, 'roadDebris', p.x, p.y, { hp: 4 }); }
  s.exits = [{ x: gx, y: F.y1 + 1 }, { x: F.x0 - 1, y: gy }];
  s.spots = [{ x: gx, y: F.y1 + 2, exit: 0, taken: -1 }, { x: gx + 1, y: F.y1 + 2, exit: 0, taken: -1 }, { x: F.x0 - 2, y: gy, exit: 1, taken: -1 }];
  s.staging = { x: 3, y: 17 }; s.safe = { x: 3, y: 14 }; s.vantage = { x: gx, y: F.y1 + 2 };
  s.leadDept = 'fire';
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
