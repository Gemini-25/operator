# N8 조사 — 뒤 묶음의 능력과 나누는 선

조사 기준: 주 브랜치 `claude/great-ptolemy-s31sxn` 의 `c13bb74`(2026-11-15). 코드는 고치지 않았다.
읽은 것: `docs/ROADMAP.md`, `docs/specs/README.md`, `docs/specs/{H1-injuries,X6-catastrophe,R2-methods,R3-doctrine,I1-causality,I2-persistence}.md`, `docs/specs/R1-crews.md` 끝 "구현 메모", `docs/DESIGN.md`, `README.md`, 그리고 코드 `src/sim/field/{catastrophe,injury}.ts`·`src/sim/scenarios/*.ts`·`src/sim/dispatch/analyst.ts`·`scripts/{sweep,metrics}.ts` 의 해당 자리.
잰 것: 보통 40교대(S0~S39)에서 부대 종류·임무 종류가 어느 시나리오에 쓰였는지(§4.1 — 조사용 스크립트 `/tmp/claude-0/-home-user-operator/186169fe-a127-5e67-996a-cfc83d22e9db/scratchpad/wf-kinds/research/usage.ts`, 결과 `…/research/usage-normal40.txt`, 26초). `npm run check`·전체 vitest 는 돌리지 않았다.

표시: **[코드]** = 지금 주 브랜치에 있다(코드가 정본). **[설계]** = 설계서에만 있다 — N8 구현 전에 그 묶음의 "구현 메모"에서 실제 이름을 확인한다. "추측"·"확인 못 함"은 그대로 적었다.

---

## 0. 먼저 알아 둘 것 (설계의 입력이 이미 문서에 있다)

1. **묶음이 둘이다.** `docs/ROADMAP.md` "진행 중"의 사용자 요청 줄(마지막 커밋 `c13bb74`)에 사용자가 답한 것이 적혀 있다 — "설계의 입력, 바꾸지 않는다": ① 새 유형과 새 시나리오를 **둘 다** ② 분량 **크게**(시나리오 +35쯤, 새 유형 +5~6 — **N8·N9 둘로** 나눠 진행) ③ 가벼운 생활 사건과 무거운 사건을 **고르게** ④ 부족한 분야 **전부**(경찰 일상 치안·소방·구조·구급·합동, "특수 분야도 모자람") ⑤ 사건 묶음 **열두 가지 모두**(높은 곳·깊은 곳 구조 / 동물 / 시설 사고 / 위기에 놓인 사람 / 일상 치안 / 재산 범죄 / 군중·행사 / 테러·중대 위협 / 교통 시설 / 산업 현장 / 의료의 여러 갈래 / 날씨·환경 피해) ⑥ 일이 늘어야 할 특수 부대 **넷 모두**(특공대·폭발물 처리 / 화생방 / 헬기·해상 / 구조대 전문 장비) ⑦ 설계서와 ROADMAP 만 읽고 다른 모델이 이어받을 수 있게.
2. **앞선 사용자 의견과의 긴장.** `I1-causality.md` 머리말: 사용자 검토 의견 "사건의 수를 늘리는 것보다, 사건 하나에서 발생할 수 있는 상황의 수를 늘리는 것" — I1 은 그래서 "새 사건 유형을 더하지 말고"로 썼다. `docs/DESIGN.md` §5 도 "새 사건은 되도록 시나리오로 넣는다. 유형을 늘리면 고칠 표가 열 곳이 넘는다". 이번 요청(2026-11-15)이 나중 것이므로 N8 은 유형도 늘리지만, **새 사건이 앞 일곱 묶음의 "상황"(방법·교본·조짐·부상·인과)을 타게** 설계해야 두 의견이 함께 선다(§4 가 그 재료).
3. **R2·R3 는 둘 다 "새 사건 유형·시나리오·부대 종류는 하지 않는다"고 적었다**(R2 §2, R3 §1). 탐지견·드론은 "부대·장비가 생기면 7단계에서 켠다"(R2 §4.9)로 이름만 예약돼 있다 — 부대·장비를 만드는 묶음은 아직 주인이 없다.

---

## 1. N8 이 시작될 때 있을 것

### 1.1 구현 상태 (2026-11-15)

| 묶음 | 상태 | 코드에 이미 있는 것 | 아직 설계뿐인 것 |
|---|---|---|---|
| R1 편성·개인 장비·헬기 | **다 합쳐짐** | 전부 [코드] — `src/sim/crews.ts`, `field/agents.ts`, `field/rules/air.ts`, `field/airDecide.ts`, `dispatch/dispatcher.ts`(`airFit`·`kitBonus`) | — |
| H1 부상과 사망 | 구현 중(단계 0·1·2·3·4a 가 주 브랜치) | `field/injury.ts`: `InjuryCause`(15)·`CAUSE_NAME`·`bandOf`·`injuryRng`·`noteInjury`·`hurtCas`·`hurtCasTo`·`hurtResponder`·`protection`·`hurtF`·`mustRetreat`·`woundTick`·`initialCause`·`initInjuries`·`smokeCause`·`decayCause`, 상수 `DOWN_AT 15`·`HURT_AT 40`·`BLEED_PER_DMG`. `MateBelief`, 문제 코드 `RESPONDER_KILLED`. `rules/injury.ts`·`orders/injury.ts` | 4b·4c(후송 — `treatMate`·`LIGHT_WORK`·`needsHospital`·`mateNeedsHospital`·`treatEffect`·`seatsUsed`·`Unit.aboard`), 5(용의자 — `hurtHostile`·`treatSuspect`·`SUSPECT_DIED`), 6(판정·보고서), 7(균형). `outShifts`·`RosterOut` |
| X6 위험의 현실화 | 단계 1(상태만 — 결과 불변)만 | `field/catastrophe.ts`: `CAT`·`NO_STRUCT`·`catRng`·`catOf`·`vesselKind`·`catTick`(계산만)·`bldgOf`·`bldgLevel`·`burnFracOf`·`gasClouds`. `field/ops.ts`: `footprint`·`regionNbrs`. `rules/catastrophe.ts`: `catRule`. `world/consequence.ts`: 빈 `signal()`. 자료형 `CatState`·`OpsState`·`SignBelief`·`PlaceMark`·`Sim.placeMarks`(늘 빔), 문제 코드 다섯, `FactType 'sign'·'ops'`, `Fx 'horn'` | 단계 2~10: 조짐 지각(`perceiveSigns`), 실제 붕괴·폭발·전소(`collapseRegion`·`collapseBuilding`·`explodeGas`·`ruptureVessel`), 지휘(`orders/catastrophe.ts` 의 `DANGER_RULES`·`dangerMap`), 철수(`TaskKind 'evacuate'`), 외부 방어(`exteriorSpot`), 잔해 수색 국면, 드럼통·분진·플래시오버(9단계 — 선택) |
| R2 대응 방식 | 단계 0(틀)이 `wf/methods` 에서 도는 중(주 브랜치에는 아직 없음) | — | 전부 [설계] |
| R3 교본 · I1-b 인과 규칙 · I2 교대 간 지속 | 설계서만 | I1-a(측정 도구 `scripts/metrics.ts`)는 [코드] | 전부 [설계] |

### 1.2 R1 — 부대·역할·장비·헬기 [코드]

- **부대 14종**(`UnitKind`): `engine`·`rescue`·`als`·`bls`·`patrol`·`tactical`·`ladder`·`hazmat`·`swat`·`eod`·`heli`(소방 헬기)·`boat`·`policeHeli`·`medHeli`. 네 분야 22팀(보통 19팀·대원 63명).
- **역할 36가지**(S0 보통 명부에서 센 사람 수): patrolLead 3 · officer 3 · tacLead 1 · tacOfficer 2 · fireLead 3 · nozzle 4 · firefighter 3 · engineer 3 · ladderLead 1 · ladderOp 1 · rescueLead 1 · extricator 2 · searcher 1 · ropeTech 1 · paramedic 2 · emt 6 · emsDriver 6 · swatLead 1 · shield 1 · breacher 1 · assaulter 1 · marksman 1 · airRescuer 2 · pilot 3 · copilot 3 · hazLead 1 · hazTech 2 · decon 1 · boatRescuer 2 · boatLead 1 · bombTech 1 · robotOp 1 · eodGuard 1 · observer 1 · doctor 1 · flightNurse 1.
- **개인 장비 36가지**(같은 명부에서 든 사람 수): pistol 11 · taser 6 · vest 8 · megaphone 5 · aed 9 · baton 3 · plate 8 · rifle 4 · flashbang 5 · scba 26 · turnout 26 · tic 4 · irons 10 · hose 10 · rope 8 · pumpPanel 4 · searchKit 2 · spreader 2 · ring 3 · alsBag 3 · bag 8 · spineBoard 6 · stretcher 7 · shield 1 · breachKit 1 · charge 2 · sniper 1 · lightRescue 2 · gasMeter 2 · plugKit 2 · bombSuit 1 · eodKit 1 · robot 1 · flir 1 · searchlight 1 · doctorKit 1.
- **장비를 읽는 네 가지**: 배정 `hasKit`·`toolFor`·`capableOf` / 물리 `kitLive` / 효과 `kitWorks`·`toolUse` / 수량 `kitUses`·`useKit`. 숨은 고장(`KitItem.fault`)은 효과 자리에서만 드러난다.
- **헬기 세 종류와 상공의 일**: 경찰(추적·공중 관측·탐조등), 소방(호이스트 `WorkKind 'hoist'`·물 투하 `'airDrop'`), 의료(의사·간호사, 환자 1명). 관제의 수요 연결은 `dispatcher.airFit` 한 곳. 상공에 머무는가는 `crews.isHovering`(경찰 헬기는 언제나, 소방 헬기는 물·산불 현장). 판단은 `airDecide.ts`(좁힌 입력 `AirView`).
- 환자 자리 `seatsOf(u)`(구급차 2 · 소방/의료 헬기 1), 공기 문턱 `airShort`(`AIR_MIN 45`), 장비 고장 추첨 `drawFaults`(교대 흐름 `kit`).
- **R1 구현 메모가 남긴 후보 가운데 사건 종류와 닿는 것**: (1) 실종 97% — "나무 밑의 사람이 하늘에서 가려지는 것 같은 새 규칙이 필요" (2) 의료 헬기가 다수 사상자 현장을 네댓 번 오감 (3) 상공의 경찰 헬기를 더 급한 추격전으로 돌리지 않음 (7) 보통 난이도에서 공기가 거의 드러나지 않음.

### 1.3 H1 — 부상과 사망 (코드 + 설계)

