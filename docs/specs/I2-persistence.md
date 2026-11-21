# I2 — 교대 간 지속

> **I1-b 가 끝났다(2026-11-21 — 스크립트가 아니라 세계 상태에서 자연스럽게 생기는 인과로 다시 설계해 구현했다. 실제 이름의 정본은 `I1-causality.md` 끝 "구현 메모"의 "최종 요약").** 이 문서가 I1-b 에 기대하는 이름은 **모두 그 이름·그 뜻으로 있다**: `world/state.ts` 의 `knownBuildingAt(sim, node, placeKind?)`(→ `{ burnFrac, usable, inc } | null` — ① 그 교차로에서 닫힌 사건 건물의 X6 `placeMarks` ② 없으면 `sim.carryState.places`(이어받은 항목, `inc` −1)를 이미 읽는다)·`placeState(sim, placeId)`(→ `{ mark, burnFrac, ruinFrac, usable, shake, pipe, wet }` — X6 `placeMarks` → `carryState.places` → `world.expo` 차례, 끝의 셋이 더해졌다. 칸을 더 넣지 않고 `usable` 만 단계 5 에서 `placeUsable` 로)·`initWorld(sim, carry?)`(받기만 하고 쓰지 않는다), `types.ts` 의 `WorldTag`(끝이 새 줄 `| 'struct'` — I2 의 `| 'carry'` 는 그 뒤에 새 줄로), `traffic.ts` 의 `ObstacleKind 'rubble'`(C2 `world/rules/structure.ts` 의 `rubbleRoad` 가 놓는다 — `Obstacle.ev` 가 놓은 기록, 쿨다운 열쇠 `place:<건물 id>`). **알아야 할 것**: ① `Scene.wear` 를 I1-b 가 먼저 채운다 — `world/expo.ts` 의 `applyExpo(sim, s, I)` 가 `sceneManager.createScene` 의 `buildScene` 바로 다음에 그 건물의 `world.expo[p].shake > 0` 이면 `{ dmg: shake, soot: 0, cause: 'shock', inc: <가장 크게 흔든 사건의 코드>, pre: 0 }` 를 넣는다(끊긴 배관이면 새는 밸브 소품 하나도 — `s.rules` 는 고치지 않는다). `applyPlaceWear` 는 그 뒤에 불러 `dmg` 의 큰 쪽으로 합친다. ② `WEAR_INTEG` 는 `field/catastrophe.ts` 의 `CAT.WEAR_INTEG`(0.5)이고 `catOf` 가 이미 `s.wear.dmg` 로 실내 구획의 처음 건전도를 깎는다 — §10.1 의 `persist.ts` 상수 줄은 "그 값을 읽는다"로, §7 의 `catOf` 한 줄은 이미 있다. ③ 측정 도구의 `S(I)` 는 `s.wear.cause === 'shock'` 을 `building` 으로, 그 밖을 `carry` 로 센다(`scripts/metrics.ts`). ④ 교대 끝의 `world.expo[p]`(`shake`·`pipe`·`wet` — 진실)를 다음 교대로 이어받을지는 단계 5 에서 정한다(`placeOutcome` 의 원천이 될 수 있다). ⑤ `incidents.placeGone`(장소 고르기 엄격·대안 · `createIncident` 의 정해 준 건물 · 추격전 은신처 후보 — 세 자리)과 법칙 사건을 꺼낼 때의 `placeGone` 검사(`tickIncidents` — 넷째 자리)가 단계 5 에서 `placeUsable` 로 바뀐다. ⑥ 이어받은 복구 통제를 `initTraffic` 뒤에 닫을 때는 교통 장부에 주인을 적는다(`traffic.noteRoadCause(sim, edge, 'close', ev)` — 빠뜨리면 그 구간의 혼잡이 원인 없는 초과가 되어 측정 도구의 `hazard.holes` 관문에 걸린다). ⑦ 법칙이 쓰는 문턱(`world.hz.cells`)·지하의 문턱(`world.sills`)·배관의 문턱(`world.expo[p].pipeThr`)은 교대 안의 시드 값이라 이어받지 않는다. I2 를 구현하기 전에 그 "최종 요약"으로 실제 이름을 한 번 더 확인한다.

공통 규칙은 `docs/specs/README.md`. 브랜치 `wf/persist`, 개발 서버 포트 **5232**. 본보기: `T1-traffic.md`(도로 통제의 주인과 우회로 검사), `N4b-crime.md`(묶음 파일과 공용 파일 수정의 경계).

**한 줄 요약**: 교대가 끝나면 지금은 모든 것이 사라진다. 이 묶음은 대원 상태·장비·건물·도로 네 가지를 **"이어받은 상태"(`Carryover`)** 라는 자료로 만들어 다음 교대의 `Sim` 생성자에 입력으로 넣는다. 같은 시드 + 같은 난이도 + 같은 이어받은 상태 = 같은 결과. 이어받은 상태가 없으면 지금과 기록 해시가 한 글자도 다르지 않다.

사용자 검토 의견의 요지(설계의 기준): "사건 사이의 영향이 다음 교대까지 남는다 — 화재 건물의 그을음·손상, 붕괴 건물은 복구 전까지 못 쓰고, 파손 도로는 수리될 때까지, 부상 대원은 치료가 끝날 때까지 결장, 쓴 장비는 점검·보충, 큰 재난 뒤에는 인력·장비가 모자란다. 우선 대원 상태·장비·건물·도로 네 가지만." 그리고 "성공률을 무조건 높이는 쪽으로 최적화하지 않는다 — 실패도 중요한 결과다."

**하는 것**
- 자료형 `Carryover`(판 번호, JSON 으로 저장·복원) — 대원(체력·부상·결장 남은 교대·경험·숙련), 장비(펌프 상태·정비·소모품 재고), 건물(손상·그을음·출입 통제·무너짐·복구 남은 교대), 도로(파손·복구 남은 교대).
- 교대가 끝날 때 다음 교대용 상태를 만드는 규칙(회복·수리·보충), 다음 교대가 그것을 적용하는 자리와 순서.
- 도시 지도(`city.places`·`nodes`)를 고치지 않고 건물 상태를 **겹쳐** 읽기: 사건 장소 고르기·현장 생성·지도 그림이 모두 겹친 상태를 본다.
- 화면: 교대 시작 전 조건에 "새 조직으로 시작 / 이어서 시작", 저장(localStorage, 실패해도 새로 시작), 지도에 남은 흔적, 보고서의 "지난 교대의 영향".
- '죽음의 나선'을 막는 회복 규칙과 상한, 교대 N번을 이어 돌리는 측정 스크립트(`scripts/chain.ts`).
- ROADMAP 의 K1(대원 경험치 성장과 교대 간 저장)을 이 묶음이 함께 끝낸다.

**이번에 하지 않는 것**
- 교대 사이의 날짜·시각 흐름(교대 시각과 날씨는 지금처럼 그 교대의 시드가 정한다 — §3.1 결정).
- 지구력·피로의 누적(교대 사이 휴식으로 회복된다고 본다). 차량 자체의 손상(지금도, X6 초안에도 차량이 다치는 모델이 없다 — 생기면 `UnitCarry.service` 의 `'vehicle'` 로 받는다).
- AI 의 조직 기억(오판에서 배우기 — ROADMAP K2). 같은 방식(생성자 입력)으로 나중에 `Carryover` 에 칸을 더할 수 있게만 둔다.
- 병원 수용 여력, 기반시설(전력·통신·수도)의 교대 간 지속. I1-b 의 `sim.world` 는 교대 **안**의 상태만 둔다(I1 §3.3). 그래서 이 묶음은 I1-b 의 `initWorld(sim, carry?)` 에 `carry` 를 넘기지 않는다(§3.4). 교대를 넘기는 일은 8단계에서 ROADMAP 에 새 항목("세계 상태의 교대 간 지속 — 병원 체류 환자·구역 위험의 감쇠")으로 올리고, 같은 틀(`Carryover` 에 선택 칸 + `initWorld` 에 넘기기)로 더한다.
- 이어받은 상태를 손으로 고치는 편집 화면(관찰 전용 원칙 — §5.1).

**자기 파일**(새로): `src/sim/persist.ts`(만들기·적용·검사·요약), `src/view/city/carryLayer.ts`(지도의 남은 흔적), `scripts/chain.ts`(연속 교대 측정 — I1-a 의 `scripts/metrics.ts` 를 import 한다), `tests/persistence.test.ts`.
**공용 파일 수정**: §10 의 표에 적힌 함수만, 가장 작은 조각으로(README §2).
**이 설계서가 따로 허락하는 것**: 마지막 단계의 `README.md`·`CLAUDE.md`·`docs/ROADMAP.md`(K1 을 끝난 것으로 옮기고, 위의 새 항목을 올린다). `scripts/sweep.ts` 에 `--carry` 옵션 하나. `tests/causality.test.ts` 에서 문구 규칙 T5 의 검사를 켜는 한 줄(I1 §6 의 3번이 "T5 는 I2 뒤에 켠다"고 미뤄 둔 것 — §8 완료 조건 3).
**건드리지 않는다**: `city.ts`, `cityPlan.ts`, `view/city/staticCity.ts`, `view/city/places.ts`, `tests/sim.test.ts`, `dispatch/*`(배정은 지금의 `crewReady`·`oos` 로 충분하다 — §3.2 끝), `traffic.ts`(맨 위 주석 한 낱말 외에는 — §10.2. 새 통제 이유 `'repair'` 는 이 묶음이 주인이다).

시작하기 전에: 구현 순서는 **R1 → H1 → X6 → R2 → R3 → I1-b → I2**(`docs/ROADMAP.md` "진행 중"). 이 묶음은 맨 끝이다. 아래 줄 번호는 2026-11-14 `a746b77`(B1·B3·P1·Q1 을 합친 뒤) 기준이고 앞 묶음들이 합쳐지면 바뀐다 — **함수 이름으로 찾는다**. 확신하지 못한 곳은 **(확인 필요)** 로 표시했다. 다른 묶음의 이름은 그 설계서를 따른다: R1(`R1-crews.md` — `fieldCrew`·`stays`·`minField`·`skillsOf`·`STAFF`·`ROLES`·`EXTRA_NAMES`·`kit`), H1(`H1-injuries.md` — `outShifts(r)`·`mainCause`·`CAUSE_NAME`·`RosterOut`), X6(`X6-catastrophe.md` — `Sim.placeMarks`·`PlaceMark`·`Scene.cat`·`catOf`·`STRUCT_COLLAPSE`. X6 연관 표의 I2 줄이 "X6 의 이름이 기준"이라고 정했다), I1(`I1-causality.md` — I1-a 의 `scripts/metrics.ts`(`runWithProbe`·`shiftMetrics`·`summarize`·`checkMetrics`, 시스템 `carry`, 문구 규칙 T5), I1-b 의 `placeState`·`knownBuildingAt`·`initWorld`·`WorldTag`·`ObstacleKind 'rubble'`). 앞 묶음이 구현하면서 이름을 바꿨으면 구현 메모에 적고 이 문서를 따라 고친다.

## 원칙

1. **이어받은 상태는 입력이다.** `new Sim(seed, d, len, { carry })`. 시뮬레이션은 이 입력을 고치지 않는다(받을 때 검사하며 깊이 복사한다). 같은 입력이면 같은 결과.
2. **없으면 지금과 같다.** `carry` 가 없거나 `null` 이면 이 묶음의 모든 함수가 첫 줄에서 돌아가고, 난수도 기록도 더하지 않는다. 0단계의 해시 목록(§8)이 모든 단계 뒤에 그대로여야 한다. 하나의 예외는 `placeUsable` 이다. 이어받은 상태가 없을 때 X6 가 교대 안 제외(`collapsed`·`burnt`)를 두는 세 자리 — 장소 추첨(`pickPlace`), 정해 준 건물(`createIncident`), 은신처 후보(`pursuit.ts`) — 에서는 `inShift = true`(기본값)로 X6 의 조건을 그대로 본다(X6 §7.1 — 같은 조건이라 결과가 같다). 재난의 장소 고르기와 연쇄 방화의 대상 두 자리는 `inShift = false` 로 불러 이어받은 상태만 본다(X6 가 그 두 곳에 검사를 두지 않았다 — 교대 안 상태는 `createIncident` 의 되고르기가 받는다, §3.6).
3. **도시 지도는 고치지 않는다.** `generateCity` 는 한 번 만든 지도를 모든 `Sim` 이 함께 쓴다(`city.ts:206-212`). 건물 상태는 `placeId` 를 열쇠로 한 **겹침 표**(`sim.carryState.places`)에, 도로 상태는 교대마다 복사되는 `city.edges` 의 칸에 둔다.
4. **난수는 새 흐름만.** `carry`(만들기), `recruit:<자리>`, `relief:<호출부호>`. 기존 흐름의 호출 수와 순서를 바꾸지 않는다 — 펌프 상태도 지금처럼 `equipment` 흐름에서 뽑은 **뒤에** 값만 바꾼다(`rng.fork` 는 부모 시드에서 갈라지므로 새 이름을 더해도 다른 흐름은 그대로다 — `rng.ts:44`).
5. **가짜 연출 금지.** 이어받은 상태가 바꾼 것(결장, 정비, 출입 통제, 복구 공사)은 교대가 시작되기 전에 적용한다(§3.4 ①·②). 첫 기록은 언제나 '교대 시작'이어야 하므로, 적용 함수는 **적용한 항목의 목록**(`carryState.applied`)을 돌려주고, ③ `announceCarry` 가 그 목록만 기록한다. "상태를 바꾸는 바로 그 코드에서 `emit`" 규칙과 글자 그대로는 다르다. 대신 목록에 없는 것은 기록하지 않고, 목록의 항목은 모두 기록한다. 이 일대일 관계를 테스트 10 이 지킨다. 교대 중에 바뀌는 것(정비 완료, 개통)은 바꾸는 그 자리(`tickCarry`)에서 기록한다. 원인은 이어받은 상태 요약 기록(`carryState.event`)으로 `causes` 를 잇는다. 보고서 문장은 이 기록과 상태로만 쓴다.
6. **관찰만 한다.** 화면이 고르는 것은 "새 조직으로 / 이어서 / 저장된 조직 지우기" 셋뿐이다 — 교대 시작 전 조건(CLAUDE.md 1번 규칙). 누가 다쳤는지, 어느 건물이 막혔는지를 화면에서 고치지 않는다.
7. **정보 격리.** 이어받은 상태는 "앞 교대가 끝난 뒤의 점검으로 조직이 아는 기록"이다. 그래도 **관제·지휘 코드(`dispatch/*`·`field/commander.ts`·`field/brain.ts`·`field/orders/*`)는 `carryState`·`.wear` 를 직접 읽지 않는다.** 그 코드가 이어받은 상태를 아는 길은 정해 둔 것뿐이다: 결원은 `crewReady`·`u.state`(`oos`), 복구 통제는 "알려진 통제"(`e.closed`·`known` 없음), 건물은 I1-b 의 `knownBuildingAt(sim, I.reportedNode, placeKind)`(I1 §3.4 — 관제가 아는 건물 상태. 관제는 건물 id 를 모르므로 알려진 교차로로 묻는다. 지난 교대에서 이어받은 것도 이 함수로 나온다 — 그 교차로·건물 종류의 `carryState.places` 항목, 반환 `inc` -1)이다. 끝 상태를 **만들 때** 현장의 진실(`s.burnedTiles`·`s.damage`·소품)을 읽는 곳은 `persist.ts` 의 `placeOutcome` 하나뿐이다(`debrief.ts` 와 같은 자격 — CLAUDE.md 4번 규칙의 "진실을 읽어도 되는 곳"에 더한다).
8. **저장은 표현 계층에서만.** `src/sim` 에 `localStorage`·`sessionStorage`·`indexedDB` 가 없다(테스트가 잡는다 — §9). 저장 실패는 조용히 넘기고 새 조직으로 시작할 수 있다.
9. **이어갈수록 망가지지 않는다.** 결장·정비·출입 통제·도로 통제에 모두 회복 규칙과 상한이 있다(§6). 반대로 경험 성장이 쌓여 이어갈수록 쉬워지는 것도 상한으로 막는다.
10. **모든 사건은 끝난다.** 이어받은 통제가 도시를 끊지 않게 교대 시작 때 우회로를 확인한다(§3.5). `LIMIT`·`holdUntil`·`hardCap` 은 그대로.

## 연관 설계서와 나누는 선

| 설계서 | 겹치는 곳 | 나누는 선 |
|---|---|---|
| K1 대원 성장·교대 간 저장 (ROADMAP) | 경험 성장, 부상자 결장, 저장, 생성자 입력 | **I2 가 K1 을 함께 끝낸다.** K1 의 완료 조건("재현성 테스트에 명부 입력 추가, 저장된 명부로 재실행 시 해시 일치")은 §9 의 1·5번이 맡는다. 다 하면 ROADMAP 의 K1 을 "완료한 작업 묶음"으로 옮긴다 |
| H1 부상과 사망 | 다음 교대 결장, 순직, `RosterOut`, 교대 안의 부상과 결장의 구별 | H1 의 "가벼운 일은 계속"(사용자 결정 2026-11-15 — 걸을 수 있는 다친 대원은 그 교대 안에서 가벼운 일을 계속한다)은 교대 안의 규칙이고, 교대를 넘는 결장은 `outShifts` 표 그대로다(§3.2 끝 — 다음 교대에 `injured` 로 출근하는 사람은 없다). H1 은 교대 끝 상태(`r.dead`·`r.care`·`r.tDown`·`injuries`)와 화면용 `ShiftReport.roster`, 결장 표 함수 `outShifts(r)`(`injury.ts`, H1 §3.7)를 **내놓는다**. I2 는 `sim.responders` 를 직접 읽고 **`outShifts(r)` 를 불러** `CrewCarry.out` 을 정한다(§3.2 — 표는 그 함수 하나에만 있다). H1 표에 없던 두 경우(교대 끝에 후송 중, 쓰러진 채 병원에 가지 못함)는 H1 §3.7 표에 이 문서의 값으로 들어갔다(반영됨 — §3.2). H1 의 `RosterOut` 은 열쇠가 `rid` 인데 `rid` 는 부대 규모 손잡이에 따라 바뀌므로(`resources.ts:66,75,86`) **I2 는 이름을 열쇠로 쓴다**. H1 의 `roster` 칸은 지우지 않고, `status 'off'` 인 대원의 `out` 만 I2 의 값으로 채운다(§10). 순직은 "현장·가용 인원에서 빠진다"(H1 §3.7 의 문구 — 반영됨). `sim.responders` 에는 rid 를 지키려고 `status 'off'`·공석으로 남는다(§11.2) |
| R1 부대 편성·개인 장비 | 자리·이름·역할, 최소 인원, 소모품, 장비 고장 | R1 뒤에도 이름은 모두 다르다(`EXTRA_NAMES`, R1 테스트 ⑦). R1 의 `crewReady` 는 내리는 자리(`fieldCrew`)만 센다(R1 §5). 그래서 결원(예비 인력을 붙이는 기준)도 같은 단위로 센다: **내리는 자리의 최소 수 `minField(kind)`**와 내리지 않는 자리(`stays` — 조종사·정장)를 따로 본다(§3.2 적용 6). R1 의 `minCrew(kind)` 는 내리지 않는 자리까지 세므로 쓰지 않는다 — R1 이 `minField(kind)`·`skillsOf(role, skill)` 를 export 한다(R1 §4, 반영됨). H1 의 `crewReady` 는 `minField` 와 견주지 않는다 — 부대의 운용 중단은 그 부대 대원이 전부 숨졌을 때만이고 부분 결원은 −18 감점만이다(H1 §3.6, 사용자 최종 결정 2026-11-15). I2 도 같은 정신으로 둔다: `minField` 는 결장한 자리를 어디까지 채우나의 기준일 뿐이고, 부대가 운용을 멈추는 것은 출근할 대원(헬기·구조정은 조종·조타할 사람까지)이 한 명도 없을 때뿐이다(§3.2 적용 6). 신임 대원·예비 인력은 그 자리의 `role` 과 기본 `kit` 을 받고, `skills` 는 R1 의 역할 식으로 정한다. 소모품 재고(`Carryover.stock`)에 R1 의 테이저 카트리지를 더할 수 있고, 공기통·헬기 연료·물은 서(署)에서 채운다고 보아 이어받지 않는다. 장비 고장은 점검에서 드러나지 않은 것만 이어받는다(§3.3) |
| X6 위험의 현실화 | 실제 붕괴·폭발·전소, 건물 상태, 구조 건전도 | X6 는 교대 안의 건물 상태를 `Sim.placeMarks`(`Map<placeId, PlaceMark>` — `state` 는 `scorched`·`blasted`·`partial`·`burnt`·`collapsed`, `burnFrac`·`ruinFrac`)와 `Scene.cat`(`burntAt`·`totalAt`·`fallen`)에 남기고 `ShiftReport.placeMarks` 로 내놓기만 한다. **I2 는 `Sim.placeMarks` 를 끝 상태의 원천으로 먼저 읽는다**(§3.6): 전체 붕괴 → `ruin`, 전소 → `closed`(오래), 구획 붕괴·폭발 → `closed`, 그을림 → `marked`. 이어받은 손상(`s.wear.dmg`)은 X6 의 `catOf` 가 정하는 구획 건전도 처음 값에 한 항으로 들어간다(§7 — I2 가 그 한 줄을 넣는다). 같은 교대 안의 재발 막기(`pickPlace`·`createIncident` 의 정해 준 건물·은신처 후보에서 `collapsed`·`burnt` 제외 — X6 §7.1)는 X6 의 규칙이다. I2 는 그 세 검사를 `placeUsable` 하나(`inShift` 기본값 true)로 옮기고, 이어받은 상태의 제외를 같은 함수에 더한다(결과 같음 — §3.6). 전체 붕괴 때 X6 가 막는 사건 교차로 구간(X6 §4.2, `I.blockedEdge`)은 다음 교대의 `debris` 복구 공사의 원천이 된다(§3.5) |
| I1 인과관계·세계 상태 | 세계 상태, 원인 사슬, 측정 | **건물 상태는 옮기지 않는다**(I1 §3.2·§9 의 결정): 교대 안은 X6 의 `Sim.placeMarks`, 교대 사이는 I2 의 `carryState.places` 다. I1-b 는 둘을 읽는 `placeState(sim, id)`(X6 → I2 순서 — 세계 규칙 쪽)·`knownBuildingAt(sim, node, placeKind?)`(관제 쪽 — 알려진 교차로로 묻는다) 만 둔다. **"쓸 수 있는 건물" 판정은 `persist.placeUsable` 하나**다. `placeState().usable` 은 이 함수를 부르고, X6 의 `pickPlace` 제외도 이 함수로 바꾼다(§3.6). I1-b 의 `initWorld(sim, carry?)` 에는 `carry` 를 넘기지 않는다(병원·기반 시설의 교대 간 지속은 범위 밖이다 — 머리말). 측정: I1-a 는 요약 기록을 문구 규칙 T5 `/^지난 교대에서 이어받은 상태/` 로 시스템 `carry` 로 센다. 그래서 **요약 문장의 첫머리는 바꾸지 않는다**. I2 의 나머지 기록은 `tag: 'carry'`(I1-b 의 `WorldTag` 에 한 값 추가)로 `carry` 로 세게 한다(§7). I1-b C2 의 `rubble` 장애물 가운데 교대 끝에 남은 것은 `debris` 복구 공사로 이어받는다(§3.5) |
| G4 현장 상태 가독성 | 지도의 무너진 건물 그림 | G4 는 **이번 교대에** 무너진 건물을 현장 기록(`s.damage`·`s.falls`)으로 그린다(G4 §5.3). I2 는 **지난 교대에** 무너진 건물을 겹침 표로 그리며 G4 의 그림 함수와 기호(`RUIN_MARK`)를 쓴다. 그을린 지붕은 G4 §7.6 과 같은 넓이 식. G4 가 합쳐지지 않았으면 §5.4 의 단순한 그림 |
| T1 교통 | 도로 통제의 주인 | 새 통제 이유 `'repair'`(복구 공사)의 주인은 `persist.ts`. 교통 모델은 `'incident'`·`'disaster'` 처럼 건드리지 않는다(`traffic.ts:8` 규칙에 한 낱말 더한다 — 주석만). 놓기 전 우회로 검사는 T1 의 `linked` 와 같은 뜻(§3.5) |
| N6 재난 | 재난이 통제한 도로 | 재난은 지금처럼 자기 통제를 모두 연다(`disaster.ts:210,318-327`). 교대 길이 1200초에서는 다섯 재난 모두 교대가 끝나기 **전에** 스스로 끝난다(지진은 늦어도 600 + 420 + 여파 120 = 1140초). 그래서 "교대 끝에 남은 통제"로는 아무것도 넘어오지 않는다. 대신 `closeEdge` 가 통제한 구간을 **기록만** 한다(`d.damaged` — 난수·`emit` 없음, 결과 불변). 다음 교대는 그 교대에 지진·해일·홍수·산불이 닫았던 구간을 "복구 공사"로 넘겨받는다(§3.5) |
| U2 통화창 · G5 교전 연출 | 화면 자리 | 겹치지 않는다. 상단 띠의 칩 하나(§5.2)는 U2 가 상단을 고쳤으면 그 배치를 따른다 |
| ROADMAP M2 (1) | 사건이 끝난 건물의 흔적 | 교대 **안**의 흔적은 G4, 교대를 **넘는** 흔적은 I2. 같은 건물의 재발은 I2 의 가중치(§3.6)가 일부 맡는다 |

---

## 1. 지금 상태 — 교대가 끝나면 무엇이 사라지는가

조사 근거는 파일:줄. 측정은 `npx tsx` 로 시드 3개(S0~S2, 보통)를 돌려 끝 상태를 읽은 것이다(작은 표본).

### 1.1 이미 교대를 넘어 남는 것

| 무엇 | 어떻게 | 근거 |
|---|---|---|
| 대원의 이름과 기본 능력 | 고정 조직 시드 `new Rng(0x51ab7e).fork('roster-v1')` 에서 `UNIT_DEFS` 순서로 한 명당 6번. 편성되지 않는 부대도 뽑으므로 부대 규모가 바뀌어도 같은 이름 = 같은 능력. R1 뒤에는 셋째 자리부터 `roster-v2:<호출부호>:<자리>` 흐름과 `EXTRA_NAMES`(R1 §5) — 역시 부대 규모와 상관없다 | `resources.ts:58-86`, `tests/sim.test.ts:284-293`(부대 규모 손잡이 테스트) |
| 도시 지도 | `generateCity` 가 모듈 변수에 한 번 만들고, 교대마다 `edges` 만 복사해 준다 | `city.ts:206-212` |

### 1.2 교대가 끝나면 사라지는 것

| 무엇 | 교대 안에서 | 교대가 끝나면 | 근거 |
|---|---|---|---|
| 대원 체력·부상 | 연기·불·폭발·총격·2차 붕괴·재난이 깎는다. 40 아래 `injured`, 15 이하 `down`. 되돌리는 코드 없음(회복되는 것은 지구력뿐) | 다음 교대는 모두 체력 100, `ok` | `sceneManager.ts:134-157`(`agentHealth`), `resources.ts:78,323-327` |
| 교대 안의 결원 영향 | 현장에는 `ok` 만 내린다. `crewReady` 0 이면 복귀 때 `oos`. 배정은 결원 −18, 평균 지구력 감점 | 사라짐 | `sceneManager.ts:61`, `resources.ts:166,313`, `dispatcher.ts:60,75-78` |
| 경험 | `xpGained` 이 늘기만 하고 읽는 곳이 없다. `incidentsWorked++` 는 도착 때 한 번. 둘 다 보고서·화면에 없다 | 사라짐 | `executor.ts` 15곳, `agents.ts:93`, `sceneManager.ts:81` |
| 펌프 | `equipment` 흐름에서 장비 손잡이 범위로 뽑는다. 방수하면 닳고(`0.0042×pumpWearMul/s`) 0.2 아래면 고장. 서에 돌아오면 고장 난 펌프만 0.55 | 다음 교대에 새로 뽑는다 | `resources.ts:88,311-312`, `executor.ts:237-258,934-946` |
| 섬광탄 | 줄기만 하고 교대 안에서 채우지 않는다 | 다음 교대에 손잡이 값으로 | `resources.ts:97`, `executor.ts` 의 섬광탄 사용 세 곳 |
| 물·공구·처치 장비·방호 | 물은 서에서 가득. 나머지는 만든 뒤 바뀌지 않는다 | 다음 교대에 손잡이 값으로 | `resources.ts:94-96` |
| 건물 피해 | 그 사건의 `Scene` 에만: `burned`/`burnedTiles`(화재), `damage`(붕괴 잔해), `glass`, `decorHp`, 소품의 `ignited`·`exploded`. `Place` 에는 상태 칸이 없다 | 다음 교대에는 흔적 없음. 같은 교대 안에서도 다른 사건이 그 건물 상태를 보지 않는다(`pickPlace` 의 `used` 는 "이번 교대에 사건이 났던 곳"을 뺄 뿐) | `types.ts:46-58,292-330`, `incidents.ts:49-67` |
| 현장 평면 | 건물이 아니라 사건 번호와 교대 시드에 묶인 흐름(`scene:<사건>`)으로 만든다 | 같은 건물이라도 교대마다 평면이 다르다 — 칸 단위 피해는 옮길 수 없다 | `sceneManager.ts:23-27` |
| 도로 통제 | 사건(`'incident'`)은 `closeIncident` 가 풀고, 재난(`'disaster'`)은 재난이 끝날 때 `finish` 가 모두 연다(1200초 교대에서는 늘 여파 120초 뒤의 `finish(…, false)` — 교대 끝의 `finish(…, true)` 에는 닿지 않는다). 지진 균열은 200~400초, 해일은 200초 뒤에 연다 | 다음 교대는 모두 열린 도로 | `incidents.ts:211-215`, `disaster.ts:68,90-126,210,283-305,318-327` |
| 교통 장애물·불법 주차 | 교대마다 `traffic` 흐름에서 새로 | 사라짐(의도대로 — 교통은 이어받지 않는다) | `traffic.ts:290-331` |
| 저장 | `ar.settings.v1`·`ar.current.v1 {seed, tick, diff}`·`ar.history.v1`(요약 12개). 명부·장비·건물·도로의 끝 상태는 저장하지 않는다 | — | `runner.ts:9-19,96-101,119-121` |
| 보고서 | `respondersHurt`(지원 대원 포함), `equipFailures`, 부대 활용률. 끝 상태는 없다 | — | `debrief.ts:166-206` |

측정(시드 3개, 보통): 교대당 `xpGained` 은 가운데 0.006~0.011, 상위 10% 0.03, 가장 큰 값 0.055. 교대 끝의 펌프 상태 0.36~0.97, 고장 0. 섬광탄은 교대마다 0~2개 쓴다. 화재의 소실률 0~0.14, 붕괴 현장의 잔해 칸 30~60. 대원 부상 0명(H1 이전 — H1 뒤에는 늘어난다).

### 1.3 이어받기를 넣을 자리가 이미 있는 곳

- 생성자의 넷째 인자 `extra`(`engine.ts:63`)가 선택 인자 묶음이다. 지금은 `force` 하나. 부르는 곳: `runner.ts:45`, `scripts/sweep.ts:27`, 테스트 73곳(모두 그대로 둔다 — 새 칸은 선택).
- `rng.fork` 는 부모 시드에서 갈라진다(`rng.ts:44`) — 새 흐름 이름을 더해도 기존 결과가 바뀌지 않는다. `sim.rng` 를 직접 뽑는 코드는 `src/sim` 에 없다.
- `logHash` 는 기록 **문장**과 틱만 섞는다(`events.ts:22-26`). 이어받은 상태가 결과를 바꿨는지는 문장으로만 드러난다 → 요약 한 줄에 지문을 넣는다(§4.2).
- 도시 지도의 고정 층은 `Sim` 이 바뀔 때마다 다시 만든다(`renderCity.ts:115`) — 교대 내내 그대로인 흔적은 교대 시작 때 정해진다.

---

## 2. 이어받은 상태 (`Carryover`) — 자료형

### 2.1 `types.ts` (추가만. 합집합 끝에는 새 줄로)

```ts
// ───────────────────────── 교대 간 지속 (I2 — sim/persist.ts) ─────────────────────────
/**
 * 다음 교대가 이어받는 상태 — Sim 생성자의 입력(extra.carry). 회복·수리·보충을 이미 반영한 "다음 교대가 시작할 때의 상태"다.
 * JSON 으로 저장·복원할 수 있는 꼴만 쓴다: Map·Set·typed array·Infinity·NaN·undefined 값을 넣지 않는다(선택 칸은 아예 빼 둔다).
 * 판(v)이 다르면 persist.readCarryover 가 옮기거나(옮기는 함수가 있을 때) 읽지 않는다.
 */
export interface Carryover {
  v: 1;
  shift: number;                         // 이 상태로 시작하는 교대가 조직의 몇 번째 교대인가 (새 조직의 첫 교대 = 1 이고 그 교대가 만든 상태 = 2)
  city: string;                          // 도시 지문 (persist.cityKey). 지금 도시와 다르면 places·roads 를 버린다
  from: { seed: string; hash: string; diff: string };    // 이 상태를 만든 교대 (화면·검증용. 결과에 쓰지 않고 지문에도 넣지 않는다)
  crew: CrewCarry[];
  units: UnitCarry[];
  stock: Partial<Record<StockId, number>>;               // 서(署) 창고에 남은 소모품 — 이번 교대에 지급하고 남는 것까지 포함한 수
  places: PlaceCarry[];
  roads: RoadCarry[];
}
export type StockId = 'flashbang';
/** 대원 한 사람. 열쇠는 자리(seat ?? name) — 명부에서 이름은 모두 다르다 */
export interface CrewCarry {
  name: string;                          // 이 사람의 이름
  seat?: string;                         // 신임 대원만: 이 사람이 앉은 명부 자리의 원래 이름 (없으면 name 이 자리)
  callsign: string;                      // 만들 때의 소속 (화면용 — 열쇠가 아니다)
  out: number;                           // 앞으로 빠지는 교대 수, 이번 교대 포함 (0 = 나온다 · -1 = 순직)
  cause: string | null;                  // 결장 이유 — H1 의 InjuryCause (H1 전에는 'injured' | 'down')
  health: number;                        // 이번 교대를 시작할 때의 체력 (결장 중이면 돌아올 때의 체력)
  dExp: number; dSkill: number;          // 기본 능력(조직 시드)에 더한 경험·숙련. 누적 (상한 EXP_CAP · SKILL_CAP)
  shifts: number; incidents: number;     // 경력: 나온 교대 수, 다룬 사건 수 (화면·문장)
  replaceIn?: number;                    // out === -1 일 때: 신임 대원이 이 자리에 오기까지 남은 교대
  recruit?: RecruitBase;                 // 신임 대원: 조직 시드에 없는 사람의 기본 능력
  kitFault?: string[];                   // (R1 뒤) 점검에서 드러나지 않아 이번 교대에도 고장인 개인 장비 (KitId)
}
export interface RecruitBase { skill: number; judgment: number; composure: number; fitness: number; teamwork: number; experience: number }
/** 부대 하나. 열쇠는 호출부호 (편성표 UNIT_DEFS 에서 모두 다르다). 인근 도시 지원 부대는 넣지 않는다 */
export interface UnitCarry {
  callsign: string;
  pump?: number;                         // 소방 부대: 펌프 상태 0..1 (적용할 때 장비 손잡이의 범위 pumpMin..pumpMax 로 자른다)
  service?: { readyAt: number; why: 'pump' | 'vehicle' };    // 정비 중: 교대 시작 뒤 readyAt 초까지 'oos'
}
/** 건물 한 채의 남은 피해. 열쇠는 Place.id (도시가 고정이라 열쇠가 된다 — city 지문으로 확인) */
export interface PlaceCarry {
  id: number;
  state: 'marked' | 'closed' | 'ruin';   // 흔적만 남음(사용) · 출입 통제(복구 공사) · 무너짐. 열린 터(q.open)는 marked 만 (§3.6)
  dmg: number; soot: number;             // 구조 손상 0..1 · 그을음 0..1
  repair: number;                        // closed·ruin 이 풀리기까지 남은 교대, 이번 교대 포함 (marked 면 0)
  cause: 'fire' | 'collapse' | 'blast' | 'burnout';
  inc: string;                           // 원인 사건 ("조직 3번째 교대 · 04 화재") — 문장용
  since: number;                         // 생긴 교대
  spot?: [number, number];               // 무너진 자리의 건물 안 상대 위치 0..1 (그림용 — G4 의 u·v)
  mark?: 'scorched' | 'blasted' | 'partial' | 'burnt' | 'collapsed';   // 이 상태를 만든 X6 의 건물 상태 (그림용 — X6 가 없으면 빼 둔다)
  opened?: true;                         // 이번 교대를 앞두고 출입 통제가 풀렸다 (문장용, 한 번만)
}
/** 도로 한 구간의 복구 공사. 열쇠는 RoadEdge.id */
export interface RoadCarry {
  edge: number;
  why: 'crack' | 'washout' | 'flood' | 'fire' | 'mud' | 'tree' | 'debris' | 'surface';
  lane: boolean;                         // true = 한 차로 공사(느려질 뿐 — slow), false = 전면 통제(closed)
  left: number;                          // 남은 교대, 이번 교대 포함 (1 = 이번 교대 안에 openAt 에 끝난다, 2 = 이번 교대 내내)
  openAt: number;                        // left === 1 일 때 끝나는 시각 (교대 시작 뒤 초, 60..900)
  inc: string; since: number;
}
/** 화면·보고서용 요약 (persist.carrySummary) */
export interface CarrySummary { shift: number; absent: number; fallen: number; service: number; marked: number; closed: number; ruin: number; roads: number; grown: number }
```

있는 자료형에 더하는 칸(모두 선택 칸 — 없으면 지금과 같다):

