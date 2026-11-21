# I1 — 인과관계와 시스템 통합

공통 규칙은 `docs/specs/README.md`. 본보기: `N4b-crime.md`(연쇄 사건·`gen.chain`), `T1-traffic.md`(정보 격리를 도로에 적용한 방식, `known`).

사용자가 보내 준 검토 의견의 요지: **"사건의 수를 늘리는 것보다, 사건 하나에서 발생할 수 있는 상황의 수를 늘리는 것."** 새 사건 유형을 더하지 말고, 이미 있는 시스템(도로·부대·건물·병원·관제·현장) 사이에 실제 인과관계를 만든다. 지금의 `causes` 는 원인을 적기만 하고, `gen.chain` 은 예약된 시각에 후속 사건을 만들기만 한다. 이 둘을 세계 상태의 변화와 잇는다. 성공률을 무조건 높이는 쪽으로 맞추지 않는다. 실패도 결과다.

이 문서는 두 부분이다.

| 부분 | 누가 | 결과가 바뀌는가 | 내용 |
|---|---|---|---|
| **I1-a 측정 도구** | **구현됨**(이 세션 — 브랜치 `wf/i1a`, 합침 `48dba83`. 고정한 기준 커밋에서 만들었다, §2.15) | **바뀌지 않는다** — `src/` 를 한 줄도 고치지 않는다 | 지표 여덟 가지와 기록·상태 일치 검사, `sweep` 의 새 줄과 `--json` 키, 관문 조건, `tests/causality.test.ts` |
| **I1-b 인과 규칙과 세계 상태 결합** | **구현 중**(2026-11-20 — b0·b1·b2·b3-1·b3-2·b3-3 이 `wf/causality` 에 있다. R1 → H1 → X6 → R2 → R3 다음, §3.10 의 표시한 부분은 X6 와 함께) | 바뀐다(b0·b2·b3-4 는 해시 불변) | 세계 상태 자료, 상태 결합 규칙의 틀(`registerConsequence` — C6·C3·C2 와 구역 상태), **초과 위험 과정(`registerHazard` — 상태가 평소의 발생률과 물리 모델을 바꾸는 일반 법칙 일곱, §3.6a·§3.7)**, 교통 모델의 우회 몰림(§3.6b), 조건으로 일어나는 연쇄, 무한 연쇄 막기, 보고서의 내력 문장 |

## 구현 상태 (이 세션에서 구현·합침 — I1-a, §2)

**I1-a 는 구현됐다**: `scripts/metrics.ts`(지표 여덟 가지·일치 검사·틱 표본), `scripts/sweep.ts` 의 지표 줄·`--json` 의 `problems`·`reportHash`·`metrics`·`--metrics`·`--no-metrics`·지표 관문, `tests/causality.test.ts`(브랜치 `wf/i1a`, `15c9ec3`·`eb28fbe`·`23365a0`·`e14704e`, 합침 `48dba83`). 결과 해시는 바뀌지 않았다. 관문은 `npm run check` 에 들어가 있다(교착 후보 0·잊힌 사건 0 — `STALL_ALLOW`·`FORGOT_ALLOW` 0). 기준선은 `docs/ROADMAP.md` "지금 상태". **구현이 설계서와 다르게 한 곳**(코드가 정본 — 본문도 맞춰 고쳤다):

1. **§6 테스트 2 의 왕복 예** — 설계의 예(hazard → field → hazard → field → hazard)는 field 가 기본 세 시스템이라 field 로 들어가는 간선의 무게가 0 이어서 raw 가 2 다(3·4 가 아니다). 구현 시험은 기본 밖의 두 시스템 **hazard ↔ road** 로 raw 4 · distinct 2 를 확인한다(§2.5·§6-2 를 고쳤다).
2. **`replan.byCode` 의 `'ASSESS'`** — 문제 코드가 아니라 평가 변경 갈래(첫 도착 뒤 평가가 바뀜)의 열쇠다(§2.6).
3. **`S(I)` 의 `carry`** — I2 가 요청한 ②(그 현장에 `s.wear` 가 있다 · 그 사건에 배정된 부대에 `status 'off'` 대원이 있었다)가 구현에 들어 있다(§2.3 표).

교대 사이에 남는 상태(대원·장비·건물·도로를 "이어받은 상태"로 다음 교대의 입력에 넣기)는 `I2-persistence.md` 의 몫이다. I1-b 는 I2 가 그대로 저장할 수 있는 모양(함수가 없는 순수 자료)으로 세계 상태를 만든다(§3.3).

줄 번호는 2026-11-14 `a746b77`(B1 1차·B3·P1·Q1 을 합친 뒤) 기준이다. 앞 묶음(R1·H1·X6 …)이 합쳐지면 바뀌므로 **함수 이름으로 찾는다**. 확신하지 못한 곳은 **(확인 필요)** 로 표시했다. 측정 숫자 가운데 "설계 시험"이라고 적은 것은 이 문서를 쓰며 저장소 밖의 임시 스크립트로 `a746b77` 의 시드 S0~S2(보통, 멈춤은 S0~S7)만 잰 작은 표본이다.

**I1-a 자기 파일**(새로): `scripts/metrics.ts`, `tests/causality.test.ts`. **고치는 파일**: `scripts/sweep.ts`. **건드리지 않는다**: `src/` 전부. 브랜치 `wf/i1a`(같은 세션의 B1·G5 가 `src/` 를 고치므로 결과 불변 증명을 기준 커밋에 묶는다 — §2.15).
**I1-b**: 브랜치 `wf/causality`, 개발 서버 포트 **5218**(보고서 화면 확인용). 자기 파일과 공용 파일 수정은 §7.

## 방향 전환 (2026-11-20) — 스크립트가 아니라 자연스럽게 생기는 인과

사용자의 말(2026-11-20, 그대로): **"인과가 자연스럽게 스크립트대로 말고 생기게 못하나. 나무가 무너져서 트래픽이 몰려서 자연스럽게 사고 확률이 는다던지 건물이 붕괴되어서 더 큰 사고로 이어진다던지 화재가 붕괴를 유발한다던지 그런거"**

이 말에 맞춰 §3 의 규칙을 다시 썼다(같은 날 — b0·b1·b2·b3-1 이 구현된 뒤, b3-2·b3-3 이 구현되는 동안). 바뀐 것:

- **규칙이 "원인 X 면 확률 p 로 사건 Y 를 만든다"고 쓰지 않는다.** 예전 §3.7 의 C1(폭발 불씨 — 후보마다 확률 0.3 × (1 − d/R)) · C9(재발화 — 확률 추첨) · C5-1(호흡 곤란 — 60초에 한 번 확률) · C4-2·C4-3(승강기 0.6 · 교차로 사고 0.4) · C7(60초에 한 번 0.3) · C12(빗길 다중 추돌 0.08 × …)가 그 꼴이었다. 모두 없앴다.
- 대신 **원인은 세계 상태를 물리적으로 바꾸고**(혼잡·통제·잔해·정전·연기·열 노출·구조 손상·수위·수압·응급실 체류), **결과는 그 상태가 원인을 모르는 일반 법칙을 지나 평소의 발생률과 물리 모델을 바꿔 생긴다.** 같은 법칙이 어떤 원인에서 온 상태에도 똑같이 걸린다 — 쓰러진 나무든 사고 통제든 공사든 행사 인파든 "그 길에 차가 몰렸다"면 같다.
- 사건을 낳는 장치는 하나다: **초과 위험 과정**(§3.6a). 상태가 평소 수준보다 올린 만큼의 위험률을 대상(구간·건물)마다 적분하고, 대상마다 한 번 뽑아 둔 문턱을 넘으면 사건이 난다. 틱마다 주사위를 굴리지 않고, 평소 생성기의 난수 흐름을 건드리지 않는다.
- 교통 모델에는 일반 규칙 하나를 더한다(§3.6b): **막힌 길의 차는 우회로로 몰린다.** 쓰러진 나무에만 손으로 넣어 둔 `+0.7` 한 줄을 이것이 대신한다.
- 건물은 사건이 없어도 이웃의 불·폭발·붕괴에서 **노출과 손상**을 받는다(§3.6c `world.expo`). 그 건물에서 나는 다음 사건은 그만큼 크게 시작하고, 손상 자체가 그 건물의 위험률을 올린다.
- **화재 → 붕괴는 X6 가 이미 그렇게 한다**(불이 구획의 건전도를 깎고, 건전도가 붕괴의 위험률을 정한다 — §3.12 ③). 바꾸지 않는다.
- **바뀌지 않는 것**: C6(전환·부족 기록)·C3(응급실 포화)·C2(잔해) 세 절(이미 상태 결합이고 구현 중이다 — 글자를 고치지 않았다), 이야기 연쇄(재범·도주 차량·은신처·연쇄 방화 — 사용자 결정으로 그대로), 연쇄 상한(한 사슬 3건 · 한 교대 6건 — `chain.canChain`), b0~b2 의 틀(`signal`·`registerConsequence`·`tickWorld`·`spawnConsequence`·`gen.chain` 의 `when`/`until`·`gen.dropped`), I2·N8·N9 가 기대하는 이름(§3.7 끝 "뒤 묶음이 기대하는 이름").
- 예전 규칙 번호(C1~C12)와 새 법칙(L1~L8)의 대응은 §3.7 의 표, 무엇이 왜 바뀌었는지는 §10 끝 "방향 전환 메모".
- **같은 날 밤 독립 검토 세 갈래(결정성·되먹임·비용 / 자연스러움·정보 격리·정직한 기록 / 실현성·균형·단계)를 반영해 가장자리를 고쳤다** — 틀의 뼈대는 그대로다. 무엇을 받아들이고 무엇을 버렸는지는 §10 끝 "검토 반영 메모", 남은 구현의 덩어리 계획은 §5.

## 원칙

- **(2026-11-20) 인과는 자연스럽게 생긴다 — 스크립트로 쓰지 않는다.** 아래의 "조건 X 를 넘으면 Y 가 일어난다"는 "원인이 상태를 바꾸고, 상태가 일반 법칙을 지나 평소의 발생률과 물리 모델을 바꾼다"로 읽는다(§3.1 의 원칙 넷, 머리의 "방향 전환"). 규칙마다의 확률 판정(`csq:<규칙>:<열쇠>:<시도 번호>` 흐름으로 되풀이하는 주사위)은 사건을 낳는 데 쓰지 않는다 — 사건을 낳는 길은 초과 위험 과정(§3.6a)과 사용자 결정으로 남긴 이야기 연쇄뿐이다.
- **사건 감독(director)을 두지 않는다.** "극적인 순간을 골라 사건을 넣는" 장치는 CLAUDE.md 의 "가짜 연출 금지"와 부딪힌다. 대신 **인과 규칙**의 묶음이다: "세계 상태가 조건 X 를 넘으면 Y 가 일어난다". 규칙은 상태를 바꾸는 그 자리에서 `emit()` 하고, 원인 이벤트를 `causes` 로 잇는다. 보고서는 그 사슬을 읽는다.
- **고정된 순서로 연출하지 않는다.** 같은 규칙이라도 조건(거리·확률·자원·시간)에 따라 일어나기도 하고 일어나지 않기도 한다. 예약해 둔 후속 사건도 때가 되었을 때 조건이 맞지 않으면 버리고, 버린 것을 기록한다.
- **재현성.** 규칙마다 새 난수 흐름 `sim.rng.fork('csq:<규칙>:<열쇠>:<시도 번호>')`(시도 번호는 그 규칙·열쇠로 `test` 를 부른 횟수 — 같은 이름의 `fork` 는 같은 수열이라, 번호가 없으면 되풀이하는 확률 판정이 매번 같은 첫 난수를 쓴다. §3.4). 기존 흐름에 호출을 끼워 넣지 않는다. 주기 판단은 `sim.t`·`sim.tick` 으로만 한다.
- **정보 격리.** 세계 상태에는 진실과 "알려진 것(`known`)"이 따로 있다. 관제와 지휘관은 알려진 것만 읽는다(§3.8). T1 의 `RoadEdge.known` 과 같은 방식이다.
- **도시 지도를 고치지 않는다.** `city.places`·`nodes` 는 모듈에 한 번 만들어 교대마다 다시 쓴다(`city.ts:208-212`). 새로 생기는 상태(구역의 기반 시설·연기·위험, 병원 수용)는 `sim.world` 라는 별도 자료에, 건물 상태는 X6 의 `Sim.placeMarks` 에 둔다.
- **모든 사건은 끝난다.** 규칙이 만드는 사건도 `LIMIT`·`holdUntil`·`hardCap` 을 그대로 따른다. 연쇄에는 깊이·쿨다운·교대당 상한이 있다(§3.6).
- **측정이 먼저다.** I1-a 로 기준선을 잡은 뒤, I1-b 의 규칙을 하나 넣을 때마다 같은 지표로 전후를 잰다.

## 연관 설계서와 나누는 선

| 설계서 | 겹치는 곳 | 나누는 선 |
|---|---|---|
| R1 부대 편성·개인 장비·헬기 | 부대 수·결원(운용 중단은 부대에 내릴 대원이 남지 않았을 때뿐 — H1 §3.6 의 사용자 최종 결정 2026-11-15. R1 의 `minField` 는 I2 의 예비 인력 문턱)·헬기 이송, 장비 고장(`EQUIP_FAIL`), 이송 출발 문구 | R1 이 부대와 장비를 만든다. I1-a 는 `EQUIP_FAIL` 을 "장비"로, 결원 운용 중단 기록(문구 규칙 T6, `kind 'unit'`·사건 없음)을 "대원 상태"로 센다. I1-b 의 병원 규칙(C3)은 R1 의 `seatsOf`·의료 헬기 이송도 같은 "인계" 신호로 받는다. **이송 출발 문구의 "시립병원" 고정은 R1 단계 3 이 고친다**(`R1-crews.md` 단계 3 — `startTransport` 가 고른 병원을 돌려받아 5)번 블록의 출발 기록이 쓴다). 그래서 일치 검사 C5 는 R1 뒤 0 이어야 하고, I1-b 는 그 줄을 고치지 않는다(R1 이 하지 않았을 때만 b1 에서 고친다, §3.11) |
| H1 부상과 사망 | 대원 부상·순직, `RESPONDER_KILLED`·`SUSPECT_DIED`, `ShiftReport.roster` | H1 의 `hurt*` 가 남기는 `RESPONDER_HURT` 기록에 피해를 준 사건 기록을 `causes` 로 넣어 달라고 요청한다(없으면 I1-b 0단계에서 넣는다). I1-a 의 대응표는 `RESPONDER_KILLED` 를 "대원 상태"로, `SUSPECT_DIED`(H1 5단계)를 "현장 위험"으로 미리 넣어 둔다(문자열 집합이라 H1 전에도 컴파일되고, H1 이 합쳐져도 테스트 3 이 깨지지 않는다) |
| X6 위험의 현실화(붕괴·폭발·전소) | 실제 폭발·붕괴·전소, 건물 상태, 붕괴 뒤 도로 통제 | X6 은 현장 **안**의 사건(조짐 → 철수 판단 → `collapseRegion`·`collapseBuilding`·`explodeGas`·`ruptureVessel`·전소 판정)과 그 자리의 결과(문제 `STRUCT_COLLAPSE`·`EXPLOSION`·`BURNOUT`, 원인 `cat.causeEv`, 전체 붕괴 때 사건 교차로의 한 구간 통제, 교대 안의 건물 상태 `Sim.placeMarks`, `burnt`·`collapsed` 건물에서 새 사건을 내지 않음). I1-b 는 현장 **밖**으로 퍼지는 결과(옆 건물 화재, 사건이 끝난 뒤에도 남는 잔해, 기반 시설). X6 의 그 함수들에 신호 한 줄(`signal(sim, 'catastrophe', …)`)을 두면 I1-b 가 소비한다(§3.10 — X6 은 `world/consequence.ts` 가 없으면 빈 `signal` 과 `SignalKind` 만 담은 파일을 만든다고 적었다). **건물 상태는 X6 의 `Sim.placeMarks` 를 그대로 쓴다** — `sim.world` 로 옮기지 않는다(G4·I2 가 그 이름을 읽는다. X6 연관 표의 I1-b 줄도 같은 결정으로 고쳐졌다) |
| R2 대응 방식 다양화 | `METHOD_FAIL`, `Incident.methods`, `sweep --methods` | I1-a 의 "대체 방법 성공률"은 R2 전에는 작업 항목으로 근사하고, `I.methods` 가 생기면 그것으로 센다(§2.7). `--methods` 옵션과 `methods` JSON 키는 R2 의 것이고, I1-a 는 `metrics` 키 하나 안에만 쓴다 |
| R3 대응 교본 | 대원의 행동 선택 | I1-a 의 "행동 다양성"이 R3 의 효과를 잰다. 겹치는 코드는 없다 |
| G4 현장 가독성 · G5 교전 연출 | 기록 전용 칸(`RUIN_LOG`·`s.falls`, `FXLOG`·`s.fx` 기록) | 두 묶음은 "켜고 꺼도 결과가 같다"를 테스트로 지킨다. 그래서 **I1-b 의 규칙은 그 기록 전용 칸을 읽지 않는다**(읽으면 끄는 순간 결과가 바뀐다). 붕괴·폭발은 `hazards.ts` 의 상태 변화 자리에서 직접 신호를 받는다 |
| U2 통화창 | 없음 | I1-a 의 `sweep` 출력은 결정적이라 U2 의 결과 불변 비교에 그대로 쓸 수 있다 |
| K1 · I2 교대 간 지속 | 대원 상태·장비·건물·도로 | I2 는 `new Sim(seed, d, len, { carry })` 로 지난 교대의 상태를 받고, 건물은 `sim.carryState.places`(겹침 표)·도로는 `closedReason 'repair'` 로 둔다. 이어받은 상태의 요약 기록(`carryState.event`, `kind 'shift'`)을 원인으로 잇는다. I1-b 는 교대 **안**의 구역·병원 상태(`sim.world`)와 초기화 함수(`initWorld(sim, carry?)`)의 자리만 만든다 — 병원·기반 시설의 교대 간 지속은 I2 의 범위 밖이다(I2 연관 표의 I1 줄: `initWorld` 에 `carry` 를 넘기지 않는다). 나중에 넘길 수 있는 모양(순수 자료)으로만 둔다. I1-a 는 그 요약 기록(문구 규칙 T5)과 I2 의 나머지 기록(`tag: 'carry'` — I2 가 `WorldTag` 에 한 값을 더한다)을 시스템 `carry` 로 센다(§2.3). "쓸 수 있는 건물" 판정은 I2 의 `persist.placeUsable` 하나이고 I1-b 의 `placeState().usable` 은 그것을 부른다(I2 전에는 X6 의 표만 본다) |
| B3 (합쳐짐) | 전환 배정, 관제 순위, 교착 | B3 이 전환 배정을 같은 사건에서 120초 안에 두 번 하지 않게 하고(`dispatcher.ts:69`), 관제 순위에 "굶은 시간"(최대 +1.5, `priorityOf`)을, 지휘관에 확인 무전(`rollCall`)과 맡을 사람 없는 작업의 지원 요청(`needFor`)을 넣었다. I1-a 의 기준선은 이것들이 들어간 뒤에 잰다 |

---

## 1. 지금 상태

### 1.1 인과 기록 — 있지만 읽는 곳이 없다

| 무엇 | 지금 | 근거 |
|---|---|---|
| `SimEvent.causes` | `emit()` 이 음수·중복을 걸러 넣는다. 기록 해시(`logHash`)는 **틱과 문구만으로** 누적한다. 그래서 `causes` 만 바꾸면 해시가 그대로다(§3.11 의 0단계가 여기에 기댄다) | `events.ts:13-32` |
| 읽는 곳 | `events.ts:16`(정리)과 `tests/sim.test.ts:117`("원인은 언제나 과거 이벤트")뿐. `debrief.ts`·`view`·`ui`·`sweep` 은 읽지 않는다 | grep `\.causes` |
| 문제 기록 | `raiseProblem` 은 기록 하나와 `Problem{code,t,eventId,detail,recovered,recoveryText}`. 호출 39곳 대부분 `dedupe=false` | `events.ts:35-41` |
| 복구 | `markRecovered` 는 6곳만 쓴다(NO_UNIT `dispatcher.ts:115`, COMM_FAIL `agents.ts:255`, PATH_BLOCKED ×2 `executor.ts:104·223`, WATER_OUT `:448`, EQUIP_FAIL `:941`). 기록은 남기지 않는다. `lastProblemEvent` 는 죽은 코드 | `events.ts:44-55` |
| 사후 문제 | `evaluate` 가 닫을 때 CALL_MISINFO·MISJUDGE_TYPE·UNDER/OVERESTIMATE·UNDER_DISPATCH·TIMEOUT·FALSE_ALARM 을 더한다. `eventId` 는 신고·평가·요청 기록을 가리킨다(문제 기록이 아니다) | `debrief.ts:58-69` |
| `LATE_DISCOVERY` | `raiseProblem` 을 거치지 않고 직접 넣는다(`eventId` = 바로 앞 기록) | `field/agents.ts:88-89` |
| `Incident.rootEvent` | 값을 넣을 뿐 읽는 곳이 없다 | `incidents.ts:150` |
| 지휘관의 작업 원인 | `want()` 의 `cause` 는 기본값 -1 이고 넘기는 곳이 없다. `WorkItem.cause` 는 언제나 -1, 지시 무전의 `causes`(`w.cause >= 0 ? [w.cause] : []`)도 빈 배열 | `commander.ts:20, 493` |
| 실패 상태 | `WorkItem.status 'failed'` 는 선언만 있다. 실패는 `fails++`·`holdUntil`(+8초, 불 +14초)·"… 중단 — 이유. 재지시 요청." 기록 | `executor.ts:31` `finishTask` |
| 보고서 | 문장은 `I.problems`·사상자 타임라인·`s.requests` 로만 만든다. `ShiftReport.incidents[]` 에 부모·연쇄 칸이 없다 | `debrief.ts:93-207` |

### 1.2 이어지는 사건 — 예약은 있지만 원인과 잇지 않는다

| 연쇄 | 조건 | 난수 | 원인 연결 | 근거 |
|---|---|---|---|---|
| 도주 차량 `armed/getaway` | 총 든 용의자 도주, 현장 난수 r<0.35 | `getaway:<사건>:<용의자>` | `parent` 만 | `hazards.ts:508-515` |
| 재범 `armed/robbery` | r<0.65, 45~100초 뒤, 장소는 평소 추첨 | **없음** — `sim.rngGen` 을 쓰고 `g.lastType` 을 고친다(새 흐름 규칙과 어긋나는 선례) | `parent` 만 | `hazards.ts:516` |
| 연쇄 방화 | 목격자 면담 뒤 검거 확률, 깊이 3에서 멈춤, 600 안 같은 종류 건물 | `arson:`·`arson-next:` | `parent` 만 | `scenarios/crime.ts:16-49` |
| 은신처 인질극 | 납치 차량을 아무도 못 보고 은신처 도착 | `hideout-call:` | `parent` 만 | `pursuit.ts:130-140` |
| 재난 사건 | 재난 큐 | `d.rng` | **`parent` 도 `causes` 도 없다**(`tag` 만) | `disaster.ts:142-157` |

- 연쇄 사건의 발생 기록(`rootEvent`)에는 `causes` 가 없다(`incidents.ts:150`). 그래서 **다른 사건을 가리키는 `causes` 가 0개**다(조사 때 `db8cba0` 의 S0~S2: 이벤트 4,022개 중 `causes` 있는 것 1,087개, 다른 사건을 가리키는 것 0개, `parent` 있는 사건 0건. `a746b77` 에서도 0개).
- 예약은 한 틱에 하나 꺼내고, 교대 끝 150초 전이 지났거나 열린 사건이 `maxConcurrent` 를 넘으면 **기록 없이 버린다**(`incidents.ts:171-174`). 재난 큐도 자리를 못 찾으면 조용히 건너뛴다(`disaster.ts:153-157`).
- `closeIncident` 는 `evaluate`(판정·문장)를 먼저 하고 `onClose` 를 뒤에 부른다(`incidents.ts:226-227`). 그래서 `onClose` 가 만든 연쇄는 그 사건의 문장에 들어가지 않는다.

### 1.3 시스템 사이의 결합 — 이미 있는 것

| 원인 → 결과 | 어떻게 | 기록되는가 | 근거 |
|---|---|---|---|
| 교통사고 → 도로 | 구간 `slow +1.4`, 통제가 끝나면 `closed='incident'`. 이웃 구간 밀림은 교통 모델이 퍼뜨린다 | 통제 기록은 있다. **다른 사건 출동에 준 지연은 기록되지 않는다**(`edgeTime` 이 `slow` 를 그대로 반영) | `incidents.ts:133-145`, `sceneManager.ts` 6) 블록, `traffic.ts` `tickTraffic`, `city.ts:494` `edgeTime` |
| 산사태·다중 추돌 → 도로 | `onCreate` 가 구간을 막는다 | 통제 기록만 | `scenarios/disaster.ts:21-31`, `scenarios/major.ts:57-68` |
| 재난 → 도로·교통 | `closeEdge`(우회로 있을 때만), 정전 `bump +0.4`(120초) | 정전은 `bump` 와 그림뿐. 현장·병원·무전에 영향 없음 | `disaster.ts:163-203` |
| 재난 → 현장 | 여진이 금 간 구조물을 무너뜨림, 해일이 대피 현장을 덮침 | 있다(ESCALATION) | `disaster.ts:509-522`, `field/rules/disaster.ts:56-106` |
| 현장 결과 → 재난 | 산불 현장을 끝낼 때마다 불머리 0.85배, 셋이면 진화 | `d.log` | `disaster.ts:528-554` |
| 부하 → 사건 생성 | 열린 사건·가용 부대에 따라 다음 사건을 미룬다. 재난 중 간격 ×1.6 | 기록 없음(의도) | `incidents.ts:193-202` |
| 사건 → 사건(자원) | 전환 배정: 원래 사건 J 에 `DIVERTED`(causes 없음, 받는 사건은 detail 문자열에만). 같은 사건에서 120초 안에 두 번은 하지 않는다(B3). 관제 순위에 굶은 시간(최대 +1.5) | **받는 사건 쪽 기록 없음, 지연량 계산 없음** | `dispatcher.ts:37-50, 65-72, 97` |
| 부족 → 지원 | 수요가 30초 막히면 인근 도시 지원(사건당 1, 교대당 `tune.aidUnits`) | 있다 | `dispatcher.ts:153` 근처 |
| 병원 | 가장 빨리 닿는 병원. 응급실 대기 = 같은 교차로의 `hospital` 상태 부대 수 × 9초 | 대기 기록에 `causes` 없음. 다른 사건의 구급차 때문이라는 것이 드러나지 않음 | `resources.ts:254-259, 307-309` |

### 1.4 없는 것

1. **병원 수용 여력**이 없다(`Facility` 에 칸이 없다, `types.ts:61`). 병원을 고를 때 ETA 만 본다.
2. **기반 시설**(전력·통신·수도)의 구역 상태가 없다. 정전은 도로 `bump` 뿐. 무전 실패는 현장 격자의 음영(`s.shadow`)뿐. 변전소·발전소·방송국 건물은 있지만(`cityPlan.ts:162-176`) 거기서 난 사건이 도시에 아무 영향을 주지 않는다.
3. **건물 손상이 이어지지 않는다.** 파손은 사건별 `Scene` 에만 있고, 같은 건물에서 다시 사건이 나면 평면이 `scene:<사건 id>` 흐름으로 새로 만들어진다.
4. **사건 사이 인과가 `causes` 로 이어지지 않는다**(§1.2). 도로 통제로 생긴 `ROUTE_BLOCKED`·`TRAFFIC_DELAY` 에 구간 id 도, 막은 주체도 남지 않는다(`resources.ts:213, 299, 420`).
5. **기록과 상태가 어긋나는 곳**: 이송 출발 문구가 언제나 "시립병원"이다(`sceneManager.ts:211`). 실제 목적지는 `startTransport` 가 고르므로 가온대학교병원일 수 있다(설계 시험: 출발 48회 중 14회 불일치). **R1 단계 3 이 고친다**(연관 표의 R1 줄).
6. **대원이 있는데 현장이 멈춘 상태**를 재는 칸이 없다. `Scene.idleSince` 는 현장에 대원이 한 명도 없을 때만 시각을 잡는다(`sceneManager.ts` 7) 블록, `:224-246`). B3 의 `Scene.allIdleSince`(`commander.ts:625-627`)는 "모든 대원이 손을 놓은 시각"이지만 측정에 쓰지 않는다 — AI 내부 칸이라 지휘관이 계획할 때만 갱신되고, 지휘관 자신이 멈추면 함께 멈춘다(측정은 AI 의 판단과 따로 서야 한다).
7. 날씨는 교대 내내 바뀌지 않고, 사건 생성·교통 모델은 날씨를 읽지 않는다.
8. **측정할 수단이 없다.** `sweep` 은 `runToEnd()` 뒤 결과만 읽는다(틱 표본 없음). `--json` 에 문제 코드 분포가 없고, `recoveredShare` 는 재계획으로 쓰기 어렵다(허위 신고의 `FALSE_ALARM`, 요청이 다 채워진 `UNDER_DISPATCH` 가 "복구"로 들어가고, 실제로 계획을 바꾼 `SCENE_MISMATCH`·`VICTIM_MISSED`·`RECOUNT` 는 빠진다).

### 1.5 설계 시험에서 본 것 (`a746b77`, S0~S2 보통, 사건 42건 — 작은 표본)

- `causes` 사슬의 사건별 최대 길이: 3이 5건, 4가 25건, 5가 10건, 8·10이 각 1건. 사슬은 대부분 신고 접수 단계 안이다(조사 때 역할 간선 상위: CALL_TAKER→CALL_TAKER 369, CALL_TAKER→CALLER 303).
- 기본 세 시스템(접수·관제·현장) 밖으로 건드린 시스템 수: 0개 3건, 1개 20건, 2개 9건, 3개 6건, 4개 3건, 6개 1건. 병원 30건, 현장 위험 13, 건물 손상 10, 도로 10, 인근 지원 6, 장비 3, 대원 상태 2. **다른 사건 0, 기반 시설 0.**
- §2.5 의 "확산 단계"(사건 하나에서 다른 시스템·다른 사건으로 넘어간 횟수): 0단계 36건, 1단계 6건(여섯 모두 인근 도시 지원 요청으로 넘어간 것). **3단계 이상 0건.** S0~S7(118건)에서도 최대 1단계.
- 자원 경쟁(NO_UNIT·DIVERTED·BACKUP_LATE·CALL_QUEUE 중 하나라도) 12건(29%). S0~S7 에서 DIVERTED 가 있는 사건 4건. 지진 S0~S1(조사 때)은 43건 중 34건, DIVERTED 6건.
- 실패한 작업 항목 11개 → 같은 작업으로 다시 해서 모두 성공, **다른 작업으로 이룬 것 0**.
- §2.10 의 엄격한 멈춤(진전 없이 60초 넘게): **S0~S7 보통·지진 S0~S1 에서 0건.** 조사 때(`db8cba0`, B3 전)에는 **1건 — S1 #09 실종(등산객)** 이 있었다: 모든 구역 확인율 100% 뒤 대원 여섯이 약 115초 동안 대기만 하고, 지휘관은 45초마다 "관제, 현장 상황 보고: 대상 수색 중." 만 남기다 한계 시간으로 끝났다. B3(확인 무전·정밀 재수색 간격)이 이것을 없앴다. 감지기가 실제 교착을 잡는다는 증거다.
- 같은 사건 안에서 같은 사람이 같은 말을 6번: S1 #01 "적재장 통로가 잔해로 막혀 있음".
- 틱마다 상태를 읽으며 돌려도 `report.hash` 가 같다(조사 때 S1 `d85a21c7`).

---

## 2. I1-a 측정 도구 (구현됨 — `wf/i1a`, `48dba83`)

### 2.1 범위

- **`src/` 를 고치지 않는다.** 시뮬레이션은 지금 있는 칸만 읽는다. 기록 칸을 더하는 일(사건 사이 `causes`, `Problem.ref`, 버린 예약의 기록)은 I1-b 0단계다(§3.11). 이렇게 하면 결과 불변이 `git diff --stat <기준>..wf/i1a -- src` 한 줄로 증명되고, 이번 세션의 다른 작업(B1·U2·G5)과 파일이 겹치지 않는다. 같은 세션에 B1(결과를 바꾼다)·G5(`src/sim/field/fxlog.ts` 와 갈고리)가 주 작업 폴더에 합쳐질 수 있으므로 **I1-a 는 고정한 기준 커밋에서 만든 자기 브랜치 `wf/i1a` 에서** 만들고 증명한다(§2.15).
- 새 파일 `scripts/metrics.ts` 는 실행되지 않는 순수 모듈이다(`sweep.ts` 는 import 하면 실행되므로 따로 둔다). `tests/causality.test.ts` 가 이 파일을 import 한다(`tsconfig.json` 의 `include` 에 `scripts` 가 있다).
- 시간·난수를 쓰지 않는다. 같은 시드면 지표도 같다(`msPerShift` 만 예외).

### 2.2 표본과 계산의 틀 (`scripts/metrics.ts`)

```ts
export const SAMPLE_EVERY = 5;          // 틱 (= 1초). 표본은 step() 뒤에만 뜬다
export const STALL_SEC = 60, FORGOT_SEC = 30, REPEAT_WARN = 6, MIN_SCEN_N = 5;
export const CHAIN_DEPTH_GATE = 4, CHAINED_SHIFT_GATE = 8;
export const STALL_ALLOW = 0;            // 구현 때 40시드 기준선으로 확인한다. 0 이 아니면 그 수로 두고 래칫 (§2.14)
export const FORGOT_ALLOW = 0;           // 같은 방식의 래칫 (잊힌 사건)
export const REPEAT_MAX = Infinity;      // I1-a 기준선을 잰 뒤 정한다 (그 전에는 보고만 — I1-b 완료 조건 5 가 쓴다)

export const SYSTEMS = ['call', 'dispatch', 'field', 'road', 'hospital', 'hazard', 'building', 'crew', 'equip', 'infra', 'other', 'aid', 'disaster', 'carry'] as const;
export type SystemId = typeof SYSTEMS[number];
export const BASE: ReadonlySet<SystemId>;               // call · dispatch · field

export function sysOf(e: SimEvent): SystemId | 'origin' | 'none';      // §2.3
export class Probe {                                     // 틱 표본 (읽기만)
  constructor(sim: Sim);
  sample(): void;                                        // SAMPLE_EVERY 틱마다
}
export function runWithProbe(sim: Sim, maxTicks = 20000): Probe;     // runToEnd 와 같은 상한
export function shiftMetrics(sim: Sim, probe: Probe | null): ShiftMetrics;   // 교대 하나. probe 가 없으면 표본 항목은 null
export function summarize(list: ShiftMetrics[]): MetricsSummary;            // --json 의 metrics
export function formatLines(m: MetricsSummary, verbose: boolean): string[]; // 글자 출력 줄
export function checkMetrics(m: MetricsSummary, opts: { baseline: boolean }): string[];   // 관문 실패 문구 (빈 배열이면 통과). baseline = 보통 기본 조건 (§2.14)
```

- `runWithProbe` 는 `while (!sim.ended && n++ < maxTicks) { sim.step(); if (sim.tick % SAMPLE_EVERY === 0) probe.sample(); }`. `runToEnd` 와 같은 순서로 `step()` 만 부른다.
- **측정 도구의 오류는 시뮬레이션을 막지 않는다.** `probe.sample()` 은 `runWithProbe` 안에서 try/catch 로 감싼다: 한 번 던지면 `probe.failed = true`, 오류 수를 `probe.errors` 에 더하고 그 뒤로는 표본을 뜨지 않는다(시뮬레이션은 끝까지 돈다 — `sweep.ts` 의 기존 try 가 그 시드를 통째로 실패로 치면 측정 도구의 버그가 기존 집계를 바꾸게 된다). `sweep.ts` 는 `shiftMetrics(sim, probe)` 도 try/catch 로 감싼다: 던지면 그 교대의 지표는 `null`(`summarize` 가 건너뛴다)이고 오류 수에 1. 표본이 실패한 교대는 표본 항목만 `null` 로 두고 사후 지표는 낸다. 오류 수는 **새 칸 `metrics.errors`** 에만 넣는다 — 기존 최상위 `errors`(시뮬레이션 예외·보고서 없음, `sweep.ts:58·61`)는 건드리지 않는다.
- `Probe` 는 `src/sim` 의 함수를 **하나도 부르지 않는다**(부르면 상태를 바꿀 수 있다 — 예: `commander.outstanding`. `findRoute`·`astar` 는 모듈 버퍼를 써서 재진입하면 안 된다 — CLAUDE.md "공유 버퍼"). 필드만 읽고, 비교할 값은 자기 배열에 복사해 둔다.
- 구간·부대·소품·현장·구조 대상·사건 객체에 `Object.keys`·`in` 을 쓰지 않는다(P1 이후 선택 칸이 `undefined` 로 미리 들어 있다 — CLAUDE.md "자주 도는 객체의 모양"). 칸을 이름으로 읽고 `?? 0` 으로 비교한다(`I.unmet` 의 합도 `Needs` 의 여덟 열쇠 `suppression`·`rescue`·`ems`·`law`·`tactical`·`search`·`traffic`·`eod` 를 metrics.ts 안의 고정 배열로 돌며 구한다).
- 교대 후 계산은 `sim.events`·`sim.incidents`·`sim.scenes`·`sim.units`·`sim.report` 를 읽는다. `sim.scenes` 는 교대 끝까지 남는다(지우는 코드가 없다).
- "허위·오인"(`truth.variant` 가 `false`·`prank`, 또는 `FALSE_ALARM` 문제가 있는 사건)은 비율의 분모에서 뺀다(`benign`). `sweep` 의 지금 정의와 맞추되 폭파 협박의 `FALSE_ALARM` 도 뺀다. 지표마다:
  - **허위·오인을 빼는 것**: `systems`(avg·extraAvg·share), `replan`, `alt`, `actions`, `variety`, `contention.share`·`byCode`, `stall.idleSecPerIncident`·`queueWaitSecPerIncident`.
  - **모두 넣는 것**: `chain`(부모 깊이·원인 깊이·`crossIncidentLinks`·`worldLinks`), `systems.spread`(허위 신고에서도 지원 요청 같은 확산은 실제로 일어난다), `stall.candidates`·`forgotten`·`unlocated`·`repeatMax`(교착은 허위 신고에서도 교착이다), `consistency`, 교대 단위 값(`aidPerShift`·`peakOpenAvg`·`peakBusyAvg`)·`divert`·`erWaits`·`erCross`.
- **여러 교대를 모으는 법**: 사건 단위 비율과 평균(`share`·`avg`·`…PerIncident`)은 모든 교대의 사건을 **한 묶음으로 합쳐** 낸다(교대별 비율의 평균이 아니다 — 사건이 적은 교대가 과하게 무거워지지 않게). 이름이 `PerShift`·`Avg`(교대 단위)로 끝나는 값은 교대별 값의 평균. 시나리오별 엔트로피·가짓수는 교대를 합친 시나리오 묶음에서 계산한다. 수(`n`·`candidates`·`ge3` 등)는 합.

### 2.3 시스템 목록과 대응표

| id | 이름 | 무엇이 그 시스템인가 |
|---|---|---|
| `call` | 접수 | 신고자·접수 AI, 신고 대기, 위치 오류 |
| `dispatch` | 관제 | 분석(유형·위험도·필요 자원)과 배정, 대기열 |
| `field` | 현장 | 지휘관·대원의 판단과 행동, 무전 |
| `road` | 도로·교통 | 통제·장애물·혼잡·우회·교통 지연 |
| `hospital` | 병원 | 응급실 인계·대기·(I1-b) 포화 |
| `hazard` | 현장 위험 | 세계 규칙이 만든 현장의 변화(번짐·2차 붕괴·도주) |
| `building` | 건물 | 건물 손상(깨진 창·부서진 가구·탄 자리·(X6) 구조물 붕괴·전소) |
| `crew` | 대원 상태 | 부상·쓰러짐·순직·탈진·결원 |
| `equip` | 장비 | 장비 고장·용수 소진·(R1) 개인 장비 |
| `infra` | 기반 시설 | (I1-b) 전력·통신·수도. 지금은 0 |
| `other` | 다른 사건 | 부모·자식 사건, 전환 배정, 다른 사건 이벤트를 가리키는 원인, 다른 사건의 구급차 때문에 생긴 응급실 대기, 다른 사건이 느리게 한 구간을 지난 출동 |
| `aid` | 인근 도시 지원 | 지원 요청과 지원 부대 |
| `disaster` | 재난 | 재난 알림, 재난이 일으킨 사건 |
| `carry` | 지난 교대 | (I2) 이어받은 상태의 요약 기록과 그것을 원인으로 한 결장·정비·출입 통제·복구 공사. 지금은 0 |

`origin`(사건 발생 기록, `kind 'incident'`)과 `none`(이어받은 상태 요약이 아닌 `kind 'shift'`)은 시스템으로 세지 않는다.

**`sysOf(e)` 규칙 — 위에서부터 첫 번째로 맞는 것.**

0. `e.tag` 가 있으면(I1-b 가 더하는 선택 칸, §3.3) `TAG_SYS[e.tag]`: `power`·`comms`·`water` → `infra`, `smoke`·`risk` → `hazard`, `hospital` → `hospital`, `carry` → `carry`(I2 가 `WorldTag` 에 더하는 값 — I2 의 `kind 'incident'` 손상 기록처럼 다른 규칙이면 `origin` 이 될 기록도 이 규칙이 먼저 잡는다). 표에 없는 태그는 이 규칙을 건너뛴다. I1-a 코드는 `(e as { tag?: string }).tag` 로 읽어 칸이 없을 때도 컴파일된다.
1. `e.problem` 이 있으면 문제 코드 표(문자열 키 — 아직 없는 코드도 미리 넣는다):

| 시스템 | 문제 코드 |
|---|---|
| `call` | CALL_QUEUE · CALL_MISINFO · CALL_VAGUE · WRONG_ADDRESS · FALSE_ALARM |
| `dispatch` | MISJUDGE_TYPE · UNDERESTIMATE · OVERESTIMATE · NO_UNIT · UNDER_DISPATCH · BACKUP_LATE |
| `other` | DIVERTED |
| `road` | ROUTE_BLOCKED · TRAFFIC_DELAY |
| `crew` | RESPONDER_HURT · FATIGUE · RESPONDER_KILLED(H1) |
| `equip` | EQUIP_FAIL · WATER_OUT |
| `hazard` | ESCALATION · HIDDEN_HAZARD · SECONDARY_COLLISION · SUSPECT_FLED · EXPLOSION(X6) · SUSPECT_DIED(H1 5단계) |
| `building` | STRUCT_COLLAPSE(X6) · BURNOUT(X6) |
| `hospital` | HOSPITAL_FULL(I1-b) |
| `infra` | INFRA_FAIL(I1-b) |
| `field` | PATH_BLOCKED · VICTIM_MISSED · COMM_FAIL · SCENE_MISMATCH · LATE_DISCOVERY · RECOUNT · TIMEOUT · METHOD_FAIL(R2) · DANGER_SIGN(X6) · WITHDRAWAL(X6) · 표에 없는 코드 |

지금 있는 29개는 표에 빠짐없이 들어 있다(검토 때 확인). 다른 설계서가 더하는 코드도 모두 미리 넣었다: RESPONDER_KILLED·SUSPECT_DIED(H1), METHOD_FAIL(R2), DANGER_SIGN·WITHDRAWAL·STRUCT_COLLAPSE·EXPLOSION·BURNOUT(X6), HOSPITAL_FULL·INFRA_FAIL(I1-b). 새 설계서가 코드를 더하면 이 표에 한 줄 — 테스트 3 이 빠진 것을 알려 준다.

2. `kind` 로: `call` → call · `assess` → dispatch · `dispatch` → dispatch(단, 문구 규칙 T1 이면 aid) · `traffic` → road · `hazard` → 사건 없음(`incidentId < 0`)이면 disaster, 아니면 hazard · `casualty` → 문구 규칙 T4(병원 인계)에 맞으면 hospital, 아니면 field(지금은 `role 'UNIT'` 인 `casualty` 기록이 인계 한 곳뿐이지만 R1 이 호이스트 인양 같은 UNIT 기록을 더하므로 역할이 아니라 문구로 가린다) · `unit` → 문구 규칙 T2 이면 hospital, T6 이면 crew, 아니면 field · `incident` → origin · `shift` → 문구 규칙 T5 이면 carry, 아니면 none · 나머지(`arrive`·`command`·`radio`·`action`·`resolve`·`recovery`) → field.

**문구 규칙** — 칸이 없어 문구로만 가릴 수 있는 곳. 표로 모아 두고 테스트가 "아직 맞는 기록이 있다"를 본다(문구가 바뀌면 테스트가 깨진다):

| 규칙 | 정규식 | 기록하는 곳 |
|---|---|---|
| T1 지원 요청 | `/인근 도시에 지원 요청/` | `dispatcher.ts:153` |
| T2 응급실 대기 | `/응급실이 붐벼/` | `resources.ts:309` |
| T3 이송 출발(일치 검사 C5 용) | `/싣고 (.+?)(?:으로\|로) 출발/` | `sceneManager.ts` 5)번 블록의 출발 기록(R1 단계 3 뒤 병원 이름은 `startTransport` 가 돌려준 것. H1 의 '부상 대원 m명 싣고 …' 도 같은 꼴 — H1 §3.4-3) |
| T4 병원 인계(C5 용) | `/^(\S+): (.+?) 도착, 환자/` — **H1 4b 에서** `/^(\S+): (.+?) 도착, (?:환자\|부상 대원\|용의자)/` 로 넓힌다(H1 §3.4-4 — 부상 대원만 인계한 기록) | `resources.ts` `tickUnits` 의 병원 인계 기록 |
| T5 이어받은 상태(I2) | `/^지난 교대에서 이어받은 상태/` | I2 의 `announceCarry`(I2 §3.7). I2 전에는 맞는 기록이 없다 — 테스트는 I2 뒤에 켠다 |
| T6 결원 운용 중단 | `/대원 전원 부상으로 운용 중단/` — **H1 4b 에서** `/(?:대원 전원 순직 —\|남은 대원 모두 병원 이송 —\|걸을 수 있는 대원이 없어) 운용 중단/` 로 바꾼다(H1 §3.6 — 걸을 수 있는 대원이 남지 않은 까닭 셋. 다친 대원도 걸을 수 있으면 출동하므로 지금의 '대원 전원 부상으로' 문구는 H1 이 없앤다 — 사용자 결정 2026-11-15 "가벼운 일은 계속". I2 는 이 기록에 문구를 더하지 않고, 교대 시작의 '결원으로 이번 교대 운용 중단' 은 `tag 'carry'` 로 센다 — I2 §3.2) | `resources.ts` `arrive` 의 복귀 기록(`kind 'unit'`, 사건 없음). 맞는 기록은 대원이 다치는 교대에서만 나온다 — 테스트는 그런 시드를 찾아 고정하거나, 찾지 못하면 H1 뒤에 켠다 |
| T7 출동 지령(C4·전환 영향 용) | `/^출동 지령: (\S+) → 사건/` | `dispatcher.ts` `sendUnit` 의 기록. 잡은 묶음은 호출부호(공백 없음 — `UNIT_DEFS`·지원 부대 이름) |
| T8 이송 중 목적지 변경(C5 용, **I1-b b3-2 에서 더한다**) | `/^(\S+): .+? 포화 소식 — (.+?)(?:으로\|로) 목적지 변경/` | I1-b C3 결과 4 의 기록(§3.7) |

문구를 바꾸는 묶음은 이 표의 정규식(`scripts/metrics.ts` 의 `PHRASE`)을 함께 넓히고 `tests/causality.test.ts` 를 통과시킨다(CLAUDE.md "측정 도구의 문구 규칙"). 넓히지 않으면 `sysOf` 가 조용히 field 로 센다.

**사건별 시스템 집합 `S(I)`** = 그 사건 기록(`incidentId === I.id`)의 `sysOf` 합집합 ∪ **그 사건 기록이 `causes` 로 가리키는 사건 없는 기록**(`c.incidentId < 0` 이고 `sysOf(c) ∉ {origin, none}`)의 `sysOf` — 재난 알림(`disaster.tell`), 결원 운용 중단(T6), I2 의 요약(T5), I1-b 의 구역·병원 알림처럼 사건이 없는 기록이 여기서 들어온다(`worldLinks` 가 세는 간선과 같다) ∪ 상태로 본 것:

| 더하는 시스템 | 상태 조건 (교대 끝에 읽는다, 표본 항목은 `Probe`) |
|---|---|
| `road` | `I.blockedEdge >= 0` (사건이 도로망을 바꿨다) |
| `hospital` | 그 현장의 구조 대상 중 `tHospital >= 0` 이 있다 |
| `building` | `s.glass` 에 1 이 있거나, `s.decorHp` 에 255 가 있거나, `s.burnedTiles > 0`, 또는 (X6 뒤) `sim.placeMarks` 에 그 건물이 있다(`(sim as { placeMarks?: Map<number, unknown> }).placeMarks?.has(placeId)` — 칸이 없을 때도 컴파일) |
| `other` | `I.parent !== undefined` · 어떤 J 의 `parent === I.id` · I 에 DIVERTED 가 있다(빼앗긴 쪽) · I 가 전환 배정으로 부대를 받았다(§2.9 의 연결) · I 의 기록이 다른 사건 기록을 `causes` 로 가리킨다 · (표본) I 의 응급실 대기가 다른 사건의 구급차 때문 · (표본) I 로 가는 부대의 남은 경로에 다른 열린 사건 J 의 `blockedEdge`(그 구간 `slow > 0`)가 있다 |
| `aid` | `I.aidUnit !== undefined` |
| `disaster` | `I.tag` 가 `'disaster:'` 로 시작 |
| `carry` | (I2 뒤) 그 건물이 I2 의 `carryState.places` 에 있다(`(sim as { carryState?: … }).carryState` 로 읽어 칸이 없을 때도 컴파일되게. 모양은 I2 를 따른다) · 그 현장에 `s.wear` 가 있다 · 그 사건에 배정된 부대(`everAssigned`)에 `status 'off'` 대원이 있었다(I2 §7 ② — 구현됨) · (표본) I 로 가는 부대의 남은 경로에 `closedReason === 'repair'` 인 구간이 있다(지금 길이 막혀 있지는 않으니 실제로는 한 차로 공사의 `slow`) |

### 2.4 지표 1 — 인과 연쇄 깊이 (두 가지)

**(가) 부모 사슬 `chain`** — 사건이 사건을 낳은 깊이.

- `parentDepth(I)`: `I.parent` 가 없으면 0, 있으면 `1 + parentDepth(부모)`(50단계에서 끊는다 — 순환 방지).
- `rootedDepth(I)`: `parentDepth` 에 사슬의 뿌리가 재난 사건(`tag` 가 `disaster:`)이면 +1. 재난 사건 자체는 1. 대형 사고(`tag: 'major'`)는 저절로 일어난 것이라 0.
- 버린 예약 `dropped`(표본, **근사**): 표본마다 `sim.gen.chain` 의 항목을 객체 참조로 기억한다. 직전 표본에 있던 항목 가운데 사라진 것들을 `(parent, type, variant)` 다중집합으로 만들고, 그 사이에 새로 만들어진 사건(`sim.incidents` 의 늘어난 끝)도 같은 열쇠의 다중집합으로 만들어 짝짓는다. 열쇠마다 `max(0, 사라진 수 − 새로 생긴 수)` 의 합이 버린 수다(같은 틱에 둘이 사라지고 하나만 생겨도 하나를 센다).
- 재난 큐 `disasterSkipped`(표본, **근사**): `sim.disaster.queue` 는 틱마다 하나씩 꺼내고, 늦거나 상한에 닿으면 `d.queue.length = 0` 으로 한꺼번에 비운다(`disaster.ts:230`, 끝날 때 `:319`). 또 큐를 거치지 않고 바로 만드는 재난 사건(여진·산불의 `houseFire` 등)이 있다. 그래서 "사건이 하나도 안 생겼는데 사라짐"으로 세지 않고, 표본마다 `max(0, 사라진 항목 수 − 그 사이 d.spawned 가 늘어난 수)` 를 더한다. 큐를 통째로 비운 경우(사라진 수 ≥ 3 이고 길이가 0 이 됨)는 그 수를 `disasterSkipped` 에 넣지 않고 **`disasterCleared`** 에 따로 더한다(늦어서 남은 예고를 거둔 것 — 버림과 다른 일이다).
- 출력: 깊이 분포(0·1·2·3+), `maxParentDepth`, `chained`(부모 있는 사건 수)·`chainedPerShift`·`maxChainedInShift`, `rooted` 분포, `dropped`, `disasterSkipped`, `disasterCleared`. I1-b 0단계 5번(`gen.dropped`)이 들어오면 `dropped` 는 그 배열의 길이로 바꾸고 근사 값은 비교용으로만 남긴다.

**(나) 원인 사슬 `causes`** — 기록이 기록을 낳은 길이.

- 모든 기록에 `L(e) = 1 + max(L(c) for c in e.causes)`, 원인이 없으면 1. `causes` 는 언제나 과거를 가리키므로(`sim.test.ts:110`) id 오름차순 한 번으로 계산된다.
- 사건별 `causesDepth(I)` = 그 사건 기록의 `L` 최댓값.
- `crossIncidentLinks` = 원인 간선 `c → e` 중 두 기록의 `incidentId` 가 모두 0 이상이고 서로 다른 것의 수. `worldLinks` = `c` 가 사건 없는 기록(`incidentId < 0`, `sysOf` 가 `none` 인 것 제외 — 이어받은 상태 요약(T5)은 넣는다)이고 `e` 는 사건 기록인 것의 수. **지금은 둘 다 0**이고, I1-b 0단계 뒤에 처음으로 0 이 아니게 된다.
- 출력: 분포, 평균, 최댓값, `crossIncidentLinks`, `worldLinks`.

### 2.5 지표 2 — 시스템 간 영향

**(가) 건드린 시스템 수** — `S(I)`(§2.3)로. `systems.avg` = 사건당 `|S(I)|`, `systems.extraAvg` = 사건당 `|S(I) \ BASE|`, `systems.share[id]` = 그 시스템을 건드린 사건의 비율.

**(나) 확산 단계 `spread`** — 사용자의 완료 기준 "하나의 사건에서 서로 다른 시스템으로 최소 3단계 이상 실제 영향이 퍼지는 사례"를 숫자로 만든 것.

- 원인 그래프의 간선 `c → e` 에 무게를 준다: `w = 1` 이면 "다른 시스템이나 다른 사건으로 한 단계 넘어갔다".
  ```
  w(c→e) = 1  if  e.incidentId ≥ 0 && e.incidentId ≠ c.incidentId          // 다른 사건으로(또는 세계 → 사건)
           1  if  sysOf(e) ∉ BASE ∪ {origin, none} && sysOf(e) ≠ sysOf(c)    // 기본 세 시스템 밖의 새 시스템으로
           0  otherwise
  ```
  기본 세 시스템 사이의 이동(접수 → 관제 → 현장)은 모든 사건에 있으므로 세지 않는다.
- `F(e)` = `e` 에서 시작해 원인 간선을 따라 **앞으로**(자식 쪽으로) 가는 길 가운데 무게 합의 최댓값. 자식 목록을 만든 뒤 id 내림차순 한 번으로 계산한다. 가장 좋은 다음 기록(`next[e]`, 같은 값이면 id 가 작은 자식)을 기억해 길을 되짚는다.
- **같은 시스템의 왕복은 세지 않는다.** 위 무게만 쓰면 기본 밖의 두 시스템 사이를 오가기만 해도(hazard → road → hazard → road → hazard) raw 4 가 되고(field 는 기본 시스템이라 field 로 들어가는 간선은 무게 0 — hazard → field 왕복은 raw 2 다), 두 사건을 오가도(I → J → I → J) 3이 된다 — I1-b 의 C6 처럼 DIVERTED 가 받는 사건 기록을 가리키고 그 사건의 출동 지령이 다시 자기 사건 기록을 가리키면 실제로 생긴다. 그래서:
  - `spreadRaw(e)` = `F(e)`(위 무게 합, DP 그대로).
  - `spreadDistinct(e)` = `next[]` 로 되짚은 그 최선 길에서 **`w = 1` 간선이 가리키는 기록의 `(incidentId, sysOf)` 쌍 가운데 서로 다른 것의 수**. DP 는 raw 를 최대로 하는 길을 고르므로 distinct 가 더 큰 다른 길을 놓칠 수 있다 — 값을 부풀리지 않는 쪽의 근사다.
- `spread(I)` = `max spreadDistinct(e)` over `e.incidentId === I.id`(같으면 raw 가 큰 것), `spreadRaw(I)` = 그 기록의 raw. `spreadWorld` = 같은 계산을 사건 없는 기록(재난 알림 등)에서 시작해 — "세계에서 시작한 확산".
- 출력: `spread` 의 분포, 최댓값, `ge3`(**distinct** 가 3 이상인 사건 수), `rawMax`·`rawGe3`(비교용), **예시** 최대 3개(distinct 큰 것부터):
  `S7 #12 collapse/gasblast spread 3 (raw 3): #12:hazard → #12:road → #14:road → #14:dispatch ...` (길의 각 기록을 `#사건코드:시스템` 으로, `-v` 면 기록 문구 앞 40자도)

**왜 이렇게 정했나**: 역할(role)로 세면 지금의 사슬이 이미 2~4개 역할을 지나지만 대부분 신고 단계 안이라 아무것도 말해 주지 않는다. 모듈 단위 시스템 + "기본 세 시스템 밖으로, 또는 다른 사건으로 넘어갈 때만 센다"로 하면 지금 값이 0~1 이고, I1-b 가 만드는 사슬(폭발 → 도로 잔해 → 다른 사건의 우회 → 지원 지연)만 3 이상이 된다.

### 2.6 지표 3 — 재계획 비율 `replan`

"새 정보로 기존 계획을 바꾼 사건"의 비율(허위·오인 사건 제외). 신호는 아래 집합의 합집합이고, 문자열 집합이라 아직 없는 코드(R2·I1-b)도 미리 넣는다.

| 갈래 | 신호 | 왜 재계획인가 |
|---|---|---|
| `field` | PATH_BLOCKED·WATER_OUT·EQUIP_FAIL 중 **복구된 것**(`recovered`) | 우회·강제 개방·소화전 연결·예비 장비로 계획을 바꿨다 |
| `field` | COMM_FAIL · VICTIM_MISSED · RECOUNT · SCENE_MISMATCH · METHOD_FAIL(R2) · WITHDRAWAL(X6) (복구 여부와 무관) | 재배정·재수색·현장 평가 수정·방법 교체·전원 철수가 뒤따른다(`commander.ts:246·283·453·540`, `field/agents.ts:122·240`, X6 의 철수 명령) |
| `field` | DANGER_SIGN(X6) 중 **복구된 것** | 조짐을 알고 막았다(X6 — 막으면 복구). 복구되지 않은 조짐은 아직 계획을 바꾼 것이 아니다 |
| `dispatch` | MISJUDGE_TYPE 중 복구된 것(현장 보고로 유형 수정) | |
| `dispatch` | 첫 도착 뒤 평가가 바뀜: `I.firstAssess && I.assessment && (유형이 다름 \|\| \|위험도 차\| ≥ 1)` | `I.firstAssess` 는 첫 출동 때 만들어지지만 **첫 도착 전까지(현장 유형 확인 전까지) 계속 덮어쓴다**(`analyst.ts` `assess` 끝). 그래서 이 갈래는 "현장에 닿은 뒤 바뀐 평가"다. `Assessment.revision` 은 통화 중 재평가도 세므로 쓰지 않는다 |
| `dispatch` | HOSPITAL_FULL(I1-b — 이송 목적지 변경) | |
| `route` | ROUTE_BLOCKED | 막힌 길 앞에서 되돌아 다른 길로(T1) |

- **넣지 않는 것**: FALSE_ALARM(허위 신고 확인), UNDER_DISPATCH 복구(요청이 채워진 것), NO_UNIT 복구(대기열이 풀린 것), TRAFFIC_DELAY(계획은 그대로). 기존 `recoveredShare` 키는 **이름과 뜻을 그대로 둔다**(다른 설계서의 전후 비교가 그 키를 쓴다).
- 보조: `cancelledPerIncident` = 사건당 `status === 'cancelled'` 인 작업 항목 수(지휘관이 믿음이 바뀌어 지시를 거둔 것).
- `fromWorld` = 재계획 신호 기록 가운데 "다른 시스템의 변화가 AI 의 계획을 바꿨다"고 기록으로 이어진 것의 수. 지금은 거의 0 일 것이다(I1-b 완료 조건, §5). 정확히:
  - **신호 기록**: 문제 신호는 그 문제의 `eventId`(복구된 것도 원래 문제 기록). 평가 변경 갈래는 `I.firstArrivalAt` 이후 그 사건의 첫 `kind 'assess'` 기록이고, 그런 기록이 없으면(현장 보고로 `fieldType` 만 바뀐 경우 등) 그 사건은 `fromWorld` 에서 뺀다.
  - **거슬러 보는 범위**: 신호 기록 **자신은 빼고**, `causes` 를 너비 우선으로 거슬러 **서로 다른 조상 기록을 많아야 30개** 본다(가까운 조상부터, 같은 거리에서는 id 가 큰 것부터).
  - **센다**: 그 조상 가운데 `sysOf` 가 `road`·`hospital`·`infra`·`building`·`disaster`·`other`·`aid`·`carry` 이거나 `incidentId` 가 신호 기록과 다른(0 이상 또는 사건 없음) 것이 하나라도 있으면. ROUTE_BLOCKED 는 자기 자신이 `road` 지만 자신은 빼므로, 그것을 일으킨 다른 사건의 통제·장애물 기록이 원인으로 이어졌을 때만(I1-b 0단계 4번) 센다.
- 출력: `share`, `field`·`dispatch`·`route`(각 비율), `byCode`(사건 수 — 열쇠 `'ASSESS'` 는 문제 코드가 아니라 평가 변경 갈래다), `cancelledPerIncident`, `fromWorld`.

### 2.7 지표 4 — 대체 방법 성공률 `alt`

**R2 전(근사)**: "실패 뒤 다른 작업 종류로 같은 목적을 이룬 비율".

- 실패 표본 `F` 네 가지:
  1. 작업 항목 실패: `s.board` 에서 `w.fails > 0` 인 항목.
  2. PATH_BLOCKED 문제(진입로가 막힘).
  3. EQUIP_FAIL 문제.
  4. WATER_OUT 문제.
- 실패 하나의 결과를 셋 중 하나로 나눈다(합이 1):
  - **재시도 성공 `retryOk`**: 1번이고 `w.status === 'done'`(같은 종류로 다시 해서 끝냈다).
  - **대체 성공 `altOk`**: 1번이고 끝내지 못했지만, 같은 현장에 `w2.kind ≠ w.kind`, `PURPOSE[w2.kind] === PURPOSE[w.kind]`(둘 다 있음), 대상 열쇠(`cas/hostile/prop/region/tile/mate`)가 같고, `w2.status === 'done'`, `w2.doneAt >= w.createdAt` 인 항목이 있다. 또는 2·3·4번이고 `recovered`(우회·강제 개방 / 예비 장비 / 소화전 — 모두 막힌 수단 대신 다른 수단).
  - **포기 `gaveUp`**: 나머지.
- **같은 실패를 두 번 세지 않는다.** 진입로가 막혀 우회로가 없으면 대원은 PATH_BLOCKED 를 남기고 그 임무는 `nopath` 로 실패한다(`executor.ts` `moveTo` 의 장애물 결정 → `finishTask`). 그 실패는 작업 항목의 `fails` 로 1번 갈래에 이미 들어간다. 그래서 2번 갈래는 **복구된 PATH_BLOCKED 만** 실패 표본에 넣고(모두 `altOk`), 복구되지 않은 것은 표본에서 뺀다. `path` 의 `[n, 복구 수]` 는 전체 PATH_BLOCKED 로 따로 보고한다.
- `PURPOSE`(같은 목적의 다른 작업): `negotiate`·`engage`·`arrest` → `subdue`(제압·검거), `carry`·`escort` → `move`(구조 대상을 빼낸다). 나머지 작업은 대체 수단이 없다 — 작업 항목 갈래의 대체 성공(`items` 의 둘째 값)이 지금 0 인 것이 바로 "대응이 단조롭다"는 사용자 지적의 숫자다(진입로·장비·용수 갈래는 지금도 대체 수단이 있어 거의 다 복구된다).
- `altRate = altOk / F`, `retryRate = retryOk / F`, `gaveUpRate = gaveUp / F`. 갈래별 `[n, 대체 성공]` 도 낸다(`items`·`path`·`equip`·`water`).

**R2 뒤**: 사건에 `I.methods`(R2 의 `MethodUse[]`)가 있으면 `alt.methods` 를 따로 낸다. R2 의 대상 열쇠와 같은 `(work, cas, prop, hostile, region, tile)` 로 묶는다(R2 는 문·잔해 하위 작업을 `tile` 로 가린다 — `R2-methods.md` `MethodUse` 의 주석. `tile` 이 없으면 소품 없는 서로 다른 문이 한 묶음으로 섞인다). `ok: false` 가 하나라도 있는 묶음 가운데, 뒤에(`t` 가 더 늦은) **그 묶음의 `ok: false` 방법 집합에 없는 `method`** 의 `ok: true` 가 있으면 대체 성공. `alt.methods = { groups, altOk, rate }`. R2 가 합쳐지면 이 값이 주 지표가 되고 근사 값은 비교용으로 남긴다.

### 2.8 지표 5 — 행동 다양성 `actions`

- 사건마다 현장 작업판에서 `status === 'done'` 인 작업 항목을 종류별로 센다.
- 시나리오(`type/variant`)별로 모아 분포 `p_k` → 엔트로피 `H_s = −Σ p_k log2 p_k`(비트). `n_s ≥ MIN_SCEN_N`(5)인 시나리오만.
- `actions.entropy` = `Σ n_s H_s / Σ n_s`(사건 수 가중 평균), `actions.kinds` = 교대 전체에서 끝낸 작업 종류의 가짓수.
- `actions.orderVariety` = 시나리오별 "끝낸 작업 종류를 처음 끝낸 순서대로 늘어놓은 줄"(같은 시각은 항목 id 순)의 서로 다른 가짓수 ÷ `n_s` 의 가중 평균. 같은 시나리오라도 사건마다 일하는 순서가 달라지는가.
- `actions.lowest` = `H_s` 가 가장 낮은 시나리오 3개 `[이름, H, n]`.
- R2 뒤: `actions.methodEntropy` = 작업 종류별 `I.methods`(`ok: true`) 방법 분포의 엔트로피 가중 평균.

### 2.9 지표 6 — 자원 경쟁 발생률 `contention`

사건 단위와 교대 단위를 둘 다 낸다.

- **사건 단위** `share`: 허위·오인을 뺀 사건 가운데 NO_UNIT·DIVERTED·BACKUP_LATE·CALL_QUEUE 중 하나라도 있는 비율. `byCode` 는 코드별 비율.
- **교대 단위**: `aidPerShift`(`sim.aidUsed` 평균), `peakOpenAvg`(교대마다 `[createdAt, closedAt]` 구간이 가장 많이 겹친 수의 평균 — 사후 계산), `peakBusyAvg`(표본: 바쁜 부대 비율의 교대별 최댓값 평균. 비율 = `available`·`oos` 가 아닌 부대 수 ÷ 그 표본 시각의 `sim.units.length − oos 수` — 교대 중에 붙는 인근 도시 지원 부대는 들어온 표본부터 분모에 들고, 임무 뒤 `oos` 가 되면 빠진다).
- **전환 배정의 실제 영향** `divert` — **사후에 기록으로 찾고, 표본은 예정 도착 시각만 준다.** 표본으로 전환을 찾으면 시각이 표본 시각이 되고, 같은 배정 회차의 대체 출동을 놓친다(`tickDispatch` 는 같은 틱에 사건을 우선순위 순으로 차례로 처리하므로 J 의 대체 지령이 DIVERTED 와 같은 `sim.t` 에 나올 수 있다).
  - **전환 하나 = J.problems 의 DIVERTED 하나.** `t = p.t`, 문제 기록 id `pe = p.eventId`. 받는 사건 I 와 부대는 그 기록 **바로 뒤의 첫 `kind 'dispatch'`·`role 'DISPATCH'` 기록**(C4 가 이 짝을 보장한다)에서 읽는다: `incidentId` 가 I, 문구 규칙 T7 이 잡은 호출부호로 `sim.units` 에서 부대를 찾는다.
  - **예정 도착 `eta`**(표본): `Probe` 는 표본마다 부대별 `(incidentId, estArrive)` 를 복사해 두고, 직전 표본과 `incidentId` 가 달라진 부대마다 `{ unit, t, fromInc, fromEta }` 를 작은 배열에 남긴다. 사후에 `unit` 이 같고 `fromInc === J`, `t` 가 그 DIVERTED 의 `t` 이상인 첫 항목의 `fromEta` 를 쓴다(`estArrive` 는 절대 시각이다 — `resources.ts` `dispatchUnit`). 찾지 못하면(표본 없음·같은 1초 안에 J 에 배정됐다가 돌려짐) `eta` 없음.
  - `hurt` = 전환 시각에 J 에 도착한 부대가 없었다: `J.firstArrivalAt < 0 || J.firstArrivalAt > t`.
  - `lostSec` = `hurt` 이고 `eta` 가 있는 전환에서 `max(0, 도착 − eta)`, 도착 = `J.firstArrivalAt`(못 받았으면 `J.closedAt`, 그것도 없으면 교대 끝 `sim.t`). "부대 부족이 다른 사건에 실제로 준 지연"이다. `eta` 가 없는 전환은 `lostSec` 합에서 빼고 `noEta` 로 센다.
  - `refillSec` = J 의 `dispatchLog` 가운데 **id 가 `pe` 보다 큰 첫 기록**의 시각 − `t`(같은 시각의 대체 지령도 잡는다). 없으면 `refillMissing` 에 센다. `refillAvg` 는 찾은 것만의 평균.
  - 받는 사건 I 에 `other` 시스템을 더한다(§2.3).
- **병원을 통한 경쟁**(표본): 응급실 대기 기록(T2)마다, 그 시각 이후 첫 표본에서 같은 교차로에 `hospital` 상태인 다른 부대의 `patientsIncident` 를 본다. 다른 사건이면 `erCross` 에 센다(그 사건과 대기 사건 둘 다 `other`).
- 출력: `share`, `byCode`, `aidPerShift`, `peakOpenAvg`, `peakBusyAvg`, `divert{n, hurt, lostSec, noEta, refillAvg, refillMissing}`, `erWaits`, `erCross`.

### 2.10 지표 7 — 멈춘 시간 `stall`

교착 후보를 찾는 지표다. 세 가지를 따로 잰다. **관문에 거는 것은 (가)·(나)뿐이다.**

**(가) 엄격한 멈춤 `candidates`** — 대원이 있는데 아무 진전이 없다.

표본마다, 사건 I 가 다음을 **모두** 만족하면 "멈춤 시계"가 돈다(하나라도 아니면 시계를 지운다):

1. `I.phase === 'onscene'`, 추격전이면 `I.pursuit.state !== 'driving'`.
2. 현장에 `status === 'active'` 인 대원이 한 명 이상.
3. 그 사건에 배정된 부대 가운데 `enroute`·`turnout` 이 없다(지원을 기다리는 중이 아니다).
4. `Σ I.unmet === 0`(관제 대기열에서 부대를 기다리는 중이 아니다).

시계가 돌고 있을 때 직전 표본 이후 아래 **진전 신호**가 하나라도 있으면 시계를 지금 시각으로 되돌린다:

| 진전 신호 | 읽는 칸 |
|---|---|
| 그 사건의 진실이 아닌 기록 가운데 `importance ≥ 1` 인 것 | `sim.events` 새 항목. **중요도 0 은 세지 않는다** — 지휘관의 정기 상황 보고("관제, 현장 상황 보고: …")가 45초마다 나와 멈춤을 가린다(§1.5 의 조사 때 S1 #09). B3 의 확인 무전(`rollCall`)도 한 번뿐이라 진전으로 쳐도 된다. 지휘관의 지시 무전도 대부분 중요도 0 이지만(`commander.ts:493` — `w.priority > 0.8 ? 1 : 0`) 빠뜨려도 된다: 지시는 작업판의 `assignees` 변화(다음 줄)로 같이 잡힌다 |
| 작업판의 변화: 항목 수, 항목별 `status`, `assignees.length` | `s.board` |
| 불 칸 수의 감소: `fire > 0.2` 인 칸 수가 직전 표본보다 줄었다 | `s.fire`(현장마다 표본 때 센다). 제자리에서 물을 뿌리는 긴 진압(X6 의 외부 방어 `defensive`)은 움직임·작업판·`ring` 변화 없이 1분을 넘길 수 있다 — 불이 줄고 있으면 진전이다 |
| 구조 대상의 변화: `where`·`treated`·`dead`·`mob` | `s.casualties` (도중에 늘어날 수 있다 — 길이도 비교) |
| 용의자의 `state` | `s.hostiles` |
| 배정 부대의 `state` | `I.assigned` |
| 대원의 `status`, 임무 `kind`·`phase` | `s.agents` |
| 대원의 진행도: `a.ring` 또는 `a.task.progress` 가 0.01 넘게 바뀜 | 구출처럼 진행도가 구조 대상 칸에만 쌓이는 일(`c.trapWork`)도 `ring` 에 드러난다(`executor.ts:494`) |
| 대원 한 명이라도 1.5칸 넘게 움직임(직전 표본 대비) | `a.x`, `a.y` |

시계가 `STALL_SEC`(60초)를 넘은 사건이 후보다. 사건마다 가장 긴 구간 하나만 남긴다: 시드, 사건 코드, 시나리오, 시작 시각(`fmtClock(startTod + t)` 과 `t`), 길이, active 대원 수, 열린 작업 요약, 마지막 `importance ≥ 1` 기록 문구, 종료 사유·결과.

**(나) 잊힌 사건 `forgotten`** — 통화가 끝났는데 아무도 맡지 않은 사건. 아무도 움직이지 않고 `noresponse`(330초)만 기다리는 상태다.

`IncidentPhase` 의 `'pending'` 은 선언(`types.ts:380`)과 비교(`dispatcher.ts:110`)만 있고 **넣는 곳이 없다**. 실제 흐름은 `unreported` → `call`(`callSystem.ts:272`, 통화가 시작될 때) → `dispatched`(`dispatcher.ts:110`, 첫 출동 지령) → `onscene`(`sceneManager.ts:54`)이고, 통화가 끝나도(`endCall`) 단계는 바뀌지 않는다. 그래서 통화 뒤 아무도 맡지 않은 사건은 `'call'` 에 머문다. 표본마다 사건 I 가 다음을 **모두** 만족하면 시계가 돈다:

1. `I.phase === 'call'` 이고 그 사건의 통화(`sim.calls` 가운데 `incidentId === I.id`)에 `state` 가 `ringing`·`active` 인 것이 없다 — 또는 `I.phase === 'dispatched'`.
2. `I.assigned.length === 0`.
3. `I.pursuit?.state !== 'driving'`(달리는 차를 쫓는 동안은 부대가 알려진 위치에서 기다린다).
4. `I.assessment && I.locationKnown` 이고 `Σ I.unmet === 0`.

시계가 `FORGOT_SEC`(30초) 이상이면 `forgotten` 에 센다(사건마다 한 번, 가장 긴 구간). 4 가 왜 필요한가: 위치를 모르는 사건은 `assess` → `recomputeUnmet` 때문에 `unmet` 이 0 보다 크지만 `tickDispatch` 가 `locationKnown` 이 거짓인 사건을 건너뛰어(`dispatcher.ts` `tickDispatch` 첫 줄) 실제로는 아무도 맡지 않는다 — 이것은 정보가 모자란 것이지 배정이 잊은 것이 아니다. 그래서 따로 센다:

- **`unlocated`(보고만)**: 1·2·3 을 만족하고 `!I.assessment || !I.locationKnown` 인 채 `FORGOT_SEC` 이상. 신고자가 위치를 대지 못한 사건(추가 신고를 기다리는 중)이다. 관문에 걸지 않는다 — 극한의 막연한 신고에서는 정상적인 결과다. 다만 값이 크면 접수 쪽의 고칠 일 후보다.
- `Σ unmet > 0` 이고 위치를 아는 사건은 대기열(자원 부족)이라 여기서 세지 않는다(`queueWaitSecPerIncident` 와 NO_UNIT 이 잡는다).

검토 때 S0~S2(보통)를 위치를 모르는 사건까지 넣은 넓은 정의(1·2·3 과 `Σunmet === 0 || !locationKnown || !assessment`)로 재 보니 30초를 넘긴 건은 0건, 가장 길게 이어진 것은 13초였다 — `forgotten`·`unlocated` 모두 0 이다. `FORGOT_ALLOW = 0` 으로 시작하고 M-G1 과 같은 래칫을 쓴다(§2.14).

**(다) 느슨한 대기(보고만)**:
- `idleSecPerIncident` = active 대원이 모두 임무가 없거나 `standby`·`rehab` 인 표본 초의 사건당 평균(설계 시험 S0~S2: 사건 42건에 합 약 380초). 구급차를 기다리는 것처럼 정상적인 대기가 섞여 있다.
- `queueWaitSecPerIncident` = (가) 의 조건 1·2 를 만족하고 (가) 의 4 가 거짓(대기열)인 표본 초의 평균. 자원 부족의 크기다.
- `repeatMax` = 사건 안에서 `importance ≥ 1` 인 같은 `(actor, text)` 기록의 최대 반복 수. `REPEAT_WARN`(6) 이상은 목록으로("무의미한 반복" 후보).

**왜 이 정의인가**(가): 설계 시험(조사 때 `db8cba0`)에서 (가) 의 조건 3·4 와 진전 신호(`ring` 포함, 중요도 0 제외)를 하나씩 더하며 후보를 읽어 보았다. 조건 3 이 없으면 견인차·구급차를 기다리는 교통사고가, 조건 4 가 없으면 지진 중 대기열에 걸린 사건이, `ring` 이 없으면 긴 구출 작업이 후보로 잡혔다(모두 거짓 양성). 남은 후보는 S1 #09 하나였고 실제로 아무도 할 일이 없는 상태였다. B3 을 합친 `a746b77` 에서는 S0~S7·지진 S0~S1 모두 0건이다.

### 2.11 지표 8 — 결과 다양성 `variety`

- 시나리오별(`n_s ≥ 5`) 두 열쇠:
  - `K1` = 결과(`success`·`partial`·`delayed`·`unresolved`·`failed`).
  - `K2` = 결과 + `|` + **주된 문제** = 그 사건 문제 가운데 잡음 코드(CALL_QUEUE·CALL_VAGUE·CALL_MISINFO·UNDER_DISPATCH·OVERESTIMATE·FALSE_ALARM)를 뺀 것 중 `t` 가 가장 이른 코드(같으면 배열 순서), 없으면 `none`.
- `outcomeEntropy` = `K1` 엔트로피의 가중 평균, `storyEntropy` = `K2` 엔트로피의 가중 평균, `storyDistinct` = 시나리오별 `K2` 가짓수 ÷ `n_s` 의 가중 평균.
- `flat` = `n_s ≥ 10` 인데 `K1` 엔트로피가 0 인 시나리오(늘 같은 결과 — 성공률만 올리다 단조로워진 곳).
- **왜 이 열쇠인가**: 문제 코드 전체 집합을 열쇠로 하면 42건이 모두 달라 의미가 없다(설계 시험). 결과 하나는 너무 거칠다. "결과 × 처음 꼬인 곳"은 보고서가 그 사건을 한 줄로 요약하는 방식과 같다.

### 2.12 보조 — 기록·상태 일치 검사 `consistency`

사용자 완료 기준 "모든 결과가 이벤트 로그와 실제 상태에 일치"를 숫자로. 위반 수를 센다.

| 검사 | 내용 | 지금 | 관문 |
|---|---|---|---|
| C1 | 모든 `Problem.eventId ≥ 0` 이 그 사건(`incidentId === I.id`)의 기록을 가리킨다 | 0 (설계 시험 127개 중 위반 0) | 건다 |
| C2 | 닫힌 사건마다 `kind 'resolve'`·`actor '사건 관리'` 기록이 정확히 하나, 열린 사건은 0 | 0 (검토 때 S0~S2 를 다시 재어 확인 — 종료 기록은 `closeIncident` 한 곳에서만 만든다) | 건다 |
| C3 | `tHospital ≥ 0` 인 구조 대상이 있는 사건마다 병원 인계 기록(문구 규칙 T4)이 하나 이상 | 0 (검토 때 S0~S2 를 다시 재어 확인) | 건다 |
| C4 | DIVERTED 문제마다 같은 시각에 다른 사건의 출동 지령 기록(`kind 'dispatch'`, `role 'DISPATCH'`, 문제 기록 바로 뒤의 첫 것, 문구 규칙 T7)이 있다 | 0 일 것 — 검토 때 표본에 전환이 없어 직접 재지 못했지만 `dispatcher.ts` 의 DIVERTED 기록과 받는 사건의 출동 지령 사이에 다른 `emit` 이 없다(`dispatchUnit`·`setRoute` 는 기록하지 않는다) | 건다 |
| C5 | 이송 출발 문구(T3)의 병원 이름 = 같은 부대(`actor`)의 다음 인계 문구(T4)의 병원 이름. **I1-b b3-2 뒤**: 같은 부대의 마지막 출발 **또는 목적지 변경(T3·T8)** 의 병원 = 다음 T4 의 병원(C3 결과 4 의 목적지 변경이 C5 위반이 되지 않게 — b3-2 에서 `metrics.ts` 와 §6 테스트 6 을 함께 고친다). 다음 T4 가 없는 출발(교대 끝, 환자 0명 출발)은 건너뛴다 — 분모에서도 뺀다 | **설계 시험 48회 중 14회 위반** (`sceneManager.ts:211` 의 "시립병원" 고정. 검토 때 S2 에서 T3 15회·T4 14회) | **보고만**. R1 단계 3 이 고친 뒤 켠다(R1 이 켜거나, I1-b b1 시작 때 0 을 확인하고 켠다) |

C2~C4 가 첫 측정(40시드)에서 0 이 아니면 그 검사는 보고만 하고, 원인을 ROADMAP 에 적는다(I1-a 는 고치지 않는다).

### 2.13 출력

**새 옵션**:

| 옵션 | 뜻 |
|---|---|
| (없음) | 지표를 언제나 계산한다(표본 포함). 기존 줄 뒤에 아래 9줄 + 후보 줄 |
| `--metrics` | 시나리오별 표(행동 다양성·결과 다양성·확산 최댓값)와 예시·후보를 모두(상한 없이) |
| `--no-metrics` | 표본을 뜨지 않고 지표 줄을 내지 않는다(속도 비교용 — 지표 계산 비용을 빼고 잴 때) |
| `--log S7 --metrics` | 한 교대의 사건마다 가장 긴 원인 사슬과 확산 길을 기록 문구와 함께(사슬을 읽는 도구) |

**글자 줄** — `problems (incidents affected):` 줄 다음, `--check` 의 결과 앞. 접두어는 고정(다른 도구가 grep 한다). 숫자는 설계 시험 S0~S2 의 어림(일부는 꾸민 값 — 모양만 본다):

```
chain: parent depth 0:42 1:0 2:0 3+:0 (max 0, chained 0.00/shift, max/shift 0, dropped 0, disaster skipped 0 cleared 0) · rooted 0 · causes depth avg 4.5 max 10 · cross-incident links 0 · world links 0
systems: avg 4.7 (extra 1.7) · hospital 71% hazard 31% building 24% road 24% aid 14% equip 7% crew 5% infra 0% other 0% disaster 0% carry 0% · spread 0:36 1:6 (≥3: 0, max 1, raw max 1)
replan: 55% (field 52%, dispatch 5%, route 2%) · from world 0 · cancelled 2.5/incident · COMM_FAIL 10 PATH_BLOCKED 8 …
alt: failures 23 → retry 48% · alt 52% · gave up 0% (items 11: retry 11 alt 0 · path 8/8 · equip 4/4 · water 0/0)
actions: entropy 2.3 bits · kinds 18 · order variety 0.74 · lowest medical/faint 0.9 (n 9)
contention: 29% of incidents (NO_UNIT 19% CALL_QUEUE 10% DIVERTED 0% BACKUP_LATE 0%) · aid 2.0/shift · peak open 3.7 · peak busy 71% · diverted 0 (hurt 0, lost 0s) · ER waits 1 (cross 1)
stall: candidates 0 (max 0s, allow 0) · forgotten 0 (allow 0) · unlocated 0 · idle 9s/incident · queue wait 1s/incident · repeat max 6
variety: outcome 1.0 bits · story 1.7 bits · distinct 0.62/incident · flat none
consistency: C1 0 · C2 0 · C3 0 · C4 0 · C5 14/47 (보고만) · metric errors 0
  SPREAD S0 #04 medical/faint 1: #04:call → #04:call → #04:aid
  REPEAT S1 #01 x6 안지후: 적재장 통로가 잔해로 막혀 있음
```

교착 후보가 있으면 이런 줄이 붙는다(조사 때 `db8cba0` 의 예):

```
  STALL S1 #09 search/hiker 10:41:12 (t=990s) 115s — active 6, open work 0, last "C구역 정밀 수색 완료 (확인율 100%)" → timeout/failed
```

후보 줄(`STALL`·`FORGOT`·`REPEAT`·`SPREAD`)은 기본 출력에서 각 3개까지, `--metrics` 면 모두(위치를 모른 채 남은 사건 `UNLOC` 줄도 `--metrics` 에서만). **`STALL`·`FORGOT` 은 하나라도 있으면 언제나 찍는다**(교착 후보는 숨기지 않는다 — 관문을 걸지 않는 조건에서도).

**`--json`** — 기존 키는 이름·뜻을 바꾸지 않고 셋을 더한다:

```jsonc
{
  // … 기존 키 그대로 (msPerShift 는 실행마다 다르다 — 비교에서 뺀다)
  "problems": { "PATH_BLOCKED": 8, "NO_UNIT": 7 },        // 코드별 영향받은 사건 수 (지금 글자 줄에만 있던 것)
  "reportHash": "5f3a9c21",                                // 시드별 report.hash 를 이어 붙여 FNV-1a 한 값 (결과 불변 비교용)
  "metrics": {
    "errors": 0,                                           // 지표 계산 오류 (표본·shiftMetrics 의 예외). 기존 최상위 errors 와 따로
    "chain":   { "parentDepth": {"0":42,"1":0,"2":0,"3+":0}, "maxParentDepth": 0, "chained": 0, "chainedPerShift": 0, "maxChainedInShift": 0,
                 "rooted": {"0":42}, "dropped": 0, "disasterSkipped": 0, "disasterCleared": 0,
                 "causesDepth": { "avg": 4.4, "max": 10, "hist": {"3":7,"4":23} }, "crossIncidentLinks": 0, "worldLinks": 0 },
    "systems": { "avg": 4.7, "extraAvg": 1.7, "share": {"hospital":0.71}, "spread": { "hist": {"0":36,"1":6}, "max": 1, "ge3": 0, "rawMax": 1, "rawGe3": 0, "world": 0, "examples": ["…"] } },
    "replan":  { "share": 0.55, "field": 0.52, "dispatch": 0.05, "route": 0.02, "byCode": {"COMM_FAIL":10}, "cancelledPerIncident": 2.5, "fromWorld": 0 },
    "alt":     { "failures": 23, "retryRate": 0.48, "altRate": 0.52, "gaveUpRate": 0,
                 "items": [11, 0], "path": [8, 8], "equip": [4, 4], "water": [0, 0], "methods": null },
    "actions": { "entropy": 2.3, "kinds": 18, "orderVariety": 0.74, "lowest": [["medical/faint", 0.9, 9]], "methodEntropy": null },
    "contention": { "share": 0.29, "byCode": {"NO_UNIT":0.19}, "aidPerShift": 2.0, "peakOpenAvg": 3.7, "peakBusyAvg": 0.71,
                    "divert": { "n": 0, "hurt": 0, "lostSec": 0, "noEta": 0, "refillAvg": 0, "refillMissing": 0 }, "erWaits": 1, "erCross": 1 },
    "stall":   { "candidates": 0, "maxSec": 0, "allow": 0, "forgotten": 0, "forgotAllow": 0, "unlocated": 0, "idleSecPerIncident": 9, "queueWaitSecPerIncident": 1, "repeatMax": 6,
                 "list": [] },
    "variety": { "outcomeEntropy": 1.0, "storyEntropy": 1.7, "storyDistinct": 0.62, "flat": [] },
    "consistency": { "C1": 0, "C2": 0, "C3": 0, "C4": 0, "C5": 14, "C5n": 47 }
  }
}
```

- 목록(`examples`·`list`)은 20개에서 자른다(한 줄 JSON 이 너무 길어지지 않게).
- `--no-metrics` 면 `metrics` 는 `null`, `problems`·`reportHash` 는 그대로. `--check --no-metrics` 면 지표 관문(§2.14)을 건너뛰고 `지표 관문 건너뜀 (--no-metrics)` 한 줄을 stderr 로 낸다(기존 관문은 그대로).
- **`--json` 과 `--check` 를 함께 주면 "검증 통과" 를 stderr 로** 보낸다(지금은 stdout 에 붙어 JSON 한 줄이 깨진다, `sweep.ts:123`). 종료 코드는 그대로.
- 이름 겹침: R2 는 `--methods` 와 최상위 `methods`, H1 은 최상위 `respondersKilledPerShift` 등과 `injuries:` 줄, X6 는 `catastrophe:` 줄과 같은 이름의 `--json` 칸(`X6-catastrophe.md` 의 `sweep.ts` 집계 줄)을 쓴다. R1 은 새 키를 더하지 않는다(교대 수·헬기 통계는 보고서 쪽). I1-a 는 `metrics` 하나와 위 9개 접두어(`chain:`·`systems:`·`replan:`·`alt:`·`actions:`·`contention:`·`stall:`·`variety:`·`consistency:`)만 쓴다. 겹치지 않는다.

### 2.14 관문(`npm run check`)에 거는 조건과 이유

`checkMetrics(m, opts)` 가 돌려준 문구는 기존 `fail` 목록에 더한다. 관문은 둘로 나뉜다(`opts.baseline` = `sweep.ts` 의 기존 조건 `!diffArg && !disArg && !force`, 곧 `npm run check` 와 같은 보통 기본 조건):

- **구조의 불변 조건 — 언제나 건다**(난이도·재난·강제 발생과 상관없이): M-G3·M-G4·M-G5.
- **래칫 — 보통 기본 조건에서만 건다**: M-G1·M-G2. 그 밖의 조건(`--diff`·`--disaster`·`--force`)에서는 값과 후보 줄을 찍기만 한다. 까닭: `STALL_ALLOW`·`FORGOT_ALLOW` 는 보통 40시드에서 정한 값이고, 극한에는 교착 종료가 원래 있다(ROADMAP `a746b77` 수치의 극한 0.72%). 다른 조건의 상한은 I1-a 기준선(§2.16)을 잰 뒤 조건별 표로 ROADMAP 에 적고, I1-b 완료 조건(§5 의 5)이 그 표로 본다.

| 관문 | 조건 | 이유 |
|---|---|---|
| M-G1 교착 | `stall.candidates ≤ STALL_ALLOW` (보통 기본 조건) | 교착 없음. 설계 시험(`a746b77`, S0~S7)에서 0 이라 `STALL_ALLOW = 0` 으로 시작한다. 구현 때 `sweep 40` 에서 후보가 나오면 하나씩 읽고, 거짓 양성이면 진전 신호를 고치고, 진짜면 **래칫**으로 건다: 그 수를 `STALL_ALLOW` 로 적고 후보를 ROADMAP 의 고칠 일로 올린다(고쳐서 줄면 상수를 낮춘다, 늘면 실패). I1-b 완료 때는 0 |
| M-G2 잊힌 사건 | `stall.forgotten ≤ FORGOT_ALLOW` (보통 기본 조건) | 아무도 맡지 않은 사건은 교착이다. 고친 정의(§2.10 나)로 검토 때 S0~S2 0건. M-G1 과 같은 래칫. `unlocated` 는 걸지 않는다 |
| M-G3 연쇄 상한 | `chain.maxParentDepth ≤ CHAIN_DEPTH_GATE`(4), `chain.maxChainedInShift ≤ CHAINED_SHIFT_GATE`(8) | 무한 연쇄 없음. 방화는 깊이 2에서 멈추고, 총 든 용의자의 재범은 Z1(`2812fe6`)의 `canChain` 뒤 깊이 2 로 막힌다(이 문서를 쓸 때는 상한이 없었다 — §1.2). 지금 값보다 넉넉한 상한으로 건다. I1-b 의 깊이 상한(3) 뒤에 3으로 낮춘다 |
| M-G4 일치 | `consistency.C1..C4 === 0` | 기록과 상태가 어긋나지 않는다. C5 는 R1 단계 3 이 출발 문구를 고친 뒤에 더한다(§2.12) |
| M-G5 계산 오류 | `metrics.errors === 0`, 아니면 `지표 계산 오류 N건` | 측정 도구가 조용히 틀리지 않게. 기존 최상위 `errors`·`예외 N건` 과 따로 센다(§2.2) |
| (보고만) | `repeatMax`, 확산·재계획·다양성 값 | 기준선을 재고 나서 정한다 |

**하한(예: "다른 사건을 가리키는 원인 > 0", "확산 3단계 사례 ≥ 1")은 관문에 걸지 않는다.** 지금 값이 0 이고(걸 수 없다), I1-b 뒤에도 드문 사건이라 40시드에서 흔들린다. 하한은 I1-b 의 완료 조건(§5, 더 많은 시드와 재난 교대)과 정해진 시드의 테스트(§6)로 확인한다.

### 2.15 결과 불변 확인

네 겹으로 증명하고 보고에 적는다. **기준 커밋 `<base>` 를 먼저 고정한다**: I1-a 를 시작할 때의 커밋에서 브랜치 `wf/i1a` 를 만들고(같은 세션의 B1·G5 가 주 작업 폴더에서 `src/` 를 고쳐도 이 증명은 흔들리지 않는다), 아래 1~4 는 모두 그 브랜치에서 한다. 합칠 때(주 작업 폴더로) 이미 B1·G5 가 들어와 있으면 합친 뒤 `npm run check` 를 한 번 더 돌린다 — 그때 해시는 B1 때문에 기준과 다르므로 비교하지 않는다.

1. **코드 근거**: `git diff --stat <base>..wf/i1a -- src` 가 빈 출력.
2. **해시 목록**: `<base>` 에서 저장소 밖 스크립트로 해시를 저장하고 `wf/i1a` 의 끝에서 diff 0줄.
   ```ts
   // <scratchpad>/i1hash.ts — npx tsx <scratchpad>/i1hash.ts > before.txt (끝에서 after.txt, diff)
   import { Sim } from '/home/user/operator/src/sim/engine';
   import { NORMAL, parseDisaster } from '/home/user/operator/src/sim/difficulty';
   const runs: [string, any, string | null][] = [];
   for (let k = 0; k < 12; k++) runs.push(['S' + k, NORMAL, null]);
   for (let k = 0; k < 3; k++) runs.push(['S' + k, { ...NORMAL, disaster: parseDisaster('quake') }, null]);
   for (let k = 0; k < 3; k++) runs.push(['S' + k, NORMAL, 'fire/arson']);
   for (const [seed, d, force] of runs) { const s = new Sim(seed, d, 1200, { force }); s.runToEnd(); console.log(seed, force ?? '', s.report!.hash, JSON.stringify(s.report!.counts)); }
   ```
3. **`sweep` 의 기존 키**: `npx tsx scripts/sweep.ts 12 --json` 을 전후로 받아 `msPerShift`·`metrics`·`problems`·`reportHash` 를 뺀 나머지가 같다(`node -e` 로 두 JSON 을 읽어 지운 뒤 `JSON.stringify` 비교). 글자 출력도 `avg …ms/shift` 와 새 줄을 빼면 같다.
4. **테스트**: `tests/causality.test.ts` 의 "측정은 결과를 바꾸지 않는다"(§6) — `runToEnd` 와 `runWithProbe` 의 `report` 전체(`JSON.stringify`)가 같다.

### 2.16 기준선 측정 명령

I1-a 를 넣은 뒤 한 번 재서 ROADMAP 의 "기준 수치"에 적는다(`$SCR` = 각자의 scratchpad. 결과를 저장소에 넣지 않는다). 수치 옆에 **잰 `src/` 의 커밋**을 적는다(`git log -1 --format=%h -- src`). CPU 가 바쁘면 시드 수를 줄이되, **관문과 같은 보통 40시드는 반드시** 돈다. **B1(결과를 바꾼다)이 합쳐지면** 그 뒤에 `npx tsx scripts/sweep.ts 40 --json` 으로 `stall.candidates`·`forgotten` 을 다시 보고 `STALL_ALLOW`·`FORGOT_ALLOW` 를 확인한다(기준선의 다른 수치도 B1 뒤 값으로 다시 적는다).

```bash
npx tsx scripts/sweep.ts 40 --json > $SCR/i1a-normal.json          # 관문과 같은 조건 — STALL_ALLOW 를 여기서 정한다
npx tsx scripts/sweep.ts 40 --metrics > $SCR/i1a-normal.txt        # 시나리오별 표와 모든 후보
npx tsx scripts/sweep.ts 30 --diff hard --json > $SCR/i1a-hard.json
npx tsx scripts/sweep.ts 20 --diff extreme --json > $SCR/i1a-extreme.json
for z in typhoon flood quake wildfire tsunami; do npx tsx scripts/sweep.ts 10 --disaster $z --json > $SCR/i1a-$z.json; done
for f in fire/arson armed/robbery armed/kidnap collapse/gasblast traffic/pileup; do npx tsx scripts/sweep.ts 10 --force $f --json > $SCR/i1a-${f/\//-}.json; done
time npx tsx scripts/sweep.ts 10 && time npx tsx scripts/sweep.ts 10 --no-metrics    # 표본 비용 (교대당 몇 ms 늘었나)
```

후보(`STALL`·`FORGOT`·`REPEAT`)는 하나씩 `npx tsx scripts/sweep.ts 1 --log <시드>` 로 읽고, 거짓 양성이면 진전 신호를 고치고(§2.10 표에 한 줄 더하고 이유를 적는다), 진짜면 ROADMAP 의 고칠 일로 올린다(I1-a 는 고치지 않는다).

### 2.17 I1-a 구현 순서와 완료 조건

1. `scripts/metrics.ts`: `sysOf`·대응표·문구 규칙, 사후 계산(지표 1·2·3·4·5·8, C1~C5), `Probe`(지표 6·7 의 표본 항목, `dropped`). 순수 함수 단위로 나눠 테스트하기 쉽게.
2. `scripts/sweep.ts`: `runWithProbe`/`--no-metrics`, 글자 줄, `--json` 키, `--metrics`, `--log --metrics`, `--json --check` 의 stderr, `checkMetrics` 를 `fail` 에.
3. `tests/causality.test.ts`(§6 의 I1-a 부분).
4. §2.15 의 결과 불변 확인, §2.16 의 기준선 측정, `STALL_ALLOW` 확정, 후보 읽기.
5. `npm run check` 한 번. 커밋(한국어 메시지, 브랜치 `wf/i1a`). ROADMAP 에 기준 수치(잰 `src/` 커밋과 함께)와 교착 후보를 고칠 일로, README 의 `sweep` 설명과 CLAUDE.md 명령 표에 `--metrics`·`--no-metrics` 한 줄, CLAUDE.md 명령 표의 `npm test` 줄(지금 "Vitest 115개, 파일 7개" — 같은 세션의 다른 묶음이 테스트를 더했을 수 있으니 합칠 때의 수를 센다)에 `causality` 파일과 늘어난 테스트 수.

**완료 조건**: `git diff --stat <base>..wf/i1a -- src` 빈 출력, 해시 목록 diff 0줄, `npm run check` 통과(새 관문 포함), 9개 줄과 `metrics` 키가 나온다, 기준선이 ROADMAP 에 있다, 교대당 시간이 15% 넘게 늘지 않았다(넘으면 표본 주기를 10틱으로 하고 그 영향을 적는다).

---

## 3. I1-b 인과 규칙과 세계 상태 결합 (구현 중 — b3-4 부터는 2026-11-20 에 다시 썼다)

### 3.1 원칙

**자연스러운 인과 (2026-11-20 — 사용자 방향).**

1. **원인은 상태를 바꾸고, 결과는 상태에서 나온다.** 규칙은 "X 면 Y 를 만든다"고 쓰지 않는다. 원인(사건·교통 사건·재난·대응의 실패)은 세계 상태를 물리적으로 바꾼다 — 구간의 통제·혼잡, 건물의 열 노출·구조 손상·배관 손상·침수, 구역의 전력·통신·수압·연기, 응급실 체류. 결과는 그 상태가 **일반 법칙**을 지나 생긴다: 평소의 발생률을 올리거나(초과 위험 과정, §3.6a), 이미 있는 물리 모델의 입력이 된다(교통 모델의 혼잡, X6 의 건전도와 가스, 현장 생성기의 처음 상태).
2. **법칙은 원인을 모른다.** 법칙은 상태의 값만 읽는다. 어떤 사건·어떤 변형·어떤 재난이 그 상태를 만들었는지를 식에 쓰지 않는다(테스트가 법칙 파일의 글자를 본다 — §6). 그래서 한 법칙에는 그 상태를 만드는 원인이 여럿이다(§3.7 의 법칙마다 "원인들" 줄). 원인은 **귀속**에만 쓴다: 사건이 나는 순간 그 상태를 이루고 있던 몫마다의 기록.
3. **틱마다 주사위를 굴리지 않는다.** 난수는 대상마다 한 번 뽑아 두는 문턱(그 건물이 얼마나 타기 쉬운가, 그 구간에서 몇 번째 사고가 얼마만큼의 위험이 쌓였을 때 나는가)뿐이다. 문턱은 경로와 무관하므로 **같은 시드에서 윗 원인을 없애면, 그 원인이 올리던 대상에서 문턱을 넘는 때가 늦어지거나 없어진다**(사건 단위로는 상한·대기에 걸러져 성립하지 않고, 풀린 구간 자신과 그 구간으로 우회로가 바뀌는 다른 통제의 길은 따로다 — §3.6a "개입 시험이 성립하는 까닭과 그 한계").
4. **평소와 같은 상태는 아무것도 바꾸지 않는다.** 초과는 "평소면 정확히 0"이 되게 원인 항으로 잰다(잡음이 낀 값끼리의 차로 재지 않는다). 초과가 없는 대상의 적분은 늘지 않고, 문턱을 넘기 전에는 기록도 난수도 남기지 않는다. 평소 생성기(`sim.rngGen`)는 건드리지 않는다.
5. **되먹임은 실제로 생기고, 상한이 끊는다.** 혼잡 → 사고 → 통제 → 혼잡, 불 → 옆 건물의 불 → 그 옆 건물. 초과 위험에서 난 사건은 원인 기록을 반드시 갖고, 그 상태의 주인이 사건이면 그 사건을 부모로 가져 사용자 결정의 상한(한 사슬 3건 · 한 교대 6건 — `chain.canChain`)에 든다. 부모가 없는 것(공사·정체·재난에서 온 초과)도 같은 6건 안에서 세고, 한 뿌리에서 난 가지의 수도 묶는다(§3.6 — 기본값은 모두 상한의 안쪽이다).
6. **증거는 개입 시험이다.** "같은 시드에서 쓰러진 나무의 통제를 지우면 몰린 길의 사고가 나지 않는다"를 테스트로 둔다(§6). 측정 도구는 스크립트 없이 난 인과 사건의 수를 따로 센다(§4 `hazard` 줄).
7. **보고서는 법칙 이름이 아니라 상태의 내력으로 쓴다**: "○○로 통제(쓰러진 나무) 뒤 △△로에 차량이 몰린 동안 난 사고". 사건이 날 때 그 자리에서 적어 둔 내력(`Incident.hz`)과 원인 기록에서만 만든다(§3.9).

**그대로인 것.**

- 상태를 바꾸는 코드는 그 자리에서 `emit(…, causes: [원인 기록])` 한다. 사건을 새로 만들 때는 그 사건의 발생 기록이 원인을 가리킨다. 연속으로 변하는 값(혼잡, 열 노출의 적분)은 기록하지 않고, 불연속 변화(통제, 금이 감, 배관 손상, 정전, 침수, 사건 발생)만 기록한다 — 지금도 혼잡이 12초마다 조금씩 바뀌는 것은 기록하지 않는다.
- 결과의 크기는 **유계**다: 모든 상태 변화에 회복(회복 시각 `until`, 또는 원인이 끝나면 저절로 0 이 되는 식)이 있고, 사건을 만드는 길에는 연쇄 상한과 법칙별 상한이 있다.
- **관제·지휘관은 알려진 것만** 쓴다. 상태가 바뀌어도 AI 가 곧바로 아는 것은 아니다. 알림·보고·제보로 `known` 이 켜진다(§3.8).
- 처음부터 다 만들지 않는다. 이미 상태 결합인 셋(C6 → C3 → C2)이 먼저고, 그 뒤가 틀(§3.6a) → 교통(§3.6b·L1) → 건물(§3.6c·L2·L3·L7) → 기반 시설과 환경(C4·L5·C8·C5·L4·L6·C11)이다(§5).

### 3.2 세계 상태 — 이미 있는 것과 새로 둘 것

| 영역 | 이미 있는 것 (그대로 쓴다) | 새로 둘 것 |
|---|---|---|
| 도시 | 구간의 `closed`·`closedReason`·`known`·`slow`·`cong`·`bump`·`wait`, 장애물(`traffic.obstacles`), 밀림(`traffic.queue`) | 교통 모델(`sim.traffic`)에: 우회 몰림 `divert`, 초과 혼잡의 네 몫 `exOwn`·`exBump`·`exQueue`·`exDiv`, 항마다의 원인 장부(`closeEv`·`slowEv`·`levelEv`·`bumps`·`qEv` — §3.6b). `sim.world` 에: 구역 위험 `zones[z].risk` |
| 건물 | 사건별 `Scene` 의 파손·탄 자리. (X6) 교대 안의 건물 상태 `Sim.placeMarks` — **그 건물에서 난 사건이 남긴** 가장 무거운 상태 하나. (I2) 지난 교대의 겹침 표 `sim.carryState.places` | **`sim.world.expo`**(§3.6c) — 사건이 없던 건물이 이웃에서 받은 것: 구조 손상 `shake`·가스 배관 손상 `pipe`(+ 배관의 문턱)·침수 `wet`, 지하의 문턱 높이 `world.sills`. 열 노출과 잔열은 초과 위험의 적분 칸(`world.hz`)에. X6 의 `placeMarks` 는 넓히지 않는다(읽는 곳 일곱 남짓이 `state` 다섯 값을 가정한다). 읽는 문은 `placeState(sim, placeId)` 하나 |
| 기반 시설 | 재난의 `d.dark`(정전 — 도시 전체, 전 구간 `bump`), 현장 격자의 `s.shadow`(무전 음영), `u.hydrant`(급수 연결 — 참/거짓) | `zones[z].power`·`comms`·`water` 와 회복 시각·알려짐·원인(b2), 국지 값의 자리 `zones[z].at`(§3.6c — 건물 하나의 붕괴가 동네 전체를 끄지 않게) |
| 의료 | 응급실 대기(같은 교차로의 `hospital` 부대 수) | `hospitals[h]`: 수용 한도·응급실 체류 환자·포화(`divert`)·알려짐 (C3) |
| 조직 | 부대 상태·대원 `health`·`stamina`·`status`, 장비, 인근 도시 지원 | 없음(R1·H1 이 만든다). I1-b 는 원인 연결만(§3.11) |
| 시민 | 현장의 구조 대상·신고자 | 없음. 연기에 노출되는 주민은 건물의 평소 응급률(`INCIDENT_PLACES.medical`)로 본다(L4) |
| 환경 | 날씨(교대 내내 고정), 재난의 수위(`d.level` — 구간마다 문턱 `d.thr`: **이미 "대상마다 문턱, 수위가 넘으면 잠긴다"는 법칙이다**)·불머리·`speedMul`, 현장의 불·연기·열 | `zones[z].smoke`(+ 국지 자리), 열린 화재 현장의 불 요약 `hazards.fireLoad(s)`(§3.6c) |
| 초과 위험 | 없음 | **`sim.world.hz`**(§3.6a) — 법칙 × 대상마다의 적분값·문턱 |

구역(zone)은 `cityPlan.DISTRICTS` 의 동네 18곳이다(`DISTRICTS` 순서가 인덱스). 점은 `districtAt(x, y)` 로 구역을 찾는다. **`districtAt` 은 가까운 동네를 고르는 함수가 아니다**: 모든 동네의 반지름 × 1.22 밖이면 `null` 을 돌려준다. 정한 것:

- `zoneOfXY(x, y)` = `districtAt(x, y)` 의 `DISTRICTS` 인덱스, `null` 이면 **-1**.
- `zoneOfPlace(sim, placeId)` = **`zoneOfXY(건물 가운데)`** (b3-4 에서 바꾼다 — b2 는 `Place.dong` 과 이름이 같은 동네를 찾는다). 까닭(조사 2026-11-20): `DISTRICTS[15].dong === '산촌'` 이라 "산촌은 `DISTRICTS` 에 없다"는 예전 글이 틀렸고, `dongAt` 은 동네 밖이라도 산이면 '산촌'을 붙이므로 산촌 반경 밖의 여섯 곳(산성 전망대·주택 1·비닐하우스 1·숲 3 — 동북 구릉 포함)이 이름으로는 구역 15 로 잡힌다. 지금 `zoneOfPlace` 를 읽는 규칙이 없어 결과는 바뀌지 않는다.
- **구역 -1 은 어느 구역 상태도 받지 않고 어느 구역 상태도 만들지 않는다**('외곽' 21곳 — 관제탑·여객 터미널·교도소·등대 포함, 교차로 13/173, 구간 13/257 가운데 여섯이 간선·고속). 그래서 **물리는 대상(구간·건물) 단위로 돌리고, 구역 값은 전력·통신·수압·연기의 요약과 관제가 아는 길(`knownZone`)로만 쓴다** — 초과 위험의 대상은 구역이 아니다. 구역을 쓰는 상태 결합(C4·C5·C8·C10·C11)은 -1 을 건너뛴다.

### 3.3 자료형 (`types.ts` — 추가만, 합집합 끝에는 새 줄로)

```ts
// ───────────────────────── 세계 상태 (I1) ─────────────────────────
/** 세계 상태 알림 기록의 갈래 — 측정 도구(scripts/metrics.ts)가 시스템을 가린다 */
export type WorldTag = 'power' | 'comms' | 'water' | 'smoke' | 'risk' | 'hospital';   // I2 가 끝에 | 'carry' 를 더한다 (I2 §3.7)
export type ZoneField = 'power' | 'comms' | 'water' | 'smoke' | 'risk';
/** 동네 하나의 상태. power·comms·water 는 1 = 정상 … 0 = 끊김, smoke·risk 는 0 = 없음 … 1 */
export interface ZoneState {
  power: number; comms: number; water: number; smoke: number; risk: number;
  until: Record<ZoneField, number>;      // 회복 시각 (Infinity = 원인이 끝날 때 정한다)
  known: Record<ZoneField, boolean>;     // 관제가 아는가
  cause: Record<ZoneField, number>;      // 지금 값을 만든 기록 (-1)
}
export interface HospitalState {
  fac: number;                 // city.facilities 의 id
  cap: number;                 // 응급실 동시 수용 (병상)
  stays: number[];             // 응급실에 있는 환자마다 병동으로 옮겨질 시각
  divert: boolean;             // 포화 — 중증만 받는다 (병원이 알린다)
  known: boolean; since: number; cause: number;
}
export type SignalKind = 'blast' | 'collapse' | 'fireBig' | 'delivered' | 'fled' | 'closed' | 'catastrophe';      // (b3-4) 끝에 | 'quake' | 'blackout' — 아래 "초과 위험 과정과 건물 노출의 자료형"
// ↑ X6 가 먼저 빈 world/consequence.ts 에 같은 합집합을 만들어 두었으면(§3.10) b2 에서 그 정의를 여기로 옮기고,
//   consequence.ts 는 `export type { SignalKind } from '../types'` 로 다시 내보낸다 (X6 쪽 import 는 그대로 컴파일된다)
/** 상태를 바꾸는 자리가 world 에 알리는 사실 한 줄. tickWorld 가 다음 틱에 규칙에 건넨다 */
export interface Signal { kind: SignalKind; t: number; inc: number; ev: number; x: number; y: number; size: number; place: number; data: number }
/** 일어난 결과 한 줄 (보고서·측정) */
export interface CsqRecord { rule: string; t: number; ev: number; inc: number; made: number; depth: number }      // made = 만든 사건 (-1)
export interface WorldState {
  zones: ZoneState[];                        // DISTRICTS 순서
  hospitals: HospitalState[];                // city.facilities 가운데 병원, id 순
  // 건물 상태는 두지 않는다 — X6 의 Sim.placeMarks, I2 의 carryState.places 를 placeState() 로 읽는다
  signals: Signal[];
  log: CsqRecord[];
  last: Record<string, number>;              // '규칙|열쇠' → 마지막 발동 시각 (쿨다운)
  count: Record<string, number>;             // 규칙 → 이번 교대 발동 수 (상한)
  tries: Record<string, number>;             // '규칙|열쇠' → test 를 부른 횟수 (난수 흐름 이름의 시도 번호, §3.4)
  spawned: number;                           // 규칙이 예약한 사건 수 (전체 상한, spawnConsequence 의 흐름 번호)
}
```

있는 자료형에 더하는 칸(모두 선택 칸):

```ts
// SimEvent · EmitArgs (events.ts 도 한 줄: 있으면 복사)
tag?: WorldTag;
// Incident
cause?: number;              // 이 사건을 낳은 기록 (발생 기록의 causes 에 들어간다)
csq?: string;                // 이 사건을 만든 규칙 또는 연쇄 ('blastSpread' · 'arson' · 'reoffend' …)
blockedBy?: number[];        // 수요를 막은 사건들 (NO_UNIT 때 그 부대를 잡고 있던 사건)
blockEv?: number;            // 이 사건이 도로를 막을 때 남긴 통제 기록 (sceneManager 6) 블록, 산사태·다중 추돌의 onCreate, X6 collapseBuilding 의 통제 기록). 지금은 id 를 어디에도 두지 않는다
divertWait?: { unit: number; t: number; eta: number; ev: number }[];   // 빼앗긴 부대와 그 부대의 예정 도착 (C6 이 첫 도착 때 지연을 잰다)
// Problem
ref?: { inc?: number; unit?: number; edge?: number; fac?: number; lost?: number };    // 관련 사건·부대·구간·병원, 늘어난 초
// Scene
shadowAdd?: number[];        // 통신 장애로 더한 무전 음영 칸 (회복 때 되돌린다)
// ShiftReport
world?: { outages: number; commsDown: number; hospitalDiverts: number; rerouted: number; spawned: number; lines: string[] };
// ShiftReport.incidents[] 의 항목
parent?: number; children?: number[]; chain?: string[];
// ProblemCode (끝에 새 줄로)
| 'HOSPITAL_FULL'            // 응급실 포화로 먼 병원으로 이송
| 'INFRA_FAIL';              // 정전·통신 장애·수압 저하가 대응을 막았다
```

`incidents.ts` 의 `SpawnOpts` 에 `cause?: number; csq?: string;`, `GenState.chain` 항목에 `when?`·`until?`(§3.5), `GenState` 에 `dropped: { t: number; why: 'late' | 'busy' | 'depth' | 'expired' | 'cap'; type?: IncidentType; variant?: string; parent?: number }[]`. `traffic.ts` 의 `ObstacleKind` 끝에 `| 'rubble'`(라벨 '건물 잔해'), `Obstacle` 에 `ev?: number`(C2). `Sim`(`engine.ts`)에 `world: WorldState`.

**객체 모양(P1)**: `Incident`·`Scene` 에 더하는 선택 칸은 생성 리터럴에도 같은 순서로 `undefined` 를 넣는다(`incidents.ts` 의 `createIncident` 리터럴, `kit.ts` 의 `baseScene`, 교대 중에 생기는 현장 칸은 `createScene` — CLAUDE.md "자주 도는 객체의 모양"). `Problem` 은 그 목록에 없지만 `ref` 도 만드는 세 곳(`events.raiseProblem`, `debrief.addProblem`, `agents.ts` 의 `LATE_DISCOVERY`)에 `ref: undefined` 를 넣어 모양을 맞춘다. `SimEvent` 는 `emit` 의 리터럴 한 곳에 `tag: a.tag`(없으면 `undefined`). `Obstacle.ev` 는 `traffic.ts` `place` 의 장애물 리터럴에 `ev: undefined`(장애물은 교통 모델이 12초마다 훑는다).

모든 칸은 함수가 없는 순수 자료다. I2 는 `zones`·`hospitals` 를 저장하지 않고 `initWorld` 에 carry 를 넘기지 않는다 — 병원·구역 상태의 교대 간 지속은 I2 범위 밖이고 ROADMAP 의 새 항목이 같은 틀로 더한다(I2 머리말 "이번에 하지 않는 것").

**초과 위험 과정과 건물 노출의 자료형** (2026-11-20 — b3-4 가 같은 "세계 상태와 신호" 소절 끝에 더한다. 모두 추가다):

```ts
// ───────────────────────── 초과 위험 과정 (I1-b §3.6a) ─────────────────────────
/** 일반 법칙의 이름 — Incident.csq 와 흐름 이름에 쓴다. 새 법칙은 끝에 새 줄로 (L6 floodLow 는 사건을 만들지 않는 상태 규칙이라 여기에 없다) */
export type HazardLawId = 'roadCrash' | 'heatSpread' | 'structFail' | 'pipeLeak' | 'rekindle' | 'liftStall' | 'smokeIll';
/** 초과를 이루는 상태의 갈래 — 보고서가 내력 문장을, 발생 기록이 첫머리를 고른다 */
export type HzWhat = 'divert' | 'queue' | 'lane' | 'jam' | 'crowd' | 'dark' | 'haze'      // 도로: 우회 몰림 · 뒤로 밀림 · 한 차로 막힘 · 정체 · 인파 · 꺼진 신호 · 연기
  | 'heat' | 'ember' | 'shake' | 'pipe' | 'residual' | 'outage' | 'smoke' | 'level';         // 건물: 열 · 불티 · 구조 손상 · 배관 손상 · 잔열 · 정전 · 연기 / 수위(도로: 차오르는 물 · 건물: 잠긴 지하)
/** 사건이 나는 순간 그 대상의 초과를 이루던 몫 하나 */
export interface HzSrc { ev: number; inc: number; w: number; what: HzWhat; ref: number; since: number }
//   ev = 그 상태를 만든 기록(-1 = 장부의 구멍) · inc = 그 상태의 주인 사건(-1 = 사건이 아니다: 공사·정체·인파·재난) · w = 그 순간의 몫(초당 위험, 충격이면 충격량)
//   ref = 관련 대상 (통제된 구간 · 불난 건물 · 정전 구역 … -1) · since = 그 몫이 이 대상에 처음 걸린 시각 = max(칸의 since, 그 기록의 시각)
/** 대상 하나의 적분 칸 — 초과가 처음 생길 때 만든다 */
export interface HzCell {
  H: number;        // 쌓인 초과 위험 (무차원 — 기대 사건 수). 초과가 0 인 동안에는 늘지도 줄지도 않는다
  thr: number;      // 문턱 E = −ln(1 − u₁). 흐름 hz:<법칙>:<대상>:<n> (대상마다 한 번인 법칙은 hz:<법칙>:<대상>)의 첫 값
  u2: number;       // 같은 흐름의 둘째 값 — 사건의 내용(버스가 끼었는가 따위)을 정할 때만 쓴다
  n: number;        // 이 대상에서 문턱을 넘은 횟수 (다음 문턱의 흐름 번호)
  since: number;    // 지금의 초과가 시작된 시각 (-1 = 지금은 초과가 없다)
  done: boolean;    // once 법칙의 대상이 한 번 넘었다 — 그 뒤로 적분도 충격도 받지 않는다
}
/** 문턱을 넘었지만 자리가 없어 기다리는 줄 — 넘는 순간의 몫을 적어 둔다 (자리가 났을 때는 원인이 이미 사라져 있을 수 있다) */
export interface HzWait { law: HazardLawId; target: number; n: number; until: number; parts: HzSrc[]; total: number }
/** 사건에 적어 두는 내력 — 보고서 문장의 재료 (§3.9). 사건을 예약하는 그 자리에서 적는다 */
export interface HzNote { law: HazardLawId; target: number; at: number; src: HzSrc[] }      // src 는 몫이 큰 것부터 많아야 3
export interface HzState {
  cells: Partial<Record<HazardLawId, Record<number, HzCell>>>;      // 법칙 → 대상 id → 칸 (드문드문)
  live: Partial<Record<HazardLawId, number[]>>;                     // 지난 주기에 초과가 있던 대상 (초과가 끝난 것을 알아채는 데 쓴다)
  waiting: HzWait[];                                                // 기다리는 줄 (넣은 순서 — 1초마다 다시 본다)
  roadAt: number;                                                   // 도로 법칙이 마지막으로 본 traffic.driftAt
  holes: number;                                                    // 원인 기록이 없는 큰 몫(전체의 1/3 이상)이 낀 채 문턱을 넘은 횟수 — 장부의 구멍 (0 이어야 한다, 테스트·관문)
}
//   법칙별·부모 없는 사건의 수는 따로 세지 않는다 — world.log 와 gen.chain·waiting 으로 센다 (hazard.ruleLoad, §3.6a)
/** 사건이 없던 건물이 이웃에서 받은 것 (§3.6c) — 처음 받을 때 만든다 */
export interface PlaceExpo {
  shake: number; shakeEv: number; shakeInc: number;      // 구조 손상 0..1 (받은 충격의 합) · 가장 크게 보탠 기록 · 그 사건
  pipe: boolean; pipeEv: number; pipeThr: number;        // 가스 배관이 손상됐는가 · 그 기록 · 배관의 문턱(만들 때 한 번 — 흐름 hz:pipe:<건물>)
  wet: boolean; wetEv: number;                           // 지하가 잠겼는가 (홍수) · 그 기록
  dark: number;                                          // 이 건물만의 정전이 시작된 시각 (-1 = 아니다. 구역 전력과 따로 — 잠긴 전기실)
}
// WorldState 에 (initWorld 의 리터럴에도 같은 순서로)
hz: HzState;                               // { cells: {}, live: {}, waiting: [], roadAt: -1, holes: 0 }
expo: Record<number, PlaceExpo>;           // 건물 id → 노출 (드문드문)
sills: Record<number, number>;             // 건물 id → 지하의 문턱 높이 (L6 — 처음 볼 때 채운다. 시드에 따라 달라지는 값은 sim.world 안에만 — §3.6c)
spans: { f: ZoneField; cause: number; inc: number; bump: number }[];      // 정전·연기 한 건마다의 장부 — 얹은 bump 의 id (그 건이 끝날 때 한 번 거둔다)
// ZoneState 에 (선택 칸 — 국지 값의 자리, §3.6c)
at?: Partial<Record<ZoneField, { x: number; y: number; r: number }>>;
// SignalKind 끝에 새 줄로 (N8 이 더하는 신호는 그 뒤)
| 'quake' | 'blackout'                     // 재난이 틀을 지나는 길 — 지진의 본진·여진, 태풍 정전의 시작·끝 (§3.4)
// Signal 에 (signal() 의 리터럴에 mag: s.mag ?? 0)
mag: number;                               // 크기 — 폭발이면 피해량(dmg), collapseBuilding 1 · collapseRegion 은 이번에 무너진 몫(< 1), 지진이면 본진 1 · 여진 0.6
// Incident 에 (createIncident 리터럴에 hz: undefined)
hz?: HzNote;
// Scene 에 (I2 가 정해 둔 칸을 I1-b 가 먼저 연다 — createScene·baseScene 리터럴에 wear: undefined)
wear?: { dmg: number; soot: number; cause: string; inc: string; pre: number };      // I1-b 는 cause 'shock' 으로만 채운다. 진실 전용 — 판단부는 읽지 않는다
// WorldTag 끝에 새 줄로 (I2 의 'carry' 는 그 뒤)
| 'struct'                                 // 이웃 건물의 구조·배관 손상 기록 — 측정 도구의 TAG_SYS 가 'building' 으로 센다
```

`incidents.ts` 의 `SpawnOpts` 에 세 칸: `edgeId?: number`(교통사고가 난 구간 — 막히는 구간 `I.blockedEdge` 를 이 구간으로 먼저 본다. 조건은 §3.6b (다)), `causes?: number[]`(원인이 하나가 아닐 때 — `cause` 다음에 발생 기록의 `causes` 로 들어간다. 음수·중복은 `emit` 이 거른다), `hz?: HzNote`. `traffic.ts` 의 `TrafficState` 에 더하는 칸은 §3.6b(정체 객체의 `ev` 포함).

### 3.4 인과 규칙의 틀 — `registerConsequence`

새 폴더 `src/sim/world/`(S-기반 트랙). `sceneRegistry.ts` 와 같은 끼워 넣기 방식이다.

```ts
// src/sim/world/state.ts — 만들기와 알려진 것만 꺼내는 함수
export function initWorld(sim: Sim, carry?: unknown): WorldState;           // carry 는 지금 받지 않는다 — 병원·구역 상태의 교대 간 지속은 I2 범위 밖이고 ROADMAP 의 새 항목이 같은 틀로 더한다
export function zoneOfXY(x: number, y: number): number;                    // DISTRICTS 인덱스 (-1)
export function zoneOfPlace(sim: Sim, placeId: number): number;
export function knownZone(sim: Sim, z: number): Partial<Record<ZoneField, number>>;    // known 인 칸만
export function knownHospital(sim: Sim, fac: number): { divert: boolean } | null;
/** 건물 상태: X6 의 Sim.placeMarks → I2 의 carryState.places 순서로 읽는다 (둘 다 없으면 null). usable 은 I2 의 persist.placeUsable (I2 전에는 X6 의 burnt·collapsed 가 아니면 true). 세계 규칙 쪽(진실) 전용 */
export function placeState(sim: Sim, placeId: number): { mark: string | null; burnFrac: number; ruinFrac: number; usable: boolean } | null;
/** 관제가 아는 건물 상태 — 관제는 건물 id 를 모른다(위치 진술은 교차로 id 뿐: callSystem 의 I.reportedNode = claim.value,
 *  Claim 에는 placeKind 만). 그래서 알려진 교차로로 묻는다: 그 교차로(reportedNode 가 같은)에서 이번 교대에 닫힌 사건
 *  (종료 기록이 있는) 가운데 placeKind 가 같은 것(주면)의 건물 상태, 또는 그 교차로 건물에 대해 지난 교대에서 이어받은 것
 *  (I2 의 carryState.places 가운데 Place.nodeId === node 이고 placeKind 가 같은 것 — 알림 여부와 상관없이 조직이 아는 기록, I2 원칙 7.
 *  이어받은 항목이면 돌려주는 inc 는 -1). 함수 안에서는 닫힌 사건의 truth.placeId 를 읽지만, 돌려주는 것은 종료 보고로 관제가 받은 사실뿐이다.
 *  I2 도 이 이름·인자를 쓴다(I2 의 옛 이름 knownBuilding(sim, id) 는 정합성 점검에서 이것으로 바꿨다) */
export function knownBuildingAt(sim: Sim, node: number, placeKind?: PlaceKind | 'intersection'): { burnFrac: number; usable: boolean; inc: number } | null;
/** 관제 쪽에서 사건의 구역을 구하는 유일한 길 — 진실 x/y 가 아니라 알려진 교차로로 */
export function knownZoneOfIncident(sim: Sim, I: Incident): number;      // I.locationKnown ? zoneOfXY(city.nodes[I.reportedNode]) : -1

// src/sim/world/consequence.ts — 틀
export interface CsqCtx { sim: Sim; sig: Signal | null; key: string; rng: Rng; depth: number }
export interface Consequence {
  id: string; label: string;               // 'blastSpread' · '폭발 불씨' (보고서 문장이 label 을 쓴다)
  on: SignalKind[] | 'tick';               // 신호를 받을 때, 또는 world tick(1초)마다
  key: (sim: Sim, sig: Signal | null) => string | null;   // 쿨다운 열쇠 (예 'inc:12', 'zone:3'). null 이면 이번에는 해당 없음
  cooldown: number;                        // 같은 열쇠로 다시 일어나기까지 (초)
  cap: number;                             // 이번 교대 상한
  spawns: boolean;                         // 사건을 만드는가 (깊이·전체 상한을 본다)
  test: (c: CsqCtx) => boolean;            // 조건
  apply: (c: CsqCtx) => void;              // 상태를 바꾸고 emit — 사건은 spawnConsequence 로만
}
export function registerConsequence(c: Consequence): void;
export function signal(sim: Sim, kind: SignalKind, s: Partial<Signal> & { inc: number; ev: number }): void;   // sim.world 가 없으면 아무것도 하지 않는다
export function tickWorld(sim: Sim): void;
export function spawnConsequence(sim: Sim, c: CsqCtx, opts: SpawnOpts, delay: [number, number], when?: (sim: Sim) => boolean, wait = 120): boolean;
export function chainDepth(sim: Sim, incId: number): number;              // = metrics 의 parentDepth (같은 정의) = Z1 chain.ts 의 chainLen − 1 (뿌리 0)
```

- **`tickWorld`** — `engine.step` 의 `tickDisaster` 다음, `tickIncidents` 앞에 한 줄(틱 순서는 결과를 정한다 — 이 자리를 바꾸지 않는다). 매 틱: **틱이 시작할 때 쌓여 있던 신호만** 처리한다 — 시작할 때 `signals.length` 를 `n` 으로 기억하고 앞의 `n` 개를 들어온 순서대로 꺼내 `on` 에 그 종류가 있는 규칙에 등록 순서대로 건넨 뒤 `signals.splice(0, n)`. 규칙의 `apply` 가 그 자리에서 `signal()` 을 보내면(예: 정전 → 통신) 그 신호는 다음 틱에 처리된다(한 틱 안에서 신호가 끝없이 이어지지 않는다). 5틱마다(`sim.tick % 5 === 1`): `on: 'tick'` 규칙, 그리고 회복(`until` 이 지난 구역 값·응급실 체류 환자 정리).
- 한 규칙의 발동: `key` → 쿨다운(`last['규칙|열쇠']`)·상한(`count[규칙]`)·(사건을 만들면) 깊이와 전체 상한 → `n = tries['규칙|열쇠'] = (tries[…] ?? 0) + 1` → `rng = sim.rng.fork('csq:' + id + ':' + key + ':' + n)` → `test` → `apply` → `log` 에 한 줄. `test` 가 거짓이면 쿨다운·상한은 세지 않지만 **시도 번호는 늘린다**. 까닭: `fork` 는 seed 와 이름의 해시라(`rng.ts` `fork`) 같은 이름이면 같은 수열이다. 이름에 시도 번호가 없으면 확률 판정을 되풀이하는 규칙(C5-1·C7 의 "60초에 한 번 확률 …", `on: 'tick'` 규칙 전부)이 매번 같은 첫 난수를 써서, 처음에 실패하면 교대 내내 일어나지 않고 처음에 성공하면 늘 일어난다. 새 흐름이라 다른 흐름을 건드리지 않는다는 원칙은 그대로다. 규칙 절(§3.7)의 "난수 `csq:…`" 는 이 이름의 앞부분이다(뒤에 `:<시도 번호>` 가 붙는다).
- **신호를 보내는 자리**(상태를 바꾸는 그 코드에서, 그 기록의 id 와 함께 한 줄):

| 신호 | 보내는 자리 | `size`·`data` |
|---|---|---|
| `blast` | `hazards.blast` 에서 원인이 `'blast'` 이고 X6 의 `catastrophe.ts` 가 부른 것이 아닐 때만(X6 이 대체하지 않은 폭발 — 폭발물 `rules/crime.ts`). H1·X6 뒤에는 무너짐도 `blast(…, cause 'crush')` 를 지나고 X6 의 가스·용기 폭발은 `catastrophe`(data 0)를 따로 보내므로, 그 둘에서는 보내지 않는다(같은 폭발이 두 번 들어오지 않게, 원인 사슬이 EXPLOSION 기록을 가리키게). R2 의 폭파 진입(`charge` — 사용자 결정 2026-11-15, 반경 1.5)도 `noSignal = true` 로 부른다 — 문 하나를 여는 작은 폭발은 정전·통제 같은 세계 상태 규칙의 원인이 아니다(R2 §4.2a) | `size` = 반경(칸) |
| `collapse` | `hazards.tickCollapse` 의 2차 붕괴, 크레인·가스 폭발·산사태의 발생(`onCreate`), 지진 여진의 붕괴 | `size` = 무너진 칸 수 |
| `fireBig` | `hazards.tickFire` 끝: 불 칸(`fire > 0.2`) 수가 처음 30을 넘을 때(현장마다 한 번) | `size` = 불 칸 수 |
| `delivered` | `resources.tickUnits` 의 병원 인계 완료(그 인계 기록) | `place` = 병원 시설 id, `data` = 산 환자 수(구조 대상만). H1 의 부상 대원·용의자 인계(`aboard`)는 `data` 에 넣지 않고 응급실 체류(`stays`)에는 넣는다(병상을 쓴다) — 같은 신호 한 번에 `size` = `aboard` 의 수 |
| `fled` | `hazards.ts` 도주 블록의 SUSPECT_FLED (총을 든 경우만) | `data` = 용의자 id |
| `closed` | `closeIncident` 의 종료 기록 다음 | |
| `catastrophe` | X6 의 실제 폭발·붕괴·전소 순간(§3.10) | `data` = 0 폭발 · 1 붕괴 · 2 전소. (b3-8) `mag` = 폭발의 피해량 · `collapseBuilding` 1 · `collapseRegion` 은 이번에 무너진 몫(< 1) |
| `quake` (b3-10) | `disaster.onImpact` 의 지진 본진(`mag 1`) · `tickQuake` 의 여진(`mag 0.6`) | `ev` = 그 자리의 `tell` 반환값, `x`·`y` = 진앙 `d.epi`. 재난이 틀(쿨다운·상한·`world.log`·`recover`)을 지나는 길이다 — 상태 규칙은 신호나 world tick 으로만 걸리고, `onImpact` 안에서는 `d.intensity` 가 아직 0 이다 |
| `blackout` (b3-10) | `disaster.lightsOut`(`data 1`) · `lightsOn`(`data 0`) | `ev` = 그 자리의 `tell` 반환값 |

X6 은 `tickFire` 의 천장 붕괴를 지우고 `blast` 에 `catOnBlast` 를 더한다(X6 §9 단계 3). 같은 일을 두 신호로 보내지 않는다: X6 이 대체한 자리(천장 붕괴, 2차 붕괴가 X6 의 `collapseRegion` 으로 옮겨진 경우)에서는 `collapse` 신호를 지우고 `catastrophe` 만 남긴다. 규칙은 `collapse`·`catastrophe(data 1)` 를 같은 것으로, `blast`·`catastrophe(data 0)` 를 같은 것으로 받는다. X6 이 부르는 `blast` 에서 신호를 끄는 방법은 §7 의 `hazards.ts` 줄(선택 인자).

- **`spawnConsequence`** — 규칙이 사건을 만드는 유일한 길. `gen.chain` 에 `{ at: t + rng.range(…delay), until: at + wait, when, opts: { ...opts, parent?, cause: sig.ev, csq: id, rng: sim.rng.fork('csq-spawn:' + id + ':' + n) } }` 를 넣는다(평소 생성기의 흐름을 건드리지 않는다). `n` = 늘리기 전의 `world.spawned`(이번 교대에 규칙이 예약한 사건의 순번 — 한 발동이 둘을 예약해도 서로 다르다. 거절된 것은 세지 않는다). 거절(깊이·상한)도 `gen.dropped` 에 남긴다.
- `createIncident` 는 `opts.cause` 가 있으면 발생 기록(`rootEvent`)의 `causes: [opts.cause]`, `I.cause = opts.cause`, `I.csq = opts.csq`.
- 규칙 파일: `src/sim/world/rules/{record,hospital,structure,infra}.ts`(상태 규칙 — 사건을 낳는 법칙은 `world/laws/`, 아래), 모으는 `src/sim/world/rules/index.ts` 를 `engine.ts` 가 import 한다(`sceneManager.ts` 의 `import './scenes'` 처럼). **import 순서 = 규칙 등록 순서 = 결과**다. 순서를 바꾸면 결과가 바뀐다는 주석을 둔다.
- **(2026-11-20) 초과 위험 과정은 이 틀 옆에 따로 둔다**(§3.6a — `world/hazard.ts`). `registerConsequence` 는 신호를 받아 **상태를 바꾸는** 규칙(C3·C2 와 구역 상태 C4·C5·C8·C10·C11, 충격을 건물에 적는 L3 의 앞부분 `shockSpread`, 수위 문턱의 L6)에 쓰고, **사건을 낳는 것은 `registerHazard` 의 법칙**이 한다. 지금 틀로 적분기를 쓰면 `test` 를 부작용 있는 적분 함수로 써야 하고(쿨다운·상한을 `test` **앞**에서 보므로 걸리는 동안 적분이 멎는다), 열쇠가 초마다 하나뿐이라 대상별 상태를 규칙이 스스로 가져야 하며, 시도 번호 흐름(`csq:…:<n>`)은 경로에 따라 달라 문턱으로 쓸 수 없다. `tickWorld` 의 1초 블록은 `on: 'tick'` 규칙 → **`tickHazards(sim)`** → `recoverWorld` 순서가 된다(법칙이 없으면 `tickHazards` 는 곧바로 돌아온다 — 해시 불변). 법칙 파일은 `src/sim/world/laws/{index,road,heat,shock,ember,power,smoke}.ts`, `engine.ts` 가 `import './world/rules'` 다음 줄에 `import './world/laws'`(**import 순서 = 법칙 등록 순서 = 결과**).
- **등록하는 파일(`world/rules/*`·`world/laws/*`)은 모음 파일(`index.ts`)만 import 한다.** `engine.ts` 는 `./disaster`·`./field/sceneManager` 를 `./world/rules`·`./world/laws` 보다 먼저 import 하므로, 그 모듈들이 법칙·규칙 파일의 함수를 직접 부르면(예: `createScene` → `laws/shock.ts` 의 `applyExpo`) 그 파일의 `registerConsequence`·`registerHazard` 가 모음 파일의 차례보다 먼저 실행된다 — 결정적이기는 해도 실제 등록 순서가 `index.ts` 에 적힌 순서와 달라지고(상한이 걸릴 때 어느 법칙이 먼저 자리를 쓰는가가 바뀐다), 다른 파일의 import 한 줄이 결과를 바꾼다. 그래서 다른 모듈이 부르는 함수는 **등록이 없는 파일**에 둔다: `world/state.ts`·`world/hazard.ts`·`world/expo.ts`(`applyExpo`·`expoOf`·`neighborsOf`·`darkened`)·`world/rules/record.ts`(b3-1 — 등록이 없다). **법칙 파일에는 `registerHazard` 만 둔다** — 신호를 받아 충격을 주거나 상태를 거두는 자리(폭발의 불티 · 닫힌 화재의 잔열 · 잠근 밸브의 `expo.pipe`)는 상태 규칙으로 `world/rules/structure.ts` 에 두고 `hazard.hazardImpulse` 를 부른다(등록 순서가 두 모음 파일의 차례 그대로 읽힌다). 테스트: `src/sim` 에서 `world/rules/`·`world/laws/` 를 import 하는 줄은 `engine.ts` 와 두 모음 파일, 그리고 `rules/record.ts` 를 부르는 곳뿐이다(소스 글자).
- **`spawnConsequence` 를 부르는 I1 의 규칙은 없다**(C6·C3·C2 와 구역 상태 규칙은 사건을 만들지 않는다). 함수는 그대로 둔다 — N8·N9 의 조건부 연쇄(`world/rules/kinds.ts`·`kinds2.ts`)가 쓴다. 전체 상한을 세는 법만 하나로 맞춘다(§3.6).

### 3.5 `gen.chain` 을 조건으로 일어나게 넓히기

기존 예약(`{ at, opts }`)은 **그대로 동작**한다. 항목에 선택 칸 둘을 더한다.

```ts
chain: { at: number; opts: SpawnOpts; when?: (sim: Sim) => boolean; until?: number }[];
```

`tickIncidents` 의 꺼내는 자리(`incidents.ts:171-174`)를 이렇게 바꾼다:

1. `sim.t >= at` 인 첫 항목 k(지금과 같다).
2. `when` 이 있고 거짓이면: `until` 이 지났으면 꺼내 버리고 `dropped.push({ why: 'expired' })`, 아니면 `at = sim.t + 5`(5초 뒤 다시 본다)로 두고 이번 틱은 넘어간다.
3. 꺼낸 뒤 교대 끝 150초 전이 지났으면 `'late'`, 열린 사건이 `maxConcurrent` 를 넘으면 `'busy'`, `chainDepth(parent) + 1 > DEPTH_MAX` 면 `'depth'` 로 버리고 기록한다(지금은 기록 없이 버린다). 버린 일은 기록(`emit`)하지 않고 `gen.dropped` 에만 남긴다 — 일어나지 않은 일을 로그에 남기면 가짜 연출이 된다. 보고서는 `dropped` 를 숫자로만 쓴다.

`when` 은 `sim` 의 상태만 읽는 함수여야 한다(바깥 변수를 바꾸지 않는다). 쓰는 예: 되살아나는 잔불은 "그 건물을 아직 쓸 수 있고 열린 사건이 없을 때만"(L7), 도주한 용의자의 재범은 "목표 건물 400 안에 경찰 부대가 없을 때만"(C10).

### 3.6 무한 연쇄 막기 — 되먹임과 상한

되먹임은 이제 실제로 생긴다: 혼잡 → 사고(L1) → 그 사고의 감속·통제 → 혼잡 → …, 불 → 옆 건물의 불(L2) → 그 옆 건물, 붕괴 → 옆 건물의 금·배관(L3) → 붕괴·누출 → 폭발 → …. 막는 장치:

| 장치 | 값 | 어디서 |
|---|---|---|
| **연쇄 상한 (사용자 결정 — 바꾸지 않는다)** | 한 사슬 3건(`CHAIN_MAX` — 뿌리 포함, 깊이 2 까지) · 한 교대 6건(`CHAIN_SHIFT_MAX`). 정본 `chain.canChain` | **부모가 있는 초과 사건은 모두 여기에 든다** — 이야기 연쇄(재범·도주 차량·은신처·방화)와 같은 6건을 나눠 쓴다. 나무(0) → 몰린 길의 사고(1) → 그 사고의 통제로 난 사고(2)에서 끊긴다. `hazard.hazardRoom` 이 본다(§3.6a 의 표) |
| **한 뿌리의 가지 `HZ.ROOT_MAX`** | 같은 뿌리(부모를 끝까지 거슬러 올라간 사건)를 가진 법칙 사건은 2건까지 — 뿌리 포함 3건(만든 것 + 예약 + 기다리는 것). 넘으면 `'depth'` 로 버린다 | `hazardRoom`. `canChain` 은 사슬의 **길이**만 본다. 이야기 연쇄는 한 사건이 하나를 낳아 드러나지 않았지만, 법칙은 한 뿌리에서 여러 대상이 함께 넘는다 — 큰 불 곁의 이웃 여덟 채, 통제 하나의 이웃·우회로 구간들, 거기에 연기 환자. 길이만 보면 불 하나가 옮겨붙은 불 셋과 연기 환자 둘을 모두 깊이 1 로 가질 수 있다. **"한 사슬 3건"을 길이로만 볼지 한 뿌리에서 난 사건 전체로 볼지는 사용자에게 물을 것**(§9) — 기본값은 좁은 쪽이다 |
| **부모 없는 초과 사건** | **한 교대 6건 안에서 센다**: `chainedInShift` + 부모 없는 법칙 사건 `≥ CHAIN_SHIFT_MAX` 면 `'cap'`. 그 안에서 부모 없는 것은 3건까지(`HZ.ORPHAN_CAP`) | 그 상태의 주인이 사건이 아닌 것(공사·정체·인파·재난의 통제와 정전)에서 난 사건. 부모가 없어 `canChain` 이 세지 못한다(b2 의 `chainedInShift` 는 부모 있는 것만 센다). 초안은 이것을 6건 **밖에** 따로 3건 두었는데, 그러면 한 교대에 인과로 난 사건이 9건까지 된다 — 사용자 결정은 6건이다. **사용자에게 물을 것**(§9): 따로 세어도 되는가 — 답을 받기 전 기본값은 상한 안쪽이다(안쪽이면 극한에서 이야기 연쇄가 길 위의 사고와 자리를 나눈다) |
| 전체 상한 `CSQ_SPAWN_CAP` | 규칙·법칙이 만든 사건 교대당 6(부모가 있든 없든). `hazard.ts` 로 옮긴다 | `hazardRoom`·`spawnConsequence`. **세는 법을 하나로**: `hazard.ruleLoad(sim)` = `world.log` 가운데 실제로 사건이 된 줄(`made ≥ 0`) + `gen.chain` 에서 기다리는 줄(`log` 가 있는 예약) + 법칙의 기다리는 줄. b2 의 `spawnRoom` 은 `world.spawned ≥ CSQ_SPAWN_CAP` 을 `ruleLoad(sim) ≥ CSQ_SPAWN_CAP` 으로 바꾼다(`world.spawned` 는 `csq-spawn` 흐름의 순번으로만 남는다) — 예약이 `'busy'`·`'late'`·`'expired'` 로 버려지면 자리가 돌아온다(지금은 사건을 만드는 규칙이 없어 결과는 그대로다) |
| 법칙별 상한 | §3.7 의 법칙마다(교대당 2~3) | `HazardLaw.cap` — `ruleLoad(sim, law.id)`(만든 것 + 예약 + 기다리는 줄). 따로 세는 칸을 두지 않는다 |
| 대상마다 한 번 | 건물의 발화·붕괴·누출·재발화·승강기 멈춤은 건물마다 교대에 한 번(`once` — 한 번 넘으면 끝, `HzCell.done`) | 문턱 흐름에 번호가 없다 |
| 시간 | 교대 끝 150초 전부터 만들지 않는다 | `hazardRoom`(`'late'`), `tickIncidents`(지금과 같다) |
| 부하 · 자리 | 열린 사건이 `maxConcurrent` 를 넘거나 그 자리에 사건을 낼 수 없으면 **기다리는 줄**(기본 60초 — §3.6a) | `tickHazards` |
| 쓸 수 없는 건물 | 전소·전체 붕괴 건물에는 법칙 사건을 내지 않는다(다른 건물로 옮겨 내지도 않는다) | 틀의 공통 조건, `tickIncidents` 의 한 줄 |
| 포화되는 상태 | 혼잡 ≤ 3 · 밀림 ≤ 1 · 우회 몰림 ≤ `DIV_MAX` · 구조 손상 ≤ 1 · 구역 값은 덮어쓰기(`min`/`max`)지 누적이 아니다. 모든 값에 회복이 있다(정전은 원인이 끝나지 않아도 600초 — C4. 금 `shake` 만 교대 안에서 남는다) | 각 모델 |
| 순환 금지 | 구역 상태끼리는 한 방향만: 정전 → 통신(C4 → C8). 통신·연기는 정전·화재를 만들지 않는다 | §3.7 |
| 이야기 연쇄 | 그대로(`canChain`) | Z1 |

**되먹임의 크기(조사 2026-11-20 — 어림)**: 사고 하나가 만드는 초과 혼잡은 약 2,000~2,600 구간·초이고 평소 교대 전체가 약 18,000(태풍 33,000)이다. L1 의 세기를 "평소 교대에 사고 0.4건"(`A_ROAD = 2.5e-5`)으로 두면 사고 하나가 다음 사고를 낳을 기대값은 0.04~0.08 — **1 아래라 상한 없이도 잦아드는 고리**이고, 상한은 꼬리만 자른다. 불의 번짐(L2)은 한 뿌리에서 뿌리 포함 건물 셋까지, 충격(L3)은 전체 붕괴 한 번에 틈 15 안의 1.4채, 폭발 한 번에 벽을 맞댄 0.8~1.4채만 닿는다(§3.6c). b5 가 이 기대값을 실제로 잰다(§4 `hazard.gain`).

테스트(§6)와 I1-a 관문 M-G3(I1-b 뒤 3으로 낮춘다 — 실제 최대 깊이는 2)이 지킨다.

### 3.6a 초과 위험 과정 — 상태가 사건을 낳는 하나뿐인 길

**생각.** 평소 생성기는 그대로 둔다(자기 흐름 `sim.rngGen`, 그 호출 순서를 건드리지 않는다). 상태가 평소 수준보다 올린 만큼의 **초과 위험률** `λ(t)`(초당 기대 사건 수)를 대상(구간·건물)마다 따로 적분하고(`H = ∫λ dt`), 대상마다 한 번 뽑아 둔 문턱 `E = −ln(1 − u)` 를 넘으면 사건이 난다. 이것은 위험률 `λ(t)` 의 비균질 푸아송 과정을 역변환으로 뽑는 것과 같다 — 평소 과정에 독립인 과정을 겹친 것이라 "혼잡할수록 사고가 잦다"와 같은 말이고, 틱마다 주사위가 없다. 양이 쌓여 넘는 꼴(열 노출이 그 건물의 발화 문턱을 넘는다)과 한 번의 충격(폭발의 불티, 정전 순간 운행 중이던 승강기)도 같은 칸에 `H` 를 더해 같은 문턱과 견준다.

**틀** — 새 파일 `src/sim/world/hazard.ts`(진실 쪽. **등록이 없는 파일**이다 — §3.4. `types`·`chain`·`rng`·`world/state` 와 `incidents` 의 **형만** import 한다: `incidents.ts` 의 함수를 import 하면 순환이 생긴다 — 쓸 수 있는 건물인가는 `placeState().usable` 로 본다. `consequence.ts` 가 이 파일을 import 하므로 `CSQ_SPAWN_CAP` 은 이 파일로 옮기고 `consequence.ts` 가 다시 내보낸다):

```ts
export const CSQ_SPAWN_CAP = 6;                                  // b2 의 것을 옮긴다 (consequence.ts: export { CSQ_SPAWN_CAP } from './hazard')
export const HZ = { HOLD: 60, PARENT_SHARE: 1 / 3, ORPHAN_CAP: 3, ROOT_MAX: 2, SRC_MAX: 3, LATE: 150 };      // 모두 첫 값
/** 이번 주기에 한 대상의 초과를 이루는 몫 하나. rate = 초당 초과 위험 (≥ 0) */
export interface HzPart { rate: number; ev: number; inc: number; what: HzWhat; ref: number }
export interface HazardLaw {
  id: HazardLawId; label: string;            // 'roadCrash' · '몰린 길의 사고' (보고서의 교대 요약이 label 을 쓴다)
  every: 1 | 12;                             // 1 = world tick(1초)마다 · 12 = 교통 모델이 혼잡을 다시 계산한 뒤 한 번(traffic.driftAt 이 바뀌었을 때)
  once: boolean;                             // 대상마다 교대에 한 번 — 한 번 넘은 대상은 끝이다(아래 "once 법칙")
  cap: number;                               // 이 법칙이 만든 사건의 교대 상한 (만든 것 + 예약 + 기다리는 것)
  hold?: number;                             // 문턱을 넘고 자리를 기다리는 마감(초). 없으면 HZ.HOLD
  /** 초과가 있는 대상을 내놓는다. put 은 대상마다 한 번, parts 는 다시 쓰는 버퍼여도 된다(틀이 필요할 때 복사한다). 초과가 0 인 대상은 내놓지 않는다.
   *  충격만 받는 법칙(L5·L7)은 scan 이 없다 */
  scan?: (sim: Sim, put: (target: number, parts: HzPart[]) => void) => void;
  /** 문턱을 넘은 대상에서 날 사건의 유형·변형·규모·자리·첫머리. null = 지금은 만들 수 없다(그 자리에 열린 사건이 있다 따위 — 기다린다).
   *  parent·cause·causes·csq·hz·rng 는 틀이 채운다. 난수를 쓰지 않는다 — 내용이 갈리는 곳은 cell.u2 로 */
  spawn: (sim: Sim, target: number, cell: HzCell, main: HzPart, total: number) => SpawnOpts | null;
}
export function registerHazard(law: HazardLaw): () => void;      // 등록 순서 = 훑는 순서 = 결과. 돌려주는 함수는 등록을 거둔다(시험용)
export function hazardLaws(): readonly HazardLaw[];
export function hazardLabel(id: string): string | null;          // b4 의 보고서 — consequenceLabel 이 null 이면 이것을 본다
export function tickHazards(sim: Sim): void;                     // tickWorld 의 1초 블록에서: 'tick' 규칙 다음, recoverWorld 앞
/** 한 번의 충격을 같은 칸에 더한다 (폭발의 불티 · 정전 순간 · 닫힌 화재의 잔열). 넘으면 그 자리에서 아래 "넘은 자리의 처리"를 한다 */
export function hazardImpulse(sim: Sim, law: HazardLawId, target: number, dH: number, part: HzPart, delay = 0): void;      // delay = 넘었을 때 사건까지 미루는 초 (L7 의 닫힌 꼴)
export function hazardCell(sim: Sim, law: HazardLawId, target: number): HzCell | null;      // 읽기 (시험·측정)
export function ruleLoad(sim: Sim, rule?: string): number;       // 규칙·법칙이 만든 사건 + gen.chain 의 예약 + 기다리는 줄 (§3.6). rule 을 주면 그 규칙·법칙의 것만
export function hazardRoom(sim: Sim, law: HazardLaw, parent: number | undefined): DroppedChain['why'] | null;
```

**한 주기** — `tickHazards` 는 1초마다 ① 기다리는 줄을 먼저 보고 ② 법칙을 등록 순서로 돈다(`every: 12` 인 법칙은 `sim.traffic.driftAt !== world.hz.roadAt` 일 때만, `dt = 12`):

1. **기다리는 줄**(`world.hz.waiting` — 아래 "기다리는 줄")을 넣은 순서로 훑는다. `every: 12` 인 법칙과 `scan` 이 없는 충격 법칙의 것도 이 길로 1초마다 다시 본다.
2. `law.scan` 이 내놓는 대상마다 칸을 찾는다. 없으면 만든다: `r = sim.rng.fork('hz:' + law.id + ':' + target + (law.once ? '' : ':' + n))`, `thr = −Math.log(1 − r.next())`, `u2 = r.next()`, `H = 0`, `n = 0`, `done = false`. **문턱의 흐름 이름에는 경로에 따라 달라지는 것(시각·시도 횟수·전역 순번)이 없다.** `cell.done` 이거나 그 대상에 기다리는 줄이 있으면 건너뛴다(적분하지 않는다 — 위험은 이미 실현돼 자리를 기다리는 중이다).
3. `since < 0` 이면 `since = sim.t`. `rate = Σ parts.rate`, `dH = rate × dt`.
4. `H + dH < thr` 면 `H += dH` 하고 끝. 아니면 **넘었다** → 아래 "넘은 자리의 처리". **넘은 시각은 보간하지 않는다 — `at = sim.t`**(12초 눈금은 관찰에 드러나지 않고, 귀속에 쓴 몫과 사건의 시각이 같아지며, 예약과 사건 사이에 그 자리의 사정이 바뀌는 틈이 없다). `once` 가 아닌 법칙은 넘친 몫 `H + dH − thr` 를 다음 문턱(`n + 1` 의 흐름)을 향해 남긴다(`H = H + dH − thr`, `n++`, 새 문턱 — 사건을 예약했든 버렸든 기다리게 했든 같다).
5. 지난 주기에는 초과가 있었는데(`world.hz.live[law]`) 이번에 나오지 않은 대상: `since = −1`. **`H` 는 그대로 둔다**(초과가 0 이면 적분이 멎을 뿐이다 — 식지 않는다. 푸아송 과정의 누적 위험과 같다).

**once 법칙은 한 번 넘으면 끝이다.** 사건을 예약했든, 상한·교대 끝으로 버렸든, 기다리다 마감이 지났든, 원인 기록이 없어 구멍으로 셌든 `cell.done = true` 이고 그 뒤로 그 대상은 적분도 충격도 받지 않는다(흐름 이름에 번호가 없어 다시 뽑아도 같은 문턱이다 — L7 처럼 `H` 가 문턱의 몇 배면 `H −= thr` 뒤에도 곧바로 다시 넘는다). 아래 표의 "`H −= thr`, `n++`, 다음 문턱"은 `once` 가 아닌 법칙에만 해당한다.

**넘은 자리의 처리** — 이 순서로:

1. **귀속**(아래). 모든 몫의 `ev < 0` 이면 사건을 만들지 않고 `holes++` — 버린 것과 같게 끝낸다(같은 문턱에 걸려 주기마다 구멍이 늘지 않게).
2. `hazardRoom(sim, law, parent)` 이 까닭을 주면 버린다(`gen.dropped` 에 그 까닭 — 기록은 남기지 않는다).
3. 열린 사건이 `tune.maxConcurrent` 를 넘거나 `law.spawn(…)` 이 `null` 이면 **기다리는 줄**에 넣는다.
4. **건물에 내는 사건의 공통 조건**(틀이 본다 — 법칙마다 쓰지 않는다): `law.spawn` 이 `placeId` 를 돌려주면 ① `placeState(sim, placeId)?.usable === false`(전소·전체 붕괴)면 버린다(`'expired'`), ② 그 건물에 열린 사건이 있으면(`I.phase !== 'closed' && I.truth.placeId === placeId`) `spawn` 이 `null` 을 준 것과 같게 기다린다. 까닭: `createIncident` 는 정해 준 건물이 `placeGone` 이면 그 유형의 다른 건물을 다시 고른다(X6 §7.1) — 그 갈래를 법칙 사건이 타면 원인은 옆 건물의 불·정전인데 자리는 무관한 건물인 기록이 남는다(가짜 기록). 그래서 `tickIncidents` 가 예약을 꺼낼 때도 `c.opts.hz !== undefined && c.opts.placeId !== undefined && placeGone(sim, c.opts.placeId)` 면 만들지 않고 `'expired'` 로 버린다. **건물 법칙이 만든 사건의 `truth.placeId` 는 언제나 `hz.target` 이다**(시험).
5. 예약(아래 "귀속"의 끝 줄).

**`hazardRoom`** — 위에서부터, 걸리는 첫 줄의 까닭을 돌려준다:

| 순서 | 조건 | 까닭 |
|---|---|---|
| 1 | 교대 끝 `HZ.LATE`(150초) 안 | `'late'` |
| 2 | `ruleLoad(sim) ≥ CSQ_SPAWN_CAP`(규칙·법칙이 만든 사건 + 기다리는 예약) · `ruleLoad(sim, law.id) ≥ law.cap` | `'cap'` |
| 3 | 부모가 있고 `chainLen(부모) ≥ CHAIN_MAX`(한 사슬 3건 — `chain.canChain` 의 첫 조건) | `'depth'` |
| 4 | 부모가 있고, 그 부모의 뿌리(부모를 끝까지 거슬러 올라간 사건)를 뿌리로 둔 법칙 사건(만든 것 + 예약 + 기다리는 것)이 `HZ.ROOT_MAX`(2) 이상 | `'depth'` |
| 5 | `chainedInShift(sim)`(부모 있는 사건 — 이야기 연쇄와 부모 있는 법칙 사건, 예약 포함) + 부모 없는 법칙 사건(만든 것 + 예약) + 기다리는 줄 전부 `≥ CHAIN_SHIFT_MAX`(한 교대 6건) | `'cap'` |
| 6 | 부모가 없고 부모 없는 법칙 사건이 `HZ.ORPHAN_CAP`(3) 이상 | `'cap'` |

세는 법은 모두 `ruleLoad` 와 같다(`world.log` 에서 `made ≥ 0` 인 줄 + `gen.chain` 에 남은 그 법칙의 예약 + `world.hz.waiting`) — 따로 세는 칸을 두지 않는다. 그래서 `tickIncidents` 가 `'busy'`·`'late'` 로 버린 예약의 자리는 전체에서도 법칙별로도 돌아온다.

**평소 수준과 초과.** 초과는 법칙마다 "평소면 정확히 0"인 식으로 잰다: 도로는 혼잡 값끼리의 차가 아니라 원인 항(통제에서 온 밀림·우회 몰림·병목·인파·꺼진 신호 — §3.6b), 건물은 문턱 유속을 넘는 열(§3.7 L2), 평소 응급률에 곱하는 상대 위험에서 1 을 뺀 값(L4). 잡음(`drift` 의 ±0.1)과 뒤처짐(×0.35)이 낀 `e.cong − 기준` 으로 재면 0 이 되지 않아 교대 내내 모든 구간이 위험을 쌓는다. **그래도 평소 교대에 초과는 늘 있다**(조사: 보통 S7 에서 12초 표본마다 평균 18구간 — 정체·공사·평소 사고의 감속에서 온 밀림). 그것은 평소의 교통 사건이 만든 **상태**이고 법칙은 원인을 가리지 않으므로, L1 은 재난도 대형 사고도 없는 교대에서도 드물게 사고를 낸다(목표: 교대당 0.2~0.5건). 그래서 보장은 교대 단위가 아니라 대상 단위다 — "초과가 0 인 대상의 적분은 늘지 않는다", "문턱을 넘지 않은 법칙은 기록도 난수도 남기지 않는다".

**귀속 — 사건의 `cause`·`causes`·`parent`.** 겹친 푸아송 과정에서 난 사건이 몫 i 의 것일 확률은 **그 순간의** `λᵢ / Σλ` 다(쌓인 양의 비가 아니다 — 오래전에 지나간 통제가 지금의 사고를 낳았다고 쓰지 않는다). 그래서 내력은 **넘는 순간의 몫**(`scan` 이 그 주기에 내놓은 `parts`)으로 정한다. 주사위를 굴리지 않고 가장 큰 몫을 주된 원인으로 둔다:

- 몫을 **`rate` 큰 순으로만**(같으면 `ev` 작은 순) 줄 세운다. 기록이 없는 몫(`ev < 0`)을 뒤로 보내지 않는다 — 초과의 80% 가 장부 없는 상태인데 20% 짜리 기록을 주된 원인으로 쓰면 틀린 내력이다.
- **`cause`** = `ev ≥ 0` 인 가장 큰 몫의 기록. **`causes`** = 그 밖의 `ev ≥ 0` 인 몫들의 기록(많아야 `SRC_MAX − 1`) — "통제 + 꺼진 신호"가 둘 다 발생 기록의 원인으로 이어진다.
- **장부의 구멍 `world.hz.holes`**: 전체의 `PARENT_SHARE`(1/3) 이상인 몫 가운데 하나라도 `ev < 0` 이면 `holes++` 한다. 사건은 만든다 — `hz.src` 에 그 몫을 `ev: −1` 그대로 남기고 보고서 문장에 "(까닭이 기록되지 않은 혼잡도 겹쳤습니다)"가 붙는다. **모든** 몫이 `ev < 0` 이면 사건을 만들지 않는다(원인 없는 인과 사건은 만들지 않는다). 테스트와 관문이 `holes = 0` 을 지킨다.
- **`parent`** = 주인 사건이 있는(`inc ≥ 0`) 몫 가운데 가장 큰 것의 사건 — 다만 그 몫이 전체의 `PARENT_SHARE` 이상일 때만. 아니면 부모가 없다(정체·공사·인파·재난에서 온 초과가 대부분인 사고에 지나가던 사건을 부모로 붙이지 않는다). 부모는 닫힌 사건이어도 된다(사건 뒤에 남은 잔해가 길을 막은 동안의 사고, 통제가 풀린 뒤 아직 밀려 있던 길의 사고).
- **`csq`** = 법칙 id. **`hz`** = `{ law, target, at, src }` — `src` 는 큰 몫부터 `SRC_MAX` 개의 `{ ev, inc, w: rate, what, ref, since }`. **`since` 는 몫마다 따로다**: 그 몫이 이 대상에 처음 걸린 시각 = `max(cell.since, 그 기록의 시각 sim.events[ev].t)`(`ev < 0` 이면 `cell.since`). 문장의 "약 N초"는 그 몫의 `at − since` 다 — 정체로 200초 전부터 초과가 있던 구간에 50초 전 통제가 생겨 우회 몰림이 주된 몫이 됐을 때 "통제 뒤 250초"라고 쓰지 않는다.
- 예약: `sim.gen.chain.push({ at: sim.t, opts: { ...law.spawn(…), parent, cause, causes, csq: law.id, hz, rng: sim.rng.fork('hz-spawn:' + law.id + ':' + target + ':' + n) }, log })` — `n` 은 넘은 순번(늘리기 전의 `cell.n`), `log` 는 `world.log` 에 넣은 줄 `{ rule: law.id, t, ev: cause, inc: parent ?? −1, made: −1, depth }`(사건이 되면 `tickIncidents` 가 `made` 를 채운다 — b2 그대로). **사건을 만드는 흐름 이름도 전역 순번이 아니라 (법칙, 대상, 몇 번째)** 다 — 앞의 다른 사건이 사라져도 이 사건의 내용은 같다(`spawnConsequence` 의 `csq-spawn:<규칙>:<world.spawned>` 는 그렇지 못해 법칙에는 쓰지 않는다).
- `tickWorld` 바로 다음이 `tickIncidents` 라 예약은 같은 틱에 사건이 된다. 교대 끝·부하·깊이의 마지막 확인과 `gen.dropped` 는 `tickIncidents` 가 지금처럼 한다.

**문턱을 넘었는데 만들 수 없을 때 — 버리는가 미루는가.**

| 까닭 | 하는 일 | 적분값 (`once` 가 아닌 법칙 — `once` 면 그 대상은 끝) |
|---|---|---|
| 사슬 길이·한 뿌리의 가지(`'depth'` — `hazardRoom` 3·4) | **버린다.** `gen.dropped` 에 `'depth'`(기록은 남기지 않는다). 되먹임의 고리가 끊기는 자리다 — 다른 몫으로 부모를 바꿔 달아 상한을 비켜 가지 않는다 | `H −= thr`, `n++`, 다음 문턱을 새로 뽑는다(사건이 난 것과 같게) |
| 교대 상한(`'cap'` — `hazardRoom` 2·5·6) | **버린다.** `'cap'` | 같다. 실제로 사건이 된 수만으로 `CSQ_SPAWN_CAP` 에 닿았으면 그 교대의 `tickHazards` 는 첫 줄에서 돌아온다(자리는 다시 나지 않는다) |
| 교대 끝 150초 안(`'late'`) | **버린다.** | 같다 |
| 쓸 수 없는 건물(전소·전체 붕괴 — `'expired'`) | **버린다.** | 같다 |
| 부하(열린 사건 > `tune.maxConcurrent`) · 그 자리에 지금은 사건을 낼 수 없음(`law.spawn` 이 `null`, 그 건물에 열린 사건이 있다) | **기다리는 줄에 넣는다**(아래) | 넘은 것으로 친다(같다). 줄에 있는 동안 그 대상은 적분하지 않는다 |

**기다리는 줄** — `world.hz.waiting: HzWait[]`(§3.3). 한 줄은 `{ law, target, n, until: sim.t + (law.hold ?? HZ.HOLD), parts: 넘는 순간의 몫의 사본, total }`. `tickHazards` 는 1초마다 법칙을 돌기 전에 이 줄을 넣은 순서로 훑는다: `hazardRoom` 이 까닭을 주면 버리고(그 까닭), `until` 이 지났으면 `'expired'`, 부하가 풀렸고 `law.spawn` 이 사건을 주고 건물 조건을 지나면 **적어 둔 사본으로** 귀속해 예약한다(`at = sim.t`). **그 대상의 초과가 끝났다는 것만으로는 버리지 않는다** — 위험은 넘는 순간에 실현됐고, 기다림은 시뮬레이션의 자리 문제다(불이 꺼진 뒤 원인 사건이 닫히기를 기다리는 옮겨붙은 불이 그 예다 — 자리가 났을 때는 원인이 이미 사라져 `scan` 의 몫이 비어 있다). 한 대상에는 줄이 하나뿐이다. 줄을 다시 볼 때의 `hazardRoom` 은 **그 줄 자신을 빼고** 센다(자기 자리 때문에 상한에 걸려 버려지지 않게).

미루는 까닭: 부하와 "그 자리가 바쁘다"는 물리가 아니라 시뮬레이션의 처리 한도다. 재난의 충격 단계에는 열린 사건이 한도를 넘는 일이 잦아(재난 큐는 +4 까지 연다) 버리기만 하면 법칙의 사건이 거의 다 사라진다. 마감(기본 60초) 안에 자리가 나지 않으면 그 위험은 실현되지 않은 것으로 친다. 상한에 걸린 것을 미루지 않는 까닭: 상한은 사용자 결정이고 교대 안에서 다시 열리지 않는다 — 쌓아 두면 교대 끝에 몰려 터진다.

**충격**(`hazardImpulse`): 칸을 찾아(없으면 만든다. `done` 이면 돌아온다) `H += dH`, 넘으면 그 `part` 하나를 몫으로(`rate` 자리에는 틀이 `dH` 를 넣는다 — 몫의 비를 따질 것이 하나뿐이다) "넘은 자리의 처리"를 그 자리에서 한다. `delay` 를 주면 예약의 `at = sim.t + delay` 이고 `when: () => law.spawn(…) !== null && 건물 조건`, `until: at + (law.hold ?? HZ.HOLD)` 를 붙인다(§3.5 — 미룬 동안 그 자리의 사정이 바뀔 수 있다).

**주기와 비용.** 한 주기에 훑는 대상의 상한(법칙이 `scan` 안에서 지킨다 — 가까운 것부터 자른다):

| 법칙 | 주기 | 대상 수 (상한) | 비고 |
|---|---|---|---|
| L1 `roadCrash` | 12초(교대당 100번) | 구간 257 | 몫은 교통 모델이 `drift` 에서 이미 계산해 둔 배열을 읽는다 |
| L2 `heatSpread` | 1초 | 큰 불 현장(≤ 6) × 이웃 건물(≤ 8) = 48 | 이웃 목록은 건물마다 처음 한 번(0.14ms) 만들어 모듈에 둔다 |
| L3 `structFail`·`pipeLeak` | 1초 | 손상된 건물 ≤ 16 | |
| L4 `smokeIll` | 1초 | 연기 자리(≤ 3) × 주거 건물(≤ 40) = 120 | **연기 자리가 생기거나 반경이 바뀔 때만** 그 자리의 대상 목록(건물 id·거리)을 만들어 그 자리의 상태에 둔다. 농도는 건물마다 `zoneAt` 을 부르지 않고 그 자리의 세기 × (1 − 거리 / r) 로 바로 계산한다(매초 1,262채에서 고르면 큰 불이 이어지는 교대에 10ms 안팎 — 예산의 절반이다) |
| L7 `rekindle` · L5 `liftStall` | 사건이 있을 때만 | — | 닫힌 꼴의 식과 충격이라 매초 도는 것이 없다 |
| 기다리는 줄 | 1초 | 보통 0~3 | `law.spawn` 한 번씩 |

합쳐 **1초에 200 대상·몫 계산 아래**(곱셈 몇 번씩)다. 예산은 §4 의 "교대당 시간" 줄(틀과 교통의 몫 × 1.03 이하 — `sweep 12 --no-metrics` 를 앞 단계와 번갈아 세 번, 사용자 CPU 로 본다). 법칙이 하나도 등록되지 않았거나 실제로 만든 사건이 `CSQ_SPAWN_CAP` 에 닿았으면 첫 줄에서 돌아온다. `tickHazards` 안에서 `findRoute`·`astar` 를 부르지 않는다(모듈 버퍼 — CLAUDE.md "공유 버퍼").

**개입 시험이 성립하는 까닭과 그 한계.** 문턱 `thr` 은 (시드, 법칙, 대상, 몇 번째)만의 함수다. 한 대상에서 k 번째로 **문턱을 넘는 시각**은 누적 위험이 `thr₁ + … + thr_k` 에 닿는 때이므로, 그 대상의 위험률이 모든 시각에서 줄어드는 한 그 시각은 **늦어지거나 없어질 뿐 빨라지지 않는다.** 한계 셋: ① 사건 단위로는 성립하지 않는다 — 상한·대기에 걸러지므로, 원인이 있는 쪽에서 상한에 버려진 넘음이 원인을 지운 쪽에서는 사건이 될 수 있다. ② 원인을 지운다고 모든 대상의 위험률이 줄지는 않는다 — 통제를 풀면 그 구간 자신은 닫힌 구간(초과 0)에서 차가 다니는 구간이 되어 다른 원인의 초과를 받고, 다른 통제의 우회로가 그 구간을 지나게 바뀐다. ③ 교대 전체로는 사건 하나가 사라지면 사건 번호가 밀려(`scene:<I.id>`·`call:<I.id>` 흐름) 뒤 현장이 달라지고, 평소 생성기의 간격(`avail`·열린 사건 수)과 교통 사건의 후보(`!e.closed`)도 달라진다. 그래서 시험은 **사건을 지우지 않고 상태만 지우고, 다른 원인을 얼리고, 그 원인이 올리던 대상만 견준다**: 같은 시드의 두 `Sim` 을 같은 틱까지 돌린 뒤 한쪽에서만 그 원인이 길에 만든 상태(`e.closed`·`closedReason`·`e.slow`)를 되돌린다. **원인 장부는 손대지 않는다** — 장부는 상태를 보고 스스로 비워져야 하고, 장부를 지우면 "그 원인의 사건이 없다"가 위험이 그대로여도 참이 된다(§6 I1-b 10).

### 3.6b 교통 모델에 넣는 일반 규칙 (`traffic.ts`) — 우회 몰림과 초과 혼잡의 장부

지금의 `traffic.drift`(12초마다)는 **뒤로 밀림**만 한다: 닫힌 구간·사고 구간(`slow ≥ 1`)·꽉 찬 구간(`press ≥ 2.4`)의 양 끝에 붙은 구간의 `queue` 가 12초에 +0.14(고속 절반), 한 다리 건너는 0.5 까지 오르고 `target = press + 1.2 × queue` 가 된다. **없는 것**: 막힌 길을 지나던 차가 우회로로 옮겨 가는 것 — 우회로의 가운데 구간에는 아무 일도 없다(가장 빠른 우회로는 평균 3.9~5.3구간이다). 쓰러진 나무의 `cong + 0.7`(`incidents.ts` 의 `variant === 'tree'` 블록)은 이 빈자리를 손으로 메운 한 줄이다. 일반 규칙으로 바꾼다.

**(가) 우회 몰림** — `drift` 안, 밀림 계산 다음:

```ts
// TrafficState 에 더하는 칸 (initTraffic 의 리터럴에 — 모두 구간 수 길이)
divert: Float32Array; divertBy: Int32Array;         // 우회로로 몰린 양 · 가장 크게 보탠 닫힌 구간 (-1)
detours: Map<number, number[]>; detourSig: string;  // 닫힌 구간 → 우회로의 구간들. 닫힌 구간의 집합이 같으면 다시 쓴다(linkCache 처럼)
```

- 실제로 닫힌 구간 c 마다(`e.closed` — 까닭과 `known` 을 가리지 않는다: 시민의 차는 가서 보고 돌아선다. 사고 통제·쓰러진 나무·전면 공사·낙하물·잔해·재난 통제 모두) c 를 뺀 a→b 최단 길을 구한다. 비용은 `throughFlow` 가 쓰는 고정 비용 `(len / speed) × (1 + (baseCong − 1) × 0.5)`(그 계산을 모듈 함수 `staticCost(city)` 로 뽑아 함께 쓴다), 닫힌 구간은 지나지 않는다. **혼잡(`cong`)으로 재지 않는다** — 몰림이 비용을 올려 길이 12초마다 바뀌는 떨림을 막는다. 다익스트라는 `traffic.ts` 안의 자기 버퍼로(`findRoute` 를 쓰지 않는다 — 그것은 알려진 통제만 피하고 혼잡을 읽는다).
- 그 길의 구간 e 마다 `divert[e] += DIV_K × vol(c) / LANES[e.cls]`, `vol(c) = LANES[c.cls] × (0.25 + flow[c])`(`flow` = `throughFlow` — 모든 교차로 쌍의 최단 길이 지나는 횟수 0..1). 첫 값 `LANES = { highway: 3, arterial: 2, street: 1, local: 0.6 }`, `DIV_K = 0.8`, `DIV_MAX = 1.0`. 모양: 간선(flow 0.45)이 막히면 일반 도로 우회로가 상한까지 차고, 이면 도로가 막히면 간선 우회로에 +0.07.
- `target = clamp(press + 1.2 × queue + min(DIV_MAX, divert), 1, 3)`. **`divert` 는 `press` 가 아니라 `target` 에 더한다** — `press` 에 넣으면 2.4 를 넘겨 새 밀림의 뿌리가 되고 밀림이 밀림을 낳는다. `divert` 는 `drift` 마다 지금 닫힌 구간에서 다시 계산한다(상태를 쌓지 않는다 — 통제가 풀리면 다음 `drift` 에 0 이고 `cong` 은 35%씩 따라 내려간다).
- 우회로가 없는 구간(257 가운데 19)은 몰리는 길이 없다. 난수 호출 수는 그대로다(구간마다 `rng.range` 한 번).
- **쓰러진 나무의 `+0.7` 한 줄을 지운다.**
- **결과가 바뀌는 범위**: `cong` → `edgeTime` → 대응 시간이 **닫힌 구간이 있는 모든 교대**에서 바뀐다(사실상 전부. 한 번에 닫힌 구간은 평균 0.6(보통)~1.7(태풍)개). 긴급 차량도 몰린 우회로에서 늦어진다 — 의도한 결과다(사용자에게 확인할 것, §9). 한 단계로 떼어 기준을 다시 잰다(b3-5 ②). 상수는 추측이다 — 재는 법: 읽기 전용 표본으로 닫힌 구간마다 우회로 구간의 `cong` 최댓값과 지속 시간을 찍고, `sweep 60` 의 평균 대응이 기준 +3초 안, `TRAFFIC_DELAY` 가 기준 × 1.3 안이 되게 `DIV_K`·`DIV_MAX` 를 맞춘다.

**(나) 초과 혼잡과 그 장부** — 같은 `drift` 가 구간마다 적어 둔다(읽는 곳은 L1 과 측정뿐 — 이 칸들만으로는 결과가 바뀌지 않는다). **장부는 구간마다 한 칸이 아니라 초과의 항마다 주인을 둔다** — 한 칸이면 쓰러진 나무의 통제 기록을 뒤에 남는 발생 기록의 감속이 덮고, 사고 감속이 걸린 구간의 한 차로 장애물이 사고가 끝난 뒤에도 그 사고를 주인으로 갖는다.

```ts
base: Float32Array;                                  // 평소 수준 = clamp(baseCong × tod × trafficMul + 불법 주차의 병목 0.4, 1, 3). 불법 주차가 치워지면(하나 남은 길을 막게 돼 견인 — tickTraffic 의 last 갈래) 그 drift 에서 다시 적는다. 그 밖에는 교대 내내 같다
exOwn: Float32Array; exBump: Float32Array; exQueue: Float32Array; exDiv: Float32Array;   // 초과의 네 몫
excess: Float32Array;                                // 네 몫의 합 (닫힌 구간은 0)
// 항마다의 주인 (기록 · 주인 사건, 없으면 -1)
closeEv: Int32Array; closeInc: Int32Array;           // 닫힘의 주인 — e.closed 가 거짓인 구간은 drift 가 지운다
slowEv: Int32Array; slowInc: Int32Array;             // 사건의 현장 감속(slow ≥ 1)의 주인 — slow < 1 이면 drift 가 지운다
levelEv: Int32Array;                                 // 물이 차올라 느려진 구간(재난의 slow 0.8)의 기록 — floodRoads 가 느림을 걸 때 적고 거둘 때 지운다
//   한 차로 병목의 주인은 그 장애물의 Obstacle.ev (b3-3 의 칸 — announce 가 기록 id 를 돌려주게 해서 모든 장애물에 채운다), 정체의 주인은 tr.jams[k].ev (정체 객체에 칸을 더한다 — 리터럴에 함께)
// 밖에서 얹은 혼잡(bump) — 얹은 건마다 한 줄
bumps: { id: number; edges: number[]; add: number; ev: number; inc: number; what: 0 | 1 | 2 }[];      // what: 0 인파 · 1 꺼진 신호 · 2 연기
// 밀림의 내력 — 밀린 구간 쪽에 복사해 둔다
qBy: Int32Array; qEv: Int32Array; qInc: Int32Array;  // 이 구간의 밀림을 만든 뿌리 구간 · 그 뿌리의 기록 · 주인 사건 (-1)
driftAt: number;                                     // 마지막으로 다시 계산한 시각 (L1 이 한 번만 적분하게)
export function noteRoadCause(sim: Sim, edge: number, term: 'close' | 'slow' | 'level', ev: number, inc?: number): void;   // 구간의 상태를 바꾸는 자리가 부른다 (ev −1 = 지운다 — 'level' 만 쓴다)
export function noteBump(sim: Sim, edges: number[], add: number, ev: number, what: 0 | 1 | 2, inc?: number): number;        // 장부 한 줄만 (id 를 돌려준다) — e.bump 는 고치지 않는다
export function unnoteBump(sim: Sim, id: number): void;                                                                    // 그 줄을 지운다 (한 번만 — 없는 id 면 아무 일도 없다)
export function addBump(sim: Sim, edges: number[], add: number, ev: number, what: 0 | 1 | 2, inc?: number): number;         // 구간마다 e.bump += add 하고 noteBump
export function removeBump(sim: Sim, id: number): void;                                                                    // 그 줄의 구간·양 그대로 빼고(1e-6 아래는 0) unnoteBump
export function roadFlow(sim: Sim): Float32Array;                                                                          // = throughFlow (지금은 모듈 안 함수 — 내보낸다)
export function canBlock(sim: Sim, e: RoadEdge, dry?: boolean): boolean;                                                   // disaster.detour 를 옮긴 것 — (다)
```

| 몫 | 값 | 평소에 0 인 까닭 | 내력(`HzPart`) |
|---|---|---|---|
| `exOwn` | 한 차로 장애물의 병목 0.9(공사·고장 차량·한 차로 잔해) + 정체 중이면 `max(0, 2.8 − 정체 없는 press)` + 물이 차올라 느려진 구간(`levelEv ≥ 0`)이면 0.8 | 불법 주차의 0.4 는 교대 내내 있어 `base` 에 넣었다 | 항마다 하나: `'lane'` = 그 장애물의 `ev`(주인 사건은 잔해면 그 기록의 원인이 가리키는 사건 — b3-3 의 `blockRef` 와 같은 길, 그 밖에는 −1) · `'jam'` = 그 정체의 `ev` · `'level'` = `levelEv`. `ref` = e |
| `exBump` | `e.bump`(행사 인파 0.8 · 태풍 정전 0.4 · C4 의 꺼진 신호 · C5 의 연기) | 얹은 것이 없으면 0 | **그 구간을 담은 `bumps` 줄마다 하나**(`rate` 는 `add` 의 비로 나눈다): 그 줄의 `ev`·`inc`, `'crowd'`/`'dark'`/`'haze'` |
| `exQueue` | `qBy[e] ≥ 0` 이면 `1.2 × queue[e]`, 아니면 0 | **원인이 있는 뿌리**에서 온 밀림만 센다(아래) | `qEv[e]`·`qInc[e]`, `'queue'`, `ref` = `qBy[e]`(뿌리 구간) |
| `exDiv` | `min(DIV_MAX, divert[e])` | 닫힌 구간이 없으면 0 | `closeEv[divertBy]`·`closeInc[divertBy]`, `'divert'`, `ref` = 닫힌 구간 |

- 네 몫의 합이 `3 − base[e]`(혼잡의 상한까지의 여유)를 넘으면 같은 비로 줄인다. 닫힌 구간은 차가 다니지 않으므로 네 몫 모두 0.
- **뿌리의 두 갈래.** 원인 항을 뺀 압력 `p0 = baseCong × tod × trafficMul + 불법 주차의 병목`. **평소의 뿌리** = 닫히지 않았고 `slow < 1` 이며 `p0 ≥ 2.4` 인 구간 — 무엇이 얹혀 있든 그 밀림은 얹힌 것이 없어도 있었다(교통 손잡이가 높을 때의 상업 간선). **원인이 있는 뿌리** = 닫힘 · `slow ≥ 1` · (`p0 < 2.4` 인데 `press ≥ 2.4` — 병목·`bump`·정체가 넘긴 것). 구간의 이웃에 평소의 뿌리가 하나라도 있으면 그 구간의 밀림은 **평소의 것**이다(`exQueue = 0`, `qBy = −1` — 밀림은 뿌리가 하나만 있어도 같은 속도로 찬다. 평소에도 있었을 밀림을 원인 탓으로 돌리지 않는다).
- **밀림의 내력은 밀린 구간 쪽에 복사해 둔다.** 구간이 원인 있는 뿌리에 닿아 있는 `drift` 마다 `qBy[e]`(이미 정해져 있고 그 뿌리가 아직 뿌리면 바꾸지 않는다 — 먼저 뿌리가 된 쪽. 아니면 이웃 목록 순서로 처음 만나는 원인 있는 뿌리)와 함께 `qEv[e]`·`qInc[e]` = 그 뿌리를 뿌리로 만든 항의 주인(닫힘이면 `closeEv`, 감속이면 `slowEv`, 정체면 그 정체의 `ev`, 병목이면 장애물의 `ev`, `bump` 로만 찼으면 가장 큰 `bumps` 줄)을 적는다 — **뿌리의 값이 −1 이면 앞의 값을 지우지 않는다.** 한 다리 건너는 많이 밀린 그 이웃의 `qBy`·`qEv`·`qInc` 를 물려받는다. `queue[e]` 가 0 이 될 때 셋 다 −1. 까닭: 밀림은 뿌리가 풀린 뒤에도 12초마다 ×0.75 로 줄어 0.01 아래가 될 때까지 14~17번(약 3분) 남는데 뿌리의 주인은 풀린 첫 `drift` 에 지워진다. 뿌리의 장부를 그때그때 읽으면 그 꼬리의 몫이 `ev = −1` 이 되어, 그때 문턱을 넘으면 사건 없이 구멍만 는다(손 계산: 250초 통제면 밀림 위험의 약 14%, 70~130초 정체면 약 40% 가 꼬리에 있다). "통제가 풀린 뒤 아직 밀려 있던 길의 사고"도 그 통제의 결과다(주인 사건은 닫혀 있어도 된다).
- **장부를 쓰는 자리**(모두 **기록 id 를 담기만** 한다 — 해시 불변):
  - 닫힘(`'close'`): 쓰러진 나무의 통제(`I.blockEv`, 주인 = 그 사건), `sceneManager` 6번 블록의 전면 통제, 다중 추돌·산사태의 `onCreate`, X6 `blockRoad`(모두 `I.blockEv`), `traffic.spawn` 의 전면 공사·낙하물과 C2 의 전면 잔해(그 장애물의 `ev` — 잔해의 주인은 무너진 건물의 사건, 닫힌 사건이어도 된다), `disaster.closeEdge` 의 통제 기록(**`emit` 의 반환값** — 지금은 버린다. `tell` 이 아니다).
  - 감속(`'slow'`): `createIncident` 의 교통사고 블록이 `e.slow += 1.4` 를 건 구간(`I.rootEvent`, 주인 = 그 사건 — 발생 기록을 남긴 다음에 부른다). 쓰러진 나무는 한 구간에 닫힘(통제 기록)과 감속(발생 기록) 둘 다 적는다 — 항이 달라 서로 덮지 않고, 닫힌 동안의 뿌리는 닫힘의 주인(`blockEv`)이다.
  - 물(`'level'`): `disaster.floodRoads` 가 구간을 느리게 할 때(수위가 그 구간 문턱의 0.7 을 넘음 — `e.slow += FLOOD_SLOW`) 수위 알림의 기록(홍수의 충격 알림 `tell` 의 반환값을 `d.levelEv` 에 둔다), 느림을 거둘 때 −1.
  - 병목·정체: `announce` 가 기록 id 를 돌려주게 하고 `Obstacle.ev` 에(C2 가 만든 칸), 정체는 `emit` 의 반환값(지금은 버린다)을 그 정체 객체의 `ev` 에.
  - `bump`: 행사 인파(`noteBump(…, 0)`)와 태풍의 `lightsOut`(`noteBump(모든 구간, DARK_BUMP, 정전 알림 기록, 1)` — `d.lastEv` 는 보고서에 남기지 않는 알림에도 덮이므로 그 자리의 `tell` 반환값을 쓴다)은 **지금의 덧셈·뺄셈을 그대로 두고 줄만 함께 넣고 뺀다**(두 자리의 반올림 문턱이 서로 달라 산술을 합치면 해시가 바뀔 수 있다). C4·C5 는 `addBump`·`removeBump` 를 쓴다 — 정전·연기 한 건마다 그 `id` 를 자기 상태에 두고 그 건이 끝날 때 한 번 거둔다(`recover` 는 구역·칸마다 불리므로 거기서 구간의 `bump` 를 빼지 않는다 — 동네 셋에 걸친 국지 정전이면 세 번 빼 다른 원인의 `bump` 까지 깎는다).
  - `src/sim` 에서 `traffic.ts` 와 위의 두 자리(`disaster.lightsOut`·`lightsOn`) 말고는 `.bump +=`·`.bump =` 을 쓰지 않는다(소스 글자 검사 — 장부 없는 `bump` 는 구멍이 된다).
- 닫힘·감속의 주인은 `drift` 가 상태를 보고 게으르게 지운다(위 주석). `bumps` 줄은 얹은 쪽이 거둔다.
- 차단기 대기(`wait`)는 초과에 넣지 않는다.

**(다) 사고가 난 구간이 막히게** — `createIncident` 의 교통사고 블록: `opts.edgeId` 가 있고, 그 구간이 닫히지 않았고, 고속도로가 아니며, **다른 열린 사건의 `blockedEdge` 가 아니고**(두 사건이 같은 구간을 잡으면 먼저 닫히는 사건의 `closeIncident` 가 `slow −1.4` 와 함께 통제를 풀어 남은 사건의 통제 기록과 도로 상태가 어긋난다), **`traffic.canBlock(sim, e)` 를 지나면** 그 구간을 `I.blockedEdge` 로 먼저 고른다. 아니면 지금 규칙("간선 먼저 · id 작은 것"). `canBlock` 은 재난의 `detour` 를 옮긴 것이다(`disaster.ts` 가 그것을 부른다 — 해시 불변): 실제 상태(`reallyLinked`)에서, 열린 사건들이 잡고 있는 `blockedEdge` 도 막힌 것으로 치고 양 끝이 이어지는가. 지금 규칙의 `findRoute` 는 알려진 통제만 피하고 감속 중인 사건 구간을 지나갈 수 있다고 보는데, L1 은 통제 하나의 이웃·우회로에 사고를 잇달아 내므로(나무 → 사고 → 사고) 교차로 하나의 구간 셋이 차례로 닫혀 끊길 수 있다. 평소 추첨은 `edgeId` 를 주지 않으므로 그대로다.

### 3.6c 건물의 노출 상태 (`world.expo`) · 이웃 · 국지 구역 값

**왜 따로 두는가.** 현장(`Scene`)은 30×20 칸의 건물 하나이고 지도의 건물과 방향·축척이 이어져 있지 않다. 지금 현장 밖으로 나가는 것은 전체 붕괴의 구간 통제, `Sim.placeMarks`(지도 그림과 `placeGone`), 신호, 지진의 흔들림뿐이고 **이웃 건물로 가는 것은 0** 이다. `PlaceMark` 는 "그 건물에서 난 사건이 남긴 가장 무거운 상태 하나"라 사건이 없던 이웃의 노출을 넣으면 읽는 곳 일곱 남짓(`catTick`·`hazardState`·`renderCity`·`placeGone`·`knownBuildingAt`·`debrief`·`metrics`, I2 의 `placeOutcome`)을 고쳐야 하고 그 건물에서 진짜 사건이 나면 덮여 사라진다. 그래서 `sim.world.expo`(§3.3)에 둔다 — §9 의 "건물 상태를 `sim.world` 로 옮기지 않는다"는 "**X6 가 가진 상태는** 옮기지 않는다"로 읽는다.

**새 파일 `world/expo.ts`**(등록이 없는 파일 — §3.4: `sceneManager`·`disaster`·`catastrophe` 가 부르는 함수는 법칙·규칙 파일에 두지 않는다. `hazard.ts`·`state.ts` 를 import 한다)와 **`world/state.ts` 에 더하는 것**:

```ts
// world/expo.ts
export function expoOf(sim: Sim, placeId: number): PlaceExpo;                  // 없으면 만든다 { shake: 0, shakeEv: -1, shakeInc: -1, pipe: false, pipeEv: -1, pipeThr, wet: false, wetEv: -1, dark: -1 }
                                                                               //   pipeThr = 0.2 + 0.6 × sim.rng.fork('hz:pipe:' + placeId).next() — 만들 때 한 번
export function neighborsOf(sim: Sim, placeId: number): readonly { id: number; gap: number }[];      // 벽-벽 틈 NB_REACH(30) 안의 건물, 가까운 순. 시설·터(open) 제외
export function neighborsOfPoint(sim: Sim, x: number, y: number): readonly { id: number; gap: number }[];   // 길 위의 사건(차량 화재·폭발물) — 점에서 벽까지
export function applyExpo(sim: Sim, s: Scene, I: Incident): void;              // 현장 생성기가 노출을 읽는 자리 (아래)
export function darkened(sim: Sim, placeIds: readonly number[], part: HzPart): void;   // 건물에 정전이 닿은 순간 — 건물마다 hazardImpulse('liftStall') (L5)
// world/state.ts
export function zoneAt(sim: Sim, f: ZoneField, x: number, y: number): number;  // 그 점이 겪는 구역 값 (국지 값이면 원 안에서만)
export function isDark(sim: Sim, placeId: number): boolean;                    // zoneAt(power, 건물 가운데) < 0.5 || expo.dark ≥ 0 (expo 는 읽기만 — 없으면 만들지 않는다)
export function endZoneBy(sim: Sim, cause: number, until: number): void;       // 원인 기록이 cause 인 구역·국지 값의 회복 시각을 min(지금 값, until) 으로 당긴다 (setZone 은 늦추기만 한다 — C4)
export function knownHazardNear(sim: Sim, node: number, within = 300, age = 180): { fire: boolean; blast: boolean; collapse: boolean };   // 관제 쪽 — §3.8
// placeState 의 돌려주는 값에 칸을 더한다 (I2 가 읽는 mark·burnFrac·ruinFrac·usable 은 그대로):
//   { mark, burnFrac, ruinFrac, usable, shake, pipe, wet } — 건물 상태(placeMarks)가 없어도 노출이 있으면 mark: null 로 돌려준다 (world.expo 를 읽기만 한다)
// setZone 의 여덟째 인자 (선택):  at?: { x: number; y: number; r: number }
export function setZoneArea(sim: Sim, f: ZoneField, v: number, until: number, cause: number, known: boolean, at: { x: number; y: number; r: number }): void;
//   원이 닿는 동네(동네 가운데까지의 거리 ≤ r + 동네 반지름 × 1.22)마다 같은 자리로 setZone — 동네 경계 너머의 건물도 zoneAt 으로 같은 값을 겪는다
```

- **이웃과 거리**(조사 — 도시 3200×2200, 건물 1,262채): 가장 가까운 이웃까지 벽-벽 틈은 최소 2.0 · 중앙값 7.2 · p90 23.4(상가 5~6, 주택 7~8, 농가·창고 12). 틈 8 · 15 · 30 안의 건물 수는 평균 0.77 · 1.43 · 2.85. 같은 편 옆집은 틈 2~12, 길 건너는 20~35 이상이다. **현장 1칸 ≈ 도시 좌표 2.0**(`CELL = 2` — 표본 9건의 범위 1.2~4.0. **확인 필요**: 현장마다 다르다 — 첫 판은 상수로 둔다). 가스 폭발의 최대 반경 6칸은 도시 좌표 12쯤이라 벽을 맞댄 0.8~1.4채만 닿는다(예전 C1 의 `R = 40 + 18 × size` 는 87~148 로 건물 6~20채를 덮어 물리와 맞지 않았다). 이웃 목록은 건물 상자(돌려 놓인 것을 그대로 — `placeAt` 과 같은 변환)의 벽-벽 거리로 **원인 건물마다 처음 한 번** 만들어 `city.places` 를 열쇠로 한 `WeakMap` 에 둔다(도시는 고정 — `disaster.ts` 의 `geoOf` 와 같은 방식. `city.places` 는 고치지 않는다).
- **시드에 따라 달라지는 값은 `sim.world` 안에만 둔다.** 도시는 모듈에 한 번 만들어 모든 교대가 함께 쓴다 — 건물·동네마다 한 번 뽑는 값을 `city.places`·`city.nodes` 열쇠의 `WeakMap` 이나 모듈 `Map` 에 두면 앞서 돈 시드의 값이 다음 시드에 쓰인다(`sweep 60` 의 S5 와 `--log S5` 가 달라지고, 같은 시드를 두 번 견주는 시험으로는 잡히지 않는다). 그래서: 배관의 문턱은 `PlaceExpo.pipeThr`, 지하의 문턱 높이는 `world.sills`(L6 — 처음 볼 때 채운다), 지진의 동네 문턱 `u_z` 와 전선·수도관의 자리 문턱(C4·C11)은 쓸 때마다 `fork` 로 다시 계산한다(`fork` 는 부모를 쓰지 않는다 — `rng.ts`). 도시 열쇠의 캐시에는 **시드와 무관한 것**(이웃 목록·`riverDist`·`base_p`·`staticCost`·`roadFlow`)만 둔다. 시험: 한 프로세스에서 시드 A 다음에 돌린 B 의 해시가 B 만 돌린 것과 같다(§6 I1-b 1).
- **불 요약**: `hazards.fireLoad(s): number` — 불 세기 0.5 이상인 칸 수. `tickFire` 가 이미 도는 순회(큰 불 신호의 `big` 을 세는 자리)에 셈 하나를 더해 `WeakMap<Scene, number>` 에 둔다(현장 객체의 모양을 바꾸지 않는다. 현장은 교대마다 새로 만들므로 시드를 넘지 않는다). 건물 화재 표본 9건에서 최댓값 14~59, `≥ 10` 이 38~409초 이어졌다.
- **현장 생성기가 노출을 읽는 자리** — `sceneManager.createScene` 의 `buildScene` 바로 다음에 `applyExpo(sim, s, I)`. `world.expo[placeId]` 가 없으면 아무것도 하지 않는다(만들지 않는다 — 노출이 없는 교대는 그대로다).
  - `expo.shake > 0` 이면 `s.wear = { dmg: shake, soot: 0, cause: 'shock', inc: 원인 사건의 code, pre: 0 }`(I2 가 정해 둔 칸 `Scene.wear` 를 I1-b 가 먼저 연다 — `createScene`·`baseScene` 리터럴에 `wear: undefined`. I2 §3.6 의 `cause` 값 목록에 `'shock'` 을 더하고, I2 의 `applyPlaceWear` 는 이미 채워진 `wear` 와 `dmg` 의 큰 쪽으로 합친다 — 주 세션이 I2 설계서에 적는다). `catastrophe.catOf` 의 처음 건전도 계산 끝에 I2 §7 이 적어 둔 한 줄 `integ[r] = Math.min(integ[r], 1 − CAT.WEAR_INTEG × s.wear.dmg)`(`WEAR_INTEG` 0.5 는 `catastrophe.CAT` 에 두고 I2 가 그 값을 읽는다 — I2 §10.1 의 `persist.ts` 상수 줄을 그렇게 고친다. 난수가 없어 노출이 없는 교대는 그대로다).
  - `expo.pipe` 면 같은 자리에서 **새는 밸브 소품(`valve`, `leakRate` 있음) 하나를 놓는다** — X6 의 가스 격자와 폭발은 밸브 소품만으로 돈다(`catOf` 의 `gas: valve ? … : null` — 확인됨). **`s.rules` 는 고치지 않는다.** 그 칸은 판단부가 생김새로 읽는 칸이고(`methods.announceOk` — 경찰의 확성기 방법, R3 교본 줄의 `c.s.rules`) `injury.smokeCause` 가 연기 피해의 원인을 `'toxic'` 으로 정하는 칸이라, 아무도 보지 못한 이웃의 배관 손상(진실)을 거기 적으면 밸브를 보기 전에 방법 선택이 달라지고(정보 격리) 그 화재의 연기 흡입이 모두 유독 가스로 기록된다. 옛 가스 규칙(`hazards.tickGas` — `s.rules` 의 `'gas'` 로 켜지는 밸브 곁의 연기·주변 시민 노출)은 이 현장에서 돌리지 않는다(첫 판). 지휘관·대원은 밸브를 본 뒤의 `haz` 믿음(`agents.perceive` 는 현장 유형과 무관하게 `valve` 를 '배관에서 가스 누출 확인'으로 배우고, 지휘관은 `haz` 의 누출에 `mitigate` 를 낸다 — 확인됨)과 X6 의 가스 조짐으로만 안다. 난수는 새 흐름 `expo:<사건>`. 소품은 가구가 있던 자리나 옆 칸이 빈 바닥인 자리에만 — CLAUDE.md "소품은 길을 막는다"·"가구 자리에 소품을 놓을 때". 놓은 뒤 모든 바닥에 걸어서 닿는지 본다(시험).
  - `pipeLeak` 이 낸 사건이 한계 시간·방치가 아닌 사유로 닫히면 `expo.pipe = false`(그 사건의 `hz.law === 'pipeLeak'` — `closed` 신호의 상태 규칙. 밸브를 잠갔는데 그 건물의 다음 사건에 새는 밸브가 또 놓이면 '밸브 차단' 기록과 상태가 어긋난다). `shake` 는 그대로 남는다.
- **국지 구역 값**: `setZone(…, at)` 을 주면 그 값은 그 구역 안에서도 `(x, y)` 에서 `r` 안에만 걸린다(`ZoneState.at[f]`). `zoneAt` 은 국지 값이면 원 안에서만 그 값을, 밖에서는 처음 값을 돌려준다. 덮어쓰기는 b2 의 규칙 그대로("더 나쁜 값만")에 한 줄: 같은 값이면 반경이 더 클 때 자리를 바꾼다. **자리(`at[f]`)와 원인(`cause[f]`)·회복 시각(`until[f]`)은 한 묶음이다** — 자리를 바꿀 때 셋을 함께 바꾸고(b2 의 `setZone` 은 값이 나빠질 때만 `cause` 를 바꾼다 — 같은 동네의 둘째 폭발이 자리만 가져가면 그 정전이 첫째 폭발을 원인으로 갖고, 첫째 사건이 닫힐 때 둘째 자리의 정전이 함께 풀린다), 앞 자리에 얹었던 `bump` 를 거둔다(`removeBump`). 구역 전체 값(`at` 없음)이 오면 `at[f]` 를 지운다. 회복 때 함께 지운다. **한계**: 구역·칸마다 국지 자리는 하나다(둘째 손상은 더 나쁘거나 더 넓을 때만 덮는다). `knownZone` 은 값만 돌려준다(관제는 "그 동네 어딘가 정전"까지만 안다). 국지 값의 알림 문구는 범위를 부풀리지 않는다 — "{원인 건물} 주변 정전 — 인근 신호등이 꺼졌습니다."(동네 전체일 때만 "○○동 일대").

### 3.7 일반 법칙과 상태 결합

세 가지 꼴이 있다. **기록·상태 결합**(C — 원인이 상태를 바꾸고 그 상태를 이미 있는 판단·물리가 읽는다. `registerConsequence`), **일반 법칙**(L — 상태가 초과 위험 과정을 지나 사건을 낳는다. `registerHazard`), 그리고 그대로 두는 **이야기 연쇄**(재범·도주 차량·은신처·방화 — 사용자 결정).

| # | id | 상태 → 결과 | 꼴 | 예전 규칙과의 관계 | 넣는 단계 |
|---|---|---|---|---|---|
| C6 | `divertRecord` | 부대 전환·부족 → 원래 사건의 지연을 기록하고 보고서 문장 | 기록 | 그대로 | b3-1 |
| C3 | `hospitalLoad` | 다수 사상자 → 응급실 포화 → 먼 병원 이송·이송 중 목적지 변경 | 상태 결합 | 그대로 | b3-2 |
| C2 | `rubbleRoad` | 붕괴·큰 폭발 → 사건이 끝난 뒤에도 남는 잔해(장애물), X6 이 막지 않은 폭발 | 상태 결합 | 그대로 | b3-3 (X6 와 함께) |
| — | (교통 모델) | 닫힌 구간 → 우회로로 몰림, 초과 혼잡의 장부 | 다른 모델의 일반 규칙(§3.6b) | 쓰러진 나무의 `+0.7` 을 대신 | b3-5 |
| **L1** | `roadCrash` | 구간의 초과 혼잡 × 통행량 × 노면·시야 → 도로 사고(규모는 도로 등급과 초과에서) | 초과 위험 — 구간 | **C4-3(꺼진 신호의 교차로 사고)·C12(빗길 다중 추돌)를 따로 두지 않는다** | b3-6 |
| **L2** | `heatSpread` | 열과 불티의 노출 → 이웃 건물 발화 | 초과 위험 — 건물(한 번) | **C1 `blastSpread` 를 대신**(폭발의 불티는 한 항이다. 큰 화재의 옆 건물 번짐도 같은 법칙) | b3-7 |
| **L3** | 충격(상태 `shockSpread`) + `structFail`·`pipeLeak` | 전체 붕괴·폭발 → 이웃 건물의 구조·가스 배관 손상 → 그 건물의 다음 사건이 크게 시작하고, 손상이 그 건물의 붕괴·누출 위험을 올린다 | 상태 + 초과 위험 — 건물(한 번) | 새로("건물이 붕괴되어 더 큰 사고로") | b3-8 |
| **L7** | `rekindle` | 닫힌 화재 현장에 남은 열이 식어 가는 동안의 재발화 | 초과 위험 — 닫힌 꼴 | **C9 의 확률 추첨을 대신**(id 는 그대로) | b3-9 |
| C10 | `suspectZone` | 무장 용의자 도주 → 구역 위험, 근처의 재범(조건: 주변에 경찰이 없음) | 상태 결합 + 이야기 연쇄 | 그대로(L8 — 아래에 까닭) | b3-9 |
| C4 | `powerOut` | 변전소·발전소 사고, 태풍(신호 `blackout`), 지진(신호 `quake`), **붕괴·폭발 자리의 끊긴 전선(자리마다 문턱)** → 구역·국지 전력 → 꺼진 신호(혼잡)·승강기·통신·병원 | 상태 결합 | 승강기·교차로 사고의 확률 추첨을 뺐다(L5·L1 이 한다). 원천을 넓혔다 | b3-10 |
| **L5** | `liftStall` | 건물에 정전이 닿는 순간 운행 중이던 승강기 | 초과 위험 — 충격, 건물(한 번) | **C4-2 · C7 의 지하 주차장을 대신** | b3-10 |
| C8 | `commsDown` | 방송국·관제탑 사고, 긴 정전, 지진 → 무전 음영 증가 | 상태 결합 | 그대로(지진의 확률만 문턱으로) | b3-10 |
| C5 | `smokePlume` | 큰 화재·산불 → 연기가 덮은 자리(구역 값 + 국지 자리) → 실외 노출·도로 혼잡 | 상태 결합 | 호흡 곤란 신고의 확률 추첨을 뺐다(L4) | b3-11 |
| **L4** | `smokeIll` | 연기 농도 × 그 집의 평소 응급률 × 시간 → 호흡기 환자(변형 `medical/smoke`) | 초과 위험 — 건물 | **C5-1 을 대신** | b3-11 |
| **L6** | `floodLow` | 수위가 건물마다의 문턱 높이를 넘으면 잠긴다 → 잠긴 건물의 정전(L5). 차오르는 물에 느려진 길은 교통의 초과 한 항(L1) | 문턱 상태(사건을 직접 만들지 않는다) | **C7 의 60초 확률을 대신**(id 는 그대로 — N9 가 지하차도 구간의 문턱을 더한다) | b3-12 |
| C11 | `waterMain` | 붕괴·폭발·지진 → 수도관 파손 → 소화전 수압 저하 | 상태 결합 (선택) | 그대로(원천을 넓히고 지진의 확률을 문턱으로) | b3-12 |

숫자는 모두 첫 값이다. 단계마다 §4 로 재고 맞춘다. **C6·C3·C2 세 절은 2026-11-20 의 다시 쓰기와 검토 반영에서 글자를 바꾸지 않았다**(b3-1~b3-3 으로 구현됐다 — 실제 이름은 구현 메모. 이미 상태 결합이다).

#### C6 `divertRecord` — 전환·부족의 실제 영향 (기록 규칙)

- **전환**(`dispatcher.sendUnit` 의 `c.divertFrom` 블록): DIVERTED 기록에 `causes: [I.lastEvent]`(받는 사건의 마지막 기록 — 사건 사이 원인 간선), `Problem.ref = { inc: I.id, unit: u.id }`. J 의 `divertWait` 에 `{ unit, t, eta: u.estArrive, ev: DIVERTED 기록 }` 를 더한다(§3.3).
- **지연 기록**: J 의 다음 첫 도착(`unitArrived` 의 `first`) 때, 기억해 둔 전환이 있으면 `lost = max(0, sim.t − eta)` 를 `ref.lost` 에 넣고, `lost ≥ 10` 이면 `emit({ inc: J.id, role: 'DISPATCH', actor: '배정 AI', kind: 'dispatch', imp: 1, causes: [그 DIVERTED 기록], text: '사건 J: 전환 배정 뒤 첫 도착이 예정보다 약 N초 늦었습니다.' })`. 도착 없이 닫히면 `closeIncident` 에서 `lost = closedAt − eta`(기록은 남기지 않는다 — 보고서가 `ref.lost` 로 쓴다).
- **부족의 귀속**(`tickDispatch` 의 NO_UNIT): 막힌 수요 `key` 를 채울 수 있는(`caps[key] ≥ MINCAP[key]`) 부대 가운데 다른 사건에 묶인 것의 사건 id 를 모아 `I.blockedBy`, 그 사건들의 마지막 출동 지령(`dispatchLog` 끝)을 NO_UNIT 기록의 `causes` 에 더한다. 결원으로 `oos` 인 부대는 `ref.unit` 으로 두고, 그 부대의 운용 중단 기록(문구 규칙 T6, `actor` = 호출부호)을 `causes` 에 더한다(결원 → 부족의 사슬. 그 기록 id 는 어디에도 저장되지 않으므로 `sim.events` 를 끝에서부터 거슬러 찾는다 — NO_UNIT 이 날 때만이라 드물다. H1 이 그 기록 id 를 부대의 `u.oosEv` 에 둔다(H1 §3.6 — 반영됨) — 있으면 그것을 쓴다).
- 난수 없음. 쿨다운·상한 없음(일이 있을 때마다).

#### C3 `hospitalLoad` — 응급실 포화

- **상태**: `cap` = 시립병원 6 · 가온대학교병원 8 **(확인 필요: 병원 이름으로 정하지 말고 `LANDMARKS` 순서로 두 값을 둔다. R1 의 의료 헬기 뒤 이송량을 보고 맞춘다)**. `stays` 에 인계된 산 환자마다 `t + ER_STAY`(300초).
- **신호** `delivered` → `stays` 에 `data` 명 더하기. 5틱마다 지난 것 빼기.
- **결과**:
  1. 붐빔: 인계 시간 `timer` 에 `+ 3 × max(0, load − cap/2)` 초(`resources.ts:307-308` 의 식에 더한다).
  2. `load ≥ cap` 이면 `divert = true, known = true, cause = 인계 기록` 그리고 `emit({ role: 'SYSTEM', actor: 병원 이름, kind: 'unit', tag: 'hospital', imp: 2, causes: [인계 기록], text: '○○ 응급실 포화 — 당분간 중증 환자만 받습니다.' })`. `load ≤ cap − 2` 가 되면 풀고 '○○ 응급실 수용 재개.'(같은 모양). 바뀐 지 60초 안에는 다시 바꾸지 않는다(오락가락 방지).
  3. `startTransport`: `known` 인 `divert` 병원에는 ETA 에 240초를 더해 비교한다(훨씬 가까우면 그래도 간다). 더 먼 병원을 고른 경우 출발 기록의 `causes` 에 포화 알림, 그 환자의 사건에 `raiseProblem('HOSPITAL_FULL', '○○ 포화로 △△로 이송 (약 +N초)', { causes: [알림] })`.
  4. **이송 중 목적지 변경**(새 정보로 계획을 바꾸는 사례): 포화가 알려지는 순간 그 병원으로 `transport` 중인 부대 가운데 다른 병원까지 남은 시간이 지금 목적지보다 120초 넘게 길지 않은 부대는 `sendUnitTo(다른 병원)` 하고 `emit({ role: 'UNIT', actor: 호출부호, kind: 'unit', imp: 1, causes: [알림], text: '호출부호: ○○ 포화 소식 — △△로 목적지 변경.' })`, 그 사건에 HOSPITAL_FULL. 이 문구는 문구 규칙 T8 이 잡고 C5 가 출발로 친다(§2.3·§2.12 — 그러지 않으면 출발 ○○·인계 △△ 로 C5 위반이 생긴다). 남은 시간은 `etaFor`(안에서 `findRoute`)로 구하는데, **`tickWorld` 의 맨 위 단계(규칙 처리)에서만 부른다** — `findRoute`·`astar` 는 모듈 버퍼를 쓰므로 다른 `findRoute` 호출 안(예: `tickUnits` 의 경로 계산 도중의 갈고리)에서 부르면 안 된다(CLAUDE.md "공유 버퍼").
  5. 응급실 대기 기록(`resources.ts:309`)에 `causes` = 같은 교차로에서 인계 중인 다른 부대가 남긴 도착 기록(다른 사건의 구급차 → 이 사건의 대기).
  6. **(선택) 도로 통제와 이송** — "도로가 막히면 특정 병원 이송이 어렵다". `startTransport` 가 고른 병원이 "통제가 없을 때 가장 가까운 병원" `h0` 와 다르면, 출발 기록의 `causes` 에 그 까닭이 된 통제 기록을 잇는다. `findRoute` 에는 통제를 무시하는 선택이 없으므로 `initWorld` 가 병원마다 통제 없는 도로의 역방향 최단 경로 나무(`hospTree0[h][node]` = 그 병원 쪽 다음 교차로, `hospEta0[h][node]`)를 한 번 만들어 둔다(병원 2곳 × 교차로 수 — 작다. 도시는 고정이라 모듈에 두고 다시 써도 된다). 통제 기록 = `node` 에서 `hospTree0[h0]` 를 따라 걸으며 만나는 구간 가운데 지금 `closed && known` 인 것의 막은 주체 기록(사건 통제면 그 사건의 `blockEv`, 장애물이면 그 장애물을 놓을 때의 기록 — C2 의 잔해처럼 기록이 있는 것만). 그런 구간이 없으면(혼잡만으로 바뀐 것) 잇지 않는다. 관제 쪽 결정이므로 `known` 인 통제만 본다. 이 계산은 `world/state.ts` 의 `knownDetourCauses(sim, node, h0): number[]` 하나에 두고 `startTransport` 는 그 함수만 부른다(테스트 7 의 글자 검사를 지킨다).
- 난수 없음. 응급실 체류·포화는 R1 의 의료 헬기 이송(`airLifts`)도 같은 `delivered` 로 받는다.

#### C2 `rubbleRoad` — 잔해는 사건이 끝나도 남는다 (X6 와 함께)

X6 은 전체 붕괴 때 사건 교차로의 한 구간을 `closedReason 'incident'` 로 막고(`I.blockedEdge`, X6 §4.2) `closeIncident` 가 사건이 끝날 때 연다. 그러면 무너진 건물의 잔해가 사건 종료와 함께 사라지는 꼴이 된다. C2 는 그 사이를 잇는다.

- **(가) 사건 뒤에 남는 잔해** — 신호 `closed`: 그 건물의 `placeState(...).mark` 가 `collapsed` 또는 `blasted` 이고, X6 이 막았던 구간(`I.blockedEdge`)이 있으면 그 구간, 없으면 건물의 `edgeId` 에 `addObstacle(sim, { edge, kind: 'rubble', full: true, dur: rng.range(240, 420), known: true, cause: 종료 기록 })`. `closeIncident` 가 그 구간을 연 다음 틱에 다시 막히므로 한 틱(0.2초) 열리는 틈이 있다 — 그 틈에 경로를 정한 부대는 T1 그대로 가서 보고 되돌아 나온다(문제 없다).
- **(나) X6 이 막지 않은 큰 폭발** — 신호 `blast`(size ≥ 4)·`catastrophe`(폭발): X6 이 그 사건에 `blockedEdge` 를 두지 않았고 건물에 `edgeId` 가 있으면 같은 `addObstacle`, `known` = 현장에 active 대원이 있으면 true(없으면 T1 의 "가 보아야 아는 장애물" — 부대가 가서 보고 되돌아 나온다. ROUTE_BLOCKED → 재계획 `route`).
- **기록**: `addObstacle` 은 기록을 남기지 않는다(`traffic.ts` `place` 의 주석 "기록은 남기지 않는다"). 그래서 규칙이 놓은 뒤 그 자리에서 `emit({ role: 'SYSTEM', actor: '교통정보', kind: 'traffic', imp: 1, causes: [원인 — (가) 종료 기록, (나) 폭발·붕괴 기록], text: '{구간 이름} 건물 잔해로 {전면·한 차로} 통제.' })` 를 남긴다. `known` 이 거짓인 (나)는 진실이 바뀐 것이므로 `truth: true` 로 남기고, 부대가 가서 보는 순간의 ROUTE_BLOCKED(T1)가 관제가 아는 기록이 된다(그 `causes` 에 이 기록 — 0단계 4번과 같은 방식).
- 어느 쪽이든 `addObstacle` 이 도시를 끊는다고 거절하면(`null`) 한 차로만(`full: false`) 다시 시도한다. 밀림은 교통 모델이 퍼뜨린다(`bump` 를 따로 얹지 않는다). 교대 끝에 남은 잔해는 I2 §3.5 표의 "무너진 건물의 잔해가 길을 덮음"(`debris`, 전면, `left 2`) 줄로 이어받는다 — I2 가 그 줄의 원천으로 `traffic.obstacles` 의 `kind 'rubble'` 을 읽는다 — I2 연관 표의 I1 줄이 그렇게 정했고, I2 §3.5 (나) 줄이 이어받는다.
- 쿨다운: 건물마다 600초. 상한: 교대당 6. 난수 `csq:rubbleRoad:inc:<id>`.
- T1 파일(`traffic.ts`)의 작은 수정: `ObstacleKind 'rubble'`·라벨, `Obstacle` 에 선택 칸 `ev?: number`(놓을 때 규칙이 남긴 기록 — `addObstacle` 이 돌려준 객체에 규칙이 넣는다. 거절되면 기록도 남기지 않는다), `reportObstacle` 의 ROUTE_BLOCKED 가 `o.ev` 를 `causes` 에. 그림은 `trafficLayer.OBSTACLE_ICON`·`MapLegend`(CLAUDE.md "새 교통 사건·장애물" 절차).

#### L1 `roadCrash` — 차가 몰린 길에서는 사고가 잦다

- **읽는 상태**: 교통 모델이 `drift` 마다 적어 두는 구간의 초과 혼잡 네 몫 `exOwn`·`exBump`·`exQueue`·`exDiv` 와 그 내력(§3.6b), 구간의 통행량(`roadFlow`)·길이·등급, 노면과 시야(`weatherSpeedFactor`·밤). **교통 모델의 배열만 읽는다** — 재난·사건·현장을 읽지 않는다.
- **그 상태를 바꾸는 원인들**(법칙은 가리지 않는다): 평소 교통사고의 현장 감속과 전면 통제 · 쓰러진 나무 · 다중 추돌 · 산사태 · X6 의 전체 붕괴 통제 · C2 의 남은 잔해 · 전면 공사 · 한 차로 공사 · 고장 차량 · 낙하물 · 정체 · 행사 인파 · 태풍의 정전(전 구간 `bump`) · C4 의 꺼진 신호 · C5 의 연기 · 재난의 통제(홍수·산불·지진·해일) · **홍수의 물이 차올라 느려진 길**(`'level'` — 통제되기 전, 아직 열려 있는 동안). 그리고 이 법칙이 낸 사고 자신.
- **식**: `λ_e = A_ROAD × x_e × V_e × S × ℓ_e` (초당).
  - `x_e` = 네 몫의 합(0 ~ 2). 닫힌 구간은 0.
  - `V_e = 0.4 + 1.6 × flow_e` — 통행량(간선 평균 1.1 · 고속 0.87 · 일반 0.68 · 이면 0.5).
  - `S` = 노면·시야: `(vehicleSpeedMul / weatherSpeedFactor(sim))²`(비 1.29 · 안개 1.42 · 태풍 충격의 `speedMul 0.85` 면 1.38 — 난이도의 차량 속도 손잡이는 약분해 뺀다) × 밤이면 1.2. **초과분에만 곱한다** — 평소율에 날씨를 곱하면 인과가 아니라 난이도다(§9).
  - `ℓ_e = clamp(len / 150, 0.5, 2)` — 길수록 노출이 크다.
  - 첫 값 **`A_ROAD = 2.5e-5`**. **단위**: 구간 하나의 평소 사고율이 약 7 × 10⁻⁶/초(교통 std + 버스 1.88건/교대를 구간 257 로 나눈 값)이므로, 초과 1.0 · 통행량 1 인 구간은 **평소의 약 3.5배**가 더해진다. 어림(조사의 노출량 — 보통 교대 전체 약 18,000 구간·초 × 평균 통행량 0.85): 보통 교대 약 0.4건, 간선의 전면 통제 한 번(2,300~3,000 구간·초)이 우회로·이웃 어딘가에 사고를 낼 확률 6~8%, 태풍 교대 1건 안팎. (초안의 `1.0e-4` 는 같은 셈으로 보통 교대 1.5건 — 목표의 4~6배였다.) 목표: 보통 교대에 0.2~0.5건(교통사고 +10~25%, 전체 사건 +1.5~3.5%), 간선 전면 통제 한 번에 5~15%. **재는 법**: 읽기 전용 표본(`scripts/hazstats.ts` — §4)으로 교대의 `Σ_e ∫ x_e V_e S ℓ_e dt` 를 재서 `A_ROAD = 목표 건수 / 그 값의 평균`(§3.6b 의 뿌리 가르기와 밀림의 꼬리 때문에 노출량이 조사 때와 다르다 — 반드시 다시 잰다).
- **대상·주기·문턱**: 구간 257, 12초(`every: 12` — `drift` 뒤), 흐름 `hz:roadCrash:<구간>:<n>`(구간마다 몇 번이고 날 수 있다). 넘으면 그 `drift` 의 틱에 난다(보간하지 않는다 — §3.6a).
- **나는 사건**(`spawn` — 상태에서 정한다):
  - 유형 `traffic`. **변형을 반드시 정해 준다** — 비워 두면 `createIncident` 의 시나리오 몫 추첨이 돌아 쓰러진 나무 14%·맨홀 7%·난폭 운전 9% 로 뽑힌다.
  - 규모는 속도와 초과에서: 이면·일반(`speed ≤ 23`)은 `x < 1.2` 면 1, 아니면 2 · 간선은 2, `x ≥ 1.2` 면 3 · 고속은 3.
  - 변형: 규모 2 이상이고 `cell.u2 <`(규모 3 이면 0.28, 2 면 0.06)이면 `'bus'`(평소 추첨과 같은 몫 — 버스가 그 줄에 끼어 있었는가는 내용이다. **`'bus'` 면 규모를 3 으로 올린다** — 평소 추첨과 같게, `createIncident` 의 버스 줄), 아니면 `'std'`. **다중 추돌(`'pileup'`)은 내지 않는다**(첫 판): 그 시나리오는 `tag: 'major'` 이고 "대형 사고는 교대에 많아야 하나"(N5 의 틀 — `sim.rngMajor`·`gen.majorAt`, `tests/major.test.ts` 의 '한 교대에 둘은 없다')와 부딪힌다 — 법칙이 먼저 내고 `gen.majorAt` 이 뒤에 와도 둘이 된다. 고속 구간도 `'std'` 규모 3 으로 낸다. 나중에 켠다면 "이번 교대에 `tag === 'major'` 인 사건이 없고 `sim.gen.majorAt === Infinity` 일 때만".
  - 자리: `nodeId` = 그 구간의 두 끝 가운데 열린 사건이 없고 시설 앞이 아닌 교차로(둘 다 되면 닿은 구간이 많은 쪽, 같으면 id 작은 쪽). 둘 다 안 되면 `null`(기다린다). `edgeId` = 그 구간(§3.6b (다) — 몰린 그 구간이 막힌다. 조건에 걸리면 지금 규칙으로 고른다).
  - 첫머리(`note`)는 주된 몫의 갈래로: `divert` '막힌 길을 피해 몰린 차들 사이에서 사고가 났습니다' · `queue` '길게 밀린 차들의 꼬리에서 추돌 사고가 났습니다' · `lane` '한 차로가 막힌 길에서 차가 부딪쳤습니다' · `jam` '정체 구간에서 추돌 사고가 났습니다' · `crowd` '인파로 막힌 길에서 사고가 났습니다' · `dark` '신호등이 꺼진 교차로에서 차가 부딪쳤습니다' · `haze` '연기로 앞이 보이지 않는 길에서 차가 부딪쳤습니다' · `level` '물이 차오르는 길에서 차가 부딪쳤습니다'.
- **원인 귀속**: 몫들을 `HzPart` 로 내놓는다(§3.6b 표의 "내력" 열 — `exOwn` 과 `exBump` 는 항·줄마다 하나). 통제 + 꺼진 신호처럼 둘이 겹치면 큰 쪽이 `cause`, 다른 쪽이 `causes`. 부모는 주인 사건이 있는 가장 큰 몫(전체의 1/3 이상일 때).
- **되먹임과 상한**: 낸 사고가 다시 감속·통제의 뿌리가 된다(§3.6 — 기대값 1 아래). `hazardRoom`(사슬 3건 · 한 뿌리의 가지 2 · 한 교대 6건 · 부모 없는 것 3). 법칙 상한 교대당 3.
- **재난과 겹치지 않게**: 태풍의 '비바람에 미끄러진 차'·홍수의 '물에 잠긴 도로의 충돌'·지진의 '여진 충돌'은 재난 큐가 직접 일으킨다(같은 "X 면 Y" 꼴이지만 N6 의 것이다 — 이번에는 건드리지 않는다, §8). L1 은 재난의 종류·세기를 읽지 않고 구간의 상태만 읽는다 — 재난에서는 그 뒤(쓰러진 나무 → 통제 → 몰림, 정전 → 꺼진 신호, 차오르는 물 → 느려진 길)를 맡는다. 법칙이 낸 사건은 `d.spawned`·재난 `CAP` 에 넣지 않고 `tag 'disaster:…'` 도 붙이지 않는다(`'disaster:quake'` 는 X6 이 읽고, 측정 도구의 `isDisasterTag` 는 그 꼬리표를 재난 큐 사건으로 센다). 수로는 더해진다 — 홍수 20교대의 사건 수가 기준 × 1.1 을 넘으면 `'level'` 항의 0.8 을 줄인다(큐는 건드리지 않는다).
- **AI 가 아는 길**: 사고는 평소처럼 신고로 알려진다. 몰린 길의 혼잡은 지금도 관제가 읽는 값이다(`edgeTime` — 교통 정보). 까닭(알려지지 않은 통제)은 모른다(§3.8).
- **기록**: 통제·정체·장애물·정전의 기록은 이미 그 자리에서 남는다(장부는 그 id 를 담는다). 우회 몰림은 연속 값이라 기록하지 않는다. 사고의 발생 기록 `'{첫머리} — {교차로} 교차로.'`(`truth: true`, `causes` = 그 순간의 몫들의 기록).
- **테스트**: ① 교통 사건·사건·재난을 모두 끈 도로에서 300초 — 모든 구간의 `excess` 가 0 이고 `world.hz.cells.roadCrash` 가 비어 있다. 수요만으로 `p0 ≥ 2.4` 인 구간을 손으로 만들고 그 위에 `bump` 를 얹어도 이웃의 `exQueue` 는 0 이다(평소의 뿌리). ② 구간 하나를 닫으면 우회로 구간에 `exDiv > 0`·`divertBy = 그 구간`, 이웃에 `exQueue > 0`·`qBy = 그 구간`·`qEv` = 통제 기록. 통제를 풀면 `closeEv` 는 다음 `drift` 에 −1 이지만 **이웃의 `qEv` 는 밀림이 0 이 될 때까지 그 기록**이다. ③ **개입 시험**(§6 I1-b 10). ④ 원인을 모른다(소스 글자 — §6 I1-b 12). ⑤ 깊이 2 인 사건의 통제로 몰린 길에서는 `'depth'` 로 버리고 `H` 가 `thr` 만큼 줄며 `n` 이 는다. ⑥ 양 끝 교차로에 열린 사건이 있으면 기다리는 줄에 들어가고, 하나가 닫히면 **다음 1초 블록에** 난다(마감 60초가 지나면 `'expired'`). ⑦ 나무 → 사고 → 사고 사슬을 강제하고(시험 상수로 `A_ROAD` 를 키운다) 통제가 걸릴 때마다 `tests/traffic.test.ts` 의 연결 검사(모든 시설 → 모든 교차로, 큰 차)를 지난다. 법칙이 고른 `edgeId` 가 다른 열린 사건의 `blockedEdge` 면 그 구간을 잡지 않는다. ⑧ 인파와 정전이 겹친 구간에서 정전이 먼저 끝나면 남은 `exBump` 몫의 `what` 이 `crowd` 다.

#### L2 `heatSpread` — 오래 크게 타는 불 곁의 건물은 불이 붙는다

- **읽는 상태**: 열린 현장의 불 요약 `F = hazards.fireLoad(s)`(불 세기 0.5 이상 칸 수), 이웃 건물까지의 벽-벽 틈 `g`(`neighborsOf`), 폭발의 크기(`Signal.size`·`mag`).
- **원인들**: 건물 화재(평소·방화·오인이 아닌 것) · 대형 화재 · 가스 폭발 뒤의 불 · 차량 화재(길 위 — `neighborsOfPoint`) · 붕괴 현장의 불 · 산불 사건의 건물 현장 · X6 의 가스·용기·분진 폭발 · 폭발물. **현장의 불이면 무엇이든 같은 열원이다** — 법칙은 변형도 재난도 읽지 않는다(산불의 불머리 `d.front` 는 현장이 아니라서 저절로 열원이 아니다 — 번짐은 산불 모델의 것. 예전 글의 "불머리 반경 안 건물은 뺀다"는 법칙이 재난 상태를 읽어야 해서 뺐다: 이미 불이 난 건물과 쓸 수 없는 건물은 아래의 조건이 거른다).
- **식**:
  - 유속 `q = F / (1 + g / 6)²`. 문턱 유속 `Q0 = 3` 을 넘는 몫만 쌓인다: `λ = K_HEAT × M[종류] × max(0, q − Q0)`. `F < 10` 인 현장은 훑지 않는다.
  - 첫 값 `K_HEAT = 1.7e-4`, `M` = 시장·창고·작업장·상점 1.3 · 주택·다세대·식당·카페·편의점 1.0 · 공장 1.0 · 아파트·오피스텔·사무용 0.6. 모양: 벽을 맞댄 집(틈 3)이 `F = 30` 의 불 곁에 200초 → `H ≈ 0.35`(불붙을 확률 30%) · 중앙값 틈 7.2 → 0.11(10%) · 길 건너(틈 25)는 `q ≈ 1.1 < Q0` 라 `F` 가 80 을 넘지 않는 한 0 · 가장 큰 불(`F = 59`)이 400초 → 벽을 맞댄 집 `H ≈ 1.6`(80%).
  - **불티**(충격 — 폭발 순간 한 번): `ΔH = K_EMBER × M × (mag / 50) × (CELL × size)² / (g + 6)²`, 첫 값 `K_EMBER = 0.25`. 반경 6칸·피해 50 의 폭발 → 틈 3 에 0.44(36%) · 틈 7.2 에 0.21(19%) · 틈 25 에 0.04. 충격을 주는 자리는 `shockSpread`(L3 (가)의 상태 규칙 — 같은 폭발 신호를 받는다, b3-8 c)다: 이웃마다 `hazardImpulse(sim, 'heatSpread', 이웃, ΔH, { ev: sig.ev, inc: sig.inc, what: 'ember', ref: 원인 건물 })`.
  - **단위**: 건물 한 채의 평소 화재율은 1.8 × 10⁻⁶/초(단독주택 0.9, 공장·시장 43 — 한 채의 몫이 88배 차이 난다)라 "평소의 몇 배"는 단위가 못 된다 — 양과 건물마다의 문턱으로 쓴다. 참고로 위 벽을 맞댄 집의 `λ ≈ 1.75 × 10⁻³/초` 는 평균 건물 평소율의 약 1,000배다(곁에 큰 불이 있는 200초 동안만).
- **대상·주기·문턱**: 큰 불 현장의 이웃 건물(현장마다 가까운 8채까지), 1초, **건물마다 교대에 한 번**(`once`) — 흐름 `hz:heatSpread:<건물>`("그 건물이 얼마나 타기 쉬운가"). 열원이 둘이면 유속이 더해진다.
- **대상에서 빼는 건물**(`scan` 이 내놓지 않는다): 시설, 터(`open`), `placeState(…).usable === false`(전소·전체 붕괴), 이미 불이 난 적 있는 건물(이번 교대에 화재 사건이 있었던 건물 — 탈 것이 탔다). 열린 사건이 있는 건물은 내놓되 틀이 기다리게 한다(§3.6a 의 공통 조건).
- **나는 사건**: `fire/std`(오인·방화로 뽑히지 않게 변형을 정한다), `placeId` = 그 건물, 규모 = 넘는 순간의 `F ≥ 40` 이거나 불티면 2, 아니면 1(`buildFire` 는 규모로 발화점 수를 정한다). 첫머리: 열 '옆 건물의 불이 옮겨붙었습니다' · 불티 '폭발의 불티가 옮겨붙었습니다'.
- **원인 귀속**: 몫 = 열원 현장마다 `{ ev, inc: 그 사건, what: 'heat', ref: 불난 건물 }` — **`ev` = 그 사건의 발생 기록(`I.rootEvent`), 그 현장에 X6 의 폭발 기록(`EXPLOSION`·X6 의 폭발 문구인 `HIDDEN_HAZARD`)이나 `BURNOUT` 이 있으면 그 가운데 마지막 것. `ESCALATION` 은 쓰지 않는다** — 그 코드는 2차 붕괴·압궤 증후군·인질 피격·시민의 가스 노출에도 쓰여(`hazards.ts`), 가스 폭발 현장의 불이 옮겨붙었을 때 원인이 "압궤 증후군" 기록이 될 수 있다(그 상태를 만든 기록이 아니다). b2 의 `fireBig` 신호의 `ev` 도 같은 규칙으로 맞춘다(b3-7 — 지금 고르는 기록을 확인하고 다르면 고친다). 불티는 `{ ev: 폭발 기록(sig.ev), what: 'ember' }`. 부모 = 그 화재(폭발) 사건.
- **되먹임과 상한**: 옮겨붙은 건물의 불이 다시 열원이 된다 — **한 뿌리에서 뿌리 포함 건물 셋까지**(`canChain` 의 길이 3 + `HZ.ROOT_MAX` — 이웃 여덟 채가 함께 문턱을 넘어도 그 불에서 난 법칙 사건은 둘이다, 연기 환자를 합쳐서). 법칙 상한 교대당 3.
- **같은 교차로의 열린 사건 둘**: 틈 15 안 이웃의 2/3 가 원인 건물과 같은 교차로다. `pickPlace` 의 엄격 추첨은 열린 사건이 있는 교차로를 피하지만 `placeId` 를 정해 주면 비켜 간다. **확인 필요**(b3-7 의 첫 일 — `--force fire/std` 20교대에서 본다): 지도 핀·길가 주차 자리·`knownBuildingAt`(같은 교차로·같은 종류 건물의 닫힌 사건을 찾는다)이 같은 교차로의 두 사건을 가릴 수 있는가. 못 가리면 이 법칙만 **원인 사건이 닫힐 때까지 기다리게 한다**: `spawn` 이 "그 교차로에 열린 사건이 있으면 `null`", `hold: 300`. 기다리는 줄은 초과가 끝나도 버려지지 않으므로(§3.6a) 불이 꺼지고 원인 사건이 닫힌 그 1초 블록에 옮겨붙은 불이 신고된다(넘는 순간의 몫을 적어 둔 사본으로 귀속한다).
- **AI 가 아는 길**: 새 사건은 신고로. 분석 AI 는 **알려진** 큰 불·폭발(`knownHazardNear` — §3.8) 곁의 화재 신고에 '연소 확대' 이름표와 위험도 +0.3.
- **기록**: 열의 적분은 기록하지 않는다. 사건의 발생 기록 `'옆 건물의 불이 옮겨붙었습니다 — {건물}.'`(원인 = 위의 `ev`).
- **테스트**: ① 불이 없는 교대에는 칸이 없다. ② 이웃 목록 — 벽-벽 틈이 손 계산과 맞고 돌려 놓인 건물에서도 맞다. ③ **개입 시험**: 같은 시드의 두 `Sim` 에 같은 화재를 강제하고 한쪽만 그 현장의 `s.fire` 를 0 으로 채운다 → 그쪽은 이웃의 `hazardCell` 이 없고 이웃 화재가 없다. 다른 쪽은 문턱을 낮춘 시험 상수에서 이웃 화재가 나고 `parent`·`cause`·`hz.src[0].what === 'heat'`, 그 사건의 `truth.placeId === hz.target`. ④ 길 건너 건물(틈 ≥ 20)은 `F = 59` 에서도 쌓이지 않는다. ⑤ 전소·전체 붕괴 건물, 이미 탔던 건물은 대상이 아니다. ⑥ 이웃 넷이 모두 문턱을 넘게 한 화재에서 옮겨붙은 불은 둘이고 나머지는 `'depth'`(한 뿌리의 가지), 옮겨붙은 불의 이웃(셋째 세대)도 `'depth'`. ⑦ 원인 기록이 `ESCALATION` 이 아니다(붕괴 현장의 불로).

#### L3 충격 — 붕괴와 폭발은 옆 건물을 흔든다 (`structFail` · `pipeLeak`)

"건물이 붕괴되어서 더 큰 사고로 이어진다"의 길이다. 세 부분: (가) 충격이 이웃 건물에 **손상 상태**를 남긴다, (나) 그 건물에서 나는 다음 사건이 **그만큼 크게 시작한다**, (다) 손상 자체가 그 건물의 **위험률을 올린다**. (다)가 없으면 사용자의 예는 거의 보이지 않는다 — 건물 1,262채에 교대당 사건 14건이라 손상된 이웃 1~3채에서 "나중에 우연히" 사건이 날 확률은 3% 안팎이다(조사).

- **(가) 충격 → 손상** — `world/rules/structure.ts` 의 상태 규칙 `shockSpread`(`registerConsequence`, 신호 `catastrophe`·`blast`·`collapse`, `rubbleRoad` 다음에 등록). 난수 없음(배관의 문턱은 `expoOf` 가 건물마다 한 번), 쿨다운·상한 없음(일이 있을 때마다):
  - 폭발(`catastrophe` data 0 · `blast`): 이웃마다 X6 의 현장 안 식을 그대로 밖으로 잇는다 — `Δshake = K_SHOCK × mag / 100 × max(0, 1 − d / (size + 2))`, `d = g / CELL + 2`(칸), `K_SHOCK = 0.8`(X6 의 `K_HIT_BLAST`). 반경 6칸·피해 50 → 틈 3 에 0.22 · 틈 7.2 에 0.12 · 틈 12 넘으면 0.
  - **붕괴는 건물 전체가 무너졌을 때만**(`catastrophe` data 1 가운데 `collapseBuilding` 이 보낸 것 — `mag = 1`. 구획 하나의 붕괴는 밖으로 나가지 않는다): 틈 **15** 안의 이웃에 `Δshake = 0.6 × (1 − g / 15)`(틈 3 에 0.48 · 중앙값 7.2 에 0.31 · 12 에 0.12). 무너진 채 시작하는 사건(`collapse` 신호, `size ≥ 10` — 크레인·가스 폭발·산사태)은 `0.35 × (1 − g / 15)`(틈 3 에 0.28 · 7.2 에 0.18). **한 번의 충격이 `S_MIN` 과 배관 문턱의 아래쪽을 넘을 수 있어야 한다**는 것이 이 값들의 조건이다 — 초안의 `0.25 × (1 − g / 8)`·`0.15 × (1 − g / 8)` 은 도시에서 가장 좁은 틈(2.0)에서도 0.19·0.11 이라 배관 문턱의 최소(0.2)와 `S_MIN` 에 닿지 못해, 붕괴에서는 금 기록도 `structFail`·`pipeLeak` 도 사실상 0 이었다(사용자의 예 ②가 폭발에서만 돌았다).
  - `expo.shake = min(1, shake + Δ)`, 가장 크게 보탠 기록·사건을 `shakeEv`·`shakeInc` 에. **`shake` 가 처음 `S_MIN`(0.1)을 넘을 때** 기록: `emit({ role: 'SYSTEM', actor: '도시', kind: 'hazard', tag: 'struct', imp: 1, truth: true, causes: [shakeEv, sig.ev], text: '{원인 건물} {붕괴·폭발}의 충격으로 옆 {건물}에 금이 갔습니다.' })`(충격이 둘 쌓여 넘었을 때 기록의 원인과 `structFail` 의 부모가 서로 다른 사건을 가리키지 않게 둘 다 넣는다 — 중복은 `emit` 이 거른다).
  - **가스 배관**: 도시가스를 쓰는 건물(주택·다세대·아파트·오피스텔·식당·카페·상점·시장·편의점·호텔)마다 배관의 약한 정도 `expo.pipeThr = 0.2 + 0.6 × u`(`u` = 흐름 `hz:pipe:<건물>` 의 첫 값 — `expoOf` 가 만들 때 한 번, §3.6c). `shake ≥ pipeThr` 가 되는 순간 `expo.pipe = true`, 기록 `'{건물}의 가스 배관이 충격으로 손상됐습니다.'`(같은 모양, `causes: [shakeEv, sig.ev]`) → `pipeEv`.
  - 이 신호들에 필요한 크기: `Signal.mag`(§3.3) — X6 의 폭발 셋은 피해량(`dmg`), `collapseBuilding` 은 1, `collapseRegion` 은 `min(0.99, 이번에 무너진 칸 ÷ 건물의 실내 칸)`(기록·측정용 — 충격 규칙은 `mag ≥ 1` 만 받는다. 쌓인 몫으로 보내면 구획 붕괴 바로 뒤의 `collapseBuilding` 과 충격이 두 번 더해진다), `hazards.blast` 의 폭발물은 피해량.
  - 첫 값의 어림: 전체 붕괴 한 번에 틈 15 안 이웃 1.4채, 금 기록 1채쯤 · `structFail` 0.1~0.15건 · 배관 손상 17%(`pipeLeak` 0.2건) — 보통 60교대에 `structFail` + `pipeLeak` 2~5건, `collapse/gasblast` 강제 20교대에 2건 안팎. 수는 `hazstats` 의 `shake` 분포("`S_MIN` 을 넘은 건물 수"와 "배관이 끊긴 건물 수"를 따로 낸다)로 다시 맞춘다.
  - 함께 고친다: X6 `blockRoad` 가 **건물이 면한 길(`Place.edgeId`)을 먼저** 본다(지금은 사건 교차로의 `node.edges` 순서라 면한 길이 아닌 구간이 막히기도 한다 — 표본 S7 #15: 빌라의 `edgeId` 70, 막힌 구간 64. C2 가 그 구간을 이어받으므로 잔해도 다른 길에 남는다). 전체 붕괴가 난 교대만 바뀐다. C2 의 글("X6 이 막았던 구간이 있으면 그 구간")은 그대로다.
- **(나) 손상된 건물의 다음 사건** — `applyExpo`(§3.6c): `shake` → `s.wear.dmg` → 처음 건전도 `min(…, 1 − 0.5 × dmg)`(불이 나면 삐걱임·균열·임박이 그만큼 빨리 오고 X6 가 실제로 무너뜨린다), `pipe` → 새는 밸브 소품(X6 의 가스 격자가 돈다 — 불이 가스에 닿으면 X6 가 폭발시킨다. `s.rules` 는 고치지 않는다). 법칙이 아니라 처음 상태다 — 평소 추첨이든 법칙이든 그 건물의 모든 사건에 걸린다. (평소 추첨은 이번 교대에 사건이 났던 건물을 피하므로 "다음 사건이 더 크다"는 주로 이웃 건물에서 나타난다.)
- **(다) 손상이 올리는 위험률** — 두 법칙(`world/laws/shock.ts`), 모두 1초·건물마다 한 번(`once`), 대상은 `world.expo` 에서 조건에 맞는 건물(많아야 16):
  - `structFail`: `shake ≥ S_MIN` 이고 쓸 수 있는 건물. `λ = A_STRUCT × (shake − S_MIN)`, 첫 값 `A_STRUCT = 1.0e-3`(금이 0.4 인 건물은 10분에 16%, 0.31 이면 남은 500초에 10%). 흐름 `hz:structFail:<건물>`. 사건 `collapse/std`, 규모 `shake ≥ 0.45` 면 3 · `≥ 0.3` 이면 2 · 아니면 1, 첫머리 '금이 가 있던 건물이 내려앉았습니다'. 몫 `{ ev: shakeEv, inc: shakeInc, what: 'shake', ref: 건물 }`. **확인 필요**: `buildCollapse` 가 모든 건물 종류의 틀(`KIND_SCENE`)을 받는가 — 받지 않는 종류는 대상에서 뺀다.
  - `pipeLeak`: `pipe` 이고 쓸 수 있는 건물. `λ = A_PIPE = 1 / 300`(새는 가스는 곧 누군가 맡는다 — 5분 안에 63%). 흐름 `hz:pipeLeak:<건물>`. 사건 `hazmat/std`, 규모 `shake ≥ 0.4` 면 2 · 아니면 1, 첫머리 '충격으로 손상된 배관에서 가스가 샙니다'. 몫 `{ ev: pipeEv, inc: shakeInc, what: 'pipe' }`. 이 사건이 한계 시간·방치가 아닌 사유로 닫히면 `expo.pipe = false`(§3.6c — 밸브를 잠갔다).
  - **단위**: 건물 한 채의 평소 붕괴율·누출율은 10⁻⁷/초 자리라 배율로 쓰지 않는다 — 손상의 양에 비례하는 위험률이다.
- **되먹임과 상한**: 붕괴(0) → 옆 건물의 붕괴·누출(1) → 그 건물의 폭발·붕괴가 다시 흔든 건물(2)에서 끊기고, 한 뿌리에서 난 법칙 사건은 둘까지다(`hazardRoom`). 법칙 상한 각 2. 금(`shake`)에는 회복이 없다(교대 안에서 저절로 붙지 않는다) — 대신 건물마다 한 번이다. 교대 끝의 `shake` 는 I2 의 `PlaceCarry.dmg` 가 이어받는다(§3.7 끝).
- **AI 가 아는 길**: 손상은 진실이다. 관제는 그 건물의 사건이 신고될 때 평소처럼 알고, 분석 AI 는 **알려진** 붕괴·폭발(`knownHazardNear` — §3.8, 두 `reportedNode` 사이 300 안) 곁의 붕괴·가스 신고에 위험도 +0.3. 지휘관은 X6 의 조짐으로 안다(낮게 시작한 건전도는 삐걱임이 빨리 들릴 뿐이다), 새는 밸브는 본 대원의 `haz` 믿음으로.
- **테스트**: ① 폭발 신호 하나 → 틈 안의 이웃에만 `shake`, 손 계산과 같은 값, 기록의 원인이 폭발 기록. **전체 붕괴 하나(틈 3 의 이웃)만으로 금 기록이 남고 `structFail` 의 칸이 생긴다.** ② 구획 하나의 붕괴(`mag < 1`)는 밖으로 나가지 않는다. ③ `shake` 가 있는 건물에 화재를 일으키면 `s.wear.dmg` 와 낮아진 처음 건전도, `pipe` 면 밸브 소품과 `s.cat.gas` 격자가 있고 **`s.rules` 는 그대로**이며, 모든 바닥에 걸어서 닿는다. ④ **개입 시험**: 같은 시드의 두 `Sim` 에서 한쪽만 붕괴 직후 `world.expo` 를 비운다 → 그쪽에는 `structFail`·`pipeLeak` 사건이 없다. ⑤ 노출이 없는 교대는 해시가 앞 단계와 같다. ⑥ `blockRoad` 가 면한 길을 막고 도시가 끊기지 않는다. ⑦ **정보 격리**: `applyExpo` 앞뒤로 `s.rules`·`s.kind` 가 같고, 밸브에 대한 믿음이 없는 경찰 대원의 `chooseMethod`(순수 함수)가 `expo.pipe` 를 켠 현장과 끈 현장에서 같은 방법을 고른다(검토가 낸 "두 현장의 기록이 같다"는 쓰지 않는다 — 밸브 소품이 칸 하나를 막아 길이 달라지므로 정보 격리가 지켜져도 기록은 갈릴 수 있다). ⑧ `pipeLeak` 사건이 '해결'로 닫히면 `expo.pipe` 가 거짓이고, 그 건물의 다음 현장에 밸브가 놓이지 않는다.

#### L7 `rekindle` — 덜 식은 불 자리는 다시 붙는다

- **읽는 상태**: 닫힌 화재 현장에 **실제로 남은** 불씨와 열 — `e0 = Σ(불 > 0.04 인 칸의 불 세기) + 0.25 × Σ(열 > 0.5 인 칸의 열)`, 젖은 칸은 `× (1 − wet)`. 닫힌 현장의 배열(`fire`·`heat`·`wet`)은 `sim.scenes[id]` 에 남아 있다. 잔불 정리를 마친 구역은 열 0·젖음 0.9 라 저절로 0 이다 — "잔불 정리를 했는가"를 따로 묻지 않는다(상태가 말한다).
- **원인들**: 한계 시간·방치로 끝난 화재 · 닿지 못해 잔불 정리를 건너뛴 구역 · 진입 금지 구역으로 남긴 구획 · 무너진 구획 밑의 불씨 · 물이 떨어져 접은 진압 · 화재가 아닌 유형의 현장에 남은 불(가스 폭발 뒤, 붕괴 현장).
- **식**(틱 없이 닫힌 꼴): 남은 열은 `e(Δt) = e0 × exp(−Δt / τ)` 로 식는다(`τ = 180`초, 비가 오면 120). 위험률 `λ = K_RE × e`, 누적 `H(Δt) = K_RE × e0 × τ × (1 − exp(−Δt / τ))`, 끝내 닿는 값 `H∞ = K_RE × e0 × τ`. 닫히는 순간(`closed` 신호) 문턱 `thr` 과 견준다: `H∞ < thr` 면 영영 없다(칸에 `H = H∞` 만 적는다 — 기록 없음), 아니면 `Δt* = −τ × ln(1 − thr / H∞)` 뒤에 다시 붙는다. 첫 값 `K_RE = 1.0e-3`(`e0 = 3` — 불씨 다섯 칸과 뜨거운 칸 여섯쯤 — 이면 `H∞ = 0.54`, 42%).
- **대상·문턱**: 닫힌 화재 현장의 건물, 건물마다 한 번 — 흐름 `hz:rekindle:<건물>`. `closed` 신호를 받는 자리는 상태 규칙 `residualHeat`(`world/rules/structure.ts`)이고 법칙 파일 `laws/ember.ts` 에는 `spawn` 만 있다(`scan` 이 없는 법칙). `hazardImpulse(sim, 'rekindle', placeId, H∞, part, max(60, Δt*))`(§3.6a 의 충격에 미루는 시간 인자 — 그때 `spawn` 이 `null` 이면 60초까지 기다린다).
- **빼는 것**: 교대 끝으로 닫힌 것(`shiftend`), 전소·전체 붕괴 건물(`placeState`), 길 위의 화재(건물이 없다).
- **나는 사건**: `fire/std`, 같은 건물(`placeId` 를 정해 주므로 `pickPlace` 의 `used` 를 거치지 않는다), 규모 1, 부모 = 닫힌 그 사건, 원인 = 종료 기록, 첫머리 '잔불이 되살아나 다시 불길이 올랐습니다'. 몫 `{ what: 'residual' }`.
- **상한**: `canChain`, 법칙 상한 2.
- **정직한 값**(조사 — 불이 났던 현장 15건): 모두 '해결'로 닫혔고 닫힐 때 불 칸 0, 열이 0.2 넘는 칸은 한 건의 한 칸뿐이었다. `s.heat` 는 불붙기 전의 누적값이지 "탄 자리의 잔열"이 아니다. 그래서 **보통 교대의 재발화는 거의 0건**(60교대에 0~2건 — 한계 시간·방치·진입 금지로 끝난 화재에서만)이 이 법칙의 정직한 결과다. 잘 끈 화재에서도 재발화가 나오게 하려면 "물과 잔불 정리가 닿지 않은 탄 칸의 잔열"이라는 새 물리가 필요한데, 그것은 화재 균형에 닿는다 — **N9 뒤 화재 균형을 다시 볼 때 함께 정한다**(사용자 결정 — §9).
- **AI 가 아는 길**: 새 사건은 신고로. **'재발화' 이름표는 이번에 넣지 않는다** — `knownBuildingAt` 은 건물이 아니라 교차로와 건물 종류로 찾으므로 같은 교차로·같은 종류의 두 번째 화재면 이름표가 붙는데, 이 법칙이 실제로 내는 사건은 보통 60교대에 0~2건이라 붙는 이름표의 거의 전부가 틀린 이름표가 된다. 잘 끈 화재에서도 재발화가 나오는 물리(탄 칸의 잔열 — N9 뒤 화재 균형 때)와 함께 넣는다. b3-9 는 법칙과 C10 만이다.
- **테스트**: ① 불씨를 남기고 닫은 화재(시험이 한 구역의 `fire`·`heat` 를 채우고 닫는다) → 같은 건물에 예약, 부모·원인, 시각이 식과 맞는다. ② **개입**: 닫기 전에 그 배열을 0 으로 → 예약이 없다. ③ 잔불 정리를 마친 현장은 `e0 = 0`. ④ 전소 건물에는 예약하지 않는다.

#### C10 `suspectZone` — 도주한 무장 용의자 (L8 — 조건으로 움직이는 지금 설계를 둔다)

초과 위험 과정으로 바꾸지 않는다. 까닭: 달아난 용의자가 다시 범행하는가는 물리 상태의 적분이 아니라 **행위자의 선택**이고, 재범은 사용자가 그대로 두라고 한 이야기 연쇄다. 이 절이 더하는 것은 스크립트가 아니라 조건이다 — 재범은 "근처에 경찰이 없을 때만" 일어나고(순찰이 막는다), 도주는 구역의 위험 상태를 올려 관제의 판단을 바꾼다.

- **기존 재범 연쇄 고치기**(`hazards.ts` 도주 블록): 난수 흐름 `reoffend:<사건>:<용의자>` 는 b1 이 넣었다. 남은 것 — 장소는 도주 지점에서 900 안의 `ARMED_BIAS.robbery` 종류 건물(없으면 평소 추첨. `ARMED_BIAS` 를 export 한다 — §7), `csq: 'reoffend'`, `cause` = SUSPECT_FLED 기록(b0). `when`: 목표 건물 400 안에 경찰 부대(`dept === 'police'`, `available` 또는 `returning`)가 없을 때, `until = at + 240`.
- **구역 위험**(신호 `fled`): 도주 지점의 동네(`zoneOfXY(sig.x, sig.y)` — 세계 규칙이라 진실 위치를 쓴다. -1 이면 하지 않는다) `risk = max(risk, 0.6)`, `until = t + 300`, `known` = SUSPECT_FLED 기록이 진실이 아니면(부대가 본 도주). 알려지면 `emit({ role: 'DISPATCH', actor: '관제', kind: 'dispatch', tag: 'risk', imp: 1, causes: [도주 기록], text: '○○동 일대 무장 용의자 도주 — 인근 신고의 경계 단계를 높입니다.' })`.
- **관제가 쓰는 곳**: 분석 AI 가 새 신고의 구역을 `knownZoneOfIncident(sim, I)` 로 구하고, `knownZone` 의 `risk` 가 있으면 그 동네의 무장·폭력 신고에 위험도 +0.3, `needs.law` +1.
- 쿨다운: 동네마다 120초. 난수 `csq:suspectZone:zone:<z>`(쓰지 않는다 — 확률 판정이 없다).

#### C4 `powerOut` — 전력 (상태 결합)

정전은 **상태**다. 사건을 직접 만들지 않는다 — 꺼진 신호는 혼잡으로 L1 에, 멈춘 승강기는 L5 에, 긴 정전은 C8 에 닿는다.

- **원인들**(등록하는 규칙 셋 — `world/rules/infra.ts`: 사건의 신호를 받는 `powerOut`, 재난의 신호를 받는 `powerOut.grid`, 원인이 끝난 것을 받는 `powerOut.end`):
  - (가) `substation`·`powerPlant` 건물의 사건에서 `fireBig`·`blast`·`collapse`·`catastrophe` → 변전소 700 · 발전소 1100 안에 가운데가 있는 동네 **전체** `power = 0`. 평소에는 거의 나오지 않는다(변전소 27교대에 한 번, 발전소 13교대에 한 번 그 건물에서 사건이 나고, 정전까지 가려면 큰 불이나 폭발로 커져야 한다 — 보통 60교대에 0~3번).
  - (나) 태풍의 정전 — **신호 `blackout`**(§3.4 — `disaster.lightsOut` 이 `data 1`, `lightsOn` 이 `data 0` 으로 보낸다. `ev` = 그 자리의 `tell` 반환값): `data 1` 이면 모든 동네 `power = 0`, `cause = sig.ev`, **`known = true` 를 곧바로**(재난 알림 '강풍에 송전선이 끊겨 …'가 이미 알렸다). **동네별 알림·복구 기록은 남기지 않는다** — 같은 사실이 서른여섯 줄 더 남는다. 지금의 도시 전체 `bump` 는 그대로 두고(장부 줄만 — §3.6b) 아래 1번의 `bump` 는 더하지 않는다(두 번 얹지 않는다). `data 0` 에서 그 원인의 구역 값을 되돌린다(`endZoneBy(sim, 그 ev, sim.t)`).
  - (다) 지진 — **신호 `quake`**(`disaster.onImpact` 의 본진 `mag 1` · `tickQuake` 의 여진 `mag 0.6`, `x`·`y` = 진앙 `d.epi`, `ev` = 그 `tell` 의 반환값. 재난의 `d.intensity` 는 `onImpact` 안에서는 아직 0 이라 읽지 않는다): 동네마다 흔들림 `sig.mag × max(0, 1 − 거리(진앙, 동네 가운데) / 900)` 이 그 동네 전력망의 문턱 `0.3 + 0.5 × u_z`(`u_z` = 흐름 `grid:power:<z>` 의 첫 값 — 쓸 때마다 `fork` 로 다시 계산한다, §3.6c)을 넘으면 `power = 0`, `until = t + 240`. 여진은 `mag 0.6` 이라 본진에서 꺼지지 않은 동네 가운데 문턱이 낮은 곳만 끈다(이미 꺼진 동네는 `setZone` 이 "더 나쁜 값만" 받으므로 다시 걸리지 않는다). **예전의 "진앙 600 안 동네마다 확률 0.5"를 대신한다.** (지진 큐가 이미 승강기 갇힘을 직접 일으킨다 — L5 와 수로 겹치므로 지진 20교대의 승강기 사건이 기준 +1/교대 안인지 본다.)
  - (라) **흩어진 설비**(새로 — 사용자의 예에 맞는 것은 시설이 아니라 이것이다): 붕괴·폭발 자리의 전선이 끊긴다. 그 자리가 받은 충격(L3 (가)의 식에 틈 0 을 넣은 값 — 전체 붕괴 0.6 · 무너진 채 시작하는 사건 0.35 · 폭발 `K_SHOCK × mag / 100 × (1 − 2 / (size + 2))`: 반경 6칸·피해 50 이면 0.3)이 **그 자리 전선의 문턱** `0.15 + 0.6 × u`(`u` = 흐름 `grid:line:<건물>`, 길 위면 `grid:line:n<교차로>` — 쓸 때마다 다시 계산)을 넘을 때만 **국지 정전** `setZoneArea(sim, 'power', 0, t + 600, sig.ev, false, { x, y, r })`(§3.6c — 원이 닿는 동네마다 같은 자리로). 반경: 폭발 `30 + 8 × size` · 전체 붕괴 90 · 무너진 채 시작하는 `collapse`(`size ≥ 10`) 70. 문턱을 두는 까닭: 문턱이 없으면 모든 폭발·큰 붕괴가 **반드시** 국지 정전을 낳아 고정된 순서가 된다(전체 붕괴의 75% · 큰 가스 폭발의 25% 쯤이 끊긴다 — 작은 용기 폭발은 닿지 않는다).
- **회복 — `until` 을 `Infinity` 로 두지 않는다.** (가)(라)는 처음부터 `t + 600`(상한 — 원인 사건이 끝나지 않아도 복구된다)으로 넣고, 원인 사건의 `closed` 신호는 **따로 등록한 규칙 `powerOut.end`**(열쇠 `inc:<사건>`, 쿨다운 0, 상한 없음, `silent`)가 받아 그 사건의 기록을 원인으로 가진 구역·국지 값의 회복 시각을 `min(지금 값, t + rng.range(60, 120))` 으로 당긴다(`endZoneBy` — `setZone` 은 늦추기만 한다). 정전을 거는 규칙이 `closed` 도 받으면 그 규칙의 쿨다운·상한에 먹혀(틀은 쿨다운과 상한을 `test` **앞**에서 본다) 동네의 전력 0 과 구간의 `bump` 가 교대 끝까지 남고 L1 의 `dark` 몫이 내내 쌓인다. (다)는 `t + 240`. (기간의 난수는 내용이지 "일어나는가"의 주사위가 아니다.)
- **결과**: 알림 `emit({ role: 'SYSTEM', actor: '한국전력', kind: 'hazard', tag: 'power', imp: 2, causes: [sig.ev], text })` 는 `rng.range(20, 40)` 초 뒤(그때 `known = true`. 그 전에는 진실만 바뀐다 — 진실이 바뀌는 자리의 기록은 원인 기록 자신이다). 문구: 동네 전체면 '○○동 일대 정전 — 신호등이 꺼졌습니다.', 국지면 '{원인 건물} 주변 정전 — 인근 신호등이 꺼졌습니다.'(범위를 부풀리지 않는다). 복구 때 '… 전력 복구.'(`recover`).
  1. **꺼진 신호**: 정전 범위 안에 가운데가 있는 구간들에 `addBump(sim, 구간들, 0.4, 원인 기록, 1, 원인 사건)` — **정전 한 건마다 한 번**, 돌려받은 id 를 그 건의 장부(`world.spans` — §3.3)에 두고 그 건이 끝날 때 `removeBump` 를 한 번 부른다(`recover` 는 구역·칸마다 불린다 — 거기서 빼지 않는다, §3.6b). → L1.
  2. **승강기**: 정전 범위 안의 건물에 정전이 닿은 순간을 L5 에 알린다(`expo.darkened` — 아래. 태풍의 `blackout` 도 이 규칙이 부른다 — 재난 코드는 신호만 보낸다).
  3. 120초 넘게 이어지면 C8 에 넘긴다(통신 기지국 예비 전원 소진).
  4. 정전 범위 안의 병원은 `cap − 2`(발전기 운용) — C3 와 맞물린다.
- 열쇠·쿨다운·상한: `powerOut` 은 열쇠 `ev:<sig.ev>`(신호마다 — 한 신호가 여러 동네를 끈다), 쿨다운 0, 상한 교대당 6. 같은 동네의 겹침은 `setZone` 이 막는다(이미 꺼진 곳은 다시 걸리지 않고 알림도 다시 남지 않는다). `powerOut.grid`(`quake`·`blackout`)는 상한 없음. 난수 `csq:powerOut:…`(기간·알림 지연).
- 관제: `knownZone(knownZoneOfIncident(sim, I)).power < 1` 이면 그 교통사고·승강기 신고 위험도 +0.3. 현장의 어둠(시야 반경)은 첫 판에 넣지 않는다.
- N8 이 더하는 신호 `'powerCut'`(원격 차단 — 그 동네의 `power = 0`)는 `powerOut` 의 `on` 에 그대로 붙는다.
- **테스트**: 변전소 사건으로 구역이 꺼지고 20~40초 뒤 알려지며 범위 안 구간에 `bump` 와 장부 줄. **사건이 정전 100초 뒤에 닫혀도 60~120초 뒤 복구되고, 닫히지 않아도 600초 뒤에는 복구된다.** 동네 둘에 걸친 국지 정전이 복구된 뒤 그 구간들의 `bump` 가 얹기 전 값과 같다. 붕괴 자리의 국지 정전은 원 밖 건물을 끄지 않고, 문턱이 높은 자리(시험이 고른 시드)는 끊기지 않는다. 같은 동네의 둘째 폭발이 자리를 가져가면 원인·회복 시각도 둘째의 것이다. `blackout` 신호는 동네별 기록을 남기지 않는다.

#### L5 `liftStall` — 정전이 닿는 순간 운행 중이던 승강기

- **읽는 상태**: 건물에 정전이 닿는 **순간**(전이) — 구역·국지 전력이 그 건물을 끄는 때(C4 — 사건·태풍·지진), 지하가 잠겨 전기실이 꺼지는 때(L6 `expo.dark`). 그 건물의 층수·종류와 교대의 시간대.
- **원인들**: 변전소·발전소 사고 · 붕괴·폭발 자리의 끊긴 전선 · 태풍 · 지진 · 홍수의 침수 · (N8) 원격 차단.
- **식**(충격): 승강기가 있는 건물마다 그 순간 사람이 타고 있을 기대값 `ΔH = LIFT_RIDE × min(3, floors / 6) × occ(종류, 시간대)`. 첫 값 **`LIFT_RIDE = 0.006`**, `occ` = 주거(아파트·오피스텔) 1(출근·퇴근 시간대 1.5, 심야 0.4) · 사무용 1.5(심야 0.1) · 호텔·그 밖 1. 어림: 도시 전체 정전이면 기대 약 1.2건, 한 동네(한솔동)면 0.5건, 국지 정전(반경 90 — 건물 10~20채 가운데 4층 이상 1~3채)이면 0.02 안팎이다. (초안의 0.015 는 도시 전체 정전에 약 3건 — 태풍 목표 0.5~2건을 넘고 부모 없는 사건의 상한 3 을 혼자 다 써 L1 의 꺼진 신호 몫이 남지 않았다.) **단위**: 승강기 갇힘의 평소율은 교대당 0.25건(아파트 한 채 0.0013건).
- **대상·문턱**: `floors ≥ 4` 이고 **승강기 갇힘 시나리오가 받는 종류**(`scenarioOf('collapse', 'elevator').places` — 아파트·사무용·오피스텔·호텔·백화점·대학·의원·역. 4층 이상 151채 가운데 그 종류만)이며 **쓸 수 있는 건물**(`placeState().usable`). 건물마다 한 번 — 흐름 `hz:liftStall:<건물>`. `world/expo.ts` 의 `darkened(sim, placeIds, part)` 가 건물마다 `hazardImpulse` 를 부른다(정전을 거는 규칙들이 이 함수를 부른다 — 법칙은 누가 껐는지 모른다. `scan` 이 없는 법칙이다).
- **나는 사건**: `collapse/elevator`, 그 건물, 규모 1, 첫머리 '정전으로 승강기가 멈춰 안에 사람이 갇혔습니다'. 원인 = 정전을 만든 기록(구역의 `cause.power` · 태풍의 정전 기록 · 침수 기록), 부모 = 그 기록의 사건(있으면). 몫 `{ what: 'outage' }`(침수면 `'level'`). 그 건물에 열린 사건이 있으면 틀이 기다리게 한다(§3.6a — 기다리는 줄, 60초).
- **상한**: 법칙 상한 3. `hazardRoom`(부모가 없으면 — 태풍·지진·홍수 — 부모 없는 법칙 사건 3건).
- **테스트**: ① 정전이 없는 교대에는 칸이 없다. ② 시험 상수로 `LIFT_RIDE` 를 키우고 한 동네를 끄면 그 동네의 4층 이상·그 종류의 건물에서만, 건물마다 많아야 한 번, 사건의 `truth.placeId === hz.target`. ③ **개입**: 같은 시드에서 정전을 걸지 않은 쪽에는 그 원인의 승강기 사건이 없다. ④ 문턱은 누가 껐는지와 무관하다 — 같은 시드·같은 건물에서 변전소 정전과 태풍 정전의 `thr` 이 같다. ⑤ 전소 건물과 사건 중인 건물: 앞은 버려지고(`'expired'`) 뒤는 기다린다.

#### C8 `commsDown` — 무전 음영이 늘어난다 (상태 결합)

- **원인들**: (가) `broadcast`·`tower` 건물 사건의 `fireBig`·`blast`·`collapse`·`catastrophe` → 800 안 동네 `comms = 0.4`(관제탑은 어느 유형의 표에도 없어 강제로 일으키지 않으면 걸리지 않고, 방송국도 23교대에 한 번 — 드문 갈래다). (나) C4 의 정전이 120초를 넘김 → 그 범위(국지면 같은 자리) `comms = min(comms, 0.6)`. (다) 지진(신호 `quake` — 흔들림은 C4 (다)의 식) → 동네마다 흔들림이 문턱 `0.35 + 0.5 × u_z`(흐름 `grid:comms:<z>` — 쓸 때마다 다시 계산)을 넘으면 0.5 — **예전의 "확률 0.4"를 대신한다.** (라) 태풍 정전(신호 `blackout`) 120초 → 모든 동네 0.7(동네별 기록 없이 알림 한 줄).
- **결과**: `until` = 원인 종료 + 180초(지진 300초). 그 범위의 열린 현장과 이후 만들어지는 현장에 음영을 더한다: 바닥 칸의 `(1 − comms) × 0.3` 만큼을 3~5개 덩어리(반지름 2~3칸)로 골라 `s.shadow = 1`, 고른 칸을 `s.shadowAdd` 에(회복 때 원래 값이 0 이던 칸만 되돌린다). 고르는 난수 `csq:shadow:<현장 id>`. 이 뒤의 COMM_FAIL·재배정은 지금 코드가 한다(재계획 `field`).
  - 알림(`tag: 'comms'`, `known = true`)은 (가)·(다)·(라)는 바로, (나)는 그 범위 현장의 첫 COMM_FAIL 이 나온 때(그 기록을 `causes` 로).
- 쿨다운: 동네마다 300초. 상한 교대당 3. 사건을 만들지 않는다. 현장 음영을 고치는 것은 현장 진실의 변화라 `world/rules/infra.ts` 가 `sim.scenes` 를 고친다(세계 규칙과 같은 자격). 음영은 매 프레임 그린다 — `staticSig` 는 고치지 않아도 된다.

#### C5 `smokePlume` — 연기 (상태 결합)

- **원인들**: 큰 불이 이어지는 현장(불 칸 `> 0.2` 가 `FIRE_BIG` 30 이상인 채 45초 — 현장마다 시각을 기억) · 산불의 불머리(`d.front`, 꺼지지 않은 동안) · 전소로 가는 건물.
- **결과**: 연기가 덮은 자리 = 원인 지점에서 `r = 450 × √min(1, 불 칸 / 60)` 안(산불은 불머리 반지름 + 300), 세기 `0.6 × min(1, 불 칸 / 60)`(산불 0.7). `setZoneArea(sim, 'smoke', 세기, 불이 기준 아래로 내려간 시각 + 120, 알림 기록, true, { x, y, r })`. 처음 한 번 `emit({ role: 'SYSTEM', actor: '재난안전본부', kind: 'hazard', tag: 'smoke', imp: 1, causes: [그 현장의 불 기록 — L2 의 `ev` 규칙: 발생 기록 또는 X6 의 폭발·전소 기록. `ESCALATION` 은 쓰지 않는다], text: '○○ 화재의 연기가 △△동으로 번지고 있습니다. 창문을 닫아 주십시오.' })`, `known = true`(눈에 보인다).
  1. **주민**: L4 가 읽는다.
  2. **현장**: 연기 자리의 실외 현장(`s.outdoor`)에 구조 대상 실외 노출 `+0.08 × 세기`(`field/rules/` 에 `registerRule` 로 — 현장 규칙은 그 자리에 둔다).
  3. **도로**: 연기 자리 안에 가운데가 있는 구간들에 `addBump(sim, 구간들, 0.2 × 세기, 알림 기록, 2, 원인 사건)` — 연기 한 건마다 한 번, id 를 그 건의 장부(`world.spans`)에 둔다. 세기나 반경이 달라지면 거두고 다시 얹고, 끝나면 `removeBump` 를 한 번 부른다(`recover` 에서 빼지 않는다 — §3.6b). → L1(`haze`).
- 사건을 만들지 않는다. 난수 없음.

#### L4 `smokeIll` — 연기를 오래 마신 동네에서는 환자가 난다

- **읽는 상태**: 건물 자리의 연기 `c = 그 연기 자리의 세기 × (1 − 거리 / r)`(= `zoneAt(sim, 'smoke', 건물 가운데) × (1 − 거리 / r)` — 매초 건물마다 `zoneAt` 을 부르지 않고 그 자리의 대상 목록에서 바로 계산한다, §3.6a "주기와 비용"), 그 집의 **평소 응급률**.
- **원인들**: 건물 화재 · 대형 화재 · 산불 · (N9) 독성 공기를 구역 연기로 올리는 사건 — C5 가 받는 모든 것.
- **식**: `λ_p = base_p × RR_SMOKE × c`. `base_p`(초당) = 평소 응급의 장소 표에서 그대로 온다 — `교대당 응급 건수 × INCIDENT_PLACES.medical[종류] / 표의 합 ÷ 그 종류의 건물 수 ÷ 1,050초`(교대당 응급 건수는 상수 `MED_PER_SHIFT` — 조사 때의 어림 2.1 로 아래 값이 나왔다. b3-11 이 기준 파일의 보통 60교대에서 다시 읽어 적는다)(아파트 8.3 × 10⁻⁶ · 큰 주택 4.8 · 오피스텔 4.7 · 다세대 4.5 · 작은 주택 1.9 — 모듈에서 한 번 계산한다(시드와 무관하다). 인구의 대용치를 따로 만들지 않는다: 그 표가 이미 "어느 집에서 환자가 나는가"다). 첫 값 `RR_SMOKE = 25` — **단위: 연기가 짙은(c = 1) 집은 평소 응급률의 25배가 더해진다.** 모양: 주택가 13채가 `c = 0.5` 로 300초 → 기대 0.2건, 아파트 단지면 0.4건.
- **대상·주기·문턱**: 연기 자리마다 가까운 주거 건물 40채까지(응급의 장소 표에 몫이 있는 종류), 1초, 흐름 `hz:smokeIll:<건물>:<n>`. **불이 난 그 건물과 열린 사건이 있는 건물, 쓸 수 없는 건물은 뺀다** — 가장 가깝고 연기가 가장 짙은 건물은 불이 난 그 건물이다. 그 건물의 연기 환자는 화재 현장의 구조 대상이지 따로 열리는 사건이 아니다(거르지 않으면 같은 건물에 현장이 둘이고 뒤 현장에는 불이 없다).
- **나는 사건**: **변형 `medical/smoke`**(첫 판부터 따로 둔다), 그 건물, 규모 1, 첫머리 '연기를 마신 주민이 숨쉬기 힘들어합니다'. 현장은 응급 주택 틀 그대로(실신과 같은 틀), 구조 대상의 처음 부상 원인은 `smoke`(`initInjuries` 의 표), **`tickMedical` 의 급변 대상이 아니다**(그 함수는 변형이 `faint`·`trauma`·`arrest` 일 때만 급변을 뽑는다 — 확인됨). `medical/faint` 에 첫머리만 바꿔 쓰지 않는 까닭: 실신 현장은 "실신의 원인은 부정맥이었습니다"로 급변할 수 있어, 발생 기록은 '연기를 마신 주민'인데 같은 환자를 두고 기록 둘이 다른 말을 한다. 변형을 넣을 자리: 응급 현장 생성의 변형 갈래(`builders.ts` — 모르는 변형이 실신의 틀로 가는지 **확인 필요**)·`scenarioName`·신고 문구(호흡 곤란). **변형을 두지 못하면 L4 는 등록하지 않는다**(그 `import` 줄을 빼고 보고에 적는다).
- 원인 = 연기 알림 기록, 부모 = 그 화재 사건(산불이면 없음). 몫 `{ what: 'smoke', ref: 불난 건물 }`.
- **상한**: 법칙 상한 3. 화재 하나에서 난 것은 `hazardRoom` 의 "한 뿌리의 가지 2"가 옮겨붙은 불과 합쳐 묶는다.
- **테스트**: ① 연기가 없는 교대에는 칸이 없다. ② `base_p` 의 합이 표에서 손으로 계산한 값과 같다. ③ **개입**: 같은 시드에서 한쪽만 구역 연기를 0 으로 되돌리면 그쪽에는 연기 환자가 없다. ④ 연기 자리 밖의 건물은 쌓이지 않는다. ⑤ 불이 난 건물은 대상이 아니다. ⑥ `medical/smoke` 현장의 환자는 급변하지 않고 부상 원인이 `smoke` 다.

#### L6 `floodLow` — 수위가 문턱 높이를 넘으면 잠긴다 (문턱 상태 — 사건은 L5·L1 이 낸다)

홍수의 도로는 이미 이 꼴이다: 구간마다 문턱 `d.thr`(다리 0.9, 그 밖 `max(0.25, 강까지의 거리 / 80)`), 수위가 `0.7 × thr` 을 넘으면 느려지고 `thr` 을 넘으면 통제한다. 같은 법칙을 건물로 넓히고, 차오르는 물이 길에 만드는 상태를 교통의 초과로 잇는다. **이 절은 사건을 직접 만들지 않는다**(`HazardLawId` 에 없다) — 상태 규칙 `floodLow`(`world/rules/infra.ts`, `on: 'tick'`, 열쇠 `'flood'`, 쿨다운 5초, `silent`. 재난의 수위 `d.level` 을 읽는 것은 상태 규칙이라 된다 — 법칙 파일은 재난을 읽지 않는다)다.

- **건물 갈래(상태)**: 강에서 가까운 건물(문턱 ≤ 1.15 — 54채: 작은 주택 18·다세대 9·카페 7·큰 주택 6·식당 4·상점 3·오피스텔 2·그 밖 5)마다 문턱 높이 `thrP = max(0.3, riverDist(건물 가운데) / 80) × (0.85 + 0.3 × u_p)`, `u_p` = 흐름 `hz:floodLow:b<건물>` 의 첫 값(건물마다 한 번 — 그 건물의 지하가 얼마나 낮은가. **`world.sills[건물]` 에 둔다** — 처음 볼 때 채운다. 시드에 따라 달라지는 값이라 도시 열쇠의 캐시에 두지 않는다, §3.6c. `riverDist` 는 시드와 무관해 `city.places` 열쇠의 `WeakMap` 에 둬도 된다 — `disaster.geoOf` 는 내보내지 않는다). 홍수 중 5초마다 `d.level > thrP` 를 본다. 넘는 순간 `expo.wet = true`(→ `placeState().wet` — I2·N9 가 읽을 자리).
  - **4층 이상 건물만**(정전이 승강기에 닿는 건물 — 54채 가운데 오피스텔 둘): 기록 `emit({ role: 'SYSTEM', actor: '도시', kind: 'hazard', imp: 0, truth: true, causes: [수위 알림 기록 d.levelEv], text: '{건물} 지하가 물에 잠겨 전기가 끊겼습니다.' })` → `wetEv`, `expo.dark = sim.t`(전기실) → `darkened(sim, [건물], { ev: wetEv, inc: −1, what: 'level', ref: 건물 })` → **L5**. (예전 C7 의 "지하 주차장이 잠기며 승강기에 사람이 갇혔습니다"는 이 길로 난다 — 드물다.)
  - 그 밖의 건물은 `expo.wet` 만 적고 **기록을 남기지 않는다**(홍수마다 '지하가 물에 잠겼습니다'가 45줄쯤 남는데 뒤따르는 것이 없다 — 결과가 없는 상태 변화로 기록을 불리지 않는다. 교대 요약의 `world` 에 "침수 건물 n채" 숫자만).
  - **잠긴 지하에 갇힌 사람의 구조 현장은 이번에 만들지 않는다** — 그릴 현장 틀이 없다(N9 뒤 — §8).
- **구간 갈래 — 따로 두지 않는다.** 초안은 "구간이 통제되는 순간 `FLOOD_CAR × V` 의 충격 → `water/std`"였는데, 그 상태를 만드는 원인이 홍수 하나뿐이고 식이 "통제 순간 한 번"이라 **"홍수가 길을 잠그면 확률 p 로 사건"과 같다 — 이름만 바꾼 스크립트다**(없앤 C7 과 같은 모양이고 홍수 큐의 `floodCar` 와도 겹친다). 또 `water/std` 는 하천 현장(강에 떠내려가는 사람)이라 발생 기록 '물에 잠긴 길에 차가 갇혔습니다'와 현장이 맞지 않는다. 대신: `disaster.floodRoads` 가 구간을 **느리게 하는 동안**(수위가 그 구간 문턱의 0.7 과 1 사이 — 물이 차오르는데 아직 열려 있는 길, `e.slow += FLOOD_SLOW`) 교통 장부의 `exOwn` 에 `'level'` 항 하나(0.8, 원인 = 수위 알림 기록)를 적고 느림을 거둘 때 지운다(§3.6b). **L1 이 그 구간을 다른 몰림과 같은 법칙으로 본다** — 물이 천천히 차오른 길일수록, 통행이 많은 길일수록 사고가 나기 쉽다. 사건은 `traffic/std`, 재난 꼬리표 없음. 통제된 뒤에는 닫힌 구간이라 0 이고, 그 통제가 예 ① 의 길(우회 몰림)을 연다.
- **N9 가 여기에 대상을 더한다**(N9 §5.12): 지하차도 구간(`underpassEdges` — 중앙대로 e196)은 강에서 400 넘게 떨어져 `d.thr ≥ 5` — `floodRoads` 가 영영 느리게 하지도 닫지도 않는다. I1-b 는 `disaster.ts` 에서 구간의 문턱을 읽는 자리를 함수 하나로 뽑아 둔다 — `roadSill(sim, d, e)`(지금은 `d.thr[e.id]` — 해시 불변). N9 가 그 함수에 한 줄을 더해 지하차도 구간에 낮은 문턱을 준다(`thrU = 0.6 × (0.85 + 0.3 × u)`, `u` = 흐름 `hz:floodLow:u<구간>` — 시드에 따라 달라지는 값이라 `sim.world` 안에 둔다, 칸은 N9 가 정한다). 그러면 물이 차오르는 동안 그 구간이 `'level'` 로 L1 에 들어가고, **N9 는 L1 의 `spawn` 에 "주된 몫이 `level` 이고 그 구간이 지하차도면 결과를 `water/underpass` + `underpassNode` 로" 한 줄**을 더한다(결과의 이름이라 `spawn` 안에 둔다).
- **테스트**: ① 홍수가 아닌 교대에는 아무것도 없다(`world.sills` 가 비어 있다). ② 수위를 손으로 올리면 문턱 순서대로 잠기고, 기록은 4층 이상 건물에서만 건물마다 한 번. ③ **개입**: 수위를 문턱 아래에 묶어 둔 쪽에는 침수도 그 원인의 사건도 없다. ④ 느려진 구간에 `exOwn` 의 `level` 몫이 있고 통제되면 0, 느림을 거두면 장부가 비워진다. ⑤ 한 프로세스에서 다른 시드를 먼저 돌려도 문턱이 같다(§6 I1-b 1).

#### C11 `waterMain` — 소화전 수압 저하 (상태 결합 — 선택)

- **원인들**: 붕괴·폭발 자리의 관(L3·C4 (라)와 같은 신호 — 전체 붕괴 · 폭발 · 무너진 채 시작하는 `collapse` `size ≥ 10`): 그 자리가 받은 충격(C4 (라)와 같은 값)이 **그 자리 수도관의 문턱** `0.15 + 0.6 × u`(흐름 `grid:main:<건물>`, 길 위면 `grid:main:n<교차로>`)을 넘을 때만 반경 80 의 국지 `water = 0.5`. 지진(신호 `quake`) → 동네마다 흔들림(C4 (다)의 식)이 문턱 `0.4 + 0.5 × u_z`(흐름 `grid:water:<z>`)을 넘으면 동네 전체 0.5 — **예전의 "확률 0.3"을 대신한다.** (예전 글의 "신호 `collapse`(size ≥ 10)만"으로는 "화재 → 붕괴 → 수도관"이 걸리지 않는다 — 2차 붕괴의 `size` 는 0~3 이고 X6 의 붕괴는 `catastrophe` 신호다.) N8 의 `'pipeBurst'` 가 이 규칙의 `on` 에 붙는다.
- **결과**: `until = t + 300`. 그 범위 현장의 급수: `executor.spray` 의 `if (!u.hydrant)` 를 "급수 연결이면 유입 `1.5 × water` 에서 유출을 뺀 만큼 물이 준다"로 바꾼다 — `water = 1` 이면 지금 갈래(줄지 않는다)를 그대로 타야 해시가 남는다. 첫 WATER_OUT 의 문구에 '소화전 수압이 낮습니다' 를 덧붙이고 그때 `known`(그 기록을 `causes` 로 `tag: 'water'` 알림). 관제: 알려지면 그 동네 화재에 `needs.suppression` +1.
- 사건을 만들지 않는다. 난수 없음(문턱만).

#### 뒤 묶음이 기대하는 이름 (I2 · N8 · N9 — 깨지 않는다)

- **I2**: `knownBuildingAt`·`placeState`·`WorldTag`·`ObstacleKind 'rubble'` 은 그대로다. `placeState` 의 돌려주는 값에 칸(`shake`·`pipe`·`wet`)이 **더해질 뿐**이고, `WorldTag` 끝에 `'struct'` 가 하나 늘어난다(I2 의 `'carry'` 는 그 뒤에). **I2 가 알아야 할 것**(주 세션이 I2 설계서에 적는다): ① `Scene.wear` 를 I1-b 가 먼저 채운다(`cause: 'shock'`) — `applyPlaceWear` 는 `dmg` 의 큰 쪽으로 합친다. ② `WEAR_INTEG` 는 `catastrophe.CAT` 에 있다 — I2 §10.1 의 `persist.ts` 상수 줄을 "그 값을 읽는다"로. ③ 측정 도구의 `S(I)` 는 `s.wear.cause === 'shock'` 을 `building` 으로, 그 밖을 `carry` 로 센다(§7). ④ 교대 끝의 `world.expo[p].shake` 는 `PlaceCarry.dmg` 의 원천이 될 수 있다(I2 단계 5 의 `placeOutcome` — 넣을지는 I2 가 정한다).
- **N8**: `registerConsequence`·`spawnConsequence`·`'closed'`·`gen.chain` 의 `when`/`until`·`canChain`·`PROBLEM_SYS`·`PHRASE`·`WorldTag` 그대로. C4 `powerOut`·C10 `suspectZone`·C11 `waterMain` 은 **같은 id 의 상태 규칙으로 남는다**(N8 의 `'powerCut'`·`'pipeBurst'` 가 그 `on` 에 붙는다). `SignalKind` 끝에 `'quake'`·`'blackout'` 이 는다(N8 이 더하는 신호는 그 뒤에). N8 §5.6 의 조건부 연쇄 여덟(K1~K8)은 "X 가 실패하면 Y" 꼴이다 — N8 을 구현할 때 이 문서의 방향(§3.1)에 비춰 초과 위험의 법칙으로 옮길 수 있는지 본다(예: 수도관 → 싱크홀 → 교통사고의 끝 화살표는 L1 이 저절로 한다).
- **N9**: C3 `hospitalLoad` 그대로. **C1 `blastSpread` 는 이름이 없어졌다** — N9 가 기대하는 "공장 폭발 → 옆 건물 화재가 저절로"는 L2 `heatSpread`(공장 폭발의 불티·큰 불의 열)가 한다. **C7 `floodLow` 는 id 와 자리(`world/rules/infra.ts`)가 그대로지만 사건을 만들지 않는 상태 규칙이 됐다** — N9 가 고칠 "지하차도 갈래"는 위 L6 의 끝 줄(`disaster.roadSill` 에 한 줄 + L1 `spawn` 에 한 줄)이고, 사건에 `'disaster:flood'` 꼬리표는 붙지 않는다. **N9 구현 전에 주 세션이 고칠 N9 설계서의 글자**(줄 번호는 2026-11-20 기준 — 글자로 찾는다): 연관 표 24행 "규칙 C1 `blastSpread`" → "법칙 L2 `heatSpread`(불티 항)" · 81행 "C7 `floodLow` 의 지하차도 갈래를 … 바꾸는 한 줄, C1·C3 은 저절로" → "L6 에 지하차도 구간의 문턱(`roadSill`)과 L1 `spawn` 의 한 줄, L2·C3 은 저절로" · 441행 "I1-b C1 `blastSpread`(저절로 원천)" → "I1-b L2 `heatSpread`" · 598·955행의 "강가 교차로에 `water/std`"·"`opts.tag` 는 C7 의 `'disaster:flood'` 그대로" → 위 끝 줄 · 파일 표 1265행은 `world/rules/infra.ts`(상태)에 더해 `disaster.ts` `roadSill`·`world/laws/road.ts` `spawn`.

### 3.8 AI 가 아는 길 (정보 격리)

| 세계 상태 | 진실이 바뀌는 때 | 관제가 아는 길 | 현장 지휘관이 아는 길 | 판단에 쓰는 곳 |
|---|---|---|---|---|
| 도로 잔해(C2) | 사건 종료(남는 잔해)·큰 폭발 | 남는 잔해는 곧바로(종료 보고), 폭발 잔해는 T1: 제보·부대 보고(`known`) | 부대 무전 | `findRoute`·`etaFor`(이미 알려진 것만) |
| 응급실 포화(C3) | 체류 ≥ 한도 | 병원 알림(곧바로) | — | `startTransport`, 이송 중 목적지 변경 |
| 우회 몰림·초과 혼잡(§3.6b) | `drift`(12초)마다 — 닫힌 구간이 있는 동안 | 혼잡 값 자체는 지금처럼 교통 정보로 안다(`edgeTime` 이 `cong` 을 읽는다 — T1 부터 그렇다). **까닭은 모른다**: 알려지지 않은 통제(`known === false`) 때문에 몰린 길도 "막힌다"까지만 보인다. 관제 쪽 코드는 `tr.divert`·`excess`·장부(`closeEv`·`slowEv`·`qEv`·`bumps`)를 읽지 않는다 | — | `edgeTime`(지금과 같다) |
| 몰린 길의 사고(L1) | 문턱을 넘는 순간 | 신고(평소 사고와 같다) | 현장 | 평소의 분석·배정 |
| 건물의 열 노출·잔열(`world.hz`) | 곁의 불이 타는 동안 · 화재가 닫힐 때 | **알 길이 없다**(진실 전용). 옮겨붙은 불·재발화는 신고로 안다 — 알려진 큰 불·폭발(`knownHazardNear`) 곁의 화재 신고는 '연소 확대'. '재발화' 이름표는 이번에 넣지 않는다(L7) | 자기 현장의 불 | 분석 AI 이름표·위험도 |
| 이웃 건물의 손상(`world.expo` — 금·배관·침수) | 폭발·붕괴 순간, 수위가 넘는 순간 | 진실 전용(기록은 `truth: true`). 그 건물의 사건이 신고될 때 평소처럼. 알려진 붕괴·폭발 곁의 붕괴·가스 신고는 위험도 +0.3 | 그 건물의 현장에 닿은 뒤 **X6 의 조짐**으로(낮게 시작한 건전도는 삐걱임·균열이 빨리 올 뿐이다 — `s.wear`·`s.cat` 을 읽지 않는다), 새는 밸브는 본 대원의 `haz` 믿음으로(**`s.rules` 는 바뀌지 않는다** — 판단부가 생김새로 읽는 칸에 숨은 손상을 적지 않는다, §3.6c) | X6 의 지휘 규칙·누출 조치 그대로 |
| 정전(C4) | 원인 직후 | 알림 20~40초 뒤(구역 값 — 국지 정전도 "그 동네 어딘가"까지만) | — | 분석 AI 위험도 |
| 멈춘 승강기(L5) | 정전이 닿는 순간 | 신고 | 현장 | 평소대로 |
| 통신 장애(C8) | 원인 직후 | 알림 또는 첫 COMM_FAIL | 자기 현장의 COMM_FAIL | 지금의 재배정 |
| 수압 저하(C11) | 원인 직후 | 첫 WATER_OUT | 소화전이 느림(진실을 겪는다) | `needs.suppression` |
| 연기(C5) | 큰 불 45초 | 알림(곧바로) | 실외 노출을 겪는다 | 호흡 곤란 신고의 유형 판단 |
| 연기 환자(L4) | 문턱을 넘는 순간 | 신고 | 현장 | 평소대로 |
| 구역 위험(C10) | 도주 | 도주를 부대가 봤을 때 | — | 분석 AI 위험도·`needs.law` |
| 건물 상태(X6 `placeMarks`) | 붕괴·폭발·전소, 사건 종료 | 그 건물 사건의 종료 보고, 지난 교대에서 이어받은 것(I2). 관제는 건물 id 를 모르므로 알려진 교차로와 진술의 건물 종류로 찾는다 | — | 위험도(`knownBuildingAt`). '재발화' 이름표는 L7 의 물리와 함께 뒤로 |
| 알려진 큰 불·폭발·붕괴 | 그 순간 | **`world/state.ts` 의 `knownHazardNear(sim, node, within = 300, age = 180)` 하나로**: 위치를 아는 다른 사건 가운데 (불) 현장이 화재로 확인했고 현장 상황 보고가 위험도를 올린 열린 사건(`I.fieldRisk` — X6 §5.9. **확인 필요**: "현장 확인"의 칸 이름), (폭발·붕괴) **진실이 아닌** `EXPLOSION`·X6 의 폭발 문구인 `HIDDEN_HAZARD`(지휘관이 몰랐던 폭발은 이 코드로 남는다 — `EXPLOSION` 만 찾으면 대부분 놓친다)·`STRUCT_COLLAPSE` 기록이 `age` 안에 있는 것. 거리는 두 사건의 `reportedNode` 사이(관제는 교차로만 안다 — 60 이면 같은 교차로뿐이라 300). 큰 불 신호(`fireBig`)의 기록은 진실인 발생 기록이라 쓰지 않는다 — 길을 정해 두지 않으면 구현이 신호나 현장을 읽게 된다 | 자기 현장 | 근처 화재·붕괴·가스 신고의 이름표·위험도(분석 AI 는 이 함수만 부른다) |
| 전환·부족(C6) | 배정 | 관제 자신의 결정 | — | (기록만) |

- `dispatch/*`·`field/commander.ts`·`field/brain.ts`·`field/orders/*` 는 `sim.world` 를 직접 읽지 않는다. `knownZone`·`knownHospital`·`knownBuildingAt`·`knownZoneOfIncident` 만 쓴다(b2 의 소스 글자 검사 — `sim.world` 를 통째로 막으므로 `world.hz`·`world.expo` 도 이미 막혀 있다). 여기에 더한다(§6 I1-b 13 — 검사 대상에 `field/methods.ts`·`field/ops.ts`·`field/airDecide.ts`·`field/gear.ts`·`field/doctrine/*` 를 더한다): 그 파일들에 `world.hz`·`I.hz`·`fireLoad`·`zoneAt(`·`isDark(`·`.excess`·`.exDiv`·`.exQueue`·`.exOwn`·`.exBump`·`.divertBy`·`closeEv`·`slowEv`·`qEv`·`.bumps`·`.wear`·`expoOf` 글자가 없고(글자 `.hz` 로는 막지 않는다 — R3 교본의 `c.hz` 는 "위험 실내 일인가"라는 다른 칸이다. `/\bhz\.(?:src|law|target|at)\b/` 로 본다), 정규식 `/\b(?:tr|traffic)\.divert\b/` 에 걸리는 줄이 없다(`c.divertFrom`·`u.diverted`·`knownHospital().divert` 는 다른 것이다 — 글자 `.divert` 로 막으면 지금의 `dispatcher.ts` 에서 바로 실패한다). `src/sim/world/` 아래 어떤 파일도 `s.rules` 에 쓰지 않는다(`.rules.push`·`.rules =`).
- **`Incident.hz`·`cause`·`csq` 는 판단이 읽지 않는다**(b0 의 원칙 그대로 — 기록 전용 칸이다. 관제가 `I.hz` 를 읽으면 "이 사고는 저 통제 때문"을 신고 전에 아는 셈이다).
- **관제 쪽 위치는 알려진 것만**: 사건의 구역은 `knownZoneOfIncident`(= `zoneOfXY(city.nodes[I.reportedNode])`), 건물은 `knownBuildingAt(sim, I.reportedNode, placeKind)`. 분석 AI 와 배정 AI 는 `I.truth.x`·`y`·`placeId` 를 읽지 않는다. `callSystem.ts` 의 신고자 모델은 지금처럼 진실을 읽는다(신고자가 본 것을 정하는 자리).
- `resources.startTransport` 는 관제 쪽 결정이므로 `knownHospital` 과 `known` 인 통제만 쓴다.
- 세계 규칙(`world/rules/*`)·법칙(`world/laws/*`)·`world/hazard.ts`·`traffic.ts`·`hazards.ts`·`executor.ts` 는 진실을 읽고 바꿔도 된다.

### 3.9 보고서가 내력을 읽는 법 (`debrief.buildReport`)

`evaluate` 는 사건이 닫힐 때 돌고 그 뒤에 생기는 자식 사건을 모르므로, 문장은 **교대 끝의 `buildReport`** 가 만든다. 모두 기록(`I.parent`·`I.cause`·`I.csq`·`I.hz`·`Problem.ref`·`world.log`·`gen.dropped`)에서만 쓴다. **법칙의 이름으로 쓰지 않고 상태의 내력으로 쓴다** — "몰린 길의 사고 법칙"이 아니라 "○○로 통제(쓰러진 나무) 뒤 △△로에 차량이 몰린 동안 난 사고".

- `ShiftReport.incidents[k]` 에 `parent`, `children`(그 사건을 부모로 둔 사건 id), `chain`(문장 배열, 많아야 4줄):
  - **`I.hz` 가 있으면**(법칙에서 난 사건) 주된 몫(`hz.src[0]`)의 갈래로 한 문장, 둘째 몫이 있으면 "(… 도 겹쳤습니다)"를 덧붙인다. `{원인}` 은 그 몫의 기록에서 읽는다 — 주인 사건이 있으면 `사건 {코드} {이름}`, 장애물이면 그 라벨(`OBSTACLE_LABEL` — 공사·낙하물·고장 차량·건물 잔해), 재난이면 재난 이름, 정체·인파면 그 말. `{N}` = **그 몫의** `hz.at − src.since`(10초 단위 — 칸에 초과가 처음 생긴 시각이 아니라 그 원인이 걸린 시각부터다, §3.6a). 큰 몫 가운데 `ev < 0` 인 것이 있으면 "(까닭이 기록되지 않은 혼잡도 겹쳤습니다)"를 덧붙인다(관문이 0 을 지키므로 보통은 나오지 않는다).

| 갈래 | 문장 |
|---|---|
| `divert` | "{통제된 구간} 통제({원인}) 뒤 {사고 구간}에 차량이 몰린 동안(약 {N}초) 난 사고입니다." |
| `queue` | "{뿌리 구간}의 {통제·사고·정체}({원인})로 차가 밀려 있던 {사고 구간}에서 난 사고입니다." |
| `lane`·`jam`·`crowd` | "{한 차로가 막힌·정체 중이던·행사 인파로 막힌} {사고 구간}에서 난 사고입니다({원인})." |
| `dark` | "정전({원인})으로 신호등이 꺼진 {사고 구간}에서 난 사고입니다." |
| `haze` | "{원인}의 연기가 덮은 {사고 구간}에서 난 사고입니다." |
| `heat` | "{원인}의 불이 {N}초 넘게 이어지는 동안 바로 옆 {건물}에 옮겨붙었습니다." |
| `ember` | "{원인} 폭발의 불티가 옆 {건물}에 옮겨붙었습니다." |
| `shake` | "{원인}의 충격으로 금이 가 있던 {건물}이 {N}초 뒤 내려앉았습니다." |
| `pipe` | "{원인}의 충격으로 손상된 {건물}의 배관에서 가스가 샜습니다." |
| `residual` | "{원인}이 끝난 뒤 남은 불씨가 {N}초 만에 되살아났습니다." |
| `outage` | "{동네·건물} 정전({원인}) 순간 운행 중이던 승강기가 멈췄습니다." |
| `smoke` | "{원인}의 연기가 {N}초 동안 덮은 {동네}에서 난 호흡 곤란입니다." |
| `level` | (도로) "불어난 물이 차오르던 {사고 구간}에서 난 사고입니다({원인})." · (승강기) "불어난 물에 {건물} 지하가 잠겨 전기가 끊긴 순간 승강기가 멈췄습니다." |

  - 이야기 연쇄의 부모가 있으면(`csq` 가 `reoffend`·`getaway`·`hideout`·`arson`): "사건 {P코드} {P이름}에서 이어졌습니다 — {연쇄 이름}."
  - 자식이 있으면: "이 사건에서 이어진 사건: 12 교통사고(몰린 길), 14 화재(옮겨붙음)." — 괄호 안은 **그 부모가 주인인 몫**의 `what` 을 짧게 읽은 말이다(자식의 주된 몫이 다른 원인일 수 있다 — 태풍 정전이 주된 몫인 사고를 교통사고의 자식 줄에 "(꺼진 신호)"로 적지 않는다).
  - 그 건물에 `s.wear`(cause `'shock'`)가 있었으면: "이 건물은 사건 {코드}의 충격으로 이미 금이 가 있었습니다." (그 현장의 `wear` 와 `world.expo` 의 `shakeInc` — 왜 빨리 무너졌는가의 답이다.)
  - DIVERTED 에 `ref.lost` 가 있으면: "{부대}가 사건 {코드}({이름})로 돌려져 첫 도착이 약 {lost}초 늦었습니다."
  - `blockedBy` 가 있으면: "{수요} 부대가 사건 {코드들}에 묶여 {N}초 동안 배정하지 못했습니다."
  - HOSPITAL_FULL 이 있으면: "{병원} 응급실 포화로 {다른 병원}으로 이송했습니다(약 +{N}초)."
  - 사건 자리에 그 사건 동안 정전·통신 장애·연기가 있었고 그것이 기록(`INFRA_FAIL`·COMM_FAIL 의 `causes`)에 이어져 있으면: "{동네} 정전(사건 {코드} 변전소 화재)으로 무전이 끊기는 구역이 늘었습니다."
- 교대 요약(`summary`)에 한 줄(있을 때만): "인과: 상태에서 난 사건 {n}건(몰린 길의 사고 {a} · 옮겨붙은 불 {b} · …, 가장 긴 사슬 {k}단계 — 07 쓰러진 나무 → 09 교통사고 → 11 교통사고), 이야기 연쇄 {s}건, 전환 배정 {m}회(늦어진 시간 합 {t}초), 병원 우회 이송 {h}회, 정전 {p}회, 조건은 맞았지만 상한·부하로 일어나지 않은 것 {d}건." — 법칙의 수는 `hazardLabel` 로 읽는다.
- `ShiftReport.world` 에 숫자와 줄(`spawned` = 법칙·규칙이 만든 사건 수). 화면은 보고서 패널이 `chain` 을 사건 분석 아래에 그린다(`ui/panels.tsx` 의 보고서 사건 항목 한 곳).
- 문장 수: 사건 분석(`analysis`)의 9줄 상한과 따로 센다(`chain` 은 4줄).
- **문장마다 가리키는 기록이 있어야 한다**(테스트): `{원인}` 의 기록 id 가 `sim.events` 에 있고, `hz.src[0].ref` 의 구간·건물이 있고, "통제 뒤 … 몰린 동안(약 N초)"이면 그 통제 기록의 시각 ≤ `hz.at` 이고 `N ≤ hz.at − 그 기록의 시각 + 12`.

### 3.10 X6 와 함께 넣을 부분

X6(위험의 현실화)은 I1-b 보다 먼저 구현된다(R1 → H1 → **X6** → R2 → R3 → I1-b). X6 의 `catastrophe.ts` 가 실제 폭발·붕괴·전소를 만드는 자리마다 **한 줄**을 남겨 두면 I1-b 가 그 자리를 소비한다:

```ts
// src/sim/world/consequence.ts 가 아직 없으면 X6 이 이 빈 함수와 타입만 담은 파일을 만든다 (I1-b 가 내용을 채운다)
// SignalKind 는 아직 types.ts 에 없으므로(I1-b 의 §3.3) X6 은 같은 합집합을 이 파일에 둔다 — X6 설계서가 그렇게 적었다.
// I1-b b2 는 그 정의를 types.ts 로 옮기고 여기서는 `export type { SignalKind } from '../types'` 로 다시 내보낸다.
export type SignalKind = 'blast' | 'collapse' | 'fireBig' | 'delivered' | 'fled' | 'closed' | 'catastrophe';
export function signal(sim: Sim, kind: SignalKind, s: { inc: number; ev: number; x?: number; y?: number; size?: number; place?: number; data?: number }): void {}
// X6 의 자리 — ev 는 그 자리에서 남긴 문제 기록 (STRUCT_COLLAPSE · EXPLOSION · BURNOUT)
//   collapseRegion / collapseBuilding : signal(sim, 'catastrophe', { inc: I.id, ev, size: 무너진 칸 수, place: I.truth.placeId, data: 1 })
//   explodeGas / ruptureVessel        : signal(sim, 'catastrophe', { inc: I.id, ev, size: 반경(칸), place: I.truth.placeId, data: 0 })
//   전소 판정                          : signal(sim, 'catastrophe', { inc: I.id, ev, size: 0, place: I.truth.placeId, data: 2 })
```

X6 이 이 한 줄을 넣지 않고 끝났으면 I1-b 가 같은 자리에 넣는다(X6 의 함수 이름으로 찾는다).

| I1-b 의 것 | X6 이 주는 것 | 함께 넣는 이유 |
|---|---|---|
| C2 잔해 도로 | 전체 붕괴의 구간 통제(`I.blockedEdge`), `placeMarks` 의 `collapsed`·`blasted`, 폭발 순간과 반경 | 현장이 실제로 무너졌을 때만 도로가 막혀야 한다(조짐만으로 막지 않는다). X6 의 통제를 사건 뒤에도 잇는다 |
| L2 열·불티 | 폭발 순간과 반경·피해량(`Signal.size`·`mag` — b3-8 이 `mag` 를 더한다), 열린 현장의 불(`tickFire`) | 같은 |
| L3 충격 | 폭발·붕괴의 크기, 처음 건전도를 낮추는 자리(`catOf` — I2 가 적어 둔 `WEAR_INTEG` 줄), `blockRoad`(면한 길을 먼저) | X6 의 현장 안 식(`catOnBlast`)을 같은 꼴로 현장 밖에 잇는다 |
| L7 재발화 | `placeMarks` 의 `burnt`·`collapsed`(그 건물은 재발화를 만들지 않는다) | X6 이 닫은 건물에 사건을 내지 않는다는 X6 의 규칙과 맞춘다 |
| C4·C8·C11 | 변전소·발전소·방송국 현장의 폭발·전소, 그리고 붕괴·폭발 자리에서 그 자리 설비의 문턱을 넘은 국지 손상 | 기반 시설 손상의 가장 큰 원인 |

- X6 의 원인 기록(`cat.causeEv`, 문제 기록의 `causes`)은 이미 사슬을 이루므로 I1-a 의 확산 단계가 그대로 읽는다(붕괴 → 사망 → …).
- **X6 가 가진 건물 상태**(`placeMarks`·`Scene.cat`)를 `sim.world` 로 옮기지 않는다(§9). 사건이 없던 이웃의 노출만 `world.expo` 에 새로 둔다(§3.6c). G4 의 기록 전용 칸(`markRuin`·`recordFall`)은 신호로 쓰지 않는다 — 신호는 X6 의 상태를 바꾸는 함수 안에서 보낸다.
- **화재 → 붕괴는 X6 의 것이다**(§3.12 ③). I1-b 는 그 식을 고치지 않는다 — 사용자 결정: 화재 균형은 N9 뒤에 다시 본다.

### 3.11 0단계 — 기록만 잇기(해시 불변), 1단계 — 어긋난 기록 고치기

**0단계(해시 불변)**. `logHash` 는 틱과 문구만 보므로(`events.ts:23-26`) **`causes` 와 새 칸을 채우는 것은 해시를 바꾸지 않는다**(시뮬레이션 안에서 `causes` 를 읽는 판단이 없다 — grep 으로 다시 확인한다). 새 기록(`emit`)·새 난수·상태 변화는 넣지 않는다.

1. 연쇄의 원인: `opts.cause`·`csq` → `createIncident` 가 발생 기록 `causes` 와 `I.cause`·`I.csq` 를 채운다. 원인 기록은 예약하는 순간에 이미 있는 것이어야 한다:
   - 재범·도주 차량: `hazards.ts` 도주 블록의 `raiseProblem('SUSPECT_FLED', …)` 반환값을 잡아 쓴다(지금은 버린다).
   - 은신처: `pursuit.ts` 의 SUSPECT_FLED('납치 차량을 놓침') 반환값. 그 줄 → `closeIncident` → 예약 순서라 쓸 수 있다.
   - 방화: **종료 기록을 쓸 수 없다.** `arsonNext` 는 `onClose` 안에서 예약하는데(`incidents.ts:227`) 종료 기록(`resolve`)은 바로 다음 줄(`:228`)에서 만들어진다 — 예약하는 순간에는 그 id 가 없다. `onClose` 를 종료 기록 뒤로 옮기면 `onClose` 안의 `emit`('방화 용의자 검거' 등) 순서가 바뀌어 해시가 바뀐다(0단계 원칙 위반). 그래서 `cause = I.lastEvent`(`onClose` 시점의 그 사건 마지막 진실 아닌 기록 — 보통 지휘관의 종료 선언이나 면담 결과)로 둔다.
2. 재난 사건: `disaster.tell` 이 기록 id 를 돌려주고 `d.lastEv` 에 둔다. `spawn` 이 `cause: d.lastEv` 를 넘긴다(`parent` 는 두지 않는다 — 재난은 사건이 아니다).
3. C6 의 기록 부분: DIVERTED 의 `causes`·`ref`, NO_UNIT 의 `blockedBy`·`causes`(새 기록·지연 기록은 b3-1).
4. **ROUTE_BLOCKED**(`resources.ts` 의 장애물·통제 두 자리)에 `ref = { edge, unit }`, 막은 주체가 사건이면 `ref.inc`(구간의 `closedReason === 'incident'` 인 사건을 `blockedEdge` 로 찾는다)와 그 사건의 통제 기록 `J.blockEv` 를 `causes` 에. 통제 기록 id 는 지금 어디에도 저장되지 않으므로 `Incident.blockEv`(§3.3)를 두고, 통제를 거는 자리(`sceneManager.ts` 6) 블록의 통제 `emit`, 산사태·다중 추돌 `onCreate` 의 통제 `emit`, X6 `collapseBuilding` 의 통제 기록 — X6 이 넣지 않았으면 b0 에서 넣는다)에서 반환값을 넣는다. **TRAFFIC_DELAY** 는 도착하는 순간에 판정하는데 그때 `arrive` 가 `u.route = null` 을 먼저 실행해(`resources.ts` `arrive` 첫 줄) 지나온 구간을 알 수 없다. 그래서 TRAFFIC_DELAY 에는 구간을 직접 붙이지 않고, **같은 사건의 문제 가운데 `ref.unit === u.id` 인 마지막 ROUTE_BLOCKED** 가 있으면 그 기록을 `causes` 로, 그 `ref.edge`·`ref.inc` 를 이어받는다(없으면 비워 둔다 — 혼잡만으로 늦은 것).
5. `gen.dropped`(버린 예약의 기록 — 기록 배열만).
6. `want()` 를 부르는 곳 가운데 원인이 분명한 자리(새 사실을 받은 무전 기록)에서 `cause` 를 넘긴다 → 지시 무전의 `causes`.
7. H1 이 하지 않았다면 RESPONDER_HURT 의 `causes` 에 피해를 준 기록, 결원 운용 중단 기록의 `causes` 에 마지막 RESPONDER_HURT·RESPONDER_KILLED 와 그 id 를 `u.oosEv` 에(H1 §3.6 이 둘 다 하도록 반영됐다 — 확인만).
8. 새 칸의 객체 모양(§3.3 끝 — 생성 리터럴에 `undefined`). 모양만 바꾸는 것이라 해시는 그대로다.

확인: 시드 40개(보통) + 재난 다섯 × 3의 `report.hash` 가 전후로 같다. I1-a 의 `crossIncidentLinks`·`worldLinks`·`spread` 가 처음으로 0 이 아니게 된다(이것이 0단계의 성과다).

**1단계(해시 바뀜 — 바로 기준선 다시 재기)**:

1. 이송 출발 문구의 병원 이름: **R1 단계 3 이 고친다**(`startTransport` 가 고른 병원을 돌려주고 5)번 블록의 출발 기록이 쓴다). b1 은 `consistency.C5 === 0` 인지 확인하고 I1-a 관문에 C5 를 더한다. R1 이 하지 않았을 때만 여기서 같은 방법으로 고친다(두 묶음이 같은 줄을 고치지 않게).
2. 재범 연쇄의 난수 흐름(C10 의 첫 줄).
3. 연쇄 깊이 상한 `DEPTH_MAX`(§3.6) — 지금 값으로는 드물게만 걸린다.

### 3.12 사용자의 예를 화살표마다 따라가기

사용자의 예 셋(2026-11-20)과 그 앞의 예 하나를 화살표마다 무엇이 일으키고, 어느 상태·어느 법칙을 지나고, 무엇이 기록되는지로 잇는다. **고정된 순서로 연출하지 않는다** — 각 화살표는 그 상태가 실제로 생겼을 때만, 문턱을 넘을 때만 일어나고, 일어나지 않은 화살표는 기록에도 없다.

**① "나무가 무너져서 트래픽이 몰려서 자연스럽게 사고 확률이 는다"**

| 화살표 | 무엇이 | 상태 · 법칙 | 기록 |
|---|---|---|---|
| 나무가 쓰러진다 | 평소 추첨의 `traffic/tree`(교대당 0.38건) 또는 태풍 큐의 나무 — **원인은 무엇이든 된다** | 그 구간 `closed`·`closedReason 'incident'`·`slow + 1.4`, 장부 `closeEv[c] = I.blockEv`(닫힘의 주인) | '○○로 통행 불가 — 쓰러진 나무가 길을 막았습니다.'(`I.blockEv` — b0) |
| 통제 → 차가 몰린다 | 교통 모델(§3.6b): 이웃 구간은 뒤로 밀리고(`queue` — 지금도 있다), **우회로의 구간에 차가 옮겨 온다**(`divert` — 새로). 12초마다 혼잡이 35%씩 따라 오른다 | `exQueue`·`exDiv`, `qBy`·`divertBy` = 그 구간, `qEv` = 통제 기록(밀린 구간 쪽에 복사 — 나무를 치운 뒤 밀림이 빠지는 3분 동안에도 남는다) | 없음(연속 값 — 혼잡의 변화는 지금도 기록하지 않는다) |
| 몰린 길 → 사고 위험이 는다 | **L1**: `λ = A × 초과 × 통행량 × 노면 × 길이`. 간선 우회로가 초과 1.0 으로 차면 그 구간은 평소의 약 3.5배가 더해진다 | `world.hz.cells.roadCrash[구간].H` 가 쌓인다 | 없음(문턱을 넘기 전에는 아무것도 남기지 않는다) |
| (대부분) 아무 일도 없다 | 나무를 치우면 `divert` 가 0 이 되고 적분이 멎는다. 간선 통제 한 번이 사고로 이어질 확률은 6~8%(목표 5~15%) | `since = −1`, `H` 는 그대로 | 없음 |
| (가끔) 사고가 난다 | 그 구간의 문턱(`hz:roadCrash:<구간>:<n>`)을 넘는다 | `traffic/std`(간선이고 초과가 크면 규모 3, 버스가 낄 수 있다), 그 구간의 끝 교차로, `edgeId` = 그 구간 | '막힌 길을 피해 몰린 차들 사이에서 사고가 났습니다 — △△ 교차로.' `causes` = [나무의 통제 기록], `parent` = 나무 사건, `hz = { src: [{ what: 'divert', ref: 나무가 막은 구간 }] }` |
| 그 사고 → 다시 밀린다 | 사고 현장의 감속(`slow + 1.4`)·통제가 새 뿌리가 된다 → L1 | 되먹임(기대값 0.04~0.08) | 셋째 사고는 사슬 3건 상한으로, 같은 나무에서 난 셋째 가지는 한 뿌리의 가지 상한으로 버려진다(`gen.dropped 'depth'`) |
| 보고서 | `buildReport` | — | "○○로 통제(사건 07 쓰러진 나무) 뒤 △△로에 차량이 몰린 동안(약 140초) 난 사고입니다." |

같은 표가 쓰러진 나무 자리에 사고 통제·전면 공사·낙하물·건물 잔해·홍수 통제를 넣어도 그대로 성립한다(부모는 주인이 사건일 때만 — 공사·낙하물에서 온 사고는 원인 기록만 갖는다). **증거**: 개입 시험(§6 I1-b 10) — 같은 시드에서 나무가 길에 만든 상태(통제와 감속)만 지우고 장부는 그대로 두면 그 원인의 사고가 없고 장부의 구멍도 없다.

**② "건물이 붕괴되어서 더 큰 사고로 이어진다"**

| 화살표 | 무엇이 | 상태 · 법칙 | 기록 |
|---|---|---|---|
| 건물이 무너진다 | X6 의 `collapseBuilding`(불·폭발이 깎은 건전도에서) 또는 무너진 채 시작하는 사건 | 신호 `catastrophe`(data 1, `mag` 1) | `STRUCT_COLLAPSE`(X6) |
| → 길이 막힌다 | X6 `blockRoad`(면한 길을 먼저 — b3-8), 사건 뒤에는 C2 의 잔해 | 구간 `closed` → §3.6b → **L1**(예 ① 의 길) | 통제 기록(`I.blockEv`), 잔해 기록(C2) |
| → 옆 건물이 흔들린다 | **L3 (가)**: 틈 15 안의 이웃에 `shake += 0.6 × (1 − 틈/15)`(무너진 채 시작하는 사건은 0.35 ×). 약한 배관은 끊긴다(`hz:pipe:<건물>` 의 문턱 — 중앙값 틈의 이웃이면 17%) | `world.expo[이웃].shake`·`pipe` | '○○ 붕괴의 충격으로 옆 △△에 금이 갔습니다.' · '△△의 가스 배관이 충격으로 손상됐습니다.'(`truth`, 원인 = 붕괴 기록) |
| → 그 자리의 전선·수도관이 끊긴다 | C4 (라)·C11: 그 자리 전선·수도관의 문턱을 넘으면(전체 붕괴의 75% 쯤) 반경 90·80 의 국지 정전·수압 저하 | 꺼진 신호 → 혼잡 → **L1**, 정전 순간의 승강기 → **L5**, 그 범위 화재의 급수 | 알림(20~40초 뒤), 복구 기록 |
| 금 간 건물 → 내려앉는다 | **L3 (다)** `structFail`: `λ = A × (shake − 0.1)`(전체 붕괴 한 번에 0.1~0.15건) | 문턱을 넘으면 `collapse/std`, 규모는 금의 크기 | '금이 가 있던 건물이 내려앉았습니다 — △△.' `parent` = 처음 붕괴 |
| 끊긴 배관 → 가스가 샌다 | **L3 (다)** `pipeLeak` | `hazmat/std` | '충격으로 손상된 배관에서 가스가 샙니다 — △△.' |
| 그 건물에 불이 난다(무엇 때문이든) | **L3 (나)**: 현장이 `wear` 로 낮은 건전도에서 시작하고, 배관이 끊겼으면 새는 밸브 소품이 있다(`s.rules` 는 그대로 — 대원은 밸브를 봐야 안다) → X6 의 구조·가스 모델이 그대로 돈다 | 삐걱임이 빨리 오고, 더 빨리·더 크게 무너지거나 가스가 폭발한다("더 큰 사고") | X6 의 `DANGER_SIGN`·`EXPLOSION`·`STRUCT_COLLAPSE`, 보고서 "이 건물은 사건 07 의 충격으로 이미 금이 가 있었습니다." |
| 그 폭발·붕괴 → 다시 옆 건물 | L3 (가) · L2 의 불티 | 사슬 3건에서 끊긴다 | |

**③ "화재가 붕괴를 유발한다" — X6 가 이미 이렇게 한다 (바꾸지 않는다)**

정해 둔 사건이 아니라 **불을 얼마나 빨리 잡았는가의 결과**다(`field/catastrophe.ts` — `structStep`·`fallStep`·`collapseRegion`·`collapseBuilding`, 상수 `CAT`):

| 화살표 | X6 의 식 | 기록 |
|---|---|---|
| 불 → 건전도 | 건물 현장은 방(구획)마다 구조 건전도(1 → 0)를 갖는다. 불이 매초 `0.0025 × (불 0.3 이상 칸의 불 세기 합 ÷ 칸 수) × (1 − 0.6 × 젖음) × (0.8 + 0.2 × hazardMul)` 만큼 깎고, 탄 칸의 몫이 상한을 `1 − 0.78 × 탄 몫` 으로 내린다 | 없음(연속 값) |
| 건전도 → 조짐 | 0.6 · 0.45 · 0.36 아래로 내려가면 대원이 삐걱임 · 균열 · 붕괴 임박을 듣고 본다(`perceiveSigns`) → 지휘관이 철수·외부 방어로 바꾼다 | `DANGER_SIGN`·`WITHDRAWAL` |
| 건전도 → 구획 붕괴 | 0.36 아래가 4초 넘게 이어지면 **초당 `0.01 + 0.5 × (0.36 − 건전도)`** 의 위험률로 그 방의 천장·바닥이 무너진다(안의 사람이 깔리고 이웃 방이 0.12 깎인다). 방이 82% 넘게 타야 임박이 된다 | `STRUCT_COLLAPSE`, 신호 `catastrophe`(data 1) |
| 구획 붕괴 → 전체 붕괴 | 건물 평균이 0.30 아래거나 무너진 몫이 45% 이상이면 6초 뒤부터 초당 0.02 이상으로 건물 전체가 무너진다. 지도에 남고 길 한 구간이 막힌다 | `STRUCT_COLLAPSE`, 통제 기록 |
| 같은 현장의 다른 사슬 | 폭발 → 구조(`catOnBlast` — 반경 + 2칸 안 구획에 `0.8 × 피해/100 × (1 − d/(r+2))`) · 붕괴의 충격 → 가스 점화 · 불 → 용기의 열 → 파열 · 지진 여진 → 모든 현장의 건전도 | |

X6 의 붕괴 판정은 초당 확률이지만 **상태(건전도)가 위험률을 정하는** 꼴이라 이 문서의 틀과 같은 종류다. 빈도(R3 뒤 보통 60교대): 구획 붕괴 95 · 전체 붕괴 10 · 전소 8 · 폭발 16 · 전원 철수 29. I1-b 가 더하는 것은 그 붕괴가 **현장 밖으로** 나가는 길(예 ②)과, 이웃의 손상이 X6 의 처음 상태로 **들어오는** 길(`wear`)뿐이다.

**④ 앞서의 예 — "폭우 → 고속도로 다중 추돌 → 도로 차단 → 우회로 도착 지연 → 현장의 추가 위험 → 전문 부대 요청 → 관제가 다른 사건의 부대를 전환 → 원래 사건이 늦어짐"**

| 화살표 | 메커니즘 | 있나 | 기록(`causes`) | 지표 |
|---|---|---|---|---|
| 폭우 → 다중 추돌 | **L1**: 재난의 비바람은 노면·시야 항 `S`(태풍 충격 1.38)로 **이미 막힌·몰린 구간의** 위험을 올린다. 간선·고속에서 초과가 크면 규모 3(버스가 낄 수 있다. 다중 추돌 시나리오는 내지 않는다 — 대형 사고는 교대에 하나라는 N5 의 틀과 부딪힌다, §3.7 L1). 날씨만으로는 사고를 내지 않는다(초과가 0 이면 0 — §9). 재난 큐의 '비바람에 미끄러진 차'는 지금처럼 따로 있다 | I1-b b3-6 | 발생 기록 → 그 순간의 몫들의 기록(통제·정전), `hz` | `hazard.natural`, `crossIncidentLinks`·`worldLinks` |
| 다중 추돌 → 도로 차단 | `scenarios/major.ts` 의 `onCreate` 가 구간을 막는다 | 있다 | 통제 기록 → 발생 기록. id 를 `I.blockEv` 에(0단계 4번) | `systems.share.road`(`I.blockedEdge`) |
| 도로 차단 → 다른 사건의 우회·지연 | 통제가 생기기 **전에** 그 구간을 지나기로 경로를 정한 부대는 그 앞에서 ROUTE_BLOCKED '통제'(`resources.ts:420`)로 멈추고 되짚어 다른 길로 간다. 늦으면 도착 때 TRAFFIC_DELAY | 있다 | ROUTE_BLOCKED → `J.blockEv`(다른 사건), TRAFFIC_DELAY → 그 ROUTE_BLOCKED(0단계 4번) | `crossIncidentLinks`, `replan.route`, `replan.fromWorld`, `spread` |
| (한계 — 일부 풀림) 이미 알려진 통제 → 우회 | 통제를 안 뒤에 출발한 부대는 처음부터 우회로로 경로를 정한다. 늘어난 시간은 예정 도착에 이미 들어가 기록되지 않는다 — **다만 이제 그 우회로가 실제로 몰려 있어**(§3.6b) 늦으면 도착 때 TRAFFIC_DELAY 가 남는다(원인을 통제까지 잇지는 않는다 — 혼잡만으로 늦은 것) | §3.6b | TRAFFIC_DELAY(`ref { unit }`) | `systems.share.road` |
| 지연 → 현장의 추가 위험 | 도착이 늦은 만큼 세계 규칙(번짐·악화·2차 충돌)이 더 돈다(`hazards.ts`) | 있다 | 위험 기록의 `causes` 는 그 현장의 직전 기록이다 — **지연 기록과 원인으로 이어지지 않는다**(시간이 만든 결과라 어느 기록 때문이라고 짚을 수 없다) | `systems.share.hazard`. 사슬은 여기서 한 번 끊긴다 |
| 추가 위험 → 전문 부대 요청 | 지휘관의 요청(`s.requests`)·다수 사상자 규칙(`orders/major.ts`) → 관제 수요 | 있다 | 요청 기록 → 위험을 알린 무전·문제 기록 | (기본 세 시스템 안이라 `spread` 에 더하지 않는다) |
| 요청 → 다른 사건의 부대 전환 | `dispatcher.sendUnit` 의 전환 배정(B3 규칙 안에서) | 있다 | DIVERTED(원래 사건 J) → 받는 사건의 마지막 기록(C6, 0단계 3번) | `contention.divert.n`, `crossIncidentLinks` |
| 전환 → 원래 사건 지연 | J 의 첫 도착이 예정보다 늦음 | C6(b3-1) | 지연 기록 → DIVERTED, `ref.lost` | `divert.hurt`·`lostSec`, 보고서 사슬 문장 |

- 끊기는 곳이 하나 있다(지연 → 추가 위험 — 시간이 만든 결과라 어느 기록 때문이라고 짚을 수 없다). 그래서 이 예의 전체가 `spread` 하나로 이어지지는 않는다. 앞쪽은 통제·정전의 기록 → 추돌 발생 → 그 추돌의 통제 → 다른 사건 J 의 ROUTE_BLOCKED 로 이어진다 — 추돌 사건에서 시작한 `spread` 로는 distinct 2(`(추돌, road)`·`(J, road)`)이고, 추돌의 원인이 다른 사건의 통제였으면 그 사건에서 시작해 3 이다. 뒤쪽(요청 → 전환 → 지연)은 `divert.hurt` 와 보고서 문장으로 보인다.
- 정해진 시드 테스트(§6 I1-b 8)의 후보: (가) `createIncident(sim, { type: 'traffic', variant: 'tree', nodeId })` 로 간선을 막고 시험 상수로 `A_ROAD` 를 키운 교대 — 나무 → 통제 → 몰린 길의 사고 → 그 사고의 통제를 만난 다른 사건 부대의 ROUTE_BLOCKED, (나) `createIncident(sim, { type: 'traffic', variant: 'pileup', nodeId })` 를 다른 사건의 부대가 그 구간을 지나기로 경로를 정한 직후에 일으키는 시드(구현 때 찾아 고정한다).

---

## 4. 균형과 재측정

성공률만 보지 않는다. 단계 하나를 넣을 때마다 아래를 전후로 잰다(전 = 그 단계 직전 커밋 — b3-3 뒤의 첫 "전"은 b3-3 끝이다. 구현 메모의 `tools/measure.sh`·`summ.mjs`·`hashrun.sh` 를 그대로 쓴다).

```bash
npx tsx scripts/sweep.ts 60 --json > $SCR/b-<단계>-normal.json
npx tsx scripts/sweep.ts 60 --metrics | tail -16                  # 지표 줄(+ hazard 줄)과 후보
npx tsx scripts/sweep.ts 30 --diff hard --json > $SCR/b-<단계>-hard.json
for z in typhoon flood quake wildfire tsunami; do npx tsx scripts/sweep.ts 20 --disaster $z --json > $SCR/b-<단계>-$z.json; done
npx tsx scripts/sweep.ts 20 --force traffic/tree --scen --metrics --hazard      # §3.6b · L1 (사용자의 예 ①)
npx tsx scripts/sweep.ts 20 --force traffic/pileup --scen --metrics --hazard    # L1 — 간선·고속의 전면 통제에서 난 사고 (강제한 다중 추돌이 원인 쪽이다)
npx tsx scripts/sweep.ts 20 --force fire/std --scen --metrics --hazard          # L2 · L7 · C5 · L4
npx tsx scripts/sweep.ts 20 --force collapse/gasblast --scen --metrics --hazard # L2 의 불티 · L3 · C2 · C4 (라) (사용자의 예 ②)
npx tsx scripts/sweep.ts 20 --force traffic/bus --scen --metrics                # C3
npx tsx scripts/sweep.ts 1 --log <시드> --metrics                               # 내력을 문장으로 읽는다
```

**측정 도구에 더하는 것**(b3-4 — `scripts/metrics.ts`, 읽기만):

- 지표 줄 `hazard:` 와 `--json` 의 `metrics.hazard = { natural, byLaw, parented, orphan, rootMax, story, ruleMade, queued, waited, dropped: { depth, cap, late, expired, busy }, holes, gain }`(`rootMax` = 한 뿌리에서 난 법칙 사건 수의 최댓값).
  - **`natural` = 스크립트 없이 난 인과 사건의 수** = `I.hz` 가 있는 사건. `byLaw` 는 법칙별.
  - `story` = 이야기 연쇄(`csq` 가 `reoffend`·`getaway`·`hideout`·`arson`), `ruleMade` = `spawnConsequence` 가 만든 사건(I1 에서는 0 — N8·N9 의 조건부 연쇄), `queued` = 재난 큐가 직접 일으킨 사건(`tag 'disaster:…'` 이고 `hz` 가 없다). "스크립트" 쪽의 수다.
  - `gain` = 법칙이 낸 사건을 부모로 둔 법칙 사건 수 ÷ 법칙이 낸 사건 수(되먹임의 기대값 — 1 아래여야 한다).
  - `holes` = `world.hz.holes` 의 합. **관문**(`checkMetrics`): `holes = 0`, 교대마다 `natural + ruleMade ≤ CSQ_SPAWN_CAP` · 이야기 연쇄 + 법칙 사건 ≤ 6 · `rootMax ≤ HZ.ROOT_MAX`.
- `scripts/hazstats.ts`(새로 — `sweep --hazard`, `catstats`·`injurystats` 와 같은 방식. **b3-4 는 뼈대만, 재는 값은 그 상태가 생기는 단계가 한 줄씩 더한다**): 교대마다 법칙의 **노출량**을 틱 표본으로 재서 낸다 — 도로 `Σ_e ∫ x V S ℓ dt`(네 몫으로 나눠)·우회로의 최대 혼잡과 지속 시간·닫힌 구간 수, 열 `Σ ∫ max(0, q − Q0) dt` 와 노출된 건물 수, 충격을 받은 건물 수와 `shake` 분포(`S_MIN` 을 넘은 건물 수 · 배관이 끊긴 건물 수를 따로), 내력의 `ev` 가 −1 인 초과의 노출량(장부의 구멍 — 0 이어야 한다), 연기 `Σ ∫ c × base dt`, 정전이 닿은 4층 이상 건물 수, 닫힌 화재의 `e0` 분포. **상수는 이 값으로 맞춘다**: `상수 = 목표 건수 ÷ 노출량의 평균`.

**목표**(I1-b 시작 커밋 = R3 뒤 기준 대비. 구현 메모 "0단계" 표의 b1 뒤 줄):

| 무엇 | 범위 |
|---|---|
| 성공+대응 지연 | `npm run check` 범위(65~90%) 안, 기준 ± 4%p |
| 실패+미해결 | 기준 + 4%p 이하. 늘어난 만큼이 내력 문장(§3.9)으로 설명되어야 한다 |
| 한계 시간·방치·출동 없음 | 기준 + 2건 이하 |
| 평균 대응 | 기준 + 6초 이하(그 가운데 §3.6b 의 우회 몰림만으로 +3초 이하) |
| 교대당 사건 수 | 기준 × 1.08 이하(보통 14.1 → 15.2 이하) |
| **스크립트 없이 난 인과 사건 `hazard.natural`** | 보통 60교대에 15~40건(교대당 0.25~0.7), 그 가운데 부모가 있는 것이 1/3 이상. 재난 다섯 × 20교대는 교대당 1~3건 |
| 법칙별(강제 20교대) | `traffic/tree`: 나무를 원인으로 한 `roadCrash` 1~4건(통제 하나에 5~20%) · `fire/std`: `heatSpread` 1~4건 · `collapse/gasblast`: `S_MIN` 을 넘은 이웃 10채 이상, `structFail` + `pipeLeak` 1~4건 · 태풍 20: `liftStall` 교대당 0.5~2건 · 보통 60: `roadCrash` 교대당 0.2~0.5건, `rekindle` 0~2건(정직한 값 — §3.7 L7), `smokeIll` 1~5건, `structFail` + `pipeLeak` 2~5건 |
| 되먹임 `hazard.gain` | 0.3 이하 |
| 부모 있는 사건 비율 | 보통 1~5%(기준 0.5%), 재난 교대 3~15% |
| 확산 3단계 이상(`spread.ge3`) | 기준 이상(보통 60교대 4건 — 이미 넘는다). **도로·건물·기반 시설을 지나는 길**이 예시에 하나 이상(`systems.share` 의 `infra` > 0, `road`·`building` 이 기준 이상) |
| 다른 사건을 가리키는 원인·세계 원인 | 기준 이상, 보통 60 의 `world links` > 0 |
| 재계획 `fromWorld` · 전환의 실제 영향 `divert.hurt` | 기준 이상 |
| 결과 다양성 | `outcomeEntropy` 가 기준 − 0.05 이상, `storyEntropy` 는 기준 이상, `flat` 이 늘지 않는다 |
| 행동 다양성 | `actions.entropy` 가 기준 이상 |
| 멈춤 | `stall.candidates = 0`, `forgotten = 0`(보통) |
| 연쇄 상한 | `maxParentDepth ≤ 2`, 한 뿌리의 법칙 사건 ≤ 2(`rootMax`), 이야기 연쇄 + 법칙 사건 교대당 ≤ 6(부모 없는 법칙 사건 ≤ 3), 법칙·규칙이 만든 사건 교대당 ≤ `CSQ_SPAWN_CAP` |
| 장부 | `hazard.holes = 0` |
| 교대당 시간 | **b3-3 끝 대비 × 1.10 이하**, 그 가운데 틀과 교통의 몫(법칙을 등록한 채 시험 손잡이로 `CSQ_SPAWN_CAP = 0` 을 주어 사건을 막고 잰 값)이 **× 1.03 이하** — 나머지는 늘어난 사건을 도는 시간이다. (초안의 "기준(b1 뒤) × 1.05"는 이미 지나간 예산이다 — b3-1~b3-3 이 사용자 CPU +4% · 교대당 +5% 를 썼다, 구현 메모) |

**범위를 벗어나면 돌리는 손잡이(이 순서로)**: 법칙의 세기 상수(`A_ROAD`·`K_HEAT`·`K_EMBER`·`A_STRUCT`·`A_PIPE`·`K_RE`·`LIFT_RIDE`·`RR_SMOKE` — `world/laws/*.ts` 의 `export const` 한 객체씩, 시험이 키워 쓸 수 있게) → 상태의 크기(`DIV_K`·`DIV_MAX`·`K_SHOCK`·붕괴 계수와 닿는 틈·`S_MIN`·국지 반경·`'level'` 항의 0.8 — **L3 는 세기 상수보다 상태의 크기를 먼저 본다**: `shake − S_MIN ≤ 0` 이면 `A_STRUCT`·`A_PIPE` 는 듣지 않는다) → 법칙별 상한 → `HZ.ORPHAN_CAP` → (선택) `tune.csqMul`(빈도 손잡이 표 `[0.5, 0.75, 1, 1.25, 1.5]` — 세기 상수에 곱한다. `Tuning` 에만 더하고 프리셋 모양은 고치지 않는다). 연쇄 상한(3·6)과 `npm run check` 의 기준 범위는 고치지 않는다.

---

## 5. 구현 순서와 완료 조건

**I1-a(이 세션 — 구현됨, `48dba83`)**: §2.17.

**I1-b** — 단계마다 커밋(`wf/causality`, 한국어, 푸시하지 않는다). b0·b1·b2·b3-1·b3-2·b3-3 은 끝났다(구현 메모 — C6·C3·C2 는 예전 글 그대로 구현됐다). **b3-4 부터가 2026-11-20 의 다시 쓰기로 바뀐 단계다.**

| 단계 | 내용 | 해시 | 확인 |
|---|---|---|---|
| b0 | 기록만 잇기(§3.11 0단계) — **끝남** | **불변** | 해시 목록 diff 0, `crossIncidentLinks > 0` |
| b1 | 어긋난 기록 고치기(§3.11 1단계) — **끝남** | 바뀜 | 기준선 다시 재기 |
| b2 | 세계 상태·신호·규칙의 틀 — **끝남** | **불변** | 해시 목록 diff 0 |
| b3-1 | C6 `divertRecord` — **끝남** | 바뀜 | 그 규칙의 테스트 + §4 |
| b3-2 | C3 `hospitalLoad` — **끝남** | 바뀜 | 같은 |
| b3-3 | C2 `rubbleRoad` — **끝남** | 바뀜 | 같은 |
| **b3-4** | **초과 위험 과정의 틀**(§3.6a): `types.ts` 의 새 자료형(§3.3 끝 — `SignalKind` 의 `'quake'`·`'blackout'` 포함), `world/hazard.ts`(`CSQ_SPAWN_CAP` 을 옮긴다), `tickWorld` 의 한 줄, `world/laws/index.ts`(빈 모음)와 `engine.ts` 의 import, `SpawnOpts.edgeId`·`causes`·`hz` 와 `createIncident` 의 자리, `tickIncidents` 의 "법칙 사건이 `placeGone` 건물이면 버린다" 한 줄, `ruleLoad` 로 전체 상한 세기, `zoneOfPlace` 를 좌표로, 측정 도구의 `hazard` 줄과 `scripts/hazstats.ts` 의 **뼈대**(`--hazard` — 재는 값은 뒤 단계가 한 줄씩 더한다: 아직 없는 상태를 잴 수 없다). 법칙은 하나도 없다 | **불변** | 해시 목록 diff 0(b3-3 끝과). 틀의 단위 시험(가짜 법칙으로 — §6 I1-b 9). **b2 의 시험 둘을 함께 고친다**: `placeState` 의 `toEqual({ mark, burnFrac, ruinFrac, usable })` 은 `toMatchObject` 로(b3-7 이 칸을 더한다), 전체 상한 시험은 `world.spawned = CSQ_SPAWN_CAP` 으로 손으로 채우는 대신 `world.log` 에 `made ≥ 0` 인 줄 여섯을 넣어 `ruleLoad` 를 채운다 |
| **b3-5** | **교통 모델의 일반 규칙**(§3.6b) — 커밋 둘: ① 장부와 초과의 네 몫(항마다의 주인 `closeEv`·`slowEv`·`levelEv`·`Obstacle.ev`·정체의 `ev`, `bumps` 줄, `base`·`ex*`·`qBy`·`qEv`·`qInc`·`driftAt`, `canBlock` 으로 옮기기, `disaster.roadSill` 로 뽑기, `hazstats` 의 도로 줄 — **불변**) ② 우회 몰림(`divert` 를 `target` 에, 쓰러진 나무의 `+0.7` 삭제 — **바뀜**) | ① 불변 ② 바뀜(닫힌 구간이 있는 모든 교대) | ① 해시 diff 0, `drift` 의 난수 호출 수 그대로 ② **기준 다시 재기**(§4 전부 — 이 뒤의 "전"). 평균 대응 +3초 안, `DIV_K`·`DIV_MAX` 맞추기 |
| **b3-6** | **L1 `roadCrash`**(`world/laws/road.ts`) + `createIncident` 의 `opts.edgeId`(§3.6b (다)) + `A_ROAD` 맞추기 | 바뀜 | L1 의 테스트(개입 시험 포함), `--force traffic/tree` 20교대, 보통 60 의 `natural`·`holes = 0` |
| **b3-7** | 건물의 노출(`world/expo.ts` 의 `expoOf`·`neighborsOf`, `hazards.fireLoad`, `placeState` 의 새 칸) + **L2 `heatSpread`**(`laws/heat.ts`) — 열 항만(불티는 b3-8c). 따로 커밋: `knownHazardNear` 와 분석 AI 의 '연소 확대' 이름표, `fireBig` 신호의 `ev` 규칙 | 바뀜 | L2 의 테스트, `--force fire/std` 20교대. 같은 교차로의 두 사건(확인 필요 — 이 단계의 첫 일) |
| **b3-8** | **L3 충격** — 셋으로: **a** `Signal.mag` 와 X6·`blast` 의 호출, 상태 규칙 `shockSpread`(`rules/structure.ts`) → `shake`·`pipe`·금 기록, `blockRoad` 의 면한 길 · **b** `applyExpo`·`Scene.wear`·`catOf` 의 `WEAR_INTEG` 한 줄·새는 밸브(`s.rules` 는 그대로) · **c** `structFail`·`pipeLeak`(`laws/shock.ts`)·`expo.pipe` 를 거두는 규칙·L2 의 불티 항 | 바뀜 | L3 의 테스트, `--force collapse/gasblast` 20교대, X6 의 수(120교대 — 전체 붕괴·폭발·전소가 기준 ± 흔들림 안) |
| **b3-9** | **L7 `rekindle`**(`laws/ember.ts`) + C10 `suspectZone`(`rules/…` — 남은 부분). **'재발화' 이름표는 넣지 않는다**(§3.7 L7) | 바뀜 | L7·C10 의 테스트, 어려움 30·극한 30(재범이 있는 조건) |
| **b3-10** | 셋으로: **a** 국지 구역 값(`setZone` 의 `at`·`setZoneArea`·`zoneAt`·`isDark`·`endZoneBy`)과 **C4 `powerOut`**(신호 `quake`·`blackout` 을 보내는 자리, 규칙 셋, `addBump`) · **b** **L5 `liftStall`**(`laws/power.ts`, `expo.darkened`) · **c** C8 `commsDown` + `PROBLEM_LABEL` 의 `order`·문장(INFRA_FAIL) | 바뀜 | 그 테스트, 태풍·지진 20교대, 변전소 강제 |
| **b3-11** | **C5 `smokePlume`**(상태) + 변형 `medical/smoke` + **L4 `smokeIll`**(`laws/smoke.ts`) | 바뀜 | 그 테스트, `--force fire/std`·산불 20교대 |
| **b3-12** | **L6 `floodLow`**(상태 규칙 — 건물 침수와 L5, 느려진 길의 `'level'` 장부) + (선택) C11 `waterMain` | 바뀜 | 그 테스트, 홍수 20교대 |
| b4 | 보고서의 내력 문장(§3.9), 보고서 패널 한 곳, **교대 중에 보이는 표시**(§7 — 금 간 건물·끊긴 배관·국지 정전·연기 자리의 지도 표시, 사건 카드의 내력 칩, 범례) | 바뀜(요약 문장) · 화면은 결과 불변 | 화면 확인(포트 5218, 1600×900, 콘솔 오류 0), `npm run ui-check` |
| b5 | 균형(§4)과 완료 조건 측정, I1-a 관문을 조인다(M-G1 0, M-G3 3, `holes`) | — | 아래 |

**단계 안에서 커밋을 둘로 나누고, 확인하는 법이 다르다.** "문턱을 넘지 않은 교대의 해시는 그대로"는 법칙에만 성립한다 — 같은 단계에 묶인 상태 규칙·이름표·기록은 문턱과 상관없이 결과를 바꾼다(b3-7 의 '연소 확대' 이름표와 위험도 +0.3, b3-8 의 금 기록·`applyExpo`·`blockRoad` 의 면한 길, b3-9 의 C10, b3-10 의 국지 정전 `bump`·구역 상태·병원 한도 −2·C8, b3-11 의 연기 `bump`·실외 노출, b3-12 의 `'level'` 초과와 C11). 그대로 믿으면 없는 버그를 찾게 된다.

- **(법칙 커밋)** `registerHazard` 한 줄과 그 법칙이 읽는 상태만: 해시 목록에서 바뀐 줄이 `Incident.csq === 그 법칙` 인 사건이 있는 교대와 같아야 한다(`hashrun.sh` + `hazstats` 의 `byLaw`). 법칙마다 새 흐름이라 문턱을 넘지 않은 교대는 같다.
- **(상태·판단 커밋)** 분석 AI 의 이름표, `blockRoad`, 상태 규칙(`shockSpread`·C4·C5·C8·C10·C11·L6)과 그 기록: 걸리는 조건이 법칙과 달라 위의 확인을 쓰지 않는다 — 바뀐 교대마다 그 조건(알려진 큰 불 곁의 화재 신고가 있었는가, 전체 붕괴·폭발이 있었는가, 태풍 정전·지진이 있었는가, 큰 불이 45초 넘게 이어졌는가)이 있었는지를 기록으로 본다. **그 조건이 하나도 없던 교대의 해시는 그대로여야 한다.**
- 순서: "넣기 전 20교대 강제·보통 60 → 넣기 → 위의 확인 → 상수 맞추기 → 커밋". 반쯤 된 법칙은 등록하지 않고(그 `import` 줄을 빼고) 보고에 적는다.

**덩어리**(40~100분짜리. 끝마다 `npm run check` · 어려움·극한 40 `--check` · 구현 메모 한 단락):

| 덩어리 | 단계 | 무엇을 어떤 순서로 | 끝내는 조건에 덧붙일 것 |
|---|---|---|---|
| **h1** | b3-4 + b3-5 ① | 틀(자료형 → `hazard.ts` → `tickWorld`·`tickIncidents` 한 줄씩 → 가짜 법칙의 단위 시험 → `hazard` 지표 줄과 `hazstats` 뼈대) → 교통 장부(항마다의 주인 → `bumps` 줄 → 뿌리 가르기와 `qEv` → 네 몫 → `canBlock`·`roadSill` 옮기기 → `hazstats` 의 도로 노출량). 사건을 만드는 것이 하나도 없다 | **해시 목록 diff 0**(b3-3 끝과 — 123줄). `drift` 의 난수 호출 수 그대로. 보통 12교대의 도로 노출량(네 몫으로 나눠)과 "장부 없는 초과"(내력 `ev < 0` 인 몫의 노출량 — 0 이어야 한다)를 보고에 |
| **h2** | b3-5 ② + b3-6 | 우회 몰림(`divert`·`+0.7` 삭제) → `DIV_K`·`DIV_MAX` 맞추기 → **기준 다시 재기**(§4 의 명령 전부 — 뒤 덩어리들의 "전") → L1 등록 → `A_ROAD` 를 노출량으로 맞추기 → 개입 시험(§6 I1-b 10) | 평균 대응 기준 +3초 안. 보통 60 의 `roadCrash` 교대당 0.2~0.5건 · `holes = 0` · `gain ≤ 0.3`. `--force traffic/tree` 20교대에서 나무를 원인으로 한 사고 1~4건. 새 기준 파일의 절대 경로 |
| **h3** | b3-7 | 같은 교차로의 두 사건을 먼저 확인(`--force fire/std` 20) → `expo.ts`·`fireLoad`·`placeState` → L2 열 항(법칙 커밋) → `knownHazardNear`·'연소 확대'·`fireBig` 의 `ev`(상태·판단 커밋) | `heatSpread` 가 강제 20교대에 1~4건, 화재 성공률 기준 − 2%p 안. 기다리게 하는 갈래(`hold: 300`)를 썼는지 보고에 |
| **h4** | b3-8 a + b | `Signal.mag` → `shockSpread` 와 금·배관 기록 → `blockRoad` → `applyExpo`·`wear`·`catOf` 한 줄·밸브. 법칙은 아직 없다(상태·판단 커밋만) | **X6 의 수 120교대**(전체 붕괴·폭발·전소·전원 철수가 기준 ± 흔들림 안), `S_MIN` 을 넘은 건물 수와 배관이 끊긴 건물 수(`hazstats`), 모든 바닥에 닿는다, `s.rules` 글자 검사 |
| **h5** | b3-8 c + b3-9 | `structFail`·`pipeLeak`(법칙 커밋 둘) → 불티 항 → L7 → C10 | `--force collapse/gasblast` 20교대에 `structFail` + `pipeLeak` 1~4건. 어려움 30·극한 30 에서 재범이 조건으로 걸리는가. 보통 60 의 `rekindle` 수(0~2 — 정직한 값) |
| **h6** | b3-10 a + b + c | 국지 구역 값 → 신호 `quake`·`blackout` → C4 규칙 셋 → L5 → C8 → INFRA_FAIL | 태풍·지진 20교대(`liftStall` 태풍 교대당 0.5~2건, 지진의 승강기 사건 기준 +1/교대 안), 변전소 강제, 정전이 반드시 복구된다(교대 끝에 `power < 1` 인 동네 0 — 원인이 살아 있는 것 빼고), `bump` 가 얹기 전 값으로 돌아온다 |
| **h7** | b3-11 + b3-12 | C5 → `medical/smoke` → L4 → L6(건물 침수·`'level'` 장부) → (시간이 남으면) C11 | 산불·홍수 20교대(사건 수 기준 × 1.1 안), 보통 60 의 `smokeIll` 1~5건. C11 을 하지 않았으면 notDone 에 |
| **h8** | b4 + b5 | 내력 문장 → 보고서 패널 → 지도 표시·칩·범례(읽기만) → §4 의 목표 표 전부 → 완료 조건 → 관문 조이기 | `npm run ui-check`, 화면을 직접 본다(5218). 완료 조건 일곱의 수치와 본 그림의 절대 경로. 못 맞춘 조건은 까닭과 함께 notDone 에 |

**주 세션이 띄우기 전에 고칠 것**(작업자는 고치지 않는다): `docs/specs/workflows/args/I1-b.json` 의 `chunks`(지금은 옛 차례 `b3a`·`b3b` — C9·C10·C1·C12 를 가리킨다)·`title`·`reviewFocus`(교대당 시간의 "× 1.2" → §4 의 줄, "규칙이 만든 사건" → "법칙이 만든 사건", 정보 격리에 `s.rules`·`world.expo`), `docs/specs/README.md` 17·80행("규칙 11개"·"`b3` 규칙 1~6 → 7~11"), N9·I2 설계서의 글자(§3.7 끝).

**완료 조건** — 사용자의 말에서 나온 둘(가·나)과 처음부터 있던 다섯(1~5)을 새 설계의 지표로:

- **(가) 사용자의 예 셋이 정해진 시드에서 실제로 난다**(§6 I1-b 8·10·11): 쓰러진 나무 → 몰린 길의 사고(개입 시험 통과 — 상태만 지우고 장부는 두었을 때 그 원인의 사고가 없고 구멍도 없다) · 붕괴 → 옆 건물의 금 → 내려앉음 또는 가스 누출, 그리고 금 간 건물의 화재가 더 빨리 무너진다(방치 시험) · 화재 → 붕괴(X6 — 이미 있다. 고치지 않았음을 X6 의 시험과 120교대의 수로 확인).
- **(나) 스크립트 없이 난 인과 사건이 실제로 있다**: `hazard.natural` 이 §4 의 범위, `holes = 0`. "X 면 확률 p 로 Y" 꼴이 I1 의 코드에 없다(§6 I1-b 12 의 글자 검사: `world/laws/*.ts`·`world/rules/*.ts` 에 `spawnConsequence`·`.chance(` 가 없다). 남은 스크립트(이야기 연쇄 · 재난 큐)의 수를 `hazard.story`·`queued` 로 함께 낸다.

1. **하나의 사건에서 서로 다른 시스템으로 3단계 이상 실제 영향이 퍼지는 사례**: `metrics.systems.spread.ge3` 이 기준 이상이고, 예시 길 가운데 **법칙을 지나는 것**(도로·건물·기반 시설 — 사건 → 통제 → 몰린 길의 사고 → 그 사고가 막은 다른 사건의 부대)이 있다(§6 I1-b 8).
2. **AI 가 새 정보로 기존 계획을 바꾸는 사례**: `replan.share` 와 `replan.fromWorld` 가 기준 이상(b3-3 끝: 보통 60 에서 50.0% · 71). 테스트: 이송 중 목적지 변경(C3 — 끝남), 알려지지 않은 잔해 앞에서 되짚는 부대(C2 — 끝남), 법칙이 낸 사고의 통제를 만난 다른 사건의 부대(ROUTE_BLOCKED 의 원인이 그 사고의 통제 기록).
3. **부대 부족이 다른 사건에 실제로 영향을 주는 사례**: `contention.divert.hurt ≥ 1` 이고 `lostSec > 0`, `blockedBy` 가 있는 NO_UNIT ≥ 1. 보고서에 그 문장이 있다. 법칙이 사건을 더한 뒤에도 전환의 늦어진 초가 기준 × 1.3 안이다(늘어난 사건이 부족을 키우는 것은 의도한 결과지만 몰리지 않게).
4. **모든 결과가 이벤트 로그와 실제 상태에 일치**: `consistency.C1~C5` 가 모두 0(보통 60·어려움 30·재난 다섯 × 20). 보고서의 내력 문장마다 가리키는 사건·기록이 있다(테스트). **법칙 사건마다**: `cause` 의 기록이 있고, 건물 법칙이면 `truth.placeId === hz.target`, 문장의 "약 N초"가 그 몫의 `at − since` 이며 그 원인 기록의 시각보다 앞서지 않는다. `holes = 0`.
5. **여러 시드에서 교착·무한 연쇄·무의미한 반복 없음**: 보통 60 에서 `stall.candidates = 0`, `forgotten = 0`. 어려움·극한·재난에서는 기준선보다 늘지 않는다. 모든 조건에서 `maxParentDepth ≤ 2`, 한 뿌리의 법칙 사건 ≤ 2, 인과로 난 사건(이야기 연쇄 + 법칙 사건) 교대당 ≤ 6, `hazard.gain ≤ 0.3`, `repeatMax` 가 기준 이하(극한 S12 #14 의 80 은 따로 본다 — 구현 메모). 교대 끝에 회복되지 않은 구역 값·남은 `bumps` 줄이 원인이 살아 있는 것뿐이다.

---

## 6. 테스트 (`tests/causality.test.ts`)

가볍게(교대 10개 안팎). 손대지 않는 끝난 교대는 파일 머리에서 한 번 만들어 여러 `it` 이 나눠 쓴다. **교대를 일부러 고치는 테스트(멈춤 감지기)는 자기 `Sim` 을 따로 만든다**(CLAUDE.md "테스트의 교대 재사용").

**I1-a(이 세션 — 구현됨, `48dba83`)**

1. **측정은 결과를 바꾸지 않는다**: S1·S4(보통), S2(지진)를 `runToEnd` 와 `runWithProbe` 로 각각 돌려 `report.hash` 와 `JSON.stringify(report)` 가 같다.
2. **계산이 손 계산과 맞다**: 손으로 만든 작은 기록 배열(사건 둘, 기록 열 개 남짓, 원인 간선과 시스템이 정해진 것)로 `causesDepth`·`spread`(정답 3)·`crossIncidentLinks`·`S(I)`(사건 없는 기록을 `causes` 로 가리키는 경우 포함) 를 확인한다(시뮬레이션 없이 — `shiftMetrics` 가 가짜 `sim` 모양을 받을 수 있게 필요한 칸만 쓰는 함수로 나눈다). **왕복 경우를 하나 더**: hazard → road → hazard → road → hazard 처럼 기본 밖의 두 시스템을 오가는 배열에서 `spreadRaw` 4·`spread`(distinct) 2(구현 — field 는 기본 시스템이라 hazard ↔ field 왕복은 raw 2 다), 두 사건을 오가는 배열(I → J → I → J)에서도 distinct 가 raw 보다 작다. 전환 배정의 짝(DIVERTED 다음의 출동 지령, `dispatchLog` 의 id 비교)과 `forgotten`·`unlocated` 의 판정도 가짜 사건·통화 배열로 확인한다.
3. **대응표가 문구를 아직 잡는다**: T1·T2·T3·T4·T7 정규식이 정해진 시드(구현 때 찾아 고정한다 — 지원 요청·응급실 대기·이송·출동이 나오는 시드)의 기록 하나 이상과 맞는다. T6 은 H1 4b 뒤 새 문구 셋 가운데 하나가 나오는 교대(시드를 찾아 고정하거나 한 부대의 대원을 모두 순직시킨 교대)로 본다 — 지금의 시험(극한 S10·S13·S18 의 '전원 부상' 기록)은 H1 이 그 문구를 없애므로 H1 이 고친다(H1 §11-15). T5 는 I2 뒤에 켠다. 모든 `ProblemCode` 가 대응표에 있다 — `types.ts` 의 합집합에서 코드 목록을 읽을 수 없으므로 `debrief.ts` 의 `PROBLEM_LABEL` 열쇠(모든 코드가 있다)와 비교한다. 없으면 실패해서 새 코드를 알려 준다(다른 설계서가 더하는 코드는 미리 넣었으므로 H1·R2·X6 이 합쳐져도 깨지지 않는다 — §2.3).
4. **멈춤 감지기**: `runWithProbe` 대신 `Probe` 를 직접 돌리는 루프(`step()` → `tick % SAMPLE_EVERY === 0` 이면 `sample()` → 조건이 되면 얼림)를 쓴다(§2.2 의 API 로 된다). 불·용의자·번지는 위험이 없는 강제 시나리오(예: `new Sim(seed, NORMAL, len, { force: 'medical/faint' })`)에서 그 사건의 **첫 도착 직후**(`I.firstArrivalAt ≥ 0` 이 된 첫 표본, 시각 T0)에 그 현장의 모든 대원을 `a.task = null; a.path = null; a.nextThink = Infinity` 로 둔다(테스트 안에서만 일부러 멈춘다). `nextThink` 만 막으면 `act()` 가 하던 임무를 끝까지 이어 가고(`sceneManager.ts` 3) 블록은 `think` 만 건너뛴다, `executor.ts` `act`), 구조 대상 악화·밀린 무전(`flushOutbox`)도 진전 신호라 시계를 되돌린다 — 그래서 임무를 지우고, 번지는 위험이 없는 시나리오를 고른다. T0 뒤 120초를 돌리고: 후보가 있고, 그 시작이 `[T0, T0 + 10]` 안이며, 길이 ≥ 60초, 사건 코드가 맞다(그 사이에 사건이 `LIMIT` 로 닫히지 않는 시나리오·시드를 고른다). 같은 교대를 손대지 않고 돌리면 그 사건은 후보가 아니다.
5. **연쇄 깊이**: `--force fire/arson` 교대 가운데 연쇄가 생기는 시드(구현 때 고정)에서 `maxParentDepth ≥ 1`, `chained ≥ 1`.
6. **일치 검사**: S0~S3 에서 C1~C4 위반 0. C5 는 손으로 만든 기록(출발 "시립병원" / 도착 "가온대학교병원")에서 1을 세고, 뒤에 인계가 없는 출발은 분자·분모 모두에서 뺀다.
7. **요약 모양**: 교대 둘의 `summarize` 결과에 `metrics` 의 아홉 개 키(`chain`·`systems`·`replan`·`alt`·`actions`·`contention`·`stall`·`variety`·`consistency`)가 모두 있고 값이 숫자·객체이며, `checkMetrics` 가 만든 문구가 상한을 넘긴 값에서 나온다(가짜 요약으로).

**I1-b**

1. 재현성: 세계 상태가 생긴 뒤에도 같은 시드 두 번의 `report.hash` 가 같다. 규칙·법칙이 하나도 안 걸린 교대의 `world` 는 처음 값 그대로(`hz.cells`·`expo`·`sills`·`spans` 가 비어 있다). **한 프로세스에서 시드 A 다음에 돌린 B 의 해시가 B 만 돌린 것과 같다**(법칙이 걸리는 홍수·가스 폭발 강제 교대로 — 건물·동네마다 한 번 뽑는 문턱이 도시 열쇠의 캐시로 새지 않았다, §3.6c).
2. C6: 두 사건을 정해서 일으켜 전환 배정을 만든다 → DIVERTED 의 `causes` 가 받는 사건 기록을 가리키고, `ref.lost` 가 채워지고, 보고서 `chain` 에 그 문장.
3. C3: 병원 체류를 한도까지 채움 → 포화 알림, 새 이송이 다른 병원으로, 이송 중이던 부대의 목적지 변경 기록과 HOSPITAL_FULL, 체류가 빠지면 수용 재개.
4. C2: X6 의 전체 붕괴가 난 사건을 닫음 → 그 구간에 `rubble` 장애물이 이어서 놓이고(`known`), 규칙이 남긴 잔해 기록(`kind 'traffic'`, §3.7 C2 의 "기록")의 `causes` 가 종료 기록이며 그 장애물의 `ev` 가 그 기록, 도시가 끊기지 않는다(`tests/traffic.test.ts` 의 연결 검사 함수를 다시 쓴다). 큰 폭발 신호만 있는 사건도 같은 검사(알려지지 않은 잔해면 기록은 `truth`, 부대의 ROUTE_BLOCKED 가 그 기록을 `causes` 로).
5. **교통의 일반 규칙**(§3.6b): 교통 사건·사건·재난을 끈 도로에서는 모든 구간의 `excess` 가 0 이고 `cong` 이 `base` ± 0.3 안. 구간 하나를 닫으면 우회로의 구간들에만 `divert > 0`(막다른 가지에는 없다), 통행량이 큰 구간이 막힐수록 크고, `DIV_MAX` 를 넘지 않으며, 풀면 다음 `drift` 에 0. 우회로가 없는 구간을 닫아도 예외가 없다. 장부: 닫힌 구간(`closeEv`)·사고 감속(`slowEv`)·정체(그 정체의 `ev`)·장애물(`Obstacle.ev`)·인파와 정전(`bumps` 줄)마다 기록이 −1 이 아니고 그 기록의 문구가 그 상태를 말한다. 쓰러진 나무의 구간은 닫힘의 주인이 통제 기록(`blockEv`)이고 감속의 주인이 발생 기록이다(서로 덮지 않는다). **뿌리가 사라진 뒤 밀림이 빠지는 동안에도 `exQueue > 0` 인 구간의 내력 `qEv` 가 −1 이 아니다.** 수요만으로 꽉 찬 구간(`p0 ≥ 2.4`)의 이웃은 `exQueue = 0` 이다. 인파와 정전이 겹친 구간에서 한쪽을 거두면 `e.bump` 와 남은 줄이 맞는다. `drift` 의 난수 호출 수는 그대로다(같은 교대의 `rngTraffic` 다음 값이 장부 커밋 전후로 같다). `src/sim` 에서 `traffic.ts` 와 `disaster.ts` 의 정전 두 자리 말고는 `.bump +=`·`.bump =` 이 없다(소스 글자).
6. 무한 연쇄: 깊이 2 사건을 부모로 한 초과는 `'depth'` 로 버린다 · **한 뿌리에서 난 법칙 사건이 둘이면 셋째는 `'depth'`**(이웃 넷이 모두 문턱을 넘게 한 화재에서 옮겨붙은 불은 둘이다) · **이야기 연쇄와 법칙 사건(부모가 있든 없든)을 합쳐 교대에 6건이면 `'cap'`** · 부모 없는 법칙 사건은 그 안에서 `ORPHAN_CAP`(3)에서 멈춘다 · 교대 끝 150초 안에는 만들지 않는다(`'late'`) · 기다리는 줄이 마감(60초)을 넘기면 `'expired'`, 그 대상의 초과가 끝난 것만으로는 버려지지 않는다. `once` 가 아닌 법칙은 버릴 때마다 `H` 가 `thr` 만큼 줄고 `n` 이 늘며, `once` 법칙은 버려진 대상이 다시 적분되지 않는다(`done`). 버린 일은 기록(`emit`)에 없다. 교대가 끝날 때 `gen.chain` 과 기다리는 줄에 남은 법칙 사건이 몰려 터지지 않는다.
7. 정보 격리(소스 글자 검사 — b2 의 것에 더한다):
   - `src/sim/dispatch/*`·`field/commander.ts`·`field/brain.ts`·`field/orders/*` 에 `sim.world`·`world.zones`·`world.hospitals`·`world.signals`·`world.log`·`placeMarks`·`carryState` 글자가 없다(`knownZone`·`knownHospital`·`knownBuildingAt`·`knownZoneOfIncident` 만).
   - `dispatch/analyst.ts`·`dispatch/dispatcher.ts` 에 `truth.placeId` 글자가 없다(`callSystem.ts` 는 신고자 모델이라 뺀다).
   - `resources.ts` 는 **`startTransport` 함수의 본문만** 잘라 같은 글자들을 검사한다.
8. **3단계 사례**(정해진 시드 — 구현 때 찾아 고정): `spread ≥ 3`(distinct)이고 그 길이 도로나 건물을 지난다. 후보는 §3.12 ④ 끝의 (가)·(나)와, `createIncident(sim, { type: 'hazmat', placeId: 변전소 })` 로 일으킨 정전 → 꺼진 신호의 사고 또는 승강기 → 그 사건의 부족.
9. **틀의 단위 시험**(가짜 법칙 — 시험이 `registerHazard` 로 넣고 `finally` 에서 거둔다. 등록은 그 파일의 모든 `Sim` 에 걸리므로 자기 `Sim` 만 돌린다. **대부분 `sim.step()` 없이 `tickHazards(sim)` 만 부른다** — 빠르고 다른 원인이 끼지 않는다):
   - 문턱은 경로와 무관하다: 같은 시드·같은 대상이면 위험률을 어떻게 주든 `thr`·`u2` 가 같다. `once` 가 아니면 `n` 마다 다르다.
   - **단조성**: 위험률 `r(t)` 와 `0.5 × r(t)` 로 돌린 두 `Sim` 에서 k 번째로 **문턱을 넘는 시각**이 뒤쪽이 늦거나 없다(k = 1..3 — `step` 없이 `tickHazards` 만).
   - 초과가 0 인 동안 `H` 는 그대로고 `since = −1`. `once` 가 아니면 넘친 몫은 다음 문턱으로 넘어간다.
   - **평균이 맞다**: `Sim` **하나**에 가짜 법칙의 `scan` 이 대상 0..299 를 일정한 위험률 `λ` 로 내놓게 하고 `tickHazards` 만 `T` 번 부른다(상한에 걸려 버려져도 칸의 `n` 은 는다) — `Σ n / 300` 이 `λT` ± 15%(주사위 없이도 푸아송이다. 문턱은 대상마다 독립이라 시드 200개의 `Sim` 을 만들 까닭이 없다 — 그러면 그 시험 하나가 분 단위다).
   - 귀속: 몫 둘(0.7·0.3, 큰 쪽에 주인 사건)이면 `cause`·`parent` 가 큰 쪽, `causes` 에 둘 다, `hz.src` 가 큰 것부터이고 몫마다 `since` 가 그 기록의 시각보다 앞서지 않는다. 주인 있는 몫이 1/3 아래면 부모가 없다. **큰 몫(0.8)의 `ev` 가 −1 이고 작은 몫(0.2)에 기록이 있으면** 사건은 나되 `holes` 가 늘고 `hz.src[0].ev === −1` 이다(20% 짜리 기록이 주된 원인으로 올라오지 않는다). 모든 몫의 `ev` 가 −1 이면 사건을 만들지 않고 `holes` 가 한 번만 는다(주기마다 늘지 않는다).
   - **`once` 는 한 번 넘으면 끝**: 예약됐든 `'cap'` 으로 버려졌든 `done` 이고, 그 뒤의 `scan`·`hazardImpulse` 가 그 칸을 바꾸지 않는다. `H` 가 문턱의 세 배가 되는 충격을 줘도 사건은 하나다.
   - **기다리는 줄**: `spawn` 이 `null` 이면 줄에 들어가고 그 대상은 적분하지 않는다. `spawn` 이 사건을 주게 되면 **다음 1초 블록에** 적어 둔 몫의 사본으로 귀속해 난다(`every: 12` 인 법칙도, `scan` 이 없는 충격 법칙도, 그 사이 `scan` 이 그 대상을 내놓지 않게 됐어도). 마감이 지나면 `'expired'`. `hold: 300` 인 법칙은 300초를 기다린다.
   - **건물에 내는 사건의 공통 조건**: 가짜 법칙이 전소 건물과 사건 중인 건물을 내놓으면 앞은 버려지고(`'expired'`) 뒤는 기다린다. 예약한 뒤 꺼내기 전에 그 건물이 전소하면 `tickIncidents` 가 만들지 않는다. 건물 법칙이 만든 사건의 `truth.placeId` 는 언제나 `hz.target` 이다.
   - 사건의 흐름 이름이 (법칙, 대상, 몇 번째)라 앞의 다른 사건을 지워도 그 사건의 현장이 아니라 **선택(유형·규모·자리)** 이 같다.
   - 법칙이 없는 교대의 해시가 틀을 넣기 전과 같다.
10. **개입 시험 — 쓰러진 나무**(사용자의 예 ①): 같은 시드의 두 `Sim` A·B 를 틱 T 까지 돌린다(그때까지 `logHash` 가 같다). **두 쪽 모두 다른 원인을 얼린다** — `sim.traffic.nextEvent = Infinity`(새 교통 사건 없음), `sim.gen.nextAt = sim.gen.majorAt = Infinity`(새 평소·대형 사건 없음), 재난 없음: 얼리지 않으면 `traffic.spawn` 의 후보가 `!e.closed` 를 읽어 같은 난수로도 다른 구간을 고르고 평소 생성기가 열린 사건 수·가용 부대 수를 읽어, 300초 창 안에 두 `Sim` 의 무관한 구간이 갈라진다. 둘 다 `createIncident(sim, { type: 'traffic', variant: 'tree', nodeId })` 로 간선을 막는다(사건 번호가 같게 — 사건을 지우지 않는다). **B 에서만 그 직후 나무가 길에 만든 상태를 모두 되돌린다**: `e.closed = false; e.closedReason = null; e.slow = Math.max(0, e.slow − 1.4); I.blockedEdge = −1`(사건·현장·사건 번호는 그대로. 쓰러진 나무는 통제와 함께 `slow += 1.4` 도 건다 — 닫힘만 되돌리면 그 구간은 B 에서도 밀림의 뿌리라 이웃의 `exQueue` 가 A 와 똑같이 쌓인다). **장부는 손대지 않는다**(`noteRoadCause` 로 지우지 않는다 — 장부는 다음 `drift` 가 상태를 보고 스스로 비워야 하고, 장부를 지우면 ② 가 위험이 그대로여도 참이 된다). 시험 상수로 `A_ROAD` 를 키우고 300초를 돌린다. 확인: ① A 에 `csq === 'roadCrash'` 이고 `hz.src` 에 `ref` 가 그 구간인 몫(`divert`·`queue`)이 있으며 `cause` 가 나무의 `blockEv`, `parent` 가 나무 사건인 사건이 있다. ② B 의 어느 사건도 `hz.src` 에 그 구간(`ref`)이나 그 `blockEv` 가 없다. ③ A 에서 `divertBy`·`qBy` 가 그 구간이던 구간들에서, A 의 첫 법칙 사건 전까지의 표본마다 `H_B ≤ H_A`("모든 구간"이 아니다 — 풀린 구간 자신은 B 에서 차가 다녀 다른 원인의 초과를 받는다). ④ A 의 그 사건의 보고서 문장에 나무 사건의 코드와 두 구간의 이름이 있다. ⑤ 두 쪽 모두 `world.hz.holes === 0`. ⑥ **대조**: 상태는 두고 장부만 지운 셋째 `Sim` 에서는 문턱을 넘을 때 `holes` 가 는다(원인 꼬리표를 지우는 것으로는 위험이 사라지지 않는다 — 초안의 시험은 이 길로 저절로 통과했다).
11. **개입 시험 — 불과 붕괴**(사용자의 예 ②와 L2): (가) 같은 화재를 강제한 두 `Sim` 에서 한쪽만 원인 현장의 `s.fire` 를 0 으로 → 이웃의 `hazardCell('heatSpread')` 이 없고 옮겨붙은 불이 없다. (나) 같은 가스 폭발을 강제한 두 `Sim` 에서 한쪽만 폭발 직후 `world.expo` 를 비운다 → 그쪽에는 `structFail`·`pipeLeak` 사건이 없고, 다른 쪽은 이웃의 `shake` 가 손 계산과 같다. (다) `shake = 0.4` 를 적어 둔 건물과 아닌 건물에 같은 화재를 일으키고(같은 사건 번호 — 같은 현장) **대원 없이 `tickScene` 만 돌린다**(X6 의 방치 시험): 앞쪽의 처음 건전도가 `1 − 0.5 × 0.4` 이하이고, 첫 구획 붕괴 시각이 앞쪽이 같거나 이르다("첫 `DANGER_SIGN` 이 더 이르다"는 대원의 지각과 도착 시각에 달려 시드에 따라 흔들린다 — 쓰지 않는다). (라) 전체 붕괴 하나만으로(폭발 없이) 틈 3 의 이웃에 금 기록이 남는다.
12. **법칙은 원인을 모른다**(소스 글자 검사): (가) `src/sim/world/laws/*.ts`(`index.ts` 제외) **파일 통째**: `.chance(`·`spawnConsequence`·`truth.variant`·`.variant ===`·`d.kind`·`sim.disaster`·`.rules` 가 없다(예외가 없다 — 수위를 읽는 L6 은 법칙 파일이 아니라 상태 규칙이다). (나) 법칙마다 **`scan` 함수의 본문만 잘라**: 시나리오 변형 이름의 글자(`'tree'`·`'pileup'`·`'bus'`·`'gasblast'`·`'wild'`·`'std'` …)가 없다 — 결과의 이름은 `spawn` 안에만 있다. (다) `world/rules/*.ts` 에 `spawnConsequence` 가 없다(I1 의 상태 규칙은 사건을 만들지 않는다 — N8·N9 의 `kinds*.ts` 는 뺀다). (라) `src/sim` 에서 `world/rules/`·`world/laws/` 를 import 하는 줄은 `engine.ts` 와 두 모음 파일, `rules/record.ts` 를 부르는 곳뿐이다(§3.4).
13. 정보 격리 2(소스 글자 — 목록은 §3.8): 7번의 판단 파일들과 **`field/methods.ts`·`field/ops.ts`·`field/airDecide.ts`·`field/gear.ts`·`field/doctrine/*`** 에 `world.hz`·`I.hz`·`fireLoad`·`zoneAt(`·`isDark(`·`.excess`·`.exDiv`·`.exQueue`·`.exOwn`·`.exBump`·`.divertBy`·`closeEv`·`slowEv`·`qEv`·`.bumps`·`.wear`·`expoOf` 가 없고 `/\b(?:tr|traffic)\.divert\b/`·`/\bhz\.(?:src|law|target|at)\b/` 에 걸리는 줄이 없다. `src/sim/world/` 아래 어떤 파일도 `s.rules` 에 쓰지 않는다(`.rules.push`·`.rules =`). `applyExpo` 앞뒤로 `s.rules` 가 같다(L3 시험 ⑦).
14. 법칙마다의 시험: §3.7 의 법칙 절 끝 "테스트" 줄(L1 ①~⑧ · L2 ①~⑦ · L3 ①~⑧ · L7 ①~④ · L5 ①~⑤ · L4 ①~⑥ · L6 ①~⑤)과 상태 규칙(C4 — 그 절의 "테스트" 줄 · C8 — 음영이 늘고 회복 때 원래 0 이던 칸만 되돌린다 · C10 — 근처에 경찰이 있으면 재범이 `'expired'`).
15. 보고서: `chain` 문장마다 가리키는 사건 id·기록·구간·건물이 있고(§3.9 끝), 법칙 사건도 이야기 연쇄도 없는 교대에는 요약의 "인과:" 줄이 없다. 문장에 법칙 id(`roadCrash` 따위)나 "법칙"이라는 말이 없다.

---

## 7. 고칠 파일 목록

**I1-a(이 세션 — 구현됨, `48dba83`)**

| 파일 | 무엇 |
|---|---|
| `scripts/metrics.ts` (새로) | §2.2~2.14 전부 |
| `scripts/sweep.ts` | `runWithProbe`/`--no-metrics`, 지표 줄, `--json` 의 `problems`·`reportHash`·`metrics`, `--metrics`, `--log --metrics`, `--json --check` 의 stderr, `checkMetrics` 를 `fail` 에 |
| `tests/causality.test.ts` (새로) | §6 I1-a |
| (주 세션이 끝에) `docs/ROADMAP.md`·`README.md`·`CLAUDE.md` | 기준 수치(잰 `src/` 커밋과 함께)와 교착 후보, `sweep` 옵션 설명, 명령 표 한 줄(`--metrics`·`--no-metrics`), 명령 표의 `npm test` 줄(테스트 수·파일 수에 `causality`), 함정 한 줄("측정 도구의 문구 규칙 — 기록 문구를 바꾸면 `tests/causality.test.ts` 가 깨진다. `scripts/metrics.ts` 의 표를 함께 고친다") |

**I1-b** — 자기 파일(새로): `src/sim/world/state.ts`, `src/sim/world/consequence.ts`, `src/sim/world/rules/{index,record,hospital,structure,infra}.ts`(상태 규칙 — C6·C3·C2·C4·C8·C10·C11·C5 의 상태 부분), **`src/sim/world/hazard.ts`(초과 위험 과정의 틀 — 등록이 없는 파일), `src/sim/world/expo.ts`(건물의 노출·이웃·`applyExpo`·`darkened` — 등록이 없는 파일), `src/sim/world/laws/{index,road,heat,shock,ember,power,smoke}.ts`(일반 법칙 — import 순서가 결과다. 다른 모듈은 이 파일들을 import 하지 않는다)**, `scripts/hazstats.ts`, `view/city/zoneLayer.ts`. 공용 파일은 아래 함수만, 가장 작은 조각으로(b0~b3-1 이 이미 고친 자리는 구현 메모):

| 파일 | 함수·자리 | 무엇 | 단계 |
|---|---|---|---|
| `types.ts` | "인과 기록" 절 끝 | §3.3 끝의 자료형(`HazardLawId`·`HzWhat`·`HzSrc`·`HzCell`·`HzNote`·`HzState`·`PlaceExpo`, `WorldState.hz`·`expo`, `ZoneState.at`, `Signal.mag`, `Incident.hz`, `WorldTag 'struct'`) | b3-4 (`Signal.mag` 는 b3-8, `ZoneState.at` 은 b3-10 에 써도 자료형은 한 번에) |
| `world/consequence.ts` | `tickWorld`, `spawnRoom`, `signal` | `tickHazards(sim)` 한 줄('tick' 규칙 다음), 전체 상한을 `ruleLoad` 로, `CSQ_SPAWN_CAP` 은 `hazard.ts` 에서 다시 내보내기, `mag` 복사 | b3-4 · b3-8 |
| `world/state.ts` | `initWorld`, `zoneOfPlace`, `placeState`, `setZone`, 새 함수 | `hz`·`expo`·`sills`·`spans` 의 처음 값, 좌표로 구역 찾기, 돌려주는 값에 `shake`·`pipe`·`wet`, `at` 인자(자리·원인·회복 시각은 한 묶음), `zoneAt`·`isDark`·`setZoneArea`·`endZoneBy`·`knownHazardNear` | b3-4 · b3-7 · b3-10 |
| `engine.ts` | import | `import './world/laws'`(`./world/rules` 다음 줄) | b3-4 |
| `incidents.ts` | `SpawnOpts`, `createIncident`, `tickIncidents` | `edgeId`·`causes`·`hz` 세 칸. 리터럴에 `hz: undefined`, `opts.hz` 를 `I.hz` 로, 발생 기록의 `causes` 에 `opts.causes` 를 덧붙임, 교통사고 블록에서 `opts.edgeId` 를 먼저 보기(§3.6b (다) — 다른 사건의 `blockedEdge` 가 아니고 `traffic.canBlock`), **쓰러진 나무의 `cong + 0.7` 한 줄 삭제**(b3-5 ②), 닫힘·감속의 `noteRoadCause`(항이 다르다), 예약을 꺼낼 때 법칙 사건(`opts.hz`)의 건물이 `placeGone` 이면 `'expired'`. `ARMED_BIAS` 를 export(C10) | b3-4 · b3-5 · b3-6 · b3-9 |
| `traffic.ts` | `TrafficState`·`initTraffic`·`drift`·`spawn`·`announce`·`place`·`tickTraffic` | §3.6b 전부: 새 칸, `staticCost`·우회로 다익스트라와 캐시, `divert` 를 `target` 에, 초과의 네 몫, 뿌리의 두 갈래와 `qBy`·`qEv`·`qInc`, 항마다의 장부(`noteRoadCause`·`noteBump`·`unnoteBump`·`addBump`·`removeBump` — export), `announce` 가 기록 id 를 돌려주고 `Obstacle.ev` 에, 정체 객체의 `ev`, 인파의 장부 줄(산술은 그대로), 불법 주차가 치워질 때 `base`, `canBlock`(`disaster.detour` 를 옮긴 것), `roadFlow` export | b3-5 |
| `disaster.ts` | `closeEdge`·`lightsOut`·`lightsOn`·`floodRoads`·`detour`·`onImpact`·`tickQuake` | 통제 기록의 id(`emit` 의 반환값)를 닫힘의 장부에, 정전 `bump` 의 장부 줄(산술은 그대로), `detour` → `traffic.canBlock`, 구간 문턱을 `roadSill(sim, d, e)` 로 읽기(N9 의 자리), 느려진 구간의 `'level'` 장부와 `d.levelEv`, 신호 `blackout`·`quake` 를 보내는 자리(정전·지진을 건물과 구역에 적는 것은 C4 의 규칙이 한다 — 재난 코드는 신호만) | b3-5 · b3-10 · b3-12 |
| `field/sceneManager.ts` | 6) 블록, `createScene` | 전면 통제의 `noteRoadCause(…, 'close', …)`, `buildScene` 다음 `expo.applyExpo(sim, s, I)`, `wear: undefined`. **`tickGas` 를 부르는 조건은 고치지 않는다** | b3-5 · b3-8 |
| `field/kit.ts` | `baseScene` | `wear: undefined`(I2 가 넣기로 한 칸 — 먼저 넣는다) | b3-8 |
| `scenarios/major.ts`·`scenarios/disaster.ts` | 다중 추돌·산사태 `onCreate` | 통제의 `noteRoadCause`(닫힘) | b3-5 |
| `field/catastrophe.ts`(X6) | `blockRoad`, 신호 여섯 자리, `catOf`, `CAT` | 통제의 `noteRoadCause`·면한 길 먼저, `mag`(`collapseBuilding` 1 · `collapseRegion` 이번 몫), 처음 건전도의 `WEAR_INTEG` 한 줄과 그 상수(`CAT.WEAR_INTEG` 0.5) | b3-5 · b3-8 |
| `field/hazards.ts` | `tickFire`, `blast` | `fireLoad`(WeakMap — 큰 불 신호를 세는 순회에 셈 하나), `fireBig` 신호의 `ev` 를 L2 의 규칙으로(`ESCALATION` 을 쓰고 있으면), `blast` 신호의 `mag` | b3-7 · b3-8 |
| `field/hazards.ts` | 도주 블록 | C10: 재범의 장소·`when`·`until`(흐름은 b1 이 넣었다) | b3-9 |
| `resources.ts` | `startTransport`·응급실 대기·병원 인계·이송 중 목적지 변경 | C3(예전 글 그대로) | b3-2 |
| `dispatch/analyst.ts` | 위험도·이름표 | `knownZone`·`knownZoneOfIncident`·`knownBuildingAt`·`knownHazardNear`(§3.8 — 진실 위치·`truth.placeId` 금지): '연소 확대', 알려진 붕괴·폭발 곁의 붕괴·가스 신고, 구역 위험·정전. '재발화' 이름표는 넣지 않는다 | b3-7 · b3-8 · b3-9 · b3-10 |
| `field/executor.ts` | `spray` 의 급수(C11, 선택) | 유입 `1.5 × water` | b3-12 |
| `field/rules/` 의 새 파일 하나 | `registerRule` | 연기 자리의 실외 노출(C5) | b3-11 |
| `field/builders.ts`·`incidents.ts`·`scenarios.ts`·`field/injury.ts` | 응급 현장의 변형 갈래, `scenarioName`, `initInjuries` | 변형 `medical/smoke`(실신의 틀 · 부상 원인 `smoke` · 급변 없음 — L4). 넣지 못하면 L4 를 등록하지 않는다 | b3-11 |
| `debrief.ts` | `PROBLEM_LABEL`·`order`·문장(HOSPITAL_FULL·INFRA_FAIL), `buildReport` 의 내력 문장·`world`·요약 줄 | §3.9 | b3-2 · b3-10 · b4 |
| `view/city/trafficLayer.ts`, `ui/MapLegend.tsx` | `rubble` 기호 | C2 | b3-3 |
| `ui/panels.tsx` | 보고서 사건 항목에 `chain` | | b4 |
| `view/city/ruinLayer.ts`·`view/city/zoneLayer.ts`(새로)·`ui/HazardStrip.tsx`·`ui/MapLegend.tsx` | 교대 중에 보이는 표시(읽기만) | 금 간 건물(`world.expo` 의 `shake ≥ S_MIN` — 관찰자 시점만, 진실)과 끊긴 배관의 작은 기호 · 국지·구역 정전과 연기 자리의 옅은 테(`ZoneState.at` — 관찰자는 진실, AI 시점은 `known` 인 것만) · 사건 카드의 내력 칩 한 개(관찰자 시점에서 `I.hz` 가 있으면 '몰린 길'·'옮겨붙음'·'금 간 건물'·'끊긴 배관'·'정전'·'연기' — §3.9 의 짧은 말) · 범례 두 줄. 그림은 `world.expo`·`world.zones`·`I.hz` 를 **읽기만** 하고 `expoOf`(없으면 만든다)를 부르지 않는다. 몰린 혼잡은 지금의 혼잡 띠(`e.cong`)로 저절로 보인다. 관찰만 하는 시뮬레이션에서 "나무 → 몰림 → 사고"를 교대 중에 읽을 길이 발생 기록의 첫머리 한 줄뿐이면 안 된다 | b4 |
| `scripts/metrics.ts`·`scripts/sweep.ts` | `hazard` 줄·`metrics.hazard`·관문(`holes`·`rootMax`·한 교대 6건), `TAG_SYS` 의 `struct → building`, **`S(I)` 의 `wear` 줄: `s.wear.cause === 'shock'` 이면 `building`, 아니면 `carry`**(지금은 `s.wear` 가 있으면 `carry` — L3 가 교대 안의 충격으로 채우면 I2 가 없는데 "교대 간 지속"으로 세어진다), `--hazard`, 새 기록 문구가 `PHRASE` 에 걸리지 않는지(시험 3), 관문 조이기(M-G1 0, M-G3 3), `isDisasterTag` 는 그대로(법칙 사건에는 재난 꼬리표가 없다) | | b3-4 · b3-8 · b5 |
| `tests/causality.test.ts` | §6 I1-b | 파일이 길어지면 법칙의 시험은 `tests/hazard.test.ts`(새로 — 90초 예산) | 단계마다 |

건드리지 않는다: `city.ts`(읽기만 — `riverDist`·`districtAt`·`weatherSpeedFactor`), `cityPlan.ts`, `view/city/staticCity.ts`, `tests/sim.test.ts`, G4·G5 의 기록 전용 칸을 읽는 코드, **X6 의 `structStep`·`fallStep`·`CAT` 의 지금 있는 수(화재 → 붕괴의 식 — `WEAR_INTEG` 한 칸을 더할 뿐이다)**, `Scene.rules`(읽는 곳도 쓰는 곳도 고치지 않는다), 재난 큐(`disaster.ts` 의 `queue`·`spawn`·`CAP`), 평소 생성기(`createIncident` 의 추첨·`tickIncidents` 의 간격).

---

## 8. 알려진 위험

1. **해시 비교의 기준이 흔들린다.** I1-b 의 b1·b3·b4 는 기록 문구를 더해 모든 해시를 바꾼다. 같은 시기에 G4·G5·U2 처럼 "결과 불변"을 해시로 증명하는 묶음이 있으면, 그 묶음은 **자기 시작 커밋에서** 기준을 다시 재야 한다. I1-a 는 `src/` 를 고치지 않고 기준 커밋에서 만든 브랜치로 증명하므로 이 문제가 없다(§2.15).
2. **측정 도구의 문구 규칙(T1~T5)이 깨지기 쉽다.** 기록 문구를 바꾸면 시스템 분류가 조용히 틀린다. 테스트 3 이 잡게 했지만, 칸으로 가릴 수 있게 되면(I1-b 의 `tag`·`ref`) 문구 규칙을 줄인다.
3. **표본 비용.** 1초마다 열린 현장을 훑는다. P1 뒤 교대 하나가 240ms 안팎이라 표본의 몫이 상대적으로 커진다 — 속도를 잴 때는 `--no-metrics` 로, 전후를 번갈아 돌리고 사용자 CPU(`time`)를 함께 본다(CLAUDE.md "속도 측정"). 앞으로 속도 작업이 내부 배열(대원 목록 등)의 모양을 바꾸면 `Probe` 가 읽는 칸도 따라 고친다.
4. **교착 관문이 처음부터 0 이 아닐 수 있다.** 설계 시험(S0~S7)에서는 0 이지만 40시드에서 후보가 나오면 래칫(`STALL_ALLOW`)으로 걸고, 후보를 고치는 일을 따로 잡아야 한다. 고치지 않고 두면 관문이 "기준선 이하"에 머문다.
5. **멈춤 정의의 거짓 양성·거짓 음성.** 제자리에서 오가며 1.5칸 넘게 움직이는 진동은 진전으로 보인다(거짓 음성). 오래 서서 하는 정당한 일(길목 통제·협상)이 중요도 1 기록 없이 60초를 넘으면 후보가 된다(거짓 양성 — 임무 `phase`·`ring` 이 바뀌지 않는 일). 첫 40시드 후보를 모두 읽고 표를 고친다.
6. **G4·G5 의 기록 전용 칸**을 I1-b 규칙이 읽으면 그 묶음의 "켜고 꺼도 같다" 테스트가 깨진다. 신호는 상태를 바꾸는 자리에서만 보낸다.
7. **도시 지도는 공유 자료다.** 건물 손상을 `city.places` 에 적으면 다음 교대에도 남는다(I2 의 입력 없이). 교대 안은 X6 의 `Sim.placeMarks`, 교대 사이는 I2 의 `carryState.places` 에만 둔다.
8. **객체 모양(P1).** `Incident`·`Scene` 에 칸을 더하고 생성 리터럴에 넣지 않으면 결과는 같아도 눈에 띄게 느려진다(V8 의 숨은 클래스). 0단계에서 모두 넣고 교대당 시간을 전후로 잰다.
9. **병원 포화의 연쇄가 커질 수 있다.** 포화 → 먼 병원 → 구급차가 오래 묶임 → 다른 사건의 구급 부족 → 더 많은 지원 요청. 의도된 사슬이지만 다수 사상자 교대에서 실패가 몰릴 수 있다. 240초 벌점·체류 300초·한도를 §4 순서로 조정한다.
10. **사건이 늘어난다.** 규칙이 만드는 사건은 평소 생성기의 `g.count` 에 들지 않는다(지금의 연쇄와 같다). 부하 감쇠(`incidents.ts:193-202`)는 열린 사건 수를 보므로 자동으로 평소 사건을 늦추지만, 교대당 사건 수 상한(× 1.08 — §4)을 넘으면 법칙의 세기 상수부터 줄인다.
11. **재범 연쇄의 난수 수정**은 이 연쇄가 생긴 모든 교대의 결과를 바꾼다(그 뒤 평소 생성기의 흐름이 달라진다). 1단계에서 따로 커밋하고 기준선을 다시 잰다.
12. **X6 설계서는 아직 검토 중이다.** 이 문서는 X6 초안의 이름(`catastrophe.ts` 의 함수들, `Sim.placeMarks`, `STRUCT_COLLAPSE`·`EXPLOSION`·`BURNOUT`, 전체 붕괴의 구간 통제)에 맞췄다. X6 이 바뀌면 §3.10 의 신호 자리와 C2·C9 를 따라 고친다. X6 이 붕괴·폭발을 더 자주 만들면 C1·C2 의 발동이 늘어난다 — X6 뒤 기준선에서 확률을 다시 본다.
13. **R1 이 부대·대원 수를 바꾼다**(대원 34명 → 63명 안팎). C3 의 병원 한도, C6 의 전환 빈도, 자원 경쟁 지표의 기준선은 R1~R3 뒤에 다시 잰 값으로 판단한다.
14. **재계획 지표가 결정과 자동 경로를 섞는다.** 예: COMM_FAIL 재배정은 지휘관의 판단이지만 PATH_BLOCKED 우회는 실행기의 자동 우회다. 둘 다 "새 정보로 계획을 바꿈"으로 세되 갈래별 숫자를 함께 낸다.
15. **엔트로피는 표본이 작으면 낮게 나온다.** 시나리오별 값은 `n ≥ 5` 만 쓰고 `n` 을 함께 찍는다. 교대 수가 다른 측정끼리 비교하지 않는다.
16. **구역 경계.** `districtAt` 은 가까운 동네를 고르는 함수가 아니다 — 모든 동네의 반지름 × 1.22 밖이면 `null` 이고, 건물의 `Place.dong` 은 그때 `'외곽'`(산이면 `'산촌'`)이 되어 `DISTRICTS` 에 없다(`city.ts:45-53, 318`). 그래서 외곽 건물이 엉뚱한 동네의 상태를 받는 일은 없지만, 대신 **구역 -1** 이 생긴다. 모든 규칙이 -1 을 건너뛰게 했다(§3.2). 범위로 고르는 규칙(C4 (가)·C5·C8 (가) — "원인 지점에서 N 안에 가운데가 있는 동네")은 원인이 외곽이어도 동네 가운데까지 재므로 그대로 돈다. 영향을 받는 것은 **그 점의 구역 하나**를 쓰는 곳뿐이다: C10 의 도주 지점 구역, 관제의 `knownZoneOfIncident`(외곽 신고는 구역 상태로 위험도를 올리지 않는다), 외곽 현장의 음영·연기. 외곽은 밀도가 낮아 잃는 것이 적다고 보고 그대로 둔다.
17. **(2026-11-20) 평소 교대의 결과가 모두 바뀐다.** 우회 몰림(b3-5 ②)은 닫힌 구간이 있는 모든 교대의 혼잡과 대응 시간을 바꾸고, L1 은 재난도 대형 사고도 없는 교대에서 드물게 사고를 더한다(평소의 정체·공사·사고에서 온 초과가 늘 있다 — 12초 표본마다 평균 18구간). "상태가 평소와 같은 교대는 그대로"는 교대 단위로는 성립하지 않고 대상 단위로만 성립한다(§3.6a). b3-5 ② 뒤에 기준을 통째로 다시 잰다.
18. **상수는 거의 다 추측이다.** `DIV_K`·`A_ROAD`·`K_HEAT`·`K_EMBER`·`A_STRUCT`·`A_PIPE`·`K_RE`·`LIFT_RIDE`·`RR_SMOKE` 와 충격의 계수(붕괴 0.6·0.35, 닿는 틈 15, `S_MIN`), 자리마다의 문턱 범위는 조사와 검토의 어림(한 교대짜리 표본 둘~셋과 손 계산)에서 나왔다. 초과를 원인 항으로 재면 적분값이 조사 때(혼잡 값의 차로 잰 것)와 달라진다. 법칙마다 `hazstats` 의 노출량으로 다시 맞춘다(§4). 균형은 보통 120교대로 본다(건물 쪽 법칙은 큰 화재·붕괴 몇 건에 흔들린다 — X6 와 같다).
19. **장부의 구멍.** 구간의 상태를 바꾸는 자리가 열 곳 남짓이라 `noteRoadCause`·`noteBump` 를 빠뜨리기 쉽다. 빠뜨리면 원인 없는 초과가 되어 `holes` 가 는다(그 몫이 전부면 사건도 만들지 않는다) — 관문(`holes = 0`)과 `hazstats` 의 "장부 없는 초과의 노출량"이 잡는다. 새로 길을 닫거나 `bump` 를 얹는 코드를 만들면 장부 한 줄을 함께 넣는다(CLAUDE.md 의 "새 교통 사건·장애물" 절차에 더할 것). **밀림의 꼬리**(뿌리가 풀린 뒤 약 3분)는 밀린 구간 쪽에 복사한 내력(`qEv`)으로 메웠다 — 뿌리의 장부를 그때그때 읽는 구현으로 되돌리면 평소 교대에서 관문이 깨진다.
20. **현장과 지도의 축척이 이어져 있지 않다.** 폭발 반경(칸)을 도시 좌표로 바꾸는 `CELL = 2` 는 표본의 가운데값이다(범위 1.2~4.0). 이웃에 닿는 범위가 현장마다 조금 어긋난다 — 첫 판은 상수로 두고, 어긋남이 눈에 띄면 현장의 건물 폭 ÷ `Place.w` 로 바꾼다.
21. **같은 교차로의 열린 사건 둘.** 이웃 건물의 2/3 가 원인 건물과 같은 교차로다. L2·L3·L5 가 `placeId` 를 정해 사건을 만들면 `pickPlace` 의 "사건 중인 교차로를 피한다"를 비켜 간다. 지도 핀·길가 주차·`knownBuildingAt`·`I.reportedNode` 로 사건을 찾는 코드가 둘을 가리는지 b3-7 에서 먼저 본다. 못 가리면 그 법칙들의 `spawn` 이 그 교차로의 사건이 닫힐 때까지 `null` 을 돌려주고 `hold: 300` 을 준다 — 기다리는 줄은 초과가 끝나도 버려지지 않으므로(§3.6a) 이 갈래에서도 사건이 난다(초안의 규칙으로는 불이 꺼지는 순간 기다리던 것이 모두 버려졌다). **같은 건물**에는 틀이 막는다(열린 사건이 있으면 기다리고, 전소·전체 붕괴면 버린다).
22. **X6 의 수가 흔들린다.** L3 의 `wear` 는 처음 건전도를 낮추고 새는 밸브는 가스 폭발을 늘린다 — 전체 붕괴·폭발이 X6 의 기준에서 벗어나면 `WEAR_INTEG`·`K_SHOCK` 를 줄인다(X6 의 식은 고치지 않는다). 화재 균형은 사용자 결정으로 N9 뒤에 본다 — L2 가 화재 사건을 교대당 0.05~0.1건 더하는 것은 그 결정의 범위 안에서 받아들인다(화재 성공률이 기준 − 2%p 를 넘게 내려가면 `K_HEAT` 를 줄인다).
23. **재난 큐와 겹친다.** 태풍·홍수·지진의 큐가 같은 종류의 사건(미끄러진 차·물에 잠긴 도로의 충돌·승강기 3건·여진 붕괴)을 직접 일으킨다. 법칙은 재난의 종류를 읽지 않고 상태만 읽으므로 논리로는 겹치지 않지만 수로는 더해진다 — 재난 교대의 사건 수(기준 × 1.1)와 한계 시간으로 본다. 재난 큐 자체를 상태 법칙으로 옮기는 일은 I1 밖이다(N6 의 다시 쓰기 — ROADMAP 의 새 항목으로).
24. **재난의 충격 단계에는 열린 사건이 한도를 넘는다.** 법칙의 사건은 60초까지 기다리다 버려진다(§3.6a). 재난 교대의 `hazard.waited`·`dropped.expired` 가 `natural` 보다 훨씬 크면 `HZ.HOLD` 를 늘리는 대신 그대로 둔다(부하가 높을 때 사건을 더 얹지 않는 것이 맞다).
25. **`Math.log`·`Math.exp`.** 문턱과 닫힌 꼴의 식이 쓴다. `src/sim` 은 이미 `Math.exp` 를 쓴다(`traffic.timeOfDay`) — 같은 기계·같은 런타임에서 결정적이다. 브라우저와 헤드리스의 해시 비교(`npm run ui-check`)가 법칙이 걸린 시드에서도 같은지 b4 에서 한 번 본다.
26. **N8 의 조건부 연쇄(K1~K8)는 "X 가 실패하면 Y" 꼴로 설계돼 있다**(N8 §5.6 — `spawnConsequence`). 사용자의 방향과 어긋날 수 있다. I1-b 는 그 함수를 남겨 두되, N8 구현 전에 그 여덟을 이 문서의 틀로 옮길 수 있는지 다시 본다(§3.7 끝).
27. **"한 사슬 3건"의 뜻.** `canChain` 은 사슬의 길이만 본다. 법칙은 한 뿌리에서 가지가 여럿 나므로 `HZ.ROOT_MAX`(한 뿌리의 법칙 사건 2건)로 묶었다 — 사용자 결정을 좁게 읽은 기본값이다(§9 의 질문). 넓게 읽어도 된다는 답을 받으면 `ROOT_MAX` 만 올린다(법칙 상한과 한 교대 6건이 남는다).
28. **숨은 손상이 판단으로 새는 길.** `Scene.rules`·`s.kind` 처럼 판단부가 "생김새"로 읽는 칸에 세계 규칙이 진실을 적으면 글자 검사에 걸리지 않고 정보 격리가 깨진다(초안의 `applyExpo` 가 `s.rules` 에 `'gas'` 를 더하려 했다). 세계 쪽(`src/sim/world/`)은 `s.rules` 에 쓰지 않는다 — 시험이 글자로 본다. 새 진실 전용 칸은 `s.wear` 처럼 판단 파일의 금지 글자 목록에 함께 넣는다.
29. **등록 순서가 import 한 줄에 달려 있다.** 법칙·규칙 파일을 다른 모듈이 import 하면 그 파일의 등록이 모음 파일의 차례보다 먼저 실행된다(§3.4). 다른 모듈이 부를 함수는 `world/expo.ts`·`state.ts`·`hazard.ts` 에 둔다 — 시험이 import 줄을 글자로 본다.
30. **시드가 도시 캐시로 새는 길.** 건물·동네마다 한 번 뽑는 문턱을 `city.places` 열쇠의 `WeakMap` 에 두면 앞 시드의 값이 뒤 시드에 쓰인다 — 같은 시드를 두 번 견주는 시험으로는 잡히지 않는다(§3.6c, §6 I1-b 1 의 "A 다음의 B").
31. **워크플로 대본이 옛 차례다.** `docs/specs/workflows/args/I1-b.json` 의 덩어리(`b3a`·`b3b`)는 없어진 규칙(C9·C1·C12)을 가리킨다. 주 세션이 §5 의 덩어리 표(h1~h8)로 바꾼 뒤에 띄운다.
32. **평소 교대의 사고가 는다.** L1 은 평소의 정체·공사·사고에서 온 초과로도 사고를 낸다(교대당 0.2~0.5건 — §9 의 질문). 사용자가 "큰 원인이 있을 때만"을 원하면 `roadCrash` 의 대상을 "주인 사건이 있거나 재난·전면 통제에서 온 몫이 1/3 이상인 구간"으로 좁히는 대신, 세기를 낮추는 쪽이 법칙을 일반 법칙으로 남긴다.

---

## 9. 결정해 둔 것 (조사에서 열려 있던 질문)

| 질문 | 결정 | 까닭 |
|---|---|---|
| "시스템"의 정의 | 모듈 단위 14개(§2.3, I2 의 `carry` 포함)와 사건·문제·종류·문구의 대응표 | 역할(role)로는 지금의 사슬이 이미 2~4개 역할을 지나지만 신고 단계 안이라 의미가 없다 |
| 건물 상태를 `sim.world` 로 옮길까(X6 의 제안) | **X6 가 가진 상태는** 옮기지 않는다. 교대 안은 X6 의 `Sim.placeMarks`, 교대 사이는 I2 의 `carryState.places`. I1-b 는 둘을 읽는 `placeState`(규칙 쪽)·`knownBuildingAt`(관제 쪽 — 알려진 교차로로 묻는다)를 둔다. **(2026-11-20) 사건이 없던 건물이 이웃에서 받은 노출·손상만 `sim.world.expo` 에 새로 둔다**(§3.6c) — `placeState` 가 합쳐 돌려준다 | G4·I2 가 이미 `placeMarks` 를 읽는다. `PlaceMark` 는 "그 건물의 사건이 남긴 상태 하나"라 이웃의 노출을 넣으면 읽는 곳 일곱을 고쳐야 하고 진짜 사건이 나면 덮인다 |
| 연쇄 깊이를 `parent` 로 셀까 `causes` 로 셀까 | 둘 다, 따로 낸다. `parent` 는 엄격한 깊이와 재난 뿌리 +1 두 가지 | 사건을 낳은 사슬과 기록이 이어진 사슬은 다른 질문이다 |
| I1-a 가 `causes`·`parent` 를 채울까 | 아니다. `src/` 무변경. 채우는 것은 I1-b 0단계(해시 불변 — `logHash` 는 문구만 본다) | 결과 불변을 한 줄로 증명하고, 이번 세션의 다른 작업과 파일이 겹치지 않게 |
| "시립병원" 문구를 I1-a 에서 고칠까 | 아니다. C5 로 보고만 한다. 고치는 것은 R1 단계 3(`startTransport` 가 병원을 돌려준다)이고, I1-b b1 은 C5 = 0 을 확인하고 관문을 켠다(R1 이 하지 않았을 때만 b1 에서 고친다) | 문구를 바꾸면 해시가 바뀌어 G4·U2 의 비교 기준과 부딪힌다. 같은 줄을 두 묶음이 고치지 않는다 |
| 재계획에 넣을 것 | §2.6 의 집합. FALSE_ALARM·UNDER_DISPATCH 복구·NO_UNIT 복구는 뺀다. `recoveredShare` 키는 그대로 두고 새 키 `replan` | 계획을 바꾼 것만 센다. 다른 설계서의 전후 비교를 깨지 않는다 |
| 멈춘 시간의 정의 | 엄격한 멈춤(조건 넷 + 진전 신호, 60초)과 잊힌 사건(통화 뒤 30초, 위치·평가가 있는 사건만)만 관문 — 보통 기본 조건에서 래칫. 위치를 모르는 사건(`unlocated`)과 느슨한 대기는 보고만. 표본은 기본으로 켜고 `--no-metrics` 로 끈다 | 설계 시험에서 거짓 양성을 하나씩 걷어낸 정의. 관문이 쓰려면 기본으로 켜져 있어야 한다 |
| 결과 다양성의 열쇠 | 결과(K1)와 결과 × 주된 문제(K2), 엔트로피와 가짓수 | 전체 문제 집합은 모두 달라 의미가 없고, 결과만은 너무 거칠다 |
| 관문에 무엇을 걸까 | 상한만(교착·잊힘·연쇄 깊이·연쇄 수)과 일치 검사. 하한은 I1-b 완료 조건과 테스트로 | 지금 0 인 드문 값의 하한은 40시드에서 흔들린다 |
| 자원 경쟁의 단위 | 사건 단위 비율과 교대 단위(지원 수·최대 동시 사건·최대 바쁨) 둘 다 + 전환의 실제 지연 | 비율만으로는 "다른 사건에 실제로 영향"을 말할 수 없다 |
| R2·H1 과 이름 | I1-a 는 `metrics` 키 하나와 9개 줄 접두어. R2 의 `methods`·H1 의 최상위 키·`injuries:` 와 겹치지 않는다. R2 의 `I.methods` 는 있으면 읽는다 | |
| 날씨가 사건을 낳는 길(폭우 → 사고) | 고정 날씨(비·안개)로 사건을 늘리지 않는다. **(2026-11-20) 날씨와 재난의 비바람은 L1 의 노면·시야 항으로 초과분에만 곱한다** — 막히거나 몰린 길이 없으면 0 이다. 예전의 선택 규칙 C12 `stormPileup` 은 없앴다 | 날씨가 교대 내내 고정이라 유형 가중치는 인과보다 난이도에 가깝다. 초과에 곱하면 "빗길에 막힌 길은 더 위험하다"가 되고 원인(통제·정전)을 기록으로 이을 수 있다 |
| **(2026-11-20 사용자 방향) 인과를 어떻게 만드는가** | "인과가 자연스럽게 스크립트대로 말고 생기게" — 규칙이 사건을 직접 만들지 않는다. 원인 → 상태 → 일반 법칙(초과 위험 과정) → 사건(§3.1·§3.6a·§3.7). 사용자의 예 셋은 §3.12 ①~③ | 사용자의 말 그대로 |
| 평소 교대의 초과(정체·공사·평소 사고의 밀림)에서도 사고가 나는가 | **난다**(기본값 — 사용자에게 확인할 것). 법칙은 원인을 가리지 않는다. 세기는 보통 교대에 0.2~0.5건 | "나무든 사고 통제든 인파든 혼잡이면 같다"가 일반 법칙의 뜻이다. 평소 교통 사건을 빼면 법칙이 원인을 아는 셈이 된다 |
| 우회 몰림이 긴급 차량도 늦추는가 | **늦춘다**(기본값 — 사용자에게 확인할 것). 평균 대응 +3초 안으로 맞춘다 | 몰린 길은 누구에게나 몰린 길이다 |
| 초과 사건과 연쇄 상한 | **사용자 결정(한 사슬 3건 · 한 교대 6건)은 그대로.** 부모가 있는 초과 사건은 이야기 연쇄와 같은 6건을 나눠 쓴다. **부모가 없는 것(공사·정체·인파·재난에서 온 초과)도 그 6건 안에서 센다**(그 안에서 3건까지 — `ORPHAN_CAP`). 초안은 6건 밖에 따로 3건을 두었는데 그러면 한 교대에 인과로 난 사건이 9건까지 된다 — **따로 세어도 되는지는 사용자에게 확인할 것**(안쪽이면 극한에서 이야기 연쇄가 길 위의 사고와 자리를 나눈다 — 극한 30교대에 상한으로 버린 연쇄가 이미 36건이다) | 답을 받기 전 기본값은 상한의 안쪽이어야 한다 |
| "한 사슬 3건"의 뜻 | 길이(지금의 `canChain`)에 더해 **한 뿌리에서 난 법칙 사건을 2건까지**(`HZ.ROOT_MAX` — 뿌리 포함 3건)로 묶는다. **길이로만 봐도 되는지는 사용자에게 확인할 것** | 이야기 연쇄는 한 사건이 하나를 낳지만 법칙은 한 뿌리에서 여러 대상이 함께 넘는다(큰 불 곁의 이웃들과 연기 환자). 기본값은 좁은 쪽 |
| 문턱을 넘었는데 상한에 걸리면 | 버린다(적분값에서 문턱만큼 빼고 다음 문턱을 새로 뽑는다 — 건물마다 한 번인 법칙은 그 대상이 끝난다). 부하·자리 문제만 기다리는 줄에 넣는다(기본 60초, 넘는 순간의 몫을 적어 둔다 — §3.6a) | 상한은 교대 안에서 다시 열리지 않는다 — 쌓아 두면 교대 끝에 몰린다 |
| 사건의 원인이 여럿일 때 | 넘는 **순간의** 몫으로 정한다(쌓인 양의 비가 아니다). 가장 큰 몫이 `cause`, 나머지가 `causes`, 부모는 주인 사건이 있는 가장 큰 몫(1/3 이상일 때) | 겹친 푸아송 과정에서 사건이 몫 i 의 것일 확률은 그 순간의 `λᵢ/Σλ` 다. 오래전에 지나간 통제를 지금 사고의 원인이라고 쓰지 않는다 |
| 연속 값의 기록 | 우회 몰림·열 노출 같은 연속 값은 기록하지 않는다. 내력은 사건이 날 때 그 자리에서 `Incident.hz` 에 적는다 | 지금도 혼잡의 변화는 기록하지 않는다. "△△로 밀림" 기록을 `drift` 마다 남기면 통제가 있는 모든 교대의 기록이 불어난다. 발생 기록은 상태(문턱을 넘음)를 바꾸는 그 자리에서 남으므로 가짜 기록이 아니다 |
| 재발화(L7)의 빈도 | 상태로만 내면 보통 교대에 거의 0건 — **그대로 둔다.** 잘 끈 화재에서도 나오게 하는 새 물리(탄 칸의 잔열)는 N9 뒤 화재 균형 때 | 사용자 결정: 화재 균형은 N9 뒤에 다시 본다 |
| 도주 용의자의 재범(C10) | 조건으로 움직이는 지금 설계를 둔다(초과 위험으로 바꾸지 않는다) | 행위자의 선택이고 이야기 연쇄다(사용자 결정으로 그대로) |
| 잠긴 지하의 구조 현장 · 재난 큐의 "X 면 Y" | 이번에 하지 않는다. 침수는 상태(정전 → 승강기, 느려진 길 → L1)까지만, 재난 큐는 그대로(**사용자에게 알릴 것**: 태풍·홍수·지진이 일으키는 사건 묶음은 아직 "재난이면 이 사건들"이라는 대본이다 — 고치려면 N6 를 다시 써야 한다) | 현장 틀이 없다(N9 가 지하차도를 만든다). 재난 큐는 N6 의 것이다 |
| 물에 잠긴 길의 사건(L6 의 구간 갈래) | 따로 두지 않는다. 차오르는 물에 느려진 길은 교통의 초과 한 항(`'level'`)으로 L1 에 들어간다 | "통제 순간 한 번의 충격 → `water/std`"는 원인이 홍수 하나뿐이라 이름만 바꾼 스크립트였고, 하천 현장이 기록과 맞지 않았다 |
| 법칙이 다중 추돌을 내는가 · '재발화' 이름표 · 연기 환자의 변형 | 다중 추돌은 내지 않는다(고속도 `std` 규모 3) · '재발화' 이름표는 L7 의 물리와 함께 뒤로 · 연기 환자는 변형 `medical/smoke` | 대형 사고는 교대에 많아야 하나(N5) · 교차로와 종류로 찾는 이름표는 거의 다 틀린 이름표가 된다 · 실신 현장은 '원인은 부정맥'으로 급변할 수 있어 기록 둘이 다른 말을 한다 |
| 숨은 배관 손상과 현장의 가스 규칙 | 새는 밸브 소품만 놓는다. `s.rules` 에 `'gas'` 를 더하지 않고 옛 가스 규칙(`tickGas`)도 돌리지 않는다(첫 판) | `s.rules` 는 판단부가 생김새로 읽는 칸이고 연기 피해의 원인을 정한다. X6 의 가스 격자와 폭발은 밸브 소품만으로 돈다 |

---

## 10. 검토 메모

독립 검토 두 갈래(구현 가능성·규칙 / 빠진 것)를 반영했다. 고친 것은 본문에 녹였고, 받아들이지 않았거나 다르게 받아들인 것만 이유를 적는다.

**다르게 받아들인 것**

- **잊힌 사건의 조건**(§2.10 나): 한 검토는 `!I.locationKnown || !I.assessment` 를 관문 조건 안에 넣자고 했고, 다른 검토는 위치·평가가 있는 사건만 관문에 걸고 위치를 모르는 사건은 따로 보고만 하자고 했다. 뒤의 것을 택했다(`forgotten` + 보고만 하는 `unlocated`). 위치를 대지 못한 신고는 배정이 잊은 것이 아니라 정보가 모자란 것이고, 극한의 막연한 신고에서는 정상적인 결과라 관문에 걸면 조건에 따라 흔들린다. 검토 때 넓은 정의로 잰 S0~S2 값(0건, 최장 13초)은 둘 다 0 임을 보여 준다.
- **확산 단계의 왕복**(§2.5): 한 검토는 최댓값 길에만 "서로 다른 쌍이 셋 이상" 검사를 덧붙이자고 했고, 다른 검토는 `spread` 자체를 서로 다른 `(사건, 시스템)` 쌍의 수로 바꾸고 raw 값을 함께 내자고 했다. 뒤의 것을 택했다 — `ge3`·완료 기준·예시가 같은 한 숫자를 쓰게 되고, raw 는 `spreadRaw`·`rawMax`·`rawGe3` 로 비교용으로 남는다. DP 는 raw 를 최대로 하는 길을 고르므로 distinct 가 더 큰 다른 길을 놓칠 수 있는데, 값을 부풀리지 않는 쪽이라 받아들였다.
- **빈 `signal` 함수의 타입**(§3.10): 한 검토는 X6 이 먼저 만들면 `kind: string` 으로 두자고 했다. 그러지 않고 X6 이 같은 `SignalKind` 합집합을 빈 파일에 두고(X6 설계서가 이미 그렇게 적었다) I1-b b2 가 그 정의를 `types.ts` 로 옮긴 뒤 다시 내보내게 했다. 문자열로 두면 X6 의 호출 자리에서 오타를 잡지 못한다.
- **X6 쪽 문장 수정 요청**: X6 설계서의 연관 표 I1-b 줄은 이 검토 사이에 이미 "옮기지 않는다"·"빈 함수와 `SignalKind` 를 만든다"로 고쳐졌다(작업 폴더의 X6 수정본). 그래서 요청 줄을 두지 않고 연관 표에 그 사실만 적었다.
- **정보 격리 글자 검사의 `truth.placeId`**(§6 I1-b 7): 금지 글자에 더했지만 `dispatch/*` 전체가 아니라 `analyst.ts`·`dispatcher.ts` 에만 건다. `callSystem.ts` 의 신고자 모델은 신고자가 본 것을 정하려고 지금도 진실을 읽는다(`callSystem.ts:113` 등) — 전체에 걸면 바로 실패한다.
- **사용자 예시 사슬의 첫 화살표**(§3.12): 검토는 재난 큐에 다중 추돌을 넣거나 '교대 시작. 날씨: 비' 기록을 원인으로 쓰자고 했다. 고정 날씨는 원인으로 쓰지 않고(§9 — 인과보다 난이도에 가깝다), 재난의 충격 단계 + 혼잡한 간선 조건으로 일어나는 선택 규칙 C12 로 두었다. 재난 큐에 고정으로 넣으면 "고정된 순서로 연출하지 않는다"는 원칙과 부딪힌다.
- **도로 통제 → 특정 병원 이송**(C3-6): 검토는 한 줄을 더하자고 했지만, "알려진 통제 때문에 다른 병원을 골랐다"를 정확히 가리려면 통제 없는 도로의 기준 경로가 있어야 한다(`findRoute` 에 통제 무시 선택이 없다). 그래서 병원별 통제 없는 최단 경로 나무를 한 번 만들어 그 길 위의 알려진 통제만 원인으로 잇는 **선택** 항목으로 두었다. 기준 경로 없이 "가장 최근 통제"를 원인으로 달면 기록과 상태가 어긋날 수 있다.

**받아들이지 않은 것**: 없다. 두 검토의 나머지 지적(진전 신호의 불 칸 감소, 오류 칸 분리, 멈춤 감지기 테스트, 전환의 사후 탐지, 시도 번호 난수, 관제 쪽 위치, 방화 원인, R1 과의 중복 소유, 미리 넣는 문제 코드, 재난 큐 근사, 신호 처리 경계, `tile` 열쇠, 구역 -1, 음영 그림, 드문 기반 시설 갈래, TRAFFIC_DELAY 의 원인, C1 의 쓸 수 있는 건물, `ARMED_BIAS` export, 사실 오류, 중요도 0 지시, `findRoute` 호출 자리와 `startTransport` 잘라 검사, 사건 없는 기록의 `S(I)`, `fromWorld` 의 범위, 기준 커밋 브랜치, `casualty`·T6 문구 규칙, 관문 적용 범위·`REPEAT_MAX`, WITHDRAWAL·DANGER_SIGN, C2 의 기록, 허위·오인과 모으는 법, `peakBusyAvg` 분모와 `--check --no-metrics`, 이름 겹침, PATH_BLOCKED 이중 계산, CLAUDE.md 테스트 수)은 모두 본문에 반영했다.

**검토로 새로 확인된 사실**(본문에 반영): I1-a 는 결과를 바꾸지 않는다(`src/` 는 `a746b77` 이후 무변경, 해시는 틱과 문구만, `fork` 는 부모를 소비하지 않음, 매 표본 읽기만 하는 스크립트로 S1·S2 해시가 `runToEnd` 와 같음). 문구 규칙 T1~T4 는 S0~S2 에서 각각 6·5·48·47번 걸린다. C1·C2·C3 은 S0~S2 에서 0, C5 는 14/47. 사건 사이를 가리키는 `causes` 는 0개.

**방향 전환 메모 (2026-11-20 — 무엇이 왜 바뀌었나)**

사용자의 말("인과가 자연스럽게 스크립트대로 말고 생기게 못하나 …")에 맞춰 b3-4 부터를 다시 썼다. 조사 넷(사건 생성기와 연쇄 · 교통 모델 · 물리 전파 · 기반 시설과 재난)의 결과를 반영했다.

- **없앤 것**: "원인 X 면 확률 p 로 사건 Y" 꼴 — C1 `blastSpread`(후보마다 0.3 × (1 − d/R), 반경 `40 + 18 × size` 가 건물 6~20채를 덮어 물리와도 맞지 않았다), C9 의 확률 추첨, C5-1(60초에 한 번 확률), C4-2·C4-3(0.6·0.4), C7(60초에 한 번 0.3), C12 `stormPileup`, C4·C8·C11 의 지진 확률(0.5·0.4·0.3). §3.4 의 "시도 번호 흐름으로 되풀이하는 확률 판정"은 I1 의 어느 규칙도 쓰지 않게 됐다(틀은 그대로 둔다).
- **대신 넣은 것**: 초과 위험 과정(§3.6a — 대상마다 한 번 뽑는 문턱, 순간의 몫으로 귀속), 교통의 우회 몰림과 초과 혼잡의 장부(§3.6b), 건물의 노출 상태와 국지 구역 값(§3.6c), 일반 법칙 L1~L7.
- **초안에서 고친 것**(조사 결과): ① "상태가 평소와 같은 교대는 결과가 바뀌지 않는다"는 교대 단위로는 성립하지 않는다 — 평소에도 초과 혼잡이 늘 있다. 대상 단위의 보장으로 바꿨다. ② "초과 사건은 모두 부모를 갖는다"도 성립하지 않는다 — 공사·정체·인파·재난에는 사건이 없다. 부모 없는 것의 상한을 따로 뒀다. ③ 꺼진 신호를 L1 에 따로 곱하지 않는다 — 정전은 이미 `bump` 로 혼잡에 들어 있다(두 번 센다). ④ 건물 쪽은 "평소의 몇 배"가 단위가 못 된다(한 채의 평소율이 88배까지 차이 나고 너무 낮다) — 양과 건물마다의 문턱으로 썼다. ⑤ 손상된 이웃에서 나중에 우연히 사건이 날 확률은 3% 안팎이라 "다음 사건이 더 커진다"만으로는 보이지 않는다 — 손상이 그 건물의 위험률을 올리는 법칙(`structFail`·`pipeLeak`)을 더했다. ⑥ 잔불(L7)은 지금 물리로는 거의 남지 않는다 — 정직하게 0 에 가깝게 두고 새 물리는 화재 균형 때로 미뤘다. ⑦ 귀속은 쌓인 양이 아니라 넘는 순간의 몫으로 한다. ⑧ 연기·정전은 동네 단위가 너무 굵어 국지 자리를 뒀다. ⑨ 잠긴 지하의 사건은 현장 틀이 없어 상태까지만.
- **그대로 둔 것**: C6·C3·C2(글자 그대로), C10(조건 + 이야기 연쇄), C4·C8·C5·C11 의 상태 부분(원천을 넓히고 사건을 만드는 가지만 법칙으로 옮김), b0~b2 의 틀과 이름, 연쇄 상한, X6 의 화재 → 붕괴.
- **틀린 글을 고친 것**: §3.2 의 "'산촌'은 `DISTRICTS` 에 없다"(있다 — `zoneOfPlace` 를 좌표로 바꾼다), C11 의 "신호 `collapse`(size ≥ 10)"(X6 의 붕괴는 `catastrophe` 신호다), §4 의 "부모 있는 사건 2~8%"(지금 0.5% — 목표를 1~5% 로).

**검토 반영 메모 (2026-11-20 밤 — 방향 전환 초안 `867a5dc` 를 독립 검토 세 갈래가 읽었다: 결정성·되먹임·끝남·비용 / 자연스러움·정보 격리·정직한 기록 / 실현성·균형·단계)**

요지: **틀의 뼈대(대상마다 한 번 뽑는 문턱 · 넘는 순간의 몫으로 귀속 · 상한에 걸리면 버림)는 그대로 두고 가장자리를 고쳤다.** 고친 까닭은 넷으로 묶인다. ① **정보 격리와 가짜 기록** — 숨은 배관 손상을 판단부가 읽는 `s.rules` 에 적지 않는다(밸브 소품만), 법칙 사건을 전소 건물 대신 엉뚱한 건물에 내거나 불 난 그 건물에 또 열지 않는다(틀의 공통 조건), 연기 환자를 '원인은 부정맥'으로 급변할 수 있는 실신 현장에 얹지 않는다(`medical/smoke`), 원인 기록으로 `ESCALATION` 을 쓰지 않는다, 내력 문장의 "약 N초"를 몫마다 잰다, 기록 없는 큰 몫을 뒤로 숨기지 않는다. ② **장부** — 구간마다 한 칸이던 장부를 항마다의 주인과 `bump` 줄로 바꾸고, 밀림의 내력을 밀린 구간 쪽에 복사해 뿌리가 풀린 뒤 3분의 꼬리가 구멍이 되지 않게 했으며, 수요만으로 꽉 찬 구간의 밀림은 원인 탓으로 돌리지 않는다. ③ **증거가 증거이게** — 쓰러진 나무의 개입 시험은 장부를 지워서 저절로 통과했다: 상태(통제와 감속)만 되돌리고 장부는 두며 다른 원인을 얼리고, 장부만 지운 대조를 더했다. ④ **균형과 실현** — `A_ROAD` 를 1/4 로(초안 값은 스스로의 목표의 4~6배), `LIFT_RIDE` 를 0.4배로, 붕괴의 충격을 한 번으로도 금과 배관 문턱에 닿게(초안 값으로는 사용자의 예 ②가 붕괴에서 사실상 0 이었다), 다중 추돌·'재발화' 이름표·물에 잠긴 길의 충격 갈래를 뺐고(대형 사고는 교대에 하나 · 틀린 이름표 · 이름만 바꾼 스크립트), 부모 없는 법칙 사건을 한 교대 6건 **안**에서 세고 한 뿌리의 가지를 2건으로 묶었으며(사용자 결정의 좁은 해석 — §9 의 질문), 정전의 회복 시각을 `Infinity` 로 두지 않고, 지진·태풍 정전이 틀을 지나는 신호 둘을 더하고, 등록 파일의 import 규칙·시드가 도시 캐시로 새지 않는 규칙·단계별 해시 확인법·덩어리 계획(h1~h8)·교대 중에 보이는 화면 표시를 정했다.

**받아들인 것**: must 넷(가지로는 셋 — 건물에 내는 사건의 공통 조건 · `s.rules`(두 갈래가 함께 짚었다) · 개입 시험)은 모두, should 는 아래 "다르게"를 빼고 모두(밀림의 꼬리, `once`·기다리는 줄, 한 뿌리의 가지, 시드와 도시 캐시, `bump` 줄, 정전의 회복, 사고 구간의 통제 조건, 평소의 뿌리, 몫마다의 `since`, 귀속의 줄 세우기, 충격의 크기, 원인 기록의 규칙, 국지 값의 묶음, `medical/smoke`, `knownHazardNear`, 한 교대 6건 안쪽, 첫 상수, 글자 검사, 커밋 나누기, 덩어리, 측정 도구의 `wear`, 등록 파일, 재난의 신호, 화면, 시간 예산, 한 `Sim` 의 평균 시험), nit 도 모두(문구·기록 수·상수의 자리·시험의 흔들림).

**다르게 받아들인 것과 까닭**:

- **숨은 배관 손상의 가스 규칙** — 한 검토는 진실 전용 표시(`s.wear.pipe`)를 두고 `tickGas` 와 독성 판정이 그것을 읽게 하자고 했고, 다른 검토는 밸브 소품만 놓고 옛 가스 규칙을 돌리지 말자고 했다. 뒤의 것을 택했다 — X6 의 가스 격자와 폭발은 밸브 소품만으로 돌고, `sceneManager`·`injury.ts` 의 조건을 고치면 화재 현장의 연기 피해가 유독 가스로 바뀌는 것을 다시 막아야 한다. 같은 검토의 시험("밸브를 보기 전까지 두 현장의 기록이 같다")은 쓰지 않았다 — 밸브 소품이 칸 하나를 막아 길이 달라지므로 정보 격리가 지켜져도 기록은 갈린다. 대신 "`applyExpo` 앞뒤로 `s.rules` 가 같다 + 믿음이 없는 대원의 방법 선택(순수 함수)이 같다 + 세계 쪽은 `s.rules` 에 쓰지 않는다(글자)".
- **기다림** — "초과가 끝난 뒤에도 기다리는 초(`holdPast`)"가 아니라 "기다리는 줄에 넘는 순간의 몫을 적어 두고, 초과가 끝난 것만으로는 버리지 않는다 + 법칙마다 마감(`hold`)"으로 했다. 한 장치로 충격 법칙·12초 법칙·L2 의 대비책이 모두 풀린다. 넘은 시각의 보간은 없앴다(미래 예약에 `when` 을 붙이는 쪽이 아니라).
- **물에 잠긴 길** — 세 검토가 서로 다른 답을 냈다(충격을 시간 적분으로 · 갈래를 없애고 교통의 초과 한 항으로 · 지하차도에 문턱을 따로 주고 충격). 갈래를 없애고 `'level'` 항으로 L1 에 넣었다 — "통제 순간 한 번"은 무엇으로 바꿔도 원인이 하나뿐인 스크립트이고, 느려진 길을 교통의 상태로 넣으면 시간 적분은 L1 이 저절로 한다. 지하차도의 문턱은 `disaster.roadSill` 한 함수로 N9 의 자리를 남겼다(충격은 주지 않는다).
- **충격의 수** — 두 검토의 값 가운데 어림이 함께 적힌 쪽(붕괴 0.6 · 0.35, 틈 15, `S_MIN` 0.1, 배관 문턱은 0.2 + 0.6u 그대로)을 택했다. 모두 첫 값이다.
- **산불 자리의 건물** — `disaster.inWildfire` 를 내보내 빼는 대신 조건 자체를 뺐다(이미 불이 난 건물·쓸 수 없는 건물이 걸러진다). 법칙이 재난을 묻는 함수를 하나라도 부르면 "원인을 모른다"가 흐려진다.
- **장부** — "한 구간에 원인이 둘이면 통제의 기록을 남긴다"(한 칸을 지키는 안) 대신 항마다 주인을 두어 덮는 순서 문제를 없앴다. "원인 있는 뿌리가 둘이면 다른 쪽을 `causes` 로"는 넣지 않았다 — 밀림의 내력은 먼저 뿌리가 된 쪽 하나만 복사한다(둘째 뿌리가 닫힌 구간이면 어차피 `divert` 몫으로 들어온다).
- **정전 규칙의 열쇠** — 검토는 정전을 거는 규칙을 동네 열쇠·쿨다운 300초로 둔 채 끝을 받는 규칙만 따로 두자고 했다. 한 신호가 여러 동네를 끄므로 열쇠를 신호(`ev:<기록>`)로 바꾸고 쿨다운을 없앴다 — 같은 동네의 겹침은 `setZone` 의 "더 나쁜 값만"이 막는다.
- **금지 글자 `.hz`** — 검사 대상을 교본(`doctrine/*`)까지 넓히면 R3 의 `c.hz`("위험 실내 일인가")에 바로 걸린다(코드로 확인). `world.hz`·`I.hz` 와 `hz.(src|law|target|at)` 로 좁혔다.

**버린 것**: 없다(위의 "다르게"가 전부다). 검토가 틀린 곳은 찾지 못했다 — 짚은 코드 사실(`methods.announceOk`·`injury.smokeCause` 가 `s.rules` 를 읽는다, 쓰러진 나무가 `slow += 1.4` 도 건다, 밀림이 ×0.75 로 남는다, `disaster.closeEdge` 가 `emit` 을 쓴다, `dispatcher.ts` 의 `divertFrom`·`diverted`, 측정 도구의 `wear → carry`, `consequence.fire` 가 쿨다운을 `test` 앞에서 본다, `tickMedical` 의 변형 갈래)은 모두 맞았다.

**사용자에게 남은 질문**은 §9 에 모았다: 평소 교대에서도 몰린 길의 사고가 나는가 · 우회 몰림이 긴급 차량도 늦추는가 · 부모 없는 법칙 사건을 한 교대 6건과 따로 세어도 되는가 · "한 사슬 3건"을 길이로만 봐도 되는가. 넷 다 기본값이 상한의 안쪽이라 답을 기다리지 않고 구현해도 사용자 결정을 깨지 않는다. 알릴 것 하나: 재난 큐(태풍·홍수·지진이 일으키는 사건 묶음)는 이번에도 대본 그대로다.

---

## 구현 메모 (진행 중)

뒤 단계의 작업자는 이 절을 본문보다 먼저 읽는다(코드가 정본 — 이름·자리가 본문과 다르면 여기에 적었다).

### b0 — 기록만 잇기 (2026-11-15, 준비 줄. 브랜치 `wf/causality-b0` → `wf/causality`, 시작점 `a1fe68a` = R1 전체·H1 0~4c·X6 1·R2 0·I1-a 뒤)

**결과 불변 확인**: 저장소 밖 해시 목록 123줄(보통 S0~S39 · 어려움 S0~S19 · 극한 S0~S19 · 재난 다섯 × S0~S2 · 강제 `fire/arson`·`armed/kidnap`·`armed/getaway`·`traffic/pileup`·`collapse/landslide`·`traffic/tree` × S0~S3 · 극한 `armed/std` × S0~S3 — 줄마다 `report.hash` 와 `JSON.stringify(report)` 의 FNV)이 `a1fe68a` 와 diff 0. 판단이 새 칸을 읽는 곳은 없다(grep: `src/sim` 에서 `.causes` 를 읽는 곳은 `events.ts` 의 정리뿐, `w.cause` 는 지시 무전의 `causes` 뿐이고, `injury.ts` 의 `.cause` 는 부상 원인 `InjuryCause` 라 다른 칸이다).

**실제 이름과 자리** (b1~b5 가 쓴다):

1. `types.ts` 끝 "인과 기록 (I1-b 0단계)" 절 — 인터페이스 합치기로 `Incident.cause`·`csq`·`blockedBy`·`blockEv`, `Problem.ref`. §3.3 의 나머지(`WorldTag`·`ZoneState`·`SignalKind`·`Signal`·`WorldState`·`SimEvent.tag`·`divertWait`·`Scene.shadowAdd`·`ShiftReport.world`·`incidents[]` 의 `parent`·`children`·`chain`·`HOSPITAL_FULL`·`INFRA_FAIL`)는 b2 부터 — 같은 절에 더하면 된다.
2. `incidents.ts`: `SpawnOpts.cause`·`csq`, `export interface DroppedChain`(§3.3 의 `dropped` 항목 모양 그대로 — `why` 합집합 다섯 개를 다 선언했고 b0 이 쓰는 것은 `'late'`·`'busy'`), `GenState.dropped`(`initGenerator` 의 리터럴에 `[]`). `createIncident` 리터럴 끝에 `cause, csq, blockedBy, blockEv: undefined`, 그 뒤 `opts.cause >= 0` 이면 `I.cause`, `opts.csq` 면 `I.csq`, 발생 기록 `causes: [I.cause]`. `tickIncidents` 의 꺼내기는 같은 조건으로 만들고, 만들지 않으면 `dropped.push({ t, why, type, variant, parent })`(기록은 남기지 않는다).
3. `events.raiseProblem(sim, I, code, detail, a, dedupe = true, ref?)` — **일곱째 인자 `ref`**. 새 `Problem` 을 만들 때만 붙는다(`dedupe` 로 합쳐진 두 번째 기록에는 없다). `Problem` 리터럴 셋(`raiseProblem`·`debrief.addProblem`·`agents.ts` 의 `LATE_DISCOVERY`)이 `times`·`ref` 를 같은 순서로 갖는다.
4. **`csq` 이름**: `'reoffend'`(hazards 도주 블록의 재범) · `'getaway'`(도주 차량) · `'hideout'`(pursuit 의 은신처 제보) · `'arson'`(scenarios/crime 의 `arsonNext`). 원인은 앞의 셋이 `raiseProblem('SUSPECT_FLED', …)` 의 반환값, 방화가 `I.lastEvent`(§3.11 1번 그대로). 재난 사건은 `csq` 를 두지 않는다(`tag 'disaster:<종류>'` 가 그 구실이다).
5. `disaster.tell(…)` 이 기록 id 를 돌려주고 **`DisasterState.lastEv`**(필수 칸 — `plan` 의 리터럴에 `-1`)에 둔다. `spawn` 이 `cause: d.lastEv`. 알림이 모두 `tell` 을 지나므로 마지막 알림은 보고서에 남기지 않는 것(전력 복구·잦아듦)일 수도 있다. C7·C12 가 이 값을 쓴다.
6. `dispatcher.ts`: DIVERTED 의 `causes: [I.lastEvent]`·`ref { inc: I.id, unit }`. NO_UNIT 은 **`blockersOf(sim, I, keys)`**(export — 시험용)가 `I.blockedBy` 에 쌓고 `{ causes, ref }` 를 돌려준다: 막힌 수요를 채울 능력(`caps[key] ≥ MINCAP[key]`, `tactical` 이면 `law` 도)의 지상 부대 가운데 다른 사건에 묶인 것의 사건 → `blockedBy`·그 사건의 `dispatchLog` 끝을 `causes` 에, 결원으로 `oos` 인 부대 → `ref.unit`·그 부대의 운용 중단 기록을 `causes` 에. `ref.inc` 는 처음 찾은 사건.
7. `resources.ts`: 모듈 안 `blockRef(sim, u, e)` → ROUTE_BLOCKED 세 자리(장애물 앞 되돌기 `turnBack`, 떠날 때의 첫 구간, 교차로의 다음 구간)의 `causes`·`ref { inc, unit, edge }`. 막은 사건 = `closedReason === 'incident'` 인 구간을 `blockedEdge` 로 가진 열린 사건(뒤에서부터 첫 것), 원인 = 그 사건의 `blockEv`. TRAFFIC_DELAY 는 같은 사건·같은 부대의 **이번 출동**(`p.t ≥ u.dispatchedAt`) 마지막 ROUTE_BLOCKED 를 `causes` 로, 그 `ref` 의 `inc`·`edge` 를 이어받는다(없으면 `ref { unit }` — 혼잡만으로 늦은 것).
8. **`I.blockEv` 를 넣는 자리 넷**: `sceneManager` 6) 블록의 '사고 구간 전면 통제', `createIncident` 의 쓰러진 나무(`variant 'tree'` — §3.11 4번 목록에 없던 자리), `scenarios/major.ts` 다중 추돌 `onCreate`, `scenarios/disaster.ts` 산사태 `onCreate`. 뒤의 셋은 `inc` 없이 남는 진실 기록이라 그 원인 간선은 `worldLinks` 로 센다.
9. **`want()` 의 원인**: `field/beliefs.ts` 의 `mergeHeard(store, f, ev)`·`heardEv(f)`(WeakMap — 사실 객체의 모양을 바꾸지 않는다). `sceneManager.deliverRadio` 가 **지휘관(`b.isCommander`)에게만** `mergeHeard` 로 합치고(다른 대원은 지금처럼 `merge`), 실제로 저장된 사실에만 그 무전의 `eventId` 를 기억한다. `commander.ts` 에서 사실 하나가 낳는 작업 — 구조 대상(`waterRescue`·`hoist`·`extricate`·`escort`·`treat` 둘·`carry` 둘·`load`), 쓰러진 동료(`rescueMate`), 누출(`mitigate`), 목격자(`interview`), 용의자(항복 `arrest`·도주 `engage`) — 에 `cause = heardEv(사실)`. 불(`suppress`·`airDrop`)·수색·교통 통제·잔불 정리는 넘기지 않았다(사실이 계속 새로 쓰이거나 한 소식이 낳은 일이 아니다). 지휘권이 넘어가면 새 지휘관이 그 뒤에 받은 무전부터 기억한다.
10. `scripts/metrics.ts`: `genDropped(sim)`(칸이 없으면 null), `ShiftMetrics.dropped` = `gen.dropped` 의 길이(표본 없이도 낸다), **`droppedApprox`** = 표본의 근사(비교용 — JSON `chain.droppedApprox`, 글자 줄은 둘이 다를 때만 `dropped N (approx M)`).

**설계와 다르게 한 곳**:

- **`u.oosEv` 의 뜻 — 코드(H1 4b, H1 §3.6)를 정본으로 둔다**: 그 부대의 **마지막 `RESPONDER_HURT`·`RESPONDER_KILLED` 기록 id** 다(다칠 때마다 덮어쓴다). 운용 중단 기록 자신의 id 가 아니다 — §3.7 C6 의 "H1 이 그 기록 id 를 부대의 `u.oosEv` 에 둔다"는 그렇게 읽지 않는다. 그래서 NO_UNIT 의 원인에는 운용 중단 기록을 기록 끝에서부터 `u.oosEv` 까지만 거슬러 찾아(`kind 'unit'`·사건 없음·`actor` = 호출부호·`/운용 중단/`) 넣고, 못 찾으면 `u.oosEv` 를 넣는다(사슬: 부상·순직 → 운용 중단 → 부족). 지원 부대(`u.aid`)의 임무 뒤 `oos` 는 결원이 아니라 뺀다.
- **NO_UNIT 의 귀속 범위**: 헬기·구조정은 넣지 않는다(종류마다 맡는 수요가 다르다 — `airFit`·바닷가 조건). 병원으로 가는·인계 중인 구급차는 `incidentId` 가 비므로 `patientsIncident` 의 사건으로 센다. 닫힌 사건이라도 그 부대를 아직 잡고 있으면 넣는다.
- **TRAFFIC_DELAY**: §3.11 4번의 "마지막 ROUTE_BLOCKED" 에 "이번 출동 안(`p.t ≥ u.dispatchedAt`)" 을 더했다(같은 사건에 다시 나간 부대가 앞 출동의 우회를 잇지 않게).
- **`blockEv` 를 쓰러진 나무에도** 넣었다(4번 목록에는 사고·산사태·다중 추돌·X6 뿐).
- **Problem 리터럴**: §3.3 끝의 세 곳에 `times`·`ref` 를 넣었다. `executor.ts` 의 교전 ESCALATION 리터럴(`I.problems.push({ code: 'ESCALATION', … })`)은 H1 단계 5·6 이 같은 파일을 고치는 중이라 두었다 — 속도만의 문제, 이어받을 자리.
- **사건 사이 ROUTE_BLOCKED 는 평소 교대에서 드물다**: 알려진 통제는 경로가 처음부터 피하므로, 보통 S0~S12 의 ROUTE_BLOCKED 가운데 `ref.inc` 가 있는 것은 모두 **자기 사건**의 통제를 만난 것이었다(같은 사건의 다른 부대가 전면 통제 뒤 그 구간으로 오던 경우). 사건 사이의 경우는 §3.12 의 말대로 "통제가 생기기 전에 그 구간을 지나기로 경로를 정한 부대"뿐이라, 시험은 그 상황을 만들어 본다(`tests/causality.test.ts` '다른 사건이 막은 구간').
- **연쇄 상한의 정본(§3.6 이 b0 에 맡긴 결정)**: **Z1 의 `chain.canChain` 을 정본으로 둔다.** `chainDepth(sim, id)` = `chainLen − 1`(뿌리 0) = `metrics.parentDepth`, `DEPTH_MAX = CHAIN_MAX − 1 = 2`(본문 표의 "≤ 3" 이 아니다 — 규칙이 만드는 사건도 같은 상한을 쓴다. 상한이 둘이 되지 않게). b2 의 `spawnConsequence` 는 `canChain` 을 부르고, 걸리면 깊이면 `'depth'`, 교대 상한(`CHAIN_SHIFT_MAX`)이면 `'cap'` 을 `gen.dropped` 에 남긴다. `tickIncidents` 의 꺼내기에서 깊이를 다시 볼 필요는 없다(예약하는 자리가 모두 이미 `canChain` 을 본다 — 재범·도주 차량·은신처·방화). 기존 연쇄가 상한에 걸려 예약하지 않은 것은 지금처럼 `dropped` 에도 남기지 않는다(그 자리는 예약 자체를 하지 않는다 — 넣으려면 결과는 그대로라 b2 에서 더해도 된다). 관문 M-G3 를 b5 에서 3으로 낮추는 일은 그대로 둬도 된다(실제 최대 깊이 2). b0 은 결과를 바꾸지 않으므로 이 결정을 코드에 넣지 않았다.

**수치** (전 = `a1fe68a`, 후 = b0. `npx tsx scripts/sweep.ts … --metrics`, 지표 줄만 바뀌고 결과 줄은 같다):

| 조건 | cross-incident links | world links | spread (분포 · ≥3 · 최댓값) | 확산(세계에서) | replan from world | causes depth avg/max |
|---|---|---|---|---|---|---|
| 보통 40 전 | 0 | 0 | 0:496 1:68 2:3 · 0 · 2 | 0 | 0 | 4.25 / 10 |
| 보통 40 후 | **285** | 0 | 0:391 1:159 2:17 · 0 · 2 | 0 | **12** | 4.42 / 12 |
| 재난 다섯 × 3 전 | 0 | 0 | ≥3 0 · 최댓값 1 | 0 | 0 | — |
| 재난 다섯 × 3 후 | **1,268** | **164** | ≥3 **39**(홍수 7·지진 17·해일 2·태풍 11·산불 2) · 최댓값 **5** | **1**(다섯 모두) | **17** | — |
| 강제 다중 추돌 × 4 후 | 65 | 0 | ≥3 0 · 최댓값 2 | 0 | 4 | — |

- 보통 교대의 `world links` 가 0 인 것은 사건 없는 기록이 원인이 되는 길(재난 알림, 사건 없이 남는 통제 기록, 결원 부대의 운용 중단 기록)이 보통 40 에는 거의 없기 때문이다(재난 없음, 다중 추돌·산사태 드묾, 운용 중단 부대 0). 재난 교대에서 처음으로 0 이 아니게 됐다.
- 보통 40 의 `spread ≥ 3` 은 아직 0 이다: 새 간선의 대부분이 NO_UNIT → 다른 사건의 출동 지령(관제 → 관제)이라 사건을 한두 번 건너는 데서 끝난다. 재난 교대의 최댓값 5 는 부족이 사건에서 사건으로 이어진 사슬이다(예: 지진 S1 #04 → #07(지원 요청) → #05 → #13 → #17 의 출동 지령). b3 의 규칙이 다른 시스템(도로·병원·기반 시설)을 끼워 넣어야 보통 교대에서도 3 을 넘는다.
- 보통 40 의 `dropped` 는 전후 1(표본 근사와 정확한 값이 같았다).
- 교대당 시간(`sweep 12 --no-metrics`, 시작점과 번갈아 세 번, 다른 작업자와 기계를 나눠 쓰는 중): 사용자 CPU 시작점 24.3·19.6·20.8초 / b0 22.6·20.4·20.7초, 교대당 1245·966·1043 / 1215·1018·1085ms — 흔들림 안이다(새 칸은 생성 리터럴에 미리 넣었다).
- `npm run check` 통과(테스트 459 + 건너뜀 1, 파일 15개 — 시작점의 450 에 아홉 더함).
- 시험: `tests/causality.test.ts` 'I1-b 0단계: 기록만 잇기' 아홉 개(연쇄·재난 사건의 원인 · DIVERTED · NO_UNIT 의 `blockedBy` · 결원 부대(`blockersOf`) · ROUTE_BLOCKED·TRAFFIC_DELAY · 사건 사이 통제(만든 상황) · 버린 예약 · 지휘관 지시의 원인과 `mergeHeard`).

**이어받을 자리**:

- X6 `collapseBuilding` 의 통제 기록 반환값 → `I.blockEv`(X6 단계 5 가 넣지 않았으면 b2 이후). 그 통제도 `closedReason 'incident'` 와 `I.blockedEdge` 를 쓰면 `blockRef` 가 그대로 잇는다.
- C2(b3-3) 의 `Obstacle.ev` 가 생기면 `blockRef` 가 장애물의 기록도 `causes` 에 넣는다(지금은 사건 통제만 — `turnBack` 의 ROUTE_BLOCKED 는 구간·부대만 남는다).
- 재난 통제(`closedReason 'disaster'`)를 만난 ROUTE_BLOCKED 는 원인을 잇지 않는다 — `disaster.closeEdge` 가 통제 기록 id 를 두지 않는다(설계 밖, 필요하면 `closedEdges` 옆에).
- `executor.ts` 교전 ESCALATION 리터럴의 `times`·`ref`.
- H1 단계 5 의 `SUSPECT_DIED` 와 b0 은 겹치지 않는다(도주 블록의 원인 연결은 SUSPECT_FLED 만 쓴다).

### 0단계 · b1 · b2 — 기준 다시 재기, 어긋난 기록 고치기, 세계 상태·신호·규칙의 틀 (2026-11-20, 브랜치 `wf/causality-b12` → `wf/causality`, 시작점 `57435a1` = R3 전체 뒤 — `src/` 의 마지막 커밋 `20ce1d7`)

커밋: b1 `c0dc136` · b2 `5c333d0`·`5326a9a`(신호의 건물 칸 — 전체 관문에서 걸린 것) (+ 이 메모). **b3 부터의 기준은 아래 "b1 뒤" 줄이다**(b2 는 결과를 바꾸지 않는다).

#### 기준 파일 (이 컨테이너의 scratchpad — 새 컨테이너면 아래 방법으로 다시 만든다)

`/tmp/claude-0/-home-user-operator/186169fe-a127-5e67-996a-cfc83d22e9db/scratchpad/wf-causality/`

| 폴더 | 무엇 |
|---|---|
| `out0/` | 시작점(`57435a1`)의 기준 — `normal60.json`·`normal60-metrics.txt`·`hard30.json`·`extreme30.json`·`{typhoon,flood,quake,wildfire,tsunami}20.json`·`force-{collapse-gasblast,traffic-bus,fire-std}.txt`(20교대 `--scen --metrics`)·`hash.txt`(해시 목록 123줄) |
| `out1/` | **b1 끝(`c0dc136`)의 같은 파일들 — b3~b5 의 "전"** |
| `out2/` | b2 끝(`5c333d0`)의 같은 파일들 (b1 과 견준 것 — 아래) |
| `base/` · `b1/` · `b2/` | 그 세 커밋을 `git archive` 로 푼 사본(재는 동안 작업 폴더를 고쳐도 섞이지 않게) |
| `tools/` | `measure.sh <뿌리> <결과 폴더> all`(§4 의 명령 전부를 세 줄로 나눠 — 혼자 돌면 4분 반) · `hashrun.sh <뿌리> <결과 폴더> <견줄 hash.txt>` · `i1hash.mts`(해시 목록) · `summ.mjs`·`mdtable.mjs`(요약) · `jsoncmp.mjs <A> <B>`(`msPerShift`·`chain.dropped` 를 뺀 `--json` 비교) |

**해시 목록의 정의**(b0 와 같은 123줄 — 줄마다 `report.hash` 와 `JSON.stringify(report)` 의 FNV, 기록 수): 보통 S0~S39 · 어려움 S0~S19 · 극한 S0~S19 · 재난 다섯(typhoon·flood·quake·wildfire·tsunami) × S0~S2 · 강제 `fire/arson`·`armed/kidnap`·`armed/getaway`·`traffic/pileup`·`collapse/landslide`·`traffic/tree` × S0~S3 · 극한 `armed/std` × S0~S3. 모두 `new Sim(seed, d, 1200, { force })` → `runToEnd()`.

#### 0단계 — 기준 (§4 의 명령 전부, 시작점 `57435a1`)

설계서 §1.5·b0 메모의 수치는 R1·H1 때의 것이라 쓰지 않는다. R3 뒤의 값:

| 조건 | 사건 (교대당) | 성공 · 성공+대응 지연 · 실패+미해결 | 한계 시간 · 방치 · 출동 없음 | 평균 대응 | 부모 있는 사건 (비율 · 최대 깊이 · 교대 최대) | 버린 연쇄 | 다른 사건 원인 · 세계 원인 | spread ≥3 (최대 · 세계에서) | replan (from world) | 전환 n · hurt · 늦어진 초 | 교착 · 잊힘 · 반복 최대 | 결과 · 이야기 · 행동 엔트로피 (flat) | C1~C5 | reportHash |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 보통 60 | 846 (14.1) | 76.4% · 80.6% · 9.3% | 1 · 2 · 0 | 50초 | 4 (0.5% · 2 · 2) | 4 | 686 · 0 | 4 (4 · 0) | 48.0% (31) | 56 · 31 · 322 | 0 · 0 · 10 | 0.9 · 3.01 · 2.51 (1) | 0/0/0/0/0 (C5 짝 871) | c72949f6 |
| 어려움 30 | 536 (17.87) | 53.9% · 62.3% · 21.1% | 2 · 6 · 0 | 63초 | 14 (2.6% · 2 · 5) | 3 | 1374 · 2 | 15 (4 · 1) | 52.4% (38) | 64 · 31 · 644 | 0 · 0 · 8 | 1.3 · 3.06 · 2.57 (1) | 0/0/0/0/0 (C5 짝 566) | ed711504 |
| 극한 30 | 644 (21.47) | 25.6% · 37.1% · 44.3% | 11 · 19 · 13 | 85초 | 36 (5.6% · 2 · 6) | 4 | 3299 · 4 | 63 (5 · 1) | 53.2% (58) | 134 · 37 · 1017 | 0 · 0 · 11 | 1.46 · 2.83 · 2.56 (0) | 0/0/0/0/0 (C5 짝 597) | 89be9fdc |
| 태풍 20 | 462 (23.1) | 37.4% · 74.5% · 14.9% | 8 · 0 · 0 | 102초 | 0 (0.0% · 0 · 0) | 1 | 2659 · 316 | 49 (5 · 1) | 45.7% (18) | 89 · 15 · 58 | 0 · 0 · 5 | 1.47 · 2.72 · 2.52 (0) | 0/0/0/0/0 (C5 짝 392) | c64170 |
| 홍수 20 | 409 (20.45) | 45.2% · 67.5% · 10.0% | 2 · 0 · 0 | 82초 | 0 (0.0% · 0 · 0) | 1 | 1535 · 240 | 15 (4 · 1) | 54.8% (30) | 61 · 17 · 200 | 0 · 0 · 11 | 1.63 · 3.31 · 2.7 (0) | 0/0/0/0/0 (C5 짝 398) | e78b44d9 |
| 지진 20 | 429 (21.45) | 28.9% · 42.7% · 38.5% | 20 · 1 · 7 | 96초 | 0 (0.0% · 0 · 0) | 1 | 4787 · 309 | 139 (9 · 2) | 70.5% (53) | 147 · 20 · 154 | 0 · 0 · 11 | 1.58 · 2.86 · 2.53 (0) | 0/0/0/0/0 (C5 짝 373) | 69e7d87d |
| 산불 20 | 332 (16.6) | 49.1% · 66.6% · 17.8% | 7 · 1 · 1 | 75초 | 1 (0.3% · 1 · 1) | 0 | 1576 · 117 | 29 (5 · 2) | 61.8% (14) | 63 · 13 · 24 | 0 · 0 · 8 | 1.41 · 2.7 · 2.49 (1) | 0/0/0/0/0 (C5 짝 335) | edc91132 |
| 해일 20 | 370 (18.5) | 60.0% · 74.9% · 7.3% | 1 · 0 · 0 | 72초 | 1 (0.3% · 1 · 1) | 1 | 904 · 141 | 10 (4 · 1) | 51.6% (6) | 41 · 10 · 126 | 0 · 0 · 8 | 1.27 · 3.01 · 2.57 (1) | 0/0/0/0/0 (C5 짝 385) | 615ee2ba |

강제 20교대(`--scen --metrics`, 보통 — 그 시나리오의 줄만): `collapse/gasblast` 21건 = 성공 4 · 부분 8 · 실패 9, 한계 시간 0 · 평균 289초 (교대 전체: 한계 시간 2, spread ≥3 11건). `traffic/bus` 26건 = 성공 21 · 부분 4 · 대응 지연 1, 한계 시간 0 · 226초 (교대 전체: 한계 시간 1, ≥3 4건). `fire/std` 68건 = 성공 32 · 부분 21 · 실패 15, 한계 시간 1 · 289초 (교대 전체: 한계 시간 3 · 출동 없음 1, ≥3 4건). 세 조건 모두 교착 0 · 잊힘 0 · C1~C5 0.

읽을 것:

- **§4 목표 표의 하한 가운데 셋은 규칙 없이도 이미 넘는다**(b0 가 기록을 이은 덕): 보통 60 의 `spread ≥ 3` 4건 · `replan.fromWorld` 31 · `divert.hurt` 31(늦어진 시간 합 322초), 재난 다섯의 `≥ 3` 합 242 · `fromWorld` 합 121. 지금의 확산은 거의 모두 **부족·전환이 사건에서 사건으로**(관제 → 관제) 넘어간 것이다 — b3 의 규칙이 더해야 하는 것은 수가 아니라 다른 시스템(도로·병원·기반 시설)을 지나는 길이다. b5 의 판단은 `systems.share` 의 `infra`(지금 0%)와 예시 길의 시스템 이름으로 본다.
- **부모 있는 사건의 비율은 보통 0.5%** 다(목표 2~8%) — 규칙이 만드는 사건이 채울 몫.
- 보통 60 의 `world links` 는 0 이다(사건 없는 기록이 원인이 되는 길이 보통 교대에는 없다 — b3 의 구역·병원 알림이 처음 만든다).
- 교대당 시간(`msPerShift` — 기계를 나눠 쓰지 않을 때): 보통 966ms · 어려움 1,976 · 극한 2,543.

#### b1 — 어긋난 기록 고치기 (`c0dc136`, 해시 바뀜)

1. **이송 출발 문구의 병원**: R1 단계 3 이 고쳤다 — 고칠 것이 없다. `consistency.C5` 는 위 여덟 조건과 강제 셋 모두 **0**(보통 60 은 짝 871), 관문은 이미 켜져 있다(`scripts/metrics.ts` `checkMetrics` 의 `['C1'…'C5']`, 시험 '요약 모양').
2. **재범 연쇄의 난수 흐름**: `field/hazards.ts` 도주 블록의 재범 예약에 `rng: sim.rng.fork('reoffend:' + I.id + ':' + h.id)`. 예전에는 평소 생성기 흐름(`sim.rngGen`)으로 만들고 `gen.lastType` 을 `'armed'` 로 고쳐, 재범이 생긴 교대의 뒤 사건이 모두 달라졌다. **장소(도주 지점 900 안)·`when`·`until`·신호를 쓰는 구역 위험은 C10(b3-5)의 몫으로 남겼다** — §3.11 의 1단계는 흐름만이다.
3. **연쇄 깊이 상한**: `chain.ts` 에 `DEPTH_MAX = CHAIN_MAX − 1`(2)·`chainDepth(sim, incId)`(뿌리 0 = `chainLen − 1` = 측정 도구의 `parentDepth`). `incidents.tickIncidents` 가 꺼낸 예약의 부모가 깊이 상한이면 버리고 `gen.dropped` 에 `'depth'`. 예약하는 자리가 모두 `canChain` 을 보므로 **지금은 걸리지 않는다**(안전장치 — 결과를 바꾸지 않았다).

- **해시가 바뀐 교대는 해시 목록 123줄 가운데 8줄**(재범이 생긴 교대뿐): 어려움 S1·S5, 극한 S1·S5·S12·S18, 극한 `armed/std` 강제 S1·S3. 보통 40 · 재난 15 · 보통 강제 24 는 그대로다.
- **기준 다시 재기(b1 뒤 — `out1/`)**: 보통 60 과 태풍·홍수·지진·산불 20 은 0단계와 **한 글자도 같다**(`reportHash` 같음). 달라진 세 조건:

| 조건 | 사건 (교대당) | 성공 · 성공+대응 지연 · 실패+미해결 | 한계 시간 · 방치 · 출동 없음 | 평균 대응 | 부모 있는 사건 (비율 · 최대 깊이 · 교대 최대) | 버린 연쇄 | 다른 사건 원인 · 세계 원인 | spread ≥3 (최대 · 세계에서) | replan (from world) | 전환 n · hurt · 늦어진 초 | 교착 · 잊힘 · 반복 최대 | 결과 · 이야기 · 행동 엔트로피 (flat) | C1~C5 | reportHash |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 어려움 30 | 538 (17.93) | 54.1% · 62.1% · 20.4% | 2 · 5 · 0 | 63초 | 11 (2.0% · 2 · 4) | 2 | 1395 · 0 | 15 (4 · 0) | 52.8% (34) | 66 · 31 · 538 | 0 · 0 · 8 | 1.29 · 3.07 · 2.57 (1) | 0/0/0/0/0 (C5 짝 580) | 299c68b1 |
| 극한 30 | 642 (21.4) | 26.3% · 37.9% · 43.1% | 13 · 19 · 13 | 85초 | 30 (4.7% · 2 · 6) | 8 | 3248 · 4 | 67 (5 · 1) | 52.1% (61) | 135 · 39 · 1051 | 0 · 0 · **80** | 1.47 · 2.88 · 2.59 (0) | 0/0/0/0/0 (C5 짝 627) | d5ee0f43 |
| 해일 20 | 369 (18.45) | 60.2% · 75.1% · 7.3% | 1 · 0 · 0 | 72초 | 1 (0.3% · 1 · 1) | 1 | 886 · 141 | 10 (4 · 1) | 51.5% (5) | 41 · 10 · 126 | 0 · 0 · 8 | 1.27 · 2.99 · 2.57 (1) | 0/0/0/0/0 (C5 짝 383) | 747ef1ec |

- **알려진 문제 — 극한 S12 #14 의 반복 80**(b1 이 만든 것이 아니라 바뀐 진행이 드러낸 것): 무장 현장에서 지휘관이 "고준혁, 김도윤 대원 응급 처치 맡아라."(`treatMate`)를 2~3초마다 3분 넘게 80번 되풀이하다 한계 시간으로 끝난다(22:15:15 ~ 22:18:25). 쓰러진 대원(뒤에 순직으로 확인)에게 지원 구급대원을 거듭 붙이는데 일이 곧바로 놓이는 고리로 보인다 — H1 의 처치 지시 쪽이고 I1-b 의 변경과 무관하다. 다시 보기: `npx tsx scripts/sweep.ts 1 --diff extreme --log S12`. 고치지 않았다(결과를 바꾸는 다른 묶음의 일). 완료 조건 5 의 `repeatMax` 를 볼 때 이 한 건을 따로 본다(그 밖의 극한 최대는 12).
- 시험: `tests/causality.test.ts` 'I1-b 1단계' 둘(재범의 흐름 — 그 흐름으로 만든 재범 뒤의 평소 사건 셋이 재범이 없을 때와 같고 예전 방식이면 달라진다 · 깊이 상한 — 깊이 2 의 사건을 부모로 한 예약은 `'depth'` 로 버린다).

#### b2 — 세계 상태·신호·인과 규칙의 틀 (`5c333d0`, **해시 불변** — 규칙은 하나도 없다)

**결과 불변 확인**: 해시 목록 123줄이 b1 끝(`out1/hash.txt`)과 **diff 0**(`out2/hash.txt`). §4 의 `--json` 여덟 조건은 `msPerShift` 와 `metrics.chain.dropped` 를 뺀 모든 칸이 b1 과 같고(`jsoncmp.mjs out1 out2`), 강제 셋·`--metrics` 글자 출력도 그 두 가지를 빼면 같다. `chain.dropped` 가 달라진 까닭은 아래 7번이다.

교대당 시간(`sweep 12 --no-metrics`, b1 과 번갈아 세 번, 기계를 혼자 쓸 때): 사용자 CPU b1 37.4·33.7·33.1초 / b2 35.4·35.1·35.3초, 교대당 1,192·1,062·1,025 / 1,098·1,087·1,108ms — 흔들림 안이다(새 칸은 생성 리터럴에 미리 넣었고, 규칙이 없는 세계 틱은 신호 배열을 비우는 것과 1초에 한 번 동네 18곳을 훑는 것뿐이다).

**실제 이름과 자리** (b3~b5 가 쓴다):

1. **`types.ts` "인과 기록" 절**(같은 절 끝에 "세계 상태와 신호" 소절): `WorldTag`·`ZoneField`·`ZoneState`·`HospitalState`·`SignalKind`·`Signal`·`CsqRecord`·`WorldState`, 인터페이스 합치기로 `SimEvent.tag`·`Incident.divertWait`·`Scene.shadowAdd`·`ShiftReport.world`. `ShiftReport.incidents[]` 의 `parent?`·`children?`·`chain?` 는 그 인라인 형에 직접 더했다(이름 없는 형이라 합칠 수 없다). `ProblemCode` 끝에 `'HOSPITAL_FULL'`·`'INFRA_FAIL'`(새 줄) — `debrief.PROBLEM_LABEL` 에 이름표('응급실 포화'·'기반 시설 장애')만 넣었다. **`order` 의 자리와 문장 틀은 그 코드를 남기는 단계**(b3-2 · b3-8~11)가 넣는다(`PROBLEM_SYS` 에는 I1-a 가 미리 넣어 두었다).
2. **`Signal` 의 좌표 — 본문과 다르다**: `x`·`y` 는 **언제나 도시 좌표**(주지 않으면 그 사건의 `truth.x·y`, 병원 인계는 병원의 자리)이고, 현장의 칸 좌표는 새 칸 **`cx`·`cy`**(-1 = 없음)다. X6 의 신호 여섯은 칸 좌표를 `x`·`y` 로 넘기고 있어서(빈 함수라 드러나지 않았다) `cx`·`cy` 로 바꿨다. 규칙이 "원인 지점에서 N 안"을 잴 때는 `sig.x, sig.y` 를 그대로 쓰면 된다. `place`(건물 id)도 주지 않으면 `signal` 이 그 사건에서 채운다(사건 목록에 없는 사건이면 자리·건물 모두 -1) — **신호를 보내는 자리에서 `I.truth` 를 읽지 않아도 된다**: `hazards.blast` 는 시험이 `truth` 없는 가짜 사건으로 부르기도 해서(`tests/destruction.test.ts`) 사건의 id 만 넘긴다(전체 관문에서 걸려 고쳤다 — 고친 함수의 시험만 돌리면 보이지 않는다).
3. **`world/state.ts`**: `initWorld(sim, carry?)`(난수 없음 — `Sim` 생성자가 도시를 만든 바로 다음에 부른다) · `zoneOfXY`·`zoneOfPlace`(-1 = 구역 없음)·`zoneName` · **`setZone(sim, z, f, v, until, cause, known)`**(진실 쪽 전용. 덮어쓰기 — 전력·통신·수도는 더 낮은 값만, 연기·위험은 더 높은 값만. 회복 시각은 늦은 쪽, 알려짐은 켜기만. 값이 나빠졌을 때만 원인 기록을 바꾸고 `true`) · `recoverWorld(sim, note?)` · `ZONE_FIELDS`·`ZONE_DEFAULT`·`HOSPITAL_CAP = [6, 8]`(`city.facilities` 의 병원 순서 — 첫 값, C3 가 맞춘다) · 알려진 것만: `knownZone`·`knownHospital`(병원이 알린 적 없으면 `null`)·`knownZoneOfIncident`·`knownBuildingAt(sim, node, placeKind?)` · 진실 쪽 `placeState(sim, placeId)`.
   - `knownBuildingAt` 은 그 교차로에서 **이번 교대에 닫히고 위치를 알았던**(`locationKnown`) 사건 가운데 건물 종류가 같은 가장 최근 것을 돌려준다 — 건물 상태(`placeMarks`)가 없어도 `{ burnFrac: 0, usable: true, inc }` 다(C9 의 '재발화' 이름표는 그 `inc` 의 사건이 화재였는지를 관제가 아는 값(`fieldType`·평가)으로 본다 — `truth.type` 을 읽지 않는다). 그런 사건이 없으면 I2 의 `carryState.places`(지금은 늘 비어 있다)에서 `inc: -1`.
   - `placeState().usable` 은 지금 `incidents.placeGone` 과 같은 뜻이다(전소·전체 붕괴가 아니면 참, 이어받은 건물은 `state === 'marked'`). I2 단계 5 가 `persist.placeUsable` 을 만들면 그것을 부르게 바꾼다. `knownDetourCauses`(C3-6, 선택)는 만들지 않았다.
4. **`world/consequence.ts`**: `registerConsequence(c)` — **등록을 거두는 함수를 돌려준다**(시험용. 같은 id 를 다시 등록하면 그 자리의 규칙을 바꾼다) · `consequences()`·`consequenceLabel(id)`(b4 의 보고서가 `label` 을 찾는다) · `signal(sim, kind, { inc, ev, x?, y?, size?, place?, data?, cx?, cy? })` · `tickWorld(sim)` · `spawnConsequence(sim, c, opts, delay, when?, wait = 120)` · `CSQ_SPAWN_CAP = 6` · `chainDepth`(정본 `chain.ts` 를 다시 내보낸다). `SignalKind` 의 정의는 `types.ts` 로 옮기고 여기서 다시 내보낸다(X6 의 import 그대로).
   - **`CsqCtx` 에 두 칸이 더 있다**: `rule`(규칙 id — `spawnConsequence` 가 `Incident.csq` 와 흐름 이름에 쓴다)·`spawns`(이 발동이 예약한 사건 수).
   - **`Consequence.recover?(sim, z, f, cause, known)`**(본문에 없음 — 선택): 구역 값이 회복 시각을 지나 처음 값으로 돌아갈 때 모든 규칙이 등록 순서로 받는다. 복구 기록('… 전력 복구.')을 남기고 자기가 얹은 것(`bump`·음영)을 거두는 자리다 — world tick 규칙으로 회복을 하면 쿨다운·상한에 걸린다. 회복은 값·`until`·`known`·`cause` 를 먼저 되돌린 뒤 부른다(원인 기록과 "관제가 알았는가"는 인자로 온다). **`until` 이 `Infinity` 인 값**(원인 사건이 끝날 때 정한다)은 규칙이 `closed` 신호에서 `Z.until[f]` 를 직접 정한다(`setZone` 은 늦은 쪽만 받으므로 `Infinity` 를 줄이지 못한다).
   - **발동의 차례 — 본문과 한 곳 다르다**: 열쇠 → 쿨다운·교대 상한 → 시도 번호·난수 흐름(`csq:<규칙>:<열쇠>:<n>`) → `test` → **(`spawns: true` 인 규칙만) 연쇄 상한** → `apply` → `world.log`. 본문은 상한을 `test` 앞에서 보지만, 그러면 "조건이 맞았는데 상한 때문에 일어나지 않은 것"과 "조건이 안 맞은 것"을 가릴 수 없다. 조건이 맞고 상한에 걸리면 `gen.dropped` 에 `'depth'`/`'cap'`(유형 없음, `parent` = 신호의 사건)을 남기고 쿨다운만 건다(같은 열쇠로 되풀이해 쌓이지 않게. 교대 상한 `count` 에는 세지 않는다).
   - **`spawns` 의 뜻**: 사건을 만드는 것이 전부인 규칙(C1·C9)만 참으로 둔다. 상태도 바꾸고 사건도 만드는 규칙(C4 정전 → 승강기 갇힘)은 거짓으로 두고 `apply` 안에서 `spawnConsequence` 를 부른다 — 예약마다 따로 거절되고 `gen.dropped` 에 남는다.
   - **연쇄 상한**: `spawnConsequence` 는 ① 전체 상한 `world.spawned ≥ CSQ_SPAWN_CAP` → `'cap'`, ② 부모(`opts.parent`)가 있으면 정본 `chain.canChain` 의 두 조건 — 사슬 길이(`chainLen ≥ CHAIN_MAX`) → `'depth'`, 교대의 연쇄 수(`chainedInShift ≥ CHAIN_SHIFT_MAX`) → `'cap'`. **부모 없는 예약**(재난·구역이 낳는 사건 — C7·C12, 태풍 정전의 승강기)은 ① 만 본다.
   - **`world.log`**: 사건을 예약하지 않은 발동은 발동마다 한 줄(`made: -1`, `depth` = 원인 사건의 깊이), 예약한 발동은 **예약마다 한 줄**(`depth` = 만들 사건의 깊이)이고 `gen.chain` 항목의 `log`(줄 번호)로 이어져 `tickIncidents` 가 실제로 사건을 만들 때 `made` 를 채운다. 버려진 예약은 `made: -1` 로 남고 `gen.dropped` 에 까닭이 있다.
5. **`world/rules/index.ts`**(빈 모음 — `engine.ts` 가 `import './world/rules'`): b3 가 규칙 파일을 만들어 §3.7 표의 차례로 `import './<파일>';` 을 더한다. **import 순서 = 등록 순서 = 결과**.
6. **`engine.ts`**: `Sim.world`(생성자에서 `generateCity` 바로 다음), `step` 의 `tickDisaster` 다음·`tickIncidents` 앞에 `tickWorld`. world tick(규칙의 `on: 'tick'`·회복)은 `sim.tick % 5 === 1`.
7. **`incidents.ts`**: `ChainItem { at, opts, when?, until?, log? }`. `tickIncidents` 의 꺼내기 = §3.5 그대로(`when` 이 거짓이면 `at = t + 5`, `until` 이 지났으면 `'expired'`. 그 틱에는 다른 예약도 꺼내지 않는다). **기존 연쇄가 상한에 걸려 잇지 못한 것도 `gen.dropped` 에 남는다**: `chain.noteChainDrop(sim, I, type, variant)` 를 재범·도주 차량(`hazards`)·은신처(`pursuit`)·방화(`scenarios/crime`)의 `canChain` 이 거짓인 갈래에서 부른다(`'depth'`/`'cap'` — 기록은 지금처럼 남기지 않는다). 그래서 **`metrics.chain.dropped` 가 b1 보다 늘었다**(결과는 같다): 어려움 30 2 → 3 · 극한 30 8 → 29 · 그 밖(보통 60 의 4, 재난 다섯, 강제 셋)은 그대로. **`chain.chainedInShift` 는 부모 있는 예약만 센다**(기존 연쇄 넷은 모두 부모가 있어 같은 수 — 부모 없는 규칙의 예약이 연쇄의 자리를 먹지 않게).
8. **신호를 보내는 자리**:

| 신호 | 자리 | `ev` | `size`·`data` |
|---|---|---|---|
| `blast` | `hazards.blast` 끝 — `cause === 'blast' && !planned && !noSignal` | 넘겨받은 기록 | `size` 반경 |
| `collapse` | `hazards.tickCollapse` 의 2차 붕괴(지진 여진이 흔든 구조물도 이 자리로 무너진다) | 그 ESCALATION | `size` 새로 무너진 칸 수 |
| `collapse` | `incidents.createIncident` 끝 — 유형 `collapse` 의 변형 `crane`·`gasblast`·`landslide`(`COLLAPSE_AT_START`), 처음부터 무너진 칸(`s.damage`)이 있을 때 | 발생 기록 | `size` 그 칸 수 |
| `fireBig` | `hazards.tickFire` 끝 — 불 칸(> 0.2)이 처음 `FIRE_BIG`(30, export) **이상**일 때, 현장마다 한 번(`WeakSet`) | 그 사건의 마지막 ESCALATION, 없으면 발생 기록(이 자리에는 기록이 없다) | `size` 불 칸 수 |
| `delivered` | `resources.tickUnits` 의 병원 인계 기록 바로 다음(지상·헬기 같은 길) | 그 인계 기록 | `place` 병원 시설 id · `data` 산 환자 수 · `size` 함께 인계한 다친 대원·용의자 수 · `x`·`y` 병원 |
| `fled` | `hazards` 도주 블록 — 총을 든 용의자만 | 그 SUSPECT_FLED | `data` 용의자 id |
| `closed` | `incidents.closeIncident` 의 종료 기록 다음(`noteClosedPlace` 앞 — 처리는 다음 틱이라 건물 상태가 이미 적혀 있다) | 종료 기록 | — |
| `catastrophe` | X6 의 여섯 자리(그대로) | 문제 기록 | `data` 0·1·2 |

   - **`hazards.blast` 의 서명**: `blast(…, cause = 'blast', planned = false, noSignal = false)`. X6 의 폭발 셋(`explodeGas`·`ruptureVessel`·`explodeDust`)은 `noSignal = true`, R2 의 폭파 진입은 `planned = true` 라 저절로 빠진다. 그래서 지금 `blast` 신호를 보내는 것은 폭발물(`rules/crime.ts`)뿐이다. 새 폭발을 `blast()` 로 만들면 기본으로 신호가 간다.
   - 큰 불의 문턱은 본문의 "30 을 넘을 때"가 아니라 **30 이상**이다(C5 의 "불 칸 ≥ 30" 과 같은 수로).
   - 발생 때의 `collapse` 는 평소 붕괴(`collapse/std`)·승강기 갇힘에는 보내지 않는다(본문의 목록 그대로 — 크레인·가스 폭발·산사태).
9. **객체 모양**: `events.emit` 의 리터럴에 `tag: a.tag`, `createIncident` 리터럴에 `divertWait: undefined`, `kit.baseScene` 에 `shadowAdd: undefined`, b0 가 남긴 `executor.ts` 교전 ESCALATION 리터럴에 `times`·`ref`.

**본문과 다르게 한 곳 (요약)**: `Signal.cx`·`cy` 와 X6 호출의 칸 좌표(2) · `CsqCtx.rule`·`spawns`, `Consequence.recover`, `registerConsequence` 의 반환값(4) · 연쇄 상한을 `test` 뒤에 봄(4) · 큰 불 문턱 ≥ 30, 발생 때의 `collapse` 를 `createIncident` 에서(8 — `onCreate` 는 발생 기록보다 먼저 돌아 기록 id 가 없다) · 기존 연쇄의 거절도 `gen.dropped` 에, `chainedInShift` 는 부모 있는 예약만(7) · `DEPTH_MAX` 는 2(b0 의 결정 그대로).

**하지 않은 것 — 이어받을 자리**:

- `traffic.ts` 의 `ObstacleKind 'rubble'`·`OBSTACLE_LABEL`·`Obstacle.ev`·`reportObstacle` 의 `causes`, 지도 기호·범례: §3.3 의 자료형 문단에 있지만 §7 표와 C2 절이 C2(b3-3)의 일로 적었다 — 쓰이지 않는 장애물 종류를 범례에 먼저 넣지 않으려고 남겼다.
- `ARMED_BIAS` export(C10 — b3-5), `debrief` 의 `order`·문장 틀(HOSPITAL_FULL·INFRA_FAIL), `ShiftReport.world`·`incidents[].chain` 을 채우는 것(b4), 관문 조이기 M-G3 4 → 3(b5 — 지금 실제 최대 깊이는 모든 조건에서 2).
- I2 가 `WorldTag` 끝에 `'carry'` 를 더하고(I2 구현 메모의 이어받을 자리) `placeState().usable` 을 `persist.placeUsable` 로 바꾼다.
- 교대 끝의 틱에 닫힌 사건의 `closed` 신호는 처리되지 않고 `world.signals` 에 남는다(교대가 끝났다 — 아무 일도 없다).

**시험**: `tests/causality.test.ts` 'I1-b b2' 아홉 개 — 규칙 없는 교대의 세계(처음 값 그대로)와 신호(종료·인계가 기록마다 하나, 도시 좌표), 붕괴·폭발 신호의 갈래, 규칙의 발동(열쇠·쿨다운·상한·시도 번호의 흐름·한 틱에는 쌓여 있던 신호만·world tick), `spawnConsequence`(원인·`csq`·자기 흐름·`made`·깊이와 상한의 `dropped`), 조건 연쇄(`when`·`until`·`expired`), 기존 연쇄의 `dropped`, 구역 값(덮어쓰기·회복·`recover`·알려진 칸만)·응급실 체류·병원, 건물 상태(`placeState`·`knownBuildingAt`·`knownZoneOfIncident`), **정보 격리의 소스 글자 검사**(§6 I1-b 7 — `dispatch/*`·`commander`·`brain`·`orders/*` 에 `sim.world`·`world.zones`·`world.hospitals`·`world.signals`·`world.log`·`placeMarks`·`carryState` 가 없다 · `analyst`·`dispatcher` 에 `truth.placeId` 가 없다 · `resources.startTransport` 의 본문에 둘 다 없다). **규칙을 등록하는 시험은 자기 `Sim` 만 돌리고 `finally` 에서 거둔다** — 등록은 그 시험 파일 안의 모든 `Sim` 에 걸린다(`probedShift` 의 캐시를 더럽히지 않게).

**b3 에게**:

- 규칙의 조건은 `sim.world`·현장의 진실을 읽어도 된다. 관제·지휘관 쪽 코드에는 위 정보 격리 시험이 걸려 있다 — `known*` 만 쓴다.
- 규칙을 하나 넣을 때마다 `tools/measure.sh` 로 재고 `out1/` 과 견준다(`node tools/summ.mjs out1 <새 폴더>`). `tools/hashrun.sh` 는 "이 규칙이 안 걸리는 교대는 그대로인가"를 보는 데 쓴다(규칙마다 새 흐름이라 걸리지 않은 교대의 해시는 같아야 한다).
- world tick 규칙의 `test` 는 1초마다 불린다(시도 번호도 1초마다 는다) — "60초에 한 번 확률 p" 는 `key` 가 그때만 열쇠를 돌려주거나(그 밖에는 `null`) 쿨다운을 60 으로 두고 조건이 거짓일 때도 쿨다운이 걸리게 규칙 안에서 다룬다(틀은 조건이 거짓이면 쿨다운을 걸지 않는다).

**관문** (마지막 코드 커밋 `5326a9a`): `npm run check` 통과 — 테스트 901 + 건너뜀 1(파일 19개. 시작점 890 에 열하나 더함: b1 둘 · b2 아홉), 보통 40 검증 통과(사건 565 · 성공 75% · 대응 지연 4% · 실패+미해결 11%, 한계 시간 0 · 방치 1, 교착 0 · 잊힘 0 · C1~C5 0 — 시작점과 같은 값이다: 보통 40 은 b1·b2 로 바뀌지 않는다). `sweep 40 --diff hard --check`(사건 715 · 성공 52% · 한계 시간 5 · 방치 7)·`--diff extreme --check`(사건 854 · 성공 27% · 한계 시간 18 · 방치 22 · 출동 없음 16) 통과 — 둘 다 최대 깊이 2 · 교착 0 · 잊힘 0 · C1~C5 0. 마지막 커밋의 해시 목록도 b1 끝과 diff 0(`out2-final/hash.txt`). 브라우저(개발 서버 5218, `?seed=S7`)가 뜨고 콘솔 오류 0건(화면은 고치지 않았다 — `engine.ts` 의 import 가 늘어 한 번 띄워 본 것). 다른 묶음의 작업자와 기계를 나눠 쓰는 동안 전체 관문이 한 번 `tests/sim.test.ts` 의 두 시험에서 **시간 초과로만** 실패했다(180초·120초 — 16분 걸린 회차) — 그 파일만 다시 돌려 44개 통과, 한가할 때 전체를 다시 돌려 통과(11분).

### b3-1 · b3-2 · b3-3 — C6 · C3 · C2: 이미 상태 결합인 세 규칙 (2026-11-20 밤, 브랜치 `wf/causality-r123` → `wf/causality`, 시작점 `f599a39` = b2 끝에 주 브랜치를 받은 자리 — 예비 펌프 1 `99f7101` 포함)

커밋: C6 `ff8f872` · C3 `ad9a718` · C2 `4359963` · 시험 `bebbb6d` (+ 이 메모). **이 덩어리는 §3.7 의 C6 → C3 → C2 만 했다.** 그 밖의 규칙(C9·C10·C1·C5·C4·C8·C7·C11·C12 — "X 면 확률 p 로 사건 Y" 꼴)은 사용자 결정(2026-11-20 저녁, `docs/ROADMAP.md` "진행 중")으로 설계를 다시 쓰는 중이라 한 줄도 넣지 않았다. 세 규칙은 사건을 만들지 않는다(`world.spawned` 는 늘 0).

#### 기준 (b3 의 "전")

- `outpre/`(같은 scratchpad): **극한만 시작점 `f599a39` 에서 다시 쟀다**(`extreme30.json` · 해시 목록 `hash.txt` · `check-extreme.log`). 보통·어려움·재난 다섯·강제 셋은 `out1/` 의 파일 그대로다 — 시작점의 해시 목록이 `out1/hash.txt` 와 다른 줄은 **극한 20줄과 극한 강제 4줄뿐**이다(예비 펌프 0 → 1 은 장비 손잡이 1 인 조건만 바꾼다). `pre/` 는 `f599a39` 를 푼 사본, `c6/`·`c3/`·`c2/` 는 규칙마다의 커밋을 푼 사본, `out-c6/`·`out-c3/`·`out-c2/` 가 그 결과다(`tools/summ2.mjs <폴더…>` 가 아래 표를 낸다).
- **극한 30 의 새 기준**(예비 펌프 1): 사건 656 (21.87) · 성공 27.1% · 성공+대응 지연 38.9% · 실패+미해결 43.0% · 한계 시간 21 · 방치 23 · 출동 없음 4 · 평균 대응 85초 · 부모 있는 사건 34 (5.2%, 최대 깊이 2) · 버린 연쇄 36 · 다른 사건 원인 3227 · 세계 원인 5 · spread ≥3 67 (최대 5 · 세계에서 1) · replan 53.3% (from world 56) · 전환 146 · hurt 40 · 늦어진 874초 · 교착 1 · 잊힘 0 · 반복 최대 80(S12 #14 — b1 메모의 알려진 고리) · 엔트로피 1.43 · 2.84 · 2.58 · C1~C5 0 (C5 짝 639) · `reportHash 8cb80546`. 극한 40 `--check` 는 시작점에서 통과(사건 871 · 성공 28% · 한계 시간 25 · 방치 26 · 출동 없음 5, 교착 후보 1 — S23 #15 `fire/plane` 169초. 극한의 교착은 관문에 걸지 않는다).

#### b3-1 — C6 `divertRecord` (`ff8f872`, 결과는 그대로 · 기록만 는다)

1. **자리**: 새 파일 `world/rules/record.ts` — `noteDivert(sim, J, u, ev)`(관제 `dispatcher.sendUnit` 의 전환 블록이 DIVERTED 를 남긴 바로 다음, `dispatchUnit` 이 예정 도착을 덮어쓰기 전에 부른다) · `divertArrived(sim, J)`(`sceneManager.unitArrived` — 지상 대원이 처음 내린 틱, 도착 기록 다음) · `divertUnmet(sim, J)`(`incidents.closeIncident` — 닫는 시각을 적은 바로 다음) · `DIVERT_LATE_MIN = 10`. **등록하는 규칙은 없다**(기록 규칙 — 신호·쿨다운·상한·`world.log` 줄이 없다. `world/rules/index.ts` 의 첫 줄로 자리만 지킨다). 세계 상태를 읽지 않으므로 관제 파일이 불러도 된다(시험이 그 파일의 글자를 본다).
2. **`Incident.divertWait`** 는 J 에 **아직 아무도 닿지 않았을 때만** 쌓는다(`J.firstArrivalAt < 0` — 재는 것이 "첫 도착이 늦어진 시간"이다. 측정 도구의 `divert.hurt` 와 같은 조건). 첫 도착 때 전환마다 `ref.lost = max(0, round(t − eta))` 를 그 DIVERTED 문제에 적고 `divertWait` 를 비운다. 10초 넘게 늦은 전환이 있으면 **기록 한 줄**(`role 'DISPATCH'`·`actor '배정 AI'`·`kind 'dispatch'`·`imp 1`, 원인 = 그 DIVERTED 기록들): `사건 NN: 전환 배정 뒤 첫 도착이 예정보다 약 N초 늦었습니다.`(N 은 가장 큰 지연). 끝내 아무도 닿지 못하고 닫히면 `ref.lost = 닫힌 시각 − eta` 만(기록 없음).
3. 이미 부대가 닿은 사건에서 빼 간 전환은 `ref.lost` 가 없다(`undefined` — "늦어지지 않았다"의 0 과 다르다). b4 의 문장 "{부대}가 사건 {코드}로 돌려져 첫 도착이 약 {lost}초 늦었습니다" 는 `ref.lost >= 10` 인 것만 쓰면 기록과 맞는다.
4. **결과가 바뀌지 않는다**: §4 의 `--json` 여덟 조건이 `reportHash` 말고 모든 칸(지표 포함)에서 "전"과 같다(어려움 30 의 `chain.dropped` 2 → 3 은 b2 가 바꾼 셈법이다 — `out1/` 은 b1 끝에서 쟀다) — 새 기록은 사건 안의 관제 기록이라 확산·시스템 지표를 바꾸지 않는다. 해시 목록은 123줄 가운데 27줄이 바뀐다(10초 넘게 늦은 첫 도착이 있는 교대: 보통 7 · 어려움 5 · 극한 8 · 강제 3 · 극한 강제 1 · 지진 2 · 산불 1). `Σ ref.lost` 는 측정 도구가 표본으로 따로 잰 `divert.lostSec` 과 같다(보통 60: 322초 · 어려움 30: 538초).
5. 시험 셋(`tests/causality.test.ts` 'I1-b b3-1'): 실제 교대 넷(S0·S3·S7·S8)의 `ref.lost`·지연 기록·측정값 일치 / 기억과 정산(손으로 만든 전환 — 7초·52초·도착 없이 종료) / C6 의 파일이 세계 상태를 읽지 않는다(소스 글자).

#### b3-2 — C3 `hospitalLoad` (`ad9a718`)

1. **상태**: `types.HospitalState` 에 **`lastEv`**(마지막 인계 기록 — 포화 알림의 원인)를 더했다. `since` = 포화·재개가 마지막으로 바뀐 시각, `cause` = **지금 상태를 알린 기록**(포화 알림 또는 수용 재개). `world/state.ts`: `hospitalOf(sim, fac)`·`erLoad(H, t)`(진실 쪽 — 병동으로 옮겨질 시각이 지나지 않은 체류 수), **`knownHospital` 이 `{ divert, ev }`** 를 돌려준다(`ev` = 그것을 알린 기록 — 관제가 받은 알림이다).
2. **한도 `HOSPITAL_CAP = [8, 10]`** (본문의 6 · 8 에서 — `city.facilities` 의 병원 순서 = `LANDMARKS` 순서: 시립병원 · 가온대학교병원). 규칙이 없을 때의 이송량을 쟀다(`tools/hospload.mts` — 보통 30교대: 한 교대에 18.4명을 인계, "300초 안에 한 병원이 받은 사람 수"의 교대별 최댓값이 시립병원 중앙값 6 · 가온대학교병원 3~4). 6 · 8 이면 보통 교대의 60% 에서 시립병원이 포화였다. 8 · 10 으로 **보통 60교대 가운데 16교대(27%)에서 포화 17번**, 버스 강제 20교대 가운데 9교대, 어려움 30 가운데 16교대, 지진 20 가운데 11교대.
3. **규칙 둘**(`world/rules/hospital.ts`, 상수 `ER` — `STAY 300`·`RELIEF 2`·`HOLD 60`·`PENALTY 240`·`REROUTE_MAX 120`·`CROWD_SEC 3`):
   - `hospitalIntake`(`on: ['delivered']`, 열쇠 `fac:<id>`, **`silent`**): 인계마다 `data + size` 명을 `sig.t + 300` 으로 `stays` 에, `lastEv = sig.ev`. `world.log` 에 줄을 남기지 않는다.
   - `hospitalLoad`(`on: 'tick'`, 열쇠 `fac:<id>` — 지금 바뀌어야 하는 첫 병원, 없으면 `null`): 체류 ≥ 한도면 포화(`known = true`, 알림 `role 'SYSTEM'`·`actor` 병원 이름·`kind 'unit'`·`tag 'hospital'`·`imp 2`·원인 `lastEv`: `○○ 응급실 포화 — 당분간 중증 환자만 받습니다.`), 체류 ≤ 한도 − 2 면 재개(`imp 1`·원인 = 포화 알림: `○○ 응급실 수용 재개.`). 바뀐 지 60초 안에는 다시 바꾸지 않는다(`H.since` — 틀의 쿨다운이 아니다). `world.log` 의 `hospitalLoad` 줄 = 포화 + 재개의 수(**포화만 세려면 `tag 'hospital'` 이고 `importance 2` 인 기록**).
   - **틀에 더한 것**: `Consequence.silent?`(참이면 `world.log` 에 줄을 남기지 않는다 — 인계마다 도는 규칙이 기록을 덮지 않게).
4. **이송(관제 쪽 — `resources.startTransport`)**: `knownHospital` 만 읽는다(시험이 본문을 글자로 본다). 포화를 알린 병원은 예상 도착에 `ER_PENALTY`(240)를 더해 견준다. 포화가 아니었다면 갔을 병원(`near`)과 다른 곳을 골랐으면 그 환자의 사건에 `HOSPITAL_FULL`(`role 'DISPATCH'`·`imp 1`·원인 = 그 알림, `ref { fac: 포화 병원, unit, lost: 늘어난 초 }`, 상세 `○○ 포화로 △△으로 이송 (약 +N초)`, 문구 `○○ 응급실 포화 — {부대}은 △△으로 갑니다 (약 +N초).`). **출발 기록의 원인**은 `transportWhy(u)`(= 그 알림과 HOSPITAL_FULL 기록)를 `sceneManager` 5)번 블록과 `rules/air.ts` 의 출발 기록이 넣는다. 둘 다 포화면 벌점이 상쇄돼 가까운 곳으로 가고 기록은 없다.
5. **이송 중 목적지 변경**(`hospital.ts` 의 `reroute` — 포화가 알려지는 그 발동 안에서, 곧 `tickWorld` 의 규칙 처리 단계에서만 `etaFor` 를 부른다): 그 병원으로 `transport` 중인 부대(헬기 포함) 가운데 포화가 알려지지 않은 다른 병원이 120초 넘게 멀지 않으면 `sendUnitTo`. 기록은 **그 사건의 HOSPITAL_FULL 문제 기록 한 줄**이다(본문의 "`kind 'unit'` 기록 + HOSPITAL_FULL" 을 하나로 — `role 'UNIT'`·`actor` 호출부호·원인 = 그 알림, 문구 `호출부호: ○○ 포화 소식 — △△으로 목적지 변경.`, 상세 `○○ 포화로 이송 중 △△으로 목적지 변경 (약 +N초)`). 환자의 사건이 없는 차(다친 대원만)는 문제 없이 `kind 'unit'` 기록만.
6. **응급실 대기(`resources.arrive` — 세계 규칙 쪽이라 체류를 읽는다)**: 인계 시간에 `3 × max(0, 체류 − 한도/2)` 초. 대기 기록(T2)의 원인 = 앞에서 인계 중인 부대의 **출발 기록**(본문의 "도착 기록"은 없는 기록이다 — 병원에 닿은 부대는 기록을 남기지 않는다. `noteDeparture(u, ev)` 로 출발 기록을 기억한다), 체류로 늦어졌으면 그 병원의 마지막 인계 기록도. **앞에 선 차 없이 체류만으로 9초 넘게 늦어질 때**(`ER_CROWD_NOTE`)는 새 문구 `…인계가 늦어집니다 (응급실에 환자 N명).` 로 남긴다(T2 가 잡는다) — 그 아래의 지연은 기록하지 않는다.
7. **문구 규칙 T8·C5**(`scripts/metrics.ts`): `PHRASE.T8`, `checkC5` 는 같은 부대의 마지막 출발 **또는 목적지 변경**의 병원 = 다음 인계의 병원, `sysOf` 의 `kind 'unit'` 갈래가 T8 을 병원으로. `debrief`: `order` 의 `TIMEOUT` 바로 앞에 `HOSPITAL_FULL`, 문장 `응급실 포화로 이송할 병원을 바꿨습니다: {상세 둘까지}.`(사건이 닫힌 뒤에 생긴 것은 이 문장에 들지 않는다 — 보통 60 에서 36건 가운데 4건. b4 의 사슬 문장이 `I.problems` 로 쓴다).
8. 시험 넷('I1-b b3-2') + 고친 시험(T8 의 문구·시스템, C5 의 손 기록, b2 의 "규칙이 없는 교대" → "걸린 규칙이 바꾼 것 말고는 처음 값", `knownHospital` 의 모양): 한도·체류·포화·재개·60초 / 새 이송의 벌점·HOSPITAL_FULL·출발 기록의 원인·이송 중 목적지 변경·둘 다 포화·재개 뒤 / 실제 교대(S3·S7)의 사슬과 교대 끝의 체류 = 마지막 300초의 인계 수. **`tests/crews.test.ts` 의 "출발 기록의 병원은 실제로 가는 병원이다"** 도 목적지 변경을 출발로 치게 고쳤다(R1 의 시험 — C5 와 같은 규칙).

#### b3-3 — C2 `rubbleRoad` (`4359963`)

1. **`traffic.ts`**: `ObstacleKind` 끝에 `'rubble'`(라벨 '건물 잔해'), `Obstacle.ev?`(놓을 때의 기록 — 리터럴에 `undefined`), **`ObstacleOpts.quiet?`**, `obstacleOnEdge(sim, edge)`, `reportObstacle` 의 보고 기록이 `o.ev` 를 원인으로. **본문과 다른 사실**: `addObstacle` 은 기록을 남긴다(`announce` — 남기지 않는 것은 안쪽의 `place`). 그래서 `quiet: true` 로 놓고 규칙이 그 자리에서 원인과 함께 기록한 뒤 `ob.ev` 에 넣는다.
2. **규칙 하나**(`world/rules/structure.ts`, 상수 `RUBBLE` — `DUR [240, 420]`·`TIP [35, 70]`·`BLAST_R 3.2`·`COOLDOWN 600`·`CAP 6`): `rubbleRoad`(`on: ['closed', 'blast', 'catastrophe']`, 열쇠 **`place:<건물 id>`** — 쿨다운이 건물마다라서. 그래서 난수 흐름은 `csq:rubbleRoad:place:<id>:<n>` 이다, 본문의 `inc:<id>` 가 아니다).
   - (가) `closed`: **그 사건이 적은** 건물 상태가 `collapsed`·`blasted` 일 때(`sim.placeMarks.get(place)` 의 `incidentId` 가 그 사건 — `placeState` 는 그 칸을 주지 않아 직접 읽는다. 앞 사건이 남긴 상태로 뒤 사건이 잔해를 또 남기지 않게). 구간 = `I.blockedEdge`(X6 의 통제 — `closeIncident` 가 방금 연 그 구간), 없으면 건물의 `edgeId`. 늘 알려진다.
   - (나) `catastrophe`(`data 0` — X6 의 폭발, 반경과 무관)·`blast`(반경 ≥ **3.2** — 본문의 4 로는 지금 하나뿐인 `blast` 신호원인 폭발물(반경 3.4)이 영영 걸리지 않는다): 사건이 열려 있고 `I.blockedEdge < 0` 일 때 건물의 `edgeId`. 현장에 `active` 대원이 있으면 알려지고, 없으면 진실 기록(`actor '도시'`·`truth`)과 시민 제보 시각(`tipAt` = 35~70초 뒤 — T1 의 낙하물과 같다)만 둔다.
   - 그 구간에 이미 장애물이 있으면 걸리지 않는다(조건 — 쿨다운·상한을 쓰지 않는다). 전면 통제가 거절되면 한 차로.
   - 기록: 알려진 것 `{구간} 건물 잔해로 {전면·한 차로} 통제.`(`role 'SYSTEM'`·`actor '교통정보'`·`kind 'traffic'`·`imp 1`·사건 없음, 원인 = 종료 기록 / 폭발 기록), 모르는 것 `{구간}에 건물 잔해가 쏟아져 {길이 막혔습니다·한 차로가 막혔습니다}. 아직 아무도 신고하지 않았습니다.`. 치워질 때는 교통 모델의 기록 그대로(`… 통행 재개.` / `… 건물 잔해 정리 — 정상 소통.`).
3. **`resources.blockRef`**: 사건 통제가 아니면 그 구간의 장애물 기록(`o.ev`)을 ROUTE_BLOCKED 의 원인으로, `ref.inc` = 그 기록의 원인이 가리키는 사건(잔해를 낳은 사건). 되돌아선 자리(`turnBack`)와 알려진 통제를 보고 경로를 바꾼 두 자리가 같은 함수를 쓴다. TRAFFIC_DELAY 는 0단계 그대로 그 ROUTE_BLOCKED 를 잇는다.
4. **지도**: `trafficLayer.OBSTACLE_ICON.rubble`(깨진 덩어리 셋이 쌓인 더미 — 낙하물의 상자와 윤곽이 다르다. 10~48화소 견본표로 확인)·범례 `MapLegend` 의 장애물 줄에 '건물 잔해'. 개발 서버(5218) `?seed=S10` 의 t ≈ 150초(사건 01 의 가스 용기 폭발 → 산복도로 통제)에서 표식과 통제 점선, 범례를 보았다 — 콘솔 오류 0건.
5. 시험 다섯('I1-b b3-3'): (가) 전체 붕괴 → 종료 → 그 구간의 알려진 전면 통제·원인 = 종료 기록·`ev`·`world.log`·도시 연결(모든 시설 → 사건 교차로·구간 양 끝, 실제 상태·큰 차)·치워지면 열림 / 한 차로 갈래·앞 사건의 건물 상태·`partial` 은 아님·`blasted` 는 면한 구간 / (나) 대원 없는 폭발의 모르는 잔해 → 부대가 가서 보고(`known`)·ROUTE_BLOCKED 의 원인과 `ref { inc, unit, edge }`, 대원 있는 폭발·반경 문턱·쿨다운·X6 가 막은 사건 / 실제 교대(S0·S3·S7) / `quiet`·`ev`.

#### 전후 수치 (§4 의 명령 전부 — 전 `outpre/` → C6 → C3 → C2. C6 열은 `reportHash` 말고 "전"과 같아 생략)

| 조건 | 성공+대응 지연 (전 → C3 → C2) | 실패+미해결 | 한계 시간·방치·출동 없음 | 사건 (교대당) | 평균 대응 | spread ≥3 (최대·세계에서) | 세계 원인 | replan (from world) | 전환 n·hurt·늦어진 초 | 병원·도로를 건드린 사건 | 교착·잊힘·반복 |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 보통 60 | 80.6 → 80.4 → **80.3%** | 9.3 → 9.5 → 9.7% | 1·2·0 → 1·2·0 → 1·2·0 | 846 (14.1) 그대로 | 50초 그대로 | 4 (4·0) → 6 (4·2) → 6 (4·2) | 0 → 66 → 69 | 48.0% (31) → 50.0% (69) → 50.0% (71) | 56·31·322 → 57·32·322 → 58·33·324 | 75.7%·24.4% → 75.7%·24.5% → 75.6%·24.9% | 0·0·10 → 0·0·10 → 0·0·13 |
| 어려움 30 | 62.1 → 61.6 → **60.7%** | 20.4 → 21.0 → 21.4% | 2·5·0 → 1·5·0 → 1·5·1 | 538 → 537 → 537 (17.9) | 63 → 64 → 64초 | 15 (4·0) → 11 (3·2) → 9 (3·2) | 0 → 60 → 65 | 52.8% (34) → 54.4% (70) → 54.4% (79) | 66·31·538 → 62·29·429 → 67·31·476 | 75.7%·30.2% → 75.1%·29.7% → 74.1%·30.8% | 0·0·8 → 0·0·6 → 0·0·6 |
| 극한 30 | 38.9 → 38.3 → **38.4%** | 43.0 → 42.8 → 43.3% | 21·23·4 → 15·21·3 → 14·23·5 | 656 → 650 → 654 (21.8) | 85 → 86 → 86초 | 67 (5·1) → 62 (5·2) → 77 (7·2) | 5 → 79 → 103 | 53.3% (56) → 55.5% (106) → 57.4% (123) | 146·40·874 → 134·41·1273 → 150·42·1292 | 65.6%·34.4% → 65.7%·34.0% → 65.2%·34.0% | 1·0·80 → 0·0·80 → 0·0·80 |
| 태풍 20 | 74.5 → 73.7 → **73.3%** | 14.9 → 15.3 → 15.8% | 8·0·0 → 7·0·0 → 7·0·0 | 462 → 463 → 461 | 102초 그대로 | 49 (5·1) → 49 (5·2) → 45 (5·2) | 316 → 354 → 354 | 45.7% (18) → 48.2% (42) → 48.6% (44) | 89·15·58 → 88·15·58 → 84·15·58 | 69.1%·44.3% → 69.2%·44.5% → 69.9%·44.4% | 0·0·5 → 0·0·5 → 0·0·6 |
| 홍수 20 | 67.5 → 67.2 → **67.2%** | 10.0 → 9.3 → 9.3% | 2·0·0 → 3·0·0 → 2·0·0 | 409 그대로 | 82 → 82 → 81초 | 15 (4·1) → 19 (4·2) → 20 (4·2) | 240 → 278 → 284 | 54.8% (30) → 56.5% (56) → 56.3% (57) | 61·17·200 → 61·17·198 → 62·17·198 | 70.1%·38.5% → 70.1%·38.5% → 70.4%·39.3% | 0·0·11 그대로 |
| 지진 20 | 42.7 → 41.4 → **40.9%** | 38.5 → 38.8 → 38.4% | 20·1·7 → 22·2·7 → 25·0·7 | 429 → 430 → 425 | 96 → 96 → 97초 | 139 (9·2) → 143 (6·2) → 168 (7·3) | 309 → 359 → 370 | 70.5% (53) → 71.5% (85) → 72.6% (95) | 147·20·154 → 150·21·151 → 150·20·138 | 61.8%·41.5% → 61.7%·40.9% → 62.2%·43.7% | 0·0·11 → 0·0·11 → 0·0·16 |
| 산불 20 | 66.6 → 67.1 → **65.9%** | 17.8 → 18.4 → 19.0% | 7·1·1 → 5·1·1 → 4·1·1 | 332 → 331 → 331 | 75 → 76 → 76초 | 29 (5·2) → 28 (5·2) → 28 (5·2) | 117 → 156 → 154 | 61.8% (14) → 63.0% (36) → 63.0% (35) | 63·13·24 → 66·15·14 → 67·15·14 | 73.8%·31.4% → 72.8%·30.9% → 73.8%·30.6% | 0·0·8 그대로 |
| 해일 20 | 75.1 → 74.6 → **74.6%** | 7.3 → 7.6 → 7.6% | 1·0·0 그대로 | 369 → 370 → 370 | 72초 그대로 | 10 (4·1) → 10 (4·2) → 10 (4·2) | 141 → 195 → 196 | 51.5% (5) → 54.1% (35) → 54.1% (36) | 41·10·126 → 38·10·126 → 38·10·126 | 74.9%·27.8% → 74.7%·28.0% → 74.7%·28.3% | 0·0·8 → 0·0·7 → 0·0·7 |

- 모든 조건·모든 단계에서 **C1~C5 0 · 계산 오류 0 · 최대 깊이 2 · 부모 있는 사건 수는 "전"과 같거나 ±2**(세 규칙은 사건을 만들지 않는다 — 달라진 것은 진행이 바뀌어 기존 연쇄가 달리 걸린 것이다). 보통 60 의 `chain.dropped` 4 그대로.
- 강제 20교대(교대 전체의 종료 사유): `collapse/gasblast` 한계 시간 2 → 2 (+ 교대 끝 종료 1) · `traffic/bus` 1 → 1 (C3) → **5** (C2 — 그 시나리오 자신은 26건 가운데 1건, 나머지 넷은 S7 의 뒤 사건 셋과 S15 의 방화. 잔해가 직접 막은 사건이 아니라 진행이 갈린 것이다. 조건을 다 합친 한계 시간·방치·출동 없음은 113 → 111 로 늘지 않았다) · `fire/std` 3+1 → 3+1 (+ 교대 끝 종료 1). 세 조건 모두 교착 0 · 잊힘 0 · C1~C5 0.
- 해시 목록(123줄)에서 바뀐 줄: C6 27 · C3 98(C6 대비 — 붐빔이 인계 시간을 바꿔 거의 모든 교대가 달라진다) · C2 74(C3 대비).
- **규칙이 걸린 수**(끝 커밋, `tools/rulecount.mts`):

| 조건 | 전환 (ref.lost 있는 것 · 합 · 지연 기록) | 포화 알림 (교대 수) · 재개 | HOSPITAL_FULL 출발 · 이송 중 (닫힌 뒤) | 응급실 대기 기록 (체류만으로) | 잔해 (교대 수) · 모르는 것 · 한 차로 · 그 앞에서 되돌아선 부대 |
|---|---|---|---|---|---|
| 보통 60 | 58 (33 · 324초 · 11) | 17 (16) · 16 | 30 · 6 (4) | 77 (11) — "전" 62 | 22 (18) · 0 · 2 · 0 |
| 어려움 30 | 67 (31 · 477초 · 13) | 21 (16) · 20 | 22 · 12 (6) | 73 (20) — "전" 46 | 43 (23) · 3 · 4 · 4 |
| 극한 30 | 150 (42 · 1295초 · 21) | 21 (14) · 20 | 35 · 13 (10) | 82 (21) — "전" 53 | 85 (27) · 13 · 9 · 7 |
| 버스 강제 20 | 28 (10 · 40초 · 1) | 13 (9) · 13 | 13 · 4 (3) | 39 (8) | 18 (7) · 0 · 4 · 0 |
| 가스 폭발 강제 20 | 36 (16 · 254초 · 5) | 11 (9) · 11 | 8 · 6 (4) | 41 (8) | 22 (11) · 5 · 2 · 4 |
| 지진 20 | 150 (20 · 138초 · 3) | 13 (11) · 12 | 22 · 5 (2) | 45 (9) | 92 (20) · 9 · 8 · 5 |

읽을 것:

- **§4 의 목표 안이다**: 보통 60 의 성공+대응 지연 −0.3%p(± 4%p) · 실패+미해결 +0.4%p(+ 4%p 이하) · 한계 시간·방치·출동 없음 그대로(+ 2건 이하) · 평균 대응 그대로 · 교대당 사건 수 그대로 · 교착 0 · 잊힘 0. 가장 크게 움직인 것은 지진 20(−1.8%p, 한계 시간 20 → 25 — 무너진 건물이 많아 잔해가 교대당 4.6건, 상한 6)과 어려움 30(−1.4%p)이다.
- **세계에서 오는 원인이 보통 교대에 처음 생겼다**(0 → 69): 병원 알림(사건 없는 기록)이 HOSPITAL_FULL·출발 기록의 원인이 되고, 잔해 기록이 그 앞의 ROUTE_BLOCKED 의 원인이 된다. `replan.fromWorld` 31 → 71, `spread ≥ 3` 4 → 6(세계에서 시작한 확산 0 → 2). b0·b2 메모가 말한 "지금의 확산은 거의 모두 관제 → 관제" 에 병원·도로를 지나는 길이 더해졌다 — 예: `sweep 1 --log S3` 의 17:02:23 `시립병원 응급실 포화` → `지원구급1: 시립병원 포화 소식 — 가온대학교병원으로 목적지 변경.`(사건 09) → 17:05:52 사건 14 의 출발 둘이 가온대학교병원으로(약 +44초).
- `systems.share` 의 병원·도로는 거의 그대로다: 이송이 있는 사건은 이미 병원을 건드린 사건이었고, 잔해 기록은 사건 없는 기록이라 낳은 사건의 집합에 들지 않는다(그 앞에서 되돌아서거나 경로를 바꾼 **다른** 사건이 도로를 얻는다 — 어려움 +0.6%p · 지진 +2.2%p, 극한은 −0.4%p 로 흔들림 안).
- **보통 교대의 잔해는 모두 알려진 것이다**(22건 가운데 모르는 것 0 — 폭발은 대개 대원이 와 있을 때 난다). 모르는 잔해와 그 앞에서 되돌아서는 부대는 어려움·극한·지진·가스 폭발 강제에서 나온다(ROUTE_BLOCKED 의 원인이 잔해 기록, 그 원인이 폭발 기록).
- 보통 60 의 반복 최대 10 → 13 은 같은 줄(S46 #12 "추가 위험이 있습니다. 밖에서 방수하겠습니다." — X6 의 외부 방어 문구)이 진행이 갈려 세 번 더 나온 것이다. 지진 20 의 11 → 16 도 같은 종류다(고치지 않았다 — 이 규칙들의 기록이 아니다).
- 교대당 시간(`sweep 12 --no-metrics`, "전"과 번갈아 세 번 — 다른 작업과 기계를 나눠 쓰는 중): 사용자 CPU 전 32.4·34.6·33.2초 / 뒤 34.4·35.8·34.4초(+4%), 교대당 1,010·1,063·1,039 / 1,095·1,115·1,064ms(+5%) — 기준 × 1.2 안이다(세계 틱의 일은 1초에 한 번 병원 둘을 보는 것과 닫힌 사건마다 건물 상태를 한 번 보는 것뿐이고, 나머지는 진행이 달라진 몫이다).

#### 본문과 다르게 한 곳 (요약)

- C6: 등록하는 규칙이 없다(함수 셋을 관제·현장·종료가 직접 부른다) · `divertWait` 는 아무도 닿지 않은 사건만 · 지연은 반올림한 초.
- C3: 한도 6 · 8 → **8 · 10** · `HospitalState.lastEv` · `knownHospital` 의 `ev` · 규칙을 둘로(체류 `hospitalIntake` — `silent`, 포화·재개 `hospitalLoad` — world tick) · 이송 중 목적지 변경의 기록을 HOSPITAL_FULL 문제 기록 하나로 · 출발 HOSPITAL_FULL 은 `startTransport` 가 남기고(`role 'DISPATCH'`) 출발 기록의 원인은 `transportWhy` · 응급실 대기의 원인은 앞 차의 **출발** 기록 · 체류만으로 9초 넘게 늦을 때의 새 대기 문구 · `ER_PENALTY`·`ER_CROWD_SEC` 는 `resources.ts` 에(그 파일이 쓰고 `hospital.ts` 가 그 파일을 부른다) · **C3-6 `knownDetourCauses`(선택)는 하지 않았다**.
- C2: `addObstacle` 의 `quiet` · 열쇠와 난수 흐름이 `place:<id>` · (가)는 그 사건이 적은 건물 상태만(`placeMarks` 를 직접 읽는다) · `blast` 문턱 4 → 3.2 · 모르는 잔해에 시민 제보 시각 · 그 구간에 이미 장애물이 있으면 걸리지 않는다 · `blockRef` 가 장애물 기록과 그것을 낳은 사건을 잇는다.

#### b4·검토에게 (이어받을 자리)

- **보고서(b4)가 읽을 것**: 전환 = `I.problems` 의 DIVERTED 와 `ref.lost`(10초 이상만 문장으로) · 부족 = `I.blockedBy` · 병원 = `I.problems` 의 HOSPITAL_FULL(`ref.fac`·`ref.unit`·`ref.lost`, 상세에 '이송 중' 이 있으면 목적지 변경 — 사건이 닫힌 뒤에 생긴 것도 있다) · 포화 횟수 = `tag 'hospital'`·`importance 2` 기록 · 잔해 = `world.log` 의 `rubbleRoad` 줄(`ev` = 원인 기록, `inc` = 낳은 사건) · `ShiftReport.world`·`incidents[].chain` 은 아직 아무도 채우지 않는다.
- **I2**: 교대 끝에 남은 잔해는 `sim.traffic.obstacles` 의 `kind 'rubble'`(I2 §3.5 (나) 줄의 원천 — 본문 그대로). `Obstacle.ev` 는 그 교대의 기록 id 라 넘기지 않는다.
- **다시 쓰는 설계에게**: C5·C4·C8 이 쓰려던 구역 값(`setZone`·`recover`)은 아직 아무 규칙도 쓰지 않는다. 병원 한도를 줄이는 C4-5("정전 동네의 병원은 한도 − 2")는 `HospitalState.cap` 을 고치면 `hospitalLoad` 가 그대로 따른다.
- 세 규칙의 상수(`ER`·`HOSPITAL_CAP`·`RUBBLE`·`DIVERT_LATE_MIN`)는 첫 값을 한 번 맞춘 것이다. 지진의 잔해(교대당 4.6건)가 과하면 §4 의 차례로 `RUBBLE.CAP` → `DUR`.
- **알려진 한계**: (가)와 (나)가 같은 건물에 600초 안에 겹치면 뒤의 것은 쿨다운에 걸린다(폭발의 잔해가 치워진 뒤 그 건물이 통째로 무너져 닫혀도 남는 잔해가 없다 — 드물다). (나)의 잔해가 놓인 뒤 X6 의 전체 붕괴가 나면 `blockRoad` 가 **다른** 구간을 막는다(잔해 구간은 이미 닫혀 있어 건너뛴다) — 사건 교차로의 길 둘이 막히지만 T1 의 "하나 남은 길이 되면 치운다"가 끊김을 막는다. 포화가 풀리는 조건은 체류뿐이라 큰 사고 뒤에는 수용 재개가 5분쯤 걸린다(체류 300초).

**관문** (마지막 코드 커밋 `bebbb6d`): 보통 40 `--check` 통과(사건 565 · 성공 74% · 대응 지연 4% · 실패+미해결 11% · 한계 시간 0 · 방치 1 · 교착 0 · 잊힘 0 · C1~C5 0 · 최대 깊이 2) · `sweep 40 --diff hard --check` 통과(사건 713 · 성공 51% · 한계 시간 6 · 방치 7 · 출동 없음 1) · `--diff extreme --check` 통과(사건 871 · 성공 28% · 한계 시간 19 · 방치 26 · 출동 없음 7 — 시작점은 25 · 26 · 5, 교착 후보 1 → 0) · 재난 다섯 × 12교대 `--check` 모두 통과(예외 0 · 끝나지 않은 사건 0 — 태풍 279건 · 홍수 246 · 지진 257 · 산불 199 · 해일 224). `npm run ui-check` 모두 통과(8항목, 153초). `npm run check` 의 테스트는 C2 커밋(`4359963`)에서 **한 개가 실패했다** — `tests/crews.test.ts` 의 "출발 기록의 병원은 실제로 가는 병원이다"(R1 의 시험이 이송 중 목적지 변경을 몰랐다 — 시간 초과가 아니라 C3 가 만든 실제 어긋남이라 그 시험을 C5 와 같은 규칙으로 고쳤다, `bebbb6d`). 고친 뒤 **`npm run check` 통과**(`232acec` — 이 메모까지 든 커밋에서: 테스트 913 + 건너뜀 1, 파일 19개 — b2 끝보다 열둘 늘었다: C6 셋 · C3 넷(T8 의 문구 시험 포함) · C2 다섯. 보통 40 검증 통과). 그 뒤의 커밋은 이 줄을 고친 것뿐이다(문서만).

### b3-4 · b3-5 ① — 초과 위험 과정의 틀과 교통의 장부 (2026-11-20 밤, 덩어리 `h1`. 브랜치 `wf/causality-h1` → `wf/causality`, 시작점 `0dff725` = b3-3 끝에 주 브랜치(설계 개정판)를 받은 자리 — `src/`·`scripts/`·`tests/` 는 b3-3 끝 `b43f55e` 와 한 글자도 같다)

커밋: 틀 `5357f83` · 교통 장부 `cb91aa7` · 한 교대 6건을 세는 법 `8a4d077` (+ 이 메모). **셋 다 해시 불변이다** — 법칙은 하나도 등록하지 않았고(`world/laws/index.ts` 는 빈 모음), 사건을 만드는 것이 하나도 없다. 장부를 읽는 곳은 측정(`scripts/hazstats.ts`)뿐이다.

#### 결과 불변 확인

- 해시 목록 123줄이 b3-3 끝(`out-c2/hash.txt`)과 **diff 0** — 틀 커밋 뒤(`h1/hash-a1/`)·장부 커밋 뒤(`h1/hash-b1/`)·마지막 코드 커밋 뒤(`h1/hash-c1/`) 각각. 줄마다 `report.hash`·보고서 JSON 의 FNV·기록 수라, `drift` 의 난수 호출 수(구간마다 한 번)도 그대로다(시험 '평소의 도로'가 한 번 더 센다: 혼잡을 다시 계산할 때마다 `rngTraffic.range` 가 구간 수 257 만큼만 불린다).
- **한 프로세스에서 시드 A 다음에 돌린 B 의 해시 = B 만 돌린 것**: `h1/ab.mts`(여섯 쌍 — 보통 S39 → S3 · 홍수 S1 → S2 · 지진 S0 → 태풍 S1 · 강제 `traffic/tree` S3 → S0 · 극한 S7 → 강제 `collapse/landslide` S2 · 강제 `traffic/pileup` S1 → 보통 S17)이 모두 해시 목록의 값과 같다(`AB_SAME`). 시험은 `vi.resetModules()` 로 모듈 캐시를 새로 만든 두 그래프에서 견준다(홍수 + 가스 폭발 강제 S4 를 혼자 / S9 다음에).
- 바뀐 것은 **기록의 원인 간선**뿐이다: 교통 모델이 놓은 장애물(공사·고장 차량·낙하물)에도 `Obstacle.ev` 가 생겨, 그것을 알리는 보고(부대·시민 제보)와 그 앞에서 되돌아선 부대의 ROUTE_BLOCKED 가 그 알림 기록을 원인으로 갖는다(b3-3 까지는 건물 잔해만). `--json` 의 `metrics` 가운데 원인 간선에서 나오는 값(세계 원인·`fromWorld`·확산)이 조금 늘 수 있다 — 아래 수치.

#### 실제 이름과 자리 (h2~h8 이 쓴다)

1. **`types.ts`** "세계 상태와 신호" 소절 끝의 새 소절 "초과 위험 과정": `HazardLawId`·`HzWhat`·`HzSrc`·`HzCell`(`done`)·`HzWait`·`HzNote`·`HzState`·`PlaceExpo`(`pipeThr`), 인터페이스 합치기로 `WorldState.hz`·`expo`·`sills`·`spans` · `ZoneState.at?` · `Signal.mag` · `Incident.hz?`. `SignalKind` 끝에 `'quake' | 'blackout'`, `WorldTag` 끝에 `'struct'`(새 줄). **`Scene.wear` 는 I2 준비 단계가 이미 넣어 둔 칸**(같은 모양 — "교대 간 지속" 절)이라 다시 넣지 않았다. 객체 모양: `initWorld`·`signal`(`mag: s.mag ?? 0`)·`createIncident`(`hz: undefined`)의 리터럴. `kit.baseScene` 의 `wear: undefined` 는 그 칸을 쓰기 시작하는 b3-8 이 넣는다(§7 표).
2. **`world/hazard.ts`**(등록이 없는 파일. `chain`·`world/state` 와 `incidents`·`engine`·`types` 의 형만 import): `CSQ_SPAWN_CAP`(6 — `consequence.ts` 가 다시 내보낸다) · `HZ { HOLD 60, PARENT_SHARE 1/3, ORPHAN_CAP 3, ROOT_MAX 2, SRC_MAX 3, LATE 150 }` · `HzPart` · `HazardLaw` · `registerHazard`(등록을 거두는 함수를 돌려준다. 같은 id 면 그 자리의 법칙을 바꾼다) · `hazardLaws`·`hazardLabel` · `tickHazards` · `hazardImpulse(sim, law, target, dH, part, delay = 0)` · `hazardCell` · `ruleLoad(sim, rule?)` · **`hazardRoom(sim, law, parent, skip = null)`**.
   - 한 교대 6건(`hazardRoom` ⑤)은 `chain.chainedInShift` + 기다리는 줄이다 — **`chainedInShift` 가 법칙 사건(`Incident.hz`·예약의 `opts.hz`)을 부모가 없어도 센다**(아래 "다르게 한 곳" 14).
   - `tickWorld` 의 1초 블록: `'tick'` 규칙 → `tickHazards` → `recoverWorld`. `consequence.spawnRoom` 의 전체 상한은 `ruleLoad(sim) ≥ CSQ_SPAWN_CAP`(`world.spawned` 는 `csq-spawn` 흐름의 순번으로만 남는다).
   - 흐름 이름: 문턱 `hz:<법칙>:<대상>:<n>`(once 법칙은 `hz:<법칙>:<대상>`) — 첫 값이 `thr = −ln(1 − u)`, 둘째 값이 `u2`. 사건 `hz-spawn:<법칙>:<대상>:<n>`.
   - **`law.spawn` 이 받는 `cell` 은 넘은 그 문턱의 것**(`n`·`u2`)이다. 기다리던 줄을 다시 볼 때는 그 번호의 흐름을 다시 뽑아 만든 사본을 준다(once 가 아닌 법칙의 실제 칸은 이미 다음 문턱으로 넘어가 있다).
   - `world.log` 의 줄: 예약마다 `{ rule: 법칙 id, t, ev: cause, inc: parent ?? −1, made: −1, depth }` — `tickIncidents` 가 `made` 를 채운다(b2 그대로). `Incident.csq` = 법칙 id, `Incident.hz` = `{ law, target, at, src }`(`at` = 예약의 `at` — 미룬 충격이면 미룬 시각, 기다리던 줄이면 자리가 난 시각).
3. **`world/laws/index.ts`**(빈 모음 — 차례의 주석만) · `engine.ts` 가 `import './world/rules'` 다음 줄에 `import './world/laws'`.
4. **`incidents.ts`**: `SpawnOpts.edgeId`·`causes`·`hz`, 발생 기록의 `causes` = `[cause, ...opts.causes]`, `tickIncidents` 가 꺼낸 예약이 `opts.hz` 이고 그 건물이 `placeGone` 이면 `'expired'`, **`DroppedChain.csq`**(버린 것이 규칙·법칙의 것이면 그 이름 — `consequence`·`hazard`·`tickIncidents` 가 채운다. 이야기 연쇄의 거절에는 없다).
5. **`world/state.ts`**: `initWorld` 의 리터럴에 `hz`·`expo`·`sills`·`spans`, `zoneOfPlace` = `zoneOfXY(건물 가운데)`.
6. **`traffic.ts`**(b3-5 ①) — `TrafficState` 의 새 칸: `driftAt` · `base` · `exOwn`·`exBump`·`exQueue`·`exDiv`·`excess` · `divert`·`divertBy`(**자리만 — 0 · −1. 채우는 것은 b3-5 ②**) · `closeEv`·`closeInc`·`slowEv`·`slowInc`·`levelEv` · `bumps: BumpRow[]`·`nextBumpId` · `qBy`·`qEv`·`qInc` · **`parts: RoadPart[]`·`partAt`**(구간마다의 몫 목록 — 아래 "다르게 한 곳" 10). `jams[k].ev`, `crowds[k].bump`. 내보낸 것: `noteRoadCause(sim, edge, 'close' | 'slow' | 'level', ev, inc = −1)` · `noteBump`·`unnoteBump`·`addBump`·`removeBump` · `roadParts(sim, edge, out)` · `roadFlow` · `canBlock(sim, e, dry = false)` · `BumpRow`·`RoadPart` · 상수 `DIV_MAX`(1.0)·`LEVEL_EX`(0.8).
   - `drift` 의 끝에서 `ledger(sim, tr, jam, neck, src, ring1, q0)` 가 장부를 다시 적는다(혼잡·밀림·난수를 읽기만 한다). 뿌리의 두 갈래는 `kind[e]`(0 뿌리 아님 · 1 평소의 뿌리 = 닫히지 않았고 `slow < 1` 이며 `p0 ≥ 2.4` · 2 원인이 있는 뿌리), `p0 = baseCong × tod × trafficMul + 불법 주차 0.4`.
   - 원인 있는 뿌리의 주인: 닫힘(`closeEv`) → 감속(`slowEv`) → 정체(`jams[k].ev`) → 한 차로 장애물(`Obstacle.ev`, 주인 사건은 잔해면 그 기록의 원인이 가리키는 사건) → 얹은 혼잡(그 구간을 담은 가장 큰 `bumps` 줄).
   - **장부를 쓰는 자리**(모두 기록 id 를 담기만): 쓰러진 나무(닫힘 = `I.blockEv` · 감속 = `I.rootEvent` — `createIncident`) · 교통사고의 감속(`createIncident` 끝, 발생 기록 다음 — `type === 'traffic' && I.blockedEdge ≥ 0`) · 사고 구간 전면 통제(`sceneManager` 6번 블록) · 다중 추돌·산사태의 `onCreate` · X6 `blockRoad` · 건물 잔해의 전면 통제(`rules/structure.ts` — 주인 사건 = 신호의 사건) · 교통 모델의 전면 공사·낙하물과 그 밖의 장애물(`announce` 가 `Obstacle.ev` 를 적고 전면이면 닫힘의 장부에도) · 정체(`emit` 의 반환값) · 행사 인파(`noteBump(…, 0)`) · 재난의 통제(`closeEdge` — `emit` 의 반환값) · 태풍 정전(`lightsOut` 의 `tell` 반환값 → `noteBump(모든 구간, 0.4, ev, 1)`, id 는 **`DisasterState.darkBump`**).
7. **`disaster.ts`**: `detour` 는 이름을 남기고 `traffic.canBlock` 을 부른다 · **`roadSill(sim, d, e)`**(export — 지금은 `d.thr[e.id]`. 첫 인자는 아직 쓰지 않는다: N9 가 지하차도 구간의 문턱을 `sim.world` 에서 읽을 자리) · `floodRoads` 가 그것으로 읽는다.
8. **측정 도구**: `scripts/metrics.ts` 의 지표 줄이 열 줄이 됐다(끝에 `hazard:`) · `metrics.hazard = { natural, byLaw, parented, orphan, rootMax, story, ruleMade, queued, waited, dropped { depth, cap, late, expired, busy }, holes, gain, maxMadeInShift, maxCausalInShift }` · `hazardShift(sim, probe)`·`HAZARD_LAWS` · 관문(`checkMetrics` — 늘): `holes = 0` · 교대마다 `natural + ruleMade ≤ CSQ_SPAWN_CAP` · 이야기 연쇄 + 법칙 사건 ≤ `CHAIN_SHIFT_MAX` · `rootMax ≤ HZ.ROOT_MAX`. `TAG_SYS` 의 `struct → building`, `S(I)` 의 `wear`: `cause === 'shock'` 이면 `building`, 아니면 `carry`. `runWithProbe(sim, maxTicks, each?)`.
   - **`scripts/hazstats.ts`**(`sweep --hazard`, `--json` 이면 `hazard` 칸): `HazProbe`(매 틱 `tick()` — 교통 모델이 혼잡을 다시 계산한 틱에만 도로를 읽는다)·`sumHaz`·`hazLines`·`hazJson`·`roadSurface(sim)`(L1 의 `S`). 줄 둘: `hazard-laws:`(법칙마다 칸 수·넘은 횟수·사건이 된 수·교대 끝에 기다리던 줄, `holes`) · `hazard-road:`(노출량 `Σ_e ∫ x·V·S·ℓ dt` 를 네 몫으로 · **`unledgered`** = 기록 없는 몫의 노출량 · 가중 없는 `raw` 구간·초 · 초과가 있던 구간·닫힌 구간의 표본당 수 · 갈래별). 뒤 단계가 더할 줄은 그 파일 머리에 적었다.
9. **시험**: 새 파일 `tests/hazard.test.ts` 26개(틀 20 — 가짜 법칙으로, 대부분 `tickHazards` 만 · 장부 6), 20초쯤. 가짜 법칙을 넣는 동안에는 등록된 법칙을 모두 치워 둔다(`withLaws` — 뒤 단계가 진짜 법칙을 등록해도 흔들리지 않게). `tests/causality.test.ts` 에서 고친 것: '요약 모양'(열 키) · b2 의 `placeState`(`toMatchObject`)·전체 상한(`world.log` 에 사건이 된 줄을 넣어 `ruleLoad` 를 채운다 — 예약을 빼면 자리가 돌아오는 것도)·거절 기록의 `csq`·세계 상태의 처음 값(`hz.cells`·`expo`·`sills`·`spans`) · b3-3 의 장애물 기록(교통 모델이 놓은 것도 알림 기록을 갖는다).

#### 본문과 다르게 한 곳

1. **부모의 몫은 같은 주인 사건의 몫을 합쳐 본다**(`hazard.parentOf`). 본문은 "주인 사건이 있는 가장 큰 몫 — 그 몫이 전체의 1/3 이상일 때만"(몫 하나)인데, 통제 하나는 한 구간에 `queue` 와 `divert` 두 몫으로 걸린다 — 0.3 + 0.3 이 0.4 짜리 정체와 겹치면 몫 하나로는 부모가 없지만 그 사건의 몫은 60% 다. `cause`(가장 큰 몫의 기록)와 구멍 판정(몫 하나가 1/3 이상이고 기록이 없다)은 본문 그대로 몫 단위다.
2. `hazardRoom` 의 넷째 인자 `skip`(다시 보는 기다리는 줄 자신 — 본문의 "그 줄 자신을 빼고 센다"). ④ 한 뿌리의 가지에는 법칙 사건의 자식도 든다(뿌리를 끝까지 거슬러 올라가 센다).
3. 한 주기에 한 대상은 문턱을 하나만 넘는다(넘친 몫이 다음 문턱보다 커도 다음 주기에 넘는다 — 그 대상이 그 주기에도 초과가 있을 때만).
4. `tickHazards` 가 첫 줄에서 돌아올 때(실제로 사건이 된 수 ≥ `CSQ_SPAWN_CAP`) 기다리던 줄을 `'cap'` 으로 버린다(줄이 남아 `ruleLoad` 를 채운 채 교대가 끝나지 않게).
5. 모든 몫의 기록이 없어 사건을 만들지 않은 넘음은 `holes` 에만 세고 `gen.dropped` 에는 넣지 않는다(맞는 까닭의 갈래가 없다).
6. 미룬 충격(`delay > 0`)에서 `spawn` 이 그 자리에서 `null` 이면 기다리는 줄에 넣고 `until − hold`(= 미룬 시각) 전에는 내지 않는다 — `HzWait` 에 칸을 더하지 않았다. 미룬 예약의 `when` 은 `law.spawn(…) !== null && 그 건물에 열린 사건이 없다`(전소·전체 붕괴는 `tickIncidents` 의 한 줄이 본다).
7. **구간마다의 몫 목록을 `drift` 가 굳혀 둔다**(`tr.parts`·`partAt`·`roadParts`). 본문은 L1 이 `exOwn`·`exBump` 를 읽을 때 항·줄마다 다시 가르게 돼 있는데, `drift`(틱 5k)와 세계 틱(5k + 1) 사이에 장애물·정체·`bumps` 줄이 사라지면 몫과 내력이 어긋난다. 주기마다 새 배열이다(앞 주기의 몫을 쥔 쪽이 뒤에서 바뀌지 않게). `bumps` 줄의 합보다 큰 `e.bump` 는 기록 없는 몫(`ev −1`, `'crowd'`)으로 남긴다 — 장부 없는 혼잡이 구멍으로 드러나게.
8. **뿌리가 바뀔 때**(앞 뿌리가 더는 뿌리가 아니라 다른 원인 있는 뿌리로 옮길 때)는 새 뿌리의 주인이 −1 이어도 그 값으로 바꾼다. 본문의 "뿌리의 값이 −1 이면 앞의 값을 지우지 않는다"는 같은 뿌리일 때만 지킨다(다른 뿌리의 밀림에 앞 뿌리의 기록을 남기면 틀린 내력이다). 한 다리 건너 자라는 구간은 많이 밀린 이웃 가운데 평소의 밀림(`qBy −1`)이 하나라도 있으면 평소의 것으로 둔다(뿌리에 닿은 구간과 같은 규칙).
9. **`'level'` 장부를 쓰는 자리는 넣지 않았다**(`disaster.floodRoads` 의 `noteRoadCause(…, 'level', …)` 와 `d.levelEv`): §3.6b 의 "장부를 쓰는 자리" 목록에는 있지만 §5 표와 덩어리 표가 b3-12(h7)의 일로 적었다(그 단계의 "홍수 20교대 사건 수 기준 × 1.1" 로 재야 한다). 틀은 있다 — `levelEv`·`noteRoadCause` 의 `'level'`·`exOwn` 의 `LEVEL_EX` 항·몫 `'level'`(시험이 손으로 건다).
10. **`createIncident` 의 `opts.edgeId` 를 먼저 보는 갈래는 넣지 않았다**(§5 표의 b3-6 — L1 과 함께). `SpawnOpts.edgeId` 칸과 `traffic.canBlock` 은 있다.
11. `announce` 가 스스로 `Obstacle.ev` 를 적는다(본문은 "기록 id 를 돌려주게 해서"). 교대 시작 때 놓이는 불법 주차에는 `ev` 가 없다(알림이 없고, 병목 0.4 는 평소 수준에 든다).
12. `metrics.hazard` 에 `maxMadeInShift`·`maxCausalInShift` 두 칸이 더 있다(관문은 교대마다의 최댓값을 본다). `waited` 는 틱 표본(Probe)이 본 기다리는 줄의 수라 `--no-metrics` 면 `null`. `ruleMade` = `csq` 가 있고 이야기 연쇄도 법칙도 아닌 사건.
13. `TrafficState.driftAt` 은 틀 커밋에 먼저 넣었다(12초 주기의 법칙이 그것을 본다).
14. **이야기 연쇄의 `canChain` 도 법칙 사건을 센다**(`chain.chainedInShift` — `8a4d077`). 본문은 법칙 쪽(`hazardRoom` ⑤)만 "이야기 연쇄 + 부모 없는 법칙 사건 ≥ 6" 을 보게 했는데, 그러면 부모 없는 법칙 사건 셋이 먼저 나고 이야기 연쇄 여섯이 뒤에 올 때 인과로 난 사건이 한 교대 9건이 된다 — §4 의 관문 "이야기 연쇄 + 법칙 사건 ≤ 6" 을 틀이 스스로 지키지 못한다. 상한의 값(한 사슬 3건 · 한 교대 6건)은 그대로이고 세는 것만 넓혔다: 인과로 난 사건은 어느 쪽이 먼저 나든 같은 6건을 나눠 쓴다(§9 의 기본값 "상한의 안쪽"). 법칙이 없으면 `hz` 가 없어 예전과 같은 수다. N8·N9 의 `spawnConsequence`(부모 있는 예약)도 같은 수를 본다.

#### 수치

기준 파일은 같은 scratchpad 의 `wf-causality/h1/`(해시 목록 `hash-a1/`·`hash-b1/` · 노출량 `haz1/`(`haz.sh`) · 관문 `gates/`·`check-1.log` · 시간 `timing.txt` · 보통 60 `normal60.json` · 도구 `ab.mts`·`owners.mts`·`haz.sh`·`timing.sh`). **뒤 덩어리의 "전"은 여전히 `out-c2/` 다**(이 덩어리는 결과를 바꾸지 않았다 — h2 가 b3-5 ② 뒤에 새 기준을 잰다).

- **보통 60 `--json`**: `reportHash 1812bf3b` 그대로이고 `out-c2/normal60.json` 과 다른 칸은 셋뿐이다 — `chain.worldLinks` 69 → 78 · `replan.fromWorld` 71 → 80(교통 모델이 놓은 장애물의 알림 기록이 그 앞의 ROUTE_BLOCKED·제보의 원인이 됐다) · 새 칸 `metrics.hazard`(natural 0 · 이야기 연쇄 4 · holes 0).
- **도로의 노출량**(`sweep N --hazard`, 교대당 — 우회 몰림이 아직 없다: 넷째 몫은 0):

| 조건 | 노출량 `Σ x·V·S·ℓ dt` | 자기(한 차로·정체) | 얹은 혼잡 | 밀림 | 우회 | **장부 없는 초과** | 가중 없는 초과(구간·초) | 초과가 있는 구간 / 표본 | 닫힌 구간 / 표본 |
|---|---|---|---|---|---|---|---|---|---|
| **보통 12** | **16,941.8** | 1,399.0 (정체 1,070.8 · 한 차로 328.2) | 710.4 (인파) | 14,832.4 | 0 | **0** | 14,306.8 | 28.5 | 0.6 |
| 어려움 8 | 27,164.9 | 1,525.5 | 570.7 | 25,068.7 | 0 | 0 | 22,763.9 | 37.5 | 1.2 |
| 극한 8 | 33,970.3 | 1,639.8 | 590.0 | 31,740.5 | 0 | 0 | 29,903.8 | 46.4 | 1.6 |
| 태풍 6 | 57,520.0 | 1,596.9 | 17,234.7 (꺼진 신호 16,554.0 · 인파 680.7) | 38,688.4 | 0 | 0 | 43,254.0 | 70.5 | 1.9 |
| 홍수 6 | 36,101.6 | 1,248.2 | 607.8 | 34,245.7 | 0 | 0 | 30,119.9 | 51.4 | 2.8 |
| 지진 6 | 54,689.1 | 1,571.3 | 781.1 | 52,336.7 | 0 | 0 | 46,312.0 | 63.0 | 2.8 |
| 산불 6 | 23,434.7 | 1,303.3 | 583.6 | 21,547.8 | 0 | 0 | 20,271.0 | 36.1 | 1.4 |
| 해일 6 | 17,243.9 | 1,313.9 | 599.9 | 15,330.0 | 0 | 0 | 15,815.6 | 32.8 | 1.0 |
| 강제 `traffic/tree` 8 | 21,097.7 | 1,575.3 | 550.8 | 18,971.5 | 0 | 0 | 18,104.6 | 35.1 | 0.9 |
| 강제 `traffic/pileup` 8 | 20,221.8 | 1,492.9 | 590.8 | 18,138.1 | 0 | 0 | 17,628.4 | 34.6 | 0.9 |
| 강제 `collapse/landslide` 8 | 19,242.7 | 1,608.6 | 568.6 | 17,065.4 | 0 | 0 | 17,112.7 | 32.5 | 0.8 |
| 강제 `collapse/gasblast` 8 | 24,911.1 | 1,826.9 | 880.1 | 22,204.1 | 0 | 0 | 21,385.3 | 36.1 | 1.0 |

  - 읽을 것: ① 장부 없는 초과는 열두 조건(94교대) 모두 0 이고 `world.hz.holes` 도 0 이다. ② 보통 교대의 가중 없는 초과는 14,307 구간·초 — 조사 때의 어림(혼잡 값의 차로 잰 약 18,000)과 같은 크기다. ③ **초과의 88% 가 밀림이다**: 그 뿌리를 가르면(`h1/owners.mts`, 보통 12) 주인 사건이 있는 밀림 47.2%(거의 다 평소 교통사고의 현장 감속) · 주인 사건이 없는 밀림 40.4%(정체·공사·낙하물이 뿌리) · 정체 6.3% · 인파 4.2% · 한 차로 1.9%. ④ 보통 12교대에는 수요만으로 꽉 찬 구간(평소의 뿌리)이 없었다 — "평소의 밀림"은 0 이다(교통 손잡이가 높을 때의 갈래다 — 시험이 손으로 만든다). ⑤ 태풍의 꺼진 신호는 전 구간에 0.4 씩 120초라 그것만으로 보통 교대 전체만큼의 노출량이다(L1 의 법칙 상한 3 이 그 교대를 묶는다 — h2 가 본다).
- **교대당 시간**(`sweep 12 --no-metrics`, 전 `c2/` 와 번갈아 세 번 — `h1/timing.txt`): 사용자 CPU 전 34.5 · 33.2 · 33.0초 / 뒤 33.2 · 34.3 · 33.3초(평균 33.6 / 33.6 — ×1.00), 교대당 1,082 · 1,017 · 1,032 / 1,046 · 1,073 · 1,046ms(+1%). §4 의 "틀과 교통의 몫 × 1.03 이하" 안이다(장부는 12초에 한 번 구간 257개를 세 번 훑는 것이고, 법칙이 없는 `tickHazards` 는 첫 줄에서 돌아온다).
- **관문**: `npm run check` 통과(`cb91aa7` 과 마지막 코드 커밋 `8a4d077` 에서 각각) — 테스트 939 + 건너뜀 1(파일 20개 — b3-3 끝의 913 에 `tests/hazard.test.ts` 26개), 보통 40 검증 통과(사건 565 · 성공 74% · 대응 지연 4% · 실패+미해결 11% · 한계 시간 0 · 방치 1 · 교착 0 · 잊힘 0 · C1~C5 0 · 최대 깊이 2). `sweep 40 --diff hard --check`(사건 713 · 성공 51% · 한계 시간 6 · 방치 7 · 출동 없음 1) · `--diff extreme --check`(871 · 28% · 19 · 26 · 7) · 재난 다섯 × 12 `--check`(태풍 279건 · 홍수 246 · 지진 257 · 산불 199 · 해일 224) 모두 통과(`cb91aa7` 에서. 어려움·극한 40 은 마지막 코드 커밋 `8a4d077` 에서도 다시 통과 — 같은 수치) — **수치가 b3-3 끝의 관문과 한 건도 다르지 않다**. `hazard` 줄은 모든 조건에서 natural 0 · holes 0 이고, 이야기 연쇄는 보통 40 에 3건 · 어려움 14 · 극한 42(교대 최대 6 — 사용자 결정의 상한 그대로). 화면은 고치지 않았다(`vite build` 통과 — `engine.ts` 의 import 가 한 줄 늘었다).

#### h2 에게 (이어받을 자리)

- **우회 몰림(b3-5 ②)**: `drift` 의 밀림 계산 다음에 `tr.divert`·`tr.divertBy` 를 채우고 `target` 에 `min(DIV_MAX, divert)` 를 더한다(본문 (가) — `detours`·`detourSig`·`staticCost`·`LANES`·`DIV_K` 는 그때 더한다). `ledger` 는 이미 그 두 배열을 읽어 `exDiv` 와 `'divert'` 몫(주인 = `closeEv[divertBy]`·`closeInc[divertBy]`, `ref` = 닫힌 구간)을 낸다 — 지금은 늘 0 이다. 그때 고칠 시험: `tests/hazard.test.ts` 의 "우회 몰림은 b3-5 ② 가 채운다" 줄(`exDiv`·`divert`·`divertBy` = 0 · 0 · −1)과 실제 교대 시험의 `r.div === 0`. 쓰러진 나무의 `cong + 0.7` 은 그대로 있다(`createIncident`).
- **L1(b3-6)**: `world/laws/road.ts` 에 `registerHazard({ id: 'roadCrash', every: 12, once: false, cap: 3, scan, spawn })`, `laws/index.ts` 에 `import './road';`. `scan` 은 `tr.excess[e] > 0` 인 구간마다 `roadParts(sim, e, buf)` 의 몫(`x`)에 `A_ROAD × V × S × ℓ` 를 곱해 `put(e, parts)` 하면 된다 — 몫의 `ev`·`inc`·`what`·`ref` 는 `HzPart` 와 같은 뜻이다. `V`·`S`·`ℓ` 의 식은 `hazstats.ts` 의 `sampleRoad`·`roadSurface` 와 같아야 한다(그 파일이 법칙 파일의 함수를 import 하게 하면 한 곳이 된다 — 스크립트가 법칙 파일을 import 하는 것은 §3.4 의 규칙(src/sim 안)과 무관하다).
- **`A_ROAD` 의 첫 어림**: 보통 12교대의 노출량이 16,942(우회 몰림 없이)라 교대당 0.35건이면 `2.1e-5`(본문의 `2.5e-5` 와 같은 크기). 우회 몰림을 넣은 뒤 `sweep 12 --hazard` 로 다시 잰다.
- **부모가 붙는 비율**: 보통 12교대 노출량의 47% 가 "주인 사건의 몫이 1/3 이상"이다(거의 다 평소 교통사고의 현장 감속에서 온 밀림 — `h1/owners.mts`). L1 이 낸 사고의 절반쯤은 근처에서 먼저 난 사고를 부모로 갖는다는 뜻이다 — §4 의 "부모가 있는 것이 1/3 이상"은 넉넉하고, 한 뿌리의 가지(`ROOT_MAX` 2)와 사슬 길이에 걸리는 수를 `hazard.dropped.depth` 로 본다.
- **개입 시험(§6 I1-b 10)**: 장부는 손대지 않고 상태만 되돌리면 다음 `drift` 가 스스로 비운다(시험 '닫힌 구간과 밀림의 내력'이 그 길을 본다 — 닫힘·감속을 되돌린 뒤 이웃의 밀림이 0 이 될 때까지 `qEv` 가 그 통제 기록이다).
- **진짜 법칙을 등록하면 고칠 시험**: `tests/causality.test.ts` '세계 상태는 걸린 규칙이 바꾼 것 말고는 처음 값'의 `hz.cells`(법칙이 걸리면 칸이 생긴다 — 그 교대에 초과가 있었으면), `tests/hazard.test.ts` 의 틀 시험은 `withLaws` 가 등록된 법칙을 치워 두므로 그대로다.
- **I2 에게**: 지난 교대의 복구 통제(`closedReason 'repair'` — I2 단계 4·6)는 `initTraffic` 앞에서 닫으므로 `noteRoadCause` 가 아직 듣지 않는다(교통 모델이 없다). `initTraffic` 뒤에 그 구간들의 닫힘을 장부에 적어야 구멍이 되지 않는다(원인 기록 = 이어받은 상태의 요약 기록).

### b3-5 ② · b3-6 — 우회 몰림과 L1 `roadCrash` (2026-11-20 밤, 덩어리 `h2`. 브랜치 `wf/causality-h2` → `wf/causality`, 시작점 `976092f` = h1 끝)

커밋: 우회 몰림 `354cf22`(**바뀜** — 닫힌 구간이 있는 모든 교대) · `createIncident` 의 `opts.edgeId` `de176e8`(상태·판단 — **불변**) · L1 `a44f22a`(법칙 — **바뀜**: 그 법칙의 사건이 난 교대) · 정해진 시드의 시험 둘 `b2c90ab`(시험과 주석만) (+ 이 메모). **사건을 만드는 법칙이 처음 생겼다** — 지금 등록된 법칙은 L1 하나다(`world/laws/index.ts` 의 `import './road';`).

#### 해시로 본 것 (§5 의 "커밋을 둘로 나누고 확인하는 법")

- **우회 몰림(`354cf22`)**: 해시 목록 123줄 가운데 **122줄이 바뀌었다**(b3-3 끝 `out-c2/hash.txt` 와 — 바뀌지 않은 한 줄은 보통 S22: 교대 내내 닫힌 구간이 하나도 없었다). 본문의 "닫힌 구간이 있는 모든 교대"대로다. 난수 호출 수는 그대로다(시험 '평소의 도로'가 센다 — 혼잡을 다시 계산할 때마다 `rngTraffic.range` 가 구간 수만큼만).
- **`opts.edgeId`(`de176e8` — 상태·판단 커밋)**: 해시 목록 123줄이 우회 몰림 뒤(`h2/out-div/hash.txt`)와 **diff 0**(`h2/hash-edge/` — `HASH_SAME`). 구간을 정해 주는 호출이 아직 없다.
- **L1(`a44f22a` — 법칙 커밋)**: 123줄 가운데 **41줄이 바뀌었고 그 41교대 모두에 `csq === 'roadCrash'` 인 사건이 있다. 법칙 사건이 없는 82교대의 해시는 그대로다**(`h2/lawhash.sh` → `h2/lawhash-l1/summary.txt`: 바뀌었는데 법칙 사건이 없는 교대 0 · 법칙 사건이 있는데 바뀌지 않은 교대 0. 그 123교대에 법칙 사건 52건 · 상한·교대 끝으로 버린 넘음 57 · 구멍 0). 문턱을 넘었지만 버려진 교대(기록도 난수도 남기지 않는다)는 한 글자도 바뀌지 않았다.

#### 실제 이름과 자리 (h3~h8 이 쓴다)

1. **`traffic.ts` — 우회 몰림**(§3.6b (가)): 상수 **`DIVERT { K: 0.8, MAX: 1.0 }`**(본문의 `DIV_K`·`DIV_MAX` — 한 객체다. h1 이 내보내던 `DIV_MAX` 는 없앴다) · `LANES { highway 3, arterial 2, street 1, local 0.6 }` · `LEVEL_EX`(그대로). `TrafficState.detours: Map<닫힌 구간, 우회로의 구간들>`·`detourSig`(닫힌 구간 번호를 이은 글자 — 같으면 우회로를 다시 구하지 않는다).
   - `staticCost(city)`(모듈 함수 — `(len / speed) × (1 + (baseCong − 1) × 0.5)`, 지도 열쇠의 캐시. `initTraffic` 이 교대의 도로가 처음 그대로일 때 한 번 만들고 `throughFlow`·`detourOf` 가 함께 쓴다) · `detourOf(city, cost, c)`(자기 버퍼의 다익스트라 — 닫힌 구간은 지나지 않는다. 길이 없으면 빈 배열) · **`detourLoad(sim, tr)`**(`drift` 안: 밀림 계산 다음·혼잡의 목표값 앞 — `tr.divert`·`tr.divertBy` 를 지금 닫힌 구간에서 다시 채운다).
   - `target = clamp(press + 1.2 × queue + min(DIVERT.MAX, divert), 1, 3)`. 장부(`ledger`)는 h1 이 넣은 대로 `exDiv` 와 `'divert'` 몫(주인 = `closeEv[divertBy]`·`closeInc[divertBy]`, `ref` = 닫힌 구간)을 낸다.
   - 쓰러진 나무의 "이웃 구간 `cong + 0.7`" 한 줄은 지웠다(`createIncident`).
2. **`incidents.ts` — 사고가 난 구간이 막히게**(§3.6b (다)): 교통사고 블록이 `opts.edgeId` 를 먼저 본다 — 그 구간이 **이 교차로에 닿아 있고** · 닫히지 않았고 · 고속도로가 아니며 · 다른 열린 사건의 `blockedEdge` 가 아니고 · `traffic.canBlock(sim, e)` 를 지나면 `I.blockedEdge`. 아니면 지금 규칙(간선 먼저 · 번호 작은 것)인데, **구간을 정해 준 사건(법칙이 낸 사고)은 지금 규칙으로 고를 때도 "남이 잡지 않았다 · `canBlock`" 을 함께 본다**(아래 "다르게 한 곳" 3). 평소 추첨·재난·시험처럼 `edgeId` 를 주지 않는 호출은 한 글자도 바뀌지 않는다.
3. **`world/laws/road.ts`** — L1: `registerHazard({ id: 'roadCrash', label: '몰린 길의 사고', every: 12, once: false, cap: ROAD.CAP, scan, spawn })`.
   - 상수 **`ROAD { A: 4.2e-5, X_BIG: 1.2, BUS3: 0.28, BUS2: 0.06, NIGHT: 1.2, CAP: 3 }`**(`A` = 본문의 `A_ROAD`. 시험이 `ROAD.A` 를 바꿔 쓴다 — `CAP` 은 등록할 때 한 번 읽히므로 바꿔도 듣지 않는다: 등록된 법칙 객체의 `cap` 을 고친다).
   - `roadSurface(sim)`(노면·시야 `S`) · `roadWeight(e, flow, S)`(= `V × S × ℓ` — `A` 를 곱하기 전). **`scripts/hazstats.ts` 가 이 둘을 가져다 쓴다**(가중의 식은 한 곳 — `hazstats.roadSurface` 는 다시 내보낸 것이다).
   - `scan`: `tr.excess[e] > 0` 인 구간마다 `roadParts` 의 몫 × `ROAD.A × roadWeight` 를 `put`. 사건·현장·장애물 목록·닫힌 까닭을 읽지 않는다(시험이 본문의 글자를 본다).
   - `spawn`: 자리 = 그 구간의 두 끝 가운데 `nodeFree`(시설 앞이 아니다 · 열린 사건이 없다 · **`gen.chain` 에 그 교차로의 예약이 없다**)인 교차로 — 둘 다 되면 닿은 구간이 많은 쪽, 같으면 번호 작은 쪽, 둘 다 안 되면 `null`(기다린다). 규모 = `speed ≤ 23` 이면 1(초과 ≥ 1.2 면 2) · 간선 2(≥ 1.2 면 3) · 고속 3. 변형 = `'std'`, 규모 2 이상이고 `cell.u2 < (규모 3 ? 0.28 : 0.06)` 이면 `'bus'`(규모 3). `edgeId` = 그 구간. 첫머리는 주된 몫의 갈래로(본문의 여덟 문구 그대로).
   - 발생 기록: `'{첫머리} — {교차로} 교차로.'`(`truth`, `causes` = 그 순간의 몫들의 기록). 측정 도구의 문구 규칙(`PHRASE`)에는 걸리지 않는다(시험 3 통과).
4. **측정**: `sweep --hazard` 에 `hazard-detour:` 줄(몰린 구간 수/표본 · 구간·초/교대 · 그 구간들의 혼잡 평균·최대 · 몰림이 상한에 닿은 비율), `--json` 의 `hazard.road.detour`. `hazard-laws:` 줄에 `roadCrash cells … crossed … made …` 가 나온다.
5. **시험**(`tests/hazard.test.ts` — 38개가 됐다, 30초쯤): 우회 몰림 2(우회로의 구간들에만·통행량의 비·상한·풀면 0·막다른 가지 / 나무·공사·낙하물이 같은 길을 막으면 같은 몰림) · `opts.edgeId` 1 · L1 9(등록과 가중 · ① 평소의 도로 · ② 적분의 식 · ⑧ 인파 + 꺼진 신호 · ⑥ 기다리는 줄 · ⑦-가 남이 잡은 구간 · ⑦·⑤ 나무 → 사고 → 사고와 도시 연결 · ③ 개입 시험 · 소스 글자). `tests/causality.test.ts` 에서 고친 것 둘: '세계 상태는 … 처음 값'(초과가 있던 구간에 `hz.cells.roadCrash` 칸이 생긴다 · `world.log` 의 `roadCrash` 줄만 `made ≥ 0`) · '상한에 걸려 잇지 못한 기존 연쇄'(법칙의 거절(`csq` 있음)을 빼고 본다).

#### 본문과 다르게 한 곳

1. **`DIV_K`·`DIV_MAX` 는 한 객체 `traffic.DIVERT { K, MAX }`** — 균형 손잡이를 재는 도구(`h2/divtune.mts`)와 시험이 값을 바꿔 쓸 수 있게. 값은 첫 값 그대로다(맞출 것이 없었다 — 아래 수치).
2. **`A_ROAD` = 4.2e-5**(첫 값 2.5e-5 의 1.7배). 까닭은 아래 "A_ROAD 를 맞춘 과정" — 넘은 문턱의 다섯에 하나(보통)가 교대 끝(150초 안 + 교대 시간을 넘긴 뒤)이라 버려지고, 쓰러진 나무 하나의 노출량이 조사 때의 어림(2,300~3,000)보다 작다(1,850).
3. **법칙이 낸 사고는 지금 규칙으로 구간을 고를 때도 `canBlock` 과 "남이 잡지 않았다"를 본다**(본문은 "조건에 걸리면 지금 규칙으로"). 지금 규칙의 `findRoute` 는 알려진 통제만 피하므로, 정해 준 구간이 조건에 걸려 지금 규칙으로 넘어간 사고가 그 교차로의 다른 구간을 잡아 — 본문이 (다)에서 막으려던 바로 그 꼴로 — 교차로가 끊길 수 있다. 조건을 지나는 구간이 없으면 그 사고는 길을 막지 않는다(`blockedEdge −1`). 또 정해 준 구간이 **그 교차로에 닿아 있을 때만** 잡는다(L1 은 늘 그렇게 주지만 다른 호출자가 엉뚱한 구간을 줘도 사건 자리와 통제가 어긋나지 않게).
4. **`spawn` 의 자리 조건에 "`gen.chain` 에 그 교차로의 예약이 없다"** 를 더했다. `tickIncidents` 는 한 틱에 예약 하나만 꺼내므로, 같은 주기에 이웃한 두 구간이 함께 문턱을 넘으면 둘째의 `spawn` 은 첫째 사고가 아직 사건이 되기 전에 불린다 — 조건이 없으면 한 교차로에 사고 둘이 열린다.
5. **규모를 정하는 초과 `x`** 는 `spawn` 이 받은 `total`(넘는 순간의 위험률 합)을 그 구간의 가중으로 나눠 되찾는다(`tr.excess` 를 다시 읽지 않는다 — 기다리던 줄이 뒤늦게 날 때는 그 구간의 초과가 이미 0 일 수 있다).
6. **개입 시험(§6 I1-b 10)의 얼리는 법**: 본문은 "틱 T 까지 돌린 뒤 다른 원인을 얼린다"인데, 시험은 **평소 사건·대형 사고를 처음부터 얼리고** 교통 사건만 T = 150초까지 돌린 뒤 그것도 얼린다. T 까지 평소 사건이 열려 있으면 그 사건들의 부대가 두 `Sim` 에서 다른 길로 달려(한쪽에만 나무의 통제가 있다) 현장 도착·전면 통제 시각이 갈리고, "그 원인이 올리던 구간"에 무관한 초과가 한쪽에만 얹힌다. 교통 사건(정체·공사·인파)은 남아 있어 B 에도 다른 원인의 초과와 그 꼬리가 있다. ③ 의 비교는 칸의 `H` 가 아니라 **쌓아 온 위험의 합**(`H` + 이미 넘은 문턱들 — 문턱은 (시드, 법칙, 구간, 몇 번째)의 함수라 다시 뽑아 셀 수 있다)으로 한다: 넘으면 `H` 가 문턱만큼 줄어 `H` 끼리는 견줄 수 없다. **④(보고서 문장에 나무 사건의 코드와 두 구간의 이름)는 하지 않았다** — 내력 문장은 b4 의 것이다(h8 이 그 시험에 한 줄 더한다).
7. L1 의 시험은 `tests/causality.test.ts` 가 아니라 `tests/hazard.test.ts` 에 두었다(h1 과 같은 갈래 — §7). 본문의 ②(통제를 풀면 `closeEv` −1 · 꼬리의 `qEv`)는 h1 의 장부 시험이 이미 보고 있어, L1 쪽은 적분의 식(`H = A × 초과 × 가중 × 12초`)과 "풀면 적분이 멎고 `H` 는 그대로"를 본다. ⑤(깊이 2 의 `'depth'`)는 ⑦의 사슬 시험이 함께 본다(같은 교대에서 실제로 걸린다).
8. **설계서의 "고칠 파일" 밖에서 고친 시험 둘**: `tests/sim.test.ts`(추격전 — 숨어든 납치의 판정) · `tests/methods.test.ts`(방법마다 쓰인 교대 — 표본에 W29). 둘 다 법칙이 정해진 시드의 흐름을 바꿔 드러난 것이고 판정·기준은 그대로다(아래 "관문과 시간").
9. `hazstats` 가 법칙 파일을 import 한다(스크립트 → `src/sim/world/laws/road.ts`). §3.4 의 규칙(`src/sim` 안의 다른 모듈은 법칙 파일을 import 하지 않는다)과는 무관하지만, 법칙이 늘면 스크립트가 법칙 파일을 `engine.ts` 보다 먼저 import 하지 않게 한다(지금은 `road` 가 차례의 첫 줄이라 어느 쪽이 먼저든 같다).

#### 우회 몰림의 크기 (`DIVERT` — 첫 값 그대로)

재는 법: `h2/divtune.sh <뿌리> <K> <MAX> 60`(보통 60교대의 평균 대응을 소수로 · TRAFFIC_DELAY 가 남은 사건 수 · 우회로 구간의 혼잡). 법칙을 넣기 전(`354cf22` 의 자리)에 쟀다.

| 보통 60 | 평균 대응 | TRAFFIC_DELAY | ROUTE_BLOCKED | 사건 | 성공+대응 지연 | 몰린 구간/표본 | 그 구간의 혼잡(평균 · 최대) | 상한에 닿은 비율 |
|---|---|---|---|---|---|---|---|---|
| 전(h1 끝 — 나무의 +0.7 있음) | 50.34초 | 24 | 44 | 846 | 80.3% | — | — | — |
| `K 0`(나무의 +0.7 만 뺌) | 50.30초 | 24 | 43 | 846 | 80.3% | 0 | — | — |
| **`K 0.8 · MAX 1.0`(첫 값 — 그대로 둔다)** | **50.66초(+0.32)** | **27(× 1.13)** | 39 | 848 | 79.6% | 2.02 | 1.96 · 3.00 | 24% |

- 목표(평균 대응 기준 +3초 안 · TRAFFIC_DELAY 기준 × 1.3 안)를 첫 값이 지킨다 — 대응 시간의 여유는 크지만(+0.3초) TRAFFIC_DELAY 는 × 1.13 이라 더 키우지 않았다. 닫힌 구간은 표본마다 평균 0.5개, 우회로는 닫힌 구간 하나에 평균 4.1구간이다(본문의 3.9~5.3).
- **재난 교대에서는 더 크게 듣는다**(닫힌 구간이 많다 — `out-c2/` → `h2/out-div/`): 홍수 20 의 평균 대응 81 → 87초(+6) · TRAFFIC_DELAY 28 → 35, 지진 20 은 97 → 98초인데 TRAFFIC_DELAY 12 → 28, 산불 76 → 78초 · 19 → 29, 해일 72 → 72초 · 9 → 15, 태풍 102 → 103초 · 13 → 12. 홍수는 우회로의 48% 가 상한에 닿아 있다(`hazard.road.detour.atCap` — 보통은 24%). 본문의 기준(보통 60)은 지켰지만 **홍수의 +6초는 §4 의 "우회 몰림만으로 +3초 이하"를 그 조건에서는 넘는다** — b3-12(홍수 20교대를 재는 단계)와 b5 가 `DIVERT.MAX` 를 볼 자리다(재난만 따로 줄이는 조건문은 넣지 않는다 — 닫힌 까닭을 가리지 않는 규칙이다).
- 한계 시간·방치·출동 없음(전 → 우회 몰림 뒤): 보통 3 → 3 · 어려움 7 → 7 · 극한 42 → 43 · 태풍 7 → 5 · 홍수 2 → 5 · 지진 32 → 25 · 산불 6 → 9 · 해일 1 → 0.

#### `A_ROAD` 를 맞춘 과정

재는 법: `sweep N --hazard` 의 `hazard-road:` 줄(노출량 `Σ_e ∫ x·V·S·ℓ dt`)과 `h2/treeexpo.mts`(사건 하나가 주인인 몫의 노출량), 그리고 `h2/lawstats.sh`(법칙이 실제로 낸 사건의 표 — `ROAD.A` 를 바꿔 가며).

- **노출량**(우회 몰림 뒤, 법칙 없이 — `h2/out-div/`): 보통 60교대 평균 **14,750**/교대(자기 1,211 · 얹은 혼잡 701 · 밀림 11,816 · **우회 1,021**) — h1 이 보통 12교대로 잰 16,942 는 앞쪽 시드가 무거웠다. 어려움 24,044 · 극한 37,292 · 태풍 61,379(꺼진 신호 17,555) · 홍수 45,011(우회 6,791) · 지진 62,208 · 산불 29,455 · 해일 19,351. 장부 없는 초과는 여덟 조건 모두 0.
- **사건 하나의 노출량**(`treeexpo.mts`, 강제 `traffic/tree` 10교대): 쓰러진 나무 **1,850**(우회 292 · 밀림 1,558 — 통제 146초) · 평소 교통사고 2,548(우회 145 · 밀림 2,403) · 다중 추돌 4,200 · 길을 막은 건물 화재 2,683. 본문의 어림 "간선의 전면 통제 한 번 2,300~3,000"보다 나무는 작다 — 빨리 치워진다.
- **넘은 문턱이 모두 사건이 되지는 않는다**: 교대 끝 150초 안과 교대 시간(1,200초)을 넘겨 이어지는 동안의 넘음은 `'late'` 로 버려진다 — 보통 60 은 다섯에 하나(넘음 36 → 사건 29 · late 7), 늦게까지 이어지는 교대일수록 커서 어려움 30 은 33 → 19 · 극한 30 은 52 → 22 다.
- **세기를 바꿔 가며**(보통 60 / 강제 `traffic/tree` 20 — 그 20교대에 나무 28~29그루):

| `ROAD.A` | 보통 60 의 `roadCrash` | 교대당 | 부모 있는 것 | 강제 나무 20 의 `roadCrash` | **나무를 원인으로 한 사고** |
|---|---|---|---|---|---|
| 2.5e-5 (첫 값) | 17 | 0.28 | 8 | 8 | 0 |
| 3.5e-5 | 22 | 0.37 | 13 | 10 | 0 |
| 4.0e-5 | — | — | — | 10 | 0 |
| **4.2e-5 (정한 값)** | **29** | **0.48** | **16** | **9** | **1** |
| 4.5e-5 | 30 | 0.50 | 15 | 10 | 1 |
| 5.0e-5 | — | — | — | 13 | 1 |
| 1.0e-4 | — | — | — | 20 | 2 |

- **정한 까닭**: 끝내는 조건 둘(보통 60 에 교대당 0.2~0.5건 · 강제 `traffic/tree` 20교대에 나무를 원인으로 한 사고 1~4건)을 함께 지키는 값이 4.0e-5 를 넘고 4.5e-5 까지뿐이었다(4.0e-5 는 나무 0건 · 4.5e-5 는 보통 교대당 0.50). 나무 한 그루가 사고로 이어질 몫은 `A × 1,850` — 4.2e-5 면 넘음 7.8%(사건으로는 5% 남짓: 본문의 목표 5~20% 의 아래쪽)이고, 그 20교대의 28그루에서 기대값은 1.5건쯤이다(실제 1건 — S11 의 사건 02 나무 → 사건 06, 192초 밀린 길의 꼬리). 같은 값에서 보통 60교대의 나무 22그루 가운데 둘이 법칙 사고의 내력에 들었다(하나는 부모, 하나는 작은 몫). **값이 목표 범위의 위쪽 끝에 있다**(교대당 0.48) — 문턱은 시드·구간마다 정해져 있어 20교대의 건수는 계단으로 움직이고, 3.5e-5(교대당 0.37 — 범위의 가운데)로 두면 그 20교대에서는 0건이다. b5 가 법칙을 다 넣은 뒤 전체 수(`hazard.natural` 15~40)로 다시 본다.
- 보통 60 의 사건 29건(4.2e-5): 주된 몫 — 밀림 24 · 우회 몰림 2 · 정체 1 · 인파 1 · 한 차로 1. 부모 — 없음 13(정체·공사·인파가 뿌리) · 평소 교통사고 5 · 버스 사고 3 · 가스 폭발 붕괴 2 · 건물 화재 2 · 쓰러진 나무 1 · 다중 추돌 1 · `traffic/drunk` 1 · `traffic/train` 1. 규모 1 이 11 · 2 가 15 · 3 이 3, 변형은 모두 `std`(버스는 세기를 바꾼 다른 실행에서 1건 — 몫이 6%·28% 다). 결과 — 성공 23 · 부분 성공 4 · 대응 지연 1 · 실패 1. 법칙이 낸 사고를 부모로 둔 법칙 사고 2건(`gain` 0.069). 정해 준 구간을 잡지 못한 것 3건(남이 잡았거나 막으면 끊기는 구간).

#### 전후 수치 (§4 의 명령 전부 — 전 `out-c2/`(b3-3 끝 = h1 끝) → 우회 몰림 뒤 `h2/out-div/` → L1 뒤 `h2/out-l1/`)

| 조건 | 사건 수(교대당) | 성공+대응 지연 | 실패+미해결 | 평균 대응 | 한계 시간·방치·출동 없음 | TRAFFIC_DELAY | `roadCrash`(교대당) | 부모 있는 것 · 없는 것 | 한 뿌리 최대 | 버린 넘음(depth·cap·late·expired·busy) | 기다린 줄 | 구멍 | gain |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **보통 60** | 846 → 848 → **875**(14.10 → 14.13 → 14.58 — × 1.03) | 80.3 → 79.6 → **77.7%** | 9.7 → 9.8 → 11.1% | 50 → 51 → 51초 | 3 → 3 → 2 | 24 → 27 → 27 | **29 (0.48)** | 16 · 13 | 2 | 0·0·7·0·0 | 0 | **0** | 0.069 |
| 어려움 30 | 537 → 535 → 548 | 60.7 → 63.9 → 62.4% | 21.4 → 19.6 → 21.0% | 64 → 63 → 64초 | 7 → 7 → 9 | 26 → 25 → 27 | 19 (0.63) | 14 · 5 | 2 | 0·0·14·0·0 | 0 | 0 | 0 |
| 극한 30 | 654 → 660 → 668 | 38.4 → 38.8 → 37.9% | 43.3 → 42.1 → 42.4% | 86 → 87 → 90초 | 42 → 43 → 42 | 31 → 33 → 40 | 22 (0.73) | 19 · 3 | 2 | 0·4·26·0·0 | 0 | 0 | 0.045 |
| 태풍 20 | 461 → 462 → 472 (× 1.02) | 73.3 → 74.2 → 73.9% | 15.8 → 14.9 → 15.7% | 102 → 103 → 103초 | 7 → 5 → 5 | 13 → 12 → 12 | 13 (0.65) | 10 · 3 | 2 | 0·1·2·35·1 | 39 | 0 | 0.077 |
| 홍수 20 | 409 → 403 → 416 (× 1.03) | 67.2 → 66.5 → 64.7% | 9.3 → 11.4 → 14.2% | 81 → 87 → 90초 | 2 → 5 → 7 | 28 → 35 → 33 | 18 (0.90) | 6 · 12 | 1 | 0·0·1·9·0 | 16 | 0 | 0.056 |
| 지진 20 | 425 → 428 → 427 | 40.9 → 41.4 → 40.7% | 38.4 → 37.1 → 37.0% | 97 → 98 → 98초 | 32 → 25 → 28 | 12 → 28 → 27 | 4 (0.20) | 2 · 2 | 1 | 0·0·14·19·0 | 22 | 0 | 0 |
| 산불 20 | 331 → 326 → 326 | 65.9 → 63.5 → 62.6% | 19.0 → 20.2 → 21.5% | 76 → 78 → 79초 | 6 → 9 → 10 | 19 → 29 → 28 | 7 (0.35) | 2 · 5 | 1 | 0·0·8·4·0 | 4 | 0 | 0 |
| 해일 20 | 370 → 367 → 375 (× 1.02) | 74.6 → 73.8 → 72.8% | 7.6 → 8.2 → 10.1% | 72 → 72 → 74초 | 1 → 0 → 0 | 9 → 15 → 13 | 10 (0.50) | 3 · 7 | 1 | 0·0·1·2·0 | 2 | 0 | 0 |

세 값은 전(`out-c2/`) → 우회 몰림 뒤(`h2/out-div/`) → L1 뒤(`h2/out-l1/`), 뒤쪽 열은 L1 뒤의 값이다.

- **보통 60 의 그 밖**(전 → 우회 몰림 뒤 → L1 뒤): 부모 있는 사건 4 → 6 → **23건(2.6% — 목표 1~5%)** · 최대 깊이 2 · 다른 사건을 가리키는 원인 751 → 774 → 916 · 세계 원인 69 → 68 → 93 · 확산 3단계 이상 6 → 6 → 8 · 재계획 50.0 → 49.1 → 49.9%(`fromWorld` 71 → 77 → 89) · 전환이 실제로 늦춘 사건 33 → 30 → 32(늦어진 초 324 → 292 → 332 — × 1.02) · 결과 엔트로피 0.91 → 0.96 → 1.00 · 이야기 엔트로피 3.01 → 3.05 → 3.13 · 교착 후보 0 · 잊힌 사건 0 · 기록 일치 C1~C5 0 · 반복 최대 13 → 8 → 6. 이야기 연쇄 7건. 교대 최대: 법칙 사건 3 · 인과로 난 사건(이야기 연쇄 + 법칙) 3.
- **극한 30**: 이야기 연쇄 32건(전 36 — 한 교대 6건을 법칙의 사고와 나눠 쓴다: 법칙의 넘음 가운데 `cap` 4), 교대 최대 6건 그대로. 법칙을 넣은 뒤 평균 대응 87 → 90초 · TRAFFIC_DELAY 33 → 40 으로 늘었다(늘어난 사고 22건의 감속·통제와 겹치지만 따로 가르지는 않았다).
- **재난**: 충격 단계에는 열린 사건이 한도를 넘어 법칙의 넘음이 기다리다 버려진다(태풍 — 기다린 줄 39 가운데 `expired` 35, 지진 22 가운데 19. §8-24 대로 둔다). 지진은 교대가 길게 이어져 `late` 도 14 다 — 그래서 노출량이 태풍 다음으로 큰데도(63,111) 사건은 4건뿐이다. 홍수는 사건 수 403 → 416(× 1.03 — 기준 × 1.1 안)인데 실패+미해결이 11.4 → 14.2% 로 늘었다(법칙 사고 18건 가운데 부모 없는 것이 12).
- **강제 20교대**(L1 뒤 — `out-l1/force-*.txt`): `traffic/tree` 사건 311(전 306) · 한계 시간 0 · `roadCrash` 9(부모 있는 것 6 — **나무가 원인인 것 1**) · 구멍 0 · 교착 0 / `traffic/pileup` 313(전 305) · 한계 시간 1 · `roadCrash` 8(부모 4) / `collapse/gasblast` 313(전 304) · 한계 시간 3(전 1) · `roadCrash` 9 / `fire/std` 311(전 304) · 한계 시간 4·출동 없음 1(전 2·1) · `roadCrash` 8 / `traffic/bus` 316(전 305) · 한계 시간 1(전 2) · `roadCrash` 14(부모 10 — 버스 사고의 긴 감속이 뿌리). "전"은 우회 몰림 뒤(`out-div/`)다. 다섯 모두 교착 후보 0 · 잊힌 사건 0.
- **L1 뒤의 노출량**(`out-l1/` — 낸 사고가 다시 뿌리가 된다): 보통 60 은 14,750 → 15,420/교대(+4.5% — 되먹임의 크기), 우회 1,021 → 1,043.

#### 관문과 시간

- **`npm run check` 통과**(마지막 코드 커밋 `b2c90ab` 에서 — `h2/check-final.log`): 테스트 **951 + 건너뜀 1**(파일 20개 — h1 끝의 939 에 우회 몰림 2 · `opts.edgeId` 1 · L1 9), 보통 40 검증 통과(사건 584 · 성공 71% · 대응 지연 5% · 실패+미해결 12% · 한계 시간 0 · 방치 1 · 교착 0 · 잊힘 0 · C1~C5 0 · 최대 깊이 2 · `roadCrash` 20건 · 구멍 0). h1 끝의 같은 관문은 사건 565 · 성공 74% · 대응 지연 4% · 실패+미해결 11% 였다.
  - 법칙 커밋(`a44f22a`)에서의 첫 실행은 **시험 셋이 실패**했다(`h2/check-l1.log`) — 하나는 기계가 붐벼 난 시간 초과(`tests/sim.test.ts` '다수 사상자 사고가 나오고 …' 120초 — 혼자 돌리면 통과)이고, 둘은 법칙이 흐름을 바꾼 정해진 시드였다. `b2c90ab` 가 고쳤다(판정·기준은 그대로):
    - `tests/sim.test.ts` '추격전'(50교대): **은신처에 숨어든 납치의 판정은 '미해결'**(`debrief` — `tests/crime.test.ts` 가 이미 그렇게 본다)인데 이 시험은 "놓친 납치 = 실패"만 보고 있었다. 그 50교대에 숨어든 납치가 없다가 S28 에 하나 생겼다(사건 14 — 같은 교대에 몰린 길의 사고 1건). `p.how !== 'hideout'` 을 더했다.
    - `tests/methods.test.ts` '방법마다 쓰인 교대가 있다': 수난 강제 20교대의 유일한 장대 구조(W1 사건 12)가 즉석 부력물이 됐다(W1 에 법칙 사건 1건). 표본에 W29(법칙 사건이 없는 교대의 장대 구조)를 더했다 — R3 단계 2 가 같은 까닭으로 표본을 넓혔던 그 시험이다.
- **`sweep 40 --check`**(L1 뒤 `a44f22a` 의 자리 — `h2/gates-l1/`. `b2c90ab` 는 시험과 주석만 다르다): 보통 통과(위와 같다) · **어려움 통과**(사건 730 · 성공 51% · 한계 시간 7 · 방치 8 · 출동 없음 2 · `roadCrash` 26 — 버린 넘음 depth 1 · late 15) · **극한 통과**(889 · 28% · 25 · 24 · 6 · 교대 끝 7 · `roadCrash` 31 — cap 6 · late 34 · 이야기 연쇄 34 · 교대 최대 인과 6건) · **재난 다섯 × 12 통과**(태풍 288건 · `roadCrash` 12 / 홍수 250 · 13 / 지진 261 · 4 / 산불 194 · 5 / 해일 226 · 7). 모든 조건에서 구멍 0 · 한 뿌리 최대 2 · 교착 0 · 잊힘 0. h1 끝의 같은 관문: 어려움 713 · 51% · 6 · 7 · 1 / 극한 871 · 28% · 19 · 26 · 7 / 재난 279 · 246 · 257 · 199 · 224.
- **교대당 시간**(`h2/timing2.sh` — `sweep` 의 표본 없이 12교대를 전(b3-3 끝 `c2/`) · 뒤(L1 뒤) · 뒤에서 법칙의 상한을 0 으로(문턱을 넘어도 사건이 되지 않는다 — 틀과 교통의 몫)를 번갈아 세 번, `h2/timing.txt`): 사용자 CPU 전 32.8 · 33.4 · 32.0초 / 뒤 29.7 · 31.6 · 28.7초 / 상한 0 은 29.1 · 29.2 · 28.8초, 교대당 전 1,024 · 1,053 · 999ms / 뒤 954 · 983 · 911ms / 상한 0 은 935 · 942 · 920ms. **뒤가 전보다 느리지 않다**(× 0.92 — 빨라진 것이 아니라 그 12교대의 흐름이 우회 몰림으로 바뀐 탓으로 본다: 교대당 시간은 무거운 현장 몇이 정한다. 법칙이 낸 사건 5건을 도는 몫이 +2%). §4 의 "b3-3 끝 대비 × 1.10 이하 · 틀과 교통의 몫 × 1.03 이하" 안이다 — 우회로의 다익스트라는 닫힌 구간의 집합이 바뀔 때만 돌고, 법칙의 `scan` 은 12초에 한 번 초과가 있는 구간(평균 28개)만 훑는다.
- 화면은 고치지 않았다(`vite build` 통과). `npm run ui-check` 는 돌리지 않았다.
- **못 맞춘 것 · 알려 둘 것**: ① 홍수 20교대의 평균 대응이 우회 몰림만으로 +6초(§4 의 "+3초 이하"를 그 조건에서 넘는다 — 보통 60 의 기준은 +0.3초로 지켰다). ② 재난·산불 교대의 TRAFFIC_DELAY 가 우회 몰림으로 크게 늘었다(지진 12 → 28). ③ `ROAD.A` 가 목표 범위의 위쪽 끝이다(보통 교대당 0.48). ④ 개입 시험의 ④(보고서 문장)와 §6-8 의 3단계 사례는 b4·b5 의 몫으로 남겼다. ⑤ 극한 S12 #14 의 `treatMate` 지시 80회 반복(H1 쪽의 알려진 고리)은 그대로다(`repeat max 80`).

#### h3 에게 (이어받을 자리)

- **기준 파일**: 뒤 덩어리의 "전"은 **`<scratch>/wf-causality/h2/out-l1/`**(법칙 커밋 `a44f22a` 에서 쟀다 — 덩어리의 끝 `b2c90ab` 는 시험과 주석만 달라 결과가 같다. 풀어 둔 나무는 `h2/l1/` — 보통 60 · 어려움 30 · 극한 30 · 재난 다섯 × 20 은 `--json --hazard`, 보통 60 `--metrics --hazard`, 강제 다섯(`traffic/tree`·`traffic/pileup`·`collapse/gasblast`·`fire/std` 는 `--hazard` 포함 · `traffic/bus`), 해시 목록 123줄). 우회 몰림만 넣은 자리의 기준은 `h2/out-div/`(`354cf22` — §5 표의 "b3-5 ② 뒤의 기준"). 도구는 `h2/measure2.sh`(§4 의 개정판 명령 전부 — 네 갈래) · `h2/lawstats.sh`(법칙이 낸 사건의 표: 부모·주된 몫·규모·결과·버린 까닭, 나무를 원인으로 한 사고 수) · `h2/lawhash.mts`(해시 목록의 교대마다 법칙 사건 수) · `h2/treeexpo.mts`(사건 하나가 만드는 노출량) · `h2/divtune.sh`(우회 몰림의 크기) · `h2/timecap.mts`(틀과 교통의 몫).
- **법칙 커밋의 확인법**(§5): `tools/hashrun.sh` 의 해시 목록에서 바뀐 줄 = `h2/lawhash.mts` 가 그 법칙의 사건이 있다고 한 교대. 새 법칙을 넣으면 L1 의 문턱·사건은 그대로지만(흐름이 법칙·대상마다 따로다) **상한을 나눠 쓴다**(전체 6 · 한 교대 6건 · 부모 없는 것 3 · 한 뿌리 2) — 다른 법칙의 사건이 먼저 자리를 쓰면 L1 의 사건이 버려져 그 교대가 바뀐다.
- **L1 은 지금 목표 범위의 위쪽 끝에 있다**(보통 교대당 0.48 — 목표 0.2~0.5). 뒤 단계가 닫힌 구간을 늘리면(b3-8 의 `blockRoad` 면한 길 · C4 의 꺼진 신호 `bump` · C5 의 연기 · `'level'`) 노출량이 늘어 0.5 를 넘는다 — 그때는 `ROAD.A` 를 그 단계의 `hazstats` 노출량으로 다시 맞춘다(§4 의 손잡이 차례 1번). 건물 쪽 법칙(L2·L3·L4·L5)을 다 넣은 뒤 `hazard.natural` 이 보통 60 에 40건을 넘으면 b5 가 `ROAD.A` 를 3e-5 쯤으로 내리는 것이 먼저다(그러면 강제 `traffic/tree` 20교대의 나무 사고는 0건이 된다 — 위 "`A_ROAD` 를 맞춘 과정"의 표).
- **재난 교대의 L1**: 태풍·지진·홍수는 노출량이 보통의 3~4배인데 사건은 교대당 0.2~0.9건이다 — 충격 단계의 넘음은 열린 사건이 한도를 넘어 기다리다 버려지고(`expired`), 교대가 길게 이어져 `late` 도 많다. 상한(`cap`)에는 거의 닿지 않았다(태풍 20교대에 1). b3-10 의 C4(꺼진 신호)·b3-12 의 `'level'` 을 넣을 때 재난 20교대의 사건 수(기준 × 1.1)를 위 표의 L1 뒤 값에서 잰다.
- **b4(h8)에게**: 개입 시험 ④(보고서 문장)와 §6-8 의 "3단계 사례"(나무 → 통제 → 몰린 길의 사고 → 그 사고의 통제를 만난 다른 사건 부대의 ROUTE_BLOCKED)는 하지 않았다. 사슬 시험의 조건(`treeShift('S7', 150)` · `ROAD.A = 3e-4`)에서 나무 #01 → 사고 #02(t = 166, `divert`) → 사고 #03(t = 310, `queue` — #02 의 감속) 이 실제로 나고 #02·#03 의 전면 통제도 걸린다 — 평소 사건을 얼리지 않으면 그 통제를 만나는 부대가 생긴다. `I.hz.src[k].since` 는 몫마다 따로다(문장의 "약 N초" = `hz.at − since`).

### b3-7 — 건물의 노출과 L2 `heatSpread` (2026-11-21, 덩어리 `h3`. 브랜치 `wf/causality-h3` → `wf/causality`, 시작점 `9c0bbec` = h2 끝(`b2c90ab`)을 받은 주 브랜치 — `src/`·`scripts/`·`tests/` 는 `b2c90ab` 와 한 글자도 같다)

커밋: 노출의 틀 `1fd3ae3`(**불변**) · L2 법칙 `e95520c`(**바뀜** — 옮겨붙은 불이 난 교대) · 상태·판단 `f1c2106`(**바뀜** — 알려진 큰 불·폭발 곁의 화재 평가가 있던 교대) · 법칙 다듬기 `f1e08f1`(불 요약은 그 건물 안의 불 · 규모의 반올림 — **바뀜**: 해시 목록 1줄) · 시험 `0fbc10c` (+ 이 메모). 등록된 법칙은 L1·L2 둘이다(`world/laws/index.ts` 의 `import './road';` 다음 줄 `import './heat';`).

#### 기준 (h3 의 "전")

새 컨테이너라 앞 덩어리의 기준 파일이 없어 **시작점을 `git archive` 로 풀어(`<scratch>/wf-causality/h3/pre/`) §4 의 명령 전부를 다시 쟀다**(`h3/out-pre/` — 보통 60 · 어려움 30 · 극한 30 · 재난 다섯 × 20 은 `--json --hazard`, 보통 60 `--metrics --hazard`, 강제 다섯, 해시 목록 123줄 `hash.txt`). h2 메모의 "L1 뒤" 줄과 같은 값이 나왔다(보통 60: 사건 875 · 성공+대응 지연 77.7% · `roadCrash` 29 · `reportHash 4752b486`). 도구는 `h3/tools/`: `measure.sh <뿌리> <폴더> [all|a|b|c|d]`(§4 의 명령 — 네 갈래, 둘씩 나란히) · `hashrun.sh`·`i1hash.mts`(해시 목록 — 줄 끝에 그 교대의 `roadCrash`·`heatSpread` 사건 수) · `cond.mts`·`condcmp.mjs`(상태·판단 커밋의 확인 — 아래) · `summ.mjs <폴더…>`(아래 표) · `heattune.mts`(법칙의 상한을 0 으로 두고 대상마다의 노출량 E 와 문턱을 견줘 K 배율마다 첫 세대로 넘는 수를 어림 — 결과는 시작점과 같은 교대) · `heattune2.mts`(불 요약을 실내 칸만으로 잰 어림) · `heatrun.mts`(K 를 바꿔 실제로 돈다 — 화재 결과·옮겨붙은 불의 표, `DIS=<재난>`·`TO=1`) · `samenode.mts`(같은 교차로의 열린 사건 둘) · `timing.sh`.

#### 같은 교차로의 열린 사건 둘 — 가릴 수 있다 (`hold: 300` 갈래는 쓰지 않았다)

본문 L2 끝 "확인 필요"의 첫 일. 강제 `fire/std` 20교대(마지막 코드)에서 같은 교차로에 열린 건물 사건 둘이 함께 있던 쌍 4개(모두 옮겨붙은 불과 그 열원 — 옮겨붙은 불 3건 모두 부모와 같은 교차로, 부모가 열려 있을 때 났다):

- **지도 핀**: `renderCity.incidentXY` 는 관찰자·AI 시점 모두(신고 위치가 맞으면) 그 사건의 **건물 가운데**(`truth.x·y`)에 그린다 — 4쌍 모두 다른 자리.
- **길가 주차**: `resources.arrive` 는 그 부대의 사건(`u.incidentId`)의 건물 `cx·cy` 로 간다 — 4쌍 모두 다른 자리, 남의 사건 건물 앞에 선 부대 0.
- **신고·배정**: 위치 진술은 교차로 id 지만 추가 신고(`isFollowup`)는 그 사건 자신의 것이라 남의 사건에 묶이지 않는다. 중복 신고를 합치는 `screening.decide` 는 아직 언제나 `null`(N8 단계 10).
- **`knownBuildingAt(node, placeKind)`**: 같은 종류의 두 건물(4쌍 가운데 3쌍이 상점·상점)은 가리지 못한다 — 다만 **지금 이 함수를 부르는 판단 코드가 하나도 없다**('재발화' 이름표는 L7 의 물리와 함께 뒤로 — §3.7). 이 함수에 소비자를 더하는 묶음(I2·L7 이름표)이 볼 한계로 적어 둔다.

그래서 `spawn` 은 교차로를 보지 않고(같은 건물은 틀이 막는다) 기다리는 줄의 마감도 기본(60초)이다.

#### 실제 이름과 자리 (h4~h8 이 쓴다)

1. **`world/expo.ts`**(등록이 없는 파일 — `tests/hazard.test.ts` 의 "등록이 없는 파일" 목록에 더했다): `NB_REACH`(30) · `Nb { id, gap }` · `expoOf(sim, placeId)`(없으면 만든다 — `pipeThr = 0.2 + 0.6 × fork('hz:pipe:<건물>').next()`, sim.world 안에만) · `neighborsOf(sim, placeId)`(벽-벽 틈 30 안의 건물, 가까운 순·같으면 id 순, 터·출동 시설·자기 자신 제외 — `city.places` 열쇠의 `WeakMap`, 시드와 무관) · `neighborsOfPoint(sim, x, y)`(점에서 벽까지 — 점의 글자 열쇠로 같은 캐시) · 거리 함수 `pointGap(q, x, y)`·`wallGap(a, b)`(돌려 놓인 상자 — `placeAt` 과 같은 변환. 겹치지 않는 두 볼록 사각형의 거리 = 꼭짓점에서 다른 상자까지 거리의 최솟값). `applyExpo`·`darkened` 는 그 상태를 쓰는 단계(b3-8 · b3-10)가 더한다.
2. **`field/hazards.ts`**: `FIRE_LOAD_MIN`(0.5) · **`fireLoad(s)`**(지난 `tickFire` 에서 불 0.5 이상이던 칸 수 — `WeakMap<Scene, number>`, `tickFire` 의 순회에 셈 하나. **건물 현장이면 실내 구역의 칸만**, 건물이 없는 현장은 모든 칸 — 아래 "다르게 한 곳" 1) · **`fireCauseEv(I)`**(그 불을 만든 기록: 그 사건의 X6 폭발 기록(`EXPLOSION` · `X6_BOOM_DETAIL` 에 맞는 `HIDDEN_HAZARD`)이나 `BURNOUT` 가운데 마지막 것, 없으면 발생 기록 — `ESCALATION` 은 쓰지 않는다). `'fireBig'` 신호의 `ev` 가 이것이다(예전에는 마지막 `ESCALATION` — 받는 규칙이 없어 결과는 그대로). C5(b3-11)의 연기 알림의 원인도 이것을 쓰면 된다.
3. **`world/state.ts`**: `placeState` 가 `{ mark, burnFrac, ruinFrac, usable, shake, pipe, wet }` — `world.expo` 를 읽기만 하고, 건물 상태가 없어도 노출이 있으면 `{ mark: null, burnFrac: 0, ruinFrac: 0, usable: true, … }`. **`knownHazardNear(sim, node, within = 300, age = 180, except = -1)`** → `{ fire, blast, collapse }`: 위치를 아는 다른 사건(`except` 는 뺀다) 가운데 알려진 교차로(`reportedNode`)가 `within` 안인 것 — 불 = 열린 사건이고 `fieldVerified` · (`fieldType` 없으면 평가 유형) `'fire'` · `fieldRisk` 가 있다(현장 상황 보고가 위험도를 올렸다 — X6 §5.9), 폭발 = 진실이 아닌 `EXPLOSION`·X6 문구의 `HIDDEN_HAZARD` 기록이 `age` 안, 붕괴 = 진실이 아닌 `STRUCT_COLLAPSE` 가 `age` 안. 이 파일이 `field/catastrophe` 의 `X6_BOOM_DETAIL` 을 import 한다(모듈 평가 순서가 바뀌어도 결과는 같다 — 그 import 만 넣은 상태의 해시 목록이 diff 0).
4. **`world/laws/heat.ts`** — L2: `registerHazard({ id: 'heatSpread', label: '옮겨붙은 불', every: 1, once: true, cap: HEAT.CAP, scan, spawn })`.
   - 상수 **`HEAT { K: 1.2e-4, Q0: 3, F_MIN: 10, NB_MAX: 8, F_BIG: 40, CAP: 3 }`**(시험이 `HEAT.K` 를 바꿔 쓴다). `heatMul(kind)`(시장·수산시장·창고·작업장·상점 1.3 · 아파트·오피스텔·사무용 0.6 · 그 밖 1) · `heatRate(F, gap, mul)` = `mul × max(0, F/(1+g/6)² − Q0)`(K 를 곱하기 전).
   - **`heatTargets(sim, visit(target, gap, F, rate, inc, ref))`** — 열원과 대상을 내놓는다(scan 과 측정이 함께 쓴다, 읽기만): 열린 사건의 현장 가운데 `fireLoad ≥ F_MIN`(사건 번호 순)마다 그 건물(길 위면 그 점)의 이웃을 가까운 순으로, 유속이 문턱을 넘는 것만(가까운 순이라 처음 0 이 나오면 멈춘다), 대상이 될 수 있는 건물만 `NB_MAX` 채까지. 대상에서 빼는 것: 터·출동 시설(이웃 목록이 이미) · **평소 화재의 장소 표(`INCIDENT_PLACES.fire`)에 없는 종류** · 쓸 수 없는 건물(`placeState().usable === false`) · **이번 교대에 이미 불이 난 건물**(그 건물의 화재 사건이 있었거나 그 건물 현장에 탄 칸이 있다).
   - `scan`: 대상마다 열원의 몫을 모아(열원이 둘이면 몫이 둘) 한 번씩 `put` — 몫 = `{ rate: K × heatRate, ev: fireCauseEv(열원 사건), inc: 열원 사건, what: 'heat', ref: 열원 건물(길 위면 −1) }`.
   - `spawn`: `{ type: 'fire', variant: 'std', severity, placeId: target, note }` — 규모는 넘는 순간의 열원 불 요약(주된 몫의 `rate` 에서 되찾아 반올림 — 기다리던 줄이 뒤늦게 날 때도 넘는 순간의 값)이 `F_BIG` 이상이거나 불티면 2, 아니면 1. 첫머리 '옆 건물의 불이 옮겨붙었습니다'(불티 '폭발의 불티가 옮겨붙었습니다' — b3-8c 가 쓴다). 발생 기록 `'옆 건물의 불이 옮겨붙었습니다 — {주소 건물}.'`(측정 도구의 `PHRASE` 에 걸리지 않는다).
   - 문턱의 흐름 `hz:heatSpread:<건물>`(once), 사건의 흐름 `hz-spawn:heatSpread:<건물>:0`.
5. **`dispatch/analyst.ts`**: `SPREAD_SEV`(0.3, export). 화재로 평가하는 신고가 위치를 알고 `knownHazardNear(sim, I.reportedNode, 300, 180, I.id)` 의 `fire || blast` 면 위험도 +0.3·근거 '인근 큰 불·폭발', 시나리오 이름표가 없으면 이름표 **'연소 확대'**(`natureLabel` 이 붙인 산불·선박 화재 따위는 그대로 — 배정이 이름표를 본다). 이 파일은 그 함수만 부른다(시험이 글자로 본다 — `fireLoad`·`heatTargets`·`neighborsOf`·`truth.x`·`truth.placeId`·`sim.scenes` 가 없다).
6. **측정**: `scripts/hazstats.ts` 에 `hazard-heat:` 줄(열원이 있던 교대 · 열원 현장 수 · 노출된 건물 수 · 열원 초 · 노출량 `Σ M·max(0, q − Q0)·dt`/교대 · F 최댓값 · 가장 큰 노출량들 — 1초마다 `heatTargets` 를 그대로 부른다), `--json` 의 `hazard.heat`. `hazard-laws:` 에 `heatSpread cells … crossed … made …`.
7. **시험**(`tests/hazard.test.ts` 'I1-b b3-7' 열 — 4초 남짓, 대부분 `tickHazards` 만): 등록 · ② 거리(손 계산 넷 — 옆·모서리·90°·45°)·이웃 목록의 성질(가까운 순·틈 30·터와 시설 없음·두 쪽에서 같은 틈)·노출 칸과 `placeState` · ① 칸 없음(불 없음·불 요약 10 아래·0.2~0.5 칸·**건물 밖에서 타는 칸**) · ③ 개입 · ④ 길 건너(문턱 틈 20.6) · ⑤ 대상이 아닌 건물(전소·전체 붕괴·이미 탄 건물 / 사건 중인 건물은 기다렸다 난다) · ⑥ 한 뿌리의 가지(넷이 넘어도 둘, 셋째 세대도 `'depth'`) · ⑦ 원인 기록(붕괴 현장의 불 — `ESCALATION`·X6 가 아닌 `HIDDEN_HAZARD` 를 건너뛰고 발생 기록, X6 폭발·전소가 있으면 그것, `fireBig` 신호도 같은 규칙) · 관제가 아는 길(`knownHazardNear` 의 갈래 — 위치를 모르는 신고·자기 자신·진실 기록·180초·300 밖·닫힌 화재 · '연소 확대'와 +0.3) · 실제 교대(강제 `fire/std` S1 — `truth.placeId === hz.target`, 부모의 이웃, 원인 기록, 노출량 줄). `tests/causality.test.ts` 의 '세계 상태는 … 처음 값'이 `heatSpread` 칸(건물)과 `world.log` 줄을 받는다.

#### 본문과 다르게 한 곳

1. **불 요약 F 는 그 건물 안(실내 구역)의 칸만 센다**(본문: "불 세기 0.5 이상인 칸 수"). 처음 판(모든 칸)으로 재 보니 산불 20교대의 노출량이 14,368/교대(보통의 15배)이고 옮겨붙은 불이 14건 — 산불 현장(`fire/wild` — 오두막 하나와 숲)의 **타는 숲**이 이웃 펜션·절에 불을 붙였고, 그 교대들의 한계 시간·방치·출동 없음이 10 → 19 로 늘었다. 유속은 그 건물의 벽에서 이웃의 벽까지의 틈으로 재므로 F 도 그 건물의 불이어야 하고, 산불이 건물로 번지는 것은 산불 모델(`d.front`·재난 큐)의 몫이다(본문의 "불머리는 열원이 아니다"와 같은 뜻 — 변형·재난을 읽지 않고 칸의 구역만 본다). **보통·어려움·극한·강제 화재의 노출량은 한 칸도 달라지지 않았다**(건물 화재의 센 불은 모두 실내다 — `heattune2.mts`). 길 위의 현장(건물이 없다)은 모든 칸을 센다. 산불 20 의 노출량은 2,311/교대, 옮겨붙은 불 3건이 됐고 한계 시간·방치·출동 없음은 시작점과 같다(9·0·1).
2. **`HEAT.K = 1.2e-4`**(첫 값 1.7e-4 의 0.7배). 강제 `fire/std` 20교대에서 첫 값은 옮겨붙은 불 5건 · 화재 성공 −3.5%p(끝내는 조건 −2%p 밖)였고, 0.7배는 3건 · −1.2%p(보통 60 은 4건, 넘음 7 가운데 3 은 교대 끝 150초 안이라 버려졌다). 0.5배·0.6배는 강제 20교대에 첫 세대 넘음 1~2(`heattune`)라 범위의 아래쪽 끝이고, 어려움·산불에서는 K 를 0.85e-4 로 내려도 화재 성공률이 오히려 낮게 나왔다(흔들림 — 아래 "알려진 것").
3. 대상에서 **평소 화재의 장소 표에 없는 종류를 뺀다**(본문은 시설·터·쓸 수 없는·이미 탄 건물만): 화재 현장의 틀이 그 종류를 받는지 확인하지 않은 종류(학교·공사장·저장 시설·정압실 …)에 화재 사건을 내지 않으려고. 대상의 성질이지 원인을 가리는 조건이 아니다.
4. **"이미 불이 난 건물"** = 이번 교대에 그 건물의 화재 사건이 있었거나(오인 신고 포함) 그 건물 현장에 탄 칸이 있다(가스 폭발 뒤 탄 건물). 법칙 파일에 `truth.variant` 를 쓰지 않으려고 오인 신고를 가리지 않았다.
5. **`knownHazardNear` 에 다섯째 인자 `except`**(신고받는 그 사건 — 현장 보고로 위험도를 올린 큰 불이 자기 재평가에서 스스로를 '연소 확대'로 보지 않게). 큰 불의 정의는 본문 그대로 `fieldRisk`(현장 보고가 위험도를 올린) — 붕괴·폭발·전소가 실린 보고에서만 생기므로 "큰 불이지만 X6 일이 없던 불"은 치지 않는다(관제가 아는 것이 그것뿐이다). 본문의 "확인 필요: 현장 확인의 칸 이름"은 `fieldVerified` + `fieldType` 이다.
6. **'연소 확대'는 시나리오 이름표가 없을 때만** 붙인다(산불·선박 화재 같은 이름표는 헬기·구조정 배정이 읽는다). 근거 문구는 '인근 큰 불·폭발'(신고 진술의 '연소 확대'(`haz 'spreading'`)와 섞이지 않게).
7. ④ 의 경계: F = 59 에서 유속이 문턱을 넘는 틈은 `6(√(59/3) − 1) ≈ 20.6` 이다 — 본문의 "틈 ≥ 20 은 F = 59 에서도 쌓이지 않는다"는 20~20.6 에서 조금 쌓인다. 시험은 21 로 본다.
8. 규모의 F 는 L1 의 초과처럼 넘는 순간의 몫(`main.rate`)에서 되찾는다(`fireLoad` 를 다시 읽지 않는다). 정수라 반올림한다(F = 40 이 39.999… 로 규모 1 이 된 것을 시험이 잡았다 — `f1e08f1`).
9. 시험은 `tests/causality.test.ts` 가 아니라 `tests/hazard.test.ts` 에 두었다(L1 과 같은 갈래 — §7).

#### 해시로 본 것 (§5 의 "커밋을 둘로 나누고 확인하는 법")

- **노출의 틀(`1fd3ae3`)**: 해시 목록 123줄이 시작점과 **diff 0**.
- **L2(`e95520c` — 법칙 커밋)**: 바뀐 19줄 = 옮겨붙은 불이 난 19교대(바뀌었는데 없는 교대 0 · 있는데 그대로인 교대 0, 사건 24건).
- **상태·판단(`f1c2106`)**: 법칙 커밋 뒤와 견줘 바뀐 22줄이 **모두** 그 교대에 조건(화재로 평가한 틱에 `knownHazardNear` 가 참 — `cond.mts` 가 평가 시각마다 다시 불러 센다 — 또는 그 근거 문구·이름표)이 있었다. 조건이 있었는데 그대로인 교대 7(이름표만 붙고 수요·기록 문구가 바뀌지 않은 재평가). 123교대 가운데 29교대에 조건이 있었다(보통 40 에 넷).
- **다듬기(`f1e08f1`)**: 바뀐 줄 1 — 산불 S0(옮겨붙은 불 2 → 0, 시작점과 같은 해시로 돌아왔다).
- 마지막 코드 커밋의 해시 목록은 시작점과 27줄 다르다(옮겨붙은 불이 난 19교대 ∪ 조건이 있던 교대).

#### 전후 수치 (§4 의 명령 전부 — 전 `h3/out-pre/` → 뒤 `h3/out-post2/`(마지막 코드 커밋))

| 조건 | 사건(교대당) | 성공+대응 지연 | 실패+미해결 | 평균 대응 | 한계 시간·방치·출동 없음 | `heatSpread` | `roadCrash` | 부모 있는·없는 법칙 사건 | 버린 넘음(depth·cap·late·expired·busy) | 구멍 | gain | 열 노출량/교대 |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **보통 60** | 875 → 877 (14.62) | 77.7 → **77.3%** | 11.1 → 11.3% | 51 → 52초 | 0·2·0 → 0·2·0 | **4** | 29 → 28 | 19 · 13 | 0·0·12·1·0 | **0** | 0.094 | 936 |
| 어려움 30 | 548 → 551 | 62.4 → 61.2% | 21.0 → 21.8% | 64 → 66초 | 3·4·2 → 3·4·2 | 8 | 19 → 17 | 20 · 5 | 1·0·20·1·0 | 0 | 0 | 3,438 |
| 극한 30 | 668 → 673 | 37.9 → 37.4% | 42.4 → 43.7% | 90 → 92초 | 18·20·4 → 18·20·5 | 11 | 22 → 20 | 28 · 3 | 3·4·27·0·0 | 0 | 0.065 | 5,648 |
| 태풍 20 | 472 그대로 | 73.9% 그대로 | — | 103초 | 5·0·0 | 0 | 13 | — | — | 0 | — | 552 (`reportHash` 같음) |
| 홍수 20 | 416 → 417 | 64.7 → 64.5% | 14.2 → 14.1% | 90초 | 5·1·1 그대로 | 1 | 18 | 7 · 12 | 0·0·1·9·0 | 0 | 0.053 | 521 |
| 지진 20 | 427 그대로 | 40.7 → 40.5% | 37.0 → 37.2% | 98초 | 23·0·5 그대로 | 1 | 4 | 3 · 2 | 0·0·20·26·0 | 0 | 0 | 4,924 |
| 산불 20 | 326 → 327 | 62.6 → 62.4% | 21.5 → 20.8% | 79초 | 9·0·1 그대로 | 3 | 7 | 5 · 5 | 0·0·7·4·0 | 0 | 0 | 2,251 |
| 해일 20 | 375 → 376 | 72.8 → 72.6% | 10.1 → 9.8% | 74초 | 0·0·0 | 1 | 10 | 4 · 7 | 0·0·2·2·0 | 0 | 0 | 499 |

- **화재의 결과**(화재 유형만 — 성공 · 성공+대응 지연): 보통 60 은 174건 → 178건, 54.6 → 53.9%(−0.7%p) · 59.8 → 58.4% · **강제 `fire/std` 20 은 81 → 83건, 49.4 → 48.2%(−1.2%p — 끝내는 조건 −2%p 안)** · 50.6 → 49.4%, 한계 시간 4 → 5(옮겨붙은 불 S7 #04 가 한계 시간) · 어려움 30 은 102 → 110건, 30.4 → 28.2%(−2.2%p) · 36.3 → 32.7% — 성공한 화재의 수는 31 그대로(옮겨붙은 불의 성공 1 을 넣어)이고 늘어난 8건이 대개 실패·부분 성공이다(열원이 부대를 잡고 있을 때 나는 불이다) · 극한 30 은 120 → 129건, 9.2 → 9.3% · 17.5 → 17.1%.
- **강제 20교대**: `fire/std` 옮겨붙은 불 **3**(넘음 3 · 모두 사건이 됐다, 목표 1~4) · `collapse/gasblast` 4 · `traffic/tree` 4 · `traffic/pileup` 3 · `traffic/bus` 1. 다섯 모두 교착 0 · 잊힘 0 · 구멍 0 · C1~C5 0.
- **보통 60 의 그 밖**: `hazard.natural` 29 → 32(교대당 0.53) · 부모 있는 사건 23 → 26 · 최대 깊이 2 · 다른 사건을 가리키는 원인 916 → 909 · 세계 원인 93 → 92 · 확산 3단계 이상 8 → 10 · 재계획 49.9 → 50.0%(`fromWorld` 89 → 88) · 전환 57·32·332 → 58·33·400 · 엔트로피(결과·이야기·행동) 1.00·3.13·2.54 → 0.99·3.12·2.54 · 교착 0 · 잊힘 0 · 반복 최대 6 · C1~C5 0. 교대 최대: 법칙 사건 3 · 인과로 난 사건 3.
- 옮겨붙은 불의 모습(보통 60 — `heatrun.mts`): S15 #11 작업장 ← #08 건물 화재 · S23 #09 다세대 ← #07 건물 화재 · S33 #11 상점 ← #09 **가스 폭발 붕괴 현장의 불** → S33 #15 상점 ← #11(옮겨붙은 불이 다시 열원 — 깊이 2).
- **교대당 시간**(`timing.sh` — `sweep 12 --no-metrics` 를 전·뒤 번갈아 세 번, 다른 작업과 기계를 나눠 쓰는 중): 사용자 CPU 전 30.2 · 30.1 · 30.0초 / 뒤 31.1 · 31.2 · 30.5초(+2.6%), 교대당 989 · 950 · 957 / 1,006 · 1,004 · 966ms(+3.0%). `heatTargets` 는 1초마다 열린 현장의 불 요약(이미 센 값)을 보고 큰 불이 있을 때만 이웃 목록(건물마다 한 번 만든다)을 훑는다.

#### 관문

- **`npm run check` 통과**(마지막 코드 커밋 `0fbc10c` — `h3/check.log`, 10분): 테스트 **961 + 건너뜀 1**(파일 20개 — h2 끝의 951 에 'I1-b b3-7' 열), 보통 40 검증 통과(사건 586 · 성공 70% · 대응 지연 5% · 실패+미해결 13% · 한계 시간 0 · 방치 1 · 교착 0 · 잊힘 0 · C1~C5 0 · 최대 깊이 2 · `roadCrash` 19 · `heatSpread` 4 · 구멍 0). h2 끝의 같은 관문은 사건 584 · 성공 71% · 대응 지연 5% · 실패+미해결 12% 였다.
- **`sweep 40 --diff hard --check` 통과**(사건 736 · 성공 50% · 한계 시간 9 · 방치 8 · 출동 없음 3 · 교대 끝 3 · `roadCrash` 24 · `heatSpread` 11 · 버린 넘음 depth 2 · late 23 · 구멍 0 · 교대 최대 인과 5건) · **`--diff extreme --check` 통과**(893 · 27% · 24 · 24 · 9 · 교대 끝 6 · `roadCrash` 30 · `heatSpread` 17 · depth 5 · cap 6 · late 37 · 이야기 연쇄 37 · 교대 최대 인과 6건). 둘 다 최대 깊이 2 이하 · 한 뿌리 최대 2 · 교착 0 · 잊힘 0 · C1~C5 0. h2 끝: 어려움 730 · 51% · 7 · 8 · 2 / 극한 889 · 28% · 25 · 24 · 6.
- 화면은 고치지 않았다(분석 AI 의 이름표 '연소 확대'는 사건 카드 제목에 저절로 나온다 — 글자일 뿐이다). `npm run ui-check` 는 돌리지 않았다.

#### 알려진 것 · 뒤 덩어리에게

- **어려움·강제(화재가 아닌 강제)의 화재 성공률이 −2%p 를 넘게 내려간다**(어려움 −2.2%p · 강제 `traffic/tree` −2.9%p · `collapse/gasblast` −2.3%p). 원래 화재의 성공 수는 거의 그대로이고 늘어난 옮겨붙은 불(대개 실패·부분 성공)이 비율을 내린다. K 를 0.7배 더 내려도(0.85e-4) 어려움 30 의 화재 성공률은 27.5% 로 더 낮게 나왔다(건수가 7·8 로 계단이라 흔들림이 더 크다) — 이 조건들의 −2%p 는 K 로는 맞추지 못한다. 끝내는 조건(강제 `fire/std` 20)은 −1.2%p 로 지켰다. 화재 균형은 사용자 결정으로 N9 뒤에 다시 본다(§8-22).
- `knownBuildingAt` 은 같은 교차로·같은 종류의 두 건물을 가리지 못한다(위). 소비자를 더하는 묶음이 본다.
- **`hazard.natural` 이 보통 60 에 32건**(목표 15~40 의 가운데 위) — 남은 법칙(L3·L7·L5·L4)이 더하면 b5 가 `ROAD.A` 부터 본다(h2 메모의 말 그대로).
- **b3-8c(불티)에게**: 불티는 `hazardImpulse(sim, 'heatSpread', 이웃, ΔH, { ev: sig.ev, inc: sig.inc, what: 'ember', ref: 원인 건물 })` 로 같은 칸에 더하면 된다 — `spawn` 은 이미 `what === 'ember'` 면 규모 2 와 불티 첫머리를 낸다. 이웃은 `neighborsOf`(길 위면 `neighborsOfPoint`), 대상의 조건은 `heatTargets` 와 맞추려면 그 안쪽 조건(장소 표·쓸 수 있음·이미 탔음)을 함수로 뽑아 함께 쓴다(지금은 `heatTargets` 안에 있다). `expoOf`·`placeState` 의 `shake`·`pipe`·`wet` 칸은 그 단계가 채운다.
- **C5(b3-11)에게**: 연기 알림의 원인 기록은 `fireCauseEv`(L2 의 열원과 같은 규칙 — 본문 C5 의 "L2 의 `ev` 규칙").
- 극한 S12 #14 의 `treatMate` 80회 반복(H1 쪽의 알려진 고리)은 그대로다(`repeat max 80`).

### b3-8 a · b — L3 충격: 이웃 건물의 금·배관 손상과 손상된 건물의 다음 현장 (2026-11-21, 덩어리 `h4`. 브랜치 `wf/causality-h4` → `wf/causality`, 시작점 `49b6fd3` = h3 끝 — `src/`·`scripts/` 는 h3 의 마지막 코드 커밋과 한 글자도 같다)

커밋: b3-8 a `8305570`(상태·판단 — **바뀜**: 폭발·전체 붕괴·무너진 채 시작한 사건이 있던 교대) · b3-8 b `00172e9`(상태·판단 — **바뀜**: 손상을 안고 시작한 현장이 있던 교대) · 시험·측정 `c40ca4f`(시험·`scripts/hazstats.ts` 만) · 옛 시험의 표본 `ccf16bf`(`tests/sim.test.ts` '2층 건물' — 아래 "본문과 다르게 한 곳" 10) (+ 이 메모). **법칙은 하나도 더하지 않았다**(등록된 법칙은 L1·L2 그대로 — `structFail`·`pipeLeak` 은 b3-8c(h5)).

#### 기준 (h4 의 "전")

h3 의 기준 파일이 같은 scratchpad 에 남아 있어(`<scratch>/wf-causality/h3/out-post2/` — h3 의 마지막 코드 커밋을 `git archive` 로 푼 `h3/post2/` 에서 잰 §4 의 명령 전부) 그것을 "전"으로 썼다(`src/`·`scripts/` 가 시작점과 같은 것을 `diff -r` 로 확인). 더한 것: X6 의 수를 볼 보통 120교대(`h4/out-pre/normal120.json`), 조건 칸을 붙인 해시 목록(`h4/hash-pre/hash.txt` — 줄 끝에 그 교대의 X6 폭발·폭발물·전체 붕괴·무너진 채 시작한 사건의 수, 노출 칸 수, 손상을 안고 시작한 현장 수. 해시 칸은 `h3/out-post2/hash.txt` 와 123줄 모두 같다). 도구는 `h4/tools/`: `i1hashc.mts`·`hashrunc.sh`(조건 칸을 붙인 해시 목록) · `cmp.mjs`(바뀐 줄이 모두 조건이 있던 교대인가) · `shockpeek.mts`(교대마다 흔들린 건물·금·배관 기록) · `peekinc.mts`·`stallpeek.mts`(사건 하나의 기록·그 시각의 현장). 뒤 측정은 `h4/out-post1/`(b3-8 b 커밋을 풀어 `hazstats.ts` 만 마지막 판으로 바꾼 `h4/post1/` 에서 — 시험 커밋과 `src/` 가 같다).

#### 실제 이름과 자리 (h5~h8 이 쓴다)

1. **`Signal.mag`**(칸은 h1 이 넣었다 — `signal()` 이 `mag: s.mag ?? 0` 으로 복사): X6 의 신호 여섯 자리 — `collapseRegion` = `min(0.99, 이번에 무너진 칸(구획 칸 + 무너진 안쪽 벽) ÷ 건물의 실내 칸(실내 구획 칸의 합, 무너진 뒤))` · `collapseBuilding` = 1 · 전소 = 0 · `explodeGas` = 피해량 `dmg` · `ruptureVessel` = `VESSEL_BOOM[v].dmg` · `explodeDust` = `CAT.DUST_DMG`. `hazards.blast` 의 `'blast'` 신호(폭발물) = 피해량.
2. **`world/expo.ts`**(등록이 없는 파일 그대로): `SHOCK { K 0.8, CELL 2, PAD 2, TOTAL 0.6, START 0.35, REACH 15, START_SIZE 10, S_MIN 0.1 }`(본문의 `K_SHOCK`·`CELL`·붕괴 계수 0.6·0.35·닿는 틈 15·`S_MIN` 을 한 객체로 — 시험이 `SHOCK.K === CAT.K_HIT_BLAST` 를 본다) · `GAS_KINDS`(도시가스 건물: `houseS`·`houseL`·`villa`·`apartment`·`officetel`·`restaurant`·`cafe`·`shop`·`market`·`convenience`·`hotel`) · **`shockDelta(sig, gap)`**(신호 하나가 틈 `gap` 의 이웃에 주는 손상 — 폭발 `catastrophe` data 0·`blast`: `K × mag/100 × max(0, 1 − d/(size + 2))`, `d = gap/CELL + PAD` · 건물 전체의 붕괴 `catastrophe` data 1 이고 `mag ≥ 1`: `TOTAL × (1 − gap/REACH)` · 무너진 채 시작 `collapse` 이고 `size ≥ START_SIZE`: `START × (1 − gap/REACH)` · 그 밖 0) · **`applyExpo(sim, s, I)`** · `EXPO_LEAK [0.5, 0.64]`(새는 밸브의 세기 — 가스 폭발 현장의 밸브와 같은 범위). b3-8c 의 `laws/shock.ts` 는 `SHOCK.S_MIN` 을 여기서 가져다 쓴다(법칙 파일이 등록 없는 파일을 import 하는 것은 규칙 안이다 — `heat.ts` 처럼).
3. **`world/rules/structure.ts` — 상태 규칙 `shockSpread`**(같은 파일의 `rubbleRoad` 다음에 등록 — 시험이 `consequences()` 의 차례를 본다): `{ id 'shockSpread', label '충격 손상', on: ['catastrophe', 'blast', 'collapse'], key 'ev:<신호의 기록>', cooldown 0, cap Infinity, spawns false }`. `test` = 흔들 이웃이 하나라도 있는가. 이웃은 신호의 건물이 있으면 `neighborsOf`, 없으면(길 위) `neighborsOfPoint(sig.x, sig.y)` — 가까운 순으로 `shockDelta > 0` 인 동안, **쓸 수 없는 건물(전소·전체 붕괴)은 건너뛴다**. `apply`: `expo.shake = min(1, shake + Δ)`, 가장 크게 보탠 신호가 `shakeEv`·`shakeInc`(그 크기는 모듈의 `WeakMap<PlaceExpo, number>` — 노출 칸이 교대마다 새로 만들어지므로 시드를 넘지 않는다), 처음 `S_MIN` 을 넘으면 기록 `'{원인 건물} {붕괴·폭발}의 충격으로 옆 {건물}에 금이 갔습니다.'`, 도시가스 건물이고 `shake ≥ pipeThr` 가 되는 순간 `expo.pipe = true` 와 기록 `'{건물}의 가스 배관이 충격으로 손상됐습니다.'` → `pipeEv`. 두 기록 모두 `{ role 'SYSTEM', actor '도시', kind 'hazard', tag 'struct', imp 1, truth: true, causes: [shakeEv, sig.ev] }`, 사건 없음(`incidentId −1` — 측정 도구는 `tag` 로 `building`). 건물 이름은 `'{주소} {이름}'`(터면 이름만), 길 위의 원인은 그 사건의 `truth.label`. `world.log` 에 신호마다 한 줄(`made −1`).
4. **`catastrophe.blockRoad`**: 사건 건물의 `Place.edgeId`(면한 길)를 먼저 보고, 그 구간이 닫혀 있거나 큰 차 기준 우회로가 없으면 예전 차례(사건 교차로의 `node.edges`)로. 조건(`!e.closed && findRoute(…, heavy)`)과 통제 기록·장부(`noteRoadCause 'close'`)는 그대로다.
5. **`applyExpo`** — `sceneManager.createScene` 의 `buildScene` 바로 다음(`initInjuries` 앞) 한 줄. 노출 칸이 없으면 아무것도 하지 않는다(만들지 않는다). `shake > 0` → `s.wear = { dmg: shake, soot: 0, cause: 'shock', inc: 가장 크게 흔든 사건의 code(없으면 ''), pre: 0 }`. `pipe` → 새는 밸브 하나(흐름 `expo:<사건>`): ① 실내 구획의 가구 칸 가운데 위·아래가 벽이고 맞닿은 바닥 하나가 대기 지점에서 걸어서 닿으며 불·소품·계단이 없는 칸(가구 → 바닥으로 바꾸고 밸브 — 가구가 이미 길을 막고 있었으므로 길이 끊기지 않는다), ② 없으면 같은 조건의 빈 바닥 가운데 막아도 걸어서 닿지 못하는 바닥이 늘지 않는 칸(16곳까지), ③ 둘 다 없으면 놓지 않는다. 걸어서 닿는가의 규칙은 `scenes/major.ts` 의 `reachable` 과 같다(잔해·문 소품은 지난다). **`s.rules`·`tickGas` 를 부르는 조건은 고치지 않았다.** 모든 유형의 사건에 걸린다(그 건물의 응급·수색 현장에도 밸브가 놓인다 — 본문 "평소 추첨이든 법칙이든 그 건물의 모든 사건에").
6. **`kit.baseScene`** 의 리터럴 끝에 `wear: undefined`(객체 모양 — 현장은 모두 `baseScene` 에서 만들어진다. `createScene` 은 리터럴이 아니라 고칠 것이 없다).
7. **`catastrophe.CAT.WEAR_INTEG`**(0.5) · `catOf` 의 처음 건전도 계산(`struct` 블록) 끝에 한 줄: `if (s.wear) 실내 구획마다 integ = min(integ, 1 − WEAR_INTEG × s.wear.dmg)` — 난수 없음, `bldg` 는 그 뒤에 계산된다. I2 의 `persist` 는 이 값을 읽으면 된다.
8. **측정**: `scripts/metrics.ts` 의 `S(I)` — `s.wear.cause === 'shock'` 이면 `building`(**h1 이 이미 넣어 두었다** — 이 덩어리는 고치지 않았다). `scripts/hazstats.ts` 에 **`hazard-shock:`** 줄(흔들린 건물 수(`shake > 0`) · 그 교대 수 · `S_MIN` 을 넘은 건물 수 · 배관이 끊긴 건물 수 · shake 의 사분위·최댓값 · 손상을 안고 시작한 현장(`s.wear` cause `'shock'`) 수와 그 가운데 새는 밸브가 놓인 현장 수)과 `--json` 의 `hazard.shock`.
9. **시험**(`tests/hazard.test.ts` 'I1-b b3-8 a·b' 일곱 — 3초 남짓, 대부분 `tickWorld` 한 번): 등록과 크기(손 계산 · 본문의 0.22·0.12·0.48·0.31·0.28 · 밖으로 나가지 않는 신호) · ① 폭발 신호(틈 안에만 · 손 계산 · 금 기록의 원인·진실·사건 없음·시스템 · 배관 문턱 · 둘째 충격은 더하고 기록은 되풀이하지 않는다 · `hazard-shock` 줄) · ① 전체 붕괴(실제 `collapseBuilding` 의 `mag 1` 신호 · 틈 3 이하 이웃의 금 기록 · 무너진 채 시작 0.35 ×) · ② 실제 `collapseRegion`(`0 < mag < 1`)·2차 붕괴·전소는 노출 칸도 기록도 없다 · ③ 손상된 건물의 다음 현장(화재 12곳·응급 4곳: `s.wear` · 처음 건전도 `min(…, 0.8)` · `bldg` 가 낮다 · 밸브는 배관이 끊긴 쪽에만, 화재 현장에는 반드시 · 세기 · 실내 · X6 의 가스 격자 · `s.rules`·`kind`·`variant` 그대로 · **걸어서 닿지 못하는 바닥이 밸브 없는 같은 현장과 같다** · 밸브 곁의 바닥 · 칸이 바뀐 것은 밸브 칸 하나뿐 · 노출이 없으면 `applyExpo` 가 아무것도 하지 않는다) · ⑥ 면한 길(사건 교차로의 첫 구간이 아닌 건물에서 `I.blockedEdge === Place.edgeId` · 장부 · 모든 시설에서 큰 차로 이어진다) · ⑦ 정보 격리(`s.rules`·`s.kind` 가 같고, `applyExpo` 를 다시 불러도 그대로, 밸브를 본 적 없는 경찰 순찰팀장의 `chooseMethod('perimeter')` 가 두 현장에서 같고 `'announce'` 가 아니다). 정보 격리 2(§6 I1-b 13 — h1 이 만든 시험)의 금지 글자에 `world.expo`·`applyExpo`·`shockDelta`·`shakeEv`·`pipeThr`·`placeState(`·`EXPO_LEAK` 을 더했다. `tests/causality.test.ts` 의 '세계 상태는 … 처음 값'은 노출 칸을 `shockSpread` 의 줄이 있는 교대에만(손상 > 0 · 건물) 받는다.

#### 본문과 다르게 한 곳

1. **길 위의 충격**(신호의 건물 없음 — 폭발물·CNG 버스): 본문은 건물의 벽-벽 틈만 말한다. 같은 식 `d = gap/CELL + PAD` 를 `neighborsOfPoint`(그 사건의 점에서 벽까지)에 그대로 쓴다 — 길 가운데의 교차로에서 벽까지는 대개 10 이상이라 폭발물(반경 3.4)·CNG(반경 3.0)는 사실상 닿지 않는다.
2. **쓸 수 없는 이웃(전소·전체 붕괴)은 흔들지 않는다**(본문에 없음) — 잔해 더미에 '금이 갔습니다' 기록을 남기지 않으려고. 그 건물은 법칙의 대상도 아니다.
3. **"가장 크게 보탠 기록"의 크기는 `PlaceExpo` 의 칸이 아니라 모듈의 `WeakMap`** 에 둔다(`PlaceExpo` 의 모양을 바꾸지 않으려고 — I2 가 저장할 자료는 그대로다). 교대가 이어지면 그 크기는 사라지지만 `shakeEv`·`shakeInc` 는 남는다.
4. **전소 신호의 `mag` 는 0**(본문은 다섯 자리의 값만 적었다).
5. `collapseRegion` 의 `mag` 분모는 "무너진 뒤의 실내 구획 칸의 합"이다(본문 "건물의 실내 칸" — 무너진 벽 칸이 그 구획에 들어간 뒤라 분자·분모가 같은 기준이다). 측정·기록용 — 충격 규칙은 받지 않는다.
6. **밸브의 세기 `EXPO_LEAK` 0.5~0.64**(본문은 정하지 않았다 — 가스 폭발 현장의 밸브와 같은 범위). 자리를 찾지 못하면 놓지 않는다(`expo.pipe` 는 참으로 남는다 — 그 현장의 생김새가 받지 못한 것).
7. `blockRoad` 의 면한 길은 그 구간이 사건 교차로에 닿아 있는지 따로 보지 않는다(`Place.edgeId` 는 그 건물의 교차로에 닿은 구간이다 — 시험 ⑥이 닿은 건물을 고른다).
8. L3 시험 ①의 "`structFail` 의 칸이 생긴다"는 법칙이 없어 **b3-8c 의 몫으로 남겼다**(이 덩어리의 ①은 금 기록과 `shake ≥ S_MIN` 까지). ④(개입 시험 — 폭발 직후 `world.expo` 를 비우면 `structFail`·`pipeLeak` 이 없다)·⑧(`pipeLeak` 이 닫히면 `expo.pipe` 를 거둔다)도 b3-8c. ⑤(노출이 없는 교대의 해시)는 시험이 아니라 해시 목록으로 봤다(아래).
9. 측정 도구의 `S(I)` 는 h1 이 이미 바꿔 두었다(작업 지시의 ⑤ — 고칠 것이 없었다).
10. **설계서의 "고칠 파일" 밖에서 고친 시험 하나**: `tests/sim.test.ts` 의 '2층 건물'(계단으로 이어진 2층 화재에서 2층에서 발견된 사람의 절반 넘게 구한다) — 표본을 시드 30개에서 40개로 넓혔다(`ccf16bf`). 충격 기록이 보통 S20 의 흐름을 바꿔 그 교대의 2층 화재가 다른 사건이 됐고(발견 23 → 26, 구함 12 → 13 — 그 현장에는 손상도 밸브도 없다), 구한 비율이 늘 50% 안팎이라 문턱(`> 발견 × 0.5`)을 사건 하나가 오간다. 40개로 전 13/24 · 뒤 14/27. 판정의 문턱은 그대로다(h2 가 같은 갈래로 두 시험의 표본을 다시 골랐다).

#### 해시로 본 것 (§5 의 "커밋을 둘로 나누고 확인하는 법" — 둘 다 상태·판단 커밋)

- **b3-8 a(`8305570`)**: 123줄 가운데 **60줄이 바뀌었고 모두 "전"의 교대에 X6 의 폭발·폭발물·전체 붕괴·무너진 채 시작한 사건 가운데 하나가 있었다**(`cmp.mjs` — 바뀌었는데 조건이 없던 줄 0). 조건이 하나도 없던 37교대의 해시는 그대로다. 조건이 있었는데 그대로인 26교대는 흔들린 건물이 `S_MIN` 에 못 미쳐 기록이 없었고(기록은 해시에 든다) 전체 붕괴가 없었거나 면한 길이 예전 차례의 첫 구간과 같았던 교대다.
- **b3-8 b(`00172e9`)**: a 뒤와 견줘 **바뀐 4줄이 모두 손상을 안고 시작한 현장(`s.wear`)이 있던 교대**다(그런 교대 5 가운데 4 — 남은 하나(극한 S0)는 손상이 0.012 라 처음 건전도가 0.994 로 결과에 닿지 않았다). 다섯 현장 모두 화재(`fire/std`)였고 넷이 옮겨붙은 불(L2)의 이웃 — 폭발한 열원 곁의 건물이 흔들린 뒤 불이 옮겨붙었다. 123교대 가운데 밸브가 놓인 현장은 보통 S33 하나.

#### 전후 수치 (§4 의 명령 전부 — 전 `h3/out-post2/` → 뒤 `h4/out-post1/`)

**X6 의 수**(전체 붕괴 · 전소 · 폭발 · 전원 철수 · 구획 붕괴):

| 조건 | 전 | 뒤 |
|---|---|---|
| **보통 120** | 22 · 20 · 34 · 80 · 202 | **22 · 19 · 34 · 78 · 202** |
| 보통 60 | 9 · 10 · 18 · 46 · 110 | 10 · 10 · 18 · 45 · 114 |
| 어려움 30 | 45 · 35 · 32 · 67 · 215 | 44 · 35 · 32 · 66 · 213 |
| 극한 30 | 95 · 85 · 64 · 92 · 380 | 97 · 87 · 67 · 99 · 387 |
| 태풍 20 | 6 · 2 · 3 · 11 · 34 | 6 · 2 · 3 · 10 · 33 |
| 홍수 20 | 3 · 3 · 11 · 12 · 26 | 그대로 |
| 지진 20 | 94 · 41 · 42 · 87 · 345 | 93 · 46 · 41 · 94 · 344 |
| 산불 20 | 35 · 28 · 18 · 40 · 170 | 35 · 29 · 15 · 34 · 169 |
| 해일 20 | 1 · 1 · 4 · 10 · 22 | 그대로 |
| 강제 `collapse/gasblast` 20 | 16 · 16 · 13 · 41 · 101 | 16 · 16 · 13 · 41 · 102 |
| 강제 `fire/std` 20 | 7 · 7 · 10 · 30 · 62 | 그대로 |

모두 흔들림 안이다(보통 120 에서 전체 붕괴·폭발은 한 건도 다르지 않다) — `WEAR_INTEG`·`SHOCK.K` 는 첫 값 그대로 둔다. 손상을 안고 시작한 현장이 교대당 0.03 뿐이라(아래) 처음 건전도의 효과가 X6 의 수에 드러날 만큼 많지 않다.

**충격 손상**(`hazard-shock` — 교대 전체):

| 조건 | 흔들린 건물 (교대) | `S_MIN` 을 넘은 건물 | 배관이 끊긴 건물 | shake p50 · 최대 | 손상을 안고 시작한 현장 (밸브) |
|---|---|---|---|---|---|
| **보통 120** | 86 (32) | **56** (교대당 0.47) | **11** | 0.15 · 0.92 | 3 (1) |
| 보통 60 | 45 (16) | 29 | 7 | 0.15 · 0.82 | 2 (1) |
| 어려움 30 | 88 (22) | 80 | 12 | 0.28 · 0.70 | 0 |
| 극한 30 | 163 (28) | 144 | 27 | 0.28 · 0.77 | 2 (0) |
| 태풍 20 | 15 (9) | 10 | 2 | 0.22 · 0.78 | 0 |
| 홍수 20 | 15 (11) | 6 | 0 | 0.07 · 0.36 | 1 (0) |
| 지진 20 | 173 (20) | 155 | 37 | 0.33 · 0.93 | 1 (0) |
| 산불 20 | 47 (16) | 34 | 6 | 0.26 · 0.76 | 0 |
| 해일 20 | 5 (2) | 3 | 0 | 0.26 · 0.50 | 0 |
| **강제 `collapse/gasblast` 20** | 56 (18) | **44**(목표 "10채 이상") | 8 | 0.21 · 0.74 | 0 |
| 강제 `fire/std` 20 | 15 (7) | 6 | 0 | 0.09 · 0.26 | 0 |
| 강제 `traffic/tree` 20 | 19 (7) | 14 | 1 | 0.23 · 0.76 | 0 |
| 강제 `traffic/pileup` 20 | 24 (9) | 20 | 7 | 0.39 · 0.61 | 0 |

- 본문의 어림(전체 붕괴 한 번에 틈 15 안 이웃 1.4채 · 금 기록 1채쯤 · 배관 손상 17%)과 같은 크기다: 보통 120 의 충격(전체 붕괴 22 + 폭발 34 + 무너진 채 시작한 사건)에 흔들린 건물 86 · 금 56 · 배관 11(흔들린 건물의 13%).
- **손상된 건물의 다음 사건은 드물다**(보통 120 에 3현장 · 밸브 1) — 본문의 조사("손상된 이웃 1~3채에서 나중에 우연히 사건이 날 확률은 3% 안팎")와 맞는다. (나)가 결과에 보이려면 (다)의 법칙(`structFail`·`pipeLeak` — b3-8c)이 있어야 한다는 본문의 말 그대로다.

**결과**(보통 60 · 어려움 30 · 극한 30 · 재난 다섯 × 20 — 사건 · 성공+대응 지연 · 실패+미해결 · 평균 대응 · 한계 시간·방치·출동 없음 · TRAFFIC_DELAY):

| 조건 | 전 | 뒤 |
|---|---|---|
| 보통 60 | 877 · 77.3% · 11.3% · 52 · 0·2·0 · 26 | 877 · **77.4%** · 11.2% · 52 · 0·2·0 · 26 (`shiftend` 1 → 2) |
| 어려움 30 | 551 · 61.2% · 21.8% · 66 · 3·4·2 · 29 | 551 · 60.8% · 22.0% · 67 · 5·4·1 · 27 |
| 극한 30 | 673 · 37.4% · 43.7% · 92 · 18·20·5 · 40 | 673 · 37.4% · 44.4% · 92 · 17·20·4 · 39 |
| 태풍 20 | 472 · 73.9% · 15.7% · 103 · 5·0·0 · 12 | 그대로(TRAFFIC_DELAY 11) |
| 홍수 20 | 417 · 64.5% · 14.1% · 90 · 5·1·1 · 33 | 418 · 64.6% · 14.1% · 90 · 5·1·1 · 33 |
| 지진 20 | 427 · 40.5% · 37.2% · 98 · 23·0·5 · 26 | 426 · 39.9% · 38.5% · 99 · 23·0·5 · 18 |
| 산불 20 | 327 · 62.4% · 20.8% · 79 · 9·0·1 · 29 | 328 · 63.4% · 20.1% · 79 · 10·0·1 · 29 |
| 해일 20 | 376 · 72.6% · 9.8% · 74 · 0·0·0 · 13 | 그대로 |

- 법칙 사건(L1·L2)·구멍·gain·부모·한 뿌리: 모든 조건에서 그대로이거나 ±1(보통 60: `natural` 32 · holes 0 · gain 0.094 · 최대 깊이 2). 보통 60 의 지표: 다른 사건을 가리키는 원인 909 → 917 · 세계 원인 92 → 93 · 확산 3단계 이상 10 → 10 · 재계획 50.0 → 50.1%(`fromWorld` 88 → 89) · 전환 58·33·400 → 59·34·417 · 엔트로피 0.99·3.12·2.54 그대로 · 교착 0 · 잊힘 0 · 반복 최대 6 · C1~C5 0.
- 강제 다섯(`traffic/tree`·`traffic/pileup`·`fire/std`·`collapse/gasblast`·`traffic/bus`)의 결과 표·한계 시간은 한 건(`fire/std` 실패 +1, `pileup` 의 `shiftend` 1 → `timeout` 1)을 빼고 그대로다. 다섯 모두 교착 0 · 잊힘 0 · 구멍 0 · C1~C5 0.
- **지진 20 에 교착 후보 하나가 생겼다**(전 0 → 1 — 아래 "알려진 것").

#### 관문

- **`npm run check` 통과**(마지막 코드·시험 커밋 `ccf16bf` — `h4/check2.log`, 11분): 테스트 **968 + 건너뜀 1**(파일 20개 — h3 끝의 961 에 'I1-b b3-8 a·b' 일곱), 보통 40 검증 통과(사건 586 · 성공 70% · 대응 지연 5% · 실패+미해결 13% · 한계 시간 0 · 방치 1 · 교대 끝 2 · 교착 0 · 잊힘 0 · C1~C5 0 · 최대 깊이 2 · `roadCrash` 19 · `heatSpread` 4 · 구멍 0). h3 끝의 같은 관문: 586 · 70% · 5% · 13%. 첫 판(`c40ca4f`)에서는 `tests/sim.test.ts` '2층 건물' 하나가 걸렸다(13 > 13 — 위 "본문과 다르게 한 곳" 10).
- **`sweep 40 --diff hard --check` 통과**(사건 733 · 성공 50% · 한계 시간 9 · 방치 8 · 출동 없음 2 · 교대 끝 1 · `roadCrash` 25 · `heatSpread` 10 · 버린 넘음 depth 1 · late 22 · 구멍 0 · 교착 0 · 잊힘 0 · C1~C5 0 · 최대 깊이 1) · **`--diff extreme --check` 통과**(896 · 27% · 22 · 24 · 8 · 교대 끝 10 · `roadCrash` 30 · `heatSpread` 19 · depth 3 · cap 7 · late 36 · 이야기 연쇄 36 · 교대 최대 인과 6건 · 최대 깊이 2 · 교착 0 · 잊힘 0 · C1~C5 0). h3 끝: 어려움 736 · 50% · 9 · 8 · 3 / 극한 893 · 27% · 24 · 24 · 9.
- **교대당 시간**(`h4/tools/timing.sh` — `sweep 12 --no-metrics` 를 전 `h3/post2`·뒤 `h4/post1` 번갈아 세 번): 사용자 CPU 전 32.6 · 32.1 · 30.7초 / 뒤 32.6 · 31.2 · 31.8초(×1.00), 교대당 1,039 · 1,057 · 989 / 1,053 · 992 · 1,044ms. 충격 규칙은 충격 신호가 올 때만(교대당 한두 번) 이웃 목록을 훑는다.
- 화면은 고치지 않았다(기록 문구 둘이 더해졌을 뿐 — 진실 기록이라 AI 시점의 기록에는 나오지 않는다). `npm run ui-check` 는 돌리지 않았다.

#### 알려진 것 · h5 에게

- **지진 20 S11 #19 `collapse/gasblast` 의 교착 후보(196초, 교대 끝 `shiftend`)**: 건물이 다 타고 무너진 뒤(잔해 수색 모드) 잔불 정리(`overhaul`) 넷이 열린 채 현장의 누구도 맡지 못한다 — `fitFor('overhaul')` 은 관창과 공기가 있어야 하는데 남은 대원이 순찰·구조·항공 구조대원과 공기가 바닥난 인근 도시 지원 펌프차뿐이다(지진 교대라 다른 진압 부대가 모두 묶였다). 그 현장에는 손상도 밸브도 없다 — 앞쪽의 충격 기록·면한 길이 바꾼 시각 때문에 경로가 갈라져 드러난 것이다(전에는 같은 사건이 1219초에 '해결'로 닫혔다). 관문(보통 기본 조건)의 조건은 아니지만 완료 조건 5 의 "재난에서 기준보다 늘지 않는다"에 걸리므로 b5 가 본다(맡을 사람이 없는 잔불 정리의 지원 요청 — `commander.needFor` — 이 지진 교대에서 채워지지 않는 길).
- **`structFail`·`pipeLeak`(b3-8c)**: 대상은 `world.expo` 에서 — `structFail` 은 `shake ≥ SHOCK.S_MIN` 이고 쓸 수 있는 건물(보통 120 에 56채 · 강제 `collapse/gasblast` 20 에 44채), `pipeLeak` 은 `pipe` 이고 쓸 수 있는 건물(보통 120 에 11채 · 강제 20 에 8채). 몫은 `{ ev: shakeEv(pipeLeak 은 pipeEv), inc: shakeInc, what: 'shake'·'pipe', ref: 건물 }`. 본문의 "확인 필요: `buildCollapse` 가 모든 건물 종류의 틀을 받는가"는 보지 않았다(`INCIDENT_PLACES.collapse` 의 종류는 `villa`·`construction`·`warehouse`·`shop`·`market`·`factory`·`houseS`·`apartment`·`farmhouse`·`storage`·`workshop`·`deptStore`·`stadium`·`temple`·`fishMarket` — L2 처럼 장소 표에 없는 종류를 빼면 흔들린 건물의 일부만 대상이 된다).
- **`expo.pipe` 를 거두는 규칙**(`pipeLeak` 이 낸 사건이 한계 시간·방치가 아닌 사유로 닫히면)은 상태 규칙이라 `rules/structure.ts` 의 `shockSpread` 다음에 두면 된다(신호 `'closed'`). 불티(L2 의 `'ember'` 항)도 같은 파일에서 `catastrophe` data 0·`blast` 를 받는 상태 규칙이 `hazardImpulse` 를 부르면 된다 — `shockSpread` 의 `shocked()` 처럼 이웃을 가까운 순으로 훑는다.
- **새는 밸브가 놓인 현장의 지휘**: 지휘관은 밸브를 본 대원의 `haz` 믿음으로 `mitigate` 를 낸다 — 그 일은 `skills.fire ≥ 0.3` 인 대원만 한다(`agents.fitFor`). 응급·수색 현장(구급·경찰만 온 현장)에 밸브가 놓이면 맡을 사람이 없어 B3 의 "맡을 사람이 없는 작업" 블록이 진압 부대를 부르는 길로 간다 — 이번 측정에서는 그런 현장이 하나도 없었다(밸브는 보통 S33 의 화재 현장 하나). `pipeLeak` 이 생기면 수가 늘어나므로 h5 가 `--force collapse/gasblast` 20교대에서 그 길이 끝나는지 본다.
- 손상을 안고 시작한 현장은 지금 교대당 0.03 이라 `s.wear` 의 처음 건전도가 결과에 거의 닿지 않는다 — b3-8c 의 법칙이 그 건물에 사건을 내면(그 사건의 현장도 `applyExpo` 를 지난다) 처음으로 드러난다. 그때 X6 의 수(보통 120)를 다시 보고, 벗어나면 `WEAR_INTEG`·`SHOCK.K` 를 줄인다(§8-22).
- 극한 S12 #14 의 `treatMate` 80회 반복(H1 쪽의 알려진 고리)은 그대로다(`repeat max 80`).

### b3-8 c · b3-9 — L3 의 법칙(`structFail` · `pipeLeak`) · L2 의 불티 · L7 `rekindle` · C10 `suspectZone` (2026-11-21, 덩어리 `h5`. 브랜치 `wf/causality-h5` → `wf/causality`, 시작점 `05fab10` = h4 끝을 받은 주 브랜치 — `src/`·`scripts/` 는 h4 의 마지막 코드 커밋과 한 글자도 같다)

커밋(차례대로): `structFail` `79a7e5b`(**법칙**) · `pipeLeak` + 상태 규칙 `pipeShut` + `STRUCT.A` 절반 `f3aecc6`(**법칙** — `pipeShut` 은 그 법칙이 낸 사건이 닫힐 때만 걸리므로 법칙 커밋에 넣었다) · 불티 `77c348b`(**법칙** — `heatSpread` 칸에 주는 충격. `laws/heat.ts` 의 조건을 `expo.ts` 로 옮긴 것은 해시 불변) · L7 `a1082ac`(**법칙** + `hazardCellFor` + `hazstats` 의 `hazard-ember` 줄) · 옛 시험 하나 `4c63d81`(`tests/causality.test.ts` — 아래 "본문과 다르게 한 곳" 13) · C10 `d934f3f`(**상태·판단**) · 분석 AI 의 '인근 붕괴·폭발' `646628d`(**상태·판단** — h4 가 남긴 b3-8 의 판단 몫) · 시험 `ec9ec1a`(시험만) · 옛 시험의 표본 `a5f3e35`(`tests/crews.test.ts` ⑤ — 아래 "본문과 다르게 한 곳" 15) (+ 이 메모). 등록된 법칙은 이제 다섯(`roadCrash`·`heatSpread`·`structFail`·`pipeLeak`·`rekindle`).

#### 기준 (h5 의 "전")

h4 의 뒤 측정이 같은 scratchpad 에 남아 있어(`<scratch>/wf-causality/h4/out-post1/` — §4 의 명령 전부와 보통 120) 그것을 "전"으로 썼다(`h4/post1/` 과 시작점의 `src/`·`scripts/` 가 같은 것을 `diff -r` 로 확인). 해시 목록은 h5 의 조건 칸을 붙여 다시 쟀다(`h5/hash-pre/hash.txt` — 해시 칸은 `h4/hash-b` 와 123줄 모두 같다. 줄 끝에 그 교대의 법칙 사건 수(다섯 법칙 · 그 가운데 불티가 주된 몫인 불), X6 의 폭발·전체 붕괴·무너진 채 시작한 사건, 총 든 용의자의 도주·재범·구역 위험 기록, 분석 AI 가 알려진 붕괴·폭발 곁의 붕괴·가스 신고를 평가한 횟수 `acond`·알려진 구역 위험 안의 무장 신고 `zcond`). 도구는 `h5/tools/`: `i1hash5.mts`·`hashrun5.sh`(해시 목록) · `cmp5.mjs`(바뀐 줄이 모두 조건이 있던 교대인가 — 전 `a`·뒤 `b` 의 칸으로 조건식) · `measure.sh`(§4 의 명령 전부) · `summ.mjs`·`x6tab.mjs`(표) · `reoff.mts`(재범이 조건으로 걸리는가) · `kinds.mts`(`buildCollapse`·`buildHazmat` 이 모든 건물 종류를 받는가) · `tune.mts`(법칙의 세기를 바꿔 강제 20교대를 잰다) · `timing.sh`. 뒤 측정은 `h5/out-post/`(시험 커밋 `ec9ec1a` 를 `git archive` 로 푼 `h5/post/` — `src/` 는 `646628d` 와 같다).

#### 실제 이름과 자리 (h6~h8 이 쓴다)

1. **`world/laws/shock.ts`**(새 파일 — `laws/index.ts` 의 `import './heat'` 다음 `import './shock'`): `STRUCT { A 5.0e-4, SEV2 0.3, SEV3 0.45, MAX 16, CAP 2 }` · `PIPE { A 1/300, SEV2 0.4, MAX 16, CAP 2 }`(시험이 `A` 를 키워 쓴다. `CAP` 은 등록할 때 한 번 읽힌다). 대상은 `damaged(sim, max, ok, visit)` — `world.expo` 를 건물 id 순으로(정수 열쇠의 `for…in`) 읽기만 하고 `placeState(…).usable === false`(전소·전체 붕괴)는 건너뛴다, 많아야 `MAX` 채. **종류로 거르지 않는다**(아래 "다르게 한 곳" 3).
   - `registerHazard({ id: 'structFail', label: '금 간 건물의 붕괴', every: 1, once: true, cap: STRUCT.CAP })`: 대상 `shake ≥ SHOCK.S_MIN`, 몫 `{ rate: STRUCT.A × (shake − S_MIN), ev: shakeEv, inc: shakeInc, what: 'shake', ref: 건물 }`. `spawn` = `collapse/std`, 규모는 넘는 순간의 금(주된 몫의 `rate` 에서 `rate / A + S_MIN` 으로 되찾는다) `≥ SEV3` 3 · `≥ SEV2` 2 · 아니면 1, 첫머리 '금이 가 있던 건물이 내려앉았습니다'.
   - `registerHazard({ id: 'pipeLeak', label: '끊긴 배관의 누출', every: 1, once: true, cap: PIPE.CAP })`: 대상 `pipe`, 몫 `{ rate: PIPE.A, ev: pipeEv, inc: shakeInc, what: 'pipe', ref: 건물 }`. `spawn` = `hazmat/std`, 규모 `expo.shake ≥ SEV2` 2 · 아니면 1, 첫머리 '충격으로 손상된 배관에서 가스가 샙니다'.
   - 흐름: 문턱 `hz:structFail:<건물>`·`hz:pipeLeak:<건물>`, 사건 `hz-spawn:<법칙>:<건물>:0`(틀 그대로).
2. **`world/laws/ember.ts`**(새 파일 — `import './shock'` 다음 `import './ember'`): `REKINDLE { CAP 2 }` · `registerHazard({ id: 'rekindle', label: '되살아난 잔불', every: 1, once: true, cap: REKINDLE.CAP, spawn })` — **`scan` 이 없다**(충격만 받는다). `spawn` = `{ type: 'fire', variant: 'std', severity: 1, placeId: target, note: '잔불이 되살아나 다시 불길이 올랐습니다' }`.
3. **`world/expo.ts`**(등록 없는 파일 그대로):
   - `laws/heat.ts` 안에 있던 대상의 조건을 뽑아 옮겼다 — `heatMul(kind)`(`heat.ts` 는 `export { heatMul } from '../expo'` 로 다시 내보낸다 — 옛 시험의 import 그대로) · `burnedPlaces(sim)` · **`fireTargetOk(sim, placeId, burned)`**(화재의 장소 표에 있는 종류 · 이번 교대에 아직 불이 나지 않았다 · 쓸 수 있다). `heatTargets` 는 이 함수를 부른다(해시 불변 — 불티 커밋의 해시 목록에서 불티가 없는 교대는 모두 그대로).
   - **불티**: `EMBER { K 0.25, NB_MAX 8 }` · `emberDelta(sig, gap, mul)` = `K × mul × (mag/50) × (SHOCK.CELL × size)² / (gap + 6)²` — 폭발(`catastrophe` data 0 · `blast`)만, 그 밖 0.
   - **잔열**: `RESIDUAL { K 1.0e-3, TAU 180, TAU_RAIN 120, MIN_DELAY 60, FIRE_MIN 0.04, HEAT_MIN 0.5, HEAT_W 0.25 }` · `residualOf(s)` = Σ(불 > `FIRE_MIN` 인 칸의 불) + `HEAT_W` × Σ(열 > `HEAT_MIN` 인 칸의 열), 칸마다 × (1 − 젖음), **실내 구역의 칸만**(아래 "다르게 한 곳" 7).
   - `applyExpo`: `pipe` 라도 그 현장에 이미 새는 밸브(`valve` 이고 `leakRate > 0`)가 있으면 더 놓지 않는다(아래 "다르게 한 곳" 4).
4. **`world/hazard.ts`**: `hazardCellFor(sim, lawId, target)` — 칸을 찾고 없으면 문턱을 뽑아 만든다(`cellOf` 그대로 — 흐름 `hz:<법칙>:<대상>[:n]`, 경로와 무관). 등록되지 않은 법칙이면 `null`. 쌓지 않는다. 닫힌 꼴의 식이 문턱을 미리 봐야 해서 더했다.
5. **`world/rules/structure.ts`**(등록 차례 `rubbleRoad` → `shockSpread` → `pipeShut` → `residualHeat` — 시험이 `consequences()` 의 차례를 본다):
   - **`shockSpread` 의 불티**: `embered(sim, sig)` — 이웃(`neighborsOf`, 길 위면 `neighborsOfPoint`)을 가까운 순으로 `fireTargetOk` 인 건물만 `EMBER.NB_MAX` 채까지, `emberDelta > 0` 인 것. `test` 는 "흔들 이웃이 있거나 불티를 보낼 이웃이 있는가"로 넓혔고, `apply` 끝(금을 적은 **다음** — 불티가 그 자리에서 넘으면 그 현장이 금 간 채로 시작한다)에서 이웃마다 `hazardImpulse(sim, 'heatSpread', 이웃, ΔH, { rate: ΔH, ev: sig.ev, inc: sig.inc, what: 'ember', ref: sig.place })`. 기록은 남기지 않는다. `heatSpread` 의 `spawn` 은 h3 이 이미 `what === 'ember'` 면 규모 2 와 첫머리 '폭발의 불티가 옮겨붙었습니다'를 낸다.
   - **`pipeShut`**: `{ id 'pipeShut', label '배관 차단', on ['closed'], key 'place:<건물>'(그 사건이 `pipeLeak` 의 사건일 때만 — `I.hz.law`), cooldown 0, cap ∞, spawns false }`. `test` = 그 사건의 `closeReason === 'resolved'` 이고 `expo.pipe`. `apply` = `expo.pipe = false`(금은 그대로, 기록 없음).
   - **`residualHeat`**: `{ id 'residualHeat', label '남은 열', on ['closed'], key 'inc:<사건>', cooldown 0, cap ∞, spawns false }`. e0 = `residualOf(그 현장)` — 교대 끝(`shiftend`)·건물이 없는 현장·쓸 수 없는 건물은 0. `test` = e0 > 0(그때만 `hazardCellFor` 로 칸을 만든다). `apply`: `τ` = 비면 `TAU_RAIN` 아니면 `TAU`, `H∞ = K × e0 × τ`, 남은 문턱 `need = thr − H`, `H∞ ≥ need` 면 `delay = max(MIN_DELAY, −τ × ln(1 − need / H∞))` 아니면 0 → `hazardImpulse(sim, 'rekindle', 건물, H∞, { rate: H∞, ev: 종료 기록(sig.ev), inc: 그 사건, what: 'residual', ref: 건물 }, delay)`. 넘지 않으면 칸에 `H∞` 만 남는다(기록·예약 없음). **유형을 묻지 않는다**(가스 폭발·붕괴 현장에 남은 불도 같다 — 본문 "원인들"). '재발화' 이름표는 넣지 않았다(본문 그대로).
6. **`world/rules/risk.ts`**(새 파일 — `rules/index.ts` 의 `import './structure'` 다음 `import './risk'`): `RISK { V 0.6, HOLD 300, COOLDOWN 120 }` · `registerConsequence({ id 'suspectZone', label '무장 용의자 도주', on ['fled'], key 'zone:<zoneOfXY(sig.x, sig.y)>'(-1·좌표 없음이면 `null`), cooldown 120, cap ∞, spawns false, test 참 })`. `apply`: `known` = 그 도주 기록이 진실이 아니다 → `setZone(sim, z, 'risk', 0.6, t + 300, sig.ev, known)`, 알려졌고 (값이 나빠졌거나 처음 알려졌으면) 기록 `{ role 'DISPATCH', actor '관제', kind 'dispatch', tag 'risk', imp 1, causes [도주 기록], text '{동네} 일대 무장 용의자 도주 — 인근 신고의 경계 단계를 높입니다.' }`. 회복 기록은 없다(`recover` 를 두지 않았다). 난수 없음.
7. **`field/hazards.ts`**(도주 블록): `REOFFEND { R 900, POLICE_R 400, WAIT 240 }` · `reoffendPlace(sim, I, rng)`(도주 지점 = 그 사건의 `truth.x·y` 에서 `R` 안, `ARMED_BIAS.robbery` 의 무게가 있는 종류, 터·출동 시설·이번 교대에 사건이 있던 건물·`placeGone` 은 뺀다, 무게로 `rng.weighted` — 없으면 −1) · `policeNear(sim, placeId)`(경찰 부대가 `available`·`returning` 이고 그 건물 가운데에서 `POLICE_R` 안 — 상공 부대도 친다) · **`reoffendItem(sim, I, h, at, cause)`**(장소 흐름 `reoffend-place:<사건>:<용의자>` — 새 흐름. 사건 흐름 `reoffend:<사건>:<용의자>` 는 b1 의 것 그대로). 건물을 골랐으면 `placeId`·`until = at + WAIT`·`when = 경찰이 곁에 없고 그 건물에 열린 사건이 없다`, 못 골랐으면 예전 예약(장소·조건 없음 — 평소 추첨). 도주 블록의 그 줄은 `reoffendItem` 을 부를 뿐 `s.rng.range(45, 100)` 의 차례는 그대로다.
8. **`incidents.ts`**: `ARMED_BIAS` 를 export(본문 §7).
9. **`dispatch/analyst.ts`**: `ZONE_SEV`(0.3, export) — 무장으로 평가하는 신고(장난 전화가 아니면)의 `knownZone(sim, knownZoneOfIncident(sim, I)).risk > 0` 이면 위험도 +0.3·근거 '인근 무장 용의자 도주', 그리고 (장난 전화 판정 뒤) `needs.law += 1`. **b3-8 의 판단 몫**(h4 가 남겼다): `shockNear(sim, I)` = 위치를 알고 `knownHazardNear(sim, I.reportedNode, 300, 180, I.id)` 의 `collapse || blast` — 붕괴·가스로 평가하는 신고에 위험도 `SPREAD_SEV`(+0.3)·근거 '인근 붕괴·폭발', 이름표 없음.
10. **측정**: `scripts/hazstats.ts` 에 **`hazard-ember:`** 줄(닫힌 건물 현장 수 · e0 > 0 인 현장 · e0 의 최댓값·p75·p50 · `rekindle` 칸 수 · H∞ 의 최댓값·p50 · 넘은 칸)과 `--json` 의 `hazard.ember`. `hazard-shock` 의 '배관이 끊긴 건물'은 이제 **한 번이라도 끊긴 건물**(`pipeEv ≥ 0` — `pipeShut` 이 거둔 뒤에도 센다)이고 `(shut again N)` 을 붙인다(`hazard.shock.shut`). `hazard-laws:` 줄에는 법칙이 저절로 붙는다. `scripts/metrics.ts` 의 `PHRASE`·`PROBLEM_SYS` 는 고치지 않았다(새 문구 셋은 법칙 사건의 첫머리라 `PHRASE` 에 걸리지 않고, 구역 위험 기록은 `tag 'risk'` 로 h1 이 이미 `hazard` 로 센다 — 시험 C10 이 `sysOf` 를 본다).
11. **시험**(`tests/hazard.test.ts` 'I1-b b3-8 c · b3-9' 열하나 — 방치 시험 말고는 `tickWorld`·`tickHazards`·`tickIncidents` 만 돈다. 파일 전체 66개가 23초): 등록과 크기(다섯 법칙의 차례 · `every`·`once`·`cap` · `rekindle` 의 `scan` 없음 · `laws/index.ts`·`rules/index.ts` 의 import 차례 · 상태 규칙의 차례 · 상수 · 불티의 손 계산 넷과 폭발이 아닌 신호의 0) · **L3 ①**(실제 전체 붕괴 신호 하나 → 틈 안 이웃의 금이 손 계산 `0.6 × (1 − g/15)` 이고 그 건물의 `structFail` 칸이 `A × (shake − S_MIN)` 만큼, 배관이 끊긴 건물에만 `pipeLeak` 칸 · `S_MIN` 아래 · 쓸 수 없는 건물은 칸이 없다) · **L3 ④ 개입**(같은 시드의 두 Sim 에 같은 전체 붕괴 — 한쪽만 붕괴 직후 `world.expo = {}`: 그쪽 칸은 붕괴 직후의 첫 주기 값에서 자라지 않고 사건 0. 다른 쪽(세기 ×40)의 사건은 그 금 간 건물(`hz.target`)에, 이웃 · 부모 = 붕괴한 사건 · 원인 = `shakeEv`/`pipeEv` · 내력 `shake`/`pipe` · 유형 · 규모 · 첫머리 · 그 현장의 `s.wear` 와 처음 건전도 `≤ 1 − 0.5 × shake` · 한 뿌리 둘까지 · 구멍 0) · **L3 ⑧**(배관이 끊긴 도시가스 건물의 `pipeLeak` 사건 — 규모 2 · 부모 없음 · 누출 현장의 밸브는 `applyExpo` 를 다시 불러도 늘지 않는다 · '해결'로 닫히면 `expo.pipe` 가 거짓, 금은 그대로, 그 건물의 다음 화재 현장에 밸브 없음 · 한계 시간으로 닫히면 그대로이고 다음 현장에 밸브) · **불티**(실제 폭발 신호 → 이웃의 `heatSpread` 칸이 `0.25 × M × 144/(g + 6)²`, 옮겨붙을 수 없는 종류는 칸 없음 · 붕괴 신호는 불티 없음 · 세기 ×50 이면 넘는다: `fire/std` 규모 2 · 부모 = 폭발한 사건 · 원인 = 폭발 기록 · 내력 `['ember']` · `ref` = 원인 건물 · 첫머리) · **L7 ①**(실내 열 칸에 불 0.5 → e0 = 5 · `hazardCellFor` 로 본 문턱에 맞춰 `K` 를 H∞ = 1.5 × 문턱이 되게 → 예약 시각이 `max(60, τ ln 3)` · 장소 · 부모 · 원인 = 종료 기록 · `until − at = HZ.HOLD` · 칸이 `done` → 그 시각에 `fire/std` 규모 1 · 내력 `residual` · 첫머리. H∞ < 문턱이면 칸에 H∞ 만, 예약·새 기록 없음) · **L7 ②③④**(같은 화재 둘에서 한쪽만 닫기 전에 불을 0 → 예약도 칸도 없다 · 젖음 0.9 → e0 × 0.1, 불 0 이면 0 · 열은 `HEAT_W` 만큼 · 건물 밖 칸의 불은 세지 않는다 · 전소 건물과 교대 끝은 예약도 칸도 없다) · **C10 재범**(장소 = 같은 흐름으로 고른 건물 · 강도 종류 · 900 안 · 원인 · `until − at = 240` · `policeNear` 는 대기·귀소만 · 경찰이 머물면 사건 없이 `'expired'` · 없으면 그 건물에 `armed/robbery`, 부모·원인 · 900 안에 건물이 없으면 장소·조건 없는 예전 예약) · **C10 구역 위험**(부대가 본 도주 → `risk 0.6`·`known`·원인·회복 시각, 관제 기록 하나(문구·원인·`sysOf` 'hazard'), 분석 AI 위험도 +0.3·경찰 +1, 쿨다운 안의 둘째 도주는 걸리지 않는다, 아무도 보지 못한 도주는 진실만 · 기록 없음 · 분석 그대로, 300초 뒤 회복) · **분석 AI 의 '인근 붕괴·폭발'**(위치를 아는 붕괴 기록 곁의 붕괴·가스 신고 +0.3 · 이름표 없음 · 진실 기록·위치를 모르는 사건은 치지 않는다) · **§6 I1-b 11 (다) 방치 시험**(금 0.4 를 적은 건물과 아닌 건물에 같은 화재 · 대원 없이 `tickScene` 만 600초: 처음 건전도 `≤ 0.8` 이고 멀쩡한 쪽 이하, 첫 구획 붕괴가 같거나 이르다 — 건물 셋).

#### 본문과 다르게 한 곳

1. **`STRUCT.A` 는 첫 값의 절반(5.0e-4)**. 첫 값(1.0e-3 · `PIPE.A` 1/300)으로 강제 `collapse/gasblast` 20교대를 재니(`h5/s2/`) 금 간 건물 49채에서 `structFail` 넘음 7 · 사건 4, `pipeLeak` 3 — 합 7건으로 끝내는 조건(1~4) 밖이었다. 0 이 아니라 많아서 붕괴 계수·틈·`S_MIN` 이 아니라 세기를 줄였다(`h5/tools/tune.mts` — `h5/tune-gas-*.txt`: 4e-4 · 1/900 은 1 + 3, 5e-4 · 1/600 은 1 + 3, 고른 5e-4 · 1/300 은 불티 전 판에서 1 + 3). 누출은 배관이 일찍 끊기면 `A` 와 거의 상관없이 넘어 `PIPE.A` 는 첫 값 그대로다. 마지막 판에서는 그 강제 20교대의 `structFail` 이 넘음 2 · 사건 0(하나는 교대 끝 뒤라 'late', 하나는 기다리는 줄에서 60초를 넘겨 'expired' — 불티가 흐름을 바꿨다)이라 합이 누출 4 다(아래).
2. **`pipeShut` 은 '해결'로 닫힐 때만**(본문: "한계 시간·방치가 아닌 사유로 닫히면"). 남은 사유 가운데 교대 끝(`shiftend`)은 새는 채로 끝난 것이고 출동 없음(`noresponse`)은 아무도 잠그지 않은 것이라 둘 다 거두지 않는다.
3. **`structFail`·`pipeLeak` 은 건물 종류로 거르지 않는다** — 본문의 "확인 필요"(`buildCollapse` 가 모든 건물 종류의 틀을 받는가)를 `h5/tools/kinds.mts` 로 봤다: 장소 표에 없는 종류를 포함해 모든 `PlaceKind` 에서 `collapse/std`·`hazmat/std` 현장이 만들어지고 모든 바닥에 걸어서 닿는다(처음에 가스 누출 현장 하나가 "끊긴 칸 8"로 나왔는데 밸브 칸을 바닥으로 센 측정의 잘못이었다).
4. **누출 현장에는 `applyExpo` 가 밸브를 더 놓지 않는다**(본문에 없음): `pipeLeak` 이 낸 `hazmat/std` 현장은 `buildHazmat` 이 새는 밸브를 이미 놓는다 — 둘이면 한 손상의 누출을 두 번 센다. 그 현장의 `s.wear`(금)는 그대로 받는다.
5. **불티·잔열의 상수와 함수는 `world/expo.ts`**(본문은 `K_EMBER`·`K_RE` 의 자리를 정하지 않았다): 상태 규칙(`rules/structure.ts`)이 법칙 파일(`laws/*`)을 import 하면 등록 차례가 import 차례에 묶이므로, 둘이 함께 쓰는 것은 등록 없는 파일에 둔다. 같은 까닭으로 L2 의 대상 조건을 `heat.ts` 에서 `expo.fireTargetOk` 로 옮겼다(h3 메모의 "b3-8c(불티)에게"가 말한 그대로 — 해시 불변). 폭발 하나가 불티를 보내는 건물 수 `EMBER.NB_MAX` 8 은 본문에 없다(L2 의 열 항과 같은 수).
6. **`shockSpread` 의 `test` 를 넓혔다** — 흔들 이웃이 없어도(작은 폭발의 틈 12 밖) 불티를 보낼 이웃이 있으면 걸린다. 금을 먼저 적고 불티를 준다.
7. **잔열 e0 는 실내 구역의 칸만 센다**(본문: 닫힌 현장의 배열 전체). h3 의 불 요약(`fireLoad`)과 같은 까닭이다 — 산불 현장의 타는 숲·마당의 불은 그 건물의 잔불이 아니다. 그리고 **사건의 유형을 묻지 않는다**(본문의 "대상: 닫힌 화재 현장의 건물"과 "원인들: … 화재가 아닌 유형의 현장에 남은 불(가스 폭발 뒤, 붕괴 현장)" 가운데 뒤쪽을 따랐다 — 화재가 아니어도 그 건물 안에 불씨가 남았으면 같다).
8. **`hazard.hazardCellFor`** 를 더했다(본문의 §7 표에 없음 — 닫힌 꼴의 식은 넘는 시각을 문턱에서 거꾸로 풀어야 하는데 `hazardCell` 은 칸이 없으면 `null` 이다). 문턱의 흐름·뽑는 차례는 `cellOf` 그대로라 칸을 미리 만들어도 결과가 같다(`residualHeat` 의 `test` 는 e0 > 0 일 때만 부른다 — L7 ② 시험이 "칸도 없다"를 본다).
9. **C10 의 규칙 파일 이름은 `rules/risk.ts`**(본문 `rules/…`). `policeNear` 는 상공의 경찰 헬기도 친다(`dept === 'police'` 만 본다 — 본문 그대로의 조건). **`when` 에 "그 건물에 열린 사건이 없다"를 더했다**(평소 추첨이 열린 사건이 있는 교차로를 피하는 것과 같은 까닭 — 한 건물에 무장 사건 둘). 장소는 이번 교대에 사건이 있던 건물을 뺀다(`pickPlace` 의 엄격한 갈래와 같다), 무게는 `ARMED_BIAS.robbery`, 고르는 난수는 새 흐름 `reoffend-place:<사건>:<용의자>`(사건의 흐름 `reoffend:<사건>:<용의자>` 는 그대로).
10. **구역 위험의 관제 기록은 값이 나빠졌거나 처음 알려졌을 때만**(같은 동네에서 120초 넘게 지나 다시 도주하면 회복 시각만 늘고 기록은 되풀이하지 않는다). 회복 기록은 두지 않았다(본문에 없음). 분석 AI 의 +0.3 · 경찰 +1 은 **무장으로 평가한 신고에만**(본문 "무장·폭력 신고" — 폭력은 따로 있는 유형이 아니다), 장난 전화로 본 신고는 뺀다.
11. **분석 AI 의 '인근 붕괴·폭발'(b3-8 의 판단 몫)** 은 h4 가 남긴 것을 이 덩어리에서 따로 커밋했다(`646628d`).
12. **`hazstats` 의 '배관이 끊긴 건물'** 은 h4 에서 "지금 끊긴 건물"이었는데 `pipeShut` 이 거두면 줄어들어 한 번이라도 끊긴 건물(`pipeEv ≥ 0`)로 바꾸고 거둔 수를 따로 붙였다 — h4 의 표와 같은 뜻으로 견줄 수 있다.
13. **설계서의 "고칠 파일" 밖에서 고친 시험 하나**: `tests/causality.test.ts` 의 '연쇄 사건의 발생 기록이 원인을 가리킨다'가 법칙 사건을 빼고 이야기 연쇄(`J.hz === undefined`)만 본다(`4c63d81`). 강제 `armed/kidnap` S0 에서 끊긴 배관의 누출(부모 = 금을 남긴 사건, 원인 = 배관 손상 기록 — 부모의 기록이 아니다)이 걸렸다. 법칙 사건의 원인은 `tests/hazard.test.ts` 가 본다(L3 ④ 의 `K.cause === pipeEv`). **`f3aecc6`·`77c348b`·`a1082ac` 세 커밋에서는 이 시험 하나가 실패한 채였다**(법칙 커밋을 따로 세우느라 시험 커밋을 뒤에 두었다).
14. **L3 ④ 의 "그쪽에는 칸이 없다"는 "칸이 자라지 않는다"로** 봤다: `tickWorld` 한 번이 신호 단계(금을 적는다)와 그 틱의 1초 주기(칸을 만든다)를 함께 돌아, 붕괴 "직후" 비울 수 있는 가장 이른 때에 칸이 이미 첫 주기 값으로 있다. 비운 뒤 300초 동안 H·문턱·`done` 이 그대로이고 사건 0 이다.
15. **설계서의 "고칠 파일" 밖에서 고친 시험 둘째**: `tests/crews.test.ts` 의 ⑤ '구출은 유압 구조대원이 맡는다'(유압 구조대원이 현장에 있는 동안 구출을 붙든 시간 가운데 그 사람의 몫 ≥ 0.5) — 표본 교대 넷 가운데 K1 SEV5 `traffic` 을 K6 SEV5 `traffic` 으로 바꿨다(`a5f3e35`, 문턱 0.5 그대로 · 교대·정원·넘겨받기의 불변 조건을 보는 아래 고리는 K1 을 그대로 돈다). C10 의 재범 자리(`d934f3f`)가 K1 의 흐름을 바꿔 그 교대의 가스 폭발(구조 대상 9)·붕괴 현장에 유압 구조대원이 늦게 닿거나 짝 기다림(R3)·누출 조치에 묶인 동안 다른 대원이 붙들었다 — 그 교대의 몫 223/486 → 197/1,030, 넷의 합 0.527 → 0.406. `h5/tools/extr2.mts` 로 넓은 표본(K1~K6 × SEV5 `traffic`·SEV5 `collapse`·보통 `collapse`, 18교대)을 재 보니 **h5 전에도 0.497**(뒤 0.445 — 달라진 것은 K1 두 교대뿐)이라, 이 문턱은 R1 이 고른 표본 넷에 기대고 있었다(X6 의 위험 구역 동안을 빼도 0.495 — 위험 구역 탓이 아니다). 바꾼 표본 넷은 h5 앞뒤로 같은 값(0.563)이다. R1 쪽의 몫으로 알린다(아래 "알려진 것").

#### 해시로 본 것 (§5 — 법칙 커밋: 바뀐 줄 = 그 법칙의 사건이 있는 교대, 상태·판단 커밋: 바뀐 줄 ⊆ 조건)

- **`structFail`(`79a7e5b`, `A` 1.0e-3)**: 전 → 뒤 바뀐 5줄 = `structFail` 사건이 난 5교대 그대로(사건이 났는데 그대로인 줄 0 · 바뀌었는데 사건이 없는 줄 0).
- **`pipeLeak` + `pipeShut` + `A` 절반(`f3aecc6`)**: 전 → 뒤 바뀐 10줄 = `structFail` 이나 `pipeLeak` 사건이 난 10교대 그대로. 앞 커밋 → 뒤는 11줄, 모두 앞이나 뒤에 법칙 사건이 있던 교대.
- **불티(`77c348b`)**: 바뀐 3줄이 모두 폭발이 있던 교대(폭발이 있던 59교대 가운데 56 은 그대로 — 불티는 문턱 밑의 충격이면 아무것도 바꾸지 않는다): 보통 S15·극한 S0 은 불티가 주된 몫인 옮겨붙은 불, 극한 S16 은 불티가 더한 H 로 열 항의 넘음이 앞당겨졌다.
- **L7(`a1082ac`)**: **바뀐 줄 0** — 123교대 어디에도 `rekindle` 사건이 없다(아래 "정직한 값").
- **C10(`d934f3f`)**: 바뀐 19줄이 모두 총 든 용의자가 달아난 교대(그런 교대 21 가운데 19 — 남은 둘(보통 S16·S32)은 재범이 나지 않았고 구역 위험 기록도 없는 도주였다: 진실만 바뀌는 구역 값은 관제가 읽지 않는다).
- **분석 AI(`646628d`)**: 바뀐 25줄이 모두 알려진 붕괴·폭발 곁의 붕괴·가스 신고를 평가한 교대(`acond > 0` 인 30교대 가운데 25).
- 마지막 판의 123줄: `structFail` 이 난 교대 2 · `pipeLeak` 9 · 불티 불 2 · 재범 8 · 알려진 구역 위험 안의 무장 신고 평가(`zcond`) 5.

#### 전후 수치 (§4 의 명령 전부 — 전 `h4/out-post1/` → 뒤 `h5/out-post/`)

**법칙 사건**(`hazard.byLaw`) · 한 뿌리 최대 · 최대 깊이 · 구멍:

| 조건 | 전 | 뒤 |
|---|---|---|
| **보통 60** | road 28 · heat 4 | road 27 · heat 4 · **pipeLeak 1** · rekindle 0 · structFail 0 (넘음 1 — 버림) · 한 뿌리 2 · 깊이 2 · 구멍 0 |
| 보통 120 | (h4 는 `--metrics` 없이) | road 56 · heat 9 · **pipeLeak 2** · structFail 0 · rekindle 0 · 한 뿌리 2 · 깊이 2 · 구멍 0 |
| 어려움 30 | heat 8 · road 18 | road 19 · heat 7 · pipeLeak 1 · **rekindle 1** · 한 뿌리 2 · 깊이 1 |
| 극한 30 | heat 12 · road 19 | road 20 · heat 14 · **pipeLeak 4 · structFail 1** · 한 뿌리 2 · 깊이 2 |
| 태풍 20 | road 13 | road 13 · pipeLeak 1 |
| 홍수 20 | road 19 · heat 1 | road 19 · heat 2 · rekindle 1 |
| 지진 20 | road 5 · heat 1 | road 5 · heat 1 · structFail 1 · pipeLeak 2 (rekindle 넘음 3 — 모두 버림) |
| 산불 20 | road 9 · heat 3 | road 9 · heat 3 · pipeLeak 2 · rekindle 1 |
| 해일 20 | road 10 · heat 1 | 그대로 |
| **강제 `collapse/gasblast` 20** | road 9 · heat 4 | road 8 · heat 5 · **pipeLeak 4** · structFail 0(넘음 2 — 'late' 하나 · 'expired' 하나) → **`structFail` + `pipeLeak` = 4**(끝내는 조건 1~4) |
| 강제 `fire/std` 20 | road 9 · heat 3 | road 8 · heat 5 |
| 강제 `traffic/tree` 20 | road 8 · heat 4 | 그대로(pipeLeak 넘음 1 — 버림) |
| 강제 `traffic/pileup` 20 | road 8 · heat 3 | road 8 · heat 3 · structFail 1 |
| 강제 `traffic/bus` 20 | road 13 · heat 1 | road 13 · heat 1 · pipeLeak 1 · structFail 1 |

모든 조건에서 한 뿌리의 법칙 사건 ≤ 2 · 최대 깊이 ≤ 2 · 구멍 0 · C1~C5 0. 보통 60 의 `dropped depth` 0 → 3 가운데 둘은 보통 S20 의 `pipeLeak`(660초)·`structFail`(931초) 넘음이 한 뿌리 상한(`HZ.ROOT_MAX` — `hazardRoom` 은 이것도 'depth' 로 적는다)에 걸린 것이다: 그 뿌리(가스 폭발 #3)에서 이미 법칙 사건 둘(끊긴 배관의 누출 #6 · 교통사고 #9)이 났다(`h5/tools/droppeek.mts`·`incs.mts`). 나머지 둘(보통 S15·S33 의 `pipeLeak`)은 교대 끝 뒤라 'late' 다. 본문의 어림("보통 60교대에 `structFail` + `pipeLeak` 2~5건")보다 적은(1건) 까닭이 이것과 `STRUCT.A` 절반이다.

**L7 의 정직한 값**(`hazard-ember` — 닫힌 건물 현장 · 불씨가 남은(e0 > 0) 현장 · e0 최댓값 · 넘음): 보통 60 677 · 4 · 0.44 · 0(H∞ 최대 0.08) · **보통 60 의 `rekindle` 0건** · 보통 120 1,344 · 13 · 0.44 · 0 · 어려움 30 417 · 6 · 25.9 · 1 · 극한 30 503 · 5 · 23.5 · 1(버림) · 지진 20 341 · 16 · 30.0 · 3(버림) · 홍수 20 270 · 2 · 11.9 · 1(사건 1) · 산불 20 272 · 13 · 11.1 · 2(사건 1). 본문의 조사 그대로 — 잘 끈 화재는 닫힐 때 불 칸이 0 이고 잔불 정리가 열을 지워 e0 가 0 이다. 넘음은 e0 최댓값이 10 을 넘는 조건(어려움·극한·지진·홍수·산불)에만 있었다 — 보통·태풍·해일은 e0 가 0.44 아래라 H∞ 가 0.08 아래다.

**재범이 조건으로 걸리는가**(`h5/tools/reoff.mts` — 어려움·극한 S0~S29, 예약을 `gen.chain` 에서 처음 볼 때 `when` 을 감싸 거짓이었던 적을 센다):

| 조건 | 총 든 용의자의 도주 | 재범 예약 (장소를 고른 것) | 경찰이 곁에 있어 기다린 예약 | 만들어진 재범 (기다린 뒤) | 기다리다 버린 것 (`expired`) | 구역 위험 기록 |
|---|---|---|---|---|---|---|
| 어려움 30 | 8 | 5 (5) | **2** | 5 (2) | 0 | 3 |
| 극한 30 | 68 | 21 (21) | **4** | 17 (3) | **1**(극한 S18 — 경찰이 240초 내내 그 곁에 있었다) | 12 |

모든 예약이 도주 지점 900 안의 건물을 찾았다(평소 추첨으로 돌아간 것 0). 극한의 남은 3(예약 21 − 만들어짐 17 − expired 1)은 교대 끝 가까이 예약돼 꺼낼 때 'late' 로 버려졌다(`h5/tools/droppeek.mts`).

**X6 의 수**(전체 붕괴 · 전소 · 폭발 · 전원 철수 · 구획 붕괴 — 손상된 건물의 사건이 처음으로 생겨 h4 가 다시 보라고 한 것):

| 조건 | 전 | 뒤 |
|---|---|---|
| **보통 120** | 22 · 19 · 34 · 78 · 202 | **21 · 19 · 34 · 77 · 194** |
| 보통 60 | 10 · 10 · 18 · 45 · 114 | 9 · 10 · 17 · 44 · 107 |
| 어려움 30 | 44 · 35 · 32 · 66 · 213 | 43 · 35 · 34 · 63 · 211 |
| 극한 30 | 97 · 87 · 67 · 99 · 387 | 96 · 89 · 68 · 95 · 395 |
| 지진 20 | 93 · 46 · 41 · 94 · 344 | 92 · 44 · 41 · 94 · 340 |
| 산불 20 | 35 · 29 · 15 · 34 · 169 | 36 · 28 · 16 · 30 · 169 |
| **강제 `collapse/gasblast` 20** | 16 · 16 · 13 · 41 · 102 | **20 · 18 · 16 · 45 · 122** |
| 강제 `fire/std` 20 | 7 · 7 · 10 · 30 · 62 | 8 · 10 · 12 · 34 · 63 |

보통 120 은 흔들림 안이다 — `WEAR_INTEG`·`SHOCK.K` 는 그대로 둔다. 강제 `collapse/gasblast` 의 증가는 그 교대들의 누출 넷이 낸 것이다: 끊긴 배관의 누출(금 간 채로 시작한 카페 — 강제 S4 #16)이 가스 폭발 → 화재 → 전소 · 전체 붕괴로 커졌다(사용자의 예 "건물이 붕괴되어서 더 큰 사고로 이어진다"의 두 번째 고리가 실제로 돈다). 그 사건은 교대 끝(`shiftend`)으로 닫혔지만 교착이 아니다(끝까지 잔불 정리 중 — 교착 후보 0).

**충격 손상**(`hazard-shock` — 흔들린 건물 · `S_MIN` 을 넘은 건물 · 한 번이라도 끊긴 배관 (다시 거둔 것) · 손상을 안고 시작한 현장 (밸브)): 보통 120 86 · 56 · 11 → 84 · 54 · 11 (2) · 현장 3 (1) → **6** (1) · 보통 60 45 · 29 · 7 → 43 · 27 · 7 (1) · 2 → 3 · 극한 30 163 · 144 · 27 → 162 · 144 · 27 (1) · 2 → **7** (4) · 강제 `collapse/gasblast` 56 · 44 · 8 → 56 · 45 · 7 (3) · 0 → **4** (1) · 지진 20 173 · 155 · 37 → 174 · 155 · 38 (1) · 1 → 4. 손상을 안고 시작한 현장이 h4 의 두 배 남짓 — 늘어난 것은 거의 모두 L3 의 법칙 사건 자신(그 건물의 금을 안고 시작한다)이다.

**결과**(사건 · 성공+대응 지연 · 실패+미해결 · 평균 대응 · 한계 시간·방치·출동 없음 · TRAFFIC_DELAY):

| 조건 | 전 | 뒤 |
|---|---|---|
| 보통 60 | 877 · 77.4% · 11.2% · 52 · 0·2·0 · 26 | 877 · **77.7%** · 11.1% · 52 · 0·2·0 · 27 (`shiftend` 2 → 1) |
| 어려움 30 | 551 · 60.8% · 22.0% · 67 · 5·4·1 · 27 | 551 · 61.7% · 21.4% · 66 · 6·4·1 · 29 |
| 극한 30 | 673 · 37.4% · 44.4% · 92 · 17·20·4 · 39 | 673 · 37.6% · 44.9% · 92 · 14·21·5 · 36 |
| 태풍 20 | 472 · 73.9% · 15.7% · 103 · 5·0·0 · 11 | 473 · 73.8% · 15.6% · 104 · 6·0·0 · 10 |
| 홍수 20 | 418 · 64.6% · 14.1% · 90 · 5·1·1 · 33 | 420 · 64.8% · 14.0% · 90 · 5·1·1 · 34 |
| 지진 20 | 426 · 39.9% · 38.5% · 99 · 23·0·5 · 18 | 426 · 40.6% · 38.7% · 98 · 23·0·6 · 17 |
| 산불 20 | 328 · 63.4% · 20.1% · 79 · 10·0·1 · 29 | 328 · 64.0% · 19.5% · 79 · 9·0·1 · 28 |
| 해일 20 | 376 · 72.6% · 9.8% · 74 · 0·0·0 · 13 | 375 · 73.3% · 9.6% · 74 · 0·0·0 · 13 |

- 보통 60 의 지표: 다른 사건을 가리키는 원인 917 → 924 · 세계 원인 93 → 94 · 확산 3단계 이상 10 → 7 · 재계획 50.1 → 50.2%(`fromWorld` 89 그대로) · 전환 59·34·417 → 58·33·332 · 엔트로피 0.99·3.12·2.54 → 0.99·3.13·2.54 · 교착 0 · 잊힘 0 · 반복 최대 6 · C1~C5 0.
- 강제 다섯의 결과: `collapse/gasblast` 성공 171 → 163 · 실패 52 → 53 · 한계 시간 3 → 3 · **교대 끝 0 → 3**(늦게 난 사건 셋 — 위의 누출 하나 · 옮겨붙은 불 하나 · 평소 화재 하나) · `fire/std` 성공 201 → 200(한계 시간 5 그대로) · `traffic/tree` 한 건도 다르지 않다 · `pileup` 성공 189 → 190 · 한계 시간 2 → 1 · `bus` 성공 204 → 206 · 실패 40 → 37. 다섯 모두 교착 0 · 잊힘 0 · 구멍 0 · C1~C5 0, 반복 최대 9·8·5·7·5.
- **어려움 30 에 교착 후보 하나가 생겼다**(전 0 → 1 — 아래 "알려진 것"). 극한 30 의 반복 최대 80 → 8(H1 쪽의 `treatMate` 고리가 있던 사건이 흐름이 갈라져 다른 사건이 됐다 — 고친 것이 아니다).

#### 관문

- **`npm run check` 통과**(옛 시험의 표본 커밋 `a5f3e35` — `h5/check2.log`, 10분): 테스트 **979 + 건너뜀 1**(파일 20개 — h4 끝의 968 에 'I1-b b3-8 c · b3-9' 열하나), 보통 40 검증 통과(사건 586 · 성공 70% · 대응 지연 5% · 실패+미해결 13% · 한계 시간 0 · 방치 1 · 교대 끝 1 · 교착 0 · 잊힘 0 · C1~C5 0 · 최대 깊이 2 · `roadCrash` 18 · `heatSpread` 4 · `pipeLeak` 1 · 구멍 0). h4 끝의 같은 관문: 586 · 70% · 5% · 13% · `roadCrash` 19. 첫 판(`ec9ec1a` — `h5/check.log`)에서는 `tests/crews.test.ts` ⑤ 하나가 걸렸다(0.406 ≥ 0.5 — 위 "다르게 한 곳" 15). 이 메모의 커밋은 문서만 고친다.
- **`sweep 40 --diff hard --check` 통과**(사건 734 · 성공 49% · 한계 시간 11 · 방치 8 · 출동 없음 2 · 교대 끝 3 · `roadCrash` 26 · `heatSpread` 9 · `pipeLeak` 2 · `rekindle` 1 · 버린 넘음 depth 1 · late 34 · expired 1 · 구멍 0 · 교착 후보 1(위의 어려움 S5 — 어려움은 교착 관문 밖) · 잊힘 0 · C1~C5 0 · 최대 깊이 1) · **`--diff extreme --check` 통과**(894 · 27% · 20 · 24 · 9 · 교대 끝 10 · `roadCrash` 31 · `heatSpread` 21 · `pipeLeak` 5 · `rekindle` 1 · `structFail` 1 · depth 6 · cap 8 · late 57 · expired 2 · 이야기 연쇄 34 · 교대 최대 인과 6건 · 최대 깊이 2 · 교착 0 · 잊힘 0 · C1~C5 0). h4 끝: 어려움 733 · 50% · 9 · 8 · 2 / 극한 896 · 27% · 22 · 24 · 8.
- **교대당 시간**(`timing.sh` — `sweep 12 --no-metrics` 를 전 `h4/post1`·뒤 `h5/post` 번갈아 세 번): 사용자 CPU 전 34.4 · 34.2 · 35.9초 / 뒤 33.7 · 36.9 · 32.9초(×0.99). 벽시계(1,769~2,397ms/교대)는 첫 두 쌍에 이 덩어리의 다른 측정이 함께 돌아 믿을 수 없다. 새 법칙 둘은 `world.expo` 의 칸(교대당 수 채)만 훑고, 잔열은 사건이 닫힐 때 한 번이다.
- 화면은 고치지 않았다(새 기록 문구 넷 — 법칙 사건 첫머리 셋과 구역 위험 — 과 `hazstats` 줄뿐). `npm run ui-check` 는 돌리지 않았다.

#### 알려진 것 · h6 에게

- **어려움 S5 #07 의 교착 후보(149초, 한계 시간 '실패')**: C10 이 고른 재범 자리(도주 지점 곁의 서점 — 강도가 잘 나는 `shop`)에서 총 든 용의자 둘 가운데 하나가 엄폐 뒤에서 대치하는 채로 280초가 간다. 진입(`engage`, 0.9)에는 혼자 들어간 순찰대원 하나뿐이고 나머지 둘은 봉쇄(0.76·0.71)에 묶여 있다(0.22 규칙 — 둘의 `fitFor('engage')` 는 0.72·0.73), 지휘관은 피격돼 가벼운 일만 한다(`fitFor` 0.29). 진입조의 둘째가 구조 대상을 업고 나간 뒤 봉쇄로 돌아갔다. 재범 자리가 바뀌어 드러난 현장 전술의 길(CLAUDE.md "우선순위 차이 0.22 규칙" — 진입이 정해진 뒤 진입조가 빠지면 다시 채우지 않는다)이라 b5(또는 R3 의 경찰 줄)가 본다. 관문(보통 기본 조건)의 조건은 아니다. h4 가 적은 지진 20 S11 #19 의 교착 후보도 그대로(1)다.
- **`tests/crews.test.ts` ⑤ 의 구출 몫(≥ 0.5)은 넓은 표본에서 0.50 안팎이다**(위 "다르게 한 곳" 15 — 18교대 h5 전 0.497). 흐름이 조금만 바뀌어도 다시 걸릴 수 있다. 본 장면(K1 SEV5 `traffic` #14 `collapse/std`): 유압 구조대원 둘 가운데 하나는 누출 조치(`mitigate/seal`), 하나는 짝 기다림(`pair` — R3 의 짝 진입)이라 소방대원·탐색 대원이 기본 장비로 붙들었고, 넘겨받기(`RELIEF_GAP`)는 손 빈 대원만 하므로 일어나지 않았다. R1/R3 쪽(짝 기다림 중인 장비 좋은 대원의 넘겨받기)이 볼 일이다.
- **`structFail` 은 드물다**: 보통 120 에 0건(넘음은 보통 60 에 1 — 한 뿌리 상한으로 버림), 강제 `collapse/gasblast` 20 에 0건(넘음 2 — 교대 끝 뒤 하나, 기다리다 버린 것 하나). 금 간 건물 대부분이 그 교대의 가스 폭발·전체 붕괴의 이웃이라 뿌리가 같은 옮겨붙은 불·교통사고와 한 뿌리 상한(2)을 나눠 쓴다. 균형을 다시 볼 때는 `STRUCT.A` 보다 먼저 이 몫을 본다(`hazstats` 의 `hazard-laws` 줄 — `structFail cells … crossed … made …`).
- **L7 은 보통 교대에 0건이 정직한 값이다**(본문 §3.7 L7 — 사용자 결정으로 N9 뒤 화재 균형 때 "탄 칸의 잔열"과 함께 다시 본다). '재발화' 이름표는 넣지 않았다. `hazardCellFor` 는 칸을 만들고 문턱을 뽑으므로 충격을 줄 자리에서만 부른다.
- **`pipeShut` 뒤의 노출**: 배관을 거둬도 금(`shake`)은 남아 `structFail` 의 대상으로 남는다. I2 의 `PlaceCarry` 는 `pipe` 가 거짓이 된 값을 받는다.
- C10 의 구역 위험은 지금 분석 AI 만 읽는다(무장 신고의 위험도 +0.3 · 경찰 +1). b3-10 의 구역 상태(정전 등)도 같은 `knownZone` 을 쓴다 — `ZONE_SEV` 와 이름이 겹치지 않게 본다.
- h5 의 도구(`h5/tools/`)는 h4 의 것을 h5 의 조건 칸으로 다시 쓴 것이다. 다음 덩어리는 `i1hash5.mts` 의 칸 끝에 자기 조건을 붙여 쓰면 된다.
