// AI Field Commander — 현장 지휘관.
// 지휘관은 자신의 믿음(직접 본 것 + 무전 보고 + 관제 브리핑)만으로 작업 목록(board)을 만들고,
// 대원에게 임무를 나눠 주고, 지원을 요청하고, 종료를 판단한다. 진실 상태는 읽지 않는다.

import type { Sim } from '../engine';
import { emit, raiseProblem } from '../events';
import { closeIncident } from '../incidents';
import type { CasBelief, FieldAgent, Incident, Scene, UnitCaps, WorkItem, WorkKind } from '../types';
import { TYPE_NAME, dist } from '../util';
import { fitFor, hasWork, learn, resp, transmit, workLabel } from './agents';
import { mkFact } from './beliefs';
import { BAND_NAME } from './hazards';

interface Target { region?: number; cas?: number; prop?: number; hostile?: number; tile?: number; mate?: number }

function want(sim: Sim, s: Scene, kind: WorkKind, tg: Target, priority: number, max = 1, thorough = false, cause = -1): WorkItem {
  const region = tg.region ?? -1, cas = tg.cas ?? -1, prop = tg.prop ?? -1, hostile = tg.hostile ?? -1, tile = tg.tile ?? -1, mate = tg.mate ?? -1;
  for (const w of s.board) {
    if (w.kind !== kind || (w.status !== 'open' && w.status !== 'active')) continue;
    if (w.region === region && w.cas === cas && w.prop === prop && w.hostile === hostile && w.tile === tile && w.mate === mate) {
      w.priority = priority; w.max = max; if (thorough) w.thorough = true;
      return w;
    }
  }
  const w: WorkItem = {
    id: s.nextWorkId++, kind, region, cas, prop, hostile, tile, mate, priority, status: 'open', assignees: [], max,
    createdAt: sim.t, doneAt: -1, note: '', fails: 0, holdUntil: 0, thorough, orderSentAt: {}, cause,
  };
  s.board.push(w);
  return w;
}

function cancel(s: Scene, pred: (w: WorkItem) => boolean): void {
  for (const w of s.board) if ((w.status === 'open' || w.status === 'active') && pred(w)) w.status = 'cancelled';
}

const unitsOnScene = (sim: Sim, s: Scene): number[] => {
  const out: number[] = [];
  for (const a of s.agents) if ((a.status === 'active') && out.indexOf(a.unitId) < 0) out.push(a.unitId);
  return out;
};
function capOnScene(sim: Sim, s: Scene, need: keyof UnitCaps): number {
  let m = 0; for (const uid of unitsOnScene(sim, s)) m = Math.max(m, sim.units[uid].caps[need]);
  return m;
}
function countUnits(sim: Sim, s: Scene, I: Incident, need: keyof UnitCaps, min: number): number {
  let n = 0;
  const on = unitsOnScene(sim, s);
  for (const uid of I.assigned) {
    const u = sim.units[uid];
    if (u.caps[need] < min) continue;
    if (u.state === 'enroute' || u.state === 'turnout' || on.indexOf(uid) >= 0) n++;
  }
  return n;
}

function request(sim: Sim, s: Scene, I: Incident, a: FieldAgent, need: keyof UnitCaps, reason: string, urgent: boolean): void {
  if (s.requests.some((q) => q.need === need && (q.fulfilled < q.count || sim.t - q.t < 70))) return;
  const label: Record<string, string> = { suppression: '진압 부대', rescue: '구조 장비 부대', ems: '구급 부대', law: '경찰 부대', tactical: '경찰 기동 부대', search: '수색 인력', traffic: '교통 통제 인력' };
  const ev = transmit(sim, s, a, -2, 'request', [], `관제, ${label[need]} 추가 지원 요청. 사유: ${reason}.`, -1, 2, [I.lastEvent]);
  if (ev < 0) return;     // 음영 구역 — 다음 계획 주기에 재시도
  s.requests.push({ t: sim.t, need, count: 1, reason, eventId: ev, fulfilled: 0, urgent });
}

function expectedPersons(a: FieldAgent): number {
  let n = 0;
  for (const f of a.beliefs.list('occ')) if (typeof f.value.count === 'number' && f.conf >= 0.35) n = Math.max(n, f.value.count);
  return n;
}