```ts
// Responder.status 의 합집합 끝에 새 줄로
    | 'off';                             // 이번 교대에 나오지 않음 (결장·공석). 현장에 내리지 않고 crewReady 에 세지 않는다
// Responder
seat?: string;                           // 신임 대원이 앉은 명부 자리 (persist 가 채운다)
relief?: boolean;                        // 본부 예비 인력 (이번 교대만 — 이어받지 않는다)
carryOut?: number;                       // status 'off' 일 때 남은 결장 교대 (-1 = 공석)
carryCause?: string | null;              // status 'off' 일 때 결장 이유
// Unit
readyAt?: number;                        // 정비 중인 부대가 운용에 들어가는 시각 (persist.tickCarry 가 본다)
oosWhy?: string;                         // 'oos' 의 이유 (화면용: '정비 중' · '결원')
pumpFails?: number;                      // 이번 교대에 펌프가 고장 난 횟수 (executor 의 펌프 고장 자리가 센다 — §3.3. 결과에 쓰지 않는다)
// Scene
wear?: { dmg: number; soot: number; cause: string; inc: string; pre: number };      // 이어받은 건물 상태 (persist.applyPlaceWear 가 현장을 만든 직후 채운다. pre = 처음부터 탄 칸으로 둔 수 — §3.6)
// ShiftReport
carry?: { shift: number; key: string; lines: string[] };   // 이어받은 상태와 그 영향 — 이어받은 상태로 시작한 교대만
carryNext?: CarrySummary;                                  // 다음 교대로 넘기는 것
```

`RoadEdge.closedReason` 은 `string | null` 이라 타입을 고치지 않고 값 `'repair'` 를 쓴다. `Sim`(`engine.ts`)에 `readonly carry: Carryover | null` 과 `carryState: CarryState`(아래, `persist.ts` 에 정의 — `TrafficState` 가 `traffic.ts` 에 있는 것과 같은 꼴) 두 칸.

**객체 모양(P1 이후의 규칙 — CLAUDE.md "자주 도는 객체의 모양", R1 §3 끝)**: 새 칸은 이어받은 상태가 있을 때만 붙이지 않고, **만드는 객체 글자에 처음부터 적는다**(해시는 바뀌지 않는다). `Responder` 의 `seat`·`relief`·`carryOut`·`carryCause` 는 `createRoster`·`createAidUnit` 의 대원 객체 글자에 `undefined` 로, `Unit` 의 `readyAt`·`oosWhy` 는 두 부대 객체 글자(편성표·지원)의 "나중에 붙는 칸" 줄에 같은 순서로 `undefined`, `pumpFails` 는 `0` 으로, `Scene.wear` 는 `createScene` 의 칸 채우기 줄에 `undefined` 로 적는다. 예비 인력(§3.2)은 대원 객체 글자를 같은 순서로 만든다.

`types.ts` 의 I1-b 칸에 하나 더한다: `WorldTag` 합집합 끝에 `| 'carry'`(이 묶음의 기록을 측정 도구가 시스템 `carry` 로 세게 한다 — §3.7·§7).

### 2.2 `persist.ts` 의 실행 중 상태

```ts
export interface CarryState {
  on: boolean;                                   // 이어받은 상태가 있는가 (없으면 모든 함수가 첫 줄에서 돌아간다)
  places: Map<number, PlaceCarry>;               // 건물 겹침 표 (교대 내내 그대로 — 교대 안의 새 피해는 끝날 때 placeOutcome 이 읽는다)
  roads: RoadCarry[];                            // 이번 교대에 끝날 복구 공사 (left === 1, openAt 순)
  slowed: { edge: number; v: number }[];         // 이 파일이 더해 둔 slow (한 차로 공사, 출입 통제 건물 앞)
  svc: number;                                   // 정비 중인 부대 수 (tickCarry 가 0 이면 정비 쪽을 건너뛴다)
  event: number;                                 // 이어받은 상태 요약 기록의 id (-1 = 없음). 원인으로 잇는다
  applied: CarryNote[];                          // ①·② 가 실제로 적용한 항목 (적용한 순서) — announceCarry 가 이것만 기록한다
  dropped: string[];                             // 적용하지 못한 것 (도시가 끊길 통제, 지도 지문 불일치, 조직 명부에 없는 열쇠, 상한을 넘은 항목) — announceCarry 가 적는다
  stats: { relief: number; serviced: number; reopened: number; markedInc: string[]; fbShort: number; early: number };
}
/** 적용한 항목 하나 (기록 한 줄의 재료). 상태를 바꾼 함수가 그 자리에서 push 한다 */
export type CarryNote =
  | { what: 'absent'; unit: string; names: string[]; cause: string | null; left: number }
  | { what: 'vacant'; unit: string; name: string; left: number }
  | { what: 'recruit'; unit: string; name: string; seat: string }
  | { what: 'early'; name: string }
  | { what: 'relief'; unit: string; name: string; role?: string }
  | { what: 'short'; unit: string; n: number }                       // 예비 인력이 모자라 최소 편성보다 적은 n명(내리는 대원)으로 운용 — oos 가 아니다(결원 감점만)
  | { what: 'empty'; unit: string; why: 'crew' | 'pilot' }          // 나올 내리는 대원이 한 명도 없거나(crew) 조종·조타할 사람이 없어(pilot) oos '결원'
  | { what: 'service'; unit: string; readyAt: number }
  | { what: 'rushed'; unit: string }                                 // SERVICE_CAP 을 넘어 '급히 정비 완료'
  | { what: 'stock'; unit: string; got: number; want: number }
  | { what: 'place'; id: number }                                    // closed·ruin 건물 (opened 도 이 항목으로)
  | { what: 'road'; edge: number; lane: boolean; left: number; openAt: number };
```

- `carryState.places` 의 항목은 `sim.carry.places` 의 **사본**이다(`initCarry` 가 깊이 복사해 넣는다). 교대 내내 바뀌지 않는다.

### 2.3 열쇠와 판

| 무엇 | 열쇠 | 이유 |
|---|---|---|
| 대원 | `seat ?? name` | `rid`(=`sim.responders` 의 순번)는 부대 규모 손잡이에 따라 바뀐다(`resources.ts:66` — 편성될 때만 넣는다). 이름은 40명(R1 뒤 63명 + 예비) 모두 다르고 교대가 바뀌어도 그대로다(`sim.test.ts:289,293` 도 이름으로 찾는다) |
| 부대 | `callsign` | 편성표에서 모두 다르다. 지원 부대(`u.aid`)는 넣지 않는다 |
| 건물 | `Place.id` | 도시가 고정이다. 지도(`cityPlan.ts`)를 바꾸면 id 가 달라지므로 `city` 지문으로 확인하고, 다르면 건물·도로를 버린다(대원·부대·재고는 남는다) |
| 도로 | `RoadEdge.id` | 같은 이유 |

- `cityKey(city)`: `hashStr` 로 `places.length`, `edges.length`, 건물마다 `kind`·`x|0`·`y|0`, 구간마다 `a`·`b` 를 차례로 섞은 8자리 16진수. `WeakMap<object, string>`(열쇠 `city.places`)에 한 번만 센다(`incidents.ts:47` 의 `kindCount` 와 같은 꼴).
- **판** `v: 1`. 선택 칸을 더하는 것(R1 의 `kitFault`, 나중의 조직 기억)은 판을 올리지 않는다. 칸의 **뜻**이 바뀌면 판을 올리고 `readCarryover` 에 `v1 → v2` 를 옮기는 함수를 둔다. 옮길 수 없으면 `null`(새 조직으로 시작).
- **지문** `carryKey(co)`: `from` 을 뺀 나머지를 정해진 순서(대원은 열쇠 순, 건물·도로는 id 순, 객체의 칸은 이름 순)로 직렬화해 `hashStr` 한 8자리 16진수. 숫자는 만들 때 소수 넷째 자리로 반올림해 두므로(§3.2 끝) JSON 왕복에서 바뀌지 않는다.

### 2.4 `readCarryover(x, city): { carry: Carryover; dropped: string[] } | null`

입력(저장소에서 읽은 것, 테스트가 만든 것)을 검사하며 **새 객체로** 만든다. 시뮬레이션은 이 결과만 쓰고 원래 입력은 건드리지 않는다.

- 객체가 아니거나 `v` 가 1 이 아니고 옮기는 함수도 없으면 `null`. `crew`·`units`·`places`·`roads` 가 배열이 아니거나 `stock` 이 객체가 아니면 `null`.
- 숫자는 유한한지 보고 범위로 자른다: `shift` 는 1 이상의 정수(아니면 `null`), `out ∈ [-1, 3]`, `replaceIn ∈ [0, REPLACE_AFTER]`, `health ∈ [1, 100]`, `dExp ∈ [0, EXP_CAP]`, `dSkill ∈ [0, SKILL_CAP]`, `shifts·incidents` 0 이상의 정수, `pump ∈ [0, 1]`, `readyAt ∈ [0, 900]`, `dmg·soot ∈ [0, 1]`, `repair ∈ [0, 6]`, `left ∈ [1, 2]`, `openAt ∈ [60, 900]`, `since ∈ [1, shift]`, 재고 `[0, STOCK_CAP]`. `recruit` 의 능력치는 `createRoster` 의 범위로 자른다(`skill` 0.3~0.98, `judgment` 0.2~0.98, 나머지 0~1, `experience` 0~0.97).
- 열거값(`state`·`cause`·`why`·`mark`·`service.why`)이 모르는 값이면 그 항목을 버린다. `kitFault` 는 R1 의 `KitId` 인 것만 남긴다. 모르는 `stock` 열쇠는 버린다.
- `closed`·`ruin` 인데 `repair` 가 0 이거나 그 건물이 열린 터(`q.open`)면 `marked` 로 읽는다(복구가 끝난 것으로 본다 / 열린 터는 흔적만 — §3.6).
- `city` 가 `cityKey(city)` 와 다르면 `places`·`roads` 를 비우고 `dropped` 에 '도시 지도가 바뀌어 건물·도로 상태는 이어받지 않습니다.'
- 범위를 벗어난 건물·구간 id, 출동 시설(`facility ≥ 0`)인 건물, 같은 열쇠가 둘인 항목은 버린다(뒤의 것).
- **조직 명부에 없는 열쇠는 여기서 버린다.** `sim.responders`·`sim.units` 에는 편성된 사람·부대만 있으므로(`resources.ts:86` 의 `if (include)`) "이번에 편성되지 않은 사람"과 "조직에 없는 이름"을 가를 수 없다. 그래서 편성과 상관없이 조직 전체의 열쇠를 돌려주는 `resources.rosterKeys()`(§10.2)로 판정한다. 그 목록에 없는 대원 열쇠(`seat ?? name`), `UNIT_DEFS` 에 없는 호출부호는 버리고 `dropped` 에 '조직 명부에 없는 대원 n명의 기록은 버립니다.' 편성되지 않은 사람·부대의 항목은 **남는다** — 적용 단계는 그 항목을 건너뛰고, `makeCarryover` 가 `sim.carry` 에서 이어 간다(§3.1).
- **상한도 읽을 때 건다**(§6.1과 같은 값): 건물 `PLACE_CAP`, 그 가운데 `closed`·`ruin` `CLOSED_CAP`, 도로 `ROAD_CAP`. 넘는 것은 `repair`(도로는 `left`)가 큰 순, 같으면 id 순으로 남기고 나머지를 버린다(`dropped` 에 한 줄). 정비의 `SERVICE_CAP` 은 적용할 때 건다(§3.3 — 넘는 부대는 '급히 정비 완료'라 버리는 것이 아니다).

---

## 3. 만들기와 적용

### 3.1 흐름과 교대 사이의 시간

```
교대 N (carry = C_N 또는 null) ──▶ 끝(sim.ended) ──▶ makeCarryover(sim) = C_{N+1}
                                                      ├ 끝 상태 읽기 (대원·부대·건물·도로)
                                                      ├ 휴식 한 번 적용 (회복·수리·보충 — §3.2~3.3·§3.5~3.6 의 표)
                                                      └ 상한 (§6)
교대 N+1 = new Sim(seed', d', 1200, { carry: C_{N+1} })  ── 적용 (§3.4~3.6) ── 기록 (§3.7)
```

- **교대 사이의 시간은 "휴식 한 번"으로 고정한다.** 남은 결장·수리·복구는 모두 교대 수로 센다. 교대 시각(`startTod`)과 날씨는 지금처럼 그 교대의 `environment` 흐름이 정한다 — 앞 교대가 밤이었는지에 따라 회복이 달라지지 않는다(결정 — 날씨와 시각을 이어 붙이려면 `environment` 흐름의 뽑기를 바꿔야 하고, 그러면 이어받은 상태가 없는 교대도 결과가 바뀐다).
- `Carryover` 는 **휴식을 이미 반영한** 상태다. 그래서 화면은 저장된 상태만 보고 "다음 교대 결장 2명"을 말할 수 있고, 적용은 그대로 옮기기만 하면 된다.
- **끝난 교대만** 상태를 만든다. 진행 중인 교대를 버리고 새로 시작하면 그 교대는 조직에 남지 않는다(저장된 상태 그대로 다시 시작).
- **이번 교대에 나오지 않은 사람·부대도 휴식은 한다.** 부대 규모 손잡이가 낮아 편성되지 않은 부대, 결장한 대원의 항목은 앞 상태(`sim.carry`)에서 그대로 가져와 휴식만 적용한다. 손잡이를 내렸다 올려도 그 사이의 기록이 사라지지 않는다. 어떤 열쇠가 "조직의 사람"인지는 `resources.rosterKeys()` 로 본다(§2.4).

`makeCarryover(sim)` 은 `sim.ended` 일 때만 부른다(아니면 예외). 난수는 `sim.rng.fork('carry')` 하나(복구 시각·정비 시각)와 신임 대원의 `sim.rng.fork('recruit:' + 자리)` 뿐이다 — 부모 시드에서 갈라지므로 몇 번 불러도 같은 결과다. `buildReport` 도 같은 계산을 쓴다(`carryNext` — `from.hash` 만 비워 둔 채). `buildReport` 는 마지막 기록('교대 종료')과 해시를 정하기 **전에** 불리므로(`engine.ts` `checkShiftEnd`), **`makeCarryover` 는 순수 함수다**: `sim`·`sim.carry`·`carryState`·현장·기록을 고치지 않고, `emit` 하지 않으며, 돌려주는 객체는 모두 새로 만든다(앞 상태의 항목을 그대로 넣지 않고 복사한다). 테스트 1 이 `makeCarryover` 를 두 번 불러 같은 결과인지, 부른 뒤 `report.hash` 가 그대로인지 본다.

### 3.2 대원

**끝 상태에서 다음 교대로** (`crewNext`, 지원 대원·예비 인력은 넣지 않는다). 대상은 `resources.rosterKeys()` 의 모든 열쇠다(편성되지 않은 사람 포함). 열쇠마다 **위에서부터 첫 번째로 맞는 행**을 쓴다:

| 순서 | 그 사람 | `out` (다음에 빠지는 교대 수) | `health` | 성장 |
|---|---|---|---|---|
| 1 | 앞 상태가 공석(`out === −1`) — 편성 여부·이번 교대의 `off` 와 상관없이 언제나 | −1, `replaceIn − 1`. 0 이 되면 신임 대원(아래) | — | — |
| 2 | 이번 교대에 편성되었고 `status 'off'`(결장) | 앞 값 − 1 (0 이 되면 나온다) | 앞 값 | 없음 |
| 3 | 이번 교대에 편성되지 않음(앞 값 0 이상) | `max(0, 앞 값 − 1)` | 앞 값이 0 이면 `min(100, 앞 값 + REST_HEAL)`, 아니면 앞 값 | 없음 |
| 4 | 편성되어 나온 사람 — H1 의 `outShifts(r)` 가 −1(순직) | −1, `replaceIn = REPLACE_AFTER`(2) | — | 없음 |
| 5 | 〃 `outShifts(r) > 0` | `outShifts(r)` (3·2·1) | `BACK_HEALTH` 85 | 있음 |
| 6 | 〃 `outShifts(r) === 0` | 0 | `min(100, 끝 체력 + REST_HEAL 40)` | 있음 |

- **결장 표는 H1 의 `outShifts(r)`(`injury.ts`) 하나에만 있다**(H1 §3.7). I2 는 이 함수를 부르고, 같은 표를 `persist.ts` 에 두지 않는다. 쓰러짐은 H1 의 식대로 `r.tDown !== undefined` 로 본다. H1 표에는 교대가 끝날 때 아직 병원에 닿지 않은 두 경우가 없다. **교대 끝에 후송 중(`r.care === 'aboard'`)**, 그리고 **쓰러진 채 병원도 후송도 아님**(`r.tDown !== undefined && r.care === undefined` — 현장이나 안전 구역에서 교대가 끝남)이다. 둘 다 교대 뒤에 병원에 인계된다고 보고, H1 의 병원 줄과 같게 센다(쓰러졌으면 3, 아니면 2). 이 두 줄은 H1 §3.7 표에 들어갔다(반영됨). H1 구현이 이 두 줄을 넣지 않았으면, I2 1단계가 `outShifts` **안에** 더한다(§10.2 — 표가 두 곳에 생기지 않게. H1 의 보고서 `out` 도 함께 바뀐다).
- H1 이 아직 합쳐지지 않았으면(대체) `status` 만 본다: `down` 2, `injured` 1, `ok` 0(순직·병원 없음). 구현 순서상 H1 이 먼저이므로 대체는 쓰이지 않을 것이다.
- `cause`: H1 의 `mainCause(r.injuries)`(피해가 가장 큰 원인), H1 전에는 `status` 문자열.
- **성장** (K1): 이번 교대의 `xpGained` 으로
  ```
  gain   = min(GAIN_CAP 0.02, r.xpGained × GAIN_K 0.5) × (1 − r.experience)       // 이미 노련한 사람은 덜 는다
  dExp   = min(EXP_CAP 0.25, 앞 dExp + gain)
  dSkill = min(SKILL_CAP 0.15, 앞 dSkill + gain × SKILL_K 0.6)
  shifts += 1, incidents += r.incidentsWorked
  ```
  측정(§1.2)으로 보면 활발한 대원이 교대당 0.01~0.02 쯤, 열 교대에 0.05~0.15 쯤 는다. **(확인 필요: R1·H1 뒤 `xpGained` 의 분포를 다시 재고 `GAIN_K` 를 정한다. 목표는 "열 교대 뒤 가장 많이 큰 대원의 경험 +0.15 안팎")**
- **신임 대원**: 공석의 `replaceIn` 이 0 이 되는 휴식에서, 그 항목을 신임 대원으로 바꾼다: `name` = `RECRUIT_NAMES` 에서 아직 쓰지 않은 첫 이름(모두 쓰면 이름 뒤에 숫자), `seat` = 원래 자리 이름, `recruit` = `sim.rng.fork('recruit:' + 자리)` 에서 `createRoster` 와 같은 식(경험 0.1~0.3, `st()` 범위 0.3~0.85)으로, `out 0`, `health 100`, `dExp·dSkill·shifts·incidents 0`. `RECRUIT_NAMES` 는 `NAMES`·`EXTRA_NAMES`(R1)·`AID_NAMES`·`RELIEF_NAMES` 와 겹치지 않는 가상의 이름 24개(`persist.ts` 안). **한 휴식에서 여러 자리가 신임으로 바뀌면** `rosterKeys()` 의 순서(`UNIT_DEFS` 순 × 자리 순)대로 이름을 나눠 준다. "아직 쓰지 않은" 이름은 새 상태의 `crew` 에 이미 있는 이름(앞에서 배치된 신임 포함)을 뺀 것이다. 그래서 같은 입력이면 같은 이름이 같은 자리에 간다.
- (R1 뒤) `kitFault`: 이번 교대에 고장이었던 개인 장비 가운데 **드러난 것**(`faultKnown`)은 점검에서 고친다(넣지 않는다). 드러나지 않은 것은 점검에서 절반을 찾는다 — `hashStr(seat + ':' + kitId + ':' + shift) % 2 === 0` 이면 고치고, 아니면 `kitFault` 에 남긴다(난수 흐름을 쓰지 않는다).

**다음 교대에 적용** (`applyCrewCarry`, `createRoster` 가 모든 난수를 뽑고 대원·부대를 만든 **뒤**):

1. 대원마다 열쇠(`r.seat ?? r.name`)로 항목을 찾는다. 없으면 그대로(새 사람).
2. 신임 대원 항목(`recruit` 가 있다)이면 그 자리(`seat` 이름의 대원)를 **같은 rid 그대로** 신임 대원으로 바꾼다: `name`, `seat`, 기본 능력 여섯 개, `skills`(R1 의 역할 식 — 아래), `trait = traitOf(r)`. **`role`·`kit` 은 그 자리의 것을 그대로 받는다**(R1 이 자리에 맞춰 채운 값 — `kit` 은 기본 장비 사본이고 고장 추첨도 이미 끝나 있다. 앞 사람의 `kitFault` 는 넘기지 않는다). 같은 rid 를 쓰므로 `sim.responders` 의 순서와 현장 개체 흐름(`agent:<사건>:<rid>`)의 이름이 그대로다. 처음 오는 교대(`shift` 가 그 항목이 신임으로 바뀐 다음 교대)면 `applied` 에 `recruit`.
3. 성장: `experience = min(0.97, 기본 + dExp)`, `skill = clamp(기본 skill + dSkill, 0.3, 0.98)`, `judgment = clamp(기본 + 0.35 × dExp, 0.2, 0.98)`(`createRoster` 의 식에서 경험의 몫), `skills` = R1 의 역할 식(`ROLES[r.role]` 의 skills 식에 새 `skill` 을 넣은 값), `trait = traitOf(r)`. **R1 뒤에는 `skills` 를 역할로 정한다**(R1 §2·§5 — `resources.ts:80-84` 의 부대 종류·부서 식은 R1 을 합치면 없어진다). R1 이 export 하는 `skillsOf(role, skill)`(R1 §4 — 반영됨)를 쓴다. R1 이 아직 없으면(대체) `resources.ts:80-84` 를 `skillsFor(kind, dept, skill)` 로 꺼낸다.
4. `out > 0` 또는 `out === −1` 이면 `status = 'off'`, `carryOut = out`, `carryCause = cause`, **`stamina = 100`**. 지구력은 `ok` 인 사람만 회복하는데(`resources.ts:326`), 배정의 평균 지구력(`dispatcher.ts:75-76`, R1 뒤에는 `fieldCrew` 기준 — 결장자도 자리가 있으므로 들어간다)은 결장자를 뺄 수 없다(`dispatch/*` 는 고치지 않는다). 장비 손잡이 1·2 의 `startStamina`(65·82, `difficulty.ts:104`)로 두면 결장자가 교대 내내 감점을 남긴다. 100 으로 두면, 다른 대원이 서에서 1분 남짓이면 100 으로 차므로 교대 첫머리에만 평균을 조금 올린다(알려진 한계 — §11.1). 결장·공석은 부대마다 모아 `applied` 에 `absent`(이름들·원인·남은 교대)·`vacant`(자리마다) 항목으로 넣는다. 아니면 `health = 항목의 health`.
5. **결장 상한**(§6): 편성된 대원 가운데 `off`(공석 제외)가 `ABSENT_CAP` 을 넘으면, 남은 결장이 짧은 사람부터(같으면 이름 순) 넘는 만큼 `status 'ok'`, `health EARLY_BACK_HEALTH 70` 으로 되돌린다('조기 복귀', `stats.early++`, `applied` 에 `early`).
6. **예비 인력** — 결장으로 빈 자리를 본부 예비 인력이 채운다. 어디까지 채우나(결원)는 R1 의 `crewReady` 와 **같은 단위**로 센다. R1 의 `crewReady` 는 내리는 자리(`fieldCrew`)만 센다(R1 §5). 그래서 기준도 내리는 자리로 잡는다:
   - `need(u)` = `minField(u.kind)` = 최소 편성(`STAFF[kind].std` 에서 `minDrop` 자리를 뺀 것) 가운데 `stays` 가 아닌 역할의 수. 최소 편성의 모든 자리가 `stays` 면(경찰 헬기 — R1 의 `fieldCrew` 가 그때 전원을 돌려주는 것과 같은 규칙) 최소 편성의 자리 수. R1 이 export 하는 `minField(kind)`(R1 §4 — 반영됨)를 쓴다. R1 없이 1. **`need` 는 채우는 목표일 뿐 운용 여부의 기준이 아니다** — H1 의 `crewReady` 는 `minField` 와 견주지 않는다 — 부대의 운용 중단은 그 부대 대원이 전부 숨졌을 때만이고 부분 결원은 −18 감점만이다(H1 §3.6, 사용자 최종 결정 2026-11-15). I2 도 같은 정신으로, 예비 인력이 모자라도 출근한 대원이 한 명이라도 있으면 그 인원으로 운용한다(아래 "채우지 못하면").
   - 보기(R1 표): 진압 펌프차 3(내리는 자리뿐), 소방 헬기 2(항공 구조대원 둘 — 기장은 내리지 않는다), 구조정 2, 의료 헬기 2, 경찰 헬기 2(전원 내리지 않음 → 최소 편성 전원).
   - **내리지 않는 자리의 운용**: 내리는 자리와 내리지 않는 자리가 섞인 부대(소방·의료 헬기, 구조정)는, `stays` 역할 가운데 `status !== 'off'` 인 사람이 최소 편성의 `stays` 자리 수보다 적으면 예비 인력으로 먼저 채운다(아래 ⓑ). R1 표에서 이 부대들의 최소 편성에 남는 `stays` 자리는 하나(기장 또는 정장)뿐이므로, 채우지 못해 운용하지 못하는 것은 조종·조타할 사람이 한 명도 없을 때뿐이다 — 인원 문턱이 아니라 그 차를 움직일 사람이 없어서다(헬기가 조종사 없이 뜨지 않게 — 그 사람은 `crewReady` 에 세지 않으므로 따로 본다).
   - 부대 순서(`sim.units`)대로, 정비 중이 아니고 ⓐ `crewReady(sim, u) < need(u)` 이거나 ⓑ 내리지 않는 자리가 모자란 부대에 `RELIEF_MAX`(4명) 안에서 예비 인력을 한 명씩 붙인다. 붙이는 자리는 `off` 인 자리 가운데 모자란 쪽(ⓑ 가 먼저 — 조종사)의 자리 순서로 첫 번째 것이다. 예비 인력은 그 자리의 `role` 을 받고, 기본 `kit`(R1 `ROLES[role]` 의 기본 장비를 `{ id }` 로 복사. 섬광탄 `uses 0`, 테이저 `uses 2` — R1 §5 의 규칙)과 역할 식의 `skills`, `senior: false`, `dept = u.dept` 를 받는다. 능력치는 `sim.rng.fork('relief:' + u.callsign)` 에서 `createAidUnit` 의 후임 식(경험 0.15~0.55 — R1 §5 의 지원 부대 "그 밖의 자리" 범위), 이름은 `RELIEF_NAMES`(가상의 이름 8개) 차례로, `relief: true`. `sim.responders` 와 `u.crew` 끝에 넣는다(지원 부대처럼 — 기존 rid 는 그대로). 자리 번호는 없다 — R1 의 `stays`·`fieldCrew` 는 역할로 보므로 그대로 맞다. 붙일 때마다 `applied` 에 `relief`. **채우지 못하면**(예비 인력이 바닥남): 출근한 내리는 대원이 한 명 이상이고(`crewReady(sim, u) > 0`) 조종·조타할 사람이 있으면(그런 자리가 있는 부대만) **그 인원으로 운용한다** — `oos` 가 아니고, 배정에서 지금의 결원 감점(−18)만 받는다(`applied` 에 `short`, `n` = 그때의 `crewReady`). 출근한 내리는 대원이 한 명도 없거나(`crewReady === 0` — `why 'crew'`) 조종·조타할 사람이 없을 때만(`why 'pilot'`) `u.state = 'oos'`, `u.oosWhy = '결원'`(이번 교대 내내, `applied` 에 `empty`).
   - **결장이 없으면 아무 일도 없다**: 헬기·구조정의 표준 편성에서 아무도 `off` 가 아니면 ⓐ(`crewReady` 2 ≥ 2)도 ⓑ도 거짓이다(테스트 8).
7. (R1 뒤) `kitFault` 의 장비는 R1 의 `kit` 고장 추첨(`kit` 흐름 — 그대로 다 뽑는다) **뒤에** `fault = true` 로 더한다.

**`status 'off'` 가 지나가는 곳** — 이미 `status` 로 사람을 고르는 곳은 저절로 뺀다: `crewReady`(`resources.ts:166` — H1 뒤에는 걸을 수 있는 대원, 곧 `status` 가 `ok`·`injured` 인 사람만 센다)·`crewOk`(`ok` 만), `unitArrived` 의 내리는 사람(`sceneManager.ts:61` — H1 뒤 `crewReady` 와 같은 술어), 지구력 회복(`resources.ts:326`). 고쳐야 하는 곳:
- `debrief.buildReport` 의 `respondersHurt`(`debrief.ts:185`): `status !== 'ok' && status !== 'off'`.
- `resources.dispatchUnit` 의 출동 준비 시간(`resources.ts:236`)이 `u.crew[0]` 의 경험을 본다 → R1 뒤 `fieldCrew(sim, u).find((rid) => sim.responders[rid].status !== 'off') ?? u.crew[0]`(R1 없이는 `u.crew.find(…)`). 이어받은 상태가 없으면 `off` 가 없으므로 결과가 같다(`injured` 를 거르지 않는 것은 일부러다 — 지금 결과를 지킨다).
- H1 의 `arrive` 문구를 고르는 두 판정('내리는 대원이 모두 숨졌나', '숨지지 않은 대원이 모두 후송됐나'): `status !== 'off'` 인 대원만 본다 — 결장자는 '숨진 대원'도 '남은 대원'도 아니다. 그러지 않으면 출근한 대원이 모두 숨진 부대가 '전원 순직'이 아닌 문구를, 출근한 대원이 모두 후송된 부대가 '걸을 수 있는 대원이 없어' 문구를 받는다. `crewReady`·`crewOk` 는 고칠 것이 없다(결장자를 이미 세지 않는다).
- `resources.arrive` 의 복귀 기록(`crewReady === 0` 이라 `oos` 가 되는 자리): H1 이 이 기록을 세 갈래로 나눈다(H1 §3.6 — 전원 순직이면 '대원 전원 순직 — 운용 중단.', 숨지지 않은 대원이 모두 후송됐으면 '남은 대원 모두 병원 이송 — 운용 중단.', 그 밖은 '걸을 수 있는 대원이 없어 운용 중단.'. 지금의 '대원 전원 부상으로 운용 중단.' 은 H1 이 없앤다). **I2 는 문구를 더하지 않는다**: 교대 중에 `crewReady` 가 0 이 되는 것은 출근한 대원이 모두 숨지거나 쓰러지거나 후송됐을 때뿐이고(결장자는 처음부터 세지 않는다 — 위 줄), 결장 때문에 부대가 멈추는 일은 교대 시작의 적용 6(`empty`)과 정비 뒤의 `operable`(§3.7)에서만 생긴다. 세 문구 모두 문구 규칙 T6 이 잡는다(H1 4b 가 넓힌 꼴 — I1 §2.3). 이어받은 상태가 없으면 결과·기록 불변.
- H1 의 명부 출력(`ShiftReport.roster`)에서 `off` 인 대원의 `out` 은 `crewNext` 의 값.
- 구현을 시작할 때 `grep -n "\.status" src/sim src/ui` 로 `Responder.status` 를 보는 곳을 모두 다시 확인한다(§11.1 의 2).

결원 부대(예비 인력이 모자라 적은 인원으로 나온 부대 포함)는 지금 규칙 그대로 배정에서 −18(온전한 대원이 정원보다 적으면 한 번 — `dispatcher.ts:78`. R1 뒤 `crewReady < fieldCrew.length`, H1 뒤 `crewOk < fieldCrew.length` — H1 §6.4)만 받고 계속 출동한다. 나온 내리는 대원이 한 명도 없으면 `crewReady` 0 이라 배정에서 빠지고(`dispatcher.ts:60`) 적용 6 이 `oos` '결원'으로 둔다 — I2 는 관제 코드를 고치지 않는다(`pickUnit` 의 두 줄은 H1 이 고친다). 결원은 조직이 아는 사실이라 정보 격리에도 맞다.

**결장(`off`)과 이 교대의 부상(`injured`)은 다르다.** 결장은 출근하지 않는 것이고 — 명부에 남지만 차에 타지도, 현장에 내리지도, 가벼운 일을 맡지도 않는다 — 부상은 이 교대 안의 상태다. H1 의 사용자 결정 "가벼운 일은 계속"(2026-11-15 — 걸을 수 있는 다친 대원은 그 교대 안에서 부대에 타고 다음 현장에도 내려 가벼운 일만 맡는다, H1 §3.6·§3.6a)은 교대 안의 규칙이고, 교대가 끝나면 H1 의 `outShifts` 표대로 쉰다(병원에 가지 않은 `injured` 는 1교대 결장, 병원 인계 2, 쓰러진 적 있음 3 — H1 §3.7). 두 규칙은 겹치지 않는다: 이어받는 대원 상태는 `off`(결장) 아니면 `ok`(체력만 이어받음 — §3.2 표)뿐이라 **다음 교대에 `injured` 로 출근하는 사람은 없다**. 그래서 결장 표(`outShifts`)를 바꾸지 않고, 가벼운 일을 하며 교대를 마친 다친 대원도 표대로 다음 교대에 결장한다(교대 안에서 일을 계속한 것은 다음 교대의 휴식을 줄이지 않는다). 결장 상한(§6)·예비 인력(적용 6)은 `off` 만 세고, 교대 안에서 다친 사람은 세지 않는다.

### 3.3 장비

| 무엇 | 끝 상태 → 다음 교대 (휴식 한 번) | 적용 |
|---|---|---|
| 펌프 (`pumpCond`) | 이번 교대에 펌프가 고장 난 적이 있으면 `service = { readyAt: carry 흐름 range(300, 720), why: 'pump' }`, `pump = 0.7`(정밀 정비). 아니면 `pump = min(1, 끝 값 + PUMP_REST 0.12)`(점검). 고장 여부는 끝의 `pumpFailed` 로 알 수 없다 — 서로 돌아오면 0.55, 현장 보급이면 0.62 로 고친 채 `false` 가 된다(`resources.ts:312`, `executor.ts` `case 'resupply'`). 기록 문구로 세면 R1 이 문구를 바꿀 때 조용히 깨진다. 그래서 **부대의 고장 횟수 칸 `u.pumpFails`** 로 센다: 펌프 고장을 세우는 자리(지금 `executor.ts:252-254` 의 `u.pumpFailed = true` 줄 — R1 이 옮기면 그 자리)에 `u.pumpFails = (u.pumpFails ?? 0) + 1` 한 줄. 결과에 쓰지 않으므로 해시가 같다. `pumpFails > 0` 이거나 끝에 `pumpFailed` 인 채면(돌아오지 못하고 끝남) 고장으로 친다 | `createRoster` 가 `equipment` 흐름에서 지금처럼 뽑은 **뒤에** `u.pumpCond = clamp(pump, tn.pumpMin, tn.pumpMax)` — 장비 손잡이는 범위를, 이어받은 상태는 그 안의 위치를 정한다. 항목이 없으면 뽑은 값 그대로 |
| 정비 (`service`) | 정비 중인 채로 끝난 부대(교대 내내 편성되지 않아 정비하지 못한 경우 포함)는 휴식에서 정비를 마친다(넣지 않는다) | `u.state = 'oos'`, `u.readyAt = min(readyAt, shiftLen × 0.75)`(짧은 교대 — §3.5 끝), `u.oosWhy = '정비 중'`, `applied` 에 `service`. 한꺼번에 `SERVICE_CAP`(2대)까지 — 넘는 것은 `readyAt` 이 이른 순으로 남기고 나머지는 '급히 정비 완료'(`pump 0.6`, 바로 운용, `applied` 에 `rushed`). `tickCarry` 가 `readyAt` 에 운용으로 돌린다(§3.7) |
| 섬광탄 (`stock.flashbang`) | `창고 = min(STOCK_CAP 10, 교대 시작 때 지급하고 남은 창고 + 부대에 남은 섬광탄 + RESUPPLY 3)` | 기동·특공 부대에 편성표 순서(`sim.units`)대로 정수(기동 `tn.flashbangs`, 특공 `+2`)만큼 창고에서 지급한다. 창고가 모자라면 있는 만큼, 단 정수가 1 이상인 부대는 적어도 1개(비상 지급 — 창고에서 빼지 않는다). 모자란 수는 `stats.fbShort`, 모자란 부대마다 `applied` 에 `stock`. 이어받은 상태가 없으면 지금처럼 정수 그대로. 보기: 보통(기동1 정수 2, 특공1 정수 4 — 기동2 는 규모 4부터)에서 창고 1 이면 편성표 순서상 먼저인 기동1 이 창고에서 1개를 받고(창고 0), 특공1 은 비상 지급 1개를 받는다. `fbShort` = 1 + 3 = 4 |
| 물·공기·헬기 연료·공구·처치 장비·방호 | 이어받지 않는다(서에서 채운다 / 손잡이 값) | — |
| (R1 뒤) 개인 장비 고장 | §3.2 의 `kitFault` | §3.2 의 7 |
| 차량 손상 | 지금도 X6 초안에도 없다. 나중에 차량이 다치는 모델이 생기면 `service = { readyAt: …, why: 'vehicle' }` 로 받는다 | 펌프 정비와 같다 |

창고의 처음 값(이어받은 상태가 없는 교대가 만든 상태)은 `STOCK_CAP` 에서 시작한 것으로 센다: `창고 = min(10, 10 − 처음 지급 + 남은 수 + 3)`. 보통에서 기동 2·특공 4 를 지급하고 2개를 쓰면 다음 교대의 창고는 다시 10 이다(`4 + 4 + 3` → 10). 지급한 여섯 개를 다 쓰는 교대가 두 번 이어지면(창고 10 → 7 → 4) 세 번째 교대에서 특공이 2개 덜 받는다 — 조용한 교대 한 번이면 회복된다.

### 3.4 적용의 자리와 순서 (`engine.ts` 생성자)

