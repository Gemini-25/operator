# H1 — 부상과 사망

공통 규칙은 `docs/specs/README.md`. 브랜치 `wf/injuries`, 개발 서버 포트 **5210**.

사용자의 말: "대원이나 용의자, 요구조자의 부상이나 사망도 가능하게."

풀어 쓰면: 대원·용의자·구조 대상(요구조자) 세 부류 모두 사건 중에 다치고, 숨질 수도 있다. 원인(총상·자상·화상·연기·추락·잔해·폭발·익수·감전·탈진 등)에 따라 다치고, 다친 정도가 행동·처치·이송·판정·보고서·화면에 드러난다. 이미 있는 것(구조 대상의 사망, 대원의 부상·쓰러짐, 용의자의 `down`)은 살리고, 빠진 것과 세 부류 사이에 고르지 않은 것을 채운다.

이 문서는 다음 구현 세션이 이 문서와 `CLAUDE.md` 만 보고 끝까지 만들 수 있게 쓴다. 줄 번호는 2026-11-14 `1ca465d` 기준이다. 그 뒤 B1(1차)·B3·P1·Q1 이 합쳐져(`a746b77`) 이미 여러 줄이 밀렸고(예: `commander.manageAmbulances` 의 `firstLoad`·`redAboard` 는 542·544 → 589·591), 앞으로 R1·G5·G4 가 먼저 합쳐지면 더 바뀐다. **줄 번호가 아니라 함수 이름으로 찾는다**. 확신하지 못한 곳은 **(확인 필요)** 로 표시했다.

**자기 파일**(새로): `src/sim/field/injury.ts`(공통 모델), `src/sim/field/rules/injury.ts`(세계 규칙), `src/sim/field/orders/injury.ts`(지휘 규칙 — 믿음만), `src/view/triage.ts`(중증도 색 한 곳), `src/ui/PersonCard.tsx`(구조 대상·용의자 정보창), `tests/injuries.test.ts`.
**공용 파일 수정**: §12 의 표에 적힌 함수만, 가장 작은 조각으로(README §2).
**건드리지 않는다**: `city.ts`, `cityPlan.ts`, `view/city/*`, `renderCity.ts`, `dispatch/*`(배정은 지금의 `crewReady` 로 충분하다), `tests/sim.test.ts`, `README.md`, `CLAUDE.md`, `docs/ROADMAP.md`, `docs/DESIGN.md`.

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
| R1 부대 편성·개인 장비·헬기 | 방호, 처치 수준, 환자 자리, 결원, 들것, 테이저 | R1 이 부서 계수를 사람 장비로 옮긴다: `Responder.kit`, `hasKit`·`kitWorks`, `armorOf(sim, rid, engaging)`, `blastFactor(sim, rid)`, `scba`(공기 `uses`)·`turnout`, `medLevelOf(sim, rid)`, `seatsOf(u)`, `stretcher`, `taser`(0.72 확률로 3.2초 무력화). H1 의 `protection()` 은 이 함수들을 **읽기만** 하고(§2.4), 환자 자리는 `seatsOf`(쓰인 자리는 H1 의 `seatsUsed` — §3.4-5)를 쓴다. **H1 은 R1 의 `minField` 를 쓰지 않는다** — 운용 중단을 인원 문턱으로 정하지 않기 때문이다(사용자 최종 결정 2026-11-15, §3.6: 다치거나 일부가 숨진 부대는 −18 감점만, 운용 중단은 부대 대원이 전부 숨졌을 때뿐). `minField` 는 I2 의 예비 인력 문턱으로 남는다(I2 §3.2 적용 6). R1 의 `crewReady(sim, u)`(내리는 대원 `fieldCrew` 가운데 `status === 'ok'` 인 수)는 H1 이 `crewOk` 로 이름을 옮기고, 그 위에 "부대에 살아 있는 대원이 남았나"(`crewLeft`) 검사만 얹는다(§3.6 — 값은 R1 의 `crewReady` 와 같다). R1 의 경찰 역할에는 의료 가방(`bag`)이 없다(순찰 팀장만 `aed`). R1 은 `agentHealth`·`blast`·`tickHostiles` 의 피해 식에서 "방호" 부분만 함수로 꺼내 두고, H1 은 그 위에서 피해 식 전체를 `hurtResponder` 로 옮긴다. R1 뒤에는 대원이 보통 34명 → 63명으로 는다(부상 기회도 는다 — §9 는 R1 을 합친 뒤의 기준값으로 잰다) |
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
export interface MateBelief { x: number; y: number; status: 'down' | 'hurt' | 'safe' | 'evac'; band: number; bleeding: boolean; tq: 0 | 1 | 2; dead: boolean; wasDown: boolean; since: number }
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

