// AgentBrain — 대원 한 명의 판단 주기.
//   Perception → Belief Update → Goal Selection(Utility) → Task Planning → (Executor 가 실행) → 결과 평가 → Communication → Replanning
// 행동 후보마다 점수를 매겨 가장 높은 것을 고른다. 판단력이 낮은 대원은 점수 추정에 오차가 크다.

import type { Sim } from '../engine';
import { emit, raiseProblem } from '../events';
import type { Candidate, CasBelief, FieldAgent, MateBelief, Scene, WorkItem } from '../types';
import { dist } from '../util';
import { AIR_LOW, hasKit, kitUses } from '../crews';
import { failedRecently, fitFor, flushOutbox, learnQuiet, mateFact, perceive, pumpOperatorOn, resp, shareNearby, workLabel } from './agents';
import { commanderThink } from './commander';
import { finishTask, makeTask } from './executor';
import { tileOf } from './grid';
import { mustRetreat } from './injury';

interface Option { label: string; score: number; apply: (() => void) | null }
/** 부상 후퇴를 이미 알린 대원 (현장의 개체마다 한 번 — 대원 개체의 모양을 바꾸지 않으려고 따로 둔다) */
const hurtTold = new WeakSet<FieldAgent>();

function takeWork(sim: Sim, s: Scene, a: FieldAgent, w: WorkItem, self: boolean): void {
  if (a.task) finishTask(sim, s, a, false, 'preempt');
  const t = makeTask(w.kind, workLabel(s, w, sim), w);
  t.startedAt = sim.t; t.selfAssigned = self;
  a.task = t; a.orderWork = w.id;
  if (w.assignees.indexOf(a.rid) < 0) w.assignees.push(a.rid);
  if (w.status === 'open') w.status = 'active';
  w.orderSentAt[a.rid] = sim.t;
  splitBegin(sim, s, a);      // (R3 §8.2) 같은 상황 다른 행동 — 임무가 시작된 자리의 표본
}

function setTask(sim: Sim, s: Scene, a: FieldAgent, kind: Parameters<typeof makeTask>[0], label: string): void {
  if (a.task) finishTask(sim, s, a, false, 'preempt');
  const t = makeTask(kind, label);
  t.startedAt = sim.t;
  a.task = t;
  splitBegin(sim, s, a);      // (R3 §8.2)
}

function dangerScore(sim: Sim, s: Scene, a: FieldAgent): number {
  const r = resp(sim, a);
  sdScore = 0; sdWhy = ''; sdRegion = -1;      // (X6) 조짐의 몫은 이 대원의 것만
  if (mustRetreat(r)) return 1.4;      // 다쳤다: 체력 40 아래, 또는 상처 출혈이 크고 체력이 70 아래 (자기 몸이다 — injury.mustRetreat)
  let u = 0;
  const ax = Math.round(a.x), ay = Math.round(a.y);
  let f = 0;
  for (let y = Math.max(0, ay - 1); y <= Math.min(s.h - 1, ay + 1); y++) for (let x = Math.max(0, ax - 1); x <= Math.min(s.w - 1, ax + 1); x++) f = Math.max(f, s.fire[y * s.w + x]);
  if (hasKit(sim, a.rid, 'turnout')) {      // 방화복을 입은 대원은 불 곁에서도 버틴다
    if (f > 0.85 && r.health < 65) u += 0.45; if (r.stamina < 8) u += 0.5;
    // 공기통이 비었다: 공기호흡기의 연기 방호가 없으므로(sceneManager.agentHealth) 메지 않은 사람처럼 연기 속에 오래 있지 못한다 — 하던 일을 놓고 나온다.
    // (바꿀 예비 공기통이 있으면 그 전에 60초 아래에서 스스로 바꾸러 나간다. 자기 장비의 상태라 판단에 써도 된다)
    if (a.smokeT > 4 && hasKit(sim, a.rid, 'scba') && kitUses(sim, a.rid, 'scba') <= 0) u += 0.45 + (a.smokeT - 4) * 0.06;
  }
  else { u += f * 1.1; if (a.smokeT > 4) u += 0.45 + (a.smokeT - 4) * 0.06; }
  if (r.dept !== 'police' && sim.t - a.underFireT < 4) u += 0.7;
  if (r.dept === 'police' && sim.t - a.underFireT < 3 && !a.inCover && r.health < 70) u += 0.35 * (1.3 - r.composure);
  u *= 1.25 - 0.5 * r.composure;
  u += signDanger(s, a);      // (X6 §5.1) 자기 믿음 속 조짐 — 침착함이 조짐 점수까지 깎지 않게 곱셈 뒤에 더한다
  if (a.carrying !== -1) u *= 0.55;
  return u;
}

