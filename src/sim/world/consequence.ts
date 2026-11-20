// 인과 규칙의 틀 (설계서 I1 §3.4~§3.6): 신호(signal) → 규칙(registerConsequence) → 결과.
// 사건 감독을 두지 않는다 — 규칙은 "세계 상태가 조건 X 를 넘으면 Y 가 일어난다"이고, 상태를 바꾸는 그 자리에서 emit 하며 원인 기록을 causes 로 잇는다.
//
// 이 파일에는 규칙이 없다. 규칙은 world/rules/*.ts 가 registerConsequence 로 끼워 넣고, world/rules/index.ts 가 모은다
// (engine.ts 가 그 파일을 import 한다 — import 순서 = 등록 순서 = 결과). 규칙이 하나도 없으면 tickWorld 는 쌓인 신호를 비우기만 한다 — 결과가 바뀌지 않는다.
//
// 지키는 것:
//  · 재현성 — 규칙의 난수는 발동마다 새 흐름 sim.rng.fork('csq:<규칙>:<열쇠>:<시도 번호>') 뿐이다. 사건을 만드는 흐름은 'csq-spawn:<규칙>:<순번>'. 기존 흐름에 끼우지 않는다.
//  · 유계 — 규칙마다 쿨다운(열쇠별)·교대 상한, 사건을 만드는 길은 spawnConsequence 하나(연쇄 상한의 정본 chain.canChain + 전체 상한 CSQ_SPAWN_CAP).
//  · 한 틱 안에서 신호가 끝없이 이어지지 않는다 — 틱이 시작할 때 쌓여 있던 신호만 처리하고, 규칙이 보낸 신호는 다음 틱에 처리한다.
//  · 일어나지 않은 일은 기록(emit)하지 않는다 — 거절된 예약은 gen.dropped 에만 남는다.
// 이 파일은 진실 쪽이다(세계 규칙과 같은 자격). 관제·지휘관이 아는 길은 world/state.ts 의 known* 함수들이다 (§3.8).

import { CHAIN_MAX, CHAIN_SHIFT_MAX, chainDepth, chainLen, chainedInShift } from '../chain';
import { CSQ_SPAWN_CAP, ruleLoad, tickHazards } from './hazard';
import type { Sim } from '../engine';
import type { DroppedChain, SpawnOpts } from '../incidents';
import type { Rng } from '../rng';
import type { Signal, SignalKind, WorldState, ZoneField } from '../types';
import { recoverWorld } from './state';

export type { Signal, SignalKind } from '../types';      // (X6 가 이 파일에서 SignalKind 를 가져간다 — 정의는 types.ts 로 옮겼다)
export { chainDepth } from '../chain';                    // 연쇄 깊이(뿌리 0)의 정본은 chain.ts

/** 규칙·법칙이 만드는 사건의 교대당 상한 (§3.6 — 부모가 있든 없든 센다). 부모가 있는 사건은 여기에 더해 chain.canChain(한 사슬 3건 · 한 교대 6건)도 본다.
 *  (b3-4) 정의는 world/hazard.ts 로 옮겼다 — 이 파일이 그 파일을 import 하므로 거기 두고 다시 내보낸다 */
export { CSQ_SPAWN_CAP } from './hazard';

