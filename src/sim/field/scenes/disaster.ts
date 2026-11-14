// 재난에 딸린 현장 (docs/specs/N6-disaster.md)
// registerScene('유형', '변형', (sim, I, rng) => Scene) 으로 등록한다. 만드는 도구는 ../kit, ../plans, ../builders 에서 가져온다.
//   fire/wild            산불 현장: 숲 다섯 구역과 오두막 한 채. 나무와 풀이 탄다
//   collapse/landslide   산사태: 길을 덮은 흙더미와 그 밑에 묻힌 차
//   water/evac           해안 대피: 해일이 닿기 전에 모래밭과 부두의 사람들을 뭍으로 옮긴다 (닿으면 ../rules/disaster.ts 가 물에 잠근다)

import type { Sim } from '../../engine';
import type { Rng } from '../../rng';
import { DECOR, T } from '../../types';
import type { Incident, Mobility, Prop, Region, Scene } from '../../types';
import { tidx } from '../grid';
import { SH, SW, addCas, addProp, addRegion, baseScene, freeTileIn, furnish, get, set } from '../kit';
import { suiteRooms } from '../plans';
import { registerScene } from '../sceneRegistry';

// ───────────────────────── 산불 현장 ─────────────────────────
/**
 * 숲 한가운데의 오두막(펜션·관리동)과 그 둘레의 숲. 나무와 풀에는 탈 것(fuel)이 있고, 동쪽이나 북쪽 가장자리에서 불이 내려온다.
 * 숲길(T.TRAIL)과 마당에는 탈 것이 없어 불이 건너지 못한다.
 */
