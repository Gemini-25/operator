# R3 — 분야별 대응 교본: 상황 × 장비 × 상태

공통 규칙은 `docs/specs/README.md`. 브랜치 `wf/doctrine`, 개발 서버 포트 **5219**(H1 5210 · R1 5211 · G4 5212 · R2 5213 · U2 5214 · X6 5216 · I1 5218 다음).

사용자 요청(그대로): "경찰 대원들의 상황별 장비별 상태별 대응, 소방 대원들의 상황별 장비별 상태별 대응, 의료 대원들의 상황별 장비별 상태별 대응, 특수 대원들의 상황별 장비별 상태별 대응 이런게 있으면 좋겠다는거야"

한 줄로: 네 분야(경찰·소방·의료·특수)마다 **상황**(사건 유형과 현장 국면) × **장비**(그 대원이 든 개인 장비와 부대 장비의 유무·잔량·알려진 고장) × **상태**(자기 몸·공기·탄·지구력·동요·경험, 짝이 있는가, 지원이 오는가)에 따라 "무엇을 먼저 하는가"를 정한 **교본 표**를 두고, 대원·지휘관·관제가 그 표로 고른다. 관찰자는 기록 문구·머리 위 라벨·대원 정보창·보고서 문장으로 "같은 상황인데 이번엔 장비가 없어서 / 다쳐서 / 혼자라서 다르게 했네"를 본다.

**선행 관계**: 구현 순서는 `docs/ROADMAP.md` "진행 중"대로 R1(편성·개인 장비·헬기) → H1(부상과 사망) → X6(위험의 현실화) → R2(대응 방법) → **R3** → I1-b → I2 이고, G4·G5·U2 는 따로다. 그래서 다음 구현 세션이 R3 를 시작할 때는 **R1·H1·X6·R2 와 G5(어쩌면 G4)가 이미 합쳐져 있다**고 본다. 이 문서는 같은 날 쓰인 `R1-crews.md`·`R2-methods.md`·`H1-injuries.md`·`X6-catastrophe.md`·`G4-scene-legibility.md`·`G5-combat-fx.md`·`I1-causality.md`·`I2-persistence.md` 를 읽고 그 이름·자료형을 그대로 썼다. 이름이 어긋나면 **먼저 합쳐진 쪽(R1 > H1 > X6 > R2)의 실제 코드**를 따른다.

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
| `src/sim/field/doctrine.ts` | **판단부 엔진**: 분야 판정 `docDeptOf`, 판단 입력 `docState`·`docSit`·`docCtx`, 걸리는 자리 `docFit`·`docFitRules`·`docDuty`·`docAct`·`docMethodMul`·`docGate`, 바탕 `coverSpot`·`buddyOf`·`outsideWatch`·`ammoOf`, 상수 표 `DOC` | **안 된다** — 테스트가 금지어를 검사한다(2.4) |
| `src/sim/field/doctrine/{common,police,fire,ems,special}.ts` | 분야별 교본 줄(3절). `registerDoctrine` 만 부른다 | **안 된다**(줄은 `DocCtx` 만 받는다) |
| `src/sim/field/doctrine/index.ts` | 다섯 파일을 이 순서로 import(등록 순서 = 같은 순위의 줄끼리 이기는 순서) | — |
| `src/sim/field/doctrineRun.ts` | **실행부**: 새 임무(`cover`·`rearm`·`airOut`·`pairOut`·`pair`·`triage`)의 실행, 탄약 소모·재장전(`fireRound`·`reloadTick`), 자기 신고(`selfReport`), 짝 다시 맺기(`rebuddy`), 기록(`recordDoc`) | 된다(`executor.ts` 와 같은 자격) |
| `src/sim/field/orders/doctrine.ts` | 지휘 교본(6.1의 새 줄): `registerOrders` | 안 된다(`tests/ext.test.ts` 가 이미 검사한다) |
| `src/sim/dispatch/doctrine.ts` | 관제 교본(6.2): 부대 고르기 가산 `dispatchPref`, 수요 보정 `docNeeds`, 추격 역할 `chaseRoles` | 안 된다(관제 — 평가·조직 정보만) |
| `tests/doctrine.test.ts` | 10절 | — |

**공용 파일 수정**: 11.1 의 표에 함수와 이유를 모두 적었다. 그 밖의 곳을 고쳐야 하면 고치되 끝낼 때 보고에 파일·함수·이유를 적는다.

**건드리지 않는다**: `city.ts`·`cityPlan.ts`, `builders.ts`·`field/scenes/{crime,major,disaster}.ts`(현장 생성은 그대로), `field/injury.ts`(H1 — 부르기만), X6 의 `catastrophe.ts`·`ops.ts`(읽기만 — `orders/catastrophe.ts` 의 `DANGER_RULES` 에 줄 두 개를 더하는 것만 예외, 6.1), R1 의 `field/rules/air.ts`·`field/airDecide.ts`, `tests/sim.test.ts`, `README.md`·`CLAUDE.md`·`docs/ROADMAP.md`(합친 뒤에 한꺼번에).

---

## 0. 지금 상태 — 무엇이 이미 갈리고 무엇이 갈리지 않는가

(조사 기준 2026-11-14. 오른쪽 열은 R1·H1·X6·R2 가 문서대로 들어왔을 때.)

| 분야 | 지금 상황·장비·상태로 갈리는 것 | 갈리지 않는 것 | R1·H1·X6·R2 뒤 |
|---|---|---|---|
| 경찰 | 섬광탄 유무(던질 자리로 / 동료를 7.5칸에서 기다림 / 쏘지 않고 덮침 — `executor` `case 'engage'`), 인질 1.7칸 안 사격 보류, 무기(총 / 흉기·맨손)로 협상·진입 문턱, 용의자 상태로 검거 시간, 머릿수 문턱(≥2·≥3·≥4 — `commander.syncBoard`), 체력 < 40 후퇴, 피격 3초 안 · 엄폐 아님 · 체력 < 70 이면 침착함만큼 후퇴(`brain.dangerScore`) | 순찰·기동·특공·폭발물이 같은 코드(부대 수치만 다르다). **탄약이 없다**(사격 무제한). **엄폐를 찾지 않는다**(교전은 아무 7.5칸 자리, 후퇴는 대기 지점까지). **혼자인가를 보지 않는다**(방 진입은 4초 뒤 혼자, 동시 진입은 +8초 뒤 혼자, 흉기 상대 검거는 25초 대치 뒤 혼자도). 짝이 없다. 다친 대원도 같은 일(`fitFor`·`assign` 이 체력을 보지 않는다). 흉기 상대는 늘 곧장 덮친다. 협상자는 용의자가 교전해도 서 있다. 추격 차량은 모두 같은 알려진 위치로 간다 | R1: 테이저·방패·저격 거리·역할 선호, 인원 문턱(총기 && 역할 묶음 `bomb` 제외), 섬광탄 사람 몫. R2: 비살상탄·결정적 저격·irons/ram·대피 방송, 교전 분기의 기록 이름. H1: `hurtF`, 출혈 후퇴, 몸싸움. X6: 출입 통제 |
| 소방 | 경로 위 불(진압하며 지나감 / 우회), 펌프 고장 → 예비 펌프, 물 소진 → 소화전, 지구력 < 22 휴식(40 까지 붙잡음), 체력 후퇴, 침착함 배율, 운반 중이면 버팀 | **공기 개념이 없다**(연기 속에 무한정). **2인 진입·밖 대기조가 없다**(수색 작업 `max 1` — 혼자 실내로). 후퇴 뒤 곧바로 같은 곳으로(재진입 기억 없음). 다친 대원에게 가벼운 일이 없다. 예비 펌프 무제한. 소화전 없는 현장의 대체 행동 없음. 펌프 고장도 '용수가 떨어짐' 요청. 신입·베테랑은 속도만 다르다. 지원이 오는 중인지가 개인 행동을 바꾸지 않는다 | R1: 공기(`scba` 의 `uses`)·`swapAir`(60초)·`uses < 45` 면 위험 실내 0·열화상·유압 장비·펌프 조작. R2: 외부 방어·고가 방수·소화기·배연, 문·구출·수난의 갈래. H1: 화상·열 탈진·추락. X6: 조짐·위험 단계·철수·외부 방어·`a.avoid` |
| 의료 | 현장 처치 / 먼저 옮기기(위험 현장·안전 확보 전·구급 유무), 응급 현장의 "누구든 먼저 처치", 기본 처치 뒤 재처치는 구급만, 탑승 우선도·출발 조건, 구급 요청 문턱 | 처치가 하나뿐(심정지·외상·실신이 같은 "응급 처치"). **분류(트리아지)가 없다.** **처치와 이송이 겨룬다**(처치 중인 환자를 다른 대원이 들어 간다 — S3 사건 01·02). 처치를 넘겨받지 않는다. 안전 확보 전에는 **안전 구역의 환자도** 구급이 못 본다. 차로 위 처치의 위험을 기다리지 않는다. 다친 구급대원의 행동이 같다. 구급 지휘관이 타고 떠나면 '지휘 불능' | R1: 가방·제세동기·들것·척추 고정판·의료 헬기·환자 자리. R2: 현장 안정(`stay`)·즉시 이송(`rush`)·헬기 이송 기록. H1: `treatMate`, `manageAmbulances` 의 믿음화, `treatEffect` |
| 특수 | 섬광탄(특공 +2), 방호 수치, 해체는 처리반만, 피해 배율 | 특공·기동·순찰·폭발물이 같은 경로(폭발물 처리반이 인질극 진입을 이끈다 — S7). 폭발물 처리가 한 가지(로봇·방호복·대피 반경 없음). 화학 구조차가 가스 누출 수요로 오지 않는다(20교대 출동 49건 모두 구조 수요). 헬기는 늘 내려앉는다. 구조정은 배로 쓰이지 않는다. 사다리차는 펌프차와 같다 | R1: 특공 다섯 역할·로봇·방호복·헬기 세 종류·호이스트·물 투하. R2: 보트·고가 방수·배연·저격·비살상탄. X6: 측정기로 읽는 가스 조짐 |

**R1~R2 뒤에도 비어 있는 자리** — 이 문서가 채운다:

1. 탄약(재장전·재보급)과 엄폐 자리 찾기 — 바탕이 아예 없다.
2. 혼자인가·짝이 있는가·지원이 오는가 — 어떤 판단도 보지 않는다.
3. 다친 대원의 일 바꾸기 — H1 은 느려지고(`hurtF`) 물러나는(`health < 40`) 것만 정했다. 그 사이(체력 41~70)의 대원은 같은 일을 한다.
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

| 설계서 | 겹치는 곳 | R3 가 새로 정하는 것 | 가리키기만 하는 것 |
|---|---|---|---|
| R1 편성·개인 장비·헬기 | 역할 36·장비 35(`KITS`), 공기·섬광탄·테이저, 헬기 세 종류, 인원 문턱 | ① 탄약(`KitDef.mag`·`reload`·`perShot`, 총기 `uses`, `KitItem.mag`, `Unit.ammoBox`) ② 공기 탈출 문턱(`AIR_OUT`·`AIR_IN`)과 `swapAir` 후보의 문턱 하나 ③ 짝 묶음 표(`PAIRS` — 자리 순서) ④ 인원 문턱을 "쓸 수 있는 경찰"로(6.1 CP1) ⑤ 예비 펌프 수(`Unit.sparePump`) | 역할·기본 장비·장비 효과, `hasKit`·`kitUses`·`toolFor`·`crewHasKit`·`capableOf`(판단용)과 `kitWorks`·`useKit`·`toolUse`(효과용)의 나눔, `swapAir` 의 실행, 헬기의 상공 판단(`airDecide.ts`) |
| R2 대응 방법 | 방법 틀(`METHOD`·`chooseMethod`·`MethodWhy`), 실패 기억 `a.mfail`, 선택 임무 | ① `MethodCtx` 에 교본 입력 칸(`dc: DocCtx`) ② 점수에 교본 배율(`docMethodMul`)을 곱한다 ③ `MethodWhy` 에 다섯(`hurt`·`alone`·`lowAir`·`lowAmmo`·`shaken`) ④ 방법 행 열 개(위) — R2 가 "R3 몫"으로 넘긴 이송·교통 통제의 방법, 그리고 수색·진압·해체 몇 갈래 | 방법을 바꾸는 세 때, 도착 재선택, 기록 문구 `SAY`, `recordMethod`, `mrng` 흐름, `gear.ts` 의 판단용 `kitCount` |
| H1 부상과 사망 | 다친 대원의 행동, 동료 처치, 트리아지 순서 | ① 체력 41~70(중상) 대원의 **일 바꾸기**(가벼운 일 — 공통 G01) ② 자기 신고 사실 `crew`(지휘관이 남의 체력을 직접 읽지 않게 — 2.4) ③ 동요(`a.shaken`) ④ 의료의 분류 임무 `triage`(H1 §6.2 의 우선도 표는 그대로, 분류는 그 앞 단계) | `bandOf`·`hurtF`·`r.bleed`(자기 몸), 믿음 술어 `mateNeedsHospital`, 출혈 후퇴 조건, `rescueMate`·`treatMate` 의 자격 |
| X6 위험의 현실화 | 철수 판단, 위험 구역, 외부 방어 | `DANGER_RULES` 에 **장비 조건이 붙은 줄 둘**(표의 모양은 그대로 — 6.1 CF5·CF6), 교본의 의무(`airOut`)를 X6 의 `evacuate` 의무 **뒤**에 둔다(2.6) | 조짐·`signDanger`·`selfDanger`·`evacuate`·`a.avoid`·`registerGate`·제한적 구조 진입(`w.risky`), 외부 방수 자리 |
| G4 현장 가독성 | 현장 그림 | 없음(R3 는 현장 고정 층·위험 표지를 건드리지 않는다) | — |
| G5 교전 연출 | 사격·엄폐·진입 그림 | ① `cover` 임무의 자세(G5 의 겨눔 자세를 그대로 쓴다) ② 재장전 중에는 사격 기록(`recShot`)이 나지 않는 것뿐 | 사격·섬광탄·진입의 그림과 소리 전부 |
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
export type DocWhy = 'alone' | 'buddy' | 'outside' | 'hurt' | 'tired' | 'shaken' | 'lowAir' | 'lowAmmo' | 'noKit' | 'kit' | 'civ' | 'hostage' | 'danger' | 'triage' | 'backup' | 'protocol';
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
// WorkKind 끝에 새 줄 — 4단계
  | 'triage';                               // 다수 사상자 분류 (구급만)
// MethodId 끝에 새 줄 (R2) — 3·5·6단계 (METHOD 가 Record 라 행을 함께 둔다)
  | 'feel' | 'pulse' | 'pack' | 'drag' | 'litter' | 'post' | 'blockLane' | 'robotDefuse' | 'suitDefuse' | 'bareDefuse';
// MethodWhy (R2 — 한 줄 합집합, 그 줄 끝에)
  | 'hurt' | 'alone' | 'lowAir' | 'lowAmmo' | 'shaken'
