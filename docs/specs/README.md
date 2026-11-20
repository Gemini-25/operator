# 묶음별 구현 설계서 — 공통 규칙

이 폴더의 문서는 **여러 작업자가 동시에** 일해도 서로 꼬이지 않도록 쓴 구현 지시서다. 한 문서 = 한 묶음 = 한 작업자(한 브랜치).
전체 방향은 `docs/DESIGN.md`, 저장소의 규칙과 함정은 `CLAUDE.md`. 여기 적힌 것과 `DESIGN.md` 가 다르면 **이 폴더가 최신**이다.

| 문서 | 묶음 | 브랜치 | 한 줄 요약 | 상태 |
|---|---|---|---|---|
| `M1-map.md` | 지도 | (주 작업 폴더) | 블록 안의 이면 도로, 겹침 보장 | 구현됨 |
| `N4b-crime.md` | 강력 범죄 | `wf/crime` | 폭발물(+해체), 대형 인질극, 도주 차량·은신처, 폭동, 연쇄 방화 | 구현됨 |
| `N5-major.md` | 대형 사고 | `wf/major` | 비행기 추락, 열차 탈선, 다중 추돌, 가스 폭발, 크레인 붕괴, 선박 화재 | 구현됨 |
| `N6-disaster.md` | 재난 | `wf/disaster` | 태풍, 홍수, 지진, 산불, 해일 (+ 산사태) | 구현됨 |
| `N7-destruction.md` | 현장 파손 | `wf/destruction` | 총격·폭발에 창문과 가구가 부서진다 | 구현됨 |
| `T1-traffic.md` | 교통 | `wf/traffic` | 정체가 뒤로 밀림, 가 보아야 아는 장애물(낙하물·불법 주차), 건널목과 열차, 교통 손잡이 | 구현됨 |
| `U1-ui.md` | 화면 | `wf/ui` | 부대·시설 표식을 글자 대신 그림 기호로, 범례, 화면 전체 다듬기 | 구현됨 |
| `U2-call-panel.md` | 통화창 | `wf/u2` | 통화창을 가운데 화면 밖, 오른쪽 칸 맨 위의 접히는 칸으로(`P`) | **구현됨** (`f4e44be` — 문서 앞머리 "구현 상태") |
| `G5-combat-fx.md` | 교전 연출 | `wf/g5` | 총구 섬광·예광선·탄착, 섬광탄, 폭발, 진입, 대치, 검거, 교전 소리, 결정적 순간의 자동 감속 — 결과 불변 | **구현됨** (`9ab7fdb` — 문서 끝 "구현 메모") |
| `I1-causality.md` | 인과관계·시스템 통합 | `wf/i1a` · `wf/causality` | I1-a 측정 도구(지표 여덟 가지·일치 검사·관문), I1-b 인과 규칙·세계 상태 결합(신호·규칙 11개·조건부 연쇄) | **I1-a 구현됨** (`48dba83`) · I1-b 준비 단계 b0(기록만 잇기 — 해시 불변)이 주 브랜치에 있다(2026-11-15 밤). **I1-b 구현 중**(2026-11-20 저녁부터 — b1·b2 → b3 규칙 1~6 → b3 규칙 7~11 → b4·b5 → 독립 검토 → 문서. 진행은 `docs/ROADMAP.md` "진행 중" 맨 위 줄). 설계서 끝 "구현 메모 (진행 중)" — 실제 이름·본문과 다른 곳·연쇄 상한의 정본·이어받을 자리 |
| `G4-scene-legibility.md` | 현장 가독성 | `wf/g4` | 무너진 건물·가스가 찬 범위·되살아난 불·폭발 자리·붙잡힌 인질이 한눈에 — 결과 불변 | **구현됨** (`7d5a5e8` — 문서 끝 구현 결과) |
| `R1-crews.md` | 부대 편성·개인 장비·헬기 | `wf/crews` | 부대마다 2~5명의 역할, 사람마다 장비(공기·섬광탄·테이저의 수량과 고장), 경찰·소방·의료 헬기 | **구현됨** (2026-11-15, 마지막 코드 커밋 `7b211c8` — 문서 끝 "구현 메모"가 정본) |
| `H1-injuries.md` | 부상과 사망 | `wf/injuries` | 대원·용의자·구조 대상이 한 모델로 다치고 숨진다 — 원인·방호·문턱·후송·결원·보고서 | **구현됨** (2026-11-15 밤 — 단계 0~7 과 독립 검토. 문서 끝 "구현 메모"의 "최종 요약"이 정본 — 뒤 묶음이 쓰는 실제 이름·설계와 달라진 곳·기준 → 최종 수치·알려진 문제) |
| `X6-catastrophe.md` | 위험의 현실화 | `wf/catastrophe` | 조짐 → 막는 조치·철수·외부 방어 → 실제 붕괴·폭발·전소 → 사상자·지도·보고서 | **구현됨** (2026-11-16 — 단계 0~10 과 독립 검토. 문서 끝 "구현 메모"의 "최종 요약"이 정본 — 뒤 묶음이 쓰는 실제 이름·설계와 달라진 곳·기준 → 최종 수치·못 맞춘 균형 목표 셋(가스 용기 폭발 몫·막아 낸 조짐·철수 수 — 서로 당긴다)·알려진 문제. 분진 폭발·플래시오버는 넣고 꺼 두었다) |
| `R2-methods.md` | 대응 방식 다양화 | `wf/methods` | 같은 임무를 장비·능력·상황에 따라 여러 방법으로(헤엄 구조·보트·소화기·비살상탄·저격·폭파 진입 …) | **구현됨** (2026-11-16 — 단계 0~6 과 독립 검토·문서 단계, 선택 7(야외 수색)은 하지 않음. 문서 끝 "구현 메모"의 "최종 요약"이 정본 — 뒤 묶음이 쓰는 실제 이름·설계와 달라진 곳·기준 → 최종 수치·못 맞춘 목표 하나(폭파 진입 성공 ≥ 2 — R3 S03·S26 으로)·알려진 문제. 단계 4·5·6 의 그림은 화면만의 따로 묶음 `wf/methodsfx`) |
| `R3-doctrine.md` | 분야별 대응 교본 | `wf/doctrine` | 경찰·소방·의료·특수의 상황 × 장비 × 상태 교본 줄, 짝 규칙, 탄약·엄폐 | **구현됨** (2026-11-20 — 단계 0~7 과 독립 검토·문서 단계. 문서 끝 "구현 메모"의 "최종 요약"이 정본 — 뒤 묶음이 쓰는 실제 이름·설계와 달라진 곳(사용자 결정 D8: 건물 화재 첫 출동 +1 펌프차)·기준 → 최종 수치·못 맞춘 목표(화재 −11.9%p — 사용자가 받아들임 · 대원 부상 · split 0.485 · 교대당 시간 1.55배 · 높은 난이도)·알려진 문제(장비 1 의 예비 펌프 0 — 사용자 결정이 필요하다 · 폭파 진입 0건)) |
| `I2-persistence.md` | 교대 간 지속 | `wf/persist` | 대원 상태·장비·건물·도로를 "이어받은 상태"로 다음 교대의 입력에 | **준비 단계만 구현됨** (2026-11-15 밤 — 단계 1(틀)·2(대원)·3(장비 — 이어받은 상태가 없으면 해시 불변)이 주 브랜치에 있다. 0·4~8 은 I1-b 다음(7). 설계서 끝 "구현 메모 (진행 중)" — 실제 이름·생성자 순서·본문과 다른 곳 11가지·이어받을 자리) |
| `N8-incident-kinds.md` | 사건 종류 다양화 ① 일상 사건 | `wf/kinds` | 새 유형 다섯(시설 사고·동물·치안·보호·구조)과 시나리오 24, 비응급 신고 네 갈래, 새 부대 여섯 갈래·종류 여덟(복구반 셋·견인차·동물 포획·형사·교통 경찰·경찰견), 공통 틀(유형을 자료로·짧은 사건 추첨 `daily`·통제 `cordon`·보류·판정 등록·조건부 연쇄) | **설계됨 — 구현은 I2 다음 · 준비 단계 1·2a·2b(유형을 자료로 · 자료형과 등록 자리 · 새 부대의 자리 — 해시 불변)가 주 브랜치에 있다** (2026-11-15, 독립 검토 두 갈래 반영 — 끝의 "검토 메모", 사용자 결정 열네 가지. 조사 보고서 `N8-research/`) |
| `N9-major-kinds.md` | 사건 종류 다양화 ② 큰 사건·새 장소 | `wf/kinds2` | 새 유형 군중(구역 밀도·흐름 자리), 시나리오 25(군중·교통 시설·독성 공기와 화생방·산업과 재산 범죄·테러·날씨·해상·산악 — 24개가 사용자 예시), 새 부대 넷(산악·수중·제독·기동대 — kindFit 으로 자기 일만), 새 장소(지하철역 셋·공연장·은행 본점 덧붙이기 — 해시 불변, 산성터널·중앙대로 지하차도·경기장·공항·부두 전용 현장) | **설계됨 — 구현은 N8 다음 · 준비 단계 1·2·3(자료형과 등록 자리 · 새 부대의 자리 · 지도 덧붙이기 — 해시 불변)이 주 브랜치에 있다** (2026-11-15, 독립 검토 반영. 사용자 질문 넷은 추천 기본값으로 확정 — 분량은 모두 만든다, §12.5) |

