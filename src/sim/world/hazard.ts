// 초과 위험 과정 — 상태가 사건을 낳는 하나뿐인 길 (설계서 I1 §3.6a).
//
// 생각: 평소 생성기(sim.rngGen)는 그대로 둔다. 세계 상태가 평소 수준보다 올린 만큼의 초과 위험률 λ(t)(초당 기대 사건 수)를
// 대상(구간·건물)마다 따로 적분하고(H = ∫λ dt), 대상마다 한 번 뽑아 둔 문턱 E = −ln(1 − u) 를 넘으면 사건이 난다.
// 위험률 λ(t) 의 비균질 푸아송 과정을 역변환으로 뽑는 것과 같다 — "혼잡할수록 사고가 잦다"와 같은 말이고, 틱마다 주사위가 없다.
// 한 번의 충격(폭발의 불티, 정전 순간 운행 중이던 승강기)도 같은 칸에 H 를 더해 같은 문턱과 견준다(hazardImpulse).
//
// 이 파일에는 법칙이 없다(등록이 없는 파일 — §3.4). 법칙은 world/laws/*.ts 가 registerHazard 로 끼워 넣고 world/laws/index.ts 가 모은다
// (engine.ts 가 그 파일을 import 한다 — import 순서 = 등록 순서 = 결과). 법칙이 하나도 없으면 tickHazards 는 첫 줄에서 돌아온다 — 결과가 바뀌지 않는다.
//
// 지키는 것:
//  · 법칙은 원인을 모른다 — scan 은 상태의 값만 읽어 몫(HzPart)을 내놓는다. 원인(ev·inc)은 귀속에만 쓴다: 문턱을 넘는 **그 순간의** 몫으로 cause·causes·parent 를 정한다.
//  · 재현성 — 문턱의 흐름은 hz:<법칙>:<대상>:<n>(once 법칙은 번호 없음), 사건의 흐름은 hz-spawn:<법칙>:<대상>:<n>. 이름에 경로에 따라 달라지는 것(시각·시도 횟수·전역 순번)이 없다:
//    같은 시드에서 윗 원인을 없애면 그 대상에서 문턱을 넘는 때가 늦어지거나 없어질 뿐이다(개입 시험 — §3.6a 끝).
//  · 유계 — hazardRoom: 교대 끝 150초 · 전체 상한 CSQ_SPAWN_CAP 과 법칙별 상한 · 사슬 3건 · 한 뿌리의 가지 2 · 한 교대 6건(부모 없는 것 3). 사용자 결정의 상한(chain.ts)은 그대로다.
//  · 일어나지 않은 일은 기록(emit)하지 않는다 — 버린 것은 gen.dropped 에만 남는다. 문턱을 넘지 않은 법칙은 기록도 난수도 남기지 않는다.
//  · 원인 없는 인과 사건은 만들지 않는다 — 모든 몫의 기록이 없으면 사건 없이 world.hz.holes 만 는다(장부의 구멍 — 0 이어야 한다).
// 진실 쪽이다(세계 규칙과 같은 자격). 판단(관제·지휘관·대원)은 world.hz·Incident.hz 를 읽지 않는다 (§3.8).
// incidents.ts 는 형만 가져온다(그 파일의 함수를 import 하면 순환이 생긴다 — 쓸 수 있는 건물인가는 placeState().usable 로 본다).

import { CHAIN_MAX, CHAIN_SHIFT_MAX, chainDepth, chainLen, chainedInShift } from '../chain';
import type { Sim } from '../engine';
import type { ChainItem, DroppedChain, SpawnOpts } from '../incidents';
import type { HazardLawId, HzCell, HzSrc, HzWait, HzWhat } from '../types';
import { placeState } from './state';

/** 규칙·법칙이 만드는 사건의 교대당 상한 (§3.6 — 부모가 있든 없든 센다. b2 의 것을 옮겼다 — consequence.ts 가 다시 내보낸다) */
export const CSQ_SPAWN_CAP = 6;
/** 틀의 상수 (모두 첫 값): 기다리는 줄의 마감(초) · 부모·구멍을 따지는 몫의 문턱 · 부모 없는 법칙 사건의 교대 상한 · 한 뿌리의 법칙 사건 · 내력에 남기는 몫의 수 · 교대 끝 몇 초 안에는 만들지 않는가 */
export const HZ = { HOLD: 60, PARENT_SHARE: 1 / 3, ORPHAN_CAP: 3, ROOT_MAX: 2, SRC_MAX: 3, LATE: 150 };

