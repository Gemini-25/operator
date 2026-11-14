// 재난 — 교대 전체에 걸쳐 도시의 상태를 바꾸고, 지금 있는 사건들을 한꺼번에 여러 곳에 일으킨다.
// 사건 하나하나는 평소와 같은 규칙으로 처리된다(관제·지휘·대원의 코드는 재난을 따로 알지 못한다).
// 설계: docs/specs/N6-disaster.md
//
// 재현성: 재난의 모든 난수는 sim.rng.fork('disaster') 에서 나온다. 사건은 createIncident(sim, { ..., rng }) 로 일으킨다.
// 재난이 없는 교대(sim.disaster === null)에서는 이 파일의 어떤 코드도 상태를 바꾸지 않는다.

import { DISASTER_KINDS } from './difficulty';
import type { DisasterKind } from './difficulty';
import type { Sim } from './engine';
import type { Rng } from './rng';

export type DisasterPhase = 'calm' | 'warning' | 'impact' | 'aftermath' | 'over';
export interface DisasterState {
  kind: DisasterKind; name: string;
  phase: DisasterPhase;
  tWarn: number; tImpact: number; tEnd: number;      // 특보 · 충격 시작 · 충격 끝 (sim.t). 예고가 없는 재난은 tWarn === tImpact
  intensity: number;             // 지금의 세기 0..1 (그림과 규칙이 함께 본다)
  rng: Rng;
  spawned: number[];             // 재난이 일으킨 사건 id
  closedEdges: number[];         // 재난이 통제한 도로 구간 (끝나면 풀어야 한다)
  nextAt: number;                // 다음 일(사건·통제)을 일으킬 시각
  // 종류별 자료 (쓰는 재난만 채운다)
  front?: { x: number; y: number; r: number; dx: number; dy: number };      // 산불의 불머리 · 해일의 물마루
  level?: number;                // 홍수의 수위 0..1
  dark?: boolean;                // 정전
  speedMul?: number;             // 긴급 차량 주행 속도에 곱하는 값 (비바람·침수). city.weatherSpeedFactor 가 읽는다
  scar?: number[][];             // 산불이 지나간 자리 [x, y, r] (그림용)
  log: { t: number; text: string }[];      // 보고서용: 실제로 일어난 일
}

/** 교대가 시작될 때 한 번. 재난이 없으면 null. */
export function initDisaster(sim: Sim): DisasterState | null {
  const choice = sim.difficulty.disaster ?? 'none';
  if (choice === 'none') return null;
  const rng = sim.rng.fork('disaster');
  let kind: DisasterKind;
  if (choice === 'random') { if (!rng.chance(sim.tune.disasterProb)) return null; kind = rng.pick(DISASTER_KINDS); }
  else kind = choice;
  return plan(sim, kind, rng);
}

/** 재난의 일정을 짠다. (N6 에서 종류별로 채운다) */
function plan(_sim: Sim, _kind: DisasterKind, _rng: Rng): DisasterState | null { return null; }

/** 매 틱, 사건 생성(tickIncidents)보다 먼저. */
export function tickDisaster(sim: Sim): void {
  const d = sim.disaster;
  if (!d || d.phase === 'over') return;
}

/** 평소 사건이 생기는 간격에 곱하는 값 (재난 중에는 평소 사건이 뜸해진다) */
export function disasterGapMul(sim: Sim): number { const d = sim.disaster; return d && (d.phase === 'impact' || d.phase === 'warning') ? 1.6 : 1; }

/** 교대 보고서에 넣을 요약 (재난이 없었으면 undefined) */
export function disasterSummary(sim: Sim): { name: string; lines: string[] } | undefined {
  const d = sim.disaster;
  if (!d) return undefined;
  return { name: d.name, lines: d.log.map((l) => l.text) };
}
