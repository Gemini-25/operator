// 시나리오 — 같은 유형 안에서 갈리는 사건의 모습.
// 유형(type)은 관제와 현장 AI의 큰 규칙을 정하고, 시나리오(variant)는 신고 내용, 일어나는 곳,
// 현장의 생김새, 필요한 자원을 바꾼다.
//
// 새 시나리오를 넣는 법 (다른 파일의 표를 고칠 필요가 없다):
//   1) scenarios/<묶음>.ts 의 배열에 한 줄을 더한다. 신고 문구(texts)·가능도(lik)·필요 자원(needs)·한계 시간(limit)을 함께 적는다.
//   2) field/scenes/<묶음>.ts 에서 registerScene(type, variant, 만드는 함수) 로 현장의 모습을 등록한다.
//   3) 소품에 새 모습이 필요하면 view/scene/skins/<묶음>.ts 에 그림을 등록한다.

import type { Sim } from './engine';
import type { Rng } from './rng';
import { CHASE } from './scenarios/chase';
import { CRIME } from './scenarios/crime';
import { DISASTER } from './scenarios/disaster';
import { KINDS } from './scenarios/kinds';
import { KINDS2 } from './scenarios/kinds2';
import { LIFE } from './scenarios/life';
import { MAJOR } from './scenarios/major';
import type { Incident, IncidentType, Needs, PlaceKind } from './types';
import type { LikMap } from './incidentTypes';
import { TYPE_NAME } from './util';

/** 필요 자원을 고칠 때 볼 수 있는 것: 관제가 아는 위험도와 신고 내용뿐이다 (진실을 보지 않는다) */
export interface ScenarioCtx { sev: number; hurt: boolean; trapped: boolean; nat: string[]
  noise?: boolean }      // noise: (N8 단계 10) "지금도 소리 지르고 난리" 진술(hazard 'noise') — 단순 민원의 순찰 한 팀

export interface Scenario {
  type: IncidentType; variant: string; name: string;
  share: number;                 // 그 유형의 사건 가운데 이 시나리오가 차지하는 몫 (gate 가 거짓이면 0 으로 본다).
                                 // tag 가 major 면 대형 사고끼리의 비중이고, disaster 면 쓰지 않는다 (둘 다 평소 추첨에는 들어가지 않는다)
  nature: string; vague: string; // 제대로 아는 신고자가 말하는 내용 / 잘 모르는 신고자가 말하는 내용 (신고 내용 키)
  severity: [number, number];
  places?: Partial<Record<PlaceKind, number>>;      // 일어나는 곳(건물 종류의 몫). 없으면 유형의 표(cityPlan.INCIDENT_PLACES)를 쓴다
  texts?: string[];              // nature 키의 신고 문구. 적어 두면 callSystem 의 표에 들어간다
  lik?: LikMap;                  // 그 신고 내용이 각 유형일 가능도 — 유형 이름으로 적는다({ fire: 0.9, … }). 적지 않은 유형은 incidentTypes.LIK_FLOOR
  label?: string;                // 관제가 사건에 붙이는 이름 (없으면 name)
  needs?: (n: Needs, c: ScenarioCtx) => void;      // 신고 내용이 이 시나리오를 가리킬 때 필요 자원을 고친다
  limit?: number;                // 현장 한계 시간에 더하는 초
  delay?: [number, number];      // 발생에서 첫 신고까지의 초 (없으면 유형의 값)
  onCreate?: (sim: Sim, I: Incident) => void;      // 사건과 현장이 만들어진 직후 (도로 통제, 추격 시작 등)
  onClose?: (sim: Sim, I: Incident, reason: string) => void;      // 판정이 끝난 직후 (도로 복구, 이어지는 사건 예약 등)
  node?: (sim: Sim, rng: Rng, busy: Set<number>) => number | null;      // 건물이 아니라 길 위에서 일어난다: 교차로를 고른다 (null 이면 기본 규칙)
  gate?: (sim: Sim) => boolean;  // 지금 일어날 수 있는가 (대형 사고의 확률, 재난 중에만 등)
  tag?: string;                  // 묶음: life · chase · crime · major · disaster (Incident.tag 로 옮겨 적힌다)
  card?: false;                  // (N8 — 사용자 결정 §12.5-7) false 면 관제의 이름표(label ?? name)를 사건 카드의 제목에 쓰지 않고 유형 이름을 쓴다 (NO_CARD).
                                 // 이름표 자체는 그대로 붙어 가점·교본·airFit 이 쓴다. 카드 제목 식(ui/panels.tsx 사건 카드·ui/App.tsx 사건 줄)을 바꾸는 것은 단계 4a
}

