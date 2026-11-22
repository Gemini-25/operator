// N8 현장 도구 (docs/specs/N8-incident-kinds.md §4.2·§4.8·§10.1) — 진실을 만든다 (field/scenes/kinds.ts 가 부른다).
//   buildQuiet   그 유형의 장소에 아무 일도 없는 현장 (장난 전화 — 불 없는 건물 · 환자 없는 집 · 사람 없는 하천 · 용의자 없는 가게)
//   streetFrame  길 위 현장의 틀: 가로 도로 네 줄 · 보도 둘 · 위아래 건물 앞면(벽 — 들어가지 않는다) · 바깥 현장
// 단계 3 은 이 둘만 둔다. 시장·도심·홀 틀(marketFrame·urbanFrame·hallFrame)·동물(addAnimal)·농가·다리 교차로는 그것을 쓰는 단계(4a~8)가 더한다.
// 길 위 교차로 고르기(streetNode)는 시나리오 표가 부르므로 scenarios/kinds.ts 에 있다 (시나리오 표가 현장 도구를 import 하면 builders 를 끌어온다).
import type { Sim } from '../engine';
import type { Rng } from '../rng';
import { DECOR, T } from '../types';
import type { Animal, Incident, Scene } from '../types';
import { buildArmed, buildFire, buildMedical, buildWater } from './builders';
import { addProp } from './kit';
import { SH, SW, addRegion, baseScene, set } from './kit';
import { ANIMAL } from './animals';
import { ANIMAL_SHAPE, primeNums } from '../shape';

/**
 * 아무 일도 없는 현장 — 그 유형의 장소 틀을 그대로 쓰고 사건만 뺀다:
 * 화재·가스(오인)는 buildFire 의 오인 신고 갈래(불·가스통·구조 대상 없음), 응급·수난은 그 틀에서 구조 대상을 뺀 것, 무장은 장난 전화의 빈 가게.
 * 끝나는 길: 지금의 방(물가) 수색 → 확인할 것이 없음 → 종료. 구조 대상을 빼는 것은 만든 직후라 아무도 그 사람을 가리키지 않는다(addCas 는 배열에 넣기만 한다)
 */
export function buildQuiet(sim: Sim, I: Incident, rng: Rng): Scene {
  const t = I.truth.type;
  if (t === 'fire' || t === 'hazmat') return buildFire(sim, I, rng);      // falseAlarm 갈래 (변형 false · prank)
  if (t === 'armed') return buildArmed(sim, I, rng);      // 빈 가게 (변형 prank · false)
  const s = t === 'water' ? buildWater(sim, I, rng) : buildMedical(sim, I, rng);
  s.casualties.length = 0;
  return s;
}

/**
 * 길 위 현장의 틀 (§4.2): 가로 도로 네 줄(y 8~11, T.ROAD) · 북쪽 보도(y 7) · 남쪽 보도(y 12~14 — 대기 지점·안전 구역이 있는 넓은 보도) · 위아래 건물 앞면(y ≤ 6, y ≥ 15 — 벽과 진열창,
 * 들어가지 않는다) · s.outdoor. (N8 단계 4a) 남쪽 보도를 세 줄로 넓혔다 — 안전 구역(5,12) 아래로 쓰러진 동료를 내려놓는 자리(executor rescueMate: safe.y + 1 ~ 2.2)가 벽이 되지 않게.
 * opt.lanes 가 참이면 지나는 차(laneRows 넷 — hazards.tickLane)와 통제 지점 둘(x 3·26)을 둔다. 거짓이면 차는 지나지 않는다(보도 위의 일 — 통제가 필요 없다).
 * 출입구 넷(도로 양 끝·보도 양 끝)과 출입구마다 자리 하나 + 정면 자리. 보도 둘은 수색할 수 있는 바깥 구역이다
 */
