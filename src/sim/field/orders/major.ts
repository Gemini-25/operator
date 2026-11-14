// 대형 사고 (docs/specs/N5-major.md) 의 지휘 규칙. 지휘관의 믿음(a.beliefs)만 읽는다 — s.props·s.casualties·s.hostiles·I.truth 를 읽지 않는다.
// registerOrders((sim, s, I, a, k) => { ... }), registerBlocker((sim, s, a) => boolean) 로 등록한다.

import { registerOrders } from '../sceneRegistry';

// 사람이 많을 때: 기본 규칙은 구급 부대를 두 대까지만 더 부른다. 기다리는 부상자와 갇힌 사람의 수에 맞춰 더 부른다.
// 믿음만 보므로 대형 사고가 아니어도(버스 사고 등) 사람이 많으면 똑같이 적용된다.
registerOrders((_sim, _s, _I, a, k) => {
  const cas = a.beliefs.list('cas');
  const waiting = cas.filter((f) => f.value.band >= 1 && f.value.band < 3 && (f.value.where === 'scene' || f.value.where === 'carried' || f.value.where === 'safe')).length;
  if (waiting >= 5 && k.countUnits('ems', 0.7) < Math.min(5, Math.ceil(waiting / 2))) k.request('ems', `부상자 ${waiting}명 — 구급 부대가 더 필요`, true);
  const trapped = cas.filter((f) => f.value.mob === 'trapped' && f.value.band < 3 && f.value.where === 'scene').length;
  if (trapped >= 3 && k.countUnits('rescue', 0.5) < 2) k.request('rescue', `고립 ${trapped}명 — 구조 부대 추가`, true);
});
