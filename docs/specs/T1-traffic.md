# T1 — 교통: 정체, 길을 막는 장애물, 건널목

공통 규칙은 `docs/specs/README.md`. 브랜치 `wf/traffic`, 개발 서버 포트 **5205**.

**자기 파일**: `src/sim/traffic.ts`(새로), `src/view/city/trafficLayer.ts`(새로), `src/ui/TrafficChip.tsx`(새로), `tests/traffic.test.ts`(새로).
**공용 파일 수정**(아래에 적힌 곳만): `types.ts`, `difficulty.ts`, `engine.ts`, `city.ts`(`edgeTime`·`findRoute`·옛 교통 코드 삭제), `resources.ts`(`tickUnits` 의 이동 부분·`setRoute`·`etaFor`), `debrief.ts`(보고서 한 줄), `view/renderCity.ts`(도로 상태 그리기 한 덩어리·`describeAt`), `ui/panels.tsx`(`TopBar` 에 한 줄), `styles.css` 끝의 `/* ── traffic ── */` 블록.
**건드리지 않는다**: `pursuit.ts`, `disaster.ts`, `incidents.ts`, `dispatch/*`, `field/*`, `view/city/tokens.ts`(U1 이 고친다).

## 지금 있는 것과 부족한 것

- 지금: 구간마다 혼잡 계수 `cong`(1~3), 사건이 만든 지연 `slow`, 통제 `closed`. `tickTraffic`(`city.ts`)이 12초마다 `cong` 을 기준값 쪽으로 움직이고, 80~150초마다 "정체" 아니면 "긴급 공사로 통제" 하나를 일으킨다. 부대는 교차로마다 경로를 다시 본다(`resources.tickUnits`).
- 부족: ① 정체가 한 구간에만 머문다(뒤로 밀리지 않는다). ② 통제는 생기는 순간 온 도시가 안다 — **가 보니 막혀 있는** 일이 없다. ③ 길 위의 물리적 장애물(떨어진 짐, 고장 차, 골목의 불법 주차)이 없다. ④ 철길이 그림뿐이다. ⑤ 시간대(출퇴근)가 없다. ⑥ 지도에서 교통이 잘 읽히지 않는다.

## 원칙

- **차량 하나하나를 굴리지 않는다.** 구간별 수치와 장애물 목록으로 표현한다(지도에 일반 차량 그림을 다시 넣지 않는다 — 사용자가 뺀 것이다).
- **정보 격리를 교통에도 적용한다.** 경로를 짜는 쪽(관제의 예상 도착 시간, 부대의 경로)은 **알려진** 도로 상태만 쓴다. 알려지지 않은 장애물은 부대가 가서 보고(무전 보고 → 모두가 안다) 되돌아 나온다. 시민 제보로도 알려진다.
- 난수는 `sim.rngTraffic` 만. 교통이 사건 생성의 난수를 건드리지 않는다.
- 기존 칸의 뜻을 바꾸지 않는다: `cong`(교통량에서 오는 혼잡, 1~3), `slow`(사건이 얹는 지연 — 교통사고·홍수가 쓴다. **교통 모델은 `slow` 를 고치지 않는다**), `closed`·`closedReason`(`'incident'`·`'disaster'` 는 다른 묶음의 것 — 건드리지 않는다).

## 자료 (`types.ts` 에 추가)

```ts
// RoadEdge 에 추가 (모두 선택 칸)
known?: boolean;     // false = 막혀 있지만(closed) 관제와 부대가 아직 모른다. 없으면 아는 것으로 본다
bump?: number;       // 밖에서 더하는 혼잡 (재난의 정전, 행사 인파). 교통 모델이 cong 을 계산할 때 더한다
wait?: number;       // 이 구간에서 기다려야 하는 초 (내려온 건널목 차단기). edgeTime 이 더한다
gateT?: number;      // 건널목이 있는 구간이면 그 위치 (a→b 로 0..1)
// Unit 에 추가
heavy?: boolean;     // 큰 차 (펌프차·사다리차·구조 공작차·화학차): 불법 주차로 좁아진 골목을 지나지 못한다
// ShiftReport 에 추가
traffic?: { jams: number; closures: number; obstacles: number; detours: number; delaySec: number; gateWaits: number };
```