/** 이번 주기에 한 대상의 초과를 이루는 몫 하나. rate = 초당 초과 위험 (≥ 0) · ev = 그 상태를 만든 기록(-1 = 없음) · inc = 주인 사건(-1) · ref = 관련 대상(-1) */
export interface HzPart { rate: number; ev: number; inc: number; what: HzWhat; ref: number }
export interface HazardLaw {
  id: HazardLawId; label: string;            // 'roadCrash' · '몰린 길의 사고' (보고서의 교대 요약이 label 을 쓴다)
  every: 1 | 12;                             // 1 = world tick(1초)마다 · 12 = 교통 모델이 혼잡을 다시 계산한 뒤 한 번(traffic.driftAt 이 바뀌었을 때)
  once: boolean;                             // 대상마다 교대에 한 번 — 한 번 넘은 대상은 끝이다
  cap: number;                               // 이 법칙이 만든 사건의 교대 상한 (만든 것 + 예약 + 기다리는 것)
  hold?: number;                             // 문턱을 넘고 자리를 기다리는 마감(초). 없으면 HZ.HOLD
  /** 초과가 있는 대상을 내놓는다. put 은 대상마다 한 번, parts 는 다시 쓰는 버퍼여도 된다(틀이 필요할 때 복사한다). 초과가 0 인 대상은 내놓지 않는다.
   *  충격만 받는 법칙은 scan 이 없다 */
  scan?: (sim: Sim, put: (target: number, parts: HzPart[]) => void) => void;
  /** 문턱을 넘은 대상에서 날 사건의 유형·변형·규모·자리·첫머리. null = 지금은 만들 수 없다(그 자리에 열린 사건이 있다 따위 — 기다린다).
   *  parent·cause·causes·csq·hz·rng 는 틀이 채운다. 난수를 쓰지 않는다 — 내용이 갈리는 곳은 cell.u2 로 (cell 은 넘은 그 문턱의 것이다) */
  spawn: (sim: Sim, target: number, cell: HzCell, main: HzPart, total: number) => SpawnOpts | null;
}

const LAWS: HazardLaw[] = [];
/** 법칙을 끼워 넣는다. 등록 순서 = 훑는 순서 = 결과. 같은 id 를 다시 등록하면 그 자리의 법칙을 바꾼다. 돌려주는 함수는 등록을 거둔다(시험용) */
export function registerHazard(law: HazardLaw): () => void {
  const k = LAWS.findIndex((q) => q.id === law.id);
  if (k >= 0) LAWS[k] = law; else LAWS.push(law);
  return () => { const i = LAWS.indexOf(law); if (i >= 0) LAWS.splice(i, 1); };
}
/** 등록된 법칙 (읽기 전용) */
export function hazardLaws(): readonly HazardLaw[] { return LAWS; }
/** 법칙의 이름표 (b4 의 보고서 — consequenceLabel 이 null 이면 이것을 본다) */
export function hazardLabel(id: string): string | null { for (const l of LAWS) if (l.id === id) return l.label; return null; }
function lawOf(id: string): HazardLaw | null { for (const l of LAWS) if (l.id === id) return l; return null; }

// ───────────────────────── 칸과 문턱 ─────────────────────────

