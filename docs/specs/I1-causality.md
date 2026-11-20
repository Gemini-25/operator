# I1 — 인과관계와 시스템 통합

공통 규칙은 `docs/specs/README.md`. 본보기: `N4b-crime.md`(연쇄 사건·`gen.chain`), `T1-traffic.md`(정보 격리를 도로에 적용한 방식, `known`).

사용자가 보내 준 검토 의견의 요지: **"사건의 수를 늘리는 것보다, 사건 하나에서 발생할 수 있는 상황의 수를 늘리는 것."** 새 사건 유형을 더하지 말고, 이미 있는 시스템(도로·부대·건물·병원·관제·현장) 사이에 실제 인과관계를 만든다. 지금의 `causes` 는 원인을 적기만 하고, `gen.chain` 은 예약된 시각에 후속 사건을 만들기만 한다. 이 둘을 세계 상태의 변화와 잇는다. 성공률을 무조건 높이는 쪽으로 맞추지 않는다. 실패도 결과다.

이 문서는 두 부분이다.

| 부분 | 누가 | 결과가 바뀌는가 | 내용 |
|---|---|---|---|
| **I1-a 측정 도구** | **구현됨**(이 세션 — 브랜치 `wf/i1a`, 합침 `48dba83`. 고정한 기준 커밋에서 만들었다, §2.15) | **바뀌지 않는다** — `src/` 를 한 줄도 고치지 않는다 | 지표 여덟 가지와 기록·상태 일치 검사, `sweep` 의 새 줄과 `--json` 키, 관문 조건, `tests/causality.test.ts` |
| **I1-b 인과 규칙과 세계 상태 결합** | **다음 구현 세션**. R1 → H1 → X6 → R2 → R3 다음(§3.10 의 표시한 부분은 X6 와 함께) | 바뀐다(0단계만 해시 불변) | 세계 상태 자료, 인과 규칙의 틀(`registerConsequence`), 첫 규칙 11개, 조건으로 일어나는 연쇄, 무한 연쇄 막기, 보고서의 사슬 문장 |

## 구현 상태 (이 세션에서 구현·합침 — I1-a, §2)

**I1-a 는 구현됐다**: `scripts/metrics.ts`(지표 여덟 가지·일치 검사·틱 표본), `scripts/sweep.ts` 의 지표 줄·`--json` 의 `problems`·`reportHash`·`metrics`·`--metrics`·`--no-metrics`·지표 관문, `tests/causality.test.ts`(브랜치 `wf/i1a`, `15c9ec3`·`eb28fbe`·`23365a0`·`e14704e`, 합침 `48dba83`). 결과 해시는 바뀌지 않았다. 관문은 `npm run check` 에 들어가 있다(교착 후보 0·잊힌 사건 0 — `STALL_ALLOW`·`FORGOT_ALLOW` 0). 기준선은 `docs/ROADMAP.md` "지금 상태". **구현이 설계서와 다르게 한 곳**(코드가 정본 — 본문도 맞춰 고쳤다):

1. **§6 테스트 2 의 왕복 예** — 설계의 예(hazard → field → hazard → field → hazard)는 field 가 기본 세 시스템이라 field 로 들어가는 간선의 무게가 0 이어서 raw 가 2 다(3·4 가 아니다). 구현 시험은 기본 밖의 두 시스템 **hazard ↔ road** 로 raw 4 · distinct 2 를 확인한다(§2.5·§6-2 를 고쳤다).
2. **`replan.byCode` 의 `'ASSESS'`** — 문제 코드가 아니라 평가 변경 갈래(첫 도착 뒤 평가가 바뀜)의 열쇠다(§2.6).
3. **`S(I)` 의 `carry`** — I2 가 요청한 ②(그 현장에 `s.wear` 가 있다 · 그 사건에 배정된 부대에 `status 'off'` 대원이 있었다)가 구현에 들어 있다(§2.3 표).

교대 사이에 남는 상태(대원·장비·건물·도로를 "이어받은 상태"로 다음 교대의 입력에 넣기)는 `I2-persistence.md` 의 몫이다. I1-b 는 I2 가 그대로 저장할 수 있는 모양(함수가 없는 순수 자료)으로 세계 상태를 만든다(§3.3).

줄 번호는 2026-11-14 `a746b77`(B1 1차·B3·P1·Q1 을 합친 뒤) 기준이다. 앞 묶음(R1·H1·X6 …)이 합쳐지면 바뀌므로 **함수 이름으로 찾는다**. 확신하지 못한 곳은 **(확인 필요)** 로 표시했다. 측정 숫자 가운데 "설계 시험"이라고 적은 것은 이 문서를 쓰며 저장소 밖의 임시 스크립트로 `a746b77` 의 시드 S0~S2(보통, 멈춤은 S0~S7)만 잰 작은 표본이다.

**I1-a 자기 파일**(새로): `scripts/metrics.ts`, `tests/causality.test.ts`. **고치는 파일**: `scripts/sweep.ts`. **건드리지 않는다**: `src/` 전부. 브랜치 `wf/i1a`(같은 세션의 B1·G5 가 `src/` 를 고치므로 결과 불변 증명을 기준 커밋에 묶는다 — §2.15).
**I1-b**: 브랜치 `wf/causality`, 개발 서버 포트 **5218**(보고서 화면 확인용). 자기 파일과 공용 파일 수정은 §7.

## 원칙

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

## 3. I1-b 인과 규칙과 세계 상태 결합 (다음 구현 세션)

### 3.1 원칙

- 규칙은 **"조건 → 결과"** 다. 조건은 세계 상태(진실)를 읽어도 된다(`hazards.ts` 와 같은 자격). 결과는 상태를 바꾸고, 바꾸는 그 자리에서 `emit(…, causes: [원인 기록])` 한다. 사건을 새로 만들 때는 그 사건의 발생 기록이 원인을 가리킨다.
- 결과의 크기는 **유계**다: 모든 상태 변화에 회복 시각(`until`)이 있고, 사건을 만드는 규칙에는 깊이·쿨다운·상한이 있다.
- **관제·지휘관은 알려진 것만** 쓴다. 규칙이 상태를 바꿔도 AI 가 곧바로 아는 것은 아니다. 알림·보고·제보로 `known` 이 켜진다(§3.8).
- 처음부터 다 만들지 않는다. 지금 있는 **도로·부대·건물·피해**에 잇는 규칙부터(C6 → C3 → C2 → C9 → C10), 기반 시설(C4·C8·C11)과 환경(C5·C7)은 뒤에.

### 3.2 세계 상태 — 이미 있는 것과 새로 둘 것

| 영역 | 이미 있는 것 (그대로 쓴다) | 새로 둘 것 (`sim.world`) |
|---|---|---|
| 도시 | 구간의 `closed`·`closedReason`·`known`·`slow`·`cong`·`bump`·`wait`, 장애물(`traffic.obstacles`) | 구역(동네) 위험 `zones[z].risk` |
| 건물 | 사건별 `Scene` 의 파손·탄 자리(`glass`·`decorHp`·`burned`·`burnedTiles`). (X6) 교대 안의 건물 상태 `Sim.placeMarks`(`scorched`·`blasted`·`partial`·`burnt`·`collapsed`, `burnFrac`·`ruinFrac`). (I2) 지난 교대의 겹침 표 `sim.carryState.places` | **새로 두지 않는다.** 읽는 함수 `placeState(sim, placeId)` 하나만(X6 의 표 → I2 의 겹침 표 순서로) |
| 기반 시설 | 재난의 `d.dark`(정전), 현장 격자의 `s.shadow`(무전 음영) | `zones[z].power`·`comms`·`water` 와 회복 시각·알려짐·원인 |
| 의료 | 응급실 대기(같은 교차로의 `hospital` 부대 수) | `hospitals[h]`: 수용 한도·응급실 체류 환자·포화(`divert`)·알려짐 |
| 조직 | 부대 상태·대원 `health`·`stamina`·`status`, 장비(`pumpCond`·`flashbangs`·물), 인근 도시 지원 | 없음(R1·H1 이 만든다). I1-b 는 원인 연결만(§3.11) |
| 시민 | 현장의 구조 대상·신고자 | 없음 |
| 환경 | 날씨(교대 내내 고정), 재난의 수위·불머리·`speedMul` | `zones[z].smoke` |

구역(zone)은 `cityPlan.DISTRICTS` 의 동네 18곳이다(`DISTRICTS` 순서가 인덱스). 건물은 `Place.dong` 으로, 점은 `districtAt(x, y)` 로 구역을 찾는다. **`districtAt` 은 가까운 동네를 고르는 함수가 아니다**: 모든 동네의 반지름 × 1.22 밖이면 `null` 을 돌려준다(`city.ts:45-53`). 그래서 건물의 `Place.dong` 은 `districtAt(...)?.dong ?? (산이면 '산촌' : '외곽')` 이고(`city.ts:318`), `'산촌'`·`'외곽'` 은 `DISTRICTS` 에 없다. 정한 것:

