# AUTONOMOUS RESPONSE — 작업 안내서

AI 긴급구조 조직(신고 접수 · 분석 · 배정 · 현장 지휘 · 대원)이 스스로 일하는 것을 **관찰만 하는** 2D 시뮬레이션.
TypeScript + React + Vite, 그림은 Canvas 2D. 서버·외부 API·LLM 호출 없음. 화면 글자와 주석은 한국어.

**이어받은 세션은 이 순서로 시작한다.**

1. 이 파일을 끝까지 읽는다.
2. `docs/ROADMAP.md` 의 "지금 상태"와 "진행 중"을 보고 다음 작업 묶음을 고른다. 앞 세션이 묶음 도중에 멈췄으면 `docs/handover/README.md` 에 멈춘 자리와 이어받는 법이 있다(워크플로 대본은 `docs/specs/workflows/`).
3. `npm install` 후 `npm run check` 가 통과하는지 확인한다(통과하지 않으면 그것부터 고친다).
4. 작업 → `npm run check` → 커밋 → 푸시. 작업 묶음을 끝낼 때마다 `docs/ROADMAP.md` 를 갱신한다.

사용자용 설명(조작법, 기능 목록, 테스트 결과)은 `README.md` 에 있다.

## 명령

| 명령 | 용도 |
|---|---|
| `npm run dev` | 개발 서버 (`http://localhost:5173`, `?seed=S7&diff=hard` 로 조건 고정) |
| `npm run check` | **커밋 전 관문**: 타입 검사 + 테스트 + 시드 40개 헤드리스 검증 (4분쯤 — R1 뒤로 대원이 늘어 테스트만 3분 남짓 걸린다. 같은 기계에서 다른 작업이 함께 돌면 4분 30초) |
| `npm test` | Vitest 660개(+건너뜀 1), 파일 19개(`injuries` 159개 — 부상과 사망: 부상 기록·화면·구조 대상의 부상·대원의 부상 모델·대원 후송과 가벼운 일·열 탈진·잔해 추락·몸싸움·용의자의 부상과 처치·판정과 보고서·이름표와 알약의 겹침 / X6 진행 중 — `catastrophe` 92개: 위험 상태 계산·조짐(sign·ops 사실)·실제 붕괴·폭발·전소·AI 의 대응(철수·외부 방어·작업 문)·사건의 끝(잔해 수색·외부 확인 종료)·판정·보고서 / R2 준비 — `methods` 44개: 방법 표와 고르는 틀 / R3 준비 — `doctrine` 18개: 교본 틀의 정보 격리·순수 함수·표 모양 / I2 준비 — `persistence` 39개: 이어받은 상태의 검증·재현성·이어받지 않은 교대는 그대로·대원의 결장·성장·예비 인력 / N8 준비 — `kinds` 18개: 유형 자료(TYPE_DEFS·likRow)·정보 격리 글자·T.LEDGE·빈 등록 자리·새 부대의 틀 / N9 준비 — `kinds2` 26개: 군중·제독·새 장소 종류의 자료형과 빈 등록 자리·새 부대 넷의 틀·덧붙인 장소 다섯): `sim`(재현성, 교대 완주, 정보 격리, 난이도, 전술, 유형별 현장, 지도, 생활 사건, 추격전) · `ext`(확장 지점) · `crime` · `major` · `disaster` · `destruction` · `traffic` · `causality`(측정 도구: 결과 불변·손 계산·문구 규칙·멈춤 감지기 / I1-b 준비: 기록만 잇기) · `combatfx`(교전 연출: 기록 꼬리표·소리 상한·결과 불변) · `loops`(반복 고리·실패 기억·연쇄 상한) · `legibility`(무너짐 기록·시점 규칙·그림 함수) · `crews`(편성표·능력과 장비의 불변 조건·장비 자격·환자 자리·헬기 세 종류·상공의 일·공기와 고장·화면이 읽기만 하는가 — 70개, 40초쯤). 한 묶음만 볼 때는 `npx vitest run tests/crime.test.ts` |
| `npm run sweep -- 100` | 시드 100개 결과 분포. `--diff hard`, `--diff 4,4,4,2,3,3`(빈도·심각도·용의자·장비·신고·부대, 일곱째 숫자를 붙이면 교통), `-v`, `--json`, `--check` |
| `npm run sweep -- 1 --log S7` | 한 교대의 전체 이벤트 기록과 종료 보고서 (동작 확인에 가장 유용). `--metrics` 를 붙이면 사건마다 가장 긴 원인 사슬과 확산 길 |
| `npm run sweep -- 40 --metrics` | 측정 도구(I1-a, `scripts/metrics.ts`): 기본 출력의 지표 아홉 줄(`chain` 연쇄 깊이 · `systems` 시스템 간 영향 · `replan` 재계획 · `alt` 대체 방법 · `actions` 행동 다양성 · `contention` 자원 경쟁 · `stall` 멈춘 시간 · `variety` 결과 다양성 · `consistency` 기록 일치)에 더해 시나리오별 표와 모든 후보(`STALL`·`FORGOT`·`REPEAT`·`SPREAD`·`UNLOC`). `--no-metrics` 는 표본을 끈다(속도 비교용). 관문(`--check`)은 연쇄 깊이 ≤ 4·교대당 연쇄 ≤ 8·기록 일치 C1~C5 = 0·계산 오류 0 을 늘, 교착 후보·잊힌 사건 0 을 보통 기본 조건에서 건다 |
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
   - 진실을 읽어도 되는 곳: `field/hazards.ts`(세계 규칙), `field/executor.ts`(행동의 효과 적용), `field/agents.ts` 의 `perceive`(시야 안 관찰), `debrief.ts`(판정), `incidents.ts`, `field/fxlog.ts`(기록 전용 — 그림·소리에 쓸 꼬리표만 남기고 판단하지 않는다), `field/rules/air.ts`(상공 헬기의 관측과 실행 — 세계 규칙).
   - 진실을 읽으면 안 되는 곳: `field/commander.ts`, `field/brain.ts` 의 판단부, `dispatch/*`, `field/airDecide.ts`(상공 헬기의 판단 — 좁힌 입력 `AirView` 만 받는다. 작업판을 무전 없이 읽는 것은 의도한 예외다).
   - 조직이 아는 것(편성·역할·장비·알려진 고장·남은 섬광탄·공기·연료)은 판단에 써도 된다. **숨은 고장**(`KitItem.fault` 인데 `faultKnown` 이 아님)은 진실이다 — 판단 파일은 `.fault` 를 읽지 않고 `hasKit`·`toolFor`·`capableOf` 를 쓴다(테스트가 소스를 본다).
   - 부상(H1): 진실 쪽은 `field/injury.ts`(피해 한 길 `hurt*` · `needsHospital`)와 `field/rules/injury.ts`(매 틱 피해·출혈). 판단 쪽 `field/orders/injury.ts`·`commander.ts` 는 **남의** 체력·출혈·부상 기록·사망·후송을 읽지 않고 믿음 술어 `mateNeedsHospital`·`hosNeedsCare` 를 쓴다(명부에서는 `unitId`·`dept`·`name`·`status` 만 — 테스트가 소스를 본다). 대원이 자기 몸을 읽는 것(`brain.ts` 의 후퇴)은 된다.
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
src/sim/resources.ts         부대 표(UNIT_DEFS: 네 분야 22팀, KIND: 종류별 능력·환자 자리·예비 공기통·연료), 대원 명부(createRoster — 인원과 역할은 crews.ts 의 STAFF), 차량 이동·우회, 헬기·구조정의 길 밖 이동과 헬기의 날씨·연료(grounded·airRtb), 병원 이송(startTransport 가 고른 병원을 돌려준다, 응급실 인계 대기), 인근 도시 지원 부대 생성(createAidUnit — 최소 인원)
src/sim/crews.ts             편성·역할·개인 장비: STAFF(종류별 자리 순서와 최소 인원)·ROLES(36가지: 능력 식·기본 장비·먼저 맡는 일·내리지 않는 자리)·KITS(36가지), 장비를 읽는 네 가지 함수(배정 hasKit·toolFor·capableOf / 화면도 부르는 물리 kitLive / 효과 kitWorks·toolUse / 수량 kitUses·useKit), fieldCrew·seatsOf·armorOf·blastFactor·medLevelOf·airShort, 헬기(AIR_KIND·isHovering·heliPad). types·util·events 만 import 한다(resources 가 이 파일을 import 한다)
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
src/sim/field/agents.ts      makeAgent·briefFacts, perceive(지상 / 공중 관측 a.aloft), visionOf·detectRadius(순수 함수 — 화면도 부른다), learn, 무전(transmit/flushOutbox), fitFor(장비 자격·공기·역할 선호), workLabel
src/sim/field/brain.ts       대원 목표 선택(Utility)
src/sim/field/executor.ts    임무별 실행(case 문), 이동, 장애물 발견·재계획
src/sim/field/commander.ts   지휘관: 믿음 → 작업 목록(want), 배정, 지원 요청, 진입 계획(planEntry), 종료 판단
src/sim/field/sceneManager.ts 현장 틱, 부대 도착(내리는 자리만 내린다 / 상공에 머무는 헬기는 s.airAt 만)·철수, 지휘권 이양, agentHealth(장비 방호·공기 소모)
src/sim/field/rules/air.ts   상공 헬기의 실행(세계 규칙 — 진실을 읽는다): 부대마다 AirOp, 공중 관측·보고, 탐조등, 호이스트 인양, 물 투하, 상공 연료, 한가하면 복귀, 헬기만 왔던 현장의 마무리(tellDispatch·allAboard). 균형 상수 AIR
src/sim/field/airDecide.ts   상공 헬기의 판단(믿음만 — 좁힌 입력 AirView): 호이스트 > 물 투하 > 살피기, 한가한가
src/sim/field/injury.ts      부상과 사망의 공통 모델(H1, 잎 모듈 — types·events·util·crews 만 import): 원인 InjuryCause·중증도 bandOf·기록 Injury, 피해 한 길 hurtCas·hurtResponder·hurtHostile(방호 protection·문턱·출혈), 처치 treatEffect, 병원 판단(진실 needsHospital / 믿음 mateNeedsHospital·hosNeedsCare), 가벼운 일 LIGHT_WORK·canDeploy, 결장 outShifts, 목적별 난수 injuryRng. 균형 상수 MATE_RETREAT_BLEED·HOSTILE_LEFT 등
src/sim/field/rules/injury.ts 매 틱의 부상 규칙(세계 규칙): 걷던 사람의 쓰러짐(WALK_STOP), 대원의 열 탈진·잔해 바닥 추락, 용의자의 불·연기·출혈 / field/orders/injury.ts: 다친 대원·용의자의 처치와 후송 지시(treatMate·treatSuspect, 20초 규칙, 다수 사상자 다시 세기 — 믿음만)
src/view/                    runner(틱·되감기·저장), camera(자동 카메라·현장 확대), renderCity, renderScene(그리는 순서 조립), icons, audio(합성음)
src/sim/field/fxlog.ts       교전 연출 기록(사격·섬광탄·진입·폭발·검거·근접): s.fx 의 꼬리표(Fx.c)에만 쓰고 난수를 부르지 않는다 — 결과는 바뀌지 않는다
src/view/scene/fxBook.ts     연출 시계(최대 2배, 일시정지면 멈춤), 처음 보는 기록 받아들이기, 같은 틱 안의 순서 지연, 합성 항목, 남는 그림, 흔들림, 화면 막
src/view/scene/combat.ts     교전 그림(총구 섬광·예광선·탄착, 섬광탄, 폭발, 진입 3-2-1·문짝, 겨누는 선·말풍선, 수갑). 새 효과 종류를 그리면 FX_DRAWN, 결정적 순간이면 DECISIVE 에 더한다
src/view/audioCombat.ts      교전 소리(planCues 는 순수 함수: 배속별 묶음, 토큰 통, 동시 발음 상한 / CombatVoice 음색)
src/view/city/combatPin.ts   지도의 교전 핀(사격 별·폭발 고리·교전 중 점선 테)
src/sim/field/ruins.ts       무너짐 기록(markRuin: Scene.ruin 칸의 처음 모습·무너진 모습, recordFall: Scene.falls·Fx 'collapse'). 기록 전용 — 결과는 바뀌지 않는다
src/view/hazardState.ts      현장·지도·카드가 함께 쓰는 상태 읽기(ruinInfo·ruinSeen·pinIcon·가스·인질 상태, 시점 규칙)
src/view/triage.ts           중증도 색 TRIAGE(초록·노랑·빨강·검정)·덮개 규칙(casSheet·respSheet·hostileSheet — 확인된 사망부터, AI 시점은 믿음)·정보창 내용(casInfo·hostileInfo)·보고서 글(reportHurtText). src/ui/PersonCard.tsx 가 구조 대상·용의자 정보창(오른쪽 칸의 대원 정보 자리)
src/view/scene/ruins.ts      무너진 구역의 고정 층 그림(내려앉은 음영·잔해 더미·쓰러진 벽·금·경계) / scene/hazardFx.ts: 위험 범위·무너지는 순간·먼지 충격 고리·되살아난 불·인질 표지
src/view/city/ruinLayer.ts   지도의 무너진 지붕·먼지·배지(부대 표식 뒤에 그린다)·끝난 붕괴 기호 / src/ui/HazardStrip.tsx: 사건 카드의 상태 칩
src/view/marks.ts            부대 열네 종류·시설·상태·대원 역할 묶음 16가지(ROLE_MARK)·장비 묶음(KIT_GROUP_MARK)의 그림 기호(24×24 경로 문자열). 지도(캔버스 Path2D)와 패널(SVG)이 같은 것을 쓴다. 지도와 목록에 글자 표식을 쓰지 않는다
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
src/ui/                      App, Viewport(캔버스·입력), panels(모든 패널), CallDock(오른쪽 칸 맨 위의 접히는 통화창, P 키, 접힘 기억 ar.call.v1), Mark(<Mark>·<Token>·<FacilityBadge>·<RoleDot> 부대 목록의 역할 점), MapLegend(지도 범례), TrafficChip(상단 교통 요약), DisasterBanner(특보 띠), styles.css
scripts/sweep.ts             헤드리스 실행기 (균형·교착 확인의 기본 도구)
scripts/injurystats.ts       sweep 의 `injuries:` 줄과 --json 의 injuries 칸: 다친·쓰러진·순직 대원, 다친·숨진 용의자(총에 맞아 쓰러진 용의자의 사망 비율·즉사), 잔해 추락, 운용 중단, 가벼운 일 복귀, 숨진 구조 대상의 원인 (끝난 교대를 읽기만 한다)
scripts/ui-check.cjs         화면 자동 검사 (+ ui-check-ref.ts: 같은 시드·난이도의 헤드리스 기록 해시). 화면 쪽 관찰 고리는 App.tsx 의 window.__ar.snap()·combat()·fxStep() (개발 서버에서만, 읽기 전용)
scripts/combatshots.cjs      교전 장면 찍기(장면 틱에 멈추고 연출 시계만 넘기며 찍는다)
tests/                       sim.test.ts(기본) + 묶음별 ext·crime·major·disaster·destruction·traffic·causality·combatfx·loops·legibility·crews (fakeCanvas.ts: 그림 시험용 가짜 캔버스)
```

한 사건의 흐름: `incidents.ts` 가 현장을 만든다 → `callSystem` 통화 → `analyst` 평가 → `dispatcher` 출동 → `resources` 이동 → `sceneManager.unitArrived` → 지휘관 `commander.ts` 가 작업 목록 생성 → 대원 `brain.ts` 가 목표 선택 → `executor.ts` 가 실행하며 현장 상태 변경 → `closeIncident` → `debrief.evaluate`.

## 자주 하는 확장

| 하고 싶은 것 | 고칠 곳 |
|---|---|
| 균형 조정 | `difficulty.ts` 의 표. 그 밖의 상수는 `builders.ts`(현장 내용), `hazards.ts`(확산·악화), `executor.ts`(작업 속도) |
| 새 임무 종류 | `types.ts` `WorkKind` → `agents.ts` `workLabel`·`fitFor`(안쪽 `fitBase` — 여기서 장비 자격을 정하고, 오는 부대 쪽 `crews.capableOf` 도 함께) → `executor.ts` case → `commander.ts` 에서 `want()`, 맡을 사람이 없을 때 부를 능력은 `needFor` |
| 새 문제 코드 | `types.ts` `ProblemCode` → `debrief.ts` `PROBLEM_LABEL`·`order`·문장 템플릿 |
| 새 사건 유형 | `types.ts` `IncidentType` → `builders.ts`(+`buildScene`), `cityPlan.ts` `INCIDENT_PLACES`(어떤 건물에서 나는가), `incidents.ts`(가중치·신고 지연), `callSystem.ts`(`NATURE_TEXT`·`NATURE_LIK` 에 열 추가·`natureFor`·질문·`TOPIC_VALUE`), `analyst.ts`(`TYPES` 순서·위험도·필요 자원), `commander.ts`(수색 대상 유형 목록·규칙), `agents.ts` `fitFor`(건물 안에 누가 들어가는가), `sceneManager.ts` `LIMIT`, `debrief.ts` `RESP_LIMIT`, `util.ts` `TYPE_NAME`, `view/renderCity.ts` `TYPE_COLOR`·`RESP_LIMIT`, `view/icons.ts`, `ui/panels.tsx` 확률 목록. 가장 최근 예: `water` (`git log --grep F1` 의 커밋), 그 전은 `collapse`, `hazmat` (커밋 78ad889). 유형을 늘리지 않고 변형만 더할 때는 `truth.variant`·`Scene.variant` 를 쓴다(예: 교통사고의 `bus`) **N8 단계 1 뒤로는 `docs/specs/N8-incident-kinds.md` §5.2 의 절차가 정본이다** — 유형 표의 대부분(한계 시간·대응 기준·질문·가중·이름·색)은 `incidentTypes.ts` `TYPE_DEFS` 와 `view/typeStyle.ts` 한 곳으로 모였다 |
| 새 타일·가구·소품 | `types.ts` `T`·`DECOR`·`PropKind` → `grid.ts`(`staticPass`·`isIndoor`·`los`) → 그림은 `view/scene/staticLayer.ts`(고정된 것) 또는 `view/renderScene.ts` 의 소품 분기 + `view/scene/sprites.ts`(움직이거나 상태가 바뀌는 것) |
| 지도 바꾸기 | 전부 `cityPlan.ts` 에서 한다. 교차로를 옮기려면 `NODES`, 길을 내거나 없애려면 `ROADS`(이웃한 두 교차로 사이가 한 구간이 된다), 동네의 건물 구성은 `DISTRICTS` 의 `mix`·`density`, 하나뿐인 건물은 `LANDMARKS`(가운데 좌표·크기·각도), 사건이 나는 곳은 `INCIDENT_PLACES`(건물 종류 전체의 몫). 새 건물 종류는 `types.ts` `PlaceKind` → `cityPlan.ts` `KIND_NAME`·`KIND_DISTRICT`·`KIND_SCENE` → 길가에 채울 종류면 `city.ts` `DIM`(크기) → `view/city/places.ts` `paintRoof`(없으면 평지붕). 도로를 고친 뒤에는 테스트(`건물마다 정해진 도시`)가 교차·단절·건물 겹침을 잡는다. 지도를 바꾸면 모든 결과가 바뀌므로 `sweep` 으로 다시 잰다 |
| 새 부대 종류 | `types.ts` `UnitKind` → `resources.ts` `KIND`(부서·능력·장비, 환자 자리 `seats`·예비 공기통 `spareAir`, 헬기면 `fuelMax`·`hoist`·`bucketMax`)·`UNIT_DEFS`(분야·소속 시설·편성 단계 — **새 줄은 끝에**: 처음 20줄의 순서가 옛 대원의 능력 난수 순서다)·`UNIT_KIND_NAME`·큰 차면 `HEAVY` → `crews.ts` `STAFF`(인원과 역할), 헬기면 `AIR_KIND`·`isHovering`·`dispatcher.airFit` → `view/marks.ts` `UNIT_MARK`(지도·목록의 그림 기호)·`ui/MapLegend.tsx` → `view/scene/sprites.ts` `VEH_SIZE`·`drawEmergency`·`responderLook`. 소속 시설이 새로 필요하면 `cityPlan.ts` `LANDMARKS` 에 `facility` 를 붙여 넣는다. 끝나면 `tests/crews.test.ts` 의 "능력과 장비가 어긋나지 않는다"가 통과해야 한다 |
| 부대 편성(인원·역할) 바꾸기 | `crews.ts` `STAFF`(자리 순서 = `crew` 순서, 0번이 부대장, `minDrop` = 최소 인원에서 뺄 자리 — 부대 규모 손잡이 1·2 와 인근 도시 지원이 최소 인원). 셋째 자리부터는 `roster-v2:<호출부호>:<자리>` 흐름이고 이름은 `EXTRA_NAMES` 를 차례로 쓰므로 **새 자리는 끝에 붙인다**. 능력(`caps`)을 올리거나 자리를 빼면 그 일을 할 장비를 든 내리는 대원이 남는지 본다(같은 테스트) |
| 새 역할 | `types.ts` `RoleId` → `crews.ts` `ROLES`(이름·그림 묶음 `group`·skills 식·기본 장비·`prefer`·`stays`·`exp`) → 그림 `sprites.responderLook`. 새 그림 묶음이면 `RoleGroup` + `view/marks.ts` `ROLE_MARK` + 범례 |
| 새 개인 장비 | `types.ts` `KitId` → `crews.ts` `KITS`(이름·묶음·tool·med·armor·`faultable`) → 역할의 기본 장비 **끝에** 붙인다(장비 순서가 고장 추첨 순서다) → 효과는 그 장비를 보는 자리 하나에서 `kitWorks`(숨은 고장이 이때 드러난다), 배정은 `hasKit`·`capableOf`, 화면도 부르는 함수(`visionOf`·`detectRadius`)에서는 `kitLive` → 손에 든 그림 `renderScene.agentPose` + `sprites.drawPerson` 의 `Item` → 대원 정보창은 저절로(`KITS[id].name`) |
| 새 헬기·공중 임무 | `UnitKind` + `crews.ts` `STAFF`·`AIR_KIND`·`isHovering`(현장 상공에 머무는가) + `dispatcher.ts` `airFit`(관제가 그 헬기를 보내는 수요) → 상공의 실행은 `field/rules/air.ts`(진실을 읽는다), 판단은 `field/airDecide.ts`(믿음만) → 지휘관의 작업은 `commander.ts` 에서 `want('hoist' \| 'airDrop')` 처럼 지상 대원의 `fitFor` 가 0 인 작업으로 내고, 그 일을 할 헬기가 상공에 없으면 `cancel` 한다 → 그림은 `renderScene` 의 "상공의 헬기" 블록과 `airOpLabel` |
| 사람에게 피해를 주는 새 규칙 | 체력을 직접 깎지 않는다 — `injury.hurtCas`·`hurtResponder`·`hurtHostile` 을 원인(`InjuryCause`)과 함께 부르고, 그 자리가 남긴 기록 id 를 `{ ev }` 로 넘긴다(대원의 RESPONDER_HURT·RESPONDER_KILLED 와 구조 대상의 사망이 그 기록을 원인으로 잇는다). 피해 문구는 그 자리가 남기고 `hurt*` 는 남기지 않는다. 확률은 새 목적의 `injuryRng(sim, s, '<목적>')`, 하한이 걸리면 `hurtCasTo`. 매 틱 피해는 `{ tick: true }`(문턱·출혈 없음) |
| 새 부상 원인 | `types.ts` `InjuryCause`(끝에 새 줄) → `injury.ts` `CAUSE_NAME`·`BLEED_PER_DMG`·`protection` 의 갈래 → 처음 상태로 생기면 `initInjuries` 의 표 |
| 부상·사망의 균형 | 설계서 H1 §9.3 의 차례: `injury.ts` `MATE_RETREAT_BLEED`·`BLEED_PER_DMG` → `difficulty.ts` `injuryMul`(보통 1 — 위쪽 두 칸도 1)·문턱 → `HOSTILE_LEFT`·`HOSTILE_BLEED` → `hazards.TRAP_R`·`executor.MISHAP` → `rules/injury.ts` `HEAT_*`·`FALL_*`. `HOSPITAL_BLEED` 는 `MATE_RETREAT_BLEED` 에 묶여 함께 움직인다. 운용 중단 조건과 `SELF_HARM = 0` 은 사용자 결정이라 손잡이가 아니다 |
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
- **신고 키워드 표.** N8 단계 1 뒤로 가능도는 **유형 이름을 열쇠로 하는 객체**(`LikMap` — `callSystem.NATURE_LIK` 의 줄과 시나리오 `lik`)이고, 배열로 쓸 때는 `incidentTypes.likRow(map)` 이 `TYPE_ORDER` 순서로 펴 준다(빠진 칸은 `LIK_FLOOR`). 유형의 순서·이름·한계 시간·대응 기준·질문 문구는 `src/sim/incidentTypes.ts` 의 `TYPE_ORDER`·`TYPE_DEFS` 한 곳이다(예전처럼 "열 수 8 = 유형 수, 열 순서 = `analyst.TYPES`"를 손으로 맞추지 않는다 — `tests/kinds.test.ts` 가 본다). `likRow` 는 객체마다 배열을 캐시하므로 표를 실행 중에 고치지 않는다.
- **위험한 건물 안에는 공기호흡기를 멘 대원만 들어간다.** `agents.ts` `fitFor` 의 `fireRisk` 가 화재·가스 누출·붕괴 현장의 실내 임무(수색·구출·이송·이송 보조)를 공기호흡기(`scba`)를 멘 대원으로 제한한다(R1 전에는 부서가 소방인가로 갈랐다). 공기호흡기를 멘 대원이 있는 부대가 현장에도 오는 중에도 없으면 지휘관이 지원을 요청한다. "실내"는 칸 종류가 아니라 **구역의 `indoor`** 로 본다(크레인 붕괴의 골조처럼 바닥 칸인데 구역이 실내인 곳이 있다). 임무를 맡은 뒤 그 사람이 건물 안에 있음을 알게 되면 문 앞에서 내려놓는다(`executor.noAirEntry`). 새 유형을 만들면 이 목록에 넣을지 정한다.
- **계단.** 2층 건물은 두 층을 같은 격자에 나란히 놓고 `Scene.stairTo` 로 잇는다. 경로의 다음 칸이 이웃이 아닐 수 있으므로, 경로를 따라 걷는 코드(`executor.moveTo`, `hazards.tickCasualties`)는 계단 건너뛰기를 따로 처리한다. 경로를 걷는 개체를 새로 만들면 똑같이 처리한다. 거리(`dist`)로 "가깝다"를 판단하는 코드는 두 층이 벽과 빈 공간(`T.VOID`)으로 4칸 이상 떨어져 있다는 데 기대고 있다.
- **교대 중에 부대가 늘어난다.** 인근 도시 지원 부대(`u.aid`)는 `sim.units`·`sim.responders` 끝에 붙는다. 소속 시설이 없으므로 `facilities.find(...)` 결과가 없을 수 있다. 임무 뒤에는 `oos` 가 되어 다시 쓰이지 않는다.
- **소품은 길을 막는다.** 문과 잔해가 아닌 소품(밸브·균열부·차량 등)은 `agents.agentCost` 에서 지나갈 수 없는 칸이다. 통로나 문 앞에 놓으면 방이 끊겨 수색이 끝나지 않는다(가스 누출에서 실제로 겪었다). 방 안의 소품은 가구가 있던 자리에 놓거나, 놓은 뒤에도 모든 바닥에 닿는지 확인한다.
- **물속의 사람.** `Casualty.inWater` 인 사람은 매 틱 떠내려가고(`hazards.tickWater`) 걸어서 닿을 수 없다. 건져 내는 임무는 `waterRescue` 하나뿐이고(물가에서 3.6칸 안), 처치·이송은 `inWater` 가 풀린 뒤에만 한다. 지휘관은 믿음 속 위치의 칸이 `T.WATER` 일 때 이 임무를 낸다.
- **사건 도중 구조 대상이 늘어난다.** 가스 누출 현장의 주변 시민(`bystander2`)은 `s.casualties` 끝에 붙는다. 구조 대상 수를 처음에 세어 두고 쓰는 코드를 만들지 않는다.
- **쉬는 대원의 왕복.** 휴식 점수가 다른 임무 점수와 비슷하면 쉬다 일하다를 되풀이한다. `brain.ts` 는 체력 40까지 휴식을 붙잡아 두고, 탈진 기록은 45초에 한 번만 남긴다.
- **변형별 한계 시간.** 다수 사상자 사고(`variant === 'bus'`)는 `LIMIT` 에 170초를 더한다. 사람이 많은 변형을 새로 만들면 한계 시간도 함께 본다.
- **도시는 고정이고 한 번만 만든다.** `generateCity` 는 설계도로 만든 지도를 모듈에 넣어 두고, 교대마다 도로 상태(`edges`)만 복사해 준다. `city.places`·`nodes` 를 시뮬레이션 중에 고치면 다음 교대에도 남는다. 고치지 않는다.
- **격자가 아니다.** 교차로에는 행·열이 없다(`RoadNode.c`·`r` 은 0). 교차로는 `key`(설계도의 이름표)로, 도로는 `e.name`·`e.cls`·`e.seq` 로 다룬다. 건물은 돌려 놓여 있으므로(`Place.rot`) 가운데는 `x + w/2, y + h/2` 이고, 점이 안에 있는지는 `placeAt` 처럼 돌려서 본다.
- **헬기와 구조정.** `u.air`·`u.sea` 는 도로 경로(`route`)가 없다. 위치는 `tickUnits` 의 길 밖 이동이 직접 옮긴다. 길가 주차(`curb`)·교차로 스냅을 적용하지 않는다. 구조정은 바닷가(`resources.coastal`)의 수난 사고에만 배정된다(`dispatcher.pickUnit`). **헬기의 일은 `dispatcher.airFit` 이 정한다**: 경찰 헬기는 수색 수요(추격전·무장·실종, 수난·붕괴·화재는 절반)만, 소방 헬기는 수색·구조만, 의료 헬기는 낮의 구급 수요만 맡고, 안개(모두)·밤(의료 헬기)·태풍 충격 단계·연료 부족이면 뜨지 않는다. `u.air` 만 보고 헬기를 보내거나 세면 경찰 헬기가 환자를 싣거나 산불을 늦춘다. 의료 헬기가 없는 편성(부대 규모 1·2)에서만 소방 헬기가 예전처럼 구급도 맡는다(`resources.HELI_EMS_ALONE`).
- **환자를 싣는 부대, 환자 자리.** 구급차만이 아니다. 자리는 `crews.seatsOf(u)` 하나로 본다(구급차 2, 소방·의료 헬기 1, 그 밖 0): `agents.canCarryPatients`·지휘관의 탑승 대기열·출발 조건·실행기 `load`·호이스트(`air.ts`)가 모두 그것을 읽는다. 숫자 2 를 다시 쓰지 않는다(예전에는 헬기에 둘이 탔다). `dept === 'ems'` 로만 가리면 헬기가 구조한 사람이 구급차를 기다리다 한계 시간까지 간다(실제로 겪었다). 위중 환자는 자리가 남은 헬기에 먼저, 그 밖의 환자는 지상 구급차에 먼저 싣는다. 출발 기록의 병원 이름은 `startTransport` 가 돌려준 병원이다(측정 도구의 C5 관문).
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
- **맡을 사람이 없는 작업.** 20초 넘게 열린 작업을 현장의 누구도 맡을 수 없고 그 능력의 부대도 오지 않으면 `commander.needFor` 의 표로 그 능력의 부대를 요청한다. 새 임무 종류를 만들면 `needFor` 에도 넣는다. 진압 부대가 모두 물이 떨어졌고 오는 부대도 없을 때도 진압 지원을 부른다. "맡을 수 있는가"는 `commander.anyCapable` 한 함수다: 현장 쪽은 `fitFor > 0`(장비 자격·공기), 오는 쪽은 능력(`caps`)에 더해 그 일을 할 장비를 든 내리는 대원이 있는가(`crews.capableOf`).
- **관제의 사건 순위에는 굶은 시간이 있다**(`dispatcher.priorityOf`, 최대 +1.5). 아직 아무도 닿지 않은 사건은 벨이 울린 때부터 센다. 전환 배정은 같은 사건에서 120초 안에 두 번 하지 않는다.
- **잔불 정리.** 불이 꺼졌다고 믿은 뒤 지휘관은 불났던 구역과 가까운 실내 구역에 잔불 정리(`overhaul`, 믿음 `ovh`)를 낸다. 진압 확인은 방의 85% 이상을 보았을 때만 난다(`perceive`). 되살아난 불은 잔불 정리 대원이 직접 끈다 — 보고만 하고 돌아가면 진압조가 방 일부만 보고 확인을 내 같은 일이 되풀이된다.
- **자주 도는 객체의 모양.** 구간·부대·소품·현장·구조 대상·사건은 만들 때 선택 칸을 모두 같은 순서로 `undefined` 로 비워 둔다(V8 의 숨은 클래스가 갈라지면 눈에 띄게 느려진다). 새 선택 칸은 생성 리터럴에도 넣는다: `kit.ts` 의 `PROP_BLANK`·`addCas`·`baseScene`, `hazards.ts` 의 주변 시민 리터럴, `resources.ts` 의 두 부대 리터럴(R1 의 칸은 `fitOf` 한 함수로 같은 순서로 펼친다)과 두 대원 리터럴(`role`·`kit`), `agents.ts` 의 `makeAgent`(현장 대원), `incidents.ts`, `city.ts` 의 `generateCity`, 교대 중에 생기는 현장 칸은 `createScene`. 이 객체들에 `Object.keys`·`in` 을 쓰지 않는다. 정확성과는 무관하고 속도만의 문제다.
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
- **내리지 않는 자리.** 조종사·정장·관측관(`ROLES[…].stays`)은 `FieldAgent` 가 되지 않는다. `crewReady`·`crewNames`·관제의 감점·평균 체력은 `crews.fieldCrew(u)` 로 센다(`u.crew.length` 로 세면 헬기·구조정이 늘 결원이다). 0번 자리(부대장)는 내리는 자리로 둔다(출동 준비 시간·첫 지휘관). 경찰 헬기처럼 전원이 내리지 않는 부대는 `fieldCrew` 가 `u.crew` 그 배열을 돌려준다(고치지 않는다).
- **옛 대원 40명의 능력은 난수 순서에 묶여 있다.** `UNIT_DEFS` 처음 20줄의 0·1번 자리는 `roster-v1` 흐름에서 줄 순서 × 두 명, 한 명당 6번을 뽑는다(편성되지 않아도 뽑는다). 줄을 끼워 넣거나 뽑는 횟수를 바꾸면 모든 대원이 달라진다. 그 밖의 자리는 자리마다 따로인 `roster-v2:<호출부호>:<자리>` 흐름, 이름 첨자는 표준 표의 자리로 고정이다(부대 규모와 상관없이 같은 이름 = 같은 사람).
- **능력(`caps`)과 장비는 함께 고친다.** 관제 수요는 부대 수 단위 그대로이고, 관제는 능력이 기준을 넘는 부대에 그 일을 할 장비를 든 대원이 있다고 믿는다. `caps` 를 올리거나 최소 인원에서 자리를 빼면 테스트 "능력과 장비가 어긋나지 않는다"가 잡는다. 진압은 관창(`hose`)을 든 사람만 한다 — 펌프차의 분사 인원은 둘, 최소 인원(부대 규모 1·2, 지원 부대)에서는 하나다.
- **장비를 읽는 방법은 네 가지다.** 배정·계획·관제는 `hasKit`·`toolFor`·`capableOf`(숨은 고장을 모른다), 효과를 주는 자리는 `kitWorks`·`toolUse`(숨은 고장이 이때 드러나 `EQUIP_FAIL` 이 남는다 — 장비마다 드러나는 자리는 한 곳), 화면도 부르는 물리(`visionOf`·`detectRadius`)는 `kitLive`(효과만, 드러내지 않는다), 수량은 `kitUses`·`useKit`. 효과에서 `hasKit` 만 보면 숨은 고장이 끝내 드러나지 않고, 배정에서 `kitWorks` 를 부르면 쓰지도 않은 장비의 고장이 드러나며, 표현 계층이 부르는 함수에서 드러내면 그림을 그리는 것만으로 `sim.events`·`logHash` 가 바뀌어 헤드리스와 브라우저·되감기 전후가 갈라진다. `src/view`·`src/ui` 에는 주석에도 `kitWorks`·`toolUse`·`useKit` 을 쓰지 않는다(테스트가 줄을 글자로 훑는다).
- **섬광탄·테이저·공기는 사람 몫이다.** 쓸 때는 `useKit`(섬광탄이면 부대의 `u.flashbangs` 도 함께 준다 — 그 값은 사람 몫의 합이다). 부대 값을 직접 줄이지 않는다. 테이저의 대기 시간은 `a.taserAt` 이다(`a.cooldown` 은 봉쇄·협상·교전에서만 준다 — 다른 임무의 대기 시간을 거기 얹지 않는다).
- **공기 문턱은 `crews.airShort` 한 곳.** 공기가 45초(`AIR_MIN`) 아래인 대원은 위험한 건물 실내 일과 진압·잔불 정리를 새로 맡지 않는다. 현장 쪽(`fitFor`)과 오는 부대 쪽(`capableOf`)이 같은 함수를 쓴다 — 한쪽에만 숫자를 쓰면 지휘관이 "할 수 있는 부대가 온다"고 믿는데 닿은 대원이 일을 맡지 못한다. 그 부대에 예비 공기통이 남아 있으면 "바꾸고 와서 맡을 사람"으로 센다(`fitFor(…, afterSwap = true)` — 빼면 관창수가 통을 바꾸러 나간 8초 사이에 진압 부대를 더 부른다). 빈 통으로 연기 속에 있으면 방화복 대원도 물러난다(`brain.dangerScore`).
- **점수가 비슷한 두 후보는 오간다 — 끝까지 해야 하는 일은 붙잡는다.** 공기통 교체(0.9~0.95)는 예비 펌프 교체(0.84)·휴식·눈앞의 일과 점수가 비슷해 "교체하러 갑니다"를 한 사건에서 다섯 번까지 되풀이했다. 바꾸는 중(`swapping`)에는 위험 회피와 철수 지시 말고는 후보를 내지 않고, 다른 붙잡힌 일(예비 펌프 교체·급수 연결·후퇴·휴식) 중에는 교체 후보를 내지 않으며, 대기 지점에 닿지 못하면 `a.equipRetryAt` 에 적는다. 예비 펌프 교체와 급수 연결도 같은 까닭으로 서로 내지 않는다. 스스로 고르는 새 행동에는 이 세 가지(붙잡기·서로 내지 않기·실패 기억)를 둔다.
- **장비 좋은 대원이 늦게 닿으면 넘겨받는다.** 급수 연결은 그 부대의 펌프 대원(`pumpPanel`)이 활동 중이면 그 사람만 맡는다(`fitFor` — 선호 점수만으로는 손이 빈 관창수에게 갔다). 맨손으로 붙든 구출은 적합도가 0.3 넘게 높은 손 빈 대원이 닿으면 가장 서툰 사람이 손을 뗀다(`commander.assign` 끝의 `RELIEF_GAP`, `executor.relieve`). 교대는 구출에만 있다.
- **같은 문제 코드를 쓰는 복구는 상세로 가린다.** 펌프 고장과 개인 장비 고장이 모두 `EQUIP_FAIL` 이다. `markRecovered` 는 가장 최근의 미복구 기록을 복구하므로, 예비 펌프 교체는 상세가 `<호출부호> 펌프 고장` 으로 시작하는 기록만 찾는다(그러지 않으면 고장 난 유압 구조기가 "예비 장비로 교체"된 것으로 남는다). 개인 장비 고장은 복구되지 않는다.
- **쓰러진 대원은 무전을 하지 못한다.** `agentHealth` 는 쓰러진 대원의 공기통도 줄이지만 "공기 잔량 60초 미만"·"공기통이 비었습니다"는 남기지 않는다. 세계 규칙 쪽에서 대원의 이름으로 기록을 남길 때는 그 대원이 말할 수 있는 상태인지 본다.
- **대원이 없는 현장 부대.** 상공에 머무는 헬기(`crews.isHovering` — 경찰 헬기는 언제나, 소방 헬기는 물·산불 현장)는 `onscene` 인데 대원이 없다. 철수는 `sceneManager.tickScene` 5)번 블록의 "남은 대원이 없는 부대" 줄이 하고(그때 `s.air` 의 AirOp 와 `s.light` 도 지운다 — 닫힌 뒤에는 세계 규칙이 돌지 않는다), 8)번 블록은 그 사건에 `onscene` 인 부대가 남아 있으면 현장을 보관하지 않는다. 7)번 블록의 `anyActive` 에는 대상이 있는 호이스트·물 투하 중인 상공 부대만 넣는다(감시만 하는 헬기를 넣으면 종료·추가 요청이 막힌다). `commander.countUnits` 는 상공 부대를 수색 인력으로만 센다. 대원이 있다고 가정하고 부대를 다루는 코드를 새로 쓰지 않는다.
- **상공 도착은 현장 도착이 아니다.** `s.arrivedAt`·`I.firstArrivalAt` 은 지상 대원이 처음 내린 시각 그대로이고(대응 시간·신고자 안내·가스 주변 시민 노출·`LATE_DISCOVERY`·보고서의 "부대 도착 전"), 상공 부대는 `s.airAt` 만 정한다. 한계 시간과 7)번 블록은 둘 가운데 먼저인 `onAt(s)` 부터, 무대응 종료는 둘 다 없을 때만이다. 화면(자동 카메라·`frameAction`·장면 제목)은 둘을 함께 본다 — `s.arrivedAt >= 0` 만 보고 "아직 볼 것이 없다"고 가정하는 화면 코드를 쓰지 않는다.
- **공중 관측자는 `s.agents` 밖에 있다.** AirOp 의 `eye`(`aloft` 인 `FieldAgent`)는 용의자의 표적·폭발·연기 피해·지휘권 승계·철수 판정에 끼지 않는다. `s.agents` 에 넣지 않고, `s.agents` 를 도는 코드에서 찾지 않는다. 관측자는 사람을 움직이지 않는다(대피 안내·인질이 걷기 시작하는 줄은 `aloft` 면 막는다) — 대신 하늘에서 먼저 본 걸을 수 있는 사람은 지상 대원이 처음 만났을 때 안내한다(`agents.ts` 의 `UNGUIDED`). 현장 전체 무전은 듣는다(`air.ts` 의 `listen` — 듣지 못하면 다른 헬기가 건져 간 사람을 물속에 있다고 믿는다). 지휘관에게는 "아무도 듣지 못한 보고"만 지휘관이 생겼을 때 한 번 넘긴다(승계 때마다 믿음 전체를 보내면 같은 무전이 네 번 나갔다).
- **상공 헬기의 한가함은 믿음으로 좁게 잰다.** "바깥을 훑기"는 언제나 할 수 있어 기준이 없으면 헬기가 영영 떠나지 않는다. `commander.outstanding().search` 는 "구조 대상을 하나도 모른다"는 뜻이라 화재·붕괴 현장에서는 끝까지 참이다 — `airDecide.watchBusy` 는 용의자·무장 현장의 미확보·실종/수난 현장의 미발견·물속의 사람·열린 바깥 수색만 "할 일"로 친다. 할 일 없이 45초(경찰 헬기 30초)면 "상공 임무 종료"로 돌아가고 `I.airDone` 에 적혀 같은 종류가 그 사건에 다시 오지 않는다.
- **공중 임무 작업은 상공 부대가 없어지면 취소한다.** `hoist`·`airDrop` 은 지상 대원의 `fitFor` 가 0 이라, 그 일을 할 헬기가 떠나면 영영 열린 채 남아 `canClose` 가 거짓이 된다. 지휘관은 상공에 호이스트(물 바구니)를 가진 부대가 없으면 그 작업을 `cancel` 하고, 밤에는 `airDrop` 을 내지 않는다(헬기가 밤에는 뿌리지 않는다). 호이스트로 곧바로 실려 간 사람의 지상 `waterRescue` 지시도 거둔다.
- **헬기만 왔던 현장은 헬기의 보고로 끝난다.** 지휘관이 없는 현장에서 마지막 헬기가 떠나면 7)번 블록은 마지막 지휘관의 믿음을 찾지 못한다. 관측자의 믿음에 남은 일이 있으면 `air.ts` 의 `tellDispatch` 가 수요를 다시 열어 지상 부대를 찾고, 확인한 사람이 모두 실려 갔으면(`allAboard`) 그 자리에서 사건을 닫는다. 둘 다 아니면 60초 뒤 '방치'다. 부대가 떠나며 "배정된 부대 0 · 채워지지 않은 수요 0"인 열린 사건을 남기는 길을 새로 만들지 않는다(측정 도구의 '잊힌 사건' 관문에 걸린다).
- **관제는 접수한 것만 안다 — 같은 틱의 순서도 본다.** 의료 헬기의 "급한 구급 요청" 줄은 `s.requests` 의 앞쪽 `I.fieldNeedsSeen` 개(관제가 접수한 요청)만 본다. `airFit` 은 태풍 충격 단계를 직접 본다(`u.grounded` 는 같은 틱 뒤쪽의 `tickUnits` 가 적는다 — 그 틱의 배정이 새지 않게). 물을 뜨러 간 헬기(`AirOp.phase 'away'`)의 지도 위치(`u.x`,`u.y`)는 옮기지 않는다(`etaFor`·연료 복귀가 그 값으로 잰다).
- **효과 그림에 `s.rng` 를 쓰지 않는다.** 그 흐름은 명중·용의자 행동도 쓴다. 테이저 명중은 `crews.kitRng(sim, s)`(`kit:<현장 id>`), 물 투하·테이저의 그림 기록은 흔들림 없이 남긴다. 관측자의 판단 난수는 `air:<사건>:<부대>`, 개인 장비 고장 추첨은 교대 흐름 `kit`(지원 부대는 자기 흐름 `aid:<n>` 의 끝 — 대원 → 펌프 → 고장 순서).
- **상공의 헬기 그림은 두 자리를 쓴다.** 땅 위의 자리(`AirOp.x, y` — 그림자·호이스트 줄 끝·탐조등 원·물 띠)와 몸체의 자리(높이만큼 왼쪽 위). 현장 맨 윗줄에서는 몸체를 낮춰 그리고(화면 위의 덧글 밑으로 들어가지 않게), 두 헬기의 몸체가 겹치면 살피는 쪽을 옆으로 비켜 그린다(`renderScene.spreadAirs` — 그림만, AirOp 는 고치지 않는다). 그래서 누르기(`hitScene`)는 마지막으로 그린 자리(`airDrawn`)를 쓴다. 상공 작업을 사람이 읽는 말은 `airOpLabel` 한 곳이다.
- **현장의 대원 이름표는 `mergeLabels` 를 거친다.** 부대마다 2~5명이라 대기 지점에 열 명 넘게 모인다. 같은 글자의 이름표가 겹치거나 바로 곁이면 하나로 모으고(분야가 섞이면 중립색), 글자가 다른 이름표끼리 겹치면 한 줄 올린다. 대원 이름표를 더하는 코드는 `labels` 배열에 넣는다(직접 `pill` 을 부르면 다시 겹친다). 부대 목록의 대원 칸은 `.crewN`, 역할 점은 `.rdot`(`RoleDot`)이다.
- **역할 기호는 글자처럼 읽히면 안 된다.** 곧은 집게 둘은 13 화소에서 글자 Y 로 읽혔고, 고리 모양 기호는 서로 헷갈렸다. 새 기호는 견본표(10·12·13·16·24 화소로 나란히)를 찍어 보고 정한다. 순찰·기동대원(문장형 방패)과 방패수(시야 창이 뚫린 긴 방패)처럼 뜻이 가까운 기호는 윤곽을 다르게 한다.
- **장비 효과를 시험하는 현장은 숨은 고장을 지우고 시작한다.** `tests/crews.test.ts` 의 `sceneWith` 는 모든 장비의 `fault` 를 지운다(시드에 따라 로봇·유압 구조기가 고장 난 채 시작해 무관한 시험이 깨졌다 — 고장 자체는 "소모와 고장" 시험이 본다). 그 파일은 90초 예산이다: 교대를 끝까지 도는 시험은 매 틱 부대만 훑는 `patrol` 도우미의 결과를 나눠 쓰고, 날씨를 타는 시험은 `seedsWhere` 로 맞는 시드를 찾는다(안개 교대에는 헬기가 뜨지 않는다 — `npm run ui-check` 의 기본 시드 S3 도 안개다).
- **피해는 한 길로(H1).** 사람의 체력을 깎는 모든 곳은 `injury.hurt*` 를 거친다 — 부상 기록·방호·문턱·출혈·사망 원인이 거기서 정해진다. 판정 뒤(`I.phase === 'closed'`)에는 `tickCasualties` 의 악화, `agentHealth`, `rules/injury.ts`, `hurt*` 가 모두 첫 줄에서 돌아간다 — 새 피해 규칙도 그렇게 해야 사망 기록이 판정과 어긋나지 않는다(시험 9). 숨진 사람을 다시 치지 않는다(`tickLane`·`blast` 의 대상 고르기에서 `r.dead` 를 뺀다 — 빼지 않으면 시신을 친 차가 '작업 중인 대원을 충격' 기록을 남긴다).
- **문턱(H1).** 이 틱이 시작될 때 41 이상이던 대원은 한 번 피해가 몇 번 겹쳐도 숨지지 않고 체력 8 로 쓰러진다(`a.hpTick` — `tickScene` 이 1) 직전에 적는다. 실행기 단계의 피해도 그 값을 쓴다). 쓰러지지 않은 용의자는 한 번 피해로 숨지지 않고 4~15 로 남아 **그 자리에서** 쓰러진다(`hurtHostile` → `settleHostile` — 다음 틱까지 기다리면 같은 틱의 다른 대원이 한 번 더 쏜다). 그래서 용의자의 사망은 쓰러진 뒤의 출혈·처치 지연·폭발로만 생긴다.
- **먼 관찰이 가까운 보고를 덮는다.** 지휘관이 쓰러진 용의자를 2칸 밖에서 매 틱 다시 보면, 새 시각의 그 사실이 곁에서 본 대원의 늦게 닿은 보고('숨졌다')를 `merge` 에서 "더 오래된 사실"로 버리게 한다 — 숨진 용의자에게 처치 지시가 되풀이됐다(H1 검토). 움직이지 않는 대상(쓰러진 동료·쓰러졌거나 붙잡힌 용의자)을 멀리서 다시 본 것은 `significant` 한 변화가 없으면 믿음을 덮지 않는다(`perceive`). 비슷한 사실 종류를 새로 만들면 같은 규칙을 둔다. `TS_MAX_DONE`(한 용의자에게 내는 지시 넷)은 안전장치다.
- **다친 대원은 가벼운 일만, 부대는 걸을 사람이 있는 한 나간다(H1 — 사용자 결정).** `fitFor` 는 남에게도 불리므로 `r.status === 'injured'`(조직이 아는 상태)만 보고 체력을 읽지 않는다. 배정(`resources.crewReady`)과 내리는 사람(`unitArrived`)은 같은 술어 `injury.canDeploy` 를 쓴다 — 따로 쓰면 "배정은 됐는데 아무도 내리지 않는 부대"가 생긴다. 감점은 온전한 대원 수(`crewOk`)로 본다. 운용 중단 문구 셋은 측정 도구의 `PHRASE.T6` 와 맞물려 있다.
- **환자 자리는 `crews.seatsUsed(sim, u)`(H1).** 다친 대원·용의자는 `u.aboard` 에 타고 다른 부대의 대원·용의자만 자리를 쓴다. `u.patients.length` 로 자리를 세면 구급차에 셋이 탄다. 출발 지시·출발 기록은 `commander.riderText(u)`, 병원 인계(`resources.tickUnits`)는 `aboard` 도 인계하고 비운다 — `patientsIncident` 블록 밖에서.
- **사람 곁의 글자는 서로 피한다(H1 단계 7).** 대원 이름표(`mergeLabels`)는 먼저 그린 용의자 알약을 고정 글자(`LabelBox`)로 받아 겹치면 한 줄 올리고, 용의자 알약끼리도 겹치면 한 줄 올린다(쓰러진 용의자를 처치하는 대원의 이름표가 알약을 덮어 둘 다 읽히지 않았다). 사람 곁에 글자를 새로 그리면 같은 상자 목록에 넣는다.

## 작업 방식

- 한 번에 한 작업 묶음. 끝나면 `npm run check` → 커밋 → 푸시 → `docs/ROADMAP.md` 갱신.
- 여러 에이전트가 동시에 작업할 때는 `docs/ROADMAP.md` 의 "트랙"별 파일 소유 규칙을 따른다. `types.ts` 는 추가만 하고, 기존 필드의 의미를 바꾸지 않는다.
- 여러 묶음을 따로 만들어 합칠 때는 `docs/specs/README.md` 의 파일 소유 규칙과 합치는 순서를 따른다(묶음마다 `wf/<묶음>` 브랜치, 구현 → 독립 검토 → 합치기).
- 시뮬레이션을 고친 뒤에는 `npm run sweep -- 60` 의 결과 분포와 `close reasons` 의 `timeout` 건수를 전후로 비교한다. 화면만 고쳤다면 분포가 한 건도 달라지면 안 된다.
- 특정 게임의 아트·명칭·배치를 그대로 옮기지 않는다. 장르의 방식(지도 중심 관제, 통화창, 사건 핀, 차량 아이콘)은 자유롭게 쓴다.
