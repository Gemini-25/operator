# X6 — 위험의 현실화: 붕괴 · 폭발 · 전소

공통 규칙은 `docs/specs/README.md`. 브랜치 `wf/catastrophe`, 개발 서버 포트 **5216**.

사용자의 말: "붕괴 위험 폭발 위험 전소 위험 이런게 높은 현장은 실제로 붕괴, 폭발, 전소가 일어난다거나 하는 것도 구현되어야 해."

풀어 쓰면: 위험이 숫자나 문구로만 있지 않다. 높은 채로 두면 **실제로 일어난다** — 건물이 일부 또는 전부 무너지고, 가스·화학 물질·연료가 터지고, 불이 건물을 다 태운다(다 탄 건물은 버티지 못해 무너진다). 그 전에는 **조짐**이 있다(삐걱임·균열·바닥 처짐·불꽃 역류·가스 측정값·안전밸브 소리). AI 지휘관은 조짐을 보고 **막는 조치**(보강·냉각·밸브 차단·도시가스 차단·진압)를 하고, 늦었으면 **전원 철수·외부 방어**로 바꾼다. 막지 못하면 사상자(대원 포함)·재산 피해·지도의 건물 상태·보고서에 그대로 남는다.

이 문서는 다음 구현 세션이 이 문서와 `CLAUDE.md` 만 보고 끝까지 만들 수 있게 쓴다. 줄 번호는 `1ca465d`(2026-11-14) 기준이다. 그 뒤 B3·P1·Q1 이 합쳐져(`1c78402`) `hazards.ts`(연기 확산을 `smokeSpread` 로 꺼냄 — `tickFire` 뒷부분이 약 18줄 밀렸다)·`commander.ts`(`needFor`·`rollCall`·0.22 규칙)·`executor.ts`(`reportDone`)·`kit.ts`(`PROP_BLANK`) 등이 바뀌었고, 앞으로 R1·H1·B1·G4·G5 가 먼저 합쳐지면 더 바뀐다. **줄 번호가 아니라 함수 이름과 주석으로 찾는다**(§11.2 에 찾을 글귀를 적었다). 확신하지 못한 곳은 **(확인 필요)** 로 표시했다.

구현 순서에서의 자리: R1 → H1 → **X6** → R2 → R3 → I1-b → I2 (`docs/ROADMAP.md`). 이 문서는 **R1·H1 이 먼저 합쳐져 있다고 가정**하고, 아니면 쓸 대체를 §12.1 에 적는다.

**자기 파일**(새로): `src/sim/field/catastrophe.ts`(위험 상태와 일어나는 일 — 세계 규칙의 몸통), `src/sim/field/rules/catastrophe.ts`(등록과 1초 주기의 순서), `src/sim/field/ops.ts`(지휘 상태 도움 함수 — 진실을 읽지 않는다), `src/sim/field/orders/catastrophe.ts`(지휘 규칙 — 믿음만), `src/view/scene/catLayer.ts`(현장 위의 위험 그림), `src/view/city/placeMarkLayer.ts`(지도의 건물 상태 — G4 가 먼저 합쳐졌으면 만들지 않는다, §7.2), `src/view/scene/skins/catastrophe.ts`(드럼통), `tests/catastrophe.test.ts`.
**공용 파일 수정**: §11.2 의 표에 적힌 함수만, 가장 작은 조각으로(README §2).
**건드리지 않는다**: `city.ts`, `cityPlan.ts`, `view/city/staticCity.ts`·`places.ts`, `tests/sim.test.ts`, `README.md`, `CLAUDE.md`, `docs/ROADMAP.md`, `docs/DESIGN.md`, `disaster.ts`(여진은 세계 규칙이 흔들림 기록을 읽어 반영한다, §2.4).

## 원칙

- **위험은 진실의 수치, AI 는 조짐으로만 안다.** 구조 건전도·가스 농도·용기의 열·탄 비율은 `Scene.cat`(진실)에 있다. 지휘관·대원의 판단부·관제는 그것을 읽지 않고, `perceive` 가 시야·소리 범위 안에서 만든 **조짐 사실**(`sign`)로만 안다(`CLAUDE.md` 절대 규칙 4).
- **일어나는 일은 상태를 바꾸는 그 자리에서 기록한다.** 붕괴·폭발·전소는 `catastrophe.ts` 의 함수가 타일·사람·소품을 바꾸는 바로 그 줄에서 `raiseProblem` 한다(가짜 연출 금지). 보고서 문장은 기록된 문제와 그때 적어 둔 원인에서만 만든다.
- **막을 시간이 있다.** 갑작스러운 충격을 빼면, 붕괴는 "임박" 조짐(단계 3)이 들린 뒤 **최소 4초** 지나야 일어나고, 용기는 안전밸브 소리(가열 0.55)가 난 뒤 터진다. 그래서 AI 가 제때 물러났는지가 결과를 가른다. 갑작스러운 충격은 셋이다: 폭발물 시한, 지진 여진, 그리고 **가스·용기·분진 폭발의 충격**(건전도를 0.05 아래로 떨어뜨리면 그 구획은 조짐 없이 바로 무너진다 — §2.4 `integ ≤ 0.05`).
- **새 난수는 새 흐름.** 실행 중 판정은 `cat:<현장 id>`, 한 번만 정하는 준비는 `catinit:<현장 id>` (`damage.ts` 의 `dmg:` 와 같은 `WeakMap` 방식). **세계 규칙 쪽에서는** `s.rng`·`a.rng`·`sim.rng` 에 호출을 더하지 않는다. 지금 `s.rng` 를 쓰는 두 판정(천장 붕괴, 누출 가스 폭발)은 이 묶음이 **대체**하므로 그 호출은 사라진다(§2.8 — 그 현장들의 `s.rng` 순서가 바뀐다는 것을 알고 한다). **AI 쪽은 이 원칙을 지킬 수 없다** — 외부 방수·냉각이 부르는 `spray` 는 물줄기 흔들림에 `s.rng` 를 쓰고, `evacuate` 의 `moveTo` → `agentCost` 는 `a.rng` 를 쓴다. 새 행동이 기존 행동 대신 일어나는 것이므로 5단계의 결과 변화에 포함된다(§2.8).
- **모든 사건은 끝난다.** 철수·외부 방어 중에도 대원은 `active` 로 남아 7번 블록의 방치 종료에 걸리지 않고, 무너지거나 다 탄 현장에는 끝나는 길(잔해 수색 국면, 외부 확인 종료)과 한계 시간 보탬이 있다(§6).
- **도시 지도(`city.places`)는 고치지 않는다.** 건물 상태는 `Sim.placeMarks`(교대마다 새로 만드는 자료)에 둔다(§7.1).
- **기존 기록과 시험을 지킨다.** `tickCollapse` 의 `ESCALATION '… 2차 붕괴'`(시험 `tests/sim.test.ts:334` 가 찾는다), 밸브의 `mitigated`·`ignited` 의 뜻("차단 > 발화", "차단+발화 > 80%")은 그대로 둔다.
- **잔혹하게 그리지 않는다**(H1 의 원칙). 깔린 사람은 잔해 표지와 중증도 색으로만.

## 연관 설계서와 나누는 선

| 설계서 | 겹치는 곳 | 나누는 선 |
|---|---|---|
| H1 부상과 사망 | 붕괴·폭발이 사람에게 주는 피해, 대원 순직 | 피해는 H1 의 `hurtCas`·`hurtResponder`·`hurtHostile`(원인 `crush`·`blast`·`burn`)로만 준다. **멀쩡한 대원은 한 번에 숨지지 않는다**(H1 §2.6 문턱)는 규칙을 따른다. X6 가 더하는 것은 **깔린 대원**(`FieldAgent.trapped`)과 그 구출(§4.8). H1 의 `blast` 원인 인자를 X6 의 구조 충격(§2.4)이 읽는다. **상태 전이는 H1 §3.2 대로 `agentHealth` 한 곳에서만** 한다 — X6 는 `a.trapped`·`a.trapEv` 만 세우고, `agentHealth` 에 "깔렸으면 쓰러짐" 한 줄을 더한다(§4.8). 갇힘의 나눔: **무너진 구획 안**과 **구획 밖 경계 1칸 안**의 사람 결과는 모두 X6 가 `cat:` 흐름으로 정하고(§4.1·4.2 — 경계의 수치는 H1 §5.1 의 2차 붕괴 갇힘과 같은 값을 쓴다), 2차 붕괴(`tickCollapse`) 곁의 갇힘만 H1 §5.1 의 `injuryRng(…, 'trap')` 을 쓴다. H1 연관 표의 X6 줄은 "경계 1칸도 `injuryRng(…, 'trap')`" 이라고 적었지만, 그러면 2차 붕괴 갇힘과 같은 목적 흐름을 나눠 써서 그쪽 결과가 밀린다(H1 §2.7·원칙 11 이 금지한 모양) — 이 문서의 결정으로 읽는다. 2차 붕괴 갇힘의 `carry`·`escort` 강제 보고는 H1 §5.1 이 이미 더한다(X6 는 H1 이 없을 때만 넣는다, §6.1) |
| R1 부대 편성·장비 | 가스 측정기(`gasMeter`)·열화상(`tic`)·공기호흡기 | 조짐을 읽는 능력은 R1 의 `hasKit`·`kitWorks` 로 본다(§3.4). R1 의 장비 표는 고치지 않는다(추천만 §12.3) |
| R2 대응 방식 | 내부 공격 ↔ 외부 방어(`suppress` 의 `defensive`), 지지대(`shore`), 환기 후 차단(`ventFirst`), 송풍기(`s.fan`) | **현장 단위의 전술 모드와 진입 금지 구역은 X6**(`Scene.ops`). R2 의 방법 선택은 대원 개인의 갈래다. X6 가 먼저 만드는 외부 방수 자리 찾기(`exteriorSpot`)와 `spray` 의 효과·물 배율 인자를 R2 의 `defensive` 가 그대로 쓴다. 지휘관이 외부 방어를 정한 구역에서는 R2 의 선택과 관계없이 외부 방수만 한다. R2 의 `shore` 는 균열을 `mitigated` 로 만든다(R2 §4.3 "그 균열을 직접 보강한다") — 그래서 X6 의 보강 반영(`c.shored`, §2.4)이 저절로 받는다. **`s.fan` 은 R2 의 칸이고 R2 가 X6 뒤에 구현된다** — X6 는 가스 모델에 송풍기 항을 넣지 않고, R2 가 합쳐질 때 R2 가 X6 의 가스 손실 줄 옆에 `1 − 0.3 × power` 항 한 줄을 더한다(R2 §10 X6 줄, 이 문서 §2.5) |
| R3 대응 교본 | 철수 판단 | R3 는 X6 의 위험 단계 표(`orders/catastrophe.ts` 의 `DANGER_RULES`, §5.2)를 "상황" 입력으로 읽고 분야·장비·상태에 따라 줄을 늘린다. 표의 모양은 바꾸지 않는다 |
| G4 현장 가독성 | 무너진 모습, 무너지는 순간, 지도의 무너진 건물 | 상태를 바꾸는 자리에서 G4 의 `markRuin`·`recordFall` 을 부른다(G4 §16). `FallRecord.cause`(G4: `'zone' \| 'secondary' \| 'ceiling'`)에 `'partial'`·`'total'` 을, `ruin` 값에 `RUIN_TOTAL = 10`(전체 붕괴 잔해)을 **추가만** 한다. 불로 무너진 구획은 G4 의 `'ceiling'` 을 그대로 쓴다(§7.5). 지도의 덧그림은 G4 의 `ruinLayer` 가 `Sim.placeMarks` 를 읽도록 넓힌다(§7.2). G4 가 아직이면 그 호출 자리에 주석만 남긴다 |
| G5 교전 연출 (이번 세션에 먼저 구현) | 폭발 그림·소리·자동 감속 | X6 의 폭발은 모두 `pushFx('boom', …)` 바로 뒤에 G5 의 `noteBoom(lastFx(sim, s, 'boom'), r, src)` 한 줄(G5 §2 표 15번, §11 의 X6 줄). `src` 는 G5 의 `FxInfo['src']` 합집합 끝에 새 줄로 `'drum' \| 'cng' \| 'jet' \| 'dust'` 를 더한다(가스 용기 `'tank'`, 가스 구름 `'gas'` 는 있는 값). 무너짐은 폭발 그림이 아니다 — G4 의 `'collapse'`. X6 의 철수 신호 `'horn'` 은 G5 의 `DECISIVE` 집합(`fxBook.ts`)과 카메라 목록에 한 단어씩 더한다(§7.4) |
| I2 교대 간 지속 | 다음 교대의 건물 상태 | I2 는 X6 가 사건에 남긴 결과를 끝 상태의 원천으로 먼저 읽는다(I2 §3.6: 전체 붕괴 → `ruin`, 전소 → `closed`, 구획 붕괴·폭발 → `closed`, 그을림 → `marked`). I2 는 이미 이 문서의 이름(`Sim.placeMarks`·`PlaceMark`·`catOf`)을 쓴다. `s.wear` 는 **I2 의 칸**이다(이어받은 손상·그을음). X6 는 `ShiftReport.placeMarks` 를 내놓기만 한다. I2 가 이어받은 손상(`s.wear.dmg`)을 X6 의 구조 건전도 처음 값에 한 항 더하는 것(I2 §7: `integ = min(처음 값, 1 − WEAR_INTEG × s.wear.dmg)`)과 `pickPlace` 의 `placeUsable` 은 I2 가 넣는다 |
| I1-b 인과 규칙 (`I1-causality.md`) | 원인 사슬, 현장 밖으로 퍼지는 결과 | X6 의 구획별 손실 장부(`cat.loss`)·원인 기록(`causeEv`)과 사슬 문구(§4.6·§6.6)가 I1-b 의 재료가 된다. **I1 §3.10 대로** X6 가 폭발·붕괴·전소를 만드는 자리마다 `signal(sim, 'catastrophe', …)` 한 줄을 남기고, `src/sim/world/consequence.ts` 가 없으면 빈 함수만 담은 그 파일을 만든다(§4 머리말). **`Sim.placeMarks` 는 `sim.world` 로 옮기지 않는다**(I1 연관 표의 결정 — G4·I2 가 그 이름을 읽는다). 도로: 전체 붕괴의 구간 통제(§4.2)는 사건 동안만이고 `closeIncident` 가 연다. 사건 뒤에도 남는 잔해는 I1 의 C2 `rubbleRoad` 가 이어받는다 |
| M2 지도의 다음 단계 (1) | 끝난 사건의 건물 흔적 | 전소·붕괴·폭발 흔적은 X6 가 자료를 만들고 G4(또는 X6 의 대체 층)가 그린다. 합치면 ROADMAP M2 (1)에서 이 몫을 지운다 |
| B1 화재 균형 | 화재 성공률 | X6 는 천장 붕괴와 가스 용기 규칙을 대체하므로 화재 결과가 바뀐다. **B1 이 합쳐진 뒤의 수치를 기준선**으로 잰다(§8) |

---

## 1. 지금 상태

### 1.1 무엇이 실제로 일어나고 무엇은 수치·문구뿐인가

| 위험 | 지금 실제로 일어나는 것 | 수치·문구뿐인 것 | 근거 |
|---|---|---|---|
| 붕괴 — 불 | 실내 방(`kind 'room'`) 칸의 55% 이상이 타면 그 방을 **한 번** 판정해 `s.rng.chance(0.55)` 로 잔해 1~2개 + `blast(방 가운데, 2.2, 22)` + `ESCALATION '○○ 천장 일부 붕괴'` | 복도·홀·건물 전체는 무너지지 않는다. 건물이 다 타도 서 있다. 조짐이 없다. 잔해를 사람이 선 칸에도 놓는다 | `hazards.ts:102-116` |
| 붕괴 — 붕괴 현장 | 보강하지 않은 균열(`unstable`)의 `leak` 이 `leakRate` 로 차서 1 이 될 때마다 둘레 ±2칸에 잔해 ≤3 + `blast(2.6, 28)` + `ESCALATION '○○ 2차 붕괴'`. 확률 없이 결정적, 첫 번째는 현장 생성 뒤 약 94~222초(보통) | 건물의 구조 상태라는 것이 없다. 2차 붕괴가 거듭돼도 국소적이다. 사람을 가두지 않는다(H1 이 고친다). 실행 중에 벽 타일은 바뀌지 않는다(생성 때 `buildCollapse` 만) | `hazards.ts:591-615`, `builders.ts:639-687` |
| 폭발 — 가스 용기 | 화재 속 `'gas'` 소품은 자기 칸 불 > 0.3 이거나 이웃 칸 > 0.6 이면 **즉시** 터진다: 2.3칸 안 연료 칸 불 0.85, `blast(3.6, 34)`, `HIDDEN_HAZARD` | 조짐이 없다. 지휘관이 알아도 아무 작업이 생기지 않는다(냉각·회피 없음). 터진 뒤에도 믿음이 `active` 로 남는다 | `hazards.ts:87-101`, `agents.ts:171-172`, `commander.ts:347` |
| 폭발 — 가스 누출 | 실내 `smoke > 0.6` 칸이 10개 이상이면 초당 `min(0.007, 0.00015 × 칸 수 × hazardMul)` 로 `blast(3.8, 32)`, 첫 밸브 `ignited`, 1.9칸 불 0.6 | 점화원 조건이 없다(불이 있어도 없어도 같다). 가스와 불 연기가 같은 격자다. **밸브 하나짜리 일반 가스 누출은 방치해도 짙은 칸이 3~8개라 터질 수 없다**(§1.2) | `hazards.ts:617-661` |
| 폭발 — 차량 연료 | `leak` 이 시간으로 차면 차 둘레에 불 0.55 (`blast` 없음) | 주변 불이 발화를 앞당기지 않는다. 연료 탱크·가스 용기(CNG 버스)의 폭발이 없다 | `hazards.ts:573-589` |
| 폭발 — 폭발물 | 시한·해체 실수로 `blast(3.4, 55)` + 쓰러짐 + 불 + 소리로 전원 무전 | — (이 묶음은 고치지 않는다. 구조 충격만 더해진다) | `rules/crime.ts:20-53` |
| 전소 | 연료가 0 이 된 칸은 `burned`, 불은 줄어 꺼진다 | 전소 판정이 없다. 재산 피해는 화재 유형만 탄 비율, 그 밖은 "불붙은 소품이 하나라도 있으면 0.4". 붕괴는 재산 피해가 아니다. 지도에 흔적이 없다 | `hazards.ts:25-40`, `debrief.ts:39`, `renderCity.ts:265-269` |
| 사람 | `blast` 는 거리만 보고 체력만 깎는다(벽·층 무시, 용의자 제외). 대원은 죽지 않는다 | 깔린 대원이 없다. 폭발·붕괴로 구조 대상이 새로 갇히지 않는다(H1 이 2차 붕괴만 고친다) | `hazards.ts:122-137`, `sceneManager.ts:137` |

### 1.2 방치하면 어떻게 되는가 (측정)

이 문서를 쓰며 스크래치 스크립트로 잰 것(현장만 만들고 대원 없이 `tickFire`·`tickGas` 를 1초씩 돌림. 스크립트는 저장소 밖에 두었다).

- **화재 `fire/std` 14건**: 모두 끝내 **100% 탄다**. 탄 비율 25%·50%·70%·90% 에 닿는 시각(현장 생성 기준) 129~232초 · 184~348초 · **218~443초(가운데 약 300초)** · 254~551초, 불이 다 꺼지는 시각 301~617초. 한 구획이 "불에 휩싸인"(칸의 30% 이상이 불 0.3 이상) 시간은 116~161초. 지금 규칙으로 천장 일부 붕괴가 건물당 1~5번 나지만 **건물은 빈 껍데기로 서 있고 전소라는 사건은 없다**.
- **가스 누출 `hazmat/std` 8건**(600초): 밸브 하나(심각도 1~2, `leakRate` 0.68~0.86 — 검토 때 시드 A0 에서 0.68 이 나왔다)는 짙은 칸이 최대 3~8개라 **한 번도 터질 수 없다**. 심각도 3(밸브 둘)은 18~108개, 한 건이 192초에 터졌고 그 불로 건물이 다 탔다(133/134).
- **가스 폭발 `collapse/gasblast` 8건**: 짙은 칸 10개가 14~26초에 찬다 — 대부분 **옆방 불의 연기** 때문이다. 6건이 33~324초에 터졌다(점화원과 무관한 확률 판정).
- 조사 결과(보통, 시드 S0~S2 강제): 붕괴 13건의 균열 16개 모두 보강, 2차 붕괴 1번. 화재 14건의 가스 용기 2개 모두 폭발. 가스 누출 11건의 밸브 16개 중 15 차단·1 발화. 차량 누출 발화 버스 2/2, 일반 2/2, 다중 추돌 1/4. 대원 부상 교대당 0. 보통 6교대의 '위험 수준이 너무 높습니다' 기록은 무장·버스 사고뿐, 화재 0.

### 1.3 AI 가 아는 것과 하는 것

- `perceive` 의 위험 관찰은 **있다/없다** 두 값뿐이다: 균열·밸브·차량 누출은 `haz {kind:'leak', active}`, 가스 용기는 `haz {kind:'gas', active:true}`, 폭발물은 `haz {kind:'bomb'}`. 진행도(`p.leak`)·가스 농도·열·탄 정도는 믿음에 들어가지 않는다(`agents.ts:155-191`). `FactType` 에 조짐을 담는 종류가 없다(`types.ts:130`).
- 지휘관의 위험 대응은 `haz leak` 이 살아 있으면 `mitigate`(0.86) 하나(`commander.ts:347`)와 폭발물 방의 수색 취소(`orders/crime.ts`)뿐이다. **전원 철수·진입 금지·외부 방어가 없다.** 작업은 위험과 무관하게 병렬로 나간다.
- 대원의 후퇴(`brain.dangerScore`)는 자기 둘레 3×3 의 `s.fire`(진실 — README 의 예외 목록에 없음)·연기 노출 시간·체력·피격을 본다. 균열·가스·용기는 보지 않는다. 후퇴가 끝나면 바로 다시 일을 고른다(재진입을 막는 기억이 없다).
- 7번 블록: `active` 대원이 없고 오는 부대도 없으면 60초 뒤 `abandoned` 다(`sceneManager.ts:221-237`). 대원을 모두 `withdrawn` 으로 빼면 방치로 닫힌다.
- 관제의 위험은 문자열(`risks`: '폭발 위험'·'2차 붕괴 위험')뿐이고 현장에 전달되지 않는다(`briefFacts` 는 `type`·`occ` 만, `briefUpdate` 는 `hazard` 주제를 버린다). 현장의 위험 변화가 관제 평가로 돌아가는 길도 없다(`dispatcher.fieldReport` 는 유형과 지원 요청만).

---

## 2. 위험 모델

### 2.1 세 가지 위험 — 한눈에

| 위험 | 진실의 수치 (`Scene.cat`) | 오르는 원인 | 내리는(막는) 조치 | 문턱 → 일어나는 일 |
|---|---|---|---|---|
| **붕괴** | 구획별 구조 건전도 `integ[r]`(1 → 0), 건물 전체 `bldg` | 불의 열(그 구획의 불 세기 × 시간), 탄 비율(골조가 탄 만큼 상한이 내려간다), 보강하지 않은 균열(서서히), 충격(2차 붕괴·천장 붕괴·폭발 — `blast` 마다), 여진, 이웃 구획의 붕괴(하중 이동) | 보강(`mitigate` 균열, R2 `shore`) → 건전도 +0.1·서서히 줄던 것이 멈춤, 냉각(젖은 칸은 열 항을 줄인다), 진압(불 제거) | `integ < 0.36` 임박(조짐 3) → 4초 뒤부터 초당 확률로 **구획 붕괴**. 무너진 구획의 몫 ≥ 45% 또는 `bldg < 0.30`(= 건물 조짐 3) → 6초 뒤부터 **전체 붕괴** |
| **폭발** | 칸별 가연성 가스 `gas[i]`(1 = 폭발 하한 LEL), 용기별 열 `p.heatLoad`(0 → 1), 분진 구획 | 밸브 누출(원천), 밀폐(환기 부족), 점화원(불·붕괴의 불꽃·알 수 없는 스파크), 불길에 닿은 용기 | 밸브 차단, 도시가스 공급 차단(관제 요청), 환기(깨진 창·열린 문·R2 송풍기), 점화원 제거(진압), 용기 냉각(물) | LEL 이상 칸이 이어진 **구름 + 점화원 → 가스 폭발**. `heatLoad ≥ 1` → **용기 폭발**(가스 용기·화학 드럼·CNG 버스·항공유) |
| **전소** | `burnedTiles / totalFuelTiles` (지휘관은 "센 불이 얼마나 오래 탔는가"로 추정) | 불의 확산(`fireSpreadMul`), 연료(공업·창고), 진압 지연·용수 소진·부대 부족, 외부 방어로 바꾼 뒤 손이 닿지 않는 안쪽 방 | 진압, 급수(소화전), 추가 진압 부대, 외부 방수 | 탄 비율 ≥ 0.7 → **전소**(재산 피해 100%). 탄 구획은 건전도 상한이 내려가 **구획 붕괴 → 전체 붕괴**로 이어진다 |

### 2.2 자료형 (`types.ts` — 추가만, 합집합 끝에는 새 줄로)

```ts
// ───────────────────────── 위험의 현실화 (X6) ─────────────────────────
/** 현장의 위험 상태 (진실). field/catastrophe.ts 만 만들고 바꾼다.
 *  지휘관·대원의 판단부·관제는 읽지 않는다 — 조짐(sign 사실)으로만 안다 */
export interface CatState {
  struct: boolean;              // 구조 규칙(§2.4)을 쓰는 건물 현장인가
  foot: Uint8Array;             // 칸별 (ops.ts 의 footprint(s) 가 처음 생김새로 한 번 계산한 같은 배열, §2.4):
                                //   0 바깥 · 1 건물 안(실내 칸과 안쪽 벽) · 2 바깥벽·창(바깥과 맞닿은 벽) · 3 층 경계(VOID 와 맞닿은 벽·창 — 어떤 붕괴도 바꾸지 않는다)
  integ: Float32Array;          // 구획(s.regions 번호)별 구조 건전도 1(멀쩡) … 0. 실내 구획만 뜻이 있다
  loss: Float32Array;           // 구획 × 6 원인(LOSS_FIRE · BURN · CREEP · IMPACT · BLAST · QUAKE)의 누적 손실 — 보고서의 원인 문장
  hotT: Float32Array;           // 구획별 '불에 휩싸인'(칸의 30% 이상이 불 0.3 이상) 누적 초 — 원인 문장
  l3Since: Float32Array;        // 구획별 '붕괴 임박'(integ < L3)이 시작된 시각 (-1)
  damage0: Uint8Array;          // 처음(현장 생성 때)의 s.damage 사본 — 사건 중에 무너진 칸만 재산 피해로 센다
  hits: { t: number; x: number; y: number }[];   // 최근의 충격(blast·구획 붕괴·전체 붕괴) 자리 — 가스 점화(§2.5)용.
                                //   통째로 비우지 않고 매초 t ≥ sim.t − 1.2 인 것만 남긴다 (7단계의 붕괴가 다음 초 3단계 점화 검사에 닿게)
  gasN: number; vesselN: number; dustN: number;  // X6 가 일으킨 폭발 수 (종류별 — 시험 §10-8 이 기록 수와 견준다. 폭발물은 세지 않는다)
  fallen: Uint8Array;           // 구획별 무너짐 (1)
  bldg: number;                 // 건물 전체 건전도 (서 있는 구획의 칸 수 가중 평균, 무너진 구획은 0 으로 센다)
  bldgL3Since: number;
  gas: Float32Array | null;     // 칸별 가연성 가스 (1 = 폭발 하한 LEL). 밸브가 있는 현장만 만든다
  gasTmp: Float32Array | null;
  cloudSince: number;           // LEL 구름(N ≥ 3)이 생겨 이어진 시작 시각 (-1) — 스파크의 나이 항 (§2.5)
  fuelMask: Uint8Array;         // catOf 때 건물 칸(foot ≥ 1)이고 연료가 있던 칸 (1) — 전소 비율의 분모·분자를 이 칸으로만 센다 (§2.7)
  fuel0: number;                // fuelMask 의 칸 수 (30 미만이면 전소 판정을 하지 않는다)
  burntAt: number;              // 전소 판정 시각 (-1)
  totalAt: number;              // 전체 붕괴 시각 (-1)
  lastFall: { t: number; x: number; y: number; region: number } | null;
  events: number;               // 붕괴·폭발이 일어난 수 (소리 사실의 번호)
  shakeSeen: number;            // 반영한 지진 흔들림 수 (sim.disaster.shakes 의 길이). 처음 값은 catOf 를 만들 때의 sim.disaster?.shakes?.length ?? 0
                                //   (안 그러면 본진 뒤에 생긴 현장이 지난 흔들림을 한꺼번에 소급해 받는다)
  shored: number[];             // 보강을 이미 반영한 균열 id
  limitBonus: number;           // 세계 쪽 한계 시간 보탬(붕괴마다). 지휘 쪽 보탬은 OpsState.limitBonus — 7번 블록이 둘을 합친다 (§6.4)
  dustRegion: number; dustDone: boolean;   // 분진이 쌓인 구획 (-1)과 이미 터졌는가 (§4.5, 선택)
  flashed: number[];            // 플래시오버가 난 구획 (§4.7, 선택)
  utilityAt: number;            // 도시가스 공급이 끊길 시각 (-1 아직 요청 없음, -2 이미 끊김)
  causeEv: Int32Array;          // 구획별 손실을 가장 크게 만든 마지막 기록 (붕괴 기록의 causes)
}
/** 지휘 상태: 전술 모드와 진입 금지 구역. 지휘관이 정하고 모두가 읽는다 (s.entryOrdered 와 같은 자격 — 조직이 아는 것) */
export interface OpsState {
  mode: 'interior' | 'withdraw' | 'defensive' | 'rubble';
  since: number; reason: string; ev: number;     // 마지막 전환 시각 · 까닭 · 기록
  zones: NoGoZone[];
  parAt: number; parAsked: number[]; parOk: number[]; parTries: number;   // 인원 점검 (parAsked 에는 명령 때 active 인 대원만)
  parDue: number;                                // 인원 점검 시한 (parAt + 70). 이 시각까지만 'withdraw' 가 종료를 막는다 (§6.2)
  burnSince: Record<number, number>;             // 지휘관의 기억: 구역별로 센 불(믿음 ≥ 0.5)을 처음 본 시각 (0.3 아래로 내려가면 지운다)
  everHot: number[];                             // 한 번이라도 burnSince 에 들어간 구역 (지우지 않는다 — 외부 확인 종료 §6.2 가 쓴다)
  quietSince: number;                            // 마지막으로 위험 단계가 오른 뒤 조용해진 시각
  calmSince: Record<string, number>;             // DANGER_SIGN 키별로 조짐이 1 이하로 가라앉은 시각 (§5.8 의 20초)
  utilityAsked: number;                          // 도시가스 차단을 요청한 시각 (-1)
  concluded: boolean;                            // 외부 확인 종료를 결정했다 (§6.2)
  reentries: number;
  rubble: number[];                              // 무너진 뒤 잔해 수색을 허락한 구역
  entry: Record<string, { until: number; n: number; last: number }>;   // 구역 키별 제한적 구조 진입 (§5.6): 끝 시각 · 횟수 · 마지막 시각
  gated: number;                                 // 지난 계획 주기에 문(registerGate)이 막은 want 수 (§5.3) — 0 보다 크면 종료를 막는다 (§6.2)
  noExt: number[];                               // 외부 방수 자리를 두 번 찾지 못한 구역 — 외부 방수를 다시 내지 않는다 (§5.5)
  limitBonus: number;                            // 지휘 쪽 한계 시간 보탬 (외부 방어로 처음 바꿀 때 +150, §6.4)
}
export interface NoGoZone {
  key: string;                                   // 'struct:3' · 'gas:5' · 'vessel:12' · 'bldg' · 'fire:4' · 'dust:2'
  kind: 'struct' | 'gas' | 'vessel' | 'fire' | 'bldg' | 'dust';
  level: 2 | 3;                                  // 2 = 새 진입 금지(허락된 일만) · 3 = 전원 철수
  regions: number[]; x: number; y: number; r: number;   // 구역 목록과 원 (r = 0 이면 원 없음)
  since: number; why: string; ev: number;
}
/** 조짐 사실(sign)의 값 */
export interface SignBelief {
  kind: 'struct' | 'bldg' | 'gas' | 'vessel' | 'fire' | 'dust' | 'event';
  level: number;                                 // 0 없음 · 1 조짐 · 2 위험 · 3 임박 (event 는 3)
  region: number; x: number; y: number;
  lel?: number;                                  // 가스: 측정값 (% LEL, 5 단위). 냄새로만 안 것은 없음
  prop?: number;                                 // 용기 id
  what?: 'partial' | 'total' | 'gas' | 'vessel' | 'dust' | 'burnout' | 'flashover'
    | 'utility';                                 // event 의 종류. 'utility' = 도시가스사의 공급 차단 완료 통보 (level 0, id 5001 — §5.8)
  down?: boolean;                                // 확인된 하향: 앞 단계를 알아챌 수 있는 감각 범위 안에서 그 단계가 사라진 것을 본 보고 (§3.1).
                                                 //   믿음을 합칠 때 단계가 내려가는 사실은 이것이 참일 때만 덮는다 (§3.2)
}
/** 지도에 남는 건물 상태 (이 교대 동안). Sim.placeMarks */
export interface PlaceMark { placeId: number; state: 'scorched' | 'blasted' | 'partial' | 'burnt' | 'collapsed'; t: number; incidentId: number; burnFrac: number; ruinFrac: number }
```

