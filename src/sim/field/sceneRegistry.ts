// 묶음별 파일이 끼워 넣는 자리. 큰 파일(builders·hazards·commander)의 분기문을 여러 사람이 동시에 고치지 않기 위한 것이다.
//   현장 생성   field/scenes/<묶음>.ts  → registerScene      (진실을 만든다)
//   세계 규칙   field/rules/<묶음>.ts   → registerRule       (진실을 읽고 바꾼다. hazards.ts 와 같은 자격)
//   지휘 규칙   field/orders/<묶음>.ts  → registerOrders     (지휘관의 믿음만 읽는다. 진실을 읽으면 안 된다)
//   종료 조건   field/orders/<묶음>.ts  → registerBlocker    (믿음으로 볼 때 아직 끝낼 수 없는가)
//   (N8) 남은 일 field/orders/<묶음>.ts → registerPending    (마지막 부대가 떠났을 때 무엇을 다시 부를까 — 믿음만)
//   (N8) 보류    field/orders/<묶음>.ts → registerCasHold·registerPropHold (핵심 지휘 규칙이 그 사람·그 차에 일을 내지 않는다 — 믿음만)
//   (N8) 판정    field/rules/<묶음>.ts  → registerVerdict    (사건을 닫을 때 새 위험을 등급에 넣는다 — 진실을 읽는다, debrief.ts 와 같은 자격)

import type { Sim } from '../engine';
import type { Rng } from '../rng';
import type { CasBelief, FieldAgent, Incident, IncidentType, Scene, UnitCaps, WorkItem, WorkKind } from '../types';

export type SceneBuilder = (sim: Sim, I: Incident, rng: Rng) => Scene;
export const SCENE_BUILDERS: Record<string, SceneBuilder> = {};
/** 시나리오의 현장을 만드는 함수를 등록한다. builders.buildScene 이 "유형/변형" 으로 찾아 쓴다. */
export function registerScene(type: IncidentType, variant: string, fn: SceneBuilder): void { SCENE_BUILDERS[`${type}/${variant}`] = fn; }

export type SceneRule = (sim: Sim, s: Scene, I: Incident) => void;
export const SCENE_RULES: SceneRule[] = [];
/** 매 틱 모든 현장에서 불리는 세계 규칙. 자기 현장이 아니면 첫 줄에서 돌아간다 (예: if (!s.props.some((p) => p.kind === 'bomb')) return;) */
export function registerRule(fn: SceneRule): void { SCENE_RULES.push(fn); }

export interface WorkTarget { region?: number; cas?: number; prop?: number; hostile?: number; tile?: number; mate?: number; animal?: number }      // animal: (N8) 대상 동물
/** 지휘 규칙에 건네는 도구 (commander.ts 의 함수들) */
export interface CommandKit {
  want: (kind: WorkKind, tg: WorkTarget, priority: number, max?: number, thorough?: boolean) => WorkItem;
  cancel: (pred: (w: WorkItem) => boolean) => void;
  request: (need: keyof UnitCaps, reason: string, urgent: boolean) => void;
  countUnits: (need: keyof UnitCaps, min: number) => number;      // 오고 있거나 와 있는 부대 수
  unitsOnScene: () => number[];
}
export type OrderRule = (sim: Sim, s: Scene, I: Incident, a: FieldAgent, k: CommandKit) => void;
export const ORDER_RULES: OrderRule[] = [];
/** 지휘관이 계획을 세울 때마다(syncBoard 끝) 불린다. a.beliefs 만 읽는다. */
export function registerOrders(fn: OrderRule): void { ORDER_RULES.push(fn); }

export type CloseBlocker = (sim: Sim, s: Scene, a: FieldAgent) => boolean;
export const CLOSE_BLOCKERS: CloseBlocker[] = [];
/** 참을 돌려주면 지휘관이 상황 종료를 선언하지 않는다 (믿음 기준). */
export function registerBlocker(fn: CloseBlocker): void { CLOSE_BLOCKERS.push(fn); }

// ───────────────────────── (N8 단계 2a) 등록 자리 넷 — docs/specs/N8-incident-kinds.md §5.7·§5.17 ─────────────────────────
// 줄은 그것을 쓰는 단계(4a~9)가 field/orders/kinds.ts(남은 일·보류 — 믿음만)와 field/rules/kinds.ts(판정 — 진실)에 등록한다.
// 등록된 줄이 없으면 부르는 자리가 아무것도 바꾸지 않는다 (단계 2a 는 결과 불변 — 시험 2).

/** 남은 일: 마지막 부대가 떠났을 때(sceneManager.tickScene 7번 블록) 마지막 지휘관의 믿음으로 본 끝나지 않은 일의 수요. 없으면 null. a.beliefs 만 읽는다 */
export type PendingRule = (sim: Sim, s: Scene, a: FieldAgent) => keyof UnitCaps | null;
export const PENDING_RULES: PendingRule[] = [];
/** 7번 블록은 줄 가운데 null 이 아닌 답이 하나라도 있으면 닫지 않고 그 수요(이미 와 있는 부대가 채우는 수요면 통제 부대)를 다시 부른다 */
export function registerPending(fn: PendingRule): void { PENDING_RULES.push(fn); }

/** 보류(구조 대상): 참이면 핵심 지휘 규칙(commander.syncBoard 의 구조 대상 고리)이 그 사람에게 구출·처치·이송·동행·탑승·인양을 내지 않는다. 믿음과 작업판만 */
export type CasHold = (sim: Sim, s: Scene, a: FieldAgent, id: number, c: CasBelief) => boolean;
export const CAS_HOLDS: CasHold[] = [];
export function registerCasHold(fn: CasHold): void { CAS_HOLDS.push(fn); }

/** 보류(소품): 참이면 핵심 지휘 규칙(교통사고의 도로 정리 줄)이 그 소품에 clearRoad 를 내지 않는다. 소품은 id 만 받는다 (진실 칸을 읽지 않는다) */
export type PropHold = (sim: Sim, s: Scene, a: FieldAgent, propId: number) => boolean;
export const PROP_HOLDS: PropHold[] = [];
export function registerPropHold(fn: PropHold): void { PROP_HOLDS.push(fn); }

/** 판정에 더할 것: open = 위험이 남았다(hazardActive 와 같은 무게 — 목표 미완), bad = 벌점, delayed = 대응 지연으로 센다 */
export interface VerdictAdd { open?: boolean; bad?: number; delayed?: boolean }
/** 판정 줄(세계 쪽 — 진실을 읽는다). 모든 줄은 첫 줄에서 자기 현장이 아니면 null */
export type VerdictRule = (sim: Sim, s: Scene, I: Incident) => VerdictAdd | null;
export const VERDICT_RULES: VerdictRule[] = [];
/** debrief.evaluate 가 위험 판정(hazardActive) 바로 뒤에 돈다 */
export function registerVerdict(fn: VerdictRule): void { VERDICT_RULES.push(fn); }
