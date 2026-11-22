// 사건 종류 다양화 ① 일상 사건의 현장 (docs/specs/N8-incident-kinds.md §4) — 진실을 만든다.
// registerScene('유형', '변형', (sim, I, rng) => Scene). 만드는 도구는 ../kindsKit(buildQuiet·streetFrame), ../builders, ../kit.
//
// 단계 3: 비응급 N1 장난 전화 셋(빈 현장) · N2 오인 신고 넷(§4.8 — 가서 확인하면 "이상 없음"의 답이 현장에 있다).
import { T } from '../../types';
import { SW, addCas, addHostile, addProp, addRegion, baseScene, freeTileIn, set } from '../kit';
import { armedVenue, buildStop } from '../builders';
import { tidx } from '../grid';
import { addAnimal, alleyFrame, buildQuiet, farmFrame, freeGround, marketFrame, streetFrame, urbanFrame, yardFrame } from '../kindsKit';
import { TYPE_DEFS } from '../../incidentTypes';
import type { Sim } from '../../engine';
import type { Rng } from '../../rng';
import type { Scene } from '../../types';
import { registerScene } from '../sceneRegistry';

// ── 시설 사고 (§4.2 — 단계 4a·4b) ──
/**
 * (4a) 끊어진 전선: 길(streetFrame — 차가 지나는 네 차로) 위에 늘어진 전선과 기운 전봇대. 위험 반경 r = 2.2칸(비 +1) — 전선(fixture 'wire', live)의 자리가 가운데.
 * 전선은 북쪽 반(차로 y 8 · 전봇대는 북쪽 보도)이나 남쪽 반(y 11 · 남쪽 보도)에 늘어진다 — 반경이 길을 다 덮지 않아 반대쪽으로 돌아갈 길이 남는다.
 * 대기 지점(2,12)·현장 평가 자리(8,12)는 반경 밖이 되게 x 13~19. 갈래(scene 흐름 — 만들 때 한 번): 차 위 전선 35%(반경 안의 승용차, 다치지 않은 탑승자 1~2 — 차 안에 머문다)
 * · 감전된 행인 25%(반경 안 · 거동 불가 · 체력 55~80 — 처음 원인 감전) · 불꽃이 길가 덤불에 옮겨붙을 자리 20%(반경 가장자리의 연료 칸 2~3) · 없음 20%.
 * 보도는 수색하지 않는다(사람은 보이는 자리에 있다 — 수색 경로가 반경을 지나지 않게). 세계 규칙은 rules/kinds.ts 의 wireRule
 */
registerScene('utility', 'wire', (sim, I, rng) => {
  const s = streetFrame(sim, I, rng, { lanes: true, search: false });
  s.placeName = '전선 단선 현장';
  s.leadDept = 'fire';
  const north = rng.chance(0.5);
  const wy = north ? 8 : 11, side = north ? 7 : 12;
  const wx = rng.int(13, 19);
  const r = 2.2 + (sim.weather === 'rain' ? 1 : 0);
  addProp(s, 'fixture', wx - 1, side, { skin: 'pole', blocking: true, angle: rng.range(-0.35, 0.35) });
  addProp(s, 'fixture', wx, wy, { skin: 'wire', blocking: false, live: true, angle: rng.range(-0.5, 0.5) });
  s.kinds = { told: false, remoteAt: Infinity, hazR: r, exitAt: Infinity, tellT: 0, needSince: -1, remoteReq: -1, sparkT: 0 };
  const g = rng.next();
  if (g < 0.35) {
    // 차 위로 전선이 떨어졌다: 탄 사람은 다치지 않았지만 내리면 감전된다 (말을 듣지 못하면 exitAt 에 내리려 한다 — wireRule)
    const car = addProp(s, 'vehicle', wx - 1, wy, { w: 2, h: 1, blocking: true, hp: 10, leak: 0, leakRate: 0, occupants: [], angle: rng.range(-0.15, 0.15), color: rng.int(0, 4) });
    const n = rng.chance(0.45) ? 2 : 1;
    for (let k = 0; k < n; k++) { const c = addCas(s, car.x + (k % 2), wy, 'immobile', 100, 0, 0.2, { inVehicle: car.id }); car.occupants!.push(c.id); }
    s.kinds.exitAt = sim.t + rng.range(60, 140);
  } else if (g < 0.6) {
    addCas(s, wx + 1, side, 'immobile', rng.range(55, 80), rng.range(0.02, 0.05), 0.1);      // 감전된 행인 (반경 안 — 전선이 죽기 전에는 아무도 다가가지 못한다)
  } else if (g < 0.8) {
    // 불꽃이 옮겨붙을 길가 덤불: 보도의 반경 가장자리 칸 (wireRule 이 1초에 0.01 — 비 0.004 — 로 불을 붙인다)
    const cands: number[] = [];
    for (let x = 1; x < s.w - 1; x++) { const d = Math.hypot(x - wx, side - wy); if (d >= r - 0.8 && d <= r + 0.6 && s.tiles[side * s.w + x] === T.GROUND && s.propAt[side * s.w + x] < 0) cands.push(x); }
    const m = Math.min(cands.length, rng.int(2, 3));
    for (let k = 0; k < m; k++) { const x = cands[k * Math.max(1, Math.floor(cands.length / m))]; const i = side * s.w + x; s.tiles[i] = T.TREE; s.fuel[i] = 0.5; }
  }
  return s;
});

