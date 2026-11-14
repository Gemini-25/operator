# R1 — 부대 편성 · 개인 장비 · 헬기 세 종류

공통 규칙은 `docs/specs/README.md`. 브랜치 `wf/crews`, 개발 서버 포트 **5211**.

**한 줄 요약**: 모든 부대가 2인 1조이던 것을 부대 종류마다 2~5명의 서로 다른 역할로 바꾸고, 대원 한 사람 한 사람이 자기 장비를 들고 다니며 그 장비가 맡을 수 있는 일·작업 속도·현장 그림을 정한다. 헬기는 경찰(추적·감시·탐조등)·소방(호이스트 구조·물 투하)·의료(의사·간호사, 중환자 이송) 세 종류가 된다.

사용자 요청(그대로): "팀 구성에서 무조건 2인 1조를 할 필요는 없고, 구성별로 특색있게 그리고 경찰 의료 소방 측도 헬기를 다룰 수도 있고, 각자 장비를 어떤걸 들고 있는지도 특색있게 만들어줘."

**하는 것**
- 편성표: 부대 종류 14가지(지금 12 + 경찰 헬기·의료 헬기)마다 인원과 역할(자리) 순서. 부대 규모 손잡이 1·2 는 최소 인원, 3~5 는 표준 인원.
- 역할(`RoleId`)과 개인 장비(`KitId`): 역할마다 기본 장비, 장비마다 효과(맡을 수 있는 일 / 작업 속도 / 소모·고장 / 시야·탐지).
- 부서로 정하던 방호·능력(연기·불·폭발에 강한 것은 소방, 붕괴 현장 탐지는 구조 공작차 …)을 사람이 든 장비로 옮긴다.
- 헬기 세 종류: 관제가 보내는 규칙, 날씨·연료의 제약, 현장 상공에 머무는 헬기(공중 관측·탐조등·호이스트·물 투하), 내려앉는 헬기(대원이 내려 일한다).
- 환자 자리(`Unit.seats`)를 한 함수로 묶어 헬기 정원(1명)이 실제로 지켜지게 한다.
- 공기호흡기의 공기, 섬광탄·테이저의 수량, 개인 장비의 고장.
- 화면: 역할별 대원 그림과 손에 든 장비, 부대 목록의 역할 점, 대원 정보창의 역할·장비, 헬기 세 종류의 표식과 도색, 상공 헬기·탐조등·호이스트 줄·물 투하.

**이번에 하지 않는 것**
- 같은 일을 장비에 따라 다른 방법으로 하기(구명줄이 없으면 헤엄쳐 구조 등) — `R2-methods.md`. R1 은 그 바탕(`toolFor`·`hasKit`·`KitId`)만 만든다.
- 대원·용의자·요구조자의 부상과 사망 모델 — `H1-injuries.md`. R1 은 피해 식의 "방호" 부분만 사람 장비로 바꾼다.
- 상황 × 장비 × 상태별 행동 표(둘이 들어가고 둘이 밖에서 대기하는 짝 규칙 같은 교본) — `R3-doctrine.md`.
- 탄약 수(총은 무제한으로 둔다), 사다리차의 창문 구조(`ROADMAP` C4), 구조정의 바다 쪽 현장 그림과 보트 구조, 이륙 준비 시간 늘리기, 헬기 소리.
- 관제 수요(`Needs`)를 사람 단위로 바꾸기. 수요는 지금처럼 **부대 수** 단위로 둔다(17절 결정 4).
- 새 시설·지도 변경. 헬기는 이미 있는 시설에 둔다(지도가 그대로다).

**자기 파일**(새로): `src/sim/crews.ts`(편성·역할·장비 표와 도움 함수), `src/sim/field/rules/air.ts`(공중 관측·호이스트·물 투하의 실행 — 진실을 읽는다), `src/sim/field/airDecide.ts`(헬기의 판단 — 믿음만 읽는다), `tests/crews.test.ts`.
**공용 파일 수정**: 15절에 함수와 이유를 모두 적었다. 그 밖의 곳을 고쳐야 하면 고치되 보고에 적는다.
**이 설계서가 따로 허락하는 것**: `tests/sim.test.ts` 의 편성 테스트 숫자(14절), 마지막 단계의 `README.md`·`CLAUDE.md`·`docs/ROADMAP.md`. `src/view/city/staticCity.ts` 는 중부경찰서 지붕에 헬기 착륙장 그림 하나만(선택). `src/sim/cityPlan.ts`·`city.ts` 는 고치지 않는다.

시작하기 전에: B3·P1·Q1 은 2026-11-14 에 합쳐졌다(이 문서는 그 위에서 고쳐 썼다). **B1(화재 균형)이 진행 중이면 B1 이 합쳐진 뒤에 단계 0 의 기준을 잰다** — 화재 기준을 B1 결과 위에서 재기 위해서다(17절 화재 위험과 같은 조건). 아래 줄 번호는 2026-11-14 기준이라 바뀌었을 수 있다 — **함수 이름으로 찾는다**.

---

## 0. 지금의 모델 (바꾸기 전에 알아 둘 것)

| 무엇 | 지금 | 어디 |
|---|---|---|
| 인원 | 모든 부대 정확히 2명, `crew[0]` 이 선임 | `resources.createRoster` 의 `for (let k = 0; k < 2; k++)` |
| 대원 능력 | 고정 조직 시드 `new Rng(0x51ab7e).fork('roster-v1')` 에서 `UNIT_DEFS` 순서로 한 명당 6번. 편성되지 않는 부대도 뽑는다 | `createRoster` |
| 이름 | `NAMES[di * 2 + k]` (40개) | 같은 곳 |
| 장비 | 모두 부대 몫: `water`·`pumpCond`·`tool`·`medLevel`·`armor`·`flashbangs` | `types.ts` `Unit` |
| 방호 | 부서로: 연기·불·폭발 피해, 연기 속 속도, 위험 건물 실내 진입은 소방 | `sceneManager.agentHealth`, `executor.moveSpeed`, `hazards.blast`, `agents.fitFor` |
| 헬기 | `heli` 하나(소방, 특수 분야, 소방항공대). 수색 수요면 언제나, 그 밖은 위험도 2.3 이상이거나 구급 수요가 60초 넘게 비어 있을 때. 현장에 내려 대원 둘이 걷는다. 환자 1명 정원이지만 지휘관·실행기가 2명을 태운다(S7 사건 13) | `dispatcher.pickUnit`, `agents.canCarryPatients`, `commander` 탑승 대기열 |
| 인원에 기대는 문턱 | 무장 사건 경찰 대원 수 ≥2·≥3·≥4(두 문 진입), 두 문 진입의 "1조 둘 → 2조 둘" | `commander.syncBoard`, `executor` `case 'engage'` |
| 맡을 사람이 없는 작업 | B3 가 넣은 블록: 20초 넘게 열린 작업을 현장의 누구도 맡을 수 없고(`fitFor > 0` 인 활동 대원 없음) 그 능력(`caps ≥ NEED_MIN`)의 부대도 오고 있지 않으면 그 능력의 부대를 요청한다 | `commander.syncBoard` 의 `needFor` 블록 |
| 도착 시각 | `s.arrivedAt`·`I.firstArrivalAt` 을 첫 부대가 닿을 때 함께 정한다. 무대응 종료는 `I.firstArrivalAt < 0` 이고 신고 후 330초 | `sceneManager.unitArrived`, `incidents.tickIncidents` |

---

## 1. 원칙

- **조직이 아는 것과 현장의 진실을 가른다.** 관제·지휘관은 자기 조직의 편성·역할·장비·장비 상태(알려진 고장, 남은 섬광탄, 남은 연료)를 알아도 된다. 지금도 `u.flashbangs`·`u.water`·`crewReady` 를 본다. 현장의 진실(`s.casualties`, `s.hostiles`, `s.props`, `I.truth`, 숨은 고장)은 안 된다. 장비가 **무엇을 드러내는가**(열화상으로 보이는 사람, 상공에서 보이는 용의자)는 관찰하는 자리(`agents.perceive`, `field/rules/air.ts`)에서만 진실을 읽는다.
- **관제 수요는 부대 수 그대로.** 대신 "능력(`caps`)이 기준을 넘는 부대에는 그 일을 할 장비를 가진 대원이 반드시 있다"를 불변 조건으로 두고 테스트로 지킨다(14절 ③). 그래서 관제가 부대 수로 보내도 도착한 부대가 그 일을 할 수 있다.
- **일 하나에 붙는 사람 수(`WorkItem.max`)는 바꾸지 않는다.** 사람이 늘면 다른 일을 맡는다. 진압은 관창(`hose`)을 든 사람만 하므로 펌프차 한 대의 분사 인원은 지금처럼 둘이다.
- **`types.ts` 는 추가만.** `Unit.tool`·`medLevel`·`armor`·`flashbangs` 는 남긴다(뜻도 그대로: 부대의 대표 성능, 부대가 가진 섬광탄 수). 현장의 식은 사람 값을 쓴다.
- **새 기능의 난수는 새 흐름.** 12절 표에 있는 이름만 쓴다.
- **화면은 읽기만.** 역할·장비 그림은 상태에서 정한다. 화면만 고친 단계는 `sweep` 분포가 한 건도 달라지면 안 된다.

---

## 2. 편성표

자리 순서 = `crew` 순서. **0번 자리가 부대장**(`senior`, 출동 준비 시간·첫 지휘관 후보·부대를 고를 때 선택되는 사람). 지금 있는 20팀의 0·1번 자리는 지금의 선임·후임이다(이름·기본 능력치가 그대로 남는다, 5절). "내림 ✕" 는 현장에 내리지 않는 자리(조종사·정장 — `FieldAgent` 가 되지 않는다).

| 종류 (`UnitKind`) | 분야 | 표준 | 최소 (뺄 자리) | 자리 순서 (역할) | 차량·항공기 능력의 변화 |
|---|---|---|---|---|---|
| `patrol` 순찰차 | 경찰 | 2 | 2 | 순찰 팀장 · 순찰 경관 | 그대로. `seats 0` |
| `tactical` 기동 순찰차 | 경찰 | 3 | 2 (2) | 기동 조장 · 기동대원 · 기동대원 | 그대로 |
| `policeHeli` 경찰 헬기 **새** | 경찰 | 3 | 2 (1) | 기장(내림 ✕) · 부기장(내림 ✕) · 전술 관측관(내림 ✕) | 아래 7절. `caps.search 1.6` 만 |
| `engine` 진압 펌프차 | 소방 | 4 | 3 (2) | 진압 팀장 · 관창수 · 진입대원 · 기관원 | `spareAir 4` |
| `ladder` 사다리차 | 소방 | 3 | 2 (2) | 사다리 팀장 · 관창수 · 사다리 조작원 | `spareAir 3` |
| `rescue` 구조 공작차 | 구조·구급 | 5 | 4 (3) | 구조 팀장 · 구조대원(유압) · 구조대원(유압) · 구조대원(탐지) · 구조대원(로프) | `spareAir 5` |
| `als` 전문 구급차 | 구조·구급 | 3 | 2 (1) | 1급 응급구조사 · 응급구조사 · 구급 운전원 | `seats 2` |
| `bls` 일반 구급차 | 구조·구급 | 2 | 2 | 응급구조사 · 구급 운전원 | `seats 2` |
| `medHeli` 의료 헬기 **새** | 구조·구급 | 4 | 3 (3) | 의사 · 항공 간호사 · 기장(내림 ✕) · 부기장(내림 ✕) | 7절. `caps.ems 1.2`, `seats 1` |
| `swat` 특공대 | 특수 | 5 | 4 (4) | 특공 팀장 · 방패수 · 진입대원(파괴) · 진입대원 · 저격·관측수 | 그대로 |
| `heli` 소방 헬기 | 특수 | 4 | 3 (3) | 항공 구조대원 · 항공 구조대원 · 기장(내림 ✕) · 부기장(내림 ✕) | `caps` 바뀜(7절), `seats 1`, `hoist`, `bucketMax 1` |
| `hazmat` 화학 구조차 | 특수 | 4 | 3 (2) | 화학 팀장 · 화학 보호복 대원 · 화학 보호복 대원 · 측정·제독 대원 | `spareAir 4` |
| `boat` 구조정 | 특수 | 3 | 3 | 수난 구조대원 · 수난 구조대원 · 정장(내림 ✕) | 그대로 |
| `eod` 폭발물 처리반 | 특수 | 3 | 2 (2) | 폭발물 처리 요원 · 로봇 조작 요원 · 경계 요원 | 그대로 |

- 근거가 되는 결: 순찰차 2명, 기동 순찰 2~4명, 펌프차 3~4명, 사다리차 2~3명, 구조대 4~5명, 구급차 2~3명, 특공대 4~6명, 폭발물 처리 2~3명, 헬기는 조종사 1~2명 + 임무 요원. 특정 기관의 실제 편성표를 옮긴 것이 아니다.
- **최소 인원 자리는 능력 불변 조건(14절 ③)을 깨지 않게 골랐다**: 펌프차는 진입대원(관창 둘 중 하나)을 빼도 관창수가 남고, 구조 공작차는 탐지 대원을 빼도 로프 대원(소형 관창)이 남는다.
- 편성 단계(`minLevel`): 경찰 헬기 3, 의료 헬기 3. 그래서 부대 규모 손잡이 1~5 의 팀 수는 **12 · 15 · 19 · 21 · 22**(지금 12 · 15 · 17 · 19 · 20). 분야별 팀 수는 1 단계에서 3 · 3 · 3 · 3, 5 단계에서 경찰 6 · 소방 5 · 구조·구급 6 · 특수 5.
- 총원(표준, 22팀): 75명. 보통(19팀): 63명(지금 34명). 부대 규모 1(12팀, 최소 인원): 32명(지금 24명). 숫자는 테스트가 표에서 계산해 확인한다 — 손으로 적은 숫자에 기대지 않는다.
- 부대 규모 손잡이(`resources`)가 바꾸는 것: **팀 수(편성 단계)와 인원(1·2 = 최소, 3~5 = 표준)**. `KNOBS` 의 설명문(최종): `'출동 부대 수 (12 · 15 · 19 · 21 · 22팀)와 인원. 경찰·소방·구조·특수 네 분야에 3~6팀씩이고, 3 이 기본 편성이다. 1·2 는 최소 인원(펌프차 3명, 구조대 4명, 특공대 4명 …)으로 나간다. 인근 도시 지원 횟수도 함께 늘어난다 (2 · 2 · 3 · 4 · 5회).'`, 같은 줄의 `high: '20팀'` → `'22팀'`.
  - **단계마다 맞는 문장**: 단계 1 에서는 팀 수가 아직 12 · 15 · 17 · 19 · 20 이므로 지금 문장에 인원 한 문장("1·2 는 최소 인원 …")만 더한다. 팀 수(12 · 15 · 19 · 21 · 22, 3~6팀), `high: '22팀'`, 주석 두 곳(`difficulty.ts` `Difficulty.resources` 의 `1 = 12팀 … 5 = 20팀`, `resources.ts` `UNIT_DEFS` 위의 `(1 = 12팀 … 5 = 20팀)`·`3~5팀`)은 헬기 두 줄을 붙이는 **단계 4** 에서 고친다.

### 역할 표 (`crews.ts` 의 `ROLES`)

`s` = 그 대원의 `skill`(0.3~0.98, 지금처럼 뽑는다). 능력(`skills`)은 역할의 식으로만 정하고 0..1 로 자른다(추가 난수 없음). "먼저 맡는 일"은 `fitFor` 에 더하는 값(맡을 수 있을 때만, 6절). 새 자리(2번 이후)의 경험 범위가 다르면 적었다(없으면 0.2~0.75).

| `RoleId` | 이름 | 그림 묶음 | skills (fire · rescue · medical · law) | 기본 장비 | 먼저 맡는 일 (+) · 피하는 일 (−) |
|---|---|---|---|---|---|
| `patrolLead` | 순찰 팀장 | lead | .05 · .22 · .25 · s+.04 | pistol, taser, vest, megaphone, aed | negotiate +.15, interview +.15 |
| `officer` | 순찰 경관 | officer | .05 · .22 · .22 · s | pistol, taser, vest, baton | traffic +.15, perimeter +.1, arrest +.1 |
| `tacLead` | 기동 조장 | lead | .05 · .22 · .22 · s+.06 | pistol, plate, megaphone | negotiate +.1 |
| `tacOfficer` | 기동대원 | officer | .05 · .22 · .22 · s+.06 | rifle, plate, flashbang | engage +.15, arrest +.1 |
| `swatLead` | 특공 팀장 | lead | .05 · .25 · .25 · s+.12 | pistol, plate, flashbang | negotiate +.05 |
| `shield` | 방패수 | shield | .05 · .22 · .22 · s+.1 | pistol, plate, shield | engage +.2 |
| `breacher` | 진입대원(파괴) | entry | .05 · .35 · .22 · s+.1 | rifle, plate, breachKit, flashbang | force +.3, engage +.1 |
| `assaulter` | 진입대원 | officer | .05 · .22 · .22 · s+.12 | rifle, plate, flashbang | engage +.15 |
| `marksman` | 저격·관측수 | marksman | .05 · .2 · .2 · s+.15 | sniper, plate | perimeter +.3, engage −.15 |
| `bombTech` | 폭발물 처리 요원 | bomb | .05 · .3 · .22 · s−.15 | bombSuit, eodKit | defuse +.3 |
| `robotOp` | 로봇 조작 요원 | bomb | .05 · .25 · .22 · s−.05 | robot, pistol, vest | perimeter +.1 |
| `eodGuard` | 경계 요원 | officer | .05 · .22 · .22 · s | pistol, vest, megaphone | perimeter +.2 |
| `observer` | 전술 관측관 (내림 ✕) | observer | .05 · .2 · .2 · s | flir, searchlight | — (경험 .4~.9) |
| `pilot` | 기장 (내림 ✕) | pilot | .05 · .2 · .2 · .05 | — | — (경험 .55~.95) |
| `copilot` | 부기장 (내림 ✕) | pilot | .05 · .2 · .2 · .05 | — | — (경험 .3~.8) |
| `fireLead` | 진압 팀장 | lead | s · s×.7 · .35 · .05 | scba, turnout, tic, irons, aed | search +.1, force +.1 |
| `nozzle` | 관창수 | nozzle | s+.05 · s×.55 · .3 · .05 | scba, turnout, hose | suppress +.15, overhaul +.1 |
| `firefighter` | 진입대원 | entry | s×.95 · s×.7 · .3 · .05 | scba, turnout, hose, irons, rope | search +.1, force +.1, carry +.05 |
| `engineer` | 기관원 | engineer | s×.8 · s×.5 · .3 · .05 | scba, turnout, pumpPanel | hookup +.3, traffic +.1, clearRoad +.1, search −.25 |
| `ladderLead` | 사다리 팀장 | lead | s · s×.7 · .35 · .05 | scba, turnout, tic, irons | search +.1, force +.1 |
| `ladderOp` | 사다리 조작원 | engineer | s×.85 · s×.5 · .3 · .05 | scba, turnout, pumpPanel, hose | hookup +.3, search −.2 |
| `rescueLead` | 구조 팀장 | lead | s×.7 · s · .4 · .05 | scba, turnout, searchKit, irons | search +.1 |
| `extricator` | 구조대원(유압) | rescue | s×.7 · s+.04 · .35 · .05 | scba, turnout, spreader | extricate +.25, clear +.15 |
| `searcher` | 구조대원(탐지) | search | s×.7 · s · .35 · .05 | scba, turnout, searchKit, irons | search +.2 |
| `ropeTech` | 구조대원(로프) | water | s×.6 · s · .35 · .05 | scba, turnout, rope, ring, hose | waterRescue +.3 |
| `hazLead` | 화학 팀장 | lead | s×.7 · s×.92 · .4 · .05 | scba, turnout, gasMeter, irons | search +.05 |
| `hazTech` | 화학 보호복 대원 | hazmat | s×.7 · s×.9 · .4 · .05 | scba, turnout, plugKit | mitigate +.3 |
| `decon` | 측정·제독 대원 | hazmat | s×.6 · s×.85 · .4 · .05 | scba, turnout, gasMeter, hose | search +.1, escort +.1 |
| `airRescuer` | 항공 구조대원 | rescue | .15 · s · .55 · .05 | scba, turnout, lightRescue, bag, rope | — (지금의 헬기 대원과 같게) |
| `boatRescuer` | 수난 구조대원 | water | .1 · s · .45 · .05 | rope, ring | waterRescue +.3 |
| `boatLead` | 정장 (내림 ✕) | pilot | .1 · .3 · .3 · .05 | — | — (경험 .5~.95) |
| `paramedic` | 1급 응급구조사 | medic | .05 · .25 · s+.08 · .05 | alsBag, aed | treat +.15 |
| `emt` | 응급구조사 | medic | .05 · .25 · s · .05 | bag, spineBoard | treat +.1, carry +.05 |
| `emsDriver` | 구급 운전원 | medic | .05 · .3 · s×.85 · .05 | stretcher | load +.2, carry +.1 |
| `doctor` | 의사 | doctor | .05 · .2 · min(1, s+.2) · .05 | doctorKit, aed | treat +.3, carry −.2 (경험 .5~.9) |
| `flightNurse` | 항공 간호사 | medic | .05 · .25 · s+.1 · .05 | alsBag, stretcher | treat +.15, load +.15 |

