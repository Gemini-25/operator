# N5 — 대형 사고

공통 규칙은 `docs/specs/README.md`. 브랜치 `wf/major`, 개발 서버 포트 **5202**.

**자기 파일**: `src/sim/scenarios/major.ts`, `src/sim/field/scenes/major.ts`, `src/sim/field/rules/major.ts`, `src/sim/field/orders/major.ts`, `src/view/scene/skins/major.ts`, `tests/major.test.ts`.

## 틀 (이미 들어가 있다)

- `tag: 'major'` 인 시나리오는 평소 추첨에 들어가지 않는다. 교대가 시작될 때 `sim.rngMajor.chance(tune.majorProb)`(심각도 1~5 에서 15 · 30 · 45 · 60 · 80%)로 일어날지와 시각(교대의 18~70%)이 정해지고, 그때 `share` 를 비중 삼아 하나를 골라 `createIncident` 한다(`incidents.ts` `tickIncidents`). `Incident.tag === 'major'`, 발생 기록의 중요도 3.
- 시험: `npx tsx scripts/sweep.ts 20 --force fire/plane --scen`, 화면은 `?seed=S3&force=fire/plane`.

모두 **지금 있는 규칙**(구출·처치·이송·진압·수난 구조·도로 정리) 위에서 규모만 키운다. 새 임무 종류를 만들지 않는다.

## 시나리오 여섯 가지

| `variant` | 유형 | 비중 | `nature` · 신고 문구 | 어디서 | `needs` | `limit` |
|---|---|---|---|---|---|---|
| `plane` | `fire` | 1.0 | `planecrash` "비행기가 떨어졌어요! 불이 났어요!" / "경비행기가 활주로 옆에 추락했어요. 사람들이 안에 있어요!" | `places: { runway: 5, farmland: 2, park: 1, riverside: 1 }` | 진압 3, 구조 2, 구급 4, 경찰 1, 수색 1(헬기) | 300 |
| `train` | `traffic` | 1.2 | `derail` "기차가 탈선했어요! 객차가 넘어졌어요!" / "건널목에서 열차가 차를 들이받고 선로를 벗어났어요!" | `node`: 철길(`sim.city.rail`)에서 60 안의 교차로 가운데 하나 | 구조 2, 구급 4, 경찰 1, 교통 1 | 240 |
| `pileup` | `traffic` | 1.6 | `pileup` "고속도로에서 차 여러 대가 연달아 부딪쳤어요!" / "차가 대여섯 대 엉켜 있어요. 기름이 새요!" | `node`: `cls === 'highway'` 인 구간이 닿는 교차로 | 구조 2, 구급 3, 진압 1, 교통 1, 경찰 1 | 200 |
| `gasblast` | `collapse` | 1.6 | `gasblast` "펑 하는 소리가 나더니 건물 한쪽이 무너졌어요! 불도 났어요!" / "가스가 터진 것 같아요. 유리가 다 깨지고 사람들이 깔렸어요!" | `places: { restaurant: 4, villa: 3, shop: 2, market: 2, houseL: 1 }` | 진압 2, 구조 2, 구급 2 | 150 |
| `crane` | `collapse` | 1.2 | `crane` "공사장 크레인이 넘어갔어요! 사람이 깔렸어요!" / "타워 크레인이 길 쪽으로 쓰러졌어요!" | `places: { construction: 6, containerYard: 1 }` | 구조 2, 구급 2, 경찰 1, 교통 1 | 120 |
| `ship` | `fire` | 1.0 | `shipfire` "배에 불이 났어요! 사람들이 바다로 뛰어내려요!" / "부두에 댄 배에서 연기가 엄청 나요!" | `places: { pier: 4, ferry: 3, containerYard: 2, fishMarket: 1 }` | 진압 2, 구조 2, 구급 2 | 200 |

공통: `tag: 'major'`, `severity: [3, 3]`, `vague: 'bang'`, `delay: [2, 6]`, `label` = 이름. `lik` 는 자기 유형에 0.85 안팎, 나머지는 닮은 유형에 나눠 준다(예: `gasblast` = 붕괴 0.6 · 화재 0.2 · 가스 0.15). `needs` 는 유형의 기본 계산 뒤에 불리므로 필요한 칸만 `Math.max` 로 올린다.

`node` 의 예:

```ts
node: (sim, rng, busy) => {
  const hw = sim.city.nodes.filter((n) => !busy.has(n.id) && n.edges.some((e) => sim.city.edges[e].cls === 'highway') && !sim.city.facilities.some((f) => f.nodeId === n.id));
  return hw.length ? rng.pick(hw).id : null;
},
```

철길까지의 거리는 `city.ts` 의 `distSeg`(export) 를 `sim.city.rail` 의 이웃한 점마다 재서 구한다.

## 현장 (`scenes/major.ts`)