/** 발동 한 번의 문맥. rng 는 이 발동만의 흐름이다 */
export interface CsqCtx {
  sim: Sim;
  sig: Signal | null;          // 신호로 걸린 규칙이면 그 신호, world tick 규칙이면 null
  key: string;                 // 쿨다운 열쇠
  rng: Rng;                    // csq:<규칙>:<열쇠>:<시도 번호>
  depth: number;               // 원인 사건의 연쇄 깊이 (뿌리 0. 원인 사건이 없으면 0)
  rule: string;                // 규칙 id — spawnConsequence 가 Incident.csq 와 흐름 이름에 쓴다
  spawns: number;              // 이 발동이 예약한 사건 수 (spawnConsequence 가 센다)
}
export interface Consequence {
  id: string; label: string;               // 'blastSpread' · '폭발 불씨' (보고서 문장이 label 을 쓴다)
  on: SignalKind[] | 'tick';               // 신호를 받을 때, 또는 world tick(1초)마다
  key: (sim: Sim, sig: Signal | null) => string | null;   // 쿨다운 열쇠 (예 'inc:12', 'zone:3'). null 이면 이번에는 해당 없음
  cooldown: number;                        // 같은 열쇠로 다시 일어나기까지 (초)
  cap: number;                             // 이번 교대 상한
  spawns: boolean;                         // 사건을 만드는 것이 전부인 규칙인가 — 참이면 조건이 맞아도 연쇄 상한에 걸릴 때 발동하지 않는다(gen.dropped 에 남는다).
                                           //   상태도 바꾸고 사건도 만드는 규칙은 거짓으로 두고 apply 안에서 spawnConsequence 를 부른다(예약마다 따로 거절된다)
  test: (c: CsqCtx) => boolean;            // 조건 (세계 상태를 읽어도 된다 — 진실 쪽)
  apply: (c: CsqCtx) => void;              // 상태를 바꾸고 emit — 사건은 spawnConsequence 로만
  /** (선택) 참이면 world.log 에 줄을 남기지 않는다 — 상태만 쌓는 규칙(인계마다 도는 응급실 체류). 쿨다운·상한·시도 번호는 그대로 센다 */
  silent?: boolean;
  /** (선택) 구역 값이 회복 시각을 지나 처음 값으로 돌아갈 때 — 복구 기록을 남기고 자기가 얹은 것(혼잡·음영)을 거둔다. 모든 규칙이 등록 순서로 받는다 */
  recover?: (sim: Sim, z: number, f: ZoneField, cause: number, known: boolean) => void;
}

const RULES: Consequence[] = [];
/** 규칙을 끼워 넣는다. 등록 순서가 처리 순서다(= 결과). 같은 id 를 다시 등록하면 그 자리의 규칙을 바꾼다. 돌려주는 함수는 등록을 거둔다(시험용) */
export function registerConsequence(c: Consequence): () => void {
  const k = RULES.findIndex((q) => q.id === c.id);
  if (k >= 0) RULES[k] = c; else RULES.push(c);
  return () => { const i = RULES.indexOf(c); if (i >= 0) RULES.splice(i, 1); };
}
/** 등록된 규칙 (읽기 전용 — 보고서가 label 을 찾는다) */
export function consequences(): readonly Consequence[] { return RULES; }
export function consequenceLabel(id: string): string | null { for (const c of RULES) if (c.id === id) return c.label; return null; }

/**
 * 세계에 일어난 일을 알린다 — 상태를 바꾸는 바로 그 코드에서, 그 일을 남긴 기록(ev)과 함께 한 줄.
 * x·y(도시 좌표)와 place(건물)를 주지 않으면 그 사건의 것이다. 현장의 칸 좌표는 cx·cy 로 준다. 처리는 다음 틱의 tickWorld 가 한다.
 * 기록을 남기지 않고 난수도 쓰지 않는다 — 규칙이 없으면 결과가 바뀌지 않는다.
 */
export function signal(sim: Sim, kind: SignalKind, s: { inc: number; ev: number; x?: number; y?: number; size?: number; place?: number; data?: number; cx?: number; cy?: number; mag?: number }): void {
  const w = sim.world as WorldState | undefined;
  if (!w) return;      // 세계 상태를 만들기 전(생성자 도중)에는 아무것도 하지 않는다
  const I = s.inc >= 0 ? sim.incidents[s.inc] : undefined;      // 주지 않은 자리·건물은 그 사건의 것 (사건이 없으면 -1)
  let x = s.x, y = s.y;
  if (x === undefined || y === undefined) { x = I ? I.truth.x : -1; y = I ? I.truth.y : -1; }
  w.signals.push({ kind, t: sim.t, inc: s.inc, ev: s.ev, x, y, size: s.size ?? 0, place: s.place ?? (I ? I.truth.placeId : -1), data: s.data ?? 0, cx: s.cx ?? -1, cy: s.cy ?? -1, mag: s.mag ?? 0 });
}