```ts
constructor(seed, difficulty = NORMAL, shiftLen = 1200, extra: { force?: string | null; carry?: Carryover | null } = {}) {
  … // force · seed · difficulty · tune · shiftLen · hardCap · rng · fork 다섯 · 날씨 · startTod — 지금 그대로
  this.city = generateCity(new Rng(CITY_SEED));
  const rc = extra.carry ? readCarryover(extra.carry, this.city) : null;
  this.carry = rc ? rc.carry : null;
  this.carryState = initCarry(this, rc?.dropped ?? []);     // ① 건물 겹침 표, 도로 복구 통제 — initTraffic 앞
  this.traffic = initTraffic(this);
  createRoster(this);
  applyCrewCarry(this);                                      // ② 대원·부대·재고 — createRoster 의 난수를 다 뽑은 뒤 값만 바꾼다
  this.gen = initGenerator(this.rngGen);
  this.gen.majorAt = …;                                      // 그대로
  this.disaster = initDisaster(this);
  this.world = initWorld(this);                              // (I1-b) I1-b 가 둔 자리 그대로. I2 는 옮기지 않고 carry 를 넘기지 않는다
  emit(this, { … '교대 시작. … 가용 부대 …' });              // 이어받은 상태가 없으면 문구 그대로 (있을 때만 아래처럼)
  // (R1) 안개·야간 헬기 운항 기록 — R1 이 '교대 시작' 바로 뒤에 둔 줄 그대로
  announceCarry(this);                                       // ③ 이어받은 상태의 기록 — carry 가 있을 때만
}
step(): … tickTraffic(this); tickCarry(this); tickDisaster(this); (I1-b) tickWorld(this); …   // tickCarry 는 할 일이 없으면 첫 줄에서 돌아간다
```

- **①이 `initTraffic` 앞인 이유**: 불법 주차를 놓을 때 큰 차의 우회로를 실제 상태로 본다(`traffic.ts:98-140` 의 `linked`·`heavyPath` 는 이유와 상관없이 `e.closed` 를 막힌 것으로 본다). 복구 통제가 먼저 있어야 그것을 피해 놓는다. 처음 혼잡(`cong`)은 기준값으로만 정하므로(`traffic.ts:302`) 영향이 없고, 밀림(`queue`)은 첫 주기부터 통제를 본다.
- **②가 `createRoster` 뒤인 이유**: `roster-v1`·`roster-v2:*`(고정)·`equipment`·`kit`(교대) 흐름의 뽑기 횟수를 그대로 두고 값만 바꾼다. 예비 인력은 맨 끝에 붙으므로 기존 rid 가 그대로다.
- **③이 '교대 시작' 기록 뒤인 이유**: 첫 기록은 언제나 '교대 시작'이다. ①·② 는 그보다 먼저 상태를 바꾸므로, 바꾼 항목을 `carryState.applied` 에 모아 두었다가 ③ 이 기록한다(원칙 5). R1 의 헬기 운항 줄이 있으면 그 뒤에 둔다(교대 시작의 공지가 먼저, 지난 교대의 내역이 다음).
- **'교대 시작' 문구** (`engine.ts:84`): 지금은 `가용 부대 ${units.length}대, 대원 ${responders.length}명` 이다. 이어받은 상태가 있으면 정비·결원으로 `oos` 인 부대와 `off` 인 대원이 '가용'으로 세어져 기록이 상태와 어긋난다. 그래서 **이어받은 상태가 있을 때만**(그때는 요약 줄의 지문 때문에 해시가 어차피 바뀐다) `가용 부대 ${a}대(정비·결원 ${b}대 제외), 대원 ${c}명(결장 ${d}명 제외)` 로 쓴다 — `a` = `oos` 가 아닌 부대, `b` = `oos` 인 부대, `c` = `status !== 'off'` 인 대원(예비 인력 포함), `d` = `off` 인 대원. 괄호 속 수가 0 이면 그 괄호를 뺀다. 문구는 `persist.ts` 의 `shiftStartCounts(sim)` 이 만들고 `engine.ts` 는 `this.carryState.on ? shiftStartCounts(this) : 지금 문구` 로 고른다. **이어받은 상태가 없을 때의 문구는 한 글자도 바꾸지 않는다.**
- `initGenerator`·`majorAt`·`initDisaster`·`initWorld` 는 이어받은 상태를 읽지 않는다. 재난 무작위 추첨도 그대로.
- `persist.ts` 는 맨 위에서 다른 모듈의 표(상수)를 읽지 않는다. `resources.ts` 의 함수(`crewReady`·`traitOf`·`rosterKeys`)는 부를 때만 쓴다 — `resources → sceneManager → … → persist → resources` 순환이 생겨도 함수 호출은 괜찮지만, 맨 위의 표 읽기는 초기화 전의 값을 읽는다(CLAUDE.md 의 시나리오·추격전 함정과 같은 꼴). 섬광탄 정수는 `u.kind` 와 `tn.flashbangs` 로 계산한다(표를 import 하지 않는다). R1 의 `crews.ts`(`STAFF`·`ROLES`·`stays`·`fieldCrew`)는 import 해도 된다 — `crews.ts` 는 `types`·`util`·`events` 만 import 하므로(R1 §11) 순환이 생기지 않는다.

### 3.5 도로

**끝 상태에서** (`roadsNext`):

| 원천 | 조건 | `why` | `lane` | `left` | `openAt` |
|---|---|---|---|---|---|
| 앞에서 이어받은 것 | `left === 2` | 그대로 | 그대로 | 1 | carry 흐름 range(120, 600) |
| 그 교대에 재난이 통제했던 구간 (`d.damaged`, 아래) | 지진 — 통제한 순서로 앞의 `DIS_FULL`(2)구간 | `crack` | 전면 | 1 | range(240, 600) |
| 〃 | 지진 — 나머지 | `crack` | 한 차로 | 1 | range(300, 900) |
| 〃 | 해일 — 앞의 `DIS_FULL` 구간 | `washout` | 전면 | 1 | range(240, 600) |
| 〃 | 해일 — 나머지 | `washout` | 한 차로 | 1 | range(300, 900) |
| 〃 | 홍수로 잠겼던 구간 | `flood` | 한 차로(진흙·쓰레기 치우기) | 1 | range(120, 420) |
| 〃 | 산불이 번졌던 구간 | `fire` | 한 차로(불탄 가로수·방음벽 정리) | 1 | range(120, 420) |
| 〃 | 태풍 | — | — | — | (지금 태풍은 도로를 닫지 않는다 — 생기면 `debris` 한 차로) |
| 산사태 흙더미 (`variant 'landslide'`) | 사건이 `resolved` 가 아닌 이유로 닫힘(흙더미를 다 치우지 못함) | `mud` | 전면 | 1 | range(300, 600) |
| 쓰러진 나무 (`variant 'tree'`) | 〃 | `tree` | 전면 | 1 | range(60, 240) |
| 다중 추돌 (`variant 'pileup'`) | 끝난 이유와 상관없이 — 노면·방호벽 보수 | `surface` | 한 차로 | 1 | range(300, 900) |
| 무너진 건물의 잔해 (가) X6 전체 붕괴 | `sim.placeMarks.get(I.truth.placeId)?.state === 'collapsed'` 이고 `I.blockedEdge ≥ 0`(X6 §4.2 가 막았던 사건 교차로 구간 — `closeIncident` 가 연 뒤에도 `I.blockedEdge` 는 남는다) | `debris` | 전면 | 2(다음 교대 내내) | — |
| 〃 (나) 교대 끝에 남은 잔해 장애물 | I1-b C2 의 `traffic.obstacles` 가운데 `kind 'rubble'` 이 교대 끝까지 남은 것 | `debris` | 장애물이 `full` 이면 전면, 아니면 한 차로 | 1 | range(300, 900) |

- 사건의 구간은 `I.blockedEdge` 로 찾는다 — `closeIncident` 는 통제를 풀어도 `I.blockedEdge` 를 지우지 않는다(`incidents.ts:211-215`). 끝난 이유는 `I.closeReason`.
- **재난이 통제한 구간의 기록 `d.damaged`**: 1200초 교대에서는 재난이 교대 끝 전에 스스로 끝나므로("연관 설계서와 나누는 선" 표의 N6 줄) "교대 끝에 남은 통제"는 늘 비어 있다. 그래서 통제가 언제 풀렸는지와 상관없이 **그 교대에 통제한 적이 있는 구간**을 넘긴다. `disaster.ts` `closeEdge` 가 통제에 성공한 자리(`d.closedEdges.push` 줄)에 `if (d.damaged.indexOf(e.id) < 0) d.damaged.push(e.id)` 한 줄, `DisasterState` 에 `damaged: number[]`(`plan` 의 객체 글자에 `damaged: []` — 같은 구간이 다시 잠겨도 한 번만, 통제한 순서). 기록만 한다 — 난수·`emit` 없음, 결과 불변. 재난 종류는 `d.kind` 로 정한다(quake → crack, tsunami → washout, flood → flood, wildfire → fire). 지진의 "앞의 2구간"은 먼저 갈라진 곳(진원에 가까운 곳)이다. 처음 안의 `d.leftover`(`finish(…, cut)` 에서 교대 끝에 남은 통제만 기록)는 버렸다 — 1200초에서는 늘 비어 있다.
- **(가)와 (나)가 같은 구간**이면 (가). 다른 줄과 같은 구간이 겹치면 `left` 가 큰 것, 같으면 전면, 같으면 `openAt` 이 늦은 것을 남긴다.
- 상한 `ROAD_CAP`(6구간) — 넘으면 `left` 가 큰 것, 전면, `openAt` 이 이른 것 순으로 남긴다(재난 뒤 수십 구간이 모두 공사가 되지 않게).
- **짧은 교대**: 테스트에는 `shiftLen` 420·500 인 교대가 있다. 적용할 때 `openAt` 과 정비의 `readyAt` 은 `min(값, shiftLen × 0.75)` 로 자른다(저장된 상태는 1200초 기준 그대로 — 자르는 것은 적용 단계만). 그래서 `left 1` 인 공사는 어떤 길이의 교대에서도 그 교대 안에 끝난다.

**다음 교대에 적용** (`initCarry` 의 도로 부분, `initTraffic` 앞):

1. `openAt` 순으로(같으면 구간 id 순) 하나씩:
   - 전면 통제: **실제 상태에서** 큰 차가 그 구간 없이 양 끝을 오갈 수 있을 때만(`persist.ts` 의 `linkedHeavy(sim, a, b, skip)` — 그 구간과 이미 닫힌 구간을 빼고 너비 우선. T1 의 `linked` 와 같은 뜻이고 불법 주차는 아직 없다) `e.closed = true; e.closedReason = 'repair'`(`known` 은 두지 않는다 — 알려진 통제). 끊기면 놓지 않고 `dropped` 에 '…: 통제하면 길이 끊겨 복구 공사를 미룹니다.' 그 항목은 이번 교대에는 없는 것으로 보고, 끝날 때 만들어지는 상태에도 넣지 않는다(공사를 미루다 끝냈다고 본다 — 끊긴 채 남는 길이 없다).
   - 한 차로: `e.slow += LANE_SLOW 0.6`, `slowed` 에 적는다.
   - 놓은 것마다 `applied` 에 `road` 항목(`openAt` 은 짧은 교대면 자른 값 — §3.5 위).
2. `left === 1` 인 것은 `carryState.roads` 에 둔다(`openAt` 순 — `tickCarry` 가 `openAt` 에 연다). 전면·한 차로 모두 넣는다.
3. **출입 통제 건물 앞**: `closed`·`ruin` 인 건물의 `edgeId` 가 있으면 그 구간에 `slow += 0.4`('복구 공사 차량') — 교대 내내. 같은 구간에 여럿이면 한 번만. 열린 터(`q.open`)는 `closed`·`ruin` 이 되지 않으므로(§3.6) 해당이 없다.

이렇게 놓은 통제는 모두 "알려진 통제"라 `findRoute`·`etaFor`·관제가 처음부터 피하고, 사건의 통제(`incidents.ts:137-141`, `sceneManager.ts:220-222`, 대형·재난 시나리오의 `onCreate`)·재난의 통제(`closeEdge` 의 `detour`)·교통의 장애물(`place` 의 `linked`)은 모두 이미 닫힌 구간을 막힌 것으로 보고 우회로를 확인한다 — 새로 끊기는 길이 생기지 않는다(T1 구현 메모의 "사건의 통제끼리만 겹쳐 생기는 끊김"은 지금처럼 남는다).

### 3.6 건물

**끝 상태에서** (`placeOutcome(sim, I)` — 이번 교대에 닫힌 사건마다, `I.truth.placeId ≥ 0` 이고 출동 시설이 아닐 때. 진실을 읽는 유일한 곳):

| 원천 | 조건 | `state` | `dmg` | `soot` | `repair` | `cause` |
|---|---|---|---|---|---|---|
| X6 `placeMarks` 의 `collapsed` (전체 붕괴) | X6 가 있으면 `placeMarks` 에 있는 건물은 이 다섯 줄과 화재 `closed` 두 줄로 정한다(아래 "여러 행" 규칙) | ruin | 1 | 0 | 4 | collapse |
| X6 `burnt` (전소 — 탄 비율 ≥ 0.7) | 〃 | closed | 0.8 | 1 | 5 | burnout |
| X6 `partial` (구획 붕괴) | 〃 | closed | `max(0.3, ruinFrac × 2)` | `burnFrac` | 2 | collapse |
| X6 `blasted` (폭발 흔적) | 〃 (가스 폭발 대형 사고면 `repair` 3, `dmg` 0.6) | closed | 0.35 | 0.3 | 1 | blast |
| X6 `scorched` (그을림 — 닫힌 화재의 탄 비율 ≥ 0.15) | 〃 | marked | `0.5 × burnFrac` | `min(1, burnFrac × 2)` | 0 | fire |
| 화재 (`s.kind === 'fire'`) | 소실률 `loss = s.burnedTiles / max(1, s.totalFuelTiles)`(판정의 `propertyLoss` 와 같은 식, `debrief.ts:39`) ≥ 0.6 | closed | `0.4 + 0.5 × loss` | `min(1, loss × 1.5)` | 3 | fire |
| 〃 | 0.25 ≤ loss < 0.6 | closed | `0.5 × loss` | `loss × 1.5` | 1 | fire |
| 〃 | 0.05 ≤ loss < 0.25 | marked | `0.5 × loss` | `loss × 2` | 0 | fire |
| 붕괴 (`s.kind === 'collapse'`, 승강기 갇힘 제외) | 2차 붕괴가 있었다(`I.problems` 에 `p.code === 'ESCALATION' && p.detail.endsWith('2차 붕괴')` — `hazards.ts:620` 의 detail `${where} 2차 붕괴`) 또는 `frac ≥ 0.22` | ruin | 1 | 0 | 4 | collapse |
| 〃 | 그 밖에 잔해 칸이 있다 | closed | `min(1, frac × 2)` | 0 | 2 | collapse |
| 천장 일부 붕괴 (X6 전 — 어느 유형이든) | `p.code === 'ESCALATION' && p.detail.endsWith('천장 일부 붕괴')`(`hazards.ts:96`, 화재 현장) — 구획 붕괴로 본다. X6 는 이 덩어리를 지우고 `STRUCT_COLLAPSE`·`partial` 로 바꾼다 | closed | 0.3 | `loss × 1.5`(화재가 아니면 0) | 2 | collapse |
| 폭발 | 터진 가스 용기·폭발물(`p.exploded`) 또는 불붙은 배관(`kind 'valve' && p.ignited`) | closed | 0.35 | 0.3 | 1 | blast |
| 가스 폭발 대형 사고 (`variant 'gasblast'`) | 언제나 | closed | 0.6 | 0.4 | 3 | blast |
| 그 밖의 불붙은 소품 (`ignited` — 판정이 재산 피해 0.4 로 세는 것) | | marked | 0.2 | 0.4 | 0 | fire |

- `frac` = `s.damage` 가 1 인 칸 수 / 건물 칸 수(`FLOOR·FURN·DOOR·STAIR·WALL·WINDOW`). G4 §5.3 의 `ruinInfo.frac` 와 같은 식, 0.22 도 G4 의 `'major'` 기준과 같다. G4 의 기록(`s.ruin`·`s.falls`)은 "시뮬레이션이 읽지 않는다"는 G4 의 원칙 때문에 읽지 않는다 — 2차 붕괴는 문제 기록으로 안다.
- **`ESCALATION` 을 통째로 세지 않는다.** 붕괴 유형 현장의 `ESCALATION` 은 2차 붕괴만이 아니다. 가스 폭발 대형 사고의 주변 시민 가스 노출(`hazards.ts:654` — 그 현장에는 새는 밸브가 있다, `scenes/major.ts:51`)도 같은 코드다. 그래서 detail 의 끝말로 가른다. X6 뒤에는 위의 X6 다섯 줄(`placeMarks`)이 먼저이므로 이 줄들은 X6 가 표시하지 않은 건물에만 쓰인다.
- `spot` = 잔해 칸 무게중심의 건물 칸 경계 상자 안 상대 위치(소수 둘째 자리). 무너진 것만.
- **한 사건에 여러 행이 맞으면**(X6 의 줄과 아래 줄이 함께 맞는 경우를 포함해) `state` 가 무거운 것(ruin > closed > marked), `dmg`·`soot`·`repair` 는 각각 큰 값. 보기: X6 의 `scorched`(탄 비율 0.3)와 화재 `closed`(0.25 ≤ loss < 0.6) 줄이 함께 맞으면 `closed`, `repair` 1.
- **열린 터**(`q.open` — 숲·공원·저수지·활주로·주차장. 산불 시나리오의 장소가 숲이다, `scenarios/disaster.ts:9`)는 `marked` 만 남긴다: `state 'marked'`, `dmg 0`, `soot` 는 위 표의 값, `repair 0`. 출입 통제·무너짐이 되지 않는다(숲에 "복구 공사로 출입 통제"는 어색하고 장소 추첨에서 빠질 까닭도 없다). 지도는 지붕 그을음 대신 탄 자리로 그린다(§5.4).
- `inc` = `조직 ${shift}번째 교대 · ${I.code} ${scenarioName}`.
- X6 가 있으면: `placeMarks` 에 있는 건물은 위 다섯 줄과 화재의 `closed` 두 줄(소실률 0.25 이상 — X6 의 `scorched`·`burnt` 사이 0.25~0.7 을 받는다)을 함께 보고 "여러 행" 규칙으로 정한다. `placeMarks` 에 없는 건물(X6 가 표시하지 않은 작은 피해)은 아래 줄들로 본다. 화재 소실률 `loss` 는 X6 뒤에도 `s.burnedTiles / max(1, s.totalFuelTiles)`(이어받은 그을음으로 처음부터 탄 칸은 분자·분모 모두에 없다 — `applyPlaceWear`). `PlaceCarry.mark` 에 X6 의 상태를 남겨 지도가 X6·G4 의 그림을 고르게 한다(§5.4).
- X6 가 없으면(대체): 아래 줄들만.

**휴식 한 번** (앞에서 이어받은 건물과 이번 교대의 새 피해를 합친 뒤):
- 새 피해와 앞 상태가 같은 건물이면 무거운 쪽 `state`, 큰 값의 `dmg`·`soot`·`repair`, `since` 는 앞의 것.
- 이번 교대에 생긴 것이 아니면 `repair −= 1`. `repair` 가 0 이 되면 `state = 'marked'`, `dmg ×= 0.4`, `soot ×= 0.5`, `opened = true`.
- `marked` 는 `soot −= 0.25`, `dmg −= 0.15`. 둘 다 0.05 아래면 지운다.
- 이번 교대에 생긴 것은 깎지 않는다("화재 다음 교대에 출입 통제 1교대"가 그 교대 동안 정확히 1이 되게 — `repair` 는 "남은 교대, 이번 교대 포함").
- 상한(§6): 항목 `PLACE_CAP` 24, 그 가운데 `closed`·`ruin` 은 `CLOSED_CAP` 12.

**다음 교대에 겹쳐 읽기** — `city.places` 는 고치지 않는다. 모든 곳이 `placeCond(sim, id)`(`carryState.places.get(id) ?? null`)와 `placeUsable(sim, id, allowClosed = false)` 를 부른다.

**"쓸 수 있는 건물" 판정은 `placeUsable` 하나다.** 판정이 셋(I2 의 겹침 표, X6 의 `pickPlace` 제외, I1-b 의 `placeState().usable`)으로 갈라지지 않게 이 함수에 모은다:

```ts
export function placeUsable(sim: Sim, id: number, allowClosed = false, inShift = true): boolean {
  if (inShift) {                                           // (X6) 교대 안 — 전소·전체 붕괴는 그 교대에 다시 쓰지 않는다 (X6 §7.1 의 규칙)
    const m = sim.placeMarks?.get(id);
    if (m && (m.state === 'collapsed' || m.state === 'burnt')) return false;
  }
  if (!sim.carryState.on) return true;                     // 이어받은 상태가 없으면 여기까지 (X6 의 조건과 같다 — 결과 불변)
  const pc = sim.carryState.places.get(id);
  if (!pc) return true;
  return pc.state === 'marked' || (pc.state === 'closed' && allowClosed);
}
```

- X6 의 교대 안 제외(`collapsed`·`burnt`)를 두는 세 곳 — `pickPlace`, `createIncident` 의 정해 준 건물(되고르기), `pursuit.ts` 의 은신처 후보 — 는 그 검사를 이 함수를 한 번 부르는 것으로 바꾼다(`inShift` 기본값 `true`, X6 §7.1·§11.2). 이어받은 상태가 없으면 X6 의 조건과 같아 결과가 같다(0단계 해시 목록으로 확인 — 0단계는 X6 를 합친 뒤에 잰다).
- **재난의 장소 고르기와 연쇄 방화의 다음 대상 두 곳은 `inShift = false` 로 부른다** — 이어받은 상태만 본다. X6 는 이 두 곳에 검사를 두지 않았고(교대 안에 무너진 건물을 고르면 `createIncident` 의 되고르기가 받는다), 여기에 X6 의 검사까지 넣으면 이어받은 상태가 없는 교대의 결과가 바뀐다(0단계 해시 목록이 깨진다). 이어받은 상태는 교대 내내 바뀌지 않으므로, 이 두 곳에서는 고를 때의 답과 사건이 날 때의 답이 늘 같다.
- I1-b 의 `placeState(sim, id)` 는 `usable` 칸을 `placeUsable(sim, id)` 로 채운다. 이어받은 항목을 읽을 때는 `mark = pc.mark ?? null`, `burnFrac = pc.soot`, `ruinFrac = pc.state === 'ruin' ? 1 : 0`. `placeState` 에 칸을 더하지 않는다 — 출입 통제 건물을 허용하는 셋째 단계는 장소 추첨 안의 일이라, 장소 추첨이 `placeUsable(sim, id, true)` 를 직접 부른다.
- I1-b 의 `knownBuildingAt(sim, node, placeKind?)` 는 "관제가 아는 건물 상태"로 이어받은 항목도 돌려준다 — `carryState.places` 가운데 `Place.nodeId === node` 이고 `placeKind` 가 같은 것, 반환 `inc` 는 -1(I1 §3.4). 관제는 건물 id 를 모르므로(위치 진술은 교차로 id 뿐) id 로 묻지 않는다. **이것은 정보 격리에 맞다** — 이어받은 상태는 조직이 아는 기록이고(원칙 7), 관제가 이어받은 상태를 아는 정해진 길이 이 함수다.

| 곳 | 무엇을 | 고칠 자리 |
|---|---|---|
| 사건 장소 고르기 | `weigh` 에서 `!placeUsable(sim, q.id)` 이면 0 — 엄격·느슨 두 단계 모두. 둘 다 고를 곳이 없으면 **셋째 단계**: 느슨한 조건에 `allowClosed = true`(출입 통제 중인 건물은 허용, 무너진 건물은 끝까지 안 된다). 손상된 건물(`marked`)의 가중치: 붕괴 `× (1 + 3 × dmg)`, 가스 누출 `× (1 + dmg)`, 그 밖 그대로 | `incidents.ts` `pickPlace`(49-67) |
| 정해 준 건물 | X6 가 둔 되고르기 검사(`opts.placeId` 가 `collapsed`·`burnt` 면 버리고 `pickPlace` 로 다시 — X6 §7.1)를 `!placeUsable(sim, id)`(`inShift` 기본값 true — X6 의 조건과 같아 결과가 그대로다)로 바꾼다. **마지막 안전장치로만 쓴다** — 건물 이름을 먼저 기록하는 연쇄(은신처)와 장소를 고르는 곳(연쇄 방화·재난)은 아래처럼 고를 때 거른다. 이어받은 상태는 교대 내내 바뀌지 않으므로 고를 때 거르면 이 되돌림에서 이어받은 상태 때문에 버려지는 일은 없다 | `incidents.ts` `createIncident` 의 `place` 줄(X6 의 검사 자리) |
| 재난의 장소 고르기 | `ws` 에서 `!placeUsable(sim, id, false, false)`(`inShift = false`)이면 0 (이어받은 상태로 무너진 건물을 다시 고르지 않게 — 위의 되돌림보다 먼저, 재난의 가중치로) | `disaster.ts` `pickPlace`(355-362) |
| 연쇄 방화의 다음 대상 | `pool` 에서 `placeUsable(sim, id, false, false)`(`inShift = false`)인 것만 | `scenarios/crime.ts` `arsonNext`(43-44) |
| 납치범의 은신처 | X6 가 `cands` 에 둔 거르기(X6 §7.1 — `placeMarks` 의 `collapsed`·`burnt`)를 `placeUsable(sim, id)`(`inShift` true) 호출로 바꾼다 — 이어받은 상태도 함께 거른다. 은신처는 고른 뒤 `납치범이 … ${den.name}에 숨어들었습니다` 로 이름을 먼저 기록하고(`pursuit.ts:136`) 그 건물에 인질극을 예약하므로(139), 되돌림에 맡기면 기록과 사건 장소가 어긋난다. 고르는 흐름은 따로 있는 `hideout:<사건>` 이라(`pursuit.ts:37`) 거르기가 다른 흐름의 뽑기를 바꾸지 않는다 | `pursuit.ts` 은신처 후보(37-39) |
| 현장 생성 | `createScene` 끝에서 `applyPlaceWear(sim, s, I)` — 아래 | `field/sceneManager.ts` `createScene`(23-27) |
| 사건 발생 기록 | `I.rootEvent` 기록 바로 뒤 `noteWearIncident(sim, I)` — 아래 | `incidents.ts` `createIncident`(150 뒤) |
| 지도 그림·마우스 정보 | §5.4 | `view/city/carryLayer.ts`, `renderCity.ts` |

`applyPlaceWear(sim, s, I)`: 그 건물의 `placeCond` 가 있으면 `s.wear = { dmg, soot, cause, inc, pre: 0 }`. 그을음은 **"이미 탄 칸"으로** 옮긴다 — 연료를 줄이지 않는다:

- 연료를 줄이면(처음 안의 `s.fuel *= 1 − 0.4 × soot`) 거꾸로 된다. 불은 칸마다 `fuel −= 0.0105·f` 로 깎고, 0 이 되면 `burned` 로 표시하며 `burnedTiles++` 한다(`hazards.ts:33-36`). 번지는 계수는 아래가 0.45 로 막혀 있어 조금만 줄어든다(`hazards.ts:56`). 그래서 연료가 적은 칸일수록 더 빨리 '다 탄 칸'이 된다. 재산 피해(`burnedTiles / totalFuelTiles`, `debrief.ts:39`)와 X6 의 전소 판정(같은 비율 ≥ 0.7, X6 §2.7)이 더 빨리 오르고, "그을린 건물 → 전소 → 출입 통제 5교대 → 다시 그을림"의 교대 간 악순환을 키운다.
- **대신**: 실내 연료 칸(`s.regions` 가운데 `indoor` 인 구획의 칸이고 `s.fuel > 0` — `field/*` 를 import 하지 않으려고 구획으로 본다) 가운데, 불이 붙은 칸(`s.fire > 0`)과 그 이웃 8칸을 뺀 것에서 `round(PRE_BURN 0.35 × soot × 개수)` 칸을 고른다. 고르는 순서는 `hashStr(I.id + ':' + i)` 의 오름차순이다(난수 흐름을 쓰지 않는다). 고른 칸은 `s.fuel[i] = 0; s.burned[i] = 1`, `s.totalFuelTiles −= 개수`, `s.burnedTiles` 는 그대로, `s.wear.pre = 개수`.
- 효과: 그 칸은 다시 타지 않고 불이 건너가지 않는다(`tickFire` 는 `fuel ≤ 0` 인 칸으로 번지지 않는다, `hazards.ts:55`). 그래서 "이미 탄 것은 덜 탄다"가 의도대로다. 재산 피해 비율은 분자·분모에서 함께 빠지므로, 남은 연료가 탄 몫만 센다. X6 의 전소 분모 `fuel0` 는 `catOf` 때 `s.fuel > 0` 인 칸이므로 저절로 빠진다. X6 구현이 분자를 `fuel0` 칸 안에서만 세는지 확인하고, 아니면 분자에서 `s.wear.pre` 칸을 빼도록 그 한 줄을 맞춘다(§10.2 X6 줄). 그림으로는 탄 바닥이 처음부터 보인다(`fx.ts` 가 `s.burned` 를 그린다 — 화면만).
- 화재가 아닌 현장(가스 누출·붕괴)에도 같은 규칙을 쓴다. 연료가 있는 실내 칸이 없으면 아무것도 하지 않는다.
- 측정(§6.3 의 8, `chain.ts --soot`): 같은 건물·같은 사건 시드에서 그을음 0 과 0.6 의 화재를 N 시드로 강제해 소실률·`BURNOUT` 비율·X6 의 탄 비율을 비교한다. 의도한 방향은 "그을린 건물은 덜 탄다 — 소실률·전소 비율이 늘지 않는다"다. 시험 3 이 방향 하나를 건다.

그 밖의 현장 내용은 바꾸지 않는다 — 평면은 사건마다 다르므로(§1.2) 칸 단위 피해를 옮기지 않고 요약값만 쓴다. 그을음은 그림(`staticLayer` 의 바닥·벽 얼룩, `staticSig` 에 `s.wear?.soot` 를 넣는다)으로 보이고, 손상은 X6 의 구획 건전도 처음 값을 낮춘다(§7).

`noteWearIncident(sim, I)`: `dmg ≥ 0.1` 또는 `soot ≥ 0.2` 이면 `emit({ inc: I.id, role: 'SYSTEM', actor: '도시', kind: 'incident', imp: 1, truth: true, tag: 'carry', causes: [cs.event], text: \`이 건물은 ${inc}로 ${soot ≥ 0.2 ? '그을리고 ' : ''}손상된 상태였습니다 (구조 손상 ${pct(dmg)}).\` })`, `stats.markedInc.push(I.code)`. 열린 터는 `이 터에는 ${inc}로 탄 자리가 남아 있습니다.`. **관제·지휘관이 이 손상을 아는 길**: 관제(분석 AI)는 I1-b 의 `knownBuildingAt` 으로 안다(원칙 7 — I1-b 가 이미 그 길을 만든다). 지휘관의 출동 브리핑에는 I2 가 따로 사실을 넣지 않는다. 현장의 손상은 X6 의 구조 조짐(`struct` — 외부 관찰)으로 안다(결정 — §11.2).

### 3.7 기록 (`announceCarry`, `tickCarry`)

`announceCarry(sim)` — '교대 시작'(과 R1 의 헬기 운항 줄) 바로 뒤, 이어받은 상태가 있을 때만. **기록하는 것은 `carryState.applied` 의 항목과 `dropped` 뿐이다**(원칙 5 — 적용 함수가 바꾼 것만, 바꾼 순서대로 한 항목에 한 줄. 부대 단위로 묶는 결장 줄은 한 항목이 한 부대다. 건물은 다섯째 항목부터 '외 n곳' 한 줄로 묶는다). 모두 `role 'SYSTEM'`(부대 줄은 `'UNIT'`), 요약이 아닌 줄의 원인은 요약 줄(`causes: [cs.event]`). 요약이 아닌 줄에는 `tag: 'carry'` 를 단다(I1-b 의 `WorldTag` 에 더하는 값 — 측정 도구가 시스템 `carry` 로 센다, §7):

1. 요약(`actor '상황실'`, `kind 'shift'`, `imp 2`, `tag` 없음 — 문구 규칙 T5 로 센다) → `carryState.event`:
   `지난 교대에서 이어받은 상태 — 조직의 ${shift}번째 교대 (지문 ${carryKey}). ${parts.join(' · ') || '남은 피해 없음'}.`
   **첫머리 `지난 교대에서 이어받은 상태` 는 바꾸지 않는다** — I1-a 의 문구 규칙 T5 `/^지난 교대에서 이어받은 상태/` 가 이 줄을 시스템 `carry` 로 센다(I1 §2.3). 바꾸면 `tests/causality.test.ts` 의 T5 검사가 깨진다.
   `parts`: `결장 ${a}명` · `공석 ${f}자리` · `정비 중 ${s}대` · `출입 통제 건물 ${c}곳`(무너짐이 있으면 `(무너짐 ${r})`) · `복구 공사 도로 ${d}구간` · `숙련이 오른 대원 ${g}명`. 0 인 것은 뺀다.
2. 결장(부대마다 한 줄, `actor` 호출부호, `kind 'unit'`, `imp 1`): `${josa(이름들, '이/가')} 결장합니다 (${원인 이름} · ${n}교대 남음).` 공석: `순직한 ${이름} 대원의 자리가 비어 있습니다 (신임 배치까지 ${n}교대).` 신임이 처음 오는 교대: `신임 ${이름} 대원이 ${자리 이름} 대원의 자리에 배치됐습니다.` 원인 이름은 H1 의 `CAUSE_NAME`(H1 전: '부상' · '중상').
3. 조기 복귀: `결장 대원이 많아 ${이름} 대원이 경상으로 일찍 복귀합니다.`
4. 예비 인력: `${호출부호} 결원 — 본부 예비 인력 ${이름} 대원이 ${역할 이름} 자리에 대신 탑니다.`(R1 전에는 `… 대원이 대신 탑니다.`) / 모자람(`short`): `${호출부호} 결원 — 예비 인력이 없어 ${n}명으로 운용합니다.` / 나올 사람이 없음(`empty`): `${호출부호} 결원으로 이번 교대 운용 중단 (${why === 'pilot' ? '조종·조타할 사람' : '나올 대원'}·예비 인력 없음).`
5. 정비: `${호출부호} 펌프 정비 중 — 약 ${분}분 뒤 운용.`
6. 재고: `섬광탄 재고 부족 — ${호출부호} ${n}개만 지급 (정수 ${m}개).`
7. 건물(`closed`·`ruin` 만, `repair` 가 큰 순으로 4줄, 넘으면 `외 n곳`): `${이름} — ${inc}로 ${ruin ? '무너져 출입할 수 없습니다' : '복구 공사 중이라 출입을 통제합니다'} (${repair}교대 남음).` 통제가 풀린 건물(`opened`): `${이름} 복구 완료 — 다시 문을 열었습니다.`
8. 도로(`actor '교통정보'`, `kind 'traffic'`): `${edgeName} 복구 공사로 통제 — ${WHY_NAME[why]} (${left === 1 ? \`약 ${분}분 뒤 개통\` : '이번 교대 내내'}).` 한 차로: `${edgeName} 한 차로 복구 공사 — 서행.`
9. `dropped` 의 문장들(`imp 0`).

`tickCarry(sim)` — 매 틱(`step` 의 `tickTraffic` 다음). `on` 이 아니거나 남은 일(정비 중 부대 `carryState.svc` 수, 남은 복구 공사 `roads.length`)이 0 이면 첫 줄에서 돌아간다:

```ts
// 정비 — 부대 순서대로
for (const u of sim.units) {
  if (u.readyAt === undefined || sim.t < u.readyAt) continue;
  u.readyAt = undefined; cs.svc--;
  if (u.state !== 'oos') continue;                                   // (방어) 다른 코드가 이미 운용에 넣었다
  if (operable(sim, u)) {                                            // crewReady > 0 이고 조종·조타할 사람이 있다 (§3.2 적용 6 의 운용 판정 — need 까지 찼는지는 보지 않는다)
    u.state = 'available'; u.oosWhy = undefined; cs.stats.serviced++;
    emit(sim, { role: 'UNIT', actor: u.callsign, kind: 'unit', imp: 1, tag: 'carry', causes: [cs.event], text: `${u.callsign} 정비 완료 — 운용 재개.` });
  } else {
    u.oosWhy = '결원';
    emit(sim, { role: 'UNIT', actor: u.callsign, kind: 'unit', imp: 1, tag: 'carry', causes: [cs.event], text: `${u.callsign} 정비를 마쳤지만 결원으로 운용하지 못합니다.` });
  }
}
// 복구 공사 — openAt 이 된 것은 언제나 목록에서 꺼낸다 (조건이 맞지 않는 항목이 머리를 막지 않게). 한 틱에 여럿을 처리한다
while (cs.roads.length && cs.roads[0].openAt <= sim.t) {
  const rc = cs.roads.shift()!, e = sim.city.edges[rc.edge];
  if (rc.lane) {                                                     // 한 차로: 닫혀 있지 않으므로 closedReason 을 보지 않는다
    const k = cs.slowed.findIndex((q) => q.edge === rc.edge);
    if (k < 0) continue;
    e.slow = Math.max(0, e.slow - cs.slowed[k].v); cs.slowed.splice(k, 1);
    emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', imp: 0, tag: 'carry', causes: [cs.event], text: `${edgeName(sim.city, e)} 한 차로 복구 공사 완료.` });
  } else if (e.closed && e.closedReason === 'repair') {             // 전면: 이유가 바뀌었으면(다른 통제가 덮었으면) 건드리지 않는다
    e.closed = false; e.closedReason = null; cs.stats.reopened++;
    emit(sim, { role: 'SYSTEM', actor: '교통정보', kind: 'traffic', imp: 1, tag: 'carry', causes: [cs.event], text: `${edgeName(sim.city, e)} 복구 공사 완료 — 통행 재개.` });
  }
}
```