/** 문턱의 흐름 — (시드, 법칙, 대상, 몇 번째)만의 함수다. 첫 값이 문턱, 둘째 값이 내용(u2) */
function draw(sim: Sim, law: HazardLaw, target: number, n: number): { thr: number; u2: number } {
  const r = sim.rng.fork('hz:' + law.id + ':' + target + (law.once ? '' : ':' + n));
  const thr = -Math.log(1 - r.next());
  return { thr, u2: r.next() };
}
function cellOf(sim: Sim, law: HazardLaw, target: number): HzCell {
  const hz = sim.world.hz;
  const tab = hz.cells[law.id] ?? (hz.cells[law.id] = {});
  let c = tab[target];
  if (!c) { const d = draw(sim, law, target, 0); c = tab[target] = { H: 0, thr: d.thr, u2: d.u2, n: 0, since: -1, done: false }; }
  return c;
}
/** 읽기 (시험·측정) — 없으면 null. 만들지 않는다 */
export function hazardCell(sim: Sim, law: HazardLawId, target: number): HzCell | null {
  return sim.world.hz.cells[law]?.[target] ?? null;
}
/** 넘은 뒤의 칸: once 법칙은 그 대상이 끝난다. 아니면 넘친 몫을 다음 문턱(n + 1 의 흐름)을 향해 남긴다 — 사건을 예약했든 버렸든 기다리게 했든 같다 */
function advance(sim: Sim, law: HazardLaw, target: number, cell: HzCell, H: number): void {
  if (law.once) { cell.H = H; cell.done = true; return; }
  cell.H = H - cell.thr; cell.n++;
  const d = draw(sim, law, target, cell.n);
  cell.thr = d.thr; cell.u2 = d.u2;
}

// ───────────────────────── 세기 (상한) ─────────────────────────

/** 몫들(큰 것부터)에서 부모를 정한다: 주인 사건이 있는 몫을 사건별로 합쳐 가장 큰 사건 — 그 합이 전체의 PARENT_SHARE 이상일 때만 (아니면 부모가 없다) */
function parentOf(parts: readonly HzSrc[], total: number): number | undefined {
  let best = -1, bw = 0;
  for (let i = 0; i < parts.length; i++) {
    const inc = parts[i].inc;
    if (inc < 0) continue;
    let seen = false;
    for (let j = 0; j < i; j++) if (parts[j].inc === inc) { seen = true; break; }
    if (seen) continue;
    let w = 0;
    for (let j = i; j < parts.length; j++) if (parts[j].inc === inc) w += parts[j].w;
    if (w > bw) { bw = w; best = inc; }      // 같으면 먼저 나온 쪽(더 큰 몫을 가진 사건)
  }
  return best >= 0 && bw >= total * HZ.PARENT_SHARE ? best : undefined;
}
function rootOf(sim: Sim, inc: number): number {
  let id = inc;
  for (let k = 0; k < 50; k++) { const J = sim.incidents[id]; if (!J || J.parent === undefined) break; id = J.parent; }
  return id;
}
/** world.log 에서 실제로 사건이 된 줄의 수 (rule 을 주면 그 규칙·법칙의 것만) */
function madeCount(sim: Sim, rule?: string): number {
  const log = sim.world.log;
  let n = 0;
  for (let k = 0; k < log.length; k++) if (log[k].made >= 0 && (rule === undefined || log[k].rule === rule)) n++;
  return n;
}
function load(sim: Sim, rule: string | undefined, skip: HzWait | null): number {
  let n = madeCount(sim, rule);
  const ch = sim.gen.chain, log = sim.world.log;
  for (let k = 0; k < ch.length; k++) { const l = ch[k].log; if (l !== undefined && log[l] && (rule === undefined || log[l].rule === rule)) n++; }
  const wt = sim.world.hz.waiting;
  for (let k = 0; k < wt.length; k++) if (wt[k] !== skip && (rule === undefined || wt[k].law === rule)) n++;
  return n;
}
/**
 * 규칙·법칙이 만든 사건의 수 (§3.6 — 세는 법은 이것 하나): world.log 가운데 실제로 사건이 된 줄(made ≥ 0) + gen.chain 에서 기다리는 예약(log 가 있는 것) + 법칙의 기다리는 줄.
 * rule 을 주면 그 규칙·법칙의 것만. 예약이 'busy'·'late'·'expired' 로 버려지면 자리가 돌아온다 (따로 세는 칸을 두지 않는다)
 */
export function ruleLoad(sim: Sim, rule?: string): number { return load(sim, rule, null); }

