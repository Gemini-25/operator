// 사건 종류 다양화 ① 일상 사건 (docs/specs/N8-incident-kinds.md §4)
// 줄의 순서: 시설(utility) · 동물(animal) · 치안(disturb) · 보호(welfare) · 구조(rescue) · 응급의 갈래(medical) · 비응급(장난·오인·민원).
// 짧은 사건(tag 'daily')은 평소 추첨에 들지 않고 새 난수 흐름 daily 로 따로 추첨한다 (§5.4 — 단계 3). 새 시나리오는 card: false (카드 제목에 이름표를 쓰지 않는다 — §5.12).
// SCENARIOS 의 맨 끝에 펼쳐 넣는다 (같은 유형의 기존 시나리오 구간을 밀지 않는다 — 순서가 추첨 결과를 바꾼다). 새 줄은 이 배열의 끝에 §4 의 순서로 붙인다.
//
// 단계 2a (틀): 아직 줄이 없다. 첫 줄은 단계 3(비응급 N1·N2)·4a(utility/wire)가 넣는다. 짧은 사건의 가중 합 DAILY_TOTAL 도 단계 3 이 이 파일에 둔다.
import type { Scenario } from '../scenarios';

export const KINDS: Scenario[] = [];