- 대원의 부서(`Responder.dept`)는 부대의 부서와 같다(경찰 헬기 = police, 소방 헬기·구조정 = fire, 의료 헬기 = ems).
- `robotOp` 의 권총은 빼지 않는다: 최소 인원 폭발물 처리반(`bombTech`·`robotOp`)에서 불변 조건 ③ `caps.law ≥ 0.5 ⇒ 총기 대원` 을 지키는 사람이 그뿐이다. 대신 무장 사건의 인원 문턱(6.3)은 **역할 묶음 `bomb` 을 세지 않는다**.
- 그림 묶음(`RoleGroup`)은 부대 목록의 역할 점과 대원 그림에 쓴다(10절): `lead · officer · shield · entry · marksman · bomb · observer · pilot · nozzle · engineer · rescue · search · water · hazmat · medic · doctor`.

---

## 3. 자료형 (`types.ts` 에 추가)

```ts
// ── 대원의 역할과 개인 장비 (R1) ──
export type RoleId =
  | 'patrolLead' | 'officer' | 'tacLead' | 'tacOfficer' | 'swatLead' | 'shield' | 'breacher' | 'assaulter' | 'marksman'
  | 'bombTech' | 'robotOp' | 'eodGuard' | 'observer' | 'pilot' | 'copilot'
  | 'fireLead' | 'nozzle' | 'firefighter' | 'engineer' | 'ladderLead' | 'ladderOp'
  | 'rescueLead' | 'extricator' | 'searcher' | 'ropeTech' | 'hazLead' | 'hazTech' | 'decon' | 'airRescuer' | 'boatRescuer' | 'boatLead'
  | 'paramedic' | 'emt' | 'emsDriver' | 'doctor' | 'flightNurse';
export type RoleGroup = 'lead' | 'officer' | 'shield' | 'entry' | 'marksman' | 'bomb' | 'observer' | 'pilot' | 'nozzle' | 'engineer' | 'rescue' | 'search' | 'water' | 'hazmat' | 'medic' | 'doctor';
export type KitId =
  | 'scba' | 'turnout' | 'hose' | 'tic' | 'irons' | 'spreader' | 'breachKit' | 'lightRescue' | 'searchKit' | 'rope' | 'ring'
  | 'pumpPanel' | 'plugKit' | 'gasMeter'
  | 'bag' | 'alsBag' | 'doctorKit' | 'aed' | 'stretcher' | 'spineBoard'
  | 'pistol' | 'rifle' | 'sniper' | 'taser' | 'flashbang' | 'vest' | 'plate' | 'shield' | 'bombSuit' | 'eodKit' | 'robot' | 'megaphone' | 'baton'
  | 'flir' | 'searchlight';
/** 대원 한 사람이 든 장비 하나 */
export interface KitItem {
  id: KitId;
  uses?: number;        // 남은 수량: 섬광탄·테이저 카트리지는 개수, 공기호흡기는 남은 초
  fault?: boolean;      // 이번 교대에 고장 나 있다 (처음 쓰려 할 때 드러난다)
  faultKnown?: boolean; // 고장이 드러났다 (이때부터 조직이 안다)
}
/** 현장 상공에 머무는 헬기의 일 (field/rules/air.ts 가 굴린다) */
export interface AirOp {
  unitId: number; mode: 'watch' | 'hoist' | 'bucket';
  x: number; y: number; px: number; py: number;       // 현장 격자 위의 자리 (칸)
  phase: 'hover' | 'work' | 'away' | 'leave';          // away = 물을 뜨러 감 (현장 밖)
  target: number;                                      // hoist: casualty id, bucket: region id, 없으면 -1
  workId: number;                                      // 지휘관 작업판의 작업 (없으면 -1)
  progress: number; need: number;
  backAt: number;                                      // away 에서 돌아오는 시각
  idleSince: number;                                   // 할 일이 없어진 시각 (-1 = 일하는 중)
  eye: FieldAgent;                                     // 공중 관측자 — s.agents 에 넣지 않는다
}
export interface AirStats { sorties: number; byKind: Record<string, number>; hoists: number; drops: number; airLifts: number; rtb: number; tracked: number; grounded: string | null }

// Responder 에 추가
role?: RoleId;
kit?: KitItem[];
// Unit 에 추가
seats?: number;                 // 환자 자리 (구급차 2, 소방·의료 헬기 1, 나머지 0). agents.seatsOf 만 읽는다
hoist?: boolean;                // 호이스트가 있다 (소방 헬기)
bucket?: number; bucketMax?: number;     // 물 바구니에 담긴 투하 횟수 / 한 번에 담는 횟수 (소방 헬기 1)
fuel?: number; fuelMax?: number;         // 헬기의 남은 체공 시간(초)
grounded?: 'fog' | 'night' | 'storm' | null;   // 지금 뜰 수 없는 이유
spareAir?: number;              // 차에 실은 예비 공기통 수
airNeed?: keyof Needs;          // 헬기가 이번 출동에서 맡은 수요 (dispatcher.sendUnit 이 적는다. airRtb 가 되돌린다)
// FieldAgent 에 추가
aloft?: boolean;                // 공중 관측자 (AirOp.eye). 걷지 않고 무전 음영을 받지 않는다
taserAt?: number;               // 마지막으로 테이저를 쏜 시각 (사격 대기 a.cooldown 과 따로)
// Scene 에 추가
air?: AirOp[];
light?: { x: number; y: number; r: number } | null;      // 경찰 헬기 탐조등이 비추는 곳 (밤)
airAt?: number;                 // 상공 부대가 처음 닿은 시각 (없으면 -1/undefined). s.arrivedAt 은 지금 뜻 그대로 지상 대원이 처음 내린 시각
clearVision?: number;           // 그 현장의 맑은 날 바깥 시야 (baseScene 7.5, 실종 현장 3.8). 탐조등이 쓴다
// Incident 에 추가
airDone?: UnitKind[];           // 이 사건에서 "상공 임무 종료"로 풀려난 헬기 종류 (관제가 같은 종류를 다시 보내지 않는다)
// ShiftReport 에 추가
air?: AirStats;
```

합집합 끝에 덧붙인다(여러 줄에 걸친 합집합은 새 줄로, 인터페이스 안의 한 줄짜리 합집합은 그 줄 끝에 — 어느 쪽이든 추가만이다):

- `UnitKind`: `| 'policeHeli' | 'medHeli'`
- `WorkKind`: `| 'hoist' | 'airDrop'` — 공중 임무. 지휘관이 작업판에 올리고 `field/rules/air.ts` 가 가져간다. 지상 대원은 맡지 않는다(`fitFor` = 0). `agents.workLabel` 이 `Record<WorkKind, string>` 이라 이름이 있어야 컴파일된다: `hoist` → `${구조 대상} 호이스트 인양`, `airDrop` → `${구역} 공중 물 투하`.
- `TaskKind`: `| 'swapAir'` — 공기통 교체(9절). 작업 이름(`setTask` 의 라벨)은 `'공기통 교체'`.
- `Fx.kind`: `interface Fx` 안의 한 줄(`kind: 'shot' | … | 'debris'`) 끝에 `| 'drop'` (물 투하 효과). 새 줄로 붙일 수 없으니 그 줄을 고친다.

`Sim`(`engine.ts`)에 `airStats: AirStats` 를 하나 둔다(`createRoster` 가 채운다).

---

## 4. 개인 장비 (`crews.ts` 의 `KITS`)

```ts
export type ToolUse = 'force' | 'clear' | 'extricate' | 'water';
export interface KitDef {
  name: string;                       // 화면 이름 ('공기호흡기')
  group: 'fire' | 'rescue' | 'med' | 'police' | 'air';      // 대원 정보창의 작은 기호
  tool?: Partial<Record<ToolUse, number>>;     // 일에 쓰는 장비의 성능 (0..1)
  med?: number;                       // 의료 장비 수준 (지금의 medLevel 자리)
  armor?: number;                     // 총격 방호 (지금의 armor 자리)
  faultable?: boolean;                // 교대마다 고장 추첨을 받는다
}
```

| 장비 | 이름 | 효과 (어디서) | 지금 무엇을 대신하나 |
|---|---|---|---|
| `scba` | 공기호흡기 | 연기 피해 0.1(없으면 1.3)×연기, 연기 속 이동 ×0.8(없으면 ×0.6), 연기 경로 비용 0.8(없으면 3), **위험 건물(화재·가스·붕괴) 실내 진입 자격**. `uses` = 공기(초, 9절) | `dept === 'fire'` |
| `turnout` | 방화복 | 불 피해 2.6(없으면 9)×불, 폭발 피해 ×0.7, 실내 수색 중 4칸 안 불 0.35 에서 물러나지 않는다, `brain.dangerScore` 의 소방 쪽 판단, 총격 방호 0.1 | `dept === 'fire'` |
| `hose` | 관창·소방 호스 | `suppress`·`overhaul` 자격, 경로의 불(0.5 초과)을 진압하며 지나갈 자격(`agentCost`·`executor` 경로 하위 작업) | `skills.fire ≥ 0.35`, 소방 |
| `tic` | 열화상 카메라 | 시야의 연기 감쇠 0.78 → 0.35, 연기 0.3 넘는 칸에서 은폐 ×0.7 (탐지 반경 ↑). 고장 추첨 — 고장은 `perceive` 에서 드러난다(아래 "고장이 드러나는 자리") | — |
| `irons` | 할리건·도끼 | tool force .9, clear .6, extricate .45 | `u.tool` |
| `spreader` | 유압 구조기 | tool force .8, clear .7, extricate 1.0. 고장 추첨 | `u.tool` |
| `breachKit` | 파괴 장비(램·할리건) | tool force 1.0, clear .4 | — |
| `lightRescue` | 휴대 구조 장비 | tool force .6, clear .6, extricate .6, water .6 | 헬기 `u.tool .6` |
| `searchKit` | 탐지 장비(음향·영상) | 붕괴 현장에서 은폐 ×0.45. 고장 추첨 | `kind === 'rescue'` (`agents.detectRadius`) |
| `rope` | 구조 로프 | tool water .9 | `u.tool` |
| `ring` | 구명환 | tool water .8 | `u.tool` |
| `pumpPanel` | 펌프 조작 | 소화전 연결 시간 9 → 5.5초. 그 부대의 이 대원이 활동 중이고 대기 지점 6칸 안에 있으면 분사 때 펌프 마모 ×0.6, 물 소모 ×0.9 | — |
| `plugKit` | 누출 차단 장비 | 밸브·누출 조치(`mitigate`) 시간 ÷1.6 | — |
| `gasMeter` | 가스 측정기 | 새는 밸브를 벽 너머 7칸에서 알아챈다(지금 시야 안 4.5칸) | — |
| `bag` | 기본 응급 가방 | med .75 | `u.medLevel` |
| `alsBag` | 전문 응급 가방 | med 1.0 | `u.medLevel` |
| `doctorKit` | 의사 장비(약물·수혈) | med 1.1. 건강 40 미만 환자 처치 때 +15(보통 +8×q), 출혈 감소 1−0.95q(보통 1−0.9q) | — |
| `aed` | 제세동기 | 심정지(`s.variant === 'arrest'`) 환자나 건강 25 미만 환자의 처치 질 q +0.2(상한 1). 고장 추첨 | — |
| `stretcher` | 들것 | 옮기는 사람이나 곁의 사람이 들것을 가졌으면 이송 속도 둘일 때 0.78 → 0.88, 혼자 0.48 → 0.55. 그림에 들것이 보인다 | (그림만 있었다) |
| `spineBoard` | 척추 고정판 | 교통사고·붕괴 현장에서 구출된(`tFreed ≥ 0`) 사람을 고정판 없이 옮기면 옮기는 동안 출혈 ×1.12 | — |
| `pistol` | 권총 | `perimeter`·`engage`·`arrest` 자격. 사격 거리 감쇠는 지금 식 그대로(`1.3 − d/14`) | `dept === 'police'` |
| `rifle` | 소총 | 위 자격. 거리 감쇠 `1.3 − d/18` | — |
| `sniper` | 저격 소총 | 위 자격. 거리 감쇠 `1.35 − d/32`, 하한 0.6 | — |
| `taser` | 테이저 | `arrest` 자격. 총이 아닌 용의자가 `fight` 일 때 4칸 안·시야에서 쏜다: 0.72 확률로 3.2초 무력화(`h.stunUntil`). `uses 2`. 고장 추첨 | — |
| `flashbang` | 섬광탄 | `uses` = 개수(5절 나눔) | `u.flashbangs` |
| `vest` | 방검·방탄 조끼 | armor .25 | `u.armor` |
| `plate` | 전술 방탄 조끼 | armor .6 | `u.armor` |
| `shield` | 방탄 방패 | `engage`·`perimeter` 중 armor +.3, 그 동안 이동 ×0.9 | — |
| `bombSuit` | 폭발물 방호복 | armor .6, 폭발 피해 ×0.35, 이동 ×0.75 | — |
| `eodKit` | 해체 공구 | `defuse` 자격 | `u.caps.eod ≥ 0.9` |
| `robot` | 원격 로봇 | 현장에 이 장비를 든 대원이 활동 중이면: 가짜 장치 확인 10 → 5초, 진짜 장치 해체 실수 확률 ×0.6. 고장 추첨 | — |
| `megaphone` | 확성기 | 협상 진행 ×1.2 | — |
| `baton` | 경광봉 | 교통 통제 시간 ×0.85 | — |
| `flir` | 공중 열영상 | 공중 관측자의 은폐 ×0.35, 연기를 무시(7.3) | — |
| `searchlight` | 탐조등 | 밤에 공중 관측 거리 8, 비추는 원 안의 바깥 칸에서 지상 대원의 기본 시야를 `max(지금 값, s.clearVision ?? 7.5)` 로(7.3 — 기본 현장 7.5, 실종 현장 3.8. 고정 숫자를 쓰지 않는다). 고장 추첨 — 고장은 `air.ts` 가 밤에 처음 켤 때 드러난다 | — |

### 도움 함수 (`crews.ts`, 모두 순수 함수)

```ts
export function roleOf(sim: Sim, rid: number): RoleDef;
export function hasKit(sim: Sim, rid: number, id: KitId): boolean;        // 들고 있고, 알려진 고장이 아니다 (배정·관제 판단용 — 숨은 고장은 모른다)
export function kitWorks(sim: Sim, rid: number, id: KitId, I?: Incident): boolean;   // 효과를 줄 때만 부른다. 숨은 고장이면 이때 드러나 기록을 남기고 false
export function kitUses(sim: Sim, rid: number, id: KitId): number;
export function useKit(sim: Sim, rid: number, id: KitId, n = 1): void;    // 수량을 줄인다. 섬광탄이면 부대의 u.flashbangs 도 같이 줄인다
export function kitLive(sim: Sim, rid: number, id: KitId): boolean;      // 들고 있고 실제로 작동한다 (= 고장이 아니다. 숨은 고장도 본다). 드러내지 않고 기록도 남기지 않는다 — 세계의 물리(시야·탐지)만 쓴다. 아래 규칙
export function toolFor(sim: Sim, rid: number, use: ToolUse): number;     // 계획용: 알려진 고장만 뺀(hasKit) 장비 가운데 가장 좋은 값 × tn.toolMul, 상한 1.15. 없으면 맨손 0.12. fitFor·agentCost·관제가 쓴다 — 숨은 고장은 모른다
export function toolUse(sim: Sim, rid: number, use: ToolUse, I: Incident): number;   // 실행기 전용: toolFor 의 순서대로 고른 장비에 kitWorks 를 부른다. 숨은 고장이 드러나면 다음으로 좋은 장비로, 다 없으면 맨손 0.12
export function medLevelOf(sim: Sim, rid: number): number;               // 가장 좋은 의료 장비 × tn.medMul, 상한 1.1. 없으면 부서 기본값: 경찰 .25 · 소방 .35 · 구급 .5
export function armorOf(sim: Sim, rid: number, engaging: boolean): number;     // 가장 좋은 방호 (+방패) × tn.armorMul, 상한 0.8
export function blastFactor(sim: Sim, rid: number): number;              // 방호복 .35 · 방화복 .7 · 그 밖 1
export function hasFirearm(sim: Sim, rid: number): boolean;              // pistol · rifle · sniper
export function stays(sim: Sim, rid: number): boolean;                   // 현장에 내리지 않는 자리
export function fieldCrew(sim: Sim, u: Unit): number[];                  // 내리는 자리만 (전원이 내리지 않으면 전원)
export function crewHasKit(sim: Sim, u: Unit, id: KitId, okOnly = true): boolean;
export function seatsOf(u: Unit): number;                                // u.seats ?? 0
export function minCrew(kind: UnitKind): number;                         // 최소 인원 표의 인원 (H1 의 결원 처리가 쓸 수 있다)
export function isHovering(u: Unit, s: Scene): boolean;                  // 7.3 (종류와 현장만 본다 — 상태는 부르는 쪽이 따로 본다)
export function capableOf(sim: Sim, rid: number, kind: WorkKind): boolean;   // 6.4. 장비·부서와 알려진 공기 상태만
export const AIR_KIND: Set<UnitKind>;                                    // new Set(['heli', 'policeHeli', 'medHeli']). createRoster 와 view(marks·tokens)가 함께 쓴다
// airFit(sim, u, I, key) 는 etaFor 가 필요해 dispatcher.ts 에 둔다 (7.2, 15절)
```

`kitWorks` 가 숨은 고장을 드러낼 때: `it.faultKnown = true` 와 `raiseProblem(sim, I, 'EQUIP_FAIL', `${r.name}의 ${josa(KITS[id].name, '이/가')} 고장`, { role: 'RESPONDER', actor: r.name, rid: r.id, imp: 1, text: `${josa(KITS[id].name, '이/가')} 작동하지 않습니다.` }, false)`. 같은 대원·같은 장비는 한 번만. 기록은 상태를 바꾸는 바로 그 자리(`faultKnown`)에서 남긴다.

**장비를 읽는 네 가지 방법 — 어디서 무엇을 쓰는가**

