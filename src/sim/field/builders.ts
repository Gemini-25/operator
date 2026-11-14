// FieldSceneManager (생성부) — 사건마다 작은 독립 2D 현장 공간을 만든다.
// 여기서 만들어지는 것은 "진실"이다. AI 는 현장에서 관찰하기 전까지 이 내용을 모른다.

import type { Sim } from '../engine';
import type { Rng } from '../rng';
import { DECOR, T } from '../types';
import type { Casualty, Hostile, Incident, Mobility, Prop, PropKind, Region, Scene } from '../types';
import { staticPass, tidx } from './grid';

export const SW = 30;
export const SH = 20;

function baseScene(sim: Sim, I: Incident, rng: Rng): Scene {
  const n = SW * SH;
  const vis = sim.weather === 'clear' ? 7.5 : sim.weather === 'rain' ? 5.8 : sim.weather === 'fog' ? 4.0 : 4.6;
  return {
    id: I.id, incidentId: I.id, kind: I.truth.type, variant: I.truth.variant, w: SW, h: SH,
    tiles: new Uint8Array(n).fill(T.GROUND), region: new Int16Array(n).fill(-1),
    fire: new Float32Array(n), heat: new Float32Array(n), fuel: new Float32Array(n), smoke: new Float32Array(n),
    burned: new Uint8Array(n), wet: new Float32Array(n), shadow: new Uint8Array(n), propAt: new Int16Array(n).fill(-1),
    decor: new Uint8Array(n), floorMat: 0, damage: new Uint8Array(n),
    regions: [], props: [], casualties: [], hostiles: [], agents: [],
    staging: { x: 3, y: 17 }, safe: { x: 4, y: 15 }, vantage: { x: 4, y: 12 }, exits: [], spots: [],
    controlPts: [], controlDone: [], laneRows: [], cars: [], nextCarAt: 0, trafficFlow: 0,
    indoorVision: 7, outdoorVision: vis, exposure: sim.weather === 'rain' || sim.weather === 'night' ? 0.06 : 0.02,
    startedAt: sim.t, arrivedAt: -1, commanderRid: -1, leadDept: 'fire',
    board: [], nextWorkId: 0, radio: [], nextMsgId: 0, requests: [], zoneProb: [], fx: [], rng,
    totalFuelTiles: 0, burnedTiles: 0, burning: 0, secureAt: -1, fireOutAt: -1, lastSitrep: -99, sizeupDone: false, closing: false,
    entryOrdered: false, negotStart: -1, researchRound: 0, lastSpreadEvent: -99, collapseDone: new Set(), mismatchLogged: false, closedCheckAt: 0,
    staticVersion: 0, archived: false, idleSince: -1, breachAt: -1, breachDone: false, bangAt: -99,
  };
}

const set = (s: Scene, x: number, y: number, t: number): void => { s.tiles[tidx(s, x, y)] = t; };
const get = (s: Scene, x: number, y: number): number => s.tiles[tidx(s, x, y)];

function addRegion(s: Scene, name: string, kind: Region['kind'], x0: number, y0: number, x1: number, y1: number, indoor: boolean, searchable: boolean): Region {
  const tiles: number[] = [];
  const id = s.regions.length;
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = tidx(s, x, y);
    if (!staticPass(s.tiles[i])) continue;
    if (indoor !== (s.tiles[i] === T.FLOOR || s.tiles[i] === T.DOOR)) { if (indoor) continue; }
    tiles.push(i);
    if (s.region[i] < 0) s.region[i] = id;
  }
  const r: Region = { id, name, kind, tiles, cx: (x0 + x1) / 2, cy: (y0 + y1) / 2, x0, y0, x1, y1, indoor, searchable };
  s.regions.push(r);
  return r;
}

export function addProp(s: Scene, kind: PropKind, x: number, y: number, extra: Partial<Prop> = {}): Prop {
  const p: Prop = { id: s.props.length, kind, x, y, w: 1, h: 1, blocking: false, hp: 0, ...extra };
  s.props.push(p);
  if (p.blocking) for (let yy = y; yy < y + p.h; yy++) for (let xx = x; xx < x + p.w; xx++) s.propAt[tidx(s, xx, yy)] = p.id;
  return p;
}

