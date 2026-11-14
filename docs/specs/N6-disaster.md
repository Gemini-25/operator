# N6 — 재난

공통 규칙은 `docs/specs/README.md`. 브랜치 `wf/disaster`, 개발 서버 포트 **5203**.

**자기 파일**: `src/sim/disaster.ts`, `src/sim/scenarios/disaster.ts`, `src/sim/field/scenes/disaster.ts`, `src/sim/field/rules/disaster.ts`, `src/sim/field/orders/disaster.ts`, `src/view/city/disasterLayer.ts`, `src/view/scene/skins/disaster.ts`, `src/ui/DisasterBanner.tsx`, `tests/disaster.test.ts`. CSS 는 `styles.css` 끝의 `/* ── disaster ── */` 블록.

## 원칙

재난은 **도시의 상태를 바꾸고, 지금 있는 사건들을 한꺼번에 여러 곳에 일으키는 것**이다. 관제·지휘·대원의 코드는 재난을 따로 알지 못한다 — 사건 하나하나는 평소와 같은 규칙으로 처리된다. 그래서 대부분은 `createIncident(sim, { type, variant, placeId | nodeId, tag: 'disaster:' + kind, rng: d.rng })` 한 줄로 끝난다.

- 재난이 없는 교대(`sim.disaster === null`)의 결과는 **한 글자도 달라지면 안 된다**(테스트: 같은 시드의 `report.hash` 를 `disaster: 'none'` 과 미지정으로 비교).
- 모든 난수는 `d.rng`(`sim.rng.fork('disaster')`).
- 다른 묶음의 시나리오는 있으면 쓰고 없으면 대신할 것을 쓴다: `const has = (t, v) => !!scenarioOf(t, v)`.

## 이미 들어가 있는 틀

- 선택: `Difficulty.disaster`(`none` 기본 · `random` · 다섯 종류). 화면의 난이도 창에 선택 줄, 주소 `?disaster=typhoon`, `sweep --disaster typhoon`, 난이도 이름에 "· 재난 태풍". 화면의 기본값은 `random`, 헤드리스의 기본값은 `none`.
- `disaster.ts`: `DisasterState`(자료형), `initDisaster`(선택·무작위 추첨까지 됨 — `plan()` 이 `null` 을 돌려주는 빈 틀), `tickDisaster`(엔진이 `tickIncidents` 앞에서 부른다), `disasterGapMul`(충격·예고 동안 평소 사건 간격 ×1.6), `disasterSummary`(보고서). `DisasterState` 에 칸이 더 필요하면 **이 파일 안에서** 더한다.
- `sim.disaster.speedMul` 은 `city.weatherSpeedFactor` 가 곱한다(긴급 차량 속도).
- 그림 자리: `disasterLayer.ts` 의 `drawDisasterWorld`(지도, 월드 좌표)·`drawDisasterScreen`(지도, 화면 좌표)·`drawDisasterScene`(현장) — 이미 불리고 있다. `DisasterBanner` 는 `App` 에 꽂혀 있다. 보고서 창은 `report.disaster` 가 있으면 그린다.

## 공통 뼈대 (`disaster.ts`)

```ts
function plan(sim, kind, rng): DisasterState      // 종류별 일정: tWarn, tImpact, tEnd (아래 표). phase = 'calm' 으로 시작
export function tickDisaster(sim): void           // 단계 전환(기록 남김) → 종류별 tick → intensity 갱신
function spawn(sim, d, opts: SpawnOpts): Incident | null   // 상한·동시 진행 수를 보고 createIncident. d.spawned 에 id, d.log 에 한 줄
function closeEdge(sim, d, e, why: string): boolean         // 우회로가 있을 때만(findRoute(city, e.a, e.b, 1, e.id)) 통제. closedReason = 'disaster'. d.closedEdges 에 넣는다
function reopenEdges(sim, d, pred?): void                    // closedReason === 'disaster' 인 것만 연다 (사건이 통제한 구간은 건드리지 않는다)
```