// KitItem (R1)
mag?: number;                               // 총기: 지금 탄창에 남은 탄 (uses 는 가진 탄 전부 — 탄창 포함)
// FieldAgent
buddy?: number;                             // 짝의 rid (-1 = 짝 없음). makeAgent 가 PAIRS 로 정하고 rebuddy 가 다시 맺는다 (5절)
doc?: { rule: string; act: DocActId; since: number } | null;   // 지금 따르는 교본 행동 (패널·계속 점수)
docMem?: { rule: string; key: string; until: number }[];       // 접은 교본 줄의 기억 (그 시각까지 같은 대상에 다시 걸지 않는다)
shaken?: number;                            // 동요가 끝나는 시각 (없거나 지났으면 동요 아님)
shakenOff?: number;                         // 동요가 끝난 시각 — 10초 동안 다시 동요하지 않는다
reloadUntil?: number;                       // 재장전이 끝나는 시각 (그 전에는 쏘지 않는다)
crewSig?: string;                           // 마지막으로 신고한 몸 상태의 서명 (같은 신고를 되풀이하지 않는다)
// Task
docRule?: string;                           // 이 임무를 연(또는 막고 있는) 교본 줄
gateAt?: number;                            // 판단 지점에서 막히기 시작한 시각 (-1 = 막히지 않음)
gateSaid?: boolean;                         // 막힘을 이미 알렸다 (한 번만)
// Unit
ammoBox?: number; ammoBoxMax?: number;      // 차에 실은 탄약 상자 (한 상자 = 한 사람의 총기를 가득 채움)
sparePump?: number;                         // 남은 예비 펌프 (지금은 무제한 — 3절 F10)
// Scene
triageAt?: number;                          // 분류가 끝난 시각 (-1 = 아직). 지휘 상태 — s.secureAt 과 같은 자격 (6.1 CE1)
laneShield?: number[] | null;               // 차량으로 막은 통제 지점 (6단계 blockLane)
// Incident
docs?: DocUse[];
trackBy?: 'air' | 'ground' | null;          // 추격전: 지금 차를 보고 있는 쪽 (보고 있으면 그 부대가 위치를 알려 온다 — 공개 정보)
reportedPrev?: number;                      // 그 전에 알려진 교차로 (진행 방향을 아는 데 쓴다)
// ShiftReport
doctrine?: Record<string, number>;          // 이 교대에 교본 줄이 쓰인 횟수 (sweep --doctrine 이 쓴다)
// Tuning (difficulty.ts)
ammoBox: number;                            // 장비 손잡이: [1, 1, 2, 2, 3]
sparePump: number;                          // 장비 손잡이: [0, 1, 1, 1, 2]
```

R1 의 `crews.ts` `KitDef` 에 세 칸: `mag?: number`(탄창 크기), `reload?: number`(재장전 초), `perShot?: number`(한 번 쏠 때 쓰는 탄). 그리고 R2 가 더한 `uses?`(처음 수량)를 총기 셋에 채운다(2.9).

**객체 모양**(CLAUDE.md 함정 "자주 도는 객체의 모양" — 속도만의 문제): 새 선택 칸은 생성 리터럴에도 같은 순서로 넣는다 — `FieldAgent` 는 R1 의 `agents.makeAgent`(`buddy: -1, doc: null, docMem: undefined, shaken: undefined, shakenOff: undefined, reloadUntil: undefined, crewSig: undefined`), `Task` 는 `executor.makeTask`(`docRule: undefined, gateAt: -1, gateSaid: false`), `Unit` 은 편성표·지원 두 리터럴, `Scene` 은 `kit.ts` `baseScene`(`triageAt: -1, laneShield: null`), `Incident` 는 `incidents.createIncident`.

### 2.2 교본 분야와 "누구"

교본 표는 사용자의 네 분야로 나눈다. 대원의 표 분야는 **역할**(R1 `RoleId`)로 정한다(`docDeptOf(sim, rid)`):

| `DocDept` | 역할 | 부대 |
|---|---|---|
| `police` | `patrolLead`·`officer`·`tacLead`·`tacOfficer`·`observer` | 순찰·기동·경찰 헬기 |
| `fire` | `fireLead`·`nozzle`·`firefighter`·`engineer`·`rescueLead`·`extricator`·`searcher`·`ropeTech` | 펌프차·구조 공작차 |
| `ems` | `paramedic`·`emt`·`emsDriver`·`doctor`·`flightNurse` | 구급차·의료 헬기 |
| `special` | `swatLead`·`shield`·`breacher`·`assaulter`·`marksman` · `bombTech`·`robotOp`·`eodGuard` · `hazLead`·`hazTech`·`decon` · `airRescuer` · `boatRescuer` · `ladderLead`·`ladderOp` | 특공·폭발물·화학·소방 헬기·구조정·사다리차 |

- 표의 분야는 **줄을 어느 파일에 두는가**일 뿐이다. 줄이 누구에게 걸리는지는 줄의 `who`(R1 부서 `Dept`·역할·역할 묶음·부대 종류)와 장비 조건(`kits`)으로 정한다. 예: 경찰 표의 흉기 대응 줄은 `who: { dept: ['police'] }` 라 특공·폭발물 대원에게도 걸린다. 소방 표의 공기 탈출 줄은 `kits: ['scba']` 라 화학대·사다리차·소방 헬기 대원에게도 걸린다.
- 사다리차(`ladderLead`·`ladderOp`)를 특수 표에 두는 까닭: 사용자가 든 특수의 예에 "사다리차(고층 구조·고가 방수)"가 있다. 부대 분야(`UnitField 'fire'`)·편성은 R1 그대로다.
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
| ① `fit` — 누가 맡는가 | "이 대원이 이 일을 맡아도 되는가, 얼마나 먼저인가" | `agents.fitFor` 의 **맨 끝**(R1 의 역할 선호 다음): `fit = docFit(sim, s, a, w, fit)` | 배율(`fitMul`, 0 = 금지)·가산(`fitAdd`) | 지휘관의 배정(`commander.assign`)과 대원의 자체 판단(`brain` 7번)이 **둘 다** `fitFor` 를 쓴다. 한 곳에 걸면 "다친 대원은 가벼운 일로", "짝 없이 위험 실내 금지"가 지휘관 지시에도 자체 판단에도 똑같이 걸린다. 맡을 사람이 없으면 B3 의 "맡을 사람이 없는 작업" 블록(R1 `anyCapable`)이 그대로 지원을 부른다 |
| ② `duty`·`act` — 지금 무엇을 하는가 | "작업판의 일 말고, 내 상태 때문에 지금 해야 할 행동이 있는가" | `brain.think`: 의무(`docDuty`)는 X6 의 `evacuate` 의무 바로 뒤, 점수 후보(`docAct`)는 R1 의 공기통 교체 후보 다음 | 상태 행동 하나(`DocActId`)와 점수 | 지금도 상태 행동(후퇴·휴식·예비 펌프·공기통 교체)은 모두 `brain` 의 후보다. 같은 틀에 넣어야 판단 오차·계속 점수·지시와 같은 저울에 오른다 |
| ③ `method` — 어떻게 하는가 | "이 임무를 어떤 방법으로" | R2 의 `chooseMethod` 점수에 `× docMethodMul(dc, m)` | 방법별 배율(0 = 후보에서 뺀다) | R2 가 "R3 는 METHOD 행과 situ 조건을 늘린다, 상태는 `MethodCtx` 에 칸을 더한다"고 정했다. 방법을 바꾸는 때(실패·고장·조건 상실)·기억·기록은 R2 의 것을 그대로 쓴다 |
| ④ `gate` — 실행 중의 판단 지점 | "지금 이 한 걸음(혼자 방에 들어가기, 흉기 상대에게 붙기, 처치 중인 환자 들기)을 해도 되는가" | 실행기의 그 분기에서 `docGate(sim, s, a, gate, sense)` | `{ ok, rule, wait }` — 막히면 실행기가 정해진 대체 행동(그 자리에서 기다림·거리 유지)을 한다 | 이 결정들은 지금 실행기의 분기 안에 있다(`executor` `case 'engage'` 의 "4초 뒤 혼자 진입"). 분기를 판단부로 옮기면 실행 코드가 둘로 갈라진다. 대신 **판단(믿음)은 교본 함수가, 효과(이동·기다림)는 실행기가** 한다 — R2 의 `chooseMethod`/`methodRun` 나눔과 같다 |
| ⑤ `cmd` — 지휘관 | 무엇을 요청하고 무엇을 거두는가 | `orders/doctrine.ts`(`registerOrders`) + `commander.ts` 의 작은 조각 몇 곳(6.1 끝) | 요청·작업·배정 가산 | 지휘 규칙 파일은 이미 "믿음만"이 테스트로 걸려 있다 |
| ⑥ `dispatch`·`chase` — 관제 | 어느 부대를 보내고 추격에서 누가 무엇을 하는가 | `dispatch/doctrine.ts` 를 `dispatcher.pickUnit`·`analyst` 수요·`pursuit.tickPursuits` 의 "알려진 위치로 방향을 바꾼다" 줄이 부른다 | 점수 가산·수요 보정·역할 | 관제 코드(`dispatch/*`)는 이미 진실 금지 구역이다 |

**네 자리가 서로 대신하지 않는 까닭**: ①만으로는 "이미 맡은 일을 하다가 공기가 떨어졌다"를 다룰 수 없다(②). ②만으로는 지휘관이 다친 대원에게 진입을 지시하는 것을 막을 수 없다(①). ③은 일 안의 갈래다. ④는 한 임무 안의 한 걸음이다 — `fit` 을 0 으로 만들면 대원이 일을 놓고 지휘관이 다시 배정하는 왕복이 생기지만, 판단 지점에서 기다리게 하면 임무를 쥔 채 멈춘다.

### 2.4 판단 입력 `DocCtx` — 읽어도 되는 것과 안 되는 것

```ts
// doctrine/registry.ts (타입만)
export interface DocState {          // 대원 자신
  hp: number; band: number; bleeding: boolean;   // ①fit 에서는 자기 신고(crew 사실)의 값, ②~④에서는 자기 몸 (아래)
  stamina: number; fitness: number; composure: number; experience: number; judgment: number; teamwork: number;
  rookie: boolean; veteran: boolean;             // experience < 0.3 · ≥ 0.7
  air: number;                                   // 공기 비율 0..1 (scba 의 uses / tn.airFull). scba 가 없으면 1
  spareAir: number;                              // 자기 부대의 예비 공기통
  ammo: number; mag: number; magSize: number; perShot: number;   // 가진 총의 탄 (총이 없으면 ammo = -1)
  ammoLow: boolean; ammoCrit: boolean;           // 마지막 탄창 / 발사 2회 이하
  reloading: boolean; ammoBox: number;           // 재장전 중 / 자기 부대의 탄약 상자
  shaken: boolean; underFire: boolean; inCover: boolean; carrying: boolean;
  dng: number;                                   // brain 의 위험 점수 (자기 감각 — ② 자리에서 brain 이 넘긴다. 다른 자리에서는 0)
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
  smoke: number; heat: number;                   // Sense — 자기 칸의 감각 (부르는 쪽이 잰다. ①fit 에서는 0)
  ctlDone: boolean[];                            // 통제 지점별 교통 통제 끝 (ctl 사실)
  liveBomb: { x: number; y: number; d: number } | null;   // 믿음 haz bomb active
  patients: number;                              // 믿음: 처치·탑승을 기다리는 band ≥ 1 구조 대상 수
  seatsLeft: number;                             // 현장 부대의 남은 환자 자리 합 (R2 gear.seatsLeft — 조직 정보)
  negotSec: number; entryOrdered: boolean;       // s.negotStart 부터, s.entryOrdered (공개 지휘 상태)
}
export type DocPhase = 'arrive' | 'sizeup' | 'standoff' | 'entry' | 'assault' | 'interior' | 'care' | 'transport' | 'traffic' | 'withdraw' | 'idle';
export interface DocCtx {
  sim: Sim; s: Scene; a: FieldAgent; u: Unit; dept: DocDept; role: RoleId | null; group: RoleGroup | null;
  w: WorkItem | null;                            // ①·④ 의 대상 작업 (없으면 null)
  st: DocState; sit: DocSit;
  kit: (id: KitId) => number;                    // gear.kitCount — 알려진 고장만 반영 (숨은 고장은 모른다)
  m?: { reach: number; flow: number; weak: boolean };      // ③ 방법 자리: R2 MethodCtx 의 그 값
}
```

| `DocPhase` | 정하는 법 (`phaseOf(s, a)` — 자기 임무와 공개 지휘 상태) |
|---|---|
| `arrive`·`sizeup` | 도착 뒤 첫 판단 전 / `sizeup` 임무 |
| `standoff` | `negotiate`·`perimeter` 임무, 또는 `engage` 인데 `!s.entryOrdered` |
| `entry` · `assault` | `engage` 이고 `s.entryOrdered` 이며 출입구 앞 / 출입구를 지난 뒤 |
| `interior` | 위험 건물 실내의 `search`·`suppress`·`extricate`·`carry`·`escort`·`mitigate`·`overhaul` |
| `care` · `transport` | `treat`·`treatMate`·`triage` / `load`·`board(transport)` |
| `traffic` | `traffic`·`clearRoad` |
| `withdraw` | `retreat`·`evacuate`·`airOut`·`pairOut`·`board` |
| `idle` | 임무 없음·`standby` |

**판단부(`doctrine.ts`·`doctrine/*.ts`)가 읽어도 되는 것**:
- 그 대원의 믿음 `a.beliefs`(구조 대상·용의자·불·위험 사실, 동료의 `crew`·`mate` 사실, X6 의 `ops` 사실, `occ`·`ctl`·`secure` 사실).
- 현장의 생김새: `s.tiles`·`s.region`·`s.regions`·`s.exits`·`s.spots`·`s.staging`·`s.safe`·`s.kind`·`s.rules`·`s.outdoor`·`s.controlPts`·`s.stairTo`(R2 와 같은 자격).
- 공개 지휘 상태: `s.secureAt`·`s.entryOrdered`·`s.negotStart`·`s.entryExit`·`s.entryExit2`·`s.triageAt`, `sim.t`, `sim.weather`, `sim.disaster` 의 `kind`·`phase`.
- 조직 정보: 부대 상태 `sim.units`(장비 수치·`spareAir`·`ammoBox`·`sparePump`·`state`·`patients`), `I.assigned`, 명부의 이름·부서·역할·능력치(`skills`·`composure`·`experience`…), 동료의 장비(`kitCount` — 조직이 안다), 남의 공기·탄 잔량(`kitUses` — R1 이 섬광탄·공기를 조직 정보로 정한 것과 같다).
- 동료의 겉: `s.agents` 의 `status`·`task.kind`·`task.workId`·`task.cas`·`x`·`y`·`buddy`(같은 무전망 — R2 와 같은 자격).
- **자기 몸**: `sim.responders[a.rid]` 의 `health`·`bleed`·`stamina`(H1 의 `hurtF`·`bandOf` 도 자기 몸에만), `a.underFireT`·`a.inCover`·`a.shaken`·`a.reloadUntil`·`a.carrying`·`a.task`·`a.docMem`.
- 감각 `Sense`: 부르는 쪽이 **대원이 선 칸에서** 잰 연기·열(`brain.dangerScore` 가 자기 둘레의 `s.fire` 를 읽는 것과 같은 자격 — R2·X6 와 같은 판단).

**읽으면 안 되는 것**(테스트가 글자로 검사한다 — 10절 1): `s.props`, `s.casualties`, `s.hostiles`, `.truth`, `s.fire[`, `s.smoke[`, `sim.scenes`, `s.variant`, `.fault`, `kitWorks`, `useKit`, `toolUse`, `needsHospital`, 그리고 **남의 몸** — `sim.responders[` 는 `sim.responders[a.rid]` 꼴로만 쓴다(정규식 `/sim\.responders\[(?!a\.rid\])/` 이 0건). `doctrine.ts` 는 `agents.ts`·`executor.ts`·`hazards.ts`·`methods.ts`·`methodRun.ts`·`doctrineRun.ts`·`crews.ts` 를 import 하지 않는다(`agents.fitFor` 와 R2 `methods.chooseMethod` 가 `doctrine.ts` 를 부르므로 순환을 만들지 않는다). import 해도 되는 것: 타입, `grid.ts`(`staticPass`·`losWalls`·`tileOf`), `util.ts`, `gear.ts`(판단용 `kitCount`·`kitName`·`seatsLeft`), H1 `injury.ts` 의 `bandOf`·`hurtF`(잎 모듈), `doctrine/registry.ts`.

**중상의 간격**: `st.band` 는 어느 자리에서든 같은 함수 `bandHyst(hp, prev)`(체력 ≤ 70 이면 1, 이미 1 이면 75 이상에서만 0, 40 미만이면 2 — 4.2)로 만든다. ① 자리의 `prev` 는 자기 신고의 값, ②~④ 자리는 자기 몸의 지난 값(`a.crewSig`).

**①`fit` 에서 남의 몸을 읽지 않는 법 — 자기 신고 `crew` 사실(결정)**. `fitFor(sim, s, b, w)` 는 지휘관이 **다른 대원** `b` 에게도 부른다. 여기서 `b` 의 체력을 읽으면 H1 이 막은 "함수 호출 안에 숨은 진실 읽기"가 된다. 그래서 ① 자리의 `st.band`·`st.shaken` 은 **`b` 자신이 신고한 `crew` 사실**(`b.beliefs.val('crew', b.rid)`)에서 채운다. 대원은 자기 몸이 문턱을 넘을 때 그 사실을 자기 믿음에 넣고 무전으로 보낸다(`selfReport`, 4.1). 지금 `fitFor` 가 이미 `b.beliefs` 의 구조 대상 위치를 읽는 것과 같은 길이고, 판단 주기만큼의 지연이 생긴다(의도 — 지휘관이 알게 되는 데 걸리는 시간). 공기·탄은 R1 의 원칙대로 조직 정보(`kitUses`)로 직접 읽는다. ②~④ 자리는 대원 자신의 판단이므로 자기 몸을 직접 읽는다.

`mate` 사실(H1)을 쓰지 않고 새 사실 종류를 두는 까닭: H1 의 `orders/injury.ts` 는 `mate` 사실이 `hurt` 이고 `band ≥ 1` 이면 `treatMate` 를 낸다. 아직 일하고 있는 중상 대원을 `mate` 로 신고하면 구급대원이 움직이는 대원을 쫓아다니게 된다.

**성능**: `fitFor` 는 배정 반복(대원 × 작업)과 판단 주기마다 불린다. `docState` 는 `WeakMap<FieldAgent, { tick, fromReport, st }>` 에 틱마다 한 번 계산해 담고, 줄 목록은 처음 쓸 때 `(hook, work)` 별로 나눈 표(`Map`)로 만든다. `coverSpot` 은 대원·틱마다 한 번.

### 2.5 등록 — `registerDoctrine`

```ts
// doctrine/registry.ts — 잎 모듈 (타입과 배열뿐. doctrine.ts 가 이것을 import 하고, 줄 파일도 이것만 import 한다 —
//   줄 파일이 doctrine.ts 를 import 하면 doctrine.ts → 줄 → doctrine.ts 순환에서 배열이 초기화되기 전에 불린다)
export type DocEffect =
  | { kind: 'fitMul'; mul: number }                                  // 곱한다. 0 = 그 일을 맡지 않는다
  | { kind: 'fitAdd'; add: number }                                  // 0 이 아닐 때만 더한다 (선호가 자격을 만들지 않는다 — R1 6.2 끝과 같다)
  | { kind: 'duty'; act: DocActId }                                  // 의무 — 점수 없이 그 자리에서 바꾼다
  | { kind: 'act'; act: DocActId; score: number | ((c: DocCtx) => number) }
  | { kind: 'methodMul'; mul: number }                               // R2 방법 점수에 곱한다. 0 = 후보에서 뺀다
  | { kind: 'block'; maxWait: number | ((c: DocCtx) => number) }    // 판단 지점에서 막는다. maxWait 초가 지나면 timeout 갈래 (4.4)
  | { kind: 'choose'; opt: 'cover' | 'save' | 'stack' | 'immobilize' };   // 판단 지점에서 막지 않고 갈래만 고른다 (엄폐 사격 자리 · 섬광탄 아끼기 · 줄 서기 · 척추 고정)
export interface DoctrineRule {
  id: string;            // 'P07' — 표 글자 + 번호. 기록·보고서·측정이 이 이름으로 센다
  dept: DocDept;         // 어느 표의 줄인가
  name: string;          // 패널 이름 ('혼자 방 진입 금지')
  short: string;         // 요약 줄의 짧은 이름 ('단독 진입 보류')
  who?: { dept?: Dept[]; roles?: RoleId[]; groups?: RoleGroup[]; units?: UnitKind[] };   // 없으면 누구나
  hook: DocHook;
  works?: WorkKind[];    // fit·method·gate: 이 임무만 (없으면 모두)
  gate?: DocGateId;      // gate 줄의 판단 지점
  methods?: MethodId[];  // method 줄이 배율을 주는 방법
  kits?: KitId[];        // 이 가운데 하나라도 있어야 걸린다 (kitCount > 0)
  noKits?: KitId[];      // 이 가운데 아무것도 없어야 걸린다 — 장비 조건을 when 과 따로 두어 '장비 때문에'를 센다 (7.3 의 noKit 까닭)
  when: (c: DocCtx) => boolean;      // 상황·상태 술어. DocCtx 만 읽는다. 예외는 여기에 넣는다 (2.6)
  effect: DocEffect;
  th?: Record<string, number>;       // 문턱 상수 (when 이 읽는 수를 여기에 두어 표·패널·테스트가 같은 값을 본다)
  rank: 0 | 1 | 2 | 3;               // 0 생명 · 1 보호 · 2 짝·지원·절차 · 3 장비·효율 (2.6)
  why: DocWhy;
  note?: string;                     // 기록 문구 템플릿 ({name}·{mate}·{n}·{s}) — 없으면 기록 없이 센다
  report?: string;                   // 보고서 문장 템플릿 (7.3) — 없으면 보고서에 싣지 않는다
}
export const DOCTRINE: DoctrineRule[] = [];
export function registerDoctrine(...rules: DoctrineRule[]): void { for (const r of rules) DOCTRINE.push(r); }
/** 지휘·관제·추격 줄의 이름표 (코드는 orders/doctrine.ts · dispatch/doctrine.ts 에 있다. 기록·측정만 이 표로 이름을 찾는다) */
export const CMD_ROWS: { id: string; dept: DocDept; hook: 'cmd' | 'dispatch' | 'chase'; name: string; short: string; why: DocWhy }[] = [];
```

- 줄 파일 다섯은 `field/doctrine/index.ts` 가 `common → police → fire → ems → special` 순서로 import 하고, `field/scenes/index.ts` 끝에 `import '../doctrine/index';`·`import '../orders/doctrine';` 두 줄(R1 의 `rules/air`·X6 의 `rules/catastrophe`·R2 의 `rules/methods`·`orders/methods` 다음)을 더한다. `sceneManager` 가 `scenes/index` 를 import 하므로 첫 현장 전에 등록이 끝난다.
- **등록 순서가 결과를 바꾼다**(같은 순위의 줄끼리 먼저 등록된 줄이 이긴다 — 2.6). 그래서 CLAUDE.md 의 "시나리오의 순서" 함정처럼, 줄 파일의 순서를 바꾸지 않는다. 새 줄은 파일 끝에 붙인다.
- 테스트 하나가 모든 줄을 훑어 본다: `id` 가 겹치지 않고, `hook` 에 맞는 `effect`·`gate`·`works` 칸이 있고, `note` 의 자리표시자가 알려진 것뿐이다(10절 8).

### 2.6 우선순위와 충돌

**판단 순서**(`brain.think` — 앞이 이긴다. R1·H1·X6·R2 가 정한 자리에 R3 를 끼운다):

```
perceive → shareNearby → flushOutbox → (지휘관이면 commanderThink)
0) R3 selfReport (몸 상태가 문턱을 넘었으면 crew 사실 — 판단과 무관한 신고. 4.1)
1) 철수·이송 지시 boardOrder                         (지금)
2) R2 물 위 가드                                       (R2 §3.5)
3) X6: if (cur.kind === 'evacuate') return; 철수 명령·자기 조짐 3 의무 → evacuate      (X6 §5.1)
4) R3 의무: if (cur.kind === 'airOut' || cur.kind === 'pairOut') return; docDuty → airOut / pairOut
5) 점수 후보: 후퇴(dangerScore — R3 P11 이 엄폐로 바꿀 수 있다) · 현재 임무 계속 · 지휘관 지시 · 장비 문제 ·
   R1 공기통 교체(R3 가 문턱 하나를 더한다 — F03) · **R3 교본 행동 하나(docAct)** · 휴식 · 무전 · 자체 판단 · 대기
