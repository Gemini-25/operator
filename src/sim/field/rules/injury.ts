// 부상과 사망 (H1) — 세계 규칙. 진실을 읽고 바꾼다 (hazards.ts 와 같은 자격).
//   단계 3  스스로 대피하다 위중(체력 40 이하)이 된 사람이 멈춘다 (설계서 H1 §5.2) — 아래
// 뒤 단계가 여기에 채운다:
//   단계 4c 열 탈진, 붕괴 현장의 잔해 바닥 추락 (§2.3)
//   단계 5  용의자의 상처 출혈과 그로 인한 사망 (§4.1)
// 매 틱 모든 현장에서 불리므로, 다친 사람이 없는 현장은 싼 검사 하나로 지나가게 하고 배열을 새로 만들지 않는다 (§12.2-7).
// 사건이 끝난 뒤(I.phase === 'closed')에는 아무것도 하지 않는다 (§2.6).

import type { Sim } from '../../engine';
import { emit } from '../../events';
import type { Casualty, Incident, Scene } from '../../types';
import { josa } from '../../util';
import { isIndoor, tileOf } from '../grid';
import { CAUSE_NAME, decayCause } from '../injury';
import { registerRule } from '../sceneRegistry';

/** 스스로 대피하던 사람이 더 걷지 못하게 되는 체력 — 위중(중증도 2)의 경계. 그 아래로는 누가 데리러 가야 한다 */
export const WALK_STOP = 40;

/**
 * 스스로 대피하던 사람이 위중이 되어 쓰러진다 (§5.2). 걷는 사람도 연기·불을 지나며 체력을 잃는다(tickCasualties) — 예전에는 체력 0 까지 걸었다.
 * 관찰자만 아는 사실이다(진실 기록): 지휘관은 본 대원의 보고나, 대피 중이라던 사람의 소식이 끊겼을 때의 규칙
 * (32초 뒤 동행 확인, 현장이 비었을 때의 outstanding)으로 알게 된다.
 * 원인은 지금 선 자리에서 가장 크게 깎는 항 — tickCasualties 의 악화 식과 같은 항을 읽기만 한다(이름을 고르는 데만 쓴다).
 */
function collapseWalker(sim: Sim, s: Scene, I: Incident, c: Casualty): void {
  const i = tileOf(s, c.x, c.y);
  const wound = c.bystander && c.treatQ <= 0 ? c.bleed * 0.5 : c.bleed;
  const smoke = s.smoke[i] * (s.kind === 'hazmat' ? 0.62 : 0.36);
  const burn = s.fire[i] > 0.3 ? 2.6 * s.fire[i] : 0;
  const expo = !isIndoor(s.tiles[i]) && (c.isTarget || s.kind === 'search') ? s.exposure : 0;
  const cause = decayCause(c, s, I, wound, smoke, burn, expo);
  c.walking = false; c.mob = 'immobile'; c.path = null;
  c.causeEvent = emit(sim, {
    inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'casualty', imp: 2, truth: true, causes: [c.causeEvent],
    text: `대피하던 구조 대상 ${josa(c.label, '이/가')} ${josa(CAUSE_NAME[cause], '으로/로')} 쓰러졌습니다.`,
  });
}

registerRule((sim, s, I) => {
  if (I.phase === 'closed') return;
  const cs = s.casualties;
  for (let k = 0; k < cs.length; k++) {
    const c = cs[k];
    // 체력이 이미 0 이하인 사람은 다음 틱에 악화 규칙이 사망으로 판정한다 — 쓰러짐을 따로 적지 않는다
    if (!c.walking || c.health > WALK_STOP || c.health <= 0 || c.dead || c.where !== 'scene') continue;
    collapseWalker(sim, s, I, c);
  }
});