export const SCENARIOS: Scenario[] = [...LIFE, ...CHASE, ...CRIME, ...MAJOR, ...DISASTER, ...KINDS, ...KINDS2];      // KINDS (N8) 는 맨 끝 — 앞 구간의 순서를 밀지 않는다. KINDS2 (N9) 는 그 다음
/** (N8) 카드 제목에 쓰지 않는 이름표 — card: false 인 시나리오의 label ?? name (natureLabel 이 붙이는 글자와 같다). 단계 2a 에는 비어 있다 */
export const NO_CARD: ReadonlySet<string> = new Set(SCENARIOS.filter((q) => q.card === false).map((q) => q.label ?? q.name));

/** 예전부터 있던 변형의 이름 */
const VARIANT_NAME: Record<string, string> = {
  'traffic/bus': '버스 추돌', 'armed/robbery': '강도', 'armed/dispute': '난동', 'armed/shooter': '총격', 'armed/hostage': '인질극', 'armed/prank': '장난 전화',
  'fire/false': '화재 오인 신고', 'search/wander': '실종', 'search/hiker': '조난', 'medical/arrest': '심정지', 'medical/trauma': '낙상·외상', 'medical/faint': '실신',
  'medical/smoke': '연기 흡입',      // (I1-b b3-11 L4) 연기를 마신 주민 — 법칙(world/laws/smoke.ts)이 정해서만 일으킨다 (평소 추첨에 들지 않는다 — 시나리오 표에 넣지 않는다)
};

// 현장마다 매 틱 묻는다(한계 시간). 표는 모듈을 읽을 때 정해지므로 찾은 답을 기억해 둔다 (표의 길이가 바뀌면 다시 찾는다)
const scenCache = new Map<string, Map<string, Scenario | undefined>>();
let scenCacheLen = -1;
export function scenarioOf(type: IncidentType, variant: string): Scenario | undefined {
  if (scenCacheLen !== SCENARIOS.length) { scenCache.clear(); scenCacheLen = SCENARIOS.length; }
  let m = scenCache.get(type);
  if (!m) { m = new Map(); scenCache.set(type, m); }
  if (m.has(variant)) return m.get(variant);
  const sc = SCENARIOS.find((q) => q.type === type && q.variant === variant);
  m.set(variant, sc);
  return sc;
}
/** 사건의 실제 모습을 가리키는 이름 (관찰자 정보와 보고서에 쓴다) */
export function scenarioName(type: IncidentType, variant: string): string { return scenarioOf(type, variant)?.name ?? VARIANT_NAME[`${type}/${variant}`] ?? TYPE_NAME[type]; }

/** 예전부터 있던 신고 내용에 붙이는 이름 */
const LEGACY_LABEL: Record<string, [IncidentType, string]> = { robbery: ['armed', '강도'], hostage: ['armed', '인질극'], gunshots: ['armed', '총격'], notbreathing: ['medical', '심정지'] };
/** 신고 내용으로 관제가 사건에 붙이는 이름. 그 내용이 가리키는 유형과 관제의 판단이 같을 때만 쓴다. */
export function natureLabel(nature: string, type: IncidentType): string | undefined {
  const sc = SCENARIOS.find((q) => q.nature === nature && q.type === type);
  if (sc) return sc.label ?? sc.name;
  const l = LEGACY_LABEL[nature];
  return l && l[0] === type ? l[1] : undefined;
}
