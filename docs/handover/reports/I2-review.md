# I2 독립 검토 — 작업자의 보고

워크플로 `docs/specs/workflows/package-run.js` 의 작업자(`review:persist`) 보고를 그대로 옮겼다. 끝 커밋 `d583159`(브랜치 `wf/persist-review`), 관문 **통과하지 못함**(`checkPassed: false`).

정본은 그 묶음 설계서 끝의 "구현 메모"다. 보고 속의 scratchpad 경로(`/tmp/…/scratchpad/wf-*/`)는 그 세션의 컨테이너에만 있다 — 기준 수치는 구현 메모의 방법으로 다시 잰다.


## 끝낸 것

- 고친 것 1 (커밋 730d9ea, src/sim/persist.ts shortArrivalLine): 사건 분석 문장 '첫 출동 부대(X)는 지난 교대의 결장으로 n명만 출동했습니다'가 예비 인력으로 정원을 다 채운 부대에도 나왔다. 진단 대본(scratchpad/wf-persist/review/shortline.ts, 어려움 8계보×5교대): 결원 도착 기록 64건 가운데 26건이 정원까지 찼고, 분석 문장 9개 가운데 6개가 사실과 달랐다. 이제는 fieldCrew 가운데 'off' 가 아닌 사람 수 n 과 예비 인력이 아닌 자리 수 seats 를 비교해 n ≥ seats 이면 null 을 돌려준다. 시험(tests/persistence.test.ts 새 describe '(검토) 사건 분석의 결원 출동 문장은 실제로 모자라게 나간 부대에만'): SA 는 순찰1 결장 1명을 예비 인력이 채움 → null(고치기 전에는 실패), SB 는 진압1 결장 2명·예비 1명 → '…3명만 출동했습니다.'. 단계 7 명부 시험도 같은 기준으로 맞췄다.
- 고친 것 2 (커밋 730d9ea, persist.ts makeRelief): 예비 인력 대원 객체와 장비 항목이 createRoster·createAidUnit 과 달리 primeNums(RESPONDER_SHAPE·KIT_SHAPE)를 거치지 않았다(R3b 의 숫자 칸 표현 규칙. 속도만의 문제). shape.ts 에서 import 해 같은 방식으로 맞췄다. 결과 불변: 고치기 전후 chainhash.ts(섞인 사슬과 어려움 5×5)의 report.hash 와 분석 문장을 뺀 보고서 JSON 지문이 같았다.
- 구현 메모 (커밋 d583159): docs/specs/I2-persistence.md 끝에 '### 독립 검토 · wf/persist-review' 절을 붙였다. 고친 것 둘, 직접 확인한 것, 고치지 않은 것을 적었다.
- 확인 (가) 이어받지 않은 교대: 19a7e68 과 HEAD 의 해시 목록 158줄이 같고, 넓힌 목록 147줄(재난·강제·부대 규모 1·5·장비 1·5·극한)도 같다. 한 프로세스에서 이어받은 교대와 이어받지 않은 교대를 섞어 돌려도(mixed.ts) 이어받지 않은 교대의 해시는 그대로였다. 도시 지도도 바뀌지 않았다.
- 확인 (나)(다) chain.ts 24 8 --check 통과(323초). 구현자 수치와 같다: Δ −3.3pp(SE 2.5), 짝 차이 −1.0pp(SE 0.7), 지진 회복 5.92/0.17/4.17 ≤ 4.21, 교착 후보 이어받은 쪽 1·대조군 1. sweep --carry 와 chain.ts --dump 도 '검증 통과'. 고친 뒤에도 사슬 해시가 같았다.
- 확인 경계: 191교대 강행(재난 다섯 종류×12, 대형 사고, 부대 규모 1·5, 장비 1·5, 지원 부대, 극한, hardCap) — 예외 0·안 닫힌 사건 0·rtFail 0·닿지 못함 0. 상한(CLOSED_CAP·RUIN_REPAIR)을 지켰다.
- 확인 균형: 극한 12×8 짝 차이 −4.4pp(SE 1.2), Δ −7.6pp(한계 ±8.8 안). 부대 규모 1 12×6 짝 차이 −2.2pp, Δ −0.6pp.
- 확인 (라) 정보 격리: carryState·placeUse 를 dispatch/·commander·brain 이 진실처럼 읽는 곳이 없다(소스를 읽어 대조). (마) 쓸 수 없는 건물은 placeUsable 이 여섯 자리와 재범·법 집행 사건에서 막는다. (바) 화면(carryLayer·panels·App·Mark·runner 의 ar.org.v1/ar.input.v1)은 읽기만 하고, 저장소를 읽거나 쓰다 실패해도 견딘다(try/catch, settle).
- tsc --noEmit 통과: 730d9ea 에서 npm run check 의 tsc 단계를 지나 vitest 단계에 들어갔다.