function addCas(s: Scene, x: number, y: number, mob: Mobility, health: number, bleed: number, concealment: number, extra: Partial<Casualty> = {}): Casualty {
  const c: Casualty = {
    id: s.casualties.length, label: String.fromCharCode(65 + s.casualties.length),
    x, y, px: x, py: y, health, bleed, mob, trapWork: mob === 'trapped' ? 14 : 0, concealment, inVehicle: null,
    where: 'scene', treated: false, treatProg: 0, dead: false, treatQ: 0, bleed0: bleed, bystander: false, walking: false, path: null, pathI: 0, panic: false,
    wander: false, wanderT: 0, isTarget: false, hostage: false,
    tDiscovered: -1, tFreed: -1, tTreated: -1, tSafe: -1, tLoaded: -1, tDead: -1, tHospital: -1, discoveredBy: -1, causeEvent: -1,
    ...extra,
  };
  s.casualties.push(c);
  return c;
}

function addHostile(s: Scene, x: number, y: number, weapon: Hostile['weapon'], aggression: number, skill: number, hidden: boolean, fleeAt: number): Hostile {
  const h: Hostile = {
    id: s.hostiles.length, label: '용의자 ' + (s.hostiles.length + 1), x, y, px: x, py: y,
    health: 100, morale: 0.55 + aggression * 0.45, aggression, skill, weapon, state: 'hold', hidden, cooldown: 1, fleeAt,
    path: null, pathI: 0, negot: 0, seenOfficers: 0, targetRid: -1,
    facing: Math.PI / 2, lookAt: 0, stunUntil: -1, hostageId: -1, deadline: Infinity, alertUntil: -1,
  };
  s.hostiles.push(h);
  return h;
}

/**
 * 방에 가구를 놓는다. 벽에 붙은 칸에만, 문 주변은 비우고, 놓은 뒤에도 방 안의 모든 칸이 문과 이어져 있을 때만 확정한다.
 * 가구 칸은 T.FURN(통행 불가, 시야는 통과, 엄폐물)이며 불에 잘 탄다.
 */
function furnish(s: Scene, rng: Rng, r: Region, kinds: number[], count: number, flammable = true): void {
  const w = s.w;
  const isWall = (i: number): boolean => s.tiles[i] === T.WALL || s.tiles[i] === T.WINDOW;
  const doors = r.tiles.filter((i) => s.tiles[i] === T.DOOR);
  const nearDoor = (i: number): boolean => {
    const x = i % w, y = (i / w) | 0;
    for (let yy = y - 1; yy <= y + 1; yy++) for (let xx = x - 1; xx <= x + 1; xx++) { if (xx < 0 || yy < 0 || xx >= s.w || yy >= s.h) continue; if (s.tiles[yy * w + xx] === T.DOOR) return true; }
    return false;
  };
  const connected = (): boolean => {
    const walk = r.tiles.filter((i) => s.tiles[i] === T.FLOOR || s.tiles[i] === T.DOOR);
    if (!walk.length) return false;
    const inR = new Set(walk), seen = new Set<number>([doors.length ? doors[0] : walk[0]]), st = [doors.length ? doors[0] : walk[0]];
    while (st.length) { const c = st.pop()!; for (const d of [1, -1, w, -w]) { const j = c + d; if (inR.has(j) && !seen.has(j) && !(Math.abs(d) === 1 && ((j / w) | 0) !== ((c / w) | 0))) { seen.add(j); st.push(j); } } }
    return seen.size === walk.length;
  };
  let placed = 0;
  for (let tries = 0; tries < count * 6 && placed < count; tries++) {
    const i = rng.pick(r.tiles);
    if (s.tiles[i] !== T.FLOOR || nearDoor(i) || s.fire[i] > 0) continue;
    const x = i % w;
    if (!(isWall(i - w) || isWall(i + w) || (x > 0 && isWall(i - 1)) || (x < w - 1 && isWall(i + 1)))) continue;
    s.tiles[i] = T.FURN;
    if (!connected()) { s.tiles[i] = T.FLOOR; continue; }
    s.decor[i] = rng.pick(kinds);
    if (flammable) s.fuel[i] = 1;
    placed++;
  }
}

function freeTileIn(s: Scene, r: Region, rng: Rng, avoid: (i: number) => boolean = () => false): number {
  for (let k = 0; k < 40; k++) {
    const i = rng.pick(r.tiles);
    if (s.tiles[i] !== T.FLOOR || s.propAt[i] >= 0 || avoid(i)) continue;
    if (s.casualties.some((c) => tidx(s, Math.round(c.x), Math.round(c.y)) === i)) continue;
    return i;
  }
  return r.tiles.find((i) => s.tiles[i] === T.FLOOR && s.propAt[i] < 0) ?? r.tiles[0];
}