/**
 * 법칙 사건을 하나 더 만들 자리가 있는가 — 없으면 까닭 (위에서부터, 걸리는 첫 줄):
 *  ① 교대 끝 HZ.LATE 안 'late' ② 전체 상한·법칙별 상한 'cap' ③ 부모의 사슬이 CHAIN_MAX 'depth' ④ 그 뿌리의 법칙 사건이 ROOT_MAX 'depth'
 *  ⑤ 한 교대 6건(chain.chainedInShift — 이야기 연쇄 + 법칙 사건(부모가 있든 없든, 예약 포함) — 에 기다리는 줄을 더한 수) 'cap' ⑥ 부모 없는 법칙 사건이 ORPHAN_CAP 'cap'.
 * skip = 다시 보는 기다리는 줄 자신(자기 자리 때문에 상한에 걸려 버려지지 않게 빼고 센다)
 */
export function hazardRoom(sim: Sim, law: HazardLaw, parent: number | undefined, skip: HzWait | null = null): DroppedChain['why'] | null {
  if (sim.t >= sim.shiftLen - HZ.LATE) return 'late';
  if (load(sim, undefined, skip) >= CSQ_SPAWN_CAP || load(sim, law.id, skip) >= law.cap) return 'cap';
  const hasParent = parent !== undefined && parent >= 0 && !!sim.incidents[parent];
  if (hasParent && chainLen(sim, sim.incidents[parent!]) >= CHAIN_MAX) return 'depth';
  // 법칙 사건을 한 번 훑어 센다: 만든 것(Incident.hz) + 예약(opts.hz) + 기다리는 줄 — 부모 없는 것, 이 뿌리의 것
  const root = hasParent ? rootOf(sim, parent!) : -1;
  let orphanMade = 0, orphanWait = 0, waiting = 0, sameRoot = 0;
  for (const J of sim.incidents) {
    if (J.hz === undefined) continue;
    if (J.parent === undefined) orphanMade++;
    else if (root >= 0 && rootOf(sim, J.parent) === root) sameRoot++;
  }
  const ch = sim.gen.chain;
  for (let k = 0; k < ch.length; k++) {
    const o = ch[k].opts;
    if (o.hz === undefined) continue;
    if (o.parent === undefined) orphanMade++;
    else if (root >= 0 && rootOf(sim, o.parent) === root) sameRoot++;
  }
  const wt = sim.world.hz.waiting;
  for (let k = 0; k < wt.length; k++) {
    if (wt[k] === skip) continue;
    waiting++;
    const p = parentOf(wt[k].parts, wt[k].total);
    if (p === undefined) orphanWait++;
    else if (root >= 0 && rootOf(sim, p) === root) sameRoot++;
  }
  if (hasParent && sameRoot >= HZ.ROOT_MAX) return 'depth';
  if (chainedInShift(sim) + waiting >= CHAIN_SHIFT_MAX) return 'cap';      // chainedInShift 가 부모 없는 법칙 사건(만든 것 + 예약)도 센다 — 이야기 연쇄도 같은 수를 본다(chain.canChain)
  if (!hasParent && orphanMade + orphanWait >= HZ.ORPHAN_CAP) return 'cap';
  return null;
}

// ───────────────────────── 넘은 자리의 처리 ─────────────────────────

function openCount(sim: Sim): number { let n = 0; for (const I of sim.incidents) if (I.phase !== 'closed') n++; return n; }
function placeBusy(sim: Sim, placeId: number): boolean {
  for (const I of sim.incidents) if (I.phase !== 'closed' && I.truth.placeId === placeId) return true;
  return false;
}
function drop(sim: Sim, law: HazardLaw, why: DroppedChain['why'], opts: SpawnOpts | null, parent: number | undefined): void {
  sim.gen.dropped.push({ t: sim.t, why, type: opts?.type, variant: opts?.variant, parent, csq: law.id });      // 기록(emit)은 남기지 않는다 — 일어나지 않은 일이다
}
/** 이번 주기의 몫(버퍼여도 된다)을 내력의 꼴로 복사한다: rate 큰 순(같으면 ev 작은 순)으로만 줄 세운다 — 기록 없는 몫을 뒤로 보내지 않는다. since 는 몫마다 따로 */
function srcOf(sim: Sim, parts: readonly HzPart[], since: number): HzSrc[] {
  const out: HzSrc[] = [];
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (!(p.rate > 0)) continue;
    const et = p.ev >= 0 && sim.events[p.ev] ? sim.events[p.ev].t : -1;
    out.push({ ev: p.ev, inc: p.inc, w: p.rate, what: p.what, ref: p.ref, since: et > since ? et : since });
  }
  out.sort((a, b) => b.w - a.w || a.ev - b.ev);
  return out;
}
const asPart = (s: HzSrc): HzPart => ({ rate: s.w, ev: s.ev, inc: s.inc, what: s.what, ref: s.ref });