export function streetFrame(sim: Sim, I: Incident, rng: Rng, opt: { lanes: boolean; search?: boolean }): Scene {
  const s = baseScene(sim, I, rng);
  const H = s.h;
  for (let x = 0; x < SW; x++) {
    for (let y = 0; y <= 6; y++) set(s, x, y, T.WALL);
    for (let y = 15; y < H; y++) set(s, x, y, T.WALL);
    for (let y = 8; y <= 11; y++) set(s, x, y, T.ROAD);
    set(s, x, 7, T.GROUND); for (let y = 12; y <= 14; y++) set(s, x, y, T.GROUND);
  }
  // 건물 앞면: 가게마다 진열창(창 칸 — 시야는 통하지 않는 벽과 다르게 그린다). 문은 두지 않는다(안으로 들어갈 일이 없다)
  for (let x = 2; x < SW - 2; x += rng.int(3, 5)) { set(s, x, 6, T.WINDOW); set(s, x, 15, T.WINDOW); }
  s.outdoor = true;
  s.staging = { x: 2, y: 12 }; s.safe = { x: 5, y: 12 }; s.vantage = { x: 8, y: 12 };
  // 보도 둘은 바깥 구역 — opt.search 가 거짓이면 수색하지 않는 구역 (시설 사고: 사람은 보이는 자리에 있고, 수색 경로가 위험 반경을 지나지 않게 — N8 단계 4a)
  const srch = opt.search !== false;
  addRegion(s, '북쪽 보도', 'zone', 0, 7, SW - 1, 7, false, srch);
  addRegion(s, '남쪽 보도', 'zone', 0, 12, SW - 1, 14, false, srch);
  s.exits = [{ x: 0, y: 9 }, { x: SW - 1, y: 10 }, { x: 0, y: 7 }, { x: SW - 1, y: 12 }];
  s.spots = [{ x: 2, y: 9, exit: 0, taken: -1 }, { x: SW - 3, y: 10, exit: 1, taken: -1 }, { x: 2, y: 7, exit: 2, taken: -1 }, { x: SW - 3, y: 12, exit: 3, taken: -1 }, { x: 14, y: 12, exit: -1, taken: -1 }];
  if (opt.lanes) {
    addRegion(s, '차로', 'zone', 0, 8, SW - 1, 11, false, false);      // (N8 단계 4a) 차가 다니는 길 — 수색하지 않는다 (이름만: "차로에 끊어진 전선")
    s.laneRows = [8, 9, 10, 11];
    s.controlPts = [{ x: 3, y: 10 }, { x: 26, y: 9 }]; s.controlDone = [false, false];
    const node = sim.city.nodes[I.truth.nodeId];
    let cong = 1.2; for (const eid of node.edges) cong = Math.max(cong, sim.city.edges[eid].cong);
    s.trafficFlow = cong / 2.6; s.nextCarAt = sim.t + 6;
  } else { s.trafficFlow = 0; s.nextCarAt = Infinity; }
  return s;
}

// ───────────────────────── 동물 (N8 §4.3 — 단계 5) ─────────────────────────
/** 동물 하나를 놓는다 — 동물을 만드는 곳은 여기 하나 (모든 칸을 같은 순서로 채운다 — CLAUDE.md "자주 도는 객체의 모양") */
export function addAnimal(s: Scene, kind: Animal['kind'], x: number, y: number, rng: Rng, bull = false): Animal {
  const list = (s.animals ??= []);
  const n = list.filter((q) => q.kind === kind).length;
  const a: Animal = {
    id: list.length, kind, label: `${ANIMAL[kind].name}${bull ? '(황소)' : ''} ${n + 1}`,
    x, y, px: x, py: y, facing: rng.range(0, Math.PI * 2), path: null, pathI: 0,
    state: 'roam', agit: kind === 'dog' ? rng.range(0.25, 0.4) : rng.range(0.1, 0.3), sedate: 0, via: null, bull,
  };
  primeNums(a, ANIMAL_SHAPE);
  list.push(a);
  return a;
}
/** 바깥 칸 하나를 고른다 (걸을 수 있고 소품이 없고 사람·동물이 없는 칸) — 사각 범위 안에서 */
export function freeGround(s: Scene, rng: Rng, x0: number, y0: number, x1: number, y1: number): number {
  for (let k = 0; k < 60; k++) {
    const x = rng.int(x0, x1), y = rng.int(y0, y1), i = y * s.w + x;
    if (s.tiles[i] !== T.GROUND || s.propAt[i] >= 0) continue;
    if (s.casualties.some((c) => Math.round(c.x) === x && Math.round(c.y) === y)) continue;
    if (s.animals && s.animals.some((a) => Math.round(a.x) === x && Math.round(a.y) === y)) continue;
    return i;
  }
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * s.w + x; if (s.tiles[i] === T.GROUND && s.propAt[i] < 0) return i; }
  return y0 * s.w + x0;
}
/**
 * 농가·들의 틀 (멧돼지): 위쪽 숲 가장자리(나무 — 산·들로 이어지는 출구 둘), 가운데 밭과 집 두 채(벽 덩어리)·울타리, 아래쪽 찻길(y 17~19 — 양 끝이 찻길 출구 둘).
 * 출구 넷의 종류(s.exitKind)는 [산, 산, 찻길, 찻길]. 대기 지점은 찻길 가운데, 안전한 곳은 집 곁. 바깥 구역 셋(수색할 수 있다 — 동물을 못 찾았을 때 지휘 규칙이 낸다)
 */
