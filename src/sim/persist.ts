// 교대 간 지속 (I2 — docs/specs/I2-persistence.md). 교대가 끝난 뒤의 상태를 "이어받은 상태"(Carryover)로 만들고(makeCarryover),
// 다음 교대의 Sim 생성자가 그것을 입력(extra.carry)으로 받아 적용한다. 같은 시드 + 같은 난이도 + 같은 이어받은 상태 = 같은 결과.
//
// 이어받은 상태가 없으면(carryState.on 이 거짓) 이 파일의 모든 함수가 첫 줄에서 돌아가고, 난수도 기록도 더하지 않는다 —
// 지금과 기록 해시가 한 글자도 다르지 않다(설계서 §8 의 0단계 해시 목록).
//
// 단계 1 (틀): 자료형(CarryState·CarryNote) · readCarryover(검사하며 새 객체로) · carryKey · cityKey · 빈 initCarry · tickCarry(첫 줄 반환) ·
//   makeCarryover 의 뼈대(조직 명부의 모든 열쇠 — 앞 상태를 그대로 옮긴다) · shiftStartCounts · 생성자의 자리 applyCrewCarry(빈 함수)·announceCarry(요약 줄과 버린 것).
// 뒤 단계가 채운다: 2 대원(crewNext·applyCrewCarry·결장 상한·예비 인력) · 3 장비(펌프·정비·섬광탄 창고) · 4 도로(복구 공사) ·
//   5 건물(placeOutcome·placeUsable·placeCond·applyPlaceWear·noteWearIncident) · 7 보고서(carrySummary·carryLines).
//
// import: types · rng · events · resources(함수만 — 부를 때만 쓴다. resources → sceneManager → … 순환에서 모듈 맨 위의 표를 읽지 않는다) ·
//   crews(잎 모듈 — KITS) · field/injury(잎 모듈 — CAUSE_NAME) · difficulty(잎 모듈 — 이름표). incidents · dispatch/* · debrief 와 그 밖의 field/* 는 import 하지 않는다.
// 브라우저 저장은 표현 계층(view/runner.ts — 단계 6)에서만 한다 — src/sim 은 저장소를 모른다 (원칙 8, 시험 9 가 글자로 본다).

import { KITS } from './crews';
import { difficultyLabel } from './difficulty';
import type { Sim } from './engine';
import { emit } from './events';
import { CAUSE_NAME } from './field/injury';
import { rosterKeys } from './resources';
import { hashStr } from './rng';
import type { Carryover, City, CrewCarry, PlaceCarry, RecruitBase, RoadCarry, StockId, UnitCarry } from './types';

// ───────────────────────── 상수 (설계서 §6.1 — 처음 값. 바꾸면 구현 메모에 적는다) ─────────────────────────
/** 이어받은 상태의 판. 칸의 뜻이 바뀌면 올리고 readCarryover 에 옮기는 함수를 둔다 (선택 칸을 더하는 것은 올리지 않는다) */
export const CARRY_VERSION = 1;
/** 누적 경험·숙련의 상한 (이어갈수록 쉬워지는 "성장의 나선"을 막는다) */
export const EXP_CAP = 0.25;
export const SKILL_CAP = 0.15;
/** 순직한 자리에 신임 대원이 오기까지의 교대 수 */
export const REPLACE_AFTER = 2;
/** 서(署) 창고의 소모품 상한 */
export const STOCK_CAP = 10;
/** 건물 겹침 표의 상한, 그 가운데 출입 통제·무너짐의 상한, 복구 공사 도로의 상한 */
export const PLACE_CAP = 24;
export const CLOSED_CAP = 12;
export const ROAD_CAP = 6;

