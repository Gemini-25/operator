// 대형 사고의 현장 (docs/specs/N5-major.md)
// registerScene('유형', '변형', (sim, I, rng) => Scene) 으로 등록한다. 만드는 도구는 ../kit, ../plans, ../builders 에서 가져온다.
// 모두 지금 있는 규칙(구출·처치·이송·진압·수난 구조·도로 정리) 위에서 규모만 키운다: 사람이 탄 탈것은 vehicle 소품이고 그 둘레가 wreck 구역이다.

import type { Sim } from '../../engine';
import type { Rng } from '../../rng';
import { DECOR, T } from '../../types';
import type { Incident, Mobility, Prop, Region, Scene } from '../../types';
import { buildCollapse } from '../builders';
import { tidx } from '../grid';
import { SH, SW, addCas, addProp, addRegion, baseScene, freeTileIn, furnish, get, set } from '../kit';
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

// ───────────────────────── 비행기 추락 ─────────────────────────
// 건물 없는 들판. 동체는 세 토막(꼬리·가운데·기수)으로 끊겨 있고, 찢겨 나간 날개에서 샌 연료가 타고 있다.
// 가운데 토막에서는 연료가 계속 새어, 조치하지 않으면 동체에도 불이 붙는다. 한두 명은 들판 가장자리까지 튕겨 나갔다.
registerScene('fire', 'plane', (sim, I, rng) => {
  const s = baseScene(sim, I, rng);
  for (let y = 17; y < SH; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.ROAD);
  // 들판 가장자리의 나무: 북쪽 끝과 동쪽 끝
  for (let k = 0; k < 26; k++) {
    const north = rng.chance(0.55), x = north ? rng.int(2, SW - 1) : rng.int(26, SW - 1), y = north ? rng.int(0, 2) : rng.int(2, 15);
    set(s, x, y, T.TREE);
  }
  s.staging = { x: 3, y: 17 }; s.safe = { x: 3, y: 14 }; s.vantage = { x: 7, y: 12 };
  addProp(s, 'hydrant', 27, 16, {});
  // 동체 세 토막: 서쪽에서 미끄러져 들어와 꼬리부터 떨어져 나갔다
  const Y0 = rng.int(6, 9);
  const part = (x: number, y: number, w: number, skin: string, name: string, angle: number): Prop => {
    const p = addProp(s, 'vehicle', x, y, { w, h: 1, blocking: true, hp: 10, leak: 0, leakRate: 0, occupants: [], angle, color: 5, bus: true, skin });
    addRegion(s, name, 'wreck', x - 1, y - 1, x + w, y + 1, false, true);
    return p;
  };
  const tail = part(rng.int(5, 6), Y0 + rng.int(-1, 1), 3, 'fuselageTail', '동체 꼬리', rng.range(-0.45, 0.45));
  const mid = part(rng.int(11, 13), Y0 + rng.int(-1, 1), 3, 'fuselageMid', '동체 가운데', rng.range(-0.18, 0.18));
  const nose = part(rng.int(18, 20), Y0 + rng.int(-2, 2), 2, 'fuselageNose', '동체 기수', rng.range(-0.5, 0.5));
  const parts = [tail, mid, nose];
  // 날개에서 샌 연료가 타는 자리: 가운데 토막에서 두 칸 떨어진 두 줄
  const side = mid.y < 7 ? 1 : rng.pick([-1, 1]);
  const wy0 = Math.min(mid.y + side * 3, mid.y + side * 4), wy1 = Math.max(mid.y + side * 3, mid.y + side * 4);
  // (신고자가 "어느 쪽에 사람이 있다"고 말할 때 방 종류의 구역을 고르므로, 화재 유형의 현장에는 방 종류가 하나는 있어야 한다)
  const wing = addRegion(s, '불붙은 날개', 'room', mid.x - 1, wy0, mid.x + 3, wy1, false, false);
  const pool = rng.shuffle(wing.tiles.slice()).slice(0, rng.int(6, 10));
  for (const i of pool) { s.tiles[i] = T.GROUND; s.fuel[i] = 1; s.fire[i] = rng.range(0.5, 0.8); }
  mid.leak = 0.05; mid.leakRate = rng.range(0.004, 0.006);
  const vN = addRegion(s, '북쪽 풀숲', 'verge', 2, 0, SW - 1, 2, false, true);
  const vE = addRegion(s, '동쪽 풀숲', 'verge', 25, 3, SW - 1, 15, false, true);
  // 탑승자 10~14명: 안에 갇힌 4~5, 안팎의 중상 4~5(그중 한두 명은 가장자리로 튕겨 나갔다), 걸어 나온 경상 2~4
  const nT = rng.int(4, 5), nI = rng.int(4, 5), nM = rng.int(2, 4), nE = rng.int(1, 2);
  const seat = [0, 0, 0];
  const off = rng.int(0, 2);
  for (let k = 0; k < nT; k++) { const q = (k + off) % 3; rider(s, rng, parts[q], seat[q]++, 'trapped', 0, 0, 1); }
  for (let k = 0; k < nI; k++) {
    const q = (k + off + 1) % 3, w = parts[q];
    if (k < nE) {
      // 튕겨 나간 사람: 풀숲에 가려 잘 보이지 않는다
      const v = k % 2 ? vE : vN;
      const i = freeTileInGround(s, v, rng);
      set(s, i % SW, (i / SW) | 0, T.TREE);
      addCas(s, i % SW, (i / SW) | 0, 'immobile', rng.range(44, 68), rng.range(0.1, 0.19), rng.range(0.55, 0.7));
    } else if (k % 2) rider(s, rng, w, seat[q]++, 'immobile', 0, 0, 0.9);
    else { const p = freeNear(s, w.x + rng.int(0, w.w - 1), w.y + rng.pick([-1, 1])); addCas(s, p.x, p.y, 'immobile', rng.range(50, 80), rng.range(0.08, 0.17), 0.1); }
  }
  for (let k = 0; k < nM; k++) { const w = parts[(k + off + 2) % 3]; const p = freeNear(s, w.x + rng.int(-1, w.w), w.y - side * 2); rider(s, rng, w, 0, 'mobile', p.x, p.y, 1); }
  // 길 쪽으로 흩어진 잔해
  const nd = rng.int(3, 5);
  for (let k = 0; k < nd; k++) { const p = freeNear(s, rng.int(9, 26), rng.int(13, 17)); addProp(s, 'roadDebris', p.x, p.y, { hp: 4, skin: 'planeDebris', angle: rng.range(0, 6.28), color: k }); }
  // 탈 수 있는 것: 불붙은 연료와 동체 둘레 (재산 피해의 분모)
  s.totalFuelTiles = pool.length;
  for (const r of s.regions) if (r.kind === 'wreck') s.totalFuelTiles += r.tiles.length;
  s.leadDept = 'fire';
  return s;
});

