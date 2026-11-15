// 현장 생성 도구: 빈 현장, 타일·구역·소품·사람을 놓는 함수, 가구 배치.
// 여기서 만들어지는 것은 "진실"이다. AI 는 현장에서 관찰하기 전까지 이 내용을 모른다.

import type { Sim } from '../engine';
import type { Rng } from '../rng';
import { T } from '../types';
import type { Casualty, Hostile, Incident, Mobility, Prop, PropKind, Region, Scene } from '../types';
import { staticPass, tidx } from './grid';

export const SW = 30;
export const SH = 20;

export function baseScene(sim: Sim, I: Incident, rng: Rng): Scene {
  const n = SW * SH;
  const vis = sim.weather === 'clear' ? 7.5 : sim.weather === 'rain' ? 5.8 : sim.weather === 'fog' ? 4.0 : 4.6;
  return {
    id: I.id, incidentId: I.id, kind: I.truth.type, variant: I.truth.variant, w: SW, h: SH,
    tiles: new Uint8Array(n).fill(T.GROUND), region: new Int16Array(n).fill(-1),
    fire: new Float32Array(n), heat: new Float32Array(n), fuel: new Float32Array(n), smoke: new Float32Array(n),
    burned: new Uint8Array(n), wet: new Float32Array(n), shadow: new Uint8Array(n), propAt: new Int16Array(n).fill(-1),
    decor: new Uint8Array(n), glass: new Uint8Array(n), decorHp: new Uint8Array(n), floorMat: 0, damage: new Uint8Array(n), entryExit: -1, entryExit2: -1, stairTo: new Int16Array(n).fill(-1),
    regions: [], props: [], casualties: [], hostiles: [], agents: [],
    staging: { x: 3, y: 17 }, safe: { x: 4, y: 15 }, vantage: { x: 4, y: 12 }, exits: [], spots: [],
    controlPts: [], controlDone: [], laneRows: [], cars: [], nextCarAt: 0, trafficFlow: 0,
    indoorVision: 7, outdoorVision: vis, exposure: sim.weather === 'rain' || sim.weather === 'night' ? 0.06 : 0.02,
    startedAt: sim.t, arrivedAt: -1, commanderRid: -1, leadDept: 'fire',
    board: [], nextWorkId: 0, radio: [], nextMsgId: 0, requests: [], zoneProb: [], fx: [], rng,
    totalFuelTiles: 0, burnedTiles: 0, burning: 0, secureAt: -1, fireOutAt: -1, lastSitrep: -99, sizeupDone: false, closing: false,
    entryOrdered: false, negotStart: -1, researchRound: 0, lastSpreadEvent: -99, collapseDone: new Set(), mismatchLogged: false, closedCheckAt: 0,
    staticVersion: 0, archived: false, idleSince: -1, breachAt: -1, breachDone: false, bangAt: -99,
    outdoor: undefined, rules: undefined, placeName: undefined,      // 현장 틀마다 붙는 칸을 미리 비워 둔다 (모든 현장이 같은 모양)
    ruin: undefined, falls: undefined,      // (G4) 그림용 기록 칸 (field/ruins.ts). 무너진 현장에만 값이 생긴다
    clearVision: 7.5,      // (R1) 맑은 날의 바깥 시야 — 탐조등이 밤의 시야를 여기까지 올린다 (실종 현장은 3.8 로 덮어쓴다). 쓰는 것은 단계 5 부터
  };
}

export const set = (s: Scene, x: number, y: number, t: number): void => { s.tiles[tidx(s, x, y)] = t; };
export const get = (s: Scene, x: number, y: number): number => s.tiles[tidx(s, x, y)];

