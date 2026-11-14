// FieldSceneManager (생성부) — 사건마다 작은 독립 2D 현장 공간을 만든다.
// 여기서 만들어지는 것은 "진실"이다. AI 는 현장에서 관찰하기 전까지 이 내용을 모른다.

import type { Sim } from '../engine';
import type { Rng } from '../rng';
import { DECOR, T } from '../types';
import type { District, Incident, Mobility, PlaceKind, Prop, Region, Scene } from '../types';
import { staticPass, tidx } from './grid';
import { SH, SW, addCas, addHostile, addProp, addRegion, baseScene, freeTileIn, furnish, get, set } from './kit';
import { KIND_SCENE } from '../cityPlan';
import { blockPassage, lockDoor, planBuilding, suiteRooms, tallPlan } from './plans';
import type { Arch, Plan, PlanOpts } from './plans';

// ───────────────────────── 건물 (화재 · 붕괴 · 가스 누출 공통) ─────────────────────────
/** 건물 종류가 정해져 있으면 그 종류의 틀 비중을, 아니면 구역의 비중을 쓴다 */
function pickArch(rng: Rng, dist: District, kind: PlaceKind | null = null): Arch {
  const ks = kind ? KIND_SCENE[kind] : undefined;
  if (ks) return rng.weighted<Arch>(['corridor', 'suite', 'hall'], ks.arch);
  if (dist === 'industrial') return rng.weighted<Arch>(['hall', 'corridor'], [0.6, 0.4]);
  if (dist === 'commercial') return rng.weighted<Arch>(['hall', 'corridor', 'suite'], [0.4, 0.35, 0.25]);
  return rng.weighted<Arch>(['corridor', 'suite'], [0.45, 0.55]);
}
const KIND_ROOMS: Partial<Record<PlaceKind, [string, string]>> = {
  houseS: ['방', '거실'], houseL: ['방', '거실'], farmhouse: ['방', '마루'], villa: ['호실', '현관 홀'], apartment: ['호', '복도 홀'], officetel: ['호', '로비'], dorm: ['호실', '휴게실'],
  pension: ['객실', '거실'], hotel: ['객실', '로비'], office: ['사무실', '로비'], bank: ['상담실', '로비'], terminal: ['사무실', '대합실'], restaurant: ['룸', '홀'], church: ['교육실', '예배당'],
  market: ['점포', '시장 통로'], mart: ['창고', '매장'], warehouse: ['보관실', '적재장'], hangar: ['정비실', '격납고'], construction: ['작업 구획', '골조 층'],
};
function planOpts(dist: District, kind: PlaceKind | null = null): PlanOpts {
  const o = planOptsOf(dist), names = kind ? KIND_ROOMS[kind] : undefined;
  if (names) { o.prefix = names[0]; o.hallName = names[1]; }
  if (kind === 'office' || kind === 'bank' || kind === 'terminal') { o.kinds = [DECOR.DESK, DECOR.CABINET, DECOR.TABLE, DECOR.PLANT]; o.hallKinds = [DECOR.COUNTER, DECOR.SOFA, DECOR.PLANT, DECOR.DESK]; }
  if (kind === 'restaurant') { o.kinds = [DECOR.TABLE, DECOR.TABLE, DECOR.COUNTER, DECOR.CRATE]; o.hallKinds = [DECOR.TABLE, DECOR.TABLE, DECOR.COUNTER, DECOR.PLANT]; o.racks = false; }
  return o;
}
/** 2층 건물일 확률: 건물 종류가 정해져 있으면 그 종류를 따른다 */
const tallP = (kind: PlaceKind | null, base: number): number => { const ks = kind ? KIND_SCENE[kind] : undefined; return ks ? ks.tall : base; };
function planOptsOf(dist: District): PlanOpts {
  if (dist === 'industrial') return { prefix: '작업실', hallName: '작업장', kinds: [DECOR.MACHINE, DECOR.CRATE, DECOR.CRATE, DECOR.CABINET], hallKinds: [DECOR.MACHINE, DECOR.MACHINE, DECOR.CRATE, DECOR.CRATE], racks: true };
  if (dist === 'commercial') return { prefix: '점포', hallName: '매장', kinds: [DECOR.COUNTER, DECOR.SHELF, DECOR.TABLE, DECOR.CRATE], hallKinds: [DECOR.COUNTER, DECOR.SHELF, DECOR.SHELF, DECOR.PLANT], racks: true };
  return { prefix: dist === 'outskirts' ? '객실' : '호실', hallName: '거실', kinds: [DECOR.BED, DECOR.DESK, DECOR.SOFA, DECOR.CABINET, DECOR.PLANT] };
}
const floorMatOf = (dist: District): number => (dist === 'industrial' ? 2 : dist === 'commercial' ? 1 : 0);
function fuelUp(s: Scene, P: Plan, rng: Rng, lo: number, hi: number, corLo: number, corHi: number, doorFuel: number): void {
  for (const r of P.rooms) for (const i of r.tiles) if (s.fuel[i] === 0) s.fuel[i] = s.tiles[i] === T.DOOR ? doorFuel : rng.range(lo, hi);
  for (const c of P.corridors) for (const i of c.tiles) if (s.fuel[i] === 0) s.fuel[i] = rng.range(corLo, corHi);
  for (let i = 0; i < s.tiles.length; i++) if (s.tiles[i] === T.FURN) s.fuel[i] = 1;
  for (let i = 0; i < s.fuel.length; i++) if (s.fuel[i] > 0) s.totalFuelTiles++;
}
const doorOf = (s: Scene, r: Region): Prop | undefined => s.props.find((p) => p.kind === 'door' && s.region[tidx(s, p.x, p.y)] === r.id);
/** 무전이 잘 닿지 않을 만한 방: 2층이거나, 대기 지점에서 먼 쪽 절반 */
function farRooms(s: Scene, P: Plan): Region[] {
  if (P.floors.length > 1) return P.rooms.filter((r) => r.cx > 16);
  const sorted = [...P.rooms].sort((a, b) => Math.hypot(b.cx - s.staging.x, b.cy - s.staging.y) - Math.hypot(a.cx - s.staging.x, a.cy - s.staging.y));
  return sorted.slice(0, Math.max(1, sorted.length >> 1));
}

