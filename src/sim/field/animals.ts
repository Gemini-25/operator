// 동물의 움직임·흥분·돌진·출구 (docs/specs/N8-incident-kinds.md §4.3 · §5.8 — 단계 5). 진실 쪽 — hazards.ts 와 같은 자격.
// 동물은 용의자(Hostile)를 빌리지 않는다: s.hostiles 를 도는 협상·검거·교전·판정이 따라붙지 않게 Scene.animals 에 따로 둔다.
// 부르는 곳은 field/rules/kinds.ts 의 animalRule 하나 (동물 현장마다 매 틱). 난수는 부르는 쪽이 준다 — 동물마다 흐름 animal:<사건>:<동물>.
// 판단 쪽은 이 파일을 읽지 않는다 — 대원은 agents.perceive 가 남기는 'ani' 사실(AniBelief)로만 안다.
import type { Sim } from '../engine';
import { emit } from '../events';
import type { Rng } from '../rng';
import type { Animal, Incident, Scene } from '../types';
import { dist, josa } from '../util';
import { astar, staticPass, truthCost } from './grid';

/** 종류별 상수 (설계서 §4.3 의 시작값): 걸음·달음(칸/초) · 알아채는 거리 · 흥분 오름(초당, 그 거리 안의 사람마다) · 돌진 문턱 · 돌진 피해 · 마취가 듣기까지(초) · 숨는가 */
export interface AnimalDef { walk: number; run: number; alertR: number; agitRate: number; chargeAt: number; hurt: [number, number]; sedateAt: [number, number]; hide: boolean; name: string }
export const ANIMAL: Record<Animal['kind'], AnimalDef> = {
  boar: { walk: 0.8, run: 2.0, alertR: 4, agitRate: 0.05, chargeAt: 0.85, hurt: [15, 30], sedateAt: [20, 35], hide: false, name: '멧돼지' },
  dog: { walk: 1.0, run: 2.6, alertR: 3, agitRate: 0.04, chargeAt: 0.7, hurt: [8, 18], sedateAt: [15, 25], hide: true, name: '개' },
  cow: { walk: 0.6, run: 1.6, alertR: 3, agitRate: 0.02, chargeAt: 0.95, hurt: [20, 35], sedateAt: [20, 30], hide: false, name: '소' },
  pig: { walk: 0.7, run: 1.8, alertR: 3, agitRate: 0.03, chargeAt: 0.95, hurt: [10, 20], sedateAt: [15, 25], hide: false, name: '돼지' },
};
/** 내달림(flee)이 멈추는 흥분 */
export const FLEE_END = 0.5;
/** 가축의 흥분이 오르는 거리 (칸 — 이보다 가까운 사람마다) */
export const LIVE_CLOSE = 2;
/** 흥분한 황소의 돌진 문턱 (가축 탈출의 10%) */
export const BULL_CHARGE = 0.75;
/** 흥분이 이만큼이면 출구로 내달린다 · 흥분이 식는 빠르기(초당) · 돌진이 이어지는 상한(초) · 숨은 개가 자리를 떠나는 시각(숨은 뒤 초) */
export const ANI = { panic: 0.92, cool: 0.03, chargeMax: 4, hideLeave: [90, 150] as [number, number], exitR: 0.9, chargeR: 2.5, hitR: 0.8 };