합치는 순서: M1 → N7 → N4b → N5 → N6 → T1 → U1 — **일곱 묶음 모두 구현돼 합쳐졌다(2026-11-14).** 그 뒤 같은 날 U2·I1-a·G5 를 구현해 합쳤다(설계서 없이 진행한 B1·B3·P1·Q1·Z1 도 합쳐졌다). 2026-11-15 에 R1 을 아래 "실행 방법"대로 구현했다. 남은 설계서의 순서는 아래 "구현 순서" 절이다. 아래의 규칙은 다음에 묶음을 더할 때 그대로 쓴다. 각 설계서 끝의 구현 메모(또는 앞머리의 "구현 상태")가 실제 코드와 맞는 최신 내용이다.

## 구현 순서 (남은 설계서)

**시뮬레이션 쪽은 한 줄로 차례대로**: **R1 → H1 → X6 → R2 → R3 → I1-b → R3b → I2 → N8 → N9**(`docs/ROADMAP.md` "진행 중"과 같다. R3b = R3 뒤 손질 — 무장 사건의 대원 부상·계산 속도·폭파 진입, 2026-11-20 사용자 결정으로 I2 앞에 끼웠다. 설계서 `R3b-followup.md`). 모두 결과를 바꾸고 같은 파일을 고치므로 한 세션이 처음부터 이어서 한다. 단계마다 그 설계서의 0단계(기준 재기)를 **앞 단계를 합친 뒤에** 다시 잰다. 각 설계서는 앞 단계가 합쳐져 있다고 보고 썼고, 순서가 바뀌었을 때 쓸 대체를 따로 적었다.

| 단계 | 묶음 | 앞 단계에 기대는 것 | 앞 단계 없이 먼저 하면 (대체) |
|---|---|---|---|
| 1 | R1 — **끝남** | 지금 HEAD(B1·B3·P1·Q1·Z1·U2·I1-a·G5 를 합친 상태). B1 뒤에 기준을 잰다 | — (첫 단계) |
| 2 | H1 — **끝남** | R1 의 `armorOf`·`blastFactor`·`kitWorks`·`kitUses`·`medLevelOf`·`seatsOf`·`fieldCrew`·`makeAgent`·`startTransport` 의 병원 이름, G5 가 지운 피·'hit'. H1 은 `minField` 를 쓰지 않는다(결원 규칙 — 아래 정본 표) | H1 §12.2-5 (방호는 §2.4 의 "지금"·"새로" 열, `crewOk`·`crewReady` 는 `u.crew`, 자리는 구급차 2·헬기 1) |
| 3 | X6 — **끝남** | H1 의 `hurt*`(`{ ev }`)·문턱·`agentHealth` 전이·`mateFact`·`MateBelief`, R1 의 `hasKit`·`kitWorks`·`kitLive`·`toolUse`·`makeAgent`·`briefFacts`. G4 가 먼저 합쳐졌으면 그 그림·시험 둘을 함께 고친다 | X6 §12.1 의 "R1·H1 이 먼저 합쳐지지 않았으면" 줄, §3.4 의 "R1 이 없을 때" 열, §7.2 의 "G4 가 아직이면" |
| 4 | R2 — **끝남** | R1 의 `KitId`·`KITS`·명부 고장 추첨·`hoist`, H1 의 `hurt*`·`protection('drown')`, X6 의 `exteriorSpots`(본문의 `exteriorSpot`)·`spray(eff, wmul)`·`ops` 사실·`s.fan` 자리 | R2 §3.3 끝의 `gear.ts` 대체, §10 "R1 이 아직 없을 때" |
| 5 | R3 — **끝남** | R2 의 `chooseMethod(…, dc)`·`METHOD`·`WORK_MODE`·`gear.ts`, R1 의 `ROLES`·`KITS`·`capableOf`, H1 의 `bandOf`·`hurtF`·`treatMate`, X6 의 `DANGER_RULES`·`evacuate` | 대체를 두지 않는다 — 함수 이름이 다르면 실제 코드를 따른다(R3 §11.2-7). 순서를 지킨다 |
| 6 | I1-b | X6 의 `catastrophe` 신호·`placeMarks`·`I.blockEv`, R1 단계 3 의 출발 문구(C5 관문), H1 의 넓힌 문구 규칙(T4·T6)·`u.oosEv` | I1 §3.10(X6 와 함께 넣을 부분 — 빈 `world/consequence.ts`), §3.11 1단계(R1 이 출발 문구를 안 고쳤으면 b1 에서) |
| 7 | I2 | H1 의 `outShifts`·`RosterOut`, R1 의 `minField`·`skillsOf`·`STAFF`, X6 의 `placeMarks`·`placeUsable` 로 옮길 세 검사, I1-b 의 `knownBuildingAt`·`placeState`·`WorldTag`·`rubble` | I2 §3.2 의 "H1 이 아직 합쳐지지 않았으면", §11.1-3("앞 묶음의 이름" — 구현 전에 실제 이름 확인) |
| 8 | N8 | 일곱 묶음 전부(각 설계서 끝 "구현 메모"가 정본): R1 의 `UNIT_DEFS`·`STAFF`·`KITS`·`capableOf`·`airFit`·`kitBonus`·`isHovering`·`airDecide`·`rules/air.ts`·`drawFaults`, H1 의 `InjuryCause`·`BLEED_PER_DMG`·`initialCause`·`LIGHT_WORK`·`hurt*`·`hurtHostile`·임무 `treatSuspect`, X6 의 `NO_STRUCT`·`OpsState`, R2 의 `METHOD`·`WORK_MODE`·`CasBelief.pit`·`batch` 건너뛰기(실제는 `crews.OWN_DRAW` 에 'n8' 을 더한다 — R2 구현 메모 최종 요약)·`shoring`, R3 의 `registerDoctrine`·`DocSit`·`DOC_OF_UNIT`(내보내지 않는 모듈 상수 — 새 `UnitKind` 의 줄을 그 표에 더한다, 밖에서는 `docDeptOf`)·`PAIRS`·`doctrine/index.ts`, I1-b 의 `registerConsequence`·`spawnConsequence`·`PROBLEM_SYS`·C4·C10·C11, I2 의 `roadsNext`·`placeUsable` | N8 "이어받는 사람에게" 2 의 표 — 이름이 다르면 실제 이름을 따르고 구현 메모에 적는다. I1-b 가 없으면 연쇄는 시나리오 `onClose`+`canChain`(§5.6), R3 가 없으면 교본 줄 없이 지휘 규칙으로 |
| 9 | N9 | N8 의 공통 틀 전부(`TYPE_DEFS`(`floorHp`)·`kindFit`·`KIND_AUX`·`LABEL_BONUS`·`capableOf` 의 넷째 인자·`needFor(…, a)`·`cordon`·`registerPending`·`registerCasHold`·`registerVerdict`·`T.LEDGE`·`'perch'`·`streetFrame`·`card: false`·`runUntilClosed`), R1 의 `kitBonus`·`airFit`·`isHovering`, R2 의 `METHOD`·`CasBelief.veh`, R3 의 `registerDoctrine`(단계 0 의 `DoctrineRule`), I1-b 의 `registerConsequence`·C7 `floodLow`, I2 의 `roadsNext`, X6 의 `NO_STRUCT`·`vessel`·분진 폭발(넣고 꺼 둠 — `CAT.dust`) | N8 없이는 시작하지 않는다. 그 밖은 N9 §12.3 의 대체(R2 가 없으면 잠수·펜스를 실행부의 고정 갈래로, R3 가 없으면 교본 줄 대신 지휘 규칙, I1-b 가 없으면 연쇄를 시나리오 `onClose`·`canChain` 으로, X6 9단계가 없으면 공장의 2차 폭발을 `plantRule` 이 한 번) |