// ───────────────────────── 건물 화재 ─────────────────────────
function buildFire(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  const sev = I.truth.severity, dist = I.truth.district, pk = I.truth.placeKind;
  const falseAlarm = I.truth.variant === 'false';      // 오인 신고: 탄 냄새만 나고 불은 없다
  const tall = !falseAlarm && sev >= 2 && rng.chance(tallP(pk, 0.5));      // 2층 여부는 건물 종류가 정한다 (작은 집은 단층, 아파트는 대개 2층 이상)
  const P = tall ? tallPlan(s, rng, planOpts(dist, pk)) : planBuilding(s, rng, pickArch(rng, dist, pk), planOpts(dist, pk));
  s.floorMat = floorMatOf(dist);
  const rooms = P.rooms;
  const hz = (v: number): number => Math.min(0.95, v * sim.tune.hazardMul);
  if (rng.chance(hz(0.45))) lockDoor(s, P.exitDoors[1], rng.range(7, 11));
  fuelUp(s, P, rng, 0.55 * (dist === 'industrial' ? 1.15 : 1), 1.0 * (dist === 'industrial' ? 1.15 : 1), 0.4, 0.56, 0.3);
  // 발화
  const origin = rng.pick(rooms);
  const seeds = falseAlarm ? 0 : sev >= 3 ? 3 : sev >= 2 ? 2 : 1;
  for (let k = 0; k < seeds; k++) { const i = freeTileIn(s, origin, rng); s.fire[i] = rng.range(0.4, 0.6) + sev * 0.09; }
  // 규모가 큰 화재: 발화실 문이 열려 있고(연소 확대가 빠름), 가장 큰 화재는 인접 실에도 이미 불이 붙어 있다
  if (sev >= 2) { const d = doorOf(s, origin); if (d && !d.locked) d.open = true; }
  if (sev >= 3) {
    const near = rooms.filter((q) => q !== origin).sort((a, b) => Math.hypot(a.cx - origin.cx, a.cy - origin.cy) - Math.hypot(b.cx - origin.cx, b.cy - origin.cy))[0];
    const i2 = freeTileIn(s, near, rng); s.fire[i2] = rng.range(0.3, 0.5);
  }
  // 숨겨진 조건
  if (rng.chance(hz(0.24))) blockPassage(s, rng, P, [9, 15]);
  if (rng.chance(hz(0.2))) {
    const d = doorOf(s, rng.pick(rooms.filter((q) => q !== origin)));
    if (d && P.exitDoors.indexOf(d) < 0) lockDoor(s, d, rng.range(5, 9));
  }
  if (!falseAlarm && rng.chance(hz(dist === 'industrial' ? 0.42 : 0.13))) {
    const i = freeTileIn(s, rng.pick(rooms.filter((q) => q !== origin)), rng);
    addProp(s, 'gas', i % SW, (i / SW) | 0, {});
  }
  if (rng.chance(hz(0.6))) for (const i of rng.pick(farRooms(s, P)).tiles) s.shadow[i] = 1;
  // 구조 대상 (2층 건물은 위층에 더 많이 남아 있다)
  const count = falseAlarm ? 0 : sev >= 3 ? rng.int(2, 4) : sev >= 2 ? rng.int(1, 3) : rng.int(0, 1);
  for (let k = 0; k < count; k++) {
    let pool = rooms.filter((q) => q !== origin);
    if (tall) { const up = rng.chance(0.65); const lv = pool.filter((q) => (q.cx > 16) === up); if (lv.length) pool = lv; }
    const r = rng.chance(0.9) && pool.length ? rng.pick(pool) : origin;
    const i = freeTileIn(s, r, rng, (q) => { for (let f = 0; f < s.fire.length; f++) if (s.fire[f] > 0 && Math.hypot((f % SW) - (q % SW), ((f / SW) | 0) - ((q / SW) | 0)) < 2.5) return true; return false; });
    const roll = rng.next();
    const mob: Mobility = roll < 0.4 ? 'mobile' : roll < 0.8 ? 'immobile' : 'trapped';
    addCas(s, i % SW, (i / SW) | 0, mob, mob === 'mobile' ? rng.range(78, 100) : rng.range(55, 85),
      mob === 'mobile' ? 0.03 : rng.range(0.07, 0.19), mob === 'trapped' ? rng.range(0.35, 0.55) : rng.range(0.1, 0.55));
  }
  s.leadDept = 'fire';
  return s;
}

// ───────────────────────── 교통사고 ─────────────────────────
function buildTraffic(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  const sev = I.truth.severity;
  for (let y = 8; y <= 11; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.ROAD);
  const tree = (x: number, y: number) => { if (get(s, x, y) === T.GROUND) set(s, x, y, T.TREE); };
  for (let k = 0; k < 16; k++) {
    const cx = rng.int(1, SW - 2), cy = rng.chance(0.5) ? rng.int(0, 5) : rng.int(14, SH - 1);
    tree(cx, cy); if (rng.chance(0.6)) tree(Math.min(SW - 1, cx + 1), cy); if (rng.chance(0.4) && cy + 1 < SH && (cy + 1 < 6 || cy + 1 > 13)) tree(cx, cy + 1);
  }
  s.staging = { x: 3, y: 13 }; s.safe = { x: 6, y: 14 }; s.vantage = { x: 8, y: 12 };
  set(s, 3, 13, T.GROUND); set(s, 6, 14, T.GROUND);
  const busCrash = I.truth.variant === 'bus';
  const nW = sev >= 3 ? 3 : 2;
  const wrecks: Prop[] = [];
  for (let k = 0; k < nW; k++) {
    const x = 11 + k * 4 + rng.int(-1, 1), y = rng.pick([9, 10]);
    const isBus = busCrash && k === 0;      // 다수 사상자 사고: 첫 차량이 버스다
    const p = addProp(s, 'vehicle', isBus ? x - 2 : x, y, { w: isBus ? 3 : 2, h: 1, blocking: true, hp: 10, leak: 0, leakRate: 0, occupants: [], angle: isBus ? rng.range(-0.1, 0.1) : rng.range(-0.35, 0.35), color: rng.int(0, 4), bus: isBus });
    wrecks.push(p);
    addRegion(s, isBus ? '버스' : `차량 ${k + 1}`, 'wreck', p.x - 1, y - 1, p.x + p.w, y + 1, false, true);
  }
  if (busCrash) s.placeName = '버스 추돌 사고 현장';
  const vN = addRegion(s, '북측 수풀', 'verge', 6, 2, 24, 6, false, true);
  const vS = addRegion(s, '남측 수풀', 'verge', 8, 13, 24, 17, false, true);
  // 탑승자
  for (const w of wrecks) {
    const n = w.bus ? rng.int(6, 8) : sev >= 2 && s.casualties.length < 4 ? rng.int(1, 2) : 1;
    for (let k = 0; k < n; k++) {
      const roll = rng.next();
      const pTrap = w.bus ? 0.2 : sev >= 3 ? 0.4 : sev >= 2 ? 0.28 : 0.08;
      if (roll < pTrap) {
        const c = addCas(s, w.x + (k % w.w), w.y, 'trapped', rng.range(45, 75), rng.range(0.16, 0.31) * (w.bus ? 0.7 : 1), 0.3, { inVehicle: w.id });
        c.trapWork = rng.range(12, 20); w.occupants!.push(c.id);
      } else if (roll < pTrap + 0.3) {
        const c = addCas(s, w.x + (k % w.w), w.y, 'immobile', rng.range(50, 80), rng.range(0.12, 0.25) * (w.bus ? 0.7 : 1), 0.3, { inVehicle: w.id });
        w.occupants!.push(c.id);
      } else {
        const sy = w.y === 9 ? 7 : 12;
        addCas(s, Math.max(1, Math.min(SW - 2, w.x + (k % 4) + rng.int(-1, 1))), sy, 'mobile', rng.range(72, 96), rng.range(0.0, 0.05), 0);
      }
    }
  }
  const hz = (v: number): number => Math.min(0.95, v * sim.tune.hazardMul);
  if (sev >= 2 && rng.chance(hz(0.3))) {
    const w = rng.pick(wrecks); w.emptySeat = true;
    const v = rng.chance(0.5) ? vN : vS;
    const i = freeTileIn(s, v, rng, (q) => Math.abs((q % SW) - w.x) > 6);
    set(s, i % SW, (i / SW) | 0, T.TREE);
    addCas(s, i % SW, (i / SW) | 0, 'immobile', rng.range(42, 66), rng.range(0.16, 0.27), rng.range(0.55, 0.7));
  }
  if (rng.chance(hz(0.2 + sev * 0.07))) { const w = rng.pick(wrecks); w.leak = 0.12; w.leakRate = rng.range(0.0052, 0.0085); }
  const nd = rng.int(2, 4);
  for (let k = 0; k < nd; k++) addProp(s, 'roadDebris', rng.int(9, 21), rng.int(8, 11), { hp: 4 });
  s.controlPts = [{ x: 2, y: 10 }, { x: 27, y: 9 }]; s.controlDone = [false, false];
  s.laneRows = [8, 11];
  const node = sim.city.nodes[I.truth.nodeId];
  let cong = 1.2; for (const eid of node.edges) cong = Math.max(cong, sim.city.edges[eid].cong);
  s.trafficFlow = cong / 2;
  s.nextCarAt = sim.t + 4;
  s.leadDept = 'fire';
  return s;
}

