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
| `npm test` | Vitest 41개 (재현성, 교대 완주, 상태 변화, 정보 격리, 난이도, 전술, 새 유형, 지원, 2층 건물, 배치 다양성, 교전과 진입, 수난·다수 사상자, 건물마다 정해진 도시, 생활 사건 시나리오) |
| `npm run sweep -- 100` | 시드 100개 결과 분포. `--diff hard`, `--diff 4,4,4,2,3,3`(빈도·심각도·용의자·장비·신고·부대), `-v`, `--json`, `--check` |
| `npm run sweep -- 1 --log S7` | 한 교대의 전체 이벤트 기록과 종료 보고서 (동작 확인에 가장 유용) |
| `npm run build` | 타입 검사 + 정적 빌드 |
| `node scripts/screenshot.cjs S7 화재` | (선택, Playwright 필요) 해당 유형 현장이 열렸을 때 화면 캡처. 유형 이름 일부: 화재·교통사고·실종·무장·응급·붕괴·가스·수난 |

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
src/sim/cityPlan.ts          도시 설계도: 교차로 자리(NODES), 도로가 지나는 순서(ROADS), 해안선·강·철길·산, 동네의 성격(DISTRICTS), 손으로 놓은 건물(LANDMARKS), 유형별 사건 장소(INCIDENT_PLACES), 건물 종류별 현장 틀(KIND_SCENE)
src/sim/city.ts              도시 생성(설계도 → 도로 그래프, buildPlaces: 길가에 건물 채우기·골목·진입 지점·주소), 지형 함수(coastY·riverDist·mountainAt·districtAt), 다익스트라, 교통량, placeAt. 만든 지도는 다시 쓴다
src/sim/resources.ts         편성표(UNIT_DEFS: 네 분야 20팀), 대원 명부, 차량 이동·우회, 헬기·구조정의 길 밖 이동, 병원 이송(가까운 병원, 응급실 인계 대기), 인근 도시 지원 부대 생성(createAidUnit)
src/sim/scenarios.ts         시나리오 표: 유형 안에서 갈리는 사건의 모습(몫·신고 내용·일어나는 곳), 화면에 보이는 이름, 신고 내용으로 붙이는 이름(NATURE_LABEL)
src/sim/incidents.ts         사건 생성(유형·시나리오·규모, pickPlace 로 건물 고르기), 종료 처리
src/sim/debrief.ts           사건 판정, 원인 문장, 교대 보고서
src/sim/dispatch/callSystem.ts   신고자 모델, 접수 AI 질문 선택, 통화
src/sim/dispatch/analyst.ts      유형 확률·위험도·필요 자원
src/sim/dispatch/dispatcher.ts   부대 선택, 대기열, 전환 배정, 현장 요청 수신, 인근 도시 지원 요청
src/sim/field/kit.ts         현장 생성 도구: 빈 현장(baseScene), 타일·구역·소품·사람 놓기, furnish(가구)
src/sim/field/plans.ts       건물 평면 생성기: 복도형·방 연결형(이분할)·홀형·2층. 화재·붕괴·가스 누출이 함께 쓴다
src/sim/field/builders.ts    유형별 현장 생성(진실): 화재, 교통사고(버스 변형), 수색, 무장(장소 4종 armedVenue), 응급(주택 2종), 붕괴, 가스 누출, 수난(하천)
src/sim/field/hazards.ts     화재·연기, 구조 대상 악화, 용의자, 통과 차량, 누출, 2차 붕괴(tickCollapse), 가스 확산·폭발·주변 시민 노출(tickGas), 표류(tickWater)
src/sim/field/grid.ts        격자, 시야선(los, 벽만 보는 losWalls), A*(계단 칸은 다른 층으로 건너간다)
src/sim/field/beliefs.ts     Fact / BeliefStore (병합 규칙)
src/sim/field/agents.ts      perceive, learn, 무전(transmit/flushOutbox), fitFor, workLabel
src/sim/field/brain.ts       대원 목표 선택(Utility)
src/sim/field/executor.ts    임무별 실행(case 문), 이동, 장애물 발견·재계획
src/sim/field/commander.ts   지휘관: 믿음 → 작업 목록(want), 배정, 지원 요청, 진입 계획(planEntry), 종료 판단
src/sim/field/sceneManager.ts 현장 틱, 부대 도착·철수, 지휘권 이양
src/view/                    runner(틱·되감기·저장), camera(자동 카메라·현장 확대), renderCity, renderScene(그리는 순서 조립), icons, audio(합성음)
src/view/city/staticCity.ts   도시 지도의 고정된 부분: 땅과 바다, 산, 강, 철길, 골목, 등급별 도로·차선·횡단보도·다리, 시설 건물, 야간 불빛
src/view/city/places.ts       건물 종류별 지붕(paintRoof)과 터(paintOpen: 공원·숲·저수지·활주로·주차장)
src/view/scene/staticLayer.ts 현장의 고정된 부분을 한 번만 그려 두는 층: 바닥 재질, 벽·창·문틀, 가구, 나무, 개울
src/view/scene/sprites.ts    사람(대원·시민·용의자), 쓰러진 사람, 차량, 소품의 벡터 그림
src/view/scene/fx.ts         화염, 연기(저해상도 층), 물줄기, 어둠과 빛, 날씨
src/view/scene/common.ts     색 계산, 해시, 벽에 가려지는 시야 다각형
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
| 새 사건 유형 | `types.ts` `IncidentType` → `builders.ts`(+`buildScene`), `cityPlan.ts` `INCIDENT_PLACES`(어떤 건물에서 나는가), `incidents.ts`(가중치·신고 지연), `callSystem.ts`(`NATURE_TEXT`·`NATURE_LIK` 에 열 추가·`natureFor`·질문·`TOPIC_VALUE`), `analyst.ts`(`TYPES` 순서·위험도·필요 자원), `commander.ts`(수색 대상 유형 목록·규칙), `agents.ts` `fitFor`(건물 안에 누가 들어가는가), `sceneManager.ts` `LIMIT`, `debrief.ts` `RESP_LIMIT`, `util.ts` `TYPE_NAME`, `view/renderCity.ts` `TYPE_COLOR`·`RESP_LIMIT`, `view/icons.ts`, `ui/panels.tsx` 확률 목록. 가장 최근 예: `water` (`git log --grep F1` 의 커밋), 그 전은 `collapse`, `hazmat` (커밋 78ad889). 유형을 늘리지 않고 변형만 더할 때는 `truth.variant`·`Scene.variant` 를 쓴다(예: 교통사고의 `bus`) |
| 새 타일·가구·소품 | `types.ts` `T`·`DECOR`·`PropKind` → `grid.ts`(`staticPass`·`isIndoor`·`los`) → 그림은 `view/scene/staticLayer.ts`(고정된 것) 또는 `view/renderScene.ts` 의 소품 분기 + `view/scene/sprites.ts`(움직이거나 상태가 바뀌는 것) |
| 지도 바꾸기 | 전부 `cityPlan.ts` 에서 한다. 교차로를 옮기려면 `NODES`, 길을 내거나 없애려면 `ROADS`(이웃한 두 교차로 사이가 한 구간이 된다), 동네의 건물 구성은 `DISTRICTS` 의 `mix`·`density`, 하나뿐인 건물은 `LANDMARKS`(가운데 좌표·크기·각도), 사건이 나는 곳은 `INCIDENT_PLACES`(건물 종류 전체의 몫). 새 건물 종류는 `types.ts` `PlaceKind` → `cityPlan.ts` `KIND_NAME`·`KIND_DISTRICT`·`KIND_SCENE` → 길가에 채울 종류면 `city.ts` `DIM`(크기) → `view/city/places.ts` `paintRoof`(없으면 평지붕). 도로를 고친 뒤에는 테스트(`건물마다 정해진 도시`)가 교차·단절·건물 겹침을 잡는다. 지도를 바꾸면 모든 결과가 바뀌므로 `sweep` 으로 다시 잰다 |
| 새 부대 종류 | `types.ts` `UnitKind` → `resources.ts` `KIND`(부서·능력·장비)·`UNIT_DEFS`(분야·소속 시설·편성 단계)·`UNIT_KIND_NAME` → `view/scene/sprites.ts` `VEH_SIZE`·`drawEmergency`·`responderLook`. 소속 시설이 새로 필요하면 `cityPlan.ts` `LANDMARKS` 에 `facility` 를 붙여 넣는다 |
| 새 시나리오 (유형은 그대로, 모습만 다르게) | `scenarios.ts` `SCENARIOS` 에 한 줄(몫·신고 내용 키·장소) → `callSystem.ts` `NATURE_TEXT`·`NATURE_LIK` 에 신고 내용 키(8열) → `scenarios.ts` `NATURE_LABEL` → `builders.ts` 에 현장의 모습(`buildScene` 이 변형으로 갈라 부른다) → 필요하면 `analyst.ts` 의 시나리오별 필요 자원. 기존 소품에 다른 모습만 입힐 때는 `Prop.skin` 을 쓴다(쓰러진 나무와 맨홀은 `roadDebris` 다). 가장 최근 예: `tree`·`manhole`·`elevator`·`domestic`·`burglary` |
| 새 난이도 손잡이 | `difficulty.ts`(타입·표·프리셋) → 쓰는 곳에서 `sim.tune.*` → `ui/panels.tsx` `DifficultyPanel` |