- `cs.svc` 는 `applyCrewCarry` 가 정비 중으로 둔 부대 수로 채운다(§2.2).
- `left 2` 공사(교대 내내)는 `roads` 에 넣지 않으므로 여기서 열리지 않는다. 출입 통제 건물 앞의 `slow 0.4` 도 교대 내내라 여기서 되돌리지 않는다.
- `engine.ts` 의 `step` 은 `ended` 면 첫 줄에서 돌아가므로(`engine.ts:92`) 교대가 끝난 뒤에는 `tickCarry` 가 돌지 않는다. 그래서 `openAt`·`readyAt` 을 짧은 교대에서 `shiftLen × 0.75` 로 자른다(§3.5) — 교대 안에 끝나지 못한 공사가 생기지 않게.

---

## 4. 재현성

### 4.1 같은 입력 = 같은 결과

- **입력**: 시드 + 난이도 + `Carryover`. `readCarryover` 가 검사하며 새 객체로 만들어 쓰므로 호출하는 쪽이 같은 객체를 다시 넘겨도(되감기) 결과가 같다.
- **JSON 왕복**: 숫자를 만들 때 소수 넷째 자리로 반올림해 둔다(`round4`). JS 의 수 → 문자열 → 수는 원래 값과 같으므로 반올림이 꼭 필요하지는 않지만, 저장 크기를 줄이고 지문이 사람 눈에 안정적이게 한다. 테스트: `new Sim(s, d, len, { carry: co })` 와 `{ carry: JSON.parse(JSON.stringify(co)) }` 의 `report.hash` 가 같다.
- **난수 흐름** (새로 더하는 것만):

| 흐름 | 쓰는 곳 | 비고 |
|---|---|---|
| `carry` (교대) | `makeCarryover`: 복구 시각 `openAt`, 정비 시각 `readyAt` | 교대가 끝난 뒤에만. 그 교대의 결과에는 영향이 없다 |
| `recruit:<자리>` (교대) | 신임 대원의 기본 능력 | 공석이 채워지는 휴식에서 한 번 |
| `relief:<호출부호>` (교대) | 예비 인력의 능력 | 적용할 때 |

  기존 흐름(`roster-v1`·`equipment`·`traffic`·`parked`·`scene:<사건>`·`agent:<사건>:<rid>` …)의 호출 수와 순서는 그대로다. 단 이어받은 상태가 있으면 사건 장소(가중치·제외)와 통제된 도로가 달라지므로 그 뒤의 전개가 달라지는 것은 당연하다 — "이어받은 상태가 결과를 바꾼다"가 이 묶음의 목적이다.

### 4.2 기록 해시와 지문

- 기록 해시는 문장만 섞는다(`events.ts:22-26`). 그래서 이어받은 상태가 있으면 **요약 첫 줄에 지문을 넣는다**(§3.7 의 1). 내용이 조금이라도 다른 상태(예: 경험 +0.001)는 지문이 달라 해시가 달라지고, 같은 상태면 같다.
- 이어받은 상태가 **없으면** 요약 줄을 남기지 않는다 → 지금과 해시가 같다. `{ carry: null }` 과 `{}` 와 인자 없음은 모두 같다.
- 보고서에도 `carry.key`(지문)와 `carry.shift` 를 남긴다. 화면 보고서 머리의 "기록 해시" 옆에 "조직 #n · 지문 …".

### 4.3 되감기·새로고침 복원·같은 시드 재실행

- 교대 **안**에서는 지금과 같다: 되감기는 같은 입력(시드·난이도·**이어받은 상태**)으로 처음부터 그 틱까지 다시 돌린다. 그래서 `Runner` 는 지금 교대의 입력 `carryIn` 을 들고 있고 `make()` 가 늘 그것을 넘긴다(§5.3).
- 새로고침 복원은 `ar.input.v1` 에 저장된 입력(이어받은 상태 포함)과 `ar.current.v1` 의 틱으로 다시 돌린다(§5.3).
- **"같은 시드 재실행"은 "같은 입력으로 다시 보기"다.** 방금 끝난 교대의 **입력**을 그대로 쓴다(출력을 이어받지 않는다). 조직 저장소를 고치지 않는다(§5.3). "다음 교대(이어서)"가 출력을 이어받는 버튼이다.

---

## 5. 화면

### 5.1 원칙

- 고르는 것은 교대 시작 전 조건뿐: **새 조직으로 시작 / 이어서 시작**, 그리고 **저장된 조직 지우기**. 이어받은 내용을 고치는 화면은 만들지 않는다.
- 진행 중인 교대에는 아무것도 적용되지 않는다(난이도 창의 안내문과 같은 결).
- 지도·목록에 글자 표식을 쓰지 않는다(CLAUDE.md). 새 기호는 범례에 넣는다.
- 이어받은 상태는 조직이 아는 기록이라 **관찰자 시점과 AI 시점에 똑같이** 보인다.

### 5.2 고르는 자리

- **난이도 창** (`panels.tsx` `DifficultyPanel`, 496-549): 재난 줄 아래에 "조직" 줄 — 칩 둘.
  - `이어서 시작` — 저장된 조직이 있을 때만 누를 수 있다. 칩 아래 한 줄: `조직의 8번째 교대 · 결장 2명 · 정비 1대 · 출입 통제 건물 3곳 · 복구 공사 도로 1구간`(`carrySummary`). 저장된 조직이 없으면 `저장된 조직 없음 — 이 교대가 끝나면 저장됩니다`. 읽지 못했으면(판이 다르거나 깨짐) `저장된 조직을 읽지 못했습니다 — 새 조직으로 시작합니다`.
  - `새 조직으로 시작` — 칩 아래: `모든 대원이 처음 상태로 시작합니다. 이 교대가 끝나면 저장된 조직(8번째 교대)을 대신합니다.`
  - 오른쪽 끝에 작은 `저장된 조직 지우기`(확인 한 번).
  - 선택은 `settings.org: 'continue' | 'fresh'`(기본 `'continue'`)로 저장한다. "이 조건으로 새 교대 시작"이 이 선택을 따른다. "같은 시드(…)로 시작"은 비교 실행(§5.3 replay)이다 — 버튼 옆 안내에 `지금 교대와 같은 조직 상태로` 를 붙인다.
- **상단 띠** (`TopBar`): 난이도 칩 옆에 조직 칩 하나 — `조직 #8`(이어받은 교대) / `새 조직`. 마우스를 올리면 요약 한 줄, 누르면 난이도 창. 그림 기호는 `marks.ts` 에 `ORG_MARK`(사람 셋 실루엣) 하나. "새 교대" 버튼은 `settings.org` 를 따르고, "같은 시드 재실행"은 replay.
- **보고서** (`ReportModal`): 머리 버튼을 `다음 교대 (이어서)`(주 버튼 — 이 교대가 조직을 저장했을 때만), `새 조직으로 새 교대`, `같은 시드 재실행`, `닫고 마지막 상태 보기` 로.

### 5.3 저장 (`view/runner.ts` — 표현 계층)

| 키 | 내용 | 비고 |
|---|---|---|
| `ar.org.v1` (새로) | `{ id: string; carry: Carryover; savedAt: number }` | 저장된 조직. `id` 는 조직의 계보(새 조직을 시작할 때 `randomSeed()` 로 만든다 — 표현 계층이라 `Math.random` 허용) |
| `ar.input.v1` (새로) | `{ seed, diff, carry: Carryover \| null, org: string \| null, write: boolean, mode: 'continue' \| 'fresh' \| 'replay', baseShift: number }` | 지금 교대의 **입력**. 교대를 시작할 때(새 교대·복원·주소 실행) **한 번만** 쓴다. 이어받은 상태가 10~20KB 라 2.5초마다 다시 직렬화하지 않게 `ar.current.v1` 과 나눈다 |
| `ar.current.v1` (그대로) | `{ seed, tick, diff }` | 지금처럼 2.5초마다 `tick` 만 갱신(`runner.ts:121`). 교대 끝의 덮어쓰기(`runner.ts:119`, `tick: 0`)도 그대로 — 입력은 `ar.input.v1` 에 있으므로 지워지지 않는다 |
| `ar.history.v1` (칸 추가) | `HistoryItem` 에 `shift?: number` | 보고서의 "이전 교대 기록"에 `#8` |

`Runner` 의 새 칸: `carryIn: Carryover | null`(지금 교대의 입력), `orgId: string | null`, `writeOrg: boolean`, `startMode: 'continue' | 'fresh' | 'replay'`, `baseShift: number`(이 교대가 시작할 때의 조직 교대 번호 = `carryIn?.shift ?? 1`), `settled: boolean`(이 교대의 끝 처리를 했는가), `orgMem: { id; carry } | null`(저장소가 안 될 때 이 창이 열려 있는 동안만 쓰는 사본).

- `make(seed, d)` 는 `new Sim(seed, d, 1200, { force: this.force, carry: this.carryIn })`. 되감기(`seek`)·복원·새 교대 모두 이 함수를 지난다.
- `private begin(mode)` — 입력을 정하는 한 곳:
  - `continue`: `saved = readOrg()`(`orgMem` 이 있으면 그것, 아니면 `lsGet` → `readCarryover` 로 판·모양 검사. 실패면 `null`). `carryIn = saved?.carry ?? null`, `orgId = saved?.id ?? 새 id`, `writeOrg = true`.
  - `fresh`: `carryIn = null`, `orgId = 새 id`, `writeOrg = true`.
  - `replay`: `carryIn`·`orgId` 는 지금 교대의 것 그대로, `writeOrg = false`.
  - `startMode = mode`, `baseShift = carryIn?.shift ?? 1`, `settled = false`. 그리고 `ar.input.v1` 에 위의 모양으로 한 번 쓴다.
- `newShift(seed?, difficulty?, mode = settings.org)` 는 `begin(mode)` 뒤에 지금처럼 `make`.
- **생성자의 세 갈래**(`runner.ts:62-66`):
  - 주소로 조건을 고정한 실행(`?seed=`·`?diff=`·`?force=`·`?disaster=`)은 화면 확인·자동 테스트가 재현돼야 하므로 **새 조직**으로 시작하고 저장하지 않는다(`carryIn = null`, `writeOrg = false`). `?org=continue` 를 주면 저장된 조직으로(저장은 하지 않는다).
  - 새로고침 복원(`ar.current.v1` 에 `tick > 0`): `ar.input.v1` 의 `seed`·`diff` 가 같으면 그 `carry`·`org`·`write`·`mode`·`baseShift` 로 되살린 뒤 지금처럼 그 틱까지 돌린다(`diff` 는 지금처럼 `{...NORMAL, ...cur.diff}`). 시드가 다르거나 입력이 없으면 이어받은 상태 없이 복원한다(`writeOrg = false` — 모르는 입력으로 돌린 교대를 조직에 저장하지 않는다).
  - **그 밖(첫 화면 — 주소도 복원도 없음)**: `begin(settings.org)` 를 거친다. 기본값이 `'continue'` 이므로 저장된 조직이 있으면 이어서, 없으면 새 조직으로 시작해 끝나면 저장한다.
- **끝 처리는 한 곳에서** — `private settle()`. `frame` 끝과 `seek` 끝에서 부른다(지금은 `frame` 의 `!sim.ended` 분기 안에서만 `pushHistory` 를 한다. 그런데 `App.tsx:89-91` 의 시각 이동은 끝나지 않은 교대를 `hardCap` 까지 앞으로 `seek` 하게 해 준다. 그러면 교대가 `seek` 안에서 끝나고 기록·저장이 빠진다). `settle` 은 `sim.ended && sim.report && !settled` 일 때만 한 번:
  1. `pushHistory`, `ar.current.v1` 에 `{ seed, tick: 0, diff }`(지금 줄 그대로).
  2. `writeOrg` 이면 `next = makeCarryover(sim)`(`from.hash = report.hash`), `saved = readOrg()`. **저장 조건**: `!saved`(저장된 조직이 없거나 읽지 못함) ‖ `startMode === 'fresh'` ‖ (`saved.id === orgId` && `saved.carry.shift === baseShift` — 다른 창이 그 사이에 조직을 앞으로 보내지 않았다). 맞으면 `lsSet('ar.org.v1', { id: orgId, carry: next, savedAt: Date.now() })` 와 `orgMem = { id: orgId, carry: next }`. 아니면 보고서에 `다른 창에서 조직이 이미 앞으로 진행됐습니다 — 이 교대의 결과는 저장하지 않았습니다.`
  3. `settled = true`, `writeOrg = false`(같은 교대가 두 번 저장하지 않게). 되감기(`seek` 뒤로)로 끝나지 않은 상태가 되어도 `settled` 는 그대로 둔다 — 다시 끝까지 가도 같은 입력의 같은 결과라 저장할 것이 없다.
- 저장 실패(사생활 보호 창, 용량, 막힌 저장소): `lsSet` 이 조용히 넘긴다(지금처럼). 다음 교대의 `continue` 는 `orgMem` 을 쓰므로 이 창이 열려 있는 동안은 이어진다. 난이도 창에 `저장소를 쓸 수 없어 새로고침하면 조직이 처음으로 돌아갑니다.`

### 5.4 지도에 남은 흔적 (`view/city/carryLayer.ts`)

`renderCity.ts` 월드 층에서 `drawDisasterWorld(…)`(143) 바로 뒤, G4 의 `drawRuinsWorld` 가 있으면 그 **앞**(이번 교대의 정보가 위에 오게) 한 줄: `drawCarryWorld(ctx, sim, { scale: xf.scale, timeMs: o.timeMs, mini })`. 축소 창에서는 그리지 않는다. 건물 회전은 G4 §5.3 처럼 `translate(가운데) → rotate(q.rot)` 뒤 `(−w/2, −h/2)` 좌표(`staticCity.ts` 의 `local()` 은 export 되어 있지 않으므로 같은 세 줄을 이 파일에 둔다 — `staticCity.ts` 는 고치지 않는다).

| 상태 | 큰 배율 (`min(q.w, q.h) · scale ≥ 12` — G4 §5.2 와 같은 기준) | 작은 배율 |
|---|---|---|
| `marked` (그을음) | 지붕에 그을음 덩어리 — G4 §7.6 의 함수(넓이 `clamp(soot × 1.07, 0.25, 0.9)`, `rgba(14,10,8,0.55)` 에 `soot` 를 곱한 투명도). 넓이 식은 G4 의 `loss × 1.6` 의 **근사**다 — 화재 `closed` 줄(`soot = loss × 1.5`)에서만 같은 값이고, `marked` 줄(`soot = loss × 2`)과 휴식으로 줄어든 그을음에서는 조금 다르다(지난 교대의 흔적이라 정확히 같을 까닭이 없다). `dmg ≥ 0.2` 면 지붕을 가로지르는 금 하나(G4 §5.3 의 4번). **열린 터**(`q.open`)는 지붕 대신 터 위에 탄 자리(불규칙한 어두운 얼룩 `rgba(30,22,16,0.5)` × `soot`, 가장자리 `hash2(q.id, k)`)만 — 울타리·`REPAIR_MARK` 없음 | 그리지 않는다(작은 건물의 얼룩은 읽히지 않는다) |
| `closed` (복구 공사) | 위의 얼룩 + 건물 외곽을 따라 노란 점선 울타리(`#e0b83a`, 굵기 `max(1, 1.4 / scale)`, 대시 4·3) + 지붕 가운데 `REPAIR_MARK`(공사 고깔과 가로대, `marks.ts` 에 새로) | `REPAIR_MARK` 하나(크기 `10·zs`, 투명도 0.85), 어두운 테 |
| `ruin` (무너짐) | G4 의 무너진 지붕 덧그림을 `level 'major'`(X6 뒤 `mark === 'collapsed'` 면 X6 가 더한 `'total'` — 건물 윤곽 전체가 잔해 더미), `u·v = spot`(없으면 0.5·0.5)으로 — 먼지는 그리지 않는다(지난 일이다). 그 위에 노란 점선 울타리 | G4 의 `RUIN_MARK.major`(X6 뒤 `total`, 크기 `11·zs`) |

X6 뒤에는 `mark` 로 그림을 고른다: `burnt` → X6 의 전소 지붕(지붕 전체 그을음 + 구멍), `partial` → G4 의 `'partial'` 덧그림, `blasted` → X6 의 폭발 흔적, `scorched` → 위의 그을음. 그 위에 상태(`closed`·`ruin`)의 울타리·`REPAIR_MARK` 를 얹는다. 이번 교대의 `placeMarks` 와 이어받은 상태가 같은 건물에 함께 있으면 이번 교대의 것을 그린다(X6·G4 의 층이 위에 온다).

- 밤이면 G4 처럼 `shade(…, −0.35)`.
- G4 가 아직 합쳐지지 않았으면: 무너짐은 지붕 가운데의 어두운 들쭉날쭉한 구멍(`rgba(16,12,9,0.62)`, 14각형, 가장자리 `hash2(q.id, k)`)과 `REPAIR_MARK`, 그을음은 같은 넓이의 둥근 얼룩.
- 같은 건물에 이번 교대의 사건 핀이 있으면 핀이 위에 온다(지금 순서 그대로).
- **도로**: 복구 공사 통제는 지금의 통제 점선(`trafficLayer.ts:70` 은 이유와 상관없이 알려진 통제를 그린다)에 더해, `drawTrafficScreen` 의 진입 금지 반복문(174-180)에서 `closedReason === 'repair'` 를 빼고 그 자리에 `drawObstacleMark(ctx, 'roadwork', mx, my, 6.5·zs, true, '#ffb454')` 를 그린다(T1 의 공사 표식과 같은 고깔, 테 색만 다르다). `drawObstacleMark`(`trafficLayer.ts:155`)에는 지금 테 색을 받는 인자가 없으므로 **마지막에 선택 인자 `ring?: string` 하나**를 더한다 — 기본값이 지금 색이라 다른 호출은 그대로다. 한 차로 공사는 혼잡 띠로 저절로 보인다.
- **마우스 정보** (`describeAt`, 378 의 `lines` 뒤): `const cl = carryLine(sim, q.id); if (cl) lines.push(cl);` — `그을림 · 구조 손상 30% (조직 3번째 교대 · 04 화재)` / `복구 공사 중 — 출입 통제 (2교대 남음)` / `무너짐 — 복구 전까지 출입 불가 (3교대 남음)`. 도로 정보에 `복구 공사 — 약 4분 뒤 개통`(`flowOf` 가 '통제' 라고 할 때 이유를 붙인다).
- **범례** (`MapLegend.tsx`): 새 묶음 "지난 교대의 흔적" — 그을린 건물 · 탄 자리(숲·공원) · 복구 공사 중인 건물 · 무너진 건물 · 복구 공사 도로.
- **부대 목록** (`UnitRow`, 131-150): `off` 대원의 칩은 흐리게 + 가로줄(`.cchip.off`), 마우스 정보 `${이름} — 결장 (총상 · 2교대 남음)` / `공석 — 순직 (신임 배치까지 1교대)`. 예비 인력 칩에는 작은 점 표지(`.cchip.relief`). `oos` 의 상태 글자는 `u.oosWhy` 가 있으면 그것(`정비 중 · 4분` — `readyAt − sim.t` 를 분으로).
- **대원 정보창**: 경력 한 줄 `조직에서 n번째 교대 · 사건 m건 · 경험 +0.04`(이어받은 항목이 있을 때만).

### 5.5 보고서

- `debrief.buildReport` 가 `carry`(이어받은 상태로 시작한 교대만)와 `carryNext`(언제나)를 채운다. 문장은 `persist.carryLines(sim)` — 기록과 상태로만:
  1. 요약 줄과 같은 문장(이어받은 것).
  2. `결원 부대가 나간 사건 ${n}건 (${호출부호들}).` — 아래의 "결원 도착" 기록(그 사건의 `arrive` 기록 가운데 `causes` 에 `carryState.event` 가 있는 것)으로 센다(`off` 는 교대 내내 바뀌지 않는다).
  - **결원 도착 기록**: `sceneManager.unitArrived` 의 도착 기록(`kind 'arrive'`)을 남기는 그 자리에서, 부대에 `off` 대원이 있으면 그 기록에 `causes: [cs.event]` 를 붙인다(문구는 그대로 — `causes` 는 해시에 들어가지 않는다. 이어받은 상태가 없으면 `off` 가 없어 아무것도 붙지 않는다). 상태(결원으로 내린 인원)를 정하는 바로 그 자리의 정당한 원인이고, I1-a 의 `worldLinks`·`spread` 가 "지난 교대의 결원 → 이번 사건"을 잡는다(교대를 넘는 '부대 부족이 다른 사건에 주는 영향').
  3. `본부 예비 인력 ${n}명이 결원 부대에 탔습니다.` · `정비를 마친 부대 ${n}대가 교대 중에 운용에 들어갔습니다.` · `복구 공사가 끝난 도로 ${n}구간이 교대 중에 열렸습니다.` · `지난 교대에 손상된 건물에서 사건 ${n}건 (${코드들}).` · `섬광탄 재고 부족으로 ${n}개 덜 지급했습니다.` — 0 인 줄은 뺀다.
- 요약(`summary`)에 한 줄 더: 이어받은 상태가 있으면 `지난 교대의 영향: …`(위 2~3 가운데 0 이 아닌 것 둘까지), 그리고 언제나 `다음 교대로 넘기는 것: 결장 예상 2명 · 정비 1대 · 출입 통제 건물 3곳 · 복구 공사 도로 1구간.`(모두 0 이면 `다음 교대로 넘기는 피해는 없습니다.`).
- 화면(`ReportModal`): 재난 요약 아래에 "조직" 칸 — 제목 `조직의 n번째 교대 · 지문 …`, `carry.lines`, 그리고 `carryNext` 의 작은 타일 다섯(결장 예상 · 공석 · 정비 · 출입 통제 건물 · 복구 도로). 대원 부상 목록에 H1 의 "결장 예상 n교대"가 이미 있으면 그대로 쓴다.
- (선택) 사건 분석 문장(`evaluate`): 그 사건의 첫 도착 기록이 결원 도착 기록이고 그 사건이 대응 지연이면 `첫 출동 부대(${호출부호})는 지난 교대의 결장으로 ${n}명만 출동했습니다.` 한 줄(기록에서 만든다).

### 5.6 화면 확인

`npx vite --port 5232 --strictPort` 를 띄우고 Playwright 로:
1. `?seed=S3` 로 한 교대를 끝까지(배속) → 보고서의 "조직" 칸과 `다음 교대 (이어서)` → 다음 교대의 첫 기록·부대 목록(`off` 칩)·지도.
2. 손으로 만든 상태(테스트 도우미 `scripts/chain.ts --dump` 로 지진 교대 뒤의 상태를 파일로 받아 `localStorage` 에 넣는다)로 `?org=continue` — 무너진 건물·복구 공사 울타리·복구 도로 고깔·범례를 큰 배율과 작은 배율에서 찍는다.
3. 난이도 창의 조직 줄(저장된 조직 있음/없음/읽지 못함), 상단 칩.
4. 저장소를 막은 창(`page.addInitScript` 로 `localStorage.setItem` 이 던지게)에서 교대를 끝내고 `이어서` 가 같은 창 안에서 이어지는지, 콘솔 오류 0건.
5. **끝까지 `seek` 한 교대도 저장된다**: 시각 막대로 `hardCap` 까지 앞으로 옮겨 교대를 끝낸 뒤 `ar.org.v1` 의 `carry.shift` 가 하나 늘었고, 이전 교대 기록에 그 교대가 있다(§5.3 `settle`).
6. 저장된 조직 없이 첫 화면을 연 창(`localStorage` 비움, 주소 조건 없음)에서 교대를 끝내면 `ar.org.v1` 이 생긴다(기본 `continue` 의 첫 교대).
7. Q1 의 `npm run ui-check` 도 돌린다(기존 화면 검사가 그대로 지나는지). 조직 칩·결장 칩이 생겼으므로 `window.__ar.snap()`(`App.tsx:55`)에 `org`(조직 교대 번호, 새 조직이면 1)와 `off`(결장 대원 수) 두 필드를 더하고, `ui-check` 에 "이어받은 상태로 시작한 교대에서 `off` 가 칩 수와 같다"는 검사 하나를 더한다(Q1 의 파일 — 한 덩어리).
찍은 그림과 임시 스크립트는 저장소 밖(scratchpad)에 둔다.

---

## 6. 균형 — 죽음의 나선을 막는다

### 6.1 회복 규칙과 상한 (`persist.ts` 상수)

| 무엇 | 회복 | 상한 | 이유 |
|---|---|---|---|
| 결장 | 휴식마다 −1. 가장 길어야 3교대(H1 표) | `ABSENT_CAP = max(2, floor(0.2 × 편성 인원))` — 넘으면 남은 결장이 짧은 사람부터 조기 복귀(체력 70) | 큰 재난 뒤에도 조직의 4/5 는 나온다 |
| 공석(순직) | `REPLACE_AFTER` 2교대 뒤 신임 대원(경험 0.1~0.3) | — | 자리가 영원히 비지 않는다. 신임은 약하므로 영향은 남는다 |
| 결원 부대 | 예비 인력이 내리는 자리의 최소 수(`minField`)와 조종사·정장 자리까지. 모자라도 나온 대원이 있으면 그 인원으로 운용한다(−18 감점만 — H1 §3.6 의 사용자 결정과 같은 정신) | `RELIEF_MAX` 4명 / 교대 | 부대가 통째로 빠지는 것은 나올 대원(헬기·구조정은 조종·조타할 사람까지)이 한 명도 없을 때뿐 |
| 펌프 | 휴식마다 +0.12, 고장은 정비 뒤 0.7 | 장비 손잡이 범위로 자른다 | 장비 손잡이의 뜻(범위)을 지킨다 |
| 정비 | 다음 교대 안에 끝난다(300~720초) | `SERVICE_CAP` 2대 | 정비가 쌓이지 않는다 |
| 섬광탄 | 휴식마다 +3 | 창고 10, 정수가 1 이상이면 적어도 1개 | 연속해서 많이 쓴 뒤에만 모자란다 |
| 건물 | `repair` 휴식마다 −1(가장 길어야 5), 뒤에 흔적이 줄어 사라진다 | 항목 24, 출입 통제·무너짐 12. 넘으면 `repair` 가 작은 것부터 '복구 완료' | 사건 장소가 바닥나지 않는다(그 종류가 모두 막히면 셋째 단계 — §3.6) |
| 도로 | 길어야 2교대, 1교대째는 그 교대 안에 연다(60~900초) | 6구간, 끊기면 놓지 않는다 | 길이 끊긴 채 남지 않는다 |
| 경험 | 교대당 +0.02 까지, 노련할수록 덜 | 누적 +0.25, 경험 0.97 | 이어갈수록 쉬워지는 "성장의 나선"도 막는다 |

모든 수치는 처음 값이다. §6.3 의 측정으로 정하고, 바꾸면 구현 메모에 적는다.

### 6.2 재측정 — `scripts/chain.ts`

```bash
npx tsx scripts/chain.ts 12 8                       # 계보 12개 × 교대 8번 (보통)
npx tsx scripts/chain.ts 12 8 --diff hard
npx tsx scripts/chain.ts 12 6 --disaster quake@1    # 첫 교대에만 지진, 그 뒤는 없음 — 회복을 본다
npx tsx scripts/chain.ts 12 8 --json                # 한 줄 JSON
npx tsx scripts/chain.ts 24 8 --check               # 기준을 어기면 종료 코드 1 (--check 의 기본 계보 수는 24)
npx tsx scripts/chain.ts 1 4 --dump <scratchpad 폴더>   # 계보 C0 의 교대마다 이어받은 상태를 JSON 파일로 (화면 확인용, 저장소 밖에)
```

- 계보 L 의 k번째 교대: 시드 `C${L}.${k}`, 첫 교대는 `carry = null`, 그 뒤는 앞 교대의 `makeCarryover`. 매 교대 `readCarryover(JSON.parse(JSON.stringify(co)))` 의 지문이 원래와 같은지 확인한다(왕복 검사).
- **I1-a 의 측정 도구를 쓴다**: `chain.ts` 는 `scripts/metrics.ts` 를 import 해서 교대마다 `runWithProbe(sim)` 으로 돌리고(`runToEnd` 와 결과가 같다 — I1 §6 의 1) `shiftMetrics(sim, probe)` 를 모은다. 교대 번호(k)마다 계보들의 `ShiftMetrics` 를 `summarize` 해서 아래 지표를 내고, 같은 요약으로 `checkMetrics` 를 돌린다(교착 M-G1·잊힌 사건 M-G2·연쇄 상한 M-G3·일치 M-G4 — "이어 돌린 교대에서도 교착·무한 연쇄·기록과 상태의 어긋남이 없다").
- 교대 번호(k)마다 한 줄:
  ```
  k  n   성공 지연 부분 실패+미해결  한계  대응  | 결장 공석 예비 정비 | 통제건물 무너짐 흔적 복구도로 | 경험+  결원출동 손상건물사건 이어진기록(사건) | 확산3+ 세계연결 경쟁 멈춤 재계획 carry
  ```
  `--json` 키: `{ lineages, shifts, diff, byShift: [{ k, n, success, delayed, partial, bad, good, timeoutShare, resp, absent, fallen, relief, service, closed, ruin, marked, roads, expMean, shortRuns, markedInc, links, linksInc, m: { spreadGe3, worldLinks, contention, stall, replan, carryShare, metricFails } }], errors, open }`.
  - `good` = `success + delayed`, `bad` = `failed + unresolved`(비율), `timeoutShare` = `(timeout + noresponse + abandoned) / n` — `sweep.ts:86` 과 같은 식.
  - `links` = 그 교대에서 `e.causes` 에 `carryState.event` 가 들어간 기록 수(요약 줄의 직접 자식). `linksInc` = 그 가운데 `incidentId ≥ 0` 인 것 — I1-a 의 `worldLinks` 가운데 T5 에서 나간 몫과 같다.
  - `m` 은 그 교대 번호의 `summarize` 결과에서 꺼낸다: `spreadGe3` = `metrics.systems.spread.ge3`, `worldLinks` = `metrics.chain.worldLinks`, `contention` = `metrics.contention.share`, `stall` = `metrics.stall.candidates`, `replan` = `metrics.replan.share`, `carryShare` = `metrics.systems.share.carry`(I1 §2.13 의 키 이름), `metricFails` = `checkMetrics` 가 돌려준 문구 수.
- `scripts/sweep.ts` 에는 `--carry <파일>` 하나만 더한다: 모든 시드에 같은 이어받은 상태를 넣어 돌린다("이 조직 상태로 시드 40개" — 이어받은 상태의 효과를 A/B 로 잴 때).

**사용자의 완료 기준과 지표 가운데 I2 가 맡는 몫**

| 사용자 기준 / 지표 | I2 가 더하는 것 | 어디서 보나 |
|---|---|---|
| 하나의 사건에서 다른 시스템으로 3단계 이상 | 교대를 넘는 첫 단계(요약 → 결원 도착·손상 건물 사건 → …) | `byShift[k].m.spreadGe3`, `worldLinks` |
| AI 가 새 정보로 계획을 바꾸는 사례 | 복구 공사가 열리며 바뀌는 경로, 정비를 마친 부대의 배정 | `m.replan` (I1-a 의 정의 그대로) |
| 부대 부족이 다른 사건에 영향 | 결장·결원 oos·정비 중 부대(교대를 넘는 부족) | `결원출동`, `m.contention`, 결원 도착 기록 |
| 결과가 기록·상태와 일치 | 적용 목록과 기록의 일대일(테스트 10), 요약 줄의 지문 | `m.metricFails`(M-G4), 테스트 10 |
| 교착·무한 연쇄·무의미한 반복 없음 | 모든 상태의 회복 규칙·상한(§6.1), 이어 돌린 교대에서의 관문 | `--check` 의 1·2·7, `m.stall` |
| 결과 다양성(실패도 결과다) | 나선 없음 기준은 "망가지지도 쉬워지지도 않는다"이지 성공률을 올리는 것이 아니다 | `--check` 의 3 |

### 6.3 기준 (`chain.ts --check`, 보통, 24 × 8)

1. 예외 0, 끝나지 않은 사건 0, 왕복 검사 실패 0.
2. 모든 교대에서 결장 ≤ `ABSENT_CAP`, 출입 통제·무너짐 ≤ 12, 복구 도로 ≤ 6.
3. **나선 없음**: 교대 6~8 의 (성공+지연) 평균과 교대 1~2 의 평균의 차이 `Δ` 와 그 표준오차 `SE`(두 묶음 각각 교대별 비율의 표준편차 / √교대 수, 제곱합의 제곱근)를 함께 찍는다. `|Δ| > max(8%p, 2.5 × SE)` 이면 실패(망가지지도, 이어갈수록 쉬워지지도 않는다). 12 × 8 에서는 `SE` 가 3%p 남짓이라 ±8%p 만으로는 가끔 거짓 실패가 난다 — 그래서 계보를 24 로 늘리고 `SE` 를 함께 본다.
4. 한계 시간 종료 비율 `timeoutShare` ≤ 4%(sweep 의 기준과 같은 식).
5. 교대 2 이후 모든 교대의 기록에 지문이 든 요약 줄이 정확히 하나.
6. 회복(`--disaster quake@1`, 12 × 6): 교대 2 의 복구 도로 평균 ≥ 1(지진이 닫은 구간이 실제로 넘어온다 — §3.5 `d.damaged`), 교대 4 의 결장 평균 ≤ 교대 2 의 결장 평균, 교대 4 의 복구 도로 평균 ≤ 교대 2 의 절반, 교대 6 의 출입 통제·무너짐 평균 ≤ 교대 2 의 절반 **(확인 필요: 첫 측정 뒤 수치를 정한다)**.
7. 모든 교대 번호에서 `metricFails === 0`(I1-a 의 `checkMetrics` — 교착·잊힌 사건·연쇄 상한·일치).
8. (측정만, 기준 아님) **그을음의 방향**: `--soot` 를 주면 화재를 강제한 같은 시드 N개를 그을음 0 과 0.6 의 같은 건물에서 돌려 소실률 평균·`BURNOUT` 비율·X6 탄 비율을 나란히 찍는다(§3.6 `applyPlaceWear`). 의도는 "그을린 쪽이 늘지 않는다"이고, 늘면 `PRE_BURN` 을 손본다.

`npm run check` 에는 넣지 않는다(교대 192번 — 다른 테스트와 함께 돌리면 느리다). 대신 `tests/persistence.test.ts` 의 짧은 연속(3 × 4)이 관문에 들어간다. 이 묶음을 끝낼 때와 균형을 바꿀 때 `chain.ts --check` 를 돌려 보고에 표를 적는다.

### 6.4 범위를 벗어나면 돌리는 손잡이 (이 순서로)

1. 이어갈수록 나빠진다 → `ABSENT_CAP` 비율(0.2), H1 표의 결장 교대 수(3·2·1), `REPLACE_AFTER`.
2. 출입 통제 건물이 늘 한도에 닿는다 → 화재의 문턱(0.6·0.25), 붕괴 `repair`(4·2). 그을린 건물의 화재가 더 탄다(§6.3 의 8) → `PRE_BURN`.
3. 이어갈수록 좋아진다 → `GAIN_K`, `EXP_CAP`.
4. 재난 뒤 회복이 느리다 → `RELIEF_MAX`, `SERVICE_CAP`, 도로의 `left`, 재난 도로의 `DIS_FULL`·`openAt` 범위(§3.5).
`npm run check` 의 기준 범위(sweep)는 이어받은 상태가 없는 교대를 재므로 이 묶음과 상관없이 그대로 통과해야 한다.

---

## 7. 다른 묶음과의 맞물림