있는 자료형에 더하는 칸(모두 선택 칸):

```ts
// FactType 끝에
  | 'sign'          // 조짐: 구조 약화·가스 농도·용기 가열·불꽃 역류·분진, 그리고 붕괴·폭발 소리 (값 SignBelief)
  | 'ops';          // 지휘 상태: id 0 = 전술 모드와 진입 금지 구역, id 100 + rid = 그 대원의 인원 점검 응답
// TaskKind 끝에
  | 'evacuate'      // 철수 이동: 단계 3 구역 밖, 대개 대기 지점으로
// ProblemCode 끝에 — debrief.ts 의 PROBLEM_LABEL 이 Record<ProblemCode, string> 이므로 이름표 다섯 줄을 **같은 커밋(1단계)**에 넣는다 (§9)
  | 'DANGER_SIGN'      // 위험 조짐 (지휘관이 단계 2 이상을 처음 앎). 막으면 복구
  | 'WITHDRAWAL'       // 전원 철수 (구역별). 다시 들어가면 복구
  | 'STRUCT_COLLAPSE'  // 구조물 붕괴 (구획·전체)
  | 'EXPLOSION'        // 폭발 (가스 구름·용기·분진) — 지휘관이 몰랐던 위험이면 HIDDEN_HAZARD 로 남긴다
  | 'BURNOUT'          // 건물 전소
// Fx.kind 끝에 (같은 줄의 끝, G4 의 'collapse' 뒤)
  | 'horn'             // 철수 신호 (소리·카메라·자동 감속이 본다)
// Scene 끝에
  cat?: CatState;
  ops?: OpsState;
// Prop 끝에
  vessel?: 'cylinder' | 'drum' | 'cng' | 'jet';   // 열을 받으면 터지는 용기. gas 소품은 없으면 cylinder
  heatLoad?: number;                               // 용기가 받은 열 0..1 (1 이면 터진다)
  heatK?: number;                                  // 용기마다 다른 열 배율 (0.8~1.25, 처음 볼 때 정한다)
// FieldAgent 끝에
  trapped?: number;                                // 잔해에 깔린 대원의 남은 구출 작업량 (없거나 0 = 깔리지 않음)
  trapEv?: number;                                 // 깔리게 한 붕괴 기록 (agentHealth 의 쓰러짐 기록 causes, §4.8)
  avoid?: { regions: number[]; x: number; y: number; r: number; until: number };   // 조짐을 보고 물러난 대원이 한동안 피하는 곳
  opsSeen?: number;                                // 마지막으로 따른 철수 명령의 시각 (기록 중복 방지)
  signObs?: Record<number, number>;                // 조짐 사실 id → 이 대원이 **자기 감각으로** 마지막에 관찰한 단계 (§3.1 — 전달받은 믿음과 견주지 않는다)
  extSeen?: { hot: Float32Array; cov: Float32Array; cov0: Float32Array };   // 벽 너머 외부 관찰의 기억 (perceive 의 throughWalls 갈래가 쓴다, §6.2):
                                                   //   구획별 마지막으로 불 ≥ 0.25 를 본 시각 · 마지막으로 관찰 범위에 든 시각 · 처음 범위에 든 시각 (-1)
// WorkItem 끝에
  risky?: boolean;                                 // 제한적 구조 진입 (§5.6) — 건강한 소방 대원만 맡는다
// Incident 끝에
  fieldRisk?: { sev: number; risks: string[] };    // 현장 상황 보고(sitrep)로 관제가 올린 위험도와 위험 문자열 — assess 가 다시 평가할 때 합친다 (§5.9)
// IncidentResult 끝에
  catastrophe?: { burnout: boolean; total: boolean; partial: number; explosions: number; withdrew: boolean; averted: number; crewCaught: number };
// ShiftReport 끝에
  catastrophe?: { burnouts: number; totals: number; partials: number; explosions: number; withdrawals: number; averted: number; crewCaught: number };
  placeMarks?: PlaceMark[];
```

`engine.ts` 의 `Sim` 에 `placeMarks = new Map<number, PlaceMark>();` 한 줄(교대마다 새 `Sim` 이므로 이어지지 않는다). 새 난이도 손잡이는 만들지 않는다 — 심각도의 `tune.hazardMul` 을 쓴다(§8.2).

**객체 모양**(CLAUDE.md 함정 "자주 도는 객체의 모양"): 새 선택 칸은 생성 리터럴에도 같은 순서로 `undefined` 로 넣는다 — `Prop` 의 `vessel`·`heatLoad`·`heatK` 는 `kit.ts` 의 `PROP_BLANK`, `Scene` 의 `cat`·`ops` 는 `kit.ts` 의 `baseScene`(교대 중에 생기는 현장은 `createScene` 이 같은 리터럴을 쓰는지 확인), `FieldAgent` 의 `trapped`·`trapEv`·`avoid`·`opsSeen`·`signObs`·`extSeen` 은 `sceneManager.unitArrived` 의 대원 리터럴(R1 이 `makeAgent` 로 꺼냈으면 그 함수), `WorkItem` 의 `risky` 는 `commander.want` 의 리터럴, `Incident` 의 `fieldRisk` 는 `incidents.createIncident` 의 사건 리터럴. 정확성과는 무관하고 속도만의 문제다.

**합집합에 멤버를 더할 때마다** `grep -rn "Record<ProblemCode\|Record<FactType\|Record<TaskKind\|Record<WorkKind" src` 로 모든 키를 요구하는 표를 찾는다. 지금은 `debrief.ts` 의 `PROBLEM_LABEL` 하나다(빠뜨리면 `tsc` 가 TS2741 로 멈추고 "1단계 해시 불변" 관문을 통과할 수 없다).

### 2.3 갱신하는 자리와 순서

세계 규칙은 `rules/catastrophe.ts` 에서 `registerRule` 로 등록하고, 몸통은 `catastrophe.ts` 에 둔다(`damage.ts` 처럼 `hazards.ts` 와 같은 자격). `scenes/index.ts` 의 import 순서에서 **맨 끝**(crime → major → disaster → (H1 의 injury) → catastrophe)에 둔다 — 규칙의 실행 순서가 결과를 정한다.

```ts
// rules/catastrophe.ts
registerRule((sim, s, I) => {
  if (I.phase === 'closed') return;             // 판정(evaluate) 뒤에는 아무것도 일어나지 않는다 — 대원이 떠나는 동안에도 규칙은 돈다
                                                //  (sceneManager 1번 블록). rules/crime.ts 의 폭발물 규칙·H1 §2.6 과 같다
  const c = catOf(sim, s);                      // 대상이 아니면 null (처음 부를 때 만든다 — catinit 흐름으로 용기 열 배율·분진·드럼통)
  if (!c || (sim.tick + s.id) % 5 !== 0) return;  // 1초에 한 번: tickFire·tickGas 와 같은 틱, 그 뒤
  catTick(sim, s, I, c);
});
```

**`catOf(sim, s)` 를 만드는 규칙** — 규칙·`blast`(→ `catOnBlast`)·`perceive`·`debrief` 어느 입구에서 처음 불려도 같은 결과를 내야 한다:
- 첫 검사는 **현장 객체만** 본다: 실내 구획(`s.regions.some(r => r.indoor)`)도, 용기(§2.6)도, 밸브도, `leakRate > 0` 인 차량(§2.6 끝 — 차량 연료 점화)도 없으면 `WeakSet` 에 적고 `null`(다음부터 바로 `null` — 매 틱 모든 현장에서 돈다). 그다음에야 `sim.incidents[s.incidentId]` 를 읽고, 없으면(시험의 가짜 사건 `{ id: 0 }`, `tests/destruction.test.ts`) 역시 `null`. `I.truth` 는 그 뒤에 읽는다.
- `catinit` 흐름에서 뽑는 순서를 고정한다(용기 `heatK` 를 소품 순서대로 → 드럼통 → 분진). `Rng.fork` 는 부모를 소비하지 않으므로 처음 부르는 시각·입구와 관계없이 값이 같다. `damage0` 는 그때의 `s.damage` 사본인데, 현장의 첫 틱(규칙이 매 틱 `catOf` 를 부른다) 전에는 `s.damage` 가 바뀌지 않으므로 생성 때의 값과 같다.
- `c.shakeSeen = sim.disaster?.shakes?.length ?? 0`. `disaster.ts` 의 `shakes` 는 주석이 "그림용"이지만 이제 시뮬레이션이 읽는다(`disaster.ts` 는 고치지 않는다 — 본진 때 `shakes = [t]`, 여진마다 `push`).

`catTick` 의 순서(바꾸면 결과가 바뀐다):

1. **지진 흔들림 반영** — `sim.disaster?.shakes` 의 길이가 `c.shakeSeen` 보다 길면 그만큼 구획 건전도를 깎는다(§2.4). 맨 앞에서 `c.hits = c.hits.filter(h => h.t >= sim.t − 1.2)`.
2. **도시가스 차단** — `s.ops?.utilityAsked ≥ 0` 이고 `c.utilityAt === -1` 이면 `c.utilityAt = utilityAsked + catRng.range(90, 150)`. 그 시각이 지나면 **한 번만**(처리한 뒤 `c.utilityAt = -2`) 살아 있는 밸브를 모두 `mitigated` 로 하고, 기록 `도시가스사: 공급 차단 완료 — 누출이 멈춥니다.`(SYSTEM, imp 2)와 함께 현장 전원에게 알린다: `s.radio.push({ from: -1, to: -1, kind: 'brief', deliverAt: sim.t + 0.6, facts: [mkFact('sign', 5001, { kind: 'event', what: 'utility', level: 0, region: -1, x: -1, y: -1 }, '도시가스사', sim.t, 1, true, '도시가스 공급 차단 완료')], … })`. **밸브마다 `haz` 사실을 뿌리지 않는다** — 아직 모르는 밸브의 id·위치가 새어 나간다. 지휘관은 이 사실로 "원천 차단"을 안다(§5.7·§5.8).
3. **가스** — 원천 → 확산 → 손실(§2.5).
4. **용기의 열**(§2.6).
5. **구조** — 구획별 손실, 보강 반영, 건물 건전도, 조짐 단계용 값(§2.4).
6. **전소 판정**(§2.7).
7. **일어나는 일** — 가스 폭발 → 용기 폭발 → (분진 폭발) → 구획 붕괴 → 전체 붕괴. 한 초에 여러 개가 날 수 있고, 순서는 이대로 고정한다(앞의 폭발이 뒤의 붕괴를 앞당긴다). 여기서 생긴 붕괴는 `c.hits` 에 남아 **다음 초**의 3단계에서 가스 점화원이 된다(§2.5 점화 2).
8. **(선택) 플래시오버**(§4.7).
9. **지도 기록** — `Sim.placeMarks` 의 탄 비율·잔해 비율 갱신(§7.1).

`hazards.ts` 에서 바뀌는 곳(§11.2): `tickFire` 의 `// 가스 용기 폭발 (숨겨진 추가 위험)` 덩어리와 `// 붕괴` 덩어리(1ca465d 의 87~116줄)를 **지운다**(X6 의 용기 열·구획 붕괴가 대신한다). `tickGas` 의 `let dense = 0` 부터 끝까지의 폭발 덩어리를 **지운다**(X6 의 가스 구름이 대신한다 — 연기 격자에 가스를 쓰는 앞부분과 주변 시민 노출은 그대로). `blast` 끝에 `catOnBlast(…)` 한 줄(구조 충격 §2.4 와 `c.hits` 넣기 — `catOf` 가 `null` 이면 아무것도 하지 않는다)과 층(VOID) 너머 사람 건너뛰기를 더한다. `tickCollapse`·`tickLeaks`·`smokeSpread` 는 고치지 않는다. X6 가 연기 격자에 직접 쓰는 것(붕괴 먼지·드럼통의 유독 연기)은 `tickFire` 의 "타는 칸도 연기도 없으면 연기 확산을 건너뛴다" 검사가 연기 칸을 훑어 알아채므로 따로 고칠 것이 없다(CLAUDE.md 함정 "공유 버퍼와 색인"). `burned[]` 는 X6 가 쓰지 않는다(`tickFire` 만 쓴다).

### 2.4 구조 건전도 (붕괴 위험)

**대상 현장** `c.struct`: 실내 구획이 있고(`s.regions.some(r => r.indoor)`), 길 위의 현장이 아니고(`!s.outdoor`), 변형이 `NO_STRUCT = ['ship', 'plane', 'train', 'pileup', 'crane', 'landslide', 'elevator', 'wild']` 가 아니다. 선박·비행기·열차·크레인·산사태·승강기·산불(`fire/wild` — 숲 속 오두막, 장소가 숲·펜션)은 구조 규칙을 쓰지 않는다(용기·가스는 쓴다). **전소·전체 붕괴·지도의 건물 상태도 `c.struct` 현장만**이다(§2.7·§7.1).

**건물 칸 `foot`** — `ops.ts` 의 생김새 도움 함수 `footprint(s)` 가 계산하고 `WeakMap<Scene, Uint8Array>` 에 둔다(지휘 쪽 `evacPoint`·`exteriorSpot` 의 "건물 칸에서 2칸" 판단이 같은 배열을 쓴다 — `ops.ts` 는 `s.cat` 을 읽을 수 없으므로 `foot` 를 `CatState` 에서 꺼내 생김새 함수로 둔다. `catOf` 가 `c.foot = footprint(s)` 로 같은 배열을 받는다):
- 1 = 실내 칸(`isIndoor`)과 그 8 이웃의 벽·창·문·계단.
- 2 = 그 가운데 4 이웃에 바깥 칸(`GROUND`·`ROAD`·`TREE`·`TRAIL`)이 있는 벽·창(바깥벽).
- **3 = 4 이웃에 `T.VOID` 가 있는 벽·창(층 경계)** — 2보다 먼저 판정한다. 2층 건물(`plans.ts` 의 `tallPlan`)의 2층은 둘레가 `VOID` 뿐이라 이것이 없으면 2층 외벽이 모두 1(안쪽 벽)이 되어 전체 붕괴 때 사라지고, 1층 동쪽 바깥벽과 2층 바닥이 3칸까지 가까워진다(CLAUDE.md 함정 "두 층은 벽과 `VOID` 로 4칸 이상"). **3 인 칸은 어떤 붕괴도 바꾸지 않고**, 쏟아짐·그루터기 규칙에서도 뺀다(검토 때 2층 건물 하나의 안쪽 벽 86칸 가운데 42칸이 이것이었다).
- 처음 한 번 계산한다(무너지면 다시 계산하지 않는다 — 원래 모습). `catOf` 가 첫 틱에 부르므로 원래 생김새가 들어간다.

**이웃 구획** `regionNbrs(s)`(역시 `ops.ts` 의 생김새 도움 함수, `WeakMap` 에 한 번): 원래 생김새에서 두 구획의 칸이 **벽 한 칸을 사이에 두고** 마주 보거나(4방향, 벽 너머 2칸) **문 칸 하나로** 이어지면 이웃이다. `VOID` 너머·계단(`stairTo`)으로는 이웃이 아니다. 처음 값(바로 아래)·하중 이동·구역 범위(§5.2)·소리(§3.1)가 모두 이것을 쓴다. 붕괴 뒤의 현재 타일로 다시 계산하지 않는다 — 다시 계산하면 지휘 쪽이 보지 못한 붕괴를 이웃 관계로 알게 된다.

**처음 값**: 보통 건물 1.0. 붕괴 유형(`s.kind === 'collapse'`, `gasblast` 포함)은 무너진 자리(`s.damage`)가 한 칸이라도 있는 구획 `0.75 − 0.05 × sev`(심각도 1·2·3 → 0.70 · 0.65 · 0.60), 그 이웃 구획 0.85. 지진 재난 중에 생긴 사건(`I.tag === 'disaster:quake'`)의 다른 구획 0.9. 붕괴 현장의 무너진 구획은 처음부터 삐걱이지는 않는다(0.60~0.70 은 단계 1 문턱 0.6 이상) — 균열이 조금만 진행되거나 2차 붕괴(−0.14)가 한 번 나면 삐걱이기 시작한다.

**매초 손실** (구획 r: 실내, 무너지지 않음, 칸 수 n):

```
hot  = Σ (fire_i ≥ 0.3 ? fire_i : 0) / n          // 그 구획을 태우는 불의 세기
burn = Σ burned_i / n                              // 탄 칸의 몫
wet  = min(1, 2 × Σ wet_i / n)                     // 물에 젖은 정도 (물이 골조를 식힌다)
hz   = 0.8 + 0.2 × tune.hazardMul
L_fire  = K_HEAT × hot × (1 − 0.6 × wet) × hz                         // K_HEAT = 0.0025
L_creep = (그 구획 안의, 보강 안 된, leakRate > 0 인 균열 수) × K_CREEP × hz      // K_CREEP = 0.00035
integ -= L_fire + L_creep                          // 장부: loss[FIRE], loss[CREEP]
cap = 1 − K_BURN × burn                            // K_BURN = 1.0 — 탄 골조는 다시 튼튼해지지 않는다
if (integ > cap) { loss[BURN] += integ − cap; integ = cap; }
```

**한 번에 깎이는 것**:

| 일 | 깎이는 양 | 장부 |
|---|---|---|
| `blast(x, y, radius, dmg, ev, cause)` (모든 폭발·천장 붕괴·2차 붕괴·폭발물) | 가운데가 `radius + 2` 안인 구획마다 `K_HIT × dmg/100 × (1 − d/(radius+2))`. `K_HIT` = 원인이 `crush`(무너짐)면 0.5, 그 밖(폭발)이면 0.8. 예: 2차 붕괴 28 → 가운데 구획 −0.14, 폭발물 55 → −0.44 | IMPACT / BLAST |
| 이웃 구획이 무너짐 | −0.12 (하중이 옮겨 온다) | IMPACT |
| 지진 흔들림(여진) | 붕괴 유형 −0.18, 그 밖 −0.08 | QUAKE |

**보강**: 균열이 `mitigated` 가 되면(지금의 `mitigate` 실행 또는 R2 `shore` — R2 의 `shore` 도 `p.mitigated = true` 로 끝난다) 그 균열이 있는 구획 `integ = min(cap, integ + 0.1)`(탄 몫 상한은 넘지 않는다), 그리고 그 균열은 서서히 깎는 항에서 빠진다. 규칙이 `c.shored` 로 한 번만 반영한다(실행기를 고치지 않는다).

**조짐 단계(진실 쪽 값)**: `L1 = 0.6`(삐걱임) · `L2 = 0.45`(균열·처짐) · `L3 = 0.36`(임박). `integ < L3` 가 된 시각을 `l3Since[r]` 에 적고, 다시 올라가면 지운다.

**구획 붕괴 판정** (매초, 무너지지 않은 구획): `integ ≤ 0.05` 이면 바로. 아니면 `l3Since[r] ≥ 0 && sim.t − l3Since[r] ≥ 4` 일 때 `catRng.chance(min(1, 0.01 + 0.5 × (L3 − integ)))` (0.36 에서 초당 1% — 평균 100초, 0.30 에서 4%, 0.16 에서 11%). 붕괴의 내용은 §4.1.

**건물 전체**: `bldg = Σ_{서 있는 구획} n_r × integ_r / Σ_{모든 실내 구획} n_r`, `fallenShare = Σ_{무너진 구획} n_r / Σ n_r`. 건물 조짐 단계: `bldg < 0.5 || fallenShare ≥ 0.25` → 2, **`bldg < TOTAL_BLDG(0.30) || fallenShare ≥ TOTAL_SHARE(0.45)` → 3**(그때 `bldgL3Since`). 단계 3 의 문턱을 전체 붕괴의 문턱과 **같게** 둔다 — 다르면(예: 3 을 0.38·0.40 에서) 불을 끈 뒤 건물이 그 사이에 머물러 "임박" 조짐도 붕괴도 끝나지 않고, 외부 방어가 한계 시간까지 간다. **전체 붕괴 판정**: `bldgL3Since` 뒤 6초가 지났으면(단계 3 이 이어지는 동안) 매초 `catRng.chance(0.02 + 0.6 × max(0, 0.30 − bldg) + (fallenShare ≥ 0.6 ? 0.1 : 0))`, `bldg < 0.12` 이면 바로. 그래서 건물 조짐 3 은 언제나 끝내 무너진다(초당 2% 이상 — 평균 50초 안). 내용은 §4.2.

**계산 예**(검증용): ① 사람이 맡지 못한 큰 불 — 방이 70% 타면 상한 0.30 → 4초 뒤부터 초당 4% → 대개 30초 안에 무너진다. 방치된 화재(§1.2)는 탄 비율 64~70% 무렵부터 구획이 차례로 무너지고, 무너진 몫이 45% 를 넘는 300~450초 무렵 전체 붕괴 — "전소 → 붕괴". ② 진압된 불 — 방이 40% 타고 꺼지면 상한 0.6(조짐 1) — 서 있다. 64% 넘게 탄 방은 상한이 0.36 아래라 다시 올라가지 않고, 불을 꺼도 무너질 때까지(초당 1% 이상) 단계 3 으로 남는다(§12.2-13). ③ 붕괴 현장 심각도 3, 균열 둘을 보강하지 않음 — 0.60 에서 초당 0.0007 → 0.36 까지 약 340초. 그 사이 가운데(`d = 0`)에서 2차 붕괴(−0.14 = 0.5 × 28/100)가 한 번 나면 약 200초(0.14 / 0.0007) 앞당겨진다(곁 구획은 거리만큼 덜). 보강은 보통 도착 뒤 60~150초에 끝나므로(§1.2) 대개 막는다.

### 2.5 가연성 가스 (폭발 위험 ①)

지금의 `tickGas` 는 연기 격자(`s.smoke`)에 가스를 덮어쓴다(시야·건강 피해용, 그대로 둔다). X6 는 **가스만의 격자** `c.gas` 를 따로 굴린다 — 연기와 섞이지 않고, 밀폐된 곳에서 시간이 지날수록 **쌓인다**(지금의 `max(이웃 × 0.86)` 식은 쌓이지 않아 밸브 하나로는 폭발 하한에 닿지 못한다).

매초 (밸브가 있는 현장만, 모든 칸이 0.001 아래이고 살아 있는 밸브가 없으면 건너뛴다):

```
가스 칸 = 실내 칸 (FLOOR·DOOR·FURN·STAIR 이고 isIndoor). 가스는 이 칸에만 있다 — 바깥 칸은 계산하지 않는다(늘 0)
원천: 살아 있는 밸브(mitigated·ignited 아님)마다 gas[밸브 칸] += GAS_SRC × leakRate × (0.75 + 0.25 × hazardMul)    // GAS_SRC = 0.15
확산: 가스 칸 i 마다, 4 이웃 j 가 **가스 칸일 때만** 교환한다 (벽·VOID·ROCK·WATER·창·바깥 칸과는 교환하지 않는다)
      tmp[i] = gas[i] + D × Σ_j k_ij × (gas[j] − gas[i])           // D = 0.12 — 가스 칸끼리만이라 합이 보존된다
      k_ij = 1, 둘 중 하나가 닫힌 문이면 0.15. 계단 칸은 stairTo 칸도 이웃으로 본다(0.9배)
손실: 가스 칸 × (1 − 0.004)                                          // 벽 틈으로 새는 몫
      환기 항 — 4 이웃에 **깨진 창(s.glass[j] = 1)** 이나 **열린 바깥 출입문**(바깥 칸과 맞닿은 문 칸이 열려 있음)이 있는 가스 칸 × (1 − 0.12)
      깨지지 않은 창·닫힌 바깥문은 막힌 칸이다(빼지도 교환하지도 않는다)
      (R2 가 합쳐지면 R2 가 여기 한 줄을 더한다: 송풍기 s.fan 이 돌면 그 출입구 3칸 안 × (1 − 0.3 × power) — X6 는 s.fan 을 쓰지 않는다)
상한 3
```

**폭발 하한(LEL) = 1.0.** 측정값 `% LEL = round(gas × 100 / 5) × 5`. 조짐 단계: 0.10 → 1, 0.25 → 2, 0.60 → 3 (§3).

**구름**: `gas ≥ 1` 인 칸이 4 이웃으로 이어진 덩어리. 매초 덩어리를 찾는다(가장 큰 것부터).

**점화**(덩어리마다, 위에서부터 하나라도 맞으면 그 초에 폭발 — §4.3):
1. **불**: 덩어리 칸 가운데 `fire ≥ 0.15` 이거나, 덩어리 칸의 4 이웃에 `fire ≥ 0.3` 인 칸이 있다. (확률 없음)
2. **무너짐·충격**: `c.hits`(최근 1.2초 — §2.2) 가운데 덩어리에서 3칸 안의 것이 있다. 넣는 곳: `catOnBlast`(모든 `blast` — 2차 붕괴·폭발물·X6 의 폭발), `collapseRegion`·`collapseBuilding`(§4.1·4.2 의 상태 줄). 통째로 비우지 않으므로 7단계에서 무너진 자리도 다음 초의 이 검사에 닿는다. (확률 없음)
3. **알 수 없는 스파크**(전기·정전기): 덩어리 칸 수 N ≥ 3 이면 `catRng.chance(min(0.012, 0.0012 × N × hazardMul) × min(1, age / 90))`. `age` 는 그 현장에 LEL 구름(N ≥ 3)이 처음 생긴 뒤 이어진 초(구름이 사라지면 0 으로). 구름이 막 생긴 순간에 스파크가 거의 없게 해서 밸브 차단·환기가 닿을 틈을 둔다(균형 경고 §12.2-14).

**맞출 값**(GAS_SRC·D 는 이 측정으로 정한다 — 확인 필요): 문 닫힌 방(약 24칸)에 `leakRate 0.8` 밸브 하나를 두고 방치하면 밸브 둘레 3칸 이상이 LEL 에 닿는 데 **100~160초**, 열린 문으로 복도와 이어지면 **160~260초**, 바깥 출입문이 열려 있고 창이 깨졌으면 닿지 않을 수 있다. 측정은 §8.3 의 "방치 시험". **`collapse/gasblast` 는 밸브 6칸 안의 창이 처음부터 깨져 있다**(`scenes/major.ts` 의 그 현장 생성) — 환기 항 때문에 LEL 에 닿지 못해 목표(§8.1 의 15~40%)를 이루지 못할 수 있다. 방치 시험에서 먼저 재고, 모자라면 그 현장의 처음 가스(`catOf` 가 밸브 방 칸에 `0.6` 을 깔아 둔다 — 현장이 가스로 차 있던 상태)를 정한다. 그 값은 `catinit` 흐름을 쓰지 않는다(결정적).

### 2.6 용기의 열 (폭발 위험 ②)