// ───────────────────────── 실행 중 상태 (§2.2) ─────────────────────────
export interface CarryState {
  on: boolean;                                   // 이어받은 상태가 있는가 (없으면 모든 함수가 첫 줄에서 돌아간다)
  places: Map<number, PlaceCarry>;               // 건물 겹침 표 (교대 내내 그대로 — 단계 5 가 sim.carry.places 의 사본으로 채운다)
  roads: RoadCarry[];                            // 이번 교대에 끝날 복구 공사 (left === 1, openAt 순 — 단계 4)
  slowed: { edge: number; v: number }[];         // 이 파일이 더해 둔 slow (한 차로 공사, 출입 통제 건물 앞 — 단계 4)
  svc: number;                                   // 정비 중인 부대 수 (tickCarry 가 0 이면 정비 쪽을 건너뛴다 — 단계 3)
  event: number;                                 // 이어받은 상태 요약 기록의 id (-1 = 없음). 원인으로 잇는다
  applied: CarryNote[];                          // ①·② 가 실제로 적용한 항목 (적용한 순서) — announceCarry 가 이것만 기록한다
  dropped: string[];                             // 적용하지 못한 것 (도시가 끊길 통제, 지도 지문 불일치, 조직 명부에 없는 열쇠, 상한을 넘은 항목) — announceCarry 가 적는다
  stats: { relief: number; serviced: number; reopened: number; markedInc: string[]; fbShort: number; early: number };
}
/** 적용한 항목 하나 (기록 한 줄의 재료). 상태를 바꾼 함수가 그 자리에서 push 한다 */
export type CarryNote =
  | { what: 'absent'; unit: string; names: string[]; cause: string | null; left: number }
  | { what: 'vacant'; unit: string; name: string; left: number }
  | { what: 'recruit'; unit: string; name: string; seat: string }
  | { what: 'early'; name: string }
  | { what: 'relief'; unit: string; name: string; role?: string }
  | { what: 'short'; unit: string; n: number }                       // 예비 인력이 모자라 최소 편성보다 적은 n명(내리는 대원)으로 운용 — oos 가 아니다(결원 감점만)
  | { what: 'empty'; unit: string; why: 'crew' | 'pilot' }          // 나올 내리는 대원이 한 명도 없거나(crew) 조종·조타할 사람이 없어(pilot) oos '결원'
  | { what: 'service'; unit: string; readyAt: number }
  | { what: 'rushed'; unit: string }                                 // SERVICE_CAP 을 넘어 '급히 정비 완료'
  | { what: 'stock'; unit: string; got: number; want: number }
  | { what: 'place'; id: number }                                    // closed·ruin 건물 (opened 도 이 항목으로)
  | { what: 'road'; edge: number; lane: boolean; left: number; openAt: number };

// ───────────────────────── 지문 (§2.3) ─────────────────────────
const hex8 = (n: number): string => (n >>> 0).toString(16).padStart(8, '0');
const cityKeys = new WeakMap<object, string>();
/**
 * 도시 지문: 건물 수·구간 수, 건물마다 종류·자리(정수), 구간마다 양 끝을 차례로 섞은 8자리 16진수. 지도(cityPlan.ts)를 바꾸면 건물·구간 id 가 달라지므로
 * 이어받은 건물·도로 상태를 버리는 데 쓴다. 지도는 한 번 만들어 모든 Sim 이 함께 쓰므로 city.places 를 열쇠로 한 번만 센다
 */
export function cityKey(city: City): string {
  const got = cityKeys.get(city.places);
  if (got !== undefined) return got;
  const parts: string[] = [String(city.places.length), String(city.edges.length)];
  for (const q of city.places) parts.push(q.kind + ':' + (q.x | 0) + ':' + (q.y | 0));
  for (const e of city.edges) parts.push(e.a + ':' + e.b);
  const k = hex8(hashStr(parts.join('|')));
  cityKeys.set(city.places, k);
  return k;
}
const cmpStr = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
/** 정해진 순서의 직렬화: 객체의 칸은 이름 순(undefined 인 칸은 뺀다), 배열은 그 순서 그대로 */
function canon(x: unknown): string {
  if (x === null || typeof x !== 'object') return JSON.stringify(x) ?? 'null';
  if (Array.isArray(x)) return '[' + x.map(canon).join(',') + ']';
  const o = x as Record<string, unknown>;
  const ks = Object.keys(o).filter((k) => o[k] !== undefined).sort(cmpStr);
  return '{' + ks.map((k) => JSON.stringify(k) + ':' + canon(o[k])).join(',') + '}';
}
/**
 * 이어받은 상태의 지문: from 을 뺀 나머지를 정해진 순서(대원은 열쇠 순, 부대는 호출부호 순, 건물·도로는 id 순, 객체의 칸은 이름 순)로
 * 직렬화한 8자리 16진수. 요약 기록에 넣어 이어받은 상태가 조금이라도 다르면 기록 해시가 달라지게 한다 (§4.2)
 */