/**
 * 자리를 보고 예약한다 (상한은 부른 쪽이 hazardRoom 으로 먼저 본다 — 기다리는 줄을 다시 볼 때도 같은 길).
 * 돌려주는 값: 'made' 예약했다 · 'wait' 지금은 자리가 없다(부하·그 자리가 바쁘다) · 'expired' 쓸 수 없는 건물이라 버렸다.
 * cell 은 넘은 그 문턱의 것(u2·n)이다. delay = 사건까지 미루는 초 (충격의 닫힌 꼴 — 그동안 그 자리의 사정이 바뀔 수 있어 when·until 을 붙인다)
 */
function reserve(sim: Sim, law: HazardLaw, target: number, cell: HzCell, src: readonly HzSrc[], total: number, parent: number | undefined, delay: number): 'made' | 'wait' | 'expired' {
  const main = asPart(src[0]);
  if (delay <= 0 && openCount(sim) > sim.tune.maxConcurrent) return 'wait';      // 부하 — 물리가 아니라 시뮬레이션의 처리 한도다
  const opts = law.spawn(sim, target, cell, main, total);
  if (!opts) return 'wait';
  // 건물에 내는 사건의 공통 조건: 전소·전체 붕괴 건물이면 버린다(다른 건물로 옮겨 내지 않는다 — 원인은 옆 건물인데 자리는 무관한 건물인 기록이 된다), 그 건물에 열린 사건이 있으면 기다린다
  if (opts.placeId !== undefined) {
    if (placeState(sim, opts.placeId)?.usable === false) { drop(sim, law, 'expired', opts, parent); return 'expired'; }
    if (delay <= 0 && placeBusy(sim, opts.placeId)) return 'wait';
  }
  // 귀속: cause = 기록이 있는 가장 큰 몫, causes = 그 밖의 기록 있는 몫 (많아야 SRC_MAX − 1)
  let cause = -1;
  const causes: number[] = [];
  for (let i = 0; i < src.length; i++) {
    const ev = src[i].ev;
    if (ev < 0) continue;
    if (cause < 0) cause = ev;
    else if (ev !== cause && causes.indexOf(ev) < 0 && causes.length < HZ.SRC_MAX - 1) causes.push(ev);
  }
  const at = sim.t + (delay > 0 ? delay : 0);
  const log = sim.world.log.length;
  sim.world.log.push({ rule: law.id, t: sim.t, ev: cause, inc: parent ?? -1, made: -1, depth: parent !== undefined ? chainDepth(sim, parent) + 1 : 0 });
  const item: ChainItem = {
    at, log,
    opts: { ...opts, parent, cause, causes: causes.length ? causes : undefined, csq: law.id, hz: { law: law.id, target, at, src: src.slice(0, HZ.SRC_MAX) }, rng: sim.rng.fork('hz-spawn:' + law.id + ':' + target + ':' + cell.n) },
  };
  if (delay > 0) {
    const placeId = opts.placeId, snap: HzCell = { ...cell };
    item.when = (s) => law.spawn(s, target, snap, main, total) !== null && (placeId === undefined || !placeBusy(s, placeId));
    item.until = at + (law.hold ?? HZ.HOLD);
  }
  sim.gen.chain.push(item);      // tickWorld 바로 다음이 tickIncidents 라 같은 틱에 사건이 된다 (교대 끝·부하·깊이의 마지막 확인과 gen.dropped 는 거기서)
  return 'made';
}

