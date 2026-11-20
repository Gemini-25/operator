// 세계 상태 (설계서 I1 §3.2~§3.4·§3.8): 구역(동네)의 기반 시설·연기·위험, 병원의 수용 — 교대 안에서 새로 생기는 상태.
// 만들기(initWorld)·회복(recoverWorld)·값 넣기(setZone)와, 관제·지휘관이 쓰는 "알려진 것만" 꺼내는 함수들.
//
// 정보 격리 (§3.8):
//   진실 쪽  — sim.world 를 직접 읽고 바꾼다: 세계 규칙(world/rules/*), hazards·executor, 이 파일의 placeState·setZone·recoverWorld
//   판단 쪽  — dispatch/*·field/commander·brain·orders/* 는 sim.world·sim.placeMarks·sim.carryState 를 읽지 않는다.
//              knownZone · knownHospital · knownBuildingAt · knownZoneOfIncident 만 쓴다 (tests/causality.test.ts 가 소스를 본다).
// 건물 상태는 여기 두지 않는다 — 교대 안은 X6 의 Sim.placeMarks, 교대 사이는 I2 의 carryState.places. 도시 지도(city.places)는 고치지 않는다.
// 모든 칸은 함수가 없는 순수 자료다. 난수를 쓰지 않는다.

import { districtAt } from '../city';
import { DISTRICTS } from '../cityPlan';
import type { Sim } from '../engine';
import type { HospitalState, Incident, PlaceKind, WorldState, ZoneField, ZoneState } from '../types';

export const ZONE_FIELDS: readonly ZoneField[] = ['power', 'comms', 'water', 'smoke', 'risk'];
/** 구역 값의 처음 값(정상): 전력·통신·수도는 1, 연기·위험은 0 */
export const ZONE_DEFAULT: Readonly<Record<ZoneField, number>> = { power: 1, comms: 1, water: 1, smoke: 0, risk: 0 };
/**
 * 응급실 동시 수용 — city.facilities 의 병원 순서대로 (= cityPlan.LANDMARKS 의 순서: 시립병원 · 가온대학교병원). 더 많으면 마지막 값.
 * (b3-2 C3) R3 뒤의 이송량에 맞춘 값이다: 보통 교대는 한 교대에 18명쯤을 병원에 넘기고 그 3분의 2 가 가까운 시립병원으로 간다
 * (체류 300초 안의 최댓값 — 시립병원 중앙값 6, 가온대학교병원 3~4). 본문의 첫 값 6·8 로는 보통 교대의 60% 에서 포화가 났다
 */
export const HOSPITAL_CAP: readonly number[] = [8, 10];

const zoneBlank = (): ZoneState => ({
  power: 1, comms: 1, water: 1, smoke: 0, risk: 0,
  until: { power: 0, comms: 0, water: 0, smoke: 0, risk: 0 },
  known: { power: false, comms: false, water: false, smoke: false, risk: false },
  cause: { power: -1, comms: -1, water: -1, smoke: -1, risk: -1 },
});

/**
 * 교대를 시작할 때의 세계 상태 — 모든 동네가 정상, 병원은 비어 있다.
 * carry 는 지금 받지 않는다: 병원·구역 상태의 교대 간 지속은 I2 범위 밖이다 (나중에 같은 틀로 넘길 수 있게 자리만 둔다)
 */
export function initWorld(sim: Sim, carry?: unknown): WorldState {
  void carry;
  const hospitals: HospitalState[] = [];
  for (const f of sim.city.facilities) if (f.kind === 'hospital') hospitals.push({ fac: f.id, cap: HOSPITAL_CAP[Math.min(hospitals.length, HOSPITAL_CAP.length - 1)], stays: [], divert: false, known: false, since: -1, cause: -1, lastEv: -1 });
  return { zones: DISTRICTS.map(zoneBlank), hospitals, signals: [], log: [], last: {}, count: {}, tries: {}, spawned: 0 };
}

const DONG_INDEX = new Map<string, number>(DISTRICTS.map((d, i) => [d.dong, i]));
/** 그 점의 구역(DISTRICTS 인덱스). 모든 동네의 반지름 × 1.22 밖이면 -1 — 구역 -1 은 어느 구역 상태도 받지 않고 만들지 않는다 (§3.2) */
export function zoneOfXY(x: number, y: number): number {
  const d = districtAt(x, y);
  return d ? DONG_INDEX.get(d.dong) ?? -1 : -1;
}
/** 그 건물의 구역. '산촌'·'외곽' 은 DISTRICTS 에 없으므로 -1 */
export function zoneOfPlace(sim: Sim, placeId: number): number {
  const q = sim.city.places[placeId];
  return q ? DONG_INDEX.get(q.dong) ?? -1 : -1;
}
/** 구역의 이름 (기록 문구용). -1 이면 '외곽' */
export function zoneName(z: number): string { return z >= 0 && z < DISTRICTS.length ? DISTRICTS[z].dong : '외곽'; }

