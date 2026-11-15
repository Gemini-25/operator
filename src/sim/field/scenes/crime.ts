// 강력 범죄의 현장 (docs/specs/N4b-crime.md)
// registerScene('유형', '변형', (sim, I, rng) => Scene) 으로 등록한다. 만드는 도구는 ../kit, ../plans, ../builders 에서 가져온다.

import { KIND_SCENE } from '../../cityPlan';
import type { Sim } from '../../engine';
import { emit } from '../../events';
import type { Rng } from '../../rng';
import { T } from '../../types';
import type { Incident, Region, Scene } from '../../types';
import { armedVenue, buildFire, buildStop, floorMatOf, pickArch, planOpts } from '../builders';
import type { VenueKind } from '../builders';
import { staticPass, tidx } from '../grid';
import { SW, addCas, addHostile, addProp, addRegion, baseScene, freeTileIn, get, set } from '../kit';
import { planBuilding } from '../plans';
import { registerScene } from '../sceneRegistry';

const ORTHO = [1, -1, SW, -SW];
const AROUND = [1, -1, SW, -SW, SW + 1, SW - 1, -SW + 1, -SW - 1];

/** 대기 지점에서 걸어서 닿지 못하는 실내 바닥 칸의 수. blocked 칸은 막힌 것으로 본다 (소품을 놓기 전에 길이 끊기는지 미리 본다). */
function cutOff(s: Scene, blocked: number): number {
  const open = (i: number): boolean => i !== blocked && staticPass(s.tiles[i]) && (s.propAt[i] < 0 || s.props[s.propAt[i]].kind === 'door');
  const seen = new Uint8Array(s.w * s.h), st = [tidx(s, s.staging.x, s.staging.y)];
  seen[st[0]] = 1;
  while (st.length) {
    const c = st.pop()!, x = c % s.w, y = (c / s.w) | 0;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, ny = y + dy; if (nx < 0 || ny < 0 || nx >= s.w || ny >= s.h) continue; const j = ny * s.w + nx; if (!seen[j] && open(j)) { seen[j] = 1; st.push(j); } }
    const sl = s.stairTo[c]; if (sl >= 0 && !seen[sl] && open(sl)) { seen[sl] = 1; st.push(sl); }
  }
  let n = 0;
  for (let i = 0; i < s.tiles.length; i++) if (!seen[i] && i !== blocked && (s.tiles[i] === T.FLOOR || s.tiles[i] === T.DOOR)) n++;
  return n;
}

/** 소품을 놓아도 되는 빈 바닥인가: 사람·소품·문·계단이 없고, 문 바로 곁도 아니다 */
function clearFloor(s: Scene, i: number): boolean {
  if (s.tiles[i] !== T.FLOOR || s.propAt[i] >= 0 || s.stairTo[i] >= 0) return false;
  if (AROUND.some((d) => s.tiles[i + d] === T.DOOR || s.stairTo[i + d] >= 0)) return false;
  return !s.casualties.some((c) => tidx(s, Math.round(c.x), Math.round(c.y)) === i);
}

// ───────────────────────── 폭발물: 진짜 장치 · 협박 전화 · 수상한 물건 ─────────────────────────
/**
 * 사람들이 평소처럼 있는 건물. 불도 용의자도 없다.
 *   bomb        방 안의 가구 옆에 진짜 장치가 숨겨져 있다 (정해진 시각에 터진다)
 *   bombthreat  장치가 없다 (협박 전화뿐)
 *   package     홀·복도의 벽 옆에 눈에 띄는 물건이 놓여 있고, 그중 35% 만 진짜다
 */