**용기** — `catOf` 가 처음 한 번 판별해 `p.vessel` 에 적는다:
- `'cylinder'`: `p.kind === 'gas'` 이고 `vessel` 이 없는 것(지금 화재에 놓이는 가스 용기).
- `'drum'`: X6 가 공업 화재에 더하는 화학 드럼(`'gas'` 소품 + `vessel 'drum'` + `skin 'drum'`, §4.4).
- `'cng'`: **`p.kind === 'vehicle' && p.bus && !p.skin`** — 일반 교통사고의 버스(`builders.ts` 의 버스 변형)만. `bus: true` 는 CNG 버스만의 표지가 아니다: 비행기 동체 세 토막(`skin 'fuselageNose' · 'fuselageMid' · 'fuselageTail'`)과 열차 객차(`skin 'trainCar'`)에도 붙어 있다(`scenes/major.ts`).
- `'jet'`: **`p.kind === 'vehicle' && p.skin === 'fuselageMid'`** 하나만(날개 연료 탱크가 있는 가운데 동체).
- 동체 기수·꼬리, 열차 객차, 보통 승용차·트럭은 **용기가 아니다**(휘발유 탱크는 압력 용기가 아니다 — 불만 난다, 지금 그대로).

`catOf` 를 처음 부를 때 용기마다 `heatK = catinit.range(0.8, 1.25)`, `heatLoad = 0`.

매초:
```
near = 용기 칸(차량은 차체 칸)과 그 1.5칸 안의 불 최댓값 (용기 자기 칸은 × 1.25)
wetN = 용기 칸과 4 이웃의 wet 평균
heat += VESSEL_HEAT[vessel] × near × (1 − 0.7 × wetN) × heatK
heat −= 0.05 × wetN                           // 물을 뿌리면 식는다 (applyWater 가 wet 을 올린다)
if (near < 0.1) heat −= 0.012                 // 불이 없으면 저절로 식는다
heat = clamp(heat, 0, 1)
```
`VESSEL_HEAT`: cylinder 0.028 · drum 0.020 · cng 0.010 · jet 0.010. 예: 가스 용기 곁 불 0.8 → 초당 0.022 → **안전밸브 소리(0.55)까지 약 25초, 폭발(1.0)까지 약 45초** — 지금의 "닿으면 즉시"보다 냉각·철수할 틈이 있다.

`heatLoad ≥ 1` → 용기 폭발(§4.4). 이미 터진 용기(`exploded`)는 건너뛴다.

**차량 연료 누출과 불**: `tickLeaks` 는 그대로 두고, X6 가 매초 `leakRate > 0` 이고 발화 전인 차량에 대해 차체 1.5칸 안 불 최댓값 `near` 가 0.3 이상이면 `p.leak += 0.015 × near` 를 더한다(불이 누출 연료에 불을 붙인다 — 점화원).

### 2.7 연소와 전소 (전소 위험)

- **전소의 정의**: `c.struct` 현장(실제 건물 — §2.4, 비행기·선박·산불·길 위의 현장은 아니다)에서, **건물 칸(`foot ≥ 1`) 위의 연료 칸**만 센 비율이 처음 0.7 이상이 된 때. 분모 `fuel0` = `catOf` 때 `foot ≥ 1` 이고 `s.fuel > 0` 인 칸 수(30 미만이면 전소 판정을 하지 않는다), 분자 = 그 칸 가운데 `s.burned[i]` 인 수. 숲·풀·활주로·부두의 연료는 세지 않는다(산불 현장의 숲이 다 타도 오두막이 멀쩡하면 전소가 아니다 — 그 현장은 애초에 `NO_STRUCT`). 연료가 없던 칸에 나중에 놓인 연료(폭발·차량 발화)는 분모에 없으므로 비율은 1 을 넘지 않는다. `c.burntAt = sim.t`, `BURNOUT` 기록(§4.6).
- 전소 그 자체로는 건물이 무너지지 않는다. 탄 구획은 §2.4 의 상한(1 − 탄 몫)으로 약해지고, 그것이 구획 붕괴 → 전체 붕괴로 이어진다(방치된 화재는 전소 판정 직후 대개 무너진다).
- **재산 피해**: 전소·전체 붕괴 = 1.0(§6.5).
- **지휘관의 추정**(조짐이 아니라 기억): 구역별로 믿음 불 ≥ 0.5 를 처음 본 시각(`ops.burnSince`, 믿음이 0.3 아래로 내려가면 그 구역의 시각을 지운다 — 외부 확인 종료(§6.2)가 쓰는 "센 불을 본 적이 있는 구역" 목록은 `ops.everHot` 에 따로 남기고 지우지 않는다). 그 구역이 150초 넘게 센 불이면 구조 위험 단계 1(주의), 260초 넘게면 3 으로 본다(§5.2) — 화재 현장의 "연소 시간이 길면 붕괴를 의심한다"는 교본을 시간 비율로 줄인 것.

### 2.8 난수 흐름

| 흐름 | 만드는 곳 | 쓰는 곳 |
|---|---|---|
| `catinit:<현장 id>` | `catOf` 가 처음 한 번 | 용기 `heatK`, 드럼통 놓기(§4.4), 분진 구획(§4.5) |
| `cat:<현장 id>` | `catRng(sim, s)` (`WeakMap<Scene, Rng>`, `damage.ts` 의 `dmgRng` 과 같은 모양) | 붕괴 판정, 붕괴의 잔해 자리·사람의 결과(무너진 구획 안 **과 경계 1칸 안** — §4.1), 스파크, 도시가스 차단 지연, 분진 점화, 플래시오버 |

`injuryRng(…, 'trap')`(H1)은 X6 가 부르지 않는다 — 2차 붕괴(`tickCollapse`) 갇힘만의 흐름이다(H1 §2.7: 목적 흐름을 나눠 쓰면 앞 소비자의 결과가 밀린다).

**사라지는 `s.rng` 호출**: `tickFire` 의 천장 붕괴(`s.rng.chance(0.55)`·`int`·`pick`·`range`)와 `tickGas` 의 폭발(`s.rng.chance(…)`). 그 판정이 일어나던 현장(탄 방이 생긴 화재, 짙은 칸이 10개 넘은 가스 현장)에서는 그 뒤의 `s.rng` 순서(용의자·통과 차량·주변 시민·배회)가 달라진다. 같은 현상을 새 규칙이 대신하는 것이므로 받아들인다 — 결과 분포를 전후로 잰다(§8).

**늘어나는 `s.rng`·`a.rng` 호출 (AI 쪽, 5단계)**: 외부 방수·냉각이 부르는 `spray` 는 물줄기 흔들림에 `s.rng.range` 를 두 번 쓴다(`executor.ts` 의 `spray`). R2 가 나중에 `jitter` 인자(기본 `true`)를 더하고 자기 호출만 `false` 로 둔다 — X6 는 기본값(흔들림 있음)을 쓴다. `evacuate` 의 `moveTo` → `agentCost` 는 `a.rng` 를 쓴다. 둘 다 지금의 다른 행동(안에서 방수, 다른 이동) 대신 일어나는 것이라 그 대원·현장의 뒤 순서가 바뀐다 — 5단계의 결과 변화에 포함된다.

### 2.9 상수 표 (`catastrophe.ts` 의 `CAT` — 모두 시작값, §8 에서 맞춘다)

| 이름 | 값 | 뜻 |
|---|---|---|
| `K_HEAT` | 0.0025 | 불 세기 1 의 구획이 초당 잃는 건전도 |
| `K_BURN` | 1.0 | 탄 몫 1 당 상한 감소 |
| `K_CREEP` | 0.00035 | 보강 안 된 균열 하나가 초당 깎는 양 |
| `K_HIT_CRUSH` · `K_HIT_BLAST` | 0.5 · 0.8 | `blast` 충격 배율 |
| `L1` · `L2` · `L3` | 0.6 · 0.45 · 0.36 | 구조 조짐 단계 |
| `FALL_BASE` · `FALL_SLOPE` | 0.01 · 0.5 | 구획 붕괴 초당 확률 `BASE + SLOPE × (L3 − integ)` |
| `FALL_GRACE` | 4 | 임박 조짐 뒤 최소 초 |
| `TOTAL_SHARE` · `TOTAL_BLDG` | 0.45 · 0.30 | 전체 붕괴 문턱 = 건물 조짐 3 의 문턱 (둘은 늘 같이 움직인다) |
| `GAS_SRC` · `GAS_D` | 0.15 · 0.12 | 가스 원천·확산 |
| `LEL` | 1.0 | 폭발 하한 |
| `SPARK_MAX` · `SPARK_AGE` | 0.012 · 90 | 스파크 초당 상한 · 구름이 생긴 뒤 스파크가 다 커지기까지의 초 |
| `VESSEL_HEAT` | cylinder 0.028 · drum 0.020 · cng 0.010 · jet 0.010 | 용기 가열 |
| `VENT_AT` | 0.55 | 안전밸브 소리(조짐 3) |
| `BURNOUT` | 0.7 | 전소 문턱 |

---

## 3. 조짐

### 3.1 무엇이 보이고 들리는가

조짐은 **진실의 값에서 고정 문턱으로 단계를 정하고**(대원에 따라 문턱이 달라지지 않는다), 대원의 감각 범위 안에 있을 때만 사실이 된다. 판단력이 좋은 대원은 **조금 멀리서** 알아챈다 — 소리·눈의 거리에 `+ 2 × (judgment − 0.5)` 칸(난수 없이). 문턱을 대원마다 달리하면, 믿음이 무전으로 공유될 때(`BeliefStore.merge` 는 새로 확인된 사실이 이긴다) 판단력이 높은 대원의 3 과 낮은 대원의 2 가 번갈아 지휘관의 믿음을 덮어 구역과 `DANGER_SIGN` 복구가 깜박인다.

**관찰과 보고의 규칙** (`perceiveSigns`, 사실 id 마다):
1. `obs` = 진실 단계 이하의 단계 가운데 **그 단계를 알아채는 감각 조건(아래 표)이 지금 맞는** 가장 높은 단계. 어느 단계의 감각 조건도 맞지 않으면 **관찰 없음 — 아무것도 배우지 않는다**(범위 밖·소리 없음은 "단계 0" 이 아니다). 진실 단계가 0 이고 단계 1 의 감각 조건이 맞으면 `obs = 0`.
2. 비교는 **자기 감각으로 마지막에 관찰한 단계** `a.signObs[id]` 와 한다(전달받은 믿음과 견주지 않는다).
   - `obs > signObs` → 보고(올라감). 
   - `obs < signObs` 이고 **`signObs` 단계의 감각 조건이 지금 맞는다**(그 단계가 아직 있었다면 알아챘을 자리다) → 보고, `down: true`(확인된 하향). 눈(4칸)으로 단계 2 를 본 대원이 소리 거리(6칸)로 물러나 삐걱임만 듣는 것은 하향이 아니다 — 눈 조건이 맞지 않으므로 보고하지 않는다. 용기의 안전밸브(7칸)도 같다.
   - 그 밖 → 보고하지 않는다. 
   - 보고하든 않든 `a.signObs[id] = obs`(관찰이 있었을 때만).
3. 같은 단계면 다시 보고하지 않는다. 측정값(`lel`)만 바뀐 것은 믿음에 합치되 보고하지 않는다(§3.2 `significant`).

| 종류 (`kind`) | 진실 | 단계 | 누가 어떻게 아는가 | 문구 (fact.text) |
|---|---|---|---|---|
| `struct` 구획 | `integ[r]` | 1: < 0.6 | **소리**: 대원이 그 구획이나 이웃 구획(`regionNbrs`) 안에 있고 구획 가운데에서 6칸 안 (벽 너머도) | `○○ 천장에서 삐걱이는 소리 — 구조 약화 조짐` |
| | | 2: < 0.45 | **눈**: 그 구획 칸 가운데 4칸 안·시야 안인 칸이 그 구획 칸의 30% 이상 (일부만 보고 판단하지 않는다 — 불의 85% 규칙과 같은 생각, 문턱만 낮다) | `○○ 천장 균열·바닥 처짐 — 붕괴 위험` |
| | | 3: < 0.36 | **소리**: 구획 가운데에서 10칸 안 누구나 (벽 너머도). 바깥에서는 그 구획이 바깥벽에 붙어 있고 바깥벽이 보이면 '외벽 균열' | `○○ 굉음 — 천장이 내려앉고 있음, 붕괴 임박!` |
| `bldg` 건물 | `bldg`, 무너진 몫 | 2 · 3 (§2.4) | **눈**: 건물 바깥 칸에서 바깥벽 칸(`foot === 2`)이 3개 이상 보인다 (지휘관의 7초 외부 관찰 포함) | `건물 외벽 균열이 번지고 기울어짐 — 전체 붕괴 위험` / `…전체 붕괴 임박!` |
| `gas` 구획 | **그 구획 칸의 `gas` 최댓값** (구획 하나에 값 하나 — 같은 구획을 대원마다 다르게 읽지 않는다) | 1: ≥ 0.10 · 2: ≥ 0.25 · 3: ≥ 0.60 | **측정기**(§3.4): 대원이 그 구획 칸 위에 있거나, 그 구획 칸과 4 이웃인 문·바닥 칸(문턱)에 서 있으면 단계와 `lel` ("측정기를 들고 구획을 한 번 훑은 값"으로 줄인 것). 측정기가 없으면 자기 칸 ≥ 0.10 일 때 냄새로 단계 1만 (`lel` 없음, **`verified: false`** — 측정값을 덮지 않는다, 하향 보고도 없다) | `○○ 가스 농도 LEL 35%` / `○○ 가스 냄새` |
| `vessel` | `heatLoad`, 곁 불 | 2: ≥ 0.3 이고 곁 불 ≥ 0.5 | **눈**: 4칸 안·시야 (불길이 용기에 닿고 있다) | `○○ 가스 용기가 불길에 직접 노출 — 냉각 필요` (드럼: `드럼통이 불길에 휩싸임`, 버스: `CNG 용기 쪽으로 불길이 번짐`) |
| | | 3: ≥ 0.55 | **소리**: 7칸 안 (벽 너머도) | `안전밸브 작동음 — 용기 폭발 임박!` (드럼: `드럼통이 부풀어 오름 — 파열 임박!`) |
| `fire` (선택, §4.7) | 방의 불 몫·연기 | 1: 불 몫 ≥ 0.08 · 연기 ≥ 0.6 / 2: 불 몫 ≥ 0.15 · 연기 ≥ 0.7 | **눈**: 그 방 칸이 시야 안 | `○○ 짙은 검은 연기가 맥동하며 뿜어 나옴` / `○○ 천장 연기층에 불꽃(롤오버) — 플래시오버 임박` |
| `dust` (선택, §4.5) | `dustRegion`, 터지지 않음 | 1 | **눈**: 그 구획 칸이 시야 안 | `○○ 분진이 두껍게 쌓여 있음 — 분진 폭발 위험` |
| `event` | 붕괴·폭발·전소가 일어남 | 3 | **현장 전원**(§3.5) | `굉음! ○○ 무너짐` / `폭발! ○○` / `건물 전소` |

**열화상**(§3.4)을 가진 대원은 **불타는 구획**의 구조 조짐 1·2 를 각각 0.7·0.5 에서 안다(천장 온도로 골조가 달궈진 것을 본다). 장비가 문턱을 바꾸는 유일한 경우다. 열화상 대원의 2 를 맨눈 대원의 1 이 덮지 않는 것은 §3.2 의 합치기 규칙(내려가는 사실은 `down` 일 때만)이 막는다 — 맨눈 대원은 2 를 관찰한 적이 없으므로 `down` 을 붙이지 못한다.

### 3.2 사실의 모양

`mkFact('sign', id, SignBelief, 이름, sim.t, 1, true, 문구)`. id 공간(`ops.ts` 에 상수로):

| 종류 | id |
|---|---|
| struct | 구획 번호 (0~998) |
| gas | 1000 + 구획 번호 (신고로 만든 위치 모르는 가스 조짐은 **1999** — `1000 + (−1) = 999` 가 struct 공간과 겹치지 않게) |
| vessel | 2000 + 소품 id |
| fire | 3000 + 구획 번호 |
| dust | 4000 + 구획 번호 |
| bldg | 5000 |
| 도시가스 차단 완료 (`event`, `what 'utility'`) | 5001 |
| event | 6000 + `c.events` |

- 단계 2 이상은 묶음 보고(5초)를 기다리지 않고, 단계 1(삐걱임·냄새)은 묶음으로 보낸다(붕괴 현장은 균열이 진행되면 오래 삐걱이므로 무전이 넘치지 않게). `agents.ts` 의 `IMPORTANT` 표에는 넣지 않고, `flushOutbox` 의 두 자리를 함께 고친다 — `const hot = (f: Fact) => IMPORTANT[f.type] || (f.type === 'sign' && f.value.level >= 2)` 를 두고 ① `important` 계산(→ `prompt`)과 ② 무전 문구에 실을 사실을 고르는 `shown` 거르기가 모두 `hot` 을 쓴다. ②를 빼먹으면 조짐만 담긴 보고는 `shown` 이 비어 문구는 나가지만 중요도 0 으로 기록된다("붕괴 임박!" 무전이 imp 0 이 된다).
- `significant()` 에 `if (f.type === 'sign') return old.level !== v.level;` — 측정값(`lel`)만 바뀐 것은 믿음에 합치되 보고하지 않는다.
- **합치기 규칙**(`beliefs.ts` 의 `BeliefStore.merge` 에 한 조각): `sign` 사실이고 들어온 단계가 믿음의 단계보다 낮으며 `!value.down` 이면 **믿음을 바꾸지 않는다**(시각도 새로 하지 않는다). 그래서 일부만 본 대원(소리 거리의 대원, 맨눈 대원)의 낮은 단계가 지휘관의 높은 단계를 끌어내리지 못하고, 높은 단계는 확인된 하향(§3.1 의 2) 또는 지휘 규칙의 구역 해제(§5.7 — 무너짐·폭발·원천 차단)로만 내려간다. 신고로 만든 미확인 조짐(`verified: false`, §3.6)은 지금 규칙대로 현장 관찰이 덮는다.
- 확인 무전(`sceneManager.ts` 의 `ROLL_CALL` 표 — 받은 대원이 아는 상황을 다시 보고)에 `sign: true` 를 더한다. 다시 보고되는 조짐은 그 대원의 믿음이므로 낮은 단계는 위의 합치기 규칙에 걸린다.
- `ops` 사실: id 0 = `{ mode, zones: [{ key, kind, level, regions, x, y, r }], t }`(지휘관이 보낸다, §5.4), id 100 + rid = `{ par: true, t }`(철수를 마친 대원이 조용히 보낸다).
- `bldg` 단계 1 은 감각으로는 생기지 않는다(§3.1 은 2·3 뿐). 신고로 들어온 '무언가 계속 무너지는 소리'(§3.6)만 단계 1 이고, 지휘 쪽 위험 단계는 0(기록만 — §5.2)이다.

### 3.3 `perceive` 에 더하는 것 (정보 격리)

`perceive` 는 진실을 읽어도 되는 곳이다(`CLAUDE.md` 규칙 4). 소품 반복문 뒤, 쓰러진 동료 보기 앞에 `perceiveSigns(sim, s, a, v, throughWalls)` 한 줄(함수는 `catastrophe.ts` 에 두고 `agents.ts` 가 부른다 — `agents.ts` 가 `catastrophe.ts` 를 import 하고, `catastrophe.ts` 는 `agents.ts` 의 `learn`·`regionNameAt` 을 import 한다. 함수 안에서만 서로 부르므로 순환 import 문제는 없다. 꺼림칙하면 `perceiveSigns` 를 `agents.ts` 안에 둔다).

- 진실 쪽 단계는 `structLevel(c, r, judgment, tic)`, `gasReading(c, s, x, y)`, `vesselLevel(c, p)` 같은 **읽기 함수**로 얻는다(상태를 바꾸지 않는다). `c` 가 없는 현장(대상 아님)은 첫 줄에서 돌아간다.
- **소리는 벽을 넘는다.** 단계 1·3 구조 조짐과 안전밸브 소리는 시야선 없이 거리로 안다. 지금의 폭발물 폭발음(현장 전원)과 같은 감각이다 — README 의 "정보 격리 예외" 목록에 더하지 않는다(사람이 실제로 들을 수 있는 것이다). 문서의 함정 절에 적는다(§11.3).
- `throughWalls` 관찰(지휘관의 7초 외부 관찰)에서도 같은 함수가 돈다 — 그 관찰은 이미 있는 예외이고, 거기서 얻는 것은 건물 조짐(바깥벽)과 소리뿐이다.
- 진실을 그대로 숫자로 넘기는 것은 **측정기 값**(`lel`, 5 단위)뿐이다. 구조 건전도·열은 단계로만 넘긴다.
- 가스 용기 사실의 오래된 구멍을 막는다: 용기가 `exploded` 이고 대원의 믿음이 `active` 면 `haz {kind:'gas', active:false}` '가스 용기 폭발 확인' 을 배운다(지금은 영영 `active` 로 남는다 — `agents.ts:171`). 드럼통도 `kind 'gas'` 이므로 같은 줄을 지나는데, 문구는 `vesselName(p)`(`가스 용기`·`드럼통`)로 고른다(`'gas'` 소품 확인 문구 '가스 용기 확인' 도 같다).
- **외부 관찰의 기억**(§6.2 가 쓴다): `perceive` 의 타일 스캔 블록에서 `throughWalls` 가 참이면, 스캔이 끝난 뒤 관찰자의 `a.extSeen`(없으면 구획 수만큼 `-1` 로 채워 만든다)을 고친다 — 가운데가 관찰 반경 `v` 안인 실내 구획마다 `cov[r] = sim.t`(처음이면 `cov0[r] = sim.t` 도), `seen` 에서 최댓값 `e.m ≥ 0.25` 인 구획은 `hot[r] = sim.t`. `throughWalls` 관찰은 반경 안의 불 ≥ 0.25 칸을 벽과 관계없이 모두 보므로, 덮인 구획에서 `hot` 이 새로 적히지 않았다는 것은 "센 불을 보지 못했다"는 뜻이다. 지금의 `fire` 사실은 값이 0.2 넘게 바뀔 때만 새로 배우므로 꾸준히 타는 불의 시각으로는 이것을 가릴 수 없다. 이 기억은 관찰자 자신의 것(믿음과 같은 자격)이라 지휘 규칙이 읽어도 된다. 지휘관이 바뀌면 새 지휘관은 빈 기억에서 시작한다(보수적).

### 3.4 장비 (R1)

| 능력 | R1 이 있을 때 | R1 이 없을 때(대체) |
|---|---|---|
| 가스 측정기 | `hasKit(sim, a.rid, 'gasMeter')` 이고, 처음 값을 읽을 때 `kitWorks(…, 'gasMeter', I)`(숨은 고장이면 이때 드러난다) | `u.kind === 'hazmat'`, 또는 펌프차(`engine`)의 첫 대원(`u.crew[0] === a.rid`) |
| 열화상 | `hasKit(…, 'tic')` + 불타는 구획을 볼 때 `kitWorks` | 펌프차·사다리차의 첫 대원 |

R1 의 장비 표에서 가스 측정기는 화학대 역할(`hazLead`·`decon`)만 든다. 그러면 가스 누출 현장에 먼저 닿는 펌프차는 냄새(단계 1)만 안다 — 화학 구조대가 올 때까지 가스 단계 2·3 을 모르는 것이 그대로 결과에 드러난다. 펌프차 팀장(`fireLead`)에게도 측정기를 줄지는 §12.3 의 확인 필요 목록에 둔다.

### 3.5 현장 전원이 듣는 것

붕괴(구획·전체)·폭발·플래시오버는 현장 어디서나 들린다. 그 일을 일으킨 함수가 상태를 바꾼 직후 `s.radio.push({ from: -1, to: -1, kind: 'report', deliverAt: sim.t + 0.6, facts: [event 사실, …], text: '', eventId: ev, … })` — `rules/crime.ts` 의 폭발물 폭발이 쓰는 방식 그대로다. 함께 싣는 사실:

- 전체 붕괴: `event {what:'total'}` + `bldg` 단계 3.
- 구획 붕괴: `event {what:'partial', region}` + 그 구획 `struct` 단계 0 `down: true`(이제 무너졌다 — 더 무너질 것이 없다).
- 가스 폭발: `event {what:'gas', region}` + 밸브의 `haz {kind:'leak', active:false}`(지금의 발화와 같은 뜻) + 그 구획 `gas` 단계 0 `down: true`(구름이 타 버렸다).
- 용기 폭발: `event {what:'vessel', prop}` + `haz {kind:'gas', active:false}` + 그 용기 `vessel` 단계 0 `down: true`.

단계를 낮추는 사실에는 모두 `down: true` 를 붙인다(§3.2 합치기 규칙 — 안 붙이면 무너진 구획의 "임박" 믿음이 남는다). 각 대원의 `signObs` 도 같은 값으로 고친다(받은 쪽에서 — `deliverRadio` 가 사실을 합칠 때 `sign` 이고 `down` 이면 `a.signObs[id] = level`). 음영 구역의 대원은 듣지 못한다(`deliverRadio` 가 거른다 — 지금 그대로). "굉음은 들리지만 무엇인지 모른다"까지 나누지는 않는다(결정 §12.1). 이 소리는 **사건이 닫힌 뒤에는 나지 않는다**(규칙 첫 줄, §2.3).

### 3.6 관제가 받은 위험 진술을 현장에 넘긴다

- `sceneManager.briefFacts`: 신고 내용의 `hazard` 주장이 있으면 미확인 사실로 넣는다 — `'unstable'` → `sign {kind:'bldg', level:1}`(id 5000) `신고 내용: 무언가 계속 무너지는 소리 — 2차 붕괴 위험`, 가스 누출 유형의 `'gas'` → `sign {kind:'gas', level:1, region:-1}`(**id 1999**) `신고 내용: 가스 냄새`. 신뢰도는 그 주장의 `conf`, `verified: false`(현장 관찰이 오면 덮어쓴다 — `BeliefStore.merge` 규칙). 둘 다 지휘 쪽 위험 단계를 올리지 않는다(§5.2 — 기록·주의만).
- `dispatcher.briefUpdate`: 받는 주제에 `hazard` 를 더하고 같은 사실을 무전으로 보낸다.
- 화재의 `'gas'`(가스 용기가 있다는 신고)는 위치를 모르므로 사실로 만들지 않는다(지휘관은 찾으면 안다).

---

## 4. 실제로 일어나는 일

모든 함수는 `catastrophe.ts` 에 있고, 상태를 바꾸는 그 자리에서 기록한다(`raiseProblem(sim, I, …)` — 첫 인자는 `sim`). 기록 뒤 `s.staticVersion++`(타일이 바뀐 경우), G4 가 합쳐져 있으면 `markRuin`·`recordFall`, 현장 전원 소리(§3.5), `Sim.placeMarks` 갱신(§7.1), 종류별 수(`c.gasN`·`c.vesselN`·`c.dustN`), 그리고 **I1 §3.10 의 신호 한 줄**:

```ts
// 붕괴(collapseRegion·collapseBuilding): signal(sim, 'catastrophe', { inc: I.id, ev, size: 무너진 칸 수, place: I.truth.placeId, data: 1 })
// 폭발(explodeGas·ruptureVessel·분진):    signal(sim, 'catastrophe', { inc: I.id, ev, size: 반경(칸), place: I.truth.placeId, data: 0 })
// 전소 판정:                               signal(sim, 'catastrophe', { inc: I.id, ev, size: 0, place: I.truth.placeId, data: 2 })
```

`src/sim/world/consequence.ts` 가 아직 없으면 X6 가 I1 §3.10 의 모양 그대로 **빈 함수와 타입만** 담은 파일을 만든다(`export type SignalKind = 'blast' | 'collapse' | 'fireBig' | 'delivered' | 'fled' | 'closed' | 'catastrophe';` 와 `export function signal(sim, kind, s): void {}` — I1 §2 의 `SignalKind` 와 같은 합집합. I1-b 가 내용을 채운다). 빈 함수라 결과는 바뀌지 않는다.

**사건이 닫힌 뒤에는 아무것도 일어나지 않는다**(규칙 첫 줄 — §2.3). 판정 뒤에 `STRUCT_COLLAPSE`·대원 피해·`BURNOUT` 이 생기지 않는다.

### 4.1 구획 붕괴 — `collapseRegion(sim, s, I, r, why)`

| 대상 | 바뀌는 것 |
|---|---|
| 구획 칸 | 가구(`T.FURN`) → **N7 규약**: `T.FLOOR`, `decorHp = WRECKED`(255), `decor` 는 남긴다(고정 층이 부서진 가구 조각을 그리고 `staticSig` 의 피해 합이 바뀌어 스스로 다시 그린다 — `damage.ts` 의 `damageDecor` 와 같다), G4: `markRuin(RUIN_FURN + decor)`. `fuel = min(fuel, 0.5)`. 모든 칸 `damage = 1`, `fire *= 0.6`(덮여 숨이 죽는다), `smoke = max(smoke, 0.7)`(먼지) |
| 안쪽 벽 | 구획 칸과 4 이웃인 벽 가운데 `foot === 1`(바깥벽·층 경계 아님)인 것을 `catRng.chance(0.35)` 로 `T.FLOOR`(`damage = 1`, G4 `markRuin(RUIN_WALL)`). 새 바닥 칸은 **무너진 구획 r** 에 넣는다(`s.region[i] = r`, `r.tiles.push(i)` — 잔해 바닥의 일부다) |
| 잔해 | 구획의 빈 바닥(`propAt < 0`, 문 아님, **사람(대원·구조 대상·용의자)이 선 칸 아님**, 드럼통 등 막지 않는 소품이 놓인 칸 아님) 가운데 `catRng.chance(0.25)` 인 칸에 `debris`(`blocking`, `hp = catRng.range(9, 15)`) |
| 구조 대상 (`where 'scene'`, 살아 있음, 물속 아님, 그 구획 안) | `catRng` 한 번: 12% → 숨짐(`hurtCas(…, c.health + 5, 'crush')`), 55% → 갇힘(`mob = 'trapped'`, `trapWork = range(12, 22)`, `walking = false`, `path = null`, `hurtCas(range(12, 30), 'crush')`), 나머지 → 못 걷게 됨(`immobile`, `path = null`, `hurtCas(range(15, 35), 'crush', { immobile: true })`). 업혀 있던(`carried`) 사람은 업은 대원과 함께 `hurtCas(range(8, 20))` |
| 대원 (그 구획 안, `left` 아님, 숨지지 않음) | `hurtResponder(raw = range(30, 60), 'crush')`. 35% 는 깔린다: `a.trapped = range(6, 12)`, `a.trapEv = ev`(§4.8 — 쓰러짐 전이는 `agentHealth` 가 한다) |
| 이웃 구획에서 경계 1칸 안 (무너진 구획 칸과 8 이웃인 칸에 선 사람) | 사람마다 칸 순서대로 `catRng` 로(H1 §5.1 의 2차 붕괴 갇힘과 **같은 규칙·수치, 다른 흐름**): 구조 대상 `hurtCas(range(5, 12), 'crush')`, 그리고 업혀 있지 않고 물속이 아니면 갇힘(확률 없이 — `mob = 'trapped'`, `trapWork = range(6, 10)`, `walking = false`, `path = null`). 대원 `hurtResponder(range(8, 18), 'crush')`(깔리지 않는다) |
| 용의자 | `hurtHostile(range(25, 55), 'crush')` (H1) |
| 상태 | `fallen[r] = 1`, 이웃 구획 −0.12(§2.4), `l3Since[r] = -1`, `c.lastFall`, `c.hits.push({ t: sim.t, x: r.cx, y: r.cy })`(가스 점화 §2.5), `c.limitBonus += 60`(지휘 쪽과 합쳐 330 에서 자른다 — §6.4), 모든 대원 `a.path = null`과 스스로 대피 중인 구조 대상의 `c.path = null`(지형이 바뀌었다 — 해일 규칙의 선례) |
| 기록 | `raiseProblem(sim, I, 'STRUCT_COLLAPSE', '${r.name} 천장·바닥 붕괴 — ${원인 문구}', { role: 'SYSTEM', actor: '현장', imp: 3, truth: s.arrivedAt < 0, causes: [c.causeEv[r]], text: '굉음! ${r.name}의 천장과 바닥이 무너져 내렸습니다.' }, false)` |