| 묶음 | I2 가 읽는 것 | I2 가 주는 것 | 고칠 곳 |
|---|---|---|---|
| **K1** | `xpGained`·`incidentsWorked` | 성장(§3.2)·결장·저장·생성자 입력 | K1 의 전부. ROADMAP 에서 K1 을 끝난 것으로 |
| **H1** | `r.dead`·`r.care`·`r.tDown`·`mainCause`·`CAUSE_NAME`, 결장 표 함수 `outShifts(r)`(`injury.ts`) | `off` 대원의 `RosterOut.out`, 보고서의 결장 예상 | H1 `buildReport` 의 `roster` 한 줄(§3.2). `outShifts` 의 "교대 끝에 후송 중"·"쓰러진 채 병원에 가지 못함" 두 줄은 H1 §3.7 표에 들어갔다(반영됨 — 표는 한 곳에만) |
| **R1** | `STAFF`·`ROLES`(역할 식·기본 장비·`stays`), `fieldCrew`·`crewReady`, `EXTRA_NAMES`, `kit` 의 `fault`·`faultKnown`, 섬광탄 나눔(`useKit`) | `kitFault`, 창고에서 지급한 섬광탄을 사람 몫으로 나눌 합 | 결원 기준 `minField(kind)`(내리는 자리의 최소 수 — R1 §4 가 export, 반영됨. 예비 인력을 붙이는 문턱이고 운용 여부의 기준이 아니다 — H1 은 이것을 쓰지 않는다), 역할 식 `skillsOf(role, skill)`(R1 §4, 반영됨). R1 의 섬광탄 나눔이 `u.flashbangs` 합을 정한 뒤 I2 가 창고에 맞춰 줄이면, 자리 순서의 **뒤에서부터** 1개씩 뺀다. 테이저 카트리지를 창고에 넣으려면 `StockId` 에 `'taser'` |
| **X6** | `Sim.placeMarks`(`state`·`burnFrac`·`ruinFrac`) — 끝 상태의 원천, 전체 붕괴의 `I.blockedEdge`(다음 교대 `debris`), X6 의 지도 그림(`ruinLayer` 의 `total`·`burnt` 단계, G4 가 없으면 `placeMarkLayer.ts`) | `s.wear.dmg` — X6 `catOf` 의 처음 값: 실내 구획마다 `integ = min(X6 의 처음 값, 1 − WEAR_INTEG × s.wear.dmg)`(`WEAR_INTEG` 처음 값 0.5 — 손상 0.3 이면 0.85). X6 의 조짐 문턱(L1~L3)이 그대로 작동하므로 손상된 건물은 조짐이 일찍 보이고 일찍 무너진다. 이어받은 그을음의 "처음부터 탄 칸"(`s.wear.pre`) | X6 `catastrophe.ts` 의 `catOf` 처음 값 계산 한 줄. 전소 판정의 분자가 `fuel0` 칸 밖의 탄 칸을 세면 그 한 줄을 `fuel0` 칸으로 좁힌다(§3.6). `pickPlace`·`createIncident`·은신처 후보의 `collapsed`·`burnt` 제외를 `placeUsable` 호출로 바꾼다(결과 같음). 지휘관의 출동 브리핑에는 손상을 넣지 않는다 — 지휘관은 X6 의 `struct` 조짐으로 안다. 관제는 I1-b 의 `knownBuildingAt` 으로 안다(결정 — §11.2) |
| **I1-a** (구현됨 — `48dba83`) | `scripts/metrics.ts` 의 `runWithProbe`·`shiftMetrics`·`summarize`·`checkMetrics`(`chain.ts` 가 import) | `carryState.event` 를 원인으로 잇는 기록들 — "지난 교대"를 시스템 `carry` 로 세면 교대를 넘는 인과 사슬이 깊이·시스템 간 영향에 잡힌다 | **들어갔다**(I1-a 구현 — `metrics.ts` 의 `TAG_SYS`·`S(I)`. 결과·기록 불변, 맞는 기록이 없어 지금은 0): ① `sysOf` 규칙 0 의 `TAG_SYS` 에 `carry → carry` 한 줄(I2 의 기록이 `tag: 'carry'` 를 단다 — I1 §2.3 표가 말한 "요약 기록과 그것을 원인으로 한 결장·정비·출입 통제·복구 공사"가 이렇게 잡힌다. 없으면 결장·정비 줄(`kind 'unit'`)은 field, 개통 줄(`kind 'traffic'`)은 road 로 세어져 `systems.share.carry` 가 0 에 머문다). ② 사건별 시스템 집합 `S(I)` 의 상태 조건에 `carry` 한 줄: `(sim.scenes[I.id] as { wear?: unknown } \| undefined)?.wear` 가 있거나, `I.everAssigned` 의 부대 가운데 `crew` 에 `(sim.responders[rid].status as string) === 'off'` 인 대원이 있었다(`off` 는 교대 내내 바뀌지 않으므로 교대 끝에 읽어도 된다). 칸이 없을 때도 컴파일되게 이렇게 읽는다. T5 테스트는 I2 가 켠다(§8 완료 조건 3) |
| **I1-b** | `placeState`·`knownBuildingAt`(I1 §3.4), C2 의 `rubble` 장애물, `WorldTag`, `initWorld` 의 자리 | 이어받은 건물 상태(`placeState` 가 X6 다음에 읽는다), `placeUsable`(`placeState().usable` 이 부른다) | 건물 상태는 `sim.world` 로 옮기지 않는다(I1 의 결정 — 이름을 새로 만들지 않는다). `WorldTag` 끝에 `'carry'`. 교대 끝에 남은 `rubble` → `debris`(§3.5). I1-b 가 건물 상태를 교대 안에서 바꾸면(이웃 건물로 번진 불 C1 등) 그 결과는 X6 의 `placeMarks` 나 그 사건의 현장에 남으므로 `placeOutcome` 이 그대로 읽는다. `initWorld` 에는 `carry` 를 넘기지 않는다(병원·기반 시설의 교대 간 지속은 ROADMAP 의 새 항목) |
| **G4** | 무너진 지붕 덧그림·`RUIN_MARK`·그을린 지붕(§7.6) | — | G4 의 그림 함수를 `(g, q, level, u, v, seed)` 모양으로 부를 수 있게 꺼낸다(G4 의 파일 — 함수 export 만) **(확인 필요: G4 구현 뒤의 함수 이름)** |
| **T1** | `drawObstacleMark`, 통제 점선 | `closedReason 'repair'` | `trafficLayer.ts` 의 진입 금지 반복문 한 덩어리, `traffic.ts:8` 주석 한 낱말 |
| **N6** | 그 교대에 재난이 통제한 구간(`d.damaged`) | — | `closeEdge` 의 기록 한 줄, `plan` 의 객체 글자에 `damaged: []`, `DisasterState` 에 `damaged: number[]` |
| **R2·R3** | — | `off`·신임·예비 인력은 R3 의 "상태"(경험·숙련)로 저절로 들어간다 | 없음 |

---

## 8. 구현 순서와 완료 조건

단계마다 커밋하고(`wf/persist`, 한국어 메시지, 푸시하지 않음), 단계 끝마다 `npx tsc --noEmit` · `npx vitest run tests/persistence.test.ts` 를 통과시킨다. `npm run check` 는 3·5·8 단계 끝에서.

| 단계 | 내용 | 이어받은 상태가 없을 때 결과가 바뀌는가 |
|---|---|---|
| **0. 기준** | 아래 해시 목록을 scratchpad 에 저장 | — |
| **1. 틀** | `types.ts` 의 자료형과 칸(객체 글자에 `undefined` 로 미리 — §2.1 끝), `WorldTag` 의 `'carry'`, `persist.ts`(`readCarryover`·`carryKey`·`cityKey`·빈 `initCarry`·`tickCarry`·`makeCarryover` 의 뼈대·`shiftStartCounts`), `engine.ts` 의 `extra.carry`·두 칸·생성자 순서·`tickCarry` 호출·'교대 시작' 문구 고르기, `resources.ts` 의 `rosterKeys()`(+ `createRoster` 가 이 함수로 이름을 붙이게)·`traitOf` export, H1 `outShifts` 의 두 줄(없을 때 — 이 줄은 H1 의 보고서 `out` 을 바꾸지만 해시는 바꾸지 않는다) | **아니다 — 해시 목록이 같아야 한다** |
| **2. 대원** | `crewNext`(행의 순서·결장·체력·성장·신임), `applyCrewCarry`(`off`·성장·결장 상한·예비 인력 — `minField`·내리지 않는 자리, 모자라면 `short`·나올 사람이 없으면 `empty`), `off` 가 지나가는 곳(`respondersHurt`·`dispatchUnit`·`arrive` 의 판정), 결원 도착 기록의 `causes`, `announceCarry` 의 대원 줄 | 아니다 |
| **3. 장비** | 펌프 범위·`u.pumpFails`·정비·`tickCarry` 의 운용 복귀, 섬광탄 창고 | 아니다 |
| **4. 도로** | `d.damaged` 기록, `roadsNext`(재난·사건·잔해 (가)(나)), `initCarry` 의 복구 통제(우회로 검사)·한 차로·건물 앞, `tickCarry` 의 개통, `trafficLayer` 의 고깔(`drawObstacleMark` 의 `ring` 인자) | 아니다 |
| **5. 건물** | `placeOutcome`(X6 줄·2차 붕괴 detail·열린 터), 휴식, 상한, `placeUsable`·`placeCond` 와 여섯 자리(장소 고르기·정해 준 건물·재난·연쇄 방화·은신처·현장), X6 `pickPlace` 제외의 `placeUsable` 교체, I1-b `placeState` 의 `usable`, `applyPlaceWear`(처음부터 탄 칸)·`noteWearIncident` | 아니다 |
| **6. 화면** | `runner.ts` 의 저장·계보·`make`, 난이도 창·상단 칩·보고서 버튼, `carryLayer.ts`, 범례, 마우스 정보, 부대 목록·정보창 | 아니다. 스크린샷 확인(§5.6) |
| **7. 보고서** | `carryLines`·`carry`·`carryNext`·요약 줄, H1 `roster` 의 `off`, (선택) 분석 문장 | 아니다(해시는 같고 보고서 JSON 에 칸이 는다) |
| **8. 측정·균형** | `scripts/chain.ts`, `sweep.ts --carry`, §6.3 기준에 맞춰 상수 조정, `tests/persistence.test.ts` 완성, `README.md`·`CLAUDE.md`·`ROADMAP.md` | 아니다 |

0단계의 해시 목록 — H1 §10 과 같은 스크립트를 scratchpad 에 `hashes.ts` 로 둔다. **이어받은 상태가 없는 교대만** 담는다(이어받은 상태가 있는 교대는 구현 전에는 만들 수 없다 — 그 재현성은 1단계 뒤 `tests/persistence.test.ts` 의 1번이 맡는다):

```ts
import { Sim } from '/home/user/operator/src/sim/engine';
import { parseDifficulty } from '/home/user/operator/src/sim/difficulty';
const cases: [string, string, string | null][] = [];
for (let k = 0; k < 12; k++) cases.push(['S' + k, '3,3,3,3,3,3', null]);
for (const f of ['armed/shooter', 'collapse/std', 'fire/arson']) for (let k = 0; k < 3; k++) cases.push(['F' + k, '3,3,3,3,3,3', f]);
for (let k = 0; k < 3; k++) cases.push(['Q' + k, '3,3,3,3,3,3-quake', null]);       // 재난(N6)의 끝 처리를 지나는 교대
for (let k = 0; k < 4; k++) cases.push(['X' + k, '5,5,5,1,5,1', null]);
for (const [seed, d, f] of cases) {
  const [knobs, dz] = d.split('-');
  const diff = { ...parseDifficulty(knobs)!, ...(dz ? { disaster: dz as never } : {}) };
  const sim = new Sim(seed, diff, 1200, { force: f }); sim.runToEnd();
  console.log(seed, d, f ?? '-', sim.report!.hash);
}
```

1단계부터 7단계까지 이 목록이 한 글자도 달라지면 안 된다(이어받은 상태가 없는 교대에서 이 묶음은 아무것도 하지 않는다). 깨지면 그 단계를 둘로 나눠 어느 자리인지 찾는다 — 흔한 원인은 `createRoster` 의 뽑기 순서를 건드린 것, `pickPlace` 의 가중치 식에서 곱셈 순서를 바꾼 것(부동소수점), `tickCarry` 가 첫 줄에서 돌아가지 않은 것.

**완료 조건**

1. 단계 1~7 뒤 0단계의 해시 목록이 그대로다.
2. `npm run check` 통과(이어받은 상태가 없는 교대의 분포가 그대로이므로 기준 범위를 그대로 지난다).
3. `tests/persistence.test.ts` 통과(§9). 다른 테스트 파일은 고치지 않는다(`tests/sim.test.ts` 는 건드리지 않는다). 하나의 예외: `tests/causality.test.ts` 에서 문구 규칙 T5 의 검사를 켜는 한 줄(I1 §6 의 3번이 "T5 는 I2 뒤에 켠다"고 미뤄 둔 것). 켠 뒤 T5 가 이어받은 상태로 시작한 교대의 요약 줄과 맞아야 한다 — I1-a 의 정해진 시드 목록에 이어받은 상태로 시작하는 교대 하나를 더하는 것도 이 한 덩어리에 넣는다.
4. `npx tsx scripts/chain.ts 24 8 --check` 통과(§6.3 의 1~7). `--diff hard`(12 × 8)와 `--disaster quake@1`(12 × 6)의 표, `--soot` 의 비교(§6.3 의 8)를 보고에 적는다.
5. 화면 확인(§5.6): 스크린샷으로 직접 보고 콘솔 오류 0건.
6. 보고(마지막 응답): 브랜치와 마지막 커밋, 단계별 구현 여부, chain 표(보통·어려움·지진 뒤 회복), 고친 공용 파일(파일·함수·이유), 바꾼 상수, 남은 문제.

---

## 9. 테스트 — `tests/persistence.test.ts`

교대를 여러 번 돌리는 묶음은 `beforeAll` 에서 한 번 돌려 나눠 쓴다(전체 40초 안팎). 도우미: `const run = (seed, carry?, d = NORMAL) => { const s = new Sim(seed, d, 1200, carry === undefined ? {} : { carry }); s.runToEnd(); return s; }`.

1. **같은 이어받은 상태 = 같은 해시**: `A = run('P1')`, `co = makeCarryover(A)`. `run('P2', co)` 두 번과 `run('P2', JSON.parse(JSON.stringify(co)))` 의 `report.hash` 가 모두 같다. `run('P2')`·`run('P2', null)` 은 서로 같고 위와 다르다. `co` 를 조금 바꾼 것(어느 대원의 `dExp + 0.001`)은 지문과 해시가 다르다. `readCarryover` 뒤에도 입력 객체가 바뀌지 않았다(`JSON.stringify` 비교). 배속 묶음(`[1, 3, 8, 15, 40, 2, 75]` 틱씩)으로 돌려도 해시가 같다. **`makeCarryover` 는 순수하다**: `A` 에서 두 번 불러 `toEqual` 이고, 부른 뒤에도 `A.report.hash`·`A.events.length` 가 그대로다. 이어받은 상태로 돈 `B = run('P2', co)` 에서도 `makeCarryover(B)` 를 부르기 전후로 `JSON.stringify(B.carry)` 와 `B.carryState.places` 의 항목이 같다(앞 상태의 항목을 고치지 않는다).
2. **다친 대원이 다음 교대에 결장**: 끝난 교대 `A` 에서 **서로 다른 부대에서 한 명씩**, 결장 뒤에도 그 부대의 `crewReady ≥ need` 인 부대(예비 인력이 붙지 않게 — R1 뒤 진압 펌프차·구조 공작차처럼 내리는 자리가 최소보다 많은 부대, R1 없이는 아무 2인 부대)를 고른다. 한 대원(이름 X)을 `status = 'injured'; health = 30`, 다른 한 대원(Y)을 `status = 'down'; health = 10`(H1 뒤에는 `tDown = A.t` 도)으로 바꾼 뒤 `co = makeCarryover(A)` → X 의 `out === 1`, Y 의 `out === outShifts(Y)`(H1 뒤 3 — 쓰러진 채 병원에 가지 못함, §3.2. H1 없이 2). `B = new Sim('P3', NORMAL, 1200, { carry: co })` 에서 X·Y 는 `status 'off'`·`stamina 100`, 교대 내내 어떤 `s.agents` 에도 그 rid 가 없고(100틱마다 검사), 그 부대의 `crewReady` 가 1 작다(예비 인력 0). `B` 를 끝내고 `co2 = makeCarryover(B)` → X `out 0`(돌아온다, `health 85`), Y 는 앞 값 − 1. `C` 에서 X 는 `ok`·체력 85, Y 는 `off`. H1 이 합쳐져 있으면 `r.care = 'hospital'` 인 대원이 `out 2`, `r.care = 'aboard'` 인 대원도 `out 2` 인지 본다. **교대 안의 부상과 결장의 구별**(H1 "가벼운 일은 계속"): X 는 걸을 수 있는 다친 대원(`injured`·`care` 없음 — H1 뒤에는 그 교대에 가벼운 일을 계속했을 사람)이지만 `out === 1` 이고, `B` 의 시작에 `status === 'injured'` 인 대원은 0 명이다(이어받는 상태는 `off`·`ok` 뿐).
3. **무너진 건물에서는 사건이 나지 않는다**: `A = run('P4')` 에서 사건이 난 건물들 가운데 열린 터가 아닌 것을 id 순으로 12곳까지(`CLOSED_CAP` — 읽을 때 상한이 걸리므로) `U`. 그 모두를 `ruin`(`repair 4`)으로 둔 상태 `co`(`makeCarryover(A)` 의 `places` 를 바꿔 넣는다)로 `run('P4', co)` — 어떤 사건의 `placeId` 도 `U` 에 없다. 같은 상태에서 `createIncident(sim, { type: 'fire', placeId: u, rng: sim.rng.fork('t') })`(u ∈ U)는 다른 건물에서 난다(`I.truth.placeId !== u`). 납치 은신처 후보에도 `U` 가 없다(`kidnap` 강제 교대 몇 개에서 `I.pursuit.hideout ∉ U`). **손상된 건물은 다른 현장**: 한 건물을 `marked`(`soot 0.6`, `dmg 0.3`)로 두고 그 건물에 `createIncident` → `s.wear` 가 있고 `s.wear.pre > 0`, `noteWearIncident` 기록이 하나, `s.totalFuelTiles` 가 이어받은 상태 없이 같은 사건을 만든 것보다 정확히 `s.wear.pre` 작고, `s.burnedTiles` 는 0, 불이 붙은 칸과 그 이웃은 `burned` 가 아니다. **방향**: 같은 건물·같은 사건 시드의 화재를 그을음 0 과 0.6 으로 각각 끝까지 돌려(6시드) 소실률 평균이 그을음 쪽에서 크지 않다.
4. **수리된 도로가 열린다**: 간선 아닌 구간 E(양 끝 사이에 다른 길이 있는 것 — `findRoute(c, a, b, 1, E)` 가 있는 것)를 `{ edge: E, why: 'crack', lane: false, left: 1, openAt: 60 }` 으로 넣는다 → 1틱: `closed && closedReason === 'repair'`, 그 양 끝 사이의 `findRoute` 가 E 를 지나지 않는다. 61초 뒤: 열려 있고 '복구 공사 완료 — 통행 재개' 기록이 하나. 같은 `openAt` 의 한 차로 공사 F 를 함께 넣으면 61초 뒤 F 의 `slow` 가 원래 값이고 '한 차로 복구 공사 완료' 기록이 하나(목록 머리의 항목이 뒤를 막지 않는다). `left: 2` 면 교대 내내 막혀 있고 `makeCarryover` 뒤 `left 1`. `openAt 900` 을 `shiftLen 500` 교대에 넣으면 375초(`500 × 0.75`)에 열린다. **끊기는 통제는 놓지 않는다**: 막다른 구간(한쪽 끝에 길이 하나뿐)을 넣으면 닫히지 않고 `dropped` 기록이 있으며, 다음 상태에 그 항목이 없다. 이어받은 통제가 여럿인 상태로 시작한 교대에서도 0틱에 모든 시설 → 모든 교차로의 (알려진 상태) 경로가 있다.
5. **저장·복원 왕복**: `readCarryover(JSON.parse(JSON.stringify(co)), city)!.carry` 가 `co` 와 같고(`toEqual`) 지문이 같다. `v: 2`·`null`·숫자·빈 객체·`crew` 가 배열이 아닌 것은 `null`. `city` 지문이 다르면 `places`·`roads` 가 비고 `dropped` 가 있다. 범위 밖 숫자(`out 9`, `health -5`, `openAt 1e9`, `NaN`)는 잘리거나 버려진다. `JSON.stringify(co)` 에 `null` 이 아닌 값으로 `Infinity`·`NaN` 이 없고, 선택 칸에 `undefined` 가 없다.
6. **짧은 연속(관문)**: 계보 3개 × 교대 4번(보통) — 예외 0, 모든 사건이 닫힘, 매 교대 결장 ≤ `ABSENT_CAP`, 출입 통제·무너짐 ≤ 12, 복구 도로 ≤ 6, 교대 2 부터 지문 요약 줄이 정확히 하나.
7. **경험 성장과 부대 규모**: `xpGained = 0.04` 인 대원의 `dExp` 가 0 보다 크고 0.02 이하. 부대 규모 5 의 교대에서 만든 상태를 부대 규모 1 의 교대에 넣었다가 다시 5 로 — 1 에서 편성되지 않은 부대의 대원 항목이 사라지지 않고(`out` 은 휴식만큼 줄고), 같은 이름의 대원은 `skill` 이 기본 + `dSkill` 이다. **공석**: 1 에서 편성되지 않는 부대의 한 자리를 `out −1, replaceIn 2` 로 넣으면 그 교대 뒤 `out −1, replaceIn 1`(0 으로 잘려 원래 이름으로 돌아오지 않는다), 한 교대 더 뒤에는 신임 대원 항목(`seat` = 원래 이름)이다. `readCarryover` 에 조직 명부에 없는 이름 하나를 넣으면 그 항목만 버려지고 `dropped` 에 한 줄.
8. **장비와 결원**: 펌프 `0.95` 를 장비 1(범위 0.21~0.55)에 넣으면 `pumpCond === 0.55`. `service: { readyAt: 120 }` 인 부대는 120초 전에는 `oos` 이고 배정되지 않으며(그 사이 그 부대의 출동 기록 없음), 120초에 '정비 완료' 기록과 함께 `available`. 섬광탄 창고 1 이면(보통) 편성표 순서상 먼저인 기동1 이 창고에서 1개, 특공1 은 비상 지급 1개, `stats.fbShort === 4`. **헬기·구조정**(R1 뒤): 결장이 하나도 없는 이어받은 상태로 시작한 교대에서 소방 헬기·구조정에 예비 인력이 붙지 않고(`relief` 0) `available` 이다. 소방 헬기의 기장·부기장을 모두 `off` 로 두면 그 부대에 역할 `pilot` 인 예비 인력이 붙거나(예비 인력이 남으면), 아니면 `oos`·`oosWhy '결원'`(`empty`, `why 'pilot'`). **예비 인력이 모자라도 나온 대원이 있으면 운용한다**(H1 §3.6 의 사용자 결정과 같은 정신): 부대 순서상 앞의 2인 부대 넷(R1 뒤 순찰차 — 최소 = 표준 2)에서 한 명씩 `off` 로 두어 `RELIEF_MAX` 를 다 쓰게 하고, 그 뒤의 2인 부대 하나에서 한 명을 `off` 로 두면 그 부대는 `oos` 가 아니라 `available`, `crewReady === 1`, `applied` 에 `short`(`n` 1)와 '결원 — 예비 인력이 없어 1명으로 운용합니다.' 기록이 있고, 그 교대에 그 부대가 배정될 수 있다(배정에서 빠지지 않는다). 다시 그 뒤의 부대 하나에서 내리는 대원을 모두 `off` 로 두면 그 부대만 `oos`·`oosWhy '결원'`(`empty`, `why 'crew'`)이다.
9. **금지와 격리**: `src/sim` 아래 어떤 파일에도 `/localStorage|sessionStorage|indexedDB/` 가 없다. `src/sim/dispatch/*`·`field/commander.ts`·`field/brain.ts`·`field/orders/*` 에 `carryState`·`.wear` 가 없다(원칙 7 — 그 코드는 `crewReady`·알려진 통제·I1-b 의 `knownBuildingAt` 만 거친다).
10. **가짜 연출 없음 — 적용 목록과 기록의 일대일**: 짧은 연속의 모든 교대에서 — `carryState.applied` 의 항목 수와 `announceCarry` 가 남긴 기록 수(요약·`dropped` 줄 제외, 건물의 '외 n곳' 줄은 n 으로 센다)가 같고, 항목마다 그 기록이 하나씩 있다. `off` 대원은 모두 어느 `absent`·`vacant` 항목에 이름이 있다(빠진 결장이 없다). `'repair'` 로 닫혔다 열린 구간마다 '통행 재개' 기록이 하나, 정비에서 돌아온 부대마다 '정비 완료' 기록이 하나, 이 기록들의 `causes` 에 `carryState.event` 가 있고 `tag === 'carry'`(I1-b 의 칸이 있을 때). 이어받은 상태로 시작한 교대의 '교대 시작' 문구의 가용 부대 수 = `oos` 가 아닌 부대 수.
11. **재난이 닫은 도로가 넘어온다**: `--disaster quake` 로 끝난 교대 `A`(`d.damaged.length ≥ 1` 인 시드를 고정)에서 `co = makeCarryover(A)` → `co.roads` 에 `why 'crack'` 이 1 이상, `ROAD_CAP` 이하, 전면은 많아야 `DIS_FULL`. `B` 의 1틱에 그 구간들이 `'repair'`(전면) 또는 `slow` 가 늘어 있고(한 차로), 0틱에 모든 시설 → 모든 교차로의 (알려진 상태) 경로가 있다. `d.damaged` 를 기록해도 `A` 의 해시는 0단계 목록 그대로다(Q 시드).

---

## 10. 고칠 파일 목록

### 10.1 새 파일

| 파일 | 내용 |
|---|---|
| `src/sim/persist.ts` | 상수(`CARRY_VERSION`·`REST_HEAL`·`BACK_HEALTH`·`EARLY_BACK_HEALTH`·`GAIN_K`·`GAIN_CAP`·`EXP_CAP`·`SKILL_K`·`SKILL_CAP`·`ABSENT_CAP`·`RELIEF_MAX`·`REPLACE_AFTER`·`PUMP_REST`·`SERVICE_CAP`·`STOCK_CAP`·`RESUPPLY`·`PLACE_CAP`·`CLOSED_CAP`·`ROAD_CAP`·`DIS_FULL`·`LANE_SLOW`·`WEAR_INTEG`·`PRE_BURN`), 이름표(`RECRUIT_NAMES`·`RELIEF_NAMES`·`WHY_NAME`), `CarryState`·`CarryNote`, `readCarryover`·`carryKey`·`cityKey`·`initCarry`·`applyCrewCarry`·`announceCarry`·`shiftStartCounts`·`tickCarry`·`operable`·`placeCond`·`placeUsable`·`applyPlaceWear`·`noteWearIncident`·`makeCarryover`(순수)·`carrySummary`·`carryLines`·`carryLine`(마우스 정보). 결장 표는 두지 않는다(H1 의 `outShifts` 를 부른다). import 는 `types`·`rng`·`events`·`util`·`city`(`edgeName`)·`resources`(함수만)·`crews`(R1)·`field/injury`(H1 의 `outShifts`·`mainCause`·`CAUSE_NAME` — 그 파일이 `field/*` 의 다른 모듈을 맨 위에서 읽지 않는지 확인한다)·`difficulty`(타입) — `incidents`·`dispatch/*`·`debrief` 와 그 밖의 `field/*` 를 import 하지 않는다 |
| `src/view/city/carryLayer.ts` | `drawCarryWorld`, 울타리·얼룩·무너짐 그림(G4 함수가 있으면 그것을) |
| `scripts/chain.ts` | 연속 교대 측정(§6.2). `scripts/metrics.ts`(I1-a)를 import 한다 |
| `tests/persistence.test.ts` | §9 |

### 10.2 공용 파일 수정

| 파일 | 함수·자리 | 무엇을 · 왜 | 단계 |
|---|---|---|---|
| `sim/types.ts` | 끝에 추가, `Responder`·`Unit`·`Scene`·`ShiftReport` 의 선택 칸, `Responder.status` 끝에 `\| 'off'`, `WorldTag` 끝에 `\| 'carry'`(I1-b) | §2.1 | 1 |
| `sim/engine.ts` | 생성자 서명·순서, `carry`·`carryState` 칸, `step` 에 `tickCarry`, '교대 시작' 문구 고르기(이어받은 상태가 있을 때만 `shiftStartCounts`) | §3.4 | 1 |
| `sim/resources.ts` | 새 `rosterKeys()`(export) — `UNIT_DEFS` × 자리 순서로 `{ name, callsign, slot }` 을 난수 없이 만든다(처음 20줄의 0·1번 자리는 `NAMES[di*2+k]`, R1 뒤 나머지 자리는 `EXTRA_NAMES` 를 표준 자리 첨자로). 모듈에 한 번 만들어 둔다. `createRoster` 의 이름 붙이기가 이 목록을 읽게 하면 같은 식이 두 곳에 있지 않다(결과 그대로 — 0단계 해시) | 편성되지 않은 사람을 "조직에 없는 이름"과 가르기(§2.4) | 1 |
| | `traitOf` export | 성장·신임·예비 인력 | 1 |
| | `createRoster`·`createAidUnit` 의 대원·부대 객체 글자 | 새 칸을 `undefined`(`pumpFails` 는 0)로 미리 적는다(P1 모양 규칙 — §2.1 끝) | 1 |
| | (R1 없을 때만) `createRoster` 의 분야별 숙련 식(80-84) → `skillsFor` | R1 뒤에는 역할 식을 쓰므로 필요 없다 | 1 |
| | `dispatchUnit` 의 출동 준비 시간(236) | `off` 가 아닌 첫 대원(R1 뒤 `fieldCrew` 안에서)의 경험 | 2 |
| | `arrive` 의 복귀 기록(H1 §3.6) | '내리는 대원이 모두 숨졌나'·'숨지지 않은 대원이 모두 후송됐나' 판정이 `status 'off'` 를 빼고 본다. 문구는 H1 의 세 갈래 그대로 — I2 는 더하지 않는다(§3.2) | 2 |
| `sim/crews.ts`(R1) | 없음 — R1 이 `skillsOf`·`minField` 를 export 한다(R1 §4) | 성장·신임·예비 인력의 `skills`, 결원 기준 | — |
| `sim/field/injury.ts`(H1) | `outShifts` 안에 두 줄(후송 중·쓰러진 채 병원에 가지 못함 — H1 이 이미 넣었으면 없음) | 표를 한 곳에 두기(§3.2) | 1 |
| `sim/field/executor.ts` | 펌프 고장 자리(252-254) | `u.pumpFails` 한 줄(결과 불변) | 3 |
| `sim/field/sceneManager.ts` | `unitArrived` 의 도착 기록 | 부대에 `off` 대원이 있으면 `causes: [cs.event]`(문구 그대로) | 2 |
| `sim/debrief.ts` | `buildReport` 의 `respondersHurt`(185) | `off` 제외 | 2 |
| | `buildReport` 끝 | `carry`·`carryNext`·요약 줄(§5.5) | 7 |
| | (선택) `evaluate` | 결원 출동 분석 한 줄 | 7 |
| `sim/disaster.ts` | `closeEdge` 의 `d.closedEdges.push` 줄, `plan` 의 객체 글자 | `d.damaged` 기록(결과 불변). `DisasterState` 에 `damaged: number[]` | 4 |
| | `pickPlace`(355-362) | `placeUsable` 아니면 0 | 5 |
| `sim/incidents.ts` | `pickPlace`(49-67) | 제외·셋째 단계·손상 가중치 | 5 |
| | `createIncident` 의 `place` 줄(X6 의 되고르기 검사 자리) | X6 의 검사를 `placeUsable(sim, id)`(`inShift` true)로 — 결과 같음 | 5 |
| | `createIncident` 의 `I.rootEvent` 뒤(150) | `noteWearIncident` | 5 |
| `sim/scenarios/crime.ts` | `arsonNext` 의 `pool`(43-44) | `placeUsable` 인 것만 | 5 |
| `sim/pursuit.ts` | 은신처 후보 `cands`(X6 가 둔 거르기 자리) | X6 의 거르기를 `placeUsable(sim, id)`(`inShift` true)로 — 이어받은 상태도 함께(이름을 먼저 기록하므로 되돌림에 맡기지 않는다) | 5 |
| `sim/field/sceneManager.ts` | `createScene`(23-27) | `applyPlaceWear`, `wear: undefined` 칸 | 5 |
| `sim/traffic.ts` | 맨 위 주석(8) | `'repair'` 도 다른 곳의 것이라고 한 낱말(코드 변경 없음) | 4 |
| H1 의 `buildReport` `roster` | `off` 대원의 `out` | §3.2 | 7 |
| X6 `field/catastrophe.ts` `catOf` | 구획 건전도 처음 값에 `1 − WEAR_INTEG × s.wear.dmg`. 전소 분자가 `fuel0` 칸 밖을 세면 `fuel0` 칸으로 좁힌다 | §7·§3.6 | 5 |
| X6 `incidents.pickPlace` 의 제외 | X6 의 `collapsed`·`burnt` 제외를 `placeUsable` 호출로 바꾼다(결과 같음) | §3.6 | 5 |
| I1-b `world/state.ts` `placeState` | `usable` 을 `placeUsable(sim, id)` 로, 이어받은 항목의 `mark`·`burnFrac`·`ruinFrac` | §3.6 | 5 |
| `tests/causality.test.ts`(I1-a) | 문구 규칙 T5 검사를 켜는 한 줄(+ 정해진 시드에 이어받은 상태로 시작하는 교대 하나) | §8 완료 조건 3 | 8 |
| `view/runner.ts` | 키(`ar.org.v1`·`ar.input.v1`)·`make`·`begin`·`newShift`·생성자 세 갈래·`settle`(`frame`·`seek` 끝)·복원 | §5.3 | 6 |
| `view/renderCity.ts` | 월드 층 한 줄(143 뒤), `describeAt`(378 뒤) | §5.4 | 6 |
| `view/city/trafficLayer.ts` | `drawTrafficScreen` 의 진입 금지 반복문(174-180), `drawObstacleMark`(155)의 마지막 선택 인자 `ring?` | `'repair'` 는 테 색이 다른 고깔 | 4 |
| `view/scene/staticLayer.ts` | 바닥·벽 얼룩, `staticSig` 에 `s.wear?.soot` | 그을린 건물의 현장 | 6 |
| `view/marks.ts` | `REPAIR_MARK`·`ORG_MARK` | 그림 기호 | 6 |
| `ui/MapLegend.tsx` | "지난 교대의 흔적" | 범례 | 6 |
| `ui/panels.tsx` | `UnitRow`(`off`·예비·`oosWhy`), 대원 정보창의 경력, `TopBar` 조직 칩, `ReportModal` 버튼·조직 칸, `DifficultyPanel` 조직 줄 | §5.2·5.4·5.5 | 6·7 |
| `ui/App.tsx` | `onNew(seed, d, mode)`, `window.__ar.snap()`(55)의 `org`·`off` | 세 가지 시작, 화면 자동 검사 | 6 |
| `scripts/ui-check.cjs`(Q1) | 결장 칩 수 검사 하나 | §5.6 의 7 | 6 |
| `ui/styles.css` | 끝의 `/* ── persist ── */` | `.cchip.off`·`.cchip.relief`·조직 칩·조직 칸 | 6 |
| `scripts/sweep.ts` | `mk()` 와 옵션 | `--carry <파일>` | 8 |
| `README.md`·`CLAUDE.md`·`docs/ROADMAP.md` | 마지막 | 아래 | 8 |

### 10.3 `CLAUDE.md` 에 들어갈 것 (8단계)

- 구조 표에 `src/sim/persist.ts` 한 줄: "교대 간 지속: 이어받은 상태(Carryover)를 만들고(makeCarryover) 다음 교대에 적용한다(initCarry·applyCrewCarry). 건물 상태는 city.places 를 고치지 않고 carryState.places 에 겹친다."
- "절대 깨면 안 되는 것" 2번(재현성)에: "같은 시드 + 같은 난이도 + 같은 이어받은 상태 = 같은 결과. 이어받은 상태가 없으면 지금과 같은 해시."
- 4번(정보 격리)의 "진실을 읽어도 되는 곳"에 `persist.ts` 의 `placeOutcome`.
- 겪은 함정에: "**이어받은 대원의 열쇠는 이름이다.** rid 는 부대 규모 손잡이에 따라 바뀐다. 결장 대원은 `status 'off'` 로 명부에 남는다(현장·crewReady 에서 빠진다). `status !== 'ok'` 로 '이번 교대에 다친 사람'을 세면 결장자가 섞인다." · "**복구 공사 통제(`closedReason 'repair'`)의 주인은 persist.ts.** 교대 시작 때 큰 차의 우회로가 있을 때만 놓는다." · "**사건 장소를 고르는 새 코드는 `placeUsable` 을 지난다.** 무너진 건물에서는 사건이 나지 않는다. X6 의 교대 안 제외(전소·전체 붕괴)도 이 함수 하나에 있다. 건물 이름을 먼저 기록하는 연쇄는 고를 때 거른다(되돌림에 맡기면 기록과 장소가 어긋난다)." · "**이어받은 상태를 적용하는 코드는 기존 흐름을 다 뽑은 뒤 값만 바꾼다**(`equipment` 흐름처럼)." · "**결원은 `crewReady` 와 같은 단위로 센다.** R1 뒤 `crewReady` 는 내리는 자리만 센다 — 결원 기준은 `minField`(내리는 자리의 최소 수)이고, 조종사·정장은 따로 본다. `minCrew` 와 비교하면 헬기·구조정이 늘 결원이 된다." · "**이어받은 상태의 기록은 적용 목록(`carryState.applied`)에서만 만든다.** 적용은 '교대 시작' 기록 전이라 바로 그 자리에서 `emit` 할 수 없다." · "**`makeCarryover` 는 순수 함수다.** `buildReport` 안(마지막 기록·해시 전)에서 불린다."
- 확장 표에 "교대 간 지속에 항목 더하기: `types.ts` `Carryover` 에 선택 칸 → `persist.ts` 의 끝 상태(·휴식)·검사(`readCarryover`)·적용·요약 → `tests/persistence.test.ts` 왕복. 칸의 뜻이 바뀌면 `v` 를 올리고 옮기는 함수를 둔다."
- 명령 표에 `npx tsx scripts/chain.ts 24 8 --check`.

---

## 11. 알려진 위험과 결정 사항

### 11.1 알려진 위험