export function carryKey(co: Carryover): string {
  const crew = co.crew.slice().sort((a, b) => cmpStr(a.seat ?? a.name, b.seat ?? b.name));
  const units = co.units.slice().sort((a, b) => cmpStr(a.callsign, b.callsign));
  const places = co.places.slice().sort((a, b) => a.id - b.id);
  const roads = co.roads.slice().sort((a, b) => a.edge - b.edge);
  return hex8(hashStr(canon({ v: co.v, shift: co.shift, city: co.city, crew, units, stock: co.stock, places, roads })));
}

// ───────────────────────── 읽기 — 검사하며 새 객체로 (§2.4) ─────────────────────────
type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x);
/** 유한한 수면 [lo, hi] 로 자른 값, 아니면 undefined */
function num(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : undefined;
}
/** 유한한 수면 반올림해 [lo, hi] 로 자른 정수, 아니면 undefined */
function int(v: unknown, lo: number, hi: number): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : undefined;
}
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined);
const oneOf = <T extends string>(v: unknown, list: readonly T[]): T | undefined => (typeof v === 'string' && (list as readonly string[]).indexOf(v) >= 0 ? (v as T) : undefined);

const PLACE_STATE = ['marked', 'closed', 'ruin'] as const;
const PLACE_CAUSE = ['fire', 'collapse', 'blast', 'burnout'] as const;
const PLACE_MARK = ['scorched', 'blasted', 'partial', 'burnt', 'collapsed'] as const;
const ROAD_WHY = ['crack', 'washout', 'flood', 'fire', 'mud', 'tree', 'debris', 'surface'] as const;
const SERVICE_WHY = ['pump', 'vehicle'] as const;
const STOCK_IDS: readonly StockId[] = ['flashbang'];

