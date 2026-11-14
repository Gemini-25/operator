// 건물 평면 생성기. 같은 유형의 사건이라도 매번 다른 건물이 나오도록 틀을 여러 종 둔다.
//   corridor  가운데 복도 양쪽으로 방이 늘어선 건물
//   suite     방과 방이 문으로 이어진 건물 (복도 없음, 이분할로 만든다)
//   hall      큰 홀 하나와 한쪽에 늘어선 작은 방들
//   tall      2층 건물: 두 층의 평면을 같은 격자에 나란히 놓고 계단 칸으로 잇는다
// 모두 아래쪽에 도로(y 17~19)가 있고, 대기 지점·안전 구역은 건물 왼쪽 아래에 둔다.

import type { Rng } from '../rng';
import { DECOR, T } from '../types';
import type { Prop, Region, Scene } from '../types';
import { tidx } from './grid';
import { SH, SW, addProp, addRegion, furnish, get, set } from './kit';

export type Arch = 'corridor' | 'suite' | 'hall';
export interface Rect { x0: number; y0: number; x1: number; y1: number }
export interface Plan {
  arch: Arch | 'tall';
  rooms: Region[];             // 수색 대상인 방 (홀 포함)
  corridors: Region[];
  hall: Region | null;
  floors: Rect[];              // 층별 바닥 범위 (벽 포함). 단층이면 하나
  exitDoors: Prop[];           // s.exits 와 같은 순서의 출입문
  innerDoors: Prop[];          // 방과 방, 방과 복도 사이의 문
}
export interface PlanOpts {
  prefix: string;              // 방 이름 앞말 ("호실", "점포" …)
  hallName?: string;           // 홀 이름 ("매장", "작업장" …)
  kinds: number[];             // 방에 놓을 가구
  hallKinds?: number[];
  racks?: boolean;             // 홀에 키 큰 선반(시야를 가린다)을 세운다
}

const isFloor = (s: Scene, x: number, y: number): boolean => x >= 0 && y >= 0 && x < SW && y < SH && get(s, x, y) === T.FLOOR;

function carve(s: Scene, r: Rect): void {
  for (let y = r.y0; y <= r.y1; y++) for (let x = r.x0; x <= r.x1; x++) set(s, x, y, x === r.x0 || x === r.x1 || y === r.y0 || y === r.y1 ? T.WALL : T.FLOOR);
}
function door(s: Scene, x: number, y: number, region: Region | null, extra: Partial<Prop> = {}): Prop {
  set(s, x, y, T.DOOR);
  const p = addProp(s, 'door', x, y, { open: false, locked: false, ...extra });
  if (region) { const i = tidx(s, x, y); s.region[i] = region.id; region.tiles.push(i); }
  return p;
}
/** 구간 [a, b] 를 k 칸으로 나누는 칸막이 위치 (각 칸은 최소 3칸 폭) */
function partitions(rng: Rng, a: number, b: number, k: number): number[] {
  const out: number[] = [];
  const w = b - a + 1;
  for (let j = 1; j < k; j++) {
    let p = a + Math.round((j * (w + 1)) / k) - 1 + rng.int(-1, 1);
    const lo = (out.length ? out[out.length - 1] : a - 1) + 4;
    p = Math.max(lo, Math.min(b - 3 - (k - 1 - j) * 4, p));
    out.push(p);
  }
  return out;
}
function road(s: Scene): void {
  for (let y = 17; y < SH; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.ROAD);
}
function common(s: Scene, x0: number): void {
  s.staging = { x: 3, y: 17 }; s.safe = { x: 3, y: 14 }; s.vantage = { x: Math.max(1, x0 - 2), y: 10 };
  addProp(s, 'hydrant', 27, 16, {});
  s.leadDept = 'fire';
}
/** 바깥벽에 창을 낸다: 방마다 바깥벽 한가운데 (문 옆은 피한다) */
function windows(s: Scene, rooms: Region[], f: Rect): void {
  for (const r of rooms) {
    const cands: [number, number][] = [];
    if (r.y0 - 1 === f.y0) cands.push([Math.round((r.x0 + r.x1) / 2), f.y0]);
    if (r.y1 + 1 === f.y1) cands.push([Math.round((r.x0 + r.x1) / 2), f.y1]);
    if (r.x0 - 1 === f.x0) cands.push([f.x0, Math.round((r.y0 + r.y1) / 2)]);
    if (r.x1 + 1 === f.x1) cands.push([f.x1, Math.round((r.y0 + r.y1) / 2)]);
    for (const [x, y] of cands) {
      if (get(s, x, y) !== T.WALL) continue;
      let nearDoor = false;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx >= 0 && ny >= 0 && nx < SW && ny < SH && get(s, nx, ny) === T.DOOR) nearDoor = true; }
      if (!nearDoor) set(s, x, y, T.WINDOW);
    }
  }
}