// ───────────────────────── 실종·조난 ─────────────────────────
function buildSearch(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  const sev = I.truth.severity;
  // 수풀
  const blobs = rng.int(11, 16);
  for (let k = 0; k < blobs; k++) {
    const cx = rng.int(3, SW - 2), cy = rng.int(0, SH - 1), rr = rng.range(1.2, 3.2);
    for (let y = 0; y < SH; y++) for (let x = 0; x < SW; x++) if (Math.hypot(x - cx, y - cy) <= rr && rng.chance(0.8)) set(s, x, y, T.TREE);
  }
  // 개울 + 다리
  let cxw = rng.int(13, 17);
  const bridges = [rng.int(2, 7), rng.int(11, 17)];
  for (let y = 0; y < SH; y++) {
    if (bridges.indexOf(y) < 0) set(s, cxw, y, T.WATER); else set(s, cxw, y, T.TRAIL);
    if (rng.chance(0.35)) { const nx = cxw + rng.pick([-1, 1]); if (nx >= 12 && nx <= 18) { if (bridges.indexOf(y) < 0) set(s, nx, y, T.WATER); cxw = nx; if (bridges.indexOf(y) >= 0) set(s, nx, y, T.TRAIL); } }
  }
  for (let k = 0; k < 5; k++) { const x = rng.int(4, SW - 2), y = rng.int(1, SH - 2); if (get(s, x, y) !== T.WATER) set(s, x, y, T.ROCK); }
  // 등산로
  let ty = 10;
  for (let x = 0; x < 13; x++) { if (get(s, x, ty) !== T.WATER) set(s, x, ty, T.TRAIL); if (rng.chance(0.3)) ty = Math.max(2, Math.min(SH - 3, ty + rng.pick([-1, 1]))); if (get(s, x, ty) !== T.WATER) set(s, x, ty, T.TRAIL); }
  s.staging = { x: 1, y: 10 }; s.safe = { x: 1, y: 13 }; s.vantage = { x: 3, y: 10 };
  for (const p of [s.staging, s.safe, s.vantage, { x: 2, y: 11 }, { x: 1, y: 11 }, { x: 1, y: 12 }, { x: 2, y: 12 }]) set(s, p.x, p.y, T.TRAIL);
  const names = ['A구역', 'B구역', 'C구역', 'D구역', 'E구역', 'F구역'];
  const zones: Region[] = [];
  for (let zy = 0; zy < 2; zy++) for (let zx = 0; zx < 3; zx++) zones.push(addRegion(s, names[zy * 3 + zx], 'zone', zx * 10, zy * 10, zx * 10 + 9, zy * 10 + 9, false, true));
  // 대상
  const weights = zones.map((z) => 0.4 + Math.hypot(z.cx - 1, z.cy - 10) / 12);
  const tz = rng.weighted(zones, weights);
  const wander = I.truth.variant === 'wander';
  const ti = freeTileIn(s, tz, rng, (q) => s.tiles[q] === T.TRAIL || Math.hypot((q % SW) - 1, ((q / SW) | 0) - 10) < 9);
  const tx = ti % SW, tyy = (ti / SW) | 0;
  const conc = rng.range(0.46, 0.72) + (s.tiles[ti] === T.TREE ? 0.12 : 0);
  addCas(s, tx, tyy, wander ? 'mobile' : 'immobile', wander ? rng.range(70, 90) : rng.range(52, 80) - sev * 4,
    wander ? rng.range(0.07, 0.13) + sev * 0.025 : rng.range(0.13, 0.21) + sev * 0.04, conc, { isTarget: true, wander, wanderT: sim.t + 10 });
  if (sev >= 3 && !wander) {
    const i2 = freeTileIn(s, tz, rng, (q) => Math.hypot((q % SW) - tx, ((q / SW) | 0) - tyy) > 3.5 || s.tiles[q] === T.TRAIL);
    addCas(s, i2 % SW, (i2 / SW) | 0, 'immobile', rng.range(55, 80), rng.range(0.04, 0.09), conc * 0.8, { isTarget: true });
  }
  // 목격자 / 단서
  if (rng.chance(0.65)) {
    const accurate = rng.chance(sim.tune.witnessAcc);
    let seen = tz.id;
    if (!accurate) { const adj = zones.filter((z) => z.id !== tz.id && Math.abs(z.cx - tz.cx) + Math.abs(z.cy - tz.cy) <= 10.5); seen = rng.pick(adj.length ? adj : zones).id; }
    addProp(s, 'witness', 2, 11, { lastSeenRegion: seen, accurate, interviewed: false });
  }
  const nClue = rng.int(1, 3);
  for (let k = 0; k < nClue; k++) {
    const f = 0.4 + k * 0.22 + rng.range(-0.08, 0.08);
    const x = Math.round(1 + (tx - 1) * f + rng.range(-1.5, 1.5)), y = Math.round(10 + (tyy - 10) * f + rng.range(-1.5, 1.5));
    if (x < 1 || y < 0 || x >= SW || y >= SH || !staticPass(get(s, x, y))) continue;
    addProp(s, 'clue', x, y, { found: false, dirRegion: tz.id });
  }
  if (rng.chance(Math.min(0.95, 0.4 * sim.tune.hazardMul))) { const z = rng.pick(zones.filter((q) => q.cx > 18)); for (const i of z.tiles) if (s.tiles[i] === T.TREE || rng.chance(0.5)) s.shadow[i] = 1; }
  s.outdoorVision = sim.weather === 'clear' ? 3.8 : sim.weather === 'rain' ? 3.2 : sim.weather === 'fog' ? 2.5 : 2.7;
  s.leadDept = 'police';
  return s;
}