/**
 * (4b) 수도관 파열·지하 침수: 위쪽은 길(streetFrame — 차로 넷)과 터진 관(fixture 'pipe', sub 'water', live — 둘레 젖은 바닥), 아래쪽은 길가 건물의
 * 1층 로비(왼쪽)와 지하 주차장(오른쪽) — 두 층을 같은 격자에 나란히 두고 계단(stairTo)으로 잇는다(CLAUDE.md "계단" — 사이는 빈 공간 3칸 + 벽, 실내 칸끼리 6칸).
 * 지하에 차 1~3대(진입로 쪽 줄에)와 사람 0~2(60% 에 1명 이상 — 걸을 수 있지만 침수가 0.7 을 넘으면 고립된다). 세계 규칙은 rules/kinds.ts 의 mainRule
 */
registerScene('utility', 'main', (sim, I, rng) => {
  void sim;
  const s = streetFrame(sim, I, rng, { lanes: true, search: false });
  s.placeName = '수도관 파열 현장';
  s.leadDept = 'fire';
  for (let x = 0; x < s.w; x++) for (let y = 15; y < s.h; y++) set(s, x, y, x >= 13 && x <= 15 ? T.VOID : T.WALL);
  for (let x = 2; x <= 11; x++) for (let y = 16; y <= 18; y++) set(s, x, y, T.FLOOR);
  for (let x = 17; x <= 27; x++) for (let y = 16; y <= 18; y++) set(s, x, y, T.FLOOR);
  set(s, 6, 15, T.FLOOR); set(s, 7, 15, T.FLOOR);      // 로비 입구 (보도에서 바로)
  const st1 = 17 * s.w + 11, st2 = 17 * s.w + 17;
  s.tiles[st1] = T.STAIR; s.tiles[st2] = T.STAIR; s.stairTo[st1] = st2; s.stairTo[st2] = st1;
  addRegion(s, '1층 로비', 'room', 2, 15, 11, 18, true, true);
  const base = addRegion(s, '지하 주차장', 'room', 17, 16, 27, 18, true, true);
  const cars = rng.int(1, 3);
  for (let k = 0; k < cars; k++) addProp(s, 'vehicle', 19 + 3 * k, 16, { w: 2, h: 1, blocking: true, hp: 10, leak: 0, leakRate: 0, occupants: [], angle: 0, color: rng.int(0, 4) });
  const people = rng.chance(0.6) ? rng.int(1, 2) : 0;
  for (let k = 0; k < people; k++) addCas(s, 20 + 4 * k, 18, 'mobile', 100, 0, 0.3);
  const px = rng.int(13, 19), py = rng.chance(0.5) ? 9 : 10;
  addProp(s, 'fixture', px, py, { skin: 'pipe', sub: 'water', blocking: false, live: true });
  for (let y = 7; y <= 14; y++) for (let x = 0; x < s.w; x++) if (Math.hypot(x - px, y - py) <= 3.2 && s.tiles[y * s.w + x] !== T.WALL) s.wet[y * s.w + x] = 1;
  s.kinds = { flood: 0, base: base.id, wetTold: 0, needSince: -1 };
  return s;
});

/**
 * (4b) 싱크홀: 길 위에 꺼진 구멍(fixture 'hole' — 처음 반경 1.5~2.5칸). 구멍 안의 칸은 모두 T.VOID — 빠진 사람이 있는 칸도(걸어서 닿는 길은 없다 — 가장자리에서 줄로).
 * 보도 맨 바깥 줄(y 7 · 13~14)은 꺼지지 않는다 — 구멍이 넓어져도 길 양쪽이 이어진다. 빠진 것(scene 흐름): 승용차 50%(탄 사람 1~2 — 고립) · 행인 30%(고립) · 없음 20%.
 * 밑의 관: 물 50%(가장자리 바깥 칸의 터진 관 — fixture 'pipe' sub 'water') · 가스 25%(가장자리 바깥 칸의 밸브 + s.rules 'gas' — 지금의 tickGas) · 없음 25%.
 * 그 칸과 옆 한 칸은 넓어져도 꺼지지 않는다(s.kinds.keep). 차는 지나지 않는다(생성 때 그 구간을 막았다 — 시나리오 onCreate). 세계 규칙은 holeRule
 */