function buildBombScene(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  const sev = I.truth.severity, dist = I.truth.district, pk = I.truth.placeKind, v = I.truth.variant;
  const P = planBuilding(s, rng, pickArch(rng, dist, pk), planOpts(dist, pk));
  s.floorMat = floorMatOf(dist);
  if (pk === 'bank') {
    // 은행에서 난 사건의 현장에는 은행 로비가 있다: 홀이 있으면 홀, 없으면 복도나 정문으로 들어서는 방이 로비다
    const fd = P.exitDoors[0], rg = s.region[tidx(s, fd.x, fd.y)];
    const lobby = P.hall ?? P.corridors[0] ?? (rg >= 0 ? s.regions[rg] : P.rooms[0]);
    lobby.name = '은행 로비';
  }
  // 출입구마다 통제 위치: 문에서 두 칸 떨어진 바깥 (장치가 확인되면 경찰이 여기서 출입을 막는다)
  s.spots = s.exits.map((e, k) => {
    const d = P.exitDoors[k], dx = e.x - d.x, dy = e.y - d.y;
    const x = Math.max(0, Math.min(SW - 1, e.x + dx * 2)), y = Math.max(0, Math.min(16, e.y + dy * 2));
    const ok = staticPass(get(s, x, y));
    return { x: ok ? x : e.x, y: ok ? y : e.y, exit: k, taken: -1 };
  });
  // 안에 있던 사람들: 다치지 않았고, 대원이 발견해 안내하면 스스로 걸어 나온다
  const places: Region[] = [...P.rooms, ...P.corridors];
  const nCiv = rng.int(4, 9);
  for (let k = 0; k < nCiv; k++) {
    const r = rng.chance(0.8) ? rng.pick(P.rooms) : rng.pick(places);
    const i = freeTileIn(s, r, rng, (q) => s.tiles[q + 1] === T.DOOR || s.tiles[q - 1] === T.DOOR || s.tiles[q + SW] === T.DOOR || s.tiles[q - SW] === T.DOOR);
    addCas(s, i % SW, (i / SW) | 0, 'mobile', 100, 0, 0.1);
  }
  s.leadDept = 'police';
  if (v === 'bombthreat') {
    emit(sim, { inc: I.id, truth: true, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 1, text: '협박 전화일 뿐, 건물 안에 폭발물은 없습니다.' });
    return s;
  }
  // 장치를 놓을 자리. 소품은 길을 막으므로, 놓은 뒤에도 모든 바닥에 걸어서 닿는 자리만 쓴다
  const base = cutOff(s, -1);
  // 방 한가운데는 비워 둔다: 수색하는 대원이 서는 자리다 (거기를 막으면 그 방의 수색이 끝나지 않는다)
  const off = (i: number): number => { const r = s.regions[s.region[i]]; return r ? Math.hypot((i % SW) - r.cx, ((i / SW) | 0) - r.cy) : 9; };
  const fits = (i: number): boolean => clearFloor(s, i) && off(i) >= 1.2 && ORTHO.some((d) => s.tiles[i + d] === T.FLOOR && s.propAt[i + d] < 0) && cutOff(s, i) <= base;
  let cands: number[] = [];
  if (v === 'bomb') {
    // 방 안, 가구 옆의 빈 바닥 (가구에 둘러싸인 구석은 처리반이 닿지 못하므로 쓰지 않는다).
    // 숨겨져 있어 세 칸 안에서 봐야 알아보므로, 수색하는 대원이 지나는 방 가운데에서 너무 멀지 않은 자리를 먼저 찾는다
    const small = rng.shuffle(P.rooms.filter((r) => r !== P.hall));
    for (const r of small) { cands = r.tiles.filter((i) => off(i) <= 2.6 && ORTHO.some((d) => s.tiles[i + d] === T.FURN) && fits(i)); if (cands.length) break; }
    if (!cands.length) for (const r of small) { cands = r.tiles.filter((i) => ORTHO.some((d) => s.tiles[i + d] === T.FURN) && fits(i)); if (cands.length) break; }
  } else {
    // 홀·복도의 벽 옆. 복도도 홀도 없는 건물이면 정문으로 들어서는 방의 벽 옆.
    // 눈에 띄는 곳에 놓인 물건이므로 드나드는 문에서 가까운 자리를 고른다 (들어서는 대원이 곧 알아본다)
    const open: Region[] = [...P.corridors, ...(P.hall ? [P.hall] : [])];
    if (!open.length) { const fd = P.exitDoors[0], rg = s.region[tidx(s, fd.x, fd.y)]; if (rg >= 0) open.push(s.regions[rg]); }
    const all: number[] = [];
    for (const r of open) all.push(...r.tiles.filter((i) => ORTHO.some((d) => s.tiles[i + d] === T.WALL || s.tiles[i + d] === T.WINDOW) && fits(i)));
    const toStaging = P.exitDoors.map((d) => Math.hypot(d.x - s.staging.x, d.y - s.staging.y)), main = toStaging.indexOf(Math.min(...toStaging));      // 대원들이 주로 드나들 문 (대기 지점에서 가까운 쪽)
    const fromDoor = (i: number): number => Math.min(...P.exitDoors.map((d, k) => Math.hypot((i % SW) - d.x, ((i / SW) | 0) - d.y) + (k === main ? 0 : 2)));
    all.sort((a, b) => fromDoor(a) - fromDoor(b) || a - b);
    cands = all.filter((i) => fromDoor(i) <= 2.9);
    if (!cands.length) cands = all.slice(0, 3);
  }
  if (!cands.length) for (const r of P.rooms) cands.push(...r.tiles.filter(fits));
  const real = v === 'bomb' || rng.chance(0.35);
  const fuse = sim.t + (v === 'bomb' ? rng.range(230, 340) : rng.range(260, 380)) - (sev >= 3 ? 30 : 0);
  const skin = rng.chance(0.5) ? 'bombBag' : 'bombBox';
  if (!cands.length) {      // 놓을 자리가 없는 건물 (거의 없다): 장치 없이 협박으로만 끝난다
    emit(sim, { inc: I.id, truth: true, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 1, text: '건물 안에 폭발물은 없습니다.' });
    return s;
  }
  const at = rng.pick(cands);
  addProp(s, 'bomb', at % SW, (at / SW) | 0, real ? { blocking: true, real: true, fuse, skin, hp: 0 } : { blocking: true, real: false, skin, hp: 0 });
  const where = s.region[at] >= 0 ? s.regions[s.region[at]].name : '건물 안';
  emit(sim, { inc: I.id, truth: true, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 1, text: real ? `${where}의 장치는 ${Math.round(fuse - sim.t)}초 뒤에 터지도록 맞춰져 있습니다.` : `${where}에 놓인 물건은 폭발물이 아닙니다 (확인하기 전에는 아무도 모릅니다).` });
  return s;
}
registerScene('armed', 'bomb', buildBombScene);
registerScene('armed', 'bombthreat', buildBombScene);
registerScene('armed', 'package', buildBombScene);