/**
 * (진실 쪽 — 세계 규칙 전용) 구역 값을 넣는다. 누적이 아니라 덮어쓰기다 (§3.6 "포화되는 상태"):
 * 전력·통신·수도는 더 낮은 값만, 연기·위험은 더 높은 값만 받는다. 회복 시각은 더 늦은 쪽.
 * 값이 실제로 나빠졌을 때만 원인 기록을 바꾼다. 알려짐은 켜기만 한다(끄는 것은 회복). 돌려주는 값 = 값이 바뀌었는가. 구역 -1 은 아무것도 하지 않는다
 */
export function setZone(sim: Sim, z: number, f: ZoneField, v: number, until: number, cause: number, known: boolean): boolean {
  const Z = sim.world.zones[z];
  if (!Z) return false;
  const low = ZONE_DEFAULT[f] === 1, cur = Z[f];
  const worse = low ? v < cur : v > cur;
  if (worse) { Z[f] = v; Z.cause[f] = cause; }
  if (worse || cur !== ZONE_DEFAULT[f]) { if (until > Z.until[f]) Z.until[f] = until; if (known) Z.known[f] = true; }
  return worse;
}

/**
 * 회복 (tickWorld 가 1초에 한 번 부른다): 회복 시각이 지난 구역 값을 처음 값으로 되돌리고, 병동으로 옮겨진 환자를 응급실 체류에서 뺀다.
 * 되돌린 칸마다 note(구역, 칸, 그 값을 만든 기록, 관제가 알았는가)를 부른다 — 규칙이 복구 기록을 남기고 자기가 얹은 것(혼잡·음영)을 거둔다.
 * 아무것도 나빠져 있지 않으면(규칙이 없는 교대) 아무것도 바꾸지 않는다
 */
export function recoverWorld(sim: Sim, note?: (z: number, f: ZoneField, cause: number, known: boolean) => void): void {
  const w = sim.world, t = sim.t;
  for (let z = 0; z < w.zones.length; z++) {
    const Z = w.zones[z];
    for (let k = 0; k < ZONE_FIELDS.length; k++) {
      const f = ZONE_FIELDS[k];
      if (Z[f] === ZONE_DEFAULT[f] || t < Z.until[f]) continue;
      const cause = Z.cause[f], known = Z.known[f];
      Z[f] = ZONE_DEFAULT[f]; Z.until[f] = 0; Z.known[f] = false; Z.cause[f] = -1;
      if (note) note(z, f, cause, known);
    }
  }
  for (let h = 0; h < w.hospitals.length; h++) {
    const st = w.hospitals[h].stays;
    if (!st.length) continue;
    let k = 0;
    for (let i = 0; i < st.length; i++) if (st[i] > t) st[k++] = st[i];
    st.length = k;
  }
}

// ───────────────────────── 알려진 것만 (판단 쪽이 쓰는 함수) ─────────────────────────

/** 관제가 아는 구역 상태 — 알려진(known) 칸만 담아 준다. 구역 -1 이나 아는 것이 없으면 빈 객체 */
export function knownZone(sim: Sim, z: number): Partial<Record<ZoneField, number>> {
  const out: Partial<Record<ZoneField, number>> = {};
  const Z = sim.world.zones[z];
  if (!Z) return out;
  for (let k = 0; k < ZONE_FIELDS.length; k++) { const f = ZONE_FIELDS[k]; if (Z.known[f]) out[f] = Z[f]; }
  return out;
}
/** 관제가 아는 병원 상태 (병원이 알린 것만 — 포화 알림·수용 재개). ev = 그것을 알린 기록. 알린 적이 없으면 null */
export function knownHospital(sim: Sim, fac: number): { divert: boolean; ev: number } | null {
  const hs = sim.world.hospitals;
  for (let k = 0; k < hs.length; k++) if (hs[k].fac === fac) return hs[k].known ? { divert: hs[k].divert, ev: hs[k].cause } : null;
  return null;
}
/** (진실 쪽 — 세계 규칙·resources.arrive 의 응급실 대기 전용) 그 시설의 병원 상태. 병원이 아니면 null */
export function hospitalOf(sim: Sim, fac: number): HospitalState | null {
  const hs = sim.world.hospitals;
  for (let k = 0; k < hs.length; k++) if (hs[k].fac === fac) return hs[k];
  return null;
}
/** (진실 쪽) 지금 응급실에 있는 환자 수 — 병동으로 옮겨질 시각이 아직 오지 않은 체류 (회복이 1초에 한 번 지난 것을 빼므로 그 사이의 것은 여기서 거른다) */
export function erLoad(H: HospitalState, t: number): number {
  let n = 0;
  for (let i = 0; i < H.stays.length; i++) if (H.stays[i] > t) n++;
  return n;
}
/** 관제 쪽에서 사건의 구역을 구하는 유일한 길 — 진실의 자리(truth.x·y)가 아니라 알려진 교차로로. 위치를 모르면 -1 */
export function knownZoneOfIncident(sim: Sim, I: Incident): number {
  if (!I.locationKnown) return -1;
  const n = sim.city.nodes[I.reportedNode];
  return n ? zoneOfXY(n.x, n.y) : -1;
}

