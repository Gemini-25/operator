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
  fireOrders(sim, s, I, a, k);      // (3단계) 소방의 지휘 줄 — 경찰 지휘 교본의 등록 안에서 부른다
  cs1(sim, s, I, a, k);      // (5단계 — 특수) 해체 반경 비우기 (아래 — 같은 등록 안에서 부른다). 의료의 지휘 줄(4단계)은 이 파일의 둘째 registerOrders 다
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
  if (!CF1_DONE.has(I) && fireComing(sim, I) === 0) {      // 본문 그대로 (3단계 측정: 문턱에서 기다리는 대원이 있을 때만 부르게 좁혔더니 2층 화재의 구조가 줄었다 — 되돌렸다)
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
// ───────────────────────── (4단계) 의료 — CE1 분류 · CE3 자리 하나 · CE4 항공 이송 ─────────────────────────
// CE2(처치 넘겨받기)는 commander.assign 끝(handoverCare — 배정의 자리), CE5(이송 출발 전 지휘 넘김)는 sceneManager 4번 블록에 있다.
// (import 를 이 절에 둔 것은 위의 import 묶음을 다른 단계가 함께 고치고 있어서다 — 3·4·5 단계를 나란히 돌린다)
import type { CasBelief, WorkItem } from '../../types';
import { emit } from '../../events';
import { triageMedic } from '../doctrine';
import { seatsLeft } from '../gear';
import { workLabel } from '../agents';

/** 분류를 내는 믿음 속 기다리는 환자 수 (band ≥ 1 · 현장·안전 구역 — §3.3 E01) */
export const TRIAGE_AT = 4;
/** 분류가 열려 있는 동안 중상(band 1) 처치를 미루는 최대 시간 (초 — 분류를 맡을 사람이 위중 처치에 매여 오래 열려 있으면 미루기를 푼다. 모든 사건은 끝난다) */
export const TRIAGE_HOLD_MAX = 60;
/** 위중 환자의 항공 이송을 검토하는 구급차 도착 예상 (초 — §6.1 CE4) */
export const AIR_EVAC_ETA = 100;
/** 탑승 자리를 맡는 작업 (commander 의 loadsQueued 와 같다 — 다친 대원·용의자의 후송도 자리를 맡아 둔다) */
const SEAT_WORK: ReadonlySet<string> = new Set(['load', 'treatMate', 'treatSuspect']);
const live = (w: WorkItem): boolean => w.status === 'open' || w.status === 'active';

registerOrders((sim, s, I, a, k) => {
  const cas = a.beliefs.list('cas');
  // CE1: 다수 사상자 — 믿음 속 기다리는 환자(band ≥ 1, 현장·안전 구역) 4명 이상(또는 관제가 다수 사상자로 본 사건에서 2명 이상), 분류를 맡을 구급 대원이 현장에 있고,
  //      안전 확보 전의 무장 현장이 아니며 아직 분류하지 않았다 → 분류 작업. 분류를 맡을 사람이 하나도 없어지면 열린 분류를 거둔다(열린 채 남으면 종료를 막는다).
  //      분류가 열려 있는 동안 중상(band 1) 처치는 미룬다(위중만 — 작업을 거두지 않고 holdUntil 로 잠깐씩 미룬다. 60초가 넘으면 풀어 준다)
  let waiting = 0;
  for (const f of cas) { const v = f.value as CasBelief; if (v.band >= 1 && v.band < 3 && (v.where === 'scene' || v.where === 'safe')) waiting++; }
  const hot = s.kind === 'armed' && s.secureAt < 0;
  let medics = 0;
  for (const b of s.agents) if (b.status === 'active' && !sim.units[b.unitId].boardOrder && triageMedic(sim, b.rid)) medics++;
  let tri: WorkItem | null = null;
  for (const w of s.board) if (w.kind === 'triage' && live(w)) { tri = w; break; }
  const massCall = I.assessment !== null && I.assessment !== undefined && I.assessment.risks.some((r) => r.startsWith('다수 사상자'));
  if ((s.triageAt ?? -1) < 0 && !hot && medics > 0 && (waiting >= TRIAGE_AT || (massCall && waiting >= 2))) {
    const was = tri;
    const w = k.want('triage', {}, 0.92, 1);
    if (w.id >= 0) { tri = w; if (was === null) recordDoc(sim, I, null, 'CE1', 'cmd', {}, -1); }
  } else if (tri !== null && (medics === 0 || hot)) { k.cancel((w) => w.kind === 'triage'); tri = null; }
  if (tri !== null && sim.t - tri.createdAt < TRIAGE_HOLD_MAX) {
    for (const w of s.board) {
      if (w.kind !== 'treat' || w.status !== 'open' || w.assignees.length) continue;
      const v = a.beliefs.val<CasBelief>('cas', w.cas);
      if (v !== undefined && v.band === 1) w.holdUntil = Math.max(w.holdUntil, sim.t + 1.5);      // 다음 계획 주기(지휘관의 판단 간격 1.2초 이하)까지
    }
  }

  // 현장 부대의 남은 환자 자리 (조직 정보 — 실린 사람과 이미 낸 탑승·후송 지시를 뺀다)
  const queued = (uid: number): number => { let n = 0; for (const w of s.board) if (SEAT_WORK.has(w.kind) && w.prop === uid && live(w)) n++; return n; };
  let free = 0;
  const onScene = k.unitsOnScene();
  for (const uid of onScene) { const u = sim.units[uid]; if (!u.boardOrder) free += Math.max(0, seatsLeft(sim, u) - queued(uid)); }

  // CE3: 자리 하나 — 남은 자리가 없는데 아직 아무도 손대지 않은 탑승 지시의 환자보다 더 위중한(믿음) 환자가 안전 구역에서 탑승을 기다린다 → 그 자리를 더 위중한 쪽에
  if (free === 0) {
    let low: WorkItem | null = null, lowBand = 9;
    for (const w of s.board) {
      if (w.kind !== 'load' || w.status !== 'open' || w.assignees.length) continue;
      const v = a.beliefs.val<CasBelief>('cas', w.cas);
      const b = v !== undefined ? v.band : 9;
      if (b < lowBand) { lowBand = b; low = w; }
    }
    if (low !== null) {
      let hi = -1, hiBand = lowBand;
      for (const f of cas) {
        const v = f.value as CasBelief;
        if (v.where !== 'safe' || v.band >= 3 || v.band <= hiBand) continue;
        let loading = false;
        for (const w of s.board) if (w.kind === 'load' && w.cas === f.id && live(w)) { loading = true; break; }
        if (!loading) { hi = f.id; hiBand = v.band; }
      }
      if (hi >= 0) {
        const prop = low.prop, pr = low.priority;
        k.cancel((w) => w === low);
        const nw = k.want('load', { cas: hi, prop }, Math.min(0.99, pr + 0.1), 1);
        if (nw.id >= 0) {
          const ev = emit(sim, { inc: I.id, role: 'COMMANDER', actor: sim.responders[a.rid].name, rid: a.rid, kind: 'command', imp: 1, text: `자리 하나 — ${workLabel(s, nw, sim)} 먼저.` });
          recordDoc(sim, I, null, 'CE3', 'cmd', {}, ev);
        }
      }
    }
  }

  // CE4: 위중 환자(믿음)가 있는데 현장의 남은 자리가 없고, 오는 구급 부대 가운데 가장 이른 도착 예상(조직 정보)이 100초를 넘는다 → 급한 구급 요청('항공 이송 검토' —
  //      관제의 의료 헬기 배정은 채워지지 않은 급한 구급 요청을 본다). 요청은 70초 안의 같은 능력이면 commander.request 가 버린다 — 보낸 것만 센다
  let red = false;
  for (const f of cas) { const v = f.value as CasBelief; if (v.band === 2 && (v.where === 'scene' || v.where === 'safe' || v.where === 'carried')) { red = true; break; } }
  if (red && free === 0 && onScene.length > 0) {
    let eta = Infinity;
    for (const uid of I.assigned) { const u = sim.units[uid]; if (u.caps.ems >= 0.7 && (u.state === 'enroute' || u.state === 'turnout')) eta = Math.min(eta, u.estArrive - sim.t); }
    if (eta > AIR_EVAC_ETA) {
      const ev = k.request('ems', '위중 환자 — 항공 이송 검토', true);
      if (ev >= 0) recordDoc(sim, I, null, 'CE4', 'cmd', {}, ev);
    }
  }
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
// (5단계의 import — emit·WorkItem·CommandKit 은 위의 3·4단계 절이 이미 들여왔다(합치기))