| 함수 | 숨은 고장 | 상태를 바꾸나 | 쓰는 곳 |
|---|---|---|---|
| `hasKit` · `toolFor` · `crewHasKit` · `capableOf` | 모른다(있는 것으로 본다) | 아니다 | 배정·계획·관제: `fitFor`, `agentCost`, `brain`, `commander`, `dispatch/*` |
| `kitLive` | 안다(효과 없음) | 아니다 | 세계의 물리 가운데 **표현 계층도 부르는 함수**: `visionOf`, `detectRadius`. 고장 난 카메라로는 실제로 덜 보인다 — 그러나 드러내지는 않는다 |
| `kitWorks` · `toolUse` | 이때 드러난다(기록) | 그렇다(`faultKnown`, `sim.events`) | 시뮬레이션만 부르는 효과 자리: `executor` 의 각 `case`, `perceive`, `field/rules/air.ts` |
| `kitUses` · `useKit` | 상관없다 | `useKit` 만 | 수량 |

- **표현 계층이 부르는 함수에서는 `kitWorks`·`toolUse`·`useKit` 을 부르지 않는다.** `visionOf` 는 `renderScene.ts` 가 시야 다각형과 밤·안개 어둠 층을 그릴 때 직접 부르고, `agentCost` 도 `visionOf` 를 부른다. 여기서 고장을 드러내면 그림을 그리는 것만으로 `faultKnown` 과 `sim.events`·`logHash` 가 바뀐다. 헤드리스 결과와 브라우저 결과가 갈라지고, 되감기(`runner.seek` 는 그림 없이 다시 돌린다)의 해시도 달라진다(CLAUDE.md 2·3번). 그래서 `visionOf`·`detectRadius` 는 `kitLive` 로 효과만 계산하는 순수 함수로 둔다.
- **고장이 드러나는 자리**(한 장비에 한 곳):
  - `tic`: `perceive`(지상 대원, `!a.aloft`)에서 대원이 연기 0.3 넘는 칸에 있고 `tic` 을 들었으며 아직 드러나지 않았으면 `kitWorks` 를 한 번 부른다. 연기가 없는 곳에서는 드러나지 않는다.
  - `searchKit`: 붕괴 현장(`s.kind === 'collapse'`)에서 그 대원이 처음 `perceive` 할 때.
  - `spreader` 등 도구: 실행기에서 `toolUse` 가 고를 때.
  - `aed`·`taser`·`robot`: 실행기에서 효과를 주려 할 때.
  - `searchlight`: `air.ts` 가 밤에 처음 켤 때.
- `agentPose`(그림)의 장비 그림은 `hasKit` 으로 고른다(읽기만).

### 부대 장비 → 사람 장비: 남는 것과 옮기는 것

| 지금 (부대) | 바뀐 뒤 |
|---|---|
| `water`·`waterMax`·`hydrant` | **부대에 남는다**(탱크). 쓰는 사람은 관창을 든 사람뿐 |
| `pumpCond`·`pumpFailed` | **부대에 남는다**(펌프). 기관원이 차 곁에 있으면 덜 닳는다 |
| `tool` | 부대 값은 남기되(관제가 보는 대표값) 현장의 식은 `toolFor(사람)` |
| `medLevel` | 같음 → `medLevelOf(사람)`. 이송 중 차 안 처치는 **함께 탄 대원 가운데 가장 높은 값** |
| `armor` | 같음 → `armorOf(사람)` |
| `flashbangs` | 사람 몫(`kit` 의 `uses`)으로 나눈다. `u.flashbangs` 는 **그 합**으로 맞춰 두고 `useKit` 이 함께 줄인다(뜻 그대로) |
| (부서) 연기·불·폭발 방호, 실내 진입 | `scba`·`turnout`·`bombSuit` |
| (`kind === 'rescue'`) 붕괴 탐지 | `searchKit` |
| (`kind === 'heli'`) 환자 1명 | `Unit.seats` |
| (`caps.eod ≥ 0.9`) 해체 자격 | `eodKit` |

---

## 5. 명부 만들기 (`resources.createRoster`, `createAidUnit`)

- `UNIT_DEFS` 의 지금 20줄은 **순서·내용 그대로** 두고, 끝에 두 줄을 붙인다:
  `U('경찰헬기1', 'policeHeli', 'police', '중부경찰서', 3)`, `U('의료헬기1', 'medHeli', 'rescue', '가온대학교병원', 3)`.
  `KIND` 에 두 종류를 더하고(7.1 표), `KIND` 에 `seats`·`hoist?`·`bucketMax?`·`fuelMax?`·`spareAir?` 칸을 더한다. `heli` 의 `caps` 는 단계 4 에서 바꾼다.
- 자리 목록: `STAFF[kind].std`(역할 배열)와 `STAFF[kind].minDrop`(최소 인원에서 뺄 자리 번호). `tn.unitLevel <= 2` 면 최소 인원.
- **능력치의 난수** — 지금의 40명이 같은 능력치를 갖도록:
  - 처음 20줄의 0·1번 자리: 지금 코드 그대로 `roster-v1` 에서 한 명당 6번(경험 1 + `st()` 5). 편성 여부와 최소 인원 여부에 상관없이 뽑는다(지금과 같은 순서·같은 횟수).
  - 그 밖의 자리(처음 20줄의 2번 이후, 새 두 줄의 모든 자리): 자리마다 따로 `new Rng(0x51ab7e).fork('roster-v2:' + callsign + ':' + slot)` 에서 같은 식으로 6번. 자리마다 흐름이 따로이므로 다른 부대의 인원과 상관없이 같은 사람 = 같은 능력치다. 경험 범위는 역할에 `exp` 가 있으면 그것, 없으면 0번 자리는 선임 범위(.6~.97), 그 밖은 .2~.75.
  - `skills` 는 역할의 식(2절 표)으로 정한다. 지금의 40명도 역할의 식을 따르므로 `skills` 값은 조금 바뀔 수 있다(`skill`·`judgment` 등 기본 능력은 그대로).
- **이름**: 처음 20줄의 0·1번 자리는 지금처럼 `NAMES[di * 2 + k]`. 나머지 자리는 새 목록 `EXTRA_NAMES` 를 (줄 순서 × 자리 순서)로 차례로 쓴다(표준 편성 기준 35개 필요, 모두 달라야 하고 `NAMES`·`AID_NAMES` 와도 겹치지 않는다). **첨자는 표준 표(`STAFF[kind].std`)의 자리로 고정한다** — 편성되지 않은 줄, 최소 인원에서 빠진 자리도 자기 번호를 차지한 채 건너뛴다(앞으로 당기지 않는다). 그래야 `roster-v2:<호출부호>:<자리>` 의 능력치와 이름이 부대 규모와 상관없이 언제나 같은 사람을 가리킨다(테스트 ⑦). 가상의 이름 예: `구본호 나윤슬 도해찬 마서율 반지성 백승아 사공진 선우람 설하윤 성도진 손예찬 송하람 심지율 양태호 염소희 오세린 우지환 원채린 유건희 윤다온 이로하 임하준 장세아 전도하 정이든 제갈윤 조서하 주원석 지예솔 진태경 천소율 최한결 태은호 편서우 하도율 허은재`. 자리를 끼워 넣으면 뒤쪽 이름이 밀리므로 **새 자리는 표의 끝에 붙인다**.
- 대원에 `role`, `kit`(역할의 기본 장비를 `{ id }` 로 복사) 를 채운다. `senior = (slot === 0)`.
- **섬광탄 나눔**: 부대 몫(기동 = `tn.flashbangs`, 특공 = `tn.flashbangs + 2`, 지원 기동 = `min(2, tn.flashbangs)`)을 `flashbang` 장비를 든 사람에게 자리 순서대로 하나씩 돌려 나눈다(기본 2 → 기동대원 1·1, 특공 4 → 팀장 1·진입(파괴) 1·진입 1 … 순서대로). 0 개인 사람의 `flashbang` 항목은 남기되 `uses: 0`. `u.flashbangs` = 합.
- **테이저** `uses: 2`. **공기호흡기**는 단계 6 전에는 `uses` 를 두지 않는다(없으면 공기가 줄지 않는 것으로 본다). 단계 6 에서 `tn.airFull` 로 채운다(9절).
- **고장 추첨**(단계 6): `sim.rng.fork('kit')` 하나로, 대원 순서(`rid`) × 장비 순서대로 `faultable` 장비마다 `tn.kitFault` 확률. 편성된 대원만 뽑는다(교대 시드에서 나오는 흐름이라 편성 여부에 묶여도 된다).
- 펌프 상태(`equipment` 흐름)는 그대로: 새 두 줄은 소방이 아니므로 뽑지 않는다 → 기존 소방 부대의 `pumpCond` 순서가 바뀌지 않는다.
- 부대에: `seats`, `hoist`, `bucket = bucketMax`, `fuel = fuelMax`, `spareAir`, `air = AIR_KIND.has(kind)`(`AIR_KIND` 는 `crews.ts` 에 있다 — `src/sim` 이 `src/view` 를 import 하지 않는다). 헬기의 집 자리는 7.1.
- **지원 부대**(`createAidUnit`): 그 종류의 **최소 인원** 편성과 역할·장비를 그대로 쓰고, 부대 칸도 편성표 부대와 같게 `KIND` 에서 `seats`·`spareAir`(그리고 해당하면 `hoist`·`bucketMax`·`fuelMax`)를 채운다 — 빠뜨리면 지원 구급차의 `seatsOf` 가 0 이라 영영 환자를 싣지 못하고, 테스트 ⑨(0 ≤ 0)도 잡지 못한다.
  - 난수는 지금처럼 `sim.rng.fork('aid:' + sim.aidUsed)` 하나에서, 순서는 **대원(자리 순서, 한 명당 경험 1 + `st()` 5 — 지금 식) → 펌프 상태(지금의 `pumpCond` 줄) → 고장 추첨(대원 순서 × 장비 순서)**.
  - 경험 범위: 0번 자리는 지금의 선임 범위(.55~.9), 그 밖의 모든 자리는 지금의 후임 범위(.15~.55). 역할의 `exp` 는 쓰지 않는다(지원 종류에는 조종사가 없다).
  - 이름은 `AID_NAMES[(sim.aidUsed * 4 + k) % AID_NAMES.length]`. 지원 종류의 최소 인원은 많아야 4명(구조 공작차)이고 지원은 교대당 많아야 5회이므로 **`AID_NAMES` 를 20개 이상으로 늘린다**(지금 16개 — 그대로면 다섯째 지원의 대원이 첫째 지원과 같은 이름이 된다). 더할 가상의 이름 예: `국태린 마하겸 도은결 위서담`(`NAMES`·`EXTRA_NAMES`·지금의 `AID_NAMES` 와 겹치지 않는다). 테스트 ⑦ 이 한 교대 안에서 이름이 겹치지 않는지 본다.
  - `AID_KIND` 는 그대로(헬기·구조정·특공대는 오지 않는다).
- `crewReady(sim, u)` = `fieldCrew` 가운데 `status === 'ok'` 인 수. `crewNames` 는 `fieldCrew` 만.
- 헬기가 뜨지 못하는 날씨: `u.grounded` 는 `createRoster` 에서 정하지만 **기록은 `engine.ts` 생성자에서 교대 시작 `emit` 바로 뒤에** 한 줄 남긴다(`createRoster` 는 교대 시작 기록보다 먼저 불린다 — `engine.ts` 의 `createRoster(this)` 가 `emit(… '교대 시작 …')` 보다 앞이다). `if (this.units.some((u) => u.grounded === 'fog')) emit(this, { role: 'SYSTEM', actor: '상황실', kind: 'shift', imp: 1, text: '안개로 오늘 헬기는 뜨지 못합니다.' })`, 밤이면 `'의료 헬기는 야간에 운항하지 않습니다.'`. 교대 시작 기록의 문구("가용 부대 N대, 대원 M명")는 그대로.

---

## 6. 현장: 장비가 일을 정한다

### 6.1 내리는 사람과 내리는 자리 (`sceneManager.unitArrived`)

- 대원이 되는 사람: `fieldCrew` 가운데 `status === 'ok'`. **상공에 머무는 부대(`isHovering`)는 아무도 내리지 않는다** — 도착 기록만 남기고(`${callsign} 현장 상공 도착.`) 돌아간다. 지휘관이 되지 않는다.
- **도착 시각**(17절 결정 10): `s.arrivedAt`·`I.firstArrivalAt`·`I.phase = 'onscene'` 은 **지금 뜻 그대로 지상 대원이 처음 내릴 때만** 정한다. 상공 부대가 처음 닿으면 새 칸 `s.airAt = sim.t`(아직 없을 때만)만 정한다.
  - 이렇게 가르는 까닭: `s.arrivedAt` 을 상공 도착으로 앞당기면 뜻이 바뀌는 곳이 여럿이다 — 신고자의 응급 처치 안내가 끊긴다(`hazards.applyCallerAid` 의 `s.arrivedAt >= 0` 이면 돌아감), 가스 현장 주변 시민 노출이 시작된다(`hazards.tickGas` 의 `s.arrivedAt >= 0`), 이벤트의 `truth: s.arrivedAt < 0` 표시, `LATE_DISCOVERY`(`agents.discover`), 보고서의 "부대 도착 전" 문장들(`debrief.ts`), 실종 수색 인력 요청(`commander.ts` 의 75초). 지상 기준으로 남겨 두면 이 모두가 지금처럼 돈다.
  - **한계 시간과 7)번 블록**은 `onAt(s)` = `s.arrivedAt` 과 `s.airAt` 가운데 먼저 정해진 값(둘 다 없으면 −1)부터 잰다 — 헬기만 떠 있어도 사건은 반드시 끝난다. 7)번 블록의 `if (I.phase !== 'closed' && s.arrivedAt >= 0)` 와 한계 시간 식의 `s.arrivedAt` 을 `onAt(s)` 로 바꾼다.
  - **무대응 종료**(`incidents.tickIncidents` 의 `I.firstArrivalAt < 0 && … > 330`)에 `&& !((sim.scenes[I.id]?.airAt ?? -1) >= 0)` 을 더한다. 그러지 않으면 헬기가 현장 위에서 호이스트로 사람을 건지는 동안 사건이 '무대응'으로 닫히고, 보고서가 "어떤 부대도 현장에 도착하지 못했습니다"라고 쓴다(규칙 5 위반).
  - 지금의 `first` 변수를 둘로 가른다(`firstGround`, `firstAir`). 단계 4 전에는 상공 부대가 없으므로 이 변경만으로는 결과가 바뀌지 않는다.
- 내리는 자리: 다섯 칸 × 세 줄, 0.7 간격 — `x = staging.x + (n % 5) * 0.7 − 1.4`, `y = staging.y + (floor(n / 5) % 3) * 0.7`. 그 칸이 지나갈 수 없으면(`staticPass` 가 아니면) `staging` 그대로. 첫 판단 시각 `t + 0.4 + k * 0.3`.
- 도착 기록 문구: `${callsign} 현장 도착 (${첫째 역할} ${첫째 이름} 외 ${n − 1}명). 신고 접수 후 …초.` — "첫째"는 **실제로 내린 사람의 첫째**다(0번 자리가 다쳐 내리지 않았으면 다음 사람). 한 명이면 이름만. 합류도 같게.
- 지휘관 후보는 지금처럼 내린 사람의 첫째(0번 자리가 내리는 자리면 부대장).

### 6.2 `agents.fitFor` 를 바꾼 뒤

| 일 | 맡을 수 있는 조건 (아니면 0) | 적합도 (바뀐 곳만) |
|---|---|---|
| `search` | 무장 현장 확보 전: 총기를 가진 경찰 / 위험 건물 실내: `scba` (지금 `dept === 'fire'`) | 그대로 |
| `suppress` | `hose` && 부대 펌프 정상 && (물 > 0 ‖ 소화전) | `skills.fire` |
| `hookup` | 소방 && 자기 부대 | 0.8 |
| `clear`·`force` | 누구나 | `0.3 + rescue*0.5 + toolFor(force/clear)*0.3` |
| `extricate` | 붕괴·가스 현장: `scba` | `rescue*(0.35 + 0.65*toolFor('extricate'))` (맨손이면 느리지만 25초 뒤에는 맡는다 — 지금 규칙 그대로) |
| `treat` | 그대로(무장 hot → 경찰, 기본 처치 뒤 → 구급) | `max(.08, medical*(.5 + .5*medLevelOf))` |
| `carry`·`escort` | 위험 건물 실내: `scba`. 지금은 믿음의 `cb.where === 'scene'` 일 때만 실내를 검사한다 — **`'carried'`(누가 옮기는 중)일 때도 믿음 속 자리로 같은 검사**를 한다. 그러지 않으면 `scba` 없는 대원이 이송 보조로 실내에 따라 들어간다(아래 6.3 이송 보조) | `+0.1` (들것) |
| `load` | 자기 부대 && `u.patients.length < seatsOf(u)` | 1 |
| `perimeter`·`engage` | 경찰 && `hasFirearm` | 그대로 |
| `arrest` | 경찰 && (`hasFirearm` ‖ `taser`) | 그대로 |
| `mitigate` | 그대로 | `+0.2` (`plugKit`) |
| `waterRescue` | 누구나 | `0.22 + rescue*0.5 + toolFor('water')*0.28` |
| `defuse` | `eodKit` | `0.6 + 0.4*skill` |
| `overhaul` | `hose` (불씨를 만나면 분사한다) | 그대로 |
| `hoist`·`airDrop` | 아무도 (공중 임무) | 0 |

마지막에 `if (fit > 0) fit = Math.max(0.02, fit + (role.prefer[w.kind] ?? 0))`. 0 이던 것은 0 으로 남는다(선호가 자격을 만들지 않는다).

`fitFor` 의 장비 판정은 모두 `hasKit`·`toolFor`(알려진 고장만 뺀다)로 한다. 숨은 고장이 있는 대원의 `fitFor` 값은 고장이 없는 대원과 **같아야** 한다(테스트 ④) — 숨은 고장이 배정에 새면 정보 격리가 깨진다.

### 6.3 부서 → 장비로 바꾸는 자리

