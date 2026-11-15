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
| `I1-causality.md` | 인과관계·시스템 통합 | `wf/i1a` · `wf/causality` | I1-a 측정 도구(지표 여덟 가지·일치 검사·관문), I1-b 인과 규칙·세계 상태 결합(신호·규칙 11개·조건부 연쇄) | **I1-a 구현됨** (`48dba83`) · I1-b 다음 구현 세션 |
| `G4-scene-legibility.md` | 현장 가독성 | `wf/legibility` | 무너진 건물·가스가 찬 범위·되살아난 불·폭발 자리·붙잡힌 인질이 한눈에 — 결과 불변 | 다음 차례 (G5 뒤 — 이 세션에서 시간이 되면, 아니면 다음 구현 세션) |
| `R1-crews.md` | 부대 편성·개인 장비·헬기 | `wf/crews` | 부대마다 2~5명의 역할, 사람마다 장비(공기·탄·고장), 경찰·소방·의료 헬기 | 다음 구현 세션 (1) |
| `H1-injuries.md` | 부상과 사망 | `wf/injuries` | 대원·용의자·구조 대상이 한 모델로 다치고 숨진다 — 원인·방호·문턱·후송·결원·보고서 | 다음 구현 세션 (2) |
| `X6-catastrophe.md` | 위험의 현실화 | `wf/catastrophe` | 조짐 → 막는 조치·철수·외부 방어 → 실제 붕괴·폭발·전소 → 사상자·지도·보고서 | 다음 구현 세션 (3) |
| `R2-methods.md` | 대응 방식 다양화 | `wf/methods` | 같은 임무를 장비·능력·상황에 따라 여러 방법으로(헤엄 구조·보트·소화기·비살상탄·저격·폭파 진입 …) | 다음 구현 세션 (4) |
| `R3-doctrine.md` | 분야별 대응 교본 | `wf/doctrine` | 경찰·소방·의료·특수의 상황 × 장비 × 상태 교본 줄, 짝 규칙, 탄약·엄폐 | 다음 구현 세션 (5) |
| `I2-persistence.md` | 교대 간 지속 | `wf/persist` | 대원 상태·장비·건물·도로를 "이어받은 상태"로 다음 교대의 입력에 | 다음 구현 세션 (7 — I1-b 가 6) |

합치는 순서: M1 → N7 → N4b → N5 → N6 → T1 → U1 — **일곱 묶음 모두 구현돼 합쳐졌다(2026-11-14).** 그 뒤 같은 날 U2·I1-a·G5 를 구현해 합쳤다(설계서 없이 진행한 B1·B3·P1·Q1·Z1 도 합쳐졌다). 남은 설계서의 순서는 아래 "구현 순서" 절이다. 아래의 규칙은 다음에 묶음을 더할 때 그대로 쓴다. 각 설계서 끝의 구현 메모(또는 앞머리의 "구현 상태")가 실제 코드와 맞는 최신 내용이다.

## 구현 순서 (남은 설계서)

**시뮬레이션 쪽은 한 줄로 차례대로**: **R1 → H1 → X6 → R2 → R3 → I1-b → I2**(`docs/ROADMAP.md` "진행 중"과 같다). 모두 결과를 바꾸고 같은 파일을 고치므로 한 세션이 처음부터 이어서 한다. 단계마다 그 설계서의 0단계(기준 재기)를 **앞 단계를 합친 뒤에** 다시 잰다. 각 설계서는 앞 단계가 합쳐져 있다고 보고 썼고, 순서가 바뀌었을 때 쓸 대체를 따로 적었다.