export function farmFrame(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  for (let x = 0; x < SW; x++) {
    for (let y = 17; y < SH; y++) set(s, x, y, T.ROAD);
    for (let y = 0; y <= 2; y++) if (rng.chance(0.45) && x !== 7 && x !== 8 && x !== 21 && x !== 22) set(s, x, y, T.TREE);
  }
  for (let y = 5; y <= 8; y++) for (let x = 3; x <= 8; x++) set(s, x, y, T.WALL);       // 집 1
  for (let y = 11; y <= 14; y++) for (let x = 22; x <= 27; x++) set(s, x, y, T.WALL);   // 집 2
  for (let x = 12; x <= 17; x++) set(s, x, 11, T.WALL);                                  // 울타리 한 토막
  s.outdoor = true;
  s.staging = { x: 15, y: 18 }; s.safe = { x: 10, y: 9 }; s.vantage = { x: 15, y: 15 };
  addRegion(s, '숲 가장자리', 'zone', 0, 0, SW - 1, 2, false, true);
  addRegion(s, '밭', 'zone', 0, 3, SW - 1, 15, false, true);
  addRegion(s, '찻길', 'zone', 0, 16, SW - 1, SH - 1, false, false);
  s.exits = [{ x: 7, y: 0 }, { x: 22, y: 0 }, { x: 0, y: 18 }, { x: SW - 1, y: 18 }];
  s.exitKind = ['wild', 'wild', 'road', 'road'];
  s.spots = [{ x: 7, y: 2, exit: 0, taken: -1 }, { x: 22, y: 2, exit: 1, taken: -1 }, { x: 2, y: 17, exit: 2, taken: -1 }, { x: SW - 3, y: 17, exit: 3, taken: -1 }, { x: 15, y: 15, exit: -1, taken: -1 }];
  s.trafficFlow = 0; s.nextCarAt = Infinity;
  return s;
}
/**
 * 집과 마당의 틀 (벌집): 위쪽 집(벽 · 바닥 · 현관문 — 안쪽이 안전한 곳), 처마 밑 마당, 아래쪽 길(y 17~19). 출구 둘(마당 양 끝). 벌집 자리는 현장 생성기가 정한다
 */
