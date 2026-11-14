# AUTONOMOUS RESPONSE — 작업 안내서

AI 긴급구조 조직(신고 접수 · 분석 · 배정 · 현장 지휘 · 대원)이 스스로 일하는 것을 **관찰만 하는** 2D 시뮬레이션.
TypeScript + React + Vite, 그림은 Canvas 2D. 서버·외부 API·LLM 호출 없음. 화면 글자와 주석은 한국어.

**이어받은 세션은 이 순서로 시작한다.**

1. 이 파일을 끝까지 읽는다.
2. `docs/ROADMAP.md` 의 "지금 상태"와 "진행 중"을 보고 다음 작업 묶음을 고른다.
3. `npm install` 후 `npm run check` 가 통과하는지 확인한다(통과하지 않으면 그것부터 고친다).
4. 작업 → `npm run check` → 커밋 → 푸시. 작업 묶음을 끝낼 때마다 `docs/ROADMAP.md` 를 갱신한다.

사용자용 설명(조작법, 기능 목록, 테스트 결과)은 `README.md` 에 있다.

## 명령

| 명령 | 용도 |
|---|---|
| `npm run dev` | 개발 서버 (`http://localhost:5173`, `?seed=S7&diff=hard` 로 조건 고정) |
| `npm run check` | **커밋 전 관문**: 타입 검사 + 테스트 + 시드 40개 헤드리스 검증 |
| `npm test` | Vitest (재현성, 교대 완주, 상태 변화, 정보 격리) |
| `npm run sweep -- 100` | 시드 100개 결과 분포. `--diff hard`, `--diff 4,4,4,2,3,3`(빈도·심각도·용의자·장비·신고·부대), `-v`, `--json`, `--check` |
| `npm run sweep -- 1 --log S7` | 한 교대의 전체 이벤트 기록과 종료 보고서 (동작 확인에 가장 유용) |
| `npm run build` | 타입 검사 + 정적 빌드 |
| `node scripts/screenshot.cjs S7 화재` | (선택, Playwright 필요) 해당 유형 현장이 열렸을 때 화면 캡처 |

## 절대 깨면 안 되는 것

1. **플레이어는 개입하지 않는다.** UI 에는 시간(일시정지·배속), 시점(카메라·관찰 대상·표시 방식), 교대 시작 전 조건(시드·난이도)만 있다. AI 에게 명령하는 입력을 만들지 않는다.
2. **재현성.** 같은 시드 + 같은 난이도 = 같은 결과.
   - `src/sim` 안에서는 `Math.random`, `Date`, `performance`, `document`, `window` 금지(테스트가 검사한다).
   - 난수는 `sim.rng.fork('이름')` 으로 만든 흐름만 쓴다. 새 기능은 새 흐름을 만든다(기존 흐름에 호출을 끼워 넣으면 무관한 결과까지 바뀐다).
   - 시간은 고정 틱 0.2초. 주기 판단은 `sim.t` 나 `sim.tick` 으로만 한다. 배속은 `src/view/runner.ts` 가 "프레임당 몇 틱"만 바꾼다.
3. **시뮬레이션과 표현의 분리.** `src/sim` 은 `src/view`, `src/ui` 를 import 하지 않는다. 표현 계층은 상태를 읽기만 한다. 카메라의 체류 시간은 실제 시간 기준이다.
4. **정보 격리.** AI 는 자기 믿음(`BeliefStore`)만으로 판단한다.
   - 진실을 읽어도 되는 곳: `field/hazards.ts`(세계 규칙), `field/executor.ts`(행동의 효과 적용), `field/agents.ts` 의 `perceive`(시야 안 관찰), `debrief.ts`(판정), `incidents.ts`.
   - 진실을 읽으면 안 되는 곳: `field/commander.ts`, `field/brain.ts` 의 판단부, `dispatch/*`.
   - 현재 남아 있는 예외 3건은 `README.md` "알려진 문제"에 적혀 있다. 늘리지 않는다.
5. **가짜 연출 금지.** 로그는 상태를 바꾸는 바로 그 코드에서 `emit()` 으로만 남긴다. 문제는 `raiseProblem()`, 복구는 `markRecovered()`. 보고서 문장은 기록된 문제와 타임라인에서만 만든다.
6. **모든 사건은 반드시 끝난다.** 현장 한계 시간(`sceneManager.ts` 의 `LIMIT`), 작업 보류(`holdUntil`), 교대 상한(`engine.ts` 의 `hardCap`)을 없애지 않는다.

## 구조

```
src/sim/engine.ts            Sim 클래스: 틱 진행, 하위 시스템 호출 순서(바꾸면 결과가 바뀐다)
src/sim/difficulty.ts        난이도 손잡이 → 수치(Tuning). 균형 조정은 우선 여기서 한다
src/sim/types.ts             모든 공유 타입
src/sim/rng.ts               시드 난수, fork
src/sim/events.ts            emit / raiseProblem / markRecovered
src/sim/city.ts              도시 생성, 도로 그래프, 다익스트라, 교통량
src/sim/resources.ts         부대·대원 명부, 차량 이동·우회·병원 이송
src/sim/incidents.ts         사건 생성(유형·규모·위치), 종료 처리
src/sim/debrief.ts           사건 판정, 원인 문장, 교대 보고서
src/sim/dispatch/callSystem.ts   신고자 모델, 접수 AI 질문 선택, 통화
src/sim/dispatch/analyst.ts      유형 확률·위험도·필요 자원
src/sim/dispatch/dispatcher.ts   부대 선택, 대기열, 전환 배정, 현장 요청 수신
src/sim/field/builders.ts    현장 4종 생성(진실)
src/sim/field/hazards.ts     화재·연기, 구조 대상 악화, 용의자, 통과 차량, 누출
src/sim/field/grid.ts        격자, 시야선, A*
src/sim/field/beliefs.ts     Fact / BeliefStore (병합 규칙)
src/sim/field/agents.ts      perceive, learn, 무전(transmit/flushOutbox), fitFor, workLabel
src/sim/field/brain.ts       대원 목표 선택(Utility)
src/sim/field/executor.ts    임무별 실행(case 문), 이동, 장애물 발견·재계획
src/sim/field/commander.ts   지휘관: 믿음 → 작업 목록(want), 배정, 지원 요청, 종료 판단
src/sim/field/sceneManager.ts 현장 틱, 부대 도착·철수, 지휘권 이양
src/view/                    runner(틱·되감기·저장), camera(자동 카메라), renderCity, renderScene, icons, audio(합성음)
src/ui/                      App, Viewport(캔버스·입력), panels(모든 패널), styles.css
scripts/sweep.ts             헤드리스 실행기 (균형·교착 확인의 기본 도구)
tests/sim.test.ts            자동 테스트
```

