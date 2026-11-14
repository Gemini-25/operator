// 재난 (docs/specs/N6-disaster.md) 의 지휘 규칙. 지휘관의 믿음(a.beliefs)만 읽는다 — 현장의 진실(소품·구조 대상·용의자·사건의 실제 모습)은 읽지 않는다.
// registerOrders((sim, s, I, a, k) => { ... }), registerBlocker((sim, s, a) => boolean) 로 등록한다.

import { registerOrders } from '../sceneRegistry';

/**
 * 해안 대피: 신고된 인원을 다 찾았더라도 모래밭과 부두를 끝까지 살핀다(바닷가에 누가 남았는지는 신고자도 다 알지 못한다).
 * 물에 잠겨 더 살필 수 없게 된 구역의 수색 지시는 거둔다.
 */
registerOrders((_sim, s, _I, a, k) => {
  if (s.kind !== 'water' || s.variant !== 'evac' || !s.sizeupDone) return;
  k.cancel((w) => w.kind === 'search' && w.region >= 0 && !s.regions[w.region].searchable);
  for (const r of s.regions) {
    if (!r.searchable) continue;
    const c = a.beliefs.val<number>('srch', r.id) ?? -1;
    if (c >= 0.72) continue;
    k.want('search', { region: r.id }, 0.6, 1, c >= 0);
  }
});