**R1 이 끝난 뒤의 확인(2026-11-15)**: 위 표와 아래 "정본" 표가 R1 에 기대하는 이름은 **모두 그 이름으로 있다** — `src/sim/crews.ts` 의 `KitId`·`KITS`·`ROLES`·`STAFF`·`hasKit`·`kitWorks`·`kitLive`·`kitUses`·`useKit`·`toolFor`·`toolUse`·`medLevelOf`·`armorOf(sim, rid, engaging)`·`blastFactor`·`seatsOf`·`fieldCrew`·`minField`·`minCrew`·`skillsOf`·`capableOf`, `field/agents.ts` 의 `makeAgent`·`briefFacts`, `resources.ts` 의 `startTransport`(고른 병원 `Facility` 를 돌려준다)·명부 고장 추첨(`crews.drawFaults`), `Unit.hoist`·`WorkKind 'hoist'`, 측정 도구의 C5 관문(켜져 있다). 본문과 서명이 다른 것은 둘뿐이다: `kitRng(sim, s)`(본문은 `kitRng(s)`), `heliPad(sim, f)` 가 `[x, y]` 를 돌려준다. 본문에 없이 더해진 것(`fitFor` 의 다섯째 인자 `afterSwap`, `airShort`·`scbaReady`·`AIR_MIN`, `anyCapable`, `airFit`, 구출 교대, 헬기만 왔던 현장의 마무리)과 뒤 묶음마다 알아야 할 것은 `R1-crews.md` 끝 "구현 메모"의 "뒤 묶음이 쓰는 이름"·"뒤 묶음마다 알아야 할 것"에 있다. **H1 부터는 0단계의 기준을 R1 을 합친 뒤에 다시 잰다**(R1 이 모든 시드의 결과를 바꿨다 — 보통 성공률 76 → 81%).

**H1 이 끝난 뒤의 확인(2026-11-15 밤)**: 위 표와 "정본" 표가 H1 에 기대하는 이름은 **모두 그 이름·그 뜻으로 있다** — `field/injury.ts` 의 `hurtCas`·`hurtResponder`·`hurtHostile`(`HurtOpts.ev`)·`protection`(`drown` 은 0)·`bandOf`·`hurtF`·`outShifts`·`threatOverAt`·`LIGHT_WORK`·`injuryRng`, 문턱(`MATE_LETHAL_FROM`·`DOWN_BLEED_CAP`·`HOSTILE_LEFT`), `sceneManager.agentHealth` 의 전이(안쪽 `settle()` — X6 의 깔림 조건이 들어갈 자리), `agents.mateFact`·`MateBelief`(X6 단계 1 의 `trapped?` 가 이미 붙어 있다), `WorkKind 'treatMate'`·`'treatSuspect'`, `ProblemCode 'RESPONDER_KILLED'`·`'SUSPECT_DIED'`, `resources.crewReady`·`crewOk`, `Unit.oosEv`, `ShiftReport.roster: RosterOut[]`, `scripts/metrics.ts` 의 넓힌 `PHRASE.T4`·`T6`. 다른 것은 하나 — `seatsUsed` 는 `agents.ts` 가 아니라 R1 의 `seatsOf` 옆인 `crews.ts` 에 있다. 본문과 다르게 정한 값(출혈 물러남 0.09 · 병원 문턱 = 그 값 · `injuryMul` 의 위쪽 두 칸 1)과 뒤 묶음마다 알아야 할 것은 `H1-injuries.md` 끝 "구현 메모"의 "최종 요약"에 있다. **X6 부터는 0단계의 기준을 H1 을 합친 뒤에 다시 잰다**(H1 이 어려움·극한의 결과를 바꿨다 — 보통은 성공 80.5 → 80.4%).

**X6 가 끝난 뒤의 확인(2026-11-16)**: 위 표와 "정본" 표가 X6 에 기대하는 이름은 **두 이름을 빼고 모두 있다** — `ops.ts` 의 `OpsState` 도움 함수(`newOps`·`zoneMask`·`zoneLevelAt`·`regionLevel`·`gateBlocks`·`opsExterior`·`opsCordon`·`evacPoint`·`isRubbleMode`·`inRubble`)와 `NO_STRUCT`(`catastrophe.ts` 가 다시 내보낸다)·`SIGN_BASE`·`OPS_ID`·`OPS_PAR`·`OpsFact`, `orders/catastrophe.ts` 의 `DANGER_RULES`·`dangerMap`(`DangerHit.rule` — R3 의 CF5·CF6), `TaskKind 'evacuate'`, `executor.spray(…, eff, wmul)`, `Prop.vessel`, `world/consequence.ts` 의 `signal(…, 'catastrophe', …)` 여섯 자리, `Sim.placeMarks`·`PlaceMark`, 전체 붕괴의 `I.blockEv`, `catOf`, `sceneRegistry.registerGate`·`commander` 의 `GHOST`. 다른 것: **`exteriorSpot` 은 `exteriorSpots(s, region, far)`**(후보 목록 — 고르는 것은 실행기), **본문의 `cutOff` 는 `reachMask`/`regionReachable`**. I2 가 `placeUsable` 로 바꿀 세 검사는 지금 `incidents.placeGone` 이다(`pickPlace`·`createIncident` 의 지정 건물·추격전 은신처 후보). **분진 폭발(N9 가 기대)은 있지만 `CAT.dust = false`** 라 N9 는 §12.3 의 대체(`plantRule`)를 쓴다. 실제 서명과 뒤 묶음마다 알아야 할 것은 `X6-catastrophe.md` 끝 "구현 메모"의 "최종 요약"에 있다. **R2 부터는 0단계의 기준을 X6 를 합친 뒤에 다시 잰다**(X6 가 모든 난이도의 결과를 바꿨다 — 보통 성공+대응 지연 84.3 → 83.0%, 극한 45.7 → 42.7%. X6 의 수는 보통 120교대 이상으로 본다).