6) 판단 오차 → 가장 높은 것
```

- **의무끼리**: 철수·이송 > 물 위 > X6 철수 > R3 공기 탈출 > R3 짝 따라 나가기. 업고 있는 대원(`a.carrying !== -1`)에게는 R3 의 의무가 걸리지 않는다 — 그 운반이 곧 밖으로 나가는 길이다(X6 와 같은 판단).
- **같은 자리의 줄끼리**:
  - `fit`: 걸리는 모든 `fitMul` 을 곱하고(하나라도 0 이면 0 — **금지가 선호를 이긴다**), 그 값이 0 보다 크면 `fitAdd` 를 모두 더하고 `max(0.02, …)` 로 자른다(R1 의 역할 선호와 같은 규칙). 예외(구조 대상이 있으면 2인 대기조 없이 진입 등)는 따로 "허락" 줄을 두지 않고 **금지 줄의 `when` 안에** 넣는다 — 허락이 금지를 덮는 규칙을 두면 순서에 따라 결과가 갈린다.
  - `duty`·`act`: 걸리는 줄 가운데 `rank` 가 가장 작은 것 하나, 같으면 등록 순서. **한 판단에 교본 후보는 하나만** 낸다(여럿을 내면 판단 오차 한 번이 교본끼리의 순서를 뒤집는다).
  - `method`: 걸리는 `methodMul` 을 모두 곱한다(0 = 후보에서 뺀다). R2 의 `noGear` 까닭 계산(장비를 빼고 다시 셈)에도 교본 배율은 그대로 곱한다.
  - `gate`: 막는 줄이 하나라도 있으면 막힌다. 알리는 문구는 `rank` 가 가장 작은 줄의 것.
- **지휘관 지시와 교본**: 교본은 지시를 "거절"하지 않는다. 지휘관이 맡길 수 없게(`fit` 0) 하거나, 맡은 대원이 판단 지점에서 기다리게(`gate`) 할 뿐이다. 기다림은 상한이 있고(4.4) 상한이 지나면 임무를 놓는다 — 지휘관은 작업의 `status` 변화를 보고 다시 배정한다.
- **X6 와 교본**: X6 의 위험 구역 문(`registerGate`)·`fitFor` 안전망·`agentCost` 가 먼저 막는다. 교본은 그 안에서 더 좁히기만 한다(교본이 X6 의 금지를 푸는 길은 없다).
- **R2 의 실패 기억과 교본의 기억**: 따로 둔다. `a.mfail` 은 방법, `a.docMem` 은 교본 줄. 교본이 방법을 막아(`methodMul 0`) 고를 것이 없으면 R2 의 넓히기 규칙(② `mfail` 무시)은 교본 배율을 무시하지 않는다 — 선택 임무는 방법 없이 지금 코드로, `waterRescue` 는 `methodFit` 0 → 맡지 않는다.

### 2.7 기록 (규칙 5 — 상태를 바꾸는 바로 그 코드에서)

| 언제 | 어디서 | 무엇을 | 예 |
|---|---|---|---|
| 몸 상태가 문턱을 넘었다 | `doctrineRun.selfReport`(자기 믿음에 `crew` 사실을 넣는 그 자리) | `learn` — 무전 문구는 그 사실의 글(`flushOutbox` 가 보낸다). 공기 위급·탄 위급·중상은 즉시 보낸다(4.1) | "이서준: 공기 30% 미만." · "김도윤: 부상 — 가벼운 임무로 돌리겠습니다." |
| 의무·교본 행동을 정했다 | `brain` 의 의무 자리 / 후보의 `apply` | `emit(role 'RESPONDER', kind 'action', imp 1)` 줄의 `note`, `recordDoc` | "공기 30% 미만 — 박서윤, 같이 나간다." |
| 판단 지점에서 처음 막혔다 | 실행기의 그 분기(`t.gateAt` 을 정하는 그 줄) | `!t.gateSaid` 일 때 한 번 `emit(imp 1)`, `recordDoc`(t1 은 풀릴 때 고친다) | "혼자 들어가지 않습니다. 동료를 기다립니다." |
| 예외로 막지 않았다 | 같은 자리 | 예외가 처음 결정을 바꾼 때 한 번 `emit(imp 2)` | "총격이 계속됩니다 — 단독 진입!" |
| 기다림이 상한에 닿았다 | 같은 자리 | timeout 갈래의 문구(4.4) | "지원이 오지 않습니다 — 진입합니다." |
| 방법을 골랐다 | R2 `startMethod` | R2 의 `SAY` 표에 R3 의 까닭 다섯을 더한 문구 | "부상으로 헤엄은 못 합니다. 구명환을 던지겠습니다." |
| `fit` 이 배정을 바꿨다 | `commander.assign`·`brain.takeWork`(배정이 정해진 그 자리) | 기록 문구는 따로 내지 않는다. 지시 무전 끝에 까닭 말 하나를 붙이고(`(부상 — 가벼운 임무)`), `recordDoc(eventId = 그 지시 기록)` | "김도윤, 출입구 봉쇄 맡아라 (부상 — 가벼운 임무)." |
| 지휘·관제 줄 | `orders/doctrine.ts`·`dispatch/doctrine.ts` 의 요청·지령 자리 | 지금의 `request`·`emit` 그대로, `recordDoc` | "흉기 난동 — 2인 제압 인력이 없습니다. 경찰 지원 바랍니다." |

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
- **소모**(`executor.shootAt` 첫머리 — 실행부): 쏘는 대원이 가진 총(R1 의 `hasFirearm` 이 고르는 것 — 저격 > 소총 > 권총 가운데 가진 것)의 `mag ≤ 0` 이면 쏘지 않는다. 쏘면 `useKit(sim, rid, w, perShot)` 과 `it.mag −= perShot`. `mag` 가 0 이 되고 `uses > 0` 이면 `a.reloadUntil = sim.t + reload`, 그 시각에 `mag = min(magSize, uses)`(`doctrineRun.reloadTick`, `act` 첫머리에서 한 줄). 재장전 중에는 `shootAt` 이 **난수를 부르기 전에** 돌아간다(그래야 `s.rng` 소비가 "쏘지 않았다"와 같다). 비살상탄·저격(R2)은 자기 장비의 수량을 쓰므로 이 규칙과 따로다(저격의 한 발은 `sniper` 의 탄 1).
- **문턱**: `ammoLow` = `uses ≤ magSize`(마지막 탄창), `ammoCrit` = `uses ≤ 2 × perShot`(발사 2회 이하). 둘 다 `CrewBelief.ammo` 로 신고한다.
- **재보급**(`TaskKind 'rearm'`, 라벨 '탄약 보급'): 대기 지점까지 가서(3칸) 6초 → 자기 부대 `ammoBox > 0` 이면 가진 총기를 모두 처음 값으로(`uses`·`mag`), `ammoBox −= 1`, `emit(imp 0, '탄약 보급 완료.')`. 상자가 없으면 `emit(imp 1, '보급할 탄약이 없습니다.')`(이 대원·이 사건에 한 번), `a.docMem` 에 그 줄을 이 사건 끝까지.
- **탄약 상자**(`Unit.ammoBox`): 순찰 `tn.ammoBox`, 기동 +1, 특공 +2, 폭발물 처리반 `tn.ammoBox`, 경찰 헬기 0(내리는 사람이 없다). 집에 닿으면(`resources.arrive` 의 `returning`) 가득 — R1 의 `spareAir` 와 같은 자리. `tn.ammoBox = [1, 1, 2, 2, 3][장비]`.
- 탄이 0 이면 총기 상대 `engage`·`perimeter` 는 교본이 막는다(P09·P22). `arrest`(R1: 총기 ‖ 테이저)는 그대로 — 흉기·맨손 상대는 테이저·몸으로 검거한다.
- 대부분의 사건에서 탄은 바닥나지 않는다(교전이 짧다). 긴 총격·대형 인질극에서만 드러난다 — 드물지만 보이게(8절의 "쓰인 줄" 목표가 이 줄을 장면 테스트로 잰다).

### 2.10 엄폐 자리 (바탕 — 2단계)

지금은 엄폐를 고르는 행동이 없다(`executor.act` 가 멈춘 칸의 이웃으로 `a.inCover` 를 우연히 정할 뿐이다). 용의자에게만 엄폐 이동이 있다(`hazards.tickHostiles`). R3 는 **생김새와 믿음만으로** 엄폐 자리를 찾는 순수 함수를 둔다.

```ts
// doctrine.ts
export function coverTileAt(s: Scene, x: number, y: number): boolean;    // 벽·창·바위·가구 칸 (s.tiles 만 — 소품은 보지 않는다. executor.isCoverTile 과 같은 칸 종류)
export function coverSpot(s: Scene, ax: number, ay: number, tx: number, ty: number, wantLos: boolean, rMax = 4, dMax = 7.5): { x: number; y: number } | null;
```

- 후보: 대원 둘레 `rMax` 칸 안의 칸 `p` — `staticPass`, 물·`VOID` 아님, 위협(믿음 위치 `t`)에서 1.8칸 넘게 떨어짐.
- 엄폐: `p` 에서 위협 쪽 방향(`sign(tx − px)`, `sign(ty − py)`)의 이웃 세 칸 가운데 하나가 `coverTileAt`.
- `wantLos`(엄폐 사격): `losWalls(p, t)` 이고 `dist(p, t) ≤ dMax`. `!wantLos`(숨기 — 재장전·탄 위급·중상·협상자): `losWalls(p, t)` 가 거짓(벽에 가려 서로 보이지 않는다).
- 점수: 대원에게 가까운 순, 같으면 칸 번호가 작은 쪽. 없으면 `null` → 부르는 쪽이 지금 동작(엄폐 사격은 지금의 7.5칸 접근, 숨기는 지금의 후퇴)으로 간다.
- 소품 칸을 보지 않는 까닭: `s.propAt` 은 차량·밸브 같은 물건이 어디 있는지 드러낸다 — 판단부가 소품을 읽지 않는다는 R2 의 금지를 그대로 둔다. 가구 칸(`T.FURN`)은 부서지면 바닥이 되므로(`damage.ts`) 그때부터 엄폐가 아니다 — 지금의 `inCover` 규칙과 같다.
- **쓰는 곳**: ① `engage` 의 마지막 분기(총기 용의자와 교전 — 지금은 7.5칸·시야 아무 자리)가 `coverSpot(…, wantLos = true)` 로 간다(P05 — R2 가 이미 이 분기를 기록 이름 `cover` 로 부른다. R3 가 그 이름을 실제 행동으로 만든다). ② `TaskKind 'cover'`(숨기)가 `wantLos = false` 로 간다.
- **`cover` 임무**(라벨 '엄폐'): `t.tx/ty` 를 처음 한 번 정하고 `moveTo(…, 0.4)`(한 틱에 `moveTo` 하나 — 목표를 매 틱 다시 고르지 않는다). 닿으면 기다린다. 끝나는 조건: 재장전이 끝났고 4초 동안 피격 위협이 없음 / 탄 위급이면 `rearm` 으로 넘길 수 있게 끝냄 / 믿음 속 위협이 활동하지 않음 / 12초. 끝나면 `a.docMem` 에 그 줄을 20초(같은 위협에 엄폐 ↔ 교전 왕복을 늦춘다).

---

## 3. 분야별 교본 표

**읽는 법**

- **자리**: `fit`(누가 맡는가) · `의무` · `행동`(점수 후보) · `방법`(R2 배율·행) · `판단`(실행 중 판단 지점 `gate`) · `지휘`·`관제`·`추격`(6절). 
- **구분**: **새로** = R3 가 이 `id` 로 `DOCTRINE` 에 등록하는 개인 줄(측정 대상 — 9절). **새로 — 지휘 ○○ / 관제 ○○** = 6절의 지휘·관제 줄로 구현하고 그 `id`(`CMD_ROWS`)로 센다 — 분야 표에서도 한눈에 보이게 한 번 더 적었다(두 번 세지 않는다). `있음(R1)`·`있음(R2)`·`있음(X6)`·`있음(H1)`·`있음(지금)` = 다른 설계서나 지금 코드가 이미 하는 것 — 적기만 하고 등록하지 않는다.
- **분야마다 등록한 줄** = 그 표의 "새로" 개인 줄 + 6절에서 그 분야로 적힌 지휘·관제 줄. 네 분야 모두 12줄을 넘는다(경찰 17 + 7, 소방 15 + 8, 의료 10 + 5, 특수 13 + 5 — 6.2 표의 "분야" 칸이 관제 줄의 분야다).
- **상태** 칸의 "중상"은 자기 신고 `band = 1`(체력 70 이하, 75 이상이면 다시 0 — 4절), "혼자"는 `st.alone`, "짝"은 `st.buddy`(5절), "지원 옴"은 `st.backup`.
- 수치는 **시작값**이다(8절에서 잰다). 거리는 현장 칸.
- 문구의 `{mate}` 는 짝·동료 이름, `{n}` 은 수. 조사는 `josa()`.

### 3.1 경찰 (`police` — 순찰·기동, 그리고 `who.dept: ['police']` 인 줄은 특공·폭발물 대원에게도 걸린다)

| 줄 | 누구 | 상황 | 장비 | 상태 | → 행동 (자리) | 문턱 | 기록 문구 (예) | 구분 |
|---|---|---|---|---|---|---|---|---|
| P01 | 경찰 | 흉기·맨손 용의자가 교전(`fight`), 4칸 안·시야 | 테이저 남음 | 같은 용의자를 맡은 동료가 2.6칸 안에 ≥ 1 | 테이저 먼저(R1 그대로), 무력화되면 둘이 함께 붙는다. 무력화 전에는 1.6칸 안으로 들어가지 않는다 (판단 `closeIn`) | 4칸 · 2.6칸 | "테이저 준비 — {mate}, 맞으면 같이 붙는다." | 새로 (테이저 자체는 R1) |
| P02 | 경찰 | 흉기 용의자 `fight` | 테이저 없음·다 씀, 비살상탄 없음 | **혼자**(2.6칸 안 동료 0) | **거리 유지**: 3칸에서 멈추고 말로 붙잡는다, 지원 요청 무전(지휘관 CP2). 상한 20초(지원 옴이면 30초) 뒤 덮침. **예외**: 시민이 위협 2칸 안(`civAtRisk`)이면 즉시 덮침 (판단 `closeIn`) | 3칸 · 20/30초 | "흉기 소지 — 거리 유지하며 지원 기다립니다." / 예외 "시민이 위험합니다 — 바로 제압!" | 새로 |
| P03 | 경찰 | 흉기 용의자 `fight` | 테이저 없음 | 동료 ≥ 1 이 같은 용의자를 맡음 | 동료가 2.6칸 안에 올 때까지 3칸에서 기다렸다 **동시에** 덮침 (판단 `closeIn`). 둘이 붙으면 H1 의 몸싸움 피해는 지금대로 양쪽에 | 2.6칸 · 6초 | "둘이 동시에 들어갑니다!" | 새로 |
| P04 | 경찰 | 흉기·총기(대치) 9칸·시야, 인질 곁 아님 | 비살상탄 | — | 비살상탄(R2). P02 의 거리 유지 중이면 그 자리에서 쏜다 | R2 | R2 | 있음(R2) |
| P05 | 경찰 | 총기 용의자와 교전 | 총·탄 | — | **엄폐 사격**: 지금의 "7.5칸·시야 아무 자리" 대신 `coverSpot(wantLos)` 로 가서 쏜다. 자리가 없으면 지금대로 (판단 `coverFire` — `choose 'cover'`, 실행기 `engage` 마지막 분기) | 4칸 · 7.5칸 | (기록 문구 없이 센다 — 사격 기록은 G5) | 새로 |
| P06 | 경찰 | 총기 용의자 대치·교전, 진입 결정 전 | — | **혼자**(같은 용의자를 맡은 동료 0, 6칸 안 경찰 0) | 다가가지 않고 엄폐 자리(`wantLos`)에서 봉쇄를 유지, 지원 요청. **예외**: 총격범이 교전 중이고 `civAtRisk` → 접근 (판단 `closeIn`) | 6칸 | "총기 소지 — 엄폐하고 지원 기다립니다." | 새로 |
| P07 | 경찰 | 닫힌 방 진입(지금: 동료 0 이면 4초 뒤 혼자) · 동시 진입(지금: `breachAt + 8` 뒤 혼자) | — | **혼자**(방: 2.6칸 안 `engage` 동료 0 / 동시 진입: 그 문의 진입조 1명) | 진입하지 않고 문 앞에서 기다린다. **예외 ①** 총격범 교전 + `civAtRisk` → 단독 진입. **예외 ②** 지원이 오지 않고(`!backup`) 60초 → 진입 (판단 `roomEntry`·`breach`) | 2.6칸 · 60초 | "혼자 들어가지 않습니다. 동료를 기다립니다." / ① "총격이 계속됩니다 — 단독 진입!" / ② "지원이 오지 않습니다 — 진입합니다." | 새로 |
| P08 | 총을 가진 대원 | 믿음 속 교전(`fight`) 위협 없음 | 탄 `ammoLow` | 탄약 상자 있음(부대) | **재보급**(`rearm`) (행동, 0.78) | 마지막 탄창 | "탄약 보급 받으러 차량으로 갑니다." | 새로 |
| P09 | 총을 가진 대원 | 총기 위협 `fight` | 탄 `ammoCrit` 또는 0 | — | **엄폐(숨기)** → 끝나면 재보급. 총기 상대 `engage`·`perimeter` 의 `fit` 0 (보급 뒤 `uses > magSize` 이면 풀림) (행동 0.92 + `fit`) | 발사 2회 이하 | "탄약 바닥 — 엄폐합니다!" | 새로 |
| P10 | 총을 가진 대원 | 교전 중 탄창이 비었다(재장전 중) | 탄 남음 | 엄폐 아님·피격 3초 안 | 재장전(2~3초 사격 멈춤 — 2.9)을 그 자리에서 하지 않고 **엄폐(숨기)** 로 가서 한다 (행동 0.9) | 2.0/2.5/3.0초 | "재장전 — 엄폐!" | 새로 |
| P11 | 경찰 | 피격 3초 안 | — | 체력 < 70, 엄폐 아님, 4칸 안에 숨을 자리 있음 | 지금의 **후퇴(대기 지점까지) 대신 엄폐(숨기)**. 점수는 지금의 위험 점수 그대로 — 후퇴 후보를 엄폐 후보로 바꾼다. 체력 < 40·출혈 후퇴(H1)는 그대로 후퇴 (행동) | 3초 · 70 · 4칸 | "피격 — 엄폐!" | 새로 |
| P12 | 경찰 | — | — | **중상** | `engage`·`arrest`(fight 상대)·진입 `×0.35`, `perimeter`·`traffic`·`interview` `+0.15`, 침착함 ≥ 0.6 이면 `negotiate +0.2` (`fit`) | band 1 | (자기 신고) "부상 — 봉쇄로 돌리겠습니다." | 새로 (공통 G01 의 경찰판) |
| P13 | 경찰 | 인질 곁 총기 용의자 | 섬광탄(나 또는 동료) | — | 섬광탄 들고 4.6칸까지 / 동료 섬광탄이면 7.5칸 대기 (지금 그대로) | 지금 | 지금 | 있음(지금·R1) |
| P14 | 경찰 | 인질 곁 총기 용의자 | 현장 경찰 **누구도 섬광탄 없음** | — | 지금은 다가가 2.2초에 덮친다 → **동료 ≥ 1 이 2.6칸 안이고 믿음 속 용의자가 등졌을 때(`facing` 과 대원 방향의 차 > 100°)만** 덮친다. 아니면 7.5칸 엄폐 자리에서 대기(협상은 다른 대원이 계속) (판단 `closeIn`) | 2.6칸 · 100° | "섬광탄 없음 — 인질 위험, 엄폐 대기." / "등졌다 — 지금!" | 새로 |
| P15 | 섬광탄을 든 대원 | 동시 진입(`breach`) | 섬광탄 1개 남음 | — | 동시 진입에서는 쓰지 않고 방 진입용으로 아낀다(지금: 문 안쪽 5칸 안이면 쓴다). 용의자가 3칸 안이면 예외 (판단 `bangUse` — `choose 'save'`, 막지 않는다) | 1개 · 3칸 | "마지막 섬광탄 — 방 진입에 아낍니다." (imp 0, 한 번) | 새로 |
| P16 | 협상 대원 | 협상 중 용의자 `fight` | — | — | 지금은 그 자리에 서 있는다('엄폐 (협상 중단)' 라벨뿐) → **엄폐(숨기)** 로 옮기고, 교전이 그치면 자리로 돌아와 이어 간다 (행동 0.9) | — | "교전 — 엄폐하고 계속 부릅니다." | 새로 |
| P17 | 경찰 | 확보 전 무장 현장의 건물 수색(`hot` `search`) | — | 쓸 수 있는 짝이 없음(5.2) | 혼자서는 맡지 않는다(`fit` 0). 짝이 있으면 짝이 `pair` 로 따라 들어가고, 실내 첫걸음에서 짝이 4칸 안에 없으면 기다린다(판단 `interiorEntry`). 맡을 사람이 없으면 지금의 "hot && 수색 남음 && law 0 → law" 요청과 B3 블록이 부른다 | 4칸 | (지시 무전 끝의 까닭 말) / "짝을 기다립니다." | 새로 |
| P18 | 경찰 부대 | 추격전, **경찰 헬기가 차를 보고 있음**(`I.trackBy === 'air'`) | — | — | 가장 가까운 지상 부대 하나만 알려진 위치로 따라가고, 나머지는 **예상 교차로 앞막기** (추격) | — | 관제 "헬기가 보고 있다 — {호출부호}, 앞을 막아라." | 새로 — 관제 D7 |
| P19 | 경찰 부대 | 추격전, 헬기 없음, 지상 둘이 이미 42 안에 붙음 | — | — | 셋째부터 앞막기 (추격) | 42 | 관제 "{호출부호}, 앞 교차로로 돌아가라." | 새로 — 관제 D7 |
| P20 | 경찰 | 교통 통제 | 경광봉 | 2차 사고 믿음(`SECONDARY_COLLISION` 을 본 대원의 사실) 또는 밤·비·안개 | `blockLane`(순찰차로 차로를 막고 선다 — 통제 뒤 그 방향 2차 사고 ×0.4), 아니면 `post`(평소, 경광봉이면 R1 의 ×0.85) (방법 — 6단계) | — | "차로를 차량으로 막겠습니다." | 새로 |
| P21 | 경찰 | 가스·폭발물 현장의 출입 통제 | 확성기 | — | 대피 방송(R2 `announce`) | R2 | R2 | 있음(R2) |
| P22 | 총을 가진 대원 | — | 탄 0, 부대 탄약 상자 0 | — | 총기 상대 `perimeter` `×0.3`(봉쇄는 응사 자리다), `traffic`·`interview` `+0.15` (`fit`) | 0 | (자기 신고) "탄약 소진 — 봉쇄에서 빠집니다." | 새로 |

### 3.2 소방 (`fire` — 펌프차·구조 공작차. `kits: ['scba']` 인 줄은 화학·사다리차·소방 헬기 대원에게도 걸린다)

| 줄 | 누구 | 상황 | 장비 | 상태 | → 행동 (자리) | 문턱 | 기록 문구 (예) | 구분 |
|---|---|---|---|---|---|---|---|---|
| F01 | scba 대원 | 위험 건물 실내(`inHazard`) 또는 연기 감각 > 0.25 | scba | 공기 < 30% (`AIR_OUT`), 업고 있지 않음 | **공기 탈출**(`airOut`): 대기 지점으로 나가 교체(예비가 있으면 8초 — R1 의 `swapAir` 효과를 이 임무가 한다) (의무, rank 0) | 0.30 | "공기 30% 미만 — {mate}, 같이 나간다." / 짝 없으면 "공기 30% 미만 — 탈출합니다." | 새로 |
| F02 | scba 대원 | 위험 건물 실내 | scba | 짝이 나간다(`airOut`·`pairOut`·`retreat`·`evacuate`·부상 후퇴), 업고 있지 않음 | **짝 따라 나가기**(`pairOut`) (의무, rank 0) | — | "{mate} 따라 나갑니다." | 새로 |
| F03 | scba 대원 | — | scba | 공기 < 50% (`AIR_IN`) | 위험 건물 실내 일·`suppress`(실내 방법) `fit` 0 — R1 의 "`uses < 45` 면 0" 을 비율 문턱으로 넓힌다. 바깥에서 손이 비면 R1 의 공기통 교체 후보를 0.7 로 낸다 | 0.50 | (R1 의 교체 문구) | 새로 (교체 자체는 R1) |
| F04 | scba 대원 | 위험 건물 실내 일 | scba | **짝 없음**(5.2 — 쓸 수 있는 짝이 없음) | 맡지 않는다(`fit` 0). 진압은 R2 의 외부 방어(`defensive`)만 남는다(방법 `interior ×0`). 맡은 뒤 실내 첫걸음에서 짝이 4칸 안에 따라와 있지 않으면 문턱에서 기다린다(판단 `interiorEntry`). **예외**: 믿음 속 구조 대상이 3칸 안이면 그 사람의 `carry` 는 맡는다 (`fit` + 방법 + 판단) | 3칸 · 4칸 | (지시 무전 끝) "(짝 없음)" / "짝 없이 들어가지 않습니다." | 새로 |
| F05 | scba 대원 | 위험 건물 실내로 처음 들어서려는 걸음 | scba | 밖 대기조(`outsideWatch`) < 2 (같은 사건으로 오는 소방 부대가 있으면 1 로 충분) | **2인 대기조 확인 전 진입 보류** — 문턱 칸에서 기다린다. **예외**: `victimInside`(믿음 속 구조 대상·신고 인원 > 찾은 수) → 짝만 있으면 진입 (판단 `interiorEntry`, 상한 20/30초) | 2명 | "대기조 확인 전 진입 보류." / 예외 "요구조자 있음 — 대기조 없이 진입합니다." | 새로 |
| F06 | 소방 | 연기 찬 구역 수색(믿음 불 > 0.25 구역) | 열화상(`tic`) | — | `search +0.15`(열화상 대원이 먼저 맡는다). 시야 효과는 R1 그대로 (`fit`) | 0.25 | (지시 무전) | 새로 |
| F07 | 소방 | 실내 수색 | 열화상 **없음** | 감각 연기 > 0.5 | **벽 더듬기 수색**(`feel`): 경유점을 벽 쪽으로, 간격 ×0.75, 경유점마다 0.8초 (방법) | 0.5 | "앞이 안 보입니다. 벽을 따라 더듬어 찾겠습니다." | 새로 |
| F08 | 관창을 든 대원 | 진압 | hose | 자기 부대 물 < 30%, 소화전 연결 안 됨(조직 정보) | **끊어 쏘기**(`pulse`): 효과 ×0.85·물 ×0.65 (방법) | 30% | "용수 30% — 끊어 쏘며 아끼겠습니다." | 새로 |
| F09 | 관창을 든 대원 | 진압 | hose | 물 0, 소화전 없음 | 진압 `fit` 0(지금도 R1 자격으로 0). 작은 불(≤ 0.35)이고 소화기가 있으면 R2 `extinguisher`. 그 밖에는 수색·구조·이송 `+0.1`(손을 놀리지 않는다) (`fit`) | 0 | (지시 무전) | 새로 |
| F10 | 소방 | 펌프 고장 | — | 부대 `sparePump > 0` | 예비 펌프 교체(지금 0.84 그대로)가 `sparePump` 를 하나 쓴다. **0 이면** 교체 후보를 내지 않는다(바탕 — `brain` 의 예비 펌프 후보에 조건 하나) — 지휘관이 "펌프 고장 — 진압 부대 교체"를 요청 | 1개 | (지금 문구) | 있음(지금) + 새로 — 지휘 CF3 |
| F11 | 구조 대원 | 고립자 구출 | 유압 장비 없음·알려진 고장 | — | 수동·기본 구출(R2 `manual`·`basic`)은 R2 가 고른다. 교본은 지휘관 쪽: "유압 장비 고장" 지원 요청 | — | R2 | 있음(R2) + 새로 — 지휘 CF4 |
| F12 | 소방 | 수난 구조 | 구명조끼(`pfd`) 없음 | 믿음 물살 ≥ 0.07(빠름) | 헤엄(R2 `swim`) `×0` — 빠른 물살에 구명조끼 없이 들어가지 않는다. 방화복·공기호흡기를 벗는 준비 6초는 R2 그대로 (방법, rank 0) | 0.07 | R2 SAY (까닭 `danger`) | 새로 |
| F13 | 방화복이 없는 대원 | X6 위험 단계 1 구역 | turnout 없음 | — | 그 구역 일 `fit` 0(X6 는 단계 2 부터 막는다 — 보호 장비가 없는 사람은 한 단계 먼저) | 단계 1 | (지시 무전) | 새로 |
| F14 | 소방 | — | — | **중상** | 위험 실내 일·실내 진압 `×0.35`, `hookup`·`traffic`·`clearRoad` `+0.2` (`fit`) | band 1 | (자기 신고) "부상 — 급수·통제로 돌리겠습니다." | 새로 (G01 의 소방판) |
| F15 | 소방 | 위험 실내 새 일 | — | 지구력 < 30 | 맡지 않는다(`fit` 0). 하던 일은 지금처럼 22 까지 (`fit`) | 30 | — | 새로 (G03 의 소방판) |
| F16 | 소방 | 위험 실내 수색 | — | **신입**(경험 < 0.3), 짝이 신입 아님 | 수색 `×0.5` — 짝이 앞장서고 신입은 `pair` 로 따라간다 (`fit`) | 0.3 | — | 새로 |
| F17 | 소방 | 가스 밸브 방 앞, 감각 가스 > 0.6 | 측정기 없음 | — | 환기 후 차단(R2 `ventFirst`), 짝 규칙(F04·F05)이 그대로 걸린다 | R2 | R2 | 있음(R2) |
| F18 | 펌프차·사다리차 대원 | 교통사고 현장의 차량 화재·연료 누출 | (부대가 큰 차 `HEAVY`) | 통제 지점이 아직 통제되지 않음 | 교통 통제를 맡으면 `blockLane`(소방차로 차로를 막는다)을 먼저 (방법 — 6단계) | — | "펌프차로 차로를 막겠습니다." | 새로 |
| F19 | 소방 | 붕괴·가스·전소의 조짐 | — | — | 물러남·철수·외부 방어 | X6 | X6 | 있음(X6) |

### 3.3 의료 (`ems` — 구급차·의료 헬기의 대원. 처치에 관한 줄은 의료 가방을 든 소방 헬기 대원에게도 걸린다)

| 줄 | 누구 | 상황 | 장비 | 상태 | → 행동 (자리) | 문턱 | 기록 문구 (예) | 구분 |
|---|---|---|---|---|---|---|---|---|
| E01 | 구급 | 믿음 속 대기 환자(band ≥ 1) ≥ 4, 또는 관제 이름표가 다수 사상자 시나리오 | 의료 가방 | 분류 전(`s.triageAt < 0`) | **분류부터**(`triage` 작업 — 지휘관 CE1. `fit`: 1급 응급구조사 +0.3, 응급구조사 +0.2, 의사 +0.1). 분류 중에는 경상 처치를 내지 않는다 | 4명 | "다수 사상자 — 먼저 분류합니다." / 끝 "분류 완료: 위중 {n} · 중상 {m} · 경상 {k}." | 새로 |
| E02 | 구급 | 응급 현장, 믿음 위중(band 2)·거동 불가 | 제세동기(`aed`) | — | 현장 안정 후 이송(R2 `stay`) `×1.3` — 제세동기를 쓰고 옮긴다 (방법) | band 2 | "제세동기 준비 — 현장에서 소생술." | 새로 |
| E03 | 구급 | 위와 같음 | 제세동기 **없음·알려진 고장** | — | 즉시 이송(R2 `rush`) `×1.5` — 가슴 압박하며 바로 옮긴다 (방법) | band 2 | "제세동기 없음 — 가슴 압박하며 바로 이송합니다." | 새로 |
| E04 | 의사·항공 간호사 | 위중 | 의사 장비 | — | `stay ×1.3`, `rush ×0.7` — 현장 전문 처치 후 이송 (방법) | band 2 | "현장에서 전문 처치 후 이송합니다." | 새로 |
| E05 | 구급 | 무장 현장 안전 확보 전(`hot`), 환자가 **안전 구역**(믿음 `where 'safe'`) | 의료 가방 | — | 처치를 맡는다(지금: `hot` 이면 경찰만 — 환자 위치를 보지 않는다). **경계 밖 처치소** (`fit` — 지금 규칙을 이 경우만 연다) | — | (현장에서 처음 한 번) "경계 밖 처치소에서 처치합니다." | 새로 |
| E06 | 구급 | `hot`, 환자가 현장(`scene`) 안 | — | — | 들어가지 않는다 — 경찰이 데려온다 | 지금 | 지금 | 있음(지금) |
| E07 | 구급 | 위험 건물 실내·X6 단계 ≥ 2 | scba 없음 | — | 들어가지 않는다 — 소방이 데려온다 | 지금·X6 | 지금 | 있음(지금·R1·X6) |
| E08 | 이송 대원(누구든) | 옮기려는 환자를 **구급 대원이 처치 중**(같은 `cas` 의 `treat` 임무가 진행 중 — 동료의 겉) | — | — | 처치가 끝날 때까지 들지 않고 곁에서 기다린다. **예외**: 감각 연기·열 > 0.3, 위험 건물 실내, X6 단계 ≥ 2 → 먼저 옮긴다 (판단 `carryHold`, 상한 15초) | 15초 | "처치 끝나면 옮기겠습니다." | 새로 |
| E09 | (지휘관) | 자리 하나에 기다리는 환자 둘 | — | — | 믿음 중증도가 높은 쪽 탑승을 먼저, 다른 쪽 탑승 작업은 미룬다 | 자리 1 | 지휘관 "자리 하나 — 구조 대상 {s} 먼저." | 새로 — 지휘 CE3 |
| E10 | (지휘관) | 위중 환자, 현장 자리 0, 가장 가까운 오는 구급 부대 도착 예상 > 100초(조직 정보) | — | — | `ems` 긴급 요청 '위중 환자 — 항공 이송 검토' (R1 `airFit` 의 "채워지지 않은 긴급 구급 요청" 줄로 의료 헬기가 간다) | 100초 | 지휘관 요청 문구 | 새로 — 지휘 CE4 |
| E11 | 구급 | — | — | **중상** | 현장 처치 `×0.5`, `load`·탑승 `+0.2`(이송 중 처치만 — 차 안 처치는 R1 의 "함께 탄 대원 최댓값"). 현장에 다른 구급 대원이 없으면 배율을 걸지 않는다 (`fit`) | band 1 | (자기 신고) "부상 — 이송 중 처치만 맡겠습니다." | 새로 |
| E12 | 처치 대원 | 차로 위 환자(통제 지점의 차로 줄), 그 방향 통제 전(`ctl` 사실 없음) | — | — | 차로 위에서 처치하지 않는다 — 옮겨지기를(지휘관의 `carry`) 또는 통제를 기다린다. **예외**: 차 안에 갇힌 환자(구출 전)는 통제 뒤 그 자리에서 (판단 `laneTreat`, 상한 20초 — 지나면 처치) | 20초 | "차로 통제 전 — 차로 밖으로 옮긴 뒤 처치합니다." | 새로 |
| E13 | 척추 고정판을 든 대원 | 교통·붕괴 현장(`s.kind` — 생김새)의 거동 불가 환자를 처음 들 때 | 척추 고정판 | — | 들기 전에 3초 고정(R1 의 "고정판 없이 옮기면 출혈 ×1.12" 를 피한다). 감각 연기·열 > 0.3 이면 고정하지 않고 바로 (판단 `carryStart` — `choose 'immobilize'`, 6단계) | 3초 | "척추 고정 후 이송합니다." | 새로 |
| E14 | 이송 대원 | 거동 불가 환자 | 들것 없음 | 혼자, 감각 연기 > 0.3 | **끌기**(`drag`): 낮게 끌어 연기 노출 ×0.5, 속도는 혼자 업기의 0.85배. 들것이 있으면 `litter`(R1 배율 — 기록 전용) (방법 — 6단계) | 0.3 | "연기가 짙습니다 — 낮게 끌어 나갑니다." | 새로 |
| E15 | (지휘관) | 비구급 대원이 처치 중, 손 빈 구급 대원이 있다 | — | — | 처치를 **넘겨받게** 한다(배정 교체) | — | 지휘관 "{name}, 처치 넘겨받아라." | 새로 — 지휘 CE2 |
| E16 | 구급 지휘관 | 자기 부대가 이송 출발 | — | — | 타기 전에 지휘권을 넘긴다(지금은 떠난 뒤 '지휘 불능'으로 승계) | — | "{name}, 지휘 넘긴다 — 이송 출발." | 새로 — 지휘 CE5 |
| E17 | 구급 | 경상만 남음 | — | — | 처치·이송하지 않는다 | H1 | — | 있음(H1) |

### 3.4 특수 (`special` — 특공·폭발물·화학·소방 헬기·구조정·사다리차)

| 줄 | 누구 | 상황 | 장비 | 상태 | → 행동 (자리) | 문턱 | 기록 문구 (예) | 구분 |
|---|---|---|---|---|---|---|---|---|
| S01 | 특공 | 동시 진입 | 방패 | 방패수가 진입조에 있음 | 방패수가 주 출입구 첫째(R1). R3: 다른 진입조원은 방패수가 문을 지난 뒤 0.6초 간격으로 들어간다(줄 서기) (판단 `breach` — `choose 'stack'`) | 0.6초 | "방패 선두 — 진입!" (지금의 진입 문구를 바꾼다) | 새로 (배치는 R1) |
| S02 | 저격·관측수 | 무장 대치 | 저격 소총 | — | 진입조에 들지 않는다(`engage ×0.3` — 저격 방법은 R2 가 따로 고른다). 봉쇄 자리 가운데 가장 먼 자리를 먼저(`perimeter +0.1`) (`fit`) | — | — | 새로 (선호는 R1) |
| S03 | 진입대원(파괴) | 잠긴 문 | 파괴 장비 | 대치 중 | 조용히(R2 `irons`) / 진입 순간(R2 `ram`) | R2 | R2 | 있음(R2) |
| S04 | (지휘관) | 두 문 동시 진입 문턱 | — | 쓸 수 있는 경찰 < 4 (특공 결원·중상 포함) | 한 문 진입 (문턱을 머릿수에서 "쓸 수 있는 경찰"로) | 4 | — | 새로 — 지휘 CP1 |
| S05 | 특공·기동 | 진입이 결정됨 | 섬광탄 | — | 섬광탄을 가진 사람이 진입조를 먼저 맡는다(`engage +0.1`) (`fit`) | — | — | 새로 |
| S06 | 폭발물 처리반 | 살아 있는 장치(믿음) | 로봇(작동 — `kitCount`) | — | **로봇 먼저**(`robotDefuse`): 로봇 조작 요원이 8칸 밖에서 원격 확인·무력화(시간 ×1.6, 실수 ×0.3). 로봇 고장이 드러나면 R2 의 `broken` 으로 `suitDefuse` 에 넘긴다(처리 요원이 맡는다) (방법 — 해체 `fit` 에 로봇을 자격으로 더한다) | 8칸 | "로봇 먼저 투입합니다." / 고장 "로봇이 작동하지 않습니다 — 방호복 착용 후 수동 해체." | 새로 |
| S07 | 폭발물 처리 요원 | 장치 | 로봇 없음, **방호복 없음** | — | 방호복 없는 수동 해체(`bareDefuse`)는 믿음 속 구조 대상이 장치 6칸 안에 있을 때만(생명 위험). 아니면 고르지 않는다(`×0`) — 지휘관이 폭발물 처리반을 더 부른다(`eod` 요청 — 지금 규칙) (방법, rank 0) | 6칸 | "방호복 없음 — 대피 반경 넓히고 지원 요청." | 새로 |
| S08 | 해체를 맡지 않은 대원 | 살아 있는 장치(믿음) | — | — | 장치 6칸 안의 일 `fit` 0(출입 통제·해체 제외), `agentCost` 에서 그 원 +20 (`fit`. 거두기·알림은 지휘 CS1) | 6칸 | 지휘관 "해체 시작 — 반경 6칸 비워라." | 새로 |
| S09 | 경계 요원 | 출입 통제 | 확성기 | — | 대피 방송(R2) · 봉쇄 +0.2(R1) | — | R2 | 있음(R1·R2) |
| S10 | 화학대 | 가스 현장의 위험 실내 일 | 측정기 | — | 측정기를 가진 대원이 먼저 맡는다(`+0.15`) — 그래서 짝 가운데 측정기를 가진 쪽이 앞장서고 다른 쪽이 `pair` 로 따른다. 측정 자체는 X6 의 측정 갈래 (`fit`) | — | — | 새로 (측정은 X6) |
| S11 | 화학 보호복 대원 | 가스 밸브 차단 | 누출 차단 장비 | — | 보호복 대원 둘이 들어가고(짝), 측정·제독 대원은 출입구에서 대기조(5절 `PAIRS` 화학). 제독 대원은 짝이 나올 때까지 출입구 3칸 안에 머문다 (`fit` — 제독 대원 위험 실내 `×0.3`) | 3칸 | "제독 대기 — 출입구에서 기다립니다." | 새로 |
| S12 | 화학·사다리차 scba 대원 | 공기 | scba | 공기 < 30% | F01·F02 가 그대로(`kits: ['scba']`) | 0.30 | F01 | 있음(F01) |
| S13 | 구조정 대원 | 바닷가 수난·해일, 또는 빠른 물살 | 구조정(부대) | — | 보트(R2 `boat`) `×1.3`, 헤엄 `×0`(바다·해일) (방법, rank 0) | 0.07 | R2 SAY (까닭 `danger`) | 새로 |
| S14 | 구조정 대원 | 불타는 건물 | scba 없음 | — | 들어가지 않는다 | R1 | — | 있음(R1) |
| S15 | 지상 대원(소방 헬기가 물 현장 상공) | 수난, 같은 대상에 호이스트 작업이 열려 있다(믿음 작업판) | — | — | 헤엄 `×0.5`(R2 의 ×0.7 에 더해), 줄 확보(`tend`)·하류 차단(`catch`) `×1.2` — 헬기와 겹쳐 들어가지 않는다 (방법) | — | R2 SAY (까닭 `team`) | 새로 |
| S16 | 항공 구조대원(내려앉은 소방 헬기) | 위험 실내 | scba | — | 짝 = 같은 헬기의 다른 대원(5절) | — | — | 있음(5절 PAIRS) |
| S17 | 경찰 헬기 | 밤·연료 | 탐조등 | 연료 < 복귀 + 40초 | 탐조·복귀 | R1 | R1 | 있음(R1) |
| S18 | 의료 헬기 | 위중 1명 | 의사 장비 | — | E04 | — | — | 있음(E04) |
| S19 | 사다리 조작원 | 화재 | — | — | 실내 수색 `×0.3`(현장에 다른 scba 대원이 둘 이상일 때), 급수·고가 방수 먼저. 고가 방수의 선택은 R2 `aerial` (`fit`) | — | — | 새로 (선호 −0.2 는 R1) |
| S20 | 사다리차 | 위층 연기 | 송풍기 | — | 배연(R2 `ventilate`) | R2 | R2 | 있음(R2) |
| S21 | 로봇 조작 요원 | 살아 있는 장치 | 로봇 **알려진 고장**·없음 | — | 해체 자리에서 빠져 출입 통제(`perimeter +0.2`), `defuse` 0 (`fit`) | — | (지시 무전 끝) "(로봇 고장)" | 새로 |
| S22 | 특공 팀장 | 무장 대치, 진입 결정 전 / 뒤 | — | — | 결정 전 `negotiate +0.15`(지휘·협상), 결정 뒤 `engage +0.1`(진입조 지휘) (`fit`) | — | — | 새로 |

### 3.5 공통 (`common` — 모든 분야)

| 줄 | 누구 | 상황 | 장비 | 상태 | → 행동 (자리) | 문턱 | 기록 문구 (예) | 구분 |
|---|---|---|---|---|---|---|---|---|
| G01 | 누구나 | 무거운 일: `engage`·진입·위험 실내 일·`rescueMate`(위험 구역)·헤엄 | — | **중상**(자기 신고 band 1) | 무거운 일 `×0.35`, 가벼운 일(`perimeter`·`traffic`·`interview`·`hookup`·`clearRoad`·`load`) `+0.15`. 분야판(P12·F14·E11)이 있으면 그 줄이 대신한다 (`fit`) | band 1 (75 에서 풀림) | (자기 신고) "부상 — 가벼운 임무로 돌리겠습니다." | 새로 |
| G02 | 누구나 | 진입·위험 실내 일 | — | **동요** | `×0.6`, R2 의 `caution +0.2`(상한 1.1) (`fit` + 방법) | 4.3 | — | 새로 |
| G03 | 누구나 | 위험 실내 새 일 | — | 지구력 < 30 | `fit` 0 | 30 | — | 새로 |
| G04 | 누구나 | 내 짝이 쓰러졌다(믿음 `mate` `down`) | — | — | 그 짝의 `rescueMate +0.2`(짝이 먼저 간다). H1 의 자격(hot 이면 경찰, 위험 구역이면 scba)은 그대로 (`fit`) | — | (H1 문구) | 새로 |
| G05 | 누구나 | 판단 지점에서 막힘 | — | 지원 옴 | 기다림 상한을 늘린다(20 → 30초 등 — 줄마다 `maxWait` 함수) | — | — | 새로 (각 줄의 상한) |
| G06 | 누구나 | 쉬는 중·쉬고 싶음 | — | 지구력 < 22 / < 40 | 휴식·붙잡음 | 지금 | 지금 | 있음(지금) |
| G07 | 누구나 | 운반 중 | — | — | 교본의 의무·행동을 걸지 않는다(운반이 곧 나가는 길) | — | — | 새로 (조건으로만) |

---

## 4. 상태가 바뀔 때 — 문턱과 되돌아오는 조건

CLAUDE.md 함정 "쉬는 대원의 왕복": 들어가는 문턱과 나오는 문턱이 같으면 대원이 두 행동 사이를 오간다. 교본의 모든 상태 문턱은 **간격**을 두거나 **기억**(`a.docMem`)·**붙잡는 계속 점수**로 막는다.

### 4.1 자기 신고 (`selfReport` — `brain.think` 의 0번)

매 판단마다 자기 몸으로 `CrewBelief` 를 계산하고, 서명(`band·air·ammo·shaken`)이 `a.crewSig` 와 다르면 `learn(sim, a, mkFact('crew', a.rid, v, r.name, sim.t, 1, true, 글))`. 무전으로 바로 보낼 것: `air === 2`·`ammo === 2`·`band` 가 올라감 — `flushOutbox` 의 `prompt` 조건에 `f.type === 'crew' && (f.value.air === 2 || f.value.ammo === 2 || f.value.band >= 1)` 를 더한다(지휘관이 기다리는 정보 — CLAUDE.md 함정 "보고 지연 사이의 중복 지시"). 그 밖의 변화(나아짐)는 묶음 보고로. `significant()` 에 `'crew'` 갈래: `old.band !== v.band || old.air !== v.air || old.ammo !== v.ammo || old.shaken !== v.shaken`.

### 4.2 상태 표

| 상태 | 들어가는 문턱 | 행동 | 되돌아오는 조건 | 왕복을 막는 것 |
|---|---|---|---|---|
| 공기 (scba) | 위험 실내·연기 속에서 `air < 0.30` | 공기 탈출 의무 → 교체 | 위험 실내 일의 `fit` 은 `air ≥ 0.50` 부터(F03) | 문턱 간격 0.20. 교체 없이는 0.50 을 넘지 못한다(공기는 줄기만 한다). 탈출 중에는 `return`(의무) |
| 공기 (미리) | 바깥, 손이 빔, `air < 0.50`, 예비 > 0 | R1 공기통 교체 후보 0.7 | 교체 끝 | 예비 0 이면 후보 없음 |
| 탄 | `ammoLow` 이고 믿음 속 교전 없음 | 재보급 0.78 | `uses > magSize` | 상자 0 이면 후보 없음 + `docMem`(사건 끝까지) |
| 탄 (위급) | `ammoCrit`·0 이고 총기 위협 교전 | 엄폐 0.92 → 재보급 | 보급 뒤 | 엄폐 12초 상한, 같은 위협에 `docMem` 20초 |
| 재장전 | 탄창 0 | 2~3초 사격 멈춤 | 시간 | 자동 — 판단 아님 |
| 부상 (중상) | 자기 신고 band 0 → 1: 체력 ≤ 70 | 무거운 일 ×0.35, 가벼운 일 +0.15 | 신고 band 1 → 0: 체력 ≥ 75 | 5 의 간격(처치로 체력이 70 언저리를 오갈 때). 신고는 서명이 바뀔 때만 |
| 부상 (위중·출혈) | 체력 < 40, 또는 출혈 ≥ 0.06 && 체력 < 70 | H1 의 물러남 | H1 | H1 |
| 지구력 | 위험 실내 새 일: < 30. 하던 일: < 22 휴식(지금) | 새 일 금지 / 휴식 | 휴식은 40 까지 붙잡고 55 에서 끝(지금) | 30 / 22 / 40 의 간격. 지금 `brain` 의 휴식 계속 점수 0.96 그대로 |
| 동요 | 피격, 6칸 안에서 동료가 쓰러지는 것을 봄, 6칸 안 폭발 — 동요 중이 아니고 끝난 뒤 10초가 지났을 때만 | `a.shaken = sim.t + 20 × (1.3 − composure)`(6~26초): 진입·위험 실내 ×0.6, 방법 `caution +0.2` | 시간 | 동요 중에는 다시 걸리지 않는다(연장 없음). 끝난 뒤 10초 면역(`a.shakenOff`) |
| 혼자 | 쓸 수 있는 짝이 없고 6칸 안 같은 부서 동료 0 | 위험 실내 금지(F04), 단독 진입 보류(P07), 흉기 거리 유지(P02) | 짝이 생김(`rebuddy`·동료 도착) | 판단 지점 기다림 상한 + `docMem` 30초(4.4) |
| 지원 옴 | 같은 부서 부대가 이 사건으로 `enroute`·`turnout` | 기다림 상한을 늘린다 | 도착 | 상한 |

### 4.3 동요를 거는 자리 (실행·세계 쪽 — 상태를 바꾸는 그 코드)

- `hazards.tickHostiles` 의 대원 피격 줄(지금 `ta.underFireT` 를 정하는 곳)과 흉기·맨손 피습 줄(H1 이 `hurtEv` 를 남기는 곳).
- `agents.perceive` 에서 쓰러진 동료를 처음 보고 `mate` 사실을 만드는 곳(거리 6칸 안).
- `hazards.blast`(대원이 반경 + 3칸 안).
- 공통 함수 `doctrineRun.shake(sim, a)` 하나로 — 위 조건과 면역을 그 안에서 본다. 기록은 남기지 않는다(동요는 내부 상태다. 그 동요가 바꾼 결정이 기록된다 — 까닭 `shaken`).

### 4.4 판단 지점의 기다림과 상한 (모든 사건은 끝난다)

판단 지점에서 막힌 대원은 임무를 쥔 채 그 자리에 선다(`t.gateAt = sim.t`, 라벨은 줄의 `short`). 상한(`maxWait`)이 지나면 줄마다 정한 **timeout 갈래**로 간다:

| 판단 지점 | 기다리는 자리 | 상한 (지원 옴이면) | timeout 갈래 |
|---|---|---|---|
| `interiorEntry` (F04·F05·P17) | 문턱 칸 | 20초 (30) | 임무를 놓는다: `finishTask(…, false, 'doctrine')` — 실패 기록·`w.fails` 없음, 작업에 `holdUntil = sim.t + 10`, 대원 `docMem` 30초. 지휘관은 다른 사람(대기조가 갖춰진 짝)에게 맡기거나 CF1 로 부대를 부른다 |
| `roomEntry`·`breach` (P07) | 문 앞 | 지원이 오면 상한 없음(도착하면 풀린다), 지원이 없으면 60초 | 진입(지금 동작). 기록 "지원이 오지 않습니다 — 진입합니다." |
| `closeIn` 흉기 (P02) | 3칸 | 20초 (30) | 덮침(지금 동작) |
| `closeIn` 흉기 (P03) | 3칸 | 6초 | 덮침 |
| `closeIn` 총기 (P06·P14) | 엄폐 자리 | 상한 없음 — 기다리는 동안에도 엄폐 사격(P05)·협상(다른 대원)이 진행된다. 진입 결정(지휘관)이 나면 진입 분기로 | — |
| `carryHold` (E08) | 환자 곁 | 15초 | 옮긴다 |
| `laneTreat` (E12) | 환자 곁 | 20초 | 처치 |

- `closeIn` 총기의 "상한 없음"이 교착이 되지 않는 까닭: 대치는 지금도 협상(사기 감소 → 투항)과 지휘관의 진입 문턱(시간 규칙 60·100·125초)으로 끝난다. 혼자인 대원은 그동안 봉쇄를 유지할 뿐이고, 진입이 결정되면 P07 의 규칙(지원이 없으면 60초)으로 넘어간다. CLAUDE.md 함정 "쏘지 않는다는 규칙에는 다른 행동이 따라야 한다" — 엄폐 사격·봉쇄·지원 요청이 그 다른 행동이다.
- 기다리는 동안의 계속 점수: 막힌 임무는 작업판의 일이므로 지금의 계속 점수(0.5 + 0.4p + 0.08)를 그대로 쓴다. 교본 행동 임무의 계속 점수는 `brain` 의 "현재 임무 계속" 갈래에 더한다: `cover` 0.9, `rearm` 0.86, `pair` 0.5 + 0.4 × (짝 일의 우선순위) + 0.06.
- I1-a 의 멈춤 지표(`stall.candidates` — 지원이 오는 중이면 시계가 돌지 않는다)가 이 기다림을 거짓 교착으로 잡지 않는다. 지원이 없을 때의 기다림은 모두 상한(20·60초)이 멈춤 문턱(`STALL_SEC` 60)보다 짧거나 같다 — 60초 상한인 P07 은 그 사이 사격·협상·작업판 변화가 진전 신호다(8절에서 확인).

---

## 5. 짝(버디) 규칙과 혼자 남은 대원

### 5.1 누가 짝인가 — `PAIRS` (`doctrine.ts`, R1 의 자리 순서)

| 부대 | 짝 (자리 번호) | 짝 없이 남는 자리 | 뜻 |
|---|---|---|---|
| 순찰 2 | [0,1] | — | |
| 기동 3 | [1,2] | 0(조장) | 조장은 지휘·협상. 위험한 일에는 `rebuddy` |
| 특공 5 | [1,3] 방패수+진입대원, [2,0] 파괴+팀장 | 4(저격·관측수 — 혼자 규칙 제외) | 저격수는 원래 따로 선다 |
| 폭발물 3 | [1,2] 로봇+경계 | 0(처리 요원 — 해체는 혼자, 짝 규칙 제외) | "장치에는 한 사람만 다가간다" |
| 펌프차 4 | [1,2] 관창수+진입대원 (안), [0,3] 팀장+기관원 (밖 대기조) | — | **2인 진입 + 2인 대기**가 편성에서 바로 나온다 |
| 펌프차 3 (최소) | [1,0] 관창수+팀장 | 3(기관원 — 밖) | 밖 대기조가 1명 → F05 가 같은 사건의 다른 소방 부대를 기다린다(오는 중이면 1명으로 충분) |
| 사다리차 3 | [1,0] | 2(조작원 — 밖) | |
| 구조 공작차 5 | [1,2] 유압+유압, [3,4] 탐지+로프 | 0(팀장) | |
| 화학 4 | [1,2] 보호복+보호복 (안), [0,3] 팀장+제독 (밖) | — | S11 |
| 전문 구급차 3 | [0,1] | 2(운전원) | 운전원은 탑승·이송 |
| 일반 구급차 2 · 의료 헬기 · 소방 헬기 · 구조정 | [0,1] (내리는 자리끼리) | — | |

- `makeAgent`(R1)가 대원을 만들 때 `buddy` 를 정한다: 같은 부대의 짝 자리가 이 현장에 내렸으면 그 rid, 아니면 −1. 늦게 내린 짝은 그때 서로를 맺는다(먼저 내린 쪽의 `buddy` 가 −1 이면).
- 혼자 규칙에서 빠지는 역할(`SOLO_OK`): `marksman`·`bombTech`(해체 중)·`engineer`·`ladderOp`·`emsDriver`·`observer`. 이들에게 F04·P07·P17 이 걸리지 않는다(원래 혼자 서는 자리).

### 5.2 쓸 수 있는 짝 — `buddyOf(sim, s, a)` (판단부)

짝 `b` 가 `status === 'active'`, 부대에 `boardOrder` 없음, 다른 사람을 업고 있지 않음, 자기 신고 band < 2, 그리고 (위험 실내 일이면) `scba` 와 `air ≥ AIR_IN`. ① `fit` 자리에서 대상 작업 `w` 가 있으면 하나 더: 짝이 손이 비었거나(임무 없음·`standby`), 짝의 지금 일의 우선순위가 `w` 보다 낮거나, 짝이 이미 같은 구역·이웃 구역의 위험 실내 일을 맡았다(그래야 짝이 `pair` 로 따라올 수 있다 — 5.4). 아니면 `null`. 짝을 다시 맺는 것은 판단부가 아니라 실행부의 `rebuddy` 다(상태를 바꾸므로).

### 5.3 짝 다시 맺기 — `rebuddy` (`brain.think`, 자기 신고 다음)

짝이 없거나(`a.buddy === -1` — 편성에서 짝 자리가 빠진 최소 인원 부대 등) `a.buddy` 의 짝이 `left`·`down`·`withdrawn`·숨짐이 되면(`SOLO_OK` 역할은 하지 않는다): 같은 현장의 같은 `Dept`·`SOLO_OK` 가 아니고 짝이 없는(또는 짝을 잃은) 활동 대원 가운데 가장 가까운 사람(같으면 rid 가 작은 쪽)과 **서로** 맺는다(`a.buddy = b.rid; b.buddy = a.rid`). 판단은 대원 순서대로 돌므로 결정적이다. 기록 `emit(imp 0)` "{mate}, 지금부터 나와 짝이다." 없으면 −1 로 둔다(혼자).

### 5.4 짝 동행 — `TaskKind 'pair'`

- 짝이 위험 실내 일(또는 확보 전 무장 현장의 수색)을 맡았고 나는 손이 비었거나 그보다 우선순위가 낮은 바깥 일을 하면, `docAct` 가 후보 '짝 동행: {mate}'(점수 0.5 + 0.4 × 짝 일의 우선순위 + 0.05)를 낸다.
- 실행: 짝에게서 1.4칸 안을 따라간다(목표는 짝의 지금 자리 — 짝이 움직일 때만 다시 짠다. 한 틱 `moveTo` 하나). 따라가는 동안의 관찰은 지금처럼 `perceive` 가 한다(두 사람이 본 것이 모두 보고된다).
- 끝: 짝의 임무가 위험 실내 일이 아니게 됨(나옴) / 짝이 `active` 가 아님(쓰러지면 `rescueMate` 가 G04 로 먼저 잡힌다) / 짝이 업고 나감(그 뒤를 따라 나온다 — 끝은 바깥에 닿을 때).
- **`WorkItem.max` 를 바꾸지 않는다**(R1 원칙). 짝은 작업판의 담당자가 아니다 — 작업판에는 한 사람, 몸은 둘.
- 판단 지점 F05·P07·F04 의 "짝이 있다"는 **짝이 `pair` 로 나를 따르거나, 같은 구역·이웃 구역의 위험 실내 일을 맡았을 때**다.

### 5.5 혼자 남은 대원의 행동

| 분야 | 혼자일 때 하지 않는 것 | 대신 하는 것 | 풀리는 때 |
|---|---|---|---|
| 경찰 | 닫힌 방·동시 진입, 총기 용의자 접근, 흉기 용의자 덮침, 확보 전 수색 | 엄폐 자리에서 봉쇄·엄폐 사격, 3칸 거리 유지, 지원 요청(지휘관 CP2) | 동료 도착·짝 / 시민 위험(예외) / 지원 없이 60초(진입) |
| 소방 | 위험 실내 일(구조 대상 3칸 안의 끌어내기 제외) | 외부 방어(R2 `defensive`)·급수·교통 통제, 지휘관은 B3·CF1 로 부대를 부른다 | 짝 생김(`rebuddy`·지원 부대) |
| 의료 | — (혼자여도 처치한다) | 처치 계속, 이송은 차가 돌아올 때까지 안전 구역에서 | — |
| 특수 | 특공: 경찰과 같음. 화학: 위험 실내. 구조정 대원: 바다·해일의 헤엄(S13 — 혼자든 아니든) | 줄·장대·보트(헤엄을 고르면 R2 의 줄 확보 `tend` 가 짝에게 사고율을 낮춰 준다 — 교본 줄은 따로 두지 않는다) | 짝 |

---

## 6. 지휘관과 관제의 교본

### 6.1 지휘관 (`orders/doctrine.ts` + `commander.ts` 조각)

| 줄 | 분야 | 지금 / 새로 | 믿음·조직 정보 → 지휘 | 문구 |
|---|---|---|---|---|
| — | 경찰 | 있음(지금) | 총기 && law 부대 < 2 → law/tactical, 인질 → 기동대, 한 팀 22초, 진입 문턱(≥2·≥3·≥4), 출입 통제 | 지금 |
| CP1 | 경찰 | **새로** | 진입 문턱·두 문 진입·봉쇄 인원에 쓰는 머릿수를 **쓸 수 있는 경찰**로: R1 의 `police`(총기 && 역할 묶음 `bomb` 아님)에서 자기 신고 band ≥ 1, 탄 0(조직 정보 `kitUses`), 동요 신고를 뺀다. `commander.syncBoard` 의 `police` 를 만드는 한 줄 | — |
| CP2 | 경찰 | **새로** | 흉기 용의자 `fight` 이고 쓸 수 있는 경찰 < 2, 오는 law 부대 0 → 22초를 기다리지 않고 `request('law', '흉기 난동 — 2인 제압 인력 부족', true)` | 요청 |
| CP3 | 경찰 | **새로** | 탄 위급 신고(`crew.ammo === 2`)가 있고 현장 경찰 부대의 `ammoBox` 합이 0 → `request('law', '탄약 보급 필요', false)` | 요청 |
| CP4 | 경찰 | **새로** (확인 필요 — 균형) | 인질 사건의 "125초 && ≥ 3" 진입 줄에 "섬광탄을 가진 사람이 있거나(`hasBang`) 인질이 다쳤다고 믿을 때"를 더한다 — 섬광탄 없는 인질 진입을 하지 않는다. 대신 협상을 잇고 기동대 요청(지금 규칙) | — |
| — | 소방 | 있음(지금·R1·X6) | 진압 부대 없음·용수 없음·확대, 급수 연결, 구조 장비 없음, 진입 소방 없음, B3 `anyCapable`, X6 위험 단계 | 지금 |
| CF1 | 소방 | **새로** | 위험 실내 일이 열려 있고 `outsideWatch < 2`, 오는 진압 부대 0 → `request('suppression', '2인 대기조 확보', false)` (한 번) | 요청 |
| CF2 | 소방 | **새로** | 현장 scba 부대의 `spareAir` 합 0 이고 공기 낮음 신고(`crew.air ≥ 1`) ≥ 2 → `request('suppression', '공기통 예비 소진', true)` | 요청 |
| CF3 | 소방 | **새로** | 지금 "펌프 고장 또는 물 없음"을 한 문구로 내는 줄을 둘로: 펌프 고장이고 그 부대 `sparePump === 0` → '펌프 고장 — 진압 부대 교체', 물 없음 → 지금 문구 | 요청 |
| CF4 | 소방 | **새로** | 고립자가 있고 현장·오는 부대에 `spreader` 를 가진(알려진 고장이 아닌 — `crewHasKit`) 대원이 없다 → `request('rescue', '유압 장비 고장 — 구조 장비 필요', true)` (지금의 "구조 장비 부대 없음"은 caps 로만 센다) | 요청 |
| CF5 | 소방 | **새로** (X6 `DANGER_RULES` 한 줄) | `gas` 조짐 1 이상 + 현장·오는 부대에 측정기(`gasMeter`)를 가진 대원 없음 → 단계 1(동시 진입 2명) "측정 전 2인" | X6 문구 |
| CF6 | 소방 | **새로** (X6 `DANGER_RULES` 한 줄) | 센 불(믿음 ≥ 0.5) 150초 넘음 + 현장 scba 부대의 `spareAir` 합 0 → 단계 1 | X6 문구 |
| CF7 | 소방 | **새로** | 지휘관 자신은 현장에 다른 scba 대원이 둘 이상이면 위험 실내 일을 맡지 않는다(`assign` 의 지휘관 감점 −0.18 위에 그 일만 제외) | — |
| — | 의료 | 있음(지금·H1) | 구급 0 요청, 부상자 > 자리, 다수 사상자 5명, 동료 부상, `manageAmbulances`(H1 믿음화), `treatMate` | 지금 |
| CE1 | 의료 | **새로** | 믿음 대기 환자(band ≥ 1, 현장·안전 구역) ≥ 4 이고 구급 대원이 현장에 있고 `s.triageAt < 0` → `want('triage', {}, 0.92, 1)`. 분류가 끝나기 전에는 band 0 의 `treat` 를 내지 않는다(지금도 내지 않는다 — 확인만). `canClose` 는 열린 `triage` 를 막지 않게 끝나면 `done` | (실행기 문구) |
| CE2 | 의료 | **새로** | `treat` 담당이 비구급이고 손 빈 구급 대원이 있다 → `assign` 에서 교체: 그 담당을 빼고(그 대원의 `orderWork` 를 비움, 임무는 `finishTask(…, false, 'handover')` — 실패 아님) 구급 대원에게 지시. 지금 `assign` 의 pass 1(빈 자리만 채움)이 하지 못하는 일 | "{name}, 처치 넘겨받아라." |
| CE3 | 의료 | **새로** | 자리 1, 기다리는 환자 둘 이상 → 믿음 band 가 높은 쪽 `load` 우선도 +0.1, 낮은 쪽 `holdUntil = sim.t + 10`(그 사이 다른 차가 오면 풀린다) | "자리 하나 — 구조 대상 {s} 먼저." |
| CE4 | 의료 | **새로** | 믿음 위중 + 현장 남은 자리 0 + 오는 구급 부대의 가장 이른 도착 예상(`u.estArrive` — 조직 정보) > 100초 → `request('ems', '위중 환자 — 항공 이송 검토', true)` | 요청 |
| CE5 | 의료 | **새로** | 지휘관의 부대에 `boardOrder` 가 섰고 현장에 다른 활동 대원이 있으면, 타기 전에 지금의 승계 규칙(주관 부서·경험 순)으로 지휘를 넘긴다 — `sceneManager` 4번 블록의 조건 "지휘관이 `active` 가 아니면"에 "또는 지휘관의 부대에 `boardOrder` 가 섰으면"을 더하고, 이때의 승계 문구를 '지휘 넘김'으로(`commander.ts` 는 고치지 않는다. 부대의 `boardOrder` 는 조직 정보) | "{name}, 지휘 넘긴다 — 이송 출발. {new} 지휘권 인수." |
| — | 특수 | 있음(지금) | 처리반 요청, 장치 방 수색 거둠, 살아 있는 장치면 종료 막음 | 지금 |
| CS1 | 특수 | **새로** | 살아 있는 장치(믿음) + 해체 작업이 진행 중 → 장치 6칸 안의 열린 일(해체·출입 통제 제외) 거둠, 한 번 알림. 같은 판정을 S08 의 `fit` 이 안전망으로 쓴다(X6 가 있으면 `registerGate` 로) | "해체 시작 — 반경 6칸 비워라." |
| CS2 | 특수 | **새로** | 특공이 현장에 있으면 `engage` 배정 점수에 역할 묶음 `shield`·`entry` 와 기동대원 +0.1, 순찰 경관은 `perimeter` 쪽으로 (배정 가산 — `fit` 이 아니라 `assign` 점수) | — |

- `commander.ts` 를 고치는 곳: CP1 의 `police` 한 줄, CP4 의 인질 진입 한 줄, CF3 의 펌프·용수 요청 줄, `assign` 안의 조각(CE2 교체·CS2 가산·CF7 지휘관 제외·지시 무전 끝의 까닭 말). CE5 는 `sceneManager` 4번 블록의 조건 한 조각. 나머지(CP2·CP3·CF1·CF2·CF4·CE1·CE3·CE4·CS1)는 `orders/doctrine.ts` 의 `registerOrders` 에서 `k.want`·`k.cancel`·`k.request` 로 하고, CF5·CF6 은 X6 `DANGER_RULES` 의 줄이다.
- 지휘 줄의 기록: 그 줄이 요청·작업·배정·구역을 실제로 바꾼 자리에서 `recordDoc(…, 그 줄의 id, 'cmd', …)` 한 줄 — 요청은 `request` 의 기록 id, 배정 가산(CS2·CF7)은 그 가산이 고른 사람을 바꾼 지시의 기록 id, CF5·CF6 은 X6 의 `dangerMap` 이 그 줄로 구역을 만든 때(X6 의 구역 기록 id), CE5 는 승계 기록 id. 바꾸지 않았으면 남기지 않는다.
- `orders/doctrine.ts` 가 읽는 것: `a.beliefs`(동료의 `crew`·`mate`, 구조 대상·용의자·위험 사실), `s.board`, `sim.units`(조직 정보), `I.assigned`, `sim.responders[rid]` 의 `.unitId`·`.dept`·`.name`·역할(명부). 다른 대원의 `health`·`bleed` 를 읽지 않는다(H1 시험 11-8 과 같은 검사가 이 파일에도 걸린다).

### 6.2 관제 (`dispatch/doctrine.ts`)

| 줄 | 분야 | 지금 / 새로 | 평가·조직 정보 → 관제 | 고칠 곳 |
|---|---|---|---|---|
| — | — | 있음(지금·R1) | 유형별 수요, 배정 순서 eod → tactical → law …, 특공 > 기동(적합도), 헬기(R1 `airFit`), 구조정(바닷가), 의료 헬기 | — |
| D1 | 특수 | **새로** | 가스 누출(평가 유형 hazmat): `rescue` 수요는 화학 구조차 +30. 위험도 ≥ 1.6 이면 `rescue` 1(지금 2.1) — 화학대가 가스 현장에 온다 | `analyst` 수요(`docNeeds`), `dispatcher.pickUnit` 점수(`dispatchPref`) |
| D2 | 특수 | **새로** | `law` 수요에서 폭발물 처리반 −40(이 사건에 `eod` 수요가 없을 때) — 처리반을 인질극 진입조로 보내지 않는다(S7 의 관찰) | `pickUnit` |
| D3 | 경찰 | **새로** | 평가 유형 armed 이고 신고 문구가 흉기(평가 `nature` — 관제가 받은 말)이면 `law` 2 (확인 필요 — `callSystem` 의 흉기 키워드 이름) | `analyst` |
| D4 | 특수 | **새로** | 화재이고 주소의 건물 종류가 2층 틀(`KIND_SCENE[placeKind].tall` — 지도에서 공개된 건물 종류)이면 `suppression` 수요에 사다리차 +25 | `pickUnit` |
| D5 | 소방 | **새로** | 바닷가가 아닌 수난 → `rescue` 수요에 구조 공작차(로프 대원) +20 | `pickUnit` |
| D6 | 경찰 | **새로** | 무장 위험도 ≥ 2.4 의 `tactical` 수요에 특공이 없으면 기동대를 보내되(지금), 진입이 예상되는 인질 이름표면 기동대 둘 | `analyst` (확인 필요 — 균형) |
| D7 | 경찰 | **새로** (= P18·P19) | 추격전 역할 `chaseRoles(sim, I)`: `I.trackBy === 'air'` 이면 가장 가까운 지상 부대 하나 `follow`(알려진 위치), 나머지 `block`(예상 교차로). 헬기가 없고 지상 둘 이상이 42 안이면 셋째부터 `block`. 예상 교차로 = `I.reportedNode` 의 이웃 가운데 `I.reportedPrev → I.reportedNode` 방향과 가장 곧게 이어지는 곳(도로망 — 공개). `block` 부대의 그 교차로 도착 예상이 차보다 1.5배 넘게 늦으면 `follow` | `pursuit.tickPursuits` 의 "알려진 위치로 방향을 바꾼다" 줄이 역할을 보고 `sendUnitTo` 의 목적지를 고른다 |

- `I.trackBy` 와 `I.reportedPrev` 는 `pursuit.ts` 가 **보고가 일어나는 그 자리**에서 적는다: `p.tracked` 를 정하는 반복(보고 있는 부대가 헬기뿐이면 `'air'`, 지상 부대가 175 안이면 `'ground'`, 아무도 없으면 `null`), `I.reportedNode` 를 바꾸는 두 곳(추적·시민 목격 신고)에서 그 전 값을 `reportedPrev` 에. 보고 있는 부대가 위치를 알려 오는 것이 이미 공개 정보이므로(`I.reportedNode`) 정보 격리가 늘지 않는다.
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
- `renderScene.agentPose`: `cover` 는 G5 의 겨눔 자세(엄폐 사격이 아니어도 몸을 낮춘 그 자세), `rearm`·`airOut`·`pairOut`·`pair` 는 기본 자세, `triage` 는 R1 의 처치 자세.
- (선택) **짝 끈**: 둘 다 위험 실내에 있는 짝 사이에 가는 흰 점선(`view/scene/doctrineLayer.ts`, 대원 층 바로 아래). 2인 진입을 눈으로 보게 한다. G4·G5 는 대원 사이 선을 그리지 않는다(확인함). 화면이 어지러우면 빼도 된다.

### 7.3 보고서 (`debrief.ts`)

보고서 문장은 기록(`I.docs`)과 문제에서만 만든다 — 보고서를 쓸 때 다시 계산하지 않는다.

- **사건 분석 문장**: `I.docs` 의 `say: true` 줄 가운데 순위(줄의 `rank`)가 가장 작은 것부터 **최대 2문장**, R2 의 방법 문장 다음·맺음말 앞, 방법 문장과 합쳐 **최대 3문장**, `A.length < 12` 일 때만(R2 와 같은 상한 — 문제 설명이 먼저). 템플릿은 줄의 `report`:
  - F01: "이서준 대원은 공기 잔량이 30% 아래로 떨어지자 짝 박서윤 대원과 함께 건물 밖으로 나왔습니다."
  - P07: "순찰1 이 혼자 남아 방에 들어가지 않고 42초 동안 지원을 기다렸습니다."
  - P02: "김도윤 대원은 테이저가 없어 흉기를 든 용의자와 거리를 두고 지원을 기다렸습니다."
  - F05: "진압2 는 밖에 대기조가 없어 진입을 28초 미뤘습니다." / 예외 "요구조자가 있어 대기조 없이 진입했습니다."
  - E08: "처치가 끝날 때까지 이송을 미뤘습니다." 같은 짧은 줄은 `say: false`(보고서에 싣지 않는다 — 기록에만).
- **까닭 말** `WHY_DOC`: `alone: '혼자였음'`, `buddy: '짝과 함께'`, `outside: '밖에 대기조가 없었음'`, `hurt: '다쳐서'`, `lowAir: '공기가 부족해'`, `lowAmmo: '탄약이 떨어져'`, `noKit: \`${kitName(…)}이/가 없어\``, `civ: '시민이 위험해'`, `hostage: '인질이 위험해'`, `backup: '지원이 오고 있어'`, `triage: '부상자가 많아'`, `danger`·`kit`·`tired`·`shaken`·`protocol`.
- **교대 보고서**: `doctrine`(줄별 횟수 — 기록 없이 센 `fit` 줄 포함)을 채우고, 요약에 한 줄 — "교본: 공기 탈출 3 · 단독 진입 보류 2 · 엄폐 5 · 가벼운 임무 4 · 분류 1"(`short`, 많은 순 다섯). 하나도 없으면 줄을 넣지 않는다.
- 새 문제 코드는 만들지 않는다(11.3 결정 4). 교본은 실패가 아니라 선택이다. 교본 때문에 늦어진 결과는 지금의 판정(대응 지연·실패)과 위 문장이 함께 말한다.

