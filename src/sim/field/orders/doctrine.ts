// 대응 교본 (docs/specs/R3-doctrine.md §6.1) 의 지휘 규칙. 지휘관의 믿음과 작업판·조직 정보만 읽는다 — 진실을 읽지 않는다
// (tests/ext.test.ts 와 tests/doctrine.test.ts 시험 1 이 이 파일의 주석이 아닌 줄을 글자로 검사한다. 주석은 줄 주석으로만 쓰고, 어떤 주석에도 그 시험의 금지어를 쓰지 않는다).
// 남의 몸은 대원의 자기 신고('crew' 사실)로만 안다.
//
// 단계 0 (틀): 아무것도 등록하지 않았다. 지휘 줄(CP·CF·CE·CS)은 그 분야의 단계가 registerOrders 로 채우고, 이름표는 doctrine/registry.ts 의 CMD_ROWS 에 둔다.
// 단계 2 (경찰): CP2(흉기 난동 — 쓸 수 있는 경찰이 둘이 안 되고 오는 경찰 부대가 없으면 22초를 기다리지 않고 부른다) · CP3(탄 위급 신고가 있는데 현장 경찰 부대의 탄약 상자가 모두 비었다).
//   CP1(쓸 수 있는 경찰로 문턱)·CP4(섬광탄 없는 인질 진입 보류)는 commander.ts 의 무장 블록에 있다(그 문턱의 수를 바꾸는 자리라서). 요청은 commander.request 가 돌려준 기록 id 가 0 이상일 때만 센다.

import type { CrewBelief, FieldAgent, HosBelief, Incident, Scene } from '../../types';
import type { Sim } from '../../engine';
import { registerOrders } from '../sceneRegistry';
import { copUsable } from '../doctrine';
import { groupOf, gunOf } from '../gear';
import { recordDoc } from '../doctrineRun';

/** 이 사건으로 오는 경찰 부대의 수 (조직 정보 — 현장에 닿은 부대는 세지 않는다) */
function lawComing(sim: Sim, I: Incident): number {
  let n = 0;
  for (const uid of I.assigned) { const u = sim.units[uid]; if (u.caps.law >= 0.5 && (u.state === 'enroute' || u.state === 'turnout')) n++; }
  return n;
}
/** 지휘관이 아는 쓸 수 있는 경찰의 수: 총을 든 활동 경찰(폭발물 처리 요원·로봇 조작 요원 빼고, 걸을 수 있는 다친 대원 빼고) 가운데 중상 신고·탄 위급이 아닌 사람 (commander 의 CP1 과 같은 셈) */
function usableCops(sim: Sim, s: Scene, a: FieldAgent): number {
  let n = 0;
  for (const b of s.agents) {
    const r = sim.responders[b.rid];
    if (b.status !== 'active' || r.dept !== 'police' || r.status === 'injured' || gunOf(sim, b.rid) === null || groupOf(sim, b.rid) === 'bomb') continue;
    if (copUsable(sim, a, b)) n++;
  }
  return n;
}

registerOrders((sim, s, I, a, k) => {
  // CP2: 흉기 난동 — 맞서는 흉기 용의자가 있고 쓸 수 있는 경찰이 둘이 안 되며 오는 경찰 부대가 없다
  const hos = a.beliefs.list('hos');
  let knifeFight = false;
  for (const f of hos) { const v = f.value as HosBelief; if (v.weapon === 'knife' && v.state === 'fight') { knifeFight = true; break; } }
  if (knifeFight && usableCops(sim, s, a) < 2 && lawComing(sim, I) === 0) {
    const ev = k.request('law', '흉기 난동 — 2인 제압 인력 부족', true);
    if (ev >= 0) recordDoc(sim, I, null, 'CP2', 'cmd', {}, ev);
  }
  // CP3: 탄 위급 신고(자기 신고 'crew' 의 ammo 2)가 있는데 현장 경찰 부대의 탄약 상자가 모두 비었다
  let crit = false;
  for (const f of a.beliefs.list('crew')) { const v = f.value as CrewBelief; if (v.ammo === 2) { crit = true; break; } }
  if (crit) {
    let boxes = 0, any = false;
    for (const uid of k.unitsOnScene()) { const u = sim.units[uid]; if (u.dept !== 'police' || u.ammoBoxMax === undefined || u.ammoBoxMax <= 0) continue; any = true; boxes += u.ammoBox ?? 0; }
    if (any && boxes === 0) {
      const ev = k.request('law', '탄약 보급 필요', false);
      if (ev >= 0) recordDoc(sim, I, null, 'CP3', 'cmd', {}, ev);
    }
  }
  fireOrders(sim, s, I, a, k);      // (3단계) 소방의 지휘 줄 — 이 등록 하나가 지휘 교본 전체다(시험이 마지막 registerOrders 를 부른다)
});