원인 문구는 그 구획의 장부(`loss`)에서 가장 큰 항으로 그 자리에서 만든다: FIRE `불에 ${fmtSec(hotT)} 동안 달궈짐` · BURN `골조가 타서 약해짐(탄 몫 ${pct})` · CREEP `보강하지 않은 균열` · IMPACT `잔해·낙하물의 충격` · BLAST `폭발 충격` · QUAKE `여진`. `causeEv[r]` 는 그 항을 만든 마지막 기록이다(불: 그 구획에 불이 번진 기록 `s.lastSpreadEvent` 또는 `I.lastEvent`, 충격·폭발: `blast` 의 `ev`, 여진: 재난 기록).

### 4.2 전체 붕괴 — `collapseBuilding(sim, s, I, why)`

| 대상 | 바뀌는 것 |
|---|---|
| 안쪽 벽 (`foot === 1` 인 벽·창) | 모두 `T.FLOOR`, `damage = 1` (G4 `markRuin(RUIN_WALL)`) |
| 바깥벽 (`foot === 2`) | `catRng.chance(0.55)` 로 `T.FLOOR`(잔해), 나머지는 그루터기로 남긴다(벽 그대로). 출입구(`s.exits`)에 붙은 문 칸과 그 양옆 한 칸은 반드시 연다 |
| **층 경계 (`foot === 3`)** | **바꾸지 않는다** — `VOID` 와 맞닿은 벽·창은 그대로 서 있다(두 층 사이 4칸 이상을 지킨다). 쏟아짐·그루터기 규칙에서도 뺀다 |
| 가구·문 | 가구 → N7 규약(`T.FLOOR`, `decorHp = WRECKED`, `decor` 는 남김, G4 `markRuin(RUIN_FURN + decor)`), 문 소품은 `removed = true`, `blocking = false`, `propAt` 비움, 칸은 `T.FLOOR` |
| 계단 | `T.STAIR` 와 `stairTo` 를 **남긴다** — 위층 잔해 더미로 오르는 길(위층 칸이 끊기지 않게, 결정 §12.1) |
| 모든 건물 칸 (`foot` 1·2 와 실내 칸 — 층 경계 제외) | `damage = 1`, `fire *= 0.5`, `fuel = min(fuel, 0.5)`(잔해 속 불씨), `smoke = max(smoke, 0.8)`. G4: 아직 `ruin` 이 0 인 바닥 칸에 `markRuin(RUIN_TOTAL)`(= 10, 새 값) |
| 구역 | 새 바닥 칸은 4 이웃 실내 칸의 구역 가운데 **가장 작은 번호**에 넣는다(없으면 `-1` — 바깥 칸과 같다). 구역은 지우지 않는다(이름과 수색 대상은 그대로) |
| 잔해 | 건물 칸의 빈 바닥 가운데 `catRng.chance(0.10 + 0.03 × sev)`(심각도 3 에서 약 19%) 인 칸에 `debris`(`hp = range(10, 18)`). **비워 두는 칸**: 출입구 칸에서 3칸 안, 그리고 잔해를 놓기 전에 출입구마다 건물 가운데(실내 구획 가운데들의 평균에 가장 가까운 바닥 칸)로 낸 A* 경로 위의 칸(잔해 수색의 통로 — 한계 시간에 걸리지 않게), 사람이 선 칸, 막지 않는 소품이 놓인 칸 |
| 바깥으로 쏟아짐 | 바깥벽(`foot === 2`)에서 1칸 안의 바깥 칸(`staticPass`, 도로 포함) 가운데 **사람이 선 칸, 출입구 칸에서 2칸 안, `s.staging`·`s.safe` 에서 2칸 안, `s.spots` 의 칸, 소화전 칸을 뺀** 칸: `chance(0.3)` 로 `debris`. 그 띠(1칸) 안에 선 사람은 잔해를 놓지 않고 피해만: 구조 대상 `hurtCas(range(10, 25), 'crush')`, 대원 `hurtResponder(range(10, 25), 'crush')` |
| 구조 대상 (건물 칸 안) | 그 구획의 `integ ≤ 0.1` 이거나 원인이 폭발이면 숨짐 40%, 아니면 18%. 나머지의 70% 갇힘(`trapWork = range(18, 32)`, `crush range(12, 30)`), 30% 못 걷게 됨(`crush range(15, 35)`). 모두 `path = null` |
| 대원 (건물 칸 안, 숨지지 않음) | `hurtResponder(range(55, 95), 'crush')`. 60% 깔림(`trapped = range(10, 18)`, `trapEv = ev`), 40% 는 가장 가까운 빈 바닥으로 밀려남(`range(25, 45)` 만) |
| 용의자 | `hurtHostile(range(40, 80), 'crush')` |
| 상태 | 모든 실내 구획 `fallen = 1`, `c.totalAt`, `c.hits.push({ t: sim.t, x: 건물 가운데 })`, `c.limitBonus += 180`(지휘 쪽과 합쳐 330 에서 자른다), 모든 대원 `path = null`, 스스로 대피 중인 구조 대상 `path = null` |
| 도로 | `I.blockedEdge < 0` 이면 `I.truth.nodeId` 에 닿는 구간 가운데 **큰 차 기준** 우회로가 있는 것(`findRoute(sim.city, e.a, e.b, 1, e.id, true)` — 인자는 `(city, from, to, weatherF, avoidEdge, heavy)`, `city.ts` 에서 확인. CLAUDE.md 교통 함정 "길을 막는 것은 큰 차 기준 우회로를 확인하고 놓는다")을 `slow += 1.4; closed = true; closedReason = 'incident'`(`known` 은 건드리지 않는다), `I.blockedEdge = e.id`, 기록 `건물 붕괴 잔해로 ${e.name} 통제`(풀기는 `closeIncident` 가 이미 한다 — 사건 뒤에도 남는 잔해는 I1 의 C2). 구간이 없으면 하지 않는다 |
| 기록 | `raiseProblem(sim, I, 'STRUCT_COLLAPSE', '건물 전체 붕괴 — ${원인 문구}', { role: 'SYSTEM', actor: '현장', imp: 3, text: '굉음! 건물 전체가 무너져 내렸습니다.' }, false)` |

원인 문구: 전소 뒤면 `건물이 전소된 뒤 골조가 버티지 못함`, 아니면 무너진 구획들의 장부 합에서 가장 큰 항(§4.1 의 문구), 폭발로 바로 무너졌으면 `${폭발 이름}의 충격`.

**끊기는 칸이 생기지 않는다**: 안쪽 벽이 모두 사라지므로 한 층 안은 하나의 열린 잔해 바닥이 되고, 바깥벽 그루터기는 열린 바깥 쪽에서 안쪽을 가둘 수 없다(출입구는 반드시 연다). 층 경계 벽은 남지만 그것은 `VOID` 와 맞닿은 벽이라 가두는 것이 없다. 잔해 소품은 치울 수 있는 장애물이다(`agentCost` 가 치우는 값으로 잰다). 위층은 계단으로 이어진다. 시험 §10-5 가 확인한다.

### 4.3 가스 폭발 — `explodeGas(sim, s, I, cloud, how)`

- 크기: 덩어리 칸 수 N. `r = clamp(2.0 + 0.55 × √N, 2.6, 6.0)`, `dmg = clamp(18 + 4.5 × √N, 24, 55)` (N = 10 → 3.7 / 32 — 지금의 3.8 / 32 와 맞춘다. N = 40 → 5.5 / 46).
- 중심: 점화된 칸(불·충격이면 그 칸, 스파크면 덩어리의 무게중심에 가장 가까운 덩어리 칸).
- 효과: `blast(cx, cy, r, dmg, ev, 'blast')`(→ 창·가구 파손, 구조 충격). 덩어리 칸 가운데 연료가 있으면 `fire = max(fire, 0.6)`, 없으면 `fuel = 0.4; fire = 0.5`(바닥·벽지). `gas` 는 덩어리 칸 0, 나머지 × 0.4. `r` 안의 문 소품은 날아간다(`open = true`, `locked = false`, 잠긴 문이면 `blocking = false`·`propAt` 비움). 덩어리와 가장 가까운 살아 있는 밸브를 `ignited = true`(지금과 같은 뜻 — 원천이 불타며 누출이 멈춘다). 살아 있는 밸브가 없으면(이미 차단했거나 도시가스가 끊긴 뒤 남은 구름) 아무 밸브도 바꾸지 않는다. `c.gasN++`.
- 기록: 지휘관이 그 위험을 알았는가로 코드를 가른다 — 지휘관 믿음에 그 밸브의 `haz` 나 그 구역의 `gas` 조짐이 있었으면 `EXPLOSION`, 없었으면 `HIDDEN_HAZARD`(신고에 없던 위험). (세계 규칙이 지휘관의 믿음을 읽는 것은 **기록 코드를 고르는 데만** 쓴다 — 판정·보고서의 재료이고 일어나는 일에는 영향이 없다. `debrief` 가 지휘관의 믿음으로 문장을 고르는 것과 같은 자격.) detail `누출된 가스 폭발 — ${점화원}`(점화원: `불길이 가스에 닿음` · `무너지며 튄 불꽃` · `원인 모를 불꽃(전기·정전기)`), text `폭발! ${구역}에 고여 있던 가스에 불이 붙었습니다.`, imp 3. `pushFx('boom', …, ttl 1.6)` + (G5) `noteBoom(lastFx(sim, s, 'boom'), r, 'gas')`.

### 4.4 용기 폭발 — `ruptureVessel(sim, s, I, p)`

| 용기 | 폭발 | 불 | 그 밖 |
|---|---|---|---|
| `cylinder` LPG 가스 용기 | `blast(3.6, 34)` (지금 값) | 2.3칸 안 연료 칸 0.85 (지금 값) | — |
| `drum` 화학 드럼 | `blast(2.8, 26)` | 2.0칸 안 바닥·가구 0.7 (연료 없으면 0.5 를 놓는다) | 3칸 안 `smoke = max(smoke, 0.9)` (유독 연기) |
| `cng` CNG 버스 | `blast(3.0, 30)` | 차체 둘레 0.8 | 탑승자(`inVehicle`) `hurtCas(range(20, 40), 'blast')` |
| `jet` 항공유(비행기 동체) | `blast(3.4, 32)` | 동체·날개 쪽 연료 칸 0.9, 3칸 안 연료 없는 땅에 `fuel 0.5; fire 0.6` | 같은 동체의 탑승자 `hurtCas(range(20, 40))` |

공통: `p.exploded = true`(차량은 `ignited = true` 도), `c.vesselN++`, 용기 칸 `propAt` 비움(가스 용기·드럼은 막지 않으므로 해당 없음), 문 날아감(§4.3 과 같이 반경 안), `pushFx('boom')` + (G5) `noteBoom(…, 반경, 'tank' | 'drum' | 'cng' | 'jet')`, 기록은 §4.3 과 같은 규칙으로 `EXPLOSION`/`HIDDEN_HAZARD` — detail `보관 중이던 가스 용기 폭발`(지금 문구 그대로) · `화학 드럼 파열` · `CNG 버스 가스 용기 폭발` · `항공유 폭발`, text `폭발! 불길에 달궈진 ${이름}이(가) 터졌습니다.`(조사는 `josa`).

**드럼통 놓기**(`catOf` 처음, `catinit` 흐름): 화재 유형이고 `I.truth.placeKind` 가 `chemical`(확률 0.9) · `factory`·`storage`(0.35) · `warehouse`·`workshop`(0.2) — 각각 `× hazardMul`, 상한 0.95 — 이면 1~3개를 발화실이 아닌 방(불이 없는 방)의 빈 바닥에 `addProp(s, 'gas', x, y, { vessel: 'drum', skin: 'drum' })`. 가스 용기처럼 길을 막지 않는다(`blocking: false`). 막지 않는 소품은 `propAt` 에 들어가지 않으므로 `propAt < 0` 만으로는 빈 칸을 알 수 없다 — **다른 소품(`s.props` 의 `x, y`)·구조 대상·용의자가 있는 칸, 문 칸, 바로 옆 칸 하나가 빈 바닥이 아닌 칸**(CLAUDE.md "가구 자리에 소품을 놓을 때")은 뺀다. 지금 현장 생성기(`buildFire`)의 난수를 건드리지 않는다. 드럼통도 `kind 'gas'` 라서 신고자 진술(`callSystem.ts` 의 `s.props.some(p => p.kind === 'gas')` → '가스통 같은 게 있어요')과 그 통화의 난수 경로가 바뀐다 — 드럼통은 `catOf` 가 현장의 첫 틱에 놓으므로 그 뒤의 통화가 읽는다. 위험한 용기를 신고자가 말하는 것은 맞는 동작이라 받아들인다(4단계의 결과 변화, §12.2-15).

### 4.5 분진 폭발 (선택 — 9단계)

- 분진 구획: 화재·붕괴 유형이고 `placeKind` 가 `factory`·`warehouse`·`storage`·`workshop` 이면 `catinit.chance(min(0.9, 0.25 × hazardMul))` 로 가장 큰 실내 구획 하나.
- 점화: ① 그 구획이나 이웃 구획이 무너짐 → `catRng.chance(0.5)`, ② `blast` 가 그 구획 가운데 4칸 안 → 0.5, ③ 그 구획 칸의 15% 이상이 불 ≥ 0.6 → 초당 0.04.
- 효과: `blast(구획 가운데, 3.2 + 0.15 × √n, 30, ev, 'blast')`, 구획의 연료 칸 불 0.6, `dustDone = true`, `c.dustN++`. 기록 `EXPLOSION '분진 폭발'`(지휘관이 분진 조짐을 알았으면) / `HIDDEN_HAZARD`.
- 시간이 모자라면 이 단계를 빼도 완료 조건(§8)에 영향이 없다.

### 4.6 전소

- 판정(§2.7 — `c.struct` 현장만)이 나면: `c.burntAt = sim.t`, `raiseProblem(sim, I, 'BURNOUT', '건물 전소 — ${사슬 문구}', { role: 'SYSTEM', actor: '현장', imp: 3, text: '건물이 사실상 전소됐습니다. 남은 골조의 붕괴가 우려됩니다.' }, false)`, 현장 전원 소리는 없다(조용히 일어난다 — 대신 지휘관의 외부 관찰이 `bldg` 조짐을 본다), `Sim.placeMarks` 에 `burnt`.
- 사슬 문구는 **그때까지 기록된 문제**에서 만든다(가장 앞의 하나): 미복구 `WATER_OUT` → `용수가 끊긴 동안 불이 번짐` · 미복구 `NO_UNIT`/`UNDER_DISPATCH` → `진압 부대가 모자라 불길을 잡지 못함` · `ops.mode` 가 `defensive` → `외부 방어로 바꾼 뒤 안쪽 방까지 물이 닿지 않음` · 첫 도착이 기준(`RESP_LIMIT`)보다 늦음 → `첫 부대가 늦게 도착해 불이 커짐` · 그 밖 → `불이 진압 속도보다 빨리 번짐`. 근거가 된 문제의 기록을 `causes` 에 넣는다.
- 그 뒤: 탄 구획들이 §2.4 의 상한 때문에 차례로 무너지고, 대개 전체 붕괴로 이어진다(§2.4 계산 예 ①).

### 4.7 플래시오버 (선택 — 9단계)

- 방(`room`, 홀 포함)마다 매초: 불 몫(`fire ≥ 0.3` 칸의 몫) ≥ 0.25, 연기 평균 ≥ 0.7, 젖은 정도 평균 < 0.08, 아직 일어나지 않음 → `catRng.chance(0.05 × fireSpreadMul)`.
- 효과: 그 방의 연료 칸 가운데 불이 없는 칸 모두 `fire = 0.45`, `heat = 0`. 방 안 대원은 `agentHealth` 의 불 피해를 그대로 받는다(따로 주지 않는다). 기록 `ESCALATION '${방} 플래시오버'`(imp 3), 현장 전원 소리.
- **안에서 물을 뿌리면 일어나지 않는다**(젖은 정도 조건) — 내부 공격이 연기층을 식힌다는 것을 그대로 담는다.
- 화재 성공률(B1)을 흔들 수 있으므로 측정 뒤 켠다. 흔들리면 확률을 낮추거나 끈다.

### 4.8 사람에게 주는 피해와 깔린 대원

- 모든 피해는 H1 의 함수로(원인 `crush`·`blast`). **H1 의 문턱 때문에 멀쩡하던 대원(체력 41 이상)은 붕괴·폭발 한 번으로 숨지지 않는다** — 쓰러지고(체력 8), 출혈 0.04 이하. 대원의 순직은 "깔린 채 구조되지 못함" 또는 "이미 다친 대원이 한 번 더"로만 일어난다.
- **깔린 대원**(`a.trapped > 0`): 붕괴 함수는 `a.trapped`·`a.trapEv` 만 세운다. **상태 전이는 H1 §3.2 대로 `sceneManager.agentHealth` 한 곳에서** — 쓰러짐 분기의 조건에 한 조각을 더한다: `(health ≤ 15 || (a.trapped ?? 0) > 0) && a.status !== 'down'` → 지금(H1)의 쓰러짐 처리 그대로(`a.status = 'down'`, `r.status = 'down'`, `r.tDown ??= sim.t`, `finishTask(…, 'preempt')` — 업고 있던 사람을 내려놓는다), 그리고 깔린 경우만 `a.label = '잔해에 깔림'`, 기록 문구는 H1 의 모양 그대로 `RESPONDER_HURT` detail `'${이름} 대원 쓰러짐 (잔해 깔림)'`, `causes: [a.trapEv]`, text `'${이름} 대원이 무너진 잔해에 깔렸습니다! 구조가 필요합니다.'`(imp 3). 이미 `down` 이면 그 분기에 들어가지 않으므로 기록 없이 `trapped` 만 붙는다. `withdrawn` 대원(안전 구역)은 붕괴 구획 안에 있을 수 없으므로 해당 없다. 같은 틱의 `agentHealth` 는 환경 단계(규칙) 뒤에 도므로 깔린 그 틱에 쓰러진다.
- 동료가 보면 `mate` 사실에 `trapped: true` 가 붙는다(H1 의 `mateFact` 에 칸 하나). `rescueMate`(지금, H1 이 고친 것): 대상이 `trapped > 0` 이면 곁(1.3칸)에서 먼저 `trapped -= rescue × (0.35 + 0.65 × tool) × staminaF × dt`(구출과 같은 식), 0 이 되면 지금처럼 끌고 나온다. `fitFor` 의 `rescueMate` 는 깔린 동료일 때 `skills.rescue ≥ 0.3` 을 요구하고, 단계 3 구역 안이면 0(§5.3 — 구역이 풀리거나 제한적 구조 진입(§5.6, 깔린 동료도 대상)으로 단계 2 가 된 동안에 들어간다).
- 업고 있던 사람은 업은 대원이 깔리거나 쓰러지면 내려놓인다(지금의 `finishTask` 와 같다).

### 4.9 숫자 요약

| 일 | 문턱 | 시간·확률 | 피해 |
|---|---|---|---|
| 구획 붕괴 | `integ < 0.36` | 4초 뒤부터 초당 `0.01 + 0.5 × (0.36 − integ)`, `≤ 0.05` 즉시 | 구조 대상 숨짐 12% · 갇힘 55%, 대원 30~60(35% 깔림) |
| 전체 붕괴 | 무너진 몫 ≥ 45% 또는 `bldg < 0.30` (건물 임박 조짐 뒤 6초) | 초당 `0.02 + 0.6 × (0.30 − bldg)` (+0.1 무너진 몫 ≥ 60%), `bldg < 0.12` 즉시 | 숨짐 18~40% · 갇힘 나머지의 70%, 대원 55~95(60% 깔림) |
| 가스 폭발 | LEL 구름 + 점화원 | 불·충격은 즉시, 스파크 초당 `min(0.012, 0.0012 × N × hazardMul)` | `r` 2.6~6, `dmg` 24~55 |
| 용기 폭발 | `heatLoad ≥ 1` | 가스 용기 곁 불 0.8 → 약 45초 (안전밸브 소리 약 25초) | 위 표 |
| 전소 | 탄 비율 ≥ 0.7 | 방치된 건물 화재는 218~443초(§1.2) | 재산 100% |
| 분진 폭발 (선택) | 분진 구획 + 무너짐·충격·센 불 | 0.5 / 0.5 / 초당 0.04 | `r` ≈ 3.5~4, `dmg` 30 |
| 플래시오버 (선택) | 불 몫 ≥ 0.25 · 연기 ≥ 0.7 · 마름 | 초당 0.05 | 방 전체 불 0.45 |

---

## 5. AI 의 반응

### 5.1 대원 — 조짐을 보면 물러난다

지금의 후퇴(`brain.dangerScore` → `retreat`)를 그대로 쓰고, **믿음 속 조짐**을 더한다(진실을 새로 읽지 않는다 — §12.1). **단계 3 은 점수가 아니라 의무**다 — `dangerScore` 끝의 `u *= 1.25 − 0.5 × composure` 와 판단 오차(±0.07) 때문에, 점수로 더하면 진압 중(0.94~0.98)·운반 중(+0.35)인 대원과의 비교가 동전 던지기가 된다. 안전밸브 소리에서 폭발까지 약 20초인데 제 감각으로 물러날지가 정해지지 않으면 안 된다.

| 지금 있는 것 (그대로) | 의무 — 자기 믿음의 단계 3 (`selfDanger(a)`) | 점수 — `signDanger(a)` (자기 믿음만) |
|---|---|---|
| 체력 < 40 → 1.4 | 자기 구역이나 이웃 구역(`regionNbrs`)의 `struct` 단계 3 | 자기 자리의 `gas` 단계 2 이고 자기 구역·이웃 구역의 불 믿음 > 0.1 → **+0.9** |
| 둘레 3×3 의 불(소방은 0.85 넘고 체력 < 65 일 때만) | 자기 구역의 `gas` 단계 3 | 자기 방의 `fire` 단계 2(롤오버)이고 지금 그 방을 진압하는 중이 아님 → **+0.6** |
| 연기 노출 시간 | 7칸 안 `vessel` 단계 3 (그 용기를 냉각하던 중이어도) | |
| 피격 위협 | `bldg` 단계 3 이고 자기 자리가 건물 칸(`footprint`) 안 | |
| 운반 중 × 0.55 | | |

- **점수**는 `dangerScore` 의 **곱셈 뒤에** 더한다(`u = u × (1.25 − 0.5 × composure) + signDanger(a)`) — 침착함이 조짐 점수까지 깎지 않게.
- **의무**(`selfDanger`)는 `think` 에서 철수 명령 의무(아래)와 같은 자리에서 처리한다: 업고 있지 않고 지금 `evacuate` 가 아니면 `setTask(…, 'evacuate', '철수')`, 목표 구역은 자기 믿음으로 만든 임시 구역(그 구역과 이웃 구역, 용기면 원 7칸). 업고 있으면 그 운반이 곧 밖으로 나가는 길이다.
- 위의 어느 것으로든 물러나면(후퇴든 의무든) `a.avoid = { regions: [자기 구역과 이웃 구역], x, y, r: (용기면 7, 그 밖 0), until: sim.t + 30 }`. `fitFor` 는 `avoid` 안을 대상으로 하는 일에 0 을, `agentCost` 는 `avoid` 칸에 +20 을 준다(30초 동안 같은 곳으로 다시 들어가지 않는다 — 지금의 "후퇴했다 바로 다시 들어가기"를 막는다).
- 기록: 지금의 '위험 수준이 너무 높습니다. 일단 물러나 재평가합니다.' 를 까닭에 따라 바꾼다 — `천장이 내려앉고 있습니다. 물러납니다.` · `가스 농도가 위험합니다. 물러납니다.` · `용기 안전밸브가 울립니다. 물러납니다!` · `롤오버 — 방에서 나갑니다.` (20초에 한 번, 지금 규칙).
- **철수 명령(`ops` 사실)도 의무다**: `think` 의 `boardOrder` 블록 바로 뒤에(R2 가 합쳐지면 R2 의 물 위 가드 다음, R1 의 공기통 교체 후보보다 앞 — R2 §10) — 믿음 속 `ops` 의 단계 3 구역 안에 있고, 업고 있지 않고, 지금 `evacuate` 가 아니면 `setTask(…, 'evacuate', '철수')`. `a.opsSeen` 이 그 명령의 시각과 다를 때만 `철수 명령 수신. 밖으로 나갑니다.`(imp 1).
- **`evacuate` 중에는 다른 갈래로 넘어가지 않는다**: 같은 자리에 `board` 처럼 `if (cur && cur.kind === 'evacuate') return;`. `evacuate` 는 작업판에 없는 임무라 지금의 "현재 임무 계속" 점수가 0.5(`think` 의 기본 갈래)여서, 이것이 없으면 지시(0.56 + 0.4p)나 후퇴에 쉽게 밀려나 구역 안으로 되돌아간다.
- `evacuate` 실행(`executor`): 목표 = `evacPoint(s, zones)`(`ops.ts` — 단계 3 구역 밖이고 건물 칸(`footprint` ≥ 1)에서 2칸 넘게 떨어진 바깥 칸: `s.staging` → `s.safe` → 도로 줄(y 18)의 칸 순서로 처음 맞는 것). `moveTo(…, 1.6)`. 도착하면 `finishTask(true)` 와 `learnQuiet(ops 100 + rid {par: true})`(조용히 — 인원 점검 응답), `a.label = '철수 완료'`. 길이 없으면 2초 기다렸다 다시(잔해는 지금의 "장애물 발견 → 치우기" 하위 작업으로 뚫는다).
- **`agentCost`**: 믿음 속 `ops` 의 **단계 3 구역 칸은 지나갈 수 없다(−1)**. 예외 — `evacuate` 중인 대원, `risky` 작업(§5.6)을 맡은 대원, 업고 있는 대원, 그리고 **지금 그 구역 안에 서 있는 대원**(나가는 길을 막지 않는다). 단계 2 구역은 비용을 바꾸지 않는다(허락된 일이 들어간다). `a.avoid` 칸은 +20. +20 만 주면 구역 밖의 일로 가는 경로가 구역(대개 복도)을 지나가고, 지나가다 철수 의무에 걸려 "들어감 → 복도에서 철수 → 밖에서 다시 배정"이 되풀이된다(CLAUDE.md 의 왕복 함정과 같은 꼴).

### 5.2 지휘관 — 위험 단계

`orders/catastrophe.ts` 의 `dangerMap(sim, s, a, ops)` 가 **지휘관의 믿음과 기억만으로** 구역별 단계(0~3)와 원(용기)을 만든다. 표는 `DANGER_RULES` 상수 하나에 모은다(R3 가 줄을 늘린다).

**"이웃 구역"**: 이 표에서 구역을 넓힐 때는 `regionNbrs`(§2.4, 원래 생김새) 가운데 **`kind === 'room'` 인 구역만** 넣는다. 복도(`'corridor'`)는 방 4~8개와 이웃하므로(검토 때 60개 현장에서 잼), 넣으면 방 하나만 임박해도 복도가 단계 3 이 되어 그 층 전체가 막힌다. 단, 조짐이 난 구역 자신이 복도이면 그 복도는 들어간다.

