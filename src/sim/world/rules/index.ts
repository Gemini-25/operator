// 인과 규칙을 모으는 자리 (설계서 I1 §3.4·§3.7). engine.ts 가 이 파일을 import 한다 (sceneManager.ts 의 `import './scenes'` 와 같은 방식).
//
// **import 순서 = 규칙 등록 순서 = 결과다.** 같은 신호를 받는 규칙은 등록된 순서로 걸리고, 쿨다운·상한·연쇄 상한을 그 순서로 쓴다.
// 줄의 순서를 바꾸거나 사이에 끼워 넣으면 그 뒤 규칙의 결과가 바뀐다 — 새 규칙 파일은 끝에 더한다.
//
// 지금 있는 규칙 (§3.7 표의 차례 — 이미 상태 결합인 셋):
//   record    C6 divertRecord — 전환 배정의 실제 영향. 기록 규칙이라 등록하는 것이 없다(관제·현장이 그 함수를 직접 부른다) — 자리만 지킨다
//   hospital  C3 hospitalLoad — 응급실 체류 → 포화 알림 → 먼 병원 이송 · 이송 중 목적지 변경
//   structure C2 rubbleRoad   — 무너지거나 터진 건물의 잔해가 사건 뒤에도 길에 남는다
//             L3 shockSpread — (b3-8) 붕괴·폭발의 충격이 이웃 건물에 금·배관 손상을 남긴다 (rubbleRoad 다음에 등록 — 같은 파일 안의 차례)
//                              (b3-8c) 같은 폭발 신호로 L2 의 불티 항 — 이웃 건물의 heatSpread 칸에 충격 (hazard.hazardImpulse)
//             L3 pipeShut    — (b3-8c) 끊긴 배관이 낸 누출 사건이 '해결'로 닫히면 그 배관 손상을 거둔다 (shockSpread 다음)
//             L7 residualHeat — (b3-9) 닫힌 현장에 남은 열이 식는 동안의 재발화 위험을 그 건물의 rekindle 칸에 충격으로 (pipeShut 다음 — 법칙은 laws/ember.ts)
// 그 밖의 규칙("X 면 확률 p 로 사건 Y" 꼴)은 설계를 다시 쓰는 중이다 (docs/ROADMAP.md "진행 중").
import './record';
import './hospital';
import './structure';
import './risk';      // C10 suspectZone — (b3-9) 무장 용의자의 도주가 그 동네의 경계 단계를 올린다 (재범 자체는 field/hazards.ts 의 도주 블록이 조건으로 예약한다)
import './infra';     // C4 powerOut — (b3-10) 변전소·발전소 사고 · 끊긴 전선(붕괴·폭발 자리) · 지진 · 태풍의 정전 → 동네·국지 전력 → 꺼진 신호(혼잡)·병원 발전기 (규칙 넷: powerOut · powerOut.grid · powerOut.end · powerOut.tell)