registerScene('utility', 'sinkhole', (sim, I, rng) => {
  void sim;
  const s = streetFrame(sim, I, rng, { lanes: true, search: false });
  s.trafficFlow = 0; s.nextCarAt = Infinity;
  s.placeName = '싱크홀 현장';
  s.leadDept = 'fire';
  const hx = rng.int(13, 18), hy = rng.chance(0.5) ? 9 : 10;
  const r0 = rng.range(1.5, 2.5);
  addProp(s, 'fixture', hx, hy, { skin: 'hole', blocking: false });
  for (let y = 8; y <= 12; y++) for (let x = 1; x < s.w - 1; x++) if (Math.hypot(x - hx, y - hy) <= r0) set(s, x, y, T.VOID);
  // 구멍 둘레는 길가(verge)처럼 살펴볼 바깥 구역 — 신고된 인원을 다 찾지 못했으면 누군가 가장자리에서 구멍 안을 내려다본다(밤·안개 — 핵심 규칙의 길가 수색)
  addRegion(s, '싱크홀 가장자리', 'verge', Math.max(1, hx - 4), 7, Math.min(s.w - 2, hx + 4), 12, false, true);
  const g = rng.next();
  if (g < 0.5) {
    const car = addProp(s, 'vehicle', hx - 1, hy, { w: 2, h: 1, blocking: true, hp: 10, leak: 0, leakRate: 0, occupants: [], angle: rng.range(-0.4, 0.4), color: rng.int(0, 4) });
    const n = rng.chance(0.45) ? 2 : 1;
    for (let k = 0; k < n; k++) { const c = addCas(s, hx - 1 + k, hy, 'trapped', rng.range(55, 85), rng.range(0.02, 0.06), 0.1, { inVehicle: car.id }); c.trapWork = 10; car.occupants!.push(c.id); }
  } else if (g < 0.8) {
    const c = addCas(s, hx + (rng.chance(0.5) ? 1 : -1), hy, 'trapped', rng.range(60, 85), rng.range(0.02, 0.05), 0.1);
    c.trapWork = 10;
  }
  const keep: number[] = [];
  const g2 = rng.next();
  if (g2 < 0.75) {
    // 가장자리 바깥의 걸을 수 있는 칸 (반경 + 0.6 ~ + 1.6, 바로 옆 한 칸이 빈 바닥 — CLAUDE.md "가구 자리에 소품을 놓을 때")
    let best = -1, bd = Infinity;
    for (let y = 8; y <= 12; y++) for (let x = 2; x < s.w - 2; x++) {
      const i = y * s.w + x, d = Math.hypot(x - hx, y - hy);
      if (s.tiles[i] === T.VOID || s.tiles[i] === T.WALL || d < r0 + 0.6 || d > r0 + 1.6) continue;
      if (s.tiles[i + 1] === T.VOID && s.tiles[i - 1] === T.VOID) continue;
      const score = Math.abs(d - r0 - 1) + (y === hy ? 0 : 0.3) + x * 1e-3;
      if (score < bd) { bd = score; best = i; }
    }
    if (best >= 0) {
      const bx = best % s.w, by = (best / s.w) | 0;
      if (g2 < 0.5) addProp(s, 'fixture', bx, by, { skin: 'pipe', sub: 'water', blocking: false, live: true });
      else { addProp(s, 'valve', bx, by, { blocking: true, leakRate: 0.45 }); s.rules = ['gas']; }
      keep.push(best);
      for (const k of [best - 1, best + 1, best - s.w, best + s.w]) keep.push(k);
    }
  }
  s.kinds = { hazR: r0, holeR0: r0, keep };
  return s;
});

/**
 * (4b) 떨어질 듯한 간판: 위쪽 건물 앞면(벽) 아래 보도에 매달린 간판(fixture 'sign', live = 매달려 있음 — 흔들림은 leak 0..1, 1 이면 떨어진다).
 * 낙하 구역 = 간판 아래 보도·첫 차로 3×2칸(s.kinds.zone). 이미 하나가 떨어진 것 30%: 아래에 다친 행인 1(처음 원인 깔림)과 떨어진 간판 잔해(roadDebris 'signDebris').
 * 세계 규칙은 signRule
 */
registerScene('utility', 'sign', (sim, I, rng) => {
  const s = streetFrame(sim, I, rng, { lanes: true, search: false });
  const pl = I.truth.placeId >= 0 ? sim.city.places[I.truth.placeId] : undefined;
  s.placeName = pl ? `${pl.name} 앞` : '간판 낙하 위험 현장';
  s.leadDept = 'fire';
  const sx = rng.int(10, 19);
  addProp(s, 'fixture', sx, 7, { skin: 'sign', blocking: false, live: true, leak: 0, leakRate: rng.range(0.004, 0.009) * (sim.weather === 'rain' ? 1.5 : 1), angle: 0 });
  const zone: number[] = [];
  for (let y = 7; y <= 8; y++) for (let x = sx - 1; x <= sx + 1; x++) zone.push(y * s.w + x);
  if (rng.chance(0.3)) {
    addCas(s, sx - 1, 8, 'immobile', rng.range(60, 85), rng.range(0.02, 0.05), 0.1);
    addProp(s, 'roadDebris', sx + 1, 8, { skin: 'signDebris', blocking: false });
  }
  s.kinds = { hazR: 2, zone };
  return s;
});