- **원인 15가지** `InjuryCause` [코드]: `gunshot` 총상 · `stab` 자상 · `blunt` 타박상 · `burn` 화상 · `smoke` 연기 흡입 · `toxic` 유독 가스 · `fall` 추락 · `crush` 잔해 깔림 · `blast` 폭발 · `drown` 익수 · `electric` 감전 · `exhaustion` 열 탈진 · `vehicle` 차량 충격 · `exposure` 실외 노출 · `illness` 급성 질환.
- **중증도** `bandOf(h)`: 체력 > 70 → 0 경상, > 40 → 1 중상, > 0 → 2 위중, ≤ 0 → 3 사망. 대원 문턱 `HURT_AT 40`(injured)·`DOWN_AT 15`(쓰러짐). "멀쩡한 대원은 한 번에 숨지지 않는다"(문턱).
- **피해는 한 길로만**: 구조 대상 `hurtCas`, 대원 `hurtResponder`(방호 `protection(sim, r, u, cause, engaging)`), 용의자 `hurtHostile`[설계 — 5단계]. `hurt*` 는 피해 문구를 남기지 않는다(피해 자리가 이미 남긴 기록의 id 를 `{ ev }` 로 넘긴다).
- **처음 상태의 원인**: 현장 생성기는 고치지 않고 `sceneManager.createScene` 이 `initInjuries` 를 부른다 — 변형·유형 표는 `injury.ts` `initialCause(s, I, c)`[코드].
- **`electric` 은 공식만 있고 부르는 곳이 없다**(H1 §2.3: "한 번 15~35, `injuryRng(…,'electric').chance(0.3)` 이면 바로 쓰러짐 … 생활 사건 '끊어진 전선'·재난 규칙이 나중에 부른다". 구현 메모 1246줄: "`'electric'` 은 아직 아무도 쓰지 않는다"). 방호 표에는 소방 분야 0.4 줄이 있다(§2.4). `exhaustion` 은 "사실상 일어나지 않는다"고 적혀 있다.
- **후송·동료 구조**[설계 4b]: `WorkKind 'treatMate'`, 있는 `rescueMate`, `Unit.aboard`(구조 대상이 아닌 환자 — 대원·용의자), 가벼운 일 목록 `LIGHT_WORK = traffic·perimeter·negotiate·interview·hookup·treat·treatMate`(사용자 결정 — 다친 대원은 가벼운 일만).
- **용의자**[설계 5]: `treatSuspect`, `SUSPECT_DIED`, 자해 끔(`SELF_HARM = 0` — 사용자 결정), 호송은 모델하지 않는다(H1 §4.3).
- 결원 규칙(사용자 최종 결정): 부대의 운용 중단은 대원이 전부 숨졌거나 걸을 수 있는 대원이 없을 때만.
- 문제 코드 `RESPONDER_KILLED`[코드]·`SUSPECT_DIED`[설계]. 교대 끝 `ShiftReport.roster`·`outShifts(r)`[설계] → I2.

### 1.4 X6 — 조짐·철수·붕괴·폭발·전소 (단계 1 코드 + 설계)

- **세 위험**(`Scene.cat`): 붕괴(구획 건전도 `integ[r]`, 건물 `bldg` — `integ < 0.36` 임박 → 구획 붕괴 → 전체 붕괴), 폭발(칸별 가연성 가스 `gas[i]`(1 = LEL) 구름 + 점화원 → 가스 폭발 / 용기 열 `heatLoad ≥ 1` → 용기 폭발), 전소(건물 칸 연료의 탄 비율 ≥ 0.7).
- **대상 판별** `catOf`[코드]: 실내 구획이 있거나, 밸브(`valve`)·연료 새는 차량·용기 소품이 있는 현장. 구조 규칙(붕괴·전소·지도의 건물 상태)은 `struct = 실내 구획 있음 && !s.outdoor && NO_STRUCT 에 없는 변형` 일 때만 — `NO_STRUCT = ['ship','plane','train','pileup','crane','landslide','elevator','wild']`. 가스 모델은 밸브 소품이 있을 때만 켜진다.
- **용기** `vesselKind(p)`[코드]: `'cylinder'`(소품 `gas`), `'drum'`(X6 가 공업 화재에 놓는 화학 드럼 — 단계 4), `'cng'`(`vehicle && bus && !skin` — 일반 교통사고의 버스만), `'jet'`(`skin 'fuselageMid'`). 보통 승용차·트럭·열차 객차는 용기가 아니다.
- **조짐** `SignBelief.kind`: `struct`(1~3: 소리·눈·굉음) · `bldg`(2·3: 바깥벽) · `gas`(1~3: **측정기** `gasMeter` 또는 냄새) · `vessel`(2 눈·3 안전밸브 소리) · `fire`(롤오버 — 선택) · `dust`(선택) · `event`(현장 전원). 열화상은 불타는 구획의 구조 조짐 문턱을 바꾼다.
- **지휘**[설계]: `DANGER_RULES`(믿음 → 단계 0~3), `OpsState.mode` `interior`·`defensive`·`rubble`, 전원 철수(`evacuate`)·인원 점검, 외부 방어, 제한적 구조 진입(`w.risky`), 재진입 조건, 막는 조치(보강·냉각·차단), 관제 상황 보고(`sitrep` → `I.fieldRisk`), 도시가스 공급 차단 요청, 추가 부대 요청.
- **신고의 위험 진술을 현장에 넘긴다**(§3.6): 신고 내용의 `hazard` 주장 `'unstable'` → `sign bldg 1`, 가스 누출 유형의 `'gas'` → `sign gas 1`.
- **지도**: `Sim.placeMarks`(`scorched`·`blasted`·`partial`·`burnt`·`collapsed`) — `c.struct` 현장이고 `placeId ≥ 0` 인 것만. `collapsed`·`burnt` 건물은 그 교대에 새 사건이 나지 않는다(`pickPlace`·`createIncident` 의 지정 건물·은신처 후보).
- 문제 코드 다섯: `DANGER_SIGN`·`WITHDRAWAL`·`STRUCT_COLLAPSE`·`EXPLOSION`·`BURNOUT`.
- **선택 단계(9)**: 분진 폭발(화재·붕괴 유형이고 `placeKind` 가 `factory`·`warehouse`·`storage`·`workshop` — `catinit.chance(min(0.9, 0.25 × hazardMul))`), 플래시오버. "시간이 모자라면 빼도 완료 조건에 영향이 없다" — **들어올지 모른다**.
- X6 준비 작업자의 균형 경고(ROADMAP): 가스 용기는 새 규칙의 열 기준으로 보통에서 거의 터지지 않는다 · `collapse/gasblast` 는 방치해도 폭발 농도 구름이 생기지 않는다 · 화재 다섯에 하나는 닫힐 때 붕괴 임박 구획이 남는다.

### 1.5 R2 — 방법 목록 전부 [설계] (`MethodId`, `field/methods.ts` 의 `METHOD`)

| 임무 (`WorkKind`) | 방법 (굵게 = 지금의 방법 = `plain`, *기울임* = 기록 전용 `record`) | 장비·조건 요지 |
|---|---|---|
| `waterRescue` | `hand` 손 뻗기 · `pole` 장대 · `ring` 구명환 · **`rope` 구명줄** · `improvise` 즉석 부력물 · `catch` 하류 차단 · `swim` 헤엄 · `tend` 줄 확보 · `boat` 보트 · *`hoist`*(R1 호이스트) | reach(뭍에서의 거리) 1.2/2.0/2.8/3.6, `swimOf ≥ 0.35`, 보트 = `raft` 또는 구조정 부대, 안벽 `s.quay`, 물살 `s.flow` |
| `force`·`clear` | `kick` · **`irons`** · `ram` 충격기 · `hydraulic` 유압 개방기 · **`handClear`** · **`toolClear`** · `charge` 폭파 진입(사용자 결정) | `charge` 는 장약(`breacher`·`bombTech`), 잠긴 문·문을 막은 잔해, 2.5칸 안에 믿음 속 사람 없음. 세계 규칙 "농성 문 잠금"(`rules/methods.ts`)이 무장 현장에 잠긴 문을 만든다 |
| `extricate` | (차량) `manual` · **`basic`** · **`spread`** · `roof` 지붕 절단 · `rapid` 급박 구출 / (붕괴) `tunnel` 손으로 파기 · `airbag` · `shore` 지지대 먼저 / (구덩이·그 밖) `haul` 줄로 끌어올리기 | `roof` = `spreader` 든 동료 둘, `rapid` = 누출·불·연기, `shore` = 균열(`haz` 의 `sub 'crack'`), **`haul` = 믿음 `pit` — `casFact` 가 대상 칸의 `roadDebris` 소품 `skin === 'manhole'` 으로 채운다** |
| `search` | **`call`**(실내·붕괴) · `listen` 청음(`searchKit`, `s.kind === 'collapse'`) · **`line`**(야외 `s.kind === 'search'`) · `hail` 확성기 · `thermal` 열화상(밤·나무 30%) · (7단계 선택) *`air`* · `drone` · `dog` | `drone`·`dog` 는 장비·부대가 없어 켜지지 않는다 |
| `suppress` | **`interior`** · `defensive` 외부 방어 · `aerial` 고가 사다리 방수(`needUnit ladder`, 창) · `extinguisher` 소화기(순찰 팀장·구급 운전원·기관원·경계 요원) · `ventilate` 배연(`fan`) | 선택 임무(null 이면 지금 코드) |
| `engage`·`arrest` | 새로 고르는 것 둘: `beanbag` 비살상탄 · `sniper` 결정적 저격 / 기록 전용: *`chase`·`breach`·`bang`·`tackle`·`cover`·`taser`·`shield`* | `sniper` = 인질을 잡은 채 교전 중이거나 협상 60초 넘게 대치 |
| `treat`·`load` | **`stay`** · `rush` 즉시 이송 · *`airlift`* | `rush` = 믿음 band 2 + 남은 자리 |
| `mitigate`·`perimeter` | **`seal`** · `ventFirst` 환기 후 차단 · **`cordon`** · `announce` 대피 방송(`megaphone`, 가스 현장) | `haz` 사실의 `sub: 'crack' \| 'valve' \| 'fuel'` |