`src/sim/traffic.ts`:

```ts
export type ObstacleKind = 'roadwork' | 'breakdown' | 'debris' | 'parked';
export interface Obstacle {
  id: number; edge: number; t: number;          // 구간 위의 위치 (a→b 로 0..1)
  kind: ObstacleKind; full: boolean;            // 전면 차단인가 (아니면 한 차로만 — 느려질 뿐)
  heavyOnly: boolean;                           // 큰 차만 못 지난다 (불법 주차)
  since: number; until: number;                 // 생긴 시각, 치워지는 시각
  known: boolean; knownAt: number;              // 관제가 아는가, 언제 알았는가
  tipAt: number;                                // 시민 제보가 들어올 시각 (그 전에 부대가 보면 그때 알려진다)
  label: string;                                // '낙하물' · '고장 차량' · '도로 공사' · '불법 주차'
}
export interface Train { pos: number; dir: 1 | -1; speed: number; len: number; dwell: number }      // 철길 위의 위치(화소), 역에 서 있는 남은 초
export interface Crossing { edge: number; s: number; down: boolean; downAt: number }                // s = 철길 위의 위치
export interface TrafficState {
  queue: Float32Array;            // 구간별 밀린 정도 0..1 (막힌 구간에서 뒤로 번진다)
  jams: { edge: number; until: number }[];
  obstacles: Obstacle[]; nextObstacleId: number;
  trains: Train[]; crossings: Crossing[]; nextTrainAt: number;
  nextDrift: number; nextEvent: number;
  tod: number;                    // 시간대 계수 (교대가 시작된 시각으로 정해진다)
  stats: { jams: number; closures: number; obstacles: number; detours: number; delaySec: number; gateWaits: number };
}
export function initTraffic(sim: Sim): TrafficState;
export function tickTraffic(sim: Sim): void;
export function addObstacle(sim: Sim, o: { edge: number; t?: number; kind: ObstacleKind; full: boolean; heavyOnly?: boolean; dur: number; known: boolean }): Obstacle | null;   // 테스트·재난이 쓴다. 전면 차단이 도시를 끊으면 null
export function obstacleAhead(sim: Sim, u: Unit, e: RoadEdge, from: number): Obstacle | null;      // 이 부대가 이 구간을 from 교차로에서 들어가 달릴 때 길을 막는 것
export function reportObstacle(sim: Sim, o: Obstacle, by: string): void;                              // 알려짐 처리 + 기록
export function passable(e: RoadEdge, heavy: boolean, sim: Sim): boolean;                             // 경로를 짤 때: 알려진 상태로 지나갈 수 있는가
```

엔진: `engine.ts` 의 import 를 `./traffic` 으로 바꾸고 `this.traffic = initTraffic(this)`(지금은 `initTraffic(this.rngTraffic)`), `traffic` 칸의 타입을 `TrafficState` 로. `city.ts` 의 `TrafficState`·`initTraffic`·`tickTraffic` 은 지운다(`traffic.ts` 로 옮긴다). `createRoster` 뒤에 불러야 한다면 순서를 그렇게(부대의 `heavy` 는 `resources.ts` `KIND` 에서: `engine`·`ladder`·`rescue`·`hazmat` = true).

## 교통 모델 (`tickTraffic`)

12초마다(`nextDrift`, 지금과 같은 주기) 구간별로:

```
수요   = e.baseCong × tod × tune.trafficMul                       (baseCong: 지금 있는 구간별 기준값 1.0~1.65)
밀림   = queue[e]                                                  (아래)
병목   = 이 구간에 한 차로를 막는 장애물이 있으면 +0.9
목표   = clamp(수요 + 밀림 × 1.2 + 병목 + (정체 중이면 2.8 까지) + (e.bump ?? 0), 1, 3)
e.cong = clamp(e.cong + (목표 − e.cong) × 0.35 + rng.range(−0.1, 0.1), 1, 3)
```