**R2 가 끝난 뒤의 확인(2026-11-16)**: 위 표와 "정본" 표가 R2 에 기대하는 이름은 **두 이름을 빼고 모두 그 이름·그 뜻으로 있다** — `field/methods.ts` 의 `METHOD`(60줄 — N9 단계 1 의 다섯 줄 포함)·`METHOD_ORDER`·`WORK_MODE`·`chooseMethod(sim, s, a, work, tg, t, sense, dc = null)`·`methodFit`·`methodStillFits`·`Sense`·`MTarget`·`targetKey`·`SAY`, `types.ts` 의 `MethodId`·`MethodWhy`(평소 = `'usual'`)·`MethodUse`, `field/gear.ts` 의 판단용(`kitCount`·`kitName`·`swimBonus`·`seatsLeft`·`airLow`·`hoistOver`)·효과용(`kitTool`·`bestTool`·`kitWorks`·`useKit`)과 R3 0 이 더한 `kitHas`·`kitQty`·`gunOf`·`roleIdOf`·`groupOf`·`crewHas`, `CasBelief.pit`·`veh`, `KitId 'shoring'`·`'charge'`, 물 위 피해 하한 `methodRun.WATER_FLOOR`(18), X6 와의 `Scene.fan`·`gasStep` 의 송풍기 항·`shore` → `p.mitigated`. 다른 것: **`batch` 건너뛰기는 `crews.OWN_DRAW`**(N9 단계 2 의 묶음 장치 — `{'r2', 'n9'}`, 명부를 만든 뒤 `drawBatchFaults` 가 자기 흐름에서 뽑는다. N8 의 'n8' 도 여기에 더한다), **`BARRICADE_P` 는 `BARRICADE.p`**(`rules/methods.ts`). 폭파의 `hazards.blast` 에는 `noSignal` 인자가 없다(지금 `blast` 는 I1 신호를 보내지 않는다 — I1-b 가 신호를 더할 때 폭파 진입을 뺀다). 실제 서명과 뒤 묶음마다 알아야 할 것은 `R2-methods.md` 끝 "구현 메모"의 "최종 요약"에 있다. **R3 부터는 0단계의 기준을 R2 를 합친 뒤에 다시 잰다**(R2 가 모든 시드의 결과를 바꿨다 — 보통 성공+대응 지연 83.0 → 82.5%, 극한 42.7 → 43.8%. 시작 문구가 늘어 기록 해시는 모두 다르다).

**R3 가 끝난 뒤의 확인(2026-11-20)**: 위 표와 "정본" 표가 R3 에 기대하는 이름은 **두 곳을 빼고 모두 그 이름·그 뜻으로 있다** — `field/doctrine/registry.ts` 의 `registerDoctrine`·`DoctrineRule`·`DocCtx`·`DocState`·`DocSit`·`DOCTRINE`·`CMD_ROWS`·`DOC_SWITCH`, `field/doctrine.ts` 의 `docDeptOf`·`PAIRS`·`SOLO_OK`·`docFit`·`docDuty`·`docAct`·`docGate`·`docMethodMul`·`coverSpot`·`buddyOf`·`outsideWatch`·`DOC`, `field/doctrineRun.ts` 의 `fireRound`·`reloadTick`·`selfReport`·`pairUp`·`rebuddy`·`recordDoc`·`runCarry`·`runTraffic`·`runDefuse`, `field/doctrine/index.ts`(common → police → fire → ems → special), `types.ts` 의 `DocDept`·`DocHook`·`DocActId`·`DocGateId`·`DocWhy`·`CrewBelief`·`DocUse`·`FactType 'crew'`·`TaskKind` 의 `cover`·`rearm`·`airOut`·`pairOut`·`pair`·`WorkKind 'triage'`·`MethodId` 열 개, `gear.ts` 의 `kitHas`·`kitQty`·`gunOf`·`roleIdOf`·`groupOf`·`crewHas`. 다른 것: **`docCtx` 는 끝에 인자 `dngSign` 이 하나 더 있다**, **`DOC_OF_UNIT` 은 `doctrine.ts` 안의 내보내지 않는 상수**(`Record<UnitKind, DocDept>` — 새 부대 종류의 줄을 거기에 더하고 밖에서는 `docDeptOf(sim, rid)`). 본문과 자리가 다른 것: `breachExit` 는 `executor.ts`, 보고서 함수(`docLines`·`docTally`·`docSummary`)는 `field/doctrineReport.ts`, 대원 정보창은 `ui/DoctrineRows.tsx`. 본문에 없이 더해진 것(사용자 결정 D8 `docNeeds`·`FIRST_PLUS`, `pairOf`·`pairAlt(…, can)`, `brain.allowedHere` 의 짝 동행 항, `DOC.WATCH_STAGE`, `Casualty.immob`, `methods.LANE_SHIELD_BY`, 수색 끝의 실패 가드, `view/scene/doctrineLayer.ts`)과 뒤 묶음마다 알아야 할 것은 `R3-doctrine.md` 끝 "구현 메모"의 "최종 요약"에 있다. **I1-b 부터는 0단계의 기준을 R3 를 합친 뒤에 다시 잰다**(R3 가 모든 시드의 결과를 바꿨다 — 보통 성공 78.7 → 76.4%·성공+대응 지연 82.5 → 80.6%, 화재 67.4 → 55.5%(사용자가 받아들인 결과), 극한 32.3 → 27.8%, 교대당 시간 1.55배).

**R3 뒤의 사용자 결정(2026-11-20 저녁) — 장비 손잡이 1 의 예비 펌프 0 → 1**: `difficulty.ts` 의 `sparePump` 표가 `[1, 1, 1, 1, 2]` 다(R3 설계서 §2.1 의 `[0, 1, 1, 1, 2]` 에서 첫 칸만). 0 이면 펌프가 고장 났을 때 진압이 멎어 극한의 건물 화재가 거의 다 전소했다(R3 최종 요약 "알려진 문제"). **장비 1 을 쓰는 조건(극한 프리셋 · 장비 불량 `--diff 3,3,3,1,3,3`)만 결과가 바뀐다** — 보통·쉬움·어려움(장비 2)과 보통 난이도의 재난·강제 실행은 한 글자도 바뀌지 않는다. 이 커밋은 I1-b 의 `b12` 덩어리가 기준을 잰 **뒤에** 주 브랜치에 들어갔으므로, `b12` 가 남긴 기준 가운데 **극한 줄(해시 목록의 극한 S0~S19 · 극한 `--check` 수치 · 극한 30교대의 교착 후보·잊힌 사건)은 이 변경 전의 것**이다 — 뒤 덩어리(`b3a` 부터)와 검토·문서 작업자는 극한 조건의 "전"을 주 브랜치를 받은 자리에서 다시 잰다(보통·어려움·재난·강제의 기준은 그대로 쓴다).

### 실행 방법 — 묶음 하나를 단계로 나눠 돌리기 (2026-11-15 부터 이렇게 한다)

남은 설계서는 하나가 900~1,200줄이라 작업자 하나가 처음부터 끝까지 하기에는 크다. 그래서 **묶음 하나 = 워크플로 하나**로, 설계서의 "구현 순서" 표를 서너 덩어리로 묶어 작업자를 차례로 세운다. 사람이(또는 이어받은 모델이) 손으로 할 때도 같은 순서·같은 브랜치 규칙을 쓴다.

