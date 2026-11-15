// 부상과 사망 (H1) — 지휘 규칙. 지휘관의 믿음(a.beliefs)만 읽는다: 누가 얼마나 다쳤는지는 보고('mate'·'hos'·'cas' 사실)로만 안다.
// 다른 사람의 체력·출혈·부상 기록·사망·후송 상태(진실)를 읽지 않고, 그것을 읽는 함수(injury.needsHospital)도 부르지 않는다 —
// 명부에서는 소속·분야·이름만 본다 (설계서 H1 §6.1, tests/ext.test.ts 와 tests/injuries.test.ts 가 글자로 잡는다).
// 단계 1(지금): 등록만 해 둔다 — 아무것도 하지 않는다. 뒤 단계가 여기에 채운다:
//   단계 4b 다친 대원의 처치·후송(treatMate), 자기 부대 이송 지시(20초 규칙), 다수 사상자 다시 세기 (§3.4·§6.3)
//   단계 5  쓰러진·다친 용의자의 처치(treatSuspect) (§4.3)

import { registerOrders } from '../sceneRegistry';

registerOrders(() => { /* 단계 4b 부터 */ });