/** 신임 대원의 기본 능력: createRoster 의 범위로 자른다 (skill 0.3~0.98 · judgment 0.2~0.98 · 나머지 0~1 · experience 0~0.97) */
function readRecruit(x: unknown): RecruitBase | undefined {
  if (!isObj(x)) return undefined;
  const skill = num(x.skill, 0.3, 0.98), judgment = num(x.judgment, 0.2, 0.98), composure = num(x.composure, 0, 1), fitness = num(x.fitness, 0, 1),
    teamwork = num(x.teamwork, 0, 1), experience = num(x.experience, 0, 0.97);
  if (skill === undefined || judgment === undefined || composure === undefined || fitness === undefined || teamwork === undefined || experience === undefined) return undefined;
  return { skill, judgment, composure, fitness, teamwork, experience };
}
function readCrew(x: unknown): CrewCarry | null {
  if (!isObj(x)) return null;
  const name = str(x.name), callsign = str(x.callsign);
  const out = int(x.out, -1, 3), health = num(x.health, 1, 100), dExp = num(x.dExp, 0, EXP_CAP), dSkill = num(x.dSkill, 0, SKILL_CAP);
  const shifts = int(x.shifts, 0, Number.MAX_SAFE_INTEGER), incidents = int(x.incidents, 0, Number.MAX_SAFE_INTEGER);
  if (name === undefined || callsign === undefined || out === undefined || health === undefined || dExp === undefined || dSkill === undefined || shifts === undefined || incidents === undefined) return null;
  if (x.cause !== null && typeof x.cause !== 'string') return null;
  // 결장 이유는 H1 의 원인 이름만 (모르는 이름은 이유 없음으로 — 결장 자체는 남긴다)
  const cause = typeof x.cause === 'string' && Object.prototype.hasOwnProperty.call(CAUSE_NAME, x.cause) ? x.cause : null;
  const c: CrewCarry = { name, callsign, out, cause, health, dExp, dSkill, shifts, incidents };
  if (x.seat !== undefined) { const seat = str(x.seat); if (seat === undefined) return null; c.seat = seat; }
  if (x.replaceIn !== undefined) { const r = int(x.replaceIn, 0, REPLACE_AFTER); if (r === undefined) return null; c.replaceIn = r; }
  if (x.recruit !== undefined) { const rb = readRecruit(x.recruit); if (!rb) return null; c.recruit = rb; }
  if (x.kitFault !== undefined) {
    if (!Array.isArray(x.kitFault)) return null;
    const kf = x.kitFault.filter((k): k is string => typeof k === 'string' && Object.prototype.hasOwnProperty.call(KITS, k));      // R1 의 KitId 인 것만
    if (kf.length) c.kitFault = kf;
  }
  return c;
}
function readUnit(x: unknown): UnitCarry | null {
  if (!isObj(x)) return null;
  const callsign = str(x.callsign);
  if (callsign === undefined) return null;
  const u: UnitCarry = { callsign };
  if (x.pump !== undefined) { const p = num(x.pump, 0, 1); if (p === undefined) return null; u.pump = p; }
  if (x.service !== undefined) {
    if (!isObj(x.service)) return null;
    const readyAt = num(x.service.readyAt, 0, 900), why = oneOf(x.service.why, SERVICE_WHY);
    if (readyAt === undefined || why === undefined) return null;
    u.service = { readyAt, why };
  }
  return u;
}
function readPlace(x: unknown, city: City, shift: number): PlaceCarry | null {
  if (!isObj(x)) return null;
  const id = typeof x.id === 'number' && Number.isInteger(x.id) && x.id >= 0 && x.id < city.places.length ? x.id : undefined;
  let state = oneOf(x.state, PLACE_STATE);
  const cause = oneOf(x.cause, PLACE_CAUSE), inc = str(x.inc);
  const dmg = num(x.dmg, 0, 1), soot = num(x.soot, 0, 1), since = int(x.since, 1, shift);
  let repair = int(x.repair, 0, 6);
  if (id === undefined || state === undefined || cause === undefined || inc === undefined || dmg === undefined || soot === undefined || since === undefined || repair === undefined) return null;
  const q = city.places[id];
  if (q.facility >= 0) return null;                                                  // 출동 시설은 이어받지 않는다
  if (state !== 'marked' && (repair === 0 || q.open)) state = 'marked';              // 복구가 끝난 것으로 본다 / 열린 터는 흔적만 (§3.6)
  if (state === 'marked') repair = 0;
  const p: PlaceCarry = { id, state, dmg, soot, repair, cause, inc, since };
  if (x.spot !== undefined) {
    if (!Array.isArray(x.spot) || x.spot.length !== 2) return null;
    const u = num(x.spot[0], 0, 1), v = num(x.spot[1], 0, 1);
    if (u === undefined || v === undefined) return null;
    p.spot = [u, v];
  }
  if (x.mark !== undefined) { const m = oneOf(x.mark, PLACE_MARK); if (m === undefined) return null; p.mark = m; }
  if (x.opened !== undefined) { if (x.opened !== true) return null; p.opened = true; }
  return p;
}
function readRoad(x: unknown, city: City, shift: number): RoadCarry | null {
  if (!isObj(x)) return null;
  const edge = typeof x.edge === 'number' && Number.isInteger(x.edge) && x.edge >= 0 && x.edge < city.edges.length ? x.edge : undefined;
  const why = oneOf(x.why, ROAD_WHY), inc = str(x.inc);
  const left = int(x.left, 1, 2), openAt = num(x.openAt, 60, 900), since = int(x.since, 1, shift);
  if (edge === undefined || why === undefined || typeof x.lane !== 'boolean' || inc === undefined || left === undefined || openAt === undefined || since === undefined) return null;
  return { edge, why, lane: x.lane, left, openAt, inc, since };
}
/** 상한: 넘으면 남길 것만 (순서는 입력 그대로). 고르는 순서는 rank 가 큰 것, 같으면 id 가 작은 것 */
function capKeep<T>(list: T[], cap: number, rank: (t: T) => number, id: (t: T) => number, pick: (t: T) => boolean = () => true): { keep: T[]; cut: number } {
  const cands = list.filter(pick);
  if (cands.length <= cap) return { keep: list, cut: 0 };
  const kept = new Set(cands.slice().sort((a, b) => rank(b) - rank(a) || id(a) - id(b)).slice(0, cap));
  return { keep: list.filter((t) => !pick(t) || kept.has(t)), cut: cands.length - cap };
}