- **시간대** `tod`: `sim.startTod`(하루 기준 초)로 한 번 정한다. 8시와 18시에 봉우리(폭 1시간) — `0.82 + 0.5 × 봉우리`, 22시~6시는 0.7. 교대 시작 기록 다음에 한 줄: `emit({ role: 'SYSTEM', actor: '교통정보', kind: 'traffic', imp: 1, text: '퇴근 시간대입니다. 도심 간선 도로가 평소보다 밀립니다.' })`(봉우리가 0.5 이상일 때만. 한산하면 '심야 — 도로가 한산합니다').
- **뒤로 밀림** `queue`: 막힌(`closed`) 구간이나 `cong ≥ 2.4` 인 구간에 **닿아 있는** 구간은 주기마다 `queue += 0.14`(상한 1), 아니면 `queue *= 0.75`. 한 다리 건너까지만 번지게(밀린 구간 자체가 `cong ≥ 2.4` 가 되면 그 이웃도 밀린다 — 자연히 번지지만 `queue` 상한과 감쇠로 멈춘다). 고속도로는 절반만.
- **보통 난이도에서 평균 혼잡이 지금보다 크게 높아지지 않게** 맞춘다(아래 "균형").

80~150초마다(× `tune.trafficGap`) 하나 — 비중은 정체 35 · 전면 공사 15 · 한 차로 공사 12 · 고장 차량 14 · 낙하물 14 · 행사 인파 10:

| 일 | 어디 | 효과 | 알려지는가 |
|---|---|---|---|
| 정체 | 간선·혼잡한 구간 | 70~130초 동안 목표 2.8 | 바로(교통정보) |
| 전면 공사 `roadwork` full | 시설 앞이 아닌 구간, 우회로가 있을 때 | 70~120초 통제 (`closed`, `closedReason = 'roadwork'`) | 바로 |
| 한 차로 공사 `roadwork` | 간선·일반 | 150~300초 병목 | 바로 |
| 고장 차량 `breakdown` | 간선·일반 | 60~150초 병목 | 20~40초 뒤 제보 |
| 낙하물 `debris` full | 일반·이면 도로, 우회로가 있을 때 | 70~160초 **전면 차단** (`closed`, `closedReason = 'obstacle'`, `known = false`) | 35~70초 뒤 제보, 또는 부대가 가서 보고 |
| 행사 인파 | 경기장·시장·터미널(그 건물의 `edgeId` 와 이웃 구간) | 180초 동안 `bump += 0.8` (끝나면 되돌린다) | 바로 |

교대 시작 때 **불법 주차** `parked`(`heavyOnly`, `known = false`, 교대 끝까지): `cls === 'local'` 인 구간 가운데 `tune.parkedCount` 곳(우회로가 있고, 그 구간에 시설이 없을 때). 큰 차는 지나지 못하고, 작은 차는 그 구간에서 병목 +0.4. 제보는 없다 — 큰 차가 가서 보아야 알려진다. 한 번 알려지면 큰 차의 경로는 그 구간을 피한다.

- 전면 차단은 `findRoute(city, e.a, e.b, 1, e.id)` 가 있을 때만(도시가 끊기지 않게). 한 구간에 장애물은 하나.
- 생길 때: 알려지지 않은 것은 `emit({ truth: true, actor: '도시', kind: 'traffic', text: '○○로 2구간에 화물이 떨어져 길이 막혔습니다. 아직 아무도 신고하지 않았습니다.' })`. 알려질 때(`reportObstacle`): `emit({ actor: '교통정보' 또는 부대 호출부호, kind: 'traffic', imp: 1, text: '○○로 2구간 통행 불가 — 낙하물. 우회하십시오.' })`, `o.known = true`, 그 구간의 `e.known = true`.
- 치워질 때(`until`): `closed = false; closedReason = null; known = undefined`, '통행 재개' 기록(알려져 있었을 때만).
- 교대가 끝나면(`sim.ended`) 새 일을 만들지 않는다.

## 건널목과 열차

