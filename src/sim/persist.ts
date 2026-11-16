// 교대 간 지속 (I2 — docs/specs/I2-persistence.md). 교대가 끝난 뒤의 상태를 "이어받은 상태"(Carryover)로 만들고(makeCarryover),
// 다음 교대의 Sim 생성자가 그것을 입력(extra.carry)으로 받아 적용한다. 같은 시드 + 같은 난이도 + 같은 이어받은 상태 = 같은 결과.
//
// 이어받은 상태가 없으면(carryState.on 이 거짓) 이 파일의 모든 함수가 첫 줄에서 돌아가고, 난수도 기록도 더하지 않는다 —
// 지금과 기록 해시가 한 글자도 다르지 않다(설계서 §8 의 0단계 해시 목록).
//
// 단계 1 (틀): 자료형(CarryState·CarryNote) · readCarryover(검사하며 새 객체로) · carryKey · cityKey · 빈 initCarry · tickCarry(첫 줄 반환) ·
//   makeCarryover 의 뼈대 · shiftStartCounts · 생성자의 자리 applyCrewCarry·announceCarry(요약 줄과 버린 것).
// 단계 2 (대원): crewNext(끝 상태 → 다음 교대 — 행의 순서·결장·체력·성장·신임·개인 장비 점검) · applyCrewCarry 의 대원 몫(신임·성장·결장 off·결장 상한·
//   예비 인력 — minField·내리지 않는 자리, 모자라면 short·나올 사람이 없으면 empty) · operable · announceCarry 의 대원 줄.
// 단계 3 (장비): unitsNext(펌프 — 고장 났으면 정밀 정비(service)·아니면 점검) · stockNext(섬광탄 창고) · applyCrewCarry 의 부대 몫(펌프 범위·정비 oos·
//   SERVICE_CAP 을 넘으면 급히 정비 완료 · 창고에서 섬광탄 지급) · tickCarry 의 정비 완료(operable) · announceCarry 의 정비·재고 줄.
// 뒤 단계가 채운다: 4 도로(복구 공사) ·
//   5 건물(placeOutcome·placeUsable·placeCond·applyPlaceWear·noteWearIncident) · 7 보고서(carrySummary·carryLines).
//
// import: types · rng · events · util · resources(함수만 — 부를 때만 쓴다. resources → sceneManager → … 순환에서 모듈 맨 위의 표를 읽지 않는다) ·
//   crews(잎 모듈 — KITS·ROLES·STAFF·역할 식·장비) · field/injury(잎 모듈 — CAUSE_NAME·outShifts·mainCause) · difficulty(잎 모듈 — 이름표).
//   incidents · dispatch/* · debrief 와 그 밖의 field/* 는 import 하지 않는다.
// 브라우저 저장은 표현 계층(view/runner.ts — 단계 6)에서만 한다 — src/sim 은 저장소를 모른다 (원칙 8, 시험 9 가 글자로 본다).

import { KITS, ROLES, STAFF, dealFlashbangs, kitFor, minField, skillsOf, slotsOf, stays } from './crews';
import { difficultyLabel } from './difficulty';
import type { Sim } from './engine';
import { emit } from './events';
import { CAUSE_NAME, mainCause, outShifts } from './field/injury';
import { crewReady, rosterKeys, traitOf } from './resources';
import type { RosterKey } from './resources';
import { hashStr } from './rng';
import type { Rng } from './rng';
import type { Carryover, City, CrewCarry, InjuryCause, PlaceCarry, RecruitBase, Responder, RoadCarry, StockId, Unit, UnitCarry, UnitKind } from './types';
import { clamp, josa } from './util';

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
// ── 대원 (단계 2 — §3.2·§6.1) ──
/** 휴식 한 번에 오르는 체력 (교대 끝 체력 + REST_HEAL, 100 까지) */
export const REST_HEAL = 40;
/** 결장을 마치고 돌아올 때의 체력 */
export const BACK_HEALTH = 85;
/** 결장 상한에 걸려 일찍 돌아오는 대원의 체력 */
export const EARLY_BACK_HEALTH = 70;
/** 성장: gain = min(GAIN_CAP, xpGained × GAIN_K) × (1 − 경험), 숙련은 그 SKILL_K 배 (설계서 §3.2 의 처음 값 — 측정은 단계 8) */
export const GAIN_K = 0.5;
export const GAIN_CAP = 0.02;
export const SKILL_K = 0.6;
/** 결장 상한 = max(ABSENT_FLOOR, floor(ABSENT_SHARE × 편성 인원)) — 넘는 만큼 남은 결장이 짧은 사람부터 조기 복귀 (큰 재난 뒤에도 조직의 4/5 는 나온다) */
export const ABSENT_SHARE = 0.2;
export const ABSENT_FLOOR = 2;
export function absentCap(fielded: number): number { return Math.max(ABSENT_FLOOR, Math.floor(ABSENT_SHARE * fielded)); }
/** 한 교대에 붙일 수 있는 본부 예비 인력 */
export const RELIEF_MAX = 4;
/** 신임 대원의 이름 (가상의 이름 — 명부 NAMES·EXTRA_NAMES·지원 AID_NAMES·예비 RELIEF_NAMES 와 겹치지 않는다). 모두 쓰면 이름 뒤에 숫자 */
export const RECRUIT_NAMES = ['강유찬', '고다솜', '구민결', '권하랑', '김새벽', '나지오', '류다현', '박서온', '배윤호', '성하빈', '신도하', '안예준',
  '양서림', '오지환', '유하엘', '이도담', '임가온', '전시후', '정라엘', '조윤슬', '최다올', '한이현', '허지담', '황시온'];
