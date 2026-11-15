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
| `npm run check` | **커밋 전 관문**: 타입 검사 + 테스트 + 시드 40개 헤드리스 검증 (3분쯤) |
| `npm test` | Vitest 245개(+건너뜀 1), 파일 12개: `sim`(재현성, 교대 완주, 정보 격리, 난이도, 전술, 유형별 현장, 지도, 생활 사건, 추격전) · `ext`(확장 지점) · `crime` · `major` · `disaster` · `destruction` · `traffic` · `causality`(측정 도구: 결과 불변·손 계산·문구 규칙·멈춤 감지기) · `combatfx`(교전 연출: 기록 꼬리표·소리 상한·결과 불변) · `loops`(반복 고리·실패 기억·연쇄 상한) · `legibility`(무너짐 기록·시점 규칙·그림 함수). 한 묶음만 볼 때는 `npx vitest run tests/crime.test.ts` |
| `npm run sweep -- 100` | 시드 100개 결과 분포. `--diff hard`, `--diff 4,4,4,2,3,3`(빈도·심각도·용의자·장비·신고·부대, 일곱째 숫자를 붙이면 교통), `-v`, `--json`, `--check` |
| `npm run sweep -- 1 --log S7` | 한 교대의 전체 이벤트 기록과 종료 보고서 (동작 확인에 가장 유용). `--metrics` 를 붙이면 사건마다 가장 긴 원인 사슬과 확산 길 |
| `npm run sweep -- 40 --metrics` | 측정 도구(I1-a, `scripts/metrics.ts`): 기본 출력의 지표 아홉 줄(`chain` 연쇄 깊이 · `systems` 시스템 간 영향 · `replan` 재계획 · `alt` 대체 방법 · `actions` 행동 다양성 · `contention` 자원 경쟁 · `stall` 멈춘 시간 · `variety` 결과 다양성 · `consistency` 기록 일치)에 더해 시나리오별 표와 모든 후보(`STALL`·`FORGOT`·`REPEAT`·`SPREAD`·`UNLOC`). `--no-metrics` 는 표본을 끈다(속도 비교용). 관문(`--check`)은 연쇄 깊이 ≤ 4·교대당 연쇄 ≤ 8·기록 일치 C1~C4 = 0·계산 오류 0 을 늘, 교착 후보·잊힌 사건 0 을 보통 기본 조건에서 건다 |
| `npm run sweep -- 20 --force armed/kidnap --scen` | 그 시나리오를 교대마다 초반에 한 번 일으키고, 시나리오별 결과 표를 낸다 (새 시나리오 확인용). `--disaster typhoon`(flood·quake·wildfire·tsunami)은 재난을 정해서 |
| `npm run ui-check` | (선택, Playwright 필요) 화면 자동 검사. 개발 서버(5191)를 스스로 띄워 콘솔 오류·배속·되감기 뒤 기록 해시(헤드리스와 비교)·새로고침 복원·종료 보고서·패널을 본다(2분쯤). `-- --out <폴더> --seed S7`. 화면을 고친 묶음은 끝낼 때 한 번 돌린다 |
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
   - 진실을 읽어도 되는 곳: `field/hazards.ts`(세계 규칙), `field/executor.ts`(행동의 효과 적용), `field/agents.ts` 의 `perceive`(시야 안 관찰), `debrief.ts`(판정), `incidents.ts`, `field/fxlog.ts`(기록 전용 — 그림·소리에 쓸 꼬리표만 남기고 판단하지 않는다).
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
src/sim/city.ts              도시 생성(설계도 → 도로 그래프, addLocalStreets: 블록 안의 이면 도로, buildPlaces: 길가에 건물 채우기·골목·진입 지점·주소), 지형 함수(coastY·riverDist·mountainAt·districtAt), 다익스트라(findRoute: 알려진 통제만 피한다)·edgeTime, placeAt. 만든 지도는 다시 쓴다
src/sim/traffic.ts           교통: 구간별 혼잡(시간대·뒤로 밀림·병목·bump), 교통 사건(정체·공사·고장 차량·낙하물·행사 인파), 가 보아야 아는 장애물(known)과 불법 주차(큰 차만 못 지남), 건널목과 열차(wait)
src/sim/resources.ts         편성표(UNIT_DEFS: 네 분야 20팀), 대원 명부, 차량 이동·우회, 헬기·구조정의 길 밖 이동, 병원 이송(가까운 병원, 응급실 인계 대기), 인근 도시 지원 부대 생성(createAidUnit)
src/sim/scenarios.ts         시나리오의 틀(Scenario)과 모음. 내용은 묶음별 파일 scenarios/{life,chase,crime,major,disaster}.ts 에 있다: 몫·신고 문구·필요 자원·장소·한계 시간·이어지는 사건
src/sim/disaster.ts          재난 다섯 종류(태풍·홍수·지진·산불·해일): 선택(없음·무작위·종류), 단계(예고→충격→여파), 사건을 한꺼번에 일으키고 도로를 통제한다(closeEdge: 우회로가 있을 때만)
src/sim/field/sceneRegistry.ts  묶음별 파일이 끼워 넣는 자리: 현장 생성(scenes/), 세계 규칙(rules/), 지휘 규칙(orders/, 믿음만 읽는다)
src/sim/incidents.ts         사건 생성(유형·시나리오·규모, pickPlace 로 건물 고르기), 종료 처리
src/sim/chain.ts             연쇄 상한: canChain(sim, 부모) — 한 사슬 3건, 한 교대 6건(예약 대기 포함). 재범·은신처·연쇄 방화를 예약하는 곳에서 본다
src/sim/pursuit.ts           추격전: 도주 차량의 주행·길 고르기, 목격 신고와 부대의 시야, 세우기(따라붙음·앞을 막음·사고)와 놓침
src/sim/debrief.ts           사건 판정, 원인 문장, 교대 보고서
src/sim/dispatch/callSystem.ts   신고자 모델, 접수 AI 질문 선택, 통화
src/sim/dispatch/analyst.ts      유형 확률·위험도·필요 자원
src/sim/dispatch/dispatcher.ts   부대 선택, 대기열, 전환 배정, 현장 요청 수신, 인근 도시 지원 요청
src/sim/field/kit.ts         현장 생성 도구: 빈 현장(baseScene), 타일·구역·소품·사람 놓기, furnish(가구)
src/sim/field/plans.ts       건물 평면 생성기: 복도형·방 연결형(이분할)·홀형·2층. 화재·붕괴·가스 누출이 함께 쓴다
src/sim/field/builders.ts    유형별 현장 생성(진실): 화재, 교통사고(버스 변형), 수색, 무장(장소 4종 armedVenue), 응급(주택 2종), 붕괴, 가스 누출, 수난(하천)
src/sim/field/hazards.ts     화재·연기, 구조 대상 악화, 용의자, 통과 차량, 누출, 2차 붕괴(tickCollapse), 가스 확산·폭발·주변 시민 노출(tickGas), 표류(tickWater), 폭발(blast), 배회 실종자(tickWander), 응급 환자 급변(tickMedical), 압궤 증후군(tickCrush), 승강기 안 발작(tickLift). 균형 상수 WANDER·MEDICAL·CRUSH·LIFT (+ builders.LEAVES_BEFORE_POLICE, dispatcher.CO_RESPOND)
src/sim/field/damage.ts      현장 파손: 총격·폭발·열에 창이 깨지고(s.glass) 엄폐 가구가 닳아 부서진다(s.decorHp, 부서지면 T.FLOOR). 난수는 dmg:<현장 id> 흐름만
src/sim/field/grid.ts        격자, 시야선(los, 벽만 보는 losWalls), A*(계단 칸은 다른 층으로 건너간다)
src/sim/field/beliefs.ts     Fact / BeliefStore (병합 규칙)
src/sim/field/agents.ts      perceive, learn, 무전(transmit/flushOutbox), fitFor, workLabel
src/sim/field/brain.ts       대원 목표 선택(Utility)
src/sim/field/executor.ts    임무별 실행(case 문), 이동, 장애물 발견·재계획
src/sim/field/commander.ts   지휘관: 믿음 → 작업 목록(want), 배정, 지원 요청, 진입 계획(planEntry), 종료 판단
src/sim/field/sceneManager.ts 현장 틱, 부대 도착·철수, 지휘권 이양
src/view/                    runner(틱·되감기·저장), camera(자동 카메라·현장 확대), renderCity, renderScene(그리는 순서 조립), icons, audio(합성음)
src/sim/field/fxlog.ts       교전 연출 기록(사격·섬광탄·진입·폭발·검거·근접): s.fx 의 꼬리표(Fx.c)에만 쓰고 난수를 부르지 않는다 — 결과는 바뀌지 않는다
src/view/scene/fxBook.ts     연출 시계(최대 2배, 일시정지면 멈춤), 처음 보는 기록 받아들이기, 같은 틱 안의 순서 지연, 합성 항목, 남는 그림, 흔들림, 화면 막
src/view/scene/combat.ts     교전 그림(총구 섬광·예광선·탄착, 섬광탄, 폭발, 진입 3-2-1·문짝, 겨누는 선·말풍선, 수갑). 새 효과 종류를 그리면 FX_DRAWN, 결정적 순간이면 DECISIVE 에 더한다
src/view/audioCombat.ts      교전 소리(planCues 는 순수 함수: 배속별 묶음, 토큰 통, 동시 발음 상한 / CombatVoice 음색)
src/view/city/combatPin.ts   지도의 교전 핀(사격 별·폭발 고리·교전 중 점선 테)
src/sim/field/ruins.ts       무너짐 기록(markRuin: Scene.ruin 칸의 처음 모습·무너진 모습, recordFall: Scene.falls·Fx 'collapse'). 기록 전용 — 결과는 바뀌지 않는다
src/view/hazardState.ts      현장·지도·카드가 함께 쓰는 상태 읽기(ruinInfo·ruinSeen·pinIcon·가스·인질 상태, 시점 규칙)
src/view/scene/ruins.ts      무너진 구역의 고정 층 그림(내려앉은 음영·잔해 더미·쓰러진 벽·금·경계) / scene/hazardFx.ts: 위험 범위·무너지는 순간·먼지 충격 고리·되살아난 불·인질 표지
src/view/city/ruinLayer.ts   지도의 무너진 지붕·먼지·배지(부대 표식 뒤에 그린다)·끝난 붕괴 기호 / src/ui/HazardStrip.tsx: 사건 카드의 상태 칩
src/view/marks.ts            부대 열두 종류·시설·상태의 그림 기호(24×24 경로 문자열). 지도(캔버스 Path2D)와 패널(SVG)이 같은 것을 쓴다. 지도와 목록에 글자 표식을 쓰지 않는다
src/view/city/tokens.ts       지도의 둥근 부대 표식(분야색 바탕 + 기호 + 번호 점 + 상태 테), 시설 배지(둥근 네모), 이름표 자리 고르기
src/view/city/trafficLayer.ts 혼잡 띠(노랑 서행·주황 정체·빨강 극심), 통제 점선, 장애물 표식, 열차와 차단기, 마우스 설명
src/view/city/disasterLayer.ts 재난의 지도·화면·현장 그림(불어난 강, 산불의 탄 자리, 물마루, 비바람, 정전)
src/view/city/staticCity.ts   도시 지도의 고정된 부분: 땅과 바다, 산, 강, 철길, 골목, 등급별 도로·차선·횡단보도·다리, 시설 건물, 야간 불빛
src/view/city/places.ts       건물 종류별 지붕(paintRoof)과 터(paintOpen: 공원·숲·저수지·활주로·주차장)
src/view/scene/staticLayer.ts 현장의 고정된 부분을 한 번만 그려 두는 층: 바닥 재질, 벽·창·문틀, 가구, 나무, 개울
src/view/scene/sprites.ts    사람(대원·시민·용의자), 쓰러진 사람, 차량, 소품의 벡터 그림
src/view/scene/fx.ts         화염, 연기(저해상도 층), 물줄기, 어둠과 빛, 날씨
src/view/scene/common.ts     색 계산, 해시, 벽에 가려지는 시야 다각형
src/view/scene/skins/        묶음별 소품 그림(crime·major·disaster). skins.ts 가 모아서 renderScene 에 넘긴다
src/ui/                      App, Viewport(캔버스·입력), panels(모든 패널), CallDock(오른쪽 칸 맨 위의 접히는 통화창, P 키, 접힘 기억 ar.call.v1), Mark(<Mark>·<Token>·<FacilityBadge>), MapLegend(지도 범례), TrafficChip(상단 교통 요약), DisasterBanner(특보 띠), styles.css
scripts/sweep.ts             헤드리스 실행기 (균형·교착 확인의 기본 도구)
scripts/ui-check.cjs         화면 자동 검사 (+ ui-check-ref.ts: 같은 시드·난이도의 헤드리스 기록 해시). 화면 쪽 관찰 고리는 App.tsx 의 window.__ar.snap()·combat()·fxStep() (개발 서버에서만, 읽기 전용)
scripts/combatshots.cjs      교전 장면 찍기(장면 틱에 멈추고 연출 시계만 넘기며 찍는다)
tests/                       sim.test.ts(기본) + 묶음별 ext·crime·major·disaster·destruction·traffic
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
| 새 부대 종류 | `types.ts` `UnitKind` → `resources.ts` `KIND`(부서·능력·장비)·`UNIT_DEFS`(분야·소속 시설·편성 단계)·`UNIT_KIND_NAME`·큰 차면 `HEAVY` → `view/marks.ts` `UNIT_MARK`(지도·목록의 그림 기호)·`ui/MapLegend.tsx` → `view/scene/sprites.ts` `VEH_SIZE`·`drawEmergency`·`responderLook`. 소속 시설이 새로 필요하면 `cityPlan.ts` `LANDMARKS` 에 `facility` 를 붙여 넣는다 |
| 새 시나리오 (유형은 그대로, 모습만 다르게) | 묶음별 파일에만 쓴다: `scenarios/<묶음>.ts` 에 한 줄(몫·신고 문구 `texts`·가능도 `lik` 8열·필요 자원 `needs`·장소 `places`·한계 시간 `limit`·`onCreate`/`onClose`) → `field/scenes/<묶음>.ts` 에서 `registerScene(유형, 변형, 만드는 함수)` → 세계 규칙이 필요하면 `field/rules/<묶음>.ts` `registerRule`, 지휘관이 달리 움직여야 하면 `field/orders/<묶음>.ts` `registerOrders`·`registerBlocker`(믿음만 읽는다) → 소품에 다른 모습은 `Prop.skin` + `view/scene/skins/<묶음>.ts`. 확인은 `npm run sweep -- 20 --force 유형/변형 --scen`. 자세한 규칙은 `docs/specs/README.md` |
| 새 교통 사건·장애물 | `traffic.ts` 의 `ObstacleKind`·`OBSTACLE_LABEL`·교통 사건 추첨(`spawn`) → 길을 막는 것은 반드시 `addObstacle`(큰 차 기준 우회로를 확인한다) → 그림은 `view/city/trafficLayer.ts` `OBSTACLE_ICON` → `ui/MapLegend.tsx`. 다른 시스템이 길을 닫을 때는 `closedReason` 을 'incident'·'disaster' 로 두고 `known` 은 건드리지 않는다 |
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
- **추격전의 사건은 자리가 움직인다.** `I.pursuit.state === 'driving'` 인 동안 `I.truth.x/y/nodeId` 는 달리는 차를 따라 바뀌고, 현장(`sim.scenes[I.id]`)은 틱을 돌지 않는 임시 현장이다(신고자가 본 내용을 정하는 데만 쓴다). 차가 서면 `pursuit.stop` 이 그 교차로에 현장을 다시 만든다. 부대는 알려진 위치(`I.reportedNode`)에 닿아도 현장에 들어가지 않고 기다린다(`resources.arrive`). 사건의 위치가 고정이라고 가정하는 코드를 새로 쓰지 않는다.
- **길 위의 현장에도 자리가 필요하다.** 봉쇄와 협상은 `s.spots`(출입구별 자리)를 쓴다. 건물이 없는 현장(`s.outdoor`)을 만들 때도 `s.exits`·`s.spots` 를 채우고, 용의자가 서는 칸이 나무가 아닌지 확인한다(없으면 "진입 경로를 찾지 못했습니다"만 되풀이한다).
- **한 팀뿐인 경찰.** 한 사람이 말을 걸고 한 사람이 길목을 지키면 붙잡을 손이 없다. 지휘관은 22초 뒤 경찰을 한 팀 더 부른다(`commander.ts`). 경찰이 한 팀만 가는 시나리오를 만들면 이 경로로 끝나는지 본다.
- **환자를 태운 채 철수하는 부대.** 철수 지시(`boardOrder = 'release'`) 뒤에 탑승 임무가 끝나 환자가 실릴 수 있다. 부대가 떠날 때는 지시가 아니라 `u.patients.length` 를 보고 병원으로 보낸다(`sceneManager.ts` 5)번 블록). 그러지 않으면 환자를 태운 채 다음 사건에 나가 예외가 난다(실제로 겪었다).
- **시나리오의 순서가 추첨 결과를 바꾼다.** 한 유형 안에서 `SCENARIOS` 의 순서대로 몫을 깎아 고른다. 묶음 파일의 순서를 바꾸거나 시나리오를 더하면 그 유형의 사건이 전부 달라진다(균형은 같지만 시드별 결과는 바뀐다).
- **닫힌 길이라고 다 피하지 않는다.** `e.closed` 인데 `e.known === false` 면 아직 아무도 모르는 통제다(낙하물). `findRoute`·`etaFor`·`dispatch/*` 는 알려진 통제만 피하고, 부대는 그 앞에 가서야 멈춰 알리고(`traffic.reportObstacle`) 들어온 교차로로 되짚어 나온다. 그동안(`u.backing`) `route.nodes[0]` 은 `u.nodeId` 가 아니다. 관제 쪽 코드에서 `e.closed` 만 보고 판단하면 정보 격리가 깨진다.
- **혼잡은 교통 모델의 것이다.** `e.cong` 은 12초마다 `traffic.ts` 가 다시 끌어당긴다. 밖에서 오래 가는 혼잡을 얹으려면 `e.bump` 에 더하고 끝날 때 뺀다(정전·행사 인파가 그렇게 한다. 덮어쓰지 않는다). `edgeTime` 은 차단기 대기(`e.wait`)를 포함하지만 실제 주행은 그 시간을 빼고 달리다 차단기 앞에서 선다.
- **길을 막는 것은 우회로를 확인하고 놓는다.** 불법 주차는 다른 구간 하나가 더 막혀도 큰 차(`Unit.heavy`)가 양 끝을 오갈 수 있는 골목에만 놓이고, 하나 남은 길을 막게 된 장애물은 교통 모델이 바로 치운다. 재난은 `disaster.closeEdge`(우회로가 있을 때만), 사건은 기존의 통제 규칙을 쓴다. 새로 길을 닫는 코드를 만들면 "모든 시설에서 모든 교차로로 간다"가 깨지지 않는지 본다(`tests/traffic.test.ts`).
- **가구는 부서진다.** 총격·폭발로 `s.decorHp` 가 255 가 된 가구 칸은 `T.FLOOR` 로 바뀐다(엄폐가 사라지고 길이 열린다). 가구가 있던 자리를 기억해 두고 쓰는 코드를 만들지 않는다. 고정 층은 `staticSig` 에 깨진 창의 수와 피해의 합이 들어 있어 스스로 다시 그린다. 파손의 난수는 `dmg:<현장 id>` 흐름만 쓴다(사격 판정의 흐름을 건드리면 모든 교전 결과가 바뀐다).
- **해체가 끝난 장치는 길을 비운다.** 폭발물(`PropKind 'bomb'`)은 소품이라 길을 막는다. 해체·확인·폭발 뒤에는 `s.propAt` 을 비워야 그 방의 수색이 끝난다. 살아 있는 장치가 있는 동안에는 지휘관이 종료를 선언하지 않는다(`registerBlocker`).
- **대형 사고·재난의 시나리오는 평소 추첨에 없다.** `tag: 'major'` 는 교대마다 많아야 한 번(`sim.rngMajor`), `tag: 'disaster'` 와 `share: 0` 은 직접 일으킬 때만 나온다. 테스트에서 "평소 교대 40번에 몇 번 나온다"에 기대지 말고 `createIncident(sim, { type, variant })` 나 `new Sim(seed, d, len, { force })` 로 직접 일으킨다.
- **시나리오 표는 추격전을 import 하지 않는다.** `scenarios/*.ts` 가 `pursuit.ts` 를 import 하면 순환이 생겨 `callSystem.ts` 가 초기화 전의 `SCENARIOS` 를 읽는다. 달리는 차로 시작하는 시나리오는 `incidents.createIncident` 의 `startPursuit` 줄에 변형 이름을 더한다.
- **다수 사상자 규칙은 모든 사건에 걸린다.** 부상자 5명 이상이면 구급을, 고립 3명 이상이면 구조를 더 부른다(`orders/major.ts`). 구급차는 세 대뿐이라 한가한 교대에서도 인근 도시 지원이 불릴 수 있다.
- **지도와 목록에 글자 표식을 쓰지 않는다.** 부대·시설·장애물은 `view/marks.ts`·`trafficLayer.OBSTACLE_ICON` 의 그림 기호로 그린다. 같은 종류 안의 번호는 숫자가 아니라 돌 아래의 점이다. 새 표식을 만들면 범례(`ui/MapLegend.tsx`)에도 넣는다.
- **한국어 조사.** 이름·호출부호 뒤 조사는 `josa(word, '이/가')` 로 붙인다.
- **브라우저 확인 없이 UI 를 끝났다고 하지 않는다.** 헤드리스 브라우저로 화면을 찍어 보고, 콘솔 오류 0건을 확인한다. `npm run ui-check` 가 기본 검사를 해 준다. `window.__ar.snap()` 의 필드 이름이나 버튼 글자·클래스(정지/재개, N×, 자동 감속, .card.incident 등)를 바꾸면 `scripts/ui-check.cjs` 도 고친다. 새로고침 복원은 주소에 seed·diff·disaster·force 가 없을 때만 일어난다.
- **이미 끝나 있던 일은 조용히 + 강제로 보고한다.** `learnQuiet` 로만 기록하면 같은 값이라 보고가 나가지 않아 지휘관이 같은 일을 끝없이 다시 지시한다(목격자 면담에서 겪었다). `executor.reportDone` 을 쓴다.
- **음영 구역에 묻힌 보고.** 지휘관이 음영 구역에 있을 때 배달된 무전은 다시 오지 않는다. 대원이 모두 손을 놓았는데 끝낼 수 없으면 `commander.rollCall` 이 확인 무전(`RadioMsg.kind 'rollcall'`)을 한 번 보내고, 대원은 아는 사실을 소리 없이 다시 보고한다.
- **쉬는 대원에게 묶인 작업.** 휴식·장비 교체 중인 대원에게 묶인 작업은 `assign` 이 8초 뒤 넘기고, 체력 40 미만으로 쉬는 대원에게는 지시하지 않는다.
- **우선순위 차이 0.22 규칙.** 하던 일보다 0.22 이상 높아야 빼 온다. 그래서 봉쇄(0.76)에 묶인 경찰은 진입(0.9)으로 빼 올 수 없다 — 진입이 정해지면 진입조 둘을 먼저 채우고 남는 경찰만 봉쇄한다. 지휘관 본인의 현장 평가는 예외로 먼저 한다. 새 임무의 우선순위를 정할 때 이 규칙으로 교착이 생기지 않는지 본다(흉기 대치에서도 겪었다: 흉기를 휘두르는 상대에게는 협상을 접고 검거 0.86).
- **맡을 사람이 없는 작업.** 20초 넘게 열린 작업을 현장의 누구도 맡을 수 없고 그 능력의 부대도 오지 않으면 `commander.needFor` 의 표로 그 능력의 부대를 요청한다. 새 임무 종류를 만들면 `needFor` 에도 넣는다. 진압 부대가 모두 물이 떨어졌고 오는 부대도 없을 때도 진압 지원을 부른다.
- **관제의 사건 순위에는 굶은 시간이 있다**(`dispatcher.priorityOf`, 최대 +1.5). 아직 아무도 닿지 않은 사건은 벨이 울린 때부터 센다. 전환 배정은 같은 사건에서 120초 안에 두 번 하지 않는다.
- **잔불 정리.** 불이 꺼졌다고 믿은 뒤 지휘관은 불났던 구역과 가까운 실내 구역에 잔불 정리(`overhaul`, 믿음 `ovh`)를 낸다. 진압 확인은 방의 85% 이상을 보았을 때만 난다(`perceive`). 되살아난 불은 잔불 정리 대원이 직접 끈다 — 보고만 하고 돌아가면 진압조가 방 일부만 보고 확인을 내 같은 일이 되풀이된다.
- **자주 도는 객체의 모양.** 구간·부대·소품·현장·구조 대상·사건은 만들 때 선택 칸을 모두 같은 순서로 `undefined` 로 비워 둔다(V8 의 숨은 클래스가 갈라지면 눈에 띄게 느려진다). 새 선택 칸은 생성 리터럴에도 넣는다: `kit.ts` 의 `PROP_BLANK`·`addCas`·`baseScene`, `hazards.ts` 의 주변 시민 리터럴, `resources.ts` 의 두 부대 리터럴, `incidents.ts`, `city.ts` 의 `generateCity`, 교대 중에 생기는 현장 칸은 `createScene`. 이 객체들에 `Object.keys`·`in` 을 쓰지 않는다. 정확성과는 무관하고 속도만의 문제다.
- **공유 버퍼와 색인.** `findRoute`·`astar` 는 모듈 버퍼를 쓰므로 재진입하면 안 되고, `astar` 의 비용 함수는 순수해야 한다(칸마다 한 번만 부른다). `BeliefStore.facts` 는 `merge` 로만 고친다(종류별 색인). `traffic.linked` 는 길 상태(`e.closed`·큰 차 불가)를 비교해 답을 다시 쓴다 — `heavyPath` 가 다른 상태를 보게 되면 비교에도 넣는다. `burned[]` 는 `tickFire` 에서만 쓰고 그때 `burnedTiles` 를 함께 센다. 연기 확산(`smokeSpread`)은 불도 연기도 없으면 건너뛴다 — 다른 연기 원천을 더하면 그 조건을 같이 본다. 매 틱 도는 배열 순회는 색인 순회로 쓴다.
- **테스트의 교대 재사용.** `tests/sim.test.ts` 의 `shiftOf(seed, d)` 는 끝난 교대를 파일 안에서 다시 쓴다. 그 Sim 을 고치는 테스트에는 쓰지 않는다.
- **속도 측정.** 공유 기계에서는 sweep 의 avg ms/shift(벽시계)가 많이 흔들린다. 전후를 번갈아 돌리고 사용자 CPU(`time`)를 함께 본다. 결과를 바꾸지 않는 변경은 시드 묶음의 `report.hash` 가 전후로 같은지로 증명한다.
- **물 칸은 어느 구역에도 들지 않는다**(`s.region = -1`). 물에 빠진 사람의 구역을 `s.regions[s.region[i]]` 로 읽으면 예외가 난다. `agents.regionNameAt`·`callSystem` 의 실종 분기처럼 맞닿은 구역으로 찾는다(극한 S28 에서 겪었다).
- **선착 대응 부대.** 구급차가 멀어 소방차가 먼저 닿으면 현장 한계 시간의 시계가 그때 시작된다. `dispatcher.priorityOf` 는 구급대원이 닿기 전까지 그 사건을 '닿지 않은 사건'으로 세고, 전환 배정 문턱에서도 그 소방차를 세지 않는다. 한 사건에 부대를 더 붙이는 규칙을 만들면 우선순위와 전환 배정이 어떻게 바뀌는지 본다.
- **숨는 정도의 상한.** 사람을 더 숨게 만드는 규칙(`concealment` 증가)은 수색 체계가 찾을 수 있는 상한(0.84)을 넘기지 않는다. 넘기면 밤에 탐지 거리가 1칸 아래로 떨어져 3차 재수색까지 못 찾고 한계 시간으로 끝난다(실제로 겪었다). 현장의 맨 가장자리로 걸어가게 하는 것도 피한다.
- **사건 하나에 걸리는 세계 규칙의 상태는 WeakMap 에.** `tickWander`·`tickMedical`·`tickCrush`·`tickLift` 는 상태를 WeakMap(대상·현장 → 상태)에 둔다. 현장·구조 대상 객체의 모양을 바꾸지 않기 위해서이고, 되감기는 Sim 을 새로 만들어 다시 돌리므로 안전하다.
- **작업 폴더 여럿이 node_modules 를 함께 쓸 때.** worktree 마다 `node_modules` 를 링크로 쓰면 의존성 캐시(`node_modules/.vite`)도 함께 쓴다. 다른 개발 서버가 캐시를 다시 만들면 이쪽 페이지가 새로고침된다. `npm run ui-check` 는 자기 캐시(`AR_VITE_CACHE`, `vite.config.ts` 의 `cacheDir`)를 쓴다.
- **측정 도구의 문구 규칙.** `scripts/metrics.ts` 는 기록 문구(지원 요청·응급실 대기·이송 출발·병원 인계·결원 운용 중단·출동 지령)와 문제 코드로 시스템을 가른다. 이 문구를 바꾸거나 새 문제 코드를 만들면 `PHRASE`·`PROBLEM_SYS` 표를 함께 고친다(`tests/causality.test.ts` 가 잡는다). 측정은 상태를 읽기만 한다 — 표본에서 src/sim 함수를 부르지 않는다.
- **탄 한 발은 한 선분.** 사격은 `damage.fireShot`(계산은 `traceShot`)으로만 쏜다: 쏜 자리(칸 가운데로 반올림하지 않은 실제 위치)에서 겨눈 점까지의 선분을 칸마다 따라가며, 지나는 창을 깨고 멈춘 자리(사람·벽·닫힌 문·엄폐 가구·끝)를 기록의 끝점으로 남긴다. 그림 선과 실제 파손이 언제나 같다(사용자 결정). 새 사격 코드는 이 함수를 쓰고 `recShot(…, end)` 에 그 끝점을 넘긴다. 명중 판정(누가 맞는가)과 그 난수 순서는 이 함수 밖에서 먼저 정한다.
- **교전 연출 기록.** 사격·섬광탄·진입·폭발·검거·테이저를 새로 만들거나 옮기면 `field/fxlog.ts` 의 `note*`/`rec*` 한 줄을 그 자리에 둔다(기존 `pushFx` 줄 바로 다음, `bulletPath` 앞). 이 함수들은 `s.fx` 에만 쓰고 난수를 부르지 않는다. 폭발을 다른 곳으로 옮기면 `noteBoom` 도 옮긴다.
- **그림·소리의 배속은 실제 배속.** 자동 감속 중에는 `runner.settings.speed` 가 15여도 1배속으로 돈다. 연출 시계·소리 규칙은 `effSpeed`(paused ? 0 : slowed ? 1 : speed)를 쓴다. 15배속 그대로를 확인할 때는 자동 감속(S)을 끄고 잰다. 첫 발·진입 예고(남은 3.4초)의 그 틱부터 1배속이 되는 것은 `runner.stepGuard` 다(결과는 바뀌지 않는다).
- **실패 기억.** 닿을 수 없어서(길 없음·불) 실패했거나 위험해서 놓은 작업은 `WorkItem.failedAt[rid]` 에 남는다. 25초(`RETRY_AFTER`) 동안 지휘관은 그 작업을 같은 대원에게 주지 않고, 그 대원도 스스로 다시 잡지 않는다(`agents.failedRecently`). 없으면 "시도 → 실패 → 재지시" 가 1초마다 되풀이된다(물이 떨어져 불에 갇힌 소방대원이 소화전으로 가려던 일, 42회). 스스로 고르는 새 행동에도 같은 기억을 둔다(예: `equipRetryAt`). 위험해서 물러날 때는 하던 작업을 `finishTask(…, 'danger')` 로 놓는다 — 그냥 preempt 하면 아무것도 남지 않아 지휘관이 3초마다 같은 지시를 냈다.
- **다친 대원의 후퇴는 끝까지.** 체력 40(`HURT_HEALTH`) 아래로 다친 대원은 대기 지점에 닿을 때까지 후퇴를 이어 가고, 무전은 상태가 바뀔 때 한 번만 남기며, 지휘관은 지시를 주지 않는다(지휘관이 자기 대원의 체력을 읽는 것은 지구력을 읽던 것과 같은 자격이다). 장비 교체(`resupply`) 중인 대원에게도 지시하지 않는다.
- **처치 왕복.** 처치를 두 번 마쳤는데도 기본 처치(tq 1)로만 보고되는 환자에게는 지휘관이 처치를 다시 내지 않는다(더 나아지게 할 수 없는 구급대원이 같은 상태 보고만 되돌려 보냈다).
- **연쇄 상한.** 연쇄 사건은 `chain.canChain(sim, 부모)` 가 참일 때만 예약한다. 막히면 아무것도 예약하지 않고 기록도 남기지 않는다. 난수는 상한과 상관없이 늘 그대로 뽑는다(상한에 걸리지 않는 교대의 결과가 바뀌지 않게).
- **기록에 남지 않는 왕복.** 대원이 같은 종류의 두 작업(탑승 D↔F, 처치 B↔D) 사이를 기록 없이 수십 번 오가는 일이 있다(극한 S49 #18 탑승 89회). 측정 도구의 REPEAT 는 기록 줄만 세서 이것을 보지 못한다.
- **무너짐의 기록.** 벽·건물을 무너뜨리는 새 규칙은 상태를 바꾸는 자리에서 `ruins.markRuin`(칸)·`recordFall`(순간)을 부른다. 무너짐은 `Fx 'collapse'`(그리지 않음 — 카메라·감속·소리용)와 `Scene.falls`(그림용)로 남는다. 고정 층의 `staticSig` 에는 `ruin` 과 치운 잔해 수가 들어가고 보강 항은 빠졌다.
- **현장 그림의 고정 층.** `staticLayer.ts` 는 타일·가구가 바뀔 때만 다시 그린다(`staticSig`). 매 프레임 바뀌는 것(문짝, 불, 사람)을 여기에 넣지 않는다. 새 타일 종류·가구를 만들면 `surfaceMap`·`paintTile`·`furniture` 에 그림을 추가한다.
- **건물 배치는 고정이 아니다.** 방의 수·위치·출입구가 사건마다 다르다. 좌표를 직접 쓰지 말고 `Plan`(`rooms`·`corridors`·`exitDoors`·`floors`)과 `s.exits`·`s.regions` 로 찾는다. 복도가 없는 건물(`corridors` 가 빈 배열)도 있다. 새 틀을 만들면 "모든 바닥에 걸어서 닿는다"는 테스트(`현장 배치의 다양성`)를 통과해야 한다.
- **가구는 실제 장애물이다(`T.FURN`).** 지나갈 수 없고, 시야는 통과하며, 엄폐물이 된다. 방을 새로 만들 때는 `builders.ts` 의 `furnish()` 를 쓴다(문 주변을 비우고 방이 끊기지 않는지 검사한다).

## 작업 방식

- 한 번에 한 작업 묶음. 끝나면 `npm run check` → 커밋 → 푸시 → `docs/ROADMAP.md` 갱신.
- 여러 에이전트가 동시에 작업할 때는 `docs/ROADMAP.md` 의 "트랙"별 파일 소유 규칙을 따른다. `types.ts` 는 추가만 하고, 기존 필드의 의미를 바꾸지 않는다.
- 여러 묶음을 따로 만들어 합칠 때는 `docs/specs/README.md` 의 파일 소유 규칙과 합치는 순서를 따른다(묶음마다 `wf/<묶음>` 브랜치, 구현 → 독립 검토 → 합치기).
- 시뮬레이션을 고친 뒤에는 `npm run sweep -- 60` 의 결과 분포와 `close reasons` 의 `timeout` 건수를 전후로 비교한다. 화면만 고쳤다면 분포가 한 건도 달라지면 안 된다.
- 특정 게임의 아트·명칭·배치를 그대로 옮기지 않는다. 장르의 방식(지도 중심 관제, 통화창, 사건 핀, 차량 아이콘)은 자유롭게 쓴다.
