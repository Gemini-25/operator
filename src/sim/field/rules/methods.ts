// 대응 방법 (docs/specs/R2-methods.md) 의 세계 규칙. 진실을 읽고 바꾼다 (hazards.ts 와 같은 자격).
// scenes/index.ts 의 맨 끝(상공의 헬기 다음)에 등록한다 — 세계 규칙은 등록 순서대로 돈다.
//
// 단계 0 (틀)부터: 물이 있는 현장의 생김새 표시 둘을 정한다 — 기록도 난수도 없다. 단계 1a 부터 읽는 곳이 있다(손 뻗기의 조건, 투척 명중).
//   s.quay  물가가 높은 안벽인가 (선박 화재의 부두 — 손이 물에 닿지 않는다). 처음 한 번 정한다. 세계 규칙이라 시나리오 변형을 읽어도 된다 — 판단부는 이 표시만 본다 (methods.ts 의 hand)
//   s.flow  물살(칸/초). 물속 사람이 떠내려가는 속도의 최댓값을 따라 오르고, 내려가지는 않는다(사람이 걸려 멈춰도 강물은 흐른다). 실행부의 투척 명중이 읽는다 (methodRun.hitP)
// 단계 1b (물 위의 대원 — 모든 현장: 개울이 있는 수색 현장도):
//   보트 대원이 뭍 칸에 놓이면(해일이 옮긴 경우 등 — 보트 방법은 스스로 푼다)·보트로 철수하면(left) a.afloat 를 푼다
//   물 칸 위에 쓰러진(숨진) 대원을 물가로 옮긴다(methodRun.pullAshore — 기록 truth). agentHealth 는 act 보다 먼저 돌고 이 규칙은 다음 틱 첫 단계에서 돌므로
//   쓰러진 대원은 한 틱 동안 물 칸에 있을 수 있다. H1 의 동료 구조(rescueMate)는 물 칸의 동료를 물가에서 기다린다 — 이 규칙은 물 칸에서만 옮긴다
// 뒤 단계가 여기에 채운다:
//   단계 2  농성 문 잠금 (§4.2a — 흐름 barricade:<사건 id>)
//   단계 4  송풍기 s.fan (실내 연기 감쇠·불 키움) — 그때 첫 줄의 "해당 없는 현장" 조건에 s.fan 을 더한다

import { T } from '../../types';
import { tileOf } from '../grid';
import { pullAshore } from '../methodRun';
import { registerRule } from '../sceneRegistry';
import type { SceneRule } from '../sceneRegistry';

/** 물살의 바닥값 (칸/초): 떠내려가는 사람이 없어도 강물은 이만큼 흐른다 */
export const FLOW_MIN = 0.02;

/** 시험이 이 규칙을 SCENE_RULES 에서 찾을 수 있게 이름을 붙여 내보낸다 */
export const methodsRule: SceneRule = (sim, s, I) => {
  // (1b) 물 위의 대원 안전장치 — 쓰러진 대원과 보트 위 대원만 칸을 본다 (그 밖은 칸 하나도 읽지 않는다)
  const ag = s.agents;
  for (let k = 0; k < ag.length; k++) {
    const a = ag[k];
    if (a.afloat !== undefined && (a.status === 'left' || s.tiles[tileOf(s, a.x, a.y)] !== T.WATER)) a.afloat = undefined;      // 철수(보트로 떠남 — case 'board' 의 길 없음)도 내린다
    if (a.status === 'down' && s.tiles[tileOf(s, a.x, a.y)] === T.WATER) pullAshore(sim, s, I, a, '쓰러짐');
  }
  if (s.kind !== 'water' && (s.rules === undefined || s.rules.indexOf('water') < 0)) return;      // 물이 없는 현장 (매 틱 모든 현장에서 도는 길 — 칸 둘만 읽는다)
  if (s.quay === undefined) s.quay = s.variant === 'ship';
  if ((sim.tick + s.id) % 5 !== 0 || I.phase === 'closed') return;      // 1초에 한 번. 현장 환경은 첫 부대가 오기 전부터 돌므로 처음 떠내려가는 속도를 놓치지 않는다
  let f = s.flow ?? FLOW_MIN;
  const cs = s.casualties;
  for (let k = 0; k < cs.length; k++) { const c = cs[k]; if (c.inWater && !c.dead && c.drift !== undefined && c.drift > f) f = c.drift; }
  s.flow = f;
};
registerRule(methodsRule);