- 철길(`sim.city.rail`)과 **같은 높이로** 만나는 구간이 건널목이다: `cls` 가 `street`·`local` 이고 철길 선분과 교차하는 구간(지금 지도에서 6곳. `city.ts` 의 `segCross` 로 찾는다). 간선·고속도로는 고가로 넘는다(영향 없음). `initTraffic` 에서 구간마다 `e.gateT`(교차점의 위치)와 `Crossing.s`(철길 위의 위치)를 구해 둔다.
- 열차: 150~260초마다 한쪽 끝에서 출발(방향은 번갈아), 속도 26, 길이 110. 가온역(`kind === 'station'` 인 건물에서 가장 가까운 철길 위의 점)에 닿으면 14초 선다. 철길 끝을 벗어나면 사라진다.
- 차단기: 열차 머리가 건널목 앞 400 안에 들어오면 내려가고(`down = true`), 꼬리가 30 지나면 올라간다. 내려가 있는 동안 그 구간의 `e.wait` = 올라갈 때까지 남은 예상 초(열차 속도로 계산, 역 정차 포함), 올라가면 `wait = 0`. **`closed` 로 만들지 않는다**(잠깐 서는 곳이지 못 가는 길이 아니다 — 경로 계산은 기다리는 시간만 더한다).
- 내려갈 때 기록은 남기지 않는다(너무 잦다). 부대가 차단기 앞에서 서면 그때 한 줄(아래).

## 경로와 주행 (`city.ts`, `resources.ts`)

- `edgeTime(e, weatherF, heavy = false)`: 지금 식에 `+ (e.wait ?? 0)`, 큰 차는 이면 도로(`cls === 'local'`)에서 ×1.15.
- `findRoute(city, from, to, weatherF, avoidEdge, heavy = false)`: 구간을 건너뛰는 조건을 `e.closed` 에서 **"알려진 통제"** 로 바꾼다 — `(e.closed && e.known !== false) || (heavy && 그 구간에 알려진 불법 주차)`. 알려진 불법 주차는 `e` 에 표시해 둔다(예: `closedReason` 을 쓰지 말고 `traffic.ts` 가 관리하는 `Set<number>` 를 `city` 밖에 두면 `findRoute` 가 볼 수 없다 → `RoadEdge` 에 `noHeavy?: boolean` 칸을 하나 더해 알려졌을 때 켠다).
  - `findRoute` 를 부르는 곳은 많다(`grep -n "findRoute("`). 새 인자는 끝에 기본값으로 더하므로 다른 곳은 고치지 않아도 된다. `resources.ts` 의 `setRoute`·`etaFor`·`tickUnits` 에서만 `u.heavy` 를 넘긴다.
- `tickUnits` 의 이동 반복문(`while (budget > 0 && u.route …)`):
  1. **차단기**: 지금 달리는 구간에 `gateT` 가 있고 차단기가 내려가 있고 아직 건널목을 지나지 않았으면(진행 방향 기준 위치 < 건널목 위치), 건널목 바로 앞(진행 방향으로 `gateT − 14 / e.len`)에서 멈춘다. 처음 멈출 때 한 번: `emit({ role: 'UNIT', actor: u.callsign, kind: 'traffic', imp: 0, text: '○○ 건널목 차단기 대기.' })`, `stats.gateWaits++`. 기다린 시간은 `stats.delaySec` 에 더한다.
  2. **길을 막는 것**: `const o = obstacleAhead(sim, u, e, 들어온 교차로)` — 전면 차단이거나(`full`), 큰 차에게는 불법 주차(`heavyOnly && u.heavy`). 있고 아직 그 지점에 닿지 않았으면 그 앞(`±10 / e.len`)까지만 간다. 닿으면:
     - 아직 알려지지 않았으면 `reportObstacle(sim, o, u.callsign)`. 출동 중(`enroute` + 사건 있음)이면 지금의 `ROUTE_BLOCKED` 기록 방식 그대로 문제를 남긴다(문구: `${u.callsign}: ${구간 이름} — ${o.label}로 지나갈 수 없습니다. 되돌아 우회합니다.`).
     - **되돌아 나온다**: 들어온 교차로 `A` 에서 목적지까지 새 경로 `alt = findRoute(…, heavy)` 를 구하고, `u.route = { nodes: [B, A, ...alt.nodes.slice(1)], edges: [e.id, ...alt.edges], time: … }; u.seg = 0; u.segT = 1 − 지금의 segT`(B 쪽에서 A 쪽으로 되짚는다). 이 되짚는 구간에서는 장애물 검사를 건너뛴다(같은 것에 다시 걸리지 않게 — 예: `Unit` 에 `backing?: boolean` 을 두고 다음 교차로에서 끈다). `alt` 가 없으면 `A` 로 돌아가 기다린다(지금의 "경로가 끊겨 대기" 로직이 다시 시도한다).
     - `stats.detours++`, 늘어난 시간(`alt.time + 되짚는 시간 − 원래 남은 시간`)을 `stats.delaySec` 에.
  3. 교차로에서의 재검토(`if (next.closed)`)는 "알려진 통제"일 때만 미리 우회한다. 모르는 통제는 그대로 들어간다(2 가 처리한다).