- 단계: `calm` →(tWarn) `warning` →(tImpact) `impact` →(tEnd) `aftermath` →(tEnd + 120) `over`. 전환마다 `emit({ role: 'SYSTEM', actor: '재난안전본부'(기상 특보는 '기상청'), kind: 'hazard', imp: 3, text })`.
- `spawn` 의 상한: 진행 중인 사건이 `tune.maxConcurrent + 4` 이상이면 그 차례를 건너뛴다(기록하지 않는다). 재난 하나가 일으키는 사건 수의 상한은 아래 표.
- 교대 끝(`sim.t >= sim.shiftLen`)에는 새 사건을 일으키지 않는다. `over` 로 넘어갈 때 `reopenEdges` 로 전부 연다. **교대가 끝났을 때 `closedReason === 'disaster'` 인 구간이 남아 있으면 안 된다**(테스트).
- 다리: 강 서쪽이 고립되지 않게 **모든 다리를 동시에 닫지 않는다**(`closeEdge` 의 우회로 검사가 막아 준다 — 검사를 빼지 않는다).
- 건물·교차로 고르기 도우미: 강까지의 거리 `riverDist(x, y)`, 바닷가 `coastY(x) - y`, 산 `mountainAt(x, y)`(모두 `city.ts` 에 export 되어 있다. `city.ts` 는 고치지 않는다). 건물은 `sim.city.places`(`kind`, 가운데 = `x + w/2, y + h/2`, `facility < 0` 인 것만), 사건이 진행 중인 건물·교차로는 피한다.

## 종류별

교대 길이 L = `sim.shiftLen`(1200초).

| | 일정 | 일어나는 일 | 상한 |
|---|---|---|---|
| **태풍** `typhoon` | 특보 L×[0.10, 0.18] → 90~120초 뒤 충격 → 충격 420초 | `speedMul = 0.85`. 충격 동안 14~22초마다 하나: 쓰러진 나무 `traffic/tree`(아무 교차로, 35%) · 간판·지붕 낙하 `medical/trauma`(상점·식당·시장, 15%) · 지붕 파손 `collapse/std` 위험도 1(주택·빌라, 12%) · 강변·부두 침수 `water/std`(강변·부두·해수욕장, 18%) · 교통사고 `traffic/std`(10%) · 산사태 `collapse/landslide`(한 번만, 10%). 세기가 가장 높을 때 120초 동안 정전(`d.dark`): 모든 구간 `e.bump = (e.bump ?? 0) + 0.4`(끝나면 같은 값을 뺀다 — `cong` 을 직접 고치지 않는다. 교통 모델이 `bump` 를 더해 `cong` 을 정한다) | 16 |
| **홍수** `flood` | 경보 L×[0.12, 0.2] → 60초 뒤부터 수위 `d.level` 이 300초에 걸쳐 0→1, 120초 유지, 이후 서서히 0.3 까지 | 구간마다 문턱 = (구간 가운데의 `riverDist`) ÷ 80. `level` 이 문턱의 0.7 을 넘으면 `slow += 0.8`, 문턱을 넘으면 `closeEdge`. 수위가 내려가면 거꾸로 연다. 다리는 `level ≥ 0.9` 에서. 25~40초마다 하나: 강가의 수난 구조 `water/std`(강변 터, 강에서 90 안의 건물 → 강변 터가 없으면 그 건물의 `placeId` 로), 침수 차량 `traffic/std`(강에서 120 안의 교차로), 지하 가스 누출 `hazmat/std` 한 번, 산사태 한 번 | 12 |
| **지진** `quake` | 예고 없음. L×[0.2, 0.5] 에 충격 | 25초에 걸쳐 쏟아진다: 붕괴 `collapse/std` 3~4(위험도 2~3) + 가스 폭발 `collapse/gasblast` 1(없으면 붕괴 하나 더) + 화재 `fire/std` 2 + 가스 누출 `hazmat/std` 2 + 승강기 `collapse/elevator` 3 + 교통사고 2. 구간 3~5개 통제(다리 제외, 200~400초). `sim.aidUsed -= 3`(인근 도시 지원 +3). 120~200초 뒤 여진: 진행 중인 붕괴 현장의 금 간 구조물(`unstable` 소품)의 `leak` 을 0.95 로 올려 2차 붕괴를 앞당기고(세계 규칙 — `rules/disaster.ts` 가 아니라 `disaster.ts` 에서 현장을 직접 만져도 된다. 재난은 세계다), 새 사건 1~2건 | 16 |
| **산불** `wildfire` | 연기 신고 L×[0.1, 0.2] → 즉시 번지기 시작 | `d.front`: 산(`sim.city.mountains` 가운데 하나)의 기슭에서 시작해 가장 가까운 시가지 쪽으로 초당 1.1~1.5(헬기가 `disaster:wildfire` 사건의 현장에 있으면 ×0.7), 반지름은 60 에서 180 까지 자란다. 지나간 자리는 `d.scar` 에 [x, y, r] 로 쌓인다(그림). 불머리 안의 구간은 `closeEdge`, 지나가면 연다. 70~100초마다 불머리에서 150 안의 건물·터(숲·펜션·야영장·절·농가·전망대)에 `fire/wild`. 시가지에 닿으면 주택 화재 `fire/std` 2건을 내고 멈춘다. `fire/wild` 사건 셋이 성공·부분 성공으로 끝나면 "주불 진화"로 멈춘다 | 8 |
| **해일** `tsunami` | 경보 L×[0.15, 0.4] → 150초 뒤 충격 → 충격 90초 | 경보와 함께 해안 대피 `water/evac` 2~3건(해수욕장·부두·수산시장·여객선 터미널). 충격: 아직 열려 있는 대피 현장의 물가 쪽 절반이 물에 잠긴다(세계 규칙 `rules/disaster.ts`). 바닷가 수난 `water/std` 3~4건, 교통사고 1건, 해안 구간(양 끝 교차로가 모두 `coastY(x) − y < 200`) `closeEdge` 200초 | 9 |