/** 문턱을 넘었다: 귀속 → 상한 → 자리 → 예약. 모든 몫의 기록이 없으면 사건을 만들지 않는다(구멍). cell 은 넘은 그 문턱의 것 — 칸을 다음 문턱으로 넘기는 것은 부른 쪽이 한다 */
function crossed(sim: Sim, law: HazardLaw, target: number, cell: HzCell, src: HzSrc[], delay: number): void {
  const hz = sim.world.hz;
  if (!src.length) return;
  let total = 0, any = false;
  for (const s of src) { total += s.w; if (s.ev >= 0) any = true; }
  if (!any) { hz.holes++; return; }      // 원인 없는 인과 사건은 만들지 않는다 — 버린 것과 같게 끝낸다(같은 문턱에 걸려 주기마다 구멍이 늘지 않는다)
  for (const s of src) if (s.ev < 0 && s.w >= total * HZ.PARENT_SHARE) { hz.holes++; break; }      // 기록 없는 큰 몫이 낀 채 넘었다 — 사건은 만들되 내력에 ev −1 로 남는다
  const parent = parentOf(src, total);
  const why = hazardRoom(sim, law, parent);
  if (why) { drop(sim, law, why, null, parent); return; }      // 상한에 걸린 것은 미루지 않는다 — 상한은 교대 안에서 다시 열리지 않는다
  if (reserve(sim, law, target, cell, src, total, parent, delay) === 'wait') {
    // 기다리는 줄: 넘는 순간의 몫을 적어 둔다 (자리가 났을 때는 원인이 이미 사라져 있을 수 있다). 미룬 충격이면 마감도 그만큼 뒤다
    hz.waiting.push({ law: law.id, target, n: cell.n, until: sim.t + (delay > 0 ? delay : 0) + (law.hold ?? HZ.HOLD), parts: src, total });
  }
}

function isWaiting(sim: Sim, law: HazardLawId, target: number): boolean {
  const wt = sim.world.hz.waiting;
  for (let k = 0; k < wt.length; k++) if (wt[k].law === law && wt[k].target === target) return true;
  return false;
}

/** 기다리는 줄을 넣은 순서로 다시 본다 (1초마다, 법칙을 돌기 전에): 상한에 걸리면 그 까닭으로, 마감이 지나면 'expired' 로 버리고, 자리가 났으면 적어 둔 몫으로 귀속해 예약한다.
 *  그 대상의 초과가 끝났다는 것만으로는 버리지 않는다 — 위험은 넘는 순간에 실현됐고, 기다림은 시뮬레이션의 자리 문제다 */
function tickWaiting(sim: Sim): void {
  const wt = sim.world.hz.waiting;
  for (let k = 0; k < wt.length; k++) {
    const w = wt[k], law = lawOf(w.law);
    if (!law) { wt.splice(k--, 1); continue; }      // 거둔 법칙의 줄 (시험)
    const parent = parentOf(w.parts, w.total);
    const why = hazardRoom(sim, law, parent, w);      // 그 줄 자신은 빼고 센다
    if (why) { drop(sim, law, why, null, parent); wt.splice(k--, 1); continue; }
    if (sim.t >= w.until) { drop(sim, law, 'expired', null, parent); wt.splice(k--, 1); continue; }
    if (sim.t < w.until - (law.hold ?? HZ.HOLD)) continue;      // 미룬 충격: 그 시각 전에는 내지 않는다
    // 넘은 그 문턱의 칸을 다시 만든다 (once 가 아닌 법칙의 칸은 이미 다음 문턱으로 넘어가 있다 — 사건의 내용(u2)과 흐름 번호는 넘은 문턱의 것)
    const d = draw(sim, law, w.target, w.n);
    const cell: HzCell = { H: d.thr, thr: d.thr, u2: d.u2, n: w.n, since: -1, done: law.once };
    if (reserve(sim, law, w.target, cell, w.parts, w.total, parent, 0) !== 'wait') wt.splice(k--, 1);
  }
}

