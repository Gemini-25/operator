// FieldSceneManager (생성부) — 사건마다 작은 독립 2D 현장 공간을 만든다.
// 여기서 만들어지는 것은 "진실"이다. AI 는 현장에서 관찰하기 전까지 이 내용을 모른다.

import type { Sim } from '../engine';
import type { Rng } from '../rng';
import { T } from '../types';
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
    regions: [], props: [], casualties: [], hostiles: [], agents: [],
    staging: { x: 3, y: 17 }, safe: { x: 4, y: 15 }, vantage: { x: 4, y: 12 }, exits: [], spots: [],
    controlPts: [], controlDone: [], laneRows: [], cars: [], nextCarAt: 0, trafficFlow: 0,
    indoorVision: 7, outdoorVision: vis, exposure: sim.weather === 'rain' || sim.weather === 'night' ? 0.06 : 0.02,
    startedAt: sim.t, arrivedAt: -1, commanderRid: -1, leadDept: 'fire',
    board: [], nextWorkId: 0, radio: [], nextMsgId: 0, requests: [], zoneProb: [], fx: [], rng,
    totalFuelTiles: 0, burnedTiles: 0, burning: 0, secureAt: -1, fireOutAt: -1, lastSitrep: -99, sizeupDone: false, closing: false,
    entryOrdered: false, negotStart: -1, researchRound: 0, lastSpreadEvent: -99, collapseDone: new Set(), mismatchLogged: false, closedCheckAt: 0,
    staticVersion: 0, archived: false, idleSince: -1,
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
    where: 'scene', treated: false, treatProg: 0, dead: false, walking: false, path: null, pathI: 0, panic: false,
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
  };
  s.hostiles.push(h);
  return h;
}