/** 동물 하나의 움직임 상태 — 동물 객체의 모양을 바꾸지 않으려고 WeakMap (되감기는 Sim 을 새로 만든다) */
interface AniRun { roamAt: number; goalAt: number; goal: number; sedAt: number; hidAt: number; leaveAt: number; chargeT: number; chargeTo: number; cool: number }
const RUN = new WeakMap<Animal, AniRun>();
function runOf(a: Animal): AniRun {
  let r = RUN.get(a);
  if (!r) { r = { roamAt: 0, goalAt: -1, goal: -1, sedAt: Infinity, hidAt: -1, leaveAt: Infinity, chargeT: 0, chargeTo: -1, cool: 0 }; RUN.set(a, r); }
  return r;
}
/** 마취 화살이 맞았다 (실행부 executor 의 capture 가 부른다): 이 시각에 잠든다. 이미 맞은 동물은 앞의 시각을 지킨다 */
export function dartHit(sim: Sim, a: Animal, rng: Rng): void {
  const r = runOf(a), d = ANIMAL[a.kind];
  if (r.sedAt < Infinity) return;
  r.sedAt = sim.t + rng.range(d.sedateAt[0], d.sedateAt[1]);
  a.sedate = 0.01;
}
/** 마취가 들기까지 남은 몫 0..1 (그림·진행 막대 — 읽기만) */
export function sedateLeft(sim: Sim, a: Animal): number { const r = RUN.get(a); if (!r || r.sedAt === Infinity) return 1; return Math.max(0, r.sedAt - sim.t); }

/** 사람 하나 (대원·구조 대상) — 동물이 알아채는 대상 */
interface Person { x: number; y: number; agent: number; cas: number }
function peopleOf(s: Scene): Person[] {
  const out: Person[] = [];
  for (let k = 0; k < s.agents.length; k++) { const b = s.agents[k]; if (b.status === 'active' && !b.aloft) out.push({ x: b.x, y: b.y, agent: k, cas: -1 }); }
  for (let k = 0; k < s.casualties.length; k++) { const c = s.casualties[k]; if (!c.dead && c.where === 'scene' && c.inVehicle === null) out.push({ x: c.x, y: c.y, agent: -1, cas: k }); }
  return out;
}
const tileOfXY = (s: Scene, x: number, y: number): number => Math.round(y) * s.w + Math.round(x);

/**
 * 도망칠 곳 고르기: 출구(그리고 가축이 차분할 때는 우리) 가운데 가장 가까운 사람에게서 멀고, 출구 곁(2칸)에 대원이 서 있지 않은 곳. 우리는 가축이 가고 싶어 하는 곳(+3).
 * panic 이 아니면 출구를 고르지 않고(가축의 우리는 고른다) 사람에게서 3칸 떨어진 곳으로 물러선다. 돌려주는 값 = 칸 번호
 */