/** 본부 예비 인력의 이름 (교대마다 차례로 — 이어받지 않는다) */
export const RELIEF_NAMES = ['문재희', '백하준', '신태건', '오윤재', '장미르', '차도건', '표서진', '하민규'];
// ── 장비 (단계 3 — §3.3·§6.1) ──
/** 휴식 한 번의 펌프 점검으로 오르는 상태 (고장 나지 않은 펌프: 끝 값 + PUMP_REST, 1 까지) */
export const PUMP_REST = 0.12;
/** 이번 교대에 고장 난 펌프는 다음 교대에 정밀 정비를 받고 이 상태로 돌아온다 */
export const SERVICE_PUMP = 0.7;
/** 정비 시각의 범위 (교대 시작 뒤 초 — carry 흐름) */
export const SERVICE_AT: readonly [number, number] = [300, 720];
/** 한꺼번에 정비하는 부대의 상한 — 넘는 부대는 '급히 정비 완료'(RUSHED_PUMP, 바로 운용) */
export const SERVICE_CAP = 2;
export const RUSHED_PUMP = 0.6;
/** 섬광탄 창고: 휴식 한 번에 채우는 수 (상한은 STOCK_CAP) */
export const RESUPPLY = 3;

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
  stats: { relief: number; serviced: number; reopened: number; markedInc: string[]; fbShort: number; early: number; grown: number };      // grown (단계 2): 이번 교대에 나온 대원 가운데 기본 능력보다 숙련이 오른 사람 수 (요약 줄)
  fbStore: number;                               // (단계 3) 교대 시작의 지급 뒤 서(署) 창고에 남은 섬광탄 — makeCarryover 가 다음 창고를 센다 (창고 기록이 없던 상태면 STOCK_CAP − 지급, 음수일 수 있다)
}
/** 적용한 항목 하나 (기록 한 줄의 재료). 상태를 바꾼 함수가 그 자리에서 push 한다 */
export type CarryNote =
  | { what: 'absent'; unit: string; names: string[]; cause: string | null; left: number }
  | { what: 'vacant'; unit: string; name: string; left: number }
  | { what: 'recruit'; unit: string; name: string; seat: string }
  | { what: 'early'; unit: string; name: string }                    // (단계 2) 기록의 주인(호출부호)을 알려고 unit 을 더했다
  | { what: 'relief'; unit: string; name: string; role?: string }
  | { what: 'short'; unit: string; n: number }                       // 예비 인력이 모자라 최소 편성보다 적은 n명(내리는 대원)으로 운용 — oos 가 아니다(결원 감점만)
  | { what: 'empty'; unit: string; why: 'crew' | 'pilot' }          // 나올 내리는 대원이 한 명도 없거나(crew) 조종·조타할 사람이 없어(pilot) oos '결원'
  | { what: 'service'; unit: string; readyAt: number; why: 'pump' | 'vehicle' }      // (단계 3) 문구를 고르려고 why 를 더했다. readyAt 은 짧은 교대면 자른 값
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
    stats: { relief: 0, serviced: 0, reopened: 0, markedInc: [], fbShort: 0, early: 0, grown: 0 },
    fbStore: 0,
  };
}
// ───────────────────────── 대원의 적용 (단계 2 — §3.2 의 "다음 교대에 적용") ─────────────────────────
/** 조종·조타하는 역할 (기장·부기장·정장 — 그림 묶음 'pilot'). 이 자리가 있는 부대는 그 가운데 한 명이라도 나와야 움직인다 (헬기가 조종사 없이 뜨지 않게) */
const steers = (r: Responder): boolean => r.role !== undefined && ROLES[r.role].group === 'pilot';
const kindSteers = (kind: UnitKind): boolean => STAFF[kind].std.some((role) => ROLES[role].group === 'pilot');
/** 내리는 자리와 내리지 않는 자리가 섞인 부대 (소방·의료 헬기, 구조정) — 내리지 않는 자리를 따로 본다 (경찰 헬기는 모두 내리지 않아 fieldCrew 가 전원이다) */
const mixedKind = (kind: UnitKind): boolean => { const std = STAFF[kind].std; return std.some((role) => ROLES[role].stays === true) && std.some((role) => !ROLES[role].stays); };
/** 최소 편성의 내리지 않는 자리 수 */
const staysMin = (kind: UnitKind): number => { const std = STAFF[kind].std; let n = 0; for (const k of slotsOf(kind, true)) if (ROLES[std[k]].stays) n++; return n; };
/** 나온(off 가 아닌) 내리지 않는 자리의 사람 수 */
function staysPresent(sim: Sim, u: Unit): number { let n = 0; for (const rid of u.crew) if (sim.responders[rid].status !== 'off' && stays(sim, rid)) n++; return n; }
/** 조종·조타할 사람이 나와 있는가 (그런 자리가 없는 부대는 언제나 참) */
function pilotOk(sim: Sim, u: Unit): boolean {
  if (!kindSteers(u.kind)) return true;
  for (const rid of u.crew) { const r = sim.responders[rid]; if (r.status !== 'off' && steers(r)) return true; }
  return false;
}
/**
 * 이 부대가 움직일 수 있는가 (§3.2 적용 6 의 운용 판정 — 최소 편성까지 찼는지는 보지 않는다): 걸을 수 있는 내리는 대원이 한 명 이상이고(crewReady > 0),
 * 조종·조타할 자리가 있는 부대면 그 사람이 나와 있다. 정비를 마친 부대의 운용 복귀(tickCarry — 단계 3)도 같은 판정을 쓴다
 */
export function operable(sim: Sim, u: Unit): boolean { return crewReady(sim, u) > 0 && pilotOk(sim, u); }