**객체 모양**(P1 의 규칙 — CLAUDE.md "자주 도는 객체의 모양", R1 §3 끝·X6 §2.2 와 같은 방식): 위의 선택 칸은 도중에 생기게 두지 않고, 객체를 만드는 리터럴에 **같은 순서로** `undefined` 를 넣는다 — Casualty 칸(`injuries`·`bleedCause`·`deathCause`·`lost`)은 `kit.ts` 의 `addCas` 와 `hazards.ts` 의 주변 시민(`bystander2`) 리터럴, Unit 의 `aboard`·`firstLoadAt` 은 `resources.ts` 의 두 부대 리터럴(`createRoster`·`createAidUnit` — R1 의 새 칸 뒤, 같은 순서), FieldAgent 칸(`hurtEv`·`hpTick`·`lastTile`·`fellOnce`)은 `agents.makeAgent`(R1 이 꺼낸 함수. R1 없이는 `sceneManager.unitArrived` 의 대원 리터럴), Responder 칸은 `createRoster`·`createAidUnit` 의 대원 리터럴, Hostile 칸은 용의자를 만드는 기존 자리(`kit.ts`·현장 생성기의 용의자 리터럴)에. 그러지 않으면 구조 대상·부대·대원 객체의 숨은 클래스가 갈라져 P1 의 속도를 잃는다.

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

지금의 4번 블록(지휘관이 `active` 가 아니면 경험 많은 주관 부서 대원이 승계)을 그대로 쓴다. 문구만 승계자의 믿음으로 고른다: 승계자가 옛 지휘관의 `mate` 사실을 갖고 있으면 '${이름} 대원 ${순직|쓰러짐|부상}으로 지휘 불능. 지휘권을 승계합니다.', 없으면 지금 문구. 다친 지휘관이 물러나는 도중(아직 `active`)에는 지휘를 놓지 않는다(지금 그대로). 승계가 일어나지 않는 경우(남은 active 대원 없음)는 7번 블록이 받는다 — `outstanding(a, now)`(§5.2 에서 인자 `now` 를 더한다)에 `mates`(믿음상 쓰러진 동료 가운데 숨지지 않은 수 + 믿음상 `mateNeedsHospital` 인데 `evac` 이 아닌 수)를 더하고, 남은 일로 친다: 그런 동료가 있으면 'rescue'(지금 7번 블록의 추가 부대 요청 경로 — 구급·같은 분야를 부른다), 아니면 지금 규칙(`sceneManager` 7번 블록, `commander.outstanding`). 숨진 동료만 남았으면 남은 일로 치지 않는다(수습 임무는 만들지 않는다 — 부대가 떠날 때 함께 복귀한다).

### 3.6 인원이 줄어든 부대