---

## 8. 균형과 측정

### 8.1 교본이 결과에 주는 영향

| 쉬워지는 쪽 | 어려워지는 쪽 |
|---|---|
| 엄폐 사격·숨기로 대원 피격이 준다. 다친 대원이 가벼운 일로 돌아 쓰러지는 일이 준다. 짝이 쓰러진 짝을 바로 끌어낸다. 분류로 위중 환자가 먼저 처치된다. 처치 중 이송이 사라져 처치 질이 오른다. 처치 넘겨받기. 경계 밖 처치소. 화학대가 가스 현장에 온다. 사다리차가 2층 화재에 온다 | 2인 진입·대기조로 실내 진입이 늦어진다(화재). 단독 진입 보류·흉기 거리 유지로 대치가 길어진다. 재장전·재보급으로 사격이 멈춘다. 공기 탈출로 실내 작업이 끊긴다. 인질 덮침 제한(P14·CP4)으로 대치가 길어진다. 추격 앞막기가 도주 차를 다른 길로 몬다(놓칠 수 있다) |

### 8.2 목표 (보통, 시드 60 — **R2 를 합친 뒤의 기준 수치** 대비. 0단계 전에 같은 명령으로 재어 scratchpad 에 둔다)

- 전체: `npm run check` 의 범위 안. 성공률(`outcomes.success / incidents`) 기준 ±3%p, 한계 시간 + 방치 기준 + 2 이하.
- 유형별: 무장 ±5%p, 화재 −6 ~ +3%p, 응급 ±5%p(대응 지연 비율이 늘지 않는다), 그 밖 ±5%p.
- **대원 부상**: 교대당 `RESPONDER_HURT` 가 기준 이하, `--force armed/shooter`·`armed/siege`·`fire/std` 20교대에서 기준 대비 −10% 이상. 순직(H1) 기준 이하.
- **행동 다양성**(I1-a): `actions.entropy` ≥ 기준 − 0.02, `actions.methodEntropy`(R2) ≥ 기준, `stall.candidates ≤ STALL_ALLOW`, `stall.forgotten ≤ FORGOT_ALLOW`.
- **같은 상황 다른 행동** `doctrine.split`: (분야, 국면, 임무) 열쇠별로 고른 결과(방법 또는 교본 행동 또는 "교본 없음")의 가짓수를 세어, 표본 10 이상인 열쇠 가운데 가짓수 ≥ 2 인 비율 ≥ 0.5.
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
2. 무장 대치가 길어지면(한계 시간·투항 비율): P02 상한 20 → 12초, P07 의 지원 없음 60 → 40초, CP4 를 끈다.
3. 추격 놓침이 늘면: D7 의 `block` 을 헬기가 있을 때만으로, 1.5배 조건을 1.2배로.
4. 너무 쉬워지면(피격이 크게 줄어 무장 성공률이 오르면): 엄폐 사격의 자리 반경 4 → 3, P11 을 체력 < 50 으로.
5. 그 밖: 가벼운 일 배율 0.35 → 0.6, 탄약(권총 30 → 45).