/** 구역 안의 빈 땅 한 칸 (소품과 사람이 없는 곳) */
function freeTileInGround(s: Scene, r: Region, rng: Rng): number {
  const c = r.tiles.filter((i) => (s.tiles[i] === T.GROUND || s.tiles[i] === T.TREE) && s.propAt[i] < 0 && !s.casualties.some((q) => tidx(s, Math.round(q.x), Math.round(q.y)) === i));
  return c.length ? rng.pick(c) : r.tiles[0];
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
  for (let k = 0; k < inAuto; k++) rider(s, rng, auto, k, rng.chance(0.5) ? 'trapped' : 'immobile', 0, 0, 0.9);
  const nT = rng.int(3, 4), nI = Math.min(rng.int(4, 5), riders - nT);
  const kinds: ('trapped' | 'immobile' | 'mobile')[] = [];
  for (let k = 0; k < riders; k++) kinds.push(k < nT ? 'trapped' : k < nT + nI ? 'immobile' : 'mobile');
  const seat = cars.map(() => 0), weight = cars.map((c) => (c === lead ? 2.2 : 1));      // 넘어진 선두 객차에 사람이 가장 많다
  for (const kind of kinds) {
    const q = rng.weighted(cars.map((_, i) => i), weight), w = cars[q], k = seat[q]++;
    const out = w.w >= w.h ? freeNear(s, w.x + (k % 3), w.y + rng.pick([-1, 1])) : freeNear(s, w.x + rng.pick([-2, 2]), w.y + (k % 3));
    rider(s, rng, w, k, kind, out.x, out.y, 0.88);
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
  addRegion(s, '공사장 앞 길', 'zone', 0, 14, SW - 1, 16, false, true);      // 팔 끝이 떨어진 길 쪽도 살핀다
  const boom: Prop[] = [];
  for (let k = 1; k <= n; k++) {
    const x = mast.x + k, y = mast.y + k, i = tidx(s, x, y);
    if (s.tiles[i] === T.WALL) s.tiles[i] = T.GROUND;      // 팔에 눌려 넘어간 울타리
    s.damage[i] = 1;
    boom.push(addProp(s, 'debris', x, y, { blocking: true, hp: rng.range(12, 21), skin: 'craneBoom', angle: Math.PI / 4, color: k === n ? 99 : k }));      // color: 기초에서 몇 번째 토막인가 (99 = 끝)
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
    const c = addCas(s, i % SW, (i / SW) | 0, 'trapped', rng.range(42, 74), rng.range(0.13, 0.25), rng.range(0.3, 0.5));
    c.trapWork = rng.range(20, 30);      // 쇠 트러스에 깔렸다: 잔해보다 오래 걸린다
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
      rider(s, rng, w, k, roll < 0.3 ? 'trapped' : roll < 0.65 ? 'immobile' : 'mobile', w.x + (k % 3) + rng.int(-1, 1), w.y === 9 ? 7 : 12, 0.88);
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

// ───────────────────────── 선박 화재 ─────────────────────────
// 위쪽은 부두, 아래 일곱 줄은 바다. 배는 벽과 바닥으로 된 건물이고(기관실·선실·조타실) 두 칸 폭의 건널판으로 부두와 이어진다.
// 기관실에서 불이 났고, 바다로 뛰어든 선원들은 부두와 배 사이의 물에 떠 있다 (표류 규칙이 함께 돈다. 부두에서 줄을 던져 끌어낸다).
registerScene('fire', 'ship', (sim, I, rng) => {
  const s = baseScene(sim, I, rng);
  for (let y = 0; y <= 2; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.ROAD);
  for (let y = 13; y < SH; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.WATER);
  for (let y = 13; y <= 15; y++) for (let x = 26; x < SW; x++) set(s, x, y, T.GROUND);      // 꺾인 안벽: 떠내려가던 사람이 여기에 걸린다
  s.floorMat = 2;
  s.staging = { x: 3, y: 2 }; s.safe = { x: 3, y: 5 };
  const H = { x0: 4, y0: 14, x1: 21, y1: 18 };      // 선체 (벽 포함)
  const four = rng.chance(0.5);
  const cuts = four ? [9, 13, 17] : [10, 16];      // 칸막이벽
  const names = four ? ['기관실', '선실', '선원 식당', '조타실'] : ['기관실', '선실', '조타실'];
  const bounds = [H.x0, ...cuts, H.x1];
  const gx = rng.int(bounds[1] + 1, bounds[2] - 2);      // 건널판(두 칸)은 선실로 이어진다
  // 선체 윤곽은 막지 않는 장식이다 (그림만: view/scene/skins/major.ts 의 shipHull). color 는 건널판이 걸린 자리(선체 왼쪽 끝에서 몇 칸째)
  addProp(s, 'cover', H.x0, H.y0, { w: H.x1 - H.x0 + 1, h: H.y1 - H.y0 + 1, blocking: false, skin: 'shipHull', color: gx - H.x0 });
  for (let y = H.y0; y <= H.y1; y++) for (let x = H.x0; x <= H.x1; x++) set(s, x, y, x === H.x0 || x === H.x1 || y === H.y0 || y === H.y1 ? T.WALL : T.FLOOR);
  for (const cx of cuts) for (let y = H.y0 + 1; y < H.y1; y++) set(s, cx, y, T.WALL);
  const rooms: Region[] = names.map((nm, q) => addRegion(s, nm, 'room', bounds[q] + 1, H.y0 + 1, bounds[q + 1] - 1, H.y1 - 1, true, true));
  const door = (x: number, y: number, r: Region, open: boolean): Prop => {
    set(s, x, y, T.DOOR);
    const p = addProp(s, 'door', x, y, { open, locked: false });
    const i = tidx(s, x, y); s.region[i] = r.id; r.tiles.push(i);
    return p;
  };
  cuts.forEach((cx, q) => door(cx, rng.int(H.y0 + 1, H.y1 - 1), rooms[q + 1], q === 0 || rng.chance(0.4)));      // 기관실 문은 열려 있다 (불이 빨리 번진다)
  const engine = rooms[0], cabin = rooms[1];
  door(gx, H.y0, cabin, true); door(gx + 1, H.y0, cabin, true);
  set(s, gx, 13, T.FLOOR); set(s, gx + 1, 13, T.FLOOR);
  addRegion(s, '건널판', 'corridor', gx, 13, gx + 1, 13, true, false);
  addRegion(s, '부두', 'zone', 0, 3, SW - 1, 12, false, true);
  // 둥근 창: 방마다 양쪽 뱃전 한가운데, 조타실은 뱃머리 쪽에도
  for (const r of rooms) for (const wy of [H.y0, H.y1]) {
    const wx = Math.round((r.x0 + r.x1) / 2);
    if (get(s, wx, wy) === T.WALL && get(s, wx - 1, wy) !== T.DOOR && get(s, wx + 1, wy) !== T.DOOR) set(s, wx, wy, T.WINDOW);
  }
  set(s, H.x1, 16, T.WINDOW);
  // 탈 것: 선실 바닥과 가구. 건널판은 타지 않는다
  for (const r of rooms) for (const i of r.tiles) s.fuel[i] = s.tiles[i] === T.DOOR ? 0.3 : rng.range(0.55, 1.0);
  const KINDS: Record<string, number[]> = { 기관실: [DECOR.MACHINE, DECOR.MACHINE, DECOR.CABINET, DECOR.CRATE], 선실: [DECOR.BED, DECOR.BED, DECOR.CABINET], '선원 식당': [DECOR.TABLE, DECOR.COUNTER, DECOR.KITCHEN], 조타실: [DECOR.DESK, DECOR.CABINET, DECOR.DESK] };
  for (const r of rooms) furnish(s, rng, r, KINDS[r.name], r === engine ? 3 : 2, false);
  for (let i = 0; i < s.tiles.length; i++) if (s.tiles[i] === T.FURN) s.fuel[i] = 1;
  for (let i = 0; i < s.fuel.length; i++) if (s.fuel[i] > 0) s.totalFuelTiles++;
  // 발화: 기관실
  const seeds = rng.int(2, 3);
  for (let k = 0; k < seeds; k++) { const i = freeTileIn(s, engine, rng); s.fire[i] = rng.range(0.45, 0.7); }
  // 선원 5~8명: 배 안에 3~4 (연기 속), 바다에 2~3, 부두로 빠져나온 사람이 있을 수도 있다
  const nIn = rng.int(3, 4), nW = rng.int(2, 3), nOut = rng.int(0, 1);
  const nearFire = (q: number): boolean => { for (let f = 0; f < s.fire.length; f++) if (s.fire[f] > 0 && Math.hypot((f % SW) - (q % SW), ((f / SW) | 0) - ((q / SW) | 0)) < 2.5) return true; return false; };
  for (let k = 0; k < nIn; k++) {
    const r = rng.chance(0.85) ? rng.pick(rooms.slice(1)) : engine;
    const i = freeTileIn(s, r, rng, nearFire);
    const roll = rng.next();
    const mob: Mobility = roll < 0.4 ? 'mobile' : roll < 0.8 ? 'immobile' : 'trapped';
    addCas(s, i % SW, (i / SW) | 0, mob, mob === 'mobile' ? rng.range(78, 100) : rng.range(55, 85), mob === 'mobile' ? 0.03 : rng.range(0.07, 0.19), mob === 'trapped' ? rng.range(0.35, 0.55) : rng.range(0.1, 0.5));
  }
  const taken: number[] = [];
  for (let k = 0; k < nW; k++) {
    let x = rng.chance(0.5) ? rng.int(2, gx - 2) : rng.int(gx + 3, 17);
    while (taken.indexOf(x) >= 0) x = x < gx ? Math.max(1, x - 1) : x + 1;
    taken.push(x);
    const c = addCas(s, x, 13, 'trapped', rng.range(62, 90), rng.range(0.17, 0.27) * (sim.weather === 'clear' ? 1 : 1.12), 0.1, { inWater: true, drift: rng.range(0.05, 0.12) });
    c.trapWork = 0;
  }
  for (let k = 0; k < nOut; k++) { const p = freeNear(s, gx + rng.int(-2, 3), 11); addCas(s, p.x, p.y, 'mobile', rng.range(76, 96), rng.range(0, 0.04), 0); }
  addProp(s, 'hydrant', 26, 3, {});
  s.exits = [{ x: gx, y: 12 }];
  s.spots = [{ x: gx, y: 11, exit: 0, taken: -1 }, { x: gx + 1, y: 11, exit: 0, taken: -1 }, { x: gx - 3, y: 11, exit: -1, taken: -1 }];
  s.vantage = { x: gx, y: 10 };
  s.rules = ['water'];
  s.leadDept = 'fire';
  return s;
});
