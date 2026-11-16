// 대응 방법 (docs/specs/R2-methods.md) 의 세계 규칙. 진실을 읽고 바꾼다 (hazards.ts 와 같은 자격).
// scenes/index.ts 의 맨 끝(상공의 헬기 다음)에 등록한다 — 세계 규칙은 등록 순서대로 돈다.
//
// 단계 0 (틀)부터: 물이 있는 현장의 생김새 표시 둘을 정한다 — 기록도 난수도 없다. 단계 1a 부터 읽는 곳이 있다(손 뻗기의 조건, 투척 명중).
//   s.quay  물가가 높은 안벽인가 (선박 화재의 부두 — 손이 물에 닿지 않는다). 처음 한 번 정한다. 세계 규칙이라 시나리오 변형을 읽어도 된다 — 판단부는 이 표시만 본다 (methods.ts 의 hand)
//   s.flow  물살(칸/초). 물속 사람이 떠내려가는 속도의 최댓값을 따라 오르고, 내려가지는 않는다(사람이 걸려 멈춰도 강물은 흐른다). 실행부의 투척 명중이 읽는다 (methodRun.hitP)
// 단계 1b (물 위의 대원 — 모든 현장: 개울이 있는 수색 현장도):
//   보트 대원이 뭍 칸에 놓이면(해일이 옮긴 경우 등 — 보트 방법은 스스로 푼다)·보트로 철수하면(left) a.afloat 를 푼다
//   물 칸 위에 쓰러진(숨진) 대원을 물가로 옮긴다(methodRun.pullAshore — 기록 truth). agentHealth 는 act 보다 먼저 돌고 이 규칙은 다음 틱 첫 단계에서 돌므로
//   쓰러진 대원은 한 틱 동안 물 칸에 있을 수 있다. H1 의 동료 구조(rescueMate)는 물 칸의 동료를 물가에서 기다린다 — 이 규칙은 물 칸에서만 옮긴다
// 단계 2 (§4.2a — 사용자 결정 2026-11-15): 농성 문 잠금. 무장 현장에서 총을 든 용의자가 인질을 잡은 채 방에 있고 그 방의 (출입구가 아닌) 문이 하나뿐이며
//   그 방에 붙잡히지 않은 구조 대상이 없으면, 첫 대원이 내린 뒤 15~40초에 한 번 BARRICADE.p × 심각도 손잡이(상한 0.8) 확률로 그 문을 닫고 가구로 막는다
//   (plans.lockDoor 와 같은 처리 + p.skin = 'barricade'). 흐름은 barricade:<사건 id> 하나(결정 → 시각 → hp). 대원은 모른다 — 가서 막히면 지금의 discoverBlock 이 알린다
// 단계 4 (§3.5·§4.5): 송풍기 s.fan — 돌고 있는 동안 1초에 한 번 실내 칸의 연기를 빼고(×(1 − 0.2 × power)), 센 불(0.5 이상)은 공기가 들어가 조금 커진다(+0.006 × power).
//   끝나면(120초) 지운다. 가스(X6 의 가스 격자)에는 catastrophe.gasStep 이 출입구 3칸 안 × (1 − 0.3 × power) 로 따로 읽는다. 기록·난수 없음

import { emit } from '../../events';
import { T } from '../../types';
import type { Incident, Prop, Scene } from '../../types';
import { dist, josa } from '../../util';
import type { Sim } from '../../engine';
import { isIndoor, tileOf } from '../grid';
import { hostileActive, isHeld } from '../hazards';
import { pullAshore } from '../methodRun';
import { lockDoor } from '../plans';
import { registerRule } from '../sceneRegistry';
import type { SceneRule } from '../sceneRegistry';

/**
 * 농성 문 잠금의 손잡이 (§4.2a): p = 0.4 (0 이면 지금과 같다 — 끄는 손잡이. 흐름 fork 는 부모를 쓰지 않으므로 0 이면 결과가 한 글자도 바뀌지 않는다).
 * 막은 문의 작업량 hp 10~16 (충격기로 5~8초, 폭파 진입은 hp 와 상관없이 6.5초 + 물러서는 걸음)
 */