---

## 9. 구현 순서와 완료 조건

분야 하나씩. 각 단계 끝에 `npx tsc --noEmit` → `npx vitest run tests/doctrine.test.ts tests/ext.test.ts`(그 단계의 시험) → 8.3 의 전후 비교 → **`npm run check` 통과** → 커밋(한국어, `wf/doctrine` 에만, 푸시하지 않는다). 그림만 고친 커밋은 시뮬레이션 커밋과 나눈다.

| 단계 | 할 일 | 끝났다는 증거 |
|---|---|---|
| **0 틀** | `types.ts` 의 자료형(합집합은 빼고 — 2.1), `doctrine/registry.ts`·`doctrine.ts`(엔진·`DocCtx`·`coverSpot`·`buddyOf`·`outsideWatch` — 줄 없음), `doctrine/index.ts`·다섯 줄 파일(빈 파일), `doctrineRun.ts`(`recordDoc` 만), 걸리는 자리 넷의 호출(`fitFor` 끝 `docFit` — 줄이 없으면 그대로 돌려준다, `brain` 의 `docDuty`·`docAct` — null 이면 아무것도 넣지 않는다, R2 `chooseMethod` 의 배율 — 1, 실행기의 `docGate` — 늘 통과), `sweep --doctrine`(빈 표), 패널 칸(빈 칸), 시험 1·5 | `tsc` 통과, **기록 해시가 전과 같다**(S0~S9 의 `sim.report.hash` 전후 비교 — 후보를 하나도 더하지 않으므로 `a.rng` 소비가 같다) |
| **1 공통** | `crew` 사실(`FactType`·`significant`·`prompt`)과 `selfReport`, 중상 간격(70/75), 동요(`shake` 세 자리), `a.docMem`, G01~G05·G07, 지시 무전의 까닭 말, 보고서의 교본 문장·요약 줄, 패널의 상태 칩 | 시험 2-e·4·7, 8.2 의 전체 범위 |
| **2 경찰** | 탄약(2.9: `KitDef` 세 칸·총기 `uses`·명부 복사·`shootAt`·`reloadTick`·`rearm`·`ammoBox`·집에서 채움), 엄폐(2.10: `coverSpot`·`cover` 임무·`engage` 마지막 분기), `closeIn`·`coverFire`·`roomEntry`·`breach`·`bangUse` 판단 지점, P 줄 전부, CP1~CP4, D2·D3·D6, 추격 D7(`trackBy`·`reportedPrev`·`chaseRoles`), `TaskKind` 의 `cover`·`rearm` | 시험 2-a·2-b·2-d·2-h, 무장 강제 묶음의 표, 대원 부상 목표 |
| **3 소방** | 짝(`PAIRS`·`makeAgent` 의 `buddy`·`rebuddy`·`pair` 임무), `interiorEntry` 판단 지점, `airOut`·`pairOut` 의무와 `AIR_IN`, R1 공기통 교체 후보의 문턱, `feel`·`pulse` 방법 행, `sparePump`, F 줄 전부, CF1~CF7(CF5·CF6 은 X6 `DANGER_RULES` 두 줄), D4·D5, `TaskKind` 의 `airOut`·`pairOut`·`pair` | 시험 2-c·2-f·3·4, 화재 강제 묶음의 표, 8.2 의 화재 범위 |
| **4 의료** | `WorkKind 'triage'`(`workLabel` '다수 사상자 분류', `fitFor`: 구급만, 실행: 믿음 속 환자마다 2초 서서 `casFact` 강제 보고 → `s.triageAt`), 경계 밖 처치소(E05), `carryHold`·`laneTreat` 판단 지점, E 줄 전부(E13·E14 는 6단계), CE1~CE5 | 시험 2-g, 응급·교통 강제 묶음, 응급 대응 지연이 늘지 않는다 |
| **5 특수** | 줄 서기 진입(S01), 저격·섬광탄 가산(S02·S05), 해체 방법 셋(`robotDefuse`·`suitDefuse`·`bareDefuse` — `fitFor defuse` 에 로봇 자격), 장치 반경(S08·CS1, `agentCost` +20), 화학 짝·제독 대기(S11), 수난·헬기 줄(S13·S15), 사다리 조작원(S19), CS2, D1 | 시험 2-i, 폭발물·가스·수난 강제 묶음 |
| **6 이송·교통 방법** | R2 방법 행 `pack`·`drag`·`litter`(기록 전용)·`post`·`blockLane`, `s.laneShield` 와 `hazards.tickLane` 의 배율 한 줄, 판단 지점 `carryStart`, P20·F18·E13·E14 | 교통 강제 묶음, 2차 사고 수가 늘지 않는다 |
| **7 화면** | 7.1·7.2 전부 | 6단계 끝의 기록 해시와 **같다**(시드 20개), 스크린샷 직접 확인(`?seed=S7&force=fire/std`, `armed/hostage`, `traffic/bus`, `armed/bomb`), 콘솔 오류 0건 |
| **8 균형과 문서** | 8.2 최종 확인, 이 문서 끝에 구현 메모, (합칠 때) `README.md`·`CLAUDE.md`(11.5)·`docs/ROADMAP.md` | 보고 |

