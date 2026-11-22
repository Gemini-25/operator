// 사건 종류 다양화 ① 일상 사건 (docs/specs/N8-incident-kinds.md §4)
// 줄의 순서: 시설(utility) · 동물(animal) · 치안(disturb) · 보호(welfare) · 구조(rescue) · 응급의 갈래(medical) · 비응급(장난·오인·민원).
// 짧은 사건(tag 'daily')은 평소 추첨에 들지 않고 새 난수 흐름 daily 로 따로 추첨한다 (§5.4 — incidents.tickIncidents). 새 시나리오는 card: false (카드 제목에 이름표를 쓰지 않는다 — §5.12).
// SCENARIOS 의 맨 끝에 펼쳐 넣는다 (같은 유형의 기존 시나리오 구간을 밀지 않는다 — 순서가 추첨 결과를 바꾼다). 새 줄은 이 배열의 끝에 §4 의 순서로 붙인다.
//
// 단계 3: 비응급 N1 장난 전화(fire·medical·water 의 prank) · N2 오인 신고(medical·water·armed·hazmat 의 false) — §4.8.
// nature 키('prank:<유형>'·'false:<유형>')는 아무도 말하지 않는 열쇠라 관제의 이름표가 붙지 않는다(natureLabel 이 걸리지 않는다) — 신고자가 말하는 키는 callSystem.natureFor 의
// prank·false 갈래(시나리오 갈래보다 먼저 돈다)가 유형별로 고른다. texts·lik 없음.
// 현장은 field/scenes/kinds.ts 가 등록한다(빈 현장 kindsKit.buildQuiet · 길 위의 잠든 사람 · 물에 뜬 물건 · 폭죽 잔해 · 음식물 냄새).
import type { Sim } from '../engine';
import type { Rng } from '../rng';
import type { Scenario } from '../scenarios';
import type { District, RoadEdge } from '../types';

/**
 * 짧은 사건 줄(tag 'daily')의 가중 합 — 다 만든 뒤의 값(시설 2.5 · 동물 2.85 · 치안 4.15 · 보호 2.5 · N1 0.5 · N2 0.9 · N3 0.6 — §4.0).
 * 상수로 둔다: 가족이 하나씩 들어오는 동안 차례의 나머지는 "걸린 줄 없음"으로 지나가 중간 단계의 짧은 사건 수가 그 가족의 몫만큼만 는다 (§5.4).
 * 가중을 고치면 이 상수도 고친다 (시험 6: 줄의 가중 합 ≤ DAILY_TOTAL, 단계 11 의 완료 조건: = DAILY_TOTAL)
 */
export const DAILY_TOTAL = 14.0;

/**
 * 길 위에서 일어나는 짧은 사건의 교차로: 출동 시설이 아니고, 다른 사건이 열려 있지 않으며(busy), 그 등급의 구간이 닿고 그 동네 성격인 곳.
 * 그런 곳이 없으면 동네 성격을 보지 않고, 그래도 없으면 null (기본 규칙 — 교차로 셋 이상이 닿는 곳). 난수는 고를 때 한 번
 */
export function streetNode(sim: Sim, rng: Rng, busy: Set<number>, cls: NonNullable<RoadEdge['cls']>[], dist: District[]): number | null {
  const c = sim.city;
  const fac = new Set<number>();
  for (const f of c.facilities) fac.add(f.nodeId);
  const pool: number[] = [], loose: number[] = [];
  for (const n of c.nodes) {
    if (busy.has(n.id) || fac.has(n.id)) continue;
    let ok = false;
    for (const e of n.edges) { const k = c.edges[e].cls; if (k !== undefined && cls.indexOf(k) >= 0) { ok = true; break; } }
    if (!ok) continue;
    loose.push(n.id);
    if (dist.indexOf(n.district) >= 0) pool.push(n.id);
  }
  const from = pool.length ? pool : loose;
  return from.length ? rng.pick(from) : null;
}

export const KINDS: Scenario[] = [
  // ── 비응급 N1 장난 전화 (§4.8 — 기존 armed/prank 는 평소 추첨 그대로) ──
  { type: 'fire', variant: 'prank', name: '장난 전화', share: 0.2, nature: 'prank:fire', vague: 'flames', severity: [1, 1], tag: 'daily', card: false },
  { type: 'medical', variant: 'prank', name: '장난 전화', share: 0.15, nature: 'prank:medical', vague: 'notbreathing', severity: [1, 1], tag: 'daily', card: false },
  { type: 'water', variant: 'prank', name: '장난 전화', share: 0.15, nature: 'prank:water', vague: 'drowning', severity: [1, 1], tag: 'daily', card: false },
  // ── 비응급 N2 오인 신고 (§4.8 — 기존 fire/false 는 평소 추첨 그대로) ──
  // 길에서 잠든 취객을 쓰러진 사람으로: 길 위에서 일으킨다 (장소가 없으면 pickPlace 가 응급의 장소(주택)를 골라 지도의 자리와 현장이 어긋난다)
  { type: 'medical', variant: 'false', name: '오인 신고', share: 0.3, nature: 'false:medical', vague: 'collapsed', severity: [1, 1], tag: 'daily', card: false,
    node: (sim, rng, busy) => streetNode(sim, rng, busy, ['street', 'arterial'], ['commercial', 'residential']) },
  { type: 'water', variant: 'false', name: '오인 신고', share: 0.2, nature: 'false:water', vague: 'drowning', severity: [1, 1], tag: 'daily', card: false },      // 물에 뜬 마네킹·쓰레기 봉투
  { type: 'armed', variant: 'false', name: '오인 신고', share: 0.25, nature: 'false:armed', vague: 'scream', severity: [1, 1], tag: 'daily', card: false },      // 폭죽·타이어 소리를 총소리로
  { type: 'hazmat', variant: 'false', name: '오인 신고', share: 0.15, nature: 'false:hazmat', vague: 'fumes', severity: [1, 1], tag: 'daily', card: false,      // 음식물·하수 냄새를 가스로
    places: { villa: 3, apartment: 3, restaurant: 2, houseS: 2 } },
];