// ───────────────────────── 무장 사건 ─────────────────────────
type VenueKind = 'shop' | 'bank' | 'office' | 'warehouse';
interface Venue { main: Region; back: Region; office: Region; front: number; rear: number; place: string }

/**
 * 무장 사건의 장소. 어느 장소든 용의자가 있는 넓은 곳(main), 숨을 수 있는 뒷방(back), 인질이 잡히는 방(office)이 있고,
 * 남쪽 정문(exits[0])과 북쪽 후문(exits[1])이 있다. 건물 범위는 x 8~22, y 2~10 으로 같다.
 */
function armedVenue(s: Scene, rng: Rng, kind: VenueKind, dist: District): Venue {
  const bx0 = 8, bx1 = 22, by0 = 2, by1 = 10;
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) set(s, x, y, x === bx0 || x === bx1 || y === by0 || y === by1 ? T.WALL : T.FLOOR);
  const wall = (x: number, y: number): void => set(s, x, y, T.WALL);
  const rack = (x: number, y: number): void => { set(s, x, y, T.WALL); s.decor[tidx(s, x, y)] = DECOR.SHELF; };      // 키 큰 진열대(시야를 가린다)
  const fixture = (x: number, y: number, d: number): void => { set(s, x, y, T.FURN); s.decor[tidx(s, x, y)] = d; };
  const door = (x: number, y: number, r: Region, open = false): void => { set(s, x, y, T.DOOR); addProp(s, 'door', x, y, { open }); const i = tidx(s, x, y); s.region[i] = r.id; r.tiles.push(i); };
  let main: Region, back: Region, office: Region, front = 15, rear = 11, place = '';
  if (kind === 'bank') {
    for (let y = 3; y <= 9; y++) wall(17, y);
    for (let x = 18; x <= 21; x++) wall(x, 6);
    main = addRegion(s, '은행 로비', 'room', 9, 3, 16, 9, true, true);
    office = addRegion(s, '지점장실', 'room', 18, 3, 21, 5, true, true);
    back = addRegion(s, '금고', 'room', 18, 7, 21, 9, true, true);
    for (let x = 9; x <= 13; x++) fixture(x, 5, DECOR.COUNTER);      // 창구
    door(17, 4, office); door(17, 8, back);
    front = 12; rear = 20;
    for (const x of [10, 14, 15]) set(s, x, by1, T.WINDOW);
    for (const x of [11, 14]) set(s, x, by0, T.WINDOW);
    door(front, by1, main, true); door(rear, by0, office);
    furnish(s, rng, main, [DECOR.PLANT, DECOR.SOFA, DECOR.PLANT], 3, false);
    furnish(s, rng, office, [DECOR.DESK, DECOR.CABINET, DECOR.SOFA], 2, false);
    furnish(s, rng, back, [DECOR.CABINET, DECOR.CRATE, DECOR.CABINET], 3, false);
    s.floorMat = 1; place = '은행 지점';
  } else if (kind === 'office') {
    for (let x = 9; x <= 21; x++) wall(x, 5);
    for (const x of [13, 18]) for (let y = 3; y <= 4; y++) wall(x, y);
    main = addRegion(s, '사무 공간', 'room', 9, 6, 21, 9, true, true);
    back = addRegion(s, '서류 창고', 'room', 9, 3, 12, 4, true, true);
    const meeting = addRegion(s, '회의실', 'room', 14, 3, 17, 4, true, true);
    office = addRegion(s, '대표실', 'room', 19, 3, 21, 4, true, true);
    for (const [x, y] of [[11, 7], [12, 7], [17, 8], [18, 8]]) fixture(x, y, DECOR.DESK);      // 책상 섬
    door(11, 5, back); door(16, 5, meeting); door(20, 5, office);
    front = 15; rear = 10;
    for (const x of [10, 11, 19, 20]) set(s, x, by1, T.WINDOW);
    for (const x of [16, 20]) set(s, x, by0, T.WINDOW);
    door(front, by1, main, true); door(rear, by0, back);
    furnish(s, rng, main, [DECOR.PLANT, DECOR.CABINET, DECOR.SOFA], 3, false);
    furnish(s, rng, back, [DECOR.CABINET, DECOR.CRATE], 2, false);
    furnish(s, rng, meeting, [DECOR.TABLE, DECOR.PLANT], 1, false);
    furnish(s, rng, office, [DECOR.DESK, DECOR.SOFA, DECOR.CABINET], 2, false);
    s.floorMat = 0; place = dist === 'industrial' ? '공단 사무동' : '사무실';
  } else if (kind === 'warehouse') {
    for (let y = 3; y <= 5; y++) { wall(13, y); wall(17, y); }
    for (let x = 9; x <= 13; x++) wall(x, 6);
    for (let x = 17; x <= 21; x++) wall(x, 6);
    main = addRegion(s, '창고 홀', 'room', 9, 7, 21, 9, true, true);
    for (let y = 3; y <= 6; y++) for (let x = 14; x <= 16; x++) { const i = tidx(s, x, y); s.region[i] = main.id; main.tiles.push(i); }      // 가운데 통로도 홀에 속한다
    back = addRegion(s, '자재실', 'room', 9, 3, 12, 5, true, true);
    office = addRegion(s, '관리실', 'room', 18, 3, 21, 5, true, true);
    for (const [x, y] of [[12, 8], [18, 8]]) rack(x, y);
    door(11, 6, back); door(19, 6, office);
    front = 15; rear = 15;
    for (const x of [10, 20]) { set(s, x, by1, T.WINDOW); set(s, x, by0, T.WINDOW); }
    door(front, by1, main, true); door(rear, by0, main);
    furnish(s, rng, main, [DECOR.CRATE, DECOR.CRATE, DECOR.MACHINE, DECOR.CRATE], 5, false);
    furnish(s, rng, back, [DECOR.CRATE, DECOR.CABINET], 2, false);
    furnish(s, rng, office, [DECOR.DESK, DECOR.CABINET], 2, false);
    s.floorMat = 2; place = dist === 'outskirts' ? '외곽 창고' : '물류 창고';
  } else {
    for (let x = bx0 + 1; x < bx1; x++) wall(x, 5);
    for (let y = 3; y <= 4; y++) wall(15, y);
    for (const [x, y] of [[12, 7], [12, 8], [18, 7], [18, 8]]) rack(x, y);
    main = addRegion(s, '매장', 'room', 9, 6, 21, 9, true, true);
    back = addRegion(s, '창고', 'room', 9, 3, 14, 4, true, true);
    office = addRegion(s, '사무실', 'room', 16, 3, 21, 4, true, true);
    door(12, 5, back); door(18, 5, office);
    front = 15; rear = 11;
    for (const x of [10, 11, 19, 20]) set(s, x, by1, T.WINDOW);
    door(front, by1, main, true); door(rear, by0, back);
    furnish(s, rng, main, [DECOR.COUNTER, DECOR.COUNTER, DECOR.SHELF, DECOR.PLANT], 4, false);
    furnish(s, rng, back, [DECOR.CRATE, DECOR.CRATE, DECOR.CABINET], 3, false);
    furnish(s, rng, office, [DECOR.DESK, DECOR.CABINET, DECOR.SOFA], 2, false);
    s.floorMat = 1;
  }
  s.exits.push({ x: front, y: by1 + 1 }, { x: rear, y: by0 - 1 });
  // 엄폐물(주차 차량)과 엄폐 위치: 정문 앞, 후문 옆, 협상 위치
  for (const [x, y] of [[front - 5, 13], [front, 14], [front + 5, 13]]) addProp(s, 'cover', x, y, { w: 2, h: 1, blocking: true, color: rng.int(0, 4) });
  s.spots = [
    { x: front, y: 15, exit: 0, taken: -1 }, { x: front + 1, y: 15, exit: 0, taken: -1 }, { x: front - 5, y: 14, exit: 0, taken: -1 }, { x: front + 6, y: 14, exit: 0, taken: -1 },
    { x: rear - 4, y: 1, exit: 1, taken: -1 }, { x: rear + 3, y: 1, exit: 1, taken: -1 },
    { x: front - 4, y: 14, exit: -1, taken: -1 },
  ];
  s.staging = { x: 1, y: 18 }; s.safe = { x: 2, y: 14 }; s.vantage = { x: front - 5, y: 14 };
  if (place) s.placeName = place;
  return { main, back, office, front, rear, place };
}