| 파일 · 함수 | 지금 | 바뀐 뒤 |
|---|---|---|
| `sceneManager.agentHealth` | 연기 `dept === 'fire' ? 0.1 : 1.3`, 불 `2.6 : 9`, 연기 속 지구력 소모는 소방만 | `scba`(공기가 남았을 때) / `turnout` |
| `executor.moveSpeed` | 연기 속 `dept === 'fire' ? 0.8 : 0.6` | `scba` / `bombSuit` ×0.75 / 교전 중 `shield` ×0.9 |
| `executor.moveTo` 의 경로 불 하위 작업(`'진입로 화재 진압'`) | `dept === 'fire' && 펌프·물` | `hose && 펌프·물` |
| `executor` `case 'search'` 의 실내 불 물러남 | `dept !== 'fire'` | `!turnout` |
| `agents.agentCost` | `isFire`·`canSuppress`, `u.tool` | `scba`(연기 비용), `hose`(불 칸), `toolFor` |
| `agents.visionOf` | 연기 감쇠 0.78 | **순수 함수로 둔다**(표현 계층도 부른다 — 4절 "장비를 읽는 네 가지 방법"). `kitLive(tic)` 이면 0.35. `s.light` 원 안의 바깥 칸이면 `base = Math.max(base, s.clearVision ?? 7.5)`. 고장을 드러내지 않는다 |
| `agents.detectRadius` | `kind === 'rescue'` | 순수 함수. `kitLive(searchKit)`(붕괴), `kitLive(tic)`(연기 0.3 초과 칸에서 은폐 ×0.7) |
| `agents.perceive` | — | 지상 대원(`!a.aloft`)이 연기 0.3 넘는 칸에 있으면 `tic` 의 숨은 고장을, 붕괴 현장의 첫 관찰이면 `searchKit` 의 숨은 고장을 `kitWorks` 로 드러낸다(한 번). 고장을 드러내는 것은 여기뿐이다 — `perceive` 는 시뮬레이션(`brain.think`)만 부른다 |
| `agents.perceive` 의 밸브 | 4.5칸·시야 | `gasMeter` 면 7칸·벽 무시 |
| `hazards.blast` | `dept === 'fire' ? 0.7 : 1` | `blastFactor` |
| `hazards.tickHostiles` 의 명중 피해 | `u.armor` | `armorOf(rid, engaging)` |
| `brain.dangerScore` | `dept === 'fire'` (불·연기 판단) | `turnout` |
| `executor.shootAt` | 거리 감쇠 하나 | 무기에 따라(4절 표) |
| `executor` `case 'treat'`·`case 'extricate'`·`case 'waterRescue'`·`workOnBlocker` | `u.medLevel`·`u.tool` | `medLevelOf`·**`toolUse`**(효과 자리이므로 숨은 고장을 여기서 드러낸다 — `toolFor` 를 쓰면 고장 난 유압 구조기가 끝내 효과를 내거나, 효과 없이 드러나지도 않는다), `aed`·`doctorKit` 보정(`kitWorks`) |
| `executor` 섬광탄 9곳, `commander` `hasBang` | `sim.units[b.unitId].flashbangs` | `kitUses(b.rid, 'flashbang') > 0`, 쓸 때 `useKit` |
| `executor` `case 'defuse'` | `r.skill` 만 | 처리 요원만(`eodKit`), 로봇 보정 |
| `executor` `case 'mitigate'`·`case 'hookup'`·`case 'traffic'`·협상 | 고정 시간 | `plugKit`·`pumpPanel`·`baton`·`megaphone` |
| `executor.spray` | 물 1.5/s, 마모 0.0042 | 기관원이 차 곁에 있으면 ×0.9 / ×0.6 |
| `executor.moveSpeed` 의 이송 속도(`a.carrying !== -1` 갈래) | 둘 0.78, 혼자 0.48 | 들것이면 0.88 / 0.55 |
| `executor` `case 'carry'` | 고정판 없음, 이송 보조는 누구나 따라간다 | 고정판 규칙(출혈 ×1.12). **이송 보조**(`c.where === 'carried'` 갈래): `scba` 가 없는 대원은 위험 건물(화재·가스·붕괴) 실내 칸으로 따라 들어가지 않는다 — 옮기는 사람이 그런 칸에 있으면 `finishTask(…, false, 'unsafe')` |
| `resources.tickUnits` 이송 중 처치 | `u.medLevel * 0.95` | 함께 탄 `fieldCrew` 가운데 `medLevelOf` 최댓값 × 0.95 |

- **테이저**(`executor` `case 'arrest'` 와 `case 'engage'` 의 다가가는 부분, `moveTo` 를 부르기 전): 상대가 총이 아니고 `fight`, 4칸 안, 시야, `kitUses(taser) > 0`, `sim.t - (a.taserAt ?? -99) >= 4` 이면 `kitWorks(taser)`(숨은 고장이면 여기서 드러나고 쏘지 못한다) → `useKit` 하고 `kitRng(s).chance(0.72)` → `h.stunUntil = sim.t + 3.2`, `a.taserAt = sim.t`, `pushFx(… 'shot' …, 노란색)`. 기록 `테이저 발사 — ${h.label} 무력화.` / `테이저 발사 — 빗나감.` 한 틱에 `moveTo` 를 두 번 부르지 않는다(쏜 틱은 `return`).
  - **대기 시간은 `a.cooldown` 이 아니라 새 칸 `a.taserAt`** 이다. `a.cooldown` 은 봉쇄·협상(`perimeter`·`negotiate`)과 `engage` 에서만 줄고(처음 값 1), `arrest` 에서는 줄지 않는다. 그래서 `cooldown` 을 쓰면 `arrest` 만 맡은 대원은 영영 쏘지 못하고, 쏜 뒤 4 에 멈춘 값 때문에 그림이 계속 테이저를 든다. 테이저는 총이 아닌 상대에게만 쓰고 사격(`shootAt`)은 총을 든 상대에게만 하므로 두 대기 시간이 섞일 일이 없다. `a.cooldown` 은 그대로 둔다(사격 결과가 바뀌지 않는다).
  - **효과 그림의 난수**: 빗나간 테이저의 `'shot'` 끝점 흔들림, 물 투하 `'drop'` 의 흔들림은 `kitRng(s)` 나 고정 오프셋을 쓴다. 지금의 분사·사격 효과처럼 `s.rng` 를 쓰면 안 된다 — `s.rng` 는 명중·용의자 행동에도 쓰는 흐름이라 그림 한 번에 모든 교전 결과가 바뀐다(`s.fx` 는 판단에 쓰이지 않지만 그 흔들림을 뽑는 난수는 흐름을 진행시킨다).
- **두 문 동시 진입**(`executor` `case 'engage'`, 지금 `if (n1 >= 2 && n2 < 2)` — 셋째부터 2조): 사람이 적은 문으로 보낸다 — `t.tile = n2 < n1 ? s.entryExit2 : s.entryExit`(둘째부터 번갈아). 방패수는 언제나 주 출입구(`s.entryExit`). 나뉘는 인원은 셋이면 2·1, 넷이면 2·2 로 지금과 같지만 **누가 어느 문으로 가는지가 바뀐다**(지금은 첫째·둘째가 1조, 바뀐 뒤에는 첫째·셋째가 1조). 한 용의자의 `engage` 작업은 `max 3` 이라 다섯 명 이상이 나뉘는 일은 용의자가 둘 이상일 때만 생긴다.
- **무장 사건의 인원 문턱**(`commander.syncBoard` 의 `police`): `dept === 'police' && hasFirearm && roleOf(rid).group !== 'bomb'` 인 활동 대원 — 폭발물 처리 요원·로봇 조작 요원은 장비(로봇 조작 요원의 권총)가 아니라 **역할로** 뺀다(2절). 문턱 숫자(≥2·≥3·≥4)는 그대로 두고 12절의 무장 결과를 보고 판단한다.
- **기관원과 예비 펌프·급수 연결**: `spray` 에서 물이 떨어지거나(`'water'`) 펌프가 고장 나면(`'pump'`) 그 부대의 활동 중인 `pumpPanel` 대원에게도 같은 `equipIssue` 를 준다. `brain` 의 **예비 펌프 교체 후보와 소화전 급수 연결 후보**(지금 `equipIssue === 'water'` 인 대원 — 물이 떨어진 관창수 본인 — 이 `fitFor`·역할 선호를 거치지 않고 0.83 으로 스스로 맡는다)는 같은 부대에 활동 중인 `pumpPanel` 대원이 있으면 그 사람만 낸다. 그러지 않으면 `hookup` 의 상당수를 관창수가 맡아 테스트 ⑤ 가 깨진다.

### 6.4 장비 공백의 지원 요청 (B3 의 "맡을 사람이 없는 작업" 블록을 고친다)

B3 가 이미 `commander.syncBoard` 에 같은 일을 하는 블록을 넣었다(`needFor` 로 작업 → 능력을 정하고, 20초 넘게 열린 작업을 현장의 누구도 `fitFor > 0` 으로 맡을 수 없고 그 능력의 부대도 오고 있지 않으면 요청, 한 번에 하나 `break`). **새 블록을 더하지 않고 이 블록의 두 조건을 함수 하나로 꺼내 고친다**:

```ts
/** 이 작업을 맡을 수 있는 사람이 현장에 있거나 오고 있는가 (장비·부서·알려진 장비 상태만 — 진실을 읽지 않는다) */
export function anyCapable(sim: Sim, s: Scene, I: Incident, w: WorkItem, need: keyof UnitCaps): boolean {
  // 현장 쪽: 지금 그대로 fitFor > 0. 장비 자격·공기 잔량(9절)이 fitFor 에 들어 있으므로 저절로 따른다
  if (s.agents.some((b) => b.status === 'active' && !sim.units[b.unitId].boardOrder && fitFor(sim, s, b, w) > 0)) return true;
  // 오는 쪽: 지금의 caps 기준에 "그 일을 할 장비를 가진 내리는 대원이 있다"를 더한다
  return I.assigned.some((uid) => { const u = sim.units[uid];
    return (u.state === 'enroute' || u.state === 'turnout') && u.caps[need] >= NEED_MIN[need] && fieldCrew(sim, u).some((rid) => capableOf(sim, rid, w.kind)); });
}
```

- `anyCapable` 은 `commander.ts` 에 두고 export 한다(테스트 ⑧ 이 부른다). 요청 문구·`break`·20초·`holdUntil` 은 B3 의 것 그대로.
- `capableOf(sim, rid, kind)`(`crews.ts`)는 장비·부서와 **알려진 장비 상태**만 본다: `suppress`·`overhaul` → `hose` 이고 공기가 된다(`scba` 가 없거나, `uses` 가 없거나 45 이상이거나, 그 부대의 `spareAir > 0`), `defuse` → `eodKit`, `engage`·`perimeter` → 총기, `arrest` → 총기·테이저. 표에 없는 일은 `true`(위험 건물 실내 일은 현장 쪽 `fitFor` 와 불변 조건 ③ 이 맡는다). 모두 `hasKit` 으로 본다(숨은 고장은 모른다). 공기 잔량과 예비 공기통은 자기 조직의 장비 상태라 정보 격리 안이다.
- 요청은 지금의 `request()` 를 그대로 쓴다(70초 안의 같은 요청은 막힌다). 관제는 부대 수로 보내고, 능력 불변 조건 덕에 그 부대는 장비를 가졌다.

- 지금의 "가스·붕괴 건물에 진입할 소방 부대가 없음" 요청 조건(`countUnits(rescue) + fireUnits === 0`)은 "`scba` 를 가진 대원이 있는 부대가 현장·오는 중에 없음"(`crewHasKit`)으로 바꾼다.
- 구급 부족 요청(`patients.length > 2 * emsUnits`)은 자리 수로: `patients.length > 오는·와 있는 ems 부대의 seatsOf 합`.

---

## 7. 헬기 세 종류

### 7.1 편성과 집

| | 경찰 헬기 `policeHeli` | 소방 헬기 `heli` | 의료 헬기 `medHeli` |
|---|---|---|---|
| 부서 · 분야 | police · 경찰 | fire · 특수 (그대로) | ems · 구조·구급 |
| 집 | 중부경찰서 옥상 | 소방항공대 (그대로) | 가온대학교병원 옥상 |
| 대원 | 기장·부기장·관측관 (모두 내리지 않는다) | 항공 구조대원 2 (내린다) + 기장·부기장 | 의사·간호사 (내린다) + 기장·부기장 |
| `caps` (supp, resc, ems, law, tac, search, traffic, eod) | 0, 0, 0, 0, 0, **1.6**, 0, 0 | 0, **.9**, **.4**, 0, 0, **.9**, 0, 0 (지금 0, .8, .7, 0, 0, 1.5, 0) | 0, .2, **1.2**, 0, 0, 0, 0, 0 |
| `seats` · `hoist` · `bucketMax` | 0 · ✕ · 0 | 1 · ○ · 1 | 1 · ✕ · 0 |
| 체공 `fuelMax` | 720초 | 660초 (바구니 작업 중에는 ×1.25 빨리 준다) | 780초 |
| `tool`·`med`·`armor` (부대 대표값) | .1 · .2 · 0 | .6 · .8 · .05 (그대로) | .1 · 1.1 · 0 |
| 현장에서 | 상공에 머문다: 공중 관측(열영상), 밤에는 탐조등 | 물·산불 현장은 상공(호이스트·물 투하), 그 밖은 내려앉아 대원이 일한다 | 내려앉아 의사·간호사가 전문 처치, 중환자 1명 이송 |
| 추격전 | 지금 규칙 그대로(어떤 `u.air` 든 430 안이면 추적) | 무장 사건에는 보내지 않는다 | 보내지 않는다 |

- 집의 착륙 자리: 지금 `f.x + 30, f.y − 20` 이 두 곳(`createRoster` 의 처음 위치, `offroadTarget` 의 복귀)에 있다. 이것을 `heliPad(sim, f)` 하나로 묶는다 — 항공대는 지금 값 그대로, 병원은 **`(f.x − 5, f.y − 3)`**, 경찰서는 `f.x + 30, f.y − 20`. (확인됨: `staticCity.facilityLot` 의 부지가 `f.x − 18, f.y − 52` 이고 병원 착륙장 원이 부지 `x + 13, y + 49` 에 그려지므로 `f.x − 5, f.y − 3` 이다.)
- **병원으로 가는 헬기**는 병원 교차로가 아니라 그 병원의 `heliPad` 에 내린다(`offroadTarget` 의 `transport` 경우). 소방 헬기도 같다.
- 시설·지도는 바꾸지 않는다. 경찰서 지붕의 착륙장 그림은 선택(`staticCity.ts`, 그림만).

### 7.2 관제: 언제 어느 헬기를 보내는가 (`dispatcher.pickUnit`)

지금의 `if (u.air && key !== 'search' && sev < 2.3 && !(key === 'ems' && sim.t - I.unmetSince > 60)) continue;`(B3 이후의 줄 — 구급차를 한참 기다리는 환자에게는 뜬다)를 바꾼다:

```ts
if (u.air) { const m = airFit(sim, u, I, key); if (m <= 0) continue; fit *= m; }
```

`airFit`(`dispatcher.ts` 안, 관제가 아는 것만 읽는다: 평가 `I.assessment`, `sim.weather`, `sim.disaster.phase`, 자기 조직의 부대 상태, `s.requests`):

| 헬기 | 수요 | 조건 | 곱 |
|---|---|---|---|
| 모두 | — | `u.grounded` 이거나, 연료가 `etaFor(목적지) × 2 + 90` 보다 적거나, `I.airDone` 에 그 종류가 있다(이 사건에서 "상공 임무 종료"로 이미 풀려났다 — 7.3) | 0 |
| 경찰 | `search` | 추격전: 평가 이름(`I.assessment.label`)이 `'납치'`·`'도주 차량'` | 1 |
| 경찰 | `search` | 유형이 `armed`·`search` (**단계 5 부터** — 상공의 일이 생기기 전에는 0) | 1 |
| 경찰 | `search` | 유형이 `water`·`collapse`·`fire` (관제 이름이 '산불'이면 0. **단계 5 부터**) | 0.5 |
| 경찰 | 그 밖 (`medical` 의 선착 대응 포함) | | 0 |
| 소방 | `search` | 유형이 `search`·`water`·`collapse`·`fire` | 1 (관제 이름이 '산불'이면 낮 1.2, 밤 0) |
| 소방 | `search` | 유형이 `armed`·`medical` | 0 |
| 소방 | `rescue` | 위험도 ≥ 2.3 이거나 유형이 `water` | 1 |
| 의료 | `ems` | 밤이 아니고, (위험도 ≥ 2.3 ‖ `sim.t − I.unmetSince > 60`(지금 줄의 구급 대기 예외) ‖ 그 사건에 채워지지 않은 긴급 구급 요청이 있다 ‖ 가용 지상 구급 부대 가운데 가장 빠른 것의 `etaFor` > 100초) | 1 |
| 그 밖 | | | 0 |

- 산불 시나리오(`fire/wild`)의 `search ≥ 1` 수요가 소방 헬기를 부른다(경찰 헬기는 0). 시나리오 표는 고치지 않는다.
- 추격전(납치·도주 차량)의 `search 1` 은 경찰 헬기가 맡는다(적합도 1.6). 부대 규모 1·2(경찰 헬기 없음)에서는 순찰차가 그 칸을 채운다 — 지금은 소방 헬기가 했다(17절 위험).
- 소방 헬기의 `ems` 0.4 는 `MINCAP`(0.7) 밑이라 구급으로 배정되지 않고, 지휘관의 구급 부대 수에도 들지 않는다. 지금 S7 처럼 "헬기가 구급차 대신"이던 일은 의료 헬기가 맡는다.
- `recomputeUnmet` 은 고치지 않는다(헬기의 `caps` 가 맡는 수요만 기준을 넘도록 좁게 잡았다).
- **단계 4 와 단계 5**: 단계 4 에서는 경찰 헬기를 추격전에만 보낸다(위 표의 첫 줄). 경찰 헬기는 `caps.search 1.6` 이라 배정되면 `recomputeUnmet`·`countUnits(search)` 를 채우는데, 상공의 일(관측)은 단계 5 에야 생긴다. 단계 4 에 무장·실종의 `search` 를 열면 그 칸을 걸어서 수색하던 소방 헬기 대원 둘 대신 아무 일도 하지 않는 헬기가 들어가 수색 인력이 한 팀 준 것처럼 돈다.
- 소방 헬기가 받던 "구급 60초 대기" 예외는 의료 헬기로 옮긴다(소방 헬기의 `ems` 는 0.4 로 `MINCAP` 밑이다).
- `pickUnit` 의 다른 손질: 다친 대원 감점 `crewReady < crew.length` → `crewReady < fieldCrew.length`(조종사 때문에 늘 감점되지 않게), 평균 체력은 `fieldCrew` 로. "같은 부서의 마지막 가용 부대" 감점(`others === 0 && sev < 1.9`)은 `others` 를 셀 때 `!q.air` 를 더하고 헬기 자신에게는 걸지 않는다 — 경찰·의료 헬기가 같은 부서의 "남은 부대"로 세어지면 지상 부대를 아껴 두는 판단이 흐려진다. 장비 가산 `kitBonus` — 수난 사고의 `rescue` 수요에 `rope`·`ring` 대원이 있는 부대 +12, 붕괴의 `rescue` 수요에 `searchKit` 대원이 있는 부대 +8(숨은 고장은 모른다 — `hasKit` 을 쓴다).
- `sendUnit` 에서 헬기면 `u.airNeed = key` 를 적는다(7.4 `airRtb` 가 그 수요를 되돌린다).
- 출동 횟수: `resources.dispatchUnit` 에서 `u.air` 면 `sim.airStats.sorties++`, `byKind[u.kind]++`.

### 7.3 현장: 내려앉는 헬기와 상공의 헬기

`isHovering(u, s)` = `u.kind === 'policeHeli'` ‖ (`u.kind === 'heli'` && (`s.kind === 'water'` ‖ `s.rules` 에 `'water'` ‖ (`s.kind === 'fire' && s.variant === 'wild'`))). 의료 헬기와 그 밖의 소방 헬기는 내려앉는다(지금처럼 대원이 내린다 — 대기 지점이 도로라 착륙할 곳이 있다고 본다).

**상공의 헬기 = 대원이 없는 현장 부대.** 그래서 공용 코드 네 곳을 손본다(단계 4).

1. **떠나보내기 — `sceneManager.tickScene` 5)번 블록과 8)번 블록을 함께 고친다.**
   - 5)번: 사건이 끝났을 때 지금은 대원이 있는 부대만 `boardOrder` 를 받는다. 그 줄 다음에 "이 사건에 `onscene` 이고 남은(`left` 가 아닌) 대원이 없는 부대도 `boardOrder = u.patients.length ? 'transport' : 'release'`" 를 더한다(대원 없는 부대가 영영 현장에 남지 않게 — 상공 헬기 말고도 막아 준다). 그 부대를 내보낼 때(아래 반복문의 철수·이송 갈래) `s.air` 에서 그 부대의 AirOp 도 지운다 — 사건이 닫힌 뒤에는 `SCENE_RULES` 가 돌지 않으므로(1)번 블록의 조건) `air.ts` 가 스스로 치우지 못한다.
   - 8)번: 보관 조건 `I.phase === 'closed' && s.agents.every(left)` 에 **`&& !sim.units.some((u) => u.state === 'onscene' && u.incidentId === I.id)`** 를 더한다. 7)번 블록이 한계 시간·방치로 사건을 닫은 그 틱에는 5)번이 이미 지나갔다. 지상 대원이 없으면 `every` 가 그냥 참이라 같은 틱에 보관되고, 다음 틱부터 맨 앞의 `if (s.archived) return` 때문에 5)번이 다시 돌지 않는다. `closeIncident` 는 `enroute`·`turnout` 부대만 풀어 주므로 상공 헬기가 닫힌 사건 위에 `onscene` 으로 남는다. 조건을 더하면 다음 틱의 5)번이 헬기를 내보낸 뒤 보관된다.
