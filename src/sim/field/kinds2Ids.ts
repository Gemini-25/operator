// N9 의 새 사실(haz·evid)이 쓰는 id 범위 (docs/specs/N9-major-kinds.md §5.16).
// 사실의 열쇠는 type:id (beliefs.mkFact) 라 같은 종류의 다른 사실이 같은 id 를 쓰면 서로 덮어쓴다 — 소품 하나에 두 가지 haz 가 걸리거나(탱크로리의 새는 곳 =
// N8 시설물 사실 + 독성 공기 + 실은 것 + 기름) 구역 번호를 id 로 쓰면(군중 구역 0..4 = 소품 0..4) 겹친다. 그래서 범위를 나눈다.
// 잎 모듈이다(아무것도 import 하지 않는다): 판단 쪽(orders/kinds2.ts·doctrine/kinds2.ts)과 세계 쪽(rules/kinds2.ts·agents.perceive)이 함께 읽는다.
// 현장 생성 도구(kinds2Kit.ts)에 두지 않는 것은 판단 파일이 생성 도구를 가져오지 않게 하려는 것이다.
//
//   0 ~ 1999     소품 하나에 걸린 사실 — 지금 그대로 (소품 id · N8 의 소품 id + 1000 · 1000 + 구조 대상 id). N9 의 letter·machine·sunk(차량·선체 소품)·evid note(메모 소품)도 소품 id
//   2000 + 구역  군중 구역 haz crowd
//   3001 ~ 3013  현장에 하나뿐인 상태 (아래 이름)
//   4000 + 소품  측정한 독성 공기 haz air (원천 소품)        4500 + 소품  실은 것 haz cargo (차량 소품)        4800 + 소품  바닥의 기름 haz spill (원천 소품)
//   5000 + rid   evid dizzy (어지러움을 알린 대원)          5500 + 구역  오염 구역 haz contam
// 범위가 겹치지 않으려면: 현장의 구역 < 1000 · 소품 < 300 · 대원 rid < 500 (지금 현장은 구역 수십·소품 백여 개, 명부는 이백 명 남짓이다 — 시험 6 이 강제 교대에서 본다).
// 단계 1 (틀): 상수만. 이 값을 쓰는 사실은 그것을 처음 쓰는 단계(4 군중 · 5 열차·기울기 · 6 독성 공기·오염 · 7 반장 면담·차단기 · 8 드론·메모 · 9 수위·기름·인계·떨어진 자리)가 만든다.

export const FACT_ID = {
  CROWD: 2000,         // + 현장 구역 id — 군중 구역 haz crowd (lvl 0~3)
  TRAIN: 3001,         // haz train — 지하철의 운행 중지·단전 (관제 무전)
  FLOOD: 3002,         // haz flood — 지하차도 수위
  TILT: 3003,          // haz tilt — 여객선 기울기 (선체 소품의 각도 — 생김새)
  OIL: 3004,           // haz oil — 기름 띠
  LANDING: 3005,       // evid landing — 비상착륙 예정 시각 (관제탑 무전)
  LAB: 3006,           // evid lab — 의심 우편물의 검사 결과 (관제 무전)
  EVENT: 3007,         // evid event — 행사 끝 시각 (운영 요원 면담)
  DRONE: 3008,         // haz drone — 상공의 드론
  HEADCOUNT: 3009,     // evid headcount — 공장 안에 남은 사람 수 (반장 면담)
  SWITCH: 3010,        // evid switch — 기계의 차단기 자리 (동료 면담)
  AIR_GUESS: 3011,     // haz air (gas '?') — 측정기 없이 지휘관이 스스로 두는 추정 독성 공기 (교본 Y08·Y09)
  HANDOVER: 3012,      // evid handover — 해상 수색 인계 (강제 보고)
  FALLPT: 3013,        // evid fallpt — 산악 조난자가 떨어진 자리 (일행 면담)
  AIR: 4000,           // + 원천 소품 id — 측정한 독성 공기 haz air
  CARGO: 4500,         // + 차량 소품 id — 탱크로리가 실은 것 haz cargo
  SPILL: 4800,         // + 원천 소품 id — 바닥의 기름 haz spill
  DIZZY: 5000,         // + 대원 rid — evid dizzy
  CONTAM: 5500,        // + 현장 구역 id — 오염 구역 haz contam
} as const;