function buildArmed(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  const sev = I.truth.severity, variant = I.truth.variant, dist = I.truth.district;
  for (let y = 16; y <= 18; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.ROAD);
  const kind: VenueKind = dist === 'commercial' ? rng.weighted<VenueKind>(['shop', 'bank', 'office'], [0.35, 0.35, 0.3])
    : dist === 'industrial' ? rng.weighted<VenueKind>(['warehouse', 'shop', 'office'], [0.55, 0.25, 0.2])
      : dist === 'outskirts' ? rng.weighted<VenueKind>(['shop', 'warehouse'], [0.6, 0.4]) : rng.weighted<VenueKind>(['shop', 'office'], [0.65, 0.35]);
  const ks = I.truth.placeKind ? KIND_SCENE[I.truth.placeKind] : undefined;
  const V = armedVenue(s, rng, ks && ks.venue ? ks.venue : kind, dist);      // 지도의 건물 종류가 장소를 정한다 (은행이면 은행 로비)
  const shop = V.main, storage = V.back, office = V.office;
  const tn = sim.tune;
  const ag = (v: number): number => Math.max(0.05, Math.min(0.98, v + tn.aggroShift));
  const sk = (v: number): number => Math.max(0.1, Math.min(0.95, v + tn.skillShift));
  const fleeBase = sim.t + rng.range(85, 150) + tn.fleeShift;
  const inShop = () => { const i = freeTileIn(s, shop, rng, (q) => ((q / SW) | 0) > 8); return { x: i % SW, y: (i / SW) | 0 }; };
  if (variant === 'prank') {
    // 장난 전화: 가게는 평소와 다름없다
    s.leadDept = 'police';
    return s;
  }
  if (variant === 'hostage') {
    // 인질 사건: 용의자가 사무실에서 인질을 붙잡고 있다
    const i = freeTileIn(s, office, rng);
    const h = addHostile(s, i % SW, (i / SW) | 0, 'gun', ag(rng.range(0.5, 0.75)), sk(rng.range(0.4, 0.65)), false, Infinity);
    h.facing = Math.PI / 2; h.deadline = sim.t + rng.range(185, 290) + tn.fleeShift * 2;
    const nH = rng.int(1, 2);
    for (let k = 0; k < nH; k++) {
      const j = freeTileIn(s, office, rng, (q) => Math.hypot((q % SW) - h.x, ((q / SW) | 0) - h.y) > 1.6 || (q % SW === h.x && ((q / SW) | 0) === h.y));
      const c = addCas(s, j % SW, (j / SW) | 0, 'mobile', rng.range(85, 100), 0, 0.05, { hostage: true });
      if (k === 0) h.hostageId = c.id;
    }
    if (rng.chance(tn.accompliceProb * 0.7)) { const p = inShop(); const g = addHostile(s, p.x, p.y, 'gun', ag(rng.range(0.4, 0.65)), sk(rng.range(0.3, 0.55)), false, Infinity); g.facing = Math.PI / 2; }
    if (rng.chance(0.4)) { const j = freeTileIn(s, storage, rng); addCas(s, j % SW, (j / SW) | 0, 'mobile', rng.range(85, 100), 0, rng.range(0.25, 0.45), { hostage: true }); }
    s.leadDept = 'police';
    return s;
  }
  if (variant === 'dispute') {
    const p = inShop();
    addHostile(s, p.x, p.y, rng.chance(tn.knifeProb) ? 'knife' : 'none', ag(rng.range(0.12, 0.4)), sk(0.3), false, Infinity);
  } else if (variant === 'shooter') {
    const p = inShop();
    addHostile(s, p.x, p.y, 'gun', ag(rng.range(0.78, 0.95)), sk(rng.range(0.4, 0.7)), false, Infinity);
    // 위협 수준이 높으면 총격범에게 공범이 있을 수 있다
    if (tn.extraSuspectProb > 0 && rng.chance(tn.extraSuspectProb * 0.6)) { const q = inShop(); addHostile(s, q.x, q.y, 'gun', ag(rng.range(0.6, 0.85)), sk(rng.range(0.35, 0.6)), false, Infinity); }
  } else {
    let n = sev >= 3 ? 2 : 1;
    if (tn.extraSuspectProb > 0 && rng.chance(tn.extraSuspectProb)) n++;
    for (let k = 0; k < n; k++) { const p = inShop(); addHostile(s, p.x, p.y, 'gun', ag(rng.range(0.35, 0.7)), sk(rng.range(0.3, 0.6)), false, fleeBase + k * 4); }
    if (sev >= 2 && rng.chance(tn.accompliceProb)) { const i = freeTileIn(s, storage, rng); addHostile(s, i % SW, (i / SW) | 0, 'gun', ag(rng.range(0.4, 0.7)), sk(rng.range(0.3, 0.55)), true, fleeBase + 20); }
  }
  // 시민
  const nCiv = variant === 'dispute' ? rng.int(0, 1) : rng.int(1, 3);
  for (let k = 0; k < nCiv; k++) {
    const r = rng.chance(0.6) ? office : storage;
    const i = freeTileIn(s, r, rng);
    addCas(s, i % SW, (i / SW) | 0, 'mobile', rng.range(85, 100), 0, rng.range(0.25, 0.45), { hostage: true });
  }
  const pWounded = variant === 'shooter' ? 0.95 : variant === 'robbery' ? 0.35 : 0.15;
  if (rng.chance(pWounded)) {
    const p = inShop();
    addCas(s, p.x, p.y, 'immobile', rng.range(45, 70), rng.range(0.12, 0.2), 0.1);
    if (variant === 'shooter' && sev >= 3) { const q = inShop(); addCas(s, q.x, q.y, 'immobile', rng.range(50, 72), rng.range(0.1, 0.17), 0.1); }
  }
  s.leadDept = 'police';
  return s;
}