1. **이어받은 상태가 없을 때의 결과 불변**은 `createRoster` 의 뽑기 순서, `pickPlace` 의 가중치 연산 순서, `tickCarry` 의 첫 줄 반환, `placeUsable` 이 그때 X6 의 조건만 본다는 데 기댄다. `placeUsable` 은 `on` 이 아니면 X6 의 `collapsed`·`burnt` 검사(`inShift` 일 때만 — 장소 추첨 자리) 뒤 바로 `true`, 가중치는 `w *= …` 를 `marked` 일 때만 곱한다(1 을 곱하는 것도 하지 않는다). `rosterKeys()` 로 바꾼 `createRoster` 의 이름 붙이기, `d.damaged`·`u.pumpFails` 기록, 결원 도착 기록의 `causes` 도 결과를 바꾸지 않아야 한다 — 0단계 해시 목록이 지킨다.
2. **`status 'off'` 를 모르는 코드**: 지금 고칠 곳은 §3.2 에 적은 넷(`respondersHurt`·`dispatchUnit`·`arrive` 의 문구·H1 의 명부)이지만 R1·H1·R2·R3 가 합쳐진 뒤 `status` 를 보는 곳이 늘어 있을 것이다. 구현을 시작할 때 `grep -n "\.status" src/sim src/ui` 에서 `Responder` 의 상태를 보는 곳을 모두 확인한다(`FieldAgent.status` 와 헷갈리지 않게). 현장에 내리지 않으므로 `field/*` 는 대개 안전하다.
3. **앞 묶음의 이름**: 이 문서의 이름은 각 설계서(R1·H1·X6·I1)를 따랐지만, 모두 구현 전이다. 구현을 시작할 때 실제 이름(R1 의 `skillsOf`·`minField`, H1 의 `outShifts`·`mainCause`, X6 의 `Sim.placeMarks`·`PlaceMark`·`catOf`·전소 분자, I1-b 의 `placeState`·`knownBuildingAt`·`WorldTag`·`rubble`, I1-a 의 `summarize` 결과 키)을 확인한다. 다르면 구현 메모에 적는다.
4. **도시 지도가 바뀌면** 건물·도로 상태는 버려진다(지문 불일치). 지도를 고치는 묶음(M2 등) 뒤에는 저장된 조직의 건물·도로 흔적이 한 번 사라진다 — 의도대로다. 기록 한 줄이 남는다.
5. **localStorage**: 용량(조직 하나가 10~20KB, 입력 사본까지 두 벌), 사생활 보호 창, 다른 창의 동시 진행. 실패는 조용히 넘기고 창 안의 사본으로 이어 간다. 두 창이 같은 조직을 이어 가면 먼저 끝난 쪽만 저장된다(§5.3).
6. **성장의 나선**: 경험이 쌓이면 판단 간격·발견 반경·협상 진척 등 여러 곳(`experience` 를 읽는 14곳)이 함께 좋아진다. 상한 0.25 로도 이어갈수록 쉬워지면 §6.4 의 3번.
7. **사건 장소가 바닥남**: 종류의 건물이 하나뿐인 곳(경기장·활주로 …)이 무너지면 그 종류의 사건은 셋째 단계에서도 고를 곳이 없다(무너짐은 끝까지 안 된다) → `pickPlace` 가 `null` 을 내고 지금처럼 교차로에서 일어난다. 비행기 추락이 활주로가 아닌 교차로에서 나는 식의 어색함이 생길 수 있다 — 수가 적은 종류(3채 이하)는 `ruin` 대신 `closed` 로 두는 규칙을 넣을지 측정 뒤에 정한다 **(확인 필요)**.
8. **재난 끝의 기록과 다음 교대의 통제**: 교대 N 의 기록은 교대 끝에 '통제 해제'를 말하고, 교대 N+1 은 같은 구간을 '복구 공사로 통제'한다. 두 기록은 각각 그 교대의 상태와 맞는다(비상 통제 → 복구 공사). 문구가 이 흐름을 말하도록 다음 교대의 줄에 원인(`지진 균열`)을 넣는다.
9. **보고서 JSON**: `carryNext` 가 늘 들어가므로 보고서 JSON 은 지금과 달라진다(해시는 같다). 같은 시드 두 번의 JSON 비교 테스트(`sim.test.ts` 의 "같은 시드는 같은 이벤트 기록과 같은 보고서를 만든다")는 두 번 다 같은 칸을 가지므로 그대로 통과한다.
10. **속도**: `tickCarry` 는 할 일이 없으면 첫 줄에서 돌아간다. `placeUsable` 은 `Map` 조회 하나. `initCarry` 의 우회로 검사는 교대 시작 때 많아야 6번.
11. **예비 인력의 rid**: `sim.responders` 끝에 붙으므로 그 뒤의 지원 부대 대원 rid 가 밀린다 — 이어받은 상태가 있을 때만이고 결과가 달라지는 것이 맞다.
12. **결장자의 지구력 100**: 장비 손잡이 1·2 에서는 다른 대원이 65·82 로 시작해 서에서 1분 남짓 회복하는 동안, 결장자(100)가 배정의 평균 지구력을 조금 올린다. 교대 첫머리 1분의 일이라 받아들인다(`dispatch/*` 를 고치지 않는 대가).
13. **X6 의 교대 안 제외는 세 자리에 있다**(장소 추첨·정해 준 건물의 되고르기·은신처 후보 — X6 §7.1): 재난의 장소 고르기와 연쇄 방화의 대상은 X6 뒤에도 그 교대에 전소·붕괴된 건물을 고를 수 있고, `createIncident` 의 되고르기가 그것을 받는다(재난의 "진앙 근처" 같은 위치의 뜻은 그때 잃는다 — X6 의 결정). I2 는 그 두 곳을 넓히지 않는다(넓히면 이어받은 상태가 없는 교대의 결과가 바뀐다 — `placeUsable` 의 `inShift = false`). 넓힐 때는 `createIncident` 가 사건을 돌려주는 함수라 그 안에서 버릴 길이 없으므로, I1-b 의 예약 조건(`when`)·버린 예약(`gen.dropped`)으로 "그 건물이 쓸 수 없게 되면 예약을 버린다"를 쓰는 것이 맞다.
14. **재난 뒤의 복구 도로 수**: `d.damaged` 는 그 교대에 닫힌 적이 있는 모든 구간이라 지진·홍수 교대 뒤에는 `ROAD_CAP`(6)에 늘 닿을 수 있다. 다음 교대의 체감(한 차로 서행 여러 곳)이 과하면 재난별 상한을 따로 둔다(§6.4 의 4번 손잡이 옆).

### 11.2 결정 사항 (조사에서 열려 있던 질문)

| 질문 | 결정 | 이유 |
|---|---|---|
| 명부의 열쇠 | 이름(신임은 자리 이름 `seat`). H1 의 `RosterOut.rid` 는 화면용으로 그대로 | rid 는 부대 규모 손잡이에 따라 바뀐다 |
| 교대 안에서 가벼운 일을 한 다친 대원의 다음 교대 | H1 의 `outShifts` 표 그대로(병원에 가지 않은 `injured` 1교대 결장). 다음 교대에 `injured` 로 출근하는 사람은 없다 — 이어받는 상태는 `off` 아니면 `ok` | H1 의 "가벼운 일은 계속"(2026-11-15)은 교대 안의 규칙이다. 결장 표를 하나로 지킨다(§3.2 끝) |
| 결장 대원을 명부에서 빼나 | 빼지 않는다. `status 'off'` 로 남긴다 | rid·흐름 이름이 그대로, 결원 감점(−18)이 지금 규칙대로 걸린다, 화면이 결장자를 보여 줄 수 있다 |
| 펌프와 장비 손잡이 | 손잡이 = 범위, 이어받은 값 = 그 안의 위치. `equipment` 흐름은 그대로 뽑는다 | 손잡이의 뜻과 다른 부대의 순서를 지킨다 |
| 건물 상태를 어디에 | `placeId` 열쇠의 겹침 표(`carryState.places`). `city.places` 는 고치지 않는다. I1-b 의 `sim.world` 로도 옮기지 않는다(I1 의 결정) | 지도는 모든 Sim 이 함께 쓰고, 지도의 배열을 열쇠로 한 캐시들이 있다(`city.places` 열쇠: `kindCount`·`geoCache`, `city.nodes` 열쇠: `flowCache`·`nbCache`) |
| "쓸 수 있는 건물" 판정 | `persist.placeUsable` 하나. X6 의 `pickPlace` 제외와 I1-b 의 `placeState().usable` 이 이것을 부른다 | 판정이 셋으로 갈라지면 같은 건물을 두고 서로 다른 답이 나온다 |
| 현장에 피해를 칸 단위로 | 아니다. 요약값(그을음 → 처음부터 탄 칸·그림, 손상 → X6 의 처음 건전도)만 | 평면이 사건마다 달라 칸을 옮길 수 없다 |
| 그을음을 현장에 어떻게 | 연료를 줄이지 않고, 그을음에 비례한 칸을 처음부터 탄 칸으로(분자·분모에서 함께 뺀다) | 연료를 줄이면 칸이 더 빨리 '다 탄 칸'이 되어 소실률·전소가 오르는 거꾸로 된 효과가 난다(§3.6) |
| 결원의 기준 | 예비 인력을 붙이는 기준: 내리는 자리의 최소 수 `minField` 와 `crewReady` 를 비교하고, 조종사·정장은 따로 본다. 예비 인력은 빈 자리의 역할·기본 장비를 받는다. **운용을 멈추는 것은 나올 대원(헬기·구조정은 조종·조타할 사람까지)이 한 명도 없을 때뿐** — 모자라면 그 인원으로 감점만 받고 나간다 | R1 의 `crewReady` 는 내리는 자리만 센다. `minCrew` 와 비교하면 헬기·구조정이 늘 결원이다. 부분 결원으로 부대를 세우지 않는 것은 H1 §3.6 의 사용자 최종 결정(2026-11-15 — 부대 대원이 전부 숨졌을 때만 운용 중단)과 같은 정신이다 |
| "조직에 없는 이름"의 판정 | `resources.rosterKeys()`(편성과 상관없는 조직 전체의 열쇠)로, 읽을 때 | `sim.responders` 에는 편성된 사람만 있어 "편성되지 않음"과 가를 수 없다 |
| 무너진·통제 건물의 사건 | 무너짐은 끝까지 없음. 출입 통제는 그 종류가 모두 막혔을 때만(셋째 단계) | "무너진 건물에서는 사건이 나지 않는다", 장소 바닥남을 막는다 |
| 파손 도로의 주인 | 새 이유 `'repair'`, 주인 `persist.ts`. 재난은 지금처럼 자기 통제를 모두 열고, 그 교대에 통제한 구간을 기록만 한다(`d.damaged`) | 재난의 끝 처리를 바꾸면 이어받은 상태가 없는 교대의 결과가 바뀐다. 1200초 교대에서는 재난이 먼저 끝나므로 "교대 끝에 남은 통제"로는 아무것도 넘어오지 않는다 |
| 이어받은 통제와 도시의 연결 | 교대 시작 때 큰 차 기준 우회로가 있을 때만 놓는다 | "모든 시설에서 모든 교차로로"가 교대 시작부터 깨지지 않게 |
| "같은 시드 재실행" | 같은 **입력**으로 다시 보기(저장하지 않음). "다음 교대(이어서)"가 출력을 잇는다 | 재현을 보는 버튼의 뜻을 지킨다 |
| 저장 위치 | `ar.org.v1`(조직), `ar.input.v1`(지금 교대의 입력 — 시작할 때 한 번), `ar.current.v1`(틱 — 2.5초마다, 지금 그대로) | 되감기·복원이 같은 입력을 써야 한다. 10~20KB 의 입력을 2.5초마다 다시 직렬화하지 않는다 |
| 저장 시점 | `settle()` 한 곳 — `frame` 과 `seek` 끝에서. 저장된 조직이 없으면 언제나 저장 | 끝까지 `seek` 한 교대, 첫 화면의 첫 교대도 빠지지 않게 |
| 해시에 지문 | 이어받은 상태가 있을 때만 요약 줄에 지문 | 없을 때 해시 불변, 있을 때 내용이 다르면 해시가 다르다 |
| 연속 실행 | 새 스크립트 `scripts/chain.ts` + `sweep.ts --carry` | `sweep.ts` 는 I1-a 가 이번 세션에 고친다 — 겹침을 줄인다 |
| 금지 정규식에 localStorage | `tests/persistence.test.ts` 에서 검사 | `tests/sim.test.ts` 는 건드리지 않는다 |
| 교대 사이의 시간 | "휴식 한 번"으로 고정, 교대 시각·날씨는 그 교대의 시드 | `environment` 흐름을 바꾸지 않는다 |
| 지구력·피로 누적 | 넣지 않는다 | 휴식으로 회복된다고 본다. 큰 재난 뒤의 부족은 결장·정비·재고로 나타난다 |
| 순직 자리 | 2교대 뒤 신임 대원(약함) | 자리가 영원히 비면 나선이 된다 |
| 결원 부대 | 예비 인력이 최소 편성까지(내리는 자리 `minField` + 조종사·정장, 교대당 4명). 모자라면 나온 인원으로 운용 | 부대가 통째로 빠지는 것은 나올 사람이 없을 때뿐 |
| 이어받은 상태의 편집 | 만들지 않는다 | 관찰 전용 |
| 교통(혼잡·불법 주차·공사) | 이어받지 않는다 | 교대마다 새로 — 교통은 그날의 일이다 |
| 관제·지휘관이 이어받은 상태를 아는가 | 관제·지휘 코드는 `carryState`·`.wear` 를 직접 읽지 않는다(테스트 9). 결원은 `crewReady`·`oos`, 복구 통제는 알려진 통제, 건물은 I1-b 의 `knownBuildingAt`(관제의 위험도·이름표)으로 안다. 지휘관의 출동 브리핑에는 손상을 따로 넣지 않는다 — 손상은 X6 의 처음 건전도로 들어가고, 지휘관은 X6 의 `struct` 조짐(외부 관찰)으로 안다 | 이어받은 상태는 조직이 아는 기록이라 관제가 알아도 정보 격리에 맞다. 다만 아는 길을 정해 둔 함수로만 둔다. 기록(`noteWearIncident`)은 관찰자 시점의 진실로 남는다 |
| X6 와의 건물 상태 | X6 의 `Sim.placeMarks` 를 먼저 읽고, X6 가 표시하지 않는 작은 피해만 I2 의 대체 규칙으로 | X6 연관 표의 I2 줄이 "X6 의 이름이 기준"이라고 정했다 |

---

## 검토 메모

독립 검토 두 건(실현 가능성·규칙, 완결성)을 반영했다. 반영한 것은 본문에 녹였고, 받아들이지 않았거나 다르게 받아들인 것과 그 이유만 적는다.

1. **이름을 이미 기록한 연쇄를 '버림'으로 처리하는 안**(검토 1 의 은신처 항목): 받아들이지 않았다. 대신 이름을 먼저 기록하는 곳(은신처)과 장소를 고르는 곳(연쇄 방화·재난)이 **고를 때** `placeUsable` 로 거르게 했다. 이어받은 상태는 교대 내내 바뀌지 않으므로 이것으로 충분하다. `createIncident` 의 되돌림은 마지막 안전장치로만 남겼다(그 자리는 이어받은 상태만 보므로 시험이 정해 준 건물에서만 닿는다). `createIncident` 는 사건을 돌려주는 함수라 그 안에서 버릴 길이 없다. 같은 교대 안에서 X6 가 무너뜨린 건물을 연쇄가 고르는 경우는 지금(X6)의 동작이고, I2 가 넓히면 이어받은 상태가 없는 교대의 결과가 바뀌므로 넓히지 않았다(§3.6, §11.1 의 13).
2. **H1 표에 더할 두 줄의 값**: 검토 2 는 "쓰러짐·병원 안 감 → 2" 를 제안했다. 이 문서는 "교대 끝에 아직 병원에 닿지 않은 사람은 교대 뒤에 인계된다"로 보고 H1 의 병원 줄과 같게 했다(쓰러졌으면 3, 후송 중이고 쓰러지지 않았으면 2). 같은 사람이 병원에 닿았는지 아닌지(교대가 몇 초 일찍 끝났는지)로 결장이 줄어들면 어색하다. 또 이 검토의 범위는 이 파일뿐이라 `H1-injuries.md` 의 표는 고치지 못했다. 그래서 "H1 구현이 넣지 않았으면 I2 1단계가 `outShifts` 안에 더한다"로 적었다. 설계서 정합성 작업에서 H1 §3.7 의 표에도 이 두 줄을 옮겨 적기를 권한다(H1 의 "순직은 명부에서 빠진다"를 "현장·가용 인원에서 빠진다"로 읽는다는 것도 함께).
3. **잔해 장애물 (나)의 `left`**: I1 §3.10 C2 는 "교대 끝에 남은 잔해는 I2 의 `debris`(전면, `left 2`) 줄로"라고 적었다. 이 문서는 X6 전체 붕괴의 구간 (가)만 `left 2` 로 두고, 교대 끝에 남은 `rubble` 장애물 (나)는 `left 1`(다음 교대 안에 열림)로 했다. C2 의 장애물은 240~420초짜리라, 교대 끝까지 남았다면 늦게 놓인 것이다. 다음 교대 내내 막을 까닭이 없다. 전체 붕괴의 잔해는 건물 한 채라 하루를 넘긴다. I1 쪽 문구는 이 문서의 표를 따르면 된다(I1 은 "I2 가 그 줄의 원천을 맞춘다"고 맡겨 두었다).
4. **`initWorld` 의 자리**: 검토 2 는 "`initCarry` 뒤"를 제안했다. I1 은 `this.world = initWorld(this)` 의 정확한 자리를 정하지 않았고, I1-b 가 먼저 구현된다. I2 가 그것을 옮기면 이어받은 상태가 없는 교대의 결과가 바뀔 수 있다(구역 상태의 처음 값이 다른 하위 시스템의 상태를 읽는 경우). 그래서 "I1-b 가 둔 자리 그대로, `carry` 를 넘기지 않는다"로만 적었다.
5. **측정 도구가 원인을 따라가서 `carry` 를 세는 안**(검토 2 의 "`sysOf` 의 kind 규칙 앞에 causes 가 T5 를 가리키면 carry"): 다르게 받아들였다. `sysOf(e)` 는 기록 하나만 받는 함수라(I1 §2.2), 원인을 따라가려면 서명을 바꿔야 한다. 대신 I2 의 기록에 `tag: 'carry'` 를 달고(I1-b 의 `tag` 칸과 `WorldTag` 에 한 값), I1-a 에는 `TAG_SYS` 한 줄과 `S(I)` 의 상태 조건 한 줄만 지금 넣게 했다(§7). 결장한 사람의 부대가 나간 사건은 상태 조건으로, 결원 도착은 `causes` 로 `worldLinks`·`spread` 에 잡힌다.
6. **다른 설계서·파일을 바꾸는 항목**: 이 검토는 이 파일만 고친다. 그래서 다른 파일에 필요한 것은 모두 구현 때 고칠 곳으로 §10.2 에 적었다. 해당하는 것: I1-a 의 `TAG_SYS`·`S(I)`, `tests/causality.test.ts` 의 T5, X6 의 `pickPlace` 제외와 전소 분자, I1-b 의 `placeState`, H1 의 `outShifts`, R1 의 역할 식 export, Q1 의 `ui-check`. 그 설계서들의 본문은 고치지 않았다. I1-a 의 두 줄은 **이번 세션의 I1-a 구현이 바로 넣을 수 있는 크기**로 적었다(결과·기록 불변, 지금은 0).
7. **재난 도로 — 남은 통제(`d.leftover`) 안**: 지웠다. 검토 2 의 계산대로 1200초 교대에서는 재난이 늘 먼저 끝나 그 기록이 비어 있다. "그 교대에 통제한 적이 있는 구간"(`d.damaged`)으로 바꾸고, 지진·해일은 앞의 2구간만 전면, 나머지는 한 차로로 해서 다음 교대가 길이 막힌 도시가 되지 않게 했다. 홍수·산불은 물·불이 빠진 뒤의 정리라 한 차로로 했다.
8. **그을음**: 두 검토의 제안 가운데 "처음부터 탄 칸으로 두고 분자·분모에서 함께 뺀다"를 골랐다. "번짐 계수에만 곱하는 칸을 따로 둔다"는 `hazards.ts` 의 `tickFire` 안쪽 고리를 고쳐야 한다. 그러면 이어받은 상태가 없을 때의 결과 불변을 지키기가 더 어렵다(매 칸의 곱셈 순서). 처음부터 탄 칸은 현장을 만든 직후 한 번만 바꾸고 `tickFire` 를 건드리지 않는다.
9. **사용자 결정(2026-11-15) — 결원 규칙**("운용을 멈추는 건 그 부대 전부 죽었을 때로"): 예비 인력은 결장한 자리를 `minField` 까지 채우되, 모자라도 출근한 대원이 한 명이라도 있으면 그 인원으로 운용한다(`short`). 부대가 `oos` '결원' 이 되는 것은 나올 대원(헬기·구조정은 조종·조타할 사람까지)이 한 명도 없을 때뿐이다(`empty`). 고친 곳: 연관 표 R1 줄, §2.2 `CarryNote`, §3.2 적용 6·끝 문단, §3.7 기록 4·`operable`, §6.1, §7 R1 줄, §8 단계 2, 시험 8, §10.2, §11.2.
10. **사용자 결정(2026-11-15) — "가벼운 일은 계속"**(H1 §3.6·§3.6a): 걸을 수 있는 다친 대원은 그 교대 안에서 부대에 남아 가벼운 일만 맡는다. 이것은 교대 안의 규칙이라 결장(`off` — 출근하지 않음)과 다르고, 교대를 넘는 결장은 H1 의 `outShifts` 표 그대로다 — 이어받는 대원 상태는 `off` 아니면 `ok` 라 다음 교대에 `injured` 로 출근하는 사람이 없어 두 규칙이 부딪치지 않는다. 고친 곳: 연관 표 H1 줄, §3.2 의 `off` 가 지나가는 곳·`arrive` 두 줄·끝 문단(결장과 부상의 구별), 시험 2, §10.2, §11.2.

---

## 구현 메모 (진행 중)

뒤 단계의 작업자는 이 절을 정본으로 읽는다(본문과 다르면 이 절과 코드가 맞다).

### 단계 1 — 틀 (이어받은 상태가 없을 때 결과 불변) · 준비 줄, `wf/persist`

시작점 `5988db7`(주 브랜치 — R1 전체, H1 단계 0~6, X6 단계 1, R2 단계 0, I1-a, I1-b 단계 b0, R3 단계 0). README "겹쳐 돌리기"의 준비 줄 규칙대로 공용 파일은 `engine.ts`·`types.ts`·`resources.ts` 만 고쳤다(`debrief.ts`·`field/injury.ts` 는 고칠 것이 없었다 — 아래 11).

**실제 이름** (뒤 단계가 쓴다)

| 파일 | 이름 |
|---|---|
| `src/sim/persist.ts` (새) | 상수 `CARRY_VERSION`·`EXP_CAP`·`SKILL_CAP`·`REPLACE_AFTER`·`STOCK_CAP`·`PLACE_CAP`·`CLOSED_CAP`·`ROAD_CAP`(§10.1 의 나머지 상수는 그것을 쓰는 단계가 더한다) · `CarryState`·`CarryNote`(§2.2 그대로) · `cityKey(city)` · `carryKey(co)` · `readCarryover(x, city)` · `initCarry(sim, dropped)` · `applyCrewCarry(sim)`(빈 함수 — 자리만) · `shiftStartCounts(sim)`(문구의 "가용 부대 …, 대원 …명" 부분만 돌려준다) · `announceCarry(sim)` · `tickCarry(sim)` · `makeCarryover(sim)` |
| `src/sim/resources.ts` | `rosterKeys(): readonly RosterKey[]`(`RosterKey = { name; callsign; slot }` — 이 파일에서 export, 처음 부를 때 한 번 만든다) · `traitOf` export |
| `src/sim/engine.ts` | `readonly carry: Carryover \| null` · `carryState: CarryState` · 생성자 `extra.carry` |
| `src/sim/types.ts` | 끝의 "교대 간 지속 (I2)" 블록: `Carryover`·`StockId`·`CrewCarry`·`RecruitBase`·`UnitCarry`·`PlaceCarry`·`RoadCarry`·`CarrySummary` 와 인터페이스 합치기(`Responder` 의 `seat`·`relief`·`carryOut`·`carryCause`, `Unit` 의 `readyAt`·`oosWhy`·`pumpFails`, `Scene.wear`, `ShiftReport` 의 `carry`·`carryNext`). `Responder.status` 의 `'off'` 는 그 줄 끝에 새 줄로 |

엔진 생성자의 순서(§3.4): `generateCity` → `readCarryover` → `initCarry`(①) → `initTraffic` → `createRoster` → `applyCrewCarry`(②) → `initGenerator`·`majorAt`·`initDisaster` → '교대 시작' → 헬기 운항 줄 → `announceCarry`(③). `step` 은 `tickTraffic` → `tickCarry` → `tickDisaster` …. '교대 시작' 문구는 `this.carryState.on ? shiftStartCounts(this) : 지금 문구`.

**본문과 다르게 한 곳**

1. **`announceCarry` 를 1단계에 넣었다**(요약 줄과 `dropped` 줄). §8 의 1단계 줄에는 없지만, 1단계의 시험 1("조금 다른 상태는 지문과 해시가 다르다", "`run('P2')` 와 다르다")이 지문이 든 요약 줄에 기댄다. 요약의 몫(결장·공석·정비 중·출입 통제 건물(무너짐)·복구 공사 도로)은 지금 상태에서 센다 — 1단계는 적용하는 것이 없어 언제나 '남은 피해 없음.'. **'숙련이 오른 대원'은 넣지 않았다** — 성장을 적용하는 단계 2 가 더한다(적용하지 않은 성장을 기록하면 가짜 연출).
2. **`applyCrewCarry` 를 빈 함수로 두고 생성자에서 부른다** — 생성자의 자리(②)를 1단계에 고정해 단계 2·3 이 `engine.ts` 를 다시 고치지 않게.
3. **`readCarryover` 의 버림 문장을 더했다**: 형식이 틀린 항목·같은 열쇠의 뒤 항목·모르는 열거값의 항목은 한 줄로 모아 '형식이 맞지 않는 기록 n개는 버립니다.'. 편성표에 없는 호출부호는 '편성표에 없는 부대 n대의 기록은 버립니다.'(본문은 대원 줄만 정했다). 상한은 '남은 피해가 있는 건물이 많아 n곳의 기록은 이어받지 않습니다.'·'복구 공사 도로가 많아 n구간의 기록은 이어받지 않습니다.'(출입 통제 상한과 건물 상한을 한 줄로).
4. **대원의 `cause` 는 H1 의 `CAUSE_NAME` 에 있는 이름만** 받는다 — 모르는 이름은 `null`(결장은 남긴다). 그래서 `persist.ts` 가 `field/injury` 를 import 한다(§10.1 이 허락한 import — 잎 모듈). `kitFault` 는 `crews.KITS` 의 열쇠만 남긴다.
5. **숫자**: 정수 칸(`out`·`replaceIn`·`shifts`·`incidents`·`repair`·`left`·`since`·재고)은 반올림한 뒤 자른다. 필수 칸의 수가 유한하지 않으면(또는 숫자가 아니면) 그 항목을 버린다. 선택 칸(`seat`·`replaceIn`·`recruit`·`kitFault`(배열이 아님)·`pump`·`service`·`spot`·`mark`·`opened`)이 틀려도 그 항목을 버린다 — 반쯤 읽은 항목을 남기지 않는다. `marked` 의 `repair` 는 0 으로 읽는다(타입 주석 "marked 면 0").
6. **도시 지문이 다르면** 돌려주는 `carry.city` 를 지금 도시의 지문으로 둔다(건물·도로를 비웠으므로 지금 도시와 맞다). 건물·도로가 처음부터 비어 있어도 그 한 줄은 남긴다(본문 그대로).
7. `from.diff` 는 `difficultyLabel(sim.difficulty)`(화면용 이름 — '보통' · '사용자 설정 …' · '… · 재난 지진'). 그래서 `difficulty` 를 함수까지 import 한다(잎 모듈 — 본문은 "타입").
8. **`makeCarryover` 뼈대**: 조직 명부의 모든 열쇠마다 한 항목 — 앞 상태에 있으면 복사(모든 칸 — 선택 칸은 있을 때만), 없으면 처음 상태(`out 0`·`cause null`·`health 100`·나머지 0). `units`·`stock`·`places`·`roads` 는 비운다. 끝 상태 읽기와 휴식은 단계 2(대원)·3(펌프·정비·재고)·4(도로)·5(건물). `from.hash` 는 `sim.report ? sim.report.hash : ''`(단계 7 이 `buildReport` 안에서 부르면 빈 문자열 — 본문 그대로).
9. **`Scene.wear` 의 리터럴 칸**(`createScene` 의 `wear: undefined`)은 넣지 않았다 — §10.2 표가 5단계(`applyPlaceWear` 와 함께)로 적었고(§2.1 끝은 그 칸을 1단계와 함께 적었다), 준비 줄의 1단계는 공용 파일을 위의 셋만 고친다. 1단계에는 `wear` 를 채우는 코드가 없어 현장 객체의 모양이 갈라지지 않는다. **단계 5 가 넣는다.**
10. **`WorldTag` 의 `'carry'`**: 넣지 않았다 — `WorldTag`·`SimEvent.tag` 가 아직 없다(I1-b 단계 b1·b2 의 몫). 아래 "이어받을 자리".
11. **H1 `outShifts` 의 두 줄**(교대 끝에 후송 중 · 쓰러진 채 병원·후송 아님): **이미 있다**(H1 단계 6 — `care !== undefined` 면 쓰러진 적 있음 3 / 없음 2, `tDown !== undefined` 이고 후송 아님 3). `injury.ts` 는 고치지 않았고 H1 의 보고서 `out` 도 그대로다. `status 'off'` 인 대원에게는 `outShifts` 가 0 을 돌려준다 — I2 가 `off` 대원의 `out` 을 자기 값으로 채운다(본문 그대로 — 단계 2·7).

**객체 모양**: `Responder` 의 네 칸(`undefined`)은 `createRoster`·`createAidUnit` 의 대원 리터럴 끝(H1 줄 다음)에, `Unit` 의 `readyAt`·`oosWhy`(`undefined`)·`pumpFails`(`0`)는 두 부대 리터럴 끝(R3 줄 다음)에 같은 순서로 넣었다. 단계 2 의 예비 인력 리터럴은 `createRoster` 의 대원 리터럴과 같은 순서로 만든다.

**시험** (`tests/persistence.test.ts` 새 파일 — 21개, 혼자 돌리면 6초쯤): 1(전부 — 같은 상태·JSON 왕복·배속 묶음·조금 다른 상태·`null`/인자 없음·요약 줄 하나와 지문·입력 불변·`makeCarryover` 의 순수성·끝나지 않은 교대의 예외·교대 시작 문구의 가용 부대 수), 이어받은 상태가 없는 교대(인자 없음·`{}`·`{ carry: null }` 이 같은 해시, `carryState` 가 꺼지고 비어 있음), 명부의 열쇠(규모 5 의 명부 = `rosterKeys()` 의 이름·순서, 규모 1~4 는 그 부분열이고 소속이 같다), 5(전부 — 왕복·`null` 이 되는 입력·도시 지문·범위·열거값·출동 시설·`marked` 로 읽기·상한·JSON 안전), 7 의 읽기 부분(명부에 없는 이름·같은 열쇠·편성되지 않을 사람의 항목은 남음·편성표에 없는 호출부호, 버린 것의 기록이 요약 줄 뒤에 요약 줄을 원인으로), 9(전부 — 글자). §9 의 2·3·4·6·7(성장·부대 규모)·8·10·11 은 그것을 적용하는 단계가 더한다.

**수치**

- 해시 목록 158교대(scratchpad `wf-persist/hashlist.ts`, 기준 `base-hashes.txt` = `5988db7` 를 따로 풀어 잰 것): §8 의 0단계 목록(S0~S11 보통, `armed/shooter`·`collapse/std`·`fire/arson` × F0~F2, 지진 Q0~Q2, X0~X3 `5,5,5,1,5,1`) + 보통 40 + 어려움 20 + 극한 20 + 재난 다섯 × 3 + 강제 일곱(`fire/std`·`armed/hostage`·`armed/kidnap`·`armed/bomb`·`traffic/bus`·`hazmat/std`·`collapse/gasblast`) × 3 + 부대 규모 1·2·4·5 × 3 + 500초 교대 2. 줄마다 `report.hash`·`JSON.stringify(report)` 의 FNV·기록 수·명부 지문(이름·숙련·특성) — **변경 뒤 158줄 모두 한 글자도 다르지 않다**(보고서 JSON 도 같다: 1단계는 보고서 칸을 채우지 않는다).
- 관문 `npm run check` 통과: 파일 17 · 527개 통과 + 건너뜀 1(앞 506 + 새 21), vitest 294초 · 전체 5분 16초(다른 묶음과 함께 도는 기계 — 앞 합치기의 관문 vitest 319초보다 짧게 잰 것은 부하 차이다. 새 파일 혼자는 6초쯤이고 다른 파일과 나란히 돈다). `sweep 40 --check` 의 출력(분포·지표·후보)은 앞 합치기의 관문 기록과 줄마다 같다(교대당 시간 줄만 다르다).
- 교대 하나의 시간(`sweep 20`, 기준·변경 번갈아 두 번): 사용자 CPU 기준 28.9·27.5초 / 변경 27.8·27.5초, 교대당 벽시계 469~480ms — 차이 없음(`tickCarry` 는 첫 줄에서 돌아간다). 출력도 같다.
- 이어받은 상태 하나의 JSON 크기: 8.5KB 쯤(대원 75명 — 뼈대. 본문의 10~20KB 예상 안).

**뒤 단계가 이어받을 자리**

- **I1-b 단계 b1·b2 가 합쳐지면**: `types.ts` 의 `WorldTag` 끝에 `| 'carry'`(새 줄), `announceCarry` 의 요약이 아닌 줄(지금은 `dropped` 줄)과 단계 2~5 의 기록에 `tag: 'carry'`. `initWorld` 는 옮기지 않고 `carry` 를 넘기지 않는다 — I1-b 가 `initWorld` 를 `initDisaster` 뒤에 두면 I2 의 세 자리(①②③)와 그대로 맞물린다.
- **X6 단계 2~**: `pickPlace`·`createIncident`(정해 준 건물)·은신처 후보의 `collapsed`·`burnt` 제외는 아직 없다(X6 단계 1 은 상태만) → 그 검사가 들어온 뒤 단계 5 가 `placeUsable` 한 번의 호출로 바꾼다. `catOf` 의 처음 건전도·전소 분자(`fuelMask`·`fuel0` — `types.ts` 의 `CatState` 주석이 "전소 비율의 분모·분자를 이 칸으로만 센다"고 적었다)도 단계 5.
- **I1-b 의 `knownBuildingAt`·`placeState`·`rubble`**: 아직 없다(grep 으로 확인) → 단계 4(`rubble` → `debris` (나))·단계 5.
- **단계 2**: `crewNext`·`applyCrewCarry` 의 몸, `announceCarry` 의 대원 줄과 '숙련이 오른 대원', `respondersHurt`·`dispatchUnit`·`arrive` 의 `off`, 결원 도착 기록의 `causes`. 시작할 때 §11.1-2 대로 `grep -n "\.status" src/sim src/ui` 로 `Responder.status` 를 읽는 곳을 다시 본다(`FieldAgent.status` 와 헷갈리지 않게 — 1단계는 이 목록을 고치지 않았다). `Responder.status` 에 `'off'` 를 더해도 `tsc` 는 깨지지 않았다 — 상태별 표(`Record<status, …>`)가 없다. 측정 도구의 `S(I)`(`metrics.ts:634`)는 이미 `'off'` 를 본다.
- 시험 10(적용 목록과 기록의 일대일)은 적용 항목이 생기는 단계 2 부터 더한다.

### 단계 2 — 대원 (이어받은 상태가 없을 때 결과 불변) · 준비 줄, `wf/persist-s2`

시작점 `632d785`(주 브랜치 — R1·H1 전체, X6 단계 0~5, R2 0, I1-a·I1-b b0, R3 0, I2 1, N8 1·2a·2b, N9 1·2·3). 단계 1 은 그 안에 이미 합쳐져 있었다(`git merge` 가 앞으로 감기만 했다).

**실제 이름** (뒤 단계가 쓴다)

| 파일 | 이름 |
|---|---|
| `src/sim/persist.ts` | 상수 `REST_HEAL` 40 · `BACK_HEALTH` 85 · `EARLY_BACK_HEALTH` 70 · `GAIN_K` 0.5 · `GAIN_CAP` 0.02 · `SKILL_K` 0.6 · `ABSENT_SHARE` 0.2 · `ABSENT_FLOOR` 2 · **`absentCap(편성 인원)`**(본문의 `ABSENT_CAP` — 편성 인원에 따라 달라지므로 함수) · `RELIEF_MAX` 4 · `RECRUIT_NAMES`(24) · `RELIEF_NAMES`(8). export 함수 **`operable(sim, u)`** = `crewReady > 0` 이고 조종·조타 자리가 있는 부대면 그 사람이 나와 있다(단계 3 의 정비 뒤 운용 복귀가 쓴다). 안쪽: `crewNext`(끝 상태 → 다음 교대의 대원 항목) · `recruitBase`(흐름 `recruit:<자리>`) · `makeRelief`(흐름 `relief:<호출부호>`) · `carryNoteText`(적용 항목 → 기록 문구, 문구가 아직 없는 항목은 `null` — 단계 3~5 가 `case` 를 더한다) · `pilotOk`·`mixedKind`·`staysMin`·`staysPresent` |
| `CarryState.stats` | `grown` 을 더했다(요약 줄의 '숙련이 오른 대원') |
| `CarryNote` | `'early'` 에 `unit` 을 더했다(기록의 주인 = 호출부호) |

**적용의 순서** (`applyCrewCarry` — `createRoster` 뒤, 모든 흐름을 다 뽑은 다음 값만): ① 사람마다 신임(같은 rid — `name`·`seat`·기본 능력 여섯, `role`·`kit` 은 그 자리의 것) → 성장(`experience`·`skill`·`judgment`·`skills = skillsOf(role, skill)`·`trait`) → `out === 0` 이면 이어받은 체력 → `kitFault` 를 명부의 고장 추첨 뒤에 `fault = true` ② 결장 상한(조기 복귀) ③ 결장·공석을 `off`(`carryOut`·`carryCause`·지구력 100) ④ 적용 목록: 부대마다 신임 → 결장 → 공석, 그다음 조기 복귀 ⑤ **(단계 3 의 자리 — 주석으로 표시: 펌프·정비)** ⑥ 예비 인력(부대 순서, 결장이 있는 부대만, `u.readyAt` 이 있는 정비 중 부대는 건너뛴다) → 섬광탄 다시 나누기 → `empty`(oos '결원') / `short`.

**본문과 다르게 한 곳**

