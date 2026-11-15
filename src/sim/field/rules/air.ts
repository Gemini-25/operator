// 상공의 헬기 — 세계 규칙 (docs/specs/R1-crews.md 7.3·7.4).
// 현장 상공에 머무는 부대(crews.isHovering — 경찰 헬기, 물·산불 현장의 소방 헬기)는 대원이 내리지 않는다.
// 그 대신 이 규칙이 부대마다 상공 작업(AirOp)을 하나 두고 매 틱 굴린다:
//   연료 → 관측(0.5초마다: 관측자의 perceive 와 보고) → 할 일 고르기(airDecide — 믿음만) → 실행(살피며 돌기·탐조등·호이스트 인양·물 투하) → 떠남
//
// 이 파일은 실행기(executor.ts)와 같은 자격으로 진실을 읽고 바꾼다: 인양할 사람의 실제 자리, 불이 붙은 칸, 탐조등의 숨은 고장.
// 무엇을 할지는 field/airDecide.ts 가 믿음과 작업판만으로 정한다 — 그 선을 넘겨 주는 것이 viewOf 다.
//
// 관측자(AirOp.eye)는 s.agents 에 넣지 않는다: 용의자의 표적, 폭발·연기·불 피해, 지휘권 승계, 부대 철수 판정, 무전 수신에 끼지 않는다.
// sceneManager.ts 를 import 하지 않는다(sceneManager → scenes/index → 이 파일의 순환). resources.ts 의 함수는 함수 안에서만 부른다.

import { coastY, riverDist } from '../../city';
import { LAKE } from '../../cityPlan';
import { fieldCrew, isHovering, kitWorks, seatsOf, seatsUsed } from '../../crews';
import type { Sim } from '../../engine';
import { emit } from '../../events';
import { closeIncident } from '../../incidents';      // 함수 안에서만 부른다 (incidents → sceneManager → scenes/index → 이 파일의 순환)
import { airRtb, etaFor, releaseUnit, startTransport } from '../../resources';
import type { AirOp, CasBelief, Fact, FieldAgent, Incident, Needs, Scene, Unit, WorkItem } from '../../types';
import { josa } from '../../util';
import { briefFacts, casFact, flushOutbox, learn, learnQuiet, makeAgent, perceive, transmit } from '../agents';
import { WATCH_SPEED, airDecide, nearestLeg } from '../airDecide';
import { outstanding } from '../commander';
import type { AirTerrain, AirView } from '../airDecide';
import { BeliefStore, mkFact } from '../beliefs';
import { isIndoor } from '../grid';
import { applyWater, placeAtSafe, pushFx } from '../hazards';
import { registerRule } from '../sceneRegistry';

/** 균형 상수 */
export const AIR = {
  observe: 0.5,        // 관측·판단 간격(초)
  workSpeed: 3,        // 인양할 사람·물을 뿌릴 자리로 갈 때의 속도(칸/초)
  reach: 0.8,          // 이 안에 들면 대상 위에 있다(칸)
  hoist: 18,           // 호이스트 인양에 걸리는 기본 시간(초) — ÷ (0.6 + 0.4 × 내리는 구조대원의 숙련), 밤 ×1.4 · 비 ×1.2 · 강풍 ×1.5
  idle: 45,            // 할 일이 없는 채 이만큼 지나면 복귀한다(초). 경찰 헬기는 idlePolice
  idlePolice: 30,
  lightR: 4.5,         // 탐조등이 비추는 원의 반지름(칸)
  dropLen: 6, dropWide: 2, dropAmount: 0.9,      // 물 투하: 길이 6칸·폭 2칸의 띠, 칸마다 뿌리는 양
  ferry: 66,           // 물을 뜨러 오가는 속도(지도 단위/초 — resources.ts 의 헬기 속도와 같다)
  fill: 12,            // 물을 뜨는 데 걸리는 시간(초)
  bucketBurn: 1.25,    // 바구니 작업 중의 연료 소모 배율
  rtbMargin: 40,       // 집까지 가는 시간에 이만큼을 더한 연료가 남았을 때 돌아간다(초) — resources.tickUnits 의 출동 중 검사와 같다
};

