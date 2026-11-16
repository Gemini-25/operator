// 대응 교본 — 특수 표 (docs/specs/R3-doctrine.md §3 · 등록 칸은 §3.6 표 그대로, 이 파일 안의 등록 순서도 그 표의 순서). 특공·폭발물·화학·소방 헬기·구조정·사다리차 — S 줄 (5단계)
// 줄은 DocCtx 만 읽는다 (믿음·자기 몸·자기 장비 — tests/doctrine.test.ts 시험 1). 이 파일은 ./registry 와 타입·util 만 import 한다.
// 새 줄은 이 파일의 끝에 registerDoctrine({ id, dept, who, hook, works/gate/methods, kits/noKits, when, effect, rank, why, note, report }) 로 붙인다 (등록 순서가 결과를 바꾼다).
//
// 단계 0 (틀): 아직 개인 줄이 없다 (S 줄은 5단계).
// 단계 2: 관제 줄 D2(폭발물 처리반을 인질극 진입조로 보내지 않는다 — 코드는 dispatch/doctrine.ts)의 이름표만 둔다 (§6.2 표의 분야가 특수다).

import { CMD_ROWS } from './registry';

CMD_ROWS.push(
  { id: 'D2', dept: 'special', hook: 'dispatch', name: '폭발물 처리반을 경찰 수요에 아낀다', short: '처리반 아낌', why: 'protocol' },
);