function corridorPlan(s: Scene, rng: Rng, o: PlanOpts): Plan {
  const f: Rect = { x0: rng.int(6, 8), y0: 2, x1: rng.int(22, 25), y1: 13 };
  carve(s, f);
  for (let x = f.x0 + 1; x < f.x1; x++) { set(s, x, 6, T.WALL); set(s, x, 9, T.WALL); }
  const rooms: Region[] = [], innerDoors: Prop[] = [];
  let roomNo = 1;
  for (const [ya, yb, doorY] of [[3, 5, 6], [10, 12, 9]]) {
    const k = f.x1 - f.x0 - 1 >= 16 && rng.chance(0.55) ? 4 : 3;
    const parts = partitions(rng, f.x0 + 1, f.x1 - 1, k);
    for (const px of parts) for (let y = ya; y <= yb; y++) set(s, px, y, T.WALL);
    const bounds = [f.x0, ...parts, f.x1];
    for (let q = 0; q < bounds.length - 1; q++) {
      const xa = bounds[q] + 1, xb = bounds[q + 1] - 1;
      const r = addRegion(s, `${o.prefix} ${roomNo++}`, 'room', xa, ya, xb, yb, true, true);
      innerDoors.push(door(s, rng.int(xa, xb), doorY, r));
      rooms.push(r);
    }
  }
  const wy = rng.pick([7, 8]), ey = rng.pick([7, 8]);
  const exitDoors = [door(s, f.x0, wy, null), door(s, f.x1, ey, null)];
  const corridor = addRegion(s, '복도', 'corridor', f.x0, 7, f.x1, 8, true, false);
  s.exits.push({ x: f.x0 - 1, y: wy }, { x: f.x1 + 1, y: ey });
  windows(s, rooms, f);
  for (const r of rooms) furnish(s, rng, r, o.kinds, rng.int(2, 3), false);
  common(s, f.x0);
  return { arch: 'corridor', rooms, corridors: [corridor], hall: null, floors: [f], exitDoors, innerDoors };
}

interface Leaf { xa: number; ya: number; xb: number; yb: number }
interface Cut { vertical: boolean; p: number; a: number; b: number }