/** 본부 예비 인력 한 명: 그 자리의 역할·기본 장비, 능력은 createAidUnit 의 후임 식(경험 0.15~0.55). 대원 객체는 createRoster 의 글자와 같은 칸·같은 순서 */
function makeRelief(sim: Sim, u: Unit, seat: Responder, rng: Rng, name: string): Responder {
  const role = seat.role!, tn = sim.tune;
  const st = (): number => clamp(rng.range(0.3, 0.9), 0, 1);
  const exp = rng.range(0.15, 0.55);
  const skill = clamp(st() * 0.6 + exp * 0.4 + 0.05, 0.3, 0.95);
  const kit = kitFor(role, tn.airFull, (seat.kit ?? []).map((it) => it.id));      // 그 자리의 기본 장비(복구반장처럼 부대마다 다른 장비도 그 자리의 것) — 고장 추첨은 하지 않는다
  for (const it of kit) if (it.id === 'flashbang') it.uses = 0;                       // 섬광탄은 아래에서 부대 몫을 나눈다 (R1 — 0 개를 받은 사람의 항목도 남긴다)
  const r: Responder = {
    id: sim.responders.length, name, dept: u.dept, unitId: u.id, senior: false,
    skill, judgment: clamp(st() * 0.65 + exp * 0.35, 0.2, 0.95), composure: st(), fitness: st(), teamwork: st() * 0.85, experience: exp,
    skills: skillsOf(role, skill),
    trait: '', health: 100, stamina: tn.startStamina, status: 'ok', xpGained: 0, incidentsWorked: 0,
    role, kit,
    injuries: undefined, bleed: undefined, bleed0: undefined, treatQ: undefined, dead: undefined, tDown: undefined, tDead: undefined, care: undefined, deathCause: undefined, bleedCause: undefined,      // (H1) createRoster 의 대원과 같은 칸, 같은 순서
    seat: undefined, relief: true, carryOut: undefined, carryCause: undefined,      // (I2) 예비 인력 — 이번 교대만 (이어받지 않는다)
  };
  r.trait = traitOf(r);
  return r;
}

/**
 * ② 대원·부대·재고의 적용 (engine 생성자 — createRoster 가 모든 난수를 뽑은 뒤 값만 바꾼다). 이어받은 상태가 없으면 첫 줄에서 돌아간다.
 * 단계 2 (대원 — §3.2 의 1~7): 열쇠(createRoster 가 붙인 이름 = 명부 자리)로 항목을 찾아 ① 신임 대원이면 같은 rid 그대로 사람을 바꾸고(role·kit 은 그 자리의 것)
 * ② 성장(경험·숙련·판단, 역할 식의 skills, 특성)을 더하고 ③ 결장·공석이면 status 'off'(지구력 100), 아니면 이어받은 체력 ④ 점검에서 드러나지 않은 장비 고장(kitFault)을
 * 명부의 고장 추첨 뒤에 더한다. 그다음 결장 상한(조기 복귀), 예비 인력(minField·내리지 않는 자리 — 모자라면 short, 나올 사람이 없으면 empty → oos '결원').
 * 바꾼 것은 모두 carryState.applied 에 적고 announceCarry 가 그것만 기록한다. 난수는 예비 인력의 relief:<호출부호> 흐름 하나뿐이다.
 * 단계 3 (부대 몫 — §3.3): 펌프 범위·정비는 예비 인력 앞(정비 중인 부대에는 붙이지 않는다: u.readyAt), 섬광탄 창고의 지급은 끝에(나온 사람에게만).
 * 적용 목록의 순서: 신임·결장·공석(부대마다) → 조기 복귀 → 정비·급히 정비 완료 → 예비 인력·모자람·운용 중단(부대마다) → 재고 부족
 */
