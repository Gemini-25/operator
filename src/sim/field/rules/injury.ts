// 부상과 사망 (H1) — 세계 규칙. 진실을 읽고 바꾼다 (hazards.ts 와 같은 자격).
//   단계 3  스스로 대피하다 위중(체력 40 이하)이 된 사람이 멈춘다 (설계서 H1 §5.2) — 아래
//   단계 4c 열 탈진, 붕괴 현장의 잔해 바닥 추락 (§2.3) — 아래 (덮쳐 제압할 때의 몸싸움은 실행기의 검거 자리 — executor.scuffle)
// 뒤 단계가 여기에 채운다:
//   단계 5  용의자의 상처 출혈과 그로 인한 사망 (§4.1)
// 매 틱 모든 현장에서 불리므로, 다친 사람이 없는 현장은 싼 검사 하나로 지나가게 하고 배열을 새로 만들지 않는다 (§12.2-7).
// 사건이 끝난 뒤(I.phase === 'closed')에는 아무것도 하지 않는다 (§2.6).

import type { Sim } from '../../engine';
import { emit } from '../../events';
import type { Casualty, FieldAgent, Incident, Scene } from '../../types';
import { josa } from '../../util';
import { isIndoor, tileOf } from '../grid';
import { CAUSE_NAME, DOWN_AT, decayCause, hurtResponder, injuryRng } from '../injury';
import type { HurtOpts } from '../injury';
import { registerRule } from '../sceneRegistry';

/** 스스로 대피하던 사람이 더 걷지 못하게 되는 체력 — 위중(중증도 2)의 경계. 그 아래로는 누가 데리러 가야 한다 */
export const WALK_STOP = 40;

/**
 * 스스로 대피하던 사람이 위중이 되어 쓰러진다 (§5.2). 걷는 사람도 연기·불을 지나며 체력을 잃는다(tickCasualties) — 예전에는 체력 0 까지 걸었다.
 * 관찰자만 아는 사실이다(진실 기록): 지휘관은 본 대원의 보고나, 대피 중이라던 사람의 소식이 끊겼을 때의 규칙
 * (32초 뒤 동행 확인, 현장이 비었을 때의 outstanding)으로 알게 된다.
 * 원인은 지금 선 자리에서 가장 크게 깎는 항 — tickCasualties 의 악화 식과 같은 항을 읽기만 한다(이름을 고르는 데만 쓴다).
 */
function collapseWalker(sim: Sim, s: Scene, I: Incident, c: Casualty): void {
  const i = tileOf(s, c.x, c.y);
  const wound = c.bystander && c.treatQ <= 0 ? c.bleed * 0.5 : c.bleed;
  const smoke = s.smoke[i] * (s.kind === 'hazmat' ? 0.62 : 0.36);
  const burn = s.fire[i] > 0.3 ? 2.6 * s.fire[i] : 0;
  const expo = !isIndoor(s.tiles[i]) && (c.isTarget || s.kind === 'search') ? s.exposure : 0;
  const cause = decayCause(c, s, I, wound, smoke, burn, expo);
  c.walking = false; c.mob = 'immobile'; c.path = null;
  c.causeEvent = emit(sim, {
    inc: I.id, role: 'SYSTEM', actor: '현장', kind: 'casualty', imp: 2, truth: true, causes: [c.causeEvent],
    text: `대피하던 구조 대상 ${josa(c.label, '이/가')} ${josa(CAUSE_NAME[cause], '으로/로')} 쓰러졌습니다.`,
  });
}

// ───────────────────────── 단계 4c: 대원 — 열 탈진 · 잔해 바닥 추락 (§2.3) ─────────────────────────
/**
 * 열 탈진: 소방 대원이 지쳐(지구력 HEAT_STAMINA 이하) 열 속(곁 1칸 안 불 ≥ 0.3, 또는 선 칸의 연기 ≥ 0.4)에 있으면 초당 HEAT_DMG (방호 없음 — 매 틱 피해).
 * 이 원인으로는 체력이 DOWN_AT 아래로 내려가지 않는다(탈진으로 숨지지 않는다). 소방 대원은 지구력 22 아래에서 쉬고 8 아래에서 물러나므로(brain.ts)
 * 거의 일어나지 않는다 — 사실상 안전장치다. 균형 손잡이의 마지막 차례(§9.3-5)
 */
