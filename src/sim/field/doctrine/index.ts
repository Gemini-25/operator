// 대응 교본의 줄 파일을 이 순서로 불러 등록시킨다 (field/scenes/index.ts 가 이 파일을 import 한다 — 첫 현장 전에 등록이 끝난다).
// 등록 순서 = 같은 순위의 줄끼리 이기는 순서 (docs/specs/R3-doctrine.md §2.5·§2.6). 순서를 바꾸지 않는다.
import './common';
import './police';
import './fire';
import './ems';
import './special';