한 사건의 흐름: `incidents.ts` 가 현장을 만든다 → `callSystem` 통화 → `analyst` 평가 → `dispatcher` 출동 → `resources` 이동 → `sceneManager.unitArrived` → 지휘관 `commander.ts` 가 작업 목록 생성 → 대원 `brain.ts` 가 목표 선택 → `executor.ts` 가 실행하며 현장 상태 변경 → `closeIncident` → `debrief.evaluate`.

## 자주 하는 확장

| 하고 싶은 것 | 고칠 곳 |
|---|---|
| 균형 조정 | `difficulty.ts` 의 표. 그 밖의 상수는 `builders.ts`(현장 내용), `hazards.ts`(확산·악화), `executor.ts`(작업 속도) |
| 새 임무 종류 | `types.ts` `WorkKind` → `agents.ts` `workLabel`·`fitFor` → `executor.ts` case → `commander.ts` 에서 `want()` |
| 새 문제 코드 | `types.ts` `ProblemCode` → `debrief.ts` `PROBLEM_LABEL`·`order`·문장 템플릿 |
| 새 사건 유형 | `builders.ts`, `incidents.ts`(가중치·장소명·신고 지연), `callSystem.ts`(키워드·질문·`TOPIC_VALUE`), `analyst.ts`(위험도·필요 자원), `commander.ts`(규칙), `sceneManager.ts` `LIMIT`, `debrief.ts` `RESP_LIMIT`, `util.ts` `TYPE_NAME`, `view/renderCity.ts` `TYPE_COLOR`, `view/icons.ts` |
| 새 난이도 손잡이 | `difficulty.ts`(타입·표·프리셋) → 쓰는 곳에서 `sim.tune.*` → `ui/panels.tsx` `DifficultyPanel` |

## 겪은 함정

- **낡은 믿음으로 인한 무한 반복.** 지휘관의 믿음이 낡으면 같은 지시를 계속 낸다. 임무가 "이미 해결되어 있어서" 끝날 때는 `learn(sim, a, fact, true, true)` 로 강제 보고한다. 지휘관 쪽에서는 믿음상 끝난 작업을 `cancel` 한다. 새 임무를 만들면 이 두 가지를 반드시 넣는다.
- **보고 지연 사이의 중복 지시.** 수색 결과처럼 지휘관이 기다리는 정보는 묶음 보고(5초)에서 빼고 즉시 보낸다(`flushOutbox` 의 `prompt`).
- **부대 철수 판정.** 대원이 모두 `left` 가 된 뒤에도 부대가 떠나는지 `sceneManager.ts` 5)번 블록에서 확인한다.
- **로그 중복.** 별도 이벤트로 이미 알린 사실은 `learnQuiet` 를 써서 무전 문구에서 뺀다.
- **현장에 대원이 한 명도 남지 않는 경우.** 구급차가 환자를 싣고 떠나면 지휘관도 떠난다. `sceneManager.ts` 7)번 블록이 마지막 지휘관의 믿음(`commander.outstanding`)으로 종료하거나 추가 부대를 요청한다. 새 유형을 만들면 이 경로로 끝나는지 확인한다.
- **인질.** 총을 든 용의자 곁의 인질은 데리고 나올 수 없다(`hazards.isHeld`). 지휘관·실행기 양쪽에서 막아야 한다.
- **신고 키워드 표.** `callSystem.NATURE_LIK` 의 열 수는 사건 유형 수와 같아야 하고 `analyst.ts` 의 `lp`·`TYPES`·`probs` 와 맞아야 한다.
- **한국어 조사.** 이름·호출부호 뒤 조사는 `josa(word, '이/가')` 로 붙인다.
- **브라우저 확인 없이 UI 를 끝났다고 하지 않는다.** 헤드리스 브라우저로 화면을 찍어 보고, 콘솔 오류 0건을 확인한다.

## 작업 방식

- 한 번에 한 작업 묶음. 끝나면 `npm run check` → 커밋 → 푸시 → `docs/ROADMAP.md` 갱신.
- 여러 에이전트가 동시에 작업할 때는 `docs/ROADMAP.md` 의 "트랙"별 파일 소유 규칙을 따른다. `types.ts` 는 추가만 하고, 기존 필드의 의미를 바꾸지 않는다.
- 시뮬레이션을 고친 뒤에는 `npm run sweep -- 60` 의 결과 분포와 `close reasons` 의 `timeout` 건수를 전후로 비교한다. 화면만 고쳤다면 분포가 한 건도 달라지면 안 된다.
- 특정 게임의 아트·명칭·배치를 그대로 옮기지 않는다. 장르의 방식(지도 중심 관제, 통화창, 사건 핀, 차량 아이콘)은 자유롭게 쓴다.