export function applyCrewCarry(sim: Sim): void {
  const cs = sim.carryState, co = sim.carry;
  if (!cs.on || !co) return;
  const byKey = new Map<string, CrewCarry>();
  for (const c of co.crew) byKey.set(c.seat ?? c.name, c);
  const n0 = sim.responders.length;                      // 편성된 조직 대원 (예비 인력·지원 대원 전)
  const entry: (CrewCarry | undefined)[] = new Array(n0);
  // 1~4. 사람마다: 신임 · 성장 · 체력 · 장비 고장 (결장은 상한을 본 뒤에 정한다)
  for (let i = 0; i < n0; i++) {
    const r = sim.responders[i], c = byKey.get(r.name);    // createRoster 가 붙인 이름 = 명부 자리 (seat 는 아직 없다)
    entry[i] = c;
    if (!c) continue;                                    // 항목이 없으면 그대로 (새 사람)
    const rb = c.recruit;
    if (rb) {                                            // 신임 대원: 같은 rid 그대로 — sim.responders 의 순서·현장 개체 흐름(agent:<사건>:<rid>)이 그대로다
      if (c.seat !== undefined) r.seat = c.seat;
      r.name = c.name;
      r.skill = rb.skill; r.judgment = rb.judgment; r.composure = rb.composure; r.fitness = rb.fitness; r.teamwork = rb.teamwork; r.experience = rb.experience;
    }
    if (rb || c.dExp > 0 || c.dSkill > 0) {              // 성장: 기본 능력(조직 시드 · 신임은 recruit)에 누적을 더한다 (createRoster 의 식에서 경험의 몫)
      const be = r.experience, bs = r.skill, bj = r.judgment;
      r.experience = Math.min(0.97, be + c.dExp);
      r.skill = clamp(bs + c.dSkill, 0.3, 0.98);
      r.judgment = clamp(bj + 0.35 * c.dExp, 0.2, 0.98);
      if (r.role !== undefined) r.skills = skillsOf(r.role, r.skill);
      r.trait = traitOf(r);
    }
    if (c.out === 0) r.health = c.health;
    if (c.kitFault) for (const id of c.kitFault) { const it = r.kit?.find((q) => q.id === id); if (it) it.fault = true; }      // (R1) 명부의 고장 추첨(kit 흐름 — 그대로 다 뽑았다) 뒤에 더한다
  }
  // 5. 결장 상한: 결장(공석 제외)이 상한을 넘으면 남은 결장이 짧은 사람부터(같으면 이름 순) 일찍 돌아온다
  const away: number[] = [];
  for (let i = 0; i < n0; i++) { const c = entry[i]; if (c && c.out > 0) away.push(i); }
  const early = new Set<number>();
  const cap = absentCap(n0);
  if (away.length > cap) {
    const nm = (i: number): string => sim.responders[i].name;
    const order = away.slice().sort((a, b) => entry[a]!.out - entry[b]!.out || (nm(a) < nm(b) ? -1 : nm(a) > nm(b) ? 1 : 0));
    for (let k = 0; k < away.length - cap; k++) early.add(order[k]);
  }
  for (let i = 0; i < n0; i++) {
    const c = entry[i], r = sim.responders[i];
    if (!c || c.out === 0) continue;
    if (early.has(i)) { r.health = EARLY_BACK_HEALTH; continue; }
    r.status = 'off'; r.carryOut = c.out; r.carryCause = c.cause; r.stamina = 100;      // 결장자는 회복하지 않으므로(지구력은 ok 만 오른다) 100 — 배정의 평균 지구력에 감점을 남기지 않게 (§3.2 적용 4)
  }
  // 적용 목록: 부대마다 신임 → 결장(같은 원인·같은 남은 교대끼리 한 줄) → 공석, 그다음 조기 복귀
  for (const u of sim.units) {
    const groups: Extract<CarryNote, { what: 'absent' }>[] = [], vac: CarryNote[] = [];
    for (const rid of u.crew) {
      if (rid >= n0) continue;
      const c = entry[rid], r = sim.responders[rid];
      if (!c) continue;
      if (c.recruit && c.out === 0 && c.shifts === 0) cs.applied.push({ what: 'recruit', unit: u.callsign, name: r.name, seat: r.seat ?? r.name });      // 처음 오는 교대
      if (r.status !== 'off') continue;
      if (c.out === -1) { vac.push({ what: 'vacant', unit: u.callsign, name: r.name, left: c.replaceIn ?? REPLACE_AFTER }); continue; }
      const g = groups.find((q) => q.cause === c.cause && q.left === c.out);
      if (g) g.names.push(r.name); else groups.push({ what: 'absent', unit: u.callsign, names: [r.name], cause: c.cause, left: c.out });
    }
    for (const g of groups) cs.applied.push(g);
    for (const v of vac) cs.applied.push(v);
  }
  for (let i = 0; i < n0; i++) if (early.has(i)) { const r = sim.responders[i]; cs.stats.early++; cs.applied.push({ what: 'early', unit: sim.units[r.unitId].callsign, name: r.name }); }
  for (let i = 0; i < n0; i++) { const c = entry[i]; if (c && (c.dExp > 0 || c.dSkill > 0) && sim.responders[i].status !== 'off') cs.stats.grown++; }
  // 5. 펌프·정비 (단계 3 — §3.3): 장비 손잡이는 범위를, 이어받은 상태는 그 안의 위치를 정한다(equipment 흐름은 createRoster 가 그대로 다 뽑았다).
  //    정비 중인 부대는 readyAt 까지 oos '정비 중' — 한꺼번에 SERVICE_CAP 대까지(이른 순), 넘는 부대는 급히 정비를 마치고 바로 운용한다. 정비 중인 부대에는 아래의 예비 인력을 붙이지 않는다
  applyUnitCarry(sim, co);
  // 6. 예비 인력 — 결장으로 빈 자리를 최소 편성(내리는 자리 minField · 내리지 않는 자리)까지 채운다. 모자라도 나온 대원이 있으면 그 인원으로 운용한다
  for (const u of sim.units) {
    if (u.aid || u.readyAt !== undefined) continue;
    if (!u.crew.some((rid) => sim.responders[rid].status === 'off')) continue;      // 결장이 없으면 아무 일도 없다 (§3.2 — 표준·최소 편성은 늘 기준을 채운다)
    const need = minField(u.kind), mixed = mixedKind(u.kind), sMin = mixed ? staysMin(u.kind) : 0;
    const allStay = !mixed && u.crew.every((rid) => stays(sim, rid));      // 경찰 헬기: fieldCrew 가 전원이다
    const filled = new Set<number>();
    let rng: Rng | null = null;
    for (;;) {
      const lackStay = mixed && staysPresent(sim, u) < sMin;               // ⓑ 조종사·정장 자리가 먼저
      const lackField = crewReady(sim, u) < need;                          // ⓐ 내리는 자리 (crewReady 와 같은 단위)
      if ((!lackStay && !lackField) || cs.stats.relief >= RELIEF_MAX) break;
      let seat = -1;
      for (const rid of u.crew) {
        const q = sim.responders[rid];
        if (q.status !== 'off' || filled.has(rid)) continue;
        if (lackStay ? stays(sim, rid) : allStay || !stays(sim, rid)) { seat = rid; break; }
      }
      if (seat < 0) break;
      filled.add(seat);
      rng ??= sim.rng.fork('relief:' + u.callsign);
      const r = makeRelief(sim, u, sim.responders[seat], rng, RELIEF_NAMES[cs.stats.relief % RELIEF_NAMES.length]);
      sim.responders.push(r); u.crew.push(r.id);                            // 끝에 붙인다 — 기존 rid 는 그대로
      cs.stats.relief++;
      cs.applied.push({ what: 'relief', unit: u.callsign, name: r.name, role: ROLES[r.role!].name });
    }
    const ready = crewReady(sim, u);
    if (ready === 0 || !pilotOk(sim, u)) {
      u.state = 'oos'; u.oosWhy = '결원';                                   // 이번 교대 내내 — 나올 내리는 대원이 한 명도 없거나 조종·조타할 사람이 없다
      cs.applied.push({ what: 'empty', unit: u.callsign, why: ready === 0 ? 'crew' : 'pilot' });
    } else if (ready < need) cs.applied.push({ what: 'short', unit: u.callsign, n: ready });      // oos 가 아니다 — 배정의 결원 감점(−18)만 (H1 §3.6 의 사용자 결정과 같은 정신)
  }
  // 7. 섬광탄 (단계 3 — §3.3): 서(署) 창고에서 기동·특공 부대에 정수만큼, 나온 사람(예비 인력 포함)에게만 나눈다 — 결장자의 몫은 0
  //    (단계 2 의 "결장자 섬광탄 다시 나누기"를 여기로 옮겼다: 창고 기록이 넉넉하면 부대의 합은 createRoster 의 정수 그대로다)
  issueFlashbangs(sim, co);
}
/** 섬광탄 정수 — createRoster 의 식(기동 tn.flashbangs · 특공 +2). 표를 import 하지 않고 종류와 손잡이로 센다 (§3.4 끝). 지원 부대는 창고와 상관없다 */
const fbQuota = (sim: Sim, u: Unit): number => (u.aid ? 0 : u.kind === 'tactical' ? sim.tune.flashbangs : u.kind === 'swat' ? sim.tune.flashbangs + 2 : 0);
const holdsFlashbang = (r: Responder): boolean => r.kit !== undefined && r.kit.some((it) => it.id === 'flashbang');
/**
 * 부대 몫의 적용 (단계 3 — §3.3, applyCrewCarry 의 5): 펌프 상태를 장비 손잡이의 범위(pumpMin..pumpMax)로 잘라 넣고, 정비 중인 부대를 oos '정비 중'(readyAt —
 * 짧은 교대면 shiftLen × 0.75 로 자른다)으로 둔다. 정비는 readyAt 이 이른 순으로 SERVICE_CAP 대까지, 넘는 부대는 '급히 정비 완료'(펌프 RUSHED_PUMP — 역시 범위로 자른다, 바로 운용)
 */
