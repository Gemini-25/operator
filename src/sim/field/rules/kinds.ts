// 사건 종류 다양화 ① 일상 사건의 세계 규칙 (docs/specs/N8-incident-kinds.md §4·§5.16·§5.17) — 진실을 읽고 바꾼다 (hazards.ts 와 같은 자격).
// registerRule((sim, s, I) => void) 로 등록한다. 모든 규칙은 첫 줄에서 자기 현장이 아니면 돌아간다(다른 사건의 결과를 바꾸지 않는다). 난수를 쓰는 규칙은 자기 흐름만.
//
// 단계 3: 오인 신고(medical/false)의 잠든 사람 — 대원이 곁에 오면 깨어나 걸어서 귀가한다.
import { hasKit } from '../../crews';
import type { Sim } from '../../engine';
import { emit, markRecovered, raiseProblem } from '../../events';
import type { Rng } from '../../rng';
import { T } from '../../types';
import type { Animal, Fact, FieldAgent, Hostile, Incident, Prop, Scene } from '../../types';
import { dist, josa } from '../../util';
import { mkFact } from '../beliefs';
import { hurtCas, hurtHostile, hurtResponder } from '../injury';
import { casFact, hosFact, learn, resp } from '../agents';
import { registerRule, registerVerdict } from '../sceneRegistry';
import { astar, los, staticPass, truthCost } from '../grid';
import { ANIMAL, HIVE, hiveR, tickAnimals } from '../animals';
import { addCas, addHostile, addProp } from '../kit';
import { startFlee } from '../hazards';
import { RUIN_SECONDARY, markRuin, recordFall } from '../ruins';

/** 깨우는 거리(칸) — 대원이 이만큼 다가오면 깨어난다 (§4.8 N2) */
export const WAKE_R = 1.5;

/**
 * (N2 오인 신고 · 응급) 길에서 잠든 사람: 누워 있다가(거동 불가로 보인다) 지상 대원이 1.5칸 안에 오면 깨어나 스스로 걷는다 — 걷는 사람은 안전한 곳으로 가서 where 'safe'
 * (hazards.tickCasualties 의 걷기). 깨운 대원은 바뀐 상태를 강제로 보고한다(§5.16 — 지휘관이 "거동 불가"의 낡은 믿음으로 이송을 되풀이하지 않게).
 * 업으려던 대원의 이송 임무는 실행기의 "스스로 걷는다" 갈래(executor 'carry' 의 c.walking)가 끝낸다
 */
registerRule((sim, s, I) => {
  if (s.variant !== 'false' || s.kind !== 'medical' || I.phase === 'closed') return;
  for (let ci = 0; ci < s.casualties.length; ci++) {
    const c = s.casualties[ci];
    if (c.dead || c.mob !== 'immobile' || c.where !== 'scene') continue;
    for (let k = 0; k < s.agents.length; k++) {
      const a = s.agents[k];
      if (a.status !== 'active' || a.aloft || dist(a.x, a.y, c.x, c.y) > WAKE_R) continue;
      c.mob = 'mobile'; c.walking = true; c.path = null; c.pathI = 0;
      const r = resp(sim, a);
      emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `흔들어 깨우자 일어납니다 — 쓰러진 것이 아니라 술에 취해 잠들어 있었습니다. 귀가를 안내합니다.` });
      learn(sim, a, casFact(sim, s, c, r.name), true, true);
      break;
    }
  }
});

// ───────────────────────── 시설 사고 (§4.2 — 단계 4a·4b) ─────────────────────────

/** 끊어진 전선의 상수 (설계서 §4.2 의 시작값) */
export const WIRE = {
  hurt: [15, 35] as [number, number],   // 반경에 들어갈 때 한 번 입는 감전 (H1 §2.3 — 방호는 injury.protection: 절연 장비 0.9 · 방화복 0.4)
  down: 0.3,                            // 그 가운데 바로 쓰러질 확률
  spark: 0.01, sparkRain: 0.004,        // 1초에 반경 가장자리 연료 칸에 불이 붙을 확률 (맑음 · 비)
  tellR: 6, tellT: 3,                   // 차에서 6칸 안·반경 밖에 대원이 3초 머물면 "내리지 마세요"를 들었다
  late: 120,                            // 전력 복구반이 이만큼 오지 않으면 관제가 원격 차단을 요청한다 (§5.3.6 — 시간 막이)
  remote: [60, 120] as [number, number],// 요청에서 차단까지 (초)
};
/** 전선 현장의 난수 흐름 wire:<사건> (감전·불꽃·원격 차단 시각 — 이 흐름만 쓴다) */
const WIRE_RNG = new WeakMap<Scene, Rng>();
function wireRng(sim: Sim, s: Scene, I: Incident): Rng { let r = WIRE_RNG.get(s); if (!r) { r = sim.rng.fork('wire:' + I.id); WIRE_RNG.set(s, r); } return r; }
/** 지난 틱에 위험 반경 안에 있던 사람 (대원 rid · 구조 대상 −1 − id) — "들어갈 때마다 한 번" 의 기억. 현장 객체의 모양을 바꾸지 않으려고 WeakMap */
const WIRE_IN = new WeakMap<Scene, Set<number>>();
/** 이 현장의 전선 소품 */
function wireOf(s: Scene): Prop | undefined { for (let k = 0; k < s.props.length; k++) if (s.props[k].skin === 'wire') return s.props[k]; return undefined; }

/**
 * (§5.16) 세계 규칙이 결말을 정했을 때의 강제 보고: 지휘관이 있으면 지휘관에게, 없으면 현장의 모든 대원에게 (learn(…, true, true) — 지휘관의 무전으로 대원들에게도 간다).
 * 낡은 믿음 때문에 남은 일(registerPending·registerBlocker)이 열린 채 한계 시간까지 가지 않게
 */
function forceTell(sim: Sim, s: Scene, f: Fact): void {
  const cmd = s.agents.find((b) => b.isCommander && b.status === 'active');
  if (cmd) { learn(sim, cmd, f, true, true); return; }
  for (const b of s.agents) if (b.status !== 'left') learn(sim, b, f, false, true);
}

/**
 * (4a §4.2 utility/wire) 끊어진 전선 — 살아 있는 동안:
 * ① 위험 반경에 들어간 사람(지상 대원·구조 대상)은 들어갈 때마다 한 번 감전된다(15~35, 30% 바로 쓰러짐 — 방호는 H1 표). 절연 장비를 들고 그 전선을 고치는 복구반은 빼고 센다.
 * ② 1초마다 확률 0.01(비 0.004)로 반경 가장자리의 연료 칸(길가 덤불)에 불이 붙는다 — 그 뒤는 지금의 tickFire.
 * ③ 차 위 전선: 탄 사람이 exitAt 넘게 "내리지 마세요"를 듣지 못하면 한 명이 내리려다 감전된다. 들은 것(s.kinds.told)은 접수 AI 의 도착 전 안내(hazards.applyCallerAid 'wire')
 *    또는 차에서 6칸 안·반경 밖에 대원이 3초 머묾(무슨 일을 하든 — 말로 알린다).
 * ④ 시간 막이(§5.3.6): 전력 복구 수요가 있는데 전력 복구반이 배정되지 않은 채 120초가 지나면 관제가 원격 차단을 요청하고(UTIL_LATE), 60~120초 뒤 전선이 죽는다 —
 *    그 틱에 지휘관(없으면 모든 대원)에게 관제의 무전으로 강제 보고(§5.16). 불꽃이 사라진 것을 본 것만으로는 아무도 죽었다고 믿지 않는다.
 * 전선이 죽은 뒤(복구·원격 차단): 차 안 사람은 곁(6칸)에 대원이 오면 차에서 내려 걸어서 안전한 곳으로 간다(대원의 안내 — 걷는 사람은 hazards.tickCasualties 가 옮긴다)
 */