/** 사건을 하나 더 만들 자리가 있는가 — 없으면 까닭 ('depth' 사슬 길이 · 'cap' 교대 상한). 부모가 있으면 연쇄 상한의 정본(chain.canChain 의 두 조건)을 본다 */
function spawnRoom(sim: Sim, parent: number | undefined): DroppedChain['why'] | null {
  // (b3-4) 전체 상한을 세는 법은 하나다 — hazard.ruleLoad: 실제로 사건이 된 것 + 기다리는 예약 + 법칙의 기다리는 줄. 예약이 버려지면 자리가 돌아온다 (world.spawned 는 csq-spawn 흐름의 순번으로만 남는다)
  if (ruleLoad(sim) >= CSQ_SPAWN_CAP) return 'cap';
  if (parent === undefined || parent < 0) return null;
  const P = sim.incidents[parent];
  if (!P) return null;
  if (chainLen(sim, P) >= CHAIN_MAX) return 'depth';
  if (chainedInShift(sim) >= CHAIN_SHIFT_MAX) return 'cap';
  return null;
}

/** 규칙 하나를 걸어 본다: 열쇠 → 쿨다운·상한 → 시도 번호와 난수 흐름 → 조건 → (사건을 만드는 규칙이면) 연쇄 상한 → 결과 → world.log */
function fire(sim: Sim, c: Consequence, sig: Signal | null): void {
  const key = c.key(sim, sig);
  if (key === null) return;
  const w = sim.world, lk = c.id + '|' + key;
  const last = w.last[lk];
  if (last !== undefined && sim.t - last < c.cooldown) return;
  if ((w.count[c.id] ?? 0) >= c.cap) return;
  // 시도 번호: fork 는 이름이 같으면 같은 수열이라, 번호가 없으면 되풀이하는 확률 판정이 매번 같은 첫 난수를 쓴다 (§3.4). 조건이 거짓이어도 번호는 는다
  const n = w.tries[lk] = (w.tries[lk] ?? 0) + 1;
  const src = sig && sig.inc >= 0 ? sig.inc : -1;
  const ctx: CsqCtx = { sim, sig, key, rng: sim.rng.fork('csq:' + c.id + ':' + key + ':' + n), depth: src >= 0 ? chainDepth(sim, src) : 0, rule: c.id, spawns: 0 };
  if (!c.test(ctx)) return;
  if (c.spawns) {
    // 조건은 맞았지만 연쇄 상한에 걸렸다: 일어나지 않는다. 기록(emit)은 남기지 않고 gen.dropped 에만 — 같은 열쇠로 되풀이해 쌓이지 않게 쿨다운은 건다
    const why = spawnRoom(sim, src >= 0 ? src : undefined);
    if (why) { sim.gen.dropped.push({ t: sim.t, why, type: undefined, variant: undefined, parent: src >= 0 ? src : undefined, csq: c.id }); w.last[lk] = sim.t; return; }
  }
  w.last[lk] = sim.t;
  w.count[c.id] = (w.count[c.id] ?? 0) + 1;
  c.apply(ctx);
  if (ctx.spawns === 0 && !c.silent) w.log.push({ rule: c.id, t: sim.t, ev: sig ? sig.ev : -1, inc: src, made: -1, depth: ctx.depth });      // 사건을 예약한 발동의 줄은 spawnConsequence 가 예약마다 남긴다
}