function applyUnitCarry(sim: Sim, co: Carryover): void {
  const cs = sim.carryState, tn = sim.tune;
  const byCs = new Map<string, UnitCarry>();
  for (const x of co.units) byCs.set(x.callsign, x);
  const svc: Unit[] = [];
  for (const u of sim.units) {
    if (u.aid) continue;
    const x = byCs.get(u.callsign);
    if (!x) continue;                                    // 항목이 없으면 뽑은 값 그대로
    if (x.pump !== undefined && u.dept === 'fire') u.pumpCond = clamp(x.pump, tn.pumpMin, tn.pumpMax);      // createRoster 가 펌프를 뽑는 부대와 같은 조건
    if (x.service) svc.push(u);
  }
  if (!svc.length) return;
  const at = (u: Unit): number => byCs.get(u.callsign)!.service!.readyAt;
  const keep = new Set(svc.slice().sort((a, b) => at(a) - at(b) || a.id - b.id).slice(0, SERVICE_CAP));
  for (const u of svc) {                                 // 적용 목록은 편성표 순서로
    const sv = byCs.get(u.callsign)!.service!;
    if (keep.has(u)) {
      u.state = 'oos'; u.readyAt = Math.min(sv.readyAt, sim.shiftLen * 0.75); u.oosWhy = '정비 중';
      cs.svc++;
      cs.applied.push({ what: 'service', unit: u.callsign, readyAt: u.readyAt, why: sv.why });
    } else {
      if (sv.why === 'pump' && u.dept === 'fire') u.pumpCond = clamp(RUSHED_PUMP, tn.pumpMin, tn.pumpMax);
      cs.applied.push({ what: 'rushed', unit: u.callsign });
    }
  }
}
/**
 * 섬광탄 지급 (단계 3 — §3.3, applyCrewCarry 의 7): 편성표 순서(sim.units)로 기동·특공 부대에 정수만큼 창고에서. 창고가 모자라면 있는 만큼,
 * 단 정수가 1 이상인 부대는 적어도 1개(비상 지급 — 창고에서 빼지 않는다). 모자란 부대마다 적용 목록에 'stock'. 들 사람(나온 사람 가운데 섬광탄 자리)이 없으면
 * 창고에서 꺼내지 않는다. 창고 기록이 없는 상태(손으로 만든 입력)는 지금처럼 정수 그대로 주고 창고는 가득 찬 것에서 센다
 */