// ── 동물 (§4.3 — 단계 5) ──
/** 장소 이름: 지도의 건물이 있으면 '<이름> 곁', 없으면 기본 글자 */
function nearName(sim: import('../../engine').Sim, I: import('../../types').Incident, dflt: string): string { const pl = I.truth.placeId >= 0 ? sim.city.places[I.truth.placeId] : undefined; return pl ? `${pl.name} 곁` : dflt; }
/**
 * 멧돼지 출몰: 농가·들의 틀(farmFrame — 위쪽 숲 가장자리의 산 출구 둘 · 아래쪽 찻길 출구 둘). 멧돼지 1(60%)·2(30%)·3(10%) 은 밭 가운데,
 * 바깥 사람 0~2(걸을 수 있다 — 대원이 보면 안전한 곳으로 간다), 25% 에 들이받힌 사람 1(거동 불가 · 체력 50~75 — 처음 원인 동물). 세계 규칙은 rules/kinds.ts 의 animalRule
 */
registerScene('animal', 'boar', (sim, I, rng) => {
  const s = farmFrame(sim, I, rng);
  s.placeName = nearName(sim, I, '마을 텃밭');
  s.leadDept = 'fire';
  const r = rng.next(), n = r < 0.6 ? 1 : r < 0.9 ? 2 : 3;
  for (let k = 0; k < n; k++) { const i = freeGround(s, rng, 10, 5, 20, 10); addAnimal(s, 'boar', i % s.w, (i / s.w) | 0, rng); }
  const by = rng.int(0, 2);
  for (let k = 0; k < by; k++) { const i = freeGround(s, rng, 4, 3, 26, 15); addCas(s, i % s.w, (i / s.w) | 0, 'mobile', 100, 0, 0.1); }
  if (rng.chance(0.25)) { const i = freeGround(s, rng, 9, 9, 21, 14); addCas(s, i % s.w, (i / s.w) | 0, 'immobile', rng.range(50, 75), rng.range(0.02, 0.05), 0.1); }
  return s;
});
/**
 * 벌집: 집과 마당의 틀(yardFrame). 벌집(fixture 'hive', live — 막지 않음)은 처마 밑(집 벽 바로 앞 줄), 현관에서 4칸 넘게 떨어진 자리. 위험 반경 3.
 * 쏘인 사람 1~2(반경 밖 3.6~7칸 · 걸을 수 있음 70% · 띠 0~1 — 처음 원인 동물), 18% 에 그 가운데 1명이 알레르기 급변(체력 60 · 악화 0.35/초 — 처음 원인 병). 안전한 곳은 집 안
 */
registerScene('animal', 'hive', (sim, I, rng) => {
  const s = yardFrame(sim, I, rng);
  s.placeName = nearName(sim, I, '주택 마당');
  s.leadDept = 'fire';
  const hx = rng.chance(0.5) ? rng.int(8, 10) : rng.int(18, 21);
  addProp(s, 'fixture', hx, 8, { skin: 'hive', blocking: false, live: true });
  s.kinds = { hiveWide: -1 };
  const n = rng.chance(0.5) ? 2 : 1, allergic = rng.chance(0.18);
  for (let k = 0; k < n; k++) {
    // 쏘인 사람은 이미 벌 떼에서 몇 걸음 물러나 있다 (반경 3 밖 — 3.6~7칸). 떼어 내는 동안 커진 반경(4.5) 안에 남은 사람은 다시 쏘인다
    let i = -1;
    for (let tries = 0; tries < 12 && i < 0; tries++) { const j = freeGround(s, rng, Math.max(1, hx - 6), 9, Math.min(s.w - 2, hx + 6), 14), d = Math.hypot(j % s.w - hx, ((j / s.w) | 0) - 8); if (d >= 3.6 && d <= 7) i = j; }
    if (i < 0) i = freeGround(s, rng, 12, 12, 16, 14);
    const walk = rng.chance(0.7) && !(allergic && k === 0);
    if (allergic && k === 0) addCas(s, i % s.w, (i / s.w) | 0, 'immobile', 60, 0.35, 0.1);
    else addCas(s, i % s.w, (i / s.w) | 0, walk ? 'mobile' : 'immobile', walk ? rng.range(82, 95) : rng.range(68, 82), walk ? 0 : rng.range(0.01, 0.03), 0.1);
  }
  return s;
});
/**
 * 개 물림: 주택가 골목의 틀(alleyFrame — 숨을 자리 s.kinds.hides). 개 1(가운데 길), 물린 사람 1(걸을 수 있음 60% · 거동 불가 40% · 체력 60~85),
 * 40% 에 주인(목격자 — 면담하면 개가 숨으러 간 쪽의 골목, 70% 맞음)
 */