registerRule((sim, s, I) => {
  if (s.kind !== 'utility' || s.variant !== 'wire' || I.phase === 'closed') return;
  const k = s.kinds, p = wireOf(s);
  if (!k || !p) return;
  if (!p.live) { wireAfter(sim, s, I, p); return; }
  const rng = wireRng(sim, s, I);
  const r = k.hazR ?? 2.2, r2 = r * r;
  // ① 들어간 사람
  let ins = WIRE_IN.get(s);
  const first = ins === undefined;
  if (!ins) { ins = new Set<number>(); WIRE_IN.set(s, ins); }
  for (let ai = 0; ai < s.agents.length; ai++) {
    const a = s.agents[ai];
    if ((a.status !== 'active' && a.status !== 'down') || a.aloft) continue;
    const dx = a.x - p.x, dy = a.y - p.y, inside = dx * dx + dy * dy <= r2;
    if (!inside) { ins.delete(a.rid); continue; }
    if (ins.has(a.rid)) continue;
    ins.add(a.rid);
    if (first || a.status !== 'active') continue;
    if (a.task !== null && a.task.kind === 'repair' && a.task.prop === p.id && hasKit(sim, a.rid, 'insulKit')) continue;      // 절연 장비를 갖추고 고치러 들어간 복구반
    const rr = resp(sim, a);
    const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: rr.name, rid: rr.id, kind: 'action', imp: 2, text: `감전! ${rr.name} 대원이 끊어진 전선의 위험 반경에 들어갔습니다.` });
    hurtResponder(sim, s, I, a, rng.range(WIRE.hurt[0], WIRE.hurt[1]), 'electric', { ev, down: rng.chance(WIRE.down) });
  }
  for (let ci = 0; ci < s.casualties.length; ci++) {
    const c = s.casualties[ci];
    if (c.dead || c.where !== 'scene' || c.inVehicle !== null) continue;
    const dx = c.x - p.x, dy = c.y - p.y, inside = dx * dx + dy * dy <= r2, key = -1 - c.id;
    if (!inside) { ins.delete(key); continue; }
    if (ins.has(key)) continue;
    ins.add(key);
    if (first) continue;
    const ev = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'casualty', imp: 2, truth: true, text: `구조 대상 ${josa(c.label, '이/가')} 끊어진 전선 곁에서 감전됐습니다.` });
    hurtCas(sim, s, I, c, rng.range(WIRE.hurt[0], WIRE.hurt[1]), 'electric', { ev, immobile: true });
  }
  // ③ 차 안 사람 — 들었는가
  if (k.told === false && k.exitAt !== undefined && k.exitAt < Infinity) {
    let near: FieldAgent | null = null;
    for (const a of s.agents) {
      if (a.status !== 'active' || a.aloft) continue;
      const dd = dist(a.x, a.y, p.x, p.y);
      if (dd > r && dd <= WIRE.tellR) { near = a; break; }
    }
    k.tellT = near ? (k.tellT ?? 0) + sim.dt : 0;
    if (near && (k.tellT ?? 0) >= WIRE.tellT) {
      k.told = true;
      const rr = resp(sim, near);
      emit(sim, { inc: I.id, role: 'RESPONDER', actor: rr.name, rid: rr.id, kind: 'action', imp: 1, text: '차 안에 계신 분들께 내리지 말고 그대로 계시라고 알렸습니다. 내리면 감전됩니다.' });
    } else if (sim.t >= k.exitAt) {
      // 듣지 못했다: 한 명이 차에서 내리려다 감전된다 (한 번 — 나머지는 그것을 보고 차 안에 머문다)
      k.exitAt = Infinity;
      const c = s.casualties.find((q) => !q.dead && q.inVehicle !== null && q.where === 'scene');
      if (c) {
        leaveCar(s, c.id, c.inVehicle!);
        c.inVehicle = null;
        c.x = c.px = Math.round(c.x); c.y = c.py = p.y <= 9 ? p.y - 1 : p.y + 1;      // 보도 쪽으로 내린다
        const ev = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'casualty', imp: 2, truth: true, text: `전선이 떨어진 차에서 ${josa(c.label, '이/가')} 내리려다 감전됐습니다.` });
        hurtCas(sim, s, I, c, rng.range(WIRE.hurt[0], WIRE.hurt[1]), 'electric', { ev, immobile: true });
        ins.add(-1 - c.id);
      }
    }
  }
  if (sim.tick % 5 !== 0) return;      // 아래는 1초에 한 번
  // ② 불꽃
  if (rng.chance(sim.weather === 'rain' ? WIRE.sparkRain : WIRE.spark)) {
    let best = -1;
    for (let i = 0; i < s.fuel.length; i++) {
      if (s.fuel[i] <= 0 || s.fire[i] > 0) continue;
      if (Math.hypot((i % s.w) - p.x, ((i / s.w) | 0) - p.y) > r + 0.7) continue;
      best = i; break;
    }
    if (best >= 0) {
      s.fire[best] = 0.3;
      raiseProblem(sim, I, 'HIDDEN_HAZARD', '전선 불꽃이 길가 덤불에 옮겨붙음', { role: 'SYSTEM', actor: '현장', imp: 2, truth: true, text: '끊어진 전선의 불꽃이 길가 덤불에 옮겨붙었습니다.' }, true);
    }
  }
  // ④ 시간 막이 — 원격 차단
  wireRemote(sim, s, I, p, rng);
});

/** 차의 탑승자 목록에서 뺀다 */
function leaveCar(s: Scene, cid: number, carId: number): void {
  const car = s.props[carId];
  if (car && car.occupants) { const j = car.occupants.indexOf(cid); if (j >= 0) car.occupants.splice(j, 1); }
}

/** (§5.3.6 ②) 전력 복구 수요가 채워지지 않은 채 120초 → 관제의 원격 차단 요청(UTIL_LATE) → 60~120초 뒤 전선이 죽는다. 세계 쪽 규칙이 조직의 상태(배정·요청)를 읽는다 */
function wireRemote(sim: Sim, s: Scene, I: Incident, p: Prop, rng: Rng): void {
  const k = s.kinds!;
  if ((k.remoteReq ?? -1) >= 0) {
    if (sim.t < (k.remoteAt ?? Infinity)) return;
    p.live = false;
    emit(sim, { inc: I.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 2, text: `사건 ${I.code}: 전력 회사가 원격으로 그 구간의 전기를 끊었습니다 — 끊어진 전선에 더는 전기가 흐르지 않습니다.` });
    markRecovered(I, 'UTIL_LATE', '원격 차단으로 위험을 없앴습니다');
    forceTell(sim, s, mkFact('haz', p.id, { kind: 'wire', active: false, x: p.x, y: p.y, r: k.hazR ?? 2.2 }, '관제', sim.t, 1, true, '관제: 원격 차단 — 전선에 전기가 흐르지 않음'));
    return;
  }
  let coming = false;
  for (const uid of I.assigned) { const u = sim.units[uid]; if (u.caps.utilPower >= 0.7 && (u.state === 'enroute' || u.state === 'turnout' || u.state === 'onscene')) { coming = true; break; } }
  let need = (I.unmet.utilPower ?? 0) > 0;
  if (!need) for (const q of s.requests) if (q.need === 'utilPower' && q.fulfilled < q.count) { need = true; break; }
  if (coming || !need) { k.needSince = -1; return; }
  if ((k.needSince ?? -1) < 0) { k.needSince = sim.t; return; }
  if (sim.t - k.needSince! < WIRE.late) return;
  k.remoteReq = sim.t;
  k.remoteAt = sim.t + rng.range(WIRE.remote[0], WIRE.remote[1]);
  raiseProblem(sim, I, 'UTIL_LATE', '전력 복구반이 오지 못해 원격 차단을 요청', { role: 'DISPATCH', actor: '배정 AI', imp: 2, text: `사건 ${I.code}: 전력 복구반이 ${Math.round(sim.t - k.needSince!)}초째 배정되지 못했습니다. 전력 회사에 원격 차단을 요청합니다.` });
}

/** 전선이 죽은 뒤: 차 안 사람은 곁(6칸)에 지상 대원이 오면 내려서 걸어 나간다 — 내린 자리는 차 곁의 보도 쪽 칸. 본 대원이 강제 보고한다(§5.16) */
function wireAfter(sim: Sim, s: Scene, I: Incident, p: Prop): void {
  for (let ci = 0; ci < s.casualties.length; ci++) {
    const c = s.casualties[ci];
    if (c.dead || c.where !== 'scene' || c.inVehicle === null) continue;
    let near: FieldAgent | null = null;
    for (const a of s.agents) if (a.status === 'active' && !a.aloft && dist(a.x, a.y, c.x, c.y) <= WIRE.tellR) { near = a; break; }
    if (!near) continue;
    leaveCar(s, c.id, c.inVehicle);
    c.inVehicle = null;
    c.x = c.px = Math.round(c.x); c.y = c.py = p.y <= 9 ? p.y - 1 : p.y + 1;
    c.mob = 'mobile'; c.walking = true; c.path = null; c.pathI = 0;
    const rr = resp(sim, near);
    emit(sim, { inc: I.id, role: 'RESPONDER', actor: rr.name, rid: rr.id, kind: 'action', imp: 1, text: `전기가 끊긴 것을 확인했습니다. 차 안의 ${josa(c.label, '을/를')} 내리게 해 안전한 곳으로 안내합니다.` });
    learn(sim, near, casFact(sim, s, c, rr.name), true, true);
  }
}

