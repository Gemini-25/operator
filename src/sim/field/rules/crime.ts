// 강력 범죄 (docs/specs/N4b-crime.md) 의 세계 규칙. 진실을 읽고 바꾼다 (hazards.ts 와 같은 자격).
// registerRule((sim, s, I) => { ... }) 로 등록한다. 자기 현장이 아니면 첫 줄에서 돌아간다.

import type { Sim } from '../../engine';
import { raiseProblem } from '../../events';
import { T } from '../../types';
import type { Incident, Prop, Scene } from '../../types';
import { dist } from '../../util';
import { learn, regionNameAt } from '../agents';
import { mkFact } from '../beliefs';
import { los, tidx } from '../grid';
import { blast, isHeld, pushFx } from '../hazards';
import { lastFx, noteBoom } from '../fxlog';
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
    const bl0 = c.bleed;
    c.bleed = Math.max(c.bleed, (0.09 + 0.09 * (1 - d / 3.4)) * sim.tune.bleedMul); c.bleed0 = c.bleed;
    if (c.bleed > bl0) c.bleedCause = 'blast';      // (H1) 기록만 — 체력 피해는 위의 blast 가 이미 적었다
  }
  // 불: 둘레 두 칸의 바닥과 가구 (벽 너머로는 번지지 않는다)
  for (let y = Math.max(0, p.y - 2); y <= Math.min(s.h - 1, p.y + 2); y++) for (let x = Math.max(0, p.x - 2); x <= Math.min(s.w - 1, p.x + 2); x++) {
    const j = tidx(s, x, y), t = s.tiles[j];
    if ((t !== T.FLOOR && t !== T.FURN) || dist(x, y, p.x, p.y) > 2.3 || !los(s, p.x, p.y, x, y)) continue;
    if (s.fuel[j] <= 0) s.fuel[j] = 0.6;
    s.fire[j] = Math.max(s.fire[j], 0.55);
  }
  pushFx(sim, s, 'boom', p.x, p.y, undefined, undefined, undefined, undefined, 1.6);
  noteBoom(lastFx(sim, s, 'boom'), 3.4, 'bomb');
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

// ───────────────────────── 대형 인질극 ─────────────────────────
// 풀려난 인질은 곁에 온 경찰에게 안에 남은 용의자가 어디 있는지 알려 준다 (대원이 직접 본 것이 아니므로 확인되지 않은 정보다).
// 이 말이 없으면 홀의 무리를 제압한 지휘관이 위협이 사라졌다고 보고 수색을 시키고, 수색하던 대원이 안쪽 방 문을 열다가 용의자와 마주친다.
registerRule((sim, s, I) => {
  if (s.variant !== 'siege' || s.kind !== 'armed' || I.phase === 'closed' || (sim.tick + s.id) % 5 !== 0) return;
  const left = s.hostiles.filter((h) => h.state === 'hold' || h.state === 'fight');
  if (!left.length) return;
  for (const c of s.casualties) {
    if (!c.hostage || c.dead || c.tDiscovered < 0 || c.where === 'loaded' || c.where === 'hospital' || isHeld(sim, s, c.id)) continue;
    const a = s.agents.find((b) => b.status === 'active' && sim.responders[b.rid].dept === 'police' && dist(b.x, b.y, c.x, c.y) <= 3 && los(s, b.x, b.y, c.x, c.y));
    if (!a) continue;
    for (const h of left) {
      if (a.beliefs.get('hos', h.id)) continue;      // 이미 알고 있는 용의자
      learn(sim, a, mkFact('hos', h.id, { x: Math.round(h.x), y: Math.round(h.y), weapon: h.weapon, state: 'hold', hostage: h.hostageId >= 0, facing: Math.round(h.facing * 4) / 4 }, '풀려난 인질', sim.t, 0.8, false,
        `풀려난 인질의 말: ${regionNameAt(s, h.x, h.y)}에 총을 든 사람이 더 있음${h.hostageId >= 0 ? ' · 인질을 붙잡고 있음' : ''}`));
    }
    return;
  }
});
