// (N8 단계 8 §5.11) 높은 자리 — 진실 s.kinds.perch 를 다루는 작은 도구 (잎 모듈: types 만 가져온다).
// 읽고 쓰는 자리는 진실 쪽뿐이다: 실행부(executor 의 높은 자리 구출) · 상공의 호이스트(rules/air.ts) · 세계 규칙(rules/kinds.ts — 줄 끊김·전원 복구).
// 판단 파일(commander·orders·methods·airDecide)은 이 파일을 부르지 않는다 — 믿음 CasBelief.perch 로만 안다 (agents.casFact 가 본 대로 채운다)
import type { Casualty, Scene } from '../types';

/** 그 사람이 높은 자리 목록(진실 s.kinds.perch)의 몇째인가 — 없으면 -1 (실행부는 진실을 읽어도 된다) */
export function perchIdx(s: Scene, cas: number): number {
  const l = s.kinds !== undefined ? s.kinds.perch : undefined;
  if (l === undefined) return -1;
  for (let k = 0; k < l.length; k++) if (l[k].cas === cas) return k;
  return -1;
}
/** 높은 자리에서 내려와 보통 구조 대상이 된다 (ground 칸 · 거동 불가 · 목록에서 빠진다) — 사다리·하강·상공의 호이스트·전원 복구가 함께 쓴다 */
export function leavePerch(s: Scene, c: Casualty, k: number, mob: 'immobile' | 'mobile'): void {
  const pe = s.kinds!.perch![k];
  s.kinds!.perch!.splice(k, 1);
  c.mob = mob; c.trapWork = 0; c.walking = mob === 'mobile'; c.path = null;      // 걸을 수 있는 사람은 스스로 안전한 곳으로 걸어간다
  c.x = c.px = pe.ground % s.w; c.y = c.py = (pe.ground / s.w) | 0;
}