- 새 장비 아홉(`KitId` 끝): `pole`·`pfd`·`drysuit`·`raft`·`extinguisher`·`fan`·`airbag`·`shoring`·`beanbag`(고장 추첨은 따로 `kit-r2` 흐름).
- `WORK_MODE`: `chooseMethod` 가 null 일 때의 갈래 — `waterRescue` 는 **맡지 않는다**(R3 가 `defuse` 를 같은 갈래로), `suppress`·`engage`·`load` 는 선택 임무, 나머지는 맨몸 방법이 늘 남는다.
- `WorkKind` 는 늘리지 않는다. 새 `TaskKind 'ashore'`, 문제 코드 `METHOD_FAIL`, `Incident.methods`(`MethodUse[]`), `ShiftReport.methods`, `sweep --methods`.
- 판단부 `methods.ts` 는 믿음·생김새만 읽는다(금지어: `s.props`·`s.casualties`·`s.hostiles`·`.truth`·`s.fire[`·`s.smoke[`·`sim.scenes`·**`s.variant`**·`.fault`).
- 하지 않는다고 적은 것: 잠수·얕은 물 걸어 들어가기(격자에 깊이가 없다), 사다리·창문 구조(`aerial` 의 대원은 조작대에서 방수만), 이송·교통 통제의 방법(R3 로).

### 1.6 R3 — 교본 줄 [설계]

- 틀: `registerDoctrine(rule)` — 줄은 `who`(부서·분야·역할·묶음·부대) × `kits`/`noKits` × `when(DocCtx)` → `effect`(`fitMul`·`fitAdd`·`duty`·`act`·`methodMul`·`block`·`choose`). 걸리는 자리 `DocHook`: `fit`·`duty`·`act`·`method`·`gate`·`cmd`·`dispatch`·`chase`.
- **상황 입력 `DocSit`**: `kind: IncidentType`, `label`(관제의 이름표 — 변형의 진실이 아니다), `phase`(`arrive`·`sizeup`·`standoff`·`entry`·`assault`·`interior`·`care`·`transport`·`traffic`·`withdraw`·`idle`), `hot`·`outdoor`·`secure`, `threat`, `civAtRisk`, `inHazard`, `victimInside`, `danger`(X6), `liveBomb`, `defusing`, `patients`, `seatsLeft`, `negotSec`, `entryOrdered`, `lanes2nd`.
- 분야별 등록 수(§3 읽는 법): 경찰 16 + 지휘·관제 7, 소방 14 + 8, 의료 13 + 5, 특수 16 + 5, 공통 G01~G08.
  - 경찰 P01~P22: 테이저 먼저·흉기 거리 유지(혼자면 3칸에서 20초)·동시 덮침, 엄폐 사격, 혼자 방 진입 금지, 재보급·엄폐·재장전, 중상이면 가벼운 일, 섬광탄 아끼기, 무장 현장 수색은 짝과, 추격 역할(P18·P19), 차량 차단(P20).
  - 소방 F01~F19: 공기 탈출(30%)·짝 따라 나가기·공기 50% 미만이면 실내 일 0·짝 없이 실내 금지·2인 대기조·벽 더듬기·끊어 쏘기·예비 펌프 수·빠른 물살에 구명조끼 없이 헤엄 금지·방화복 없으면 한 단계 먼저.
  - 의료 E01~E20: **분류부터**(대기 환자 ≥ 4 또는 관제 이름표가 다수 사상자 시나리오 → `WorkKind 'triage'`), 제세동기 유무에 따른 `stay`/`rush`, 경계 밖 처치소, 처치 중인 환자는 들지 않는다, 자리 하나에 둘이면 중증 먼저, 항공 이송 검토, 차로 위 처치 금지, 척추 고정(교통·붕괴 `s.kind`), 끌기.
  - 특수 S01~S26: 방패 줄 서기, 저격수는 진입조 밖, 로봇 먼저·방호복·맨몸 해체, 해체 중 6칸 비우기, 측정기 든 대원이 가스 수색 먼저, 화학 팀장은 밖 대기조, 구조정은 보트 `×1.3`·바다에서 헤엄 금지, 호이스트가 열려 있으면 헤엄 `×0.5`, 사다리 조작원은 고가 방수 먼저, 폭파 진입은 인질 위치를 모르면 쓰지 않는다(S26).
- 지휘 줄 CP1~CP4·CF1~CF7·CE1~CE5·CS1·CS2, 관제 줄 D1~D7(D1 가스 누출엔 화학 구조차 +30, D2 처리반을 진입조로 보내지 않는다, D3 흉기 신고, D4 높은 건물 화재엔 사다리차, D5 바닷가 아닌 수난엔 구조 공작차, D7 추격 역할).
- 새 임무: `TaskKind 'cover'·'rearm'·'airOut'·'pairOut'·'pair'`, `WorkKind 'triage'`. 방법 행 열 개: `feel`·`pulse`·`pack`·`drag`·`litter`·`post`·`blockLane`·`robotDefuse`·`suitDefuse`·`bareDefuse`.
- 바탕: 탄약(`KitDef.mag`·`reload`·`perShot`, `Unit.ammoBox`), 엄폐 자리(`coverSpot`), 짝(`PAIRS`·`buddyOf`), 자기 신고 사실 `crew`, 동요 `a.shaken`.

### 1.7 I1-b — 신호·인과 규칙·세계 상태 [설계] (I1-a 측정 도구는 [코드])

- **세계 상태 `sim.world`**: 동네 18곳(`cityPlan.DISTRICTS` 순서)의 `ZoneState` — `power`·`comms`·`water`(1 정상 … 0), `smoke`·`risk`(0 … 1), 칸마다 `until`·`known`·`cause`. 병원 `HospitalState`(`cap`·`stays`·`divert`). 건물 상태는 두지 않고 `placeState(sim, placeId)` 로 X6 의 `placeMarks` → I2 의 겹침 표를 읽는다.
- **신호** `SignalKind`: `blast` · `collapse` · `fireBig`(불 칸 30 초과) · `delivered`(병원 인계) · `fled`(총 든 도주) · `closed` · `catastrophe`(X6: 0 폭발·1 붕괴·2 전소). 상태를 바꾸는 그 자리에서 `signal(sim, kind, { inc, ev, … })`.
- **규칙의 틀** `registerConsequence({ id, label, on, key, cooldown, cap, spawns, test, apply })`, 사건을 만드는 유일한 길 `spawnConsequence(sim, c, opts, delay, when?, wait)`, 규칙 파일 `src/sim/world/rules/{record,hospital,structure,infra,spread}.ts`(import 순서 = 결과).
- **조건부 연쇄**: `gen.chain` 항목에 `when?`·`until?`. 깊이 상한 `DEPTH_MAX 3`(기존 연쇄에도), 규칙이 만드는 사건 교대당 6(`CSQ_SPAWN_CAP`), 교대 끝 150초 전부터 금지, `maxConcurrent` 넘으면 버림(`gen.dropped`).
- **첫 규칙**:

| # | id | 원인 → 결과 | 만들거나 쓰는 시나리오 |
|---|---|---|---|
| C6 | `divertRecord` | 전환·부족 → 지연 기록 | — |
| C3 | `hospitalLoad` | 다수 인계 → 응급실 포화(`cap` 6·8, 체류 300초) → 먼 병원·이송 중 목적지 변경, `HOSPITAL_FULL` | — |
| C2 | `rubbleRoad` | 붕괴·큰 폭발 → 사건 뒤에도 남는 잔해 장애물(`ObstacleKind 'rubble'`) | — |
| C9 | `rekindle` | 잔불을 남기고 닫힌 화재 → 재발화 | `fire/std`(같은 건물) |
| C10 | `suspectZone` | 무장 도주 → 구역 위험·근처 재범 | 기존 재범 연쇄(`ARMED_BIAS.robbery` 종류 건물) |
| C1 | `blastSpread` | 폭발 → 반경 안 건물 화재 | `fire/std` |
| C5 | `smokePlume` | 큰 화재 → 동네 연기 → 호흡 곤란 신고 | `medical/faint` — "**(확인 필요: 연기 흡입 전용 변형을 `scenarios/life.ts` 에 둘지)**" |
| C4 | `powerOut` | 변전소·발전소 사고·태풍·지진 → 구역 정전 → 신호 고장·승강기 갇힘·교차로 사고 | `collapse/elevator`('정전으로 승강기가 멈췄습니다'), `traffic/std`('신호등이 꺼진 교차로…'). (가) 갈래는 "평소에는 거의 나오지 않는다" — 변전소는 `INCIDENT_PLACES` 에 `hazmat 2` 뿐, 발전소 `fire 1`·`hazmat 2.5` |
| C8 | `commsDown` | 방송국·관제탑 사고·긴 정전·지진 → 무전 음영 | (`tower` 에는 어떤 유형 몫도 없다, `broadcast` 는 화재 0.5·무장 1) |
| C7 | `floodLow` | 홍수 수위 ≥ 0.55 → 저지대 지하 공간·지하차도 | `collapse/elevator`('지하 주차장이 잠기며 승강기에…'), `water/std`('물에 잠긴 지하차도에 차가 갇혔습니다') |
| C11 | `waterMain`(선택) | 붕괴·지진 → 동네 `water = 0.5` → 소화전 수압 저하 | — (사건이 아니라 구역 상태) |
| C12 | `stormPileup`(선택) | 태풍·홍수 + 막힌 간선 → 다중 추돌 | `traffic/pileup` |

- 새 문제 코드 `HOSPITAL_FULL`·`INFRA_FAIL`, 기록 꼬리표 `WorldTag`(`power`·`comms`·`water`·`smoke`·`risk`·`hospital`), 관제가 아는 길 `knownZone`·`knownHospital`·`knownBuildingAt(sim, node, placeKind?)`·`knownZoneOfIncident`.
- I1-a 의 시스템 14가지(`SYSTEMS`: call·dispatch·field·road·hospital·hazard·building·crew·equip·infra·other·aid·disaster·carry), 문제 코드 → 시스템 표 `PROBLEM_SYS`, 문구 규칙 `PHRASE` T1~T8, 관문(연쇄 깊이 ≤ 4 → I1-b 뒤 3, 교대당 연쇄 ≤ 8, 일치 검사 C1~C5 = 0, 교착 후보·잊힌 사건 0).

### 1.8 I2 — 교대 간 지속 [설계]

- `Carryover`(JSON): 대원(체력·부상·결장 `outShifts`·경험·숙련), 장비(펌프·정비·섬광탄 창고·개인 장비 고장), **건물**(`state` marked/closed/ruin, `dmg`·`soot`·`repair`), **도로**(`why` crack·washout·flood·fire·mud·tree·surface·debris, 전면/한 차로, `left`·`openAt`). `new Sim(seed, d, len, { carry })`.
- "쓸 수 있는 건물" 판정 `placeUsable(sim, id, allowClosed = false, inShift = true)` 하나 — `pickPlace`·`createIncident` 의 지정 건물·은신처·재난의 장소 고르기·연쇄 방화의 다음 대상이 모두 이것을 부른다. 현장에는 `applyPlaceWear` 로 `s.wear`.
- 하지 않는 것: 병원 수용·기반 시설의 교대 간 지속, 교통 장애물, 차량 손상, 조직 기억(K2), 날짜·날씨의 흐름.