| 믿음 | 단계 |
|---|---|
| `struct` 조짐 1 | 0 (기록만) |
| `struct` 조짐 2 | 1 |
| `struct` 조짐 3 | 3 — 그 구역과 이웃 방 |
| 그 구역이나 이웃 구역이 25초 안에 무너짐(`event partial`) | 3 (재붕괴 위험, 25초 동안) |
| 센 불(믿음 ≥ 0.5)이 150초 넘음 (`ops.burnSince`) | 1 |
| 센 불이 260초 넘음 | 3 — 단, 그 구역에 살아 있는 구조 대상을 알면 2 |
| `gas` 조짐 1 · 2 | 1 |
| `gas` 조짐 3 | 2 |
| `gas` 조짐 2 이상이고 같은 구역·이웃 구역의 불 믿음 ≥ 0.15 | 3 — 가스 조짐이 있는 구역들과 그 이웃 |
| 가스 용기 사실(`haz gas`, active) + 그 구역 불 믿음 ≥ 0.3 | 2 — 원 4칸 (냉각하는 대원은 예외 §5.3) |
| `vessel` 조짐 2 | 2 — 원 5칸 |
| `vessel` 조짐 3 | 3 — 원 6칸 |
| `fire` 조짐 2 (롤오버) | 2 — 그 방 |
| `dust` 조짐 + 그 구역 불 믿음 ≥ 0.3 | 2 — 그 구역 |
| `bldg` 조짐 1 (신고 내용으로만 — §3.6) | 0 (기록만) |
| `bldg` 조짐 2 | 1 (건물) |
| `bldg` 조짐 3, 또는 `struct` 조짐 3 인 구역이 둘 이상 | 3 — **건물 전체 → 외부 방어** |
| 다 탄 듯한 건물: 실내 구역의 50% 이상이 불 믿음 ≥ 0.6 이고 그 구역들의 센 불이 120초 넘음 | 3 (살아 있는 구조 대상을 모를 때) / 2 (알 때) — 건물 전체 |
| 건물 단계 3 인데 모든 구역의 불 믿음 ≤ 0.3 이고, 새 사건(`event`)·조짐 상승이 90초 동안 없음 | 2 — **구조 안정**(허락된 일만, 외부 방어를 풀고 `mode = 'interior'`). 불을 끈 뒤 탄 몫 상한 때문에 건전도가 다시 오르지 않는 건물이 한계 시간까지 갇히지 않게 한다. 건물 조짐 3 은 진실에서 끝내 무너지므로(§2.4) 이 줄은 지휘관의 믿음이 낡은 경우(외부 관찰이 조짐 3 을 다시 보지 못함)의 출구다 |

"살아 있는 구조 대상을 안다" = 그 구역(건물이면 건물 칸) 안에 `cas` 믿음이 `where 'scene'`·`band < 3` 인 사람이 있다.

### 5.3 지휘관 — 단계별 지휘

| 단계 | 뜻 | 지휘 |
|---|---|---|
| 1 | 조짐 | 막는 조치를 먼저(§5.8). 그 구역에 동시에 들어가는 인원을 2명으로(진압·수색의 `max` 를 1 로 낮춘다). 필요한 부대를 부른다(§5.9) |
| 2 | 위험 — **새 진입 금지** | `NoGoZone level 2`. 그 구역을 대상으로 하는 일 가운데 **허락된 것만** 나간다: `mitigate`(가스 재측정 갈래 포함 — §5.7), `suppress`, 아는 구조 대상의 `carry`·`extricate`·`waterRescue`(소방 대원만, 체력 ≥ 60), `rescueMate`. 그 밖의 일(`search`·그 자리 `treat`·`clear`·`force`·`overhaul`·`escort` 등)은 거둔다. `hookup`·`traffic`·`perimeter` 는 구역 밖의 일이라 상관없다. 가스 용기 원 안의 냉각 대원은 원 4칸 규칙에서 예외 |
| 3 | 임박 — **전원 철수** | `NoGoZone level 3`. 그 안의 일을 거두고 안에 있는 대원에게 철수를 명령한다(§5.4). **예외 둘 — `suppress` 와 `'gas'` 소품의 냉각 `mitigate` 는 거두지 않고 문·안전망도 막지 않는다**: 실행기가 `opsExterior` 로 바깥 자리에서 한다(§5.5·§5.8). 이 둘까지 거두면 외부 방어 중에 아무도 방수하지 않는다. 문·안전망은 **대원이 구역 칸에 들어가는 갈래만** 막는다. 건물 단위면 `mode = 'defensive'`(외부 방어) |

**구역을 만들고 바꾸는 법**: 계획 주기마다 `dangerMap` 으로 구역 목록을 새로 만들고 지금의 `ops.zones` 와 키로 견준다 — 새로 생긴 키·단계가 오른 키는 그 자리에서 처리(기록·명령), 사라진 키는 §5.7 의 재진입 조건을 통과해야 지운다(조짐이 한 번 안 보인다고 바로 풀지 않는다). 구역이 바뀌면 `ops` 사실을 다시 보낸다.

**일이 다시 생기지 않게 막는 문(`registerGate`)**: 지금 `syncBoard` 는 계획 주기마다 수색 등을 다시 `want` 하므로, 지휘 규칙이 거두기만 하면 다음 주기에 새 작업이 생기고 작업판이 불어난다(`orders/crime.ts` 의 폭발물 방 수색 취소가 이미 그렇다). 그래서:
- `sceneRegistry.ts` 에 `WORK_GATES` 와 `registerGate((sim, s, a, kind, tg) => boolean)`(참이면 막는다)을 더한다.
- `commander.ts`: `syncBoard` 첫 줄에서 모듈 변수 `gateCmd = a` 와 `gateHits = 0`, `want()` 가 **새 작업을 만들기 직전**에 `if (gateCmd && WORK_GATES.some((g) => g(sim, s, gateCmd, kind, tg))) { gateHits++; return GHOST; }`, `syncBoard` **끝**(ORDER_RULES 뒤)에서 `if (s.ops) s.ops.gated = gateHits; gateCmd = null;`(지금 `want` 는 `syncBoard` 안에서만 불리지만 앞으로를 위한 안전장치). 이미 있는 작업은 지휘 규칙이 구역을 만들 때 한 번 거둔다.
- **`GHOST`**: 작업판에 넣지 않는 빈 작업, `id: -1`, **`Object.freeze`** 한 모듈 상수. `want` 의 돌려준 값은 지금 `commander.ts`·`orders/*` 어디서도 쓰지 않는다(검토에서 확인 — `ORDER_RULES` 의 `k.want` 도 값을 버린다). 돌려받은 값을 고치는 새 코드(§5.6 의 `w.risky = true`)는 **`if (w.id >= 0)`** 으로 감싼다 — 얼린 객체에 쓰면 ES 모듈(엄격 모드)에서 `TypeError` 가 나므로 실수가 바로 드러난다.
- 문의 판정(`ops.ts` `gateBlocks`)은 `s.ops`(지휘 상태)·`s.region`·`s.tiles`(생김새)·`footprint`·`regionNbrs`·`a.beliefs`(구조 대상의 믿음 위치)만 읽는다. 막는 것: ① 대상이 단계 2 구역 안이고 허락된 일이 아님, ② 대상이 단계 3 구역 안(§ 위 표의 예외 둘 빼고), ③ **대상이 단계 3 구역을 지나지 않고는 닿을 수 없는 곳** — `cutOff(s)`: 출입구(`s.exits`)에서 지나갈 수 있는 칸(`staticPass`·문)을 따라 단계 3 구역 칸을 빼고 채워 나가 닿지 않는 구역(구역 목록이 바뀌거나 `staticVersion` 이 바뀔 때만 다시 계산 — `WeakMap`). ③이 없으면 단계 3 칸이 지나갈 수 없게 된 뒤(§5.1 `agentCost`) 그 너머의 일이 `nopath` 8초 보류를 끝없이 되풀이하며 '진입 경로를 찾지 못했습니다' 기록이 넘친다.
- 같은 판정을 `agents.fitFor` 가 안전망으로 쓴다(이미 맡은 일이 구역 안이 되면 0 → 판단 주기에 놓는다. 단계 2 의 허락된 일, 단계 3 의 외부 방수·외부 냉각은 예외).
- 문이 막은 수(`ops.gated`)가 0 보다 크면 상황 종료를 막는다(§6.2) — 수색하지 않은 구역을 남긴 채 `resolved` 가 선언되지 않게.
- B3 의 "맡을 사람이 없는 작업"(`commander.needFor` — 20초 넘게 아무도 맡지 못한 열린 작업이 있으면 그 능력의 부대를 부른다)이 구역 때문에 헛요청을 내지 않게: 구역이 생길 때 그 안의 열린 작업은 거두고 문이 새로 만들지 않으므로 열린 채 남는 것은 단계 2 의 허락된 일뿐이다. 그 일을 맡을 사람이 없어 부대를 부르는 것은 맞는 동작이다.
- B3 의 확인 무전(`rollCall`)은 "모두 손을 놓았는데 끝낼 수 없을 때" 한 번 나간다. 외부 방어 중 종료를 막는 동안(§6.2) 한 번 나가는 것은 해가 없다.

**출입구 통제**: `commander.ts` 의 `cordon` 식에 `|| opsCordon(s)`(`ops.ts`: 건물·가스·용기 구역 가운데 단계 3 이 있거나 `mode === 'defensive'`) 한 조각 — 경찰이 출입구에서 사람을 막는다(지금의 `perimeter` 그대로). 같은 `cordon` 을 쓰는 경찰 요청(`request(…, 'law', '가스가 새는 건물 주변을 통제할 인력이 없음')`)의 사유는 가스 누출 때문이 아니면 `'붕괴·폭발 위험 반경을 통제할 인력이 없음'` 으로 고른다(가스 누출 조건을 따로 두고 `opsCordon` 만 참이면 새 문구).

### 5.4 전원 철수와 인원 점검

1. **결정**: 단계 3 구역이 새로 생겼거나 단계가 올랐고, 그 안에 대원이 있다(지휘관은 대원의 위치를 안다 — 지금의 `assign` 도 쓴다).
2. **명령**: `const ev = transmit(sim, s, a, -1, 'order', [ops 사실], '전원 철수! ${구역 이름} — ${까닭}. 즉시 밖으로 나와 인원 점검.', -1, 3, [그 구역의 DANGER_SIGN 기록])`. **`ev < 0` 이면(지휘관이 음영 구역 — `transmit` 이 -1 을 돌려준다) 아무것도 남기지 않고 다음 계획 주기에 다시 한다**(`request()` 의 `if (ev < 0) return` 과 같다 — 기록·경적·모드 전환 없음. 지휘관은 지금의 `moveSignal` 로 음영을 벗어난다). 보냈으면: `pushFx('horn', 지휘관 자리)`, `raiseProblem(sim, I, 'WITHDRAWAL', '${까닭}으로 ${구역 이름} 전원 철수', { role: 'COMMANDER', imp: 3, causes: [그 구역의 DANGER_SIGN 기록] }, false)` — 구역 키마다 하나. `ops.mode = 'withdraw'`(건물 단위면 바로 `defensive` 로 이어진다), `ops.parAsked` = 그 안의 대원 가운데 **`a.status === 'active'` 인 대원만**(쓰러진·떠난 대원은 응답할 수 없다), `ops.parAt = sim.t`, `ops.parDue = sim.t + 70`.
3. **공기 경적**: 경적은 무전이 아니라 소리다. 같은 자리에서 현장의 `active` 대원 가운데 경적 자리에서 **28칸 안**(사실상 현장 전체)인 대원 모두에게 같은 `ops` 사실을 `learnQuiet` 로 넣는다 — **음영 구역과 관계없이**. 그래서 음영 구역의 대원도 철수를 안다(§12.2-4). 대원의 위치는 지휘 조직이 아는 것이고 거리는 생김새라 진실 읽기가 아니다. 무전 문구는 명령 한 줄뿐이다(로그 중복 함정).
4. **대원**: `ops` 사실을 받은 대원이 `evacuate`(§5.1 의 의무). 쓰러진 대원은 움직이지 못한다(그 결과가 그대로 나온다).
5. **인원 점검**: 25초 뒤 `parAsked` 가운데 `ops 100 + rid` 응답이 없는 대원 → `인원 점검: ${n}명 미확인 — ${이름들}. 응답하라.`(COMMANDER, imp 2) + 명령을 다시 보낸다(10초 간격, 3번까지 — 재송신도 `ev < 0` 이면 다음 주기로 미룬다). 그사이 `active` 가 아니게 된 대원(쓰러짐·이송)은 `parAsked` 에서 뺀다. 모두 응답하면 `인원 점검 완료 — 철수 대원 ${n}명 전원 확인.`(imp 1). 쓰러졌다고 아는 대원(`mate` 믿음)은 점검에서 빼고 `rescueMate` 로 넘긴다(구역이 풀리거나 제한적 구조 진입(§5.6)으로 단계 2 가 될 때까지는 문이 막는다 — §5.3).
6. **끝**: 모두 응답했거나, 세 번째 재송신 뒤 10초가 지나도 미확인이 남았거나, `ops.parDue` 가 지났으면 점검을 끝낸다. 미확인이 남았으면 `인원 점검 미완료 — ${n}명 미확인 (${이름들}). 위치 파악을 계속합니다.`(COMMANDER, imp 3). 그리고 `mode` 는 건물 단위 구역이 있으면 `defensive`, 없으면 `interior`(구역은 진입 금지로 남는다). `withdraw` 가 종료를 막는 것은 `parDue` 까지뿐이다(§6.2) — 응답할 수 없는 대원 때문에 한계 시간까지 교착하지 않게.

### 5.5 외부 방어

- **외부 방수**: `executor` 의 `suppress` 첫머리에서 `opsExterior(s, t.region)`(`ops.ts`: `mode === 'defensive'` 이거나 그 구역이 단계 2·3 구역 — 단, 단계 2 에서 그 구역 안에서 진압 중이던 대원은 계속 안에서)이면 `runExterior` 로 간다:
  - 서는 자리 `exteriorSpot(s, region)`: 실내가 아니고 지나갈 수 있는 칸, 단계 3 구역 밖, 구조 위험(건물·구획 붕괴) 때문이면 건물 칸에서 2칸 넘게 떨어진 칸. 그 가운데 그 구역의 불 칸 하나에 **시야선(창·열린 문·무너진 벽 너머)이 닿고 5.5칸 안**인 칸을 대원에게 가까운 순서로. 구역마다 처음 한 번 후보를 계산해 `WeakMap` 에 둔다(지형이 바뀌면 `staticVersion` 으로 다시).
  - 서서 `spray(sim, s, a, tx, ty, 0.7, 1.4)` — `spray` 에 효과 배율·물 배율 인자(기본 1)를 더한다(R2 의 `defensive` 가 같은 인자를 쓴다).
  - 닿는 칸이 없으면 실패(`nopath`, 8초 보류). **창 없는 안쪽 방은 밖에서 끌 수 없다** — 그 방은 타 버리고, 그것이 외부 방어의 실제 결과다(전소로 이어질 수 있다). 같은 구역의 외부 방수가 두 번 실패하면(`w.fails ≥ 2` — 잔불 정리(`overhaul`)의 규칙과 같다) 지휘 규칙이 그 작업을 거두고 `ops.noExt` 에 그 구역을 넣어, 외부 방어가 이어지는 동안 그 구역의 진압을 다시 내지 않는다(문이 막는다). 안 그러면 8초 보류가 끝없이 되풀이되며 '진입 경로를 찾지 못했습니다' 기록이 넘친다(CLAUDE.md 함정). `mode` 가 `interior` 로 돌아가면 `noExt` 를 비운다.
- **냉각**: 가스 용기 원(단계 2) 밖에서 닿으면 냉각도 같은 방식으로 밖에서 한다(§5.8).
- **경계**: 출입구 통제(§5.3), 붕괴 반경(건물 칸 1칸 밖)은 서는 자리 계산이 피한다.
- **부대 요청**: 외부 방어로 바꾸면 `request('suppression', '외부 방어 — 방수 부대 추가', true)`(사다리차가 오면 R2 의 `aerial` 이 쓴다). 처음 바꿀 때 `ops.limitBonus += 150`(§6.4 — 지휘 쪽 보탬은 지휘 상태에 둔다. 지휘 규칙은 `s.cat` 을 읽지도 쓰지도 않는다).
- 외부 방어 중에도 대원은 `active` 다(대기 `standby` 나 외부 방수). 7번 블록의 방치 종료에 걸리지 않는다.

### 5.6 구조 대상이 안에 남았을 때

- **단계 3 에는 예외가 없다** — 대원의 안전이 먼저다. 다만 지금 구조 대상을 **업고 있는** 대원은 그대로 밖으로 나간다(그것이 철수다). 지휘관은 `구조 대상 ${n}명이 ${구역}에 남아 있습니다 — ${구조물이면 '무너진 뒤 잔해에서 구조합니다' | 용기·가스면 '위험이 가라앉는 대로 들어갑니다'}.` 를 한 번 남긴다(COMMANDER, imp 2).
- **단계 2** 는 아는 구조 대상의 운반·구출을 허락한다(§5.3, 소방·체력 ≥ 60).
- **제한적 구조 진입**(위험을 감수하는 결정): 단계 3 구역이 60초 넘게 이어지는데 그 안에 살아 있는 구조 대상(믿음 `band ≤ 2`) **또는 깔리거나 쓰러진 동료**(`mate` 믿음 `status 'down'`, 숨지지 않음 — 이른바 신속 구조팀)를 알고, 그 60초 동안 새 조짐·사건이 없었다면, 그 구역을 **40초 동안 단계 2 로 낮추고**(`ops.entry[key] = { until: sim.t + 40, n: n + 1, last: sim.t }`) 가장 가까운 대상 하나에 `const w = want('carry' 또는 'extricate' 또는 'rescueMate', …, 0.93, 2); if (w.id >= 0) w.risky = true;`(§5.3 의 `GHOST` 규칙). 기록 `${구역}에 ${구조 대상|동료}이(가) 있습니다. 2명만 들어가 40초 안에 데리고 나온다.`(COMMANDER, imp 3). 새 조짐이 오르거나 40초가 지나면 다시 단계 3(철수 명령). **같은 구역에 다시 할 수 있다**: 마지막 진입 뒤 90초 동안 새 조짐·사건이 없으면, 구역마다 3번까지. 깔린 동료를 빼면 풀리지 않는 구역 안에서 한계 시간까지 남아 `canClose` 의 '쓰러진 동료' 조건에 걸린다.
- `fitFor`: `w.risky` 인 일은 소방 대원이고 체력 ≥ 70, 지구력 ≥ 40 (R1 이 있으면 공기호흡기 `scba`)일 때만. `risky` 작업을 맡은 대원은 단계 3 칸도 지날 수 있다(§5.1 `agentCost` 예외).

### 5.7 다시 들어가는 조건

| 구역 | 풀리는 조건 |
|---|---|
| `struct`(구획) 단계 3 | 그 구역이 무너지고(`event partial`) 25초 동안 이웃에서 새 무너짐이 없다 → 구역을 지우고 `ops.rubble` 에 넣는다(잔해 수색 — 소방·구조만 §6.1). 또는 믿음 속 조짐 단계가 2 이하로 40초(보강이 끝나 건전도가 올라 확인된 하향(§3.1)이 들어온 경우 — 단계 3 의 감각은 소리 10칸이라 구역 밖에서 확인할 수 있다) |
| `bldg`(건물) 단계 3 / 외부 방어 | 전체 붕괴(`event total`) 뒤 30초 → `mode = 'rubble'`(§6.1). 또는 모든 구역의 불 믿음 ≤ 0.3 이고 `struct`·`bldg` 조짐 3 이 40초 동안 없다 → `mode = 'interior'` '내부 진입 재개'. 또는 §5.2 의 "구조 안정" 줄(불 ≤ 0.3, 90초 동안 새 사건·조짐 상승 없음 → 단계 2). 또는 외부 확인 종료(§6.2) |
| `gas` 단계 3·2 | 새 측정값(§3.1 — 측정기 대원이 그 구획의 **문턱**에 서면 읽는다)이 단계 1 이하. 그 측정을 위해 지휘 규칙이 **재측정 작업**을 낸다: `want('mitigate', { region: r, tile: 그 구획의 문턱 칸 }, 0.7)` — `mitigate` 의 측정 갈래(소품 없이 칸만 있는 작업, `workLabel` '가스 재측정', `fitFor` 측정기를 가진 대원만, 실행은 그 칸으로 가서 1초 서 있다가 끝 — 읽기는 `perceiveSigns` 가 한다). 문턱 칸은 단계 3 구역 밖이어야 한다(구역 칸이면 그 구획의 다른 문턱, 없으면 내지 않는다). 측정이 단계 2 이상이면 그 작업은 끝나고 20초 뒤 다시 낸다. 또는 원천 차단(밸브 `haz leak` 이 `active:false` 이거나 도시가스 차단 완료 사실 `sign` id 5001 — §2.3-2)을 알고 60초가 지났으면 단계 3 → 2 |
| `vessel` 단계 3·2 | 용기가 터졌다(`event vessel`). 또는 확인된 하향(§3.1 — 안전밸브 소리를 들을 수 있는 7칸 안에서 소리가 멈춘 것을 들음)으로 조짐 단계 ≤ 2 가 20초 + 그 구역 불 믿음 ≤ 0.2 |
| `fire` 단계 2 | 그 방 불 믿음 ≤ 0.3 |
| `dust` 단계 2 | 분진이 터졌거나(사건) 그 구역 불 믿음 ≤ 0.1 |
| **모든 단계 2 구역 (상한)** | 180초 동안 그 구역의 조짐이 오르지 않았고 그 구역과 이웃 구역의 불 믿음 ≤ 0.3 이면 `변화 없음 — 조심스럽게 재진입` 으로 푼다. 아무도 다시 재지 못해도 영영 막히지 않게 한다(교착 방지 — §12.2-3) |

구역이 풀리면 `markRecoveredBy(I, 'WITHDRAWAL', 그 구역의 detail, '${fmtSec(경과)} 뒤 ${까닭} — 다시 진입')`(`events.ts` 에 detail 로 고르는 함수를 더한다 — 지금의 `markRecovered` 는 가장 최근 것만 고친다), `ops.reentries++`, `ops` 사실 다시 보냄, 기록 `${구역} 진입 재개 — ${까닭}.`(COMMANDER, imp 2).

### 5.8 막는 조치의 우선순위 (보강·냉각·차단)

| 믿음 | 지휘 | 비고 |
|---|---|---|
| 균열(`haz leak`, unstable) active | 지금 그대로 `mitigate` 0.86. 그 구역의 구조 조짐이 2 면 **0.92** | 보강하면 건전도 +0.1(§2.4) |
| 밸브 active | 지금 그대로 0.86. 그 구역 가스 조짐이 2 이상이면 **0.93**. R2 가 있으면 `ventFirst` 가 고를 수 있다 | |
| 가스 용기·드럼(`haz gas`) active + 그 구역 불 믿음 ≥ 0.2 또는 `vessel` 조짐 ≥ 2 | **새 규칙**: `want('mitigate', { prop }, 0.9 + 0.03 × 조짐)` = **냉각** | 용기가 터졌거나(active:false) 불 믿음이 없고 조짐 ≤ 1 이 20초면 거둔다 |
| 가스 단계 3 구역이 밸브를 덮어 차단하러 갈 수 없음, 또는 밸브 위치를 모르는데 가스 조짐 ≥ 2 | **도시가스 공급 차단 요청**: `ops.utilityAsked = sim.t`, 기록 `관제, 도시가스 공급 차단 요청 — ${까닭}.`(COMMANDER → 관제, imp 2). 세계 규칙이 90~150초 뒤 모든 살아 있는 밸브를 `mitigated` 로 하고 `도시가스사: 공급 차단 완료 — 누출이 멈춥니다.`(SYSTEM, imp 2)와 함께 현장 전원에게 **차단 완료 사실**(`sign` id 5001, `what 'utility'` — §2.3-2)을 무전으로 알린다. 지휘관은 이 사실로 원천 차단을 안다(밸브마다 `haz` 를 알리지 않는다 — 모르는 밸브의 위치가 새어 나간다) | 한 사건에 한 번. 밸브의 `mitigated` 는 지금의 "차단"과 같은 뜻으로 센다 |
| 단계 2 이상 가스 + 불 | 그 불을 먼저 끈다: 그 구역 `suppress` 에 +0.12 (점화원 제거) — 단계 3 이면 밖에서(§5.5) | |

**우선순위 0.22 규칙**(CLAUDE.md 함정): 하던 일보다 0.22 이상 높아야 대원을 빼 온다. 진압(0.56~0.94) 중인 소방 대원은 냉각(0.9~0.99)으로 빠지지 않을 수 있다. 그래서 냉각을 따로 내는 것과 함께 **용기가 있는 구역의 진압 우선순위를 0.9 이상으로 올린다**(그 구역의 불을 끄는 것이 곧 용기를 식히는 것이다 — 진압은 가장 가까운 불 칸부터 끈다). 손이 빈 대원은 냉각 작업을 맡는다. 맡을 사람이 없으면 B3 의 `needFor` 가 이미 `mitigate`(균열이 아니면) → `suppression` 으로 진압 부대를 부른다.

`mitigate` 의 냉각 실행(`executor` `case 'mitigate'` 에 갈래 하나): 대상이 `'gas'` 소품이면 — 터졌으면 `reportDone(sim, a, haz {kind:'gas', active:false})`(이미 끝나 있던 일은 조용히 + 강제로 — CLAUDE.md 함정) 후 끝. 아니면 시야선이 닿는 3.2칸 안으로 가서(외부 모드면 §5.5 의 자리에서 5.5칸) `spray(sim, s, a, p.x, p.y)`. `heatLoad < 0.15` 이고 2.5칸 안에 불 ≥ 0.3 이 없으면 끝: `learnQuiet(sign vessel 단계 0)`, 기록 `가스 용기 냉각 완료. 폭발 위험을 낮췄습니다.`(recovery, imp 2). 냉각은 영구 조치가 아니다(`mitigated` 를 세우지 않는다 — 불이 다시 닿으면 다시 데워진다). `workLabel`: `'gas'` 소품이면 `가스 용기 냉각`(드럼 `드럼통 냉각`). `fitFor`: `'gas'` 소품이면 `suppress` 와 같은 조건(물·펌프가 있는 소방 대원, R1 이 있으면 `hose`).

**막은 위험의 기록(`DANGER_SIGN`)**: 지휘관이 단계 2 이상을 (구역·종류 키마다) 처음 알면 `raiseProblem(sim, I, 'DANGER_SIGN', '${종류 이름} — ${구역}', { role: 'COMMANDER', imp: 2, causes: [I.lastEvent] }, false)`. **`raiseProblem` 은 detail 로 중복을 거르지 않는다**(`events.ts` — 코드만 보고, `dedupe = false` 면 늘 더한다). 그래서 부르는 쪽이 먼저 `I.problems.some(p => p.code === 'DANGER_SIGN' && p.detail === detail && !p.recovered)` 를 보고, 참이면 `emit` 까지 통째로 건너뛴다. 같은 detail 이 **복구된 뒤 다시** 단계 2 이상이 되면 새 문제로 남긴다(다시 생긴 위험이다). 그 위험이 사건 없이 가라앉으면(보강·차단·냉각·진압으로 조짐이 1 이하가 되고 20초 — `ops.calmSince[key]`, 또는 원천 차단을 앎) `markRecoveredBy(I, 'DANGER_SIGN', detail, '${조치} — 막음')`. 붕괴·폭발이 일어나면 미복구로 남는다 — 보고서가 "조짐 → 결과" 사슬을 쓴다(§6.6).

### 5.9 관제

- **위험도 재평가**: 지휘관은 모드가 바뀌거나 붕괴·폭발·전소가 일어나면 관제에 상황 보고(`sitrep`, `to -2`)를 보낸다 — `관제, ${무슨 일}. ${외부 방어로 전환|전원 철수 중|잔해 수색 시작}, 매몰 추정 ${n}명.`, 사실에 `event`/`ops` 를 싣는다. `dispatcher.fieldReport` 에 갈래 하나: `m.kind === 'sitrep'` 이고 사실에 `sign event` 가 있으면 **사건의 별도 칸** `I.fieldRisk`(§2.2)를 고친다 — `risks` 에 `건물 붕괴`·`폭발 발생`·`건물 전소` 를 더하고(이미 있으면 그대로), `sev` 를 지금 위험도에서 **다음 `sevName` 문턱까지** 올린다(1.7 미만 → 1.7, 2.4 미만 → 2.4, 그 위 → 3, 상한 3 — `analyst.ts` 의 `sevName` 이 1.7·2.4 로 나눈다). 그리고 `assess(sim, I, '현장 상황 보고')` 를 부른다. `analyst.assess` 는 끝에서 `I.fieldRisk` 가 있으면 `sev = max(sev, fieldRisk.sev)`, `risks` 에 합친다 — `I.assessment` 를 통째로 새로 만드는 다음 `assess`(새 신고 진술)에도 현장 보고분이 지워지지 않는다(`I.fieldType` 과 같은 방식). 사건 순위 `dispatcher.priorityOf` 가 위험도를 읽으므로 배정 순서가 따라 바뀐다. 기록 `현장 보고 반영: ${무슨 일} — 위험도 ${sevName(이전)} → ${sevName(새)}.`(ANALYST, imp 2). 관제는 지휘관이 보낸 것만 읽는다(진실 아님).
- **추가 부대**(지금의 `request` 길): 구획·전체 붕괴 뒤 `rescue`(구조 부대가 둘 미만이면 `'건물 붕괴 — 매몰자 구조'`), 폭발 뒤 `ems`(`'폭발 — 부상자 다수 예상'`), 외부 방어 `suppression`, 건물 단위 철수·가스 단계 3 에 경찰이 없으면 `law`(`'붕괴·폭발 위험 반경 통제'`). 70초 안의 같은 요청은 지금처럼 한 번만 나간다.
- **주변 통제**: 전체 붕괴의 도로 통제(§4.2). 가스 단계 3 에서 경찰은 출입구 통제(§5.3). 주변 건물 대피는 모델하지 않는다(C4 몫).

### 5.10 문제 코드

새 코드 다섯 — `CLAUDE.md` "새 문제 코드" 절차(`types.ts` `ProblemCode` → `debrief.ts` `PROBLEM_LABEL`·`order`·문장 틀). **`ProblemCode` 다섯과 `PROBLEM_LABEL` 다섯 줄은 1단계에 함께** 넣는다(`Record<ProblemCode, string>` 이라 빠지면 컴파일이 깨진다). `order` 자리와 문장 틀 `T`(`Partial<Record<…>>`)는 7단계.

| 코드 | 이름표 | 누가 남기나 | 복구 |
|---|---|---|---|
| `DANGER_SIGN` | 위험 조짐 | 지휘관 (`orders/catastrophe.ts`, 믿음이 바뀐 자리) | 사건 없이 가라앉음 |
| `WITHDRAWAL` | 전원 철수 | 지휘관 (철수를 명령한 자리) | 재진입 |
| `STRUCT_COLLAPSE` | 구조물 붕괴 | 세계 규칙 (`collapseRegion`·`collapseBuilding`) | — |
| `EXPLOSION` | 폭발 | 세계 규칙 (`explodeGas`·`ruptureVessel`·분진) — 지휘관이 몰랐으면 `HIDDEN_HAZARD` | — |
| `BURNOUT` | 건물 전소 | 세계 규칙 (전소 판정) | — |