- `zoneOfXY(x, y)` = `districtAt(x, y)` 의 `DISTRICTS` 인덱스, `null` 이면 **-1**.
- `zoneOfPlace(sim, placeId)` = `Place.dong` 과 이름이 같은 `DISTRICTS` 의 인덱스, 없으면(`'산촌'`·`'외곽'`) **-1**.
- **구역 -1 은 어느 구역 상태도 받지 않고 어느 구역 상태도 만들지 않는다.** 구역을 고르는 모든 규칙(C4·C5·C7·C8·C10·C11)은 -1 을 건너뛴다. 범위로 고르는 규칙("700 안에 가운데가 있는 동네")은 `DISTRICTS[z]` 의 가운데로 재므로 -1 이 생기지 않는다. 외곽 건물의 사건은 구역 상태 없이 평소대로 돈다(외곽은 밀도가 낮아 잃는 것이 적다).

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
export type SignalKind = 'blast' | 'collapse' | 'fireBig' | 'delivered' | 'fled' | 'closed' | 'catastrophe';
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
| `catastrophe` | X6 의 실제 폭발·붕괴·전소 순간(§3.10) | `data` = 0 폭발 · 1 붕괴 · 2 전소 |

X6 은 `tickFire` 의 천장 붕괴를 지우고 `blast` 에 `catOnBlast` 를 더한다(X6 §9 단계 3). 같은 일을 두 신호로 보내지 않는다: X6 이 대체한 자리(천장 붕괴, 2차 붕괴가 X6 의 `collapseRegion` 으로 옮겨진 경우)에서는 `collapse` 신호를 지우고 `catastrophe` 만 남긴다. 규칙은 `collapse`·`catastrophe(data 1)` 를 같은 것으로, `blast`·`catastrophe(data 0)` 를 같은 것으로 받는다. X6 이 부르는 `blast` 에서 신호를 끄는 방법은 §7 의 `hazards.ts` 줄(선택 인자).

- **`spawnConsequence`** — 규칙이 사건을 만드는 유일한 길. `gen.chain` 에 `{ at: t + rng.range(…delay), until: at + wait, when, opts: { ...opts, parent?, cause: sig.ev, csq: id, rng: sim.rng.fork('csq-spawn:' + id + ':' + n) } }` 를 넣는다(평소 생성기의 흐름을 건드리지 않는다). `n` = 늘리기 전의 `world.spawned`(이번 교대에 규칙이 예약한 사건의 순번 — 한 발동이 둘을 예약해도 서로 다르다. 거절된 것은 세지 않는다). 거절(깊이·상한)도 `gen.dropped` 에 남긴다.
- `createIncident` 는 `opts.cause` 가 있으면 발생 기록(`rootEvent`)의 `causes: [opts.cause]`, `I.cause = opts.cause`, `I.csq = opts.csq`.
- 규칙 파일: `src/sim/world/rules/{record,hospital,structure,infra,spread}.ts`, 모으는 `src/sim/world/rules/index.ts` 를 `engine.ts` 가 import 한다(`sceneManager.ts` 의 `import './scenes'` 처럼). **import 순서 = 규칙 등록 순서 = 결과**다. 순서를 바꾸면 결과가 바뀐다는 주석을 둔다.

### 3.5 `gen.chain` 을 조건으로 일어나게 넓히기

기존 예약(`{ at, opts }`)은 **그대로 동작**한다. 항목에 선택 칸 둘을 더한다.

```ts
chain: { at: number; opts: SpawnOpts; when?: (sim: Sim) => boolean; until?: number }[];
```

`tickIncidents` 의 꺼내는 자리(`incidents.ts:171-174`)를 이렇게 바꾼다:

1. `sim.t >= at` 인 첫 항목 k(지금과 같다).
2. `when` 이 있고 거짓이면: `until` 이 지났으면 꺼내 버리고 `dropped.push({ why: 'expired' })`, 아니면 `at = sim.t + 5`(5초 뒤 다시 본다)로 두고 이번 틱은 넘어간다.
3. 꺼낸 뒤 교대 끝 150초 전이 지났으면 `'late'`, 열린 사건이 `maxConcurrent` 를 넘으면 `'busy'`, `chainDepth(parent) + 1 > DEPTH_MAX` 면 `'depth'` 로 버리고 기록한다(지금은 기록 없이 버린다). 버린 일은 기록(`emit`)하지 않고 `gen.dropped` 에만 남긴다 — 일어나지 않은 일을 로그에 남기면 가짜 연출이 된다. 보고서는 `dropped` 를 숫자로만 쓴다.

`when` 은 `sim` 의 상태만 읽는 함수여야 한다(바깥 변수를 바꾸지 않는다). 쓰는 예: 정전으로 멈춘 승강기는 "그 동네가 아직 정전일 때만"(C4), 도주한 용의자의 재범은 "목표 건물 400 안에 경찰 부대가 없을 때만"(C10).

### 3.6 무한 연쇄 막기

| 장치 | 값 | 어디서 |
|---|---|---|
| 깊이 상한 `DEPTH_MAX` | 새 사건의 `chainDepth ≤ 3` (뿌리 0) | `spawnConsequence`·`tickIncidents` — **기존 연쇄(재범·방화·도주 차량·은신처)에도** 건다. **Z1 이 합쳐졌다**(`2812fe6`, `src/sim/chain.ts`): 기존 연쇄는 이미 `canChain`(`CHAIN_MAX` 3 = 뿌리를 포함한 사건 수 → 깊이 2, `CHAIN_SHIFT_MAX` 6)으로 막힌다. I1-b 는 `chainDepth = chainLen − 1` 로 정의를 맞추고, 규칙이 만드는 사건의 `DEPTH_MAX` 와 Z1 의 상한 가운데 어느 쪽을 정본으로 둘지 b0 에서 정한다(권고: Z1 의 `canChain` 을 `spawnConsequence` 도 부르게 하고 `DEPTH_MAX` 를 `CHAIN_MAX − 1` 로 — 상한이 둘이 되지 않게). "지금 재범은 상한이 없다"는 Z1 전의 문장이다 |
| 규칙 쿨다운 | 규칙표(§3.7)의 열쇠별 초 | `tickWorld` |
| 규칙 상한 | 규칙표의 교대당 수 | `tickWorld` |
| 전체 상한 `CSQ_SPAWN_CAP` | 규칙이 만드는 사건 교대당 6 (보통. `tune.csqMul` 이 있으면 곱한다 — 선택) | `spawnConsequence` |
| 시간 | 교대 끝 150초 전부터 만들지 않는다 | `tickIncidents`(지금과 같다) |
| 부하 | 열린 사건이 `maxConcurrent` 를 넘으면 버린다 | `tickIncidents`(지금과 같다, 기록만 더한다) |
| 포화되는 상태 | 구역 값은 덮어쓰기(`min`/`max`)지 누적이 아니다. 모든 값에 `until` | 규칙 |
| 순환 금지 | 상태 규칙끼리는 한 방향만: 정전 → 통신(C4 → C8), 화재 → 연기(→ 호흡 곤란). 통신·연기는 정전·화재를 만들지 않는다 | 규칙표 |
| 같은 자리 한 번 | 재발화는 건물마다 한 번, 폭발 불씨는 사건마다 한 번 | 쿨다운 열쇠 |

테스트(§6)와 I1-a 관문 M-G3(I1-b 뒤 3으로 낮춘다)이 지킨다.

### 3.7 첫 규칙

| # | id | 원인 → 결과 | 먼저 있는 것과의 관계 | 넣는 단계 |
|---|---|---|---|---|
| C6 | `divertRecord` | 부대 전환·부족 → 원래 사건의 지연을 기록하고 보고서 문장 | `DIVERTED`·`NO_UNIT` 을 잇는다 | b3-1 |
| C3 | `hospitalLoad` | 다수 사상자 → 응급실 포화 → 먼 병원 이송·이송 중 목적지 변경 | 응급실 대기 공식에 더한다 | b3-2 |
| C2 | `rubbleRoad` | 붕괴·큰 폭발 → 사건이 끝난 뒤에도 남는 잔해(장애물), X6 이 막지 않은 폭발 | X6 의 붕괴 통제를 이어받는다, T1 의 `addObstacle` | b3-3 (X6 와 함께) |
| C9 | `rekindle` | 잔불을 남기고 끝난 화재 → 재발화 | X6 의 건물 상태(`placeMarks`)를 읽는다 | b3-4 |
| C10 | `suspectZone` | 무장 용의자 도주 → 구역 위험·근처 재범 | 기존 재범 연쇄를 고친다 | b3-5 |
| C1 | `blastSpread` | 폭발 → 반경 안 건물 화재 | | b3-6 (X6 와 함께) |
| C5 | `smokePlume` | 큰 화재 → 인근 구역 연기 → 호흡 곤란 신고·시야 | | b3-7 |
| C4 | `powerOut` | 변전소·발전소 사고(·태풍·지진) → 구역 정전 → 신호 고장·승강기 갇힘·교차로 사고 | 재난 정전을 구역 단위로 | b3-8 |
| C8 | `commsDown` | 방송국·관제탑 사고, 긴 정전, 지진 → 무전 음영 증가 | 현장 `s.shadow` 에 더한다 | b3-9 |
| C7 | `floodLow` | 홍수 수위 → 저지대 지하 공간·지하차도 사건 | 홍수 큐에 조건 사건을 더한다 | b3-10 |
| C11 | `waterMain` | 붕괴·지진 → 수도관 파손 → 소화전 수압 저하 | (선택) | b3-11 |
| C12 | `stormPileup` | 태풍·홍수의 비바람 + 막힌 간선 → 다중 추돌 | 사용자 예시 사슬의 첫 화살표(§3.12). 날씨 고정 교대에는 걸지 않는다(§9) | b3-12 (선택) |

숫자는 모두 첫 값이다. 단계마다 §4 로 재고 맞춘다.

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

#### C9 `rekindle` — 잔불 재발화