## 하지 못한 것

- npm run check 전체 통과를 확인하지 못했다. 730d9ea(이후 src 는 바뀌지 않았고 d583159 는 문서만)에서 19:01 에 시작한 관문은 tsc 를 통과했다. 그러나 보고해야 하는 시점(19:10)에 vitest 는 여전히 돌고 있었고 요약 줄이 아직 출력되지 않았다. 출력은 /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-persist/review/check.log 와 check.time('exit=' 줄)에 쌓인다.
- npm run ui-check 는 돌리지 않았다. 이번에 고친 두 곳은 시뮬레이션 쪽(분석 문장과 객체 표현)뿐이고 화면 코드는 고치지 않았다.
- 그을음(--soot) 다시 재기와 극한 난이도 균형 손잡이 조정은 하지 않았다. 수치가 설계서 기준 안이라 손대지 않았다.

## 설계서와 다르게 한 곳

- roadsNext 는 내부 이름으로 두었다. N8/N9 가 제자리에서 고칠 것으로 보고 이름을 바꾸지 않았다.
- chain.ts --check 의 기준 6(결장은 교대 5)·7(교착 후보는 대조군과 비교, STALL_SLACK 2)은 구현자가 정한 형태 그대로 받아들였다. 설계서 §6 의 뜻과 맞는다고 판단했다.
- 시험 3① 은 slice 로 CLOSED_CAP 까지만 본다. 구현 그대로 두었다.

## 설계서 밖의 공용 파일을 고친 곳

- (없음)

## 결과

해시 목록: 이어받지 않은 교대 158줄이 19a7e68 과 HEAD 사이에 같고(차이 0), 넓힌 목록 147줄도 같다. 섞어 돌리기도 같다. chain.ts 24 8 --check 통과(323초): Δ −3.3pp(SE 2.5), 짝 차이 −1.0pp(SE 0.7), 지진 회복 5.92/0.17/4.17 ≤ 4.21, 교착 후보 이어받은 쪽 1/대조군 1. 경계 191교대: 예외 0, 안 닫힌 사건 0, rtFail 0, 닿지 못함 0. 극한 12×8: 짝 차이 −4.4pp(SE 1.2), Δ −7.6pp(한계 ±8.8 안), 무너짐 8.5~9.3(상한에 가깝다). 부대 규모 1 12×6: 짝 차이 −2.2pp, Δ −0.6pp. 결원 출동 문장 진단(어려움 8×5): 결원 도착 64건 가운데 26건이 정원까지 찼고, 고치기 전 문장 9개 가운데 6개가 사실과 달랐다. 고친 뒤 그런 문장 0. 고치기 전후 사슬 해시와 보고서 JSON 지문(분석 문장 제외)이 같다. tests/persistence.test.ts 는 87개(새 시험 2: 고치기 전 SA 실패, 고친 뒤 통과). tsc --noEmit 은 통과했다. npm run check 는 vitest 단계에서 결과를 기다리는 중이었다.

## 알려진 문제 · 다음 작업자가 알아야 할 것

- 관문 결과 미확인: npm run check 는 vitest 단계를 도는 중이었다. 다음 작업자는 /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-persist/review/check.log 의 Test Files/Tests 줄과 sweep '검증 통과'를 보거나 관문을 다시 돌려야 한다. 시간 초과로만 깨지는 시험(sim.test '다수 사상자…'·'프리셋이 어려워질수록', crews ④·⑨)이 있으면 따로 다시 돌린다.
- 고치지 않음 — 나무 사건: incidents.createIncident 의 법 집행이 아닌 갈래가 e.closed 를 확인하지 않는다. 이어받은 'repair' 통제를 덮어써 길이 일찍 열릴 수 있다. 드물고, 사건 생성 쪽(공유 파일)을 고쳐야 해서 남겼다.
- 고치지 않음 — 보고서의 '결원 부대가 나간 사건' 집계는 예비 인력으로 다 찬 부대도 센다. 설계서가 그렇게 정했으므로 분석 문장만 고쳤다.
- 극한 계보에서는 무너짐 누적이 8.5~9.3 으로 CLOSED_CAP 에 가깝다. 기준 안이지만 균형을 다시 잴 때 볼 곳이다.
- 단계 5/8 의 알려진 문제가 남아 있다: 미리 탄 칸이 X6 구획의 탄 비율과 regionBurning 에 섞이는 것, 작은 화재의 손실 증가, world.expo 를 이어받지 않는 것, 섬광탄 창고의 상한.