지금 있는 시나리오(`traffic/tree`, `water/std`, `collapse/std`, `collapse/elevator`, `fire/std`, `hazmat/std`, `medical/trauma`, `traffic/std`)는 `placeId`·`nodeId`·`severity` 만 정해 주면 된다. `water/std` 를 강변이 아닌 건물에서 일으켜도 현장이 만들어지는지(`builders.ts` `buildWater` 가 건물 종류로 물가의 모습을 고른다) 먼저 확인한다.

## 새 시나리오 셋 (`scenarios/disaster.ts`, 모두 `tag: 'disaster'`, `share: 0`)

- **`fire/wild` 산불 현장** — `nature: 'wildfire'`("산에서 불길이 내려와요! 집 쪽으로 번지고 있어요!", "숲에 불이 크게 났어요. 사람들이 못 내려오고 있어요!"), `lik` 화재 0.9, `label: '산불'`, `severity: [2, 3]`, `needs: (n) => { n.suppression = Math.max(n.suppression, 2); n.search = Math.max(n.search, 1); n.ems = Math.max(n.ems, 1); }`, `limit: 120`.
  현장: 수색 현장(`buildSearch`)처럼 나무가 많은 야외 구역 4~6개 + 작은 건물 하나(펜션·관리소: 방 2~3개). 나무 칸(`T.TREE`)과 풀밭 일부에 `s.fuel`, 한쪽 가장자리 구역에 불. 사람 2~4명(건물 안 1~2, 숲길에 1~2 — `mobile`·`immobile`). 구역은 `searchable`. **확인**: `tickFire` 가 나무 칸으로 번지는지, 야외 구역의 불을 `suppress` 가 끄는지(`executor.nearestFireTile`). 안 번지면 연료만 주고 불은 처음 놓은 자리에서 시작하게 둔다.
- **`collapse/landslide` 산사태** — `nature: 'landslide'`("산이 무너져서 도로를 덮쳤어요! 차가 묻혔어요!"), 붕괴 0.8 · 교통 0.15, `severity: [2, 3]`, `node`: `mountainAt(n.x, n.y) > 0.12` 인 교차로. 현장: 도로 현장에 흙더미(`debris` 소품 8~12개, `skin: 'mud'`)와 바위(`T.ROCK`), 묻힌 차 1~2대(`vehicle`, 탑승자 갇힘), 길가의 집 한 채는 선택. `onCreate`/`onClose` 로 그 구간 통제·복구(교통사고의 `tree` 변형이 하는 방식 — `incidents.ts` 를 읽는다. `I.blockedEdge` 를 쓰면 `closeIncident` 가 풀어 준다).
- **`water/evac` 해안 대피** — `nature: 'evac'`("해일 경보가 났는데 바닷가에 사람들이 아직 많아요!", "부두에 어르신들이 남아 있어요. 못 걸으세요!"), 수난 0.8, `label: '해안 대피'`, `severity: [2, 3]`, `needs: (n) => { n.law = Math.max(n.law, 2); n.ems = Math.max(n.ems, 1); n.rescue = Math.max(n.rescue, 1); }`.
  현장: 위쪽은 뭍, 가운데는 모래밭·부두, 아래 5줄은 바다. 사람 6~10명: 걸을 수 있는 사람 대부분 + 못 걷는 사람 1~2. 모두 뭍에 있다(`inWater` 아님). 발견되면 걸어 나가고(기존 규칙), 못 걷는 사람은 옮긴다. `s.rules = ['water']`.
  충격 규칙(`rules/disaster.ts`): `sim.disaster?.kind === 'tsunami' && phase === 'impact'` 가 된 순간 한 번, 이 현장의 물가 쪽 절반 바닥을 `T.WATER` 로 바꾸고(`s.staticVersion++`) 그 위에 남은 사람을 `inWater = true; mob = 'trapped'; health -= 25~45; drift = 0.1` 로 만든다. 그 위의 대원은 뭍 쪽 가장 가까운 바닥으로 옮기고 다친다(`RESPONDER_HURT` 는 기존 코드가 체력으로 판단하니 체력만 깎는다). 기록 한 줄(`ESCALATION` '해일이 덮침').

