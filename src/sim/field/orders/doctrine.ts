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
  cs1(sim, s, I, a, k);      // (5단계 — 특수) 해체 반경 비우기 (아래 — 같은 등록 안에서 부른다: 시험이 이 파일의 등록을 ORDER_RULES 의 마지막으로 부른다)
});

// ───────────────────────── (5단계 — 특수) CS1: 해체 시작 — 장치 반경 비우기 ─────────────────────────
// 믿음 속 살아 있는 장치 곁에서 동료의 해체가 진행 중이면(동료의 겉 — 장치 곁 2칸, 또는 자리를 잡고 시작한 로봇 원격 해체) 장치 6칸 안의 열린 일을 거둔다.
// 해체·출입 통제와 사람을 반경 밖으로 옮기는 일(이송·대피 안내·동료 구조)은 남긴다. 알림은 장치마다 한 번. 같은 판정을 교본 S08(fit)이 안전망으로 쓴다
/** 장치 반경 (칸 — 교본 S08 과 같은 값) */
const CS1_R = 6;
/** 거두지 않는 일 */
const CS1_KEEP: ReadonlySet<string> = new Set<string>(['defuse', 'perimeter', 'carry', 'escort', 'rescueMate']);
/** 현장마다 알린 장치 (현장의 모양을 바꾸지 않으려 WeakMap — 되감기는 Sim 을 새로 만든다) */
const CS1_SAID = new WeakMap<Scene, Set<number>>();
/** 작업의 대상 자리 (지휘관의 믿음과 현장의 생김새로): 구조 대상·동료·용의자의 믿음 위치, 구역 가운데, 칸. 모르면 null */
function workPos(s: Scene, a: FieldAgent, w: WorkItem): { x: number; y: number } | null {
  if (w.cas >= 0) { const c = a.beliefs.val<{ x: number; y: number }>('cas', w.cas); if (c) return c; }
  if (w.mate >= 0) { const m = a.beliefs.val<{ x: number; y: number }>('mate', w.mate); if (m) return m; }
  if (w.hostile >= 0) { const h = a.beliefs.val<{ x: number; y: number }>('hos', w.hostile); if (h) return h; }
  if (w.region >= 0 && s.regions[w.region]) return { x: s.regions[w.region].cx, y: s.regions[w.region].cy };
  if (w.tile >= 0 && w.kind !== 'traffic' && w.kind !== 'perimeter') return { x: w.tile % s.w, y: (w.tile / s.w) | 0 };
  return null;
}
function cs1(sim: Sim, s: Scene, I: Incident, a: FieldAgent, k: CommandKit): void {
  for (const f of a.beliefs.list('haz')) {
    const v = f.value as { kind: string; active: boolean; x: number; y: number };
    if (v.kind !== 'bomb' || !v.active) continue;
    let on = false;
    for (const b of s.agents) if (b.status === 'active' && b.task !== null && b.task.kind === 'defuse' && (Math.hypot(b.x - v.x, b.y - v.y) <= 2 || (b.task.method === 'robotDefuse' && b.task.phase >= 1))) { on = true; break; }
    if (!on) continue;
    let n = 0;
    k.cancel((w) => { if (CS1_KEEP.has(w.kind)) return false; const p = workPos(s, a, w); if (p === null || Math.hypot(p.x - v.x, p.y - v.y) > CS1_R) return false; n++; return true; });
    let said = CS1_SAID.get(s);
    if (said === undefined) { said = new Set(); CS1_SAID.set(s, said); }
    if (said.has(f.id)) continue;
    said.add(f.id);
    const ev = emit(sim, { inc: I.id, role: 'COMMANDER', actor: sim.responders[a.rid].name, rid: a.rid, kind: 'command', imp: 1, text: `해체 시작 — 반경 ${CS1_R}칸 비워라.${n ? ` (작업 ${n}건 거둠)` : ''}` });
    recordDoc(sim, I, null, 'CS1', 'cmd', { tgt: 'p' + f.id }, ev);
  }
}
// (import 를 이 절에 둔 것은 위의 import 묶음을 다른 단계가 함께 고치고 있어서다)
import { emit } from '../../events';
import type { WorkItem } from '../../types';
import type { CommandKit } from '../sceneRegistry';