/**
 * 초과 위험의 한 주기 — tickWorld 의 1초 블록에서: 'tick' 규칙 다음, recoverWorld 앞.
 * ① 기다리는 줄 ② 법칙을 등록 순서로(every 12 인 법칙은 교통 모델이 혼잡을 다시 계산했을 때만, dt = 12).
 * 대상마다: 칸을 찾고(없으면 문턱을 뽑아 만든다) H += Σrate × dt. 넘으면 그 자리에서 처리한다 — 넘은 시각은 보간하지 않는다(at = sim.t).
 * 법칙이 없거나 실제로 만든 사건이 CSQ_SPAWN_CAP 에 닿았으면 첫 줄에서 돌아온다. findRoute·astar 를 부르지 않는다(모듈 버퍼)
 */
export function tickHazards(sim: Sim): void {
  if (!LAWS.length) return;
  const hz = sim.world.hz;
  if (madeCount(sim) >= CSQ_SPAWN_CAP) {
    // 교대 상한에 닿았다 — 자리는 다시 나지 않는다. 기다리던 것은 그 까닭으로 버린다
    if (hz.waiting.length) { for (const w of hz.waiting) { const law = lawOf(w.law); if (law) drop(sim, law, 'cap', null, parentOf(w.parts, w.total)); } hz.waiting.length = 0; }
    return;
  }
  if (hz.waiting.length) tickWaiting(sim);
  const driftAt = sim.traffic.driftAt, road = driftAt !== hz.roadAt;
  for (let li = 0; li < LAWS.length; li++) {
    const law = LAWS[li];
    if (!law.scan) continue;
    if (law.every === 12 && !road) continue;
    const dt = law.every;
    const prev = hz.live[law.id], seen: number[] = [];
    law.scan(sim, (target, parts) => {
      let rate = 0;
      for (let i = 0; i < parts.length; i++) if (parts[i].rate > 0) rate += parts[i].rate;
      if (!(rate > 0)) return;
      seen.push(target);
      const cell = cellOf(sim, law, target);
      if (cell.done || (hz.waiting.length > 0 && isWaiting(sim, law.id, target))) return;      // 위험은 이미 실현돼 끝났거나 자리를 기다리는 중이다 — 적분하지 않는다
      if (cell.since < 0) cell.since = sim.t;
      const H = cell.H + rate * dt;
      if (H < cell.thr) { cell.H = H; return; }
      const src = srcOf(sim, parts, cell.since);
      crossed(sim, law, target, cell, src, 0);
      advance(sim, law, target, cell, H);
    });
    // 지난 주기에는 초과가 있었는데 이번에 나오지 않은 대상: 초과가 끝났다. H 는 그대로 둔다(적분이 멎을 뿐이다 — 식지 않는다)
    if (prev && prev.length) {
      const tab = hz.cells[law.id];
      if (tab) for (let i = 0; i < prev.length; i++) if (seen.indexOf(prev[i]) < 0) { const c = tab[prev[i]]; if (c) c.since = -1; }
    }
    hz.live[law.id] = seen;
  }
  if (road) hz.roadAt = driftAt;
}

/**
 * 한 번의 충격을 같은 칸에 더한다 (폭발의 불티 · 정전 순간 · 닫힌 화재의 잔열). 넘으면 그 자리에서 "넘은 자리의 처리"를 한다 — 몫은 그 part 하나다(rate 자리에 dH).
 * delay = 넘었을 때 사건까지 미루는 초. 등록되지 않은 법칙·끝난 대상(done)·기다리는 줄이 있는 대상이면 아무것도 하지 않는다
 */
export function hazardImpulse(sim: Sim, lawId: HazardLawId, target: number, dH: number, part: HzPart, delay = 0): void {
  const law = lawOf(lawId);
  if (!law || !(dH > 0)) return;
  const cell = cellOf(sim, law, target);
  if (cell.done || isWaiting(sim, lawId, target)) return;
  const since = cell.since >= 0 ? cell.since : sim.t;
  const H = cell.H + dH;
  if (H < cell.thr) { cell.H = H; return; }
  const src = srcOf(sim, [{ rate: dH, ev: part.ev, inc: part.inc, what: part.what, ref: part.ref }], since);
  crossed(sim, law, target, cell, src, delay);
  advance(sim, law, target, cell, H);
}