`order` 의 자리: `'WATER_OUT'` 뒤, `'HIDDEN_HAZARD'` 앞에 `'DANGER_SIGN', 'WITHDRAWAL', 'BURNOUT', 'STRUCT_COLLAPSE', 'EXPLOSION'`(H1 이 넣은 `RESPONDER_KILLED` 는 맨 앞 그대로). 같은 코드를 여러 번 남기므로 모두 `dedupe = false`.

---

## 6. 사건의 끝

### 6.1 무너진 현장 — 잔해 수색 국면

- 전체 붕괴 30초 뒤(또는 구획 붕괴 25초 뒤 그 구획) 지휘 규칙이: `ops.mode = 'rubble'`(전체) / `ops.rubble.push(구역)`(구획), 기록 `붕괴가 멎었습니다. 잔해 수색을 시작한다 — 소방·구조 대원만 진입.`(COMMANDER, imp 3).
- **믿음을 고친다**(낡은 믿음 함정): 그 구역들의 `srch` 믿음을 `min(지금, 0.3)`·신뢰도 0.5 '붕괴 후 재수색' 으로 합치고(지금의 재수색 `researchRound` 와 같은 방식 — **`verified: true`, 시각은 지금**. `verified: false` 면 `BeliefStore.merge` 가 확인된 기존 믿음 위에 덮지 않는다) 대원들에게 조용히 보낸다. 그 안에 있던 것으로 아는 구조 대상(`cas`, `where 'scene'`, `band < 3`)은 `mob = 'trapped'`, `trappedDone = false`, 신뢰도 0.5 '붕괴 후 매몰 추정' 으로 합친다(같은 규칙 — `verified: true`, 지금 시각) — 실제로 갇히지 않았으면 `extricate` 가 시작할 때 강제 보고로 바로잡힌다(지금 `extricate` 의 `c.mob !== 'trapped'` 분기). `carry`·`escort` 가 갇힌 대상을 만났을 때의 강제 보고(`learn(sim, a, casFact(…), true, true)` 뒤 `'gone'`)는 **H1 §5.1 이 이미 더한다** — H1 이 합쳐져 있으면 건너뛰고, 없을 때만 X6 가 `executor.ts` 의 그 분기에 한 줄 넣는다(§12.1).
- 수색·구출은 소방·구조만: `fitFor` 의 `fireRisk` 에 `|| inRubble(s, region)`(`ops.ts`) 한 조각. `extricate` 의 `fitFor` 는 `fireRisk` 를 쓰지 않으므로(`agents.ts`) 같은 조건을 **`extricate` 에도 따로** 건다 — 잔해 구역의 구출은 소방·구조 분야만(화재·무장 현장의 잔해 구출도 같다. 무너진 구획에서 경찰·구급대원이 잔해를 들추다 2차 붕괴에 휘말리는 연쇄를 막는다). 붕괴 현장의 구조대 탐지 보정(`agents.detectRadius` 의 `s.kind === 'collapse'`)에 `|| isRubbleMode(s)` 한 조각.
- 잔해 소품은 지금의 치우기(`clear`)로 뚫는다. 수색 확인율은 시야로 세므로 잔해가 길을 막아도 볼 수는 있다.
- 남은 균열(`unstable`)은 그대로 2차 붕괴를 낼 수 있다(무너진 구획 안이면 `tickCollapse` 의 잔해만 더 쌓인다).

### 6.2 다 탄 현장 — 외부 확인 종료

다 탄 건물은 안쪽 구역들이 단계 3 으로 남아 들어가 불이 꺼진 것을 확인할 수 없다(지금의 진압 확인은 구역 칸의 85% 를 봐야 한다). 그러면 한계 시간까지 간다. 그래서 지휘 규칙이 **외부 확인**을 한다:

- 조건(모두): `mode === 'defensive'` 이거나 단계 3 구역이 있다 · 건물이 다 탔다고 볼 근거가 있다(지휘관의 믿음에 `bldg` 조짐 2 이상이 있거나, 센 불(믿음 ≥ 0.5)을 본 적이 있는 구역 — `ops.everHot` — 이 실내 구역의 60% 이상) · 살아 있는 구조 대상을 그 안에서 알지 못한다 · **외부 관찰의 기억이 "60초 동안 센 불 없음"을 말한다**: 대상 구역(단계 3 구역과 `everHot` 구역) 모두에서 지휘관의 `a.extSeen`(§3.3) 이 `hot[r] < sim.t − 60`(한 번도 못 봤으면 −1), `cov[r] ≥ sim.t − 8`(마지막 7초 관찰이 그 구역을 덮었다), `cov0[r] ≤ sim.t − 60`(60초 넘게 관찰해 왔다). 지휘관의 7초 외부 관찰(벽 너머 불 ≥ 0.25 를 본다 — 이미 있는 예외)이 이 기억을 쓴다. 지금의 `fire` 사실의 시각으로는 이것을 알 수 없다 — 꾸준히 타는 불은 값이 0.2 넘게 바뀌지 않아 새 사실을 만들지 않으므로 오히려 "꺼졌다"고 오판한다. 전소 판정은 조용히 일어나므로(§4.6) 지휘관은 그것을 직접 알지 못한다.
- 그러면: 그 구역들의 `fire` 믿음을 0 으로 합친다 — **`verified: true`, 신뢰도 0.6, 지금 시각**, 문구 `외부 관찰 — 불길 없음(추정)`(`verified: false` 면 `BeliefStore.merge` 가 확인된 기존 불 믿음 위에 덮지 않아 `canClose` 가 영영 실패한다). 그 안의 남은 수색·잔불 정리 작업을 거두고, `ops.concluded = true`, 기록 `건물이 전소되어 내부 확인이 불가합니다. 외부에서 불길이 없음을 확인했습니다. 현장을 경계 인력에 인계하고 철수합니다.`(COMMANDER, imp 3). 그 뒤 `canClose` 가 지금처럼 판단한다(문은 계속 막지만 `concluded` 이면 아래 차단이 풀린다).
- 판정은 진실로 한다: 안에 남은 불(`fire > 0.2`)이 있으면 `hazardActive`, 발견하지 못한 사람이 있으면 미발견 — "외부 확인"이 틀렸다면 그대로 드러난다.
- 전체 붕괴한 현장은 이 길이 아니라 잔해 수색(§6.1)으로 간다(무너져 열린 잔해는 밖에서도 보인다).

**종료를 막는 것**(`registerBlocker`): `s.ops` 가 있고 `!ops.concluded` 이며, 아래 가운데 하나:
- `mode === 'withdraw'` 이고 `sim.t < ops.parDue`(인원 점검 중 — 시한까지만, §5.4-6);
- 단계 3 구역이 있다;
- **`ops.gated > 0`** — 지난 계획 주기에 문이 막은 일이 있다(단계 2·3 구역이나 끊긴 구역의 수색 등, §5.3). `canClose`(`commander.ts`)는 열린 작업이 없으면 통과하는데 문이 막은 일은 작업판에 생기지 않으므로, 이것이 없으면 수색하지 않은 단계 2 구역을 남긴 채 `resolved` 가 선언되어 미발견 구조 대상이 남는다. 이 차단은 구역 해제(§5.7 — 단계 2 구역의 180초 상한 포함), 외부 확인 종료, 한계 시간이 끝을 보장한다;
- 가스 조짐 2 이상을 90초 안에 읽었다(아직 위험하다). 오래된 측정값으로는 막지 않는다(아무도 다시 재지 않으면 영영 막히므로).

### 6.3 폭발 뒤

폭발은 그 자체로 끝나는 일이다. 그 뒤는 지금의 규칙이 받는다: 번진 불(진압), 다친 사람(처치·이송), 깨진 창·부서진 가구(N7), 약해진 구조(§2.4 — 구획 붕괴로 이어질 수 있다). 밸브는 `ignited`(누출 멈춤), 용기는 `exploded`. 지휘관은 소리로 안다(§3.5).

### 6.4 한계 시간·방치와의 관계

- 7번 블록의 한계 시간 식에 `+ Math.min(330, (s.cat?.limitBonus ?? 0) + (s.ops?.limitBonus ?? 0))` 한 조각: 세계 쪽(`CatState` — 구획 붕괴마다 +60, 전체 붕괴 +180)과 지휘 쪽(`OpsState` — 외부 방어로 처음 바꿀 때 +150, 지휘 규칙이 넣는다)을 합쳐 330 까지. 외부 방어로 바꾸는 것은 지휘 규칙이고 지휘 규칙은 `s.cat` 을 읽거나 쓰면 안 되므로(§10-7) 두 칸으로 나눈다. 외부 방어로 다 탈 때까지 기다리거나 잔해를 파내는 데는 시간이 더 든다(방치된 건물은 300~600초 동안 탄다, §1.2).
- 철수·외부 방어 중의 대원은 `active` 다(`evacuate`·`standby`·외부 방수). `withdrawn`(다친 대원)으로 바꾸지 않는다 — 7번 블록의 60초 방치 종료에 걸리지 않는다.
- 새 종료 이유(`'lost'` 등)는 만들지 않는다. 다 탄 건물도 `resolved`(외부 확인 종료)·`timeout` 가운데 하나로 끝나고, 결과는 판정이 정한다.
- `hardCap` 은 그대로.

### 6.5 판정 (`debrief.evaluate`)

- **재산 피해** `propertyLossOf(s, I)`(`catastrophe.ts`):
  - 전소 또는 전체 붕괴 → 1.0.
  - 그 밖 → `max(탄 비율, 무너진 칸 비율 × 1.2, 불붙은 소품이 있으면 0.4, 폭발이 있었으면 0.3)`, 상한 1. 무너진 칸 비율 = `damage` 칸 가운데 **사건 중에 무너진 칸**(처음 붕괴 현장의 무너진 자리는 빼기 위해 `catOf` 가 처음 `damage` 를 한 벌 복사해 둔다) / 건물 칸. 탄 비율은 화재 유형이면 지금처럼 `burnedTiles / totalFuelTiles`(자른다), 그 밖의 유형은 `c.struct` 현장이면 §2.7 의 건물 칸 비율, 아니면 0(비행기·선박·길 위의 현장 — 화재 유형이 아니면 지금과 같다).
  - **화재 유형에서 X6 일이 없었으면 지금 식(탄 비율)과 같다.** 화재가 아닌 유형의 탄 비율이 들어가는 것은 새로운 몫이다(가스 폭발 현장이 다 타면 지금은 0 이었다).
- **위험이 남았는가**(`hazardActive`)에 더하는 것: 서 있는 건물의 보강하지 않은 균열(전체 붕괴 전), 열 0.3 이상이고 곁에 불이 있는 용기, LEL 구름(가스 1 이상 칸).
- 점수: 따로 더하지 않는다 — 결과(사망·갇힘·재산 피해·위험이 남음)가 지금의 식으로 벌점이 된다. 철수 그 자체는 벌점이 아니다. 대원 피해는 H1 의 식.
- `IncidentResult.catastrophe` = `catSummary(s, I)`: 전소·전체 붕괴 여부, 구획 붕괴 수, 폭발 수, 철수했는가, 막아 낸 조짐 수(`DANGER_SIGN` 복구), 휘말린 대원 수(붕괴·폭발로 다친 대원 — `RESPONDER_HURT` 의 원인 기록이 붕괴·폭발 기록인 것).

### 6.6 보고서 문장 — 원인 사슬

문장은 **기록된 문제**에서만 만든다(`T` 표에 더한다).

| 코드 | 문장 틀 |
|---|---|
| `DANGER_SIGN` | 복구된 것: `위험 조짐을 보고 막았습니다: ${detail → recoveryText} (앞의 둘).` / 복구 안 된 것: `조짐이 있었지만 막지 못했습니다: ${detail} (앞의 둘).` (둘 다 있으면 두 문장) |
| `WITHDRAWAL` | `${detail} — ${복구면 recoveryText, 아니면 '끝까지 밖에서 대응했습니다'}.` (여럿이면 `전원 철수가 ${n}번 있었습니다: …`) |
| `BURNOUT` | `${detail}.` (detail 에 사슬 문구가 있다 — §4.6) |
| `STRUCT_COLLAPSE` | `구조물이 무너졌습니다: ${detail} (앞의 셋).` 같은 구역의 미복구 `DANGER_SIGN` 이 있으면 ` 붕괴 조짐이 확인된 지 ${fmtSec(붕괴 시각 − 조짐 시각)} 뒤였습니다.` 를 붙인다 |
| `EXPLOSION` | `폭발이 일어났습니다: ${detail} (앞의 셋).` 같은 위험의 미복구 `DANGER_SIGN` 이 있으면 ` 위험을 알고 있었지만 ${용기면 '냉각', 가스면 '차단·환기'}이(가) 끝나기 전이었습니다.` |

- 사망 문장(H1 이 원인을 붙인다)은 원인이 `crush`·`blast` 면 그 붕괴·폭발 기록의 detail 을 짧게 붙인다: `구조 대상 C는 2층 호실 3 붕괴로 숨졌습니다.`(그 사람의 `causeEvent` 가 그 붕괴의 기록이다).
- **한 줄 요약**: `건물 전소` / `건물 붕괴` / `폭발 ${n}회` 를 덧붙이고, 소실률은 화재가 아니어도 재산 피해가 0 보다 크면 붙인다(`소실률 ${pct}`).
- **교대 보고서** `buildReport`: `ShiftReport.catastrophe`(합), `placeMarks`(교대 끝의 `Sim.placeMarks` 목록), 요약 문장 하나(있을 때만): `이번 교대에 건물 ${a}곳이 전소되고 ${b}곳이 무너졌습니다. 폭발 ${c}건. 위험 조짐을 보고 전원 철수한 것이 ${d}번, 막아 낸 조짐이 ${e}건입니다.`

---

## 7. 지도와 화면

### 7.1 건물 상태 — `Sim.placeMarks`

- **자료**: `Map<placeId, PlaceMark>` — `Sim` 의 필드(교대마다 새로 만든다). `city.places` 는 고치지 않는다.
- **대상**: `c.struct` 현장(실제 건물 — §2.4)이고 `I.truth.placeId ≥ 0` 인 것만. `NO_STRUCT` 변형(비행기·선박·산불·열차·다중 추돌·크레인·산사태·승강기)과 길 위의 현장은 지도에 남기지 않는다 — 활주로·부두·숲·공원에 '전소' 표시가 남고 `pickPlace` 가 그 터를 교대 끝까지 빼는 일이 없게.
- **채우는 곳**(진실 쪽, 상태가 바뀐 자리): 폭발 → `blasted`(이미 더 무거운 상태면 그대로), 구획 붕괴 → `partial`, 전소 → `burnt`, 전체 붕괴 → `collapsed`. 무거운 순서 `collapsed > burnt > partial > blasted > scorched`. `catTick` 9번이 매초 `burnFrac`(§2.7 의 건물 칸 탄 비율)·`ruinFrac`(무너진 칸 비율)을 고친다.
- **끝날 때**: `closeIncident` 끝에 `noteClosedPlace(sim, I)` 한 줄 — `c.struct` 화재가 닫혔고 상태가 아직 없는데 탄 비율이 0.15 이상이면 `scorched`(그을린 건물). 사건이 없는 곳(`placeId < 0`, 길 위·교통사고)은 남기지 않는다.
- **같은 건물의 재발**: `incidents.pickPlace` 에서 `collapsed`·`burnt` 인 건물은 엄격 추첨·대안 추첨 모두에서 뺀다(지금은 엄격 추첨만 이미 쓴 건물을 뺀다). 다른 상태는 지금 규칙 그대로. **`pickPlace` 를 거치지 않는 길도 막는다**: `disaster.ts` 는 자기 `pickPlace`(열린 사건의 건물만 뺀다)로 고른 건물을 `opts.placeId` 로 넘기고, 추격전의 은신처(`pursuit.ts` 의 `hideout` 연쇄)도 `opts.placeId` 로 넘긴다. 그래서 `incidents.createIncident` 에서 `opts.placeId` 가 `collapsed`·`burnt` 건물을 가리키면 `opts.placeId` 를 지우고 그 유형의 `pickPlace` 로 다시 고른다(한 줄 — 그 경우에만 사건 흐름 `rng` 를 한 번 더 쓴다). 재난의 "진앙 근처" 같은 위치의 뜻은 그 경우 잃는다 — 무너진 건물에서 새 사건이 나는 것보다 낫다고 본다(`disaster.ts`·`pursuit.ts` 는 고치지 않는다).
- `ShiftReport.placeMarks` 로 내놓는다. 다음 교대에 이어받는 것은 I2.

### 7.2 지도 그림

**G4 가 먼저 합쳐졌으면**(결과 불변 — 화면만):
- `view/hazardState.ts` 의 `ruinSeen` 대상에 "그 사건의 건물에 `placeMarks` 가 있음"을 더하고, `ruinInfo.level` 에 `'total'`(collapsed)·`'burnt'` 를 더한다.
- `view/city/ruinLayer.ts` `drawRuinsWorld`: `total` = 지붕 대신 건물 윤곽 전체를 잔해 더미로(조각 수 × 2, 지붕 판 없음, 외곽선 끊김, 먼지), `burnt` = 지붕 전체 그을음(`rgba(14,10,8,0.7)`) + 구멍 2~3개 + 밤에 불빛 없음, `scorched` = G4 §7.6 의 그을린 지붕, `blasted` = 건물 둘레의 깨진 유리 반짝임 고리와 검은 자국 하나. 배지 기호 `RUIN_MARK` 에 `total`·`burnt` 를 더한다(초안 경로는 견본표로 다듬는다).
- 범례 "건물 상태"에 `전소`·`전체 붕괴`·`폭발 흔적`.

**G4 가 아직이면**: `view/city/placeMarkLayer.ts` 에 위와 같은 그림을 작게 만든다(`renderCity.ts` 월드 층의 `drawDisasterWorld` 뒤에 `drawPlaceMarks(…)` 한 줄, 매 프레임 덧그림 — 고정 지도 층은 교대마다 한 번만 그리므로). G4 가 합쳐질 때 이 파일을 `ruinLayer` 로 옮기고 지운다.

**시점**: 관찰자 시점은 상태가 생긴 순간부터. AI 시점은 그 사건에 부대가 도착했던 경우(`I.firstArrivalAt ≥ 0`)만.

### 7.3 현장 그림 (`view/scene/catLayer.ts` — 결과 불변)

`renderScene.ts` 의 그리는 순서(`G4-scene-legibility.md` §4.6) 안에 두 자리: 소품 뒤(위험 범위들과 같은 높이)에 `drawCatUnder`, 구역 이름 뒤에 `drawCatOver`(글자 표지는 `{x, y, text, color}[]` 로 돌려주고 `renderScene` 의 `pill()` 이 그린다).

| 그림 | 관찰자 시점 | AI 시점 |
|---|---|---|
| 구획 건전도 | `integ < 0.6` 인 구획의 경계에 호박색 점선, `< 0.36` 이면 붉게 맥박 + `구조 약화 ${pct}` / `붕괴 임박` 표지 | 지휘관이 아는 `struct` 조짐 단계로 같은 색(숫자 없음) |
| 가스 구름 | `gas ≥ 0.25` 노란 등고선, `≥ 1` 붉은 등고선 + `LEL 초과` (G4 §7.1 의 가스 물들이기가 있으면 그 범위를 `c.gas` 로 바꾼다) | 지휘관이 아는 `gas` 측정값을 그 구역에 `LEL ${n}%` 표지로 |
| 용기의 열 | 용기 둘레 고리, `heatLoad` 만큼 채운 호(노랑 → 빨강), 0.55 이상 깜박임 + `안전밸브 작동` | `vessel` 조짐이 2·3 이면 같은 고리(채우지 않음) |
| 진입 금지 구역 | 단계 2 주황 점선·단계 3 빨간 굵은 점선, 구역 위 `진입 금지`/`철수` 표지 | 같다(지휘 상태는 조직이 안다) |
| 철수 중인 대원 | 이름표 `철수` · 깔린 대원 `잔해에 깔림`(사람 그림 위에 잔해 조각 두세 개) | 같다 |
| 외부 방수 | 지금의 물줄기 그림 그대로(서는 자리만 바깥) | 같다 |

무너진 모습·무너지는 순간은 G4 의 `markRuin`·`recordFall` 로 얻는다(G4 가 없으면 지금의 `s.damage` 회색 얼룩 + 잔해 소품). 드럼통 그림(`skins/catastrophe.ts` 의 `drum`: 남색 원통 위에서 본 모습 + 위험 마름모, 터졌으면 찢긴 고리 — `skins.ts` 의 `SKINS` 에 펼쳐 넣는다).

### 7.4 소리와 카메라

- `audio.ts`: `'horn'` — 길고 낮은 공기 경적 세 번(1초 · 0.4초 쉼). G5 가 소리를 효과 기록 훑기(`fresh`)로 바꿨으면 그 훑기에 분기 하나, 아니면 지금의 `this.ok(…)` 빈도 제한 방식.
- `camera.ts` 의 효과 종류 목록(`frameAction`)에 `'horn'`(무게 2), 자동 감속은 G5 의 `DECISIVE` 집합(`fxBook.ts`)에 `'horn'` 한 단어(G5 가 없으면 `Viewport.tsx` 의 조건). G4 의 `'collapse'` 와 지금의 `'boom'` 은 그대로.
- 폭발마다 G5 의 `noteBoom(…, r, src)`(§4.3·§4.4 의 반경, `src` = `'gas'`·`'tank'`·`'drum'`·`'cng'`·`'jet'`·`'dust'`) — G5 가 반경으로 화염구·충격파·흔들림의 크기를 정한다.

### 7.5 G4·G5 와의 맞물림

- **G4 가 먼저**: `collapseRegion` 에서 가구·벽을 바꾸는 줄마다 `markRuin`, 끝에 `recordFall(sim, s, r.cx, r.cy, max(폭, 높이)/2, cause)` — `cause` 는 그 구획 장부(`loss`)의 가장 큰 항이 FIRE·BURN 이면 G4 의 `'ceiling'`(불에 탄 천장이 내려앉음 — G4 §3.3 의 `tickFire` 천장 붕괴 기록이 X6 가 그 덩어리를 지울 때 함께 사라지므로 그 그림을 이어받는다), 그 밖이면 새 값 `'partial'`. `collapseBuilding` 은 안쪽 벽에 `markRuin(…, RUIN_WALL)`, 바닥 칸에 `markRuin(…, RUIN_TOTAL = 10)`(새 값 — G4 §16 "추가만")과 `recordFall(…, 건물 가운데, 건물 반지름, 'total')`. `FallRecord.cause` 에 `'partial' | 'total'` 을 새 줄로 더한다. G4 의 `drawFallMoments` 가 반경을 그대로 쓴다. (§12.2-9 와 같은 결정.)
- **X6 가 먼저**: 같은 자리에 `// G4: markRuin(s, i, RUIN_FURN + d)` 같은 주석을 남기고, G4 가 합쳐질 때 채운다.
- **G5**: 폭발은 `pushFx('boom', x, y, …, ttl)` 바로 뒤에 `noteBoom(lastFx(sim, s, 'boom'), r, src)`(G5 의 `fxlog.ts`). G5 가 지운 줄(`tickFire` 의 가스 용기 `noteBoom(…, 3.6, 'tank')`, `tickGas` 의 `noteBoom(…, 3.8, 'gas')`)은 X6 가 그 덩어리를 지울 때 함께 사라지므로 `ruptureVessel`·`explodeGas` 에 같은 꼬리표를 다시 단다. `tickCollapse` 의 `noteBoom(…, 2.6, 'collapse')` 는 G5·G4 의 규칙대로 둔다(X6 는 그 함수를 고치지 않는다). G5 가 없으면 `pushFx` 만.

---

## 8. 균형

### 8.1 목표 (보통, 시드 60 — **B1·H1 이 합쳐진 뒤의 기준선** 대비)

| 무엇 | 목표 |
|---|---|
| 건물 화재의 전소 | 건물 화재(화재 유형이고 `c.struct` — `wild`·`plane`·`ship` 제외, `placeId ≥ 0`)의 **2~6%** (60교대에 대략 4~10건) |
| 전체 붕괴 | 60교대에 **1~5건** (대부분 전소 뒤) |
| 불로 인한 구획 붕괴 | 기준선의 '천장 일부 붕괴' 건수 **±30%** (같은 현상을 새 규칙이 대신한다) |
| 붕괴 현장의 구획 붕괴(2차 붕괴 아님) | `--force collapse/std` 20교대의 사건 가운데 **3~12%** |
| 2차 붕괴 | 바뀌지 않는다(`tickCollapse` 그대로). `tests/sim.test.ts` 의 "2차 붕괴 1건 이상" |
| 가스 폭발 | `hazmat/std` 의 **5~15%**, `collapse/gasblast` 의 **15~40%** |
| 가스 용기 폭발 | 용기가 있는 화재의 **25~60%** (지금 거의 100%) |
| CNG·항공유 폭발 | `traffic/bus` 20교대에 0~3건, `fire/plane` 20교대에 0~4건 |
| 전원 철수 | 60교대에 **4~15번**, 그 가운데 재진입 ≥ 40% |
| 붕괴·폭발에 휘말린 대원 | 교대당 **≤ 0.05** (60교대에 3명 이하). 순직은 H1 의 상한(교대당 0.02) 안 |
| 막아 낸 조짐 | `DANGER_SIGN` 의 **60% 이상** 복구 |
| 전체 분포 | `npm run check` 범위 안. 성공+대응 지연 기준선 −4%p 이내. 한계 시간·방치 +2건 이내 |
| 유형별 성공률 | 화재 −6%p 이내(B1 의 62~84% 안을 지킨다), 붕괴 −6%p, 가스 −6%p, 교통 −3%p |
| `tests/sim.test.ts` | 보강 > 균열의 50%, 차단+발화 > 밸브의 80%, 차단 > 발화, 한계 시간 < 20% (모두 그대로 통과). 그리고 **먼저 깨질 수 있어 지켜보는 것**(`sim.test.ts` 는 고칠 수 없다): '2층 건물'(2층 수색 > 60%, 2층 구조 > 50%, 한계 시간 < 20% — 구조 위험·외부 방어가 2층 구조를 줄이면 여기서 먼저 깨진다), '현장 대원의 행동'(진압 확인 > 2), '결과가 한쪽으로 쏠리지 않는다' |
| 미리 안 비율 | X6 폭발 가운데 `EXPLOSION`(지휘관이 위험을 알았음) 대 `HIDDEN_HAZARD`(몰랐음)의 비 — 잰다(목표는 두지 않는다. 0 에 가까우면 조짐이 지휘관에게 닿지 않는 것) |
| 조짐에서 사건까지 | 단계 3 조짐을 지휘관이 안 시각 → 붕괴·폭발 시각의 간격 분포 — 잰다(대개 `FALL_GRACE` 4초 이상이어야 한다) |
| 화재당 외부 방어 전환 | 잰다. 0.15 를 넘으면 "`struct` 조짐 3 구역이 둘 이상 → 건물 전체" 줄이 평범한 화재에서 잦은 것(§8.4-2) |
| 외부 확인 종료의 정확도 | 외부 확인 종료(§6.2) 가운데 판정에서 위험이 남았거나(`hazardActive`) 미발견이 나온 비율 — 잰다. 30% 를 넘으면 조건의 60초를 늘린다 |
| 프리셋 | 쉬움 > 보통 > 어려움 > 극한 순서 유지. 극한의 전소·붕괴는 보통의 2~4배 |

### 8.2 난이도 손잡이와의 관계

새 손잡이는 만들지 않는다. **심각도**의 `tune.hazardMul`(0.55 · 0.78 · 1 · 1.25 · 1.5)이 들어가는 곳: 구조 손실 `hz = 0.8 + 0.2 × hazardMul`, 가스 원천 `0.75 + 0.25 × hazardMul`, 스파크 `× hazardMul`, 드럼통·분진이 놓일 확률 `× hazardMul`. `fireSpreadMul` 은 불을 통해 전소·구조 손실에 저절로 들어간다(플래시오버도 `× fireSpreadMul`). **장비** 손잡이는 펌프 고장·용수(지금)를 통해 전소에 들어간다. **부대 규모**는 진압 부대 수를 통해.

### 8.3 다시 재는 법

```bash
# 0단계에서 한 번 ($SCRATCH = 각자의 scratchpad. 결과를 저장소에 넣지 않는다)
npx tsx scripts/sweep.ts 60 --json > $SCRATCH/x6-before-normal.json
for d in easy hard extreme; do npx tsx scripts/sweep.ts 60 --diff $d --json > $SCRATCH/x6-before-$d.json; done
for f in fire/std fire/arson fire/ship fire/plane fire/wild collapse/std collapse/gasblast collapse/crane hazmat/std traffic/bus traffic/pileup traffic/train armed/bomb; do
  npx tsx scripts/sweep.ts 20 --force $f --scen > $SCRATCH/x6-before-${f/\//-}.txt; done
# 시뮬레이션을 고친 단계마다 같은 명령으로 after-* 를 만들어 견준다. 한 교대를 읽을 때는 --log 시드
```

- `scripts/sweep.ts` 에 집계 한 줄(결과는 바뀌지 않는다): `catastrophe: burnout n (x% of building fires) · total n · partial n (fire n / struct n / blast n) · explosions n (gas n · vessel n · dust n; known n / hidden n) · withdrawals n (re-entry n) · defensive/fire x · ext-close n (wrong n) · sign→event p50 s · crew caught n · signs averted n/m`. `--json` 에도 같은 칸. "building fires" 의 분모는 §8.1 과 같다(`c.struct` 화재).
- **방치 시험**(상수 맞추기 — §2.5·§2.4 의 "맞출 값"): 스크래치 스크립트로 `createIncident` 한 현장을 대원 없이 `tickScene` 만 돌린다(`sim.tick++`, `sim.t += sim.dt` 를 손으로 — 다른 하위 시스템은 돌지 않으므로 부대가 오지 않는다). `fire/std` 14건의 전소 시각·전체 붕괴 시각, `hazmat/std` 8건의 LEL 구름이 생기는 시각, 가스 용기 곁에 불을 놓은 현장의 폭발 시각을 잰다. 이 문서 §1.2 의 숫자가 그 방식으로 잰 것이다.

### 8.4 범위를 벗어나면 돌리는 손잡이 (이 순서로)