2. **7)번 블록**(한계 시간·방치): 기준 시각을 `onAt(s)` 로(6.1). `anyActive` 는 `groundActive`(지금의 `s.agents.some(active)`) ‖ "이 사건 상공에서 **대상이 있는 `hoist`·`bucket` 작업 중**인 부대가 있다"(`AirOp.mode` 가 `hoist`·`bucket` 이고 `idleSince < 0`). 감시(`watch`)만 하는 헬기는 넣지 않는다 — 넣으면 지상 대원이 모두 떠난 뒤의 "남은 임무 없음 → 종료"·"추가 부대 요청"·방치 종료가 모두 막혀 한계 시간까지 붙잡힌다. 7)번이 사건을 닫으면 위 1번이 다음 틱에 헬기를 내보낸다.
3. **`commander.countUnits`**: `on.indexOf(uid) >= 0` 에 `|| (need === 'search' && u.state === 'onscene' && isHovering(u, s))` 를 더한다. 상공 헬기는 **수색 인력으로만** 센다 — `u.air && onscene` 으로 넓게 세면 대원이 모두 쓰러진 채 내려앉은 의료 헬기가 구급 부대로 세어져 "구급 부대 없음" 요청이 나가지 않고, 상공의 소방 헬기(`rescue .9`)가 "고립된 구조 대상이 있으나 구조 장비가 없음"·"붕괴 건물에 진입할 구조 부대가 없음" 요청을 막는다(헬기는 잔해를 들추지도 건물에 들어가지도 못한다).
4. **`incidents.tickIncidents`** 의 무대응 종료(6.1).

`field/rules/air.ts`(세계 규칙, `scenes/index.ts` 에서 마지막에 import):

```ts
registerRule((sim, s, I) => {
  // 이 사건에 onscene 이고 isHovering 인 부대마다 s.air 에 AirOp 가 하나 있게 한다 (없으면 만든다: 대기 지점 위, eye = 관측자 FieldAgent)
  // 매 틱: 상공 연료(7.4 — 상공에서 줄이는 곳은 여기뿐) → 관측(0.5초마다) → airDecide 로 할 일 고르기 → 실행 → 끝난 AirOp 정리
  //       (이 사건에 onscene 이 아니게 된 부대의 AirOp 는 지운다)
});
```

- **관측자(eye)**: `sceneManager.unitArrived` 의 대원 생성 부분(`FieldAgent` 글자 그대로의 객체)을 `agents.ts` 의 `makeAgent(sim, rid, unitId, x, y, firstThink, rng)` 로 꺼내 export 하고, `unitArrived` 와 `air.ts` 가 함께 쓴다(`air.ts` 가 `sceneManager.ts` 를 import 하면 `sceneManager → scenes/index → rules/air → sceneManager` 순환이 생긴다. `air.ts` 가 쓰는 `resources.ts` 의 `startTransport`·`releaseUnit` 은 함수 안에서만 부른다 — 맨 위에서 쓰지 않는다). `aloft = true`, `rng = sim.rng.fork('air:' + I.id + ':' + u.id)`, `rid` = 경찰 헬기는 관측관, 소방 헬기는 0번 자리. **`s.agents` 에 넣지 않는다** — 용의자의 표적, 폭발·연기·불 피해, 지휘권 승계, 부대 철수 판정, 무전 수신에 끼지 않는다. 만들 때 지상 대원처럼 `briefFacts(sim, I)` 를 믿음에 넣는다(신고 내용의 위치 추정 등). 관측자의 믿음은 `perceive` 가 채우고 `flushOutbox` 로 현장 전체(-1)에 보낸다. 지휘관이 새로 생기면(`s.commanderRid` 가 바뀌면) 관측자의 믿음 전체를 한 번 `transmit(sim, s, eye, s.commanderRid, 'report', eye.beliefs.all(), `${callsign}: 상공 관측 내용을 전달합니다.`, -1, 0)` 한다(실제로 보내는 무전이라 기록 한 줄이 남는다 — 연출이 아니다).
  - 상공 헬기만 있는 현장에서는 관제의 추가 신고 전달(`dispatcher.ts` 의 `!s.agents.length` 이면 버림)이 지금처럼 버려진다. 관측자에게 넘기지 않는다(받을 지휘관이 없다 — 지상 부대가 닿으면 그 지휘관이 이후의 전달을 받는다).
- **공중 관측**(`agents.perceive`, `a.aloft` 일 때만 갈래): 시야 `v` = 낮 9 · 비 7 · 밤 4(탐조등이 작동하면 8). 실내 칸(`isIndoor`)의 대상은 보지 않는다(지붕). 바깥 칸은 시야선(`los`)을 보지 않는다. `flir` 가 작동하면(`kitWorks` — 상공 관측은 시뮬레이션만 부른다) 은폐 ×0.35, 연기 감쇠 없음. 소품 반복문은 건너뛴다. 불 칸 스캔은 바깥 칸만.
  - **용의자 인지 거리**: 지상은 시야와 상관없이 13칸(숨은 용의자 4.2칸)으로 고정이다. 관측자는 `v`(숨은 용의자는 `v × 0.4`)로 한다 — 밤의 시야 4 가 용의자에게도 걸린다.
  - **관측자는 사람을 움직이지 않는다**: `discover()` 의 "거동 가능한 대상에게 대피를 안내한다"(`c.walking = true`)와 `perceive` 의 "인질이 스스로 걷기 시작한다"(`c.walking = true`) 두 줄 모두 `a.aloft` 면 일어나지 않게 막는다(경찰 헬기에는 확성기가 없고, 하늘에서의 안내는 R1 범위 밖이다).
  - `flushOutbox`·`transmit` 은 `a.aloft` 면 무전 음영 검사를 건너뛴다. (확인됨: `perceive`·`discover`·`learn`·`flushOutbox`·`transmit` 은 `s.agents` 에 들어 있지 않은 개체로 불러도 동작한다.)
- **탐조등**: 밤이고 경찰 헬기의 관측관 `searchlight` 가 작동하면(처음 켤 때 `kitWorks`) `s.light = { x: eye.x, y: eye.y, r: 4.5 }`, 아니면 `null`. `visionOf` 가 이 원 안의 바깥 칸에서 기본 시야를 `max(지금 값, s.clearVision ?? 7.5)` 로 올린다(모든 지상 대원). `s.clearVision` 은 `kit.baseScene` 이 7.5 로, 실종 현장 생성(`builders.ts` 의 `s.outdoorVision = …3.8…` 줄)이 3.8 로 채운다. 고정 숫자 3.8 을 쓰면 밤의 보통 현장(바깥 시야 4.6)에서 오히려 시야가 준다.
- **판단**(`field/airDecide.ts`, 믿음만): `airDecide(sim, v: AirView)` 처럼 **좁힌 입력만** 받는다 — `AirView = { op: AirOp; eye: FieldAgent; board: WorkItem[]; cmd: FieldAgent | null(활동 중인 지휘관); terrain: { w, h, tiles, region, regions }; night: boolean; others: AirOp[]; incoming: boolean(이 사건에 오는 다른 부대가 있다 — I.assigned 의 enroute·turnout) }`. `air.ts` 가 만들어 넘긴다. 소스에 `s.props`·`s.casualties`·`s.hostiles`·`.truth`·`s.fire[`·`s.smoke[`·`s.heat[`·`s.wet[`·`s.fuel[`·`s.burning`·`.fault`·`sim.scenes` 가 없어야 한다(테스트 ⑬).
  - **작업판을 무전 없이 읽는 것은 의도한 예외다.** 작업판은 지휘관의 지시 목록이라 조직이 아는 정보이고, 지상 대원도 `brain` 에서 작업판을 직접 읽는다(지시 무전은 배정을 늦출 뿐이다). 상공 헬기는 지상과 따로인 항공 무전으로 지시를 받는다고 보고 지연·음영 없이 읽는다.
  - `watch`: 무장 현장이면 믿음 속 용의자(달아나는 것 먼저) 위를 반지름 4로 돈다. 그 밖에는 바깥 칸을 줄지어 훑는다(3칸 간격, 초당 2.5칸, 난수 없음). 수난 현장은 믿음 속 요구조자 자리에서 하류(+x) 쪽. **감시에 할 일이 있는지**는 믿음으로 정한다: 활동 중인 지휘관이 있으면 그 믿음의 `commander.outstanding()` 이 `hostile`·`search` 를 하나라도 남겼을 때, 지휘관이 없으면 이 사건에 오는 다른 부대가 있을 때(`incoming` — 지상 부대보다 먼저 닿은 헬기는 그들이 올 때까지 하늘에서 찾는다)만 할 일이 있다. 그 밖에는 할 일 없음(`idleSince` 를 잰다) — "바깥 칸을 훑기"는 언제나 할 수 있으므로 이 기준이 없으면 감시 헬기는 영영 한가해지지 않는다.
  - `hoist`: 작업판의 열린 `hoist` 작업(우선순위 순, 다른 AirOp 가 잡지 않은 것)을 고른다. 지휘관이 없으면 관측자 믿음 속 물 칸(`T.WATER` — 지형은 읽어도 된다)의 요구조자를 스스로 고른다.
  - `bucket`: 작업판의 열린 `airDrop` 작업, 없으면 관측자 믿음 속 불이 가장 센 바깥 구역.
  - 고를 것이 없으면 `idleSince` 를 잰다.
- **호이스트 실행**(`air.ts`, 실행기와 같은 자격으로 진실을 읽는다): 대상 위로 초당 3칸 이동 → 0.8칸 안이면 `need = 18 / (0.6 + 0.4 × 내리는 구조대원 skill) × (밤 1.4)(비 1.2)(태풍 충격 1.5)` 동안 진행 → 끝나면 지상 `waterRescue` 의 세계 효과와 같게 `c.inWater = false; c.drift = 0; c.mob = 'immobile'; c.trapWork = 0; c.tFreed = sim.t; c.bleed *= 0.35; c.bleed0 = c.bleed`(물 밖으로 나오면 악화가 느려진다), 자리가 남았으면 `c.where = 'loaded'; c.tLoaded = sim.t; u.patients.push(c.id); u.patientsIncident = I.id`, 아니면 `s.safe` 에 내려놓는다(`'safe'`, `placeAtSafe`). `learnQuiet` 로 관측자 믿음 갱신, 기록 `${callsign}: 호이스트로 구조 대상 ${c.label} 인양 완료.`, `airStats.hoists++`. 대상이 이미 물 밖이거나 죽었으면 `learn(…, true, true)` 로 강제 보고하고 그 작업을 끝낸다(낡은 믿음의 무한 반복 방지). 작업이 `cancelled` 면 그만둔다.
  - 자리가 다 찼으면 바로 이송: `I.assigned` 에서 빼고 `incidentId = null`, `startTransport`(병원을 돌려받는다 — 15절), 기록 `${callsign} 환자 ${n}명 싣고 ${병원 이름}으로 출발.`, AirOp 를 지운다. `airStats.airLifts` 는 `startTransport` 가 센다(11절 — 여기서 따로 세지 않는다).
- **물 투하 실행**: `bucket > 0` 이면 대상 구역 위로 가서 6칸 띠(폭 2)에 `hazards.applyWater(s, x, y, 0.9)` 를 칸마다, `bucket--`, `pushFx(… 'drop' …)`(흔들림은 `s.rng` 가 아니라 고정값 — 6.3), 기록 `${callsign}: ${구역 이름}에 물 투하.`, `airStats.drops++`. `bucket === 0` 이면 `away`: 가장 가까운 물(호수 가운데, 강 중심선의 가장 가까운 점, 해안 `coastY(x) + 10` 가운데 가까운 것 — `city.ts` 의 함수로)까지 왕복 `2 × 거리 / 66 + 12`초 뒤 `bucket = bucketMax`. **`away` 동안 지도 위치(`u.x`,`u.y`)는 옮기지 않는다** — 항공 부대의 `etaFor` 는 `u.x/u.y` 로 거리를 재고, 그 값이 연료 복귀 판정(7.4)과 복귀 비행의 출발점이 되므로 옮기면 결과가 갈린다. 물 뜨러 간 모습은 화면이 `AirOp.phase === 'away'` 일 때 현장에 헬기를 그리지 않는 것으로 충분하다(지도에서는 현장 위에 그대로 있다). 밤에는 투하하지 않는다.
- **지휘관 쪽**(`commander.syncBoard`, 믿음과 자기 부대 상태만):
  - 구조 대상이 물 칸에 있다고 믿고(지금 `waterRescue` 를 내는 조건) 이 사건 상공에 `hoist` 를 가진 부대가 있으면 `want('hoist', { cas }, 0.92 + urg, 1)` 도 낸다(지상의 `waterRescue` 와 함께 — 먼저 끝나는 쪽이 이긴다). 물 밖으로 나왔다고 믿으면 `cancel(hoist)`. 죽음·탑승·병원으로 지우는 목록(`clear([...])`)에 `'hoist'` 를 더한다.
  - 바깥 구역(`!s.regions[id].indoor`)에 불이 있다고 믿고 상공에 `bucketMax > 0` 인 부대가 있으면 `want('airDrop', { region }, 0.7 + 0.2 × 세기, 1)`. 불이 0.05 아래로 믿기면 그 작업을 끝낸다.
  - `hoist`·`airDrop` 은 `fitFor` 가 0 이라 지상 대원에게 배정되지 않는다. 작업판의 배정 정리에서 담당자가 없으면 `open` 으로 돌아가는데, `air.ts` 는 자기 `workId` 로 추적하므로 상관없다. (확인됨: `assign()` 은 담당자 없는 작업을 예외 없이 `open` 으로 되돌리고, `fitFor` 가 0 인 작업은 배정 후보에서 건너뛴다.)
  - **상공에 그 일을 할 부대가 없어지면** — 연료·강풍 복귀, 자리가 차서 이송, 할 일 없음 복귀로 이 사건 상공에 `hoist` 를 가진 부대(또는 `bucketMax > 0` 인 부대)가 하나도 남지 않으면 — 열린 `hoist`(또는 `airDrop`) 작업을 `cancel` 한다. `canClose` 는 열린 작업이 하나라도 있으면 거짓이라, 남겨 두면 지휘관이 종료를 선언하지 못한다. 헬기가 다시 오면 위 규칙이 다시 낸다.
  - 이 두 작업의 `want`·`cancel` 은 B3 의 "맡을 사람이 없는 작업" 요청(6.4)에서 빠진다(`needFor` 가 `null` 을 돌려준다 — 공중 임무는 관제가 `airFit` 으로 보낸다).
- **상공에서 떠날 때**: (1) 사건이 끝나면 5)번 블록의 새 줄이 보낸다(위 1번). (2) 할 일이 없는 채(`idleSince` — 감시는 위 "감시에 할 일이 있는지"로) 45초, 경찰 헬기는 30초가 지나면 `releaseUnit`, 기록 `${callsign}: 상공 임무 종료, 복귀합니다.`, `(I.airDone ??= []).push(u.kind)`(관제가 이 사건에 같은 종류를 다시 보내지 않는다 — 그러지 않으면 `fieldVerified` 전의 `recomputeUnmet` 이 `search` 칸을 다시 비어 있는 것으로 보고 방금 돌아간 헬기를 또 보낼 수 있다. 헬기가 "임무 종료"를 알린 것은 조직이 아는 사실이다). (3) 연료·강풍(7.4 `airRtb` — 이때는 `airDone` 에 넣지 않는다: 다른 헬기가 그 칸을 메워야 한다).
- 산불의 전체 규칙(`disaster.ts` `tickWildfire`)의 "헬기가 떠 있으면 ×0.7" 은 `u.air` → `(u.bucketMax ?? 0) > 0` 으로 좁힌다(경찰 헬기는 불머리를 늦추지 못한다). 현장 격자의 불은 위의 물 투하가 실제로 끈다.
- **의료 헬기**(내려앉는다): 지휘관의 탑승 배정(`commander.syncBoard` 의 `load` 고르기)에서 위중(`band === 2`) 환자는 **자리가 남은 헬기를 먼저**, 그 밖의 환자는 지상 구급차를 먼저 고른다(헬기 자리를 위중 환자에게 남긴다). 이송 출발(`manageAmbulances`)은 `u.patients.length >= seatsOf(u)` 이면 바로.

### 7.4 날씨 · 바람 · 연료

| | 경찰 헬기 | 소방 헬기 | 의료 헬기 |
|---|---|---|---|
| 맑음 | ○ | ○ | ○ |
| 비 | 속도 ×0.88(지금 `weatherSpeedFactor`), 관측 거리 7 | 호이스트 ×1.2 | ○ |
| 안개 | 뜨지 않는다 (`grounded = 'fog'`, 교대 내내) | 같음 | 같음 |
| 밤 | 탐조등 (관측 거리 8, 지상 시야 보강) | 물 투하 안 함, 호이스트 ×1.4 | 뜨지 않는다 (`'night'`, 주간 운항) |
| 태풍 충격 단계 (`sim.disaster.kind === 'typhoon' && phase === 'impact'`) | 뜨지 않는다 (`'storm'`). 떠 있던 헬기는 복귀 | 같음 | 같음 |

- `grounded` 는 `createRoster`(날씨)와 `resources.tickUnits`(태풍 단계가 바뀔 때)에서 정한다. 태풍 충격 단계가 끝나면(`phase` 가 `impact` 에서 바뀌면) `'storm'` 이던 `grounded` 를 `null` 로 되돌린다(안개·밤은 교대 내내). 뜨지 못하게 된 헬기가 출동 중(`enroute`)이거나 상공에 있으면 `airRtb(sim, u, 'storm')`. 환자를 태우고 병원으로 가는 중(`transport`)이면 병원까지 간다.
- **연료** — 줄이는 곳을 둘로 가른다(두 번 줄지 않게):
  - **이동 중**(`enroute`·`transport`·`returning`): `resources.tickUnits` 에서 `u.air` 면 `u.fuel = Math.max(0, u.fuel - dt)`. 넣는 자리는 `if (u.state === 'available' || u.state === 'oos' || u.state === 'onscene') continue;` 줄 **앞**(그 뒤에 넣으면 상태 갈래마다 따로 넣어야 한다).
  - **상공**(`onscene` 이고 `isHovering`): `field/rules/air.ts` 에서만, `u.fuel = Math.max(0, u.fuel - dt × (바구니 작업 중 1.25 : 1))`("바구니 작업 중" = 그 AirOp 의 `mode === 'bucket'` 이고 `idleSince < 0` — AirOp 를 아는 `air.ts` 만 판단할 수 있다). `tickUnits` 는 `onscene` 부대를 건너뛰므로 거기서는 줄지 않는다.
  - 내려앉아 대원이 일하는 동안은 줄지 않는다.