registerScene('animal', 'dogbite', (sim, I, rng) => {
  const s = alleyFrame(sim, I, rng);
  s.placeName = nearName(sim, I, '주택가 골목');
  s.leadDept = 'fire';
  const di = freeGround(s, rng, 4, 7, 25, 10);
  addAnimal(s, 'dog', di % s.w, (di / s.w) | 0, rng);
  const ci = freeGround(s, rng, 6, 7, 23, 10);
  const walk = rng.chance(0.6);
  addCas(s, ci % s.w, (ci / s.w) | 0, walk ? 'mobile' : 'immobile', rng.range(60, 85), walk ? 0 : rng.range(0.01, 0.04), 0.1);
  if (rng.chance(0.4)) {
    const zones = s.regions.filter((r) => r.kind === 'zone' && r.searchable);
    const truth = zones[rng.int(0, zones.length - 1)];
    const said = rng.chance(0.7) ? truth : zones[rng.int(0, zones.length - 1)];
    const wi = freeGround(s, rng, 12, 16, 18, 16);
    addProp(s, 'witness', wi % s.w, (wi / s.w) | 0, { lastSeenRegion: said.id, accurate: said === truth, interviewed: false });
    // 개가 먼저 숨으러 가는 쪽: 주인이 본(맞으면 그 골목) 쪽의 숨을 자리를 앞에 둔다
    const hz = s.kinds!.hides!;
    hz.sort((a, b) => (s.region[a] === truth.id ? 0 : 1) - (s.region[b] === truth.id ? 0 : 1));
  }
  return s;
});
/**
 * 가축 탈출(도로): 길의 틀(streetFrame — 차가 지나는 네 차로, 출구 넷은 모두 찻길) + 북쪽 길가의 농가 우리(구역 'pen' — 우리 안에 들어간 가축은 잡힌 것).
 * 소(60%) 또는 돼지 3~6마리가 차로 위에, 10% 에 흥분한 황소 하나(돌진 문턱 0.75). 지나는 차와 부딪칠 수 있다(animalRule)
 */
registerScene('animal', 'escape', (sim, I, rng) => {
  const s = streetFrame(sim, I, rng, { lanes: true, search: true });
  s.placeName = '농가 곁 도로';
  s.leadDept = 'police';
  for (let y = 2; y <= 6; y++) for (let x = 19; x <= 26; x++) set(s, x, y, y === 2 || x === 19 || x === 26 ? T.WALL : T.GROUND);
  const pen = addRegion(s, '농가 우리', 'pen', 20, 3, 25, 6, false, false);
  s.exitKind = ['road', 'road', 'road', 'road'];
  s.kinds = { pen: pen.id };
  const kind = rng.chance(0.6) ? 'cow' : 'pig';
  const n = rng.int(3, 6), bull = kind === 'cow' && rng.chance(0.1);
  for (let k = 0; k < n; k++) { const i = freeGround(s, rng, 7, 8, 18, 11); addAnimal(s, kind, i % s.w, (i / s.w) | 0, rng, bull && k === 0); }
  return s;
});

// ── N1 장난 전화: 그 유형의 장소에 아무 일도 없다 (기존 armed/prank 는 builders.buildArmed 의 같은 갈래) ──
registerScene('fire', 'prank', buildQuiet);
registerScene('medical', 'prank', buildQuiet);
registerScene('water', 'prank', buildQuiet);