- **건물 상태는 X6 의 것**: 전소·붕괴 건물에서 그 교대에 새 사건을 내지 않는 것은 X6 이 이미 한다(`placeMarks` 의 `burnt`·`collapsed`). C9 는 `placeState` 를 읽기만 한다. (X6 이 아직 없을 때의 대체는 만들지 않는다 — 구현 순서상 X6 이 먼저다.)
- **재발화 조건**: 화재 현장(`s.kind === 'fire'` 또는 `burnedTiles > 0`)이 `resolved`·`timeout`·`abandoned` 로 닫혔고(`shiftend` 제외), 닫힐 때 불씨(`fire > 0.04`) 칸 ≥ 1 또는 열(`heat > 0.5`) 칸 ≥ 4 가 잔불 정리(`overhaul`)를 끝내지 않은 구역에 있다.
  `placeState(...).mark` 가 `burnt`·`collapsed` 면 하지 않는다(X6 이 그 건물을 닫았다).
- **결과**: 확률 `min(0.6, 0.15 + 0.05 × 뜨거운 칸)` 으로 `spawnConsequence(fire/std, placeId 같은 건물, severity 1, parent I.id, note '잔불이 되살아나 ○○에서 다시 불길이 올랐습니다', delay [240, 480])`. 이 사건은 같은 건물이라도 만든다(`pickPlace` 의 `used` 를 거치지 않는다 — `placeId` 를 정해 준다).
- 쿨다운: 건물마다 교대에 한 번. 상한 2. 난수 `csq:rekindle:inc:<id>`.
- 관제: 화재 신고의 알려진 위치(`I.reportedNode`)와 위치 진술의 `placeKind` 로 `knownBuildingAt(sim, I.reportedNode, placeKind)` 가 이번 교대에 닫힌 화재 사건을 돌려주면 분석 AI 가 이름표에 '재발화'를 붙이고 위험도 +0.3(`analyst.ts` 의 이름표·위험도 자리). 분석 AI 는 `I.truth.placeId` 를 읽지 않는다(CLAUDE.md 4 — `dispatch/*` 는 진실 금지).

#### C10 `suspectZone` — 도주한 무장 용의자

- **기존 재범 연쇄 고치기**(`hazards.ts:516`): `rng: sim.rng.fork('reoffend:' + I.id + ':' + h.id)` 를 넘긴다(평소 생성기 흐름을 더 이상 건드리지 않는다 — **모든 시드 중 이 연쇄가 생긴 교대의 결과가 바뀐다**). 장소는 도주 지점에서 900 안의 `ARMED_BIAS.robbery` 종류 건물(없으면 평소 추첨. `ARMED_BIAS` 는 지금 `incidents.ts` 의 export 되지 않은 상수라 export 한다 — §7), `csq: 'reoffend'`, `cause` = SUSPECT_FLED 기록(`raiseProblem` 의 반환값, 0단계 1번). `when`: 목표 건물 400 안에 경찰 부대(`dept === 'police'`, `available` 또는 `returning`)가 없을 때, `until = at + 240`.
- **구역 위험**(신호 `fled`): 도주 지점의 동네(`zoneOfXY(sig.x, sig.y)` — 세계 규칙이라 진실 위치를 쓴다. -1 이면 하지 않는다) `risk = max(risk, 0.6)`, `until = t + 300`, `known` = SUSPECT_FLED 기록이 진실이 아니면(부대가 본 도주 — `hazards.ts` 의 `truth: s.arrivedAt < 0`). 알려지면 `emit({ role: 'DISPATCH', actor: '관제', kind: 'dispatch', tag: 'risk', imp: 1, causes: [도주 기록], text: '○○동 일대 무장 용의자 도주 — 인근 신고의 경계 단계를 높입니다.' })`.
- **관제가 쓰는 곳**: 분석 AI 가 새 신고의 구역을 `knownZoneOfIncident(sim, I)`(알려진 교차로 `I.reportedNode` 의 동네 — 진실 x/y 금지)로 구하고, `knownZone` 의 `risk` 가 있으면 그 동네의 무장·폭력 신고에 위험도 +0.3, `needs.law` +1.
- 쿨다운: 동네마다 120초. 난수 `csq:suspectZone:zone:<z>`.

#### C1 `blastSpread` — 폭발 불씨가 옆 건물로 (X6 와 함께)

- **조건**: 신호 `blast`(size ≥ 3) 또는 `catastrophe`(폭발). 원인 사건의 깊이 < 3.
- **후보**: 원인 지점(`I.truth.x, y`)에서 `R = 40 + 18 × size` 안, `facility < 0`, `!open`, 열린 사건이 없고, **`placeState(sim, id)?.usable !== false`**(X6 은 `pickPlace` 에서 `burnt`·`collapsed` 건물을 빼지만 C1 은 `placeId` 를 정해 주므로 그 규칙을 비켜 간다 — 여기서 같은 조건을 건다)인 건물 가운데 종류가 `houseS·houseL·villa·apartment·shop·restaurant·market·convenience·cafe·warehouse·workshop·storage·factory`. 원인 건물 자체는 뺀다. id 순으로 돈다(결정적).
- **결과**: 후보마다 확률 `0.3 × (1 − d/R)`, 많아야 2곳에 `spawnConsequence(fire/std, placeId, severity d < R/2 ? 2 : 1, parent I.id, note '폭발의 불씨가 옮겨붙어 ○○에서 불이 났습니다', delay [20, 60], when)`. `when` = 20~60초 뒤 실제로 만들 때 **그 건물에 아직 열린 사건이 없고 `placeState(...)?.usable !== false`**(그 사이에 다른 사건이 그 건물을 골랐거나 무너졌을 수 있다). 거짓이면 §3.5 대로 5초 뒤 다시 보고 `until`(기본 120초)이 지나면 `'expired'`.
- 쿨다운: 원인 사건마다 한 번. 상한 교대당 4. 난수 `csq:blastSpread:inc:<id>`.
- 관제: 새 사건은 평소처럼 신고로 알려진다. 분석 AI 는 **알려진 폭발**이 180초 안에, 300 안에 있었으면 그 근처 화재 신고의 위험도 +0.5. 알려진 폭발 = 어떤 사건 J 의 `J.problems` 에 있는 `EXPLOSION`(X6) 가운데 그 기록이 진실이 아닌 것(현장 대원이 보고 남긴 것, `truth === false`)이고 `t ≥ sim.t − 180`. 거리는 `city.nodes[J.reportedNode]` 와 `city.nodes[I.reportedNode]` 사이(둘 다 알려진 위치 — 진실 x/y·`world.signals`·`world.log` 를 읽지 않는다).

#### C5 `smokePlume` — 큰 화재의 연기

- **조건**(world tick): 열린 화재 현장의 불 칸(`fire > 0.2`) 수 ≥ 30 이 45초 넘게 이어짐(현장마다 시각을 기억), 또는 산불 불머리가 살아 있다(`d.front`, `d.stopped` 없음).
- **결과**: 원인 지점 450 안의 동네 `smoke = max(smoke, 0.6 × min(1, 불 칸 / 60))`(산불은 0.7), `until = 불이 기준 아래로 내려간 시각 + 120`. 처음 한 번 `emit({ role: 'SYSTEM', actor: '재난안전본부', kind: 'hazard', tag: 'smoke', imp: 1, causes: [그 현장의 마지막 ESCALATION 또는 불 관련 기록], text: '○○ 화재의 연기가 △△동으로 번지고 있습니다. 창문을 닫아 주십시오.' })`, `known = true`(눈에 보인다).
  1. **호흡 곤란 신고**: 연기 동네마다 60초에 한 번, 확률 `0.25 × smoke × (주거 1 · 상업 0.7 · 공업 0.4)` 로 `apartment·villa·houseS·houseL·dorm·school` 건물(원인 450 안)에 `spawnConsequence(medical/faint, severity 1~2, parent 원인 사건, note '화재 연기를 마신 주민이 숨쉬기 힘들어합니다', delay [60, 180])`. 원인 화재마다 2건, 교대당 4건. **(확인 필요: 연기 흡입 전용 변형을 `scenarios/life.ts` 에 둘지. 지금은 `faint` 를 쓴다)**
  2. **현장**: 연기 동네의 실외 현장(`s.outdoor`)에 구조 대상 실외 노출 `+0.08 × smoke`(새 세계 규칙 `world/rules/…` 가 아니라 `field/rules/` 에 `registerRule` 로 — 현장 규칙은 그 자리에 둔다).
  3. **도로**: 그 동네 구간 `bump += 0.2 × smoke`(끝나면 뺀다 — T1 규칙대로 덮어쓰지 않는다).
- 난수 `csq:smokePlume:inc:<id>`.

#### C4 `powerOut` — 구역 정전

- **조건**:
  - (가) `substation`·`powerPlant` 건물의 사건에서 신호 `fireBig`·`blast`·`collapse`·`catastrophe`. 범위: 변전소 700, 발전소 1100 안에 가운데가 있는 동네. **평소에는 거의 나오지 않는다**: `INCIDENT_PLACES` 에서 변전소는 `hazmat 2` 뿐이고 화재 몫이 없으며, 발전소도 `fire 1`·`hazmat 2.5` 로 드물다(`cityPlan.ts` 의 `INCIDENT_PLACES`). 그래서 C4·C8 의 (가) 갈래는 보통 교대에서는 드문 일로 두고, 완료 목표(§5)는 재난 교대(나·다)와 강제 교대에 기댄다. 테스트는 `createIncident(sim, { type: 'hazmat', placeId: 변전소 })` 로 직접 일으킨다(§6 I1-b 8).
  - (나) 태풍의 `lightsOut`(지금 `disaster.ts:192-203`) → 모든 동네 `power = 0`, `until = lightsOn 시각`. 지금의 도시 전체 `bump` 는 그대로 두고, 아래 1번의 구역 `bump` 는 이때 더하지 않는다(두 번 얹지 않는다).
  - (다) 지진 충격: 진앙 600 안 동네마다 확률 0.5.
