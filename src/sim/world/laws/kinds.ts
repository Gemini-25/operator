// N8 (단계 10) 일반 법칙 셋 — 일상 사건이 남긴 세계 상태가 다음 사건의 위험을 올린다 (docs/specs/N8-incident-kinds.md §5.6 · 틀은 world/hazard.ts §3.6a).
//
// 설계서의 조건부 연쇄(K2 수도관 → 싱크홀 · K5 벌집 → 또 쏘임 · K6 놓친 개 → 물림 · K7 찻길로 나간 동물 → 교통사고)를 "X 가 실패하면 확률 p 로 Y" 대신
// 상태의 적분으로 쓴다 — 상태를 놓는 것은 상태 규칙(world/rules/kinds.ts)이고, 이 파일의 법칙은 **그 상태를 누가 만들었는지 모른다**:
//   washout    물이 길 밑으로 스민 교차로는 꺼진다:  λ = WASH.A × max(0, 스민 초 − WASH.T0)      → utility/sinkhole (그 교차로)
//              (물이 처음 T0 초는 흙이 버틴다 — 일찍 잠근 관은 위험이 0 이다. 오래 흐를수록 커진다. 터진 수도관이든 다른 무엇이든 스민 물이 같으면 같다)
//   strayHarm  남은 위험 곁의 주민이 다친다:        λ = 평소 응급률(그 건물) × STRAY.RR[그 위험] × 남은 정도 × 가까움   → 그 위험의 사건(벌집 · 개 물림 · 멧돼지)
//   strayRoad  찻길에 나온 동물 곁 구간에서 차가 부딪친다: λ = STRAY.ROAD[그 동물] × (0.4 + 1.6 × 통행량) × 남은 정도   → traffic/std (그 구간)
// 대상마다 교대에 한 번(once — 흐름 hz:<법칙>:<대상>). 원인은 귀속에만 쓰인다: 몫 { ev: 그 상태를 만든 기록, inc: 그 사건, what, ref }.
// 상한: 법칙 CAP · 한 뿌리의 법칙 사건 2 · 한 교대 6 · 사슬 3(수도관 → 싱크홀 → 교통사고(L1)에서 멈춘다) — 틀(world/hazard.ts hazardRoom)이 한다.
//
// 이 파일은 등록만 한다(world/laws/index.ts 가 모은다). src/sim 의 다른 모듈은 이 파일을 import 하지 않는다 — 함께 쓰는 식은 world/kindsExpo.ts.

import type { Sim } from '../../engine';
import type { SpawnOpts } from '../../incidents';
import { roadFlow } from '../../traffic';
import type { HzWhat } from '../../types';
import { registerHazard } from '../hazard';
import type { HzPart } from '../hazard';
import { STRAY, presence, strayTargets } from '../kindsExpo';

/**
 * 법칙의 세기 (시험이 키워 쓴다. CAP 은 등록할 때 한 번 읽힌다):
 *  WASH.A   스민 물이 T0 를 1초 넘을 때마다 1초에 더해지는 위험 · WASH.T0 흙이 버티는 초 · CAP 이 법칙이 낸 싱크홀의 교대 상한
 *  STRAY_LAW.MIN 남은 정도가 이 아래인 풀린 위험은 보지 않는다 · CAP 두 법칙의 교대 상한
 */
export const WASH = { A: 3e-5, T0: 130, CAP: 2 };
export const STRAY_LAW = { MIN: 0.03, CAP: 2 };

/** 그 교차로에 지금 사건을 낼 수 있는가: 출동 시설 앞이 아니고, 열린 사건이 없고, 예약된 사건의 자리도 아니다 (world/laws/road.ts 와 같은 조건) */
function nodeFree(sim: Sim, node: number): boolean {
  for (const f of sim.city.facilities) if (f.nodeId === node) return false;
  for (const I of sim.incidents) if (I.phase !== 'closed' && I.truth.nodeId === node) return false;
  const ch = sim.gen.chain;
  for (let k = 0; k < ch.length; k++) if (ch[k].opts.nodeId === node) return false;
  return true;
}

const buf: HzPart[] = [];