- **`airRtb(sim, u, reason: 'fuel' | 'storm')`**(`resources.ts` 에 둔다 — `crews.ts` 는 `resources.ts` 를 import 할 수 없다):
  - **거는 때**: `u.state === 'enroute'`, 또는 `onscene` 이고 그 사건 현장에서 `isHovering` 일 때만, **한 번만**(부른 뒤에는 `returning` 이 되어 다시 걸리지 않는다). 연료는 `fuel < etaFor(집) + 40` 일 때. `transport` 는 병원까지 가게 두고, `returning` 은 검사하지 않는다 — `releaseUnit` 은 환자를 보지 않으므로 이송 중에 부르면 환자를 실은 채 `returning` 이 되어 병원 인계가 영영 일어나지 않고, 다음 사건에 환자를 태운 채 나가 예외가 난다(CLAUDE.md 함정). `returning` 에 걸면 매 틱 기록이 남고 `rtb` 가 매 틱 오른다.
  - 하는 일: 상공에서 환자를 태웠으면(`u.patients.length > 0`) `releaseUnit` 대신 `startTransport`. 아니면 `releaseUnit`. 기록 `${callsign}: 연료가 부족해 복귀합니다.` / `${callsign}: 강풍으로 복귀합니다.`. `airStats.rtb++`(연료일 때만).
  - **그 수요를 되돌린다**: 출동 때 적어 둔 `u.airNeed`(7.2)로, 관제의 전환 배정과 같은 방식 — `if (!I.fieldVerified) recomputeUnmet(sim, I); else { I.unmet[key] = (I.unmet[key] ?? 0) + 1; } I.unmetSince = sim.t; I.noUnitLogged = false;`(`recomputeUnmet` 은 `dispatch/dispatcher.ts` 에서 import 하고 함수 안에서만 부른다 — 모듈 맨 위에서 쓰지 않는다).
  - 내려앉아 대원이 내려 있는 헬기는 이 검사를 받지 않는다.
- 복귀해 집에 닿으면(`arrive` 의 `returning`) `fuel = fuelMax`, `bucket = bucketMax`.
- 관제는 `airFit` 에서 연료가 모자란 헬기를 보내지 않는다(7.2).
- 대기 중이던 헬기의 첫 출동에 도로 경로가 들어가는 문제(`tickUnits` 의 `turnout` 끝 `setRoute`): `u.air || u.sea` 면 `sendUnitTo` 를 쓴다. 이 한 가지만 따로 고쳤을 때 **기록 해시가 같아야 한다**(헬기·구조정의 `u.route` 는 움직임·`etaFor`·교통·추격전 어디에서도 읽히지 않는다 — 지도에 도로 점선이 잘못 그려지던 것만 사라진다). 해시가 다르면 경로를 읽는 곳이 더 있는 것이니 찾아서 보고에 적는다. 다른 단계와 섞지 말고 먼저 확인한다. 해시는 아래 "해시를 재는 법"으로 잰다.

**해시를 재는 법** (`sweep --json` 은 집계 요약만 내고 교대별 해시를 내지 않는다. 요약에는 매번 달라지는 `msPerShift` 도 들어 있다):

```bash
npx tsx -e "import {Sim} from './src/sim/engine'; for (let k = 1; k <= 20; k++) { const s = new Sim('S' + k); s.runToEnd(); console.log('S' + k, s.report!.hash); }" > /scratch/hash-before.txt
# 고친 뒤 같은 명령으로 /scratch/hash-after.txt 를 만들고
diff /scratch/hash-before.txt /scratch/hash-after.txt      # 출력이 없어야 한다
```

강제 발생·재난을 섞어 보려면 `new Sim('S' + k, NORMAL, 1200, { force: 'water/std' })`(`NORMAL` 은 `./src/sim/difficulty` 에서). 분포를 비교할 때는 `--json` 결과에서 `msPerShift` 를 빼고 비교한다.

### 7.5 지금의 헬기를 깨지 않고 나누는 순서

1. (단계 1) 소방 헬기에 조종사 두 자리를 붙인다 — 내리지 않으므로 현장에는 지금처럼 둘이 내린다. `crewReady`·`fieldCrew` 가 조종사를 빼고 센다.
2. (단계 3) 환자 자리를 `seatsOf` 하나로 묶는다 — 헬기에 둘이 타던 잘못이 없어진다.
3. (단계 4) 두 헬기를 끝에 붙이고, `airFit` 으로 맡는 수요를 가른 뒤 소방 헬기의 `caps` 를 바꾼다. 경찰 헬기는 이때부터 상공에 머물지만(대원이 없는 부대 처리 네 곳이 이 단계에 들어간다) 할 일은 추격전 추적뿐이므로 `airFit` 은 경찰 헬기를 추격전에만 보낸다(7.2). 이 단계의 상공 헬기는 `s.air` 가 아직 없으므로 7)번 블록의 `anyActive` 에 들지 않고, 사건이 끝나면 5)번 블록이 내보낸다.
4. (단계 5) 상공의 일(관측·탐조등·호이스트·물 투하)을 넣고, `airFit` 의 경찰 헬기 무장·실종(과 0.5 유형) 줄을 연다. 이때부터 소방 헬기는 물·산불 현장에서 상공에 머문다.

### 7.6 지금 규칙과의 관계

- `pursuit.ts`: 한 곳만 고친다(`ground`·시야·은신처 감시는 `u.air` 로 보므로 그대로 따라간다). 추적 판정 반복문(`p.tracked = false; for (const uid of I.assigned) …`)에서 **지상 부대 없이 항공 부대 때문에** 처음 추적을 시작했으면(`p.seenAt < 0` 이고 175 안의 지상 부대가 없다) `sim.airStats.tracked++` 하고, 처음 발견 기록의 행위자를 `'헬기'` 글자 대신 그 헬기의 호출부호로 한다. 통계는 상태(`p.tracked`·`p.seenAt`)를 바꾸는 바로 그 코드에서 센다(규칙 5). 추격 중의 헬기는 `enroute` 상태다(`onscene` 상공이 아니다).
- `resources` 의 길 밖 이동·`etaFor`·`arrive`·`offroadTarget`: `u.air` 로 판단하므로 새 종류도 따라간다. `kind === 'heli'` 로 보는 곳(`canCarryPatients`, `manageAmbulances`, `tokens.ts` 의 날개, `sprites.ts` 의 그림)은 모두 고친다. 끝낼 때 `grep -rn "'heli'" src` 로 남은 곳을 보고, 소방 헬기만의 뜻으로 남긴 곳은 주석을 단다.

---

## 8. 관제와 지휘의 바뀜 — 정리

- **관제가 볼 수 있는 것**: 부대의 편성·역할·장비·알려진 고장·남은 섬광탄·연료·`grounded`·대원 상태, 헬기가 알린 "상공 임무 종료"(`I.airDone`). 볼 수 없는 것: 숨은 고장(`fault && !faultKnown`), 현장의 진실. `dispatch/*`·`commander.ts`·`brain.ts`·`field/orders/*`·`field/airDecide.ts` 에서 `.fault` 를 직접 읽지 않고 `hasKit`·`toolFor`·`capableOf` 를 쓴다(테스트 ⑬ 이 소스를 본다).
- **`analyst.ts`**: 바꾸지 않는다.
- **`dispatcher.ts`**: `pickUnit` 의 헬기 줄(`airFit`), 감점·평균 체력(`fieldCrew`), "같은 부서의 마지막 가용 부대" 감점에서 헬기 빼기, `kitBonus`, `sendUnit` 의 `u.airNeed`. `ORDER`·`MINCAP`·`NEED_LABEL`·`recomputeUnmet` 은 그대로.
- **`commander.ts`**: `police`(총기를 가진 경찰, 역할 묶음 `bomb` 제외), `hasBang`(사람의 섬광탄), 탑승 배정·출발(`seatsOf`, 위중 환자는 헬기 먼저), 구급 부족 요청(자리 수), 가스·붕괴 진입 요청(`scba`), B3 의 "맡을 사람이 없는 작업" 블록(6.4 — `anyCapable` 로 꺼내 export), `countUnits`(상공 헬기는 수색으로만), `hoist`·`airDrop` 작업과 그 취소, `manageAmbulances` 의 대상(`seatsOf(u) > 0`)과 출발 조건, `capOnScene`(쓰이지 않는 함수 — 손대지 않는다).
- **`manageAmbulances` 의 진실 읽기**(`s.casualties[cid].health < 40`)는 이번에 늘리지 않는다. 바꿀 수 있으면 믿음(`CasBelief.band === 2`)으로 바꾼다(선택, 결과가 바뀐다 — 단계 3 에서만).

---

## 9. 소모와 고장 (단계 6)

- **공기호흡기**: `uses` = 공기(초). `tn.airFull` = `[220, 250, 280, 300, 320][equipment]`(`difficulty.ts` 에 추가). `agentHealth` 에서 연기 0.25 넘는 칸에 있는 `scba` 대원은 `uses -= dt × (1.25 − 0.5 × fitness)`. 0 이면 공기호흡기의 연기 방호가 없다(그 밖의 사람과 같은 피해). 
  - 60초 아래로 처음 떨어질 때 `agentHealth` 는 **사실만** 기록한다: `${r.name}: 공기 잔량 60초 미만.`(imp 1, 한 번). 교체하러 갈지는 `brain` 이 다른 후보와 견주어 정하므로, 여기서 "교체하러 나갑니다"라고 쓰면 하지 않은 행동을 기록하게 된다(규칙 5).
  - `brain`: `uses < 60` 이고 자기 부대 `spareAir > 0` 이면 후보 `공기통 교체`(0.9, 연기 칸에 있으면 0.95). 교체 중에는 0.93 으로 붙잡는다. 이 후보를 **실제로 고를 때**(`apply`) 기록 `공기통을 교체하러 대기 지점으로 갑니다.`(imp 1) — 지금의 예비 펌프 교체 후보와 같은 꼴이다.
  - `executor` `case 'swapAir'`: 대기 지점으로 가서 8초 → `uses = tn.airFull`, `u.spareAir--`(imp 0 기록 한 줄). 예비가 없으면 교체하지 않는다.
  - `fitFor`: `uses < 45` 인 대원에게 위험 건물 실내 일(수색·구출·이송)과 진압은 0. 공기가 없어 일을 못 하면 현장 쪽은 `fitFor` 가 0 이 되므로 6.4 의 블록(B3 의 "맡을 사람이 없는 작업", 현장 쪽은 `fitFor > 0` 으로 본다)이 그 일을 할 부대를 부른다. 오는 부대 쪽은 `capableOf` 가 알려진 공기 상태(`uses ≥ 45` 이거나 `spareAir > 0`)를 본다 — 공기가 바닥난 채 다른 사건에서 넘어오는 펌프차를 "할 수 있는 부대"로 세지 않는다.
  - 부대가 집에 닿으면(`arrive` `returning`) `spareAir` 를 가득, 대원의 공기를 가득.
- **섬광탄·테이저**: 수량이 사람 몫이다. 다시 채우지 않는다(지금 섬광탄과 같다).
- **고장**: `tn.kitFault` = `[0.12, 0.07, 0.03, 0.015, 0.005][equipment]`. 고장 추첨을 받는 장비: `tic`·`spreader`·`searchKit`·`aed`·`taser`·`robot`·`searchlight`. 고장 난 장비는 효과가 없고(`kitLive`), 처음 효과를 주려 할 때 드러난다(`kitWorks`·`toolUse` — 드러나는 자리는 4절의 목록 하나뿐이다). 드러난 뒤에는 `hasKit` 이 false 라 배정·관제가 그 장비가 없는 것으로 본다(예: 유압 구조기가 고장 난 구조대원은 구출 적합도가 맨손 값). 보통 난이도에서 교대당 1건 안팎.
- `KNOBS` 의 장비 설명문 끝에 `'개인 장비의 고장, 공기통 용량'` 을 더한다.
- 새 문제 코드는 만들지 않는다(`EQUIP_FAIL` 의 detail 로 가린다).

---

## 10. 화면 (단계 7 — 시뮬레이션 결과가 한 건도 바뀌면 안 된다)

**현장의 대원** (`view/scene/sprites.ts`, `view/renderScene.ts`)
- `responderLook(dept, kind, seed, role?)`: 역할로 갈린다. 진압 팀장·사다리 팀장·구조 팀장은 흰 헬멧, 대원은 지금 색, 기관원·사다리 조작원은 주황 조끼(`trim: 'vest'`). 의사는 흰 상의 + 빨간 십자, 간호사는 남색 비행복 + 십자 + 가방, 구급 운전원은 가방 없음. 방패수·저격수는 전술 복장 그대로(손에 든 것으로 가린다). 폭발물 처리 요원은 부피 큰 방호복(`PersonLook.bulk?: number` 를 더해 몸통을 1.25배)과 얼굴 가리개(`HeadKind` 에 `'visor'`). 수난 구조대원은 구명조끼(주황 + 노란 띠).
- 캐시 키: `'a' + rid + ':' + u.kind + ':' + role` (`renderScene.ts` 의 `lookOf`).
- `agentPose(a, u, moving)` 는 **장비에서**(`hasKit` — 읽기만, `kitWorks` 를 부르지 않는다) 손에 든 것을 고른다: 총은 `sniper` > `rifle` > `pistol`(지금은 `kind === 'tactical'` 만 소총). 방패수는 교전·봉쇄·이동 때 앞에 방패(`Item` 에 `'shield'`). 테이저를 쏜 직후(`sim.t - (a.taserAt ?? -99) < 1`) `'taser'`. 연기 속 수색·이동 중 `tic` 대원은 열화상 카메라(`'tic'`). 문 개방은 `irons` 면 할리건(`'halligan'`), `breachKit` 이면 램(`'ram'`), 아니면 도끼. 구출은 `spreader` 일 때만 유압 구조기, 아니면 할리건·맨손. 처치(무릎 자세)는 `alsBag`·`doctorKit` 면 큰 빨간 가방, `aed` 로 위중 환자를 볼 때 주황 상자, 그 밖에는 지금의 구급 상자.
- 옮기는 중: 옮기는 사람이나 곁의 사람이 `stretcher` 를 가졌을 때만 들것(`drawLying` 의 `stretcher`), 아니면 끌기 자세만.
- 공기 잔량 60초 아래인 `scba` 대원의 머리 위에 작은 주황 점(깜박임 없이).

**상공의 헬기와 현장의 차량 줄**
- `renderScene.ts` 의 현장 차량 줄(도로 연석 쪽 한 줄)에서 상공에 머무는 부대는 뺀다. 내려앉은 헬기는 지금처럼 줄에 선다.
- `s.air` 의 AirOp 마다 `(x, y)` 에 헬기를 그림자와 함께 그린다(그림자는 오른쪽 아래로 1.2칸). 그리는 것은 **그 부대가 `u.state === 'onscene' && u.incidentId === s.incidentId` 인 AirOp 만**(사건이 닫힌 뒤 남은 것이 있어도 그리지 않는다). `hoist` 의 `work` 단계에는 헬기에서 대상까지 줄과 매달린 구조대원, `bucket` 이면 헬기 밑에 흔들리는 바구니, 투하 순간에는 `Fx 'drop'`(떨어지는 물 띠와 물보라). `away` 단계는 현장에 그리지 않는다(지도의 헬기 표식은 `u.x/u.y` 그대로 현장 위에 있다 — 7.3).
- 밤의 탐조등: `s.light` 원을 `fx.ts` 의 어둠 층에 빛으로 뚫고, 헬기에서 원까지 옅은 원뿔.
- `drawHeli(g, …, kind)`: 경찰 = 남색·흰색에 하늘색 띠, 소방 = 지금의 빨강·흰색, 의료 = 흰색에 초록 띠와 빨간 십자. `drawEmergency` 의 `kind === 'heli'` → 세 종류. `VEH_SIZE` 에 `policeHeli [2.8, 0.95]`, `medHeli [3.0, 1.0]`.

**지도의 표식** (`view/marks.ts`, `view/city/tokens.ts`, `ui/MapLegend.tsx`)
- `UNIT_MARK.policeHeli`·`UNIT_MARK.medHeli` 는 소방 헬기와 **같은 윤곽**(위에서 본 헬기)을 쓴다. 분야색(경찰 파랑 · 구조·구급 초록 · 특수 보라)이 다르고, 각 분야 안에서는 윤곽이 다르다(방패·갈매기표 / 엇갈린 연장·심전도 십자·십자) — `marks.ts` 머리말의 규칙을 지킨다. 견본표(10·12·16·24 화소)로 12 화소에서 헷갈리지 않는지 본다. 글자 표식은 쓰지 않는다.
- `AIR_KIND` 는 `sim/crews.ts` 에 있다(4절 — 시뮬레이션의 `createRoster` 가 쓰므로 `src/view` 에 두면 규칙 3 을 어긴다). `marks.ts` 는 필요하면 그것을 import 한다. `tokens.ts` 의 날개·띄운 그림자 판정 두 곳(`flying` 과 날개 그리기의 `o.kind === 'heli'`) → `AIR_KIND.has(o.kind)`(`TokenOpts` 에는 부대의 `air` 칸이 없다 — 종류로 본다). 범례(`MapLegend`)도 `TokenOpts` 로 그리므로 같은 판정을 따른다.
- 범례 `FIELDS`: `police` 에 `policeHeli`, `rescue` 에 `medHeli`. `UNIT_KIND_NAME`: `heli: '소방 헬기'`, `policeHeli: '경찰 헬기'`, `medHeli: '의료 헬기'`.
- 범례에 "대원 역할" 칸: 아래의 역할 기호 16개와 이름.

**부대 목록** (`ui/panels.tsx` `UnitRow`, `styles.css` 끝의 `/* ── crews ── */`)
- 한 줄 26px 은 그대로. 대원 칸: 부대장 이름 칩 하나 + 대원마다 지름 13px 의 **역할 점**(분야색을 어둡게 한 바탕 위에 흰 역할 기호, 아래쪽 테두리가 건강 색 — 초록·노랑·빨강, 쓰러지면 빨간 테). 내리지 않는 자리(조종사·정장·관측관)는 속이 빈 점선 테. 점을 누르면 그 대원을 고른다. 제목(`title`)은 `이름 · 역할 · 장비 목록 · 체력 · 지구력`.
  - **좁은 폭**: 점 다섯 개(13px × 5 + 간격)와 칩이 들어가지 않으면 먼저 이름 칩을 숨기고(점만 남긴다 — 부대장은 0번 점), 그래도 넘치면 점 지름을 10px 로 줄인다. 줄을 바꾸지 않는다(26px 유지). 숫자·글자로 "+n" 을 쓰지 않는다(글자 표식 금지).
- 역할 기호 `ROLE_MARK: Record<RoleGroup, string>`(`marks.ts`, 24×24 경로). 있는 것을 다시 쓴다: `lead` 별(순찰차 기호 안의 별), `officer` 방패, `marksman` 조준선(특공대 기호), `bomb` 폭탄(폭발물 처리반 기호), `medic` 십자, `hazmat` 마름모, `pilot` 펼친 날개, `observer` 렌즈(동그라미 + 눈동자), `shield` 큰 방패, `entry` 도끼, `nozzle` 물방울, `engineer` 압력계, `rescue` 유압 집게, `search` 음파 호 셋, `water` 구명환, `doctor` 청진기.
  - `officer`(방패)와 `shield`(큰 방패)는 13px 점에서 헷갈리기 쉽다. **윤곽을 다르게** 한다: `officer` 는 아래가 뾰족한 문장형 방패, `shield` 는 세로로 긴 직사각 방패에 위쪽 가로 시야 창이 뚫린 모양. 견본표(10·12·13·16 화소)에서 둘을 나란히 놓고 본다.
- 클래스 `.crew2` 는 `.crewN` 으로(새 블록에서 정의, 옛 규칙은 지우지 않아도 된다).