/** (§5.17) 판정: 살아 있는 시설물(fixture.live)이 남았으면 위험이 남은 것(벌점 1.5·목표 미완 — 한계 시간이면 미해결), 대신한 조치(UTIL_LATE)로 끝냈으면 +0.5(부분 성공) */
registerVerdict((sim, s, I) => {
  if (s.kind !== 'utility') return null;
  void sim;
  let open = false;
  for (const p of s.props) if (p.kind === 'fixture' && p.live === true) { open = true; break; }
  const late = I.problems.some((q) => q.code === 'UTIL_LATE');
  return open || late ? { open, bad: late ? 0.5 : 0 } : null;
});

// ───────────────────────── 단계 4b — 수도관 파열 · 싱크홀 · 떨어질 듯한 간판 ─────────────────────────

/** 이 현장의 그 생김새의 시설물 (fixture) */
function fixtureOf(s: Scene, skin: string): Prop | undefined { for (let k = 0; k < s.props.length; k++) { const p = s.props[k]; if (p.kind === 'fixture' && p.skin === skin && !p.removed) return p; } return undefined; }
const tileAt = (s: Scene, x: number, y: number): number => Math.round(y) * s.w + Math.round(x);

/** 수도관 파열의 상수 (설계서 §4.2 의 시작값 — 1초당) */
export const MAIN = { rise: 0.004, drain: 0.006, pump: 0.004, hurtAt: 0.5, trapAt: 0.7, expo: 0.05, trapWork: 8 };
/**
 * (4b §4.2 utility/main) 지하 침수: 1초마다 관이 살아 있으면 s.kinds.flood 가 0.004 오르고(250초에 1), 잠긴 뒤에는 0.006 씩 빠진다
 * (배수 펌프 pumpSet 을 든 대원이 지하에 서 있으면 0.004 더). 0.5 를 넘으면 지하의 사람은 1초에 실외 노출 0.05(매 틱 피해 — 문턱·출혈 없음),
 * 0.7 을 넘으면 걸어 나오지 못한 사람이 고립된다(구출 작업량 8). 알림은 무릎·허리 두 번. 난수를 쓰지 않는다(main:<사건> 흐름을 만들지 않았다)
 */
registerRule((sim, s, I) => {
  if (s.kind !== 'utility' || s.variant !== 'main' || I.phase === 'closed' || sim.tick % 5 !== 0) return;
  const k = s.kinds;
  if (!k || k.base === undefined) return;
  const pipe = fixtureOf(s, 'pipe'), live = pipe !== undefined && pipe.live === true;
  let f = k.flood ?? 0;
  if (live) f = Math.min(1, f + MAIN.rise);
  else if (f > 0) {
    let pump = false;
    for (const a of s.agents) if (a.status === 'active' && !a.aloft && s.region[tileAt(s, a.x, a.y)] === k.base && hasKit(sim, a.rid, 'pumpSet')) { pump = true; break; }
    f = Math.max(0, f - MAIN.drain - (pump ? MAIN.pump : 0));
  }
  k.flood = f;
  const lv = f >= MAIN.trapAt ? 2 : f >= MAIN.hurtAt ? 1 : 0;
  if (lv > (k.wetTold ?? 0)) {
    k.wetTold = lv;
    emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 2, truth: true, text: lv === 1 ? '지하 주차장에 물이 무릎 높이까지 찼습니다.' : '지하 주차장 물이 허리 위로 차올랐습니다 — 걸어 나오기 어렵습니다.' });
  }
  if (f < MAIN.hurtAt) return;
  for (let ci = 0; ci < s.casualties.length; ci++) {
    const c = s.casualties[ci];
    if (c.dead || c.where !== 'scene' || s.region[tileAt(s, c.x, c.y)] !== k.base) continue;
    hurtCas(sim, s, I, c, MAIN.expo, 'exposure', { tick: true });
    if (f >= MAIN.trapAt && c.mob === 'mobile' && !c.walking) {
      c.mob = 'trapped'; c.trapWork = MAIN.trapWork;
      emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'casualty', imp: 2, truth: true, text: `지하 주차장 물이 차올라 구조 대상 ${josa(c.label, '이/가')} 고립됐습니다.` });
    }
  }
});

/** 싱크홀의 상수 (설계서 §4.2 — 10초마다의 넓어짐 확률 = base + perPerson × 띠 위 사람 + perCar × 띠 위 차 + shored(보강을 마쳤으면)) */
export const HOLE = { base: 0.06, perPerson: 0.08, perCar: 0.1, shored: -0.12, grow: 2, fall: [10, 20] as [number, number] };
/** 10초 동안 구멍이 넓어질 확률 (손 계산의 식 — 시험 10) */
export function holeChance(people: number, cars: number, shored: boolean): number { return HOLE.base + HOLE.perPerson * people + HOLE.perCar * cars + (shored ? HOLE.shored : 0); }
const HOLE_RNG = new WeakMap<Scene, Rng>();
function holeRng(sim: Sim, s: Scene, I: Incident): Rng { let r = HOLE_RNG.get(s); if (!r) { r = sim.rng.fork('hole:' + I.id); HOLE_RNG.set(s, r); } return r; }
/** 싱크홀이 꺼뜨릴 수 있는 칸인가: 차로와 안쪽 보도(y 8~12 — 맨 바깥 보도 y 7·13~14 는 남겨 길 양쪽이 이어진다), 벽·빈 칸이 아니고 남겨 둘 칸(관·밸브)이 아니다 */
function holeCan(s: Scene, i: number, keep: readonly number[]): boolean {
  const y = (i / s.w) | 0, x = i % s.w;
  return y >= 8 && y <= 12 && x >= 1 && x < s.w - 1 && s.tiles[i] !== T.WALL && s.tiles[i] !== T.VOID && keep.indexOf(i) < 0;
}
/** 반경 밖의 가장 가까운 걸을 수 있는 칸 (넘어지며 밀려나는 자리) */
function outside(s: Scene, x: number, y: number, hx: number, hy: number, r: number): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null, bd = Infinity;
  for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
    const nx = Math.round(x) + dx, ny = Math.round(y) + dy;
    if (nx < 1 || ny < 1 || nx >= s.w - 1 || ny >= s.h - 1) continue;
    const t = s.tiles[ny * s.w + nx];
    if (!staticPass(t) || s.propAt[ny * s.w + nx] >= 0 || Math.hypot(nx - hx, ny - hy) <= r + 0.3) continue;
    const d = Math.hypot(nx - x, ny - y);
    if (d < bd) { bd = d; best = { x: nx, y: ny }; }
  }
  return best;
}
/**
 * (4b §4.2 utility/sinkhole) 넓어지는 구멍: 10초마다(흐름 hole:<사건> — 상한에 걸려도 한 번 뽑는다) 위의 확률로 반경이 1 늘어 가장자리 띠의 칸이 T.VOID 가 된다(많아야 처음 + 2).
 * 그때 띠 위의 사람(대원·구조 대상)은 구멍 바깥쪽으로 밀려나며 넘어진다 — 새 반경 밖의 가장 가까운 걸을 수 있는 칸으로 옮겨지고 추락 10~20.
 * 칸이 바뀌면 무너짐 기록(ruins)·고정 층 다시 그리기·모든 경로 다시 짜기. 반경은 s.kinds.hazR — 대원은 본 대로 안다(agents.perceive)
 */