1. **덩어리**: 설계서의 단계를 순서대로 묶는다(예: R1 은 `0+1` · `2a+2b` · `3+4` · `5` · `6+7`). 덩어리마다 새 작업자가 설계서를 처음부터 읽고, 앞 덩어리의 커밋 위에서 자기 단계만 한다. 단계마다 설계서가 정한 완료 조건(`npx tsc --noEmit`, 그 단계의 테스트, `npm run check`, 전후 비교)을 채우고 커밋한다.
2. **브랜치**: 작업자는 자기 브랜치 `wf/<묶음>-<덩어리>`(다시 시도하면 끝에 `-b`)에서 일하고, **커밋할 때마다 `git branch -f wf/<묶음> HEAD`** 로 묶음의 가리킴 브랜치를 옮긴다. 다음 작업자는 `wf/<묶음>` 에서 갈라 시작한다. `wf/<묶음>` 자체는 어느 작업 폴더에서도 체크아웃하지 않는다(체크아웃돼 있으면 옮길 수 없다). 푸시하지 않는다.
3. **기준 수치**: 첫 덩어리가 설계서의 0단계(기준 재기)를 scratchpad 의 `wf-<묶음>/` 에 저장하고, 뒤의 덩어리와 검토자가 그 파일과 견준다. scratchpad 가 비었으면(새 컨테이너) 주 브랜치의 그 묶음 시작 커밋을 따로 풀어 다시 잰다.
4. **검토**: 덩어리가 모두 끝나면 독립 검토자 하나가 `wf/<묶음>` 에서 갈라 틀린 곳을 찾고 직접 고친다(설계서의 테스트·불변 조건·균형 기준·정보 격리·재현성·끝나지 않는 사건·화면). 고친 것마다 고치기 전에 실패하는 확인을 남긴다.
5. **문서 단계**: 설계서의 마지막 단계(균형 최종 확인, `README.md`·`CLAUDE.md`·`docs/ROADMAP.md`, 설계서 끝의 "구현 메모")를 한 작업자가 한다. 구현 메모에는 설계와 달라진 곳, 뒤 묶음이 써야 하는 실제 함수 이름, 잰 수치, 알려진 문제를 적는다 — **뒤 묶음의 작업자는 앞 묶음의 구현 메모를 정본으로 읽는다.**
6. **합치기**(주 작업 폴더에서): `git merge --no-ff wf/<묶음>` → `npm run check` → (화면을 고친 묶음이면 `npm run ui-check`) → 푸시 → 이 문서의 상태 표와 `docs/ROADMAP.md` "진행 중"을 고친다 → 다음 묶음.
7. **끊겼을 때**: `git branch -a` 에서 `wf/<묶음>` 이 있으면 그 묶음이 진행 중이다. `git log --oneline <주 브랜치>..wf/<묶음>` 으로 어느 단계까지 커밋됐는지 보고(커밋 메시지 머리에 단계가 있다), `git worktree list` 로 남은 작업 폴더에 커밋되지 않은 변경이 있는지 본 뒤(쓸 만하면 그 폴더에서 WIP 커밋), 다음 단계부터 이어서 한다. 새 컨테이너라 `wf/<묶음>` 이 없으면 주 브랜치에 합쳐진 덩어리 다음부터 한다 — 덩어리가 관문을 통과할 때마다 주 브랜치에 합쳐 푸시해 두므로(`git log --grep "진행분 합치기"`), 어디까지 왔는지는 `docs/ROADMAP.md` "진행 중"과 그 설계서 끝의 "구현 메모 (진행 중)"에서 본다. 기준 수치(0단계)는 그 묶음을 시작하기 전의 커밋을 `git archive` 로 풀어 다시 잰다.
8. 작업자의 모델이 한도에 걸리면 같은 덩어리를 다른 모델로 다시 세운다(브랜치 규칙 덕에 커밋된 데까지는 남는다).

묶음별 덩어리(설계서 "구현 순서" 표의 단계 번호 — 검토 앞까지가 구현, 마지막이 문서 단계):

| 묶음 | 포트 | 먼저 해 두는 앞 단계 (결과 불변 — 앞 묶음의 검토·문서와 겹쳐 돌린다) | 그 뒤의 구현 덩어리 | 문서 단계 |
|---|---|---|---|---|
| R1 `wf/crews` | 5211 | — (첫 묶음) | `0·1` → `2a·2b` → `3·4` → `5` → `6·7` | 8 |
| H1 `wf/injuries` | 5210 | `1·2` (기록만·화면) | `0`(기준)`·3` → `4a-1·4a-2` → `4b·4c` → `5·6` | 7 |
| X6 `wf/catastrophe` | 5216 | `1` (상태만) | `0·2` → `3·4` → `5` → `6·7` → `8·9` | 10 + 문서 |
| R2 `wf/methods` | 5213 | `0` (틀) | `1a` → `1b·1c·1d` → `2·3` → `4·5·6` | 문서(선택 7) |
| R3 `wf/doctrine` | 5219 | `0` (틀) | `1` → `2` → `3·4·5`(나란히 — `fields-parallel.js`) → 합치기·균형·속도 → `6·7` | 8 |
| I1-b `wf/causality` | 5218 | `b0` (기록만 잇기) | `b1·b2` → `b3` 규칙 1~6 → `b3` 규칙 7~11 → `b4·b5` | 문서 |
| I2 `wf/persist` | 5232 | `1` (틀) | `0·2` → `3·4` → `5` → `6·7` | 8 |
| N8 `wf/kinds` | 5236 | `1·2a·2b` (틀 — 유형을 자료로 · 자료형과 등록 자리 · 새 부대의 자리) | `0·3` → `4a·4b` → `5·6a` → `6b·7` → `8·9` → `10` | 11 |
| N9 `wf/kinds2` | 5237 | `1·2·3` (틀 — 자료형과 등록 자리 · 새 부대의 자리 · 지도 덧붙이기, 결과 불변. 단계 3 의 해시가 바뀌면 3 을 빼 `0·3·4` 로) | `0·4` → `5·6` → `7·8` → `9` | 10 |

**겹쳐 돌리기**(2026-11-15 부터, 사용자 요청: 더 빠르게). 묶음 N 의 검토·문서 단계가 도는 동안, 묶음 N+1 의 "먼저 해 두는 앞 단계"를 다른 작업 폴더에서 한다(워크플로를 하나 더 띄운다 — `only: 'impl'`, 덩어리 하나). 규칙:

- 그 작업자는 **주 브랜치의 그때 HEAD**(묶음 N 의 구현 덩어리가 모두 합쳐진 자리)에서 갈라 `wf/<N+1>` 을 만든다. 0단계 가운데 **해시 목록만** 자기 시작점에서 만들고, 자기 변경 전후의 해시가 한 글자도 다르지 않은지로 검증한다. 균형 기준(`before-*` sweep)은 재지 않는다 — 묶음 N 의 균형이 아직 확정되지 않았다.
- 묶음 N 이 주 브랜치에 다 합쳐지면, N+1 의 다음 작업자가 **맨 먼저** `git merge <주 브랜치>` 로 받아 충돌을 풀고(`npx tsc --noEmit`·`npx vitest run`·해시 목록 다시 확인) 그 뒤 0단계(기준 재기)부터 이어 간다. 이때부터 `git diff <주 브랜치>..wf/<N+1>` 이 N+1 만의 변경이다.
- 결과를 바꾸는 단계는 겹치지 않는다(기준 수치가 흔들린다). 겹쳐 도는 동안에는 기계(CPU 4개)를 나눠 쓰므로 명령이 느리고 시간 측정이 흔들린다 — 교대당 시간은 전후를 번갈아 재고, 시간 초과로만 실패한 테스트는 그것만 다시 돌린다.
- 앞 단계 작업자는 `README.md`·`CLAUDE.md`·`docs/ROADMAP.md`·이 문서·앞 묶음의 설계서를 고치지 않는다(앞 묶음의 문서 작업자가 고치는 중이다). 자기 설계서 끝의 "구현 메모 (진행 중)"만 쓴다.
- **준비 줄**(2026-11-15 저녁부터 — 더 빠르게): 앞 단계들은 묶음 N 의 검토·문서를 기다리지 않고, 주 줄(결과를 바꾸는 구현 덩어리)과 **나란히 한 줄로** 계속 돈다. 차례는 `X6 1` → `R2 0` → `I1-b b0` → `R3 0`(R2 의 틀 `chooseMethod` 가 있어야 한다) → `I2 1`(H1 의 `outShifts` 가 합쳐진 뒤). 준비 작업자 하나가 끝나 관문을 통과하면 주 세션이 주 브랜치에 합치고(`git merge --no-ff`, 커밋 제목 "<묶음> 준비 합치기: …") 다음 준비를 그때의 주 브랜치 HEAD 에서 띄운다. 주 줄의 덩어리는 시작할 때마다 주 브랜치를 받으므로(`git merge --no-edit <주 브랜치>`) 준비 단계의 변경이 그때 들어온다 — 충돌은 대개 합집합·객체 글자의 끝에 양쪽이 줄을 더한 것이고 둘 다 남기면 된다. 준비 단계는 뒤 묶음의 이름에 기대지 않게 쓴다(아직 없는 앞 묶음의 함수는 부르지 않고 구현 메모에 "이어받을 자리"로 적는다). 묶음 N 의 독립 검토자가 `git diff <기준>..wf/<N>` 을 볼 때는 다른 묶음의 준비 커밋이 섞여 있으므로, 그 묶음의 자기 파일(설계서 "고칠 파일"의 자기 파일 절)을 빼고 본다.