// ───────────────────────── 대형 인질극 ─────────────────────────
/**
 * 총을 든 용의자 2~3명이 인질 4~6명을 두 곳에 나눠 붙잡고 있다: 넓은 홀에 한 무리, 문을 닫은 안쪽 방에 한 무리.
 * 용의자마다 인질을 한 사람씩 곁에 붙들고 있고(hostageId), 남은 인질도 그 곁에 있다.
 * 홀의 무리는 밖에서 보이므로 도착한 경찰은 섣불리 들어가지 않고 봉쇄·협상부터 한다. 건물에 진입한 뒤에도
 * 안쪽 방은 따로 문 앞에 모였다가 들어가야 한다. 지휘 규칙은 기존의 인질 사건 그대로다 (협상 → 섬광탄을 가진 기동대 → 동시 진입 → 방 진입).
 */
function buildSiege(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  const dist = I.truth.district, tn = sim.tune;
  for (let y = 16; y <= 18; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.ROAD);
  const ks = I.truth.placeKind ? KIND_SCENE[I.truth.placeKind] : undefined;
  const V = armedVenue(s, rng, ks && ks.venue ? ks.venue : rng.weighted<VenueKind>(['bank', 'office', 'shop'], [0.4, 0.35, 0.25]), dist);
  const ag = (v: number): number => Math.max(0.05, Math.min(0.98, v + tn.aggroShift));
  const sk = (v: number): number => Math.max(0.1, Math.min(0.95, v + tn.skillShift));
  const nG = rng.chance(Math.min(0.9, 0.35 + tn.extraSuspectProb)) ? 3 : 2;
  const nH = rng.int(4, 6);
  const deadline = sim.t + rng.range(225, 330) + tn.fleeShift * 2;      // 여럿을 붙잡고 있어 요구를 내걸고 버티는 시간이 길다
  // 안쪽 방: 후문이 바로 닿지 않는 방 (은행은 금고, 그 밖에는 사무실). 건물 안으로 들어와야만 문 앞에 설 수 있다
  const rearRoom = s.region[tidx(s, V.rear, 3)];
  const inner = V.office.id !== rearRoom ? V.office : V.back;
  // 안쪽 방에 들일 수 있는 인질 수: 용의자가 설 자리와 빈 칸 하나를 남긴다
  const nA = Math.min(2, Math.max(1, inner.tiles.filter((i) => s.tiles[i] === T.FLOOR && s.propAt[i] < 0).length - 2));
  const taken = (q: number): boolean => s.hostiles.some((h) => tidx(s, h.x, h.y) === q);
  const empty = (q: number): boolean => s.tiles[q] === T.FLOOR && s.propAt[q] < 0 && !taken(q) && !s.casualties.some((c) => tidx(s, Math.round(c.x), Math.round(c.y)) === q);
  /**
   * 용의자 곁의 빈 바닥 한 칸: 반경 d 안에서 고르고, 없으면 그 방에서 가장 가까운 빈 칸.
   * (넓은 홀에서 아무 칸이나 뽑아 보는 freeTileIn 으로는 곁의 몇 칸을 못 맞히는 일이 있어, 붙들린 인질이 방 반대편에 놓였다)
   */
  const beside = (r: Region, h: { x: number; y: number }, d: number): number => {
    const off = (q: number): number => Math.hypot((q % SW) - h.x, ((q / SW) | 0) - h.y);
    const free = r.tiles.filter(empty), close = free.filter((q) => off(q) <= d);
    if (close.length) return rng.pick(close);
    return free.length ? free.reduce((a, b) => (off(b) < off(a) ? b : a)) : r.tiles[0];
  };
  /** 한 곳에 용의자 guns 명과 인질 hostages 명을 놓는다. 인질은 용의자 곁(붙들린 사람은 바로 옆)에 둔다 */
  const group = (r: Region, guns: number, hostages: number, hall: boolean): void => {
    const hs = [];
    for (let k = 0; k < guns; k++) {
      // 홀에서는 정문에서 떨어진 안쪽에 선다. 붙들 인질이 설 빈 칸이 바로 곁에 있는 자리여야 한다
      const i = freeTileIn(s, r, rng, (q) => taken(q) || (hall && ((q / SW) | 0) > 8) || !AROUND.some((d) => empty(q + d) && s.region[q + d] === r.id));
      const h = addHostile(s, i % SW, (i / SW) | 0, 'gun', ag(rng.range(0.5, 0.75) - k * 0.06), sk(rng.range(0.4, 0.65)), false, Infinity);
      h.facing = Math.PI / 2; h.deadline = deadline + (s.hostiles.length - 1) * rng.range(12, 26);
      h.retreated = true;      // 자리를 지킨다: 진입이 시작돼도 인질을 끌고 다른 방으로 옮기지 않는다 (옮기면 안쪽 방의 문이 열려 버린다)
      hs.push(h);
    }
    for (let k = 0; k < hostages; k++) {
      const h = hs[k % hs.length], held = k < hs.length;
      const j = beside(r, h, held ? 1.6 : 2.6);
      const c = addCas(s, j % SW, (j / SW) | 0, 'mobile', rng.range(85, 100), 0, 0.05, { hostage: true });
      if (held) h.hostageId = c.id;
    }
  };
  group(inner, 1, nA, false);
  group(V.main, nG - 1, nH - nA, true);
  s.leadDept = 'police';
  return s;
}
registerScene('armed', 'siege', buildSiege);