/** AirOp 하나에 딸린 실행 상태 (객체의 모양을 바꾸지 않으려고 따로 둔다. 되감기는 Sim 을 새로 만들어 다시 돌리므로 안전하다) */
interface AirState {
  leg: number;                 // 훑기의 몇째 구간인가
  missed: Map<string, Fact>;   // 현장에 들을 사람이 아무도 없을 때 알린 것 (지상 부대가 닿으면 그 지휘관에게 한 번 넘긴다)
  lit: 0 | 1 | 2;              // 탐조등: 0 아직 켜 보지 않음 · 1 켜짐 · 2 없거나 고장
  tx: number; ty: number; sweep: boolean;      // 살피며 가는 자리 (airDecide 가 정한다)
  terrain: AirTerrain;         // airDecide 에 넘기는 지형 (현장 객체를 통째로 넘기지 않는다)
  dropAt: number;              // 물을 떨어뜨릴 칸 (-1 = 아직 정하지 않음)
  fromX: number; fromY: number;                // 그 칸을 정했을 때 헬기가 있던 자리 (날아온 방향으로 띠를 놓는다)
}
const STATE = new WeakMap<AirOp, AirState>();

const liveWork = (w: WorkItem | undefined): boolean => !!w && (w.status === 'open' || w.status === 'active');
const activeCmd = (s: Scene): FieldAgent | null => { for (const a of s.agents) if (a.rid === s.commanderRid && a.status === 'active') return a; return null; };

function makeOp(sim: Sim, s: Scene, I: Incident, u: Unit): AirOp {
  // 관측자: 경찰 헬기는 전술 관측관, 그 밖(소방 헬기)은 내리는 자리의 첫 사람(다쳐 있으면 다음 사람)
  const fc = fieldCrew(sim, u);
  let rid = fc[0];
  for (const q of fc) if (sim.responders[q].status === 'ok') { rid = q; break; }
  for (const q of u.crew) if (sim.responders[q].role === 'observer') { rid = q; break; }
  const x = Math.max(0, Math.min(s.w - 1, s.staging.x)), y = Math.max(0, Math.min(s.h - 1, s.staging.y));
  const eye = makeAgent(sim, rid, u.id, x, y, sim.t, sim.rng.fork('air:' + I.id + ':' + u.id));
  eye.aloft = true; eye.label = '상공 관측';
  for (const f of briefFacts(sim, I)) eye.beliefs.merge(f);      // 지상 대원처럼 관제의 브리핑을 받고 온다
  const op: AirOp = { unitId: u.id, mode: 'watch', x, y, px: x, py: y, phase: 'hover', target: -1, workId: -1, progress: 0, need: 0, backAt: -1, idleSince: -1, eye };
  const terrain: AirTerrain = { w: s.w, h: s.h, tiles: s.tiles, region: s.region, regions: s.regions };
  STATE.set(op, { leg: nearestLeg(terrain, s.kind, x, y), missed: new Map(), lit: 0, tx: x, ty: y, sweep: false, terrain, dropAt: -1, fromX: x, fromY: y });
  return op;
}

/** airDecide 에 넘기는 좁힌 입력: 믿음(관측자·지휘관)·작업판·지형·자기 부대의 장비 — 진실은 넣지 않는다 */
function viewOf(sim: Sim, s: Scene, I: Incident, op: AirOp, u: Unit, st: AirState): AirView {
  const others: AirOp[] = [];
  for (const o of s.air!) if (o !== op) others.push(o);
  let incoming = false;
  for (const uid of I.assigned) { const q = sim.units[uid]; if (uid !== u.id && (q.state === 'enroute' || q.state === 'turnout')) { incoming = true; break; } }
  return {
    op, eye: op.eye, board: s.board, cmd: activeCmd(s), terrain: st.terrain, kind: s.kind, night: sim.weather === 'night', others, incoming,
    hoist: u.hoist === true, bucket: (u.bucketMax ?? 0) > 0, leg: st.leg,
  };
}

/**
 * 관측자도 현장의 무전을 듣는다: 이번 틱에 전해질 '현장 전체' 무전의 내용을 믿음에 합친다.
 * 관측자는 s.agents 밖이라 sceneManager 의 무전 전달이 닿지 않는다 — 듣지 못하면 다른 헬기가 건져 간 사람을 아직 물속에 있다고 믿는다.
 * (이 규칙은 그 틱의 무전 전달보다 먼저 돌고, 전달된 무전은 그 틱에 대기열에서 빠지므로 한 번씩만 듣는다. 상공에는 무전 음영이 없다)
 */
