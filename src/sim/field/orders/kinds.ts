// 사건 종류 다양화 ① 일상 사건의 지휘 규칙 (docs/specs/N8-incident-kinds.md §4) — 지휘관의 믿음(a.beliefs)과 현장의 생김새만 읽는다.
// 진실(소품·구조 대상·용의자의 진실 칸·사건의 진실·시나리오의 정체)을 읽지 않는다 (tests/ext.test.ts · tests/kinds.test.ts 시험 4 가 글자로 본다).
// registerOrders((sim, s, I, a, k) => void) — 지휘관이 계획을 세울 때마다(syncBoard 끝, 핵심 규칙 뒤) 불린다. 자기 현장이 아니면 첫 줄에서 돌아간다.
//
// 단계 3: 오인 신고의 답 — 물에 뜬 물건·폭죽 잔해를 확인했으면 남은 수색을 거둔다.
import { emit } from '../../events';
import { resp } from '../agents';
import { mkFact } from '../beliefs';
import { registerOrders } from '../sceneRegistry';
import type { Scene } from '../../types';

/** 오인 신고의 판단을 알린 현장 (기록은 한 번 — 늦게 닿은 수색 보고가 확인율을 낮추면 믿음만 조용히 다시 고친다). 객체 모양을 바꾸지 않으려고 WeakSet */
const TOLD = new WeakSet<Scene>();

/**
 * (N2 오인 신고) 지휘관이 "물에 떠 있는 것은 사람이 아님"(evid floater) 또는 "폭죽 잔해 — 총소리가 아니었음"(evid fireworks)을 알고,
 * 믿음에 구조 대상도 용의자도 없으면 신고된 일이 없었다고 판단한다: 아직 덜 본 수색 구역을 지휘관의 판단으로 확인됨(0.9)으로 적고 열린 수색을 거둔다.
 * 핵심 규칙(syncBoard)은 확인율이 문턱(0.72 · 재수색 0.9)을 넘은 구역에 수색을 내지 않으므로 다음 주기에 다시 생기지 않는다(원칙 10 — 거둔 일이 되살아나지 않게 믿음을 고친다).
 * 남은 수색이 없으면 지금의 길로 닫는다(무장은 안전 확보 선언 → 종료). 믿음은 한 번만 고치므로 되풀이되지 않는다
 */
registerOrders((sim, s, I, a, k) => {
  if (s.kind !== 'armed' && s.kind !== 'water') return;
  const B = a.beliefs;
  let why = '';
  for (const f of B.list('evid')) { const kd = f.value && f.value.kind; if (kd === 'fireworks') { why = '폭죽 잔해 확인 — 총소리가 아니었습니다'; break; } if (kd === 'floater') { why = '물에 뜬 것은 사람이 아니었습니다'; break; } }
  if (!why || B.list('cas').length > 0 || B.list('hos').length > 0) return;
  let n = 0;
  for (const r of s.regions) {
    if (!r.searchable || r.kind === 'wreck') continue;
    if ((B.val<number>('srch', r.id) ?? -1) >= 0.9) continue;
    B.merge(mkFact('srch', r.id, 0.9, '지휘관 판단', sim.t, 0.7, true, `${r.name} 수색 생략 — ${why}`));
    n++;
  }
  if (!n) return;
  k.cancel((w) => w.kind === 'search');
  if (TOLD.has(s)) return;
  TOLD.add(s);
  emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 1, text: `${why}. 신고된 일은 없던 것으로 보고 남은 수색을 거둡니다.` });
});