- 헬기·구조정(`u.air`·`u.sea`)과 길가 구간(`curb`)은 그대로.
- 달아나는 차(`pursuit.ts`)는 고치지 않는다: `closed` 인 구간을 피하므로 낙하물·공사는 저절로 피한다(눈으로 본다고 친다). 차단기는 무시한다 — 알려진 한계로 보고에 적는다.

## 난이도 손잡이 `traffic` (`difficulty.ts`)

- `Difficulty.traffic?: number`(1 한산 … 5 극심, 없으면 3). `KNOBS` 에 한 줄(`harderWhen: 'high'`, 이름 '교통 상황', 설명 '도로의 교통량, 정체·공사·고장 차량·낙하물의 빈도, 골목의 불법 주차'). 난이도 창은 `KNOBS` 를 돌며 그리므로 손잡이가 저절로 생긴다.
- `Tuning`: `trafficMul [0.82, 0.92, 1, 1.12, 1.25]`, `trafficGap [1.6, 1.25, 1, 0.8, 0.62]`, `parkedCount [0, 1, 3, 5, 7]`.
- `parseDifficulty`: 숫자 5·6·**7개**를 받는다(일곱째가 교통). `validDifficulty`·`overallLevel`(평균에 포함) 반영. `difficultyKey`: 교통이 3 이 아닐 때만 뒤에 `-t4` 처럼 붙인다(지금의 키가 바뀌지 않게). `presetOf` 는 교통이 3(또는 없음)일 때만 프리셋으로 본다. 프리셋 정의는 고치지 않는다(`tests/sim.test.ts` 가 프리셋의 모양을 `toEqual` 로 본다).

## 화면

- `view/city/trafficLayer.ts`:
  - `drawTrafficWorld(ctx, sim, o: { timeMs, scale, truth })` — `renderCity.ts` 의 "도로 상태" 반복문(혼잡 주황·빨강, 통제 점선)을 **이 호출 하나로 바꾼다.** 내비게이션 지도처럼 읽히게: `load = cong + slow` 가 1.4 미만이면 그리지 않고, 1.4~1.8 노랑 `#f2c94c`, 1.8~2.3 주황 `#ff9f43`, 2.3 이상 빨강 `#ff5d5d` — 도로 가운데의 띠(도로 폭의 45%, 투명도 0.55)로. 통제(알려진 것)는 지금처럼 붉은 점선. **알려지지 않은 통제**는 관찰자 시점(`truth`)에서만 옅은 점선으로 보이고, 관제 시점에서는 보이지 않는다(`drawCity` 가 `truth` 를 어떻게 받는지 `incidentXY(sim, I, truth)` 를 따라가 확인한다).
  - 열차: 철길을 따라 움직이는 둥근 모서리의 객차 세 칸(짙은 남색, 밝은 창 줄). 차단기: 내려간 건널목에 붉은 점멸 점 둘과 가로 막대.
  - `drawTrafficScreen(ctx, sim, xf, o)` — 장애물 표식: 그 지점에 작은 둥근 바탕(지름 13 안팎, 어두운 바탕 + 노란 테) 위에 **그림 기호**(글자 아님): 공사 = 고깔, 고장 차량 = 경고 삼각형, 낙하물 = 상자, 불법 주차 = 차 위에 사선. 알려지지 않은 것은 관찰자 시점에서만, 점선 테로. `view/icons.ts` 의 `ICON_PATH` 방식(24×24 경로 문자열)으로 이 파일 안에 정의한다.
  - 축소 창(`mini`)에서는 띠만 그린다.