**완료 조건**(측정 가능하게):

1. **쓰인 줄의 비율**: 분야마다 **등록한 줄(`DOCTRINE` 의 개인 줄 + 그 분야의 `CMD_ROWS` 지휘·관제 줄 — 3절 "읽는 법") 가운데 8.3 의 측정 묶음(보통 60교대 + 단계별 강제 묶음 + 최소 인원·장비 불량 묶음)에서 한 번이라도 쓰인 줄 ≥ 75%**. 측정 묶음에서 쓰이지 않은 줄은 **모두** 장면 시험(10절 2와, 거기 없는 줄은 같은 방식으로 더한 장면)이 쓴다 — 측정 묶음 ∪ 시험 = 100%. "쓰였다" = `I.docs` 에 그 `id` 의 줄이 있다(`fit` 줄은 그 줄이 값을 바꾼 대원이 배정된 때 — 2.7).
2. **같은 상황 다른 행동**: `doctrine.split ≥ 0.5`(8.2).
3. 8.2 의 균형 목표(전체·유형별·대원 부상·다양성·추격·시간).
4. 시험 1~9 통과, `npm run check` 통과, 강제 묶음마다 한계 시간·방치 2건 이하.
5. 7단계의 해시 불변.

---

## 10. 테스트 (`tests/doctrine.test.ts`)