먼저 `builders.ts` 의 `buildTraffic`(특히 버스 변형)·`buildCollapse`·`buildWater`·`buildFire` 를 읽는다. 사람이 탄 탈것은 `vehicle` 소품(`occupants`, `inVehicle`, 누출 `leak`·`leakRate`)이고, 그 둘레가 `wreck` 구역(수색 대상)이다. 이 구조를 그대로 쓴다.

- **`plane`** — 건물 없는 들판(바닥 `T.GROUND`, 가장자리에 나무 몇 그루). 동체 세 토막: `vehicle` 소품 3개(`skin: 'fuselageNose' | 'fuselageMid' | 'fuselageTail'`, `bus: true` 로 다인승 규칙을 쓴다, 각도는 조금씩 다르게). 탑승자 10~14명: 안에 갇힌 사람 4~5(`trapped`), 안팎의 중상 4~5(`immobile`), 걸어 나온 경상 2~4(`mobile`). 튕겨 나간 한두 명은 가장자리 구역(`verge`, 은폐도 높게). 날개 쪽 바닥 6~10칸에 연료(`s.fuel = 1`)와 불(`s.fire = 0.5~0.8`), 가운데 토막은 `leakRate` 를 준다. 길 쪽 잔해 `roadDebris` 3~5개(`skin: 'planeDebris'`). `s.leadDept = 'fire'`.
- **`train`** — 교통사고 현장의 틀(도로가 가로지르는 야외)에 철길을 한 줄 깐다(바닥 재질은 `T.ROAD` 로 두고 그림은 소품으로: 길게 누운 `roadDebris` 가 아니라 **막지 않는** 장식 소품 `cover` 는 쓰지 않는다 — 대신 객차 그림에 레일을 함께 그린다). 객차 2~3량: `vehicle`(`skin: 'trainCar'`, `bus: true`), 한 량은 옆으로 누워 있다(각도). 탑승자 10~14명(갇힘 3~4, 중상 4~5, 경상 나머지). 건널목에서 받힌 승용차 1대(탑승자 1~2). 지나가는 차량은 없다(`s.laneRows = []` — 교통 통제 임무가 생기지 않는다). 대신 `needs.traffic` 은 관제의 판단일 뿐이므로 그대로 둔다.
- **`pileup`** — `buildTraffic` 과 같은 도로 현장에 차량 5~7대(트럭 1대는 `bus: false`, 크기만 크게), 8~12명, 두 대에 누출. 차선 통과 차량은 그대로 둔다(2차 사고 위험 = 교통 통제가 중요해진다).
  `onCreate`: 평소 교통사고 코드가 고른 `I.blockedEdge`(고속도로가 아닌 구간)를 되돌리고(`slow -= 1.4`), 그 교차로의 **고속도로 구간** 가운데 우회로가 있는 것(`findRoute(city, e.a, e.b, 1, e.id)`)을 `I.blockedEdge` 로 삼아 `slow += 1.4; closed = true; closedReason = 'incident'` 와 통제 기록을 남긴다. 풀기는 `closeIncident` 가 한다.
- **`gasblast`** — `buildCollapse` 를 export 해서(공용 파일 수정) 그 현장을 만든 뒤 덧붙인다: 무너진 구역 옆 방에 불(가구 3~5칸), 새는 밸브 하나(`valve`, `leakRate`), 건물 밖 인도에 다친 행인 2~3명(`immobile`·`mobile`). `s.rules = ['gas']`. 밸브 자리는 `buildHazmat` 의 규칙을 따른다(가구에 둘러싸인 구석 금지, 놓은 뒤 닿는지 확인).
- **`crane`** — 공사장: 울타리(벽) 안의 마당(`T.GROUND`)과 짓다 만 골조(기둥처럼 띄엄띄엄한 벽, 바닥 `T.FLOOR` 일부). 쓰러진 크레인 팔: 마당에서 길까지 대각선으로 이어지는 `debris` 소품 6~9개(`skin: 'craneBoom'`, 치울 수 있다 — `hp` 는 일반 잔해의 1.5배). 깔리거나 다친 작업자 3~5명(갇힘 2). 금 간 구조물 `unstable` 2개(2차 낙하 — 붕괴 유형이므로 `tickCollapse` 가 돈다). 길 위에 `roadDebris` 2~3개.
- **`ship`** — 위쪽은 부두(`T.GROUND`), 아래 6~7줄은 바다(`T.WATER`). 배는 바다 쪽에 놓인 홀형 건물(바닥 `T.FLOOR`, 벽, 방 3~4개: 기관실·선실·조타실)이고 부두와 건널판(폭 2칸의 `T.FLOOR`)으로 이어진다 — `planBuilding` 을 쓰기 어렵다면 `kit.ts` 의 `set`·`addRegion`·`furnish` 로 직접 짠다. 기관실에 불. 선원 5~8명: 안에 3~4(연기 속), 바다에 2~3(`inWater: true, drift: 0.05~0.12`, 배 옆의 물 칸에). `s.rules = ['water']`. 배의 테두리는 막지 않는 큰 장식으로 그린다: `addProp(s, 'cover', x, y, { w, h, blocking: false, skin: 'shipHull' })`(`cover` 소품이 다른 규칙에 걸리지 않는지 `grep "'cover'"` 로 확인하고, 걸리면 `clue` 가 아닌 다른 안전한 종류를 고르거나 고정 층에 그리지 말고 `SKINS` 만으로 그린다).
  배정(`dispatcher.ts` `pickUnit` — 공용 파일 수정): 구조정(`u.sea`)이 나가는 조건에 "바닷가이고 관제가 붙인 이름이 '선박 화재'"를 더한다(`I.assessment?.label`).