export function addRegion(s: Scene, name: string, kind: Region['kind'], x0: number, y0: number, x1: number, y1: number, indoor: boolean, searchable: boolean): Region {
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

// 소품마다 따로 붙던 선택 칸을 처음부터 같은 순서로 비워 둔다: 모든 소품이 같은 모양의 객체가 된다 (값은 없는 것과 같다)
const PROP_BLANK: Partial<Prop> = {
  locked: undefined, open: undefined, skin: undefined, leak: undefined, leakRate: undefined, mitigated: undefined, ignited: undefined,
  occupants: undefined, emptySeat: undefined, cleared: undefined, angle: undefined, color: undefined, exploded: undefined, found: undefined, dirRegion: undefined,
  interviewed: undefined, lastSeenRegion: undefined, accurate: undefined, removed: undefined, entered: undefined, bus: undefined, real: undefined, fuse: undefined,
};
export function addProp(s: Scene, kind: PropKind, x: number, y: number, extra: Partial<Prop> = {}): Prop {
  const p: Prop = { id: s.props.length, kind, x, y, w: 1, h: 1, blocking: false, hp: 0, ...PROP_BLANK, ...extra };
  s.props.push(p);
  if (p.blocking) for (let yy = y; yy < y + p.h; yy++) for (let xx = x; xx < x + p.w; xx++) s.propAt[tidx(s, xx, yy)] = p.id;
  return p;
}

export function addCas(s: Scene, x: number, y: number, mob: Mobility, health: number, bleed: number, concealment: number, extra: Partial<Casualty> = {}): Casualty {
  const c: Casualty = {
    id: s.casualties.length, label: String.fromCharCode(65 + s.casualties.length),
    x, y, px: x, py: y, health, bleed, mob, trapWork: mob === 'trapped' ? 14 : 0, concealment, inVehicle: null,
    where: 'scene', treated: false, treatProg: 0, dead: false, treatQ: 0, bleed0: bleed, bystander: false, walking: false, path: null, pathI: 0, panic: false,
    wander: false, wanderT: 0, isTarget: false, hostage: false, climb: undefined, bystander2: undefined, inWater: undefined, drift: undefined,      // 나중에 붙는 칸도 미리 (모든 구조 대상이 같은 모양)
    tDiscovered: -1, tFreed: -1, tTreated: -1, tSafe: -1, tLoaded: -1, tDead: -1, tHospital: -1, discoveredBy: -1, causeEvent: -1,
    injuries: undefined, bleedCause: undefined, deathCause: undefined, lost: undefined,      // (H1) 부상 기록 — 처음 상태의 원인은 injury.initInjuries 가 붙인다
    ...extra,
  };
  s.casualties.push(c);
  return c;
}

export function addHostile(s: Scene, x: number, y: number, weapon: Hostile['weapon'], aggression: number, skill: number, hidden: boolean, fleeAt: number): Hostile {
  const h: Hostile = {
    id: s.hostiles.length, label: '용의자 ' + (s.hostiles.length + 1), x, y, px: x, py: y,
    health: 100, morale: 0.55 + aggression * 0.45, aggression, skill, weapon, state: 'hold', hidden, cooldown: 1, fleeAt,
    path: null, pathI: 0, negot: 0, seenOfficers: 0, targetRid: -1,
    facing: Math.PI / 2, lookAt: 0, stunUntil: -1, hostageId: -1, deadline: Infinity, alertUntil: -1, moveAt: 0, shotAt: -99, retreated: false, dragging: false,
    // (H1) 부상 — 나중에 붙는 칸을 미리 비워 둔다 (모든 용의자가 같은 모양)
    injuries: undefined, bleed: undefined, bleed0: undefined, treatQ: undefined, tTreated: undefined, dead: undefined, tDown: undefined, tDead: undefined,
    where: undefined, bleedCause: undefined, deathCause: undefined, selfHarmRolled: undefined,
  };
  s.hostiles.push(h);
  return h;
}

/**
 * 방에 가구를 놓는다. 벽에 붙은 칸에만, 문 주변은 비우고, 놓은 뒤에도 방 안의 모든 칸이 문과 이어져 있을 때만 확정한다.
 * 가구 칸은 T.FURN(통행 불가, 시야는 통과, 엄폐물)이며 불에 잘 탄다.
 */
export function furnish(s: Scene, rng: Rng, r: Region, kinds: number[], count: number, flammable = true): void {
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

export function freeTileIn(s: Scene, r: Region, rng: Rng, avoid: (i: number) => boolean = () => false): number {
  for (let k = 0; k < 40; k++) {
    const i = rng.pick(r.tiles);
    if (s.tiles[i] !== T.FLOOR || s.propAt[i] >= 0 || avoid(i)) continue;
    if (s.casualties.some((c) => tidx(s, Math.round(c.x), Math.round(c.y)) === i)) continue;
    return i;
  }
  return r.tiles.find((i) => s.tiles[i] === T.FLOOR && s.propAt[i] < 0) ?? r.tiles[0];
}