function updateZoneProb(sim: Sim, s: Scene, a: FieldAgent): void {
  const zones = s.regions.filter((r) => r.kind === 'zone');
  const p = zones.map((z) => 0.5 + Math.hypot(z.cx - s.staging.x, z.cy - s.staging.y) / 30);
  const seen = a.beliefs.get('seen', 0);
  if (seen) { const k = zones.findIndex((z) => z.id === seen.value.region); if (k >= 0) p[k] *= 1 + 4 * seen.conf; }
  for (const f of a.beliefs.list('occ')) if (typeof f.value.region === 'number' && f.value.region >= 0) { const k = zones.findIndex((z) => z.id === f.value.region); if (k >= 0) p[k] *= 1 + 2.5 * f.conf; }
  for (const f of a.beliefs.list('clue')) { const k = zones.findIndex((z) => z.id === f.value.region); if (k >= 0) p[k] *= 3; }
  zones.forEach((z, k) => { const c = a.beliefs.val<number>('srch', z.id); if (c !== undefined) p[k] *= Math.max(0.04, 1 - c * 0.92); });
  const sum = p.reduce((x, y) => x + y, 0) || 1;
  s.zoneProb = s.regions.map(() => 0);
  zones.forEach((z, k) => { s.zoneProb[z.id] = p[k] / sum; });
}