**대원 정보창** (`ui/panels.tsx` `AgentPanel`)
- 이름 옆 `선임` 대신 역할 이름(0번 자리는 `부대장` 표시를 덧붙인다). 능력 막대 아래에 **장비** 목록: 장비마다 작은 분야 기호(`KIT_GROUP_MARK` 다섯: 진압·구조·의료·경찰·항공) + 이름 + 수량(`섬광탄 1`, `공기 214초`, `테이저 2`) + 고장(`고장`, 알려진 것만 — 관찰자 시점이면 숨은 고장도 흐리게 `(숨은 고장)`). 관찰자 시점 여부는 `App.tsx` 가 `LogPanel` 에 주는 `truth` 를 `AgentPanel` 에도 준다.
- 상공 헬기의 대원(조종사·관측관)을 고르면 "현장 상공 — 탑승 중"과 AirOp 의 할 일(`상공 감시` / `호이스트 인양 중` / `물 뜨러 감` …)을 보여 준다.
- **고르기**(`ui/App.tsx`): `selectUnit` 은 지금 `crew[0]` 을 고른다 — 경찰 헬기에서는 현장에 없는 기장이 된다. `fieldCrew(u)[0]` 을 고르고, 상공에 머무는 부대면 그 AirOp 의 관측자(`eye.rid` — 경찰 헬기는 관측관, 소방 헬기는 0번 자리)를 고른다. `selectRid` 는 지금 `s.agents` 에 있는 대원일 때만 그 현장을 고정(`director.pin`)한다 — 고른 대원이 어떤 현장의 AirOp 관측자이거나 그 부대의 탑승자면 그 사건을 고정한다. 시점만 바꾸는 것이라 개입이 아니다.

**화면 확인**: `http://localhost:5211/?seed=S3&force=armed/kidnap`(경찰 헬기 추적과 상공), `?seed=S5&force=water/std`(소방 헬기 호이스트), 재난 산불(`?seed=S2&disaster=wildfire`, 물 투하), `?seed=S1&force=traffic/bus`(의료 헬기). 밤 시드 하나(탐조등). 현장·지도·부대 목록·대원 정보창을 찍어 직접 보고, 콘솔 오류 0건.

---

## 11. 보고서 (`debrief.buildReport`)

- `air: { ...sim.airStats }` 와 요약 문장 한 줄: `헬기: 출동 n회(경찰 a · 소방 b · 의료 c), 호이스트 인양 n명, 물 투하 n회, 공중 이송 n명, 연료 부족 복귀 n회.` 하나도 없으면 줄을 쓰지 않는다. `grounded` 면 `안개로 헬기가 뜨지 못했습니다.` 처럼. 기록된 통계로만 쓴다.
- **공중 이송(`airLifts`)** 은 "헬기가 병원으로 싣고 간 환자 수"다. 세는 곳은 `resources.startTransport` 한 곳(`if (u.air) sim.airStats.airLifts += u.patients.length`) — 호이스트 뒤의 이송(`air.ts`)도, 내려앉은 의료 헬기의 이송(5)번 블록·`manageAmbulances`)도 모두 이 함수를 지나므로 한 번씩만 센다.
- `airStats.tracked` 는 `pursuit.ts` 의 추적 판정이 센다(7.6).
- **헬기만 왔던 사건의 문장**(`debrief.evaluate` 의 설명): `responseTime < 0`(지상 대원이 내린 적 없음)이고 `s.airAt >= 0` 이면 `헬기가 신고 접수 ${fmtSec(s.airAt − I.reportedAt)} 만에 현장 상공에 도착했지만, 지상 부대는 현장에 닿지 못했습니다.` 한 줄. 대응 시간 통계와 '대응 지연' 판정은 지상 도착 기준 그대로다(17절 결정 10).
- 다친 대원 목록(`respondersHurt`)에 역할 이름. `equipFailures` 는 지금 식 그대로(개인 장비 고장도 `EQUIP_FAIL` 이라 저절로 센다).

---

## 12. 재현성과 균형

**난수 흐름**

| 흐름 | 쓰는 곳 | 비고 |
|---|---|---|
| `roster-v1` (고정 `0x51ab7e`) | 처음 20줄의 0·1번 자리 | **지금과 같은 순서·횟수** — 40명의 기본 능력이 그대로 |
| `roster-v2:<호출부호>:<자리>` (고정) | 그 밖의 자리 | 자리마다 따로. 부대 규모와 무관 |
| `equipment` (교대) | 소방 부대의 펌프 상태 | 그대로 (새 줄은 소방이 아니다) |
| `kit` (교대) | 개인 장비 고장 추첨 | 단계 6 |
| `kit:<현장 id>` (교대) | 테이저 명중, 테이저·물 투하 효과 그림의 흔들림(필요하면) | `damage.ts` 의 `dmg:<현장 id>` 처럼 `WeakMap<Scene, Rng>` 에 둔다 |
| `air:<사건 id>:<부대 id>` (교대) | 관측자의 `FieldAgent.rng` | 판단에 난수가 필요하면 이것만 |
| `aid:<n>` (교대) | 지원 부대 | 그대로. 순서는 대원(자리 수만 늘어난다) → 펌프 → 고장 추첨(5절) |
| `s.rng` (현장, 기존) | — | **새 코드에서 쓰지 않는다.** 명중·용의자 행동이 쓰는 흐름이라 효과 그림 하나에 써도 모든 교전 결과가 바뀐다(6.3) |

- **모든 시드의 결과가 바뀐다**: 대원 수가 바뀌면 `rid` 순서가 바뀌어 현장 개체 난수(`agent:<사건>:<rid>`)가 모두 달라진다. 피할 수 없다. 그래서 단계마다 전후를 잰다.
- **재는 법**(단계 0 에서 기준을 저장해 두고, 시뮬레이션을 바꾼 단계마다 같은 명령으로 비교):
  ```bash
  npx tsx scripts/sweep.ts 60 --json > /scratch/base-normal.json          # 보통
  for p in easy hard extreme; do npx tsx scripts/sweep.ts 60 --diff $p --json > /scratch/base-$p.json; done
  npx tsx scripts/sweep.ts 20 --force armed/kidnap --scen                # 경찰 헬기 추적
  npx tsx scripts/sweep.ts 20 --force armed/hostage --scen               # 인원 문턱이 바뀐 무장
  npx tsx scripts/sweep.ts 20 --force water/std --scen                   # 호이스트
  npx tsx scripts/sweep.ts 20 --disaster wildfire --scen                 # 물 투하
  npx tsx scripts/sweep.ts 20 --force traffic/bus --scen                 # 의료 헬기, 자리 수
  npx tsx scripts/sweep.ts 30 --diff 3,3,3,3,3,1 --scen                  # 최소 인원
  time npx tsx scripts/sweep.ts 20                                       # 교대당 시간
  ```
  (`/scratch` 는 각자의 scratchpad. 저장소에 두지 않는다. 교대별 해시는 7.4 끝의 "해시를 재는 법"으로 잰다.)
- **균형 기준**(보통, 시드 60). 아래 숫자는 이 문서를 처음 쓸 때의 값이다 — B3 가 합쳐진 뒤 달라졌을 수 있으니 **단계 0 에서 잰 기준이 우선**이고, 아래의 폭(±)과 상한을 그 기준에 적용한다. 필드 이름은 `sweep --json` 의 것:
  - `npm run check` 통과(기준 범위 자체는 건드리지 않는다).
  - 성공률(`outcomes.success / incidents` — `good` 은 성공+대응 지연이라 다른 값이다) 73% ± 5%p, 실패+미해결(`bad`) 12% 이하, 한계 시간+방치(`closeReasons.timeout + closeReasons.abandoned`) 4건 이하(지금 3), 평균 대응(`avgResponse`) 55초 이하(지금 50).
  - 유형별 성공률이 50% 아래로 떨어지는 유형이 없다(지금 가장 낮은 화재 54%). 무장은 지금 82% ± 8%p.
  - 프리셋 순서(쉬움 > 보통 > 어려움 > 극한)와 간격(테스트 `프리셋`이 본다) 유지.
  - 부대 규모 1(최소 인원) 이 3 보다 어렵다(성공률이 낮다).
  - 각 `--force` 20교대에서 한계 시간·방치 2건 이하.
  - 교대당 시간: 지금의 1.8배를 넘으면 원인(대개 대원 수 × `perceive`·A*)을 재서 보고에 적는다. 테스트가 시간 초과로 깨지면 P1 의 결과 위에서 다시 재고, 그래도 넘는 테스트만 제한 시간을 늘리고 보고에 적는다.
- **기준을 벗어나면 고치는 차례**:
  - 너무 쉬워지면(사람이 늘어 가장 그럴 것이다): ① 역할 선호가 실제로 작동해 기관원·조종사처럼 일손이 되지 않는 자리가 빠지는지 기록으로 확인 ② 표준 인원에서 균형 후보 자리를 뺀다 — 펌프차 진입대원, 구조 공작차 탐지 대원, 특공대 저격수 (표의 최소 인원과 같은 자리라 능력 불변 조건이 깨지지 않는다) ③ 그래도 넘으면 `difficulty.ts` 의 보통 칸 수치(`hazardMul`·`bleedMul`)를 손대고 그 이유를 보고에 적는다.
  - 화재가 너무 어려워지면(공기통·관창 수): `tn.airFull` 을 올리고, 구조 공작차·화학차의 관창 자리를 확인한다.
  - 무장이 바뀌면: 인원 문턱(≥3, ≥4)을 "총기를 가진 경찰" 기준에서 한 명씩 올려 본다.
  - 의료 헬기가 너무 자주 뜨면(교대당 5회 넘게): `airFit` 의 지상 구급 예상 도착 기준(100초)을 올린다.

---

## 13. 구현 순서

각 단계 끝에 `npx tsc --noEmit`, 그 단계의 테스트, `npm run check` 통과 → 커밋(`wf/crews`, 한국어 메시지). 시뮬레이션을 바꾼 단계는 12절의 비교 결과를 커밋 메시지나 보고에 적는다.

| 단계 | 할 일 | 완료 조건 |
|---|---|---|
| 0 | 기준 재기(코드 없음). 12절 명령의 결과를 scratchpad 에 저장 | 기준 파일과 교대당 시간 |
| 1 | **편성표와 명부**: `types.ts`(역할·장비 자료형, `Responder.role/kit`, `Unit` 의 새 칸), `crews.ts`(`ROLES`·`STAFF`·`KITS`·`stays`·`fieldCrew`·`hasKit`·`kitUses`·`useKit`), `createRoster`·`createAidUnit`(5절), `crewReady`·`crewNames`, `unitArrived` 의 내리는 사람·자리·기록·첫 판단 간격(6.1, 상공 처리는 아직), `pickUnit` 의 감점·평균 체력, `KNOBS` 설명문, 섬광탄 나눔(이 단계에서는 실행기가 아직 `u.flashbangs` 를 써도 합이 같다), `tests/sim.test.ts` 의 편성 숫자 | `tests/crews.test.ts` ①②③⑦⑮(기본 능력 불변 포함), `npm run check` |
| 2a | **부서 → 장비**: 6.2 표의 자격과 `toolFor`·`medLevelOf`·`armorOf`·`blastFactor`, 6.3 표의 자리(방호·이동·경로·시야·탐지·피해·이송 중 처치), 섬광탄을 사람 몫으로, `police` 문턱, 두 문 나누기, 역할 선호 | ④⑤⑥, 12절 기준 |
| 2b | **장비의 특색**: 열화상·탐지·측정기·누출 차단·펌프 조작·들것·고정판·제세동기·의사 장비·테이저·저격·방패·로봇·확성기·경광봉, `kitBonus`, 장비 공백 요청(6.4), 가스·붕괴 진입 요청과 구급 자리 수 요청 | ⑧, 12절 기준 |
| 3 | **환자 자리**: `seatsOf` 를 `canCarryPatients`·지휘관 탑승 대기열·출발 조건·`manageAmbulances` 대상·실행기 `load`(실을 때 자리를 다시 보고 차 있으면 `finishTask(…, false, 'full')`)에. 위중 환자는 헬기 먼저. 부대 출발 기록의 병원 이름(지금 `'시립병원으로'` 고정 — `startTransport` 가 고른 병원으로). 헬기의 첫 출동 경로(7.4 끝 — **해시가 같은지 따로 먼저**) | ⑨(정원), S7 을 다시 돌려 사건 13 에 헬기가 둘을 태우지 않는다 |
| 4 | **헬기 세 종류**: `UnitKind` 두 줄, `UNIT_DEFS` 끝 두 줄, `KIND`, `heliPad`, 소방 헬기 `caps`, `airFit`, `grounded`, 연료와 `airRtb`, `airStats`·출동 횟수, 상공 부대 처리 세 곳(5)·7)번 블록, `countUnits`), `unitArrived` 의 상공 분기, `disaster.ts` 산불 ×0.7 을 바구니 헬기로, 컴파일에 필요한 최소한의 화면 표(`UNIT_MARK`·`VEH_SIZE`·`UNIT_KIND_NAME`·범례 `FIELDS`·`AIR_KIND`) | ⑩(관제 규칙), ⑪(대원 없는 부대가 끝내 떠난다), 12절 기준 |
| 5 | **상공의 일**: `field/rules/air.ts`·`field/airDecide.ts`, `makeAgent` 꺼내기, 공중 관측(`perceive`·`visionOf`·`detectRadius` 의 `aloft` 갈래), 탐조등(`Scene.light`), 호이스트·물 투하, 지휘관의 `hoist`·`airDrop` 작업, `Fx 'drop'`, 보고서 한 줄 | ⑫(세 헬기가 각자의 일을 한 교대), ⑬(판단 파일의 정보 격리), 각 `--force` 20교대의 한계 시간 ≤ 2 |
| 6 | **소모와 고장**: 공기호흡기(`airFull`, `swapAir`, `spareAir`), 고장 추첨(`kit` 흐름, `kitWorks`), `KNOBS` 장비 설명문 | ⑭, 12절 기준(특히 화재) |
| 7 | **화면**: 10절 전부 | 단계 6 끝의 기록 해시와 **같다**(시드 20개, `--json` 비교), 스크린샷 직접 확인, 콘솔 오류 0건 |
| 8 | **균형과 문서**: 12절 기준 최종 확인, `README.md`(편성·헬기·장비, 알려진 문제의 "붕괴 탐지 장비는 수치뿐" 갱신), `CLAUDE.md`(16절의 줄과 함정, 정보 격리 목록에 `field/rules/air.ts` 와 `field/airDecide.ts`), `docs/ROADMAP.md`, 이 문서 끝에 구현 메모 | 보고 |

---

## 14. 테스트 (`tests/crews.test.ts`)

`new Sim(seed, d, len, { force })` 나 `createIncident(sim, { type, variant, rng: sim.rng.fork('t') })` 로 직접 일으킨다. "평소 교대 몇 번에 몇 번 나온다"에 기대지 않는다. 날씨가 안개·밤인 시드는 헬기 테스트에서 건너뛴다(시드를 차례로 돌며 조건에 맞는 것을 찾되 상한을 둔다).

1. **편성표대로 만들어진다**: 부대 규모 3·5 에서 모든 부대의 `crew` 역할 목록이 `STAFF[kind].std` 와 같고, 1 에서는 `minDrop` 을 뺀 것과 같다. 총원은 표에서 계산한 값과 같다. `crew[0]` 의 `senior === true`, 나머지는 false.
2. **2명이 아닌 부대가 있다**: 기본 편성에서 인원 수의 종류가 셋 이상(2·3·4·5)이고, 2명이 아닌 부대가 절반을 넘는다.
3. **능력과 장비가 어긋나지 않는다**(부대 규모 1·3·5 모두, 지원 부대 포함): `caps.suppression ≥ 0.7` ⇒ `hose` 대원, `caps.ems ≥ 0.7` ⇒ 의료 장비(`bag`·`alsBag`·`doctorKit`) 대원, `caps.eod ≥ 0.9` ⇒ `eodKit` 대원, `caps.law ≥ 0.5` ⇒ 총기 대원, `caps.rescue ≥ 0.5` ⇒ 구조 장비(`irons`·`spreader`·`lightRescue`·`rope`·`ring`) 대원, 구조정이 아닌 소방 부서 부대 ⇒ `scba` 대원, `caps.search ≥ 0.3` ⇒ 내리는 대원이 있거나 상공 부대. 모두 내리는 자리에서(경찰 헬기의 `search` 만 예외).
4. **장비가 없으면 그 일을 맡지 않는다**: 화재·가스·붕괴·폭발물 사건 몇 개를 끝까지 돌리며 매 틱 — `suppress`·`overhaul` 담당자는 모두 `hose`, `defuse` 담당자는 모두 `eodKit`, `engage`·`perimeter` 담당자는 모두 총기, 위험 건물 실내 칸에서 수색·구출·이송 중인 대원은 모두 `scba`. 그리고 `fitFor` 단위 시험: 같은 대원에서 `hose` 를 빼면 `suppress` 적합도가 0.
5. **역할이 배정에 쓰인다**: 화재 6건에서 `hookup` 담당의 60% 이상이 `engineer`·`ladderOp`, 구조 공작차가 온 교통사고·붕괴의 `extricate` 담당의 50% 이상이 `extricator`, 폭발물 사건의 `defuse` 는 모두 `bombTech`.
6. **방호가 장비를 따른다**: 연기 칸에 같은 시간 서 있을 때 `scba` 대원의 체력 손실 < 없는 대원의 손실(작은 현장을 직접 만들어 `agentHealth` 경로로).
7. **같은 사람 = 같은 능력**: 부대 규모 1·3·5 에서 같은 이름의 대원은 `skill`·`judgment` 가 같다(셋째 자리 이후 포함). 이름이 모두 다르다. 그리고 처음 20줄의 0·1번 자리 40명은 R1 전과 같은 `skill`·`judgment` 를 갖는다 — 테스트 안에서 `new Rng(0x51ab7e).fork('roster-v1')` 을 옛 방식(줄 순서 × 두 명, 한 명당 6번: 경험 → `st()` 다섯)으로 다시 뽑아 비교한다.
8. **장비 공백 요청**: `capableOf`·`anyCapable` 단위 시험 — 순찰차만 있는 현장에서는 `suppress` 를 맡을 사람이 없다고 나오고, 펌프차가 오는 중이면 있다고 나온다. 그리고 화재 시드 몇 개에서 `suppress` 작업이 30초 넘게 담당자 없이 열려 있었는데 맡을 장비도 없고 `suppression` 요청도 없었던 순간이 없다.
9. **환자 자리**: 시드 20개 × (`traffic/bus`, 위험도 높은 교통사고) 동안 매 틱 모든 부대의 `patients.length <= seatsOf(u)`. 경찰 헬기는 환자를 태운 적이 없다.
10. **관제 규칙**: 추격전(`armed/kidnap`) 4시드 가운데 경찰 헬기가 배정된 교대가 있고 소방·의료 헬기가 배정된 추격전은 없다. 응급 환자(`medical`)의 선착 대응에 헬기가 배정된 적이 없다. 안개 교대에는 헬기 출동이 0. 밤 교대에 의료 헬기 출동이 0.
11. **대원 없는 부대가 끝내 떠난다**: 40교대가 끝났을 때 어떤 부대도 닫힌 사건에 `onscene` 으로 남아 있지 않고, 상공 헬기가 있는 현장은 모두 닫힌다. 매 틱 어떤 `s.agents` 에도 `aloft` 인 개체가 없고, 내리지 않는 자리(조종사·정장·관측관)의 대원이 `s.agents` 에 들어간 적이 없다.
12. **세 헬기가 각자의 일을 한다**: 경찰 헬기 — 추격전에서 상공 헬기 때문에 `tracked` 가 된 교대가 있고, 실종 현장에서 관측자(`discoveredBy` 가 관측관의 `rid`)가 사람을 찾은 교대가 있다. 소방 헬기 — 수난 현장에서 `airStats.hoists > 0` 인 교대, 산불에서 `airStats.drops > 0` 인 교대가 있다. 의료 헬기 — 환자를 싣고 병원에 내린 교대(`airLifts` 가 아니라 `hospital` 상태를 거친 의료 헬기)가 있다.
13. **정보 격리**: `src/sim/field/airDecide.ts` 의 주석이 아닌 줄에 `s.props`·`s.casualties`·`s.hostiles`·`.truth`·`s.fire[`·`s.smoke[`·`sim.scenes` 가 없다(`tests/ext.test.ts` 의 방식). `src/sim/dispatch/*` 에 `.fault` 가 없다.
14. **소모와 고장**: 공기는 0 밑으로 내려가지 않는다. 연기 속 일을 오래 한 화재(위험도 3, 시드 몇 개)에서 `swapAir` 를 한 대원이 있다. 장비 1 의 숨은 고장 수 > 장비 5. 드러난 고장마다 `EQUIP_FAIL` 이 하나씩이다.
15. **재현성**: 같은 시드·같은 조건 두 번의 `report.hash` 가 같다(강제 발생·재난 포함).