function listen(sim: Sim, s: Scene, air: AirOp[]): void {
  const radio = s.radio;
  for (let k = 0; k < radio.length; k++) {
    const m = radio[k];
    if (m.deliverAt > sim.t || m.to !== -1 || !m.facts.length) continue;
    for (let j = 0; j < air.length; j++) {
      const op = air[j];
      if (op.eye.rid === m.from || op.phase === 'away') continue;
      for (const f of m.facts) op.eye.beliefs.merge(BeliefStore.relay(f));
    }
  }
}

/**
 * 관측자의 보고를 내보낸다 (flushOutbox — 현장 전체로). 그때 현장에 들을 대원이 아무도 없었으면 그 내용을 적어 둔다:
 * 무전은 듣는 사람이 있어야 전해진다. 지상 부대가 닿으면 그 지휘관에게 한 번 넘긴다 (handOver)
 */
function report(sim: Sim, s: Scene, op: AirOp, st: AirState): void {
  const eye = op.eye;
  if (!eye.outbox.length) { flushOutbox(sim, s, eye); return; }
  let heard = false;
  for (const a of s.agents) if (a.status === 'active') { heard = true; break; }
  const pending = heard ? null : eye.outbox.slice();
  flushOutbox(sim, s, eye);
  if (pending && !eye.outbox.length) for (const f of pending) st.missed.set(f.key, f);
}
/** 아무도 듣지 못한 관측 내용을 지휘관에게 넘긴다 — 실제로 보내는 무전이라 기록이 한 줄 남는다 */
function handOver(sim: Sim, s: Scene, op: AirOp, st: AirState, u: Unit, cmd: FieldAgent): void {
  const facts: Fact[] = [];
  for (const f of st.missed.values()) { const cur = op.eye.beliefs.get(f.type, f.id); if (cur) facts.push(cur); }      // 지금 알고 있는 내용으로
  st.missed.clear();
  if (facts.length) transmit(sim, s, op.eye, cmd.rid, 'report', facts, `${u.callsign}: 상공 관측 내용을 전달합니다.`, -1, 0);
}

/**
 * 헬기만 왔던 현장을 그 헬기의 보고로 끝낼 수 있는가 — 관측자의 믿음과 지형만 본다:
 *  지상 부대가 한 번도 닿지 않았고(닿았던 현장은 마지막 지휘관의 믿음으로 끝낸다 — sceneManager 7)번),
 *  지붕 밑이 없어 하늘에서 현장을 다 내려다볼 수 있었고, 확인한 사람이 한 명 이상(신고된 인원을 알면 그 수 이상)이며,
 *  그 사람이 모두 실려 갔다(탑승·병원). 현장에 남은 사람이 하나라도 있으면 — 걸어 다니든, 안전 구역에 있든, 숨졌든 — 아니다
 *  (하늘에서는 안내도 처치도 수습도 못 한다. 그런 현장은 지금처럼 방치 시간 뒤에 닫힌다)
 */
function allAboard(s: Scene, eye: FieldAgent): boolean {
  if (s.arrivedAt >= 0) return false;
  for (const reg of s.regions) if (reg.indoor) return false;
  const cas = eye.beliefs.list('cas');
  if (!cas.length) return false;
  for (const f of cas) { const c = f.value as CasBelief; if (c.where !== 'loaded' && c.where !== 'hospital') return false; }
  const occ = eye.beliefs.val<{ count: number | null }>('occ', 0);      // 관제의 브리핑: 신고자가 말한 인원 (없을 수 있다)
  return !(occ && occ.count !== null && cas.length < occ.count);
}

/**
 * 마지막으로 현장을 떠나는 헬기가 관제에 알린다: 지상 대원도, 오는 부대도, 다른 헬기도 없는데 관측자가 보기에 아직 남은 일이 있으면
 * (건지지 못한 사람·불·용의자) 그 수요를 다시 연다. 지상 부대가 닿은 현장은 마지막 지휘관의 믿음으로 같은 일을 한다(sceneManager 7)번) —
 * 헬기만 왔던 현장에는 지휘관이 없으므로 관측자의 믿음으로 한다.
 * 남은 일이 없을 때: 확인한 사람이 모두 실려 간 뒤라면(allAboard) 그 보고로 사건을 끝낸다 — 그러지 않으면 아무도 맡지 않고 대기열에도 없는 사건이
 * 방치 시간(60초) 동안 떠 있다가 '방치'로 닫힌다(측정 도구의 '잊힌 사건'). 그 밖에는 아무것도 하지 않는다(사건은 방치 시간 뒤에 닫힌다)
 */
