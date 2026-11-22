// 사건 종류 다양화 ① 일상 사건의 현장 (docs/specs/N8-incident-kinds.md §4) — 진실을 만든다.
// registerScene('유형', '변형', (sim, I, rng) => Scene). 만드는 도구는 ../kindsKit(buildQuiet·streetFrame), ../builders, ../kit.
//
// 단계 3: 비응급 N1 장난 전화 셋(빈 현장) · N2 오인 신고 넷(§4.8 — 가서 확인하면 "이상 없음"의 답이 현장에 있다).
import { T } from '../../types';
import { addCas, addProp, addRegion, set } from '../kit';
import { buildQuiet, streetFrame } from '../kindsKit';
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