`tests/sim.test.ts`(이 묶음이 고친다): `부대 규모 손잡이가 …` 테스트의 `12/17/20` → `12/19/22`, `big.responders.length === 40` → 표에서 계산한 총원, 이름 수도 같게, "네 분야마다 3~5팀" → "3~6팀". "특수+사다리 6" 은 그대로 맞는다. 그 밖의 테스트는 고치지 않는다(깨지면 원인을 고친다).

---

## 15. 고칠 파일 목록

**자기 파일(새로)**
- `src/sim/crews.ts` — `ROLES`·`STAFF`·`KITS`·`EXTRA_NAMES`, 3·4절의 도움 함수, `capableOf`, `isHovering`, `heliPad`, `minCrew`. import 하는 것은 `types.ts`·`util.ts`(`josa`)·`events.ts`(`raiseProblem`)와 타입뿐이다 — `resources.ts`·`field/*`·`dispatch/*` 를 import 하지 않는다(`resources.ts` 가 이 파일을 import 하므로 거꾸로 import 하면 순환이 생겨 초기화 전의 표를 읽는다. `CLAUDE.md` 의 시나리오·추격전 함정과 같은 꼴). `etaFor` 가 필요한 `airFit`·`kitBonus` 는 그래서 `dispatcher.ts` 안에 둔다.
- `src/sim/field/rules/air.ts` — 상공의 실행(관측·탐조등·호이스트·물 투하·떠남·통계).
- `src/sim/field/airDecide.ts` — 상공의 판단(믿음만).
- `tests/crews.test.ts`.

**공용 파일 수정**

| 파일 | 함수 · 자리 | 이유 |
|---|---|---|
| `sim/types.ts` | 3절 | 자료형 (추가만) |
| `sim/difficulty.ts` | `Tuning`(`airFull`·`kitFault`), `tune()`, `KNOBS` 의 장비·부대 규모 설명 | 손잡이 |
| `sim/engine.ts` | `airStats` 칸 | 통계 |
| `sim/resources.ts` | `UNIT_DEFS` 끝 두 줄, `KIND`, `UNIT_KIND_NAME`, `createRoster`, `createAidUnit`, `crewReady`·`crewNames`, `dispatchUnit`(통계), `offroadTarget`(`heliPad`, 병원 착륙장), `tickUnits`(연료·`grounded`·이송 중 처치·`turnout` 의 `sendUnitTo`), `arrive`(`returning` 의 연료·바구니·공기 채우기) | 편성·헬기 |
| `sim/dispatch/dispatcher.ts` | `pickUnit` | `airFit`·감점·`kitBonus` |
| `sim/field/sceneManager.ts` | `unitArrived`(대원 생성을 `agents.makeAgent` 로, 내리는 사람·자리·상공 분기·도착 시각), `agentHealth`(장비 방호·공기), `tickScene` 5)·7)번 블록, 부대 출발 기록의 병원 이름 | 6.1, 7.3 |
| `sim/field/agents.ts` | 새 `makeAgent`(export), `visionOf`, `detectRadius`, `perceive`(`aloft` 갈래·측정기), `flushOutbox`·`transmit`(`aloft` 음영 예외), `agentCost`, `canCarryPatients`(→ `seatsOf`), `fitFor` | 6.2, 7.3 |
| `sim/field/executor.ts` | `moveSpeed`, `moveTo` 의 경로 불, `workOnBlocker`, `shootAt`, `spray`, `breach`, `case 'search'`·`'hookup'`·`'waterRescue'`·`'extricate'`·`'treat'`·`'carry'`·`'load'`·`'traffic'`·`'mitigate'`·`'defuse'`·`'negotiate'`·`'engage'`·`'arrest'`, 새 `case 'swapAir'` | 6.3, 9절 |
| `sim/field/brain.ts` | `dangerScore`, 예비 펌프 교체 후보, 공기통 교체 후보 | 6.3, 9절 |
| `sim/field/commander.ts` | `syncBoard`(`police`, `hasBang`, 탑승 배정, 지원 요청 블록, 6.4, `hoist`·`airDrop`), `countUnits`, `manageAmbulances` | 8절 |
| `sim/field/hazards.ts` | `blast`(`blastFactor`), `tickHostiles` 명중 피해(`armorOf`) | 6.3 |
| `sim/field/scenes/index.ts` | `import '../rules/air';` 한 줄(마지막) | 규칙 등록 |
| `sim/disaster.ts` | `tickWildfire` 의 헬기 판정 한 줄 | 7.3 |
| `sim/debrief.ts` | `buildReport`(헬기 한 줄, `air`), 다친 대원의 역할 | 11절 |
| `view/scene/sprites.ts` | `responderLook`(역할), `PersonLook.bulk`, `HeadKind 'visor'`, `Item`(`shield`·`taser`·`tic`·`halligan`·`ram`·`sniper`), `drawPerson`, `drawHeli`(종류별 도색), `drawEmergency`, `VEH_SIZE` | 10절 |
| `view/renderScene.ts` | `agentPose`, `lookOf` 키, 차량 줄(상공 제외), 상공 헬기·호이스트 줄·바구니·투하, 들것 조건, 공기 점 | 10절 |
| `view/scene/fx.ts` | 탐조등 빛, `drop` 효과 | 10절 |
| `view/marks.ts` | `UNIT_MARK` 두 줄, `ROLE_MARK`, `KIT_GROUP_MARK`, `AIR_KIND` | 10절 |
| `view/city/tokens.ts` | 날개 판정 | 10절 |
| `view/city/staticCity.ts` | (선택) 중부경찰서 지붕 착륙장 그림 | 10절 |
| `ui/panels.tsx` | `UnitRow`(역할 점), `AgentPanel`(역할·장비·상공), `truth` 받기 | 10절 |
| `ui/App.tsx` | `AgentPanel` 에 `truth` | 10절 |
| `ui/MapLegend.tsx` | `FIELDS`, 대원 역할 칸 | 10절 |
| `ui/styles.css` | 끝의 `/* ── crews ── */` 블록 | 10절 |
| `tests/sim.test.ts` | 편성 테스트 숫자 | 14절 |

**건드리지 않는다**: `sim/city.ts`, `sim/cityPlan.ts`, `sim/pursuit.ts`(선택한 기록 문구 하나 말고), `sim/dispatch/analyst.ts`, `sim/scenarios/*`, `sim/traffic.ts`, `scripts/sweep.ts` 의 기준 범위.

---

## 16. `CLAUDE.md` 에 들어갈 것 (단계 8)

**"자주 하는 확장" 표에 더할 줄**

| 하고 싶은 것 | 고칠 곳 |
|---|---|
| 부대 편성(인원·역할) 바꾸기 | `crews.ts` `STAFF`(자리 순서 = `crew` 순서, 0번이 부대장, `minDrop` = 최소 인원에서 뺄 자리). 셋째 자리부터는 `roster-v2:<호출부호>:<자리>` 흐름이고 이름은 `EXTRA_NAMES` 를 차례로 쓰므로 **새 자리는 끝에 붙인다**. 바꾼 뒤 `tests/crews.test.ts` 의 "능력과 장비가 어긋나지 않는다"가 통과해야 한다 |
| 새 역할 | `types.ts` `RoleId` → `crews.ts` `ROLES`(이름·그림 묶음·skills 식·기본 장비·`prefer`·`stays`) → 그림 `sprites.responderLook` |
| 새 개인 장비 | `types.ts` `KitId` → `crews.ts` `KITS`(tool·med·armor·`faultable`) → 효과는 그 장비를 보는 자리 하나에서 `kitWorks`(숨은 고장을 드러낸다)로, 배정은 `hasKit`/`capableOf` → 손에 든 그림 `renderScene.agentPose` + `sprites.drawPerson` → 대원 정보창은 저절로(`KITS[id].name`) |
| 새 헬기·공중 임무 | `UnitKind` + `crews.ts` `STAFF`·`isHovering` + `dispatcher.ts` `airFit`(관제가 보내는 수요) → 상공의 실행은 `field/rules/air.ts`(진실을 읽는다), 판단은 `field/airDecide.ts`(믿음만) → 지휘관의 작업은 `commander.ts` 에서 `want('hoist'|'airDrop')` 처럼 지상 대원의 `fitFor` 가 0 인 작업으로 |

"새 부대 종류" 줄에는 `crews.ts` `STAFF`, `marks.ts` `AIR_KIND`(헬기일 때), `KIND` 의 `seats`·`spareAir` 를 더한다. "새 임무 종류" 줄에는 "`fitFor` 에 장비 자격을 정한다(`capableOf` 도 함께)"를 더한다.

**"겪은 함정" 후보**

- **내리지 않는 자리.** 조종사·정장·관측관은 `FieldAgent` 가 되지 않는다. `crewReady`·`crewNames`·관제의 감점은 `fieldCrew` 로 센다. 0번 자리(부대장)는 내리는 자리로 둔다(출동 준비 시간·첫 지휘관). 경찰 헬기처럼 전원이 내리지 않는 부대는 `fieldCrew` 가 전원이다.
- **대원이 없는 현장 부대.** 상공의 헬기는 `onscene` 인데 대원이 없다. 철수는 5)번 블록의 "남은 대원이 없는 부대" 줄이, 방치 종료는 7)번 블록의 상공 검사가, 부대 수 세기는 `countUnits` 의 `u.air && onscene` 이 처리한다. 대원이 있다고 가정하고 부대를 다루는 코드를 새로 쓰지 않는다.
- **공중 관측자는 `s.agents` 밖에 있다.** 용의자의 표적·폭발·연기 피해·지휘권 승계·무전 수신에 끼지 않게 하려는 것이다. 관측자를 `s.agents` 에 넣지 않고, `s.agents` 를 도는 코드에서 관측자를 찾지 않는다.
- **상공 도착은 현장 도착이 아니다.** `s.arrivedAt`(한계 시간)은 상공에서도 돌지만 `I.firstArrivalAt`(대응 시간)은 지상 대원이 내릴 때만이다.
- **환자 자리는 `seatsOf(u)` 하나.** `canCarryPatients`·지휘관 탑승 대기열·출발 조건·실행기 `load` 가 모두 그것을 본다. 숫자 2 를 다시 쓰지 않는다(예전에는 헬기에 둘이 탔다).
- **섬광탄·테이저·공기는 사람 몫이다.** 쓸 때는 `useKit`(섬광탄이면 `u.flashbangs` 도 함께 준다). 부대 값을 직접 줄이지 않는다.
- **장비 효과는 `kitWorks`, 배정은 `hasKit`.** 효과를 줄 때 `hasKit` 만 보면 숨은 고장이 드러나지 않고, 배정에서 `kitWorks` 를 부르면 아직 쓰지도 않은 장비의 고장이 드러난다.
- **능력(`caps`)과 장비는 함께 고친다.** 관제는 부대 수로 보내고 그 부대가 장비를 가졌다고 믿는다. `caps` 를 올리거나 자리를 빼면 테스트 "능력과 장비가 어긋나지 않는다"가 잡는다.
- **헬기의 일은 `airFit` 이 정한다.** `u.air` 만 보고 헬기를 보내거나 세면 경찰 헬기가 환자를 싣거나 산불을 늦춘다.

정보 격리 목록(`CLAUDE.md` 4번)에 더할 것: 진실을 읽어도 되는 곳에 `field/rules/air.ts`(상공 관측·실행), 읽으면 안 되는 곳에 `field/airDecide.ts`.

---

## 17. 결정해 둔 것과 알려진 위험

**결정 (근거)**

1. **헬기는 종류를 나눈다**(`heli` 는 소방 헬기로 뜻 그대로, `policeHeli`·`medHeli` 를 더한다). `Record<UnitKind, …>` 표(`KIND`·`UNIT_KIND_NAME`·`VEH_SIZE`·`UNIT_MARK`)가 빠진 곳을 컴파일 오류로 잡아 주고, 세 헬기의 능력·자리·장비가 서로 다르다. `kind === 'heli'` 로 보는 곳은 몇 군데뿐이다(7.6).
2. **상공의 헬기는 `s.agents` 밖의 관측자로 만든다.** `s.agents` 를 도는 곳이 65곳쯤이라 대원으로 넣으면 표적·피해·승계·철수를 모두 손봐야 한다. 관측자는 `perceive`·`flushOutbox` 를 그대로 쓰므로 정보 격리가 지금 규칙 안에 있다.
3. **의료 헬기는 `dept: 'ems'`.** 기본 처치 뒤 처치는 구급만(`fitFor`), 지휘관의 `hasMedic`, 응급 현장의 지휘권 이양이 저절로 맞는다. 의사·간호사는 `scba` 가 없어 불탄 건물에는 들어가지 않는다(맞는 일이다).
4. **관제 수요는 부대 수 그대로.** `Needs` 의 여덟 키는 분석·배정·지휘관 요청·인근 도시 지원이 함께 쓴다. 사람 단위로 바꾸는 것은 이 묶음보다 크다. 대신 능력·장비 불변 조건을 테스트로 지킨다.
5. **부대 규모 손잡이는 팀 수와 인원을 함께 바꾼다**(1·2 최소, 3~5 표준). 기본(3)의 결과가 최소 인원 표에 기대지 않고, 낮은 단계가 더 어려워지는 방향이 손잡이의 뜻(`harderWhen: 'low'`)과 맞다.
6. **개인 장비는 장비 손잡이를 따른다**: 성능 배율(`toolMul`·`medMul`·`armorMul`), 섬광탄 수, 공기통 용량, 고장 확률. 새 손잡이를 만들지 않는다.
7. **지원 부대는 그 종류의 최소 인원 편성.** 명부 코드가 한 갈래로 남고, 인근 도시의 부대가 "급히 꾸린 팀"이라는 뜻과 맞는다.
8. **새 시설을 만들지 않는다.** 경찰 헬기는 중부경찰서, 의료 헬기는 가온대학교병원에 둔다. 지도가 그대로라 사건 장소·경로가 이 묶음 때문에 바뀌지 않는다.
9. **소방 헬기는 특수 분야에 남는다.** 경찰·의료 헬기는 각자 부서 분야(경찰·구조·구급)로 간다. 소방 헬기를 소방으로 옮기면 부대 규모 1 의 특수 분야가 2팀이 되어 "분야마다 3팀 이상"이 깨진다. 지도에서는 세 헬기가 바탕색으로 갈린다.
10. **상공 도착은 대응 시간에 넣지 않는다.** 헬기가 빠르게 떠 있기만 해도 평균 대응 시간이 좋아 보이는 것을 막는다.
11. **탄약은 무제한**, 둘이 들어가고 둘이 남는 짝 규칙은 R3, 헤엄쳐 구조 같은 방법 갈래는 R2, 대원의 장기 부상·사망은 H1.
12. **이륙 준비 시간은 그대로**(`etaFor` 의 대기 중 +10초). 늘리면 헬기의 쓸모가 줄어 균형을 따로 맞춰야 한다.

**알려진 위험**

- **모든 시드의 결과가 바뀐다.** 기준 수치(`ROADMAP`·`README`)를 다시 잰다. 사람이 거의 두 배라 쉬워질 가능성이 크다(12절의 고치는 차례).
- **헤드리스 속도.** 현장 개체가 1.9배쯤 늘어 `perceive`·A* 비용이 그만큼 는다. 테스트(지금 7분)가 시간 초과로 깨질 수 있다. P1 이 먼저 합쳐져 있어야 한다.
- **무장 사건.** 인원 문턱이 사람 수라 기동대 3명이 혼자 문턱 3 을 채운다(인질 진입이 빨라진다). 두 문 나누기도 바뀐다. `--force armed/hostage`·`siege` 로 따로 본다.
- **화재.** 구조 공작차·화학차의 분사 인원이 둘에서 하나로 준다. 공기통(단계 6)이 더해지면 더 어려워진다. B1(화재 균형)의 결과 위에서 잰다.
- **부대 규모 1·2 의 추격전.** 경찰 헬기가 없고 소방 헬기는 무장 사건에 가지 않으므로 하늘의 눈이 없다. 놓침이 늘면 `airFit` 에서 경찰 헬기가 없을 때만 소방 헬기의 무장 `search` 를 0.5 로 허용한다.
- **의료 헬기의 쏠림.** 적합도 1.2·빠른 직선 비행이라 낮의 위험도 높은 구급 수요를 거의 다 가져갈 수 있다. 교대당 출동 수를 본다(12절).
- **같은 파일을 고치는 다른 설계서.** H1(부상·사망)은 `agentHealth`·`hazards` 의 피해 식을, R2(대응 방식)는 `waterRescue`·`toolFor` 를 고친다. 순서는 R1 → H1 → R2 이므로 R1 은 식의 "방호·장비" 부분만 함수(`armorOf`·`blastFactor`·`toolFor`)로 꺼내 두어 뒤의 묶음이 그 함수만 고치게 한다.
- **다른 설계서와 이름 맞추기**(같은 날 따로 쓴 `H1-injuries.md`·`R2-methods.md` 는 R1 의 이름을 가정으로 적었다 — R1 이 먼저 합쳐지므로 R1 의 이름이 기준이다): 개인 장비 칸은 `Responder.kit: KitItem[]`, 판정은 `hasKit`(배정)·`kitWorks`(효과)·`kitUses`/`useKit`(수량)·`toolFor`(성능). R2 의 `gearOf`·`hasGear` 는 이 함수들과 부대 칸(`Unit.hoist`·`bucketMax`·`seats`)을 감싸면 되고, R2 의 장비 이름이 R1 에 없으면 `KitId` 에 **추가**한다(예: 구명조끼·드론). H1 의 `protection()` 은 `armorOf`·`blastFactor` 와 `scba`·`turnout` 판정을 읽고, H1 이 말한 최소 인원은 `crews.ts` 의 최소 인원 표(`STAFF[kind].std.length − minDrop.length`, 함수 `minCrew(kind)` 로 export)다. 기본 응급 가방은 `bag`, 테이저 무력화 시간(R1 3.2초)은 H1 이 바꿀 수 있다. R2 가 말한 "몸과 다른 곳에서 보는 눈"(드론)은 R1 의 공중 관측자(`aloft` 인 `FieldAgent`, `s.agents` 밖)와 같은 방식으로 만들 수 있다.
- **확인하지 못한 것** (구현하며 확인할 것): `perceive`·`discover`·`flushOutbox` 가 관측자를 `s.agents` 밖에서 불러도 되는지(읽은 범위에서는 된다), 작업판의 배정 정리가 담당자 없는 공중 작업에서 예외를 내지 않는지, 병원 착륙장 그림의 점과 `Facility` 좌표의 관계, 산불 현장의 숲 구역이 `indoor = false` 인지(물 투하 대상), 내리는 자리 15칸이 벽에 걸리는 현장이 있는지.