- 현장: 남은 active 대원이 하던 일을 계속한다(지금).
- 배정: 다친 대원은 다음 현장에 내리지 않고(`unitArrived` 의 `status === 'ok'`), 결원 부대는 배정 점수 −18(지금, `dispatcher.pickUnit` 의 `crewReady(sim, u) < u.crew.length` 감점 — R1 뒤에는 `< fieldCrew(sim, u).length`, R1 §7.2). 관제 코드(`dispatch/*`)는 고치지 않는다.
- **결정 — 부대의 운용 중단은 그 부대 대원이 전부 숨졌을 때만이다. 사용자 최종 결정(2026-11-15): "운용을 멈추는 건 그 부대 전부 죽었을 때로. 하나라도 다치거나 죽으면 멈추는 건 너무 그렇다."** 대원이 다치거나(`injured`·`down`) 일부가 숨져도 부대는 위의 −18 감점만 받고 계속 출동한다. 부대 규모 1·2 의 부대, 인근 도시 지원 부대(최소 편성), 2인 순찰차·일반 구급차도 같다 — 한 명이 다치거나 순직한 순찰차는 남은 한 명으로 나간다(지금 코드에서 한 명 다친 순찰차가 −18 감점으로 계속 나가는 것과 같다). 다친 대원 개인의 효과(다친·쓰러진 대원은 다음 현장에 내리지 않음, `hurtF` 로 느려짐 등)는 이 문서 그대로다. 인원 문턱(R1 의 `minField`)이나 "순직 대원이 있으면 중단" 같은 운용 중단 규칙은 두지 않는다(§12.3 — 쓰지 않는 두 안).
- **사람이 없어서 빠지는 부대.** 숨지지 않은 대원이 모두 병원으로 후송되면(§3.4 — `care` 가 있다) 그 부대에는 현장에 내릴 사람이 없다. 이때 `crewReady` 가 0 이라 배정에서 빠지고, 기지에 닿으면 `oos` 다. 이것은 운용 중단 규칙이 아니라 사람이 없어서다 — 후송된 대원은 그 교대에 돌아오지 않으므로(§12.3 "경상은 처치 뒤 복귀하나, 교대 중 회복") 그 부대는 교대 끝까지 사람이 없다. 남은 대원이 부대에 있지만 모두 다쳐 내릴 사람이 없는 부대(`crewOk === 0` — 지금 코드의 '대원 전원 부상으로 운용 중단.' 경로)도 같은 까닭으로 0 이다: 다친 대원은 그 교대에 다시 내리지 않는다. 내리지 않는 자리(조종사·정장)만 남은 헬기·구조정도 내릴 사람이 없으므로 같다.
- **구현 — `resources.ts` 의 `crewReady`.** 관제는 복귀 중(`returning`)인 부대도 다시 배정하고(`dispatcher.ts:61`) `crewReady === 0` 인 부대만 건너뛴다(`dispatcher.ts:50`). 그래서 사람이 없는 부대는 기지에 닿을 때의 `oos` 만이 아니라 `crewReady` 안에서 0 이 되어야 한다. 이렇게 둔다:
  ```ts
  export function crewOk(sim: Sim, u: Unit): number { /* 지금의 crewReady 본문 (R1 이면 fieldCrew 가운데 status === 'ok') */ }
  export function crewLeft(sim: Sim, u: Unit): number {                      // 부대에 남은 살아 있는 대원: 숨지지 않았고 후송되지 않음(care 없음). R1 없이 u.crew
    return fieldCrew(sim, u).filter((rid) => !sim.responders[rid].dead && sim.responders[rid].care === undefined).length;
  }
  export function crewReady(sim: Sim, u: Unit): number {
    if (crewLeft(sim, u) === 0) return 0;      // 살아 있는 대원이 하나도 없다 — 전원 순직, 또는 남은 대원이 모두 후송. 규칙이 아니라 사람이 없어서다
    return crewOk(sim, u);                     // 그 밖은 crewOk 그대로 — 부분 결원(다침·일부 순직)은 0 으로 만들지 않는다. 관제의 −18 감점만 받는다
  }
  ```
  값으로는 `crewOk` 와 같다(살아 있는 대원이 없으면 멀쩡한 대원도 없다). 그래서 R1 의 `crewReady` 와 같은 값이고, 결원 규칙 때문에 배정 결과가 따로 바뀌는 일은 없다 — 바뀌는 것은 대원이 다치는 것(4a)과 후송(4b) 자체다. 첫 줄은 0 이 되는 까닭을 코드에 드러내고 `arrive` 의 문구가 같은 술어를 쓰게 둔다. 이 위에 인원 문턱이나 순직 검사를 더하지 않는다. 관제의 세 줄(`=== 0` 건너뛰기, `< u.crew.length` 감점 — R1 뒤 `< fieldCrew.length`, 같은 분야의 남은 부대 수)이 모두 이 값을 보므로 관제 코드를 고치지 않고 지켜진다. `arrive` 의 `returning` 은 `crewReady === 0` 이면 지금처럼 `oos` 이고, 문구만 까닭에 따라 고른다: 내리는 대원이 모두 숨졌으면 '${호출부호} 대원 전원 순직 — 운용 중단.', 숨지지 않은 대원이 모두 후송됐으면(`crewLeft === 0`) '${호출부호} 남은 대원 모두 병원 이송 — 운용 중단.', 그 밖(남은 대원이 모두 다침)은 지금 문구 '${호출부호} 대원 전원 부상으로 운용 중단.'. 문구를 더하므로 `scripts/metrics.ts` 의 `PHRASE.T6` 를 `/(?:대원 전원 부상으로|대원 전원 순직 —|남은 대원 모두 병원 이송 —) 운용 중단/` 으로 넓히고(I1 §2.3 표도 같이) `tests/causality.test.ts` 를 통과시킨다 — 그러지 않으면 새 두 문구의 기록을 crew 가 아니라 field 로 센다. 운용 중단 기록의 `causes` 에는 그 부대의 마지막 `RESPONDER_HURT`·`RESPONDER_KILLED` 기록 id 를 넣고, 그 id 를 부대 칸 `u.oosEv`(선택 칸 — 위 "객체 모양" 규칙대로 부대 리터럴에 `undefined`)에 둔다(I1-b C6 이 `sim.events` 를 거슬러 찾지 않게 — I1 §3.11 0단계 7번). 시험 11-12 가 "순직 한 명인 부대·부상 한 명인 순찰차는 계속 배정된다"와 "전원 순직 부대는 배정되지 않고 `oos`"를 본다.