function freeTileIn(s: Scene, r: Region, rng: Rng, avoid: (i: number) => boolean = () => false): number {
  for (let k = 0; k < 40; k++) {
    const i = rng.pick(r.tiles);
    if (s.tiles[i] === T.DOOR || s.propAt[i] >= 0 || avoid(i)) continue;
    if (s.casualties.some((c) => tidx(s, Math.round(c.x), Math.round(c.y)) === i)) continue;
    return i;
  }
  return r.tiles[0];
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
  // 출입구
  const wy = rng.pick([7, 8]), ey = rng.pick([7, 8]);
  set(s, bx0, wy, T.DOOR); addProp(s, 'door', bx0, wy, { open: false, locked: false });
  set(s, bx1, ey, T.DOOR);
  const eastLocked = rng.chance(0.45);
  addProp(s, 'door', bx1, ey, { open: false, locked: eastLocked, blocking: eastLocked, hp: rng.range(7, 11) });
  const corridor = addRegion(s, '복도', 'corridor', bx0, 7, bx1, 8, true, false);
  s.exits.push({ x: bx0 - 1, y: wy }, { x: bx1 + 1, y: ey });
  s.staging = { x: 3, y: 17 }; s.safe = { x: 3, y: 14 }; s.vantage = { x: 4, y: wy + 2 };
  addProp(s, 'hydrant', 27, 16, {});
  // 가연물
  for (const r of rooms) for (const i of r.tiles) s.fuel[i] = s.tiles[i] === T.DOOR ? 0.3 : rng.range(0.55, 1.0) * (dist === 'industrial' ? 1.15 : 1);
  for (const i of corridor.tiles) if (s.fuel[i] === 0) s.fuel[i] = rng.range(0.4, 0.56);
  for (let i = 0; i < s.fuel.length; i++) if (s.fuel[i] > 0) s.totalFuelTiles++;
  // 발화
  const origin = rng.pick(rooms);
  const seeds = sev >= 3 ? 3 : sev >= 2 ? 2 : 1;
  for (let k = 0; k < seeds; k++) { const i = freeTileIn(s, origin, rng); s.fire[i] = rng.range(0.4, 0.6) + sev * 0.09; }
  // 규모가 큰 화재: 발화실 문이 열려 있고(연소 확대가 빠름), 가장 큰 화재는 인접 실에도 이미 불이 붙어 있다
  if (sev >= 2) { const d = s.props.find((p) => p.kind === 'door' && s.region[tidx(s, p.x, p.y)] === origin.id); if (d) d.open = true; }
  if (sev >= 3) {
    const near = rooms.filter((q) => q !== origin).sort((a, b) => Math.hypot(a.cx - origin.cx, a.cy - origin.cy) - Math.hypot(b.cx - origin.cx, b.cy - origin.cy))[0];
    const i2 = freeTileIn(s, near, rng); s.fire[i2] = rng.range(0.3, 0.5);
  }
  // 숨겨진 조건
  if (rng.chance(0.24)) {
    const dxm = rng.int(11, 20);
    for (const yy of [7, 8]) addProp(s, 'debris', dxm, yy, { blocking: true, hp: rng.range(9, 15) });
  }
  if (rng.chance(0.2)) {
    const r = rng.pick(rooms.filter((q) => q !== origin));
    const d = s.props.find((p) => p.kind === 'door' && s.region[tidx(s, p.x, p.y)] === r.id);
    if (d) { d.locked = true; d.blocking = true; d.hp = rng.range(5, 9); s.propAt[tidx(s, d.x, d.y)] = d.id; }
  }
  if (rng.chance(dist === 'industrial' ? 0.42 : 0.13)) {
    const r = rng.pick(rooms.filter((q) => q !== origin));
    const i = freeTileIn(s, r, rng);
    addProp(s, 'gas', i % SW, (i / SW) | 0, {});
  }
  if (rng.chance(0.6)) {
    const far = rooms.filter((r) => r.cx > 17);
    const r = rng.pick(far);
    for (const i of r.tiles) s.shadow[i] = 1;
  }
  // 구조 대상
  const count = sev >= 3 ? rng.int(2, 4) : sev >= 2 ? rng.int(1, 3) : rng.int(0, 1);
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
        const c = addCas(s, w.x + k, w.y, 'trapped', rng.range(45, 75), rng.range(0.13, 0.28), 0.3, { inVehicle: w.id });
        c.trapWork = rng.range(12, 20); w.occupants!.push(c.id);
      } else if (roll < pTrap + 0.3) {
        const c = addCas(s, w.x + k, w.y, 'immobile', rng.range(50, 80), rng.range(0.09, 0.22), 0.3, { inVehicle: w.id });
        w.occupants!.push(c.id);
      } else {
        const sy = w.y === 9 ? 7 : 12;
        addCas(s, w.x + k + rng.int(-1, 1), sy, 'mobile', rng.range(72, 96), rng.range(0.0, 0.05), 0);
      }
    }
  }
  if (sev >= 2 && rng.chance(0.3)) {
    const w = rng.pick(wrecks); w.emptySeat = true;
    const v = rng.chance(0.5) ? vN : vS;
    const i = freeTileIn(s, v, rng, (q) => Math.abs((q % SW) - w.x) > 6);
    set(s, i % SW, (i / SW) | 0, T.TREE);
    addCas(s, i % SW, (i / SW) | 0, 'immobile', rng.range(42, 66), rng.range(0.16, 0.27), rng.range(0.55, 0.7));
  }
  if (rng.chance(0.2 + sev * 0.07)) { const w = rng.pick(wrecks); w.leak = 0.12; w.leakRate = rng.range(0.0052, 0.0085); }
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
  const conc = rng.range(0.42, 0.68) + (s.tiles[ti] === T.TREE ? 0.12 : 0);
  addCas(s, tx, tyy, wander ? 'mobile' : 'immobile', wander ? rng.range(70, 90) : rng.range(52, 80) - sev * 4,
    wander ? rng.range(0.03, 0.07) + sev * 0.015 : rng.range(0.08, 0.14) + sev * 0.03, conc, { isTarget: true, wander, wanderT: sim.t + 10 });
  if (sev >= 3 && !wander) {
    const i2 = freeTileIn(s, tz, rng, (q) => Math.hypot((q % SW) - tx, ((q / SW) | 0) - tyy) > 3.5 || s.tiles[q] === T.TRAIL);
    addCas(s, i2 % SW, (i2 / SW) | 0, 'immobile', rng.range(55, 80), rng.range(0.04, 0.09), conc * 0.8, { isTarget: true });
  }
  // 목격자 / 단서
  if (rng.chance(0.65)) {
    const accurate = rng.chance(0.58);
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
  if (rng.chance(0.4)) { const z = rng.pick(zones.filter((q) => q.cx > 18)); for (const i of z.tiles) if (s.tiles[i] === T.TREE || rng.chance(0.5)) s.shadow[i] = 1; }
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
  for (const [x, y] of [[12, 7], [12, 8], [18, 7], [18, 8]]) set(s, x, y, T.WALL);       // 진열대
  set(s, 15, by1, T.DOOR); addProp(s, 'door', 15, by1, { open: true });
  for (const x of [10, 11, 19, 20]) set(s, x, by1, T.WINDOW);
  set(s, 11, by0, T.DOOR); addProp(s, 'door', 11, by0, { open: false });
  const shop = addRegion(s, '매장', 'room', 9, 6, 21, 9, true, true);
  const storage = addRegion(s, '창고', 'room', 9, 3, 14, 4, true, true);
  const office = addRegion(s, '사무실', 'room', 16, 3, 21, 4, true, true);
  for (const [x, y, r] of [[12, 5, storage.id], [18, 5, office.id], [15, by1, shop.id], [11, by0, storage.id]] as number[][]) { const i = tidx(s, x, y); s.region[i] = r; s.regions[r].tiles.push(i); }
  s.exits.push({ x: 15, y: 11 }, { x: 11, y: 1 });
  // 엄폐물(주차 차량)
  for (const [x, y] of [[10, 13], [15, 14], [20, 13]]) addProp(s, 'cover', x, y, { w: 2, h: 1, blocking: true, color: rng.int(0, 4) });
  s.spots = [
    { x: 15, y: 15, exit: 0, taken: -1 }, { x: 16, y: 15, exit: 0, taken: -1 }, { x: 10, y: 14, exit: 0, taken: -1 }, { x: 21, y: 14, exit: 0, taken: -1 },
    { x: 7, y: 1, exit: 1, taken: -1 }, { x: 14, y: 1, exit: 1, taken: -1 },
    { x: 11, y: 14, exit: -1, taken: -1 },
  ];
  s.staging = { x: 1, y: 18 }; s.safe = { x: 2, y: 14 }; s.vantage = { x: 10, y: 14 };
  const fleeBase = sim.t + rng.range(85, 150);
  const inShop = () => { const i = freeTileIn(s, shop, rng, (q) => ((q / SW) | 0) > 8); return { x: i % SW, y: (i / SW) | 0 }; };
  if (variant === 'dispute') {
    const p = inShop();
    addHostile(s, p.x, p.y, rng.chance(0.6) ? 'knife' : 'none', rng.range(0.12, 0.4), 0.3, false, Infinity);
  } else if (variant === 'shooter') {
    const p = inShop();
    addHostile(s, p.x, p.y, 'gun', rng.range(0.78, 0.95), rng.range(0.4, 0.7), false, Infinity);
  } else {
    const n = sev >= 3 ? 2 : 1;
    for (let k = 0; k < n; k++) { const p = inShop(); addHostile(s, p.x, p.y, 'gun', rng.range(0.35, 0.7), rng.range(0.3, 0.6), false, fleeBase + k * 4); }
    if (sev >= 2 && rng.chance(0.35)) { const i = freeTileIn(s, storage, rng); addHostile(s, i % SW, (i / SW) | 0, 'gun', rng.range(0.4, 0.7), rng.range(0.3, 0.55), true, fleeBase + 20); }
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

export function buildScene(sim: Sim, I: Incident, rng: Rng): Scene {
  switch (I.truth.type) {
    case 'fire': return buildFire(sim, I, rng);
    case 'traffic': return buildTraffic(sim, I, rng);
    case 'search': return buildSearch(sim, I, rng);
    default: return buildArmed(sim, I, rng);
  }
}