function issueFlashbangs(sim: Sim, co: Carryover): void {
  const cs = sim.carryState;
  const known = co.stock.flashbang !== undefined;
  let store = known ? co.stock.flashbang! : STOCK_CAP;
  for (const u of sim.units) {
    const want = fbQuota(sim, u);
    if (want <= 0) continue;
    const present: Responder[] = [];
    for (const rid of u.crew) { const q = sim.responders[rid]; if (q.status === 'off') { for (const it of q.kit ?? []) if (it.id === 'flashbang') it.uses = 0; } else present.push(q); }
    if (!present.some(holdsFlashbang)) { u.flashbangs = 0; continue; }
    let got = want;
    if (!known) store -= want;
    else {
      got = Math.min(want, store); store -= got;
      if (got === 0) got = 1;                                                // 비상 지급 (창고에서 빼지 않는다)
      if (got < want) { cs.stats.fbShort += want - got; cs.applied.push({ what: 'stock', unit: u.callsign, got, want }); }
    }
    u.flashbangs = dealFlashbangs(present, got);                             // R1 — 사람 몫으로 나눈다(자리 순서의 앞부터). 부대의 합은 그 몫의 합
  }
  cs.fbStore = store;
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
  // 요약의 몫 — 지금 상태에서 센다 (적용한 것만 상태에 있다)
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
  if (cs.stats.grown) parts.push(`숙련이 오른 대원 ${cs.stats.grown}명`);
  cs.event = emit(sim, { role: 'SYSTEM', actor: '상황실', kind: 'shift', imp: 2, text: `지난 교대에서 이어받은 상태 — 조직의 ${co.shift}번째 교대 (지문 ${carryKey(co)}). ${parts.join(' · ') || '남은 피해 없음'}.` });
  // 적용한 항목의 기록: 적용한 순서대로 한 항목에 한 줄 (원칙 5 — 목록에 없는 것은 기록하지 않고, 목록의 항목은 모두 기록한다. 시험 10 이 일대일을 본다)
  const ev = [cs.event];
  for (const n of cs.applied) {
    const t = carryNoteText(n);
    if (t === null) continue;      // 뒤 단계의 항목(정비·재고·건물·도로)은 그 단계가 문구를 더한다
    emit(sim, { role: t.unit ? 'UNIT' : 'SYSTEM', actor: t.actor, kind: t.kind, imp: t.imp, causes: ev, text: t.text });
  }
  for (const d of cs.dropped) emit(sim, { role: 'SYSTEM', actor: '상황실', kind: 'shift', imp: 0, causes: ev, text: d });
}
/** 적용 항목 하나의 기록 문구 (§3.7 의 2~4). 부대 줄은 호출부호가 주인이다. 문구가 아직 없는 항목(단계 3~5)은 null */
function carryNoteText(n: CarryNote): { unit: boolean; actor: string; kind: 'unit' | 'shift' | 'traffic'; imp: number; text: string } | null {
  switch (n.what) {
    case 'recruit': return { unit: true, actor: n.unit, kind: 'unit', imp: 1, text: `신임 ${n.name} 대원이 ${n.seat} 대원의 자리에 배치됐습니다.` };
    case 'absent': return { unit: true, actor: n.unit, kind: 'unit', imp: 1, text: `${josa(n.names.join('·') + ' 대원', '이/가')} 결장합니다 (${n.cause !== null && Object.prototype.hasOwnProperty.call(CAUSE_NAME, n.cause) ? CAUSE_NAME[n.cause as InjuryCause] + ' · ' : ''}${n.left}교대 남음).` };
    case 'vacant': return { unit: true, actor: n.unit, kind: 'unit', imp: 1, text: `순직한 ${n.name} 대원의 자리가 비어 있습니다 (신임 배치까지 ${n.left}교대).` };
    case 'early': return { unit: true, actor: n.unit, kind: 'unit', imp: 1, text: `결장 대원이 많아 ${n.name} 대원이 경상으로 일찍 복귀합니다.` };
    case 'relief': return { unit: true, actor: n.unit, kind: 'unit', imp: 1, text: `${n.unit} 결원 — 본부 예비 인력 ${n.name} 대원이 ${n.role ?? '빈'} 자리에 대신 탑니다.` };
    case 'short': return { unit: true, actor: n.unit, kind: 'unit', imp: 1, text: `${n.unit} 결원 — 예비 인력이 없어 ${n.n}명으로 운용합니다.` };
    case 'empty': return { unit: true, actor: n.unit, kind: 'unit', imp: 2, text: `${n.unit} 결원으로 이번 교대 운용 중단 (${n.why === 'pilot' ? '조종·조타할 사람' : '나올 대원'}·예비 인력 없음).` };
    // (단계 3) 정비·급히 정비 완료·재고 부족
    case 'service': return { unit: true, actor: n.unit, kind: 'unit', imp: 1, text: `${n.unit} ${n.why === 'vehicle' ? '차량' : '펌프'} 정비 중 — 약 ${Math.max(1, Math.round(n.readyAt / 60))}분 뒤 운용.` };
    case 'rushed': return { unit: true, actor: n.unit, kind: 'unit', imp: 1, text: `${n.unit} 정비가 밀려 급히 마쳤습니다 — 바로 운용합니다.` };
    case 'stock': return { unit: true, actor: n.unit, kind: 'unit', imp: 1, text: `섬광탄 재고 부족 — ${n.unit} ${n.got}개만 지급 (정수 ${n.want}개).` };
    default: return null;
  }
}

// ───────────────────────── 교대 중 (§3.7) ─────────────────────────
/**
 * 매 틱 (engine.step 의 tickTraffic 다음). 이어받은 상태가 없거나 남은 일(정비 중 부대·남은 복구 공사)이 없으면 첫 줄에서 돌아간다.
 * 정비 (단계 3): readyAt 이 된 부대를 부대 순서대로 운용에 돌린다 — 움직일 수 있으면(operable) available 과 '정비 완료' 기록, 아니면 oos '결원' 그대로와 그 기록.
 * 바꾸는 바로 이 자리에서 기록하고 원인은 요약 줄이다. 복구 공사의 개통은 단계 4 가 채운다
 */