- `describeAt`(`renderCity.ts`): 마우스가 장애물·건널목·열차 가까이 있으면 그 정보(이름, '한 차로 통제 · 약 2분 남음', '차단기 내려감' 등)를 먼저 보여 준다. 도로 정보에는 지금 속도 느낌을 한 줄('원활 / 서행 / 정체 / 통제').
- `ui/TrafficChip.tsx`: 상단 띠에 작은 요약 — `교통 원활`(초록 점) / `서행 3`(노랑) / `정체 2 · 통제 1`(빨강). 숫자는 **알려진** 구간 수. `TopBar` 의 날씨 표시 옆에 `<TrafficChip sim={sim} />` 한 줄.
- 보고서(`debrief.buildReport`): `traffic: { ...sim.traffic.stats }`, 그리고 요약 문장에 한 줄 — "교통: 정체 n건·통제 n건·장애물 n건. 길이 막혀 되돌아간 출동 n회, 건널목 대기 n회 (합쳐 약 m초 지연)."(0건이면 "교통으로 인한 지연은 없었습니다."). 기록된 통계로만 쓴다.

## 균형

교통이 대응 시간을 조금 늘리는 것은 의도다. 다만 보통 난이도(교통 3)에서:

- 지금(지도 M1 뒤, 60개 시드): 성공 76%, 실패+미해결 9%, 평균 대응 50초, 한계 시간 1건.
- 목표: 평균 대응 시간 **+6초 이내**, 성공률 −3%p 이내, `npm run check` 통과. 넘으면 `trafficMul` 의 가운데 값은 1 로 둔 채 사건의 빈도(`trafficGap`)·지속 시간·`parkedCount` 를 줄인다.
- 교통 1 과 5 의 차이가 보여야 한다: 12개 시드에서 평균 대응 시간이 교통 5 > 교통 1 + 5초.
- `npx tsx scripts/sweep.ts 30 --diff 3,3,3,3,3,3,5 --scen` 에서 한계 시간·무대응 종료가 늘지 않는지(막힌 길 때문에 끝내 못 가는 부대가 없는지) 본다.

## 테스트 (`tests/traffic.test.ts`)

1. 재현성: 같은 시드 두 번의 `report.hash` 가 같다. 교통 손잡이: 교통 5 의 평균 `cong` 과 평균 대응 시간이 교통 1 보다 높다. `parseDifficulty('3,3,3,3,3,3,5')!.traffic === 5`, 여섯 개만 주면 `traffic` 은 없다.
2. 모르는 장애물: 부대의 경로 위 구간에 `addObstacle(… full, known: false)` → 경로 계산은 그 구간을 **지난다**(모르므로) → 부대가 그 앞에서 멈추고, 장애물이 알려지고, 되돌아 다른 길로 도착한다. 그 뒤의 `findRoute` 는 그 구간을 피한다. `stats.detours === 1`.
3. 불법 주차: 큰 차는 되돌아가고 작은 차(순찰차·구급차)는 지나간다. 알려진 뒤 큰 차의 경로는 그 구간을 피하고 작은 차의 경로는 피하지 않는다.
4. 건널목: 차단기가 내려가 있는 동안 그 구간의 어떤 부대도 건널목 위치를 넘지 않고(틱마다 위치 검사), 올라간 뒤 지나간다. 건널목이 6곳 이상 잡힌다. 열차의 위치는 철길 길이 안에 있다.
5. 뒤로 밀림: 간선 한 구간을 막으면 다섯 주기 안에 이웃 구간의 `cong` 평균이 오르고, 풀면 내려간다.
6. 도시가 끊기지 않는다: 40교대 동안 매 100틱마다 아무 두 시설 사이에 (알려진 상태로) 경로가 있다. 교대가 끝났을 때 `closedReason === 'obstacle'` 로 남은 구간의 장애물은 모두 `until` 이 있다.
7. 정보 격리: `src/sim/dispatch/*` 에 `obstacles` 라는 글자가 없다(관제는 알려진 도로 상태만 `findRoute`·`etaFor` 로 본다).