// ── N2 오인 신고 ──
// 응급: 길의 보도에 잠든 사람(띠 0 · 체력 95 · 처음에는 누워 있다). 대원이 1.5칸 안에 오면 깨어나 걸어서 귀가한다(rules/kinds.ts 의 wakeRule — 안전한 곳으로 걸어가 where 'safe')
registerScene('medical', 'false', (sim, I, rng) => {
  const s = streetFrame(sim, I, rng, { lanes: false });
  const y = rng.chance(0.5) ? 7 : 12;
  addCas(s, rng.int(11, 21), y, 'immobile', 95, 0, 0);
  s.placeName = '길가';
  s.leadDept = 'ems';
  return s;
});
// 수난: 하천에 사람은 없고 물 위에 떠 있는 물건(마네킹·쓰레기 봉투) — 4칸 안·시야선이면 사실 evid floater ("사람이 아님")
registerScene('water', 'false', (sim, I, rng) => {
  const s = buildQuiet(sim, I, rng);
  const x = rng.int(6, 18);
  let y0 = -1, y1 = -1;
  for (let y = 0; y < s.h; y++) if (s.tiles[y * s.w + x] === T.WATER) { if (y0 < 0) y0 = y; y1 = y; }
  if (y0 >= 0) addProp(s, 'fixture', x, Math.min(y1, y0 + rng.int(1, 3)), { skin: 'floater', blocking: false, angle: rng.range(-0.6, 0.6) });
  return s;
});
// 무장: 가게에 용의자는 없고 정문 앞 길가에 터진 폭죽 잔해 — 3칸 안·시야선이면 사실 evid fireworks ("총소리가 아니었음"), 지휘 규칙이 남은 방 수색을 거둔다
registerScene('armed', 'false', (sim, I, rng) => {
  const s = buildQuiet(sim, I, rng);
  const e = s.exits[0];
  if (e) {
    let fx = e.x, fy = e.y;
    for (const [dx, dy] of [[0, 2], [1, 2], [-1, 2], [0, 1], [2, 1], [-2, 1]]) {
      const x = e.x + dx, y = e.y + dy;
      if (x < 0 || y < 0 || x >= s.w || y >= s.h) continue;
      const t = s.tiles[y * s.w + x];
      if ((t === T.GROUND || t === T.ROAD) && s.propAt[y * s.w + x] < 0) { fx = x; fy = y; break; }
    }
    addProp(s, 'fixture', fx, fy, { skin: 'fireworks', blocking: false, angle: rng.range(-1, 1) });
  }
  return s;
});
// 가스: 밸브 없는 건물(buildQuiet — 오인 신고의 빈 건물) 한 방의 음식물 쓰레기 — 측정기를 든 대원이 2칸 안·시야선이면 사실 haz leak(active false) "가스 아님"
registerScene('hazmat', 'false', (sim, I, rng) => {
  const s = buildQuiet(sim, I, rng);
  const rooms = s.regions.filter((r) => r.kind === 'room' && r.indoor);
  if (rooms.length) {
    const r = rng.pick(rooms);
    const cands = r.tiles.filter((i) => s.tiles[i] === T.FLOOR && s.propAt[i] < 0);
    if (cands.length) { const i = rng.pick(cands); addProp(s, 'fixture', i % s.w, (i / s.w) | 0, { skin: 'trash', blocking: false }); }
  }
  return s;
});

// ───────────────────────── 치안 disturb (§4.4 — 단계 6a) ─────────────────────────
/**
 * 주취 소란: 가게 틀(builders.armedVenue 'shop') — 주취자 1(맨손, 공격성 0.3~0.7, 사기 0.45~0.8, 이름표 '주취자'), 손님 1~3(걸을 수 있음).
 * 25% 는 처음부터 쓰러져 잠든 상태(state 'hold' + asleep — 'down' 은 판정이 검거로 센다), 숨은 상태 35% 머리 부상(s.kinds.headInjury)
 */
registerScene('disturb', 'rowdy', (sim, I, rng) => {
  const s = baseScene(sim, I, rng);
  for (let y = 16; y <= 18; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.ROAD);
  const V = armedVenue(s, rng, 'shop', I.truth.district);
  const taken = (q: number): boolean => s.hostiles.some((h) => tidx(s, h.x, h.y) === q);
  const hi = freeTileIn(s, V.main, rng, taken);
  const h = addHostile(s, hi % SW, (hi / SW) | 0, 'none', rng.range(0.3, 0.7), 0.2, false, Infinity);
  h.label = '주취자'; h.morale = rng.range(0.45, 0.8); h.facing = rng.range(0, Math.PI * 2);
  if (rng.chance(0.25)) h.asleep = true;
  s.kinds = { headInjury: rng.chance(0.35) };
  const n = rng.int(1, 3);
  for (let k = 0; k < n; k++) { const ci = freeTileIn(s, V.main, rng, taken); addCas(s, ci % SW, (ci / SW) | 0, 'mobile', rng.range(90, 100), 0, 0.1); }
  s.placeName = nearName(sim, I, V.place || '가게');
  s.leadDept = 'police';
  return s;
});
/**
 * 폭행 시비: 길 위 틀(streetFrame — 차 없음). 무리 A 2~3명은 서쪽 보도·길, 무리 B 2~3명은 동쪽(용의자 — group, 맨손, 사기 0.4~0.7, 공격성 0.4~0.8),
 * 다친 사람 1~2(둔상 — 띠 1, 걸을 수 있음 70%). 두 무리 사이 가운데에 정면 자리(exit −1)를 하나 더 둔다
 */