무거운 반복은 피한다: 강제 교대는 `new Sim(seed, NORMAL, 1200, { force: 'fire/std' })`, 장면 단위는 `createIncident(sim, { type, variant, rng: sim.rng.fork('t') })` 뒤에 대원·장비·몸 상태를 직접 놓는다. 장비를 빼는 것은 R1 의 장비 항목에 `faultKnown = true` 를 주거나 `kit` 에서 지운다. 특정 부대만 나가게 하려면 다른 부대를 시작 전에 `oos` 로 둔다.

1. **정보 격리**: `src/sim/field/doctrine.ts`·`doctrine/*.ts`·`orders/doctrine.ts`·`dispatch/doctrine.ts` 의 주석이 아닌 줄에 `s.props`·`s.casualties`·`s.hostiles`·`.truth`·`s.fire[`·`s.smoke[`·`sim.scenes`·`s.variant`·`.fault`·`kitWorks`·`useKit`·`toolUse`·`needsHospital` 가 없다. `/sim\.responders\[(?!a\.rid\])/` 가 `doctrine.ts` 와 줄 파일에서 0건, `orders/doctrine.ts` 에서는 `.health`·`.bleed`·`.dead`·`.injuries` 0건. `doctrine.ts` 가 `agents`·`executor`·`hazards`·`methods`·`methodRun`·`doctrineRun`·`crews` 를 import 하지 않는다. 줄 파일은 `doctrine/registry` 와 타입·`util` 만 import 한다.
2. **같은 상황, 다른 장비·상태 → 다른 행동** (장면을 직접 만든다):
   - a. 흉기 난동(`armed/dispute`, 용의자 `fight`): ① 순찰 둘, 테이저 있음 → 테이저 발사 기록과 `P01` ② 테이저 지움, 둘 → 동시 덮침 `P03` ③ 테이저 지움, 하나(다른 대원 `oos`) → 3칸 거리 유지 `P02`, 20초 안에 덮치지 않는다 ④ ③ + 시민을 용의자 1.5칸에 → 바로 덮침(예외 기록).
   - b. 닫힌 방의 총기 용의자: 진입조 하나 → 4초가 지나도 들어가지 않는다(`P07`, `gateAt` 이 있다). 동료를 붙이면 들어간다. 지원이 없는 상태로 60초 → 진입(timeout 문구).
   - c. 화재 실내 수색: 짝 있음·대기조 둘 → 맡는다. 짝을 `withdrawn` 으로 → `fitFor` 0(`F04`). 밖 대기조 0 이고 믿음 구조 대상 없음 → 문턱에서 기다림(`F05`). 같은 장면에 `occ` 사실(요구조자 2명) → 진입(예외 기록).
   - d. 탄: 교전 중 권총 `uses` 를 2 로 → 다음 판단의 임무가 `cover`, 끝나면 `rearm`, 보급 뒤 `uses === 30`, 부대 `ammoBox` 하나 줄어듦. `ammoBox = 0` → '보급할 탄약이 없습니다'와 `P22` 의 `fit`.
   - e. 중상: 같은 경찰 두 사람 가운데 하나의 `crew` 사실 band 1 → `engage` 의 `fitFor` 가 0.35배, `perimeter` 는 +0.15 — 지휘관 배정에서 다친 대원이 봉쇄를 받는다.
   - f. 공기: 연기 속 실내의 scba 대원 `uses = 0.25 × airFull` → 다음 판단에 `airOut`, 그 짝은 `pairOut`. 바깥에서 교체 뒤 `uses === airFull`, 예비 하나 줄어듦.
   - g. 의료: 경찰이 처치 중인 환자 → 구급 대원이 오면 넘겨받는다(`CE2`). 구급 대원이 처치 중인 환자를 다른 대원이 들지 않는다(`E08`, 15초 상한). `hot` 인데 안전 구역의 환자 → 구급 대원 처치(`E05`). 믿음 환자 5명 → `triage` 작업이 생기고 끝나면 `s.triageAt ≥ 0`.
   - h. 추격: `I.trackBy = 'air'` 로 두고 `chaseRoles` → 지상 부대 셋 가운데 `follow` 하나·`block` 둘, `block` 의 목적지가 진행 방향의 교차로.
   - i. 폭발물: 로봇 작동 → `robotDefuse`, 로봇 `fault` → 처음 쓸 때 `EQUIP_FAIL` 과 `suitDefuse` 로. 방호복 없음·주변 구조 대상 없음 → `bareDefuse` 를 고르지 않는다.
3. **판단에 새지 않는다**:
   - 숨은 고장: 열화상·로봇·유압 장비에 숨은 고장(`fault: true, faultKnown: false`)이 있는 대원과 없는 대원의 `docFit`·`docAct`·`docMethodMul` 이 같다(R1 시험 ④ 와 같은 방식).
   - 남의 몸: 대원 `b` 의 체력을 85 → 50 으로 바꾸고 `b` 의 `crew` 사실은 그대로 두면(자기 신고 전) 지휘관이 부르는 `docFit(sim, s, b, w)` 이 바뀌지 않는다. `b` 가 다음 판단에서 신고하면 바뀐다.
4. **왕복 없음**:
   - 공기: `AIR_OUT ≤ air < AIR_IN` 인 대원은 위험 실내 일을 맡지 않는다(`fitFor` 0) — 탈출 뒤 교체 없이 다시 들어가지 않는다.
   - 강제 묶음(`fire/std` 6교대, `armed/hostage` 6교대)에서 대원별 임무 흐름을 기록해, 10초 안에 `A → B → A` 로 바뀌고 그중 하나가 교본 임무(`cover`·`rearm`·`airOut`·`pairOut`·`pair`)인 경우가 0. 중상 간격: 체력을 68 ↔ 72 로 흔들어도 자기 신고 band 가 1 에 머문다(75 에서만 0).
   - 동요: 동요 중에 피격을 더 받아도 `a.shaken` 이 늘지 않는다. 끝난 뒤 10초 안의 피격은 동요를 걸지 않는다.