registerHazard({
  id: 'washout', label: '물이 파낸 길', every: 1, once: true, cap: WASH.CAP,
  scan: (sim, put) => {
    const soak = sim.world.soak;
    for (const k in soak) {      // 정수 열쇠 — 오름차순 (교차로 id 순)
      const w = soak[k], x = w.v - WASH.T0;
      if (!(x > 0)) continue;
      buf.length = 0;
      buf.push({ rate: WASH.A * x, ev: w.ev, inc: w.inc, what: 'soak', ref: +k });
      put(+k, buf);
    }
  },
  spawn: (sim, target): SpawnOpts | null => (nodeFree(sim, target) ? { type: 'utility', variant: 'sinkhole', severity: 2, nodeId: target, note: '길 밑으로 스민 물에 도로가 꺼졌습니다' } : null),
});

/** 풀린 위험의 종류에서 나는 사건 (벌집 → 또 쏘임 · 개 → 물림 · 멧돼지 → 받힘) — 주된 몫의 기록으로 그 줄을 되찾는다 */
const HARM: Record<string, { variant: string; note: string }> = {
  hive: { variant: 'hive', note: '벌집이 남아 있던 곳에서 또 벌에 쏘인 사람이 나왔습니다' },
  dog: { variant: 'dogbite', note: '풀려 돌아다니던 개에 사람이 물렸습니다' },
  boar: { variant: 'boar', note: '마을을 돌아다니던 멧돼지에 사람이 다칠 뻔했습니다' },
};
const acc = new Map<number, HzPart[]>();

registerHazard({
  id: 'strayHarm', label: '풀린 위험에 다친 주민', every: 1, once: true, cap: STRAY_LAW.CAP,
  scan: (sim, put) => {
    acc.clear();
    for (const L of sim.world.loose) {
      const rr = STRAY.RR[L.kind] ?? 0, pres = presence(sim, L);
      if (!(rr > 0) || pres < STRAY_LAW.MIN) continue;
      const what: HzWhat = L.what === 'hive' ? 'hive' : 'stray';
      for (const t of strayTargets(sim, L)) {
        let parts = acc.get(t.id);
        if (!parts) acc.set(t.id, (parts = []));
        parts.push({ rate: t.base * rr * pres * t.c, ev: L.ev, inc: L.inc, what, ref: L.place });
      }
    }
    for (const [target, parts] of acc) put(target, parts);
  },
  spawn: (sim, target, _cell, main): SpawnOpts | null => {
    let kind = '';
    for (const L of sim.world.loose) if (L.ev === main.ev && L.inc === main.inc) { kind = L.kind; break; }
    const h = HARM[kind];
    return h ? { type: 'animal', variant: h.variant, severity: 1, placeId: target, tag: 'daily', note: h.note } : null;
  },
});

const accR = new Map<number, HzPart[]>();

registerHazard({
  id: 'strayRoad', label: '길에 나온 동물', every: 1, once: true, cap: STRAY_LAW.CAP,
  scan: (sim, put) => {
    accR.clear();
    const flow = roadFlow(sim), city = sim.city;
    for (const L of sim.world.loose) {
      const a = STRAY.ROAD[L.kind] ?? 0, pres = presence(sim, L);
      if (!(a > 0) || pres < STRAY_LAW.MIN || L.node < 0) continue;
      for (const eid of city.nodes[L.node].edges) {
        if (city.edges[eid].closed) continue;
        let parts = accR.get(eid);
        if (!parts) accR.set(eid, (parts = []));
        parts.push({ rate: a * (0.4 + 1.6 * (flow[eid] ?? 0)) * pres, ev: L.ev, inc: L.inc, what: 'stray', ref: L.node });
      }
    }
    for (const [target, parts] of accR) put(target, parts);
  },
  spawn: (sim, target): SpawnOpts | null => {
    const e = sim.city.edges[target];
    const okA = nodeFree(sim, e.a), okB = nodeFree(sim, e.b);
    if (!okA && !okB) return null;
    return { type: 'traffic', variant: 'std', severity: 1, nodeId: okA ? e.a : e.b, edgeId: target, note: '도로에 나온 동물을 피하려다 차가 부딪쳤습니다' };
  },
});