// ───────────────────────── (X6 §5.1) 조짐을 보면 물러난다 — 믿음만 읽는다 ─────────────────────────
/** 마지막 signDanger 의 점수와 까닭 ('gas' 가스 농도 · 'roll' 롤오버) — think 가 후퇴를 고를 때 피하는 곳과 기록 문구에 쓴다 */
let sdScore = 0, sdWhy = '', sdRegion = -1;
/**
 * 점수: 자기 자리의 가스 조짐 2 이고 자기 구역·이웃 구역의 불 믿음 > 0.1 → +0.9 · 자기 방의 롤오버(fire 조짐 2)이고 그 방을 진압하는 중이 아님 → +0.6.
 * 단계 3 은 점수가 아니라 의무다(evacDuty) — 점수로 더하면 진압·운반 중인 대원과의 비교가 동전 던지기가 된다
 */
function signDanger(s: Scene, a: FieldAgent): number {
  sdScore = 0; sdWhy = ''; sdRegion = -1;
  const B = a.beliefs;
  if (!B.list('sign').length) return 0;
  const ar = regionAt(s, tileOf(s, a.x, a.y));
  if (ar < 0) return 0;
  const g = B.val<SignBelief>('sign', SIGN_BASE.gas + ar);
  if (g && g.level === 2) {
    let hot = (B.val<number>('fire', ar) ?? 0) > 0.1;
    if (!hot) for (const n of regionNbrs(s)[ar] ?? []) if ((B.val<number>('fire', n) ?? 0) > 0.1) { hot = true; break; }
    if (hot) { sdScore += 0.9; sdWhy = 'gas'; sdRegion = ar; }
  }
  const f = B.val<SignBelief>('sign', SIGN_BASE.fire + ar);
  if (f && f.level >= 2 && !(a.task && a.task.kind === 'suppress' && a.task.region === ar)) { sdScore += 0.6; if (!sdWhy) sdWhy = 'roll'; sdRegion = ar; }
  return sdScore;
}
/** 그 구역과 이웃 구역 */
const withNbrs = (s: Scene, r: number): number[] => [r, ...(regionNbrs(s)[r] ?? [])];
/**
 * 철수 의무 (§5.1): 업고 있지 않은 대원이 ① 믿음 속 지휘 상태(ops 사실)의 단계 3 구역 안에 있거나(철수 명령 — 'order'),
 * ② 자기 믿음의 임박 조짐을 안다(자기 구역·이웃 구역의 구조 3, 자기 구역의 가스 3, 7칸 안 용기 3, 건물 칸 위에서 건물 3).
 * 돌려주는 값: 까닭 ('order' · 'struct' · 'gas' · 'vessel' · 'bldg') 또는 ''. ② 면 a.avoid(30초)를 정한다
 */
