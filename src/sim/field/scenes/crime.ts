// 강력 범죄의 현장 (docs/specs/N4b-crime.md)
// registerScene('유형', '변형', (sim, I, rng) => Scene) 으로 등록한다. 만드는 도구는 ../kit, ../plans, ../builders 에서 가져온다.

import { KIND_SCENE } from '../../cityPlan';
import type { Sim } from '../../engine';
import { emit } from '../../events';
import type { Rng } from '../../rng';
import { T } from '../../types';
import type { Incident, Region, Scene } from '../../types';
import { armedVenue, floorMatOf, pickArch, planOpts } from '../builders';
import type { VenueKind } from '../builders';
import { staticPass, tidx } from '../grid';
import { SW, addCas, addHostile, addProp, baseScene, freeTileIn, get, set } from '../kit';
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
 * 총을 든 용의자 2~3명이 인질 4~6명을 방 둘에 나눠 붙잡고 있다: 안쪽 방에 한 명, 넓은 곳에 나머지.
 * 용의자마다 인질을 한 사람씩 곁에 붙들고 있고(hostageId), 남은 인질도 같은 방에 있다.
 * 지휘 규칙은 기존의 인질 사건과 같다 (협상 → 섬광탄을 가진 기동대 → 동시 진입).
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
  const freeIn = (r: Region): number => r.tiles.filter((i) => s.tiles[i] === T.FLOOR && s.propAt[i] < 0).length;
  const inner = freeIn(V.office) >= 5 ? 2 : 1;      // 안쪽 방이 좁으면 인질은 한 사람만
  const taken = (q: number): boolean => s.hostiles.some((h) => tidx(s, h.x, h.y) === q);
  const near = (h: { x: number; y: number }, d: number) => (q: number): boolean => taken(q) || Math.hypot((q % SW) - h.x, ((q / SW) | 0) - h.y) > d;
  /** 한 방에 용의자 guns 명과 인질 hostages 명을 놓는다. 인질은 용의자 곁(붙들린 사람은 바로 옆)에 둔다 */
  const group = (room: Region, guns: number, hostages: number, back: boolean): void => {
    const hs = [];
    for (let k = 0; k < guns; k++) {
      // 넓은 곳에서는 정문에서 떨어진 안쪽에 선다
      const i = freeTileIn(s, room, rng, (q) => taken(q) || (back && ((q / SW) | 0) > 8));
      const h = addHostile(s, i % SW, (i / SW) | 0, 'gun', ag(rng.range(0.5, 0.75) - k * 0.06), sk(rng.range(0.4, 0.65)), false, Infinity);
      h.facing = Math.PI / 2; h.deadline = deadline + (s.hostiles.length - 1) * rng.range(12, 26);
      hs.push(h);
    }
    for (let k = 0; k < hostages; k++) {
      const h = hs[k % hs.length], held = k < hs.length;
      const j = freeTileIn(s, room, rng, near(h, held ? 1.6 : 2.6));
      const c = addCas(s, j % SW, (j / SW) | 0, 'mobile', rng.range(85, 100), 0, 0.05, { hostage: true });
      if (held) h.hostageId = c.id;
    }
  };
  group(V.office, 1, inner, false);
  group(V.main, nG - 1, Math.max(nG - 1, nH - inner), true);
  s.leadDept = 'police';
  return s;
}
registerScene('armed', 'siege', buildSiege);