/** 믿음 → 작업 목록 */
function syncBoard(sim: Sim, s: Scene, I: Incident, a: FieldAgent): void {
  const B = a.beliefs;
  const cas = B.list('cas');
  const fires = B.list('fire');
  const hos = B.list('hos');
  const police = s.agents.filter((b) => b.status === 'active' && sim.responders[b.rid].dept === 'police');
  if (!s.sizeupDone) want(sim, s, 'sizeup', {}, 0.96);

  // ── 화재 ──
  let fireSum = 0, fireRegions = 0;
  for (const f of fires) {
    if (f.value > 0.05) {
      fireSum += f.value; fireRegions++;
      const near = cas.some((c) => c.value.where === 'scene' && c.value.band < 3 && s.region[c.value.y * s.w + c.value.x] === f.id);
      want(sim, s, 'suppress', { region: f.id }, 0.56 + 0.24 * f.value + (near ? 0.14 : 0), f.value > 0.5 ? 2 : 1);
    } else for (const w of s.board) if (w.kind === 'suppress' && w.region === f.id && (w.status === 'open' || w.status === 'active')) { w.status = 'done'; w.doneAt = sim.t; }
  }
  if (fireRegions > 0 && s.props.some((p) => p.kind === 'hydrant')) {
    for (const uid of unitsOnScene(sim, s)) {
      const u = sim.units[uid];
      if (u.dept === 'fire' && !u.hydrant && u.water < u.waterMax * 0.4) want(sim, s, 'hookup', { prop: uid }, 0.8);
    }
  }

  // ── 용의자 ──
  const active = hos.filter((h) => h.value.state === 'hold' || h.value.state === 'fight' || h.value.state === 'flee');
  const surrendered = hos.filter((h) => h.value.state === 'surrendered');
  const threat = active.length > 0 || surrendered.length > 0;
  if (threat && s.secureAt >= 0) s.secureAt = -1;
  for (const h of surrendered) want(sim, s, 'arrest', { hostile: h.id }, 0.93);
  for (const h of active) {
    if (h.value.state === 'flee') { want(sim, s, 'engage', { hostile: h.id }, 0.95, 2); continue; }
    s.exits.forEach((_, k) => want(sim, s, 'perimeter', { tile: k }, 0.76 - k * 0.05));
    const gun = h.value.weapon === 'gun';
    if (s.negotStart < 0) s.negotStart = sim.t;
    const waited = sim.t - s.negotStart;
    if (!gun) {
      want(sim, s, 'negotiate', { hostile: h.id }, 0.8);
      if (police.length >= 2 || waited > 25) want(sim, s, 'arrest', { hostile: h.id }, 0.72);
      continue;
    }
    if (!s.entryOrdered) {
      want(sim, s, 'negotiate', { hostile: h.id }, 0.73);
      const crit = cas.some((c) => c.value.where === 'scene' && c.value.band === 2);
      const fighting = h.value.state === 'fight';
      let why = '';
      if (crit && police.length >= 2 && waited > 12) why = '내부에 위중한 부상자가 있어 더 기다릴 수 없음';
      else if (fighting && police.length >= 3 && waited > 22) why = '용의자가 계속 발포하고 협상에 응하지 않음';
      else if (waited > 60 && police.length >= 3) why = '협상에 진전이 없고 진입 인원이 확보됨';
      else if (waited > 100 && police.length >= 2) why = '장시간 대치로 더 이상의 지연은 위험';
      if (why) {
        s.entryOrdered = true;
        emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 3, causes: [I.lastEvent], text: `진입 결정. ${why}. 진입조는 엄호 아래 진입하라.` });
      }
    }
    if (s.entryOrdered) { want(sim, s, 'engage', { hostile: h.id }, 0.9, 3); cancel(s, (w) => w.kind === 'negotiate' && w.hostile === h.id); }
  }
  if (!threat) cancel(s, (w) => w.kind === 'perimeter' || w.kind === 'negotiate' || w.kind === 'engage');

  // ── 수색 ──
  const expected = expectedPersons(a);
  const found = cas.length;
  const th = s.researchRound > 0 ? 0.9 : 0.72;
  const hotArmed = s.kind === 'armed' && s.secureAt < 0;
  let pendingSearch = 0;
  if (s.kind === 'search') {
    updateZoneProb(sim, s, a);
    const targetsFound = cas.length;
    if (targetsFound < Math.max(1, expected)) {
      const zones = s.regions.filter((r) => r.kind === 'zone');
      let maxP = 0; for (const z of zones) maxP = Math.max(maxP, s.zoneProb[z.id]);
      for (const z of zones) {
        const c = B.val<number>('srch', z.id) ?? -1;
        if (c >= th) continue;
        pendingSearch++;
        want(sim, s, 'search', { region: z.id }, 0.36 + 0.5 * (s.zoneProb[z.id] / (maxP || 1)), 1, s.researchRound > 0 || c >= 0);
      }
      if (pendingSearch === 0 && s.researchRound < 3) {
        s.researchRound++;
        // 모든 구역을 봤는데도 못 찾았다 → 놓쳤다고 보고 확인율을 낮춰 정밀 재수색
        const redo = [];
        for (const z of zones) { const f = B.get('srch', z.id); if (f) { const nf = mkFact('srch', z.id, Math.min(f.value, 0.45), '지휘관 재평가', sim.t, 0.5, true, `${z.name} 재수색 필요`); B.merge(nf); redo.push(nf); } }
        if (redo.length) transmit(sim, s, a, -1, 'report', redo, '', -1, 0, [], true);
        raiseProblem(sim, I, 'VICTIM_MISSED', '전 구역 1차 수색에서 대상을 찾지 못함', { role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, imp: 2, text: `전 구역을 수색했지만 대상을 찾지 못했습니다. 탐색 범위를 재조정하고 간격을 좁혀 정밀 재수색합니다 (${s.researchRound}차).` }, false);
      }
    } else cancel(s, (w) => w.kind === 'search');
  } else {
    const activeThreat = active.length > 0 || surrendered.length > 0;
    const wrecksPending = s.regions.some((r) => r.kind === 'wreck' && (B.val<number>('srch', r.id) ?? -1) < 0.6);
    const evid = B.list('evid').some((f) => f.value.kind === 'emptySeat');
    if (s.kind === 'armed' && (activeThreat || !s.sizeupDone)) cancel(s, (w) => w.kind === 'search');
    for (const r of s.regions) {
      if (!r.searchable) continue;
      const c = B.val<number>('srch', r.id) ?? -1;
      if (s.kind === 'armed' && (activeThreat || !s.sizeupDone)) continue;
      if (r.kind === 'wreck') { if (c < 0.6) { pendingSearch++; want(sim, s, 'search', { region: r.id }, 0.78); } continue; }
      if (r.kind === 'verge') {
        if (c >= th) continue;
        if (evid || (!wrecksPending && expected > found)) { pendingSearch++; want(sim, s, 'search', { region: r.id }, 0.64, 1, sim.weather !== 'clear' || c >= 0); }
        continue;
      }
      if (s.kind !== 'fire' && s.kind !== 'armed') continue;
      if (c >= th) continue;
      const fl = B.val<number>('fire', r.id) ?? 0;
      pendingSearch++;
      if (fl > 0.75) continue;      // 화세가 너무 강함 — 진압 후 수색
      let pr = hotArmed ? 0.7 : 0.52;
      for (const f of B.list('occ')) if (f.value.region === r.id) pr += 0.22 * f.conf;
      if (fl > 0.05) pr += 0.1;
      for (const f of fires) if (f.value > 0.3 && f.id !== r.id && Math.abs(s.regions[f.id].cx - r.cx) + Math.abs(s.regions[f.id].cy - r.cy) < 9) { pr += 0.1; break; }
      want(sim, s, 'search', { region: r.id }, Math.min(0.88, pr), 1, c >= 0 || s.researchRound > 0);
    }
    if ((s.kind === 'fire' || s.kind === 'traffic') && pendingSearch === 0 && expected > found && s.researchRound < 1 && s.sizeupDone) {
      s.researchRound = 1;
      // 수색을 마친 구역의 확인율을 낮춰 잡고(=놓쳤을 수 있다고 보고) 간격을 좁혀 다시 본다
      const redo = [];
      for (const r of s.regions) { const f = B.get('srch', r.id); if (f && r.searchable && r.kind !== 'wreck') { const nf = mkFact('srch', r.id, Math.min(f.value, 0.5), '지휘관 재평가', sim.t, 0.5, true, `${r.name} 재수색 필요`); B.merge(nf); redo.push(nf); } }
      if (redo.length) transmit(sim, s, a, -1, 'report', redo, '', -1, 0, [], true);
      raiseProblem(sim, I, 'RECOUNT', `신고 인원 ${expected}명, 확인 ${found}명`, { role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, imp: 2, text: `인원 불일치: 신고된 인원은 ${expected}명인데 ${found}명만 확인했습니다. 놓친 사람이 있을 수 있습니다 — 전 구역 정밀 재수색.` }, false);
    }
    if (s.kind === 'armed' && !activeThreat && pendingSearch === 0 && s.secureAt < 0 && s.sizeupDone) {
      s.secureAt = sim.t;
      learn(sim, a, mkFact('secure', 0, true, resp(sim, a).name, sim.t, 1, true, '현장 안전 확보 — 구급·구조 인력 진입 가능'));
      emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 2, text: '건물 내부 수색 완료. 현장 안전 확보를 선언합니다. 구급대 진입하라.' });
    }
  }

  // 이미 충분히 확인된 구역에 대한 수색 지시는 거둔다
  for (const w of s.board) if (w.kind === 'search' && w.status === 'open') {
    const c = B.val<number>('srch', w.region) ?? -1;
    if (c >= (s.regions[w.region].kind === 'wreck' ? 0.6 : th)) w.status = 'cancelled';
  }

  // ── 구조 대상 ──
  const ambulances = unitsOnScene(sim, s).filter((uid) => sim.units[uid].dept === 'ems' && sim.units[uid].patients.length < 2 && !sim.units[uid].boardOrder);
  for (const f of cas) {
    const c = f.value as CasBelief;
    const dead = c.band === 3;
    const clear = (kinds: WorkKind[]) => cancel(s, (w) => w.cas === f.id && kinds.indexOf(w.kind) >= 0 && !(w.kind === 'carry' && w.status === 'active'));
    if (dead || c.where === 'loaded' || c.where === 'hospital') { clear(['extricate', 'treat', 'carry', 'load']); continue; }
    const urg = c.band * 0.06;
    if (c.where === 'scene') {
      if (c.mob === 'trapped') { want(sim, s, 'extricate', { cas: f.id }, 0.82 + urg, 2); continue; }
      if (c.mob === 'mobile') {                // 스스로 대피 중 — 한참 지나도 도착 보고가 없으면 확인하러 보낸다
        if (sim.t - f.t > 32) want(sim, s, 'escort', { cas: f.id }, 0.62 + urg);
        continue;
      }
      const rg = s.region[c.y * s.w + c.x];
      const indoorHazard = s.kind === 'fire' || (rg >= 0 && (B.val<number>('fire', rg) ?? 0) > 0.1);
      const hasMedic = s.agents.some((b) => b.status === 'active' && sim.responders[b.rid].dept === 'ems');
      if (!indoorHazard && !c.treated && c.band >= 1 && hasMedic && !hotArmed) { want(sim, s, 'treat', { cas: f.id }, 0.8 + urg); want(sim, s, 'carry', { cas: f.id }, 0.5, 2); }
      else want(sim, s, 'carry', { cas: f.id }, 0.84 + urg, 2);
    } else if (c.where === 'safe') {
      if (!c.treated && c.band >= 1) want(sim, s, 'treat', { cas: f.id }, 0.72 + urg);
      if (c.band >= 1 && ambulances.length) {
        const already = s.board.some((w) => w.kind === 'load' && w.cas === f.id && (w.status === 'open' || w.status === 'active'));
        if (!already) {
          let best = ambulances[0];
          for (const uid of ambulances) {
            const queued = s.board.filter((w) => w.kind === 'load' && w.prop === uid && (w.status === 'open' || w.status === 'active')).length;
            if (sim.units[uid].patients.length + queued < 2) { best = uid; break; }
          }
          const queuedBest = s.board.filter((w) => w.kind === 'load' && w.prop === best && (w.status === 'open' || w.status === 'active')).length;
          if (sim.units[best].patients.length + queuedBest < 2) want(sim, s, 'load', { cas: f.id, prop: best }, (c.treated ? 0.7 : 0.5) + urg);
        }
      }
    }
  }
  for (const f of B.list('mate')) if (f.value.status === 'down') want(sim, s, 'rescueMate', { mate: f.id }, 0.97, 2);

  // ── 교통 통제 / 위험 조치 / 도로 정리 ──
  if (s.laneRows.length) {
    const hit = I.problems.some((p) => p.code === 'SECONDARY_COLLISION');
    s.controlPts.forEach((_, k) => { if (!B.get('ctl', k)) want(sim, s, 'traffic', { tile: k }, hit ? 0.9 : 0.74); });
  }
  for (const f of B.list('haz')) if (f.value.kind === 'leak') { if (f.value.active) want(sim, s, 'mitigate', { prop: f.id }, 0.86); else cancel(s, (w) => w.kind === 'mitigate' && w.prop === f.id); }
  if (s.kind === 'traffic' && s.sizeupDone) {
    const unresolved = cas.some((f) => f.value.band < 3 && (f.value.where === 'scene' || f.value.where === 'carried'));
    if (!unresolved && pendingSearch === 0 && fireRegions === 0) {
      for (const p of s.props) if ((p.kind === 'vehicle' && !p.cleared) || (p.kind === 'roadDebris' && !p.removed)) want(sim, s, 'clearRoad', { prop: p.id }, p.kind === 'vehicle' ? 0.42 : 0.36);
    }
  }
  for (const f of B.list('evid')) if (f.value.kind === 'witness' && !f.value.done) want(sim, s, 'interview', { prop: f.id }, 0.82);

  // ── 지원 요청 ──
  const fireUnits = countUnits(sim, s, I, 'suppression', 0.7);
  if (fireRegions > 0 && fireUnits === 0) request(sim, s, I, a, 'suppression', '화재가 확인됐으나 진압 부대가 없음', true);
  else if ((fireSum >= 2.0 || fireRegions >= 3) && fireUnits < 2) request(sim, s, I, a, 'suppression', `화재가 ${fireRegions}개 구역으로 확대`, true);
  if (cas.some((f) => f.value.mob === 'trapped' && f.value.band < 3 && f.value.where === 'scene') && countUnits(sim, s, I, 'rescue', 0.5) === 0) request(sim, s, I, a, 'rescue', '고립된 구조 대상이 있으나 구조 장비가 없음', true);
  const patients = cas.filter((f) => f.value.band >= 1 && f.value.band < 3 && (f.value.where === 'scene' || f.value.where === 'carried' || f.value.where === 'safe'));
  const emsUnits = countUnits(sim, s, I, 'ems', 0.7);
  if (patients.length > 0 && emsUnits === 0) request(sim, s, I, a, 'ems', `부상자 ${patients.length}명 확인, 구급 부대 없음`, patients.some((f) => f.value.band === 2));
  else if (patients.length > 2 * emsUnits && emsUnits < 2 && emsUnits > 0) request(sim, s, I, a, 'ems', `부상자 ${patients.length}명으로 구급 부대 1대로 감당 불가`, true);
  if (B.list('mate').some((f) => f.value.status === 'down') && emsUnits === 0) request(sim, s, I, a, 'ems', '대원 부상', true);
  const gunActive = active.some((h) => h.value.weapon === 'gun');
  const lawUnits = countUnits(sim, s, I, 'law', 0.5);
  if (gunActive && lawUnits < 2) request(sim, s, I, a, lawUnits === 0 ? 'law' : 'tactical', '총기를 소지한 용의자와 대치 중, 인원 부족', true);
  else if (active.length > 0 && lawUnits === 0) request(sim, s, I, a, 'law', '용의자 대응 인력 없음', true);
  if (s.laneRows.length && lawUnits === 0 && !s.controlDone.every(Boolean) && cas.length > 0 && s.sizeupDone) request(sim, s, I, a, 'traffic', '차량 통행이 계속되는데 교통 통제 인력이 없음', false);
  if (s.kind === 'search' && cas.length === 0 && s.arrivedAt >= 0 && sim.t - s.arrivedAt > 75 && countUnits(sim, s, I, 'search', 0.3) < 3) request(sim, s, I, a, 'search', '수색 범위에 비해 인력 부족', false);
}