function evacDuty(sim: Sim, s: Scene, a: FieldAgent): string {
  if (a.carrying !== -1) return '';      // 업고 있으면 그 운반이 곧 밖으로 나가는 길이다
  const B = a.beliefs, ai = tileOf(s, a.x, a.y);
  const ops = B.val<OpsFact>('ops', OPS_ID);
  if (ops && ops.zones && ops.zones.length && zoneLevelAt(s, ops.zones, ai) >= 3) return 'order';
  const signs = B.list('sign');
  if (!signs.length) return '';
  const ar = regionAt(s, ai), near = ar >= 0 ? withNbrs(s, ar) : null;
  // (X6 단계 6) 이미 통째로 무너진 건물(전체 붕괴를 안 지 30초 — 지휘 쪽의 잔해 수색 국면과 같은 때)은 더 무너질 것이 없다: 건물 조짐 3 으로 물러나지 않는다.
  // 그러지 않으면 잔해 수색에 들어간 대원이 잔해 위에서 철수 의무에 걸려 "수색 → 철수 → 30초 피함"을 되풀이한다
  let pile = ops !== undefined && ops.mode === 'rubble';
  if (!pile) for (const f of signs) { const v = f.value as SignBelief; if (v.kind === 'event' && v.what === 'total' && sim.t - f.t >= 30) { pile = true; break; } }
  for (const f of signs) {
    const v = f.value as SignBelief;
    if (v.level < 3 || v.kind === 'event' || (pile && v.kind === 'bldg')) continue;
    let why = '', regs: number[] = [], cx = -1, cy = -1, rad = 0;
    if (v.kind === 'struct' && near && near.indexOf(v.region) >= 0) { why = 'struct'; regs = withNbrs(s, v.region); }
    else if (v.kind === 'gas' && v.region === ar && ar >= 0 && !allowedHere(s, a)) { why = 'gas'; regs = withNbrs(s, ar); }
    else if (v.kind === 'vessel' && dist(a.x, a.y, v.x, v.y) <= 7) { why = 'vessel'; cx = v.x; cy = v.y; rad = 7; regs = v.region >= 0 ? [v.region] : []; }
    else if (v.kind === 'bldg' && footprint(s)[ai] >= 1) { why = 'bldg'; for (const rg of s.regions) if (rg.indoor) regs.push(rg.id); }
    if (!why) continue;
    a.avoid = { regions: regs, x: cx, y: cy, r: rad, until: sim.t + 30 };
    return why;
  }
  return '';
}
/**
 * 지금 하는 일이 진입 금지 구역(단계 2)에서도 허락된 일인가 (밸브 차단·냉각·진압·아는 구조 대상의 이송·구출·동료 구조 — ops.ALLOWED2).
 * 가스 단계 3 은 지휘관에게 단계 2(새 진입 금지 — 허락된 일만)다: 밸브를 잠그러 들어간 대원이 측정값을 읽자마자 스스로 나오면 밸브는 끝내 잠기지 않는다
 */
function allowedHere(s: Scene, a: FieldAgent): boolean {
  const t = a.task;
  if (!t || t.workId < 0) return false;
  const w = s.board[t.workId];
  return !!w && ALLOWED2.has(w.kind);
}
const EVAC_TEXT: Record<string, string> = { struct: '천장이 내려앉고 있습니다. 물러납니다.', gas: '가스 농도가 위험합니다. 물러납니다.', vessel: '용기 안전밸브가 울립니다. 물러납니다!', bldg: '건물이 무너질 것 같습니다. 물러납니다.', roll: '롤오버 — 방에서 나갑니다.' };

