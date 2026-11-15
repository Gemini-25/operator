// 사건 종류 다양화 ② 큰 사건·새 장소 (docs/specs/N9-major-kinds.md §4)
// 줄의 순서(§4): 군중 3(crowd) · 교통 시설 4 · 독성 공기와 화생방 4 · 산업과 재산 범죄 5 · 테러와 중대 위협 4 · 날씨·해상·산악 5.
// 무거운 사건(H)은 대형 사고 추첨(tag 'major' — 교대마다 많아야 한 번)에, 중간 크기(M)는 기존 유형 안의 낮은 평소 몫(tag 'kinds2')에 넣는다 —
// 무거운 사건의 수를 늘리지 않는다(사용자 결정 14). 모든 줄에 label·severity·card: false (카드 제목은 유형 이름 — 결정 13, N8 §5.12).
// SCENARIOS 의 맨 끝(N8 의 KINDS 다음)에 펼쳐 넣는다 — 앞 구간의 순서를 밀지 않는다(순서가 추첨 결과를 바꾼다). 새 줄은 이 배열의 끝에 §4 의 순서로 붙인다.
//
// 단계 1 (틀): 아직 줄이 없다. 첫 줄은 단계 4(crowd/crush·protest·event)가 넣는다.
import type { Scenario } from '../scenarios';

export const KINDS2: Scenario[] = [];