- **결과**: `power = 0`, `until` = (가) 원인 사건 종료 + `rng.range(60, 120)` (사건이 끝나기 전까지 Infinity), (다) `t + 240`. 알림 `emit({ role: 'SYSTEM', actor: '한국전력', kind: 'hazard', tag: 'power', imp: 2, causes: [sig.ev], text: '○○동·△△동 일대 정전 — 신호등이 꺼졌습니다.' })` 는 `rng.range(20, 40)` 초 뒤(그때 `known = true`. 그 전에는 진실만 바뀐다). 복구 때 '… 전력 복구.'
  1. **신호 고장**: 그 동네 안에 가운데가 있는 구간 `bump += 0.4`(복구 때 뺀다).
  2. **승강기 갇힘**: 60~150초 뒤, `when` = 그 동네가 아직 정전, 확률 0.6, 정전마다 많아야 2건 — `apartment·officetel·office·hotel·deptStore` 건물에 `collapse/elevator`(note '정전으로 승강기가 멈췄습니다'). `parent` = (가)의 원인 사건(없으면 `cause` 만).
  3. **교차로 사고**: 90~240초 뒤, `when` 같음, 확률 0.4, 정전마다 1건 — 그 동네의 길이 셋 이상 닿는 교차로(시설 앞·열린 사건 자리 제외)에 `traffic/std`(note '신호등이 꺼진 교차로에서 차가 부딪쳤습니다').
  4. 120초 넘게 이어지면 C8 에 넘긴다(통신 기지국 예비 전원 소진).
  5. 그 동네의 병원은 `cap − 2`(발전기 운용) — C3 와 맞물린다.
- 쿨다운: 동네마다 300초. 상한: 정전 교대당 3(태풍 제외). 난수 `csq:powerOut:zone:<z>`.
- 관제: `z = knownZoneOfIncident(sim, I)`(알려진 교차로의 동네), `knownZone(z).power < 1` 이면 그 교통사고 신고 위험도 +0.3. 현장: 밤처럼 어둡게 보는 것(시야 반경)은 선택 — `kit.ts` 의 날씨 시야 자리를 고쳐야 하므로 첫 판에는 넣지 않는다.

#### C8 `commsDown` — 무전 음영이 늘어난다

- **조건**: (가) `broadcast`·`tower` 건물 사건의 `fireBig`·`blast`·`collapse`·`catastrophe` → 800 안 동네 `comms = 0.4`. `tower`(관제탑)에는 `INCIDENT_PLACES` 의 어떤 유형 몫도 없어 이 조건은 강제로 일으키지 않으면 걸리지 않는다. `broadcast` 도 화재 0.5·무장 1 로 드물다 — C4 (가) 와 같이 드문 갈래로 둔다. (나) C4 의 정전이 120초를 넘김 → 그 동네 `comms = min(comms, 0.6)`. (다) 지진 충격 → 진앙 500 안 동네마다 확률 0.4 로 0.5. (라) 태풍 정전 120초 → 모든 동네 0.7.
- **결과**: `until` = 원인 종료 + 180초(지진 300초). 그 동네의 열린 현장과 이후 만들어지는 현장에 음영을 더한다: 바닥 칸의 `(1 − comms) × 0.3` 만큼을 3~5개 덩어리(반지름 2~3칸)로 골라 `s.shadow = 1`, 고른 칸을 `s.shadowAdd` 에(회복 때 원래 값이 0 이던 칸만 되돌린다). 고르는 난수 `csq:shadow:<현장 id>`(현장 생성 흐름을 건드리지 않는다). 이 뒤의 COMM_FAIL·재배정은 지금 코드가 한다(재계획 `field`).
  - 알림(`tag: 'comms'`, `known = true`)은 (가)·(다)·(라)는 바로, (나)는 그 동네 현장의 첫 COMM_FAIL 이 나온 때(그 기록을 `causes` 로).
- 쿨다운: 동네마다 300초. 상한 교대당 3. 난수 `csq:commsDown:zone:<z>`.
- 현장 음영을 고치는 것은 현장 진실의 변화라 `world/rules/infra.ts` 가 `sim.scenes` 를 고친다(세계 규칙과 같은 자격). 무전 음영은 고정 층이 아니라 매 프레임 그린다(`renderScene.ts:158`, `staticLayer.ts` 에는 음영이 없다) — `staticSig` 는 고치지 않아도 새 음영이 바로 보인다(검토 때 확인).

#### C7 `floodLow` — 저지대 지하 공간

- **조건**(world tick): 홍수(`d.kind === 'flood'`)이고 `d.level ≥ 0.55`.
- **결과**: 60초에 한 번 확률 0.3, 교대당 3건:
  - 지하 공간: `riverDist(건물 가운데) < 220` 인 `parking·apartment·officetel·mart·station·deptStore` 에 `collapse/elevator`(note '지하 주차장이 잠기며 승강기에 사람이 갇혔습니다').
  - 지하차도: `riverDist(교차로) < 150` 이고 닿은 구간이 홍수로 느려진(`d.slowed`) 교차로에 `water/std`(note '물에 잠긴 지하차도에 차가 갇혔습니다').
  - `tag: 'disaster:flood'` 로 묶되 `d.spawned`·`CAP` 에는 넣지 않는다(규칙 상한이 따로 있다). 원인 = 수위가 0.55 를 처음 넘은 뒤의 재난 알림 기록 — `disaster.tell` 이 기록 id 를 돌려주고 `d.lastEv` 에 두게 한다.
- 난수 `csq:floodLow:<n>`. **(확인 필요: 홍수 큐의 고정 사건 수를 그만큼 줄일지 — 재난 교대 사건 수를 보고 정한다)**

#### C11 `waterMain` — 소화전 수압 저하 (선택)

- **조건**: 신호 `collapse`(size ≥ 10)·지진 충격(진앙 500 안 동네마다 0.3).
- **결과**: 동네 `water = 0.5`, `until = t + 300`. 그 동네 현장의 급수 연결(`executor.ts` 의 `hookup`)로 채우는 속도 × `water`, 첫 WATER_OUT 의 문구에 '소화전 수압이 낮습니다' 를 덧붙이고 그때 `known`(그 기록을 `causes` 로 `tag: 'water'` 알림). 관제: 알려지면 그 동네(`knownZoneOfIncident` 로 구한 신고의 구역) 화재에 `needs.suppression` +1.
- 난수 `csq:waterMain:zone:<z>`.

#### C12 `stormPileup` — 비바람 속 막힌 간선의 다중 추돌 (선택)

사용자 예시 사슬(§3.12)의 첫 화살표 "폭우 → 고속도로 다중 추돌". 날씨는 교대 내내 고정이라 날씨만으로 사건을 늘리면 인과가 아니라 난이도가 된다(§9). 그래서 **재난의 비바람이 실제로 있는 동안, 실제로 막힌 간선**에서만 일어나게 한다.

- **조건**(world tick): 태풍·홍수(`d.kind` 가 `typhoon`·`flood`)의 충격 단계 동안, `cls` 가 `highway`·`arterial` 이고 `cong ≥ 0.6`(혼잡) 또는 `d.slowed` 에 든 구간이 있다. 그 구간 양 끝 교차로 가운데 시설 앞·열린 사건 자리가 아닌 곳.
- **결과**: 60초에 한 번 확률 `0.08 × 혼잡 구간 수(많아야 5)`, 교대당 1건 — `spawnConsequence(traffic/pileup, nodeId, note '빗길에 미끄러진 차들이 잇따라 부딪쳤습니다', delay [10, 30])`, `cause` = 재난 알림의 마지막 기록(0단계 2번의 `d.lastEv`), `tag: 'disaster:<종류>'` 로 묶되 `d.spawned`·재난 `CAP` 에는 넣지 않는다(C7 과 같다). 다중 추돌은 `onCreate` 가 구간을 막으므로(`scenarios/major.ts`) 그 뒤는 지금 코드와 0단계·C6 이 잇는다(§3.12).
- `tag: 'major'` 의 "교대에 많아야 한 번"(`sim.rngMajor`)과는 따로 센다 — 평소 추첨을 거치지 않는다. 쿨다운: 교대에 한 번. 난수 `csq:stormPileup:<n>`.
- 넣는 것은 선택이다. 넣지 않으면 §3.12 의 첫 화살표는 재난이 직접 만드는 사건(지금의 재난 큐)으로 대신한다.

### 3.8 AI 가 아는 길 (정보 격리)