/** 작업 배정 */
function assign(sim: Sim, s: Scene, I: Incident, a: FieldAgent): void {
  const me = resp(sim, a);
  // 응답 없는 지시 확인
  for (const w of s.board) {
    if (w.status !== 'active') continue;
    for (let k = w.assignees.length - 1; k >= 0; k--) {
      const rid = w.assignees[k];
      const b = s.agents.find((q) => q.rid === rid);
      if (!b || b.status !== 'active') { w.assignees.splice(k, 1); continue; }
      if ((b.task && b.task.workId === w.id) || b.orderWork === w.id) continue;
      const sent = w.orderSentAt[rid] ?? sim.t;
      if (sim.t - sent < 4.5) continue;
      w.assignees.splice(k, 1);
      if (rid !== a.rid && !b.task) {
        raiseProblem(sim, I, 'COMM_FAIL', `${sim.responders[rid].name}에게 보낸 지시 미수신`, { role: 'COMMANDER', actor: me.name, rid: a.rid, imp: 1, text: `${sim.responders[rid].name}, 응답 없음. 지시가 전달되지 않은 것으로 판단하고 임무를 재배정합니다.` }, false);
        w.holdUntil = sim.t + 2;
      }
    }
    if (!w.assignees.length) w.status = 'open';
  }
  const items = s.board.filter((w) => (w.status === 'open' || w.status === 'active') && w.assignees.length < w.max && sim.t >= w.holdUntil);
  items.sort((x, y) => y.priority - x.priority || x.id - y.id);
  const taken = new Set<number>();
  for (let pass = 0; pass < 2; pass++) {
    for (const w of items) {
      if (pass === 0 && w.assignees.length > 0) continue;
      if (pass === 1 && (w.assignees.length === 0 || w.assignees.length >= w.max)) continue;
      let best: FieldAgent | null = null, bs = 0;
      for (const b of s.agents) {
        if (b.status !== 'active' || taken.has(b.rid) || w.assignees.indexOf(b.rid) >= 0) continue;
        if (sim.units[b.unitId].boardOrder) continue;
        const fit = fitFor(sim, s, b, w);
        if (fit <= 0) continue;
        // 이미 일하는 중이면 우선순위 차이가 클 때만 빼 온다
        let curPr = -1;
        const curW = b.task && b.task.workId >= 0 ? s.board[b.task.workId] : b.orderWork >= 0 ? s.board[b.orderWork] : null;
        if (curW && (curW.status === 'active' || curW.status === 'open')) curPr = curW.priority;
        else if (hasWork(b) && b.task!.kind !== 'rehab') curPr = 0.6;
        if (b.carrying !== -1) continue;
        if (curPr >= 0 && (pass === 1 || w.priority < curPr + 0.22)) continue;
        if (b === a && w.kind !== 'sizeup') { if (pass === 1) continue; }
        const r = sim.responders[b.rid];
        const d = dist(b.x, b.y, targetX(s, w, a), targetY(s, w, a));
        let sc = fit * 0.5 + (1 - Math.min(1, d / 34)) * 0.22 + (r.stamina / 100) * 0.1 + r.experience * 0.08 + (curPr < 0 ? 0.12 : 0);
        if (b === a && w.kind !== 'sizeup') sc -= 0.18;      // 지휘관은 가급적 지휘에 집중
        if (sc > bs) { bs = sc; best = b; }
      }
      if (!best) continue;
      taken.add(best.rid);
      w.assignees.push(best.rid); w.status = 'active'; w.orderSentAt[best.rid] = sim.t;
      const br = sim.responders[best.rid];
      if (best === a) { a.orderWork = w.id; continue; }
      const redo = w.fails > 0 ? ' (재지시)' : '';
      transmit(sim, s, a, best.rid, 'order', [], `${br.name}, ${workLabel(s, w)}${w.kind === 'search' || w.kind === 'suppress' || w.kind === 'carry' ? ' 실시' : ' 맡아라'}${redo}.`, w.id, w.priority > 0.8 ? 1 : 0, w.cause >= 0 ? [w.cause] : []);
    }
  }
}