/** 주어진 범위를 방 여러 개로 쪼갠다. 벽마다 문을 하나 이상 내므로 모든 방이 이어진다. */
export function suiteRooms(s: Scene, rng: Rng, f: Rect, prefix: string, names?: string[]): { rooms: Region[]; innerDoors: Prop[] } {
  const leaves: Leaf[] = [], cuts: Cut[] = [];
  const split = (r: Leaf, depth: number): void => {
    const w = r.xb - r.xa + 1, h = r.yb - r.ya + 1;
    const canV = w >= 7, canH = h >= 7;
    if ((!canV && !canH) || depth >= 4 || (depth >= 2 && w * h <= 30 && rng.chance(0.45))) { leaves.push(r); return; }
    const vertical = canV && (!canH || w > h || (w === h && rng.chance(0.5)));
    if (vertical) {
      const p = rng.int(r.xa + 3, r.xb - 3);
      for (let y = r.ya; y <= r.yb; y++) set(s, p, y, T.WALL);
      cuts.push({ vertical: true, p, a: r.ya, b: r.yb });
      split({ xa: r.xa, ya: r.ya, xb: p - 1, yb: r.yb }, depth + 1); split({ xa: p + 1, ya: r.ya, xb: r.xb, yb: r.yb }, depth + 1);
    } else {
      const p = rng.int(r.ya + 3, r.yb - 3);
      for (let x = r.xa; x <= r.xb; x++) set(s, x, p, T.WALL);
      cuts.push({ vertical: false, p, a: r.xa, b: r.xb });
      split({ xa: r.xa, ya: r.ya, xb: r.xb, yb: p - 1 }, depth + 1); split({ xa: r.xa, ya: p + 1, xb: r.xb, yb: r.yb }, depth + 1);
    }
  };
  split({ xa: f.x0 + 1, ya: f.y0 + 1, xb: f.x1 - 1, yb: f.y1 - 1 }, 0);
  const rooms = leaves.map((l, k) => addRegion(s, names && names[k] ? names[k] : `${prefix} ${k + 1}`, 'room', l.xa, l.ya, l.xb, l.yb, true, true));
  const innerDoors: Prop[] = [];
  const regionAt = (x: number, y: number): Region | null => { const id = s.region[tidx(s, x, y)]; return id >= 0 ? s.regions[id] : null; };
  for (const c of cuts) {
    const cands: number[] = [];
    for (let q = c.a; q <= c.b; q++) if (c.vertical ? isFloor(s, c.p - 1, q) && isFloor(s, c.p + 1, q) : isFloor(s, q, c.p - 1) && isFloor(s, q, c.p + 1)) cands.push(q);
    if (!cands.length) continue;
    const q1 = rng.pick(cands);
    const put = (q: number): void => { const x = c.vertical ? c.p : q, y = c.vertical ? q : c.p; innerDoors.push(door(s, x, y, c.vertical ? regionAt(c.p + 1, q) : regionAt(q, c.p + 1), { open: rng.chance(0.35) })); };
    put(q1);
    const far = cands.filter((q) => Math.abs(q - q1) >= 4);
    if (far.length && rng.chance(0.3)) put(rng.pick(far));      // 길이 하나뿐이지 않도록 가끔 문을 하나 더 낸다
  }
  return { rooms, innerDoors };
}

function suitePlan(s: Scene, rng: Rng, o: PlanOpts): Plan {
  const f: Rect = { x0: rng.int(6, 9), y0: rng.int(2, 3), x1: rng.int(21, 25), y1: rng.int(12, 13) };
  carve(s, f);
  const { rooms, innerDoors } = suiteRooms(s, rng, f, o.prefix);
  // 출입구: 도로 쪽(남쪽) 벽에 정문, 북쪽 벽에 후문
  const pickOn = (y: number, inY: number, avoid = -99): number => {
    const c: number[] = [];
    for (let x = f.x0 + 2; x <= f.x1 - 2; x++) if (get(s, x, y) === T.WALL && isFloor(s, x, inY) && get(s, x - 1, y) === T.WALL && get(s, x + 1, y) === T.WALL && Math.abs(x - avoid) > 3) c.push(x);
    return c.length ? rng.pick(c) : Math.round((f.x0 + f.x1) / 2);
  };
  const fx = pickOn(f.y1, f.y1 - 1), rx = pickOn(f.y0, f.y0 + 1, fx);
  const regionOf = (x: number, y: number): Region | null => { const id = s.region[tidx(s, x, y)]; return id >= 0 ? s.regions[id] : null; };
  const exitDoors = [door(s, fx, f.y1, regionOf(fx, f.y1 - 1)), door(s, rx, f.y0, regionOf(rx, f.y0 + 1))];
  s.exits.push({ x: fx, y: f.y1 + 1 }, { x: rx, y: f.y0 - 1 });
  windows(s, rooms, f);
  for (const r of rooms) furnish(s, rng, r, o.kinds, rng.int(2, 3), false);
  common(s, f.x0);
  return { arch: 'suite', rooms, corridors: [], hall: null, floors: [f], exitDoors, innerDoors };
}