| 세계 상태 | 진실이 바뀌는 때 | 관제가 아는 길 | 현장 지휘관이 아는 길 | 판단에 쓰는 곳 |
|---|---|---|---|---|
| 도로 잔해(C2) | 사건 종료(남는 잔해)·큰 폭발 | 남는 잔해는 곧바로(종료 보고), 폭발 잔해는 T1: 제보·부대 보고(`known`) | 부대 무전 | `findRoute`·`etaFor`(이미 알려진 것만) |
| 응급실 포화(C3) | 체류 ≥ 한도 | 병원 알림(곧바로) | — | `startTransport`, 이송 중 목적지 변경 |
| 정전(C4) | 원인 직후 | 알림 20~40초 뒤 | — | 분석 AI 위험도 |
| 통신 장애(C8) | 원인 직후 | 알림 또는 첫 COMM_FAIL | 자기 현장의 COMM_FAIL | 지금의 재배정 |
| 수압 저하(C11) | 원인 직후 | 첫 WATER_OUT | 소화전이 느림(진실을 겪는다) | `needs.suppression` |
| 연기(C5) | 큰 불 45초 | 알림(곧바로) | 실외 노출을 겪는다 | 호흡 곤란 신고의 유형 판단 |
| 구역 위험(C10) | 도주 | 도주를 부대가 봤을 때 | — | 분석 AI 위험도·`needs.law` |
| 건물 상태(X6 `placeMarks`, C9) | 붕괴·폭발·전소, 사건 종료 | 그 건물 사건의 종료 보고, 지난 교대에서 이어받은 것(I2). 관제는 건물 id 를 모르므로 알려진 교차로와 진술의 건물 종류로 찾는다 | — | 재발화 이름표·위험도(`knownBuildingAt`) |
| 알려진 폭발(C1) | 폭발 | 현장 대원이 남긴 진실이 아닌 `EXPLOSION`(X6) 기록, 그 사건의 `reportedNode` | 자기 현장 | 근처 화재 신고 위험도 |
| 전환·부족(C6) | 배정 | 관제 자신의 결정 | — | (기록만) |

- `dispatch/*`·`field/commander.ts`·`field/brain.ts`·`field/orders/*` 는 `sim.world` 를 직접 읽지 않는다. `knownZone`·`knownHospital`·`knownBuildingAt`·`knownZoneOfIncident` 만 쓴다(테스트가 소스 글자로 검사, §6).
- **관제 쪽 위치는 알려진 것만**: 사건의 구역은 `knownZoneOfIncident`(= `zoneOfXY(city.nodes[I.reportedNode])`), 건물은 `knownBuildingAt(sim, I.reportedNode, placeKind)`. 분석 AI 와 배정 AI 는 `I.truth.x`·`y`·`placeId` 를 읽지 않는다(위치 진술은 교차로 id 뿐이다 — `callSystem.ts` 의 `I.reportedNode = claim.value`). `callSystem.ts` 의 신고자 모델은 지금처럼 진실을 읽는다(신고자가 본 것을 정하는 자리).
- `resources.startTransport` 는 관제 쪽 결정이므로 `knownHospital` 과 `known` 인 통제만 쓴다.
- 세계 규칙(`world/rules/*`)과 `hazards.ts`·`executor.ts` 는 진실을 읽고 바꿔도 된다.

### 3.9 보고서가 사슬을 읽는 법 (`debrief.buildReport`)

`evaluate` 는 사건이 닫힐 때 돌고 그 뒤에 생기는 자식 사건을 모르므로, 사슬 문장은 **교대 끝의 `buildReport`** 가 만든다. 모두 기록(`I.parent`·`I.cause`·`I.csq`·`Problem.ref`·`world.log`·`gen.dropped`)에서만 쓴다.

- `ShiftReport.incidents[k]` 에 `parent`, `children`(그 사건을 부모로 둔 사건 id), `chain`(문장 배열, 많아야 4줄):
  - 부모가 있으면: "사건 {P코드} {P이름}에서 이어졌습니다 — {규칙 label 또는 연쇄 이름}." (예: "사건 07 가스 폭발에서 이어졌습니다 — 폭발 불씨.")
  - 자식이 있으면: "이 사건에서 이어진 사건: 12 화재(폭발 불씨), 14 응급 환자(화재 연기)."
  - DIVERTED 에 `ref.lost` 가 있으면: "{부대}가 사건 {코드}({이름})로 돌려져 첫 도착이 약 {lost}초 늦었습니다."
  - `blockedBy` 가 있으면: "{수요} 부대가 사건 {코드들}에 묶여 {N}초 동안 배정하지 못했습니다."
  - HOSPITAL_FULL 이 있으면: "{병원} 응급실 포화로 {다른 병원}으로 이송했습니다(약 +{N}초)."
  - 사건 자리의 동네에 그 사건 동안 정전·통신 장애·연기가 있었고 그것이 기록(`INFRA_FAIL`·COMM_FAIL 의 `causes`)에 이어져 있으면: "{동네} 정전(사건 {코드} 변전소 화재)으로 무전이 끊기는 구역이 늘었습니다."
- 교대 요약(`summary`)에 한 줄(있을 때만): "인과: 이어진 사건 {n}건(가장 긴 사슬 {k}단계 — 07 변전소 화재 → 09 승강기 갇힘 → 11 교차로 사고), 전환 배정 {m}회(늦어진 시간 합 {s}초), 병원 우회 이송 {h}회, 정전 {p}회, 예약했지만 일어나지 않은 연쇄 {d}건."
- `ShiftReport.world` 에 숫자와 줄. 화면은 보고서 패널이 `chain` 을 사건 분석 아래에 그린다(`ui/panels.tsx` 의 보고서 사건 항목 한 곳).
- 문장 수: 사건 분석(`analysis`)의 9줄 상한과 따로 센다(`chain` 은 4줄).

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

| I1-b 규칙 | X6 이 주는 것 | 함께 넣는 이유 |
|---|---|---|
| C2 잔해 도로 | 전체 붕괴의 구간 통제(`I.blockedEdge`), `placeMarks` 의 `collapsed`·`blasted`, 폭발 순간과 반경 | 현장이 실제로 무너졌을 때만 도로가 막혀야 한다(조짐만으로 막지 않는다). X6 의 통제를 사건 뒤에도 잇는다 |
| C1 폭발 불씨 | 폭발 순간과 반경 | 같은 |
| C9 재발화 | `placeMarks` 의 `burnt`·`collapsed`(그 건물은 재발화를 만들지 않는다) | X6 이 닫은 건물에 사건을 내지 않는다는 X6 의 규칙과 맞춘다 |
| C4·C8 | 변전소·발전소·방송국 현장의 폭발·전소 | 기반 시설 사고의 가장 큰 원인 |

- X6 의 원인 기록(`cat.causeEv`, 문제 기록의 `causes`)은 이미 사슬을 이루므로 I1-a 의 확산 단계가 그대로 읽는다(붕괴 → 사망 → …).
- X6 의 건물 상태를 `sim.world` 로 옮기지 않는다(§9). G4 의 기록 전용 칸(`markRuin`·`recordFall`)은 신호로 쓰지 않는다 — 신호는 X6 의 상태를 바꾸는 함수 안에서 보낸다.

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

### 3.12 사용자 예시 사슬을 화살표마다 따라가기

사용자 의견의 예 "폭우 → 고속도로 다중 추돌 → 도로 차단 → 우회로 도착 지연 → 현장의 추가 위험 → 전문 부대 요청 → 관제가 다른 사건의 부대를 전환 → 원래 사건이 늦어짐" 을 화살표마다 무엇이 일으키고, 무엇이 기록되고, 어느 지표가 세는지로 잇는다. **고정된 순서로 연출하지 않는다** — 각 화살표는 그 조건이 맞을 때만 일어나고, 일어나지 않은 화살표는 기록에도 없다.

| 화살표 | 메커니즘 | 있나 | 기록(`causes`) | 지표 |
|---|---|---|---|---|
| 폭우 → 다중 추돌 | C12 `stormPileup`(선택): 태풍·홍수의 충격 단계 + 혼잡한 간선. 넣지 않으면 재난 큐가 직접 만드는 사건으로 대신 | I1-b b3-12 | 발생 기록 → 재난 알림(`d.lastEv`, 0단계 2번) | `worldLinks`, `rooted`, `systems.share.disaster` |
| 다중 추돌 → 도로 차단 | `scenarios/major.ts` 의 `onCreate` 가 구간을 막는다 | 있다 | 통제 기록 → 발생 기록. id 를 `I.blockEv` 에(0단계 4번) | `systems.share.road`(`I.blockedEdge`) |
| 도로 차단 → 다른 사건의 우회·지연 | 통제가 생기기 **전에** 그 구간을 지나기로 경로를 정한 부대는 그 앞에서 ROUTE_BLOCKED '통제'(`resources.ts:420`)로 멈추고 되짚어 다른 길로 간다. 늦으면 도착 때 TRAFFIC_DELAY | 있다 | ROUTE_BLOCKED → `J.blockEv`(다른 사건), TRAFFIC_DELAY → 그 ROUTE_BLOCKED(0단계 4번) | `crossIncidentLinks`, `replan.route`, `replan.fromWorld`, `spread` |
| (한계) 이미 알려진 통제 → 우회 | 통제를 안 뒤에 출발한 부대는 처음부터 우회로로 경로를 정한다(`findRoute` 는 알려진 통제를 피한다). 늘어난 시간은 예정 도착에 이미 들어가 **기록되지 않는다** | — | 없음 | 잡지 않는다. 이송이면 C3-6(선택)이 병원 선택에 한해 잇는다 |
| 지연 → 현장의 추가 위험 | 도착이 늦은 만큼 세계 규칙(번짐·악화·2차 충돌)이 더 돈다(`hazards.ts`) | 있다 | 위험 기록의 `causes` 는 그 현장의 직전 기록이다 — **지연 기록과 원인으로 이어지지 않는다**(시간이 만든 결과라 어느 기록 때문이라고 짚을 수 없다) | `systems.share.hazard`. 사슬은 여기서 한 번 끊긴다 |
| 추가 위험 → 전문 부대 요청 | 지휘관의 요청(`s.requests`)·다수 사상자 규칙(`orders/major.ts`) → 관제 수요 | 있다 | 요청 기록 → 위험을 알린 무전·문제 기록 | (기본 세 시스템 안이라 `spread` 에 더하지 않는다) |
| 요청 → 다른 사건의 부대 전환 | `dispatcher.sendUnit` 의 전환 배정(B3 규칙 안에서) | 있다 | DIVERTED(원래 사건 J) → 받는 사건의 마지막 기록(C6, 0단계 3번) | `contention.divert.n`, `crossIncidentLinks` |
| 전환 → 원래 사건 지연 | J 의 첫 도착이 예정보다 늦음 | C6(b3-1) | 지연 기록 → DIVERTED, `ref.lost` | `divert.hurt`·`lostSec`, 보고서 사슬 문장 |

