// 대응 교본 — N8 일상 사건의 줄 N01~N17 (docs/specs/N8-incident-kinds.md §5.14 의 교본 표)
// 줄은 DocCtx 만 읽는다 (믿음·자기 몸·자기 장비 — tests/doctrine.test.ts 시험 1, tests/kinds.test.ts 시험 4). 이 파일은 ./registry 와 타입·util 만 import 한다.
// 등록 순서가 같은 순위의 줄끼리 이기는 순서다 — N8 의 줄은 R3 의 다섯 파일(common → police → fire → ems → special) 다음, 맨 끝에 둔다.
//
// 단계 2a (틀): 아직 줄이 없고 doctrine/index.ts 에서 불리지도 않는다. 첫 줄을 넣는 단계(4a~9)가 index.ts 의 import './special' 다음 줄에
// import './kinds' 를 더하고, tests/doctrine.test.ts 의 등록 순서 시험(['common', 'police', 'fire', 'ems', 'special'])에 'kinds' 를 함께 더한다.

export {};