// ───────────────────────── 도주 차량 ─────────────────────────
// 추격 끝에 선 차의 현장은 납치·난폭 운전과 같은 틀(builders.buildStop)이다: 총을 든 용의자 1~2명이 차 옆에서 버틴다
registerScene('armed', 'getaway', buildStop);

// ───────────────────────── 폭동 (집단 난동) ─────────────────────────
/**
 * 넓은 홀에서 여럿이 부수고 싸운다. 흉기를 든 주동자 둘과, 맨손으로 휩쓸린 나머지(경찰이 말을 걸면 곧 손을 든다).
 * 다친 시민 2~4명이 쓰러져 있고, 뒷방의 가구 한두 칸에 불이 붙어 있다.
 * 지휘 규칙은 기존 그대로다 (출입구 봉쇄 · 협상 · 검거). 용의자가 많아 말을 걸 자리를 넉넉히 둔다.
 */
function buildRiot(sim: Sim, I: Incident, rng: Rng): Scene {
  const s = baseScene(sim, I, rng);
  const dist = I.truth.district, sev = I.truth.severity, tn = sim.tune;
  for (let y = 16; y <= 18; y++) for (let x = 0; x < SW; x++) set(s, x, y, T.ROAD);
  const V = armedVenue(s, rng, rng.chance(0.5) ? 'warehouse' : 'shop', dist);
  const ag = (v: number): number => Math.max(0.05, Math.min(0.98, v + tn.aggroShift));
  const taken = (q: number): boolean => s.hostiles.some((h) => tidx(s, h.x, h.y) === q);
  // 흉기를 든 주동자 한 사람은 홀의 동쪽 끝에 버티고 서 있고, 다른 한 사람은 무리 속에 섞여 있다. 나머지와 다친 사람들은 서쪽에 있다
  // (무리 속의 주동자 곁을 지나는 대원은 다칠 수 있다. 둘 다 무리 속에 두면 대원이 줄줄이 다친다)
  const spot = (side: number): number => freeTileIn(s, V.main, rng, (q) => taken(q) || (side > 0 && q % SW < 18) || (side < 0 && q % SW > 15));
  const n = rng.int(5, 7) + (sev >= 3 ? 1 : 0);
  for (let k = 0; k < n; k++) {
    const lead = k < 2, i = spot(k === 0 ? 1 : -1);
    const h = addHostile(s, i % SW, (i / SW) | 0, lead ? 'knife' : 'none', ag(lead ? rng.range(0.6, 0.8) : rng.range(0.15, 0.35)), 0.3, false, Infinity);
    h.label = lead ? `주동자 ${k + 1}` : `가담자 ${k - 1}`;
    h.facing = rng.range(0, Math.PI * 2);
    // 주동자는 드세지만 한패가 무너지면 오래 버티지 못하고(rules/crime.ts), 휩쓸린 사람들은 경찰이 여럿 보이거나 말을 걸면 곧 손을 든다
    h.morale = lead ? rng.range(0.66, 0.82) : rng.range(0.3, 0.42);
  }
  // 싸움에 휘말려 다친 시민
  const nW = rng.int(2, 3) + (sev >= 3 && rng.chance(0.6) ? 1 : 0);
  for (let k = 0; k < nW; k++) { const i = spot(-1); addCas(s, i % SW, (i / SW) | 0, 'immobile', rng.range(48, 74), rng.range(0.08, 0.16), 0.1); }
  // 누군가 불을 붙였다: 뒷방(없으면 홀)의 가구 한두 칸. 둘레에 탈 것이 없어 크게 번지지는 않는다
  const furn = (r: Region): number[] => r.tiles.filter((i) => s.tiles[i] === T.FURN);
  const pool = furn(V.back).length ? furn(V.back) : furn(V.main);
  const nF = Math.min(pool.length, rng.int(1, 2));
  for (let k = 0; k < nF; k++) { const i = pool.splice(rng.int(0, pool.length - 1), 1)[0]; s.fuel[i] = 0.9; s.fire[i] = rng.range(0.3, 0.42); }
  // 말을 걸 자리: 정문 앞에 여럿이 설 수 있게 (기본은 한 자리뿐이라 용의자가 많으면 모자란다)
  for (const [dx, dy] of [[-6, 14], [-3, 14], [-2, 15], [3, 15], [4, 14], [7, 14]]) {
    const x = V.front + dx;
    if (x >= 1 && x < SW - 1 && staticPass(get(s, x, dy)) && s.propAt[tidx(s, x, dy)] < 0 && !s.spots.some((q) => q.x === x && q.y === dy)) s.spots.push({ x, y: dy, exit: -1, taken: -1 });
  }
  s.leadDept = 'police';
  return s;
}
registerScene('armed', 'riot', buildRiot);

// ───────────────────────── 연쇄 방화 ─────────────────────────
// 현장은 여느 건물 화재와 같다. 불을 지르고 달아나는 것을 본 사람이 건물 밖에서 기다린다:
// 대원이 이야기를 들으면(면담) 방화범이 잡힐 수 있고, 못 들으면 가까운 곳에서 불이 또 난다 (scenarios/crime.ts 의 onClose)
registerScene('fire', 'arson', (sim, I, rng) => {
  const s = buildFire(sim, I, rng);
  const alley = addRegion(s, '골목', 'verge', 21, 14, 26, 15, false, false);      // 방화범이 달아난 쪽 (목격자의 진술에 나온다)
  const at = [[6, 15], [7, 15], [8, 15], [5, 15], [9, 15], [1, 15]].find(([x, y]) => get(s, x, y) === T.GROUND && s.propAt[tidx(s, x, y)] < 0 && !(x === s.safe.x && y === s.safe.y));
  if (at) addProp(s, 'witness', at[0], at[1], { lastSeenRegion: alley.id, accurate: true, interviewed: false });
  return s;
});