function targetX(s: Scene, w: WorkItem, a: FieldAgent): number {
  if (w.region >= 0) return s.regions[w.region].cx;
  if (w.cas >= 0) { const c = a.beliefs.val<CasBelief>('cas', w.cas); if (c) return c.x; }
  if (w.kind === 'traffic') return s.controlPts[w.tile].x;
  if (w.kind === 'perimeter') return s.exits[w.tile].x;
  if (w.kind === 'hookup' || w.kind === 'load') return s.staging.x;
  if (w.prop >= 0 && s.props[w.prop]) return s.props[w.prop].x;
  if (w.hostile >= 0) { const h = a.beliefs.val<any>('hos', w.hostile); if (h) return h.x; }
  return s.staging.x;
}
function targetY(s: Scene, w: WorkItem, a: FieldAgent): number {
  if (w.region >= 0) return s.regions[w.region].cy;
  if (w.cas >= 0) { const c = a.beliefs.val<CasBelief>('cas', w.cas); if (c) return c.y; }
  if (w.kind === 'traffic') return s.controlPts[w.tile].y;
  if (w.kind === 'perimeter') return s.exits[w.tile].y;
  if (w.kind === 'hookup' || w.kind === 'load') return s.staging.y;
  if (w.prop >= 0 && s.props[w.prop]) return s.props[w.prop].y;
  if (w.hostile >= 0) { const h = a.beliefs.val<any>('hos', w.hostile); if (h) return h.y; }
  return s.staging.y;
}