- 끊기는 곳이 하나 있다(지연 → 추가 위험). 그래서 이 예의 전체가 `spread` 하나로 이어지지는 않는다. 앞쪽(재난 알림 → 추돌 발생 → 통제 → 다른 사건 J 의 ROUTE_BLOCKED)은 재난 알림에서 시작한 `spreadWorld` 로 distinct 3(`(추돌, origin)`·`(추돌, road)`·`(J, road)`)이고, 추돌 사건에서 시작한 `spread` 로는 2다(`(추돌, road)`·`(J, road)`). 사건 하나의 `spread` 가 3 이 되려면 J 쪽에서 한 단계 더(예: J 의 지연이 지원 요청으로 — `aid`, 또는 전환 배정으로 — 다른 사건) 이어져야 한다. 뒤쪽(요청 → 전환 → 지연)은 `divert.hurt` 와 보고서 문장으로 보인다.
- 정해진 시드 테스트(§6 I1-b 8)의 후보: 태풍 강제 교대 + C12 를 켠 시드, 또는 `createIncident(sim, { type: 'traffic', variant: 'pileup', nodeId })` 를 다른 사건의 부대가 그 구간을 지나기로 경로를 정한 직후에 일으키는 시드(구현 때 찾아 고정한다).

---

## 4. 균형과 재측정

성공률만 보지 않는다. 규칙 하나를 넣을 때마다 아래를 전후로 잰다(전 = 그 단계 직전 커밋).

```bash
npx tsx scripts/sweep.ts 60 --json > $SCR/b-<단계>-normal.json
npx tsx scripts/sweep.ts 60 --metrics | tail -14                  # 지표 9줄과 후보
npx tsx scripts/sweep.ts 30 --diff hard --json > $SCR/b-<단계>-hard.json
for z in typhoon flood quake wildfire tsunami; do npx tsx scripts/sweep.ts 20 --disaster $z --json > $SCR/b-<단계>-$z.json; done
npx tsx scripts/sweep.ts 20 --force collapse/gasblast --scen --metrics   # C1·C2 (X6 뒤)
npx tsx scripts/sweep.ts 20 --force traffic/bus --scen --metrics         # C3
npx tsx scripts/sweep.ts 20 --force fire/std --scen --metrics            # C5·C9
npx tsx scripts/sweep.ts 1 --log <시드> --metrics                        # 사슬을 문장으로 읽는다
```

**목표**(보통 60시드, I1-b 시작 커밋 = R3 뒤 기준 대비):

| 무엇 | 범위 |
|---|---|
| 성공+대응 지연 | `npm run check` 범위(65~90%) 안, 기준 ± 4%p |
| 실패+미해결 | 기준 + 4%p 이하. 늘어난 만큼이 사슬 문장(§3.9)으로 설명되어야 한다 |
| 한계 시간·방치·출동 없음 | 기준 + 2건 이하 |
| 평균 대응 | 기준 + 6초 이하 |
| 교대당 사건 수 | 기준 × 1.12 이하 (규칙이 사건을 쏟아내지 않는다) |
| 부모 있는 사건 비율 | 보통 2~8%, 재난 교대 10~30% |
| 확산 3단계 이상(`spread.ge3`) | 보통 60교대에 1건 이상, 재난 다섯 × 20교대 합쳐 5건 이상 |
| 다른 사건을 가리키는 원인 | 0 보다 크다 |
| 재계획 `fromWorld` | 보통 60교대에 1건 이상, 재난 합쳐 5건 이상 |
| 전환 배정의 실제 영향 `divert.hurt` | 보통 또는 어려움 60교대에서 1건 이상 |
| 결과 다양성 | `outcomeEntropy` 가 기준 − 0.05 이상, `storyEntropy` 는 기준 이상, `flat` 이 늘지 않는다 |
| 행동 다양성 | `actions.entropy` 가 기준 이상 |
| 멈춤 | `stall.candidates = 0`, `forgotten = 0` |
| 연쇄 상한 | `maxParentDepth ≤ 3`, 규칙이 만든 사건 교대당 ≤ `CSQ_SPAWN_CAP` |
| 교대당 시간 | 기준 × 1.2 이하 |

**범위를 벗어나면 돌리는 손잡이(이 순서로)**: 규칙별 확률 → 규칙별 상한·쿨다운 → 지속 시간(`until`) → 전체 상한 `CSQ_SPAWN_CAP` → (선택) `tune.csqMul`(빈도 손잡이 표에 `[0.5, 0.75, 1, 1.25, 1.5]` — 보통 칸은 1. `Tuning` 에만 더하고 프리셋 모양은 고치지 않는다). `npm run check` 의 기준 범위 자체는 고치지 않는다.

---

## 5. 구현 순서와 완료 조건

**I1-a(이 세션 — 구현됨, `48dba83`)**: §2.17.

**I1-b(다음 구현 세션, R3 다음)** — 단계마다 커밋(`wf/causality`, 한국어, 푸시하지 않는다):

| 단계 | 내용 | 해시 | 확인 |
|---|---|---|---|
| b0 | 기록만 잇기(§3.11 0단계) | **불변** | 해시 목록 diff 0, `crossIncidentLinks > 0` |
| b1 | 어긋난 기록 고치기(§3.11 1단계 — 출발 문구는 R1 이 이미 고쳤으면 C5 = 0 확인만), C5 관문 | 바뀜 | 기준선 다시 재기(§4 명령 전부) |
| b2 | `types.ts`, `world/state.ts`·`consequence.ts`(규칙 없음), `tickWorld` 자리, 신호 보내는 자리, `gen.chain` 의 `when`·`until`·`dropped` | **불변**(규칙이 없으면 상태가 그대로) | 해시 목록 diff 0 |
| b3-1~11 | 규칙을 §3.7 표의 순서로 하나씩 | 바뀜 | 그 규칙의 테스트 + §4 의 측정 |
| b4 | 보고서 사슬 문장(§3.9), 보고서 패널 한 곳 | 바뀜(요약 문장) | 화면 확인(포트 5218, 콘솔 오류 0) |
| b5 | 균형(§4)과 완료 조건 측정, I1-a 관문을 조인다(M-G1 0, M-G3 3) | — | 아래 |

**완료 조건** — 사용자가 제안한 다섯 가지를 I1-a 숫자로:

1. **하나의 사건에서 서로 다른 시스템으로 3단계 이상 실제 영향이 퍼지는 사례**: `metrics.systems.spread.ge3 ≥ 1`(보통 60교대)·`≥ 5`(재난 다섯 × 20교대). `ge3` 는 서로 다른 `(사건, 시스템)` 쌍으로 센 값(§2.5 — 같은 시스템의 왕복은 세지 않는다)이라 `--metrics` 의 예시 길이 기본 세 시스템 밖의 서로 다른 시스템이나 다른 사건을 셋 이상 지난다. 그리고 정해진 시드의 테스트(§6 I1-b 8).
2. **AI 가 새 정보로 기존 계획을 바꾸는 사례**: `replan.share` 가 기준 이상이고 `replan.fromWorld ≥ 1`(보통 60)·`≥ 5`(재난 합). 테스트: 이송 중 목적지 변경(C3).
3. **부대 부족이 다른 사건에 실제로 영향을 주는 사례**: `contention.divert.hurt ≥ 1` 이고 `lostSec > 0`(보통 또는 어려움 60), `blockedBy` 가 있는 NO_UNIT ≥ 1. 보고서에 그 문장이 있다.
4. **모든 결과가 이벤트 로그와 실제 상태에 일치**: `consistency.C1~C5` 가 모두 0(보통 60·어려움 30·재난 다섯 × 20). 보고서의 사슬 문장마다 가리키는 사건·기록이 있다(테스트).
5. **여러 시드에서 교착·무한 연쇄·무의미한 반복 없음**: 보통 60 에서 `stall.candidates = 0`, `forgotten = 0`. 어려움 60·극한 30·재난 다섯 × 20 에서는 `stall.candidates`·`forgotten` 이 I1-a 기준선 뒤 ROADMAP 에 적은 조건별 상한 이하(§2.14 — 극한에는 원래 교착 종료가 있다)이고 기준선보다 늘지 않는다. 모든 조건에서 `maxParentDepth ≤ 3`, 규칙이 만든 사건 교대당 ≤ `CSQ_SPAWN_CAP`, `repeatMax ≤ REPEAT_MAX`(§2.2 에 선언 — I1-a 기준선 뒤 정한 값). 교착 후보를 0 으로 만드는 일(예: §1.5 의 등산객 수색)은 I1-b 시작 전에 ROADMAP 의 고칠 일로 따로 끝내 두는 것이 좋다.

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