---

## 2. 새 사건마다 채워야 하는 칸 (점검표)

"어디"의 이름은 [설계]인 것이 많다 — 구현 전에 그 묶음의 구현 메모에서 실제 이름을 확인한다. `CLAUDE.md` "자주 하는 확장" 표의 절차(새 사건 유형·새 시나리오·새 임무·새 문제 코드·새 타일/소품)는 그대로이고, 아래는 **일곱 묶음이 그 위에 더하는 칸**이다.

### 2.1 새 시나리오(변형)마다 — 유형은 그대로

| # | 칸 | 누가 요구 | 어디 | 비우면 |
|---|---|---|---|---|
| A1 | 처음 다친 원인 | H1 | `injury.ts` `initialCause` 의 변형 줄(변형을 유형보다 먼저 본다). 지금: 물속 → drown, `traffic/manhole` → fall, `traffic/tree` → crush, `medical/trauma` → blunt, `collapse/gasblast` → blast, 차 안·교통 → vehicle, 유형 기본값 | 유형 기본값이 붙는다(예: 화재 유형의 추락 환자가 '연기 흡입') |
| A2 | 사건 중 새 피해 | H1 | 피해를 주는 세계 규칙(`rules/<묶음>.ts`)이 `hurtCas`·`hurtResponder`·`hurtHostile` 만 부른다(원인·`{ ev }`). 확률은 `injuryRng(sim, s, '<목적>')` 새 목적 이름으로. 체력을 직접 깎지 않는다 | 부상 장부·사망 원인·보고서 집계에서 빠진다(H1 시험의 "장부" 확인에 걸릴 수 있다 — 확인 못 함) |
| A3 | 실제 건물인가 | X6 | 건물이 아닌 변형(터널·지하철 승강장·다리·배·탱크로리가 선 도로·공사장 골조 등)은 `catastrophe.ts` 의 `NO_STRUCT` 에 넣거나 `s.outdoor` 로 만든다 | 활주로·부두·숲에 '전소'·'붕괴' 표시가 남고, `pickPlace` 가 그 터를 교대 끝까지 빼고, I2 가 다음 교대에 출입 통제로 이어받는다 |
| A4 | 터지는 것·새는 것 | X6 | 열 받으면 터지는 소품은 `Prop.vessel`(지금 `cylinder`·`drum`·`cng`·`jet`)과 `VESSEL_HEAT` 줄, G5 `FxInfo['src']`. 가스가 차는 현장은 밸브 소품 + `s.rules = ['gas']`. 새 용기 종류(예: 탱크로리)는 `Prop['vessel']` 합집합 끝에 새 줄 | 불 곁의 탱크가 영영 안 터지거나, 지금의 "닿으면 즉시" 규칙으로 돌아간다 |
| A5 | 분진 구획 | X6 (선택 단계) | `placeKind` 가 `factory`·`warehouse`·`storage`·`workshop` 이고 유형이 화재·붕괴일 때만 | 공장 폭발 시나리오가 다른 유형이면 분진이 생기지 않는다 |
| A6 | 신고의 위험 진술 | X6 §3.6 | 시나리오 `texts` 의 `hazard` 주장(`'unstable'`·`'gas'`)이 `briefFacts` 로 미확인 조짐이 된다 | 지휘관이 도착 전 위험을 모른다(의도일 수 있다) |
| A7 | 방법이 읽는 믿음 칸 | R2 | 방법의 `can` 은 `s.variant` 를 못 읽는다. 새 상황은 믿음으로 드러나야 한다 — `CasBelief` 의 `water`·`drift`·`veh`·`pit`, `haz` 의 `sub`. 예: 깊은 곳(우물·굴착·싱크홀)의 `haul` 은 `casFact` 가 `pit` 을 채우는 조건(지금은 `roadDebris` + `skin 'manhole'` 하나)에 그 소품을 더해야 나온다 | 새 현장에서 방법이 평소 것 하나로만 나온다 |
| A8 | 물가의 생김새 | R2 | 높은 안벽이면 `s.quay`(세계 규칙 `rules/methods.ts` 가 처음 한 번 정한다), 물살 `s.flow` | 안벽에서 '손 뻗기'가 늘 1등이 된다(R2 §4.1 — 선박 화재가 크게 쉬워진다고 적혀 있다) |
| A9 | 교본의 이름표 조건 | R3 | 줄의 `when` 은 `sit.kind`·`sit.label`(관제 이름표)·생김새만 본다. 다수 사상자 시나리오면 E01(분류부터)의 이름표 목록에, 살아 있는 장치가 있으면 `haz bomb` 믿음으로 | 새 다수 사상자 사건에서 분류가 "환자 ≥ 4"를 본 뒤에야 걸린다. **이름표 목록의 정확한 자리는 확인 못 함**(R3 §3.3 E01·§6.1 CE1) |
| A10 | 관제 교본 | R3 §6.2 | `dispatch/doctrine.ts` 의 `docNeeds`·`dispatchPref` 는 평가 유형·통화 주장으로 건다(D1 hazmat, D3 흉기, D4 높은 건물) | 새 시나리오에 전문 부대가 우선되지 않는다 |
| A11 | 이어지는 사건 | I1-b · Z1 | 조건 없는 예약은 지금처럼 `gen.chain.push` + `chain.canChain(sim, 부모)`. 조건이 있으면 `when`·`until`, 세계 상태가 원인이면 `registerConsequence` + `spawnConsequence`(자기 파일 — 예: `world/rules/kinds.ts`, **import 순서가 결과**). `opts.cause`·`opts.csq` 를 넘긴다 | 원인 사슬이 끊겨 측정 도구의 연쇄·시스템 지표에 안 잡힌다. 상한을 안 보면 관문 M-G(교대당 연쇄 ≤ 8)에 걸린다 |
| A12 | 신호 | I1-b | 현장 밖에 영향이 있을 큰 일(폭발·붕괴·큰 불)은 그 자리에서 `signal()`. X6 의 함수(`explodeGas` 등)를 거치면 `catastrophe` 가 저절로 나간다. 새 종류의 일(정전을 부르는 전선 사고, 수도관 파열)은 `SignalKind` 합집합에 새 줄이 필요할 수 있다 | C1·C2·C4·C8 이 새 사건을 원인으로 보지 못한다 |
| A13 | 기록 문구·문제 코드 | I1-a(코드) | 새 문제 코드는 `scripts/metrics.ts` `PROBLEM_SYS`(없으면 조용히 `field`)와 `tests/causality.test.ts`("모든 코드에 시스템이 있다"). 지원 요청·이송 출발·병원 인계·출동 지령 문구를 바꾸지 않는다(T1~T8) | `sysOf` 가 조용히 field 로 센다 / 일치 검사 C5 가 깨진다 |
| A14 | 건물이 남기는 것 | I2 §3.6 | `placeOutcome` 표는 `s.kind`(fire·collapse)·변형(`gasblast`, 승강기 제외)·문제 기록 끝말('2차 붕괴'·'천장 일부 붕괴')로 건물 상태를 정한다. 새 변형이 건물을 망가뜨리면 줄을 더하거나 X6 의 `placeMarks` 를 거친다. 열린 터(`q.open`)는 `marked` 만 | 다음 교대에 흔적이 없다 / 승강기 갇힘 같은 가벼운 변형이 '붕괴 건물'로 이어받는다 |
| A15 | 도로가 남기는 것 | I2 §3.5 | `roadsNext` 는 변형 이름으로 건다 — `landslide`(mud)·`tree`·`pileup`(surface). 길을 막는 새 변형(싱크홀·수도관 파열·끊어진 전선·터널 사고)은 `why` 와 줄을 더한다. 통제는 `I.blockedEdge` 로 찾는다 | "파손 도로는 수리될 때까지"(I2 머리말의 사용자 의견)가 새 사건에 적용되지 않는다 |
| A16 | 장소 고르기 | X6 · I2 | 시나리오가 자기 `node`·`places`·`onClose` 에서 건물을 직접 고르면 `placeUsable`(I2 뒤. X6 뒤에는 `placeMarks` 의 `collapsed`·`burnt` 제외)을 부른다 | 무너진 건물에서 새 사건이 난다 |
| A17 | 헬기 | R1 | 상공 임무가 있는 현장이면 `crews.isHovering`·`dispatcher.airFit`·`airDecide.watchBusy`(한가함 판정)·지휘관의 `hoist`/`airDrop` 취소 규칙 | 헬기가 떠나지 않거나, 열린 `hoist` 가 `canClose` 를 막는다(CLAUDE.md 함정) |
| A18 | 끝나는가 | 공통 | `--force 유형/변형` 20교대에서 한계 시간·방치 ≤ 2. 7)번 블록(대원이 남지 않은 현장)·경찰 한 팀(22초 뒤 요청)·`needFor` 로 끝나는지 | README §3: 못 고치면 `share: 0` |

### 2.2 새 유형(`IncidentType`)마다 — 2.1 에 더해