export function yardFrame(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  for (let x = 0; x < SW; x++) for (let y = 17; y < SH; y++) set(s, x, y, T.ROAD);
  for (let y = 2; y <= 7; y++) for (let x = 6; x <= 23; x++) set(s, x, y, y === 2 || y === 7 || x === 6 || x === 23 ? T.WALL : T.FLOOR);
  for (const x of [9, 12, 17, 20]) set(s, x, 7, T.WINDOW);
  set(s, 14, 7, T.DOOR);
  const inside = addRegion(s, '집 안', 'room', 7, 3, 22, 6, true, false);
  addProp(s, 'door', 14, 7, { open: true }); s.region[7 * s.w + 14] = inside.id; inside.tiles.push(7 * s.w + 14);
  s.outdoor = true;
  s.staging = { x: 3, y: 18 }; s.safe = { x: 14, y: 4 }; s.vantage = { x: 14, y: 14 };
  addRegion(s, '마당', 'zone', 0, 8, SW - 1, 16, false, true);
  addRegion(s, '길', 'zone', 0, 17, SW - 1, SH - 1, false, false);
  s.exits = [{ x: 0, y: 12 }, { x: SW - 1, y: 12 }];
  s.spots = [{ x: 2, y: 12, exit: 0, taken: -1 }, { x: SW - 3, y: 12, exit: 1, taken: -1 }, { x: 14, y: 14, exit: -1, taken: -1 }];
  s.trafficFlow = 0; s.nextCarAt = Infinity;
  return s;
}
/**
 * 주택가 골목의 틀 (개 물림): 집 덩어리 여섯(벽) 사이로 골목 — 세로 골목 둘(x 8~11 · 18~21)·가운데 길(y 7~10)·아래 골목(y 16), 아래쪽 찻길(y 17~19).
 * 위쪽 골목 끝 둘은 뒷산(산 출구), 가운데 길 양 끝은 찻길 출구. 숨을 자리(s.kinds.hides)는 골목 끝·모퉁이. 골목 구역 넷은 수색할 수 있다
 */
export function alleyFrame(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  for (let x = 0; x < SW; x++) for (let y = 17; y < SH; y++) set(s, x, y, T.ROAD);
  const blocks: [number, number, number, number][] = [[1, 1, 7, 6], [12, 1, 17, 6], [22, 1, 28, 6], [1, 11, 7, 15], [12, 11, 17, 15], [22, 11, 28, 15]];
  for (const [x0, y0, x1, y1] of blocks) for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) set(s, x, y, T.WALL);
  for (const [x0, , x1, y1] of blocks) for (let x = x0 + 1; x < x1; x += 3) set(s, x, y1, T.WINDOW);
  s.outdoor = true;
  s.staging = { x: 15, y: 18 }; s.safe = { x: 10, y: 16 }; s.vantage = { x: 15, y: 9 };
  addRegion(s, '서쪽 골목', 'zone', 8, 0, 11, 6, false, true);
  addRegion(s, '동쪽 골목', 'zone', 18, 0, 21, 6, false, true);
  addRegion(s, '가운데 길', 'zone', 0, 7, SW - 1, 10, false, true);
  addRegion(s, '아래 골목', 'zone', 0, 11, SW - 1, 16, false, true);
  addRegion(s, '찻길', 'zone', 0, 17, SW - 1, SH - 1, false, false);
  s.exits = [{ x: 9, y: 0 }, { x: 20, y: 0 }, { x: 0, y: 8 }, { x: SW - 1, y: 9 }];
  s.exitKind = ['wild', 'wild', 'road', 'road'];
  s.spots = [{ x: 9, y: 2, exit: 0, taken: -1 }, { x: 20, y: 2, exit: 1, taken: -1 }, { x: 2, y: 8, exit: 2, taken: -1 }, { x: SW - 3, y: 9, exit: 3, taken: -1 }, { x: 15, y: 9, exit: -1, taken: -1 }];
  const hides: number[] = [];
  for (const [x, y] of [[11, 1], [18, 1], [8, 14], [21, 13], [0, 12], [SW - 1, 14], [11, 12]]) { const i = y * s.w + x; if (s.tiles[i] === T.GROUND) hides.push(i); }
  s.kinds = { hides };
  s.trafficFlow = 0; s.nextCarAt = Infinity;
  return s;
}

// ───────────────────────── 치안 (N8 §4.4 — 단계 6a) ─────────────────────────
/**
 * 시장의 틀 (날치기): 골목 틀(alleyFrame)에 노점을 놓는다 — 가운데 큰길(y 7~10)의 위아래 가장자리(y 7·10)에 노점 칸(T.FURN — 지나지 못하고 시야는 통한다)을
 * 골목 어귀를 비워 둔 채 듬성듬성. 구역 이름을 시장으로 바꾸고, 동물의 출구 종류(exitKind)는 지운다. 숨을 자리(s.kinds.hides)는 골목 틀의 것 그대로
 */