registerRule((sim, s, I) => {
  if (s.kind !== 'utility' || s.variant !== 'sinkhole' || I.phase === 'closed' || sim.tick % 50 !== 0) return;
  const k = s.kinds, hole = fixtureOf(s, 'hole');
  if (!k || !hole || k.hazR === undefined || k.holeR0 === undefined) return;
  const r = k.hazR, keep = k.keep ?? [], hx = hole.x, hy = hole.y;
  const onBand = (x: number, y: number): boolean => { const d = Math.hypot(x - hx, y - hy); return d > r && d <= r + 1; };
  let people = 0, cars = 0;
  for (const a of s.agents) if (a.status === 'active' && !a.aloft && onBand(a.x, a.y)) people++;
  for (const c of s.casualties) if (!c.dead && c.where === 'scene' && staticPass(s.tiles[tileAt(s, c.x, c.y)]) && onBand(c.x, c.y)) people++;
  for (const p of s.props) if (p.kind === 'vehicle' && !p.removed && staticPass(s.tiles[p.y * s.w + p.x]) && onBand(p.x, p.y)) cars++;
  const rng = holeRng(sim, s, I);
  const roll = rng.next();
  const pr = holeChance(people, cars, hole.mitigated === true);
  if (r >= k.holeR0 + HOLE.grow - 1e-6 || roll >= pr) return;
  const nr = r + 1;
  const fresh: number[] = [];
  for (let i = 0; i < s.tiles.length; i++) if (holeCan(s, i, keep) && Math.hypot((i % s.w) - hx, ((i / s.w) | 0) - hy) <= nr) fresh.push(i);
  k.hazR = nr;
  if (!fresh.length) return;
  const ev = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 2, truth: true, text: '싱크홀 가장자리가 무너져 구멍이 넓어졌습니다.' });
  for (const i of fresh) {
    s.tiles[i] = T.VOID;
    for (const reg of s.regions) { const j = reg.tiles.indexOf(i); if (j >= 0) reg.tiles.splice(j, 1); }      // 구멍 둘레 구역도 그 칸을 놓는다 (수색 경유점이 꺼진 칸이 되지 않게)
    s.region[i] = -1;
    markRuin(s, i, RUIN_SECONDARY);
  }
  recordFall(sim, s, hx, hy, nr, 'secondary');
  s.staticVersion++;
  const gone = (x: number, y: number): boolean => fresh.indexOf(tileAt(s, x, y)) >= 0;
  for (const a of s.agents) {
    a.path = null;
    if (a.aloft || (a.status !== 'active' && a.status !== 'down') || !gone(a.x, a.y)) continue;
    const to = outside(s, a.x, a.y, hx, hy, nr);
    if (to) { a.x = a.px = to.x; a.y = a.py = to.y; }
    const rr = resp(sim, a);
    const e2 = emit(sim, { inc: I.id, role: 'RESPONDER', actor: rr.name, rid: rr.id, kind: 'action', imp: 2, causes: [ev], text: `${rr.name} 대원이 무너지는 가장자리에서 밀려나며 넘어졌습니다.` });
    hurtResponder(sim, s, I, a, rng.range(HOLE.fall[0], HOLE.fall[1]), 'fall', { ev: e2 });
  }
  for (const c of s.casualties) {
    c.path = null;
    if (c.dead || c.where !== 'scene' || !gone(c.x, c.y)) continue;
    const to = outside(s, c.x, c.y, hx, hy, nr);
    if (to) { c.x = c.px = to.x; c.y = c.py = to.y; }
    hurtCas(sim, s, I, c, rng.range(HOLE.fall[0], HOLE.fall[1]), 'fall', { ev });
  }
});

/** 간판의 상수 (설계서 §4.2 — 떨어질 때 낙하 구역의 사람이 입는 깔림) */
export const SIGN = { hurt: [20, 40] as [number, number], guardR: 2 };
const SIGN_RNG = new WeakMap<Scene, Rng>();
function signRng(sim: Sim, s: Scene, I: Incident): Rng { let r = SIGN_RNG.get(s); if (!r) { r = sim.rng.fork('sign:' + I.id); SIGN_RNG.set(s, r); } return r; }
/**
 * (4b §4.2 utility/sign) 매달린 간판: 1초마다 흔들림(leak)이 leakRate(0.004~0.009 — 비 ×1.5, 현장을 만들 때 정했다)만큼 오른다. 1 이 되면 떨어진다(흐름 sign:<사건>):
 * 낙하 구역의 사람은 깔림 20~40, 잔해(roadDebris 'signDebris')가 놓인다(핵심 규칙이 차로 정리를 낸다). 그때 낙하 구역이 통제되지 않았으면
 * (구역 2칸 안에서 통제(cordon)를 맡은 대원이 없다) 지나던 행인 1명이 다친 구조 대상으로 붙는다. 사람이 다치면 ESCALATION.
 * 떨어진 것은 지휘관에게 강제 보고한다(§5.16 — 모두가 들은 큰 소리)
 */
registerRule((sim, s, I) => {
  if (s.kind !== 'utility' || s.variant !== 'sign' || I.phase === 'closed' || sim.tick % 5 !== 0) return;
  const p = fixtureOf(s, 'sign'), k = s.kinds;
  if (!p || !k || p.live !== true) return;
  p.leak = Math.min(1, (p.leak ?? 0) + (p.leakRate ?? 0));
  if (p.leak < 1) return;
  p.live = false;
  const rng = signRng(sim, s, I), zone = k.zone ?? [];
  const ev = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 2, truth: true, text: '매달려 있던 간판이 떨어졌습니다!' });
  let guarded = false;
  for (const a of s.agents) {
    if (a.status !== 'active' || a.aloft || !a.task || a.task.kind !== 'cordon') continue;
    for (const i of zone) if (dist(a.x, a.y, i % s.w, (i / s.w) | 0) <= SIGN.guardR) { guarded = true; break; }
    if (guarded) break;
  }
  let hurt = 0;
  for (const a of s.agents) {
    if (a.status !== 'active' || a.aloft || zone.indexOf(tileAt(s, a.x, a.y)) < 0) continue;
    hurt++;
    hurtResponder(sim, s, I, a, rng.range(SIGN.hurt[0], SIGN.hurt[1]), 'crush', { ev });
  }
  for (const c of s.casualties) {
    if (c.dead || c.where !== 'scene' || zone.indexOf(tileAt(s, c.x, c.y)) < 0) continue;
    hurt++;
    hurtCas(sim, s, I, c, rng.range(SIGN.hurt[0], SIGN.hurt[1]), 'crush', { ev });
  }
  const zi = zone.length ? zone[rng.int(0, zone.length - 1)] : -1;
  if (!guarded && zi >= 0) {
    const c = addCas(s, zi % s.w, (zi / s.w) | 0, 'immobile', 100, 0, 0);
    hurt++;
    const e2 = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'casualty', imp: 2, truth: true, causes: [ev], text: `통제되지 않은 낙하 구역을 지나던 행인 ${josa(c.label, '이/가')} 떨어진 간판에 다쳤습니다.` });
    hurtCas(sim, s, I, c, rng.range(SIGN.hurt[0], SIGN.hurt[1]), 'crush', { ev: e2, immobile: true });
  }
  const dy = Math.min(8, p.y + 1);
  if (s.propAt[dy * s.w + p.x] < 0) addProp(s, 'roadDebris', p.x, dy, { skin: 'signDebris', blocking: false });
  s.staticVersion++;
  if (hurt) raiseProblem(sim, I, 'ESCALATION', '간판 낙하로 사람이 다침', { role: 'SYSTEM', actor: '현장', imp: 2, truth: true, causes: [ev], text: `떨어진 간판에 ${hurt}명이 다쳤습니다.` });
  forceTell(sim, s, mkFact('haz', p.id, { kind: 'sign', active: false, x: p.x, y: p.y, r: k.hazR ?? 2 }, '현장', sim.t, 1, true, '간판이 떨어짐 — 낙하 위험은 끝남, 잔해 정리'));
});