| # | 칸 | 누가 | 어디 | 메모 |
|---|---|---|---|---|
| B1 | 신고 가능도의 열 수 | 코드 | `analyst.ts` `TYPES`(8개), `callSystem.NATURE_LIK` 의 열, **모든 시나리오의 `lik` 8열**(`scenarios/*.ts`), `Assessment.probs: Record<IncidentType, number>` | `tests/sim.test.ts:363` 이 `NATURE_LIK[k].length` **`toBe(8)`** 로 박아 두었다 — `tests/sim.test.ts` 는 "절대 건드리지 않는 것"이라 N8 설계서가 **따로 허락**해야 한다 |
| B2 | 사건 장소 | 코드 | `cityPlan.ts` `INCIDENT_PLACES: Record<IncidentType, W>` — 키가 빠지면 컴파일 오류 | `cityPlan.ts` 도 "절대 건드리지 않는 것" — 따로 허락이 필요하다. 지도를 바꾸면 모든 결과가 바뀐다 |
| B3 | 한계 시간·대응 기준 | 코드 | `sceneManager.ts` `LIMIT`, `debrief.ts` `RESP_LIMIT`, `view/renderCity.ts` `RESP_LIMIT`·`TYPE_COLOR`, `util.ts` `TYPE_NAME`, `icons.ts`, `panels.tsx` 확률 목록 | 지금 값: LIMIT fire 430 · traffic 400 · search 470 · armed 400 · medical 300 · collapse 470 · hazmat 430 · water 380 |
| B4 | 처음 원인의 기본값 | H1 | `initialCause` 의 `switch (type)` — **`default` 갈래가 무장 유형을 가정한다**(`shooter`·`robbery` → gunshot, 그 밖 → blunt). 새 유형은 `case` 를 더하지 않으면 '타박상'이 붙는다 | [코드] `src/sim/field/injury.ts:290` |
| B5 | 연기·가스의 원인 | H1 | `smokeCause(s)`: `s.kind === 'hazmat'` 또는 `s.rules` 에 `gas` 면 toxic. 유독 물질이 있는 새 유형은 여기에 | 화학 사고 환자가 '연기 흡입'으로 적힌다 |
| B6 | 위험한 건물인가 | R1(코드) · R3 | `agents.ts` `fireRisk`: `s.kind === 'fire' ‖ 'hazmat' ‖ 'collapse'` 의 실내 일은 scba 대원만. R3 의 `sit.inHazard`·"위험 실내 일"·짝 규칙(F04·F05)·공기 줄이 같은 범위를 쓴다 | 새 유형을 넣을지 정한다(CLAUDE.md 함정에도 있다) |
| B7 | 구조 규칙의 처음 값 | X6 | `catOf`: `s.kind === 'collapse'` 면 잔해 구획의 `integ` 를 낮게 시작(`INIT_COLLAPSE − INIT_SEV × severity`), 지진 흔들림도 붕괴 유형은 −0.18 | 구조물 사고 유형을 새로 두면 같은 처리를 정한다 |
| B8 | 방법이 갈리는 생김새 | R2 | `METHOD` 의 `can` 이 `s.kind` 로 가르는 곳: `listen`(`collapse`), `line`·`hail`·`thermal`(`search`), 붕괴 구출 갈래(`collapse`), 무장 현장의 `quiet`(`armed`), 농성 문 잠금(`armed`) | 새 유형에서는 그 방법이 나오지 않는다 — 조건에 유형을 더하거나 생김새(`s.rules`·구역 종류)로 다시 쓴다 |
| B9 | 교본 | R3 | `DocSit.kind` 로 거는 줄(E13 척추 고정 = 교통·붕괴, 무장 `hot`, 가스 D1·S10·CF5 = hazmat), 국면 `phaseOf`, 단계별 강제 묶음(§8.3 의 `--force` 목록). 분야마다 12줄 넘게라는 시험이 있다 | 새 유형에 걸리는 교본 줄이 0 이면 "분야별 대응"이 그 유형에서 사라진다 |
| B10 | 헬기 수요 | R1(코드) | `dispatcher.airFit`: 경찰 헬기는 수색 수요(추격전·무장·실종, 수난·붕괴·화재는 절반), 소방 헬기는 수색·구조, 의료 헬기는 낮의 구급 | 새 유형의 수요 열쇠(`Needs`)가 어느 헬기로 가는지 정한다 |
| B11 | 선착 대응·공동 대응 | 코드 | `dispatcher.firstResponder`(중증 응급에 소방 선착), `CO_RESPOND`, `priorityOf` | — |
| B12 | 정전·홍수·연기의 2차 사건 후보 | I1-b | C4·C5·C7 의 건물 종류 목록과 `ARMED_BIAS` | 새 유형을 2차 사건으로 쓰려면 I1-b 규칙을 고친다(I1 의 파일 — 공용 수정으로 적는다) |
| B13 | 건물·도로가 남기는 것 | I2 | A14·A15 와 같다 — `s.kind` 로 거는 줄 | — |
| B14 | 화면 | G4·H1·X6 | `view/hazardState.ts`(핀·칩), `HazardStrip`, 범례, H1 의 `PersonCard`·중증도 색, X6 의 `catLayer` | 새 유형의 상태가 카드·지도에 안 보인다 |

참고(규모): 가스 누출·붕괴 유형을 넣은 커밋 `78ad889` 는 파일 21개를 고쳤다(396줄 추가). 지금 `'hazmat'` 을 글자로 다루는 소스 파일은 24개(50곳)다.

### 2.3 새 임무(`WorkKind`)마다

| 칸 | 누가 | 어디 |
|---|---|---|
| 이름·자격·실행·지휘 | CLAUDE.md | `types.ts` → `agents.workLabel`(Record)·`fitFor`(`fitBase` 의 switch) → `executor` case → `commander.want`·`needFor` → `crews.capableOf` |
| 다친 대원이 맡는가 | H1 | `LIGHT_WORK` 에 넣을지(위험 구역 밖의 일만) |
| 위험 구역에서 허락되는가 | X6 | 단계 2·3 구역의 "허락된 일"(`w.risky`), 철수 때 놓는 일 |
| 방법 | R2 | `METHOD.work`·`WORK_MODE` 의 갈래(맨몸 방법이 늘 남는가 / null 이면 맡지 않는가 / 선택 임무), `SAY`, 보고서의 `WORK_DONE` 말, `targetKey`. `MethodId` 를 늘리면 `METHOD` 가 `Record` 라 컴파일이 줄을 강제한다 |
| 교본 | R3 | `fit` 줄의 `works`, 짝 규칙(`SOLO_OK`), 판단 지점 `DocGateId`, 측정의 열쇠 `분야\|국면\|임무` |
| 측정 | I1-a(코드) | `scripts/metrics.ts` `PURPOSE`(같은 목적의 다른 작업 — 지금 `negotiate·engage·arrest → subdue`, `carry·escort → move`): 대체 방법 지표 `alt` 가 읽는다 |
| 낡은 믿음·강제 보고 | CLAUDE.md | 이미 끝나 있으면 `reportDone`, 지휘관의 `cancel`, 실패 기억 `failedAt` |

### 2.4 새 부대·역할·장비를 더한다면 (R2 가 예약만 한 탐지견·드론 등)

- `UNIT_DEFS` 는 **끝에**(처음 20줄 순서가 옛 대원의 능력 난수), 역할의 기본 장비도 **끝에**(장비 순서가 고장 추첨 순서), 새 자리는 `STAFF` 끝에.
- R2 의 고장 추첨은 `kit-r2` 로 따로 뽑는다 — 고장 나는 새 장비는 같은 방식(`batch`)으로 R1 의 `kit` 흐름을 밀지 않게 한다(추측: `batch 'n8'` 같은 새 묶음이 필요하다. R2 의 `batch?: 'r2'` 는 한 값짜리 합집합이다).
- R3 `PAIRS`(역할 쌍)·`docDeptOf`(역할 → 교본 분야), I2 의 명부 이어받기(이름이 열쇠), `tests/crews.test.ts` "능력과 장비가 어긋나지 않는다".
- 지도·목록 기호 `view/marks.ts`·범례 — 글자 표식 금지.

---

## 3. 이미 다른 묶음이 가져간 것, 그리고 선

### 3.1 가져간 것

| 주제 | 주인 | 내용 | N8 이 할 수 있는 것 |
|---|---|---|---|
| 헤엄·보트·장대·구명환·하류 차단·줄 확보 | R2 §4.1 | 수난 구조의 방법 전부. 잠수·얕은 물 걷기는 "격자에 깊이가 없어" 하지 않는다 | 그 방법들이 나올 **물 현장**(안벽·급류·넓은 물·바다)을 만든다. 방법 표는 건드리지 않는다 |
| 소화기·배연·외부 방어·고가 방수 | R2 §4.5 · X6 §5.5 | 진압의 방법과 전술 모드 | 소화기로 끝나는 **작은 불**(차량·쓰레기·주방)의 시나리오 |
| 비살상탄·저격·테이저·방패·폭파 진입·농성 문 잠금 | R2 §4.6·§4.2a · R1 | 무장 대응의 수단 | 그 수단이 고를 조건이 되는 사건(흉기 난동·옥상 총격·농성) |
| 청음·확성기·열화상 수색 | R2 §4.4 | `listen`·`hail`·`thermal` | — |
| **탐지견·드론** | R2 §4.9 — 이름만 예약(`dog`·`drone`), "부대·장비가 생기면" | 주인이 없다 | N8/N9 이 부대·장비를 만들면 R2 의 행을 켠다(사용자 답 ⑥ "구조대 전문 장비"와 닿는다) — **제안** |
| 급박 구출·에어백·지지대·줄로 끌어올리기 | R2 §4.3 | 구출의 방법 | 깊은 곳·끼임·깔림 사건에서 `pit`·`crack` 믿음이 서게 현장을 만든다(A7) |
| 벽 더듬기·끊어 쏘기·끌기·차량 차단·로봇/방호복/맨몸 해체 | R3 §3.7 | 방법 행 열 개 | — |
| 다수 사상자 **분류**(`triage`) | R3 E01·CE1 | 대기 환자 ≥ 4 | 환자 다발 사건(식중독·가스 중독·압사)을 만든다. 현장 분류소 "자리"는 R3 에 없다(임무만) |
| 탄약·엄폐·짝·공기 탈출 | R3 | 바탕 | — |
| 실제 붕괴·가스 폭발·용기 폭발·전소, 조짐·철수 | X6 | — | 새 용기 종류와 새 현장을 X6 의 틀에 넣는다(A3·A4) |
| **분진 폭발·플래시오버** | X6 §4.5·§4.7 (선택 9단계) | 공장·창고·저장소·공방의 화재·붕괴 | "공장 폭발"은 X6 의 것을 쓰는 시나리오로. 9단계가 빠졌으면 N8 이 그 자리를 채울지 **X6 구현 메모를 보고** 정한다 |
| 도시가스 공급 차단 요청 | X6 §2.3·§5.9 | 관제 요청 | — |
| 주변 건물 대피 | **아무도 안 가져갔다** — X6 §5.9 "주변 건물 대피는 모델하지 않는다(C4 몫)". R2 의 `announce` 는 출입구로 다가오는 시민 확률만 줄인다 | — | 폭파 협박·가스·군중 사건의 대피 유도(`escort` 확장)는 N8 후보 — **제안** |
| 응급실 포화·병상 | I1-b C3 (교대 안) | P2 "병원 수용 능력"의 교대 안 몫 | 환자 다발 사건이 C3 의 원천이 된다. 병원 자체는 건드리지 않는다 |
| 정전 → 승강기·교차로 사고 | I1-b C4 | `collapse/elevator`·`traffic/std` 를 만든다 | 원천(변전소·전선 사고)을 평소에도 나오게 하는 시나리오 |
| 큰 불의 연기 → 호흡 곤란 | I1-b C5 | `medical/faint` 로 대신 | **연기 흡입 전용 변형**을 N8 이 만들고 C5 의 한 줄을 바꾼다(I1 이 "확인 필요"로 남긴 것) — **제안** |
| **지하차도·지하 주차장 침수** | I1-b C7 (홍수 재난일 때만) | `water/std`·`collapse/elevator` 에 문구만 | 사용자 답 ⑤ "지하차도 침수"와 겹친다. N8 이 전용 변형(차 안에 갇힌 사람 + 차오르는 물)을 만들고, C7 이 그 변형을 가리키게 한 줄을 바꾼다 — **제안** |
| 수도관 파손 | I1-b C11 (선택) — 구역 상태 `water` | 사건이 아니다 | "수도관 파열" 사건(도로 침수·싱크홀)을 만들고 그 사건이 구역 `water` 를 낮추는 신호를 보낸다 — **제안**(C11 이 안 들어왔으면 신호만) |
| 비바람 속 다중 추돌 | I1-b C12 (선택) | `traffic/pileup` | — |
| 도주 용의자의 재범·구역 위험 | I1-b C10 · Z1 `chain.ts` | — | 날치기·차량 절도의 추격은 기존 `pursuit.ts` 위에 |
| 건물·도로·대원·장비의 교대 간 지속, K1 | I2 | — | A14·A15 의 줄만 더한다 |
| 사다리차의 **창문 구조**, **3층 이상** | ROADMAP C4 에 남아 있다(R2·R3 모두 하지 않는다고 명시) | — | 아래 3.2 |
| 건물 전체 수색 계획 | ROADMAP C5 — 아무도 안 가져갔다 | — | 넘긴다 |
| 큰 시설의 전용 현장(학교·병원·공항 터미널), 지도 외곽 = 평면 | ROADMAP M2 (2)(3) | — | 아래 3.2 |
| 붕괴 탐지(청음) | R2 `listen` 이 가져감. 탐지견은 예약만 | C4 의 "청음·탐지견" | — |
| 장시간 매몰자 상태 변화 | 이미 있다 — B1b `tickCrush`(압궤 증후군) | — | — |
| 가스 환기 | R2 `ventFirst`·`s.fan` + X6 가스 모델. **바람 방향은 아무도 안 가져갔다** | — | 야외 누출(탱크로리)에서 바람이 필요하면 N8 이 정한다 — 아래 3.2 |
| 수난 급류·하류 차단선 | R2 `s.flow`·`catch`. "급류 등급"이라는 이름은 없다 | — | — |
| 금고털이 | N4b 가 "넣지 않았다". P2 에 남음 | — | N8 (사용자 답 ⑤ 재산 범죄) |
| 다리 위의 위기자·동물 출몰·끊어진 전선 | P2 · DESIGN §5.6 · README "아직 없는 사건" | — | N8 |