**I1-b(다음 구현 세션이 더한다)**

1. 재현성: 세계 상태가 생긴 뒤에도 같은 시드 두 번의 `report.hash` 가 같다. 규칙이 하나도 안 걸린 교대의 `world` 는 처음 값 그대로.
2. C6: 두 사건을 정해서 일으켜 전환 배정을 만든다 → DIVERTED 의 `causes` 가 받는 사건 기록을 가리키고, `ref.lost` 가 채워지고, 보고서 `chain` 에 그 문장.
3. C3: 병원 체류를 한도까지 채움 → 포화 알림, 새 이송이 다른 병원으로, 이송 중이던 부대의 목적지 변경 기록과 HOSPITAL_FULL, 체류가 빠지면 수용 재개.
4. C2: X6 의 전체 붕괴가 난 사건을 닫음 → 그 구간에 `rubble` 장애물이 이어서 놓이고(`known`), 규칙이 남긴 잔해 기록(`kind 'traffic'`, §3.7 C2 의 "기록")의 `causes` 가 종료 기록이며 그 장애물의 `ev` 가 그 기록, 도시가 끊기지 않는다(`tests/traffic.test.ts` 의 연결 검사 함수를 다시 쓴다). 큰 폭발 신호만 있는 사건도 같은 검사(알려지지 않은 잔해면 기록은 `truth`, 부대의 ROUTE_BLOCKED 가 그 기록을 `causes` 로).
5. C9: 잔불이 남은 화재를 닫음 → 같은 건물에 재발화 예약(부모·원인). `placeMarks` 가 `burnt` 인 건물에는 예약하지 않는다.
6. 무한 연쇄: 깊이 3 사건에서 규칙이 더 만들지 않는다(`dropped` 의 `'depth'`), 규칙 상한을 1 로 낮춘 강제 교대에서 상한을 넘지 않는다, 교대 끝 150초 안에는 만들지 않는다. `when` 이 거짓인 채 `until` 이 지나면 `'expired'`.
7. 정보 격리(소스 글자 검사):
   - `src/sim/dispatch/*`·`field/commander.ts`·`field/brain.ts`·`field/orders/*` 에 `world.zones`·`world.hospitals`·`world.signals`·`world.log`·`placeMarks`·`carryState` 글자가 없다(`knownZone`·`knownHospital`·`knownBuildingAt`·`knownZoneOfIncident` 만).
   - `dispatch/analyst.ts`·`dispatch/dispatcher.ts` 에 `truth.placeId` 글자가 없다. `dispatch/callSystem.ts` 는 신고자 모델이라 진실을 읽으므로(`callSystem.ts:113` 등 — 신고자가 본 것을 정한다) 이 검사에서 뺀다.
   - `resources.ts` 는 파일 전체가 아니라 **`startTransport` 함수의 본문만** 잘라 같은 글자들을 검사한다(`export function startTransport` 부터 짝이 맞는 닫는 중괄호까지). `arrive` 의 응급실 대기처럼 같은 파일의 다른 자리는 진실을 읽어도 된다.
8. 3단계 사례: 정해진 시드(구현 때 찾아 고정)에서 `spread ≥ 3`(distinct — 길이 지나는 `(사건, 시스템)` 쌍이 셋 이상 서로 다르다). 후보: (가) `createIncident(sim, { type: 'hazmat', placeId: 변전소 })` 로 변전소 사고를 직접 일으켜 정전 → 승강기 갇힘 → 그 사건의 부족(평소에는 변전소에서 화재가 나지 않고 위험물 사고만 드물게 난다 — §3.7 C4), (나) §3.12 의 다중 추돌 → 통제 → 다른 사건의 ROUTE_BLOCKED → 그 사건의 지원 요청·전환.
9. 보고서: `chain` 문장마다 가리키는 사건 id 가 있고, 사슬이 없는 교대에는 요약의 "인과:" 줄이 없다.

---

## 7. 고칠 파일 목록

**I1-a(이 세션 — 구현됨, `48dba83`)**

| 파일 | 무엇 |
|---|---|
| `scripts/metrics.ts` (새로) | §2.2~2.14 전부 |
| `scripts/sweep.ts` | `runWithProbe`/`--no-metrics`, 지표 줄, `--json` 의 `problems`·`reportHash`·`metrics`, `--metrics`, `--log --metrics`, `--json --check` 의 stderr, `checkMetrics` 를 `fail` 에 |
| `tests/causality.test.ts` (새로) | §6 I1-a |
| (주 세션이 끝에) `docs/ROADMAP.md`·`README.md`·`CLAUDE.md` | 기준 수치(잰 `src/` 커밋과 함께)와 교착 후보, `sweep` 옵션 설명, 명령 표 한 줄(`--metrics`·`--no-metrics`), 명령 표의 `npm test` 줄(테스트 수·파일 수에 `causality`), 함정 한 줄("측정 도구의 문구 규칙 — 기록 문구를 바꾸면 `tests/causality.test.ts` 가 깨진다. `scripts/metrics.ts` 의 표를 함께 고친다") |

**I1-b(다음 구현 세션)** — 자기 파일(새로): `src/sim/world/state.ts`, `src/sim/world/consequence.ts`, `src/sim/world/rules/{index,record,hospital,structure,infra,spread}.ts`. 공용 파일은 아래 함수만, 가장 작은 조각으로:

| 파일 | 함수·자리 | 무엇 |
|---|---|---|
| `types.ts` | 끝에 추가 | §3.3 |
| `events.ts` | `EmitArgs`·`emit` | `tag` 복사 한 줄 |
| `engine.ts` | 생성자, `step` | `this.world = initWorld(this)`, `tickDisaster` 다음 `tickWorld(this)`, `import './world/rules'` |
| `incidents.ts` | `SpawnOpts`·`GenState`, `createIncident`(발생 기록 `causes`, `I.cause`·`csq`, 생성 리터럴의 새 칸 — `blockEv` 포함), `tickIncidents` 의 예약 꺼내기(§3.5·3.6), `closeIncident`(신호 `closed`, 도착 없이 닫힌 전환의 `ref.lost`), `ARMED_BIAS` 를 export(C10 이 장소 표로 쓴다) | |
| `field/kit.ts`·`field/sceneManager.ts` | `baseScene`·`createScene` | 새 `Scene` 칸(`shadowAdd`)의 객체 모양 |
| `events.ts`·`debrief.ts`·`field/agents.ts` | `raiseProblem`·`addProblem`·`LATE_DISCOVERY` 리터럴 | `Problem.ref` 의 객체 모양 |
| `field/catastrophe.ts`(X6) | `collapseRegion`·`collapseBuilding`·`explodeGas`·`ruptureVessel`·전소 판정 | `signal(…, 'catastrophe', …)` 한 줄씩(X6 이 넣지 않았으면, §3.10), `collapseBuilding` 의 통제 기록 반환값을 `I.blockEv` 에(0단계 4번) |
| `hazards.ts` | `blast`(신호 `blast` — 원인 `'blast'` 이고 X6 가 부르지 않은 것만: `blast` 에 선택 인자 `noSignal = false` 를 더하고 X6 의 `catastrophe.ts` 는 `true` 로 부른다, §3.4), `tickCollapse`·`tickFire` 끝(신호), 도주 블록(SUSPECT_FLED 반환값을 `cause` 로 — 0단계, 재범 난수·장소·`when`·신호 `fled`) | |
| `resources.ts` | `startTransport`(`knownHospital`, (선택) `knownDetourCauses`), 응급실 대기(`timer` 붐빔, `causes`), 병원 인계(신호 `delivered`), 이송 중 목적지 변경, ROUTE_BLOCKED·TRAFFIC_DELAY 의 `ref`·`causes`(0단계 4번) | |
| `field/sceneManager.ts` | `unitArrived` 의 첫 도착(C6 지연 기록), 6) 블록의 통제 기록 id 를 `I.blockEv` 에(0단계 4번). 5) 블록의 출발 문구는 R1 단계 3 의 몫이다(R1 이 하지 않았을 때만 b1 에서) | |
| `dispatch/dispatcher.ts` | `sendUnit` 의 전환 블록, `tickDispatch` 의 NO_UNIT | C6 |
| `dispatch/analyst.ts` | 위험도·이름표(날씨를 읽는 자리 근처, `analyst.ts:103-111`) | `knownZone`·`knownZoneOfIncident`·`knownBuildingAt` (진실 위치·`truth.placeId` 금지) |
| `field/executor.ts` | `hookup` 의 채우는 속도(C11, 선택) | |
| `field/rules/` 의 새 파일 하나 | `registerRule` | 연기 동네의 실외 노출(C5) |
| `field/commander.ts` | 원인이 분명한 `want()` 몇 곳의 `cause` 인자(0단계) | |
| `traffic.ts` | `ObstacleKind`·`OBSTACLE_LABEL`·`Obstacle.ev`·`reportObstacle` 의 `causes` | C2 |
| `disaster.ts` | `tell` 이 기록 id 반환·`d.lastEv`, `spawn` 의 `cause`, `lightsOut`·`lightsOn`(구역 전력), 지진 충격(C4·C8·C11 신호) | |
| `scenarios/crime.ts`·`pursuit.ts`·`scenarios/major.ts`·`scenarios/disaster.ts` | 방화(`I.lastEvent`)·은신처(SUSPECT_FLED 반환값) 예약의 `cause`·`csq`, 다중 추돌·산사태 `onCreate` 의 통제 기록 id 를 `I.blockEv` 에 | 0단계 |
| `debrief.ts` | `PROBLEM_LABEL`·`order`·문장(HOSPITAL_FULL·INFRA_FAIL), `buildReport` 의 사슬 문장·`world`·요약 줄 | |
| `view/city/trafficLayer.ts`, `ui/MapLegend.tsx` | `rubble` 기호 | |
| `ui/panels.tsx` | 보고서 사건 항목에 `chain` | |
| `scripts/metrics.ts` | 관문 상수 조이기(M-G1 0, M-G3 3), C5 관문(R1 이 켜지 않았으면), 0단계 5번 뒤 `dropped` 를 `gen.dropped` 로, b3-2 에서 문구 규칙 T8 과 C5 의 "마지막 출발 또는 목적지 변경"(§2.3·§2.12 — §6 테스트 6 의 손 기록도 함께) | |
| `tests/causality.test.ts` | §6 I1-b | |