1. **`ABSENT_CAP` 은 `absentCap(fielded)` 함수**와 상수 둘(`ABSENT_SHARE`·`ABSENT_FLOOR`). 편성 인원 = 적용할 때의 `sim.responders.length`(예비 인력·지원 대원 전 — 공석 포함).
2. **결장 줄은 (부대, 원인, 남은 교대)마다 한 줄**이다(본문 "부대마다 한 줄"). `CarryNote 'absent'` 가 원인·남은 교대를 하나씩만 가지므로, 한 부대에 원인이나 남은 교대가 다른 결장자가 있으면 줄이 나뉜다. 대개는 부대마다 한 줄이다.
3. **문구**: 결장 `김도윤·이서준 대원이 결장합니다 (총상 · 2교대 남음).` — 본문의 `${josa(이름들, '이/가')}` 에 '대원'을 붙였다. 원인이 없으면(`cause null`) `(1교대 남음)`. 예비 인력 줄의 역할 이름은 `ROLES[role].name`. 그 밖의 줄(공석·신임·조기 복귀·모자람·운용 중단)은 본문 §3.7 그대로. 부대 줄은 `role 'UNIT'`·`actor` 호출부호·`kind 'unit'`(운용 중단만 `imp 2`), 원인은 요약 줄. `tag: 'carry'` 는 아직 없다(I1-b b1·b2 의 `SimEvent.tag` 가 없다 — 단계 1 메모의 이어받을 자리 그대로).
4. **'숙련이 오른 대원 g명'** = 이번 교대에 나온(off 가 아닌) 조직 대원 가운데 누적 `dExp`·`dSkill` 이 0 보다 큰 사람. 누적이라 이어갈수록 거의 모두가 된다(보통 2번째 교대에 41명, 4번째 47명). 상태로는 맞지만 읽을거리는 적다 — 단계 7(보고서)·8(측정)이 문턱(예: `dSkill ≥ 0.01`)을 둘지 정한다.
5. **결장한 사람이 든 섬광탄은 나온 사람(예비 인력 포함)에게 다시 나눈다**(`crews.dealFlashbangs` — 부대의 합 `u.flashbangs` 은 그대로, 결장자의 항목은 `uses 0`). 본문에 없다. 하지 않으면 현장에 없는 사람의 섬광탄이 `u.flashbangs` 에 남아 관제·지휘관이 쓸 수 없는 섬광탄을 센다(기동1 의 기동대원 한 명이 결장하면 그 몫 1개). **단계 3 의 창고 지급**은 예비 인력 뒤에 두고, 같은 식으로 나온 사람에게만 나눈다.
6. **`kitFault` 를 단계 2 에 넣었다**(§3.2 의 R1 뒤 줄·적용 7 — §8 의 단계 3 줄에는 없고 `crewNext`·`applyCrewCarry` 의 일부라서). 점검 해시의 '교대' = 끝난 교대의 조직 번호(`prev.shift`, 새 조직의 첫 교대는 1). 나온 사람(5·6행)과 편성되었지만 결장한 사람(2행)은 이번 교대 `r.kit` 의 숨은 고장(`fault && !faultKnown` — 이번 교대 `kit` 흐름의 추첨 + 이어받은 고장)을 점검하고, 편성되지 않은 사람(3행)은 앞 상태의 `kitFault` 를 다시 점검한다(휴식마다 절반). 공석·순직은 넣지 않는다. 예비 인력의 장비는 고장 추첨을 하지 않는다(흐름이 없다). 적용은 기록하지 않는다(숨은 고장은 조직이 모른다 — 기록하면 진실이 샌다).
7. **본문 밖에서 `off` 를 막은 자리 둘**(§11.1-2 의 훑기에서 찾았다 — 둘 다 결장이 없으면 결과가 같다): `resources.tickUnits` 의 이송 중 처치 수준(차에 타지 않은 결장 구급대원의 장비로 처치하지 않게 — `q.status !== 'off'` 한 조건), `field/rules/air.ts` `makeOp` 의 상공 관측자(결장한 관측관·대원을 관측자로 고르지 않게 — 경찰 헬기의 관측관만 결장하면 예비 인력 없이(crewReady 2 = minField 2) 뜨고 관측자는 기장이 된다).
8. **결원 도착 `causes` 를 상공 도착(`현장 상공 도착`)에도 붙였다** — 결원 부대가 나간 사건(§5.5)에 헬기도 든다. 지상 도착은 본문 그대로.
9. **신임 이름**: "아직 쓰지 않은 이름"에서 바뀌기 전 공석의 이름도 뺀다(숨진 신임의 이름이 새 신임에게 다시 가지 않게). 이름을 나누는 것은 모든 열쇠를 지난 뒤 한 번에(명부 순서) — 뒤 열쇠의 기존 신임 이름과 겹치지 않게.
10. **공석 항목의 `health` 는 100**(`readCarryover` 의 범위 [1, 100] — 왕복이 같도록, 신임이 100 으로 온다). 순직의 `cause` = `r.deathCause ?? mainCause(r.injuries)`. 결장이 끝나 `out 0` 이 되면 `cause null`.
11. **조종·조타할 사람** = 역할의 그림 묶음 `'pilot'`(기장·부기장·정장). ⓑ(내리지 않는 자리가 모자람)는 섞인 부대(소방·의료 헬기, 구조정)만 — 경찰 헬기(전원 내리지 않음 — `fieldCrew` 가 전원)는 ⓐ 만 보고 첫 빈 자리(0번 기장)부터 채운다. 운용 판정(`operable`)은 모든 부대에 '조종 자리가 있으면 그 사람이 나와 있다'를 건다.
12. 예비 인력의 지구력은 `tn.startStamina`(본문에 없음 — 명부와 같게), `senior: false`, 장비는 그 자리 사람의 장비 id 를 `kitFor(role, tn.airFull, ids)` 로(복구반장처럼 자리별 장비도 그대로), 섬광탄 `uses 0`.
13. **예비 인력이 다 찬 부대도 배정의 −18 을 받는다** — `off` 자리가 `u.crew` 에 남아 `crewOk < fieldCrew.length`(본문 §11.2 의 결정 "결원 감점(−18)이 지금 규칙대로 걸린다", `dispatch/*` 는 고치지 않는다). 평균 지구력에는 결장자(100)와 예비 인력(시작 지구력)이 함께 든다.
14. 2행(편성되었고 결장)의 `out` 은 앞 상태의 값 − 1(앞 상태가 없으면 `r.carryOut`). 결장한 교대는 경력(`shifts`·`incidents`)에 세지 않는다.

**`status 'off'` 를 읽는 자리 (다시 훑은 결과)**: `crewReady`·`crewOk`·`unitArrived` 의 내리는 사람(`canDeploy`)·지구력 회복·`commander` 의 오는 부대 능력(`status === 'ok'`)·`crewHasKit`(기본 `okOnly` — `false` 로 부르는 곳 없음)은 이미 뺀다. 고친 곳: `debrief.buildReport` 의 `respondersHurt`, `resources.dispatchUnit` 의 출동 준비 시간(`fieldCrew` 안에서 off 가 아닌 첫 사람 — 결장이 없으면 `u.crew[0]` 와 같다), `resources.arrive` 의 운용 중단 문구 판정, `unitArrived` 의 도착 기록 `causes`, 위 7 의 둘. **남은 것(단계 6·7)**: 화면 `panels.tsx` 의 대원 칩 `cchip ${r.status}`(off 클래스가 붙는다 — 스타일은 단계 6), 대원 정보창의 부상 칸 조건 `r.status !== 'ok'`(결장자에게도 참 — 단계 6 이 고친다), `view/triage.ts` 의 상태 글(off 는 빈 칸으로 떨어진다), H1 `roster` 의 off 대원 `out`(지금 `outShifts` 가 0 — 단계 7). R3 의 짝 맺기(`doctrine.ts` 주석의 "`u.crew.length === minCrew` 면 min 열" — 3단계 `pairUp`)는 예비 인력이 붙으면 길이가 늘고 결장자가 `u.crew` 에 남는다는 것을 알아야 한다.

**시험** (`tests/persistence.test.ts` 21 → 39개, 혼자 19초쯤 — 다른 묶음과 함께 도는 기계에서 교대 열둘의 짧은 연속이 기본 `hookTimeout` 10초를 넘어 `beforeAll` 마다 `HOOK_MS` 240초를 주었다): 2(결장 교대 수 = `outShifts` 표 — 다침 1·쓰러짐 3·병원 인계 2·후송 중 2 / 다음 교대에 off·지구력 100·현장에 내리지 않음(100틱마다)·crewReady −1·예비 인력 없음·`injured` 로 출근하는 사람 0 / 그다음 X 돌아옴(85)·Y −1 / 기록의 일대일·결원 도착·대원 피해 목록), 7(성장 0 < dExp ≤ 0.02 · 규모 5 → 1 → 5 · 공석 → replaceIn 1 → 신임 → 같은 rid 에 신임과 '배치' 줄 한 번 · 개인 장비 점검), 8 의 결원 부분(결장 없음 → 예비 인력 0 · 헬기 기장 자리 예비 인력 · 예비 인력 넷 → `short`(배정에서 빠지지 않음)·`empty` crew·pilot · 같은 입력 = 같은 해시(그대로·JSON) · 운용 중단 부대는 출동 0 · 출동 준비 시간 · 운용 중단 문구 · 결장 상한 · 섬광탄 다시 나누기), 6·10 의 대원 몫(계보 3 × 교대 4 — 예외 0·사건 모두 닫힘·왕복 지문·결장 ≤ 상한·요약 줄 하나, 적용 목록과 기록의 일대일·결장자 모두 기록에·결원 도착의 원인). 단계 1 의 시험 하나("교대 시작 문구")는 결장이 적용되므로 기대를 바꿨다(괄호의 수까지 보고, 결장·공석이 없는 상태면 지금 문구와 같다). **결과 해시를 숫자로 박은 시험은 없다**(이어받은 교대의 재현성은 같은 입력 두 번으로 본다).

**수치**

- 해시 목록 158교대(scratchpad `wf-persist/hashlist.ts` — 단계 1 과 같은 목록): 기준 `base632-hashes.txt`(`632d785` 를 `git archive` 로 풀어 잰 것) ↔ 변경 뒤 `after2-hashes.txt` — **158줄 모두 한 글자도 다르지 않다**(`report.hash` · `JSON.stringify(report)` 의 FNV · 기록 수 · 명부 지문).
- 진단(기준 아님 — `wf-persist/chain2.ts`, 계보 × 교대): 보통 4 × 6 — 교대마다 결장 0~0.5명·예비 인력 0~0.25·결원 도착 0~0.75건, 짧음·운용 중단·조기 복귀 0. 극한 3 × 5 — 결장 3~4명·공석 0.3~0.7·예비 인력 1.3~2.3·결원 도착 7~9건·신임 0.3~0.7, 짧음·운용 중단·조기 복귀 0, 예외 0.
- 성장(K1): 보통 6교대 1512명의 교대당 `xpGained` — 가운데 0.004 · 상위 10% 0.020 · 최대 0.060 · 0 인 비율 0.39(극한: 0.008 · 0.029 · 0.090). 가장 많이 큰 대원의 `dExp` 는 6교대 뒤 0.05(극한 5교대 0.06) — 열 교대면 0.08 쯤으로 본문의 목표("+0.15 안팎")보다 낮다. **단계 8 이 `GAIN_K` 를 올릴지 정한다**(§6.4 의 3번 손잡이의 반대 방향 — 지금 값은 본문의 처음 값 그대로).
- 관문 `npm run check` 통과(마지막 코드 커밋에서): 파일 19 · 642개 통과 + 건너뜀 1, vitest 432초 · 전체 7분 37초(다른 묶음과 함께 도는 기계). 첫 시도는 짧은 연속의 `beforeAll` 이 기본 `hookTimeout` 10초에 걸려 실패했다 — 예산(`HOOK_MS`)을 준 뒤 통과. `sweep 40 --check` 의 출력은 `632d785` 를 풀어 돌린 같은 명령과 줄마다 같다(교대당 시간 줄만 다르다 — 사용자 CPU 45.9초 / 변경 뒤 44.9초, `applyCrewCarry` 는 첫 줄에서 돌아간다).

**뒤 단계가 이어받을 자리**

- **단계 3**: `applyCrewCarry` 의 주석 자리(⑤)에 펌프 범위·정비(oos '정비 중', `u.readyAt`, `cs.svc`) — 예비 인력은 `u.readyAt !== undefined` 인 부대를 건너뛴다. 정비 뒤 운용 복귀는 `operable(sim, u)`. 창고 지급은 예비 인력 뒤에, 나온 사람에게만(위 5). `carryNoteText` 에 `service`·`rushed`·`stock` 의 `case`, 시험의 `mustSay` 에도. `checkCarryLog` 의 가용 부대 수는 `service` 를 이미 센다. 펌프 고장 수 `u.pumpFails` 는 executor 한 줄.
- **단계 7**: H1 `roster` 의 off 대원 `out` = `crewNext` 의 값, `CarrySummary.grown`(위 4 의 문턱).
- I1-b b1·b2 뒤: `carryNoteText` 의 기록에 `tag: 'carry'`(요약 줄 제외).

### 단계 3 — 장비 (이어받은 상태가 없을 때 결과 불변) · 준비 줄, `wf/persist-s3`

시작점 `d93234b`(= 단계 2 의 `3972968` 에 주 브랜치 `d58d456` 을 받은 것 — 받은 변경은 문서 셋뿐). 공용 파일은 `field/executor.ts` 한 줄만 고쳤다(§10.2 의 단계 3 줄 그대로).

**실제 이름** (뒤 단계가 쓴다)

| 파일 | 이름 |
|---|---|
| `src/sim/persist.ts` | 상수 `PUMP_REST` 0.12 · `SERVICE_PUMP` 0.7(정밀 정비 뒤의 펌프) · `SERVICE_AT` [300, 720](정비 시각) · `SERVICE_CAP` 2 · `RUSHED_PUMP` 0.6 · `RESUPPLY` 3. 안쪽: `applyUnitCarry`(적용 — 펌프 범위·정비·급히 정비 완료) · `issueFlashbangs`(적용 — 창고에서 지급) · `unitsNext`(끝 상태 → 부대 항목) · `stockNext`(끝 상태 → 창고) · `fbQuota(sim, u)`(정수 — createRoster 의 식) · `holdsFlashbang(r)` |
| `CarryState` | `fbStore` 를 더했다 — 교대 시작의 지급 뒤 창고에 남은 섬광탄(창고 기록이 없던 상태면 `STOCK_CAP − 지급`, 음수일 수 있다). `makeCarryover` 가 다음 창고를 센다 |
| `CarryNote 'service'` | `why: 'pump' \| 'vehicle'` 를 더했다(문구를 고른다). `readyAt` 은 짧은 교대면 자른 값 |
| `field/executor.ts` `spray` | 펌프 고장 자리(`u.pumpFailed = true` 다음 줄)에 `u.pumpFails = (u.pumpFails ?? 0) + 1` — 결과에 쓰지 않는다 |

**적용의 순서** (`applyCrewCarry` — 단계 2 의 ⑤·⑦ 자리): ⑤ `applyUnitCarry` — 편성표 순서로 항목이 있는 부대(지원 부대 제외)의 펌프를 `clamp(pump, pumpMin, pumpMax)`(소방 부서 — createRoster 가 펌프를 뽑는 조건과 같다), 정비 항목은 `readyAt` 이 이른 순(같으면 부대 순서)으로 `SERVICE_CAP` 대까지 `oos`·`oosWhy '정비 중'`·`u.readyAt = min(readyAt, shiftLen × 0.75)`·`cs.svc++`, 나머지는 '급히 정비 완료'(펌프 정비면 `clamp(RUSHED_PUMP, …)`, 바로 운용). 적용 목록은 편성표 순서. ⑥ 예비 인력(단계 2 — `u.readyAt` 이 있는 부대는 건너뛴다) ⑦ `issueFlashbangs` — 편성표 순서로 정수(`fbQuota`)가 있는 부대마다: 결장자 몫 0, 나온 사람 가운데 섬광탄 자리가 없으면 창고에서 꺼내지 않고 `u.flashbangs = 0`, 아니면 `got = min(정수, 창고)`(0 이면 비상 지급 1 — 창고에서 빼지 않는다), 모자라면 `fbShort`·적용 목록 `stock`. R1 의 나눔(`dealFlashbangs(나온 사람, 정수)`)을 한 뒤 모자란 만큼 **자리 순서의 뒤에서부터 1개씩** 뺀다(§7 R1 줄 — 섬광탄이 0 인 자리는 건너뛰고 돈다). 적용 목록의 순서: 신임·결장·공석 → 조기 복귀 → 정비·급히 정비 완료 → 예비 인력·모자람·운용 중단 → 재고 부족.

**교대 중** (`tickCarry`): `cs.svc > 0` 이면 부대 순서로 `u.readyAt ≤ sim.t` 인 부대의 `readyAt`·`svc` 를 거두고, `oos` 인 채면 `operable` 이 참일 때 `available`·`oosWhy undefined`·`stats.serviced++`·'`${호출부호} 정비 완료 — 운용 재개.`', 거짓이면 `oosWhy '결원'`·'`${호출부호} 정비를 마쳤지만 결원으로 운용하지 못합니다.`' — 둘 다 `role 'UNIT'`·`kind 'unit'`·원인 요약 줄. 복구 공사 쪽은 단계 4.

**끝 상태 → 다음 교대** (`makeCarryover` — 순수 그대로): 난수는 `sim.rng.fork('carry')` 하나를 만들어 `unitsNext` 에 넘긴다(편성표 순서로 정비 시각을 먼저 뽑는다 — **단계 4 의 복구 시각은 그 뒤에 같은 흐름에서 이어 뽑는다**). `unitsNext`: 편성표의 호출부호마다 많아야 한 항목 — 편성된 소방 부서 부대는 `pumpFails > 0 ‖ pumpFailed` 면 `{ pump: SERVICE_PUMP, service: { readyAt: round(range(300, 720)), why: 'pump' } }`, 아니면 `{ pump: round4(clamp(끝 값 + PUMP_REST, 0, 1)) }`. 편성되지 않은 부대는 앞 항목의 펌프에 휴식만(정비는 휴식에서 마친다 — 넣지 않는다). 그 밖의 부서·지원 부대는 넣지 않는다. `stockNext`: `{ flashbang: clamp(round(지급 뒤 창고 + 편성표 부대의 u.flashbangs 합 + RESUPPLY), 0, STOCK_CAP) }` — 이어받은 상태가 없던 교대의 "지급 뒤 창고"는 `STOCK_CAP − Σ 정수`(섬광탄 자리가 있는 부대만 — createRoster 가 실제로 나눈 것을 다시 센다).

**기록 문구** (`carryNoteText` 의 새 `case`): 정비 `${호출부호} 펌프 정비 중 — 약 ${round(readyAt/60)}분 뒤 운용.`(차량이면 '차량 정비 중', 1분 아래면 1) · 급히 정비 완료 `${호출부호} 정비가 밀려 급히 마쳤습니다 — 바로 운용합니다.` · 재고 `섬광탄 재고 부족 — ${호출부호} ${got}개만 지급 (정수 ${want}개).` 모두 부대 줄(`role 'UNIT'`·`actor` 호출부호·`kind 'unit'`·`imp 1`). 요약 줄의 '정비 중 n대'는 단계 1 의 것(`cs.svc`) 그대로.

**본문과 다르게 한 곳**

1. **정비 시각·정밀 정비·급히 정비 완료의 수를 상수로**(`SERVICE_AT`·`SERVICE_PUMP`·`RUSHED_PUMP` — 본문은 글자 그대로의 수). 정비 시각은 정수 초로 반올림한다(본문의 `round4` 대신 — 지문·문구가 깔끔하다).
2. **'급히 정비 완료'의 문구**: 본문 §3.7 에 없다 → `${호출부호} 정비가 밀려 급히 마쳤습니다 — 바로 운용합니다.` 급히 마친 펌프 0.6 도 **장비 손잡이의 범위로 자른다**(§11.2 "손잡이 = 범위"와 같게 — 극한(0.21~0.55)에서는 0.55). 펌프를 바꾸는 것은 `why 'pump'` 이고 소방 부서일 때만.
3. **펌프는 소방 부서 부대만**(createRoster 가 펌프를 뽑는 조건 `d.dept === 'fire'` — 진압·사다리·구조·화학). 다른 부대의 펌프 항목은 읽어도 적용하지 않고, `makeCarryover` 도 만들지 않는다. 구조 공작차·화학 구조차도 소방 부서라 펌프가 있고 고장 난다(지금 동작 그대로 — 극한에서 실제로 정비를 받는다).
4. **`CarryNote 'service'` 에 `why`** — 차량 정비(본문의 `'vehicle'` — 아직 만드는 곳이 없다)의 문구를 가른다.
5. **`CarryState.fbStore`**(새 칸): 지급 뒤 창고를 적어 두고 `makeCarryover` 가 읽는다. **창고 기록이 없는 이어받은 상태**(손으로 만든 입력 — `makeCarryover` 는 언제나 채운다)는 "이어받은 상태가 없으면 지금처럼"을 넓혀 정수를 그대로 주고 창고를 `STOCK_CAP` 에서 센다(기록 없음).
6. **들 사람이 없으면 창고에서 꺼내지 않는다**: 나온 사람 가운데 섬광탄 자리가 없는 부대(예: 기동대원 둘이 결장하고 예비 인력이 바닥나 조장만 나온 기동 순찰차, 운용 중단한 부대)는 0개, 창고 그대로, 기록 없음. 비상 지급도 들 사람이 있을 때만.
7. **단계 2 의 "결장자 섬광탄 다시 나누기"를 지급 자리로 옮겼다**: 예비 인력 반복문 안의 블록을 지우고 `issueFlashbangs` 하나가 모든 정수 부대를 나온 사람에게 나눈다. 창고가 넉넉하면 단계 2 와 같은 몫이다(시험 '결장한 기동대원의 섬광탄…' 그대로 통과). 줄일 때는 다시 나누지 않고 뒤에서부터 뺀다(보기: 특공1 정수 4 의 [팀장 2 · 진입(파괴) 1 · 진입 1] → 2개만이면 [2 · 0 · 0]).
8. **정비 중인 부대의 결원**: 예비 인력 반복문이 정비 중인 부대를 건너뛰므로 그 부대에는 교대 시작에 `short`·`empty` 항목이 없다 — 정비를 마칠 때 `operable` 로 보고 '결원' 줄을 남긴다(본문 `tickCarry` 그대로). 결장이 있어도 나온 대원이 있으면 최소 편성보다 적은 채 운용에 들어가고 그 사실을 따로 적지 않는다(본문 "need 까지 찼는지는 보지 않는다").
9. `tag: 'carry'` 는 아직 없다(I1-b b1·b2 의 `SimEvent.tag` — 단계 1·2 메모와 같다). 그래서 '정비 완료' 줄은 측정 도구에서 `kind 'unit'` 의 field 로 센다.

**시험** (`tests/persistence.test.ts` 39 → 51개, 혼자 30초쯤): 8 의 장비 부분 — 처음 상태(60초 교대 → 소방 부대마다 펌프 한 항목·정비 없음·창고 10) · 펌프 범위(장비 1 에 0.95 → 0.55, 0.1 → 0.21, 항목 없으면 뽑은 값, 순찰차는 1 그대로, 기록 없음) · 정비 120초(전에는 oos·출동 0, 120초에 '정비 완료' 한 줄·원인 요약 줄·available) · 500초 교대에 900 → 375초 · `SERVICE_CAP`(셋째는 급히 정비 완료·펌프 0.6·'(정비·결원 2대 제외)') · 정비를 마쳐도 결원(예비 인력 0·'결원' 줄·oos) · 끝 상태(고장 → 0.7 + 정비 시각 300~720 정수, 돌아오지 못한 고장도, 점검 +0.12, 1 에서 멈춤, 순찰차 없음, 두 번 불러 같음, JSON 왕복) · 편성되지 않은 부대의 휴식 · 섬광탄 창고 1(기동1 1·특공1 비상 1·`fbShort` 4·기록 두 줄 / 창고 10 이면 지금과 같은 몫 / 창고 0 이면 1·1) · 창고 10 → 7 → 4 → 특공1 이 2개 덜(뒤에서부터 뺀 몫 [2·0·0]) → 조용한 교대 뒤 7 이면 모자라지 않음 · 정비·재고 부족이 있는 교대의 재현성(그대로·JSON, 정비 완료 기록 두 줄). 10 의 장비 부분 `checkServiceLog`(정비마다 정비를 마친 기록이 readyAt 이 지난 첫 틱에 하나·원인 요약 줄·완료 수 = `serviced`·남은 정비 = `cs.svc`)를 짧은 연속의 모든 교대에 더했다. 6 에 **극한 계보 하나(교대 3)** — 고장 난 펌프 = 다음 상태의 정비 항목, 다음 교대의 정비 = min(2, 그 수)·급히 = 나머지, 기록의 일대일, 정비 완료가 실제로 있다. 단계 1 의 시험 '교대 시작 문구'는 P1 의 펌프 고장이 이제 정비로 적용되므로 '결장도 정비도 없는 상태'에서 정비도 지운다(한 줄). **결과 해시를 숫자로 박은 시험은 없다.**

**수치**

- 해시 목록 158교대(scratchpad `wf-persist/hashlist.ts` — 단계 1·2 와 같은 목록): 기준 `base-s3-hashes.txt`(`d93234b` 를 `git archive` 로 풀어 잰 것 — 단계 2 의 `after2-hashes.txt` 와 같다) ↔ 변경 뒤 `after3b-hashes.txt`(마지막 코드) — **158줄 모두 한 글자도 다르지 않다**(`report.hash` · `JSON.stringify(report)` 의 FNV · 기록 수 · 명부 지문). 강제 실행(`--force` 일곱 × 3 과 §8 의 셋 × 3)도 이 목록 안이라 한계 시간·방치 건수가 그대로다.
- 관문 `npm run check` 통과(마지막 코드 커밋 `4da853e`): 파일 19 · 654개 통과 + 건너뜀 1(앞 642 + 새 12), vitest 491초 · 전체 9분 14초(다른 묶음과 함께 도는 기계). `sweep 40 --check` 의 출력은 단계 2 관문의 출력과 줄마다 같다(교대당 시간 줄만 다르다 — 부하).
- 진단(기준 아님 — `wf-persist/chain3.ts`, 계보 × 교대): **보통 4 × 6** — 교대마다 펌프 고장 0.5~1.25대 → 다음 교대 정비 0.5~1대·급히 0~0.25대, 정비 완료 = 정비, 소방 부대의 처음 펌프 평균 0.68(교대 1) → 0.74~0.80, 창고는 늘 10·덜 지급 0, 한계 시간 종료 0~3.6%, 열린 사건 0, 예외·왕복 실패 0. **극한 3 × 5** — 펌프 고장 4.3대(교대 1) → 2.7대(교대 4·5), 정비 2대(상한)·급히 0.7~2.3대, 처음 펌프 평균 0.39 → 0.51~0.54, 창고 10(극한은 섬광탄 정수가 특공 2 뿐), 한계 시간 4~12.5%, 예외·왕복 실패 0.

**알려진 문제 (단계 8 의 균형으로)**

- **펌프의 휴식이 장비 손잡이를 위로 끈다**: 고장 나지 않은 펌프는 `끝 값 + 0.12`, 고장 난 펌프는 0.7 로 돌아와 손잡이의 범위로 잘리므로, 극한(0.21~0.55)에서는 이어받은 펌프가 대개 위 끝(0.55)에 붙는다 — 처음 교대의 평균 0.39 가 0.52 쯤으로 오르고 고장이 4.3 → 2.7대로 준다. 보통도 0.68 → 0.78. "이어갈수록 쉬워진다" 쪽이다(§6.3 의 3). 손잡이: `PUMP_REST`, 또는 "점검은 뽑은 값과 이어받은 값 가운데 낮은 것" 같은 규칙.
- **극한의 정비는 늘 상한에 닿는다**: 고장이 교대마다 3~5대라 다음 교대 첫머리 5~12분에 소방 부대 2대가 늘 정비 중이다(나머지는 급히 정비 완료). 손잡이 §6.4 의 4(`SERVICE_CAP`·정비 시각 범위).
- **섬광탄 정수의 합이 창고 상한보다 클 수 있다**: 장비 4·부대 규모 4 이상(기동 3 + 기동 3 + 특공 5 = 11), 장비 5·부대 규모 4 이상(4 + 4 + 6 = 14)이면 창고 10 으로는 정수를 다 줄 수 없어 이어 가는 모든 교대에 1·4개가 덜 간다 — §6.1 의 뜻("연속해서 많이 쓴 뒤에만 모자란다")과 다르다. 보통(6)·어려움·극한은 해당 없음. 손잡이: `STOCK_CAP`(예: 16) 또는 상한을 그 교대의 정수 합 이상으로.
- 화면(단계 6)은 `oosWhy`('정비 중' · '결원')를 아직 보이지 않는다 — 정비 중인 부대는 지금 '운용 불가' 글자로만 보인다. 보고서 줄(`정비를 마친 부대 n대` · `섬광탄 재고 부족으로 n개 덜 지급`)은 단계 7 이 `stats.serviced`·`stats.fbShort` 로 쓴다.

**뒤 단계가 이어받을 자리**

- **단계 4**: `makeCarryover` 의 `rng`(carry 흐름)는 `unitsNext` 가 정비 시각을 먼저 뽑은 뒤의 것을 받아 복구 시각을 이어 뽑는다(`unitsNext(sim, rng)` 다음에 `roadsNext(sim, rng)` — 순서를 바꾸면 정비 시각이 달라진다). `tickCarry` 의 복구 공사 쪽은 `if (cs.svc > 0) { … }` 블록 뒤에.
- **단계 7**: `CarrySummary.service` = 다음 상태의 `units` 가운데 `service` 가 있는 수, 보고서의 정비·재고 줄은 `stats.serviced`·`stats.fbShort`.
- I1-b b1·b2 뒤: '정비 완료'·'결원' 줄과 `carryNoteText` 의 기록에 `tag: 'carry'`.

### 단계 0·4 — 기준·도로 (이어받은 상태가 없을 때 결과 불변) · 덩어리 s04, `wf/persist-s04`

시작점 `19a7e68`(주 브랜치 `claude/practical-keller-xm0ac2` — R1·H1·X6·R2·R3·I1-b·R3b 전부, I2 단계 1~3). 받기(`git merge`)는 앞으로 감을 것이 없었다.

**단계 0 — 기준**: 해시 목록 158교대(scratchpad `wf-persist/s04-hashlist.ts` — 단계 1~3 의 `hashlist.ts` 그대로: §8 의 0단계 목록 28 + 보통 40 + 어려움 20 + 극한 20 + 재난 다섯 × 3 + 강제 일곱 × 3 + 부대 규모 1·2·4·5 × 3 + 500초 교대 2, 줄마다 `report.hash`·보고서 JSON 의 FNV·기록 수·명부 지문)를 `19a7e68` 을 `git archive` 로 풀어 다시 잼 — `s04-base-hashes.txt`. I1-b·R3b 가 결과를 바꿨으므로 앞 세션의 `base*-hashes.txt` 와는 다르다(쓰지 않는다). **단계 1~3 이 지금도 아무것도 하지 않는지**: 같은 사본에서 `engine.ts` 의 `applyCrewCarry`·`announceCarry`·`tickCarry` 세 줄을 지운 것(`s04-nohook/`)으로 잰 158줄이 기준과 한 글자도 다르지 않다(`s04-nohook-hashes.txt`).

**실제 이름** (뒤 단계가 쓴다)

| 파일 | 이름 |
|---|---|
| `src/sim/persist.ts` | 상수 `DIS_FULL` 2 · `LANE_SLOW` 0.6 · `FRONT_SLOW` 0.4(본문의 "건물 앞 0.4" — 이름이 없던 수) · `ROAD_AT`(복구 시각의 범위 — `carried` [120, 600] · `disFull` [240, 600] · `disLane` [300, 900] · `wet`(홍수·산불) [120, 420] · `mud` [300, 600] · `tree` [60, 240] · `surface` [300, 900] · `rubble` [300, 900]) · `WHY_NAME`(까닭 → 기록 문구) · 안쪽 `HELD_AT` 900(교대 내내 막는 공사의 openAt 자리값). 안쪽 함수: `applyRoadCarry(sim, cs, co)`(initCarry 가 부른다 — 적용) · `linkedHeavy(sim, a, b, skip)`(실제 상태의 큰 차 우회로 — traffic 의 `linked` 와 같은 뜻, initTraffic 앞이라 장애물이 없다) · `roadsNext(sim, rng)`(끝 상태 → 복구 공사) · `roadBeats`·`incName`·`DIS_WHY` |
| `CarryState` | `held: RoadCarry[]`(새 칸 — 교대 내내 막아 둔 left 2 의 사본, `makeCarryover` 가 left 1 로 넘긴다) · `slowed` 의 항목에 `why: 'lane' \| 'front'`(개통은 `lane` 만 되돌린다 — 한 구간에 둘이 있을 수 있다) |
| `CarryNote 'road'` | `why` 를 더했다(문구를 고른다). `openAt` 은 짧은 교대면 자른 값 |
| `src/sim/disaster.ts` | `DisasterState.damaged: number[]`(plan 의 리터럴 끝에 `damaged: []`), `closeEdge` 가 통제에 성공한 자리(`d.closedEdges.push` 다음 줄)에서 한 번씩 |
| `src/sim/types.ts` | `WorldTag` 끝에 `\| 'carry'` (단계 1 의 남은 몫 — I1-b 가 합쳐져 칸이 생겼다) |
| `src/view/city/trafficLayer.ts` | `drawObstacleMark(ctx, kind, x, y, r, known = true, ring?)` · `REPAIR_RING`('#ffb454' — `DISASTER_RING` 과 같은 색) |

**적용의 순서** (`initCarry` → `applyRoadCarry` — initTraffic 앞): 이어받은 `roads` 를 openAt(짧은 교대면 `min(openAt, shiftLen × 0.75)`) 순, 같으면 구간 id 순으로 — 전면은 `e.closed` 가 아니고 `linkedHeavy` 가 참일 때만 `closed = true`·`closedReason = 'repair'`(`known` 은 그대로 — 알려진 통제), 아니면 `dropped` 에 '`<구간>`: 통제하면 길이 끊겨 복구 공사를 미룹니다.' 하고 그 항목은 없는 것으로(다음 상태에도 없다). 한 차로는 `slow += LANE_SLOW`. 놓은 것마다 적용 목록 `road`, left 1 은 `cs.roads`(tickCarry 가 연다), left 2 는 `cs.held`. 그다음 `co.places` 의 출입 통제·무너짐 건물의 `edgeId` 마다 한 번 `slow += FRONT_SLOW`(교대 내내). **교통의 장부**는 교통 모델이 생긴 뒤 `announceCarry` 가 적는다: 도로 줄을 남긴 그 자리에서 `noteRoadCause(sim, edge, lane ? 'slow' : 'close', 그 줄의 id)`, 건물 앞 감속(한 차로 공사가 없는 구간)은 요약 줄 id. 적용 목록의 차례: 도로(①) → 대원·부대·재고(②) — 기록도 이 차례다(원칙 5 "바꾼 순서대로").

**교대 중** (`tickCarry` — 정비 블록 다음): `cs.roads[0].openAt ≤ sim.t` 인 동안 꺼내 — 한 차로는 `slowed` 의 `lane` 항목을 찾아 그 값만큼 되돌리고 '`<구간>` 한 차로 복구 공사 완료.'(imp 0), 전면은 아직 `closedReason === 'repair'` 로 닫혀 있을 때만 열고 `stats.reopened++`·'`<구간>` 복구 공사 완료 — 통행 재개.'(imp 1). 모두 `role 'SYSTEM'`·`actor '교통정보'`·`kind 'traffic'`·원인 요약 줄·`tag 'carry'`.

**끝 상태 → 다음 교대** (`roadsNext` — `makeCarryover` 안, 순수. carry 흐름은 `unitsNext` 가 정비 시각을 뽑은 **뒤**에 이어 뽑는다): ① `cs.held` → left 1·`ROAD_AT.carried` ② `d.damaged`(통제한 순서): 지진·해일은 앞 `DIS_FULL` 구간이 전면(`disFull`), 나머지 한 차로(`disLane`) / 홍수·산불은 한 차로(`wet`) / 태풍은 없음 ③ 사건 순서로 `I.blockedEdge ≥ 0` 인 것: (가) `placeMarks` 의 그 건물이 `collapsed` 이고 **`incidentId === I.id`** → `debris` 전면 left 2(openAt `HELD_AT`) · `landslide`/`tree` 이고 `closeReason !== 'resolved'` → `mud`/`tree` 전면 · `pileup` → `surface` 한 차로 ④ `traffic.obstacles` 의 `kind 'rubble'`(교대 끝까지 남은 것 — (나)) → `debris`(전면이면 전면) left 1. 같은 구간이면 `roadBeats`(남은 교대 → 전면 → 늦게 끝나는 것 — (가)와 (나)가 겹치면 (가)). 넘으면 `ROAD_CAP` 까지 남은 교대·전면·이른 openAt 순으로 남기고, 구간 id 순으로 돌려준다. 시각은 정수 초(단계 3 의 정비 시각과 같게). `inc` 는 `조직 n번째 교대 · <사건 코드> 산사태`·`… 쓰러진 나무`·`… 다중 추돌`·`… 건물 붕괴`·`… <코드> 건물 잔해`(잔해는 놓은 기록의 원인에서 사건을 찾는다 — `traffic.obstacleInc` 와 같은 길)·재난은 `조직 n번째 교대 · <재난 이름>`.

**본문과 다르게 한 곳**