export const HEAT_STAMINA = 10, HEAT_DMG = 0.5;
/**
 * 잔해 바닥 추락: 붕괴 현장의 잔해 칸(s.damage === 1)에 활동 중인 대원이 새로 들어설 때 확률 FALL_P × hazardMul (흐름 injury:<현장>:fall),
 * 걸리면 같은 흐름에서 FALL_HIT 의 피해(원인 fall — 방화복 0.2). 대원마다 사건당 한 번(a.fellOnce). 목표는 붕괴 현장 사건당 0.3건 이하 (§2.3)
 */
export const FALL_P = 0.002, FALL_HIT: readonly [number, number] = [8, 20];
const HEAT_TICK: HurtOpts = { tick: true };

/** 열 속인가: 곁 1칸 안에 불(0.3 이상)이 있거나 선 칸의 연기가 0.4 이상 */
function inHeat(s: Scene, i: number): boolean {
  if (s.smoke[i] >= 0.4) return true;
  const ax = i % s.w, ay = (i / s.w) | 0;
  for (let y = Math.max(0, ay - 1); y <= Math.min(s.h - 1, ay + 1); y++) for (let x = Math.max(0, ax - 1); x <= Math.min(s.w - 1, ax + 1); x++) if (s.fire[y * s.w + x] >= 0.3) return true;
  return false;
}

/** 잔해 칸에 새로 들어섰는가를 보고, 들어섰으면 미끄러질지 한 번 추첨한다. 기록은 상태를 바꾸는 이 자리에서 먼저 남기고 그 id 를 피해에 넘긴다 */
function rubbleStep(sim: Sim, s: Scene, I: Incident, a: FieldAgent, i: number): void {
  const prev = a.lastTile;
  a.lastTile = i;
  if (prev === undefined || prev === i || a.status !== 'active' || a.fellOnce || s.damage[i] !== 1) return;      // 처음 본 칸은 들어선 것으로 치지 않는다
  const rng = injuryRng(sim, s, 'fall');
  if (!rng.chance(FALL_P * sim.tune.hazardMul)) return;
  const raw = rng.range(FALL_HIT[0], FALL_HIT[1]);
  a.fellOnce = true;
  const r = sim.responders[a.rid];
  const ev = emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'hazard', imp: 1, text: `${r.name} 대원 잔해 위에서 미끄러져 다침.` });
  hurtResponder(sim, s, I, a, raw, 'fall', { ev });
}

registerRule((sim, s, I) => {
  if (I.phase === 'closed') return;
  const cs = s.casualties;
  for (let k = 0; k < cs.length; k++) {
    const c = cs[k];
    // 체력이 이미 0 이하인 사람은 다음 틱에 악화 규칙이 사망으로 판정한다 — 쓰러짐을 따로 적지 않는다
    if (!c.walking || c.health > WALK_STOP || c.health <= 0 || c.dead || c.where !== 'scene') continue;
    collapseWalker(sim, s, I, c);
  }
  responderHazards(sim, s, I);
});

/** 대원 (단계 4c): 붕괴 현장의 잔해 바닥 추락, 지친 소방 대원의 열 탈진. 차에 탔거나 숨진 대원은 건너뛴다. 판정 뒤에는 부르지 않는다(위의 규칙 첫 줄). export 는 시험용 */
export function responderHazards(sim: Sim, s: Scene, I: Incident): void {
  const rubble = s.kind === 'collapse';
  const ag = s.agents;
  for (let k = 0; k < ag.length; k++) {
    const a = ag[k];
    if (a.status === 'left') continue;
    const r = sim.responders[a.rid];
    if (r.dead) continue;
    const heatRisk = r.stamina <= HEAT_STAMINA && r.dept === 'fire';
    if (!rubble && !heatRisk) continue;
    const i = tileOf(s, a.x, a.y);
    if (rubble) rubbleStep(sim, s, I, a, i);
    if (heatRisk && r.health > DOWN_AT && inHeat(s, i)) hurtResponder(sim, s, I, a, Math.min(HEAT_DMG * sim.dt, r.health - DOWN_AT), 'exhaustion', HEAT_TICK);      // 탈진으로는 쓰러질 체력 아래로 가지 않는다
  }
}
