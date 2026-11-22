// 사건 종류 다양화 ① 일상 사건의 세계 규칙 (docs/specs/N8-incident-kinds.md §4·§5.16·§5.17) — 진실을 읽고 바꾼다 (hazards.ts 와 같은 자격).
// registerRule((sim, s, I) => void) 로 등록한다. 모든 규칙은 첫 줄에서 자기 현장이 아니면 돌아간다(다른 사건의 결과를 바꾸지 않는다). 난수를 쓰는 규칙은 자기 흐름만.
//
// 단계 3: 오인 신고(medical/false)의 잠든 사람 — 대원이 곁에 오면 깨어나 걸어서 귀가한다.
import { hasKit } from '../../crews';
import type { Sim } from '../../engine';
import { emit, markRecovered, raiseProblem } from '../../events';
import type { Rng } from '../../rng';
import { T } from '../../types';
import type { Fact, FieldAgent, Incident, Prop, Scene } from '../../types';
import { dist, josa } from '../../util';
import { mkFact } from '../beliefs';
import { hurtCas, hurtResponder } from '../injury';
import { casFact, learn, resp } from '../agents';
import { registerRule, registerVerdict } from '../sceneRegistry';
import { staticPass } from '../grid';
import { addCas, addProp } from '../kit';
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
