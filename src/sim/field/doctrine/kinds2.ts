// 대응 교본 — N9 큰 사건·새 장소의 줄 Y01~Y20 (docs/specs/N9-major-kinds.md §5.12 의 교본 표)
// 줄은 DocCtx 만 읽는다 (믿음·자기 몸·자기 장비·생김새 c.s.flowSpots·c.s.windDir·c.s.rules — tests/doctrine.test.ts 시험 1, tests/kinds2.test.ts 시험 4).
// 이 파일은 ./registry 와 타입·util 만 import 한다. 등록 순서가 같은 순위의 줄끼리 이기는 순서다 — N9 의 줄은 R3 의 다섯 파일과 N8 의 kinds 다음, 맨 끝에 둔다.
//
// 단계 1 (틀): 아직 줄이 없고 doctrine/index.ts 에서 불리지도 않는다(N8 의 doctrine/kinds.ts 와 같은 까닭 — R3 의 등록 순서 시험이 파일 다섯을 글자로 본다).
// 첫 줄을 넣는 단계(4~9)가 index.ts 의 N8 줄(import './kinds') 다음에 import './kinds2' 를 더하고, tests/doctrine.test.ts 의 등록 순서 시험에 'kinds2' 를 함께 더한다.
// R3 가 늦으면 이 줄들의 판단은 같은 내용의 지휘 규칙(field/orders/kinds2.ts)으로 한다(설계서 §5.12 끝).

export {};