### 3.2 선 — 제안

**N8(·N9)이 가져간다**
1. 시나리오·유형·현장 생성·세계 규칙·지휘 규칙·소품 그림 — 지금의 확장 지점(`scenarios/<묶음>.ts`·`field/scenes/`·`rules/`·`orders/`·`skins/`)으로. 새 묶음 이름은 설계자가 정한다.
2. **앞 일곱 묶음의 표에 "자기 줄"을 더하는 일**(§2 의 점검표) — 표의 모양과 엔진은 고치지 않는다. 공용 파일 수정 절에 줄 단위로 적는다.
3. P2 의 생활 사건과 금고털이, DESIGN §5.6 의 목록(다리 위의 위기자·동물·끊어진 전선·문 잠김 개방·주취자·실종 아동·끼임·감전·집단 식중독·산악 구조(헬기 인양)·낙뢰·정전·화재 경보 오작동).
4. R2 가 예약만 한 **탐지견·드론의 부대·장비**(만든다면) — R2 §4.9 의 행을 켜는 것까지.
5. I1-b 가 다른 시나리오로 대신 쓴 두 자리의 **전용 변형**(C5 의 연기 흡입, C7 의 지하차도·지하 주차장)과, C4·C8·C11 의 **원천이 되는 사건**(전선·변전소·수도관·통신 시설).
6. **주변 대피 유도**(X6 가 C4 몫으로 남긴 것)의 가장 작은 판 — 새 임무보다는 있는 `escort`·`perimeter`(+`announce`)로.
7. **높은 곳 구조의 한 층짜리 판**: 3층 이상 격자 없이, 현장 한 장 안의 "높은 자리"(옥상 가장자리·간판·크레인 운전실·절벽 턱)에 사람이 있고 사다리차·로프·헬기 호이스트로 내리는 것. 사용자 답 ⑤ 첫 줄("높은 곳·깊은 곳 구조")과 ⑥("구조대 전문 장비", "헬기")이 요구한다. 방법 틀은 R2 의 것을 쓴다(새 `MethodId` 줄 또는 `haul`·`hoist` 의 조건 넓히기 — R2 구현 메모를 보고 정한다).
8. **교통 시설의 전용 현장**(터널·지하철·공항·항구 — 사용자 답 ⑤): `registerScene` 으로 만드는 시나리오 현장까지. 비행기·선박·열차 현장이 이미 그 방식이다(`scenes/major.ts` 470줄).

**N8 이 넘긴다 (건드리지 않는다)**
- 방법 고르기·교본 엔진·부상 모델·위험 모델·인과 규칙 틀·이어받기의 **엔진**(R2·R3·H1·X6·I1-b·I2). 수치 재조정도.
- **3층 이상 건물·층을 오르는 사다리 구조**(C4), **지도의 건물 외곽 = 현장 평면·층수**(M2 (2)), **지도 편집**(M2 (4)), **공공 시설(소방서·경찰서·병원)을 사건 장소로**(README "공공 시설에서는 사건이 나지 않는다" — 학교·터미널은 설계자가 정하되 출동 시설은 뺀다: I2 `placeOutcome` 도 "출동 시설이 아닐 때"만 본다).
- 건물 전체 수색 계획(C5), 병원 수용의 교대 간 지속·예산·장기 성장(P2 의 나머지), 조직 기억(K2), 정보 격리 예외 제거(T2), 소리(A1).
- 잠수(R2·R3 가 뺐다 — 격자에 깊이가 없다).
- 추격전 자체의 깊이(차 바꿔 타기·건물 사이로 숨기 — README "추격전은 단순하다"). 날치기·차량 절도는 지금의 `pursuit.ts` 를 변형 이름으로 쓰는 데까지(`incidents.createIncident` 의 `startPursuit` 줄에 변형 이름).
- **바람**: 지금 어디에도 없다(헬기의 '강풍'은 날씨·재난 단계). 야외 누출의 바람 방향을 넣으면 가스 모델(X6)과 겹친다 — N8 은 "현장마다 고정된 한 방향"(생김새처럼 현장 생성 때 정한 값) 정도로만 쓰고, X6 의 실내 가스 확산은 고치지 않는 것을 제안한다. (추측 — X6 의 야외 가스 처리는 확인 못 함: 가스 단계는 "건물 칸(`foot ≥ 1`)만 훑는다"고 적혀 있어 야외 누출에는 X6 의 구름이 생기지 않을 것이다.)

**겹치는 자리의 규칙(제안)**: I1-b·X6·R2·R3·I2 의 파일에 N8 이 줄을 더할 때는 "그 묶음의 표에 한 줄"만, 그 묶음의 난수 흐름·등록 순서를 밀지 않게 **끝에** 붙인다(R3: "새 줄은 파일 끝에", I1: "import 순서 = 결과", R1: "새 줄은 끝에").

---

## 4. 새 사건이 그 시스템들을 보여 줄 기회

### 4.1 잰 것 — 지금 무엇이 어디서만 쓰이는가 (보통, S0~S39, 사건 567건)

시나리오별 건수: fire/std 97 · traffic/std 70 · medical/trauma 42 · hazmat/std 40 · search/hiker 35 · collapse/std 32 · search/wander 26 · water/std 26 · medical/faint 17 · traffic/tree 16 · armed/domestic 16 · armed/burglary 14 · medical/arrest 14 · fire/arson 12 · traffic/bus 11 · armed/robbery 11 · armed/dispute 11 · collapse/elevator 11 · armed/riot 7 · traffic/manhole 6 · fire/false 6 · armed/bombthreat 5 · armed/prank 5 · collapse/crane 5 · traffic/pileup 4 · armed/siege 4 · armed/kidnap 4 · armed/shooter 3 · traffic/train 3 · collapse/gasblast 3 · traffic/drunk 3 · armed/hostage 3 · armed/package 2 · fire/ship 1 · armed/bomb 1 · armed/getaway 1.

| 부대 종류 | 출동 합 (40교대) | 시나리오 가짓수 | 많이 간 곳 |
|---|---|---|---|
| `boat` 구조정 | **6** | **2** | water/std 5, fire/ship 1 |
| `eod` 폭발물 처리반 | **16** | 11 | armed/riot 3, armed/robbery 2, armed/package 2, armed/bombthreat 2 … (대부분 경찰 한 팀으로) |
| `policeHeli` | 62 | **4** | search/hiker 25, search/wander 22, water/std 12, armed/kidnap 3 |
| `swat` 특공대 | 74 | 22 | **armed/domestic 14(19%)**, armed/robbery 9, armed/burglary 7, armed/riot 6, fire/arson 5 |
| `heli` 소방 헬기 | 85 | 8 | search/hiker 25, search/wander 23, hazmat/std 10, water/std 9 |
| `hazmat` 화학 구조대 | 98 | 19 | **collapse/std 20(20%)**, hazmat/std 16(16%), fire/std 11, traffic/std 10 |
| `ladder` 사다리차 | 101 | 14 | fire/std 42, hazmat/std 22 |
| `medHeli` | 101 | 21 | fire/std 29, traffic/std 16, collapse/std 14 |
| `tactical` 기동 | 102 | 25 | **hazmat/std 32(31%)**(출입구 통제), armed/dispute 9 |
| `rescue` 구조 공작차 | 126 | 21 | traffic/std 22, fire/std 22, collapse/std 16, water/std 16 |
| `patrol` 217 · `engine` 258 · `bls` 184 · `als` 424 | | 22~32 | |