/**
 * (진실 쪽 — 세계 규칙 전용) 건물 상태: X6 의 Sim.placeMarks → I2 의 carryState.places 순서로 읽는다 (둘 다 없으면 null).
 * usable = 그 건물에서 새 사건을 낼 수 있는가 — 교대 안은 X6 의 규칙(전소·전체 붕괴가 아니면), 이어받은 건물은 출입 통제·무너짐이 아니면.
 * I2 단계 5 가 persist.placeUsable 을 만들면 usable 은 그것을 부른다 (지금은 incidents.placeGone 과 같은 뜻)
 */
export function placeState(sim: Sim, placeId: number): { mark: string | null; burnFrac: number; ruinFrac: number; usable: boolean } | null {
  const pm = sim.placeMarks.get(placeId);
  if (pm) return { mark: pm.state, burnFrac: pm.burnFrac, ruinFrac: pm.ruinFrac, usable: pm.state !== 'burnt' && pm.state !== 'collapsed' };
  const pc = sim.carryState.places.get(placeId);
  if (pc) return { mark: pc.mark ?? null, burnFrac: pc.soot, ruinFrac: pc.dmg, usable: pc.state === 'marked' };
  return null;
}

/**
 * 관제가 아는 건물 상태. 관제는 건물 id 를 모른다(위치 진술은 교차로 id 뿐) — 그래서 알려진 교차로로 묻는다:
 *  ① 그 교차로(reportedNode)에서 이번 교대에 닫힌, 위치를 알았던 사건 가운데 건물 종류가 같은 것(placeKind 를 주면) — 가장 최근 것.
 *     그 건물에 남은 상태(X6 의 placeMarks)가 있으면 그 값, 없으면 탄 비율 0 · 쓸 수 있음.
 *  ② 없으면, 그 교차로의 건물에 대해 지난 교대에서 이어받은 것(I2 의 carryState.places — 조직이 아는 기록). 이때 inc 는 -1.
 * 함수 안에서는 닫힌 사건의 truth.placeId 를 읽지만, 돌려주는 것은 종료 보고로 관제가 받은 사실뿐이다 (§3.4). I2 도 이 이름·인자를 쓴다
 */
export function knownBuildingAt(sim: Sim, node: number, placeKind?: PlaceKind | 'intersection'): { burnFrac: number; usable: boolean; inc: number } | null {
  if (placeKind === 'intersection') return null;      // 길 위의 사건에는 건물이 없다
  for (let k = sim.incidents.length - 1; k >= 0; k--) {
    const J = sim.incidents[k];
    if (J.phase !== 'closed' || !J.locationKnown || J.reportedNode !== node || J.truth.placeId < 0) continue;
    if (placeKind !== undefined && J.truth.placeKind !== placeKind) continue;
    const pm = sim.placeMarks.get(J.truth.placeId);
    return pm ? { burnFrac: pm.burnFrac, usable: pm.state !== 'burnt' && pm.state !== 'collapsed', inc: J.id } : { burnFrac: 0, usable: true, inc: J.id };
  }
  if (sim.carryState.places.size) {
    for (const pc of sim.carryState.places.values()) {
      const q = sim.city.places[pc.id];
      if (!q || q.nodeId !== node || (placeKind !== undefined && q.kind !== placeKind)) continue;
      return { burnFrac: pc.soot, usable: pc.state === 'marked', inc: -1 };
    }
  }
  return null;
}