1. 불로 인한 구획 붕괴가 기준선과 다르다 → `K_BURN`(1.0), `K_HEAT`(0.0025).
2. 전소가 많다/적다 → 외부 방어로 바꾸는 문턱(§5.2 의 "다 탄 듯한 건물" 50%·120초), 센 불 260초 규칙, **"`struct` 조짐 3 구역이 둘 이상 → 건물 전체 외부 방어" 줄**(64% 넘게 탄 방은 무너질 때까지 단계 3 으로 남으므로 — §2.4 계산 예 ② — 평범한 화재에서도 잦게 걸려 전소를 늘릴 수 있다. 화재당 외부 방어 전환 수(§8.1)로 본다. 셋 이상으로 올리거나 "불 믿음 ≥ 0.5 인 구역 가운데"로 좁힌다). 전소 자체의 문턱(0.7)은 정의이므로 마지막에.
3. 전체 붕괴가 많다 → `TOTAL_SHARE`(0.45), `TOTAL_BLDG`(0.30) — 건물 조짐 3 의 문턱과 함께 움직인다(§2.4), 이웃 구획 하중(−0.12).
4. 가스 폭발이 많다/적다 → `GAS_SRC`, 스파크 상한(`SPARK_MAX` 0.012)과 `SPARK_AGE`(90). `tests/sim.test.ts` 의 "차단 > 발화" 가 흔들리면 먼저 이것.
5. 용기 폭발 → `VESSEL_HEAT`, 냉각 우선순위(0.9).
6. 휘말린 대원이 많다 → `FALL_GRACE`(4초 → 6초), 구획 붕괴의 깔림 확률(35%), 철수 명령을 다시 보내는 간격.
7. 철수가 너무 잦아 화재 성공률이 떨어진다 → `struct` 조짐 3 의 문턱(0.36)과 구획 붕괴 확률 식을 함께 내린다(조짐과 붕괴의 간격을 지킨다).

`npm run check` 의 기준 범위 자체는 고치지 않는다(README §4). 범위 안이지만 위 목표를 벗어나면 보고에 수치를 적는다.

### 8.5 `npm run check`

`tsc --noEmit` + 모든 테스트(새 `tests/catastrophe.test.ts` 포함) + 시드 40개 헤드리스(`--check`: 성공+대응 지연 65~90%, 실패+미해결 3~25%, 한계 시간 종료 4% 이하). X6 는 이 범위를 고치지 않는다.

---

## 9. 구현 순서

단계마다 커밋하고(`wf/catastrophe`, 한국어 메시지, 푸시하지 않음), 단계 끝마다 `npx tsc --noEmit` · `npx vitest run tests/catastrophe.test.ts tests/ext.test.ts` · `npm run check` 를 통과시킨다. **3·4단계는 AI 의 대응(5단계)이 없어 `check` 범위를 벗어날 수 있다 — 벗어나면 그 단계와 5단계를 한 커밋으로 합친다.**

| 단계 | 내용 | 결과가 바뀌는가 |
|---|---|---|
| **0. 기준** | §8.3 의 `before-*`, 그리고 H1 §10 과 같은 모양의 해시 목록(시드 12 × 평소 + 강제 시나리오 4종 × 3 + `5,5,5,1,5,1` × 4)을 scratchpad 에 저장. 방치 시험 스크립트 준비 | — |
| **1. 상태만** | `types.ts` 의 자료형(**`ProblemCode` 다섯을 넣으면 `debrief.ts` 의 `PROBLEM_LABEL` 다섯 줄도 같은 커밋에** — `Record<ProblemCode, string>` 이라 빠지면 `tsc` 가 멈춘다. `order`·문장 틀은 7단계), `ops.ts` 의 생김새 도움 함수(`footprint`·`regionNbrs`), `catastrophe.ts` 의 `catOf`(처음 만들기 — 용기 판별과 `heatK` 만, 드럼통·분진은 아직)·`catRng`, 구조 건전도·가스 격자·용기 열·전소 판정을 **계산만** 하고 아무것도 바꾸지 않는 `catTick`, `rules/catastrophe.ts`·`scenes/index.ts` import, `Sim.placeMarks`, `sweep.ts` 집계 줄(값은 0), (없으면) 빈 `world/consequence.ts` | **아니다 — 해시 목록이 한 글자도 같아야 한다**(새 흐름은 부모를 소비하지 않는다. 이름표는 기록 해시에 들어가지 않는다) |
| **2. 조짐** | `perceiveSigns`(관찰·보고 규칙 §3.1, `signObs`), `sign`·`ops` 사실, `IMPORTANT`·`significant`·`flushOutbox`(`important`·`shown`) 조건, `BeliefStore.merge` 의 `sign` 하향 조각, `ROLL_CALL` 의 `sign`, 외부 관찰의 기억(`extSeen`), 가스 용기 `active:false` 구멍, 관찰자 시점 그림(`catLayer` 의 건전도·가스·열) | 기록(무전 문구)이 바뀐다. 결과 분포는 거의 같아야 한다(`sweep 12` 의 `counts` ±1건) |
| **3. 세계 — 구조** | 구획 붕괴·전체 붕괴·전소, `tickFire` 의 천장 붕괴 지우기, `blast` 의 `catOnBlast`·층 너머 건너뛰기, 깔린 대원(`agentHealth` 한 조각), 현장 전원 소리, 도로 통제, `placeMarks`, 신호 줄 | 그렇다 |
| **4. 세계 — 폭발** | 가스 격자로 폭발(`tickGas` 의 폭발 지우기), 용기 폭발(`tickFire` 의 가스 용기 지우기), CNG·항공유, 드럼통 놓기, 차량 누출의 불 점화, 도시가스 차단 처리와 차단 완료 사실 | 그렇다 |
| **5. AI** | 대원의 조짐 의무·점수·`avoid`·`evacuate`(`think` 의 되돌아감 줄 포함)·`agentCost`, 지휘 규칙(위험 단계·구역·철수·경적·인원 점검·외부 방어·재진입·제한적 구조 진입·냉각·가스 재측정·도시가스 차단 요청·지원 요청·`DANGER_SIGN`), `registerGate`·`want` 의 문(`GHOST`·`gated`·`cutOff`)·`cordon` 과 요청 사유, 외부 방수와 `spray` 인자·`noExt`, 냉각 실행, `rescueMate` 의 깔린 동료, 관제 재평가(`fieldRisk`·`assess`)·브리핑 | 그렇다 |
| **6. 사건의 끝** | 잔해 수색 국면, 외부 확인 종료, 종료를 막는 것, 한계 시간 보탬(두 칸 합), (H1 이 없을 때만) `carry` 의 강제 보고 | 그렇다 |
| **7. 판정·보고서·지도** | 문제 코드의 `order`·문장 틀, `propertyLossOf`, `hazardActive`, 한 줄 요약, `IncidentResult`·`ShiftReport` 의 칸, `noteClosedPlace`, `pickPlace`·`createIncident` 의 건물 제외, 지도 그림(§7.2), 보고서 화면의 타일(`대형 사고` 타일 옆에 `전소 n · 붕괴 n · 폭발 n · 철수 n`), 소리·카메라 | 판정 분포가 바뀐다 |
| **8. 균형** | §8.1 에 맞춰 §8.4 의 손잡이, `tests/catastrophe.test.ts` 완성 | |
| **9. 선택** | 분진 폭발(§4.5), 플래시오버(§4.7) — 하나씩 켜고 잰다. 흔들리면 끈 채로 둔다(상수 `CAT.dust`·`CAT.flashover` 를 `false`) | 그렇다 |
| **10. 화면 확인** | 아래 주소를 Playwright 로 찍는다. 콘솔 오류 0건. 찍은 그림은 저장소 밖에 | 아니다 |

**화면 확인 주소**(시드는 시뮬레이션이 바뀌면 달라진다 — 강제 시나리오와 높은 심각도로 찾는다, 확인 필요): `http://localhost:5216/?seed=S3&force=fire/std&diff=3,5,3,1,3,1`(장비 1 — 용수가 끊겨 전소·붕괴가 나기 쉽다), `…&force=collapse/std&diff=3,5,3,3,3,3`(구획 붕괴·잔해 수색), `…&force=hazmat/std&diff=3,5,3,3,3,3`(가스 구름·측정값), `…&force=collapse/gasblast`(불 + 가스 폭발), `…&force=fire/std` 에서 가스 용기가 있는 시드(냉각·안전밸브·철수). 찍을 것: 철수 신호와 진입 금지 구역, 외부 방수, 무너진 건물(현장·지도), 전소된 지붕, 보고서의 원인 사슬.

---

## 10. 테스트 — `tests/catastrophe.test.ts`

교대를 여러 번 돌리는 묶음은 `beforeAll` 에서 한 번 돌려 나눠 쓴다(전체 40초 안팎). "현장만 돌리기"는 도움 함수 `runAlone(sim, s, seconds)` — `for (k < seconds × 5) { sim.tick++; sim.t += sim.dt; tickScene(sim, s); }`(부대가 오지 않는다).

1. **방치하면 일어난다**
   - 화재: `createIncident(sim, { type: 'fire', variant: 'std', rng: sim.rng.fork('t1') })` 를 900초 혼자 돌리면 — `BURNOUT` 기록이 있고 `cat.burntAt ≥ 0`, `STRUCT_COLLAPSE` 가 하나 이상, `Sim.placeMarks` 에 그 건물이 `burnt` 또는 `collapsed`.
   - 붕괴: `collapse/std` 현장에서 무너진 자리가 있는 구획의 `integ` 를 0.2 로 두고 60초 — `STRUCT_COLLAPSE` 가 생기고, 그 구획 안에 있던 구조 대상은 숨졌거나 `trapped`/`immobile` 이다.
   - 가스: `hazmat/std`(밸브 `leakRate ≥ 0.8`) 현장의 밸브 곁 방에 불(`fire = 0.6`, 연료 있는 칸 셋)을 놓고 400초 — `EXPLOSION` 또는 `HIDDEN_HAZARD '누출된 가스 폭발…'` 이 있고 밸브는 `ignited`. 불이 없으면 LEL 구름(가스 ≥ 1 칸 3개 이상)이 400초 안에 생긴다.
   - 용기: 화재 현장의 가스 용기 **바로 옆 칸 하나**의 불을 0.8 로 계속 유지하면(자기 칸의 1.25배를 피한다 — `near` = 0.8) 20~80초 사이에 `exploded`(`heatK` 0.8~1.25 → 약 36~56초. 불이 용기 칸으로 번져 `near` 가 1.0 이 되어도 약 29초). 안전밸브 단계(0.55)가 폭발보다 먼저 온다.
   - 용기 판별: `traffic/bus`(일반 버스)의 버스만 `vessel 'cng'`, `fire/plane` 의 가운데 동체만 `'jet'`. **동체 기수·꼬리와 `traffic/train` 의 객차는 `vessel` 이 없다**(`bus: true` 라도).
2. **조치하면 일어나지 않는다**: ① 위 붕괴 현장에서 균열을 모두 `mitigated` 로 두고 `integ` 0.5 → 300초 동안 구획 붕괴 없음. ② 밸브를 30초에 `mitigated` → 400초 동안 가스 폭발 없음, 그리고 가스가 줄어든다(최댓값이 내려간다). ③ 용기에 매초 `applyWater(s, p.x, p.y, 0.3)` → 같은 시간 동안 폭발 없음.
3. **조짐이 사실로 들어온다**: `new Sim(…, { force: 'collapse/std' })` 를 첫 부대 도착까지 돌린 뒤, 어떤 대원이 선 구획의 `integ` 를 0.4 로 두면 그 대원의 다음 판단에 `sign` (그 구획, 단계 ≥ 2) 사실이 있고, 3초 안에 지휘관의 믿음에도 있다. 0.3 으로 두면 단계 3 이 10칸 안의 대원 모두에게 생긴다(벽 너머 포함). **15칸 넘게 떨어진, 그 구획이 보이지 않는 대원에게는 없다.** 측정기를 가진 대원만 `lel` 이 있다. **하향이 깜박이지 않는다**: 지휘관의 믿음이 단계 3 일 때 그 구획을 소리 거리(6칸, 시야 밖)에서만 듣는 대원의 단계 1 보고(`down` 없음)는 지휘관의 믿음을 바꾸지 않는다. 그 구획의 `integ` 를 0.7 로 올리고 10칸 안의 대원이 관찰하면 `down: true` 보고로 지휘관의 믿음이 내려간다.
4. **지휘관이 철수를 명령한다**: `force: 'fire/std'` 에서 대원이 실내에 들어간 뒤, 지휘관의 믿음에 그 구역의 `struct` 단계 3 사실을 넣으면 — 두 계획 주기 안에 그 구역의 `NoGoZone level 3`, `WITHDRAWAL` 기록, 무전에 철수 명령. 그 구역 안의 대원은 **음영 구역에 있어도**(경적 — §5.4-3) `evacuate` 를 맡고 30초 안에 구역 밖에 있으며 인원 점검 응답(`ops 100 + rid`)이 있다. 그 구역의 수색 작업은 다시 생기지 않는다(작업판의 `cancelled` 수가 계획 주기마다 늘지 않는다). 지휘관을 음영 칸에 세워 두면 `WITHDRAWAL` 기록과 `'horn'` 이 생기지 않고, 음영을 벗어난 뒤 생긴다.
   - **인원 점검이 끝난다**: 구역 안의 대원 하나를 명령 직후 `down` 으로 만들면 그 대원은 `parAsked` 에서 빠지고, 다른 대원 하나의 응답을 막아 두면(`learnQuiet` 를 건너뛰게) 세 번 재송신 뒤 '인원 점검 미완료' 기록과 함께 `mode` 가 `withdraw` 에서 바뀐다. `ops.parDue` 뒤에는 `withdraw` 가 종료를 막지 않는다.
   - **복도는 같이 막히지 않는다**: 복도와 이웃한 방 하나에 `struct` 단계 3 을 넣으면 그 방과 이웃 **방**만 구역이 되고 복도는 구역이 아니다.
5. **일어난 뒤 사건이 끝난다**: 강제 시나리오(`fire/std`·`collapse/std`·`hazmat/std`·`collapse/gasblast`) 각 4교대에서 첫 도착 뒤 `collapseBuilding` 을 직접 부르거나(화재·붕괴) 가스 폭발을 일으키면 — 그 사건이 `hardCap` 안에 닫히고, `timeout` 은 16교대 가운데 2건 이하, `abandoned` 0건. 전체 붕괴 뒤 그 현장의 모든 바닥 칸(잔해 소품은 지나갈 수 있는 것으로 본다)에 대기 지점에서 닿는다. 외부 방어로 60초 넘게 있어도 `abandoned` 로 닫히지 않는다.
   - **2층 건물**: 2층 건물 현장에서 `collapseBuilding` 뒤 `VOID` 와 4방향으로 맞닿은 벽·창(`foot === 3`)이 모두 그대로이고, 1층 바닥 칸과 2층 바닥 칸 사이의 가장 가까운 거리가 4 이상이다.
   - **문이 막은 수색이 있는 동안 상황 종료가 선언되지 않는다**: `hazmat/std` 에서 지휘관의 믿음에 어떤 구역의 가스 단계 3(측정값 LEL 70%)을 넣고, 그 구역의 수색이 끝나지 않은 채로 다른 일을 모두 끝내도 `resolved` 로 닫히지 않는다(`ops.gated > 0`). 측정기 대원에게 재측정 작업이 나가고, 낮은 측정값이 들어오면 구역이 풀려 수색이 나간다.
   - **외부 확인 종료**: `fire/std` 에서 첫 도착 뒤 모든 실내 구역의 불 믿음을 0.8 로 두고 `mode = 'defensive'` 로 바꾼 다음, 진실의 불을 모두 끄면(`s.fire` 0) — 지휘관의 외부 관찰이 60초 넘게 센 불을 보지 못한 뒤 `ops.concluded`, 불 믿음이 0(`verified: true`), 그 사건이 닫힌다.
6. **재현성**: 같은 시드·`{ ...NORMAL, severity: 5 }`·`force: 'fire/std'` 두 번의 `report.hash` 가 같다(전소나 붕괴가 일어나는 교대 하나 이상 포함 — 없으면 시드를 바꿔 찾아 고정한다).
7. **정보 격리**: `field/commander.ts`·`field/brain.ts`·`field/orders/*`·`field/ops.ts`·`dispatch/*` 의 원본(주석 줄 제외)에 `.cat`, `heatLoad`, `integ`, `cat.gas` 가 없다. `orders/catastrophe.ts` 는 기존 검사(`tests/ext.test.ts`)도 통과한다.
8. **가짜 연출 없음**: 모든 교대에서 `STRUCT_COLLAPSE` 기록 수 = 무너진 구획 수(전체 붕괴가 한꺼번에 무너뜨린 것은 빼고) + 전체 붕괴 수, `BURNOUT` 은 `cat.burntAt ≥ 0` 인 현장에 정확히 하나(그리고 그 현장은 모두 `c.struct`), X6 가 남긴 폭발 기록(`EXPLOSION` 전부 + detail 이 §4.3·§4.4·§4.5 의 문구인 `HIDDEN_HAZARD`) 수 = 현장마다 `c.gasN + c.vesselN + c.dustN` 의 합. 소품 깃발(`exploded`·`ignited`)로 세지 않는다 — 차단된 뒤 남은 구름이 터지면 밸브가 `ignited` 가 되지 않고, 폭발물(`kind 'bomb'`)도 `exploded` 를 쓴다. 차량 연료 발화(`tickLeaks`)·폭발물은 세지 않는다. **닫힌 뒤 0건**: 모든 X6 기록(`STRUCT_COLLAPSE`·`EXPLOSION`·`BURNOUT`, X6 의 `HIDDEN_HAZARD`)의 시각 ≤ 그 사건의 닫힌 시각.
9. **도시 지도는 그대로**: 붕괴가 일어난 교대 전후로 `sim.city.places` 의 수와 각 건물의 `x, y, w, h, kind` 가 같다. 같은 시드의 새 `Sim` 은 `placeMarks` 가 비어 있다. `collapsed`·`burnt` 인 건물에서는 그 교대에 새 사건이 나지 않는다 — 평소 추첨(`pickPlace`)에서도, `createIncident(sim, { type: 'fire', placeId: 그 건물, rng })` 처럼 건물을 지정해도(그 사건의 `I.truth.placeId` 는 다른 건물이다 — 재난·추격전 은신처의 길). `fire/plane`·`fire/ship`·`fire/wild` 의 터에는 `placeMarks` 가 생기지 않는다.
10. **층 너머**: 2층 건물의 1층에서 반경 6 의 폭발을 일으켜도 2층(빈 공간 너머)의 대원·구조 대상은 다치지 않는다.
11. **`catOf` 의 입구**: 실내 구획이 없는 현장과 가짜 사건 `{ id: 0 }` 으로 `blast` 를 불러도(`tests/destruction.test.ts` 의 모양) 예외가 나지 않고 `catOf` 는 `null`. 같은 현장에서 `catOf` 를 규칙으로 처음 부른 것과 `perceive` 로 처음 부른 것의 용기 `heatK` 가 같다. 누출 차량만 있는 교통사고는 `catOf` 가 `null` 이 아니다(차량 점화).
12. **깔린 대원**: 구획 붕괴로 `a.trapped > 0` 이 된 대원은 같은 틱의 `agentHealth` 에서 `down` 이 되고 `RESPONDER_HURT` '… 쓰러짐 (잔해 깔림)' 이 하나, `causes` 가 그 붕괴 기록이다. 이미 `down` 이던 대원에게는 기록이 더해지지 않는다.

---

## 11. 고칠 파일

### 11.1 자기 파일

| 파일 | 내용 |
|---|---|
| `src/sim/field/catastrophe.ts` | `CAT` 상수, `catRng`, `catOf`, `catTick`, `catOnBlast`, `collapseRegion`, `collapseBuilding`, `explodeGas`, `ruptureVessel`, (선택) 분진·플래시오버, `perceiveSigns`(+ 읽기 함수 `structLevel`·`gasReading`·`vesselLevel`), `propertyLossOf`, `catSummary`, `noteClosedPlace`, `markPlace` |
| `src/sim/field/rules/catastrophe.ts` | `registerRule` 한 개 (§2.3) |
| `src/sim/field/ops.ts` | 지휘 상태 도움 함수 — `opsOf`, `inZone`, `gateBlocks`, `cutOff`, `opsExterior`, `opsCordon`, `inRubble`, `isRubbleMode`, `evacPoint`, `exteriorSpot`(후보 칸 계산은 생김새만 — 불 칸 고르기는 실행기가 진실로), `SIGN_BASE`, 그리고 **생김새 도움 함수** `footprint(s)`(§2.4 의 `foot`, 0~3)·`regionNbrs(s)`(원래 생김새의 이웃 구획) — 둘 다 `WeakMap` 에 처음 한 번(`catOf` 가 첫 틱에 불러 원래 생김새가 들어간다). **진실(`s.cat`·`s.fire`·`s.props`·`s.casualties`)을 읽지 않는다** |
| `src/sim/field/orders/catastrophe.ts` | `DANGER_RULES`, `dangerMap`, 구역·철수·경적·인원 점검·외부 방어·재진입·제한적 구조 진입·잔해 수색·외부 확인 종료·막는 조치·가스 재측정·도시가스 차단 요청·지원 요청·상황 보고, `registerOrders`·`registerGate`·`registerBlocker` |
| `src/sim/world/consequence.ts` | **없을 때만** — I1 §3.10 의 빈 `signal` 과 `SignalKind`(I1-b 가 채운다) |
| `src/view/scene/catLayer.ts` | §7.3 |
| `src/view/city/placeMarkLayer.ts` | §7.2 (G4 가 없을 때만) |
| `src/view/scene/skins/catastrophe.ts` | `CAT_SKINS = { drum }` |
| `tests/catastrophe.test.ts` | §10 |

### 11.2 공용 파일 수정

| 파일 | 함수·자리 | 무엇을 · 왜 | 단계 |
|---|---|---|---|
| `sim/types.ts` | 끝에 추가, 합집합 끝에 새 줄 | §2.2 (`Incident.fieldRisk`, `FieldAgent` 의 `trapEv`·`signObs`·`extSeen` 포함) | 1 |
| `sim/engine.ts` | `Sim` 필드 | `placeMarks` | 1 |
| `field/scenes/index.ts` | import | `../rules/catastrophe`, `../orders/catastrophe` (맨 끝) | 1·5 |
| `field/sceneRegistry.ts` | 끝에 추가 | `WORK_GATES`, `registerGate` | 5 |
| `field/kit.ts` | `PROP_BLANK`, `baseScene` | 새 선택 칸을 `undefined` 로 (객체 모양 — §2.2) | 1 |
| `field/beliefs.ts` | `BeliefStore.merge` | `sign` 이고 들어온 단계가 낮으며 `!down` 이면 바꾸지 않는다 (§3.2 — 한 조각) | 2 |
| `field/hazards.ts` | `tickFire` | `// 가스 용기 폭발 (숨겨진 추가 위험)` 덩어리(4단계)와 `// 붕괴` 덩어리(3단계) 지우기 | 3·4 |
| | `tickGas` | `let dense = 0` 부터 함수 끝까지의 폭발 덩어리 지우기 (`leaking` 계산·연기 쓰기·주변 시민은 그대로) | 4 |
| | `blast` | 사람 반복문에서 빈 공간(VOID) 너머 건너뛰기(`damage.ts` 의 `acrossVoid` 를 export 해서 쓴다), 끝에 `catOnBlast(sim, s, x, y, radius, dmg, cause)`. (H1 이 없으면) 원인 인자 `cause: InjuryCause = 'blast'` 를 X6 가 더하고 `tickCollapse` 의 호출은 `'crush'` (§12.1) | 3 |
| `field/damage.ts` | `acrossVoid` | 이미 있는 비공개 함수 — `export` 만 붙인다. 동작은 그대로 | 3 |
| `field/agents.ts` | `perceive` | 소품 반복문 뒤 `perceiveSigns(…)` 한 줄, 가스 용기 `active:false`(드럼통 문구), 타일 스캔의 `throughWalls` 갈래 끝에 `extSeen` 고치기 (§3.3) | 2 |
| | `IMPORTANT`·`significant`·`flushOutbox` | `sign` (단계 2 이상만 바로) — `flushOutbox` 의 `important` 와 `shown` 두 자리 | 2 |
| | `agentCost` | 지휘 상태 단계 3 구역 칸 −1(예외: `evacuate`·`risky`·업고 있음·지금 구역 안), `a.avoid` 칸 +20 | 5 |
| | `fitFor` | 구역 문 안전망(외부 방수·외부 냉각 예외), `avoid`, `risky`, `'gas'` 소품의 냉각, 가스 재측정(측정기), 깔린 동료 `rescueMate`, `fireRisk` 에 `inRubble`, `extricate` 에도 `inRubble` | 5·6 |
| | `workLabel` | `mitigate` 의 `'gas'` 소품 → `가스 용기 냉각`(드럼 `드럼통 냉각`), 칸만 있는 `mitigate` → `가스 재측정` | 5 |
| | `detectRadius` | `\|\| isRubbleMode(s)` | 6 |
| | (H1 의) `mateFact` | `trapped` 칸 | 3 |
| `field/brain.ts` | `dangerScore` | 곱셈 뒤 `+ signDanger(a)` (믿음만), 물러날 때 `avoid` | 5 |
| | `think` | `boardOrder` 블록 뒤(R2 가드 다음): `if (cur && cur.kind === 'evacuate') return;`, 철수 명령·자기 조짐 3 의무 → `evacuate` | 5 |
| `field/executor.ts` | 새 `case 'evacuate'` | §5.1 | 5 |
| | `case 'suppress'` 첫머리 | `opsExterior` 면 `runExterior` | 5 |
| | `spray` | 인자 `eff = 1, wmul = 1` (applyWater 양 × eff, 물 소모 × wmul) | 5 |
| | `case 'mitigate'` | `'gas'` 소품의 냉각 갈래, 칸만 있는 작업의 가스 재측정 갈래 | 5 |
| | `case 'rescueMate'` | 깔린 동료 먼저 빼내기 | 3 |
| | `case 'carry'`·`escort` | (H1 이 없을 때만) `c.mob === 'trapped'` 분기에 강제 보고 (`learn(…, true, true)`) — H1 §5.1 이 이미 넣는다 | 6 |
| | `case 'mitigate'` 의 이미 끝난 경우 | 냉각 대상 용기가 터졌으면 `reportDone` | 5 |
| `field/commander.ts` | `want`, `syncBoard` 첫 줄·끝 | 문(`gateCmd`·`gateHits`, `WORK_GATES`, 얼린 `GHOST` id −1), 끝에서 `ops.gated` 적고 `gateCmd = null`, 작업 리터럴에 `risky: undefined` | 5 |
| | `cordon` 식, 경찰 요청 사유 | `\|\| opsCordon(s)`, 가스 누출이 아니면 '붕괴·폭발 위험 반경을 통제할 인력이 없음' | 5 |
| | (H1 이 없으면) `outstanding` | 믿음상 쓰러진 동료 수를 남은 일로 세고 'rescue' (§12.1) | 6 |
| `field/sceneManager.ts` | 7번 블록의 한계 시간 식 | `+ Math.min(330, (s.cat?.limitBonus ?? 0) + (s.ops?.limitBonus ?? 0))` | 6 |
| | `agentHealth` 쓰러짐 분기 | 조건에 `\|\| (a.trapped ?? 0) > 0`, 깔린 경우의 이름표·문구·`causes: [a.trapEv]` (§4.8) | 3 |
| | `deliverRadio` | `sign` 이고 `down` 인 사실을 합칠 때 받는 대원의 `signObs` 도 고친다 (§3.5) | 2 |
| | `ROLL_CALL` | `sign: true` | 2 |
| | `unitArrived` 의 대원 리터럴 | `trapped`·`trapEv`·`avoid`·`opsSeen`·`signObs`·`extSeen` 을 `undefined` 로 (객체 모양) | 1 |
| | `briefFacts` | `hazard` 주장 → `sign` 사실 (가스 id 1999) | 5 |
| `sim/events.ts` | 끝에 추가 | `markRecoveredBy(I, code, detail, text)` | 5 |
| `sim/incidents.ts` | `closeIncident` 끝 | `noteClosedPlace(sim, I)` | 7 |
| | `pickPlace` | `collapsed`·`burnt` 건물 빼기 | 7 |
| | `createIncident` | `opts.placeId` 가 `collapsed`·`burnt` 면 지우고 `pickPlace` 로 다시 (재난·은신처의 길, §7.1), 사건 리터럴에 `fieldRisk: undefined` | 5·7 |
| `dispatch/dispatcher.ts` | `fieldReport` | `sitrep` 의 사건 사실 → `I.fieldRisk` 고치고 `assess` | 5 |
| | `briefUpdate` | `hazard` 주제 받기 | 5 |
| `dispatch/analyst.ts` | `assess` 끝 | `I.fieldRisk` 가 있으면 `sev = max(sev, fieldRisk.sev)`, `risks` 합치기 (§5.9) | 5 |
| `sim/debrief.ts` | `PROBLEM_LABEL` | 다섯 줄 (컴파일 — 1단계) | 1 |
| | `order`·`T` | §5.10, §6.6 | 7 |
| | `evaluate` | `propertyLossOf`, `hazardActive`, 한 줄 요약, `catastrophe` 칸, 사망 문장의 원인 | 7 |
| | `buildReport` | `ShiftReport.catastrophe`·`placeMarks`, 요약 문장 | 7 |
| `view/renderScene.ts` | G4 순서의 두 자리 | `drawCatUnder`·`drawCatOver` | 2·5 |
| `view/scene/skins.ts` | `SKINS` | `...CAT_SKINS` | 4 |
| `view/renderCity.ts` | 월드 층 | (G4 없을 때) `drawPlaceMarks` 한 줄 | 7 |
| `view/hazardState.ts`·`view/city/ruinLayer.ts`·`view/marks.ts`·`ui/MapLegend.tsx` | (G4 가 있을 때) | §7.2 | 7 |
| `view/audio.ts`·`view/camera.ts`·(G5) `fxBook.ts` 의 `DECISIVE` 또는 (G5 없으면) `ui/Viewport.tsx` | 효과 종류 | `'horn'` | 7 |
| `sim/types.ts` 의 `FxInfo['src']` (G5 §2 가 `types.ts` 에 둔다) | 합집합 끝 | `'drum' \| 'cng' \| 'jet' \| 'dust'` 새 줄 | 4 |
| `ui/panels.tsx` | `ReportModal` 의 타일 줄 | 전소·붕괴·폭발·철수 | 7 |
| `scripts/sweep.ts` | 집계·출력 | §8.3 | 1·7 |