registerScene('disturb', 'brawl', (sim, I, rng) => {
  const s = streetFrame(sim, I, rng, { lanes: false, search: false });
  s.placeName = nearName(sim, I, '가게 앞 길');
  const mid = rng.int(12, 17);
  const put = (x0: number, x1: number): number => freeGround(s, rng, x0, 12, x1, 14);      // 남쪽 보도 (길 칸은 freeGround 가 고르지 않는다)
  for (const g of ['A', 'B'] as const) {
    const n = rng.int(2, 3);
    for (let k = 0; k < n; k++) {
      const i = g === 'A' ? put(mid - 5, mid - 1) : put(mid + 1, mid + 5);
      const h = addHostile(s, i % s.w, (i / s.w) | 0, 'none', rng.range(0.4, 0.8), 0.25, false, Infinity);
      h.group = g; h.label = `${g === 'A' ? '가' : '나'} 무리 ${k + 1}`; h.morale = rng.range(0.4, 0.7);
      h.facing = g === 'A' ? 0 : Math.PI;
    }
  }
  const nh = rng.int(1, 2);
  for (let k = 0; k < nh; k++) { const i = put(mid - 3, mid + 3); const walk = rng.chance(0.7); addCas(s, i % s.w, (i / s.w) | 0, walk ? 'mobile' : 'immobile', rng.range(62, 80), walk ? 0 : rng.range(0, 0.02), 0.1); }
  s.spots.push({ x: mid, y: 13, exit: -1, taken: -1 });      // 두 무리 사이 가운데 — 떼어 놓는 자리 (세계 규칙은 두 무리의 가운데를 매번 잰다)
  s.leadDept = 'police';
  return s;
});
/**
 * 날치기: 시장 틀(marketFrame — 큰길의 노점·골목 셋·골목 끝 출구). 피해자 1(걸을 수 있음 50% · 넘어져 거동 불가 50% · 떨어짐 — 띠 1),
 * 목격자 1~2(면담하면 숨은 골목 — 정확도 witnessAcc), 용의자 1(사기 0.6 · 공격성 0.2)은 처음부터 골목의 숨을 자리에 숨어 있다(s.kinds.expectHidden —
 * 찾았을 때 '추가 용의자'가 아니다). 나갈 시각(hideUntil)은 첫 부대가 닿은 뒤 60~140초(세계 규칙이 정한다 — 그 전에는 Infinity)
 */
registerScene('disturb', 'snatch', (sim, I, rng) => {
  const s = marketFrame(sim, I, rng);
  s.placeName = nearName(sim, I, '시장 골목');
  // 현장 맨 가장자리의 숨을 자리는 고르지 않는다 (겪은 함정 '숨는 정도의 상한' — 동쪽 끝 칸에 숨은 용의자를 정밀 수색도 보지 못해 길목 통제만 선 채 한계 시간까지 갔다)
  const all = s.kinds!.hides!, inner = all.filter((i) => { const x = i % s.w, y = (i / s.w) | 0; return x >= 2 && y >= 2 && x <= s.w - 3 && y <= s.h - 3; });
  const hides = inner.length ? inner : all;
  const hp = hides[rng.int(0, hides.length - 1)];
  const h = addHostile(s, hp % s.w, (hp / s.w) | 0, 'none', 0.2, 0.3, true, Infinity);
  h.label = '날치기 용의자'; h.morale = 0.6; h.hideUntil = -1;
  const ci = freeGround(s, rng, 6, 8, 23, 9);
  const walk = rng.chance(0.5);
  addCas(s, ci % s.w, (ci / s.w) | 0, walk ? 'mobile' : 'immobile', rng.range(64, 82), walk ? 0 : rng.range(0.005, 0.02), 0.1);
  const zones = s.regions.filter((r) => r.kind === 'zone' && r.searchable);
  const truth = zones.find((r) => r.id === s.region[hp]) ?? zones[0];
  const nw = rng.int(1, 2);
  for (let k = 0; k < nw; k++) {
    const acc = rng.chance(sim.tune.witnessAcc);
    const said = acc ? truth : zones[rng.int(0, zones.length - 1)];
    const wi = freeGround(s, rng, 4 + k * 12, 9, 12 + k * 12, 10);
    addProp(s, 'witness', wi % s.w, (wi / s.w) | 0, { lastSeenRegion: said.id, accurate: said === truth, interviewed: false });
  }
  s.kinds!.expectHidden = true;
  s.leadDept = 'police';
  return s;
});

// ───────────────────────── 치안 disturb (§4.4 — 단계 6b) ─────────────────────────
/**
 * 수거책 잠복: 그 건물 앞 길(streetFrame — 차 없음, 수색할 구역 없음). 피해자(witness 'victim' — 면담하면 약속 시각을 안다)는 동쪽 보도의 약속 자리에 선다.
 * 수거책은 아직 없다 — 들어올 시각 s.kinds.arriveAt(생성 + 150~260초)에 동쪽 출구(s.kinds.scamExit)에서 세계 규칙(scamRule)이 만든다(그 전에는 s.hostiles 에 없다).
 * 피해자가 말하는 약속 시각 meetAt 은 arriveAt ± 20초 (진실과 다르다 — 믿음 evid meet 은 이 값). 대기 지점(서쪽 끝)에서 약속 자리까지 16칸 넘게 떨어진다
 */
