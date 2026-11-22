// 사건 종류 다양화 ① 일상 사건의 세계 규칙 (docs/specs/N8-incident-kinds.md §4·§5.16·§5.17) — 진실을 읽고 바꾼다 (hazards.ts 와 같은 자격).
// registerRule((sim, s, I) => void) 로 등록한다. 모든 규칙은 첫 줄에서 자기 현장이 아니면 돌아간다(다른 사건의 결과를 바꾸지 않는다). 난수를 쓰는 규칙은 자기 흐름만.
//
// 단계 3: 오인 신고(medical/false)의 잠든 사람 — 대원이 곁에 오면 깨어나 걸어서 귀가한다.
import { emit } from '../../events';
import { dist } from '../../util';
import { casFact, learn, resp } from '../agents';
import { registerRule } from '../sceneRegistry';

/** 깨우는 거리(칸) — 대원이 이만큼 다가오면 깨어난다 (§4.8 N2) */
export const WAKE_R = 1.5;

/**
 * (N2 오인 신고 · 응급) 길에서 잠든 사람: 누워 있다가(거동 불가로 보인다) 지상 대원이 1.5칸 안에 오면 깨어나 스스로 걷는다 — 걷는 사람은 안전한 곳으로 가서 where 'safe'
 * (hazards.tickCasualties 의 걷기). 깨운 대원은 바뀐 상태를 강제로 보고한다(§5.16 — 지휘관이 "거동 불가"의 낡은 믿음으로 이송을 되풀이하지 않게).
 * 업으려던 대원의 이송 임무는 실행기의 "스스로 걷는다" 갈래(executor 'carry' 의 c.walking)가 끝낸다
 */
registerRule((sim, s, I) => {
  if (s.variant !== 'false' || s.kind !== 'medical' || I.phase === 'closed') return;
  for (let ci = 0; ci < s.casualties.length; ci++) {
    const c = s.casualties[ci];
    if (c.dead || c.mob !== 'immobile' || c.where !== 'scene') continue;
    for (let k = 0; k < s.agents.length; k++) {
      const a = s.agents[k];
      if (a.status !== 'active' || a.aloft || dist(a.x, a.y, c.x, c.y) > WAKE_R) continue;
      c.mob = 'mobile'; c.walking = true; c.path = null; c.pathI = 0;
      const r = resp(sim, a);
      emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: `흔들어 깨우자 일어납니다 — 쓰러진 것이 아니라 술에 취해 잠들어 있었습니다. 귀가를 안내합니다.` });
      learn(sim, a, casFact(sim, s, c, r.name), true, true);
      break;
    }
  }
});
