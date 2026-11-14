# H1 — 부상과 사망

공통 규칙은 `docs/specs/README.md`. 브랜치 `wf/injuries`, 개발 서버 포트 **5210**.

사용자의 말: "대원이나 용의자, 요구조자의 부상이나 사망도 가능하게."

풀어 쓰면: 대원·용의자·구조 대상(요구조자) 세 부류 모두 사건 중에 다치고, 숨질 수도 있다. 원인(총상·자상·화상·연기·추락·잔해·폭발·익수·감전·탈진 등)에 따라 다치고, 다친 정도가 행동·처치·이송·판정·보고서·화면에 드러난다. 이미 있는 것(구조 대상의 사망, 대원의 부상·쓰러짐, 용의자의 `down`)은 살리고, 빠진 것과 세 부류 사이에 고르지 않은 것을 채운다.

이 문서는 다음 구현 세션이 이 문서와 `CLAUDE.md` 만 보고 끝까지 만들 수 있게 쓴다. 줄 번호는 2026-11-14 `1ca465d` 기준이다. 다른 묶음(B3·P1·R1 …)이 먼저 합쳐지면 바뀌므로 **함수 이름으로 찾는다**. 확신하지 못한 곳은 **(확인 필요)** 로 표시했다.

**자기 파일**(새로): `src/sim/field/injury.ts`(공통 모델), `src/sim/field/rules/injury.ts`(세계 규칙), `src/sim/field/orders/injury.ts`(지휘 규칙 — 믿음만), `src/view/triage.ts`(중증도 색 한 곳), `src/ui/PersonCard.tsx`(구조 대상·용의자 정보창), `tests/injuries.test.ts`.
**공용 파일 수정**: §12 의 표에 적힌 함수만, 가장 작은 조각으로(README §2).
**건드리지 않는다**: `city.ts`, `cityPlan.ts`, `view/city/*`, `renderCity.ts`, `dispatch/*`(배정은 지금의 `crewReady` 로 충분하다), `tests/sim.test.ts`, `README.md`, `CLAUDE.md`, `docs/ROADMAP.md`, `docs/DESIGN.md`.

## 원칙

- **관찰용이다. 잔혹하게 그리지 않는다.** 피 웅덩이·튀는 붉은 조각·신체 훼손을 그리지 않는다. 중증도 분류 색(초록·노랑·빨강·검정), 들것·덮개, 자세, 기록 문구로만 전한다. 순직·사망은 담담하고 정중한 문장으로 쓴다.
- **세 부류가 한 모델을 쓴다.** 같은 원인 이름(`InjuryCause`), 같은 중증도 단계(`bandOf`: 경상·중상·위중·사망), 같은 기록(`Injury`), 같은 처치 공식.
- **피해는 한 길로만 준다.** 체력을 깎는 모든 곳은 `injury.ts` 의 `hurtCas`·`hurtResponder`·`hurtHostile` 을 거친다. 부상 기록과 기록 문구(`emit`/`raiseProblem`)는 그 함수, 곧 상태를 바꾸는 곳에서 남긴다(가짜 연출 금지).
- **정보 격리.** 누가 얼마나 다쳤는지 지휘관은 보고(`mate`·`hos`·`cas` 사실)로만 안다. `commander.ts`·`orders/*`·`brain.ts` 의 판단부·`dispatch/*` 는 **다른 사람의** `health`·`bleed`·`injuries`·`dead` 를 읽지 않는다. 대원이 자기 몸을 아는 것(`brain.ts` 의 `resp(sim, a).health`)은 된다. `commander.ts:544` 의 진실 읽기(`redAboard`)는 이번에 믿음으로 바꾼다(§3.4).
- **재현성.** `s.rng` 의 호출 수와 순서를 바꾸지 않는다. 기존 피해량을 뽑는 `s.rng.range(…)` 는 그 자리·그 순서 그대로 두고 **뽑은 값만** 새 함수에 넘긴다. 새 확률은 `injuryRng(sim, s)` 만 쓴다(`damage.ts` 의 `dmgRng` 과 같은 모양: `WeakMap<Scene, Rng>` 에 `sim.rng.fork('injury:' + s.id)`).
- **대원의 순직은 드물게.** 보통 난이도에서 교대 50번에 한 번 이하(§9).
- **모든 사건은 끝난다.** 쓰러진·숨진 대원, 쓰러진 용의자가 있어도 `LIMIT`·`hardCap`·`sceneManager` 7번 블록으로 끝나는지 본다.
- **관찰만 한다.** 사람을 눌러 정보창을 여는 것은 "관찰 대상 선택"이라 된다. AI 에게 명령하는 입력은 만들지 않는다.

## 연관 설계서와 나누는 선

구현 순서는 `docs/ROADMAP.md` "진행 중"대로 **R1 → H1 → X6 → R2 → R3 → I1-b → I2** 이고, G4·G5·U2 는 따로다 — G5(교전 연출)·U2 는 이번 세션이 먼저 구현하고 G4 는 시간이 되면 먼저 들어간다. 그래서 다음 구현 세션이 H1 을 시작할 때는 **R1 과 G5 가 이미 합쳐져 있다고 보고**, 아니면 각 절의 "R1 없이"·"G5 없이" 대체를 쓴다. 같은 날 쓰인 `R1-crews.md`(포트 5211)·`R2-methods.md`(5213)·`G4-scene-legibility.md`(5212)·`G5-combat-fx.md`(5225)를 읽고 이름을 맞췄다. **R1 이 먼저 합쳐지므로 R1 의 이름이 기준이다.** `X6-catastrophe.md`·`I2-persistence.md` 는 아직 파일이 없다(로드맵에 이름만 있다).

| 설계서 | 겹치는 곳 | 나누는 선 |
|---|---|---|
| R1 부대 편성·개인 장비·헬기 | 방호, 처치 수준, 환자 자리, 결원, 들것, 테이저 | R1 이 부서 계수를 사람 장비로 옮긴다: `Responder.kit`, `hasKit`·`kitWorks`, `armorOf(sim, rid, engaging)`, `blastFactor(sim, rid)`, `scba`(공기 `uses`)·`turnout`, `medLevelOf(sim, rid)`, `seatsOf(u)`, `minCrew(kind)`, `stretcher`, `taser`(0.72 확률로 3.2초 무력화). H1 의 `protection()` 은 이 함수들을 **읽기만** 하고(§2.4), 환자 자리는 `seatsOf`, 결원은 `minCrew` 를 쓴다. R1 은 `agentHealth`·`blast`·`tickHostiles` 의 피해 식에서 "방호" 부분만 함수로 꺼내 두고, H1 은 그 위에서 피해 식 전체를 `hurtResponder` 로 옮긴다. R1 뒤에는 대원이 보통 34명 → 63명으로 는다(부상 기회도 는다 — §9 는 R1 을 합친 뒤의 기준값으로 잰다) |
| R2 대응 방식 다양화 | 헤엄 구조(익수), 급박 구출·터널, 비살상탄·저격 | 원인 이름·`hurt*` 는 H1, 언제 그 방법을 쓰는가와 사고 확률(R2 의 `mrng`)은 R2. R2 가 `health` 를 직접 깎는다고 적은 자리는 아래처럼 `hurt*` 를 부른다: 헤엄 중 사고 → `hurtResponder(…, 'drown')`(방호는 R2 의 사고 확률 식이 `pfd`·`drysuit` 로 이미 줄였으므로 `protection('drown') = 0`), 급박 구출의 환자 −10 → `hurtCas(…, 'blunt')`, 터널 붕락 대상 −8·대원 −6 → `crush`, 비살상탄 −8 → `hurtHostile(…, 'blunt')`, 저격 −70 → `hurtHostile(…, 'gunshot', { down: true })`(§4.2 — 70 으로는 체력 100 에서 쓰러지지 않으므로 "한 번에 쓰러뜨림"을 켠다). **물 위의 대원은 R2 의 규칙을 받아들인다(결정)**: R2 는 H1 이 있으면 체력 하한 18 을 두지 않고, 헤엄 중 체력 30 아래면 사고로 끝내 뭍으로 보내며(`ashore`), 그래도 물 칸에서 `down`·순직이 생기면 `rules/methods.ts` 가 그 대원을 가장 가까운 뭍 칸으로 옮긴다(R2 §3.5). H1 쪽은 두 가지만 지킨다 — ① `rescueMate` 실행기는 대상이 선 칸이 `T.WATER` 이면 끝내지 않고 물가에서 기다린다('물가 대기', `return` — 실패로 끝내면 8초 보류가 되풀이된다). 옮겨지면 실제 위치로 간다. ② 한 대원을 두 번 옮기지 않는다: R2 의 이동은 물 칸에 있을 때만, `rescueMate` 의 끌기는 뭍에서만 일어난다 |
| G4 현장 가독성 | `renderScene.ts`, `tickFire`·`tickCollapse` 의 붕괴 기록, 소리·카메라·자동 감속 | G4 는 구조 대상 그림(328줄 근처)과 'hit' 효과를 건드리지 않는다고 적었다 — 사람 그림은 H1 이, 'hit' 은 G5 가 고친다. 붕괴 자리에는 G4 의 기록 한 줄과 H1 의 원인·갇힘이 함께 들어간다(둘 다 살린다). `audio.ts`·`marks.ts`·`MapLegend.tsx` 는 G4 가 맡는 파일이라 H1 은 소리 분기 하나(§8.6)만 더한다. 중증도 색은 `view/triage.ts` 한 곳(H1). G4 가 먼저 합쳐졌으면 G4 의 그림 규칙(크기·색·표지)을 따른다 |
| G5 교전 연출 (H1 보다 먼저 구현) | 피 표현, 'hit' 효과, 피해 줄의 꼬리표 | G5 §3.9 가 `drawLying` 의 `blood` 옵션·붉은 타원과 'hit' 의 붉은 조각을 이미 지운다(흰 고리 + 회색 먼지 + 피격 불꽃). **'hit' 의 모양은 G5 를 따르고 H1 은 다시 그리지 않는다.** H1 은 남은 붉은 표현이 없는지 확인만 한다(§8.2, 시험 11-10). G5 는 H1 이 `hurt*` 로 바꿀 바로 그 피해 줄(`shootAt` 의 `if (hit)`, `tickHostiles` 의 대원 피격·흉기·맨손, 총격범의 시민 사격)에 `noteHit(lastFx(…))`·`recMelee(…)` 를 끼운다(G5 §2 표 3·5·6·7행). **피해 줄을 `hurt*` 로 바꿀 때 이 꼬리표 줄은 그대로 둔다**(피해 식과 무관하다). G5 가 없으면 §8.2 의 'hit' 원칙(붉은 조각 없음)을 H1 이 직접 지킨다 |
| X6 위험의 현실화 (H1 다음) | 실제 붕괴·폭발·전소의 사상자 | X6 가 사람에게 주는 피해는 모두 `hurt*`(원인 `crush`·`blast`·`burn`)를 부르고, 무너진 자리 곁의 구조 대상 갇힘은 §5.1 의 규칙(반경·`injuryRng(…, 'trap')`)을 쓴다. 설계서가 아직 없으므로 X6 를 쓰는 쪽이 이 줄을 옮겨 적는다 |
| I2 교대 간 지속 · K1 대원 성장 | 다음 교대 결장 | H1 은 교대 끝의 명부 상태(`ShiftReport.roster`)를 **내놓기만** 한다. 저장과 `Sim` 생성자 입력은 I2(로드맵상 대원 상태를 다음 교대로 넘기는 묶음)가 맡고, K1(경험치·명부 저장)이 먼저 들어가면 K1 이 같은 칸을 읽는다 |
| R3 대응 교본 | 다친 대원의 행동 | R3 는 H1 의 `bandOf`·`hurtF`·`r.bleed`(자기 몸) 와 믿음 술어 `mateNeedsHospital`(남의 몸 — §2.7)을 "상태" 입력으로 읽는다. 지휘 쪽에서 `needsHospital`(진실)을 읽지 않는다 |

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
/** 교대 끝의 명부 상태 — I2(교대 간 지속)가, 그보다 먼저 K1 이 들어가면 K1 이 다음 교대의 입력으로 쓴다 */
export interface RosterOut { rid: number; health: number; band: number; dead: boolean; hospital: boolean; out: number; cause: InjuryCause | null }
/** 지휘관이 아는 동료의 상태 ('mate' 사실의 값). CasBelief 옆에 둔다 */
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