function buildWild(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  const sev = I.truth.severity, pk = I.truth.placeKind;
  for (let y = 17; y < SH; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.ROAD);
  s.staging = { x: 3, y: 17 }; s.safe = { x: 3, y: 14 }; s.vantage = { x: 6, y: 13 };
  // 오두막: 방 2~3개
  const f = { x0: rng.int(8, 9), y0: 8, x1: 0, y1: 13 };
  f.x1 = f.x0 + (rng.chance(0.45) ? 12 : rng.int(8, 9));
  for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) set(s, x, y, x === f.x0 || x === f.x1 || y === f.y0 || y === f.y1 ? T.WALL : T.FLOOR);
  const made = suiteRooms(s, rng, f, pk === 'pension' ? '객실' : pk === 'farmhouse' ? '방' : '관리동');
  const rooms = made.rooms;
  const doorCands: number[] = [];
  for (let x = f.x0 + 2; x <= f.x1 - 2; x++) if (get(s, x, f.y1 - 1) === T.FLOOR && get(s, x - 1, f.y1) === T.WALL && get(s, x + 1, f.y1) === T.WALL) doorCands.push(x);
  const fx = doorCands.length ? rng.pick(doorCands) : Math.round((f.x0 + f.x1) / 2);
  set(s, fx, f.y1, T.DOOR); addProp(s, 'door', fx, f.y1, { open: false, locked: false });
  { const inId = s.region[tidx(s, fx, f.y1 - 1)]; if (inId >= 0) { const i = tidx(s, fx, f.y1); s.region[i] = inId; s.regions[inId].tiles.push(i); } }
  s.exits.push({ x: fx, y: f.y1 + 1 });
  for (const r of rooms) { const wx = Math.round((r.x0 + r.x1) / 2); if (get(s, wx, f.y0) === T.WALL) set(s, wx, f.y0, T.WINDOW); }
  for (const r of rooms) furnish(s, rng, r, [DECOR.BED, DECOR.CABINET, DECOR.TABLE, DECOR.SOFA], 2, true);
  // 비워 두는 자리: 대기 지점과 안전 구역 둘레, 길가, 오두막 둘레와 마당
  const clear = (x: number, y: number): boolean => y >= 16 || (x <= 7 && y >= 12) || (x >= f.x0 - 1 && x <= f.x1 + 1 && y > f.y1 && y <= f.y1 + 2) || (x === f.x0 - 1 && y >= f.y0 && y <= f.y1);
  // 숲
  const blobs = rng.int(12, 16);
  for (let k = 0; k < blobs; k++) {
    const bx = rng.int(1, SW - 2), by = rng.int(0, 15), rr = rng.range(1.2, 2.8);
    for (let y = 0; y < 16; y++) for (let x = 0; x < SW; x++) if (Math.hypot(x - bx, y - by) <= rr && rng.chance(0.75) && get(s, x, y) === T.GROUND && !clear(x, y)) set(s, x, y, T.TREE);
  }
  for (let k = 0; k < 3; k++) { const x = rng.int(8, SW - 2), y = rng.int(1, 6); if (get(s, x, y) === T.GROUND) set(s, x, y, T.ROCK); }
  // 숲길: 대기 지점에서 북쪽으로 올라가 동쪽으로 꺾인다 (끝은 숲 속에서 끊긴다)
  const tx = rng.int(3, 5), ty = rng.int(3, 5), tend = rng.int(18, 23);
  const trail: number[] = [];
  for (let y = 12; y >= ty; y--) { set(s, tx, y, T.TRAIL); trail.push(tidx(s, tx, y)); }
  for (let x = tx + 1; x <= tend; x++) { set(s, x, ty, T.TRAIL); trail.push(tidx(s, x, ty)); }
  // 구역: 북쪽 숲 셋, 오두막의 서쪽과 동쪽, 마당
  const own = (r: Region): Region => { r.tiles = r.tiles.filter((i) => s.region[i] === r.id); return r; };
  const zA = own(addRegion(s, 'A구역', 'zone', 0, 0, 9, 7, false, true));
  const zB = own(addRegion(s, 'B구역', 'zone', 10, 0, 19, 7, false, true));
  const zC = own(addRegion(s, 'C구역', 'zone', 20, 0, SW - 1, 7, false, true));
  const zD = own(addRegion(s, 'D구역', 'zone', 0, 8, f.x0 - 1, 15, false, true));
  const zE = own(addRegion(s, 'E구역', 'zone', f.x1 + 1, 8, SW - 1, 15, false, true));
  own(addRegion(s, '마당', 'zone', f.x0, f.y1 + 1, f.x1, 15, false, false));
  // 탈 것: 나무는 잘 타고, 풀밭은 듬성듬성 탄다. 오두막 안은 건물 화재와 같다
  for (let y = 0; y < 16; y++) for (let x = 0; x < SW; x++) {
    const i = tidx(s, x, y), t = s.tiles[i];
    if (t === T.FLOOR) s.fuel[i] = rng.range(0.45, 0.8);
    else if (t === T.DOOR) s.fuel[i] = 0.3;
    else if (clear(x, y)) continue;
    else if (t === T.TREE) s.fuel[i] = rng.range(0.6, 1.0);
    else if (t === T.GROUND && rng.chance(0.6)) s.fuel[i] = rng.range(0.3, 0.55);
  }
  for (let i = 0; i < s.fuel.length; i++) if (s.fuel[i] > 0) s.totalFuelTiles++;
  // 불: 동쪽이나 북쪽 가장자리 구역의 바깥쪽 끝에서 시작한다
  const origin = rng.weighted([zC, zE, zB], [0.45, 0.3, 0.25]);
  const edge = (i: number): number => (origin === zB ? (i / SW) | 0 : SW - 1 - (i % SW));      // 가장자리까지의 거리
  let burnable = origin.tiles.filter((i) => s.fuel[i] > 0);
  if (burnable.length < 4) { for (const i of origin.tiles) if (s.tiles[i] === T.GROUND || s.tiles[i] === T.TREE) { s.fuel[i] = Math.max(s.fuel[i], 0.4); } burnable = origin.tiles.filter((i) => s.fuel[i] > 0); s.totalFuelTiles = 0; for (let i = 0; i < s.fuel.length; i++) if (s.fuel[i] > 0) s.totalFuelTiles++; }
  burnable.sort((a, b) => edge(a) - edge(b) || a - b);
  const seeds = sev >= 3 ? 5 : rng.int(3, 4), pool = burnable.slice(0, 9), lit: number[] = [];
  for (let k = 0; k < seeds && pool.length; k++) { const i = pool.splice(rng.int(0, pool.length - 1), 1)[0]; s.fire[i] = rng.range(0.6, 0.8); lit.push(i); }
  const farFromFire = (i: number, lim: number): boolean => lit.every((q) => Math.hypot((q % SW) - (i % SW), ((q / SW) | 0) - ((i / SW) | 0)) >= lim);
  // 사람: 오두막 안에 1~2명, 숲길과 숲에 1~2명
  const inside = sev >= 3 ? rng.int(1, 2) : 1;
  for (let k = 0; k < inside; k++) {
    const i = freeTileIn(s, rng.pick(rooms), rng);
    const mob: Mobility = rng.chance(0.55) ? 'mobile' : 'immobile';
    addCas(s, i % SW, (i / SW) | 0, mob, mob === 'mobile' ? rng.range(80, 98) : rng.range(56, 82), mob === 'mobile' ? 0.02 : rng.range(0.06, 0.13), rng.range(0.1, 0.4));
  }
  const outside = rng.int(1, 2);
  const taken = (i: number): boolean => s.casualties.some((c) => c.x === i % SW && c.y === ((i / SW) | 0));
  for (let k = 0; k < outside; k++) {
    // 숲길 위가 먼저, 없으면 불에서 먼 숲
    let cands = trail.filter((i) => farFromFire(i, 10) && !taken(i) && ((i / SW) | 0) <= 10);
    if (!cands.length || rng.chance(0.35)) { const zs = [zA, zB, zD].filter((z) => z !== origin); cands = rng.pick(zs).tiles.filter((i) => farFromFire(i, 10) && !taken(i) && !clear(i % SW, (i / SW) | 0)); }
    if (!cands.length) continue;
    const i = rng.pick(cands);
    const mob: Mobility = rng.chance(0.5) ? 'mobile' : 'immobile';
    addCas(s, i % SW, (i / SW) | 0, mob, mob === 'mobile' ? rng.range(78, 96) : rng.range(54, 80), mob === 'mobile' ? 0.02 : rng.range(0.07, 0.15), rng.range(0.15, 0.45) + (s.tiles[i] === T.TREE ? 0.1 : 0));
  }
  addProp(s, 'hydrant', 27, 16, {});      // 길가의 산불 진화용 급수전
  s.leadDept = 'fire';
  return s;
}