function hallPlan(s: Scene, rng: Rng, o: PlanOpts): Plan {
  const f: Rect = { x0: rng.int(6, 8), y0: 2, x1: rng.int(22, 25), y1: rng.int(12, 13) };
  carve(s, f);
  const ys = f.y0 + 4;      // 북쪽 방들과 홀 사이의 벽
  for (let x = f.x0 + 1; x < f.x1; x++) set(s, x, ys, T.WALL);
  const rooms: Region[] = [], innerDoors: Prop[] = [];
  const k = f.x1 - f.x0 - 1 >= 16 && rng.chance(0.5) ? 4 : 3;
  const parts = partitions(rng, f.x0 + 1, f.x1 - 1, k);
  for (const px of parts) for (let y = f.y0 + 1; y < ys; y++) set(s, px, y, T.WALL);
  const bounds = [f.x0, ...parts, f.x1];
  for (let q = 0; q < bounds.length - 1; q++) {
    const xa = bounds[q] + 1, xb = bounds[q + 1] - 1;
    const r = addRegion(s, `${o.prefix} ${q + 1}`, 'room', xa, f.y0 + 1, xb, ys - 1, true, true);
    innerDoors.push(door(s, rng.int(xa, xb), ys, r, { open: rng.chance(0.3) }));
    rooms.push(r);
  }
  // 홀 안의 키 큰 선반: 시야를 가리는 벽 칸
  if (o.racks) {
    const n = rng.int(2, 3), span = f.x1 - f.x0 - 5;
    for (let q = 0; q < n; q++) {
      const rx = f.x0 + 3 + Math.round(((q + 0.5) * span) / n) + rng.int(-1, 1), len = rng.int(2, 3), ry = ys + 2 + rng.int(0, 1);
      for (let y = ry; y < ry + len && y <= f.y1 - 3; y++) if (get(s, rx, y) === T.FLOOR && get(s, rx, ys) !== T.DOOR) { set(s, rx, y, T.WALL); s.decor[tidx(s, rx, y)] = DECOR.SHELF; }
    }
  }
  const hall = addRegion(s, o.hallName ?? '홀', 'room', f.x0 + 1, ys + 1, f.x1 - 1, f.y1 - 1, true, true);
  rooms.push(hall);
  const fc: number[] = [];
  for (let x = f.x0 + 3; x <= f.x1 - 3; x++) if (isFloor(s, x, f.y1 - 1)) fc.push(x);
  const fx = rng.pick(fc);
  const west = rng.chance(0.5), sy = rng.int(ys + 2, f.y1 - 2);
  const exitDoors = [door(s, fx, f.y1, hall), door(s, west ? f.x0 : f.x1, sy, hall)];
  s.exits.push({ x: fx, y: f.y1 + 1 }, { x: west ? f.x0 - 1 : f.x1 + 1, y: sy });
  windows(s, rooms, f);
  for (const r of rooms) if (r !== hall) furnish(s, rng, r, o.kinds, rng.int(2, 3), false);
  furnish(s, rng, hall, o.hallKinds ?? o.kinds, rng.int(4, 6), false);
  common(s, f.x0);
  return { arch: 'hall', rooms, corridors: [], hall, floors: [f], exitDoors, innerDoors };
}

export function planBuilding(s: Scene, rng: Rng, arch: Arch, o: PlanOpts): Plan {
  road(s);
  return arch === 'suite' ? suitePlan(s, rng, o) : arch === 'hall' ? hallPlan(s, rng, o) : corridorPlan(s, rng, o);
}

/**
 * 2층 건물. 왼쪽이 1층, 오른쪽이 2층이다. 두 층 사이는 빈 공간(VOID)이라 시야·불·연기가 벽을 넘어가지 않고,
 * 각 층 복도 동쪽 끝의 계단 칸으로만 오간다. 출입구는 1층에만 있다.
 */