| 단계 | 묶음 | 앞 단계에 기대는 것 | 앞 단계 없이 먼저 하면 (대체) |
|---|---|---|---|
| 1 | R1 | 지금 HEAD(B1·B3·P1·Q1·Z1·U2·I1-a·G5 를 합친 상태). B1 뒤에 기준을 잰다 | — (첫 단계) |
| 2 | H1 | R1 의 `armorOf`·`blastFactor`·`kitWorks`·`kitUses`·`medLevelOf`·`seatsOf`·`fieldCrew`·`makeAgent`·`startTransport` 의 병원 이름, G5 가 지운 피·'hit'. H1 은 `minField` 를 쓰지 않는다(결원 규칙 — 아래 정본 표) | H1 §12.2-5 (방호는 §2.4 의 "지금"·"새로" 열, `crewOk`·`crewLeft` 는 `u.crew`, 자리는 구급차 2·헬기 1) |
| 3 | X6 | H1 의 `hurt*`(`{ ev }`)·문턱·`agentHealth` 전이·`mateFact`·`MateBelief`, R1 의 `hasKit`·`kitWorks`·`kitLive`·`toolUse`·`makeAgent`·`briefFacts`. G4 가 먼저 합쳐졌으면 그 그림·시험 둘을 함께 고친다 | X6 §12.1 의 "R1·H1 이 먼저 합쳐지지 않았으면" 줄, §3.4 의 "R1 이 없을 때" 열, §7.2 의 "G4 가 아직이면" |
| 4 | R2 | R1 의 `KitId`·`KITS`·명부 고장 추첨·`hoist`, H1 의 `hurt*`·`protection('drown')`, X6 의 `exteriorSpot`·`spray(eff, wmul)`·`ops` 사실·`s.fan` 자리 | R2 §3.3 끝의 `gear.ts` 대체, §10 "R1 이 아직 없을 때" |
| 5 | R3 | R2 의 `chooseMethod(…, dc)`·`METHOD`·`WORK_MODE`·`gear.ts`, R1 의 `ROLES`·`KITS`·`capableOf`, H1 의 `bandOf`·`hurtF`·`treatMate`, X6 의 `DANGER_RULES`·`evacuate` | 대체를 두지 않는다 — 함수 이름이 다르면 실제 코드를 따른다(R3 §11.2-7). 순서를 지킨다 |
| 6 | I1-b | X6 의 `catastrophe` 신호·`placeMarks`·`I.blockEv`, R1 단계 3 의 출발 문구(C5 관문), H1 의 넓힌 문구 규칙(T4·T6)·`u.oosEv` | I1 §3.10(X6 와 함께 넣을 부분 — 빈 `world/consequence.ts`), §3.11 1단계(R1 이 출발 문구를 안 고쳤으면 b1 에서) |
| 7 | I2 | H1 의 `outShifts`·`RosterOut`, R1 의 `minField`·`skillsOf`·`STAFF`, X6 의 `placeMarks`·`placeUsable` 로 옮길 세 검사, I1-b 의 `knownBuildingAt`·`placeState`·`WorldTag`·`rubble` | I2 §3.2 의 "H1 이 아직 합쳐지지 않았으면", §11.1-3("앞 묶음의 이름" — 구현 전에 실제 이름 확인) |

**화면 쪽은 따로**(결과를 바꾸지 않으므로 시뮬레이션 순서와 무관하게 합칠 수 있다):

- **G5** — 구현됨(`9ab7fdb`). 뒤 묶음(G4·X6·R1·R2·H1)은 G5 설계서 끝 "구현 메모"의 이름(`shake(sid, ts, v?)`·`DECISIVE`·`ACTION_W`·`legacy()`·`fxSprites()`·`recShot(…, hostage?)`)을 쓴다.
- **G4** — G5 다음. G5 의 위 이름과 `tests/combatfx.test.ts` 의 가짜 캔버스에 기댄다(G4 §4.3·§8·§12-4·§16). H1·X6 보다 먼저 합치면 X6 가 G4 의 가스·천장 그림과 시험 둘을 고치고(X6 §7.3), 나중에 합치면 G4 가 X6 의 `placeMarks`·`FallRecord` 값·그리는 자리를 그대로 받는다(G4 §16). 시뮬레이션 묶음이 먼저 합쳐질 때마다 §11 의 장면 시각을 `find.ts` 로 다시 잰다.
- **U2** — 구현됨(`f4e44be`).

## 설계서 사이의 정본

여러 설계서가 함께 쓰는 이름은 정본 한 곳에서 정하고, 다른 설계서는 그 이름을 쓰거나 정본을 가리킨다. 어긋나 보이면 정본을 따른다(이미 구현된 것은 코드가 정본).