/**
 * 입력(저장소에서 읽은 것, 시험이 만든 것)을 검사하며 **새 객체로** 만든다 — 시뮬레이션은 이 결과만 쓰고 원래 입력은 건드리지 않는다.
 * 판이 다르거나 모양이 틀리면 null(새 조직으로 시작). 숫자는 범위로 자르고, 모르는 열거값·형식이 틀린 항목·같은 열쇠의 뒤 항목·
 * 조직 명부(resources.rosterKeys)에 없는 대원·편성표에 없는 부대는 버린다. 도시 지문이 다르면 건물·도로를 버린다. 상한도 여기서 건다.
 * 버린 것은 dropped 의 문장으로 돌려준다 (announceCarry 가 기록한다)
 */
export function readCarryover(x: unknown, city: City): { carry: Carryover; dropped: string[] } | null {
  if (!isObj(x)) return null;
  if (x.v !== CARRY_VERSION) return null;                                            // 옮기는 함수가 생기면 여기서 (v1 → v2)
  if (!Array.isArray(x.crew) || !Array.isArray(x.units) || !Array.isArray(x.places) || !Array.isArray(x.roads) || !isObj(x.stock)) return null;
  if (typeof x.shift !== 'number' || !Number.isInteger(x.shift) || x.shift < 1) return null;
  const shift = x.shift;
  const dropped: string[] = [];
  const from = isObj(x.from) ? { seed: str(x.from.seed) ?? '', hash: str(x.from.hash) ?? '', diff: str(x.from.diff) ?? '' } : { seed: '', hash: '', diff: '' };
  const ck = cityKey(city);
  const sameCity = x.city === ck;
  let bad = 0;
  // 대원 — 열쇠는 자리(seat ?? name). 조직 명부에 없는 열쇠는 버린다 (편성되지 않은 사람의 항목은 남는다 — §2.4)
  const keys = rosterKeys();
  const seats = new Set<string>(), units = new Set<string>();
  for (const k of keys) { seats.add(k.name); units.add(k.callsign); }
  const crew: CrewCarry[] = [], seen = new Set<string>();
  let stranger = 0;
  for (const it of x.crew) {
    const c = readCrew(it);
    if (!c) { bad++; continue; }
    const key = c.seat ?? c.name;
    if (!seats.has(key)) { stranger++; continue; }
    if (seen.has(key)) { bad++; continue; }
    seen.add(key); crew.push(c);
  }
  if (stranger) dropped.push(`조직 명부에 없는 대원 ${stranger}명의 기록은 버립니다.`);
  // 부대 — 열쇠는 호출부호 (편성표 UNIT_DEFS — 지원 부대는 들어오지 않는다)
  const unitList: UnitCarry[] = [], seenU = new Set<string>();
  let strangerU = 0;
  for (const it of x.units) {
    const u = readUnit(it);
    if (!u) { bad++; continue; }
    if (!units.has(u.callsign)) { strangerU++; continue; }
    if (seenU.has(u.callsign)) { bad++; continue; }
    seenU.add(u.callsign); unitList.push(u);
  }
  if (strangerU) dropped.push(`편성표에 없는 부대 ${strangerU}대의 기록은 버립니다.`);
  // 재고 — 아는 열쇠만
  const stock: Partial<Record<StockId, number>> = {};
  for (const id of STOCK_IDS) {
    if (x.stock[id] === undefined) continue;
    const n = int(x.stock[id], 0, STOCK_CAP);
    if (n === undefined) bad++; else stock[id] = n;
  }
  // 건물·도로 — 도시 지문이 같을 때만
  let places: PlaceCarry[] = [], roads: RoadCarry[] = [];
  if (!sameCity) dropped.push('도시 지도가 바뀌어 건물·도로 상태는 이어받지 않습니다.');
  else {
    const seenP = new Set<number>();
    for (const it of x.places) {
      const p = readPlace(it, city, shift);
      if (!p || seenP.has(p.id)) { bad++; continue; }
      seenP.add(p.id); places.push(p);
    }
    const seenR = new Set<number>();
    for (const it of x.roads) {
      const r = readRoad(it, city, shift);
      if (!r || seenR.has(r.edge)) { bad++; continue; }
      seenR.add(r.edge); roads.push(r);
    }
    // 상한 (§6.1): 출입 통제·무너짐 CLOSED_CAP → 건물 전체 PLACE_CAP → 도로 ROAD_CAP. 남은 교대(repair · left)가 큰 것, 같으면 id 가 작은 것을 남긴다
    const c1 = capKeep(places, CLOSED_CAP, (p) => p.repair, (p) => p.id, (p) => p.state !== 'marked');
    const c2 = capKeep(c1.keep, PLACE_CAP, (p) => p.repair, (p) => p.id);
    places = c2.keep;
    if (c1.cut + c2.cut) dropped.push(`남은 피해가 있는 건물이 많아 ${c1.cut + c2.cut}곳의 기록은 이어받지 않습니다.`);
    const c3 = capKeep(roads, ROAD_CAP, (r) => r.left, (r) => r.edge);
    roads = c3.keep;
    if (c3.cut) dropped.push(`복구 공사 도로가 많아 ${c3.cut}구간의 기록은 이어받지 않습니다.`);
  }
  if (bad) dropped.push(`형식이 맞지 않는 기록 ${bad}개는 버립니다.`);
  return { carry: { v: CARRY_VERSION, shift, city: ck, from, crew, units: unitList, stock, places, roads }, dropped };      // 지문이 달랐으면 건물·도로를 비운 채 지금 도시의 것으로
}