function fleeGoal(s: Scene, a: Animal, ppl: Person[], panic: boolean): number {
  let nx = -1, ny = -1, nd = Infinity;
  for (const p of ppl) { const d = dist(p.x, p.y, a.x, a.y); if (d < nd) { nd = d; nx = p.x; ny = p.y; } }
  let best = -1, bs = -Infinity;
  const consider = (x: number, y: number, bonus: number): void => {
    const i = tileOfXY(s, x, y);
    if (i < 0 || i >= s.tiles.length || !staticPass(s.tiles[i]) || s.propAt[i] >= 0) return;
    let guard = 0;
    for (const b of s.agents) if (b.status === 'active' && !b.aloft && dist(b.x, b.y, x, y) <= 2) guard++;
    const sc = (nx < 0 ? 10 : dist(nx, ny, x, y)) - 0.3 * dist(a.x, a.y, x, y) - 20 * guard + bonus;
    if (sc > bs) { bs = sc; best = i; }
  };
  const live = a.kind === 'cow' || a.kind === 'pig';
  const pen = live && s.kinds && s.kinds.pen !== undefined ? s.regions[s.kinds.pen] : undefined;
  if (pen && !panic) consider(Math.round(pen.cx), Math.round(pen.cy), 3);      // 놀라 내달리는 가축은 우리를 찾지 않는다 — 차분히 몰릴 때만 우리 쪽으로
  if (panic) for (const e of s.exits) consider(e.x, e.y, 0);
  else if (nx >= 0) {
    // 물러서기: 가장 가까운 사람의 반대쪽 3칸 (여덟 방향 가운데 걸을 수 있는 곳)
    for (let k = 0; k < 8; k++) { const ang = (k / 8) * Math.PI * 2; consider(a.x + Math.cos(ang) * 3, a.y + Math.sin(ang) * 3, 0); }
  }
  return best;
}
/** 숨을 자리: 개가 숨는 칸(s.kinds.hides) 가운데 가장 가까운 사람에게서 가장 먼 곳 */
function hideGoal(s: Scene, a: Animal, ppl: Person[]): number {
  const hides = s.kinds?.hides;
  if (!hides || !hides.length) return -1;
  let best = -1, bs = -Infinity;
  for (const i of hides) {
    const x = i % s.w, y = (i / s.w) | 0;
    let nd = Infinity; for (const p of ppl) nd = Math.min(nd, dist(p.x, p.y, x, y));
    const sc = nd - 0.2 * dist(a.x, a.y, x, y);
    if (sc > bs) { bs = sc; best = i; }
  }
  return best;
}
/** 한 걸음 (경로를 따라 speed × dt). 경로가 끝났으면 거짓 */
function stepAlong(s: Scene, a: Animal, speed: number, dt: number): boolean {
  if (!a.path || a.pathI >= a.path.length) return false;
  const ti = a.path[a.pathI];
  if (!staticPass(s.tiles[ti]) || s.propAt[ti] >= 0) { a.path = null; return false; }
  const tx = ti % s.w, ty = (ti / s.w) | 0;
  const dd = dist(a.x, a.y, tx, ty), step = speed * dt;
  if (dd > 0.01) a.facing = Math.atan2(ty - a.y, tx - a.x);
  if (dd <= step) { a.x = tx; a.y = ty; a.pathI++; } else { a.x += ((tx - a.x) / dd) * step; a.y += ((ty - a.y) / dd) * step; }
  return true;
}
function goTo(s: Scene, a: Animal, goal: number): void {
  a.path = astar(s, a.x, a.y, goal % s.w, (goal / s.w) | 0, 0, truthCost(s));
  a.pathI = 0;
}

export interface AnimalEvent { kind: 'gone' | 'charge' | 'sedated'; a: Animal; exit: number; victim: Person | null; ev: number }
/**
 * 동물 현장 한 틱. 돌려주는 값 = 이 틱에 일어난 일(출구로 나감 · 사람을 들이받음 · 잠듦) — 부르는 규칙(rules/kinds.ts)이 피해·기록·강제 보고를 붙인다.
 * 상태: roam(배회) → 사람이 알아채는 거리 안이면 흥분이 오르고 물러선다 → 흥분이 돌진 문턱을 넘고 2.5칸 안이면 돌진 → 닿으면 피해, 그 뒤 물러선다 →
 * 흥분이 0.92 를 넘으면 출구로 내달려 나간다(gone — 그 출구의 종류). 개는 사람을 피해 숨을 자리(s.kinds.hides)로 가 숨고(hide), 90~150초 뒤 자리를 떠난다.
 * 마취 화살이 맞으면 20~35초 뒤 잠든다(sedated — 멈춤). 가축은 우리 구역(s.kinds.pen)에 들어가면 잡힌 것(caught)
 */