워크플로 대본은 `docs/specs/workflows/` 에 옮겨 두었다(`package-run.js` — 묶음 하나를 덩어리로 돌리는 대본, `design-incident-kinds.js` — 설계서를 쓰는 대본, 쓰는 법은 그 폴더의 `README.md`). 다른 세션·다른 모델은 그 파일을 Workflow 도구에 그대로 넘겨 쓴다. 요지: 덩어리마다 작업자에게 주는 지시는 ① 맡은 단계와 설계서를 처음부터 끝까지 읽으라는 것 ② 위 2번의 브랜치 규칙 ③ 맡은 단계만, 앞 단계의 완료 조건이 비어 있으면 그것부터 ④ 설계서의 줄 번호·함수 이름이 코드와 다르면 코드를 따르고 보고에 적기 ⑤ 테스트를 건너뛰거나 기준 범위를 고치지 않기 ⑥ 끝낼 때 구조화된 보고(끝낸 것·못 한 것·설계와 다른 곳·설계서 밖에서 고친 공용 파일·수치·알려진 문제·관문 통과 여부)다. 다음 작업자에게는 앞 작업자들의 보고 요약을 함께 준다.

**화면 쪽은 따로**(결과를 바꾸지 않으므로 시뮬레이션 순서와 무관하게 합칠 수 있다):

- **G5** — 구현됨(`9ab7fdb`). 뒤 묶음(G4·X6·R1·R2·H1)은 G5 설계서 끝 "구현 메모"의 이름(`shake(sid, ts, v?)`·`DECISIVE`·`ACTION_W`·`legacy()`·`fxSprites()`·`recShot(…, hostage?)`)을 쓴다.
- **G4** — G5 다음. G5 의 위 이름과 `tests/combatfx.test.ts` 의 가짜 캔버스에 기댄다(G4 §4.3·§8·§12-4·§16). H1·X6 보다 먼저 합치면 X6 가 G4 의 가스·천장 그림과 시험 둘을 고치고(X6 §7.3), 나중에 합치면 G4 가 X6 의 `placeMarks`·`FallRecord` 값·그리는 자리를 그대로 받는다(G4 §16). 시뮬레이션 묶음이 먼저 합쳐질 때마다 §11 의 장면 시각을 `find.ts` 로 다시 잰다.
- **U2** — 구현됨(`f4e44be`).

## 설계서 사이의 정본

여러 설계서가 함께 쓰는 이름은 정본 한 곳에서 정하고, 다른 설계서는 그 이름을 쓰거나 정본을 가리킨다. 어긋나 보이면 정본을 따른다(이미 구현된 것은 코드가 정본).

| 공유하는 것 | 정본 |
|---|---|
| 편성·역할·개인 장비(`KitId`·`Responder.kit`·`hasKit`·`kitWorks`·`kitLive`·`toolUse`·`fieldCrew`·**`minField`**·`seatsOf`·`skillsOf`·`makeAgent`·`briefFacts`) | R1 §3·§4 — 구현됨: 코드(`src/sim/crews.ts`, `field/agents.ts`)와 R1 구현 메모가 정본 |
| 장비를 감싼 판단 층(`gear.ts` — `kitCount`·`bestTool`, R3 의 `kitHas`·`kitQty`·`gunOf`·`roleIdOf`·`groupOf`·`crewHas`) | R2 §3.3 (R3 §2.4 가 더한다) |
| 부상 필드·피해 경로(`InjuryCause`·`Injury`·`hurt*`·`protection`·`bandOf`·`MateBelief`·`outShifts`·`RosterOut`·`crewReady`/`crewOk`·`seatsUsed`·결원 규칙) | H1 §2·§3. 결원 규칙은 사용자 최종 결정(2026-11-15): **부대의 운용 중단은 그 부대 대원이 전부 숨졌을 때만** — 다치거나 일부가 숨진 부대는 −18 감점만 받고 계속 출동한다. 배정에서 빠지는 것은 걸을 수 있는 대원이 하나도 없을 때(전원 순직·모두 쓰러짐·모두 후송 — 규칙이 아니라 사람이 없어서)뿐이고, `crewReady` 는 걸을 수 있는 대원 수, `crewOk` 는 온전한 대원 수다(H1 §3.6·§6.4·§12.3). I2 의 예비 인력도 같은 정신(나올 대원이 한 명도 없을 때만 `oos` — I2 §3.2) |
| 다친 대원의 일 — 사용자 결정(2026-11-15, "가벼운 일은 계속"): 걸을 수 있는 다친 대원(`injured`, 후송되지 않음)은 부대에 남아 다음 현장에도 내리고 가벼운 일만 맡는다. 목록 `LIGHT_WORK`(`traffic`·`perimeter`·`negotiate`·`interview`·`hookup`, 안전 구역의 `treat`·`treatMate`) | H1 §2.5·§2.7·§3.6a (R3 의 부상 줄 P12·F14·E11·G01 이 같은 목록을 쓴다. R2 는 다친 대원이 `risk > 0` 인 방법을 고르지 않는다 — R2 §3.4. 교대를 넘는 결장은 그대로 `outShifts` — I2 §3.2 끝) |
| 물 위 대원의 피해 하한 18 | R2 §3.5 |
| 방법(`MethodId`·`MethodWhy`(평소 = `usual`)·`MethodUse`·`METHOD`·`chooseMethod(…, dc)`·`methodFit`·`WORK_MODE`) | R2 §3 (R3 §3.7 이 행과 까닭 사상 표를 더한다) |
| 폭파 진입 — 사용자 결정(2026-11-15). 방법 `MethodId 'charge'` = G5 `BreachHow 'charge'`(그림 이름), 장약 `KitId 'charge'`, 농성 문 잠금 `BARRICADE_P`(실제 이름 `rules/methods.ts` 의 `BARRICADE.p` 0.4) | R2 §4.2a (장약은 R1 §4 표·진입대원(파괴)·폭발물 처리 요원, 고르는 때는 R3 S26, 그림·소리는 R2 가 G5 의 진입 그림 자리에 갈래로 더한다). 같은 날의 다른 결정: H1 자해 끔(`SELF_HARM = 0`), 문 그림은 G5 기본값 그대로. 결원 규칙은 그 뒤 사용자 최종 결정으로 바뀌었다(위 H1 줄 — 최소 편성 부대의 결원 중단 안은 쓰지 않는다) |
| 교본(`DocCtx`·`docCtx`·`DocWhy`·`crew` 사실·`docMethodMul`·`PAIRS`·탄약 `fireRound`) | R3 §2 — 구현됨: 코드(`field/doctrine.ts`·`field/doctrine/registry.ts`·`field/doctrineRun.ts`)와 R3 구현 메모의 "최종 요약"이 정본 |
| 위험 상태(`CatState`·`OpsState`·`SignBelief`·`PlaceMark`·`Sim.placeMarks`·`DANGER_RULES`·`trapped`·경계 1칸 갇힘의 `cat:` 흐름) | X6 §2·§4 — 구현됨: 코드(`field/catastrophe.ts`·`field/ops.ts`·`field/orders/catastrophe.ts`)와 X6 구현 메모의 "최종 요약"이 정본 |
| 세계 상태·신호(`WorldState`·`SignalKind`·`signal()`·`placeState`·**`knownBuildingAt`**·`I.blockEv`·`blast` 신호의 범위) | I1 §3.3·§3.4 |
| 쓸 수 있는 건물(`placeUsable`)·이어받은 상태(`Carryover`·`carryState`·`s.wear`) | I2 §3.6·§2 |
| 문제 코드 | 코드마다 그것을 더하는 설계서: `RESPONDER_KILLED`·`SUSPECT_DIED` H1 §3.8, `METHOD_FAIL` R2 §3.8, `DANGER_SIGN`·`WITHDRAWAL`·`STRUCT_COLLAPSE`·`EXPLOSION`·`BURNOUT` X6 §5.10, `HOSPITAL_FULL`·`INFRA_FAIL` I1 §3.3, `UTIL_LATE`(`PROBLEM_SYS` 'infra')·`ANIMAL_LOST`('field') N8 §4.2·§4.3·§5.3.6, `DECON_LATE` N9 §5.10. `order` 의 자리(9줄 컷)는 X6 §5.10 |
| 기록 문구 규칙(`PHRASE` T1~T8) | I1 §2.3 = `scripts/metrics.ts`(코드). 문구를 바꾸는 묶음이 함께 넓힌다(H1 §3.4·§3.6) |
| 흔들림 | G5 구현(`FxBook.shake(sid, ts, v?)`) + G4 `sceneShake(sim, s, mini, extra, reduced)`(G4 §4.3) |
| 효과 종류·결정적 순간(`Fx.kind`, `DECISIVE`, `ACTION_W`, `legacy()`) | G5 구현 메모. 새 종류는 더하는 설계서가: `'collapse'` G4 §3.1, `'horn'` X6 §2.2 |
| 그리는 순서(현장 층)·무너짐 그림 기록(`markRuin`·`recordFall`·`FallRecord`·`RUIN_*`) | G4 §4.6·§3 |
| 사건 유형의 자료(`TYPE_ORDER`·`typeIdx`·`TYPE_DEFS`·`LIK_FLOOR`·`LikMap`·`likRow`)·새 유형을 더하는 절차·화면 색(`typeStyle.TYPE_COLOR`)·카드 제목에서 빼는 시나리오(`Scenario.card`·`NO_CARD`) | N8 §5.1·§5.2·§5.12 (N9 의 `crowd` 가 같은 절차를 따른다) |
| 유관 기관(`Dept`·`UnitField` 의 `'civil'` — 지휘하지 않음·첫 도착 아님·길가 대기·`utility` 밖에서는 선택 수요)·새 수요 열쇠(`utilPower`·`utilGas`·`utilWater`·`tow`·`capture`)·새 부대의 일 좁히기(`kindFit`·`KIND_AUX`)·이름표 가점(`kitBonus` 의 `LABEL_BONUS`)·`capableOf` 의 대상 인자 | N8 §5.3 |
| 짧은 사건(`daily` 흐름·`DAILY_TOTAL`·`isDailyLoad`)·비응급 신고(`closeReason 'screened'`·`dispatch/screening.ts`·`kindsCaller` 의 `verifyAnswer`·`sameAnswer`·`Incident.dupOf`) | N8 §5.4·§5.5 |
| 묶음 규칙의 등록 자리(`registerPending`·`registerCasHold`·`registerPropHold`·`registerVerdict`)·통제 임무 `cordon`·세계 규칙의 강제 보고 | N8 §5.7·§5.10·§5.16·§5.17 |
| 장면의 새 진실(`Scene.kinds`·`KindsState`·`Scene.animals`·`Animal`·`AniBelief`·`exitKind`)·높은 자리(`T.LEDGE`·`Scene.rules` 의 `'perch'`·`CasBelief.perch`)·설득(`persuade`)·민감 소재(`Casualty.quietLoss`·`TYPE_DEFS.floorHp`)·새 사실의 id 범위 | N8 §5.8~§5.13 |
| 군중 밀도와 흐름 자리(`CrowdState`·`CrowdZone`·`FlowSpot`·`Scene.flowSpots`(생김새)·밀도 문턱 1.15)·용의자 보류(`registerHosHold`·`Hostile.crowdRole`·`dispersed`·믿음 `tag`·`threw`) | N9 §5.6 (판정의 `dispersed` 는 §5.15) |
| 독성 공기(`s.kinds2.tox`·`haz air` 의 `gas`)·오염과 제독(`contamIds`·`CasBelief.dirty`·임무 `decontam`·수요 열쇠 `decon`·`DECON_LATE`)·깊이 없는 잠수(`underIds`·`CasBelief.sunk`·방법 `dive`·실행부의 잠수 갈래) | N9 §5.4·§5.5·§5.10 (수요 열쇠는 §5.3.1) |
| 바람(`Scene.windDir` — 생김새)·물로 바뀌는 칸(`setWater`)·체력 하한의 장면 값(`s.kinds2.floorHp`·`floorOf`)·N9 사실의 id 범위(`kinds2Ids.FACT_ID`)·`s.rules 'sightline'` | N9 §5.7·§5.13·§5.14·§5.16·§5.4 |
| 결과 불변으로 덧붙인 장소(`cityPlan.LATE_LANDMARKS` — `buildPlaces` 의 4)와 5) 사이, 종류가 아직 어떤 표에도 없을 때만) | N9 §4.9·§5.8 |
| 구현 순서 | 이 문서 "구현 순서" (= `docs/ROADMAP.md`) |