| 임무 | 끝낸 작업 합 | 시나리오 가짓수 | 어디서 |
|---|---|---|---|
| `airDrop` 물 투하 | **0** | 0 | (산불 재난에서만 — 평소 교대에는 없다) |
| `escort` 동행 | **4** | 3 | fire/std 2, hazmat/std 1, collapse/std 1 |
| `defuse` 해체 | **5** | **2** | armed/package 4, armed/bomb 1 |
| `hoist` 호이스트 | **10** | **1** | water/std |
| `engage` | 41 | 7 | armed/robbery 19 |
| `waterRescue` | 53 | 3 | water/std 46, search/wander 5, fire/ship 2 |
| `negotiate` | 58 | 8 | **armed/riot 29(50%)** |
| `interview` 면담 | 80 | 4 | search/hiker 35, search/wander 26, fire/arson 17 |
| `arrest` | 95 | 9 | armed/riot 43(45%) |
| `hookup` 급수 연결 | 121 | 5 | fire/std 103(85%) |
| `mitigate` | 180 | 7 | hazmat/std 60, collapse/std 44, traffic/std 33 |
| `extricate` | 254 | 12 | |
| `traffic` 통제 | 557 | 7 | traffic/std 337(61%) |
| `clearRoad` | 602 | 7 | traffic/std 355 |
| `overhaul` 687 · `suppress` 1403 | | 9 | fire/std 79% |

읽기:
- **유형 넷은 시나리오가 사실상 하나다**: 가스 누출(`hazmat/std` 뿐), 수난(`water/std` + 재난의 `evac`), 실종(`hiker`·`wander`), 응급(`arrest`·`trauma`·`faint`). 그 유형에 걸린 교본 줄·방법은 모두 한두 현장 생김새에 묶여 있다.
- **전문 부대는 자기 전문으로 거의 일하지 않는다**: 화학 구조대의 출동 84%가 가스 누출이 아닌 곳(구조·진압 겸용으로), 특공대의 가장 잦은 출동이 가정 폭력, 폭발물 처리반은 40교대에 해체 5번, 구조정은 6번 출동, 호이스트 10번, 물 투하 0번.

### 4.2 설계된 능력 가운데 쓰는 사건이 적거나 없는 것 → 더하면 드러나는 사건

(사용자 답 ⑤ 의 열두 묶음·⑥ 의 특수 부대 넷에 맞춰 적었다. 사건 이름은 재료이지 확정이 아니다.)

| 능력 (주인) | 지금 쓰이는 곳 | 드러나게 하는 사건 |
|---|---|---|
| H1 `electric` 감전 — **부르는 곳 0** | 없음 | 끊어진 전선(시설 사고), 침수 지하의 누전, 변전소 사고. 대원 방호(소방 0.4)가 처음으로 갈린다. H1 이 이 사건을 지목해 두었다 |
| H1 `fall` 추락 | `traffic/manhole` 의 처음 상태, 붕괴 현장 잔해 바닥 | 높은 곳 구조(옥상·간판·비계), 공사장 추락, 절벽 |
| H1 `exhaustion`·`exposure` | 사실상 없음 / 실종 | 폭염 환자 다발, 폭설 고립 — 단 날씨는 교대 내내 고정이고 폭염·폭설이라는 날씨 값이 없다(§6 주의) |
| H1 `toxic` | `hazmat/std`, 가스 폭발 | 밀폐 공간 질식(맨홀·정화조·탱크), 공장 누출, 의심 물질 |
| H1 `treatSuspect`·용의자 부상 | 무장 사건 | 주취 소란·시비처럼 총 없는 사건 — 몸싸움(`blunt`)·테이저 |
| X6 용기 `drum`·`cng`·`jet` | 공업 화재 / 교통사고의 버스 / 비행기 추락 | **탱크로리 전복**(새 용기 종류 — 냉각 `vessel` 조짐 2 → 3 → 폭발, 반경 통제), LPG 충전소, 공장 폭발 |
| X6 가스 조짐 = **측정기**(`gasMeter` 든 사람 2명, 화학대뿐) · R3 S10·S11·CF5·D1 | `hazmat/std` 하나 | 화생방 사건 여럿: 의심 물질(백색 가루), 암모니아 냉동 창고, 수영장 염소 가스, 실험실 — 측정기 없는 부대가 먼저 닿으면 냄새(단계 1)만 안다는 갈래가 드러난다 |
| R1 역할 `decon`(제독) | 제독이라는 **임무가 없다** — 측정기·송풍기를 든 대원일 뿐 | 화학 노출 환자의 제독(처치 전에 씻기는 단계) — 새 임무 후보. 화생방 부대의 일이 는다(사용자 답 ⑥) |
| X6 분진 폭발(선택) | 공장·창고·저장소·공방의 화재·붕괴 | 산업 현장 묶음 |
| X6 외부 방어·전원 철수 | 큰 화재 | 공장 화재·창고 화재(연료 많음)·시장 화재 |
| R2 `haul` 줄로 끌어올리기 | **`traffic/manhole` 하나**(40교대에 6건) | 깊은 곳 구조: 우물·굴착 구덩이·싱크홀·절벽 아래·배수로(A7 — `pit` 믿음의 조건을 넓혀야 한다) |
| R2 `airbag`·`shore` · R1 `searchKit` · R2 `listen` | 붕괴 현장뿐 | 끼임(공장 기계·차량 밑), 굴착(도랑) 붕괴, 공사장 |
| R2 `roof` 지붕 절단(유압 대원 둘) | 교통사고 | 다중 추돌 말고도 차량 추락(하천·낭떠러지) |
| R2 `boat`·`catch`·`swim` · R3 S13 · 구조정 | 일반 하천, 선박 화재(안벽), 해일 | **해상**: 방파제·갯바위 고립, 표류 보트, 해수욕장 이안류(다수), 기름 유출(항구 — 화학대 + 구조정 합동), 선박 좌초. 구조정 출동이 40교대 6번이다 |
| R1 `hoist`(물 현장 상공에서만) | `water/std` | 산악 조난(계곡·절벽 턱), 침수 지붕 위 고립, 옥상 고립, 갯벌. `isHovering` 과 지휘관의 `hoist` 작업 조건을 넓혀야 한다(A17) |
| R1 `airDrop` | 산불 재난뿐 — 평소 0 | 평소의 작은 임야 화재(들불·야산) — 낮에만(밤에는 뿌리지 않는다) |
| R1 경찰 헬기(탐조등·열영상) · R3 P18·P19·D7 추격 역할 | 실종·수난·납치 추격 | 날치기·차량 절도·현금 수송차 강도의 도주, 옥상 총격의 상공 관측, 탈주자 수색(밤) |
| R2 `sniper` 결정적 저격 · R3 S02·S24 | 인질을 잡은 채 교전 / 협상 60초 넘게 대치 | 옥상 총격(높은 자리의 총격범), 농성 |
| R2 `charge` 폭파 진입 · R3 S26 · 농성 문 잠금 | 무장 인질 현장의 잠긴 방 | 금고털이(금고실에 숨은 용의자), 바리케이드 농성 — 인질이 없을 때 가장 빠른 개방이라는 갈래 |
| R2 `beanbag` · R3 P02(혼자면 거리 유지)·P03(동시 덮침) · R1 테이저 | 흉기 `arrest` | 주취 소란·시비·흉기 난동 — 일상 치안 묶음이 그대로 이 줄들의 무대다 |
| R3 `robotDefuse`·`suitDefuse`·`bareDefuse` · S08·CS1(6칸 비우기) | 폭발물 셋(40교대에 해체 5번) | 연쇄 폭발물(두 번째 장치), 차량 폭탄, 공사장 불발탄, 의심 물질(폭발물 처리 + 화생방 합동) |
| R2 `announce` 대피 방송 · R1 `megaphone`(5명) | 가스 현장의 출입구 | 폭파 협박의 건물 대피, 군중 통제(압사 위험), 해안 대피 |
| R2 `extinguisher`(순찰·구급도 든다) | 화재 현장의 작은 불 | 차량 화재·쓰레기 화재·주방 화재 — 경찰·구급이 먼저 닿아 끄는 장면 |
| R2 `aerial` · R3 S19·D4 | 창 있는 건물의 센 불 | 높은 건물 화재·옥상 사건. 사다리 **구조**는 C4(§3.2 의 7) |
| R3 `triage` · E09·CE3·CE4 · I1-b C3 응급실 포화 | 버스 추돌·대형 사고 | **환자 다발**: 집단 식중독, 가스(일산화탄소) 중독, 폭염, 압사, 약물 — 구급차 세 대뿐이라 인근 도시 지원·의료 헬기·병원 포화가 한 사건에서 이어진다 |
| R3 E05 경계 밖 처치소 | `hot` 무장 현장 | 시위 충돌·폭동·차량 돌진 |
| R3 `blockLane` · F18 | 교통사고 | 터널·고속화 도로 위 사건 |
| H1 `LIGHT_WORK`(면담·통제·협상) · `interview`(4가지 시나리오) | 실종·방화 | 미아·치매 노인·날치기 목격자 — 면담이 수색 범위를 좁히는 사건 |
| `negotiate`(절반이 폭동) | 무장 | **위기에 놓인 사람의 설득**(용의자가 아닌 사람) — 지금 지휘관은 협상을 용의자에게만 낸다(`commander.ts` 의 용의자 반복문에서 `want(sim, s, 'negotiate', { hostile: h.id }, …)` 두 곳뿐, `needFor` 는 `law`). 위기자를 무기 없는 `Hostile` 로 둘지(검거·교전 규칙이 따라붙는다) 구조 대상으로 두고 협상의 대상 칸을 넓힐지 설계가 정해야 한다 |
| `escort`(40교대에 4번) | 거의 없음 | 대피 유도·미아 인계·치매 노인 귀가 |
| I1-b C4 정전의 (가) 갈래 — "평소에는 거의 나오지 않는다" | 변전소 `hazmat 2` 뿐 | 변전소·전신주·전선 사고에 몫을 주면 정전 → 승강기 갇힘·신호 꺼진 교차로 사고가 평소 교대에도 선다 |
| I1-b C8 통신 장애의 (가) 갈래 — `tower` 몫 0, `broadcast` 드묾 | 강제로만 | 방송국·통신 시설 사건 |
| I1-b C11 수압 저하(선택) | 붕괴·지진 | 수도관 파열 |
| I1-b C2 남는 잔해 · I2 도로 `why` | 붕괴·폭발 / 산사태·나무·다중 추돌 | 싱크홀·수도관 파열·간판 낙하 — 다음 교대의 복구 공사로 이어진다 |
| T1 행사 인파(교통 사건 — 지도에 이미 있다) | 혼잡 `bump` 만 | 군중·행사 묶음의 `gate`·장소로 쓸 수 있다 — 교통 모델에 `crowds: { edges, until, place }[]`(`traffic.ts` — 행사 건물 id 와 끝나는 시각, 180초, `VENUES` 종류 건물, 교통 사건 추첨의 몫 10/100)가 있다. 사건 생성(`incidents.ts`·시나리오의 `gate`/`node`)은 진실을 읽어도 되는 곳이라 읽을 수 있다(추측: 180초는 짧아 그 안에 사건이 서려면 `onCreate` 로 직접 일으키는 쪽이 낫다) |
| R1 남은 후보 "나무 밑의 사람이 하늘에서 가려진다"(실종 97%) | — | 숲 속 실종의 새 규칙 — 사건 종류가 아니라 세계 규칙이지만 실종 묶음을 넓힐 때 함께 볼 자리 |
| R2 `dog`·`drone`(예약) | 없음 | 탐지견 팀·드론이 생기면: 붕괴 매몰자, 야간 실종, 산악 |