// ───────────────────────── 응급 환자 ─────────────────────────
function buildMedical(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  const variant = I.truth.variant;
  for (let y = 17; y < SH; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.ROAD);
  const lockedP = Math.min(0.9, 0.16 * sim.tune.hazardMul);       // 혼자 쓰러져 문을 열어 줄 사람이 없다
  const rooms: Region[] = [];
  let fx = 12;
  const by1 = 12;
  const coin = rng.chance(0.5), home = I.truth.placeKind ? KIND_SCENE[I.truth.placeKind]?.home : undefined;
  if (home ? home === 'small' : coin) {
    // 거실·침실·주방이 나뉜 작은 집
    const bx0 = 9, bx1 = 20, by0 = 4;
    for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) set(s, x, y, x === bx0 || x === bx1 || y === by0 || y === by1 ? T.WALL : T.FLOOR);
    for (let y = by0 + 1; y < by1; y++) set(s, 15, y, T.WALL);
    for (let x = bx0 + 1; x < 15; x++) set(s, x, 8, T.WALL);
    set(s, 15, 10, T.DOOR); addProp(s, 'door', 15, 10, { open: true });
    set(s, 12, 8, T.DOOR); addProp(s, 'door', 12, 8, { open: rng.chance(0.6) });
    for (const [x, y] of [[11, by0], [18, by0], [bx0, 6], [bx1, 8], [17, by1]]) set(s, x, y, T.WINDOW);
    const living = addRegion(s, '거실', 'room', 10, 9, 14, 11, true, true);
    const bed = addRegion(s, '침실', 'room', 10, 5, 14, 7, true, true);
    const kitchen = addRegion(s, '주방', 'room', 16, 5, 19, 11, true, true);
    for (const [x, y, r] of [[15, 10, kitchen.id], [12, 8, bed.id]] as number[][]) { const i = tidx(s, x, y); s.region[i] = r; s.regions[r].tiles.push(i); }
    rooms.push(living, bed, kitchen);
  } else {
    // 방이 여러 개 이어진 집 (크기와 방 구성이 매번 다르다)
    const f = { x0: rng.int(8, 10), y0: rng.int(3, 5), x1: rng.int(19, 22), y1: by1 };
    for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) set(s, x, y, x === f.x0 || x === f.x1 || y === f.y0 || y === f.y1 ? T.WALL : T.FLOOR);
    const made = suiteRooms(s, rng, f, '방', ['거실', '침실', '주방', '작은방', '서재', '욕실', '다용도실', '옷방']);
    rooms.push(...made.rooms);
    const cands: number[] = [];
    for (let x = f.x0 + 2; x <= f.x1 - 2; x++) if (get(s, x, by1 - 1) === T.FLOOR && get(s, x - 1, by1) === T.WALL && get(s, x + 1, by1) === T.WALL) cands.push(x);
    fx = cands.length ? rng.pick(cands) : Math.round((f.x0 + f.x1) / 2);
    for (const r of rooms) {
      const wx = Math.round((r.x0 + r.x1) / 2);
      if (r.y0 - 1 === f.y0 && get(s, wx, f.y0) === T.WALL) set(s, wx, f.y0, T.WINDOW);
      else if (r.y1 + 1 === f.y1 && get(s, wx, f.y1) === T.WALL && Math.abs(wx - fx) > 1) set(s, wx, f.y1, T.WINDOW);
    }
  }
  set(s, fx, by1, T.DOOR);
  const locked = rng.chance(lockedP);
  addProp(s, 'door', fx, by1, { open: false, locked, blocking: locked, hp: rng.range(5, 8) });
  { const inId = s.region[tidx(s, fx, by1 - 1)]; if (inId >= 0) { const i = tidx(s, fx, by1); s.region[i] = inId; s.regions[inId].tiles.push(i); } }
  s.exits.push({ x: fx, y: by1 + 1 });
  s.staging = { x: 3, y: 17 }; s.safe = { x: 4, y: 14 }; s.vantage = { x: fx, y: 14 };
  const KINDS: Record<string, number[]> = { 거실: [DECOR.SOFA, DECOR.TABLE, DECOR.PLANT, DECOR.CABINET], 침실: [DECOR.BED, DECOR.CABINET, DECOR.DESK], 주방: [DECOR.KITCHEN, DECOR.KITCHEN, DECOR.TABLE, DECOR.CABINET], 작은방: [DECOR.BED, DECOR.DESK], 서재: [DECOR.DESK, DECOR.CABINET, DECOR.SOFA], 욕실: [DECOR.CABINET], 다용도실: [DECOR.CRATE, DECOR.CABINET], 옷방: [DECOR.CABINET, DECOR.CABINET] };
  for (const r of rooms) furnish(s, rng, r, KINDS[r.name] ?? [DECOR.CABINET], r.name === '주방' ? 4 : r.name === '거실' ? 3 : 2, false);
  const room = rng.pick(rooms);
  const i = freeTileIn(s, room, rng);
  if (variant === 'arrest') addCas(s, i % SW, (i / SW) | 0, 'immobile', rng.range(58, 70), rng.range(0.5, 0.66), 0.05);
  else if (variant === 'trauma') addCas(s, i % SW, (i / SW) | 0, 'immobile', rng.range(60, 80), rng.range(0.15, 0.24), 0.05);
  else addCas(s, i % SW, (i / SW) | 0, 'immobile', rng.range(70, 88), rng.range(0.05, 0.1), 0.05);
  s.leadDept = 'ems';
  return s;
}