## 1. 끼워 넣는 자리 (확장 지점)

큰 파일의 분기문을 여러 사람이 동시에 고치지 않도록, 묶음마다 **자기 파일**이 있다. 새 내용은 되도록 여기에만 쓴다.

| 무엇 | 파일 (`<묶음>` = crime · major · disaster) | 등록 방법 | 진실을 읽어도 되는가 |
|---|---|---|---|
| 시나리오 표 | `src/sim/scenarios/<묶음>.ts` | 배열에 한 줄 (`Scenario`) | 관제가 아는 것만 (`needs` 의 `ScenarioCtx`) |
| 현장 생성 | `src/sim/field/scenes/<묶음>.ts` | `registerScene(type, variant, (sim, I, rng) => Scene)` | 진실을 **만든다** |
| 세계 규칙 | `src/sim/field/rules/<묶음>.ts` | `registerRule((sim, s, I) => void)` — 매 틱, 모든 현장 | 읽고 바꾼다 (`hazards.ts` 와 같은 자격) |
| 지휘 규칙 | `src/sim/field/orders/<묶음>.ts` | `registerOrders((sim, s, I, a, k) => void)`, `registerBlocker((sim, s, a) => boolean)` | **안 된다.** `a.beliefs` 만 (테스트 `tests/ext.test.ts` 가 `s.props`·`s.casualties`·`s.hostiles`·`.truth` 를 잡는다) |
| 소품 그림 | `src/view/scene/skins/<묶음>.ts` | `CRIME_SKINS` 등에 `skin 이름: (g, p, timeMs, truth, simT) => void` | 화면 계층 (읽기만) |
| 테스트 | `tests/<묶음>.test.ts` | 새 파일 | — |

`Scenario` 의 칸 (`src/sim/scenarios.ts` 에 주석과 함께 있다):

```ts
{ type, variant, name, share, nature, vague, severity: [lo, hi], tag,          // 필수. tag = 'crime' | 'major' | 'disaster'
  places,          // 일어나는 건물 종류의 몫 (없으면 cityPlan.INCIDENT_PLACES[type])
  node,            // (sim, rng, busy) => 교차로 id | null — 건물이 아니라 길 위에서 일어나는 시나리오
  texts, lik,      // 신고 문구(nature 키), 그 문구가 각 유형일 가능도 8개 (화재·교통·실종·무장·응급·붕괴·가스·수난)
  label,           // 관제가 붙이는 이름 (없으면 name)
  needs,           // (n, ctx) => void — 신고가 이 시나리오를 가리킬 때 필요 자원을 고친다
  limit,           // 현장 한계 시간에 더하는 초
  delay,           // [lo, hi] 발생 → 첫 신고
  gate,            // (sim) => boolean — 지금 일어날 수 있는가
  onCreate,        // (sim, I) => void — 사건·현장이 만들어진 직후
  onClose }        // (sim, I, reason) => void — 판정 직후 (이어지는 사건 예약, 도로 복구)
```