문서에 없는 곳을 고쳐야 하면 고치되, 끝낼 때 보고에 파일·함수·이유를 적는다.

### 11.3 `CLAUDE.md` 에 들어갈 줄 (합친 뒤에 고친다)

**구조** 절: `src/sim/field/catastrophe.ts 위험의 현실화: 구조 건전도·가스 격자·용기의 열·전소(Scene.cat, 진실), 구획·전체 붕괴, 가스·용기 폭발, 조짐 관찰(perceiveSigns)`, `src/sim/field/ops.ts 지휘 상태(Scene.ops): 진입 금지 구역·철수·외부 방어 — 진실을 읽지 않는다`.

**정보 격리** 목록: 진실을 읽어도 되는 곳에 `field/catastrophe.ts`, 읽으면 안 되는 곳에 `field/ops.ts`.

**함정** 후보:
- **위험은 조짐으로만 안다.** `s.cat`(건전도·가스·열)은 세계 규칙과 `perceive` 만 읽는다. 지휘관·대원의 판단은 `sign` 사실로 한다. 소리(삐걱임 단계 1·임박 단계 3·안전밸브)는 벽을 넘어 거리로 들린다 — 감각의 범위이고 정보 격리 예외가 아니다.
- **구역을 거두기만 하면 작업판이 불어난다.** 진입 금지 구역의 작업은 `registerGate` 로 `want` 에서 막는다(지휘 규칙에서 `cancel` 만 하면 다음 계획 주기에 `syncBoard` 가 새로 만든다).
- **철수한 대원은 `active` 로 둔다.** `withdrawn` 은 다친 대원의 상태다. 철수·외부 방어 중에 `withdrawn` 을 쓰면 7번 블록이 60초 뒤 방치로 닫는다.
- **무너진 뒤의 믿음을 고친다.** 구조물이 무너지면 지휘 규칙이 그 구역의 수색 믿음을 낮추고 안의 구조 대상을 '매몰 추정'으로 바꾼다(지휘 쪽이 덮어쓰는 사실은 `verified: true`·지금 시각 — 아니면 `merge` 가 거부한다). 임무 쪽(`extricate`·`carry`)은 실제와 다르면 강제 보고로 바로잡는다.
- **붕괴는 지형을 바꾼다.** 벽을 바닥으로 바꿀 때는 새 칸을 구역에 넣고(`s.region`·`r.tiles`), `staticVersion++`, 모든 대원과 대피 중인 구조 대상의 `path = null`. 바깥벽은 그루터기를 남기되 출입구는 연다. 계단과 `VOID` 에 맞닿은 층 경계 벽(`foot === 3`)은 남긴다(두 층 사이 4칸).
- **조짐의 단계는 내려가기 어렵다.** `sign` 사실의 낮은 단계는 `down: true`(앞 단계를 알아챌 감각 범위 안에서 사라진 것을 봄)일 때만 믿음을 덮는다(`BeliefStore.merge`). 일부만 본 대원의 보고로 지휘관의 "임박"이 풀리지 않게 하는 것이다. 단계를 낮추는 사실(무너짐·폭발·냉각 완료)을 새로 만들면 `down: true` 를 붙인다.
- **`want` 가 빈 작업을 돌려줄 수 있다.** 진입 금지 구역의 문이 막으면 `want` 는 얼린 `GHOST`(`id −1`)를 돌려준다. 돌려받은 작업을 고치는 코드는 `if (w.id >= 0)` 으로 감싼다.
- **철수 경적은 무전이 아니다.** 철수 명령의 `ops` 사실은 무전과 함께 경적으로 현장의 `active` 대원 모두에게 간다(음영과 무관). 지휘관이 음영에 있어 무전이 나가지 않으면(`transmit` 이 −1) 명령 자체를 다음 주기로 미룬다.

**자주 하는 확장** 표에 한 줄: `새 폭발하는 것·무너지는 것 | catastrophe.ts 의 용기 표(VESSEL_HEAT·ruptureVessel)나 손실 항(loss) → 조짐 표(§3.1)·perceiveSigns → orders/catastrophe.ts 의 DANGER_RULES → debrief 문장 → 확인은 sweep --force 와 방치 시험`.

---

## 12. 알려진 위험과 결정 사항

### 12.1 결정 사항 (조사에서 열려 있던 질문)

| 질문 | 결정 | 이유 |
|---|---|---|
| 위험 수치를 새 필드로 둘까, 흩어진 값에서 매번 계산할까 | `Scene.cat` 에 둔다(구획 건전도·가스 격자·용기 열). 탄 비율·균열 진행도는 지금 값을 그대로 쓴다 | 건전도에는 "누적"(열·충격·여진)이 필요하고, 가스는 연기와 섞이면 판정이 틀린다(§1.2). 세계 규칙과 `perceive` 만 읽는다 |
| 전소 → 붕괴의 기준, 지금의 천장 붕괴를 남길까 | 탄 몫이 건전도 상한을 내린다(`1 − 탄 몫`). 지금의 천장 붕괴(55%·55%, `s.rng`)는 **지우고** 구획 붕괴가 대신한다. 새 흐름 `cat:` | 같은 현상을 두 규칙이 내면 설명할 수 없다. 빈도는 기준선 ±30% 로 맞춘다(§8.1) |
| 건물 붕괴를 30×20 격자에서 어떻게 | 안쪽 벽 전부·바깥벽 55% → 잔해 바닥, 출입구는 열고, 계단과 층 경계 벽(`VOID` 와 맞닿은 벽)은 남겨 위층 잔해로 오르는 길로. 구역은 지우지 않고 새 바닥을 가장 작은 번호의 이웃 구역에 넣는다. 사람이 선 칸에는 잔해 소품을 놓지 않는다(깔림은 사람의 상태로). 잔해는 성기게(심각도 3 에서 약 19%), 출입구에서 가운데로 가는 통로는 비운다 | 끊기는 칸이 생길 수 없고(§4.2), 수색·구출의 지금 규칙이 그대로 돈다. 두 층 사이 4칸 전제를 지킨다. 위층을 1층에 포개는 방식은 사람·불·연기를 옮겨야 해서 버렸다 |
| 철수 상태와 7번 블록, 새 종료 이유 | 대원은 `active`(대피·대기·외부 방수). 한계 시간 보탬(합 330초). 새 종료 이유는 만들지 않는다 | 방치 종료의 뜻("현장에 아무도 없다")을 지킨다 |
| 조짐을 어떤 사실로 | 새 `FactType 'sign'`(값 `SignBelief`) + 지휘 상태 `'ops'`. 단계는 난수 없이 **고정 문턱**으로(판단력은 알아채는 거리에만). 하향은 확인된 것(`down`)만 믿음을 덮는다. 소리는 벽을 넘는다 | `haz` 의 `active` 두 값으로는 단계를 담을 수 없고, `haz` 의 뜻을 바꾸면 지금 규칙이 흔들린다. `perceive` 에 `a.rng` 를 쓰면 판단 오차 흐름이 바뀐다. 문턱을 대원마다 달리하면 무전으로 공유된 믿음이 깜박인다(§3.1) |
| 단계 3 조짐을 대원이 스스로 들으면 | 점수가 아니라 의무(`evacuate`) — 철수 명령과 같은 자리 | 점수로 더하면 침착함 곱셈·판단 오차 때문에 진압·운반 중인 대원이 물러날지가 동전 던지기가 된다(§5.1) |
| 단계 3 구역 칸을 지나가는가 | 지나갈 수 없다(−1). 철수·제한적 진입·운반 중·지금 그 안에 선 대원만 예외. 그 너머의 일은 문이 막는다(`cutOff`) | +20 만 주면 구역 밖의 일로 가는 경로가 구역을 지나가 철수 의무와 왕복한다 |
| 경계 1칸 안의 갇힘 흐름 | X6 의 `cat:` 흐름(H1 §5.1 과 같은 수치) | H1 의 `injuryRng(…, 'trap')` 을 나눠 쓰면 2차 붕괴 갇힘의 결과가 밀린다(H1 §2.7) |
| 깔린 대원의 상태 전이 | `agentHealth` 한 곳(H1 §3.2). X6 는 `trapped`·`trapEv` 만 | 전이와 문구를 두 곳에서 하면 겹치거나 어긋난다 |
| 폭발이 벽·층을 넘는가 | 층(빈 공간 너머)은 사람에게 막는다(`blast` 에 검사 — 지금 반경(≤ 3.8)으로는 층 사이 5칸을 넘지 못하므로 기존 결과는 그대로). 벽 감쇠는 넣지 않는다 | X6 의 폭발은 반경 6 까지 커지므로 층 검사가 필요하다. 벽 감쇠는 기존 폭발물·가스 결과를 모두 바꾼다 |
| 피해 모델 | H1 의 `hurt*`. 대원은 한 번에 숨지지 않는다(H1 문턱). 깔린 대원(`trapped`)은 X6 가 더한다 | H1 과 같은 길로만 피해를 준다 |
| 재산 피해 | `propertyLossOf` — 전소·전체 붕괴 1.0, 그 밖은 탄 비율·무너진 비율·폭발의 최댓값. 화재에서 X6 일이 없으면 지금 식과 같다 | 붕괴·폭발이 재산 피해에 들어가야 보고서가 맞다 |
| 지도의 건물 상태 | `Sim.placeMarks`(교대마다 새로), 실제 건물(`c.struct`)만. 그 건물에서는 그 교대에 새 사건을 내지 않는다(`collapsed`·`burnt` — `pickPlace` 와 `createIncident` 의 지정 건물 둘 다) | `city.places` 는 교대 사이에 공유되는 모듈 상태다. 활주로·부두·숲에 '전소'가 남으면 안 된다. 재난·은신처는 `pickPlace` 를 거치지 않는다 |
| 구역이 오래 남아 교착할 때 | 단계 2 구역은 180초 상한, 건물 단계 3 은 "구조 안정" 줄(90초), 제한적 진입은 90초 간격으로 3번까지, 인원 점검은 시한(70초), 외부 방수는 두 번 실패하면 거둔다 | 모든 사건은 끝나야 한다(CLAUDE.md 규칙 6). 구역마다 풀리는 길이 하나 이상 있어야 한다 |
| 가스 용기·차량의 열 발화, 냉각 | 용기는 열이 쌓여야 터진다(지금은 닿으면 즉시). 냉각 = `mitigate` 의 갈래(새 임무 종류 없음). 보통 승용차의 연료 탱크는 터지지 않는다(CNG 버스·항공유만) | 임무 종류를 늘리지 않고 지금의 지휘·배정 틀을 쓴다. 휘발유 탱크는 압력 용기가 아니다 |
| 누출 가스 폭발의 점화원 | 넣는다(불·충격은 확정, 스파크는 확률). 지금의 `s.rng` 판정은 지운다 | 사용자 요청의 "점화원". `tests/sim.test.ts` 의 "차단 > 발화" 를 지키도록 맞춘다(§8.4-4) |
| 여진 | `disaster.ts` 의 `p.leak` 올리기는 그대로 두고, X6 규칙이 흔들림 기록(`shakes`)을 읽어 건전도를 깎는다 | 재난 파일을 고치지 않는다. 진실 변경이 두 곳으로 나뉘는 것은 이미 있는 구조다 |
| `brain.dangerScore` 의 `s.fire` 직접 읽기 | 그대로 둔다("자기 둘레를 느끼는 몸의 감각" — R2 의 `Sense` 와 같은 자격). X6 의 조짐은 **믿음으로만** 더한다 | 예외를 늘리지 않는다. T2(예외 제거)에서 함께 다룬다 |
| 관제 위험 문자열을 현장에 | 넘긴다(`briefFacts`·`briefUpdate` → 미확인 `sign`) | 신고에서 안 위험이 지휘관의 주의로 이어져야 한다 |
| "굉음은 들리지만 무엇인지 모른다" | 나누지 않는다(사건 소리는 무엇인지까지 안다) | 현장에서 붕괴·폭발은 곧바로 무선으로 확인된다고 본다 |
| R1·H1 이 먼저 합쳐지지 않았으면 | 측정기·열화상은 §3.4 의 대체. 피해는 지금처럼 `health` 를 깎고(`c.causeEvent`, `a.lastBlockEvent` 에 원인), 대원은 체력 1 아래로 내려가지 않는다(순직 없음 — 보고서의 순직 문장은 H1 몫). 깔린 대원은 그대로 넣되, H1 이 하던 일 셋을 X6 가 직접 더한다: ① **7번 블록의 `outstanding()`**(`commander.ts`)에 믿음상 쓰러진 동료(`mate` 사실 `status 'down'`) 수를 남은 일로 세고, 있으면 'rescue'(지금 7번 블록의 추가 부대 요청 길 — H1 의 7번 블록 `mates` 규칙과 같게). 없으면 전체 붕괴로 현장 대원이 모두 쓰러지거나 깔렸을 때 불·환자 믿음이 없으면 `resolved` 로 닫히고, 5번 블록이 깔린 대원과 함께 부대를 철수시킨다. ② **`blast` 의 원인 인자** `cause: InjuryCause = 'blast'`(H1 의 `InjuryCause` 가 없으면 `'blast' \| 'crush'` 두 값의 지역 타입)를 X6 가 더하고 `tickCollapse` 의 호출에 `'crush'` 를 넘긴다 — `catOnBlast` 의 `K_HIT` 구분이 이것을 읽는다. ③ `carry`·`escort` 의 갇힌 대상 강제 보고(§6.1). 깔린 대원의 쓰러짐은 지금의 `agentHealth` 쓰러짐 분기에 같은 조각(§4.8)을 넣는다 | 순서가 바뀌어도 X6 를 끝낼 수 있게 |

### 12.2 알려진 위험

1. **화재 결과가 바뀐다** — 천장 붕괴와 가스 용기 규칙을 대체하고, 외부 방어가 생기면 전소가 늘 수 있다. B1 이 맞춘 화재 성공률(62~84%)을 지키도록 §8.4 의 순서로 맞춘다. B1 이 아직 균형을 잡는 중이면 X6 는 B1 뒤에 잰다.
2. **`s.rng` 순서** — 지우는 두 판정 때문에 그 현장들의 이후 `s.rng` 결과(용의자·통과 차량·주변 시민)가 달라진다. 의도된 변화이지만, 분포 비교에서 "X6 일이 없었던 사건"도 조금 움직일 수 있다는 것을 보고에 적는다.
3. **교착** — 진입 금지 구역이 풀리지 않으면 한계 시간까지 간다. 구역마다 풀리는 길을 두었다(§5.7: 무너짐·폭발·측정·원천 차단·외부 확인·단계 2 의 180초 상한·건물의 "구조 안정" 줄, §5.4 인원 점검 시한, §5.6 되풀이할 수 있는 제한적 진입, §5.5 외부 방수 실패 거두기). 문이 막은 일(`ops.gated`)이 종료를 막으므로(§6.2) 구역이 오래 남으면 그만큼 사건도 늦게 끝난다. 시험 §10-5 와 `--force` 20교대의 한계 시간 건수로 지킨다. 오래 남는 구역이 보이면 `--log` 로 읽고 그 구역의 재진입 조건을 고친다.
4. **철수 명령을 못 들은 대원** — 음영 구역(화재 현장의 60%)의 대원은 무전을 못 듣지만, 철수 명령은 공기 경적으로도 간다(§5.4-3 — 28칸 안의 `active` 대원 모두, 음영과 무관). 남는 위험은 지휘관 자신이 음영에 있어 명령이 늦어지는 것(다음 주기로 미룬다)과 이미 쓰러진 대원이다. `shareNearby` 는 나누는 사람의 보고 대기열만 넘기므로(`agents.ts`) 무전으로 받은 사실을 곁의 동료에게 퍼뜨리지 않는다 — 그 길에 기대지 않는다. 대원 피해가 목표(§8.1)를 넘으면 단계 3 소리 범위와 `FALL_GRACE` 를 늘린다.
5. **무전이 넘친다** — 붕괴 현장은 균열이 진행되면 오래 삐걱인다. 단계 1 은 묶음 보고로만 보내고(§3.2), 같은 단계는 다시 보고하지 않는다. 기록이 넘치면 단계 1 을 `learnQuiet` 로 바꾼다.
6. **외부 방수의 자리 찾기 비용** — 구역마다 처음 한 번 후보를 계산해 둔다. 지형이 바뀌면(`staticVersion`) 다시. P1(헤드리스 속도) 이후의 시간 예산을 넘으면 후보 수를 줄인다(가까운 바깥 칸 40개).
7. **가스 격자 비용** — 밸브가 있는 현장만, 가스가 거의 없으면 건너뛴다. 매초 600칸 두 번(확산·손실).
8. **판정 분포** — 화재가 아닌 유형의 탄 비율이 재산 피해에 들어가면서 가스 폭발 현장의 판정이 무거워진다. 그것은 의도다. 범위를 벗어나면 `무너진 비율 × 1.2` 의 배율부터 낮춘다.
9. **H1·G4·G5·R2 와 같은 줄** — `blast`(H1 원인 인자, G4 기록), `tickFire`(G4 기록 — X6 가 그 덩어리를 지우므로 G4 의 천장 붕괴 기록 줄은 X6 의 `collapseRegion` 으로 옮겨 간다), `agentHealth`(H1 의 전이 — X6 는 쓰러짐 조건에 한 조각), `suppress`·`spray`(R2), `renderScene` 순서(G4·H1·R2). 합칠 때 양쪽을 살린다. **G4 가 먼저면** G4 §3.3 의 `tickFire` 천장 붕괴 기록(`markRuin(RUIN_CEILING)`·`recordFall('ceiling')`)이 덩어리와 함께 사라지므로, `collapseRegion` 이 불로 무너질 때 `recordFall(…, 'ceiling')` 을 쓰게 한다(장부의 가장 큰 항이 FIRE·BURN 이면 `'ceiling'`, 그 밖은 `'partial'` — §7.5 와 같은 결정).
10. **장면의 시각이 바뀐다** — §9 의 시드는 이 문서를 쓸 때 잰 것이 아니다. 강제 시나리오와 심각도 5 로 찾는다.
11. **"외부 확인 종료"가 틀릴 수 있다** — 안에 남은 불·사람을 놓친 채 닫힐 수 있고, 판정이 그대로 드러낸다(위험이 남음·미발견). 너무 잦으면 조건의 60초를 늘린다.
12. **CNG·항공유 폭발이 교통·대형 사고를 어렵게 만든다** — `traffic/bus`·`fire/plane` 을 따로 잰다. 넘치면 `VESSEL_HEAT` 의 cng·jet 을 낮춘다. (`traffic/train` 의 객차와 동체 기수·꼬리는 용기가 아니다 — §2.6.)
13. **화재 현장의 구획은 다시 튼튼해지지 않는다** — 탄 몫 상한(`1 − 탄 몫`) 때문에 64% 넘게 탄 방은 불을 꺼도 단계 3 으로 남고, 확률적인 붕괴(초당 1% 이상, 평균 100초 안)가 날 때까지 진입 금지다. 그동안 잔불 정리·수색과 종료가 늦어진다. `--force fire/std` 20교대와 `sweep 60` 의 한계 시간 건수로 지켜본다. 너무 늦으면 `FALL_BASE` 를 올려 빨리 무너지게 하거나(대개 그 방은 이미 비어 있다), `K_BURN` 을 낮춘다.
14. **가스 구름은 오래 남고 AI 에게 환기 행동이 없다(R2 전)** — 구름(N ≥ 10)이 생기면 스파크가 다 커진 뒤 초당 1.2% 라 300초 안에 약 97% 가 터진다. 밸브를 차단해도 실내 가스는 초당 0.4% 만 줄어(반감기 약 173초) 구름이 오래 남는다. 부대가 닿기 전에 구름이 먼저 찰 수 있어 `hazmat/std` 의 5~15% 목표를 크게 넘을 수 있다. 그래서 스파크를 구름이 생긴 뒤의 시간에 묶었다(`SPARK_AGE` 90초, §2.5). 그래도 넘치면 ① `GAS_SRC` 를 낮추고, ② (선택) 환기 갈래를 넣는다 — 밸브를 차단했고 가스 단계 2 이상인 구역의 바깥 출입문에 `want('mitigate', { tile: 그 문 칸 }, 0.8)` '환기', 실행은 그 문을 열어 둔다(§2.5 의 "열린 바깥 출입문" 환기 항이 받는다). R2 의 `ventFirst`·`ventilate` 가 합쳐지면 R2 의 것으로 바꾼다.
15. **드럼통이 신고 진술을 바꾼다** — 드럼통은 `kind 'gas'` 라 공업 화재의 신고자가 '가스통 같은 게 있어요'라고 말할 수 있고 그 통화의 난수 경로가 바뀐다(§4.4). 위험한 용기를 말하는 것은 맞는 동작이라 받아들인다(4단계의 결과 변화).
16. **AI 쪽의 `s.rng`·`a.rng`** — 외부 방수·냉각의 `spray` 와 `evacuate` 의 이동이 그 현장·대원의 난수 순서를 바꾼다(§2.8). 5단계의 결과 변화에 포함된다.

### 12.3 확인 필요 목록

- (검토에서 확인됨) `commander.want` 의 돌려준 값은 `commander.ts`·`orders/*` 어디서도 쓰지 않는다 — `GHOST` 를 돌려줘도 된다. 새로 돌려받은 값을 고치는 코드(§5.6)는 `w.id >= 0` 으로 감싼다.
- (검토에서 확인됨) `findRoute(city, from, to, weatherF, avoidEdge, heavy)` — 인자 순서가 맞다(`city.ts`). X6 는 여섯째 인자 `heavy = true` 로 큰 차 기준 우회로를 본다.
- (검토에서 확인됨) `acrossVoid` 는 이미 `damage.ts` 의 비공개 함수다 — `export` 만 붙인다. G5 의 `FxInfo` 는 G5 §2 대로 `types.ts` 에 있다.
- B1 이 합쳐진 뒤의 `syncBoard` 에 잔불 정리(`overhaul`)를 내는 자리 — `want` 를 거치면 문(`registerGate`)이 막는다. 거치지 않는 자리가 있으면 그 자리에 같은 판정을 넣는다.
- R1 의 장비 표에 펌프차 팀장(`fireLead`)의 가스 측정기를 더할지 — 더하면 가스 누출 현장의 조짐이 빨라진다(§3.4). R1 문서의 역할 표는 X6 가 고치지 않고, 합칠 때 R1 담당과 정한다.
- G4 의 `FallRecord`(`'zone' | 'secondary' | 'ceiling'`)·`RUIN_WALL`(1)·`RUIN_SECONDARY`(8)·`RUIN_CEILING`(9)·`RUIN_FURN`(16)·`recordFall(sim, s, x, y, r, cause, fx?)` — G4 문서의 이름을 그대로 썼다. X6 는 `'partial'`·`'total'` 과 `RUIN_TOTAL = 10` 을 더한다.
- G5 가 실제로 구현한 `FxInfo['src']` 의 합집합과 `noteBoom`·`DECISIVE` 의 이름(설계서 `G5-combat-fx.md` 의 이름을 따랐다 — G5 는 이번 세션에 먼저 구현된다).
- I2 는 이 문서의 이름(`Sim.placeMarks`·`PlaceMark`·`catOf`)을 이미 쓴다(I2 연관 표). `s.wear` 는 I2 의 칸이다. I1 은 `signal(sim, 'catastrophe', …)` 한 줄과 빈 `world/consequence.ts` 를 요청하고 `placeMarks` 를 `sim.world` 로 옮기지 않는다고 정했다(I1 §3.10·연관 표) — 이 문서가 그대로 따른다.
- 가스 상수(`GAS_SRC`·`D`)와 구조 상수는 방치 시험으로 정하는 시작값이다(§2.4·§2.5 의 "맞출 값").
- 손으로 만든 현장(`scenes/crime.ts` 의 무장 장소, `scenes/major.ts`)에서 대기 지점·안전 구역이 건물 칸에서 2칸 넘게 떨어져 있는가 — 평면 생성기(`plans.ts`)의 건물은 대기 지점 (3, 17)·안전 구역 (3, 14) 과 충분히 떨어져 있다(바닥 `y1 ≤ 13`, 단층 건물 `x0 ≥ 6`). 손으로 만든 현장은 `evacPoint` 가 도로 줄로 물러나게 되어 있지만 확인한다.

---

## 구현 메모

(구현한 뒤 이 절에 설계와 달라진 점, 조정한 상수, 잰 값을 적는다. 이 절이 실제 코드와 맞는 최신 내용이 된다.)

---

## 검토 메모

독립 검토 두 갈래(실현성·규칙 / 빠진 것)를 받아 고쳤다. 반영한 것은 본문에 녹였고, 여기에는 **반영하지 않았거나 다르게 반영한 것과 그 이유**만 적는다.

- **R2 의 `shore` 가 균열을 `mitigated` 로 만들지 않는다는 지적**(빠진 것 갈래): 검토 뒤 고쳐진 `R2-methods.md` 는 `shore` 가 끝나면 "그 균열을 직접 보강한다 — `p.mitigated = true`"(R2 §4.3)로 바뀌었다. 그래서 X6 의 보강 반영(`c.shored`)을 바꾸지 않고 연관 표에 그 근거만 적었다. `s.fan` 은 지적대로 R2 가 합쳐질 때 R2 가 한 줄 더하는 것으로 옮겼다(R2 §10 의 X6 줄과 같은 나눔).
- **단계 3 구역 칸을 지나갈 수 없게(−1)**: 받아들이되, 검토의 예외(철수·제한적 진입·운반 중)에 **"지금 그 구역 안에 선 대원"**을 더했다. 이것이 없으면 음영 등으로 명령이 늦은 대원이 구역 안에서 갇혀 `nopath` 를 되풀이한다.
- **복도를 "이웃 구역"에서 뺄지**: 뺐다(조짐이 난 구역 자신이 복도일 때만 넣는다). 복도가 구역이 되면 층 전체가 막히고 `cutOff` 가 대부분의 방을 끊는다.
- **판단력 보정**: 문턱에서 없애고 거리에만 남겼다. 그래서 "판단력 보정의 방향(구조는 올리고 가스·용기는 내린다)을 적어라"는 지적은 해당이 없어졌다. 열화상의 문턱(0.7·0.5)은 장비가 문턱을 바꾸는 유일한 예외로 남겼다 — 깜박임은 `merge` 의 하향 규칙(`down`)이 막는다.
- **가스 조짐의 구획**: "최댓값 칸의 구획"으로 정하라는 제안 대신, 측정 자체를 **구획 하나에 값 하나**(그 구획 칸의 최댓값, 구획 안이나 문턱에서 읽는다)로 바꿨다. 같은 구획을 대원마다 다르게 읽는 문제(실현성 갈래)를 함께 없앤다.
- **건물 단계 3 의 해제**: 두 대안(문턱 맞추기 / "구조 안정" 줄)을 **둘 다** 넣었다. 문턱을 맞추면 진실에서는 끝내 무너지지만, 지휘관의 믿음이 낡아 단계 3 이 남는 경우를 위해 해제 줄도 둔다. 제한적 진입은 90초 간격 3번까지로 되풀이할 수 있게 했다.
- **같은 건물의 재발**(재난·은신처의 `opts.placeId`): 시험을 좁히는 대신 `createIncident` 한 줄로 막았다. 대가로 재난의 위치 뜻(진앙 근처)과 은신처 위치를 그 드문 경우에 잃는다 — `disaster.ts`·`pursuit.ts` 를 고치지 않는 조건에서 가장 작은 변경이다.
- **스파크·환기 균형 경고**: 스파크를 구름의 나이에 묶는 것(`SPARK_AGE`)만 본문 규칙으로 넣고, 환기 갈래는 **선택**으로 §12.2-14 에 적었다. 환기 방법은 R2 의 `ventFirst`·`ventilate` 몫이고, 측정 없이 새 지휘 행동을 늘리지 않는다. 방치 시험(§8.3)에서 넘치면 그때 켠다.
- **붕괴 현장이 처음부터 삐걱인다는 문구와 처음 값(0.60~0.70)의 어긋남**: 처음 값을 낮추지 않고 문구를 고쳤다. 처음 값을 0.6 아래로 내리면 균열의 서서히 깎임으로 단계 3 까지의 시간이 반으로 줄어 붕괴 현장의 균형(§8.1 의 3~12%)이 크게 흔들린다.
- **`bldg` 단계 1**(신고 내용): 지휘 쪽 위험 단계를 0(기록만)으로 정했다. 1 로 두면 붕괴 신고가 있는 모든 현장에서 구역마다 동시 진입 2명 제한이 걸려 붕괴 현장 결과가 바뀐다.
- **잔해 구출의 분야 제한**: `extricate` 에도 `inRubble` 조건을 붙여 화재·무장 현장의 잔해 구출도 소방·구조만 하게 정했다(검토는 "정하라"였다).
- **경계 1칸의 갇힘**: H1 연관 표의 문구(`injuryRng(…, 'trap')`)와 다르게 X6 의 `cat:` 흐름을 쓰기로 했다. H1 문서는 이 묶음이 고치지 않으므로, X6 연관 표에 "이 문서의 결정으로 읽는다"고 적었다(H1 §2.7·원칙 11 이 금지한 흐름 나눠 쓰기를 피하는 쪽이 H1 의 뜻에 맞다).
- **숫자를 직접 재지 않았다**: 다른 작업이 CPU 를 쓰고 있어 이번 검토 반영에서는 sweep·테스트를 돌리지 않았다. 새로 정한 수치(잔해 밀도 `0.10 + 0.03 × sev`, 경적 반경 28칸, 단계 2 구역 상한 180초, 인원 점검 시한 70초, `SPARK_AGE` 90초, "구조 안정" 90초)는 모두 시작값이다 — 8단계(§8.4)에서 맞춘다. 검토가 쓴 장면 열거·구역 겹침·2층 `foot` 분류 스크립트는 저장소 밖(검토 세션의 scratchpad)에 있다.