## 겪은 함정

- **낡은 믿음으로 인한 무한 반복.** 지휘관의 믿음이 낡으면 같은 지시를 계속 낸다. 임무가 "이미 해결되어 있어서" 끝날 때는 `learn(sim, a, fact, true, true)` 로 강제 보고한다. 지휘관 쪽에서는 믿음상 끝난 작업을 `cancel` 한다. 새 임무를 만들면 이 두 가지를 반드시 넣는다.
- **보고 지연 사이의 중복 지시.** 수색 결과처럼 지휘관이 기다리는 정보는 묶음 보고(5초)에서 빼고 즉시 보낸다(`flushOutbox` 의 `prompt`).
- **부대 철수 판정.** 대원이 모두 `left` 가 된 뒤에도 부대가 떠나는지 `sceneManager.ts` 5)번 블록에서 확인한다.
- **로그 중복.** 별도 이벤트로 이미 알린 사실은 `learnQuiet` 를 써서 무전 문구에서 뺀다.
- **현장에 대원이 한 명도 남지 않는 경우.** 구급차가 환자를 싣고 떠나면 지휘관도 떠난다. `sceneManager.ts` 7)번 블록이 마지막 지휘관의 믿음(`commander.outstanding`)으로 종료하거나 추가 부대를 요청한다. 새 유형을 만들면 이 경로로 끝나는지 확인한다.
- **인질.** 총을 든 용의자 곁의 인질은 데리고 나올 수 없다(`hazards.isHeld`). 지휘관·실행기 양쪽에서 막아야 한다.
- **한 임무 안에서 이동 목표를 둘 두지 않는다.** `moveTo` 는 목표가 바뀌면 경로를 다시 짠다. 한 틱에 서로 다른 목표로 `moveTo` 를 두 번 부르면 대원이 두 목표 사이를 오가며 제자리에 선다(교전 임무에서 실제로 겪었다). 분기마다 `moveTo` 를 한 번만 부르고 `return` 한다.
- **"쏘지 않는다"는 규칙에는 다른 행동이 따라야 한다.** 인질 때문에 사격을 삼가는 동안 아무것도 하지 않으면 용의자가 대원을 보지 못한 채 서 있을 때 끝없이 대치한다. 지금은 섬광탄이 없으면 쏘지 않고 다가가 덮친다.
- **신고 키워드 표.** `callSystem.NATURE_LIK` 의 열 수(지금 8)는 사건 유형 수와 같아야 하고 열 순서는 `analyst.ts` 의 `TYPES` 와 같아야 한다(테스트가 열 수를 검사한다).
- **위험한 건물 안에는 소방만 들어간다.** `agents.ts` `fitFor` 의 `fireRisk` 가 화재·가스 누출·붕괴 현장의 실내 임무(수색·구출·이송)를 소방으로 제한한다. 소방 부대가 하나도 없으면 지휘관이 지원을 요청한다. 새 유형을 만들면 이 목록에 넣을지 정한다.
- **계단.** 2층 건물은 두 층을 같은 격자에 나란히 놓고 `Scene.stairTo` 로 잇는다. 경로의 다음 칸이 이웃이 아닐 수 있으므로, 경로를 따라 걷는 코드(`executor.moveTo`, `hazards.tickCasualties`)는 계단 건너뛰기를 따로 처리한다. 경로를 걷는 개체를 새로 만들면 똑같이 처리한다. 거리(`dist`)로 "가깝다"를 판단하는 코드는 두 층이 벽과 빈 공간(`T.VOID`)으로 4칸 이상 떨어져 있다는 데 기대고 있다.
- **교대 중에 부대가 늘어난다.** 인근 도시 지원 부대(`u.aid`)는 `sim.units`·`sim.responders` 끝에 붙는다. 소속 시설이 없으므로 `facilities.find(...)` 결과가 없을 수 있다. 임무 뒤에는 `oos` 가 되어 다시 쓰이지 않는다.
- **소품은 길을 막는다.** 문과 잔해가 아닌 소품(밸브·균열부·차량 등)은 `agents.agentCost` 에서 지나갈 수 없는 칸이다. 통로나 문 앞에 놓으면 방이 끊겨 수색이 끝나지 않는다(가스 누출에서 실제로 겪었다). 방 안의 소품은 가구가 있던 자리에 놓거나, 놓은 뒤에도 모든 바닥에 닿는지 확인한다.
- **물속의 사람.** `Casualty.inWater` 인 사람은 매 틱 떠내려가고(`hazards.tickWater`) 걸어서 닿을 수 없다. 건져 내는 임무는 `waterRescue` 하나뿐이고(물가에서 3.6칸 안), 처치·이송은 `inWater` 가 풀린 뒤에만 한다. 지휘관은 믿음 속 위치의 칸이 `T.WATER` 일 때 이 임무를 낸다.
- **사건 도중 구조 대상이 늘어난다.** 가스 누출 현장의 주변 시민(`bystander2`)은 `s.casualties` 끝에 붙는다. 구조 대상 수를 처음에 세어 두고 쓰는 코드를 만들지 않는다.
- **쉬는 대원의 왕복.** 휴식 점수가 다른 임무 점수와 비슷하면 쉬다 일하다를 되풀이한다. `brain.ts` 는 체력 40까지 휴식을 붙잡아 두고, 탈진 기록은 45초에 한 번만 남긴다.
- **변형별 한계 시간.** 다수 사상자 사고(`variant === 'bus'`)는 `LIMIT` 에 170초를 더한다. 사람이 많은 변형을 새로 만들면 한계 시간도 함께 본다.
- **도시는 고정이고 한 번만 만든다.** `generateCity` 는 설계도로 만든 지도를 모듈에 넣어 두고, 교대마다 도로 상태(`edges`)만 복사해 준다. `city.places`·`nodes` 를 시뮬레이션 중에 고치면 다음 교대에도 남는다. 고치지 않는다.
- **격자가 아니다.** 교차로에는 행·열이 없다(`RoadNode.c`·`r` 은 0). 교차로는 `key`(설계도의 이름표)로, 도로는 `e.name`·`e.cls`·`e.seq` 로 다룬다. 건물은 돌려 놓여 있으므로(`Place.rot`) 가운데는 `x + w/2, y + h/2` 이고, 점이 안에 있는지는 `placeAt` 처럼 돌려서 본다.
- **헬기와 구조정.** `u.air`·`u.sea` 는 도로 경로(`route`)가 없다. 위치는 `tickUnits` 의 길 밖 이동이 직접 옮긴다. 길가 주차(`curb`)·교차로 스냅을 적용하지 않는다. 구조정은 바닷가(`resources.coastal`)의 수난 사고에만, 헬기는 수색이나 위험도 높은 사건에만 배정된다(`dispatcher.pickUnit`).
- **환자를 싣는 부대.** 구급차만이 아니다. `agents.canCarryPatients`(구급차 2명, 헬기 1명)로 본다. `dept === 'ems'` 로만 가리면 헬기가 구조한 사람이 구급차를 기다리다 한계 시간까지 간다(실제로 겪었다).
- **닿지 못하는 한두 칸.** 벽이 무너지거나 가구가 놓이며 생긴 작은 틈은 `builders.sealPockets` 가 벽으로 메운다. 세 칸 이상이 끊기면 평면 생성의 잘못이므로 테스트가 잡는다.
- **사건의 위치는 건물이다.** `I.truth.placeId`(교통사고는 -1)·`placeKind`·`district`(건물 종류로 본 구역)를 쓴다. `I.truth.nodeId` 는 차량이 닿는 교차로이고 `I.truth.x/y` 는 건물 가운데다. 현장 생성기는 `KIND_SCENE[placeKind]` 로 틀·2층 여부·무장 사건 장소를 정한다.
- **차량의 마지막 구간.** 교차로에 닿은 차량은 `Unit.curb` 로 건물 앞 길가까지 가고(`parking`), 떠날 때는 되돌아 나온 뒤 경로를 따른다(`resources.tickUnits`). 차량 위치(`u.x`,`u.y`)를 다른 곳에서 덮어쓰지 않는다(`unitArrived` 가 그랬다가 길가에 선 차량이 교차로로 튀었다).
- **가구 자리에 소품을 놓을 때.** 가구에 둘러싸인 구석은 사람이 닿지 못한다. 바로 옆 칸 하나가 빈 바닥인 자리만 쓴다(가스 밸브에서 겪었다).
- **색 계산.** `mix()`·`shade()` 는 `rgb(r,g,b)` 문자열을 돌려준다. `common.rgb()` 가 그것을 다시 읽을 수 있어야 색을 겹쳐 계산할 수 있다(예전에는 `#rrggbb` 만 읽어 지붕 명암이 조용히 빠졌다). `rgba(...)` 는 넣지 않는다.
- **한국어 조사.** 이름·호출부호 뒤 조사는 `josa(word, '이/가')` 로 붙인다.
- **브라우저 확인 없이 UI 를 끝났다고 하지 않는다.** 헤드리스 브라우저로 화면을 찍어 보고, 콘솔 오류 0건을 확인한다.
- **현장 그림의 고정 층.** `staticLayer.ts` 는 타일·가구가 바뀔 때만 다시 그린다(`staticSig`). 매 프레임 바뀌는 것(문짝, 불, 사람)을 여기에 넣지 않는다. 새 타일 종류·가구를 만들면 `surfaceMap`·`paintTile`·`furniture` 에 그림을 추가한다.
- **건물 배치는 고정이 아니다.** 방의 수·위치·출입구가 사건마다 다르다. 좌표를 직접 쓰지 말고 `Plan`(`rooms`·`corridors`·`exitDoors`·`floors`)과 `s.exits`·`s.regions` 로 찾는다. 복도가 없는 건물(`corridors` 가 빈 배열)도 있다. 새 틀을 만들면 "모든 바닥에 걸어서 닿는다"는 테스트(`현장 배치의 다양성`)를 통과해야 한다.
- **가구는 실제 장애물이다(`T.FURN`).** 지나갈 수 없고, 시야는 통과하며, 엄폐물이 된다. 방을 새로 만들 때는 `builders.ts` 의 `furnish()` 를 쓴다(문 주변을 비우고 방이 끊기지 않는지 검사한다).

## 작업 방식

- 한 번에 한 작업 묶음. 끝나면 `npm run check` → 커밋 → 푸시 → `docs/ROADMAP.md` 갱신.
- 여러 에이전트가 동시에 작업할 때는 `docs/ROADMAP.md` 의 "트랙"별 파일 소유 규칙을 따른다. `types.ts` 는 추가만 하고, 기존 필드의 의미를 바꾸지 않는다.
- 시뮬레이션을 고친 뒤에는 `npm run sweep -- 60` 의 결과 분포와 `close reasons` 의 `timeout` 건수를 전후로 비교한다. 화면만 고쳤다면 분포가 한 건도 달라지면 안 된다.
- 특정 게임의 아트·명칭·배치를 그대로 옮기지 않는다. 장르의 방식(지도 중심 관제, 통화창, 사건 핀, 차량 아이콘)은 자유롭게 쓴다.