/** 현장 평가 직후: 관제가 알려준 내용과 실제가 다른가 */
function checkMismatch(sim: Sim, s: Scene, I: Incident, a: FieldAgent): void {
  s.mismatchLogged = true;
  const B = a.beliefs, me = resp(sim, a);
  const diffs: string[] = [];
  const as = I.assessment;
  const seenType = s.kind;       // 지휘관은 도착해서 사건의 성격을 직접 본다
  learn(sim, a, mkFact('type', 0, seenType, me.name, sim.t, 1, true, `현장 확인: ${TYPE_NAME[seenType]}`), false);
  if (as && as.type !== seenType) diffs.push(`신고는 ${TYPE_NAME[as.type]}였으나 실제는 ${TYPE_NAME[seenType]}`);
  const hos = B.list('hos');
  const gunSeen = hos.some((h) => h.value.weapon === 'gun');
  const claimWeapon = I.claims.filter((c) => c.topic === 'weapon').pop();
  if (gunSeen && (!claimWeapon || claimWeapon.value !== 'gun')) diffs.push('신고에 없던 총기 소지 용의자 확인');
  if (!gunSeen && hos.length > 0 && claimWeapon && claimWeapon.value === 'gun') diffs.push('신고와 달리 총기는 확인되지 않음');
  const fires = B.list('fire').filter((f) => f.value > 0.05);
  if (as && as.severity < 2 && (fires.length >= 2 || fires.some((f) => f.value >= 0.8))) diffs.push(`화재 규모가 신고보다 큼 (${fires.length}개 구역)`);
  if (as && as.type === 'fire' && seenType === 'fire' && fires.length === 0 && s.burning === 0) diffs.push('도착 시 화염은 보이지 않음');
  const trapped = B.list('cas').filter((f) => f.value.mob === 'trapped').length;
  const claimTrap = I.claims.filter((c) => c.topic === 'trapped').pop();
  if (trapped > 0 && (!claimTrap || claimTrap.value !== true)) diffs.push(`신고에 없던 고립자 ${trapped}명 확인`);
  if (diffs.length) {
    raiseProblem(sim, I, 'SCENE_MISMATCH', diffs.join(', '), { role: 'COMMANDER', actor: me.name, rid: a.rid, imp: 3, causes: I.callEvents.slice(-2), text: `현장 평가 완료. 최초 신고 내용과 다른 상황이 확인됐습니다: ${diffs.join(' / ')}.` }, false);
  } else {
    emit(sim, { inc: I.id, role: 'COMMANDER', actor: me.name, rid: a.rid, kind: 'command', imp: 1, text: '현장 평가 완료. 신고 내용과 대체로 일치합니다. 대응을 시작합니다.' });
  }
  sitrep(sim, s, I, a, true);
}