/**
 * 세계 틱 — engine.step 의 tickDisaster 다음, tickIncidents 앞 (틱 순서는 결과를 정한다 — 이 자리를 바꾸지 않는다).
 * 매 틱: 틱이 시작할 때 쌓여 있던 신호만, 들어온 순서대로, 그 종류를 받는 규칙에 등록 순서대로 건넨다.
 * 1초에 한 번(sim.tick % 5 === 1): world tick 규칙 → 초과 위험 과정(tickHazards) → 회복(회복 시각이 지난 구역 값 · 응급실 체류 환자).
 */
export function tickWorld(sim: Sim): void {
  const w = sim.world, n = w.signals.length;
  if (n > 0) {
    if (RULES.length) for (let i = 0; i < n; i++) {
      const sig = w.signals[i];
      for (let k = 0; k < RULES.length; k++) { const c = RULES[k]; if (c.on !== 'tick' && c.on.indexOf(sig.kind) >= 0) fire(sim, c, sig); }
    }
    w.signals.splice(0, n);      // 규칙이 방금 보낸 신호(n 뒤쪽)는 남아 다음 틱에 처리된다
  }
  if (sim.tick % 5 !== 1) return;
  for (let k = 0; k < RULES.length; k++) if (RULES[k].on === 'tick') fire(sim, RULES[k], null);
  tickHazards(sim);      // (b3-4) 초과 위험 과정 — 상태 규칙이 이번 초의 상태를 바꾼 다음, 회복 앞. 법칙이 없으면 곧바로 돌아온다 (world/hazard.ts)
  recoverWorld(sim, RULES.length ? (z, f, cause, known) => { for (let k = 0; k < RULES.length; k++) RULES[k].recover?.(sim, z, f, cause, known); } : undefined);
}

/**
 * 규칙이 사건을 만드는 유일한 길: gen.chain 에 예약한다 (delay 초 뒤, when 이 있으면 그때 조건이 맞을 때만 — 맞지 않으면 5초마다 다시 보고 wait 초가 지나면 버린다).
 * 평소 생성기의 흐름을 건드리지 않는다(자기 흐름 csq-spawn:<규칙>:<순번>). 원인 기록은 opts.cause, 없으면 신호의 기록이다.
 * 연쇄 상한(부모가 있으면 chain.canChain — 한 사슬 3건 · 한 교대 6건)이나 전체 상한(CSQ_SPAWN_CAP)에 걸리면 예약하지 않고 gen.dropped 에 남긴다('depth'·'cap').
 * 돌려주는 값 = 예약했는가.
 */
export function spawnConsequence(sim: Sim, c: CsqCtx, opts: SpawnOpts, delay: [number, number], when?: (sim: Sim) => boolean, wait = 120): boolean {
  const w = sim.world;
  const why = spawnRoom(sim, opts.parent);
  if (why) { sim.gen.dropped.push({ t: sim.t, why, type: opts.type, variant: opts.variant, parent: opts.parent, csq: c.rule }); return false; }
  const n = w.spawned++;      // 이번 교대에 규칙이 예약한 사건의 순번 (거절된 것은 세지 않는다 — 한 발동이 둘을 예약해도 서로 다른 흐름)
  const at = sim.t + c.rng.range(delay[0], delay[1]);
  const cause = opts.cause !== undefined && opts.cause >= 0 ? opts.cause : c.sig ? c.sig.ev : undefined;
  const log = w.log.length;
  w.log.push({ rule: c.rule, t: sim.t, ev: cause ?? -1, inc: opts.parent ?? (c.sig ? c.sig.inc : -1), made: -1, depth: opts.parent !== undefined && opts.parent >= 0 ? chainDepth(sim, opts.parent) + 1 : 0 });
  c.spawns++;
  sim.gen.chain.push({ at, opts: { ...opts, cause, csq: c.rule, rng: sim.rng.fork('csq-spawn:' + c.rule + ':' + n) }, when, until: at + wait, log });
  return true;
}
