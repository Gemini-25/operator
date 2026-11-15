# H1 — 부상과 사망

공통 규칙은 `docs/specs/README.md`. 브랜치 `wf/injuries`, 개발 서버 포트 **5210**.

사용자의 말: "대원이나 용의자, 요구조자의 부상이나 사망도 가능하게."

풀어 쓰면: 대원·용의자·구조 대상(요구조자) 세 부류 모두 사건 중에 다치고, 숨질 수도 있다. 원인(총상·자상·화상·연기·추락·잔해·폭발·익수·감전·탈진 등)에 따라 다치고, 다친 정도가 행동·처치·이송·판정·보고서·화면에 드러난다. 이미 있는 것(구조 대상의 사망, 대원의 부상·쓰러짐, 용의자의 `down`)은 살리고, 빠진 것과 세 부류 사이에 고르지 않은 것을 채운다.

이 문서는 다음 구현 세션이 이 문서와 `CLAUDE.md` 만 보고 끝까지 만들 수 있게 쓴다. 줄 번호는 2026-11-14 `1ca465d` 기준이다. 그 뒤 B1(1차)·B3·P1·Q1 이 합쳐져(`a746b77`) 이미 여러 줄이 밀렸고(예: `commander.manageAmbulances` 의 `firstLoad`·`redAboard` 는 542·544 → 589·591), 앞으로 R1·G5·G4 가 먼저 합쳐지면 더 바뀐다. **줄 번호가 아니라 함수 이름으로 찾는다**. 확신하지 못한 곳은 **(확인 필요)** 로 표시했다.

**자기 파일**(새로): `src/sim/field/injury.ts`(공통 모델), `src/sim/field/rules/injury.ts`(세계 규칙), `src/sim/field/orders/injury.ts`(지휘 규칙 — 믿음만), `src/view/triage.ts`(중증도 색 한 곳), `src/ui/PersonCard.tsx`(구조 대상·용의자 정보창), `tests/injuries.test.ts`.
**공용 파일 수정**: §12 의 표에 적힌 함수만, 가장 작은 조각으로(README §2).
**건드리지 않는다**: `city.ts`, `cityPlan.ts`, `view/city/*`, `renderCity.ts`, `dispatch/*`(`pickUnit` 의 두 줄과 `firstResponder` 의 한 줄만 — §6.4. 그 밖의 배정은 `crewReady` 로 충분하다), `tests/sim.test.ts`, `README.md`, `CLAUDE.md`, `docs/ROADMAP.md`, `docs/DESIGN.md`.

## 원칙

- **관찰용이다. 잔혹하게 그리지 않는다.** 피 웅덩이·튀는 붉은 조각·신체 훼손을 그리지 않는다. 중증도 분류 색(초록·노랑·빨강·검정), 들것·덮개, 자세, 기록 문구로만 전한다. 순직·사망은 담담하고 정중한 문장으로 쓴다.
- **세 부류가 한 모델을 쓴다.** 같은 원인 이름(`InjuryCause`), 같은 중증도 단계(`bandOf`: 경상·중상·위중·사망), 같은 기록(`Injury`), 같은 처치 공식.
- **피해는 한 길로만 준다.** 체력을 깎는 모든 곳은 `injury.ts` 의 `hurtCas`·`hurtResponder`·`hurtHostile` 을 거친다. 부상 기록(`Injury`)은 그 함수가 남긴다. 기록 문구(`emit`/`raiseProblem`)는 상태를 바꾸는 바로 그 코드가 남긴다(가짜 연출 금지) — 피해를 준 자리는 지금처럼 문구를 남기고 그 id 를 `hurt*` 에 넘기며, `hurt*` 는 피해 자체의 문구를 따로 남기지 않는다(로그 중복 — §2.7).
- **정보 격리.** 누가 얼마나 다쳤는지 지휘관은 보고(`mate`·`hos`·`cas` 사실)로만 안다. `commander.ts`·`orders/*`·`brain.ts` 의 판단부·`dispatch/*` 는 **다른 사람의** `health`·`bleed`·`injuries`·`dead`·`care` 를 읽지 않고, 그것을 읽는 함수(`needsHospital`)도 부르지 않는다 — 믿음 술어 `mateNeedsHospital` 을 쓴다. 대원이 자기 몸을 아는 것(`brain.ts` 의 `resp(sim, a).health`)은 된다. `commander.ts:542·544` 의 진실 읽기(`firstLoad`·`redAboard`)는 이번에 부대 기록과 믿음으로 바꾼다(§3.4).
- **재현성.** `s.rng` 의 호출 수와 순서를 바꾸지 않는다. 기존 피해량을 뽑는 `s.rng.range(…)` 는 그 자리·그 순서 그대로 두고 **뽑은 값만** 새 함수에 넘긴다. 새 확률은 `injuryRng(sim, s, purpose)` 만 쓴다(`damage.ts` 의 `dmgRng` 과 같은 모양에 목적 이름을 더한다: `sim.rng.fork('injury:' + s.id + ':' + purpose)` — 목적마다 흐름이 따로라 뒤 단계에서 소비자가 늘어도 앞 단계의 결과가 밀리지 않는다).
- **대원의 순직은 드물게.** 보통 난이도에서 교대 50번에 한 번 이하(§9).
- **모든 사건은 끝난다.** 쓰러진·숨진 대원, 쓰러진 용의자가 있어도 `LIMIT`·`hardCap`·`sceneManager` 7번 블록으로 끝나는지 본다.
- **관찰만 한다.** 사람을 눌러 정보창을 여는 것은 "관찰 대상 선택"이라 된다. AI 에게 명령하는 입력은 만들지 않는다.

## 연관 설계서와 나누는 선

구현 순서는 `docs/ROADMAP.md` "진행 중"대로 **R1 → H1 → X6 → R2 → R3 → I1-b → I2** 이고, G4·G5·U2 는 따로다 — G5(교전 연출)·U2 는 이번 세션이 구현해 합쳤고(G5 `9ab7fdb`, U2 `f4e44be`) G4 는 G5 다음에 들어간다(`docs/specs/README.md` "구현 순서"). 그래서 다음 구현 세션이 H1 을 시작할 때는 **R1 과 G5 가 이미 합쳐져 있다고 보고**, R1 이 없으면 각 절의 "R1 없이" 대체를 쓴다. 같은 날 쓰인 `R1-crews.md`(포트 5211)·`R2-methods.md`(5213)·`G4-scene-legibility.md`(5212)·`G5-combat-fx.md`(5225)·`X6-catastrophe.md`(5216)·`I2-persistence.md`(5232)를 읽고 이름을 맞췄다. **R1 이 먼저 합쳐지므로 R1 의 이름이 기준이다.** X6·I2 는 H1 뒤에 구현되므로 그쪽이 H1 의 이름(`hurt*`·`mateFact`·`outShifts`·`RosterOut`)을 쓴다.

| 설계서 | 겹치는 곳 | 나누는 선 |
|---|---|---|
| R1 부대 편성·개인 장비·헬기 | 방호, 처치 수준, 환자 자리, 결원, 들것, 테이저 | R1 이 부서 계수를 사람 장비로 옮긴다: `Responder.kit`, `hasKit`·`kitWorks`, `armorOf(sim, rid, engaging)`, `blastFactor(sim, rid)`, `scba`(공기 `uses`)·`turnout`, `medLevelOf(sim, rid)`, `seatsOf(u)`, `stretcher`, `taser`(0.72 확률로 3.2초 무력화). H1 의 `protection()` 은 이 함수들을 **읽기만** 하고(§2.4), 환자 자리는 `seatsOf`(쓰인 자리는 H1 의 `seatsUsed` — §3.4-5)를 쓴다. **H1 은 R1 의 `minField` 를 쓰지 않는다** — 운용 중단을 인원 문턱으로 정하지 않기 때문이다(사용자 최종 결정 2026-11-15, §3.6: 다치거나 일부가 숨진 부대는 −18 감점만, 운용 중단은 부대 대원이 전부 숨졌을 때뿐). `minField` 는 I2 의 예비 인력 문턱으로 남는다(I2 §3.2 적용 6). R1 의 `crewReady(sim, u)`(내리는 대원 `fieldCrew` 가운데 `status === 'ok'` 인 수)는 H1 이 `crewOk`(온전한 대원)로 이름을 옮기고, `crewReady` 는 "걸을 수 있는 대원 수"(온전한 대원 + 걸을 수 있는 다친 대원 — `unitArrived` 가 내리는 사람)로 다시 정의한다(§3.6). R1 이 `crewReady < fieldCrew.length` 로 바꾼 관제의 감점 줄은 `crewOk < fieldCrew.length` 로 옮긴다(§6.4). R1 의 경찰 역할에는 의료 가방(`bag`)이 없다(순찰 팀장만 `aed`). R1 은 `agentHealth`·`blast`·`tickHostiles` 의 피해 식에서 "방호" 부분만 함수로 꺼내 두고, H1 은 그 위에서 피해 식 전체를 `hurtResponder` 로 옮긴다. R1 뒤에는 대원이 보통 34명 → 63명으로 는다(부상 기회도 는다 — §9 는 R1 을 합친 뒤의 기준값으로 잰다) |
| R2 대응 방식 다양화 | 헤엄 구조(익수), 급박 구출·터널, 비살상탄·저격 | 원인 이름·`hurt*` 는 H1, 언제 그 방법을 쓰는가와 사고 확률(R2 의 `mrng`)은 R2. R2 가 `health` 를 직접 깎는다고 적은 자리는 아래처럼 `hurt*` 를 부른다: 헤엄 중 사고 → `hurtResponder(…, 'drown')`(방호는 R2 의 사고 확률 식이 `pfd`·`drysuit` 로 이미 줄였으므로 `protection('drown') = 0`), 급박 구출의 환자 −10 → `hurtCas(…, 'blunt')`, 터널 붕락 대상 −8·대원 −6 → `crush`, 비살상탄 −8 → `hurtHostile(…, 'blunt')`, 저격 −70 → `hurtHostile(…, 'gunshot', { down: true })`(§4.2 — 70 으로는 체력 100 에서 쓰러지지 않으므로 "한 번에 쓰러뜨림"을 켠다), 폭파 진입(`charge` — 사용자 결정 2026-11-15, R2 §4.2a)의 문 뒤 피해 → `hazards.blast` 가 원인 `'blast'` 로 세 부류의 `hurt*` 를 부른다(H1 이 고친 `blast` 그대로 — H1 쪽에 할 일은 없다). **물 위의 대원은 R2 의 규칙을 받아들인다(결정, 정본 R2 §3.5)**: R2 는 H1 이 있든 없든 물 위의 R2 피해(익수·사고·붙잡힘)를 `hurtResponder` 를 부르기 전에 `raw = min(raw, r.health − 18)` 로 자르고(0 이하면 부르지 않는다), 헤엄 중 체력 30 아래면 '위기' 사고로 끝내 뭍으로 보내며(`ashore`), 다른 피해로 물 칸에서 `down`·순직이 생기면 `rules/methods.ts` 가 그 대원을 가장 가까운 뭍 칸으로 옮긴다. H1 쪽은 두 가지만 지킨다 — ① `rescueMate` 실행기는 대상이 선 칸이 `T.WATER` 이면 끝내지 않고 물가에서 기다린다('물가 대기', `return` — 실패로 끝내면 8초 보류가 되풀이된다). 옮겨지면 실제 위치로 간다. ② 한 대원을 두 번 옮기지 않는다: R2 의 이동은 물 칸에 있을 때만, `rescueMate` 의 끌기는 뭍에서만 일어난다 |
| G4 현장 가독성 | `renderScene.ts`, `tickFire`·`tickCollapse` 의 붕괴 기록, 소리·카메라·자동 감속 | 'hit'·피 표현은 G5 가 이미 고쳤다(합쳐짐). G4 는 구조 대상 그림과 'hit' 효과를 건드리지 않고 딱지 그림 함수·사람 정보창도 만들지 않는다 — 사람 그림·딱지·`PersonCard` 는 H1 이 만든다. 붕괴 자리에는 G4 의 기록 한 줄과 H1 의 원인·갇힘이 함께 들어간다(둘 다 살린다). `audio.ts`·`marks.ts`·`MapLegend.tsx` 는 G4 가 맡는 파일이라 H1 은 소리 분기 하나(§8.6)만 더한다. 중증도 색은 `view/triage.ts` 한 곳(H1). G4 가 먼저 합쳐졌으면 G4 의 그림 원칙(크기·색·표지의 단계 — G4 §2)을 따른다 |
| G5 교전 연출 (H1 보다 먼저 구현) | 피 표현, 'hit' 효과, 피해 줄의 꼬리표 | G5 §3.9 가 `drawLying` 의 `blood` 옵션·붉은 타원과 'hit' 의 붉은 조각을 이미 지운다(흰 고리 + 회색 먼지 + 피격 불꽃). **'hit' 의 모양은 G5 를 따르고 H1 은 다시 그리지 않는다.** H1 은 남은 붉은 표현이 없는지 확인만 한다(§8.2, 시험 11-10). G5 는 H1 이 `hurt*` 로 바꿀 바로 그 피해 줄(`shootAt` 의 `if (hit)`, `tickHostiles` 의 대원 피격·흉기·맨손, 총격범의 시민 사격)에 `noteHit(lastFx(…))`·`recMelee(…)` 를 끼운다(G5 §2.4 표 3·5·6·7행). **피해 줄을 `hurt*` 로 바꿀 때 이 꼬리표 줄은 그대로 둔다**(피해 식과 무관하다). G5 는 합쳐졌다(`9ab7fdb`) — H1 은 'hit'·피 표현이 남지 않았는지 확인만 한다 |
| X6 위험의 현실화 (H1 다음, `X6-catastrophe.md`) | 실제 붕괴·폭발·전소의 사상자, 깔린 대원 | X6 가 사람에게 주는 피해는 모두 `hurt*`(원인 `crush`·`blast`·`burn`)를 부른다. 무너진 구획 안과 구획 밖 경계 1칸 안의 사람 결과는 X6 가 `cat:` 흐름으로 정하고(갇힘 작업량은 §5.1 과 같은 6~10, 반경은 X6 의 8 이웃), `injuryRng(…, 'trap')` 은 2차 붕괴(`tickCollapse`) 곁의 갇힘만 쓴다(X6 연관 표 H1 줄 — 정본 X6. 같은 목적 흐름을 둘이 나눠 쓰면 앞 소비자의 결과가 밀린다 — §12.2-11). X6 는 사람 피해 전에 기록(`raiseProblem`)을 먼저 남기고 모든 `hurt*` 에 `{ ev }` 를 넘긴다(X6 §4 머리) — 그래서 RESPONDER_HURT·RESPONDER_KILLED 의 원인(`a.hurtEv`)과 구조 대상의 `causeEvent` 가 그 붕괴·폭발 기록이다(§2.7). 대원 문턱(§2.6)은 X6 의 붕괴·폭발에도 걸린다 — 멀쩡하던 대원은 쓰러지고(체력 8) 출혈 0.04 이하. **용의자 문턱도 같다** — 쓰러지지 않은 용의자는 X6 의 붕괴 한 번으로 숨지지 않고 쓰러진다. X6 는 깔린 대원(`FieldAgent.trapped`)과 `mateFact` 의 `trapped` 칸, `rescueMate` 의 "먼저 잔해를 걷어 낸다" 분기를 더한다(H1 은 그 칸을 위해 `MateBelief` 끝을 비워 둔다). X6 는 깔릴 때 `a.trapped`·`a.trapEv` 만 세우고 `agentHealth` 의 쓰러짐 조건에 `(a.trapped ?? 0) > 0` 을 더한다 — 쓰러짐과 `r.tDown ??= sim.t` 은 `agentHealth` 가 한다(X6 §4.8) |
| I2 교대 간 지속 (K1 을 함께 끝낸다, `I2-persistence.md`) | 다음 교대 결장, 순직 | H1 은 교대 끝의 명부 상태(`ShiftReport.roster`)와 결장 표 함수 `outShifts(r)`(§3.7)를 **내놓기만** 한다. 저장과 `Sim` 생성자 입력은 I2 가 맡는다(I2 머리말과 연관 표의 K1 줄 — K1 의 완료 조건도 I2 가 함께 맡는다). I2 는 `rid` 가 부대 규모 손잡이에 따라 바뀌므로 이름을 열쇠로 쓴다 — 그래서 `RosterOut` 에 `name` 을 둔다. I2 는 H1 의 `outShifts` 를 불러 같은 표가 두 곳에 있지 않게 하고, `status 'off'`(결장) 대원의 `out` 만 자기 값으로 채운다 |
| R3 대응 교본 | 다친 대원의 행동, 용의자 호송 | R3 는 자기 판단 모드에서 H1 의 `bandOf`·`hurtF`·`r.bleed`(자기 몸)를 읽고, 남의 몸은 새 `crew` 사실(대원 자신의 신고 — R3 §2.4·§11.3-2)로 읽는다. `mate` 사실과 `mateNeedsHospital` 은 H1 의 구조·후송 판단에만 쓰고 R3 의 상태 입력으로는 쓰지 않는다. 지휘 쪽에서 `needsHospital`(진실)을 읽지 않는다. 경찰 호송은 H1 이 기계적으로 모델하지 않는다(§4.3) — R3 도 다루지 않는다(R3 §1 "하지 않는 것") |

---

## 1. 지금 상태

조사 근거는 파일:줄. 측정은 `npx tsx scripts/sweep.ts 3 …`(시드 3개뿐인 작은 표본).

### 구조 대상 (`Casualty`)

| | 지금 | 근거 |
|---|---|---|
| 상태 칸 | `health`·`bleed`(초당 악화)·`bleed0`·`mob`·`where`·`treated`·`treatQ`·`dead`, 타임라인 `tDiscovered … tDead … tHospital`, `causeEvent`(이벤트 id 하나). **원인의 종류를 담는 칸은 없다** | `types.ts:176-197` |
| 매 틱 악화 | `d = bleed`(신고자가 돌보면 ×0.5) + 연기 ×0.36(가스 누출 현장 ×0.62) + 불 칸 `2.6×fire` + 실외 노출 `s.exposure`. `loaded` ×0.5, `safe`+처치 ×0.6 | `hazards.ts:162-177` |
| 사건 중 새 부상 | 폭발 `blast`(체력만 −dmg×0.8×…, `mob`·`bleed` 그대로), 폭발물 `detonate`(여기만 `immobile`+`bleed` 올림), 인질 피격 `panicShot`·시한·빗나간 탄, 총격범, 가스 노출 시민 `bystander2`, 해일, 추격전 사고 | `hazards.ts:122-137,303-316,371-378,418-435,618-646`, `executor.ts:294-299`, `rules/crime.ts:20-35`, `rules/disaster.ts:81-104`, `builders.ts:248-262` |
| 사망 | `health ≤ 0` → `dead`, `casualty` imp 3(미발견이면 truth). 떠내려가 현장 밖 → `dead` | `hazards.ts:177-185, 664-677` |
| 처치 | `q = clamp(medical×(0.5+0.5×medLevel)×1.15, 0.2, 1)`, 처음이면 체력 +8q, `bleed = bleed0×(1−0.9q)`. 이송 중 처치(기록 없음) | `executor.ts:500-522`, `resources.ts:326-333` |
| 없는 것 | 원인 기록과 그것을 읽는 곳(`causeEvent`·`SimEvent.causes` 를 읽는 곳 0건). 악화로 걷던 사람이 멈추는 경로(체력 0 까지 걷는다). 2차 붕괴가 사람을 가두지 않음. 구출 중 사고. 종료 뒤 구급차 안에서 숨지면 판정(구조로 셈)과 기록이 어긋남(`incidents.ts:225`, `debrief.ts:36`). 병원 뒤의 결과. 경상(band 0)은 처치·이송 없음(`commander.ts:319-337`) | |

### 대원 (`Responder` + 현장의 `FieldAgent`)

| | 지금 | 근거 |
|---|---|---|
| 상태 칸 | `health`·`stamina`·`status`(`ok`·`injured`·`down`, 교대 내내). `FieldAgent.status` 에 `withdrawn`·`down`·`left`. 출혈·사망 칸 없음 | `types.ts:80-89, 254-280` |
| 다치는 경로 | 연기 >0.25: −(소방 0.1, 그 밖 1.3)×smoke/s. 불 >0.4: −(소방 2.6, 그 밖 9)×fire/s. 폭발(소방 ×0.7). 용의자 총격 25~41×(1−armor×0.6). 칼·맨손 8~16×(1.4/0.6) — **방호·기록·`lastBlockEvent` 없음**. 2차 사고 28~44(쓰러진 대원도 다시 친다). 해일 10~22 | `sceneManager.ts:126-149`, `hazards.ts:122-137, 470-497, 554-569`, `rules/disaster.ts:98-104` |
| 쓰러짐·부상 | `health ≤ 15` → `down`, RESPONDER_HURT '○○ 대원 중상'(imp 3). `< 40` → `injured`, RESPONDER_HURT '○○ 대원 부상'(imp 2), 후퇴 → `withdrawn` '부상 — 후송 대기' | `sceneManager.ts:138-148`, `brain.ts:33-47,77-82`, `executor.ts:914-921` |
| 사망 | **불가능.** `health < 1` 이면 1 로 고정. `src/sim` 에 '순직' 이 없다 | `sceneManager.ts:137` |
| 동료 구조 | 시야 안의 `down` 을 본 대원이 `mate` 사실 → 지휘관 `rescueMate`(0.97, 2명) → 안전 구역으로 끌고 가 `withdrawn`. 구급 부대가 없으면 'ems' 요청 | `agents.ts:204-210`, `commander.ts:340,370`, `executor.ts:891-913` |
| 그 뒤 | 처치·구급차·병원 없음(`canCarryPatients` 는 구조 대상만). 같은 부대의 active 대원이 떠날 때 함께 `left`. 교대 끝까지 회복 없음, 다음 현장에 내리지 못함, 전원 부상이면 `oos` | `executor.ts:970-973`, `sceneManager.ts:194-209`, `resources.ts:164,247,311-313` |
| 성능 영향 | 체력은 이동·작업·사격에 들어가지 않는다(40 아래로 물러나기 전까지 멀쩡) | `executor.ts:69-82`, `agents.ts:15` |
| 원인 | RESPONDER_HURT 의 원인은 `a.lastBlockEvent` — 진입로 차단 발견(`executor.ts:61`)에서도 바뀌어 엉뚱한 이벤트에 이어질 수 있다. 문구에 원인 낱말이 없다 | `sceneManager.ts:143,147` |
| 방호 | `Unit.armor`(부대 단위, `tune.armorMul`)는 총상에만, **모든 부대에** 적용된다(`1 − u.armor × 0.6` — 경찰 순찰 0.2·기동 0.5·특공 0.75·폭발물 0.6, 소방 진압·사다리·구조 0.1·화학 0.15·헬기·구조정 0.05, 구급 0). 소방의 연기·불·폭발 보호는 장비가 아니라 `dept === 'fire'` 계수(헬기·구조정 대원도 소방). 흉기·맨손·2차 사고·해일에는 방호가 없다 | `resources.ts:20-33,96`, `hazards.ts:128,487`, `difficulty.ts:102` |

### 용의자 (`Hostile`)

| | 지금 | 근거 |
|---|---|---|
| 다치는 경로 | 대원 사격 30~48(총을 든, 도주하지 않는 용의자에게만). 추격전 사고로 선 도주 용의자는 처음부터 48~78 | `executor.ts:276-308, 715-731`, `builders.ts:257` |
| 쓰러짐·사망 | `health ≤ 0` → **다음 틱** `tickHostiles` 가 `state = 'down'`, `resolve` imp 2 '○○ 제압됨.' 숨진 것인지 무력화된 것인지 **구분 없음**. 판정은 검거로 센다. 체력 100 에서 30~48 을 맞혀 가면 쓰러지는 순간 이미 0 이하인 경우가 약 78%(48~78 에서 시작하면 약 69%) — 몬테카를로 추정, 작은 실측(4교대)에서도 쓰러진 둘의 체력이 −15·−9 | `hazards.ts:345-349`, `debrief.ts:45` |
| 부상의 효과 | 체력 60 아래: 사기 −0.012/s, 이동 ×0.75, 도주 ×0.7 | `hazards.ts:381,393,513` |
| 없는 것 | 불·연기·가스·폭발 피해(`blast` 가 용의자를 건너뛴다). 칼·맨손 용의자는 맞지 않는다(덮쳐 검거). 처치·이송. 사망. 섬광탄은 기절 3.8초뿐 | `hazards.ts:122-137, 287-297` |

### 화면과 보고서

- **피 웅덩이가 있다**: `sprites.ts:169`(`blood` 옵션, 붉은 타원 둘). 넘기는 곳 `renderScene.ts:328`(구조 대상), `353`(쓰러진 용의자 늘 0.5), `398`(쓰러진 대원 늘 0.3). 'hit' 효과는 붉은 네모 조각 여섯 개(`renderScene.ts:636`).
- 사망색은 검정이 아니라 회색이고 두 곳이 다르다(`renderScene.ts:39` `#7d8791`, `styles.css:68` `.band-3` `#8a94a0`). 현장 범례에 사망이 없다(`App.tsx:185`).
- 대원·용의자는 들것·덮개 없이 늘 같은 모양으로 눕는다. 구조된 대원은 `withdrawn` 이 되어 다시 서 있게 그려진다(투명도 0.6). 떠내려가 숨진 사람이 현장 가장자리에 덮개를 쓰고 남는다.
- 정보창은 대원만(`Viewport.tsx:128-130` 은 `hit.cas` 를 버린다). 대원 칩의 `injured`·`down` 이 같은 색(`styles.css:275`).
- 보고서: '대원 부상' 수와 '이름 — 중상/부상' 목록뿐. 사망 문장은 시점만 말하고 원인을 말하지 않는다(`debrief.ts:135-145`). 교대 요약에 대원 피해 문장이 없다. `IncidentResult` 에 대원 중상·순직, 용의자 부상·사망 칸이 없다.
- 측정(시드 3): 보통 — 대원 부상 교대당 0, 구조 대상 111명 중 사망 10. `--force armed/shooter` — 대원 부상 0. `--diff 5,5,5,1,5,1` — 대원 부상 교대당 0.67.

---

## 2. 공통 부상 모델

### 2.1 자료형 (`types.ts` — 추가만, 합집합 끝에는 새 줄로)

```ts
/** 다친 원인 (세 부류 공통). 화면·보고서의 이름은 injury.ts 의 CAUSE_NAME */
export type InjuryCause =
  | 'gunshot' | 'stab' | 'blunt'                 // 총상 · 자상(흉기) · 타박상(맨손, 제압 중 맞섬)
  | 'burn' | 'smoke' | 'toxic'                   // 화상 · 연기 흡입 · 유독 가스 흡입(가스 누출 현장)
  | 'fall' | 'crush' | 'blast'                   // 추락·미끄러짐 · 잔해 깔림·낙하물 · 폭발
  | 'drown' | 'electric' | 'exhaustion'          // 익수 · 감전 · 탈진(열 탈진)
  | 'vehicle' | 'exposure' | 'illness';          // 차량 충격 · 실외 노출(저체온·탈수) · 급성 질환
/** 한 사람이 한 원인으로 입은 피해. 원인마다 한 줄로 합친다 (연기처럼 매 틱 더해지는 피해가 배열을 늘리지 않게) */
export interface Injury {
  cause: InjuryCause;
  dmg: number;        // 이 원인으로 깎인 체력의 합 (방호를 뺀 뒤)
  sev: number;        // 이 원인으로 다친 뒤 닿은 가장 나쁜 중증도 (0 경상 · 1 중상 · 2 위중 · 3 사망)
  t: number;          // 처음 다친 시각
  last: number;       // 마지막으로 더해진 시각
  by: number;         // 가해자 (byKind 에 따라 용의자 id 또는 대원 rid). 없으면 -1
  byKind: 'hostile' | 'responder' | 'world' | 'initial';
  ev: number;         // 이 부상을 처음 남긴 기록 (없으면 -1)
}
/** 교대 끝의 명부 상태 — I2(교대 간 지속)가 다음 교대의 입력을 만들 때 읽는다. I2 는 name 을 열쇠로 쓴다(rid 는 부대 규모 손잡이에 따라 바뀐다) */
export interface RosterOut { rid: number; name: string; health: number; band: number; dead: boolean; hospital: boolean; out: number; cause: InjuryCause | null }
/** 지휘관이 아는 동료의 상태 ('mate' 사실의 값). CasBelief 옆에 둔다. X6 가 끝에 trapped?: boolean 을 더한다 */
export interface MateBelief { x: number; y: number; status: 'down' | 'hurt' | 'safe' | 'evac' | 'light'; band: number; bleeding: boolean; tq: 0 | 1 | 2; dead: boolean; wasDown: boolean; since: number }
//   'light' = 처치 뒤 가벼운 일로 돌아온 다친 동료 (§3.6a) — 처치·후송·구조의 대상이 아니다
```

**합집합에 더하는 멤버는 그것을 구현하는 단계에서 더한다.** `WorkKind` 에 멤버를 더하면 `agents.ts` `workLabel` 의 `names: Record<WorkKind, string>` 에 키가 빠지고(TS2741), `fitFor()` 의 `switch` 가 모든 경우를 다루지 못해 반환문이 빠졌다는 오류(TS2366)가 난다. `ProblemCode` 에 더하면 `debrief.ts` `PROBLEM_LABEL: Record<ProblemCode, string>` 에 키가 빠진다. 그래서 `'RESPONDER_KILLED'` 는 4a, `'treatMate'` 는 4b, `'treatSuspect'`·`'SUSPECT_DIED'` 는 5단계에서 — 같은 커밋 안에서 `workLabel`·`fitFor`·`PROBLEM_LABEL`·`order` 를 함께 고친다. 단계 1 의 `types.ts` 에는 아래의 선택 칸과 새 자료형만 넣는다(합집합이 아니므로 tsc 가 깨지지 않고 결과도 그대로다).

있는 자료형에 더하는 칸(모두 선택 칸, 없으면 "다친 적 없음"):

```ts
// Casualty
injuries?: Injury[];
bleedCause?: InjuryCause;       // 지금의 bleed 를 만든 원인 (매 틱 악화를 이 원인으로 적는다). 없으면 그 항은 기록하지 않는다
deathCause?: InjuryCause;       // 숨지게 한 원인. 한 번 정해지면 바꾸지 않는다
lost?: boolean;                 // 물살에 휩쓸려 현장 밖으로 떠내려갔다 (tickWater 가 세운다 — 화면이 그리지 않을 사람을 가린다)
// Responder — "교대 내내 유지되는 상태"
injuries?: Injury[];
bleed?: number; bleed0?: number;      // 상처로 인한 초당 체력 감소, 처치 전 값
treatQ?: number;                      // 받은 처치 (0 없음 … 1 전문)
dead?: boolean;                       // 순직. status 는 'down' 그대로 둔다 (지금의 status === 'down' 검사가 모두 그대로 맞는다)
tDown?: number; tDead?: number;       // 쓰러진 시각, 숨진 시각
care?: 'aboard' | 'hospital';         // 후송 중 / 병원 인계됨
deathCause?: InjuryCause;
// Hostile
injuries?: Injury[];
bleed?: number; bleed0?: number; treatQ?: number; tTreated?: number;
dead?: boolean;                       // state 는 그대로('down' 또는 'arrested') 두고 따로 표시한다
tDown?: number; tDead?: number;
where?: 'scene' | 'aboard' | 'hospital';      // 없으면 scene
bleedCause?: InjuryCause; deathCause?: InjuryCause;
selfHarmRolled?: boolean;             // 자해 추첨을 이미 했다 (§4.5 — 용의자마다 한 번)
// FieldAgent
hurtEv?: number;                      // 마지막으로 다친 기록 — RESPONDER_HURT 의 원인으로 쓴다 (lastBlockEvent 대신)
hpTick?: number;                      // 이 틱이 시작될 때의 체력 — 대원 문턱(§2.6)의 기준. tickScene 1) 직전에 모든 대원에게 적는다
lastTile?: number;                    // 마지막으로 서 있던 칸 — 잔해 바닥에 "새로 들어섰는가"(§2.3 fall)
fellOnce?: boolean;                   // 이 현장에서 잔해 바닥 추락을 이미 겪었다 (대원당 사건당 한 번)
lightBack?: boolean;                  // 이 현장에서 가벼운 일로 이미 한 번 돌아왔다 (§3.6a — 다시 물러나면 다시 돌아오지 않는다)
// Unit
aboard?: { kind: 'mate' | 'suspect'; id: number; inc: number; t: number }[];   // 구조 대상이 아닌 환자 (대원 rid · 용의자 id). 자리 셈에는 다른 부대의 대원과 용의자만 넣는다 (§3.4-5)
firstLoadAt?: number;                 // 이번 이송에 처음 사람을 태운 시각 — manageAmbulances 가 s.casualties[…].tLoaded 대신 읽는다 (부대 자신의 기록)
// WorkKind 끝에 — 4b·5단계에서 (위의 "합집합" 규칙)
  | 'treatMate'      // 다친 대원 처치, 자리가 있으면 자기 구급차·헬기에 태운다 (구급 분야, 또는 R1 의 의료 가방 bag·alsBag·doctorKit 을 든 대원)  ← 4b
  | 'treatSuspect'   // 쓰러진·다친 용의자 처치, 지시받았으면 구급차에 태운다  ← 5
// ProblemCode 끝에 — 4a·5단계에서
  | 'RESPONDER_KILLED'   // 대원 순직  ← 4a
  | 'SUSPECT_DIED'       // 용의자 사망  ← 5
// IncidentResult 끝에
respondersDown?: number; respondersKilled?: number; suspectsHurt?: number; suspectsDead?: number;
deathCauses?: Partial<Record<InjuryCause, number>>;      // 숨진 구조 대상의 원인 집계
// ShiftReport
//   respondersHurt 의 원소에 rid?, band?, cause?, dead?, hospital?, out? 를 더한다 (name·callsign·status 는 그대로)
respondersKilled?: { name: string; callsign: string; cause: InjuryCause | null; incident: string }[];
suspectsHurt?: number; suspectsDead?: number;
roster?: RosterOut[];
```

**객체 모양**(P1 의 규칙 — CLAUDE.md "자주 도는 객체의 모양", R1 §3 끝·X6 §2.2 와 같은 방식): 위의 선택 칸은 도중에 생기게 두지 않고, 객체를 만드는 리터럴에 **같은 순서로** `undefined` 를 넣는다 — Casualty 칸(`injuries`·`bleedCause`·`deathCause`·`lost`)은 `kit.ts` 의 `addCas` 와 `hazards.ts` 의 주변 시민(`bystander2`) 리터럴, Unit 의 `aboard`·`firstLoadAt` 은 `resources.ts` 의 두 부대 리터럴(`createRoster`·`createAidUnit` — R1 의 새 칸 뒤, 같은 순서), FieldAgent 칸(`hurtEv`·`hpTick`·`lastTile`·`fellOnce`·`lightBack`)은 `agents.makeAgent`(R1 이 꺼낸 함수. R1 없이는 `sceneManager.unitArrived` 의 대원 리터럴), Responder 칸은 `createRoster`·`createAidUnit` 의 대원 리터럴, Hostile 칸은 용의자를 만드는 기존 자리(`kit.ts`·현장 생성기의 용의자 리터럴)에. 그러지 않으면 구조 대상·부대·대원 객체의 숨은 클래스가 갈라져 P1 의 속도를 잃는다.

`difficulty.ts` 의 `Tuning` 에 `injuryMul: number` 하나 — 심각도 손잡이에서 `[0.75, 0.9, 1, 1.12, 1.25]`(가운데 1). 새 난이도 손잡이(화면의 조절 막대)는 만들지 않는다.

### 2.2 중증도 단계 — 세 부류 공통

`hazards.ts:19` 의 `band` 를 `injury.ts` 의 `bandOf` 로 옮기고 `hazards.ts` 는 `export const band = bandOf;` 로 다시 내보낸다(식은 그대로: `h ≤ 0 → 3, h > 70 → 0, h > 40 → 1, 그 밖 2`). `renderScene.ts:311` 이 손으로 다시 쓴 같은 식도 `bandOf` 로 바꾼다.

**`injury.ts` 는 잎 모듈이다.** import 하는 것은 `types.ts`·`events.ts`(`emit`·`raiseProblem`)·`util.ts`(`clamp`·`josa`)·`rng.ts`(타입)·`engine.ts`(타입만, `import type`)와 R1 의 `crews.ts`(`armorOf`·`blastFactor`·`medLevelOf`·`kitWorks`·`kitUses`(공기 잔량)·`roleOf`(화학 보호복 대원 `hazTech`))뿐이다. `agents.ts`·`hazards.ts`·`executor.ts`·`sceneManager.ts`·`resources.ts` 를 import 하지 않는다 — `hazards.ts` 가 `bandOf` 를, `agents.ts` 가 `hurtF` 를 import 하므로 거꾸로 부르면 `hazards → injury → agents → hazards` 순환이 생기고, `hazards.ts` 의 `export const band = bandOf;` 가 모듈 초기화 중에 아직 정의되지 않은 값을 읽을 수 있다(CLAUDE.md 의 "시나리오 표는 추격전을 import 하지 않는다"와 같은 종류). 그래서 `bandOf` 는 화살표 상수가 아니라 `export function bandOf(h: number): number` 선언으로 쓴다(선언은 끌어올려진다). 가까운 작업 항목을 끝내는 일(`finishTask`)처럼 실행기가 필요한 것은 부르는 쪽(`agentHealth`)이 한다.

| band | 이름 | 체력 | 색 | 구조 대상 | 대원 | 용의자 |
|---|---|---|---|---|---|---|
| 0 | 경상 | > 70 | 초록 | 걸을 수 있으면 스스로 대피, 처치·이송 없음(지금 그대로) | 그대로 일한다 | 그대로 |
| 1 | 중상 | 41~70 | 노랑 | 처치·이송 | 느려진다(`hurtF`). 대부분 계속 일한다 — 상처 출혈이 크고(≥ 0.06) 체력이 70 아래일 때만 물러난다 | 체력 60 아래 사기·속도 저하(지금 그대로) |
| 2 | 위중 | 1~40 | 빨강 | 먼저 처치·이송. 걷던 사람도 멈춘다(새로) | 물러난다(40 아래, 지금). **15 이하 쓰러짐** | **15 이하 쓰러짐(무력화)** — 지금은 0 이하 |
| 3 | 사망 | ≤ 0 | 검정 | 덮개 | 순직 | 사망 |

`injury.ts` 의 상수: `DOWN_AT = 15`(대원·용의자가 쓰러지는 체력), `HURT_AT = 40`(대원이 물러나는 체력), `MATE_RETREAT_BLEED = 0.06` + `MATE_RETREAT_HP = 70`(출혈로 물러나는 조건은 둘 다 — §2.5), `MATE_LETHAL_FROM = 41`(대원 문턱 — §2.6), `DOWN_BLEED_CAP = 0.04`(쓰러진 대원의 출혈 상한), `HOSTILE_BLEED = 0.35`(용의자 상처 출혈 배율), `HOSTILE_LEFT = [4, 15]`(용의자 문턱이 걸렸을 때 남는 체력 범위 — §2.6), `SELF_HARM = 0`(§4.5 — **사용자 결정(2026-11-15): 끈다.** 조정하는 손잡이가 아니다). `HOSTILE_BLEED`·`HOSTILE_LEFT` 는 §9 에서 조정한다 **(확인 필요: 첫 측정 뒤)**.

출혈 문턱을 0.06·체력 70 둘 다로 정한 까닭: 총상 계수 0.0024 에 방호를 뺀 피해(순찰 22~36, 기동 17.5~28.7, 특공 13.8~22.5)를 곱하면 한 발의 출혈이 0.033~0.087 이다. 문턱을 0.03 하나로 두면 총알 한 발에 모든 대원이 물러나고 RESPONDER_HURT(벌점 0.75)가 난다 — 지금은 총에 맞아도 RESPONDER_HURT 가 나지 않는다(작은 측정: 보통 3교대·`--force armed/shooter` 3교대에서 대원 피격 각 2건, RESPONDER_HURT 0건). 두 조건이면 순찰 경관은 큰 한 발(방호 뒤 30 초과, 약 40%)에, 기동·특공대원은 두 번째 명중에 물러난다.

### 2.3 원인별 피해 공식

"한 번" = 사건 하나에 한 번 주는 피해, "매 틱" = 그 자리에 있는 동안 초당. 피해량은 **방호 전** 값이다(대원만 방호를 뺀다). "출혈/피해" = 대원·용의자가 피해 1 마다 얻는 상처 출혈. 구조 대상의 `bleed` 는 지금처럼 각 자리의 코드가 직접 정하고 이 계수를 쓰지 않는다(이미 맞춰 둔 균형을 흔들지 않게).

**대원·용의자의 출혈 갱신**(새 상처마다 한 번, "한 번" 원인만): `bleed = min(상한, bleed + 계수 × 피해(방호 뒤) × tune.injuryMul × (용의자면 HOSTILE_BLEED))`, 그리고 `bleed0 = bleed`, `treatQ = 0`(새 상처는 다시 처치할 수 있다 — 처음 처치의 체력 +8q 도 다시 받는다). 상한은 대원 0.12 · 용의자 0.15. **한 번 피해 뒤 체력이 `DOWN_AT` 이하로 남은 대원은 문턱이 걸렸든 아니든 `bleed = min(bleed, DOWN_BLEED_CAP)`** — 체력 45 인 대원이 41 을 맞아 4 가 되면 출혈이 0.098/s 라 40초 남짓에 숨지는데, 교전 중 동료가 닿기 어려운 시간이다. 0.04 면 체력 8 에서 200초, 15 에서 375초.

| 원인 | 어디서 생기나 (지금 / **새로**) | 종류 | 피해 | 출혈/피해 |
|---|---|---|---|---|
| gunshot 총상 | 용의자의 사격, 대원의 사격, 인질 피격·시한·빗나간 탄, 총격범 | 한 번 | 지금 그대로 (25~41 · 30~48 · 20~42) | 0.0024 |
| stab 자상 | 칼 든 용의자의 근접 공격 | 한 번 | 8~16 × 1.4 (지금) | 0.0015 (방호 뒤 10~22 → 한 번에 0.015~0.033: 칼 한두 번으로는 물러나지 않는다 — `armed/domestic` 의 성공률 시험을 지킨다, §12.2) |
| blunt 타박상 | 맨손 공격(8~16 × 0.6, 지금), **덮쳐 제압할 때 `fight` 중이던 용의자가 맞섬: 대원·용의자 각 3~8**, 가정 폭력 피해자의 처음 상태 | 한 번 | | 0.0003 |
| burn 화상 | 불 칸(fire > 0.3 구조 대상·**용의자**, > 0.4 대원) | 매 틱 | 구조 대상·용의자 2.6×fire, 대원 9×fire | 0.0006 |
| smoke 연기 | 연기 (> 0.25 대원) | 매 틱 | 구조 대상·**용의자** 0.36×smoke, 대원 1.3×smoke | 0 |
| toxic 유독 가스 | 가스 누출 현장(`s.kind === 'hazmat'` 또는 `s.rules` 에 `gas`)의 `s.smoke`, 가스 노출 시민 | 매 틱 | 구조 대상·**용의자**: `s.kind === 'hazmat'` 이면 0.62×smoke, `gas` 규칙만 있는 현장(가스 폭발 — 붕괴 유형)은 **지금처럼 0.36×smoke**(`tickCasualties` 의 계수를 바꾸지 않는다. 원인 이름만 toxic). 대원 1.3×smoke | 0 |
| fall 추락 | **붕괴 현장의 잔해 바닥(`s.damage[i] === 1`)에 대원이 새로 들어설 때(`a.lastTile !== i`) `0.002 × hazardMul` 확률(`injuryRng(sim, s, 'fall')`)** → 8~20. 대원마다 사건당 한 번(`a.fellOnce`). 기록 문구 '○○ 대원 잔해 위에서 미끄러져 다침.'(`hazard` · 1). G4 의 측정으로 붕괴 현장의 잔해 칸은 24~72칸이라 대원이 수십~수백 번 들어선다 — 상한이 없으면 0.004 로는 대원당 0.4건 가까이 된다. 목표는 붕괴 현장 사건당 0.3건 이하. (사다리·창문 추락은 어느 묶음도 만들지 않는다 — 사다리차 창문 구조는 ROADMAP C4) | 한 번 | | 0.0008 |
| crush 잔해 | 화재의 천장 일부 붕괴(`tickFire`, 지금 `blast(2.2, 22)` — 원인만 crush), 2차 붕괴(`tickCollapse`, `blast(2.6, 28)` — crush, **곁의 구조 대상은 갇힌다** §5), **구출 중 잔해(§5)** | 한 번 | | 0.001 |
| blast 폭발 | 가스 용기(3.6/34), 누출 가스(3.8/32), 폭발물(3.4/55) | 한 번 | `dmg × (1 − d/(r+1))`, 구조 대상·**용의자** ×0.8 | 0.0012 |
| drown 익수 | 물속 구조 대상의 악화(`bleed`, `tickWater`), 해일. R2 의 헤엄 구조: 대원이 물속에 있는 동안 1.2/s | 매 틱 | | 0 |
| electric 감전 | **공식만 둔다**: 한 번 15~35, `injuryRng(sim, s, 'electric').chance(0.3)` 이면 바로 쓰러짐(`{ down: true }` — 체력 `min(h, 15)`). 지금 부르는 곳 없음(생활 사건 "끊어진 전선"·재난 규칙이 나중에 부른다) | 한 번 | | 0.0005 |
| exhaustion 탈진 | **소방 대원이 지구력 ≤ 10 으로 열(곁 1칸 안 fire ≥ 0.3 또는 제자리 smoke ≥ 0.4) 속에 있으면**. 소방 대원은 지구력 22 아래에서 휴식을 고르고(`brain.ts` 휴식 점수) 8 아래에서 물러나므로(`dangerScore` +0.5) 거의 일어나지 않는다 — **사실상 안전장치**다. 첫 측정에서 0건이어도 억지로 늘리지 않는다 | 매 틱 | 0.5 | 0 — 이 원인으로는 체력이 `DOWN_AT` 아래로 내려가지 않는다(탈진으로 숨지지 않는다) |
| vehicle 차량 | 2차 사고(28~44, 지금), 교통사고·추격전 사고의 처음 상태, **도주하던 용의자가 통제되지 않은 차로에서 치임(선택)** | 한 번 | | 0.0015 |
| exposure 실외 노출 | 수색 대상의 실외 악화(`s.exposure`), **물에서 건져 낸 뒤 남는 악화**(`waterRescue` 완료 — `executor.ts` "저체온은 남는다". R2 가 합쳐졌으면 `landCasualty`)에서 `bleedCause = 'exposure'` 로 바꾼다 | 매 틱 | | 0 |
| illness 급성 질환 | 응급 환자의 처음 상태와 그 `bleed` | — | | 0 |

**처음 상태의 원인** — 현장 생성기는 고치지 않는다. `sceneManager.createScene` 에서 `buildScene` 바로 뒤에 `initInjuries(sim, s, I)`(`injury.ts`)를 한 번 부른다. 현장의 모든 구조 대상·용의자 가운데 `health < 100` 또는 `bleed > 0` 인 사람에게 `injuries` 한 줄(`byKind: 'initial'`, `dmg = 100 − health`)과 `bleedCause` 를 붙인다. 난수를 부르지 않고 `injuries`·`bleedCause` 말고는 쓰지 않으므로 단계 1 에서도 결과가 같다. (세계 규칙에서 붙이면 안 된다: `tickScene` 은 `tickCasualties` 를 세계 규칙보다 먼저 부르므로, 첫 틱에 상처 항이 정해지지 않은 원인으로 먼저 기록되고 "기록이 없는 사람" 조건이 거짓이 되어 처음 원인이 끝내 붙지 않는다.) 추격전의 차가 서서 현장을 다시 만들 때(`pursuit.stop`)도 `createScene` 을 거치므로 같다. 사건 중에 붙는 사람(가스 노출 시민 `bystander2`, 해일)은 그 사람을 만드는 코드가 원인을 적는다(toxic·drown). `bleedCause` 가 없는 사람은 `tickCasualties` 가 상처 항을 기록하지 않는다(안전장치).

원인은 변형을 먼저, 그다음 유형을 본다(위에서 처음 맞는 줄):

| 조건 | 원인 |
|---|---|
| 물속(`c.inWater`) | drown |
| `traffic/manhole` | fall |
| `traffic/tree` | crush |
| `medical/trauma` | blunt |
| `collapse/gasblast` | blast |
| 차 안(`c.inVehicle`)이거나 교통사고 유형(`traffic/*`, 대형 사고의 열차·다중 추돌 포함) | vehicle |
| 화재 유형(비행기·선박 화재 포함) | smoke |
| 붕괴 유형(승강기·산사태·크레인 포함) | crush |
| 가스 누출 | toxic |
| 수색 | exposure |
| 응급(그 밖의 변형) | illness |
| 수난 | drown |
| 무장 `shooter`·`robbery` | gunshot |
| 그 밖의 무장(가정 폭력·폭동 등) | blunt |
| 용의자: 추격전에서 선 현장(`I.pursuit`) | vehicle |

다치지 않은 사람(인질 등)에게는 붙이지 않는다. 현장 생성기가 원인을 알려 주고 싶으면 나중에 `addCas` 끝에 선택 인자를 더한다(이번에는 하지 않는다).

### 2.4 방호 — `protection(sim, r, u, cause, engaging = false): number`

피해에서 빼는 몫(0~0.95). 대원이 받는 피해 = 방호 전 피해 × (1 − 몫). 표의 열은 셋이다.

- **지금** — 지금 코드의 값을 그대로 옮긴 것. 단계 4a 의 첫 커밋(4a-1)은 **그때 코드의 식**을 옮긴 열만 쓴다: R1 이 없으면 이 열, R1 이 합쳐져 있으면(구현 순서 R1 → H1 에서는 그렇다) "R1 이 있으면" 열이다(그것이 그때의 지금 식이다. 부서 계수로 되돌리지 않는다 — §10 의 4a-1 단계 줄, §11 시험 3). 그 열에서도 지금 방호가 없던 몫(toxic 의 `hazTech` 0.95, crush 의 `vest`·`plate`, stab, fall, electric)은 "새로" 열과 같이 4a-2 에서 켠다. 지금 모델이 있는 원인(총상·연기·불·폭발, 그리고 천장·2차 붕괴가 `blast` 로 주던 crush)은 지금 숫자와 같다. 다만 연기를 `1.3 × smoke × (1 − 0.923…)` 처럼 몫으로 계산하면 `0.1 × smoke` 와 부동소수점 끝자리가 다를 수 있다 — 4a 는 어차피 결과가 바뀌는 단계이므로 비트 단위로 같기를 요구하지 않고, 시험 11-3 은 상대 오차 1e-9 로 견준다.
- **새로 (균형 변경)** — 지금 방호가 없던 곳에 새로 주는 값. 단계 4a 의 둘째 커밋(4a-2)에서 켜고, 그 커밋만으로 sweep 을 따로 잰다(원인을 가릴 수 있게).
- **R1 이 있으면** — 사람 장비로. 장비 판정은 효과를 줄 때 부르는 `kitWorks`(숨은 고장이 이때 드러난다)로 한다(R1 규칙). R1 은 `hazards.blast` 의 `dept === 'fire' ? 0.7 : 1` 을 `blastFactor` 로, `tickHostiles` 의 `u.armor` 를 `armorOf(rid, engaging)` 로 이미 바꿔 둔다(R1 §6.3 표) — H1 은 그 함수를 읽기만 한다.

| 원인 | 지금 (R1 없이 — 4a-1) | 새로 (균형 변경, 4a-2) | R1 이 있으면 (R1 뒤의 4a-1) |
|---|---|---|---|
| gunshot | **모든 부대** `u.armor × 0.6` (`u.armor` 는 이미 `tune.armorMul` 이 곱해진 부대 값: 순찰 0.2·기동 0.5·특공 0.75·폭발물 0.6·진압·사다리·구조 0.1·화학 0.15·헬기·구조정 0.05·구급 0) | — | `armorOf(sim, rid, engaging) × 0.6` (`engaging` 은 `hurtResponder` 가 `a.task?.kind === 'engage' \|\| a.task?.kind === 'perimeter'` 로 정해 `protection` 에 넘긴다 — 방패 +0.3, R1 §4) |
| burn | 소방 분야(`dept 'fire'`: 진압·사다리·구조·화학·헬기·구조정) `1 − 2.6/9` ≈ 0.711, 그 밖 0 | — | `turnout` 이면 0.711 |
| smoke | 소방 분야 `1 − 0.1/1.3` ≈ 0.923, 그 밖 0 | — | `scba` 이고 공기가 남았으면 0.923 |
| toxic | (지금은 연기와 구분이 없다) 소방 분야 0.923, 그 밖 0 | 화학(`kind 'hazmat'`) 0.95 | smoke 와 같고, 화학 보호복 대원(R1 역할 `hazTech`)은 0.95 |
| blast | 소방 분야 0.3, 그 밖 0 | 폭발물 처리반(`kind 'eod'`) 0.5, 그 밖 경찰 `u.armor × 0.3` | `1 − blastFactor(sim, rid)` (방호복 0.65, 방화복 0.3) |
| crush | (천장·2차 붕괴가 `blast` 로 주던 몫) 소방 분야 0.3, 그 밖 0 | 경찰 0.1 | `turnout` 0.3, `vest`·`plate` 0.1 |
| stab | 0 (지금 칼·맨손에는 방호가 없다) | 모든 부대 `u.armor × 0.5` | `armorOf(…) × 0.5` |
| fall | (지금 없음) | 소방 분야 0.2 | `turnout` 0.2 |
| electric | (지금 없음) | 소방 분야 0.4 | `turnout` 0.4 (R1 에 절연 장갑이 없다 — 생기면 그것으로) |
| drown | 0 | — | 0 — R2 의 헤엄 사고 식이 `pfd`·`drysuit` 로 확률과 피해를 이미 줄인다(두 번 곱하지 않는다) |
| blunt · vehicle · exhaustion · exposure · illness | 0 | — | 0 |

R1 의 공기호흡기 공기(`uses`)가 떨어진 동안 smoke·toxic 몫은 0 이다(R1 §9 의 규칙 그대로). 테이저(R1)는 피해를 주지 않으므로 방호와 상관없다(§4.2).

### 2.5 부상이 행동에 주는 효과

| 무엇 | 규칙 | 고칠 곳 |
|---|---|---|
| 속도·작업·사격 | `hurtF(r) = 0.75 + 0.25 × clamp((health − 40) / 30, 0, 1)` — 체력 70 이상은 1, 40 에서 0.75. `staminaF(r)` 에 곱한다(이동 `moveSpeed`, 모든 작업 진도, `shootAt` 명중률이 함께 바뀐다) | `agents.ts` `staminaF` 한 줄 |
| 시야 | 바꾸지 않는다 | |
| 스스로 움직이는가 | 대원 ≤ 15 쓰러짐(지금). 용의자 ≤ 15 쓰러짐(새로 — `hurtHostile` 안에서 바로). 구조 대상 ≤ 40 이면 걷던 사람도 멈춘다(새로, §5.2) | `sceneManager.agentHealth`, `injury.hurtHostile`, `rules/injury.ts` |
| 물러남 | 대원: `health < 40`(지금) **또는 (`bleed ≥ 0.06` 이고 `health < 70`)**(새로, §2.2 의 까닭) | `brain.dangerScore`(1.4 를 돌려주는 첫 줄), `executor` `retreat`(`withdrawn` 이 되는 조건) |
| 용의자의 사기 | 체력 60 아래 사기·속도 저하(지금 그대로) | |
| **다친 대원의 일** (`r.status === 'injured'` — 걸을 수 있는 다친 대원. 사용자 결정(2026-11-15): "가벼운 일은 계속") | 맡는 일은 가벼운 일뿐이다. `fitFor` 는 그 대원에게 `LIGHT_WORK`(§2.7 — `traffic` 교통 통제 · `perimeter` 출입구 봉쇄·통제 · `negotiate` 협상 · `interview` 목격자 면담 · `hookup` 바깥의 소화전 연결, 그리고 대상이 안전 구역(`s.safe`)에 있는 `treat`·`treatMate` — 처치 보조) 밖의 일을 0 으로 둔다. 목록 안의 일도 자리가 위험 구역(`fireRisk` 구역 — 불·가스·붕괴의 건물 안, 무장 현장의 안전 확보 전 건물 안)이면 0. 진입·수색·진압·강제 개방·구출·운반·싣기·검거·교전·동료 구조·수난 구조·해체·잔불 정리·도로 정리 같은 무거운 일은 맡지 않는다. `fitFor` 는 남에게도 불리므로 `r.status`(조직이 아는 상태 — RESPONDER_HURT 로 알렸다)만 보고 체력·출혈은 읽지 않는다. R2 가 합쳐지면 다친 대원은 `risk > 0` 인 방법(헤엄 구조·급박 구출·손으로 파기·폭파 진입 등)을 고르지 않는다(R2 §3.4 — `chooseMethod` 의 후보에서 뺀다). R3 의 부상 줄(P12·F14·E11·G01)은 같은 목록을 쓴다(정본은 이 표와 §2.7). 차는 다친 대원이 몰 수 있다(차량 이동은 사람별로 따지지 않는다 — 지금 그대로). 물러났다가 돌아오는 규칙은 §3.6a | `agents.fitFor` 첫머리 한 줄, `injury.ts` `LIGHT_WORK` |

### 2.6 악화와 처치·안정화

- **사건이 끝나면 세 부류 모두 악화를 멈춘다.** `I.phase === 'closed'` 이면 구조 대상의 악화(상처·연기·불·노출)와 사망 판정, 대원의 연기·불·출혈, 용의자의 출혈을 모두 멈추고, `hurt*` 도 아무것도 하지 않는다(`return`). 걷는 사람의 이동만 남는다. 까닭: 판정(`closeIncident` 의 `evaluate`, `incidents.ts:225`)은 종료 순간에 한 번 내려지는데, 현장의 환경 단계는 대원이 모두 떠날 때까지 계속 돈다(`tickScene` 1) 의 조건). 그 사이에 숨지면 `RESPONDER_KILLED`·`SUSPECT_DIED`·구조 대상 사망 기록은 남는데 `IncidentResult` 에는 들어가지 않아 판정과 기록이 어긋난다. 고칠 곳은 `tickCasualties`(악화·사망 블록을 `I.phase !== 'closed'` 로 감싼다 — 대피 이동은 그 밖에 둔다), `agentHealth` 첫 줄, `rules/injury.ts` 첫 줄, `hurt*` 첫 줄 넷이다. 시험 11-9 가 "모든 사망 기록의 시각 ≤ 그 사건의 `closedAt`" 을 본다.
- **구조 대상**: `tickCasualties` 의 식을 바꾸지 않는다. 각 항(상처 `bleed` → `bleedCause`, 연기 → smoke/toxic, 불 → burn, 실외 → exposure)을 기록에 나눠 적기만 한다. 병원 뒤의 결과는 모델에 넣지 않는다(P2 "병원 수용 능력").
- **대원·용의자**: 초당 `bleed × 배율`. 배율은 현장·끌려가는 중 1, 처치를 받고 안전 구역(`withdrawn`)에 있거나 검거되어 있으면 0.6. `left`(차에 탐)·`aboard`·`hospital` 부터는 멈춘다. 출혈의 갱신 규칙은 §2.3 첫머리.
- **처치**: 세 부류가 같은 식이다. `q = clamp(skills.medical × (0.5 + 0.5 × medLevel) × 1.15, 0.2, 1)`, 처음 처치면 체력 +8q, `bleed = bleed0 × (1 − 0.9q)`, 이미 받은 처치보다 `q` 가 0.15 넘게 높을 때만 다시 한다(지금 `treat` 와 같다). 걸리는 시간 `4.5 + (체력 < 40 ? 4 : 체력 < 70 ? 2 : 0)`. R1 이 합쳐져 있으면 `medLevel` 은 `medLevelOf(sim, rid)`, 그리고 R1 이 `treat` 에 더한 `aed`·`doctorKit` 보정도 같다 — `executor` 의 `treat` 에서 처치 질·효과 계산을 함수 하나(`injury.ts` 의 `treatEffect`)로 꺼내 `treat`·`treatMate`·`treatSuspect` 가 함께 쓴다.
- **사망**: 체력 ≤ 0. 매 틱 피해(연기·불·출혈)에는 문턱이 없다. "한 번" 피해에는 대원과 용의자에게 서로 다른 문턱이 있다(구조 대상에는 없다 — 지금 그대로).
  - **대원 문턱**: `pre = a.hpTick ?? r.health`(이 틱이 시작될 때의 체력 — 같은 틱에 두 번 맞아도 첫 피해 전의 체력으로 본다), `after = r.health − 피해`. `if (pre >= MATE_LETHAL_FROM && after <= 0) after = 8;` 그 밖에는 손대지 않는다. 그리고 §2.3 의 규칙대로 `after ≤ DOWN_AT` 이면 출혈을 `DOWN_BLEED_CAP`(0.04) 이하로. `a.hpTick` 은 `tickScene` 이 1) 환경 단계 직전에 그 현장의 모든 대원에게 `a.hpTick = r.health` 로 적는다(실행기 단계의 피해 — R2 의 터널 붕락 등 — 도 같은 틱의 값으로 본다). 그래서 멀쩡하던 대원(41 이상)은 같은 틱에 피해가 몇 번 겹쳐도 숨지지 않고, 체력 8 로 남아 다음 `agentHealth` 에서 쓰러짐(RESPONDER_HURT)이 된다. 대원의 순직은 "쓰러진 채 구조되지 못함" 또는 "이미 크게 다친(이 틱 시작 때 40 이하) 대원이 한 번 더 크게 다침"으로만 일어난다.
  - **용의자 문턱**: 직전 체력이 `DOWN_AT` 보다 높던(아직 쓰러지지 않은) 용의자는 "한 번" 피해로 0 아래로 내려가지 않는다 — `after ≤ 0` 이면 `after = injuryRng(sim, s, 'down').range(HOSTILE_LEFT[0], HOSTILE_LEFT[1])`. 쓰러짐(`state = 'down'`, `tDown`)은 다음 틱의 `tickHostiles` 가 아니라 **`hurtHostile` 안에서 바로** 세운다 — 같은 틱에 다른 대원이 한 번 더 쏘지 못하게(`engage` 는 시작할 때 `hostileActive` 를 보고 끝난다). 까닭: 대원의 명중 피해는 30~48 이고 용의자의 처음 체력은 100 이라, 쓰러질 때까지 맞히면 약 78% 가 쓰러지는 그 순간 이미 0 이하다(§1). 이대로는 "총에 맞아 쓰러진 용의자의 25~60% 가 숨진다"(§9.1)를 맞출 수 없고, 쓰러진 뒤의 출혈만 바꾸는 손잡이(`HOSTILE_BLEED`, 처치)가 듣지 않는다. 문턱이 있으면 용의자의 사망은 쓰러진 뒤의 출혈·처치 지연, 그리고 쓰러진 뒤의 폭발·불·연기로만 생긴다.

### 2.7 `injury.ts` 의 함수

```ts
export const CAUSE_NAME: Record<InjuryCause, string> = { gunshot: '총상', stab: '자상', blunt: '타박상', burn: '화상', smoke: '연기 흡입', toxic: '유독 가스 흡입', fall: '추락', crush: '잔해 깔림', blast: '폭발', drown: '익수', electric: '감전', exhaustion: '열 탈진', vehicle: '차량 충격', exposure: '실외 노출', illness: '급성 질환' };
export function bandOf(h: number): number { return h <= 0 ? 3 : h > 70 ? 0 : h > 40 ? 1 : 2; }     // 함수 선언 (§2.2 — 순환 import 에서도 안전)
/** 목적별 흐름: WeakMap<Scene, Map<string, Rng>> 에 sim.rng.fork('injury:' + s.id + ':' + purpose).
 *  purpose = 'trap'(2차 붕괴 갇힘) · 'extricate'(구출 중 사고) · 'fall'(잔해 바닥) · 'fight'(몸싸움) · 'down'(용의자 문턱의 남는 체력) · 'self'(자해) · 'electric'.
 *  한 흐름을 여럿이 나눠 쓰면 뒤 단계에서 소비자가 늘 때마다 앞 단계의 결과가 밀린다 (CLAUDE.md "새 기능은 새 흐름") */
export function injuryRng(sim: Sim, s: Scene, purpose: string): Rng;
/** 기록만 한다 (체력은 건드리지 않는다). 1단계는 이것만 쓴다 */
export function noteInjury(list: Injury[] | undefined, cause: InjuryCause, dmg: number, t: number, sevAfter: number, by = -1, byKind: Injury['byKind'] = 'world', ev = -1): Injury[];
/** 현장이 만들어진 직후 처음 상태의 원인을 붙인다 (§2.3). createScene 이 부른다 */
export function initInjuries(sim: Sim, s: Scene, I: Incident): void;
interface HurtOpts { by?: number; byKind?: Injury['byKind']; ev?: number; tick?: boolean; bleed?: number; immobile?: boolean; down?: boolean }
//  tick: 매 틱 피해 (문턱 없음) · bleed: 구조 대상의 bleed 를 이 값 이상으로 올린다 · immobile: 구조 대상을 걷지 못하게 한다
//  down: 한 번에 쓰러뜨린다 — 대원·용의자의 체력을 min(after, DOWN_AT) 로 (감전 30%, R2 의 저격). 문턱 때문에 0 아래로는 가지 않는다
//  ev: 피해를 준 자리가 이미 남긴 기록 id — Injury.ev 와 a.hurtEv(대원), c.causeEvent(구조 대상)에 넣는다
export function hurtCas(sim: Sim, s: Scene, I: Incident, c: Casualty, amount: number, cause: InjuryCause, o?: HurtOpts): void;
export function hurtResponder(sim: Sim, s: Scene, I: Incident, a: FieldAgent, raw: number, cause: InjuryCause, o?: HurtOpts): number;   // 방호·문턱·출혈·기록. 깎인 양을 돌려준다. 상태 전이는 하지 않는다(agentHealth 가 한다)
export function hurtHostile(sim: Sim, s: Scene, I: Incident, h: Hostile, amount: number, cause: InjuryCause, o?: HurtOpts): void;   // 문턱·출혈·기록 + 쓰러짐·사망 전이와 그 문구 (§4.6)
export function protection(sim: Sim, r: Responder, u: Unit, cause: InjuryCause, engaging = false): number;   // engaging: hurtResponder 가 a.task 로 정해 넘긴다 (R1 armorOf 의 방패)
export function hurtF(r: Responder): number;
export function treatEffect(sim: Sim, s: Scene, I: Incident, rid: number, health: number): { q: number; heal: number; bleedK: number };   // 처치 질과 효과 (treat 에서 꺼낸 것 — R1 의 medLevelOf·aed·doctorKit 포함. s 는 제세동기 보정 조건 s.variant === 'arrest', I 는 kitWorks 의 고장 기록에 넘긴다)
/** 진실 — sceneManager 5번 블록·buildReport·화면만 쓴다. 지휘 쪽(commander.ts·orders/*)은 쓰지 않는다 */
export function needsHospital(r: Responder): boolean;     // !r.dead && r.care === undefined && (r.tDown !== undefined || (r.bleed ?? 0) >= 0.01 || r.health <= 40)
/** 믿음 — 지휘 쪽이 쓰는 같은 판단. mate 사실의 값만 본다 */
export function mateNeedsHospital(v: MateBelief): boolean;   // !v.dead && v.status !== 'evac' && (v.band >= 2 || v.bleeding || v.wasDown)
/** 위협이 끝난 시각: 무장 현장은 s.secureAt (지휘관이 선언), 그 밖의 현장은 첫 도착 s.arrivedAt. 없으면 -1. §4.4 의 벌점과 화면이 쓴다 */
export function threatOverAt(s: Scene): number;
export function mainCause(list: Injury[] | undefined): InjuryCause | null;      // dmg 가 가장 큰 원인
/** 다음 교대에 빠지는 교대 수 (§3.7 의 표). buildReport 와 I2 가 함께 부른다 */
export function outShifts(r: Responder): number;
/** 걸을 수 있는 다친 대원(injured)이 맡을 수 있는 가벼운 일 — 정본 (사용자 결정(2026-11-15): "가벼운 일은 계속", §2.5). treat·treatMate 는 대상이 안전 구역에 있을 때만(fitFor 가 본다).
 *  R3 의 부상 줄(P12·F14·E11·G01)이 같은 목록을 쓴다. treatMate 가 생기는 4b 에서 둔다 */
export const LIGHT_WORK: ReadonlySet<WorkKind> = new Set<WorkKind>(['traffic', 'perimeter', 'negotiate', 'interview', 'hookup', 'treat', 'treatMate']);
```

공통 규칙:

- **세 함수 모두 첫 줄에서 돌아간다**: 대상이 이미 숨졌거나(`c.dead`·`r.dead`·`h.dead`) 사건이 끝났으면(`I.phase === 'closed'`, §2.6). 숨진 사람은 더 다치지 않는다 — 그래서 `tickLane`(지금 `active`·`down` 대원을 친다)과 `blast`(`left` 가 아니면 모두 맞힌다)의 대상 고르기에서도 `r.dead` 를 뺀다. 안 그러면 시신을 친 차가 "작업 중인 ○○ 대원을 충격했습니다" 라는 SECONDARY_COLLISION 을 남긴다(가짜 연출). 숨진 대원은 4a 부터만 있으므로 이 조건이 기존 `s.rng` 소비를 바꾸지 않는다.
- **`hurt*` 는 피해 자체의 문구를 남기지 않는다.** 지금 피해 자리들은 이미 문구를 남긴다: 대원 피격 '○○ 피격'(`tickHostiles`), 2차 사고·인질 피격·시한·총격범의 `raiseProblem`, 빗나간 탄. `hurt*` 가 또 남기면 CLAUDE.md 의 "로그 중복" 함정이다. `hurt*` 는 부른 쪽이 넘긴 `o.ev` 를 `Injury.ev`·`a.hurtEv` 에 넣기만 한다. 새 문구는 이 문서가 정한 자리에서만, 상태를 바꾸는 그 코드가 남긴다: 흉기·맨손 피습(§3.1), 몸싸움(§4.2), 잔해 추락(§2.3), 구출 중 사고(§5.1), 대피하다 쓰러짐(§5.2), 순직(§3.2), 그리고 `hurtHostile` 이 하는 용의자 쓰러짐·사망 전이(§4.6 — 상태를 바꾸는 바로 그 코드다).
- `hurtCas` 는 `o.ev` 가 있으면 `c.causeEvent = o.ev` 로 적는다(지금 `blast` 가 하는 동작을 옮긴 것 — X6 의 붕괴·폭발이 숨진 구조 대상의 원인 사슬을 이 칸으로 읽는다, X6 §6.6).
- `hurtCas` 는 체력이 0 이하가 되면 그 자리에서 `deathCause` 를 정한다(`dead` 는 지금처럼 `tickCasualties` 가 다음 틱에 세운다. `deathCause` 가 이미 있으면 그쪽이 덮어쓰지 않는다).
- 지금 코드가 하한을 두고 깎는 자리는 그 하한을 지키는 양을 넘긴다. 해일은 `c.health = Math.max(8, c.health − x)`(`rules/disaster.ts`) 이므로 `hurtCas(…, c.health − Math.max(8, c.health − x), 'drown')`.

---

## 3. 대원

### 3.1 다치는 경로 (정리)

연기·가스(`agentHealth`), 불(`agentHealth`), **열 탈진**(새로, `rules/injury.ts`), 폭발·천장 붕괴·2차 붕괴(`blast`), 용의자의 총격(`tickHostiles`), 흉기·맨손(**방호·기록·`hurtEv` 새로**, 기록 문구 '○○ 피습 (흉기)'/'○○ 피습 (맨손)' imp 2 — 이 문구를 남기는 `emit` 의 id 가 `hurtEv`), **덮쳐 제압할 때의 몸싸움**(새로, `executor` `engage`·`arrest`), 2차 사고(`tickLane`), 해일(`rules/disaster.ts`), **붕괴 현장의 잔해 바닥 추락**(새로), R2 의 익수·터널 붕락, X6 의 붕괴·폭발·전소. 모두 `hurtResponder` 를 거친다. G5 가 피해 줄에 끼운 `noteHit`·`recMelee` 는 그대로 둔다(연관 표). 숨진 대원은 어떤 경로로도 맞지 않는다(§2.7).

### 3.2 상태 전이 — `sceneManager.agentHealth` 한 곳에서, 이 순서로

```
if (a.status === 'left' || r.dead) return;               // 숨진 대원은 더 바뀌지 않는다
if (I.phase === 'closed') return;                        // 판정이 끝난 뒤에는 악화도 전이도 없다 (§2.6)
(R1) scba 공기 소모와 '공기 잔량 60초 미만' 기록, 연기 속 지구력 소모 — R1 §9 그대로 (방호가 남은 공기를 읽도록 소모가 먼저)
연기·가스·불: hurtResponder(…, { tick: true })            // 1.3×smoke, 9×fire 에 방호 (§2.4 — R1 이 합쳐져 있으면 "R1 이 있으면" 열, 없으면 "지금" 열)
상처 악화: r.health -= r.bleed × 배율 × dt (§2.6)
health ≤ 0                         → 순직 (아래)
health ≤ 15 && a.status !== 'down' → 쓰러짐: 지금 그대로 + `r.tDown ??= sim.t` (처음 한 번만)
                                     (이미 withdrawn 이면 withdrawn 유지, 기록 없음 — 지금 그대로)
(health < 40 || (bleed ≥ 0.06 && health < 70)) && r.status === 'ok' → 부상: r.status = 'injured', RESPONDER_HURT (지금 그대로 + 출혈 조건), 자기 보고
a.status === 'withdrawn' && r.status === 'injured' && r.care === undefined && !needsHospital(r) && !a.lightBack && 그 대원의 active treatMate 없음
                                   → 가벼운 일로 복귀 (§3.6a — 사용자 결정 "가벼운 일은 계속")
```

`if (r.health < 1) r.health = 1;`(`sceneManager.ts:137`)는 지운다(문턱은 `hurtResponder` 가 맡는다).

`r.tDown ??= sim.t` 인 까닭: 안전 구역의 `withdrawn` 대원은 체력이 15 이하가 되어도 `a.status` 가 `'down'` 이 아니라서 쓰러짐 분기에 매 틱 다시 들어온다(`sceneManager.ts:138-141`). `r.tDown = sim.t` 로 쓰면 매 틱 덮어써져 순직 문구의 '쓰러진 뒤 n초'·`wasDown`·결장 계산이 틀어진다.

- **순직**: `r.dead = true; r.tDead = sim.t; r.health = 0; r.status = 'down'; r.deathCause = …`, `finishTask(…, 'preempt')`(업고 있던 사람을 내려놓는다 — 지금 쓰러짐과 같다), `a.status` 는 `withdrawn` 이면 그대로, 아니면 `'down'`, `a.label = ''`. `raiseProblem(sim, I, 'RESPONDER_KILLED', detail, { role: 'SYSTEM', actor: '현장', rid, imp: 3, causes: [a.hurtEv], text: '${이름} 대원 생체 반응 소실.' }, false)`. 원인 = 숨진 틱의 가장 큰 피해 항, 없으면 `mainCause`. `detail` 은 숨지는 그 자리에서 상태로 만든다: '김도윤 대원(진압1) — 화상' 에, `tDown` 이 있으면 안전 구역에 옮겨지지 않았을 때 ', 쓰러진 뒤 1분 50초 동안 구조되지 못함', 옮겨졌으면 ', 안전 구역에서 후송을 기다리던 중' 을 붙인다(`a.status === 'withdrawn'` 으로 가린다).
- **RESPONDER_HURT 의 문구**: detail '○○ 대원 부상 (총상)'(물러남) · '○○ 대원 쓰러짐 (화상)'(쓰러짐). 지금의 '중상' 은 중증도 이름(41~70)과 겹치므로 '쓰러짐' 으로 바꾼다. `causes: [a.hurtEv]`(지금은 `a.lastBlockEvent` — 진입로 차단 기록에 잘못 이어진다).
- **자기 보고**: 물러나는 대원은 말할 수 있다. `injured` 가 되는 순간 `learnQuiet(sim, a, mateFact(sim, s, a, 'hurt', r.name, 0))` — 보고 대기열(`outbox`)을 거치므로 음영 구역이면 지금의 `COMM_FAIL`·재전송 경로를 탄다(`transmit(…, silent)` 를 바로 부르면 음영 구역에서 말없이 사라진다). `learnQuiet` 라 무전 문구에는 나오지 않는다(RESPONDER_HURT 가 이미 알렸다, "로그 중복" 함정). `mate` 는 `IMPORTANT` 라 다음 `think` 의 `flushOutbox` 에서 바로 나간다. 안전 구역에 닿아 `withdrawn` 이 될 때(`executor` `retreat`) 한 번 더 `'safe'` 로 — 이때는 `learnQuiet` 바로 뒤에 같은 자리에서 `flushOutbox(sim, s, a)` 를 한 번 부른다(`withdrawn` 대원은 `think` 를 돌지 않아 대기열이 다시 비워지지 않는다). 쓰러진 대원은 보고하지 못한다(지금처럼 본 사람이 알린다).

`mateFact(sim, s, b, status, src, d)` 는 `agents.ts` 의 `casFact` 옆에 둔다. `d` 는 관찰자와 대상 사이의 거리(본인 보고·끌고 가는 대원·처치한 대원은 0). 값은 `MateBelief`(§2.1):

```ts
{ x, y, status: 'down' | 'hurt' | 'safe' | 'evac', band, bleeding: boolean, tq: 0 | 1 | 2, dead: boolean, wasDown: boolean, since: number }
```

- **거리 조건**: `dead` 는 `d ≤ 2` 일 때만 참일 수 있고(멀리서는 쓰러진 것만 보인다), `band` 는 `d ≤ 3` 일 때만 실제 값이다(그보다 멀면 `status === 'down'` 이면 2, 아니면 1 로 적는다). `d` 를 **필수 인자**로 둔다 — 빠뜨린 호출을 tsc 가 잡는다.
- 사실의 칸 이름을 `bleed` 가 아니라 `bleeding` 으로 하는 것은 §11-8 의 검사가 `.bleed` 를 진실 읽기로 잡기 때문이다.
- **`perceive` 의 동료 보기**(`agents.ts:204-210`): 지금은 `b.status === 'down'` 인 동료만 보고, 조건이 `!cur || cur.value.status !== 'down'` 이라 이미 쓰러진 줄 아는 동료가 숨져도 다시 배우지 않는다. 이렇게 바꾼다 — 보는 대상은 `b.status === 'down'` 이거나 (`b.status === 'withdrawn'` 이고 `d ≤ 2`)(안전 구역에서 숨진 동료를 곁의 대원이 알아본다), 배우는 조건은 `!cur || significant(새 사실, cur.value)`.
- **`significant()` 의 `mate`**: 지금은 `status` 만 본다 — `status`·`dead`·`band`·`tq`(X6 뒤 `trapped` 도) 가운데 하나라도 바뀌면 보고하게 넓힌다.

### 3.3 위중·사망이 가능한 조건과 목표 빈도

- 가능: ① 쓰러진 채 구조되지 못함(상처 출혈, 누운 자리의 연기·불). ② 이미 다쳐 체력 40 이하인 대원이 한 번 더 크게 다침(물러나는 도중의 총탄, 폭발).
- 불가능: 멀쩡하던 대원(이 틱 시작 때 41 이상)이 한 틱 안에 숨지는 것 — 피해가 같은 틱에 여럿 겹쳐도(§2.6 문턱). 탈진으로 숨지는 것. 숨진 대원이 다시 맞는 것(§2.7).
- 목표: 보통 **교대당 순직 ≤ 0.02**(60교대에 0~1건), 쓰러짐 ≤ 0.1. 어려움 순직 ≤ 0.05, 극한 ≤ 0.15.

### 3.4 쓰러진 동료 구조와 후송

1. **구조(`rescueMate`, 지금)**: 쓰러진 줄 알면 0.97·2명. **숨진 줄 알면 0.55**(수습 — 산 사람의 일보다 뒤). `fitFor` 의 `rescueMate` 에 두 조건을 넣는다(지금은 아무 조건이 없다, `agents.ts:358`): ① `hot`(무장 현장의 안전 확보 전)이면 경찰만, ② `fireRisk` — 불·가스·붕괴 위험 구역 안이면 소방만(R1 이 합쳐져 있으면 R1 의 실내 진입 자격 — `scba` 를 든 대원만) 들어간다(구조하러 들어간 경찰이 다시 쓰러지는 연쇄를 막는다). 구역은 믿음 속 `mate` 사실의 위치로 본다. 끌고 가는 동안 화면은 들것(§8). 도착 문구: 살아 있으면 지금 그대로, 숨졌으면 '순직한 ○○ 대원을 안전 구역으로 옮겼습니다.'. `executor` 의 `rescueMate` 는 대상이 `down` 이 아니면 끝나는데, 끝날 때 `learn(sim, a, mateFact(…, d), true, true)` 로 강제 보고한다(낡은 믿음 함정). 대상이 물 칸에 있으면 기다린다(연관 표의 R2 줄).
2. **처치·후송(`orders/injury.ts` + `executor` `treatMate`)** — `mate` 사실이 `hurt`·`safe` 이고 `mateNeedsHospital(v)`(§2.7 — 믿음 술어)이거나 처치가 필요한(`v.tq < 2 && (v.band ≥ 1 || v.bleeding)`) 대원:
   - **맡을 사람**: 구급대원(구급 분야, 또는 R1 의 의료 가방을 든 대원 — R1 없이: 구급 분야와 헬기 대원). `fitFor('treatMate')`: 그 자격이 있고, **`a.rid !== w.mate`**(물러나는 중인 다친 구급대원이 자기 자신을 맡지 않게), `hot` 이면 안전 구역(`safe`)의 대원만(지금 `treat` 의 hot 규칙과 같게 — 교전 중인 건물 안으로 구급대원을 보내지 않는다), 대상 위치가 `fireRisk` 구역이면 소방만(R1 이 합쳐져 있으면 `scba` 를 든 대원만 — R1 §6.2 와 같은 술어).
   - **대상당 한 항목**: `commander.want` 는 `prop` 까지 키로 쓴다(`commander.ts:24`). 태울 차(`prop`)는 계획 주기마다 −1 과 차 id 사이를 오갈 수 있으므로, `orders/injury.ts` 는 먼저 `s.board` 에서 같은 `mate` 의 열린(`open`·`active`) `treatMate` 를 찾는다. 있으면 `open` 일 때만 그 항목의 `prop`·`priority` 를 고쳐 쓰고(`active` 면 그대로 둔다) 새로 `want` 하지 않는다. 없을 때만 `k.want('treatMate', { mate: rid, prop }, 0.8 + 0.06 × band, 1)`. `prop` = 정원이 남은 구급차·헬기 id(자리 셈은 5번), 없으면 −1(처치만). `load` 가 `already` 검사(`commander.ts:325`)로 같은 일을 막는 것과 같은 방식이다.
   - **맡을 사람이 없으면 거둔다**: 현장에 위 자격의 `active` 대원이 하나도 없으면 열린 `treatMate` 를 `cancel` 한다. 맡을 사람 없이 `open` 으로 남으면 `canClose` 가 막혀(`commander.ts:519`) 한계 시간까지 간다.
   - `treatMate` 실행: 대상 `b` 가 `left`·숨짐·`down`(아직 안전 구역에 없음)이면 `learn(sim, a, mateFact(…), true, true)` 후 끝. 곁으로 가서(1.3) 처치(§2.6). 끝나면 `r.treatQ`·`bleed` 갱신, '○○ 대원 응급 처치 완료.'(imp 1, `rid` 는 처치한 대원). `w.prop === a.unitId` 이고 자리가 있으면 이어서 함께 차로 간다. `withdrawn` 대원은 스스로 움직이지 않으므로(`act` 는 `board` 가 아니면 바로 돌아간다, `executor.ts:973`) **처치한 대원이 대상의 좌표를 끌고 간다**: 쓰러졌던 대원(`tDown` 있음)은 `a.carrying = -(rid+2)` 로(들것 그림), 아니면 `carrying` 없이 `rescueMate` 처럼 매 틱 `b.x = a.x − a.fx × 0.5; b.y = a.y − a.fy × 0.5`. 차에 닿으면 `b.status = 'left'; r.care = 'aboard'; u.aboard.push({ kind: 'mate', id: rid, inc: I.id, t: sim.t }); u.firstLoadAt ??= sim.t`, mate 사실 `'evac'`(강제 보고), '○○ 대원 ${호출부호}에 탑승 — 병원 후송.'(imp 2).
   - **부대가 고아가 되지 않게**: 태운 대원이 그 부대(`sim.responders[rid].unitId`)의 마지막 `left` 아닌 대원이면 그 부대에 `boardOrder = 'release'` 를 준다(이미 있으면 그대로). 안 그러면 그 부대의 `boardOrder` 는 영영 생기지 않는다 — 종료 때 `boardOrder` 는 `left` 아닌 대원을 거쳐서만 정해지고(`sceneManager.ts:194`), `think` 는 `active` 대원만 하며(`brain.ts:62`), 5번 블록은 `boardOrder` 가 있어야 움직인다. 그 차량은 교대 끝까지 `onscene` 으로 남고 배정에서도 빠진다. 5번 블록에도 안전장치를 둔다(3번).
   - 구급 부대가 없고 오는 것도 없으면(`k.countUnits('ems', 0.7) === 0`) `k.request('ems', '부상 대원 후송', true)`.
   - **자기 부대 이송 지시(20초 규칙)** — 아래 조건이 **모두** 맞을 때만, 그 대원의 부대(`sim.units[sim.responders[rid].unitId]`)에 `boardOrder = 'transport'` + 기록 '${호출부호}, 부상 대원을 태우고 병원으로 이동하라.'(COMMANDER, imp 2):
     - 그 대원이 믿음상 `mateNeedsHospital` 이고, 20초 넘게 기다렸다(`since` 기준 — 처치를 받았으면 처치 뒤부터 센다).
     - 구급 부대가 현장에도 오는 중에도 없다(`k.countUnits('ems', 0.7) === 0`) — 또는 구급차가 있지만 처치만 받고 자리가 없어 처치 뒤 20초가 지났다.
     - `hot` 이 아니다(`!(s.kind === 'armed' && s.secureAt < 0)`) — 교전 중에 경찰 짝을 빼면 대치가 길어진다.
     - 그 부대가 현장의 마지막 주관 분야(`s.leadDept`) 부대가 아니고, 믿음상 활동 중인 용의자가 있으면 마지막 경찰 부대도 아니다(CLAUDE.md "한 팀뿐인 경찰" 함정). 부대 수는 `k.unitsOnScene()` 과 `sim.units[…].dept`(조직 정보)로 센다.
     - 구조정(`u.sea`)이 아니다(구급을 기다린다).
   - 지휘관 쪽 `cancel`: 믿음상 `evac`·숨짐·처치 끝(`tq` 가 충분하고 `mateNeedsHospital` 이 거짓)이면 `treatMate` 를 거둔다.
3. **부대가 떠날 때(`sceneManager` 5번 블록)**: 철수든 이송이든, 떠나는 부대의 대원 가운데 `needsHospital`(진실 — `sceneManager` 는 읽어도 된다. `care` 가 이미 있는 사람은 빠진다) 인 사람은 `u.aboard` 에 넣고 **병원부터 간다**(지금 "환자를 태웠으면 병원부터"와 같은 규칙). 숨진 대원은 넣지 않는다(부대와 함께 복귀). 문구: '${호출부호} 환자 n명·부상 대원 m명 싣고 ${병원 이름}으로 출발.'(환자가 0명이면 '${호출부호} 부상 대원 m명 싣고 ${병원 이름}으로 출발.') — 병원 이름은 R1 단계 3 의 `startTransport` 가 돌려준 값이다(일반명사 '병원으로' 를 쓰지 않는다. `scripts/metrics.ts` 의 문구 규칙 T3 와 일치 검사 C5 가 이 이름을 다음 인계 문구의 병원과 견준다 — I1 §2.3·§2.12). 고칠 줄:
   - 종료 시 `boardOrder` 정하기(`sceneManager.ts:194`): `u.patients.length || u.aboard?.length || 그 부대의 left 아닌 대원 가운데 needsHospital 이 있음` 이면 `'transport'`, 아니면 `'release'`.
   - 병원행 조건(`u.boardOrder === 'transport' || u.patients.length > 0`)에 `|| (u.aboard?.length ?? 0) > 0` 을 더한다.
   - R1 이 5)번 블록에 더한 "남은 대원이 없는 부대" 줄(`boardOrder = u.patients.length ? 'transport' : 'release'` — R1 §7.3)의 조건도 `u.patients.length || u.aboard?.length` 로 넓힌다(다친 대원을 태운 상공 부대·대원 없는 부대가 병원으로 가게).
   - **안전장치**: 이 사건 소속 `onscene` 부대 가운데 그 부대의 대원이 이 현장에 내린 적이 있고(`s.agents` 에 그 부대 대원이 있다) 모두 `left` 인데 `boardOrder` 가 없는 부대는 `'release'` 로 철수시킨다(태운 환자가 있으면 지금 규칙대로 병원부터). 대원이 하나도 내리지 않는 부대(R1 의 경찰 헬기처럼 상공에 머무는 부대)는 `s.agents` 에 없으므로 걸리지 않는다.
4. **병원 인계(`resources.tickUnits` 의 `hospital`)**: 지금 블록은 `u.patientsIncident` 가 있을 때만 현장을 찾는다(`resources.ts:342-356`). 경찰차·펌프차처럼 `aboard` 만 태운 차량은 `patientsIncident` 가 `null` 이다. 그래서 `aboard` 의 인계는 **그 블록 밖에서** 한다: 대원은 `r.care = 'hospital'; r.bleed = 0`, 용의자는 `sim.scenes[e.inc]` 의 `h.where = 'hospital'`. 그리고 `u.aboard = []; u.firstLoadAt = undefined`. 문구 '환자 n명 인계 완료' 에 '부상 대원 m명'·'용의자 k명' 을 붙인다(`aboard` 만 태웠으면 '부상 대원 m명 인계 완료'. 기록의 `inc` 는 `patientsIncident ?? aboard[0].inc`). **문구를 바꾸면 `scripts/metrics.ts` 의 `PHRASE.T4` 를 함께 넓히고 `tests/causality.test.ts` 를 통과시킨다**: T4 `/^(\S+): (.+?) 도착, (?:환자|부상 대원|용의자)/`(I1 §2.3 표도 같은 꼴 — 그러지 않으면 부상 대원만 인계한 기록을 hospital 이 아니라 field 로 센다). 부상 대원·용의자 인계를 I1-b C3 의 `delivered` 신호와 응급실 체류에 어떻게 셀지는 I1 §3.4 가 정한다.
5. **정원과 출발**: 자리 수는 R1 의 `seatsOf(u)`(R1 없이: 구급차 2·헬기 1). 쓰인 자리는 함수 하나 `seatsUsed(sim, u)`(`agents.ts`, R1 의 `seatsOf` 옆에 둔다) = `u.patients.length + (다른 부대의 대원과 용의자인 aboard 의 수)` — 자기 부대 대원은 원래 자리에 타므로 세지 않는다(5번 블록이 자기 부대의 다친 대원을 넣는 경찰차가 "정원 0" 에 걸리지 않게). R1 이 `u.patients.length` 와 `seatsOf(u)` 를 직접 견주는 자리 넷을 **모두** `seatsUsed(sim, u) < seatsOf(u)`(출발은 `>=`)로 바꾼다 — 일부만 바꾸면 정원이 지켜지지 않는다: ① `agents.fitFor` 의 `load` 자격(R1 §6.2), ② `commander` 의 탑승 대기열·배정(R1 §7.3 의 위중 환자 헬기 먼저 포함), ③ `manageAmbulances` 의 출발 조건(`u.patients.length >= seatsOf(u)` — R1 §7.3), ④ 실행기 `load` 의 자리 다시 보기(R1 단계 3). `canCarryPatients` 도 이 합을 본다. R1 의 "위중 환자는 헬기 먼저"는 다친 대원에게도 같다. 다친 대원이 타면 10초 뒤 출발. `commander.manageAmbulances` 의 고칠 곳 셋:
   - `!u.patients.length` 이면 건너뛰는 줄(`commander.ts:539`) → `!u.patients.length && !(u.aboard?.length)` (다친 대원·용의자만 태운 구급차도 출발한다). 대기 중인 사람 수에 믿음상 `mateNeedsHospital` 인 동료와 처치가 필요한 용의자를 더한다.
   - `firstLoad = Math.min(...u.patients.map((cid) => s.casualties[cid].tLoaded))`(`commander.ts:542`, 진실 읽기) → `u.firstLoadAt`(부대 자신의 기록 — 실행기 `load` 가 태울 때, `treatMate`·`treatSuspect` 가 태울 때 `u.firstLoadAt ??= sim.t`, 병원 인계에서 지운다).
   - `redAboard = u.patients.some((cid) => s.casualties[cid].health < 40)`(`commander.ts:544`, 진실 읽기) → 믿음으로: 태운 구조 대상의 `cas` 사실 `band ≥ 2`, 또는 `u.aboard` 에 사람이 있음(R1 이 단계 3 에서 이미 믿음으로 바꿨으면 `aboard` 조건만 더한다).
   - 이 셋을 고치면 `commander.ts` 에는 `s.casualties`·`s.hostiles` 읽기가 하나도 남지 않는다(지금 두 곳뿐 — 2026-11-14 확인). 시험 11-8 이 그 상태를 지킨다.

### 3.5 지휘관이 다쳤을 때

지금의 4번 블록(지휘관이 `active` 가 아니면 경험 많은 주관 부서 대원이 승계)을 그대로 쓴다. 문구만 승계자의 믿음으로 고른다: 승계자가 옛 지휘관의 `mate` 사실을 갖고 있으면 '${이름} 대원 ${순직|쓰러짐|부상}으로 지휘 불능. 지휘권을 승계합니다.', 없으면 지금 문구. 다친 지휘관이 물러나는 도중(아직 `active`)에는 지휘를 놓지 않는다(지금 그대로). 승계가 일어나지 않는 경우(남은 active 대원 없음)는 7번 블록이 받는다 — `outstanding(a, now)`(§5.2 에서 인자 `now` 를 더한다)에 `mates`(믿음상 쓰러진 동료 가운데 숨지지 않은 수 + 믿음상 `mateNeedsHospital` 인데 `evac` 이 아닌 수)를 더하고, 남은 일로 친다: 그런 동료가 있으면 'rescue'(지금 7번 블록의 추가 부대 요청 경로 — 구급·같은 분야를 부른다), 아니면 지금 규칙(`sceneManager` 7번 블록, `commander.outstanding`). 숨진 동료만 남았으면 남은 일로 치지 않는다(수습 임무는 만들지 않는다 — 부대가 떠날 때 함께 복귀한다). 물러났던 지휘관이 가벼운 일로 돌아와도(§3.6a) 지휘를 되찾지 않는다(승계는 한 방향). 다음 현장에서 부대장(0번 자리)이 걸을 수 있는 다친 대원이면 첫 지휘관이 될 수 있다(지휘는 위험 구역 밖의 일이다).

### 3.6 인원이 줄어든 부대

- 현장: 남은 active 대원이 하던 일을 계속한다(지금).
- **결정 1 — 부대의 운용 중단은 그 부대 대원이 전부 숨졌을 때만이다. 사용자 최종 결정(2026-11-15): "운용을 멈추는 건 그 부대 전부 죽었을 때로. 하나라도 다치거나 죽으면 멈추는 건 너무 그렇다."** 대원이 다치거나 일부가 숨져도 부대는 계속 출동한다. 부대 규모 1·2 의 부대, 인근 도시 지원 부대(최소 편성), 2인 순찰차·일반 구급차도 같다. 인원 문턱(R1 의 `minField`)이나 "순직 대원이 있으면 중단" 같은 운용 중단 규칙은 두지 않는다(§12.3 — 쓰지 않는 두 안).
- **결정 2 — 걸을 수 있는 다친 대원은 가벼운 일을 계속한다. 사용자 결정(2026-11-15): "가벼운 일은 계속".** 걸을 수 있는 다친 대원 = `r.status === 'injured'`(쓰러진 적이 없다 — 쓰러지면 `status` 가 `'down'` 이 된다)이고 후송되지 않은(`care` 없음) 대원. 그 대원은 부대에 계속 타고, 다음 현장에도 내린다 — `unitArrived` 가 `status === 'ok'` 에 더해 이 대원을 내린다(이름표 '부상 — 가벼운 일'). 현장에서는 가벼운 일(`LIGHT_WORK` — §2.5·§2.7)만 맡는다. 다친 그 현장에서는 물러났다가 돌아온다(§3.6a). 느려짐(`hurtF`)은 가벼운 일에도 걸린다.
- **배정 점수**: 결원 부대는 −18 한 번(지금 — 온전한 대원이 정원보다 적을 때). `crewReady` 가 걸을 수 있는 다친 대원도 세게 되므로(아래) 이 감점 줄은 `crewOk` 를 보게 옮기고, 걸을 수 있는 다친 대원만 남은 부대가 무거운 일이 필요한 사건에 1순위로 가지 않게 한 줄을 더한다(§6.4 — 관제는 자기 조직의 대원 상태만 본다).
- **배정에서 빠지는 부대 — 사람이 없어서.** 부대가 출동에서 빠지는 것은 걸을 수 있는 대원이 한 명도 없을 때뿐이다: 전원 순직, 또는 살아 있는 대원이 모두 쓰러졌거나(`down` — 움직일 수 없다) 병원으로 후송됐을 때(§3.4 — `care` 가 있다). 이것은 운용 중단 규칙이 아니라 움직일 사람이 없어서다 — 후송된 대원은 그 교대에 돌아오지 않으므로(병원 뒤 결과는 모델에 없다 — §12.3) 그 부대는 교대 끝까지 사람이 없다. 내리지 않는 자리(조종사·정장)만 남은 헬기·구조정도 내릴 사람이 없으므로 같다. 지금 코드의 '대원 전원 부상으로 운용 중단.' 갈래는 없앤다 — 다쳐도 걸을 수 있으면 나가므로 '전원 부상'은 더 이상 까닭이 아니다.
- **구현 — `resources.ts`.** 관제는 복귀 중(`returning`)인 부대도 다시 배정하고(`dispatcher.ts:61`) `crewReady === 0` 인 부대만 건너뛴다(`dispatcher.ts:50`). 그래서 사람이 없는 부대는 기지에 닿을 때의 `oos` 만이 아니라 `crewReady` 안에서 0 이 되어야 한다. 이렇게 둔다:
  ```ts
  export function crewOk(sim: Sim, u: Unit): number { /* 지금의 crewReady 본문 (R1 이면 fieldCrew 가운데 status === 'ok') — 온전한 대원 */ }
  /** 걸을 수 있는 대원 = 현장에 내릴 수 있는 대원. unitArrived 가 내리는 사람과 같은 술어를 쓴다. R1 없이 u.crew */
  export function crewReady(sim: Sim, u: Unit): number {
    return fieldCrew(sim, u).filter((rid) => {
      const r = sim.responders[rid];
      return !r.dead && r.care === undefined && (r.status === 'ok' || r.status === 'injured');   // 쓰러짐('down')·후송·순직·I2 의 결장('off')은 세지 않는다
    }).length;
  }
  ```
  0 이 되는 것은 걸을 수 있는 대원이 하나도 없을 때뿐이다 — 인원 문턱도 순직 검사도 없다. 값은 R1 의 `crewReady`(멀쩡한 대원 수 — 이제 `crewOk`)보다 크거나 같다. `unitArrived` 의 내리는 사람도 같은 술어로 고른다(따로 적으면 "배정은 됐는데 아무도 내리지 않는 부대"가 생긴다). `arrive` 의 `returning` 은 `crewReady === 0` 이면 지금처럼 `oos` 이고, 문구만 까닭에 따라 고른다: 내리는 대원이 모두 숨졌으면 '${호출부호} 대원 전원 순직 — 운용 중단.', 숨지지 않은 대원이 모두 후송됐으면(`care` 가 있다) '${호출부호} 남은 대원 모두 병원 이송 — 운용 중단.', 그 밖(남은 대원이 쓰러진 채 아직 후송되지 않음 — 5번 블록이 쓰러졌던 대원을 태워 병원부터 가므로 드물다)은 '${호출부호} 걸을 수 있는 대원이 없어 운용 중단.'. `scripts/metrics.ts` 의 `PHRASE.T6` 를 `/(?:대원 전원 순직 —|남은 대원 모두 병원 이송 —|걸을 수 있는 대원이 없어) 운용 중단/` 으로 바꾸고(I1 §2.3 표도 같이) `tests/causality.test.ts` 를 통과시킨다 — 그 시험의 T6 사례(극한 S10·S13·S18 에서 '전원 부상' 기록을 찾는다)는 이 규칙에서 사라지므로 시험을 고친다(§11-15). 운용 중단 기록의 `causes` 에는 그 부대의 마지막 `RESPONDER_HURT`·`RESPONDER_KILLED` 기록 id 를 넣고, 그 id 를 부대 칸 `u.oosEv`(선택 칸 — 위 "객체 모양" 규칙대로 부대 리터럴에 `undefined`)에 둔다(I1-b C6 이 `sim.events` 를 거슬러 찾지 않게 — I1 §3.11 0단계 7번). 시험 11-12 가 이 절의 경우를 본다.
- 인근 도시 지원 대원(`u.aid`)도 같은 규칙을 따른다. 명부 출력(§3.7)에서는 뺀다.

#### 3.6a 다친 현장에서 — 물러났다가 가벼운 일로 돌아온다

- 다친 순간은 지금처럼 물러난다(§2.5 의 물러남 — 체력 40 아래 또는 출혈). 체력 40 아래의 후퇴는 대기 지점에 닿을 때까지 이어 간다(Z1 "다친 대원의 후퇴는 끝까지" — `brain.ts` 의 붙잡기 그대로). 닿으면 `withdrawn`(지금).
- **돌아오는 조건**(`sceneManager.agentHealth` — 상태 전이는 이 한 곳에서, §3.2): `a.status === 'withdrawn'` 이고, `r.status === 'injured'`·`r.care === undefined`·`!needsHospital(r)`(자기 몸 — 출혈이 0.01 아래로 멎었고 체력 40 초과, 쓰러진 적 없음)이고, 그 대원을 대상으로 한 `active` `treatMate` 가 없고, 이 현장에서 아직 돌아온 적이 없으면(`!a.lightBack`) → `a.status = 'active'; a.lightBack = true; a.task = null; a.label = '부상 — 가벼운 일'`, 자기 보고 `learnQuiet(sim, a, mateFact(sim, s, a, 'light', r.name, 0))` 바로 뒤에 같은 자리에서 `flushOutbox(sim, s, a)`, 기록 `emit({ inc: I.id, role: 'RESPONDER', actor: r.name, rid: r.id, kind: 'action', imp: 1, text: '처치 받음. 가벼운 임무로 복귀합니다.' })`(상태를 바꾸는 그 자리). 대개 처치(§3.4-2 — 체력 +8q, 출혈 × (1 − 0.9q)) 뒤에 이 조건이 맞는다. 병원이 필요한 대원(체력 40 이하·출혈 0.01 이상·쓰러졌던 적 있음)은 `withdrawn` 으로 남아 후송을 기다리고, 그 교대에 돌아오지 않는다. 부대가 떠날 때 병원이 필요 없는 다친 대원은 부대와 함께 타고(5번 블록은 `needsHospital` 인 사람만 `aboard` 에 넣는다) 다음 현장에 내린다(§3.6).
- **처치한 뒤 병원이 필요 없으면 태우지 않는다**: `treatMate` 실행부(§3.4-2)는 처치를 마친 뒤 대상이 `needsHospital` 이 아니면(실행부는 진실을 읽어도 된다) `w.prop` 이 있어도 차로 끌고 가지 않고, `learn(sim, a, mateFact(…, d), true, true)` 로 강제 보고한 뒤 끝낸다. 그래야 그 대원이 위의 조건으로 돌아온다(안 그러면 병원이 필요 없는 대원을 태워 그 교대에서 빼게 된다).
- **고른 쪽**: "대기 지점에 닿은 뒤 가벼운 일을 맡는다". "그 교대 동안 쉰다"는 쓰지 않는다 — 다쳐도 부대가 멈추지 않는다는 사용자 뜻에 맞는 쪽이다. 병원이 필요 없는 사람만 돌아오므로 Z1 의 붙잡기(체력 40 아래)와 부딪치지 않는다 — 돌아온 대원은 체력 40 초과·출혈 없음이라 `dangerScore` 의 물러남 조건에 걸리지 않는다.
- **왕복을 막는다**: 다시 물러나면(체력 40 아래·출혈) 그 현장에서는 다시 돌아오지 않는다(`a.lightBack` — CLAUDE.md "쉬는 대원의 왕복"). 다음 현장에서는 새 개체라 다시 내린다.
- **지휘관 쪽**: `mate` 사실이 `'light'` 인 동료는 `treatMate`·`rescueMate`·`outstanding` 의 `mates` 대상이 아니다. `orders/injury.ts` 는 `'light'` 면 열린 `treatMate` 를 거둔다 — 일하는 대원을 구급대원이 쫓아다니지 않게(R3 §2.4 가 `crew` 사실을 따로 둔 것과 같은 까닭). `mateNeedsHospital` 은 값으로 이미 거짓이다(band ≤ 1, 출혈·쓰러짐 없음). 지휘관이 그 대원에게 주는 일은 `fitFor` 가 가벼운 일로 거른다(§2.5).

### 3.7 교대가 끝난 뒤 (I2 · K1)

`buildReport` 가 `ShiftReport.roster` 를 채운다(인근 도시 지원 대원 제외). 아래 표는 `injury.ts` 의 함수 하나 `export function outShifts(r: Responder): number` 로 둔다 — `buildReport` 와 I2 가 함께 부른다(같은 표가 두 곳에 있지 않게. I2 §3.2 가 이 이름을 가칭으로 적어 두었다). 쓰러진 적은 `r.tDown !== undefined` 로 본다.

| 교대 끝의 상태 | `out` (다음에 빠지는 교대 수, 제안) |
|---|---|
| 순직 | −1 (현장·가용 인원에서 빠진다. rid 를 지키려고 `sim.responders` 에는 I2 의 `status 'off'`·공석으로 남는다. 채우는 규칙 — 신임 배치 — 은 I2) |
| 병원 인계 + 쓰러진 적 있음 | 3 |
| 병원 인계 | 2 |
| 교대 끝에 후송 중(`care === 'aboard'`) — 쓰러진 적 있음 / 없음 | 3 / 2 (I2 §3.2 의 값) |
| 쓰러진 채 병원·후송 아님(`tDown !== undefined && care === undefined`) | 3 (I2 §3.2 의 값) |
| `injured`(병원 안 감) | 1 |
| `ok` | 0 (체력이 70 이하로 남은 대원의 회복량은 I2 가 정한다) |

- **I2 가 없을 때(지금)**: 보고서의 대원 목록에 "다음 교대 결장 예상 n교대"만 보이고, 다음 교대는 지금처럼 모두 멀쩡하게 시작한다(아무것도 저장하지 않는다). `Sim` 생성자는 고치지 않는다.
- **I2(교대 간 지속 — K1 을 함께 끝낸다)가 생기면**: I2 의 `Carryover` 가 `sim.responders` 를 직접 읽고 `outShifts` 로 결장을 정해 다음 교대의 입력으로 넘긴다. 모양은 I2 가 정하되 `roster` 칸은 지우지 않는다(I2 가 `status 'off'` 대원의 `out` 을 채운다).

### 3.8 문제 코드

- `RESPONDER_HURT`(있음): 물러남·쓰러짐. 문구는 §3.2.
- `RESPONDER_KILLED`(새로, 4a) — CLAUDE.md "새 문제 코드" 절차: `types.ts` → `debrief.ts` `PROBLEM_LABEL`('대원 순직') · `order`(**맨 앞** — 분석 문장이 9줄에서 잘려도 빠지지 않게) · 문장 템플릿(§7.2). 네 곳을 같은 커밋에서(§2.1 "합집합" 규칙).
- `SUSPECT_DIED`(새로, 5) — 같은 절차: `PROBLEM_LABEL`('용의자 사망') · `order`(`'ESCALATION'` 바로 다음 — 지금 `order` 의 끝쪽(`SUSPECT_FLED` 근처)에 두면 9줄에서 잘린다) · 문장 템플릿(§7.2).

---

## 4. 용의자

### 4.1 체력과 부상

`health` 100 에서 시작(지금), 상처 출혈 `bleed`(새로, §2.3 계수 × `HOSTILE_BLEED`). **15 이하에서 쓰러진다** — 전이는 `hurtHostile` 안에서 바로 한다(`state = 'down'`(검거됐으면 `arrested` 그대로), `h.tDown ??= sim.t`, 문구 §4.6). `tickHostiles` 의 `h.health <= 0` 검사는 `h.health <= DOWN_AT && h.tDown === undefined` 로 바꿔 `hurtHostile` 을 거치지 않은 경로의 안전장치로만 남긴다. **0 이하에서 숨진다**(`h.dead`, `tDead`, `deathCause`) — 한 번 피해로는 쓰러지지 않은 용의자가 0 아래로 가지 않는다(§2.6 용의자 문턱). 출혈은 `rules/injury.ts` 가 깎는다 — 대상은 `h.where`(없으면 scene)가 `'scene'` 이고 `state !== 'escaped'` 인 용의자(활동 중·쓰러짐·검거), 첫 줄에서 `I.phase === 'closed'` 면 돌아간다. 쓰러진 용의자는 `tickHostiles` 가 건너뛰므로 쓰러진 뒤의 사망 판정도 `rules/injury.ts`(출혈)와 `hurtHostile`(그 밖의 피해)이 맡는다. 검거된(`arrested`) 채로 피를 흘리는 용의자도 `tickHostiles` 가 건너뛰므로 같다 — `state` 는 `arrested` 그대로 두고 `tDown`·`dead` 만 붙인다(검거로 세는 것이 바뀌지 않게). 투항한(`surrendered`) 용의자가 15 이하가 되면 `hurtHostile` 이 `down` 으로 바꾼다.

### 4.2 수단별 효과

| 수단 | 효과 | 부상 | 사망 |
|---|---|---|---|
| 섬광탄 | 3.8초 무력화, 사기 −0.15 (지금) | 없음 | 없음 |
| 테이저 (R1 의 `taser` — 0.72 확률로 3.2초 무력화, 그동안 덮쳐 검거) | R1 그대로 | 기록만: electric 2, 체력을 1 아래로 내리지 않는다 | 없음 |
| 비살상탄 (R2 의 `beanbag`) | R2 그대로(4초 무력화, 사기 −0.3) | blunt 8 (R2 의 −8 을 `hurtHostile` 로) | 없음 |
| 저격 (R2 의 `sniper`) | R2 그대로 | gunshot 70 + 출혈, **`{ down: true }`** — 70 으로는 체력 100 에서 30 이 남아 쓰러지지 않으므로 "결정적 저격"이 무력화가 되게 한다 | 쓰러짐. 사망은 그 뒤 처치가 늦을 때 |
| 덮쳐 제압 (맨손, 지금) | 검거 | **몸싸움**: 검거를 마치는 순간 상대가 `state === 'fight'` 이고 무력화되지 않았으면(`sim.t >= h.stunUntil`) 양쪽 blunt 3~8(`injuryRng(sim, s, 'fight')` 에서 대원 몫, 용의자 몫 순서로 뽑는다), 기록 '${용의자}가 저항해 몸싸움 끝에 검거.'(`resolve` · 3 — 지금의 검거 문구를 대신한다). 걸리는 분기: `engage` 의 ①(흉기·도주 용의자에게 다가가 검거)과 `arrest` case. ③(섬광탄·기습으로 무력화된 상대)과 ④(눈치채지 못한 상대를 곁에서 덮침)는 맞서지 않는다 | 없음 |
| 사격 (지금) | 명중 30~48 | gunshot + 출혈 | 15 이하 쓰러짐(한 번으로는 0 아래로 가지 않는다), 그 뒤 처치가 늦으면 |
| 폭발·불·연기·가스 (새로) | | blast·burn·smoke·toxic | 가능(쓰러진 뒤에는 문턱이 없다) |

`shootAt` 의 경험치 줄(`if (h.health <= 0) r.xpGained += 0.004`)은 `<= DOWN_AT` 으로. 대원은 쓰러진 용의자를 다시 쏘지 않는다(지금: `hostileActive` 가 `down` 을 빼므로 `engage` 가 끝난다 — 쓰러짐을 `hurtHostile` 안에서 바로 세우므로 같은 틱의 다른 대원도 쏘지 않는다).

### 4.3 처치·이송·호송 — 새 임무 `treatSuspect`

CLAUDE.md "새 임무 종류" 절차대로: `types.ts` `WorkKind` → `agents.ts` `workLabel`('${용의자} 응급 처치')·`fitFor` → `executor.ts` case → `orders/injury.ts` 에서 `k.want()`.

- **지휘(`orders/injury.ts`, 믿음만)**: 믿음상 활동 중인 용의자(`hold`·`fight`·`flee`)가 하나도 없을 때, `hos` 사실이 `down` 이거나 `band ≥ 1`(모르면 2 로 본다)이고 숨지지 않았고 처치가 필요하면 `treatSuspect` 를 낸다. `treatMate` 와 같이 **대상당 한 항목**(`s.board` 에서 같은 `hostile` 의 열린 항목을 먼저 찾고, 있으면 `open` 일 때만 `prop`·`priority` 를 고친다. 없을 때만 `k.want('treatSuspect', { hostile: id, prop }, 0.74 + 0.06 × band, 1)`). `prop` 은 **기다리는 구조 대상·대원 가운데 그보다 중증도가 같거나 높은 사람이 없을 때만** 정원이 남은 구급차 id, 아니면 −1(처치만). 숨짐·`aboard`·처치 끝이면 `cancel`. 맡을 수 있는 대원(아래)이 현장에 하나도 없으면 `cancel`.
- **맡는 사람(`fitFor`)**: 경찰은 언제든(기본 처치 — `q` 는 하한 0.2 안팎. R1 의 경찰 역할에는 의료 가방이 없고 순찰 팀장만 `aed` 를 든다 — R1 표 `patrolLead`), 구급대원은 `hot` 이 아닐 때(`!(s.kind === 'armed' && s.secureAt < 0)` — `treat` 의 `hot` 규칙과 같은 술어. `s.secureAt` 은 무장 현장에서만 정해지므로(`commander.ts:263`) `s.secureAt ≥ 0` 을 조건으로 쓰면 추격전·음주 운전 현장의 용의자를 구급대원이 영영 맡지 못한다). 대상 위치가 `fireRisk` 구역이면 소방만(`rescueMate` 와 같다 — R1 이 합쳐져 있으면 `scba` 를 든 대원만, R1 §6.2 와 같은 술어).
- **실행**: 대상이 숨졌거나 `where !== 'scene'` 이거나 더 나은 처치를 할 수 없으면 `learn(sim, a, hosFact(…, d), true, true)` 로 강제 보고하고 끝낸다. 곁으로 가서 처치(§2.6), '${용의자} 응급 처치 완료.'(imp 1, `rid` 는 처치한 대원 — 시험 11-7 이 이 기록을 읽는다). `w.prop === a.unitId` 이고 자리가 있으면 차까지 옮기고(`rescueMate` 처럼 대상의 좌표를 대원 뒤에 붙인다. `a.carrying` 은 쓰지 않는다 — 그 칸은 구조 대상 id 와 대원 `-(rid+2)` 만 담는다) `h.where = 'aboard'`, `u.aboard.push({ kind: 'suspect', … })`, `u.firstLoadAt ??= sim.t`, '${용의자} ${호출부호}에 태워 병원으로.'(imp 2).
- **`hos` 사실**(`agents.hosFact(sim, s, h, src, d)` — `d` 는 관찰 거리, **필수 인자**로 더한다. 지금 호출은 10곳: `agents.ts` 3·`executor.ts` 7): 값에 `dead`(`d ≤ 2` 일 때만), `band`(`d ≤ 3` 일 때만 실제 값, 그보다 멀면 `down` 이면 2·아니면 1), `tq`, `where` 를 더하고, 상태 문구 `down` = '쓰러짐', 숨졌으면 '사망'. `perceive` 는 시야 밖에서도 16칸 안이면 상태 변화를 배운다(`agents.ts:124-125`) — 그 호출에도 실제 거리를 넘기므로 멀리서는 숨진 것을 모른다. `significant()` 의 `hos` 에 `dead`·`tq`·`where` 를 넣는다. `perceive` 는 `where !== 'scene'` 인 용의자를 건너뛴다.
- **구조 대상과의 차이(일부러 둔다)**: 지금의 `casFact` 는 시야 안이면 거리와 관계없이 중증도(사망 포함)를 안다(`agents.ts:38-43`). 이것은 바꾸지 않는다 — 바꾸면 수색·처치·탑승 전체의 결과가 바뀌고, 구조 대상은 대원이 찾아가 가까이서 보는 대상이라 차이가 작다. 대원·용의자는 교전 중에 먼 거리에서 보는 일이 많아(13칸 시야, 16칸 상태 변화) 거리 조건이 판단을 바꾼다.
- **호송은 기계적으로 모델하지 않는다(결정).** 경찰관을 구급차에 태우면 그 부대가 반쪽이 되고 돌아올 길이 없어 교착을 만든다. 다친 용의자는 구급차로 병원에 가고 경찰 인계는 모델 밖이다. 이송되지 않은 용의자는 사건이 끝날 때 경찰이 데려간다(지금처럼 아무 처리 없음). R3(교본)도 호송을 다루지 않는다(R3 §1 "하지 않는 것").

### 4.4 용의자의 사망이 판정에 주는 영향 (결정)

- 쓰러진·숨진 용의자는 지금처럼 **검거로 센다**(`suspectsCaught` 의 뜻을 바꾸지 않는다 — `tests/crime.test.ts:261` 이 기댄다). 숨진 수는 `suspectsDead` 로 따로 센다.
- **교전 중(현장 안전 확보 전)에 숨진 용의자는 벌점이 없다.** 경찰의 목표는 위협을 끝내는 것이고, 무장한 용의자와의 교전에서 생긴 결과다.
- **위협이 끝난 뒤(`threatOverAt(s) ≥ 0 && tDead > threatOverAt(s)`) 숨진 용의자는 벌점 0.5.** 위협이 끝난 뒤 다친 사람을 돌보지 못한 것이고, 그것은 기록(시각)으로 가려낼 수 있다. `threatOverAt` 은 무장 현장이면 `s.secureAt`(지휘관의 안전 확보 선언), 그 밖의 현장(추격전·음주 운전 등 — `secureAt` 이 정해지지 않는다)은 첫 도착 `s.arrivedAt` 이다(§2.7).
- 근거: "성공"을 깎는 기준을 "살렸어야 했는데 못 살렸는가"에 맞춘다. 구조 대상·대원에게 쓰는 기준과 같다.

### 4.5 자해와 도주 중 사고

- **자해 — 끈다(`SELF_HARM = 0`). 사용자 결정(2026-11-15, "전부 추천대로").** 사용자 요청("부상이나 사망도 가능하게")에 없던 민감한 장면이라 꺼 두기를 추천했고, 사용자가 그대로 정했다. 다음 구현 세션은 경로만 만들고 0 으로 둔다 — 값을 올리지 않는다(올리려면 사용자의 새 결정이 있어야 한다, 결정 사항 표). 값 0 에서는 `chance(0)` 이 늘 거짓이라 투항이 지금처럼 일어나고, 추첨은 자기 흐름(`injury:<현장>:self`)에서만 돌아 다른 결과를 바꾸지 않는다. 아래는 경로의 모양(한 번만 추첨, `down` 을 한 번에 세움)을 정해 두는 것이다. 켰을 때의 규칙: `tickHostiles` 의 투항 판정(`h.morale < 0.2`)에서, 무기를 들고(`weapon !== 'none'`) 공격성 > 0.7 이고 인질이 없고 **아직 추첨하지 않은**(`!h.selfHarmRolled`) 용의자는 `h.selfHarmRolled = true` 로 표시하고 `injuryRng(sim, s, 'self').chance(SELF_HARM)` 로 한 번만 추첨한다. 걸리면 투항 대신 자해한다: 피해 22~38(총 → gunshot, 칼 → stab)을 `hurtHostile(…, { down: true })` 로 — 체력 100 근처에서 22~38 로는 15 까지 내려가지 않으므로 `down` 이 `h.health = min(h.health − 피해, DOWN_AT)`, `state = 'down'`, `tDown` 을 한 번에 세운다(안 세우면 다음 틱에도 `morale < 0.2` 검사가 다시 돌아 추첨이 되풀이된다). 기록 `raiseProblem(sim, I, 'ESCALATION', '용의자 자해', { role: 'SYSTEM', actor: '현장', imp: 3, text: '${josa(용의자, '이/가')} 스스로를 해쳤습니다. 즉시 처치가 필요합니다.' }, false)`. 그 뒤는 §4.3 이 처리한다. 묘사는 이 한 줄이 전부다. 걸리지 않으면 지금처럼 투항한다.
- **도주 중 사고**: 추격전 사고로 선 용의자(지금 `builders.ts:257`)는 처음 상태의 원인이 vehicle. **선택**: 통제되지 않은 차로가 있는 현장(`s.laneRows`)에서 `flee` 중인 용의자가 차로에 들어서면 `tickLane` 의 한눈판 차가 대원과 같은 방식으로 친다(vehicle 28~44). 시간이 모자라면 빼도 완료 조건에 영향이 없다.

### 4.6 기록 문구

모두 `hurtHostile`(쓰러짐·사망 전이를 하는 곳)과 `rules/injury.ts`(출혈로 숨짐)에서 남긴다. 조사는 `josa()`.

| 때 | 문구 | kind · imp |
|---|---|---|
| 총에 맞아 쓰러짐 | '${용의자}가 총상을 입고 쓰러졌습니다 — 무력화.' | `hazard` · 3 (지금은 `resolve` · 2 '제압됨' — 결정적 순간에 잡히게 바꾼다) |
| 그 밖의 원인으로 쓰러짐 | '${용의자}가 ${원인}으로 쓰러졌습니다.' | `hazard` · 2 |
| 숨짐 | `raiseProblem(sim, I, 'SUSPECT_DIED', '${용의자} 사망 (${원인}, 처치 전 또는 처치 후)', { role: 'SYSTEM', actor: '현장', imp: 3, text: '${용의자} 생체 반응 소실.' }, false)` | `problem` · 3 |

조사가 박혀 있는 곳(`hazards.ts:314, 377, 428` 의 `${h.label}가`, `671` 의 `${c.label}가`)은 문구를 고치는 단계에서 `josa()` 로 바꾼다(1단계에서는 고치지 않는다 — 기록 해시가 바뀐다).

---

## 5. 구조 대상

### 5.1 사건 중 새 부상

| 일 | 지금 | 바꾸는 것 |
|---|---|---|
| 폭발 (`blast`, 원인이 blast 일 때) | 체력만 | **세 부류를 고르게**: 구조 대상은 체력이 80 아래가 되면 걷던 사람도 `immobile`(갇힌 사람은 그대로), `bleed ≥ (0.09 + 0.09 × (1 − d/r)) × tune.bleedMul` — 지금 `detonate` 에만 있는 규칙을 가스 용기·누출 가스 폭발에도 쓴다(`detonate` 의 같은 반복문은 `max` 라 두 번 돌아도 결과가 같으니 그대로 둔다). 용의자도 ×0.8 로 맞는다. 원인이 crush(천장·2차 붕괴)인 `blast` 호출에는 이 규칙을 걸지 않는다 — 화재 성공률(54%)이 가장 낮으므로 화재 현장을 더 어렵게 만들지 않는다. 가스 용기 폭발은 화재 현장에서도 나므로 `--force fire/arson` 으로 따로 잰다 |
| 2차 붕괴 (`tickCollapse`) | 체력만(blast) | 원인 crush. **무너진 자리 1.6칸 안의 구조 대상(현장에 있고 업혀 있지 않고 물속이 아닌)은 갇힌다**: `mob = 'trapped'`, `trapWork = injuryRng(sim, s, 'trap').range(6, 10)`, `walking = false`, `path = null`(대피 경로가 남지 않게). 지휘관은 본 사람이 알릴 때 안다(지금의 `extricate` 가 받는다). **실행기 `carry`·`escort` 가 갇힌 대상을 만나면** 지금은 강제 보고 없이 `'gone'` 으로 끝난다(`executor.ts:526`) — 지휘관의 믿음은 '거동 불가' 로 남아 같은 `carry` 를 되풀이한다(CLAUDE.md "낡은 믿음" 함정). 끝내기 전에 `learn(sim, a, casFact(sim, s, c, r.name), true, true)` 를 더한다 |
| 화재의 천장 붕괴 (`tickFire`) | 체력만(blast) | 원인 crush (그 밖은 그대로) |
| 총격 (인질·총격범·빗나간 탄) | 체력·`immobile`·`bleed` | 원인 gunshot, `by` = 쏜 사람 기록만 |
| 가스 (`tickGas` 의 주변 시민, 가스 현장의 연기) | | 원인 toxic 기록만 |
| 익수 (`tickWater`, 해일) | 떠내려가 숨짐 | 원인 drown, `deathCause` 기록만. 현장 밖으로 떠내려간 사람에게 `c.lost = true`(화면이 그리지 않을 사람 — 물속에서 출혈로 숨진 사람과 가린다, §8.2) |
| 구출 중 사고 (`executor` `extricate`) | 없음 | **붕괴 현장에서 구출을 마칠 때 `injuryRng(sim, s, 'extricate').chance(0.06 × hazardMul × (1.2 − u.tool))`** 이면 crush 6~14(같은 흐름에서), '구출 도중 잔해가 내려앉아 구조 대상 ${이름표}가 더 다쳤습니다.'(`hazard` · 2, 조사는 `josa`). 장비가 좋을수록 드물다(R2 가 합쳐졌으면 `u.tool` 자리에 고른 방법의 장비 값 — R2 §4.3) |
| 해일 (`rules/disaster.ts`) | `c.health = Math.max(8, c.health − x)` | `hurtCas(…, c.health − Math.max(8, c.health − x), 'drown')` — 하한 8 을 지키는 양을 넘긴다(§2.7) |

### 5.2 스스로 대피하다 다치는 경우

걷는 사람은 지금도 연기·불을 지나며 체력을 잃는다(`tickCasualties` 가 `scene` 의 모든 사람에게 적용). **체력 40 이하(위중)가 되면 멈춘다**(`rules/injury.ts`): `walking = false; mob = 'immobile'; path = null`, `emit({ truth: true, kind: 'casualty', imp: 2, text: '대피하던 구조 대상 ${이름표}가 ${원인}으로 쓰러졌습니다.' })`. 관찰자만 아는 사실이다 — 지휘관은 본 사람의 보고나, 대피 중이라던 사람의 소식이 끊겼을 때 지금 규칙(32초 뒤 `escort`, `orders/major.ts` 의 40초 확인)으로 알게 된다. 렌더러는 이미 체력 40 이하를 눕혀 그린다.

**현장이 비었을 때의 종료(7번 블록)**: `commander.outstanding()` 은 믿음상 `mobile`(스스로 대피 중)인 사람을 남은 일에서 뺀다(`commander.ts:559`). 그러면 대피하다 멈춘 사람이 남은 채 마지막 지휘관이 떠나 `resolved` 로 끝날 수 있다. `outstanding(a, now)` 로 인자를 하나 더하고(부르는 곳은 `sceneManager` 7번 블록 하나), `mobile` 사실은 그 사실의 시각(`f.t`)이 32초 안일 때만 뺀다 — 그보다 오래된 `mobile` 은 소식이 끊긴 사람으로 보고 남은 일로 센다(지금의 `escort` 32초 규칙과 같은 기준).

### 5.3 이미 있는 악화 공식과의 정리

`tickCasualties` 의 악화 식은 **한 글자도 바꾸지 않는다**(1단계에서 기록만 더한다). 바뀌는 것은 ① 사건이 끝난 뒤 악화와 사망 판정을 멈춤 — `loaded` 만이 아니라 모든 구조 대상(§2.6. 대피 이동은 남는다), ② 숨진 틱의 가장 큰 항으로 `deathCause` 를 정함(이미 있으면 그대로), ③ 사망 문구에 원인을 붙임: '구조 대상 ${이름표}: 생체 반응 소실 (${원인}). 구조에 실패했습니다.' — 미발견 문구('(미발견) …')도 같다.

**B1 나머지(`f7ba1c7`)가 더한 구조 대상의 체력·출혈·사망 변경 네 곳**도 "피해는 한 길로만" 원칙에 넣는다(이 문서를 쓸 때는 없었다). 직접 바꾸는 체력·출혈을 `hurtCas` 와 `bleedCause` 로 옮기되 **난수는 지금 흐름(`crush:<사건>:<사람>`·`lift:…`·`medical:…`·`wander:…`) 그대로, 같은 자리·같은 순서로** 뽑고 뽑은 값만 넘긴다(`s.rng` 와 `injuryRng` 를 쓰지 않는다):

| 자리 (`hazards.ts`) | 지금 | 바꾸는 것 | 단계 |
|---|---|---|---|
| `tickCrush`(압궤 증후군) | `c.health = Math.max(1, c.health - …)` | `hurtCas(…, c.health − Math.max(1, c.health − x), 'crush')` — 하한 1 을 지키는 양 | 1(기록)·3 |
| `tickLift`(승강기 안 발작) | `c.health = Math.min(c.health, e.hp)` | `hurtCas(…, max(0, c.health − e.hp), 'illness')`, `bleedCause = 'illness'` | 1·3 |
| `tickMedical`(중증 응급의 급변) | `c.health = Math.min(…)`, `c.bleed0`·`c.bleed` 직접 설정 | 체력은 `hurtCas(…, 'illness')`, 출혈은 지금 식 그대로 두고 `bleedCause = 'illness'` | 1·3 |
| `tickWander`(배회 실종자) | 개울에 빠짐·넘어짐·물살(`c.health = Math.max(5, …)`·`Math.max(1, …)`, `c.bleed`·`c.bleed0` 직접 설정), 표류 사망(`c.dead = true; c.health = 0`) | 빠짐·물살 → `hurtCas(…, 하한을 지키는 양, 'drown')`, 넘어짐 → `'fall'`, 추위로 늘어난 출혈은 `bleedCause = 'exposure'`. 표류 사망은 `deathCause = 'drown'` 을 먼저 적고 지금 줄 그대로(사망은 지금처럼 그 자리에서). 기록 문구는 지금 그대로 | 1·3 |

1단계에서는 지금 식 옆에 `noteInjury` 만 더한다(해시 불변). `hurtCas` 로 옮기는 것은 3단계이고 해시 변화에 포함한다. Z1·B1 이 이 함수들을 더 고쳤으면 함수 이름으로 찾는다.

### 5.4 사망 판정 시점과 보고

- 숨지는 때: 체력 ≤ 0 인 틱(지금). 떠내려가 현장 밖으로 나간 때(지금).
- 판정에 들어가는 때: `closeIncident` 의 `evaluate` 한 번(지금). §2.6 의 "사건이 끝나면 악화를 멈춘다"로 판정 뒤에 숨지는 일이 세 부류 모두 없다(시험 11-9).
- 보고: 살아서 처음 발견된 사람의 사망은 지금처럼 imp 3(진실 아님), 미발견이면 truth. 숨진 사람을 발견하면 지금처럼 '생체 반응이 없습니다'(imp 2) — 대원은 원인을 모르므로 원인을 붙이지 않는다. 보고서는 사후 판정이라 원인을 쓴다(§7.2).
- 시신 수습 임무는 만들지 않는다(현장 보존이 원칙). 덮개는 화면이 "확인된 사망"에 그린다(§8.2).

---

## 6. 지휘와 관제

### 6.1 정보 격리 — 누가 무엇으로 아는가

| 누구의 무엇 | 지휘관이 아는 길 |
|---|---|
| 구조 대상의 중증도·거동·위치 | `cas` 사실(본 대원의 보고, 지금) |
| 동료가 쓰러짐 | 본 대원의 `mate` 사실(지금). 숨졌는지는 2칸 안에서 본 대원만(`mateFact` 의 `d`) |
| 동료가 다쳐 물러남·안전 구역 도착 | **다친 대원 본인의 보고**(새로, §3.2 — `learnQuiet` 로 대기열을 거친다) |
| 동료가 후송됨 | 태운 구급대원의 `mate` 사실(`evac`) |
| 동료가 병원이 필요한가 | `mateNeedsHospital(v)` — `mate` 사실의 값만 본다(§2.7). 진실 함수 `needsHospital(r)` 는 지휘 쪽에서 부르지 않는다(함수 호출 안에 숨은 진실 읽기라 정규식으로 잡히지 않는다 — 시험 11-8 이 import 를 본다) |
| 용의자가 쓰러짐·숨짐·중증도 | `hos` 사실(본 대원, 거리 조건 §4.3) |

`orders/injury.ts` 는 믿음(`a.beliefs`), 작업 목록(`s.board`), `sim.units`(부대 상태)와 `sim.responders[rid]` 의 `.unitId`·`.dept`·`.name`(명부)만 읽는다. 다른 대원의 `health`·`bleed`·`dead`·`injuries`·`care`·`tDown` 을 읽지 않고, `injury.ts` 에서는 `mateNeedsHospital`·`bandOf`(믿음 속 값에) 같은 믿음 쪽 함수만 import 한다 — 테스트가 잡는다(§11-8).

### 6.2 중증도 분류(트리아지) 순서

지금의 지휘관은 이미 중증도 순서로 움직인다(우선도에 `band × 0.06`). H1 은 대원·용의자를 같은 식에 넣는다. 같은 중증도면 "같은 상태 = 같은 우선도"가 원칙이고, 용의자만 위협이 끝난 뒤로 미룬다.

| 일 | 우선도 | 조건 |
|---|---|---|
| 쓰러진 동료 구조 `rescueMate` | 0.97 (숨진 줄 알면 0.55) | 지금 |
| 갇힌 사람 구출·물속 구조 | 0.82·0.9 + 0.06×band | 지금 |
| 구조 대상 처치 `treat` | 0.8 + 0.06×band (안전 구역 0.72 + …) | 지금 |
| 다친 대원 처치 `treatMate` | 0.8 + 0.06×band | 구급대원이 있을 때 |
| 다친 용의자 처치 `treatSuspect` | 0.74 + 0.06×band | 활동 중인 용의자가 없을 때 |
| 구급차 태우기 `load` / 태우기를 겸한 처치 | 0.5~0.7 + 0.06×band | 용의자는 더 무겁거나 같은 사람이 기다리지 않을 때만 |

- 초록(경상)은 걸을 수 있는 사람이다: 스스로 안전 구역으로 가고, 처치·이송 대상이 아니다(지금 그대로 — START 분류의 "지연" 묶음).
- 검정(사망)은 손대지 않는다(지금). 대원만 수습한다(§3.4).

### 6.3 다수 사상자 규칙과의 관계

`orders/major.ts`(N5)는 고치지 않는다. 그 규칙은 구조 대상만 센다. `orders/injury.ts` 는 병원이 필요한 대원·용의자를 더해 다시 센다: 구조 대상(band 1~2 대기) + 대원(믿음상 `mateNeedsHospital`) + 용의자(믿음상 쓰러짐·band ≥ 1) 가 5명 이상인데 구급 부대가 `min(5, ceil(n/2))` 보다 적으면 `k.request('ems', '부상자 n명(대원·용의자 포함)', true)`. `request` 는 같은 분야의 요청이 아직 채워지지 않았거나 70초 안에 있었으면 무시되므로(`commander.ts:62`) 둘이 겹쳐도 한 번만 나간다.

### 6.4 관제

`dispatch/*` 는 세 줄만 고친다(§3.6 의 사용자 결정 둘):

1. 감점 줄 `crewReady(sim, u) < u.crew.length`(R1 뒤 `< fieldCrew(sim, u).length`) → `crewOk(sim, u) < fieldCrew(sim, u).length` — 온전한 대원이 정원보다 적으면 −18 한 번(지금의 뜻 그대로). `crewReady` 가 걸을 수 있는 다친 대원도 세게 되었으므로 이 줄만 `crewOk` 로 옮긴다.
2. 새 줄 `if (crewOk(sim, u) === 0 && HEAVY_NEED.has(key)) score -= 25;` — 걸을 수 있는 다친 대원만 남은 부대는 가벼운 일만 할 수 있으므로 무거운 일이 필요한 수요(`HEAVY_NEED` = `suppression`·`rescue`·`ems`·`tactical`·`search`·`eod`)에 1순위로 가지 않는다. 빼지 않고 점수만 낮춘다 — 다른 후보가 없으면 그래도 간다(다쳐도 부대가 멈추지 않는다). `law`·`traffic` 은 봉쇄·협상·면담·교통 통제로 할 수 있어 더 깎지 않는다. 관제가 읽는 것은 자기 조직의 대원 상태(`crewOk` — 명부의 `status`)뿐이다(정보 격리 — 현장의 진실을 읽지 않는다).
3. 선착 대응(`firstResponder`)의 후보 건너뛰기 `crewReady(sim, u) === 0` → `crewOk(sim, u) === 0` — 선착 대응 부대는 구급차보다 먼저 가서 집 안의 환자를 처치하는데, 그것은 가벼운 일(안전 구역의 처치 보조)이 아니다. 같은 함수의 `spare`(남는 소방 부대가 있나)는 `crewReady` 그대로 둔다.

나머지 자리(`pickUnit` 의 `crewReady === 0` 건너뛰기, 같은 분야의 남은 부대 수)는 그대로 `crewReady` 를 본다 — 걸을 수 있는 대원이 하나도 없는 부대(전원 순직·쓰러짐·후송)만 빠진다. 복귀 중인 부대도 마찬가지다. 순직 대원은 `status === 'down'` 이라 어디에도 세지 않는다. '대원 부상'·'부상 대원 후송' 요청은 지금의 지원 요청 경로로 간다.

---

## 7. 판정과 보고서

### 7.1 `evaluate` 의 점수

| 무엇 | 벌점 `bad` | 비고 |
|---|---|---|
| 구조 대상 사망 | 2 | 지금. 절반 이상 숨지면 `failed`(지금) |
| 대원 부상(물러남) | 0.75 | 지금. 순직·쓰러짐을 뺀 수 |
| 대원 쓰러짐 | 1.5 | 지금. `downCount` 에서 순직을 뺀다(`status === 'down' && !dead`) |
| **대원 순직** | **3** | 새로. 다른 문제가 없어도 `partial` 이 되고, 하나 더 겹치면(예: 구조 대상 사망) `failed`(4.5 이상) |
| **용의자 사망 — 위협이 끝난 뒤** | **0.5** | 새로 (§4.4, `threatOverAt`) |
| 용의자 사망 — 교전 중 | 0 | 검거로 센다 |

`IncidentResult` 의 새 칸(`respondersDown`·`respondersKilled`·`suspectsHurt`·`suspectsDead`·`deathCauses`)을 채운다. `respondersHurt` 의 뜻(이 사건에서 RESPONDER_HURT 가 난 대원 수)은 그대로.

**순직은 `hurtRids` 와 따로 센다.** 문턱(§2.6)을 이 틱 시작 때의 체력(`a.hpTick`)으로 보므로 멀쩡하던 대원이 RESPONDER_HURT 없이 숨지는 일은 없어야 하지만, 집계가 그 가정에 기대지 않게 한다: `killed` = 이 사건의 `RESPONDER_KILLED` 기록의 `rid` 집합, `down` = `hurtRids` 가운데 `killed` 에 없고 `status === 'down'` 인 수, `hurt` = `hurtRids` 가운데 `killed` 에도 `down` 에도 없는 수. `bad += killed.size × 3 + down × 1.5 + hurt × 0.75`. 지금의 `downCount`(`status === 'down'` 만 본다)는 숨진 대원(`status` 가 `'down'` 그대로)을 쓰러짐으로 세므로 이 셈으로 바꾼다.

### 7.2 문장 — 담담하고 정중하게, 기록에서만

문장의 재료는 ① 기록된 문제(`I.problems` — detail 은 그 문제를 일으킨 코드가 쓴 것), ② 타임라인(`tDown`·`tDead`·`tTreated`…), ③ 부상 기록(`injuries`·`deathCause` — 다치게 한 코드가 적은 것)뿐이다. 감탄사·감정 낱말("안타깝게도", "비극적으로")을 쓰지 않는다. "사망자" 대신 "숨진 사람", 대원은 "순직".

- `RESPONDER_KILLED`: `순직: ${detail 들을 ' / ' 로}.` → "순직: 김도윤 대원(진압1) — 화상, 쓰러진 뒤 1분 50초 동안 구조되지 못함." (원인과 경과는 §3.2 에서 숨지는 순간에 상태로 만든 detail 에 이미 들어 있다.)
- `RESPONDER_HURT`: "대원 피해: 이서준 대원 부상 (총상), 박하준 대원 쓰러짐 (연기 흡입)." (지금 형식 그대로, detail 만 바뀐다)
- 구조 대상 사망: 지금의 세 문장 끝에 원인을 괄호로 — "구조 대상 B는 도착 2분 10초 뒤 발견됐지만 처치를 받기 전에 숨졌습니다 (연기 흡입)."
- `SUSPECT_DIED`: "용의자 1은 교전 중 총상을 입고 쓰러졌고, 처치를 받기 전에 숨졌습니다." / 위협이 끝난 뒤면 "… 현장 안전 확보 뒤 1분 20초 동안 처치를 받지 못하고 숨졌습니다."(무장 현장이 아니면 "… 대원 도착 뒤 …") (`threatOverAt`·`tDead`·`tTreated` 로)
- 한 줄 요약(`headline`): '대원 n명 부상' → `대원 ${부상}명 부상${순직 ? `, ${순직}명 순직` : ''}`. 용의자: `용의자 ${n}명 중 ${m}명 검거${사망 ? ` (사망 ${k})` : ''}`.
- 분석 문장은 9줄(문제)·11줄(사망까지)에서 잘린다(지금). `RESPONDER_KILLED` 를 `order` 맨 앞에 두어 잘리지 않게 한다.

### 7.3 교대 보고서의 집계 (`buildReport`)

- `respondersHurt`: 지금처럼 `status !== 'ok'` 인 대원. `status` 문구를 '순직' · '쓰러짐' · '부상' 으로, 새 칸 `rid`·`band`(교대 끝 체력)·`cause`(`mainCause`)·`dead`·`hospital`·`out`(`outShifts(r)`) 을 채운다. `scripts/sweep.ts` 의 "대원 부상" 수(`respondersHurt.length`)는 순직을 포함한 수로 남는다.
- `respondersKilled`·`suspectsHurt`·`suspectsDead`·`roster`(§3.7)를 채운다.
- 요약(`summary`)에 줄을 더한다(있을 때만):
  - "대원 피해: 부상 2명(병원 이송 1명)." 
  - "순직: 김도윤 대원(진압1, 사건 F-03 화재)." — 교대에 순직이 있으면 첫 줄 바로 다음에 둔다.
  - "용의자 3명이 다쳤고 그중 1명이 숨졌습니다."
  - 구조 대상 줄은 지금 그대로에 숨진 원인 집계를 붙인다: "… 6명은 구하지 못했습니다(연기 흡입 4, 총상 2)."

---

## 8. 화면

화면만 고치는 단계(§10 의 2단계)는 `sweep` 분포가 한 건도 바뀌면 안 된다. 연출용 난수는 지금처럼 `hash2` 만 쓴다. 2단계의 그림은 `r.dead`·`r.tDead`·`r.care`·`h.dead`·`h.where`·`c.lost` 같은 칸을 읽는데, 이 칸들은 3·4a·4b·5단계에서야 값이 생긴다(2단계에서는 늘 비어 있다). 그래서 2단계의 스크린샷은 "지금 있는 상태(쓰러짐·딱지·피 없음)"만 확인하고, **덮개·들것·후송·용의자 사망 그림은 5단계 뒤에 다시 찍어 확인한다**(§10 완료 조건 5).

### 8.1 중증도 색 — `src/view/triage.ts` 한 곳

```ts
export const TRIAGE = ['#5ad17a', '#ffd166', '#ff5d5d', '#14181d'];   // 초록 · 노랑 · 빨강 · 검정
export const TRIAGE_EDGE = ['#0b1219', '#0b1219', '#0b1219', '#cfd6dc']; // 검정 딱지는 밝은 테두리와 흰 글씨 (배경 #070b10 위에서 보이게)
export const TRIAGE_TEXT = ['#0b1219', '#0b1219', '#0b1219', '#e8f0f7'];
```

`renderScene.ts:39` 의 `BAND_COLOR`, `styles.css` 의 `.band-0~3`(파일 끝 `/* ── injuries ── */` 블록에서 덮어쓴다), `App.tsx` 의 현장 범례가 이 값을 쓴다. 범례에 **사망**(검정)·**들것**·**덮개** 항목을 더한다. `rgba()` 는 색 계산에 넣지 않는다(CLAUDE.md "색 계산").

### 8.2 사람 그림

**피 표현과 'hit' 효과는 G5 가 이미 바꿨다**(G5 §3.9 — `9ab7fdb` 로 합쳐짐): `drawLying` 의 `blood` 옵션과 붉은 타원(`sprites.ts:169`), `renderScene.ts` 의 세 `blood:` 인자(구조 대상 328·용의자 353·대원 398줄), 'hit' 의 붉은 사각 조각·붉은 고리(`renderScene.ts:634-637`의 `rgba(230,50,50,…)`·`rgba(255,90,90,…)`)가 지워지고, 'hit' 은 흰 고리 + 회색 먼지 + 피격 불꽃이 된다. H1 은 'hit' 을 다시 그리지 않고 **남은 붉은 표현이 없는지만 확인한다**(시험 11-10 — G5 의 시험 9 와 같은 문자열 검사). G5 는 이미 합쳐져(`9ab7fdb`) 이 셋을 지웠다 — 확인만 한다.

| 상태 | 구조 대상 | 대원 | 용의자 |
|---|---|---|---|
| 다침(서 있음) | 지금 그대로 | **다친 자세**(§8.3) | 다친 자세 |
| 쓰러짐 | 누움(피 없음), 위중이면 빨간 맥박 고리(지금) | 누움 + 빨간 맥박 고리(지금, 피 없음) | 누움(피 없음) |
| 옮겨지는 중 | 들것(지금. R1 이 합쳐졌으면 R1 규칙: 옮기는 사람이나 곁의 사람이 `stretcher` 를 가졌을 때만 들것, 아니면 끌기 자세) | **들것**(`carrying ≤ −2` 인 대원이 끌고 있을 때 — 들것 규칙은 왼쪽과 같다) | 들것(쓰러진 용의자의 좌표가 그 틱에 바뀌었을 때 — `treatSuspect` 가 차로 옮기는 중) |
| 처치 받음 | 붕대 + 딱지의 흰 십자(지금) | 붕대(누운 경우) / 딱지에 흰 십자 | 붕대 / 흰 십자 |
| 안전 구역의 다친 대원 | — | `tDown` 이 있으면 **계속 누운 모습**(지금은 다시 서 있게 그려진다), 아니면 앉거나 다친 자세. 투명도 0.6 은 없앤다 | — |
| 확인된 사망 | 덮개 — `dead && tDiscovered ≥ 0` 일 때. 관찰자 시점의 미발견 사망은 누움 + 흐린 검정 딱지 | 덮개 — 관찰자 시점은 `tDead` 3초 뒤, AI 시점은 지휘관의 `mate` 사실이 `dead` 일 때 | 덮개 — 같은 규칙(`hos` 사실의 `dead`) |
| 차에 탐 | 그리지 않음(지금) | 그리지 않음(`left`) | 그리지 않음(`where !== 'scene'`) |
| 떠내려가 현장 밖 | **그리지 않음**(`c.lost` — `dead && drift > 0` 으로 가리면 물속에서 출혈로 숨진, 아직 현장 안에 있는 사람까지 지워진다) | | |

딱지: 구조 대상의 딱지(지금)에 더해, **다친 대원(band ≥ 1)과 쓰러진·다친 용의자** 위에도 같은 중증도 색 딱지(글자 없이 색과 흰 십자)를 단다. 용의자 알약의 상태 글자: `down` = '쓰러짐', 숨졌으면 '사망'(지금 '제압'). 딱지 그림 함수는 H1 이 만든다(G4 는 사람 딱지를 만들지 않는다).

### 8.3 다친 대원의 자세·속도

- `sprites.ts` 의 `PersonPose` 에 `hurt?: number`(0..1), `ArmPose` 에 `'clutch'`(한 팔로 옆구리를 붙듦). G5 가 먼저 더한 `recoil`·`flinch`·`crouch`(G5 §6 표)와 같은 타입에 둔다 — 맞는 순간의 움찔은 G5, 다친 뒤의 자세는 H1. `hurt` 가 크면 걸음 폭을 줄이고 몸을 조금 기울인다. 쓰는 곳: 대원 band ≥ 1, 용의자 체력 < 60.
- 느린 걸음은 시뮬레이션 쪽(`hurtF`)이 이미 만든다. 화면은 걸음 애니메이션 속도를 실제 이동량에 맞춘다(지금 `moving` 판정 그대로).

### 8.4 패널

- **대원 칩**(`panels.tsx:131-152`): 칩의 class 를 `band-k`(교대 끝 체력 기준)와 `dead` 로. `.cchip.injured` 와 `.cchip.down` 이 같은 색인 것을 중증도 색으로 나눈다. title 에 원인('총상 · 출혈').
- **대원 정보창**(`panels.tsx:280-315`): '건강' 막대 색을 중증도 색으로(지금 두 가지뿐). '부상' 줄: 원인별 피해("총상 32 · 연기 흡입 8"), 출혈 여부, 처치(기본/전문), 후송('구급1 탑승' / '병원 인계'). 상태 문구: `down` → '쓰러짐', 순직 → '순직', `withdrawn` → '부상 — 후송 대기' / '처치 받음 — 후송 대기'. 현장에 없는 대원도 `Responder` 의 상태('병원 인계', '순직', '부상 — 다음 교대 결장 예상 n')를 보인다.
- **구조 대상·용의자 정보창**(새 `PersonCard.tsx`): `Viewport` 가 버리던 `hit.cas` 를 쓰고 `hitScene` 이 용의자도 돌려주게 한다(`{ rid, cas, hostile }`). 보이는 것: 이름표, 중증도(색), 거동, 위치(현장·안전 구역·이송 중·병원), 원인별 부상, 처치, 타임라인(발견·구출·처치·안전 구역·탑승·병원·사망). 용의자는 상태·무기·부상·처치·이송. **AI 시점에서는 지휘관의 믿음(`cas`·`hos` 사실)만**, 관찰자 시점에서는 진실을 보인다. 이 창은 H1 이 만든다(G4 는 사람 정보창을 만들지 않는다).
- **사건 카드**(`panels.tsx:54-96`): 중증도 칩은 지금처럼 지휘관 믿음으로 센다. 사망 칩 색만 바뀐다.
- **보고서**(`panels.tsx:383-445`): 타일 '대원 부상'(순직 제외 수), **'대원 순직'**(1 이상일 때만, 차분한 어두운 색 — 빨강을 쓰지 않는다), **'용의자 사상'**("다침 n · 사망 m", 1 이상일 때만). 대원 목록: "이서준 (순찰2) — 위중 · 총상 · 병원 이송 · 결장 예상 2", 순직은 "김도윤 (진압1) — 순직 · 화상 · F-03".
- **속보·무전 기록**: 사망·순직 기록(`casualty` imp 3, `RESPONDER_KILLED`, `SUSPECT_DIED`)에 `loss` class — 차분한 회청색 테두리(`.ticker.loss`, `.k-casualty`). 빨강 '경고'로 보이지 않게.

### 8.5 결정적 순간·자동 감속·카메라

| 기록 | imp | 감속(`Viewport`) | 주요 장면(`reelMoments`) |
|---|---|---|---|
| 대원 순직 | 3 | ○ | ○ |
| 대원 쓰러짐 | 3 (지금) | ○ | ○ |
| 대원 부상(물러남) | 2 (지금) | — | — |
| 용의자 총상으로 쓰러짐 | 3 (지금 `resolve` 2 → `hazard` 3) | ○ | ○ |
| 용의자 사망 | 3 | ○ | ○ |
| 구조 대상 사망 | 3 (지금) | ○ | ○ |
| 대피하던 사람이 쓰러짐 | 2, truth | — | — |

카메라(`camera.ts:160-171`): 현장 자동 확대의 무게에 **쓰러진 대원(1.0)과 그를 구하러 가는 대원**을 더한다. 지금은 `task` 가 없는 `down` 대원이 빠진다.

### 8.6 소리 (선택)

`audio.ts`(G4 가 맡는 파일 — 분기 하나만 더한다): `RESPONDER_KILLED` 는 일반 문제 소리(톱니파 두 음) 대신 `loss` 음을 더 낮고 길게(140→90Hz, 0.9초). `SUSPECT_DIED` 는 구조 대상 사망과 같은 `loss` 음. 들어 보고 고치는 일은 A1(소리 다듬기)에 넘긴다.

### 8.7 하지 않는 것

도시 지도의 사건 핀·구급차 표식에 사상자 수 표시(G4·U 쪽에서 정한다), 시신 수습 장면, 분류소 천막 소품(C4 다수 사상자 사고의 몫).

---

## 9. 균형

부상·사망이 늘면 결과 분포가 바뀐다. 시뮬레이션을 고친 단계마다 전후를 잰다.

### 9.1 목표 범위

| 무엇 | 보통(시드 60) | 그 밖 |
|---|---|---|
| 성공+대응 지연 | 지금(78%) ± 4%p, `npm run check` 범위(65~90%) 안 | 프리셋 넷의 순서 유지(쉬움 > 보통 > 어려움 > 극한) |
| 실패+미해결 | 지금 + 3%p 이하 | |
| 한계 시간·방치·출동 없음 | 지금 + 2건 이하 | 극한 + 6건 이하 |
| 구조율 | 지금(92%) − 3%p 이상 | |
| 대원 부상(`respondersHurt`, 순직 포함) | 교대당 **0.15~0.5** (지금 ≈ 0) **(확인 필요: 첫 측정 뒤 정한다)** | 극한 ≤ 2 |
| 대원 쓰러짐 | 교대당 ≤ 0.1 | |
| 대원 순직 | 교대당 **≤ 0.02** (60교대에 0~1건) | 어려움 ≤ 0.05, 극한 ≤ 0.15 |
| 사람이 없어 빠진 부대(§3.6 — `crewReady` 0 으로 기지에서 `oos` 가 된 부대: 전원 순직·남은 대원 모두 후송·걸을 수 있는 대원 없음. 운용 중단 규칙이 아니므로 목표가 아니라 **보고 지표**다) | 수치만 보고한다. 교대당 0.3 을 넘으면 부상·후송이 많다는 뜻이므로 §9.3 의 1·2번(부상을 줄인다)으로 맞춘다 | 부대 규모 1(`--diff 3,3,3,3,3,1`) 30교대에서 같은 값을 따로 보고한다 |
| 순직 대원이 있는 부대(보고 지표 — 남은 대원으로 계속 출동한다, §3.6) | 수치만 보고한다(대원 순직의 목표를 따라간다) | |
| 가벼운 일로 돌아온 대원(보고 지표 — §3.6a) | 수치만 보고한다. 다친 대원이 다시 쓰러지는 일이 늘면(가벼운 일 중의 RESPONDER_HURT) `LIGHT_WORK` 의 위험 구역 조건을 먼저 본다 | |
| 용의자 사망 | 교대당 ≤ 0.3. **총에 맞아 쓰러진 용의자 가운데 25~60% 가 숨진다**(총격전의 일부). 그 가운데 **쓰러지는 순간 숨진 비율(즉사)은 0** 이어야 한다 — 용의자 문턱(§2.6)이 지켜지는지 보는 값. 사망은 모두 쓰러진 뒤에 생긴다 | `--force armed/shooter` 20교대에서 같은 비율 |
| 무장 사건 성공률 | 지금(82%) − 8%p 이상 | |

### 9.2 다시 재는 법

```bash
# 0단계에서 한 번 ($SCRATCH = 각자의 scratchpad 경로. 결과를 저장소에 넣지 않는다)
npx tsx scripts/sweep.ts 60 --json > $SCRATCH/before-normal.json
for d in easy hard extreme; do npx tsx scripts/sweep.ts 60 --diff $d --json > $SCRATCH/before-$d.json; done
for f in armed/shooter armed/hostage armed/siege armed/bomb fire/arson; do npx tsx scripts/sweep.ts 20 --force $f --scen > $SCRATCH/before-${f/\//-}.txt; done
# 시뮬레이션을 고친 단계마다 같은 명령으로 after-*.json 을 만들어 견준다. 한 교대를 읽을 때는 --log 시드
```

`scripts/sweep.ts` 에 집계를 더한다(결과는 바뀌지 않는다): `respondersKilledPerShift`, `respondersDownPerShift`, `suspectsHurt`, `suspectsDead`, `suspectsDownByGunDiedShare`(총상으로 쓰러진 용의자 가운데 숨진 비율), `suspectsInstantDeathShare`(그 가운데 `tDead === tDown` 인 비율 — 0 이어야 한다), `debrisFallsPerCollapse`(붕괴 현장 사건당 잔해 바닥 추락), `deathCauses`(숨진 구조 대상의 원인 분포), `crewOutPerShift`(사람이 없어 기지에서 `oos` 가 된 부대 수 — §3.6 의 운용 중단 문구 셋, 곧 `PHRASE.T6` 에 맞는 기록을 센다), `unitsWithKilledPerShift`(교대 끝에 순직 대원이 있는 부대 수), `lightReturnsPerShift`('가벼운 임무로 복귀' 기록 수). 출력 줄 하나: `injuries: responders hurt/shift … down/shift … killed/shift … · suspects hurt … dead … (shot-down died …%, instant …%) · falls/collapse … · causes …`.

### 9.3 범위를 벗어나면 돌리는 손잡이 (이 순서로)

1. 대원 부상이 많거나 적다 → 출혈로 물러나는 조건(`MATE_RETREAT_BLEED` 0.06 · `MATE_RETREAT_HP` 70), `BLEED_PER_DMG` 의 gunshot(0.0024)·stab(0.0015).
2. 대원 쓰러짐·순직이 많다 → `tune.injuryMul`(가운데 값 1 은 두고 표의 위쪽), `rescueMate` 의 `fireRisk`·`hot` 조건, 문턱(`MATE_LETHAL_FROM` 41), `DOWN_BLEED_CAP`(0.04).
3. 용의자 사망 비율 → **먼저 용의자 문턱의 남는 체력 `HOSTILE_LEFT`([4, 15])** — 이것이 쓰러진 뒤 숨지기까지의 시간을 정한다(출혈 0.09/s 안팎에서 체력 9.5 면 100초 남짓). 그다음 `HOSTILE_BLEED`(0.35)와 상한 0.15, 처치 우선도(0.74). 경찰 기본 처치의 `q` 는 하한 0.2 에 머물러 출혈을 18%만 줄이므로 손잡이로 쓰지 않는다(R1 의 경찰 역할에 의료 가방이 없다).
4. 붕괴 현장이 너무 어려워진다 → 2차 붕괴 갇힘 반경(1.6), 구출 중 사고 확률(0.06).
5. 새 세계 규칙(열 탈진 0.5/s, 잔해 바닥 추락 0.002·사건당 한 번)은 부상 빈도를 맞추는 마지막 손잡이다.
6. **운용 중단 조건은 손잡이가 아니다.** §3.6 은 사용자 최종 결정(2026-11-15 — 부대 대원이 전부 숨졌을 때만 운용 중단)이라 구현 세션이 좁히거나 넓히지 않는다. 인원 문턱(`minField`)이나 "순직 대원이 있으면 0" 을 대안으로 다시 넣지 않는다(§12.3 의 쓰지 않는 두 안). 다친 대원이 있는 부대가 계속 나가 결과가 나빠지면(부대 규모 1·2 에서 특히) 1·2번으로 부상 자체를 줄이고, 그래도 범위를 벗어나면 수치를 보고한다.

`npm run check` 의 기준 범위 자체는 고치지 않는다(README §4). 범위 안이지만 위 목표를 벗어나면 보고에 수치를 적는다.

---

## 10. 구현 순서와 완료 조건

단계마다 커밋하고(`wf/injuries`, 한국어 메시지, 푸시하지 않음), 단계 끝마다 `npx tsc --noEmit` · `npx vitest run tests/injuries.test.ts tests/ext.test.ts` · `npm run check` 를 통과시킨다.

| 단계 | 내용 | 결과가 바뀌는가 |
|---|---|---|
| **0. 기준** | 아래 해시 목록과 §9.2 의 `before-*` 를 scratchpad 에 저장 | — |
| **1. 기록만** | `types.ts` 의 새 자료형과 선택 칸(**합집합 멤버는 넣지 않는다** — §2.1), `injury.ts`(`noteInjury`·`bandOf`·`CAUSE_NAME`·`injuryRng`·`initInjuries`), `createScene` 의 `initInjuries` 한 줄(처음 상태 원인), 피해를 주는 모든 자리에 **기존 식 그대로 두고** `noteInjury` 한 줄씩(§12 의 "1단계" 열), `tickWater` 의 `c.lost`. `deathCause` 기록. `rules/injury.ts`·`orders/injury.ts` 는 빈 등록으로 만들고 `scenes/index.ts` 에 import 두 줄 | **아니다 — 해시 목록이 한 글자도 같아야 한다** |
| **2. 화면** | `triage.ts`, 피 웅덩이·붉은 조각이 남지 않았는지(G5 가 먼저 지웠으면 확인만), 사람 그림(§8.2), 다친 자세, 딱지, 범례, 패널·정보창(기록을 읽어 원인을 보인다), 속보 class, 카메라 무게 | 아니다(해시 같음). 스크린샷 확인 — 덮개·들것·후송은 5단계 뒤에 다시(§8 첫머리) |
| **3. 구조 대상** | `blast` 를 고르게(구조 대상 `immobile`·`bleed`), 2차 붕괴 갇힘(+ `carry` 의 강제 보고), 천장 붕괴 원인 crush, 구출 중 사고, 걷던 사람이 멈춤, `outstanding(a, now)` 의 오래된 `mobile`, **사건이 끝나면 구조 대상의 악화·사망 판정을 멈춤**(§2.6), 사망 문구에 원인, `waterRescue` 의 `bleedCause = 'exposure'`, 해일의 `hurtCas`, 박힌 조사 `josa()` | 그렇다 — sweep 비교 |
| **4a-1. 대원 — 모델** (이 커밋에서는 `withdrawn` 대원의 출혈을 멈춰 둔다 — 후송이 4b 에서 생기므로, 안 그러면 안전 구역에서 기다리다 숨진다. 4b 에서 §2.6 대로 푼다) | `'RESPONDER_KILLED'` 와 `PROBLEM_LABEL`·`order`, `hurtResponder`(방호는 §2.4 "지금" 열 — **R1 이 합쳐져 있으면 "R1 이 있으면" 열**(그것이 그때의 지금 식이다. 부서 계수로 되돌리지 않는다), `a.hpTick` 문턱, 출혈·상한), `tickScene` 의 `hpTick` 적기, `agentHealth` 개편(종료 뒤 멈춤, 순직, `tDown ??=`, 부상 조건, 자기 보고), `hurtF`, `dangerScore`·`retreat` 의 출혈 조건, 흉기·맨손 기록, `blast`·`tickLane` 의 숨진 대원 제외, `rescueMate`(숨진 동료 0.55, `hot`·`fireRisk`, 강제 보고, 물 칸 대기), `mateFact`·`significant`·`perceive`, 4번 블록 문구, `outstanding` 의 `mates`, `difficulty.ts` 의 `injuryMul` | 그렇다 |
| **4a-2. 대원 — 새 방호값** | §2.4 "새로" 열(화학의 toxic, 폭발물 처리반·경찰의 blast, 자상, crush 의 경찰. R1 이 있으면 "R1 이 있으면" 열의 같은 몫 — §2.4). 이 커밋만으로 sweep 을 따로 잰다 | 그렇다 |
| **4b. 대원 — 후송** | `'treatMate'` 와 `workLabel`·`fitFor`, `executor` case, `orders/injury.ts` 의 처치·후송·20초 규칙(대상당 한 항목, 맡을 사람 없으면 거둠), `Unit.aboard`·`firstLoadAt`, 자리 셈, `canCarryPatients`·`manageAmbulances`(진실 읽기 둘 제거, `aboard` 만 태운 차의 출발), 5번 블록(병원행, 종료 시 `boardOrder`, 고아 부대 안전장치), 병원 인계(`patientsIncident` 블록 밖), `crewReady`(걸을 수 있는 대원)·`crewOk`·`arrive` 문구(전원 순직·모두 후송·걸을 수 있는 대원 없음), `unitArrived` 가 걸을 수 있는 다친 대원을 내림, `fitFor` 의 `LIGHT_WORK`, 가벼운 일로 복귀(§3.6a)와 `mate` 의 `'light'`, 관제의 세 줄(§6.4), T6 시험(§11-15) | 그렇다 |
| **4c. 대원 — 새 규칙** | 열 탈진, 잔해 바닥 추락(`lastTile`·`fellOnce`), 덮쳐 제압할 때의 몸싸움 | 그렇다 |
| **5. 용의자** | `'treatSuspect'`·`'SUSPECT_DIED'` 와 `workLabel`·`fitFor`·`PROBLEM_LABEL`·`order`, `hurtHostile`(용의자 문턱, 쓰러짐 15 를 그 안에서 바로), 출혈·사망(`rules/injury.ts`), 폭발(`blast`)·불·연기·가스 피해, `treatSuspect`, `hosFact(…, d)` 칸, 구급차 이송, 자해 경로(`SELF_HARM = 0` — 사용자 결정으로 끈 채, §4.5), (선택) 차로에서 치임 | 그렇다 |
| **6. 판정·보고서** | `evaluate` 의 점수·문장, `IncidentResult`·`ShiftReport` 의 새 칸, 요약 줄, `roster`, 보고서 화면 타일·목록, `sweep.ts` 집계 | 판정 분포가 바뀐다 |
| **7. 균형·마무리** | §9 의 목표에 맞춰 손잡이 조정, `tests/injuries.test.ts` 완성, 화면 확인 | |

0단계의 해시 목록 — scratchpad 에 `hashes.ts` 로 저장하고 `npx tsx <경로>/hashes.ts` 로 돌린다(약 30교대):

```ts
import { Sim } from '/home/user/operator/src/sim/engine';
import { parseDifficulty } from '/home/user/operator/src/sim/difficulty';
const cases: [string, string, string | null][] = [];
for (let k = 0; k < 12; k++) cases.push(['S' + k, '3,3,3,3,3,3', null]);
for (const f of ['armed/shooter', 'armed/hostage', 'armed/bomb', 'fire/arson']) for (let k = 0; k < 3; k++) cases.push(['F' + k, '3,3,3,3,3,3', f]);
for (let k = 0; k < 4; k++) cases.push(['X' + k, '5,5,5,1,5,1', null]);
for (const [seed, d, f] of cases) { const sim = new Sim(seed, parseDifficulty(d)!, 1200, { force: f }); sim.runToEnd(); console.log(seed, d, f ?? '-', sim.report!.hash); }
```

1단계를 "결과 동일"로 지키는 법: 체력을 깎는 식의 연산 순서를 바꾸지 않는다(`a - (b + c)` 와 `a - b - c` 는 부동소수점에서 다를 수 있다). `noteInjury` 는 이미 계산된 값을 기록할 뿐이다. `initInjuries` 는 `injuries`·`bleedCause` 칸 말고는 아무것도 쓰지 않고 난수를 부르지 않는다. 새 `emit` 을 만들지 않는다(기록 해시는 문구로 만든다). `Rng.fork` 는 부모 흐름의 상태를 바꾸지 않으므로 `injuryRng` 를 나중 단계에서 처음 만들어도 다른 흐름은 흔들리지 않는다.

**완료 조건**

1. 단계 1·2 뒤 해시 목록이 0단계와 같다.
2. `npm run check` 통과, §9.1 의 목표 범위(벗어나면 수치와 이유를 보고에).
3. `tests/injuries.test.ts` 통과(§11), 다른 테스트 파일 수정 없음(`tests/sim.test.ts` 는 건드리지 않는다). **특히 깨지기 쉬운 기존 시험 둘**을 단계 4a·4c·5 마다 따로 돌린다: `tests/sim.test.ts` 의 생활 사건 성공률(`traffic/tree`·`traffic/manhole`·`collapse/elevator`·`armed/domestic` 의 순수 성공 > 0.6 — 칼 든 가정 폭력이 출혈 물러남·몸싸움에 걸린다)과 `tests/crime.test.ts` 의 폭동(6번 가운데 한계 시간·방치 ≤ 1, 해결되면 용의자 모두 검거 — 흉기 주동자 둘·맨손 가담자의 몸싸움). `npx vitest run tests/crime.test.ts -t 폭동` 처럼 이름으로 골라 돌린다.
4. `--force armed/shooter`·`armed/hostage`·`armed/siege`·`armed/riot` 20교대에서 한계 시간·방치 종료가 0단계보다 2건 넘게 늘지 않는다. 쓰러진 대원이 나온 교대를 `--log` 로 하나 읽어, 구조 → 처치 → 후송 → 병원 인계가 기록으로 이어지는지 확인.
5. 화면: `http://localhost:5210/?seed=S3&force=armed/shooter`(교전 뒤 쓰러진 용의자·처치), `…&force=fire/arson`(화재 현장, 연기 피해), `?seed=X1&diff=5,5,5,1,5,1`(대원 부상) 을 Playwright 로 찍어 본다. 2단계 뒤에 한 번(피·붉은 조각 없음, 딱지), **5단계 뒤에 다시**(덮개·들것·후송·용의자 사망이 읽히는지), 6단계 뒤에 보고서의 대원 목록·순직 타일. 콘솔 오류 0건. 찍은 그림은 저장소 밖에.
6. 보고(마지막 응답): 브랜치와 마지막 커밋, 단계별 구현 여부, 0단계 대비 sweep 표(보통·프리셋 넷·강제 시나리오), 고친 공용 파일(파일·함수·이유), 남은 문제.

---

## 11. 테스트 — `tests/injuries.test.ts`

교대를 여러 번 돌리는 묶음은 `beforeAll` 에서 한 번 돌려 나눠 쓴다(전체 30초 안팎이 되게).

1. **세 부류 모두 다친다**: `new Sim('INJ' + k, NORMAL, 1200, { force: 'armed/shooter' })` 8교대에서 — 원인 gunshot 인 부상 기록이 있는 구조 대상, 부상 기록이 있는 용의자가 각각 한 교대 이상. 대원은 `{ ...NORMAL, threat: 5, severity: 5, equipment: 1 }` 8교대에서 부상 기록(band ≥ 1)이 있는 대원이 한 명 이상. 모든 사건이 끝난다.
2. **원인별 기록**: 사건 하나를 `createIncident(sim, { type: 'fire', rng: sim.rng.fork('t') })` 로 일으키고 부대가 도착할 때까지 돌린 뒤, 원인마다 `hurtCas`·`hurtResponder`·`hurtHostile`(용의자는 무장 사건에서) 를 직접 불러 — 기록이 그 원인으로 한 줄씩 생기고, 같은 원인은 한 줄로 합쳐지고(`dmg` 가 더해짐), `sev` 가 `bandOf` 와 맞는다. `bandOf` 가 지금의 `band` 와 0~100 전 구간에서 같다.
3. **방호가 피해를 줄인다**: 같은 피해량으로 `hurtResponder` — (4a-1 뒤) gunshot: 특공대 < 순찰 < 구급, burn·smoke: 소방 < 경찰, 그리고 §2.4 "지금" 열의 값이 지금 식과 같다 — 상대 오차 1e-9 안(예: 순찰 총상 = `raw × (1 − u.armor × 0.6)`, 소방 부대 총상도 `u.armor` 0.1 로 줄어든다, 소방 연기 = `0.1 × smoke`. R1 이 합쳐져 있으면 "R1 이 있으면" 열(그것이 그때의 지금 식)과 견준다 — `armor` 는 `armorOf`, 연기·불은 `scba`·`turnout`). (4a-2 뒤에 더하는 검사) toxic: 화학 ≤ 소방 < 경찰, blast: 폭발물 처리반 < 순찰 < 구급, stab: 기동 < 구급.
4. **문턱**: ① 체력 100 인 대원(`a.hpTick = 100`)에게 `hurtResponder(…, 200, 'gunshot')` → 숨지지 않고 체력 8, 출혈 ≤ 0.04, 다음 틱에 `down` 과 RESPONDER_HURT. ② **같은 틱 두 번 피격**: 체력 60(`a.hpTick = 60`)인 대원에게 방호 0 인 피해 35 를 두 번 → 체력 8, 다음 틱에 `down`(순직 아님), RESPONDER_HURT 하나. ③ 체력 30(`a.hpTick = 30`)인 구급대원(총상 방호 0)에게 `hurtResponder(…, 60, 'gunshot')` → 다음 틱에 순직, `RESPONDER_KILLED` 기록, `r.status === 'down' && r.dead`, 그 사건의 `IncidentResult.respondersKilled === 1`(RESPONDER_HURT 가 없어도 센다 — §7.1). ④ 용의자: 체력 100 인 용의자에게 `hurtHostile(…, 200, 'gunshot')` → 숨지지 않고 체력이 `HOSTILE_LEFT` 범위, 같은 호출 안에서 `state === 'down'`·`tDown === sim.t`. 체력 10 인 쓰러진 용의자에게 `hurtHostile(…, 30, 'blast')` → `dead`, `SUSPECT_DIED` 기록.
5. **대원 순직은 목표 빈도 이하**: 보통 24교대에서 순직 ≤ 1.
6. **쓰러진 대원은 구조되거나 후송된다**: 응급 사건(구급 부대가 온다)에서 부대가 도착한 뒤 한 대원을 `hurtResponder` 로 쓰러뜨리고 끝까지 돌린다 → 그 대원은 `rescueMate` 완료 기록이 있고, `r.care === 'hospital'` 이거나(후송) 숨졌다면 `RESPONDER_KILLED` 가 있다. `a.status` 는 끝에 `left`.
7. **용의자 부상 시 처치·호송**: `armed/shooter` 8교대에서 쓰러진 용의자마다 — 숨졌으면 `SUSPECT_DIED` 기록이 하나이고 그 시각이 `tDown` 보다 늦다(즉사 없음 — §2.6 용의자 문턱), 살았으면 사건이 끝날 때 `tTreated ≥ 0` 이거나 현장에 구급·경찰 대원이 없었다. 맡은 사람은 **기록으로** 본다: 그 사건의 '${용의자} 응급 처치 완료.' 기록마다 `rid` 의 대원이 경찰이거나, 구급대원이면 `s.kind !== 'armed'` 또는 (`s.secureAt ≥ 0` 이고 기록 시각 ≥ `s.secureAt`). (`s.board` 의 `assignees` 로는 볼 수 없다 — `finishTask` 가 항목을 `done` 으로 만들기 전에 그 대원을 `assignees` 에서 빼므로(`executor.ts:37`) 끝난 항목의 `assignees` 는 늘 비어 있다.)
8. **정보 격리**:
   - `field/commander.ts`·`dispatch/*`·`field/orders/*`(주석 줄 제외)에 `/\.(injuries|bleed)\b/` 와 `/responders\[[^\]]*\]\.(health|dead|bleed|care|tDown)/` 가 없다. `field/brain.ts` 는 자기 몸(`resp(sim, a)` 로 얻은 `r.health`·`r.bleed`)을 읽으므로 뒤의 식만 검사한다.
   - 같은 파일들이 `injury` 모듈에서 `needsHospital`·`hurtF`·`mainCause` 를 import 하지 않고, `bandOf(` 의 인자에 `.health` 가 들어가지 않는다(함수 호출 안에 숨은 진실 읽기는 위의 정규식이 잡지 못한다). import 문을 글자로 읽어 본다.
   - `field/orders/injury.ts` 에서 `sim.responders[…]` 뒤에는 `.unitId`·`.dept`·`.name` 만 온다: `/responders\[[^\]]*\](?!\.(unitId|dept|name)\b)/` 가 없다(변수에 담아 읽는 것도 막힌다).
   - (4b 뒤) `field/commander.ts` 에 `s.casualties`·`s.hostiles` 가 없다 — `tests/ext.test.ts` 가 `orders/*` 에 거는 금지어 가운데 이 둘을 `commander.ts` 에도 건다(`s.props` 는 소화전·차량 정리처럼 지금 읽는 곳이 있어 넣지 않는다).
   - (지금 코드는 처음 둘을 통과하고, `commander.ts` 의 `s.casualties` 는 `manageAmbulances` 의 두 곳뿐이다 — 2026-11-14 확인.)
9. **가짜 연출 없음**: 모든 교대에서 `r.dead` 인 대원마다 그 rid 의 `RESPONDER_KILLED` 기록이 정확히 하나, `h.dead` 인 용의자마다 `SUSPECT_DIED` 가 하나. 숨진 구조 대상은 모두 `deathCause` 가 있다. **모든 사망 기록(`RESPONDER_KILLED`·`SUSPECT_DIED`·구조 대상의 '생체 반응 소실'·'떠내려갔습니다')의 시각 ≤ 그 사건의 `closedAt`**(§2.6). `SECONDARY_COLLISION` 의 `rid` 는 그 시각에 숨지지 않은 대원이다(§2.7).
10. **잔혹한 묘사 없음**(G5 의 시험 9 와 같은 문자열 검사 — G5 가 먼저 합쳐졌으면 이미 참이다): `src/view/renderScene.ts` 에 `blood:` 가 없고, `src/view/scene/sprites.ts` 에 `rgba(110,18,22`·`rgba(140,24,28` 가 없고, `src/view` 의 모든 파일에 `rgba(230,50,50`·`rgba(255,90,90` 이 없다(지금 'hit' 의 붉은 조각·고리). 파일을 글자로 읽어 본다. 'hit' 을 그리는 함수가 G5 에서 새 파일로 옮겨졌으면 그 파일도 `src/view` 안이므로 함께 걸린다.
11. **재현성**: 같은 시드·같은 강제 시나리오 두 번의 `report.hash` 가 같다(부상·사망이 일어나는 교대 하나 이상 포함). `injuryRng` 를 쓰는 규칙이 있는 교대도 같다. `injuryRng(sim, s, 'trap')` 과 `injuryRng(sim, s, 'fall')` 이 서로 다른 흐름이다(한쪽을 몇 번 뽑아도 다른 쪽의 첫 값이 같다).
12. **부대는 걸을 수 있는 대원이 있는 한 나가고, 다친 대원은 가벼운 일만 맡는다**(§3.6 의 사용자 결정 둘): ① **순직 한 명인 부대**: 내리는 대원이 둘 이상인 부대의 대원 하나를 `hurtResponder` 로 순직시킨 교대를 끝까지 돌린다 → 순직 뒤에도 그 부대의 `crewReady ≥ 1` 이고, 기지에 닿은 뒤 `u.state !== 'oos'` 이며 운용 중단 기록이 없다(그 뒤 그 부대가 실제로 뽑히는지는 `pickUnit` 점수 문제라 보지 않는다 — 배정에서 빠지지 않는 것만 본다). ② **부상 한 명인 순찰차**(R1 뒤 `minField('patrol') === 2` 인 최소 편성 — 결정 전의 (가)안이 멈추던 부대): 대원 하나를 `injured`(체력 55·출혈 0·`care` 없음)로 만들면 `crewReady === 2`·`crewOk === 1` — 기지에 닿아도 `oos` 가 아니고 `pickUnit` 의 −18 감점만 받는다. ③ **전원이 다쳤지만 걸을 수 있는 부대**: 2인 부대의 둘 다 ②처럼 `injured` 로 만들면 `crewReady === 2`·`crewOk === 0` — `pickUnit` 의 후보에서 빠지지 않고(같은 분야의 다른 부대를 모두 `oos` 로 둔 교대에서 수요 `law` 사건에 그 부대가 뽑힌다), 온전한 같은 분야 부대가 있으면 무거운 수요(`HEAVY_NEED`)에서는 그쪽이 1순위다(−25). 그 부대가 닿은 현장에서 두 대원이 내리고(`s.agents` 에 있음, 이름표 '부상 — 가벼운 일'), 교대 끝까지 그 두 대원이 맡은 작업(`a.task` 의 `workId ≥ 0` 인 것)의 `kind` 는 모두 `LIGHT_WORK` 안이다(100틱마다 검사). `fitFor` 는 그 대원에게 `search`·`engage`·`arrest`·`carry`·`load`·`rescueMate` 에 0 을 돌려준다. ④ **전원 순직 부대**: 한 부대의 내리는 대원을 모두 `hurtResponder` 로 순직시키면 `crewReady === 0` — 그 뒤 만들어진 사건의 `everAssigned` 에 그 부대가 없고, 기지에 닿으면 `oos` 와 '${호출부호} 대원 전원 순직 — 운용 중단.' 기록(`causes` 에 마지막 `RESPONDER_KILLED`, 같은 id 가 `u.oosEv`). ⑤ **모두 후송된 부대**: 숨지지 않은 대원을 모두 `care = 'hospital'` 로 두면 `crewReady === 0`, 기지에 닿으면 '${호출부호} 남은 대원 모두 병원 이송 — 운용 중단.'. 살아 있는 대원이 모두 `down`(후송 전)인 부대도 `crewReady === 0`. ⑥ **가벼운 일로 돌아온다**(§3.6a): 응급 사건에서 부대가 도착한 뒤 한 대원을 출혈로 물러나게 하고(체력 60·`bleed` 0.07 → `injured`·후퇴·`withdrawn`), 처치를 흉내 내어 `bleed = 0.005` 로 두면 다음 틱에 `active`·이름표 '부상 — 가벼운 일'·'가벼운 임무로 복귀합니다.' 기록 하나, 그 대원의 `mate` 사실이 `'light'` 이고, 그 뒤 그 대원을 대상으로 한 `treatMate` 가 열려 있지 않다. 다시 물러나게 하면(체력 35) 그 현장에서는 돌아오지 않는다(`a.lightBack`). 출혈이 남은(병원이 필요한) 대원은 `withdrawn` 으로 남는다. 소방 헬기·구조정은 다친 사람이 없으면 `crewReady === fieldCrew(sim, u).length`(2)라 배정된다(내리지 않는 자리를 세지 않는다).
14. **R1 의 시험 ⑨ 가 바뀐다**: 4b 부터 자리 셈이 `seatsUsed` 이므로 R1 `tests/crews.test.ts` ⑨(매 틱 `patients.length ≤ seatsOf`)를 `seatsUsed(sim, u) ≤ seatsOf(u)` 로 고친다(이 묶음이 고치는 남의 시험 — 보고에 적는다).
13. **고아 부대 없음**: 4교대(`armed/shooter` 둘, 보통 둘) 끝에 이미 닫힌 사건 소속으로 `onscene` 인 부대가 없다.
15. **`tests/causality.test.ts` 의 T6 사례가 바뀐다**: 4b 부터 '대원 전원 부상으로 운용 중단.' 문구가 없어지므로(§3.6), 지금의 T6 시험(극한 S10·S13·S18 에서 그 문구를 찾는다)을 새 문구 셋 가운데 하나가 나오는 교대로 고친다 — 그런 시드를 찾아 고정하거나, 한 부대의 내리는 대원을 모두 `hurtResponder` 로 순직시킨 교대를 직접 만든다. `sysOf` 가 그 기록을 `crew` 로 세는지는 그대로 본다(이 묶음이 고치는 남의 시험 — 보고에 적는다).

---

## 12. 고칠 파일, 알려진 위험과 결정 사항

### 12.1 공용 파일 수정

| 파일 | 함수·자리 | 무엇을 · 왜 | 단계 |
|---|---|---|---|
| `sim/types.ts` | 끝에 추가 | §2.1 의 자료형과 선택 칸(1). 합집합 멤버는 구현하는 단계에서: `RESPONDER_KILLED`(4a), `treatMate`(4b), `treatSuspect`·`SUSPECT_DIED`(5) | 1·4a·4b·5 |
| `sim/difficulty.ts` | `Tuning`, `tuningOf` | `injuryMul` | 4a |
| `field/hazards.ts` | `band` | `bandOf` 다시 내보내기 | 1 |
| | `tickCasualties` | 항별 `noteInjury`(`bleedCause` 가 없으면 상처 항은 적지 않는다), `deathCause`(1) → 종료 뒤 악화·사망 판정 멈춤(대피 이동은 남김), 사망 문구 원인(3) | 1·3 |
| | `blast` | 원인 인자(기본 blast), 기록(1) → 구조 대상 `immobile`·`bleed`(3), 대원은 `hurtResponder`·숨진 대원 제외(4a), 용의자 피해(5) | 1·3·4a·5 |
| | `tickFire` | 천장 붕괴 원인 crush | 1 |
| | `panicShot`·인질 시한·총격범 | gunshot 기록(1), `josa`(3). G5 의 `noteHit` 줄은 그대로 | 1·3 |
| | `tickHostiles` | 대원 피격·흉기 기록(1) → `hurtResponder`·피습 문구(4a, G5 의 `noteHit`·`recMelee` 줄은 그대로), 쓰러짐 검사를 안전장치로(`<= DOWN_AT && tDown === undefined`), 자해 경로(5) | 1·4a·5 |
| | `tickLane` | vehicle 기록(1) → `hurtResponder`, 숨진 대원 제외(4a), (선택) 도주 용의자(5) | 1·4a·5 |
| | `tickCollapse` | crush(1), 곁의 구조 대상 갇힘(`injuryRng(…, 'trap')`, `path = null`)(3) | 1·3 |
| | `tickGas`·`tickWater` | toxic·drown 기록, `c.lost`(1), `josa`(3) | 1·3 |
| `field/sceneManager.ts` | `createScene` | `buildScene` 바로 뒤 `initInjuries(sim, s, I)` | 1 |
| | `tickScene` 1) 직전 | 모든 대원 `a.hpTick = r.health` | 4a |
| | `agentHealth` | 기록(1) → §3.2 전체(종료 뒤 멈춤, `tDown ??=`, 순직, 부상 조건, 자기 보고)(4a), 가벼운 일로 복귀(§3.6a)(4b) | 1·4a·4b |
| | `unitArrived` | 내리는 사람: `status === 'ok'` → `crewReady` 와 같은 술어(걸을 수 있는 다친 대원도 — 이름표 '부상 — 가벼운 일')(§3.6) | 4b |
| | 4번 블록 | 승계 문구 | 4a |
| | 5번 블록 | 종료 시 `boardOrder`(aboard·`needsHospital` 대원), `needsHospital` 대원을 `aboard` 에, 병원행 조건에 `aboard`, 고아 부대 안전장치 | 4b |
| | 7번 블록 | `outstanding(cmd, sim.t)` 의 `mates`(4a)·오래된 `mobile`(3) | 3·4a |
| `field/executor.ts` | `shootAt` | 용의자 피격·빗나간 탄 기록(1) → `hurtHostile`(5, G5 의 `noteHit` 줄은 그대로), 경험치 문턱(5) | 1·5 |
| | `extricate` | 구출 중 사고(`injuryRng(…, 'extricate')`) | 3 |
| | `carry`·`escort` | 갇힌 대상에서 `'gone'` 으로 끝나기 전에 `casFact` 강제 보고 | 3 |
| | `waterRescue` | 완료 때 `c.bleedCause = 'exposure'`(R2 가 합쳐졌으면 `landCasualty`) | 3 |
| | `retreat`·`rescueMate` | 출혈 조건, 자기 보고 'safe' + `flushOutbox`, 숨진 동료 수습, 강제 보고, 물 칸 대기 | 4a |
| | `load` | `u.firstLoadAt ??= sim.t` | 4b |
| | `engage`(① 분기)·`arrest` | 덮쳐 제압할 때의 몸싸움(`injuryRng(…, 'fight')`) | 4c |
| | 새 case `treatMate`·`treatSuspect` | §3.4·§4.3 (대상 좌표 끌기, 고아 부대 `release`, `firstLoadAt`), 처치 뒤 병원이 필요 없는 대원은 태우지 않음(§3.6a) | 4b·5 |
| `field/agents.ts` | `staminaF` | `× hurtF(r)` | 4a |
| | 새 `seatsUsed`(R1 `seatsOf` 옆) | 쓰인 자리 = `patients` + 다른 부대 대원·용의자의 `aboard`(§3.4-5). R1 의 비교 자리 넷이 이것을 본다 | 4b |
| | `casFact` 옆 | `mateFact(sim, s, b, status, src, d)` | 4a |
| | `hosFact`, `significant`, `perceive` | `mate`: 보고 조건(`status`·`dead`·`band`·`tq`), 보는 대상(`down` + 2칸 안의 `withdrawn`), 배우는 조건 `significant`(4a). `hos`: 필수 인자 `d`, 칸·문구, `where`(5) | 4a·5 |
| | `workLabel`·`fitFor`·`canCarryPatients` | `rescueMate` 의 `hot`·`fireRisk`(R1 이면 `scba` 자격)(4a), `treatMate`(`a.rid !== w.mate`, hot 이면 safe 만)(4b), 다친 대원(`injured`)은 `LIGHT_WORK` 만·위험 구역 밖만(§2.5)(4b), `treatSuspect`(hot 술어, `fireRisk`)(5), 자리 셈에 다른 부대·용의자의 `aboard`(R1 의 `seatsOf` 그대로)(4b) | 4a·4b·5 |
| `field/commander.ts` | `rescueMate` 를 내는 줄(340) | 숨진 동료 0.55 | 4a |
| | `manageAmbulances` | `!u.patients.length` 건너뛰기에 `aboard`, `firstLoad` → `u.firstLoadAt`, `redAboard` 진실 읽기 제거 | 4b |
| | `outstanding` | 인자 `now`, `mates`, 오래된 `mobile` | 3·4a |
| `field/brain.ts` | `dangerScore` | `health < 40 \|\| (bleed ≥ 0.06 && health < 70)` 이면 물러남(자기 몸) | 4a |
| `field/rules/disaster.ts` | 해일 | drown 기록(1) → `hurtCas`(하한 8 을 지키는 양)·`hurtResponder`(3·4a) | 1·3·4a |
| `field/scenes/index.ts` | import | `../rules/injury`, `../orders/injury` | 1 |
| `sim/resources.ts` | `crewReady`·새 `crewOk` | `crewReady` = 걸을 수 있는 대원(온전한 대원 + 걸을 수 있는 다친 대원 — 0 이면 배정에서 빠진다), `crewOk` = 온전한 대원(§3.6 사용자 결정 둘) | 4b |
| `dispatch/dispatcher.ts` | `pickUnit`·`firstResponder` | 감점 줄을 `crewOk < fieldCrew.length` 로, 걸을 수 있는 다친 대원만 남은 부대의 무거운 수요 −25, 선착 대응 후보는 `crewOk > 0`(§6.4). 그 밖은 고치지 않는다 | 4b |
| | `tickUnits` 의 `hospital` | `aboard` 인계와 `u.aboard = []`·`firstLoadAt` 지우기 — `patientsIncident` 블록 **밖에서** | 4b |
| | `arrive` 의 `returning` | `oos` 문구를 까닭(전원 순직·남은 대원 모두 후송·걸을 수 있는 대원 없음)에 따라, `causes`·`u.oosEv`. '대원 전원 부상으로 운용 중단.' 은 없앤다 | 4b |
| `scripts/metrics.ts` | `PHRASE.T4`·`PHRASE.T6` | T4 는 새 인계 문구를 잡게 넓히고(§3.4-4), T6 은 새 운용 중단 문구 셋으로 바꾼다(§3.6). `tests/causality.test.ts` 의 T6 사례를 고치고 통과(§11-15) | 4b |
| `sim/debrief.ts` | `PROBLEM_LABEL`·`order`·`T`, `evaluate`, `buildReport` | §7 (순직은 `RESPONDER_KILLED` 기록으로 따로 셈) | 4a·5·6 |
| `view/renderScene.ts` | `BAND_COLOR`, 사람 그리기(302-412), 딱지(562-596), `hitScene`. 'hit'(634-637)은 G5 가 이미 고쳤으면 손대지 않는다 | §8 | 2 |
| `view/scene/sprites.ts` | `drawLying`(blood 제거 — G5 가 했으면 확인만), `PersonPose`·`ArmPose` | §8.2·8.3 | 2 |
| `view/camera.ts` | `frameAction` 의 무게 | 쓰러진 대원 | 2 |
| `view/audio.ts` | 문제·사망 소리 | §8.6 (선택) | 2·6 |
| `ui/panels.tsx` | `BAND`, 대원 칩, 대원 정보창, 보고서, `Ticker` class | §8.4 | 2·6 |
| `ui/App.tsx` | 현장 범례, 사람 정보창 자리 | §8.1·8.4 | 2 |
| `ui/Viewport.tsx` | 현장 누르기(128-130) | `hit.cas`·`hit.hostile` 로 정보창 | 2 |
| `ui/styles.css` | 끝의 `/* ── injuries ── */` | 중증도 색, 칩, `loss` | 2 |
| `scripts/sweep.ts` | 집계·출력 | §9.2 | 6 |

1단계에서 `noteInjury` 를 붙일 자리는 위 표에서 "1" 이 붙은 줄 전부다. 하나라도 빠지면 그 원인의 기록이 없을 뿐 해시는 그대로다 — 테스트 11-1·11-9 가 잡는다.

### 12.2 알려진 위험

1. **1단계의 해시 동일**은 연산 순서와 `s.rng` 호출을 건드리지 않아야 지켜진다. 깨지면 그 단계를 둘로 나눠 어느 자리인지 찾는다.
2. **물러나는 대원이 늘면** 교전에서 경찰 수가 줄어 대치가 길어진다 → 무장 사건의 한계 시간. `--force armed/shooter`·`armed/riot` 로 재고, 늘면 `MATE_RETREAT_BLEED` 를 올리거나 `MATE_RETREAT_HP` 를 내린다. **고칠 수 없는 기존 시험 둘이 여기에 걸린다**: `tests/sim.test.ts` 의 생활 사건 성공률(`armed/domestic` 순수 성공 > 0.6 — 칼 든 가정 폭력)과 `tests/crime.test.ts` 의 폭동(6번 가운데 한계 시간·방치 ≤ 1). `sim.test.ts` 는 고치지 않으므로, 깨지면 시험이 아니라 손잡이(자상 계수 0.0015, 물러남 문턱, 몸싸움 피해 3~8)를 고친다.
3. **구급차 정원 다툼**: 다친 대원·용의자가 구조 대상과 자리를 나눈다. 용의자는 더 무겁거나 같은 사람이 기다리지 않을 때만 태운다. 버스·대형 사고에서 구조 대상 이송이 늦어지지 않는지 `--force` 로 본다.
4. **숨진 동료를 수습하지 못해 종료가 막힘**: `canClose` 는 쓰러진 동료가 남아 있으면 끝내지 않는다(지금). 닿을 수 없는 자리면 `LIMIT` 으로 끝난다 — 한계 시간 건수를 본다.
5. **R1 이전에 구현하게 되면**(순서가 바뀌면) 방호는 §2.4 의 "지금"·"새로" 열, `crewOk`·`crewReady` 는 `fieldCrew` 대신 `u.crew`, 자리는 구급차 2·헬기 1 로 동작한다. R1 이 합쳐질 때 `protection()`·`treatEffect()`·자리 셈과 `crewOk`·`crewReady` 가 세는 대상(`fieldCrew`)만 바꾼다. R1 은 대원 수를 크게 늘리므로(보통 34 → 63명) §9 의 목표는 R1 을 합친 뒤에 다시 잰 기준값과 견준다.
6. **정보 격리 예외**: `commander.ts:544` 를 고치면 결과가 조금 바뀐다(4b 단계 안에서 함께 잰다). README "알려진 문제"의 예외 3건은 늘리지 않는다.
7. **속도(P1)**: `rules/injury.ts` 는 매 틱 모든 현장에서 돈다. 다친 사람이 없는 현장은 첫 줄에서 돌아가게 하고, 배열을 새로 만들지 않는다(기록은 원인마다 한 줄을 고쳐 쓴다).
8. **자해** 같은 민감한 장면은 사용자 요청에 없었다. **사용자 결정(2026-11-15): 끈다.** 경로만 만들고 `SELF_HARM = 0` 으로 둔다(§4.5). 값을 올리려면 사용자의 새 결정이 있어야 하고, 그때도 0.08 안팎에서 한 줄의 담담한 기록으로만.
9. **G4·G5 와의 화면 충돌**: 딱지·'hit' 효과를 함께 고칠 수 있다. G5 는 이미 합쳐졌으므로 'hit'·피 제거는 G5 의 것을 그대로 두고, 딱지 그림 함수는 H1 이 만든다(G4 는 사람 딱지를 만들지 않는다). 원칙(피·붉은 조각 없음, 중증도 색은 `triage.ts`)을 지킨다. `hazards.ts`·`executor.ts` 의 피해 줄에는 G5 의 꼬리표 줄이 끼어 있다 — `hurt*` 로 바꿀 때 지우지 않는다.
10. **종료 뒤 악화를 멈추면 교대 보고서의 숫자가 조금 바뀐다**(§2.6): 지금은 사건이 닫힌 뒤 대원이 떠나기 전까지 현장의 구조 대상이 숨질 수 있고, 그 사망이 교대 요약에는 들어간다. 3단계의 sweep 비교에서 구조율과 함께 본다.
11. **목적별 난수 흐름**: `injuryRng(sim, s, purpose)` 의 이름은 한 번 정하면 바꾸지 않는다(이름이 곧 흐름이다). 새 소비자는 새 이름을 쓴다.
12. **가벼운 일만 맡는 대원만 남은 현장**: 걸을 수 있는 다친 대원만 남은 부대가 무거운 일이 필요한 현장에 먼저 닿으면 그 일을 맡을 사람이 없다. 지휘관의 "맡을 사람이 없는 작업" 지원 요청(B3 — R1 §6.4 가 고친 블록)이 다친 대원을 맡을 수 있는 사람으로 세지 않는지(`fitFor` 0) 확인한다 **(확인 필요)** — 세면 요청이 나가지 않아 한계 시간까지 간다. 관제의 −25(§6.4)가 이런 출동을 줄이지만 막지는 않는다.

### 12.3 결정 사항 (조사에서 열려 있던 질문)

| 질문 | 결정 | 이유 |
|---|---|---|
| 원인을 새 칸에 저장하나 | `Injury[]`(원인마다 한 줄) + `bleedCause`·`deathCause` | `causeEvent` 는 이벤트 id 하나라 원인 종류를 말하지 못한다 |
| 추락·감전·익수·탈진 규칙 | 탈진·잔해 바닥 추락은 새로. 감전은 공식만. 대원 익수는 R2. 사다리·창문 추락은 어느 묶음도 만들지 않는다(R2 §10, ROADMAP C4) | 지금 그런 일이 생기는 현장이 없는 것은 억지로 만들지 않는다 |
| 대원 순직 | 허용. 출혈이 있는 쓰러짐 + 문턱(이 틱 시작 때 41 이상이면 그 틱 안에서 0 불가, 쓰러진 대원의 출혈 상한 0.04) | "드물게, 설명할 수 있게" |
| 용의자 즉사 | 없다 — 쓰러지지 않은 용의자는 한 번 피해로 0 아래로 가지 않는다(`HOSTILE_LEFT`). 쓰러짐은 `hurtHostile` 안에서 바로 | 지금 식으로는 총에 맞아 쓰러진 용의자의 78% 가 그 순간 숨져 사망 비율을 맞출 손잡이가 없다 |
| 출혈로 물러나는 조건 | `bleed ≥ 0.06` 이고 `health < 70` | 0.03 하나면 총알 한 발에 모든 대원이 물러난다(§2.2) |
| 대원 체력이 성능에 | `hurtF`(70 → 40 에서 1 → 0.75) | 지금은 40 아래 전까지 영향 없음 |
| 다친 대원은 처치 뒤 복귀하나, 교대 중 회복 | **복귀한다 — 가벼운 일만**(사용자 결정(2026-11-15): "가벼운 일은 계속"). 걸을 수 있는 다친 대원(`injured`, 후송되지 않음)은 병원이 필요 없으면 대기 지점에서 가벼운 일로 돌아오고(§3.6a) 다음 현장에도 내린다(§3.6). 체력 회복은 없다(교대 중 회복은 지금처럼 없음). 병원으로 후송된 대원은 그 교대에 돌아오지 않는다 | 다쳐도 부대가 멈추지 않는다. 무거운 일·위험 구역을 막아 다친 대원이 다시 쓰러지는 연쇄를 막는다. 교대 사이의 회복은 I2 |
| 가벼운 일 목록 | `injury.ts` 의 `LIGHT_WORK` 한 곳(정본, §2.5·§2.7): `traffic`·`perimeter`·`negotiate`·`interview`·`hookup`, 안전 구역의 `treat`·`treatMate`. R3 의 부상 줄이 같은 목록을 쓰고, R2 는 다친 대원이 `risk > 0` 인 방법을 고르지 않는다 | 목록이 둘이면 어긋난다. 운반(`carry`·`load`)·도로 정리(`clearRoad`)는 몸을 쓰는 일이라 넣지 않았다 |
| 다친 대원의 구급차·병원 | 넣는다(`treatMate`, `Unit.aboard`, 병원 인계) | 사용자 요청의 "후송" |
| 용의자 `down` 을 나누나 | `state` 는 그대로 두고 `dead` 칸을 따로. 쓰러짐은 15 | 기존 `down` 의 뜻과 테스트를 지킨다 |
| 용의자 사망과 판정 | 위협이 끝난 뒤(`threatOverAt` — 무장은 안전 확보, 그 밖은 첫 도착)에 숨진 경우만 0.5 | §4.4 |
| 경찰 호송 | 기계적으로 모델하지 않는다 | §4.3 |
| 판정 뒤 숨짐·병원 뒤 결과 | 사건이 끝나면 세 부류 모두 악화·사망 판정을 멈추고 `hurt*` 도 아무것도 하지 않는다. 병원 뒤 결과 없음 | 판정과 기록이 어긋나지 않게. `loaded` 만 멈추면 현장·안전 구역의 구조 대상, 출혈하는 용의자, 안전 구역의 대원이 판정 뒤에 숨질 수 있다 |
| 자해 | **사용자 결정(2026-11-15): 끈다.** 경로만 만들고 `SELF_HARM = 0` 으로 확정 — 값을 올리지 않는다 | 요청에 없던 민감한 장면. 꺼 두기를 추천했고 사용자가 "전부 추천대로"로 정했다 |
| 부대의 운용 중단 | **그 부대 대원이 전부 숨졌을 때만** — 사용자 최종 결정(2026-11-15). 다치거나 일부가 숨진 부대는 −18 감점만 받고 계속 출동한다. 배정에서 빠지는 것은 걸을 수 있는 대원이 하나도 없을 때(전원 순직·모두 쓰러짐·모두 후송) — `resources.crewReady`(걸을 수 있는 대원 수)가 0 일 때뿐(§3.6). 걸을 수 있는 다친 대원만 남은 부대는 나가되 무거운 수요에서 −25(§6.4). 쓰지 않는 안: (가) 최소 편성 부대(`minField` 미만)는 부상 한 명으로 중단, (나) 순직 대원이 하나라도 있으면 중단 | 사용자 원문: "운용을 멈추는 건 그 부대 전부 죽었을 때로. 하나라도 다치거나 죽으면 멈추는 건 너무 그렇다." 모두 후송돼 빈 부대가 빠지는 것은 규칙이 아니라 사람이 없어서다. 관제는 복귀 중인 부대도 배정하므로 사람이 없는 부대는 기지 도착 때의 `oos` 만이 아니라 `crewReady` 에서 0 이어야 한다. `dispatch/*` 는 고치지 않는다 |
| 경상(초록)의 처치·이송 | 지금 그대로 없음 | START 의 "지연" 묶음 |
| 사망색 | 검정 + 밝은 테두리·흰 글씨 | 요청(검정), 어두운 배경에서 보이게 |
| 피 웅덩이·붉은 'hit' | 없앤다 | 표현 원칙 |
| 덮개를 그리는 때 | "확인된 사망"부터(관찰자: 발견 뒤 / 대원은 3초 뒤, AI 시점: 믿음) | 덮는 임무를 따로 만들지 않고도 거짓 없이 |
| 떠내려가 숨진 사람 | 그리지 않는다 | 기록('현장 밖으로')과 그림을 맞춘다 |
| I2·K1 | 출력(`roster`·`outShifts`)만. 저장·입력은 I2(I2 가 K1 을 함께 끝낸다) | 묶음의 경계. 로드맵에서 대원 상태를 다음 교대로 넘기는 것은 I2 다 |
| 폭발이 고르지 않음 | `blast` 가 세 부류를 같은 규칙으로 | 요청의 "고르지 않은 것을 채운다" |
| `commander.ts` 의 진실 읽기(`manageAmbulances` 의 `firstLoad`·`redAboard`) | 이번에 부대 기록(`u.firstLoadAt`)과 믿음으로 바꾼다 | `manageAmbulances` 를 어차피 고친다. 고치면 `commander.ts` 에 `s.casualties`·`s.hostiles` 가 남지 않는다 |
| 대원의 익수(물 위의 쓰러짐·사망) | R2 의 규칙을 받아들인다(정본 R2 §3.5): R2 는 H1 이 있든 없든 물 위 피해를 `hurtResponder` 를 부르기 전에 `raw = min(raw, r.health − 18)` 로 자르고, 30 아래면 '위기' 사고로 `ashore`, 다른 피해로 물 칸에서 쓰러지거나 숨지면 `rules/methods.ts` 가 뭍으로 옮긴다. H1 의 `rescueMate` 는 대상이 물 칸이면 기다린다 | R2 설계서(§3.5, §10 의 H1 줄)와 같은 문장. 물 칸에 쓰러진 대원을 건지는 길이 없어도 R2 의 안전장치가 뭍으로 옮기므로 사건이 끝난다. 두 번 옮기지 않는다(R2 는 물 칸에서만, H1 은 뭍에서만) |
| 방호의 이름 | R1 의 `armorOf`·`blastFactor`·`scba`·`turnout` 을 읽는다 | R1 이 먼저 합쳐진다 |
| 'hit' 효과와 피 표현 | G5 의 것을 쓴다. H1 은 확인만 | G5 가 H1 보다 먼저 구현된다(로드맵) |

---

## 검토 메모

독립 검토 두 건(실현 가능성·규칙, 빠진 것)의 지적은 모두 확인했고, 타당한 것은 본문에 반영했다. 아래는 반영하지 않았거나 제안과 다르게 반영한 것과 그 이유다.

- **"G5 가 `SHOW_BLOOD=false`·`blood 0` 으로 피 표현을 먼저 바꾼다"** — `G5-combat-fx.md` 에는 그런 상수가 없다. G5 §3.9 는 `blood` 옵션과 붉은 타원을 지우고 'hit' 을 다시 그린다. 그 내용(G5 가 먼저, H1 은 확인만)은 반영했고 상수 이름은 쓰지 않았다.
- **단계 1 에서 합집합 멤버를 넣고 `workLabel`·`fitFor`(`return 0`)·`PROBLEM_LABEL` 을 함께 채우는 안** — 쓰지 않았다. 멤버를 구현하는 단계(4a·4b·5)에서 더하는 다른 안을 골랐다. 단계마다 쓰이지 않는 자리 채움이 남지 않고, 그 단계의 커밋만 보면 새 임무의 다섯 자리가 한꺼번에 보인다.
- **방호를 "피해 배율"로 다시 정의하는 안** — 쓰지 않고 시험에 허용 오차(상대 1e-9)를 두는 안을 골랐다. 4a 는 어차피 결과가 바뀌는 단계라 비트 단위 동일이 필요 없고, 몫(0~0.95)으로 두는 편이 R1 의 `armorOf`·`blastFactor` 와 표가 맞는다.
- **총상 출혈 계수를 0.0012 로 낮추는 안** — 쓰지 않고 물러남 조건을 둘(`bleed ≥ 0.06` 이고 `health < 70`)로 바꾸는 안을 골랐다. 계수를 낮추면 쓰러진 뒤의 출혈(순직·용의자 사망의 시간)까지 함께 느려져 손잡이가 둘로 갈리지 않는다.
- **구조 대상 `casFact` 도 대원·용의자처럼 거리 조건을 두는 안** — 맞추지 않고 차이를 그대로 두며 이유를 §4.3 에 적었다. 바꾸면 수색·처치·탑승 전체의 결과가 바뀌고, 구조 대상은 대원이 찾아가 가까이서 보는 대상이라 차이가 작다.
- **처음 원인 대응표에 "가스 폭발 현장의 `bystander2` → toxic"을 맨 앞에 두는 안** — 넣지 않았다. `bystander2` 는 `tickGas` 가 사건 중에 붙이는 사람이라 `createScene` 의 `initInjuries` 때는 아직 없다. 그 사람을 만드는 코드가 toxic 을 적는다(§2.3).
- **시험 11-10 을 "`src/view` 의 'hit' 그림에서 붉은 채움색 전부"로 넓히는 안** — 일반적인 "붉은색" 판정은 글자 검사로 믿을 만하게 할 수 없다. 대신 지금 쓰이는 붉은 값 넷(`rgba(110,18,22`·`rgba(140,24,28`·`rgba(230,50,50`·`rgba(255,90,90`)을 `src/view` 전체에서 찾는 검사로 넓혔다(G5 의 시험 9 와 같은 방식).
- **`tests/ext.test.ts` 의 금지어 전부를 `commander.ts` 에도 거는 안** — `s.casualties`·`s.hostiles` 둘만 건다. `commander.ts` 는 소화전·차량 정리처럼 `s.props` 를 지금 읽는 곳이 있어 그 금지어까지 걸면 이 묶음과 무관하게 깨진다.
- **R1 의 순찰 팀장에게 `bag` 을 더하는 안** — 더하지 않았다(R1 의 역할 표는 R1 의 것이다). 경찰의 용의자 처치는 하한 `q` 0.2 로 두고, 처치 손잡이에서 뺐다(§9.3).
- **R2 와의 물 위 대원 결정에서 "H1 이 `drown` 한 번 피해의 하한을 맡는다"(검토의 (a)안)** — 쓰지 않고 R2 가 이미 적어 둔 규칙(R2 피해의 하한 18, 30 아래에서 뭍으로, 다른 피해로 물 칸에서 쓰러지면 뭍으로 옮김)을 받아들였다(검토의 (b)안). 하한 18 은 H1 이 있든 없든 R2 가 둔다(정합성 점검에서 연관 표·결정 표의 옛 문장 "H1 이 있으면 하한 18 을 두지 않고"를 R2 §3.5 에 맞춰 고쳤다).
- **정합성 점검(설계서 열 개를 맞춘 뒤)에서 고친 것**: 결원 기준 `minCrew` → R1 의 `minField`(내리는 자리 단위)와 최소 편성 부대의 결원 결정(§3.6·§9.1·§9.3-6·시험 12 — 뒤의 사용자 최종 결정으로 둘 다 없어졌다. H1 은 `minField` 를 더는 쓰지 않는다), `protection`·`treatEffect` 의 인자, `hurtCas` 의 `causeEvent`, 객체 모양 문단(§2.1), 출발 문구의 병원 이름·`PHRASE.T4`·`T6`·`u.oosEv`, `seatsUsed`, §3.7 의 두 줄(I2 값), B1 나머지의 네 피해 자리(§5.3), X6·G4·G5·R2·R3 와의 경계 문장.
- **사용자 결정(2026-11-15, "전부 추천대로")** — 열려 있던 질문 가운데 자해를 추천안대로 확정해 적었다: 자해는 끈다(`SELF_HARM = 0` — §2.2·§4.5·§10·§12.2-8·§12.3). 이때 결원 규칙도 (가) "최소 편성 부대는 부상 한 명으로 운용 중단"으로 확정됐다고 적었으나 잘못 적은 것이다 — 결원 규칙은 아래 줄의 사용자 최종 결정을 따른다. 같은 날의 다른 결정(폭파 진입은 R2 에 실제 방법으로)은 R2 §4.2a 에 있고, H1 에는 연관 표의 R2 줄 한 구절(원인 `blast`)만 더했다.
- **사용자 최종 결정(2026-11-15) — 결원 규칙**: "운용을 멈추는 건 그 부대 전부 죽었을 때로. 하나라도 다치거나 죽으면 멈추는 건 너무 그렇다." 부대의 운용 중단은 그 부대 대원이 전부 숨졌을 때만이고, 다치거나 일부가 숨진 부대는 −18 감점만 받고 계속 출동한다. 모두 후송돼 빈 부대가 빠지는 것은 규칙이 아니라 사람이 없어서다. 앞서 적혀 있던 두 안 — (가) 최소 편성 부대(`minField` 미만)는 부상 한 명으로 운용 중단(§3.6 에 '사용자 확정'으로 잘못 적혀 있었다), (나) 순직 대원이 하나라도 있으면 중단(§9.3-6 의 대안·로드맵에 한때 적힌 안) — 은 둘 다 쓰지 않는다. 고친 곳: 연관 표의 R1 줄(H1 은 `minField` 를 쓰지 않는다), §3.6, §6.4, §9.1·§9.2 의 지표(목표 → 보고 지표), §9.3-6(대안 손잡이를 지웠다), §10 의 4b, 시험 12, §12.1·§12.2-5·§12.3.
- **사용자 결정(2026-11-15): "가벼운 일은 계속" — 다친 대원의 일**: 걸을 수 있는 다친 대원(`injured` — 쓰러지지 않았고 후송되지 않은 사람)은 계속 부대에 타고 다음 현장에도 내리되 가벼운 일만 맡는다(`LIGHT_WORK` — 교통 통제·출입구 봉쇄·협상·목격자 면담·바깥의 소화전 연결·안전 구역의 처치 보조). 다친 현장에서는 물러났다가 병원이 필요 없으면 대기 지점에서 가벼운 일로 돌아온다("그 교대 동안 쉰다" 안은 쓰지 않았다 — 다쳐도 부대가 멈추지 않는다는 뜻에 맞춰). 그래서 부대가 출동에서 빠지는 것은 걸을 수 있는 대원이 하나도 없을 때(전원 순직·쓰러짐·후송)뿐이고, '대원 전원 부상으로 운용 중단.' 갈래는 없앴다. `crewReady` 는 걸을 수 있는 대원 수, `crewOk` 는 온전한 대원 수가 되었고, 관제는 세 줄만 고친다(감점은 `crewOk` 로 지금 뜻 그대로, 다친 대원만 남은 부대는 무거운 수요에서 −25, 선착 대응은 온전한 대원이 있는 부대만). 고친 곳: 머리의 "건드리지 않는다", 연관 표 R1 줄, §2.1(`MateBelief` 의 `'light'`, `FieldAgent.lightBack`), §2.5 표, §2.7 `LIGHT_WORK`, §3.2, §3.5, §3.6·새 §3.6a, §6.4, §9.1·§9.2, §10 의 4b, 시험 12(③ 전원이 다쳤지만 걸을 수 있는 부대, ⑥ 가벼운 일로 복귀)·새 시험 15(`tests/causality.test.ts` 의 T6), §12.1·§12.2-12·§12.3. 같은 목록을 R3 의 부상 줄이, `risk > 0` 방법 금지를 R2 §3.4 가 함께 적었다.
- **수치의 출처** — "대원 피격 2건·RESPONDER_HURT 0건"(보통·`armed/shooter` 각 3교대)은 검토의 작은 측정을 옮겼다. 이번 수정에서는 다른 작업이 CPU 를 쓰고 있어 sweep 을 다시 돌리지 않았다. "쓰러질 때 이미 0 이하 78%(48~78 에서 시작하면 69%)"는 몬테카를로로 다시 계산해 확인했다.


---

## 구현 메모 (진행 중 — 단계를 끝낸 작업자가 덧붙인다)

**코드가 정본이다.** 이 절은 묶음이 끝나기 전에 이어받는 사람(또는 뒤 단계의 작업자)이 본문과 코드가 어긋난 곳을 헤매지 않게 하려는 것이다. 마지막 문서 단계(7)가 이 절을 정리해 최종 "구현 메모"로 만든다. 브랜치·기준 수치·끊겼을 때 이어받는 법은 `docs/specs/README.md` "실행 방법".

**상태** (2026-11-15): 단계 0(기준)·1·2·3·4a-1·4a-2 가 끝났다. 단계 1·2 는 결과가 바뀌지 않는 단계라 R1 의 검토·문서와 겹쳐 먼저 했고(작업 브랜치 `wf/injuries-s12`, 시작 커밋 `f4837e8`), R1 최종본(`f9965c0`)을 받은 뒤 단계 0 의 기준을 다시 재고 단계 3(구조 대상)을 했다(작업 브랜치 `wf/injuries-s03` — 이 절의 "단계 0 — 기준을 다시 쟀다"·"단계 3"). 그 위에서 단계 4a(대원 — 모델과 새 방호값)를 했다(작업 브랜치 `wf/injuries-s4a` — 이 절의 "단계 4a"). 이어서 단계 4b(대원 — 후송)·4c(대원 — 새 규칙)를 했다(작업 브랜치 `wf/injuries-s4bc` — 인계 패치 `docs/handover/H1-4b-wip.patch` 를 얹어 이어 갔다. 이 절 끝의 "단계 4b"·"단계 4c"). 그다음 단계 5(용의자)·6(판정·보고서)을 했다(작업 브랜치 `wf/injuries-s56` — 이 절 끝의 "단계 5"·"단계 6"). `wf/injuries` 는 단계 6 끝을 가리킨다. 다음은 독립 검토와 단계 7(균형·마무리)이다.

**R1 과 겹쳐 돌았다.** 이 덩어리는 R1 의 독립 검토와 단계 8(균형과 문서)이 다른 작업 폴더에서 도는 동안 먼저 했다. 그래서:

- **§9.2 의 `before-*` sweep 은 재지 않았다.** R1 의 균형이 확정된 뒤(R1 최종본을 `git merge` 로 받은 뒤) 다음 작업자가 잰다 — 그 값이 단계 3 부터의 기준이다.
- R1 최종본을 받으면 **해시 목록도 다시 만든다**(R1 의 검토·균형이 결과를 바꾸면 아래 `h0.txt` 와는 달라진다. 받은 직후의 목록이 새 기준이다). 받기 전·후로 `tests/injuries.test.ts` 와 아래 "장부" 확인을 돌려, R1 이 새로 넣은 피해 자리에 기록이 빠지지 않았는지 본다.
- 충돌을 줄이려고 기존 줄은 고치지 않고 줄을 더하기만 했다(아래 "피해 자리"). R1 쪽이 같은 함수를 고쳤으면 더한 줄만 다시 끼우면 된다.

### 단계 0 — 기준 (해시 목록만)

scratchpad `wf-injuries/`(세션 폴더 — 새 컨테이너에서는 없다. 없으면 시작 커밋을 `git archive` 로 풀어 다시 만든다):

| 파일 | 내용 |
|---|---|
| `hashes.ts` | §10 의 목록을 조금 넓힌 것. `npx tsx hashes.ts <작업 폴더 절대 경로> [--sweep]` — 작업 폴더를 인자로 받는다(본문의 고정 경로 대신). 한 줄 = 시드 · 난이도 · 강제 시나리오 · `report.hash` · **상태 요약 해시**(대원·구조 대상·용의자의 체력·출혈·상태·자리, 사건 판정, 부대 상태 — 기록에 남지 않는 변화도 잡는다) · 날씨. `--sweep` 은 보통·극한 프리셋의 S0~S19 를 더한다(`sweep 20` 과 같은 교대) |
| `h0.txt` | 시작 커밋 `f4837e8` 의 목록, 68교대(§10 의 28 + 보통 20 + 극한 20). 맑음 27 · 안개 19 · 밤 16 · 비 6 — 헬기가 뜨는 맑은 낮 교대가 섞여 있다 |
| `h1.txt` · `h2.txt` | 단계 1 뒤 · 단계 2 뒤. **셋이 한 글자도 다르지 않다**(`cmp`) |
| `sweep0-*.json` · `sweep1-*.json` · `sweep2-*.json` | `sweep 20 --json` 과 `--diff extreme` 의 전체 요약(결과 분포·지표·`reportHash`). `cmpjson.py` 로 견준다 — `msPerShift` 말고 모두 같다 |
| `base/` | 시작 커밋을 푼 사본(기준을 다시 잴 때) |
| `diag_ledger.ts` · `find.ts` · `shots.ts` · `mutate.py` | 장부 확인(아래), 화면 장면 찾기, 화면 찍기, 변이 확인 |

강제 시나리오 이름(`armed/shooter`·`armed/hostage`·`armed/bomb`·`fire/arson`, 완료 조건 4 의 `armed/siege`·`armed/riot`)은 지금 코드에 모두 있다.

### 단계 1 (`e5ec0b5`) — 기록만

**실제 이름과 서명** (`src/sim/field/injury.ts` — 잎 모듈: `types`·`rng`(타입)·`engine`(타입)만 import 한다. 방호(`crews.ts`)는 4a 가 더한다)

| 이름 | 비고 |
|---|---|
| `CAUSE_NAME` · `bandOf(h)` · `injuryRng(sim, s, purpose)` · `noteInjury(list, cause, dmg, t, sevAfter, by, byKind, ev)` · `initInjuries(sim, s, I)` · `mainCause(list)` | 본문 §2.7 그대로. `hazards.band` 는 `bandOf` 그 자체다(`export const band = bandOf`) |
| `noteCasHurt(c, cause, hp0, bleed0, t, by, byKind, ev)` | **본문에 없는 얇은 포장.** 한 번 피해의 기록: 깎인 양 = `hp0 − c.health`(0 이하면 적지 않는다), 그 자리가 출혈을 키웠으면(`c.bleed > bleed0`) `bleedCause = cause`, 체력이 0 이하가 됐으면 `deathCause`(이미 있으면 그대로) |
| `noteRespHurt(r, cause, hp0, t, by, byKind, ev)` · `noteHostileHurt(h, …)` | 대원·용의자용. 숨지지 않은 사람의 `sev` 는 위중(2)까지만 적는다 — 지금 모델에서 대원은 체력 하한 1, 용의자의 0 이하는 '제압'이다. 4a·5 가 `hurt*` 로 바꾸면 이 상한은 없어진다 |
| `noteDecay(c, s, wound, smoke, burn, expo, dt, t)` · `decayCause(c, s, I, wound, smoke, burn, expo)` | `tickCasualties` 전용: 한 틱의 악화를 항별로 적고, 숨진 틱의 가장 큰 항을 돌려준다. 상처 항은 `bleedCause` 가 있을 때만. 가장 큰 항의 원인을 모르면 다음 항 → `mainCause` → `initialCause` |
| `initialCause(s, I, c)` | §2.3 의 처음 원인 표 |
| `smokeCause(s)` | 가스 누출 현장(`s.kind === 'hazmat'` 또는 `s.rules` 에 `gas`)의 `s.smoke` 는 `toxic`, 그 밖은 `smoke` |

**피해 자리 — 기록을 넣은 곳** (모두 기존 식은 그대로 두고, 바꾸기 전 값을 `const hp0 = …, bl0 = …` 로 잡은 줄과 바꾼 뒤의 기록 줄을 더했다. 3·4a·5 가 `hurt*` 로 바꿀 때 두 줄을 지운다 — `grep -rn "(H1)" src/sim` 으로 모두 나온다)

| 파일 · 함수 | 무엇 | 원인 · 가해자 | `hurt*` 로 바꾸는 단계 |
|---|---|---|---|
| `hazards.tickCasualties` | 항별 악화(`noteDecay`), 숨진 틱의 `deathCause` | 상처 = `bleedCause` · 연기 = `smokeCause(s)` · `burn` · `exposure` | 3 (식은 그대로, 종료 뒤 멈춤) |
| `hazards.blast(…, ev, cause = 'blast')` | 대원·구조 대상 | 인자 `cause`. `tickFire` 의 천장 붕괴와 `tickCollapse` 는 `'crush'`, 가스 용기·누출 가스·폭발물(`rules/crime.detonate`)은 기본값 `'blast'` | 3(구조 대상)·4a(대원)·5(용의자 — 지금은 건너뛴다) |
| `hazards.panicShot` | 인질 | `gunshot` · 용의자 | 3 |
| `hazards.tickHostiles` 인질 시한 | 인질 | 든 무기대로 `gunshot`·`stab`·`blunt` · 용의자 | 3 |
| `hazards.tickHostiles` 총격범 | 시민 | `gunshot` · 용의자 | 3 |
| `hazards.tickHostiles` 대원 피격 | 대원 | `gunshot` · 용의자, `ev` = '○○ 피격' 기록 | 4a |
| `hazards.tickHostiles` 흉기·맨손 | 대원 | `stab`·`blunt` · 용의자, `ev` 없음(피습 문구는 4a 가 만든다) | 4a |
| `hazards.tickLane` | 대원 | `vehicle`, `ev` = SECONDARY_COLLISION | 4a |
| `hazards.tickGas` 주변 시민 | 새로 붙는 사람 | `toxic`(처음 기록 + `bleedCause`), `ev` = 그 기록 | — |
| `hazards.tickWander`·`creekDrift` | 물에 빠짐·물을 먹음 `drown`(+ `bleedCause`), 넘어짐 `fall`, 추위 `bleedCause = 'exposure'` | 세계 | 3 |
| `hazards.tickCrush` · `tickLift` · `tickMedical`(심정지) | 구조 대상 | `crush` · `illness` · `illness` | 3 |
| `hazards.tickWater` | 떠내려가 숨짐: `c.lost = true`, 남은 체력을 `drown` 으로, `deathCause` | 세계 | 3(문구의 조사만) |
| `sceneManager.agentHealth` | 대원의 연기·불 | `smokeCause(s)` · `burn` (체력 하한 1 을 건 뒤의 차이로 적는다) | 4a |
| `executor.shootAt` | 용의자 · 빗나간 탄에 맞은 인질 | `gunshot` · 대원 | 5 · 3 |
| `executor` `case 'carry'` | **R1 이 더한 자리**: 척추 고정판 없이 옮길 때의 악화(`c.health -= c.bleed × 0.12 × dt`) | `bleedCause` | 3 |
| `rules/disaster.ts` 해일 | 구조 대상 `drown`(+ `bleedCause`), 대원 `drown` | 세계 | 3 · 4a |
| `rules/crime.detonate` | 폭발이 키운 출혈의 `bleedCause = 'blast'` (체력은 `blast` 가 적는다) | — | 3(`blast` 가 맡으면 이 줄은 지운다) |
| `sceneManager.createScene` | `initInjuries` | 처음 원인 표 | — |

**기록을 넣지 않은 자리** (찾아본 것: `health -=`·`health =`·`bleed …=`·`dead = true`·`state = 'down'` 을 `src/sim` 전체에서)

- `builders.ts`·`scenes/*.ts` 의 처음 체력·출혈(추격전 사고의 `v.health -= …`, `h.health = rng.range(48, 78)` 포함): `initInjuries` 가 현장이 만들어진 직후 한꺼번에 적는다.
- 처치로 오르는 체력(`executor` `case 'treat'`), 이송 중 처치(`resources.tickUnits`), 물에서 건진 뒤 줄어드는 출혈(`executor` `waterRescue` · **`rules/air.ts` `hoistDone`** — R1 의 호이스트): 피해가 아니다. 단계 3 의 `bleedCause = 'exposure'` 는 `waterRescue` 와 **`hoistDone` 두 곳**에 넣는다(본문 표에는 `waterRescue` 만 있다).
- 테이저(`executor.tryTaser`): 지금은 체력을 깎지 않는다. §4.2 의 "electric 2" 는 5단계.
- R1 의 공기 소진·장비 고장: 따로 체력을 깎는 자리가 없다. 빈 공기통의 연기 피해는 `agentHealth` 의 같은 줄(1.3 × smoke)이라 위의 기록에 들어 있다.
- 헬기(`rules/air.ts`): 관측자는 `s.agents` 밖이라 어떤 피해 경로에도 들지 않는다.
- 해일에 휩쓸린 구조 대상의 `Injury.ev` 는 −1 이다(기록이 사람 순회 뒤에 남는다. `causeEvent` 는 지금처럼 이어진다).

**본문과 다르게 한 곳**

1. **기록 함수를 감쌌다**(`noteCasHurt`·`noteRespHurt`·`noteHostileHurt`·`noteDecay`). 본문은 "`noteInjury` 한 줄씩"인데, 기존 줄에 난수가 박혀 있어(`c.health -= s.rng.range(26, 40)`) 값을 꺼내려면 그 줄을 고쳐야 한다. 줄을 고치지 않으려고 앞뒤 체력의 차이로 적는다 — R1 쪽이 같은 줄을 고쳐도 충돌하지 않는다.
2. **인질 시한의 원인은 든 무기대로**(본문 표는 총상 하나). 칼 든 인질범이 다치게 한 것은 자상이다 — G5 의 `recHarm` 과 같은 갈래.
3. **외상 환자의 내부 출혈(`tickMedical` 의 `internal`)은 `bleedCause` 를 바꾸지 않는다**(본문은 `tickMedical` 전체를 `illness` 로). 낙상·외상 환자의 처음 원인은 `blunt` 이고 내부 출혈은 그 상처가 깊었던 것이다. 실신 → 심정지 갈래만 `illness`.
4. **`Unit.oosEv` 를 단계 1 에서 함께 넣었다**(§2.1 의 목록에는 없고 §3.6 이 4b 에 말한다). 부대 리터럴의 모양을 한 번에 정해 두려는 것 — 쓰는 것은 4b.
5. **본문 §5.3 의 "`tickWander` 의 표류 사망"은 지금 코드에 없다.** 개울에 빠진 실종자는 `creekDrift` 가 떠내려 보내되 숨지게 하지 않고(악화 규칙이 판정한다), 현장 밖으로 떠내려가 숨지는 것은 `tickWater` 뿐이다.
6. `rules/crime.detonate` 에 `bleedCause` 한 줄(§12.1 표 밖). 없으면 폭발로 다친 사람의 악화가 원인 없이 남는다.
7. `rules/injury.ts` 의 빈 규칙은 `I.phase === 'closed'` 면 돌아가는 한 줄만 있다. `scenes/index.ts` 의 두 import 는 `'../rules/air'`(마지막에 돌아야 한다) 앞에 넣었다.

**시험** (`tests/injuries.test.ts` — 번호는 §11)

- 1(기록 부분) · 2(`bandOf`·`noteInjury`·한 번 피해의 기록) · 처음 원인 표 · 9(숨진 사람의 원인, `c.lost`) · 11(목적별 흐름) · 객체 모양 · 8(지금 지켜지는 부분).
- **장부**(본문에 없음): 교대 20개(총격범 8 · 위협 5/심각도 5/장비 1 의 8 · 보통 4)에서 사람마다 `Σ injuries.dmg = 100 − 체력`(처치를 받지 않은 구조 대상, 모든 용의자, 모든 대원). 피해 자리 하나를 빠뜨리면 여기서 걸린다 — `hurt*` 로 옮긴 뒤에도 그대로 통과해야 한다(4a 부터 대원의 하한 1 이 없어지면 대원 쪽 조건의 "하한에 걸린 대원" 갈래만 지운다). 더 넓게 볼 때는 `diag_ledger.ts`(65교대 — 강제 11종·재난 3종 포함): 불일치는 숨진 사람의 넘친 양뿐이다.
- 변이 확인(`mutate.py` — 단계 1 의 14가지 · 단계 2 의 9가지): 기록 줄·처음 원인·`c.lost`·리터럴의 새 칸·목적별 흐름(단계 1), 덮개·시점 규칙·누르기·그리지 않는 사람·자동 확대·색(단계 2)을 하나씩 망가뜨리면 모두 실패한다(둘은 타입 검사에서 먼저 걸린다).

**뒤 단계가 알아야 할 것**

- **§11-8 의 둘째 정규식(`responders[…].(health|dead|bleed|care|tDown)`)은 지금 `commander.ts` 두 곳에서 걸린다**: `assign` 의 `sim.responders[b.rid].health < HURT_HEALTH`(Z1 "다친 대원의 후퇴는 끝까지" — 본문을 쓴 뒤에 들어왔다). 4a 가 정한다 — `status === 'injured'`(조직이 아는 상태)로 바꾸면 "체력 40 아래"와 "출혈로 물러남"을 함께 덮는다. 지금 시험에는 첫째 정규식과 import 검사만 넣었다.
- **`retreat` 는 길이 없어도(`nopath`) 그 자리에서 `withdrawn` 이 된다**(`executor` `case 'retreat'`). 불 속에 갇힌 채 `withdrawn` 인 대원이 실제로 있다(극한 `X1` 사건 06 의 진압 팀장, t ≈ 530 — 불타는 방 (16,10) 에서 '부상 — 후송 대기', 체력 39 → 24). 지금은 하한 1 이 살려 두지만 4a 부터는 그 자리에서 숨지고, §3.2 의 순직 문구는 `withdrawn` 을 "안전 구역에서 후송을 기다리던 중"으로 읽는다. 4a 가 고친다(예: `nopath` 면 `withdrawn` 으로 두지 않고 `down` 처럼 구조 대상으로 삼거나, 문구를 자리로 가린다).
- 숨진 틱의 가장 큰 항으로 정한 `deathCause` 는 화재에서 `burn` 이 많다(65교대의 숨진 218명: 화상 86 · 차량 충격 32 · 잔해 29 · 급성 질환 24 · 유독 가스 21 · 연기 12 …). 연기로 약해진 사람도 불이 닿은 틱에 숨지면 화상이다 — §7.2 의 문장이 어색하면 6단계가 "가장 큰 누적 원인"(`mainCause`)과 견줘 정한다.
- `c.lost` 는 지금부터 선다(`tickWater`) — 단계 2 의 화면이 그 사람을 그리지 않는다.
- 대원의 기록은 `agentHealth` 가 하한 1 을 건 뒤에 적으므로, 한 번 피해로 0 아래까지 갔다가 1 로 올라온 대원은 `Σ dmg > 100 − 체력` 이다(4a 에서 하한이 없어지면 같아진다).
- 속도: `sweep 20 --no-metrics` 를 시작 커밋 사본과 번갈아 세 번씩(`speed.sh`) — 사용자 CPU 평균 19.45초 → 19.83초(+2%, 바퀴마다 ±4% 로 흔들린다), 교대당 336ms → 336ms. `noteInjury` 는 원인마다 한 줄을 고쳐 쓰므로 배열이 늘지 않는다.

### 단계 2 (`c5dc436`) — 화면 (결과 불변)

**실제 이름**

| 파일 | 이름 | 비고 |
|---|---|---|
| `view/triage.ts`(새) | `TRIAGE` · `TRIAGE_EDGE` · `TRIAGE_TEXT` · `TRIAGE_NAME` · `LOSS_COLOR` | 중증도 색 한 곳. `styles.css` 끝의 `/* ── injuries ── */` 블록이 같은 값을 쓴다(시험이 글자로 견준다) |
| | `casBand(c)` · `respBand(r)` · `hostileBand(h)` | 숨진 사람(`dead`)만 3(검정)이다. 체력이 0 이하여도 숨지지 않았으면 위중 — 지금 모델의 '제압'된 용의자, 하한 1 의 대원 |
| | `casSheet(c)` · `respSheet(sim, r, truth, cmd)` · `hostileSheet(sim, h, truth, cmd)` | 덮개 = "확인된 사망"(§8.2): 구조 대상은 발견된 뒤, 대원·용의자는 관찰자 시점 `tDead + 3`초 / AI 시점은 지휘관의 `mate`·`hos` 사실의 `dead` |
| | `respLying(a, r)` · `casDrawn(c)` · `hostileDrawn(h)` · `hurtPose(health, from)` | 눕혀 그리는 대원(쓰러짐 + 쓰러졌다가 옮겨진 `withdrawn`) · 그리지 않는 사람(`c.lost`, `h.where !== 'scene'`) · 다친 자세의 세기 |
| | `injuryLine(list)` · `careName(q)` · `respStateText(r)` · `agentStateText(a, r)` · `isLoss(e)` | 패널의 글. `isLoss` = 구조 대상의 사망 기록(`casualty` imp 3)과 `RESPONDER_KILLED`·`SUSPECT_DIED`(4a·5 가 코드를 더하면 저절로 걸린다) |
| | `casInfo(sim, s, c, truth, cmd)` · `hostileInfo(…)` → `PersonInfo` | 정보창의 내용. 관찰자 시점은 진실, AI 시점은 지휘관의 `cas`·`hos` 사실만(없으면 `known: false`, 줄 없음) |
| `ui/PersonCard.tsx`(새) | `PersonCard({ sim, sel, truth, onClose })` · `PersonSel { kind: 'cas' \| 'hostile'; inc; id }` | 오른쪽 칸의 '대원 정보' 자리에 뜬다 |
| `view/renderScene.ts` | `triageBadge(ctx, x, y, r, b, ts, text, cross, dashed)`(안쪽) · `SceneOpts.pick` · `hitScene(…, cam?, truth = true)` → `{ rid, cas, hostile }` | 딱지 그림 함수. 구조 대상 딱지도 이것으로 그린다 |
| `view/scene/sprites.ts` | `ArmPose 'clutch'` · `PersonPose.hurt` | 한 팔로 옆구리를 붙듦 · 걸음 폭 ×(1 − 0.55 hurt), 몸 기울기 0.2 hurt |
| `view/camera.ts` | `frameAction` 의 쓰러진 대원(무게 1.0) | |
| `ui/Mark.tsx` | `RoleDot` 의 `dead` | 건강 반 테는 `TRIAGE`, 순직은 검정 바탕에 밝은 테 |
| `ui/panels.tsx` | `hurtNote(sim, rid)`(안쪽), 대원 정보창의 '부상' 줄, `.cchip` 의 `dead`, 기록·속보의 `loss` | |
| `ui/Viewport.tsx` · `ui/App.tsx` | `person`·`onSelectPerson` · 범례의 사망·들것·덮개 | |

**그리는 것** (§8.2 의 표)

- 구조 대상: 덮개는 `casSheet`(발견된 사망). 관찰자 시점의 미발견 사망은 누운 채 흐린 검정 딱지. `c.lost` 는 그리지 않는다. 딱지는 `triageBadge` — 사망은 검정 바탕·밝은 테두리·흰 글씨.
- 대원: 중상(체력 70 이하)부터 다친 자세와 **오른쪽 위의 작은 딱지**(글자 없이 색). 쓰러진 대원은 누움 + 빨간 맥박 고리(숨졌으면 고리 없음, 3초 뒤 덮개). 끌려가는 중(`carrying = −(rid+2)` 인 동료)이면 그쪽으로 눕히고 그 동료나 곁의 대원이 들것을 가졌으면 들것 위에(R1 의 `hasLitter` 그대로). 안전 구역으로 옮겨진 대원은 계속 누워 있고, 걸어서 물러난 대원은 앉는다(`crouch` + `clutch`). 투명도 0.6 은 없앴다.
- 용의자: 체력 60 아래부터 다친 자세, 다쳤거나 쓰러졌으면 **왼쪽 위의 작은 딱지**(붙잡힌 인질의 딱지와 겹치지 않게 반대쪽). 누움 = `state === 'down'` 또는 `dead` 또는 `tDown` 이 있음(검거된 채 쓰러진 용의자). 알약의 글자는 '쓰러짐'(예전 '제압'), 사망이 확인되면 '사망'. 옮겨지는 중(그 틱에 자리가 바뀜)이면 가장 가까운 대원 쪽으로 눕히고 들것 규칙은 같다.
- 누르기: 대원이 먼저, 없으면 구조 대상, 그다음 용의자. AI 시점에서는 화면에 그려지지 않는 사람(미발견 구조 대상, 숨은 용의자)이 잡히지 않는다. 고른 사람은 흰 점선 고리.

**본문과 다르게 한 곳**

1. **사람 정보창은 떠 있는 창이 아니라 오른쪽 칸의 '대원 정보' 탭 자리에 뜬다.** 대원을 고르면 대원 정보, 구조 대상·용의자를 고르면 그 사람의 정보(닫기 단추). 현장 그림을 가리지 않고, 고른 사람의 정보가 늘 같은 자리에 온다.
2. **대원 칩**: 본문이 가리킨 자리(`panels.tsx:131-152`)는 R1 이 역할 점(`RoleDot`)과 부대장 칩으로 바꿨다. 역할 점의 건강 반 테를 분류 색으로, 순직을 검정으로, 설명(`title`)에 상태와 원인을 더했고, 부대장 칩의 `.injured`·`.down`·`.dead` 를 색으로 나눴다.
3. **용의자의 딱지는 왼쪽 위**(본문은 자리를 정하지 않았다). 인질과 인질범은 같은 칸에 서는 일이 많아 같은 쪽에 두면 겹친다.
4. **`hitScene` 에 `truth` 인자**(기본 true — R1 의 시험이 쓰는 옛 호출은 그대로). AI 시점에서 보이지 않는 사람을 눌러 정보창이 뜨면 시점 규칙이 샌다.
5. 대원의 덮개·쓰러진 용의자의 '사망' 글자는 **AI 시점에서 지휘관이 알 때만** 바뀐다. 그 전까지 숨진 사람은 위중(빨강)으로 보인다 — 4a·5 가 `mate`·`hos` 사실에 `dead` 를 넣으면 저절로 이어진다(지금은 그 칸이 없어 AI 시점에서는 덮개가 나오지 않는다).
6. 보고서의 타일·목록('대원 순직', '용의자 사상', 결장 예상)은 6단계에 남겼다(§10 표가 6단계로 적었다. 그 칸들을 채우는 것도 6단계다).
7. 소리(§8.6, 선택): `audio.ts` 에 분기 하나 — `RESPONDER_KILLED` 는 낮고 긴 `loss` 음(140 → 90Hz, 0.9초), `SUSPECT_DIED` 는 구조 대상 사망과 같은 음. 코드가 생기기 전에는 울리지 않는다.

**뒤 단계가 알아야 할 것**

- **5단계 뒤에 다시 찍어 확인할 것**(§8 첫머리): 대원의 덮개(`r.dead`), 후송(`r.care` — 대원 정보창의 '후송' 줄), 용의자의 덮개·들것·'사망' 글자·처치의 흰 십자(`h.treatQ`)·차에 실린 용의자(`h.where`). 그리는 길은 모두 있고 시험이 가짜 캔버스로 한 번씩 지나가지만, 실제 교대에서는 그 칸들이 아직 비어 있다.
- 4a 가 `mate` 사실의 값을 `MateBelief` 로 넓히면 `respSheet` 가 읽는 칸은 `dead` 하나다. 5단계의 `hos` 사실에 `dead`·`band`·`tq` 가 들어가면 `hostileInfo` 의 AI 시점이 그 칸들을 보인다(지금도 있으면 읽는다).
- 보고서 화면(6단계): 색은 `TRIAGE`, 순직 타일은 `LOSS_COLOR`(빨강을 쓰지 않는다), 줄의 글은 `injuryLine`·`respStateText` 를 쓴다.
- `window.__ar.snap()` 의 필드와 버튼 글자는 건드리지 않았다(`scripts/ui-check.cjs` 그대로).
- 화면에서 주소에 `diff` 가 없으면 재난이 '무작위'라 헤드리스(`sweep`)와 조건이 다르다 — 장면을 찾을 때는 `find.ts <폴더> <시드> ui <force>` 처럼 같은 조건으로 찾는다.

**확인** (개발 서버 5210, `scratchpad wf-injuries/shots/` 의 그림 — `shots.ts` 가 같은 틱까지 헤드리스로 돌려 해시를 견주고 사람의 자리를 눌러 본다)

- 완료 조건 5 의 주소: `?seed=S3&force=armed/shooter`(t 160 — 사망이 확인된 인질의 덮개와 검정 딱지, 다친 채 검거된 용의자의 딱지, 정보창의 관찰자·AI 시점 — `spec1-*.png`) · `?seed=S3&force=fire/arson`(t 150 — 화재 현장 — `spec2-*.png`) · `?seed=X1&diff=5,5,5,1,5,1`(t 536 사건 06 — 덮개 둘, 불 속에서 물러난 대원의 딱지와 정보창 "화상 67 · 연기 흡입 9" — `spec3-*.png`).
- 더 본 것: `?seed=S6&force=armed/shooter`(t 146 — 총에 맞아 쓰러진 용의자: 누움·빨간 딱지·'쓰러짐', 용의자 정보창 — `s6shoot-*.png`) · `?seed=X3&diff=5,5,5,1,5,1` 사건 09(t 493 쓰러진 대원의 맥박 고리 · t 511 동료 둘이 끌고 가는 중 · t 535 안전 구역에 누운 채 — `x3down`·`x3drag`·`x3safe`) · `?seed=X1&diff=5,5,5,1,5,1` 사건 04(t 396 — 걸어서 물러나 앉은 대원 — `x1host-*.png`).
- 어느 그림에도 피·붉은 조각이 없다. 콘솔 오류 0건. 멈춘 틱의 브라우저 해시 = 헤드리스(같은 조건으로 돌렸을 때).

### 단계 0~2 가 끝난 자리 — 단계 3 이 이어받을 때

**관문** (마지막 코드 커밋 `c5dc436` 에서): `npx tsc --noEmit` 통과 · `npm run check` 통과(Vitest 287개 + 건너뜀 1, 파일 13개 — `tests/injuries.test.ts` 33개 22초 / 시드 40개 `검증 통과`, 결과 분포는 시작 커밋과 같다: 성공 448 · 부분 55 · 지연 26 · 미해결 12 · 실패 26) · `npm run ui-check` 모두 통과(보고서 해시 `2342b7c9` = 헤드리스 — R1 단계 7 끝과 같은 값). 해시 목록 68교대와 `sweep 20 --json`(보통·극한)의 전체 요약이 시작 커밋 `f4837e8` 과 같다(`h0.txt` = `h1.txt` = `h2.txt`).

**이어받는 순서**

1. R1 최종본을 받는다(`git merge` — 주 브랜치에 R1 의 검토·단계 8 이 합쳐진 뒤). 충돌이 나면 R1 쪽 줄을 살리고 위 "피해 자리" 표의 기록 줄(`const hp0 …` 과 `note…`)만 다시 끼운다. 받은 뒤 `npx vitest run tests/injuries.test.ts`(장부가 R1 이 새로 넣은 피해 자리를 잡는다)와 `diag_ledger.ts` 를 돌린다.
2. 기준을 다시 잰다: 해시 목록(`hashes.ts <폴더> --sweep`)과 §9.2 의 `before-*`(보통·쉬움·어려움·극한 60교대, 강제 다섯 20교대).
3. 단계 3 부터는 결과가 바뀐다. `hurtCas` 를 만들 때 위 표의 "3" 줄을 바꾸고(기록 줄 둘을 지운다), §11 의 시험을 같은 번호 아래에 덧붙인다. 장부 시험은 그대로 통과해야 한다.

**§12.1("고칠 파일") 밖에서 고친 곳 — 단계 1·2**

| 파일 | 함수 · 자리 | 이유 |
|---|---|---|
| `sim/field/kit.ts` | `addCas`·`addHostile` 의 리터럴 | 새 선택 칸을 같은 순서로(§2.1 "객체 모양"이 말하지만 표에는 없다) |
| `sim/field/agents.ts` | `makeAgent` 의 리터럴 | 같음 |
| `sim/resources.ts` | `createRoster`·`createAidUnit` 의 대원·부대 리터럴 | 같음 (`oosEv` 포함) |
| `sim/field/executor.ts` | `case 'carry'` | R1 이 더한 피해 자리(척추 고정판)의 기록 |
| `sim/field/rules/crime.ts` | `detonate` | 폭발이 키운 출혈의 `bleedCause` |
| `ui/Mark.tsx` | `RoleDot` | 건강 반 테의 색을 `TRIAGE` 로, `dead` (R1 이 만든 대원 칩) |
| `view/audio.ts` | 기록 소리의 `problem` 갈래 앞 | §8.6 (선택 항목 — 표에는 "2·6") |

### 단계 0 — 기준을 다시 쟀다 (R1 최종본 `f9965c0`, 단계 3 작업자)

R1 최종본을 `git merge` 로 받은 뒤(충돌 없음 — `12a8b2b`) 다시 쟀다. **이 값이 단계 3 부터의 기준이다**(위 "단계 0 — 기준 (해시 목록만)" 절의 `h0.txt` 는 R1 최종본 전의 것이라 `h0-f4837e8.txt` 로 옮겼다).

- 받은 뒤의 확인: `npx tsc --noEmit` · `tests/injuries.test.ts` 33개 · `tests/crews.test.ts` 70개 통과. 장부(`diag_ledger.ts`, 69교대 — 구조 대상 2,661 · 대원 4,572 · 용의자 288): 불일치는 숨진 사람의 넘친 양 3건뿐, 출혈 원인이 빈 채 악화 중인 사람 0, 원인 없는 사망 0 — **R1 최종본에서 기록이 빠진 피해 자리는 없다.**
- `f9965c0`(H1 을 하나도 넣지 않은 자리)과 `12a8b2b`(단계 1·2 를 합친 자리)의 해시 목록 68교대가 한 글자도 다르지 않다(`base/head-12a8b2b-hashes.txt`) — 기준은 `f9965c0` 을 따로 푼 사본(`base-src/`)에서 쟀다.
- 저장한 곳: scratchpad `wf-injuries/base/`(그 폴더의 `README.md` 가 색인). §9.2 의 `before-*`(보통·쉬움·어려움·극한 60교대 `--json`·`--scen`, 강제 20교대 `armed/shooter`·`armed/hostage`·`armed/siege`·`armed/bomb`·`fire/arson`)에 더해 완료 조건 4 의 `armed/riot`, 단계 3 이 건드리는 현장(`collapse`·`collapse/gasblast`·`collapse/elevator`·`collapse/crane`·`hazmat`·`water`·`search`·`traffic/bus`·`fire`·`armed/domestic`), 재난(`--disaster tsunami`·`quake`), 부대 규모 1(30교대), `--metrics 40`, 해시 목록(`before-hashes.txt` = `h0.txt`)을 쟀다. 다시 재는 법: `measure.sh <소스 폴더> <결과 폴더> <before|after>`(4~5분), 견주기 `node compare.mjs base <결과 폴더>`.

| 기준 (`f9965c0`) | 보통 | 쉬움 | 어려움 | 극한 |
|---|---|---|---|---|
| 사건 (60교대) | 848 | 669 | 1,104 | 1,394 |
| 성공 / 성공+대응 지연 | 80.5% / 84.7% | 87.6% / 89.4% | 63.0% / 69.1% | 36.4% / 48.3% |
| 실패+미해결 | 6.0% | 4.5% | 15.9% | 34.1% |
| 한계 시간 + 방치 (+ 무대응) | 4 (한계 1 + 놓친 추격전 3) | 1 | 15 | 40 (+1) |
| 구조율 (숨짐 · 미발견) | 94.1% (99 · 11) | 95.9% (44 · 9) | 87.1% (306 · 34) | 75.2% (836 · 50) |
| 다친 대원 / 교대 | 0.17 | 0.08 | 0.57 | 0.82 |

보통 60교대의 유형별 성공률: 화재 70.9 · 교통 82.8 · 실종 97.0 · 무장 76.9 · 응급 83.2 · 붕괴 78.3 · 가스 82.3 · 수난 78.4%. 강제 20교대의 그 시나리오 줄(n · 성공 · 부분 · 지연 · 미해결 · 실패 | 한계 시간·무대응·방치): `armed/shooter` 23 · 21 · 2 · 0 · 0 · 0 | 0·0·0, `armed/hostage` 20 · 18 · 2 · 0 · 0 · 0 | 0·0·0, `armed/siege` 21 · 15 · 4 · 2 · 0 · 0 | 0·0·0, `armed/bomb` 21 · 21 · 0 · 0 · 0 · 0 | 0·0·0, `fire/arson` 43 · 30 · 7 · 1 · 0 · 5 | 0·0·0, `armed/riot` 22 · 19 · 3 · 0 · 0 · 0 | 0·0·0 (그 20교대 전체의 한계 시간 2건은 다른 사건). 부대 규모 1(30교대): 성공 60%, 한계 시간 4 · 방치 2. 지표(보통 40): 교착 후보 0 · 잊힌 사건 0 · C1~C5 0 · 반복 최대 9.

### 단계 3 (`896351d` · `a1fec0a` · `2978770` · `41cf379` · `7f5ff79` · `c34db3d`) — 구조 대상

**실제 이름**

| 파일 | 이름 | 비고 |
|---|---|---|
| `field/injury.ts` | `HurtOpts { by, byKind, ev, tick, bleed, immobile, down }` | 본문 §2.7 그대로. 구조 대상이 쓰는 것은 `by`·`byKind`·`ev`·`bleed`·`immobile` — `tick`·`down` 은 4a·5 가 쓴다 |
| | `hurtCas(sim, s, I, c, amount, cause, o?)` | 본문 그대로. 숨졌거나 판정 뒤면 돌아간다. 체력 − amount, 그 원인으로 한 줄(같은 원인은 합친다), `o.ev` → `Injury.ev`·`c.causeEvent`, `o.bleed` → `c.bleed = max(c.bleed, o.bleed)`·`c.bleed0 = c.bleed`(키웠으면 `bleedCause = cause`), `o.immobile` → 걷던 사람을 세운다(갇힌 사람은 그대로), 0 이하면 `deathCause`(이미 있으면 그대로). 문구는 남기지 않는다 |
| | `hurtCasTo(sim, s, I, c, to, cause, o?)` | **본문에 없다.** 깎을 양 대신 깎은 뒤의 체력을 받는다 — 하한·상한이 걸린 자리가 쓴다(아래 "다르게 한 곳" 1). 지금보다 높은 값은 무시한다 |
| `field/hazards.ts` | `TRAP_R`(1.6) · `TRAP_WORK`([6, 10]) | 2차 붕괴 곁의 갇힘 — §9.3-4 의 손잡이 |
| `field/executor.ts` | `MISHAP { p: 0.06, hit: [6, 14] }` | 구출 중 사고 — §9.3-4 의 손잡이 |
| `field/rules/injury.ts` | `WALK_STOP`(40) | 걷던 사람이 쓰러지는 체력. 규칙 하나가 등록돼 있다(4c·5 가 같은 파일에 더한다) |
| `field/commander.ts` | `outstanding(a, now = -1)` · `MOBILE_STALE`(32, 안쪽) | `now` 를 주면 현장에서 대피 중이라던 사람(`mob 'mobile'`·`where 'scene'`)의 소식이 32초 넘게 끊겼을 때 남은 일로 센다. 부르는 곳 셋: `sceneManager` 7)번 블록과 `rules/air.ts` 의 `tellDispatch` 는 `sim.t` 를 넘기고, `airDecide.watchBusy` 는 넘기지 않는다(`patients` 를 읽지 않는다). 4a 가 `mates` 를 더한다 |

**`hurtCas` 로 옮긴 자리** (단계 1 이 붙여 둔 `const hp0 …` 과 `noteCasHurt` 줄을 지웠다. 난수는 예전 자리·예전 순서 그대로 뽑고 뽑은 값만 넘긴다)

| 파일 · 함수 | 넘기는 것 |
|---|---|
| `hazards.blast` (구조 대상 쪽) | `hurtCas(…, dmg × 0.8 × (1 − d/(r+1)), cause, { ev })`. 원인이 `blast` 이고 그 뒤 체력이 80 아래면 한 번 더 `hurtCas(…, 0, 'blast', { bleed: (0.09 + 0.09 × (1 − d/r)) × bleedMul, immobile: true })` |
| `hazards.panicShot` · 인질 시한 · 총격범 · `executor.shootAt` 의 빗나간 탄 | `hurtCas(…, 뽑아 둔 피해, 원인, { by, byKind, ev, bleed: 0.18 / 0.18 / 0.13 / 0.15, immobile: true })` — 기록(`raiseProblem`)을 먼저 남기고 그 id 를 넘긴다 |
| `hazards.tickWander` 개울에 빠짐 · 넘어짐, `creekDrift` 물을 먹음 | `hurtCasTo(…, Math.max(5 또는 1, c.health − x), 'drown' / 'fall', { ev[, bleed] })`. 넘어져 빨라진 악화는 그 자리가 `bleedCause = 'fall'`, 추위는 `'exposure'` |
| `hazards.tickCrush` · `tickLift` · `tickMedical`(심정지) | `hurtCasTo(…, Math.max(1, …) / Math.min(c.health, e.hp) / Math.min(c.health, 뽑은 값), 'crush' / 'illness' / 'illness', { ev })`. 출혈은 그 자리의 식 그대로 |
| `hazards.tickWater` (떠내려가 숨짐) | 기록을 먼저 남기고 `hurtCasTo(…, 0, 'drown', { ev })` 뒤에 `c.dead = true …`(사망은 지금처럼 그 자리에서) |
| `executor` `case 'carry'` (척추 고정판 없이 옮김) | `hurtCas(…, c.bleed × 0.12 × dt, c.bleedCause ?? initialCause(…), { tick: true })` |
| `rules/disaster.ts` 해일 (구조 대상) | `hurtCasTo(…, Math.max(8, c.health − x), 'drown', { bleed })` — 대원 쪽은 4a |

`tickCasualties` 의 매 틱 악화는 본문대로 자기 식을 그대로 두고 `noteDecay` 로 적는다. 가스 노출 시민(`tickGas`)은 다친 채 새로 생기는 사람이라 만드는 자리가 `noteInjury` 로 적는다(그대로). 구조 대상의 체력을 직접 깎는 줄은 `tickCasualties` 의 악화·사망 처리, `tickWater` 의 사망 처리, 처치 둘뿐이다 — 시험이 글자로 지킨다.

**새 규칙** (§5.1·§5.2·§2.6·§5.3 — 본문 그대로인 것은 줄만 적는다)

- **판정 뒤에는 멈춘다**(§2.6): `tickCasualties` 는 `I.phase === 'closed'` 면 악화도 사망 판정도 하지 않고(대피 이동은 남는다) `hurtCas`·`hurtCasTo` 는 첫 줄에서 돌아간다. 다치지 않는 피격·급변이 기록으로 남지 않게 자리마다 가렸다: `panicShot`(첫 줄), 인질 시한·총격범(조건에 `I.phase !== 'closed'`), 빗나간 탄(`struck` 을 정하는 식 — 난수는 그대로 뽑는다), 가스 노출 시민, `tickWander`·`tickCrush`·`tickLift`·`tickMedical`·`tickWater`(첫 줄), 2차 붕괴의 갇힘, 구출 중 사고. 폭발·붕괴 자체(불·잔해·기록)는 판정 뒤에도 일어난다 — 사람만 다치지 않는다.
- **폭발은 고르게**: 위 표의 `blast`. `rules/crime.detonate` 가 따로 하던 같은 반복문은 지웠다(아래 "다르게 한 곳" 3).
- **2차 붕괴 곁의 갇힘**(`tickCollapse`): 무너진 자리(균열 구조물 `p.x, p.y` — `blast` 의 가운데)에서 `TRAP_R` 안, 현장에 있고(`where 'scene'` — 업혀 있는 사람 제외) 물속이 아니고 아직 갇히지 않았고 체력이 0 보다 큰 사람. `trapWork = injuryRng(sim, s, 'trap').range(6, 10)`, `walking = false`, `path = null`. 갇히는 사람마다 한 번씩만 뽑는다.
- **구출 중 사고**(`executor` `extricate`): `s.kind === 'collapse'` 이고 승강기 갇힘이 아닐 때, 구출을 마치는 틱에 `injuryRng(sim, s, 'extricate')` 에서 확률 → (걸리면) 피해 순서로 뽑는다. 장비 값은 R1 의 사람 장비(`toolUse(sim, a.rid, 'extricate', I)` — 그 틱의 작업 속도에 쓴 바로 그 값, 본문의 `u.tool` 자리). 기록이 '구출 완료' 앞에 남는다.
- **걷던 사람이 멈춘다**(`rules/injury.ts`): `c.walking` 이고 체력이 0 초과 40 이하인 현장의 사람. 기록의 원인은 그 자리에서 가장 크게 깎는 항(`decayCause` — 불 속이면 화상, 연기면 연기 흡입 …)이고 `c.causeEvent` 를 그 기록으로 잇는다(뒤에 숨지면 사망 기록의 원인 사슬에 들어간다).
- **사망 문구의 원인**, **물에서 건진 뒤의 `bleedCause = 'exposure'`**(`executor` `waterRescue` 와 `rules/air.ts` `hoistDone` 두 곳), **`josa`**(`panicShot`·인질 시한·총격범의 `${h.label}가`, `tickWater` 의 `${c.label}가`).

**본문과 다르게 한 곳**

1. **`hurtCasTo` 를 더했다.** 본문은 하한을 두고 깎는 자리에 "하한을 지키는 양"(`c.health − Math.max(8, c.health − x)`)을 넘기라고 한다. 그러면 `h − (h − m)` 이 `m` 과 부동소수점 끝자리가 달라질 수 있고, "그 값까지 떨어진다"(`Math.min(c.health, e.hp)`)는 양으로 정확히 적을 수 없다. 깎은 뒤의 체력을 그대로 받는 함수를 두어, 옮기는 커밋(`896351d`)이 결과를 바꾸지 않았음을 해시로 확인할 수 있게 했다(아래 "확인").
2. **하한이 체력을 올리던 것은 없앴다.** 예전 식 `c.health = Math.max(1, c.health − x)` 는 체력이 이미 하한보다 낮은 사람을 하한까지 **올렸다**(압궤 증후군이 체력 0.5 인 사람을 1 로). `hurtCasTo` 는 지금보다 높은 값을 무시한다 — 다치는 일로 체력이 오르지 않는다. 옮기는 커밋에서 달라진 것은 이것뿐이다(해시 목록 68교대 가운데 극한 둘).
3. **`detonate` 의 반복문을 지웠다**(본문은 "`max` 라 두 번 돌아도 같으니 그대로 둔다"). `blast` 가 같은 사람에게 같은 값을 주므로 남기면 죽은 코드이고, 판정 뒤에 터질 때 `hurtCas` 는 돌아가는데 그 반복문만 사람을 쓰러뜨리게 된다.
4. **지휘관이 갇힌 줄 알게 된 사람의 이송·동행 지시를 거둔다**(`commander.ts` 의 `c.mob === 'trapped'` 줄에 `clear(['carry', 'escort'])` — §12.1 표 밖). 본문은 실행기의 강제 보고만 적었는데, 그것만으로는 갇히기 전에 낸 `carry`·`escort` 항목이 열린 채 남아 '대상이 더 이상 그 위치에 없습니다' 실패가 구출이 끝날 때까지 8초마다 되풀이됐다(지진 20교대에서 한 사건 최대 7회 → 1회). CLAUDE.md "낡은 믿음" 함정의 지휘관 쪽 절반이다.
5. **오래된 `mobile` 은 현장에 있다고 믿는 사람만 센다**(`where === 'scene'`). 본문은 "오래된 `mobile` 은 남은 일로"인데, 안전 구역에 닿은 걸을 수 있는 사람(`where 'safe'`·`mobile`)까지 세면 구급차가 떠난 뒤 끝나던 사건이 끝나지 않는다 — 동행 확인(`escort`)을 보내는 규칙과 같은 대상으로 맞췄다. 그리고 R1 이 더한 `tellDispatch`(헬기만 왔던 현장)도 같은 판단이라 `sim.t` 를 넘긴다.
6. **체력이 이미 0 이하인 사람은 '대피하다 쓰러짐'을 적지 않는다**(다음 틱에 사망으로 판정된다). 갇힘도 같다.
7. **판정 뒤에 가리는 자리가 본문의 넷보다 많다**(위 "판정 뒤에는 멈춘다"). `hurt*` 만 돌아가면 다치지 않았는데 '인질이 다침'·'물에 빠졌습니다' 같은 기록이 남는다(가짜 연출).
8. `tickWater` 의 조사는 미발견 문구에만 있었다(발견된 사람의 문구는 `${c.label}: …` 라 조사가 없다). 본문의 `tickGas` 에는 이름표 뒤 조사가 없어 고칠 것이 없다. `tickHostiles` 의 다른 `${h.label}가`(기습·투항·엄폐 이동·발포·도주 …)와 실행기의 `${h.label}를`·`${c.label}를` 은 손대지 않았다 — 용의자 문구는 5단계가 다시 쓴다(§4.6).

**시험** (`tests/injuries.test.ts` — 단계 3 뒤 58개(단계 1·2 의 33개 + 25개), 20초 남짓. 번호는 §11)

- 2: `hurtCas`(원인별 한 줄·합치기·`sev`, 가해자·기록 id·출혈·거동, 숨지게 한 원인, `hurtCasTo`, 직접 깎는 줄이 남지 않았는가).
- 9: 모든 사망 시각·사망 기록 ≤ `closedAt`, 판정 뒤의 악화·`hurtCas`·떠내려감·가스 노출 시민.
- 5(본문에 번호가 없는 단계 3 의 규칙): 폭발의 규칙·`crush` 제외·폭발물, 2차 붕괴의 갇힘(목적별 흐름의 첫 값)·판정 뒤, `carry` 의 강제 보고, 지휘관의 거둠, 구출 중 사고(났을 때·없을 때·차에 낀 사람·승강기·판정 뒤), 걷던 사람의 쓰러짐·원인, `outstanding` 의 경계, 7)번 블록, 사망 문구의 원인, 물가의 줄과 호이스트 뒤의 출혈 원인, 조사.
- 11: `injuryRng` 를 쓰는 규칙이 일어난 교대(지진 `W6`)의 재현성.
- 장부 시험은 그대로 통과한다(`diag_ledger.ts` 69교대도 단계 3 전과 같다 — 불일치는 숨진 사람의 넘친 양 3건뿐, 출혈 원인이 빈 사람 0, 원인 없는 사망 0). 그 시험의 `n > 300` 은 표본 크기 확인이다(지금 처치를 받지 않은 구조 대상 324명) — 뒤 단계에서 300 아래로 내려가면 장부가 깨진 것이 아니라 표본이 준 것이니 교대를 늘린다.
- 변이 확인(`mutate3.py` — 40가지: `hurtCas` 5 · 판정 뒤 5 · 폭발 3 · 2차 붕괴와 낡은 믿음 8 · 구출 중 사고 5 · 대피하다 쓰러짐과 `outstanding` 8 · 문구 6): 하나씩 망가뜨리면 모두 실패한다(살아남은 변이 0).

**확인과 수치** (scratchpad `wf-injuries/s3/`·`s3-full/` — `s3-full/COMPARE.txt` 가 기준과 견준 전체 표)

- 옮기는 커밋(`896351d`)의 검증: 넓은 해시 목록 87교대(강제 15종·재난 5종·어려움 — 기록 해시·상태 요약·부상 기록 해시)가 옮기기 전과 한 글자도 같고, §10 의 68교대는 66 이 같다. 다른 둘(극한 S9·S18)은 위 "다르게 한 곳" 2 — 그 한 줄을 되살린 사본에서는 68 이 모두 같다.
- 판정 뒤에 숨진 구조 대상(전 → 후, 40교대씩): 보통 1 → 0, 어려움 0 → 0, 극한 4 → 0. 모두 종료 직후 구급차 안에서 숨지던 사람이다 — 판정(구조로 셈)과 기록이 어긋나던 것(§1).
- 새 규칙이 일어난 횟수(`diag_s3.ts`·`diag_phr.ts`): 2차 붕괴는 붕괴 강제 20교대에 5번·극한 30교대에 43번·지진 20교대에 148번, 그때 갇힌 사람은 0 · 4(모두 숨짐) · 11(구출 4, 숨짐 7 — 끝까지 갇힌 사람 0). 보통 난이도에서는 균열부 보강이 먼저 끝나 2차 붕괴 자체가 드물다(보통 40교대에 5번). 구출 중 사고는 보통 40교대 2건·극한 40교대 3건. 대피하다 쓰러진 사람은 보통 40교대 3명·극한 40교대 14명. 현장이 비어 추가 부대를 찾은 일은 보통 0 → 0·극한 2 → 2(40교대) — 오래된 `mobile` 때문에 끝나지 않는 사건은 생기지 않았다.

| 기준 → 단계 3 끝 (60교대) | 보통 | 쉬움 | 어려움 | 극한 |
|---|---|---|---|---|
| 성공 | 80.5 → 80.4% (683 → 682) | 87.6 → 87.3% | 63.0 → 63.1% | 36.4 → 36.3% |
| 성공+대응 지연 | 84.7 → 84.6% | 89.4 → 89.2% | 69.1 → 69.4% | 48.3 → 48.2% |
| 실패+미해결 | 6.0 → 6.1% | 4.5 → 4.5% | 15.9 → 16.0% | 34.1 → 34.6% |
| 한계 시간 + 방치 | 4 → 4 | 1 → 1 | 15 → 14 | 40 → 43 |
| 구조율 (숨짐) | 94.1 → 94.0% (99 → 101) | 95.9 → 95.8% (44 → 45) | 87.1 → 87.1% (306 → 306) | 75.2 → 74.8% (836 → 850) |
| 다친 대원 / 교대 | 0.17 → 0.17 | 0.08 → 0.08 | 0.57 → 0.57 | 0.82 → 0.88 |

모두 §9.1 의 범위 안이다(성공+지연 ±4%p, 실패+미해결 +3%p 이하, 한계 시간·방치 보통 +2·극한 +6 이하, 구조율 −3%p 이상, 프리셋의 순서). 손잡이는 돌리지 않았다. 보통 60교대의 유형별 성공률은 화재 70.9 → 70.3% 말고 그대로(무장 76.9 → 76.9%). 극한의 붕괴는 24.5 → 21.5%(23 → 20건 — 2차 붕괴가 잦은 난이도에서 갇힘·구출 중 사고가 걸린다. §9.3-4 의 손잡이를 돌릴 만큼은 아니라고 보았다 — 보통·어려움의 붕괴는 78.3·60.3% 그대로). 강제 20교대의 그 시나리오 줄: `armed/shooter`·`armed/hostage`·`armed/siege`·`armed/bomb`·`armed/riot` 은 기준과 같고(한계 시간·방치 0 → 0 — 완료 조건 4), `fire/arson` 성공 30 → 31, `collapse/std`·`collapse/gasblast`·`collapse/elevator`·`collapse/crane`·`water/std`·`armed/domestic` 같음, `hazmat/std` 부분 8 → 7·실패 0 → 1, `fire/std` 성공 45 → 44·실패 8 → 9, `traffic/bus` 한계 시간 1 → 0, 해일 재난의 `water/evac` 부분 2 → 1·지연 13 → 14, 지진 재난의 `collapse/std` 성공 24 → 22·부분 20 → 25·실패 34 → 31. 부대 규모 1(30교대): 성공 239 → 238, 한계 시간 4 → 5. 지표(보통 40): 교착 후보 0 · 잊힌 사건 0 · C1~C5 0 · 반복 최대 9 — 그대로. 교대당 시간(`sweep 20 --no-metrics`, 사용자 CPU): 20.4초 → 19.2초(차이는 측정 흔들림 안).
- 해시 목록 68교대는 63 이 달라졌다 — 사망 기록의 문구에 원인이 붙어, 숨진 사람이 있는 교대는 모두 다르다(문구를 고치기 전 커밋 `7f5ff79` 에서는 26).

### 단계 3 이 끝난 자리 — 단계 4a 가 이어받을 때

**관문** (단계 3 의 마지막 커밋에서): `npx tsc --noEmit` 통과 · `npm run check` 통과(Vitest 312개 + 건너뜀 1, 파일 13개 / 시드 40개 `검증 통과` — 성공 448 · 부분 55 · 지연 26 · 미해결 12 · 실패 26 으로 단계 2 끝과 같은 분포, 한계 시간 0 · 방치 2) · `sweep 40 --diff hard --check`·`--diff extreme --check` 통과. 완료 조건 3 의 깨지기 쉬운 기존 시험 둘(`tests/sim.test.ts` 의 생활 사건 성공률, `tests/crime.test.ts` 의 폭동)을 따로 돌려 통과. 화면은 고치지 않았지만 `npm run ui-check` 도 한 번 돌렸다 — 여덟 항목 모두 통과(콘솔 오류 0, 되감기 표본 61개 해시 일치, 보고서 해시 `3c453999` = 헤드리스. 사망 기록의 문구가 바뀌어 단계 2 끝의 `2342b7c9` 와는 다르다).

- **기준은 `wf-injuries/base/`** 다(위 "단계 0 — 기준을 다시 쟀다"). 단계 4a 부터는 `node compare.mjs base <새 폴더>` 와 함께 `node compare.mjs s3-full <새 폴더>` 로 단계 3 끝과도 견주면 그 단계만의 변화가 보인다.
- **`hurtResponder`·`hurtHostile` 은 `hurtCas` 옆에 둔다**(`HurtOpts` 는 이미 `tick`·`down` 을 갖고 있다). 대원·용의자 쪽의 기록 줄(`noteRespHurt`·`noteHostileHurt` — `grep -rn "(H1)" src/sim` 에 남은 것)은 그대로다: `blast` 의 대원 쪽, `tickHostiles` 의 피격·흉기·맨손, `tickLane`, `agentHealth`, 해일의 대원, `shootAt` 의 용의자. 다 옮긴 뒤에는 `noteCasHurt`(지금 시험만 쓴다)·`noteRespHurt`·`noteHostileHurt` 를 함께 지울 수 있다.
- **판정 뒤 가리기는 대원·용의자에도 같은 방식으로.** `hurt*` 첫 줄에서 돌아가는 것만으로는 기록이 남는 자리(용의자의 발포 '○○ 피격', `tickLane` 의 SECONDARY_COLLISION, 해일)가 다치지 않은 피해를 적는다 — 자리마다 `I.phase !== 'closed'` 로 가린다(단계 3 이 구조 대상 쪽에 한 것과 같다).
- **`outstanding(a, now)`** 에 `mates` 를 더할 때 인자는 이미 있다. 7)번 블록은 `o.patients > 0` 이면 구급을 찾는다 — 본문 §3.5 의 'rescue' 갈래를 여기에 잇는다.
- **`injuryRng` 의 쓰인 이름**: `'trap'`(`tickCollapse` — 갇히는 사람마다 한 번)·`'extricate'`(구출을 마칠 때마다 확률 한 번, 걸리면 피해 한 번). X6 는 `'trap'` 을 쓰지 않는다(본문 연관 표). 남은 이름 `'fall'`·`'fight'`·`'down'`·`'self'`·`'electric'` 은 아직 아무도 쓰지 않는다.
- **`blast` 의 구조 대상 규칙은 원인이 `'blast'` 일 때만**이다. 5단계가 용의자를 넣을 때 "쓰러진 뒤에는 문턱이 없다"는 `hurtHostile` 의 일이고, 구조 대상 쪽 두 줄은 그대로 둔다.
- 해일에 휩쓸린 구조 대상의 `Injury.ev` 는 여전히 −1 이다(기록이 사람 순회 뒤에 남는다 — `causeEvent` 로 이어진다).
- `tests/injuries.test.ts` 의 도우미: `collapseScene(tag)`(균열 구조물이 있는 붕괴 현장), `extricateOnce(type, variant, hazardMul, closed)`(대원 하나가 곁의 갇힌 사람을 구출 — 작업 항목을 손으로 만들어 `act` 를 돌리는 본), 현장 안의 자리는 `s.staging.x + k, s.staging.y`(대기 지점 곁의 길 — 현장마다 크기가 달라 `staging.y + 6` 같은 자리는 격자 밖일 수 있다).

**§12.1("고칠 파일") 밖에서 고친 곳 — 단계 3**

| 파일 | 함수 · 자리 | 이유 |
|---|---|---|
| `sim/field/commander.ts` | 구조 대상 순회의 `c.mob === 'trapped'` 줄 | 갇힌 줄 알게 된 사람의 `carry`·`escort` 를 거둔다 (위 "다르게 한 곳" 4) |
| `sim/field/rules/air.ts` | `hoistDone` · `tellDispatch` | 호이스트로 건진 뒤의 `bleedCause = 'exposure'`(단계 1·2 의 메모가 적어 둔 것) · `outstanding(op.eye, sim.t)` |
| `sim/field/rules/crime.ts` | `detonate` | `blast` 가 맡게 된 반복문을 지웠다 |
| `sim/field/hazards.ts` | `tickWander`·`creekDrift`·`tickCrush`·`tickLift`·`tickMedical` | 본문 §5.3 의 표에는 있고 §12.1 표에는 없다 — `hurtCasTo` 로 옮기고 판정 뒤에는 돌아가게 |
| `sim/field/executor.ts` | `case 'carry'`(척추 고정판) · `shootAt` 의 `struck` | R1 이 더한 피해 자리를 `hurtCas` 로 · 판정 뒤에는 빗나간 탄이 인질에게 가지 않게 |

### 단계 4a (`87aa05f` · `5f0003d` · `213ea0a` · `7e01781`) — 대원: 모델(4a-1)과 새 방호값(4a-2)

`87aa05f` 가 4a-1(모델), `5f0003d` 가 그 시험 한 줄, `213ea0a` 가 4a-2(새 방호값), `7e01781` 이 변이 확인 뒤의 시험 보강과 지휘관의 한 줄(아래 "다르게 한 곳" 18)이다. 4a-2 는 `injury.protection` 의 갈래 다섯 개와 시험 하나뿐이라 그 커밋만으로 앞뒤를 쟀다(아래 "확인과 수치"). 마지막 커밋은 해시 목록 68교대를 바꾸지 않는다 — 4a-2 에서 잰 수치가 4a 끝의 수치다.

**실제 이름**

| 파일 | 이름 | 비고 |
|---|---|---|
| `field/injury.ts` | `DOWN_AT`(15) · `HURT_AT`(40) · `MATE_RETREAT_BLEED`(**0.09** — 본문 0.06) · `MATE_RETREAT_HP`(70) · `MATE_LETHAL_FROM`(41) · `MATE_FLOOR`(8) · `DOWN_BLEED_CAP`(0.04) · `MATE_BLEED_MAX`(0.12) · `BLEED_PER_DMG` | §2.2·§2.3 의 상수. `MATE_FLOOR`·`MATE_BLEED_MAX`·`BLEED_PER_DMG` 는 본문에 이름이 없던 값(8 · 0.12 · "출혈/피해" 열)이다. 용의자 쪽(`HOSTILE_BLEED`·`HOSTILE_LEFT`·`SELF_HARM`)은 5단계가 더한다 |
| | `hurtResponder(sim, s, I, a, raw, cause, o?)` → 깎인 양 | 본문 §2.7 그대로: 방호(`protection`) → 문턱(`a.hpTick ?? r.health` 가 41 이상이고 0 이하가 되면 8) → 새 상처의 출혈(한 번 피해만: `min(0.12, 출혈 + 계수 × 방호 뒤 피해 × injuryMul)`, `bleed0` 도 그 값, `treatQ = 0`, `bleedCause`) → 체력 15 이하로 남으면 출혈 ≤ 0.04 → 기록(`Injury`)·`a.hurtEv`. 0 이하가 되면 `r.deathCause` 를 그 자리에서 적는다(한 번 피해만). 상태 전이도 문구도 없다. 숨졌거나·판정 뒤거나·차에 탔으면(`left`) 0 을 돌려준다 |
| | `woundTick(sim, r, k)` → 깎인 양 | **본문에 없다.** 상처 악화 한 틱(`r.bleed × k × dt` — 방호·문턱 없음). `r.bleedCause` 의 원인으로 적는다. 판정 뒤에 멈추는 것은 부르는 쪽이 본다 |
| | `protection(sim, r, u, cause, engaging = false)` | §2.4 의 "R1 이 있으면" 열. `u` 는 쓰지 않는다(서명만 본문 그대로). 읽기만 한다 — 아래 "다르게 한 곳" 4 |
| | `hurtF(r)` · `mustRetreat(r)` · `hurtCauseNow(r, t)` | 느려짐(체력 70 → 40 에서 1 → 0.75) · 물러나야 하는 몸(체력 40 아래, 또는 출혈 ≥ 0.09 이고 체력 70 아래 — `brain`·`executor`·`agentHealth` 가 함께 쓴다) · 이 틱에 가장 크게 깎은 원인(없으면 `mainCause`) |
| `field/agents.ts` | `mateFact(sim, s, b, status, src, d)` · `mateStatus(b)` | 본문 §3.2 그대로(`d` 는 필수). `mateStatus` 는 지금 상태 → 사실의 `status`(쓰러짐 `down` · 안전 구역 `safe` · 차에 탐 `evac` · 걷는 중 `hurt`) |
| | `staminaF(r)` = (지구력 항) × `hurtF(r)` · `agentCost(sim, s, a, allowBlockers, escape = false)` · `HURT_HEALTH = HURT_AT` | `escape` 는 끌 수 없는 불도 지나갈 수 있는 칸(비용 +16)으로 친다 — 물러나는 길 전용 |
| `field/sceneManager.ts` | `agentHealth(sim, s, I, a)`(서명 그대로) · `settle`·`fallen`·`causeNote`(안쪽) · **`settleInjuries(sim, s, I)`** | 상태 전이는 `settle` 한 곳. `settleInjuries` 는 `incidents.closeIncident` 가 판정 직전에 부른다 — 아래 "다르게 한 곳" 6 |
| `field/executor.ts` | `moveTo(…, needLos = false, escape = false)`(안쪽) | `retreat` 만 `escape` 를 켠다 |
| `field/commander.ts` | `outstanding(a, now = -1, s?)` → `{ patients, fire, hostile, search, mates }` · `onScene`·`recoveryStuck`(안쪽) · `needFor` 의 `rescueMate` | `mates` = 믿음상 쓰러져 있는(숨지지 않은) 동료. `s` 를 주면 자기 부대와 함께 떠난 동료를 뺀다 |
| `field/brain.ts` | `hurtTold`(안쪽 WeakSet) | 부상 후퇴 문구는 현장의 개체마다 한 번 |
| `types.ts` | `ProblemCode 'RESPONDER_KILLED'` · `Responder.bleedCause` | 뒤의 것은 본문 §2.1 에 없다 — "다르게 한 곳" 2 |
| `difficulty.ts` · `debrief.ts` | `Tuning.injuryMul`(0.75 · 0.9 · 1 · 1.12 · 1.25 — 심각도) · `PROBLEM_LABEL.RESPONDER_KILLED`('대원 순직') · `order` 맨 앞 · 문장 틀 `순직: <detail 들>.` | 판정의 점수(§7.1)와 `IncidentResult` 의 새 칸은 6단계 |

**대원의 피해 자리 — `hurtResponder` 로 옮긴 곳** (단계 1 이 붙여 둔 `const hp0 …`·`noteRespHurt` 줄을 지웠다. `noteRespHurt` 는 없앴다. 난수는 예전 자리·예전 순서 그대로 뽑고 뽑은 값만 넘긴다)

| 파일 · 함수 | 넘기는 것 | 그 자리가 남기는 기록(= `o.ev`) |
|---|---|---|
| `hazards.blast` (대원 쪽) | `dmg × (1 − d/(r+1))`, 원인 = `blast` 또는 `crush`(천장·2차 붕괴). 숨진 대원은 건너뛴다 | 폭발·붕괴 기록(부른 쪽의 `ev`) |
| `hazards.tickHostiles` 총격 | `s.rng.range(25, 41)` (방호 `armorOf × 0.6` 은 `hurtResponder` 가 뺀다), `{ by: 용의자, byKind: 'hostile' }` | '○○ 피격 (엄폐 …).' — 기록을 먼저 남기고 넘긴다 |
| `hazards.tickHostiles` 흉기·맨손 | `s.rng.range(8, 16) × (칼 1.4 · 맨손 0.6)`, 원인 `stab`·`blunt`, `{ by, byKind }` | **새 기록** '○○ 피습 (흉기).' / '○○ 피습 (맨손).'(RESPONDER · `hazard` · imp 2) |
| `hazards.tickLane` 2차 사고 | `s.rng.range(28, 44)`, 원인 `vehicle`. 숨진 대원은 치지 않는다 | SECONDARY_COLLISION |
| `rules/disaster.ts` 해일 | `rng.range(10, 22)`, 원인 `drown` | '해일이 덮침' |
| `sceneManager.agentHealth` | 연기 `1.3 × smoke × dt`(원인 `smokeCause(s)`), 불 `9 × fire × dt`(`burn`) — 둘 다 `{ tick: true }`. 그 뒤 `woundTick(sim, r, 1)` | 없음(매 틱 피해에는 원인 기록이 없다) |

대원의 체력을 직접 고치는 줄은 `injury.ts` 의 두 줄(`hurtResponder`·`woundTick`)과 순직 처리(`sceneManager.fallen` 의 `r.health = 0`)뿐이다 — 시험이 글자로 지킨다.

**상태 전이와 새 규칙** (§3.2·§3.4-1·§3.5 — 본문 그대로인 것은 줄만 적는다)

- **`tickScene`**: 1) 환경 단계 앞에서 그 현장의 차에 타지 않은 모든 대원에게 `a.hpTick = r.health`.
- **`agentHealth`** 의 순서: `left`·숨짐·판정 뒤면 돌아감 → (R1) 공기 소모와 기록 → 연기·불(`hurtResponder` 매 틱) → 상처 악화(`woundTick` — **안전 구역으로 물러난 `withdrawn` 대원은 건너뛴다**, 4b 가 푼다) → `settle`.
- **`settle`**: 체력 ≤ 0 → 순직(`fallen`). 체력 ≤ 15 이고 `r.status !== 'down'` → 쓰러짐(`r.tDown ??= sim.t`, `withdrawn` 이면 그 자리에 그대로·기록 없음, 아니면 RESPONDER_HURT '○○ 대원 쓰러짐 (원인)' imp 3). `r.status === 'ok'` 이고 `mustRetreat` → 부상(RESPONDER_HURT '○○ 대원 부상 (원인)' imp 2 + 본인의 `mate` 사실 `'hurt'` — `learnQuiet`). 원인 기록(`causes`)은 `a.hurtEv`(없으면 비운다), 원인 낱말은 `hurtCauseNow`.
- **순직**(`fallen`): `r.dead`·`tDead`·`health = 0`·`status = 'down'`·`deathCause`(= `hurtResponder` 가 적어 둔 것 → 이 틱의 가장 큰 항 → `mainCause`), 하던 일을 놓고, `a.status` 는 `withdrawn` 이면 그대로·아니면 `down`, `a.label = ''`. `RESPONDER_KILLED` 의 detail: '○○ 대원(호출부호) — 원인' + (안전 구역이면 ', 안전 구역에서 후송을 기다리던 중' / 쓰러진 적이 있으면 ', 쓰러진 뒤 n초 동안 구조되지 못함' 또는 동료가 끌고 나오던 중이면 ', 쓰러진 뒤 n초 만에 구조되던 중'). 기록 문구 '○○ 대원 생체 반응 소실.'(SYSTEM · imp 3).
- **후퇴**(`brain.dangerScore`·`think`, `executor` `retreat`): `mustRetreat` 로 판단한다. 대기 지점에 닿으면 `withdrawn` + 본인의 `mate` 사실 `'safe'`(`learnQuiet` 바로 뒤 `flushOutbox`). **물러나는 길은 불길도 뚫는다**(`escape`): 평소 길이 없으면 끌 수 없는 불을 지나는 길을 찾고, 길 위의 불 앞에서 멈추지 않는다(관창을 든 대원은 지금처럼 끄며 지나간다) — 지나는 동안의 화상은 입는다. 그 길조차 없으면(사방이 막혔다) 다친 대원은 '퇴로가 막혀 나갈 수 없습니다. 길이 열리기를 기다립니다.'(RESPONDER · `radio` · imp 2)를 한 번 남기고 5초마다 다시 찾는다(`t.wait = 5`) — 제자리에서 `withdrawn` 이 되지 않는다. 위험해서 물러나던(다치지 않은) 대원은 예전처럼 그만두고 다시 판단한다.
- **동료를 보는 눈**(`perceive`): 쓰러진 동료는 시야 안이면, 안전 구역으로 물러난 동료는 2칸 안에서만 본다. 이미 숨진 줄 알면 건너뛴다. 3칸 밖에서는 상태(`status`)가 달라졌을 때만 새 소식으로 친다(가까이서 본 보고를 먼 관찰이 덮어쓰지 않게). 쓰러진 것·숨진 것은 말로(`learn`), 안전 구역의 동료는 소리 없이(`learnQuiet`). `significant` 의 `mate`: `status`·`dead`·`band`·`tq`.
- **쓰러진 동료의 구조**(`rescueMate`): 지휘관은 쓰러진 줄 알면 0.97·2명, 숨진 줄 알면 0.55. 더는 쓰러져 있지 않다고 알거나 그 대원이 자기 부대와 함께 떠났으면(`onScene` — 조직이 아는 부대의 출발) 거둔다. 자격(`fitFor`): 자기 자신은 0, 안전 확보 전의 무장 현장은 경찰만, 믿음 속 위치가 불·가스·붕괴 위험 구역(실내)이면 공기호흡기를 멘(공기가 되는) 대원만. 실행기: 대상이 `down` 이 아니면 본 대로 강제 보고(`reportDone` — 숨진 줄 알던 것을 먼 관찰로 되돌리지 않는다)하고 끝, 물 칸이면 '물가 대기'로 기다림, 옮긴 뒤의 문구는 숨졌으면 '순직한 ○○ 대원을 안전 구역으로 옮겼습니다.'. `needFor('rescueMate')` = 교전 중이면 `law`, 아니면 `rescue`.
- **종료 판단**(`canClose`): 쓰러진(숨지지 않은) 동료가 현장에 남아 있으면 끝내지 않는다. 숨진 동료의 수습(0.55)은 맡을 수 있는 활동 대원이 있을 때만 종료를 막는다(`recoveryStuck` — 아래 "다르게 한 곳" 10).
- **현장이 비었을 때**(7번 블록, `rules/air.ts` 의 `tellDispatch`): `outstanding(…, sim.t, s).mates > 0` 이면 끝내지 않고 부대를 찾는다. 7번 블록이 찾는 부대 — 용의자가 남았으면 `law`, 불이면 `suppression`, 구조 대상이 없고 불·가스·붕괴 현장이면 `rescue`(공기호흡기를 멘 대원이 들어가야 한다), 그 밖은 `ems`. `tellDispatch`(헬기만 왔던 현장)는 찾는 부대를 고르는 식은 그대로 두고(갇힌 사람이 있으면 `rescue`, 아니면 `ems`) 문구만 '… 아직 쓰러진 대원이 남아 있습니다.'로 가린다.
- **지휘권 승계**(4번 블록): 승계자가 옛 지휘관의 `mate` 사실을 갖고 있으면 '○○ 대원 순직|쓰러짐|부상으로 지휘 불능. 지휘권을 승계합니다.', 없으면 예전 문구.
- **판정 뒤에는 멈춘다**: `hurtResponder` 첫 줄, `agentHealth` 첫 줄. 기록이 남는 자리는 스스로 가린다 — 용의자의 총격(`hit` 을 정하는 식. 난수는 그대로 뽑는다), 흉기·맨손(조건), 2차 사고(치기 직전). 폭발·해일은 사람 순회 밖에서 기록하므로 가릴 것이 없다.

**본문과 다르게 한 곳**

1. **출혈로 물러나는 문턱 `MATE_RETREAT_BLEED` 를 0.06 → 0.09 로 올렸다**(§9.3 의 손잡이 1번 — 체력 문턱 70 은 그대로). 0.06 에서 재 보니(4a-1 만, 60교대) 보통의 다친 대원이 0.17 → 0.55/교대, 무장 사건 성공률 76.9 → 65.4%(−11.5%p — §9.1 은 −8%p 까지), `armed/domestic` 성공 14 → 11/20, 어려움 2.07·극한 3.6/교대(§9.1 은 극한 ≤ 2)였다. 원인은 둘 — 총알 한 발(순찰 경관의 36%)과 **흉기 세 번**(자상의 출혈 0.0015 × 40 = 0.06)이다. 시험판 넷(`scratchpad wf-injuries/s4a/var/`): 0.06/60 → 0.53·극한 2.82, 0.08/70 → 0.25·2.37, **0.09/70 → 0.27·2.0**, 0.09/60 → 0.27·1.9. 0.09 면 총알은 두 번째 명중에(한 발의 출혈은 보통 난이도에서 0.084 이하), 흉기는 체력 40 아래가 되기 전에는 물러나지 않는다(0.0015 × 60 = 0.09) — 본문 §2.2 의 "순찰 경관은 큰 한 발에"는 지켜지지 않는다(어려움·극한에서는 출혈 배율과 낮은 방호 때문에 한 발에 물러나는 일이 남는다).
2. **`Responder.bleedCause` 를 더했다**(본문 §2.1 의 대원 칸에 없다 — 구조 대상·용의자에는 있다). 상처 악화를 어느 원인으로 적을지, 그 악화로 숨졌을 때의 원인이 필요하다. 명부의 두 대원 리터럴(`createRoster`·`createAidUnit`)에 같은 순서로 넣었다.
3. **상처 악화를 `woundTick` 으로 뺐다**(본문은 `agentHealth` 안의 한 줄). 대원의 체력을 고치는 줄을 `injury.ts` 에만 두려는 것 — 시험이 글자로 지킨다.
4. **방호의 장비 판정은 `hasKit`**(본문은 `kitWorks`). 방호 장비(조끼·방화복·공기호흡기·방호복)는 고장 추첨을 받지 않아 둘의 값이 같고, R1 의 코드(`agentHealth`·`blastFactor`)도 `hasKit` 이었다. `protection` 이 기록을 남기지 않으므로 화면·시험이 불러도 된다. **잔해(`crush`)의 폭발물 방호복 0.65 는 남겼다**(본문 "R1 이 있으면" 열에는 방화복 0.3·조끼 0.1 만 있다 — 천장·2차 붕괴가 `blast` 로 주던 그때의 식이 `blastFactor` 였다). **폭발(`blast`)에 경찰 조끼의 몫은 없다**(본문 "새로" 열의 `u.armor × 0.3` 은 R1 열에 없다 — `1 − blastFactor` 그대로).
5. **쓰러짐 검사는 `r.status !== 'down'`**(본문·예전 코드는 `a.status !== 'down'`). 안전 구역의 `withdrawn` 대원이 매 틱 그 갈래에 다시 들어오지 않는다(`r.tDown ??=` 과 겹치는 안전장치 — 둘 가운데 하나만 있어도 결과가 같다).
6. **판정 직전에 밀린 전이를 마친다**(`settleInjuries` — 본문에 없다). 한 번 피해는 그 틱의 환경 단계에서 체력을 깎고 전이는 뒤의 대원 단계가 한다. 그 사이에 사건이 닫히면(같은 틱에 지휘관이 종료를 선언했다, 세계 규칙이 닫았다) 판정 뒤에는 전이가 없으므로 "체력 0 이하인데 숨지지 않은 대원"·"체력 8 인데 멀쩡한(`ok`) 대원 — 다음 현장에 내려 거기서 쓰러진다"가 남는다. `closeIncident` 첫머리에서 대원마다 `settle` 을 한 번 돌린다(새 피해 없음, 기록의 시각 = 종료 시각, 판정에 들어간다).
7. **길이 없는 후퇴**(앞 작업자의 메모가 4a 에 넘긴 것 — 불 속에서 제자리 `withdrawn` 이 되던 대원): 본문 메모의 예("`down` 처럼 구조 대상으로 삼는다")가 아니라 **불길을 뚫고 나가게** 했다. 재 보니 그런 대원은 모두 끌 수 없는 불에 길이 막힌 소방대원이었고(단계 3 끝, 40교대: 보통 0 · 어려움 5 · 극한 12명 — 어려움 2·극한 12명은 그 자리에서 체력 하한 1 까지 탔다. 4a 에서는 15초 안에 숨진다), 15초 안에 닿을 구조는 없다. 뚫고 나가게 한 뒤 60교대씩에서 제자리 `withdrawn` 0 · '퇴로가 막혀' 0건이다. 사방이 막힌 경우에만 기다린다.
8. **`outstanding().mates` 는 쓰러진(숨지지 않은) 동료만 센다**(본문 §3.5 는 여기에 "믿음상 `mateNeedsHospital` 인데 `evac` 이 아닌 수"도 더한다). 처치·후송(`treatMate`)이 없는 4a 에서 그 항을 넣으면 현장이 비었을 때 할 일이 없는 구급 부대를 부르고, 60초 안에 오지 않으면 예전에는 '종료'였던 사건이 '방치'로 닫힌다. **4b 가 `treatMate` 와 함께 더한다.** 그래서 `mateNeedsHospital`·`needsHospital` 도 아직 `injury.ts` 에 없다.
9. **`outstanding(a, now, s?)` 의 셋째 인자와 `onScene`**: 낡은 믿음을 조직이 아는 사실로 거른다. 쓰러진 줄 알던 동료가 자기 부대와 함께 떠나면(5번 블록이 그 부대의 대원을 모두 `left` 로 만든다) 아무도 그 사실을 보고하지 않는다 — 그대로 두면 지휘관은 닿을 수 없는 구조를 계속 내고, 현장이 비었을 때 없는 사람 때문에 부대를 찾는다.
10. **닿을 수 없는 수습은 종료를 막지 않는다**(`recoveryStuck` — 본문 §12.2-4 는 "닿을 수 없으면 `LIMIT` 으로 끝난다, 건수를 본다"). 숨진 줄 아는 동료의 `rescueMate` 가 열려 있는데 맡은 사람이 없고, 지금 현장의 활동 대원 누구도 맡을 수 없으면(자격이 없거나 방금 닿지 못했다) 그 항목은 `canClose` 를 막지 않는다. 숨진 동료 하나 때문에 다 끝난 사건이 한계 시간까지 가지 않는다(부대가 떠날 때 함께 복귀한다 — 본문 §3.5 와 같은 생각). 쓰러진(숨지지 않은) 동료는 예전처럼 막는다.
11. **문턱은 체력을 올리지 않는다**: `after = min(지금 체력, 8)`. 같은 틱의 앞선 피해로 이미 8 아래인 대원이 한 번 더 맞아도 8 로 오르지 않는다(단계 3 의 `hurtCasTo` 와 같은 원칙).
12. **`mateFact` 의 `band`**: 숨진 줄 모르는 관찰(2칸 밖)은 체력이 0 이어도 위중(2)까지만 적는다(3 으로 적으면 `dead` 칸이 거짓인데 중증도로 죽음이 샌다).
13. **부상 후퇴 문구('부상으로 더 이상 임무 수행 불가. 후퇴합니다.')는 현장의 개체마다 한 번**(`brain.ts` 의 `hurtTold`). 후퇴하다 길 위의 불을 끄던 관창수가 물이 떨어지면 후퇴 임무가 실패로 끝나고 다시 고르는데, 그때 같은 문구가 또 나갔다(`tests/loops.test.ts` 가 사건·대원마다 1회로 지킨다). 그 문구의 원인 기록도 `a.hurtEv` 가 있으면 그것으로.
14. **순직 detail 의 갈래를 하나 더했다**: 동료가 끌고 나오던 중이면 '쓰러진 뒤 n초 만에 구조되던 중'. 안전 구역의 갈래는 쓰러진 적(`tDown`)이 없어도 붙인다.
15. **순직한 대원은 이송 중 처치에 세지 않는다**(`resources.tickUnits` — R1 은 함께 탄 대원 가운데 가장 좋은 의료 장비를 본다).
16. **시험 11-4 ③ 의 `IncidentResult.respondersKilled === 1`** 은 넣지 않았다 — 그 칸은 6단계가 채운다(§10 표). 6단계 전까지 `evaluate` 는 순직 대원을 쓰러진 대원으로 센다(`status === 'down'` — 벌점 1.5).
17. 4a-2 의 화학 보호복(`toxic` 0.95)은 역할(`r.role === 'hazTech'`)로 가리고, 공기가 떨어지면 0 이다. 추락·감전의 방호(방화복 0.2·0.4)는 켰지만 부르는 곳은 4c 부터다.
18. **숨진 동료의 수습 때문에 지원을 부르지 않는다**(`commander` 의 "맡을 사람이 없는 작업" 블록 — 마지막 커밋): 쓰러진 동료를 구하러 갈 사람이 없으면 `needFor('rescueMate')` 의 부대를 부르지만, 숨진 줄 아는 동료의 수습(0.55)은 부르지 않는다(10번과 같은 생각 — 맡을 사람이 생기면 하고, 없으면 두고 끝낸다).

**시험** (`tests/injuries.test.ts` — 단계 4a 뒤 97개(단계 3 까지의 58개 + 39개), 25초 남짓. 파일 끝의 "단계 4a: 대원" 아래)

- 3 방호(셋): 총상 특공 < 순찰 < 구급·방패, 화상·연기·폭발·잔해의 값이 예전 식과 같다(상대 오차 1e-9)·빈 공기통, 4a-2 의 새 값(자상·유독 가스·잔해·추락·감전·장비 손잡이).
- 4 문턱(다섯): ① 100 에 200 → 8·출혈 0.04·다음 틱에 쓰러짐과 RESPONDER_HURT, ② 같은 틱 두 번(+ 세 번째도 오르지 않는다), ③ 30 에 60 → 순직·RESPONDER_KILLED 하나·그 뒤로 바뀌지 않음, `hpTick`·매 틱 피해, 새 상처의 출혈(계수·방호 뒤·상한·처치 되돌림·`injuryMul`).
- 상태 전이(여섯): `mustRetreat`·`hurtF`·`staminaF`·`moveSpeed`, 부상(문구·원인 기록·본인의 보고), 쓰러짐(`tDown` 한 번·안전 구역), 순직의 detail 셋과 보고서 문장, 상처 악화(`withdrawn` 멈춤), 판정 뒤와 `closeIncident` 의 밀린 전이.
- 다치는 자리(넷): 폭발(방호·숨진 대원), 2차 사고(숨진 대원·판정 뒤), 흉기·맨손 피습의 기록, 대원의 체력을 직접 깎는 줄이 없다.
- 동료의 상태(넷): `mateFact` 의 거리 조건, `perceive`(쓰러진 동료·숨진 것은 곁에서만·되돌리지 않음), 물러난 동료는 2칸·소리 없이, `rescueMate` 의 자격.
- 지휘관(다섯): 0.97 → 0.55 → 거둠·떠난 동료·`outstanding`, 종료 판단과 닿을 수 없는 수습(맡을 사람이 있으면 막는다), 구하러 갈 사람이 없을 때의 지원 요청(숨진 동료는 부르지 않는다), 7번 블록(구급·구조·모르면 종료), 승계 문구 넷.
- 실행기·판단(여섯): 후퇴(출혈로도·안전 구역 보고), 판단(출혈로 후퇴를 고른다·부상 후퇴 문구는 한 번·원인 기록), 불길을 뚫는 길, 사방이 막혔을 때, 동료 구조와 수습, 강제 보고·`evac`·물가 대기.
- 8(둘): `responders[…].(health|dead|bleed|care|tDown)` 이 `commander`·`dispatch`·`orders`·`brain` 에 없다(앞 작업자가 남긴 둘째 정규식 — `commander.assign` 의 두 곳을 `status === 'injured'` 로 바꿨다), import 검사.
- 9(둘): 숨진 대원 ↔ RESPONDER_KILLED 하나·시각 = `tDead` ≤ `closedAt`·원인의 기록 줄·SECONDARY_COLLISION 의 대원은 그때 살아 있었다, 교대 끝에 "0 이하인데 살아 있는"·"쓰러질 체력인데 `ok`" 대원이 없다(극한 둘 포함).
- 5: 보통 24교대에서 순직 ≤ 1, 다친 대원 교대당 0.1~0.7. 11: 위협 5·심각도 5·장비 1 의 교대 재현성(대원의 부상 기록까지).
- 장부 시험의 대원 갈래를 고쳤다(하한 1 대신 "순직한 대원은 넘친 만큼만"). 단계 3 의 "사망 기록의 수 = 숨진 구조 대상의 수" 검사는 기록의 종류(`casualty`)로 가리게 고쳤다 — 순직 기록도 '생체 반응 소실' 이라고 쓴다(`5f0003d`).
- 변이 확인(`scratchpad wf-injuries/s4a/mutate4a.py` — 99가지: `hurtResponder` 19 · 방호 4 · 전이 24 · 다치는 자리 7 · 동료의 상태 11 · 지휘관 9 · 실행기와 판단 14 · 뒤에 더한 것 4 · 새 방호값 7. 작업 폴더가 아니라 복사본에서 돌린다 — `mutcopy.sh`): 95가지가 실패로 잡힌다. 살아남는 넷은 결과가 같은 변이다 — 문턱의 `min(지금 체력, 8)`(바로 아래의 "체력이 줄 때만" 검사가 같은 일을 한다), `r.tDown ??=` 와 쓰러짐 검사의 `r.status`(둘이 서로 겹치는 안전장치라 하나만 빼면 같다), `canClose` 의 "쓰러진 동료가 있으면 끝내지 않는다" 줄(그 동료의 열린 `rescueMate` 가 먼저 막는다). 처음 돌렸을 때 살아남았던 넷(먼 관찰의 되돌림, 맡을 수 있는 수습, 넘겨받은 순직 원인, 판단의 출혈 조건)은 시험을 더해 잡았다.

**확인과 수치** (scratchpad `wf-injuries/a1-full/`(4a-1)·`a2-full/`(4a-2) — 각 폴더의 `COMPARE-base.txt`·`COMPARE-s3.txt`, `a2-full/COMPARE-a1.txt` 가 4a-2 만의 변화. 도구는 `s4a/`: `diag_resp.ts`(대원의 부상 경과)·`diag_to.ts`(한계 시간으로 끝난 사건)·`diag_inc.ts`(한 사건의 대원들)·`variant.sh`(상수만 바꾼 시험판))

| 기준 → 4a-1 → 4a-2 (60교대) | 보통 | 쉬움 | 어려움 | 극한 |
|---|---|---|---|---|
| 성공 | 80.5 → 80.0 → 80.3% | 87.6 → 86.8 → 87.1% | 63.0 → 61.7 → 62.6% | 36.4 → 35.0 → 35.2% |
| 성공+대응 지연 | 84.7 → 83.8 → 84.4% | 89.4 → 88.8 → 89.1% | 69.1 → 67.8 → 68.9% | 48.3 → 45.8 → 45.9% |
| 실패+미해결 | 6.0 → 6.3 → 6.3% | 4.5 → 4.5 → 4.5% | 15.9 → 16.2 → 15.9% | 34.1 → 35.2 → 35.4% |
| 한계 시간 + 방치 (+ 무대응) | 4 → 4 → 4 | 1 → 1 → 1 | 15 → 17 → 17 (+1) | 40 (+1) → 45 → 45 |
| 구조율 (숨짐) | 94.1 → 93.9 → 94.0% (99 → 104 → 102) | 95.9 → 95.8 → 95.8% | 87.1 → 87.0 → 87.0% | 75.2 → 74.7 → 74.6% |
| 다친 대원 / 교대 | 0.17 → 0.27 → **0.15** | 0.08 → 0.13 → 0.10 | 0.57 → 1.02 → 0.77 | 0.82 → 2.0 → **1.8** |
| 무장 사건 성공률 | 76.9 → 73.8 → 76.9% | | 60.0 → 54.2 → 58.8% | 38.7 → 31.1 → 32.7% |

- 모두 §9.1 의 범위 안이다(보통: 성공+지연 ±4%p, 실패+미해결 +3%p 이하, 한계 시간·방치 +2 이하, 구조율 −3%p 이상, 다친 대원 0.15~0.5, 무장 −8%p 이상 / 극한: 한계 시간·방치 +6 이하(+5 — 닿아 있다), 다친 대원 ≤ 2 / 프리셋의 순서). 4a-2(자상의 조끼)가 흉기 부상을 줄여 보통의 다친 대원은 기준(0.17)과 비슷한 0.15 로 돌아왔다 — 범위의 아래 끝이다. 뒤 단계(4b 의 풀린 출혈, 4c 의 몸싸움·추락)가 늘리는 쪽이라 손잡이를 더 돌리지 않았다.
- 대원의 경과(60교대씩, `diag_resp.ts` — 4a-2 끝): 보통 RESPONDER_HURT 9건(총상 5 · 자상 3 · 화상 1), 쓰러짐 0, **순직 0**. 어려움 47건(총상 29 · 화상 8 · 자상 3 · 차량 4 · 연기 3), 쓰러짐 1(29초 뒤 구조), 순직 0. 극한 109건(총상 59 · 자상 24 · 차량 15 · 화상 7 · 그 밖 4), 쓰러짐 2, 순직 2(0.033/교대 — 총상 1: 다쳐 물러나던 대원이 두 발을 더 맞았다, 화상 1: 불 속을 물러나다 쓰러져 8초 뒤). §3.3 의 목표(보통 순직 ≤ 0.02·쓰러짐 ≤ 0.1, 어려움 ≤ 0.05, 극한 ≤ 0.15) 안이다 — 4a 에서는 물러난 대원의 출혈이 멈춰 있어 순직이 거의 없다. 4b 가 출혈을 풀면 다시 잰다.
- 강제 20교대의 그 시나리오 줄(완료 조건 4 — 한계 시간·무대응·방치): `armed/shooter` 0·0·0 → 0·0·0(성공 21 → 18, 부분 2 → 5), `armed/hostage` 0 → 0(18 · 2 그대로), `armed/siege` 0 → 0(성공 15 → 12, 부분 4 → 8), `armed/riot` 0 → 0(성공 19 → 20), `armed/bomb` 그대로(21 모두 성공), `armed/domestic` 성공 19 그대로(한계 시간·방치 0), `fire/arson` 성공 30 → 31, `traffic/bus` 한계 시간 1 → 1, 해일의 `water/evac` 성공 32 → 31, 지진의 `collapse/std` 성공 24 → 22·실패 34 → 34. 부대 규모 1(30교대): 성공 239 → 233, 한계 시간 4 → 7·방치 2 → 2(늘어난 셋은 화재 — 그 현장들에 다친 대원은 없었다. 앞선 사건에서 갈라진 다른 전개다).
- 완료 조건 3 의 깨지기 쉬운 기존 시험 둘(`tests/sim.test.ts` 생활 사건 성공률, `tests/crime.test.ts` 폭동)과 `tests/loops.test.ts`·`tests/causality.test.ts`·`tests/crews.test.ts` 는 4a-1·4a-2·마지막 커밋의 관문에서 모두 통과했다(348 · 349 · 351개, 건너뜀 1). `sweep 40 --diff hard --check`·`--diff extreme --check` 도 통과한다.
- 지표(보통 40): 교착 후보 0 · 잊힌 사건 0 · C1~C5 0 · 반복 최대 9 — 그대로. 장부(`diag_ledger.ts` 69교대, 대원 4,566): 불일치 0.
- 한 교대를 읽어 본 것(`sweep 1 --log`): 어려움 S13 #10 — 피격 → 피격·부상 → 후퇴 → 피격·쓰러짐(문턱) → 승계('… 부상으로 지휘 불능') → 동료가 발견 → 29초 뒤 안전 구역. 극한 S22 #17 — 피격 둘·부상 → 후퇴 중 피격 둘 → '생체 반응 소실'(이미 다친 대원이 한 번 더 크게 다쳤다) → 멀리서 '쓰러짐 — 구조 필요' → 곁에서 '생체 반응 없음' → '순직한 ○○ 대원을 안전 구역으로 옮겼습니다.' → 보고서 '순직: 임하준 대원(특공1) — 총상.'.
- 교대당 시간(`sweep 20 --no-metrics`, 기준 사본과 번갈아 세 번씩, 사용자 CPU): 기준 19.9 · 20.5 · 22.4초 → 4a 끝 19.6 · 22.9 · 22.0초(평균 20.9 → 21.5초, 바퀴마다 ±8% 로 흔들린다 — 차이는 그 안이다). `settle` 은 대원마다 매 틱 비교 두세 번이고, 원인 낱말(`hurtCauseNow`)은 전이가 일어날 때만 찾는다.
- 해시 목록 68교대 가운데 단계 3 끝과 다른 것은 64(기준과는 68 모두)다 — 다친 대원의 느려짐(`hurtF`)과 방호 식의 끝자리가 거의 모든 교대에 닿는다.

### 단계 4a 가 끝난 자리 — 단계 4b 가 이어받을 때

**관문** (마지막 코드 커밋 `7e01781` 에서): `npx tsc --noEmit` 통과 · `npm run check` 통과(Vitest 351개 + 건너뜀 1, 파일 13개 — `tests/injuries.test.ts` 97개 / 시드 40개 `검증 통과` — 성공 446 · 부분 56 · 지연 26 · 미해결 13 · 실패 26, 한계 시간 0 · 방치 2, 다친 대원 0.23/교대). 4a-1(`87aa05f`)·4a-2(`213ea0a`)에서도 각각 통과했다(4a-1: 성공 444 · 부분 58, 다친 대원 0.33/교대).

- **물러난 대원의 출혈을 푼다**: `agentHealth` 의 `if (a.status !== 'withdrawn') woundTick(sim, r, 1);` 한 줄이 4a 의 임시 조치다. §2.6 의 배율(현장·끌려가는 중 1, 처치를 받고 안전 구역에 있으면 0.6, `left`·`aboard`·`hospital` 부터 멈춤)로 바꾼다. 풀면 안전 구역에서 기다리다 숨지는 대원이 생긴다 — `diag_resp.ts` 의 '안전 구역에서' 수와 순직 빈도(§3.3)를 다시 잰다.
- **`outstanding().mates` 에 병원이 필요한 동료를 더한다**(위 "다르게 한 곳" 8). `mateNeedsHospital`·`needsHospital`·`treatEffect`·`LIGHT_WORK`·`seatsUsed` 는 아직 없다.
- **`commander.assign` 의 두 줄**(`sim.responders[b.rid].status === 'injured'` 이면 건너뜀): 4a 에서는 `injured` 대원이 모두 후퇴 중이거나 물러나 있어 맞다. 가벼운 일로 돌아온 대원(§3.6a)에게 지시하려면 이 줄을 고친다(예: `&& !b.lightBack` 이 아니라 "후퇴 중인가"로). `settle` 이 전이의 자리이므로 "가벼운 일로 복귀"도 거기에 넣는다.
- **`mate` 사실**: 값은 `MateBelief` 다(옛 `{ x, y, status }` 를 만드는 곳은 없다). `since` 는 그 사실을 만든 시각이다 — 같은 상태로 다시 볼 때는 `perceive` 가 새 사실을 만들지 않으므로(달라진 것이 없으면 건너뛴다) 대개 그 상태가 된 시각이지만, 확인 무전(`rollcall`)·강제 보고는 새로 만든다. 20초 규칙이 `since` 를 쓸 때 본다. `'light'` 의 문구('○○ 대원 가벼운 임무로 복귀')는 `mateFact` 에 이미 있다.
- **5번 블록**은 고치지 않았다: 부대가 떠날 때 그 부대의 대원은 다친 사람·숨진 사람까지 모두 `left` 가 된다(병원으로 가지 않는다). 운용 중단 문구도 예전 그대로다('대원 전원 부상으로 운용 중단.' — 순직한 대원만 남은 부대에도 이 문구가 나온다).
- **다쳤지만 물러나지 않은 대원은 현장에 있는 동안 계속 피를 흘린다**(본문 §2.6 그대로 — 배율 1). 출혈 0.09 아래의 상처를 입고 `ok` 로 남은 대원은 다음 현장들에서 체력이 40 아래로 내려가 그 사건의 RESPONDER_HURT 가 된다(60교대에 보통 0 · 어려움 0~2 · 극한 3~6건 — 교통·가스 사건의 '부상 (자상)'·'부상 (총상)'). `treatMate` 의 대상을 정할 때 이 대원들(믿음에 `mate` 사실이 없다 — 본인이 알리지 않는다)을 넣을지 정한다.
- **`evaluate`**: 순직 대원은 `status === 'down'` 이라 지금은 쓰러진 대원으로 센다(1.5). 6단계가 §7.1 의 셈으로 바꾼다. `buildReport` 의 대원 목록은 순직 대원을 '중상'으로 적는다(6단계).
- **기록 문구**: 새 문구는 '○○ 피습 (흉기|맨손).' · '○○ 대원 생체 반응 소실.' · '순직한 ○○ 대원을 안전 구역으로 옮겼습니다.' · '퇴로가 막혀 나갈 수 없습니다. 길이 열리기를 기다립니다.' · '○○ 대원 순직|쓰러짐|부상으로 지휘 불능. 지휘권을 승계합니다.' · (헬기만 왔던 현장) '… 아직 쓰러진 대원이 남아 있습니다. 지상 부대를 찾습니다.'. RESPONDER_HURT 의 detail 은 '○○ 대원 부상 (원인)'·'○○ 대원 쓰러짐 (원인)'(예전 '중상'). `scripts/metrics.ts` 의 `PHRASE` 는 고치지 않았다(`PROBLEM_SYS` 에는 `RESPONDER_KILLED` 가 이미 `crew` 로 있었다).
- **`injuryRng` 의 쓰인 이름**은 그대로 `'trap'`·`'extricate'` 둘이다(4a 는 새 확률을 만들지 않았다).
- `tests/injuries.test.ts` 의 도우미(파일 끝): `crewScene(seed, type, variant, kinds)`(부대를 내려 세우고 `of(kind, role)` 로 대원을 고른다) · `fresh(sim, a, hp)`(다친 적 없는 상태로) · `tickOnce` · `mark`(원인 기록으로 쓸 기록 하나) · `rel`(상대 오차 1e-9) · `workItem`.

**§12.1("고칠 파일") 밖에서 고친 곳 — 단계 4a**

| 파일 | 함수 · 자리 | 이유 |
|---|---|---|
| `sim/incidents.ts` | `closeIncident` 첫머리 | `settleInjuries` 한 줄 — 판정 직전에 밀린 대원의 전이를 마친다 ("다르게 한 곳" 6) |
| `sim/resources.ts` | 명부의 두 대원 리터럴 · `tickUnits` 의 이송 중 처치 | `bleedCause` 칸 · 순직한 대원은 처치에 세지 않는다 |
| `sim/field/rules/air.ts` | `tellDispatch` | `outstanding(…, s)` 의 `mates` 와 문구 (7번 블록과 같은 판단) |
| `sim/field/agents.ts` | `agentCost` 의 `escape` | 물러나는 길 ("다르게 한 곳" 7) |
| `sim/field/executor.ts` | `moveTo` 의 `escape` · `act` 의 물러난 대원 이름표 | 같음 · 숨진 대원의 이름표를 비운다 |
| `sim/field/commander.ts` | `assign`(두 줄) · `canClose` · `needFor` · 지원 요청의 '대원 부상' 줄 | 남의 체력 대신 조직이 아는 상태 · 닿을 수 없는 수습 · `rescueMate` 를 맡을 부대 · 숨진 동료만 남았으면 구급을 부르지 않는다 |
| `sim/field/brain.ts` | `think` 의 부상 후퇴 문구 | 한 번만, 원인 기록은 `a.hurtEv` |
| `sim/types.ts` | `Responder.bleedCause` | "다르게 한 곳" 2 |

### 단계 4b (`d4da1e1` · `4b239ef`) — 대원: 후송

인계 패치(`docs/handover/H1-4b-wip.patch` — 파일 12개)를 얹어(`git apply --3way`, 충돌 없음 · `tsc` 통과 · `injuries` 97 가운데 94) 그 위에서 마저 했다. 실패하던 셋은 4a 의 임시 동작을 지키던 시험이라 4b 의 동작으로 고쳤다(장부의 대원 갈래: 처치를 받은 대원은 Σ(기록) ≥ 100 − 체력 · 안전 구역의 출혈 배율 · `mateFact.bleeding` 의 문턱). `d4da1e1` 이 본작업, `4b239ef` 가 측정 중에 찾은 교착 하나와 보고 순서 하나를 고친 것이다(아래 "다르게 한 곳" 5·3).

**실제 이름**

| 파일 | 이름 | 비고 |
|---|---|---|
| `field/injury.ts` | `HOSPITAL_BLEED`(= `MATE_RETREAT_BLEED` 0.09 — 본문 0.01) · `needsHospital(r)` · `mateNeedsHospital(v)` · `canDeploy(r)` · `careResponder(r, fx)` · `LIGHT_WORK` | `needsHospital` = 숨지지 않았고 `care` 없음 ∧ (쓰러진 적 ∨ 출혈 ≥ `HOSPITAL_BLEED` ∨ 체력 ≤ 40). `canDeploy` = 숨지지 않았고 `care` 없음 ∧ `status` 가 `ok`·`injured` — 배정(`crewReady`)과 내리는 사람(`unitArrived`)이 함께 쓴다. `careResponder` = 처치 효과를 대원에게(체력은 이 파일에서만 고친다) |
| `field/agents.ts` | `mateStatus(sim, b)`(**인자 `sim` 이 더해졌다**) · `workLabel(s, w, sim?)` · `fitFor` 의 `treatMate` 와 다친 대원 갈래 | `mateStatus`: 걷는 다친 대원은 물러나야 하는 몸이면 `hurt`, 아니면 `light`. `workLabel` 의 `sim` 은 '○○ 대원 응급 처치' 의 이름 — 시뮬레이션 쪽이 넘기고 화면은 안 넘겨도 된다 |
| `field/orders/injury.ts` | `SELF_EVAC_WAIT`(20) · 규칙 둘(처치·후송, 다수 사상자 다시 세기) · 안쪽 `onScene`·`queued`·`anyMedic`·`PROBE` | `PROBE` 는 자격을 물어볼 빈 작업 항목(작업판에 올리지 않는다) |
| `field/sceneManager.ts` | `SAFE_BLEED`(0.6) · `settle` 의 가벼운 일 복귀 · 안쪽 `crewNeedsHospital` | 5)번 블록의 병원행·종료 시 `boardOrder`·고아 부대 안전장치, `unitArrived` 의 `canDeploy` |
| `field/executor.ts` | `case 'treatMate'`(단계 0 처치 → 1 태울 것인가 → 2 끌고 가 태운다) | `act` 의 이름표: `withdrawn` 은 '처치 받음 — 후송 대기'/'부상 — 후송 대기', 일이 없는 다친 대원은 '부상 — 가벼운 일' |
| `field/commander.ts` | `outstanding(…)` → `{ …, mates, matesDown }` · 안쪽 `lightDuty(a, b)` · `syncBoard` 의 `armedCops`·`police`·`lightCops`·`okPosts` | `mates` = 쓰러진(숨지지 않은) 동료 + 믿음상 `mateNeedsHospital` 인 `hurt`·`safe` 동료, `matesDown` = 앞의 것만 |
| `resources.ts` | `crewOk(sim, u)` · `crewReady(sim, u)`(= `canDeploy` 인 내리는 대원 수) | `arrive` 의 운용 중단 문구 셋과 `causes: [u.oosEv]`, 병원 인계의 '부상 대원 n명' |
| `dispatch/dispatcher.ts` | `HEAVY_NEED`(안쪽) | §6.4 의 세 줄 그대로 |
| `scripts/metrics.ts` | `PHRASE.T4`·`PHRASE.T6` | 본문 §3.4-4·§3.6 의 식 그대로 |

**본문과 다르게 한 곳**

1. **`HOSPITAL_BLEED` 를 0.01 → 0.09(`MATE_RETREAT_BLEED` 와 같은 값)로 했다**(인계 패치의 작업자가 잰 것 — 0.01 에서는 흉기에 한 번 베인 경관과 총알 한 발 맞은 대원이 사건이 끝날 때마다 모두 병원으로 실려 가(보통 1.5 · 어려움 2.9 · 극한 5.4명/교대) 180교대에 가벼운 일로 돌아오는 대원이 한 명도 없었다. 처치를 받아도 출혈 0.09 × (1 − 0.9q) 가 0.01 아래로 내려가지 않는다). 같은 값이라 출혈로 물러난 대원은 처치를 받으면 병원이 필요 없는 몸이 되어 돌아오고, 병원으로 가는 것은 쓰러졌던 대원 · 체력 40 이하 · 처치를 받지 못한 큰 출혈이다. `mateFact` 의 `bleeding` 도 이 문턱으로 적는다(믿음 술어 `mateNeedsHospital` 이 진실 `needsHospital` 과 같은 판단이 되게).
2. **다친 지휘관은 현장 평가(`sizeup`)를 한다**(`fitFor` 의 다친 대원 갈래가 `sizeup` 을 빼고 본다). 본문 §2.5 는 `LIGHT_WORK` 만이라 했지만 §3.5 는 다친 부대장이 첫 지휘관이 될 수 있다고 한다 — 현장 평가를 못 하면 그 현장은 끝나지 않는다(`canClose` 가 `sizeupDone` 을 본다). 시험 12 ③ 은 `sizeup` 을 예외로 둔다.
3. **가벼운 일로 돌아오는 조건**(`settle`): 본문 §3.2 그대로(처치를 요구하지 않는다 — 물러날 때는 늘 병원이 필요한 몸이므로 대개 처치 뒤다)에 하나를 더했다 — 그 대원을 대상으로 한 `treatMate` 가 **이 틱에 끝났으면** 다음 틱에 돌아온다(`4b239ef`). 처치한 대원의 '안전 구역' 보고(강제 보고)와 '가벼운 일' 보고가 같은 시각이면, 대기열을 거쳐 늦게 닿은 앞의 것이 지휘관의 믿음을 덮어써(같은 시각은 `merge` 가 받아들인다) 지휘관이 그 대원에게 일을 주지 않았다(어려움 S1 #05).
4. **`outstanding` 이 `matesDown` 을 따로 돌려준다.** 7)번 블록은 쓰러진 동료가 남았으면 예전 규칙(불·가스·붕괴 현장은 구조 부대), 병원이 필요한 다친 동료만 남았으면 구급 부대를 찾는다. `rules/air.ts` 의 `tellDispatch` 문구도 '후송을 기다리는 다친 대원이' 로 가린다.
5. **다친 경관이 지키는 출입구의 우선도를 낮췄다**(`syncBoard`, `4b239ef` — 본문에 없다). 인계 패치는 진입이 정해진 무장 현장의 출입구 수를 `max(0, 온전한 경관 − 2) + 다친 경관` 으로 넓혔는데, 출입구를 먼저 잡은 온전한 경관 둘을 진입(0.9)이 빼 오지 못해(봉쇄 0.76·0.71 — 0.22 규칙) 다친 경관만 손을 놓은 채 5분 동안 멈춘 사건이 나왔다(어려움 S1 #05, 측정 도구의 STALL 293초 → 한계 시간). 이제 온전한 경관의 자리(`okPosts` = 예전 식)는 예전 우선도, 다친 경관 몫으로 더한 자리는 `0.5 − 0.02k` 다 — 그 자리를 온전한 경관이 잡고 있으면 진입이 빼 오고, 빈자리는 손이 빈 다친 경관이 맡는다. 다친 경관의 수는 지휘관의 믿음(`mate` 사실 `light`)으로 센다(후퇴 중·안전 구역의 경관은 출입구를 지키지 못한다). 다친 사람이 없으면 예전과 같다.
6. **`u.oosEv` 는 그 부대 대원의 RESPONDER_HURT·RESPONDER_KILLED 가 날 때마다 적는다**(`settle`·`fallen`) — 운용 중단 기록의 `causes` 는 그 값이다(본문 §3.6·시험 12 ④ 그대로). **주의**: I1 §3 의 한 문장("H1 이 그 기록 id 를 부대의 `u.oosEv` 에 둔다")은 `u.oosEv` 를 운용 중단 기록 자신의 id 로 읽는다. 지금 코드는 H1 본문대로 "그 부대의 마지막 부상·순직 기록"이다 — I1-b 가 C6·NO_UNIT 의 사슬을 이을 때 확인한다.
7. **부대가 떠날 때 병원으로 실려 가는 `ok` 대원**(물러날 만큼은 아니던 큰 출혈 — 체력 70 이상에 출혈 0.09 이상)은 `status` 를 `injured` 로 맞춘다(기록 없이 — 조직이 아는 상태를 출발 기록 '부상 대원 n명' 과 맞춘다). 드물다.
8. **기지에서 쉬는 걸을 수 있는 다친 대원도 지구력을 되찾는다**(`resources.tickUnits` — 본문에 없다). 예전에는 `status === 'ok'` 만 쉬었다 — 다친 채 다음 현장에 내리는 대원이 지친 채로만 나갔다.
9. **`treatMate` 의 자격 세부**(`fitFor`): 구급 분야 또는 의료 가방(`bag`·`alsBag`·`doctorKit`), 자기 자신은 0, 안전 확보 전의 무장 현장은 안전 구역의 동료만, 믿음 속 위치가 위험 구역(실내)이면 공기호흡기. 더한 것 둘 — 태울 차가 정해진 항목(`prop`)은 이미 기본 처치를 받은 동료면 그 차의 대원만 맡고, 기본 처치를 받은 동료를 다시 보는 것은 전문 처치(어림 `treatPlan` ≥ 0.6)를 할 수 있는 대원만(같은 처치와 같은 보고를 주고받지 않게).
10. **지휘(`orders/injury.ts`)의 세부**: 쓰러진 동료(`down`)는 `treatMate` 대상이 아니다(구조 `rescueMate` 가 먼저 — 안전 구역에 옮겨지면 `safe`). 그 동료의 부대에 떠나라는 지시가 있으면(그 차에 실려 간다) 항목을 거둔다. 처치를 두 번 마쳤는데 기본 처치로만 보고되면 다시 내지 않는다(구조 대상의 `treat` 와 같다). 걷는 중(`hurt`)인 동료의 처치를 맡은 구급대원은 대기 지점에서 기다린다('부상 대원 대기').
11. **`manageAmbulances`**: 출발할 때 그 차를 태울 차로 둔 `treatMate` 도 거둔다(`load` 처럼), 실을 사람이 남았는가(`waiting`)에 병원이 필요한 동료를 더한다. 출발 지시 문구에 '부상 대원 n명' 을 붙인다. 응급실 인계 대기 시간(`arrive`)에 다친 대원 수도 넣는다.
12. **가벼운 일을 하다 다시 물러나는 대원**은 `brain.think` 의 후퇴 갈래에서 자기 상태를 `hurt` 로 소리 없이 다시 알린다(처음 다칠 때는 `settle` 이 알린다 — 같은 대원이 두 번 `RESPONDER_HURT` 가 되지는 않는다).

**시험** (`tests/injuries.test.ts` — 4a 의 97개 → 116개, 파일 끝 "단계 4b" 아래)

- 병원이 필요한 몸·`mateNeedsHospital`·`canDeploy`, `crewReady`·`crewOk`(12 ②③④⑤, 헬기·구조정), 기지에 닿았을 때의 운용 중단 문구 셋과 `causes`·T6(12 ①③④⑤), 실제로 전원 순직시킨 부대(12 ④ — 그 뒤의 사건에 배정되지 않음, `u.oosEv`), `seatsUsed`.
- 가벼운 일: `fitFor`(무거운 일 0 · 교통 통제 · 안전 구역의 처치 보조), 다친 채 내린 대원의 이름표·`light` 보고, 다른 경찰이 모두 멈춘 교대에서 다친 순찰차가 나가 가벼운 일만 맡는다(12 ③ — 100틱마다).
- 처치·후송: 지휘관(대상당 한 항목·우선도·태울 차·자리가 차면 처치만·`light`/`evac` 이면 거둠), 맡을 사람이 없을 때의 구급 요청과 20초 규칙(주관 분야의 마지막 부대는 아니다), 실행기(병원이 필요 없으면 태우지 않음 → 가벼운 일 · 들것 · 탑승 · `evac` · 고아 부대 철수), 다친 대원만 태운 차의 출발과 `commander.ts` 의 `s.casualties`·`s.hostiles` 없음(8), 5)번 블록(병원행 · 숨진 대원은 싣지 않음 · 출발·인계 문구 · T3·T4·C5 · 기지의 운용 중단), 안전장치, 가벼운 일로 복귀(12 ⑥).
- 6(응급 현장에서 구급차 대원 하나를 쓰러뜨리면 구조 → 처치 → 탑승 → 인계), 13(닫혀 보관된 사건에 남은 부대 없음), 고친 곳 둘(출입구의 우선도, 처치가 끝난 틱).
- 남의 시험(§11-14·15): `tests/causality.test.ts` 의 T6(새 문구 셋, 걸을 수 있으면 멈추지 않음), `tests/crews.test.ts` ⑨(쓰인 자리 `seatsUsed`, 다친 대원을 함께 태운 출발 문구)와 "내리지 않는 자리" 시험의 `crewReady`(다친 대원은 이제 내릴 수 있다 — `crewOk` 가 온전한 대원).

**확인과 수치** (scratchpad `wf-injuries/` — `diag.mts`(결과·종료 까닭·대원의 부상·쓰러짐·순직·복귀·운용 중단·처치·후송·인계), `cmp.mjs`, `measure.sh`, `to.mts`(한계 시간·방치 사건 목록), `down.mts`(쓰러진 대원의 경과), `causes.mts`(원인 분포). 기준은 `f9965c0` 을 풀어 다시 쟀다 — 4a 메모의 기준표와 같다)

| 60교대 (기준 → 4a 끝 → 4b) | 보통 | 쉬움 | 어려움 | 극한 |
|---|---|---|---|---|
| 성공 | 80.5 → 80.3 → 80.3% | 87.6 → 87.1 → 87.1% | 63.0 → 62.6 → 62.8% | 36.4 → 35.2 → 34.6% |
| 성공+대응 지연 | 84.7 → 84.4 → 84.4% | 89.4 → 89.1 → 89.1% | 69.1 → 68.9 → 69.1% | 48.3 → 45.9 → 45.3% |
| 실패+미해결 | 6.0 → 6.3 → 6.3% | 4.5 → 4.5 → 4.5% | 15.8 → 15.9 → 15.8% | 34.1 → 35.4 → 36.0% |
| 한계 시간 + 방치 (+ 무대응) | 1+3 → 1+3 → 1+3 | 0+1 → 0+1 → 0+1 | 4+11 → 6+11 (+1) → 5+12 (+1) | 8+32 (+1) → 11+34 → 14+33 |
| 구조율 (숨짐) | 94.1 (99) → 94.0 (102) → 94.0% (102) | 95.9 → 95.8 → 95.7% | 87.1 → 87.0 → 86.8% | 75.2 → 74.6 → 74.3% |
| 다친 대원 / 교대 | 0.17 → 0.15 → 0.15 | 0.08 → 0.10 → 0.10 | 0.57 → 0.77 → 0.70 | 0.82 → 1.80 → 1.90 |
| 순직 (60교대) | 0 → 0 → 0 | 0 | 0 → 0 → 0 | 0 → 2 → 1 |
| 가벼운 일로 복귀 · 동료 처치 · 다친 대원 후송 출발 · 자기 부대 이송 | — → 7 · 7 · 2 · 1 | 5 · 6 · 1 · 0 | 30 · 35 · 14 · 5 | 65 · 81 · 52 · 20 |
| 운용 중단 (기지) | 0 → 0 → 0 | 0 | 0 → 3('전원 부상') → 0 | 3 → 4 → 3('모두 병원 이송') |

- 보통은 4a 끝과 결과 분포가 같다(성공 681 · 한계 시간 1 · 방치 3 — 바뀐 것은 처치·복귀·후송 기록뿐). §9.1 의 보통 목표 안이다. 극한의 한계 시간·방치는 41(무대응 포함) → 47(+6 — 상한에 닿았다), 다친 대원 1.90/교대(상한 2 아래).
- 강제 20교대의 그 시나리오 줄(완료 조건 4 — 한계 시간·무대응·방치): `armed/shooter` 0·0·0 (23 · 성공 18 · 부분 5 — 4a 와 같다), `armed/hostage` 0 (18 · 2), `armed/siege` 0 (12 · 8 · 지연 1), `armed/riot` 0 (20 · 2), `armed/domestic` 0 (19 · 1 · 2 · 미해결 4), `armed/bomb` 0 (21), `fire/arson` 0 (31 · 7 · 실패 5). 기준과 견주어 늘어난 한계 시간·방치는 없다. 부대 규모 1(30교대): 성공 239 → 233 → 233, 한계 시간 4 → 7 → 7 · 방치 2.
- 한 교대를 읽어 본 것: 어려움 S13 #10 — 윤서연 대원 쓰러짐(t 612) → 28초 뒤 안전 구역 → 처치 → 구급1 탑승 → 병원 인계(`care 'hospital'`). 극한 S18 #08 — 경관 셋이 다쳐 물러남 → 지원 구급차의 처치 둘 → 하나는 가벼운 일로 복귀, 하나는 탑승 → '지원구급1 환자 1명·부상 대원 1명 싣고 시립병원으로 출발' → 인계 → 안전 확보 뒤 '순찰1, 부상 대원을 태우고 병원으로 이동하라'(20초 규칙) → 인계.
- 관문: `npm run check` 통과(`d4da1e1` — Vitest 443 + 건너뜀 1, 시드 40 '검증 통과' · 성공 446 · 부분 56 · 지연 26 · 미해결 13 · 실패 26, 한계 0 · 방치 2, 지표 교착 후보 0 · 잊힌 사건 0 · C1~C5 0) · `sweep 40 --diff hard --check`·`--diff extreme --check` 통과. `4b239ef` 에서도 다시 통과(아래 4c 의 관문 표).

### 단계 4c — 대원의 새 규칙: 열 탈진 · 잔해 바닥 추락 · 몸싸움

**실제 이름**

| 파일 | 이름 | 비고 |
|---|---|---|
| `field/rules/injury.ts` | `HEAT_STAMINA`(10) · `HEAT_DMG`(0.5) · `FALL_P`(0.002) · `FALL_HIT`([8, 20]) · `responderHazards(sim, s, I)`(export — 시험용) · 안쪽 `inHeat`·`rubbleStep` | 규칙 하나 안에서 구조 대상(단계 3) 다음에 대원을 돈다. 판정 뒤에는 규칙 첫 줄에서 돌아간다 |
| `field/executor.ts` | `FIGHT_HIT`([3, 8]) · 안쪽 `fights(sim, I, h, was)` · `scuffle(sim, s, I, a, h)` | `engage` 의 흉기·도주 용의자 검거 갈래와 `case 'arrest'` |

**규칙** (§2.3·§4.2 그대로인 것은 줄만)

- **열 탈진**: 소방 분야(`r.dept === 'fire'`) 대원이 지구력 10 이하로 열 속(곁 1칸 안의 불 ≥ 0.3 또는 선 칸의 연기 ≥ 0.4)에 있으면 `hurtResponder(…, min(0.5 × dt, 체력 − 15), 'exhaustion', { tick: true })` — 체력은 15 아래로 가지 않는다(15 에 닿으면 `settle` 이 쓰러짐으로 적는다 — 탈진으로 쓰러질 수는 있어도 숨지지는 않는다). 차에 타지 않은 모든 대원(쓰러진·물러난 대원 포함).
- **잔해 바닥 추락**: 붕괴 현장(`s.kind === 'collapse'`)에서 활동 중인 대원이 잔해 칸(`s.damage === 1`)에 **새로** 들어설 때(`a.lastTile` 과 다른 칸 — 처음 본 칸은 들어선 것으로 치지 않는다) `injuryRng(…, 'fall')` 에서 확률 `0.002 × hazardMul` → 걸리면 같은 흐름에서 피해 8~20. 기록 '○○ 대원 잔해 위에서 미끄러져 다침.'(RESPONDER · `hazard` · 1)을 먼저 남기고 그 id 를 `hurtResponder(…, 'fall', { ev })` 에 넘긴다. 대원마다 사건당 한 번(`a.fellOnce`).
- **몸싸움**: 검거를 마치는 순간 상대가 `fight` 였고 무력화되지 않았으면(`sim.t >= h.stunUntil`, 사건이 닫히지 않았으면) `injuryRng(…, 'fight')` 에서 대원 몫 → 용의자 몫 순서로 3~8. 기록 '○○이 저항해 몸싸움 끝에 검거.'(RESPONDER · `resolve` · 3 — 예전 검거 문구를 대신한다)를 먼저 남기고, 대원은 `hurtResponder(…, 'blunt', { by: 용의자, byKind: 'hostile', ev })`. 섬광탄·테이저로 무력화된 상대·투항한 상대는 예전 문구 그대로.

**본문과 다르게 한 곳**

1. **몸싸움의 용의자 몫은 아직 `hurtHostile` 이 없어(단계 5) 기록 줄과 함께 직접 깎는다**(`h.health -= x` + `noteHostileHurt` — 둘 다 `(H1)` 꼬리표). 단계 5 가 `hurtHostile(…, 'blunt', { by: rid, byKind: 'responder', ev })` 로 바꾼다. 난수 순서(대원 → 용의자)는 지금부터 그대로라 단계 5 가 바꿔도 흐름이 밀리지 않는다.
2. **잔해 바닥 추락은 붕괴 유형의 현장에만**(본문 "붕괴 현장"). `s.damage` 는 다른 현장(X6 의 실제 붕괴 등)에도 생길 수 있다 — 그때 넓힐지는 X6 가 정한다.
3. **처음 본 칸은 들어선 것으로 치지 않는다**(`lastTile` 이 비어 있을 때) — 대기 지점이 잔해 칸이면 내리자마자 추첨되지 않게.

**시험** (`tests/injuries.test.ts` — 116 → 121개, 파일 끝 "단계 4c" 아래): 열 탈진(연기·곁의 불, 경찰·지치지 않은 대원·열 밖은 아님, 15 아래로 가지 않음), 잔해 바닥 추락(처음 본 칸·같은 칸·새로 들어섬·기록이 원인·피해 범위와 방화복·사건당 한 번·쓰러진 대원·잔해 아닌 칸), 붕괴 현장에만, 몸싸움(engage·arrest — 문구·같은 흐름을 새로 갈라 뽑은 값과 같다·가해자·기록 id), 몸싸움이 없는 검거(무력화·투항).

**확인과 수치** (60교대, 4b(`4b239ef`) → 4c)

| | 보통 | 쉬움 | 어려움 | 극한 |
|---|---|---|---|---|
| 성공 · 성공+지연 · 실패+미해결 | 80.3 → 80.2% · 84.4 → 84.3% · 6.3 → 6.3% | 87.1 → 87.0% · 89.1 → 88.9% · 4.5 → 4.5% | 62.8 → 62.3% · 69.1 → 68.8% · 15.8 → 15.9% | 34.6 → 34.5% · 45.3 → 45.1% · 36.0 → 35.8% |
| 한계 시간 + 방치 (+ 무대응) | 1+3 → 1+3 | 0+1 → 0+1 | 5+12 (+1) → 5+11 | 14+33 → 15+33 |
| 다친 대원 / 교대 · 순직 | 0.15 → 0.17 · 0 → 0 | 0.10 → 0.12 · 0 | 0.70 → 0.78 · 0 | 1.90 → **2.10** · 1 → 1 |
| 잔해 바닥 추락 (붕괴 사건당) | 9 (69건 — 0.13) | 9 (46 — 0.20) | 13 (73 — 0.18) | 33 (92 — **0.36**) |
| 몸싸움 · 열 탈진 기록이 있는 대원 | 27 · 3 | 14 · — | 33 · 23 | 40 · 42 |
| RESPONDER_HURT 의 원인이 된 것 | 타박상(몸싸움) 1 | — | 타박상 6 | 타박상 9 · 열 탈진 2 |

- 붕괴 강제 30교대(보통): 추락 11건 / 붕괴 사건 68 = 0.16, 한계 시간 0 · 방치 1(기준·4b 와 같다). 극한의 붕괴 강제 30교대: 0.26, 한계 시간 + 방치 30 → 29. 화재 강제 30교대: 결과 분포가 4b 와 같다(열 탈진은 보통 난이도에서 거의 일어나지 않는다 — 안전장치).
- 강제 20교대의 그 시나리오 줄은 4b 와 모두 같다(한계 시간·무대응·방치 0). 부대 규모 1(30교대): 성공 233 → 231, 한계 시간 7 → 9(늘어난 둘 — 화재 S3 #13·S4 #10 — 은 다친 대원·추락·몸싸움과 무관하게 궤적이 갈라진 것이다).
- 깨지기 쉬운 기존 시험 둘(`tests/sim.test.ts` 생활 사건 성공률 — 칼 든 가정 폭력, `tests/crime.test.ts` 폭동)은 4b·4c 의 관문에서 모두 통과했다.
- 교대당 시간(`sweep 20 --no-metrics`, 4a 끝 사본과 번갈아 세 번씩, 사용자 CPU): 4a 끝 24.7 · 23.4 · 23.0초 → 4c 끝 25.4 · 24.8 · 24.2초(평균 23.7 → 24.8초, +4% — 세 바퀴 모두 4c 가 조금 느리다). 다친 대원이 물러나 있지 않고 가벼운 일을 하며 판단·실행을 돌고, 후송·인계 왕복이 는 몫으로 본다(새 세계 규칙은 대원마다 매 틱 비교 두셋이다). 측정 흔들림(±5%)과 비슷한 크기라 더 좁히지 않았다.
- 손잡이를 돌려 본 것(극한 60교대만): 몸싸움 2~5 → 다친 대원 2.15/교대, 추락 확률 0.0015 → 2.08/교대 — 시드 궤적의 흔들림(±0.15)보다 작아 상수는 본문 값 그대로 두었다(아래 "알아야 할 것").
- 관문: 아래 "단계 4b·4c 가 끝난 자리".

### 단계 4b·4c 가 끝난 자리 — 단계 5 가 이어받을 때

**관문**: `d4da1e1`(4b) · `4b239ef`(4b 고침) · `c055ab5`(4c) 에서 각각 `npm run check` 통과 — Vitest 443 · 445 · 450 (+ 건너뜀 1, 파일 15개) / 시드 40 '검증 통과'(셋 모두 성공 446 · 부분 56 · 지연 26 · 미해결 13 · 실패 26, 한계 0 · 방치 2, 교착 후보 0 · 잊힌 사건 0 · C1~C5 0). `sweep 40 --diff hard --check`·`--diff extreme --check` 통과(4b·4c), 어려움·극한 60교대의 측정 도구 표본(`--metrics`)에서 교착 후보 0(4c). 깨지기 쉬운 기존 시험 둘(생활 사건 성공률, 폭동)은 그 관문 안에서 통과. 기준과 측정 도구는 scratchpad `wf-injuries/`(`base-src`·`a4-src` = `f9965c0`·`9760785` 를 푼 사본, `out/<이름>/*.json` = 60교대·강제 20교대·부대 규모 1 의 결과, `measure.sh <소스> <이름>`, `node cmp.mjs base a4 b2 c2`).

**뒤 단계가 알아야 할 것**

- **단계 5(`treatSuspect`)가 넓혀야 하는 자리** — 지금은 다친 대원(`kind 'mate'`)만 다룬다: `orders/injury.ts` 의 `queued`(탑승 지시의 수)와 `commander.ts` 의 `loadsQueued`·`manageAmbulances` 의 `loading`·출발 때의 `cancel` 에 `treatSuspect` 를 더한다. 병원 인계(`resources.tickUnits`)는 `aboard` 가운데 `mate` 만 인계하고 배열을 비운다 — `suspect` 의 `h.where = 'hospital'`(`sim.scenes[e.inc]`)과 문구의 '용의자 k명'을 더한다(T4 는 이미 '용의자' 를 받는다). 5)번 블록의 출발 문구도 `mate` 만 센다. `seatsUsed` 와 응급실 인계 대기 시간은 이미 용의자를 센다.
- **몸싸움의 용의자 몫**(`executor.scuffle` 의 `(H1)` 두 줄)을 `hurtHostile(…, 'blunt', { by: a.rid, byKind: 'responder', ev })` 로 바꾼다. 흐름의 순서(대원 → 용의자)는 그대로 둔다.
- **극한이 목표의 끝에 있다**: 다친 대원 2.10/교대(§9.1 극한 ≤ 2 — 넘었다), 한계 시간 + 방치 + 무대응 41 → 48(+7 — 상한 +6 을 넘었다. 4b 끝에서 +6). 4c 의 몫은 몸싸움으로 이미 다친 대원이 40 아래로 내려간 것(RESPONDER_HURT 9)과 열 탈진(2)이고, 나머지는 시드 궤적의 흔들림이다(손잡이를 돌려 본 두 시험판도 ±0.1 안). §9.3 의 손잡이 1번(출혈 물러남 문턱·총상 계수)을 낮추면 보통의 다친 대원이 목표의 아래 끝(0.15 — 지금 0.17) 밑으로 내려간다 — 단계 7 이 극한과 보통을 함께 보고 정한다. 부대 규모 1(30교대)의 한계 시간은 4 → 9(4a 에서 7).
- **`HOSPITAL_BLEED = MATE_RETREAT_BLEED`** 로 묶어 두었다 — 단계 7 이 물러남 문턱을 돌리면 병원 문턱도 함께 움직인다(일부러 — 출혈로 물러난 대원이 처치를 받으면 돌아오는 관계를 지킨다).
- **`u.oosEv`** 는 그 부대의 마지막 RESPONDER_HURT·RESPONDER_KILLED 기록이다(위 "다르게 한 곳" 6 — I1-b 가 C6·NO_UNIT 의 사슬을 이을 때 본다).
- **`evaluate`** 는 아직 순직 대원을 쓰러진 대원(1.5)으로 센다. `buildReport` 의 대원 목록도 '중상'/'부상' 두 가지다 — 단계 6.
- **`outstanding().mates`** 는 이제 병원이 필요한 동료(`hurt`·`safe`)를 센다. 현장이 비었을 때 그런 동료만 남았으면 7)번 블록이 구급 부대를 찾는다(오지 않으면 60초 뒤 방치 — 보통·어려움·극한 60교대에서 이 경로로 방치가 된 사건은 없었다).
- **가벼운 일**: 다친 대원에게 지시가 가는 것은 지휘관이 그 대원의 `light` 보고를 알 때뿐이다(`commander.assign` 의 `lightDuty`). 다친 채 다음 현장에 내린 대원은 `unitArrived` 에서 소리 없이 `light` 를 알린다. R3 의 부상 줄은 `injury.LIGHT_WORK` 를 쓴다.
- 인계 패치 파일(`docs/handover/H1-4b-wip.patch`)은 지우지 않았다(주 세션이 지운다 — 과제 지시).

**§12.1("고칠 파일") 밖에서 고친 곳 — 단계 4b·4c**

| 파일 | 함수 · 자리 | 이유 |
|---|---|---|
| `sim/field/commander.ts` | `syncBoard` 의 무장 현장 인원 문턱(`armedCops`·`police`·`lightCops`·`okPosts`) · `assign`(`lightDuty`) · `targetX`·`targetY` 의 `treatMate` · `loadsQueued` · `workLabel(…, sim)` 을 부르는 자리 | 다친 경관은 진입조에 들지 않고 출입구를 지킨다("다르게 한 곳" 5), 가벼운 일을 한다고 알린 대원에게 지시, 처치하러 갈 자리, 다친 대원의 후송도 자리를 맡아 둔다 |
| `sim/field/brain.ts` | `think` 의 후퇴 갈래 · `workLabel(…, sim)` | 가벼운 일을 하다 다시 물러나면 `hurt` 를 다시 알린다 |
| `sim/field/executor.ts` | `act` 의 이름표 · `finishTask`·`relieve` 의 `workLabel(…, sim)` · `FIGHT_HIT`·`fights`·`scuffle`(4c — 표에는 `engage`·`arrest` 만) | 다친 대원의 상태 글, 몸싸움 |
| `sim/field/rules/air.ts` | `tellDispatch` 의 문구 | `matesDown` — 쓰러진 대원과 후송을 기다리는 대원을 가린다 |
| `sim/resources.ts` | `tickUnits` 의 기지 휴식 · `arrive` 의 응급실 인계 시간 | 걸을 수 있는 다친 대원도 지구력을 되찾는다("다르게 한 곳" 8), 다친 대원도 인계에 시간이 든다 |
| `sim/field/rules/injury.ts` | `responderHazards`(4c) | 본문은 "열 탈진(새로, rules/injury.ts)" 만 적었다 — 잔해 바닥 추락도 세계 규칙이라 같은 자리에 두었다 |
| `tests/crews.test.ts` | "내리지 않는 자리" 시험의 `crewReady` | 다친 대원은 이제 내릴 수 있다(`crewReady` = 걸을 수 있는 대원 — 본문 §3.6). §11-14 의 ⑨ 와 함께 고친 남의 시험 |

### 단계 5 (`7247216` · `5735ff5`) — 용의자

`7247216` 이 본작업, `5735ff5` 가 측정 중에 찾은 낡은 믿음의 되풀이 하나를 고친 것이다(아래 "다르게 한 곳" 10).

**실제 이름**

| 파일 | 이름 | 비고 |
|---|---|---|
| `field/injury.ts` | `HOSTILE_BLEED`(0.35) · `HOSTILE_BLEED_MAX`(0.15) · `HOSTILE_LEFT`([4, 15]) · `SELF_HARM`(0) · `SELF_HARM_HIT`([22, 38]) | §2.2·§4.5 의 상수. 상한 0.15 와 자해 피해 범위는 본문에 이름이 없던 값이다. `SELF_HARM` 은 사용자 결정으로 0 — 손잡이가 아니다 |
| | `hurtHostile(sim, s, I, h, amount, cause, o?)` | 본문 §2.7 그대로: 문턱(쓰러지지 않은 — `tDown` 없고 체력 15 초과 — 용의자가 한 번 피해로 0 아래면 `injuryRng(…, 'down')` 의 4~15, 체력을 올리지는 않는다) → 새 상처의 출혈(한 번 피해만: `min(0.15, 출혈 + 계수 × 피해 × injuryMul × 0.35)`, `bleed0` 도, `treatQ = 0`, `bleedCause`) → 기록 → `settleHostile`. `o.tick` 은 문턱·출혈이 없고, `o.down` 은 체력을 15 이하로. 숨졌거나 · 판정 뒤 · 달아남(`escaped`) · 차에 실림(`where` 가 `scene` 아님)이면 돌아간다 |
| | `settleHostile(sim, I, h, cause, ev = -1)` (export) | 쓰러짐(체력 15 이하가 처음 — `tDown`, 상태 `down`, 검거된 용의자는 `arrested` 그대로, `path = null`)과 사망(체력 0 이하 — `dead`·`tDead`·체력 0·`deathCause`)의 전이와 그 문구 (§4.6). `tickHostiles` 의 안전장치도 이 함수를 부른다 |
| | `careHostile(sim, h, fx)` · `hosNeedsCare(v)` · `threatOverAt(s)` | 처치 효과(대원의 `careResponder` 와 같은 식 + `tTreated`) · **믿음** — 'hos' 사실의 값으로 "처치가 필요한 다친 용의자"(숨지지 않음 · 현장 · 쓰러짐 또는 band ≥ 1, band 를 모르면 위중) · 위협이 끝난 시각(무장 `s.secureAt`, 그 밖 `s.arrivedAt`) |
| `field/rules/injury.ts` | `hostileHazards(sim, s, I)`(export — 시험용) · `HOSTILE_CARED`(0.6) | 용의자의 매 틱 피해: 불(0.3 초과 — 2.6 × 불) · 연기(0.36 × 연기, 가스 누출 현장은 유독 가스 0.62 ×) · 상처 출혈(처치를 받고 검거돼 있거나 쓰러져 있으면 0.6배). 모두 `hurtHostile(…, { tick: true })` 라 쓰러짐·사망 전이를 그대로 탄다 |
| `field/orders/injury.ts` | treatSuspect 규칙 · `TS_MAX_DONE`(4) · 안쪽 `PROBE_S` | 아래 "규칙" |
| `field/agents.ts` | `hosFact(sim, s, h, src, d)` | **`d` 는 필수 인자**(호출 10곳 — `agents` 3 · `executor` 7). 값에 `dead`(2칸 안에서만) · `band` · `tq` · `where`. 상태 글은 `down` '쓰러짐'(예전 '제압'), 검거된 채 쓰러짐 '검거 · 쓰러짐', 숨진 것을 알면 '사망'. `significant` 의 `hos` 에 `dead`·`tq`·`where` |
| | `workLabel` 의 `treatSuspect`('${용의자} 응급 처치') · `fitFor` 의 `treatSuspect` | 아래 "규칙" |
| `field/executor.ts` | `case 'treatSuspect'` · `TASER_HIT`(2, 안쪽) | 단계 0 처치 → 1 태울 것인가 → 2 옮겨 태운다. `shootAt`·`scuffle`·`tryTaser` 가 `hurtHostile` 을 부른다 |
| `field/commander.ts` | `riderText(u)` (export) | 실은 사람의 글 '환자 n명·부상 대원 m명·용의자 k명'(0 인 항은 뺀다 — 용의자가 없으면 예전 글과 한 글자도 같다). 출발 지시(`manageAmbulances`)와 출발 기록(5)번 블록)이 함께 쓴다 |
| `types.ts` · `debrief.ts` | `WorkKind 'treatSuspect'` · `ProblemCode 'SUSPECT_DIED'` · `PROBLEM_LABEL.SUSPECT_DIED`('용의자 사망') · `order`(`ESCALATION` 바로 다음) · 문장 틀 | 문장 틀은 숨진 용의자마다 기록(쓰러짐·처치·숨진 시각, 부상 기록)으로 — 아래 "규칙" |

**규칙** (본문 그대로인 것은 줄만)

- **용의자 문턱과 쓰러짐**(§2.6·§4.1): 대원의 명중(30~48)·폭발·몸싸움·테이저·자해가 모두 `hurtHostile` 을 거친다. 쓰러짐은 다치는 그 자리에서 바로 서므로 같은 틱의 다른 대원은 쏘지 않는다(`engage` 가 `hostileActive` 로 끝난다). 문구: 총상 '○○이 총상을 입고 쓰러졌습니다 — 무력화.'(hazard · 3), 그 밖 '○○이 ${원인}으로 쓰러졌습니다.'(hazard · 2), 사망 SUSPECT_DIED '○○ 사망 (원인, 처치 전|처치 후)' / '○○ 생체 반응 소실.'(problem · 3). 대원의 사격은 따로 기록을 남기지 않으므로, 기록이 없던 상처는 쓰러짐 기록을 원인(`Injury.ev`)으로 잇는다 — 그 상처로 숨지면 사망 기록의 `causes` 가 쓰러짐 기록이다.
- **매 틱 피해와 출혈**(`rules/injury.ts`): 구조 대상의 악화 식과 같은 계수(연기에 문턱 없음). 판정 뒤에는 규칙 첫 줄에서 돌아간다.
- **폭발**(`hazards.blast`): 용의자도 ×0.8 (원인이 `crush` 인 천장·2차 붕괴도 — 세 부류를 고르게). 쓰러지지 않은 용의자는 문턱 때문에 큰 폭발에도 한 번에 숨지지 않는다.
- **테이저**(§4.2): 명중하면 감전 2(체력을 1 아래로 내리지 않는다)를 한 번 피해로 적는다(출혈은 0.0003/s 남짓). **몸싸움**: 용의자 몫을 `hurtHostile(…, 'blunt', { by: rid, byKind: 'responder', ev })` 로 — 흐름 순서(대원 → 용의자)는 그대로다.
- **자해**(§4.5): 투항 판정(`morale < 0.2`)에서 무기를 들고 · 공격성 0.7 초과 · 인질 없음 · 아직 추첨하지 않은 용의자가 `injuryRng(…, 'self')` 로 한 번만 추첨한다(`selfHarmRolled`). `SELF_HARM = 0` 이라 늘 거짓 — 투항이 예전처럼 일어나고, 그 흐름 밖의 결과는 바뀌지 않는다(시험이 흐름의 소비가 꼭 한 번인지 본다). 켜졌을 때의 길(ESCALATION '용의자 자해' 기록 → `hurtHostile(…, { down: true })`)은 만들어 두었다.
- **지휘(`orders/injury.ts`, 믿음만)**: 믿음상 맞서는 용의자(`hold`·`fight`·`flee`)가 하나도 없을 때, `hosNeedsCare` 인 용의자마다 한 항목(`s.board` 에서 열린 항목을 먼저 찾아 `open` 이면 `prop`·우선도만 고친다). 우선도 0.74 + 0.06 × band. 처치가 필요한가 = `tq === 0 || (tq === 1 && 마친 항목 < 2)`. 태울 차(`prop`) = 자리가 남은 구급차·헬기(위중이면 헬기 먼저) — **기다리는 구조 대상·다친 대원 가운데 그 용의자보다 중증도가 같거나 높은 사람이 없을 때만**(다친 대원은 쓰러졌던 적이 있거나 위중이면 위중으로 친다). 처치도 태울 차도 없으면 열린 항목을 거둔다. 맡을 수 있는 활동 대원(떠나라는 지시를 받지 않은 부대의 — `fitFor`)이 없으면 열지 않거나 거둔다(열어 두면 `canClose` 가 막힌다). 맞서는 용의자가 생기면·숨졌다·실렸다고 알면 거둔다. 마친 항목이 `TS_MAX_DONE` 이면 더 내지 않는다(안전장치). 다수 사상자 다시 세기에 `hosNeedsCare` 인 용의자를 더한다('부상자 n명(대원·용의자 포함) — 구급 부대가 더 필요').
- **맡는 사람(`fitFor`)**: 경찰은 언제든, 구급대원은 안전 확보 뒤(`!(armed && secureAt < 0)` — `treat` 의 hot 술어)에만. 그 밖의 분야는 0. 믿음 속 자리가 위험 구역(실내 + `fireRisk`)이면 공기호흡기. 태울 차가 정해진 일은 이미 기본 처치를 받은 용의자면 그 차의 대원만, 기본 처치를 받은 용의자를 다시 보는 것은 전문 처치(`treatPlan` ≥ 0.6)를 할 수 있는 대원만(treatMate 와 같다). 걸을 수 있는 다친 대원은 맡지 않는다(`LIGHT_WORK` 밖).
- **실행기**: 대상이 숨졌으면 **곁(2칸 안)까지 가서** 본 대로 알리고 끝낸다. 차에 실렸거나·달아났거나·아직 맞서면 본 대로 알리고 끝낸다. ① 처치(대원과 같은 식 — `treatEffect` → `careHostile`, '○○ 응급 처치 완료.'(imp 1, `rid` = 처치한 대원)). 이미 받은 처치보다 0.15 넘게 나은 처치를 할 수 없거나, 다친 데가 없으면(쓰러진 적 없고 체력 70 초과·출혈 0.01 미만) 건너뛴다. 처치하는 동안 숨지면 본 대로 알린다. ② 태울 차가 내 차이고 자리가 남았으면 ③ 대상의 좌표를 내 뒤에 붙여 대기 지점까지 옮기고(`a.carrying` 은 쓰지 않는다 — 화면은 "그 틱에 자리가 바뀐 쓰러진 용의자"를 들것으로 그린다) `h.where = 'aboard'`, `u.aboard` 에 `{ kind: 'suspect' }`, `u.firstLoadAt ??=`, 강제 보고, '○○을 ${호출부호}에 태워 병원으로.'(imp 2). 실린 뒤에는 피를 흘리지 않는다(`hurtHostile` 이 돌아간다).
- **구급차**: `loadsQueued`·`queued`·`manageAmbulances` 의 `loading`·출발 때의 `cancel` 이 `treatSuspect` 를 센다. 실을 사람이 남았는가(`waiting`)에 위협이 끝난 현장의 `hosNeedsCare` 용의자를 더한다. 출발 지시와 출발 기록의 글은 `riderText`. 병원 인계(`resources.tickUnits`): `aboard` 의 용의자는 `sim.scenes[inc].hostiles[id]` 의 `where = 'hospital'`·`bleed = 0`, 문구에 '용의자 k명'(T4 가 이미 받는다). 경찰 호송은 모델하지 않는다(§4.3 결정) — 실리지 않은 용의자는 사건이 끝나면 그대로다(판정 뒤 악화 없음).
- **hos 사실과 perceive**: `perceive` 는 차에 실린 용의자를 건너뛰고, 숨진 줄 안 뒤에는 그 용의자를 다시 보지 않는다(먼 관찰로 `dead` 를 되돌리지 않는다 — 동료와 같다). 시야 밖 16칸의 상태 변화 갈래도 실제 거리를 넘긴다.
- **조사**: 용의자 문구의 박힌 조사(기습·투항·인질 끌기·엄폐 이동·발포·도주·협상의 `${h.label}가`·`와`, 덮쳐 검거의 `를`)를 `josa` 로 (단계 3 메모가 "용의자 문구는 5단계가 다시 쓴다"고 넘긴 것).

**본문과 다르게 한 곳**

1. **'hos' 사실의 중증도는 거리로 가리지 않는다**(숨진 것만 2칸 안 — 본문 §4.3 은 "3칸 밖이면 쓰러졌으면 2 · 아니면 1"). 그 규칙대로면 멀리서 본 다치지 않은 검거 용의자가 band 1 이 되어 처치 지시가 나가고, 가서 보면 band 0 으로 알리고, 지휘관이 다시 멀리서 보면 1 이 되어 같은 지시가 되풀이된다(낡은 믿음). 구조 대상의 `casFact` 처럼 보이는 그대로(위중까지)로 두었다 — 다친 모습·쓰러진 모습은 멀리서도 보인다.
2. **용의자 출혈의 0.6배는 "처치를 받았고 검거돼 있거나 쓰러져 있을 때"**(본문 §2.6 "처치를 받고 안전 구역에 있거나 검거되어 있으면" 을 용의자에 맞춰 읽었다 — 용의자에게는 안전 구역이 없다).
3. **매 틱 피해(불·연기·가스)는 `rules/injury.ts` 에**(본문은 자리를 정하지 않았다), 연기에 문턱이 없다(구조 대상과 같다). 폭동 현장의 가담자는 불붙은 물건의 연기를 마신다(보통 30교대에 24명, 평균 14).
4. **`hurtHostile` 은 달아났거나 차에 실린 용의자에게도 돌아간다**(본문은 숨짐·판정 뒤만). 현장에 없는 사람이 현장의 폭발·불에 다치지 않게.
5. **태울 차를 정하는 "기다리는 사람" 에 다친 대원**(병원이 필요한 동료 — 쓰러졌던 적이 있거나 위중이면 위중으로 친다)을 넣었다(본문은 "구조 대상·대원").
6. **지휘관은 다친 용의자 때문에 구급 부대를 따로 부르지 않는다**(본문에 없다 — 다수 사상자 다시 세기만). 구급차가 없으면 경찰이 처치까지 하고, 위협이 끝난 뒤 숨지면 벌점(단계 6).
7. **태우는 문구에 조사**: '○○을 ${호출부호}에 태워 병원으로.'(본문 '○○ ${호출부호}에 …').
8. **테이저의 감전 2 는 한 번 피해**(출혈이 아주 조금 생긴다). 본문의 "기록만" 을 "체력 2 를 기록으로 남기고 1 아래로는 내리지 않는다"로 읽었다.
9. **`settleHostile` 을 export** 해 `tickHostiles` 의 안전장치(체력 15 이하 · `tDown` 없음)가 같은 전이와 문구를 쓴다(그 갈래에 닿는 길은 지금 없다).
10. **(`5735ff5`) 숨진 용의자는 가서 보고 알린다 · 지시의 상한.** 극한 60교대에서 한 사건에 treatSuspect 항목이 110~287개 생겼다(농성 다섯·총격범 하나가 그 때문에 한계 시간). 맡은 용의자가 이미 숨져 있으면 실행기가 멀리서 본 대로(숨진 것은 2칸 안에서만 보인다) 알리고 끝냈고, 지휘관은 여전히 처치가 필요한 줄 알고 2초마다 다시 냈다. 이제 곁까지 가서 알리고, 한 용의자의 지시를 네 번 마쳤으면 더 내지 않는다(안전장치 — 고친 뒤 극한의 농성 한계 시간 5 → 0).
11. **경찰의 처치는 느리다**(공용 처치 식의 진도: 경찰의 의료 능력이 낮아 하한 0.1/초 — 위중한 용의자는 85초 남짓). 본문 §2.6 의 "걸리는 시간 4.5 + …" 는 진도 단위다(구조 대상의 `treat` 와 같은 식이라 고치지 않았다). 그 사이에 숨지는 용의자가 있다 — 아래 "단계 7 이 알아야 할 것".

**시험** (`tests/injuries.test.ts` — 121 → 142개, "단계 5" 아래): ④ 문턱(흐름 `down` 의 첫 값·같은 호출 안의 쓰러짐·원인 기록·사망 하나), 새 상처의 출혈·매 틱 피해·`down`, 쓰러짐의 상태(맞섬·투항 → down, 검거 그대로)와 돌아가는 경우 다섯, 용의자의 체력을 직접 깎는 줄 없음, 폭발(×0.8·문턱), 매 틱 피해(불·연기·유독 가스·출혈 1배·0.6배·달아남·실림), 출혈로 숨짐(원인 기록 = 쓰러짐 기록)·판정 뒤, 사격·테이저, `hosFact`(거리·글), `perceive`(실림·되돌리지 않음), `fitFor`, 지휘(한 항목·우선도·태울 차·같은 중증도면 처치만·맞서는 용의자·숨짐·실림·경상), 맡을 사람 없음, 실행기(처치·태움·인계·T4·`riderText`), 숨진 것을 알림, 자해 꺼짐(흐름 소비 한 번), 7(즉사 없음·처치한 대원의 자격 — 기록으로), 9(SUSPECT_DIED 하나·시각 ≤ `closedAt`), 보고서 문장, 고침 둘(멀리서 숨진 용의자·상한). 장부의 용의자 갈래를 고쳤다(숨진 용의자는 넘친 만큼, 처치를 받은 용의자는 오른 만큼). 단계 1 시험("한 번 피해의 기록")의 `noteHostileHurt` 줄은 지웠다(함수를 없앴다).

### 단계 6 (`971e973` · `6b9bdb6`) — 판정·보고서

**실제 이름**

| 파일 | 이름 | 비고 |
|---|---|---|
| `field/injury.ts` | `outShifts(r)` | §3.7 의 표: 순직 −1 · 후송(`care` 가 있음 — 병원 인계·후송 중) 쓰러진 적 있음 3 / 없음 2 · 쓰러진 채 후송 아님 3 · 다침 1 · 온전 0. 보고서와 I2 가 함께 부른다 |
| `debrief.ts` | `evaluate` 의 `killed`·`downCount`·`hurtOnly`·`deadAfter` | §7.1: 순직 = 이 사건의 RESPONDER_KILLED 기록의 대원 ×3, 쓰러짐(순직 제외, `status === 'down'`) ×1.5, 부상 ×0.75, 위협이 끝난 뒤(`tDead > threatOverAt`) 숨진 용의자 ×0.5. `IncidentResult` 의 `respondersDown`·`respondersKilled`·`suspectsHurt`(이 사건에서 다친 — 처음부터 다쳐 있던 몫은 빼고 — 또는 숨진 용의자)·`suspectsDead`·`deathCauses`(숨진 구조 대상의 `deathCause`) |
| | `buildReport` | `respondersHurt` 의 상태 글 순직·쓰러짐·부상과 `rid`·`band`(교대 끝 — 순직 3)·`cause`(순직이면 `deathCause`, 아니면 `mainCause`)·`dead`·`hospital`(`care` 가 있음)·`out`, `respondersKilled`(RESPONDER_KILLED 기록마다 — 사건 번호), `suspectsHurt`·`suspectsDead`(사건 판정의 합), `roster`(인근 도시 지원 대원 제외), 요약 줄 |
| `view/triage.ts` | `reportHurtText(x, killed)` | 보고서 대원 목록의 한 줄 — 보고서에 적힌 값만 읽는다 |
| `ui/panels.tsx` · `ui/styles.css` | 보고서의 타일 셋과 목록, 대원 정보창의 '다음 교대 결장 예상 n' · `.tile.loss`·`.kv .loss` | 순직 타일과 순직 줄은 회청색(`LOSS_COLOR` — 빨강을 쓰지 않는다) |
| `scripts/injurystats.ts`(새) · `scripts/sweep.ts` | `injuryStats`·`sumInjury`·`injuryJson`·`injuryLine` | 기본 출력의 `injuries:` 줄과 `--json` 의 `injuries` 칸(§9.2 의 이름) — 끝난 교대를 읽기만 한다 |

**문장과 요약** (§7.2·§7.3 그대로인 것은 줄만): 구조 대상 사망의 세 문장에 숨지게 한 원인(괄호 — 사망 기록과 같은 `deathCause`), 한 줄 요약 '대원 n명 부상, m명 순직'(부상 = 순직을 뺀 RESPONDER_HURT 대원)·'용의자 … 검거 (사망 k)', 요약 줄 '순직: ○○ 대원(호출부호, 사건 03 대형 인질극).'(첫 줄 바로 다음) · '… n명은 구하지 못했습니다(화상 4, 실외 노출 2, …).' · '대원 피해: 부상 7명(병원 이송 5명).' · '용의자 7명이 다쳤고 그중 3명이 숨졌습니다.'.

**본문과 다르게 한 곳**

1. **순직 요약 줄의 사건 표기**: '사건 03 대형 인질극'(사건 번호 + 시나리오 이름 — 본문 예 'F-03 화재' 의 번호 꼴은 지금 코드에 없다).
2. **`hospital` 은 후송 중도 포함**(`care` 가 있으면 — 본문의 칸 설명은 "병원 인계"). 목록에는 '병원 이송' 으로 적는다.
3. **보고서 목록에 '쓰러짐'** 을 한 낱말 더한다(중증도와 따로 — 쓰러진 적이 있는 대원).
4. **'용의자 사상' 타일**: 큰 글자 = 다친 수(숨진 용의자 포함), 작은 글자 '다침 · 사망 m'(`6b9bdb6` — '다침 n · 사망 m' 을 한 줄로 쓰니 타일 폭을 넘어 끝 숫자가 잘렸다).
5. **구조 대상 사망 문장의 원인은 `deathCause`**(숨진 틱의 가장 큰 항 — 사망 기록에 적힌 그 원인). 단계 1 메모가 "어색하면 `mainCause` 와 견줘 정한다"고 넘긴 것 — 기록과 보고서가 같은 원인을 말하는 쪽을 골랐다.
6. **sweep 의 `down/shift`** 은 교대 끝에 쓰러진 적이 있는(숨지지 않은) 대원 수다.

**시험** (142 → 150개, "단계 6" 아래): ③ 앞선 부상 기록 없는 순직의 셈(`respondersKilled` 1·벌점 3·요약), 쓰러짐과 순직(순직은 쓰러짐으로 세지 않는다·'대원 1명 부상, 1명 순직'), 용의자 벌점(교전 중 0 · 위협이 끝난 뒤 0.5 · 검거로 셈 · '(사망 1)')·`threatOverAt`, 숨진 구조 대상의 원인 집계와 문장, `outShifts` 표, 대원 목록·순직 목록·명부·요약 줄·`reportHurtText`, 용의자 줄과 원인 집계(모든 교대), sweep 집계(읽기만·보고서와 맞음·즉사 0).

**확인과 수치** (scratchpad `wf-injuries/` — `diag5.mts`(용의자 집계를 더한 판), `cmp5.mjs`, `measure5.sh`, `to5.mts`(한계 시간 사건 목록 + 그 사건의 treatSuspect 항목 수), `dbg5.mts`·`dbg5b.mts`(한 사건의 treatSuspect 경과), `find5.mts`(장면 찾기), `shots5.cjs`(화면 찍기); 결과 `out/s5b`(단계 5 고친 뒤)·`out/s6`(단계 6) · 기준 `out/base`(`f9965c0`)·`out/c2`(4c 끝))

| 60교대 (기준 → 4c → 5 → 6) | 보통 | 쉬움 | 어려움 | 극한 |
|---|---|---|---|---|
| 성공 | 80.5 → 80.2 → 80.4 → 80.4% | 87.6 → 87.0 → 87.3 → 87.3% | 63.0 → 62.3 → 62.2 → 61.0% | 36.4 → 34.5 → 33.6 → 33.1% |
| 성공+대응 지연 | 84.7 → 84.3 → 84.3 → 84.3% | 89.4 → 88.9 → 88.9 → 88.9% | 69.1 → 68.8 → 68.9 → 67.6% | 48.3 → 45.1 → 45.4 → 44.7% |
| 실패+미해결 | 6.0 → 6.3 → 6.1 → 6.1% | 4.5 → 4.5 → 4.6 → 4.6% | 15.8 → 15.9 → 15.8 → 15.8% | 34.1 → 35.8 → 36.3 → 36.5% |
| 한계 시간 + 방치 (+ 무대응) | 1+3 → 1+3 → 1+3 | 0+1 (그대로) | 4+11 → 5+11 → 4+12 (+1) | 8+32 (+1) → 15+33 → 15+35 (+1) |
| 구조율 | 94.1 → 94.0 → 94.0% | 95.9 → 95.7 → 95.7% | 87.1 → 86.6 → 86.9% | 75.2 → 74.4 → 74.1% |
| 무장 사건 성공+지연 | 80.0 → 79.2 → 78.5 → 78.5% | 85.7 (그대로) | 64.6 → 63.3 → 63.5 → 56.9% | 51.6 → 41.4 → 42.1 → 38.9% |
| 다친 대원 / 교대 · 순직 | 0.17 · 0 (그대로) | 0.08 → 0.12 · 0 | 0.57 → 0.78 → 0.93 · 0 | 0.82 → 2.10 → 2.00 · 0 → 1 → 2 |
| 용의자: 다침 · 쓰러짐 · 사망(위협이 끝난 뒤) | 104 · 14 · 1 (0) | 59 · 7 · 0 | 167 · 56 · 24 (18) | 201 · 90 · 37 (28) |
| 총에 맞아 쓰러진 용의자 → 숨짐 · 즉사 | 14 → 1 (7%) · 0 | 7 → 0 · 0 | 56 → 24 (43%) · 0 | 90 → 37 (41%) · 0 |
| 용의자 처치 · 구급차 탑승 · 병원 인계 | 32 · 10 · 10 | 31 · 13 · 11 | 88 · 25 · 22 | 101 · 26 · 23 |

- 단계 5 는 보통의 결과 분포를 거의 바꾸지 않는다(4c 와 견주어 성공 680 → 682, 한계 시간·방치 그대로 — 다친 용의자의 처치·이송 기록만 는다). 단계 6 은 궤적을 바꾸지 않고(같은 교대·같은 사건) 판정만 바꾼다 — 보통은 위협이 끝난 뒤 숨진 용의자도 순직도 없어 분포가 그대로이고, 어려움·극한·총격범은 위협이 끝난 뒤 숨진 용의자의 벌점(0.5)으로 성공이 부분 성공으로 내려간다(어려움 성공 682 → 669).
- 강제 20교대의 그 시나리오 줄(완료 조건 4 — 한계 시간·무대응·방치): `armed/shooter` 0·0·0(23 · 성공 21 → 18 → 17 → 14 · 부분 2 → 5 → 5 → 8), `armed/hostage` 0(18 · 2 그대로), `armed/siege` 0(성공 15 → 12 → 12 → 10), `armed/riot` 0(20 · 2), `armed/domestic` 0(19 · 1 · 2 · 미해결 4 그대로), `armed/bomb` 0(21 모두 성공), `fire/arson` 0(31 · 7 · 실패 5). 기준보다 늘어난 한계 시간·방치는 없다. 강제 20교대 전체(그 시나리오 밖의 사건 포함)의 한계 시간은 인질극 0 → 4 · 농성 0(4c 1) → 4 — 모두 다른 사건(인질극 S7 의 열차 탈선·화재·가스, …)이고, 용의자 처치로 경관 하나가 7초 늦게 풀려 구급차 하나가 다음 사건에 늦은 데서 갈라진 궤적이다(`s7h-*.txt`).
- 총에 맞아 쓰러진 용의자의 사망 비율: 총격범 강제 20교대 5/10 = 50% · 농성 6/16 · 폭동 2/6 · 폭발물 2/6 · 가정 폭력 1/3 · 방화 1/6 · 인질극 0/7. 즉사(쓰러지는 순간 숨짐)는 모든 표본에서 0(용의자 문턱).
- 부대 규모 1(30교대): 성공 239 → 231 → 229 → 228, 한계 시간 4 → 9 → 8.
- 관문: `npm run check` 통과 — `7247216`(Vitest 469 + 건너뜀 1), `5735ff5`(471), `971e973`·`6b9bdb6`(479) / 시드 40 '검증 통과'(넷 모두 성공 448 · 부분 56 · 지연 25 · 미해결 13 · 실패 25, 한계 0 · 방치 2, 교착 후보 0 · 잊힌 사건 0 · C1~C5 0). `sweep 40 --diff hard --check`·`--diff extreme --check` 통과(단계 6). 깨지기 쉬운 기존 시험 둘(생활 사건 성공률, 폭동)은 그 관문 안에서 통과.
- 화면(단계 5 뒤 다시 찍기 + 단계 6 의 보고서 — `shots6/`·`shots6b/`, 개발 서버 5210, 콘솔 오류 0): 총격범 S6 #02 — 쓰러진 용의자의 처치(t 286)와 구급차로 옮기는 중('용의자 이송' · 쓰러진 용의자가 대원 곁에 누운 채, t 300), 총격범 S7 #02 — 숨진 용의자의 덮개와 검정 딱지 · '용의자 1·총 · 사망'(t 230), 극한 S21 #18 — 순직한 대원을 동료가 수습해 옮기는 중(덮개 · 검정 딱지, t 822), 극한 S13 #05 — 다친 대원의 처치('처치 받음 — 후송 대기'), 극한 S21 의 보고서 — 타일 '대원 부상 7'·'대원 순직 1'(회청색)·'용의자 사상 7 다침 · 사망 3', 요약의 순직 줄·원인 집계, 대원 목록 '위중 · 총상 · 병원 이송 · 결장 예상 2' / '순직 · 총상 · 18'. 어느 그림에도 피·붉은 조각이 없다. `npm run ui-check` 여덟 항목 모두 통과.
- 교대당 시간(`sweep 20 --no-metrics`, 4c 끝 사본과 번갈아 두 번씩, 사용자 CPU): 26.86 · 26.57초 → 27.02 · 27.04초(+1% — 측정 흔들림 안).

### 단계 5·6 이 끝난 자리 — 검토와 단계 7 이 이어받을 때

- **극한이 목표 밖이다**: 한계 시간 + 방치 + 무대응 41 → 51(§9.1 극한 +6 이하 — 4c 에서 이미 +7, 단계 5 의 몫 +3), 다친 대원 2.00/교대(상한 2 에 닿았다). 단계 5 의 몫은 용의자 처치가 위협이 끝난 뒤의 현장을 몇 초~수십 초 더 붙잡아 부대가 늦게 풀리는 데서 온다(위의 강제 실행에서 본 궤적 갈림과 같다).
- **보통의 "총에 맞아 쓰러진 용의자의 25~60% 가 숨진다"** 는 표본이 작고(60교대에 14명) 7% 로 아래다. 어려움 43%·극한 41%·총격범 강제 50% 는 범위 안이다. §9.3-3 의 차례(`HOSTILE_LEFT` → `HOSTILE_BLEED`·상한 → 처치 우선도)로 맞춘다. 용의자 사망 / 교대: 보통 0.017(≤ 0.3) · 어려움 0.40 · 극한 0.62.
- **숨진 용의자의 대부분은 위협이 끝난 뒤에 숨진다**(어려움 18/24 · 극한 28/37) — 판정의 0.5 벌점이 어려움의 무장 성공+지연을 63.5 → 56.9% 로 내린다. 까닭은 셋: ① 경찰의 처치가 느리다(위 "다르게 한 곳" 11 — 진도 하한 0.1/초), ② 구급대원은 안전 확보 선언 뒤에야 맡는다, ③ 쓰러진 뒤 남는 체력(4~15)과 출혈(한 발 0.025~0.04/s, 두 발이면 그 두 배)로는 1~3분 안에 숨진다. 손잡이(§9.3-3)를 돌리기 전에 이 셋을 함께 본다.
- **`hos` 사실의 값**: `{ x, y, weapon, state, hostage, facing, dead, band, tq, where }`. `rules/crime.ts` 가 풀려난 인질의 제보로 만드는 'hos' 사실에는 새 칸이 없다(그 값은 맞서는 용의자라 처치 대상이 아니다 — 지휘 규칙은 `band` 가 없으면 위중으로 본다).
- **`threatOverAt`·`outShifts`** 는 I2·X6 가 쓴다(이름은 본문 그대로). **`noteHostileHurt` 는 없앴다** — `noteCasHurt` 만 시험용으로 남는다(`grep -rn "(H1)" src/sim` 에 남은 기록 줄은 `tickCasualties`·`tickGas` 의 것뿐이다 — 둘 다 본문이 그대로 두라고 한 자리).
- **`injuryRng` 의 쓰인 이름**: `'trap'`·`'extricate'`·`'fall'`·`'fight'`·`'down'`·`'self'`. 남은 이름은 `'electric'`(부르는 곳 없음).
- 단계 2 메모가 "5단계 뒤에 다시 찍어 확인할 것"으로 넘긴 그림(대원의 덮개 · 후송 · 용의자의 덮개·들것·'사망' 글자·처치·차에 실린 용의자)은 위 "화면" 줄에서 확인했다. AI 시점의 용의자 덮개는 지휘관의 'hos' 사실의 `dead`(곁에서 본 대원의 보고)로 이어진다.

**§12.1("고칠 파일") 밖에서 고친 곳 — 단계 5·6**

| 파일 | 함수 · 자리 | 이유 |
|---|---|---|
| `sim/field/commander.ts` | `targetX`·`targetY` 의 `treatSuspect` · `riderText`(새, export) · `manageAmbulances` 의 `hosWaiting` | treatSuspect 의 `prop` 은 부대 id 라 소품 자리로 읽으면 엉뚱한 곳으로 간다 · 출발 지시와 출발 기록이 같은 글을 쓴다 · 실을 사람이 남았는가에 용의자(§3.4-5 가 적고 표에는 없다) |
| `sim/field/sceneManager.ts` | 5)번 블록의 출발 글 | `riderText` — 용의자를 센다(단계 4b 메모가 넘긴 것) |
| `sim/resources.ts` | `tickUnits` 의 병원 인계 | 용의자의 `where = 'hospital'`·'용의자 k명'(단계 4b 메모가 넘긴 것) |
| `sim/field/hazards.ts`·`executor.ts` | 용의자 문구의 박힌 조사 | `josa` (단계 3 메모가 넘긴 것) |
| `scripts/injurystats.ts` | 새 파일 | sweep 의 집계(본문 §9.2 는 `sweep.ts` 에 더한다고만 적었다 — `catstats`·`methodstats` 와 같은 꼴로 뺐다) |
| `view/triage.ts` | `reportHurtText` | 보고서 목록의 글(§8.4 — 표에는 `panels.tsx` 만 있다) |
