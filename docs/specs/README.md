# 묶음별 구현 설계서 — 공통 규칙

이 폴더의 문서는 **여러 작업자가 동시에** 일해도 서로 꼬이지 않도록 쓴 구현 지시서다. 한 문서 = 한 묶음 = 한 작업자(한 브랜치).
전체 방향은 `docs/DESIGN.md`, 저장소의 규칙과 함정은 `CLAUDE.md`. 여기 적힌 것과 `DESIGN.md` 가 다르면 **이 폴더가 최신**이다.

| 문서 | 묶음 | 브랜치 | 한 줄 요약 |
|---|---|---|---|
| `M1-map.md` | 지도 | (주 작업 폴더) | 블록 안의 이면 도로, 겹침 보장 |
| `N4b-crime.md` | 강력 범죄 | `wf/crime` | 폭발물(+해체), 대형 인질극, 도주 차량·은신처, 폭동, 연쇄 방화 |
| `N5-major.md` | 대형 사고 | `wf/major` | 비행기 추락, 열차 탈선, 다중 추돌, 가스 폭발, 크레인 붕괴, 선박 화재 |
| `N6-disaster.md` | 재난 | `wf/disaster` | 태풍, 홍수, 지진, 산불, 해일 (+ 산사태) |
| `N7-destruction.md` | 현장 파손 | `wf/destruction` | 총격·폭발에 창문과 가구가 부서진다 |
| `T1-traffic.md` | 교통 | `wf/traffic` | 정체가 뒤로 밀림, 가 보아야 아는 장애물(낙하물·불법 주차), 건널목과 열차, 교통 손잡이 |
| `U1-ui.md` | 화면 | `wf/ui` | 부대·시설 표식을 글자 대신 그림 기호로, 범례, 화면 전체 다듬기 |

합치는 순서: M1 → N7 → N4b → N5 → N6 → T1 → U1. **일곱 묶음 모두 구현돼 합쳐졌다(2026-11-14).** 아래의 규칙은 다음에 묶음을 더할 때 그대로 쓴다. 각 설계서 끝의 구현 메모가 실제 코드와 맞는 최신 내용이다.

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
5. 보고(마지막 응답): 브랜치 이름과 마지막 커밋, 구현한 것 / 못 한 것, 시나리오별 결과 표, 고친 공용 파일(파일·함수·이유), 알려진 문제.