// ───────────────────────── 건물 붕괴 ─────────────────────────
function buildCollapse(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  const sev = I.truth.severity, dist = I.truth.district;
  s.floorMat = floorMatOf(dist);
  const o = planOpts(dist, I.truth.placeKind);
  if (dist === 'industrial' && !I.truth.placeKind) o.prefix = '창고';
  const P = rng.chance(Math.min(0.5, tallP(I.truth.placeKind, 0.5) * 0.6)) ? tallPlan(s, rng, o) : planBuilding(s, rng, pickArch(rng, dist, I.truth.placeKind), o);
  fuelUp(s, P, rng, 0.35, 0.7, 0.25, 0.4, 0.25);
  const hz = (v: number): number => Math.min(0.95, v * sim.tune.hazardMul);
  // 무너진 구역: 한 층의 한쪽에서 안쪽 벽이 넘어가고 잔해가 깔린다
  const F = rng.pick(P.floors);
  const zw = Math.min(F.x1 - F.x0 - 1, rng.int(5, 6 + sev)), zh = Math.min(F.y1 - F.y0 - 1, rng.int(4, 5 + sev));
  const zx0 = rng.int(F.x0 + 1, F.x1 - zw), zy0 = rng.int(F.y0 + 1, F.y1 - zh);
  const zx1 = zx0 + zw - 1, zy1 = zy0 + zh - 1;
  const zone: number[] = [];
  for (let y = zy0; y <= zy1; y++) for (let x = zx0; x <= zx1; x++) {
    const i = tidx(s, x, y), t = s.tiles[i];
    if (t === T.STAIR) continue;
    if (t === T.WALL && rng.chance(0.75)) { s.tiles[i] = T.FLOOR; s.decor[i] = 0; }
    else if (t === T.FURN && rng.chance(0.6)) { s.tiles[i] = T.FLOOR; s.decor[i] = 0; }
    if (s.tiles[i] === T.DOOR) { const d = s.props.find((p) => p.kind === 'door' && p.x === x && p.y === y); if (d && !d.locked) d.open = true; }
    s.damage[i] = 1;
    if (s.tiles[i] === T.FLOOR) { zone.push(i); if (s.fuel[i] === 0) s.fuel[i] = 0.3; }
    s.smoke[i] = 0.55;
  }
  // 넘어간 벽 자리는 이웃한 방에 속한 것으로 본다
  for (const i of zone) if (s.region[i] < 0) { for (const d of [1, -1, SW, -SW]) { const j = i + d; if (j >= 0 && j < s.region.length && s.region[j] >= 0) { s.region[i] = s.region[j]; break; } } }
  for (const i of zone) if (rng.chance(0.17 + 0.03 * sev)) addProp(s, 'debris', i % SW, (i / SW) | 0, { blocking: true, hp: rng.range(8, 14) });
  if (rng.chance(hz(0.3))) blockPassage(s, rng, P, [8, 13]);
  const free = (): number => { for (let k = 0; k < 60; k++) { const i = rng.pick(zone); if (s.propAt[i] < 0 && s.tiles[i] === T.FLOOR) return i; } return -1; };
  // 금이 간 구조물 (보강하지 않으면 다시 무너진다)
  const nUnstable = sev >= 3 ? 2 : rng.chance(hz(0.7)) ? 1 + (sev >= 2 && rng.chance(0.4) ? 1 : 0) : 0;
  for (let k = 0; k < nUnstable; k++) { const i = free(); if (i >= 0) addProp(s, 'unstable', i % SW, (i / SW) | 0, { leak: rng.range(0, 0.25), leakRate: rng.range(0.0045, 0.008) * (0.8 + 0.2 * sim.tune.hazardMul) }); }
  // 구조 대상
  const count = sev >= 3 ? rng.int(4, 6) : sev >= 2 ? rng.int(2, 4) : rng.int(1, 2);
  for (let k = 0; k < count; k++) {
    const used = (q: number): boolean => s.casualties.some((c) => c.x === q % SW && c.y === ((q / SW) | 0)) || s.props.some((p) => p.kind === 'unstable' && p.x === q % SW && p.y === ((q / SW) | 0));
    let i = rng.chance(0.75) ? free() : freeTileIn(s, rng.pick(P.rooms), rng);
    if (i < 0 || used(i)) i = freeTileIn(s, rng.pick(P.rooms), rng, used);
    const roll = rng.next(), inZone = s.damage[i] === 1;
    const mob: Mobility = inZone ? (roll < 0.62 ? 'trapped' : roll < 0.88 ? 'immobile' : 'mobile') : roll < 0.3 ? 'immobile' : 'mobile';
    const c = addCas(s, i % SW, (i / SW) | 0, mob, mob === 'mobile' ? rng.range(76, 100) : rng.range(46, 84), mob === 'mobile' ? 0.02 : rng.range(0.07, 0.19), mob === 'trapped' ? rng.range(0.4, 0.7) : rng.range(0.12, 0.45));
    if (mob === 'trapped') c.trapWork = rng.range(14, 22);
  }
  // 끊어진 배선에서 불이 붙는 경우
  if (rng.chance(hz(0.22))) { const i = freeTileIn(s, rng.pick(P.rooms), rng); s.fire[i] = rng.range(0.35, 0.5); }
  if (rng.chance(hz(0.35))) for (const i of zone) if (i % SW >= (zx0 + zx1) / 2) s.shadow[i] = 1;
  return s;
}

// ───────────────────────── 가스 누출 ─────────────────────────
function buildHazmat(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  const sev = I.truth.severity, dist = I.truth.district;
  s.floorMat = dist === 'residential' ? 1 : 2;
  const o: PlanOpts = { prefix: dist === 'industrial' ? '공정실' : '기계실', hallName: dist === 'industrial' ? '배관동' : '기계실 홀', kinds: [DECOR.MACHINE, DECOR.CABINET, DECOR.CRATE, DECOR.MACHINE], hallKinds: [DECOR.MACHINE, DECOR.MACHINE, DECOR.CRATE, DECOR.CABINET], racks: false };
  const arch0: Arch = dist === 'industrial' ? rng.weighted<Arch>(['hall', 'corridor'], [0.55, 0.45]) : rng.weighted<Arch>(['corridor', 'suite', 'hall'], [0.45, 0.3, 0.25]);
  const arch: Arch = I.truth.placeKind && KIND_SCENE[I.truth.placeKind] ? pickArch(rng, dist, I.truth.placeKind) : arch0;
  const P = rng.chance(0.3) ? tallPlan(s, rng, o) : planBuilding(s, rng, arch, o);
  fuelUp(s, P, rng, 0.35, 0.7, 0.25, 0.4, 0.25);
  const hz = (v: number): number => Math.min(0.95, v * sim.tune.hazardMul);
  // 새는 배관: 벽에 붙은 자리에 놓는다
  const nValve = sev >= 3 && rng.chance(hz(0.5)) ? 2 : 1;
  const leakRooms: Region[] = [];
  for (let k = 0; k < nValve; k++) {
    const r = rng.pick(P.rooms.filter((q) => leakRooms.indexOf(q) < 0));
    // 가구가 놓였던 자리(방이 끊기지 않는다는 것이 이미 확인된 자리)를 배관 자리로 쓴다
    // 옆에 서서 잠글 수 있도록 바로 옆 칸 하나는 빈 바닥이어야 한다 (가구에 둘러싸인 구석은 쓰지 않는다)
    const spots = r.tiles.filter((i) => s.tiles[i] === T.FURN && (s.tiles[i - SW] === T.WALL || s.tiles[i + SW] === T.WALL) && [1, -1, SW, -SW].some((d) => s.tiles[i + d] === T.FLOOR));
    let i: number;
    if (spots.length) { i = rng.pick(spots); s.tiles[i] = T.FLOOR; s.decor[i] = 0; }
    else {
      const wallAdj = r.tiles.filter((q) => s.tiles[q] === T.FLOOR && s.propAt[q] < 0 && (s.tiles[q - SW] === T.WALL || s.tiles[q + SW] === T.WALL) && [1, -1, SW, -SW, SW + 1, SW - 1, -SW + 1, -SW - 1].every((d) => s.tiles[q + d] !== T.DOOR && s.stairTo[q + d] < 0));
      i = wallAdj.length ? rng.pick(wallAdj) : freeTileIn(s, r, rng);
    }
    addProp(s, 'valve', i % SW, (i / SW) | 0, { blocking: true, leakRate: Math.min(1, 0.5 + 0.14 * sev + rng.range(0, 0.1)) });
    leakRooms.push(r);
  }
  // 안에 있던 사람들: 누출 지점에 가까울수록 쓰러져 있다
  const count = sev >= 3 ? rng.int(3, 5) : sev >= 2 ? rng.int(1, 3) : rng.int(0, 2);
  for (let k = 0; k < count; k++) {
    const r = rng.chance(0.5) ? rng.pick(leakRooms) : rng.pick(P.rooms);
    const i = freeTileIn(s, r, rng, (q) => s.casualties.some((c) => c.x === q % SW && c.y === ((q / SW) | 0)));
    const near = leakRooms.indexOf(r) >= 0;
    const mob: Mobility = rng.chance(near ? 0.7 : 0.3) ? 'immobile' : 'mobile';
    addCas(s, i % SW, (i / SW) | 0, mob, mob === 'mobile' ? rng.range(78, 100) : rng.range(52, 82), mob === 'mobile' ? 0.02 : rng.range(0.05, 0.12), rng.range(0.1, 0.4));
  }
  if (rng.chance(hz(0.2))) { const d = doorOf(s, rng.pick(P.rooms)); if (d && P.exitDoors.indexOf(d) < 0) lockDoor(s, d, rng.range(5, 9)); }
  if (rng.chance(hz(0.5))) for (const i of rng.pick(farRooms(s, P)).tiles) s.shadow[i] = 1;
  // 출입구마다 통제 위치: 문에서 두 칸 떨어진 바깥
  s.spots = s.exits.map((e, k) => {
    const d = P.exitDoors[k], dx = e.x - d.x, dy = e.y - d.y;
    const x = Math.max(0, Math.min(SW - 1, e.x + dx * 2)), y = Math.max(0, Math.min(16, e.y + dy * 2));
    return { x: staticPass(get(s, x, y)) ? x : e.x, y: staticPass(get(s, x, y)) ? y : e.y, exit: k, taken: -1 };
  });
  return s;
}