// ───────────────────────── 산사태 ─────────────────────────
/**
 * 산자락의 길. 북쪽 비탈에서 쏟아진 흙더미(잔해 소품, 모습은 'mud')가 길을 덮었고, 그 밑에 차가 묻혀 있다.
 * 흙더미는 치울 수 있는 장애물이다: 묻힌 차에 닿으려면 파내고 들어가야 한다. 길이 끊겨 지나가는 차는 없다.
 */
function buildLandslide(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  const sev = I.truth.severity;
  for (let y = 8; y <= 11; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.ROAD);
  const tree = (x: number, y: number): void => { if (x >= 0 && x < SW && y >= 0 && y < SH && get(s, x, y) === T.GROUND) set(s, x, y, T.TREE); };
  // 비탈(북쪽)은 숲이 짙다
  for (let k = 0; k < 26; k++) { const bx = rng.int(0, SW - 1), by = rng.chance(0.7) ? rng.int(0, 5) : rng.int(14, SH - 1); tree(bx, by); if (rng.chance(0.6)) tree(bx + 1, by); if (rng.chance(0.4) && by >= 1 && by <= 5) tree(bx, by - 1); }
  s.staging = { x: 3, y: 13 }; s.safe = { x: 6, y: 14 }; s.vantage = { x: 8, y: 12 };
  for (const [x, y] of [[3, 13], [6, 14], [5, 14], [7, 14], [6, 15], [8, 12]]) set(s, x, y, T.GROUND);
  // 흙더미가 쓸고 내려온 자리: 나무가 쓸려 나가고 흙과 돌이 깔렸다
  const X0 = rng.int(11, 14), X1 = X0 + rng.int(6, 8);
  for (let y = 0; y <= 12; y++) for (let x = X0; x <= X1; x++) {
    const i = tidx(s, x, y), inner = x > X0 && x < X1;
    if (y <= 7 && s.tiles[i] === T.TREE && (inner || rng.chance(0.5))) s.tiles[i] = T.GROUND;
    if (inner || rng.chance(0.5)) s.damage[i] = 1;
  }
  // 묻힌 차
  const nCar = sev >= 3 || rng.chance(0.4) ? 2 : 1;
  const cars: Prop[] = [];
  for (let k = 0; k < nCar; k++) {
    const y = k === 0 ? rng.pick([9, 10]) : cars[0].y === 9 ? 10 : 9;
    const x = k === 0 ? rng.int(X0 + 1, X0 + 2) : rng.int(X1 - 3, X1 - 2);
    const p = addProp(s, 'vehicle', x, y, { w: 2, h: 1, blocking: true, hp: 10, leak: 0, leakRate: 0, occupants: [], angle: rng.range(-0.5, 0.5), color: rng.int(0, 4) });
    cars.push(p);
    addRegion(s, nCar > 1 ? `묻힌 차량 ${k + 1}` : '묻힌 차량', 'wreck', p.x - 1, y - 1, p.x + p.w, y + 1, false, true);
    const n = sev >= 3 ? rng.int(1, 2) : rng.chance(0.35) ? 2 : 1;
    for (let j = 0; j < n; j++) {
      const trapped = rng.chance(0.8);
      const c = addCas(s, p.x + (j % 2), y, trapped ? 'trapped' : 'immobile', rng.range(46, 78), rng.range(0.1, 0.2), 0.35, { inVehicle: p.id });
      if (trapped) c.trapWork = rng.range(14, 22);
      p.occupants!.push(c.id);
    }
  }
  // 비탈에서 굴러 내려온 바위
  for (let k = 0, n = rng.int(3, 4); k < n; k++) { const x = rng.int(X0, X1), y = rng.int(2, 6); if (get(s, x, y) === T.GROUND) set(s, x, y, T.ROCK); }
  // 흙더미: 묻힌 차를 빙 둘러 덮고(파내야 닿는다), 나머지는 길 위와 길가에 흩어진다
  const mud = (i: number): void => { addProp(s, 'debris', i % SW, (i / SW) | 0, { blocking: true, hp: rng.range(9, 14), skin: 'mud' }); };
  let ring = 0;
  for (const p of cars) for (let y = p.y - 1; y <= p.y + 1; y++) for (let x = p.x - 1; x <= p.x + p.w; x++) { const i = tidx(s, x, y); if (s.propAt[i] < 0) { mud(i); ring++; } }
  const cand: number[] = [];
  for (let y = 6; y <= 12; y++) for (let x = X0; x <= X1; x++) {
    const i = tidx(s, x, y);
    if (s.propAt[i] >= 0 || s.tiles[i] === T.ROCK) continue;
    if ((x === X0 || x === X1 || y === 6 || y === 12) && rng.chance(0.6)) continue;      // 가장자리는 듬성듬성
    cand.push(i);
  }
  rng.shuffle(cand);
  const nMud = Math.max(0, rng.int(8, 12) - ring) + rng.int(1, 3);
  for (const i of cand.slice(0, nMud)) mud(i);
  const open = cand.slice(nMud).filter((i) => s.propAt[i] < 0);
  // 길을 걷다 흙에 묻힌 사람, 빠져나온 운전자
  if (open.length && rng.chance(0.35)) { const i = rng.pick(open); const c = addCas(s, i % SW, (i / SW) | 0, 'trapped', rng.range(48, 76), rng.range(0.1, 0.18), rng.range(0.45, 0.6)); c.trapWork = rng.range(12, 18); }
  if (rng.chance(0.5)) addCas(s, X0 - 2, 12, 'mobile', rng.range(80, 96), rng.range(0, 0.02), 0);
  addRegion(s, '토사 더미', 'zone', X0 - 1, 5, X1 + 1, 12, false, true);
  addRegion(s, '남측 길가', 'verge', 5, 13, 24, 16, false, true);
  addRegion(s, '북측 비탈', 'zone', 0, 0, SW - 1, 4, false, false);
  s.placeName = '산사태 현장';
  s.leadDept = 'fire';
  return s;
}