- 인근 도시 지원 대원(`u.aid`)도 같은 규칙을 따른다. 명부 출력(§3.7)에서는 뺀다.

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

`dispatch/*` 는 고치지 않는다. 다친 대원은 `crewReady`(`crewOk` — 멀쩡한 내리는 대원 수)에서 이미 빠진다(순직 대원도 `status === 'down'` 이라 빠진다). 다치거나 일부가 숨진 부대는 지금의 −18 감점만 받고 계속 배정된다(§3.6 사용자 결정 — 인원 문턱으로 빼지 않는다). 부대에 살아 있는 대원이 남지 않았거나(전원 순직·모두 후송) 남은 대원이 모두 다친 부대만 `resources.ts` 의 `crewReady` 가 0 을 돌려주므로(§3.6 — 사람이 없어서다) 관제의 지금 검사(`crewReady === 0` 건너뛰기)만으로 배정에서 빠진다 — 복귀 중인 부대도 마찬가지다. '대원 부상'·'부상 대원 후송' 요청은 지금의 지원 요청 경로로 간다.

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
| 사람이 없어 빠진 부대(§3.6 — `crewReady` 0 으로 기지에서 `oos` 가 된 부대: 전원 순직·남은 대원 모두 후송·남은 대원 모두 다침. 운용 중단 규칙이 아니므로 목표가 아니라 **보고 지표**다) | 수치만 보고한다. 교대당 0.3 을 넘으면 부상·후송이 많다는 뜻이므로 §9.3 의 1·2번(부상을 줄인다)으로 맞춘다 | 부대 규모 1(`--diff 3,3,3,3,3,1`) 30교대에서 같은 값을 따로 보고한다 |
| 순직 대원이 있는 부대(보고 지표 — 남은 대원으로 계속 출동한다, §3.6) | 수치만 보고한다(대원 순직의 목표를 따라간다) | |
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

