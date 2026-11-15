// 대응 교본 (docs/specs/R3-doctrine.md §6.1) 의 지휘 규칙. 지휘관의 믿음과 작업판·조직 정보만 읽는다 — 진실을 읽지 않는다
// (tests/ext.test.ts 와 tests/doctrine.test.ts 시험 1 이 이 파일의 주석이 아닌 줄을 글자로 검사한다. 주석은 줄 주석으로만 쓰고, 어떤 주석에도 그 시험의 금지어를 쓰지 않는다).
// 남의 몸은 대원의 자기 신고('crew' 사실)로만 안다.
//
// 단계 0 (틀): 아무것도 등록하지 않는다. 지휘 줄(CP·CF·CE·CS)은 그 분야의 단계가 registerOrders 로 채우고, 이름표는 doctrine/registry.ts 의 CMD_ROWS 에 둔다.

export {};