function tellDispatch(sim: Sim, s: Scene, I: Incident, op: AirOp, u: Unit): void {
  if (I.phase === 'closed' || (s.air !== undefined && s.air.length > 0)) return;
  for (const a of s.agents) if (a.status === 'active') return;
  for (const uid of I.assigned) { const q = sim.units[uid]; if (q.state === 'enroute' || q.state === 'turnout') return; }
  const o = outstanding(op.eye, sim.t, s);      // 대피 중이라던 사람의 소식이 오래 끊겼으면 남은 일로 센다 (H1 §5.2). 쓰러진 채 남은 지상 대원도 남은 일이다 (§3.5)
  if (!(o.patients > 0 || o.fire || o.hostile || o.mates > 0)) {
    if (allAboard(s, op.eye)) {
      emit(sim, { inc: I.id, role: 'UNIT', actor: u.callsign, kind: 'unit', imp: 2, causes: [I.lastEvent], text: `${u.callsign}: 확인한 구조 대상은 모두 실려 갔습니다. 현장에 남은 사람이 없어 상황을 종료합니다.` });
      closeIncident(sim, I, 'resolved');
    }
    return;
  }
  let stuck = false;      // 물속이나 잔해에 갇힌 사람이 남았는가 (구조 장비가 필요하다)
  for (const f of op.eye.beliefs.list('cas')) { const c = f.value as CasBelief; if (c.where === 'scene' && c.mob === 'trapped' && c.band < 3) { stuck = true; break; } }
  const need: keyof Needs = o.hostile ? 'law' : o.fire ? 'suppression' : stuck ? 'rescue' : 'ems';
  I.unmet[need] = Math.max(I.unmet[need] ?? 0, 1); I.unmetSince = sim.t; I.noUnitLogged = false;
  emit(sim, { inc: I.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 2, causes: [I.lastEvent], text: `사건 ${I.code}: ${josa(u.callsign, '이/가')} 떠난 현장에 아직 ${o.hostile ? '용의자가' : o.fire ? '불이' : o.patients > 0 ? '구조 대상이' : '쓰러진 대원이'} 남아 있습니다. 지상 부대를 찾습니다.` });
}

/** (tx, ty) 쪽으로 한 틱 움직인다. 돌려주는 값 = 남은 거리(칸) */
function fly(s: Scene, op: AirOp, tx: number, ty: number, step: number): number {
  tx = Math.max(0, Math.min(s.w - 1, tx)); ty = Math.max(0, Math.min(s.h - 1, ty));
  const dx = tx - op.x, dy = ty - op.y, d = Math.hypot(dx, dy);
  if (d <= step) { op.x = tx; op.y = ty; return 0; }
  op.x += (dx / d) * step; op.y += (dy / d) * step;
  return d - step;
}
/** 작업판의 그 작업을 끝낸다 (스스로 고른 일이면 아무것도 없다) */
function finishWork(sim: Sim, s: Scene, op: AirOp): void {
  const w = op.workId >= 0 ? s.board[op.workId] : undefined;
  if (w && liveWork(w)) { w.status = 'done'; w.doneAt = sim.t; }
}
/** 하던 일을 내려놓고 다음 틱에 다시 살피고 정한다 */
function reset(sim: Sim, op: AirOp, st: AirState): void {
  op.mode = 'watch'; op.target = -1; op.workId = -1; op.progress = 0; op.need = 0; op.phase = 'hover'; st.dropAt = -1;
  op.eye.nextThink = sim.t;
}

/** 가장 가까운 물까지의 거리(지도 단위): 호수 가운데, 강, 바다 가운데 가까운 것 */
function waterDist(u: Unit): number {
  const lake = Math.hypot(u.x - LAKE.x, u.y - LAKE.y);
  const river = Math.max(0, riverDist(u.x, u.y));
  const sea = Math.max(0, coastY(u.x) + 10 - u.y);
  return Math.min(lake, river, sea);
}
/** 그 구역에서 불이 가장 센 바깥 칸 (없으면 -1). 실행기의 분사처럼 실제 불을 보고 겨눈다 */
function hottest(s: Scene, region: number): number {
  let best = -1, bv = 0.05;
  const tiles = s.regions[region].tiles;
  for (let k = 0; k < tiles.length; k++) { const i = tiles[k]; if (s.fire[i] > bv && !isIndoor(s.tiles[i])) { bv = s.fire[i]; best = i; } }
  return best;
}