// ───────────────────────── 해안 대피 ─────────────────────────
/** 해안 대피 현장의 줄: 모래밭이 시작되는 줄, 바다가 시작되는 줄 */
const SAND = 8, SEA = 15;
/**
 * 위쪽은 길과 산책로(뭍), 가운데는 모래밭, 아래 다섯 줄은 바다. 부두 하나가 바다로 뻗어 있다.
 * 사람들은 모두 아직 뭍에 있다. 발견되면 걸어서 나가고, 못 걷는 사람은 옮겨야 한다.
 * 해일이 닿으면 물가 쪽 절반이 잠기고, 그때까지 남아 있던 사람은 물에 휩쓸린다 (../rules/disaster.ts).
 */
function buildEvac(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  const sev = I.truth.severity;
  for (let y = 0; y <= 2; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.ROAD);
  for (let y = SEA; y < SH; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.WATER);
  for (let y = SAND; y < SEA; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.TRAIL);      // 모래밭 (맨땅)
  s.staging = { x: 3, y: 2 }; s.safe = { x: 4, y: 4 }; s.vantage = { x: 9, y: 5 };
  // 산책로의 나무
  for (let k = 0; k < 9; k++) { const x = rng.int(9, SW - 1), y = rng.int(3, SAND - 2); if (get(s, x, y) === T.GROUND && !(Math.abs(x - 9) <= 1 && y === 5)) set(s, x, y, T.TREE); }
  // 부두: 바다로 뻗은 한 줄
  const px = rng.int(18, 24);
  const pier: number[] = [];
  for (let y = SEA; y <= SH - 2; y++) { set(s, px, y, T.TRAIL); pier.push(tidx(s, px, y)); }
  addRegion(s, '서쪽 모래밭', 'zone', 0, SAND - 2, 14, SH - 2, false, true);
  addRegion(s, '동쪽 모래밭', 'zone', 15, SAND - 2, SW - 1, SH - 2, false, true);
  addRegion(s, '산책로', 'zone', 0, 3, SW - 1, SAND - 3, false, false);
  // 사람들: 대부분 걸을 수 있고, 한두 명은 못 걷는다 (부두 끝의 어르신)
  const n = sev >= 3 ? rng.int(8, 10) : rng.int(6, 8), frail = rng.int(1, 2);
  const used = new Set<number>();
  const spot = (pool: number[]): number => { for (let k = 0; k < 30; k++) { const i = rng.pick(pool); if (!used.has(i)) { used.add(i); return i; } } return -1; };
  const sand: number[] = [];
  for (let y = SAND + 1; y < SEA; y++) for (let x = 2; x < SW - 2; x++) sand.push(tidx(s, x, y));
  for (let k = 0; k < n; k++) {
    const weak = k < frail;
    const i = spot(weak && rng.chance(0.6) ? pier : k % 4 === 3 ? pier : sand);
    if (i < 0) continue;
    if (weak) addCas(s, i % SW, (i / SW) | 0, 'immobile', rng.range(62, 84), rng.range(0.02, 0.05), 0.05);
    else addCas(s, i % SW, (i / SW) | 0, 'mobile', rng.range(84, 100), rng.range(0, 0.015), rng.range(0, 0.15));
  }
  s.rules = ['water'];
  s.leadDept = 'police';
  return s;
}

registerScene('fire', 'wild', buildWild);
registerScene('collapse', 'landslide', buildLandslide);
registerScene('water', 'evac', buildEvac);