## 화면 확인

`http://localhost:5205/?seed=S3&diff=3,3,3,3,3,3,5` 를 띄워 8배속으로 3분쯤 돌린 뒤 지도 전체와 확대(장애물 표식, 열차, 내려간 차단기)를 찍어 본다. 띠가 도로를 가리거나 번쩍거리지 않는지, 부대 표식과 겹쳐도 읽히는지. 콘솔 오류 0건.

## 구현 메모 — 설계와 달라진 점 (wf/traffic)

구현하며 재 보고 바꾼 것들이다. 위의 본문과 다르면 **이 절이 실제 코드**다.

- **`trafficMul` 은 `[0.82, 0.92, 1, 1.15, 1.35]`** (원안의 위쪽 값은 1.12 · 1.25). 원안으로는 12개 시드에서 교통 5 의 평균 대응 시간이 교통 1 보다 4.5초 길 뿐이어서 "5초 넘게" 기준에 못 미쳤다. 가운데 값(1)과 `trafficGap`·`parkedCount` 는 원안 그대로다.
- **밀림의 뿌리는 `cong ≥ 2.4` 가 아니라 "밀림을 뺀 압력"** 이다: 막힌 구간, 사고 현장(`slow ≥ 1`), `수요 + 병목 + bump (+ 정체)` 가 2.4 이상인 구간. 실제 `cong` 으로 판정하면 밀려서 찬 구간끼리 서로를 붙잡아 뿌리가 사라져도 풀리지 않는다(써 보니 도시 전체가 붉어진 채 남았다). 뿌리에 닿은 구간은 주기마다 `queue += 0.14`(상한 1), 그 가운데 `queue ≥ 0.6` 인 구간에 닿은 구간은 `+= 0.07`(상한 0.5) — 한 다리 건너까지만 번진다.
- **전면 차단·불법 주차를 놓기 전의 우회로 검사** 는 `findRoute` 가 아니라 `traffic.ts` 의 `linked()` 다: 실제 상태(아직 모르는 통제와 불법 주차까지)에서 큰 차가 양 끝을 오갈 수 있을 때만 놓는다. 그래서 이 파일이 만든 통제만으로는 어느 교차로도 어느 부대에게서 끊기지 않는다.
- **사건이 만든 통제와 겹칠 때** (검토에서 고침). 사건이 길을 막을 때(쓰러진 나무, 사고 구간 전면 통제 — `incidents.ts`·`sceneManager.ts`)는 작은 차 기준의, 알려진 상태의 우회로만 확인한다. 그래서 두 가지를 더 한다.
  - **불법 주차는 `linkedTwice()`** 로 놓는다: 다른 구간 **하나가 더 막혀도** 큰 차가 그 골목의 양 끝을 오갈 수 있을 때만(길이 두 갈래일 때만). 교대 내내 남는 것이라, 우회로가 하나뿐인 골목에 세워 두면 그 우회로를 사건이 막는 순간 큰 차가 사건이 끝날 때까지 그 동네에 — 바로 그 사건 현장에도 — 닿지 못한다(고치기 전: 교통 5 의 180교대 가운데 5교대에서 큰 차 도로망이 36~169초 끊겼고, 두 교대에서는 출동하던 화학차가 길이 없어 서 있었다 — 길게는 133초, 한 번은 사건이 끝날 때까지 도착하지 못했다. 다섯 번 가운데 네 번이 해안로와 부두길의 조합이었다).
  - **하나 남은 길을 막게 된 것은 바로 치운다** (`tickTraffic` 의 장애물 반복문, 1초마다): 놓은 뒤에 다른 통제가 생겨 그 장애물(전면 차단·불법 주차)의 양 끝이 큰 차에게 끊겼으면, 그 자리에서 치우고 기록을 남긴다('…낙하물을 서둘러 치웁니다' / '…불법 주차 차량을 견인합니다'). 낙하물이 떨어진 뒤에 사고 구간이 통제되는 순서와 사건의 통제 둘이 겹치는 경우를 받아 낸다. 이 파일이 놓은 것 때문에 도시가 끊긴 채 남지 않는다. (재난(N6)이 여러 길을 한꺼번에 막을 때도 같은 규칙이 적용되지만, 그쪽과 합친 뒤에 실제로 돌려 확인해야 한다.)