function sitrep(sim: Sim, s: Scene, I: Incident, a: FieldAgent, force = false): void {
  if (!force && sim.t - s.lastSitrep < 45) return;
  const B = a.beliefs;
  const cas = B.list('cas');
  const fires = B.list('fire').filter((f) => f.value > 0.05);
  const hos = B.list('hos').filter((h) => h.value.state === 'hold' || h.value.state === 'fight' || h.value.state === 'flee');
  const parts: string[] = [];
  if (fires.length) parts.push(`화재 ${fires.length}개 구역`);
  if (cas.length) { const bands = [0, 0, 0, 0]; for (const c of cas) bands[c.value.band]++; parts.push(`구조 대상 ${cas.length}명 확인(${bands.map((n, k) => (n ? `${BAND_NAME[k]} ${n}` : '')).filter(Boolean).join(', ')})`); }
  if (hos.length) parts.push(`용의자 ${hos.length}명 대치 중`);
  if (!parts.length) parts.push(s.kind === 'search' ? '대상 수색 중' : '특이 사항 없음');
  const ev = transmit(sim, s, a, -2, 'sitrep', [], `관제, 현장 상황 보고: ${parts.join(', ')}.`, -1, 0);
  if (ev < 0) return;
  s.lastSitrep = sim.t;
}

