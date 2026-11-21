// 일반 법칙(초과 위험 과정)의 모음 — engine.ts 가 `import './world/rules'` 다음 줄에 이 파일을 import 한다 (sceneManager.ts 의 `import './scenes'` 처럼).
// 법칙 파일마다 registerHazard(world/hazard.ts)로 끼워 넣는다. **import 순서 = 법칙 등록 순서 = 훑는 순서 = 결과**다 — 줄을 옮기면 결과가 바뀐다
// (상한이 걸릴 때 어느 법칙이 먼저 자리를 쓰는가). 새 법칙은 설계서 I1 §3.7 표의 차례로 끝에 더한다:
//   road(L1 roadCrash) → heat(L2 heatSpread) → shock(L3 structFail·pipeLeak) → ember(L7 rekindle) → power(L5 liftStall) → smoke(L4 smokeIll)
//
// 지키는 것 (§3.4 — tests/hazard.test.ts 가 글자로 본다):
//  · 법칙 파일에는 registerHazard 만 둔다. 다른 모듈(disaster·sceneManager·catastrophe …)이 부르는 함수는 등록이 없는 파일(world/hazard.ts·state.ts·expo.ts)에 둔다 —
//    법칙 파일을 다른 모듈이 import 하면 그 파일의 등록이 이 모음의 차례보다 먼저 실행된다.
//  · 법칙은 원인을 모른다: scan 은 상태의 값만 읽는다. 어떤 사건·변형·재난이 그 상태를 만들었는지를 식에 쓰지 않는다(.chance( · spawnConsequence · truth.variant · sim.disaster · .rules 가 없다).
//
import './road';      // L1 roadCrash — 차가 몰린 길에서는 사고가 잦다 (b3-6)
import './heat';      // L2 heatSpread — 오래 크게 타는 불 곁의 건물은 불이 붙는다 (b3-7)