모든 현장: **모든 바닥에 걸어서 닿는가**(물·가구·소품 제외)를 테스트로 확인한다(`tests/sim.test.ts` 의 `현장 배치의 다양성` 이 쓰는 방식 — `truthCost`·`astar` 또는 채우기 탐색). `s.exits`·`s.spots`·`s.staging`·`s.safe` 를 채운다(`baseScene` 의 기본값이 벽·물 위가 아닌지 본다).

## 사람이 많을 때 (`orders/major.ts`)

기존 지휘관은 구급 부대를 두 대까지만 더 부른다. 대형 사고에서는 모자란다:

```ts
registerOrders((sim, s, I, a, k) => {
  const waiting = a.beliefs.list('cas').filter((f) => f.value.band >= 1 && f.value.band < 3 && (f.value.where === 'scene' || f.value.where === 'carried' || f.value.where === 'safe')).length;
  if (waiting >= 5 && k.countUnits('ems', 0.7) < Math.min(5, Math.ceil(waiting / 2))) k.request('ems', `부상자 ${waiting}명 — 구급 부대가 더 필요`, true);
  const trapped = a.beliefs.list('cas').filter((f) => f.value.mob === 'trapped' && f.value.band < 3 && f.value.where === 'scene').length;
  if (trapped >= 3 && k.countUnits('rescue', 0.5) < 2) k.request('rescue', `고립 ${trapped}명 — 구조 부대 추가`, true);
});
```

(`request` 는 같은 종류의 요청이 채워지기 전이나 70초 안에는 다시 나가지 않는다.) 이 규칙은 믿음만 보므로 버스 사고 같은 기존 사건에도 적용된다 — `npm run check` 의 분포가 범위 안인지 본다.

## 화면

- 소품 그림(`skins/major.ts`): `fuselageNose`·`fuselageMid`·`fuselageTail`(흰 동체, 창문 줄, 찢긴 단면, 그을음), `planeDebris`, `trainCar`(객차 + 밑의 레일 토막), `craneBoom`(노란 트러스), `shipHull`(뱃머리가 뾰족한 선체 윤곽, 갑판 색). 지금의 차량·버스 그림(`view/scene/sprites.ts` 의 `drawBus`)과 같은 선 굵기·색조로. 좌표계: 소품 가운데가 원점, 1 = 한 칸, 각도는 이미 적용돼 있다.
- `skin` 이 있는 소품은 기본 그림 대신 등록된 그림만 그려진다(차량의 누출 웅덩이 등도 직접 그려야 한다 — `p.leak`).
- 지도(`view/renderCity.ts` — 공용 파일 수정): `I.tag === 'major'` 인 사건의 핀에 바깥 고리 하나 더(주황, 천천히 퍼진다). 사건 목록(`ui/panels.tsx` `IncidentList`)의 카드에 `대형` 딱지. 보고서(`ReportModal`)의 타일 줄에 `r.major` 가 1 이상이면 "대형 사고" 타일. CSS 는 `styles.css` 끝의 `/* ── major ── */` 블록.

## 완료 조건

- 여섯 시나리오 각각 `--force` 20교대: 예외 0, 한계 시간·방치 ≤ 2, 구조율(구조 ÷ 전체) ≥ 60%. 표를 보고에 붙인다.
- `npm run check` 통과(대형 사고가 두 교대에 한 번쯤 섞인 상태에서). 범위를 벗어나면 사상자 수·`limit`·`needs` 를 조정한다.
- 화면: 여섯 현장을 각각 찍어 그림이 깨지지 않았는지 본다. 콘솔 오류 0건.

## 테스트 (`tests/major.test.ts`)

1. 여섯 시나리오를 `createIncident` 로 일으켜: 현장의 모든 바닥에 닿고, 사상자 수가 범위 안이고, 교대가 끝난다.
2. 보통 난이도 30교대에서 `tag === 'major'` 인 사건이 8~22건(확률 45%)이고, 한 교대에 둘 이상은 없다. 심각도 1 에서는 30교대에 10건 이하.
3. `pileup`: 사건 중에 고속도로 구간이 통제되고 끝난 뒤 풀린다. `ship`: 물에 빠진 사람이 있고 `waterRescue` 임무가 실제로 수행된다. `gasblast`: 밸브가 있고 `s.rules` 에 `gas`.
4. 재현성: 같은 시드 두 번의 `report.hash` 가 같다.