export function tickCarry(sim: Sim): void {
  const cs = sim.carryState;
  if (!cs.on || (cs.svc === 0 && cs.roads.length === 0)) return;
  if (cs.svc > 0) {
    for (let ui = 0; ui < sim.units.length; ui++) {
      const u = sim.units[ui];
      if (u.readyAt === undefined || sim.t < u.readyAt) continue;
      u.readyAt = undefined; cs.svc--;
      if (u.state !== 'oos') continue;                                   // (방어) 다른 코드가 이미 운용에 넣었다
      if (operable(sim, u)) {                                            // crewReady > 0 이고 조종·조타할 사람이 있다 (최소 편성까지 찼는지는 보지 않는다)
        u.state = 'available'; u.oosWhy = undefined; cs.stats.serviced++;
        emit(sim, { role: 'UNIT', actor: u.callsign, kind: 'unit', imp: 1, causes: [cs.event], text: `${u.callsign} 정비 완료 — 운용 재개.` });
      } else {
        u.oosWhy = '결원';
        emit(sim, { role: 'UNIT', actor: u.callsign, kind: 'unit', imp: 1, causes: [cs.event], text: `${u.callsign} 정비를 마쳤지만 결원으로 운용하지 못합니다.` });
      }
    }
  }
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
 * 대원(단계 2 — crewNext)은 조직 명부(rosterKeys)의 모든 열쇠마다 한 항목. 펌프·정비(unitsNext)·섬광탄 창고(stockNext)는 단계 3, 도로는 4, 건물은 5 가 채운다.
 * 난수는 carry 흐름 하나(교대 시드에서 갈라진다 — 몇 번 불러도 같다): 정비 시각을 부대 순서로 먼저 뽑고, 단계 4 의 복구 시각은 그 뒤에 이어 뽑는다
 */
export function makeCarryover(sim: Sim): Carryover {
  if (!sim.ended) throw new Error('makeCarryover: 끝난 교대에서만 이어받을 상태를 만든다');
  const prev = sim.carry;
  const rng = sim.rng.fork('carry');
  return {
    v: CARRY_VERSION, shift: (prev ? prev.shift : 1) + 1, city: cityKey(sim.city),
    from: { seed: sim.seed, hash: sim.report ? sim.report.hash : '', diff: difficultyLabel(sim.difficulty) },
    crew: crewNext(sim), units: unitsNext(sim, rng), stock: stockNext(sim), places: [], roads: [],
  };
}

// ───────────────────────── 장비의 끝 상태 → 다음 교대 (단계 3 — §3.3 의 표) ─────────────────────────
/**
 * 부대 (지원 부대는 넣지 않는다 — 편성표의 호출부호마다 많아야 한 항목, 편성표 순서). 펌프를 뽑는 부대(소방 부서 — createRoster 와 같은 조건)만:
 *   이번 교대에 펌프가 고장 난 적이 있으면(u.pumpFails > 0, 또는 돌아오지 못한 채 끝나 pumpFailed 인 채) 정밀 정비 — service(readyAt = carry 흐름 SERVICE_AT)·pump SERVICE_PUMP,
 *   아니면 점검 — pump = min(1, 끝 값 + PUMP_REST). 정비 중인 채로 끝난 부대도 휴식에서 정비를 마친다(service 를 넣지 않는다).
 *   이번 교대에 편성되지 않은 부대는 앞 상태의 펌프에 휴식만 (정비는 휴식에서 마친다)
 */
function unitsNext(sim: Sim, rng: Rng): UnitCarry[] {
  const prev = new Map<string, UnitCarry>();
  if (sim.carry) for (const p of sim.carry.units) prev.set(p.callsign, p);
  const here = new Map<string, Unit>();
  for (const u of sim.units) if (!u.aid) here.set(u.callsign, u);
  const out: UnitCarry[] = [], seen = new Set<string>();
  for (const k of rosterKeys()) {
    if (seen.has(k.callsign)) continue;
    seen.add(k.callsign);
    const u = here.get(k.callsign), p = prev.get(k.callsign);
    if (!u) {                                                            // 편성되지 않음 — 휴식만
      if (p && p.pump !== undefined) out.push({ callsign: k.callsign, pump: round4(Math.min(1, p.pump + PUMP_REST)) });
      continue;
    }
    if (u.dept !== 'fire') continue;
    if ((u.pumpFails ?? 0) > 0 || u.pumpFailed) out.push({ callsign: k.callsign, pump: SERVICE_PUMP, service: { readyAt: Math.round(rng.range(SERVICE_AT[0], SERVICE_AT[1])), why: 'pump' } });
    else out.push({ callsign: k.callsign, pump: round4(clamp(u.pumpCond + PUMP_REST, 0, 1)) });
  }
  return out;
}
/**
 * 섬광탄 창고: min(STOCK_CAP, 교대 시작의 지급 뒤 창고 + 부대에 남은 섬광탄 + RESUPPLY) — 0 아래로 내려가지 않는다.
 * 이어받은 상태가 없던 교대는 창고가 STOCK_CAP 에서 시작해 createRoster 의 정수(들 사람이 있는 부대만)를 지급한 것으로 센다
 */
function stockNext(sim: Sim): Partial<Record<StockId, number>> {
  let base: number;
  if (sim.carryState.on) base = sim.carryState.fbStore;
  else {
    base = STOCK_CAP;
    for (const u of sim.units) { const q = fbQuota(sim, u); if (q > 0 && u.crew.some((rid) => holdsFlashbang(sim.responders[rid]))) base -= q; }
  }
  let left = 0;
  for (const u of sim.units) if (!u.aid) left += u.flashbangs;
  return { flashbang: Math.max(0, Math.min(STOCK_CAP, Math.round(base + left + RESUPPLY))) };
}

// ───────────────────────── 대원의 끝 상태 → 다음 교대 (단계 2 — §3.2 의 표) ─────────────────────────
const round4 = (v: number): number => Math.round(v * 1e4) / 1e4;
const freshCrew = (k: RosterKey): CrewCarry => ({ name: k.name, callsign: k.callsign, out: 0, cause: null, health: 100, dExp: 0, dSkill: 0, shifts: 0, incidents: 0 });
/** 신임 대원의 기본 능력 — createRoster 와 같은 식(경험 0.1~0.3, st() 범위 0.3~0.85). 흐름 recruit:<자리> (교대 시드에서 갈라진다 — 몇 번 불러도 같다) */
function recruitBase(sim: Sim, seat: string): RecruitBase {
  const rng = sim.rng.fork('recruit:' + seat);
  const st = (): number => clamp(rng.range(0.3, 0.85), 0, 1);
  const experience = rng.range(0.1, 0.3);
  const skill = clamp(st() * 0.6 + experience * 0.4 + 0.05, 0.3, 0.98);
  const judgment = clamp(st() * 0.65 + experience * 0.35, 0.2, 0.98);
  const composure = st(), fitness = st(), teamwork = st();
  return { skill: round4(skill), judgment: round4(judgment), composure: round4(composure), fitness: round4(fitness), teamwork: round4(teamwork), experience: round4(experience) };
}
/**
 * 개인 장비의 점검 (R1 뒤 — §3.2 의 kitFault): 드러난 고장(faultKnown)은 점검에서 고치고(넣지 않는다), 드러나지 않은 고장은 절반을 찾는다 —
 * hashStr(자리 + ':' + 장비 + ':' + 교대) 가 짝수면 고치고 홀수면 남긴다 (난수 흐름을 쓰지 않는다). 교대 = 끝난 교대의 조직 번호
 */
const missed = (seat: string, id: string, shiftNo: number): boolean => hashStr(seat + ':' + id + ':' + shiftNo) % 2 !== 0;
function setKitFault(c: CrewCarry, ids: string[]): void { if (ids.length) c.kitFault = ids; else delete c.kitFault; }
/**
 * 끝 상태에서 다음 교대의 대원 항목 (지원 대원·예비 인력은 넣지 않는다). 대상은 조직 명부의 모든 열쇠(편성되지 않은 사람 포함), 열쇠마다 위에서부터 첫 번째로 맞는 행:
 *   1 앞 상태가 공석(out −1) — 언제나: −1, replaceIn − 1 (0 이 되면 신임 대원)
 *   2 편성되었고 결장(off): out − 1, 체력 그대로, 성장 없음
 *   3 편성되지 않음: max(0, out − 1), 나올 수 있던 사람(out 0)은 체력 + REST_HEAL, 성장 없음
 *   4~6 편성되어 나온 사람 — 결장 표는 H1 의 outShifts(r) 하나: −1 순직(공석, replaceIn = REPLACE_AFTER) · >0 결장(체력 BACK_HEALTH) · 0 (끝 체력 + REST_HEAL). 5·6 은 성장
 * 한 휴식에서 여러 자리가 신임이 되면 명부 순서대로 RECRUIT_NAMES 가운데 새 상태에 없는 첫 이름을 나눠 준다. 숫자는 소수 넷째 자리로 반올림한다(JSON 왕복·지문).
 * 순수하다: sim 을 고치지 않고, 앞 상태의 항목을 복사해 쓴다
 */
function crewNext(sim: Sim): CrewCarry[] {
  const prev = sim.carry, shiftNo = prev ? prev.shift : 1;
  const prevCrew = new Map<string, CrewCarry>();
  if (prev) for (const c of prev.crew) prevCrew.set(c.seat ?? c.name, c);
  const here = new Map<string, Responder>();
  for (const r of sim.responders) if (!r.relief && !sim.units[r.unitId].aid) here.set(r.seat ?? r.name, r);
  const out: CrewCarry[] = [], pending: number[] = [];
  for (const k of rosterKeys()) {
    const p = prevCrew.get(k.name), r = here.get(k.name);
    let c: CrewCarry;
    if (p && p.out === -1) {                                                      // 1 공석
      c = copyCrew(p); delete c.kitFault;
      const left = (p.replaceIn ?? REPLACE_AFTER) - 1;
      if (left <= 0) pending.push(out.length); else c.replaceIn = left;
    } else if (r && r.status === 'off') {                                         // 2 결장 (이번 교대에 나오지 않았다)
      c = p ? copyCrew(p) : freshCrew(k);
      c.out = Math.max(0, (p ? p.out : r.carryOut ?? 1) - 1);
      if (c.out === 0) c.cause = null;
      const kf: string[] = [];
      for (const it of r.kit ?? []) if (it.fault && !it.faultKnown && missed(k.name, it.id, shiftNo)) kf.push(it.id);
      setKitFault(c, kf);
    } else if (!r) {                                                              // 3 편성되지 않음
      c = p ? copyCrew(p) : freshCrew(k);
      if (p) {
        if (p.out === 0) c.health = round4(Math.min(100, p.health + REST_HEAL));
        else { c.out = Math.max(0, p.out - 1); if (c.out === 0) c.cause = null; }
        setKitFault(c, (p.kitFault ?? []).filter((id) => missed(k.name, id, shiftNo)));
      }
    } else {                                                                      // 4~6 편성되어 나온 사람
      c = p ? copyCrew(p) : freshCrew(k);
      c.name = r.name;
      const o = outShifts(r);
      if (o < 0) {                                                                // 4 순직 — 자리가 빈다
        c.out = -1; c.replaceIn = REPLACE_AFTER; c.cause = r.deathCause ?? mainCause(r.injuries); c.health = 100;
        delete c.kitFault;
      } else {
        if (o > 0) { c.out = o; c.cause = mainCause(r.injuries); c.health = BACK_HEALTH; }      // 5 결장
        else { c.out = 0; c.cause = null; c.health = round4(clamp(r.health + REST_HEAL, 1, 100)); }      // 6 나온다
        const gain = Math.min(GAIN_CAP, r.xpGained * GAIN_K) * (1 - r.experience);       // 성장 (K1): 이미 노련한 사람은 덜 는다
        c.dExp = round4(Math.min(EXP_CAP, c.dExp + gain));
        c.dSkill = round4(Math.min(SKILL_CAP, c.dSkill + gain * SKILL_K));
        c.shifts += 1; c.incidents += r.incidentsWorked;
        const kf: string[] = [];
        for (const it of r.kit ?? []) if (it.fault && !it.faultKnown && missed(k.name, it.id, shiftNo)) kf.push(it.id);
        setKitFault(c, kf);
      }
    }
    out.push(c);
  }
  // 신임 대원: 명부 순서대로, 새 상태에 이미 있는 이름(앞에서 배치된 신임 포함 — 바뀌기 전 공석의 이름도)을 뺀 첫 이름
  if (pending.length) {
    const used = new Set<string>();
    for (const c of out) used.add(c.name);
    const keys = rosterKeys();
    let j = 0;
    for (const at of pending) {
      let name = '';
      for (;; j++) { name = RECRUIT_NAMES[j % RECRUIT_NAMES.length] + (j >= RECRUIT_NAMES.length ? String(Math.floor(j / RECRUIT_NAMES.length) + 1) : ''); if (!used.has(name)) break; }
      used.add(name);
      const k = keys[at];
      out[at] = { name, seat: k.name, callsign: k.callsign, out: 0, cause: null, health: 100, dExp: 0, dSkill: 0, shifts: 0, incidents: 0, recruit: recruitBase(sim, k.name) };
    }
  }
  return out;
}