// ── 단계 3 (소방): CF1(2인 대기조 확보 — 위험 실내 일이 열려 있는데 그 출입구의 밖 대기조가 모자라고 오는 진압 부대가 없다, 사건마다 한 번) ·
//   CF2(공기통 예비 소진 — 현장 공기호흡기 부대의 예비 공기통 합이 0 이고 공기 낮음 신고가 둘 이상) · CF4(유압 장비 — 고립자가 있는데 현장·오는 부대에 쓸 수 있는 유압 구조기가 없다).
//   CF3(펌프 고장 — 진압 부대 교체)·CF7(지휘관은 밖에)은 commander.ts 의 그 자리(요청 줄·배정 반복), CF5·CF6 은 orders/catastrophe.ts 의 위험 단계 표(DANGER_RULES)에 있다
import type { CasBelief as CasB, Pt } from '../../types';
import { docSit, inJob, nearestExit, outsideWatch, regionOfWork, watchNeed } from '../doctrine';
import { crewHas, kitHas, kitQty } from '../gear';
import type { CommandKit } from '../sceneRegistry';
/** CF1 을 이미 부른 사건 (사건마다 한 번 — 사건의 모양을 바꾸지 않으려 WeakSet) */
const CF1_DONE = new WeakSet<Incident>();
/** 이 사건으로 오는 진압 부대의 수 (조직 정보) */
function fireComing(sim: Sim, I: Incident): number {
  let n = 0;
  for (const uid of I.assigned) { const u = sim.units[uid]; if (u.caps.suppression >= 0.7 && (u.state === 'enroute' || u.state === 'turnout')) n++; }
  return n;
}
/** 지휘관 자신도 밖 대기조로 서는가 (§5.6 — 공기호흡기·공기 AIR_IN 이상·위험 실내 밖·출입구 8칸 안·업고 있지 않음) */
function selfWatch(sim: Sim, s: Scene, a: FieldAgent, ex: Pt): boolean {
  if (!kitHas(sim, a.rid, 'scba') || kitQty(sim, a.rid, 'scba') < 0.5 * sim.tune.airFull || a.carrying !== -1) return false;
  return !docSit(sim, s, a).inHazard && Math.hypot(a.x - ex.x, a.y - ex.y) <= 8;
}
/** (3단계) 소방의 지휘 줄 CF1·CF2·CF4 — 위의 지휘 교본 등록 끝에서 부른다 */
function fireOrders(sim: Sim, s: Scene, I: Incident, a: FieldAgent, k: CommandKit): void {
  // CF1: 위험 실내 일이 열려 있고 그 출입구의 밖 대기조 < 필요한 수, 오는 진압 부대 0 → 진압 부대 요청 (사건마다 한 번)
  if (!CF1_DONE.has(I) && fireComing(sim, I) === 0 && s.agents.some((b) => b.status === 'active' && b.task !== null && b.task.gateId === 'interiorEntry' && (b.task.gateAt ?? -1) >= 0 && b.task.docRule === 'F05')) {      // (3단계 측정) 대기조 때문에 문턱에서 기다리는 대원이 있을 때만 (본문은 열린 위험 실내 일만 보았다 — 진압 부대를 너무 자주 불러 다른 사건이 늦어졌다)
    let ex: Pt | null = null;
    for (const w of s.board) {
      if ((w.status !== 'open' && w.status !== 'active') || !inJob(sim, s, a, w)) continue;
      const rg = regionOfWork(s, a, w);
      if (rg >= 0 && s.regions[rg] !== undefined) { ex = nearestExit(s, s.regions[rg].cx, s.regions[rg].cy); break; }
    }
    if (ex !== null && outsideWatch(sim, s, a, ex) + (selfWatch(sim, s, a, ex) ? 1 : 0) < watchNeed(sim, s)) {
      const ev = k.request('suppression', '2인 대기조 확보', false);
      if (ev >= 0) { recordDoc(sim, I, null, 'CF1', 'cmd', {}, ev); CF1_DONE.add(I); }
    }
  }
  // CF2: 현장 공기호흡기 부대의 예비 공기통 합 0 이고, 현장 대원 가운데 공기 낮음 신고(자기 신고 'crew' 의 air ≥ 1)가 둘 이상
  let low = 0;
  for (const f of a.beliefs.list('crew')) { const v = f.value as CrewBelief; if (v.air >= 1 && s.agents.some((b) => b.rid === f.id && b.status === 'active')) low++; }
  if (low >= 2) {
    let spare = 0, any = false;
    for (const uid of k.unitsOnScene()) { const u = sim.units[uid]; if (!crewHas(sim, u, 'scba')) continue; any = true; spare += u.spareAir ?? 0; }
    if (any && spare === 0) { const ev = k.request('suppression', '공기통 예비 소진', true); if (ev >= 0) recordDoc(sim, I, null, 'CF2', 'cmd', {}, ev); }
  }
  // CF4: 믿음 속 고립자(현장에 갇힌 사람)가 있는데 현장·오는 부대에 쓸 수 있는(알려진 고장 아닌) 유압 구조기를 든 대원이 없다. 구조 능력의 부대가 하나도 없으면 지금의 '구조 장비 부대 없음' 요청이 부른다
  let trapped = false;
  for (const f of a.beliefs.list('cas')) { const c = f.value as CasB; if (c.mob === 'trapped' && c.band < 3 && c.where === 'scene') { trapped = true; break; } }
  if (trapped && k.countUnits('rescue', 0.5) > 0) {
    let has = false;
    for (const uid of I.assigned) {
      const u = sim.units[uid];
      if (!((u.state === 'onscene' && u.incidentId === I.id) || u.state === 'enroute' || u.state === 'turnout')) continue;
      if (crewHas(sim, u, 'spreader')) { has = true; break; }
    }
    if (!has) { const ev = k.request('rescue', '쓸 수 있는 유압 장비 없음 — 구조 장비 필요', true); if (ev >= 0) recordDoc(sim, I, null, 'CF4', 'cmd', {}, ev); }
  }
}