// ───────────────────────── 교대 시작 (§3.4) ─────────────────────────
/**
 * ① 이어받은 상태의 실행 중 상태를 만든다 (engine 생성자 — initTraffic 앞). 이어받은 상태가 없으면 빈 상태(on 거짓)를 돌려주고 아무것도 바꾸지 않는다.
 * 단계 4 가 도로 복구 통제(큰 차 우회로 검사)·한 차로·건물 앞 slow 를, 단계 5 가 건물 겹침 표(sim.carry.places 의 사본)를 여기서 채운다
 */
export function initCarry(sim: Sim, dropped: string[]): CarryState {
  return {
    on: sim.carry !== null, places: new Map(), roads: [], slowed: [], svc: 0, event: -1, applied: [], dropped: dropped.slice(),
    stats: { relief: 0, serviced: 0, reopened: 0, markedInc: [], fbShort: 0, early: 0 },
  };
}
/**
 * ② 대원·부대·재고의 적용 (engine 생성자 — createRoster 가 모든 난수를 뽑은 뒤 값만 바꾼다). 단계 2(결장·성장·예비 인력)·3(펌프·정비·섬광탄)이 채운다.
 * 이어받은 상태가 없으면 첫 줄에서 돌아간다
 */
export function applyCrewCarry(sim: Sim): void {
  if (!sim.carryState.on) return;
}
/**
 * '교대 시작' 기록의 가용 인원 (이어받은 상태가 있을 때만 engine 이 쓴다 — 없으면 지금 문구 그대로):
 * 정비·결원으로 oos 인 부대와 결장(off)인 대원을 '가용'에서 뺀다. 괄호 속 수가 0 이면 그 괄호를 뺀다
 */
export function shiftStartCounts(sim: Sim): string {
  let a = 0, b = 0, c = 0, d = 0;
  for (const u of sim.units) if (u.state === 'oos') b++; else a++;
  for (const r of sim.responders) if (r.status === 'off') d++; else c++;
  return `가용 부대 ${a}대${b ? `(정비·결원 ${b}대 제외)` : ''}, 대원 ${c}명${d ? `(결장 ${d}명 제외)` : ''}`;
}
/**
 * ③ 이어받은 상태의 기록 ('교대 시작'과 헬기 운항 줄 바로 뒤, 이어받은 상태가 있을 때만). 기록하는 것은 적용 목록(carryState.applied)과 버린 것(dropped)뿐이다 —
 * 적용은 '교대 시작' 기록 전이라 바로 그 자리에서 emit 할 수 없다 (원칙 5). 요약 줄의 첫머리는 측정 도구의 문구 규칙 T5 가 센다 — 바꾸지 않는다.
 * 요약 줄의 지문(carryKey) 때문에 이어받은 상태가 조금이라도 다르면 기록 해시가 다르다
 */