1. **`traffic.addObstacle` 을 쓰지 않았다** (덩어리 지시의 "반드시 `traffic.addObstacle`·`closedReason 'repair'`"): `addObstacle`(안쪽 `place`)은 `closedReason` 을 장애물 종류로 `'roadwork'`·`'obstacle'` 로 덮어쓰고, 장애물에는 치워지는 시각(`until`)과 "하나 남은 길이면 교통 모델이 치운다" 규칙이 붙으며, `sim.traffic` 이 있어야 해서 본문 §3.4 의 자리(initTraffic 앞 — 불법 주차가 그 통제를 보고 놓인다)에서 부를 수 없다. `traffic.ts` 는 이 묶음이 맨 위 주석 한 낱말 말고는 고치지 않는다(§10.2). 그래서 본문 §3.5 그대로 `persist.ts` 의 `linkedHeavy` 로 같은 뜻의 우회로 검사(그 구간과 이미 닫힌 구간을 빼고 큰 차가 양 끝을 오가는가)를 하고 `closedReason 'repair'`·`known` 그대로 둔다(CLAUDE.md "다른 시스템이 길을 닫을 때는 closedReason 을 … 두고 known 은 건드리지 않는다"). 그 뒤의 통제(사건·재난·장애물)는 모두 닫힌 구간을 막힌 것으로 보고 우회로를 확인한다(본문 §3.5 끝).
2. **교통의 장부의 주인 = 그 도로 줄**(I1 최종 요약의 "원인 기록 = 요약 기록"과 한 단계 다르다 — 그 줄의 원인이 요약 줄이라 사슬은 이어진다. 통제를 바꾼 기록이 주인이라는 재난 `closeEdge` 와 같은 꼴). 장부를 빠뜨리면 L1(몰린 길의 사고)이 그 우회로의 초과를 원인 없는 몫으로 보고 사건을 만들지 않는다(`hz.holes`).
3. **한 차로 줄에도 까닭과 시각**: `<구간> 한 차로 복구 공사 — <까닭> · 서행 (약 n분 뒤 완료 | 이번 교대 내내).`(본문은 `… 한 차로 복구 공사 — 서행.` — §11.1-8 "다음 교대의 줄에 원인을 넣는다"에 맞췄다). 전면 줄은 본문 그대로.
4. **(가)에 `incidentId === I.id`**: 그 사건이 그 건물을 무너뜨렸을 때만(I1-b C2 `rubbleRoad` 의 (가)와 같은 조건 — 앞 사건이 남긴 상태로 뒤 사건이 또 넘기지 않게).
5. **교대 내내 막는 공사(left 2)의 `openAt` 은 자리값 900**(`readCarryover` 의 범위 [60, 900] 안 — 쓰지 않는다. 다음 휴식에서 left 1 이 되며 `ROAD_AT.carried` 로 새로 뽑는다).
6. **사건의 이름은 시나리오 표를 읽지 않고 줄마다 정한 낱말**(`산사태`·`쓰러진 나무`·`다중 추돌`·`건물 붕괴`·`건물 잔해`) — `scenarios.ts` 를 import 하면 그 파일이 끌어오는 모듈의 순환이 persist 에 생긴다(§10.1 의 import 목록 밖).
7. **출입 통제 건물 앞 감속을 단계 4 에 넣었다**(§8 단계 4 줄): `sim.carry.places`(readCarryover 가 검사한 것)를 읽는다. 그 기록은 건물의 줄(단계 5 의 `place` 항목 — "복구 공사 중이라 출입을 통제합니다")이 맡는다 — 단계 4 의 `makeCarryover` 는 `places` 를 비워 두므로 자연히 생긴 상태에서는 아직 일어나지 않고, 손으로 만든 상태(시험)에서만 기록 없이 느려진다. 그 장부의 주인은 지금 요약 줄이다(단계 5 가 건물 줄로 바꿀 수 있다).
8. **`tag: 'carry'` 를 단계 2·3 의 기록에도 달았다**(요약 줄을 뺀 이어받은 상태의 모든 기록 — 결장·공석·신임·조기 복귀·예비 인력·모자람·운용 중단·정비·급히·재고·버린 것·정비 완료·결원 — 와 단계 4 의 도로·개통). 단계 1~3 메모의 "이어받을 자리(I1-b b1·b2 뒤)"였다. 해시에는 들지 않는다(events.ts — 틱과 문구만). 측정 도구의 `sysOf` 가 이 기록들을 `carry` 로 센다(전에는 결장·정비 줄이 `field`, 도로 줄이 `road`).
9. `roadsNext` 의 상한은 넘을 때만 "남은 교대 → 전면 → 이른 openAt → 구간 id" 순으로 남긴다(본문 그대로). `readCarryover` 의 상한(남은 교대 → 구간 id)은 손으로 만든 입력만 받는다 — `makeCarryover` 의 결과는 이미 6 이하다.

**시험** (`tests/persistence.test.ts` 51 → 65개, 혼자 48초쯤): 4 — 준비(고른 구간 넷·막다른 구간·한 교차로) · 전면 E 는 교대 시작부터 `repair`(known 그대로)·적용 목록·요약 줄의 '복구 공사 도로 2구간'·교통의 장부(닫힘·감속의 주인 = 그 줄)·1틱의 작은 차·큰 차 경로가 E 를 피함·61초에 열리고 같은 openAt 의 한 차로 F 도 끝남(기록 하나씩, `reopened` 1) · left 2 는 500초 교대 내내 `repair`·같은 상태의 openAt 900 은 375초에 열림·다음 상태에서 left 1(120~600 정수)·몇 번 불러도 같음·JSON 왕복 · 막다른 구간은 닫히지 않고 버린 것 한 줄·다음 상태에 없음 · 한 교차로의 구간을 모두 넣으면 마지막 것을 놓지 않음·0틱·1틱에 모든 시설 → 모든 교차로(알려진 상태, 작은 차·큰 차) · 건물 앞 감속(같은 구간 한 번·흔적만 남은 건물은 아님·교대 내내) · 복구 공사가 있는 교대의 재현성(그대로·JSON — 없는 교대와 다름). 원천 표 — 산사태·쓰러진 나무(다 치우지 못했을 때만)·다중 추돌(끝난 이유와 상관없이)·시각 범위·이름 / (가)·(나)·같은 구간이면 (가)·무너뜨린 사건이 아니면 넘기지 않음 / 같은 구간 하나·상한 6(전면 먼저)·구간 id 순 / 평범한 교대는 빈 목록·순수. 11 — 지진 Q2 의 `d.damaged`(한 번씩·`closedEdges` 는 비었다)·crack ≥ 1·≤ 상한·전면 crack ≤ `DIS_FULL`(통제한 순서로 앞의 것)·이름·시각 범위 / 다음 교대 1틱에 `repair`·느려짐, 0틱·1틱 연결 / 끝까지 — 사건 모두 닫힘·개통 기록 일대일·교대 내내 막은 것만 다음 상태로. 6·10 — 짧은 연속(계보 3 × 교대 4)의 복구 도로 ≤ 6·0틱 연결·`checkRoadLog`(도로 줄마다 그 구간 이름·`tag 'carry'`, 개통 기록이 openAt 이 지난 첫 틱에 하나·요약 줄이 원인·`reopened`·남은 `cs.roads`). `mustSay` 에 `road`. **결과 해시를 숫자로 박은 시험은 없다.**

**수치**

- 해시 목록 158교대: 기준 `s04-base-hashes.txt`(`19a7e68`) ↔ 변경 뒤 `s04-after4a-hashes.txt`(커밋 `9d856fc` 의 코드) — **158줄 모두 한 글자도 다르지 않다**(강제 실행 일곱 × 3 과 §8 의 셋 × 3, 지진 Q0~Q2 — `d.damaged` 를 기록하는 교대 — 도 이 목록 안이라 한계 시간·방치 건수가 그대로다).
- 진단(기준 아님 — `wf-persist/s04-chain.ts`, 계보 6 × 교대 4, 보통): **첫 교대에만 지진** — 교대 2: 전면 복구 공사 33(계보당 5.5 — 그 가운데 교대 내내 막는 (가) 잔해 25)·한 차로 2·개통 10 / 교대 3: 전면 26(교대 2 의 (가)가 left 1 로)·한 차로 2·개통 28 / 교대 4: 0. 끊겨서 미룬 통제 0, 0틱에 닿지 못하는 (시설, 교차로) 0, 열린 사건 0, 장부의 구멍(`hz.holes`) 0, 한계 시간 종료 6.3%(교대 1 — 지진) → 0.0% → 1.0% → 1.1%. **지진 없는 보통** — 교대 2: 전면 5(모두 (가) — 그 교대의 전체 붕괴)·교대 3: 전면 5·한 차로 2·개통 7, 한계 시간 0~1.2%, 끊김·구멍·열린 사건 0. 지진 뒤 이어받은 복구 공사로 시작한 교대 6개를 100틱마다(`s04-reach.ts` — 414번) 알려진 상태로 모든 시설 → 모든 교차로를 보았다: 닿지 못한 쌍 0(그 교대들의 `repair` 통제 최대 6구간). 지진 Q0~Q2·해일·홍수·산불 × 3 의 단발(`s04-smoke.ts`): 이어받은 구간 3~6(태풍 0), 다음 교대 0틱 연결 0 끊김, 개통 = 끝나는 공사 수.
- 화면(5232, Playwright — 개발 서버의 모듈을 페이지에서 불러 새 캔버스에 `drawCity`): 전면 `repair` 구간의 붉은 통제 점선 가운데에 주황 테의 공사 고깔, 한 차로 공사는 혼잡 띠, 콘솔 오류 0 (`wf-persist/s04-repair-0.png`·`s04-repair-1.png`·`s04-repair-1-crop.png`). 기록: '내부순환로 6구간 복구 공사로 통제 — 지진으로 갈라진 노면 (약 7분 뒤 개통).'·'강변길 2길 1구간 한 차로 복구 공사 — 침수 뒤 진흙·쓰레기 치우기 · 서행 (약 5분 뒤 완료).'
- 관문 `npm run check` 통과(코드 커밋 `9d856fc`): 파일 20 · 1046개 통과 + 건너뜀 1(persistence 51 → 65), vitest 642초 · 전체 11분 17초(다른 묶음과 함께 도는 기계). `sweep 40 --check` 의 분포(보통 590건 · 성공 70% · close reasons resolved 588 · timeout 1 · abandoned 1 · 교착 후보 0 · 잊힌 사건 0 · C1~C5 0 · holes 0)는 이어받은 상태가 없는 교대라 해시 목록과 같이 그대로다 — 측정 도구의 `systems … carry 0%` 도 그대로(이어받은 상태가 없으면 tag 'carry' 기록이 없다).

**알려진 문제 (단계 8 의 균형으로)**

- **지진 뒤에는 (가) 잔해가 복구 도로의 상한을 거의 다 채운다**: 지진 교대 하나에 건물 전체 붕괴가 4~6채 나서(X6 — 붕괴마다 사건 교차로의 한 구간을 막는다) 다음 교대에 전면 통제 5~6구간이 교대 내내, 그다음 교대에 다시 한 번(left 1) 남는다. 균열(`crack`) 줄은 상한에서 밀려 한두 구간만 넘어온다(시험 11 은 균열이 남는 시드 Q2 를 쓴다). 6계보에서 한계 시간 종료는 오르지 않았지만(교대 2 0.0%) §11.1-14 의 걱정 그대로다 — 손잡이 §6.4 의 4(`left` · (가)를 left 1 로 · 재난별 상한).
- **측정 도구의 표본 줄 `closedReason === 'repair'`**(`scripts/metrics.ts` — "I 로 가는 부대의 남은 경로에 복구 공사 구간") 은 거의 잡지 못한다: 전면 공사는 알려진 통제라 경로에 들지 않고, 한 차로 공사는 `closedReason` 을 쓰지 않는다(본문 §3.5 — 닫히지 않은 구간). 단계 8 이 `carryState.slowed`(`why 'lane'`)를 보게 고칠지 정한다.
- 한 차로 공사(0.6)와 다른 감속이 겹쳐 `slow ≥ 1` 이 되면 교통 모델이 그 구간을 밀림의 뿌리로 본다 — 건물 앞(0.4)과 겹치면 장부의 주인이 있지만(위 2·7), 홍수의 차오르는 물(0.8 — `'level'` 장부)과 겹치면 `slowEv` 가 비어 구멍이 될 수 있다(드물다 — 진단에서 0).

**뒤 단계가 이어받을 자리**

- **단계 5**: `initCarry` 에서 `cs.places` 를 채우고 건물 `place` 항목과 그 문구(`carryNoteText` 의 `case 'place'`)를 더한다 — 건물 앞 감속(`applyRoadCarry` 끝의 블록)은 그 항목이 기록을 맡고, 장부의 주인을 그 줄로 바꿀 수 있다. 적용 목록의 차례(도로 → 건물 또는 건물 → 도로)는 단계 5 가 정한다(시험 `checkCarryLog` 는 목록 순서 그대로 본다).
- **단계 6**: 마우스 정보 '복구 공사 — 약 n분 뒤 개통'은 `cs.roads`(openAt)·`cs.held`(교대 내내)로, 범례 "복구 공사 도로"는 `drawObstacleMark(ctx, 'roadwork', x, y, r, true, REPAIR_RING)`.
- **단계 7**: 보고서 '복구 공사가 끝난 도로 n구간이 교대 중에 열렸습니다.' = `stats.reopened`(전면만 — 한 차로 완료는 세지 않는다), `CarrySummary.roads` = 다음 상태의 `roads.length`.
- **단계 8**: `chain.ts --disaster quake@1` 의 교대 2 복구 도로 평균은 위 진단으로 5.8(기준 ≥ 1). 위 알려진 문제 셋.

### 단계 5 — 건물 (이어받은 상태가 없을 때 결과 불변) · 덩어리 s5, `wf/persist-s5`

시작점 `016c61c`(`wf/persist` — 단계 0·4 끝). 주 브랜치(`claude/practical-keller-xm0ac2`) 받기는 앞으로 감을 것이 없었다. 코드 커밋 `a809418`.

**실제 이름** (뒤 단계가 쓴다)

| 파일 | 이름 |
|---|---|
| `src/sim/placeUse.ts` (새 잎 모듈 — type 만 import) | `placeCond(sim, id)`(겹침 표의 항목 — 이어받은 상태가 없으면 `null`) · `placeUsable(sim, id, allowClosed = false, inShift = true)`(본문 §3.6 의 식 그대로) · `preBurnt(s)`·`setPreBurnt(s, mask)`(처음부터 탄 칸 — 현장 → `Uint8Array` 의 `WeakMap`). `persist.ts` 가 `placeCond`·`placeUsable` 을 다시 export 한다 |
| `src/sim/persist.ts` | 상수 `PLACE_LINES` 4(교대 시작에 건물마다 한 줄로 알리는 수 — 그 뒤는 '외 n곳') · `PRE_BURN` 0.35. export `placeOutcome(sim, I)`(끝 상태의 표 — 진실을 읽는 유일한 곳) · `applyPlaceWear(sim, s, I)` · `noteWearIncident(sim, I)`. 안쪽: `applyPlaceCarry(cs, co)`(initCarry — 겹침 표·적용 목록 'place') · `placesNext(sim)`(makeCarryover — 새 피해 · 휴식 · 상한) · `heavier(a, b, since)`(여러 행·같은 건물 합치기) · `rubbleOf(s)`(잔해의 몫과 무너진 자리 — G4 `ruinInfo` 와 같은 식) · `copyPlace` · `placeLabel` · `placeLine` |
| `src/sim/incidents.ts` | `placeGone(sim, id)` = `!placeUsable(sim, id)`(X6 의 시험이 쓰는 이름으로만 남겼다 — 시뮬레이션의 자리는 `placeUsable` 을 직접 부른다) · `pickPlace` 의 `weigh(q, strict, allowClosed)` |

**여섯 자리와 placeGone 의 자리** (모두 `placeUsable` 한 번 — 이어받은 상태가 없으면 X6 의 조건 그대로):

| 자리 | 부름 |
|---|---|
| 장소 추첨 `incidents.pickPlace` | 엄격·대안 `placeUsable(sim, q.id, false)`, 둘 다 비면(이어받은 상태가 있을 때만) 셋째 단계 `placeUsable(sim, q.id, true)` — 출입 통제는 되고 무너짐은 끝까지 안 된다. 흔적(`marked`, `dmg > 0`)의 가중치: 붕괴 `× (1 + 3 × dmg)` · 가스 누출 `× (1 + dmg)` — `carryState.on` 일 때만 곱한다 |
| 정해 준 건물 `createIncident` 의 `fixedPlace` | `placeUsable(sim, opts.placeId)`(마지막 안전장치) |
| 재난 `disaster.pickPlace` | `placeUsable(sim, q.id, false, false)` |
| 연쇄 방화 `scenarios/crime.ts` `arsonNext` 의 `pool` 두 줄 | `placeUsable(sim, q.id, false, false)` |
| 은신처 `pursuit.ts` 의 `cands` | `placeUsable(sim, q.id)` |
| 현장 `sceneManager.createScene` | `applyPlaceWear(sim, s, I)` — `applyExpo` 바로 다음 |
| (넷째 자리) 법칙 사건을 꺼낼 때 `tickIncidents` | `!placeUsable(sim, c.opts.placeId)` |
| (다섯째 — 본문에 없던 자리) 재범의 자리 `field/hazards.ts` `reoffendPlace`(I1-b C10) | `!placeUsable(sim, q.id)` |
| I1-b `world/state.ts` `placeState` | `usable: placeUsable(sim, placeId)`(세 갈래 모두) — 세계 규칙·법칙의 `placeState(…)?.usable === false` 가 이어받은 출입 통제·무너짐도 본다 |

**이어받은 손상과 이번 교대의 충격이 한 건물에 겹칠 때의 차례** (머리 알림 ①): `createScene` 은 `buildScene` → I1-b `applyExpo`(그 건물의 `world.expo[p].shake > 0` 이면 `s.wear = { dmg: shake, soot: 0, cause: 'shock', inc: 흔든 사건의 코드, pre: 0 }`, 끊긴 배관이면 새는 밸브) → **`applyPlaceWear`** → `initInjuries`. `applyPlaceWear` 는 `s.wear` 가 없으면 이어받은 값으로 만들고, 있으면 **합친다**: `dmg` 는 큰 쪽이고 원인(`cause`)·사건 이름(`inc`)도 큰 쪽의 것(같으면 먼저 있던 충격 그대로 — 덮어쓰지 않는다), 그을음은 이어받은 값(충격은 0). 그다음 처음부터 탄 칸을 놓는다(`pre`). 그래서 측정 도구의 `S(I)`(`wear.cause === 'shock'` → building, 그 밖 → carry)와 I1-b 보고서의 '이 건물은 사건 n의 충격으로 이미 금이 가 있었습니다' 줄(`world/report.ts` — `cause 'shock'` 일 때만)은 **손상이 더 큰 쪽**을 따른다. X6 의 `catOf` 는 합친 `dmg` 로 처음 건전도를 깎는다(`CAT.WEAR_INTEG` 그대로). 손상 사실의 기록(`noteWearIncident`)은 `s.wear` 가 아니라 겹침 표의 항목으로 만든다 — 충격이 더 커도 이어받은 손상의 기록은 남는다.

**적용의 차례** (`initCarry`): 건물(`applyPlaceCarry` — `cs.places` 에 `sim.carry.places` 의 사본, 적용 목록에 출입 통제·무너짐을 남은 교대가 큰 순(같으면 id 순), 그다음 통제가 풀린 건물(`opened`)을 id 순) → 도로(`applyRoadCarry` — 건물 앞 감속 포함) → (②) 대원·부대·재고. 기록도 이 차례다(원칙 5). 건물 줄은 출입 통제·무너짐과 통제가 풀린 건물을 따로 **앞의 `PLACE_LINES`(4) 곳만 한 곳에 한 줄**, 다섯째부터는 '외 n곳' 한 줄로 묶는다(시험 10 의 "'외 n곳' 줄은 n 으로 센다" — 시험 도구 `noteEvents` 가 항목 → 기록 id 를 만든다). **건물 앞 감속의 장부 주인**은 그 건물의 줄(묶였으면 '외 n곳' 줄 — 한 차로 공사가 함께 있는 구간은 그 공사 줄 그대로, 단계 4).

**끝 상태 → 다음 교대** (`placesNext` — `makeCarryover` 안, 순수 · 난수 없음): 사건마다 `placeOutcome` → 같은 건물의 여러 사건은 `heavier` → 앞 상태와 합치기 · 휴식 → 상한 → id 순.

**본문과 다르게 한 곳**

1. **`placeCond`·`placeUsable` 은 새 잎 모듈 `src/sim/placeUse.ts` 에** 둔다(`persist.ts` 가 다시 export). 연쇄 방화의 `arsonNext` 는 시나리오 묶음 파일(`scenarios/crime.ts`)에 있는데, `persist.ts` 는 `resources` → `dispatch/dispatcher` → `callSystem` 을 끌어온다 — 시나리오 파일이 그것을 import 하면 `scenarios.ts` 가 끝나기 전에 `callSystem` 의 맨 위(`for (const sc of SCENARIOS)`)가 돌 수 있다(CLAUDE.md "시나리오 표는 추격전을 import 하지 않는다"와 같은 꼴). 그래서 판정 함수만 type 만 import 하는 파일로 뺐다. `catastrophe.catOf` 가 부르는 `preBurnt` 도 같은 파일(field 의 모듈 맨 위가 `CAT` 를 읽는 순환을 피한다).
2. **placeGone 의 자리는 다섯**이었다 — 본문·머리 알림의 넷(장소 추첨·정해 준 건물·은신처·법칙 사건)에 I1-b C10 의 재범의 자리(`hazards.reoffendPlace`)가 더 있다. 같은 `placeUsable(sim, q.id)`(inShift true)로 바꿨다 — 재범은 건물을 예약할 때 고르므로(그 건물 곁의 경찰을 보는 `when`) 고를 때 걸러야 되고르기와 어긋나지 않는다.
3. **X6 의 전소 분모가 이미 탄 칸을 센다**(`catOf` 의 `fuelMask` = `foot ≥ 1 && (fuel > 0 || burned)` — "이미 탄 칸도 연료가 있던 칸이다"). 그래서 §10.2 의 "분자에서 `s.wear.pre` 칸을 뺀다" 대신 **처음부터 탄 칸을 `fuelMask` 에서 뺀다**(`preBurnt(s)` 의 칸 — 분모·분자에서 함께 빠진다, `burnFracOf` 는 `fuelMask` 안의 탄 칸만 센다). 이어받은 상태가 없으면 `pre` 가 없어 식이 그대로다.
4. **붕괴 유형의 잔해 줄을 X6 가 표시한 건물에도 쓴다**(본문은 "X6 가 표시하지 않은 건물에만"). X6 의 `ruinFrac` 은 사건 중에 새로 무너진 칸(`damage0` 에 없던 칸)만 세어, 붕괴 현장에 처음부터 깔린 잔해를 보지 않는다 — 본문대로면 잔해가 0.22 넘게 깔린 붕괴 현장이 사건 중에 구획 하나가 더 무너져 `partial` 표시를 받으면 무너짐 4 가 아니라 통제 2 가 된다(더 무너졌는데 더 가볍다). 폭발(가스 폭발 대형 사고·터진 소품·불붙은 배관)·불붙은 소품·화재의 흔적(0.05~0.25) 줄은 본문대로 X6 가 표시하지 않은 건물에만.
5. **'천장 일부 붕괴' 줄은 없다** — X6 단계 3 이 그 덩어리를 지웠다(`hazards.ts` 의 주석). 2차 붕괴는 `ESCALATION` 의 detail 끝말 `2차 붕괴` 그대로(`hazards.tickCollapse`).
6. **`inc` 의 사건 이름은 `util.TYPE_NAME`**(`조직 3번째 교대 · 04 건물 화재`) — 본문의 `scenarioName` 은 `scenarios.ts` 를 import 해야 한다(위 1 의 순환, 단계 4 의 6 과 같다).
7. **여러 행·같은 건물을 합칠 때 원인·사건 이름·X6 상태(`mark`)·무너진 자리(`spot`)는 무거운 상태 쪽**(같으면 뒤 줄 — 새 피해). 흔적만 남고 손상·그을음이 둘 다 0.05 아래면 넣지 않는다(`placeOutcome` 이 `null`). `mark` 는 그 건물의 X6 상태가 **그 사건의 것**일 때만 붙인다.
8. **휴식**: 출입 통제가 풀릴 때(`repair` 0 — 휴식이든 `CLOSED_CAP` 이든) `mark`·`spot` 을 지운다(복구됐다 — 지도가 전소·무너짐 그림을 그리지 않게). `opened` 는 한 번만(다음 휴식에서 지운다). 방금 풀린 항목은 그 휴식에서 흔적의 감쇠(−0.25·−0.15)를 받지 않는다.
9. **상한의 순서**(본문은 "repair 가 작은 것부터 '복구 완료'"만): `CLOSED_CAP` 을 넘으면 남은 교대가 작은 것, 같으면 **id 가 큰 것**부터 복구 완료(흔적으로 — 위 8 과 같은 식) / `PLACE_CAP` 을 넘으면 흔적 가운데 **손상 + 그을음이 작은 것**(같으면 id 가 큰 것)부터 버린다. 만든 상태는 `readCarryover` 의 상한(남은 교대 → id)에 다시 걸리지 않는다(시험).
10. **문구**(본문 §3.7 의 7 에 맞추고 이름·묶음을 정했다): `${주소} ${이름} — ${inc}로 복구 공사 중이라 출입을 통제합니다 (n교대 남음).` · `… 무너져 출입할 수 없습니다 (n교대 남음).` · `${주소} ${이름} 복구 완료 — 다시 문을 열었습니다.` · `외 n곳도 지난 교대의 피해로 출입을 통제합니다 (무너짐 k곳).` · `외 n곳도 복구를 마치고 다시 문을 열었습니다.` — `role 'SYSTEM'`·`actor '상황실'`·`kind 'shift'`·`imp` 1(풀린 건물 0)·원인 요약 줄·`tag 'carry'`. 손상 사실: `이 건물은 ${inc}로 [그을리고 ]손상된 상태였습니다 (구조 손상 n%).` / 열린 터는 그을음 0.2 이상일 때만 `이 터에는 ${inc}로 탄 자리가 남아 있습니다.`(손상 줄은 없다 — 열린 터의 손상은 0).
11. **처음부터 탄 칸의 수** = `min(후보 수, round(PRE_BURN × 그을음 × 실내 연료 칸 수))` — "개수"는 불 곁을 빼기 전의 실내 연료 칸 수로 읽었다(그을음에 비례한 건물의 몫). 후보는 실내 구역(`s.regions[s.region[i]].indoor`)의 `fuel > 0` 칸에서 불 칸과 그 이웃 8칸을 뺀 것, `hashStr(I.id + ':' + i)` 의 오름차순(같으면 칸 번호 순).
12. **교대 끝의 `world.expo`(이웃의 충격·끊긴 배관·잠긴 지하)는 이어받지 않는다**(머리 알림 ④의 결정). 본문 §3.6 의 표에 없는 원천이고 `PlaceCarry.cause` 에 충격이 없으며(열거값을 넓히면 판의 뜻이 바뀐다), 머리말이 "세계 상태의 교대 간 지속"을 ROADMAP 의 새 항목으로 미뤘다. 잰 크기(아래 수치): 보통 교대 0~3채, 지진 교대 5~15채 — 넣는다면 `marked`(`dmg = shake`)로 `PLACE_CAP` 안에 들어가는 크기다.
13. **`placeState` 의 이어받은 항목 `ruinFrac`** 을 I1-b 의 자리값 `pc.dmg` 에서 본문 §3.6 의 `pc.state === 'ruin' ? 1 : 0` 으로 바꿨다(읽는 곳 없음 — `usable` 만 쓰인다). `knownBuildingAt` 은 고치지 않았다(이미 겹침 표를 `inc` −1 로 돌려준다 — 부르는 판단 코드가 아직 없다).
14. **격리 시험(9)에 `placeCond`·`preBurnt` 를 더했다** — 관제·지휘 코드에 겹침 표를 읽는 함수 이름도 없다.

**시험** (`tests/persistence.test.ts` 65 → 81개): 3 — `placeUsable`(교대 안 X6 는 inShift 일 때만 · 흔적은 쓰고 · 통제는 allowClosed · 무너짐은 끝까지 · 이어받은 상태가 없으면 X6 만) · ① 장소 추첨(이어받은 상태가 없는 P4 에서 사건이 났던 건물 10곳을 무너짐으로 → 그 교대에 그 건물들에서 사건 0) · ② 정해 준 건물(다른 건물에서) · ③ 은신처(K1·K3·K4·K9 에서 고른 은신처를 무너짐으로 → 다른 은신처) · ④ 연쇄 방화(`onClose` 를 바로 불러 — 이어받은 상태가 없을 때 고른 상점과 가까운 상점 12곳이 무너지면 그 밖에서) · ⑤ 재난(지진 Q2 가 고른 건물을 무너짐으로 → 그 건물들에서 사건 0) · 셋째 단계(폭동의 장소 여섯이 모두 통제면 그 가운데서, 모두 무너지면 교차로에서) · 흔적의 가중치(손상 1 인 흔적 24곳에 붕괴가 더 난다) · ⑥ 현장(그을음 0.6 · 손상 0.3 — `s.wear`·처음부터 탄 칸 = `pre` · 불 곁은 아님 · `totalFuelTiles` 가 정확히 `pre` 작다 · `burnedTiles` 0 · X6 의 `fuel0` 이 작고 처음 탄 비율 0 · 처음 건전도 ≤ 0.85 · 발생 기록 바로 뒤에 손상 사실 하나 · 충격과 겹칠 때의 합치기 둘) · ⑥ 방향(아래) · 글자 검사(`src/sim` 에 `placeGone(sim, …)` 을 부르는 곳 없음 · 아홉 자리의 `placeUsable`/`applyPlaceWear`). 끝 상태 — X6 다섯 줄 · 그을림 + 소실률 0.4 → 통제 1 · 다른 사건의 X6 상태는 그 사건의 줄이 아님 · 소실률 0.7/0.1/0.02 · 붕괴(0.22 문턱 · 2차 붕괴 → 무너짐 · spot) · 승강기 없음 · 열린 터는 흔적만 · 휴식(통제 −1 · 풀림 ×0.4·×0.5·opened·mark 지움 · 흔적 감쇠·지움 · opened 한 번 · 같은 건물의 새 피해와 합치기·since) · 상한(13번째 통제가 생기면 id 가 큰 것이 풀리고 가장 옅은 흔적이 버려진다). 6·10 — 짧은 연속의 건물 몫(통제·무너짐 ≤ 12 · 건물 ≤ 24 · 무너진 건물에서 사건 0 · 손상 건물의 사건마다 기록 하나 `checkWearLog`), `checkCarryLog`·`checkRoadLog` 가 건물 줄의 묶음을 안다(`noteEvents`). **결과 해시를 숫자로 박은 시험은 없다.**

**수치**

- 해시 목록 158교대(scratchpad `wf-persist/s04-hashlist.ts` — 단계 0·4 와 같은 목록): 기준 `s04-base-hashes.txt`(`19a7e68`) ↔ 변경 뒤 `s5a-hashes.txt`(여섯 자리를 `placeUsable` 로 바꾼 중간 코드)·`s5b-hashes.txt`(커밋 `a809418` 의 코드) — **둘 다 158줄 모두 한 글자도 다르지 않다**(`report.hash` · 보고서 JSON 의 FNV · 기록 수 · 명부 지문). 강제 실행 일곱 × 3 과 §8 의 셋 × 3, 지진 Q0~Q2 도 이 목록 안이라 이어받은 상태가 없는 교대의 한계 시간·방치 건수는 그대로다.
- 이어받은 상태로 시작한 강제 실행(`wf-persist/s5-force.ts` — 지진 Q1 이 남긴 상태: 무너짐 8곳 · 복구 도로 6구간, 강제 일곱 `fire/std`·`collapse/std`·`hazmat/std`·`armed/kidnap`·`fire/arson`·`armed/riot`·`collapse/gasblast` × F0~F2): 사건 331건 — 한계 시간 0 · 무대응 0 · 방치 2 · 열린 사건 0 · 무너진 건물에서 난 사건 0. 같은 21교대를 이어받은 상태 없이(`s5-force2.ts none`): 336건 — 한계 시간 0 · 무대응 0 · 방치 2 · 열린 사건 0.
- 진단(기준 아님 — `wf-persist/s5-smoke.ts`, 계보 × 교대): **보통 4 × 6** — 다음 상태의 출입 통제 + 무너짐 0~8곳(교대 6 에 1~6곳 — 늘어나지도 줄어들지도 않는다), 흔적 0~7곳, 풀린 건물(opened) 0~4곳, X6 상태는 대개 구획 붕괴(partial — 통제 2), 사건 352건 가운데 무너진 건물에서 0 · 통제 건물(셋째 단계)에서 0 · 손상된 건물(흔적)에서 0(흔적이 적고 빨리 옅어진다), 한계 시간 종료 3건(0.9%), 열린 사건 0. **첫 교대에만 지진 4 × 5** — 교대 2~4 의 통제 + 무너짐 6~12곳(지진의 전체 붕괴가 무너짐 4교대 — 교대 5 에 풀려 opened 7~9곳), 사건 326건 가운데 무너진 건물에서 0, 한계 시간 종료 6건(1.8%), 열린 사건 0.
- 그을음의 방향(§6.3 의 8 — `wf-persist/s5-soot.ts`, 아파트 281 · 같은 사건 시드 SOOT0~5): **심각도 3** — 그을음 0 의 소실률 평균 0.029 · 그을음 0.6 은 0.026(처음부터 탄 칸 평균 27.7칸 · 이번 교대에 탄 칸 평균 3.8 → 2.7칸), 전소·X6 탄 비율 0. **심각도 2**(일찍 꺼지는 작은 불) — 0.014 → 0.016: 이번 교대에 탄 칸 수는 같거나 적지만(평균 1.8 → 1.7칸) 분모가 21% 줄어 비율이 오른다(아래 알려진 문제).
- `world.expo`(머리 알림 ④ — `wf-persist/s5-expo.ts`): 교대 끝에 충격을 받은 건물 보통 0~3채(0.1 이상 0~2), 지진 5~15채(0.1 이상 2~14), 끊긴 배관 지진 0~3채, 태풍 0.
- 관문 `npm run check` 통과(코드 커밋 `a809418`): 파일 20 · 1062개 통과 + 건너뜀 1(persistence 65 → 81), vitest 631초 · 전체 11분 5초(다른 묶음과 함께 도는 기계 — 사용자 CPU 33분). `sweep 40 --check` 의 분포(보통 590건 · 성공 70% · close reasons resolved 588 · timeout 1 · abandoned 1 · 교착 후보 0 · 잊힌 사건 0 · C1~C5 0 · holes 0 · systems carry 0%)는 단계 4 관문의 기록과 같다(이어받은 상태가 없는 교대 — 해시 목록과 같이 그대로). persistence 혼자 60초쯤(새 시험 가운데 그을음의 방향 12교대가 가장 길다).
- 어려움·극한 `sweep 40 --check` 모두 '검증 통과'(이어받은 상태가 없는 교대): 어려움 737건 — close reasons resolved 722 · timeout 5 · noresponse 2 · abandoned 7 · shiftend 1, 교착 후보 0 · 잊힌 사건 0 · C1~C5 0 · holes 0 / 극한 903건 — resolved 832 · timeout 29 · noresponse 12 · abandoned 20 · shiftend 10, 교착 후보 1(허용 안의 값 — 관문 통과) · 잊힌 사건 0 · C1~C5 0 · holes 0 (scratchpad `wf-persist/s5-hard40.txt`·`s5-ext40.txt`).

**알려진 문제 (단계 8 의 균형으로)**

- **작은 불은 그을린 건물에서 소실률이 오른다**(분모 효과): 처음부터 탄 칸을 재산 피해의 분자·분모에서 함께 빼므로(본문 §3.6 — 시험이 `totalFuelTiles` 가 정확히 `pre` 작다를 본다), 일찍 꺼져 탄 칸 수가 같은 불은 비율이 `total / (total − pre)` 배(그을음 0.6 이면 1.27배쯤) 오른다. 번지는 불은 처음부터 탄 칸이 막아 비율도 줄어든다(심각도 3). 이어지는 영향은 흔적 줄(소실률 0.05)의 문턱을 넘는 작은 불 — 시험 3 의 방향은 번지는 불(심각도 3)의 소실률과 이번 교대에 탄 칸 수로 건다. 손잡이 §6.4-2 의 `PRE_BURN`(크기만 바뀐다) 또는 판정의 분모를 처음 연료 칸으로 두는 것(본문과 다르다 — 사용자 판단).
- **처음부터 탄 칸은 X6 의 구획 상한(`K_BURN × 탄 몫`)과 열화상 문턱(`regionBurning`)에도 든다** — 전소 분모(위 3)만 뺐다. 그을음 0.6 이면 실내 구획의 탄 몫이 0.2 남짓 → 상한 0.84 쯤(L1 0.6 위), `s.wear.dmg` 의 처음 건전도(0.5 × dmg)와 겹친다. 고치려면 `catastrophe.ts` 의 매초 고리(구획 탄 몫) 두 곳에 `preBurnt` 를 넣어야 한다 — 뜨거운 함수라 넣지 않았다.
- **지진 뒤 출입 통제·무너짐이 상한(12)에 4교대 가깝게 붙는다**(위 진단 — 무너짐 4교대). 장소 추첨은 다른 건물로 가므로 한계 시간이 오르지 않았다. 손잡이 §6.4-2(붕괴 `repair` 4·2).
- **자연히 생긴 연속에서 손상된 건물(흔적)의 사건은 드물다**(진단 678건에 0) — 흔적이 교대마다 0~7곳이고 그을음 −0.25 · 손상 −0.15 로 한두 교대면 지워진다. 흔적 가중치(붕괴 × (1 + 3 × dmg))와 `noteWearIncident` 는 시험 3 이 손으로 만든 상태로 본다. 단계 8 의 측정(`chain.ts` 의 `markedInc`)이 자연히 생기는 비율을 잰다.
- 화재가 구획 붕괴(X6 `partial`)를 남기는 일이 잦아 화재 건물이 대개 출입 통제 2교대가 된다(진단의 X6 상태 대부분이 partial). X6 의 균형(`K_BURN`)이거나 이 묶음의 표(partial → repair 2)다.

**뒤 단계가 이어받을 자리**

- **단계 6 (화면)**: 지도 `carryLayer.ts` 는 `sim.carryState.places`(교대 내내 그대로 — `mark`·`spot`·`opened`·`state`·`soot`·`dmg`)를, 현장 `staticLayer` 의 얼룩은 `s.wear?.soot` 와 `s.burned`(처음부터 탄 칸이 이미 탄 바닥으로 그려진다)를 읽는다. 마우스 정보의 건물 줄은 `placeCond(sim, q.id)`(화면도 불러도 된다 — 상태를 바꾸지 않는다).
- **단계 7 (보고서)**: '지난 교대에 손상된 건물에서 사건 n건 (코드들).' = `carryState.stats.markedInc`, `CarrySummary.marked·closed·ruin` = 다음 상태의 `places`(state 별), 그 교대의 출입 통제 건물 수 = `carryState.places`. `makeCarryover` 는 지금도 순수하다(건물은 난수를 쓰지 않는다 — `buildReport` 안에서 불러도 된다).
- **단계 8 (측정·균형)**: 위 알려진 문제 다섯, `chain.ts --soot`(§6.3 의 8 — `s5-soot.ts` 를 옮기면 된다), §6.3-6 의 "교대 6 의 출입 통제·무너짐 평균 ≤ 교대 2 의 절반"(진단: 지진 계보의 교대 2 는 9~12곳, 교대 5~6 에 3~8곳).
