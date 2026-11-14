// 강력 범죄 (docs/specs/N4b-crime.md) 의 세계 규칙. 진실을 읽고 바꾼다 (hazards.ts 와 같은 자격).
// registerRule((sim, s, I) => { ... }) 로 등록한다. 자기 현장이 아니면 첫 줄에서 돌아간다.

import type { Sim } from '../../engine';
import { raiseProblem } from '../../events';
import { T } from '../../types';
import type { Incident, Prop, Scene } from '../../types';
import { dist } from '../../util';
import { mkFact } from '../beliefs';
import { los, tidx } from '../grid';
import { blast, pushFx } from '../hazards';
import { registerRule } from '../sceneRegistry';

// ───────────────────────── 폭발물 ─────────────────────────
/**
 * 장치가 터진다 (시한이 됐거나, 해체하다 실수했다).
 * 가까이 있던 사람이 다치고 쓰러지며, 둘레 두 칸에 불이 붙는다. 터지는 소리는 현장의 모두가 듣는다.
 */
export function detonate(sim: Sim, s: Scene, I: Incident, p: Prop): void {
  if (p.exploded || p.mitigated) return;
  p.exploded = true; p.ignited = true;      // ignited: 판정(debrief)이 재산 피해로 센다
  p.blocking = false; s.propAt[tidx(s, p.x, p.y)] = -1;      // 터진 자리는 더 이상 길을 막지 않는다
  const rg = s.region[tidx(s, p.x, p.y)], where = rg >= 0 ? s.regions[rg].name : '건물 안';
  const ev = raiseProblem(sim, I, 'ESCALATION', '폭발물 폭발', { role: 'SYSTEM', actor: '현장', imp: 3, truth: s.arrivedAt < 0, text: `폭발! ${where}에 있던 폭발물이 터졌습니다.` }, false);
  blast(sim, s, I, p.x, p.y, 3.4, 55, ev);
  // 폭발에 휩쓸린 사람은 쓰러져 스스로 나오지 못한다
  for (const c of s.casualties) {
    if (c.dead || c.where !== 'scene' || c.health >= 80) continue;
    const d = dist(c.x, c.y, p.x, p.y);
    if (d > 3.4) continue;
    if (c.mob === 'mobile') c.mob = 'immobile';
    c.walking = false; c.path = null;
    c.bleed = Math.max(c.bleed, (0.09 + 0.09 * (1 - d / 3.4)) * sim.tune.bleedMul); c.bleed0 = c.bleed;
  }
  // 불: 둘레 두 칸의 바닥과 가구 (벽 너머로는 번지지 않는다)
  for (let y = Math.max(0, p.y - 2); y <= Math.min(s.h - 1, p.y + 2); y++) for (let x = Math.max(0, p.x - 2); x <= Math.min(s.w - 1, p.x + 2); x++) {
    const j = tidx(s, x, y), t = s.tiles[j];
    if ((t !== T.FLOOR && t !== T.FURN) || dist(x, y, p.x, p.y) > 2.3 || !los(s, p.x, p.y, x, y)) continue;
    if (s.fuel[j] <= 0) s.fuel[j] = 0.6;
    s.fire[j] = Math.max(s.fire[j], 0.55);
  }
  pushFx(sim, s, 'boom', p.x, p.y, undefined, undefined, undefined, undefined, 1.6);
  s.staticVersion++;
  // 폭발음은 현장 어디서나 들린다: 더는 해체할 것이 없다는 사실이 무전망으로 곧 퍼진다
  s.radio.push({ id: s.nextMsgId++, t: sim.t, deliverAt: sim.t + 0.6, from: -1, to: -1, kind: 'report', facts: [mkFact('haz', p.id, { kind: 'bomb', active: false, x: p.x, y: p.y }, '현장', sim.t, 1, true, '폭발물 폭발')], workId: -1, text: '', eventId: ev });
}

// 시한이 된 진짜 장치는 터진다 (해체하는 동안에도 시한은 흐른다)
registerRule((sim, s, I) => {
  if (I.phase === 'closed') return;
  for (const p of s.props) if (p.kind === 'bomb' && p.real && !p.mitigated && !p.exploded && p.fuse !== undefined && sim.t >= p.fuse) detonate(sim, s, I, p);
});

// ───────────────────────── 폭동 ─────────────────────────
// 한패가 붙잡히거나 손을 들수록 흉기를 든 주동자의 기세가 꺾인다. 혼자 남으면 몇 초 안에 손을 든다
// (없으면 마지막 주동자가 멀리 선 대원만 노려보며 끝없이 버틴다: 협상은 싸우는 동안 멈추고, 붙잡으러 갈 손이 남지 않는다)
registerRule((sim, s, I) => {
  if (s.variant !== 'riot' || s.kind !== 'armed' || I.phase === 'closed') return;
  let total = 0, up = 0;
  for (const h of s.hostiles) { total++; if (h.state === 'hold' || h.state === 'fight' || h.state === 'flee') up++; }
  if (!total || up === total) return;
  const drain = 0.03 * (1 - up / total) * sim.dt;
  for (const h of s.hostiles) if (h.weapon !== 'none' && (h.state === 'hold' || h.state === 'fight')) h.morale -= drain;
});
