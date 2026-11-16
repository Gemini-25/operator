# R3 — 분야별 대응 교본: 상황 × 장비 × 상태

공통 규칙은 `docs/specs/README.md`. 브랜치 `wf/doctrine`, 개발 서버 포트 **5219**(H1 5210 · R1 5211 · G4 5212 · R2 5213 · U2 5214 · X6 5216 · I1 5218 다음).

사용자 요청(그대로): "경찰 대원들의 상황별 장비별 상태별 대응, 소방 대원들의 상황별 장비별 상태별 대응, 의료 대원들의 상황별 장비별 상태별 대응, 특수 대원들의 상황별 장비별 상태별 대응 이런게 있으면 좋겠다는거야"

한 줄로: 네 분야(경찰·소방·의료·특수)마다 **상황**(사건 유형과 현장 국면) × **장비**(그 대원이 든 개인 장비와 부대 장비의 유무·잔량·알려진 고장) × **상태**(자기 몸·공기·탄·지구력·동요·경험, 짝이 있는가, 지원이 오는가)에 따라 "무엇을 먼저 하는가"를 정한 **교본 표**를 두고, 대원·지휘관·관제가 그 표로 고른다. 관찰자는 기록 문구·머리 위 라벨·대원 정보창·보고서 문장으로 "같은 상황인데 이번엔 장비가 없어서 / 다쳐서 / 혼자라서 다르게 했네"를 본다.

**선행 관계**: 구현 순서는 `docs/specs/README.md` "구현 순서"(= `docs/ROADMAP.md` "진행 중")대로 R1(편성·개인 장비·헬기) → H1(부상과 사망) → X6(위험의 현실화) → R2(대응 방법) → **R3** → I1-b → I2 이고, G4·G5·U2 는 따로다(G5·U2 는 합쳐졌다). 그래서 다음 구현 세션이 R3 를 시작할 때는 **R1·H1·X6·R2 와 G5(어쩌면 G4)가 이미 합쳐져 있다**고 본다. 이 문서는 같은 날 쓰인 `R1-crews.md`·`R2-methods.md`·`H1-injuries.md`·`X6-catastrophe.md`·`G4-scene-legibility.md`·`G5-combat-fx.md`·`I1-causality.md`·`I2-persistence.md` 를 읽고 그 이름·자료형을 그대로 썼다. 이름이 어긋나면 **먼저 합쳐진 쪽(R1 > H1 > X6 > R2)의 실제 코드**를 따른다.

**R3 는 그 위에 얹는 교본이다 — 같은 것을 다시 정의하지 않는다.** 편성·역할·장비 효과·공기·섬광탄·테이저는 R1, 같은 임무의 여러 방법과 고르는 점수(`chooseMethod`)·실패 기억(`a.mfail`)은 R2, 부상의 효과(`bandOf`·`hurtF`·출혈 후퇴)·쓰러진 동료 처치(`treatMate`)는 H1, 위험의 조짐·위험 단계·철수 명령·외부 방어(`DANGER_RULES`·`evacuate`·`a.avoid`)는 X6 이다. R3 가 새로 정하는 것은 넷이다.

1. **교본 표**: 분야·역할마다 "이 상황·장비·상태면 이 행동(또는 이 방법)을 먼저 고른다"는 우선순위와 문턱.
2. **상태가 바뀔 때의 행동 변화**: 공기 30% 미만이면 탈출, 탄이 떨어지면 엄폐하고 재보급, 다친 대원은 가벼운 일로 — 그리고 되돌아오는 조건(되풀이 왕복을 막는 간격).
3. **짝(버디) 규칙**: 누가 누구의 짝인가, 짝 없이 하지 않는 일, 혼자 남은 대원의 행동.
4. **교본을 고르는 자리와 기록**: 어디서 표를 읽는가(정보 격리를 지키는 쪽으로), 충돌하면 무엇이 이기는가, 고른 까닭을 상태를 바꾸는 그 코드에서 남기는 법.

교본이 돌아가려면 바탕 둘이 더 필요하다 — R1 이 일부러 넣지 않은 **탄약**(R1 "이번에 하지 않는 것": 총은 무제한)과 지금 대원에게 없는 **엄폐 자리 찾기**(지금은 피격되면 대기 지점까지 물러난다). 이 둘도 이 문서가 정한다(2.9·2.10).

**줄 번호를 쓰지 않는다.** R1·H1·X6·R2 가 같은 파일을 고친 뒤라 위치는 파일·함수·`case` 이름으로 가리킨다. 조사 때의 줄 번호는 2026-11-14 코드 기준이다.

**자기 파일**(새로 만든다):

| 파일 | 하는 일 | 진실을 읽어도 되는가 |
|---|---|---|
| `src/sim/field/doctrine/registry.ts` | 교본 줄의 틀(`DoctrineRule`·`DocEffect`·`DocCtx`)과 등록(`registerDoctrine`), 줄 목록 `DOCTRINE`, 지휘·관제 줄의 이름표 `CMD_ROWS` — **잎 모듈**(타입과 배열뿐) | 해당 없음 |
| `src/sim/field/doctrine.ts` | **판단부 엔진**: 분야 판정 `docDeptOf`, 판단 입력 `stateSelf`·`stateReported`·`docSit`·`docCtx`, 걸리는 자리 `docFit`·`docFitRules`·`docDuty`·`docAct`·`docRetreat`·`docDrop`·`docMethodMul`·`docGate`, 바탕 `coverSpot`·`buddyOf`·`outsideWatch`, 짝 표 `PAIRS`·`SOLO_OK`, 상수 표 `DOC` | **안 된다** — 테스트가 금지어와 행동을 검사한다(2.4·10절 1·3) |
| `src/sim/field/doctrine/{common,police,fire,ems,special}.ts` | 분야별 교본 줄(3절). `registerDoctrine` 만 부른다 | **안 된다**(줄은 `DocCtx` 만 받는다) |
| `src/sim/field/doctrine/index.ts` | 다섯 파일을 이 순서로 import(등록 순서 = 같은 순위의 줄끼리 이기는 순서) | — |
| `src/sim/field/doctrineRun.ts` | **실행부**: 새 임무(`cover`·`rearm`·`airOut`·`pairOut`·`pair`·`triage`)의 실행, 탄약 소모·재장전(`fireRound`·`reloadTick`), 자기 신고(`selfReport`), 짝 맺기(`pairUp` — 부대가 내린 뒤 한 번)·다시 맺기(`rebuddy`), 출입구 하나의 진입(`breachExit` — `executor.breach` 에서 꺼낸 몸), 이송·교통 통제·해체 방법의 효과(`runCarry`·`runTraffic`·`runDefuse` — 3.7. 진압·수색 방법의 효과는 R2 의 `methodRun.ts`), 기록(`recordDoc`) | 된다(`executor.ts` 와 같은 자격) |
| `src/sim/field/orders/doctrine.ts` | 지휘 교본(6.1의 새 줄): `registerOrders` | 안 된다(`tests/ext.test.ts` 가 이미 검사한다) |
| `src/sim/dispatch/doctrine.ts` | 관제 교본(6.2): 부대 고르기 가산 `dispatchPref`, 수요 보정 `docNeeds`, 추격 역할 `chaseRoles` | 안 된다(관제 — 평가·조직 정보만) |
| `tests/doctrine.test.ts` | 10절 | — |

**공용 파일 수정**: 11.1 의 표에 함수와 이유를 모두 적었다. 그 밖의 곳을 고쳐야 하면 고치되 끝낼 때 보고에 파일·함수·이유를 적는다.

**건드리지 않는다**: `city.ts`·`cityPlan.ts`, `builders.ts`·`field/scenes/{crime,major,disaster}.ts`(현장 생성은 그대로), `field/injury.ts`(H1 — 부르기만), X6 의 `catastrophe.ts`·`ops.ts`(읽기만 — `orders/catastrophe.ts` 의 `DANGER_RULES` 에 줄 두 개를 더하는 것만 예외, 6.1), R1 의 `field/rules/air.ts`·`field/airDecide.ts`, `tests/sim.test.ts`·`tests/crime.test.ts`(깨지면 교본 쪽을 고친다 — 11.2-12), `README.md`·`CLAUDE.md`·`docs/ROADMAP.md`(합친 뒤에 한꺼번에). R2 의 `gear.ts` 에는 판단용 감싼 함수 다섯을 **더하기만** 한다(2.4, 11.1).

---

## 0. 지금 상태 — 무엇이 이미 갈리고 무엇이 갈리지 않는가

(조사 기준 2026-11-14. 오른쪽 열은 R1·H1·X6·R2 가 문서대로 들어왔을 때.)

| 분야 | 지금 상황·장비·상태로 갈리는 것 | 갈리지 않는 것 | R1·H1·X6·R2 뒤 |
|---|---|---|---|
| 경찰 | 섬광탄 유무(던질 자리로 / 동료를 7.5칸에서 기다림 / 쏘지 않고 덮침 — `executor` `case 'engage'`), 인질 1.7칸 안 사격 보류, 무기(총 / 흉기·맨손)로 협상·진입 문턱, 용의자 상태로 검거 시간, 머릿수 문턱(≥2·≥3·≥4 — `commander.syncBoard`), 체력 < 40 후퇴, 피격 3초 안 · 엄폐 아님 · 체력 < 70 이면 침착함만큼 후퇴(`brain.dangerScore`) | 순찰·기동·특공·폭발물이 같은 코드(부대 수치만 다르다). **탄약이 없다**(사격 무제한). **엄폐를 찾지 않는다**(교전은 아무 7.5칸 자리, 후퇴는 대기 지점까지). **혼자인가를 보지 않는다**(방 진입은 4초 뒤 혼자, 동시 진입은 +8초 뒤 혼자, 흉기 상대 검거는 경찰이 하나면 25초 대치 뒤 혼자도). 짝이 없다. 다친 대원도 같은 일(`fitFor` 가 체력을 보지 않는다 — `assign` 은 지구력만 본다). 흉기·맨손 상대는 `arrest` 로 다룬다 — 지휘관은 `fight` 이고 경찰이 둘 이상이면 `arrest`(max 2), 아니면 25초 뒤 `arrest` 를 낸다(`commander.syncBoard`). 실행기 `case 'arrest'` 는 1.3칸까지 곧장 다가가 5초 제압한다(`engage` 의 첫 갈래는 도주 용의자 추격에만 쓰인다 — `engage` 는 도주 때와 총기 진입 결정 뒤에만 생긴다). 협상자는 용의자가 교전해도 서 있다. 추격 차량은 모두 같은 알려진 위치로 간다 | R1: 테이저·방패·저격 거리·역할 선호, 인원 문턱(총기 && 역할 묶음 `bomb` 제외), 섬광탄 사람 몫. R2: 비살상탄·결정적 저격·irons/ram·대피 방송, 교전 분기의 기록 이름. H1: `hurtF`, 출혈 후퇴, 몸싸움. X6: 출입 통제 |
| 소방 | 경로 위 불(진압하며 지나감 / 우회), 펌프 고장 → 예비 펌프, 물 소진 → 소화전, 지구력 < 22 휴식(40 까지 붙잡음), 체력 후퇴, 침착함 배율, 운반 중이면 버팀 | **공기 개념이 없다**(연기 속에 무한정). **2인 진입·밖 대기조가 없다**(수색 작업 `max 1` — 혼자 실내로). 후퇴 뒤 곧바로 같은 곳으로(재진입 기억 없음). 다친 대원에게 가벼운 일이 없다. 예비 펌프 무제한. 소화전 없는 현장의 대체 행동 없음. 펌프 고장도 '용수가 떨어짐' 요청. 신입·베테랑은 속도만 다르다. 지원이 오는 중인지가 개인 행동을 바꾸지 않는다 | R1: 공기(`scba` 의 `uses`)·`swapAir`(60초)·`uses < 45` 면 위험 실내 0·열화상·유압 장비·펌프 조작. R2: 외부 방어·고가 방수·소화기·배연, 문·구출·수난의 갈래. H1: 화상·열 탈진·추락. X6: 조짐·위험 단계·철수·외부 방어·`a.avoid` |
| 의료 | 현장 처치 / 먼저 옮기기(위험 현장·안전 확보 전·구급 유무), 응급 현장의 "누구든 먼저 처치", 기본 처치 뒤 재처치는 구급만, 탑승 우선도·출발 조건, 구급 요청 문턱 | 처치가 하나뿐(심정지·외상·실신이 같은 "응급 처치"). **분류(트리아지)가 없다.** **처치와 이송이 겨룬다**(처치 중인 환자를 다른 대원이 들어 간다 — S3 사건 01·02). 처치를 넘겨받지 않는다. 안전 확보 전에는 **안전 구역의 환자도** 구급이 못 본다. 차로 위 처치의 위험을 기다리지 않는다. 다친 구급대원의 행동이 같다. 구급 지휘관이 타고 떠나면 '지휘 불능' | R1: 가방·제세동기·들것·척추 고정판·의료 헬기·환자 자리. R2: 현장 안정(`stay`)·즉시 이송(`rush`)·헬기 이송 기록. H1: `treatMate`, `manageAmbulances` 의 믿음화, `treatEffect` |
| 특수 | 섬광탄(특공 +2), 방호 수치, 해체는 처리반만, 피해 배율 | 특공·기동·순찰·폭발물이 같은 경로(폭발물 처리반이 인질극 진입을 이끈다 — S7). 폭발물 처리가 한 가지(로봇·방호복·대피 반경 없음). 화학 구조차가 가스 누출 수요로 오지 않는다(20교대 출동 49건 모두 구조 수요). 헬기는 늘 내려앉는다. 구조정은 배로 쓰이지 않는다. 사다리차는 펌프차와 같다 | R1: 특공 다섯 역할·로봇·방호복·헬기 세 종류·호이스트·물 투하. R2: 보트·고가 방수·배연·저격·비살상탄. X6: 측정기로 읽는 가스 조짐 |

**R1~R2 뒤에도 비어 있는 자리** — 이 문서가 채운다:

1. 탄약(재장전·재보급)과 엄폐 자리 찾기 — 바탕이 아예 없다.
2. 혼자인가·짝이 있는가·지원이 오는가 — 어떤 판단도 보지 않는다.
3. 다친 대원의 일 바꾸기 — H1 은 느려지고(`hurtF`) 물러나는(`health < 40`·출혈) 것과, 물러났던 걸을 수 있는 다친 대원(`injured`)이 가벼운 일(H1 `LIGHT_WORK` — 정본 H1 §2.5·§2.7)만 맡는다는 것을 정했다(사용자 결정 2026-11-15 "가벼운 일은 계속" — 그 목록 밖은 `fit` 0). 물러나지 않은 중상(체력 41~70) 대원은 H1 에서 같은 일을 한다 — R3 의 부상 줄(P12·F14·E11·G01)이 그 대원의 일을 같은 목록 쪽으로 기울인다.
4. 공기 탈출의 문턱과 "짝과 함께 나오기" — R1 은 60초 미만이면 교체 후보를 낼 뿐이다.
5. 의료의 분류·넘겨받기·처치 중 이송 막기·경계 밖 처치소.
6. 특수 부대가 자기 일을 먼저 하게 하는 관제·지휘의 갈래.
7. 이 갈래들이 **표 하나에서 보이는 것** — 지금은 코드 곳곳의 `if` 로 흩어져 있어 관찰자도 다음 구현자도 "어떤 상황에서 무엇을 먼저"를 한 곳에서 볼 수 없다.

---

## 1. 범위와 나누는 선

**하는 것**: 교본의 틀(자료형·고르는 자리·등록·충돌·기록), 분야별 교본 표 네 개와 공통 줄(3절), 상태 문턱과 되돌아오는 조건(4절), 짝 규칙(5절), 지휘·관제 교본의 새 줄(6절), 화면·보고서(7절), 바탕 둘(탄약·엄폐 자리), 새 임무 여섯(`cover`·`rearm`·`airOut`·`pairOut`·`pair`·`triage`), R2 방법 표에 행 열 개(`feel`·`pulse`·`pack`·`drag`·`litter`·`post`·`blockLane`·`robotDefuse`·`suitDefuse`·`bareDefuse`).

**하지 않는 것**:
- 새 사건 유형·시나리오·부대 종류. 사다리차의 창문 구조(ROADMAP C4), 잠수.
- R1~R2 가 이미 만드는 행동을 다시 만드는 것(테이저·호이스트·공기통 교체·외부 방어·헤엄 구조…). R3 는 그 행동을 **언제 먼저 고르는가**만 정하고 표에 "있음"으로 적는다.
- 지휘관이 대원 한 사람의 방법을 지시하는 것(R2 의 결정 그대로).
- 시한(폭발물 `fuse`)을 믿음에 넣는 것 — 진실에만 있다(11.3 결정 7).
- 교대 사이의 지속(탄약 상자·예비 펌프의 이어받기는 I2 몫 — I2 §3.3 의 표에 R3 의 두 칸을 더하는 것은 I2 가 정한다).
- 경찰의 용의자 호송. H1 이 "호송은 기계적으로 모델하지 않는다"(H1 §4.3)고 정했고 R3 도 다루지 않는다 — 다친 용의자의 이송은 H1 의 `treatSuspect` 그대로다.

| 설계서 | 겹치는 곳 | R3 가 새로 정하는 것 | 가리키기만 하는 것 |
|---|---|---|---|
| R1 편성·개인 장비·헬기 | 역할 36·장비 35(`KITS`), 공기·섬광탄·테이저, 헬기 세 종류, 인원 문턱 | ① 탄약(`KitDef.mag`·`reload`·`perShot`, 총기 `uses`, `KitItem.mag`, `Unit.ammoBox`) ② 공기 탈출 문턱(`AIR_OUT`·`AIR_IN`)과 `swapAir` 후보의 문턱 하나 ③ 짝 묶음 표(`PAIRS` — 역할 쌍, 5.1) ④ 진입 문턱을 "쓸 수 있는 경찰"로(6.1 CP1) ⑤ 예비 펌프 수(`Unit.sparePump`) ⑥ 척추 고정판 효과의 조건을 "가졌는가"에서 "고정했는가"로(E13) ⑦ `defuse` 자격에 작동하는 로봇(S06) | 역할·기본 장비·장비 효과, `hasKit`·`kitUses`·`toolFor`·`crewHasKit`·`capableOf`(판단용)과 `kitWorks`·`useKit`·`toolUse`(효과용)의 나눔, `swapAir` 의 실행, 헬기의 상공 판단(`airDecide.ts`) |
| R2 대응 방법 | 방법 틀(`METHOD`·`chooseMethod`·`MethodWhy`), 실패 기억 `a.mfail`, 선택 임무 | ① `chooseMethod` 의 마지막 인자 `dc: DocCtx \| null` 과 `MethodCtx.dc`(R2 §3.2·§3.4 에 반영됨) ② 점수에 교본 배율(`docMethodMul`)을 곱한다 ③ `MethodWhy` 에 여섯(`hurt`·`alone`·`lowAir`·`lowAmmo`·`shaken`·`tired` — 사상 표 3.7. R2 의 평소 까닭은 `usual`) ④ 방법 행 열 개(위) — R2 가 "R3 몫"으로 넘긴 이송·교통 통제의 방법, 그리고 수색·진압·해체 몇 갈래 | 방법을 바꾸는 세 때, 도착 재선택, 기록 문구 `SAY`, `recordMethod`, `mrng` 흐름, `gear.ts` 의 판단용 `kitCount` |
| H1 부상과 사망 | 다친 대원의 행동, 동료 처치, 트리아지 순서 | ① 체력 41~70(중상) 대원의 **일 바꾸기**(가벼운 일 — 공통 G01. 가벼운 일 목록은 H1 의 `LIGHT_WORK` 하나를 쓴다 — 정본 H1 §2.5·§2.7. H1 은 `injured` 대원에게 그 목록 밖을 `fit` 0 으로 막고(사용자 결정 2026-11-15 "가벼운 일은 계속"), R3 는 그 위에서 아직 `injured` 가 아닌 중상 대원을 배율로 기울인다) ② 자기 신고 사실 `crew`(지휘관이 남의 체력을 직접 읽지 않게 — 2.4) ③ 동요(`a.shaken`) ④ 의료의 분류 임무 `triage`(H1 §6.2 의 우선도 표는 그대로, 분류는 그 앞 단계) | `bandOf`·`hurtF`·`r.bleed`(자기 몸), 믿음 술어 `mateNeedsHospital`, 출혈 후퇴 조건, `rescueMate`·`treatMate` 의 자격 |
| X6 위험의 현실화 | 철수 판단, 위험 구역, 외부 방어 | `DANGER_RULES` 에 **장비 조건이 붙은 줄 둘**(X6 줄보다 이르거나 높은 단계를 내는 것만 — 표의 모양은 그대로, 6.1 CF5·CF6), 교본의 의무(`airOut`)를 X6 의 `evacuate` 의무 **뒤**에 둔다(2.6) | 조짐·`signDanger`·`selfDanger`·`evacuate`·`a.avoid`·`registerGate`·제한적 구조 진입(`w.risky`), 외부 방수 자리 |
| G4 현장 가독성 | 현장 그림 | 없음(R3 는 현장 고정 층·위험 표지를 건드리지 않는다) | — |
| G5 교전 연출 | 사격·엄폐·진입 그림 | ① `cover` 임무의 자세(G5 의 엄폐 자세 `PersonPose.crouch` 를 그대로 쓴다) ② 재장전 중에는 사격 기록(`recShot`)이 나지 않는 것 ③ 협상 중단 표시의 조건 한 조각(7.2) | 사격·섬광탄·진입의 그림과 소리 전부, 쏘는 총 고르기(`weaponOf` — `sniper` > `rifle` > `pistol`) |
| I1 인과·측정 | 행동 다양성 | `sweep --doctrine` 의 `doctrine` 칸(8절) — I1-a 의 `metrics` 와 이름이 겹치지 않게 | `actions.entropy`·`actions.methodEntropy`·`stall.candidates`·`replan.share`·`alt.methods.rate` 를 그대로 읽는다 |
| I2 교대 간 지속 | 다음 교대의 상태 | 없음 | 탄약 상자·예비 펌프·동요를 이어받을지는 I2 가 정한다(11.4 확인 필요) |

---

## 2. 교본의 틀

### 2.1 자료형 (`types.ts` — 추가만, 합집합 끝에는 새 줄로)

```ts
// ───────────────────────── 대응 교본 (R3) ─────────────────────────
/** 교본 표의 분야. 부대 분야(UnitField)와 다르다 — 사다리차는 부대 분야가 소방이지만 교본은 특수 표에 있다 (2.2) */
export type DocDept = 'common' | 'police' | 'fire' | 'ems' | 'special';
/** 교본이 걸리는 자리 (2.3) */
export type DocHook = 'fit' | 'duty' | 'act' | 'method' | 'gate' | 'cmd' | 'dispatch' | 'chase';
/** 교본이 내는 상태 행동 (같은 이름의 TaskKind 로 실행한다) */
export type DocActId = 'airOut' | 'pairOut' | 'cover' | 'rearm' | 'pair';
/** 실행기가 교본에 묻는 판단 지점 (2.3 ④) */
export type DocGateId = 'interiorEntry' | 'roomEntry' | 'breach' | 'closeIn' | 'coverFire' | 'bangUse' | 'carryHold' | 'carryStart' | 'laneTreat';
/** 교본 행동의 까닭 — 보고서·패널의 말 (7.3 의 WHY_DOC) */
export type DocWhy = 'alone' | 'buddy' | 'outside' | 'hurt' | 'tired' | 'shaken' | 'lowAir' | 'lowAmmo' | 'noKit' | 'kit' | 'civ' | 'hostage' | 'danger' | 'triage' | 'backup' | 'protocol' | 'team';
/** 대원 자신의 몸 상태 신고 ('crew' 사실의 값). 지휘관·동료는 남의 몸을 이것으로만 안다 (2.4) */
export interface CrewBelief {
  band: number;          // 신고한 중증도 0~2 (중상 문턱에 간격이 있다 — 4절)
  air: 0 | 1 | 2;        // 공기: 0 넉넉함(≥ AIR_IN) · 1 낮음 · 2 위급(< AIR_OUT). scba 가 없으면 0
  ammo: 0 | 1 | 2;       // 탄: 0 넉넉함 · 1 마지막 탄창 · 2 위급(발사 2회 이하) 또는 0. 총이 없으면 0
  shaken: boolean;       // 동요 중
  t: number;
}
/** 교본을 쓴 기록 한 줄 (보고서·측정은 이것으로만 교본을 말한다) */
export interface DocUse {
  t: number; t1: number;               // 시작·끝 (기다림처럼 길이가 있는 것. 한 순간이면 t1 = t)
  rid: number; unitId: number; rule: string; hook: DocHook;
  act?: DocActId; gate?: DocGateId; method?: MethodId; work?: WorkKind;
  mate: number;                        // 짝·함께한 대원 rid (없으면 -1)
  tgt: string;                         // 대상 열쇠 (R2 targetKey 와 같은 모양, 없으면 '')
  eventId: number;                     // 그때 남긴 기록 (기록 없이 센 것은 -1)
  say: boolean;                        // 보고서 문장 후보인가 (7.3)
}
```

있는 자료형에 더하는 것(모두 선택 칸. 합집합은 그것을 구현하는 단계에서 더한다 — H1 §2.1 의 "합집합" 규칙: `WorkKind`·`TaskKind` 를 늘리면 `workLabel`·`fitFor` 의 `switch`·`Record` 가 같은 커밋에서 고쳐져야 컴파일된다):

```ts
// FactType 끝에 새 줄
  | 'crew';                                 // 대원 자신의 몸 상태 신고 (id = rid, 값 CrewBelief) — 1단계
// TaskKind (한 줄 합집합 — R1 'swapAir' · X6 'evacuate' · R2 'ashore' 뒤, 그 줄 끝에)
  | 'cover' | 'rearm' | 'airOut' | 'pairOut' | 'pair'      // 2·3단계
//   이름 'cover' 가 셋이다 — 헷갈리지 않게 구분한다: TaskKind·DocActId 'cover' = 숨기(엄폐 자리로 가서 쏘지 않고 기다림, 라벨 '엄폐'),
//   R2 MethodId 'cover' = 엄폐 사격 분기의 기록 이름(쏜다 — G5 의 기록과 맞춰져 있다), DocEffect choose 'cover' = P05 의 엄폐 사격 자리 고르기.
//   패널·split(8.2)에서는 임무 'cover' 를 '엄폐(대기)', 방법 'cover' 를 '엄폐 사격' 으로 적어 가른다
// WorkKind 끝에 새 줄 — 4단계
  | 'triage';                               // 다수 사상자 분류 (구급만)
// MethodId 끝에 새 줄 (R2) — 3·5·6단계 (METHOD 가 Record 라 행을 함께 둔다)
  | 'feel' | 'pulse' | 'pack' | 'drag' | 'litter' | 'post' | 'blockLane' | 'robotDefuse' | 'suitDefuse' | 'bareDefuse';
// MethodWhy (R2 — 한 줄 합집합, 그 줄 끝에. R2 의 평소 까닭 이름은 'usual' — 교본(doctrine)과 헷갈리지 않게)
  | 'hurt' | 'alone' | 'lowAir' | 'lowAmmo' | 'shaken' | 'tired'
// KitItem (R1)
mag?: number;                               // 총기: 지금 탄창에 남은 탄 (uses 는 가진 탄 전부 — 탄창 포함)
// FieldAgent
buddy?: number;                             // 짝의 rid (-1 = 짝 없음). makeAgent 는 -1, 부대가 내린 뒤 pairUp 이 PAIRS 로 맺고 rebuddy 가 다시 맺는다 (5절)
doc?: { rule: string; act: DocActId; since: number } | null;   // 지금 따르는 교본 행동 (패널·계속 점수)
docMem?: { rule: string; key: string; until: number }[];       // 교본 기억 두 가지 (4.4 끝): key 'w:<workId>' = 그 작업을 그 시각까지 맡지 않는다(fit 0) · 그 밖의 key(대상 열쇠) = 그 행동 줄을 그 대상에 다시 걸지 않는다
shaken?: number;                            // 동요가 끝나는 시각 (없거나 지났으면 동요 아님)
shakenOff?: number;                         // 동요가 끝난 시각 — 10초 동안 다시 동요하지 않는다
reloadUntil?: number;                       // 재장전이 끝나는 시각 (그 전에는 쏘지 않는다)
crewSig?: string;                           // 마지막으로 신고한 몸 상태의 서명 (같은 신고를 되풀이하지 않는다)
// Task
docRule?: string;                           // 이 임무를 연(또는 막고 있는) 교본 줄
gateAt?: number;                            // 판단 지점에서 막히기 시작한 시각 (-1 = 막히지 않음)
gateId?: DocGateId;                         // 막고 있는 판단 지점 (breach 는 s.breachDone 뒤에도 이것으로 문 앞에 남는다 — 3.1 P07)
gateSaid?: boolean;                         // 막힘을 이미 알렸다 (한 번만)
cvX?: number; cvY?: number;                 // 고른 엄폐 자리 (P05·cover — 2.10. 한 번 정하면 다시 고르는 조건이 될 때까지 그대로)
cvTx?: number; cvTy?: number; cvLost?: number;   // 고를 때의 위협 믿음 위치, 시야를 잃은 시각 (-1)
// Unit
ammoBox?: number; ammoBoxMax?: number;      // 차에 실은 탄약 상자 (한 상자 = 한 사람의 총기를 가득 채움)
sparePump?: number;                         // 남은 예비 펌프 (지금은 무제한 — 3절 F10)
// Scene
triageAt?: number;                          // 분류가 끝난 시각 (-1 = 아직). 지휘 상태 — s.secureAt 과 같은 자격 (6.1 CE1)
laneShield?: number[] | null;               // 차량으로 막은 통제 지점 (6단계 blockLane)
// Incident
docs?: DocUse[];
trackBy?: 'air' | 'ground' | null;          // 추격전: 지금 차를 보고 있는 쪽 (보고 있으면 그 부대가 위치를 알려 온다 — 공개 정보)
reportedPrev?: number;                      // 그 전에 알려진 교차로 (진행 방향을 아는 데 쓴다 — 값이 바뀔 때만 적는다, 6.2)
reportedNodeAt?: number;                    // 알려진 위치가 마지막으로 보고된 시각 (D7 의 차 도착 예상)
// ShiftReport
doctrine?: Record<string, number>;          // 이 교대에 교본 줄이 쓰인 횟수 (sweep --doctrine 이 쓴다)
docSplit?: Record<string, Record<string, number>>;   // '분야|국면|임무' → (고른 것 → 횟수). 고른 것 = 방법 id · 교본 행동 · 'none' (8.2 split)
// Tuning (difficulty.ts)
ammoBox: number;                            // 장비 손잡이: [1, 1, 2, 2, 3]
sparePump: number;                          // 장비 손잡이: [0, 1, 1, 1, 2]
```

R1 의 `crews.ts` `KitDef` 에 세 칸: `mag?: number`(탄창 크기), `reload?: number`(재장전 초), `perShot?: number`(한 번 쏠 때 쓰는 탄). 그리고 R2 가 더한 `uses?`(처음 수량)를 총기 셋에 채운다(2.9).

**객체 모양**(CLAUDE.md 함정 "자주 도는 객체의 모양" — 속도만의 문제): 새 선택 칸은 생성 리터럴에도 같은 순서로 넣는다 — `FieldAgent` 는 R1 의 `agents.makeAgent`(`buddy: -1, doc: null, docMem: undefined, shaken: undefined, shakenOff: undefined, reloadUntil: undefined, crewSig: undefined`), `Task` 는 `executor.makeTask`(`docRule: undefined, gateAt: -1, gateId: undefined, gateSaid: false, cvX: undefined, cvY: undefined, cvTx: undefined, cvTy: undefined, cvLost: -1`), `Unit` 은 편성표·지원 두 리터럴, `Scene` 은 `kit.ts` `baseScene`(`triageAt: -1, laneShield: null`), `Incident` 는 `incidents.createIncident`.

### 2.2 교본 분야와 "누구"

교본 표는 사용자의 네 분야로 나눈다. 대원의 표 분야는 **역할**(R1 `RoleId`)로 정한다(`docDeptOf(sim, rid)`):

| `DocDept` | 역할 | 부대 |
|---|---|---|
| `police` | `patrolLead`·`officer`·`tacLead`·`tacOfficer`·`observer` | 순찰·기동·경찰 헬기 |
| `fire` | `fireLead`·`nozzle`·`firefighter`·`engineer`·`rescueLead`·`extricator`·`searcher`·`ropeTech` | 펌프차·구조 공작차 |
| `ems` | `paramedic`·`emt`·`emsDriver`·`doctor`·`flightNurse` | 구급차·의료 헬기 |
| `special` | `swatLead`·`shield`·`breacher`·`assaulter`·`marksman` · `bombTech`·`robotOp`·`eodGuard` · `hazLead`·`hazTech`·`decon` · `airRescuer` · `boatRescuer` · `ladderLead`·`ladderOp` | 특공·폭발물·화학·소방 헬기·구조정·사다리차 |

- 표의 분야는 **줄을 어느 파일에 두는가**일 뿐이다. 줄이 누구에게 걸리는지는 줄의 `who`(R1 부서 `Dept`·교본 분야 `DocDept`·역할·역할 묶음·부대 종류)와 장비 조건(`kits`)으로 정한다. 예: 경찰 표의 흉기 대응 줄은 `who: { dept: ['police'] }` 라 특공·폭발물 대원에게도 걸린다. 소방 표의 공기 탈출 줄은 `kits: ['scba']` 라 화학대·사다리차·소방 헬기 대원에게도 걸린다. 부상 줄처럼 "분야마다 한 줄씩, 겹치지 않게"가 필요한 줄은 `who.doc`(교본 분야)로 가른다(3.5 G01).
- 사다리차(`ladderLead`·`ladderOp`)를 특수 표에 두는 까닭: `docs/ROADMAP.md` 첫머리의 조직 목록이 특수를 "특공대·구조 헬기·화학 구조대·구조정·폭발물 처리반·사다리차"로 묶는다. 부대 분야(`UnitField 'fire'`)·편성은 R1 그대로다.
- 내리지 않는 자리(조종사·정장)는 현장 대원이 아니므로 교본이 걸리지 않는다. 경찰 헬기의 관측자(`AirOp.eye`, `aloft`)는 R1 의 `airDecide` 가 판단한다 — 교본의 `act`·`duty`·`gate` 를 부르지 않는다(관측자는 걷지 않는다).

### 2.3 고르는 자리 — 판단 전용 파일의 순수 함수를 네 자리에서 (결정)

| 후보 | 장점 | 문제 |
|---|---|---|
| (가) 지휘관이 교본을 골라 지시에 싣는다 | 지시 문구에 교본이 드러난다 | 지휘관은 남의 몸(체력·출혈)을 직접 읽으면 안 된다(H1 원칙). 묶음 보고(5초)만큼 낡은 믿음으로 "공기 30% 미만"·"탄 2발" 같은 빠른 상태를 판단할 수 없다 |
| (나) 실행기가 진실을 보고 고른다 | 코드가 짧다 | 정보 격리 예외가 는다(README "알려진 문제"의 예외 3건을 늘리지 말라는 규칙) |
| **(다) 판단 전용 파일의 순수 함수를, 결정이 일어나는 네 자리에서 부른다** | 자기 몸·자기 장비는 본인이 정확히 안다(R2 결정과 같은 까닭). 표가 한 곳(`doctrine/*.ts`)에 모인다. 시그니처가 진실을 받지 않는다 | 걸리는 자리가 넷이라 충돌 규칙이 필요하다(2.6) |

**결정: (다).** 교본은 `doctrine.ts` 의 순수 함수가 `DocCtx` 하나만 보고 판정하고, 그 결과를 아래 네 자리가 쓴다. 그리고 지휘관·관제의 교본은 이미 정보 격리가 걸린 두 자리(`orders/`, `dispatch/`)에 둔다.

| 자리 | 묻는 것 | 부르는 곳 | 줄이 내는 것 | 이 자리를 고른 까닭 |
|---|---|---|---|---|
| ① `fit` — 누가 맡는가 | "이 대원이 이 일을 맡아도 되는가, 얼마나 먼저인가" | `agents.fitFor` 의 **맨 끝**(R1 의 역할 선호 다음): `fit = docFit(sim, s, a, w, fit)`. **늘 보고 모드**(2.4 — `fitFor` 는 남에게도 불린다) | 배율(`fitMul`, 0 = 금지)·가산(`fitAdd`). `drop` 표시가 있는 금지는 하던 임무도 놓게 한다(`docDrop`, 2.6) | 지휘관의 배정(`commander.assign`)과 대원의 자체 판단(`brain` 7번)이 **둘 다** `fitFor` 를 쓴다. 한 곳에 걸면 "다친 대원은 가벼운 일로", "짝 없이 위험 실내 금지"가 지휘관 지시에도 자체 판단에도 똑같이 걸린다. 맡을 사람이 없으면 B3 의 "맡을 사람이 없는 작업" 블록(R1 `anyCapable`)이 그대로 지원을 부른다 |
| ② `duty`·`act` — 지금 무엇을 하는가 | "작업판의 일 말고, 내 상태 때문에 지금 해야 할 행동이 있는가" | `brain.think`: 의무(`docDuty`)는 X6 의 `evacuate` 의무 바로 뒤, 점수 후보(`docAct`)는 R1 의 공기통 교체 후보 다음, 후퇴 후보의 바꿔 끼우기(`docRetreat` — P11)는 후퇴 후보를 만드는 자리. **자기 모드** | 상태 행동 하나(`DocActId`)와 점수 | 지금도 상태 행동(후퇴·휴식·예비 펌프·공기통 교체)은 모두 `brain` 의 후보다. 같은 틀에 넣어야 판단 오차·계속 점수·지시와 같은 저울에 오른다 |
| ③ `method` — 어떻게 하는가 | "이 임무를 어떤 방법으로" | R2 의 `chooseMethod` 점수에 `× docMethodMul(dc, m)`(R2 §3.2 의 마지막 인자 `dc`). 실행부의 `startMethod`·`recheckOnArrive`·`switchMethod`(t ≠ null)는 자기 모드 `docCtx(…, 'self')` 를 만들어 넘기고, `methodFit`(t = null — `fitFor(waterRescue)` 등 남에게도 불린다)은 **인자를 그대로 두고 안에서** 보고 모드 `docCtx(…, 'report', w)` 를 만든다(그래서 `fitFor`·B3 `anyCapable` 은 고치지 않는다). `chooseMethod` 는 받은 `dc` 를 고치지 않고 `{ ...dc, m: { reach, flow, weak } }` 사본으로 `docMethodMul` 을 부른다 | 방법별 배율(0 = 후보에서 뺀다) | R2 가 "R3 는 METHOD 행과 situ 조건을 늘린다, 상태는 `MethodCtx` 에 칸을 더한다"고 정했다. 방법을 바꾸는 때(실패·고장·조건 상실)·기억·기록은 R2 의 것을 그대로 쓴다 |
| ④ `gate` — 실행 중의 판단 지점 | "지금 이 한 걸음(혼자 방에 들어가기, 흉기 상대에게 붙기, 처치 중인 환자 들기)을 해도 되는가" | 실행기의 그 분기에서 `docGate(sim, s, a, gate, sense)`. **자기 모드** | `{ ok, rule, wait, opt }` — 막히면 실행기가 정해진 대체 행동(그 자리에서 기다림·거리 유지)을 한다 | 이 결정들은 지금 실행기의 분기 안에 있다(`executor` `case 'engage'` 의 "4초 뒤 혼자 진입", `case 'arrest'` 의 "곧장 다가가 제압"). 분기를 판단부로 옮기면 실행 코드가 둘로 갈라진다. 대신 **판단(믿음)은 교본 함수가, 효과(이동·기다림)는 실행기가** 한다 — R2 의 `chooseMethod`/`methodRun` 나눔과 같다 |
| ⑤ `cmd` — 지휘관 | 무엇을 요청하고 무엇을 거두는가 | `orders/doctrine.ts`(`registerOrders`) + `commander.ts` 의 작은 조각 몇 곳(6.1 끝) | 요청·작업·배정 가산 | 지휘 규칙 파일은 이미 "믿음만"이 테스트로 걸려 있다 |
| ⑥ `dispatch`·`chase` — 관제 | 어느 부대를 보내고 추격에서 누가 무엇을 하는가 | `dispatch/doctrine.ts` 를 `dispatcher.pickUnit`·`analyst` 수요·`pursuit.tickPursuits` 의 "알려진 위치로 방향을 바꾼다" 줄이 부른다 | 점수 가산·수요 보정·역할 | 관제 코드(`dispatch/*`)는 이미 진실 금지 구역이다 |

**네 자리가 서로 대신하지 않는 까닭**: ①만으로는 "이미 맡은 일을 하다가 공기가 떨어졌다"를 다룰 수 없다(②). ②만으로는 지휘관이 다친 대원에게 진입을 지시하는 것을 막을 수 없다(①). ③은 일 안의 갈래다. ④는 한 임무 안의 한 걸음이다 — `fit` 을 0 으로 만들면 대원이 일을 놓고 지휘관이 다시 배정하는 왕복이 생기지만, 판단 지점에서 기다리게 하면 임무를 쥔 채 멈춘다.

### 2.4 판단 입력 `DocCtx` — 두 모드, 읽어도 되는 것과 안 되는 것

```ts
// doctrine/registry.ts (타입만)
export interface DocState {          // 대상 대원 (자기 모드 = 자기 몸, 보고 모드 = 남이 아는 만큼 — 아래 표)
  hp: number; band: number; bleeding: boolean;
  stamina: number; fitness: number; composure: number; experience: number; judgment: number; teamwork: number;
  rookie: boolean; veteran: boolean;             // experience < 0.3 · ≥ 0.7
  hasScba: boolean;                              // scba 를 들었다 (알려진 고장 제외 — gear.kitHas). 공기 잔량과 따로다
  air: number;                                   // 공기 비율 0..1 = gear.kitQty(scba) / sim.tune.airFull. scba 가 없으면 1
  spareAir: number;                              // 자기 부대의 예비 공기통
  gun: KitId | null;                             // 가진 총 (gear.gunOf — sniper > rifle > pistol, G5 weaponOf 와 같은 순서)
  ammo: number; mag: number; magSize: number; perShot: number;   // 그 총의 탄 (총이 없으면 ammo = -1)
  ammoLow: boolean; ammoCrit: boolean;           // 마지막 탄창 / 발사 2회 이하
  reloading: boolean; ammoBox: number;           // 재장전 중 / 자기 부대의 탄약 상자
  shaken: boolean; underFire: boolean; inCover: boolean; carrying: boolean;
  buddy: FieldAgent | null; buddyNear: boolean;  // 짝 (5절 — 쓸 수 있는 짝만), 짝이 2.5칸 안
  mates: number;                                 // 같은 Dept 의 다른 활동 대원 가운데 6칸 안의 수
  alone: boolean;                                // buddy === null && mates === 0
  backup: boolean;                               // 같은 Dept(또는 그 일을 할 수 있는) 부대가 이 사건으로 오는 중 (I.assigned · u.state — 조직 정보)
}
export interface DocSit {            // 상황 (믿음·생김새·공개 지휘 상태)
  kind: IncidentType; label: string;             // 유형, 관제의 이름표 (I.assessment 의 시나리오 이름 — 변형의 진실이 아니다)
  phase: DocPhase;                               // 아래 표
  hot: boolean; outdoor: boolean; secure: boolean;
  threat: { id: number; x: number; y: number; d: number; weapon: 'gun' | 'knife' | 'none'; state: string; hostage: boolean; facing: number } | null;   // 믿음 속 가장 가까운 활동 용의자
  civAtRisk: boolean;                            // 믿음: 위협 2칸 안에 살아 있는 구조 대상, 또는 교전 중 총기 용의자와 같은 구역의 구조 대상·인질의 band ≥ 1
  inHazard: boolean;                             // 자기 자리가 위험 건물 실내 (fitFor 의 fireRisk 와 같은 믿음 판정)
  victimInside: boolean;                         // 믿음: 위험 건물 안에 살아 있는 구조 대상, 또는 신고 인원(occ) > 찾은 수
  danger: number;                                // X6: 믿음 ops 사실의 자기 구역 단계 (X6 가 없으면 0)
  wDanger: number;                               // X6: 대상 작업 w 의 구역 단계 (w 가 없거나 구역이 없으면 danger 와 같다) — F13
  ctlDone: boolean[];                            // 통제 지점별 교통 통제 끝 (ctl 사실)
  liveBomb: { x: number; y: number; d: number } | null;   // 믿음 haz bomb active
  defusing: boolean;                             // 동료의 겉: 누군가의 defuse 임무가 장치 곁(2칸)에서 진행 중 — S08·CS1
  patients: number;                              // 믿음: 처치·탑승을 기다리는 band ≥ 1 구조 대상 수
  seatsLeft: number;                             // 현장 부대의 남은 환자 자리 합 (R2 gear.seatsLeft — 조직 정보)
  negotSec: number; entryOrdered: boolean;       // s.negotStart 부터, s.entryOrdered (공개 지휘 상태)
  lanes2nd: boolean;                             // 이 현장 기록에 2차 사고가 있었다 (I.problems 의 SECONDARY_COLLISION — 지휘관 코드가 인질 부상을 I.problems 로 아는 것과 같은 자격) — P20
}
export type DocPhase = 'arrive' | 'sizeup' | 'standoff' | 'entry' | 'assault' | 'interior' | 'care' | 'transport' | 'traffic' | 'withdraw' | 'idle';
export interface DocCtx {
  sim: Sim; s: Scene; a: FieldAgent; u: Unit; dept: DocDept; role: RoleId | null; group: RoleGroup | null;
  mode: 'self' | 'report';                       // 자기 모드(대원 자신의 판단 ②·④·③의 실행부) / 보고 모드(① fit · ③의 methodFit — 남에게도 불린다)
  w: WorkItem | null;                            // ①·④ 의 대상 작업 (없으면 null)
  st: DocState; sit: DocSit;
  sense: Sense;                                  // R2 의 Sense — 대원이 선 칸의 연기·열 (부르는 쪽이 잰다. 보고 모드에서는 0)
  dng: number;                                   // brain 의 위험 점수 (② 자리에서 brain 이 넘긴다. 다른 자리에서는 0)
  has: (id: KitId) => boolean;                   // gear.kitHas — 들었는가 (알려진 고장 제외, 수량 무관). kits·noKits 가 이것으로 본다
  kit: (id: KitId) => number;                    // gear.kitCount (R2 — scba 는 0/1, 수량 장비는 남은 수). 수량을 보는 when 이 쓴다
  m?: { reach: number; flow: number; weak: boolean; tile: number };      // ③ 방법 자리: R2 chooseMethod 가 MethodCtx 를 만든 뒤 dc 의 사본에 채운다 (부르는 쪽은 채우지 않는다 — R2 §3.2). tile = 문·잔해 대상의 칸(R2 MTarget.tile, 없으면 -1) — S26 이 쓴다
}
// doctrine.ts
export function docCtx(sim: Sim, s: Scene, a: FieldAgent, mode: 'self' | 'report', w: WorkItem | null = null, sense: Sense = ZERO_SENSE, dng = 0): DocCtx;
```

| `DocPhase` | 정하는 법 (`phaseOf(s, a)` — 자기 임무와 공개 지휘 상태) |
|---|---|
| `arrive`·`sizeup` | 도착 뒤 첫 판단 전 / `sizeup` 임무 |
| `standoff` | `negotiate`·`perimeter` 임무, 또는 흉기·맨손 용의자의 `arrest`(`fight` 상대 — 투항한 사람의 검거는 `idle` 과 같게 본다) |
| `entry` · `assault` | `engage` 이고 `s.entryOrdered` 이며 출입구 앞 / 출입구를 지난 뒤. (도주 용의자 추격의 `engage` 는 `assault`) |
| `interior` | 위험 건물 실내의 `search`·`suppress`·`extricate`·`carry`·`escort`·`mitigate`·`overhaul`, 그리고 `pair` |
| `care` · `transport` | `treat`·`treatMate`·`triage` / `load`·`board(transport)` |
| `traffic` | `traffic`·`clearRoad` |
| `withdraw` | `retreat`·`evacuate`·`airOut`·`pairOut`·`board` |
| `idle` | 임무 없음·`standby`·`cover`·`rearm` |

`arrive`·`sizeup`·`transport`·`idle` 을 조건으로 쓰는 줄은 없다 — 이 넷은 `split`(8.2)의 열쇠에만 쓰인다.

**두 모드 — 같은 대원의 상태를 누가 묻는가(결정)**. `fitFor(sim, s, b, w)` 는 지휘관이 **다른 대원** `b` 에게도 부른다(`commander.assign`). R2 의 `methodFit` 도 `fitFor(waterRescue)` 를 거쳐 남에게 불린다. 여기서 `b` 의 체력을 읽으면 H1 이 막은 "함수 호출 안에 숨은 진실 읽기"가 된다. 그래서 `DocState` 를 만드는 함수를 둘로 나눈다:

| 칸 | 자기 모드 `stateSelf(sim, s, a)` | 보고 모드 `stateReported(sim, s, b)` |
|---|---|---|
| `band`·`shaken` | 자기 몸: `bandHyst(r.health, 지난 값)`, `a.shaken > sim.t` | **`b` 의 `crew` 사실**(`b.beliefs.val('crew', b.rid)` — 자기 신고, 4.1). 없으면 0·false |
| `hp`·`bleeding` | 자기 몸(`r.health`·`r.bleed ≥ 0.06`) | `-1`·`false` — **보고 모드에서 쓰지 않는다**(fit·methodFit 자리의 줄은 이 둘을 읽지 않는다. 시험 3) |
| `stamina` | 자기 몸 | **조직 정보** — 지금 `commander.assign`(점수·휴식 중 건너뛰기)과 `dispatcher.pickUnit`(평균 지구력)이 이미 읽는 값과 같은 자격이라고 명시한다. G03 이 이 값을 쓴다 |
| `air`·`hasScba`·`spareAir`·총·탄·`ammoBox` | `gear.kitHas`·`kitQty`·`gunOf`, 부대 칸 | 같다 — R1 이 공기·섬광탄 잔량을 조직 정보로 정한 것과 같다 |
| `underFire`·`inCover`·`reloading` | `a.underFireT`(3초)·`a.inCover`·`a.reloadUntil > sim.t` | `false` — 남의 몸이 지금 맞고 있는지는 모른다 |
| `carrying` | `a.carrying !== -1` | 같다 — 동료의 겉(업고 있는 것은 보인다) |
| 능력치(`composure`·`experience`…) | 명부 | 명부 |
| `buddy`·`mates`·`alone`·`backup` | 동료의 겉·조직 정보 | 같다 |

- 자기 신고를 쓰는 까닭: 대원은 자기 몸이 문턱을 넘을 때 그 사실을 자기 믿음에 넣고 무전으로 보낸다(`selfReport`, 4.1). 지금 `fitFor` 가 이미 `b.beliefs` 의 구조 대상 위치를 읽는 것과 같은 길이고, 판단 주기만큼의 지연이 생긴다(의도 — 지휘관이 알게 되는 데 걸리는 시간). 대원 자신이 자기 일을 고를 때(`brain` 7번 자체 판단·지시 수행)도 `fitFor` 를 거치므로 보고 모드다 — 자기 신고는 판단마다 갱신되므로 차이는 한 판단 주기뿐이다.
- `mate` 사실(H1)을 쓰지 않고 새 사실 종류를 두는 까닭: H1 의 `orders/injury.ts` 는 `mate` 사실이 `hurt` 이고 `band ≥ 1` 이면 `treatMate` 를 낸다. 아직 일하고 있는 중상 대원을 `mate` 로 신고하면 구급대원이 움직이는 대원을 쫓아다니게 된다. (H1 도 같은 까닭으로, 처치 뒤 가벼운 일로 돌아온 대원은 `mate` 사실을 `'light'` 로 바꿔 `treatMate` 의 대상에서 뺀다 — H1 §3.6a.)

**판단부(`doctrine.ts`·`doctrine/*.ts`)가 읽어도 되는 것**:
- 그 대원의 믿음 `a.beliefs`(구조 대상·용의자·불·위험 사실, 동료의 `crew`·`mate` 사실, X6 의 `ops` 사실, `occ`·`ctl`·`secure` 사실).
- 현장의 생김새: `s.tiles`·`s.region`·`s.regions`·`s.exits`·`s.spots`·`s.staging`·`s.safe`·`s.kind`·`s.rules`·`s.outdoor`·`s.controlPts`·`s.laneRows`·`s.stairTo`(R2 와 같은 자격).
- 공개 지휘 상태: `s.secureAt`·`s.entryOrdered`·`s.negotStart`·`s.entryExit`·`s.entryExit2`·`s.breachAt`·`s.breachDone`·`s.triageAt`, `sim.t`, `sim.weather`, `sim.disaster` 의 `kind`·`phase`, 현장 기록의 문제 코드(`I.problems` 의 `code` — 지휘관 코드가 이미 읽는다).
- 조직 정보: 부대 상태 `sim.units`(장비 수치·`spareAir`·`ammoBox`·`sparePump`·`state`·`patients`·`boardOrder`·`estArrive`), `I.assigned`, 명부(감싼 함수 `gear.roleIdOf`·`groupOf` 와 `sim.responders[rid]` 의 `name`·`dept`·`unitId`·능력치·`stamina`), 동료의 장비(`gear.kitHas`·`kitCount`·`kitQty`·`gunOf`).
- 동료의 겉: `s.agents` 의 `status`·`task.kind`·`task.workId`·`task.cas`·`task.gateAt`·`x`·`y`·`buddy`·`carrying`(같은 무전망 — R2 와 같은 자격).
- **자기 몸**(자기 모드에서만, `stateSelf` 안에서만): `sim.responders[a.rid]` 의 `health`·`bleed`(H1 의 `hurtF`·`bandOf` 도 자기 몸에만), `a.underFireT`·`a.inCover`·`a.shaken`·`a.reloadUntil`·`a.task`·`a.docMem`.
- 감각 `Sense`: 부르는 쪽이 **대원이 선 칸에서** 잰 연기·열(`brain.dangerScore` 가 자기 둘레의 `s.fire` 를 읽는 것과 같은 자격 — R2·X6 와 같은 판단).

**읽으면 안 되는 것**(테스트가 글자와 행동으로 검사한다 — 10절 1·3): `s.props`, `s.propAt`, `s.casualties`, `s.hostiles`, `.truth`, `.pursuit`, `s.fire[`, `s.smoke[`, `sim.scenes`, `s.variant`, `.fault`, `kitWorks`, `useKit`, `toolUse`, `needsHospital`. 그리고 **남의 몸** — `.health`·`.bleed`·`.injuries` 는 `stateSelf` 한 함수 안에만 나온다(글자 시험), 그리고 `b` 의 체력·출혈을 바꿔도 새 `crew` 사실이 없으면 `docFit`·`fitFor` 가 그대로다(행동 시험). 명부·짝의 역할·장비를 `sim.responders[b.rid]`·감싼 함수로 읽는 것은 허용한다(그래서 "`sim.responders[` 는 `a.rid` 꼴만" 같은 글자 규칙은 두지 않는다).

**import**: `doctrine.ts` 는 `agents.ts`·`executor.ts`·`hazards.ts`·`methods.ts`·`methodRun.ts`·`doctrineRun.ts`·`crews.ts` 를 **값으로** import 하지 않는다(`agents.fitFor` 와 R2 `methods.chooseMethod` 가 `doctrine.ts` 를 부르므로 순환을 만들지 않는다). `import type`(예: R2 `methods.ts` 의 `Sense`·`MTarget` — R2 가 export 하는 타입. `MethodCtx` 는 export 하지 않는다)은 된다 — 컴파일 뒤 지워지므로 순환이 아니다. import 해도 되는 값: `grid.ts`(`staticPass`·`losWalls`·`tileOf`), `util.ts`, `gear.ts`(판단용 — R2 의 `kitCount`·`kitName`·`seatsLeft` 와 R3 가 더하는 `kitHas`·`kitQty`·`gunOf`·`roleIdOf`·`groupOf`·`crewHas`), H1 `injury.ts` 의 `bandOf`·`hurtF`(잎 모듈), `doctrine/registry.ts`.

**R3 가 `gear.ts` 에 더하는 판단용 감싼 함수**(R1 `crews.ts` 를 감싼다 — `doctrine.ts` 가 `crews.ts` 를 직접 부르지 않게. R2 의 `kitCount('scba')` 는 60초를 넘는지만 0/1 로 돌려주므로 공기 비율·짝의 공기·총의 탄을 구할 수 없다):

| 함수 | 몸 | 쓰는 곳 |
|---|---|---|
| `kitHas(sim, rid, id): boolean` | R1 `hasKit`(알려진 고장이면 false, 수량 무관) | `DocCtx.has` — 줄의 `kits`·`noKits`, `st.hasScba` |
| `kitQty(sim, rid, id): number` | `kitHas ? kitUses : 0` (scba 는 남은 초, 총기는 가진 탄) | `st.air`, 짝의 공기(`buddyOf`), CF2 |
| `gunOf(sim, rid): { id: KitId; ammo: number; mag: number; magSize: number; perShot: number; reload: number } \| null` | 가진 총 가운데 `sniper` > `rifle` > `pistol` 첫째(G5 `weaponOf` 와 같은 순서), `KITS[id]` 의 `mag`·`perShot`·`reload`, 항목의 `uses`·`mag` | `st.ammo…`, CP1·CP3 |
| `roleIdOf(sim, rid): RoleId \| null` · `groupOf(sim, rid): RoleGroup \| null` | R1 `roleOf(sim, rid).id` / `.group` | `docDeptOf`·줄의 `who`·`SOLO_OK`·`PAIRS` |
| `crewHas(sim, u, id): boolean` | R1 `crewHasKit(sim, u, id, true)`(알려진 고장 제외) | `outsideWatch`(5.6)·CF4·CF5 — 부대에 그 장비를 든 사람이 있는가(조직 정보) |

**중상의 간격**: `st.band` 는 자기 모드에서 `bandHyst(hp, prev)` 로 만든다: `const b = bandOf(hp); return b === 0 && prev >= 1 && hp < 75 ? 1 : b;` — H1 의 `bandOf` 경계(`> 70` 이면 0, `> 40` 이면 1, `≤ 40` 이면 2)를 그대로 두고, 0 으로 내려오는 쪽에만 75 의 간격을 얹는다(4.2). `prev` 는 지난 자기 신고의 값(`a.crewSig` 에서 읽는다). 보고 모드는 신고된 값을 그대로 쓴다.

**성능**: `fitFor` 는 배정 반복(대원 × 작업)과 판단 주기마다 불린다. `DocState`·`DocSit` 은 `WeakMap<FieldAgent, { tick: number; self: DocState | null; rep: DocState | null; sit: DocSit | null }>` 에 **모드별로 따로** 틱마다 한 번 계산해 담는다(같은 틱에 지휘관이 보고 모드로, 본인이 자기 모드로 부를 때 서로 덮어쓰지 않게). 담는 것에는 `sense`·`dng`·`w` 처럼 부르는 쪽이 넘기는 값을 넣지 않는다 — 그것은 `DocCtx` 의 칸이다(넣으면 `fitFor` 가 먼저 0 으로 채운 값을 brain 이 읽어 P11 이 틀린다). 줄 목록은 처음 쓸 때 `(hook, work)` 별로 나눈 표(`Map`)로 만든다. `coverSpot` 은 임무에 담아 두고 다시 고르는 조건에서만 부른다(2.10).

### 2.5 등록 — `registerDoctrine`

```ts
// doctrine/registry.ts — 잎 모듈 (타입과 배열뿐. doctrine.ts 가 이것을 import 하고, 줄 파일도 이것만 import 한다 —
//   줄 파일이 doctrine.ts 를 import 하면 doctrine.ts → 줄 → doctrine.ts 순환에서 배열이 초기화되기 전에 불린다)
/** 효과 하나. fit·method 효과는 자기 works·methods·when 을 더 가질 수 있다 (한 줄이 일마다 다른 배율을 줄 때 — 예: P12 "engage ×0.35, perimeter +0.15") */
export type DocEffect =
  | { kind: 'fitMul'; mul: number; works?: WorkKind[]; when?: (c: DocCtx) => boolean; drop?: boolean }   // 곱한다. 0 = 그 일을 맡지 않는다. drop = 하던 그 임무도 놓는다 (2.6 docDrop). mul 1 = 기록 전용
  | { kind: 'fitAdd'; add: number; works?: WorkKind[]; when?: (c: DocCtx) => boolean }                   // 0 이 아닐 때만 더한다 (선호가 자격을 만들지 않는다 — R1 6.2 끝과 같다)
  | { kind: 'duty'; act: DocActId }                                  // 의무 — 점수 없이 그 자리에서 바꾼다
  | { kind: 'act'; act: DocActId; score: number | ((c: DocCtx) => number) }
  | { kind: 'methodMul'; mul: number; methods?: MethodId[]; when?: (c: DocCtx) => boolean }              // R2 방법 점수에 곱한다. 0 = 후보에서 뺀다
  | { kind: 'block'; maxWait: number | ((c: DocCtx) => number) }    // 판단 지점에서 막는다. maxWait 초가 지나면 timeout 갈래 (4.4)
  | { kind: 'choose'; opt: 'cover' | 'save' | 'stack' | 'immobilize' };   // 판단 지점에서 막지 않고 갈래만 고른다 (엄폐 사격 자리 · 섬광탄 아끼기 · 줄 서기 · 척추 고정)
export interface DoctrineRule {
  id: string;            // 'P07' — 표 글자 + 번호. 한 줄이 두 자리에 걸리면 같은 번호에 글자를 붙여 따로 등록한다('F04'·'F04b'·'F04c'). 측정·보고서는 번호(앞 세 글자)로 묶어 센다
  dept: DocDept;         // 어느 표의 줄인가
  name: string;          // 패널 이름 ('혼자 방 진입 금지')
  short: string;         // 요약 줄의 짧은 이름 ('단독 진입 보류')
  who?: { dept?: Dept[]; doc?: DocDept[]; roles?: RoleId[]; groups?: RoleGroup[]; units?: UnitKind[] };   // 없으면 누구나. 칸끼리는 그리고(AND)
  hook: DocHook;
  swap?: 'retreat';      // act 줄 가운데 docAct 후보가 아니라 후퇴 후보를 바꿔 끼우는 줄 (P11 — docRetreat 가 본다)
  works?: WorkKind[];    // fit·method·gate: 이 임무만 (없으면 모두). 효과의 works 는 그 안에서 더 좁힌다
  gate?: DocGateId | DocGateId[];   // gate 줄의 판단 지점 (P07 은 roomEntry·breach 둘)
  methods?: MethodId[];  // method 줄이 배율을 주는 방법 (효과의 methods 가 있으면 그것)
  kits?: KitId[];        // 이 가운데 하나라도 쓸 수 있어야 걸린다 — usable(id) = c.has(id) && (scba 이거나 수량이 없는 장비 || c.kit(id) > 0).
                         //   scba 는 들었는지만 본다(남은 공기는 when 이 st.air 로 — R2 의 kitCount('scba') 는 60초에서 0 이 되므로 쓰지 않는다)
  noKits?: KitId[];      // 이 가운데 아무것도 쓸 수 없어야 걸린다(같은 usable) — 장비 조건을 when 과 따로 두어 '장비 때문에'를 센다 (7.3 의 noKit 까닭). 다 쓴 테이저도 '없음'이다
  when: (c: DocCtx) => boolean;      // 상황·상태 술어. DocCtx 만 읽는다. 예외는 여기에 넣는다 (2.6)
  effect: DocEffect | DocEffect[];   // 같은 자리의 효과 여럿 (fitMul·fitAdd 를 함께, methodMul 을 방법마다)
  th?: Record<string, number>;       // 문턱 상수 (when 이 읽는 수를 여기에 두어 표·패널·테스트가 같은 값을 본다)
  rank: 0 | 1 | 2 | 3;               // 0 생명 · 1 보호 · 2 짝·지원·절차 · 3 장비·효율 (2.6)
  why: DocWhy;
  note?: string;                     // 기록 문구 템플릿 ({name}·{mate}·{n}·{s}) — 없으면 기록 없이 센다
  report?: string;                   // 보고서 문장 템플릿 (7.3) — 없으면 보고서에 싣지 않는다
}
export const DOCTRINE: DoctrineRule[] = [];
export function registerDoctrine(...rules: DoctrineRule[]): void { for (const r of rules) DOCTRINE.push(r); }
/** 지휘·관제·추격 줄의 이름표 (코드는 orders/doctrine.ts · dispatch/doctrine.ts · orders/catastrophe.ts 에 있다. 기록·측정만 이 표로 이름을 찾는다) */
export const CMD_ROWS: { id: string; dept: DocDept; hook: 'cmd' | 'dispatch' | 'chase'; name: string; short: string; why: DocWhy }[] = [];
```

- `docGate(sim, s, a, gate, sense, see?)` 의 `see` 는 실행부가 시야 안에서 잰 것(`{ stunned?: boolean }` — 용의자가 무력화되어 있는 것이 보인다. `perceive` 와 같은 자격)이고, 돌려주는 값은 `{ ok: boolean; rule: string | null; wait: number; opt: string | null }`(`wait` = 막힌 줄들의 `maxWait` 가운데 가장 긴 값).
- 줄 파일 다섯은 `field/doctrine/index.ts` 가 `common → police → fire → ems → special` 순서로 import 하고, `field/scenes/index.ts` 끝에 `import '../doctrine/index';`·`import '../orders/doctrine';` 두 줄(R1 의 `rules/air`·X6 의 `rules/catastrophe`·R2 의 `rules/methods`·`orders/methods` 다음)을 더한다. `sceneManager` 가 `scenes/index` 를 import 하므로 첫 현장 전에 등록이 끝난다.
- **등록 순서가 결과를 바꾼다**(같은 순위의 줄끼리 먼저 등록된 줄이 이긴다 — 2.6). 그래서 CLAUDE.md 의 "시나리오의 순서" 함정처럼, 줄 파일의 순서를 바꾸지 않는다. 새 줄은 파일 끝에 붙인다. 각 파일 안의 순서는 3.6 표의 순서(번호 순)다.
- 테스트 하나가 모든 줄을 훑어 본다: `id` 가 겹치지 않고, `hook` 에 맞는 `effect`·`gate`·`works` 칸이 있고, `note` 의 자리표시자가 알려진 것뿐이다(10절 8).

### 2.6 우선순위와 충돌

**판단 순서**(`brain.think` — 앞이 이긴다. R1·H1·X6·R2 가 정한 자리에 R3 를 끼운다):

```
perceive → R3 selfReport (몸 상태가 문턱을 넘었으면 crew 사실 — flushOutbox 보다 먼저 두어 같은 판단에 무전이 나간다. 4.1)
→ shareNearby → flushOutbox → (지휘관이면 commanderThink)
0) R3 rebuddy (짝을 잃었으면 다시 맺는다 — 5.3)
1) 철수·이송 지시 boardOrder                         (지금)
2) R2 물 위 가드                                       (R2 §3.5)
3) X6: if (cur.kind === 'evacuate') return; 철수 명령·자기 조짐 3 의무 → evacuate      (X6 §5.1)
4) R3 의무: if (cur.kind === 'airOut' || cur.kind === 'pairOut') return; docDuty → airOut / pairOut
   R3 놓기: docDrop — 지금 임무에 drop 표시 금지가 걸리면 finishTask(…, false, 'doctrine') 하고 아래로 (아래 끝)
5) 점수 후보: 후퇴(dangerScore — 후보를 만들 때 docRetreat 가 P11 이면 엄폐로 바꿔 끼운다) · 현재 임무 계속 · 지휘관 지시 · 장비 문제 ·
   R1 공기통 교체(R3 가 문턱 하나를 더한다 — F03) · **R3 교본 행동 하나(docAct)** · 휴식 · 무전 · 자체 판단 · 대기
6) 판단 오차 → 가장 높은 것
```

- **의무끼리**: 철수·이송 > 물 위 > X6 철수 > R3 공기 탈출 > R3 짝 따라 나가기. 업고 있는 대원(`a.carrying !== -1`)에게는 R3 의 의무가 걸리지 않는다 — 그 운반이 곧 밖으로 나가는 길이다(X6 와 같은 판단, G07).
- **같은 자리의 줄끼리**:
  - `fit`: 걸리는 모든 `fitMul` 을 곱하고(하나라도 0 이면 0 — **금지가 선호를 이긴다**), 그 값이 0 보다 크면 `fitAdd` 를 모두 더하고 `max(0.02, …)` 로 자른다(R1 의 역할 선호와 같은 규칙). 예외(구조 대상이 있으면 2인 대기조 없이 진입 등)는 따로 "허락" 줄을 두지 않고 **금지 줄의 `when` 안에** 넣는다 — 허락이 금지를 덮는 규칙을 두면 순서에 따라 결과가 갈린다. 같은 뜻의 줄이 분야마다 있을 때(부상 — P12·F14·E11·G01)는 `who.doc` 로 겹치지 않게 가른다(한 대원에게 둘이 걸리지 않는다).
  - `fitMul` 이 0 보다 크게 키우지 못하고 `fitAdd` 가 0 에서 자격을 만들지 못하므로, **교본은 기본 자격을 열지 못한다**. 기본 자격 자체를 바꾸는 것(E05 의 경계 밖 처치, S06 의 로봇 해체)은 `fitFor` 의 그 `case` 를 고치는 것으로 하고(11.1), 교본 줄은 기록·까닭만 맡는다(`fitMul 1` — 기록 전용 줄).
  - `duty`·`act`: 걸리는 줄 가운데 `rank` 가 가장 작은 것 하나, 같으면 등록 순서. **한 판단에 교본 후보는 하나만** 낸다(여럿을 내면 판단 오차 한 번이 교본끼리의 순서를 뒤집는다). 경찰의 행동 줄끼리의 순서는 3.6 표 끝에 따로 적었다.
  - `method`: 걸리는 `methodMul` 을 모두 곱한다(0 = 후보에서 뺀다). R2 의 `noGear` 까닭 계산(장비를 빼고 다시 셈)에도 교본 배율은 그대로 곱한다.
  - `gate`: 막는 줄이 하나라도 있으면 막힌다. 알리는 문구는 `rank` 가 가장 작은 줄의 것. `choose` 줄은 막지 않고 `opt` 만 돌려준다.
- **지휘관 지시와 교본**: 교본은 지시를 "거절"하지 않는다. 지휘관이 맡길 수 없게(`fit` 0) 하거나, 맡은 대원이 판단 지점에서 기다리게(`gate`) 할 뿐이다. 기다림은 상한이 있고(4.4) 상한이 지나면 지금 동작으로 가거나 임무를 놓는다 — 지휘관은 작업의 `status` 변화를 보고 다시 배정한다.
- **교본 임무 중인 대원을 지휘관이 빼 가지 않는다**: `commander.assign` 의 후보 반복에 지금의 휴식 건너뛰기(`b.task.kind === 'rehab' && stamina < 40`) 옆에 한 줄 — `cover`·`rearm`·`airOut`·`pairOut` 중인 대원, 그리고 짝이 위험 실내에 있는 동안의 `pair` 대원은 건너뛴다. 이 임무들은 짧고(엄폐 12초 상한, 보급·탈출은 대기 지점까지) 스스로 끝나며, 지금 `hasWork → curPr 0.6` 으로 보면 우선도 0.82 이상의 지시가 엄폐 중인 대원을 빼 와 엄폐 → 교전 → 엄폐로 왕복한다. 짝 동행을 빼 가면 2인 진입이 안에서 깨진다.
- **놓기 `docDrop`**: `fit` 0 은 새로 맡는 것만 막는다 — 지금의 계속 점수(`0.5 + 0.4p + 0.08`)는 `fitFor` 를 보지 않는다. 그래서 하던 임무를 놓아야 하는 금지(`drop: true` — P09·P22 의 총기 상대 `engage`·`perimeter`)는 판단마다 지금 임무의 작업에 대해 보고 모드의 그 줄만 다시 보고, 0 이면 `finishTask(sim, s, a, false, 'doctrine')`(실패 기록·`w.fails`·`holdUntil` 없음 — 11.1 의 사유 표) 후 `recordDoc`. 기록 문구는 그 줄의 `note`(한 번).
- **X6 와 교본**: X6 의 위험 구역 문(`registerGate`)·`fitFor` 안전망·`agentCost` 가 먼저 막는다. 교본은 그 안에서 더 좁히기만 한다(교본이 X6 의 금지를 푸는 길은 없다).
- **R2 의 실패 기억과 교본의 기억**: 따로 둔다. `a.mfail` 은 방법, `a.docMem` 은 교본 줄. 교본이 방법을 막아(`methodMul 0`) 고를 것이 없으면 R2 의 넓히기 규칙(② `mfail` 무시)은 교본 배율을 무시하지 않는다 — 선택 임무는 방법 없이 지금 코드로, `waterRescue` 는 `methodFit` 0 → 맡지 않는다. **예외 — 진압**: 교본이 `interior` 를 빼서(F03b·F04b·F05b) 생긴 null 은 지금 코드(= 내부 공격)로 가지 않는다. 그때는 R2 의 `defensive` 가 후보가 되도록 그 `can` 에 "또는 `docMethodMul(c.dc, 'interior') === 0`" 조각을 더한다(3.7·11.1, R2 §4.5). 그래서 짝·대기조 없는 대원이 실내 진압으로 들어가다 판단 지점에서 기다리고 놓는 순환이 생기지 않는다.

### 2.7 기록 (규칙 5 — 상태를 바꾸는 바로 그 코드에서)

| 언제 | 어디서 | 무엇을 | 예 |
|---|---|---|---|
| 몸 상태가 문턱을 넘었다 | `doctrineRun.selfReport`(자기 믿음에 `crew` 사실을 넣는 그 자리) | `learn` — 무전 문구는 그 사실의 글(`flushOutbox` 가 보낸다). 공기 위급·탄 위급·중상은 즉시·중요로 보낸다(4.1). **글은 사실만 쓴다** — 하지 않을 수도 있는 행동("돌리겠습니다", "빠집니다")을 말하지 않는다(fit 은 지금 임무를 놓게 하지 않는다. R1 §9 가 '교체하러 나갑니다'를 피한 것과 같은 까닭, 규칙 5) | "이서준: 공기 30% 미만." · "김도윤: 부상 — 체력 저하." · "박하준: 탄약 소진." |
| 의무·교본 행동을 정했다 | `brain` 의 의무 자리 / 후보의 `apply` | `emit(role 'RESPONDER', kind 'action', imp 1)` 줄의 `note`, `recordDoc` | "공기 30% 미만 — 박서윤, 같이 나간다." |
| 판단 지점에서 처음 막혔다 | 실행기의 그 분기(`t.gateAt` 을 정하는 그 줄) | `!t.gateSaid` 일 때 한 번 `emit(imp 1)`, `recordDoc`(t1 은 풀릴 때 고친다) | "혼자 들어가지 않습니다. 동료를 기다립니다." |
| 예외로 막지 않았다 | 같은 자리 | 예외가 처음 결정을 바꾼 때 한 번 `emit(imp 2)` | "총격이 계속됩니다 — 단독 진입!" |
| 기다림이 상한에 닿았다 | 같은 자리 | timeout 갈래의 문구(4.4) | "지원이 오지 않습니다 — 진입합니다." |
| 방법을 골랐다 | R2 `startMethod` | R2 의 `SAY` 표에 R3 의 까닭 여섯을 더한 문구(3.7 끝) | "부상으로 헤엄은 못 합니다. 구명환을 던지겠습니다." |
| `fit` 이 배정을 바꿨다 | `commander.assign`(배정이 정해진 그 자리) | 기록 문구는 따로 내지 않는다. **교본이 없었다면 다른 대원이 뽑혔을 때만**(아래) 지시 무전 끝에 까닭 말 하나를 붙이고(`(부상 — 가벼운 임무)`), `recordDoc(eventId = 그 지시 기록)`. '돌리겠다'는 말은 배정이 실제로 바뀐 이 자리에만 쓴다 | "김도윤, 출입구 봉쇄 맡아라 (부상 — 가벼운 임무)." |
| 지휘·관제 줄 | `orders/doctrine.ts`·`dispatch/doctrine.ts` 의 요청·지령 자리 | 지금의 `request`·`emit` 그대로, `recordDoc` — 요청은 `request` 가 돌려준 기록 id 가 0 이상일 때만(버려진 요청은 세지 않는다 — 6.1 끝) | "흉기 난동 — 2인 제압 인력이 없습니다. 경찰 지원 바랍니다." |

- **`fit` 이 배정을 바꿨는가**(까닭 말과 '쓰였다' 측정의 정의): `assign` 의 후보 반복은 한 작업마다 1등을 둘 센다 — 교본을 넣은 `fit` 으로 센 1등과, `docFitRules` 가 함께 돌려주는 교본 전의 값(`base`)으로 센 1등. 둘이 다르면 그 작업에서 교본이 배정을 바꾼 것이고, 뽑힌 대원에게 걸린 중립 아닌 줄(`fitMul ≠ 1` 또는 `fitAdd ≠ 0`)과 밀려난 대원에게 걸린 금지·감점 줄을 `recordDoc(hook 'fit', eventId = 그 지시 기록)` 으로 센다. 까닭 말은 뽑힌 대원 쪽의 `rank` 가 가장 작은 줄의 `why`. 둘이 같으면 아무것도 남기지 않는다. 대원의 자체 판단(`brain` 7번)은 비교할 1등이 없으므로 `fit` 줄을 세지 않는다.
- `recordDoc(sim, I, a, rule, hook, extra, eventId, say)` 는 `I.docs` 에 한 줄을 넣는다. 같은 `(rule, rid, tgt)` 의 줄이 30초 안에 있으면 새 줄 대신 그 줄의 `t1` 을 늘린다(같은 기다림이 판단 주기마다 줄을 만들지 않게).
- **같은 말을 되풀이하지 않는다**: 교본 행동 문구는 같은 대원·같은 줄에 20초에 한 번(지금 후퇴 문구와 같다). 판단 지점 문구는 임무마다 한 번(`t.gateSaid`).
- 기록 문구가 바뀌고 무전이 늘므로 교대 해시(`sim.logHash`)가 바뀐다. 기존 테스트는 같은 시드 두 번의 해시가 같은지만 본다.

### 2.8 난수와 순서

- **교본은 난수를 쓰지 않는다.** 같은 상황·같은 장비·같은 상태 = 같은 결정. 다양성은 사람·장비·상태·상황의 차이에서 나온다(R2 와 같은 원칙).
- 새로 생기는 난수 판정은 없다. 탄약 소모·재장전·재보급·엄폐 이동·짝 맺기·분류는 모두 결정적이다.
- **결과는 바뀐다** — 피할 수 없고 의도한 것이다: `brain` 의 판단 오차는 후보마다 `a.rng.next()` 를 한 번 부르므로(`think` 끝의 `for (const o of opts)`), 교본 후보가 하나 늘면 그 대원의 `a.rng` 흐름이 한 칸 밀린다. 재장전 중 쏘지 않으면 `s.rng`(명중) 호출 수가 바뀐다. 그래서 0단계(틀만)는 후보를 내지 않고 사격을 막지 않아 해시가 같아야 하고, 1단계부터는 단계마다 분포를 전후로 잰다(8절).
- 쓰지 않는 흐름: `s.rng`·`a.rng`·`mrng`·R1 의 `kit`·`kit:<현장>`·`air:*`·H1 의 `injury:<현장>:<목적>`·X6 의 `cat:` 에 호출을 **더하지 않는다**.

### 2.9 탄약 (바탕 — 2단계)

R1 은 "탄약 수는 넣지 않는다(총은 무제한)"고 정했다. R3 는 사용자 예("탄이 떨어지면 엄폐하고 재보급")를 위해 **가볍게** 넣는다. 판정은 결정적이고, 문턱은 교본 줄(P08~P10)이 읽는다.

| 총기 (`KitDef`) | `uses`(처음 탄) | `mag`(탄창) | `perShot`(한 번 쏠 때) | `reload`(초) | 쏠 수 있는 횟수 |
|---|---|---|---|---|---|
| `pistol` 권총 | 30 | 15 | 1 | 2.0 | 30 (약 55초의 연속 교전 — 사격 간격 1.4~2.2초) |
| `rifle` 소총 | 90 | 30 | 2 (두 발 사격) | 2.5 | 45 |
| `sniper` 저격 소총 | 15 | 5 | 1 | 3.0 | 15 |

- **명부**(R2 의 수량 복사 규칙을 그대로): `{ id, uses: KITS[id].uses, mag: KITS[id].mag }`. 인근 도시 지원 부대도 같다.
- **소모**(`executor.shootAt` 첫머리 — 실행부): 쏘는 대원이 가진 총(G5 의 `weaponOf(sim, a)` 와 같은 순서 — 저격 > 소총 > 권총 가운데 가진 것. R1 의 `hasFirearm` 은 참/거짓만 돌려준다. 판단부는 같은 순서의 `gear.gunOf` 를 쓴다)의 `mag ≤ 0` 이면 쏘지 않는다. 쏘면 `useKit(sim, rid, w, perShot)` 과 `it.mag −= perShot`. `mag` 가 0 이 되고 `uses > 0` 이면 `a.reloadUntil = sim.t + reload`, 그 시각에 `mag = min(magSize, uses)`(`doctrineRun.reloadTick`, `act` 첫머리에서 한 줄). 재장전 중에는 `shootAt` 이 **난수를 부르기 전에** 돌아간다(그래야 `s.rng` 소비가 "쏘지 않았다"와 같다). 비살상탄(R2)은 자기 장비(`beanbag`)의 수량을 쓰므로 이 규칙과 따로다. 저격(R2 `sniper` 방법)의 한 발은 `sniper` 의 탄 1 — R2 의 `methodRun` 저격 실행부가 판정 직후 이 파일의 `doctrineRun.fireRound(sim, a, 'sniper')` 를 부른다(탄창·재장전을 이 함수 하나가 맡는다 — R2 는 `it.mag` 를 직접 깎지 않는다. 재장전 중이면 저격 조준을 멈춘다, R2 §4.6). `fireRound` 의 몸은 `shootAt` 의 소모와 같다(`useKit(sim, rid, w, perShot)`·`it.mag −= perShot`·재장전 시작 — 11.1). 탄이 0 이면 R2 의 조건 상실로 그 방법을 놓는다.
- 총기 셋에 `uses` 를 채우면 R2 의 `gear.kitCount` 가 총기를 수량 장비로 보아 남은 탄을 돌려준다(R2 §3.3 의 `isQty`). 그래서 총기를 `kits` 로 거는 R2 방법은 탄 0 에서 후보가 아니게 된다 — 의도한 것이다(쏠 탄이 없는 사람이 저격을 고르지 않는다). R1 의 `perimeter`·`engage` 자격(`hasFirearm`)은 수량을 보지 않으므로 탄 0 의 금지는 교본(P09·P22)이 맡는다.
- **문턱**: `ammoLow` = `uses ≤ magSize`(마지막 탄창), `ammoCrit` = `uses ≤ 2 × perShot`(발사 2회 이하). 둘 다 `CrewBelief.ammo` 로 신고한다.
- **재보급**(`TaskKind 'rearm'`, 라벨 '탄약 보급'): 대기 지점까지 가서(3칸) 6초 → 자기 부대 `ammoBox > 0` 이면 가진 총기를 모두 처음 값으로(`uses`·`mag`), `ammoBox −= 1`, `emit(imp 0, '탄약 보급 완료.')`. 상자가 없으면 `emit(imp 1, '보급할 탄약이 없습니다.')`(이 대원·이 사건에 한 번), `a.docMem` 에 그 줄을 이 사건 끝까지.
- **탄약 상자**(`Unit.ammoBox`): 순찰 `tn.ammoBox`, 기동 +1, 특공 +2, 폭발물 처리반 `tn.ammoBox`, 경찰 헬기 0(내리는 사람이 없다). 집에 닿으면(`resources.arrive` 의 `returning`) 가득 — R1 의 `spareAir` 와 같은 자리. `tn.ammoBox = [1, 1, 2, 2, 3][장비]`.
- 탄이 위급(`ammoCrit`)이거나 0 이면 총기 상대 `engage`·`perimeter` 는 교본이 막고 하던 것도 놓게 한다(P09·P22 — `drop`). 교전 중에 탄창이 비어 쏘지 못한 채 서 있는 대원이 생기지 않게 한다(`shootAt` 이 바로 돌아가므로 그 상태로는 아무것도 하지 않는다). `arrest`(R1: 총기 ‖ 테이저)는 그대로 — 흉기·맨손 상대는 테이저·몸으로 검거한다.
- 대부분의 사건에서 탄은 바닥나지 않는다(교전이 짧다). 긴 총격·대형 인질극에서만 드러난다 — 드물지만 보이게(8절의 "쓰인 줄" 목표가 이 줄을 장면 테스트로 잰다).

### 2.10 엄폐 자리 (바탕 — 2단계)

지금은 엄폐를 고르는 행동이 없다(`executor.act` 가 멈춘 칸의 이웃으로 `a.inCover` 를 우연히 정할 뿐이다). 용의자에게만 엄폐 이동이 있다(`hazards.tickHostiles`). R3 는 **생김새와 믿음만으로** 엄폐 자리를 찾는 순수 함수를 둔다.

```ts
// doctrine.ts
export function coverTileAt(s: Scene, x: number, y: number): boolean;    // 벽·창·바위·가구 칸 (s.tiles 만 — 소품은 보지 않는다. executor.isCoverTile 과 같은 칸 종류)
export function coverSpot(s: Scene, ax: number, ay: number, tx: number, ty: number, wantLos: boolean): { x: number; y: number } | null;
```

- **후보 칸** `p`: `staticPass`, 물·`VOID` 아님, 위협(믿음 위치 `t`)에서 1.8칸 넘게 떨어짐, 그리고
  - `wantLos`(엄폐 사격): **위협 둘레의 고리** — `3 ≤ dist(p, t) ≤ 7.5`, `losWalls(p, t)`, 대원에게서 12칸 안(멀리 있는 대원도 자리를 얻는다. 대원 둘레에서만 찾으면 7.5칸 밖의 대원은 늘 `null` 이 된다).
  - `!wantLos`(숨기 — 재장전·탄 위급·중상·협상자): **대원 둘레 4칸** — `losWalls(p, t)` 가 거짓(벽에 가려 서로 보이지 않는다).
- **엄폐**: `p` 에서 위협 쪽 방향(`sign(tx − px)`, `sign(ty − py)`)의 이웃 세 칸 가운데 하나가 `coverTileAt`.
- **점수**: 대원에게 가까운 순, 같으면 칸 번호가 작은 쪽. 없으면 `null` → 부르는 쪽이 지금 동작(엄폐 사격은 지금의 7.5칸 접근, 숨기는 지금의 후퇴)으로 간다.
- 소품 칸을 보지 않는 까닭: `s.propAt` 은 차량·밸브 같은 물건이 어디 있는지 드러낸다 — 판단부가 소품을 읽지 않는다는 R2 의 금지를 그대로 둔다. 가구 칸(`T.FURN`)은 부서지면 바닥이 되므로(`damage.ts`) 그때부터 엄폐가 아니다 — 지금의 `inCover` 규칙과 같다.
- **자리는 임무에 담고, 정해진 때에만 다시 고른다**(CLAUDE.md 함정 "한 임무 안에서 이동 목표를 둘 두지 않는다"): 고른 자리와 그때의 위협 위치를 `t.cvX/cvY`·`t.cvTx/cvTy` 에 담는다. 다시 고르는 때는 셋뿐이다 — ① 아직 고른 적이 없다(`t.cvX === undefined`), ② 믿음 속 위협이 고를 때의 자리에서 2칸 넘게 움직였다, ③ 그 자리에 닿은 뒤 위협이 2초 넘게 보이지 않는다(`t.cvLost`, 엄폐 사격만). `null` 이 나오면 `t.cvX = NaN` 으로 두어 ②·③ 이 될 때까지 다시 부르지 않는다(그동안 지금 동작). 한 틱에 `moveTo` 는 그 자리 하나로만 부른다.
- **쓰는 곳**: ① `engage` 의 마지막 분기(총기 용의자와 교전 — 지금은 7.5칸·시야 아무 자리)가 `coverSpot(…, wantLos = true)` 로 간다(P05 — R2 가 이미 이 분기를 기록 이름 `cover` 로 부른다. R3 가 그 이름을 실제 행동으로 만든다). ② `TaskKind 'cover'`(숨기)가 `wantLos = false` 로 간다. ③ P14 의 대기 자리(`wantLos = true` — 쏘지는 않지만 용의자가 돌아서는 것을 보아야 한다).
- **`cover` 임무**(라벨 '엄폐'): 위 규칙으로 자리를 정하고 `moveTo(…, 0.4)`. 닿으면 기다린다(G5 의 엄폐 자세). 끝나는 조건: 재장전이 끝났고 4초 동안 피격이 없음 / 탄 위급인데 4초 동안 피격이 없음(그다음 판단에 P08 이 `rearm` 을 낸다) / 믿음 속 위협이 활동하지 않거나 `fight` 가 아님(P16 은 이때 협상 자리로 돌아간다 — 작업판의 `negotiate` 는 `setTask` 의 `preempt` 로 열린 채 남아 있어 지휘관이 다시 준다) / 12초. 끝나면 `a.docMem` 에 그 줄·그 위협을 20초(같은 위협에 엄폐 ↔ 교전 왕복을 늦춘다). 계속 점수는 4.4 끝.

---

## 3. 분야별 교본 표

**읽는 법**

- **자리**: `fit`(누가 맡는가) · `의무` · `행동`(점수 후보) · `방법`(R2 배율·행) · `판단`(실행 중 판단 지점 `gate`) · `지휘`·`관제`·`추격`(6절).
- **구분**: **새로** = R3 가 이 `id` 로 `DOCTRINE` 에 등록하는 개인 줄(측정 대상 — 9절). 등록 칸(자리·누구·장비·효과·순위·까닭)은 3.6 표에 줄마다 모두 적었다 — 아래 분야 표는 사람이 읽는 설명이고, 둘이 어긋나면 3.6 이 맞다. **새로 — 지휘 ○○ / 관제 ○○** = 6절의 지휘·관제 줄로 구현하고 그 `id`(`CMD_ROWS`)로 센다 — 분야 표에서도 한눈에 보이게 한 번 더 적었다(두 번 세지 않는다). `있음(R1)`·`있음(R2)`·`있음(X6)`·`있음(H1)`·`있음(지금)` = 다른 설계서나 지금 코드가 이미 하는 것 — 적기만 하고 등록하지 않는다. **지움** = 검토에서 걸릴 자리가 없거나 다른 줄과 같아 뺀 번호(번호는 다시 쓰지 않는다).
- **분야마다 등록한 줄** = 그 표의 "새로" 개인 줄(번호 하나를 한 줄로 센다 — `F04`·`F04b` 는 한 줄) + 6절에서 그 분야로 적힌 지휘·관제 줄. 네 분야 모두 12줄을 넘는다: 경찰 16 + 7, 소방 14 + 8, 의료 13 + 5, 특수 16 + 5(6.2 표의 "분야" 칸이 관제 줄의 분야다).
- **상태** 칸의 "중상"은 신고 `band = 1`(체력 70 이하, 75 이상이면 다시 0 — 4절), "혼자"는 `st.alone`, "짝"은 `st.buddy`(5절), "지원 옴"은 `st.backup`.
- 수치는 **시작값**이다(8절에서 잰다). 거리는 현장 칸. "위험 실내 일" = `fireRisk` 구역(화재·가스·붕괴 건물의 실내) 안의 `search`·`carry`·`escort`·`extricate`·`mitigate`·`overhaul`(`fitFor` 의 소방 제한과 같은 범위).
- 문구의 `{mate}` 는 짝·동료 이름, `{n}` 은 수. 조사는 `josa()`.

### 3.1 경찰 (`police` — 순찰·기동, 그리고 `who.dept: ['police']` 인 줄은 특공·폭발물 대원에게도 걸린다)

흉기·맨손 용의자와 몸으로 붙는 곳은 `case 'arrest'` 다(0절) — P01~P03 의 판단 지점 `closeIn` 은 **`arrest` 의 `moveTo` 앞**(R1 테이저 바로 다음 자리)에 둔다. `engage` 의 첫 갈래(도주 용의자 추격)에는 교본을 걸지 않는다. R2 §4.6 의 "흉기 상대 비살상탄은 `engage` 첫 갈래 안"도 같은 착오다 — 흉기 상대의 비살상탄은 실제로는 `arrest` 의 같은 자리에 두어야 걸린다(합칠 때 R2 쪽에 알린다, 11.4).

| 줄 | 누구 | 상황 | 장비 | 상태 | → 행동 (자리) | 문턱 | 기록 문구 (예) | 구분 |
|---|---|---|---|---|---|---|---|---|
| P01 | 경찰 | 흉기·맨손 용의자 `fight` 의 검거(`arrest`), 4칸 안·시야 | 테이저 남음 | 같은 용의자를 맡은 동료가 2.6칸 안에 ≥ 1 | 테이저 먼저(R1 그대로), 무력화가 보이면(`see.stunned`) 둘이 함께 붙는다. 무력화 전에는 1.6칸 안으로 들어가지 않는다 — 1.8칸에서 기다림, 상한 8초(빗나가 테이저 대기 4초가 두 번) (판단 `closeIn`) | 4칸 · 2.6칸 · 8초 | "테이저 준비 — {mate}, 맞으면 같이 붙는다." | 새로 (테이저 자체는 R1) |
| P02 | 경찰 | 흉기 용의자 `fight` 의 검거 | 테이저·비살상탄 쓸 수 없음 | **혼자**(같은 용의자를 맡은 동료 0) | **거리 유지**: 3칸에서 멈추고 말로 붙잡는다, 지원 요청 무전(지휘관 CP2). 상한 20초(지원 옴이면 30초) 뒤 덮침. **예외**: 시민이 위협 2칸 안(`civAtRisk`)이면 즉시 덮침 (판단 `closeIn`) | 3칸 · 20/30초 | "흉기 소지 — 거리 유지하며 지원 기다립니다." / 예외 "시민이 위험합니다 — 바로 제압!" | 새로 |
| P03 | 경찰 | 흉기 용의자 `fight` 의 검거 | 테이저 쓸 수 없음 | 같은 용의자를 맡은 동료 ≥ 1 이 2.6칸 밖 | 동료가 2.6칸 안에 올 때까지 3칸에서 기다렸다 **동시에** 덮침 (판단 `closeIn`). 둘이 붙으면 H1 의 몸싸움 피해는 지금대로 양쪽에 | 2.6칸 · 6초 | "둘이 동시에 들어갑니다!" | 새로 |
| P04 | 경찰 | 흉기·총기(대치) 9칸·시야, 인질 곁 아님 | 비살상탄 | — | 비살상탄(R2). P02 의 거리 유지 중이면 그 자리에서 쏜다 | R2 | R2 | 있음(R2) |
| P05 | 경찰 | 총기 용의자와 교전(진입 결정 뒤 `engage` 마지막 분기) | 총·탄 | — | **엄폐 사격**: 지금의 "7.5칸·시야 아무 자리" 대신 `coverSpot(wantLos)` 로 가서 쏜다. 자리는 임무에 담고 정해진 때에만 다시 고른다(2.10). 자리가 없으면 지금대로 (판단 `coverFire` — `choose 'cover'`) | 고리 3~7.5칸 | (기록 문구 없이 센다 — 사격 기록은 G5) | 새로 |
| P06 | — | — | — | — | — | — | — | **지움** — 진입 결정 전의 총기 용의자에게는 `engage` 가 도주 때만 생긴다(`commander.syncBoard`). 대치 중에는 `negotiate`·`perimeter` 뿐이라 걸릴 자리가 없다 |
| P07 | 경찰 | 닫힌 방 진입(지금: 동료 0 이면 4초 뒤 혼자) · 동시 진입(지금: `breachAt + 8` 뒤 혼자) | — | **혼자**(방: 2.6칸 안 `engage` 동료 0 / 동시 진입: 그 문의 진입조 1명) | 진입하지 않고 문 앞에서 기다린다. 동시 진입은 `breach()` 가 그 출입구를 건너뛰고(아래), 대원은 `s.breachDone` 뒤에도 `t.gateId === 'breach'` 인 동안 문 앞에 남는다. **예외 ①** 총격범 교전 + `civAtRisk` → 단독 진입. **예외 ②** 상한(지원이 없으면 60초, 지원 옴이면 120초) → 진입 (판단 `roomEntry`·`breach`) | 2.6칸 · 60/120초 | "혼자 들어가지 않습니다. 동료를 기다립니다." / ① "총격이 계속됩니다 — 단독 진입!" / ② "지원이 오지 않습니다 — 진입합니다." | 새로 |
| P08 | 총을 가진 대원 | 믿음 속 교전(`fight`) 위협 없음 — 또는 탄 위급이고 4초 동안 피격 없음(P09 의 엄폐가 끝난 뒤) | 탄 `ammoLow` / `ammoCrit` | 탄약 상자 있음(부대) | **재보급**(`rearm`) (행동 — 평소 0.78, 탄 위급이면 0.97) | 마지막 탄창 / 발사 2회 | "탄약 보급 받으러 차량으로 갑니다." | 새로 |
| P09 | 총을 가진 대원 | 총기 위협 `fight` | 탄 `ammoCrit` 또는 0 | 피격 3초 안, 또는 부대 탄약 상자 0 | **엄폐(숨기)** — 끝나면 P08 이 재보급으로 잇는다 (행동 0.97). 총기 상대 일의 금지·놓기는 P22 | 발사 2회 이하 | "탄약 바닥 — 엄폐합니다!" | 새로 |
| P10 | 총을 가진 대원 | 교전 중 탄창이 비었다(재장전 중) | 탄 남음 | 엄폐 아님·피격 3초 안 | 재장전(2~3초 사격 멈춤 — 2.9)을 그 자리에서 하지 않고 **엄폐(숨기)** 로 가서 한다 (행동 0.97) | 2.0/2.5/3.0초 | "재장전 — 엄폐!" | 새로 |
| P11 | 경찰 | 피격 3초 안 | — | 40 ≤ 체력 < 70, 엄폐 아님, 4칸 안에 숨을 자리 있음, 위험 점수에 X6 조짐 몫이 없음 | 지금의 **후퇴(대기 지점까지) 대신 엄폐(숨기)**. 점수는 지금의 위험 점수 그대로 — 후퇴 후보를 만드는 자리에서 `docRetreat` 가 후보의 이름·`apply` 를 엄폐로 바꾼다(교본 후보 하나 규칙과 따로 — P09 가 이겨도 P11 이 빠지지 않는다). 체력 < 40·출혈 후퇴(H1)·가스·롤오버 조짐의 물러남(X6)은 그대로 후퇴 | 3초 · 40~70 · 4칸 | "피격 — 엄폐!" | 새로 |
| P12 | 경찰 표 대원 | — | — | **중상** | `engage`·`arrest` `×0.35`, 가벼운 일(H1 `LIGHT_WORK` 가운데 `negotiate` 를 뺀 것) `+0.15`, 침착함 ≥ 0.6 이면 `negotiate +0.2` (`fit`) | band 1 | (자기 신고) "부상 — 체력 저하." | 새로 (G01 의 경찰판 — `who.doc: ['police']`) |
| P13 | 경찰 | 인질 곁 총기 용의자 | 섬광탄(나 또는 동료) | — | 섬광탄 들고 4.6칸까지 / 동료 섬광탄이면 7.5칸 대기 (지금 그대로) | 지금 | 지금 | 있음(지금·R1) |
| P14 | 경찰 | 인질 곁 총기 용의자(진입 결정 뒤 `engage` 의 인질 갈래 — 쏘지 않는다) | 현장 경찰 **누구도 섬광탄 없음** | — | 지금은 다가가 2.2초에 덮친다 → **동료 ≥ 1 이 2.6칸 안이고 믿음 속 용의자가 등졌을 때(`facing` 과 대원 방향의 차 > 100°)만** 바로 덮친다. 아니면 7.5칸 엄폐 자리(`wantLos` — 돌아서는 것을 보아야 한다)에서 대기. **상한 20초**(섬광탄을 가진 부대가 오는 중이면 40초) 뒤에는 지금 동작(접근·덮침). 용의자는 11칸 안에서 본 대원 쪽으로 돌아서므로 "등졌다"는 드물다 — 대부분 상한으로 끝난다 (판단 `closeIn`) | 2.6칸 · 100° · 20/40초 | "섬광탄 없음 — 인질 위험, 엄폐 대기." / "등졌다 — 지금!" / 상한 "더 기다릴 수 없습니다 — 접근해 제압합니다." | 새로 |
| P15 | 섬광탄을 든 대원 | 동시 진입(`breach`) | 섬광탄 1개 남음 | — | 동시 진입에서는 쓰지 않고 방 진입용으로 아낀다(지금: 문 안쪽 5칸 안이면 쓴다). 용의자가 3칸 안이면 예외 (판단 `bangUse` — `choose 'save'`, 막지 않는다) | 1개 · 3칸 | "마지막 섬광탄 — 방 진입에 아낍니다." (imp 0, 한 번) | 새로 |
| P16 | 협상 대원 | 협상 중 용의자 `fight` | — | — | 지금은 그 자리에 서 있는다('엄폐 (협상 중단)' 라벨뿐) → **엄폐(숨기)** 로 옮기고, 교전이 그치면 엄폐가 끝나 지휘관이 협상을 다시 준다 (행동 0.93 — 흉기 상대 협상의 계속 점수 0.90 보다 높게) | — | "교전 — 엄폐하고 계속 부릅니다." | 새로 |
| P17 | 경찰 | 확보 전 무장 현장의 건물 수색(`hot` `search`) | — | 쓸 수 있는 짝이 없음(5.2) | 혼자서는 맡지 않는다(`fit` 0). 짝이 있으면 짝이 `pair` 로 따라 들어가고, 실내 첫걸음에서 짝이 4칸 안에 없으면 기다린다(판단 `interiorEntry`, `P17b`). 맡을 사람이 없으면 지금의 "hot && 수색 남음 && law 0 → law" 요청과 B3 블록이 부른다 | 4칸 | (지시 무전 끝의 까닭 말) / "짝을 기다립니다." | 새로 |
| P18 | 경찰 부대 | 추격전, **경찰 헬기가 차를 보고 있음**(`I.trackBy === 'air'`) | — | — | 가장 가까운 지상 부대 하나만 알려진 위치로 따라가고, 나머지는 **예상 교차로 앞막기** (추격) | — | 관제 "헬기가 보고 있다 — {호출부호}, 앞을 막아라." | 새로 — 관제 D7 |
| P19 | 경찰 부대 | 추격전, 헬기 없음, 지상 둘이 이미 알려진 위치 42 안 | — | — | 셋째부터 앞막기 (추격) | 42 | 관제 "{호출부호}, 앞 교차로로 돌아가라." | 새로 — 관제 D7 |
| P20 | 경찰 | 교통 통제 | — | 이 현장에 2차 사고가 있었음(`sit.lanes2nd`), 또는 밤·비·안개 | `blockLane`(순찰차로 차로 입구를 막고 선 뒤 통제 — 설치 +3초, 그동안 그 방향에서 들어오는 차의 부주의 확률 ×0.4. 3.7), 아니면 `post`(평소, 경광봉이면 R1 의 ×0.85) (방법 — 6단계) | — | "차로를 차량으로 막겠습니다." | 새로 |
| P21 | 경찰 | 가스·폭발물 현장의 출입 통제 | 확성기 | — | 대피 방송(R2 `announce`) | R2 | R2 | 있음(R2) |
| P22 | 총을 가진 대원 | 총기 위협이 있는 현장 | 탄 위급·0 | — | 총기 상대 `engage`·`perimeter` `fit` 0 **— 하던 것도 놓는다**(`drop` — 2.6; 탄창이 빈 채 서 있지 않게), `traffic`·`interview` `+0.15`. 보급 뒤 `ammoCrit` 이 풀리면 풀림 (`fit`) | 발사 2회 이하 | (자기 신고) "탄약 소진." / 놓을 때 "탄약이 없어 위치를 넘깁니다." | 새로 |

**동시 진입의 혼자 막기(P07)는 `breach()` 안에서 한다**: 지금 `breach()` 는 한 사람이 불러도 `s.breachDone = true` 로 바꾸고 모든 출입구의 진입조 문을 함께 연다. 그래서 혼자인 대원 한 사람의 호출만 막으면 다른 문의 진입조가 부르는 순간 함께 들어간다. 고치는 법: `breach()` 의 출입구 반복 몸을 `doctrineRun.breachExit(sim, s, a, k)` 로 꺼내고, 반복 안에서 그 출입구의 진입조가 한 명이면 `docGate(sim, s, team[0], 'breach', …)` 를 물어 막히면 **그 출입구만 건너뛴다**(그 대원에게 `t.gateAt`·`t.gateId = 'breach'`). `engage` 의 ① 분기 조건을 `(s.breachAt >= 0 && !s.breachDone) || t.gateId === 'breach'` 로 넓혀 그 대원은 문 앞에서 기다리고, 판단 지점이 풀리면(동료 도착·예외·상한) `breachExit` 로 **자기 문만** 연다. S01 의 줄 서기(`choose 'stack'`)도 같은 반복 안에서 고른다.

### 3.2 소방 (`fire` — 펌프차·구조 공작차. `kits: ['scba']` 인 줄은 화학·사다리차·소방 헬기 대원에게도 걸린다)

공기 줄은 `kits: ['scba']`(들었는가)로 걸고, 남은 공기는 `st.air = kitQty(scba) / tn.airFull` 로 본다(2.4). R2 의 `kitCount('scba')` 는 60초 아래에서 0 이 되므로 그것으로 걸면 공기가 적은 대원에게서 공기 줄이 꺼진다.

| 줄 | 누구 | 상황 | 장비 | 상태 | → 행동 (자리) | 문턱 | 기록 문구 (예) | 구분 |
|---|---|---|---|---|---|---|---|---|
| F01 | scba 대원 | 위험 건물 실내(`inHazard`) 또는 연기 감각 > 0.25 | scba | 공기 < 30% (`AIR_OUT`), 업고 있지 않음 | **공기 탈출**(`airOut`): 나가 교체(예비가 있으면 8초 — R1 의 `swapAir` 효과를 이 임무가 한다) (의무, rank 0). 나갈 자리는 5.4 끝 | 0.30 | "공기 30% 미만 — {mate}, 같이 나간다." / 짝 없으면 "공기 30% 미만 — 탈출합니다." | 새로 |
| F02 | scba 대원 | 위험 건물 실내 | scba | 짝(`a.buddy` — 쓸 수 있는가와 상관없이)이 나간다(`airOut`·`pairOut`·`retreat`·`evacuate`·`withdrawn`), 업고 있지 않음 | **짝 따라 나가기**(`pairOut`) (의무, rank 0) | — | "{mate} 따라 나갑니다." | 새로 |
| F03 | scba 대원 | — | scba | 공기 < 50% (`AIR_IN`) | 위험 실내 일 `fit` 0 — R1 의 "`uses < 45` 면 0" 을 비율 문턱으로 넓힌다. 진압은 `fit` 을 막지 않고 실내 방법만 뺀다(`F03b`: `interior ×0` — 바깥 방어 `defensive` 는 남는다. `fitFor` 는 방법을 모르므로 `suppress` 의 `fit` 을 0 으로 하면 바깥 방어까지 막힌다). 바깥에서 손이 비면 R1 의 공기통 교체 후보를 0.7 로 낸다(바탕 — 11.1 `brain`) | 0.50 | (R1 의 교체 문구) | 새로 (교체 자체는 R1) |
| F04 | scba 대원(`SOLO_OK` 제외) | 위험 실내 일 | scba | **짝 없음**(5.2 — 쓸 수 있는 짝이 없음) | 맡지 않는다(`fit` 0). 진압은 실내 방법만 뺀다(`F04b`: `interior ×0` → R2 의 외부 방어). 맡은 뒤 실내 첫걸음에서 짝이 4칸 안에 따라와 있지 않으면 문턱에서 기다린다(`F04c`: 판단 `interiorEntry`). **예외**: 믿음 속 구조 대상이 3칸 안이면 그 사람의 `carry` 는 맡는다 | 3칸 · 4칸 | (지시 무전 끝) "(짝 없음)" / "짝 없이 들어가지 않습니다." | 새로 |
| F05 | scba 대원 | 위험 실내로 처음 들어서려는 걸음 | scba | 밖 대기조(`outsideWatch`, 5.6) < 2 (같은 사건으로 오는 소방 부대가 있으면 1 로 충분) | **2인 대기조 확인 전 진입 보류** — 문턱 칸에서 기다린다(판단 `interiorEntry`, 상한 20/30초). 진압은 같은 조건에서 실내 방법을 뺀다(`F05b`: `interior ×0` → 외부 방어로 이어져, 막고·놓고·다시 잡는 순환이 생기지 않는다). **예외**: `victimInside`(믿음 속 구조 대상·신고 인원 > 찾은 수) → 짝만 있으면 진입 | 2명 | "대기조 확인 전 진입 보류." / 예외 "요구조자 있음 — 대기조 없이 진입합니다." | 새로 |
| F06 | 소방 | 연기 찬 구역 수색(믿음 불 > 0.25 구역) | 열화상(`tic`) | — | `search +0.15`(열화상 대원이 먼저 맡는다). 시야 효과는 R1 그대로 (`fit`) | 0.25 | (지시 무전) | 새로 |
| F07 | 소방 | 실내 수색 | 열화상 **없음** | 감각 연기 > 0.5 | **벽 더듬기 수색**(`feel` — 3.7) (방법) | 0.5 | "앞이 안 보입니다. 벽을 따라 더듬어 찾겠습니다." | 새로 |
| F08 | 관창을 든 대원 | 진압 | hose | 자기 부대 물 < 30%, 소화전 연결 안 됨(조직 정보) | **끊어 쏘기**(`pulse` — 3.7) (방법) | 30% | "용수 30% — 끊어 쏘며 아끼겠습니다." | 새로 |
| F09 | 관창을 든 대원 | 진압 | hose | 물 0, 소화전 연결 안 됨 | 진압 `fit` 은 지금도 R1 자격으로 0. 수색·구조·이송 `+0.1`(손을 놀리지 않는다). 작은 불(≤ 0.35)이고 소화기가 있으면 R2 `extinguisher` 가 고른다 (`fit`) | 0 | (지시 무전) | 새로 |
| F10 | 소방 | 펌프 고장 | — | 부대 `sparePump > 0` | 예비 펌프 교체(지금 0.84 그대로)가 `sparePump` 를 하나 쓴다. **0 이면** 교체 후보를 내지 않는다(바탕 — `brain` 의 예비 펌프 후보에 조건 하나) — 지휘관이 "펌프 고장 — 진압 부대 교체"를 요청 | 1개 | (지금 문구) | 있음(지금) + 새로 — 지휘 CF3 |
| F11 | 구조 대원 | 고립자 구출 | 유압 장비 없음·알려진 고장 | — | 수동·기본 구출(R2 `manual`·`basic`)은 R2 가 고른다. 교본은 지휘관 쪽: "유압 장비 고장" 지원 요청 | — | R2 | 있음(R2) + 새로 — 지휘 CF4 |
| F12 | 누구나(소방 표에 두지만 모든 분야에 건다 — 3.6 의 who `—`) | 수난 구조 | 구명조끼(`pfd`) 없음 | 믿음 물살 ≥ 0.07(빠름) | 헤엄(R2 `swim`) `×0` — 빠른 물살에 구명조끼 없이 들어가지 않는다. 방화복·공기호흡기를 벗는 준비 6초는 R2 그대로 (방법, rank 0) | 0.07 | R2 SAY (까닭 `danger`) | 새로 |
| F13 | 방화복이 없는 대원 | 대상 작업의 구역이 X6 위험 단계 1(`sit.wDanger` — 대상 구역 단계. 자기 자리의 단계가 아니다) | turnout 없음 | — | 그 일 `fit` 0(X6 는 단계 2 부터 막는다 — 보호 장비가 없는 사람은 한 단계 먼저) | 단계 1 | (지시 무전) | 새로 |
| F14 | 소방 표 대원 | — | — | **중상** | 위험 실내 일 `×0.35`, `suppress ×0.6`(바깥 방어도 같은 일이라 덜 줄인다), 가벼운 일(H1 `LIGHT_WORK`) `+0.2` (`fit`) | band 1 | (자기 신고) "부상 — 체력 저하." | 새로 (G01 의 소방판 — `who.doc: ['fire']`) |
| F15 | — | — | — | — | — | — | — | **지움** — G03(지구력 < 30 → 위험 실내 새 일 0)과 같은 줄 |
| F16 | 소방 | 위험 실내 수색 | — | **신입**(경험 < 0.3), 짝이 신입 아님 | 수색 `×0.5` — 짝이 앞장서고 신입은 `pair` 로 따라간다 (`fit`) | 0.3 | — | 새로 |
| F17 | 소방 | 가스 밸브 방 앞, 감각 가스 > 0.6 | 측정기 없음 | — | 환기 후 차단(R2 `ventFirst`), 짝 규칙(F04·F05)이 그대로 걸린다 | R2 | R2 | 있음(R2) |
| F18 | 펌프차·사다리차 대원 | 교통사고 현장의 차량 화재·연료 누출(믿음 `haz leak` 또는 불) | (부대가 큰 차 `HEAVY`) | 통제 지점이 아직 통제되지 않음 | 교통 통제를 맡으면 `blockLane`(소방차로 차로 입구를 막는다 — 3.7)을 먼저 (방법 — 6단계) | — | "펌프차로 차로를 막겠습니다." | 새로 |
| F19 | 소방 | 붕괴·가스·전소의 조짐 | — | — | 물러남·철수·외부 방어 | X6 | X6 | 있음(X6) |

### 3.3 의료 (`ems` — 구급차·의료 헬기의 대원. 처치에 관한 줄은 의료 가방을 든 소방 헬기 대원에게도 걸린다)

| 줄 | 누구 | 상황 | 장비 | 상태 | → 행동 (자리) | 문턱 | 기록 문구 (예) | 구분 |
|---|---|---|---|---|---|---|---|---|
| E01 | 구급 | 믿음 속 대기 환자(band ≥ 1) ≥ 4, 또는 관제 이름표가 다수 사상자 시나리오 | 의료 가방 | 분류 전(`s.triageAt < 0`) | **분류부터**(`triage` 작업 — 지휘관 CE1. `fit`: 1급 응급구조사 +0.3, 응급구조사 +0.2, 의사 +0.1). 분류가 하는 일: 환자마다 곁에 2초 서서 그 사람의 사실을 강제 보고(`casFact` — 믿음 band 가 실제와 같아진다. 그 전의 band 는 신고·멀리서 본 값이라 틀릴 수 있다). 분류 전에는 band 1 처치를 미루고(CE1) band 2 만 처치한다 | 4명 | "다수 사상자 — 먼저 분류합니다." / 끝 "분류 완료: 위중 {n} · 중상 {m} · 경상 {k}." | 새로 |
| E02 | 구급 | 응급 현장, 믿음 위중(band 2)·거동 불가 | 제세동기(`aed`) | — | 현장 안정 후 이송(R2 `stay`) `×1.3` — 제세동기를 쓰고 옮긴다 (방법) | band 2 | "제세동기 준비 — 현장에서 소생술." | 새로 |
| E03 | 구급 | 위와 같음 | 제세동기 **없음·알려진 고장** | — | 즉시 이송(R2 `rush`) `×1.5` — 가슴 압박하며 바로 옮긴다 (방법) | band 2 | "제세동기 없음 — 가슴 압박하며 바로 이송합니다." | 새로 |
| E04 | 의사·항공 간호사 | 위중 | 의사 장비·전문 가방 | — | `stay ×1.3`, `rush ×0.7` — 현장 전문 처치 후 이송 (방법) | band 2 | "현장에서 전문 처치 후 이송합니다." | 새로 |
| E05 | 구급 | 무장 현장 안전 확보 전(`hot`), 환자가 **안전 구역**(믿음 `where 'safe'`) | 의료 가방 | — | 처치를 맡는다 — **경계 밖 처치소**. 교본은 0 인 자격을 열 수 없으므로(2.6) **`fitFor` 의 `treat` 기본 규칙을 고친다**(지금: `hot` 이면 경찰만 → `hot` 이고 믿음 속 환자가 `safe` 가 아니면 경찰만 — 11.1). 이 줄은 그 배정을 세고 문구를 남기는 기록 전용 줄(`fitMul 1`) | — | (현장에서 처음 한 번) "경계 밖 처치소에서 처치합니다." | 새로 |
| E06 | 구급 | `hot`, 환자가 현장(`scene`) 안 | — | — | 들어가지 않는다 — 경찰이 데려온다 | 지금 | 지금 | 있음(지금) |
| E07 | 구급 | 위험 건물 실내·X6 단계 ≥ 2 | scba 없음 | — | 들어가지 않는다 — 소방이 데려온다 | 지금·X6 | 지금 | 있음(지금·R1·X6) |
| E08 | 이송 대원(누구든) | 옮기려는 환자를 **구급 대원이 처치 중**(같은 `cas` 의 `treat` 임무가 진행 중 — 동료의 겉) | — | — | 처치가 끝날 때까지 들지 않고 곁에서 기다린다. **예외**: 감각 연기·열 > 0.3, 위험 건물 실내, X6 단계 ≥ 2 → 먼저 옮긴다 (판단 `carryHold`, 상한 15초) | 15초 | "처치 끝나면 옮기겠습니다." | 새로 |
| E09 | (지휘관) | 자리 하나에 기다리는 환자 둘 | — | — | 믿음 중증도가 높은 쪽 탑승을 먼저, 다른 쪽 탑승 작업은 미룬다 | 자리 1 | 지휘관 "자리 하나 — 구조 대상 {s} 먼저." | 새로 — 지휘 CE3 |
| E10 | (지휘관) | 위중 환자, 현장 자리 0, 가장 가까운 오는 구급 부대 도착 예상 > 100초(조직 정보) | — | — | `ems` 긴급 요청 '위중 환자 — 항공 이송 검토' (R1 `airFit` 의 "채워지지 않은 긴급 구급 요청" 줄로 의료 헬기가 간다) | 100초 | 지휘관 요청 문구 | 새로 — 지휘 CE4 |
| E11 | 의료 표 대원 | — | — | **중상** | 안전 구역 밖의 현장 처치 `×0.5`, 가벼운 일(H1 `LIGHT_WORK` — 안전 구역의 `treat`·`treatMate` 처치 보조 포함) `+0.2`. `load`(들어 싣기)는 H1 의 무거운 일이라 더하지 않는다 — 차 안 처치는 차에 함께 타서 한다(R1 의 "함께 탄 대원 최댓값"). 현장에 다른 구급 대원이 없으면 배율을 걸지 않는다 (`fit`) | band 1 | (자기 신고) "부상 — 체력 저하." | 새로 (G01 의 의료판 — `who.doc: ['ems']`) |
| E12 | 처치 대원 | 차로 위 환자(통제 지점의 차로 줄), 그 방향 통제 전(`ctl` 사실 없음) | — | — | 차로 위에서 처치하지 않는다 — 옮겨지기를(지휘관의 `carry`) 또는 통제를 기다린다. **예외**: 차 안에 갇힌 환자(구출 전)는 통제 뒤 그 자리에서 (판단 `laneTreat`, 상한 20초 — 지나면 처치) | 20초 | "차로 통제 전 — 차로 밖으로 옮긴 뒤 처치합니다." | 새로 |
| E13 | 척추 고정판을 든 대원 | 교통·붕괴 현장(`s.kind` — 생김새)의 거동 불가 환자를 처음 들 때 | 척추 고정판 | — | 들기 전에 3초 고정(`c.immob = true`). 감각 연기·열 > 0.3 이면 고정하지 않고 바로 (판단 `carryStart` — `choose 'immobilize'`, 6단계). **R1 의 효과 조건을 바꾼다**: 지금 R1 은 "고정판 없이 옮기면 출혈 ×1.12"라 고정판을 들기만 해도 효과를 받는다 — 그러면 3초는 얻는 것 없는 지연이다. R3 는 그 조건을 "고정하지 않고(`!c.immob`) 옮기면"으로 바꾼다(11.1) | 3초 | "척추 고정 후 이송합니다." | 새로 |
| E14 | 이송 대원 | 거동 불가 환자 | 들것 없음 | 혼자, 감각 연기 > 0.3 | **끌기**(`drag` — 3.7). 들것이 있으면 `litter`(R1 배율 — 기록 전용) (방법 — 6단계) | 0.3 | "연기가 짙습니다 — 낮게 끌어 나갑니다." | 새로 |
| E15 | (지휘관) | 비구급 대원이 처치 중, 손 빈 구급 대원이 있다 | — | — | 처치를 **넘겨받게** 한다 | — | 지휘관 "{name}, 처치 넘겨받아라." | 새로 — 지휘 CE2 |
| E16 | 구급 지휘관 | 자기 부대가 이송 출발 | — | — | 타기 전에 지휘권을 넘긴다(지금은 떠난 뒤 '지휘 불능'으로 승계) | — | "{name}, 지휘 넘긴다 — 이송 출발." | 새로 — 지휘 CE5 |
| E17 | 구급 | 경상만 남음 | — | — | 처치·이송하지 않는다 | H1 | — | 있음(H1) |
| E18 | 구급 | 위중(band 2) 환자의 처치(가슴 압박이 긴 처치) | — | 지구력 < 30 | 새로 맡지 않는다 `×0.3` — 다른 구급 대원이 맡는다(하던 처치는 지금처럼 22 까지) (`fit`) | 30 | — | 새로 |
| E19 | 응급구조사 | 위중 처치 | — | **신입**(경험 < 0.3), 현장에 1급 응급구조사·의사가 활동 중 | 위중 처치 `×0.6`, `load`·`carry +0.1` — 선임이 처치하고 신입은 옮기기를 돕는다. 혼자면 배율을 걸지 않는다 (`fit`) | 0.3 | — | 새로 |
| E20 | 구급 | `hot` 현장의 안전 구역 처치(E05 의 경우) | — | **동요** | 맡지 않는다 `×0` — 경계 근처에는 침착한 대원이 간다 (`fit`) | — | — | 새로 |

### 3.4 특수 (`special` — 특공·폭발물·화학·소방 헬기·구조정·사다리차)

| 줄 | 누구 | 상황 | 장비 | 상태 | → 행동 (자리) | 문턱 | 기록 문구 (예) | 구분 |
|---|---|---|---|---|---|---|---|---|
| S01 | 특공 | 동시 진입 | 방패 | 방패수가 진입조에 있고 중상·동요가 아님 | 방패수가 주 출입구 첫째(R1). R3: 다른 진입조원은 방패수가 문을 지난 뒤 0.6초 간격으로 들어간다(줄 서기) (판단 `breach` — `choose 'stack'`, `breach()` 의 출입구 반복 안 — 3.1 끝) | 0.6초 | "방패 선두 — 진입!" (지금의 진입 문구를 바꾼다) | 새로 (배치는 R1) |
| S02 | 저격·관측수 | 무장 대치 | 저격 소총 | — | 진입조에 들지 않는다(`engage ×0.3`) — **단 R2 의 결정적 저격 조건일 때는 깎지 않는다**(저격은 `engage` 임무 안의 R2 방법이라, 그때 저격수가 `engage` 를 맡아야 고를 수 있다). 봉쇄 자리 가운데 가장 먼 자리를 먼저(`perimeter +0.1`) (`fit`) | — | — | 새로 (선호는 R1) |
| S03 | 진입대원(파괴) | 잠긴 문 | 파괴 장비 | 대치 중 | 조용히(R2 `irons`) / 진입 순간(R2 `ram` — 장약이 있고 S26 이 막지 않으면 R2 `charge`) | R2 | R2 | 있음(R2) |
| S04 | (지휘관) | 두 문 동시 진입 문턱 | — | 쓸 수 있는 경찰 < 4 (특공 결원·중상 포함) | 한 문 진입 (문턱을 머릿수에서 "쓸 수 있는 경찰"로) | 4 | — | 새로 — 지휘 CP1 |
| S05 | 특공·기동 | 진입이 결정됨 | 섬광탄 | — | 섬광탄을 가진 사람이 진입조를 먼저 맡는다(`engage +0.1`) (`fit`) | — | — | 새로 |
| S06 | 폭발물 처리반 | 살아 있는 장치(믿음) | 로봇(작동 — 알려진 고장 아님) | — | **로봇 먼저**(`robotDefuse` `×1.3` — 3.7): 로봇 조작 요원이 8칸 밖에서 원격 확인·무력화. 로봇 고장이 드러나면 로봇 조작 요원은 고를 방법이 없어 임무를 놓고, 처리 요원이 `suitDefuse` 로 맡는다(3.7). **기본 자격을 고친다**: R1 의 `defuse` 자격(eodKit)에 "작동하는 로봇을 든 대원 — `robotDefuse` 로만"을 더한다(`fitFor` 의 `defuse` — 11.1). 교본은 0 인 자격을 열 수 없기 때문이다(2.6). **배정은 S06b**(`fit`): 방법 배율은 한 사람이 가진 방법끼리만 견주므로(로봇은 로봇 조작 요원만, 방호복은 처리 요원만 든다) S06 의 `×1.3` 은 누가 맡는지를 바꾸지 못한다 — 처리 요원(R1 선호 +0.3)이 늘 먼저 배정된다. 그래서 현장에 작동하는 로봇을 든 활동 동료가 있으면 처리 요원의 `defuse` 적합도를 `×0.4` 로 낮춘다(S06b). S06 의 방법 줄은 기록·까닭용으로 남는다 (방법 + `fit`) | 8칸 | "로봇 먼저 투입합니다." / 고장 "로봇이 작동하지 않습니다 — 방호복 착용 후 수동 해체." | 새로 |
| S07 | 폭발물 처리 요원 | 장치 | 로봇 없음·고장 | — | 방호복 없는 수동 해체(`bareDefuse`)는 둘 가운데 하나일 때만 후보: ① 방호복이 없다(지원 부대의 결원 등), ② 믿음 속 **옮길 수 없는** 사람(거동 불가 구조 대상·인질)이 장치 6칸 안 — 방호복을 벗고 더 빨리(필요 시간 ×0.75, 3.7) 해체한다(`×2` — `suitDefuse` 보다 먼저). 그 밖에는 `×0` (방법, rank 0). 시한(진실)은 보지 않는다 — 서두름은 주변 사람의 믿음으로만 정한다(11.3 결정 7) | 6칸 | ② "옮길 수 없는 사람이 곁에 있습니다 — 방호복 없이 바로 해체합니다." | 새로 |
| S08 | 해체를 맡지 않은 대원 | 살아 있는 장치(믿음) + **해체 작업이 장치 곁에서 진행 중**(동료의 겉 — `sit.defusing`) | — | — | 장치 6칸 안의 일 `fit` 0 — **예외**: 해체·출입 통제, 그리고 반경 밖으로 옮기는 일(`carry`·`escort`·`rescueMate`). `agentCost` 에서 그 원 +20(같은 조건). 거두기·알림은 지휘 CS1 — 걸리는 때가 같다 (`fit`) | 6칸 | 지휘관 "해체 시작 — 반경 6칸 비워라." | 새로 |
| S09 | 경계 요원 | 출입 통제 | 확성기 | — | 대피 방송(R2) · 봉쇄 +0.2(R1) | — | R2 | 있음(R1·R2) |
| S10 | 화학대 | 가스 현장의 위험 실내 수색 | 측정기 | — | 측정기를 가진 대원이 먼저 맡는다(`search +0.15`) — 안쪽 짝(보호복 + 측정·제독, 5.1)에서 수색은 측정·제독 대원이 앞장서고 보호복 대원이 `pair` 로 따른다. 밸브 차단(`mitigate`)은 R1 의 보호복 대원 선호(+0.3)로 보호복 대원이 앞장서고 측정·제독 대원이 따른다. 측정 자체는 X6 의 측정 갈래 (`fit`) | — | — | 새로 (측정은 X6) |
| S11 | 화학 팀장 | 자기 부대의 안쪽 짝이 위험 실내에 있다 | — | — | 밖 대기조로 남는다 — 위험 실내 일 `×0.3`(`outsideWatch` 로 세어진다, 5.6). 짝이 나오면 풀린다 (`fit`) | — | "대기조 — 출입구에서 기다립니다." (처음 한 번) | 새로 |
| S12 | 화학·사다리차 scba 대원 | 공기 | scba | 공기 < 30% | F01·F02 가 그대로(`kits: ['scba']`) | 0.30 | F01 | 있음(F01) |
| S13 | 구조정 대원 | 바닷가 수난·해일, 또는 빠른 물살 | 구조정(부대) | — | 보트(R2 `boat`) `×1.3`, 헤엄 `×0`(바다·해일) (방법, rank 0) | 0.07 | R2 SAY (까닭 `danger`) | 새로 |
| S14 | 구조정 대원 | 불타는 건물 | scba 없음 | — | 들어가지 않는다 | R1 | — | 있음(R1) |
| S15 | 지상 대원(소방 헬기가 물 현장 상공) | 수난, 같은 대상에 호이스트 작업이 열려 있다(작업판 `s.board` — 공개 지휘 상태) | — | — | 헤엄 `×0.5`(정본 — R2 의 상공 헬기 배율 ×0.7 은 R3 를 합칠 때 지운다, 3.7), 줄 확보(`tend`)·하류 차단(`catch`) `×1.2` — 헬기와 겹쳐 들어가지 않는다 (방법) | — | R2 SAY (까닭 `team`) | 새로 |
| S16 | 항공 구조대원(내려앉은 소방 헬기) | 위험 실내 | scba | — | 짝 = 같은 헬기의 다른 대원(5절) | — | — | 있음(5절 PAIRS) |
| S17 | 경찰 헬기 | 밤·연료 | 탐조등 | 연료 < 복귀 + 40초 | 탐조·복귀 | R1 | R1 | 있음(R1) |
| S18 | 의료 헬기 | 위중 1명 | 의사 장비 | — | E04 | — | — | 있음(E04) |
| S19 | 사다리 조작원 | 화재 | — | — | 실내 수색 `×0.3`(현장에 다른 scba 대원이 둘 이상일 때), 급수·고가 방수 먼저. 고가 방수의 선택은 R2 `aerial` (`fit`) | — | — | 새로 (선호 −0.2 는 R1) |
| S20 | 사다리차 | 위층 연기 | 송풍기 | — | 배연(R2 `ventilate`) | R2 | R2 | 있음(R2) |
| S21 | 로봇 조작 요원 | 살아 있는 장치 | 로봇 **알려진 고장**·없음 | — | 해체 자리에서 빠져 출입 통제(`perimeter +0.2`). `defuse` 는 S06 의 기본 자격대로 이미 0 (`fit`) | — | (지시 무전 끝) "(로봇 고장)" | 새로 |
| S22 | 특공 팀장 | 무장 대치, 진입 결정 전 / 뒤 | — | — | 결정 전 `negotiate +0.15`(지휘·협상), 결정 뒤 `engage +0.1`(진입조 지휘) (`fit`) | — | — | 새로 |
| S23 | 폭발물 처리 요원 | 살아 있는 장치 | — | **중상** 또는 **동요** | 손으로 하는 해체(`suitDefuse`·`bareDefuse`) `×0` — 작동하는 로봇이 현장에 있으면 로봇 조작 요원이 `robotDefuse` 로, 없으면 고를 방법이 없어 맡지 않는다(해체 `WORK_MODE` — 3.7) → B3 블록이 폭발물 처리반을 더 부른다 (방법, rank 1) | band 1 | "손이 떨립니다 — 해체를 넘기겠습니다." (처음 한 번, 놓을 때) | 새로 |
| S24 | 저격·관측수 | 결정적 저격 조건(R2 `sniper`) | 저격 소총 | **동요** 또는 **중상** | 저격 `×0` — 인질 곁 한 발은 흔들리는 손으로 쏘지 않는다. 엄폐 사격·봉쇄는 그대로 (방법, rank 1) | — | R2 SAY (까닭 `shaken`·`hurt`) | 새로 |
| S25 | 수난·항공 구조대원 | 수난 구조 | — | 지구력 < 30 | 헤엄 `×0` — 보트·줄·장대만 (방법, rank 1) | 30 | R2 SAY (까닭 `tired`) | 새로 |
| S26 | 진입대원(파괴)·폭발물 처리 요원 (장약을 든 사람) | 잠긴 문·막힌 문(문을 막은 잔해) — 폭파 진입(R2 `charge`, **사용자 결정 2026-11-15**, R2 §4.2a) | 폭파 장약 | — | **인질 위치를 모르면 쓰지 않는다**: 믿음에 인질을 잡은 용의자(`hos` 사실의 `hostage`)가 있는데 그 용의자 믿음이 10초보다 낡았거나 그 위치가 대상 문(`dc.m.tile`)에서 4칸 안이면 `charge ×0` — 인질은 그 곁에 있으므로 "문 뒤에 있을지 모른다"를 믿음의 나이와 거리로 본다(R2 `can` 의 구조 대상 2.5칸보다 넓게). 진입 결정 전(협상·대치)은 R2 의 조건 ⑤ 가 이미 막는다. 그 밖이고 진입 순간(`sit.entryOrdered`)이면 `×1.2` — 문이 한 번에 열려 인질 곁의 용의자에게 닿는 틈이 짧다 (방법, rank 0) | 10초 · 4칸 | (막을 때) R2 SAY 앞말 "인질 위치를 몰라 — " (까닭 `hostage` → `danger`) | 새로 |

### 3.5 공통 (`common` — 모든 분야)

| 줄 | 누구 | 상황 | 장비 | 상태 | → 행동 (자리) | 문턱 | 기록 문구 (예) | 구분 |
|---|---|---|---|---|---|---|---|---|
| G01 | **특수 표 대원**(`who.doc: ['special']` — 경찰·소방·의료 표 대원은 P12·F14·E11 이 맡는다. 한 대원에게 부상 줄이 둘 걸리지 않는다) | 무거운 일: `engage`·위험 실내 일·`rescueMate`(위험 구역)·`waterRescue` | — | **중상**(신고 band 1) | 무거운 일 `×0.35`, 가벼운 일(H1 `LIGHT_WORK` — 정본 H1 §2.7) `+0.15` (`fit`) | band 1 (75 에서 풀림) | (자기 신고) "부상 — 체력 저하." | 새로 |
| G02 | 누구나 | 진입(`engage` 의 진입 결정 뒤)·위험 실내 일 | — | **동요** | `×0.6`(`fit`), 그리고 R2 의 `caution +0.2`(상한 1.1 — `G02b`, 방법) | 4.3 | — | 새로 |
| G03 | 누구나 | 위험 실내 새 일 | — | 지구력 < 30 (보고 모드에서는 조직 정보 — 2.4) | `fit` 0. 하던 일은 지금처럼 22 까지 | 30 | — | 새로 |
| G04 | 누구나 | 내 짝이 쓰러졌다(믿음 `mate` `down`) | — | — | 그 짝의 `rescueMate +0.2`(짝이 먼저 간다). H1 의 자격(hot 이면 경찰, 위험 구역이면 scba)은 그대로 (`fit`) | — | (H1 문구) | 새로 |
| G05 | 누구나 | 판단 지점에서 막힘 | — | 지원 옴 | 기다림 상한을 늘린다 — **줄로 등록하지 않는다**. 각 줄의 `maxWait` 함수가 `st.backup` 을 본다(4.4 표가 값의 전부) | — | — | 각 줄에 들어 있음 |
| G06 | 누구나 | 쉬는 중·쉬고 싶음 | — | 지구력 < 22 / < 40 | 휴식·붙잡음 | 지금 | 지금 | 있음(지금) |
| G07 | 누구나 | 운반 중 | — | — | 교본의 의무·행동을 걸지 않는다(운반이 곧 나가는 길) — **줄로 등록하지 않는다**. `docDuty`·`docAct` 첫머리의 조건 | — | — | 엔진의 조건 |
| G08 | 누구나(`SOLO_OK` 제외) | 짝이 위험 실내 일(또는 확보 전 무장 현장의 수색)을 맡았다 | — | 손이 비었거나 더 낮은 바깥 일 | **짝 동행**(`pair` — 5.4) (행동, 점수 `0.5 + 0.4 × 짝 일의 우선순위 + 0.12`) | — | "{mate}, 같이 들어간다." (20초에 한 번) | 새로 |

### 3.6 등록 칸 표 (구현은 이 표대로 — 각 파일 안의 등록 순서도 이 순서)

줄임말: **HZ** = 위험 실내 일(3절 읽는 법 — `w` 가 그 종류이고 대상 구역이 `fireRisk`, 판단부 도움 함수 `hazWork(c)`), **gunFight** = `sit.threat` 이 총기이고 `fight`, **mates(h)** = 같은 용의자(`task.hostile === h`)의 `arrest`·`engage` 를 맡은 다른 활동 대원, **bk** = `st.backup`, **usable** = 2.5 의 `kits` 판정. 효과의 `[…]` 는 그 효과만의 `works`·`methods`·`when`. `note`·`report` 는 분야 표의 문구.

| id | 자리 | who | works · gate · methods | kits / noKits | when (요지) | effect | rank | why |
|---|---|---|---|---|---|---|---|---|
| G01 | fit | doc special | — | — | `st.band ≥ 1` | mul .35 [`engage`·HZ·`rescueMate`·`waterRescue`] · add .15 [H1 `LIGHT_WORK`] | 1 | hurt |
| G02 | fit | — | `engage`·HZ | — | `st.shaken` (engage 는 `entryOrdered` 일 때) | mul .6 | 1 | shaken |
| G02b | method | — | — | — | `st.shaken` | 기록 전용 `methodMul 1` — `caution +0.2`(상한 1.1)는 `methods.ts` 가 `dc.st.shaken` 으로 올린다(11.1). 1등이 바뀌었을 때 센다 | 1 | shaken |
| G03 | fit | — | HZ | — | `st.stamina < 30` && 새로 맡는 일(`a.task?.workId !== w.id`) | mul 0 | 1 | tired |
| G04 | fit | — | `rescueMate` | — | `w.mate === a.buddy` | add .2 | 2 | buddy |
| G08 | act | `SOLO_OK` 아님 | — | — | 짝이 HZ(또는 `hot` 의 `search`)를 맡았고, 나는 임무 없음·`standby` 이거나 내 일 우선도 < 짝 일 우선도 − 0.1 | act `pair`, score `0.5 + 0.4p + 0.12` | 2 | buddy |
| P01 | gate | dept police | `arrest` · `closeIn` | kits taser | 위협 흉기·맨손 `fight`, `d ≤ 4`, mates(h) 가운데 2.6칸 안 ≥ 1, `!see.stunned` | block 8 | 1 | kit |
| P02 | gate | dept police | `arrest` · `closeIn` | noKits taser·beanbag | 위협 흉기 `fight`, mates(h) 0, `!civAtRisk` | block `bk ? 30 : 20` | 1 | alone |
| P03 | gate | dept police | `arrest` · `closeIn` | noKits taser | 위협 흉기·맨손 `fight`, mates(h) ≥ 1 이고 모두 2.6칸 밖 | block 6 | 2 | buddy |
| P05 | gate | dept police | `engage` · `coverFire` | — | `st.gun`, 위협 총기, `entryOrdered`, 인질 갈래가 아님 | choose cover | 1 | danger |
| P07 | gate | dept police, `SOLO_OK` 아님 | `engage` · `roomEntry`·`breach` | — | 혼자(방: 2.6칸 안 `engage` 동료 0 / breach: 그 문 진입조 1), `!(gunFight && civAtRisk)` | block `bk ? 120 : 60` | 2 | alone |
| P08 | act | `st.gun` 있음 | — | — | `ammoBox > 0` && ((`ammoLow` && 믿음 `fight` 위협 없음) ‖ (`ammoCrit` && `!underFire`)) | act `rearm`, score `ammoCrit ? 0.97 : 0.78` | 1 | lowAmmo |
| P09 | act | `st.gun` 있음 | — | — | gunFight && `ammoCrit` && (`underFire` ‖ `ammoBox === 0`) && 숨을 자리 있음 && 기억 없음 | act `cover`, 0.97 | 0 | lowAmmo |
| P10 | act | `st.gun` 있음 | — | — | `reloading` && `underFire` && `!inCover` && 위협 있음 | act `cover`, 0.97 | 1 | lowAmmo |
| P11 | act (`swap: 'retreat'`) | dept police | — | — | `underFire` && 40 ≤ hp < 70 && `!bleeding` && `!inCover` && 위험 점수에 X6 조짐 몫 0 && 숨을 자리 있음 | act `cover`, score `c.dng`(후퇴 점수 그대로) | 1 | danger |
| P12 | fit | doc police | — | — | `st.band ≥ 1` | mul .35 [`engage`·`arrest`] · add .15 [H1 `LIGHT_WORK` − `negotiate`] · add .2 [`negotiate`, when composure ≥ .6] | 1 | hurt |
| P14 | gate | dept police | `engage` · `closeIn` | — | 위협 총기·인질, 현장 경찰 누구도 섬광탄 쓸 수 없음(동료 장비), `!(2.6칸 안 동료 && facing 차 > 100°)` | block `섬광탄 가진 부대가 오는 중 ? 40 : 20` | 1 | hostage |
| P15 | gate | — | `engage` · `bangUse` | kits flashbang | `c.kit('flashbang') === 1` && 동시 진입 && 위협 `d > 3` | choose save | 3 | kit |
| P16 | act | — | — | — | `a.task.kind === 'negotiate'` && 위협 `fight` && 숨을 자리 있음 | act `cover`, 0.93 | 1 | danger |
| P17 | fit | dept police, `SOLO_OK` 아님 | `search` | — | `sit.hot` && 실내 구역 && `buddyOf(w) === null` | mul 0 | 2 | alone |
| P17b | gate | dept police | `search` · `interiorEntry` | — | `sit.hot` && 짝이 `pair` 로 4칸 안에 따라오지 않음 | block `bk ? 30 : 20` | 2 | buddy |
| P20 | method | dept police | `traffic` · `blockLane` | — | `sit.lanes2nd` ‖ 밤 ‖ 비·안개 | mul 1.5 | 3 | danger |
| P22 | fit | `st.gun` 있음 | — | — | `ammoCrit`(0 포함) && 믿음 속 총기 위협 있음 | mul 0 [`engage`·`perimeter`, **drop**] · add .15 [`traffic`·`interview`] | 1 | lowAmmo |
| F01 | duty | — | — | kits scba | (`inHazard` ‖ `sense.smoke > 0.25`) && `air < 0.30` && `!carrying` | duty `airOut` | 0 | lowAir |
| F02 | duty | — | — | kits scba | `inHazard` && 짝(`a.buddy`)이 `airOut`·`pairOut`·`retreat`·`evacuate` 중이거나 `withdrawn` && `!carrying` | duty `pairOut` | 0 | buddy |
| F03 | fit | — | HZ | kits scba | `air < 0.50` | mul 0 | 1 | lowAir |
| F03b | method | — | `suppress` · `interior` | kits scba | `air < 0.50` | mul 0 | 1 | lowAir |
| F04 | fit | `SOLO_OK` 아님 | HZ | kits scba | `buddyOf(w) === null` && !(`carry` && 대상 3칸 안) | mul 0 | 2 | alone |
| F04b | method | `SOLO_OK` 아님 | `suppress` · `interior` | kits scba | `buddyOf === null` | mul 0 | 2 | alone |
| F04c | gate | `SOLO_OK` 아님 | HZ·`suppress` · `interiorEntry` | kits scba | 짝이 따라오지 않음(5.4 끝) && !(`carry` && 대상 3칸 안) | block `bk ? 30 : 20` | 2 | buddy |
| F05 | gate | — | HZ·`suppress` · `interiorEntry` | kits scba | `outsideWatch < need`(5.6) && `!victimInside` | block `bk ? 30 : 20` | 2 | outside |
| F05b | method | — | `suppress` · `interior` | kits scba | `outsideWatch < need` && `!victimInside` | mul 0 | 2 | outside |
| F06 | fit | dept fire | `search` | kits tic | 대상 구역 믿음 불 > 0.25 | add .15 | 3 | kit |
| F07 | method | — | `search` · `feel` | noKits tic | 실내 && `sense.smoke > 0.5` | mul 1.6 | 3 | noKit |
| F08 | method | — | `suppress` · `pulse` | kits hose | 자기 부대 물 < 30% && `!u.hydrant` | mul 1.6 | 3 | kit |
| F09 | fit | — | `search`·`carry`·`extricate`·`escort` | kits hose | 자기 부대 물 0 && `!u.hydrant` | add .1 | 3 | kit |
| F12 | method | — | `waterRescue` · `swim` | noKits pfd | `m.flow ≥ 0.07` | mul 0 | 0 | danger |
| F13 | fit | — | — | noKits turnout | `sit.wDanger ≥ 1` | mul 0 | 1 | noKit |
| F14 | fit | doc fire | — | — | `st.band ≥ 1` | mul .35 [HZ] · mul .6 [`suppress`] · add .2 [H1 `LIGHT_WORK`] | 1 | hurt |
| F16 | fit | dept fire | `search` | — | `rookie` && HZ && 짝이 있고 짝은 신입 아님 | mul .5 | 2 | buddy |
| F18 | method | units engine·ladder | `traffic` · `blockLane` | — | `s.kind === 'traffic'` && (믿음 `haz leak` active ‖ 불 믿음 > 0) && 그 지점 통제 전 | mul 1.5 | 3 | danger |
| E01 | fit | — | `triage` | — | 늘(작업이 있을 때) | add .3 [when role paramedic] · add .2 [emt] · add .1 [doctor] | 2 | triage |
| E02 | method | — | `treat` · `stay` | kits aed | 대상 믿음 band 2 && 거동 불가 | mul 1.3 | 3 | kit |
| E03 | method | — | `treat` · `rush` | noKits aed | 대상 믿음 band 2 | mul 1.5 | 3 | noKit |
| E04 | method | roles doctor·flightNurse | `treat` | kits doctorKit·alsBag | 대상 믿음 band 2 | mul 1.3 [`stay`] · mul .7 [`rush`] | 3 | kit |
| E05 | fit | dept ems | `treat` | — | `sit.hot` && 대상 믿음 `where 'safe'` | 기록 전용 `mul 1`(자격은 `fitFor` 기본 규칙 — 11.1) | 2 | protocol |
| E08 | gate | — | `carry` · `carryHold` | — | 같은 `cas` 의 `treat` 를 하는 구급 동료 && `sense.smoke ≤ 0.3` && `sense.heat ≤ 0.3` && `!inHazard` && `wDanger < 2` | block 15 | 2 | protocol |
| E11 | fit | doc ems | — | — | `st.band ≥ 1` && 현장에 다른 활동 구급 대원 | mul .5 [`treat` — 대상이 안전 구역 밖] · add .2 [H1 `LIGHT_WORK`] | 1 | hurt |
| E12 | gate | — | `treat` · `laneTreat` | — | 대상이 차로 줄 위 && 그 방향 `ctl` 사실 없음 && !(차 안에 갇힘 && 구출 전) | block 20 | 1 | danger |
| E13 | gate | — | `carry` · `carryStart` | kits spineBoard | `s.kind` 교통·붕괴 && 대상 거동 불가 && `sense` ≤ 0.3 | choose immobilize | 3 | kit |
| E14 | method | — | `carry` · `drag` | noKits stretcher | `st.alone` && `sense.smoke > 0.3` && 대상 거동 불가 | mul 1.6 | 1 | danger |
| E18 | fit | dept ems | `treat` | — | 대상 믿음 band 2 && `st.stamina < 30` | mul .3 | 2 | tired |
| E19 | fit | roles emt | `treat`·`load`·`carry` | — | `rookie` && 현장에 1급 응급구조사·의사가 활동 | mul .6 [`treat`, when 대상 band 2] · add .1 [`load`·`carry`] | 3 | protocol |
| E20 | fit | dept ems | `treat` | — | `st.shaken` && `sit.hot` && 대상 `where 'safe'` | mul 0 | 1 | shaken |
| S01 | gate | units swat | `engage` · `breach` | — | 그 문 진입조에 방패를 쓸 수 있는 대원이 있고 그 대원의 신고가 band 0·동요 아님 | choose stack | 2 | protocol |
| S02 | fit | — | `engage`·`perimeter` | kits sniper | `s.kind === 'armed'` | mul .3 [`engage`, when `!(sit.threat?.weapon === 'gun' && ((sit.threat.hostage && sit.threat.state === 'fight') \|\| sit.negotSec > 60))` — R2 저격 조건이면 깎지 않는다] · add .1 [`perimeter`] | 3 | kit |
| S05 | fit | dept police | `engage` | kits flashbang | `entryOrdered` | add .1 | 3 | kit |
| S06 | method | — | `defuse` · `robotDefuse` | kits robot | `sit.liveBomb` | mul 1.3 | 3 | kit |
| S06b | fit | roles bombTech | `defuse` | — | `sit.liveBomb` && 현장에 작동하는 로봇(`gear.kitHas(robot)`)을 든 활동 동료가 있음 | mul .4 | 3 | kit |
| S07 | method | roles bombTech | `defuse` · `bareDefuse` | noKits robot | — | mul 0 [when !(방호복 없음 ‖ 옮길 수 없는 사람이 장치 6칸 안)] · mul 2 [when 방호복 있음 && 옮길 수 없는 사람이 6칸 안] | 0 | danger |
| S08 | fit | — | `defuse`·`perimeter`·`carry`·`escort`·`rescueMate` 를 뺀 모두 | — | `sit.liveBomb` && `sit.defusing` && 작업 대상이 장치 6칸 안 | mul 0 | 0 | danger |
| S10 | fit | units hazmat | `search` | kits gasMeter | `s.kind === 'hazmat'` && HZ | add .15 | 3 | kit |
| S11 | fit | roles hazLead | HZ | — | 자기 부대의 다른 대원이 위험 실내에 있다(동료의 겉) | mul .3 | 2 | outside |
| S13 | method | units boat | `waterRescue` | — | 바닷가 수난·해일 ‖ `m.flow ≥ 0.07` | mul 1.3 [`boat`] · mul 0 [`swim`, when 바닷가·해일] | 0 | danger |
| S15 | method | — | `waterRescue` | — | 같은 대상의 `hoist` 작업이 작업판에 열림 | mul .5 [`swim`] · mul 1.2 [`tend`·`catch`] | 2 | team |
| S19 | fit | roles ladderOp | `search` | — | `s.kind === 'fire'` && 현장 다른 scba 활동 대원 ≥ 2 | mul .3 | 3 | protocol |
| S21 | fit | roles robotOp | `perimeter` | noKits robot | `sit.liveBomb` | add .2 | 3 | noKit |
| S22 | fit | roles swatLead | `negotiate`·`engage` | — | `s.kind === 'armed'` | add .15 [`negotiate`, when `!entryOrdered`] · add .1 [`engage`, when `entryOrdered`] | 3 | protocol |
| S23 | method | roles bombTech | `defuse` · `suitDefuse`·`bareDefuse` | — | `st.band ≥ 1` ‖ `st.shaken` | mul 0 | 1 | hurt |
| S24 | method | roles marksman | `engage` · `sniper` | — | `st.shaken` ‖ `st.band ≥ 1` | mul 0 | 1 | shaken |
| S25 | method | groups water·rescue | `waterRescue` · `swim` | — | `st.stamina < 30` | mul 0 | 1 | tired |
| S26 | method | roles breacher·bombTech | `force`·`clear` · `charge` | kits charge | 믿음 `hos` 가운데 `hostage` 인 용의자가 있음 | mul 0 [when 그 용의자 믿음의 나이 > 10초 ‖ `dist(그 위치, dc.m.tile) ≤ 4`] · mul 1.2 [when 그 밖 && `sit.entryOrdered`] | 0 | hostage |

**행동 줄끼리의 순서**(한 판단에 교본 후보 하나 — 2.6): 의무는 F01 > F02(둘 다 rank 0, 등록 순서). 점수 후보는 P09(0) > P08 = P10 = P16(1 — 등록 순서 P08 > P10 > P16) > G08(2). P08 과 P10 은 `underFire` 로 서로 겹치지 않는다(P08 의 위급 갈래는 `!underFire`, 평소 갈래는 교전 없음). P11 은 이 경쟁에 들지 않는다(후퇴 후보를 바꿔 끼울 뿐 — `swap`).

### 3.7 R3 가 R2 의 `METHOD` 에 더하는 행

R2 의 틀(`can`·`kits`·`pref`·`plain`·`record`·`SAY`·`WORK_MODE`)을 그대로 쓴다. 효과는 **진압·수색 방법은 R2 의 `methodRun.ts` 의 그 임무 실행부, 이송·교통 통제·해체 방법은 R3 의 `doctrineRun.ts`**(`runCarry`·`runTraffic`·`runDefuse`)에 둔다(11.1). 진압 방법 행의 `risk` 는 R2 표와 같이 0 이다(R2 §4.5).

| 방법 | 임무 | 장비 | 조건 (`can`) | 실행·효과 | pref / plain | 단계 |
|---|---|---|---|---|---|---|
| `feel` 벽 더듬기 | `search` | — | 실내 구역, 감각 연기 > 0.5(도착 재선택에서도 본다) | 경유점을 그 구역에서 벽과 이웃한 바닥 칸으로만, 간격 ×0.75, 경유점마다 0.8초 멈춤. 탐지 반경은 그대로 | 0.5 / — | 3 |
| `pulse` 끊어 쏘기 | `suppress` | `hose` | 자기 부대 물 < 30%, 소화전 연결 안 됨 | 진압 효과 ×0.85, 물 소모 ×0.65 | 0.6 / — (F08 ×1.6 → 0.96 > `interior` 0.85 — 조건이면 1등) | 3 |
| `pack` 업기 | `carry` | — | 늘 | 지금 동작 | 0.7 / plain | 6 |
| `drag` 끌기 | `carry` | — | 대상 거동 불가 | 옮기는 동안 대상·대원이 받는 연기 피해 ×0.5(낮게), 속도 ×0.85(혼자 업기 대비) | 0.5 / — (E14 ×1.6 → 0.80 > `pack` 0.70 — 조건이면 1등) | 6 |
| `litter` 들것 | `carry` | `stretcher` | 동료가 함께 든다 | R1 의 들것 배율 그대로 — **기록 전용**(`record`) | — | 6 |
| `post` 통제 | `traffic` | — | 늘 | 지금 동작(경광봉이면 R1 의 ×0.85) | 0.75 / plain | 6 |
| `blockLane` 차량 차단 | `traffic` | — (부대 차량) | 그 지점 통제 전 | 통제 지점에 닿는 순간 `s.laneShield` 에 그 지점을 넣고 설치 시간 +3초. `hazards.tickLane` 은 새 차를 만들 때 그 차가 들어오는 방향의 지점이 `s.laneShield` 에 있고 아직 통제 전이면 부주의 판정을 `s.rng.chance(p × 0.4)` 로 한다(호출 수는 그대로). 통제가 끝나면 그 방향에서는 원래 차가 들어오지 않으므로 효과는 설치하는 동안의 것이다 | 0.6 / — | 6 |
| `robotDefuse` 로봇 해체 | `defuse` | `robot` | 장치에서 8칸 이내·시야인 자리에 닿을 수 있다 | 로봇 조작 요원이 그 자리에서 원격: 필요 시간 ×1.6, 실수 확률 ×0.3. **R1 의 로봇 수동 효과(같은 현장에 로봇이 있으면 실수 ×0.6·가짜 확인 10 → 5초)는 이 방법에는 곱하지 않는다** — 이 배율이 대신한다. 처음 시작할 때 `kitWorks(robot)`: 숨은 고장이면 `switchMethod('broken')` → 로봇 조작 요원에게는 다음 방법이 없어 `finish(false, 'nomethod')`(`EQUIP_FAIL` 은 R1 의 `kitWorks` 가 남긴다). 그 뒤 `hasKit(robot)` 이 거짓이라 S06 의 기본 자격이 사라지고 처리 요원이 맡는다 | 0.9 / — | 5 |
| `suitDefuse` 방호복 해체 | `defuse` | `bombSuit`(해체 자격 `eodKit` 은 `fitFor` 가 본다 — R2 의 `kits` 는 "하나라도"라 `eodKit` 을 함께 적으면 방호복 없는 요원도 이 방법을 고른다) | 늘(장비가 있으면) | 지금의 해체(시간·실수 그대로). R1 의 로봇 수동 효과는 같은 현장에 작동하는 로봇 대원이 있으면 그대로 받는다 | 0.75 / plain | 5 |
| `bareDefuse` 맨몸 해체 | `defuse` | `eodKit` | S07 의 조건 | 방호복을 벗고 한다: 필요 시간 ×0.75. 그 해체 동안 R1 의 `armorOf`·`blastFactor` 가 `bombSuit` 를 세지 않는다(`a.task.method === 'bareDefuse'` — 11.1) | 0.5 / — | 5 |

- `WORK_MODE` 에 더하는 줄: `carry` — `pack`(늘 남는다, null 이 생기지 않는다), `traffic` — `post`(같다), `defuse` — **null 이면 맡지 않는다**(`waterRescue` 와 같이 `fitFor(defuse)` 는 기본 자격 × `methodFit > 0`). 그래서 다친·동요한 처리 요원(S23)과 로봇이 고장 난 로봇 조작 요원은 해체를 맡지 않고, 맡을 사람이 없으면 B3 블록이 폭발물 처리반을 부른다.
- `SAY` 에 더하는 문구: 위 분야 표의 기록 문구. R3 의 까닭 여섯(`hurt`·`alone`·`lowAir`·`lowAmmo`·`shaken`·`tired`)의 앞말: "부상으로", "혼자라", "공기가 부족해", "탄약이 없어", "손이 떨려", "지쳐서".
- **까닭의 사상 표 — 교본 줄의 `DocWhy` → R2 `MethodWhy`**(`t.mwhy`·`MethodUse.why` 는 `MethodWhy` 라 `DocWhy` 를 그대로 넣을 수 없다). R2 §3.4 의 까닭 순서에서 1(`switchMethod` 가 넘긴 것) 다음·2(`noGear`) 앞에 둔다: 교본 배율을 빼고 셈한 1등이 다르면, 그 차이를 만든 줄 가운데 `rank` 가 가장 작은 줄의 `why` 를 아래로 바꿔 쓴다.

  | `DocWhy` | `MethodWhy` |
  |---|---|
  | `hurt`·`alone`·`lowAir`·`lowAmmo`·`shaken`·`tired`·`danger`·`team` | 같은 이름 |
  | `noKit` | `noGear`(`missing` = 그 줄의 `noKits[0]`) |
  | `outside` | `alone`(밖 대기조가 모자라 혼자인 셈) |
  | `kit`·`protocol` | `usual`(R2 의 평소 까닭 — 교본 줄과 무관한 선택과 같은 말을 쓴다) |
  | 그 밖(`buddy`·`civ`·`hostage`·`triage`·`backup`) | `team`(`buddy`·`backup`) · `danger`(`civ`·`hostage`) · `usual`(`triage`) |

- **진압의 외부 방어 조각**(R3 0단계에 `methods.ts` 에 더한다 — R2 §4.5): `defensive` 의 `can` 에 "또는 `c.dc && docMethodMul(c.dc, 'interior') === 0`", 그리고 R2 의 몸 상태 조건 `r.health < 50` 을 `c.dc.st.band ≥ 1`(자기 모드는 몸, 보고 모드는 `crew` 신고)로 바꾼다. 배연 뒤의 예정된 전환(`ventilate` → `interior`)도 같은 검사로 막히면 `defensive` 로 바꾸거나 `finish(true)`.
- **상공 호이스트의 헤엄 배율은 S15 하나**: R2 §4.1 의 "상공에 호이스트 헬기가 있다: swim ×0.7" 은 R3 를 합칠 때 지운다(같은 상황을 두 문서가 따로 깎으면 ×0.35 가 되고 R2 의 손잡이가 S15 를 모른다).

---

## 4. 상태가 바뀔 때 — 문턱과 되돌아오는 조건

CLAUDE.md 함정 "쉬는 대원의 왕복": 들어가는 문턱과 나오는 문턱이 같으면 대원이 두 행동 사이를 오간다. 교본의 모든 상태 문턱은 **간격**을 두거나 **기억**(`a.docMem`)·**붙잡는 계속 점수**로 막는다.

### 4.1 자기 신고 (`selfReport` — `brain.think` 의 `perceive` 바로 다음, `flushOutbox` 앞)

매 판단마다 자기 몸으로 `CrewBelief` 를 계산하고, 서명(`band·air·ammo·shaken`)이 `a.crewSig` 와 다르면 `learn(sim, a, mkFact('crew', a.rid, v, r.name, sim.t, 1, true, 글))`. `flushOutbox` 보다 먼저 두므로 같은 판단 주기에 무전이 나간다.

- **바로·중요로 보낼 것**: `air === 2`·`ammo === 2`·`band` 가 올라감. `flushOutbox` 의 `prompt` 조건에 `f.type === 'crew' && (f.value.air === 2 || f.value.ammo === 2 || f.value.band >= 1)` 를 더하고(지휘관이 기다리는 정보 — CLAUDE.md 함정 "보고 지연 사이의 중복 지시"), 같은 술어를 `agents.ts` 의 중요 사실 판정(`hot()` — 지금 `IMPORTANT` 와 함께 무전의 `imp` 를 정하는 곳)에도 더해 `imp 2` 로 나가게 한다(그러지 않으면 바로 나가도 `shown` 이 비고 `imp 0` 으로 기록된다 — X6 §3 이 조짐에 한 것과 같다).
- 그 밖의 변화(나아짐)는 묶음 보고로, 글 없이(`text: ''` — 기록 창을 붐비게 하지 않는다. 11.2-5).
- `significant()` 에 `'crew'` 갈래: `old.band !== v.band || old.air !== v.air || old.ammo !== v.ammo || old.shaken !== v.shaken`.
- **글은 사실만**: "공기 30% 미만." · "공기 50% 미만." · "부상 — 체력 저하." · "탄약 마지막 탄창." · "탄약 소진." · (동요는 글을 남기지 않는다 — 4.3). 무엇을 하겠다는 말은 넣지 않는다(2.7).

### 4.2 상태 표

| 상태 | 들어가는 문턱 | 행동 | 되돌아오는 조건 | 왕복을 막는 것 |
|---|---|---|---|---|
| 공기 (scba) | 위험 실내·연기 속에서 `air < 0.30` | 공기 탈출 의무 → 교체 | 위험 실내 일의 `fit` 은 `air ≥ 0.50` 부터(F03) | 문턱 간격 0.20. 교체 없이는 0.50 을 넘지 못한다(공기는 줄기만 한다). 탈출 중에는 `return`(의무). 공기 판정은 `kitQty / airFull`(비율)이라 60초 아래에서도 꺼지지 않는다(2.4) |
| 공기 (미리) | 바깥, 손이 빔, `air < 0.50`, 예비 > 0 | R1 공기통 교체 후보 0.7 | 교체 끝 | 예비 0 이면 후보 없음 |
| 탄 | `ammoLow` 이고 믿음 속 교전 없음 | 재보급 0.78 (P08) | `uses > magSize` | 상자 0 이면 후보 없음 + `docMem`(사건 끝까지) |
| 탄 (위급) | `ammoCrit`·0 이고 총기 위협 교전 | 피격 중이면 엄폐 0.97(P09) → 4초 피격 없으면 재보급 0.97(P08). 총기 상대 `engage`·`perimeter` 는 놓는다(P22 `drop`) | 보급 뒤 `ammoCrit` 풀림 | 엄폐 12초 상한, 같은 위협에 `docMem` 20초. 놓은 일은 `fit` 0 이라 보급 전에는 다시 받지 않는다 |
| 재장전 | 탄창 0 | 2~3초 사격 멈춤. 피격 중이고 엄폐가 아니면 엄폐로(P10 0.97) | 시간 | 재장전 자체는 자동 — 판단 아님 |
| 부상 (중상) | 자기 신고 band 0 → 1: 체력 ≤ 70 | 무거운 일 ×0.35, 가벼운 일(H1 `LIGHT_WORK`) +0.15 | 신고 band 1 → 0: 체력 ≥ 75 | 5 의 간격(처치로 체력이 70 언저리를 오갈 때). 신고는 서명이 바뀔 때만. H1 `bandOf` 의 40 경계(≤ 40 이면 2)는 그대로 |
| 부상 (위중·출혈) | 체력 ≤ 40, 또는 출혈 ≥ 0.06 && 체력 < 70 | H1 의 물러남. 대기 지점에서 처치 뒤 병원이 필요 없으면 가벼운 일로 돌아온다(H1 §3.6a — 사용자 결정 2026-11-15 "가벼운 일은 계속"). 그 뒤 `injured` 인 동안 H1 `LIGHT_WORK` 밖은 `fit` 0 | H1 (현장마다 한 번 — `a.lightBack`) | H1 |
| 지구력 | 위험 실내 새 일: < 30. 하던 일: < 22 휴식(지금) | 새 일 금지 / 휴식 | 휴식은 40 까지 붙잡고 55 에서 끝(지금) | 30 / 22 / 40 의 간격. 지금 `brain` 의 휴식 계속 점수 0.96 그대로 |
| 동요 | 피격, 6칸 안에서 동료가 쓰러지는 것을 봄, 6칸 안 폭발 — 동요 중이 아니고 끝난 뒤 10초가 지났을 때만 | `a.shaken = sim.t + 20 × (1.3 − composure)`(6~26초): 진입·위험 실내 ×0.6, 방법 `caution +0.2`, 저격·손 해체 금지(S23·S24) | 시간 | 동요 중에는 다시 걸리지 않는다(연장 없음). 끝난 뒤 10초 면역(`a.shakenOff`) |
| 혼자 | 쓸 수 있는 짝이 없고 6칸 안 같은 부서 동료 0 | 위험 실내 금지(F04), 단독 진입 보류(P07), 흉기 거리 유지(P02) | 짝이 생김(`rebuddy`·동료 도착) | 판단 지점 기다림 상한 + 그 작업 `fit` 0 의 기억 30초(4.4 끝) |
| 지원 옴 | 같은 부서 부대가 이 사건으로 `enroute`·`turnout` | 기다림 상한을 늘린다 | 도착 | 상한 |

### 4.3 동요를 거는 자리 (실행·세계 쪽 — 상태를 바꾸는 그 코드)

- `hazards.tickHostiles` 의 대원 피격 줄(지금 `ta.underFireT` 를 정하는 곳)과 흉기·맨손 피습 줄(H1 이 `hurtEv` 를 남기는 곳).
- `agents.perceive` 에서 쓰러진 동료를 처음 보고 `mate` 사실을 만드는 곳(거리 6칸 안).
- `hazards.blast`(대원이 반경 + 3칸 안).
- 공통 함수 `doctrineRun.shake(sim, a)` 하나로 — 위 조건과 면역을 그 안에서 본다. 기록은 남기지 않는다(동요는 내부 상태다. 그 동요가 바꾼 결정이 기록된다 — 까닭 `shaken`). 동요는 `crew` 신고의 서명에 들어가 지휘관에게 알려진다(글 없이).

### 4.4 판단 지점의 기다림과 상한 (모든 사건은 끝난다)

판단 지점에서 막힌 대원은 임무를 쥔 채 그 자리에 선다(`t.gateAt = sim.t`, `t.gateId`, 라벨은 줄의 `short`). 상한(`maxWait`)이 지나면 줄마다 정한 **timeout 갈래**로 간다. **상한이 없는 판단 지점은 없다.**

| 판단 지점 | 기다리는 자리 | 상한 (지원 옴이면) | timeout 갈래 |
|---|---|---|---|
| `interiorEntry` (F04c·F05·P17b) | 문턱 칸 | 20초 (30) | 임무를 놓는다: `finishTask(…, false, 'doctrine')` — 실패 기록·`w.fails` 없음, 작업에 `holdUntil = sim.t + 10`, 대원 `docMem` 에 `w:<작업 id>` 30초(**그 작업을 30초 동안 맡지 않는다** — 아래). 지휘관은 다른 사람(대기조가 갖춰진 짝)에게 맡기거나 CF1 로 부대를 부른다. 진압은 F04b·F05b 가 실내 방법을 빼 두었으므로 이 판단 지점에 거의 오지 않는다(외부 방어로 간다) |
| `roomEntry`·`breach` (P07) | 문 앞 | 60초 (120) — 지원이 도착하면 그 전에 풀린다 | 진입(지금 동작 — `breach` 는 `breachExit` 로 자기 문만). 기록 "지원이 오지 않습니다 — 진입합니다." |
| `closeIn` 테이저 (P01) | 1.8칸 | 8초 | 붙는다(지금 동작) |
| `closeIn` 흉기 (P02) | 3칸 | 20초 (30) | 덮침(지금 동작) |
| `closeIn` 흉기 (P03) | 3칸 | 6초 | 덮침 |
| `closeIn` 인질 (P14) | 7.5칸 엄폐 자리(`wantLos`) | 20초 (섬광탄을 가진 부대가 오는 중이면 40) | 지금 동작(쏘지 않고 다가가 2.2초 덮침). 기록 "더 기다릴 수 없습니다 — 접근해 제압합니다." |
| `carryHold` (E08) | 환자 곁 | 15초 | 옮긴다 |
| `laneTreat` (E12) | 환자 곁 | 20초 | 처치 |

- **P14 에 상한이 있어야 하는 까닭**: 이 갈래(진입 결정 뒤 `engage` 의 인질 갈래)에서는 쏘지 않고, 진입이 결정되면 지휘관이 협상을 거둔다(`commander.syncBoard` — `entryOrdered` 이면 `negotiate` 를 `cancel`). 용의자는 11칸 안에서 본 대원 쪽으로 돌아서 5초 동안 경계하므로(`hazards.tickHostiles`), 7.5칸에서 기다리는 대원에게 "등졌다"는 거의 오지 않는다. 상한이 없으면 사격도 협상도 접근도 없는 채 한계 시간까지 간다 — CLAUDE.md 함정 "쏘지 않는다는 규칙에는 다른 행동이 따라야 한다"를 되돌리는 셈이다. 그래서 상한 뒤에는 지금의 접근·덮침(그 함정을 고친 코드)으로 간다.
- **`docMem` 의 두 뜻**(2.1): 판단 지점의 timeout 은 `w:<작업 id>` 열쇠로 "그 작업을 30초 동안 맡지 않는다"(`docFit` 이 0 을 돌려준다)를 남긴다 — **판단 지점을 건너뛰는 허락이 아니다**(그러면 30초 안에 같은 대원이 다시 배정될 때 대기조 없이 들어간다). 행동 줄(엄폐 ↔ 교전 늦추기, 보급할 탄약 없음)은 대상 열쇠로 "그 줄을 그 대상에 다시 걸지 않는다"를 남긴다.
- **기다리는 동안의 계속 점수**: 막힌 임무는 작업판의 일이므로 지금의 계속 점수(0.5 + 0.4p + 0.08)를 그대로 쓴다. 교본 행동 임무의 계속 점수는 `brain` 의 "현재 임무 계속" 갈래에 더한다: `cover` **0.97**(교전 지시 `0.56 + 0.4 × 0.9 = 0.92`·교전 계속 `0.5 + 0.4 × 0.9 + 0.08 = 0.94`·후퇴 0.95 보다 높게 — 12초 상한과 끝나는 조건으로 스스로 끝난다), `rearm` 탄 위급이면 0.96·아니면 0.86, `pair` `0.5 + 0.4 × 짝 일의 우선순위 + 0.12`. P11 이 후퇴 대신 낸 `cover` 도 0.97 이다(지금 후퇴의 계속 점수 0.95 보다 낮게 붙잡으면 판단 오차로 교전에 끌려 나간다). 지휘관은 이 임무들을 빼 가지 않는다(2.6).
- I1-a 의 멈춤 지표(`stall.candidates` — 지원이 오는 중이면 시계가 돌지 않는다)가 이 기다림을 거짓 교착으로 잡지 않는다. 지원이 없을 때의 기다림은 모두 상한(최대 60초)이 멈춤 문턱(`STALL_SEC` 60)보다 짧거나 같다 — 60초 상한인 P07 은 그 사이 사격·작업판 변화가 진전 신호다(8절에서 확인). 지원이 오는 동안의 120초(P07)는 시계가 돌지 않는다.

---

## 5. 짝(버디) 규칙과 혼자 남은 대원

### 5.1 누가 짝인가 — `PAIRS` (`doctrine.ts`, **역할 쌍**)

R1 의 `crew` 배열은 표준 자리에서 최소 인원 자리(`minDrop`)를 뺀 **압축 배열**이고 `Responder` 에는 자리 번호 칸이 없다. 그래서 짝은 자리 번호가 아니라 **역할 쌍**으로 적고, 같은 역할이 둘인 부대(유압 구조대원·화학 보호복 대원·기동대원·항공/수난 구조대원)는 `crew` 순서로 가린다(첫째 쌍이 먼저 가져간다). 최소 인원 부대(부대 규모 1·2 와 인근 도시 지원 부대 — R1 §5)는 표의 "최소" 열을 쓴다(`u.crew.length === minCrew(u.kind)`).

| 부대 | 표준 편성의 짝 | 최소 인원의 짝 (빠지는 자리) | 짝 없이 남는 사람 | 뜻 |
|---|---|---|---|---|
| 순찰 | [순찰 팀장, 순찰 경관] | 같다 | — | |
| 기동 | [기동대원, 기동대원] | [기동 조장, 기동대원] (기동대원 하나) | 표준: 기동 조장 | 조장은 지휘·협상. 위험한 일에는 `rebuddy` |
| 특공 | [방패수, 진입대원], [진입대원(파괴), 특공 팀장] | 같다 (저격·관측수) | 저격·관측수(`SOLO_OK`) | 저격수는 원래 따로 선다 |
| 폭발물 | [로봇 조작 요원, 경계 요원] | 없음 (경계 요원) | 처리 요원(`SOLO_OK`), 최소: 로봇 조작 요원 | "장치에는 한 사람만 다가간다". 로봇 조작 요원의 일(봉쇄·원격 해체)은 위험 실내 일이 아니다 |
| 펌프차 | [관창수, 진입대원] (안), [진압 팀장, 기관원] (밖 대기조) | [관창수, 진압 팀장] (진입대원) | 최소: 기관원(`SOLO_OK`, 밖) | **2인 진입 + 2인 대기**가 편성에서 바로 나온다. 최소 인원은 밖 대기조가 1명 → F05 가 같은 사건의 다른 소방 부대를 기다린다(오는 중이면 1명으로 충분) |
| 사다리차 | [관창수, 사다리 팀장] | 같다 (사다리 조작원) | 표준: 사다리 조작원(`SOLO_OK`, 밖) | |
| 구조 공작차 | [구조대원(유압), 구조대원(유압)], [구조대원(탐지), 구조대원(로프)] | [유압, 유압], [구조대원(로프), 구조 팀장] (탐지) | 표준: 구조 팀장 | |
| 화학 | [화학 보호복 대원(첫째), 측정·제독 대원] (안), [화학 팀장, 화학 보호복 대원(둘째)] (밖) | [화학 보호복 대원, 측정·제독 대원] (보호복 둘째) | 최소: 화학 팀장(밖 대기조 1명) | 안쪽 짝의 한 사람이 측정기를 든다(S10). 밖의 팀장은 대기조(S11) |
| 전문 구급차 | [1급 응급구조사, 응급구조사] | 없음 (응급구조사) | 구급 운전원(`SOLO_OK`) | 의료는 혼자여도 처치한다(5.5) |
| 일반 구급차 | [응급구조사, 구급 운전원] | 같다 | — | |
| 의료 헬기 | [의사, 항공 간호사] | 같다 | — | |
| 소방 헬기 · 구조정 | [항공 구조대원, 항공 구조대원] · [수난 구조대원, 수난 구조대원] | 같다 | — | 내리는 자리끼리 |

- **짝 맺기는 부대가 내린 뒤 한 번**(`doctrineRun.pairUp(sim, s, u)`): R1 의 `makeAgent(sim, rid, unitId, x, y, firstThink, rng)` 에는 현장 인자가 없어 "이 현장에 내린 짝"을 찾을 수 없다. 그래서 `makeAgent` 는 `buddy: -1` 만 넣고, `sceneManager.unitArrived` 의 대원 생성 반복이 **끝난 뒤** `pairUp` 을 한 번 부른다. `pairUp` 은 표의 쌍을 순서대로 보며, 그 부대의 대원 가운데 아직 짝이 없는 첫째 역할 A 와 (다른 사람인) 첫째 역할 B 를 찾아 서로 맺는다. 한쪽이 없으면(내리지 않았거나 출동 준비가 안 됐으면) 그 쌍은 건너뛴다 — 남은 사람은 −1 이고 다음 판단에 `rebuddy` 가 본다.
- 혼자 규칙에서 빠지는 역할(`SOLO_OK`): `marksman`·`bombTech`·`engineer`·`ladderOp`·`emsDriver`·`observer`. 이들에게 F04·P07·P17·G08 이 걸리지 않고 `rebuddy` 도 하지 않는다(원래 혼자 서는 자리). 짝 표에 들어 있으면(일반 구급차의 운전원) 남의 짝은 될 수 있다.

### 5.2 쓸 수 있는 짝 — `buddyOf(sim, s, a, w?)` (판단부)

짝 `b`(`a.buddy`)가 다음을 모두 만족하면 `b`, 아니면 `null`:
- `status === 'active'`, 부대에 `boardOrder` 없음, 다른 사람을 업고 있지 않음, 임무가 `cover`·`rearm`·`airOut`·`pairOut`·`retreat`·`evacuate`·`rehab` 가 아님.
- 신고 band < 2(`stateReported(b)` — 남의 몸은 신고로만, 2.4).
- 위험 실내 일이면 `kitHas(b, scba)` 이고 `kitQty(b, scba) / airFull ≥ AIR_IN`(조직 정보).
- ① `fit` 자리에서 대상 작업 `w` 가 있으면 하나 더 — 짝이 실제로 따라올 수 있어야 한다: 짝이 손이 비었거나(임무 없음·`standby`), **짝의 지금 일의 우선도 < `w` 의 우선도 − 0.1**, 또는 짝이 이미 같은 구역·이웃 구역의 위험 실내 일을 맡았다. 0.1 의 차는 짝 동행 후보(G08, `0.5 + 0.4p_w + 0.12`)가 짝의 지금 일 계속 점수(`0.5 + 0.4p_b + 0.08`)를 판단 오차가 없을 때 늘 이기게 하는 값이다(`0.4 × 0.1 + 0.04 = 0.08` 의 여유). 이 조건이 G08 의 점수와 어긋나면 앞장선 대원은 배정되는데 짝이 오지 않아 20초 기다림 → 놓음 → 재배정이 되풀이된다.
- 짝을 다시 맺는 것은 판단부가 아니라 실행부의 `rebuddy` 다(상태를 바꾸므로).

### 5.3 짝 다시 맺기 — `rebuddy` (`brain.think`, `flushOutbox` 다음 — 2.6 의 0번)

짝이 없거나(`a.buddy === -1` — 편성에서 짝 자리가 빠진 최소 인원 부대 등) `a.buddy` 의 짝이 `left`·`withdrawn`·숨짐이 되면(`SOLO_OK` 역할은 하지 않는다): 같은 현장의 같은 `Dept`·`SOLO_OK` 가 아니고 짝이 없는(또는 짝을 잃은) 활동 대원 가운데 가장 가까운 사람(같으면 rid 가 작은 쪽)과 **서로** 맺는다(`a.buddy = b.rid; b.buddy = a.rid`). 판단은 대원 순서대로 돌므로 결정적이다. 기록 `emit(imp 0)` "{mate}, 지금부터 나와 짝이다." 없으면 −1 로 둔다(혼자). 짝이 `down` 인 동안에는 다시 맺지 않는다 — G04(쓰러진 짝을 먼저 끌어낸다)가 그 짝을 가리키게 둔다. 끌어내 `left` 가 되면 그때 다시 맺는다.

### 5.4 짝 동행 — `TaskKind 'pair'` (G08)

- 짝이 위험 실내 일(또는 확보 전 무장 현장의 수색)을 맡았고 나는 손이 비었거나 그보다 0.1 넘게 낮은 바깥 일을 하면, `docAct` 가 후보 '짝 동행: {mate}'(점수 `0.5 + 0.4 × 짝 일의 우선도 + 0.12`)를 낸다.
- 실행: 짝에게서 1.4칸 안을 따라간다(목표는 짝의 지금 자리 — 짝이 1칸 넘게 움직였을 때만 다시 짠다. 한 틱 `moveTo` 하나). 따라가는 동안의 관찰은 지금처럼 `perceive` 가 한다(두 사람이 본 것이 모두 보고된다).
- 끝: 짝이 `active` 가 아님(쓰러지면 G04 의 `rescueMate` 가 먼저 잡힌다) / 짝이 업고 나감(그 뒤를 따라 나온다 — 끝은 바깥에 닿을 때) / 짝의 임무가 위험 실내 일이 아니게 된 뒤 **3초**가 지남. 3초를 기다리는 까닭: 방 하나의 수색이 끝나면 짝의 임무가 잠깐 비고 다음 방의 수색을 받는다 — 그 사이에 끝내면 방을 옮길 때마다 동행이 끊기고, 짝은 이미 실내라 첫걸음 판단 지점도 걸리지 않는다.
- 지휘관은 짝이 위험 실내에 있는 동안의 `pair` 대원을 빼 가지 않는다(2.6).
- **`WorkItem.max` 를 바꾸지 않는다**(R1 원칙). 짝은 작업판의 담당자가 아니다 — 작업판에는 한 사람, 몸은 둘.
- **짝이 따라온다**(판단 지점 F04c·P17b 의 조건 — `buddyFollowing(c)`): 짝의 임무가 나를 따르는 `pair` 이거나 같은 구역·이웃 구역의 위험 실내 일이고, 짝이 4칸 안에 있다. F04(`fit`)의 "짝이 있다"는 `buddyOf(…, w) !== null`.

### 5.5 혼자 남은 대원의 행동

| 분야 | 혼자일 때 하지 않는 것 | 대신 하는 것 | 풀리는 때 |
|---|---|---|---|
| 경찰 | 닫힌 방·동시 진입, 흉기 용의자 덮침, 확보 전 수색 | 3칸 거리 유지, 엄폐 사격(진입 뒤), 지원 요청(지휘관 CP2) | 동료 도착·짝 / 시민 위험(예외) / 상한(4.4) |
| 소방 | 위험 실내 일(구조 대상 3칸 안의 끌어내기 제외) | 외부 방어(R2 `defensive`)·급수·교통 통제, 지휘관은 B3·CF1 로 부대를 부른다 | 짝 생김(`rebuddy`·지원 부대) |
| 의료 | — (혼자여도 처치한다) | 처치 계속, 이송은 차가 돌아올 때까지 안전 구역에서 | — |
| 특수 | 특공: 경찰과 같음. 화학: 위험 실내. 구조정 대원: 바다·해일의 헤엄(S13 — 혼자든 아니든) | 줄·장대·보트(헤엄을 고르면 R2 의 줄 확보 `tend` 가 짝에게 사고율을 낮춰 준다 — 교본 줄은 따로 두지 않는다) | 짝 |

### 5.6 밖 대기조 — `outsideWatch(sim, s, a, ex)` (판단부)

F05·F05b·S11·CF1 이 같은 함수를 쓴다. `ex` = 들어서려는 출입구(대원이 넘으려는 문턱 칸에서 가장 가까운 `s.exits`, CF1 은 열린 위험 실내 일의 구역에서 가장 가까운 출입구).

- **세는 사람**: 같은 현장의 활동 대원 `b` 가운데 `b ≠ a`, `b` 가 `a` 의 짝도 아니고 `a` 를 따르는 `pair` 도 아니며 —
  - `kitHas(b, scba)` 이고 `kitQty(b, scba) / airFull ≥ AIR_IN`(조직 정보),
  - 서 있는 칸이 위험 건물 실내가 아님(`a` 의 믿음으로 본 `fireRisk` 구역 밖),
  - 업고 있지 않음, 임무가 `airOut`·`pairOut`·`retreat`·`evacuate`·`rehab`·`pair`·`board` 가 아니고 위험 실내 일도 아님,
  - `ex` 에서 8칸 안.
  - `SOLO_OK`(기관원·사다리 조작원)도 센다 — 바깥에 서는 것이 그들의 자리다. 지휘관도 위 조건이면 센다. 급수·교통 통제처럼 손이 묶인 바깥 일은 센다(밖에서 부르면 들어올 수 있다).
- **필요한 수** `need`: 2. 같은 사건으로 scba 대원을 태운 소방 부대가 `enroute`·`turnout` 이면(조직 정보 — `I.assigned`·`u.state`·`crewHasKit`) 1.
- 걸음마다 다시 세지 않는다 — 판단 지점은 실내 첫걸음에서만 묻는다(11.1 의 `interiorEntry` 자리).

### 5.7 공기 탈출·짝 따라 나가기의 실행 (`doctrineRun`)

- **나갈 자리**: 대기 지점(`s.staging`) 칸의 감각 연기 < 0.1 이면 거기, 아니면 가장 가까운 출입구 바깥쪽 3칸 안에서 감각 연기 < 0.1 인 첫 칸(실행부라 `s.smoke` 를 읽어도 된다). 처음 한 번 정해 `t.tx/ty` 에 둔다. 연기가 찬 대기 지점에 서서 F01 이 다시 걸리는 일이 없게 한다(F01 은 `inHazard ‖ sense.smoke > 0.25` 일 때만 걸린다).
- **`airOut`**: 그 자리로 간다(`moveTo(…, 0.6)`). 닿으면 자기 부대 `spareAir > 0` 이면 8초 교체(R1 `swapAir` 의 효과 — `uses = airFull`, `spareAir −= 1`, R1 의 교체 문구) 후 끝. 예비가 없으면 닿는 순간 끝(그 뒤 F03 이 위험 실내 일을 막고, 지휘관은 CF2 로 부른다). 짝이 `pairOut` 으로 따라오면 함께 선다.
- **`pairOut`**: 짝을 1.4칸 안에서 따라 나온다(목표는 짝의 자리 — `pair` 와 같은 규칙). 끝: 위험 실내 밖이고 감각 연기 < 0.25 이며 출입구에서 2칸 넘게 떨어짐, 또는 짝의 `airOut` 이 끝남, 또는 짝이 `active` 가 아님. 끝나면 `docMem` 에 F02·그 짝을 10초(짝이 바깥에서 교체하는 동안 다시 걸리지 않게 — 짝은 이미 밖이라 F02 의 `inHazard` 가 거짓이지만 문턱 근처의 흔들림을 막는다).

---

## 6. 지휘관과 관제의 교본

### 6.1 지휘관 (`orders/doctrine.ts` + `commander.ts` 조각)

| 줄 | 분야 | 지금 / 새로 | 믿음·조직 정보 → 지휘 | 문구 |
|---|---|---|---|---|
| — | 경찰 | 있음(지금) | 총기 && law 부대 < 2 → law/tactical, 인질 → 기동대, 한 팀 22초, 진입 문턱(≥2·≥3·≥4), 출입 통제 | 지금 |
| CP1 | 경찰 | **새로** | **쓸 수 있는 경찰** `usable` = R1 의 `police`(총기 && 역할 묶음 `bomb` 아님)에서 신고 band ≥ 1 인 대원과 총의 탄이 위급(발사 2회 이하 — 조직 정보 `gunOf`)인 대원을 뺀 수. **동요는 빼지 않는다**(6~26초로 오가므로 빼면 문턱이 출렁인다). `usable` 을 쓰는 곳: 흉기 검거 문턱(`fight && ≥ 2`), 진입 결정의 갈래 가운데 시간 예비 규칙(`waited > 100 && ≥ 2`)을 **뺀** 모든 갈래, 두 문 진입(`≥ 4`). 지금의 머릿수 `police` 를 그대로 쓰는 곳: 시간 예비 규칙(다친 경찰 둘만 남아도 언젠가는 들어가게 — 모든 사건은 끝난다), 봉쇄 자리 수(`posts` — 출렁이면 봉쇄를 거뒀다 다시 내는 왕복). 그리고 한 줄 더: `usable` 이 이 사건에서 쓰는 가장 낮은 문턱(흉기 2·총기 2)보다 작고 오는 law 부대가 0 이면 `request('law', '제압 가능 인력 부족', true)` | 요청 |
| CP2 | 경찰 | **새로** | 흉기 용의자 `fight` 이고 `usable < 2`, 오는 law 부대 0 → 22초를 기다리지 않고 `request('law', '흉기 난동 — 2인 제압 인력 부족', true)` (CP1 의 요청과 같은 `need` 라 `request` 가 70초 안의 중복을 버린다 — 먼저 나간 쪽만 센다) | 요청 |
| CP3 | 경찰 | **새로** | 탄 위급 신고(`crew.ammo === 2`)가 있고 현장 경찰 부대의 `ammoBox` 합이 0 → `request('law', '탄약 보급 필요', false)` | 요청 |
| CP4 | 경찰 | **새로** (확인 필요 — 균형) | 인질 사건의 "125초 && ≥ 3" 진입 줄에 "섬광탄을 가진 사람이 있거나(`hasBang`) 인질이 다쳤다고 믿을 때"를 더한다 — 섬광탄 없는 인질 진입을 하지 않는다. 대신 협상을 잇고 기동대 요청(지금 규칙). 섬광탄이 있으면 18초 줄이 먼저 걸리므로 실제로는 "섬광탄이 없으면 인질이 다쳤을 때만 진입"이다 — 극한 난이도(기동대가 오지 않는다)의 한계 시간 위험(11.2-2) | — |
| — | 소방 | 있음(지금·R1·X6) | 진압 부대 없음·용수 없음·확대, 급수 연결, 구조 장비 없음, 진입 소방 없음, B3 `anyCapable`, X6 위험 단계 | 지금 |
| CF1 | 소방 | **새로** | 위험 실내 일이 열려 있고 그 출입구의 `outsideWatch(…, ex) < need`(5.6), 오는 진압 부대 0 → `request('suppression', '2인 대기조 확보', false)` (한 번) | 요청 |
| CF2 | 소방 | **새로** | 현장 scba 부대의 `spareAir` 합 0 이고 공기 낮음 신고(`crew.air ≥ 1`) ≥ 2 → `request('suppression', '공기통 예비 소진', true)` | 요청 |
| CF3 | 소방 | **새로** | 지금 "펌프 고장 또는 물 없음"을 한 문구로 내는 줄을 둘로: 펌프 고장이고 그 부대 `sparePump === 0` → '펌프 고장 — 진압 부대 교체', 물 없음 → 지금 문구 | 요청 |
| CF4 | 소방 | **새로** | 고립자가 있고 현장·오는 부대에 `spreader` 를 가진(알려진 고장이 아닌 — `crewHasKit`) 대원이 없다 → `request('rescue', '유압 장비 고장 — 구조 장비 필요', true)` (지금의 "구조 장비 부대 없음"은 caps 로만 센다) | 요청 |
| CF5 | 소방 | **새로** (X6 `DANGER_RULES` 한 줄) | 측정기 없는 가스: `gas` 조짐이 냄새뿐(`verified: false` — 측정기가 없으면 X6 는 단계 1 만 안다, X6 §3.4)이고 현장·오는 부대에 측정기(`gasMeter`, `crewHasKit`)를 가진 대원이 없고, 같은 구역·이웃 구역의 불 믿음 ≥ 0.1 → **단계 2**(새 진입 금지). X6 의 `gas` 1·2 → 1 보다 한 단계 높다 — 불씨 곁의 잴 수 없는 가스에는 들어가지 않는다 | X6 문구 |
| CF6 | 소방 | **새로** (X6 `DANGER_RULES` 한 줄) | 예비 공기 없는 센 불: 센 불(믿음 ≥ 0.5)이 **100초** 넘음(`ops.burnSince`) + 현장 scba 부대의 `spareAir` 합 0 → 단계 1. X6 의 같은 단계 줄(150초)보다 50초 이르다 — 교체할 공기가 없으면 진입 인원을 먼저 줄인다 | X6 문구 |
| CF7 | 소방 | **새로** | 지휘관 자신은 현장에 다른 scba 대원이 둘 이상이면 위험 실내 일을 맡지 않는다(`assign` 의 지휘관 감점 −0.18 위에 그 일만 제외) | — |
| — | 의료 | 있음(지금·H1) | 구급 0 요청, 부상자 > 자리, 다수 사상자 5명, 동료 부상, `manageAmbulances`(H1 믿음화), `treatMate` | 지금 |
| CE1 | 의료 | **새로** | 믿음 대기 환자(band ≥ 1, 현장·안전 구역) ≥ 4 이고 구급 대원(구급 분야 또는 의료 가방 — H1 `treatMate` 의 자격과 같다)이 현장에 활동 중이고 `s.triageAt < 0` → `want('triage', {}, 0.92, 1)`. **분류 전에는 band 1 의 `treat` 를 내지 않는다**(band 2 만 — 위중이 먼저. 지금 band 0 은 원래 내지 않는다). **거두는 조건**: 현장에 위 자격의 활동 대원이 하나도 없으면 열린 `triage` 를 `cancel` 하고 band 1 처치를 지금처럼 낸다(H1 `treatMate` 의 "맡을 사람이 없으면 거둔다"와 같다 — 열린 채 남으면 `canClose` 가 막혀 한계 시간까지 간다). 분류가 끝나면 실행기가 작업을 `done` 으로 | (실행기 문구) |
| CE2 | 의료 | **새로** | `treat` 담당이 비구급이고 손 빈 구급 대원이 있다 → **지시만 보낸다**: `assign` 이 구급 대원에게 같은 작업의 지시를 낸다(`w.max` 를 넘겨 담당자 둘을 잠깐 허락 — pass 1 의 "빈 자리만" 조건에 이 경우만 예외). 비구급 대원은 실행기 `case 'treat'` 에서 그 작업을 맡은 구급 대원이 1.5칸 안에 오면 `finishTask(…, false, 'handover')`(실패 기록·`w.fails`·`holdUntil` 없음 — 담당자 목록에 구급 대원이 남아 작업은 `active` 그대로)로 놓는다. 지휘관 코드가 남의 임무를 직접 끝내지 않는다 — 지시는 무전으로만 닿는다(지금 `sceneManager` 가 배달될 때 `orderWork` 를 정하는 길) | "{name}, 처치 넘겨받아라." |
| CE3 | 의료 | **새로** | 자리 1, 기다리는 환자 둘 이상 → 믿음 band 가 높은 쪽 `load` 우선도 +0.1, 낮은 쪽 `holdUntil = sim.t + 10`(그 사이 다른 차가 오면 풀린다) | "자리 하나 — 구조 대상 {s} 먼저." |
| CE4 | 의료 | **새로** | 믿음 위중 + 현장 남은 자리 0 + 오는 구급 부대의 가장 이른 도착 예상(`u.estArrive` — 조직 정보) > 100초 → `request('ems', '위중 환자 — 항공 이송 검토', true)` | 요청 |
| CE5 | 의료 | **새로** | 지휘관의 부대에 `boardOrder` 가 섰으면, 타기 전에 지금의 승계 규칙(주관 부서·경험 순)으로 지휘를 넘긴다 — `sceneManager` 4번 블록의 조건 "지휘관이 `active` 가 아니면"에 "또는 지휘관의 부대에 `boardOrder` 가 섰으면"을 더한다. **이때의 후보는 `boardOrder` 가 선 부대의 대원(지휘관 자신 포함)을 뺀 활동 대원**이다(지금 후보 `s.agents.filter(active)` 에는 떠나는 지휘관과 그 부대원이 들어 있어, 그대로면 같은 사람이 다시 뽑혀 틱마다 '지휘 넘김'이 남는다). 남는 후보가 없으면 넘기지 않는다 — 지금 경로(떠난 뒤 7번 블록)로 둔다. 승계 문구는 '지휘 넘김'(`commander.ts` 는 고치지 않는다. 부대의 `boardOrder` 는 조직 정보) | "{name}, 지휘 넘긴다 — 이송 출발. {new} 지휘권 인수." |
| — | 특수 | 있음(지금) | 처리반 요청, 장치 방 수색 거둠, 살아 있는 장치면 종료 막음 | 지금 |
| CS1 | 특수 | **새로** | 살아 있는 장치(믿음) + 해체 작업이 장치 곁에서 진행 중(동료의 겉 — S08 과 같은 조건) → 장치 6칸 안의 열린 일 가운데 해체·출입 통제·반경 밖으로 옮기는 일(`carry`·`escort`·`rescueMate`)을 뺀 것을 거둠, 한 번 알림. 같은 판정을 S08 의 `fit` 이 안전망으로 쓴다(X6 가 있으면 `registerGate` 로 같은 일이 다시 생기지 않게) | "해체 시작 — 반경 6칸 비워라." |
| CS2 | 특수 | **새로** | 특공이 현장에 있으면 `engage` 배정 점수에 역할 묶음 `shield`·`entry` 와 기동대원 +0.1, 순찰 경관은 `perimeter` 쪽으로 (배정 가산 — `fit` 이 아니라 `assign` 점수) | — |

- `commander.ts` 를 고치는 곳: CP1 의 `usable` 과 그 요청, CP4 의 인질 진입 한 줄, CF3 의 펌프·용수 요청 줄, `assign` 안의 조각(교본 임무 건너뛰기 — 2.6, CE2 지시·CS2 가산·CF7 지휘관 제외·교본 전후의 1등 비교와 까닭 말 — 2.7), **`request` 가 기록 id 를 돌려주게**(아래). CE5 는 `sceneManager` 4번 블록의 조건 한 조각과 후보 거르기. 나머지(CP2·CP3·CF1·CF2·CF4·CE1·CE3·CE4·CS1)는 `orders/doctrine.ts` 의 `registerOrders` 에서 `k.want`·`k.cancel`·`k.request` 로 하고, CF5·CF6 은 X6 `DANGER_RULES` 의 줄이다.
- **`request` 의 기록 id**: 지금 `commander.request` 는 돌려주는 값이 없고, 같은 능력의 요청이 70초 안이거나 아직 채워지지 않았으면 조용히 버린다. `CommandKit.request` 도 `=> void` 다(`sceneRegistry.ts`). 그래서 둘 다 **보낸 무전의 기록 id 를, 버렸거나 음영으로 못 보냈으면 −1 을 돌려주게** 바꾼다(`sceneRegistry.ts` 의 타입 `request: (…) => number` 포함 — 지금 값을 쓰는 곳이 없어 다른 호출은 고치지 않아도 된다). 지휘 줄의 `recordDoc` 은 그 값이 0 이상일 때만 남긴다(버려진 요청을 '쓰였다'로 세지 않는다).
- 지휘 줄의 기록: 그 줄이 요청·작업·배정·구역을 실제로 바꾼 자리에서 `recordDoc(…, 그 줄의 id, 'cmd', …)` 한 줄 — 요청은 `request` 가 돌려준 기록 id, 배정 가산(CS2·CF7)은 그 가산이 고른 사람을 바꾼 지시의 기록 id(2.7 의 1등 비교), CF5·CF6 은 X6 의 `dangerMap` 이 **그 줄 때문에** 구역을 만들거나 단계를 올린 때(그 줄을 빼고 셈한 단계보다 높을 때 — X6 의 구역 기록 id), CE5 는 승계 기록 id. 바꾸지 않았으면 남기지 않는다.
- `orders/doctrine.ts` 가 읽는 것: `a.beliefs`(동료의 `crew`·`mate`, 구조 대상·용의자·위험 사실), `s.board`, `sim.units`(조직 정보), `I.assigned`, `sim.responders[rid]` 의 `.unitId`·`.dept`·`.name`·역할(명부), `gear.ts` 의 판단용 함수. 다른 대원의 `health`·`bleed` 를 읽지 않는다(H1 시험 11-8 과 같은 검사가 이 파일에도 걸린다).

### 6.2 관제 (`dispatch/doctrine.ts`)

| 줄 | 분야 | 지금 / 새로 | 평가·조직 정보 → 관제 | 고칠 곳 |
|---|---|---|---|---|
| — | — | 있음(지금·R1) | 유형별 수요, 배정 순서 eod → tactical → law …, 특공 > 기동(적합도), 헬기(R1 `airFit`), 구조정(바닷가), 의료 헬기 | — |
| D1 | 특수 | **새로** | 가스 누출(평가 유형 hazmat): `rescue` 수요는 화학 구조차 +30. 위험도 ≥ 1.6 이면 `rescue` 1(지금 2.1) — 화학대가 가스 현장에 온다 | `analyst` 수요(`docNeeds`), `dispatcher.pickUnit` 점수(`dispatchPref`) |
| D2 | 특수 | **새로** | `law` 수요에서 폭발물 처리반 −40(이 사건에 `eod` 수요가 없을 때) — 처리반을 인질극 진입조로 보내지 않는다(S7 의 관찰) | `pickUnit` |
| D3 | 경찰 | **새로** | 평가 유형 armed 이고 **통화 주제 `weapon` 의 값이 `'knife'`** 인 신고가 있으면(`I.claims` — 관제가 받은 말. 지금 `callSystem` 이 "칼 같은 걸 들고 있어요."로 넣고 `analyst` 가 `pick(claims, 'weapon')` 으로 읽는다) `law` 2 | `analyst` |
| D4 | 특수 | **새로** | 화재이고 위치 신고의 건물 종류(`Claim.placeKind` — `callSystem` 이 위치 주제에 싣고 `analyst` 가 이미 읽는 값. `I.truth.placeKind` 는 관제 금지)의 `KIND_SCENE[placeKind].tall ≥ 0.5`(`tall` 은 2층일 확률 0..1 — 지도에서 공개된 건물 종류의 성질)이면 `suppression` 수요에 사다리차 +25 | `pickUnit` |
| D5 | 소방 | **새로** | 바닷가가 아닌 수난 → `rescue` 수요에 구조 공작차 +8. R1 의 `kitBonus`(수난 `rescue` 수요에 로프·구명환 대원이 있는 부대 +12)에 **더한다** — 합 +20. R1 의 가산은 소방 헬기(항공 구조대원의 로프)에도 걸리므로, D5 는 바닷가가 아닌 물에서 공작차를 헬기보다 조금 먼저 고르게 하는 몫만 맡는다 | `pickUnit` |
| D6 | 경찰 | **새로** | 무장 위험도 ≥ 2.4 의 `tactical` 수요에 특공이 없으면 기동대를 보내되(지금), 진입이 예상되는 인질 이름표면 기동대 둘 | `analyst` (확인 필요 — 균형) |
| D7 | 경찰 | **새로** (= P18·P19) | 추격전 역할 `chaseRoles(sim, I)`: `I.trackBy === 'air'` 이면 알려진 위치(`I.reportedNode` 의 좌표 — 차의 실제 위치가 아니다)에 가장 가까운 지상 부대 하나 `follow`, 나머지 `block`(예상 교차로). 헬기가 없고 지상 둘 이상이 알려진 위치 42 안이면 셋째부터 `block`. 예상 교차로 = `I.reportedNode` 의 이웃 가운데 `I.reportedPrev → I.reportedNode` 방향과 가장 곧게 이어지는 곳(도로망 — 공개). `block` 부대의 그 교차로 도착 예상(`etaFor`)이 차의 도착 예상보다 1.5배 넘게 늦으면 `follow`. **차의 도착 예상은 공개 정보로만**: `I.reportedNode` 에서 예상 교차로까지의 `edgeTime`(구간 길이·제한 속도·알려진 혼잡)에서, 마지막 보고 뒤 지난 시간을 뺀 값(0 아래면 0 — 그때는 `follow`) | `pursuit.tickPursuits` 의 "알려진 위치로 방향을 바꾼다" 줄이 역할을 보고 `sendUnitTo` 의 목적지를 고른다 |

- `I.trackBy`·`I.reportedPrev` 는 `pursuit.ts` 가 **보고가 일어나는 그 자리**에서 적는다. `trackBy`: `p.tracked` 를 정하는 반복(보고 있는 부대가 헬기뿐이면 `'air'`, 지상 부대가 175 안이면 `'ground'`, 아무도 없으면 `null`). `reportedPrev`: `I.reportedNode` 를 바꾸는 **세 곳**(추적 중의 대입 — 보고 있는 동안 틱마다 `I.reportedNode = p.to` 가 대입된다, 시민 목격 신고, 차가 선 `stop`)에서 **값이 실제로 바뀔 때만** 그 전 값을 넣는다(틱마다 같은 값을 대입할 때 덮으면 `reportedPrev === reportedNode` 가 되어 방향을 잃는다). 마지막 보고 시각 `I.reportedNodeAt`(새 선택 칸 — `Incident`. 이미 있는 `I.reportedAt` 은 신고 시각이라 이름을 달리한다)도 같은 자리에서 적는다(D7 의 "마지막 보고 뒤 지난 시간"). 보고 있는 부대가 위치를 알려 오는 것이 이미 공개 정보이므로(`I.reportedNode`) 정보 격리가 늘지 않는다.
- `dispatch/doctrine.ts` 는 `I.pursuit` 를 읽지 않는다(차의 진실 — 위치·다음 교차로·진행률). 10절 1의 금지어에 `.pursuit` 가 있다.
- 추격 기록: 역할이 처음 정해지거나 바뀐 부대마다 관제 문구 한 줄(P18·P19).

---

## 7. 화면과 보고서

G4(현장 상태 표지)·G5(교전 그림·소리)와 겹치지 않게, R3 는 **패널·라벨·보고서**만 고친다. 현장 그림은 두 가지만 — 엄폐 임무의 자세와 짝 끈(선택).

### 7.1 대원 정보창 (`ui/panels.tsx` `AgentPanel` — R1 의 역할·장비 줄, R2 의 방법 줄, H1 의 부상 줄 아래)

- **상태 칩 한 줄**: 공기 `72%`(막대, 30·50 눈금 — scba 가 있을 때), 탄 `22 / 탄창 7`(총이 있을 때, 재장전 중이면 '재장전'), 짝 `박서윤 1.8칸` / `짝 없음`, 몸 `경상·중상`(H1 의 색), `동요`(동요 중일 때만, 차분한 노랑).
- **따르는 교본**: `a.doc` 또는 `a.task.docRule` 이 있으면 "F01 공기 30% 미만 — 짝과 함께 탈출" (줄 `id` + `name`). 판단 지점에서 기다리는 중이면 "P07 혼자 방 진입 금지 — 34초째".
- **교본이 바꾼 것**(최근 3): 그 대원의 `I.docs` 에서 "09:12 P07 단독 진입 보류 (34초)", "09:40 P08 탄약 보급".
- 판단 후보 목록(지금 있다)에서 교본 후보는 앞에 "교본 · "을 붙인다(`Option.label` 에 그대로 들어간다 — 패널 코드는 고치지 않아도 된다).
- AI 시점(지휘관의 믿음)에서는 남의 상태 칩을 그 대원의 `crew` 사실로 보여 준다(지휘관이 아는 만큼).

### 7.2 현장 그림 (결과 불변 — 7단계)

- 머리 위 라벨: 새 임무의 라벨이 그대로 뜬다('엄폐'·'탄약 보급'·'공기 탈출'·'짝 따라 나감'·'짝 동행'·'분류'), 판단 지점에서 기다리면 줄의 `short`('단독 진입 보류'·'대기조 확인 전 진입 보류'·'거리 유지'·'처치 대기').
- `renderScene.agentPose`: `cover` 는 G5 의 엄폐 자세(`PersonPose.crouch` — 몸 0.9배, 다리 접음, 총은 겨눈 채. 엄폐 사격이 아니어도 같은 자세), `rearm`·`airOut`·`pairOut`·`pair` 는 기본 자세, `triage` 는 R1 의 처치 자세.
- **협상 중단 표시**(G5): G5 는 `negotiate` 임무·`phase ≥ 1`·용의자 `fight` 일 때 용의자 쪽에 협상이 끊겼다는 풍선을 그린다. P16 이 협상자를 `cover` 로 옮기면 그 조건이 깨져 표시가 사라진다. 그래서 G5 의 그 술어에 "또는 임무가 `cover` 이고 `t.docRule === 'P16'`"을 더한다(그림만 — 시뮬레이션은 그대로).
- (선택) **짝 끈**: 둘 다 위험 실내에 있는 짝 사이에 가는 흰 점선(`view/scene/doctrineLayer.ts`, 대원 층 바로 아래). 2인 진입을 눈으로 보게 한다. G4·G5 는 대원 사이 선을 그리지 않는다(확인함). 화면이 어지러우면 빼도 된다.

### 7.3 보고서 (`debrief.ts`)

보고서 문장은 기록(`I.docs`)과 문제에서만 만든다 — 보고서를 쓸 때 다시 계산하지 않는다.

- **사건 분석 문장**: `I.docs` 의 `say: true` 줄 가운데 순위(줄의 `rank`)가 가장 작은 것부터 **최대 2문장**, R2 의 방법 문장 다음·맺음말 앞, 방법 문장과 합쳐 **최대 3문장**, `A.length < 12` 일 때만(R2 와 같은 상한 — 문제 설명이 먼저). 템플릿은 줄의 `report`:
  - F01: "이서준 대원은 공기 잔량이 30% 아래로 떨어지자 짝 박서윤 대원과 함께 건물 밖으로 나왔습니다."
  - P07: "순찰1 이 혼자 남아 방에 들어가지 않고 42초 동안 지원을 기다렸습니다."
  - P02: "김도윤 대원은 테이저가 없어 흉기를 든 용의자와 거리를 두고 지원을 기다렸습니다."
  - F05: "진압2 는 밖에 대기조가 없어 진입을 28초 미뤘습니다." / 예외 "요구조자가 있어 대기조 없이 진입했습니다."
  - E08: "처치가 끝날 때까지 이송을 미뤘습니다." 같은 짧은 줄은 `say: false`(보고서에 싣지 않는다 — 기록에만).
- **까닭 말** `WHY_DOC`: `alone: '혼자였음'`, `buddy: '짝과 함께'`, `outside: '밖에 대기조가 없었음'`, `hurt: '다쳐서'`, `lowAir: '공기가 부족해'`, `lowAmmo: '탄약이 떨어져'`, `noKit: \`${kitName(…)}이/가 없어\``, `civ: '시민이 위험해'`, `hostage: '인질이 위험해'`, `backup: '지원이 오고 있어'`, `triage: '부상자가 많아'`, `tired: '지쳐서'`, `shaken: '동요해'`, `team: '동료와 겹치지 않게'`, 그리고 `danger`·`kit`·`protocol`(까닭 말 없이 문장 템플릿이 말한다).
- **교대 보고서**: `doctrine`(줄 번호별 횟수 — `I.docs` 의 줄을 번호(앞 세 글자)로 묶어 센다. `fit` 줄은 2.7 의 1등 비교로 센 것)과 `docSplit`(8.2)을 채우고, 요약에 한 줄 — "교본: 공기 탈출 3 · 단독 진입 보류 2 · 엄폐 5 · 가벼운 임무 4 · 분류 1"(`short`, 많은 순 다섯). 하나도 없으면 줄을 넣지 않는다.
- 새 문제 코드는 만들지 않는다(11.3 결정 4). 교본은 실패가 아니라 선택이다. 교본 때문에 늦어진 결과는 지금의 판정(대응 지연·실패)과 위 문장이 함께 말한다.

---

## 8. 균형과 측정

### 8.1 교본이 결과에 주는 영향

| 쉬워지는 쪽 | 어려워지는 쪽 |
|---|---|
| 엄폐 사격·숨기로 대원 피격이 준다. 다친 대원이 가벼운 일로 돌아 쓰러지는 일이 준다. 짝이 쓰러진 짝을 바로 끌어낸다. 분류로 믿음 속 중증도가 바로잡히고 위중 환자가 먼저 처치된다. 차량 차단으로 통제를 세우는 동안의 2차 사고가 준다. 처치 중 이송이 사라져 처치 질이 오른다. 처치 넘겨받기. 경계 밖 처치소. 화학대가 가스 현장에 온다. 사다리차가 2층 화재에 온다 | 2인 진입·대기조로 실내 진입이 늦어진다(화재). 단독 진입 보류·흉기 거리 유지로 대치가 길어진다. 재장전·재보급으로 사격이 멈춘다. 공기 탈출로 실내 작업이 끊긴다. 인질 덮침 제한(P14·CP4)으로 대치가 길어진다. 추격 앞막기가 도주 차를 다른 길로 몬다(놓칠 수 있다) |

### 8.2 목표 (보통, 시드 60 — **R2 를 합친 뒤의 기준 수치** 대비. 0단계 전에 같은 명령으로 재어 scratchpad 에 둔다)

- 전체: `npm run check` 의 범위 안. 성공률(`outcomes.success / incidents`) 기준 ±3%p, 한계 시간 + 방치 기준 + 2 이하.
- 유형별: 무장 ±5%p, 화재 −6 ~ +3%p, 응급 ±5%p(대응 지연 비율이 늘지 않는다), 그 밖 ±5%p.
- **대원 부상**: 교대당 `RESPONDER_HURT` 가 기준 이하, `--force armed/shooter`·`armed/siege`·`fire/std` 20교대에서 기준 대비 −10% 이상. 순직(H1) 기준 이하.
- **행동 다양성**(I1-a): `actions.entropy` ≥ 기준 − 0.02, `actions.methodEntropy`(R2) ≥ 기준, `stall.candidates ≤ STALL_ALLOW`, `stall.forgotten ≤ FORGOT_ALLOW`.
- **같은 상황 다른 행동** `doctrine.split`: **표본** = 대원의 임무가 시작될 때마다 하나(`brain` 의 `setTask`·`takeWork` 와 의무 자리 — 시작하는 그 자리에서 `ShiftReport.docSplit` 에 센다). 열쇠 = `분야|국면|임무`(분야는 `docDeptOf`, 국면은 시작 직후의 `phaseOf`, 임무는 작업판 일이면 `WorkKind`·교본 행동이면 그 행동이 대신한 작업판 일의 종류(없으면 `TaskKind`)). 값 = 고른 것 — R2 방법이 정해졌으면 그 방법 id, 교본 행동이면 그 `DocActId`, 판단 지점에서 막혀 시작했으면 그 줄 번호, 아무것도 아니면 `'none'`. 방법은 시작 직후(같은 틱의 `startMethod`)의 값이다. 집계: 표본 10 이상인 열쇠 가운데 값이 두 가지 이상인 열쇠의 비율 ≥ 0.5.
- 추격전: `--force armed/kidnap`·`armed/getaway` 20교대의 놓침(`SUSPECT_FLED`)이 기준 + 2 이하.
- 교대당 시간: 기준의 1.15배 이하(`docFit` 이 `fitFor` 마다 불린다 — 2.4 의 캐시).

### 8.3 다시 재는 명령 (단계마다 전후 — 전 = 그 단계 직전 커밋)

```bash
# 0단계에서 한 번 ($SCRATCH = 각자의 scratchpad. 결과를 저장소에 넣지 않는다)
npx tsx scripts/sweep.ts 60 --scen --methods --doctrine --json > $SCRATCH/r3-base.json
for p in easy hard extreme; do npx tsx scripts/sweep.ts 60 --diff $p --doctrine --json > $SCRATCH/r3-base-$p.json; done
# 단계별 강제 묶음 (각 20교대)
#   2 경찰 → --force armed/dispute, armed/domestic, armed/shooter, armed/hostage, armed/siege, armed/kidnap, armed/getaway
#   3 소방 → --force fire/std, fire/arson, collapse/std, hazmat/std, water/std
#   4 의료 → --force medical/arrest, medical/trauma, traffic/bus, traffic/std
#   5 특수 → --force armed/bomb, armed/package, hazmat/std, water/std, --disaster tsunami
npx tsx scripts/sweep.ts 20 --force armed/hostage --scen --doctrine
npx tsx scripts/sweep.ts 20 --diff 3,3,3,3,3,1 --scen --doctrine          # 최소 인원 — 짝·대기조가 모자란 쪽
npx tsx scripts/sweep.ts 20 --diff 3,3,3,1,3,3 --scen --doctrine          # 장비 불량 — 공기·탄약 상자·예비 펌프가 적은 쪽
npx tsx scripts/sweep.ts 1 --force fire/std --log S7                      # 왜 그렇게 골랐는지 읽는다
time npx tsx scripts/sweep.ts 20                                          # 교대당 시간
npm run check                                                             # 단계를 끝낼 때 한 번
```

- `scripts/sweep.ts` 에 `--doctrine` 을 더한다. 표 셋: ① 줄별 쓰인 횟수(분야별로 묶어 "등록 n줄 중 쓰인 m줄"), ② 판단 지점·교본 행동의 평균 길이(`t1 − t`), ③ `split` 과 그 열쇠 목록. `--json` 이면 요약에 `doctrine: { rules, used, split, avgWait }`, 글자 출력에는 `doctrine:` 으로 시작하는 줄(I1-a 의 접두어 규칙 — 겹치지 않는다).
- 시뮬레이션을 고친 뒤 `sweep 60` 의 결과 분포와 `close reasons` 의 `timeout` 건수를 전후로 비교한다(CLAUDE.md 작업 방식). 범위를 벗어나면 아래 손잡이를, **이 순서로** 돌린다. 범위 자체(`sweep --check`)는 건드리지 않는다.

### 8.4 범위를 벗어나면 돌리는 손잡이 (이 순서로)

1. 화재가 너무 어려우면: F05 의 예외를 넓힌다(신고 인원 불명도 "있을 수 있다"로) → 대기조 수를 "1 + 오는 부대"로 → `AIR_OUT` 0.30 → 0.25.
2. 무장 대치가 길어지면(한계 시간·투항 비율), **또는 기존 시험 둘이 깨지면**(`tests/sim.test.ts` 의 생활 사건 — `armed/domestic` 순수 성공 > 0.6, `tests/crime.test.ts` 의 '폭동' — 11.2-12): P02 상한 20 → 12초 → P03 6 → 3초 → P07 의 지원 없음 60 → 40초 → P14 상한 20 → 12초 → CP4 를 끈다 → CP1 의 흉기 검거 문턱을 머릿수(`police`)로 되돌린다.
3. 추격 놓침이 늘면: D7 의 `block` 을 헬기가 있을 때만으로, 1.5배 조건을 1.2배로.
4. 너무 쉬워지면(피격이 크게 줄어 무장 성공률이 오르면): 엄폐 사격 고리의 바깥 7.5 → 6(대원에게서 12칸 → 8칸), 숨기 반경 4 → 3, P11 을 체력 < 50 으로.
5. 그 밖: 가벼운 일 배율 0.35 → 0.6, 탄약(권총 30 → 45).

---

## 9. 구현 순서와 완료 조건

분야 하나씩. 각 단계 끝에 `npx tsc --noEmit` → `npx vitest run tests/doctrine.test.ts tests/ext.test.ts`(그 단계까지 들어간 시험 — 아래 표의 "시험" 칸) → 8.3 의 전후 비교 → **`npm run check` 통과** → 커밋(한국어, `wf/doctrine` 에만, 푸시하지 않는다). 그림만 고친 커밋은 시뮬레이션 커밋과 나눈다. **시험은 그 시험이 보는 것이 생긴 단계에 넣는다** — 앞 단계에 넣으면 그 단계의 `npm run check` 가 깨진다.

| 단계 | 할 일 | 시험 (그 단계에 넣는 것) | 끝났다는 증거 |
|---|---|---|---|
| **0 틀** | `types.ts` 의 자료형(합집합은 빼고 — 2.1), `gear.ts` 의 판단용 감싼 함수 다섯(2.4), `doctrine/registry.ts`·`doctrine.ts`(엔진·`stateSelf`·`stateReported`·`DocCtx`·`coverSpot`·`buddyOf`·`outsideWatch`·`PAIRS`·`SOLO_OK` — 줄 없음), `doctrine/index.ts`·다섯 줄 파일(빈 파일), `doctrineRun.ts`(`recordDoc` 만), 걸리는 자리의 호출(`fitFor` 끝 `docFit` — 줄이 없으면 그대로 돌려준다, `brain` 의 `docDuty`·`docAct`·`docRetreat`·`docDrop` — 없으면 아무것도 하지 않는다, R2 `chooseMethod` 의 배율 — 1, 실행기의 `docGate` — 늘 통과), `sweep --doctrine`(빈 표), 패널 칸(빈 칸) | 1, 5(순수 함수·0단계 해시), 8(표 모양 — 줄이 없어도 통과) | `tsc` 통과, **기록 해시가 전과 같다**(S0~S9 의 `sim.report.hash` 전후 비교 — 후보를 하나도 더하지 않으므로 `a.rng` 소비가 같다) |
| **1 공통** | `crew` 사실(`FactType`·`significant`·`prompt`·중요 판정)과 `selfReport`(`flushOutbox` 앞), 중상 간격(70/75 — `bandHyst`), 동요(`shake` 세 자리), `a.docMem` 의 두 뜻, G01~G04·G02b(R2 `caution`), `assign` 의 교본 전후 1등 비교와 까닭 말, 보고서의 교본 문장·요약 줄, `docSplit` 집계, 패널의 상태 칩 | 2-e, 3(남의 몸 — `docFit`), 4(중상 간격·동요), 7(교본 문구·`I.docs`·요약 줄 — 공기 부분 빼고) | 8.2 의 전체 범위 |
| **2 경찰** | 탄약(2.9: `KitDef` 세 칸·총기 `uses`·명부 복사·`shootAt`·`reloadTick`·`rearm`·`ammoBox`·집에서 채움, R2 저격의 탄 소모), 엄폐(2.10: `coverSpot`·임무에 담는 자리·`cover` 임무·`engage` 마지막 분기), 판단 지점 `closeIn`(**`arrest`** 의 P01~P03, `engage` 인질 갈래의 P14)·`coverFire`·`roomEntry`·`breach`(`breachExit` 로 꺼내기)·`bangUse`, `docRetreat`(P11)·`docDrop`(P22), `assign` 의 교본 임무 건너뛰기, P 줄 전부, CP1~CP4, `request` 의 기록 id(`commander.ts`·`sceneRegistry.ts`), D2·D3·D6, 추격 D7(`trackBy`·`reportedPrev`·`reportedNodeAt`·`chaseRoles`), `TaskKind` 의 `cover`·`rearm` | 2-a·2-b·2-d·2-h·2-j, 4(엄폐 왕복 — `armed/hostage` 강제), 6(`armed/dispute`·`armed/hostage`), 8(경찰 ≥ 12) | 무장 강제 묶음의 표, 대원 부상 목표, `npx vitest run tests/sim.test.ts -t 생활`·`npx vitest run tests/crime.test.ts -t 폭동` 통과(11.2-12) |
| **3 소방** | 짝(`PAIRS`·`pairUp`·`rebuddy`·`pair` 임무·G08), `interiorEntry` 판단 지점, `airOut`·`pairOut` 의무와 실행(5.7), `AIR_IN`, R1 공기통 교체 후보의 문턱, `feel`·`pulse` 방법 행, `sparePump`, F 줄 전부, CF1~CF7(CF5·CF6 은 X6 `DANGER_RULES` 두 줄), D4·D5, `TaskKind` 의 `airOut`·`pairOut`·`pair` | 2-c·2-f, 3(숨은 고장 — 열화상·`fitFor(waterRescue)` 의 남의 몸), 4(공기 왕복·짝 동행 경계 — `fire/std` 강제), 6(`fire/std`), 7(공기 부분), 8(소방 ≥ 12), 9 | 화재 강제 묶음의 표, 8.2 의 화재 범위 |
| **4 의료** | `WorkKind 'triage'`(`workLabel` '다수 사상자 분류', `fitFor`: 구급만, 실행: 믿음 속 환자마다 2초 서서 `casFact` 강제 보고 → `s.triageAt`), CE1 의 band 1 미루기·거두기, 경계 밖 처치소(E05 — `fitFor treat` 기본 규칙), `carryHold`·`laneTreat` 판단 지점, 처치 넘겨받기(CE2 — 실행기 `treat` 의 `handover`), E 줄 전부(E13·E14 는 6단계), CE1~CE5 | 2-g, 8(의료 ≥ 12) | 응급·교통 강제 묶음, 응급 대응 지연이 늘지 않는다 |
| **5 특수** | 줄 서기 진입(S01), 저격·섬광탄 가산(S02·S05), 해체 방법 셋과 `WORK_MODE`(3.7 — `fitFor defuse` 에 로봇 자격, `bareDefuse` 의 방호 끄기), 장치 반경(S08·CS1, `agentCost` +20), 화학 짝·대기조(S10·S11), 수난·헬기 줄(S13·S15·S25), 사다리 조작원(S19), S21~S24, 폭파 진입의 교본(S26 — R2 §4.2a 의 `charge` 가 먼저 있어야 한다), CS2, D1 | 2-i, 8(특수 ≥ 12 — 이제 네 분야 모두) | 폭발물·가스·수난 강제 묶음, `armed/hostage`·`armed/siege`(S26) |
| **6 이송·교통 방법** | R2 방법 행 `pack`·`drag`·`litter`(기록 전용)·`post`·`blockLane`, `s.laneShield` 와 `hazards.tickLane` 의 배율 한 줄, 판단 지점 `carryStart`, R1 척추 고정판 효과의 조건(`c.immob`), P20·F18·E13·E14 | 2-k | 교통 강제 묶음, 2차 사고 수가 늘지 않는다(`blockLane` 이 쓰인 사건에서는 준다) |
| **7 화면** | 7.1·7.2 전부 | 5(해시 불변 — 시드 20개) | 6단계 끝의 기록 해시와 **같다**, 스크린샷 직접 확인(`?seed=S7&force=fire/std`, `armed/hostage`, `traffic/bus`, `armed/bomb`), 콘솔 오류 0건 |
| **8 균형과 문서** | 8.2 최종 확인, 이 문서 끝에 구현 메모, (합칠 때) `README.md`·`CLAUDE.md`(11.5)·`docs/ROADMAP.md` | — | 보고 |

- 시험 8 의 "분야마다 12줄 이상"은 `doctrine/registry.ts` 의 상수 `DOC_DEPTS_DONE: DocDept[]`(단계마다 그 분야를 더한다 — 2단계 `['police']` … 5단계 네 분야)에 든 분야만 본다.
- **`npm run check` 의 시간**: 시험 4·6 이 강제 교대를 더한다(4 — `fire/std`·`armed/hostage` 각 6교대, 6 — 최소 인원 세 묶음 각 6교대). 0단계에서 `time npx vitest run tests/sim.test.ts -t 재현성` 으로 교대 하나의 시간을 재어, 더해지는 시간이 60초를 넘을 것 같으면 각 묶음을 6 → 3교대로 줄인다(그 결정을 이 문서 끝의 구현 메모에 적는다).

**완료 조건**(측정 가능하게):

1. **쓰인 줄의 비율**: 분야마다 **등록한 줄(`DOCTRINE` 의 개인 줄을 번호로 묶은 것 + 그 분야의 `CMD_ROWS` 지휘·관제 줄 — 3절 "읽는 법") 가운데 8.3 의 측정 묶음(보통 60교대 + 단계별 강제 묶음 + 최소 인원·장비 불량 묶음)에서 한 번이라도 쓰인 줄 ≥ 75%**. 측정 묶음에서 쓰이지 않은 줄은 **모두** 장면 시험(10절 2와, 거기 없는 줄은 같은 방식으로 더한 장면)이 쓴다 — 측정 묶음 ∪ 시험 = 100%. "쓰였다" = `I.docs` 에 그 번호의 줄이 있다. `fit` 줄은 2.7 의 1등 비교로 남긴 줄, 지휘 요청 줄은 `request` 가 0 이상의 기록 id 를 돌려준 때, CF5·CF6 은 그 줄이 구역 단계를 X6 줄보다 높인 때다.
2. **같은 상황 다른 행동**: `doctrine.split ≥ 0.5`(8.2 의 표본 정의).
3. 8.2 의 균형 목표(전체·유형별·대원 부상·다양성·추격·시간).
4. 시험 1~9 통과, `npm run check` 통과, 강제 묶음마다 한계 시간·방치 2건 이하.
5. 7단계의 해시 불변.

---

## 10. 테스트 (`tests/doctrine.test.ts`)

무거운 반복은 피한다: 강제 교대는 `new Sim(seed, NORMAL, 1200, { force: 'fire/std' })`, 장면 단위는 `createIncident(sim, { type, variant, rng: sim.rng.fork('t') })` 뒤에 대원·장비·몸 상태를 직접 놓는다. 장비를 빼는 것은 R1 의 장비 항목에 `faultKnown = true` 를 주거나 `kit` 에서 지운다. 특정 부대만 나가게 하려면 다른 부대를 시작 전에 `oos` 로 둔다. 각 시험이 들어가는 단계는 9절 표.

1. **정보 격리(글자)**: `src/sim/field/doctrine.ts`·`doctrine/*.ts`·`orders/doctrine.ts`·`dispatch/doctrine.ts` 의 주석이 아닌 줄에 `s.props`·`s.propAt`·`s.casualties`·`s.hostiles`·`.truth`·`.pursuit`·`s.fire[`·`s.smoke[`·`sim.scenes`·`s.variant`·`.fault`·`kitWorks`·`useKit`·`toolUse`·`bestTool`(R2 `gear.ts` 의 효과용 — `kitWorks` 를 부른다)·`needsHospital` 가 없다. `doctrine.ts` 에서 `.health`·`.bleed`·`.injuries` 가 나오는 줄은 모두 `stateSelf` 의 몸 안이다(그 함수의 시작 줄부터 첫 `^}` 까지를 잘라 낸 나머지에 0건). 줄 파일(`doctrine/*.ts`)에는 `sim.responders` 가 없다(줄은 `DocCtx` 만 읽는다). `orders/doctrine.ts` 에서는 `.health`·`.bleed`·`.dead`·`.injuries` 0건. `doctrine.ts` 가 `agents`·`executor`·`hazards`·`methods`·`methodRun`·`doctrineRun`·`crews` 를 **값으로** import 하지 않는다(`import type` 줄은 허용 — 정규식은 `^import (?!type )` 인 줄만 본다). 줄 파일은 `doctrine/registry` 와 타입·`util` 만 import 한다.
2. **같은 상황, 다른 장비·상태 → 다른 행동** (장면을 직접 만든다):
   - a. 흉기 난동(`armed/dispute`, 용의자 `fight`, 경찰에게 **`arrest`** 지시): ① 순찰 둘, 테이저 있음 → 테이저 발사 기록과 `P01` ② 테이저 지움, 둘이고 한 사람이 멀리 → 3칸에서 기다렸다 동시 덮침 `P03` ③ 테이저 지움, 하나(다른 대원 `oos`) → 3칸 거리 유지 `P02`, 20초 안에 덮치지 않고, 20초 뒤(지원 없음) 덮친다 ④ ③ + 시민을 용의자 1.5칸에 → 바로 덮침(예외 기록).
   - b. 닫힌 방의 총기 용의자: 진입조 하나 → 4초가 지나도 들어가지 않는다(`P07`, `gateAt` 이 있다). 동료를 붙이면 들어간다. 지원이 없는 상태로 60초 → 진입(timeout 문구). **동시 진입**: 두 문 진입에서 2조가 한 명뿐이면, 1조가 `breach` 를 불러도 2조의 문은 열리지 않고(`t.gateId === 'breach'`) 그 대원은 문 앞에 남는다. 동료가 오면 자기 문만 열고 들어간다.
   - c. 화재 실내 수색: 짝 있음·대기조 둘 → 맡는다. 짝을 `withdrawn` 으로 → `fitFor` 0(`F04`). 밖 대기조 0 이고 믿음 구조 대상 없음 → 문턱에서 기다림(`F05`), 같은 조건의 진압은 실내 방법이 빠져 외부 방어로(`F05b`). 같은 장면에 `occ` 사실(요구조자 2명) → 진입(예외 기록).
   - d. 탄: 교전 중 권총 `uses` 를 2 로, 피격 중 → 다음 판단의 임무가 `cover`(`P09`), 4초 피격 없으면 `rearm`(`P08`), 보급 뒤 `uses === 30`, 부대 `ammoBox` 하나 줄어듦. 그동안 하던 총기 상대 `engage` 는 놓였다(`P22` drop). `ammoBox = 0` → '보급할 탄약이 없습니다'와 `P22` 의 `fit`.
   - e. 중상: 같은 경찰 두 사람 가운데 하나의 `crew` 사실 band 1 → `engage` 의 `fitFor` 가 0.35배, `perimeter` 는 +0.15 — 지휘관 배정에서 다친 대원이 봉쇄를 받고, 그 지시 무전 끝에 까닭 말이 붙는다(교본을 빼고 셈한 1등이 달랐으므로). 두 사람 다 다치지 않았으면 까닭 말이 없다.
   - f. 공기: 연기 속 실내의 scba 대원 `uses = 0.25 × airFull` → 다음 판단에 `airOut`, 그 짝은 `pairOut`. 바깥에서 교체 뒤 `uses === airFull`, 예비 하나 줄어듦. **`uses = 50`(장비 1 의 `airFull` 220 에서 23% — R2 의 `kitCount('scba')` 가 0 인 구간)에서도 `airOut` 이 걸린다.** `uses = 0.4 × airFull` 인 대원은 위험 실내 일의 `fitFor` 가 0 이다.
   - g. 의료: 경찰이 처치 중인 환자 → 구급 대원에게 지시가 가고, 구급 대원이 1.5칸 안에 오면 경찰이 `handover` 로 놓는다(`CE2` — 지휘관 코드가 경찰의 임무를 직접 끝내지 않는다). 구급 대원이 처치 중인 환자를 다른 대원이 들지 않는다(`E08`, 15초 상한). `hot` 인데 안전 구역의 환자 → 구급 대원 처치(`E05`), 그 구급 대원이 동요 신고 중이면 맡지 않는다(`E20`). 믿음 환자 5명 → `triage` 작업이 생기고 그동안 band 1 처치가 나가지 않으며, 끝나면 `s.triageAt ≥ 0`. 분류 전에 구급 대원을 모두 `left` 로 → 열린 `triage` 가 거둬진다. 구급 지휘관의 부대에 `boardOrder` → 타기 전에 지휘가 **다른 부대의** 대원에게 넘어가고(`CE5`), 다른 부대 대원이 없으면 넘기지 않는다(기록 '지휘 넘김'이 한 번도 없다).
   - h. 추격: `I.trackBy = 'air'` 로 두고 `chaseRoles` → 지상 부대 셋 가운데 `follow` 하나·`block` 둘, `block` 의 목적지가 진행 방향의 교차로. 같은 `I.reportedNode` 를 다시 대입해도 `I.reportedPrev` 가 바뀌지 않는다.
   - i. 폭발물: 로봇 작동 → `robotDefuse`(로봇 조작 요원), 로봇 숨은 고장 → 처음 쓸 때 `EQUIP_FAIL`, 로봇 조작 요원이 놓고 처리 요원이 `suitDefuse` 로. 처리 요원의 `crew` 사실 band 1 → 손 해체 금지(`S23`), 로봇도 없으면 아무도 맡지 않고 B3 가 `eod` 를 부른다. 로봇 없음·옮길 수 없는 사람이 장치 6칸 안 → `bareDefuse`(`S07`), 그 사람이 없으면 `suitDefuse`. 해체 중 장치 4칸 안의 시민 `carry` 는 막히지 않는다(`S08` 예외).
   - j. 인질(P14): `armed/hostage`, 진입 결정 뒤, 현장 경찰 누구도 섬광탄 없음 → 7.5칸 엄폐 자리에서 기다리고(`P14`), **20초 안에** 지금 동작(접근·덮침)으로 넘어간다(상한 문구). 섬광탄을 가진 부대가 오는 중이면 40초.
   - k. 차량 차단(6단계): `traffic/std` 에서 밤으로 두면 경찰이 `blockLane` 을 고르고, 통제 지점에 닿은 순간부터 통제 전까지 그 방향 차의 부주의 확률이 0.4배다. 같은 시드에서 `s.rng` 의 다음 값이 `post` 를 고른 경우와 같은 횟수만큼 진행했다(호출 수 불변).
3. **판단에 새지 않는다**:
   - 숨은 고장: 열화상·로봇·유압 장비에 숨은 고장(`fault: true, faultKnown: false`)이 있는 대원과 없는 대원의 `docFit`·`docAct`·`docMethodMul` 이 같다(R1 시험 ④ 와 같은 방식).
   - 남의 몸: 대원 `b` 의 체력을 85 → 50, 출혈을 0 → 0.1 로 바꾸고 `b` 의 `crew` 사실은 그대로 두면(자기 신고 전) 지휘관이 부르는 `fitFor(sim, s, b, w)` 가 — `engage`·`search`·`waterRescue`·`suppress`(둘 다 R2 `methodFit` 경로 — `suppress` 는 소화기 길과 `defensive` 의 몸 상태 조건) 모두 — 바뀌지 않는다. `b` 가 다음 판단에서 신고하면 바뀐다.
4. **왕복 없음**:
   - 공기: `AIR_OUT ≤ air < AIR_IN` 인 대원은 위험 실내 일을 맡지 않는다(`fitFor` 0) — 탈출 뒤 교체 없이 다시 들어가지 않는다.
   - 강제 묶음(`fire/std` 6교대, `armed/hostage` 6교대)에서 대원별 임무 흐름을 기록해, 10초 안에 `A → B → A` 로 바뀌고 그중 하나가 교본 임무(`cover`·`rearm`·`airOut`·`pairOut`·`pair`)인 경우가 0. 판단 지점 timeout 으로 놓은 작업을 같은 대원이 30초 안에 다시 받는 경우가 0(`docMem` 의 `w:` 기억).
   - 짝 동행 경계: 짝의 일 우선도가 내 일보다 0.05 높은 경우(`buddyOf` 의 0.1 문턱 안)에는 `buddyOf` 가 `null` 이라 앞장설 대원이 맡지 않는다 — 기다림 → 놓음 → 재배정이 생기지 않는다. 짝이 방을 옮길 때(임무가 잠깐 비었다가 다음 방 수색) `pair` 가 끊기지 않는다.
   - 엄폐 중인 대원에게 지휘관이 교전 지시를 보내지 않는다(`assign` 건너뛰기).
   - 중상 간격: 체력을 68 ↔ 72 로 흔들어도 자기 신고 band 가 1 에 머문다(75 에서만 0). 체력 40 은 band 2(H1 `bandOf` 와 같다).
   - 동요: 동요 중에 피격을 더 받아도 `a.shaken` 이 늘지 않는다. 끝난 뒤 10초 안의 피격은 동요를 걸지 않는다.
5. **재현성과 순수 함수**: 같은 시드 두 번의 `report.hash` 가 같다 — 보통 교대, `fire/std`·`armed/hostage` 강제. `docFit`·`docAct`·`docDuty`·`docGate`·`docMethodMul`·`coverSpot`·`buddyOf`·`outsideWatch` 를 백 번 불러도 시뮬레이션 상태(장비 수량·고장 표시·`a.docMem`·`a.buddy`·난수 흐름의 다음 값)가 바뀌지 않는다. 0단계 커밋은 S0~S9 의 해시가 그 전 커밋과 같다(9절 — 이 시험은 그 커밋에서만 손으로 돌린다).
6. **모든 사건은 끝난다**: 최소 인원(`--diff 3,3,3,3,3,1` 과 같은 난이도) 강제 묶음 `fire/std`·`armed/dispute`·`armed/hostage` 각 6교대(9절의 시간 규칙에 따라 3교대)에서 교대가 끝났을 때 닫히지 않은 사건 0, `onscene` 으로 남은 부대 0, 모든 현장 `archived`, 한계 시간·방치 각 1건 이하.
7. **기록**: 교본 행동마다 `emit` 이 한 번(20초 안에 같은 대원·같은 줄의 문구가 둘이 아니다), 판단 지점의 막힘 문구는 임무마다 한 번, `I.docs` 에 그 줄. `crew` 사실의 글에 "돌리겠", "빠집니다", "하겠습니다" 가 없다. 교대 보고서 요약에 "교본:" 줄. (3단계부터) 공기 탈출이 있었던 사건(문제 셋 이하)의 `result.analysis` 에 "공기" 가 든 문장.
8. **표 자체**: `DOCTRINE` 의 `id` 가 겹치지 않고 `/^[GPFES][0-9]{2}[a-z]?$/`, `CMD_ROWS` 의 `id` 가 `/^(C[PFES][0-9]|D[0-9])$/` 이고 `DOCTRINE` 과 겹치지 않는다. 지운 번호(P06·F15)가 없다. `hook` 에 맞는 칸(`gate` 줄은 `gate`, `method` 줄은 `methods` 또는 효과마다 `methods`, `act`·`duty` 줄은 `effect.act`, `choose` 효과는 `gate` 줄에만, `swap` 은 `act` 줄에만), `note`·`report` 의 자리표시자가 `{name}`·`{mate}`·`{new}`·`{n}`·`{m}`·`{k}`·`{s}` 뿐. `DOC_DEPTS_DONE` 에 든 분야마다 등록한 줄(개인 줄 번호 + 그 분야의 `CMD_ROWS`)이 12개 이상(공통 제외). 부상 줄 넷(G01·P12·F14·E11)의 `who.doc` 가 서로 겹치지 않는다.
9. **의무 순서**: `boardOrder` 가 선 대원은 공기 30% 미만이어도 `board`. X6 의 철수 명령을 받은 대원은 `evacuate`(공기 탈출보다 먼저). 업고 있는 대원에게 `airOut` 이 걸리지 않는다. R2 의 물 위 대원에게 교본의 의무가 걸리지 않는다.

---

## 11. 고칠 파일, 알려진 위험, 결정 사항

### 11.1 공용 파일 수정

| 파일 | 함수·자리 | 무엇을 · 왜 | 단계 |
|---|---|---|---|
| `types.ts` | 2.1 | 추가만. 합집합은 그 단계에서 | 0~6 |
| `difficulty.ts` | `Tuning`·`tuningOf` | `ammoBox`·`sparePump`, `KNOBS` 장비 설명문 끝에 '탄약 상자·예비 펌프' | 2·3 |
| `crews.ts` (R1) | `KitDef`, `KITS` 총기 셋 | `mag`·`reload`·`perShot` 칸, 총기 `uses`·`mag` | 2 |
| | `armorOf`·`blastFactor` | `a.task.method === 'bareDefuse'` 인 대원은 `bombSuit` 를 세지 않는다(3.7) — 대원을 받는 쪽이 임무를 넘기게 인자 하나. **부르는 곳도 그 인자를 넘긴다**: H1 의 `hurtResponder`(`injury.ts` 의 `protection`), `hazards.tickHostiles`·`blast` — 그러지 않으면 맨몸 해체가 폭발·총격 피해에 반영되지 않는다 | 5 |
| | `capableOf` 의 공기 문턱 | R1 의 `uses ≥ 45` 를 `uses ≥ AIR_IN × airFull` 로(F03 과 같은 문턱 — 오는 부대 쪽 판정이 도착해도 맡지 못할 부대를 "할 수 있는 부대"로 세지 않게) | 3 |
| `field/executor.ts` `case 'carry'` (R1 의 고정판 규칙 자리) | 척추 고정판 효과(R1 §6.3 — 출혈 ×1.12) | 조건을 "고정판이 없으면"에서 "고정하지 않았으면(`!c.immob`)"으로(E13) | 6 |
| `field/gear.ts` (R2) | 판단용 감싼 함수 | `kitHas`·`kitQty`·`gunOf`·`roleIdOf`·`groupOf`·`crewHas` 를 **더한다**(2.4 — R1 `crews.ts` 를 감싼다. `doctrine.ts` 가 `crews.ts` 를 직접 부르지 않게. 있는 함수는 고치지 않는다) | 0 |
| `resources.ts` | `createRoster`·`createAidUnit` | 총기 `mag` 복사, `ammoBox`·`sparePump` 채움 | 2·3 |
| | `arrive` 의 `returning` | `ammoBox`·`sparePump` 가득 (R1 의 `spareAir` 옆) | 2·3 |
| `field/agents.ts` | `fitFor` 맨 끝 | `return docFit(sim, s, a, w, fit)` (R1 역할 선호 다음, 늘 보고 모드) | 0 |
| | `fitFor` 의 `treat` | `hot && dept !== 'police'` → `hot && dept !== 'police' && 믿음 속 그 환자가 'safe' 가 아님`(E05 — 교본은 0 인 자격을 열 수 없다, 2.6) | 4 |
| | `fitFor` 의 `defuse` | R1 의 eodKit 자격에 "작동하는 로봇(`hasKit(robot)`)"을 더하고, 전체에 `methodFit > 0` 을 곱한다(S06·3.7 `WORK_MODE`) | 5 |
| | `fitFor` 의 위험 실내 일 공기 문턱 | R1 §9 의 `uses < 45`(위험 실내 일 0)를 F03 의 `AIR_IN` 비율(`kitQty(scba) < AIR_IN × airFull`)로 대신한다. 진압은 R2 4단계가 이미 이 줄에서 뺐다(R2 §4.5 — `methodFit(suppress)`) | 3 |
| | `significant`, `flushOutbox` 의 `prompt`, 중요 사실 판정(`hot()`) | `'crew'` 갈래 (4.1) | 1 |
| | `perceive` 의 쓰러진 동료 | `shake` (4.3) | 1 |
| | `makeAgent` (R1) | `buddy: -1` 과 새 칸의 리터럴(짝 맺기는 `pairUp` — 5.1) | 0·3 |
| | `workLabel`·`fitFor` 의 `triage` | 4단계 | 4 |
| | `agentCost` | 장치 반경 +20 (S08 — 해체가 진행 중일 때만) | 5 |
| `field/brain.ts` | `think` | `perceive` 다음 `selfReport`(flushOutbox 앞), 0번 `rebuddy`, 4번 의무 자리(X6 `evacuate` 다음)와 `docDrop`, 후퇴 후보를 만드는 자리의 `docRetreat`(P11), 5번 `docAct` 후보(R1 공기통 교체 다음), 계속 점수에 새 임무 넷(4.4 끝), 임무 시작 자리의 `docSplit` 표본(8.2) | 0~3 |
| | R1 공기통 교체 후보 | 문턱 `air < AIR_IN && 바깥 && 손이 빔` 을 더한다(F03) | 3 |
| | 예비 펌프 후보 | `sparePump > 0` 조건(F10) | 3 |
| `field/executor.ts` | `shootAt` | 탄약 소모·재장전 중 돌아가기(난수 전에) (2.9) | 2 |
| | `act` 첫머리 | `reloadTick` 한 줄 | 2 |
| | **`case 'arrest'`** | 순서는 **테이저 → 비살상탄 → `closeIn` 판단 지점 → `moveTo` 하나**(R2 §4.6 과 같은 문장). `moveTo` 를 부르기 전, R1 테이저·R2 비살상탄 다음 자리에 `closeIn`(P01~P03): 막히면 P01 은 1.8칸·P02·P03 은 3칸에서 멈추고(그 칸까지만 `moveTo` — 한 틱에 하나) 기다림, 풀리면 지금 동작 | 2 |
| | `case 'engage'` | 첫 갈래(도주 추격)에는 걸지 않는다. ① 진입 대기의 조건을 `… ‖ t.gateId === 'breach'` 로(P07), 방 진입의 `roomEntry`(P07), 섬광탄의 `bangUse`(P15), 인질 갈래의 `closeIn`(P14 — 7.5칸 엄폐 자리, 상한 뒤 지금 동작), 마지막 분기의 `coverFire`(P05 — 임무에 담은 자리) | 2 |
| | `breach` | 출입구 반복의 몸을 `doctrineRun.breachExit` 로 꺼내고, 진입조가 한 명인 출입구는 `docGate('breach')` 로 물어 건너뛴다(P07). 줄 서기(S01 — `choose 'stack'`)도 그 반복 안 | 2·5 |
| | `case 'negotiate'` | 그대로(P16 은 `brain` 의 후보가 `cover` 로 옮긴다) | — |
| | 위험 실내 첫걸음 | `interiorEntry` 판단 지점 (`moveTo` 를 부르기 전, 지금 칸이 실내가 아니고 경로의 다음 칸이 위험 건물 실내일 때 — `search`·`carry`·`escort`·`extricate`·`mitigate`·`overhaul` 과 `suppress` 의 실내 방법 — `t.method` 가 `interior` 이거나 없을 때. 교본이 `interior` 를 뺀 진압은 `defensive` 라 해당 없음, 2.6) | 3 |
| | `case 'carry'` | 처음 돌 때 R2 의 `startMethod`(`pack`·`drag`·`litter` — 6단계, 실행은 `doctrineRun.runCarry`), `carryHold`(E08), 처음 들 때의 `carryStart`(E13 — 6단계, 고정하면 `c.immob = true`) | 4·6 |
| | `case 'treat'` | `laneTreat`(E12), 처치 넘겨받기 — 그 작업을 맡은 구급 대원이 1.5칸 안이면 비구급 대원이 `finishTask(…, false, 'handover')`(CE2) | 4 |
| | `case 'defuse'` | 처음 돌 때 R2 의 `startMethod`(null 이면 맡지 않음 — R2 §3.5 의 "맡지 않음" 갈래에 `defuse` 를 더한다), 해체 방법 셋 (S06·S07·S23 — 실행은 `doctrineRun` 의 `runDefuse`) | 5 |
| | `case 'traffic'` | 처음 돌 때 R2 의 `startMethod`, `post`·`blockLane` (6단계 — 실행은 `doctrineRun.runTraffic`, `blockLane` 은 닿는 순간 `s.laneShield`, 설치 +3초) | 6 |
| | 새 `case` 여섯 | `cover`·`rearm`·`airOut`·`pairOut`·`pair`·`triage` → `doctrineRun` 의 실행 함수 (R2 의 `XK: ExecKit` 를 그대로 넘긴다) | 2~4 |
| | `finishTask` 사유 표 | `doctrine`·`handover`: 실패 기록·`w.fails`·`holdUntil`·'중단 — 재지시 요청' 무전 없음. `doctrine` 은 부르는 쪽이 `holdUntil = sim.t + 10` 을 따로 둔다(판단 지점 timeout 만 — 4.4) | 2 |
| `field/methods.ts` (R2) | `MethodCtx`·`chooseMethod`·`methodFit` | `chooseMethod` 의 마지막 인자 `dc`(실행부가 자기 모드로 만들어 넘긴다), `methodFit` 은 인자 그대로 두고 안에서 `docCtx(…, 'report', w)` — 2.3 ③·R2 §3.2. 점수에 `× docMethodMul`(받은 `dc` 의 사본 `{ ...dc, m }` 으로), `caution` 에 동요 +0.2(G02b, 상한 1.1), `MethodWhy` 여섯의 까닭 계산(교본 배율을 빼고 다시 셈한 1등이 다르면 그 차이를 만든 줄 가운데 `rank` 가 가장 작은 줄의 까닭을 3.7 의 사상 표로 — R2 §3.4 의 1 다음·2 앞). `defensive` 의 `can` 에 교본 조각과 몸 상태 조건 바꾸기(3.7) | 0·1 |
| | `METHOD`·`SAY`·`WORK_MODE` | 행 열 개와 `carry`·`traffic`·`defuse` 의 갈래 (3.7) | 3·5·6 |
| `field/methodRun.ts` (R2) | 진압·수색 실행부 | `pulse`·`feel` 의 효과 (3.7 — 이송·통제·해체의 효과는 R3 의 `doctrineRun.ts`) | 3 |
| | 저격 실행부 | 판정 직후 `doctrineRun.fireRound(sim, a, 'sniper')`(2.9 — 탄창·재장전은 그 함수가 맡는다), 재장전 중이면 조준을 멈춘다 | 2 |
| `debrief.ts` (R2 의 `WHY_TEXT`) | 방법 까닭 말 | 여섯을 더한다: `hurt: '다쳐서'`·`alone: '혼자였음'`·`lowAir: '공기가 부족해'`·`lowAmmo: '탄약이 떨어져'`·`shaken: '동요해'`·`tired: '지쳐서'`(7.3 `WHY_DOC` 의 말 — R2 §3.8) | 1 |
| `field/commander.ts` | `syncBoard` 의 무장 블록 | CP1 의 `usable` 과 쓰는 자리(흉기 검거·진입 갈래 — 100초 시간 예비와 `posts` 는 머릿수 그대로), 그 요청 한 줄 | 2 |
| | 인질 진입의 125초 줄 | CP4 (확인 필요) | 2 |
| | `request` | 보낸 무전의 기록 id, 버렸거나 못 보냈으면 −1 을 돌려준다(6.1 끝) | 2 |
| | `assign` | 교본 임무 건너뛰기(2.6), 교본 전후의 1등 비교와 까닭 말(2.7), CE2 의 지시(`max` 예외)·CS2 가산·CF7 지휘관 제외 | 1·2·3·4·5 |
| | 펌프·용수 요청 줄 | CF3 문구 나눔 | 3 |
| `field/sceneRegistry.ts` | `CommandKit.request` | `=> void` → `=> number`(기록 id) | 2 |
| `field/sceneManager.ts` | `unitArrived` | 대원 생성 반복 뒤 `pairUp(sim, s, u)` 한 번(5.1) | 3 |
| | 4번 블록(승계) | 조건에 "지휘관의 부대에 `boardOrder` 가 섰으면" 한 조각, 그때의 후보에서 `boardOrder` 부대 대원을 빼기, 후보가 없으면 넘기지 않음, 승계 문구 '지휘 넘김' (CE5) | 4 |
| `field/hazards.ts` | `tickHostiles` 피격·피습 줄, `blast` | `shake` (4.3) | 1 |
| | `tickLane` | 새 차의 방향 지점이 `s.laneShield` 에 있고 통제 전이면 부주의 판정 확률 ×0.4 (곱만 — `s.rng` 호출은 그대로, 3.7) | 6 |
| `field/orders/catastrophe.ts` (X6) | `DANGER_RULES` | 줄 둘(CF5 — 측정기 없는 가스 + 불씨 → 단계 2, CF6 — 예비 공기 없는 센 불 100초 → 단계 1. 표의 모양 그대로), 그 줄 때문에 단계가 오른 구역의 `recordDoc` | 3 |
| `pursuit.ts` | 추적 반복·목격 신고·`stop` | `I.trackBy`, `I.reportedPrev`(값이 바뀔 때만)·`I.reportedNodeAt` 적기, 방향 전환 줄에서 `chaseRoles` | 2 |
| `dispatch/dispatcher.ts` | `pickUnit` 점수 | `+ dispatchPref(sim, I, u, need)` | 2·3·5 |
| `dispatch/analyst.ts` | 수요 | `docNeeds(n, as)` (D1·D3·D6) | 2·5 |
| `debrief.ts` | `evaluate` 끝(맺음말 앞, R2 방법 문장 다음) | 교본 문장 최대 2(방법과 합쳐 3) | 1 |
| | `buildReport` | `doctrine`·`docSplit` 집계, 요약 한 줄 | 1 |
| `field/scenes/index.ts` | 끝 | `import '../doctrine/index';` `import '../orders/doctrine';` | 0 |
| 생성 리터럴 | `makeAgent`·`makeTask`·두 `Unit` 리터럴·`baseScene`·`createIncident` | 새 선택 칸 (2.1 끝 — 속도만) | 0 |
| `view/renderScene.ts` | `agentPose` | `cover` 의 자세 (7.2) | 7 |
| G5 의 협상 중단 표시 술어 | (G5 가 둔 자리) | "또는 `cover` 이고 `docRule === 'P16'`" (7.2 — 그림만) | 7 |
| `view/scene/doctrineLayer.ts` (새, 선택) | — | 짝 끈 | 7 |
| `ui/panels.tsx` | `AgentPanel` | 7.1 | 1·7 |
| `scripts/sweep.ts` | 인자·출력 | `--doctrine` (8.3) | 0 |
| `tests/crews.test.ts` (R1) | 총기 장비를 글자 그대로 비교하는 곳이 있으면 | `uses`·`mag` 를 기대값에 | 2 |

### 11.2 알려진 위험

1. **2인 진입·대기조가 화재를 어렵게 만든다.** 최소 인원 펌프차(3명)는 밖 대기조가 1명이라 다른 소방 부대를 기다린다. 신고 인원이 있으면 예외라 대부분의 화재는 바로 들어가지만, 사람이 없다고 알려진 큰 불은 늦게 들어간다(의도 — R2 의 외부 방어와 같은 방향). 8.4 의 1번 손잡이.
2. **대치가 길어진다.** 단독 진입 보류(P07)·흉기 거리 유지(P02)·인질 덮침 제한(P14·CP4)이 모두 기다리는 쪽이다. 모두 상한이 있지만(4.4), 극한 난이도(지원이 오지 않는다)에서 한계 시간이 늘 수 있다. 특히 CP4 는 섬광탄이 없는 인질 사건에서 "인질이 다쳤을 때만 진입"이 되므로(섬광탄이 있으면 18초 줄이 먼저 걸린다) 기동대가 오지 않는 교대에서는 시한(인질 부상)이 진입을 여는 유일한 길이 된다. 8.4 의 2번.
3. **탄약 줄은 드물게만 쓰인다.** 교전이 대개 짧다(20교대 특공 교전 187초). 완료 조건 1이 장면 시험으로 보충한다. 너무 드물면 권총을 15+15 에서 줄이지 말고 그대로 둔다(현실적인 드묾).
4. **추격 앞막기가 도주 차를 다른 길로 몬다.** 도주 차는 추격자에게서 170 안의 교차로를 피해 고른다(`pursuit.pickNext`). 앞막기 부대가 예상 교차로에 가면 차가 그 길을 피해 놓칠 수 있다. 8.2 의 놓침 목표, 8.4 의 3번.
5. **무전이 는다.** `crew` 사실(자기 신고)과 교본 문구로 기록 줄이 늘어난다. 상태 변화 때만 보내고 같은 말은 20초에 한 번, `crew` 의 나아짐(공기 교체 뒤 등)은 처음부터 묶음 보고·글 없음(4.1)이다. 그래도 붐비면 '공기 50% 미만'·'탄약 마지막 탄창'(위급이 아닌 낮음)도 글을 비운다.
6. **판단 오차의 난수가 밀린다.** 교본 후보 하나가 그 대원의 `a.rng` 흐름을 한 칸 민다(2.8). 0단계만 해시가 같고 1단계부터 모든 시드가 바뀐다.
7. **R1·H1·X6·R2 가 문서대로 구현되지 않았을 수 있다.** 함수 이름(`makeAgent`·`kitCount`·`chooseMethod` 의 인자·`DANGER_RULES` 의 줄 모양·`evacuate` 자리)이 다르면 실제 코드를 따른다. 이 문서의 표는 그 함수들의 "역할"로 읽는다.
8. **짝을 다시 맺을 때 다른 대원의 칸을 고친다**(`b.buddy`). 대원 순서대로 판단하므로 결정적이지만, 같은 틱에 두 대원이 서로 다른 짝을 고르지 않게 "짝이 없는 사람만" 고른다(5.3).
9. **성능**: `docFit` 이 `fitFor` 마다 불린다. 2.4 의 캐시로 틱마다 한 번만 상태를 만든다. R1 로 대원이 1.9배쯤 는 것과 겹친다 — 8.2 의 1.15배를 넘으면 `docFit` 을 `(rid, workId, tick)` 으로 담아 둔다.
10. **동요는 침착함이 낮은 대원을 크게 바꾼다**(6~26초). 무장 결과가 흔들리면 길이를 `12 × (1.3 − composure)` 로 줄인다.
11. **`coverSpot` 이 없는 현장**: 길 위 현장(`s.outdoor` — 추격 끝)과 넓은 홀에는 엄폐 칸이 적다. 자리가 없으면 지금 동작으로 가므로 막히지는 않지만, 그 현장에서는 P05·P11 이 거의 쓰이지 않는다.
12. **고칠 수 없는 기존 시험 둘**: `tests/sim.test.ts` 의 생활 사건 시험(`armed/domestic` 의 순수 성공 비율 > 0.6)과 `tests/crime.test.ts` 의 '폭동'(흉기 주동자 둘·맨손 가담자 — 한계 시간 상한). P01~P03(흉기 거리 유지·동시 덮침)·P07·CP1 은 칼 든 가정 폭력과 폭동 진압을 늦춘다. R3 는 두 시험 파일을 고치지 않으므로(H1 §12.2-2 가 같은 위험을 적었다) 2단계 끝에 `npx vitest run tests/sim.test.ts -t 생활`·`npx vitest run tests/crime.test.ts -t 폭동` 을 따로 돌리고, 깨지면 8.4 의 2번 손잡이를 그 순서로 돌린다.
13. **CF5 가 가스 현장을 어렵게 만들 수 있다.** 측정기를 가진 부대(화학 구조차)가 아직 오지 않은 가스 누출에서, 불씨 곁의 냄새는 단계 2(새 진입 금지)가 된다. D1(화학대가 가스 현장에 온다)이 짝으로 들어가는 까닭이다. 가스 결과가 범위를 벗어나면 CF5 의 불 믿음 문턱을 0.1 → 0.2 로.
14. **`request` 가 값을 돌려주게 바꾼다.** 지금 값을 쓰는 곳이 없어 결과는 바뀌지 않지만, X6·H1·R2 의 지휘 규칙이 `k.request` 를 부르는 줄은 그대로 컴파일된다(돌려준 값을 버린다). 타입만 바뀐다.

### 11.3 결정 사항 (조사에서 열려 있던 질문)

1. **고르는 자리**: 판단 전용 파일의 순수 함수를 네 자리(`fit`·`duty/act`·`method`·`gate`)에서, 지휘·관제는 이미 격리된 두 파일에서(2.3). 실행기가 진실로 고르는 길은 두지 않는다.
2. **남의 몸**: 지휘 쪽과 `fit` 은 자기 신고 `crew` 사실로만 안다. `mate` 사실을 쓰지 않는다(H1 의 `treatMate` 가 걸린다 — 2.4).
3. **예외는 금지 줄의 `when` 안에**: "허락" 줄을 따로 두지 않는다(2.6).
4. **새 문제 코드를 만들지 않는다**: 교본은 선택이다. 보고서는 `I.docs` 로 말한다(7.3).
5. **탄약은 가볍게**: 탄창·재장전·재보급·상자. 총기 종류별 사거리·명중은 R1 그대로. 탄약 수는 교대 사이에 남지 않는다(I2 가 정하지 않는 한).
6. **거리 유지(`standOff`)는 임무가 아니라 `arrest` 안의 분기**다(흉기 상대는 `arrest` — 0절) — 임무로 만들면 지휘관의 `arrest` 작업과 대원의 임무가 갈라진다. 엄폐(`cover`)는 상태 행동이라 임무다.
7. **시한은 쓰지 않는다**: 폭발물의 시한은 진실에만 있다. 교본의 "서두름"은 시한이 아니라 장비(로봇·방호복)와 주변 사람(믿음)으로 정한다.
8. **창문 구조는 하지 않는다**(ROADMAP C4 — 사다리차의 위층 구조는 현장 격자에 바깥에서 위층으로 가는 길이 없다).
9. **짝은 작업판의 담당자가 아니다**(`WorkItem.max` 그대로 — R1 원칙). 몸은 둘, 담당은 하나.
10. **사다리차는 교본 표만 특수**에 두고 부대 분야·편성은 R1 그대로(2.2).
11. **분류는 새 작업(`triage`)**이다 — 처치의 방법으로 넣으면 환자 한 사람의 일이 되어 "모두를 먼저 본다"가 되지 않는다. 분류의 효과는 믿음 속 중증도를 바로잡고 그동안 band 1 처치를 미루는 것이다(CE1).
12. **상태를 묻는 모드는 둘**이다(2.4): 남에게도 불리는 자리(`fitFor`·`methodFit`)는 보고 모드 — 몸은 신고로, 공기·탄·지구력은 조직 정보로. 대원 자신의 판단(②·④, 실행부의 방법 고르기)은 자기 모드.
13. **상한이 없는 판단 지점은 없다**(4.4). P14 처럼 "기다리는 동안 다른 대원이 무엇인가 한다"는 근거가 실제 코드에서 성립하지 않을 수 있다.
14. **교본은 기본 자격을 열지 않는다**(2.6). 열어야 하면 `fitFor` 의 그 `case` 를 고치고 교본 줄은 기록만 맡는다(E05·S06).
15. **지휘관은 교본 임무 중인 대원을 빼 가지 않는다**(2.6). 그 대신 교본 임무는 짧고 스스로 끝난다(엄폐 12초 상한 등).
16. **짝은 역할 쌍으로 적고, 부대가 내린 뒤 한 번 맺는다**(5.1). R1 의 `crew` 는 압축 배열이고 `makeAgent` 에는 현장 인자가 없다.
17. **폭파 진입은 R2 의 방법, 고르는 때는 S26**(사용자 결정 2026-11-15 — "전부 추천대로"). 장약은 R1 의 장비(`charge` — 진입대원(파괴)·폭발물 처리 요원), 효과·조건은 R2 §4.2a. 교본은 "인질 위치를 모르면 쓰지 않는다"와 "진입 순간에 쓴다"만 얹는다 — 문 둘레의 사람·가스·장치·구조 조건은 R2 의 `can` 이 이미 믿음으로 본다(두 곳에서 같은 조건을 따로 깎지 않는다).

### 11.4 확인 필요 목록

- X6 `DANGER_RULES` 의 실제 줄 모양(R3 의 CF5·CF6 두 줄을 그 모양에 맞춘다). "그 줄 때문에 단계가 올랐는가"를 알려면 `dangerMap` 이 이긴 줄을 알아야 한다 — 줄에 `id` 칸이 없으면 R3 가 더한다(모양을 바꾸지 않는 선택 칸). (반영됨 — X6 연관 표의 R3 줄이 이 예외를 적었다.)
- R1 `makeAgent` 가 실제로 꺼내졌는지, 대원 리터럴의 자리(`buddy: -1` 을 넣는 곳). `pairUp` 은 `unitArrived` 의 반복 뒤.
- (반영됨 — R2 §3.2) R2 `chooseMethod` 의 마지막 인자 `dc: DocCtx | null`, `MethodCtx` 는 export 하지 않음(R3 는 `Sense`·`MTarget` 만 타입으로), `methodFit` 은 인자 그대로 두고 안에서 보고 모드 `dc` 를 만든다.
- (반영됨 — R2 §4.6·§5 예 7·§8 시험 3·§9) **R2 에 알릴 것**: 흉기 상대 비살상탄은 `case 'arrest'` 의 `moveTo` 앞(테이저 다음)이다. `case 'arrest'` 안의 순서는 테이저 → 비살상탄 → `closeIn` → `moveTo` 하나(11.1 과 같은 문장). R2 가 이미 `engage` 첫 갈래에 들어와 있으면 그 자리를 `arrest` 로 옮긴다.
- (반영됨 — X6 §5.3·§5.6) **X6 에 제안할 것**: X6 §5.3 단계 2 의 "체력 ≥ 60"(허락된 구조 일)과 §5.6 제한적 구조 진입(`w.risky`)의 "체력 ≥ 70" 을 `fitFor` 가 다른 대원에게 읽으면 남의 몸 읽기다. R3 의 `crew` 신고(band 0 ≈ 체력 70 초과, 신고가 없으면 0)로 판정한다 — R3 전에는 체력 조건 없이 H1 의 물러남에 맡긴다. 지구력 ≥ 40 은 조직 정보라 그대로.
- CP4(섬광탄 없는 인질 진입 금지)·D6(기동대 둘)은 균형을 보고 켤지 정한다.
- I2 가 `ammoBox`·`sparePump`·동요를 이어받을지(I2 §3.3 의 표에 줄을 더하는 것은 I2 몫).
- 교본 문장과 R2 방법 문장의 합계 상한 3 이 보고서 길이에 맞는지(R2 의 "11~12줄에서 잘린다").
- (닫음) D3 의 흉기 신고: 통화 주제 `weapon` 의 값 `'knife'`(`callSystem`·`analyst` 가 이미 쓴다). D4 의 2층 표시: `KIND_SCENE[k].tall` 은 2층일 확률(0..1) — 문턱 0.5, 건물 종류는 위치 신고의 `placeKind`.

### 11.5 `CLAUDE.md` 에 들어갈 줄 (합친 뒤에 고친다)

**구조** 절에 세 줄: `src/sim/field/doctrine.ts`(교본 판단 엔진 — 믿음·자기 몸·자기 장비만), `src/sim/field/doctrine/`(분야별 교본 줄), `src/sim/field/doctrineRun.ts`(교본 행동의 실행·탄약·짝). 정보 격리 목록의 "진실을 읽으면 안 되는 곳"에 `field/doctrine.ts`·`field/doctrine/*`·`dispatch/doctrine.ts`.

**자주 하는 확장** 표에 한 줄:

| 하고 싶은 것 | 고칠 곳 |
|---|---|
| 새 교본 줄 (이 상황·장비·상태면 이것을 먼저) | `field/doctrine/<분야>.ts` 끝에 `registerDoctrine({ id, dept, who, hook, works/gate/methods, kits/noKits, when, effect, rank, why, note, report })` — `when` 은 `DocCtx` 만 읽는다(믿음·자기 몸·자기 장비). 새 상태 행동이면 `types.ts` `DocActId`·`TaskKind` → `doctrineRun.ts` 실행 → `brain` 계속 점수. 새 판단 지점이면 `DocGateId` → 실행기의 그 분기에서 `docGate` 를 부르고 막히면 기다림·상한(4.4). 확인은 `npm run sweep -- 20 --force 유형/변형 --scen --doctrine` |

**함정** 후보:
- **교본은 진실을 읽지 않는다.** 줄은 `DocCtx` 만 받는다. 남의 몸은 자기 신고(`crew` 사실)로만 — `fitFor`·`methodFit` 은 지휘관이 다른 대원에게도 부르기 때문이다(보고 모드). 공기·탄·지구력은 조직 정보(`gear.kitQty`·`gunOf`, 명부의 지구력). 공기는 비율(`kitQty / airFull`)로 본다 — R2 의 `kitCount('scba')` 는 60초에서 0 이 되는 0/1 값이다.
- **흉기 상대는 `arrest` 다.** 지휘관은 흉기·맨손 용의자에게 `engage` 가 아니라 `arrest` 를 낸다(`engage` 는 도주와 총기 진입 결정 뒤에만). 흉기 상대에게 붙는 판단을 바꾸려면 `case 'arrest'` 의 `moveTo` 앞을 고친다.
- **교본은 기본 자격을 열지 못한다.** `fitMul` 은 0 을 키우지 못하고 `fitAdd` 는 0 에 더하지 않는다. 0 인 자격을 열려면 `fitFor` 의 그 `case` 를 고친다.
- **`fit` 0 은 하던 일을 놓게 하지 않는다.** 계속 점수는 `fitFor` 를 보지 않는다. 하던 일도 놓아야 하면 그 금지에 `drop` 을 붙인다(`docDrop`).
- **동시 진입은 문 하나가 아니라 현장 전체다.** `breach()` 는 한 사람이 불러도 모든 출입구의 진입조를 함께 들인다. 한 문만 막으려면 출입구 반복 안에서 건너뛴다(`breachExit`).
- **예외는 금지 줄 안에.** "허락" 줄을 만들면 등록 순서에 따라 결과가 갈린다.
- **기다리는 교본에는 상한이 있다.** 판단 지점에서 막힌 대원은 임무를 쥔 채 서 있다. 상한이 없으면 교착이 된다 — 상한이 지나면 지금 동작이나 임무를 놓는 갈래로(4.4).
- **문턱에는 간격을.** 공기 0.30/0.50, 중상 70/75, 지구력 30/22/40. 들어가는 문턱과 나오는 문턱이 같으면 왕복한다("쉬는 대원의 왕복"과 같은 함정).
- **교본 후보는 한 판단에 하나.** 판단 오차가 후보마다 `a.rng` 를 부르므로 후보 수가 결과를 바꾼다.
- **재장전 중에는 난수를 부르기 전에 돌아간다.** `shootAt` 의 명중 판정(`s.rng`) 뒤에서 막으면 쏘지 않았는데 흐름이 진행한다.
- **짝은 작업판의 담당자가 아니다.** `WorkItem.max` 를 늘리지 않는다. 짝은 `pair` 임무로 따라간다.

---

## 검토 메모 (독립 검토 두 건 — 실행 가능성·규칙 / 빠진 것)

**반영한 것** (자리만 적는다 — 내용은 본문):
- 흉기 상대는 `arrest`: P01~P03 의 `closeIn` 을 `case 'arrest'` 로(0절·3.1·11.1·시험 2-a), R2 §4.6 의 같은 착오는 11.4 에 알릴 것으로.
- P06 지움(걸릴 자리 없음), F15 지움(G03 과 같음), `DocPhase 'standoff'` 정의 고침.
- P14 에 상한 20초(섬광탄 부대가 오면 40), timeout = 지금 동작, 4.4 의 근거 문단 고침, 시험 2-j. 상한 없는 판단 지점을 없앴다(P07 은 지원이 와도 120초).
- 남의 몸: `stateSelf`/`stateReported` 두 모드와 칸별 표(2.4), `methodFit` 은 보고 모드(2.3 ③), 정규식 대신 행동 시험(10절 3, `waterRescue` 포함), 지구력은 조직 정보로 명시.
- `gear.ts` 감싼 함수 다섯(`kitHas`·`kitQty`·`gunOf`·`roleIdOf`·`groupOf`), scba 줄은 '들었는가'와 `st.air` 비율로(2.4·2.5·3.2·시험 2-f 의 60초 아래 구간).
- 점수·왕복: P08~P10 0.97, `cover` 계속 0.97, P16 0.93, `assign` 이 교본 임무를 건너뜀(2.6), P09 → P08 잇기, 탄 0 의 놓기(`drop` — P22), P11 은 후퇴 후보를 바꿔 끼우는 `swap`.
- 동시 진입: `breach()` 의 출입구 반복을 `breachExit` 로 꺼내 혼자인 문만 건너뜀, `t.gateId`(3.1 끝).
- CE5 후보 거르기, E05·S06 은 `fitFor` 기본 자격을 고치고 교본 줄은 기록 전용, CF5·CF6 은 X6 줄보다 높거나 이른 단계를 내게 다시 정함, `request`·`CommandKit.request` 가 기록 id 를 돌려줌, `blockLane` 의 효과를 통제를 세우는 동안으로(`laneShield`, 호출 수 불변), P05 의 자리를 임무에 담고 위협 둘레 고리에서 찾음(2.10), `docMem` 의 두 뜻(4.4 끝), `buddyOf` 의 0.1 문턱과 G08 의 +0.12·짝 동행 3초(5.2·5.4), `PAIRS` 를 역할 쌍·최소 인원 열로·`pairUp`(5.1), 화학 짝을 보호복 + 측정·제독으로 고쳐 S10·S11 과 맞춤, `outsideWatch` 정의(5.6)와 F05b, 시험의 단계 배정과 `DOC_DEPTS_DONE`(9절), CE2 는 지시만 보내고 실행기에서 `handover`, CE1 의 거두기와 분류의 효과(band 1 미루기·믿음 바로잡기), `crew` 사실의 글은 사실만.
- 덧붙인 것: D3(통화 주제 `weapon` = `'knife'`)·D4(`tall ≥ 0.5`, 위치 신고의 `placeKind`)·D7(값이 바뀔 때만 `reportedPrev`, 세 곳, 공개 정보로 차 도착 예상, `.pursuit` 금지어), `bandHyst` 를 H1 경계 위에, `weaponOf`(G5)·저격 탄 소모(R2 `methodRun`), 캐시에 `sense`·`dng` 를 넣지 않고 모드별로 담기, `pairOut`·`airOut` 의 끝과 나갈 자리(5.7), `import type` 허용, `selfReport` 를 `flushOutbox` 앞으로, `crew` 위급의 중요 판정, F03·F04·F05 의 진압은 방법만 빼기, `sit.wDanger`(F13), 해체 방법 셋의 표와 `WORK_MODE`·로봇 효과의 겹침(3.7), S08 예외와 걸리는 때, G01 은 `who.doc: ['special']`, 등록 칸 표(3.6 — 모든 "새로" 줄의 rank·why·who·kits), 행동 줄의 순서, `split` 의 표본과 "쓰였다"의 정의(2.7·8.2), 의료 상태 줄 셋(E18~E20), 특수 상태 줄 셋(S23~S25), S07 을 실제로 걸리는 조건으로, E13 을 위해 R1 척추 고정판 조건 바꾸기, D5 를 R1 가산과 합쳐 +20, P11 의 X6 조짐 제외, G5 협상 중단 표시, CP1 은 동요를 빼지 않고 100초 규칙·`posts` 는 머릿수, 기존 시험 둘의 위험(11.2-12), CP4 의 극한 위험, X6 §5.3 '체력 ≥ 60' 제안(11.4), 사다리차 근거를 ROADMAP 의 조직 목록으로.

**반영하지 않았거나 다르게 한 것과 까닭**:
- P06 을 다시 정의하지 않고 지웠다. 제안된 대안(도주 총격범을 거리를 두고 따라가기)은 도주 중인 용의자가 쏘지 않으므로(`hazards.tickHostiles` — `flee` 는 출구로 움직이기만 한다) 놓침만 늘린다. 다른 대안(진입 뒤 혼자 남은 `engage`)은 P05(엄폐 사격)·P07(방 진입)과 겹친다. 경찰의 "혼자라서 다르게"는 P02·P07·P17 이 보여 준다.
- P09·P10 을 의무로 두지 않고 점수 0.97 로 했다. 의무로 두면 H1 의 체력 < 40 후퇴·출혈 후퇴(점수 후보)보다 앞서 버린다 — 탄이 떨어진 중상 대원이 대기 지점으로 물러나지 못하고 그 자리 근처에 숨는다. 0.97 이면 교전 지시·계속(0.92·0.94)과 후퇴 0.95 사이의 순서가 판단 오차를 넘어서는 만큼 붙잡히고, `assign` 건너뛰기가 지휘관 쪽의 왕복을 막는다.
- P14 의 상한은 완성도 검토의 25초(40초)가 아니라 실행 검토의 20초에 맞추고, 섬광탄 부대가 오는 경우만 40초로 늘렸다(P02 의 20/30 과 같은 결 — 기동대 도착이 30초를 넘는 일이 많아 그 경우만 길게).
- 특수 상태 줄은 제안된 여섯 가운데 셋(S23 중상·동요한 처리 요원, S24 동요한 저격수, S25 지친 수난 대원)만 더했다. "방호복을 입고 지구력 < 40 이면 해체를 멈추고 교대"는 폭발물 처리반의 처리 요원이 하나뿐이라 넘겨받을 사람이 없고, 해체 중에 멈추는 길(실수 판정이 `a.rng` 를 쓰는 중간 상태)을 새로 만들어야 한다. "내려앉은 헬기의 자리 0·연료"는 R1 이 지상의 소방 헬기 연료를 줄이는지 정하지 않았다. "화학 보호복 대원 공기 50% 미만 교대"는 F01·F03 이 이미 한다. 특수는 그래도 16 + 5 줄이고 상태 칸이 비어 있지 않다.
- E18(위중 처치 중 지친 대원)은 하던 처치를 넘기는 대신 새로 맡지 않게(`fit ×0.3`)만 했다. 처치 중 교체는 CE2 와 같은 넘겨받기 길이 하나 더 필요하고, 지금 휴식 문턱(22)이 하던 처치를 이미 끊는다.
- `PAIRS` 를 위해 `Responder.slot` 칸을 더하는 대안은 쓰지 않았다 — R1 의 명부 리터럴과 I2 의 이어받기 표를 함께 고쳐야 한다. 역할 쌍과 최소 인원 열로 같은 결과를 낸다.
- "fit 이 배정을 바꿨다"를 '뽑힌 대원에게 중립 아닌 효과가 걸렸다'로 단순화하지 않고, `assign` 안에서 교본 전후의 1등을 비교하는 정의를 골랐다. 단순화하면 모든 다친 대원의 배정이 '쓰였다'가 되어 완료 조건 1 이 무의미해지고, 까닭 말이 결과를 바꾸지 않은 지시에도 붙는다. 비용은 같은 반복 안의 두 번째 최댓값뿐이다. 대원의 자체 판단은 비교할 1등이 없어 세지 않는다(2.7).
- 무거운 시험·sweep 은 돌리지 않았다(이번 작업의 조건). 그래서 `npm run check` 에 더해질 시간은 숫자로 적지 않고, 0단계에서 재어 강제 교대 수를 정하는 규칙으로 적었다(9절).
- **사용자 결정(2026-11-15): "가벼운 일은 계속"** — H1 이 걸을 수 있는 다친 대원(`injured`)에게 가벼운 일만 맡기게 정하면서, 가벼운 일 목록의 정본을 H1 의 `LIGHT_WORK`(`traffic`·`perimeter`·`negotiate`·`interview`·`hookup`, 안전 구역의 `treat`·`treatMate`) 하나로 맞췄다. 부상 줄 P12·F14·E11·G01 의 가산 목록을 그 이름으로 바꿨다 — 그래서 F14·G01 의 `clearRoad`, G01·E11 의 `load` 는 가산에서 빠지고(몸을 쓰는 일), G01 에 `negotiate`·안전 구역의 처치가 더해졌다. 분야별 감산(`×0.35`·`×0.6`·`×0.5`)은 그대로다. 고친 곳: 0절 3, 1절 연관 표의 H1 줄, 2.4 의 `crew` 사실 문단, 3.1·3.2·3.3·3.4 의 부상 줄, 3.6 등록 칸, 4.2 상태 표.

---

## 구현 메모 (진행 중 — 단계를 끝낸 작업자가 덧붙인다)

**코드가 정본이고, 이 절이 본문보다 우선한다.** 다음 작업자는 본문(0~11절)과 함께 이 절의 "실제 이름"·"본문과 다른 곳"·"이어받을 자리"를 먼저 읽는다.

### 단계 0 (틀) — 2026-11-15, 준비 실행

**상태: 구현됨, 결과 불변.** 브랜치 `wf/doctrine`(작업자 브랜치 `wf/doctrine-s0`), 시작점 `ba58645`(주 브랜치 — R1 전체 · H1 단계 0~4c · X6 단계 1(상태만) · R2 단계 0(틀) · I1-a · I1-b 단계 b0 까지 합쳐진 자리). `docs/specs/README.md` "겹쳐 돌리기"의 **준비 줄**로 했다 — 같은 기계에서 H1 단계 5·6 작업자가 결과를 바꾸는 중이라 균형 기준(`r3-base*.json`)은 재지 않았고 **해시 목록만** 시작점에서 만들어 견줬다. 그래서 다음 작업자(1단계)는 맨 먼저 주 브랜치를 받아(`git merge --no-edit <주 브랜치>`) 충돌을 풀고, 그 위에서 8.3 의 0단계 기준(`r3-base.json`·`r3-base-{easy,hard,extreme}.json`)을 잰다.

| 커밋 | 내용 |
|---|---|
| `3f43de1` | 자료형(`types.ts` 끝의 R3 블록), `gear.ts` 판단용 감싼 함수, `field/doctrine/registry.ts`·`field/doctrine.ts`(엔진), 빈 줄 파일 다섯·`doctrine/index.ts`·빈 `orders/doctrine.ts`, `doctrineRun.ts`(`recordDoc`·`docBegin`), 걸리는 자리(`fitFor` 끝 · `brain` 넷 · `chooseMethod` 배율 · `methodFit` · `methodRun` 세 곳 · 실행기 `arrest` 의 판단 지점), 생성 리터럴, `scenes/index.ts` 두 줄 |
| `2818efd` | `sweep --doctrine`(`scripts/doctrinestats.ts`), 대원 정보창의 교본 칸(`ui/DoctrineRows.tsx`), `tests/doctrine.test.ts` 18개(시험 1·5·8) |
| 그다음 커밋 | 이 메모 |

#### 실제 이름 (단계 0 에 생긴 것)

| 이름 | 어디 | 서명·뜻 |
|---|---|---|
| `DocDept`·`DocHook`·`DocActId`·`DocGateId`·`DocWhy`·`CrewBelief`·`DocUse` | `types.ts` 끝의 R3 블록(I1-b 블록 다음) | 본문 §2.1 그대로 |
| 선택 칸: `KitItem.mag` · `FieldAgent.buddy`·`doc`·`docMem`·`shaken`·`shakenOff`·`reloadUntil`·`crewSig` · `Task.docRule`·`gateAt`·`gateId`·`gateSaid`·`cvX`·`cvY`·`cvTx`·`cvTy`·`cvLost` · `Unit.ammoBox`·`ammoBoxMax`·`sparePump` · `Scene.triageAt`·`laneShield` · `Incident.docs`·`trackBy`·`reportedPrev`·`reportedNodeAt` · `ShiftReport.doctrine`·`docSplit` | `types.ts` 의 R3 블록(인터페이스 합치기) | 생성 리터럴: `makeAgent`(`buddy: -1, doc: null`, 나머지 `undefined`) · `makeTask`(`gateAt: -1, gateSaid: false, cvLost: -1`, 나머지 `undefined`) · `resources` 두 부대 리터럴(셋 다 `undefined`) · `baseScene`(`triageAt: -1, laneShield: null`) · `createIncident`(넷 다 `undefined`). `KitItem.mag` 는 리터럴에 넣지 않았다(2단계가 총기에만 채운다) |
| `kitHas(sim, rid, id)` · `kitQty(sim, rid, id)` · `gunOf(sim, rid)` · `roleIdOf(sim, rid)` · `groupOf(sim, rid)` · `crewHas(sim, u, id)` | `field/gear.ts` 끝의 "판단용 (R3)" 절 | `gunOf` → `{ id, ammo, mag, magSize, perShot, reload } \| null`(sniper > rifle > pistol, 알려진 고장 제외). **탄을 세지 않는 동안(2단계 전)은 `ammo = mag = magSize = Infinity`, `perShot 1`, `reload 0`** — `KitDef` 의 `mag`·`reload`·`perShot` 은 아직 없어 `GunDef = KitDef & {…}` 로 읽는다. `roleIdOf` 는 역할이 없는 명부에 R1 `roleOf` 의 부서별 기본 역할을 돌려준다 |
| `DocState`·`DocThreat`·`DocSit`·`DocPhase`·`DocCtx`·`DocEffect`·`DoctrineRule`·`DOCTRINE`·`registerDoctrine`·`CMD_ROWS`·`DOC_DEPTS_DONE`(빈 배열)·`DocGateAns`·`DocPick`·`DocFitAns`·`ruleName(id)` | `field/doctrine/registry.ts` (잎 — 타입만 import) | `DocCtx` 에 칸 하나를 더했다: `see?: { stunned?: boolean }`(판단 지점의 `see` — 아래 "본문과 다른 곳") |
| `ZERO_SENSE` · `DOC`(문턱 상수 표) · `DOC_DUTY_TASKS` · `PAIRS` · `SOLO_OK` · `docDeptOf` · `bandHyst(hp, prev)` · `crewSigOf(v)` · `sigBand(sig)` · `regionOfWork(s, a, w)` · `hazWork(sim, s, a, w)` · `buddyOf(sim, s, a, w = null)` · `outsideWatch(sim, s, a, ex: Pt)` · `watchNeed(sim, s)` · `stateSelf` · `stateReported` · `phaseOf(sim, s, a)` · `docSit(sim, s, a)` · `docCtx(sim, s, a, mode, w = null, sense = ZERO_SENSE, dng = 0)` · `docForget(a?)` · `hasDoc(hook)` · `applies(c, r)` · `docTarget(c)` · `docFitRules` · `docFit` · `docDrop(sim, s, a)` · `docDuty(sim, s, a, sense?, dng?)` · `docAct(…)` · `docRetreat(sim, s, a, dng, sense?)` · `docMethodMul(dc, m)` · `docGate(sim, s, a, gate, sense?, see?)` · `coverTileAt` · `coverSpot` | `field/doctrine.ts` | 값 import 는 `types`(T)·`util`·`gear`·`grid`·`injury`(`bandOf`)·`doctrine/registry` 뿐(시험 1). **줄이 없으면 모든 자리가 첫 줄에서 돌아간다**(`DOCTRINE.length === 0` — 상태를 만들지도 않는다). 상태·상황은 `WeakMap<FieldAgent, {tick, self, rep, sit}>` 에 틱마다 모드별로 담는다(`docForget` 이 버린다 — 같은 틱에 대원 상태를 손으로 바꾸는 시험용). 줄 목록은 `(자리, 일)` 별 `Map` 이고 `DOCTRINE.length` 가 바뀌면 다시 만든다 |
| `recordDoc(sim, I, a \| null, rule, hook, extra = {}, eventId = -1, say = false)` · `docBegin(sim, s, a, pick, k)` · `DOC_MERGE`(30) | `field/doctrineRun.ts` | `recordDoc` 는 같은 (rule, rid, tgt) 의 줄이 30초 안이면(`sim.t − d.t1 ≤ 30`) `t1` 을 늘린다. `docBegin` 은 아래 |
| `doctrineStats` · `sumDoctrine` · `doctrineJson` · `doctrineTables` · `SPLIT_MIN`(10) | `scripts/doctrinestats.ts` | `sweep --doctrine`: 글자 줄은 모두 `doctrine:` 으로 시작. `--json` 의 `doctrine` 칸은 **`--doctrine` 을 붙였을 때만** 넣는다(그 밖의 JSON 은 한 글자도 그대로) |
| `DoctrineRows({ sim, scene, agent })` | `ui/DoctrineRows.tsx` · `panels.tsx` 의 `AgentPanel`(R2 `MethodRows` 바로 다음 한 줄 + import 한 줄) | 따르는 줄(`a.doc` / `task.docRule`, 판단 지점이면 `gateAt` 부터 몇 초째) · 그 대원의 최근 `I.docs` 셋. 적힌 것이 없으면 `null`(자리를 차지하지 않는다). 상태 칩은 1단계 |

#### 걸리는 자리 (단계 0 의 호출 — 줄이 없어 모두 그대로)

| 자리 | 파일·함수 | 단계 0 의 모양 |
|---|---|---|
| ① fit | `agents.fitFor` | `return docFit(sim, s, a, w, <R1 역할 선호까지 더한 값>)` 한 줄. `docFit` 은 `fit ≤ 0` · `docMem 'w:'` · 줄 없음 순서로 돌아간다 |
| ② 의무·놓기 | `brain.think` — 부상 후퇴 붙잡기(`hurt && retreat`) 바로 다음, 점수 후보 앞 | `dSense = senseOf(s, a)` → `if (cur && DOC_DUTY_TASKS.has(cur.kind)) return;` → `docDuty` 가 있으면 `docBegin(…, XK)` 후 `return` → `docDrop` 이 있으면 `finishTask(…, false, 'doctrine')` + `recordDoc(…, 'fit')` 후 `return` |
| ② 후퇴 바꿔 끼우기 | `brain.think` 의 1) 위험 회피 | `swapR = docRetreat(…)` 가 있으면 그 후보(라벨 `교본 · {short}`, 점수 `pick.score`), 없으면 **`else if`** 로 원래 후퇴 후보 |
| ② 행동 후보 | `brain.think` — R1 공기통 교체 후보 다음, 5) 휴식 앞 | `swapping` 이 아니면 `docAct(…, dSense, dng)` — 있으면 후보 하나(`교본 · {short}`) |
| ③ 방법 | `methods.ts` `rank` · `methodFit` · `methodRun` 의 `startMethod`·`recheckOnArrive`·`switchMethod` | `rank`: `dc` 가 있으면 `{ ...dc, m: { reach, flow, weak, tile } }` 사본 하나로 점수 × `docMethodMul`. `methodFit`: `hasDoc('method') ? docCtx(…, 'report', w) : null`. `methodRun` 세 곳: `selfDc(sim, s, a, t)`(자기 모드, `hasDoc('method')` 일 때만) |
| ④ 판단 지점 | 실행기 `case 'arrest'` — R1 테이저 바로 다음, `moveTo` 앞 | `if (!docGate(sim, s, a, 'closeIn').ok) return;` 한 줄 (막히면 이 틱은 서 있는다 — 2단계가 기다리는 자리·상한·기록으로 바꾼다) |
| 등록 | `field/scenes/index.ts` 끝 | `import '../doctrine/index';` `import '../orders/doctrine';` |

`agents.ts`·`executor.ts`·`brain.ts` 의 새 import 는 R2 처럼 **파일 끝**에 두었다(위의 import 묶음을 다른 묶음이 함께 고치고 있어서 — 충돌을 줄이려고). `gear.ts` 의 `crews` 추가 import 도 파일 끝의 R3 절에 있다.

#### 본문과 다르게 한 곳

1. **`doctrineRun.ts` 에 `docBegin` 하나를 더 두었다**(본문 §9 는 "`recordDoc` 만"). `brain` 의 세 자리가 고른 교본 행동을 받을 곳이 있어야 걸리는 자리가 완결되기 때문이다: 하던 임무를 `preempt` 로 놓고, `k.makeTask(pick.act as string as TaskKind, short)` 로 임무를 열고(`t.docRule`), `a.doc` 을 적고, `recordDoc`. **기록 문구(emit — 줄의 `note`, 20초에 한 번)·새 임무의 실행 case·계속 점수는 넣지 않았다** — 그 행동을 쓰는 단계(2 `cover`·`rearm`, 3 `airOut`·`pairOut`·`pair`)가 `TaskKind` 에 이름을 더하면서 캐스트를 지우고 채운다. 단계 0 에는 줄이 없어 불리지 않는다.
2. **`gear.ts` 의 함수는 여섯**(`kitHas`·`kitQty`·`gunOf`·`roleIdOf`·`groupOf`·`crewHas`) — 본문 §2.4 표의 다섯 줄(그중 한 줄이 둘)과 같다.
3. **`DocCtx.see`** 를 더했다. 본문 §2.5 는 `docGate(…, see?)` 와 P01 의 `!see.stunned` 를 말하지만 `DocCtx` 에 그 칸이 없었다 — `docGate` 가 만든 입력에만 채운다.
4. **판단 지점은 `arrest` 의 `closeIn` 한 곳만** 걸었다. 나머지(`engage` 의 `roomEntry`·`breach`·`bangUse`·`coverFire`·인질 갈래의 `closeIn`, `interiorEntry`, `carryHold`·`carryStart`, `laneTreat`)는 막혔을 때의 기다림·상한·기록이 그 단계의 내용이라 그 단계가 건다(11.1 표의 단계 열).
5. **§3.7 끝의 "진압의 외부 방어 조각(R3 0단계에 `methods.ts` 에 더한다)"은 하지 않았다.** R2 단계 0 의 `defensive` 는 `can: NOT_YET` 이라, 거기에 "또는 `docMethodMul(c.dc, 'interior') === 0`" 을 붙이면 실행부가 생기기 전에 외부 방어가 고를 수 있는 방법이 된다(3단계의 F03b·F04b·F05b 가 들어오는 순간). 이어받을 자리에 적었다.
6. **`--json` 의 `doctrine` 칸은 `--doctrine` 일 때만** 넣는다(§8.3 은 조건 없이 적었다) — 다른 자동화가 읽는 기본 JSON 을 바꾸지 않으려고.
7. **0단계 해시 비교를 S0~S9 보다 넓혔다**: 보통 40 + 어려움 20 + 극한 20 + 재난 다섯 × 3 + `--force` 일곱(`fire/std`·`armed/hostage`·`armed/dispute`·`armed/bomb`·`traffic/bus`·`hazmat/std`·`collapse/gasblast`) × S0~S3 = **123교대**, 교대마다 `report.hash`·`JSON.stringify(report)` 의 FNV·`sim.logHash`. 시험 5 의 "0단계 커밋은 S0~S9 의 해시가 같다"는 이것으로 대신했다(그 시험은 본문대로 손으로만 돌리는 것이라 파일에 넣지 않았다).
8. **`DOC_OF_UNIT`**: 역할 표(§2.2)에 없는 내리지 않는 자리(조종사·부기장·정장)는 부대 종류로 분야를 정한다(경찰 헬기 → 경찰, 의료 헬기 → 의료, 소방 헬기·구조정 → 특수). 교본이 걸리지 않는 자리라 결과와 무관하다.
9. **`phaseOf` 의 `entry`/`assault`**: "출입구 앞 / 출입구를 지난 뒤"를 "선 칸의 구역이 실내가 아니다 / 실내다"로 정했다(출입구 거리보다 흔들리지 않는다). 위험 실내가 아닌 곳의 수색·진압 등은 `idle`. `split` 열쇠에만 쓰인다.

#### 이어받을 자리 (다음 단계가 할 것)

- **X6 의 이름이 아직 없다**: `brain` 에 `evacuate` 의무가 없고 `orders/catastrophe.ts`(`DANGER_RULES`)도 없다(X6 는 단계 1 — 상태만). 그래서 R3 의 의무 자리는 부상 후퇴 붙잡기 바로 다음에 있다 — X6 단계 2 가 철수 의무를 넣을 때 **R3 블록 앞**에 넣는다(§2.6 의 3번 → 4번 순서). `docSit.danger`·`wDanger` 는 믿음 `ops` 사실(id 0)의 `zones[].regions/level` 을 읽게 해 두었다 — X6 가 정한 `ops` 사실의 실제 값 모양이 다르면 `doctrine.ts` 의 `opsLevel` 하나를 고친다. CF5·CF6(3단계)은 X6 의 `DANGER_RULES` 가 생긴 뒤에.
- **H1**: `bandOf`·`hurtF`·`LIGHT_WORK`·`mustRetreat` 는 있다(`field/injury.ts`). 엔진은 `bandOf` 만 쓴다. H1 단계 5·6 의 이름은 부르지 않았다.
- **R2**: `defensive` 의 `can` 을 채우는 단계(R2 단계 4)가 "또는 `c.dc !== null && docMethodMul(c.dc, 'interior') === 0`" 과, 몸 상태 조건 `r.health < 50` 대신 `c.dc.st.band ≥ 1` 을 함께 넣는다(§3.7 끝). R2 §4.1 의 "상공 호이스트 swim ×0.7" 은 R3 5단계(S15)가 지운다.
- **1단계**: `FactType` 에 `'crew'` 를 더하면 `doctrine.ts` 의 `CREW_FACT = 'crew' as string as FactType` 을 `'crew'` 로 바꾼다. `selfReport` 는 `brain.think` 의 `perceive` 다음·`flushOutbox` 앞(지금 그 자리에는 아무것도 없다), 서명은 `crewSigOf`·`sigBand` 를 쓴다. `docSplit` 표본(`setTask`·`takeWork`·의무 자리)·`buildReport` 의 `doctrine`·`docSplit`·요약 줄, `assign` 의 1등 비교(`docFitRules` 가 `base`·`hits` 를 돌려준다), 패널의 상태 칩. 시험 5 의 **"단계 0: 줄이 없어 …" 묶음**(교본 기록·상태 칸이 비어 있다, `hasDoc` 이 모두 거짓)과 "줄이 없으면 걸리는 자리가 그대로" 묶음은 줄이 생기는 단계가 자기 단계에 맞게 고친다 — 그대로 두면 깨진다.
- **2단계**: `finishTask` 사유 표에 `'doctrine'`·`'handover'`(brain 의 `docDrop` 자리가 이미 `'doctrine'` 을 넘긴다 — 표가 없으면 '중단 — doctrine. 재지시 요청.' 무전과 `w.fails++` 가 난다), `docBegin` 의 캐스트 지우기와 기록 문구, `arrest` 의 판단 지점 줄을 기다리는 자리(1.8·3칸)·`t.gateAt`·`gateSaid`·상한·timeout 갈래로, `Tuning.ammoBox`·`KitDef.mag/reload/perShot`(그러면 `gear.ts` 의 `GunDef` 를 지운다), `DOC_DEPTS_DONE` 에 `'police'`, `dispatch/doctrine.ts`(생기면 시험 1 이 저절로 검사한다), `CommandKit.request` 의 기록 id.
- **3단계**: `pairUp`(`sceneManager.unitArrived` 의 반복 뒤 — `PAIRS` 의 `std`/`min`, 최소 인원은 `u.crew.length === minCrew(u.kind)`), `rebuddy`(brain 의 `flushOutbox` 다음), `buddyOf`·`outsideWatch`·`watchNeed` 는 이미 있다.
- **패널**: 단계 0 에는 늘 비어 있다(개발 서버 5219 에서 `?seed=S7&force=armed/hostage` 를 열어 대원 여섯의 정보창을 띄움 — 콘솔 오류 0, "대응 교본" 칸 없음).

#### 수치 (단계 0)

- **해시 목록 diff 0**: 시작점 `ba58645` 와 이 단계 끝에서 위 123교대의 `report.hash`·`FNV(JSON.stringify(report))`·`logHash` 가 한 글자도 다르지 않다(목록은 scratchpad 의 `wf-doctrine/base-hashes.txt`·`after-hashes.txt`). 교본 후보를 하나도 더하지 않으므로 `a.rng` 소비가 같다.
- **시험**: `tests/doctrine.test.ts` 18개 — 시험 1(6) · 5(9 — 재현성: 보통·`fire/std`·`armed/hostage` 를 두 번씩, 순수 함수: 시험용 줄 여덟(G91~G98)을 잠깐 등록해 엔진의 모든 갈래를 백 번 부르고 상태(장비·명부·난수 흐름 다음 값·기록·작업판·무전)가 그대로인지, 그리고 곱하기·더하기·금지·막기·고르기의 규칙) · 8(3 — 검사 함수가 틀린 줄 열세 가지를 실제로 잡는지도). 단독 실행 8.4초(가져오기 6초 · 시험 2.2초).
- **교대 하나의 시간**(§9 끝, `time npx vitest run tests/sim.test.ts -t 재현성` — 부하 평균 9.8): 26.5초 중 시험 5.7초 / 교대 10개 ≈ **교대당 0.6초**. 강제 교대를 따로 재면(교대당 벽시계 · 사용자 CPU) `fire/std` 0.77 · 1.37초, `armed/hostage` 0.52 · 0.81초, 최소 인원 `fire/std` 0.61 · 0.96초, `armed/dispute` 0.55 · 0.79초, `armed/hostage` 0.37 · 0.55초. 시험 4(강제 12교대) + 시험 6(최소 인원 18교대)을 더하면 ≈ 17초로 60초 아래다 — **6교대 그대로 둔다**(3교대로 줄이지 않는다).
- **`npm run check` 통과**(`2818efd` 의 코드): 시험 파일 16 · 477개 통과 + 건너뜀 1(시작점 459 + 이 단계 18). 벽시계 7분 31초(vitest 422초 · 사용자 CPU 15분 26초) — 같은 기계에서 다른 묶음의 작업자가 함께 돌아 부하 평균이 8~14 였다. 이 단계가 관문에 더하는 몫은 `tests/doctrine.test.ts` 하나(단독 8.4초, 그중 시험 2.2초)뿐이다. `sweep 40 --check`: 성공 79% · 부분 10% · 지연 5% · 미해결 2% · 실패 5%, 닫힌 까닭 `resolved 565 · abandoned 2` — 해시가 같으므로 시작점과 같은 분포다.
- **화면**: 개발 서버(5219)에서 대원 정보창을 여섯 번 띄움 — 콘솔 오류 0, 교본 칸은 그려지지 않는다(단계 0).

### 단계 1 (공통) — 2026-11-16

**상태: 구현됨, 결과 바뀜(의도 — 교본 줄이 생겼다).** 작업자 브랜치 `wf/doctrine-s1`, 시작점 `97869b1`(주 브랜치 — R1·H1·X6·R2 전부, R3 단계 0, I1-a·I1-b b0, I2 1·2·3, N8 1·2a·2b, N9 1·2·3). 시작할 때 주 브랜치를 받았다(이미 같았다 — 충돌 없음).

**0단계 기준(§8.3)을 이 시작점에서 처음 쟀다** — scratchpad `wf-doctrine/base97/`: `r3-base.json`·`r3-base.txt`(보통 60 `--scen --methods --doctrine`), `r3-base-{easy,hard,extreme}.json`(60), 강제 묶음 20교대씩 `f-<유형>_<변형>.txt`(2단계 경찰 일곱 · 3단계 소방 다섯 · 4단계 의료 넷 · 5단계 `armed/bomb`·`armed/package`, `--scen --methods --doctrine`), `d-tsunami.txt`, `min-crew.txt`(`--diff 3,3,3,3,3,1`), `poor-kit.txt`(`--diff 3,3,3,1,3,3`). 다시 재는 대본은 `wf-doctrine/runbase.sh <저장소 뿌리> <출력 폴더>`, 견주는 대본은 `wf-doctrine/cmp.cjs <기준 폴더> <뒤 폴더>`, 교대당 시간은 `wf-doctrine/timing.sh <뒤 폴더>`(기준 `b0` 와 번갈아 세 번). 시작점 소스는 `wf-doctrine/b0.tar`·`b0/`, 단계 1 의 결과는 `after1/`. scratchpad 가 비었으면 `97869b1` 을 `git archive` 로 풀어 같은 대본으로 다시 잰다.

| 커밋 | 내용 |
|---|---|
| `631a534` | 단계 1 의 코드와 시험 전부 (아래) |
| 그다음 커밋 | 이 메모 |

#### 실제 이름 (단계 1 에 생긴 것)

| 이름 | 어디 | 서명·뜻 |
|---|---|---|
| `FactType 'crew'` · `MethodWhy` 여섯(`hurt`·`alone`·`lowAir`·`lowAmmo`·`shaken`·`tired`) | `types.ts` (각 합집합 끝의 새 줄) | 본문 §2.1 |
| `DocCtx.hz`·`wRisky`·`light` | `doctrine/registry.ts` | 줄 파일은 `injury`·엔진을 import 할 수 없어서, 엔진이 `w` 마다 채운다: `hz` = 위험 실내 일(엔진의 `hazWork`), `wRisky` = 대상 구역이 위험 건물 실내(종류 무관 — G01 의 위험 구역 동료 구조), `light` = H1 `LIGHT_WORK`(처치·동료 처치는 대상이 안전 구역일 때만 — `fitBase` 의 다친 대원 규칙과 같은 판정). `w` 가 없으면 모두 false |
| `reported(b)` · `WHY_METHOD` · `docMethodWhy(dc, top, plain)` | `field/doctrine.ts` | `reported` 를 내보냈다(시험이 쓴다). `docMethodWhy`: 교본 전후 1등이 다를 때 그 둘에 배율(≠ 1)을 준 줄 가운데 rank 가 가장 작은 줄, 없으면 두 방법에 걸린 기록 전용 줄(배율 1 — G02b) → `{ rule, why: MethodWhy, missing }` (§3.7 사상 표). `opsLevel(s, a, rg, ti)` 는 구획 구역(`regionLevel`)과 칸(`zoneLevelAt` — 원 구역)을 함께 본다(X6 검토가 넘긴 것) — 작업의 칸은 `tileOfWork` |
| `CREW_TEXT` · `crewNow(sim, a)` · `selfReport(sim, s, a)` · `crewAlert(text)` | `field/doctrineRun.ts` | 아래 "자기 신고" |
| `SHAKE`(`base 20 · top 1.3 · immune 10 · mateR 6 · blastPad 3`) · `shake(sim, a)` | 같은 파일 | 동요. 부르는 곳 셋: `hazards.tickHostiles` 의 `underFireT` 줄(총격 — 맞든 빗나가든)과 흉기·맨손 피습 줄, `agents.perceive` 의 쓰러진 동료(6칸 안, 그 동료를 'down' 으로 처음 알 때), `hazards.blast`(반경 + 3칸, 다치기 전에) |
| `docRemember(sim, a, rule, key, sec)` | 같은 파일 | 교본 기억의 두 뜻(`'w:<작업 id>'` = 그 작업 `fit` 0 / 대상 열쇠·`'*'` = 그 행동 줄을 그 대상에 다시 걸지 않는다). 지난 기억을 지우고, 같은 (줄, 열쇠)면 늦은 쪽으로 늘린다. 단계 1 에는 부르는 줄이 없다(쓰는 단계가 2·3) |
| `WHY_WORD` · `docAssignWhy(pickAns)` · `docAssignRecord(sim, I, pick, pickAns, base, baseAns, w, ev)` | 같은 파일 | 배정의 1등 비교(§2.7) — 아래 |
| `splitBegin(sim, s, a, replaced?)` · `splitSettle(sim, a)` · `docSplitOf(sim)` | 같은 파일 | split 의 표본(§8.2) — 아래 |
| `fitParts(sim, s, a, w): DocFitAns` | `field/agents.ts` (`fitFor` 바로 다음) | `fit` 은 늘 `fitFor(sim, s, a, w)` 와 같다 + 교본 전의 값(`base`) + 걸린 줄(`hits`) |
| `assign` 내보냄 | `field/commander.ts` | 시험 2-e 가 직접 부른다 (이름·몸은 그대로) |
| `docLines(sim, I, s, max = 2)` · `docTally(sim)` · `docSummary(tally)` · `fillDoc` · `docNum` · `WHY_DOC` | **새 파일 `field/doctrineReport.ts`** | 보고서 문장·집계 (R2 의 `methodReport.ts` 와 같은 나눔 — `debrief.ts` 에는 부르는 줄만) |
| `MethodPick.doc`·`skip` · `SHAKEN_CAUTION`(0.2) | `field/methods.ts` | 교본이 1등을 바꿨으면 그 줄 id 와 교본이 없었다면 골랐을 방법 |
| `StatusChips` (안쪽) · `DoctrineRows({ …, truth })` | `ui/DoctrineRows.tsx` · `panels.tsx` 의 `truth={truth}` · `styles.css` 끝 `/* ── R3 doctrine ── */` | 상태 칩 한 줄 — 아래 |

#### 등록한 줄 (공통 다섯 — `doctrine/common.ts`, 등록 순서 그대로)

| id | 자리 | who | works | when | effect | rank | why |
|---|---|---|---|---|---|---|---|
| G01 | fit | doc special | 무거운 일 아홉 + 가벼운 일 일곱 | `st.band ≥ 1` | mul .35 [engage·waterRescue·`c.hz`·(rescueMate && `c.wRisky`)] · add .15 [`c.light`] | 1 | hurt (short '가벼운 임무') |
| G02 | fit | — | engage + HZ 여섯 | `st.shaken` && (engage ? `entryOrdered` : `c.hz`) | mul .6 | 1 | shaken |
| G02b | method | — | methods `swim`·`boat`·`charge`·`rapid`·`tunnel`·`dive` | `st.shaken` | 기록 전용 mul 1 (조심성 +0.2 는 `methods.makeCtx`) | 1 | shaken |
| G03 | fit | — | HZ 여섯 | `c.hz` && `stamina < 30` && 새로 맡는 일 | mul 0 | 1 | tired |
| G04 | fit | — | rescueMate | `w.mate === a.buddy` (`≥ 0`) | add .2 | 2 | buddy |

`DOC_DEPTS_DONE` 은 그대로 빈 배열이다(공통은 시험 8 의 "12줄"에서 빠지고, 분야는 2단계부터 더한다).

#### 걸리는 자리 (단계 1)

- **자기 신고**(§4.1): `brain.think` 의 `perceive` 다음·`shareNearby` 앞에 `selfReport`. 서명(`crewSigOf`)이 지난 신고와 다를 때만 'crew' 사실을 자기 믿음에 넣는다. 나빠진 것만 글이 있고 무전 문구에 실린다 — 공기 위급 '공기 30% 미만.'·탄 위급 '탄약 소진.'·중상 '부상 — 체력 저하.'(이 셋은 `agents.hot` 이 `crewAlert` 로 알아보아 바로·중요로), 공기 낮음 '공기 50% 미만.'·마지막 탄창 '탄약 마지막 탄창.'(묶음 보고). 나아진 것·동요·위중(0·1 → 2)은 `learnQuiet` 로 무전 문구 없이 믿음·무전 자료로만 간다(믿음 속 글은 '상태 보고: 몸 중상 · 공기 낮음 …' — 정보창의 '알고 있는 정보'에만 보인다). 처음 판단이고 멀쩡하면(`'0000'`) 알리지 않는다. `significant` 에 'crew' 갈래. 동요가 끝나면 `selfReport` 가 `a.shaken` 을 비우고 `a.shakenOff` 에 끝난 시각을 적는다.
- **fit**: G01~G04 가 `docFit` 으로 걸린다(늘 보고 모드 — 몸은 'crew' 신고, 지구력은 조직 정보). `commander.assign` 의 후보 반복이 `fitFor` 대신 `fitParts` 를 불러 교본을 넣은 점수의 1등(`best`)과 교본 전의 값으로 센 1등(`baseBest` — 같은 거리·지구력·경험·하던 일 항, 같은 `taken`)을 함께 센다. 다르면 `docAssignWhy` 가 뽑힌 대원의 중립 아닌 줄 가운데 rank 가 가장 작은 줄로 까닭 말을 만들어 지시 무전 끝에 붙이고("김도윤, 출입구 봉쇄 맡아라 (부상 — 가벼운 임무)." — 줄의 short 가 까닭 낱말로 시작하면 short 만: "(지침 — 진입 제외)"), `docAssignRecord` 가 뽑힌 대원의 중립 아닌 줄과 밀려난 대원의 금지·감점 줄(배율 < 1)을 `hook 'fit'`·`tgt 'w:<작업 id>'`·`eventId = 그 지시` 로 남긴다. 아무도 뽑히지 않았으면(모두 금지) 밀려난 쪽만 `eventId -1` 로. 같으면 아무것도 남기지 않는다. 지휘관이 자기에게 맡긴 것은 `eventId -1`.
- **method**: `methods.makeCtx` 의 조심성에 동요 +0.2(상한 1.1 — G02b). `chooseMethod` 가 교본 배율이 1 이 아닌 후보가 있었거나 동요 중이면(`rankDocHit`·`dc.st.shaken` — 아니면 다시 세지 않는다) 교본 전(배율 1·조심성 원래 값)의 1등을 다시 세어, 다르면 `docMethodWhy` 의 까닭으로 돌려준다(noGear 앞). 실행부(`startMethod`·`recheckOnArrive`·`switchMethod`)가 `pick.doc` 이면 `recordDoc(…, 'method', { method, work, tgt })` — 시작 문구의 기록 id 와 함께. 시작 문구는 "손이 떨려 헤엄은 못 합니다. 하류에서 기다렸다 붙잡겠습니다."(`skip` 이 없으면 "…방법을 바꿉니다."), 평소 방법(plain)은 R2 대로 알리지 않는다. `whyNote`·`methodReport.whyText` 에 여섯.
- **R2 외부 방어의 몸 상태 조건**(§3.7 끝 — 단계 0 이 남긴 것): `r.health < 50` → `bandOfCtx(c) ≥ 1`(교본 입력이 있으면 그 상태 — 자기 모드 자기 몸·보고 모드 신고, 없으면 실행부(`t` 가 있을 때)는 같은 간격으로 자기 몸, 배정은 0). 배연 뒤의 예정된 전환(`ventilate → interior`)은 `methodStillFits`(교본 배율을 보지 않는다)라 3단계(F03b·F04b·F05b 가 실내 진압을 뺄 때)가 고친다.
- **보고서**: `debrief.evaluate` 끝(R2 방법 문장 다음) `docLines(…, min(2, 3 − 방법 문장 수))`(A < 12 일 때), `buildReport` 의 `doctrine`(= `docTally`)·`docSplit`(= `docSplitOf`)·요약 줄 '교본: …'(`docSummary` — 줄의 short, 많은 순 다섯). 단계 1 의 줄은 `report` 템플릿이 없어 사건 문장은 아직 나오지 않는다(시험이 시험용 줄로 문장을 본다).
- **split 표본**: `brain` 의 `takeWork`·`setTask` 끝과 `docBegin`(대신한 작업판 일을 열쇠로)에서 `splitBegin` — 열쇠 `분야|국면|임무`. 고른 것은 그 대원의 **다음 판단 첫머리**(`splitSettle` — `think` 의 첫 줄)에 그 임무에 적힌 값으로 적는다: 판단 지점에서 막혀 있으면 줄 번호, 교본 행동이면 그 행동, 방법이 있으면 방법, 아니면 'none'.
- **패널**: '대응 교본' 칸이 현장 대원이면 늘 나온다(상태 칩). 칩: 공기(공기호흡기를 들었을 때 — 막대에 30·50% 눈금, 50% 아래 노랑·30% 아래 주황), 탄(탄을 세는 총이 있을 때 — 2단계부터), 짝(이름·거리 / '짝 없음' — 3단계 전에는 늘 '짝 없음'), 몸(중증도 색), 동요(동요 중일 때만). 시점: 관찰자(`truth`)는 진실(몸 = `respBand`, 동요 = `a.shaken`), AI 시점은 지휘관 믿음 속 그 대원의 'crew' 신고(지휘관이 없거나 그 대원이 지휘관이면 자기 신고). 공기·탄은 장비 수량(조직 정보)이라 같다.

#### 본문과 다르게 한 곳

1. **중요 신고의 무전 `imp` 는 1** 이다(본문 §4.1 은 2). `flushOutbox` 가 바로 알리는 사실(`hot`)을 담은 무전을 늘 `imp 1` 로 남기기 때문이다(X6 의 단계 2 조짐과 같다) — 무전 함수를 고치지 않았다.
2. **위중(→ band 2)은 글 없이**: 중상(0 → 1)만 '부상 — 체력 저하.' 를 말한다. 체력 40 아래·출혈은 H1 의 부상 후퇴("부상으로 더 이상 임무 수행 불가…")와 'mate' 사실이 이미 알린다(CLAUDE.md 함정 "로그 중복").
3. **글 없는 신고도 믿음 속 글이 있다**('상태 보고: …' — `learnQuiet` 라 무전 문구에는 실리지 않는다). 본문은 `text: ''`. 그래서 '중요'의 판정은 글이 비었는가가 아니라 `crewAlert`(나빠짐의 세 글)로 한다.
4. **처음 판단의 멀쩡한 상태는 신고하지 않는다**(도착마다 빈 무전이 나가지 않게). 걸을 수 있는 다친 대원은 현장마다 새 현장 대원이라 그 현장의 첫 판단에 '부상 — 체력 저하.' 를 한 번 말한다.
5. **G01 은 특수 표 대원에게만**(`who.doc: ['special']` — 본문대로). 그래서 시험 2-e 는 경찰 둘이 아니라 **특공 대원 둘(역할·능력·장비·자리를 똑같이 맞춘 쌍둥이)** 로 했다 — 경찰의 P12 가 들어오는 2단계가 경찰판을 더한다.
6. **G02b 의 `methods`** 를 위험(risk > 0)이 있는 방법 여섯으로 적었다(본문 §3.6 은 '—'). 시험 8 이 method 줄에 방법 목록을 요구한다.
7. **split 의 고른 것은 다음 판단에서 적는다**(본문: 시작한 틱의 `startMethod` 값). 첫 틱에 고르는 방법은 같고, 그 사이에 방법을 바꾼 드문 경우만 다르다. 도착해서 고르는 방법(처치의 현장 안정 등)은 둘 다 'none' 이다.
8. **`docLines`·`docTally`·`docSummary` 는 새 파일 `field/doctrineReport.ts`** (본문 §11.1 은 `debrief.ts`). R2 의 `methodReport.ts` 와 같은 까닭.
9. **`assign` 을 내보냈다** — 시험 2-e 가 지휘관 배정을 직접 부른다. `commanderThink` 를 거치면 `syncBoard` 가 시험의 작업판을 바꾼다.
10. **`docForget()`(인자 없이)는 줄 목록 색인도 버린다** — 시험이 줄을 바꿔 끼울 때 색인이 줄 수로만 낡음을 알았다(같은 수면 낡은 색인을 썼다). 시험의 `withRules` 는 이제 등록된 줄을 빼 두고 시험용 줄만 넣는다(끝나면 되돌린다).
11. **동요는 총격마다**(본문 §4.3 "대원 피격 줄(underFireT 를 정하는 곳)") — 그 줄은 맞든 빗나가든 정해지므로 쏜 총에 노출된 것으로 걸린다. 폭발은 R2 의 폭파 진입(`runCharge` 의 `blast`)도 포함한다 — 진입조가 동요한다(아래 알려진 문제).
12. **X6 원 구역**(가스 용기 둘레)을 `docSit.danger`·`wDanger` 에 넣었다(X6 독립 검토가 R3 로 넘긴 것 — 엔진만, 단계 1 의 줄은 읽지 않는다).

#### 설계서 밖에서 고친 공용 파일

- `field/methodRun.ts` `announce`(인자 `skip`)·`startMethod`·`recheckOnArrive`·`switchMethod`(교본이 바꾼 방법의 `recordDoc` — `docPick`) — 본문 §11.1 은 2·3단계만 적었다.
- `field/methodReport.ts` `whyText` — 본문은 `debrief.ts` 의 `WHY_TEXT` 라고 적었지만 실제 자리는 이 파일이다.
- `field/agents.ts` `fitParts`(새 함수)·import 둘, `field/commander.ts` `assign` 의 `export`.
- `field/doctrine.ts` 가 `./ops`(`OPS_ID`·`regionLevel`·`zoneLevelAt`, `OpsFact` 타입)와 `injury.LIGHT_WORK` 를 import 한다(시험 1 의 금지 목록 밖).

#### 이어받을 자리

- **2단계**: P12(경찰판 부상 줄)를 넣으면 시험 2-e 에 경찰 쌍(본문 그대로)을 더한다. `selfReport` 의 탄 칸(`crewNow` — `gunOf` 의 `ammo` 가 `Infinity` 면 0)은 `KitDef.mag/reload/perShot` 과 총기 `uses` 가 생기면 저절로 돈다(시험 5 의 "탄 칸은 늘 0" 단언 `/^[0-2][0-2]0[01]$/` 을 고친다). `docRemember` 를 엄폐·보급의 기억에 쓴다. `finishTask` 사유 표의 `'doctrine'`·`'handover'`, `docBegin` 의 캐스트·기록 문구는 단계 0 메모 그대로 남아 있다.
- **3단계**: G04 는 짝이 없어 아직 한 번도 쓰이지 않았다(`pairUp` 뒤에 쓰인다). G08 을 `common.ts` 끝에. `methodStillFits` 가 교본 배율을 보지 않으므로 배연 뒤 전환(§3.7 끝)을 그 단계에서 고친다. `bandOfCtx` 는 이미 중상 문턱이다.
- **시험 5 의 '단계 1' 묶음**(공통 다섯 줄만 있다 · 2단계 뒤의 상태 칸이 비어 있다)은 줄을 더하는 단계가 자기 뜻으로 고친다(`STAGE1` 목록·`hasDoc` 단언·`crewSig` 의 탄 칸).
- 시험이 고른 시드(G02b 의 `W1~W4` 수난 장면, 시험 7 의 `fire/std` 강제 교대 S3 부터)는 줄이 늘면 맞는 시드가 바뀔 수 있다 — 시험은 "맞는 쌍이 하나 이상", "교본이 쓰인 교대를 찾을 때까지"로 써 두었다.

#### 수치 (기준 `97869b1` → 단계 1 `631a534`, 같은 명령 — 성공+지연 = good)

| 묶음 | 기준 | 단계 1 | §8.2 |
|---|---|---|---|
| 보통 60 — 성공 · 부분 · 지연 · 미해결 · 실패 (850건) | 669 · 84 · 32 · 18 · 47 | 668 · 85 · 31 · 18 · 48 | |
| 보통 60 — 성공률 · 성공+지연 · 실패+미해결 | 78.7 · 82.5 · 7.6% | 78.6 · 82.2 · 7.8% | 성공률 ±3%p ✓ |
| 보통 60 — 한계 시간 · 방치 | 1 · 2 | 1 · 2 | + 2 이하 ✓ |
| 보통 60 — 유형별 성공 | 화재 118 · 무장 97 · 응급 95 · 교통 133 · 붕괴 51 · 가스 50 · 실종 96 · 수난 29 | 118 · 97 · 94 · 133 · 51 · 50 · 96 · 29 | 유형별 ✓ |
| 보통 60 — 다친 대원/교대 · 평균 대응 | 0.20 · 49초 | 0.217 · 49초 | (부상 목표는 2단계부터) |
| 보통 60 — 행동 엔트로피 · 방법 엔트로피 · 교착 후보 · 잊힌 사건 · 반복 최대 · 기록 일치 C1~C5 | 2.51 · 0.56 · 0 · 0 · 6 · 0 | 2.51 · 0.56 · 0 · 0 · 6 · 0 | ✓ |
| 보통 60 — 교본 | — | 쓰인 줄 G03 70 · G01 12 · G02(G02b 포함) 12 · G04 0, split 0.36(표본 10 이상 열쇠 89) | split ≥ 0.5 는 8단계 목표 |
| 쉬움 · 어려움 · 극한 60 — 성공+지연 | 88.3 · 65.6 · 43.8% | 88.3 · 65.9 · 43.1% | 순서 유지 |
| 쉬움 · 어려움 · 극한 — 한계 시간 + 방치 + 출동 없음 | 1 · 17 · 51 | 1 · 15 · 58 (극한 timeout 18 → 23) | 아래 |
| 강제 20 (스물 묶음 — `base97/f-*.txt` 와 `after1/f-*.txt`) | 예: `armed/shooter` 194 · `armed/siege` 197 · `fire/std` 211 · `armed/hostage` 220 성공 | 195 · 193 · 210 · 219, 한계 시간 + 방치는 묶음마다 ±1 | 결과 ±2건 안팎 |
| 최소 인원 20 · 장비 불량 20 (성공) | 134 · 177 | 134 · 178 | |
| 교대당 시간 (`sweep 20`, 기준과 번갈아 세 번) | 694 · 698 · 721ms, 사용자 CPU 34.0 · 35.9 · 35.3초 | 787 · 765 · 718ms, 36.5 · 38.0 · 39.4초 | 평균 1.08배(사용자 CPU 1.08배) — 1.15배 안 ✓ |

관문: `npm run check` 통과(시험 파일 19 · 805개 통과 + 건너뜀 1 — 시작점 793 + 이 단계 12, 벽시계 6분 59초, `sweep 40 --check` "검증 통과"). `npm run ui-check` 8/8 통과(130초). `tests/doctrine.test.ts` 30개(단독 7초 안팎).

**화면**: 개발 서버(5219)에서 `?seed=S7&force=fire/std`·`armed/hostage` 를 15배속으로 28초 돌린 뒤 대원 점을 눌러 정보창을 열었다 — 상태 칩이 나온다("공기 ▬ 95% · 짝 없음 · 몸 경상", 인질극에서 "… · 동요"), 콘솔 오류 0. 스크린샷 `wf-doctrine/r3-s1-chips-fire-12.png`.

#### 알려진 문제

- **극한의 한계 시간이 18 → 23**(60교대, 한계 + 방치 + 출동 없음 51 → 58 — 4.3%). 극한은 R2 가 단계마다 8 ↔ 18 을 오갔던 묶음이라 이 단계만의 까닭인지 가르지 못했다. 2단계에서 극한을 다시 볼 때 이것부터 본다(`--diff extreme --log` 로 한계 시간 사건을 읽는다).
- **폭파 진입의 진입조가 동요한다**: R2 의 `runCharge` 도 `hazards.blast` 를 부르므로 반경 + 3칸 안의 진입조가 6~26초 동요한다(G02 의 진입 ×0.6 은 새로 맡는 일만이라 진행 중인 진입은 그대로). 의도한 폭발을 빼려면 `blast` 에 인자 하나가 필요하다(I1-b 의 `noSignal` 과 같은 자리) — 5단계(S26)와 함께 정한다.
- **split 0.36**: 표본에 철수·휴식·탑승처럼 늘 'none' 인 임무가 들어 있다(본문의 표본 정의 그대로). 8단계 목표 0.5 는 교본 행동·판단 지점이 생기는 2~6단계 뒤에 잰다.
- 걸을 수 있는 다친 대원이 현장마다 '부상 — 체력 저하.' 를 한 번 말한다(새 현장 대원 — 4번).

### 단계 2 (경찰) — 2026-11-16

**상태: 구현됨, 결과 바뀜(의도 — 경찰 교본·탄약·엄폐).** 작업자 브랜치 `wf/doctrine-s2`, 시작점 `35b1470`(단계 1 의 끝). 측정의 "전"은 단계 1 의 `after1/`(같은 명령), §8.2 의 기준은 `base97/` 이다.

| 커밋 | 내용 |
|---|---|
| `c72e883` | 단계 2 의 코드 전부 — 탄약·엄폐·판단 지점·P 줄 열넷·CP1~CP4·`request` 기록 id·D2·D3·D6·D7 |
| `ce92c2a` | 측정 뒤 고침(아래 "측정이 찾은 것") + §8.4 손잡이 + 시험 2-a·2-b·2-d·2-h·2-j·4·6·경찰판 2-e |
| `7bdc03d` | 관문이 찾은 것: 무력화된 흉기 상대에게는 P02·P03 이 막지 않는다, P07 예외 문구, R2 수난 방법 시험의 표본, 실행기 주석의 상한 숫자 |
| `cab5cc8` | P16 은 이미 엄폐한 협상 자리에서는 걸리지 않는다(아래 17번) · 측정 묶음에서 쓰이지 않은 P10·CP2·CP3 의 장면 시험 · 시험 4 에 대형 인질극 세 교대 |
| `003bf83` | 교본 입력을 덜 만든다(결과 불변 — 아래 18번) · P11 장면 시험 |
| 그다음 커밋 | 이 메모 |

#### 실제 이름 (단계 2 에 생긴 것)

| 이름 | 어디 | 서명·뜻 |
|---|---|---|
| `KitDef.mag`·`reload`·`perShot` · `KITS.pistol/rifle/sniper` 의 `uses` | `crews.ts` | 본문 §2.9 표 그대로(권총 30/15/1/2.0초 · 소총 90/30/2/2.5초 · 저격 15/5/1/3.0초). `kitFor` 가 `mag` 를 복사한다(인근 도시 지원 부대도 같은 함수) |
| `refillGuns(sim, rid)` | `crews.ts` | 가진 총기를 처음 값으로(`uses`·`mag`). 보급(`runRearm`)과 집에 닿았을 때(`resources.arrive` 의 `returning`) |
| `Tuning.ammoBox` = `[1,1,2,2,3][장비]` · `AMMO_BOX_ADD` · `ammoBoxOf(kind, base)` | `difficulty.ts` · `resources.ts` | 순찰·폭발물 처리반 `tn.ammoBox`, 기동 +1, 특공 +2, 그 밖의 경찰 종류(형사·교통·경찰견·기동 진압)도 `tn.ammoBox`, 경찰 아닌 부대·경찰 헬기 0. 두 부대 리터럴이 같은 칸을 같은 순서로. 장비 손잡이 설명 끝에 ", 탄약 상자" |
| `TaskKind 'cover'`·`'rearm'` | `types.ts` (`'ashore'` 다음 새 줄) | 라벨 '엄폐'·'탄약 보급' |
| `gunReady(sim, a, gun?)` · `fireRound(sim, a, gun?)` · `reloadTick(sim, a)` | `field/doctrineRun.ts` | 쏘는 쪽(실행부). `fireRound` 는 난수 전에 부른다 — 재장전 중·탄창 0 이면 `false`(쏘지 않았다 → `s.rng` 를 건드리지 않는다). 쏘면 `useKit(…, perShot)`·`mag −= perShot`, 탄창이 비고 탄이 남으면 `a.reloadUntil`. `executor.act` 첫머리에 `reloadTick` 한 줄 |
| `runCover` · `runRearm` (`REARM_TIME` 6) · `docContinue` | 같은 파일 | 교본 행동의 실행과 붙잡는 점수(엄폐 0.97, 보급 0.96 / 0.86) |
| `gateStep(sim, s, a, t, gate, ans) → 'wait' \| 'go' \| 'timeout'` · `gatePassed` · `gateClear` · `ruleShort` · `docMark` | 같은 파일 | 판단 지점의 공용 걸음 — 처음 막힐 때 `t.gateAt`·`gateId`·`docRule` 과 문구(`note`), 예외(`exc`)가 처음 결정을 바꾸면 `excNote`, 상한이면 `outNote` 와 통과 기억(임무마다 `PASSED` WeakMap — 한 임무에서 같은 지점을 두 번 막지 않는다). `docMark` = 기록과 문구를 한 번에(고르기 지점 `coverFire`·`bangUse` 용) |
| `actEnd` · `ACT_LABEL` · `docNote(…)`(20초에 한 번, `{mate}`) | 같은 파일 | 교본 행동 임무가 어떤 까닭으로든 끝나면 `finishTask` 가 `actEnd` — 기록의 `t1` 과 `a.doc = null` |
| `DocSit.gunThreat`·`fightThreat`·`bangOnScene`·`bangComing` | `doctrine/registry.ts` · `doctrine.ts docSit` | 믿음 속 총기 위협·교전 위협, 현장 경찰의 섬광탄·오는 경찰 부대의 섬광탄(조직 정보) |
| `DocCtx.tg`·`pack {n, near, far}`·`dngSign`·`hideSpot()`·`solo` | 같은 두 파일 | `tg` = 대상 작업의 용의자 → 지금 임무의 용의자 → 가장 가까운 활동 용의자. `pack` = 같은 용의자를 맡은(arrest·engage) 동료 수와 2.6칸(`DOC.PACK_R`) 안팎. `hideSpot` 은 자기 모드에서만 `coverSpot(…, 숨기)` 를 한 번 잰다(늦게). `solo` = `SOLO_OK` 역할 |
| `DoctrineRule.unless`·`excNote`·`outNote`·`dropNote` · `DocGateAns.exc` | `doctrine/registry.ts` | 예외 조건(걸리면 그 줄이 적용되지 않는다 — 본문 §3.1 의 "예외" 칸), 예외·상한·내려놓음의 문구, 예외로 풀린 줄의 id |
| `DOC_SWITCH = { CP4, D6, D7 }` | `doctrine/registry.ts` | 본문 "확인 필요: 균형" 줄의 스위치(§8.4 손잡이 — 끄면 지금 규칙) |
| `DOC.PACK_R 2.6 · COVER_MEM 20 · COVER_CAP 12 · CALM 4` · `DOC_HOLD_TASKS` · `docHolds(s, b)` · `copUsable(sim, a, b)` | `field/doctrine.ts` | `docHolds`: 지휘관이 빼 오지 않는 교본 임무(엄폐·보급·공기 탈출·짝 따라 나감, 짝이 위험 실내에 있는 짝 동행). `copUsable`: CP1 의 "쓸 수 있는 경찰"(지휘관 믿음 속 'crew' 신고가 중상 미만 · 총 탄 위급 아님 — 동요는 빼지 않는다) |
| `P02_WAIT 12 · P02_WAIT_BACKUP 18 · P03_WAIT 3 · P07_WAIT 40 · P07_WAIT_BACKUP 120` | `doctrine/police.ts` (내보냄 — 시험이 읽는다) | 판단 지점 상한(§8.4 손잡이 2 를 돌린 값 — 아래) |
| `breachExit(sim, s, k, team)` · `standOffSpot` · `waitSpot`(`WAIT_AT`) · `toCoverSpot` · `COVER_FIRE` · `STAND_TASER 2 · STAND_KNIFE 3` | `field/executor.ts` | 아래 "걸리는 자리" |
| `request(…): number` · `hostHurt` · `lawComing` · `docCmd` | `field/commander.ts` (+ `sceneRegistry.ts` 의 `CommandKit.request` 서명) | 보낸 무전의 기록 id(못 보냈거나 버렸으면 −1) |
| `dispatchPref` (`D2_EOD` −40) · `docNeeds` · `predictNode` · `chaseRoles` (`CHASE_NEAR` 42 · `CHASE_LATE` 1.5) | **새 파일 `dispatch/doctrine.ts`** | 관제 교본(판단만 — 보내기·기록은 부르는 쪽) |
| `setReported(sim, I, node)` · `chaseTold` | `pursuit.ts` | 알려진 위치를 바꾸는 세 자리가 한 함수로(`reportedPrev` 는 바뀔 때만, `reportedNodeAt` 은 보고마다), `I.trackBy` |

#### 등록한 줄 (경찰 열넷 — `doctrine/police.ts`, 등록 순서 그대로)

| id | 자리 | who · 장비 | when (요약) | effect | rank | why |
|---|---|---|---|---|---|---|
| P01 | gate `closeIn` (arrest) | 경찰 · 테이저 | 흉기·맨손이 맞섬, 4칸 안, 동료가 곁(≥1), 아직 무력화 전 | block 8초 | 1 | kit |
| P02 | gate `closeIn` (arrest) | 경찰 · 테이저·빈백 없음 | 흉기가 맞섬, 같은 대상 동료 0, 무력화가 보이지 않음 · **예외** 시민이 위협 2칸 안 | block 12초(지원 옴 18) | 1 | alone |
| P03 | gate `closeIn` (arrest) | 경찰 · 테이저 없음 | 흉기·맨손이 맞섬, 동료 ≥1 인데 곁에 없음, 무력화가 보이지 않음 | block 3초 | 2 | buddy |
| P05 | gate `coverFire` (engage) | 경찰 | 탄을 세는 총 · 대상이 총기 · 진입 명령 | choose cover | 1 | danger |
| P07 | gate `roomEntry`·`breach` (engage) | 경찰 | `!solo` · 곁 동료 0 · **예외** 총격 중 + 시민 위험 | block 40초(지원 옴 120) | 2 | alone |
| P08 | act `rearm` | 경찰 | 총 · 상자 > 0 · (마지막 탄창 && 교전 위협 없음) ‖ (탄 위급 && 피격 아님) | 0.97 / 0.78 | 1 | lowAmmo |
| P09 | act `cover` | 경찰 | 총 · 총격 교전 · 탄 위급 · (피격 ‖ 상자 0) · 숨을 자리 있음 | 0.97 | 0 | lowAmmo |
| P10 | act `cover` | 경찰 | 총 · 재장전 중 · 피격 · 엄폐 아님 · 대상 있음 | 0.97 | 1 | lowAmmo |
| P11 | act `cover` (swap retreat) | 경찰 | 피격 · 체력 40~70 · 출혈 없음 · 엄폐 아님 · 위험 표지 아님(`dngSign` 0) · 숨을 자리 | 위험 점수 그대로 | 1 | danger |
| P12 | fit | doc police | 중상(band ≥ 1) | ×.35 engage·arrest · +.15 가벼운 일(협상 뺀, `c.light`) · +.2 협상(침착 ≥ .6) | 1 | hurt |
| P14 | gate `closeIn` (engage 인질 갈래) | 경찰 | 대상이 총기 · 인질 · 현장 경찰 섬광탄 0 · **예외** 동료 곁 + 등짐(100°) | block 20초(섬광탄 옴 40) | 1 | hostage |
| P15 | gate `bangUse` (breach) | — · 섬광탄 | 마지막 한 개 · 진입 명령 · 대상이 3칸 밖 | choose save | 3 | kit |
| P16 | act `cover` | 경찰 | 협상 중 · 대상이 맞섬 · **엄폐 아님** · 숨을 자리 | 0.93 | 1 | danger |
| P22 | fit (drop) | 경찰 | 총 · 탄 위급 · 믿음 속 총기 위협 | ×0 engage(총기 대상)·perimeter, 하던 것도 놓는다(`drop`) · +.15 traffic·interview | 1 | lowAmmo |

지휘·관제·추격 줄의 이름표(`CMD_ROWS`): CP1~CP4 · D3 · D6 · D7(경찰), D2(특수 — `doctrine/special.ts`). `DOC_DEPTS_DONE = ['police']` — 시험 8 이 경찰 21줄(개인 14 + 지휘 7)을 본다.

#### 걸리는 자리 (단계 2)

- **탄약**(§2.9): `executor.shootAt` 첫 줄 `if (!fireRound(sim, a)) return;`(난수 전). 저격(`methodRun.runSniper`)은 `gunReady(…, 'sniper')` 가 아니면 조준을 멈추고, 명중 판정 뒤 `fireRound(…, 'sniper')`. 탄 칸은 단계 1 의 `crewNow`·`selfReport` 가 저절로 신고한다('탄약 소진.').
- **엄폐**(§2.10): `doctrine.coverSpot`(단계 0) 을 그대로 쓴다. 엄폐 사격 자리(`toCoverSpot` — P05·P14)는 `t.cvX/cvY/cvTx/cvTy/cvLost` 에 담고 본문의 세 때에만 다시 고른다. 숨기(`runCover` — P09·P10·P11·P16)는 대원 둘레 4칸, 끝나는 조건은 본문대로(재장전 끝 + 4초 · 탄 위급 + 4초 · 위협이 맞서지 않음 · 12초), 끝나면 `docRemember(…, 줄, 'h:<id>', 20)`.
- **판단 지점**: `arrest` 의 붙기 직전(`closeIn` — P01~P03: 막히면 2칸(테이저 둘)/3칸까지만 다가가 기다리고, 그보다 가까우면 `standOffSpot` 으로 물러난다), `engage` 의 인질 갈래(`closeIn` — P14: `toCoverSpot`, 없으면 지금의 7.5칸), `engage` 의 마지막 분기(`coverFire` — P05, 1초마다 다시 묻는다), 동료 없이 4초 뒤의 방 진입(`roomEntry` — P07), 동시 진입의 출입구마다(`breach` — 혼자인 진입조만 묻는다. 막히면 그 출입구만 건너뛰고 그 대원은 `t.gateId 'breach'` 로 출입구 곁에 남았다가 풀리면 자기 문만 연다), 섬광탄 던질 사람 고르기(`bangUse` — P15).
- **brain**: `docRetreat` 에 `dngSign`(위험 표지 때문인 위험은 P11 이 바꾸지 않는다), `docDrop` 이 `dropNote` 를 말하고 `finishTask(…, 'doctrine')`, `docContinue` 가 교본 행동을 붙잡는다. `pickAct` 는 지금 하는 행동과 같은 행동을 다시 내지 않는다.
- **assign**: `docHolds` 인 대원은 건너뛴다(§2.6).
- **지휘(§6.1)**: CP1 — `usable`(머릿수에서 `copUsable` 이 아닌 대원을 뺀 수)을 흉기 검거 문턱·진입 결정(100초 시간 예비 규칙 빼고)·두 문 진입에 쓰고, `usable < 2 && police > usable` 이고 오는 경찰이 없으면 '제압 가능 인력 부족'. CP2(`orders/doctrine.ts`) — 흉기 교전 · 쓸 수 있는 경찰 < 2 · 오는 경찰 0 → '흉기 난동 — 2인 제압 인력 부족'. CP3 — 탄 위급 신고 둘 이상 · 현장 경찰 부대의 상자 합 0 → '탄약 보급 필요'. CP4 — 125초 줄이 섬광탄도 인질 부상도 없으면 진입하지 않는다(기록만, 기동대 요청은 원래 줄). 요청 줄은 `request` 가 0 이상을 돌려줄 때만 기록한다.
- **관제(§6.2)**: `analyst.assess` 의 수요 뒤 `docNeeds`(D3 흉기 → 경찰 2 · D6 인질극·위험도 ≥ 2.4·특공 없음 → 기동 2, 장난 전화 빼고), `dispatcher.pickUnit` 의 점수에 `dispatchPref`(D2), 가산 전후의 1등이 다를 때만 `sendUnit` 이 출동 지령 기록 id 로 남긴다.
- **추격(D7)**: `pursuit.tickPursuits` 의 "알려진 위치로 방향을 바꾼다" 줄이 `chaseRoles` 로 부대마다 따라가기/앞막기. 역할이 바뀔 때 관제 무전 한 줄('헬기가 보고 있다 — X, 앞을 막아라.' / 'X, 앞 교차로로 돌아가라.' / 'X, 알려진 위치로 따라가라.').

#### 본문과 다르게 한 곳

1. **P17·P17b 는 3단계로**(짝 맺기 `pairUp` 와 판단 지점 `interiorEntry` 가 3단계에 생긴다), **P20 은 6단계로**(방법 `blockLane`). 시험 8 의 경찰 줄 수는 21(≥ 12).
2. **R2 의 '폭파 진입 0건' 줄들**(장약을 든 사람이 문을 연다 · 인질 위치를 모르면 장약을 쓰지 않는다 · 진입 전 잠긴 문을 차지 않는다)은 5단계(S26 — 특수 표)로 보았다. 2단계에서 고치지 않았다.
3. **`breachExit` 는 `executor.ts` 에** 두었다(본문 §11.1 은 `doctrineRun`). 진입 뒤 검거를 'breach' 로 적는 `ENTERED` 가 실행기 안의 것이다. 진입 문구는 실제로 문을 연 진입조의 대원 이름으로 남긴다(전에는 부른 대원 — 자기 문이 건너뛰어져도 그 이름이었다).
4. **P01 의 기다리는 거리 2칸**(본문 1.8칸 — 흉기가 닿는 거리 경계에 서지 않게). 이미 더 가까이 서 있으면 그 거리의 칸으로 **물러난다**(`standOffSpot`) — 측정에서 흉기 상대 곁에 선 채 기다리다 다치는 일이 나왔다.
5. **혼자라 진입에서 빠진 대원은 출입구 곁 4칸 안의 숨을 자리에서 기다린다**(`waitSpot` — 없으면 출입구 앞). 본문은 기다리는 자리를 적지 않았다. 문 앞에 서 있으면 방 안의 총격범에게 40초 동안 드러났다.
6. **엄폐 사격 자리는 그 분기가 쫓는 대상의 자리(`h.x/y`)로 고른다**(본문: 믿음 위치 `t`). 그 분기의 지금 동작(`moveTo(h…, 7.5)`)이 이미 같은 자격으로 읽는다. 믿음 위치로 고르면 움직이는 총격범을 놓쳐 강제 `armed/shooter` 의 한계 시간이 늘었다. 또 판단부가 `losWalls`(문은 열려 있다고 본다)로 고른 자리를 실행기가 실제 `los` 로 한 번 더 걸러 **닫힌 문 너머의 자리는 받지 않는다**(측정의 교착 후보 S40 #02 — 그 자리에 서면 아무것도 보이지 않아 '엄폐 사격'만 되풀이했다).
7. **P16 은 협상 작업을 12초 붙든다**(`holdUntil = sim.t + COVER_CAP`). 엄폐하는 동안 지휘관이 그 협상을 다른 경찰에게 넘겨 줄줄이 엄폐에 들어가는 일이 있었다.
8. **상한**(§8.4 의 2번 손잡이를 이 순서로): P02 20 → 12초(지원 옴 30 → 18), P03 6 → 3초, P07 의 지원 없음 60 → 40초. P14·CP4·CP1 은 시작값 그대로다(아래 수치).
9. **CP1 의 추가 요청은 `police > usable` 일 때만**(교본이 문턱의 수를 실제로 바꾼 때 — 다친 경찰이 없는 현장의 '인원 부족'은 원래 요청 줄이 낸다). 진입 결정의 100초 시간 예비 규칙과 봉쇄 자리 수는 머릿수 그대로(언젠가는 들어간다 · 봉쇄가 출렁이지 않는다).
10. **D3 은 `law = max(law, 2)`**, D6 은 기동 수요가 1일 때만 2로. D7 의 무전은 앞막기와 앞막기→따라가기로 바뀔 때만(처음 따라가기는 원래 지령이 말한다).
11. **탄약은 집에 닿을 때도 채운다**(`refillGuns` — 본문은 상자만 적었다). 그러지 않으면 다음 사건에 빈 총으로 나간다.
12. **CP3 의 '현장 경찰 부대의 상자 합'**은 현장에 있는 경찰 부대 가운데 상자를 갖는 부대(`ammoBoxMax > 0`)의 `ammoBox` 합이다(그런 부대가 하나도 없으면 부르지 않는다 — 상자가 없는 편성에서 보급 지원을 끝없이 부르지 않게). 요청 능력은 `law`.
13. **시험 4(단계 2)** 는 "교본 임무를 놓은 뒤 10초 안에 같은 교본 임무로 다시 들어간 횟수 = 0" 으로 쟀다(엄폐 → 교전 → 엄폐). **시험 6** 은 강제한 시나리오의 한계 시간·방치만 센다 — 최소 인원 교대의 배경 사건(납치 추격)은 단계 1 과 같은 수로 방치되고, 교대 끝 90초 안에 닫힌 사건은 남은 부대로 보지 않는다.
14. 시험 5 의 단계 1 묶음은 단계 2 뜻으로 고쳤다 — 탄 칸이 이제 돈다(`crewSig` 정규식), `exc: null` 이 판단 지점 답에 들어간다.
15. **P02·P03 도 대상이 무력화된 것이 보이면 걸리지 않는다**(본문은 P01 에만 "무력화 전"). 동료의 테이저에 맞아 3.2초 쓰러진 흉기 상대 앞에서 테이저 없는 경찰이 12초를 기다리면 그 틈을 버리고 다시 맞서는 상대를 덮친다(관문의 R2 시험 '무장 강제 … 테이저 기록'이 잡았다 — A2 #09).
16. **P07 의 예외 문구는 '총격이 계속됩니다 — 혼자 들어갑니다.'** — '진입!' 을 담으면 G5 시험(`combatfx` '꼬리표')이 방 진입 문구로 읽는다(그 문구 뒤에 방 진입 기록이 없다고 깨졌다).
17. **P16 은 협상 대원이 이미 엄폐해 있으면 걸리지 않는다**(`!c.st.inCover` — 본문 §3.6 에 없는 조건). 본문은 지금의 협상 대원이 '그 자리에 서 있기만 한다'고 보았지만, 실행기의 협상·봉쇄 자리는 "위치 사수 — 교전 중인 용의자가 보이면 엄폐 상태에서 응사"다. 그 자리를 떠나 숨으면 응사가 끊겨 총격범이 다른 대원을 쏜다 — 줄을 하나씩 뺀 측정(강제 `armed/siege` Q0~Q39)에서 P16 하나를 빼면 다친 대원이 36 → 26 이었다. 고친 뒤 S0~S39 + Q0~Q39 80교대: 대형 인질극 70 → 56(기준 51), 총격범 29 → 35(기준 28 — 아래 알려진 문제). 그래서 엄폐 임무는 이제 드물다(시험 4 에 대형 인질극 세 교대를 더한 까닭).
18. **P08·P09·P10·P16·P22 에 `who: { dept: ['police'] }`**(본문 §3.6 의 who 칸은 '—'). 총(권총·소총·저격)을 드는 역할과 협상(`fitFor` 의 `negotiate` 는 경찰만)이 모두 경찰이라 뜻은 같다. 엔진이 입력을 만들기 전에 '누구' 칸만 보는 `whoMay` 를 `pickAct`·`docFitRules`·`docDrop` 에 두어, 소방·구급 대원의 판단마다 입력을 만들던 시간을 덜었다. 같은 커밋에서 `docCtx` 의 장비 읽기(`c.has`·`c.kit`)는 대원마다 한 번 만든 함수(`kitFnsOf`)를, 숨을 자리(`c.hideSpot`)는 자기 모드이고 위협이 있을 때만 새 함수(`hideOf`, 아니면 `NO_HIDE`)를 쓴다. 해시 123개(보통 40 · 어려움 20 · 극한 20 · 재난 15 · 강제 28)가 전과 같다.

#### 설계서 밖에서 고친 공용 파일

- `crews.ts` `refillGuns`(새 함수), `resources.ts` `AMMO_BOX_ADD`·`ammoBoxOf`·`arrive` 의 총 채우기.
- `pursuit.ts` `setReported`(내보냄 — 시험 2-h 가 쓴다)·`chaseTold`.
- `field/methodRun.ts` `runSniper` 의 탄 소모(본문 §9 표에는 있으나 §11.1 목록에 없다).
- `dispatch/dispatcher.ts` 의 `Cand.doc`·`prefOf` WeakMap, `dispatch/analyst.ts` 의 `docNeeds` 한 줄과 import.
- `field/gear.ts` `gunOf` — 단계 0 의 임시 `GunDef` 를 지우고 `KitDef` 의 진짜 칸을 읽는다.
- `tests/doctrine.test.ts` 의 새 묶음 '시험 2-d (덧붙임)': 측정 묶음에서 한 번도 쓰이지 않은 P10(재장전 엄폐)·P11(피격 엄폐)·CP2(2인 제압 요청)·CP3(탄약 보급 요청)을 장면이 쓴다(§9 완료 조건 1 — 측정 ∪ 시험 = 100%). 지휘 교본은 `ORDER_RULES` 의 마지막(현장 등록 끝의 `orders/doctrine`)을 시험용 `CommandKit` 으로 부른다.
- `tests/methods.test.ts` R2 단계 1a 의 시험 3('방법마다 쓰인 교대가 있다'): 표본 `W20().slice(0, 12)` → `W20()`(이미 같은 파일이 스무 교대를 다 돈다 — 시간 그대로, 기준 "방법마다 한 번 이상" 그대로). 경찰 교본이 배경 사건의 부대 배치를 바꿔 W1 #11 의 장대 구조(앞 12교대의 유일한 장대)가 즉석 부력물로 바뀌었다. 장대는 W12 #01·W14 #10 에서 쓰인다.

#### 측정이 찾은 것 (`c72e883` → `ce92c2a`)

첫 측정(`s2/m1`)에서 보통 60 의 한계 시간이 1 → 3, 교착 후보 0 → 1, 어려움의 한계 시간 15 → 21 이었다. 강제 묶음과 사건 기록을 읽어 고친 것: ① 닫힌 문 너머의 엄폐 사격 자리(교착 S40 #02) ② 엄폐 사격 자리를 낡은 믿음 위치로 골라 총격범을 놓침 ③ 동시 진입의 진입 문구가 문을 열지 않은 대원 이름 ④ P16 의 협상 넘김 연쇄 ⑤ 흉기 상대 곁(1.8칸 안)에서 선 채 기다림 ⑥ 혼자 빠진 진입조가 문 앞에 드러남 ⑦ §8.4 손잡이(위 8번). 그다음 관문(`npm run check`)이 셋을 잡았다 — ⑧ 무력화된 흉기 상대 앞의 P02·P03(위 15번) ⑨ P07 예외 문구(16번) ⑩ R2 수난 방법 시험의 표본(공용 파일 끝 줄). 마지막으로 대원 부상 목표를 보며 줄을 하나씩 뺀 측정이 ⑪ P16 의 응사 끊김(17번)을 찾았다.

#### 수치 (기준 `97869b1`(`base97/`) → 단계 1 `631a534`(`after1/`) → 단계 2 `cab5cc8`(`s2/m4/`), 같은 명령. 그 뒤의 커밋은 결과가 같다 — 해시 123개)

| 묶음 | 기준 | 단계 1 | 단계 2 | §8.2 |
|---|---|---|---|---|
| 보통 60 — 성공 · 부분 · 지연 · 미해결 · 실패 (850 / 850 / 849건) | 669 · 84 · 32 · 18 · 47 | 668 · 85 · 31 · 18 · 48 | 665 · 87 · 33 · 13 · 51 | |
| 보통 60 — 성공률 · 성공+지연 · 실패+미해결 | 78.7 · 82.5 · 7.6% | 78.6 · 82.2 · 7.8% | 78.3 · 82.2 · 7.5% | 성공률 ±3%p ✓ |
| 보통 60 — 한계 시간 · 방치 | 1 · 2 | 1 · 2 | 1 · 3 (납치 추격 2 · 차량 도주 1) | + 2 이하 ✓ |
| 보통 60 — 유형별 성공 | 화재 118 · 무장 97 · 응급 95 · 교통 133 · 붕괴 51 · 가스 50 · 실종 96 · 수난 29 | 118 · 97 · 94 · 133 · 51 · 50 · 96 · 29 | 114 · 99 · 93 · 134 · 50 · 50 · 96 · 29 | 화재 −2.3%p · 무장 +2.1%p · 응급 −1.8%p ✓ (응급 지연 13 → 14) |
| 보통 60 — 다친 대원/교대 · 평균 대응 | 0.20 · 49초 | 0.217 · 49초 | 0.183 · 49초 | 기준 이하 ✓ |
| 보통 60 — 행동 엔트로피 · 방법 엔트로피 · 교착 후보 · 잊힌 사건 · 반복 최대 · C1~C5 | 2.51 · 0.56 · 0 · 0 · 6 · 0 | 2.51 · 0.56 · 0 · 0 · 6 · 0 | 2.51 · 0.57 · 0 · 0 · 6 · 0 | ✓ |
| 보통 60 — 교본 | — | 공통 줄만 | 쓰인 줄 G03 78 · P05 42 · P07 37 · D3 26 · P02 18 · P03 17 · P16 16 · P15 14 · G02 12 · G01 11 · P12 10 · D2 7 · D6 2 · D7 2 · P01 2, 판단 지점 평균 3.3초(130건) · 교본 행동 11.3초(16건), split 0.367 | split ≥ 0.5 는 8단계 |
| 쉬움 · 어려움 · 극한 60 — 성공+지연 | 88.3 · 65.6 · 43.8% | 88.3 · 65.9 · 43.1% | 87.5 · 65.8 · 43.3% | 순서 유지 |
| 쉬움 · 어려움 · 극한 — 한계 시간 + 방치 + 출동 없음 (그 가운데 한계 시간) | 1 · 17 · 51 (0 · 5 · 18) | 1 · 15 · 58 (극한 23) | 1 · 19 · 56 (0 · 6 · 17) | |
| 쉬움 · 어려움 · 극한 — 다친 대원/교대 | 0.12 · 0.58 · 1.62 | | 0.17 · 0.63 · 1.80 | |

**측정 묶음의 쓰인 줄**(보통 60 + 강제 20교대 스물 + 지진해일 + 최소 인원 + 장비 불량 — `s2/usage.cjs`): 경찰 21줄 가운데 **15줄(71%)** — P01 4 · P02 65 · P03 81 · P05 259 · P07 265 · P08 2 · P12 99 · P14 4 · P15 113 · P16 187 · CP1 3 · CP4 1 · D3 211 · D6 20 · D7 18. 쓰이지 않은 여섯(P09·P10·P11·P22·CP2·CP3)은 모두 장면 시험이 쓴다(시험 2-d, '시험 2-d (덧붙임)') — 측정 ∪ 시험 = 21/21. 75% 문턱은 넘지 못했다(아래 알려진 문제).

**강제 20교대**(기준 → 단계 2. 추격은 놓침 `SUSPECT_FLED` 도):

| 묶음 | 성공 | 한계+방치+무대응 | 다친 대원/교대 | 그 밖 |
|---|---|---|---|---|
| `armed/dispute` | 213 → 215 | 1 → 2 | 0.15 → 0.25 | |
| `armed/domestic` | 218 → 221 | 1 → 0 | 0.25 → 0.25 | |
| `armed/shooter` | 194 → 202 | 2 → 2 | 0.35 → **0.65** | |
| `armed/hostage` | 220 → 215 | 3 → 3 | 0.35 → 0.30 | |
| `armed/siege` | 197 → 195 | 1 → 0 | 0.55 → **0.85** | |
| `armed/kidnap` | 218 → 216 | 14 → 14 | 0.10 → 0.05 | 놓침 22 → 24 (+2 ✓) |
| `armed/getaway` | 203 → 204 | 10 → 12 | 0.25 → 0.45 | 놓침 25 → 23 ✓ |
| `fire/std` | 211 → 212 | 0 → 0 | 0.05 → 0.10 | |
| 최소 인원 (`3,3,3,3,3,1`) | 134 → 131 | 6 → 9 (한계 시간 4 → 7, 단계 1 은 6) | 0.30 → 0.30 | |
| 장비 불량 (`3,3,3,1,3,3`) | 177 → 179 | 0 → 1 | 0.15 → 0.15 | |
| 나머지 열(화재 방화·붕괴·가스·수난·응급 둘·교통 둘·폭발물 둘·지진해일) | 묶음마다 ±5 | ±2 | | |

**대원 부상 목표**(§8.2 — 강제 `armed/shooter`·`armed/siege`·`fire/std` 에서 기준 대비 −10%)는 **이루지 못했다**. 20교대는 흔들림이 커서 시드를 넓혀 다시 쟀다(S0~S39 + Q0~Q39 = 80교대, 교대의 모든 사건 — `s2/abl12-*.txt`): 총격범 기준 28 · 단계 1 25 · 단계 2 35(P16 고치기 전 29), 대형 인질극 51 · 51 · 56(고치기 전 70). 줄을 하나씩 뺀 측정(대형 인질극 Q 40교대 — `s2/abl10-*.txt`)에서 경찰 줄을 모두 빼면 30(단계 1 과 같다), P16 하나를 빼면 26, 나머지 줄(탄약·P05·P07·P14·P15·D6·CP4·P01~P03·P09~P11·P12·P22·P08)은 하나씩 빼도 33~38 — P16 말고는 한 줄이 만드는 몫이 흔들림 안이다. 사건 기록을 읽으면 다친 대원의 대부분은 지금도 "대기(standby) 중 시야 안 노출"이다(경찰은 체력 70 이상이면 피격돼도 물러나지 않는다 — `brain.dangerScore`). 경로가 출동 단계(D2·D3·D6)부터 갈라져 같은 시드끼리 견주기 어렵다.

**교대당 시간**(`sweep 40`, 기준·단계 1·단계 2 를 번갈아 두 번 — `s2/timing40.txt`): 기준 488 · 503ms(사용자 CPU 43.2 · 45.0초), 단계 1 562 · 585ms(48.7 · 50.9초), 단계 2(`003bf83`) 562 · 622ms(49.0 · 53.9초) — 기준 대비 **1.20배(벽시계) · 1.17배(사용자 CPU)**, 단계 1 은 같은 재기로 1.16 · 1.13배. 단계 2 가 더한 몫은 3% 안팎이다(입력 줄이기 전 `sweep 20` 은 1.19~1.25배). §8.2 의 1.15배를 넘는다.

관문: `npm run check` 통과(마지막 커밋 — 시험 파일 19 · 824 통과 + 건너뜀 1, `sweep 40 --check` "검증 통과", 교착 후보 0 · 잊힌 사건 0 · C1~C5 0). `npx vitest run tests/sim.test.ts -t 생활`·`tests/crime.test.ts -t 폭동` 통과. 화면을 고치지 않았으므로 `npm run ui-check` 는 돌리지 않았다. `tests/doctrine.test.ts` 49개.

#### 알려진 문제

- **대원 부상 목표 미달**(위). 8단계(균형)에서 볼 자리: ① 대기 중 시야 안에서 피격되는 경찰(체력 70 이상)을 숨기는 행동 줄(P11 의 문턱을 넓히거나 새 줄 — 본문 §8.4 의 4번 손잡이는 반대 방향이다) ② 저격수가 재장전(3초) 동안 조준 자리에 서 있는 것(R2 저격 + 2단계 탄약) ③ 출동 단계 줄(D3·D6)이 부대 도착 순서를 바꿔 생긴 경로 차이.
- **교대당 시간 1.17~1.20배**(1.15배 초과). 늘어난 몫의 대부분은 단계 1 의 것이고, 단계 2 는 경찰 대원의 판단마다 자기 모드 입력(`docCtx` — 상태·상황은 틱마다 한 번)을 만드는 몫이다(`pickAct`·`docFitRules`). 섬광탄 두 칸(`docSit` 의 동료 장비 훑기 — 대원 수의 제곱)을 인질 총기 믿음이 있을 때만 세는 길은 같은 틱 안에서 믿음이 바뀌면 결과가 달라질 수 있어 넣지 않았다.
- **쓰인 줄 71%**(75% 미만): 탄약·체력 줄(P09·P10·P11·P22)과 CP2·CP3 은 교전이 짧아 측정 묶음에서 거의 걸리지 않는다(본문 §2.9 "드물지만 보이게"). 장면 시험이 모두 쓴다.
- 최소 인원 묶음의 한계 시간 4 → 7(단계 1 은 6), 어려움·극한의 한계+방치+무대응 17 → 19 · 51 → 56. 강제 `armed/getaway` 한계 시간 0 → 2.
- P16 을 좁힌 뒤 엄폐 임무는 드물다(보통 60 에서 교본 행동 16건 — 고치기 전 39건).

#### 이어받을 자리

- **3단계**: P17·P17b(확보 전 무장 현장의 수색은 짝과 — `interiorEntry`)를 `police.ts` 끝에. `docHolds` 는 이미 `pair`(짝이 위험 실내)·`airOut`·`pairOut` 을 본다. `DocCtx.pack` 은 같은 용의자를 맡은 동료만 센다 — 짝(`a.buddy`)과는 다르다.
- **5단계**: R2 의 폭파 진입 줄(본문과 다른 곳 2번), 폭파 진입의 동요(단계 1 의 알려진 문제)를 S26 과 함께. 특공·폭발물 대원은 경찰 줄을 받는다(`who.dept police`) — S 줄이 겹치면 rank 로 가른다.
- **6단계**: P20(`blockLane`).
- 시험이 고른 장면(시험 2-a·2-b·2-d·2-j 의 손으로 만든 방)은 시드와 무관하다. 시험 6 은 시드 `R3-MIN0~5`, 시험 4 는 `R3-OSC0~5`(인질극)·`R3-OSC0~2`(대형 인질극).
- **8단계(균형)**: 위 알려진 문제의 부상·시간·쓰인 줄. 줄을 하나씩 빼고 재는 도구는 scratchpad `wf-doctrine/s2/abl.mts`(줄 id 또는 `POLICE`·`AMMO`·`DOC_SWITCH` 이름, `SEEDP` 로 시드 앞글자), 다친 대원 하나하나의 임무·거리·직전 기록은 `s2/hurt3.mts`, 대원 한 명의 임무 흐름은 `s2/trace.mts`.

### 단계 3 (소방) — 2026-11-16, 나란히 실행

브랜치 `wf/doctrine-f3` (시작 34d30a3, 4 의료·5 특수와 나란히). 커밋은 `R3 단계 3: …` 다섯(이 메모 포함).

**한 것** (§9 의 3 행):
- 짝: `doctrineRun.pairUp`(아래 쓰는 법)·`rebuddy`(brain.think 의 0번), `TaskKind 'pair'`(G08 — `runPair`: 1.4칸 안에서 따라가며 짝의 진압에 함께 방수·수색 확인을 더한다), `buddyOf`(§5.2 — 짝이 맡은 작업판 일·받은 지시까지 본다), `pairOf`(DocCtx.pair() 의 게으른 칸 — F02·F04·F04c·F16·G08·P17·P17b 가 읽는다), 밖 대기조 `outsideWatch`·`watchNeed`(DocCtx.watch()).
- 판단 지점 `interiorEntry`(F04c·F05·P17b — executor.moveTo 의 실내 첫걸음, `interiorStep`·`interiorGate`): 상한 20/30초, 놓으면 `holdUntil +10`·`docMem w:` 30초.
- 의무 `airOut`(F01 — `runAirOut`: 대기 지점 또는 출입구 밖 3칸 안의 맑은 칸, 예비가 있으면 8초 교체)·`pairOut`(F02 — `runPairOut`). `AIR_IN`: R1 `airShort` 를 한 통의 50%(`crews.AIR_IN_FRAC` = `DOC.AIR_IN` = `fire.F_AIR_IN`, 시험 8)로, 바깥에서 손이 빈 공기 50% 아래 대원의 교체 후보 0.7(brain).
- 방법 `feel`(F07 — 벽을 따라 더듬는 수색, 확인 0.8 에서 멈춤)·`pulse`(F08 — 진압 ×0.85, 물 ×0.65) 행과 SAY. `methodStillFits` 에 교본 배율(`dc`)을 넘긴다(배연 뒤 전환이 교본을 무시하던 것 — 과제의 고칠 것).
- `sparePump`(`Tuning.sparePump` [0,1,1,1,2], 물을 싣는 부대만 — `resources.sparePumpOf`), 예비 펌프 교체가 하나 쓴다(F10 — 0 이면 후보 없음).
- F 줄 열일곱(F01·F02·F03·F03b·F04·F04b·F04c·F05·F05b·F06·F07·F08·F09·F12·F13·F14·F16), 공통 G08, 경찰 P17·P17b, 지휘 CF1~CF7(CF5·CF6 은 X6 `DANGER_RULES` 두 줄 — `DangerHit.rule`, 그 줄이 구역을 만들거나 올린 때 `docZone` 기록), 관제 D4·D5.
- 시험: 2-c·2-f·3(숨은 고장 — 열화상·유압·로봇)·4(공기 문턱·짝 동행 경계·강제 fire/std 6교대 왕복 0·`w:` 기억)·6(최소 인원 fire/std 3교대)·7(공기 탈출 문장 — 장면)·8(소방 줄 ≥ 12·짝 표·pairUp 최소 인원)·9(업고 있으면 공기 탈출 없음·탑승 지시) — 끝의 describe 들. 시험 5 의 단계 2 단언을 단계 3 으로(다른 단계가 나란히 줄을 더해도 깨지지 않게 `mine()` 으로 이 단계까지의 줄만 고른다).

**`pairUp`·`PAIRS` 쓰는 법** (다른 단계가 짝을 쓸 때):
- `PAIRS[kind] = { std: [역할, 역할][], min: [역할, 역할][] }` (doctrine.ts — 0단계 표 그대로). 같은 역할이 둘인 쌍은 내린 순서(crew 순서)로 첫째끼리.
- `pairUp(sim, s, u): void` — `sceneManager.unitArrived` 가 그 부대의 대원을 내린 반복 **뒤에** 한 번 부른다. 돌려주는 값 없음. 쌍을 순서대로 보며 그 부대의 이 현장 활동 대원 가운데 아직 짝이 없는 첫째 A 와 (다른 사람인) 첫째 B 를 서로 맺는다. 최소 인원 부대(`minUnit` — 표준 편성의 `minDrop` 역할이 내린 대원에 없다)는 `min` 열. 한쪽이 없으면 건너뛴다.
- 짝을 기억하는 칸은 `FieldAgent.buddy` 하나(짝의 rid, 없으면 −1 — `makeAgent` 가 −1). 판단부는 `buddyOf(sim, s, a, w?)`(쓸 수 있는 짝, 없으면 null)·`c.pair()`(DocPair: raw·rawOut·forW·follows·rookie·job·canFollow·myP·myIn)를 읽고 `a.buddy` 를 고치지 않는다. 다시 맺는 것은 실행부 `rebuddy(sim, s, a)`(brain.think 의 맨 앞 — `SOLO_OK` 는 하지 않는다)뿐이다.

**본문과 다르게 한 것** (측정이 찾은 것 — 모두 결과를 바꾼다):
1. `DOC.WATCH_R` 8 → 12: 화재 현장의 대기 지점이 가장 가까운 출입구에서 7.6~18.6칸(가운데 10)이라 8 이면 대기 지점의 대원이 대기조로 세어지지 않았다.
2. `G08` 은 짝의 일을 거든다(`pairHelp` — 관창을 든 동행은 짝이 겨눈 화점에 함께 방수(거리 4.8), 수색은 동행이 본 칸을 짝의 확인에 더한다). 따라만 가면 실내의 손이 절반이 되었다. 작업판의 담당자는 그대로 한 사람(§5.4).
3. 짝 동행이 끝나는 조건 더하기: 짝 곁(같은·이웃 구역)에 내가 맡을 빈 위험 실내 일(수색·진압·잔불 정리·구출·이송 — `doctrine.pairAlt`)이 생기면 끝내고 그 일을 맡는다(그 뒤 10초 G08 을 걸지 않는다 — `PAIR_ALT_MEM`). 손이 빈 짝이 위험 실내에 서 있거나 받은 지시가 위험 실내 일이면, 위험 건물의 진압을 밖에서 잠깐 하는 동안(외부 방어 ↔ 내부 공격)이면 3초 linger 를 잇는다(`nextHz`, 손이 빈 짝은 8초 — `AIR_OUT_RUN.lingerIdle`). 없으면 강제 fire/std 6교대에 "동행 → 없음 → 동행"이 63번이었다(시험 4).
4. `F04` 를 진압의 실내 방법에도 걸었다(`inJob` — 위험 건물의 진압 interior·pulse·방법 미정). 본문은 F04b(방법 배율)만이었으나, 그러면 짝 없는 관창수가 방법을 정하기 전에 문턱을 넘었다. 외부 방어 중(ops defensive)인 진압은 걸지 않는다.
5. `F05` 의 예외(§8.4 손잡이 1 의 첫째): 믿음 속 요구조자에 더해 신고 인원이 불명(`occ` 없음·count null)이어도 "있을 수 있다". 손잡이 1 의 둘째: `DOC.WATCH_NEED` 2 → 1(같은 사건으로 오는 scba 소방 부대가 있으면 0). 셋째 `AIR_OUT` 0.30 → 0.25 는 60교대 결과가 한 건도 달라지지 않아(평소 교대에 30% 아래로 떨어지는 일이 드물다) 되돌렸다.
6. `fitFor(…, afterSwap = true)`(지휘관의 "예비 공기통으로 바꾸면 맡을 사람이 있는가" — `anyCapable`)는 교본을 보지 않는다: 공기 50% 문턱(F03)과 짝의 공기(F04)가 바꾼 뒤의 어림까지 막아 관창수가 통을 바꾸러 나간 사이에 진압 부대를 더 불렀다(tests/crews.test.ts 의 anyCapable).
7. CF3 은 펌프차마다 한 번(`commander.cf3Asked`) — 교체를 부른 차가 있으면 용수 요청도 따로 내지 않는다. 관제가 보낼 부대가 없는 극한 교대에서 72초마다 같은 요청이 되풀이되었다(tests/loops.test.ts).
8. CF7 은 `assign` 의 지휘관 제외만(본문 그대로). 지휘관이 스스로 고르는 자리까지 막는 안(brain)은 측정에서 실내 진입이 20초 늦어져 넣지 않았다.
9. 짝 동행의 문구는 두 번째부터 중요도 0(`docBegin` — 방을 옮길 때마다 다시 시작한다), 벽 더듬기의 시작 문구는 한 사건에 한 번(`methodRun.SAY_ONCE` 에 feel — 탐지 방법).
10. 지휘 교본(orders/doctrine.ts)의 소방 줄 CF1·CF2·CF4 는 따로 등록하지 않고 경찰 지휘 교본 등록의 끝에서 `fireOrders` 로 부른다(시험이 마지막 `registerOrders` 를 지휘 교본으로 부른다 — 순서는 따로 등록했을 때와 같다).
11. `breachExit(…, sync)`: 늦게 자기 문만 여는 진입조(P07)의 문 열기는 동시 진입 기록(`sync`)이 아니다(G5 시험 — 2단계가 남긴 것, 결과가 바뀌어 처음 드러났다).

**기존 시험을 고친 것** (전제가 3단계로 바뀐 것만 — 문턱을 낮춘 것은 없다):
- crews: 공기 문턱 45초 → 한 통의 50%(`AIR_IN_FRAC`), 팀장의 짝은 혼자 서는 기관원이라 위험 실내 일에는 진입대원과 짝을 맺어 두고 본다, 교체 후보 0.7(60초~50% 구간), 공기 잔량 경고에 교본의 30%·50% 신고를 센다.
- methods: 방법 표 62줄·켜진 줄에 feel·pulse, 공기 50% 아래 관창수는 외부 방어로 맡는다(F03b), 한 통을 100초로 둔 장면(55초가 문턱 위), 테이저 기록 교대 A21·보트 구조 교대 S12·유압 개방 교대 D5 를 더함(결과가 옮겨 갔다 — 전례처럼 시드를 더한다).
- kinds2: N9 다섯 줄은 붙어서 같은 순서로(그 뒤에 R3 의 두 줄). catastrophe: 손으로 세운 대원에게 짝을 붙인다(`withMate`), 지휘관이 그 방을 직접 보지 않는 장면을 고른다. causality: 다섯 문구가 다 나오는 교대 S7 → S1. combatfx: 폭파 진입(charge)도 창을 깨는 폭발로 센다.

**측정** (보통 60교대 — 34d30a3 대비, `--scen --methods --doctrine`):

| | 34d30a3 | 3단계 끝(ba465ab) |
|---|---|---|
| 성공률(60교대) | 665/849 (78.3%) | 617/845 (73.0%) — −5.3%p |
| 한계 시간 + 방치 | 1 + 3 | 11 + 1 |
| 화재 성공 | 114/175 (65.1%) | 89/173 (51.4%) — −13.7%p |
| 가스 누출 성공 | 50/62 (80.6%) | 41/63 (65.1%) — −15.5%p |
| 붕괴 · 수난 · 무장 | 50/69 · 29/37 · 99/131 | 50/70 · 24/35 · 97/129 |
| 대원 부상/교대 | 0.183 (순직 0) | 0.267 (순직 0) |
| 교본 줄 쓰임 · split | 26줄 중 15 · 0.367 | 50줄 중 36 (소방 18/21) · 0.41 |
| 강제 fire/std 20교대(그 시나리오) | 69건 성공 37 · 한계 0 · 264초 · 대원 부상 0.1/교대 | 66건 성공 26 · 한계 4 · 333초 · 0.35/교대 |
| 강제 fire/arson | 44건 성공 23 · 한계 1 | 42건 성공 23 · 한계 1 |
| 강제 collapse/std · hazmat/std · water/std | 26/37 · 35/43 · 21/30 | 26/37 · 33/43(한계 2) · 22/30 |
| 최소 인원(3,3,3,3,3,1) · 장비 1(3,3,3,1,3,3) 20교대 전체 성공 | 51% · 63% | 47% · 47% |

교본 줄 횟수(60교대): F04 5880 · G08 2562 · F16 1186 · F05 937 · P17 676 · F07 648 · CF1 283 · CF4 138 · F02 114 · F14 83 · F08 77 · CF7 65 · D4 10 · F09 8 · CF5 5 · F06 4 · CF6 3 · CF3 1 · F03 1 · F13 1 · D5 2. 쓰이지 않은 소방 줄: F01(평소 교대에 공기 30% 아래로 떨어지는 일이 드물다 — 장면 시험 2-f·7 이 쓴다)·F12·F03b·F04b·F04c·F05b(기록 전용이거나 배율 — 기록이 남지 않는 줄)·CF2.
`sweep 40 --check` 통과. `npm run check` 는 시험 하나가 깨진 채다(아래 남은 것).

**범위** (§8.2): **범위 밖이다.** 화재 −13.7%p(범위 −6~+3), 가스 누출 −15.5%p(±5), 수난 −9.4%p, 전체 −5.3%p(±3), 한계 시간 + 방치 12(기준 + 2 = 6 이하), 대원 부상은 늘었다(목표는 강제 fire/std 에서 −10%). §8.4 손잡이 1 을 셋 다 돌렸다(첫째·둘째는 남기고, 셋째는 효과 0 이라 되돌림). 측정으로 찾은 원인: 짝 규칙(F04·F04c·G08) 하나가 강제 fire/std 의 소화 시각을 +45~67초, 밖 대기조(F05·F05b — 둘이 함께일 때만 효과)가 +27~49초 늦춘다(16교대 이정표 — 기준 164초 → 263초). 펌프차 넷 가운데 둘(진압 팀장·기관원)이 밖에 남고 안의 둘이 한 몸처럼 움직이므로 실내의 일손이 절반 가까이 된다(본문 §8.1 의 "어려워지는 쪽"이 예상보다 크다). 손잡이 밖에서 한 것(위 2·3·4·6)은 그 몫을 줄였지만 범위 안으로 들이지 못했다. 다음 손잡이 후보(본문에 없음 — 정하지 않았다): ① 혼자 서는 기관원·사다리 조작원을 밖 대기조로 붙잡아 두는 대신 짝 없는 실내 진압을 허락하지 않기 ② 짝 동행이 짝의 일을 "함께 하는" 것으로(작업판의 둘째 자리) 바꾸기 ③ F05 의 대기조를 같은 사건의 소방 부대 전체에서 세기.

**남은 것**:
- `tests/sim.test.ts` "인근 도시 지원" 의 `goneHome > aided × 0.5`(빈도 5·부대 규모 1 의 10교대): 기준 15/20 → 9/20. 화재가 길어져 지원 부대가 교대가 끝날 때까지 현장에 남는다(균형의 문제 — 시험 문턱은 고치지 않았다).
- 균형(위 범위).
- 화면(§7 — 상태 칩의 짝·공기, 짝 끈)은 이 단계의 몫이 아니라 하지 않았다. `npm run ui-check` 는 돌리지 않았다(화면을 고치지 않았다).
- 보고서 문장의 F04c·F05 의 `{n}` 은 기다린 초의 합이다(본문의 예와 같다) — 장면 시험만 본다.
### 단계 4 (의료) — 2026-11-16, 나란히 실행

**상태: 구현됨, 결과 바뀜(의도 — 의료 교본).** 작업자 브랜치 `wf/doctrine-e4`, 시작점 `34d30a3`(주 브랜치 — R3 단계 0·1·2 까지). 사용자 요청으로 3(소방)·4(의료)·5(특수)를 같은 시작점에서 작업자 셋이 나란히 했다 — 이 절은 의료만이다. 합치는 작업자가 셋을 합쳐 전체 균형을 다시 잰다. 측정의 "전"은 `34d30a3` 를 `git archive` 로 푼 사본(scratchpad `wf-doctrine/par/medical/b34/`, 결과 `base/`), "뒤"는 `m2/`(대본 `par/medical/run.sh <뿌리> <출력>` — 보통 60 `--scen --methods --doctrine` 과 강제 20교대 다섯: `medical/arrest`·`medical/trauma`·`traffic/bus`·`traffic/std`·`traffic/pileup`, 쓰인 줄 합계 `par/medical/usage.cjs <출력>`).

| 커밋 | 내용 |
|---|---|
| `7f3295b` | 단계 4 의 코드와 시험 2-g 일곱 — 분류·E05·E08·E12·CE2·E 줄 열하나·CE1~CE5 |
| `db26661` | E04 장면 시험, R2 방법 시험 둘을 의료 교본에 맞춤 |
| `32b72ee` | 분류 중인 구급 대원은 곁의 환자 일로 스스로 옮기지 않는다 (brain 자체 판단 한 줄) |
| 그다음 커밋 | 이 메모 |

#### 실제 이름 (단계 4 에 생긴 것)

| 이름 | 어디 | 서명·뜻 |
|---|---|---|
| `WorkKind 'triage'` | `types.ts` (WorkKind 끝의 새 줄) | 다수 사상자 분류. `workLabel` '다수 사상자 분류', `phaseOf` 는 단계 0 부터 'care' |
| `triageMedic(sim, rid)` | `field/doctrine.ts` 끝 | 분류를 맡을 수 있는 대원 = 구급 분야이고 걸을 수 있는 다친 대원(`status 'injured'`)이 아님. `agents.fitFor` 의 `case 'triage'`(안전 확보 전의 무장 현장이면 0, 값은 처치와 같은 식)와 지휘 CE1 이 같은 함수를 쓴다 |
| `DocSit.tendCas`·`medics`·`alsOn` | `doctrine/registry.ts` (DocSit 끝) · `doctrine.ts docSit` | 동료의 겉: 처치 임무로 곁에 앉아 손을 쓰는(`ring > 0`) 다른 활동 구급 대원의 대상 환자 · 다른 활동 구급 대원 수 · 다른 활동 1급 응급구조사·의사가 있는가(명부의 역할) |
| `TRIAGE {stand 2, reach 1.4, cap 90}` · `runTriage(sim, s, a, t, k)` | `field/doctrineRun.ts` 끝의 "(4단계) 의료" 절 | 분류의 실행 — 아래 |
| `HANDOVER_R`(1.5) · `tryHandover(sim, s, a, t, c, k)` | 같은 절 | CE2 의 손 떼기 (실행기 `case 'treat'` 의 비구급 대원) |
| `careMark(sim, s, a, t, c)` | 같은 절 | E05 의 기록 — 그 현장에서 처음 한 번 |
| `laneHold(sim, s, a, t, c, k)` · `carryHold(sim, s, a, t, sense)` | 같은 절 | 판단 지점 `laneTreat`(E12)·`carryHold`(E08) — 기다림은 단계 2 의 `gateStep` |
| `handoverCare(sim, s, I, a, taken)` | `field/commander.ts` (`assign` 바로 다음, `assign` 의 끝에서 부른다) | CE2 의 지시 |
| `TRIAGE_AT`(4) · `TRIAGE_HOLD_MAX`(60) · `AIR_EVAC_ETA`(100) | `field/orders/doctrine.ts` 끝의 "(4단계) 의료" 절 (둘째 `registerOrders`) | CE1·CE3·CE4 |
| `cmdHandover(sim, s, I, cmd, cands)` · `setCommander(…): number` | `field/sceneManager.ts` (파일 끝 · 4번 블록이 부른다) | CE5. `setCommander` 가 승계 기록 id 를 돌려주게 했다 |

#### 등록한 줄 (의료 열하나 — `doctrine/ems.ts`, 등록 순서 그대로) · 지휘 줄 다섯 (`CMD_ROWS`)

| id | 자리 | who · 장비 | when (요약) | effect | rank | why |
|---|---|---|---|---|---|---|
| E01 | fit `triage` | — | 분류 작업이 있을 때 | +.3 1급 응급구조사 · +.2 응급구조사 · +.1 의사 | 2 | triage |
| E02 | method `treat` · stay | 제세동기 | 대상 믿음 위중 · 거동 불가(`mob ≠ mobile`) | stay ×1.3 | 3 | kit |
| E03 | method `treat` · rush | 제세동기 없음 | 대상 믿음 위중 | rush ×1.5 | 3 | noKit |
| E04 | method `treat` · stay·rush | 의사·항공 간호사 · 의사 장비·전문 가방 | 대상 믿음 위중 | stay ×1.3 · rush ×.7 | 3 | kit |
| E05 | fit `treat` | 구급 분야 | 안전 확보 전 · 대상 믿음 안전 구역 | 기록 전용 ×1 | 2 | protocol |
| E08 | gate `carryHold` (carry) | — | 구급 동료가 그 환자를 처치 중(`sit.tendCas`) · 감각 연기·열 ≤ .3 · 위험 실내 아님 · 대상 구역 X6 단계 < 2 | block 15초 | 2 | protocol |
| E11 | fit (가벼운 일 일곱) | doc ems | 중상 신고 · 현장에 다른 구급 대원(`sit.medics > 0`) | 안전 구역 밖 처치 ×.5 · 가벼운 일(`c.light`) +.2 | 1 | hurt |
| E12 | gate `laneTreat` (treat) | — | 대상 믿음이 차로 줄 위·현장 · 그 차로의 통제를 모른다 · 차 안 고립(구출 전)이 아님 | block 20초 | 1 | danger |
| E18 | fit `treat` | 구급 분야 | 대상 믿음 위중 · 지구력 < 30 | ×.3 | 2 | tired |
| E19 | fit `treat`·`load`·`carry` | 응급구조사 | 신입(경험 < .3) · 현장에 1급 응급구조사·의사(`sit.alsOn`) | 위중 처치 ×.6 · load·carry +.1 | 3 | protocol |
| E20 | fit `treat` | 구급 분야 | 동요 신고 · 안전 확보 전 · 대상 믿음 안전 구역 | ×0 | 1 | shaken |

지휘 줄(`CMD_ROWS`, 분야 ems): CE1 '분류 먼저' · CE2 '처치 넘겨받기' · CE3 '위중 먼저 탑승' · CE4 '항공 이송 요청' · CE5 '지휘 넘김'. `DOC_DEPTS_DONE` 에 `'ems'` — 시험 8 이 의료 16줄(개인 11 + 지휘 5)을 본다(E13·E14 는 6단계).

#### 걸리는 자리 (단계 4)

- **분류**(CE1·E01): 지휘 규칙(orders/doctrine.ts 둘째 `registerOrders`)이 지휘관 믿음 속 기다리는 환자(band ≥ 1, 현장·안전 구역) 4명 이상 — 또는 관제의 위험에 '다수 사상자'가 있고 2명 이상 — 이고 분류를 맡을 구급 대원(`triageMedic`, 철수·이송 지시가 선 부대 빼고)이 현장에 있고 안전 확보 전의 무장 현장이 아니며 `s.triageAt < 0` 이면 `want('triage', {}, 0.92, 1)`(처음 만들 때 CE1 기록). 맡을 사람이 없어지면(또는 무장 현장이 안전 확보 전이 되면) 열린 분류를 `cancel`. 분류가 열려 있는 동안(만든 지 60초까지) 열린·담당 없는 band 1 `treat` 작업의 `holdUntil` 을 1.5초씩 민다(거두지 않는다 — 다음 계획 주기에 다시 민다). 실행(`runTriage`): 분류 진행은 **작업판의 작업에 매단다**(본 환자 목록 — 분류하던 대원이 자기 구급차로 떠나 다른 대원이 이어받아도 다시 보지 않는다). 그 대원의 믿음 속 다음 환자(숨지지 않았고 현장·안전 구역, 물속·위험 건물 실내의 현장 환자 빼고 — 가까운 순)에게 1.4칸까지 가서 2초 → `casFact` 를 소리 없이 강제 보고(`a.quiet` + `learn(…, true, true)`) — 더 볼 사람이 없거나 작업을 만든 지 90초면 `s.triageAt = sim.t`, '분류 완료: 위중 n · 중상 m · 경상 k.', 작업 `done`. 시작 문구는 E01 의 note('다수 사상자 — 먼저 분류합니다.', 같은 대원 20초에 한 번).
- **처치 넘겨받기**(CE2): `assign` 끝의 `handoverCare` — 담당자가 모두 비구급인 `active` 처치 작업에 손이 빈(임무·지시 없음, 업지 않음, 다치지 않음, 철수 지시 없음, 지휘관 아님) 구급 대원 가운데 `fitFor` 가 가장 큰 사람을 담당자에 더하고(작업의 `max` 를 잠깐 넘긴다) '{이름}, {작업} 넘겨받아라.' — CE2 기록(그 지시 기록 id). 비구급 대원은 실행기 `case 'treat'` 에서 그 작업을 맡은 구급 대원이 환자에게서 1.5칸 안이면 '구조 대상 X 처치를 Y 대원에게 넘깁니다.'(imp 0)와 `finishTask(…, false, 'handover')`(단계 0 의 사유 표 그대로 — 실패 기록·`w.fails`·`holdUntil` 없음).
- **판단 지점**: 실행기 `case 'treat'` 의 이동 앞에 `laneHold`(E12 — 차로 줄 위·통제 모름이면 그 환자 칸의 위·아래로 차로 줄이 아닌 첫 칸에서 기다림, 상한 20초 뒤 '더 기다릴 수 없습니다 — 그 자리에서 처치합니다.'), `case 'carry'` 의 들기 직전에 `carryHold`(E08 — 환자 곁에서 기다림, 상한 15초 뒤 든다). 둘 다 단계 2 의 `gateStep`(처음 막힐 때 note 한 번·기록·상한·통과 기억).
- **경계 밖 처치소**(E05): `agents.fitFor` 의 `case 'treat'` 첫 줄 — 안전 확보 전의 무장 현장에서 비경찰은 0 이던 것을 "믿음 속 그 환자가 안전 구역이 아니면 0"으로(교본은 0 을 열 수 없어 기본 규칙을 고쳤다 — §2.6·§11.1). 기록은 실행기 `case 'treat'` 가 환자 곁에 닿은 틱에 `careMark`(그 사건에 E05 기록이 없을 때만 — note 와 함께 `hook 'fit'`).
- **자리 하나**(CE3): 현장 부대의 남은 자리(`gear.seatsLeft` − 그 부대에 낸 탑승·후송 지시)가 0 이고, 아무도 손대지 않은 탑승 지시의 환자보다 믿음 속 더 위중한 환자가 안전 구역에서 탑승 지시 없이 기다리면 → 그 지시를 거두고 같은 부대로 더 위중한 쪽 탑승(우선도 +0.1), '자리 하나 — {작업} 먼저.'(지휘관 기록) · CE3 기록.
- **항공 이송 검토**(CE4): 믿음 속 위중 환자(현장·안전 구역·이송 중) + 현장 남은 자리 0 + 오는 구급 부대(구급 능력 0.7 이상, 출동 중)의 가장 이른 `estArrive − t` > 100초(없으면 무한) → `request('ems', '위중 환자 — 항공 이송 검토', true)`, 기록 id 가 0 이상일 때만 CE4.
- **이송 전 지휘 넘김**(CE5): `sceneManager` 4번 블록 — 지휘관이 활동 중인데 자기 부대에 `boardOrder` 가 섰으면 그런 지시가 선 부대의 대원을 뺀(유관 기관도 빼고) 후보에게 지금의 승계 순서(주관 부서 → 경험 → rid)로 넘긴다(`cmdHandover` — 믿음을 넘기고 '{옛} → {새}: 지휘 넘김 — {호출부호} 이송 출발. {새} 지휘권 인수.', 철수 지시면 '철수'). 후보가 없으면 넘기지 않는다(떠난 뒤 지금 경로).
- **brain**: 분류 중인 대원은 곁의 일로 스스로 옮기지 않는다(자체 판단 반복의 `waterRescue` 다음 한 줄) — 분류하며 늘 환자 곁을 지나므로 '곁의 일'(+0.25)이 분류 계속 점수(0.948)를 판단 오차로 넘어 분류가 대원 사이를 돌았다(열차 탈선 S17 #10 — 세 대원이 차례로 맡다 끊겼다 → 한 대원이 34초에 끝낸다).

#### 본문과 다르게 한 곳

1. **분류 자격은 구급 분야만**(§9 표 "fitFor: 구급만"). §6.1 CE1 의 "구급 분야 또는 의료 가방(treatMate 와 같은 자격)"은 쓰지 않았다 — 분류를 내는 조건과 맡는 자격이 어긋나면(항공 구조대원은 맡지 못하는데 분류는 열림) 맡을 사람 없는 분류가 열린 채 종료를 막는다. 두 곳이 `triageMedic` 하나를 쓴다. 안전 확보 전의 무장 현장에서는 분류를 내지 않는다(구급 대원이 현장 안에 들어가지 않는다).
2. **band 1 미루기는 거두기가 아니라 `holdUntil`** 이고 **분류를 만든 지 60초까지**(`TRIAGE_HOLD_MAX`) — 본문은 "분류 전에는 band 1 의 treat 를 내지 않는다". 지휘 규칙은 핵심 규칙(`syncBoard`) 뒤에 돌아 내지 않게 하려면 매 주기 새 작업을 만들고 거두게 된다. 상한은 분류를 맡을 구급 대원이 위중 처치에 매여 분류가 오래 열린 채일 때 중상 환자를 끝없이 미루지 않게(모든 사건은 끝난다).
3. **분류의 진행은 작업에 매달고 상한은 작업을 만든 때부터 90초**(본문에 없음). 구급차가 이송을 떠나면 분류하던 대원도 떠나 다른 대원이 이어받는다 — 대원마다 처음부터 다시 보면 분류가 끝나지 않았다(버스 사고 S3 #10). 분류는 믿음 속 **모든** 환자(경상 포함 — '경상 k')를 보고, 물속·위험 건물 실내의 현장 환자는 건너뛴다(E07 — 소방이 데려온다). 강제 보고는 소리 없이(무전 문구는 끝의 한 줄).
4. **E01 의 "또는 관제 이름표가 다수 사상자 시나리오"** 는 관제 평가의 위험 문자열('다수 사상자 — 구급 부대가 여러 대 필요', `analyst` 가 신고 인원 6명 이상에서 넣는다)이 있고 믿음 속 기다리는 환자가 2명 이상일 때로 했다(이름표에는 다수 사상자 표시가 없다).
5. **E08 의 '처치 중'** 은 동료의 겉으로 "처치 임무이고 곁에 앉아 손을 쓰는 중(`ring > 0` — 실행기가 환자 곁에 닿은 뒤에만 채운다)"이다(`DocSit.tendCas`). 처치하러 걸어가는 중인 동료는 세지 않는다.
6. **E12** — 차로 줄과 통제 지점의 짝은 현장의 생김새(`hazards.tickLane` 과 같은 짝: 줄 0 은 통제 지점 1, 줄 1 은 0)로 줄 파일이 본다. 예외는 §3.6 의 `!(차 안에 갇힘 && 구출 전)` 그대로(§3.3 의 "통제 뒤 그 자리에서"와 다르다 — 3.6 이 맞다). 기다리는 자리는 차로 줄이 아닌 곁 칸(본문은 '환자 곁').
7. **CE2 는 `assign` 의 1·2차 반복 밖, 끝의 따로 된 함수**(본문: "pass 1 의 '빈 자리만' 조건에 이 경우만 예외") — 구출 교대(`RELIEF_GAP`)와 같은 모양이다. 지휘관 자신·지시를 받아 둔 대원은 넘겨받지 않는다. 넘겨받는 거리는 구급 대원과 환자 사이.
8. **CE3** 는 아무도 손대지 않은 탑승 지시를 바꿔 끼운다(본문: 높은 쪽 우선도 +0.1, 낮은 쪽 `holdUntil` 10초) — 지금 코드는 자리가 남을 때만 탑승 지시를 내므로 자리 하나에 둘이 기다리면 낮은 쪽에 이미 지시가 나가 있다. 남은 자리는 `gear.seatsLeft`(실린 구조 대상만 — 함께 탄 다친 대원·용의자는 세지 않는다)에서 낸 탑승·후송 지시를 뺀다 — 다친 대원·용의자의 후송(`treatMate`·`treatSuspect` 의 차)이 맡아 둔 자리는 바꿔 끼우지 않는다.
9. **CE4** 는 현장에 부대가 하나도 없으면 걸지 않는다(그때는 핵심 규칙의 '구급 부대 없음' 요청). 기록 문구는 요청 무전(`commander.request` — 70초 안의 같은 능력은 버린다).
10. **CE5 의 문구**는 '{옛} → {새}: 지휘 넘김 — {호출부호} 이송 출발. {새} 지휘권 인수.'(본문 "{name}, 지휘 넘긴다 — 이송 출발. {new} 지휘권 인수." 의 뜻 — 시험이 '지휘 넘김'을 센다). `setCommander` 가 기록 id 를 돌려주게 했다.
11. **E05 의 기록**은 `assign` 의 1등 비교가 아니라(배율 1 이라 1등이 바뀌지 않는다) 실행기 `case 'treat'` 가 안전 구역의 환자 곁에 닿은 그 틱(`careMark` — 사건마다 한 번, `hook 'fit'`).
12. **E04 는 위중하지만 걸을 수 있는 환자에게서만 기록된다**: E02(제세동기·거동 불가)·E03(제세동기 없음)과 같은 rank 3 이고 등록 순서가 앞이라, 둘 가운데 하나가 걸리면 방법의 1등을 바꾼 줄로 그쪽이 적힌다(배율은 셋 다 곱한다). 측정 묶음에서 0회 — 장면 시험이 쓴다.
13. **E11 의 short** 는 '부상 — 안전 구역 처치'(G01 의 '가벼운 임무'와 가른다). E18·E20·E05 의 who 는 `dept: ['ems']`, E11 은 `doc: ['ems']`(부상 줄 넷의 `who.doc` 가 겹치지 않는다 — 시험 8).
14. **brain 한 줄**(위 "걸리는 자리")은 본문 §11.1 의 brain 칸에 없다.
15. **`DOC_DEPTS_DONE` 에 'ems' 를 파일 끝의 `push` 로** 더했다(배열 글자를 고치지 않았다 — 나란히 실행).

#### 설계서 밖에서 고친 공용 파일 (합칠 때 — 파일·함수·자리)

- `types.ts` — `WorkKind` 합집합의 마지막 줄 `| 'decontam';` 의 `;` 를 지우고 그 뒤에 `| 'triage';` 새 줄.
- `field/agents.ts` — `workLabel` 의 `names` 글자 끝(decontam 다음)에 `triage`, `fitBase` 의 `case 'treat'` 첫 줄(E05), `fitBase` 의 switch 끝(decontam 다음)에 `case 'triage'`, 파일 끝 import 묶음의 `docFit` 줄 다음에 `import { triageMedic } from './doctrine';`.
- `field/doctrine.ts` — `docSit` 의 `return {` 바로 앞 블록과 반환 글자 끝의 `tendCas, medics, alsOn,`, 파일 끝의 `triageMedic`.
- `field/doctrine/registry.ts` — `DocSit` 끝 세 칸, 파일 끝 `DOC_DEPTS_DONE.push('ems')`.
- `field/doctrineRun.ts` — 파일 끝 "(4단계) 의료" 절(import 여섯 줄 포함 — `casFact`·`staticPass/tileOf`·`TYPE_DEFS`·`docGate`·타입 `CasBelief/Casualty`·`Sense`).
- `field/executor.ts` — `case 'treat'` 의 `if (c.where === 'carried') return;` 다음 두 줄(`tryHandover`·`laneHold`)과 `if (m !== 'arrived') return;` 다음 한 줄(`careMark`), `case 'carry'` 의 들기 앞 한 줄(`carryHold`), `case 'rearm'` 다음 `case 'triage'`, 파일 끝 import 두 줄.
- `field/commander.ts` — `assign` 의 마지막(구출 교대 반복 뒤)에 `handoverCare(sim, s, I, a, taken);` 와 그 함수.
- `field/orders/doctrine.ts` — 파일 끝 "(4단계) 의료" 절(둘째 `registerOrders` + import 다섯 줄). **시험 2-d 의 `orders()` 도우미가 `ORDER_RULES` 의 마지막을 경찰 규칙으로 보던 것을 `ORDER_RULES.find((r) => String(r).includes('CP2'))` 로 바꿨다** — 같은 파일에 뒤 단계가 지휘 규칙을 더하면 마지막이 바뀐다(소방·특수도 같은 일을 겪는다 — 합칠 때 하나로).
- `field/sceneManager.ts` — `setCommander` 의 반환형 `number`(마지막 줄 `return emit(…)`), 4번 블록의 `leaving` 한 줄·`cands` 거르기 조각·`if (leaving && …) cmdHandover … else if (!leaving && cands.length)`, 파일 끝 `cmdHandover` 와 import 한 줄.
- `field/brain.ts` — 자체 판단 반복의 `if (!free && cur!.kind === 'waterRescue') continue;` 다음 한 줄.
- `tests/doctrine.test.ts` — 시험 5 '단계 2' 묶음의 여섯 줄(DOCTRINE·CMD_ROWS·DOC_DEPTS_DONE·d.rule·d.gate·gateId·triageAt·report.doctrine)과 순수 함수 시험의 `DOCTRINE` 비교 한 줄이 파일 끝의 `LATER_RULES`·`LATER_CMD`·`LATER_GATES`·`LATER_DEPTS` 를 빼고 본다(3·4·5 가 같은 줄을 고치므로 합칠 때 목록만 합친다), 위의 `orders()` 도우미 한 줄, 파일 끝 "단계 4 (의료)" 절(시험 2-g 여덟).
- `tests/methods.test.ts` — R2 '즉시 이송: 3초 최소 처치…' 시험의 1급 응급구조사에게서 제세동기를 뺐다(E02 가 제세동기를 든 대원의 위중·거동 불가 환자를 현장 소생으로 바꾼다 — 즉시 이송의 실행을 보는 시험이라 E03 쪽 대원으로). R2 '무장 강제(…)' 시험의 표본에 `['A6', 'armed/domestic']` 를 더했다 — 의료 교본이 배경 사건의 부대 배치를 바꿔 A2 의 가정 폭력 테이저 검거(표본의 유일한 테이저)가 맨손 제압으로 바뀌었다(기준 "4가지 이상·테이저·비살상탄" 그대로).

#### 수치 (기준 `34d30a3`(`base/`) → 단계 4 `32b72ee`(`m2/`), 같은 명령)

| 묶음 | 기준 | 단계 4 | §8.2 |
|---|---|---|---|
| 보통 60 — 성공 · 부분 · 지연 · 미해결 · 실패 (849건) | 665 · 87 · 33 · 13 · 51 | 657 · 95 · 32 · 16 · 49 | |
| 보통 60 — 성공률 · 성공+지연 · 실패+미해결 | 78.3 · 82.2 · 7.5% | 77.4 · 81.2 · 7.7% | 성공률 ±3%p ✓ |
| 보통 60 — 한계 시간 · 방치 | 1 · 3 | 2 · 3 (늘어난 하나는 화재 `fire/std`) | + 2 이하 ✓ |
| 보통 60 — 유형별 성공 | 화재 114 · 무장 99 · 응급 93 · 교통 134 · 붕괴 50 · 가스 50 · 실종 96 · 수난 29 | 111 · 97 · 95 · 129 · 52 · 49 · 96 · 28 | 교통 −3.1%p · 화재 −1.7%p · 응급 +1.8%p ✓ |
| 보통 60 — **응급 대응 지연** (응급 113건) | 14 (12.4%) | **14 (12.4%)** — 실패 6 → 4 | 늘지 않는다 ✓ |
| 보통 60 — 구조 대상 구조 · 사망 · 못 찾음 (1873명) | 1739 · 122 · 11 | 1742 · 118 · 12 | |
| 보통 60 — 다친 대원/교대 · 평균 대응 | 0.183 · 49초 | 0.200 · 49초 | (부상 목표는 경찰·소방 묶음) |
| 보통 60 — 행동 엔트로피 · 방법 엔트로피 · 교착 후보 · 잊힌 사건 · 반복 최대 | 2.51 · 0.57 · 0 · 0 · 6 | 2.51 · 0.58 · 0 · 0 · 7 | ✓ (반복 7 은 열차 탈선의 '유압 구조기가 없습니다' — 의료 줄과 무관한 경로 차이) |
| 보통 60 — 교본 | 경찰·공통만 | 의료 쓰인 줄 E08 244 · E02 239 · CE2 192 · CE4 97 · CE5 93 · E19 56 · CE1 54 · E05 33 · CE3 17 · E03 11 · E11 4 · E18 3 · E01 2 · E12 2, 판단 지점 평균 3.3초(130건) → 4.8초(371건), split 0.367 → 0.413 | split ≥ 0.5 는 8단계 |

**강제 20교대**(그 시나리오 줄: 건수 · 성공 · 부분 · 지연 · 미해결 · 실패 — 교대 전체의 닫힌 까닭과 다친 대원/교대):

| 묶음 | 기준 | 단계 4 |
|---|---|---|
| `medical/arrest` (27) | 22 · 0 · 2 · 0 · 3 · timeout 1 · 다친 대원 0.10 | 22 · 0 · 2 · 0 · 3 · timeout 3(배경 사건) · 0.10 |
| `medical/trauma` (43) | 35 · 0 · 4 · 0 · 4 · timeout 2 · 0.10 | 34 · 0 · 6 · 0 · 3 · timeout 0 · 0.10 |
| `traffic/bus` (26) | 20 · 5 · 1 · 0 · 0 · timeout 2 · 0.25 | 19 · 6 · 1 · 0 · 0 · timeout 3 · 0.20 |
| `traffic/std` (57) | 44 · 10 · 1 · 0 · 2 · 0 · 0.20 | 44 · 10 · 1 · 0 · 2 · 0 · 0.10 |
| `traffic/pileup` (22) | 13 · 4 · 4 · 0 · 1 · 0 · 0.55 | 13 · 4 · 3 · 0 · 2 · timeout 1 + shiftend 1 · 0.60 |
| 여섯 묶음(보통 60 + 강제 다섯)의 응급 사건 대응 지연 | 46 / 338 (13.6%) | 47 / 338 (13.9%) — 보통 60 은 같고, 강제 `medical/trauma` 줄에서 +2·다른 묶음의 배경 응급에서 −1 |

강제 묶음의 시나리오 줄은 모두 한계 시간·방치·무대응 0 이다(늘어난 timeout·shiftend 는 배경 사건 — `traffic/pileup` S0 #06 버스 추돌은 구급차가 모자라 마지막 두 환자를 싣지 못한 한계 시간, S17 #16 은 X6 붕괴가 겹친 화재가 교대 상한에 잘렸다. 둘 다 기록을 읽었다 — 분류·처치 대기가 막은 것이 아니다).

**측정 묶음의 의료 줄 쓰임**(보통 60 + 강제 다섯 — `usage.cjs m2`): **14 / 16 (88%)** — E08 830 · E02 733 · CE2 545 · CE4 307 · CE5 281 · CE1 235 · E19 212 · CE3 83 · E05 65 · E03 27 · E11 14 · E01 9 · E12 7 · E18 3. 쓰이지 않은 둘(E04·E20)은 장면 시험이 쓴다(시험 2-g 의 E05·E20 묶음, E04 묶음) — 측정 ∪ 시험 = 16/16.

**교대당 시간**(`sweep 20`, 기준·단계 4 를 번갈아 두 번, 부하 평균 4~6): 기준 940 · 931ms(사용자 CPU 34.7 · 34.9초), 단계 4 987 · 1044ms(37.1 · 35.8초) — 사용자 CPU **1.05배**(벽시계 1.09배 — 부하가 재는 동안 4 → 6 으로 올랐다). 단계 4 가 더한 몫은 `docSit` 의 구급 동료 훑기와 지휘 규칙의 작업판 훑기다.

관문: `npm run check` — 시험 파일 19 가운데 18 통과, `tests/sim.test.ts` '프리셋이 어려워질수록 …' 하나가 **시간 초과로만** 실패했다(180초 예산에 215초 — 같은 기계에서 소방·특수 작업자의 관문이 함께 돌아 부하 평균 13~27). 그 시험만 다시 돌려 **통과**(96초), `sweep 40 --check` 를 따로 돌려 **검증 통과**(성공 75% · 부분 11% · 지연 5% · 미해결 2% · 실패 7%, 닫힌 까닭 resolved 564 · abandoned 2 · timeout 1, 교착 후보 0 · 잊힌 사건 0 · C1~C5 0 · 계산 오류 0). `tests/doctrine.test.ts` 57개(단독 25초 안팎). 메모 커밋 뒤(코드는 `32b72ee` 와 같다) `npm run check` 를 한 번 더 돌려 **처음부터 끝까지 통과**했다 — 시험 파일 19 · 832 통과 + 건너뜀 1(시작점 824 + 이 단계 8), `sweep 40 --check` '검증 통과', 벽시계 10분 5초.

#### 알려진 문제

- **방법이 현장 소생 쪽으로 기운다**: E02(제세동기 · 위중 · 거동 불가 → 현장 소생 ×1.3)가 R2 의 즉시 이송(조건일 때 0.9 > 현장 안정 0.8)을 대부분 뒤집는다 — 보통 60 의 처치 표본 stay 662 · rush 365 → stay 987 · rush 129. 방법 엔트로피는 0.57 → 0.58 로 그대로지만 처치 안의 갈래는 줄었다. 위중 환자의 현장 시간이 늘어 탑승이 늦는 쪽이다(응급 실패 6 → 4 · 구조 1739 → 1742 로 결과는 나쁘지 않았다).
- **CE4(항공 이송 검토 요청)가 잦다** — 보통 60 에 97번. 구급차가 모자란 다수 사상자 현장에서 자리 0 · 오는 구급차가 멀 때마다 70초에 한 번 급한 구급 요청이 나간다. 요청이 40초 넘게 채워지지 않으면 관제의 `BACKUP_LATE` 가 그 사건을 '대응 지연'으로 만든다(대응 지연 합계는 보통 60 에서 33 → 32 라 지금은 드러나지 않는다). 8단계에서 늘면 CE4 를 "의료 헬기가 뜰 수 있을 때(낮 · 안개 아님)"로 좁힌다.
- **E08(처치 중 들기 보류)이 잦다** — 측정 묶음 830번, 판단 지점 평균이 3.3 → 4.8초로 늘었다. 15초 상한이고 연기·열·위험 실내·X6 단계 2 는 예외라 위험한 곳에서 붙잡지 않는다.
- **분류 지시가 바쁜 구급 대원에게 되풀이된다**: 분류(0.92)는 탑승 지시(0.7 + …)를 하던 대원에게도 나가고(`assign` 의 '0.22 넘게 높아야 빼 온다' 문턱 — 0.7 + 0.22 가 부동소수로 0.9199… 라 0.92 가 넘는다), 환자를 업고 있으면 받지 않아 4.5초 뒤 다른 대원에게 다시 나간다('다수 사상자 분류 맡아라' 가 한 사건에 2~4번). 분류의 진행은 작업에 매달려 있어 끊기지는 않는다.
- 교대 끝의 배경 화재 하나가 교대 상한(`hardCap`)에 잘렸다(`traffic/pileup` S17 #16 — 위 표). 의료 줄이 걸리지 않은 화재 현장이고, 기준에는 같은 시드에서 이 사건이 다른 경로였다.

#### 이어받을 자리

- **6단계**: E13(`carryStart` — 척추 고정, `c.immob`)·E14(`drag`)는 하지 않았다. `case 'carry'` 의 들기 직전에는 이제 `carryHold`(E08) 줄이 있다 — `carryStart` 는 그 다음(들기 시작하는 틱)에.
- **합치기**: 시험 5 의 `LATER_*` 목록(소방·특수의 줄·판단 지점), 시험 2-d 의 `orders()` 도우미, `DOC_DEPTS_DONE`, `orders/doctrine.ts` 끝의 지휘 규칙 순서(경찰 → 다음 단계들 — 등록 순서가 결과를 바꾼다), `DocSit` 끝의 칸, `doctrineRun.ts`·`executor.ts` 끝의 import 절.
- **8단계(균형)**: 아래 알려진 문제의 방법 엔트로피·CE4 의 빈도·E08 의 기다림.
### 단계 5 (특수) — 2026-11-16, 나란히 실행

**상태: 구현됨, 결과 바뀜(의도 — 해체 방법 셋·특수 교본).** 작업자 브랜치 `wf/doctrine-s5`, 시작점 `34d30a3`(단계 2 를 합친 뒤). 소방(3)·의료(4)와 같은 시작점에서 나란히 만들었다 — **S10·S11(화학대의 짝·대기조)은 3단계의 짝 맺기 위에 서므로 넣지 않았다(합치는 작업자 몫)**. 측정의 "전"은 `34d30a3` 의 사본(같은 명령), "뒤"는 `d0821b4` 의 사본이다. `DOC_DEPTS_DONE` 에는 이 단계의 분야만 더했다(`['police', 'special']` — 소방·의료는 합칠 때).

| 커밋 | 내용 |
|---|---|
| `657b170` | 단계 5 의 코드 전부 — 해체 방법 셋·`WORK_MODE`·`fitFor defuse` 의 로봇 자격·맨몸 해체의 방호 끄기·S 줄 열일곱·CS1·CS2·D1·줄 서기·잠긴 방 진입 보류(`forceDoor`)·폭파 진입의 문 여는 사람·의도한 폭발의 동요 끄기 + 시험 8 의 표 |
| `d0821b4` | 맨몸 해체의 '옮길 수 없는 사람' 좁히기 · 시험 2-i 여섯과 장면 시험 여섯 · R1/R2 시험을 해체 방법 셋에 맞춤 |
| `eb0c2a1` | 관문이 찾은 것: 해체 방법 셋을 N9 의 새 방법 다섯 앞으로(`tests/kinds2` 가 그 다섯을 표의 끝으로 본다 — 결과 불변, 보통·폭발물·수상한 물건 각 8교대의 `report.hash` 가 같다) |
| 그다음 커밋 | 이 메모 |

#### 실제 이름 (단계 5 에 생긴 것)

| 이름 | 어디 | 서명·뜻 |
|---|---|---|
| `MethodId 'robotDefuse' \| 'suitDefuse' \| 'bareDefuse'` · `DocGateId 'forceDoor'` | `types.ts` (기존 합집합 끝에 덧붙임) | 해체 방법 셋 · 잠긴 방 문을 여는 판단 지점(S03). `METHOD` 표에서는 N9 의 새 방법 다섯(`dive`…`hoseWash`) **앞**에 둔다 |
| `METHOD.robotDefuse`(0.9 / 위험 0) · `suitDefuse`(0.75 / 0, 평소 방법) · `bareDefuse`(0.5 / **0.15**) · `SAY` 세 줄 · `WORK_MODE.defuse = 'refuse'` | `field/methods.ts` | 장비 칸 `robot` · `bombSuit` · `eodKit`(본문 §3.7 표). `can` 은 모두 "믿음 속 살아 있는 장치"(`bombOf` — 대상 소품의 `haz` 믿음 `kind 'bomb' && active`), 로봇은 그에 더해 부릴 자리가 있을 때 |
| `ROBOT_REACH = 8` · `robotSpot(s, bx, by, ax, ay)` | 같은 파일 (내보냄) | 장치에서 2.5~8칸, 지나갈 수 있고 물이 아니며 벽에 가리지 않는(`losWalls`) 칸 가운데 대원에게 가장 가까운 것(같으면 칸 번호가 작은 쪽). 생김새만 읽는다 — 판단부·실행부가 같이 쓴다 |
| `fitBase` 의 `defuse` | `field/agents.ts` | `(hasKit eodKit ‖ hasKit robot) && methodFit > 0 ? 0.6 + 0.4 × skill : 0` — 로봇 조작 요원은 로봇 원격 해체로만, 다친·동요한 처리 요원(S23)·로봇이 고장 난 조작 요원은 고를 방법이 없어 맡지 않는다 |
| `bombZone(s, a)` · `agentCost` 의 +20 | 같은 파일 | 믿음 속 살아 있는 장치 곁 2칸에서 동료의 해체가 진행 중이거나(또는 자리를 잡은 로봇 원격 해체 `phase ≥ 1`) → 그 장치 둘레 6칸을 지나는 길 +20. 해체·출입 통제·이송·대피 안내·동료 구조 임무면 없다 |
| `DEFUSE = { robotTime 1.6, robotSlip 0.3, bareTime 0.75 }` · `runDefuse(sim, s, I, a, t, k) → 'slip' \| 'done' \| undefined` | `field/doctrineRun.ts` (파일 끝) | 해체의 실행 몸(방법 고르기 `startMethod` → 로봇이면 `robotSpot` 으로 한 번 자리를 잡고 0.5칸까지 가서 처음 쓸 때 `kitWorks(robot)`, 고장이면 `switchMethod('broken')` · 필요 시간 ×1.6 · 실수 ×0.3, R1 의 로봇 수동 효과는 곱하지 않는다 / 손이면 1.6칸 · R1 로봇 수동 효과 그대로 · 맨몸 ×0.75 · 1초마다 S23 자기 검사). 터뜨리기(`rules/crime.detonate`)는 실행기가 한다(`doctrineRun` 이 `rules/` 를 import 하면 규칙 등록 순서가 바뀐다) |
| `armorOf(sim, rid, engaging, bare = false)` · `blastFactor(sim, rid, bare = false)` | `crews.ts` | `bare` 면 방호복(`bombSuit`)을 세지 않는다. 부르는 곳: `injury.protection(…, bare)` ← `hurtResponder`(`a.task.method === 'bareDefuse'`), `hazards.tickHostiles` |
| `blast(…, cause = 'blast', planned = false)` | `field/hazards.ts` | `planned` 면 동요(`shake`)를 걸지 않는다 — `methodRun.detonateCharge` 가 `true` 로 부른다(단계 1 의 알려진 문제 '폭파 진입의 동요'의 결정: 의도한 폭발은 자기 편을 흔들지 않는다. 피해·파손·기록은 그대로) |
| `DocSit.robotOn` · `bombPinned` · `scbaOn` · `DocCtx.wBomb` | `doctrine/registry.ts` · `doctrine.ts` | 현장에 작동하는(알려진 고장이 아닌) 로봇을 든 활동 동료 · 장치 6칸 안에 옮길 수 없는 사람(믿음 — 아래 4번) · 화재 현장의 활동 공기호흡기 대원 수 · 대상 작업의 자리에서 믿음 속 살아 있는 장치까지의 거리. `defusing` 은 자리를 잡은 로봇 원격 해체도 센다 |
| `BOMB_R = 6` · `pinnedNear` · `robotOnScene` · `scbaCount` · `bombDistOfWork` · `CS2_ADD = 0.1` · `swatOnScene(sim, s)` · `cs2Add(sim, b, w)` | `field/doctrine.ts` | CS2: 현장에 특공이 있으면 진입 교전에 방패·진입조 묶음이나 특공 대원(`tacOfficer`) +0.1, 봉쇄에 순찰 부대 경관 +0.1 |
| `cs1(…)` · `CS1_R 6` · `CS1_KEEP` · `CS1_SAID` · `workPos` | `field/orders/doctrine.ts` (기존 등록 블록 끝에서 부른다) | 동료의 해체가 진행 중이면 장치 6칸 안의 열린 일을 거둔다(해체·통제·이송·대피 안내·동료 구조는 남긴다). 알림 '해체 시작 — 반경 6칸 비워라.( 작업 n건 거둠)'은 장치마다 한 번 |
| `D1_HAZMAT = 30` · `D1_SEV = 1.6` | `dispatch/doctrine.ts` | `dispatchPref`: 가스 누출(평가 유형 hazmat)의 구조 수요에 화학 구조차 +30. `docNeeds`: 위험도 1.6 부터 구조 수요 1(전에는 analyst 의 2.1) |
| `S26_AGE 10 · S26_NEAR 4 · S03_WAIT 30 · S03_WAIT_BACKUP 45` | `doctrine/special.ts` (내보냄 — 시험이 읽는다) | 폭파 보류의 믿음 나이·문까지 거리 · 잠긴 방 진입 보류의 상한 |
| `STACK_GAP 0.6` · `STACK_AT`(WeakMap) · `stackTeam` · `OPENER_NEAR 6` | `field/executor.ts` | 줄 서기(S01)와 문 여는 사람 고르기(아래) |

#### 등록한 줄 (특수 열일곱 — `doctrine/special.ts`, 등록 순서 그대로. 번호로 묶으면 열여섯 + 지휘·관제 넷 = 20)

| id | 자리 | who · 장비 | when (요약) | effect | rank | why |
|---|---|---|---|---|---|---|
| S01 | gate `breach` (engage) | 특공 · 방패 | 자기 몸 band 0 · 동요 아님 (그 문 진입조의 방패수에게 묻는다) | choose `stack` | 2 | protocol |
| S02 | fit | — · 저격총 | 무장 현장 | ×.3 engage(결정적 저격 조건이 아니면) · +.1 perimeter | 3 | kit |
| S05 | fit | 경찰 · 섬광탄 | 진입 명령 | +.1 engage | 3 | kit |
| S06 | method `robotDefuse` | — · 로봇 | 살아 있는 장치 | ×1.3 | 3 | kit |
| S06b | fit | 처리 요원 | 살아 있는 장치 · `robotOn` | ×.4 defuse | 3 | kit |
| S07 | method `bareDefuse` | 처리 요원 · 로봇 없음 | — | ×0 (방호복 있음 · 옮길 수 없는 사람 없음) · ×2 (방호복 있음 · 있음) | 0 | danger |
| S08 | fit | — | 살아 있는 장치 · 해체 중 · 대상 작업이 장치 6칸 안 | ×0 (`S08_WORKS` 열넷) | 0 | danger |
| S13 | method `boat`·`swim` | 구조정 | 수난 ‖ 해일 ‖ 물살 ≥ .07 | ×1.3 boat · ×0 swim | 0 | danger |
| S15 | method `swim`·`tend`·`catch` | — | 같은 대상의 `hoist` 작업이 작업판에 열림 | ×.5 swim · ×1.2 tend·catch | 2 | team |
| S19 | fit | 사다리 조작원 | 화재 · 다른 공기호흡기 대원 ≥ 2 | ×.3 search | 3 | protocol |
| S21 | fit | 로봇 조작 요원 · 로봇 없음 | 살아 있는 장치 | +.2 perimeter | 3 | noKit |
| S22 | fit | 특공 팀장 | 무장 | +.15 negotiate(진입 전) · +.1 engage(진입 뒤) | 3 | protocol |
| S23 | method `suitDefuse`·`bareDefuse` | 처리 요원 | band ≥ 1 ‖ 동요 | ×0 · 해체 중이면 `runDefuse` 가 놓는다('손이 떨립니다 — 해체를 넘기겠습니다.', `docRemember w:`) | 1 | hurt |
| S24 | method `sniper` | 저격수 | 동요 ‖ band ≥ 1 | ×0 | 1 | shaken |
| S25 | method `swim` | 수난·구조 묶음 | 지구력 < 30 | ×0 | 1 | tired |
| S26 | method `charge` (force·clear) | 진입대원·처리 요원 · 장약 | 인질을 붙든 용의자의 믿음 ‖ 관제 이름표 '인질극' | ×0 (인질 위치를 모른다 — 아래 2번) · ×1.2 (안다 · 진입 명령) | 0 | hostage |
| S03 | gate `forceDoor` | 경찰 | `hot` · 진입 명령 전 · 교전·검거 임무가 아님 | block 30초(지원 옴 45) | 2 | protocol |

지휘·관제 줄(`CMD_ROWS`): D2(단계 2 그대로) · CS1 · CS2 · D1. 시험 8 이 특수 20줄(≥ 12)을 본다.

#### 걸리는 자리 (단계 5)

- **해체**: 실행기 `case 'defuse'` 는 처리·폭발 여부만 보고 `runDefuse` 를 부른다. 'slip' 이면 '해체 중 장치가 반응했습니다!' 뒤 `detonate`. 끝 문구는 로봇이면 '로봇으로 폭발물 해체 완료. …' / '로봇으로 확인한 결과 폭발물이 아닙니다.'(측정 도구 `PHRASE` 가 읽지 않는 문구 — 고칠 것 없음).
- **줄 서기(S01)**: `executor.breach` 가 문마다 진입조(둘 이상)의 방패수에게 `docGate('breach')` 를 묻고 `stack` 이면 `stackTeam` — 나머지는 방패수에게 가까운 순으로 0.6초 간격(`STACK_AT`)이고 `engage` 의 ①-2 앞에서 '줄 서기'로 기다린다. 진입 문구는 '진입! 방패 선두, 섬광탄을 …' / '진입! 방패 선두로 들어갑니다.'(G5·`combatfx` 가 '진입!' 으로 읽는다).
- **잠긴 방(S03)**: `moveTo` 의 잠긴 문(`kind === 'locked'`) 하위 임무 직전에 `gateStep(…, 'forceDoor')` — 막히면 '잠긴 방 — 진입 보류'로 문 앞에서 기다린다.
- **문 여는 사람(S26)**: `lockedRoomDoor` 의 후보에 그 문으로 오고 있는 진입조(같은 용의자의 교전 · 하위 임무 없음 · 문에서 6칸 안 — `OPENER_NEAR`)를 더했다. 장약을 든 진입대원이 조금 늦게 와도 그 사람이 연다(모인 뒤 25초 상한은 그대로).
- **CS2**: `commander.assign` 의 점수에 `cs2Add`(특공이 현장에 있을 때만), 가산 없이 센 1등(`bestNoCs`)과 다르면 지시 무전 기록 id 로 `CS2`. 적합도 교본의 1등 비교(`scB`)에는 같은 가산을 넣었다(CS2 가 적합도 교본의 기록을 흔들지 않게).
- **S15**: R2 `methods.ts` 의 헤엄 `situ` 에서 "상공 호이스트 ×0.7" 을 지웠다(본문 §3.7 끝 — 이제 S15 하나).

#### 본문과 다르게 한 곳

1. **S03 을 판단 지점 줄로 등록했다**(본문 §3.4 는 "있음(R2)" — R2 의 조용한 개방·진입 순간의 충격기·폭파). R2 의 '폭파 진입 0건' 세 원인 가운데 "진입 전 잠긴 문을 차지 않는다"를 받을 자리가 없어 `forceDoor` 판단 지점을 하나 더했다. 상한 30초(지원 옴 45초) 뒤에는 지금처럼 연다(무한 대기 없음 — '더 기다릴 수 없습니다 — 문을 엽니다.').
2. **S26 의 '인질 위치를 모른다'를 넓혔다**: 본문은 "붙든 용의자의 믿음이 낡았거나 문 곁". 관제의 이름표가 인질극인데 붙든 용의자를 하나도 모르는 경우도 모르는 것으로 본다(그러지 않으면 아직 아무도 못 본 인질극 방을 폭파할 수 있었다 — `when` 에 `hostageLabel`).
3. **`bareDefuse` 의 위험 0.15**(본문 표는 시작값·평소만 적었다 — 0.5 / —). R2 의 위험 칸은 다친 대원이 위험 > 0 인 방법을 고르지 않게 하는 데 쓴다(사용자 결정).
4. **'옮길 수 없는 사람'(S07 · `bombPinned`)은 갇힌 사람과 다쳐(band ≥ 1) 걷지 못하는 사람만**, 그리고 인질을 붙든 활동 용의자. 믿음의 `mob` 은 걷기 전까지 'immobile' 이라 그대로 세면 다치지 않은 시민 곁에서도 방호복을 벗었다(`d0821b4`).
5. **CS1 은 새 `registerOrders` 가 아니라 기존 블록 끝에서 부른다**(시험 2-d(덧붙임)이 `ORDER_RULES` 의 마지막을 시험용 `CommandKit` 으로 부른다 — 새 등록을 끝에 붙이면 그 시험이 CS1 만 부른다).
6. **D1 의 기록은 `docNeeds` 가 남긴다**(관제 수요 1 을 만든 때). `dispatchPref` 의 +30 은 단계 2 의 D2 와 같은 길(가산 전후 1등이 다를 때 `sendUnit` 이 남긴다).
7. **S01 은 그 문 진입조의 방패수 자신에게 묻는다**(자기 모드 — `c.st` 가 그 사람의 몸). 본문은 묻는 사람을 적지 않았다.
8. **자리를 잡은 로봇 원격 해체도 '해체 중'이다**(S08·CS1·`bombZone`). 본문은 "장치 곁의 해체"만 적었다 — 로봇은 8칸 밖에서 하므로 그대로면 반경이 비지 않는다.
9. **문 여는 사람 넓히기(`OPENER_NEAR` 6)**: 본문에 없는 실행기 고침. 장약을 든 사람이 문을 열게 하는 R2 의 남은 원인 하나다.
10. **S08 의 일 목록을 적어 두었다**(`S08_WORKS` — 해체·통제·옮기는 일을 뺀, 장치가 나는 현장에서 생기는 일 열넷). 본문은 "반경 안의 일"이라고만 했다.
11. **S07 의 문구**: 본문의 ② "옮길 수 없는 사람이 곁에 있습니다 — 방호복 없이 바로 해체합니다." 대신 R2 의 시작 문구(`sayStart` — 까닭 'danger' 의 머리말 + `SAY.bareDefuse` '방호복 없이 바로 해체합니다.')를 쓴다. 방호복이 없어서(① — 까닭 `noGear`) 고른 때와 같은 표를 쓰기 위해서다.
12. **해체는 믿음 속 살아 있는 장치에만**(`can` 의 `bombOf`). 전에는 지시를 받으면 진실의 소품 자리로 갔다. 처리반은 도착할 때 지휘관의 믿음을 받으므로 실제 교대에서 "지시가 있는데 장치를 모르는" 틈은 0초였다(scratchpad `tools/gap.mts`, 폭발물·수상한 물건 강제 S1~S8).

#### 설계서 밖에서 고친 공용 파일 (모두 덧붙이기 — 줄을 옮기거나 이름을 바꾸지 않았다)

- `tests/crews.test.ts`(R1): ④ 감시의 '해체 공구 없이 해체'에 "로봇을 든 조작 요원의 로봇 원격 해체(또는 첫 틱)" 예외 · `fitFor` 시험에 장치 믿음·`robotSpot` 전제·로봇을 빼면 0 · ⑤ 해체자 역할에 `robotOp` · 원격 로봇 시험에 처리 요원의 장치 믿음 · 파일 끝에 import 두 줄(`robotSpot`·`docForget`).
- `tests/methods.test.ts`(R2): 방법 63줄 · 평소 방법 목록에 `suitDefuse` · 켜진 줄(`LIVE`)에 해체 셋 · '무장 강제 … 테이저·비살상탄' 표본에 A29 흉기 대치(A2 의 배경 사건 #09 의 테이저 검거가 비살상탄 검거로 바뀌었다. 테이저 검거는 A25~A36 의 흉기·강도 24교대 가운데 9번 — 대부분 배경 사건. 문턱 4가지 이상·테이저·비살상탄은 그대로).
- `tests/doctrine.test.ts`: 단계 목록 `STAGE5`·`CMD5`, 판단 지점 목록에 `forceDoor`, `DOC_DEPTS_DONE` 기대값, 파일 끝의 두 묶음과 import.
- `field/methodRun.ts` `detonateCharge` 의 `blast(…, true)` 한 줄 · `field/injury.ts` `protection` 의 인자 하나.

#### 수치 (기준 `34d30a3` → 단계 5 `d0821b4`, 같은 명령 — scratchpad `wf-doctrine/par/special/base/` · `m2/`. `eb0c2a1` 은 결과가 같다)

| 묶음 | 기준 | 단계 5 | 비고 |
|---|---|---|---|
| 보통 60 — 성공 · 부분 · 지연 · 미해결 · 실패 (849 / 848건) | 665 · 87 · 33 · 13 · 51 | 671 · 82 · 27 · 13 · 55 | 성공률 78.3 → 79.1% (±3%p ✓) |
| 보통 60 — 한계 시간 · 방치 | 1 · 3 | 1 · 3 | ✓ |
| 보통 60 — 유형별 성공 | 가스 50 · 화재 114 · 실종 96 · 응급 93 · 교통 134 · 붕괴 50 · 무장 99 · 수난 29 | 50 · 115 · 96 · 94 · 134 · 54 · 99 · 29 | 응급 지연 14 → 12 |
| 보통 60 — 다친 대원/교대 · 행동 엔트로피 · 방법 엔트로피 · 교착 후보 · 잊힌 사건 · 반복 최대 | 0.183 · 2.51 · 0.57 · 0 · 0 · 6 | 0.167 · 2.51 · 0.60 · 0 · 0 · 6 | ✓ |
| 보통 60 — 교본 | 26줄 중 15 · 판단 지점 3.3초(130건) · split 0.367 | 45줄 중 28(특수 12/20) · 2.1초(144건) · split 0.374 | |
| 강제 `armed/bomb` (그 시나리오 21건) | 21 성공 · 164초 | 21 · 180초 | 로봇 해체 19 · 방호복 해체 2 · 맨몸 0 |
| 강제 `armed/package` (20건) | 20 · 154초 | 20 · 165초 | 파일 성공 218 → 223 |
| 강제 `armed/hostage` (20건) | 17 · 2 · 1 · 202초 · 대원 부상 3 | 17 · 2 · 1 · 199초 · 3 | 파일 한계 시간 3 → 3 (배경 사건) |
| 강제 `armed/siege` (22건) | 11 · 10 · 1 · 230초 · 대원 부상 10 | 12 · 9 · 1 · 220초 · 10 | 파일 다친 대원/교대 0.85 → 0.60, 파일 한계 시간 0 → 2 (배경의 가스·버스) |
| 강제 `hazmat/std` (43건) | 35 · 4 · 0 · 0 · 4 · 177초 · 부대 3.8 | 38 · 3 · 0 · 0 · 2 · 171초 · 4.0 | D1(화학대) |
| 강제 `water/std` (30건) | 21 · 6 · 3 · 137초 | 22 · 5 · 3 · 140초 | |
| 지진해일 — 수난 (80건) | 23 · 22 · 29 · 0 · 6 | 24 · 22 · 29 · 0 · 5 | 파일 한계 시간 3 → 2 |
| 최소 인원 20 (`3,3,3,3,3,1`) — 성공 · 한계+방치+무대응+교대 끝 | 131 · 9 | 136 · 10 (6 · 2 · 1 · 1) | 다친 대원/교대 0.3 → 0.2 |
| 장비 불량 20 (`3,3,3,1,3,3`) — 성공 · 한계 시간 | 179 · 1 | 181 · 1 | 다친 대원/교대 0.15 → 0.30 (3 → 6명 — 강도·농성·화재·열차, 표본이 작다) |
| 교대당 시간 (`sweep 20`, 번갈아 두 번) | 사용자 CPU 32.9 · 33.1초 | 33.4 · 33.9초 | 1.02배 |

**폭파 진입**(강제 `armed/hostage`·`armed/siege` 각 20교대, scratchpad `tools/charge.mts`): 장약 설치 0 · 폭파 0 · 폭파에 다친 인질 0 — **목표(≥ 2)를 이루지 못했다**. 기준(`34d30a3`)도 0 이다. 농성 문이 잠긴 사건은 인질극 4 · 대형 인질극 7건이다. 시드를 넓혀 잰 진단(각 40교대 — 대형 인질극 13건 · 인질극 8건, `tools/door2.mts`)에서 모든 사건의 인질을 붙든 용의자의 실제 자리가 그 문에서 4.1칸 안(대부분 1~2.2칸)이었고, 인질극은 문을 발견할 때 붙든 용의자를 아직 모르는 일이 많아 S26 이 ×0 으로 막는다 — "인질이 문 뒤에 있을지 모르면 폭파하지 않는다"가 이 평면들에서는 늘 참이다. R2 의 세 원인(장약을 든 사람이 문을 열지 않음 · 인질 위치 확인 없음 · 진입 전 문을 참)은 셋 다 고쳤다: 문 여는 사람 넓히기 · S26 · S03(진입 전에 연 잠긴 문 2 → 2건 — 둘 다 개방을 정한 뒤 30.2초, 상한이 지나 연 것: S10 #02 · S11 #02). 장약이 실제로 쓰이는 길은 시험이 본다(시험 'S26 … 진입 순간 폭파 ×1.2').

**쓰인 줄**(보통 60 + 강제 다섯 + 지진해일 + 최소 인원 + 장비 불량): 특수 20줄 가운데 **14줄(70%)** — S01 26 · S02 3 · S03 2 · S05 161 · S06 50 · S13 40 · S15 10 · S19 4 · S22 57 · S26 3 · CS1 57 · CS2 140 · D1 270 · D2 46. 쓰이지 않은 여섯(S07 · S08 · S21 · S23 · S24 · S25)은 모두 장면 시험이 쓴다(측정 ∪ 시험 = 100%). 이 줄들은 드문 몸 상태(해체 중 다친 처리 요원·동요한 저격수·지친 수난 대원)나 드문 장비(로봇 고장 · 방호복 없는 처리 요원)에서만 1등을 바꾼다 — S08 은 CS1 이 먼저 일을 거두므로 배정이 바뀌지 않는다. 장비 불량 + 강제 `armed/bomb` 20교대(참고 — 정해진 묶음 밖)에서도 여섯은 쓰이지 않았다(폭발물 21 · 성공 19 · 로봇 해체 17 · 방호복 3).

관문: `npm run check` 통과(`eb0c2a1` — 시험 파일 19 · 836 통과 + 건너뜀 1, `sweep 40 --check` "검증 통과", 교착 후보 0 · 잊힌 사건 0 · C1~C5 0 · 연쇄 깊이 최대 2). 첫 관문(`d0821b4`)은 `tests/kinds2` 의 '새 방법 다섯(R2 표의 끝)' 하나가 깨져 `eb0c2a1` 로 고쳤다. `npx tsc --noEmit` 통과, `npx vitest run tests/doctrine.test.ts tests/ext.test.ts` 66 통과, `tests/crews.test.ts tests/methods.test.ts` 221 통과. 화면을 고치지 않았으므로 `npm run ui-check` 는 돌리지 않았다.

#### 알려진 문제

- **폭파 0건**(위) — 본문의 목표는 이 평면들에서 S26 과 함께 이룰 수 없다. 8단계에서 볼 자리: ① 농성 방의 문과 용의자 자리(`scenes/crime.ts` 의 농성 평면 — 인질범이 문 곁에 선다) ② 인질이 없는 바리케이드 사건(지금 문 잠금은 인질극·대형 인질극에만 있다).
- **쓰인 줄 70%**(75% 미만). 위 여섯은 장면 시험만 쓴다.
- 폭발물·수상한 물건의 평균 시간 +16 · +11초 — 로봇 원격 해체의 ×1.6(본문 값). 성공은 그대로다.
- 장비 불량 묶음의 다친 대원 3 → 6명(20교대 — 표본이 작다).

#### 이어받을 자리 (합치는 작업자)

- **S10·S11** 은 넣지 않았다(줄 문구도 쓰지 않았다). 3단계의 `pairUp`·`PAIRS` 와 F 줄이 들어온 뒤 `special.ts` 끝(S03 다음, `CMD_ROWS.push(CS1…)` 앞)에 붙인다. 그러면 시험 8 의 특수 줄 수가 22 가 된다 — `tests/doctrine.test.ts` 의 `STAGE5` 에 두 id 를 더한다.
- `DOC_DEPTS_DONE` 은 합칠 때 네 분야로(`'fire'`·`'ems'` 를 더한다). `STAGE5`·`CMD5` 와 소방·의료의 목록을 이어 붙인다.
- **R3 의 새 방법 줄은 N9 의 다섯 앞에 넣는다**(`tests/kinds2.test.ts` '새 방법 다섯(R2 표의 끝)'이 `Object.keys(METHOD).slice(-5)` 를 본다). 소방(`feel`·`pulse`)·6단계의 줄도 같다.
- 공유 파일에서 겹칠 수 있는 곳: `types.ts` 의 `MethodId`·`DocGateId` 끝(다른 단계도 덧붙인다), `doctrine/registry.ts` 의 `DocSit`·`DocCtx`·`DOC_DEPTS_DONE`, `doctrine.ts` 의 `docSit`·`docCtx` 반환 리터럴, `methods.ts` 의 `METHOD` 표 끝·`WORK_MODE`·`SAY`, `tests/methods.test.ts` 의 줄 수(63 + 다른 단계의 줄), `executor.ts` 의 import 한 줄, `commander.ts` 의 `doctrine` import.
- 다친 대원 하나하나·폭파 진입을 읽는 도구: scratchpad `wf-doctrine/par/special/tools/`(`charge.mts` 폭파 진입 진단 · `door2.mts` 잠긴 문을 찾은 때의 요약 · `gap.mts` 해체 지시와 믿음의 틈 · `none.mts` 해체 임무의 방법 흐름 · `arm.mts` 무장 강제의 검거 방법 기록).

### 단계 3·4·5 합치기 — 2026-11-16

브랜치 `wf/doctrine-int`(시작 34d30a3) → `wf/doctrine` 가리킴. 합친 순서: **소방 `wf/doctrine-f3`(58b1c6c — 관문 미통과) → 의료 `wf/doctrine-e4`(a43f320) → 특수 `wf/doctrine-s5`(ef3bfaf) → 주 브랜치**(3d02832 — 워크플로 대본만). 소방이 관문을 통과하지 못했지만 짝 맺기가 다른 둘의 바탕이라 다섯 커밋을 모두 합쳤다.

**충돌과 푼 법** (모두 "양쪽이 끝에 덧붙인 것" — 둘 다 남겼다):
- `doctrineRun.ts`·`executor.ts`·`orders/doctrine.ts`·`sceneManager.ts`·`commander.ts`·`doctrine.ts`·`registry.ts`·`types.ts`·`methods.ts`(SAY)·`dispatch/doctrine.ts`·시험 셋·이 설계서: 파일 끝 절을 단계 순서(3 → 4 → 5)로 이어 붙였다. 같은 이름을 두 번 들여온 줄은 지웠다(`grid` 의 `staticPass·tileOf`, `methodRun` 의 `senseOf`, `orders/doctrine` 5단계 절의 `emit`·`WorkItem`·`CommandKit`).
- `commander.assign`: CF7(지휘관은 밖에)과 CS2(특공 진입조 가산)를 같은 반복에 둘 다 — CF7 의 `continue` 가 CS2 가산보다 앞이다(위험 실내 일과 교전·봉쇄는 겹치지 않는다).
- 지휘 교본의 등록: 경찰 등록 안에서 `fireOrders`(3) → `cs1`(5), 의료(4)는 같은 파일의 둘째 `registerOrders`. CS1 시험은 이제 `ORDER_RULES` 의 마지막이 아니라 `CP2` 를 품은 등록을 찾아 부른다(의료 시험이 쓰던 방법).
- `MethodId`: `feel·pulse`(3, 표 끝) + 해체 셋(5, N9 다섯 앞) — `METHOD` 65줄. `DOC_DEPTS_DONE` = `['police','fire','special']` + 파일 끝의 `push('ems')`.
- 시험 5 는 합친 등록 순서 전체(`STAGE_ALL`·`CMD_ALL` — 줄 77 + 지휘·관제 24)를 같은지로 본다(4단계의 `LATER_*` 목록은 지웠다). 판단 지점 목록에 `carryHold·laneTreat·forceDoor`.
- methods 무장 표본: 세 단계가 따로 더한 시드(A21·A6·A29)를 모두 둔다.

**화학 짝·대기조 (S10·S11 — 5단계가 남긴 몫)**: `special.ts` 의 S03 다음. S10 = 가스 누출 현장의 위험 실내 수색에 측정기(`gasMeter`)를 든 화학 대원 `+0.15`(`units: hazmat`). S11 = 화학 팀장(`hazLead`)의 위험 실내 일 `×0.3`, 자기 부대의 다른 대원이 위험 실내에 서 있는 동안(`DocCtx.unitIn()` — 새 게으른 칸, 엔진 `unitInside`, 동료의 겉). 짝은 0단계의 `PAIRS.hazmat`(안 [보호복, 측정·제독] · 밖 [팀장, 보호복]) 그대로 `pairUp` 이 맺는다. 시험 8 의 특수 = 줄 19 + 관제·지휘 넷(D2·CS1·CS2·D1) + D4 ≥ 12.

**주 세션의 소방 균형 결정을 따른 것**:
- (가) 밖 대기조: `outsideWatch` 는 이미 같은 현장의 모든 부대(`s.agents`)를 센다 — 지휘관·기관원·사다리 조작원·급수·교통 통제 포함, 공기호흡기·공기 50% 이상·위험 실내 일이 아닌 사람. 고칠 것이 없었다(3단계의 `WATCH_R` 12 는 그대로).
- (나) 짝은 일하면서 함께 다닌다: ① `commander.pairAssign` — 위험 실내 일을 맡기는 그 자리에서 짝에게 그 일의 둘째 자리나 같은·이웃 구역의 빈 위험 실내 일을 함께 준다(지시 문구 끝 "— {짝}과 짝으로."). 수색·진압·잔불 정리만, 짝이 앞세우는 일(역할 선호 ≥ 0.2 — 유압 구조대원의 구출)이 열려 있으면 두지 않는다(`tests/crews.test.ts` ⑤ — 구출이 유압 구조대원에게서 밀렸다). ② `DocPair.ordered` — 받은 지시가 짝 곁의 위험 실내 일이면 G08 이 걸리지 않고 `runPair` 가 끝난다(지시 점수 0.56+0.4p 가 짝 동행 계속 점수 0.62+0.4p 보다 낮아 지시가 버려졌다). 맡을 수 있는 지시만(`fitFor > 0`), 끝낸 뒤 G08 10초 기억(시험 4 의 "동행 → 없음 → 동행"). ③ `rebuddy` 넓히기 — 짝이 혼자 서는 역할(기관원 …)인 손 빈 공기호흡기 대원(지휘관 아님)은 부대를 넘어 짝이 없거나 같은 처지인 손 빈 대원과 다시 맺고, 남겨진 혼자 서는 대원은 −1(밖에 선다).
- (다) §8.4 의 1번 손잡이: 3단계가 첫째(F05 예외에 신고 인원 불명)·둘째(`WATCH_NEED` 1, 오는 부대가 있으면 0)를 돌려 둔 그대로, 셋째(`AIR_OUT` 0.25)는 3단계 측정에서 효과 0 이라 되돌린 그대로.
- (라) **혼자 서는 역할(기관원·사다리 조작원)의 실내 단독 작업을 막았다** — 3단계 코드는 본문 §5.1 대로 그들을 F04·F04b·F04c 에서 빼 두어 실제로 혼자 들어갔다(강제 fire/std 의 장면당 0.27명, 가스 누출에서는 송풍기를 든 그들이 환기 후 차단을 했다). 이제 짝이 따라올 때만 들어간다. 스위치 `DOC_SWITCH.SOLO_IN`(`registry.ts` — false = 주 세션 결정, true = 본문 §5.1).
- (마) 범위에 들지 못해 **더 깎지 않고 멈췄다** — 아래 수치.

**맞물림 점검**: 같은 TaskKind·finishTask 사유를 두 단계가 따로 더한 것은 없다(소방 `airOut·pairOut·pair`·사유 `doctrine`, 의료 WorkKind `triage`·사유 `handover`, 특수 MethodId 셋·판단 지점 `forceDoor`). 줄 id 겹침 없음(시험 8). 의무(duty)는 F01·F02 뿐이라 의무끼리 겨루지 않는다. `moveTo` 의 두 판단 지점(`forceDoor` — 잠긴 문, `interiorEntry` — 실내 첫걸음)은 같은 임무 칸(`gateAt·gateId`)을 쓰지만 `gateStep` 이 판단 지점이 바뀌면 다시 센다. S08(해체 반경)·S11 은 fit 배율이라 F04 와 곱해진다. CE5(이송 전 지휘 넘김)로 지휘관이 바뀌면 `rebuddy` 의 지휘관 제외가 새 지휘관에게 걸린다. 측정 도구: 교착 후보 0·잊힌 사건 0(보통·프리셋 셋 모두 — 기준과 같다), **반복 최대는 늘었다**(보통 6 → 11, 쉬움 8 → 12, 어려움 9 → 11, 극한 8 → 11).

**속도 (pickAct 의 장비 앞 조건)**: `docDuty·docAct` 가 장비 조건(`kits`)이 걸리지 않을 줄 앞에서 DocCtx 를 만들지 않는다(결과 같음 — 12교대 reportHash 같다).

**전체 수치** (기준 34d30a3 의 git archive 사본 — 3·4·5 작업자의 기준 파일과 같은 사본, 같은 명령. 뒤 = 이 합치기의 마지막 코드):

| | 기준 | 합친 직후(셋만) | 합치기 끝 (라 켬 — 주 세션 결정) | 참고: 라 끔(`SOLO_IN`) |
|---|---|---|---|---|
| 보통 60 성공 | 665/849 (78.3%) | 620/844 (73.5%) | 578/844 (68.5%) **−9.8%p** | 622/844 (73.7%) −4.6%p |
| 한계 시간 + 방치 | 1 + 3 | 10 + 3 | 20 + 2 | 5 + 3 |
| 화재 | 114/175 (65.1%) | 87/171 (50.9%) | 74/174 (42.5%) −22.6%p | 91/173 (52.6%) −12.5%p |
| 가스 누출 | 50/62 (80.6%) | 44/62 (71.0%) | 29/61 (47.5%) −33.1%p | 44/61 (72.1%) −8.5%p |
| 붕괴 · 수난 · 무장 · 응급 · 교통 | 72.5 · 78.4 · 75.6 · 82.3 · 82.2% | — | 66.7 · 75.7 · 73.8 · 77.9 · 75.9% | 72.9 · 78.4 · 73.3 · 76.8 · 82.2% |
| 대원 부상/교대 · 순직 | 0.183 · 0 | 0.28 | 0.40 · 0 | 0.317 · 0.017 |
| split | 0.367 | 0.42 | 0.412 | 0.406 |
| 방법 엔트로피 | 0.57 | 0.97 | 0.98 | 0.95 |
| 교대당 시간 (20교대 — 번갈아 둘씩, 벽시계 / 사용자 CPU) | 14.1초 / 34.7초 | 24.5초 / 52.2초 | 26.6초 / 54.6초 (1.88× / 1.57×) | 24.4초 / 52.2초 |

프리셋 60 (성공): 쉬움 85.2 → 78.3%(−6.9, 가스 누출 93.8 → 50.0), 어려움 59.1 → 47.8%(−11.4, 한계 시간 6 → 34), 극한 31.9 → 25.7%(−6.2, 한계 시간 17 → 49).
강제 20 (그 시나리오 — n·성공·한계): fire/std 69·37·0 → 66·28·4(264 → 367초) · fire/arson 44·23·1 → 42·17·0 · collapse/std 37·26·0 → 36·22·0 · **hazmat/std 43·35·0 → 42·15·5** · water/std 30·21·0 → 30·23·0 · medical/arrest 27·22 → 27·22 · medical/trauma 43·35 → 43·36 · traffic/bus 26·20 → 26·21 · traffic/std 57·44 → 57·44 · traffic/pileup 22·13 → 22·13 · armed/dispute 25·20 → 25·20 · armed/domestic 26·18 → 26·19 · armed/shooter 23·12 → 23·15(그 시나리오 대원 부상 6 → 3) · armed/hostage 20·17 → 20·15(부상 3 → 5) · armed/siege 22·11 → 22·10(부상 10 → 11) · armed/kidnap·getaway 같다 · armed/bomb 21·21 → 21·20 · armed/package 20·20 → 20·20 · 해일 20교대 전체 59.4 → 50.3%. 강제 묶음의 전체 성공은 배경 사건(화재·가스 누출)으로 모두 −6~−19%p. 라를 끈 강제 fire/std 68·31·1(333초) · hazmat/std 43·30·4.
최소 인원(3,3,3,3,3,1) 20교대 50.8 → 43.0% · 장비 1(3,3,3,1,3,3) 63.0 → 46.2%.
**폭파 진입**: 강제 armed/hostage·armed/siege 20교대씩 장약 0건(기준과 같다 — R2 의 목표 ≥ 2 는 못 맞췄다. 5단계 메모의 까닭 그대로: 잠긴 문마다 인질을 잡은 용의자가 4.1칸 안이거나 모른다 → S26 이 막는다).
**쓰인 줄** (측정 묶음 전체 — 보통 60·프리셋 셋·강제 스물·최소 인원·장비 1): 경찰 17/22(77%) · 소방 21/21(100%) · 의료 14/16(88%) · 특수 18/23(78%) — 네 분야 모두 75% 이상. 안 쓰인 줄(P09·P10·P11·P22·CP3 — 시험 2-d, E04·E20 — 시험 2-g, S07·S21·S23·S24·S25 — 5단계 장면 시험)은 모두 장면 시험이 쓴다(측정 ∪ 시험 = 100%).

**못 맞춘 목표** (§8.2 — 주 세션이 사용자에게 물을 것):
1. 전체 −9.8%p(범위 ±3), 화재 −22.6%p(−6~+3), 가스 누출 −33.1%p(±5), 한계 시간+방치 22(기준+2 = 6), 강제 hazmat/std 한계 시간 5(≤ 2), 대원 부상 0.183 → 0.40/교대(기준 이하가 목표), 강제 armed/siege·fire/std 의 부상 −10% 못 함, split 0.412(≥ 0.5), 교대당 시간 1.88×(≤ 1.15×), 반복 최대 증가.
2. 원인 셋: ① **(라)** — 라를 끄면 전체 −4.6%p·가스 누출 −8.5%p 로 돌아온다(가스 누출의 환기 후 차단을 송풍기를 든 기관원·사다리 조작원이 혼자 하던 몫, 화재의 실내 손 0.27명). 짝을 붙여 들여보내는 안(혼자 서는 역할도 손 빈 사람과 다시 맺기)은 재 보니 나아지지 않아 넣지 않았다. ② 3단계의 짝·대기조 자체(합친 직후 이미 −4.8%p — 3단계 메모의 원인 그대로: 짝 동행이 실내의 일손을 줄인다). (나)의 셋은 q 표본(보통 60)에서 +2.4%p 였으나 sweep 60 에서는 잡음 안이다. ③ 교대당 시간은 셋을 합친 직후 이미 1.7× — 교본 판단(docCtx·docDuty·fitFor 의 짝 계산)이 판단마다·배정마다 돈다(프로파일: docCtx 포함 14%, pickAct 11%, fitFor 11%).
3. 관문(`npm run check`): 아래 "관문" 줄.

**설계서 밖에서 고친 공용 파일** (합치기에서): `commander.ts`(assign 끝의 `pairAssign` 호출 한 줄, 파일 끝 `PAIR_SLOT`·`pairAssign`), `doctrine.ts`(DocCtx 의 `unitIn` 게으른 칸, `unitInside`, `pairOf` 의 `ordered`, `pickAct` 의 `anyKit` 앞 조건), `doctrine/registry.ts`(`DocCtx.unitIn`, `DocPair.ordered`, `DOC_SWITCH.SOLO_IN`, `DOC_DEPTS_DONE` 에 special), `doctrine/common.ts`(G08 when 에 `!p.ordered`), `doctrine/fire.ts`(F04·F04b·F04c 의 혼자 서는 역할 — `DOC_SWITCH.SOLO_IN`), `doctrine/special.ts`(S10·S11), `doctrineRun.ts`(`rebuddy` 넓히기·`soloPaired`·`unpairSolo`, `runPair` 의 지시 끝·`orderedNear`), 시험 셋(`doctrine`·`crews`·`methods` — 위).

**관문** (`npm run check`, 다른 작업이 없는 기계): **통과하지 못한다** — `tsc` 통과, vitest 863 가운데 861 통과·건너뜀 1·**실패 1**: `tests/sim.test.ts` '2층 건물'(`saved2F > on2F × 0.5` — 9 > 9.5 아님, 화재 균형의 결과. 시험은 고치지 않았다 — `DOC_SWITCH.SOLO_IN = true` 이면 통과한다). `sweep 40 --check` 는 따로 돌려 '검증 통과'. 3단계가 깨뜨렸던 '인근 도시 지원'(goneHome)은 지금 통과한다. 짐이 많은 기계에서는 시간 초과 셋(crews ⑨·sim 프리셋·sim 빈 곳 채우기)이 더 나왔다 — 교대당 시간이 늘어서다.

**이어받을 자리**: 사용자 결정 둘 — ① (라)를 그대로 둘지(`SOLO_IN` false) 본문 §5.1 로 돌릴지(true), ② 둘 다 §8.2 의 화재 범위 밖이므로 범위를 넓힐지 교본을 덜어 낼지(3단계 메모의 후보 — 짝 동행을 작업판의 둘째 담당자로 세기, 밖 대기조 1명). 측정 도구는 scratchpad `wf-doctrine/int/`(`run.sh` 묶음 측정 · `cmp.py` 두 출력 견주기 · `usage.mts` 측정 묶음의 쓰인 줄 · `q.mts` 유형별 빠른 표본(`OFF=줄,줄` 로 줄 빼기) · `hands.mts` 화재·가스 현장의 역할별 손(장면 표본) · `tr.mts` 한 대원의 임무 흐름 · `per.mts` 교대별 강제 사건 결과), 기준 사본 `wf-doctrine/par/fire/b34`, 수치 `int/base`·`int/finout`·`int/finout2`(라 켬)·`int/finxout`·`int/finxout2`(라 끔).


### 균형 — 2026-11-16 (사용자 결정: 2인 진입 + 밖 2인 대기는 그대로, 건물 화재 첫 출동에 펌프차 하나 더)

브랜치 `wf/doctrine-bal`(시작 `e91e6e4`) → `wf/doctrine` 가리킴. 측정의 "기준"은 `34d30a3` 의 `git archive` 사본(3·4·5 작업자와 같은 사본 — scratchpad `wf-doctrine/par/fire/b34`, 결과 파일 `par/fire/base`·`int/base`·`par/medical/base`·`par/special/base`), "합친 뒤"는 `e91e6e4`(합치기 메모의 '라 켬' 열), "균형 뒤"는 `2b9638d`(scratchpad `wf-doctrine/fix/s5`, 결과 `fix/s5out` — 대본 `fix/run.sh`, 견주기 `fix/cmp.py`, 유형별 빠른 표본 `fix/q.mts`(`RES=`·`SW=`·`OFF=`), 다친 대원 `fix/hurt.mts`·`hurt2.mts`, 한계 시간 목록 `fix/to.mts`, 화재 판정의 재료 `fix/fail.mts`·`cas.mts`, 대기조 `fix/watch.mts`, 짝 기다림 `fix/nofollow.mts`).

| 커밋 | 내용 |
|---|---|
| `3eedab0` | `DOC_SWITCH.SOLO_IN` 기본 true (본문 §5.1) |
| `67248c7` | D8 · 허락된 일을 하는 짝의 동행(`brain.allowedHere`) · 대기 지점의 밖 대기조(`DOC.WATCH_STAGE`) |
| `137f7d1` | 짝 동행은 불이 번져 온 칸에서 비킨다(`doctrineRun.clearNear`) |
| `4deca5a` | 속도: DocCtx 의 게으른 칸(결과 같음 — 강제 일곱 묶음 × 4교대 해시 같다) |
| `2b9638d` | D8 의 남겨 둘 펌프차 한 대(`FIRST_PLUS.reserve` 1) · 응급이 아니라고 알린 사건의 선착 대응 표시(`dispatcher.fieldReport`) |
| 그다음 커밋 | 이 메모 |

**한 것** (과제 순서):
1. **`SOLO_IN` 을 설계서대로(true)**: 기관원·사다리 조작원은 F04·F04b·F04c 에서 빠진다(본문 §5.1). 스위치는 남겼다(false = 합치기 (라)). 시험: doctrine '혼자 서는 역할'(기본 true · 끄면 맡지 않는다), methods 송풍기 두 장면의 스위치 켜기를 거둠(합치기 전 모양). `tests/sim.test.ts` '2층 건물' 통과.
2. **D8 — 건물 화재의 첫 출동에 펌프차 하나 더** (`dispatch/doctrine.ts docNeeds` 끝, `CMD_ROWS` 의 소방 관제 줄 — D4 다음): 관제가 평가한 유형이 화재이고, 위치 신고(첫 `location` 사실)의 장소가 건물(`cityPlan.KIND_SCENE` 에 현장 틀이 있는 종류 — 교차로·공원·숲·부두는 아니다)이며, 관제가 붙인 이름표가 산불·비행기 추락·선박 화재가 아니면 진압 수요 +1. 나갈 수 있는 펌프차(진압 펌프차·사다리차 — 이 사건에 배정된 것 + 집에 있거나 돌아가는 중이고 걸을 수 있는 대원이 있는 것)가 **기본 수요 + 1 + 남겨 둘 한 대(`FIRST_PLUS.reserve` = 1)** 이상일 때만 건다 — 없는 부대를 기다리는 수요(NO_UNIT·BACKUP_LATE)를 만들지 않는다. 관제가 아는 것만 읽는다(평가·이름표·신고 위치의 건물 종류·자기 조직의 부대 상태 — `I.truth` 없음). 스위치 `DOC_SWITCH.D8`. `analyst.assess` 가 `docNeeds` 에 위치 신고의 건물 종류와 사건을 넘긴다.
   - 문턱 없이(모든 건물 화재에 +1) 걸면 보통 60 에서 전체 72.8%(D8 없음 73.7%) · NO_UNIT 378 → 476 · 화재 '성공' 그대로(지연만 늘었다 — 채워지지 않은 둘째 진압 수요가 BACKUP_LATE 를 남겼다). 문턱 0(남겨 둘 차 없음)·1 은 보통 120교대(마지막 코드)에서 화재 58.8 / 57.7% · 전체 76.9 / 76.2% — 잡음 안이다. 1 을 골랐다: 다음 신고의 펌프차를 남기는 관제의 원칙이고, 0 에서는 `tests/sim.test.ts` '추격전'(50교대에 놓침이 한 건뿐 — 0 이면 깨진다)이 깨졌다.
   - D8 하나의 몫(보통 120교대, D8 끄기 견주기): 화재 54.9 → 56.6~57.5%, 강제 fire/std 의 소화 시각 235 → 206초 · 모든 방 수색 확인 188 → 168초(16교대 이정표 — 기준 164·119초). 손은 늘었지만(현장의 소방 대원 표본당 활동 2.0 → 2.0, 손 빈 4.9 → 5.9) **실내의 일(작업판 일을 맡은 사람)은 늘지 않았다** — 짝이 한 방씩 함께 다니므로 실내에서 동시에 하는 방의 수가 짝의 수다.
   - **가스 누출(같은 처방 D9 — 첫 출동에 공기호흡기 소방 부대 하나 더)은 넣지 않았다**: 시험해 보니 강제 hazmat/std 40교대에서 69.6 → 65.4~66.3%(잡음 안, 나아지지 않음), 아래 3-a 를 고친 뒤에도 D9 켬 76.5% · 끔 76.3% 로 같았다. 가스 누출의 손해는 손이 아니라 **고리**였다(3-a) — 고리를 고친 뒤 보통 60 의 가스 누출이 80.6 → 80.3% 로 범위 안이다. **붕괴**는 범위 안(72.5 → 78.3%, 합친 뒤 66.7%)이라 처방이 필요 없다.
3. **측정이 찾은 고리·버그** (§8.4 손잡이 밖 — 모두 결과를 바꾼다):
   - (a) **허락된 일을 하는 짝의 동행** (`brain.allowedHere` — X6 의 판단 함수): 짝 동행(G08, `pair`)은 짝의 지금 일이 진입 금지 구역에서도 허락된 일(`ops.ALLOWED2` — 밸브 차단 …)이면 허락된 일로 본다. 동행이 가스 단계 3 의 측정값을 읽자마자 물러나고, 짝 따라 나가기(F02)가 밸브를 잠그던 짝까지 데리고 나와 "들어감 → 물러남 → 따라 나감"을 1분마다 되풀이했다(강제 hazmat/std S14 — 기준 23초에 잠근 밸브를 2분 30초 뒤에야, 측정 도구의 반복 최대 11 의 원천 '가스 농도가 위험합니다. 물러납니다.'). 고친 뒤 강제 hazmat/std 40교대 69.6 → 76.3% · 한계 시간 4 → 0. 짝의 일은 동료의 겉(받은 임무)이다.
   - (b) **대기 지점의 밖 대기조** (`doctrine.outsideWatch`, `DOC.WATCH_STAGE` 4): 들어서려는 출입구에서 12칸 안 **또는 대기 지점(`s.staging`) 4칸 안**의 손 빈 공기호흡기 대원을 센다. 대기 지점이 출입구에서 15~19칸인 현장에서 대기 지점에 열 명이 서 있어도 하나도 세어지지 않아, 요구조자가 모두 나온 뒤(F05 의 예외가 풀린 뒤) 잔불 정리 진입을 '대기조 확인 전 진입 보류 → 대기조가 갖춰지지 않습니다'로 끝까지 막았다 — 보통 120교대의 한계 시간 12 가운데 화재 6건 중 4건이 작업판에 잔불 정리만 남은 채 닫혔다. 고친 뒤 보통 120교대 한계 시간 + 방치 16 → 7(기준 7).
   - (c) **짝 동행은 불이 번져 온 칸에서 비킨다** (`doctrineRun.runPair` 의 `clearNear`): 짝 곁(1.4칸)에 닿으면 서 있으므로 불이 그 칸까지 번져도 그대로 섰다가 화상을 입었다 — 보통 120교대의 소방 분야 화상이 모두 짝 동행 중이었다. 불 0.3 넘는 칸이면 짝 곁 2.5칸 안의 불 없는 칸으로(짝에게 1.4칸 안을 먼저). 효과는 작다: 보통 120교대에서 화상 하나가 사라졌고(소방 분야 다친 대원 기록 6 → 6 — 다른 사건의 차량 충격 하나가 새로 났다), 소방 분야의 큰 감소(11 → 6)는 위 (b)와 함께 왔다.
   - (d) **선착 대응 표시** (`dispatcher.fieldReport`): 현장 지휘관이 유형을 응급이 아닌 것으로 바로잡으면 `I.coResp` 를 거둔다. 쓰러진 사람이 있다던 가스 누출에 선착 대응을 붙인 뒤 남겨 두면 우선순위가 그 사건을 '구급대원이 닿지 않은 사건'으로 계속 셌다(`tests/sim.test.ts` '선착 대응'의 불변 조건 — 응급이 아닌 사건에 선착 대응 표시). 이미 닿은 뒤라 다시 붙지 않는다(`firstArrivalAt`).
   - 시험해 보고 넣지 않은 것: 현장 지휘관을 짝으로 세지 않기(buddyOf·G08·rebuddy — '짝이 오지 않습니다' 의 셋 가운데 하나가 지휘관이 된 짝이었다) — 보통 120교대에서 무장 78.2 → 73.9%·화재 58.8 → 57.1% 로 나빠져 되돌렸다(경찰 지휘관의 확보 전 수색 동행이 사라졌다).
4. **§8.4 손잡이** (차례대로):
   - 1 (화재): 셋 다 3단계에서 돌려 둔 그대로다(F05 예외에 신고 인원 불명 · `WATCH_NEED` 1(오는 부대가 있으면 0) · `AIR_OUT` 0.25 는 효과 0 이라 되돌림). 더 돌릴 것이 표에 없다. 화재 줄 하나씩 빼 보기(강제 fire/std 40교대 — F07 · F16 · F04c · F08)도 ±2%p 안이었다 — 남은 차이는 한 줄이 아니라 짝 구조 전체에 있다.
   - 2 (무장): 범위 안(−0.2%p)이고 `생활`·`폭동` 시험이 통과해 돌리지 않았다. 3 (추격): 강제 kidnap·getaway 가 기준과 같다(놓침 14·10) — 돌리지 않았다. 4 (너무 쉬움): 해당 없음. 5 (그 밖 — 가벼운 일 배율·권총 탄약): 남은 차이(화재)에 닿지 않는 손잡이라 돌리지 않았다.
5. **반복 최대**: 합친 뒤 11 의 원천은 둘 — '가스 농도가 위험합니다. 물러납니다.'(위 3-a 의 고리, 고침)와 '…, 공정실 1 화재 진압 실시.' x10(합치기 (라)의 교대 — `SOLO_IN` true 에서는 나오지 않는다). 균형 뒤 보통 60 의 반복 최대 8 은 '추가 위험이 있습니다. 밖에서 방수하겠습니다.'(S46 #12 — 다친 구조대원 하나가 사무실 셋·넷·다섯·하나를 돌며 같은 까닭으로 외부 방수를 고른 시작 문구, 대상이 모두 달라 R2 의 `SAY_AGAIN` 이 거르지 않는다 — 고리 아님)다. 같은 코드의 문턱 0 교대(`fix/s3out`)에서는 6 이었다. 어려움 8 · 극한 10(극한 S0 #05 '유압 구조기가 없습니다…' — 다수 사상자의 대상마다, S1 #17 '천장이 내려앉고 있습니다' x9 — X6 의 구조 철수, 기준 극한 8).
6. **다친 대원 증가의 원인** (보통 120교대, RESPONDER_HURT 기록 — `fix/hurt.mts`): 기준 23(경찰 21 · 소방 1 · 구급 1) → 합친 뒤(SOLO_IN false) 0.40/교대 → 균형 뒤 35(경찰 26 · 소방 6 · 구급 3). 소방은 합친 뒤 짝 동행 중 화상·혼자 들어간 기관원의 화상이 컸고(120교대 11), 균형 뒤 여섯은 화상 2(한 대원이 다치고 쓰러짐 — 짝 동행 뒤 짝 따라 나가기 중 불길을 뚫고 나옴, `pairOut` 은 `escape`)·흉기 2(폭동·화재 현장)·차량 2(그중 하나는 2차 붕괴). 경찰은 무장 강도 6 → 9 · 인질 1 → 5(총상 — '피격 (엄폐 중)'과 '엄폐 없이 노출'이 반씩, 2단계의 엄폐·탄약 교본)이고 교대당 0.18 → 0.22 로 포아송 잡음(±0.04) 안팎이다. 강제 armed/shooter 의 그 시나리오 부상 6 → 3(−50%), armed/siege 10 → 9(−10%), fire/std 0 → 1.

**설계와 다르게 한 곳**:
- D8 은 §6.2 표에 없는 관제 줄이다(사용자 결정 2026-11-16). 표에는 D8 을 소방 분야 관제 줄로 더했다(시험 5 의 지휘·관제 줄 목록 — D4 다음).
- 가스 누출의 같은 처방(D9)은 넣지 않았다(위 2).
- 밖 대기조를 대기 지점에서도 센다(§5.6 은 출입구에서 8칸 — 3단계가 12 로, 이번에 대기 지점 4칸을 더했다).
- 짝 동행은 짝이 허락된 일이면 진입 금지 구역의 철수 의무(가스)를 받지 않는다(§5.4 의 짝 동행에 없던 조건 — X6 `brain.allowedHere`).
- 짝 동행의 불 피하기(§5.4 에 없던 실행 — `clearNear`).

**설계서 밖에서 고친 공용 파일**: `dispatch/analyst.ts`(`assess` — `docNeeds` 에 첫 위치 신고의 건물 종류와 사건을 넘긴다), `dispatch/dispatcher.ts`(`fieldReport` — 유형이 응급이 아니게 바로잡히면 `I.coResp` 를 거둔다), `field/brain.ts`(`allowedHere` — 짝 동행의 짝의 일). 시험: `tests/doctrine.test.ts`(혼자 서는 역할·D8 다섯·밸브 차단 짝의 동행·대기 지점 대기조·시험 5 의 목록), `tests/methods.test.ts`(송풍기 두 장면을 합치기 전 모양으로). `tests/sim.test.ts`·`crime.test.ts` 는 고치지 않았다.

**수치** (같은 명령 — 기준 `34d30a3` → 합친 뒤 `e91e6e4`(라 켬) → 균형 뒤 `2b9638d`):

| | 기준 | 합친 뒤 | 균형 뒤 | §8.2 |
|---|---|---|---|---|
| 보통 60 성공 | 665/849 (78.3%) | 578/844 (68.5%) | 643/845 (76.1%) −2.2%p | ±3 ✓ |
| 한계 시간 + 방치 (교대 끝) | 1 + 3 | 20 + 2 | 4 + 2 (+ 교대 끝 2) | 기준 + 2 = 6 ✓ |
| 화재 | 114/175 (65.1%) | 74/174 (42.5%) | 98/174 (56.3%) −8.8%p | −6~+3 ✗ |
| 가스 누출 | 50/62 (80.6%) | 29/61 (47.5%) | 49/61 (80.3%) −0.3%p | ±5 ✓ |
| 붕괴 · 수난 | 72.5 · 78.4% | 66.7 · 75.7% | 78.3 (+5.8) · 73.0% (−5.4) | ±5 — 둘 다 조금 밖(n 69·37) |
| 무장 · 응급 · 교통 · 수색 | 75.6 · 82.3 · 82.2 · 97.0% | 73.8 · 77.9 · 75.9 · — | 75.4 · 79.5 · 81.6 · 96.0% | ✓ |
| 대원 부상/교대 · 쓰러짐 · 순직 | 0.183 · 0 · 0 | 0.40 · — · 0 | 0.283 · 0.017 · 0 | 기준 이하 ✗ |
| split · 방법 엔트로피 · 행동 엔트로피 | 0.367 · 0.57 · 2.51 | 0.412 · 0.98 · — | 0.424 · 0.90 · 2.52 | split ≥ 0.5 ✗ · 나머지 ✓ |
| 교착 후보 · 잊힌 사건 · 기록 일치 | 0 · 0 · 0 | 0 · 0 · 0 | 0 · 0 · 0 | ✓ |
| 반복 최대 | 6 | 11 | 8 (문턱 0 교대 6) | — |
| 교대당 시간 (sweep 20 `--no-metrics`, 번갈아 둘씩 — 벽시계 / 사용자 CPU) | 13.1초 / 32.5초 | 25.3초 / 51.3초 (1.93× / 1.58×) | 19.0초 / 41.1초 (**1.46× / 1.26×**) | ≤ 1.15 ✗ |

보통 120교대(`fix/q.mts` — S0~S119): 기준 78.8%(화재 66.0 · 한계 3 + 방치 4) → 균형 뒤 76.2%(화재 57.7 · 5 + 3). 문턱 0 이면 76.9%(화재 58.8).
프리셋 60 (성공 · 한계 시간): 쉬움 85.2 → 78.3 → **84.9%** (한계 0 → 1) · 어려움 59.1 → 47.8 → **52.9%** (6 → 34 → 14 · 가스 누출 68.6 → 52.2%) · 극한 31.9 → 25.7 → **26.4%** (17 → 49 → 24 · 무대응 2 → 15 → 17 · 화재 22.9 → 8.7%).
강제 20 (그 시나리오 — n·성공·한계, 기준 → 합친 뒤 → 균형 뒤): fire/std 69·37·0 → 66·28·4 → 66·29·2 (264 → 367 → 302초) · fire/arson 44·23·1 → 42·17·0 → 41·22·0 · collapse/std 37·26·0 → 36·22·0 → 37·22·0 · hazmat/std 43·35·0 → 42·15·5 → 44·34·1 · water/std 30·21·0 → 30·23·0 → 30·22·0 · medical/arrest 27·22 → 27·22 → 27·22 · medical/trauma 43·35 → 43·36 → 43·36 · traffic/bus 26·20 → 26·21 → 26·20(한계 1) · traffic/std 57·44 → 57·44 → 57·43 · traffic/pileup 22·13 → 22·13 → 22·14 · armed/dispute 25·20 → 25·20 → 25·20 · armed/domestic 26·18 → 26·19 → 26·19 · armed/shooter 23·12 → 23·15 → 23·16 · armed/hostage 20·17 → 20·15 → 20·15 · armed/siege 22·11 → 22·10 → 22·11 · armed/kidnap·getaway 세 열이 같다 · armed/bomb 21·21 → 21·20 → 21·21 · armed/package 20·20 셋 다 · 해일 20교대 전체 59.4 → 50.3 → 58.9%. 강제 묶음마다 한계 시간 + 방치 2 이하 ✓.
최소 인원(3,3,3,3,3,1) 20교대 50.8 → 43.0 → **46.4%** (가스 누출 55.0 → 35.0%) · 장비 불량(3,3,3,1,3,3) 63.0 → 46.2 → **53.0%** (화재 42.4 → 13.8% — 장비 1 의 예비 펌프 0(§2.1 `sparePump` [0,1,1,1,2], F10): 펌프가 고장 나면 바꿀 펌프가 없어 CF3 이 진압 부대 교체를 부르는 사이 건물이 탄다 — 20교대 화재 55건 가운데 43건이 소실률 60% 넘음(문턱 0 코드), 기준은 56건 가운데 9건).
**폭파 진입**: 보통 60 · 강제 armed/hostage · armed/siege 20교대씩 · 프리셋 모두 **0건**(기준과 같다 — 합치기 메모의 까닭 그대로: 잠긴 문마다 인질을 잡은 용의자가 4.1칸 안이거나 모른다 → S26).
**쓰인 줄** (균형 뒤 측정 묶음 전체 — 보통 60·프리셋 셋·강제 스물·최소 인원·장비 불량, `fix/usage.mts`): 경찰 17/22(77%) · 소방 22/22(100% — D8 포함) · 의료 14/16(88%) · 특수 18/23(78%). 안 쓰인 줄(P09·P10·P11·P22·CP3 · E04·E20 · S07·S21·S23·S24·S25)은 합치기 메모와 같고 모두 장면 시험이 쓴다.

**못 맞춘 목표** (§8.2 — 주 세션이 사용자에게 물을 것):
1. **화재 −8.8%p**(보통 60, 범위 −6) · 보통 120 에서 −8.3%p. 남은 원인: 짝 구조 자체 (아래 표본은 문턱 0 의 균형 중간 코드 `137f7d1`) — 강제 fire/std 의 소화 시각 164 → 200초대·모든 방 수색 확인 119 → 135초(16교대), 화재 사건의 '도착 뒤 숨진 구조 대상' 78 → 100(90교대)·소실률 평균 0.147 → 0.209(소실률 60% 넘는 화재 7 → 21) · 구조 대상 발견 p75 41 → 60초(30교대 강제). 짝이 한 방씩 함께 다니므로 실내에서 동시에 하는 방의 수가 짝의 수이고, 첫 출동의 펌프차(D8)는 손을 늘려도 이 수를 늘리지 못한다(밖에 손 빈 대원이 더 선다). '짝 없이 들어가지 않습니다'(F04c)가 강제 fire/std 30교대에 354번(평균 4초).
2. 대원 부상 0.183 → 0.283/교대(위 6 — 경찰은 잡음 안팎, 소방은 짝 동행·혼자 들어간 기관원).
3. split 0.424(≥ 0.5) — 합친 뒤 0.412 와 거의 같다(이번 작업은 행동 갈래를 더하지 않았다).
4. 교대당 시간 1.46× / 1.26×(≤ 1.15). 합친 뒤 1.93× / 1.58× 에서 줄었다(사건이 짧아진 몫 + 게으른 칸). 남은 판단 비용(프로파일 6교대, 게으른 칸 전): docCtx 포함 11.6%(합친 뒤 14% — 그 가운데 __name 4%를 게으른 칸이 덜었다) · pickAct 9% · fitFor 8.8%.
5. 수난 −5.4%p · 붕괴 +5.8%p (보통 60 — 둘 다 범위 ±5 를 조금 넘는다. n 37·69 라 표본 하나가 1.5~2.7%p 다. 보통 120 에서는 수난 76.3%(기준 81.5) · 붕괴 73.8%(기준 71.4)).
6. 어려움 −6.2%p · 극한 −5.6%p(무대응 2 → 17) · 장비 불량의 화재(예비 펌프 0 — 설계서의 표).

**관문** (`npm run check`, `2b9638d`, 다른 작업이 없는 기계): **통과** — `tsc` 통과, vitest 19 파일 869 통과·건너뜀 1, `sweep 40 --check` '검증 통과'. 같은 코드의 문턱 0(`4deca5a`)에서는 `tests/sim.test.ts` 둘이 깨졌다('추격전' 놓침 > 0 · '선착 대응' — 뒤의 것은 위 3-d 로 고쳤다). 1단계(`SOLO_IN` true 만)에서는 `tests/crews.test.ts` ⑤ '구출은 유압 구조대원이'(0.475 < 0.5 — 그 넷의 교대가 다른 사건으로 바뀐 몫)가 깨졌고, 지금은 통과한다(시드에 기대는 시험이다 — 문턱 0 코드에서 0.61).

**이어받을 자리**: ① 화재 범위(−6)를 넓힐지, 짝 구조를 더 덜어 낼지(예: 짝 동행이 짝 곁의 다른 방 일을 함께 맡기 — 지금은 같은·이웃 구역의 빈 일만 `pairAlt`·`pairAssign`) 사용자 결정. ② 장비 불량(장비 1)의 예비 펌프 0 을 1 로 할지(§2.1 의 표 — 보통 교대는 바뀌지 않는다). ③ 속도(≤ 1.15)는 판단 입력(docCtx)의 재사용이 다음 손이다 — 같은 틱의 `docDuty`·`docAct` 가 같은 자기 모드 입력을 두 번 만든다.


### 속도 — 2026-11-16

브랜치 `wf/doctrine-speed`(시작 `255c3a4`) → `wf/doctrine` 가리킴. **결과를 바꾸지 않는 최적화만** — 아래 해시 목록이 커밋마다 시작점과 한 글자도 같다(`a.rng`·`s.rng` 를 포함한 모든 난수의 소비 순서도 같다 — 같지 않으면 교대 해시가 갈린다). 측정 도구는 scratchpad `wf-doctrine/fix/spd/`(`hl.ts`·`hlall.sh` 해시 목록 · `timing.sh` 교대당 시간 · `bundle.sh` 줄 단위 프로파일용 묶음 · `lines.cjs`·`cmp.cjs`·`callers.cjs` 프로파일 읽기 · `load.ts` 일의 양 · `count.ts` 계측 사본의 docCtx 횟수 · `union.cjs`·`outer.cjs` 교본 파일의 몫과 입구 · `pershift.cjs`·`compcmp.cjs` JIT 컴파일·탈최적화 · `diag2.tpl`·`diag3.tpl` 객체의 V8 지도), 기준 사본은 `wf-doctrine/par/fire/b34`(3·4·5 작업자와 같은 `34d30a3` 의 git archive), 시작점 사본은 `fix/spd/ref`.

| 커밋 | 내용 |
|---|---|
| `7d84fbc` | 자주 도는 함수 안의 이름 붙은 닫힘을 모듈 함수로 — `agents.fitBase`(fireRisk·risky)·`perceive`(sees)·`grid.astar`(cost·isGoal·hfn)·`commander.syncBoard`(loadsQueued·treatsDone·clear, 지휘 규칙 도구 `CommandKit` 는 지휘관마다 한 번)·`executor.interiorStep`(inside)·`ops.targetTile`(at) |
| `4c5dad4` | 교본 엔진 — 대원마다 한 번 추린 줄 목록(`AgentDoc`) · 한 판단의 입력 함께 쓰기(`docThink`) · `docFit` 의 값만 셈 · `docDrop` 의 drop 줄 색인 · 색인 열쇠·효과 배열·장비 판정의 할당 없애기 · `docSit` 의 동료 반복 다섯을 하나로 · `selfReport` 의 서명 글자 |
| 그다음 커밋 | 이 메모 |

**해시 목록** (`hl.ts` — 교대마다 `report.hash` · `JSON.stringify(report)` 의 FNV · `logHash` · 끝난 틱): 보통 S0~S39 · 어려움 S0~S19 · 극한 S0~S19 · 재난 다섯(태풍·홍수·지진·산불·해일) × S0~S2 · 강제 여덟(fire/std·hazmat/std·armed/hostage·armed/siege·armed/bomb·medical/trauma·traffic/bus·water/std) × S0~S2 · 부대 규모 1·5 × S0~S2 = **125교대**. 시작점(`h-ref`) ↔ 첫 커밋(`h-g1`) ↔ 엔진(`h-e1`) ↔ docSit·selfReport(`h-e2`, 둘째 커밋의 코드): `diff` 0줄.

**찾은 것** (측정 — 고치기 전에):
1. **일의 양 자체가 늘었다 — 결과의 몫이라 줄일 수 없다.** 보통 S0~S19(`sweep 20` 과 같은 교대)의 (활동 대원 × 틱) 1,161,747 → 1,540,850 (**1.33×**), 열린 현장 × 틱 1.09×, 열린 작업 × 틱 1.20× (`load.ts`, 기준 ↔ 시작점). D8 의 펌프차·짝 동행·길어진 화재로 현장에 대원이 더 오래·더 많이 있다. 대원 한 명의 판단·실행 비용이 기준과 같아도 교대당 시간은 1.2~1.3× 가 된다 — §8.2 의 1.15× 는 교본의 판단 비용만 줄여서는 닿지 않는다.
2. **헤드리스 실행기(tsx)의 `__name`**: esbuild 의 keepNames 가 함수 **안에서** 이름 붙은 닫힘(`const f = () => …`, 객체 칸의 화살표)을 만들 때마다 `__name` → `Object.defineProperty(f, 'name')` 를 불러 함수 객체를 사전 모드로 바꾼다 — 보통 3교대 실행(한 번의 도시 생성 포함)에 43만 번(`node --log-maps` 의 `NormalizeCached`, 거의 모두 이것 — 교대 중에는 초당 약 2만 5천 번), 프로파일 자기 시간 3.9%(6교대). 브라우저 빌드에는 없는 비용이지만 `sweep`·`npm run check` 는 tsx 로 돈다. 2단계·균형 작업자가 DocCtx 의 게으른 칸에서 찾은 것과 같은 원인이 교본 밖의 자주 도는 함수에도 있었다.
3. **사용자 CPU 의 절반 이상은 JIT 의 다시 컴파일이다**: `node --single-threaded`(컴파일을 주 스레드에서)로 돌리면 벽시계가 사용자 CPU 와 같아진다(묶음 6교대 8.3 → 22초). TurboFan 컴파일 시간·탈최적화(`--trace-opt --trace-deopt`, 보통 3교대): 기준 6.9초·550번 → 시작점 9.9초·842번 → 이 작업 뒤 10.3초·834번. 탈최적화는 대부분 'wrong map' — 현장·대원·작업·구조 대상·부대 객체의 숫자 칸이 Smi 로 만들어졌다가 시각(`sim.t`)·소수가 들어가며 Double 로 바뀌어 지도가 낡는다(deprecated — `diag3` 의 `%DebugPrint`: 낡은 지도의 객체가 남는다) · 새 사건 종류가 교대 중간에 처음 나와 새 길을 탄다(7번째 교대에도 311번). 교본의 작은 함수도(agentOf 17번 …) 대원 지도가 바뀔 때마다 다시 컴파일된다. 키 목록·순서는 모든 객체가 같다(`diag.tpl` — "자주 도는 객체의 모양" 규칙은 지켜져 있다). **이 작업은 고치지 않았다**(아래 남은 큰 몫).
4. 교본 판단의 횟수 (계측 사본 `count.ts`, 보통 4교대): docCtx 26.6만 번(fit 8.4만 · act 8.4만 · duty 5.5만 · methodFit 3.4만 · 판단 지점 0.8만), 틱마다 담는 상황(`docSit`) 10.7만 · 자기 몸(`stateSelf`) 9.1만 · 보고 모드(`stateReported`) 4.2만 번.

**한 것**:
- **이름 붙은 닫힘을 모듈 함수로** (`7d84fbc` — 교본 밖 공용 파일, 식과 부르는 순서는 그대로): `agents.fitBase` 의 `fireRisk`·`risky` → `fitRisk`·`fitRiskyAt`, `perceive` 의 `sees` → `seesAt`, `grid.astar` 의 `cost`·`isGoal`·`hfn` → 모듈 변수에 이번 탐색의 값을 두는 `aCost`·`aGoal`·`aH`(astar 는 재진입하지 않는다 — 모듈 버퍼), `commander.syncBoard` 의 `loadsQueued`·`treatsDone`·`clear` → `loadsQueued(s, uid)`·`treatsDone(s, cid)`·`clearCas(s, cid, kinds)`, 묶음별 지휘 규칙에 넘기는 `CommandKit` 은 `commandKitOf` 가 지휘관(현장 대원 객체)마다 한 번 만든다(닫힘이 잡는 sim·s·I·a 가 그 대원에게 늘 같다), `executor.interiorStep` 의 `inside` → `regionIndoor`, `ops.targetTile` 의 `at` → `tileAtPt`.
- **교본 엔진** (`4c5dad4` — `doctrine.ts`·`brain.ts`·`doctrineRun.ts`):
  - **틱마다 담는 상태·상황(ch.self·rep·sit)이 계산되는 순간을 바꾸지 않는다** — 이 값은 그 틱에 그 대원의 입력을 처음 만드는 순간의 것이고, 그 뒤 같은 틱의 다른 부름(지휘관의 배정·실행기의 판단 지점)이 함께 쓴다. 사이에 다른 대원·자기 판단이 상태를 바꾸므로, 입력을 만드는 자리를 늦추거나 건너뛰면 결과가 바뀔 수 있다. 그래서 아래의 줄이기는 모두 "예전에 입력을 만들던 바로 그 자리에서 만든다"를 지킨다.
  - **`AgentDoc`** (대원마다 한 번 — `agentDocOf`): 교본 분야·역할·역할 묶음·혼자 서는 역할·장비 읽기(c.has·c.kit — 2단계의 KIT_FN 을 옮겼다), 그리고 자리·일마다 '누구' 칸(`whoMay`)이 걸릴 수 있는 줄만 추린 목록(`agentRules`). 명부의 역할·부서·부대는 교대 중에 바뀌지 않는다(시험이 바꾸면 `docForget()`), 등록이 바뀌면(줄 수 · `docForget()`) 세대 `GEN` 으로 다시 만든다. 예전 반복이 `whoMay` 로 건너뛰던 줄만 빠지므로 입력을 처음 만드는 자리(= 처음 '누구'가 걸린 줄)도 그대로다. `docFitRules`·`docFit`·`pickAct` 가 쓴다. 이미 추린 줄에는 `applies` 대신 '누구'를 다시 보지 않는 `appliesKw`.
  - **`docThink`** (한 판단의 입력 함께 쓰기): `brain.think` 의 의무(`docDuty`)·후퇴 바꿔 끼우기(`docRetreat`)·행동 후보(`docAct`)가 자기 모드 입력(w 없음) 하나를 함께 쓴다. 그 사이에 상태를 바꾸는 것은 지휘관 지시가 사라질 때의 `a.orderWork = -1` 하나뿐이라(짝의 일 `pairOf` 의 ordered 가 읽는다) 그때만 짝 칸을 새로 잰다. dng·dngSign 은 부를 때마다 그 값으로 덮는다. 시험처럼 think 밖에서 부르면(th 없음) 예전대로 부를 때마다 만든다.
  - `docFit` 은 걸린 줄 목록(`hits`)을 만들지 않고 값만 센다(`docFitRules(…).fit` 과 같은 식·같은 곱셈 순서). `docDrop` 은 drop 효과가 있는 fit 줄을 일마다 한 번 추린다(`dropRules` — 예전에는 부를 때마다 줄마다 `effectsOf(r).filter(…)` 배열을 만들었다).
  - 할당 줄이기: 줄 색인의 열쇠를 글자 잇기(`hook + '|' + work`)에서 두 단 Map 으로, 효과가 하나인 줄의 배열을 효과 객체마다 한 번(`ONE_EFFECT`), 장비 판정의 `some((id) => …)` 닫힘 대신 `anyUsable`, 같은 용의자를 맡은 동료가 없으면 얼린 공용 `NO_PACK`(줄은 읽기만 한다).
  - `docSit`: 동료를 보는 반복 다섯(해체 중 · 섬광탄을 가진 경찰 · 다른 구급 대원(수·1급·곁의 처치 대상) · 작동하는 로봇 · 공기호흡기)을 하나로, 위협 고르기 반복에서 총기·교전 위협도 센다 — 같은 거름·같은 순서라 값이 같다(`robotOnScene`·`scbaCount` 는 지웠다).
  - `selfReport`: 서명이 그대로면 서명 글자를 만들지 않고 견준다(`sameSig` — `crewSigOf` 와 같은 비교).

**수치**:

| | 기준 `34d30a3` | 시작점 `255c3a4` | 이 작업 뒤 | §8.2 |
|---|---|---|---|---|
| 교대당 시간 (`sweep 20 --no-metrics`, 셋을 번갈아 3번씩 — 벽시계 / 사용자 CPU) | 12.73초 / 31.72초 | 19.37초 / 41.83초 (**1.52× / 1.32×**) | 17.47초 / 39.42초 (**1.37× / 1.24×**) | ≤ 1.15 ✗ |
| 줄인 몫 (시작점 대비) | — | — | 벽시계 −9.8% · 사용자 CPU −5.8% | |
| 묶음 20교대 (esbuild `--keep-names` 한 파일, tsx 없이 — 교대별 벽시계 합) | 11.9초 | 19.2초 (1.61×) | 17.4초 (1.46×) | |
| 그 가운데 뒤 10교대 (S10~S19 — JIT 가 데워진 뒤) | 4.5초 | 7.5초 (1.67×) | 6.2초 (1.38×) | |

같은 날 균형 작업자가 잰 값(1.46× / 1.26×)과 시작점 열이 조금 다른 것은 기계의 상태 차이다 — 위 표는 같은 시각에 셋을 번갈아 돌린 값이다.

프로파일 (묶음, 보통 S0~S5, `node --cpu-prof` — 포함 시간 ms, 시작점 → 이 작업 뒤; 기준은 `step` 4742):
- 전체 `step` 8550 → 7386 · `think` 4137 → 3539 · `act` 2002 → 1696 · `commanderThink` 1093 → 1005.
- 교본: `pickAct` 670 → 495(그 가운데 입력 만들기 `thinkCtx` 329 — `stateSelf` 101 · `docSit` 208 은 다른 부름과 함께 · `pairOf` 136) · `docCtx` 757 → 533 · `fitFor` 765 → 439(`docFit` 378 → 237) · `docFitRules` 453 → 127 · `applies` 280 → `appliesKw` 231 · `docSit` 252 → 208 · `baseState` 149 → 109 · `methodFit` 167 → 99 · `runPair` 255 → 200.
- 닫힘: `__name` 409 → 118 · `fitBase` 410 → 185 · `astar` 391 → 315 · `syncBoard` 575 → 495 · `interiorStep` 46 → 5.
- **교본 파일(`field/doctrine*`·`orders/doctrine`·`dispatch/doctrine`)의 함수가 쌓임에 있는 표본의 합** (`union.cjs` — 겹치지 않는 포함 시간, 그 함수가 부른 이동·믿음 읽기도 든다): 기준 452ms(`step` 의 9.5%) → 시작점 1932ms(22.6%) → 이 작업 뒤 1525ms(20.6%). 입구별(`outer.cjs` — 가장 바깥 교본 함수 ← 부른 곳): `docDuty` ← think 306(그 판단의 입력을 처음 만드는 곳 — 틱마다 담는 상태·상황이 여기서 계산된다) · `docFit` ← fitFor 234 · `docAct` ← think 227 · `runPair` ← runTask 199 · `docFitRules` ← 배정 127 · 지휘 교본 54 · selfReport 46 · rebuddy 42 · interiorEntry 판단 지점 38 · laneHold 38 · splitSettle 37 · methodFit 의 입력 27.

**남은 큰 몫** (1.15× 에 닿지 못한 까닭 — 크기 순):
1. **일의 양 1.33×** (찾은 것 1 — 결과의 몫). 대원 한 명당 비용이 기준과 같아져도 1.2~1.3× 다. 위 프로파일에서 교본 파일의 몫(1525ms)을 통째로 빼도 `step` 은 5861ms — 기준 4742ms 의 1.24× 다.
2. **JIT 다시 컴파일** (찾은 것 3): 사용자 CPU 의 절반 이상이고 기준보다 +3.4초/3교대. 교본이 더한 함수·분기가 많아 컴파일할 것이 늘었고, 객체의 숫자 칸이 Smi → Double 로 바뀌며 지도가 낡을 때마다 큰 함수(perceive 1052ms·tickUnits 757·tickScene 688 — 3교대의 컴파일 시간)가 다시 컴파일된다. 고치려면 자주 도는 객체(대원·작업·임무·구조 대상·부대·현장)의 시각 칸이 처음부터 같은 표현으로 시작하게 해야 한다(예: 시각 칸의 처음 값) — 결과와 무관하지만 공용 객체 여럿을 건드리므로 이번에는 하지 않았다.
3. **틱마다 담는 교본 상태** (`docSit` 208 · `stateSelf` 101 · `baseState` 109 · `stateReported`): 그 틱에 입력을 처음 만드는 순간에 계산해야 결과가 같다(위 '한 것'의 첫 줄) — 게으르게 미루거나 건너뛸 수 없다. 남은 손은 계산 자체를 싸게 하는 것뿐이다(믿음 목록 `beliefs.list` 의 배열 할당 · 사건 종류마다 쓰이지 않는 칸).
4. 교본의 나머지: `pickAct` 의 줄 술어 평가(`appliesKw` 231 — G08·F02 의 `pairOf` 136), 짝 동행 실행 `runPair` 200(`followMate` → `moveTo` — 짝이 1칸 넘게 움직이면 경로를 다시 짠다), 배정의 `docFitRules` 127, 지휘 교본 ~60, 판단 지점 77.
5. 교본 밖(기준에도 있는 비용, 일의 양만큼 늘었다): `perceive` 809(불 칸 훑기의 칸마다 시야선) · `moveTo`/`astar` 579/315 · `syncBoard` 495 · `tickUnits` 287 · X6 위험 규칙 ~450.

**설계서 밖에서 고친 공용 파일** (모두 결과 같음 — 해시 목록): `agents.ts`(`fitBase` 의 닫힘 → `fitRisk`·`fitRiskyAt`, `perceive` 의 `sees` → `seesAt`), `grid.ts`(`astar` 의 닫힘 → `aCost`·`aGoal`·`aH` 와 모듈 변수), `commander.ts`(`loadsQueued`·`treatsDone`·`clearCas`·`commandKitOf`), `executor.ts`(`regionIndoor`), `ops.ts`(`tileAtPt`), `brain.ts`(`docThink` 를 의무·후퇴·행동 후보에 넘긴다). 시험은 고치지 않았다.

**관문** (`npm run check`, `4c5dad4`, 다른 작업이 없는 기계 — 10분): **통과** — `tsc` 통과, vitest 19 파일 869 통과·건너뜀 1, `sweep 40 --check` '검증 통과'(한계 시간 3 · 방치 1 · 교착 후보 0 · 잊힌 사건 0 · 기록 일치 0).

**이어받을 자리**: ① JIT — 자주 도는 객체의 시각·소수 칸을 처음부터 Double 로 시작하게 하면(만드는 리터럴 한 곳씩) 지도가 낡는 일이 줄어 사용자 CPU 의 큰 몫이 줄 것이다(측정: `fix/spd` 의 `pershift.cjs`·`compcmp.cjs`·`diag3.tpl`). ② `docSit` 의 칸 가운데 그 사건 종류의 줄만 읽는 것(섬광탄·로봇·공기호흡기 수 …)을 종류마다 셀지 — 그 칸을 읽는 줄·엔진이 다른 종류에서 읽지 않는다는 것을 먼저 확인해야 한다. ③ think 의 후보(`opts`)의 `apply` 닫힘도 tsx 의 `__name` 을 부른다(17ms/6교대 — 작다).