export function tallPlan(s: Scene, rng: Rng, o: PlanOpts): Plan {
  road(s);
  for (let y = 0; y <= 13; y++) for (let x = 16; x < SW; x++) set(s, x, y, T.VOID);
  const rooms: Region[] = [], corridors: Region[] = [], innerDoors: Prop[] = [], floors: Rect[] = [];
  let roomNo = 1;
  for (const [ox, level] of [[3, 1], [17, 2]]) {
    const f: Rect = { x0: ox, y0: 2, x1: ox + 11, y1: 12 };
    floors.push(f);
    carve(s, f);
    for (let x = f.x0 + 1; x < f.x1; x++) { set(s, x, 6, T.WALL); set(s, x, 8, T.WALL); }
    for (const [ya, yb, doorY, winY] of [[3, 5, 6, f.y0], [9, 11, 8, f.y1]]) {
      const px = ox + rng.int(5, 6);
      for (let y = ya; y <= yb; y++) set(s, px, y, T.WALL);
      for (const [xa, xb] of [[f.x0 + 1, px - 1], [px + 1, f.x1 - 1]]) {
        const r = addRegion(s, `${level}층 ${o.prefix} ${roomNo++}`, 'room', xa, ya, xb, yb, true, true);
        innerDoors.push(door(s, rng.int(xa, xb), doorY, r));
        set(s, Math.round((xa + xb) / 2), winY, T.WINDOW);
        rooms.push(r);
      }
    }
    corridors.push(addRegion(s, `${level}층 복도`, 'corridor', f.x0 + 1, 7, f.x1 - 1, 7, true, false));
  }
  for (const r of rooms) furnish(s, rng, r, o.kinds, rng.int(1, 2), false);
  const st1 = tidx(s, 13, 7), st2 = tidx(s, 27, 7);
  s.tiles[st1] = T.STAIR; s.tiles[st2] = T.STAIR; s.stairTo[st1] = st2; s.stairTo[st2] = st1;
  const exitDoors = [door(s, 3, 7, null), door(s, 14, 7, null)];
  s.exits.push({ x: 2, y: 7 }, { x: 15, y: 7 });
  common(s, 3);
  s.vantage = { x: 1, y: 9 };
  return { arch: 'tall', rooms, corridors, hall: null, floors, exitDoors, innerDoors };
}

/** 통로를 잔해로 막는다: 복도가 있으면 복도를, 없으면 안쪽 문 하나의 앞을 막는다. */
export function blockPassage(s: Scene, rng: Rng, P: Plan, hp: [number, number]): void {
  if (P.corridors.length) {
    const c = rng.pick(P.corridors);
    const x = rng.int(c.x0 + 3, c.x1 - 3);
    for (let y = c.y0; y <= c.y1; y++) { const i = tidx(s, x, y); if (s.tiles[i] === T.FLOOR && s.propAt[i] < 0) addProp(s, 'debris', x, y, { blocking: true, hp: rng.range(hp[0], hp[1]) }); }
    return;
  }
  if (!P.innerDoors.length) return;
  const d = rng.pick(P.innerDoors);
  const sides = [[1, 0], [-1, 0], [0, 1], [0, -1]].map(([dx, dy]) => [d.x + dx, d.y + dy]).filter(([x, y]) => isFloor(s, x, y) && s.propAt[tidx(s, x, y)] < 0);
  if (sides.length) { const [x, y] = rng.pick(sides); addProp(s, 'debris', x, y, { blocking: true, hp: rng.range(hp[0], hp[1]) }); }
}

/** 출입문을 잠근다 (강제 개방이 필요해진다) */
export function lockDoor(s: Scene, d: Prop, hp: number): void {
  d.open = false; d.locked = true; d.blocking = true; d.hp = hp; s.propAt[tidx(s, d.x, d.y)] = d.id;
}