5. **재현성과 순수 함수**: 같은 시드 두 번의 `report.hash` 가 같다 — 보통 교대, `fire/std`·`armed/hostage` 강제. `docFit`·`docAct`·`docDuty`·`docGate`·`docMethodMul`·`coverSpot`·`buddyOf` 를 백 번 불러도 시뮬레이션 상태(장비 수량·고장 표시·`a.docMem`·`a.buddy`·난수 흐름의 다음 값)가 바뀌지 않는다. 0단계 커밋은 S0~S9 의 해시가 그 전 커밋과 같다(9절 — 이 시험은 그 커밋에서만 손으로 돌린다).
6. **모든 사건은 끝난다**: 최소 인원(`--diff 3,3,3,3,3,1` 과 같은 난이도) 강제 묶음 `fire/std`·`armed/dispute`·`armed/hostage` 각 6교대에서 교대가 끝났을 때 닫히지 않은 사건 0, `onscene` 으로 남은 부대 0, 모든 현장 `archived`, 한계 시간·방치 각 1건 이하.
7. **기록**: 교본 행동마다 `emit` 이 한 번(20초 안에 같은 대원·같은 줄의 문구가 둘이 아니다), 판단 지점의 막힘 문구는 임무마다 한 번, `I.docs` 에 그 줄. 공기 탈출이 있었던 사건(문제 셋 이하)의 `result.analysis` 에 "공기" 가 든 문장. 교대 보고서 요약에 "교본:" 줄.
8. **표 자체**: `DOCTRINE` 의 `id` 가 겹치지 않고 `/^[GPFES][0-9]{2}$/`, `CMD_ROWS` 의 `id` 가 `/^(C[PFES][0-9]|D[0-9])$/` 이고 `DOCTRINE` 과 겹치지 않는다. `hook` 에 맞는 칸(`gate` 줄은 `gate`, `method` 줄은 `methods`, `act`·`duty` 줄은 `effect.act`, `choose` 효과는 `gate` 줄에만), `note`·`report` 의 자리표시자가 `{name}`·`{mate}`·`{new}`·`{n}`·`{m}`·`{k}`·`{s}` 뿐. 분야마다 등록한 줄(개인 줄 + 그 분야의 `CMD_ROWS`)이 12개 이상(공통 제외).
9. **의무 순서**: `boardOrder` 가 선 대원은 공기 30% 미만이어도 `board`. X6 의 철수 명령을 받은 대원은 `evacuate`(공기 탈출보다 먼저). 업고 있는 대원에게 `airOut` 이 걸리지 않는다. R2 의 물 위 대원에게 교본의 의무가 걸리지 않는다.

---

## 11. 고칠 파일, 알려진 위험, 결정 사항

### 11.1 공용 파일 수정

| 파일 | 함수·자리 | 무엇을 · 왜 | 단계 |
|---|---|---|---|
| `types.ts` | 2.1 | 추가만. 합집합은 그 단계에서 | 0~6 |
| `difficulty.ts` | `Tuning`·`tuningOf` | `ammoBox`·`sparePump`, `KNOBS` 장비 설명문 끝에 '탄약 상자·예비 펌프' | 2·3 |
| `crews.ts` (R1) | `KitDef`, `KITS` 총기 셋 | `mag`·`reload`·`perShot` 칸, 총기 `uses`·`mag` | 2 |
| `resources.ts` | `createRoster`·`createAidUnit` | 총기 `mag` 복사, `ammoBox`·`sparePump` 채움 | 2·3 |
| | `arrive` 의 `returning` | `ammoBox`·`sparePump` 가득 (R1 의 `spareAir` 옆) | 2·3 |
| `field/agents.ts` | `fitFor` 맨 끝 | `return docFit(sim, s, a, w, fit)` (R1 역할 선호 다음) | 0 |
| | `significant`, `flushOutbox` 의 `prompt` | `'crew'` 갈래 (4.1) | 1 |
| | `perceive` 의 쓰러진 동료 | `shake` (4.3) | 1 |
| | `makeAgent` (R1) | `buddy` (5.1), 새 칸의 리터럴 | 3 |
| | `workLabel`·`fitFor` 의 `triage` | 4단계 | 4 |
| | `agentCost` | 장치 반경 +20 (S08) | 5 |
| `field/brain.ts` | `think` | 0번 `selfReport`·`rebuddy`, 4번 의무 자리(X6 `evacuate` 다음), 5번 `docAct` 후보(R1 공기통 교체 다음), 계속 점수에 새 임무 셋, 후퇴 후보를 엄폐로 바꾸는 P11 | 0~3 |
| | R1 공기통 교체 후보 | 문턱 `air < AIR_IN && 바깥 && 손이 빔` 을 더한다(F03) | 3 |
| | 예비 펌프 후보 | `sparePump > 0` 조건(F10) | 3 |
| `field/executor.ts` | `shootAt` | 탄약 소모·재장전 중 돌아가기(난수 전에) (2.9) | 2 |
| | `act` 첫머리 | `reloadTick` 한 줄 | 2 |
| | `case 'engage'` | 첫 갈래의 `closeIn`(P01~P03), 진입 대기·방 진입의 `breach`·`roomEntry`(P07), 섬광탄의 `bangUse`(P15), 인질 덮침의 `closeIn`(P14), 마지막 분기의 `coverFire`(P05)·혼자일 때의 `closeIn`(P06), 줄 서기(S01 — `breach` 의 `choose 'stack'`) | 2·5 |
| | `case 'negotiate'` | 용의자 `fight` 면 `cover` 로(P16 — `brain` 의 후보로 넘긴다) | 2 |
| | 위험 실내 첫걸음 | `interiorEntry` 판단 지점 (`moveTo` 를 부르기 전, 지금 칸이 실내가 아니고 경로의 다음 칸이 위험 건물 실내일 때) | 3 |
| | `case 'carry'`·`case 'treat'` | `carryHold`·`laneTreat` (E08·E12), 처음 들 때의 `carryStart`(E13 — 6단계) | 4·6 |
| | `case 'defuse'` | 해체 방법 셋 (S06·S07 — 실행은 `doctrineRun` 의 `runDefuse`) | 5 |
| | `case 'traffic'` | `post`·`blockLane` (6단계) | 6 |
| | 새 `case` 여섯 | `cover`·`rearm`·`airOut`·`pairOut`·`pair`·`triage` → `doctrineRun` 의 실행 함수 (R2 의 `XK: ExecKit` 를 그대로 넘긴다) | 2~4 |
| | `finishTask` 사유 표 | `doctrine`·`handover` (실패 기록·`w.fails` 없음) | 3·4 |
| `field/methods.ts` (R2) | `MethodCtx`·`chooseMethod` | `dc: DocCtx` 칸, 점수에 `× docMethodMul`, `caution` 에 동요 +0.2(G02, 상한 1.1), `MethodWhy` 다섯의 까닭 계산(교본 배율을 빼고 다시 셈한 1등이 다르면 그 줄의 까닭) | 0·1 |
| | `METHOD`·`SAY`·`WORK_MODE` | 행 열 개 (2.1) | 3·5·6 |
| `field/methodRun.ts` (R2) | 진압·수색·이송·통제·해체 실행부 | `pulse`·`feel`·`pack`·`drag`·`post`·`blockLane`·해체 셋의 효과 | 3·5·6 |
| `field/commander.ts` | `syncBoard` 의 `police` 한 줄 | CP1 | 2 |
| | 인질 진입의 125초 줄 | CP4 (확인 필요) | 2 |
| | `assign` | CE2 교체·CS2 가산·CF7 지휘관 제외·지시 무전 끝의 까닭 말 | 1·3·4·5 |
| | 펌프·용수 요청 줄 | CF3 문구 나눔 | 3 |
| `field/sceneManager.ts` | 4번 블록(승계) | 조건에 "지휘관의 부대에 `boardOrder` 가 섰으면" 한 조각, 그때의 승계 문구 '지휘 넘김' (CE5) | 4 |
| `field/hazards.ts` | `tickHostiles` 피격·피습 줄, `blast` | `shake` (4.3) | 1 |
| | `tickLane` | `s.laneShield` 이면 그 방향 2차 사고 확률 ×0.4 (곱만 — `s.rng` 호출은 그대로) | 6 |
| `field/orders/catastrophe.ts` (X6) | `DANGER_RULES` | 줄 둘(CF5·CF6 — 표의 모양 그대로) | 3 |
| `pursuit.ts` | 추적 반복·목격 신고 | `I.trackBy`·`I.reportedPrev` 적기, 방향 전환 줄에서 `chaseRoles` | 2 |
| `dispatch/dispatcher.ts` | `pickUnit` 점수 | `+ dispatchPref(sim, I, u, need)` | 2·3·5 |
| `dispatch/analyst.ts` | 수요 | `docNeeds(n, as)` (D1·D3·D6) | 2·5 |
| `debrief.ts` | `evaluate` 끝(맺음말 앞, R2 방법 문장 다음) | 교본 문장 최대 2(방법과 합쳐 3) | 1 |
| | `buildReport` | `doctrine` 집계, 요약 한 줄 | 1 |
| `field/scenes/index.ts` | 끝 | `import '../doctrine/index';` `import '../orders/doctrine';` | 0 |
| 생성 리터럴 | `makeAgent`·`makeTask`·두 `Unit` 리터럴·`baseScene`·`createIncident` | 새 선택 칸 (2.1 끝 — 속도만) | 0 |
| `view/renderScene.ts` | `agentPose` | `cover` 의 자세 (7.2) | 7 |
| `view/scene/doctrineLayer.ts` (새, 선택) | — | 짝 끈 | 7 |
| `ui/panels.tsx` | `AgentPanel` | 7.1 | 1·7 |
| `scripts/sweep.ts` | 인자·출력 | `--doctrine` (8.3) | 0 |
| `tests/crews.test.ts` (R1) | 총기 장비를 글자 그대로 비교하는 곳이 있으면 | `uses`·`mag` 를 기대값에 | 2 |

### 11.2 알려진 위험

1. **2인 진입·대기조가 화재를 어렵게 만든다.** 최소 인원 펌프차(3명)는 밖 대기조가 1명이라 다른 소방 부대를 기다린다. 신고 인원이 있으면 예외라 대부분의 화재는 바로 들어가지만, 사람이 없다고 알려진 큰 불은 늦게 들어간다(의도 — R2 의 외부 방어와 같은 방향). 8.4 의 1번 손잡이.
2. **대치가 길어진다.** 단독 진입 보류(P07)·흉기 거리 유지(P02)·인질 덮침 제한(P14·CP4)이 모두 기다리는 쪽이다. 지원이 오면 풀리고 상한이 있지만, 극한 난이도(지원이 오지 않는다)에서 한계 시간이 늘 수 있다. 8.4 의 2번.
3. **탄약 줄은 드물게만 쓰인다.** 교전이 대개 짧다(20교대 특공 교전 187초). 완료 조건 1이 장면 시험으로 보충한다. 너무 드물면 권총을 15+15 에서 줄이지 말고 그대로 둔다(현실적인 드묾).
4. **추격 앞막기가 도주 차를 다른 길로 몬다.** 도주 차는 추격자에게서 170 안의 교차로를 피해 고른다(`pursuit.pickNext`). 앞막기 부대가 예상 교차로에 가면 차가 그 길을 피해 놓칠 수 있다. 8.2 의 놓침 목표, 8.4 의 3번.
5. **무전이 는다.** `crew` 사실(자기 신고)과 교본 문구로 기록 줄이 늘어난다. 상태 변화 때만 보내고 같은 말은 20초에 한 번이지만, 기록 창이 붐비면 `crew` 의 나아짐(공기 교체 뒤 등)은 묶음 보고로만 보내고 문구를 비운다.
6. **판단 오차의 난수가 밀린다.** 교본 후보 하나가 그 대원의 `a.rng` 흐름을 한 칸 민다(2.8). 0단계만 해시가 같고 1단계부터 모든 시드가 바뀐다.
7. **R1·H1·X6·R2 가 문서대로 구현되지 않았을 수 있다.** 함수 이름(`makeAgent`·`kitCount`·`chooseMethod` 의 인자·`DANGER_RULES` 의 줄 모양·`evacuate` 자리)이 다르면 실제 코드를 따른다. 이 문서의 표는 그 함수들의 "역할"로 읽는다.
8. **짝을 다시 맺을 때 다른 대원의 칸을 고친다**(`b.buddy`). 대원 순서대로 판단하므로 결정적이지만, 같은 틱에 두 대원이 서로 다른 짝을 고르지 않게 "짝이 없는 사람만" 고른다(5.3).
9. **성능**: `docFit` 이 `fitFor` 마다 불린다. 2.4 의 캐시로 틱마다 한 번만 상태를 만든다. R1 로 대원이 1.9배쯤 는 것과 겹친다 — 8.2 의 1.15배를 넘으면 `docFit` 을 `(rid, workId, tick)` 으로 담아 둔다.
10. **동요는 침착함이 낮은 대원을 크게 바꾼다**(6~26초). 무장 결과가 흔들리면 길이를 `12 × (1.3 − composure)` 로 줄인다.
11. **`coverSpot` 이 없는 현장**: 길 위 현장(`s.outdoor` — 추격 끝)과 넓은 홀에는 엄폐 칸이 적다. 자리가 없으면 지금 동작으로 가므로 막히지는 않지만, 그 현장에서는 P05·P11 이 거의 쓰이지 않는다.

### 11.3 결정 사항 (조사에서 열려 있던 질문)

1. **고르는 자리**: 판단 전용 파일의 순수 함수를 네 자리(`fit`·`duty/act`·`method`·`gate`)에서, 지휘·관제는 이미 격리된 두 파일에서(2.3). 실행기가 진실로 고르는 길은 두지 않는다.
2. **남의 몸**: 지휘 쪽과 `fit` 은 자기 신고 `crew` 사실로만 안다. `mate` 사실을 쓰지 않는다(H1 의 `treatMate` 가 걸린다 — 2.4).
3. **예외는 금지 줄의 `when` 안에**: "허락" 줄을 따로 두지 않는다(2.6).
4. **새 문제 코드를 만들지 않는다**: 교본은 선택이다. 보고서는 `I.docs` 로 말한다(7.3).
5. **탄약은 가볍게**: 탄창·재장전·재보급·상자. 총기 종류별 사거리·명중은 R1 그대로. 탄약 수는 교대 사이에 남지 않는다(I2 가 정하지 않는 한).
6. **거리 유지(`standOff`)는 임무가 아니라 `engage` 안의 분기**다 — 임무로 만들면 지휘관의 `engage` 작업과 대원의 임무가 갈라진다. 엄폐(`cover`)는 상태 행동이라 임무다.
7. **시한은 쓰지 않는다**: 폭발물의 시한은 진실에만 있다. 교본의 "서두름"은 시한이 아니라 장비(로봇·방호복)와 주변 사람(믿음)으로 정한다.
8. **창문 구조는 하지 않는다**(ROADMAP C4 — 사다리차의 위층 구조는 현장 격자에 바깥에서 위층으로 가는 길이 없다).
9. **짝은 작업판의 담당자가 아니다**(`WorkItem.max` 그대로 — R1 원칙). 몸은 둘, 담당은 하나.
10. **사다리차는 교본 표만 특수**에 두고 부대 분야·편성은 R1 그대로(2.2).
11. **분류는 새 작업(`triage`)**이다 — 처치의 방법으로 넣으면 환자 한 사람의 일이 되어 "모두를 먼저 본다"가 되지 않는다.

### 11.4 확인 필요 목록

- X6 `DANGER_RULES` 의 실제 줄 모양(R3 의 CF5·CF6 두 줄을 그 모양에 맞춘다).
- R1 `makeAgent` 가 실제로 꺼내졌는지, 대원 리터럴의 자리(짝 초기화를 넣는 곳).
- R2 `chooseMethod` 의 실제 인자와 `MethodCtx` 가 export 되는지(R3 는 타입만 필요하다).
- `callSystem` 의 흉기 신고 키워드(D3) — 관제가 "흉기"를 아는 칸의 이름.
- `KIND_SCENE[placeKind]` 의 2층 표시 칸 이름(D4 — `tall` 로 적었다).
- CP4(섬광탄 없는 인질 진입 금지)·D6(기동대 둘)은 균형을 보고 켤지 정한다.
- I2 가 `ammoBox`·`sparePump`·동요를 이어받을지(I2 §3.3 의 표에 줄을 더하는 것은 I2 몫).
- 교본 문장과 R2 방법 문장의 합계 상한 3 이 보고서 길이에 맞는지(R2 의 "11~12줄에서 잘린다").

### 11.5 `CLAUDE.md` 에 들어갈 줄 (합친 뒤에 고친다)

**구조** 절에 세 줄: `src/sim/field/doctrine.ts`(교본 판단 엔진 — 믿음·자기 몸·자기 장비만), `src/sim/field/doctrine/`(분야별 교본 줄), `src/sim/field/doctrineRun.ts`(교본 행동의 실행·탄약·짝). 정보 격리 목록의 "진실을 읽으면 안 되는 곳"에 `field/doctrine.ts`·`field/doctrine/*`·`dispatch/doctrine.ts`.

**자주 하는 확장** 표에 한 줄:

| 하고 싶은 것 | 고칠 곳 |
|---|---|
| 새 교본 줄 (이 상황·장비·상태면 이것을 먼저) | `field/doctrine/<분야>.ts` 끝에 `registerDoctrine({ id, dept, who, hook, works/gate/methods, kits/noKits, when, effect, rank, why, note, report })` — `when` 은 `DocCtx` 만 읽는다(믿음·자기 몸·자기 장비). 새 상태 행동이면 `types.ts` `DocActId`·`TaskKind` → `doctrineRun.ts` 실행 → `brain` 계속 점수. 새 판단 지점이면 `DocGateId` → 실행기의 그 분기에서 `docGate` 를 부르고 막히면 기다림·상한(4.4). 확인은 `npm run sweep -- 20 --force 유형/변형 --scen --doctrine` |

**함정** 후보:
- **교본은 진실을 읽지 않는다.** 줄은 `DocCtx` 만 받는다. 남의 몸은 자기 신고(`crew` 사실)로만 — `fitFor` 는 지휘관이 다른 대원에게도 부르기 때문이다. 공기·탄은 조직 정보(`kitUses`).
- **예외는 금지 줄 안에.** "허락" 줄을 만들면 등록 순서에 따라 결과가 갈린다.
- **기다리는 교본에는 상한이 있다.** 판단 지점에서 막힌 대원은 임무를 쥔 채 서 있다. 상한이 없으면 교착이 된다 — 상한이 지나면 지금 동작이나 임무를 놓는 갈래로(4.4).
- **문턱에는 간격을.** 공기 0.30/0.50, 중상 70/75, 지구력 30/22/40. 들어가는 문턱과 나오는 문턱이 같으면 왕복한다("쉬는 대원의 왕복"과 같은 함정).
- **교본 후보는 한 판단에 하나.** 판단 오차가 후보마다 `a.rng` 를 부르므로 후보 수가 결과를 바꾼다.
- **재장전 중에는 난수를 부르기 전에 돌아간다.** `shootAt` 의 명중 판정(`s.rng`) 뒤에서 막으면 쏘지 않았는데 흐름이 진행한다.
- **짝은 작업판의 담당자가 아니다.** `WorkItem.max` 를 늘리지 않는다. 짝은 `pair` 임무로 따라간다.
