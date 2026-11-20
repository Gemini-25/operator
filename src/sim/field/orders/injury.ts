// 부상과 사망 (H1) — 지휘 규칙. 지휘관의 믿음(a.beliefs)만 읽는다: 누가 얼마나 다쳤는지는 보고('mate'·'hos'·'cas' 사실)로만 안다.
// 다른 사람의 체력·출혈·부상 기록·사망·후송 상태(진실)를 읽지 않고, 그것을 읽는 함수(injury.needsHospital)도 부르지 않는다 —
// 명부에서는 소속·분야·이름만 본다 (설계서 H1 §6.1, tests/ext.test.ts 와 tests/injuries.test.ts 가 글자로 잡는다).
// 그 밖에 읽는 것은 조직이 아는 것뿐이다: 작업판(s.board), 부대의 상태·지시·자리(sim.units), 현장 대원의 활동 여부와 장비 자격(fitFor).
//   단계 4b 다친 대원의 처치·후송(treatMate), 자기 부대 이송 지시(20초 규칙), 다수 사상자 다시 세기 (§3.4·§6.3) — 아래
//   단계 5  쓰러진·다친 용의자의 처치와 이송(treatSuspect), 다수 사상자 다시 세기에 용의자 (§4.3·§6.3) — 아래

import { seatsOf, seatsUsed } from '../../crews';
import type { Sim } from '../../engine';
import { emit } from '../../events';
import type { CasBelief, FieldAgent, MateBelief, Scene, WorkItem } from '../../types';
import { fitFor, resp } from '../agents';
import { hosNeedsCare, mateNeedsHospital } from '../injury';
import { registerOrders } from '../sceneRegistry';

/** 자기 부대 이송 지시까지 기다리는 시간(초) — 병원이 필요한 동료가 구급 부대 없이 이만큼 기다렸으면 그 대원의 부대가 직접 싣고 간다 */
export const SELF_EVAC_WAIT = 20;

const live = (w: WorkItem): boolean => w.status === 'open' || w.status === 'active';
/** 그 대원이 아직 이 현장에 있는가 (자기 부대와 함께 떠나지 않았다 — 부대의 출발은 조직이 아는 사실이다) */
function onScene(s: Scene, rid: number): boolean {
  for (let k = 0; k < s.agents.length; k++) if (s.agents[k].rid === rid) return s.agents[k].status !== 'left';
  return false;
}
/** 그 부대에 이미 내려진 탑승 지시의 수: 구조 대상의 탑승(load)과 다친 대원·용의자의 후송(treatMate·treatSuspect 의 prop). skip 은 세지 않을 항목(고쳐 쓰려는 그 항목) */
function queued(s: Scene, uid: number, skip: WorkItem | null): number {
  let n = 0;
  for (const w of s.board) if (w !== skip && w.prop === uid && live(w) && (w.kind === 'load' || w.kind === 'treatMate' || w.kind === 'treatSuspect')) n++;
  return n;
}
/** 자격을 물어볼 때 쓰는 빈 작업 항목 (작업판에 올리지 않는다 — 맡을 사람이 있는지 본 뒤에만 올린다) */
const PROBE: WorkItem = {
  id: -1, kind: 'treatMate', region: -1, cas: -1, prop: -1, hostile: -1, tile: -1, mate: -1, priority: 0, status: 'open', assignees: [], max: 1,
  createdAt: 0, doneAt: -1, note: '', fails: 0, holdUntil: 0, thorough: false, orderSentAt: {}, cause: -1, failedAt: {}, animal: -1,      // animal: (N8) commander.want 의 리터럴과 같은 모양
};
/** 이 동료의 처치·후송을 맡을 수 있는 활동 대원이 현장에 있는가 (장비 자격 — fitFor. 떠나라는 지시를 받은 부대의 대원은 치지 않는다) */
function anyMedic(sim: Sim, s: Scene, rid: number, prop: number): boolean {
  PROBE.mate = rid; PROBE.prop = prop;
  for (const b of s.agents) if (b.status === 'active' && !sim.units[b.unitId].boardOrder && fitFor(sim, s, b, PROBE) > 0) return true;
  return false;
}