// ───────────────────────── 수난 사고 ─────────────────────────
/** 하천에 빠진 사람들. 물은 지나갈 수 없고, 사람은 하류(+x)로 떠내려간다. 다리 하나가 두 물가를 잇는다. */
function buildWater(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  const sev = I.truth.severity;
  for (let y = 17; y < SH; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.ROAD);
  // 하천: 가로로 흐르고 조금씩 굽는다
  let top = rng.int(4, 6);
  const tops: number[] = [];
  for (let x = 0; x < SW; x++) {
    if (x > 0 && x % 4 === 0) top = Math.max(3, Math.min(6, top + rng.pick([-1, 0, 0, 1])));
    tops.push(top);
    for (let y = top; y < top + 5; y++) set(s, x, y, T.WATER);
  }
  // 다리
  const bx = rng.int(21, 26);
  for (let y = tops[bx] - 1; y <= tops[bx] + 5; y++) set(s, bx, y, T.TRAIL);
  // 둔치의 나무
  for (let k = 0; k < 14; k++) { const x = rng.int(0, SW - 1), y = rng.chance(0.4) ? rng.int(0, 2) : rng.int(12, 15); if (get(s, x, y) === T.GROUND && !(x <= 6 && y >= 12)) set(s, x, y, T.TREE); }
  s.staging = { x: 3, y: 17 }; s.safe = { x: 3, y: 14 }; s.vantage = { x: 6, y: 12 };
  addRegion(s, '상류 둔치', 'zone', 0, 11, 14, 16, false, true);
  addRegion(s, '하류 둔치', 'zone', 15, 11, SW - 1, 16, false, true);
  addRegion(s, '건너편 둔치', 'zone', 0, 0, SW - 1, 2, false, false);
  // 물에 빠진 사람들
  const count = sev >= 3 ? rng.int(2, 3) : sev >= 2 ? rng.int(1, 2) : 1;
  for (let k = 0; k < count; k++) {
    const x = rng.int(5, bx - 4), y = tops[x] + rng.int(1, 3);
    const c = addCas(s, x, y, 'trapped', rng.range(62, 90), (rng.range(0.17, 0.27) + sev * 0.02) * (sim.weather === 'clear' ? 1 : 1.12), 0.1, { inWater: true, drift: rng.range(0.01, 0.029) * (1 + 0.25 * sev) });
    c.trapWork = 0;
  }
  s.leadDept = 'fire';
  return s;
}

export function buildScene(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = I.truth.type === 'water' ? buildWater(sim, I, rng) : I.truth.type === 'collapse' ? buildCollapse(sim, I, rng) : I.truth.type === 'hazmat' ? buildHazmat(sim, I, rng) : I.truth.type === 'fire' ? buildFire(sim, I, rng) : I.truth.type === 'traffic' ? buildTraffic(sim, I, rng) : I.truth.type === 'search' ? buildSearch(sim, I, rng) : I.truth.type === 'medical' ? buildMedical(sim, I, rng) : buildArmed(sim, I, rng);
  // 심각도 설정: 부상 악화 속도
  for (const c of s.casualties) { c.bleed *= sim.tune.bleedMul; c.bleed0 = c.bleed; }
  sealPockets(s);
  return s;
}

/**
 * 벽이 무너지거나 가구가 놓이면서 생긴, 어디서도 닿지 못하는 한두 칸짜리 빈 틈을 벽으로 메운다.
 * 사람이나 소품이 있는 칸, 세 칸 이상 이어진 곳은 건드리지 않는다(그런 곳이 끊겨 있다면 평면 생성의 잘못이므로 테스트가 잡는다).
 */
function sealPockets(s: Scene): void {
  if (s.kind === 'search' || s.kind === 'traffic' || s.kind === 'water') return;
  const walk = (i: number): boolean => { const t = s.tiles[i]; return t === T.FLOOR || t === T.DOOR || t === T.GROUND || t === T.ROAD || t === T.STAIR; };
  const seen = new Uint8Array(s.w * s.h), st = [tidx(s, s.staging.x, s.staging.y)];
  seen[st[0]] = 1;
  const grow = (stack: number[], mark: Uint8Array, out?: number[]): void => {
    while (stack.length) {
      const c = stack.pop()!, x = c % s.w, y = (c / s.w) | 0;
      if (out) out.push(c);
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) continue; const j = ny * s.w + nx; if (!mark[j] && walk(j)) { mark[j] = 1; stack.push(j); } }
      const sl = s.stairTo[c]; if (sl >= 0 && !mark[sl]) { mark[sl] = 1; stack.push(sl); }
    }
  };
  grow(st, seen);
  for (let i = 0; i < s.tiles.length; i++) {
    if (seen[i] || s.tiles[i] !== T.FLOOR) continue;
    const pocket: number[] = []; seen[i] = 1; grow([i], seen, pocket);
    if (pocket.length > 2) continue;
    if (pocket.some((q) => s.propAt[q] >= 0 || s.casualties.some((c) => tidx(s, Math.round(c.x), Math.round(c.y)) === q) || s.hostiles.some((h) => tidx(s, Math.round(h.x), Math.round(h.y)) === q))) continue;
    for (const q of pocket) { s.tiles[q] = T.WALL; s.fuel[q] = 0; if (s.region[q] >= 0) { const r = s.regions[s.region[q]]; r.tiles = r.tiles.filter((v) => v !== q); s.region[q] = -1; } }
  }
}