export function marketFrame(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = alleyFrame(sim, I, rng);
  s.exitKind = undefined;
  for (const r of s.regions) if (r.name === '가운데 길') r.name = '시장 큰길'; else if (r.name === '아래 골목') r.name = '시장 뒷골목';
  for (const y of [7, 10]) for (let x = 2; x < SW - 2; x++) {
    if ((x >= 7 && x <= 12) || (x >= 17 && x <= 22)) continue;      // 골목 어귀 (세로 골목 x 8~11 · 18~21 과 그 곁)
    if (rng.chance(0.55)) { set(s, x, y, T.FURN); s.decor[y * s.w + x] = DECOR.COUNTER; }      // 가구 칸은 늘 종류가 있다 (부서진 뒤 잔해의 그림·파손 시험이 읽는다)
  }
  return s;
}

// ───────────────────────── 보호 (N8 §4.5 — 단계 7) ─────────────────────────
/**
 * 도심의 틀 (치매 노인·미아): 골목 틀(alleyFrame)의 구역 이름을 그 현장에 맞게 바꾼다(수색 구역 넷 + 수색하지 않는 찻길).
 * 동물의 출구 종류·숨을 자리는 지운다. 보호자가 기다리는 자리는 s.safe(대기 지점 곁) 그대로 — escort 가 그리로 데려간다(§4.5 보호자 인계)
 */
export function urbanFrame(sim: Sim, I: Incident, rng: Rng, names: [string, string, string, string]): Scene {
  const s = alleyFrame(sim, I, rng);
  s.exitKind = undefined; s.kinds = {};
  const from = ['서쪽 골목', '동쪽 골목', '가운데 길', '아래 골목'];
  for (const r of s.regions) { const k = from.indexOf(r.name); if (k >= 0) r.name = names[k]; }
  return s;
}

// ───────────────────────── 구조·응급의 열린 터 (N8 §4.6·§4.7 — 단계 8·9) ─────────────────────────
/**
 * 열린 터의 틀 (구덩이·놀이기구·폭염): 위쪽 가장자리에 듬성듬성 나무, 가운데 넓은 땅(구역 하나 — 수색하지 않는다: 사람은 보이는 자리에 있다), 아래쪽 길(y 17~19).
 * 출구 넷(양 옆 둘 · 길 양 끝 둘). 대기 지점은 길 가운데, 안전한 곳은 길 위 땅의 왼쪽. 바깥 현장(s.outdoor — X6 의 구조물이 아니다)
 */
export function openFrame(sim: Sim, I: Incident, rng: Rng, field: string): Scene {
  const s = baseScene(sim, I, rng);
  for (let x = 0; x < SW; x++) {
    for (let y = 17; y < SH; y++) set(s, x, y, T.ROAD);
    if (rng.chance(0.35) && x > 1 && x < SW - 2) set(s, x, 0, T.TREE);
  }
  s.outdoor = true;
  s.staging = { x: 15, y: 18 }; s.safe = { x: 5, y: 15 }; s.vantage = { x: 15, y: 15 };
  addRegion(s, field, 'zone', 0, 0, SW - 1, 16, false, false);
  addRegion(s, '길', 'zone', 0, 17, SW - 1, SH - 1, false, false);
  s.exits = [{ x: 0, y: 8 }, { x: SW - 1, y: 8 }, { x: 0, y: 18 }, { x: SW - 1, y: 18 }];
  s.spots = [{ x: 2, y: 8, exit: 0, taken: -1 }, { x: SW - 3, y: 8, exit: 1, taken: -1 }, { x: 2, y: 17, exit: 2, taken: -1 }, { x: SW - 3, y: 17, exit: 3, taken: -1 }, { x: 15, y: 15, exit: -1, taken: -1 }];
  s.trafficFlow = 0; s.nextCarAt = Infinity;
  return s;
}