// ───────────────────────── 동물 (§4.3 — 단계 5) ─────────────────────────
/** 동물마다의 난수 흐름 animal:<사건>:<동물> (배회·숨은 개가 떠나는 시각) */
const ANI_RNG = new WeakMap<Animal, Rng>();
let aniSim: Sim | null = null, aniInc = -1;
function aniRngOf(a: Animal): Rng { let r = ANI_RNG.get(a); if (!r) { r = aniSim!.rng.fork('animal:' + aniInc + ':' + a.id); ANI_RNG.set(a, r); } return r; }
/** 들이받힘·동물에 차가 부딪힘의 난수 흐름 (현장마다 하나 — 피해·운전자의 부상) */
const ANI_HIT_RNG = new WeakMap<Scene, Rng>();
function aniHitRng(sim: Sim, s: Scene, I: Incident): Rng { let r = ANI_HIT_RNG.get(s); if (!r) { r = sim.rng.fork('animal-hit:' + I.id); ANI_HIT_RNG.set(s, r); } return r; }
/** 동물 사실 (본 대원의 믿음 — 'ani', id = 동물 id) */
export function aniFact(sim: Sim, a: Animal, src: string, why: string): Fact {
  const state = a.state === 'caught' ? 'caught' : a.state === 'gone' ? 'gone' : a.state === 'sedated' ? 'sedated' : 'loose';
  return mkFact('ani', a.id, { kind: a.kind, x: Math.round(a.x), y: Math.round(a.y), state, via: a.via ?? undefined, lost: undefined }, src, sim.t, 1, true, why);
}
/**
 * (5 §4.3) 동물 현장의 세계 규칙 — field/animals.ts 의 tickAnimals 를 돌리고 그 틱에 일어난 일에 피해·기록·강제 보고를 붙인다:
 * ① 들이받음: 닿은 사람(대원 hurtResponder · 구조 대상 hurtCas)에게 동물 피해(그 종류의 범위 — 흐름 animal-hit:<사건>)
 * ② 출구로 나감: 찻길이면 ANIMAL_LOST(문제 — 판정 +1.0), 산 쪽이면 "산 쪽으로 쫓아냈습니다". 그 출구 12칸 안·시야선의 대원이 본 대로 안다(강제 보고)
 * ③ 잠듦·우리에 들어감: 곁(8칸)·시야선의 대원이 본 대로 안다
 * ④ (가축 탈출) 지나는 차: 차로 위의 동물 앞에서 주의하는 차는 서고, 한눈판 차는 부딪쳐 선다 — 30% 로 운전자가 가볍게 다친다(구조 대상이 붙는다, 2차 사고)
 */
registerRule((sim, s, I) => {
  if (s.kind !== 'animal' || I.phase === 'closed' || !s.animals) return;
  aniSim = sim; aniInc = I.id;
  const evs = tickAnimals(sim, s, I, aniRngOf);
  for (const e of evs) {
    const a = e.a;
    if (e.kind === 'charge' && e.victim) {
      const rng = aniHitRng(sim, s, I), d = ANIMAL[a.kind];
      const raw = rng.range(d.hurt[0], d.hurt[1]);
      if (e.victim.agent >= 0) {
        const b = s.agents[e.victim.agent], rr = resp(sim, b);
        const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: rr.name, rid: rr.id, kind: 'hazard', imp: 2, text: `${josa(a.label, '이/가')} 달려들어 ${rr.name} 대원이 다쳤습니다.` });
        hurtResponder(sim, s, I, b, raw, 'animal', { ev });
      } else {
        const c = s.casualties[e.victim.cas];
        const ev = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'casualty', imp: 2, truth: true, text: `${josa(a.label, '이/가')} 구조 대상 ${josa(c.label, '을/를')} 들이받았습니다.` });
        hurtCas(sim, s, I, c, raw, 'animal', { ev });
      }
    } else if (e.kind === 'gone') {
      const ex = s.exits[e.exit];
      const road = a.via === 'road';
      if (road) raiseProblem(sim, I, 'ANIMAL_LOST', `${a.label} 찻길로 달아남`, { role: 'SYSTEM', actor: '현장', imp: 2, truth: true, text: `${josa(a.label, '이/가')} 찻길 쪽으로 달아났습니다.` }, false);
      else emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'action', imp: 1, truth: true, text: `${josa(a.label, '이/가')} 산 쪽으로 달아났습니다 — 쫓아냄.` });
      for (const b of s.agents) if (b.status === 'active' && !b.aloft && dist(b.x, b.y, ex.x, ex.y) <= 12 && los(s, b.x, b.y, ex.x, ex.y)) learn(sim, b, aniFact(sim, a, resp(sim, b).name, `${a.label} — ${road ? '찻길로 달아남' : '산 쪽으로 쫓아냄'}`), true, true);
    } else if (e.kind === 'sedated') {
      for (const b of s.agents) if (b.status === 'active' && !b.aloft && dist(b.x, b.y, a.x, a.y) <= 8 && los(s, b.x, b.y, a.x, a.y)) learn(sim, b, aniFact(sim, a, resp(sim, b).name, a.state === 'caught' ? `${a.label} 우리 안으로 들어감` : `${a.label} 마취되어 잠듦`), true, true);
    }
  }
  if (s.cars.length && s.variant === 'escape') laneAnimals(sim, s, I);
});
/** 급정거한 차의 경적에 동물이 놀라는 정도 (흥분 +) */
export const HORN_AGIT = 0.3;
/** (④ 가축 탈출) 차로의 차와 동물: 주의하는 차는 서고(급정거), 한눈판 차는 0.6칸 안에서 부딪쳐 선다 — 30% 로 운전자 부상(구조 대상), 2차 사고. 동물은 놀라 흥분한다 */
function laneAnimals(sim: Sim, s: Scene, I: Incident): void {
  for (const c of s.cars) {
    if (c.hit) continue;
    for (const a of s.animals!) {
      if (a.state === 'caught' || a.state === 'gone' || Math.round(a.y) !== c.row) continue;
      const ahead = (a.x - c.x) * c.dir;
      if (ahead < -0.3 || ahead > 3.5) continue;
      // 급정거하며 경적을 울린 차 앞의 동물은 놀란다 (차마다 한 번 — 멈춘 차는 다시 세지 않는다). 통제 전의 차로에서 가축이 흥분해 찻길 출구로 내달리는 길
      if (!c.distracted) { c.speed = Math.max(0.6, c.speed - 9 * sim.dt); if (ahead < 1.2 && !c.stopped) { c.stopped = true; a.agit = Math.min(1, a.agit + HORN_AGIT); } continue; }
      if (ahead > 0.6) continue;
      c.hit = true; a.agit = 1;      // 차에 받힌 동물은 놀라 내달린다 (흥분 1 — 통제되지 않은 찻길 출구로 나가면 놓친다)
      const rng = aniHitRng(sim, s, I);
      const ev = raiseProblem(sim, I, 'SECONDARY_COLLISION', `통제되지 않은 차로에서 차량이 ${josa(a.label, '과/와')} 부딪침`, { role: 'SYSTEM', actor: '현장', imp: 2, truth: true, text: `지나던 차량이 도로 위의 ${josa(a.label, '과/와')} 부딪쳤습니다.` }, false);
      if (rng.chance(0.3)) {
        const y = c.row <= 9 ? 7 : 12, x = Math.max(1, Math.min(s.w - 2, Math.round(c.x)));
        const cas = addCas(s, x, y, 'mobile', 100, 0, 0);
        hurtCas(sim, s, I, cas, rng.range(10, 22), 'vehicle', { ev });
      }
      break;
    }
  }
}

/** 사람마다 쏘인 횟수 (구조 대상 −1 − id) — 현장 객체의 모양을 바꾸지 않으려고 WeakMap */
const STUNG = new WeakMap<Scene, Map<number, number>>();
const HIVE_RNG = new WeakMap<Scene, Rng>();
function hiveRng(sim: Sim, s: Scene, I: Incident): Rng { let r = HIVE_RNG.get(s); if (!r) { r = sim.rng.fork('hive:' + I.id); HIVE_RNG.set(s, r); } return r; }
/**
 * (5 §4.3 animal/hive) 벌집: 살아 있는 동안 3초마다 반경 안의 보호복 없는 사람(대원·현장의 구조 대상)이 쏘인다(동물 2~5 — 한 번씩).
 * 세 번 넘게 쏘인 구조 대상은 15% 로 급변한다(악화 0.3/초 — 알레르기). 흐름 hive:<사건>
 */