export function think(sim: Sim, s: Scene, a: FieldAgent): void {
  const I = sim.incidents[s.incidentId];
  const r = resp(sim, a);
  if (a.status !== 'active') return;
  splitSettle(sim, a);      // (R3 §8.2) 지난번에 시작한 임무의 표본 — 시작한 틱의 실행이 고른 방법이 적혀 있다
  perceive(sim, s, a);
  selfReport(sim, s, a);      // (R3 §4.1) 자기 몸 상태가 문턱을 넘었으면 'crew' 사실 — flushOutbox 보다 먼저 두어 같은 판단에 무전이 나간다
  shareNearby(sim, s, a);
  flushOutbox(sim, s, a);
  if (a.isCommander && sim.t >= a.planT) {
    // 지휘관은 주기적으로 건물 외부에서 화염·연기를 살핀다(창문 너머의 재발화를 놓치지 않도록)
    if (s.sizeupDone && (s.burning > 0 || s.burnedTiles > 0) && sim.t >= a.nextPerceive) { a.nextPerceive = sim.t + 7; perceive(sim, s, a, 2.4, true); }
    commanderThink(sim, s, a);
    a.planT = sim.t + (a.task && a.task.kind !== 'standby' && a.task.kind !== 'sizeup' ? 3.4 : 2);
  }
  if (I.phase === 'closed' && !sim.units[a.unitId].boardOrder) sim.units[a.unitId].boardOrder = 'release';
  rebuddy(sim, s, a);      // (R3 §5.3 — 0번) 짝이 없거나 잃었으면 다시 맺는다 (혼자 서는 역할은 하지 않는다)
  const u = sim.units[a.unitId];
  const cur = a.task;

  // 철수/이송 지시는 최우선 (구조 대상을 옮기는 중이면 그것부터 끝낸다)
  if (u.boardOrder) {
    if (cur && cur.kind === 'board') return;
    if (a.carrying !== -1 && cur) return;
    setTask(sim, s, a, 'board', u.boardOrder === 'transport' ? '병원 이송 탑승' : '철수');
    return;
  }

  // (R2 1b §3.5) 물 위의 대원(헤엄 중·보트 위)은 다른 일로 끌려 나가지 않는다: 하던 수난 구조를 잇거나 뭍으로 간다.
  // 후퇴·휴식·공기통·다른 지시·X6 의 철수 명령보다 앞 — 물 한가운데서 엉뚱한 목표로 가거나 끌고 오던 대상을 놓치지 않게. 철수 지시는 위에서 먼저 처리된다
  if (onWater(s, a) || a.afloat !== undefined) {
    if (!cur || (cur.kind !== 'waterRescue' && cur.kind !== 'ashore')) setTask(sim, s, a, 'ashore', '뭍으로');
    a.candidates = [{ label: a.task && a.task.kind === 'waterRescue' ? '계속: 수난 구조 (물 위)' : '물 위 — 뭍으로', score: 1.5, chosen: true }];
    return;
  }

  // 부상: 한번 후퇴를 시작하면 대기 지점에 닿을 때까지 다른 일(지시·자체 판단)에 끌려 나가지 않는다.
  // 끌려 나가면 다시 위험 점수가 이겨 후퇴 → 다른 일 → 후퇴를 되풀이하며 같은 무전을 반복한다
  const hurt = mustRetreat(r);
  if (hurt && cur && cur.kind === 'retreat') { a.candidates = [{ label: '계속: 후퇴 (부상)', score: 1.4, chosen: true }]; return; }

  // (X6 §5.1) 철수 — 점수가 아니라 의무: 철수 명령(믿음 속 지휘 상태의 단계 3 구역 안)과 자기 감각의 임박 조짐. R3 교본의 의무보다 앞.
  // 철수 중에는 다른 갈래로 넘어가지 않는다 (작업판에 없는 임무라 "계속" 점수가 0.5 여서, 이것이 없으면 지시나 후퇴에 밀려 구역 안으로 되돌아간다)
  if (cur && cur.kind === 'evacuate') { a.candidates = [{ label: '계속: 철수', score: 1.5, chosen: true }]; return; }
  {
    const why = evacDuty(sim, s, a);
    if (why) {
      if (cur && cur.workId >= 0) finishTask(sim, s, a, false, why === 'order' ? 'preempt' : 'danger');      // 자기 감각으로 물러나면 위험해서 놓은 것으로 남긴다 (곧바로 다시 맡기지 않게)
      setTask(sim, s, a, 'evacuate', '철수');
      a.candidates = [{ label: why === 'order' ? '의무: 철수 명령' : '의무: 임박 조짐 — 철수', score: 1.5, chosen: true }];
      if (why === 'order') {
        const ops = a.beliefs.val<OpsFact>('ops', OPS_ID)!;
        if (a.opsSeen !== ops.t) { a.opsSeen = ops.t; emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: '철수 명령 수신. 밖으로 나갑니다.' }); }
      } else if (sim.t - a.lastRetreatLog >= 20) {
        a.lastRetreatLog = sim.t;
        emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 2, causes: [I.lastEvent], text: EVAC_TEXT[why] });
      }
      return;
    }
  }

  // (R3) 교본의 의무와 놓기 — 설계서 R3 §2.6 의 4번 (X6 의 철수(evacuate) 의무가 들어오면 그 바로 뒤에 둔다). 단계 0: 줄이 없어 아무것도 하지 않는다
  const dSense = senseOf(s, a);
  if (cur && DOC_DUTY_TASKS.has(cur.kind)) return;
  { const d = docDuty(sim, s, a, dSense); if (d) { docBegin(sim, s, a, d, XK); return; } }
  { const dr = docDrop(sim, s, a); if (dr && cur) { const wk = s.board[cur.workId].kind, wid = cur.workId; finishTask(sim, s, a, false, 'doctrine'); recordDoc(sim, I, a, dr.id, 'fit', { work: wk, tgt: 'w:' + wid }, docNote(sim, s, a, dr, 1, dr.dropNote), dr.report !== undefined); return; } }      // (2단계) 놓을 때의 문구 (P22 '탄약이 없어 위치를 넘깁니다.')

  const opts: Option[] = [];
  // 1) 위험 회피
  const dng = dangerScore(sim, s, a);
  const sd = sdScore, sdW = sdWhy, sdR = sdRegion;      // (X6) 그 점수 가운데 조짐의 몫 — 그 때문에 물러나면 피하는 곳(30초)과 까닭의 문구
  const swapR = dng > 0.3 && (!cur || cur.kind !== 'retreat') ? docRetreat(sim, s, a, dng, dSense, sd) : null;      // (R3) P11 — 후퇴 후보를 교본 행동(엄폐)으로 바꿔 끼운다 (조짐 몫 sd 가 있으면 걸리지 않는다)
  if (swapR) opts.push({ label: `교본 · ${swapR.rule.short}`, score: swapR.score, apply: () => docBegin(sim, s, a, swapR, XK) });
  else if (dng > 0.3 && (!cur || cur.kind !== 'retreat')) opts.push({ label: hurt ? '부상 — 후퇴' : '위험 회피 — 후퇴 후 재평가', score: dng, apply: () => {
    // 맡고 있던 작업은 위험해서 내려놓은 것으로 기록한다: 지휘관이 곧바로 같은 대원에게 다시 맡기지 않는다
    if (cur && cur.workId >= 0) finishTask(sim, s, a, false, 'danger');
    setTask(sim, s, a, 'retreat', '후퇴');
    // (X6 §5.1) 조짐 때문에 물러났다: 그 구역과 이웃 구역을 30초 동안 피한다 (후퇴했다 바로 다시 들어가지 않게)
    const signed = !hurt && sd > 0 && sdR >= 0;
    if (signed) a.avoid = { regions: withNbrs(s, sdR), x: -1, y: -1, r: 0, until: sim.t + 30 };
    // 가벼운 일을 한다고 알렸던 다친 대원이 다시 물러난다: 지휘관이 더는 일을 맡기지 않게 자기 상태를 소리 없이 다시 알린다 (처음 다칠 때는 agentHealth 가 알린다)
    if (hurt) { const me = a.beliefs.val<MateBelief>('mate', a.rid); if (me !== undefined && me.status === 'light') learnQuiet(sim, a, mateFact(sim, s, a, 'hurt', r.name, 0)); }
    // 부상 후퇴는 상태가 바뀌는 이 한 번만 알린다(위의 붙잡기로 다시 고르지 않는다 — 길 위의 불을 끄다 물이 떨어져 후퇴를 다시 시작해도 되풀이하지 않는다), 위험 회피는 20초에 한 번
    if (hurt) { if (hurtTold.has(a)) return; hurtTold.add(a); }
    else if (sim.t - a.lastRetreatLog < 20) return;
    a.lastRetreatLog = sim.t;
    emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: hurt ? 2 : 1, causes: [hurt && a.hurtEv !== undefined ? a.hurtEv : a.lastBlockEvent], text: hurt ? '부상으로 더 이상 임무 수행 불가. 후퇴합니다.' : signed && EVAC_TEXT[sdW] ? EVAC_TEXT[sdW] : '위험 수준이 너무 높습니다. 일단 물러나 재평가합니다.' });
  } });
  // 2) 현재 임무 계속
  if (cur && cur.kind !== 'standby') {
    let sc = 0.5;
    const w = cur.workId >= 0 ? s.board[cur.workId] : null;
    if (w) sc = 0.5 + 0.4 * w.priority + 0.08;
    else if (cur.kind === 'retreat') sc = 0.95;
    else if (cur.kind === 'rehab') sc = r.stamina < 40 ? 0.96 : 0.62;      // 어느 정도 회복할 때까지는 다른 지시에 끌려 나가지 않는다
    else if (cur.kind === 'resupply') sc = 0.85;
    else if (cur.kind === 'swapAir') sc = 0.93;      // 공기통을 바꾸는 동안(8초)은 다른 일에 끌려 나가지 않는다
    else if (cur.kind === 'moveSignal') sc = 0.66;
    else { const dcs = docContinue(sim, a, cur); if (dcs !== undefined) sc = dcs; }      // (R3 §4.4 끝) 엄폐 0.97 · 탄약 보급 0.86(탄 위급이면 0.96)
    if (a.carrying !== -1) sc += 0.35;
    opts.push({ label: `계속: ${cur.label}`, score: sc, apply: null });
  }
  // 공기통을 바꾸는 중(대기 지점까지 가서 8초)에는 끝까지 한다: 위험 회피와 철수 지시 말고는 다른 후보를 내지 않는다.
  // 점수만으로 붙잡으면(0.93) 눈앞의 일·지시·장비 교체·휴식과 점수가 비슷해 둘을 오가며 "교체하러 갑니다"를 되풀이했다
  const swapping = cur !== null && cur.kind === 'swapAir';
  // 3) 지휘관 지시
  if (!swapping && a.orderWork >= 0 && (!cur || cur.workId !== a.orderWork)) {
    const w = s.board[a.orderWork];
    if (w && (w.status === 'open' || w.status === 'active') && fitFor(sim, s, a, w) > 0) {
      opts.push({ label: `지시 수행: ${workLabel(s, w, sim)}`, score: 0.56 + 0.4 * w.priority, apply: () => takeWork(sim, s, a, w, false) });
    } else a.orderWork = -1;
  }
  // 4) 장비 문제: 예비 펌프 교체와 소화전 급수 연결은 그 부대에서 펌프를 맡은 대원(기관원·사다리 조작원)이 활동 중이면 그 사람만 나선다
  //    (물이 떨어진 관창수가 스스로 관창을 놓고 가지 않는다. 펌프를 맡은 대원이 없거나 쓰러졌으면 지금처럼 문제를 겪은 대원이 한다)
  //    (공기통을 바꾸는 중에는 이 둘도 내지 않고, 이 둘을 하는 중에는 공기통 교체를 내지 않는다 — 시작한 것을 끝낸 뒤 다음 것을 한다)
  const panel = hasKit(sim, a.rid, 'pumpPanel');
  const pumpMine = panel || !pumpOperatorOn(sim, s, a.unitId);
  if (pumpMine && a.equipIssue === 'pump' && (!cur || cur.kind !== 'resupply') && !swapping && (u.sparePump === undefined || u.sparePump > 0)) {      // (R3 F10) 예비 펌프가 남았을 때만 (0 이면 지휘관이 진압 부대 교체를 부른다 — CF3)
    const someoneFixing = s.agents.some((b) => b !== a && b.unitId === a.unitId && b.task && b.task.kind === 'resupply');
    if (!someoneFixing) opts.push({ label: '장비 교체 (예비 펌프)', score: 0.84, apply: () => {
      setTask(sim, s, a, 'resupply', '장비 교체');
      emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 1, causes: [a.lastBlockEvent], text: '차량으로 돌아가 예비 펌프로 교체하겠습니다.' });
    } });
  }
  // (소화전에 닿지 못해 실패했으면 한동안 다시 고르지 않는다: equipRetryAt · 그 작업의 실패 기억)
  // 펌프를 맡은 대원은 탱크를 지켜본다: 물이 떨어지기 전이라도 지휘관이 급수 연결을 작업판에 올리면(탱크 40% 아래) 스스로 나선다.
  // 물이 이미 떨어졌으면 그 부대는 불을 끌 수 없으므로 하던 일(수색 등)보다 급수를 앞세운다
  const hookW = (a.equipIssue === 'water' || panel) && !u.hydrant ? s.board.find((q) => q.kind === 'hookup' && q.prop === a.unitId && (q.status === 'open' || q.status === 'active')) : undefined;
  const dry = a.equipIssue === 'water';
  // (예비 펌프로 바꾸는 중에는 급수 연결을 내지 않는다: 두 후보의 점수가 비슷해 교체와 연결을 오가며 같은 말을 되풀이한다 — 교체를 끝낸 뒤 연결한다)
  if (pumpMine && (dry || hookW) && (!cur || (cur.kind !== 'hookup' && cur.kind !== 'resupply')) && !swapping && !u.hydrant && sim.t >= a.equipRetryAt && s.props.some((p) => p.kind === 'hydrant')) {
    const someone = s.agents.some((b) => b !== a && b.unitId === a.unitId && b.task && b.task.kind === 'hookup');
    const w = hookW;
    if (!someone && !(w && failedRecently(sim, w, a.rid))) opts.push({ label: '소화전 급수 연결', score: dry && panel ? 0.92 : 0.83, apply: () => {
      if (w) takeWork(sim, s, a, w, true); else { setTask(sim, s, a, 'hookup', '소화전 연결'); }
      if (dry) emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'recovery', imp: 1, causes: [a.lastBlockEvent], text: '소화전에 급수 라인을 연결하겠습니다.' });
      else emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 0, text: '탱크 용수가 줄었습니다. 소화전에 급수 라인을 연결하겠습니다.' });
    } });
  }
  // 4-2) 공기: 남은 공기가 60초 아래이고 자기 부대에 예비 공기통이 남아 있으면 대기 지점으로 나가 바꾼다 (연기 속이면 더 급하다).
  //      사람을 옮기는 중이면 그것부터 끝낸다(나가는 길이다). 방금 대기 지점에 닿지 못했으면 한동안 다시 고르지 않는다(equipRetryAt — 급수 연결과 같은 기억).
  //      같은 부대의 다른 대원이 이미 바꾸러 간 통은 빼고 센다(가 보니 예비가 없는 헛걸음을 하지 않게)
  //      후퇴 중이거나 지쳐서 물러나는 중(체력 40 까지의 붙잡기)에는 내지 않는다 — 둘 다 대기 지점으로 가는 길이고, 닿은 뒤에 바꾼다
  //      (점수가 비슷해 후퇴·휴식과 교체를 오가며 같은 말을 되풀이했다)
  const tied = cur !== null && (cur.kind === 'swapAir' || cur.kind === 'resupply' || cur.kind === 'hookup' || cur.kind === 'retreat' || (cur.kind === 'rehab' && r.stamina < 40));
  // (R3 F03) 공기가 위험 실내 일의 문턱(한 통의 50% — crews.airShort) 아래인데 바깥에서 손이 비었으면 미리 바꾼다 (0.7 — 60초 아래의 교체보다 낮게)
  const airEarly = kitUses(sim, a.rid, 'scba') >= AIR_LOW && (!cur || cur.kind === 'standby') && airShort(sim, a.rid) && !indoorAt(s, a);
  if (hasKit(sim, a.rid, 'scba') && (kitUses(sim, a.rid, 'scba') < AIR_LOW || airEarly) && !tied && a.carrying === -1 && sim.t >= a.equipRetryAt) {
    let taken = 0;
    for (const b of s.agents) if (b !== a && b.unitId === a.unitId && b.status === 'active' && b.task && b.task.kind === 'swapAir') taken++;
    if ((u.spareAir ?? 0) > taken) opts.push({ label: '공기통 교체', score: airEarly ? 0.7 : s.smoke[tileOf(s, a.x, a.y)] > 0.25 ? 0.95 : 0.9, apply: () => {
      setTask(sim, s, a, 'swapAir', '공기통 교체');
      emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: '공기통을 교체하러 대기 지점으로 갑니다.' });
    } });
  }
  // (R3) 교본 행동 후보 하나 (R1 공기통 교체 다음 — 설계서 R3 §2.6 의 5번). 단계 0: 줄이 없어 후보를 내지 않는다 (판단 오차의 a.rng 소비가 그대로)
  { const p = swapping ? null : docAct(sim, s, a, dSense, dng); if (p) opts.push({ label: `교본 · ${p.rule.short}`, score: p.score, apply: () => docBegin(sim, s, a, p, XK) }); }
  // 5) 휴식 (공기통을 바꾸는 중이면 바꾼 뒤에 쉰다 — 8초)
  if (r.stamina < 22 && (!cur || (cur.kind !== 'rehab' && cur.kind !== 'swapAir')) && a.carrying === -1) opts.push({ label: '체력 고갈 — 교대 휴식', score: 0.55 + ((22 - r.stamina) / 22) * 0.4, apply: () => {
    setTask(sim, s, a, 'rehab', '휴식');
    if (sim.t - a.rehabLogAt > 45) { a.rehabLogAt = sim.t; raiseProblem(sim, I, 'FATIGUE', `${r.name} 체력 고갈로 작업 중단`, { role: 'RESPONDER', actor: r.name, rid: r.id, imp: 1, text: '체력이 한계입니다. 잠시 물러나 회복하겠습니다.' }); }
  } });
  // 6) 무전 음영: 중요한 보고가 막혀 있으면 신호가 닿는 곳으로 이동
  if (!swapping && a.commFailLogged && a.outbox.length && (!cur || cur.kind !== 'moveSignal') && a.carrying === -1) {
    opts.push({ label: '무전 가능한 위치로 이동해 보고', score: 0.6 + 0.2 * r.experience, apply: () => setTask(sim, s, a, 'moveSignal', '무전 가능 지점으로 이동') });
  }
  // 7) 스스로 판단해 맡을 수 있는 일 (지휘관 지시가 없을 때, 혹은 눈앞의 급한 일)
  const free = !cur || cur.kind === 'standby';
  const initiative = 0.25 + 0.45 * r.experience + 0.2 * r.judgment;
  let bestW: WorkItem | null = null, bestS = 0;
  for (const w of s.board) {
    if (w.status !== 'open' && !(w.status === 'active' && w.assignees.length < w.max && w.kind === 'carry')) continue;
    if (sim.t < w.holdUntil || w.assignees.indexOf(a.rid) >= 0 || w.kind === 'sizeup' || failedRecently(sim, w, a.rid)) continue;
    const fit = fitFor(sim, s, a, w);
    if (fit <= 0) continue;
    let near = 0;
    if (w.cas >= 0) { const c = a.beliefs.val<CasBelief>('cas', w.cas); if (c && dist(a.x, a.y, c.x, c.y) < 4) near = 0.25; else if (!c) continue; }
    if (!free && near === 0) continue;
    // (R2 1c) 수난 구조를 하는 중에는 곁의 다른 일(다른 수난 구조·이송)로 스스로 옮기지 않는다: 계속 점수(0.5 + 0.4 × 우선순위)와 곁의 일 점수가 비슷해
    // 판단 오차만으로 두 일 사이를 오가며 그때마다 방법을 다시 고르고 알렸다(해일 — 같은 대원이 1~2초마다). 지휘관의 지시는 그대로 받는다
    if (!free && cur!.kind === 'waterRescue') continue;
    if (free && near === 0 && !a.isCommander && sim.t - a.idleSince < 2.6) continue;      // 먼저 지휘관 지시를 기다린다
    const sc = (free ? 0.3 : 0.15) + initiative * 0.25 + w.priority * 0.35 + near + fit * 0.1;
    if (sc > bestS) { bestS = sc; bestW = w; }
  }
  if (bestW && !swapping) {
    const w = bestW;
    opts.push({ label: `자체 판단: ${workLabel(s, w, sim)}`, score: bestS, apply: () => {
      takeWork(sim, s, a, w, true);
      if (!a.isCommander) emit(sim, { inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 0, text: `${workLabel(s, w, sim)}, 제가 맡겠습니다.` });
    } });
  }
  // 8) 대기
  if (free) opts.push({ label: '대기 · 지시 요청', score: 0.08, apply: cur ? null : () => { a.task = makeTask('standby', '대기'); } });

  // 판단 오차
  const noise = (1 - r.judgment) * 0.14;
  for (const o of opts) o.score += (a.rng.next() * 2 - 1) * noise;
  opts.sort((x, y) => y.score - x.score);
  const chosen = opts[0];
  const cands: Candidate[] = opts.slice(0, 5).map((o, k) => ({ label: o.label, score: Math.round(o.score * 100) / 100, chosen: k === 0 }));
  a.candidates = cands;
  if (chosen && chosen.apply) chosen.apply();
  void tileOf;
}