// 다친 동료의 처치와 후송 (§3.4-2)
registerOrders((sim, s, I, a: FieldAgent, k) => {
  const mates = a.beliefs.list('mate');
  if (!mates.length) return;      // 다친 동료를 모른다 — 대부분의 현장은 여기서 돌아간다
  const hot = s.kind === 'armed' && s.secureAt < 0;
  const on = k.unitsOnScene();
  const emsN = k.countUnits('ems', 0.7);
  const threat = a.beliefs.list('hos').some((h) => h.value.state === 'hold' || h.value.state === 'fight' || h.value.state === 'flee');
  /** 자리가 남은 구급차·헬기 (위중한 동료는 헬기 먼저, 그 밖에는 지상 구급차 먼저 — 구조 대상의 탑승 배정과 같다) */
  const seat = (airFirst: boolean, skip: WorkItem | null): number => {
    for (let pass = 0; pass < 2; pass++) for (const uid of on) {
      const q = sim.units[uid];
      if (q.boardOrder || seatsOf(q) === 0 || (!!q.air === airFirst) !== (pass === 0)) continue;
      if (seatsUsed(sim, q) + queued(s, uid, skip) < seatsOf(q)) return uid;
    }
    return -1;
  };
  let care = 0;      // 처치나 후송이 필요한데 아직 맡을 사람이 없는 동료
  for (const f of mates) {
    const v = f.value as MateBelief, rid = f.id;
    const cur = s.board.find((w) => w.kind === 'treatMate' && w.mate === rid && live(w)) ?? null;
    const unit = sim.units[sim.responders[rid].unitId];
    // 대상이 아니다: 숨졌다 · 후송됐다 · 쓰러져 있다(구조가 먼저다) · 가벼운 일로 돌아왔다 · 자기 부대와 함께 떠났거나 곧 떠난다(그 차에 실려 간다)
    if (v.dead || (v.status !== 'hurt' && v.status !== 'safe') || !onScene(s, rid) || unit.boardOrder) {
      if (cur) cur.status = 'cancelled';
      continue;
    }
    const hosp = mateNeedsHospital(v);
    // 처치가 필요한가: 아직 못 받았거나, 기본 처치만 받았다 (두 번 보고도 그대로면 현장에서 더 해 줄 처치가 없다 — 같은 지시와 같은 보고를 주고받지 않는다)
    let done = 0;
    for (const w of s.board) if (w.kind === 'treatMate' && w.mate === rid && w.status === 'done') done++;
    const treat = (v.band >= 1 || v.bleeding) && (v.tq === 0 || (v.tq === 1 && done < 2));
    const prop = hosp ? seat(v.band >= 2, cur) : -1;
    if (!treat && prop < 0) {
      // 처치는 끝났고 태울 자리도 없다(또는 병원이 필요 없다): 열려 있는 지시는 거둔다. 하고 있는 일은 스스로 끝난다
      if (cur && cur.status === 'open') cur.status = 'cancelled';
    } else if (cur) {
      // 대상당 한 항목: 열려 있는 항목은 태울 차와 우선도만 고쳐 쓴다 (맡은 사람이 있으면 그대로 둔다)
      if (cur.status === 'open') {
        if (!anyMedic(sim, s, rid, prop)) cur.status = 'cancelled';      // 맡을 사람이 없어졌다: 열어 두면 종료를 막는다
        else { cur.prop = prop; cur.priority = 0.8 + 0.06 * v.band; }
      }
    } else if (anyMedic(sim, s, rid, prop)) k.want('treatMate', { mate: rid, prop }, 0.8 + 0.06 * v.band, 1);
    else care++;
    // 자기 부대 이송 지시 (20초 규칙): 병원이 필요한 동료가 20초 넘게 기다렸는데 구급 부대가 현장에도 오는 중에도 없다 —
    // 또는 구급차가 있지만 처치만 받고 태울 자리가 없다. 그 대원의 부대가 직접 싣고 병원으로 간다.
    // 교전 중에는 빼지 않는다(경찰 짝을 빼면 대치가 길어진다). 현장의 마지막 주관 분야 부대, 용의자가 남았을 때의 마지막 경찰 부대, 구조정도 빼지 않는다
    if (!hosp || hot || unit.sea || unit.state !== 'onscene' || sim.t - v.since <= SELF_EVAC_WAIT) continue;
    if (!(emsN === 0 || (v.tq >= 1 && prop < 0))) continue;
    let sameDept = 0, police = 0;
    for (const uid of on) { if (uid === unit.id) continue; const q = sim.units[uid]; if (q.dept === unit.dept) sameDept++; if (q.dept === 'police') police++; }
    if (unit.dept === s.leadDept && sameDept === 0) continue;
    if (threat && unit.dept === 'police' && police === 0) continue;
    unit.boardOrder = 'transport';
    if (cur && live(cur)) cur.status = 'cancelled';
    emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 2, text: `${unit.callsign}, 부상 대원을 태우고 병원으로 이동하라.` });
  }
  // 구급 부대가 현장에도 오는 중에도 없으면 부른다
  if (care > 0 && emsN === 0) k.request('ems', '부상 대원 후송', true);
});