## 그림

- `drawDisasterWorld`(지도 위): 홍수 = 강의 중심선을 따라 `level × 80` 폭의 반투명 물(강의 점 `sim.city.river.pts`), 산불 = `d.scar` 의 검붉은 얼룩 + 불머리의 주황 테와 불씨, 해일 = 해안선(`sim.city.coast`)에서 밀려오는 흰 띠(충격 동안), 지진 = 진앙에서 퍼지는 고리(충격 뒤 6초), 정전 = 건물 불빛을 덮는 어둠.
- `drawDisasterScreen`(화면 전체): 태풍 = 비스듬한 굵은 빗줄기와 바람 줄기(`intensity` 에 비례), 산불 = 불머리 쪽에서 번지는 연기 안개, 지진 = 충격 3초 동안 화면 가장자리의 떨림 표시(카메라를 흔들지 않는다 — 덧칠만), 축소 창(`mini`)에서는 절반만.
- `drawDisasterScene`(현장): 태풍 = 강한 비, 지진의 여진 순간 = 먼지, 산불 현장 = 붉은 하늘빛 덧칠.
- 특보 띠(`DisasterBanner`): 예고 = 노란 띠 "태풍 특보 — 충격까지 1:20", 충격 = 붉은 띠 + 지금 일어난 사건 수, 여파 = 회색. 클릭 동작 없음(관찰 전용).
- 보고서(`disasterSummary`): "태풍 — 12:04 특보, 12:06~12:13 충격. 재난 사건 14건 가운데 성공 9, 부분 3, 실패 2. 도로 6구간 통제." 처럼 **실제로 일어난 것만**(`d.log`, `d.spawned` 의 결과).

## 완료 조건과 테스트 (`tests/disaster.test.ts`)

1. 다섯 종류 각각 두 시드: 예외 없이 끝나고(`report` 있음), 모든 사건이 닫혔고, `d.spawned.length` 가 종류별 최소(태풍 8, 홍수 5, 지진 9, 산불 3, 해일 5) 이상·상한 이하, 교대 끝에 `closedReason === 'disaster'` 인 구간 0, 모든 구간의 `bump` 가 0(또는 없음)이다.
2. 재난 없음: `new Sim('X')` 와 `new Sim('X', { ...NORMAL, disaster: 'none' })` 의 `report.hash` 가 같다. `random` + 심각도 5 의 20교대에서 재난이 3~10번.
3. 재현성: 같은 시드·같은 재난 두 번의 `hash` 가 같다.
4. 홍수: 수위가 가장 높을 때에도 강 양쪽이 이어져 있다(아무 두 시설 사이 `findRoute` 가 있다). 지진: 충격 뒤 30초 안에 사건이 8건 이상 열린다. 산불: `d.scar` 가 자란다. 해일: 대피 현장이 충격 전에 끝났으면 물에 빠진 사람이 없다.
5. `npx tsx scripts/sweep.ts 12 --disaster <종류> --scen` 다섯 번: 예외 0, 끝나지 않은 사건 0. 결과 분포를 보고에 붙인다(재난 교대는 평소보다 어려운 것이 정상 — 성공+지연 45% 이상이면 된다. 그보다 낮으면 사건 수·간격을 줄인다).
6. `npm run check` 통과(재난 없는 평소 교대가 그대로인지).
7. 화면: 다섯 종류의 지도 화면을 충격 시점에 찍어 본다(`?seed=S3&disaster=quake`). 콘솔 오류 0건.

시간이 모자라면 이 순서로 줄인다: 해일의 대피 현장(→ 충격 때의 수난 사건만) → 산사태 → 현장 화면의 덧칠.