registerRule((sim, s, I) => {
  if (s.kind !== 'animal' || s.variant !== 'hive' || I.phase === 'closed' || sim.tick % (HIVE.every * 5) !== 0) return;
  const p = fixtureOf(s, 'hive');
  if (!p || p.live !== true) return;
  const r = hiveR(sim, s), rng = hiveRng(sim, s, I);
  let st = STUNG.get(s); if (!st) { st = new Map(); STUNG.set(s, st); }
  for (const a of s.agents) {
    if (a.status !== 'active' || a.aloft || dist(a.x, a.y, p.x, p.y) > r || hasKit(sim, a.rid, 'beeSuit')) continue;
    const rr = resp(sim, a);
    const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: rr.name, rid: rr.id, kind: 'hazard', imp: 1, text: `${rr.name} 대원이 벌에 쏘였습니다.` });
    hurtResponder(sim, s, I, a, rng.range(HIVE.sting[0], HIVE.sting[1]), 'animal', { ev });
  }
  for (const c of s.casualties) {
    if (c.dead || c.where !== 'scene' || dist(c.x, c.y, p.x, p.y) > r) continue;
    const key = -1 - c.id, n = (st.get(key) ?? 0) + 1;
    st.set(key, n);
    hurtCas(sim, s, I, c, rng.range(HIVE.sting[0], HIVE.sting[1]), 'animal', {});
    if (n > HIVE.severeAfter && c.bleed < HIVE.severeBleed && rng.chance(HIVE.severeP)) {
      c.bleed = HIVE.severeBleed; c.mob = 'immobile'; c.walking = false;
      raiseProblem(sim, I, 'ESCALATION', `벌에 여러 번 쏘인 ${c.label} 급변`, { role: 'SYSTEM', actor: '현장', imp: 2, truth: true, text: `벌에 여러 번 쏘인 구조 대상 ${josa(c.label, '이/가')} 숨이 가빠지며 쓰러졌습니다.` }, false);
    }
  }
});

/**
 * (§5.17) 동물의 판정: 풀린 동물(잠들지도 잡히지도 나가지도 않은)이 현장에 남았거나 벌집이 남았으면 위험이 남은 것(한계 시간이면 미해결) ·
 * 찻길로 놓친 동물(ANIMAL_LOST) 마리당 +1.0(많아야 2) · 산 쪽으로 쫓아낸 동물이 있으면 +0.3(부분 성공)
 */
registerVerdict((sim, s, I) => {
  if (s.kind !== 'animal') return null;
  void sim;
  let open = false, wild = false;
  for (const a of s.animals ?? []) { if (a.state !== 'caught' && a.state !== 'gone' && a.state !== 'sedated') open = true; if (a.state === 'gone' && a.via === 'wild') wild = true; }
  for (const p of s.props) if (p.kind === 'fixture' && p.skin === 'hive' && p.live === true) open = true;
  const lost = Math.min(2, I.problems.filter((q) => q.code === 'ANIMAL_LOST').length);
  const bad = lost * 1.0 + (wild ? 0.3 : 0);
  return open || bad > 0 ? { open, bad } : null;
});

// ───────────────────────── 치안 disturb (§4.4 — 단계 6a) ─────────────────────────
/** 치안 규칙의 상수: 주취자의 던지기(8~15초, 경찰 4칸 밖 · 2칸 안 손님 · 둔상 3~8) · 몸싸움(경찰 2칸 · 공격성 0.6 · 10초 · 15% · 4~10) · 깨우기(경찰 1.5칸 4초 · 사기 +0.2) ·
 *  패싸움(4초마다 · 가운데 2칸 · 맞으면 2~6 · 구경꾼 25% · 많아야 둘) · 가운데에 선 경찰의 사기 깎기(초당 0.01, 경찰 : 싸우는 사람 ≥ 1 : 2 면 0.01 더) · 흩어짐 30% · 날치기 숨은 시간 60~140초(첫 도착 뒤) · 길목 1.5칸 */
export const DISTURB = { throwGap: [8, 15] as [number, number], throwFar: 4, throwNear: 2, throwHurt: [3, 8] as [number, number], scuffleR: 2, scuffleAggr: 0.6, scuffleGap: 10, scuffleP: 0.15, scuffleHurt: [4, 10] as [number, number],
  throwMax: 3, wakeR: 1.5, wakeT: 4, wakeMorale: 0.2, brawlEvery: 4, midR: 2, brawlHurt: [2, 6] as [number, number], bystanderP: 0.25, bystanderMax: 2, calm: 0.01, scatterP: 0.3, scatterAt: 0.25, hide: [60, 140] as [number, number], boltP: 0.5, chokeR: 1.5 };
/** 활동 중인 경찰 (지상) 가운데 (x, y) 에서 R 칸 안의 수 */
function copsNear(sim: Sim, s: Scene, x: number, y: number, R: number): number {
  let n = 0;
  for (const a of s.agents) if (a.status === 'active' && !a.aloft && sim.responders[a.rid].dept === 'police' && dist(a.x, a.y, x, y) <= R) n++;
  return n;
}
const DIST_RNG = new WeakMap<Scene, Rng>();
function disturbRng(sim: Sim, s: Scene, I: Incident, name: 'rowdy' | 'brawl' | 'snatch'): Rng {
  let r = DIST_RNG.get(s);
  if (!r) { r = name === 'rowdy' ? sim.rng.fork('rowdy:' + I.id) : name === 'brawl' ? sim.rng.fork('brawl:' + I.id) : sim.rng.fork('snatch:' + I.id); DIST_RNG.set(s, r); }      // 흐름 이름은 글자로 (시험 6 이 소스의 fork 글자를 센다) — 현장 하나는 변형 하나라 현장마다 흐름 하나
  return r;
}
/** 주취자마다의 세계 상태 (던질 시각 · 몸싸움 시각 · 깨우는 경찰이 곁에 있던 시간 · 머리 부상 처리) — 용의자 객체의 모양을 바꾸지 않으려고 WeakMap */
interface RowdyRun { throwAt: number; scuffleAt: number; wake: number; head: boolean; thrown: number }
const ROWDY = new WeakMap<Hostile, RowdyRun>();
/**
 * (§4.4 rowdy) 주취 소란: 서 있는 동안 8~15초마다 경찰이 4칸 안에 없으면 2칸 안 손님 하나에게 물건을 던진다(둔상 3~8 — 처음이면 ESCALATION) ·
 * 경찰이 2칸 안이고 공격성 0.6 넘으면 10초마다 15% 로 몸싸움(경찰 둔상 4~10) · 잠든 사람은 경찰이 1.5칸 안에 4초 머물면 깬다(사기 +0.2) ·
 * 검거된 주취자가 머리를 다쳤으면(s.kinds.headInjury — 진실) 그 자리에 다친 사람(띠 1)이 생긴다(보호 조치 뒤 병원 이송). 흐름 rowdy:<사건>
 */
registerRule((sim, s, I) => {
  if (s.kind !== 'disturb' || s.variant !== 'rowdy' || I.phase === 'closed') return;
  const dt = sim.dt;
  for (const h of s.hostiles) {
    let st = ROWDY.get(h);
    if (!st) { const rng = disturbRng(sim, s, I, 'rowdy'); st = { throwAt: sim.t + rng.range(DISTURB.throwGap[0], DISTURB.throwGap[1]), scuffleAt: sim.t + DISTURB.scuffleGap, wake: 0, head: false, thrown: 0 }; ROWDY.set(h, st); }
    if (h.state === 'arrested') {
      if (!st.head && s.kinds && s.kinds.headInjury && !h.dead) {
        st.head = true;
        // 체력·출혈은 피해 한 길로 (H1 — 출혈 원인이 빈 채로 피를 흘리는 사람이 없다)
        const c = addCas(s, Math.round(h.x), Math.round(h.y), 'immobile', 100, 0, 0.1);
        const hev = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'casualty', imp: 2, truth: true, text: `보호 조치한 ${josa(h.label, '이/가')} 머리를 다친 채였습니다 — 병원 이송이 필요합니다.` });
        hurtCas(sim, s, I, c, 30, 'blunt', { ev: hev, bleed: 0.012, immobile: true });
      }
      continue;
    }
    if (h.state === 'escaped' || h.state === 'down' || h.state === 'surrendered') continue;
    if (h.asleep) {
      st.wake = copsNear(sim, s, h.x, h.y, DISTURB.wakeR) > 0 ? st.wake + dt : 0;
      if (st.wake >= DISTURB.wakeT) {
        h.asleep = false; h.morale = Math.min(0.95, h.morale + DISTURB.wakeMorale); h.alertUntil = sim.t + 5;
        emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'action', imp: 1, text: `흔들어 깨우자 ${josa(h.label, '이/가')} 눈을 떴습니다.` });
        for (const a of s.agents) if (a.status === 'active' && dist(a.x, a.y, h.x, h.y) <= 3) learn(sim, a, hosFact(sim, s, h, resp(sim, a).name, dist(a.x, a.y, h.x, h.y)), true, true);
      }
      continue;
    }
    if (h.state !== 'hold' && h.state !== 'fight') continue;
    const rng = disturbRng(sim, s, I, 'rowdy');
    if (sim.t >= st.throwAt) {
      st.throwAt = sim.t + rng.range(DISTURB.throwGap[0], DISTURB.throwGap[1]);
      if (st.thrown < DISTURB.throwMax && copsNear(sim, s, h.x, h.y, DISTURB.throwFar) === 0) {
        const c = s.casualties.find((q) => !q.dead && q.where === 'scene' && dist(q.x, q.y, h.x, h.y) <= DISTURB.throwNear);
        if (c) {
          st.thrown++;
          const first = !I.problems.some((p) => p.code === 'ESCALATION');
          const ev = first ? raiseProblem(sim, I, 'ESCALATION', `${h.label}가 던진 물건에 손님이 다침`, { role: 'SYSTEM', actor: '현장', imp: 2, truth: s.arrivedAt < 0, text: `${josa(h.label, '이/가')} 물건을 던져 손님 ${josa(c.label, '이/가')} 다쳤습니다.` }, false)
            : emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 1, truth: s.arrivedAt < 0, text: `${josa(h.label, '이/가')} 또 물건을 던졌습니다.` });
          hurtCas(sim, s, I, c, rng.range(DISTURB.throwHurt[0], DISTURB.throwHurt[1]), 'blunt', { ev });
        }
      }
    }
    if (sim.t >= st.scuffleAt) {
      st.scuffleAt = sim.t + DISTURB.scuffleGap;
      if (h.aggression > DISTURB.scuffleAggr && rng.chance(DISTURB.scuffleP)) {
        const a = s.agents.find((b) => b.status === 'active' && !b.aloft && sim.responders[b.rid].dept === 'police' && dist(b.x, b.y, h.x, h.y) <= DISTURB.scuffleR);
        if (a) {
          const r = resp(sim, a);
          const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'hazard', imp: 1, text: `${josa(h.label, '이/가')} 휘두른 주먹에 ${r.name} 대원이 맞았습니다.` });
          hurtResponder(sim, s, I, a, rng.range(DISTURB.scuffleHurt[0], DISTURB.scuffleHurt[1]), 'blunt', { ev });
        }
      }
    }
  }
});