- 평소 추첨: `tag` 가 `major`·`disaster` 가 **아닌** 시나리오만, 유형이 정해진 뒤 `share` 만큼. 한 유형의 `share` 합은 0.75 를 넘지 않는다(테스트).
- 대형 사고(`tag: 'major'`): 교대마다 `tune.majorProb` 로 많아야 한 번, `sim.rngMajor` 로 고른다. `share` 는 대형 사고끼리의 비중.
- 재난에 딸린 시나리오(`tag: 'disaster'`): 추첨되지 않는다. `disaster.ts` 가 `createIncident` 로 직접 일으킨다.
- `share: 0` 이면 추첨되지 않고, 예약(`gen.chain`)이나 직접 호출로만 일어난다.

**사건을 정해서 일으키기** — `incidents.createIncident(sim, opts)`:

```ts
createIncident(sim, { type: 'armed', variant: 'hostage', placeId: 123, parent: I.id, note: '납치범이 숨어든 곳에서 제보가 들어옵니다', rng });
sim.gen.chain.push({ at: sim.t + 60, opts: { type: 'fire', variant: 'arson', placeId, parent: I.id, note: '…' } });   // 나중에 일으키기
```

`rng` 를 주면 그 흐름으로 만들고 평소 생성기의 상태를 건드리지 않는다. **새 기능의 난수는 반드시 새 흐름**: `sim.rng.fork('이름:' + I.id)`.

**현장에 유형 밖의 규칙 얹기**: `s.rules = ['gas']`(가스 확산·폭발), `['water']`(표류), `['collapse']`(2차 붕괴). 유형의 규칙에 더해 돈다.

**이미 들어가 있는 공용 자료형** (`types.ts` — 다시 추가하지 않는다): 교통용 `RoadEdge.known`·`bump`·`wait`·`gateT`·`noHeavy`, `Unit.heavy`·`backing`, `ShiftReport.traffic`, `WorkKind 'defuse'`(+ `workLabel`, `fitFor`: 폭발물 처리반만), `PropKind 'bomb'`(`real`, `fuse`), `Needs.eod`·`UnitCaps.eod`(관제·배정·인근 도시 지원까지 연결됨), `Scene.rules`·`glass`·`decorHp`, `Fx 'glass' | 'debris'`, `Pursuit.kind 'getaway'`·`hideout`, `Incident.tag`·`parent`, `ShiftReport.major`·`disaster`, `Difficulty.disaster`, `Tuning.majorProb`·`disasterProb`, `hazards.blast`(export).

## 2. 파일 소유 — 남의 파일을 고쳐야 할 때

- **자기 파일**(위 표 + 문서에 적힌 것)은 마음대로.
- **공용 파일**(`types.ts`, `commander.ts`, `executor.ts`, `hazards.ts`, `agents.ts`, `builders.ts`, `debrief.ts`, `incidents.ts`, `pursuit.ts`, `dispatcher.ts`, `analyst.ts`, `callSystem.ts`, `sceneManager.ts`, `renderScene.ts`, `renderCity.ts`, `panels.tsx`, `App.tsx`, `styles.css`)은 **각 문서의 "공용 파일 수정" 절에 적힌 곳만**, 가장 작은 조각으로 고친다.
  - 줄을 옮기거나 다시 정렬하지 않는다. 이름을 바꾸지 않는다. 포매터를 돌리지 않는다.
  - `types.ts` 는 추가만. 합집합 타입(`A | B`)의 끝에 붙일 때는 **새 줄**로(`  | 'x';` 를 한 줄 더) 붙인다.
  - `styles.css` 는 파일 끝에 `/* ── <묶음> ── */` 블록으로만.
  - 문서에 없는 곳을 고쳐야 하면 고치되, 끝낼 때 보고에 **파일·함수·이유**를 적는다.
- **절대 건드리지 않는 것**(각 설계서가 따로 허락한 경우 제외): `src/sim/city.ts`, `src/sim/cityPlan.ts`, `src/view/city/staticCity.ts`, `src/view/city/places.ts`, `tests/sim.test.ts`, `README.md`, `CLAUDE.md`, `docs/ROADMAP.md`, `docs/DESIGN.md`(합친 뒤에 한꺼번에 고친다).

## 3. 일하는 순서

```bash
ln -s /home/user/operator/node_modules node_modules      # 작업 폴더(worktree)에 의존성 연결 (없을 때만)
git checkout -b wf/<묶음>
npx tsc --noEmit                                          # 수시로
npx vitest run tests/<묶음>.test.ts                       # 자기 테스트 (수시로)
npx tsx scripts/sweep.ts 20 --force armed/bomb --scen     # 그 시나리오를 교대마다 한 번 일으켜 결과 표를 본다
npx tsx scripts/sweep.ts 1 --force armed/bomb --log S3    # 한 교대의 전체 기록 (왜 그렇게 끝났는지 읽는다)
npx tsx scripts/sweep.ts 30 --scen                        # 평소 교대에서의 분포
npm run check                                             # 끝낼 때 한 번 (5분쯤 걸린다. 여러 작업이 함께 도니 수시로 돌리지 않는다)
```

- **작은 것부터 끝내 커밋한다.** 시나리오 하나가 끝까지 도는 것을 확인할 때마다 커밋(메시지는 한국어, `wf/<묶음>` 브랜치에만). **푸시하지 않는다**(합치는 사람이 한다).
- 화면 확인: `npx vite --port <문서에 적힌 포트> --strictPort` 를 띄우고 `http://localhost:<포트>/?seed=S3&force=armed/bomb` 를 Playwright(`require('playwright')`, 설치돼 있다)로 열어 현장 화면을 찍어 본다. 콘솔 오류 0건. 찍은 그림·임시 스크립트는 저장소 밖(각자의 scratchpad)에 둔다.
- 재현성: `src/sim` 에서 `Math.random`·`Date`·`performance`·`window`·`document` 금지. 주기 판단은 `sim.t`·`sim.tick`.
- 모든 사건은 끝나야 한다. **새 시나리오마다 `--force` 로 20교대를 돌려 한계 시간·방치 종료가 2건 이하**가 되게 한다. 넘으면 기록(`--log`)을 읽고 원인을 고친다(대개 "기다리는 자원이 오지 않는다" 아니면 "닿지 못하는 자리"). 고치지 못하겠으면 그 시나리오의 `share` 를 0 으로 두고 보고에 적는다(반쯤 된 것을 켜 두지 않는다).
- 기록은 상태를 바꾸는 코드에서만 `emit()`. 화면 글자와 주석은 한국어, 조사는 `josa()`.

## 4. 끝났다고 말하기 전에

1. `npx tsc --noEmit` 통과, `npx vitest run tests/<묶음>.test.ts tests/ext.test.ts` 통과.
2. `npm run check` 통과(균형 범위를 벗어나면 자기 시나리오의 `share`·수치를 조정한다. 범위 자체는 건드리지 않는다).
3. 새 시나리오마다 `--force` 20교대의 결과 표와 한계 시간 건수.
4. 화면 확인(현장 그림이 있는 묶음): 스크린샷으로 직접 보고, 콘솔 오류 0건.
5. 측정 도구: `npm run sweep -- 40 --metrics` 로 지표 줄(연쇄 깊이·시스템 간 영향·재계획·대체 방법·행동 다양성·자원 경쟁·멈춘 시간·결과 다양성·기록 일치)을 전후로 견주고, `npm run check` 의 지표 관문(교착 후보 0·잊힌 사건 0·일치 검사)을 통과한다. 기록 문구를 바꿨으면 `scripts/metrics.ts` 의 문구 규칙과 `tests/causality.test.ts` 를 함께 고친다.
6. 화면 검사(화면을 고친 묶음): `npm run ui-check`(Playwright, 2분쯤, 8개 항목) 통과.
7. 보고(마지막 응답): 브랜치 이름과 마지막 커밋, 구현한 것 / 못 한 것, 시나리오별 결과 표, 고친 공용 파일(파일·함수·이유), 알려진 문제.
