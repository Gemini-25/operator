// (I1-b b3-11 C5) 연기 자리의 실외 현장 — 구조 대상의 실외 노출 (설계서 I1 §3.7 C5 결과 2). 진실을 읽고 바꾼다 (hazards.ts 와 같은 자격 — 세계 규칙).
// registerRule(smokeOutdoor) 로 등록한다 (field/scenes/index.ts 의 맨 끝에서 import — 연기가 없는 교대에는 첫 줄에서 돌아가 결과가 바뀌지 않는다).
//
// 큰 불·산불의 연기가 덮은 자리(world/rules/infra.ts 의 smokePlume — 국지 구역 값 'smoke')에 있는 바깥 현장(길 위의 현장 · 바깥 유형 — 교통사고·수색·수난)에서,
// 지금의 실외 노출(hazards.tickCasualties 의 s.exposure — 실외 칸에 있는 수색 대상·수색 현장의 사람)과 같은 사람에게 OUT × 연기의 세기만큼 매초 더 깎인다.
// 피해는 한 길로(H1): injury.hurtCas 를 원인 'smoke'(연기 흡입)와 매 틱 피해({ tick: true })로 부른다 — 체력을 직접 깎지 않는다. 판정 뒤에는 hurtCas 가 첫 줄에서 돌아간다.
// 연기의 세기는 그 현장 자리가 겪는 값(state.zoneAt)이다. 대원은 겪을 뿐이다 — 지휘관·대원의 판단은 이것을 읽지 않는다(실외 노출이 늘어난 것은 구조 대상의 상태로만 드러난다).

import type { Sim } from '../../engine';
import { TYPE_DEFS } from '../../incidentTypes';
import type { Incident, Scene } from '../../types';
import { zoneAt } from '../../world/state';
import { isIndoor, tileOf } from '../grid';
import { hurtCas } from '../injury';
import { registerRule } from '../sceneRegistry';

/** 연기 자리의 실외 노출: 세기 1 의 연기 속 실외 칸에서 초당 더 깎이는 체력 (설계서 §3.7 C5 의 첫 값 0.08 × 세기) */
export const SMOKE_OUT = 0.08;

/** 그 현장의 실외 노출 한 틱 (세계 규칙 — 시험이 직접 부른다) */
export function smokeOutdoor(sim: Sim, s: Scene, I: Incident): void {
  if (I.phase === 'closed' || !(s.outdoor || TYPE_DEFS[s.kind].outdoor)) return;
  const sp = sim.world.spans;
  let any = false;
  for (let k = 0; k < sp.length; k++) if (sp[k].f === 'smoke') { any = true; break; }
  if (!any) return;
  const v = zoneAt(sim, 'smoke', I.truth.x, I.truth.y);
  if (!(v > 0)) return;
  const amt = SMOKE_OUT * v * sim.dt;
  for (let ci = 0; ci < s.casualties.length; ci++) {
    const c = s.casualties[ci];
    if (c.dead || (c.where !== 'scene' && c.where !== 'carried') || !(c.isTarget || s.kind === 'search')) continue;
    if (isIndoor(s.tiles[tileOf(s, c.x, c.y)])) continue;
    hurtCas(sim, s, I, c, amt, 'smoke', { tick: true });
  }
}
registerRule(smokeOutdoor);