export function tickAnimals(sim: Sim, s: Scene, I: Incident, rngOf: (a: Animal) => Rng): AnimalEvent[] {
  const list = s.animals;
  const out: AnimalEvent[] = [];
  if (!list || !list.length) return out;
  const dt = sim.dt;
  const ppl = peopleOf(s);
  for (const a of list) {
    a.px = a.x; a.py = a.y;
    if (a.state === 'caught' || a.state === 'gone' || a.state === 'sedated') continue;
    const d = ANIMAL[a.kind], r = runOf(a), rng = rngOf(a);
    // 마취
    if (r.sedAt < Infinity) {
      a.sedate = Math.min(1, 1 - (r.sedAt - sim.t) / (d.sedateAt[1] + 1));
      if (sim.t >= r.sedAt) {
        a.state = 'sedated'; a.sedate = 1; a.path = null;
        const ev = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 1, truth: true, text: `마취가 들어 ${josa(a.label, '이/가')} 쓰러져 잠들었습니다.` });
        out.push({ kind: 'sedated', a, exit: -1, victim: null, ev });
        continue;
      }
    }
    const slow = r.sedAt < Infinity ? 0.5 : 1;
    // 우리 (가축)
    if (s.kinds && s.kinds.pen !== undefined && s.region[tileOfXY(s, a.x, a.y)] === s.kinds.pen && (a.kind === 'cow' || a.kind === 'pig')) {
      a.state = 'caught'; a.path = null;
      const ev = emit(sim, { inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'action', imp: 1, truth: true, text: `${josa(a.label, '이/가')} 우리 안으로 들어갔습니다.` });
      out.push({ kind: 'sedated', a, exit: -1, victim: null, ev });
      continue;
    }
    // 흥분
    // 가축(소·돼지)은 알아채는 거리 안의 사람에게서 걸어서 물러서고(몰이), 흥분은 바싹 다가온 사람(LIVE_CLOSE 2칸)에게서만 오른다 — 뒤에서 2.5칸 떨어져 모는 사람은 흥분시키지 않는다
    const live = a.kind === 'cow' || a.kind === 'pig';
    let near = 0, close = 0, nd = Infinity, np: Person | null = null;
    for (const p of ppl) { const dd = dist(p.x, p.y, a.x, a.y); if (dd < d.alertR) near++; if (dd < LIVE_CLOSE) close++; if (dd < nd) { nd = dd; np = p; } }
    const agitBy = live ? close : near;
    if (agitBy > 0 && a.state !== 'hide') a.agit = Math.min(1, a.agit + d.agitRate * agitBy * dt);
    else if (a.state === 'hide' && nd < 2.5) a.agit = Math.min(1, a.agit + d.agitRate * 2 * dt);
    else a.agit = Math.max(0, a.agit - ANI.cool * dt);
    if (r.cool > 0) r.cool -= dt;
    const chargeAt = a.bull ? BULL_CHARGE : d.chargeAt;
    // 출구에 닿았다
    for (let k = 0; k < s.exits.length; k++) {
      const e = s.exits[k];
      if (dist(e.x, e.y, a.x, a.y) > ANI.exitR || (a.state !== 'flee' && a.state !== 'charge')) continue;
      a.state = 'gone'; a.via = s.exitKind ? s.exitKind[k] ?? 'road' : 'road'; a.path = null;
      out.push({ kind: 'gone', a, exit: k, victim: null, ev: -1 });
      break;
    }
    if (a.state === 'gone') continue;
    // 돌진
    if (a.state === 'charge') {
      r.chargeT += dt;
      const tp = r.chargeTo >= 0 ? ppl.find((p) => (p.agent >= 0 ? p.agent : 1000 + p.cas) === r.chargeTo) : undefined;
      if (!tp || r.chargeT > ANI.chargeMax) { a.state = 'alert'; a.path = null; r.cool = 6; continue; }
      const dd = dist(tp.x, tp.y, a.x, a.y);
      if (dd <= ANI.hitR) {
        a.agit = Math.max(0, a.agit - 0.4); a.state = 'alert'; a.path = null; r.cool = 8;
        out.push({ kind: 'charge', a, exit: -1, victim: tp, ev: -1 });
        continue;
      }
      if (!a.path || a.pathI >= a.path.length || sim.tick % 5 === 0) { a.path = astar(s, a.x, a.y, Math.round(tp.x), Math.round(tp.y), 0.5, truthCost(s)); a.pathI = 0; }
      stepAlong(s, a, d.run * slow, dt);
      continue;
    }
    if (np && a.agit >= chargeAt && nd < ANI.chargeR && r.cool <= 0 && r.sedAt === Infinity) {
      a.state = 'charge'; r.chargeT = 0; r.chargeTo = np.agent >= 0 ? np.agent : 1000 + np.cas; a.path = null;
      continue;
    }
    // 숨은 개
    if (a.state === 'hide') {
      if (sim.t >= r.leaveAt) { a.agit = 1; a.state = 'flee'; r.goalAt = -1; }
      else if (a.agit < 0.5) continue;
      else { a.state = 'alert'; r.goalAt = -1; }
    }
    const panic = a.agit >= ANI.panic;
    const fleeing = a.state === 'flee' && a.agit >= FLEE_END;      // 내달리던 동물도 흥분이 가라앉으면(0.5 아래) 멈춘다 — 막힌 출구 사이에서 영영 내달리지 않게
    if (panic || (near > 0 && (a.agit >= 0.3 || live)) || fleeing) {
      // 흥분: 물러서거나(사람의 반대쪽) 내달린다(출구) — 개는 숨을 자리로
      const hideNow = d.hide && !panic && r.hidAt < 0;
      if (sim.t >= r.goalAt || !a.path || a.pathI >= a.path.length) {
        const g = hideNow ? hideGoal(s, a, ppl) : fleeGoal(s, a, ppl, panic || fleeing);
        r.goal = g; r.goalAt = sim.t + 2;
        if (g >= 0) goTo(s, a, g);
      }
      a.state = panic || fleeing ? 'flee' : 'alert';
      const moved = stepAlong(s, a, (panic || fleeing ? d.run : d.walk) * slow, dt);
      if (!moved && hideNow && r.goal >= 0 && dist(a.x, a.y, r.goal % s.w, (r.goal / s.w) | 0) <= 0.6) {
        a.state = 'hide'; r.hidAt = sim.t; r.leaveAt = sim.t + rng.range(ANI.hideLeave[0], ANI.hideLeave[1]); a.agit = Math.min(a.agit, 0.35);
      }
      continue;
    }
    // 배회
    if (a.state !== 'roam') { a.state = 'roam'; a.path = null; }
    if (sim.t >= r.roamAt) {
      r.roamAt = sim.t + rng.range(3, 6);
      const tx = Math.round(a.x + rng.range(-3, 3)), ty = Math.round(a.y + rng.range(-3, 3));
      const i = tileOfXY(s, Math.max(1, Math.min(s.w - 2, tx)), Math.max(1, Math.min(s.h - 2, ty)));
      if (staticPass(s.tiles[i]) && s.propAt[i] < 0 && !nearExit(s, i)) goTo(s, a, i);
    }
    stepAlong(s, a, d.walk * 0.6 * slow, dt);
  }
  return out;
}
/** 출구 3칸 안의 칸 (배회는 출구로 가지 않는다 — 나가는 것은 내달릴 때뿐) */
function nearExit(s: Scene, i: number): boolean {
  const x = i % s.w, y = (i / s.w) | 0;
  for (const e of s.exits) if (dist(e.x, e.y, x, y) < 3) return true;
  return false;
}

/** 벌집의 상수 (§4.3 animal/hive): 반경 · 떼어 내는 동안의 반경과 그 시간 · 쏘이는 간격 · 한 번의 피해 · 급변 */
export const HIVE = { r: 3, wideR: 4.5, wideT: 20, every: 3, sting: [2, 5] as [number, number], severeAfter: 3, severeP: 0.15, severeBleed: 0.3 };
/** 지금 벌집의 위험 반경 (떼어 내기 시작한 뒤 20초 동안 넓다) */
export function hiveR(sim: Sim, s: Scene): number { const k = s.kinds; return k && (k.hiveWide ?? -1) >= 0 && sim.t - k.hiveWide! < HIVE.wideT ? HIVE.wideR : HIVE.r; }
