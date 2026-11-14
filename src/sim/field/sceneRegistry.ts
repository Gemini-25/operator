// 묶음별 파일이 끼워 넣는 자리. 큰 파일(builders·hazards·commander)의 분기문을 여러 사람이 동시에 고치지 않기 위한 것이다.
//   현장 생성   field/scenes/<묶음>.ts  → registerScene      (진실을 만든다)
//   세계 규칙   field/rules/<묶음>.ts   → registerRule       (진실을 읽고 바꾼다. hazards.ts 와 같은 자격)
//   지휘 규칙   field/orders/<묶음>.ts  → registerOrders     (지휘관의 믿음만 읽는다. 진실을 읽으면 안 된다)
//   종료 조건   field/orders/<묶음>.ts  → registerBlocker    (믿음으로 볼 때 아직 끝낼 수 없는가)

import type { Sim } from '../engine';
import type { Rng } from '../rng';
import type { FieldAgent, Incident, IncidentType, Scene, UnitCaps, WorkItem, WorkKind } from '../types';

export type SceneBuilder = (sim: Sim, I: Incident, rng: Rng) => Scene;
export const SCENE_BUILDERS: Record<string, SceneBuilder> = {};
/** 시나리오의 현장을 만드는 함수를 등록한다. builders.buildScene 이 "유형/변형" 으로 찾아 쓴다. */
export function registerScene(type: IncidentType, variant: string, fn: SceneBuilder): void { SCENE_BUILDERS[`${type}/${variant}`] = fn; }

export type SceneRule = (sim: Sim, s: Scene, I: Incident) => void;
export const SCENE_RULES: SceneRule[] = [];
/** 매 틱 모든 현장에서 불리는 세계 규칙. 자기 현장이 아니면 첫 줄에서 돌아간다 (예: if (!s.props.some((p) => p.kind === 'bomb')) return;) */
export function registerRule(fn: SceneRule): void { SCENE_RULES.push(fn); }

export interface WorkTarget { region?: number; cas?: number; prop?: number; hostile?: number; tile?: number; mate?: number }
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