`difficulty.ts` 의 `Tuning` 에 `injuryMul: number` 하나 — 심각도 손잡이에서 `[0.75, 0.9, 1, 1.12, 1.25]`(가운데 1). 새 난이도 손잡이(화면의 조절 막대)는 만들지 않는다.

### 2.2 중증도 단계 — 세 부류 공통

`hazards.ts:19` 의 `band` 를 `injury.ts` 의 `bandOf` 로 옮기고 `hazards.ts` 는 `export const band = bandOf;` 로 다시 내보낸다(식은 그대로: `h ≤ 0 → 3, h > 70 → 0, h > 40 → 1, 그 밖 2`). `renderScene.ts:311` 이 손으로 다시 쓴 같은 식도 `bandOf` 로 바꾼다.

**`injury.ts` 는 잎 모듈이다.** import 하는 것은 `types.ts`·`events.ts`(`emit`·`raiseProblem`)·`util.ts`(`clamp`·`josa`)·`rng.ts`(타입)·`engine.ts`(타입만, `import type`)와 R1 의 `crews.ts`(`armorOf`·`blastFactor`·`medLevelOf`·`kitWorks`)뿐이다. `agents.ts`·`hazards.ts`·`executor.ts`·`sceneManager.ts`·`resources.ts` 를 import 하지 않는다 — `hazards.ts` 가 `bandOf` 를, `agents.ts` 가 `hurtF` 를 import 하므로 거꾸로 부르면 `hazards → injury → agents → hazards` 순환이 생기고, `hazards.ts` 의 `export const band = bandOf;` 가 모듈 초기화 중에 아직 정의되지 않은 값을 읽을 수 있다(CLAUDE.md 의 "시나리오 표는 추격전을 import 하지 않는다"와 같은 종류). 그래서 `bandOf` 는 화살표 상수가 아니라 `export function bandOf(h: number): number` 선언으로 쓴다(선언은 끌어올려진다). 가까운 작업 항목을 끝내는 일(`finishTask`)처럼 실행기가 필요한 것은 부르는 쪽(`agentHealth`)이 한다.

| band | 이름 | 체력 | 색 | 구조 대상 | 대원 | 용의자 |
|---|---|---|---|---|---|---|
| 0 | 경상 | > 70 | 초록 | 걸을 수 있으면 스스로 대피, 처치·이송 없음(지금 그대로) | 그대로 일한다 | 그대로 |
| 1 | 중상 | 41~70 | 노랑 | 처치·이송 | 느려진다(`hurtF`). 대부분 계속 일한다 — 상처 출혈이 크고(≥ 0.06) 체력이 70 아래일 때만 물러난다 | 체력 60 아래 사기·속도 저하(지금 그대로) |
| 2 | 위중 | 1~40 | 빨강 | 먼저 처치·이송. 걷던 사람도 멈춘다(새로) | 물러난다(40 아래, 지금). **15 이하 쓰러짐** | **15 이하 쓰러짐(무력화)** — 지금은 0 이하 |
| 3 | 사망 | ≤ 0 | 검정 | 덮개 | 순직 | 사망 |

`injury.ts` 의 상수: `DOWN_AT = 15`(대원·용의자가 쓰러지는 체력), `HURT_AT = 40`(대원이 물러나는 체력), `MATE_RETREAT_BLEED = 0.06` + `MATE_RETREAT_HP = 70`(출혈로 물러나는 조건은 둘 다 — §2.5), `MATE_LETHAL_FROM = 41`(대원 문턱 — §2.6), `DOWN_BLEED_CAP = 0.04`(쓰러진 대원의 출혈 상한), `HOSTILE_BLEED = 0.35`(용의자 상처 출혈 배율), `HOSTILE_LEFT = [4, 15]`(용의자 문턱이 걸렸을 때 남는 체력 범위 — §2.6), `SELF_HARM = 0`(§4.5). 마지막 셋은 §9 에서 조정한다 **(확인 필요: 첫 측정 뒤)**.

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
| fall 추락 | **붕괴 현장의 잔해 바닥(`s.damage[i] === 1`)에 대원이 새로 들어설 때(`a.lastTile !== i`) `0.002 × hazardMul` 확률(`injuryRng(sim, s, 'fall')`)** → 8~20. 대원마다 사건당 한 번(`a.fellOnce`). 기록 문구 '○○ 대원 잔해 위에서 미끄러져 다침.'(`hazard` · 1). G4 의 측정으로 붕괴 현장의 잔해 칸은 24~72칸이라 대원이 수십~수백 번 들어선다 — 상한이 없으면 0.004 로는 대원당 0.4건 가까이 된다. 목표는 붕괴 현장 사건당 0.3건 이하. R2 의 사다리·창문 | 한 번 | | 0.0008 |
| crush 잔해 | 화재의 천장 일부 붕괴(`tickFire`, 지금 `blast(2.2, 22)` — 원인만 crush), 2차 붕괴(`tickCollapse`, `blast(2.6, 28)` — crush, **곁의 구조 대상은 갇힌다** §5), **구출 중 잔해(§5)** | 한 번 | | 0.001 |
| blast 폭발 | 가스 용기(3.6/34), 누출 가스(3.8/32), 폭발물(3.4/55) | 한 번 | `dmg × (1 − d/(r+1))`, 구조 대상·**용의자** ×0.8 | 0.0012 |
| drown 익수 | 물속 구조 대상의 악화(`bleed`, `tickWater`), 해일. R2 의 헤엄 구조: 대원이 물속에 있는 동안 1.2/s | 매 틱 | | 0 |
| electric 감전 | **공식만 둔다**: 한 번 15~35, 30% 확률로 바로 쓰러짐(체력 `min(h, 15)`). 지금 부르는 곳 없음(생활 사건 "끊어진 전선"·재난 규칙이 나중에 부른다) | 한 번 | | 0.0005 |
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

### 2.4 방호 — `protection(sim, r, u, cause): number`

피해에서 빼는 몫(0~0.95). 대원이 받는 피해 = 방호 전 피해 × (1 − 몫). 표의 열은 셋이다.

- **지금** — 지금 코드의 값을 그대로 옮긴 것. 단계 4a 의 첫 커밋(4a-1)은 이 열만 쓴다. 지금 모델이 있는 원인(총상·연기·불·폭발, 그리고 천장·2차 붕괴가 `blast` 로 주던 crush)은 지금 숫자와 같다. 다만 연기를 `1.3 × smoke × (1 − 0.923…)` 처럼 몫으로 계산하면 `0.1 × smoke` 와 부동소수점 끝자리가 다를 수 있다 — 4a 는 어차피 결과가 바뀌는 단계이므로 비트 단위로 같기를 요구하지 않고, 시험 11-3 은 상대 오차 1e-9 로 견준다.
- **새로 (균형 변경)** — 지금 방호가 없던 곳에 새로 주는 값. 단계 4a 의 둘째 커밋(4a-2)에서 켜고, 그 커밋만으로 sweep 을 따로 잰다(원인을 가릴 수 있게).
- **R1 이 있으면** — 사람 장비로. 장비 판정은 효과를 줄 때 부르는 `kitWorks`(숨은 고장이 이때 드러난다)로 한다(R1 규칙). R1 은 `hazards.blast` 의 `dept === 'fire' ? 0.7 : 1` 을 `blastFactor` 로, `tickHostiles` 의 `u.armor` 를 `armorOf(rid, engaging)` 로 이미 바꿔 둔다(R1 §6.3 표) — H1 은 그 함수를 읽기만 한다.