export const BARRICADE = { p: 0.4, at: [15, 40] as [number, number], hp: [10, 16] as [number, number], cap: 0.8 };
/** 현장마다 한 번 정한 결정 (첫 대원이 내린 때 정한다 — 객체 모양을 바꾸지 않으려 WeakMap. 되감기는 Sim 을 새로 만들어 다시 돈다) */
const barricades = new WeakMap<Scene, { go: boolean; at: number; hp: number }>();
/** 그 구역(방)에 맞닿은 문 (문 칸의 네 이웃이나 문 칸 자신이 그 구역) */
function roomDoors(s: Scene, room: number): Prop[] {
  const out: Prop[] = [], w = s.w;
  for (const p of s.props) {
    if (p.kind !== 'door' || p.removed) continue;
    const i = p.y * w + p.x;
    if (s.region[i] === room || s.region[i - 1] === room || s.region[i + 1] === room || s.region[i - w] === room || s.region[i + w] === room) out.push(p);
  }
  return out;
}
/** 농성 문 잠금: 정한 시각에 한 번 조건을 보고, 맞으면 그 방의 하나뿐인 문을 막는다 (진실을 바꾼다 — 세계 규칙) */
function barricadeRule(sim: Sim, s: Scene, I: Incident): void {
  if (s.kind !== 'armed' || s.outdoor || s.arrivedAt < 0) return;
  let st = barricades.get(s);
  if (st === undefined) {
    const rng = sim.rng.fork('barricade:' + I.id);
    const go = rng.chance(Math.min(BARRICADE.cap, BARRICADE.p * sim.tune.hazardMul));
    st = { go, at: s.arrivedAt + rng.range(BARRICADE.at[0], BARRICADE.at[1]), hp: rng.range(BARRICADE.hp[0], BARRICADE.hp[1]) };
    barricades.set(s, st);
  }
  if (st.at < 0 || sim.t < st.at) return;
  st.at = -1;      // 한 번만 본다
  if (!st.go || I.phase === 'closed') return;
  for (const h of s.hostiles) {
    if (h.weapon !== 'gun' || h.hostageId < 0 || (h.state !== 'hold' && h.state !== 'fight') || !hostileActive(h)) continue;
    const room = s.region[tileOf(s, h.x, h.y)];
    if (room < 0 || s.regions[room].kind !== 'room') continue;
    const doors = roomDoors(s, room).filter((p) => !s.exits.some((e) => dist(e.x, e.y, p.x, p.y) <= 1.5));      // 동시 진입의 출입문은 잠그지 않는다
    if (doors.length !== 1) continue;
    const d = doors[0], di = d.y * s.w + d.x;
    if (d.locked || d.blocking || d.entered || s.propAt[di] >= 0) continue;
    // 그 방에 붙잡히지 않은 구조 대상이 있으면 막지 않는다 (인질만 남은 방 — 총을 든 용의자 곁에 붙잡힌 인질은 hazards.isHeld)
    let free = false;
    for (const c of s.casualties) if (!c.dead && c.where === 'scene' && s.region[tileOf(s, c.x, c.y)] === room && !isHeld(sim, s, c.id)) { free = true; break; }
    if (free) continue;
    // 문 칸에 누가 서 있으면 닫지 못한다
    let occupied = false;
    for (const a of s.agents) if (a.status !== 'left' && tileOf(s, a.x, a.y) === di) occupied = true;
    for (const c of s.casualties) if (!c.dead && c.where === 'scene' && tileOf(s, c.x, c.y) === di) occupied = true;
    for (const g of s.hostiles) if (hostileActive(g) && tileOf(s, g.x, g.y) === di) occupied = true;
    if (occupied) continue;
    lockDoor(s, d, st.hp);
    d.skin = 'barricade';
    s.staticVersion++;
    emit(sim, { inc: I.id, truth: true, role: 'SYSTEM', actor: '현장', kind: 'hazard', imp: 1, text: `${josa(h.label, '이/가')} 방 문을 걸어 잠그고 가구로 막았습니다.` });
    return;
  }
}

/** 송풍기 (§3.5 — 단계 4): 1초에 실내 연기 × (1 − smoke × power), 불 0.5 이상인 칸 + fire × power */
export const FAN = { smoke: 0.2, fire: 0.006 };
/** 돌고 있는 송풍기의 효과 (1초에 한 번 — 화재·연기와 같은 박자, 그 틱의 연기 확산 다음). 끝나면 지운다 */
function fanRule(sim: Sim, s: Scene): void {
  const f = s.fan;
  if (!f) return;
  if (sim.t >= f.until) { s.fan = null; return; }
  if ((sim.tick + s.id) % 5 !== 0) return;
  const k = 1 - FAN.smoke * f.power, up = FAN.fire * f.power, tiles = s.tiles, sm = s.smoke, fire = s.fire, n = tiles.length;
  for (let i = 0; i < n; i++) {
    if (!isIndoor(tiles[i])) continue;
    if (sm[i] > 0) { const v = sm[i] * k; sm[i] = v < 0.01 ? 0 : v; }
    if (fire[i] >= 0.5) fire[i] = Math.min(1, fire[i] + up);
  }
}

/** 물살의 바닥값 (칸/초): 떠내려가는 사람이 없어도 강물은 이만큼 흐른다 */
export const FLOW_MIN = 0.02;

/** 시험이 이 규칙을 SCENE_RULES 에서 찾을 수 있게 이름을 붙여 내보낸다 */
export const methodsRule: SceneRule = (sim, s, I) => {
  // (1b) 물 위의 대원 안전장치 — 쓰러진 대원과 보트 위 대원만 칸을 본다 (그 밖은 칸 하나도 읽지 않는다)
  const ag = s.agents;
  for (let k = 0; k < ag.length; k++) {
    const a = ag[k];
    if (a.afloat !== undefined && (a.status === 'left' || s.tiles[tileOf(s, a.x, a.y)] !== T.WATER)) a.afloat = undefined;      // 철수(보트로 떠남 — case 'board' 의 길 없음)도 내린다
    if (a.status === 'down' && s.tiles[tileOf(s, a.x, a.y)] === T.WATER) pullAshore(sim, s, I, a, '쓰러짐');
  }
  barricadeRule(sim, s, I);      // (단계 2) 무장 현장의 농성 문 잠금 — 물이 없는 현장이라 아래의 첫 줄보다 먼저
  fanRule(sim, s);      // (단계 4) 송풍기 — 화재·가스 현장 (물이 없는 현장이라 아래의 첫 줄보다 먼저)
  if (s.kind !== 'water' && (s.rules === undefined || s.rules.indexOf('water') < 0)) return;      // 물이 없는 현장 (매 틱 모든 현장에서 도는 길 — 칸 둘만 읽는다)
  if (s.quay === undefined) s.quay = s.variant === 'ship';
  if ((sim.tick + s.id) % 5 !== 0 || I.phase === 'closed') return;      // 1초에 한 번. 현장 환경은 첫 부대가 오기 전부터 돌므로 처음 떠내려가는 속도를 놓치지 않는다
  let f = s.flow ?? FLOW_MIN;
  const cs = s.casualties;
  for (let k = 0; k < cs.length; k++) { const c = cs[k]; if (c.inWater && !c.dead && c.drift !== undefined && c.drift > f) f = c.drift; }
  s.flow = f;
};
registerRule(methodsRule);