`scripts/sweep.ts` 에 집계를 더한다(결과는 바뀌지 않는다): `respondersKilledPerShift`, `respondersDownPerShift`, `suspectsHurt`, `suspectsDead`, `suspectsDownByGunDiedShare`(총상으로 쓰러진 용의자 가운데 숨진 비율), `suspectsInstantDeathShare`(그 가운데 `tDead === tDown` 인 비율 — 0 이어야 한다), `debrisFallsPerCollapse`(붕괴 현장 사건당 잔해 바닥 추락), `deathCauses`(숨진 구조 대상의 원인 분포), `crewOutPerShift`(사람이 없어 기지에서 `oos` 가 된 부대 수 — §3.6 의 운용 중단 문구 셋, 곧 `PHRASE.T6` 에 맞는 기록을 센다), `unitsWithKilledPerShift`(교대 끝에 순직 대원이 있는 부대 수). 출력 줄 하나: `injuries: responders hurt/shift … down/shift … killed/shift … · suspects hurt … dead … (shot-down died …%, instant …%) · falls/collapse … · causes …`.

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
| **4b. 대원 — 후송** | `'treatMate'` 와 `workLabel`·`fitFor`, `executor` case, `orders/injury.ts` 의 처치·후송·20초 규칙(대상당 한 항목, 맡을 사람 없으면 거둠), `Unit.aboard`·`firstLoadAt`, 자리 셈, `canCarryPatients`·`manageAmbulances`(진실 읽기 둘 제거, `aboard` 만 태운 차의 출발), 5번 블록(병원행, 종료 시 `boardOrder`, 고아 부대 안전장치), 병원 인계(`patientsIncident` 블록 밖), `crewReady`·`crewOk`·`crewLeft`·`arrive` 문구(사람이 없어 `oos` — 전원 순직·모두 후송·모두 다침) | 그렇다 |
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
12. **다치거나 일부가 숨진 부대는 계속 나가고, 사람이 없는 부대만 빠진다**(§3.6 사용자 결정): ① **순직 한 명인 부대**: 내리는 대원이 둘 이상인 부대의 대원 하나를 `hurtResponder` 로 순직시킨 교대를 끝까지 돌린다 → 순직 뒤에도 `crewReady` 가 그 부대에 `crewOk`(≥ 1)를 돌려주고, 기지에 닿은 뒤 `u.state !== 'oos'` 이며 운용 중단 기록이 없다(그 뒤 그 부대가 실제로 뽑히는지는 `pickUnit` 점수 문제라 보지 않는다 — 배정에서 빠지지 않는 것만 본다). ② **부상 한 명인 순찰차**(R1 뒤 `minField('patrol') === 2` 인 최소 편성 — 결정 전의 (가)안이 멈추던 부대): 대원 하나를 `injured` 로 만들면 `crewReady === 1`(0 이 아니다) — 기지에 닿아도 `oos` 가 아니고, `pickUnit` 의 −18 감점만 받는다. ③ **전원 순직 부대**: 한 부대의 내리는 대원을 모두 `hurtResponder` 로 순직시키면 `crewReady === 0` — 그 뒤 만들어진 사건의 `everAssigned` 에 그 부대가 없고, 기지에 닿으면 `oos` 와 '${호출부호} 대원 전원 순직 — 운용 중단.' 기록(`causes` 에 마지막 `RESPONDER_KILLED`, 같은 id 가 `u.oosEv`). ④ **모두 후송된 부대**: 숨지지 않은 대원을 모두 `care = 'hospital'` 로 두면 `crewLeft === 0`·`crewReady === 0`, 기지에 닿으면 '${호출부호} 남은 대원 모두 병원 이송 — 운용 중단.'. 소방 헬기·구조정은 다친 사람이 없으면 `crewReady === fieldCrew(sim, u).length`(2)라 배정된다(내리지 않는 자리를 세지 않는다).
14. **R1 의 시험 ⑨ 가 바뀐다**: 4b 부터 자리 셈이 `seatsUsed` 이므로 R1 `tests/crews.test.ts` ⑨(매 틱 `patients.length ≤ seatsOf`)를 `seatsUsed(sim, u) ≤ seatsOf(u)` 로 고친다(이 묶음이 고치는 남의 시험 — 보고에 적는다).
13. **고아 부대 없음**: 4교대(`armed/shooter` 둘, 보통 둘) 끝에 이미 닫힌 사건 소속으로 `onscene` 인 부대가 없다.

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
| | `agentHealth` | 기록(1) → §3.2 전체(종료 뒤 멈춤, `tDown ??=`, 순직, 부상 조건, 자기 보고)(4a) | 1·4a |
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
| | 새 case `treatMate`·`treatSuspect` | §3.4·§4.3 (대상 좌표 끌기, 고아 부대 `release`, `firstLoadAt`) | 4b·5 |
| `field/agents.ts` | `staminaF` | `× hurtF(r)` | 4a |
| | 새 `seatsUsed`(R1 `seatsOf` 옆) | 쓰인 자리 = `patients` + 다른 부대 대원·용의자의 `aboard`(§3.4-5). R1 의 비교 자리 넷이 이것을 본다 | 4b |
| | `casFact` 옆 | `mateFact(sim, s, b, status, src, d)` | 4a |
| | `hosFact`, `significant`, `perceive` | `mate`: 보고 조건(`status`·`dead`·`band`·`tq`), 보는 대상(`down` + 2칸 안의 `withdrawn`), 배우는 조건 `significant`(4a). `hos`: 필수 인자 `d`, 칸·문구, `where`(5) | 4a·5 |
| | `workLabel`·`fitFor`·`canCarryPatients` | `rescueMate` 의 `hot`·`fireRisk`(R1 이면 `scba` 자격)(4a), `treatMate`(`a.rid !== w.mate`, hot 이면 safe 만)(4b), `treatSuspect`(hot 술어, `fireRisk`)(5), 자리 셈에 다른 부대·용의자의 `aboard`(R1 의 `seatsOf` 그대로)(4b) | 4a·4b·5 |
| `field/commander.ts` | `rescueMate` 를 내는 줄(340) | 숨진 동료 0.55 | 4a |
| | `manageAmbulances` | `!u.patients.length` 건너뛰기에 `aboard`, `firstLoad` → `u.firstLoadAt`, `redAboard` 진실 읽기 제거 | 4b |
| | `outstanding` | 인자 `now`, `mates`, 오래된 `mobile` | 3·4a |
| `field/brain.ts` | `dangerScore` | `health < 40 \|\| (bleed ≥ 0.06 && health < 70)` 이면 물러남(자기 몸) | 4a |
| `field/rules/disaster.ts` | 해일 | drown 기록(1) → `hurtCas`(하한 8 을 지키는 양)·`hurtResponder`(3·4a) | 1·3·4a |
| `field/scenes/index.ts` | import | `../rules/injury`, `../orders/injury` | 1 |
| `sim/resources.ts` | `crewReady`·새 `crewOk`·`crewLeft` | 부대에 살아 있는 대원이 없으면(전원 순직·모두 후송) 0, 아니면 `crewOk` 그대로 — 부분 결원은 관제의 −18 감점만(§3.6 사용자 결정). 값은 R1 의 `crewReady` 와 같다 | 4b |
| | `tickUnits` 의 `hospital` | `aboard` 인계와 `u.aboard = []`·`firstLoadAt` 지우기 — `patientsIncident` 블록 **밖에서** | 4b |
| | `arrive` 의 `returning` | `oos` 문구를 까닭(전원 순직·남은 대원 모두 후송·남은 대원 모두 다침)에 따라, `causes`·`u.oosEv` | 4b |
| `scripts/metrics.ts` | `PHRASE.T4`·`PHRASE.T6` | 새 인계·운용 중단 문구를 잡게 넓힌다(§3.4-4·§3.6). `tests/causality.test.ts` 통과 | 4b |
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
5. **R1 이전에 구현하게 되면**(순서가 바뀌면) 방호는 §2.4 의 "지금"·"새로" 열, `crewOk`·`crewLeft` 는 `fieldCrew` 대신 `u.crew`, 자리는 구급차 2·헬기 1 로 동작한다. R1 이 합쳐질 때 `protection()`·`treatEffect()`·자리 셈과 `crewOk`·`crewLeft` 가 세는 대상(`fieldCrew`)만 바꾼다. R1 은 대원 수를 크게 늘리므로(보통 34 → 63명) §9 의 목표는 R1 을 합친 뒤에 다시 잰 기준값과 견준다.
6. **정보 격리 예외**: `commander.ts:544` 를 고치면 결과가 조금 바뀐다(4b 단계 안에서 함께 잰다). README "알려진 문제"의 예외 3건은 늘리지 않는다.
7. **속도(P1)**: `rules/injury.ts` 는 매 틱 모든 현장에서 돈다. 다친 사람이 없는 현장은 첫 줄에서 돌아가게 하고, 배열을 새로 만들지 않는다(기록은 원인마다 한 줄을 고쳐 쓴다).
8. **자해** 같은 민감한 장면은 사용자 요청에 없었다. **사용자 결정(2026-11-15): 끈다.** 경로만 만들고 `SELF_HARM = 0` 으로 둔다(§4.5). 값을 올리려면 사용자의 새 결정이 있어야 하고, 그때도 0.08 안팎에서 한 줄의 담담한 기록으로만.
9. **G4·G5 와의 화면 충돌**: 딱지·'hit' 효과를 함께 고칠 수 있다. G5 는 이미 합쳐졌으므로 'hit'·피 제거는 G5 의 것을 그대로 두고, 딱지 그림 함수는 H1 이 만든다(G4 는 사람 딱지를 만들지 않는다). 원칙(피·붉은 조각 없음, 중증도 색은 `triage.ts`)을 지킨다. `hazards.ts`·`executor.ts` 의 피해 줄에는 G5 의 꼬리표 줄이 끼어 있다 — `hurt*` 로 바꿀 때 지우지 않는다.
10. **종료 뒤 악화를 멈추면 교대 보고서의 숫자가 조금 바뀐다**(§2.6): 지금은 사건이 닫힌 뒤 대원이 떠나기 전까지 현장의 구조 대상이 숨질 수 있고, 그 사망이 교대 요약에는 들어간다. 3단계의 sweep 비교에서 구조율과 함께 본다.
11. **목적별 난수 흐름**: `injuryRng(sim, s, purpose)` 의 이름은 한 번 정하면 바꾸지 않는다(이름이 곧 흐름이다). 새 소비자는 새 이름을 쓴다.