| 공유하는 것 | 정본 |
|---|---|
| 편성·역할·개인 장비(`KitId`·`Responder.kit`·`hasKit`·`kitWorks`·`kitLive`·`toolUse`·`fieldCrew`·**`minField`**·`seatsOf`·`skillsOf`·`makeAgent`·`briefFacts`) | R1 §3·§4 |
| 장비를 감싼 판단 층(`gear.ts` — `kitCount`·`bestTool`, R3 의 `kitHas`·`kitQty`·`gunOf`·`roleIdOf`·`groupOf`·`crewHas`) | R2 §3.3 (R3 §2.4 가 더한다) |
| 부상 필드·피해 경로(`InjuryCause`·`Injury`·`hurt*`·`protection`·`bandOf`·`MateBelief`·`outShifts`·`RosterOut`·`crewReady`/`crewOk`/`crewLeft`·`seatsUsed`·결원 규칙) | H1 §2·§3. 결원 규칙은 사용자 최종 결정(2026-11-15): **부대의 운용 중단은 그 부대 대원이 전부 숨졌을 때만** — 다치거나 일부가 숨진 부대는 −18 감점만 받고 계속 출동하고, 모두 후송돼 빈 부대가 빠지는 것은 규칙이 아니라 사람이 없어서다(H1 §3.6·§12.3). I2 의 예비 인력도 같은 정신(나올 대원이 한 명도 없을 때만 `oos` — I2 §3.2) |
| 물 위 대원의 피해 하한 18 | R2 §3.5 |
| 방법(`MethodId`·`MethodWhy`(평소 = `usual`)·`MethodUse`·`METHOD`·`chooseMethod(…, dc)`·`methodFit`·`WORK_MODE`) | R2 §3 (R3 §3.7 이 행과 까닭 사상 표를 더한다) |
| 폭파 진입 — 사용자 결정(2026-11-15). 방법 `MethodId 'charge'` = G5 `BreachHow 'charge'`(그림 이름), 장약 `KitId 'charge'`, 농성 문 잠금 `BARRICADE_P` | R2 §4.2a (장약은 R1 §4 표·진입대원(파괴)·폭발물 처리 요원, 고르는 때는 R3 S26, 그림·소리는 R2 가 G5 의 진입 그림 자리에 갈래로 더한다). 같은 날의 다른 결정: H1 자해 끔(`SELF_HARM = 0`), 문 그림은 G5 기본값 그대로. 결원 규칙은 그 뒤 사용자 최종 결정으로 바뀌었다(위 H1 줄 — 최소 편성 부대의 결원 중단 안은 쓰지 않는다) |
| 교본(`DocCtx`·`docCtx`·`DocWhy`·`crew` 사실·`docMethodMul`·`PAIRS`·탄약 `fireRound`) | R3 §2 |
| 위험 상태(`CatState`·`OpsState`·`SignBelief`·`PlaceMark`·`Sim.placeMarks`·`DANGER_RULES`·`trapped`·경계 1칸 갇힘의 `cat:` 흐름) | X6 §2·§4 |
| 세계 상태·신호(`WorldState`·`SignalKind`·`signal()`·`placeState`·**`knownBuildingAt`**·`I.blockEv`·`blast` 신호의 범위) | I1 §3.3·§3.4 |
| 쓸 수 있는 건물(`placeUsable`)·이어받은 상태(`Carryover`·`carryState`·`s.wear`) | I2 §3.6·§2 |
| 문제 코드 | 코드마다 그것을 더하는 설계서: `RESPONDER_KILLED`·`SUSPECT_DIED` H1 §3.8, `METHOD_FAIL` R2 §3.8, `DANGER_SIGN`·`WITHDRAWAL`·`STRUCT_COLLAPSE`·`EXPLOSION`·`BURNOUT` X6 §5.10, `HOSPITAL_FULL`·`INFRA_FAIL` I1 §3.3. `order` 의 자리(9줄 컷)는 X6 §5.10 |
| 기록 문구 규칙(`PHRASE` T1~T8) | I1 §2.3 = `scripts/metrics.ts`(코드). 문구를 바꾸는 묶음이 함께 넓힌다(H1 §3.4·§3.6) |
| 흔들림 | G5 구현(`FxBook.shake(sid, ts, v?)`) + G4 `sceneShake(sim, s, mini, extra, reduced)`(G4 §4.3) |
| 효과 종류·결정적 순간(`Fx.kind`, `DECISIVE`, `ACTION_W`, `legacy()`) | G5 구현 메모. 새 종류는 더하는 설계서가: `'collapse'` G4 §3.1, `'horn'` X6 §2.2 |
| 그리는 순서(현장 층)·무너짐 그림 기록(`markRuin`·`recordFall`·`FallRecord`·`RUIN_*`) | G4 §4.6·§3 |
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