건드리지 않는다: `city.ts`, `cityPlan.ts`, `view/city/staticCity.ts`, `tests/sim.test.ts`, G4·G5 의 기록 전용 칸을 읽는 코드.

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
10. **사건이 늘어난다.** 규칙이 만드는 사건은 평소 생성기의 `g.count` 에 들지 않는다(지금의 연쇄와 같다). 부하 감쇠(`incidents.ts:193-202`)는 열린 사건 수를 보므로 자동으로 평소 사건을 늦추지만, 교대당 사건 수 상한(× 1.12)을 넘으면 규칙의 확률부터 줄인다.
11. **재범 연쇄의 난수 수정**은 이 연쇄가 생긴 모든 교대의 결과를 바꾼다(그 뒤 평소 생성기의 흐름이 달라진다). 1단계에서 따로 커밋하고 기준선을 다시 잰다.
12. **X6 설계서는 아직 검토 중이다.** 이 문서는 X6 초안의 이름(`catastrophe.ts` 의 함수들, `Sim.placeMarks`, `STRUCT_COLLAPSE`·`EXPLOSION`·`BURNOUT`, 전체 붕괴의 구간 통제)에 맞췄다. X6 이 바뀌면 §3.10 의 신호 자리와 C2·C9 를 따라 고친다. X6 이 붕괴·폭발을 더 자주 만들면 C1·C2 의 발동이 늘어난다 — X6 뒤 기준선에서 확률을 다시 본다.
13. **R1 이 부대·대원 수를 바꾼다**(대원 34명 → 63명 안팎). C3 의 병원 한도, C6 의 전환 빈도, 자원 경쟁 지표의 기준선은 R1~R3 뒤에 다시 잰 값으로 판단한다.
14. **재계획 지표가 결정과 자동 경로를 섞는다.** 예: COMM_FAIL 재배정은 지휘관의 판단이지만 PATH_BLOCKED 우회는 실행기의 자동 우회다. 둘 다 "새 정보로 계획을 바꿈"으로 세되 갈래별 숫자를 함께 낸다.
15. **엔트로피는 표본이 작으면 낮게 나온다.** 시나리오별 값은 `n ≥ 5` 만 쓰고 `n` 을 함께 찍는다. 교대 수가 다른 측정끼리 비교하지 않는다.
16. **구역 경계.** `districtAt` 은 가까운 동네를 고르는 함수가 아니다 — 모든 동네의 반지름 × 1.22 밖이면 `null` 이고, 건물의 `Place.dong` 은 그때 `'외곽'`(산이면 `'산촌'`)이 되어 `DISTRICTS` 에 없다(`city.ts:45-53, 318`). 그래서 외곽 건물이 엉뚱한 동네의 상태를 받는 일은 없지만, 대신 **구역 -1** 이 생긴다. 모든 규칙이 -1 을 건너뛰게 했다(§3.2). 범위로 고르는 규칙(C4 (가)·C5·C8 (가) — "원인 지점에서 N 안에 가운데가 있는 동네")은 원인이 외곽이어도 동네 가운데까지 재므로 그대로 돈다. 영향을 받는 것은 **그 점의 구역 하나**를 쓰는 곳뿐이다: C10 의 도주 지점 구역, 관제의 `knownZoneOfIncident`(외곽 신고는 구역 상태로 위험도를 올리지 않는다), 외곽 현장의 음영·연기. 외곽은 밀도가 낮아 잃는 것이 적다고 보고 그대로 둔다.

---

## 9. 결정해 둔 것 (조사에서 열려 있던 질문)

| 질문 | 결정 | 까닭 |
|---|---|---|
| "시스템"의 정의 | 모듈 단위 14개(§2.3, I2 의 `carry` 포함)와 사건·문제·종류·문구의 대응표 | 역할(role)로는 지금의 사슬이 이미 2~4개 역할을 지나지만 신고 단계 안이라 의미가 없다 |
| 건물 상태를 `sim.world` 로 옮길까(X6 의 제안) | 아니다. 교대 안은 X6 의 `Sim.placeMarks`, 교대 사이는 I2 의 `carryState.places`. I1-b 는 둘을 읽는 `placeState`(규칙 쪽)·`knownBuildingAt`(관제 쪽 — 알려진 교차로로 묻는다) 만 둔다. I2 의 옛 이름 `knownBuilding(sim, id)` 는 정합성 점검에서 `knownBuildingAt(sim, I.reportedNode, placeKind)` 로 맞췄다(반영됨) | G4·I2 가 이미 그 이름을 읽는다. 옮기면 세 묶음을 고쳐야 하고 얻는 것이 없다. `sim.world` 는 구역·병원처럼 새로 생기는 상태만 |
| 연쇄 깊이를 `parent` 로 셀까 `causes` 로 셀까 | 둘 다, 따로 낸다. `parent` 는 엄격한 깊이와 재난 뿌리 +1 두 가지 | 사건을 낳은 사슬과 기록이 이어진 사슬은 다른 질문이다 |
| I1-a 가 `causes`·`parent` 를 채울까 | 아니다. `src/` 무변경. 채우는 것은 I1-b 0단계(해시 불변 — `logHash` 는 문구만 본다) | 결과 불변을 한 줄로 증명하고, 이번 세션의 다른 작업과 파일이 겹치지 않게 |
| "시립병원" 문구를 I1-a 에서 고칠까 | 아니다. C5 로 보고만 한다. 고치는 것은 R1 단계 3(`startTransport` 가 병원을 돌려준다)이고, I1-b b1 은 C5 = 0 을 확인하고 관문을 켠다(R1 이 하지 않았을 때만 b1 에서 고친다) | 문구를 바꾸면 해시가 바뀌어 G4·U2 의 비교 기준과 부딪힌다. 같은 줄을 두 묶음이 고치지 않는다 |
| 재계획에 넣을 것 | §2.6 의 집합. FALSE_ALARM·UNDER_DISPATCH 복구·NO_UNIT 복구는 뺀다. `recoveredShare` 키는 그대로 두고 새 키 `replan` | 계획을 바꾼 것만 센다. 다른 설계서의 전후 비교를 깨지 않는다 |
| 멈춘 시간의 정의 | 엄격한 멈춤(조건 넷 + 진전 신호, 60초)과 잊힌 사건(통화 뒤 30초, 위치·평가가 있는 사건만)만 관문 — 보통 기본 조건에서 래칫. 위치를 모르는 사건(`unlocated`)과 느슨한 대기는 보고만. 표본은 기본으로 켜고 `--no-metrics` 로 끈다 | 설계 시험에서 거짓 양성을 하나씩 걷어낸 정의. 관문이 쓰려면 기본으로 켜져 있어야 한다 |
| 결과 다양성의 열쇠 | 결과(K1)와 결과 × 주된 문제(K2), 엔트로피와 가짓수 | 전체 문제 집합은 모두 달라 의미가 없고, 결과만은 너무 거칠다 |
| 관문에 무엇을 걸까 | 상한만(교착·잊힘·연쇄 깊이·연쇄 수)과 일치 검사. 하한은 I1-b 완료 조건과 테스트로 | 지금 0 인 드문 값의 하한은 40시드에서 흔들린다 |
| 자원 경쟁의 단위 | 사건 단위 비율과 교대 단위(지원 수·최대 동시 사건·최대 바쁨) 둘 다 + 전환의 실제 지연 | 비율만으로는 "다른 사건에 실제로 영향"을 말할 수 없다 |
| R2·H1 과 이름 | I1-a 는 `metrics` 키 하나와 9개 줄 접두어. R2 의 `methods`·H1 의 최상위 키·`injuries:` 와 겹치지 않는다. R2 의 `I.methods` 는 있으면 읽는다 | |
| 날씨가 사건을 낳는 길(폭우 → 사고) | 고정 날씨(비·안개)로 사건을 늘리지 않는다. 사용자 예시 사슬의 첫 화살표는 C12 `stormPileup`(선택) — 태풍·홍수의 충격 단계 동안 **혼잡한 간선**에서만, 원인 기록(재난 알림)을 잇는다(§3.7, §3.12) | 날씨가 교대 내내 고정이라 유형 가중치는 인과보다 난이도에 가깝다. 재난의 비바람은 시작과 끝이 있고 기록이 있어 원인으로 이을 수 있다 |

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

커밋: b1 `c0dc136` · b2 `5c333d0` (+ 이 메모). **b3 부터의 기준은 아래 "b1 뒤" 줄이다**(b2 는 결과를 바꾸지 않는다).

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
