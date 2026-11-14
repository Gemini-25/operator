// 강력 범죄 (docs/specs/N4b-crime.md) 의 지휘 규칙. 지휘관의 믿음(a.beliefs)만 읽는다 — 현장의 진실(소품·사람·용의자의 실제 상태)은 읽지 않는다.
// registerOrders((sim, s, I, a, k) => { ... }), registerBlocker((sim, s, a) => boolean) 로 등록한다.

import type { Fact, FieldAgent } from '../../types';
import { registerBlocker, registerOrders } from '../sceneRegistry';

// ───────────────────────── 폭발물 ─────────────────────────
const bombsKnown = (a: FieldAgent): Fact[] => a.beliefs.list('haz').filter((f) => f.value.kind === 'bomb');

registerOrders((sim, s, I, a, k) => {
  for (const f of bombsKnown(a)) {
    if (!f.value.active) { k.cancel((w) => w.kind === 'defuse' && w.prop === f.id); continue; }
    k.want('defuse', { prop: f.id }, 0.97);
    if (k.countUnits('eod', 0.9) === 0) k.request('eod', '폭발물로 보이는 물건 확인 — 처리반 필요', true);
    // 장치가 있는 방의 수색은 거둔다 (처리반 말고는 가까이 가지 않는다). s.region 은 건물의 생김새라 읽어도 된다
    const rg = s.region[f.value.y * s.w + f.value.x];
    k.cancel((w) => w.kind === 'search' && w.region === rg);
  }
});
// 장치가 살아 있다고 알고 있는 동안에는 상황을 끝내지 않는다
registerBlocker((sim, s, a) => bombsKnown(a).some((f) => f.value.active));