export function announceCarry(sim: Sim): void {
  const cs = sim.carryState, co = sim.carry;
  if (!cs.on || !co) return;
  // 요약의 몫 — 지금 상태에서 센다 (적용한 것만 상태에 있다). '숙련이 오른 대원'은 성장을 적용하는 단계 2 가 더한다
  let absent = 0, vacant = 0, closed = 0, ruin = 0, roads = 0;
  for (const r of sim.responders) if (r.status === 'off') { if (r.carryOut === -1) vacant++; else absent++; }
  for (const p of cs.places.values()) if (p.state !== 'marked') { closed++; if (p.state === 'ruin') ruin++; }
  for (const n of cs.applied) if (n.what === 'road') roads++;
  const parts: string[] = [];
  if (absent) parts.push(`결장 ${absent}명`);
  if (vacant) parts.push(`공석 ${vacant}자리`);
  if (cs.svc) parts.push(`정비 중 ${cs.svc}대`);
  if (closed) parts.push(`출입 통제 건물 ${closed}곳${ruin ? `(무너짐 ${ruin})` : ''}`);
  if (roads) parts.push(`복구 공사 도로 ${roads}구간`);
  cs.event = emit(sim, { role: 'SYSTEM', actor: '상황실', kind: 'shift', imp: 2, text: `지난 교대에서 이어받은 상태 — 조직의 ${co.shift}번째 교대 (지문 ${carryKey(co)}). ${parts.join(' · ') || '남은 피해 없음'}.` });
  // 적용한 항목의 기록 (적용한 순서대로 한 항목에 한 줄)은 단계 2~5 가 여기 더한다
  for (const d of cs.dropped) emit(sim, { role: 'SYSTEM', actor: '상황실', kind: 'shift', imp: 0, causes: [cs.event], text: d });
}

// ───────────────────────── 교대 중 (§3.7) ─────────────────────────
/** 매 틱 (engine.step 의 tickTraffic 다음). 이어받은 상태가 없거나 남은 일(정비 중 부대·남은 복구 공사)이 없으면 첫 줄에서 돌아간다. 단계 3(정비 완료)·4(개통)가 채운다 */
export function tickCarry(sim: Sim): void {
  const cs = sim.carryState;
  if (!cs.on || (cs.svc === 0 && cs.roads.length === 0)) return;
}

// ───────────────────────── 교대가 끝난 뒤 (§3.1) ─────────────────────────
function copyCrew(c: CrewCarry): CrewCarry {
  const o: CrewCarry = { name: c.name, callsign: c.callsign, out: c.out, cause: c.cause, health: c.health, dExp: c.dExp, dSkill: c.dSkill, shifts: c.shifts, incidents: c.incidents };
  if (c.seat !== undefined) o.seat = c.seat;
  if (c.replaceIn !== undefined) o.replaceIn = c.replaceIn;
  if (c.recruit !== undefined) o.recruit = { ...c.recruit };
  if (c.kitFault !== undefined) o.kitFault = c.kitFault.slice();
  return o;
}
/**
 * 끝난 교대에서 다음 교대가 이어받을 상태를 만든다 (sim.ended 일 때만 — 아니면 예외). **순수 함수다**: sim·sim.carry·carryState·현장·기록을 고치지 않고,
 * emit 하지 않으며, 돌려주는 객체는 모두 새로 만든다(앞 상태의 항목을 그대로 넣지 않고 복사한다). buildReport 안(마지막 기록·해시 전)에서도 불린다(단계 7).
 * 단계 1 은 뼈대다: 조직 명부(rosterKeys)의 모든 열쇠마다 한 항목 — 앞 상태에 있으면 그대로 옮기고, 없으면 처음 상태.
 * 끝 상태 읽기·휴식(결장·체력·성장·신임)은 단계 2(crewNext), 펌프·정비·재고는 3, 도로는 4, 건물은 5 가 채운다
 */
export function makeCarryover(sim: Sim): Carryover {
  if (!sim.ended) throw new Error('makeCarryover: 끝난 교대에서만 이어받을 상태를 만든다');
  const prev = sim.carry;
  const prevCrew = new Map<string, CrewCarry>();
  if (prev) for (const c of prev.crew) prevCrew.set(c.seat ?? c.name, c);
  const crew: CrewCarry[] = [];
  for (const k of rosterKeys()) {
    const p = prevCrew.get(k.name);
    crew.push(p ? copyCrew(p) : { name: k.name, callsign: k.callsign, out: 0, cause: null, health: 100, dExp: 0, dSkill: 0, shifts: 0, incidents: 0 });
  }
  return {
    v: CARRY_VERSION, shift: (prev ? prev.shift : 1) + 1, city: cityKey(sim.city),
    from: { seed: sim.seed, hash: sim.report ? sim.report.hash : '', diff: difficultyLabel(sim.difficulty) },
    crew, units: [], stock: {}, places: [], roads: [],
  };
}