---

## 5. DESIGN.md · README.md 의 약속과 제약 (사건 종류에 닿는 것)

- **무엇을 하는 게임인가**(DESIGN §1): 관찰 전용 — 플레이어는 시간·시점·시작 전 조건만. 911 Operator·119 Operator 류의 **장르 방식**은 많이 참고하되 "특정 게임의 아트·이름·지도·UI 배치를 그대로 옮기지는 않는다". 사건은 "네 묶음 모두: 생활 사건, 강력 범죄, 대형 사고, 재난".
- **"새 사건은 되도록 시나리오로 넣는다. 유형을 늘리면 고칠 표가 열 곳이 넘는다"**(DESIGN §5). 사용자의 이번 답(유형 +5~6)이 이것을 바꾼다 — 설계서가 DESIGN §5 를 고친다고 적어야 한다(DESIGN: "설계와 다르게 만든 점이 있으면 이 문서를 고친다").
- **뒤로 미룬 것 목록**(DESIGN §5.6): 다리 위의 위기자(협상 → 실패 시 수난 구조), 동물 출몰(멧돼지·뱀·벌집), 끊어진 전선, 문 잠김 개방, 주취자, 실종 아동, 산업 재해(끼임), 감전, 집단 식중독, 산악 구조(헬기 인양), 낙뢰·정전, 화재 경보 오작동, 사다리차의 창문 구조, 구조정의 현장 그림, 기차 운행(마지막 것은 T1 이 했다).
- **부대의 "앞으로"**(DESIGN §6): 사다리차의 2층 창문 구조 · 구조 헬기의 지붕 위 구조 · 화학 구조대의 가스 피해 감소 · 구조정의 선박 화재·홍수·해일.
- **균형**(DESIGN §7 · ROADMAP): 보통 목표 성공 70~80%, 실패 + 미해결 5~12%, 한계 시간 1% 이하, 교대당 12~15건. 관문 범위(`scripts/sweep.ts` 끝): 성공 + 대응 지연 65~90%, 실패 + 미해결 3~25%, 한계 시간 4% 이하 — 보통 난이도 기준. 시나리오를 더하면 한 유형 안에서 `SCENARIOS` 순서대로 몫을 깎으므로 **그 유형의 모든 사건이 달라진다**. 한 유형의 평소 `share` 합 ≤ 0.75(시험).
- **대형 사고는 교대마다 많아야 한 번**(`tag: 'major'`, `sim.rngMajor`), 재난에 딸린 시나리오는 추첨되지 않는다. 테러·중대 위협·교통 시설·공장 폭발 가운데 큰 것은 이 틀에 넣을지 정해야 한다.
- **README "알려진 문제"에서 사건 종류에 닿는 것**:
  - "아직 없는 사건: 다리 위의 위기자, 동물 출몰, 끊어진 전선, 금고털이는 넣지 못했다."
  - "생활 사건은 쉽다: 쓰러진 나무·맨홀 추락은 60교대에서 모두 성공" — 가벼운 사건을 많이 더하면 성공률이 관문 상한(90%) 쪽으로 간다.
  - "공공 시설에서는 사건이 나지 않는다: 소방서·경찰서·병원·시청·학교·물류 터미널".
  - "없는 것: 3층 이상 건물, 무장 사건의 2층 건물, 보트·잠수(→ R2 가 보트), 병상 수(→ I1-b C3), 예산, 장기 성장".
  - "현장 그림은 지도의 건물 외곽과 같지 않다(30×20 격자)", "막다른 골목은 지도와 주소에만 있다".
  - "추격전은 단순하다: 건물 사이로 숨거나 차를 바꿔 타지 않는다. 달아나는 차는 건널목 차단기를 무시한다."
  - "헬기가 뜨는 날의 실종 사건은 거의 다 성공한다(97%)", "의료 헬기는 다수 사상자 사고에서 같은 현장을 네댓 번 오간다" — 환자 다발 사건을 더하면 더 드러난다.
  - "최초 배정이 보수적이다(33%에서 추가 지원 요청)", "유형별 난도 차이: 화재 71% … 실종 97%".
  - "정보 격리의 예외 세 가지 — 늘리지 않는다".
  - "종료 보장: 현장별 한계 시간 300~470초, 다수 사상자 570초, 대형 사고는 그보다 길다".
- **README 가 기대는 부대 약속**: "관제는 부대 수 단위로 보내고, 능력이 기준을 넘는 부대에는 그 일을 할 장비를 든 대원이 반드시 있다(테스트)". 구급차는 세 대뿐(CLAUDE.md) — 환자 다발 사건마다 인근 도시 지원이 불린다.
- **민감한 소재**: H1 §7.2 "문장 — 담담하고 정중하게, 기록에서만", H1 §8.7 "하지 않는 것"(피 표현은 G5 가 지웠다), 사용자 결정 "용의자의 자해: 끈다". 위기에 놓인 사람·아동 사건은 이 선 위에서 구조·설득·보호의 일로 다룬다(작업 지시의 조건과 같다).

---

## 6. 주의 · 모르는 것

1. **이름이 아직 코드에 없다.** R2·R3·I1-b·I2 의 이름(`METHOD`·`WORK_MODE`·`chooseMethod`·`registerDoctrine`·`DocSit`·`registerConsequence`·`spawnConsequence`·`placeUsable`·`placeOutcome`·`roadsNext` …)은 전부 [설계]다. H1 은 `initialCause`(본문에는 표만 있고 이 이름이 없다)처럼 **이미 본문과 다른 이름**이 있고, X6 단계 1 도 "본문과 다른 곳 12가지"를 적었다(자료형 칸을 `types.ts` 끝의 블록에 인터페이스 합치기로 더함, 문제 코드 다섯이 합집합의 맨 앞 줄 등). N8 설계서의 점검표는 "칸의 뜻"으로 쓰고 실제 이름은 구현 때 각 구현 메모에서 확인하게 해야 한다.
2. **선택 단계가 들어올지 모른다**: X6 9단계(분진·플래시오버), R2 7단계(야외 수색 `air`·`drone`·`dog`), I1-b C11·C12, R3 CP4·D6("확인 필요 — 균형"). N8 설계는 "있으면 쓰고 없으면 이렇게"를 둘 다 적어야 한다.
3. **`tests/sim.test.ts` 와 `cityPlan.ts` 는 "절대 건드리지 않는 것"인데 새 유형은 둘 다 고쳐야 한다**(§2.2 B1·B2). 설계서가 따로 허락해야 하고, `cityPlan.ts` 를 고치면(사건 장소 표·새 건물 종류) 모든 시드의 결과가 바뀐다.
4. **시나리오의 순서가 추첨을 바꾼다 · 등록 순서가 결과를 바꾼다**(시나리오 표, R3 의 교본 줄, I1-b 의 규칙 import, `UNIT_DEFS`·`STAFF`·역할의 장비). 새 것은 모두 끝에.
5. **날씨는 교대 내내 고정**이고(I1 §9: "날씨만으로 사건을 늘리면 인과가 아니라 난이도가 된다" — C12 를 재난에만 건 까닭), 폭염·폭설이라는 날씨 값은 지금 없다(`types.ts`: `Weather = 'clear' | 'rain' | 'fog' | 'night'` — 밤도 날씨 값 하나다). "날씨·환경 피해" 묶음(폭설·폭염)은 재난 틀(`disaster.ts`)에 얹을지, 시나리오 `gate` 로 걸지 정해야 한다.
6. **군중 모델이 없다.** 현장의 사람은 구조 대상·용의자·대원 셋뿐이고, 도중에 느는 사람은 가스 현장의 주변 시민(`bystander2`) 하나다. 압사 위험·시위 충돌은 "사람 수가 많은 현장"의 성능(대원 1.9배로 이미 교대당 ×1.4)과 한계 시간을 함께 본다(다수 사상자 변형은 +170초).
7. **구급차 세 대**·의료 헬기의 왕복: 환자 다발 사건이 늘면 `NO_UNIT`·인근 도시 지원·대응 지연이 는다. 균형은 I1-b C3(응급실 포화)까지 합쳐진 뒤의 기준으로 재야 한다.
8. **정보 격리**: 새 지휘 규칙(`orders/*`)·교본 줄·방법 판단부는 `s.variant`·`s.props`·`s.casualties`·`s.hostiles`·`.truth` 를 읽지 못한다(시험이 글자로 잡는다). 새 사건의 "다름"은 믿음(사실 종류·`CasBelief` 칸·`haz.sub`)이나 생김새(`s.kind`·`s.rules`·구역·타일)로 드러나야 방법·교본이 반응한다 — 새 `FactType`·믿음 칸이 필요할 수 있다.
9. **확인 못 한 것**: (a) R3 E01 의 "관제 이름표가 다수 사상자 시나리오" 목록이 어디에 어떤 모양으로 있는지 (b) `executor` 의 `negotiate` 실행부가 용의자 없는 대상으로 돌 수 있는지(지휘관이 용의자에게만 낸다는 것까지만 확인) (c) X6 가 야외 누출에 가스 구름을 만드는지(본문상 건물 칸만) (d) 각 설계서 본문 전체를 줄 단위로 다 읽지는 못했다 — 머리말·나누는 선·자료형·표·구현 메모 위주로 읽었다(H1 §3~§9, X6 §5~§8, R3 §4~§5·§8~§11, I2 §3.1~§3.4·§4~§9 는 제목과 일부만) (e) H1 4b~7·X6 2~10 이 끝난 뒤의 실제 이름 — 구현이 진행 중이다 (f) R2 의 `KitDef.batch` 가 값 하나짜리인지 넓힐 수 있는지 (g) 일곱 묶음을 다 합친 뒤의 기준 수치(지금 수치는 R1 뒤·H1 4a 까지다: 보통 성공 80.3%).
10. **이 조사의 측정(§4.1)은 R1 뒤·H1 4a 까지의 코드**다. R2(방법)·R3(관제 교본 D1·D2·D5)가 합쳐지면 전문 부대의 출동 분포가 바뀐다(예: D1 이 화학 구조차를 가스 현장에 더 보내고, D2 가 처리반을 진입조에서 뺀다). N8 의 0단계에서 같은 스크립트로 다시 잰다.