// 쓰러진·다친 용의자의 처치와 이송 (§4.3). 위협이 끝난 뒤의 일이다: 믿음상 맞서는 용의자(대치·교전·도주)가 하나라도 있으면 내지 않고, 열린 지시도 거둔다.
// 대상당 한 항목(태울 차는 계획 주기마다 바뀔 수 있다 — 열린 항목의 prop·우선도만 고쳐 쓴다). 우선도 0.74 + 0.06 × band.
// 태울 차는 기다리는 구조 대상·다친 대원 가운데 그 용의자보다 중증도가 같거나 높은 사람이 없을 때만 정한다 (그 밖에는 처치만).
// 맡을 수 있는 대원(fitFor — 경찰, 안전 확보 뒤의 구급대원)이 현장에 없으면 열지 않고 거둔다 — 열어 두면 종료를 막는다
registerOrders((sim, s, _I, a, k) => {
  const hos = a.beliefs.list('hos');
  if (!hos.length) return;      // 용의자를 모른다 — 대부분의 현장은 여기서 돌아간다
  const threat = hos.some((h) => h.value.state === 'hold' || h.value.state === 'fight' || h.value.state === 'flee');
  const on = k.unitsOnScene();
  // 기다리는 사람 가운데 가장 무거운 중증도 (구조 대상: 현장·이송 중·안전 구역의 중상·위중 / 다친 대원: 병원이 필요한 동료는 위중으로 친다)
  let worst = -1;
  for (const f of a.beliefs.list('cas')) { const c = f.value as CasBelief; if (c.band >= 1 && c.band < 3 && (c.where === 'scene' || c.where === 'carried' || c.where === 'safe') && c.band > worst) worst = c.band; }
  for (const f of a.beliefs.list('mate')) { const v = f.value as MateBelief; if (mateNeedsHospital(v) && onScene(s, f.id)) worst = Math.max(worst, v.band >= 2 || v.wasDown ? 2 : v.band); }
  for (const f of hos) {
    const v = f.value, id = f.id;
    const cur = s.board.find((w) => w.kind === 'treatSuspect' && w.hostile === id && live(w)) ?? null;
    if (threat || !hosNeedsCare(v)) { if (cur) cur.status = 'cancelled'; continue; }
    const band = v.band ?? 2, tq = v.tq ?? 0;
    // 처치가 필요한가: 아직 못 받았거나, 기본 처치만 받았다 (두 번 보고도 그대로면 현장에서 더 해 줄 처치가 없다)
    let done = 0;
    for (const w of s.board) if (w.kind === 'treatSuspect' && w.hostile === id && w.status === 'done') done++;
    // 안전장치: 이 용의자의 지시를 이미 TS_MAX_DONE 번 마쳤다(처치 둘·이송 하나 남짓) — 더 내도 같은 보고만 돌아온다 (낡은 믿음으로 같은 지시가 되풀이되지 않게)
    if (done >= TS_MAX_DONE) { if (cur && cur.status === 'open') cur.status = 'cancelled'; continue; }
    const treat = tq === 0 || (tq === 1 && done < 2);
    // 태울 차: 자리가 남은 구급차·헬기 (위중이면 헬기 먼저). 더 무겁거나 같은 사람이 기다리면 정하지 않는다
    let prop = -1;
    if (worst < band) {
      for (let pass = 0; pass < 2 && prop < 0; pass++) for (const uid of on) {
        const q = sim.units[uid];
        if (q.boardOrder || seatsOf(q) === 0 || (!!q.air === (band >= 2)) !== (pass === 0)) continue;
        if (seatsUsed(sim, q) + queued(s, uid, cur) < seatsOf(q)) { prop = uid; break; }
      }
    }
    if (!treat && prop < 0) { if (cur && cur.status === 'open') cur.status = 'cancelled'; continue; }
    PROBE_S.hostile = id; PROBE_S.prop = prop;
    const able = s.agents.some((b) => b.status === 'active' && !sim.units[b.unitId].boardOrder && fitFor(sim, s, b, PROBE_S) > 0);
    if (cur) {
      if (cur.status === 'open') { if (!able) cur.status = 'cancelled'; else { cur.prop = prop; cur.priority = 0.74 + 0.06 * Math.min(2, band); } }
    } else if (able) k.want('treatSuspect', { hostile: id, prop }, 0.74 + 0.06 * Math.min(2, band), 1);
  }
});
/** 한 용의자에게 내는 처치·이송 지시의 상한 (마친 항목 수) — 그 뒤로는 내지 않는다 */
export const TS_MAX_DONE = 4;
/** 용의자 처치의 자격을 물어볼 빈 작업 항목 (작업판에 올리지 않는다) */
const PROBE_S: WorkItem = { ...PROBE, kind: 'treatSuspect', orderSentAt: {}, failedAt: {}, assignees: [] };

// 다수 사상자 다시 세기 (§6.3): 구조 대상만 세는 규칙(orders/major.ts)에 병원이 필요한 대원과 처치가 필요한 용의자(믿음상 쓰러짐·중상 이상)를 더해 다시 센다.
// 같은 분야의 요청은 채워지지 않았거나 70초 안에 있었으면 무시되므로 둘이 겹쳐도 한 번만 나간다
registerOrders((_sim, s, _I, a, k) => {
  let hurt = 0;
  for (const f of a.beliefs.list('mate')) { const v = f.value as MateBelief; if (mateNeedsHospital(v) && onScene(s, f.id)) hurt++; }
  for (const f of a.beliefs.list('hos')) if (hosNeedsCare(f.value)) hurt++;
  if (hurt === 0) return;
  const n = hurt + a.beliefs.list('cas').filter((f) => f.value.band >= 1 && f.value.band < 3 && (f.value.where === 'scene' || f.value.where === 'carried' || f.value.where === 'safe')).length;
  if (n >= 5 && k.countUnits('ems', 0.7) < Math.min(5, Math.ceil(n / 2))) k.request('ems', `부상자 ${n}명(대원·용의자 포함) — 구급 부대가 더 필요`, true);
});