/** 패싸움에 휘말려 다친 구경꾼의 수 (현장마다 — 많아야 둘) */
const BYSTANDERS = new WeakMap<Scene, number>();
/** 패싸움의 흩어짐을 한 번만 뽑았다 (용의자마다) */
const SCATTERED = new WeakSet<Hostile>();
/**
 * (§4.4 brawl) 폭행 시비: 두 무리에 서 있는 사람이 있고 두 무리 가운데 2칸 안에 경찰이 없으면 4초마다 하나가 맞는다(hurtHostile 둔상 2~6) — 25% 로 휘말린 구경꾼이
 * 다친 구조 대상으로 붙는다(ESCALATION — 현장마다 많아야 둘). 가운데에 경찰이 서면 두 무리의 사기가 초당 0.01, 경찰 : 서 있는 사람 ≥ 1 : 2 면 0.01 더 깎인다(사기 0.2 아래면 지금 규칙으로 투항).
 * 사기가 0.25 아래로 처음 내려간 사람은 30% 로 흩어져 달아난다(fleeAt). 흐름 brawl:<사건>
 */
registerRule((sim, s, I) => {
  if (s.kind !== 'disturb' || s.variant !== 'brawl' || I.phase === 'closed') return;
  const up = (h: Hostile): boolean => h.state === 'hold' || h.state === 'fight';
  const A = s.hostiles.filter((h) => h.group === 'A' && up(h)), B = s.hostiles.filter((h) => h.group === 'B' && up(h));
  if (!A.length && !B.length) return;
  const cx = (l: Hostile[]): number => l.reduce((m, h) => m + h.x, 0) / l.length, cy = (l: Hostile[]): number => l.reduce((m, h) => m + h.y, 0) / l.length;
  const all = A.concat(B);
  const mx = A.length && B.length ? (cx(A) + cx(B)) / 2 : cx(all), my = A.length && B.length ? (cy(A) + cy(B)) / 2 : cy(all);
  const cops = copsNear(sim, s, mx, my, DISTURB.midR);
  const rng = disturbRng(sim, s, I, 'brawl');
  if (sim.tick % 5 === 0 && cops > 0) {
    const cut = DISTURB.calm * (cops * 2 >= all.length ? 2 : 1);
    for (const h of all) {
      h.morale = Math.max(0, h.morale - cut);
      if (h.morale < DISTURB.scatterAt && !SCATTERED.has(h)) { SCATTERED.add(h); if (rng.chance(DISTURB.scatterP)) h.fleeAt = sim.t; }
    }
  }
  if (sim.tick % (DISTURB.brawlEvery * 5) !== 0 || !A.length || !B.length || cops > 0) return;
  const v = all[rng.int(0, all.length - 1)];
  const ev = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 1, truth: s.arrivedAt < 0, text: `싸움이 이어져 ${josa(v.label, '이/가')} 얻어맞았습니다.` });
  hurtHostile(sim, s, I, v, rng.range(DISTURB.brawlHurt[0], DISTURB.brawlHurt[1]), 'blunt', { ev });
  if (rng.chance(DISTURB.bystanderP) && (BYSTANDERS.get(s) ?? 0) < DISTURB.bystanderMax) {
    BYSTANDERS.set(s, (BYSTANDERS.get(s) ?? 0) + 1);
    const x = Math.max(1, Math.min(s.w - 2, Math.round(mx + rng.range(-2, 2)))), y = Math.max(12, Math.min(14, Math.round(my + rng.range(-1, 1))));
    const c = addCas(s, x, y, 'mobile', 100, 0, 0.1);      // 휘말린 구경꾼은 걸어서 비켜 선다 (가볍게 다침 — 처치만)
    const pev = raiseProblem(sim, I, 'ESCALATION', '싸움에 휘말린 구경꾼이 다침', { role: 'SYSTEM', actor: '현장', imp: 2, truth: s.arrivedAt < 0, causes: [ev], text: `싸움에 휘말린 구경꾼 ${josa(c.label, '이/가')} 다쳤습니다.` }, false);
    hurtCas(sim, s, I, c, rng.range(10, 20), 'blunt', { ev: pev });
  }
});

/**
 * (§4.4 snatch) 날치기: 처음부터 골목의 숨을 자리에 숨어 있던 용의자(현장 생성기 — hideUntil −1)가 나갈 시각을 첫 부대가 닿은 뒤 60~140초로 정한다(fleeAt 도 같은 값 —
 * 그 시각이 지나면 지금의 용의자 규칙이 막히지 않은 출구로 달아난다). 들키면 그때 내달린다(도보 추격). 흐름 snatch:<사건>
 */
registerRule((sim, s, I) => {
  if (s.kind !== 'disturb' || s.variant !== 'snatch' || I.phase === 'closed' || s.arrivedAt < 0) return;
  for (const h of s.hostiles) {
    if (h.hideUntil === -1) {
      const v = s.arrivedAt + disturbRng(sim, s, I, 'snatch').range(DISTURB.hide[0], DISTURB.hide[1]);
      h.hideUntil = v; h.fleeAt = v;
    }
    // 들켰다(숨은 자리에서 대원에게 보였다): 절반은 곧바로 막히지 않은 출구로 내달린다 — 도보 추격 (지금의 용의자 규칙이 대원이 3칸 밖일 때 달아난다). 나머지는 그 자리에서 버틴다
    if (!h.hidden && h.state === 'hold' && h.fleeAt > sim.t && !BOLTED.has(h)) { BOLTED.add(h); if (disturbRng(sim, s, I, 'snatch').chance(DISTURB.boltP)) h.fleeAt = sim.t; }
  }
});

/** 들켜서 내달리기로 한 날치기 용의자 */
const BOLTED = new WeakSet<Hostile>();
/** 길목에 막혀 길을 바꾼 시각 (용의자마다 — 3초에 한 번만) */
const CHOKE_AT = new WeakMap<Hostile, number>();
/**
 * (§4.4 chokeRule) 길목 지키기: 달아나는 용의자가 향하는 출구 1.5칸 안에 활동 중인 경찰이 서 있으면 막히지 않은 다른 출구로 길을 바꾸고,
 * 모든 출구가 막혀 있으면 멈춰 서고 사기가 0.15 로 떨어진다(곧 투항 — 지금 규칙). 난수 없음
 */