### 12.3 결정 사항 (조사에서 열려 있던 질문)

| 질문 | 결정 | 이유 |
|---|---|---|
| 원인을 새 칸에 저장하나 | `Injury[]`(원인마다 한 줄) + `bleedCause`·`deathCause` | `causeEvent` 는 이벤트 id 하나라 원인 종류를 말하지 못한다 |
| 추락·감전·익수·탈진 규칙 | 탈진·잔해 바닥 추락은 새로. 감전은 공식만. 대원 익수는 R2. 사다리·창문 추락은 어느 묶음도 만들지 않는다(R2 §10, ROADMAP C4) | 지금 그런 일이 생기는 현장이 없는 것은 억지로 만들지 않는다 |
| 대원 순직 | 허용. 출혈이 있는 쓰러짐 + 문턱(이 틱 시작 때 41 이상이면 그 틱 안에서 0 불가, 쓰러진 대원의 출혈 상한 0.04) | "드물게, 설명할 수 있게" |
| 용의자 즉사 | 없다 — 쓰러지지 않은 용의자는 한 번 피해로 0 아래로 가지 않는다(`HOSTILE_LEFT`). 쓰러짐은 `hurtHostile` 안에서 바로 | 지금 식으로는 총에 맞아 쓰러진 용의자의 78% 가 그 순간 숨져 사망 비율을 맞출 손잡이가 없다 |
| 출혈로 물러나는 조건 | `bleed ≥ 0.06` 이고 `health < 70` | 0.03 하나면 총알 한 발에 모든 대원이 물러난다(§2.2) |
| 대원 체력이 성능에 | `hurtF`(70 → 40 에서 1 → 0.75) | 지금은 40 아래 전까지 영향 없음 |
| 경상은 처치 뒤 복귀하나, 교대 중 회복 | 둘 다 아니다(지금 그대로). `injured` 는 교대 끝까지 쓰지 않는다 | 균형을 크게 흔들지 않는다. 교대 사이의 회복은 I2 |
| 다친 대원의 구급차·병원 | 넣는다(`treatMate`, `Unit.aboard`, 병원 인계) | 사용자 요청의 "후송" |
| 용의자 `down` 을 나누나 | `state` 는 그대로 두고 `dead` 칸을 따로. 쓰러짐은 15 | 기존 `down` 의 뜻과 테스트를 지킨다 |
| 용의자 사망과 판정 | 위협이 끝난 뒤(`threatOverAt` — 무장은 안전 확보, 그 밖은 첫 도착)에 숨진 경우만 0.5 | §4.4 |
| 경찰 호송 | 기계적으로 모델하지 않는다 | §4.3 |
| 판정 뒤 숨짐·병원 뒤 결과 | 사건이 끝나면 세 부류 모두 악화·사망 판정을 멈추고 `hurt*` 도 아무것도 하지 않는다. 병원 뒤 결과 없음 | 판정과 기록이 어긋나지 않게. `loaded` 만 멈추면 현장·안전 구역의 구조 대상, 출혈하는 용의자, 안전 구역의 대원이 판정 뒤에 숨질 수 있다 |
| 자해 | **사용자 결정(2026-11-15): 끈다.** 경로만 만들고 `SELF_HARM = 0` 으로 확정 — 값을 올리지 않는다 | 요청에 없던 민감한 장면. 꺼 두기를 추천했고 사용자가 "전부 추천대로"로 정했다 |
| 부대의 운용 중단 | **그 부대 대원이 전부 숨졌을 때만** — 사용자 최종 결정(2026-11-15). 다치거나(`injured`·`down`) 일부가 숨진 부대는 −18 감점만 받고 계속 출동한다. `resources.crewReady` 는 부대에 살아 있는 대원이 없을 때(전원 순직·모두 후송) 0, 아니면 `crewOk` 그대로(§3.6). 쓰지 않는 안: (가) 최소 편성 부대(`minField` 미만)는 부상 한 명으로 중단, (나) 순직 대원이 하나라도 있으면 중단 | 사용자 원문: "운용을 멈추는 건 그 부대 전부 죽었을 때로. 하나라도 다치거나 죽으면 멈추는 건 너무 그렇다." 모두 후송돼 빈 부대가 빠지는 것은 규칙이 아니라 사람이 없어서다. 관제는 복귀 중인 부대도 배정하므로 사람이 없는 부대는 기지 도착 때의 `oos` 만이 아니라 `crewReady` 에서 0 이어야 한다. `dispatch/*` 는 고치지 않는다 |
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
- **사용자 최종 결정(2026-11-15) — 결원 규칙**: "운용을 멈추는 건 그 부대 전부 죽었을 때로. 하나라도 다치거나 죽으면 멈추는 건 너무 그렇다." 부대의 운용 중단은 그 부대 대원이 전부 숨졌을 때만이고, 다치거나 일부가 숨진 부대는 −18 감점만 받고 계속 출동한다. 모두 후송돼 빈 부대가 빠지는 것은 규칙이 아니라 사람이 없어서다. 앞서 적혀 있던 두 안 — (가) 최소 편성 부대(`minField` 미만)는 부상 한 명으로 운용 중단(§3.6 에 '사용자 확정'으로 잘못 적혀 있었다), (나) 순직 대원이 하나라도 있으면 중단(§9.3-6 의 대안·로드맵에 한때 적힌 안) — 은 둘 다 쓰지 않는다. 고친 곳: 연관 표의 R1 줄(H1 은 `minField` 를 쓰지 않는다), §3.6(결정 문단·`crewReady`/`crewOk`/`crewLeft` 코드·`arrive` 문구·`PHRASE.T6`), §6.4, §9.1·§9.2 의 지표(목표 → 보고 지표), §9.3-6(대안 손잡이를 지웠다), §10 의 4b, 시험 12, §12.1·§12.2-5·§12.3. `crewReady` 의 값은 R1 의 것 그대로라 결원 규칙이 배정 결과를 따로 바꾸지 않는다.
- **수치의 출처** — "대원 피격 2건·RESPONDER_HURT 0건"(보통·`armed/shooter` 각 3교대)은 검토의 작은 측정을 옮겼다. 이번 수정에서는 다른 작업이 CPU 를 쓰고 있어 sweep 을 다시 돌리지 않았다. "쓰러질 때 이미 0 이하 78%(48~78 에서 시작하면 69%)"는 몬테카를로로 다시 계산해 확인했다.

