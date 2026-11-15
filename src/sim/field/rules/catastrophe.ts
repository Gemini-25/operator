// 위험의 현실화 (docs/specs/X6-catastrophe.md) 의 세계 규칙. 진실을 읽고 바꾼다 (hazards.ts 와 같은 자격).
// 몸통은 field/catastrophe.ts 에 있고, 여기서는 등록과 1초 주기의 순서만 정한다.
// scenes/index.ts 에서 crime → major → disaster → injury 다음, 상공의 헬기(rules/air — 마지막에 돈다) 앞에 등록한다. 규칙의 실행 순서가 결과를 정한다.

import { catOf, catTick } from '../catastrophe';
import { registerRule } from '../sceneRegistry';
import type { SceneRule } from '../sceneRegistry';

/** 시험이 이 규칙을 SCENE_RULES 에서 찾을 수 있게 이름을 붙여 내보낸다 */
export const catRule: SceneRule = (sim, s, I) => {
  if (I.phase === 'closed') return;                  // 판정(evaluate) 뒤에는 아무것도 일어나지 않는다 — 대원이 떠나는 동안에도 규칙은 돈다 (rules/crime.ts 의 폭발물 규칙·H1 §2.6 과 같다)
  const c = s.cat ?? catOf(sim, s);                  // 대상이 아니면 null. 처음 부를 때 만든다 (현장의 첫 틱 — 처음 생김새가 들어간다). 이미 있으면 칸 하나만 읽는다 (매 틱 모든 현장에서 도는 길)
  if (!c || (sim.tick + s.id) % 5 !== 0) return;     // 1초에 한 번: tickFire·tickGas 와 같은 틱, 그 뒤
  catTick(sim, s, I, c);
};
registerRule(catRule);