registerRule((sim, s, I) => {
  if (s.kind !== 'disturb' || I.phase === 'closed' || sim.tick % 5 !== 0) return;
  for (const h of s.hostiles) {
    if (h.state !== 'flee' || !h.path || !h.path.length) continue;
    if (sim.t - (CHOKE_AT.get(h) ?? -99) < 3) continue;
    const end = h.path[h.path.length - 1], ex = end % s.w, ey = (end / s.w) | 0;
    let k = -1, bd = Infinity;
    for (let q = 0; q < s.exits.length; q++) { const d = dist(s.exits[q].x, s.exits[q].y, ex, ey); if (d < bd) { bd = d; k = q; } }
    if (k < 0) continue;
    const blocked = (q: number): boolean => copsNear(sim, s, s.exits[q].x, s.exits[q].y, DISTURB.chokeR) > 0;
    if (!blocked(k)) continue;
    CHOKE_AT.set(h, sim.t);
    let alt = -1, ad = Infinity;
    for (let q = 0; q < s.exits.length; q++) { if (q === k || blocked(q)) continue; const d = dist(s.exits[q].x, s.exits[q].y, h.x, h.y); if (d < ad) { ad = d; alt = q; } }
    if (alt >= 0) startFlee(sim, s, h, alt);
    else {
      h.state = 'hold'; h.path = null; h.morale = Math.min(h.morale, 0.15); h.fleeAt = Infinity;
      emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 1, text: `${josa(h.label, '이/가')} 길목마다 경찰이 서 있어 멈춰 섰습니다.` });
    }
  }
});

// ───────────────────────── 치안 disturb (§4.4 — 단계 6b) ─────────────────────────
/** 수거책 잠복의 상수: 제복을 알아보는 거리 8칸(시야선) · 사복(형사)은 2칸 · 돈을 받는 6초 · 피해자 곁(이만큼이면 닿았다) · 걷는 빠르기(칸/초 — 태연히 걷는다, 달아날 때는 지금의 도주) */
export const SCAM = { seeUniform: 8, seeDetective: 2, take: 6, near: 1.6, walk: 1.2 };
/** 수거책마다의 단계 (0 약속 자리로 걷는다 · 1 돈을 받는다 · 2 돈을 받아 떠난다 · 3 알아보고 달아났다)와 걷는 길 — 용의자 객체의 모양을 바꾸지 않으려고 WeakMap.
 *  걷는 길은 h.path 에 두지 않는다(지금의 용의자 규칙이 h.path 를 2.3칸/초로 옮긴다 — 태연히 걷는 사람은 그보다 느리다) */
const SCAM_ST = new WeakMap<Hostile, { phase: number; t: number; path: number[] | null; i: number }>();
/** 수거책이 경찰을 알아보는가 (세계 쪽 — 진실의 자리·역할): 8칸 안·시야선의 활동 중인 경찰 가운데 제복은 그대로, 사복(형사 역할)은 2칸 안일 때만 (설계서 §4.4 "사복" — hazards.hostileSees 는 고치지 않는다) */
function scamSpots(sim: Sim, s: Scene, h: Hostile): FieldAgent | null {
  for (const a of s.agents) {
    if (a.status !== 'active' || a.aloft) continue;
    const r = sim.responders[a.rid];
    if (r.dept !== 'police') continue;
    const d = dist(a.x, a.y, h.x, h.y);
    if (d > SCAM.seeUniform || (r.role === 'detective' && d > SCAM.seeDetective)) continue;
    if (los(s, h.x, h.y, a.x, a.y)) return a;
  }
  return null;
}
/** 걷는 길을 따라 한 걸음 (기절한 동안은 서 있다). 끝에 닿았으면 참 */
function scamWalk(sim: Sim, h: Hostile, st: { path: number[] | null; i: number }, w: number): boolean {
  if (!st.path || st.i >= st.path.length) return true;
  if (sim.t < h.stunUntil) return false;
  const ti = st.path[st.i], tx = ti % w, ty = (ti / w) | 0;
  const dd = dist(h.x, h.y, tx, ty), step = SCAM.walk * sim.dt;
  if (dd <= step) { h.x = tx; h.y = ty; st.i++; } else { h.x += ((tx - h.x) / dd) * step; h.y += ((ty - h.y) / dd) * step; }
  if (dd > 0.01) h.facing = Math.atan2(ty - h.y, tx - h.x);
  return st.i >= st.path.length;
}
/**
 * (§4.4 scam) 수거책 잠복: 약속 시각(s.kinds.arriveAt — 진실)에 수거책을 만든다(s.hostiles 끝 — 그 전에는 지각·용의자 행동·판정·신고자가 그 사람을 보지 않는다).
 * 동쪽 출구에서 피해자에게 걷는 동안 경찰을 알아보면(제복 8칸 · 사복 2칸 — scamSpots) 돌아서 들어온 출구로 달아난다(startFlee — 도보 추격). 피해자에게 닿으면 6초 동안 돈을 받고
 * 들어온 출구로 걸어 나간다 — 끝까지 나가면 '돈을 받아 떠남'(SUSPECT_FLED). 태연히 걷는다(1.2칸/초 — 이 규칙이 옮긴다). 난수 없음
 */
registerRule((sim, s, I) => {
  if (s.kind !== 'disturb' || s.variant !== 'scam' || I.phase === 'closed' || !s.kinds || s.kinds.arriveAt === undefined) return;
  const k = s.kinds;
  const exitK = Math.max(0, Math.min(s.exits.length - 1, k.scamExit ?? 1));
  if (s.hostiles.length === 0) {
    if (sim.t < k.arriveAt!) return;
    const e = s.exits[exitK];
    const v = s.props.find((p) => p.kind === 'witness' && p.skin === 'victim');
    const h = addHostile(s, e.x, e.y, 'none', 0.2, 0.3, false, Infinity);
    h.label = '수거책'; h.morale = 0.45; h.facing = Math.PI;
    const path = v ? astar(s, h.x, h.y, v.x, v.y, 1, truthCost(s)) : null;
    SCAM_ST.set(h, { phase: 0, t: sim.t, path: path && path.length ? path : null, i: 0 });
    emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 1, truth: true, text: '수거책으로 보이는 사람이 약속 장소로 걸어옵니다.' });
    return;
  }
  for (const h of s.hostiles) {
    const st = SCAM_ST.get(h);
    if (!st || h.state !== 'hold') continue;
    if (st.phase === 0) {
      const cop = scamSpots(sim, s, h);
      if (cop) {
        st.phase = 3; k.scamFled = true;
        emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 2, truth: true, text: `${josa(h.label, '이/가')} ${sim.responders[cop.rid].role === 'detective' ? '잠복한 형사를' : '제복 경찰을'} 알아보고 돌아서 달아납니다.` });
        startFlee(sim, s, h, exitK);
        continue;
      }
      if (scamWalk(sim, h, st, s.w)) {
        st.phase = 1; st.t = sim.t; st.path = null;
        emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 1, truth: true, text: `${josa(h.label, '이/가')} 피해자에게서 돈 봉투를 받고 있습니다.` });
        // (§5.16) 돈을 건네받는 순간을 지켜보던 경찰(13칸 안·시야선)은 그 자리를 곧바로 알린다 — 자리만 바뀐 사실은 보고되지 않아(agents.significant) 지휘관이 수거책을 처음 본 출구에 있다고 믿은 채 검거를 내지 않았다
        for (const a of s.agents) if (a.status === 'active' && !a.aloft && sim.responders[a.rid].dept === 'police' && dist(a.x, a.y, h.x, h.y) <= 13 && los(s, a.x, a.y, h.x, h.y)) learn(sim, a, hosFact(sim, s, h, resp(sim, a).name, dist(a.x, a.y, h.x, h.y)), true, true);
      }
    } else if (st.phase === 1) {
      if (sim.t - st.t < SCAM.take) continue;
      st.phase = 2;
      const e = s.exits[exitK];
      const path = astar(s, h.x, h.y, e.x, e.y, 0, truthCost(s));
      st.path = path && path.length ? path : null; st.i = 0;
      emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 1, truth: true, text: `돈을 받은 ${josa(h.label, '이/가')} 자리를 뜹니다.` });
    } else if (st.phase === 2 && scamWalk(sim, h, st, s.w)) {
      h.state = 'escaped'; h.path = null;
      raiseProblem(sim, I, 'SUSPECT_FLED', '수거책이 돈을 받아 떠남', { role: 'SYSTEM', actor: '현장', imp: 3, truth: s.arrivedAt < 0, text: `${josa(h.label, '이/가')} 돈을 받아 현장을 떠났습니다.` }, false);
    }
  }
});