/** 호이스트 인양을 마쳤다: 지상의 수난 구조와 같은 효과 + 자리가 있으면 바로 싣는다 */
function hoistDone(sim: Sim, s: Scene, I: Incident, op: AirOp, u: Unit): void {
  const c = s.casualties[op.target], eye = op.eye, name = sim.responders[eye.rid].name;
  c.inWater = false; c.drift = 0; c.mob = 'immobile'; c.trapWork = 0; c.tFreed = sim.t;
  c.bleed *= 0.35; c.bleed0 = c.bleed;      // 물 밖으로 나오면 악화가 느려진다 (저체온은 남는다)
  c.bleedCause = 'exposure';      // 남은 악화는 익수가 아니라 실외 노출(저체온)로 적는다 (H1 §2.3 — 지상의 waterRescue 와 같다)
  if (seatsUsed(sim, u) < seatsOf(u)) { c.where = 'loaded'; c.tLoaded = sim.t; c.x = op.x; c.y = op.y; c.px = c.x; c.py = c.y; u.patients.push(c.id); u.patientsIncident = I.id; u.firstLoadAt ??= sim.t; }
  else { c.where = 'safe'; c.tSafe = sim.t; placeAtSafe(s, c); }      // 자리가 없으면 안전 구역에 내려놓는다
  learnQuiet(sim, eye, casFact(sim, s, c, name));
  emit(sim, { inc: I.id, role: 'UNIT', actor: u.callsign, kind: 'recovery', imp: 2, text: `${u.callsign}: 호이스트로 구조 대상 ${c.label} 인양 완료.` });
  sim.airStats.hoists++;
  sim.responders[eye.rid].xpGained += 0.005;
  finishWork(sim, s, op);
}

/** 물 투하: 길이 6칸·폭 2칸의 띠에 물을 쏟는다 (헬기가 날아온 방향으로) */
function dropWater(sim: Sim, s: Scene, I: Incident, op: AirOp, u: Unit, st: AirState): void {
  const cx = st.dropAt % s.w, cy = (st.dropAt / s.w) | 0;
  const horiz = Math.abs(st.fromX - cx) >= Math.abs(st.fromY - cy);
  const a0 = -(AIR.dropLen >> 1), a1 = a0 + AIR.dropLen - 1;
  // 둘째 줄은 불이 더 센 쪽에
  let up = 0, dn = 0;
  for (let a = a0; a <= a1; a++) {
    const x1 = horiz ? cx + a : cx - 1, y1 = horiz ? cy - 1 : cy + a, x2 = horiz ? cx + a : cx + 1, y2 = horiz ? cy + 1 : cy + a;
    if (x1 >= 0 && y1 >= 0 && x1 < s.w && y1 < s.h) up += s.fire[y1 * s.w + x1];
    if (x2 >= 0 && y2 >= 0 && x2 < s.w && y2 < s.h) dn += s.fire[y2 * s.w + x2];
  }
  const side = dn >= up ? 1 : -1;
  for (let a = a0; a <= a1; a++) for (let b = 0; b < AIR.dropWide; b++) {
    const x = horiz ? cx + a : cx + b * side, y = horiz ? cy + b * side : cy + a;
    if (x >= 0 && y >= 0 && x < s.w && y < s.h) applyWater(s, x, y, AIR.dropAmount);
  }
  u.bucket = Math.max(0, (u.bucket ?? 0) - 1);
  // 효과 그림: 띠의 두 끝 (흔들림을 뽑지 않는다 — 현장의 s.rng 는 명중·용의자 행동이 쓰는 흐름이다)
  pushFx(sim, s, 'drop', horiz ? cx + a0 : cx, horiz ? cy : cy + a0, horiz ? cx + a1 : cx, horiz ? cy : cy + a1, undefined, undefined, 1.6);
  emit(sim, { inc: I.id, role: 'UNIT', actor: u.callsign, kind: 'unit', imp: 1, text: `${u.callsign}: ${s.regions[op.target].name}에 물 투하.` });
  sim.airStats.drops++;
  st.dropAt = -1;
  op.eye.nextThink = sim.t;      // 뿌린 자리를 바로 다시 살핀다
}