- **불법 주차 후보** 는 양 끝 교차로에 길이 셋 이상 닿는 이면 도로만(꺾이는 점·막다른 끝은 뺀다). 고를 때는 **통행량 어림**(`throughFlow`: 모든 교차로 쌍의 가장 빠른 길이 그 구간을 지나는 횟수, 지도가 고정이라 한 번만 센다)으로 가중한다 — 지름길로 쓰이는 골목일수록 차가 서 있다. **낙하물·고장 차량** 도 같은 값으로 가중한다. 고르게 뽑으면 부대가 실제로 마주치는 일이 교대당 0.13회뿐이었다(가중 뒤 보통 0.4회, 교통 5 에서 1회).
- **한 차로를 막은 것(고장 차량 등) 곁을 지나는 부대는 본 것을 알린다**(제보보다 먼저면 그때 알려진다). 길을 막지 않으므로 그대로 지나간다. 불법 주차는 작은 차가 지나가도 알려지지 않는다(원안대로 큰 차가 가 보아야 한다).
- **가는 도중에 알려진 장애물**(다른 부대의 보고·제보) 앞에서는 거기까지 가 보지 않고 그 자리에서 돌아선다.
- **`findRoute` 는 차단기 대기 시간을 "거기 닿을 즈음까지 남은 만큼"만 더한다**(`edgeTime` 은 원안대로 `+ wait`). 멀리 있는 부대의 예상 도착 시간이 곧 올라갈 차단기 때문에 부풀지 않는다. `tickUnits` 의 남은 시간 셈도 같다.
- **시간대** 는 8시·18시를 가운데로 한 종 모양(표준편차 1시간)이다. 교대는 9~17시(또는 22시대)에 시작하므로 "출근·퇴근 시간대" 안내는 9시 10분 전이나 16시 50분 뒤에 시작한 교대에서만 나온다(드물다). 나머지 낮 교대는 0.82~1.1, 밤은 0.7.
- **`overallLevel`** 은 교통이 3 이 아닐 때만 평균에 넣는다(3 은 손잡이가 없는 것과 같다 — 프리셋의 종합 난도 표시가 바뀌지 않는다).
- **통계**: `closures` = 전면 공사, `obstacles` = 한 차로 공사·고장 차량·낙하물 + **발견된** 불법 주차, `detours` = 길이 막혀 되돌아 나온 횟수(출동·이송·복귀 모두).
- **열차의 `pos`** 는 머리의 위치다. 꼬리가 지도를 벗어날 때까지 `railLen + len` 까지 간다(그림은 철길 안에 있는 객차만 그린다).
- **화면**: 띠의 값은 실제 값을 0.9초 시상수로 따라간다(12초마다 색이 뚝뚝 바뀌지 않게). 멀리서 볼 때는 띠의 최소 굵기 2.6화소, 투명도 +0.2. 축소 창은 띠와 알려진 통제 점선만. 장애물 표식은 `drawObstacleMark`(범례에서 다시 쓸 수 있다).
- **난이도 창**: `d[k.key] ?? 3` — 교통 손잡이가 없는 저장 설정에서도 값이 보이게 (`panels.tsx` `DifficultyPanel` 두 군데).
- 알려진 한계: 달아나는 차(`pursuit.ts`)는 차단기를 무시한다. 사건의 통제끼리만 겹쳐 생기는 끊김(이 파일이 놓은 것이 끼지 않은 경우)은 예전 그대로 사건이 끝나야 풀린다.