registerScene('disturb', 'scam', (sim, I, rng) => {
  const s = streetFrame(sim, I, rng, { lanes: false, search: false });
  s.placeName = nearName(sim, I, '약속 장소');
  const vy = rng.chance(0.5) ? 7 : 13, vx = rng.int(18, 23);
  const reg = s.region[vy * s.w + vx];
  addProp(s, 'witness', vx, vy, { skin: 'victim', lastSeenRegion: reg >= 0 ? reg : 0, accurate: true, interviewed: false });
  s.vantage = { x: vx - 5, y: vy === 7 ? 7 : 12 };      // 현장 평가는 피해자가 보이는 자리에서 (신고자의 말 — 피해자를 만나 확인한다)
  const arrive = sim.t + rng.range(150, 260);
  s.kinds = { arriveAt: arrive, meetAt: arrive + rng.range(-20, 20), scamExit: rng.chance(0.5) ? 1 : 3, scamFled: false };
  s.leadDept = 'police';
  return s;
});
/**
 * 차량 절도: 추격 끝에 선 자리의 현장 — builders.buildStop(난폭 운전과 같은 틀: 막혀 서면 운전자 한 명 · 사고로 서면 다친 운전자)을 그대로 부르고 이름만 바꾼다.
 * 세운 뒤 55% 는 운전자가 곧바로 내려 달아난다(fleeAt = 지금 — 지금의 용의자 규칙이 대원이 3칸 밖이면 막히지 않은 출구로 달아난다 · 도보 추격).
 * 신고자 모델을 위해 사건이 생길 때 한 번, 차가 선 뒤 한 번 더 만든다(같은 scene 흐름 — 같은 사람·같은 추첨)
 */
registerScene('disturb', 'cartheft', (sim, I, rng) => {
  const s = buildStop(sim, I, rng);
  const crash = !!I.pursuit && I.pursuit.how === 'crash';
  s.placeName = crash ? '도난 차량 사고 현장' : '도난 차량 검거 현장';
  for (const r of s.regions) if (r.name === '난폭 운전 차량') r.name = '도난 차량';
  for (const h of s.hostiles) h.label = '차량 절도 용의자';
  const flee = rng.chance(0.55);
  s.kinds = { stopFled: flee };
  if (flee && I.pursuit && I.pursuit.state === 'stopped') for (const h of s.hostiles) h.fleeAt = sim.t;
  return s;
});

// ───────────────────────── 보호 welfare (§4.5 — 단계 7) ─────────────────────────
/** 걷는 대상 하나와 보호자(마지막으로 본 구역 — 정확도 witnessAcc)를 놓는다. 대상은 대기 지점에서 먼 구역일수록 자주 */
function placeWanderer(sim: Sim, s: Scene, rng: Rng, health: [number, number], conc: [number, number]): void {
  const zones = s.regions.filter((r) => r.kind === 'zone' && r.searchable);
  const tz = rng.weighted(zones, zones.map((z) => 0.4 + Math.hypot(z.cx - s.staging.x, z.cy - s.staging.y) / 12));
  const ti = freeTileIn(s, tz, rng);
  addCas(s, ti % s.w, (ti / s.w) | 0, 'mobile', rng.range(health[0], health[1]), rng.range(0.02, 0.05), rng.range(conc[0], conc[1]), { isTarget: true, wander: true, wanderT: sim.t + 10 });
  const accurate = rng.chance(sim.tune.witnessAcc);
  const others = zones.filter((z) => z.id !== tz.id);
  addProp(s, 'witness', s.safe.x + 1, s.safe.y, { lastSeenRegion: accurate || !others.length ? tz.id : rng.pick(others).id, accurate, interviewed: false });
  s.leadDept = 'police';
}
// 치매 노인: 도심의 틀 · 대상 1(걷는다 — 체력 70~90 · 은폐 0.3~0.5) · 보호자(가족)
registerScene('welfare', 'dementia', (sim, I, rng) => {
  const s = urbanFrame(sim, I, rng, ['골목', '주차장', '시장길', '작은 공원 앞']);
  placeWanderer(sim, s, rng, [70, 90], [0.3, 0.5]);
  return s;
});
// 미아: 도심의 틀(공원·시장·매장 앞) · 아이 1(걷는다 — 체력 100 · 은폐 0.4) · 보호자 · 시민이 안내 데스크로 데려오는 시각(생성 + 한계 − 40 — §5.13)
registerScene('welfare', 'lostchild', (sim, I, rng) => {
  const s = urbanFrame(sim, I, rng, ['놀이터 쪽', '매장 앞', '큰길 쪽 통로', '뒤쪽 산책로']);
  placeWanderer(sim, s, rng, [100, 100], [0.4, 0.4]);
  s.kinds!.backAt = I.createdAt + TYPE_DEFS.welfare.limit - 40;
  s.kinds!.outCount = 0;
  return s;
});