registerRule((sim, s, I) => {
  const air = s.air;
  if (!air || I.phase === 'closed') return;      // 닫힌 사건의 상공 부대는 sceneManager 의 5)번 블록이 내보내며 AirOp 를 지운다
  // 1) 이 사건 상공에 닿은 부대마다 AirOp 를 하나 둔다
  for (let k = 0; k < I.assigned.length; k++) {
    const u = sim.units[I.assigned[k]];
    if (u.state !== 'onscene' || u.incidentId !== I.id || !isHovering(u, s)) continue;
    let has = false;
    for (let j = 0; j < air.length; j++) if (air[j].unitId === u.id) { has = true; break; }
    if (!has) air.push(makeOp(sim, s, I, u));
  }
  if (!air.length) { if (s.light) s.light = null; return; }
  if (s.radio.length) listen(sim, s, air);
  const night = sim.weather === 'night';
  let lit: AirOp | null = null;
  for (let k = air.length - 1; k >= 0; k--) {
    const op = air[k], u = sim.units[op.unitId], st = STATE.get(op)!, eye = op.eye;
    if (u.state !== 'onscene' || u.incidentId !== I.id) { air.splice(k, 1); continue; }      // 떠난 부대 (강풍 복귀 등)
    op.px = op.x; op.py = op.y;
    // 2) 연료: 상공에서 줄이는 곳은 여기뿐이다 (resources.tickUnits 는 현장에 있는 부대를 건너뛴다)
    u.fuel = Math.max(0, (u.fuel ?? 0) - sim.dt * (op.mode === 'bucket' && op.idleSince < 0 ? AIR.bucketBurn : 1));
    if (u.fuel < etaFor(sim, u, u.homeNode) + AIR.rtbMargin) { report(sim, s, op, st); airRtb(sim, u, 'fuel'); air.splice(k, 1); continue; }
    // 3) 물을 뜨러 간 동안에는 현장에 없다 (지도의 위치는 옮기지 않는다 — 연료 복귀 판정과 복귀 비행의 출발점이 갈리지 않게)
    if (op.phase === 'away') {
      if (sim.t < op.backAt) continue;
      u.bucket = u.bucketMax ?? 0; op.phase = 'hover'; eye.nextThink = sim.t;
    }
    eye.x = op.x; eye.y = op.y; eye.px = op.px; eye.py = op.py;
    // 4) 탐조등: 밤에 처음 켤 때 숨은 고장이 드러난다
    if (night) { if (st.lit === 0) st.lit = kitWorks(sim, eye.rid, 'searchlight', I) ? 1 : 2; if (st.lit === 1) lit = op; }
    // 5) 지상 부대가 닿아 지휘관이 생겼다: 아무도 듣지 못했던 관측 내용을 넘긴다
    if (st.missed.size) { const cmd = activeCmd(s); if (cmd) handOver(sim, s, op, st, u, cmd); }
    // 6) 관측 → 보고 → 할 일 고르기
    if (sim.t >= eye.nextThink) {
      eye.nextThink = sim.t + AIR.observe;
      perceive(sim, s, eye);
      report(sim, s, op, st);
      const plan = airDecide(sim, viewOf(sim, s, I, op, u, st));
      if (plan.mode !== op.mode || plan.target !== op.target) { op.progress = 0; op.need = 0; op.phase = 'hover'; st.dropAt = -1; }
      op.mode = plan.mode; op.target = plan.target; op.workId = plan.workId;
      st.tx = plan.tx; st.ty = plan.ty; st.sweep = plan.sweep;
      if (plan.busy) op.idleSince = -1; else if (op.idleSince < 0) op.idleSince = sim.t;
    }
    // 7) 할 일이 없는 채 오래 떠 있으면 복귀한다. 관제는 이 사건에 같은 종류의 헬기를 다시 보내지 않는다 (I.airDone)
    if (op.idleSince >= 0 && sim.t - op.idleSince >= (u.kind === 'policeHeli' ? AIR.idlePolice : AIR.idle)) {
      report(sim, s, op, st);
      emit(sim, { inc: I.id, role: 'UNIT', actor: u.callsign, kind: 'unit', imp: 1, text: `${u.callsign}: 상공 임무 종료, 복귀합니다.` });
      if (!I.airDone) I.airDone = [];
      I.airDone.push(u.kind);
      releaseUnit(sim, u);
      air.splice(k, 1);
      if (lit === op) lit = null;
      tellDispatch(sim, s, I, op, u);
      continue;
    }
    // 8) 실행
    if (op.mode === 'hoist') {
      const c = s.casualties[op.target];
      if (op.workId >= 0 && !liveWork(s.board[op.workId])) { reset(sim, op, st); continue; }      // 지휘관이 그 작업을 거뒀다
      if (!c || c.dead || !c.inWater || c.where !== 'scene') {
        // 이미 물 밖으로 나왔거나 숨졌다: 낡은 믿음으로 같은 일을 되풀이하지 않게 강제로 보고하고 그 작업을 끝낸다
        if (c) learn(sim, eye, casFact(sim, s, c, sim.responders[eye.rid].name), true, true);
        finishWork(sim, s, op); reset(sim, op, st);
        continue;
      }
      if (fly(s, op, c.x, c.y, AIR.workSpeed * sim.dt) > AIR.reach) { op.phase = 'hover'; op.progress = Math.max(0, op.progress - sim.dt * 0.5); continue; }
      op.phase = 'work';
      const storm = sim.disaster !== null && sim.disaster.kind === 'typhoon' && sim.disaster.phase === 'impact';
      op.need = (AIR.hoist / (0.6 + 0.4 * sim.responders[eye.rid].skill)) * (night ? 1.4 : 1) * (sim.weather === 'rain' ? 1.2 : 1) * (storm ? 1.5 : 1);
      op.progress += sim.dt;
      if (op.progress < op.need) continue;
      hoistDone(sim, s, I, op, u);
      report(sim, s, op, st);      // 인양 결과를 바로 알린다 (곧 떠날 수 있다)
      if (seatsOf(u) > 0 && seatsUsed(sim, u) >= seatsOf(u)) {
        // 자리가 찼다: 바로 병원으로 간다
        const j = I.assigned.indexOf(u.id); if (j >= 0) I.assigned.splice(j, 1);
        u.boardOrder = null; u.incidentId = null;
        const hosp = startTransport(sim, u);
        emit(sim, { inc: I.id, role: 'UNIT', actor: u.callsign, kind: 'unit', imp: 1, text: `${u.callsign} 환자 ${u.patients.length}명 싣고 ${josa(hosp.name, '으로/로')} 출발.` });
        air.splice(k, 1);
        tellDispatch(sim, s, I, op, u);
        continue;
      }
      reset(sim, op, st);
    } else if (op.mode === 'bucket') {
      if (op.workId >= 0 && !liveWork(s.board[op.workId])) { reset(sim, op, st); continue; }
      if ((u.bucket ?? 0) <= 0) {
        // 바구니가 비었다: 가장 가까운 물에서 떠 온다
        op.phase = 'away'; op.backAt = sim.t + (2 * waterDist(u)) / AIR.ferry + AIR.fill;
        continue;
      }
      if (st.dropAt < 0 || s.fire[st.dropAt] <= 0.05) { st.dropAt = hottest(s, op.target); st.fromX = op.x; st.fromY = op.y; }
      if (st.dropAt < 0) {
        // 그 구역의 바깥에 남은 불이 없다: 강제로 보고하고 그 작업을 끝낸다
        const reg = s.regions[op.target];
        learn(sim, eye, mkFact('fire', reg.id, 0, sim.responders[eye.rid].name, sim.t, 1, true, `${reg.name} 화재 진압 확인`), true, true);
        finishWork(sim, s, op); reset(sim, op, st);
        continue;
      }
      op.phase = 'work';
      if (fly(s, op, st.dropAt % s.w, (st.dropAt / s.w) | 0, AIR.workSpeed * sim.dt) > AIR.reach) continue;
      dropWater(sim, s, I, op, u, st);
    } else {
      // 살피며 돈다. 훑는 줄의 끝에 닿으면 다음 구간으로
      if (fly(s, op, st.tx, st.ty, WATCH_SPEED * sim.dt) < 0.05 && st.sweep) { st.leg++; st.sweep = false; eye.nextThink = sim.t; }
    }
  }
  // 9) 탐조등이 비추는 곳 (visionOf 가 이 원 안의 바깥 칸에서 지상 대원의 시야를 올린다)
  if (lit) { if (s.light) { s.light.x = lit.x; s.light.y = lit.y; } else s.light = { x: lit.x, y: lit.y, r: AIR.lightR }; }
  else if (s.light) s.light = null;
});
