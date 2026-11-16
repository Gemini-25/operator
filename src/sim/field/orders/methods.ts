// 대응 방법 (docs/specs/R2-methods.md) 의 지휘 규칙. 지휘관의 믿음과 작업판만 읽는다 — 진실을 읽지 않는다
// (tests/ext.test.ts 가 이 폴더의 주석이 아닌 줄을 글자로 검사한다. 주석은 이렇게 줄 주석으로만 쓰고, 어떤 주석에도 그 시험의 금지어를 쓰지 않는다).
//
// 단계 1a (§4.1 지휘 규칙 1): 열려 있는 수난 구조 작업이 거듭 실패했고(w.fails ≥ 2) 그 구조 대상의 믿음이 아직 물속이면 수난 장비를 가진 부대를 더 부른다.
//   방법을 접을 때(실패·고장)와 임무가 막혀 끝날 때 작업의 실패 횟수가 오른다. 요청은 같은 수요를 70초 안에 되풀이하지 않는다(commander.request).
//   구조 부대가 이미 둘 와 있거나 오는 중이면 더 부르지 않는다 (같은 대상에서 계속 막히는 동안 지원이 쌓이지 않게).
// 맡을 사람이 아예 없는 경우는 새 규칙을 만들지 않는다: commander 의 "맡을 사람이 없는 작업" 블록(anyCapable)이 fitFor(= methodFit)로 이미 그 일을 한다. (§4.1 지휘 규칙 2)

import type { CasBelief } from '../../types';
import { registerOrders } from '../sceneRegistry';

/** 이 능력 이상의 부대를 "구조 부대"로 센다 (구조 공작차·구조정 — 펌프차의 구조 능력은 이 밑이다) */
const RESCUE_CAP = 0.8;

registerOrders((_sim, s, _I, a, k) => {
  const board = s.board;
  for (let i = 0; i < board.length; i++) {
    const w = board[i];
    if (w.kind !== 'waterRescue' || w.fails < 2 || (w.status !== 'open' && w.status !== 'active')) continue;
    const cb = a.beliefs.val<CasBelief>('cas', w.cas);
    if (!cb || !cb.water || cb.band >= 3 || cb.where !== 'scene') continue;
    if (k.countUnits('rescue', RESCUE_CAP) >= 2) return;
    k.request('rescue', '수난 구조가 거듭 실패 — 수난 장비 필요', true);
    return;
  }
});