// ───────────────────────── 건물 화재 ─────────────────────────
function buildFire(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  const sev = I.truth.severity, dist = I.truth.district;
  for (let y = 17; y < SH; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.ROAD);
  const bx0 = 6, bx1 = 25, by0 = 2, by1 = 13;
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) set(s, x, y, x === bx0 || x === bx1 || y === by0 || y === by1 ? T.WALL : T.FLOOR);
  for (let x = bx0 + 1; x < bx1; x++) { set(s, x, 6, T.WALL); set(s, x, 9, T.WALL); }
  const prefix = dist === 'industrial' ? '작업실' : dist === 'commercial' ? '점포' : dist === 'outskirts' ? '객실' : '호실';
  let roomNo = 1;
  const rooms: Region[] = [];
  const mkSide = (y0: number, y1: number, doorY: number, winY: number) => {
    const parts = rng.chance(0.55) ? [11, 16, 20] : [13, 19];
    for (const px of parts) for (let y = y0; y <= y1; y++) set(s, px, y, T.WALL);
    const bounds = [bx0, ...parts, bx1];
    for (let k = 0; k < bounds.length - 1; k++) {
      const x0 = bounds[k] + 1, x1 = bounds[k + 1] - 1;
      const dx = rng.int(x0, x1);
      set(s, dx, doorY, T.DOOR);
      addProp(s, 'door', dx, doorY, { open: false, locked: false });
      const wx = Math.round((x0 + x1) / 2);
      set(s, wx, winY, T.WINDOW);
      const r = addRegion(s, `${prefix} ${roomNo++}`, 'room', x0, y0, x1, y1, true, true);
      s.region[tidx(s, dx, doorY)] = r.id; r.tiles.push(tidx(s, dx, doorY));
      rooms.push(r);
    }
  };
  mkSide(3, 5, 6, 2);
  mkSide(10, 12, 9, 13);
  s.floorMat = dist === 'industrial' ? 2 : dist === 'commercial' ? 1 : 0;
  const kinds = dist === 'industrial' ? [DECOR.MACHINE, DECOR.CRATE, DECOR.CRATE, DECOR.CABINET] : dist === 'commercial' ? [DECOR.COUNTER, DECOR.SHELF, DECOR.TABLE, DECOR.CRATE] : [DECOR.BED, DECOR.DESK, DECOR.SOFA, DECOR.CABINET, DECOR.PLANT];
  for (const r of rooms) furnish(s, rng, r, kinds, rng.int(2, 3), false);
  // 출입구
  const wy = rng.pick([7, 8]), ey = rng.pick([7, 8]);
  set(s, bx0, wy, T.DOOR); addProp(s, 'door', bx0, wy, { open: false, locked: false });
  set(s, bx1, ey, T.DOOR);
  const hz = (v: number): number => Math.min(0.95, v * sim.tune.hazardMul);
  const eastLocked = rng.chance(hz(0.45));
  addProp(s, 'door', bx1, ey, { open: false, locked: eastLocked, blocking: eastLocked, hp: rng.range(7, 11) });
  const corridor = addRegion(s, '복도', 'corridor', bx0, 7, bx1, 8, true, false);
  s.exits.push({ x: bx0 - 1, y: wy }, { x: bx1 + 1, y: ey });
  s.staging = { x: 3, y: 17 }; s.safe = { x: 3, y: 14 }; s.vantage = { x: 4, y: wy + 2 };
  addProp(s, 'hydrant', 27, 16, {});
  // 가연물
  for (const r of rooms) for (const i of r.tiles) s.fuel[i] = s.tiles[i] === T.DOOR ? 0.3 : s.tiles[i] === T.FURN ? 1 : rng.range(0.55, 1.0) * (dist === 'industrial' ? 1.15 : 1);
  for (const i of corridor.tiles) if (s.fuel[i] === 0) s.fuel[i] = rng.range(0.4, 0.56);
  for (let i = 0; i < s.fuel.length; i++) if (s.fuel[i] > 0) s.totalFuelTiles++;
  // 발화
  const origin = rng.pick(rooms);
  const falseAlarm = I.truth.variant === 'false';      // 오인 신고: 탄 냄새만 나고 불은 없다
  const seeds = falseAlarm ? 0 : sev >= 3 ? 3 : sev >= 2 ? 2 : 1;
  for (let k = 0; k < seeds; k++) { const i = freeTileIn(s, origin, rng); s.fire[i] = rng.range(0.4, 0.6) + sev * 0.09; }
  // 규모가 큰 화재: 발화실 문이 열려 있고(연소 확대가 빠름), 가장 큰 화재는 인접 실에도 이미 불이 붙어 있다
  if (sev >= 2) { const d = s.props.find((p) => p.kind === 'door' && s.region[tidx(s, p.x, p.y)] === origin.id); if (d) d.open = true; }
  if (sev >= 3) {
    const near = rooms.filter((q) => q !== origin).sort((a, b) => Math.hypot(a.cx - origin.cx, a.cy - origin.cy) - Math.hypot(b.cx - origin.cx, b.cy - origin.cy))[0];
    const i2 = freeTileIn(s, near, rng); s.fire[i2] = rng.range(0.3, 0.5);
  }
  // 숨겨진 조건
  if (rng.chance(hz(0.24))) {
    const dxm = rng.int(11, 20);
    for (const yy of [7, 8]) addProp(s, 'debris', dxm, yy, { blocking: true, hp: rng.range(9, 15) });
  }
  if (rng.chance(hz(0.2))) {
    const r = rng.pick(rooms.filter((q) => q !== origin));
    const d = s.props.find((p) => p.kind === 'door' && s.region[tidx(s, p.x, p.y)] === r.id);
    if (d) { d.locked = true; d.blocking = true; d.hp = rng.range(5, 9); s.propAt[tidx(s, d.x, d.y)] = d.id; }
  }
  if (!falseAlarm && rng.chance(hz(dist === 'industrial' ? 0.42 : 0.13))) {
    const r = rng.pick(rooms.filter((q) => q !== origin));
    const i = freeTileIn(s, r, rng);
    addProp(s, 'gas', i % SW, (i / SW) | 0, {});
  }
  if (rng.chance(hz(0.6))) {
    const far = rooms.filter((r) => r.cx > 17);
    const r = rng.pick(far);
    for (const i of r.tiles) s.shadow[i] = 1;
  }
  // 구조 대상
  const count = falseAlarm ? 0 : sev >= 3 ? rng.int(2, 4) : sev >= 2 ? rng.int(1, 3) : rng.int(0, 1);
  for (let k = 0; k < count; k++) {
    const r = rng.chance(0.9) ? rng.pick(rooms.filter((q) => q !== origin)) : origin;
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
  const nW = sev >= 3 ? 3 : 2;
  const wrecks: Prop[] = [];
  for (let k = 0; k < nW; k++) {
    const x = 11 + k * 4 + rng.int(-1, 1), y = rng.pick([9, 10]);
    const p = addProp(s, 'vehicle', x, y, { w: 2, h: 1, blocking: true, hp: 10, leak: 0, leakRate: 0, occupants: [], angle: rng.range(-0.35, 0.35), color: rng.int(0, 4) });
    wrecks.push(p);
    addRegion(s, `차량 ${k + 1}`, 'wreck', x - 1, y - 1, x + 2, y + 1, false, true);
  }
  const vN = addRegion(s, '북측 수풀', 'verge', 6, 2, 24, 6, false, true);
  const vS = addRegion(s, '남측 수풀', 'verge', 8, 13, 24, 17, false, true);
  // 탑승자
  for (const w of wrecks) {
    const n = sev >= 2 && s.casualties.length < 4 ? rng.int(1, 2) : 1;
    for (let k = 0; k < n; k++) {
      const roll = rng.next();
      const pTrap = sev >= 3 ? 0.4 : sev >= 2 ? 0.28 : 0.08;
      if (roll < pTrap) {
        const c = addCas(s, w.x + k, w.y, 'trapped', rng.range(45, 75), rng.range(0.16, 0.31), 0.3, { inVehicle: w.id });
        c.trapWork = rng.range(12, 20); w.occupants!.push(c.id);
      } else if (roll < pTrap + 0.3) {
        const c = addCas(s, w.x + k, w.y, 'immobile', rng.range(50, 80), rng.range(0.12, 0.25), 0.3, { inVehicle: w.id });
        w.occupants!.push(c.id);
      } else {
        const sy = w.y === 9 ? 7 : 12;
        addCas(s, w.x + k + rng.int(-1, 1), sy, 'mobile', rng.range(72, 96), rng.range(0.0, 0.05), 0);
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
function buildArmed(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  const sev = I.truth.severity, variant = I.truth.variant;
  for (let y = 16; y <= 18; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.ROAD);
  const bx0 = 8, bx1 = 22, by0 = 2, by1 = 10;
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) set(s, x, y, x === bx0 || x === bx1 || y === by0 || y === by1 ? T.WALL : T.FLOOR);
  for (let x = bx0 + 1; x < bx1; x++) set(s, x, 5, T.WALL);
  for (let y = 3; y <= 4; y++) set(s, 15, y, T.WALL);
  set(s, 12, 5, T.DOOR); addProp(s, 'door', 12, 5, { open: false });
  set(s, 18, 5, T.DOOR); addProp(s, 'door', 18, 5, { open: false });
  for (const [x, y] of [[12, 7], [12, 8], [18, 7], [18, 8]]) { set(s, x, y, T.WALL); s.decor[tidx(s, x, y)] = DECOR.SHELF; }       // 키 큰 진열대(시야를 가린다)
  s.floorMat = 1;
  set(s, 15, by1, T.DOOR); addProp(s, 'door', 15, by1, { open: true });
  for (const x of [10, 11, 19, 20]) set(s, x, by1, T.WINDOW);
  set(s, 11, by0, T.DOOR); addProp(s, 'door', 11, by0, { open: false });
  const shop = addRegion(s, '매장', 'room', 9, 6, 21, 9, true, true);
  const storage = addRegion(s, '창고', 'room', 9, 3, 14, 4, true, true);
  const office = addRegion(s, '사무실', 'room', 16, 3, 21, 4, true, true);
  for (const [x, y, r] of [[12, 5, storage.id], [18, 5, office.id], [15, by1, shop.id], [11, by0, storage.id]] as number[][]) { const i = tidx(s, x, y); s.region[i] = r; s.regions[r].tiles.push(i); }
  s.exits.push({ x: 15, y: 11 }, { x: 11, y: 1 });
  furnish(s, rng, shop, [DECOR.COUNTER, DECOR.COUNTER, DECOR.SHELF, DECOR.PLANT], 4, false);
  furnish(s, rng, storage, [DECOR.CRATE, DECOR.CRATE, DECOR.CABINET], 3, false);
  furnish(s, rng, office, [DECOR.DESK, DECOR.CABINET, DECOR.SOFA], 2, false);
  // 엄폐물(주차 차량)
  for (const [x, y] of [[10, 13], [15, 14], [20, 13]]) addProp(s, 'cover', x, y, { w: 2, h: 1, blocking: true, color: rng.int(0, 4) });
  s.spots = [
    { x: 15, y: 15, exit: 0, taken: -1 }, { x: 16, y: 15, exit: 0, taken: -1 }, { x: 10, y: 14, exit: 0, taken: -1 }, { x: 21, y: 14, exit: 0, taken: -1 },
    { x: 7, y: 1, exit: 1, taken: -1 }, { x: 14, y: 1, exit: 1, taken: -1 },
    { x: 11, y: 14, exit: -1, taken: -1 },
  ];
  s.staging = { x: 1, y: 18 }; s.safe = { x: 2, y: 14 }; s.vantage = { x: 10, y: 14 };
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
    h.facing = Math.PI / 2; h.deadline = sim.t + rng.range(270, 350) + tn.fleeShift * 2;
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
  const bx0 = 9, bx1 = 20, by0 = 4, by1 = 12;
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) set(s, x, y, x === bx0 || x === bx1 || y === by0 || y === by1 ? T.WALL : T.FLOOR);
  for (let y = by0 + 1; y < by1; y++) set(s, 15, y, T.WALL);
  for (let x = bx0 + 1; x < 15; x++) set(s, x, 8, T.WALL);
  set(s, 15, 10, T.DOOR); addProp(s, 'door', 15, 10, { open: true });
  set(s, 12, 8, T.DOOR); addProp(s, 'door', 12, 8, { open: rng.chance(0.6) });
  set(s, 12, by1, T.DOOR);
  const locked = rng.chance(Math.min(0.9, 0.16 * sim.tune.hazardMul));       // 혼자 쓰러져 문을 열어 줄 사람이 없다
  addProp(s, 'door', 12, by1, { open: false, locked, blocking: locked, hp: rng.range(5, 8) });
  for (const [x, y] of [[11, by0], [18, by0], [bx0, 6], [bx1, 8], [17, by1]]) set(s, x, y, T.WINDOW);
  const living = addRegion(s, '거실', 'room', 10, 9, 14, 11, true, true);
  const bed = addRegion(s, '침실', 'room', 10, 5, 14, 7, true, true);
  const kitchen = addRegion(s, '주방', 'room', 16, 5, 19, 11, true, true);
  for (const [x, y, r] of [[15, 10, kitchen.id], [12, 8, bed.id], [12, by1, living.id]] as number[][]) { const i = tidx(s, x, y); s.region[i] = r; s.regions[r].tiles.push(i); }
  s.exits.push({ x: 12, y: by1 + 1 });
  s.staging = { x: 3, y: 17 }; s.safe = { x: 4, y: 14 }; s.vantage = { x: 12, y: 14 };
  furnish(s, rng, living, [DECOR.SOFA, DECOR.TABLE, DECOR.PLANT, DECOR.CABINET], 3, false);
  furnish(s, rng, bed, [DECOR.BED, DECOR.CABINET, DECOR.DESK], 2, false);
  furnish(s, rng, kitchen, [DECOR.KITCHEN, DECOR.KITCHEN, DECOR.TABLE, DECOR.CABINET], 4, false);
  const room = rng.pick([living, bed, kitchen]);
  const i = freeTileIn(s, room, rng);
  if (variant === 'arrest') addCas(s, i % SW, (i / SW) | 0, 'immobile', rng.range(58, 70), rng.range(0.5, 0.66), 0.05);
  else if (variant === 'trauma') addCas(s, i % SW, (i / SW) | 0, 'immobile', rng.range(60, 80), rng.range(0.15, 0.24), 0.05);
  else addCas(s, i % SW, (i / SW) | 0, 'immobile', rng.range(70, 88), rng.range(0.05, 0.1), 0.05);
  s.leadDept = 'ems';
  return s;
}

// ───────────────────────── 건물 붕괴 · 가스 누출 (공통 건물 뼈대) ─────────────────────────
interface Shell { rooms: Region[]; corridor: Region; bx0: number; bx1: number; by0: number; by1: number }
/** 가운데 복도 양쪽으로 방이 늘어선 건물. 서쪽·동쪽 끝에 출입구가 있다. */
function shellBuilding(s: Scene, rng: Rng, prefix: string, kinds: number[]): Shell {
  for (let y = 17; y < SH; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.ROAD);
  const bx0 = 6, bx1 = 25, by0 = 2, by1 = 13;
  for (let y = by0; y <= by1; y++) for (let x = bx0; x <= bx1; x++) set(s, x, y, x === bx0 || x === bx1 || y === by0 || y === by1 ? T.WALL : T.FLOOR);
  for (let x = bx0 + 1; x < bx1; x++) { set(s, x, 6, T.WALL); set(s, x, 9, T.WALL); }
  let roomNo = 1;
  const rooms: Region[] = [];
  const mkSide = (y0: number, y1: number, doorY: number, winY: number): void => {
    const parts = rng.chance(0.5) ? [12, 19] : [11, 16, 20];
    for (const px of parts) for (let y = y0; y <= y1; y++) set(s, px, y, T.WALL);
    const bounds = [bx0, ...parts, bx1];
    for (let k = 0; k < bounds.length - 1; k++) {
      const x0 = bounds[k] + 1, x1 = bounds[k + 1] - 1;
      const dx = rng.int(x0, x1);
      set(s, dx, doorY, T.DOOR);
      addProp(s, 'door', dx, doorY, { open: rng.chance(0.5), locked: false });
      set(s, Math.round((x0 + x1) / 2), winY, T.WINDOW);
      const r = addRegion(s, `${prefix} ${roomNo++}`, 'room', x0, y0, x1, y1, true, true);
      s.region[tidx(s, dx, doorY)] = r.id; r.tiles.push(tidx(s, dx, doorY));
      rooms.push(r);
    }
  };
  mkSide(3, 5, 6, 2);
  mkSide(10, 12, 9, 13);
  for (const r of rooms) furnish(s, rng, r, kinds, rng.int(2, 3), false);
  const wy = rng.pick([7, 8]), ey = rng.pick([7, 8]);
  set(s, bx0, wy, T.DOOR); addProp(s, 'door', bx0, wy, { open: false, locked: false });
  set(s, bx1, ey, T.DOOR); addProp(s, 'door', bx1, ey, { open: false, locked: false });
  const corridor = addRegion(s, '복도', 'corridor', bx0, 7, bx1, 8, true, false);
  s.exits.push({ x: bx0 - 1, y: wy }, { x: bx1 + 1, y: ey });
  s.staging = { x: 3, y: 17 }; s.safe = { x: 3, y: 14 }; s.vantage = { x: 4, y: wy + 2 };
  addProp(s, 'hydrant', 27, 16, {});
  for (const r of rooms) for (const i of r.tiles) s.fuel[i] = s.tiles[i] === T.DOOR ? 0.25 : rng.range(0.35, 0.7);
  for (const i of corridor.tiles) if (s.fuel[i] === 0) s.fuel[i] = rng.range(0.25, 0.4);
  for (let i = 0; i < s.fuel.length; i++) if (s.fuel[i] > 0) s.totalFuelTiles++;
  s.leadDept = 'fire';
  return { rooms, corridor, bx0, bx1, by0, by1 };
}

function buildCollapse(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  const sev = I.truth.severity, dist = I.truth.district;
  s.floorMat = dist === 'industrial' ? 2 : dist === 'commercial' ? 1 : 0;
  const kinds = dist === 'industrial' ? [DECOR.CRATE, DECOR.CRATE, DECOR.CABINET, DECOR.MACHINE] : dist === 'commercial' ? [DECOR.COUNTER, DECOR.TABLE, DECOR.CRATE, DECOR.SHELF] : [DECOR.BED, DECOR.DESK, DECOR.SOFA, DECOR.CABINET];
  const B = shellBuilding(s, rng, dist === 'industrial' ? '창고' : dist === 'commercial' ? '점포' : '호실', kinds);
  const hz = (v: number): number => Math.min(0.95, v * sim.tune.hazardMul);
  // 무너진 구역: 건물 한쪽의 안쪽 벽이 넘어가고 잔해가 깔린다
  const zw = rng.int(5, 6 + sev), zh = rng.int(4, 5 + sev);
  const zx0 = rng.int(B.bx0 + 1, B.bx1 - zw), zy0 = rng.int(B.by0 + 1, B.by1 - zh);
  const zx1 = zx0 + zw - 1, zy1 = zy0 + zh - 1;
  const zone: number[] = [];
  for (let y = zy0; y <= zy1; y++) for (let x = zx0; x <= zx1; x++) {
    const i = tidx(s, x, y), t = s.tiles[i];
    if (t === T.WALL && rng.chance(0.75)) s.tiles[i] = T.FLOOR;
    else if (t === T.FURN && rng.chance(0.6)) { s.tiles[i] = T.FLOOR; s.decor[i] = 0; }
    if (s.tiles[i] === T.DOOR) { const d = s.props.find((p) => p.kind === 'door' && p.x === x && p.y === y); if (d) d.open = true; }
    s.damage[i] = 1;
    if (s.tiles[i] === T.FLOOR) { zone.push(i); if (s.fuel[i] === 0) s.fuel[i] = 0.3; }
    s.smoke[i] = 0.55;
  }
  for (const i of zone) if (s.region[i] < 0) s.region[i] = B.corridor.id;
  for (const i of zone) if (rng.chance(0.17 + 0.03 * sev)) addProp(s, 'debris', i % SW, (i / SW) | 0, { blocking: true, hp: rng.range(8, 14) });
  if (rng.chance(hz(0.3))) for (const yy of [7, 8]) { const dx = rng.int(9, 22); if (s.propAt[tidx(s, dx, yy)] < 0) addProp(s, 'debris', dx, yy, { blocking: true, hp: rng.range(8, 13) }); }
  const free = (): number => { for (let k = 0; k < 60; k++) { const i = rng.pick(zone); if (s.propAt[i] < 0 && s.tiles[i] === T.FLOOR) return i; } return -1; };
  // 금이 간 구조물 (보강하지 않으면 다시 무너진다)
  const nUnstable = sev >= 3 ? 2 : rng.chance(hz(0.7)) ? 1 + (sev >= 2 && rng.chance(0.4) ? 1 : 0) : 0;
  for (let k = 0; k < nUnstable; k++) { const i = free(); if (i >= 0) addProp(s, 'unstable', i % SW, (i / SW) | 0, { leak: rng.range(0, 0.25), leakRate: rng.range(0.0045, 0.008) * (0.8 + 0.2 * sim.tune.hazardMul) }); }
  // 구조 대상
  const count = sev >= 3 ? rng.int(4, 6) : sev >= 2 ? rng.int(2, 4) : rng.int(1, 2);
  for (let k = 0; k < count; k++) {
    const used = (q: number): boolean => s.casualties.some((c) => c.x === q % SW && c.y === ((q / SW) | 0)) || s.props.some((p) => p.kind === 'unstable' && p.x === q % SW && p.y === ((q / SW) | 0));
    let i = rng.chance(0.75) ? free() : freeTileIn(s, rng.pick(B.rooms), rng);
    if (i < 0 || used(i)) i = freeTileIn(s, rng.pick(B.rooms), rng, used);
    const roll = rng.next(), inZone = s.damage[i] === 1;
    const mob: Mobility = inZone ? (roll < 0.62 ? 'trapped' : roll < 0.88 ? 'immobile' : 'mobile') : roll < 0.3 ? 'immobile' : 'mobile';
    const c = addCas(s, i % SW, (i / SW) | 0, mob, mob === 'mobile' ? rng.range(76, 100) : rng.range(46, 84), mob === 'mobile' ? 0.02 : rng.range(0.07, 0.19), mob === 'trapped' ? rng.range(0.4, 0.7) : rng.range(0.12, 0.45));
    if (mob === 'trapped') c.trapWork = rng.range(14, 22);
  }
  // 끊어진 배선에서 불이 붙는 경우
  if (rng.chance(hz(0.22))) { const r = rng.pick(B.rooms); const i = freeTileIn(s, r, rng); s.fire[i] = rng.range(0.35, 0.5); }
  if (rng.chance(hz(0.35))) for (const i of zone) if (i % SW >= (zx0 + zx1) / 2) s.shadow[i] = 1;
  return s;
}

function buildHazmat(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  const sev = I.truth.severity, dist = I.truth.district;
  s.floorMat = dist === 'residential' ? 1 : 2;
  const kinds = dist === 'commercial' || dist === 'residential' ? [DECOR.MACHINE, DECOR.CABINET, DECOR.CRATE, DECOR.COUNTER] : [DECOR.MACHINE, DECOR.MACHINE, DECOR.CRATE, DECOR.CABINET];
  const B = shellBuilding(s, rng, dist === 'industrial' ? '공정실' : '기계실', kinds);
  const hz = (v: number): number => Math.min(0.95, v * sim.tune.hazardMul);
  // 새는 배관: 벽에 붙은 자리에 놓는다
  const nValve = sev >= 3 && rng.chance(hz(0.5)) ? 2 : 1;
  const leakRooms: Region[] = [];
  for (let k = 0; k < nValve; k++) {
    const r = rng.pick(B.rooms.filter((q) => leakRooms.indexOf(q) < 0));
    const wallAdj = r.tiles.filter((i) => s.tiles[i] === T.FLOOR && s.propAt[i] < 0 && (s.tiles[i - SW] === T.WALL || s.tiles[i + SW] === T.WALL) && s.tiles[i - 1] !== T.DOOR && s.tiles[i + 1] !== T.DOOR && s.tiles[i - SW] !== T.DOOR && s.tiles[i + SW] !== T.DOOR);
    const i = wallAdj.length ? rng.pick(wallAdj) : freeTileIn(s, r, rng);
    addProp(s, 'valve', i % SW, (i / SW) | 0, { blocking: true, leakRate: Math.min(1, 0.5 + 0.14 * sev + rng.range(0, 0.1)) });
    leakRooms.push(r);
  }
  // 안에 있던 사람들: 누출 지점에 가까울수록 쓰러져 있다
  const count = sev >= 3 ? rng.int(3, 5) : sev >= 2 ? rng.int(1, 3) : rng.int(0, 2);
  for (let k = 0; k < count; k++) {
    const r = rng.chance(0.5) ? rng.pick(leakRooms) : rng.pick(B.rooms);
    const i = freeTileIn(s, r, rng, (q) => s.casualties.some((c) => c.x === q % SW && c.y === ((q / SW) | 0)));
    const near = leakRooms.indexOf(r) >= 0;
    const mob: Mobility = rng.chance(near ? 0.7 : 0.3) ? 'immobile' : 'mobile';
    addCas(s, i % SW, (i / SW) | 0, mob, mob === 'mobile' ? rng.range(78, 100) : rng.range(52, 82), mob === 'mobile' ? 0.02 : rng.range(0.05, 0.12), rng.range(0.1, 0.4));
  }
  if (rng.chance(hz(0.2))) { const r = rng.pick(B.rooms); const d = s.props.find((p) => p.kind === 'door' && s.region[tidx(s, p.x, p.y)] === r.id); if (d) { d.open = false; d.locked = true; d.blocking = true; d.hp = rng.range(5, 9); s.propAt[tidx(s, d.x, d.y)] = d.id; } }
  if (rng.chance(hz(0.5))) { const r = rng.pick(B.rooms.filter((q) => q.cx > 15)); for (const i of r.tiles) s.shadow[i] = 1; }
  return s;
}

export function buildScene(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = I.truth.type === 'collapse' ? buildCollapse(sim, I, rng) : I.truth.type === 'hazmat' ? buildHazmat(sim, I, rng) : I.truth.type === 'fire' ? buildFire(sim, I, rng) : I.truth.type === 'traffic' ? buildTraffic(sim, I, rng) : I.truth.type === 'search' ? buildSearch(sim, I, rng) : I.truth.type === 'medical' ? buildMedical(sim, I, rng) : buildArmed(sim, I, rng);
  // 심각도 설정: 부상 악화 속도
  for (const c of s.casualties) { c.bleed *= sim.tune.bleedMul; c.bleed0 = c.bleed; }
  return s;
}