// ── (R3) 대응 교본의 자리 (field/doctrine.ts 의 판단 · doctrineRun.ts 의 실행 · R2 의 감각 senseOf · 실행기 도구 XK).
//    (import 를 파일 끝에 둔 것은 위의 import 묶음을 다른 묶음이 함께 고치고 있어서다) ──
import { DOC_DUTY_TASKS, docAct, docDrop, docDuty, docRetreat } from './doctrine';
import { docBegin, docContinue, docNote, recordDoc, selfReport, splitBegin, splitSettle } from './doctrineRun';
import { rebuddy } from './doctrineRun';      // (R3 3단계) 짝 다시 맺기
import { airShort } from '../crews';      // (R3 3단계 F03) 공기 문턱 (한 통의 50%)
/** (R3 3단계) 선 자리가 실내 구역인가 (생김새 — 미리 하는 공기통 교체는 바깥에서만) */
const indoorAt = (s: Scene, a: FieldAgent): boolean => { const rg = s.region[tileOf(s, a.x, a.y)]; return rg >= 0 && s.regions[rg] !== undefined && s.regions[rg].indoor; };
import { XK } from './executor';
import { senseOf } from './methodRun';
import { onWater } from './methods';      // (R2 1b) 물 위의 대원 가드
// (X6 단계 5) 조짐을 보면 물러난다 — 믿음 속 조짐·지휘 상태(ops 사실)와 생김새(이웃 구획·건물 칸)만 읽는다
import { ALLOWED2, OPS_ID, SIGN_BASE, footprint, regionAt, regionNbrs, zoneLevelAt } from './ops';
import type { OpsFact } from './ops';
import type { SignBelief } from '../types';