function canClose(sim: Sim, s: Scene, a: FieldAgent): boolean {
  if (!s.sizeupDone) return false;
  const B = a.beliefs;
  if (s.board.some((w) => w.status === 'open' || w.status === 'active')) return false;
  if (B.list('fire').some((f) => f.value > 0.05)) return false;
  for (const f of B.list('cas')) {
    const c = f.value as CasBelief;
    if (c.band === 3 || c.where === 'loaded' || c.where === 'hospital') continue;
    if (c.where === 'safe' && c.band === 0) continue;
    return false;
  }
  if (B.list('hos').some((h) => h.value.state === 'hold' || h.value.state === 'fight' || h.value.state === 'flee' || h.value.state === 'surrendered')) return false;
  if (s.kind === 'armed' && s.secureAt < 0) return false;
  if (s.kind === 'search' && B.list('cas').length < 1) return false;
  if (B.list('mate').some((f) => f.value.status === 'down')) return false;
  return true;
}

function manageAmbulances(sim: Sim, s: Scene, I: Incident, a: FieldAgent): void {
  const cas = a.beliefs.list('cas');
  for (const uid of unitsOnScene(sim, s)) {
    const u = sim.units[uid];
    if (u.dept !== 'ems' || !u.patients.length || u.boardOrder) continue;
    const waiting = cas.filter((f) => f.value.band >= 1 && f.value.band < 3 && (f.value.where === 'scene' || f.value.where === 'carried' || f.value.where === 'safe'));
    const loading = s.board.some((w) => w.kind === 'load' && w.prop === uid && (w.status === 'open' || w.status === 'active'));
    const firstLoad = Math.min(...u.patients.map((cid) => s.casualties[cid].tLoaded));
    const waited = sim.t - firstLoad;
    const redAboard = u.patients.some((cid) => s.casualties[cid].health < 40);
    if (loading && waited < 30) continue;
    if (u.patients.length >= 2 || waiting.length === 0 || (redAboard && waited > 10) || waited > 35) {
      u.boardOrder = 'transport';
      cancel(s, (w) => w.kind === 'load' && w.prop === uid);
      emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 1, text: `${u.callsign}, 환자 ${u.patients.length}명 병원 이송 출발하라.` });
    }
  }
}

export function commanderThink(sim: Sim, s: Scene, a: FieldAgent): void {
  const I = sim.incidents[s.incidentId];
  if (I.phase === 'closed' || s.closing) return;
  syncBoard(sim, s, I, a);
  if (s.sizeupDone && !s.mismatchLogged) checkMismatch(sim, s, I, a);
  manageAmbulances(sim, s, I, a);
  assign(sim, s, I, a);
  if (s.sizeupDone) sitrep(sim, s, I, a);
  // 종료 판단: 두 번 연속으로 조건이 충족돼야 한다
  if (canClose(sim, s, a)) {
    if (s.closedCheckAt > 0 && sim.t - s.closedCheckAt >= 3) {
      emit(sim, { inc: I.id, role: 'COMMANDER', actor: resp(sim, a).name, rid: a.rid, kind: 'command', imp: 2, text: '확인된 위험과 구조 대상 처리가 끝났습니다. 상황 종료를 선언합니다. 전 부대 철수.' });
      closeIncident(sim, I, 'resolved');
    } else if (s.closedCheckAt <= 0) s.closedCheckAt = sim.t;
  } else s.closedCheckAt = 0;
}