| 원인 | 지금 (R1 없이, 4a-1) | 새로 (균형 변경, 4a-2) | R1 이 있으면 |
|---|---|---|---|
| gunshot | **모든 부대** `u.armor × 0.6` (`u.armor` 는 이미 `tune.armorMul` 이 곱해진 부대 값: 순찰 0.2·기동 0.5·특공 0.75·폭발물 0.6·진압·사다리·구조 0.1·화학 0.15·헬기·구조정 0.05·구급 0) | — | `armorOf(sim, rid, engaging) × 0.6` |
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
export const bandOf = (h: number): number => (h <= 0 ? 3 : h > 70 ? 0 : h > 40 ? 1 : 2);
export function injuryRng(sim: Sim, s: Scene): Rng;                              // WeakMap, sim.rng.fork('injury:' + s.id)
/** 기록만 한다 (체력은 건드리지 않는다). 1단계는 이것만 쓴다 */
export function noteInjury(list: Injury[] | undefined, cause: InjuryCause, dmg: number, t: number, sevAfter: number, by = -1, byKind: Injury['byKind'] = 'world', ev = -1): Injury[];
interface HurtOpts { by?: number; byKind?: Injury['byKind']; ev?: number; tick?: boolean; bleed?: number; immobile?: boolean }
//  tick: 매 틱 피해 (문턱 없음, 기록 문구 없음) · bleed: 구조 대상의 bleed 를 이 값 이상으로 올린다 · immobile: 구조 대상을 걷지 못하게 한다
export function hurtCas(sim: Sim, s: Scene, I: Incident, c: Casualty, amount: number, cause: InjuryCause, o?: HurtOpts): void;
export function hurtResponder(sim: Sim, s: Scene, I: Incident, a: FieldAgent, raw: number, cause: InjuryCause, o?: HurtOpts): number;   // 방호·문턱·출혈·기록. 깎인 양을 돌려준다. 상태 전이는 하지 않는다(agentHealth 가 한다)
export function hurtHostile(sim: Sim, s: Scene, I: Incident, h: Hostile, amount: number, cause: InjuryCause, o?: HurtOpts): void;
export function protection(sim: Sim, r: Responder, u: Unit, cause: InjuryCause): number;
export function hurtF(r: Responder): number;
export function treatEffect(sim: Sim, rid: number, health: number): { q: number; heal: number; bleedK: number };   // 처치 질과 효과 (treat 에서 꺼낸 것 — R1 의 medLevelOf·aed·doctorKit 포함)
export function needsHospital(r: Responder): boolean;     // !dead && care !== 'hospital' && (tDown 있음 || bleed ≥ 0.01 || health ≤ 40)
export function mainCause(list: Injury[] | undefined): InjuryCause | null;      // dmg 가 가장 큰 원인
```

`hurtCas` 는 체력이 0 이하가 되면 그 자리에서 `deathCause` 를 정한다(`dead` 는 지금처럼 `tickCasualties` 가 다음 틱에 세운다. `deathCause` 가 이미 있으면 그쪽이 덮어쓰지 않는다).

---

## 3. 대원

### 3.1 다치는 경로 (정리)

연기·가스(`agentHealth`), 불(`agentHealth`), **열 탈진**(새로, `rules/injury.ts`), 폭발·천장 붕괴·2차 붕괴(`blast`), 용의자의 총격(`tickHostiles`), 흉기·맨손(**방호·기록·`hurtEv` 새로**, 기록 문구 '○○ 피습 (흉기)' imp 2), **덮쳐 제압할 때의 몸싸움**(새로, `executor` `engage`), 2차 사고(`tickLane`), 해일(`rules/disaster.ts`), **붕괴 현장의 잔해 바닥 추락**(새로), R2 의 익수·추락. 모두 `hurtResponder` 를 거친다.

### 3.2 상태 전이 — `sceneManager.agentHealth` 한 곳에서, 이 순서로

```
if (r.dead) return;                                      // 숨진 대원은 더 바뀌지 않는다
연기·가스·불: hurtResponder(…, { tick: true })            // 1.3×smoke, 9×fire 에 방호 (지금 숫자와 같다)
상처 악화: r.health -= r.bleed × 배율 × dt (§2.6)
health ≤ 0                         → 순직 (아래)
health ≤ 15 && a.status !== 'down' → 쓰러짐: 지금 그대로 + r.tDown = sim.t (이미 withdrawn 이면 withdrawn 유지, 기록 없음 — 지금 그대로)
(health < 40 || bleed ≥ 0.03) && r.status === 'ok' → 부상: r.status = 'injured', RESPONDER_HURT (지금 그대로 + 출혈 조건), 자기 보고
```

`if (r.health < 1) r.health = 1;`(`sceneManager.ts:137`)는 지운다(문턱은 `hurtResponder` 가 맡는다).

- **순직**: `r.dead = true; r.tDead = sim.t; r.health = 0; r.status = 'down'; r.deathCause = …`, `finishTask(…, 'preempt')`(업고 있던 사람을 내려놓는다 — 지금 쓰러짐과 같다), `a.status` 는 `withdrawn` 이면 그대로, 아니면 `'down'`, `a.label = ''`. `raiseProblem(I, 'RESPONDER_KILLED', detail, { role: 'SYSTEM', actor: '현장', rid, imp: 3, causes: [a.hurtEv], text: '${이름} 대원 생체 반응 소실.' }, false)`. 원인 = 숨진 틱의 가장 큰 피해 항, 없으면 `mainCause`. `detail` 은 숨지는 그 자리에서 상태로 만든다: '김도윤 대원(진압1) — 화상' 에, `tDown` 이 있으면 안전 구역에 옮겨지지 않았을 때 ', 쓰러진 뒤 1분 50초 동안 구조되지 못함', 옮겨졌으면 ', 안전 구역에서 후송을 기다리던 중' 을 붙인다(`a.status === 'withdrawn'` 으로 가린다).
- **RESPONDER_HURT 의 문구**: detail '○○ 대원 부상 (총상)'(물러남) · '○○ 대원 쓰러짐 (화상)'(쓰러짐). 지금의 '중상' 은 중증도 이름(41~70)과 겹치므로 '쓰러짐' 으로 바꾼다. `causes: [a.hurtEv]`(지금은 `a.lastBlockEvent` — 진입로 차단 기록에 잘못 이어진다).
- **자기 보고**: 물러나는 대원은 말할 수 있다. `injured` 가 되는 순간 `transmit(sim, s, a, -1, 'report', [mateFact(…, 'hurt')], '', -1, 0, [], true)`(조용히 — RESPONDER_HURT 가 이미 알렸다, "로그 중복" 함정). 안전 구역에 닿아 `withdrawn` 이 될 때(`executor` `retreat`) 한 번 더 `'safe'` 로. 쓰러진 대원은 보고하지 못한다(지금처럼 본 사람이 알린다).

`mateFact(sim, s, b, status, src)` 는 `agents.ts` 의 `casFact` 옆에 둔다. 값:

```ts
{ x, y, status: 'down' | 'hurt' | 'safe' | 'evac', band, bleeding: boolean, tq: 0 | 1 | 2, dead: boolean, wasDown: boolean, since: number }
```

(사실의 칸 이름을 `bleed` 가 아니라 `bleeding` 으로 하는 것은 §11-8 의 검사가 `.bleed` 를 진실 읽기로 잡기 때문이다.) `perceive` 의 쓰러진 동료 보기(`agents.ts:204-210`)는 `mateFact` 를 쓰고, **`dead` 는 2칸 안에서만** 안다(멀리서는 쓰러진 것만 보인다). `significant()` 의 `mate` 는 지금 `status` 만 본다 — `dead`·`band`·`tq` 가 바뀌어도 보고하게 넓힌다(안 그러면 숨진 것이 지휘관에게 가지 않는다).

### 3.3 위중·사망이 가능한 조건과 목표 빈도

- 가능: ① 쓰러진 채 구조되지 못함(상처 출혈, 누운 자리의 연기·불). ② 이미 다쳐 체력 40 이하인 대원이 한 번 더 크게 다침(물러나는 도중의 총탄, 폭발).
- 불가능: 멀쩡하던 대원(41 이상)이 한 번에 숨지는 것(§2.6 문턱). 탈진으로 숨지는 것.
- 목표: 보통 **교대당 순직 ≤ 0.02**(60교대에 0~1건), 쓰러짐 ≤ 0.1. 어려움 순직 ≤ 0.05, 극한 ≤ 0.15.

### 3.4 쓰러진 동료 구조와 후송

1. **구조(`rescueMate`, 지금)**: 쓰러진 줄 알면 0.97·2명. **숨진 줄 알면 0.55**(수습 — 산 사람의 일보다 뒤). `fitFor` 에 `fireRisk` 를 넣는다: 불·가스·붕괴 위험 구역 안이면 소방만(R1 이 합쳐져 있으면 R1 의 실내 진입 자격 — `scba` 를 든 대원만) 들어간다(구조하러 들어간 경찰이 다시 쓰러지는 연쇄를 막는다). 끌고 가는 동안 화면은 들것(§8). 도착 문구: 살아 있으면 지금 그대로, 숨졌으면 '순직한 ○○ 대원을 안전 구역으로 옮겼습니다.'. `executor` 의 `rescueMate` 는 대상이 `down` 이 아니면 끝나는데, 끝날 때 `learn(…, mateFact, true, true)` 로 강제 보고한다(낡은 믿음 함정).
2. **처치·후송(`orders/injury.ts` + `executor` `treatMate`)** — `mate` 사실이 `hurt`·`safe` 이고 숨지지 않았고 처치가 필요하거나 병원이 필요한(`band ≥ 2 || bleeding || wasDown`) 대원:
   - 현장에 구급대원(구급 분야, 또는 R1 의 의료 가방을 든 대원 — R1 없이: 구급 분야와 헬기 대원)이 있으면 `k.want('treatMate', { mate: rid, prop: 태울 차 }, 0.8 + 0.06 × band, 1)`. `prop` = 정원이 남은 구급차·헬기 id(`canCarryPatients`), 없으면 −1(처치만).
   - `treatMate` 실행: 대상 `b` 가 `left`·숨짐·`down`(아직 안전 구역에 없음)이면 `learn(…, true, true)` 후 끝. 곁으로 가서(1.3) 처치(§2.6). 끝나면 `r.treatQ`·`bleed` 갱신, '○○ 대원 응급 처치 완료.'(imp 1). `w.prop === a.unitId` 이고 자리가 있으면 이어서 함께 차로 간다(쓰러졌던 대원은 `carrying = -(rid+2)` 로 끌고, 아니면 곁에서 걷는다) → `b.status = 'left'; r.care = 'aboard'; u.aboard.push({ kind: 'mate', id: rid, inc: I.id, t: sim.t })`, mate 사실 `'evac'`, '○○ 대원 ${호출부호}에 탑승 — 병원 후송.'(imp 2).
   - 구급 부대가 없고 오는 것도 없으면(`k.countUnits('ems', 0.7) === 0`) `k.request('ems', '부상 대원 후송', true)`. 출혈이 있는 대원이 20초(`since` 기준) 넘게 기다리면 **그 대원의 부대**(`sim.units[sim.responders[rid].unitId]`)에 `boardOrder = 'transport'` + 기록 '${호출부호}, 부상 대원을 태우고 병원으로 이동하라.'(COMMANDER, imp 2). 구조정(`u.sea`)은 빼고 구급을 기다린다. 구급차에 자리가 없어 처치만 받은 대원도 병원이 필요하면(`needsHospital`) 처치 뒤 20초 안에 자리가 나지 않을 때 같은 지시로 자기 부대가 데려간다.
   - 지휘관 쪽 `cancel`: 믿음상 `evac`·숨짐·처치 끝(`tq` 가 충분)이면 `treatMate` 를 거둔다.
3. **부대가 떠날 때(`sceneManager` 5번 블록)**: 철수든 이송이든, 떠나는 부대의 대원 가운데 `needsHospital` 인 사람은 `u.aboard` 에 넣고 **병원부터 간다**(지금 "환자를 태웠으면 병원부터"와 같은 규칙). 숨진 대원은 넣지 않는다(부대와 함께 복귀). 문구: '${호출부호} 환자 n명·부상 대원 m명 싣고 병원으로 출발.'
4. **병원 인계(`resources.tickUnits` 의 `hospital`)**: `aboard` 의 대원 `r.care = 'hospital'; r.bleed = 0`, 용의자 `h.where = 'hospital'`. 문구 '환자 n명 인계 완료' 에 '부상 대원 m명'·'용의자 k명' 을 붙인다.
5. **정원과 출발**: 자리 수는 R1 의 `seatsOf(u)`(R1 없이: 구급차 2·헬기 1), 쓰인 자리는 `u.patients.length + (u.aboard?.length ?? 0)`. `canCarryPatients`·R1 이 바꾼 탑승 대기열·출발 조건·실행기 `load` 의 자리 검사가 모두 이 합을 본다. R1 의 "위중 환자는 헬기 먼저"는 다친 대원에게도 같다. `commander.manageAmbulances` 도 `aboard` 를 넣어 정원·대기 시간을 센다. 다친 대원이 타면 10초 뒤 출발. `redAboard`(`commander.ts:544`, 진실 읽기)는 믿음으로 바꾼다: 태운 구조 대상의 `cas` 사실 `band ≥ 2`, 또는 `aboard` 에 사람이 있음(R1 이 단계 3 에서 이미 믿음으로 바꿨으면 `aboard` 조건만 더한다).

### 3.5 지휘관이 다쳤을 때

지금의 4번 블록(지휘관이 `active` 가 아니면 경험 많은 주관 부서 대원이 승계)을 그대로 쓴다. 문구만 승계자의 믿음으로 고른다: 승계자가 옛 지휘관의 `mate` 사실을 갖고 있으면 '${이름} 대원 ${순직|쓰러짐|부상}으로 지휘 불능. 지휘권을 승계합니다.', 없으면 지금 문구. 다친 지휘관이 물러나는 도중(아직 `active`)에는 지휘를 놓지 않는다(지금 그대로). 승계가 일어나지 않는 경우(남은 active 대원 없음)는 7번 블록이 받는다 — `outstanding()` 에 `mates`(믿음상 쓰러진 동료 수)를 더하고, 남은 일로 친다: 쓰러진 동료가 있으면 'rescue', 아니면 지금 규칙(`sceneManager` 7번 블록, `commander.outstanding`).

### 3.6 인원이 줄어든 부대

- 현장: 남은 active 대원이 하던 일을 계속한다(지금).
- 배정: 다친 대원은 다음 현장에 내리지 않고(`unitArrived` 의 `status === 'ok'`), 결원 부대는 배정 점수 −18(지금, `dispatcher.ts:66`). 관제 코드는 고치지 않는다.
- 복귀: `crewReady(u) < minCrew(u.kind)`(R1 — 최소 인원 표. R1 없이: 1) 이면 `oos` '${호출부호} 결원으로 운용 중단.' **순직 대원이 있는 부대는 남은 인원과 관계없이 그 교대 동안 `oos`** — '${호출부호} 순직 대원 발생 — 운용 중단.'(드물어 균형에 거의 영향이 없다).
- 인근 도시 지원 대원(`u.aid`)도 같은 규칙을 따른다. 명부 출력(§3.7)에서는 뺀다.

### 3.7 교대가 끝난 뒤 (K1)

`buildReport` 가 `ShiftReport.roster` 를 채운다(인근 도시 지원 대원 제외).

| 교대 끝의 상태 | `out` (다음에 빠지는 교대 수, 제안) |
|---|---|
| 순직 | −1 (명부에서 빠진다. 채울지는 K1) |
| 병원 인계 + 쓰러진 적 있음 | 3 |
| 병원 인계 | 2 |
| `injured`(병원 안 감) | 1 |
| `ok` | 0 (체력이 70 이하로 남은 대원의 회복량은 K1 이 정한다) |

- **K1 이 없을 때(지금)**: 보고서의 대원 목록에 "다음 교대 결장 예상 n교대"만 보이고, 다음 교대는 지금처럼 모두 멀쩡하게 시작한다(아무것도 저장하지 않는다). `Sim` 생성자는 고치지 않는다.
- **K1 이 생기면**: `new Sim(seed, d, len, { roster })` 의 입력으로 이 배열을 받는다. 모양은 K1 이 정하되 `roster` 칸은 지우지 않는다.

### 3.8 문제 코드

- `RESPONDER_HURT`(있음): 물러남·쓰러짐. 문구는 §3.2.
- `RESPONDER_KILLED`(새로) — CLAUDE.md "새 문제 코드" 절차: `types.ts` → `debrief.ts` `PROBLEM_LABEL`('대원 순직') · `order`(**맨 앞** — 분석 문장이 9줄에서 잘려도 빠지지 않게) · 문장 템플릿(§7.2).

---

## 4. 용의자

### 4.1 체력과 부상

`health` 100 에서 시작(지금), 상처 출혈 `bleed`(새로, §2.3 계수 × `HOSTILE_BLEED`). **15 이하에서 쓰러진다**(`tickHostiles` 의 `h.health <= 0` 을 `<= DOWN_AT` 으로, `h.tDown` 기록). **0 이하에서 숨진다**(`h.dead`, `tDead`, `deathCause`). 출혈은 상태와 관계없이(활동 중·쓰러짐·검거) `rules/injury.ts` 가 깎는다. 쓰러진 용의자는 `tickHostiles` 가 건너뛰므로 쓰러진 뒤의 사망 판정도 `rules/injury.ts` 가 맡는다. 검거된(`arrested`) 채로 피를 흘리는 용의자도 `tickHostiles` 가 건너뛰므로 같다 — `state` 는 `arrested` 그대로 두고 `tDown`·`dead` 만 붙인다(검거로 세는 것이 바뀌지 않게). 투항한(`surrendered`) 용의자는 `tickHostiles` 의 체력 검사가 지금처럼 `down` 으로 바꾼다.

### 4.2 수단별 효과

| 수단 | 효과 | 부상 | 사망 |
|---|---|---|---|
| 섬광탄 | 3.8초 무력화, 사기 −0.15 (지금) | 없음 | 없음 |
| 테이저 (R1 의 `taser` — 0.72 확률로 3.2초 무력화, 그동안 덮쳐 검거) | R1 그대로 | 기록만: electric 2, 체력을 1 아래로 내리지 않는다 | 없음 |
| 비살상탄 (R2 의 `beanbag`) | R2 그대로(4초 무력화, 사기 −0.3) | blunt 8 (R2 의 −8 을 `hurtHostile` 로) | 없음 |
| 저격 (R2 의 `sniper`) | R2 그대로 | gunshot 70 + 출혈 | 쓰러짐·사망 가능 |
| 덮쳐 제압 (맨손, 지금) | 검거 | 상대가 `fight` 중이었으면 양쪽 blunt 3~8 (`injuryRng`) | 없음 |
| 사격 (지금) | 명중 30~48 | gunshot + 출혈 | 15 이하 쓰러짐, 그 뒤 처치가 늦으면, 또는 30 이하에서 다시 맞으면 |
| 폭발·불·연기·가스 (새로) | | blast·burn·smoke·toxic | 가능 |

`shootAt` 의 경험치 줄(`if (h.health <= 0) r.xpGained += 0.004`)은 `<= DOWN_AT` 으로. 대원은 쓰러진 용의자를 다시 쏘지 않는다(지금: `hostileActive` 가 `down` 을 빼므로 `engage` 가 끝난다).

### 4.3 처치·이송·호송 — 새 임무 `treatSuspect`

CLAUDE.md "새 임무 종류" 절차대로: `types.ts` `WorkKind` → `agents.ts` `workLabel`('${용의자} 응급 처치')·`fitFor` → `executor.ts` case → `orders/injury.ts` 에서 `k.want()`.

- **지휘(`orders/injury.ts`, 믿음만)**: 믿음상 활동 중인 용의자(`hold`·`fight`·`flee`)가 하나도 없을 때, `hos` 사실이 `down` 이거나 `band ≥ 1`(모르면 2 로 본다)이고 숨지지 않았고 처치가 필요하면 `k.want('treatSuspect', { hostile: id, prop: 태울 차 }, 0.74 + 0.06 × band, 1)`. `prop` 은 **기다리는 구조 대상·대원 가운데 그보다 중증도가 같거나 높은 사람이 없을 때만** 정원이 남은 구급차 id, 아니면 −1(처치만). 숨짐·`aboard`·처치 끝이면 `cancel`.
- **맡는 사람(`fitFor`)**: 경찰은 언제든(기본 처치 — R1 없이 `q` 0.2 안팎, R1 의 `bag`(med .75)을 든 경관이면 0.4 안팎), 구급대원은 현장 안전이 확보된 뒤(`s.secureAt ≥ 0`, `treat` 의 `hot` 규칙과 같다).
- **실행**: 대상이 숨졌거나 `where !== 'scene'` 이거나 더 나은 처치를 할 수 없으면 `learn(sim, a, hosFact(…), true, true)` 로 강제 보고하고 끝낸다. 곁으로 가서 처치(§2.6), '${용의자} 응급 처치 완료.'(imp 1). `w.prop === a.unitId` 이고 자리가 있으면 차까지 옮기고(`rescueMate` 처럼 대상의 좌표를 대원 뒤에 붙인다. `a.carrying` 은 쓰지 않는다 — 그 칸은 구조 대상 id 와 대원 `-(rid+2)` 만 담는다) `h.where = 'aboard'`, `u.aboard.push({ kind: 'suspect', … })`, '${용의자} ${호출부호}에 태워 병원으로.'(imp 2).
- **`hos` 사실**(`agents.hosFact`): 값에 `dead`(2칸 안에서만), `band`(3칸 안에서만), `tq`, `where` 를 더하고, 상태 문구 `down` = '쓰러짐', 숨졌으면 '사망'. `significant()` 의 `hos` 에 `dead`·`tq`·`where` 를 넣는다. `perceive` 는 `where !== 'scene'` 인 용의자를 건너뛴다.
- **호송은 기계적으로 모델하지 않는다(결정).** 경찰관을 구급차에 태우면 그 부대가 반쪽이 되고 돌아올 길이 없어 교착을 만든다. 다친 용의자는 구급차로 병원에 가고 경찰 인계는 모델 밖이다. 이송되지 않은 용의자는 사건이 끝날 때 경찰이 데려간다(지금처럼 아무 처리 없음). 호송은 R3(교본)에서 다시 본다.

### 4.4 용의자의 사망이 판정에 주는 영향 (결정)

- 쓰러진·숨진 용의자는 지금처럼 **검거로 센다**(`suspectsCaught` 의 뜻을 바꾸지 않는다 — `tests/crime.test.ts:261` 이 기댄다). 숨진 수는 `suspectsDead` 로 따로 센다.
- **교전 중(현장 안전 확보 전)에 숨진 용의자는 벌점이 없다.** 경찰의 목표는 위협을 끝내는 것이고, 무장한 용의자와의 교전에서 생긴 결과다.
- **현장 안전이 확보된 뒤(`s.secureAt ≥ 0 && tDead > s.secureAt`) 숨진 용의자는 벌점 0.5.** 위협이 끝난 뒤 다친 사람을 돌보지 못한 것이고, 그것은 기록(시각)으로 가려낼 수 있다.
- 근거: "성공"을 깎는 기준을 "살렸어야 했는데 못 살렸는가"에 맞춘다. 구조 대상·대원에게 쓰는 기준과 같다.

### 4.5 자해와 도주 중 사고

- **자해(드물게)**: `tickHostiles` 의 투항 판정(`h.morale < 0.2`)에서, 무기를 들고(`weapon !== 'none'`) 공격성 > 0.7 이고 인질이 없는 용의자는 `injuryRng(sim, s).chance(0.08)` 로 투항 대신 자해한다: `hurtHostile`(총 → gunshot, 칼 → stab, 22~38), 쓰러짐, `raiseProblem('ESCALATION', '용의자 자해', { imp: 3, text: '${용의자}가 스스로를 해쳤습니다. 즉시 처치가 필요합니다.' })`(조사는 `josa`). 그 뒤는 §4.3 이 처리한다. 묘사는 이 한 줄이 전부다.
- **도주 중 사고**: 추격전 사고로 선 용의자(지금 `builders.ts:257`)는 처음 상태의 원인이 vehicle. **선택**: 통제되지 않은 차로가 있는 현장(`s.laneRows`)에서 `flee` 중인 용의자가 차로에 들어서면 `tickLane` 의 한눈판 차가 대원과 같은 방식으로 친다(vehicle 28~44). 시간이 모자라면 빼도 완료 조건에 영향이 없다.

### 4.6 기록 문구

| 때 | 문구 | kind · imp |
|---|---|---|
| 총에 맞아 쓰러짐 | '${용의자}가 총상을 입고 쓰러졌습니다 — 무력화.' | `hazard` · 3 (지금은 `resolve` · 2 '제압됨' — 결정적 순간에 잡히게 바꾼다) |
| 그 밖의 원인으로 쓰러짐 | '${용의자}가 ${원인}으로 쓰러졌습니다.' | `hazard` · 2 |
| 숨짐 | `raiseProblem('SUSPECT_DIED', '${용의자} 사망 (${원인}, 처치 전 또는 처치 후)', { text: '${용의자} 생체 반응 소실.' })` | `problem` · 3 |

조사가 박혀 있는 곳(`hazards.ts:314, 377, 428` 의 `${h.label}가`, `671` 의 `${c.label}가`)은 문구를 고치는 단계에서 `josa()` 로 바꾼다(1단계에서는 고치지 않는다 — 기록 해시가 바뀐다).

---

## 5. 구조 대상

### 5.1 사건 중 새 부상

| 일 | 지금 | 바꾸는 것 |
|---|---|---|
| 폭발 (`blast`, 원인이 blast 일 때) | 체력만 | **세 부류를 고르게**: 구조 대상은 체력이 80 아래가 되면 걷던 사람도 `immobile`(갇힌 사람은 그대로), `bleed ≥ (0.09 + 0.09 × (1 − d/r)) × tune.bleedMul` — 지금 `detonate` 에만 있는 규칙을 가스 용기·누출 가스 폭발에도 쓴다(`detonate` 의 같은 반복문은 `max` 라 두 번 돌아도 결과가 같으니 그대로 둔다). 용의자도 ×0.8 로 맞는다. 원인이 crush(천장·2차 붕괴)인 `blast` 호출에는 이 규칙을 걸지 않는다 — 화재 성공률(54%)이 가장 낮으므로 화재 현장을 더 어렵게 만들지 않는다. 가스 용기 폭발은 화재 현장에서도 나므로 `--force fire/arson` 으로 따로 잰다 |
| 2차 붕괴 (`tickCollapse`) | 체력만(blast) | 원인 crush. **무너진 자리 1.6칸 안의 구조 대상(현장에 있고 업혀 있지 않고 물속이 아닌)은 갇힌다**: `mob = 'trapped'`, `trapWork = injuryRng.range(6, 10)`, `walking = false`. 지휘관은 본 사람이 알릴 때 안다(지금의 `extricate` 가 받는다) |
| 화재의 천장 붕괴 (`tickFire`) | 체력만(blast) | 원인 crush (그 밖은 그대로) |
| 총격 (인질·총격범·빗나간 탄) | 체력·`immobile`·`bleed` | 원인 gunshot, `by` = 쏜 사람 기록만 |
| 가스 (`tickGas` 의 주변 시민, 가스 현장의 연기) | | 원인 toxic 기록만 |
| 익수 (`tickWater`, 해일) | 떠내려가 숨짐 | 원인 drown, `deathCause` 기록만 |
| 구출 중 사고 (`executor` `extricate`) | 없음 | **붕괴 현장에서 구출을 마칠 때 `injuryRng.chance(0.06 × hazardMul × (1.2 − u.tool))`** 이면 crush 6~14, '구출 도중 잔해가 내려앉아 구조 대상 ${이름표}가 더 다쳤습니다.'(`hazard` · 2, 조사는 `josa`). 장비가 좋을수록 드물다 |

### 5.2 스스로 대피하다 다치는 경우

걷는 사람은 지금도 연기·불을 지나며 체력을 잃는다(`tickCasualties` 가 `scene` 의 모든 사람에게 적용). **체력 40 이하(위중)가 되면 멈춘다**(`rules/injury.ts`): `walking = false; mob = 'immobile'; path = null`, `emit({ truth: true, kind: 'casualty', imp: 2, text: '대피하던 구조 대상 ${이름표}가 ${원인}으로 쓰러졌습니다.' })`. 관찰자만 아는 사실이다 — 지휘관은 본 사람의 보고나, 대피 중이라던 사람의 소식이 끊겼을 때 지금 규칙(32초 뒤 `escort`, `orders/major.ts` 의 40초 확인)으로 알게 된다. 렌더러는 이미 체력 40 이하를 눕혀 그린다.

### 5.3 이미 있는 악화 공식과의 정리

`tickCasualties` 의 식은 **한 글자도 바꾸지 않는다**(1단계에서 기록만 더한다). 바뀌는 것은 ① 사건이 끝난 뒤 `loaded` 의 악화를 멈춤(§2.6), ② 숨진 틱의 가장 큰 항으로 `deathCause` 를 정함(이미 있으면 그대로), ③ 사망 문구에 원인을 붙임: '구조 대상 ${이름표}: 생체 반응 소실 (${원인}). 구조에 실패했습니다.' — 미발견 문구('(미발견) …')도 같다.

### 5.4 사망 판정 시점과 보고

- 숨지는 때: 체력 ≤ 0 인 틱(지금). 떠내려가 현장 밖으로 나간 때(지금).
- 판정에 들어가는 때: `closeIncident` 의 `evaluate` 한 번(지금). §5.3 ①로 판정 뒤에 숨지는 일이 없다.
- 보고: 살아서 처음 발견된 사람의 사망은 지금처럼 imp 3(진실 아님), 미발견이면 truth. 숨진 사람을 발견하면 지금처럼 '생체 반응이 없습니다'(imp 2) — 대원은 원인을 모르므로 원인을 붙이지 않는다. 보고서는 사후 판정이라 원인을 쓴다(§7.2).
- 시신 수습 임무는 만들지 않는다(현장 보존이 원칙). 덮개는 화면이 "확인된 사망"에 그린다(§8.2).

---

## 6. 지휘와 관제

### 6.1 정보 격리 — 누가 무엇으로 아는가

| 누구의 무엇 | 지휘관이 아는 길 |
|---|---|
| 구조 대상의 중증도·거동·위치 | `cas` 사실(본 대원의 보고, 지금) |
| 동료가 쓰러짐 | 본 대원의 `mate` 사실(지금). 숨졌는지는 2칸 안에서 본 대원만 |
| 동료가 다쳐 물러남·안전 구역 도착 | **다친 대원 본인의 보고**(새로, §3.2 — 조용한 무전) |
| 동료가 후송됨 | 태운 구급대원의 `mate` 사실(`evac`) |
| 용의자가 쓰러짐·숨짐·중증도 | `hos` 사실(본 대원, 거리 조건 §4.3) |

`orders/injury.ts` 는 `sim.units`(부대 상태)와 `sim.responders[rid].unitId`(명부)만 읽는다. 다른 대원의 `health`·`bleed`·`dead`·`injuries` 를 읽지 않는다 — 테스트가 잡는다(§11-8).

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

`orders/major.ts`(N5)는 고치지 않는다. 그 규칙은 구조 대상만 센다. `orders/injury.ts` 는 병원이 필요한 대원·용의자를 더해 다시 센다: 구조 대상(band 1~2 대기) + 대원(`needsHospital` 로 보고된) + 용의자(쓰러짐·band ≥ 1) 가 5명 이상인데 구급 부대가 `min(5, ceil(n/2))` 보다 적으면 `k.request('ems', '부상자 n명(대원·용의자 포함)', true)`. `request` 는 같은 분야의 요청이 아직 채워지지 않았거나 70초 안에 있었으면 무시되므로(`commander.ts:62`) 둘이 겹쳐도 한 번만 나간다.

### 6.4 관제

`dispatch/*` 는 고치지 않는다. 다친 대원은 `crewReady` 로 이미 빠진다(순직 대원도 `status === 'down'` 이라 빠진다). '대원 부상'·'부상 대원 후송' 요청은 지금의 지원 요청 경로로 간다.

---

## 7. 판정과 보고서

### 7.1 `evaluate` 의 점수

| 무엇 | 벌점 `bad` | 비고 |
|---|---|---|
| 구조 대상 사망 | 2 | 지금. 절반 이상 숨지면 `failed`(지금) |
| 대원 부상(물러남) | 0.75 | 지금. 순직·쓰러짐을 뺀 수 |
| 대원 쓰러짐 | 1.5 | 지금. `downCount` 에서 순직을 뺀다(`status === 'down' && !dead`) |
| **대원 순직** | **3** | 새로. 다른 문제가 없어도 `partial` 이 되고, 하나 더 겹치면(예: 구조 대상 사망) `failed`(4.5 이상) |
| **용의자 사망 — 안전 확보 뒤** | **0.5** | 새로 (§4.4) |
| 용의자 사망 — 교전 중 | 0 | 검거로 센다 |

`IncidentResult` 의 새 칸(`respondersDown`·`respondersKilled`·`suspectsHurt`·`suspectsDead`·`deathCauses`)을 채운다. `respondersHurt` 의 뜻(이 사건에서 RESPONDER_HURT 가 난 대원 수)은 그대로. 순직한 대원은 문턱(§2.6) 때문에 반드시 그 전에 RESPONDER_HURT(쓰러짐이나 부상)가 있으므로, 셋은 `hurtRids` 안에서 나눈다: 순직 = `dead`, 쓰러짐 = `status === 'down' && !dead`, 부상 = 나머지.

### 7.2 문장 — 담담하고 정중하게, 기록에서만

문장의 재료는 ① 기록된 문제(`I.problems` — detail 은 그 문제를 일으킨 코드가 쓴 것), ② 타임라인(`tDown`·`tDead`·`tTreated`…), ③ 부상 기록(`injuries`·`deathCause` — 다치게 한 코드가 적은 것)뿐이다. 감탄사·감정 낱말("안타깝게도", "비극적으로")을 쓰지 않는다. "사망자" 대신 "숨진 사람", 대원은 "순직".

- `RESPONDER_KILLED`: `순직: ${detail 들을 ' / ' 로}.` → "순직: 김도윤 대원(진압1) — 화상, 쓰러진 뒤 1분 50초 동안 구조되지 못함." (원인과 경과는 §3.2 에서 숨지는 순간에 상태로 만든 detail 에 이미 들어 있다.)
- `RESPONDER_HURT`: "대원 피해: 이서준 대원 부상 (총상), 박하준 대원 쓰러짐 (연기 흡입)." (지금 형식 그대로, detail 만 바뀐다)
- 구조 대상 사망: 지금의 세 문장 끝에 원인을 괄호로 — "구조 대상 B는 도착 2분 10초 뒤 발견됐지만 처치를 받기 전에 숨졌습니다 (연기 흡입)."
- `SUSPECT_DIED`: "용의자 1은 교전 중 총상을 입고 쓰러졌고, 처치를 받기 전에 숨졌습니다." / 안전 확보 뒤면 "… 현장 안전 확보 뒤 1분 20초 동안 처치를 받지 못하고 숨졌습니다." (`secureAt`·`tDead`·`tTreated` 로)
- 한 줄 요약(`headline`): '대원 n명 부상' → `대원 ${부상}명 부상${순직 ? `, ${순직}명 순직` : ''}`. 용의자: `용의자 ${n}명 중 ${m}명 검거${사망 ? ` (사망 ${k})` : ''}`.
- 분석 문장은 9줄(문제)·11줄(사망까지)에서 잘린다(지금). `RESPONDER_KILLED` 를 `order` 맨 앞에 두어 잘리지 않게 한다.

### 7.3 교대 보고서의 집계 (`buildReport`)

- `respondersHurt`: 지금처럼 `status !== 'ok'` 인 대원. `status` 문구를 '순직' · '쓰러짐' · '부상' 으로, 새 칸 `rid`·`band`(교대 끝 체력)·`cause`(`mainCause`)·`dead`·`hospital`·`out` 을 채운다. `scripts/sweep.ts` 의 "대원 부상" 수(`respondersHurt.length`)는 순직을 포함한 수로 남는다.
- `respondersKilled`·`suspectsHurt`·`suspectsDead`·`roster`(§3.7)를 채운다.
- 요약(`summary`)에 줄을 더한다(있을 때만):
  - "대원 피해: 부상 2명(병원 이송 1명)." 
  - "순직: 김도윤 대원(진압1, 사건 F-03 화재)." — 교대에 순직이 있으면 첫 줄 바로 다음에 둔다.
  - "용의자 3명이 다쳤고 그중 1명이 숨졌습니다."
  - 구조 대상 줄은 지금 그대로에 숨진 원인 집계를 붙인다: "… 6명은 구하지 못했습니다(연기 흡입 4, 총상 2)."

---

## 8. 화면

화면만 고치는 단계(§10 의 2단계)는 `sweep` 분포가 한 건도 바뀌면 안 된다. 연출용 난수는 지금처럼 `hash2` 만 쓴다.

### 8.1 중증도 색 — `src/view/triage.ts` 한 곳

```ts
export const TRIAGE = ['#5ad17a', '#ffd166', '#ff5d5d', '#14181d'];   // 초록 · 노랑 · 빨강 · 검정
export const TRIAGE_EDGE = ['#0b1219', '#0b1219', '#0b1219', '#cfd6dc']; // 검정 딱지는 밝은 테두리와 흰 글씨 (배경 #070b10 위에서 보이게)
export const TRIAGE_TEXT = ['#0b1219', '#0b1219', '#0b1219', '#e8f0f7'];
```

`renderScene.ts:39` 의 `BAND_COLOR`, `styles.css` 의 `.band-0~3`(파일 끝 `/* ── injuries ── */` 블록에서 덮어쓴다), `App.tsx` 의 현장 범례가 이 값을 쓴다. 범례에 **사망**(검정)·**들것**·**덮개** 항목을 더한다. `rgba()` 는 색 계산에 넣지 않는다(CLAUDE.md "색 계산").

### 8.2 사람 그림

`drawLying` 의 `blood` 옵션과 붉은 타원(`sprites.ts:169`)을 **지운다**. 'hit' 효과(`renderScene.ts:634-637`)는 붉은 조각 대신 짧게 퍼지는 흰 고리와 회색 먼지 몇 점으로 바꾼다(맞았다는 것만 전한다).

| 상태 | 구조 대상 | 대원 | 용의자 |
|---|---|---|---|
| 다침(서 있음) | 지금 그대로 | **다친 자세**(§8.3) | 다친 자세 |
| 쓰러짐 | 누움(피 없음), 위중이면 빨간 맥박 고리(지금) | 누움 + 빨간 맥박 고리(지금, 피 없음) | 누움(피 없음) |
| 옮겨지는 중 | 들것(지금. R1 이 합쳐졌으면 R1 규칙: 옮기는 사람이나 곁의 사람이 `stretcher` 를 가졌을 때만 들것, 아니면 끌기 자세) | **들것**(`carrying ≤ −2` 인 대원이 끌고 있을 때 — 들것 규칙은 왼쪽과 같다) | 들것(쓰러진 용의자의 좌표가 그 틱에 바뀌었을 때 — `treatSuspect` 가 차로 옮기는 중) |
| 처치 받음 | 붕대 + 딱지의 흰 십자(지금) | 붕대(누운 경우) / 딱지에 흰 십자 | 붕대 / 흰 십자 |
| 안전 구역의 다친 대원 | — | `tDown` 이 있으면 **계속 누운 모습**(지금은 다시 서 있게 그려진다), 아니면 앉거나 다친 자세. 투명도 0.6 은 없앤다 | — |
| 확인된 사망 | 덮개 — `dead && tDiscovered ≥ 0` 일 때. 관찰자 시점의 미발견 사망은 누움 + 흐린 검정 딱지 | 덮개 — 관찰자 시점은 `tDead` 3초 뒤, AI 시점은 지휘관의 `mate` 사실이 `dead` 일 때 | 덮개 — 같은 규칙(`hos` 사실의 `dead`) |
| 차에 탐 | 그리지 않음(지금) | 그리지 않음(`left`) | 그리지 않음(`where !== 'scene'`) |
| 떠내려가 현장 밖 | **그리지 않음**(`dead && drift > 0`) | | |

딱지: 구조 대상의 딱지(지금)에 더해, **다친 대원(band ≥ 1)과 쓰러진·다친 용의자** 위에도 같은 중증도 색 딱지(글자 없이 색과 흰 십자)를 단다. 용의자 알약의 상태 글자: `down` = '쓰러짐', 숨졌으면 '사망'(지금 '제압'). G4 의 표지 함수가 먼저 있으면 그것을 쓴다.

### 8.3 다친 대원의 자세·속도

- `sprites.ts` 의 `PersonPose` 에 `hurt?: number`(0..1), `ArmPose` 에 `'clutch'`(한 팔로 옆구리를 붙듦). `hurt` 가 크면 걸음 폭을 줄이고 몸을 조금 기울인다. 쓰는 곳: 대원 band ≥ 1, 용의자 체력 < 60.
- 느린 걸음은 시뮬레이션 쪽(`hurtF`)이 이미 만든다. 화면은 걸음 애니메이션 속도를 실제 이동량에 맞춘다(지금 `moving` 판정 그대로).

### 8.4 패널

- **대원 칩**(`panels.tsx:131-152`): 칩의 class 를 `band-k`(교대 끝 체력 기준)와 `dead` 로. `.cchip.injured` 와 `.cchip.down` 이 같은 색인 것을 중증도 색으로 나눈다. title 에 원인('총상 · 출혈').
- **대원 정보창**(`panels.tsx:280-315`): '건강' 막대 색을 중증도 색으로(지금 두 가지뿐). '부상' 줄: 원인별 피해("총상 32 · 연기 흡입 8"), 출혈 여부, 처치(기본/전문), 후송('구급1 탑승' / '병원 인계'). 상태 문구: `down` → '쓰러짐', 순직 → '순직', `withdrawn` → '부상 — 후송 대기' / '처치 받음 — 후송 대기'. 현장에 없는 대원도 `Responder` 의 상태('병원 인계', '순직', '부상 — 다음 교대 결장 예상 n')를 보인다.
- **구조 대상·용의자 정보창**(새 `PersonCard.tsx`): `Viewport` 가 버리던 `hit.cas` 를 쓰고 `hitScene` 이 용의자도 돌려주게 한다(`{ rid, cas, hostile }`). 보이는 것: 이름표, 중증도(색), 거동, 위치(현장·안전 구역·이송 중·병원), 원인별 부상, 처치, 타임라인(발견·구출·처치·안전 구역·탑승·병원·사망). 용의자는 상태·무기·부상·처치·이송. **AI 시점에서는 지휘관의 믿음(`cas`·`hos` 사실)만**, 관찰자 시점에서는 진실을 보인다. G4 가 같은 창을 먼저 만들었으면 거기에 칸을 더한다.
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
| 용의자 사망 | 교대당 ≤ 0.3. **총에 맞아 쓰러진 용의자 가운데 25~60% 가 숨진다**(총격전의 일부) | `--force armed/shooter` 20교대에서 같은 비율 |
| 무장 사건 성공률 | 지금(82%) − 8%p 이상 | |

### 9.2 다시 재는 법

```bash
# 0단계에서 한 번 ($SCRATCH = 각자의 scratchpad 경로. 결과를 저장소에 넣지 않는다)
npx tsx scripts/sweep.ts 60 --json > $SCRATCH/before-normal.json
for d in easy hard extreme; do npx tsx scripts/sweep.ts 60 --diff $d --json > $SCRATCH/before-$d.json; done
for f in armed/shooter armed/hostage armed/siege armed/bomb fire/arson; do npx tsx scripts/sweep.ts 20 --force $f --scen > $SCRATCH/before-${f/\//-}.txt; done
# 시뮬레이션을 고친 단계마다 같은 명령으로 after-*.json 을 만들어 견준다. 한 교대를 읽을 때는 --log 시드
```

`scripts/sweep.ts` 에 집계를 더한다(결과는 바뀌지 않는다): `respondersKilledPerShift`, `respondersDownPerShift`, `suspectsHurt`, `suspectsDead`, `suspectsDownByGunDiedShare`, `deathCauses`(숨진 구조 대상의 원인 분포). 출력 줄 하나: `injuries: responders hurt/shift … down/shift … killed/shift … · suspects hurt … dead … (shot-down died …%) · causes …`.

### 9.3 범위를 벗어나면 돌리는 손잡이 (이 순서로)

1. 대원 부상이 많거나 적다 → `BLEED_PER_DMG` 의 gunshot·stab, `MATE_RETREAT_BLEED`(0.03).
2. 대원 쓰러짐·순직이 많다 → `tune.injuryMul`(가운데 값 1 은 두고 표의 위쪽), `rescueMate` 의 `fireRisk` 조건, 문턱(41).
3. 용의자 사망 비율 → `HOSTILE_BLEED`(0.35), 경찰 기본 처치의 `q` 하한(R1 의 구급낭이 있으면 0.45).
4. 붕괴 현장이 너무 어려워진다 → 2차 붕괴 갇힘 반경(1.6), 구출 중 사고 확률(0.06).
5. 새 세계 규칙(열 탈진 0.5/s, 잔해 바닥 추락 0.004)은 부상 빈도를 맞추는 마지막 손잡이다.

`npm run check` 의 기준 범위 자체는 고치지 않는다(README §4). 범위 안이지만 위 목표를 벗어나면 보고에 수치를 적는다.

---

## 10. 구현 순서와 완료 조건

단계마다 커밋하고(`wf/injuries`, 한국어 메시지, 푸시하지 않음), 단계 끝마다 `npx tsc --noEmit` · `npx vitest run tests/injuries.test.ts tests/ext.test.ts` · `npm run check` 를 통과시킨다.

| 단계 | 내용 | 결과가 바뀌는가 |
|---|---|---|
| **0. 기준** | 아래 해시 목록과 §9.2 의 `before-*` 를 scratchpad 에 저장 | — |
| **1. 기록만** | `types.ts` 의 새 자료형, `injury.ts`(`noteInjury`·`bandOf`·`CAUSE_NAME`·`injuryRng`), `rules/injury.ts`(처음 상태 원인 붙이기만), 피해를 주는 모든 자리에 **기존 식 그대로 두고** `noteInjury` 한 줄씩(§12 의 "1단계" 열). `deathCause` 기록. `scenes/index.ts` 에 import 두 줄 | **아니다 — 해시 목록이 한 글자도 같아야 한다** |
| **2. 화면** | `triage.ts`, 피 웅덩이·붉은 조각 제거, 사람 그림(§8.2), 다친 자세, 딱지, 범례, 패널·정보창(기록을 읽어 원인을 보인다), 속보 class, 카메라 무게 | 아니다(해시 같음). 스크린샷 확인 |
| **3. 구조 대상** | `blast` 를 고르게(구조 대상 `immobile`·`bleed`), 2차 붕괴 갇힘, 천장 붕괴 원인 crush, 구출 중 사고, 걷던 사람이 멈춤, 종료 뒤 `loaded` 동결, 사망 문구에 원인, 박힌 조사 `josa()` | 그렇다 — sweep 비교 |
| **4a. 대원 — 모델** (이 커밋에서는 `withdrawn` 대원의 출혈을 멈춰 둔다 — 후송이 4b 에서 생기므로, 안 그러면 안전 구역에서 기다리다 숨진다. 4b 에서 §2.6 대로 푼다) | `hurtResponder`(방호·문턱·출혈), `agentHealth` 개편(순직, 부상 조건, 자기 보고), `hurtF`, `dangerScore`·`retreat` 의 출혈 조건, 흉기·맨손 기록, `RESPONDER_KILLED`, `rescueMate`(숨진 동료 0.55, `fireRisk`), `mateFact`·`significant`, 4번 블록 문구, `outstanding` 의 `mates` | 그렇다 |
| **4b. 대원 — 후송** | `treatMate`, `Unit.aboard`, `canCarryPatients`·`manageAmbulances`(진실 읽기 제거), 5번 블록의 병원행, 병원 인계, 자기 부대 이송 지시, 결원·순직 부대 `oos` | 그렇다 |
| **4c. 대원 — 새 규칙** | 열 탈진, 잔해 바닥 추락, 덮쳐 제압할 때의 몸싸움 | 그렇다 |
| **5. 용의자** | 쓰러짐 15, 출혈·사망(`rules/injury.ts`), 폭발(`blast`)·불·연기·가스 피해, `treatSuspect`, `hosFact` 칸, 구급차 이송, `SUSPECT_DIED`, 자해, (선택) 차로에서 치임 | 그렇다 |
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

1단계를 "결과 동일"로 지키는 법: 체력을 깎는 식의 연산 순서를 바꾸지 않는다(`a - (b + c)` 와 `a - b - c` 는 부동소수점에서 다를 수 있다). `noteInjury` 는 이미 계산된 값을 기록할 뿐이다. 규칙 함수(`rules/injury.ts`)는 1단계에서 `injuries` 칸 말고는 아무것도 쓰지 않고 난수를 부르지 않는다. 새 `emit` 을 만들지 않는다(기록 해시는 문구로 만든다).

**완료 조건**

1. 단계 1·2 뒤 해시 목록이 0단계와 같다.
2. `npm run check` 통과, §9.1 의 목표 범위(벗어나면 수치와 이유를 보고에).
3. `tests/injuries.test.ts` 통과(§11), 다른 테스트 파일 수정 없음(`tests/sim.test.ts` 는 건드리지 않는다).
4. `--force armed/shooter`·`armed/hostage`·`armed/siege` 20교대에서 한계 시간·방치 종료가 0단계보다 2건 넘게 늘지 않는다. 쓰러진 대원이 나온 교대를 `--log` 로 하나 읽어, 구조 → 처치 → 후송 → 병원 인계가 기록으로 이어지는지 확인.
5. 화면: `http://localhost:5210/?seed=S3&force=armed/shooter`(교전 뒤 쓰러진 용의자·처치), `…&force=fire/arson`(화재 현장, 연기 피해), `?seed=X1&diff=5,5,5,1,5,1`(대원 부상) 을 Playwright 로 찍어 본다. 피 웅덩이·붉은 조각 없음, 덮개·들것·중증도 딱지가 읽히는지, 보고서의 대원 목록·순직 타일, 콘솔 오류 0건. 찍은 그림은 저장소 밖에.
6. 보고(마지막 응답): 브랜치와 마지막 커밋, 단계별 구현 여부, 0단계 대비 sweep 표(보통·프리셋 넷·강제 시나리오), 고친 공용 파일(파일·함수·이유), 남은 문제.

---

## 11. 테스트 — `tests/injuries.test.ts`

교대를 여러 번 돌리는 묶음은 `beforeAll` 에서 한 번 돌려 나눠 쓴다(전체 30초 안팎이 되게).

1. **세 부류 모두 다친다**: `new Sim('INJ' + k, NORMAL, 1200, { force: 'armed/shooter' })` 8교대에서 — 원인 gunshot 인 부상 기록이 있는 구조 대상, 부상 기록이 있는 용의자가 각각 한 교대 이상. 대원은 `{ ...NORMAL, threat: 5, severity: 5, equipment: 1 }` 8교대에서 부상 기록(band ≥ 1)이 있는 대원이 한 명 이상. 모든 사건이 끝난다.
2. **원인별 기록**: 사건 하나를 `createIncident(sim, { type: 'fire', rng: sim.rng.fork('t') })` 로 일으키고 부대가 도착할 때까지 돌린 뒤, 원인마다 `hurtCas`·`hurtResponder`·`hurtHostile`(용의자는 무장 사건에서) 를 직접 불러 — 기록이 그 원인으로 한 줄씩 생기고, 같은 원인은 한 줄로 합쳐지고(`dmg` 가 더해짐), `sev` 가 `bandOf` 와 맞는다. `bandOf` 가 지금의 `band` 와 0~100 전 구간에서 같다.
3. **방호가 피해를 줄인다**: 같은 피해량으로 `hurtResponder` — gunshot: 특공대 < 순찰 < 구급. burn·smoke: 소방 < 경찰. toxic: 화학 ≤ 소방 < 경찰. blast: 폭발물 처리반 < 순찰. 그리고 지금 모델이 있는 원인(총상·연기·불·폭발)은 지금 숫자와 같다(예: 순찰 총상 = `raw × (1 − armor × 0.6)`, R1 이 합쳐져 있으면 `armor` 는 `armorOf`).
4. **문턱**: 체력 100 인 대원에게 `hurtResponder(…, 200, 'gunshot')` → 숨지지 않고 체력 8, 출혈 ≤ 0.04, 다음 틱에 `down`. 체력 30 인 구급대원(총상 방호 0)에게 `hurtResponder(…, 60, 'gunshot')` → 다음 틱에 순직, `RESPONDER_KILLED` 기록, `r.status === 'down' && r.dead`.
5. **대원 순직은 목표 빈도 이하**: 보통 24교대에서 순직 ≤ 1.
6. **쓰러진 대원은 구조되거나 후송된다**: 응급 사건(구급 부대가 온다)에서 부대가 도착한 뒤 한 대원을 `hurtResponder` 로 쓰러뜨리고 끝까지 돌린다 → 그 대원은 `rescueMate` 완료 기록이 있고, `r.care === 'hospital'` 이거나(후송) 숨졌다면 `RESPONDER_KILLED` 가 있다. `a.status` 는 끝에 `left`.
7. **용의자 부상 시 처치·호송**: `armed/shooter` 8교대에서 쓰러진 용의자마다 — 숨졌으면 `SUSPECT_DIED` 기록이 하나, 살았으면 사건이 끝날 때 `tTreated ≥ 0` 이거나 현장에 구급·경찰 대원이 없었다. `treatSuspect` 를 맡은 대원은 경찰이거나(안전 확보 전) 구급대원(안전 확보 뒤)이다(`s.board` 의 `assignees`).
8. **정보 격리**: `field/commander.ts`·`dispatch/*`·`field/orders/*`(주석 줄 제외)에 `/\.(injuries|bleed)\b/` 와 `/responders\[[^\]]*\]\.(health|dead|bleed)/` 가 없다. `field/brain.ts` 는 자기 몸(`resp(sim, a)` 로 얻은 `r.health`·`r.bleed`)을 읽으므로 뒤의 식만 검사한다. (지금 코드는 네 곳 모두 이 검사를 통과한다 — 2026-11-14 확인.)
9. **가짜 연출 없음**: 모든 교대에서 `r.dead` 인 대원마다 그 rid 의 `RESPONDER_KILLED` 기록이 정확히 하나, `h.dead` 인 용의자마다 `SUSPECT_DIED` 가 하나. 숨진 구조 대상은 모두 `deathCause` 가 있다.
10. **잔혹한 묘사 없음**: `src/view/renderScene.ts` 에 `blood:` 가 없고 `src/view/scene/sprites.ts` 에 `rgba(110,18,22` 가 없다.
11. **재현성**: 같은 시드·같은 강제 시나리오 두 번의 `report.hash` 가 같다(부상·사망이 일어나는 교대 하나 이상 포함). `injuryRng` 를 쓰는 규칙이 있는 교대도 같다.

---

## 12. 고칠 파일, 알려진 위험과 결정 사항

### 12.1 공용 파일 수정

| 파일 | 함수·자리 | 무엇을 · 왜 | 단계 |
|---|---|---|---|
| `sim/types.ts` | 끝에 추가 | §2.1 의 자료형과 칸 | 1 |
| `sim/difficulty.ts` | `Tuning`, `tuningOf` | `injuryMul` | 4a |
| `field/hazards.ts` | `band` | `bandOf` 다시 내보내기 | 1 |
| | `tickCasualties` | 항별 `noteInjury`, `deathCause`(1) → `loaded` 동결, 사망 문구 원인(3) | 1·3 |
| | `blast` | 원인 인자(기본 blast), 기록(1) → 구조 대상 `immobile`·`bleed`(3), 대원은 `hurtResponder`(4a), 용의자 피해(5) | 1·3·4a·5 |
| | `tickFire` | 천장 붕괴 원인 crush | 1 |
| | `panicShot`·인질 시한·총격범 | gunshot 기록(1), `josa`(3) | 1·3 |
| | `tickHostiles` | 대원 피격·흉기 기록(1) → `hurtResponder`·피습 문구(4a), 쓰러짐 15·문구(5), 자해(5) | 1·4a·5 |
| | `tickLane` | vehicle 기록(1) → `hurtResponder`(4a), (선택) 도주 용의자(5) | 1·4a·5 |
| | `tickCollapse` | crush, 곁의 구조 대상 갇힘 | 1·3 |
| | `tickGas`·`tickWater` | toxic·drown 기록, `josa`(3) | 1·3 |
| `field/sceneManager.ts` | `agentHealth` | 기록(1) → §3.2 전체(4a) | 1·4a |
| | 4번 블록 | 승계 문구 | 4a |
| | 5번 블록 | `needsHospital` 대원을 `aboard` 에, 병원행 | 4b |
| | 7번 블록 | `outstanding().mates` | 4a |
| `field/executor.ts` | `shootAt` | 용의자 피격·빗나간 탄 기록(1) → `hurtHostile`(5), 경험치 문턱(5) | 1·5 |
| | `extricate` | 구출 중 사고 | 3 |
| | `retreat`·`rescueMate` | 출혈 조건, 자기 보고 'safe', 숨진 동료 수습, 강제 보고 | 4a |
| | `engage` | 덮쳐 제압할 때의 몸싸움 | 4c |
| | 새 case `treatMate`·`treatSuspect` | §3.4·§4.3 | 4b·5 |
| `field/agents.ts` | `staminaF` | `× hurtF(r)` | 4a |
| | `casFact` 옆 | `mateFact` | 4a |
| | `hosFact`, `significant`, `perceive` | 칸·문구, 보고 조건, `where` | 4a·5 |
| | `workLabel`·`fitFor`·`canCarryPatients` | 새 임무 둘, `rescueMate` 의 `fireRisk`(R1 이면 `scba` 자격), 자리 셈에 `aboard`(R1 의 `seatsOf` 그대로) | 4a·4b·5 |
| `field/commander.ts` | `rescueMate` 를 내는 줄(340) | 숨진 동료 0.55 | 4a |
| | `manageAmbulances` | `aboard`, 진실 읽기(544) 제거 | 4b |
| | `outstanding` | `mates` | 4a |
| `field/brain.ts` | `dangerScore` | 출혈 ≥ 0.03 이면 물러남(자기 몸) | 4a |
| `field/rules/disaster.ts` | 해일 | drown 기록(1) → `hurtCas`·`hurtResponder`(4a) | 1·4a |
| `field/scenes/index.ts` | import | `../rules/injury`, `../orders/injury` | 1 |
| `sim/resources.ts` | `tickUnits` 의 `hospital`, `arrive` 의 `returning` | `aboard` 인계, 결원·순직 `oos` | 4b |
| `sim/debrief.ts` | `PROBLEM_LABEL`·`order`·`T`, `evaluate`, `buildReport` | §7 | 4a·5·6 |
| `view/renderScene.ts` | `BAND_COLOR`, 사람 그리기(302-412), 딱지(562-596), 'hit'(634-637), `hitScene` | §8 | 2 |
| `view/scene/sprites.ts` | `drawLying`(blood 제거), `PersonPose`·`ArmPose` | §8.2·8.3 | 2 |
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
2. **물러나는 대원이 늘면** 교전에서 경찰 수가 줄어 대치가 길어진다 → 무장 사건의 한계 시간. `--force armed/shooter` 로 재고, 늘면 `MATE_RETREAT_BLEED` 를 올린다.
3. **구급차 정원 다툼**: 다친 대원·용의자가 구조 대상과 자리를 나눈다. 용의자는 더 무겁거나 같은 사람이 기다리지 않을 때만 태운다. 버스·대형 사고에서 구조 대상 이송이 늦어지지 않는지 `--force` 로 본다.
4. **숨진 동료를 수습하지 못해 종료가 막힘**: `canClose` 는 쓰러진 동료가 남아 있으면 끝내지 않는다(지금). 닿을 수 없는 자리면 `LIMIT` 으로 끝난다 — 한계 시간 건수를 본다.
5. **R1 이전에 구현하게 되면**(순서가 바뀌면) 방호는 §2.4 의 오른쪽 열, 결원은 최소 인원 1, 자리는 구급차 2·헬기 1 로 동작한다. R1 이 합쳐질 때 `protection()`·`treatEffect()`·자리 셈만 바꾼다. R1 은 대원 수를 크게 늘리므로(보통 34 → 63명) §9 의 목표는 R1 을 합친 뒤에 다시 잰 기준값과 견준다.
6. **정보 격리 예외**: `commander.ts:544` 를 고치면 결과가 조금 바뀐다(4b 단계 안에서 함께 잰다). README "알려진 문제"의 예외 3건은 늘리지 않는다.
7. **속도(P1)**: `rules/injury.ts` 는 매 틱 모든 현장에서 돈다. 다친 사람이 없는 현장은 첫 줄에서 돌아가게 하고, 배열을 새로 만들지 않는다(기록은 원인마다 한 줄을 고쳐 쓴다).
8. **자해** 같은 민감한 장면은 드물게, 한 줄의 담담한 기록으로만. 표현이 마음에 걸리면 확률을 0 으로 둘 수 있게 상수(`SELF_HARM = 0.08`)로 뺀다.
9. **G4·G5 와의 화면 충돌**: 딱지·'hit' 효과를 함께 고칠 수 있다. 먼저 합쳐진 쪽의 그림 함수를 쓰고, 원칙(피·붉은 조각 없음, 중증도 색은 `triage.ts`)만 지킨다.

### 12.3 결정 사항 (조사에서 열려 있던 질문)

| 질문 | 결정 | 이유 |
|---|---|---|
| 원인을 새 칸에 저장하나 | `Injury[]`(원인마다 한 줄) + `bleedCause`·`deathCause` | `causeEvent` 는 이벤트 id 하나라 원인 종류를 말하지 못한다 |
| 추락·감전·익수·탈진 규칙 | 탈진·잔해 바닥 추락은 새로. 감전은 공식만. 대원 익수·사다리 추락은 R2 | 지금 그런 일이 생기는 현장이 없는 것은 억지로 만들지 않는다 |
| 대원 순직 | 허용. 출혈이 있는 쓰러짐 + 문턱(한 번에 41 → 0 불가) | "드물게, 설명할 수 있게" |
| 대원 체력이 성능에 | `hurtF`(70 → 40 에서 1 → 0.75) | 지금은 40 아래 전까지 영향 없음 |
| 경상은 처치 뒤 복귀하나, 교대 중 회복 | 둘 다 아니다(지금 그대로). `injured` 는 교대 끝까지 쓰지 않는다 | 균형을 크게 흔들지 않는다. 회복은 K1 |
| 다친 대원의 구급차·병원 | 넣는다(`treatMate`, `Unit.aboard`, 병원 인계) | 사용자 요청의 "후송" |
| 용의자 `down` 을 나누나 | `state` 는 그대로 두고 `dead` 칸을 따로. 쓰러짐은 15 | 기존 `down` 의 뜻과 테스트를 지킨다 |
| 용의자 사망과 판정 | 안전 확보 뒤에 숨진 경우만 0.5 | §4.4 |
| 경찰 호송 | 기계적으로 모델하지 않는다 | §4.3 |
| 판정 뒤 숨짐·병원 뒤 결과 | 종료 뒤 `loaded` 동결, 병원 뒤 결과 없음 | 판정과 기록이 어긋나지 않게 |
| 경상(초록)의 처치·이송 | 지금 그대로 없음 | START 의 "지연" 묶음 |
| 사망색 | 검정 + 밝은 테두리·흰 글씨 | 요청(검정), 어두운 배경에서 보이게 |
| 피 웅덩이·붉은 'hit' | 없앤다 | 표현 원칙 |
| 덮개를 그리는 때 | "확인된 사망"부터(관찰자: 발견 뒤 / 대원은 3초 뒤, AI 시점: 믿음) | 덮는 임무를 따로 만들지 않고도 거짓 없이 |
| 떠내려가 숨진 사람 | 그리지 않는다 | 기록('현장 밖으로')과 그림을 맞춘다 |
| K1 | 출력(`roster`)만. 저장·입력은 K1 | 묶음의 경계 |
| 폭발이 고르지 않음 | `blast` 가 세 부류를 같은 규칙으로 | 요청의 "고르지 않은 것을 채운다" |
| `commander.ts:544` | 이번에 믿음으로 바꾼다 | `manageAmbulances` 를 어차피 고친다 |
| 대원의 익수(물 위의 쓰러짐·사망) | 넣지 않는다. R2 의 체력 하한 18 을 둔다 | 물 칸에 쓰러진 대원을 건지는 길(다른 대원의 수난 구조 대상이 되는 것)이 없으면 사건이 끝나지 않는다 |
| 방호의 이름 | R1 의 `armorOf`·`blastFactor`·`scba`·`turnout` 을 읽는다 | R1 이 먼저 합쳐진다 |
