# R2 — 대응 방식 다양화: 같은 임무, 여러 방법

공통 규칙은 `docs/specs/README.md`. 브랜치 `wf/methods`, 개발 서버 포트 **5213**(H1 5210 · R1 5211 · G4 5212 다음).

사용자 요청(그대로): "대응 방법이 너무 1가지 밖에 없는 것 같아서 단조로우니까 대응 방식도 더 추가하라고 해줘. 예를 들면 물에 빠진 사람을 항상 구명줄로 구하는데 이것도 각자 장비 따라서 없으면 헤엄쳐서 구한다거나 하는 식으로."

한 줄로: 한 임무(`WorkKind`)를 이루는 **방법(Method)** 을 여럿 두고, 그 일을 맡은 대원이 **자기 장비·자기 능력·자기가 본 상황**으로 고른다. 장비가 없거나 방법이 실패하면 다른 방법으로 바꾼다. 관찰자는 기록 문구, 대원의 자세와 손에 든 것, 보고서 문장으로 "이번엔 다르게 했네"를 본다.

**선행 관계**: ROADMAP 의 구현 순서는 R1(부대 편성·개인 장비·헬기) → H1(부상과 사망) → X6(위험의 현실화) → **R2** → R3(분야별 대응 교본)이고, G4·G5·U2 는 따로다(G5 는 R2 보다 먼저 구현된다). 이 문서는 같은 날 쓰인 `R1-crews.md`·`H1-injuries.md`·`X6-catastrophe.md`·`G4-scene-legibility.md`·`G5-combat-fx.md` 를 읽고 그 이름에 맞췄다(10절). **R1 이 먼저 합쳐지므로 R1 의 이름이 기준이다.** R1 이 아직 합쳐지지 않았을 때는 같은 이름을 내보내는 얇은 모듈(`gear.ts`, 3.3 끝)로 대신한다. R3 는 이 문서의 틀(방법 표·고르는 점수) 위에 행과 조건을 더한다.

**줄 번호를 쓰지 않는다.** `wf/b3`(executor·commander·agents·types·sceneManager)·`wf/p1`(hazards·grid·beliefs)과 R1·H1·X6 가 같은 파일을 고친다. 위치는 파일·함수·`case` 이름으로 가리킨다.

**자기 파일**(새로 만든다):

| 파일 | 하는 일 | 진실을 읽어도 되는가 |
|---|---|---|
| `src/sim/field/methods.ts` | **판단부**: 방법 표 `METHOD`·문구 표 `SAY`·임무별 갈래 `WORK_MODE`, 장비 판정 `canUse`, 수영 능력 `swimOf`, 고르기 `chooseMethod`·`methodFit`, 지형 계산 `reachOf`·`landComp`·`catchPoint`·`onWater`·`swimCost`·`boatCost`, 대상 열쇠 `targetKey`, 탐지 배율 `searchMul` | **안 된다** — 테스트가 금지어를 검사한다(3.2) |
| `src/sim/field/gear.ts` | **장비 판정의 얇은 층**: R1 이 있으면 `crews.ts` 의 함수를 감싸 같은 이름으로 내보내고, 없으면 부대 단위 대체(3.3 끝)를 담는다. `methods.ts`·`methodRun.ts` 는 장비를 이 파일로만 본다 | 판단용(`kitCount`·`kitName`·`swimBonus`·`seatsLeft`·`SHARED`)은 진실을 읽지 않는다. 효과용(`kitWorks`·`useKit`·`kitTool`·`bestTool`)은 실행부만 부른다 |
| `src/sim/field/methodRun.ts` | **실행부**: 방법별 효과(`runWaterRescue`·`runSuppress`·`blockerRate` 등), 공통 함수 `startMethod`·`recheckOnArrive`·`switchMethod`·`recordMethod`·`recordAir`·`landCasualty`·`pullAshore`·`waterTick`·`senseOf`·`mrng`·`swimTrouble`, 실행 도구 `ExecKit` 의 타입 | 된다(`executor.ts` 와 같은 자격) |
| `src/sim/field/rules/methods.ts` | 세계 규칙: 물살 `s.flow`, 안벽 표시 `s.quay`, 송풍기 `s.fan`, 뭍에 놓인 보트 대원 정리, 물 칸 위에 쓰러진 대원의 안전장치 | 된다(`hazards.ts` 와 같은 자격) |
| `src/sim/field/orders/methods.ts` | 지휘 규칙: 수난 구조가 거듭 실패하면 수난 장비를 가진 부대를 더 부른다(맡을 사람이 아예 없는 경우는 B3 의 기존 블록이 맡는다 — 4.1) | 안 된다(`tests/ext.test.ts` 가 이미 검사한다) |
| `src/view/scene/methodsLayer.ts` | 방법 그림: 줄·장대·고무보트·송풍기·지지대·에어백 | 화면 계층(읽기만) |
| `tests/methods.test.ts` | 8절 | — |

**공용 파일 수정**(9절에 함수와 이유): `types.ts`, `crews.ts`(R1 의 `KitDef` 에 `uses?`·`batch?` 두 칸, `KITS` 아홉 줄, 역할의 기본 장비 몇 줄), `resources.ts`(R1 이 고친 `createRoster`·`createAidUnit` — 수량 복사와 R2 장비의 따로 하는 고장 추첨), `field/rules/air.ts`(R1 — 호이스트 완료에 기록 한 줄, 끌려가는 대상은 기다리는 한 줄), `field/executor.ts`, `field/agents.ts`(`casFact`·`perceive`·`fitFor`), `field/brain.ts`, `field/commander.ts`(6단계에 조건 두 군데), `field/hazards.ts`(`flashbang` 한 줄, `tickGas` 한 줄), `debrief.ts`, `field/scenes/index.ts`(import 두 줄), `view/renderScene.ts`, `view/scene/sprites.ts`, `ui/panels.tsx`, `scripts/sweep.ts`(`--methods`). R1 이 없을 때만 `difficulty.ts`(`Tuning` 두 칸). 객체 모양을 맞추는 생성 리터럴 몇 곳(3.1 끝 — 속도만의 문제).

**건드리지 않는다**: `dispatch/*`, `sceneManager.ts`(대원 리터럴에 칸을 넣는 한 줄만 예외 — 3.1 끝), `builders.ts`·`field/scenes/{crime,major,disaster}.ts`(현장 생성은 그대로 — `scenes/index.ts` 의 import 두 줄만), `field/injury.ts`(H1 — 부르기만 한다), X6 의 `catastrophe.ts`·`ops.ts`(읽기만), `city.ts`·`cityPlan.ts`, `tests/sim.test.ts`, `README.md`·`CLAUDE.md`·`docs/ROADMAP.md`(합친 뒤에 한꺼번에).

---

## 1. 지금 상태 — 방법이 하나뿐인 곳

(조사 기준 `1ca465d`. R1·H1 이 합쳐지면 일부가 바뀐다 — 오른쪽 열.)

| 유형 · 임무 | 지금의 방법 (하나) | 근거 | R1·H1 뒤 |
|---|---|---|---|
| 수난 구조 `waterRescue` | 물가에서 시야가 닿는 3.6칸 안까지 가서 줄을 던진다. 실패가 없고 시간만 다르다(`9/(0.4+0.8×rescue+0.5×tool)`). 부서 제한이 없어 경찰·구급도 맡는다 — "누구나 줄을 가지고 있다"고 보는 셈. 헬기·구조정 대원도 뭍을 걸어 다니며 같은 일을 한다 | `executor` `case 'waterRescue'`, `agents` `fitFor`, `commander` 구조 대상 블록(믿음 위치의 칸이 `T.WATER` 면 `want('waterRescue')`) | R1: `tool` 자리가 `toolFor('water')`(로프 .9 · 구명환 .8 · 맨손 .12). 소방 헬기는 물 현장 상공에서 호이스트(`hoist` 작업). 그래도 **방법은 줄 하나** |
| 그 그림 | 대원 → 대상 곡선 줄 + 끝의 구명환. 대원은 맨손 기본 자세 | `renderScene` "구조 줄" 블록, `agentPose` 의 `default` | G4 는 이 블록을 건드리지 않는다(R2 몫이라고 적어 두었다) |
| 화재 진압 `suppress` | 3.2칸·시야 안에서 호스 방수 하나. 펌프·물이 없으면 아무것도 못 한다. 경찰·구급은 작은 불도 끌 수 없다 | `executor` `case 'suppress'`·`spray`, `agents` `fitFor` | R1: 자격이 `hose` 장비로 |
| 문·잔해 `force`·`clear` (+ 이동 중 하위 작업) | 한 식(능력 + `u.tool`)의 속도로 `p.hp` 를 깎는다. 도구 구분이 없다. 그림은 늘 도끼 | `executor` `workOnBlocker`·`unblock`, `renderScene` `agentPose` | R1: `toolFor('force'/'clear')` — 속도는 장비를 따르지만 **무엇으로 했는지는 드러나지 않는다** |
| 구출 `extricate` (차량·붕괴) | `rescue × (0.35 + 0.65 × tool)` 하나. 맨손은 35% 속도라는 연속값일 뿐. 그림은 늘 유압 전개기 | `executor` `case 'extricate'` | R1: `toolFor('extricate')` |
| 탐지 (붕괴 현장 수색) | 구조 공작차 대원의 은폐도 ×0.45 라는 숫자 하나. 청음·탐지견 같은 행동은 없다(README '없는 것') | `agents` `detectRadius` | R1: `searchKit` 장비로(수동 효과) |
| 수색 `search` | 경유점을 걸어서 훑는다. 헬기 대원도 걷는다 | `executor` `sweepPoints`·`case 'search'` | R1: 경찰 헬기의 공중 관측(상공), 열화상(`tic`) 수동 효과 |
| 무장 `engage` | 분기는 여럿이다(추격 검거·동시 진입·방 진입·섬광탄·덮치기·엄폐 사격) — 이미 '방법'이 있는 유일한 곳 | `executor` `case 'engage'` | R1: 테이저(`taser`)·방패(`shield`)·저격 소총(`sniper` 의 거리 감쇠). 비살상탄·결정적 저격은 없다 |
| 응급 `treat`·`load` | 처치가 끝나면 탑승. 기본/전문 처치는 완료 문구만 갈린다 | `executor` `case 'treat'`, `commander` 구조 대상 블록의 `ambulances` | R1: 위중 환자는 의료 헬기 먼저. 즉시 이송은 없다 |
| 가스 `mitigate`(밸브)·`perimeter` | 밸브를 잠그는 것 하나, 경찰의 출입구 통제 하나. 환기·대피 안내가 없다 | `executor` `case 'mitigate'`, `hazards` `tickGas` | R1: `plugKit`·`gasMeter` 수치만 |
| 이송 `carry` | 업기 하나(속도 배율만) | `executor` `moveSpeed` | R1: 들것(`stretcher`) 배율 |

실제 기록 한 토막(`npx tsx scripts/sweep.ts 1 --force water/std --log S7`): 구조1 권도현(지휘)이 구급1 민지원에게 "구조 대상 A 수난 구조 맡아라"를 지시했다 — 구급 대원도 줄을 던질 수 있다고 보는 셈이다. 30초 뒤 권도현이 "구조 대상 A를 물에서 끌어냈습니다". 기록 문구에는 '줄'이라는 말조차 나오지 않는다(방법은 머리 위 라벨 '구조 줄 투척'과 줄 그림으로만 드러난다).

정리:

- **R1 뒤에도 '방법'을 고르는 단계는 없다.** R1 은 장비가 "맡을 수 있는가(자격)"와 "얼마나 빠른가(`toolFor` 의 가장 좋은 값)"를 정하지만, 같은 일을 다른 방법으로 하는 갈래는 R2 몫이라고 적어 두었다(R1 "이번에 하지 않는 것"·결정 11).
- **'방법'을 기록하는 칸이 어디에도 없다**(`WorkItem`·`Task`·`Casualty`). 그래서 보고서도 방법을 말하지 못한다(`debrief.evaluate` 의 문장은 문제·사망 문장과 맺음말뿐).
- 이미 있는 선례 — 이 문서는 이것들을 일반화한다:
  - `executor` `engage`: 섬광탄이 있으면 던질 자리로, 없으면 쏘지 않고 다가가 덮친다(장비 유무 → 다른 방법).
  - `brain` 장비 문제: 펌프 고장 → 예비 펌프, 용수 소진 → 소화전(장비 문제 → 대체 행동).
  - `executor` `moveTo`: 막힌 길 앞에서 우회 / 강제 개방 / 포기를 믿음 기반 비용으로 고른다.
  - `agents` `fitFor` `extricate`: 적합도가 낮아도 25초가 지나면 누구든 맡는다(사건이 끝나게 하는 장치).
- README '없는 것'과 ROADMAP C4 에 적힌 것("보트·잠수를 쓰는 수난 구조", "청음·탐지견 같은 행동", "환기, 주변 건물 대피 안내", "하류에서 기다리는 차단선")의 대부분이 이 문서에 들어온다. H1 은 "헤엄 구조(익수)·구조 대상이 구조자를 붙잡음"의 **규칙과 호출**을 R2 몫으로 남겼다(H1 "연관 설계서와 나누는 선").

## 2. 범위

**하는 것**: 방법의 틀(자료형·고르기·바꾸기·기록·그림·보고서), 4절의 갈래별 방법, R1 의 장비 표에 R2 가 쓰는 장비 아홉 가지를 더하기, R1 이 없을 때의 장비 대체(`gear.ts`).

**하지 않는 것**:
- 새 사건 유형·새 시나리오·새 부대 종류. 탐지견·드론은 부대·장비가 생기면 7단계에서 켠다.
- 지휘관이 방법을 지시하는 것(3.2). 지휘관은 지금처럼 "무엇을 누구에게"만 정한다. 이송 수단(헬기/구급차)은 R1 이 지휘관의 탑승 배정에 넣었다 — R2 는 기록만 한다. **현장 단위의 전술 모드(내부 공격 ↔ 외부 방어)와 진입 금지 구역은 X6** 의 지휘 판단이다. R2 는 그 안에서 대원 한 사람이 고르는 갈래다(4.5).
- R1 이 이미 만드는 행동을 다시 만드는 것: 소방 헬기의 호이스트, 테이저, 방패의 방호, 열화상·탐지 장비의 수동 효과. R2 는 이것들을 **방법 이름으로 기록**하고 그림·보고서에 싣는다.
- 이송(`carry`)의 방법(업기·들것·끌기)과 교통 통제(`traffic`)의 방법. 이송은 R1 의 들것 배율, 통제는 R1 의 경광봉으로 이미 사람마다 다르다. R3 가 행을 더한다.
- 잠수(물 밑 수색)·얕은 물 걸어 들어가기 — 현장 격자에 깊이가 없다.
- 기존 동작의 수치 재조정. 지금의 방법(R1 뒤의 식)은 표의 "평소 방법"으로 **같은 식 그대로** 남긴다.

---

## 3. 방법(Method)의 틀

### 3.1 자료형 (`types.ts` — 추가만)

합집합에 붙일 때는 새 줄로(`docs/specs/README.md` 2절). `KitId`·`KitItem`·`RoleId` 는 R1 이 넣는다.

```ts
// ───────────────────────── 대응 방법 (R2) ─────────────────────────
/** 같은 임무를 이루는 여러 방법. 내용(조건·속도·위험·문구)은 field/methods.ts 의 METHOD 표 */
export type MethodId =
  | 'hand' | 'pole' | 'ring' | 'rope' | 'improvise' | 'catch' | 'swim' | 'tend' | 'boat' | 'hoist'   // 수난 구조 (waterRescue · hoist 는 R1 의 공중 임무)
  | 'kick' | 'irons' | 'ram' | 'hydraulic' | 'handClear' | 'toolClear'                                 // 문·통로 (force·clear, 이동 중 하위 작업)
  | 'manual' | 'basic' | 'spread' | 'roof' | 'rapid' | 'haul' | 'tunnel' | 'airbag' | 'shore'          // 구출 (extricate)
  | 'call' | 'listen' | 'line' | 'hail' | 'thermal'                                                     // 수색·탐지 (search)
  | 'interior' | 'defensive' | 'aerial' | 'extinguisher' | 'ventilate'                                  // 화재 (suppress)
  | 'chase' | 'breach' | 'bang' | 'tackle' | 'cover' | 'taser' | 'shield' | 'beanbag' | 'sniper'       // 무장 (engage)
  | 'stay' | 'rush' | 'airlift'                                                                         // 응급 (treat · 이송 수단)
  | 'seal' | 'ventFirst' | 'cordon' | 'announce'                                                        // 누출 조치·통제 (mitigate · perimeter)
  | 'air' | 'drone' | 'dog';                                                                            // 야외 수색 (기록 전용·7단계)
/** 왜 이 방법을 골랐는가 (기록 문구·보고서 문장이 쓴다) */
export type MethodWhy = 'doctrine' | 'near' | 'noGear' | 'tooFar' | 'weak' | 'fast' | 'failed' | 'broken' | 'danger' | 'quiet' | 'team';
/** 방법을 쓴 기록 한 줄 (보고서는 이것과 Problem 으로만 방법을 말한다) */
export interface MethodUse {
  t0: number;                                     // 이 방법을 시작한 시각 (구출 시간 = t − t0)
  t: number; rid: number; unitId: number; work: WorkKind; method: MethodId; why: MethodWhy;
  ok: boolean;                                    // true = 이 방법으로 끝냈다, false = 이 방법을 접었다 (실패·고장·조건 상실)
  cas: number; prop: number; hostile: number; region: number; tile: number;   // 대상 (없으면 -1). 문·잔해 하위 작업은 tile 과 prop = s.propAt[tile], work = 하위 작업의 kind
  missing?: KitId;                                // why === 'noGear' 일 때 빠진 장비 (보고서 '…이 없었음')
  eventId: number;                                // 그때 남긴 기록 (접은 줄이면 그 문제 기록)
}
```

R1 의 `KitId` 끝에 새 줄로(R2 가 쓰는 장비 — 3.3):

```ts
  | 'pole' | 'pfd' | 'drysuit' | 'raft' | 'extinguisher' | 'fan' | 'airbag' | 'shoring' | 'beanbag';
```

기존 타입에 더하는 칸(모두 선택 칸):

```ts
// Task
method?: MethodId; mwhy?: MethodWhy; missing?: KitId;  // 지금 쓰는 방법, 고른 까닭, (noGear 면) 빠진 장비
tried?: MethodId[];                               // 이 임무에서 접은 방법 (다시 고르지 않는다. 모두 접었으면 비운다)
mtry?: number;                                    // 지금 방법을 시도한 횟수 (투척이 빗나간 횟수 등)
mbad?: number;                                    // 고른 방법의 조건이 맞지 않은 지 몇 초 (3초면 바꾼다)
mt0?: number;                                     // 지금 방법을 시작한 시각 (MethodUse.t0)
marr?: boolean;                                   // 도착 재선택을 이미 했다 (3.2)
mcands?: { m: MethodId; score: number }[];        // 고를 때의 후보와 점수 (패널이 보여 준다)
// FieldAgent
afloat?: 'boat';                                  // 보트에 타고 있다 (헤엄은 "선 칸이 물" 로 판단하므로 칸이 없다)
mrng?: Rng;                                       // 방법 판정 난수 (처음 쓸 때 만든다, 3.5)
mfail?: { k: string; m: MethodId; until: number }[];   // 접은 방법의 기억 (대상 열쇠 targetKey, 그 시각까지 다시 고르지 않는다)
msaid?: MethodId[];                               // 이 사건에서 시작을 알린 탐지 방법 (한 번만 알린다)
wetSince?: number;                                // 물 칸에 들어간 시각 (뭍이면 undefined)
wetTired?: boolean;                               // 이번에 물에 들어가 '지침' 사고를 이미 겪었다
// Casualty
freedHow?: MethodId; freedBy?: number;            // 어떤 방법으로 누가 구했는가 (보고서 타임라인)
rush?: boolean;                                   // 구급 대원이 즉시 이송을 정했다
// CasBelief (perceive 가 본 것 — casFact 가 채운다)
water?: boolean;                                  // 물속
drift?: number;                                   // 떠내려가는 속도 (본 그대로)
veh?: number;                                     // 갇힌 차량 소품의 id (차 안이 아니면 없음) — 같은 차의 고립자 세기
pit?: boolean;                                    // 구덩이(맨홀) 아래 — 줄로 끌어올려야 한다
rush?: boolean;
// Hostile
stunHow?: MethodId;                               // 마지막으로 무력화한 수단 ('bang'·'taser'·'beanbag') — 검거 기록이 쓴다
// Problem
times?: number;                                   // 같은 작업·같은 대상에서 되풀이된 횟수 (METHOD_FAIL 만, 없으면 1)
// Scene
flow?: number;                                    // 물살 (칸/초). rules/methods.ts 가 관리
quay?: boolean;                                   // 물가가 높은 안벽이다 (선박 화재의 부두). rules/methods.ts 가 처음 한 번 정한다
fan?: { x: number; y: number; until: number; rid: number; power: number } | null;   // 돌고 있는 송풍기 (power 1, 맨몸 환기 0.5)
// Incident
methods?: MethodUse[];
// ShiftReport
methods?: Partial<Record<MethodId, number>>;      // 이 교대에 성공한 방법별 횟수
// ProblemCode (끝에 새 줄로)
| 'METHOD_FAIL'                                   // 대응 방법이 실패해 다른 방법으로 바꿨다
// TaskKind (끝에 새 줄로)
| 'ashore'                                        // 물 위의 대원이 뭍으로 돌아간다
```

`haz` 사실의 값(`{ kind, active, x, y }` — 타입이 따로 없다)에는 `sub?: 'crack' | 'valve' | 'fuel'` 을 더한다(균열·가스 밸브·차량 연료. 4.3·4.8). 값을 만드는 곳은 `agents.perceive` 의 두 곳과 `executor` `case 'mitigate'` 의 두 곳이다(9절).

R1 의 `crews.ts` `KitDef` 에 두 칸(3.3): `uses?: number`(처음 수량 — 명부가 `KitItem.uses` 로 복사한다), `batch?: 'r2'`(고장 추첨을 R1 의 흐름 밖에서 따로 받는 장비).

`WorkKind` 는 **늘리지 않는다**(R1 이 더하는 `hoist`·`airDrop` 은 R1 몫). 방법은 임무 안의 갈래다. 그래서 지휘관 규칙(`want('waterRescue')`)과 기존 테스트(`tests/major.test.ts` 선박 화재의 `w.kind === 'waterRescue' && w.status === 'done'` 개수)가 그대로 동작한다. 근거: `engage` 가 이미 한 `case` 안에 일곱 갈래를 품고 있고, 새 `WorkKind` 를 만들면 `want`·`cancel`·`fitFor`·`workLabel`·테스트를 두 갈래로 관리해야 한다.

**객체 모양**(CLAUDE.md 함정 "자주 도는 객체의 모양" — 속도만의 문제): 새 선택 칸은 생성 리터럴에도 같은 순서로 `undefined` 로 넣는다 — `Task` 는 `executor.makeTask`, `Casualty` 는 `kit.ts` `addCas`·`hazards.ts` 의 주변 시민 리터럴, `Scene` 은 `kit.ts` `baseScene`(교대 중에 생기는 현장은 `createScene`), `Hostile` 은 그것을 만드는 `kit.ts` 의 함수, `Incident` 는 `incidents.ts`, `FieldAgent` 는 R1 의 `agents.makeAgent`(R1 이 없으면 `sceneManager.unitArrived` 의 대원 리터럴 — 칸을 넣는 이 한 줄만 고친다), `Problem` 은 `events.raiseProblem`.

### 3.2 누가 어디서 고르는가 — 맡은 대원이, 판단 전용 파일에서

| 후보 | 장점 | 문제 |
|---|---|---|
| (가) 지휘관이 고르고 지시에 싣는다 | 지시 문구에 방법이 드러난다 | 지휘관의 믿음은 묶음 보고(5초)만큼 낡아, 떠내려가는 사람과의 거리·의식을 늦게 안다. R1 원칙상 지휘관이 조직의 장비를 아는 것은 되지만, 숨은 고장은 모르고 상황(거리·물살)은 현장의 그 대원이 가장 새롭게 본다 |
| **(나) 맡은 대원이 고른다** | 자기 장비·자기 능력은 본인이 정확히 안다. 상황도 그 대원이 가장 새롭게 본다 | 고르는 코드를 진실과 떼어 놓아야 한다 → 판단부를 별도 파일로 |
| (다) 실행기가 진실을 보고 고른다 | 코드가 짧다 | "진실로 판단"하는 예외가 하나 는다. README '알려진 문제'의 정보 격리 예외 3건을 늘리지 말라는 규칙에 어긋난다 |

**결정: (나).** 고르는 일은 `methods.ts` 의 순수 함수 `chooseMethod` 하나가 한다. 실행기(`executor`·`methodRun`)는 그 결과를 받아 `t.method` 에 넣고 효과를 적용할 뿐이다. 지휘관은 "누구에게 맡길지"만 정하는데, `fitFor` 가 `methodFit`(그 사람이 지금 쓸 수 있는 가장 좋은 방법의 점수)을 쓰므로 줄을 가진 사람이 먼저 뽑힌다(지금도 `assign` 이 `fitFor` 를 쓴다). R1 의 `airDecide.ts`(헬기의 판단 — 믿음만)와 같은 나눔이다.

**시그니처**(정보 격리를 모양으로 보장한다):

```ts
// methods.ts
export interface Sense { smoke: number; heat: number }        // 대원이 선 칸의 감각 (실행부가 senseOf 로 재서 넘긴다. fitFor 에서는 0)
export interface MTarget { cas: number; prop: number; hostile: number; region: number; tile: number }   // 없으면 -1
export interface MethodPick { m: MethodId; why: MethodWhy; cands: { m: MethodId; score: number }[]; missing?: KitId }
export function chooseMethod(sim: Sim, s: Scene, a: FieldAgent, work: WorkKind, tg: MTarget, t: Task | null, sense: Sense): MethodPick | null;
export function methodFit(sim: Sim, s: Scene, a: FieldAgent, w: WorkItem): number;      // chooseMethod(…, t = null, sense = 0) 의 1등 점수, 없으면 0
export function reachOf(s: Scene, x: number, y: number, maxR = 4, from: FieldAgent | null = null): { x: number; y: number; d: number } | null;
    // (x, y) 에서 가장 가까운 뭍 칸(staticPass 이고 물·VOID 가 아님). from 이 있으면 from 과 같은 뭍 성분의 칸만(from 이 물 위면 from 에서 가장 가까운 뭍 칸의 성분).
    // 반경 maxR 안에 없으면 격자 전체로 넓히고, 그래도 없으면 null — 부르는 쪽이 s.safe → s.staging 으로 대신한다. 같은 거리면 칸 번호가 작은 쪽
export function landComp(s: Scene): Int32Array;      // 뭍 칸의 연결 성분 번호 (다리·문으로 이어진 칸은 같은 성분). s.staticVersion 이 바뀔 때만 다시 칠한다 (WeakMap<Scene, …> — 같은 입력 = 같은 값)
export function targetKey(work: WorkKind, tg: MTarget): string;      // 'waterRescue:c3', 'force:t412' … (mfail·같은 대상 판정)
```

`MethodCtx`(3.4)는 `chooseMethod` 안에서만 만든다(export 하지 않는다). 대상의 위치·상태·물살은 **`a.beliefs` 의 그 대상 사실에서만** 채운다. 실행부가 넘기는 것은 `sense` 하나다 — 그래서 진실(`c.x`, `c.drift`)을 판단에 끼워 넣을 길이 모양으로 막힌다.

**판단부(`methods.ts`)가 읽어도 되는 것**:
- `a.beliefs`(그 대원의 믿음 — 구조 대상의 위치·상태·물속 여부·떠내려가는 속도·차량·구덩이는 `CasBelief` 의 새 칸으로, 균열·밸브·연료는 `haz` 사실의 `sub` 로 들어온다. X6 가 합쳐져 있으면 `ops` 사실(전술 모드·위험 구역)도).
- 현장의 생김새: `s.tiles`·`s.region`·`s.regions`·`s.exits`·`s.staging`·`s.safe`·`s.kind`·`s.rules`·`s.quay`(지휘관·지휘 규칙과 같은 자격. `orders/crime.ts` 주석: "`s.region` 은 건물의 생김새라 읽어도 된다". `s.quay` 는 세계 규칙이 처음 한 번 정하는 생김새 표시다).
- 공개된 것: `sim.weather`, `sim.disaster` 의 `kind`·`phase`(특보), `sim.t`, `s.negotStart`·`s.entryOrdered`·`s.fan`(지휘 상태·눈에 보이는 장비), 자기 조직의 부대 상태(`sim.units`).
- 자기 몸: `sim.responders[a.rid]`, `gear.ts` 의 판단용 함수(`kitCount`·`kitName`·`swimBonus`·`seatsLeft`·`SHARED` — 알려진 고장만 반영, 숨은 고장은 모른다), `a.task`, `a.mfail`.
- 동료가 하는 일: `s.agents` 의 `task.kind`·`task.method`·`task.workId`·`task.cas`·`task.prop`·위치(같은 무전망에서 들린다 — `commander.assign` 도 위치를 쓴다), 동료의 장비(`kitCount` — 조직이 안다).
- `Sense`: 실행부가 **대원이 선 칸에서** 잰 연기·열(몸의 감각. `brain.dangerScore` 가 자기 둘레 3×3 의 `s.fire` 를 읽는 것과 같은 자격 — X6 도 같은 판단을 적었다).

**읽으면 안 되는 것**(테스트가 글자로 검사한다): `s.props`, `s.casualties`, `s.hostiles`, `.truth`, `s.fire[`, `s.smoke[`, `sim.scenes`, `s.variant`(시나리오 변형 — 관제·지휘관은 이름표로만 안다), `.fault`(R1 의 숨은 고장), `kitWorks`·`useKit`(효과·소모 — 실행부만). `methods.ts` 는 `agents.ts`·`hazards.ts`·`executor.ts`·`methodRun.ts`·`crews.ts` 를 import 하지 않는다(`agents.fitFor`·`perceive` 가 `methods.ts` 를 부르므로 순환을 만들지 않는다. 장비는 `gear.ts` 로만). import 해도 되는 것: 타입, `grid.ts`(`staticPass`·`losWalls`·`tileOf`), `rng.ts`(`hashStr`), `util.ts`, `gear.ts` 의 판단용 함수.

**고르는 때**:
1. **처음**: 실행부가 그 임무를 처음 돌릴 때(`t.method` 가 없고 `t.mt0` 도 없을 때) `startMethod`.
2. **도착 재선택**(한 번): `suppress`·`mitigate`·`extricate` 에서, 그 방법의 작업 자리에 처음 닿은 틱(`moveTo` 가 처음 `'arrived'`)에 `t.progress === 0 && t.phase === 0` 이면 `recheckOnArrive` 가 지금의 `senseOf` 로 한 번 더 고른다(`t.marr = true`). 감각 조건(급박 구출·배연·환기 후 차단)은 대원이 현장 자리에 선 뒤에야 의미가 있기 때문이다 — 처음 고를 때 대원은 대개 대기 지점에 있다. 다른 방법이 1등이면 **예정된 전환**(아래 4)으로 바꾼다.
3. **바꿀 때** — 이 셋뿐이다. 더 좋은 방법이 새로 보인다고 바꾸지는 않는다(왔다 갔다 방지).
   - 그 방법이 실패로 끝났다: `switchMethod(…, 'failed', 사유)`.
   - 장비가 작동하지 않는다(`kitWorks` 가 false — 숨은 고장이 드러났다): `switchMethod(…, 'broken', 사유)`.
   - 고른 방법의 조건(`can`·`canUse`)이 3초 넘게 맞지 않는다(`t.mbad ≥ 3`): `switchMethod(…, 'tooFar' 또는 'team', 사유)`. 예: 장대를 골랐는데 대상이 떠내려가 2칸 밖으로 나갔다(`tooFar`). 줄을 던지려는데 같은 대상에게 동료가 헤엄쳐 들어갔다(`team` — 줄 확보로). 도착 전에 대상을 아직 못 본 대원(믿음이 낡았다)이 물가에서 처음 보고 다시 고르는 것도 이 길로 온다. 비살상탄을 다 쓴 것도 조건 상실이다.
4. **예정된 전환** — 방법 안의 단계로 넘어가는 것. `tried`·`mfail` 에 넣지 않고 `ok: false` 줄을 남기지 않는다(실패가 아니다): 배연 설치가 끝나면 `interior`(4.5), 동료가 이미 끌고 오는 대상을 맡은 대원이 줄을 가졌으면 `tend`(4.1), 도착 재선택(위 2). 평소 방법이 아닌 쪽으로 바뀌면 시작 문구는 낸다.
5. `fitFor` 는 매번 `methodFit` 을 부른다(값만 쓰고 `t` 에 쓰지 않는다).

### 3.3 장비와 능력

**R1 이 있을 때**(정해진 순서 R1 → H1 → X6 → R2 이므로 기본): 장비는 R1 의 개인 장비(`Responder.kit`)다. `methods.ts`·`methodRun.ts` 는 R1 함수를 직접 부르지 않고 `gear.ts` 를 거친다(R1 이 없을 때도 같은 이름으로 컴파일되게):

| `gear.ts` 함수 | R1 이 있을 때의 몸 | 어디서 |
|---|---|---|
| `kitCount(sim, rid, id): number` | `hasKit` 이 false 면 0(알려진 고장 포함). 수량 장비(`isQty(id)` = `KITS[id].uses` 가 있거나 R1 이 수량을 채우는 `flashbang`·`taser`)면 `kitUses`. `scba` 는 `uses === undefined ‖ uses ≥ 60` 이면 1, 아니면 0. 그 밖 1. **수량이 없는 장비에는 `kitUses` 를 부르지 않는다**(R1 이 그 값을 정하지 않았다) | 판단부 |
| `kitName(id): string` | `KITS[id].name` | 판단부·보고서 |
| `swimBonus(sim, rid): number` | `roleOf(sim, rid)` 의 `RoleId` 로 아래 표 | 판단부 |
| `seatsLeft(sim, u): number` | `seatsOf(u) − u.patients.length` | 판단부 |
| `SHARED: boolean` | `false`(장비는 사람마다 따로) | 판단부 |
| `kitTool(sim, id, use): number` | `KITS[id].tool[use] × tn.toolMul`(상한 1.15), 없으면 0 — **고른 방법의 장비 값**. 맨손은 0.12 | 실행부 |
| `bestTool(sim, rid, use, I): number` | R1 의 `toolUse` — `toolFor` 의 순서대로 고른 장비에 `kitWorks` 를 불러, 숨은 고장이 드러나면 다음으로 좋은 장비, 다 없으면 맨손 0.12. (계획용 `toolFor` 는 판단부가 쓰지 않는다 — 방법 점수가 대신한다) | 실행부만 |
| `kitWorks(sim, rid, id, I): boolean` | 그대로(숨은 고장이면 이때 `EQUIP_FAIL` 을 남기고 false) | 실행부만 |
| `useKit(sim, rid, id, n)` | 그대로 | 실행부만 |

**판단부의 장비 판정은 `canUse` 하나**(장비 조건은 `METHOD` 의 `kits`·`altUnit`·`needUnit` 에만 두고 `can` 에는 넣지 않는다 — 그래야 `noGear` 까닭을 "장비를 빼고 다시 셈한 1등"으로 계산할 수 있다):

```ts
function canUse(c: MethodCtx, m: MethodId, ignoreKits = false): boolean {
  const d = METHOD[m];
  if (d.needUnit && d.needUnit.indexOf(c.u.kind) < 0) return false;          // AND: 이 부대여야 한다 (사다리차의 고가 사다리)
  if (ignoreKits || !d.kits.length) return true;
  if (d.altUnit && d.altUnit.indexOf(c.u.kind) >= 0) return true;            // OR: 이 부대면 장비 없이도 된다 (구조정의 보트)
  return d.kits.some((id) => kitCount(c.sim, c.a.rid, id) - (SHARED ? matesUsing(c, id) : 0) > 0);
}
```

`matesUsing(c, id)` = 같은 부대의 활동 대원 가운데 지금 `METHOD[task.method].kits` 에 `id` 가 든 방법을 하고 있는 수(자기 제외). R1 이 있을 때는 쓰이지 않는다.

**R1 의 표에 더하는 것**(`crews.ts` — 공용 파일 수정):

1. `KitDef` 에 `uses?: number`(처음 수량)와 `batch?: 'r2'`(고장 추첨 묶음) 두 칸.
2. `KITS` 에 아홉 줄, 역할의 기본 장비 끝에 붙인다:

| 장비 | 이름 | `KitDef` | 누가 든다 (R1 `ROLES` 의 기본 장비 끝에 더한다) |
|---|---|---|---|
| `pole` | 갈고리 장대 | group rescue, `tool { water: .7 }` | `engineer`(기관원 — 차에서 꺼내 온다), `ladderOp`, `boatRescuer` |
| `pfd` | 구명조끼 | group rescue | `ropeTech`, `boatRescuer`, `airRescuer` |
| `drysuit` | 드라이슈트 | group rescue | `ropeTech`, `boatRescuer` |
| `raft` | 구조용 고무보트 | group rescue, `faultable`, `batch 'r2'` | `ropeTech`(구조 공작차에 한 척) |
| `extinguisher` | 소화기 | group fire, `uses: 1`(한 개 = 12초 분사) | `engineer`, `patrolLead`, `emsDriver`, `eodGuard` |
| `fan` | 송풍기 | group fire, `faultable`, `batch 'r2'` | `engineer`, `ladderOp`, `decon` |
| `airbag` | 구조용 에어백 | group rescue, `faultable`, `batch 'r2'` | `extricator` |
| `shoring` | 지지대 | group rescue | `rescueLead` |
| `beanbag` | 비살상탄 발사기 | group police, `uses: 3`(발) | `tacLead`, `assaulter` |

3. **명부**(`resources.createRoster`·`createAidUnit` — R1 이 고친 함수. 공용 파일 수정):
   - 장비 복사(R1: 역할의 기본 장비를 `{ id }` 로)에서 `KITS[id].uses` 가 있으면 `{ id, uses: KITS[id].uses }`. R1 이 따로 채우는 섬광탄·테이저·공기는 그대로 둔다.
   - **고장 추첨은 R1 의 흐름에 끼우지 않는다.** R1 은 교대 명부를 `sim.rng.fork('kit')` 하나로 "대원 순서 × 장비 순서" 대로, 지원 부대를 `sim.rng.fork('aid:' + sim.aidUsed)` 하나로 "대원(자리 순서) → 펌프 상태 → 고장 추첨(대원 순서 × 장비 순서)" 순서로 뽑는다(R1 5절). 역할 장비 끝에 고장 나는 장비를 더하면 같은 흐름의 뒤 대원 능력치·뒤 장비 고장이 밀린다. 그래서 R1 의 고장 추첨 반복에 `if (KITS[id].batch === 'r2') continue;` 한 줄을 넣고, R2 장비는 그 반복이 끝난 뒤 같은 순서·같은 확률(`tn.kitFault`)로 따로 뽑는다 — 교대 명부는 `sim.rng.fork('kit-r2')`, 지원 부대는 `sim.rng.fork('aid-r2:' + n)`(n = 그 부대를 만들 때의 `sim.aidUsed`).
4. R1 의 장비 가운데 R2 가 쓰는 것: `rope`·`ring`(투척·줄 확보·끌어올리기), `irons`(할리건·도끼), `breachKit`(충격기), `spreader`(유압 구조기 — 문 개방·구출), `lightRescue`, `searchKit`(청음), `hose`, `tic`(열화상 수색), `taser`·`shield`·`sniper`(무장), `megaphone`(대피 방송·호출 수색), `bag`·`alsBag`·`doctorKit`(구급), `plugKit`, `scba`.

- 이 배치로 생기는 갈래(의도): 순찰·구급·의료 헬기 대원에게는 줄이 없다 → 헤엄·즉석 부력물·하류 차단. 펌프차의 줄은 진입대원(`firefighter`)에게만 있어, 부대 규모 1·2(최소 인원 — 진입대원이 빠진다)에서는 펌프차에 줄이 없다. 구조 공작차는 로프 대원이 줄·구명환·구명조끼·드라이슈트·고무보트를 든다.
- 기관원은 R1 에서 `hose` 가 없어 진압(`suppress`)을 맡지 못한다. 그래서 기관원의 송풍기는 가스 현장의 환기 후 차단(`mitigate` 의 `ventFirst`)과 예비용이고, 화재의 배연(`ventilate`)은 사다리 조작원·측정·제독 대원이 한다(의도).
- R1 의 `toolFor('water')`·`toolUse(…, 'water')` 는 기관원·사다리 조작원에게 장대(.7)가 생겨 맨손 .12 에서 오른다. R1 에서 그 값을 쓰는 곳은 `waterRescue` 의 `fitFor`(`toolFor`)와 실행 식(`toolUse`)뿐이고, 둘 다 R2 가 방법 값(`methodFit` · 고른 방법의 `kitTool`)으로 바꾼다(3.4·4.1).

**수영 능력**(R1·H1 에 사람별 칸이 없으므로 함수로):

```ts
swimOf(sim, a) = clamp(0.15 + 0.45 × fitness + 0.3 × skills.rescue + swimBonus(sim, rid) + 개인차, 0, 1)
  개인차: (hashStr(r.name + ':swim') % 1000 / 1000 − 0.5) × 0.3      // 난수 흐름이 아니라 이름의 해시 — 명부 난수(roster-v1·v2)를 건드리지 않는다
```

| `swimBonus` | R1 의 역할(`RoleId`) |
|---|---|
| +0.3 | `ropeTech`·`boatRescuer`(그림 묶음 `water`), `airRescuer` |
| +0.15 | `rescueLead`·`extricator`·`searcher` |
| +0.05 | `fireLead`·`nozzle`·`firefighter`·`engineer`·`ladderLead`·`ladderOp`·`hazLead`·`hazTech`·`decon` |
| 0 | 경찰·구급·의사·간호사, 내리지 않는 자리 |

대략: 순찰 대원 0.2~0.8(열에 일곱은 0.35 를 넘어 헤엄칠 수 있다), 로프·수난 구조대원 0.6~1. "순찰 대원 가운데도 헤엄을 잘 치는 사람이 있다."

**R1 이 아직 없을 때 — `gear.ts` 의 대체**(R1 이 먼저 합쳐져 있으면 만들지 않는다. R1 이 들어오면 `gear.ts` 의 몸만 위 표대로 바꾸고 아래를 지운다):

```ts
// R1 이 없을 때만: 부대 종류별 실린 장비 (이름은 R1 의 KitId 를 미리 쓴다)
const UNIT_KITS: Record<UnitKind, Partial<Record<KitId, number>>> = {
  engine: { rope: 1, ring: 1, pole: 1, pfd: 2, extinguisher: 1, irons: 2, fan: 1, tic: 1 },
  ladder: { rope: 1, pole: 1, pfd: 2, extinguisher: 1, irons: 2, fan: 1, tic: 1 },
  rescue: { rope: 2, ring: 1, pole: 1, pfd: 2, drysuit: 2, raft: 1, spreader: 1, airbag: 1, shoring: 1, searchKit: 1, tic: 1, irons: 1, extinguisher: 1 },
  hazmat: { rope: 1, pfd: 2, extinguisher: 2, fan: 1, tic: 1, irons: 1, spreader: 1, plugKit: 1 },
  heli: { rope: 1, pfd: 2, drysuit: 1, tic: 1, lightRescue: 1 }, boat: { rope: 2, ring: 2, pole: 1, pfd: 2, drysuit: 2 },
  als: { extinguisher: 1 }, bls: { extinguisher: 1 },
  patrol: { extinguisher: 1, megaphone: 1 }, tactical: { shield: 1, beanbag: 3, breachKit: 1, extinguisher: 1, megaphone: 1 },
  swat: { shield: 2, beanbag: 3, breachKit: 1, sniper: 1 }, eod: { shield: 1, extinguisher: 1 },
};
// 늘 있는 것 (부대 표에 없어도): scba = 지금의 소방 부서(dept === 'fire'), hose = 지금의 진압 자격(dept === 'fire' && skills.fire ≥ 0.35),
//   bag = 구급 부서(als 부대는 alsBag), flashbang = u.flashbangs 가 남았을 때
export const SHARED = true;
export function kitCount(sim, rid, id): number      // 늘 있는 것은 그 조건이면 1. 그 밖: 실린 수 − (u.gearUse?.[id] ?? 0), 드러난 고장(u.gearKnown 에 있다)이면 0
// 실린 수 = 표의 값을 하나하나 sim.rng.fork('gear:' + u.id) 로 tn.gearOk = [0.55, 0.75, 0.9, 0.97, 1][장비] 확률. 이어서 같은 흐름으로
//   동력 장비(spreader·airbag·fan·raft)의 숨은 고장을 tn.toolFail = [0.12, 0.07, 0.04, 0.02, 0.01][장비] 로 정해 둔다.
//   계산만 하고(fork 는 부모를 소비하지 않는다) WeakMap<Unit, …> 에 담아 둔다 — 언제 불러도 같고 화면이 불러도 상태가 바뀌지 않는다
export function kitWorks(sim, rid, id, I): boolean  // 숨은 고장이면: u.gearKnown 에 넣고 raiseProblem(sim, I, 'EQUIP_FAIL', `${r.name}의 ${josa(kitName(id), '이/가')} 고장`,
                                                    //   { role: 'RESPONDER', actor: r.name, rid, imp: 1, text: `${josa(kitName(id), '이/가')} 작동하지 않습니다.` }, false) 후 false (R1 과 같은 문구)
export function useKit(sim, rid, id, n = 1)          // u.gearUse[id] += n (flashbang 이면 u.flashbangs −= n)
export function kitTool(sim, id, use): number        // TOOL[id][use] × tn.toolMul (상한 1.15), 없으면 0
export function bestTool(sim, rid, use, I): number   // 그 부대가 가진 장비를 kitTool 순서로 보며 kitWorks 를 부르고 처음 작동하는 것의 값, 없으면 0.12 × tn.toolMul
export function swimBonus(sim, rid): number          // 부대 종류: heli·boat +0.25, rescue +0.15, 그 밖 소방 +0.05, 나머지 0
export function seatsLeft(sim, u): number            // 구급차 2 · 헬기 1 · 그 밖 0 에서 u.patients.length 를 뺀다
export function kitName(id): string                  // KIT_NAME 표 (R1 의 이름과 같게: '구조 로프', '구명환', '갈고리 장대' …)
const TOOL = {                                       // R1 4절의 값과 같다
  irons: { force: .9, clear: .6, extricate: .45 }, spreader: { force: .8, clear: .7, extricate: 1.0 }, breachKit: { force: 1.0, clear: .4 },
  lightRescue: { force: .6, clear: .6, extricate: .6, water: .6 }, rope: { water: .9 }, ring: { water: .8 }, pole: { water: .7 },
};
```

- 이때만 `types.ts` 에 `KitId`(위 표의 이름만), `Unit.gearUse?: Partial<Record<KitId, number>>`, `Unit.gearKnown?: KitId[]` 를, `difficulty.ts` 의 `Tuning` 과 `tuningOf` 표에 `gearOk`·`toolFail` 을 넣는다.
- 대체에서는 장비가 부대 몫이라 같은 부대의 두 대원이 하나뿐인 장대를 함께 쓰지 못한다(`SHARED` — `canUse` 의 `matesUsing`).
- 기록 전용 방법 가운데 R1 의 행동에 기대는 것(`hoist`·`taser`·`shield`·`airlift`)은 생기지 않는다. `WorkKind` 에 `'hoist'` 가 없으므로 `METHOD.hoist.work` 는 빈 배열로 두고 `recordAir` 는 만들지 않는다.

### 3.4 고르는 규칙 (점수)

각 방법은 `METHOD` 표의 한 줄이다.

```ts
interface MethodCtx {              // chooseMethod 안에서만 만든다
  sim: Sim; s: Scene; a: FieldAgent; r: Responder; u: Unit; work: WorkKind; t: Task | null; tg: MTarget;
  cb: CasBelief | null;            // a.beliefs 의 대상 구조 대상 (없으면 null)
  bank: { x: number; y: number; d: number } | null;   // reachOf(s, cb.x, cb.y, 4, a) — 대상 믿음 위치에서 가장 가까운, 대원이 걸어서 닿는 뭍 칸
  reach: number;                   // bank?.d ?? Infinity
  flow: number;                    // 믿음 속 drift (사람이 떠내려가는 모습으로 본 물살). 걸려 있는 사람(drift 0)을 보면 물살이 약하다고 잘못 본다 — 의도다. 실제 위험은 실행부가 s.flow 로 매긴다
  weak: boolean;                   // 믿음 band ≥ 2 (위중 — 줄을 잡을 힘이 없을 수 있다)
  sense: Sense;
  mates: FieldAgent[];             // 같은 작업(workId)을 맡은 활동 동료
  ops: any | null;                 // X6 가 있으면 a.beliefs 의 ops 사실(id 0), 없으면 null
}
export interface MethodDef {
  id: MethodId; work: WorkKind[];
  name: string;        // 패널·보고서의 이름 ('구명줄 투척')
  short: string;       // 보고서 요약 줄의 짧은 이름 ('구명줄')
  label: string;       // 대원 머리 위 (12자 안. renderScene 은 13자를 넘으면 12자 + … 로 자른다)
  noun: string;        // 보고서 문장에 끼우는 말 ('구명줄로', '헤엄쳐 들어가', '호이스트로 끌어올려')
  kits: KitId[];       // 이 가운데 하나라도 있어야 한다 (빈 배열 = 맨몸으로 된다)
  altUnit?: UnitKind[];   // 이 부대의 대원이면 kits 없이도 된다 (OR) — boat: 구조정
  needUnit?: UnitKind[];  // 이 부대의 대원이어야 한다 (AND) — aerial: 사다리차
  pref: number;        // 교본상 선호 0..1 — 위험이 적은 방법이 높다
  risk: number;        // 대원 위험 0..1 (고를 때 감점)
  plain: boolean;      // 평소 방법: 보고서 문장·요약 줄에 넣지 않고, 시작을 따로 알리지 않는다
  record?: boolean;    // 기록 전용: 고르지 않는다 (R1 이 이미 하는 행동, 지금의 분기 이름). 시작도 알리지 않는다 — plain 값은 보고서에만 쓴다
  can: (c: MethodCtx) => boolean;        // 상황 조건 (믿음·생김새·자기 몸·동료). 장비는 넣지 않는다
  situ?: (c: MethodCtx) => number;       // 상황 배율 (없으면 1)
  skill?: (c: MethodCtx) => number;      // 사람 배율 (없으면 1)
}
export const METHOD: Record<MethodId, MethodDef>;     // Record 라 MethodId 를 늘리면 컴파일이 항목을 강제한다

점수 = pref × situ × skill × (1 − risk × caution)
caution = clamp(1.1 − 0.3 × composure − 0.3 × experience, 0.5, 1.1)      // 침착하고 경험 많은 대원은 위험한 방법을 덜 꺼린다
```

**임무별 갈래 `WORK_MODE`** — 고를 것이 없을 때 무엇을 하는가:

| 임무 | 늘 남는 맨몸·평소 방법 | `chooseMethod` 가 null 이면 |
|---|---|---|
| `waterRescue` | `improvise`(3.6칸 안), `catch`(하류에 뭍), `swim`(수영 능력) — 셋 다 조건이 있다 | **맡지 않는다**(`methodFit` 0). 실행 중이면 `finish(false, 'nomethod')`. 맡을 사람이 없으면 B3 의 "맡을 사람이 없는 작업" 블록이 `rescue` 를 부른다(4.1) |
| `force`·`clear` | `kick`·`handClear` | 생기지 않는다 |
| `extricate` | `manual` | 생기지 않는다 |
| `search` | `call`(실내·붕괴)·`line`(야외) | 생기지 않는다 |
| `treat` | `stay` | 생기지 않는다 |
| `mitigate` | `seal` | 생기지 않는다 |
| `perimeter` | `cordon` | 생기지 않는다 |
| `suppress` | (`interior` 는 `hose` 가 있어야 한다) | **선택 임무**: `t.method` 를 비운 채 지금 코드로 |
| `engage` | (새 방법 둘은 조건일 때만) | **선택 임무**: `t.method` 를 비운 채 지금 분기로 |
| `load` | (고르지 않는다 — `airlift` 기록만) | 선택 임무 |

- **후보**: `work` 가 맞고, `record` 가 아니고, `canUse` 가 참이고, `can` 이 참이고, `t.tried` 에 없고, `a.mfail` 에 같은 대상 열쇠(`targetKey`)로 살아 있는(`until > sim.t`) 기억이 없는 방법.
- 하나도 없으면 차례로 넓힌다: ① `t.tried` 가 비어 있지 않으면 비우고 다시("다 써 봤으면 처음부터 다시") ② 그래도 없으면 `a.mfail` 가운데 `broken` 이 아닌 기억을 무시하고 다시 ③ 그래도 없으면 `null`. 선택 임무는 null 이 정상이다.
- `chooseMethod` 는 상태를 바꾸지 않는다(시간이 지난 `mfail` 기억은 무시만 한다. 지우는 것은 실행부의 `startMethod`·`switchMethod`).
- 같은 점수면 표의 순서. **난수를 쓰지 않는다**(같은 상황 = 같은 선택. 다양성은 장비·능력·상황의 차이에서 나온다).
- 대상 믿음이 없으면(`cb === null` — 아직 못 봤다) `waterRescue`·`extricate` 의 후보는 없다(`methodFit` 0). 지금도 지휘관은 믿음으로 본 대상에게만 일을 낸다.
- **까닭(`why`)**: 위에서부터 처음 맞는 것.
  1. `switchMethod` 가 넘긴 것(`failed`·`broken`·`tooFar`·`team`).
  2. `noGear` — `canUse(…, ignoreKits = true)` 로 다시 셈한 1등이 지금 1등과 다르고, 그 1등이 장비 때문에 빠졌다(`needUnit` 은 그대로 따진다). `missing` = 그 1등의 `kits[0]`.
  3. `weak` — `c.weak` 이고, 고른 것이 잡을 힘이 필요 없는 방법(swim·boat·pole·catch)이다.
  4. `danger` — 위험 조건으로 점수가 오른 방법(rapid·shore·defensive·ventFirst·ventilate).
  5. `quiet` — 무장 현장에서 조용한 방법(irons·hydraulic)이 시끄러운 방법을 이겼다.
  6. `fast` — `c.flow ≥ 0.07` 이 고른 방법의 점수를 올렸다(catch·boat).
  7. `tooFar` — 던져서 닿지 않는 거리(reach > 3.6)라서 고른 방법.
  8. `near` — 가까워서(hand·pole).
  9. `team` — 동료와 짝을 이루는 방법(tend·roof).
  10. 그 밖은 `doctrine`.
- `methodFit(sim, s, a, w)` = 1등 점수가 있으면 그 점수, 없으면 0. 장비는 `kitCount`(R1 `hasKit` — 알려진 고장만)로만 보므로 숨은 고장이 있는 대원의 값은 고장이 없는 대원과 같다(R1 테스트 ④ — 숨은 고장이 배정에 새지 않는다). 수난 구조의 `fitFor` 는 R1 의 식 `0.22 + 0.5×rescue + 0.28×toolFor('water')` 의 장비 항을 바꾼 `best > 0 ? 0.22 + 0.5 × rescue + 0.28 × min(1, best) : 0` 이고, 그 뒤에 R1 의 역할 선호(`role.prefer` — 로프 대원·수난 구조대원 +0.3)를 지금처럼 더한다(값이 0 이면 0 으로 남는다).
- **물 위의 대원**: `agents.fitFor` 맨 앞에서 대원이 헤엄 중이거나 보트 위(`onWater(s, a) ‖ a.afloat`)이면, 지금 맡은 `waterRescue` 작업 말고는 0 을 돌려준다. 물 위의 대원은 지시를 받아도 따르지 않으므로(3.5 의 `brain` 가드), 그런 대원이 `commander.assign` 의 "지시 수신함"(`b.orderWork === w.id`)에 묶여 다른 대원이 그 일을 못 맡는 일을 막는다.

### 3.5 실행과 난수

**실행 도구**: `methodRun.ts` 는 `executor.ts` 를 import 하지 않는다(순환을 피한다). 대신 실행기가 도구를 건넨다 — 지휘 규칙의 `CommandKit` 과 같은 방식.

```ts
// methodRun.ts
export interface ExecKit {
  moveTo(sim: Sim, s: Scene, a: FieldAgent, tx: number, ty: number, range: number, needLos?: boolean): 'arrived' | 'moving' | 'nopath' | 'busy';
  finish(sim: Sim, s: Scene, a: FieldAgent, ok: boolean, reason?: string): void;
  drain(sim: Sim, a: FieldAgent, rate: number): void;
  spray(sim: Sim, s: Scene, a: FieldAgent, tx: number, ty: number, eff?: number, wmul?: number, jitter?: boolean): boolean;
  makeTask(kind: TaskKind, label: string): Task;
}
// executor.ts (파일 끝 — 함수 선언은 끌어올려지므로 어디 두어도 된다)
const XK: ExecKit = { moveTo, finish: finishTask, drain, spray, makeTask };
```

**공통 함수**(`methodRun.ts`):

```ts
startMethod(sim, s, I, a, t, work, tg): boolean
    // 시간이 지난 a.mfail 기억을 지운다 → chooseMethod(…, senseOf(s, a)) → t.method·mwhy·missing·mcands, t.mt0 = sim.t, t.mtry = 0, t.mbad = 0.
    // 시작 문구(3.6). null 이면: 선택 임무(WORK_MODE)는 t.mt0 = sim.t 만 두고 true(방법 없이 지금 코드로), waterRescue 는 false
recheckOnArrive(sim, s, I, a, t, work, tg): void
    // 도착 재선택(3.2-2). t.marr 이면 아무것도 안 한다. 다른 방법이 1등이면 예정된 전환: t.method·mwhy·missing·mt0 를 바꾸고 phase·progress 0, 평소 방법이 아니면 시작 문구
switchMethod(sim, s, I, a, t, why: 'failed' | 'broken' | 'tooFar' | 'team', detail: string, next = true): boolean
    // ① 접은 방법 m0 = t.method 를 t.tried 와 a.mfail 에 넣는다 (until: failed +60초, tooFar·team +15초, broken = Infinity)
    // ② next 면 다음 방법을 먼저 고른다 (chooseMethod 에 tried·mfail 이 반영된다)
    // ③ 기록 — 문구에 바꾸는 방법까지 담는다 ("…작동하지 않습니다. 문을 걷어차 열겠습니다.") — 따로 시작 문구를 내지 않는다:
    //    failed: 같은 대상 열쇠의 앞선 ok=false 줄이 가리키는 METHOD_FAIL 이 아직 복구되지 않았으면 새 Problem 을 만들지 않고 그 p.times = (p.times ?? 1) + 1,
    //            emit(kind 'action', imp 1) 한 줄, 그 Problem 의 eventId 를 쓴다. 없으면 raiseProblem(METHOD_FAIL, detail, …, false)
    //    broken: kitWorks 가 방금 EQUIP_FAIL 을 남겼으므로 문제를 다시 만들지 않고 그 기록 id(events.lastProblemEvent(I, 'EQUIP_FAIL'))를 쓰며 무전 한 줄만
    //    tooFar·team: emit(imp 1)
    // ④ recordMethod(sim, I, a, t, m0, t.mwhy, false, 그 기록 id)
    // ⑤ failed·broken 이고 t.workId ≥ 0 이고 선택 임무가 아니면 w.fails++ (문·잔해 하위 작업은 작업 항목이 없다). holdUntil 은 건드리지 않는다
    // ⑥ 다음 방법이 있으면 t.method = 그것, t.mwhy = why, t.mt0 = sim.t, t.phase = 0, t.progress = 0, t.mtry = 0, t.mbad = 0, a.path = null
    //    없으면: 선택 임무는 t.method = undefined 로 두고 이어 간다(끝내지 않는다). waterRescue 는 finish(false, 'nomethod'). next = false 면 부른 쪽이 정한다
    // 부른 쪽은 그 틱에 return 한다 (한 틱에 moveTo 하나)
recordMethod(sim, I, a, t, method: MethodId, why: MethodWhy, ok: boolean, eventId: number, tg?: MTarget): void
    // I.methods 에 한 줄 (t0 = t.mt0 ?? sim.t, 대상은 tg ?? t 에서, missing = t.missing). 방법을 인자로 받는다 — 기록 전용 분기(4.6 표)는 t.method 가 비어 있어도 자기 이름을 넘긴다.
    // ok 이면: 같은 대상 열쇠의 앞선 ok=false 줄마다, eventId 가 가리키는 Problem(METHOD_FAIL·EQUIP_FAIL)이 아직 복구되지 않았으면 직접 복구 처리한다
    //   (recovered = true, recoveryText = `${josa(이름, '이/가')} ${noun} 다시 시도해 성공`). markRecovered 의 "가장 최근 것" 규칙을 쓰지 않는다 — 펌프 고장 같은 다른 EQUIP_FAIL 을 잘못 닫지 않게
recordAir(sim, I, u, c, eventId): void              // R1 의 호이스트 완료에서 부른다: c.freedHow = 'hoist', c.freedBy = 그 헬기 관측자의 rid(AirOp.eye — 소방 헬기는 0번 자리 항공 구조대원),
                                                   //   I.methods 에 한 줄(work 'hoist'). 보고서 문장은 사람 이름 대신 부대 호출부호를 쓴다
senseOf(s, a): Sense                               // { smoke: s.smoke[선 칸], heat: s.fire[선 칸] }
landCasualty(sim, s, I, a, c, how, x, y): void     // 물에서 뭍으로 (4.1)
pullAshore(sim, s, I, a, why: string): void        // 안전장치: 대원을 가장 가까운 뭍 칸으로 옮긴다 (아래)
waterTick(sim, s, I, a, k: ExecKit): void          // 물 위 대원의 매 틱 효과 (아래)
swimTrouble(swim, flowK, pfd, drysuit, tended, tired, towing, night): number    // 헤엄 중 사고율(초당) — 테스트가 부른다
mrng(sim, s, a): Rng
```

**난수 흐름**(R1 12절의 표와 겹치지 않는 이름):

| 흐름 | 쓰는 곳 |
|---|---|
| `method:<사건 id>:<rid>:<k>` (대원마다, 처음 쓸 때 만든다. k = 그 대원이 이 현장에 들어온 순번 — `s.agents` 에서 같은 rid 가운데 몇째인가. 같은 부대가 같은 사건에 다시 와도 흐름이 처음부터 되풀이되지 않는다. `fork` 는 부모를 소비하지 않으므로 언제 만들어도 같다) | 방법의 판정 전부: 투척 명중, 잡기, 헤엄 중 사고, 붙잡힘, 보트 전복, 비살상탄·저격 명중, 터널 붕락 |
| `kit-r2` (교대) | R2 가 더한 장비의 고장 추첨 (3.3) |
| `aid-r2:<n>` (교대) | 인근 도시 지원 부대에 붙은 R2 장비의 고장 추첨 (3.3) |
| `gear:<부대 id>` (교대) | R1 이 없을 때의 대체에서만 |

- **쓰지 않는 흐름**: `a.rng`(판단 오차 `brain`, 장애물 제거 시간 추정 `agentCost`, 해체 실수), `s.rng`(사격 `shootAt`·`tickHostiles`, 현장 생성, 가스 폭발), R1 의 `roster-*`·`kit`·`kit:<현장>`·`air:*`·`aid:<n>`, H1 의 `injury:<현장>`. 여기에 호출을 끼워 넣으면 무관한 결과까지 바뀐다(CLAUDE.md 재현성).
- **효과 그림에 `s.rng` 를 쓰지 않는다**(R1 12절: 새 코드에서 쓰지 않는다 — 명중·용의자 행동이 쓰는 흐름이라 그림 한 번에 모든 교전 결과가 바뀐다). 지금의 `spray` 는 물줄기 끝점을 흩뜨릴 때 `s.rng` 를 쓴다. 그래서 `spray` 에 인자 `jitter = true` 를 하나 더 두고, R2 의 `defensive`·`aerial` 은 `false` 로 부른다 — 끝점을 `((sim.tick % 3) − 1) × 0.3` 같은 고정 오프셋으로 흔든다. 지금의 `interior` 는 그대로(`true`). `extinguisher` 는 `spray` 를 쓰지 않는다(4.5).
- 주의: 실행기의 `moveTo` 는 경로를 다시 짤 때마다 `agentCost` 를 만들고, `agentCost` 는 만들 때 `a.rng.next()` 를 한 번 부른다. 비용 함수를 바꾸는 `costFor`(아래)는 **늘 `agentCost` 를 먼저 한 번 만든다**(보트일 때 쓰지 않더라도) — `a.rng` 의 호출 수가 지금과 같다.

**물 위의 대원 — 바탕**(1b 단계. 헤엄·보트가 이것 위에서 돈다):

- "헤엄 중" = 대원이 선 칸이 `T.WATER` 이고 `a.afloat` 가 없다(`onWater(s, a)`). 따로 칸을 두지 않는다.
- `executor.moveTo` 의 비용 함수 → `costFor`:

```ts
const base = agentCost(sim, s, a);                                   // 지금처럼 한 번 만든다 (a.rng 호출 수 유지)
const cost = a.afloat === 'boat' ? boatCost(s)                       // 물 칸 0, 그 밖 -1
  : (onWater(s, a) || t.method === 'swim' || t.kind === 'ashore') ? swimCost(s, base)    // 물 칸 2.2, 그 밖은 base
  : base;
```

  **보트의 목표는 늘 물 칸이어야 한다.** `astar` 는 목표 칸의 비용이 0 이상이어야 끝난다(`grid.ts`). 그래서 보트로 뭍에 대는 이동은 뭍 칸을 가운데로 `range 1.5` 를 주어 둘레의 물 칸에서 멈추고, 도착한 뒤 대원을 그 뭍 칸으로 옮긴다(보트의 phase 3, `ashore`). 뭍 칸 하나만 목표로 `range 0.3` 을 주면 경로가 없다.
- `executor.moveSpeed` 맨 앞: 선 칸이 물이면 `a.afloat === 'boat' ? (구조정 3.0 / 고무보트 2.2) × (1 − 0.25 × flowK) : (0.7 + 1.1 × swimOf) × (끌고 오면 0.55) × (1 − 0.5 × flowK) × staminaF` 를 돌려준다. `flowK = min(1, (s.flow ?? 0) / 0.1)`. 물 칸에서는 연기·장비(R1 의 `bombSuit`·`shield`) 배율을 보지 않는다.
- **물 위의 매 틱 효과는 한 곳**: `executor.act` 에서 `left`·`down` 검사 바로 다음(임무가 없어도)에 `if (onWater(s, a) || a.afloat) waterTick(sim, s, I, a, XK)`. 헤엄·보트 방법만이 아니라 `ashore`·`board` 중인 대원, 보트가 뒤집혀 헤엄 중이 된 대원 모두에게 같은 규칙이 걸린다.
  - 들어간 시각: `a.wetSince ??= sim.t`. 뭍 칸에 서면 `wetSince`·`wetTired` 를 지운다.
  - **헤엄 중**:
    - 떠밀림: `nx = a.x + (s.flow ?? 0) × 0.7 × dt`. `hazards.tickWater` 처럼 다음 칸(`round(nx + 0.4), round(a.y)`)이 물이 아니면 멈추고(선체·바위·다리 기둥), `nx ≤ s.w − 1.5` 로 자른다. 끌고 오는 사람도 함께 옮긴다.
    - 지구력: `drain(1.6)`, 끌고 오면 `2.4`.
    - 익수 피해(H1 `hurtResponder` — 원인 `'drown'`, `{ tick: true }`): `raw = 1.2 × dt × (pfd 0.5) × (drysuit 0.7)`.
    - 사고 판정: `mrng.chance(swimTrouble(…) × dt)`. 그리고 강제 사고 셋 — `r.stamina ≤ 8` 이고 `!a.wetTired` 면 '지침'(`wetTired = true`), `r.health < 30` 이면 '위기', `a.x ≥ s.w − 2` 면 '떠밀림'.
      ```
      swimTrouble = 0.010 × (1.5 − swimOf) × (1 + 1.5 × flowK) × (밤 1.3) × (pfd 0.45) × (drysuit 0.7) × (줄 확보 0.5) × (r.stamina < 30 이면 2) × (끌고 오는 중 1.5)
      ```
    - 사고가 나면: 한 번 피해 `hurtResponder(…, mrng.range(8, 18) × (줄 확보면 0.5), 'drown')`, `r.stamina −= 25`, 끌던 사람을 놓는다(`where = 'scene'`, 그 자리, `inWater` 그대로), `a.carrying = -1`, 기록 한 줄(사고 종류별 문구 — 4.1). 임무가 헤엄 구조(`waterRescue` · `swim`)면 `switchMethod(…, 'failed', 사유, next = false)` → `finish(false, 'preempt')` → `a.task = makeTask('ashore', '뭍으로')`, 그 대상의 `swim`·`boat` 를 `a.mfail` 에 60초. 그 밖의 임무(`ashore`·`board`)면 피해·기록만.
  - **보트 위**: 전복 판정 `mrng.chance(0.0015 × (1 + 2 × flowK) × dt)` → `a.afloat = undefined`(그 자리 물 칸 — 다음 틱부터 헤엄 중), 끌던 사람을 놓는다, 기록 '보트가 뒤집혔습니다! 물에 빠졌습니다.', 임무가 보트 구조면 위와 같이 `switchMethod('failed', '보트 전복', next = false)` → `ashore`.
  - 물 위에 150초 넘게 있으면(`sim.t − a.wetSince > 150`) `pullAshore(…, '오래 갇힘')`.
- **물 위에서는 R2 의 피해로 쓰러지지 않는다**(H1 이 있든 없든 같다): 익수·사고·붙잡힘 피해는 `hurtResponder` 를 부르기 전에 `raw = min(raw, r.health − 18)` 로 자르고, 0 이하면 부르지 않는다. 쓰러짐 문턱(`agentHealth` 의 15)보다 위라서 물 칸 위의 `down` 은 R2 에서 생기지 않는다. H1 의 결정 표("대원의 익수 — 넣지 않는다. R2 의 체력 하한 18 을 둔다")와 같다. `r.health < 30` 의 '위기' 사고로 뭍에 보내므로 대개 그 전에 물을 나온다.
- **안전장치 `pullAshore(sim, s, I, a, why)`**: 다른 피해원(연기·불·폭발)이나 경로 문제로 대원이 물 위에 남는 경우를 위한 마지막 장치다. `b = reachOf(s, a.x, a.y, 4, null)`(못 찾으면 격자 전체, 그래도 없으면 `s.safe`, 그다음 `s.staging`)로 옮기고 `a.afloat = undefined`, `a.path = null`, `wetSince` 를 지운다. 끌던 사람은 놓는다(물 칸 그 자리, `inWater` 그대로). 기록 `emit({ truth: true, role: 'SYSTEM', actor: '현장', kind: 'action', imp: 1, text: \`물살에 밀려 ${r.name} 대원이 물가에 걸렸습니다.\` })`. 부르는 곳: `case 'ashore'` 의 `nopath`·30초 초과, `waterTick` 의 150초, `rules/methods.ts` 의 "물 칸 위의 `down`·순직 대원". H1 의 `rescueMate`(대상이 물 칸이면 물가에서 기다린다)와 겹치지 않는다 — R2 는 물 칸에서만 옮기고 `rescueMate` 는 뭍에서만 끈다.
- **물 위의 대원은 다른 일로 끌려 나가지 않는다**: `brain.think` 에서 철수 지시(`boardOrder`) 블록 **바로 다음**(R1 의 공기통 교체 후보, X6 의 철수 명령(`evacuate`)보다 앞):

```ts
if (onWater(s, a) || a.afloat) {
  if (!cur || (cur.kind !== 'waterRescue' && cur.kind !== 'ashore')) setTask(sim, s, a, 'ashore', '뭍으로');
  return;      // 후퇴·휴식·공기통·다른 지시 후보를 내지 않는다 — 헤엄 중 다른 일로 끌려 나가 끌고 오던 대상을 놓치거나 물 한가운데서 엉뚱한 목표로 가는 것을 막는다
}
```

  철수 지시는 이 가드보다 **먼저** 처리된다(사건이 끝나면 `boardOrder` 가 서므로 막지 않는다). 헤엄 중인 대원의 `board` 는 `costFor` 의 헤엄 비용으로 물을 건너 대기 지점에 닿는다. 보트 위의 대원의 `board` 는 대기 지점(뭍)이 보트 비용으로 닿지 않아 `nopath` 가 되고, 지금의 `case 'board'` 대로 곧바로 `left` 가 된다("보트로 철수"). 그래서 부대 출발(`sceneManager` 5)번 블록의 `mates.some(active)`)이 막히지 않는다. 지금도 `retreat`·`board` 는 `nopath` 면 끝나거나 떠나므로(`executor`) 물 칸에서 영영 갇히는 길은 이 가드가 아니라 `ashore` 의 처리로 막는다.
- **새 `case 'ashore'`**(executor, 라벨 '뭍으로'):
  - 처음 돌 때 목표를 한 번 정해 `t.tx, t.ty` 에 둔다: `reachOf(s, a.x, a.y, 4, a)` → 없으면 `s.safe` → `s.staging`. 매 틱 다시 고르지 않는다(강 한가운데서 두 기슭 사이를 오가지 않게 — 함정 "한 임무에 이동 목표 둘").
  - 보트 위(`a.afloat`): `moveTo(t.tx, t.ty, 1.5)`(보트 비용 — 그 뭍 칸 둘레의 물 칸에서 멈춘다) → `arrived` 면 대원을 `(t.tx, t.ty)` 로 옮기고 `a.afloat = undefined`, `finish(true)`.
  - 헤엄 중: `moveTo(t.tx, t.ty, 0.3)`(헤엄 비용) → 뭍 칸에 서면 `finish(true)`.
  - `nopath` 이거나 임무가 30초를 넘었는데 아직 물 위면 `pullAshore(…, '경로 없음')` 후 `finish(true)`.
  - 이미 뭍이고 `afloat` 도 없으면 첫 줄에서 `finish(true)`.
- **끌고 오는 동안의 구조 대상은 `inWater` 를 유지한다**: 붙잡으면 `c.where = 'carried'`, `a.carrying = c.id` 로만 바꾼다(`tickWater` 는 `where === 'scene'` 만 떠내려 보내므로 멈춘다). `inWater = false` 는 뭍에 내려놓을 때 `landCasualty` 에서만. 이렇게 해야 중간에 놓쳤을 때 "물 위에 떠 있는데 물 밖인 사람"이 생기지 않는다(그런 사람은 아무 규칙도 건지지 못하고, `tests/sim.test.ts` 수난 사고 테스트의 "끌어낸 사람은 물 칸이 아닌 곳" 조건도 깨진다).
- `executor.finishTask` 의 내려놓기: 업고 있던 사람이 `inWater` 이면 — 대원이 선 칸이 물이면 지금처럼 `where = 'scene'`(다시 떠내려간다), 뭍이면 `landCasualty(…, t.method ?? 'hand', …)` 에 이어 완료 기록(`emit` — 방법별 완료 문구)과 `recordMethod(ok)` 를 함께 남긴다(규칙 5 — 상태를 바꾼 그 자리에서. 집계가 빠지지 않게).
- 해일(`rules/disaster.ts` `swamp`)은 잠긴 줄의 대원을 뭍으로 옮긴다. 보트 대원이 뭍 칸에 놓이면 `rules/methods.ts` 가 `a.afloat` 를 푼다.
- `rules/methods.ts`(매 틱, 첫 줄에서 해당 없는 현장은 돌아간다 — 물이 없고 `s.fan` 도 없는 현장):
  - `s.quay === undefined` 면 한 번 정한다: `s.quay = s.variant === 'ship'`(선박 화재의 부두는 높은 안벽 — 손이 물에 닿지 않는다. 세계 규칙이라 변형을 읽어도 된다. 판단부는 이 표시만 본다).
  - 물이 있는 현장(`s.kind === 'water'` 또는 `s.rules` 에 `'water'`)에서 1초마다 `s.flow = max(s.flow ?? 0.02, 물속 사람의 drift 최댓값)`. 해일이 사람을 휩쓸어 drift 0.1 을 주면 그때 오른다. 내려가지는 않는다(사람이 걸려 멈춰도 강물은 흐른다). 현장 환경은 첫 부대가 오기 전부터 돌므로 처음 drift 를 놓치지 않는다.
  - `a.afloat === 'boat'` 인데 선 칸이 물이 아니면 `a.afloat = undefined`(보트 방법은 진수할 때 대원을 물 칸으로 옮기고 뭍에 댈 때 스스로 푸므로, 이 줄은 해일 같은 바깥 이동에만 걸린다).
  - 물 칸 위에 `down`·순직(`a.status === 'down'` 또는 H1 의 숨진 대원)인 대원이 있으면 `pullAshore`. `agentHealth` 는 `act` 보다 먼저 돌고 이 규칙은 다음 틱 첫 단계에서 도므로, 쓰러진 대원은 **한 틱** 동안 물 칸에 있을 수 있다(테스트는 "쓰러진 다음 틱에 물 칸에 없다"로 본다).
  - 송풍기(4.5·4.8): `s.fan` 이 있고 `sim.t < s.fan.until` 이면 실내 칸의 `s.smoke[i] *= 1 − 0.2 × power × dt`, `s.fire[i] ≥ 0.5` 인 칸은 `s.fire[i] = min(1, s.fire[i] + 0.006 × power × dt)`(공기가 들어가 불이 커진다 — 흐름 경로의 위험). 끝나면 `s.fan = null`. X6 가 합쳐져 있으면 X6 의 가스 모델이 `s.fan` 을 따로 읽는다(10절).
  - **0단계에서는 `s.quay`·`s.flow` 만 정한다**(기록·난수 없음, 아무도 읽지 않는다 — 결과 불변).

### 3.6 기록 문구

규칙 5(가짜 연출 금지)대로, 기록은 **상태를 바꾸는 바로 그 코드**에서만 `emit` 한다.

| 언제 | 어디서 | 무엇을 | 예 |
|---|---|---|---|
| 방법을 정했다(`t.method` 를 넣은 순간) | `startMethod`·`recheckOnArrive` | 평소 방법이 아니거나 까닭이 `doctrine`·`near` 가 아닐 때만. `role 'RESPONDER'`, `kind 'action'`, `imp 1` | "구조 로프가 없습니다. 헤엄쳐 들어가겠습니다." |
| 한 번의 시도가 빗나갔다(방법은 그대로) | 실행부의 판정 자리 | `kind 'action'`, `imp 0` | "줄이 빗나갔습니다. 다시 감아 던집니다." |
| 방법을 접었다 | `switchMethod` | 실패는 `raiseProblem`(문제 기록이 곧 기록 문구 — 같은 대상에서 되풀이되면 무전 한 줄, 3.5), 고장은 R1 이 남긴 `EQUIP_FAIL` 뒤에 무전 한 줄, 조건 상실은 `emit` `imp 1` | "물살에 밀려 대상을 놓쳤습니다. 뭍으로 돌아갑니다." |
| 방법으로 끝냈다 | 실행부의 완료 자리 | **지금의 완료 문구를 방법별 문구로 바꾼다**(줄이 늘지 않는다) | "구조 대상 A, 구명줄로 끌어냈습니다. 처치와 이송이 필요합니다." |

- 문구는 `METHOD` 표 옆의 `SAY` 표(`methods.ts`)에서 `(방법, 까닭)` 으로 찾는다. 이름 뒤 조사는 `josa()`. `noGear` 문구는 `kitName(missing)` 을 쓴다("구조 로프가 없습니다…" — 장비 이름은 R1 의 `KITS[id].name`, 방법 이름은 `METHOD.name` 이라 "구명줄 투척"과 섞여 보여도 그대로 둔다).
- **시작을 알리지 않는 것**: `plain: true` 인 방법 전부(rope·pole·hand·irons·handClear·toolClear·basic·spread·call·line·interior·stay·seal·cordon), 그리고 **`record` 인 방법 전부 — `plain` 값과 상관없이**(기록 전용은 고르지 않으므로 "시작"이 없다. 그 `plain` 값은 보고서에만 쓴다 — 4.6 표). 문·잔해처럼 자주 일어나는 일은 완료 문구만 방법별로 바뀌어 기록량이 지금과 거의 같다.
- 탐지 방법(listen·hail·thermal)은 평소 방법이 아니지만 구역마다 수색 임무가 따로 나와 한 대원이 여러 번 고르므로, 한 대원이 한 사건에서 처음 고를 때만 알린다(`a.msaid`).
- 다만 같은 작업·같은 대상에 아직 복구되지 않은 방법 실패(`I.methods` 의 ok=false 줄)가 있으면, 다른 대원이 고른 평소 방법이라도 시작을 알린다(관찰자가 "다른 사람이 다른 방법으로 다시"를 보게 — 5절 예 4).
- R1 이 남기는 문구(테이저 발사, 호이스트 인양 완료, 장비 고장)는 그대로 두고, R2 는 그 자리에 `recordMethod`·`recordAir` 만 더한다.
- 로그 문구가 바뀌므로 교대 해시(`sim.logHash`)는 바뀐다. 기존 테스트는 같은 시드 두 번의 해시가 같은지만 본다(문제없다).

### 3.7 그림

`view/scene/sprites.ts` 의 `ArmPose` 에 `'reach' | 'hold'`, `Item` 에 `'rope' | 'ring' | 'pole' | 'irons' | 'extinguisher' | 'launcher'` 를 더한다. `ArmPose 'throw'`·`Item 'ram'` 은 G5 가 이미 더했다(G5 가 먼저 구현된다 — 없으면 R2 가 더한다). R1 이 장비 그림을 더하면 그 이름과 겹치는 것은 R1 쪽을 쓴다(예: 방패·테이저·저격 소총은 R1 의 그림, 할리건은 R1 의 `'halligan'` 이 있으면 그것 — G5 11절과 같은 규칙: 먼저 합친 이름). `renderScene.agentPose` 는 `a.task.method` 를 먼저 보고(G5 의 하위 작업 분기보다 앞), 없으면 지금(또는 R1·G5)처럼 정한다. G4 는 "구조 줄" 블록과 `sprites.ts` 를 R2 몫으로 남겼다.

| 방법 | 자세 · 손에 든 것 | 현장 그림 (`methodsLayer.ts`) |
|---|---|---|
| hand · catch(붙잡을 때) | `reach` · 없음(무릎 꿇고 팔을 뻗음) | — |
| pole | `reach` · `pole` | 대원에서 대상 쪽으로 최대 2칸의 장대, 끝에 갈고리 |
| rope | 던지기 전 `throw` · `rope`(감긴 줄) | 지금의 줄 그림. 끝은 **빨간 투척 가방**(지금의 구명환 대신) |
| ring | `throw` · `ring` | 줄 끝에 빨강·흰 구명환(지금 그림) |
| improvise | `throw` · 없음 | 회갈색 점선 줄(옷·끈을 이은 것) 끝에 흰 통 |
| swim | `drawSwimmer` 에 대원 모습(소방은 헬멧·공기호흡기를 벗은 모습, 구명조끼면 주황 조끼) | 끌고 오는 사람은 바로 뒤에 `drawSwimmer` |
| tend | `hold` · `rope` | 줄 확보 대원 → 헤엄치는 동료로 줄 |
| boat | 앉은 자세(`side`) | 대원 밑에 위에서 본 주황 고무보트(1.4×0.7칸, 구조정이면 회색 단단한 배 1.8×0.8칸), 실은 사람은 보트 안에 `drawLying` |
| hoist | (R1 — 상공 헬기·호이스트 줄은 R1 의 그림) | — |
| kick · handClear · manual · tunnel | `work` · 없음 | — |
| irons · ram | `work` · `irons` / `ram` | — |
| hydraulic · spread · roof | `work` · `spreader`(있는 그림) | — |
| haul | `hold` · `rope` | 구덩이로 내려간 줄(짧은 수직선과 고리) |
| airbag · shore | `work` · 없음 | 대상 곁의 납작한 검은 패드 / 세운 버팀목 |
| defensive · aerial | `hose` | aerial: 대기 지점에서 목표 창까지 굵은 회색 사다리 선(가로대) |
| extinguisher | `aim` · `extinguisher` | 흰 분말 줄기(`Fx 'spray'` 를 흰색으로) |
| ventilate · ventFirst | `work` · 없음 | 출입구의 송풍기(돌아가는 날개) — `s.fan`. 맨몸 환기(`power` 0.5)면 열린 문만 |
| beanbag | `aim` · `launcher`(주황 총몸) | — (탄 그림은 G5 의 `recShot`) |
| sniper | `aim` · 저격 소총(R1 그림) | 조준선(점선, 관찰자 시점만. G5 는 이 대원의 겨누는 선을 그리지 않는다) |
| listen | `kneel` · 없음 | 정지 중 머리 둘레의 동심원 |
| hail · announce | `megaphone`(있는 자세) | hail: 정지 중 확성기 앞의 호 셋 |
| thermal | R1 의 열화상 카메라(`'tic'`) 든 자세 | — |

머리 위 라벨(`a.label`)은 `METHOD.label`(12자 안). 패널(`ui/panels.tsx` 대원 정보 — R1 이 역할·장비 줄을 더한다)에 두 줄을 더한다: **방법**("헤엄쳐 접근 — 구조 로프 없음"), **방법 후보**(`t.mcands` 의 점수 막대 — 지금의 "행동 후보와 점수"와 같은 모양). R1 이 장비 줄을 넣지 않았으면 장비 줄도 R2 가 넣는다(`kitName`, 다 쓴 것·고장 난 것은 흐리게).

화면을 고친 단계는 헤드리스 브라우저로 현장을 찍어 보고 콘솔 오류 0건을 확인한다(CLAUDE.md, `npm run ui-check`). 화면만 고친 커밋은 sweep 분포가 한 건도 달라지면 안 된다.

### 3.8 보고서 문장

`debrief.evaluate` 는 기록된 문제와 타임라인에서만 문장을 만든다. 방법은 두 길로 들어간다. **방법 문장의 재료는 `I.methods` 의 칸(`method`·`why`·`missing`·`rid`·`unitId`·대상)과 `Problem` 뿐이다** — 보고서를 쓸 때 다시 계산하지 않는다.

1. **실패와 바꾸기** → 문제 `METHOD_FAIL`(새 코드). `PROBLEM_LABEL.METHOD_FAIL = '대응 방법 실패·변경'`, `order` 의 `EQUIP_FAIL` 바로 다음, 문장(횟수는 `times` 의 합):
   `METHOD_FAIL: (ps) => \`대응 방법이 ${ps.reduce((n, p) => n + (p.times ?? 1), 0)}차례 막혔습니다 (${ps[0].detail})${ps[0].recovered ? \` — ${ps[0].recoveryText}\` : ''}.\``
   복구 문구(`recordMethod` 가 앞선 실패의 Problem 을 직접 복구 처리할 때): "`${이름}이/가 ${noun} 다시 시도해 성공`". R1 의 장비 고장(`EQUIP_FAIL`)도 같은 길로 복구되어 지금의 `EQUIP_FAIL` 문장("… — 복구하지 못했습니다" / "… — 복구 문구")에 그대로 실린다.
2. **평소와 다른 방법으로 끝낸 것** → `I.methods` 의 `ok: true` 이고 그 방법의 `plain: false` 인 줄(같은 대상에 앞선 실패가 없는 것). 기록 전용 방법은 4.6 표의 `plain` 값을 따른다 — `hoist`·`airlift`·`bang`·`taser`·`shield` 는 싣고, `chase`·`breach`·`tackle`·`cover` 는 싣지 않는다(거의 모든 무장 사건의 평소 분기라 "다르게 한 것"을 밀어낸다). 사망·미발견 문장 다음, 맺음말 앞에 **최대 2문장**, `A.length < 12` 일 때만:
   - 수난 구조: "구조 대상 A는 이서준 대원이 헤엄쳐 들어가 구했습니다 (구명줄이 없었음)." / 호이스트: "구조 대상 B는 헬기1이 호이스트로 끌어올려 구했습니다."
   - 그 밖: `${이름} 대원이 ${noun} ${WORK_DONE[work]}` — `WORK_DONE = { force: '문을 열었습니다', clear: '잔해를 치웠습니다', extricate: '구출했습니다', suppress: '불길을 잡았습니다', engage: '제압했습니다', mitigate: '누출을 막았습니다', search: '찾아냈습니다', treat: '처치했습니다', perimeter: '주변에 대피를 알렸습니다', load: '환자를 이송했습니다', hoist: '끌어올려 구했습니다' }`.
   - 까닭 말: `WHY_TEXT = { noGear: \`${kitName(missing)}이/가 없었음\`, weak: '줄을 잡을 힘이 없었음', fast: '물살이 빨랐음', tooFar: '던져서 닿지 않는 거리였음', danger: '추가 위험이 있었음', quiet: '용의자에게 들키지 않으려', team: '동료와 짝을 이뤄' }`, `doctrine`·`near` 는 붙이지 않는다. `missing` 이 없으면(대체 등) `noGear` 말도 붙이지 않는다.
3. `buildReport`: `methods`(성공한 방법별 횟수 — 평소 방법 포함, `sweep --methods` 가 쓴다)를 채우고, 요약에 한 줄 — "대응 방법: 헤엄 2 · 구명환 3 · 호이스트 1 · 소화기 1 …"(`short` 이름. **`plain: false` 인 방법만** 센다 — 평소 방법 수십 건이 섞이면 줄이 읽히지 않는다. 하나도 없으면 줄을 넣지 않는다).

---

## 4. 유형별 방법 표

수치는 **시작값**이다. 6절의 방법으로 재어 조정하되, "평소 방법"의 식은 지금(R1 뒤의) 식 그대로 둔다. 거리는 칸(현장 격자 1칸)이다. "장비 값"은 `kitTool(sim, id, use)`, 맨손은 0.12.

### 4.1 수난 구조 `waterRescue` (1단계 — 가장 자세히)

교본의 순서 "뻗기(Reach) → 던지기(Throw) → 배로(Row) → 들어가기(Go)" 를 `pref` 로 옮겼다. 위험이 적은 방법일수록 높다.

| 방법 | 고를 조건 `can` (믿음·생김새·자기 몸·동료) | 장비 `kits` / 부대 | 닿는 거리 | 걸리는 시간 | 성공 판정 (실행부, `mrng`) | 대원 위험 | pref / risk / plain |
|---|---|---|---|---|---|---|---|
| `hand` 손 뻗어 붙잡기 | reach ≤ 1.2, **안벽이 아님**(`!s.quay`) | 없음 | 1.2 | `2.5 / (0.5 + 0.5×rescue)` | 잡기 `max(grabP, 0.6)` | 없음 | 1.0 / 0 / 평소 |
| `pole` 장대 뻗기 | reach ≤ 2.0 | `pole` | 2.0 | `1.5 + 4 / (0.5 + 0.6×rescue)` | 갈고리라 의식이 없어도 `max(grabP, 0.8)` | 없음 | 0.92 / 0 / 평소 |
| `ring` 구명환 투척 | reach ≤ 2.8 | `ring` | 2.8 | rope 의 0.8배 | 명중 ×1.08, 잡기 ×1.15 (최대 1) | 없음 | 0.84 / 0 / — |
| `rope` 구명줄 투척 (**지금의 방법**) | reach ≤ 3.6 | `rope` | 3.6 | `9 / (0.4 + 0.8×rescue + 0.5×장비 값)` (지금 식 — R1 의 `toolFor('water')` 자리에 로프 값 .9) | 명중 × 잡기 | 없음 | 0.85 / 0 / 평소 |
| `improvise` 즉석 부력물 | reach ≤ 3.6 — **누구나 고를 수 있는 맨몸 방법**(옷·끈을 이은 줄과 빈 통) | 없음 | 3.6 | 찾기 2초 + rope 의 1.3배(장비 값 0.12) | 명중 ×0.7, 잡기 ×0.7 (명중의 거리 감쇠는 그대로) | 없음 | 0.5 / 0 / — |
| `catch` 하류에서 기다렸다 붙잡기 | 믿음 drift > 0, `catchPoint` 가 있다(같은 줄 하류(+x) 8칸 안의 첫 뭍 칸 — 다리·굽은 물가, 대원과 같은 뭍 성분), 대상이 거기 닿는 예상 `(점 − 1 − x) / drift` ≤ 40초(40~90초면 점수 ×0.5, 그 넘으면 못 고른다) | 없음(장대가 있으면 잡기가 pole 과 같다) | 대기 칸에서 1.3 | 이동 + 대기 + 2.0 | hand 와 같음 | 없음 | 0.8 / 0 / — |
| `swim` 헤엄쳐 접근 | `swimOf ≥ 0.35`(구명조끼가 있으면 0.25 — 이 문턱은 `kitCount(pfd)` 로 본다. 구명조끼는 "있어야 하는" 장비가 아니라 "있으면 덜 위험한" 장비라 `kits` 에 넣지 않는 예외다 — `noGear` 계산에서도 실제 소지 그대로 본다), reach > 1.2 | 없음 (`pfd`·`drysuit` 가 있으면 덜 위험) | 직접 | 물가로 이동 + 준비(소방 6초 '방화복·공기호흡기 벗기', 그 밖 2초, 구명조끼를 입으면 +3초) + 헤엄 + 붙잡기 1.5초 + 끌고 오기 | 늘 잡는다(의식이 없어도). 허우적대는 사람에게 붙잡힐 수 있다(아래) | 3.5 의 `swimTrouble` | 0.45 / 0.3 / — |
| `tend` 구조자 줄 확보 | 같은 대상을 맡은 동료가 헤엄 중(그 동료의 `task.method === 'swim'`) | `rope` | — | 헤엄 동료가 끝날 때까지 | — (동료의 사고율 ×0.5) | 없음 | 0.9 / 0 / — |
| `boat` 보트 접근 | 같은 부대에서 보트를 쓰는 동료가 없다 | `raft` **또는** 구조정 부대(`altUnit: ['boat']`) | 직접 | 진수 지점으로 이동 + 진수 8초(고무보트 14초) + 이동(3.0 / 2.2칸/초) + 끌어올리기 2.5초 | 늘 | 전복 `0.0015 × (1 + 2×flowK)`/초 | 0.78 / 0.08 / — |
| `hoist` 헬기 호이스트 (**기록 전용**) | R1: 물 현장 상공의 소방 헬기가 지휘관의 `hoist` 작업을 가져간다(`rules/air.ts`) | (R1 `Unit.hoist`) | — | R1 의 식 | R1 | — | — / — / — |

**상황 배율(`situ`)**:
- 위중(`c.weak` — 줄을 잡을 힘이 없을 수 있다): rope·ring·improvise ×0.35, hand ×0.7, pole·catch ×0.8, swim·boat ×1.15.
- 빠른 물살(`c.flow ≥ 0.07`): rope·ring ×0.85, catch ×1.3, boat ×1.1, swim ×0.6.
- 던져서 닿지 않는 거리(reach > 3.6): boat ×1.2, swim ×1.3.
- 멀리 던지는 즉석 부력물(improvise 이고 reach > 2.4): ×0.6 — 줄이 없는 대원이 헤엄을 칠 수 있으면 헤엄이, 못 치면 즉석 부력물이 남는다(사용자 예시의 갈래).
- 안벽(`s.quay`): swim ×0.8(높은 곳에서 뛰어내려 들어가고 오를 곳이 마땅치 않다).
- 밤·비·안개(`sim.weather !== 'clear'`): rope·ring·improvise ×0.9.
- 상공에 호이스트 헬기가 있다(R1 — 이 사건 상공의 `hoist` 부대, 조직이 아는 것): swim ×0.7(헬기가 곧 건질 수 있으니 위험을 덜 진다).

**동료와의 조건**(`can` — 배율이 아니라 빼기): 같은 대상에게 헤엄치는 동료가 있으면 던지는 방법(rope·ring·improvise)은 고르지 않는다(동료에게 걸린다). 이미 던지는 중이던 대원은 3초 뒤 조건 상실(`team`)로 바꾼다 — 줄이 있으면 `tend`, 없으면 물가에서 기다리는 `hand`·`pole` 만 남는다.

**사람 배율(`skill`)**: rope·ring·improvise `0.8 + 0.4×rescue`, hand·pole `0.9 + 0.2×rescue`, swim `0.5 + swimOf`.

**실행부의 판정(진실로)**:

```
grabP(c.health) = c.health > 55 ? 1 : c.health > 40 ? 0.75 : c.health > 25 ? 0.4 : 0.15        // 대상이 줄을 잡을 수 있는가
hit(d)          = clamp(0.62 + 0.3×rescue + 0.1×composure − 0.12×max(0, d − 2)
                        − (weather ≠ 'clear' ? 0.08 : 0) − (s.flow ≥ 0.07 ? 0.12 : 0), 0.25, 0.97)   // d = 그 순간 대원–대상 거리
한 번의 시도 = mrng.next() < hit × 잡기     (hand·pole·catch 는 hit = 1)
```

**실행 순서**(`methodRun.runWaterRescue(sim, s, I, a, t, k)`):

```
c = s.casualties[t.cas]
c.dead || !c.inWater → 지금처럼 learn(casFact, true, true) 로 강제 보고하고 finish(true) (낡은 믿음 대비. 보트 위면 다음 판단에서 brain 가드가 'ashore')
c.where === 'carried' && a.carrying !== c.id → 동료가 끌고 오는 중: rope 가 있고 t.method 가 tend 가 아니면 예정된 전환으로 tend.
                                                없으면 끄는 동료 가까운 물가로 moveTo(2.5) 하며 '구조 지원 대기'. return
t.method 가 없으면 startMethod. false 면 finish(false, 'nomethod'). return
1초마다(sim.tick % 5 === 0) 고른 방법의 canUse·can 을 다시 본다: 거짓이면 t.mbad += 1, 참이면 0. t.mbad ≥ 3 → switchMethod(…, 'tooFar' 또는 'team', …). return
  단, swim 은 phase 2 부터(물에 들어간 뒤), boat 는 phase 1 부터(진수한 뒤), tend 는 자리를 잡은 뒤 다시 보지 않는다 — 몸이 이미 물 위에 있다
  (대상이 물가로 떠밀려 reach ≤ 1.2 가 되어도 헤엄치던 대원이 '손 뻗기'로 바뀌지 않게)
분기마다 moveTo 는 한 번만 부르고 return (CLAUDE.md 함정: 한 틱에 목표 둘). switchMethod 를 부른 틱도 return

물가 방법 (hand · pole · ring · rope · improvise):
  mv = moveTo(c.x, c.y, 닿는 거리, needLos = true)            // 떠내려가면 따라 옮긴다 (지금과 같다)
  nopath → switchMethod('tooFar', '물가로 갈 길이 없음') (다음 방법이 없으면 finish(false, 'nopath'))
  도착 전: 라벨 '물가로 이동', 진행도 초당 0.5 감소 (지금과 같다). return
  처음 도착한 틱: 장비 방법이면 kitWorks(sim, a.rid, 장비, I) — false 면 switchMethod('broken', …). return
  t.phase === 1 (줄 다시 감기): 4초 뒤 phase 0, 다음 투척의 필요 시간 ×0.6. 라벨 '줄 다시 감는 중'. return
  진행도 += dt × staminaF, drain 0.5, a.ring = 진행도 / 필요
  다 되면 한 번 판정:
    성공 → landCasualty(대원이 선 칸) · emit(방법별 완료 문구) · recordMethod(t.method, t.mwhy, true, 그 기록) · finish(true)
    실패 → t.mtry++, emit(imp 0 '줄이 빗나갔습니다…' / '대상이 줄을 잡지 못했습니다…')
           t.mtry ≥ 2 (hand·pole 은 3) → switchMethod('failed', '구명줄 투척이 두 차례 빗나감')
           아니면 phase 1 (던지는 방법) / 진행도 0 (뻗는 방법)

catch:  시작할 때 catchPoint(믿음 위치)를 t.tx, t.ty 에 둔다 → moveTo(t.tx, t.ty, 0.5), 라벨 '하류에서 대기'
        도착 뒤 dist(a, c) ≤ 1.3 → hand 와 같은 붙잡기(필요 2.0, 장대가 있으면 pole 의 잡기)
        믿음 속 drift 가 0 이 됐는데(다른 데 걸렸다) 믿음 위치가 대기 칸에서 2칸 밖인 채 6초가 지났다 → switchMethod('tooFar', …)

swim:   phase 0 시작할 때 물가 진입점 E = reachOf(s, c.x, c.y, 4, a)(대상에서 가장 가까운, 대원이 걸어서 닿는 뭍 칸 — 실행부라 진실 위치로 잰다)를 t.tx, t.ty 에 → moveTo(E, 0.5), 라벨 '물가로 이동'
                (대기 지점이 아니라 물가에서 장비를 벗는다)
        phase 1 준비(위 시간, 제자리. 라벨 '방화복 벗는 중' / '구명조끼 착용')
        phase 2 moveTo(c.x, c.y, 0.9), 라벨 '헤엄쳐 접근'           // costFor 가 물 칸을 지나게 한다
        phase 3 붙잡기 1.5초 → 붙잡힘 판정(아래) → c.where = 'carried', a.carrying = c.id, a.path = null.
                emit '구조 대상 A를 붙잡았습니다. 물가로 끌고 갑니다.'
        phase 4 들어설 때 한 번 뭍 칸 B 를 정해 t.tx, t.ty 에 둔다: 줄 확보 동료가 있으면 그 동료가 선 물가 칸, 없으면 reachOf(s, a.x, a.y, 4, a)
                → moveTo(B, 0.3), 라벨 '끌고 나오는 중', 대상은 대원 뒤 0.45칸 (carry 와 같은 식)
                뭍 칸에 서면 landCasualty(B) · a.carrying = -1 · emit · recordMethod(ok) · finish(true)
        물 칸 위의 매 틱 효과(떠밀림·지구력·익수 피해·사고)는 이 함수가 아니라 waterTick(3.5)이 준다.
        붙잡힘(H1 이 R2 몫으로 남긴 "구조 대상이 구조자를 붙잡음"): 붙잡는 순간 c.health > 40 이면(허우적댈 힘이 있다)
          mrng.chance(0.15 × (1.2 − swimOf) × (pfd 0.5)) 로 사고 '허우적대는 대상에게 붙잡혀 함께 가라앉을 뻔했습니다'
          — waterTick 의 사고와 같은 처리(피해·놓침·switchMethod('failed', '헤엄 구조 중 허우적대는 대상에게 붙잡힘', next = false)·ashore)
          — 던지기를 먼저 하는 교본의 까닭이 그대로 드러난다
        사고 문구: 물살 '물살에 밀려 대상을 놓쳤습니다. 뭍으로 돌아갑니다.' / 지침 '힘이 빠졌습니다. 대상을 놓치고 뭍으로 돌아갑니다.'
                   위기 '물을 많이 먹었습니다. 뭍으로 돌아갑니다.' / 떠밀림 '하류로 떠밀렸습니다! 뭍으로 붙겠습니다.'
        같은 작업은 다른 대원(또는 a.mfail 이 풀린 뒤의 자신)이 다시 맡는다.

tend:   시작할 때 헤엄 동료가 들어간 물가 칸(동료의 t.tx, t.ty — 진입점 E)을 t.tx, t.ty 에 → moveTo(1.0), 라벨 '구조자 줄 확보', 동료를 바라본다
        헤엄 동료가 없어지면(끝났거나 뭍으로) 같은 대상이 아직 물속이면 switchMethod('team', …), 아니면 finish(true)

boat:   phase 0 시작할 때 진수 지점 L = reachOf(s, c.x, c.y, 4, a) 를 t.tx, t.ty 에 → moveTo(L, 0.5), 라벨 '진수 지점으로'
                → 도착: 고무보트면 kitWorks(raft) — false 면 switchMethod('broken', …). return
                → 진수 8초(고무보트 14초, 라벨 '보트 띄우는 중')
                → L 의 여덟 이웃 가운데 대상 믿음 위치에 가장 가까운 물 칸 W 로 대원을 옮기고(a.x, a.y = W) a.afloat = 'boat',
                   emit '보트를 띄웠습니다.' — 뭍 칸 위에서 afloat 를 켜면 다음 틱 세계 규칙이 풀어 버린다(3.5)
        phase 1 moveTo(c.x, c.y, 0.9) (보트 비용 — 물 칸만), 라벨 '보트 접근'
        phase 2 끌어올리기 2.5초 → c.where = 'carried', a.carrying = c.id
        phase 3 moveTo(L.x, L.y, 1.5) (보트 비용 — L 둘레의 물 칸에서 멈춘다)
                → arrived: 대원을 L 로 옮기고 a.afloat = undefined, landCasualty(L) · a.carrying = -1 · emit · recordMethod(ok) · finish(true)
        도중에 대상이 물 밖이 되면(호이스트가 먼저 끝났다) 첫 줄에서 finish(true) → brain 가드가 'ashore' 를 주고, ashore 의 보트 갈래가 뭍에 댄다
        전복은 waterTick(3.5)
```

`landCasualty(sim, s, I, a, c, how, x, y)`: `c.inWater = false; c.drift = 0; c.mob = 'immobile'; c.trapWork = 0; c.tFreed = sim.t; c.where = 'scene'; c.x = c.px = x; c.y = c.py = y; c.bleed *= 0.35; c.bleed0 = c.bleed; c.freedHow = how; c.freedBy = a.rid; learnQuiet(sim, a, casFact(…))` — 지금 `waterRescue` 의 완료 처리와 같다. H1 이 합쳐져 있으면 그 자리에서 `c.bleedCause = 'exposure'`(H1 원인 표 — 물에서 건져 낸 뒤 남는 악화)이고, H1 이 구조 대상 피해를 `hurtCas` 로 모았다면 `bleed` 를 고치는 줄은 H1 의 규칙을 따른다.

**호이스트(R1)와의 관계**: R1 에서 물 현장의 소방 헬기는 상공에 머물고 대원이 내리지 않는다. 지휘관은 물속 구조 대상에게 지상의 `waterRescue` 와 공중의 `hoist` 를 함께 낸다 — 먼저 끝나는 쪽이 이긴다(R1 7.3). R2 는 R1 의 호이스트 실행(`rules/air.ts`)에 두 줄을 더한다: ① 완료 자리에 `recordAir(sim, I, u, c, ev)` — `freedHow = 'hoist'` 와 방법 기록, ② 대상이 `c.where === 'carried'`(헤엄·보트 대원이 끌고 오는 중)이면 진행하지 않고 그 위에서 기다린다(끌던 대원이 놓으면 다시 — 그러지 않으면 끌던 사람이 `'loaded'` 로 바뀌어 그림과 기록이 어긋난다). 지상 대원은 `hoist` 를 고르지 않는다(기록 전용). R1 이 없으면 호이스트는 없고, 헬기 대원은 뭍에서 다른 방법을 고른다.

**지휘 규칙**(`orders/methods.ts`, 믿음과 작업판만. 주석은 `//` 줄로만 쓰고 어떤 주석에도 `tests/ext.test.ts` 의 금지어를 쓰지 않는다 — 그 테스트는 `//` 로 시작하는 줄만 걸러 낸다):
1. 열려 있는 `waterRescue` 작업의 `w.fails ≥ 2` 이고 그 구조 대상의 믿음이 아직 물속(`water`)이면 `k.request('rescue', '수난 구조가 거듭 실패 — 수난 장비 필요', true)`.
2. **맡을 사람이 아예 없는 경우는 새 규칙을 만들지 않는다.** `commander.syncBoard` 에 B3 가 넣은 "맡을 사람이 없는 작업" 블록(R1 6.4 가 `anyCapable` 로 꺼낸 것)이 이미 그 일을 한다 — 20초 넘게 담당자 없이 열린 작업을 현장의 누구도 `fitFor > 0` 으로 맡을 수 없고 그 능력의 부대도 오고 있지 않으면 요청한다. `waterRescue` 의 `needFor` 는 `rescue` 이고, 현장 쪽 판정의 `fitFor` 가 곧 R2 의 `methodFit` 식이므로, 쓸 방법이 있는 대원이 없으면 저절로 `rescue` 를 부른다. (R1 의 `capableOf` 는 표에 없는 일을 `true` 로 보므로, 방법이 없는 부대가 오는 중이면 그 부대가 닿아 맡지 못한 뒤 20초에 요청이 나간다 — 늦지만 끝은 난다.)

R1 의 `airFit` 은 수난 사고의 `rescue` 수요에 소방 헬기를, `kitBonus` 는 로프·구명환 대원이 있는 부대를 먼저 고른다. `request` 는 같은 수요를 70초 안에 되풀이하지 않는다.

**지휘관 쪽 낡은 믿음 대비**: 방법이 늘어도 임무는 그대로 `waterRescue` 이므로, 지금의 장치(대상이 이미 물 밖이면 실행부가 `learn(…, true, true)` 로 강제 보고, 지휘관은 믿음상 물 밖이면 `want` 하지 않는다)가 그대로 동작한다. `tend` 처럼 "남이 하는 동안 거드는" 방법도 대상이 물 밖이 되면 첫 줄에서 끝난다.

**현장별로 나오는 갈래**:
- 일반 하천(`water/std` — 강폭 5칸, 사람은 둘째~넷째 줄): 가장자리 줄의 사람은 reach 2(장대·구명환·구명줄·즉석 부력물), 가운데 줄은 reach 3(구명줄·즉석 부력물·헤엄·보트). 손은 거의 나오지 않는다.
- 선박 화재(`fire/ship` — 물에 빠진 사람은 모두 부두 바로 아래 줄, reach 1): **안벽이라 손이 닿지 않는다**(`s.quay`). 장대·구명환·구명줄이 주로 나오고, 줄이 없는 대원은 즉석 부력물, 물살이 빠르면(drift 0.05~0.12) 하류 차단과 보트(구조정이 오면)가 오른다. 안벽 표시가 없으면 손(pref 1.0)이 늘 1등이 되어 선박 화재가 지금보다 크게 쉬워진다(구명줄 약 8초 → 손 약 3.5초).
- 해일(`--disaster tsunami`): drift 0.1 이 붙어 하류 차단·보트·헤엄(빠른 물살 ×0.6)의 비중이 바뀐다.

### 4.2 문·통로 `force`·`clear` (+ 이동 중 하위 작업) — 2단계

`workOnBlocker(sim, s, a, tile, kind, tk)` 에 인자 `tk`(하위 작업이면 `t.sub`, 본 임무면 `t`)를 더하고, 처음 부를 때 `startMethod(…, tk, work = kind, tg = { tile, prop: s.propAt[tile], cas: -1, hostile: -1, region: -1 })`. 기록 줄의 대상은 `tile`·`prop`(3.1 `MethodUse`) — 그래서 "같은 문의 앞선 실패"를 맞출 수 있다(예 6). 속도는 `blockerRate(sim, s, a, tk)`(methodRun) — R1 의 식에서 `toolFor` 자리에 **고른 방법의 장비 값**을 넣는다. `fitFor` 는 바꾸지 않는다(R1 의 `toolFor` 식 그대로 — 누가 맡는가는 그대로, 속도·모습·문구만 방법에 따라).

| 방법 | 임무 | 장비 | 속도 (×staminaF, `p.hp` 를 깎는다) | pref / plain | 특징 |
|---|---|---|---|---|---|
| `kick` 발로 차기·어깨 | force | 없음 | `0.6 + 0.6×rescue + 0.6×0.12 + 0.3×law` | 0.5 / — | 맨몸 방법 |
| `irons` 할리건·도끼 | force | `irons`(R1 force .9) | `0.6 + 0.6×rescue + 0.6×장비 값 + 0.3×law` (R1 식) | 0.85 / 평소 | 조용하다 |
| `ram` 충격기 | force | `breachKit`(R1 force 1.0) | R1 식 + 0.3(내리치는 힘) | 0.8 (경찰 0.9) / — | 끝날 때 13칸 안의 무력화되지 않은 용의자가 문 쪽을 돌아보고 5초 경계(`breach` 의 "문이 열리는 소리"와 같은 코드·같은 반경) |
| `hydraulic` 유압 개방기 | force | `spreader`(R1 force .8) | R1 식 ×1.6 | 0.9 / — | 시작할 때 `kitWorks` — 숨은 고장이면 `broken`. 승강기 문(hp 17)에서 차이가 크다 |
| `handClear` 손으로 치우기 | clear | 없음 | `0.5 + 0.8×rescue + 0.5×0.12` | 0.55 / 평소 | 맨몸 방법 |
| `toolClear` 장비로 절단·지렛대 | clear | `spreader`·`irons`·`lightRescue`·`breachKit` 가운데 가장 좋은 것 | R1 식(`bestTool(…, 'clear', I)` — R1 의 `toolUse`) | 0.8 / 평소 | |

- 상황: 무장 현장에서 믿음에 대치·교전 중(`hold`·`fight`) 용의자가 있으면 시끄러운 방법(kick·ram) ×0.7 → 까닭 `quiet`. 진입조의 동시 진입(`breach`)과 방 진입은 지금 코드 그대로 문을 연다(바꾸지 않는다 — R1 의 진입대원(파괴)이 그 몫이다).
- `agentCost` 의 제거 시간 추정(`forceCost`·`clearCost`)은 **바꾸지 않는다**(R1 의 `toolFor` 식 그대로 — 경로 선택이 크게 흔들린다). 알려진 한계로 둔다.
- `unblock(sim, s, a, tile, method)`: 완료 문구를 방법별로 — "할리건으로 문을 땄습니다. 진입합니다.", "유압 개방기로 철문을 열었습니다.", "충격기로 문을 부쉈습니다.", "문을 걷어차 열었습니다.", "절단기로 잔해를 잘라 통로를 확보했습니다." `markRecovered(PATH_BLOCKED, …)` 의 문구에도 방법 이름을 넣는다. G5 가 합쳐져 있으면 G5 가 `unblock` 에 넣은 `recBreach(…, { how })` 의 `how` 에 이 방법(`kick`·`irons`·`ram`·`hydraulic` — G5 의 `BreachHow` 와 같은 이름)을 그대로 넘긴다.

### 4.3 구출 `extricate` — 차량·붕괴·그 밖 (3단계)

속도 = `rescue × k × staminaF × (연기 0.4 넘으면 0.7)` — `k` 만 방법에 따라 바뀐다(R1 식은 `k = 0.35 + 0.65 × toolFor('extricate')`). `fitFor` 는 그대로. `case 'extricate'` 는 첫 줄 뒤에 `startMethod`, 대상 곁에 처음 닿은 틱에 `recheckOnArrive`(급박 구출의 감각 조건 — 3.2).

**믿음으로 가린다**: 차량(`cb.veh` 가 있다), 붕괴(`s.kind === 'collapse'` 이고 차량이 아님), 구덩이(`cb.pit` — 맨홀), 그 밖(화재 현장·선실·비행기의 고립자). 균열·밸브·연료는 `perceive` 가 모두 `haz { kind: 'leak' }` 로 적으므로, R2 는 그 값에 `sub: 'crack' | 'valve' | 'fuel'` 을 더한다(`agents.perceive` — 진실을 읽어도 되는 곳. 균열부 `unstable` → crack, 밸브 → valve, 차량 연료 → fuel. `executor` `case 'mitigate'` 가 같은 사실을 고쳐 쓰는 두 곳에도 같은 `sub`). 판단부는 `sub` 로만 가린다 — 가스 폭발 현장(붕괴 + 밸브)에서 밸브를 균열로 잘못 보지 않게.

차량(믿음 `veh`):

| 방법 | 장비 | k | 준비 | pref / plain | 조건·위험 |
|---|---|---|---|---|---|
| `manual` 수동 구출(유리 깨고 끌어내기) | 없음 | `0.35 + 0.65×0.12` | — | 0.5 / — | 맨몸 방법 |
| `basic` 손 공구(지렛대) | `irons`·`lightRescue` | `0.35 + 0.65×장비 값` (R1 식) | — | 0.7 / 평소 | |
| `spread` 문 벌리기 | `spreader` | `0.35 + 0.65×장비 값`(= 1.0) | 3초 | 0.85 / 평소 | 시작할 때 `kitWorks` |
| `roof` 지붕 절단 | `spreader` | 1.5 | 8초 | 0.8 (믿음 band ≥ 1 이거나 같은 차(`veh` 가 같은)의 고립자 믿음이 둘 이상이면 ×1.3) / — | 조건(`can`): 같은 작업에 `spreader` 를 든 동료가 2칸 안(구조 공작차의 유압 대원 둘). `kitWorks`. 까닭 `team` |
| `rapid` 급박 구출 | 없음 | `1.8 × (0.35 + 0.65×bestTool(…, 'extricate', I))` | — | 0.95 (조건일 때만) / — | 조건: 믿음 속 4칸 안에 살아 있는 누출(`haz` leak active, sub `fuel`·`valve`)이나 불난 구역(믿음 fire > 0.3), 또는 감각 연기 > 0.3(도착 재선택에서). 끝날 때 대상 피해 10 한 번(척추 보호 없이 끌어냄 — H1 `hurtCas(…, 'blunt')`). 까닭 `danger` |

붕괴(`s.kind === 'collapse'`, 차량이 아님):

| 방법 | 장비 | k | 준비 | pref / plain | 조건·위험 |
|---|---|---|---|---|---|
| `tunnel` 손으로 파기 | 없음 | 0.5 | — | 0.5 / — | 믿음 속 4칸 안에 살아 있는 균열(`haz` leak active, sub `crack`)이 있으면 `mrng.chance(0.006 × dt)` 로 '잔해가 다시 흘러내림': 대상 피해 8, 대원 피해 6(H1 `hurtCas`·`hurtResponder`, 원인 `crush`), `emit` |
| `basic` | `irons`·`lightRescue` | R1 식 | — | 0.7 / 평소 | |
| `airbag` 에어백 들기 | `airbag` | 1.6 | 5초 | 0.85 / — | `kitWorks` |
| `shore` 지지대 먼저 | `shoring` | basic 과 같음 | 8초 | 0.9 (조건일 때만) / — | 조건: 믿음 속 대상 4칸 안에 살아 있는 균열(sub `crack`)이 있고, 그 균열에 `mitigate` 를 하고 있는 동료가 없다(동료의 `task.kind === 'mitigate' && task.prop === 균열 id`). 까닭 `danger`. 그림: 버팀목 |
| `rapid` | 위와 같음 | | | | 붕괴 현장에서도 감각 연기·불 조건이면 |

`shore` 의 효과: 8초 준비가 끝나면 **그 균열을 직접 보강한다** — 지금 `case 'mitigate'` 의 균열 완료와 같은 처리(`p.mitigated = true`, `learnQuiet` 로 `haz { kind: 'leak', sub: 'crack', active: false }`, `s.staticVersion++`, 같은 완료 문구 "균열부에 지지대를 세웠습니다. 추가 붕괴 위험을 줄였습니다."). 그 뒤 basic 속도로 구출한다. 그 균열의 `mitigate` 작업은 지휘관이 믿음상 끝난 작업으로 거둔다(지금 장치). X6 가 합쳐져 있으면 X6 의 보강 규칙(`c.shored` — 균열이 `mitigated` 가 되면 구획 건전도 +0.1)이 저절로 받는다. 균열을 반만 줄이는 별도 효과를 두지 않는 까닭: 같은 균열에 두 가지 보강 상태가 생겨 `mitigate` 와 겹친다.

구덩이·그 밖(차량도 붕괴도 아닌 고립자):

| 방법 | 장비 | k | 준비 | pref / plain | 조건 |
|---|---|---|---|---|---|
| `manual` | 없음 | `0.35 + 0.65×0.12` | — | 0.5 / — | 맨몸 방법 |
| `basic` | `irons`·`lightRescue` | R1 식 | — | 0.7 / 평소 | |
| `haul` 줄로 끌어올리기 | `rope` | 1.2 | 4초(줄 내리기, 라벨 '줄 내리는 중') | 0.9 / — | 믿음 `pit`(맨홀 아래 — `casFact` 가 대상 칸의 `roadDebris` 소품 `skin === 'manhole'` 으로 채운다) |
| `rapid` | 위와 같음 | | | | 감각 연기·불(화재 현장의 고립자) |

H1 의 "구출 중 잔해(붕괴 현장에서 구출을 마칠 때 `injuryRng.chance(0.06 × hazardMul × (1.2 − u.tool))`)"는 H1 몫으로 그대로 두되, `u.tool` 자리에 고른 방법의 장비 값을 넘긴다(맨손·터널이면 더 잦다).

### 4.4 수색·탐지 `search` (3단계)

| 방법 | 현장 | 장비 | 효과 (경유점에서 정지하는 동안, `perceive` 에서) | pref / plain | 조건 |
|---|---|---|---|---|---|
| `call` 호출·청취 (**지금의 방법**) | 실내·붕괴 | 없음 | 지금의 `sweepPoints`·`markCovered`(R1 의 `tic`·`searchKit` 수동 효과는 그대로 든다) | 0.6 / 평소 | |
| `listen` 청음 탐지 | 붕괴 | `searchKit` | 경유점마다 정지 0.5초 → 3초. 정지하는 동안 `c.health > 30` 인 대상(소리를 낼 수 있다)의 은폐 ×0.75 — R1 의 수동 효과(×0.45)에 곱해 약 0.34 | 0.85 / — | `s.kind === 'collapse'` |
| `line` 줄 수색 (**지금의 방법**) | 야외(`s.kind === 'search'`) | 없음 | 지금대로 | 0.6 / 평소 | |
| `hail` 확성기 호출 수색 | 야외 | `megaphone` | 경유점마다 2초 정지하며 부른다. `c.health > 30` 인 대상(대답할 수 있다)의 은폐 ×0.5. 의식이 흐린 사람에게는 효과가 없다 | 0.75 / — | 야외 수색 |
| `thermal` 열화상 수색 | 야외 | `tic` | 경유점마다 1.5초 정지해 훑는다. 모든 대상의 은폐 ×0.6 | 0.8 (조건일 때만) / — | 밤이거나, 그 구역에 나무 칸이 30% 넘게 있다 |

- **배율은 `perceive` 의 구조 대상 반복문에서 곱한다**(진실을 읽어도 되는 곳 — 대상의 체력을 봐야 한다). `methods.ts` 는 `searchMul(a): { k: number; voice: boolean }` 만 내보낸다(대원의 임무·방법·정지 중인지(`t.wait > 0`)만 본다 — 순수 함수). `perceive` 는 `const sm = searchMul(a)` 를 한 번 구해, 대상마다 `voice` 면 `c.health > 30` 일 때만 `c.concealment × sm.k` 로 `detectRadius` 를 부른다. `agents.detectRadius` 의 R1 줄(`kitLive(searchKit)` 이면 붕괴 현장 은폐 ×0.45 — R1 이 순수 함수로 두었다. 숨은 고장은 R1 이 붕괴 현장의 첫 `perceive` 에서 `kitWorks` 로 드러낸다)은 **그대로 둔다**. 장비가 필요한 탐지 방법(`listen`·`thermal`)은 경유점에서 처음 멈출 때 실행부가 `kitWorks(searchKit / tic)` 를 부른다 — false 면 `switchMethod('broken')`(야외에는 연기가 없어 R1 의 자리에서는 `tic` 의 고장이 드러나지 않는다). `markCovered`(수색 완료 판정)와 단서 탐지에는 곱하지 않는다.
- 수색 임무는 시작할 때 한 번 고른다(경유점마다 다시 고르지 않는다). `thermal` 의 "다음 경유점이 나무 칸" 조건은 고를 때 그 구역의 칸 가운데 나무 칸(`T.TREE`)이 30% 넘게인지로 본다(생김새).
- 열화상의 연기 감쇠는 R1 의 수동 효과이므로 실내 방법으로 따로 두지 않는다. 야외의 `thermal` 은 정지해 훑는 행동이라 따로 둔다.
- 경유점마다 정지하므로 수색이 느려진다(경유점 수 × 정지 시간). 대신 숨은 사람을 더 멀리서 찾는다 — 6절에서 수색 시간과 미발견 수를 함께 본다.
- 수색 결과 보고는 지금처럼 즉시 보낸다(`flushOutbox` 의 `prompt` — CLAUDE.md 함정).

### 4.5 화재 `suppress` (4단계)

`case 'suppress'` 첫 줄 앞에서 `startMethod`(선택 임무 — null 이면 지금 코드), 화점 곁에 처음 닿은 틱에 `recheckOnArrive`(배연의 감각 조건). 방법이 `interior`(또는 없음)면 **지금 코드 그대로**, 그 밖이면 `runSuppress(…)` 로 간다. `runSuppress` 는 대상 칸 고르기, '진압 확인' 보고(`learn(fire, 0)`), 끝내는 조건을 지금의 `suppress` 와 같게 쓴다 — 서는 자리·효과·물만 다르다. `spray` 의 인자 `eff`(효과 배율)·`wmul`(물 소모 배율, 기본 1)은 X6 가 먼저 더한다(X6 §외부 방어) — 없으면 R2 가 더한다. R1 의 기관원 배율과 곱한다. R2 는 그 뒤에 `jitter`(기본 `true`)를 더하고 자기 호출에서는 `false` 를 넘긴다(3.5 — 새 코드는 `s.rng` 를 쓰지 않는다).

X6 가 합쳐져 있으면: 믿음 속 `ops` 사실의 `mode === 'defensive'` 이거나 그 구역이 단계 3 위험 구역이면 `suppress` 후보를 `defensive`·`aerial` 로만 좁힌다(지휘관이 정한 외부 방어 — X6 "R2 의 선택과 관계없이 외부 방수만"). 외부 방수 자리는 X6 의 `exteriorSpot` 을 쓴다(없으면 아래 표의 규칙).

| 방법 | 장비 / 부대 | 서는 자리 · 거리 | 효과 · 물 | 노출 | pref / plain | 고를 조건 |
|---|---|---|---|---|---|---|
| `interior` 내부 공격 (**지금의 방법**) | `hose`(펌프·물) | 화점 3.2칸·시야 | ×1 · ×1 | 지금대로(연기·열) | 0.85 / 평소 | R1 의 진압 자격 |
| `defensive` 외부 방어 방수 | `hose` | 실내가 아닌 칸에서 5.5칸, 시야(창은 통과 — `losWalls`) | ×0.7 · ×1.4 | 없음 | 0.7 (조건이면 ×1.4) / — | 믿음 속 그 구역 불 ≥ 0.7 이고, 그 구역에 믿음상 구조 대상이 없고, 그 구역 수색 확인율 ≥ 0.72 이거나 붕괴 현장 — "사람이 없다고 확인된 큰 불은 밖에서 끈다". 또는 자기 `r.health < 50`, 또는 R1 의 공기 잔량(`scba` 의 `uses`)이 60초 아래. 까닭 `danger` |
| `aerial` 고가 사다리 방수 | `hose` **그리고** 사다리차(`needUnit: ['ladder']`) | 대기 지점 쪽 실외 칸에서 7.5칸 | ×1.3 · ×2 | 없음 | 0.8 (조건이면 ×1.3) / — | 그 구역에 창(`T.WINDOW`)이 있고 믿음 불 ≥ 0.5. 대원이 사다리에 오르지 않으므로(조작대에서 방수) 추락 위험은 두지 않는다 |
| `extinguisher` 소화기 | `extinguisher`(한 개 = 12초 분사) | 1.8칸 | `applyWater(s, tx, ty, 0.10 × dt)` 를 직접 부른다. 물·펌프를 쓰지 않는다(지금 `spray` 의 펌프·물 검사를 거치지 않는다). 그림은 `pushFx('spray', 흰색)` — **위치를 흩뜨리지 않는다**(`s.rng` 를 쓰지 않는다). 12초 쓰면 `useKit` | 지금대로 | 0.6 / — | 믿음 속 그 구역 불 ≤ 0.35 이고, (실외 구역이거나 화재·가스·붕괴 현장이 아님) — 차량 화재·작은 불의 초기 진압 |
| `ventilate` 배연(송풍기) | `fan` | 가장 가까운 출입구 3칸 안에서 6초 설치(`kitWorks`) | `s.fan` 120초(`power` 1, 3.5 의 규칙) | — | 0.75 (조건일 때만 고를 수 있고, 그때 ×1.3) / — | `scba`(`kitCount`), 감각 연기 > 0.5(도착 재선택에서), 같은 현장에 송풍기가 없음(동료의 `task.method` 도 아님), 믿음에 불난 구역이 있다(불의 위치를 알고 하는 배연만). 설치가 끝나면 같은 대원은 **예정된 전환**으로 `interior` |

- `agents.fitFor` `suppress`: R1 의 자격(`hose` && 펌프 정상 && 물)이 아닌 대원이라도 `extinguisher` 를 고를 수 있으면 0.25.
- 화재 유형은 B1 이 균형을 맞추고 있다. 이 단계는 B1·R1·X6 가 합쳐진 뒤에 잰다(6절).

### 4.6 무장 `engage` (5단계)

지금의 분기와 R1 의 행동을 방법 이름으로 부르고, 검거·무력화 기록 자리에서 `recordMethod` 만 더한다 — **기록 전용**(`record: true`, 고르지 않는다. 지금처럼 현장 상태가 분기를 정한다). `chooseMethod` 는 새 방법 둘(`beanbag`·`sniper`) 가운데 하나를 고르거나 아무것도 고르지 않는다(선택 임무). 고르지 않으면 `t.method` 를 비운 채 지금의 분기 순서대로 돈다.

**무력화 수단 기억**: 용의자를 무력화하는 코드가 그 자리에서 `h.stunHow` 를 적는다 — `hazards.flashbang` 은 `'bang'`, R1 의 테이저는 `'taser'`, 비살상탄은 `'beanbag'`. 검거 기록은 그 값을 쓴다.

**기록 전용 분기 → 기록 이름**(`recordMethod(sim, I, a, t, 이름, 'doctrine', true, 그 검거 기록 id, { hostile: h.id, … })`):

| 자리 (`executor` `case 'engage'`) | 기록 이름 | plain |
|---|---|---|
| 첫 갈래(도주 중 `h.state === 'flee'`)의 검거 | `chase` | 평소 |
| 첫 갈래(흉기·비무장에게 다가가)의 검거 | 무력화가 살아 있거나 막 풀렸으면(`sim.t < h.stunUntil + 1`) `h.stunHow`(R1 테이저면 `taser`), 아니면 `tackle` | taser 는 — / tackle 평소 |
| ③ "무력화된 용의자 제압"의 검거 | `h.stunHow`(`bang`·`taser`·`beanbag`), 없으면 `tackle` | bang·taser·beanbag 은 — |
| 동시 진입(`breach`)·방 진입 뒤의 검거 | `breach` | 평소 |
| 엄폐 사격 분기에서 쏜 뒤 용의자가 `down` | `cover` | 평소 |
| 위의 어느 검거든 검거한 대원이 R1 의 방패수(`shield` 장비)이고 무력화 수단이 없으면 | `shield` | — |
| `case 'load'` 가 헬기(R1 `u.air`)에 환자를 태울 때 | `airlift` | — |
| R1 `rules/air.ts` 의 호이스트 완료 | `hoist`(`recordAir`) | — |

**새 방법을 끼우는 자리** — 두 곳(어느 쪽이든 쏜 틱에는 `return` — 한 틱에 `moveTo` 하나):
1. **흉기 상대**: `case 'engage'` 의 첫 갈래 `if (h.state === 'flee' || h.weapon !== 'gun') { … }` 는 흉기·비무장·도주 용의자를 ①·② 보다 먼저 처리하고 `return` 한다. 그래서 흉기 상대의 비살상탄은 **이 갈래 안, `moveTo` 를 부르기 전**에 둔다 — R1 의 테이저 바로 다음(4칸 안이고 테이저가 있으면 테이저가 먼저).
2. **총기 상대(대치 중)**: 비살상탄·저격은 ①-2 다음, ② 섬광탄 분기 앞에 둔다.

| 방법 | 장비 | 대상 · 조건 | 실행 | pref / plain |
|---|---|---|---|---|
| `beanbag` 비살상탄 | `beanbag`(발 — `kitCount > 0`) | 흉기·총기, 인질 곁이 아님(믿음 `hostage` 거짓), 9칸·시야, 총기면 대치(`hold`) 중일 때만 | 조준 1.5초 → 명중 `clamp(0.5 + 0.3×law, 0.2, 0.85)`(`mrng`) → `h.stunUntil = sim.t + 4`, `h.stunHow = 'beanbag'`, 사기 −0.3, 피해 8(H1 `hurtHostile(…, 'blunt')`). 한 발에 `useKit` 1. G5 가 있으면 판정 직후 `recShot(sim, s, a, 'beanbag', h.x, h.y, hit, 1, h.id)`. 그다음은 지금의 ③ "무력화된 용의자 제압" 분기가 잡는다. 다 쓰면 조건 상실 → 선택 임무라 `t.method` 를 비우고 지금 분기로 | 0.8 / — |
| `sniper` 결정적 저격 | `sniper`(R1 저격·관측수) | 믿음: 총기 용의자가 인질을 붙잡은 채 교전 중이거나, 협상을 시작한 지(`s.negotStart`) 60초가 넘었는데 그 용의자가 아직 대치 중 | 대기 지점 쪽 엄폐 자리, 16칸·시야 → 조준 6초 → 명중 `clamp(0.55 + 0.4×law − (움직이면 0.2), 0.3, 0.95)`(`mrng`) → 피해 70(H1 `hurtHostile(…, 'gunshot', { down: true })` — 70 으로는 체력 100 에서 쓰러지지 않으므로 H1 이 "한 번에 쓰러뜨림"을 켠다). 빗나가면 `mrng.chance(0.2)` 로 인질이 다친다(지금 `shootAt` 의 인질 피격과 같은 처리, H1 이면 `hurtCas`). G5 가 있으면 `recShot(…, 'sniper', …)`. 기록 imp 3. 엄폐 자리를 못 찾으면(`nopath`) `switchMethod('tooFar')` → `a.mfail` 15초 → 선택 임무라 지금 분기(엄폐 사격·덮치기)로 이어 간다 | 0.6 (조건일 때만) / — |

- 판정은 모두 `mrng`. 지금의 `shootAt`·`flashbang` 이 쓰는 `s.rng`, R1 테이저의 `kit:<현장>` 에 호출을 더하지 않는다.
- R1 의 테이저·방패는 다시 만들지 않는다. R1 이 없으면 `taser`·`shield` 기록은 생기지 않는다(대체를 만들지 않는다).
- CLAUDE.md 함정 "쏘지 않는다는 규칙에는 다른 행동이 따라야 한다": 저격 자리를 못 잡는 저격수가 조준 → 실패를 되풀이하지 않도록 `a.mfail` 이 그 대상의 `sniper` 를 막고, 선택 임무라 평소 분기로 넘어간다(테스트 4).

### 4.7 응급 `treat` · 이송 수단 (6단계)

| 방법 | 누가 · 조건 | 실행 | pref / plain |
|---|---|---|---|
| `stay` 현장 안정 후 이송 (**지금의 방법**) | | 지금대로 | 0.8 / 평소 |
| `rush` 즉시 이송 | 구급 장비(`bag`·`alsBag`·`doctorKit` — `kitCount`)를 든 대원, 믿음 band 2, 현장에 환자 자리가 남은 부대(`seatsLeft > 0`)가 있다 | 처치 필요 시간 3.0(지금은 4.5 + 2~4), 품질 ×0.7. 끝나면 `c.rush = true`(casFact 가 믿음에 싣는다). `commander` 구조 대상 블록에서 믿음 `rush` 인 환자는 처치가 더 필요하다고 보지 않고(`needTreat` 와 안전 구역 쪽 처치 조건에 `!c.rush`), 탑승 작업 우선순위를 `(c.treated ? 0.7 : 0.5) + urg` 대신 0.97 로 둔다 | 0.9 (조건일 때만) / — |
| `airlift` 헬기 이송 (**기록 전용**) | R1: 위중 환자는 자리가 남은 헬기를 먼저(지휘관의 탑승 배정) | `load` 가 헬기에 태울 때 `recordMethod(…, 'airlift', …)` | — / — |

즉시 이송을 지휘 규칙(`orders/`)에서 "처치 작업 거두기"로 만들지 않는 까닭: 지휘관이 계획마다 처치를 다시 `want` 하면 거둔 작업 대신 새 작업이 생겨 작업판이 계속 불어난다. 지휘관의 조건 자체에 `!c.rush` 를 넣는다.

### 4.8 누출 조치 `mitigate` · 통제 `perimeter` (6단계)

`mitigate` 는 가스 밸브만이 아니라 균열부 보강·차량 연료 누출 조치도 맡는다(`workLabel`). 그래서 평소 방법은 **하위 종류와 상관없이 늘 고를 수 있는 `seal`**(누출·균열 조치)이고, 새 방법은 믿음의 `sub` 로 가린다. 완료 문구는 지금처럼 소품 종류별로 갈린다.

| 방법 | 장비 | 실행 | pref / plain | 조건 |
|---|---|---|---|---|
| `seal` 누출 조치 (**지금의 방법**) | (R1 `plugKit` 이면 빠르다) | 지금대로(밸브 차단·균열 보강·연료 차단) | 0.8 / 평소 | 늘 |
| `ventFirst` 환기 후 차단 | 없음 — 효과가 `fan` 유무로 갈린다(`kitCount(fan) > 0` 이면 송풍기: 설치 6초, `power` 1 / 없으면 맨몸으로 문·창 열기: 설치 12초, `power` 0.5) | 밸브가 있는 방의 출입구 앞에서 설치 → `s.fan`(가스 현장에서는 `s.smoke` 가 가스다) → 20초 또는 감각 가스 < 0.4 까지 기다림 → 지금의 밸브 차단(필요 시간 ×0.8) | 0.75 (조건일 때만, 그때 ×1.3) / — | 믿음 `haz` 의 `sub === 'valve'` 이고 active, `scba`, 그 방 문 앞에 처음 닿았을 때의 감각 가스 > 0.6(도착 재선택), 같은 현장에 송풍기가 없음. 까닭 `danger` |
| `cordon` 출입구 통제 (**지금의 방법**, `perimeter`) | | 지금대로 | 0.7 / 평소 | 늘 |
| `announce` 대피 방송 (`perimeter`) | `megaphone`(R1: 순찰 팀장·기동 조장·경계 요원) | 가스 현장의 출입구 통제 자리에서. `hazards.tickGas` 의 "통제되지 않은 출입구로 다가온 시민" 확률에 ×0.4(현장에 이 방법을 쓰는 대원이 있을 때. 확률만 곱하고 `s.rng.chance` 호출은 그대로). 시작할 때 한 번 `emit` "주변에 대피 방송을 합니다." | 0.8 / — | 경찰, 가스 현장 |

환기는 짙은 가스 칸 수를 줄여 `tickGas` 의 폭발 판정을 바꾼다. 그 판정은 `dense < 10` 이면 `s.rng` 를 부르지 않으므로(단락 평가) 그 현장의 이후 `s.rng` 결과가 달라진다 — 같은 현장 안의 일이고, 새 동작이므로 괜찮다. X6 가 합쳐져 있으면 X6 의 가스 모델이 `s.fan` 을 출입구 3칸 감쇠로 읽는다 — 그 감쇠에 `power` 를 곱한다(10절).

### 4.9 야외 수색 — 7단계 (선택)

| 방법 | 장비 · 부대 | 효과 | 조건 |
|---|---|---|---|
| `air` 공중 수색 | (R1 경찰 헬기의 관측자 — 기록 전용) | R1 7.3 | |
| `drone` 드론 열화상 | 드론 장비(R1·R3 에서 생기면 `KitId` 에 더한다) | 조종자는 대기 지점에 서 있고 '눈'이 경유점을 4칸/초로 돈다. 나무 은폐 ×0.6, 밤에 강함. 배터리 120초 → 교체 20초 | |
| `dog` 탐지견 | 탐지견 팀(부대가 생기면) | 은폐 ×0.3, 반경 ×1.3, 30초마다 5초 휴식 | |

R1 에 이미 있는 장비로 만들 수 있는 야외 수색 방법(`hail`·`thermal`)은 4.4 에 넣었다(3단계). `drone` 은 "몸과 다른 곳에서 보는 눈"이 필요하다 — R1 의 관측자(`AirOp.eye`, `s.agents` 밖의 `FieldAgent`)와 같은 방식으로 만든다. 장비·부대가 정해진 뒤에 한다. 탐조등(R1 `searchlight`)은 경찰 헬기 관측관(내리지 않는 자리)만 들어 지상의 방법이 되지 못한다.

---

## 5. 고르는 예와 그 기록

점수는 3.4 의 식으로 어림한 것이다(둘째 자리에서 반올림). 이름은 보기다(R1 뒤에는 0·1번 자리만 지금 이름이고, 나머지 자리는 R1 의 새 이름 목록에서 온다).

**예 1 — 로프 대원, 2.6칸 거리, 의식 있음** (구조1 구조대원(로프) 오세린: rescue 0.8, fitness 0.7, composure 0.6, experience 0.4 → caution 0.8, swimOf ≈ 1.0. 장비: 구명줄·구명환·구명조끼·드라이슈트·고무보트. 대상 믿음 band 0, reach 2.6, drift 0.02, 맑음)
후보: rope 0.95 · ring 0.94 · boat 0.73 · swim 0.51 · improvise 0.34 → **rope**, 까닭 `doctrine`(평소 방법 — 시작을 알리지 않는다). pole·hand 는 닿지 않는다. improvise 는 reach > 2.4 라 ×0.6(0.5 × 1.12 × 0.6).

```
10:07:17 [02] COMMANDER/권도현: 오세린, 구조 대상 A 수난 구조 맡아라.
10:07:27 [02] RESPONDER/오세린: 줄이 빗나갔습니다. 다시 감아 던집니다.                    ← imp 0 (자세히 보기 -v 에서만)
10:07:35 [02] RESPONDER/오세린: 구조 대상 A, 구명줄로 끌어냈습니다. 처치와 이송이 필요합니다.
```

**예 2 — 줄이 없는 순찰 대원** (순찰1 순찰 경관 이서준: rescue 0.22, fitness 0.8, composure 0.5, experience 0.3 → caution 0.86, swimOf ≈ 0.63. 구명줄 없음, reach 3.0, band 1)
후보: swim 0.38 · improvise 0.27(0.5 × 0.89 × 0.6) → **swim**, 까닭 `noGear`(장비를 따지지 않은 1등은 rope 0.75), `missing = 'rope'`.

```
10:12:03 [05] RESPONDER/이서준: 구조 로프가 없습니다. 헤엄쳐 들어가겠습니다.
10:12:14 [05] RESPONDER/이서준: 구조 대상 A를 붙잡았습니다. 물가로 끌고 갑니다.
10:12:23 [05] RESPONDER/이서준: 구조 대상 A, 헤엄쳐 끌어냈습니다. 처치와 이송이 필요합니다.
보고서: "구조 대상 A는 이서준 대원이 헤엄쳐 들어가 구했습니다 (구조 로프가 없었음)."
```

같은 자리에 swimOf 0.3 인 순찰 대원이 섰다면 후보는 improvise 0.27 하나다(헤엄 문턱 0.35 아래) — 줄이 없고 헤엄도 못 치는 사람은 옷을 이어 던진다.

**예 3 — 위중한 대상: 줄 대신 고무보트, 그리고 상공의 헬기** (예 1 의 오세린. 대상 믿음 band 2(체력 35), reach 2.4. 소방 헬기가 상공에 있다)
후보: boat 0.84 · swim 0.41(위중 ×1.15, 상공 헬기 ×0.7) · rope 0.33 · ring 0.33 · improvise 0.20 → **boat**, 까닭 `weak`. 지휘관은 같은 대상에게 `hoist` 도 냈다(R1) — 먼저 끝나는 쪽이 이긴다.

```
10:15:40 [07] RESPONDER/오세린: 대상이 줄을 잡을 힘이 없습니다. 고무보트를 띄우겠습니다.
10:15:56 [07] RESPONDER/오세린: 보트를 띄웠습니다.
10:16:02 [07] UNIT/헬기1: 호이스트로 구조 대상 B 인양 완료.                                ← R1 의 문구. R2 는 기록만 더한다
10:16:02 (오세린의 수난 구조 작업은 대상이 물 밖이 되어 첫 줄에서 끝난다 — 다음 판단에서 'ashore', 보트로 진수 지점 둘레의 물 칸까지 와서 뭍에 오른다)
보고서: "구조 대상 B는 헬기1이 호이스트로 끌어올려 구했습니다."
```

**예 4 — 헤엄 실패 뒤 다른 대원이 구명줄로** (`water/std` 의 가운데 줄 대상, reach 3, drift 0.03, 체력 70. 먼저 닿은 순찰2 순찰 경관 서예린은 구조 로프가 없고 swimOf 0.55. 이어서 진압3 진입대원 구본호가 닿는다 — 구조 로프 있음)

```
10:21:10 [09] RESPONDER/서예린: 구조 로프가 없습니다. 헤엄쳐 들어가겠습니다.
10:21:24 [09] RESPONDER/서예린: 허우적대는 대상에게 붙잡혀 함께 가라앉을 뻔했습니다. 뭍으로 돌아갑니다.   ← 문제 기록 METHOD_FAIL (대상 체력 > 40)
10:21:31 [09] RESPONDER/구본호: 구명줄을 던지겠습니다.                                     ← 평소 방법이지만 같은 대상의 앞선 실패가 있어 알린다
10:21:41 [09] RESPONDER/구본호: 구조 대상 C, 구명줄로 끌어냈습니다. 처치와 이송이 필요합니다.
보고서: "대응 방법이 1차례 막혔습니다 (헤엄 구조 중 허우적대는 대상에게 붙잡힘) — 구본호가 구명줄로 다시 시도해 성공."
```

서예린은 그 대상에 대해 60초 동안 헤엄·보트를 고르지 않는다(`a.mfail`) — 뭍에 오르자마자 다시 뛰어드는 일이 없다.

**예 5 — 줄도 없고 헤엄도 못 치는 대원, 하류에 다리** (순찰3 순찰 경관 한지민: swimOf 0.3, 구명줄 없음. 대상 reach 3, drift 0.05, 하류 2칸에 다리 — 닿는 데 약 20초)
후보: catch 0.8 · improvise 0.27 → **catch**, 까닭 `doctrine`(장비를 따지지 않아도 1등이 catch 다 — rope 0.75 보다 높다. 그래서 `noGear` 가 아니다). 평소 방법이 아니므로 알린다.

```
10:30:02 [11] RESPONDER/한지민: 하류 다리에서 기다렸다 붙잡겠습니다.
10:30:31 [11] RESPONDER/한지민: 구조 대상 A, 다리 밑에서 붙잡아 끌어냈습니다.
```

**예 6 — 문** (구조1 구조대원(유압) 홍서진: 유압 구조기에 숨은 고장, 할리건 없음)

```
10:41:10 [14] RESPONDER/홍서진: 유압 구조기가 작동하지 않습니다.                          ← R1 kitWorks 가 남기는 EQUIP_FAIL
10:41:10 [14] RESPONDER/홍서진: 장비 없이 문을 걷어차 열겠습니다.                          ← switchMethod('broken') 의 무전 한 줄
10:41:21 [14] RESPONDER/홍서진: 문을 걷어차 열었습니다. 진입합니다.
보고서: "홍서진의 유압 구조기가 고장 — 홍서진이 발로 차 다시 시도해 성공."               ← 같은 문(tile)의 ok=false 줄이 그 EQUIP_FAIL 을 가리킨다
```

**예 7 — 흉기 용의자와 총기 용의자** (기동1 기동대원 강현우: 테이저는 R1 몫. 기동 조장 정지호: 비살상탄)

```
10:52:40 [16] RESPONDER/강현우: 테이저 발사 — 용의자 1 무력화.                              ← R1 의 문구 (h.stunHow = 'taser')
10:52:42 [16] RESPONDER/강현우: 무력화된 용의자 1 제압·검거!                                ← 지금 문구. R2 는 recordMethod('taser')
10:53:05 [16] RESPONDER/정지호: 총기 소지, 대치 중 — 비살상탄으로 무력화하겠습니다.          ← ①-2 다음 · ② 앞의 자리
10:53:07 [16] RESPONDER/정지호: 비살상탄 명중. 용의자 2 무력화.                             ← ③ 이 이어서 검거 → recordMethod('beanbag')
```

**예 8 — 선박 화재의 안벽** (부두 바로 아래 줄의 대상 reach 1, drift 0.09. 진압3 기관원 구본호는 장대, 순찰1 순찰 팀장은 맨몸)
구본호(rescue ≈ 0.3): pole 0.88(0.92 × 0.96) → **pole**(평소, 알리지 않음). 순찰 팀장(rescue 0.22): hand 는 안벽이라 빠지고, catch(빠른 물살 ×1.3, 하류에 뭍이 있으면) 또는 improvise(0.5 × 0.89 = 0.44) → 하류에 뭍이 없으면 **improvise**, 까닭 `noGear`(장비를 따지지 않은 1등은 pole 0.87 — `missing` = `pole`, "갈고리 장대가 없습니다. 옷을 이어 던지겠습니다.").

---

## 6. 균형과 다시 재는 법

방법이 늘면 양쪽으로 움직인다.

| 쉬워지는 쪽 | 어려워지는 쪽 |
|---|---|
| 가까운 사람은 손·장대로 빨리 건진다. 위중한 사람은 보트·헤엄으로 건진다. 유압 장비로 문·구출이 빨라진다(지붕 절단·에어백·끌어올리기). 경찰·구급이 소화기로 작은 불을 먼저 잡는다. 비살상탄으로 교전 없이 검거한다. 청음·호출·열화상으로 숨은 사람을 더 멀리서 찾는다 | 투척이 빗나간다. 위중한 사람은 줄을 못 잡는다(늦게 닿을수록 어려워진다 — 의도). 헤엄 구조에 대원이 다친다(익수 피해, 붙잡힘). 장비가 없거나 숨은 고장이 드러난다. 배연이 불을 키울 수 있다. 급박 구출이 환자를 다치게 한다. 탐지 방법은 경유점마다 서서 수색이 느려진다 |

**목표**(난이도 보통, **R1·H1·X6 를 합친 뒤의 기준 수치** 대비 — 0단계 전에 같은 명령으로 재어 scratchpad 에 둔다):
- 전체: `npm run check` 의 범위(성공+대응 지연 65~90%, 실패+미해결 3~25%, 한계 시간·무대응 4% 이하, 평균 대응 90초 이하) 안, 그리고 기준과 성공률 ±3%p.
- 수난 사고: 성공률이 기준 ±5%p, `--force water/std` 20교대에서 한계 시간 ≤ 2, 수난 사건당 대원 부상(`RESPONDER_HURT`) ≤ 0.15, 대원 순직 0.
- 선박 화재: 성공률이 기준 ±5%p(안벽 표시 덕에 손이 지배하지 않아야 한다), `--force fire/ship` 20교대에서 성공 방법 3가지 이상(장대·구명환·구명줄·즉석 부력물·하류 차단·보트 가운데), `hand` 0.
- **다양성(단조로움의 지표)**: `--force water/std` 20교대에서 성공한 방법이 **4가지 이상**, 가장 많이 쓰인 방법이 **70% 이하**. 문은 3가지 이상, 화재 3가지 이상, 무장 4가지 이상(기록 전용 포함, 각 단계의 강제 교대에서), 실종 2가지 이상(`line`·`hail`·`thermal`).
- 무장: 성공률 기준 ±5%p, 그리고 `armed/hostage`·`armed/siege` 의 투항 비율이 기준 ±10%p(저격의 "협상 60초 뒤" 조건이 투항으로 끝날 사건을 저격으로 끝낼 수 있다 — 넘으면 60초를 늘린다).
- 부대 규모 1(`--diff 3,3,3,3,3,1` — R1 최소 인원)에서 맨몸 방법·헤엄이 늘어난다(방법 분포가 손잡이를 따른다).
- 구출: 평균 구출 시간 ±15%(평소 방법의 식을 그대로 두었으므로 크게 움직이지 않아야 한다). 화재 현장의 급박 구출이 늘어 화재 결과가 움직이면 감각 조건(연기 0.3)을 올린다.

**재는 법** — 단계마다 전후로(전 = 그 단계 직전 커밋):

```bash
npx tsx scripts/sweep.ts 60 --scen --methods            # 분포, 시나리오별 표, 방법별 성공 횟수
npx tsx scripts/sweep.ts 20 --force water/std --scen --methods
npx tsx scripts/sweep.ts 20 --force fire/ship --scen --methods
npx tsx scripts/sweep.ts 20 --disaster tsunami --scen --methods
npx tsx scripts/sweep.ts 20 --diff 3,3,3,1,3,3 --force water/std --methods     # 장비 불량 (숨은 고장↑)
npx tsx scripts/sweep.ts 20 --diff 3,3,3,3,3,1 --force water/std --methods     # 최소 인원 (줄 가진 사람↓)
npx tsx scripts/sweep.ts 1 --force water/std --log S7                           # 왜 그 방법을 골랐는지 읽는다
# 단계별: 2 문 → --force collapse/elevator, armed/hostage, fire/std · 3 구출·탐지 → traffic/std, traffic/manhole, collapse/std, search/std
#         4 화재 → fire/std, fire/arson · 5 무장 → armed/dispute, armed/robbery, armed/hostage, armed/siege · 6 → medical/trauma, hazmat/std
npm run check                                           # 단계를 끝낼 때 한 번 (오래 걸린다)
```

- `scripts/sweep.ts` 에 `--methods` 를 더한다. 표 셋: ① 모든 사건의 `I.methods` 에서 `ok: true` 를 방법별로, `ok: false` 를 (방법, 까닭)별로 센다 ② 방법별 평균 구출 시간(`ok: true` 줄의 `t − t0`) ③ 시나리오별 대원 부상(`RESPONDER_HURT` 문제 수)·순직(H1)·사건 수. `--json` 이면 요약에 `methods` 를 넣는다. 6절의 목표는 이 표로 그대로 잰다.
- 0단계(틀만) 커밋은 **기록 해시가 한 건도 달라지지 않아야 한다**: 같은 시드 몇 개(`S0`~`S9`)의 `sim.report.hash` 를 전후로 비교한다. 근거: `orders/methods.ts` 는 0단계에 아무것도 등록하지 않고, `rules/methods.ts` 는 `s.flow`·`s.quay` 만 쓴다(기록·난수 없음, 아무도 읽지 않는다). `casFact` 의 새 칸은 `significant()`·`sameSig` 를 고치지 않으므로 무전 문구가 늘지 않는다. 다만 `beliefs.merge` 는 값이 다르면 새 소식으로 보므로(`sameValue`), 걸려 멈춘 사람의 `drift` 가 0 으로 바뀌는 순간 무전 자료가 한 번 더 오갈 수 있다 — 해시가 달라지면 `casFact` 의 새 칸을 1a 단계로 미룬다.
- 시뮬레이션을 고친 뒤 `sweep 60` 의 결과 분포와 `close reasons` 의 `timeout` 건수를 전후로 비교한다(CLAUDE.md 작업 방식). 범위를 벗어나면 방법의 `pref`·판정 수치를 조정한다. 범위 자체(`sweep --check`)는 건드리지 않는다.

## 7. 구현 순서 (유형 하나씩 — 단계마다 커밋)

| 단계 | 내용 | 끝났다는 증거 |
|---|---|---|
| **0 틀** | `types.ts` 추가, `crews.ts` 의 `KitDef` 두 칸과 장비 아홉 줄(역할에는 아직 붙이지 않는다 — 결과가 바뀌지 않게), `gear.ts`, `methods.ts`(`METHOD` 는 `Record` 라 모든 방법의 줄을 둔다 — 실행부가 아직 없는 방법은 `can: () => false`. `WORK_MODE`·`canUse`·`swimOf`·`chooseMethod`·`methodFit`·`reachOf`·`landComp`·`catchPoint`·`targetKey`), `methodRun.ts`(공통 함수·`ExecKit`), `executor` 의 `XK`, `casFact` 의 새 칸(해시가 바뀌면 1a 로), `rules/methods.ts`(`s.flow`·`s.quay` 만), `orders/methods.ts`(등록 없음 — 1a 에서 규칙 한 줄), `scenes/index.ts` import, `debrief` 의 `METHOD_FAIL`·방법 문장·`methods` 집계(아직 쓰이지 않는다), 패널 두 줄(방법이 없으면 비어 있음), `sweep --methods`, 테스트 1(격리) | `tsc` 통과, 기록 해시가 전과 같다 |
| **1a 수난: 물가 방법** | 역할에 `pole`·`pfd`·`drysuit`·`raft` 붙이기, `resources` 의 수량 복사와 `kit-r2`·`aid-r2` 고장 추첨, hand·pole·ring·rope·improvise·catch, 투척 빗나감·잡기, `fitFor` → `methodFit`, `case 'waterRescue'` → `runWaterRescue`, 완료 문구, `recordAir`, 안벽 표시, 지휘 규칙(거듭 실패 → 지원 요청) | `--force water/std` 20교대 표, `tests/sim.test.ts` 수난·`tests/major.test.ts` 선박 화재 통과 |
| **1b 수난: 헤엄** | 물 위 바탕(3.5: `costFor`·`moveSpeed`·`waterTick`·`ashore`·`pullAshore`·`brain` 가드·`fitFor` 의 물 위 가드·`finishTask` 내려놓기·`rules/methods` 의 안전장치·체력 하한 18), swim·tend·붙잡힘, `a.mfail` | 물 칸에 갇힌 대원 0, 대원 부상·순직 목표 안 |
| **1c 수난: 보트** | boat(구조정·고무보트 — 진수 때 물 칸으로 옮기기, 뭍에 대기), `rules/air.ts` 의 끌려가는 대상 기다리기 | 보트 장면 테스트, 해일에서 boat 성공이 있다 |
| **1d 수난: 그림** | 3.7 의 수난 줄, 헤엄치는 대원, 보트, `agentPose` | 스크린샷(`?seed=…&force=water/std`), 콘솔 오류 0, 분포가 1c 와 한 건도 다르지 않다 |
| **2 문·통로** | 4.2, `workOnBlocker`·`unblock`, G5 의 `recBreach` 에 방법 넘기기 | 다양성 목표, 분포 |
| **3 구출·탐지** | 4.3·4.4, 역할에 `airbag`·`shoring`, `haz` 의 `sub`, `casFact` 의 `veh`·`pit`, `searchMul`(`perceive`) | 구출 시간 ±15%, 실종 수색 시간·미발견 수 |
| **4 화재** | 4.5, 역할에 `extinguisher`·`fan`, `spray` 인자(X6 가 없을 때만), 송풍기 규칙, `fitFor suppress` 소화기 | B1·R1·X6 뒤 화재 성공률 −3~+5%p |
| **5 무장** | 4.6, 역할에 `beanbag`, `h.stunHow`(`hazards.flashbang` 한 줄·R1 테이저), 기록 전용 분기의 `recordMethod`, G5 의 `recShot` | 무장 성공률·대원 부상·투항 비율 |
| **6 응급·가스** | 4.7·4.8, `commander` 구조 대상 블록의 두 군데(`!c.rush`·즉시 이송 탑승 우선순위), `hazards.tickGas` 방송 배율 | 응급 대응 지연 비율이 늘지 않는다 |
| 7 야외 수색 (선택) | 4.9 — 장비·부대가 정해진 뒤 | |

각 단계: `npx tsc --noEmit` → `npx vitest run tests/methods.test.ts tests/ext.test.ts` → 6절의 sweep 전후 비교 → 커밋(한국어, `wf/methods` 에만, 푸시하지 않는다). 그림은 단계마다 함께 해도 되지만, 화면만 고친 커밋은 분포가 같아야 하므로 시뮬레이션 커밋과 나눈다.

## 8. 테스트 (`tests/methods.test.ts`)

무거운 반복은 피한다: 강제 교대는 `new Sim(seed, NORMAL, 1200, { force: 'water/std' })`, 장면 단위는 `createIncident(sim, { type, variant, rng: sim.rng.fork('t') })`. 장비를 빼는 것은 R1 의 장비 항목에 `faultKnown = true`(알려진 고장 — `hasKit` 이 false)를 주거나 `kit` 에서 지운다. 특정 부대만 나가게 하려면 다른 부대를 시작 전에 `oos` 로 둔다.

1. **판단부는 진실을 읽지 않는다**: `src/sim/field/methods.ts` 의 주석이 아닌 줄에 `s.props`·`s.casualties`·`s.hostiles`·`.truth`·`s.fire[`·`s.smoke[`·`sim.scenes`·`s.variant`·`.fault`·`kitWorks`·`useKit` 가 없다. `agents`·`hazards`·`executor`·`methodRun`·`crews` 를 import 하지 않는다(`tests/ext.test.ts` 의 지휘 규칙 검사와 같은 방식). `orders/methods.ts` 는 기존 테스트가 이미 검사한다.
2. **장비를 빼면 다른 방법을 쓴다**: 수난 강제 교대 6개(시드 `W0`~`W5`)를 두 번 — 한 번은 그대로, 한 번은 시작 전에 모든 대원의 `rope`·`ring`·`pole` 을 알려진 고장으로. 앞쪽은 성공 방법에 rope 나 pole 이 있고, 뒤쪽은 rope·ring·pole 이 없으며 성공한 수난 구조가 있고 그 방법은 hand·improvise·catch·swim·boat·hoist 가운데 하나다. 장비를 뺀 쪽에서 `why === 'noGear'` 이고 `missing` 이 있는 기록이 하나 이상.
3. **방법마다 실제로 쓰인 교대가 있다**:
   - 수난 강제 12교대 + 2번의 장비를 뺀 6교대: 성공 방법 집합 ⊇ {rope, pole, swim, improvise}.
   - 선박 화재 4교대(`tests/major.test.ts` 의 `MA`~`MD`): `hand` 성공이 없다(안벽), 성공 방법에 pole·ring·rope·improvise 가운데 하나 이상.
   - 장면을 직접 만들어: **boat**(수난 현장, 대상 reach 3·믿음 band 2 — 구조정 대원 하나만 있는 장면과 고무보트를 든 로프 대원 하나만 있는 장면 둘. 각각 boat 를 고르고, 진수한 틱에 그 대원이 물 칸에 있고 `afloat === 'boat'`, 대상이 뭍에 내려진 뒤 대원이 뭍 칸에 있고 `afloat` 가 없다), **catch**(대상을 다리 3칸 위에 두고 `drift = 0.08`, 줄·헤엄이 없는 대원 하나), **tend**(헤엄 대원과 구명줄을 가진 같은 작업의 동료), **hand**(대상을 일반 물가 1칸에), **hoist 기록**(R1 의 호이스트로 끝난 대상의 `freedHow === 'hoist'`).
   - 2단계 뒤: 문 — hydraulic·irons·kick 성공 각각 ≥ 1(`collapse/elevator`·`fire/std`·순찰만 나가는 `armed/dispute` — 다른 부대 `oos`). 3단계 뒤: haul ≥ 1(`traffic/manhole`, 구조 공작차), hail 또는 thermal ≥ 1(`search` 강제). 4단계 뒤: extinguisher ≥ 1(차량 화재가 있는 `traffic` 강제 또는 직접 만든 장면). 5단계 뒤: beanbag ≥ 1·taser 기록 ≥ 1(`armed/dispute`·`armed/robbery`).
4. **헤엄 구조는 수영 능력과 위험을 반영하고, 물 위의 대원은 끝내 나온다**:
   - 대원의 `fitness`·`skills.rescue` 를 바꾼 뒤 `swimOf` 를 계산해 문턱과 비교한다: `swimOf < 0.35` 이고 구명조끼가 없으면 `chooseMethod` 가 swim 을 내지 않는다. 구명조끼를 주면 `swimOf ≥ 0.25` 일 때 낸다(역할 보정·개인차 때문에 고정 숫자로 단정하지 않는다).
   - `swimTrouble(swim, flowK, pfd, drysuit, tended, tired, towing, night)` 는 swim 이 클수록 작고, pfd·tend 가 있으면 작고, flowK 가 클수록 크다. 붙잡힘 확률은 대상 `c.health ≤ 40` 에서 0.
   - 통합(헤엄·보트가 쓰인 교대들): 물 칸 위의 대원은 R2 의 피해로 `r.health < 18` 이 되지 않는다(매 100틱 검사, `down` 제외). 대원이 `down` 이 된 **다음 틱**에 그 대원은 물 칸에 없다(안전장치). 헤엄 중인 대원의 `r.health` 가 30 아래로 내려가면 다음 판단에서 그 대원의 임무가 `ashore` 다. 교대가 끝났을 때 물 칸에 서 있는 대원·`afloat` 인 대원이 없고, 닫힌 사건에 `onscene` 으로 남은 부대가 없고, 모든 현장이 `archived` 다.
   - **방법이 없는 대원만 있는 수난 장면도 끝난다**: rope·ring·pole 이 없고 `swimOf < 0.35` 인 대원만 있는 수난 현장(대상 reach 3)이 한계 시간 전에 끝난다 — 즉석 부력물로 건지거나 B3 의 "맡을 사람이 없는 작업" 블록이 부른 부대가 건진다.
   - **저격 자리가 없는 저격수**: 저격 조건(협상 60초 뒤 대치 중)인데 엄폐 자리로 갈 길이 없는 장면에서, 저격수가 60초 안에 평소 분기(엄폐 사격·덮치기 — `t.method` 가 비고 `engage` 를 계속)로 넘어가고, 같은 대상에게 `sniper` 를 다시 고르지 않는다(`a.mfail`).
5. **끌어낸 사람은 물 밖 뭍에**: 모든 강제 교대에서 `tFreed ≥ 0` 인 물속 대상은 `inWater === false` 이고 그 칸이 물이 아니거나 `where !== 'scene'`(tests/sim.test.ts 의 조건과 같다), 그리고 `freedHow` 가 있다.
6. **재현성**: 같은 시드 두 번의 `report.hash` 가 같다 — 수난 강제, 장비를 뺀 교대, 무장 강제 각각. R2 가 더한 장비의 고장 추첨이 R1 의 흐름 결과를 바꾸지 않는다: 같은 시드에서 R1 장비들의 `fault` 가 R2 장비를 붙이기 전과 같고, **인근 도시 지원 부대**(`createAidUnit`) 대원의 능력치와 R1 장비 고장도 R2 장비를 붙이기 전과 같다(테스트 안에서 `KITS` 의 `batch: 'r2'` 장비를 역할에서 뺀 표로 한 번 더 만들어 비교).
7. **기록과 보고서**(분석 문장은 11~12줄에서 잘리므로 **문제가 셋 이하인 사건**만 본다): 평소 방법이 아닌 방법으로 구한 사건의 `result.analysis` 에 그 방법의 `noun` 이 들어간 문장이 있다. `METHOD_FAIL` 이 있는 사건은 (다음 방법이 성공했다면) 그 문제가 `recovered`. 장비 고장 뒤 다른 방법으로 끝낸 사건의 그 `EQUIP_FAIL` 이 `recovered`(문은 `tile` 로 맞춘다). 보고서 요약에 "대응 방법:" 줄이 있다(평소 방법이 아닌 성공이 있을 때).
8. **소모 장비와 순수 함수**: 소화기를 12초 쓰거나 비살상탄을 쏘면 `kitCount` 가 준다. 0 이면 그 방법을 고르지 않는다. `chooseMethod`·`methodFit`·`searchMul`·`reachOf` 를 백 번 불러도 시뮬레이션 상태(장비 수량·고장 표시·난수 흐름·`a.mfail`)가 바뀌지 않는다.
9. **다양성**(느슨하게): 수난 강제 20교대에서 성공 방법 3가지 이상, 가장 많은 방법 85% 이하(6절의 목표 70% 는 sweep 으로 본다).

## 9. 고칠 파일

**자기 파일**: 첫머리의 표.

**공용 파일 수정**(이 표에 없는 곳을 고쳐야 하면 고치되, 끝낼 때 보고에 파일·함수·이유를 적는다):

| 파일 | 함수·자리 | 무엇을 · 왜 | 단계 |
|---|---|---|---|
| `types.ts` | 3.1 | 추가만(`MethodId`·`MethodWhy`·`MethodUse`, 선택 칸들, `KitId` 끝 새 줄, `METHOD_FAIL`, `ashore`). R1 이 없을 때만 `KitId`·`Unit.gearUse`·`Unit.gearKnown` | 0 |
| `crews.ts` (R1) | `KitDef` | `uses?`·`batch?` 두 칸 | 0 |
| | `KITS` | 장비 아홉 줄(3.3) | 0 |
| | `ROLES` 의 기본 장비 | 역할 끝에 장비 붙이기(3.3 표) — 붙이는 단계에서만(1a·3·4·5) | 1a~5 |
| `resources.ts` (R1 이 고친 것) | `createRoster`·`createAidUnit` 의 장비 복사 | `KITS[id].uses` 가 있으면 `KitItem.uses` 로 | 1a |
| | 두 함수의 고장 추첨 반복 | `batch === 'r2'` 장비를 건너뛰고, 끝난 뒤 `kit-r2` / `aid-r2:<n>` 흐름으로 따로 뽑는다(3.3) | 1a |
| `difficulty.ts` | `Tuning`·`tuningOf` | R1 이 없을 때만 `gearOk`·`toolFail` | 0 |
| `field/rules/air.ts` (R1) | 호이스트 완료 | `recordAir(sim, I, u, c, ev)` 한 줄 | 1a |
| | 호이스트 진행 | 대상이 `where === 'carried'` 면 진행하지 않고 기다린다 | 1c |
| `field/executor.ts` | 파일 끝 | `XK: ExecKit` | 0 |
| | `act` | `left`·`down` 검사 다음에 `waterTick` 한 줄 | 1b |
| | `case 'waterRescue'` | 몸통을 `runWaterRescue(sim, s, I, a, t, XK); return;` 으로(지금 줄은 rope·`landCasualty` 로 옮긴다) | 1a |
| | `moveTo` | 비용 함수를 `costFor` 로(물 위·헤엄·보트). `agentCost` 생성 횟수 유지 | 1b |
| | `moveSpeed` | 맨 앞에 물 칸의 헤엄·보트 속도 | 1b |
| | `finishTask` | 실패 사유 표에 `nomethod: '쓸 수 있는 방법이 없습니다'`. 업고 있던 사람이 물속 사람일 때의 내려놓기와 완료 기록(3.5) | 1a·1b |
| | 새 `case 'ashore'` | 물 위의 대원을 뭍으로(3.5) | 1b |
| | `workOnBlocker`(인자 `tk` 추가, 호출 두 곳)·`unblock`(인자 `method`) | 속도를 `blockerRate` 로, 완료 문구를 방법별로, G5 의 `recBreach` 에 방법 | 2 |
| | `case 'extricate'`·`case 'search'` | `startMethod`·`recheckOnArrive`, 속도 `k`·탐지 정지, `shore` 의 균열 보강 | 3 |
| | `case 'mitigate'` | `haz` 사실 두 곳에 `sub`(3단계), `seal`·`ventFirst`(6단계) | 3·6 |
| | `spray`(인자 `eff`·`wmul`, 기본 1 — X6 가 이미 더했으면 그대로 — 와 `jitter`, 기본 `true`)·`case 'suppress'` | 방법 분기 한 줄, `recheckOnArrive`. R2 의 호출은 `jitter = false`(`s.rng` 를 쓰지 않는다) | 4 |
| | `case 'engage'` | 비살상탄 두 자리·저격, 검거·무력화 기록 자리마다 `recordMethod`(4.6 표) | 5 |
| | `case 'treat'`·`case 'load'`·`case 'perimeter'` | rush·airlift 기록·announce | 6 |
| `field/agents.ts` | `casFact` | `CasBelief` 의 `water`·`drift`(0단계), `veh`·`pit`(3단계), `rush`(6단계) — 본 것을 그대로 | 0·3·6 |
| | `perceive` | `haz` 사실의 `sub`(균열·밸브 / 차량 연료 두 곳), 구조 대상 반복문의 `searchMul` | 3 |
| | `fitFor` | 맨 앞의 물 위 가드(1b), `waterRescue` → `methodFit` 식(1a), `suppress` 의 소화기 길(4) | 1a·1b·4 |
| `field/brain.ts` | `think` | 물 위의 대원 가드(3.5) — 철수 지시 블록 바로 다음, 공기통·X6 철수 명령보다 앞 | 1b |
| `field/commander.ts` | 구조 대상 블록: `needTreat`·안전 구역 쪽 처치 조건, 탑승 우선순위 | `!c.rush`, 즉시 이송이면 0.97 | 6 |
| `field/hazards.ts` | `flashbang` | 무력화한 용의자에 `h.stunHow = 'bang'` | 5 |
| | `tickGas` 주변 시민 확률 | 대피 방송이 있으면 ×0.4(곱만) | 6 |
| `debrief.ts` | `PROBLEM_LABEL`·`order`·문장 표 `T` | `METHOD_FAIL`(`times` 합) | 0 |
| | `evaluate` 끝(맺음말 앞) | 방법 문장 최대 2 | 0 |
| | `buildReport` | `methods` 집계, 요약 한 줄(평소 방법 빼고) | 0 |
| `field/scenes/index.ts` | 끝 | `import '../rules/methods';` `import '../orders/methods';` (세계 규칙은 등록 순서대로 돈다 — R1 의 `rules/air`·X6 의 `rules/catastrophe` 다음, 맨 끝에) | 0 |
| 생성 리터럴 | `executor.makeTask`·`kit.ts`(`addCas`·`baseScene`·용의자)·`hazards.ts` 주변 시민·`incidents.ts`·`events.raiseProblem`·대원 리터럴 | 새 선택 칸을 `undefined` 로(3.1 끝 — 속도만) | 0 |
| `view/renderScene.ts` | `agentPose` | 방법별 자세·물건(G5 의 하위 작업 분기보다 앞) | 1d~ |
| | 대원 그리기 | 헤엄치는 대원(`drawSwimmer`), 보트 위 대원 | 1d |
| | "구조 줄" 블록 | `drawMethodFx(ctx, s, L, o)` 호출 하나로 바꾼다(그림은 `methodsLayer.ts`) | 1d |
| `view/scene/sprites.ts` | `ArmPose`·`Item`·`drawPerson` 끝의 물건 그림 | 3.7 의 자세·물건(G5 가 넣은 `'throw'`·`'ram'` 은 빼고), `drawBoat`, 헤엄치는 대원 모습 | 1d~ |
| `ui/panels.tsx` | 대원 정보(R1 의 역할·장비 줄 아래) | 방법·방법 후보 | 0 |
| `scripts/sweep.ts` | 인자 처리·출력 | `--methods`(표 셋 — 6절) | 0 |
| `tests/crews.test.ts` (R1) | 역할 기본 장비를 글자 그대로 비교하는 곳이 있으면 | R2 장비를 기대값에 더한다 | 1a~5 |

`sceneManager.ts` 는 고치지 않는다(대원 리터럴에 칸을 넣는 한 줄 — R1 이 없을 때 — 말고): 부대 도착·`agentHealth`(물 위에서 쓰러지지 않게 하는 것은 R2 피해의 하한 18 과 `rules/methods.ts` 의 안전장치로)·한계 시간·부대 출발은 R1·H1 이 고친 그대로다. `hazards.tickHostiles`(방패)·`commander` 의 헬기 먼저는 R1 이 한다 — R2 는 고치지 않는다.

## 10. R1·H1·X6·G4·G5·R3 과의 맞물림

**R1(부대 편성·개인 장비·헬기 세 종류)** — `docs/specs/R1-crews.md` 를 읽고 맞췄다.
- 장비 이름: R1 의 `KitId` 를 그대로 쓴다 — 할리건·도끼는 `irons`, 충격기는 `breachKit`, 청음 장비는 `searchKit`, 저격 소총은 `sniper`, 확성기는 `megaphone`, 열화상은 `tic`. R1 에 없는 아홉 가지만 R2 가 더한다(3.3).
- 자료형: R1 의 `KitDef`(name·group·tool·med·armor·faultable)에 `uses?`·`batch?` 두 칸을 더한다. 수량은 R1 처럼 명부가 `KitItem.uses` 에 채운다(R2 장비는 `KitDef.uses` 에서 복사).
- 함수: `methods.ts`·`methodRun.ts` 는 `gear.ts` 를 거쳐 `hasKit`·`kitUses`(판단부 — `kitCount`), `kitWorks`·`useKit`·`toolUse`(실행부 — `bestTool`), `KITS`(`kitName`·`kitTool`), `seatsOf`(`seatsLeft`), `roleOf`(`swimBonus`) 를 쓴다. 숨은 고장은 판단부가 모른다(R1 원칙과 같다).
- 명부: R1 의 `createRoster`·`createAidUnit` 의 고장 추첨 반복에 "R2 장비 건너뛰기" 한 줄, 그 뒤에 R2 장비의 따로 추첨(`kit-r2`·`aid-r2:<n>`). R1 의 `kit`·`aid:<n>` 흐름의 결과는 그대로다.
- R1 이 이미 하는 행동은 다시 만들지 않는다: 소방 헬기의 호이스트(`hoist` 작업, `rules/air.ts`), 테이저(`executor` 의 다가가는 부분), 방패의 방호(`armorOf`), 열화상·탐지 장비의 수동 효과, 위중 환자의 헬기 먼저(지휘관 탑승 배정). R2 는 이들을 **기록 전용 방법**으로 기록·그림·보고서에 싣는다. 호이스트 실행에는 "끌려가는 대상은 기다린다" 한 줄을 더한다(4.1).
- R1 의 `fitFor`(장비 자격)·역할 선호는 그대로 두고, 수난 구조의 장비 항만 `methodFit` 으로 바꾸고 맨 앞에 물 위 가드를 둔다.
- R1 의 최소 인원(부대 규모 1·2)에서 펌프차의 진입대원(줄)이 빠지는 것이 그대로 "줄이 없는 상황"을 만든다 — R2 가 따로 손잡이를 만들지 않는다.
- R1 의 결정 11("헤엄쳐 구조 같은 방법 갈래는 R2")·"이번에 하지 않는 것"("구조정의 바다 쪽 현장 그림과 보트 구조")을 이 문서가 받는다.
- 확인할 것: R1 이 구현되며 `KITS`·`ROLES`·`createRoster` 의 모양이 문서와 달라졌으면 그 모양을 따른다. 장비 그림(R1 10절)과 R2 의 물건 그림 이름이 겹치면 R1 쪽을 쓴다.

**R1 이 아직 없을 때**: 3.3 끝의 대체(`gear.ts` 의 `UNIT_KITS`·부대 단위 `kitCount`·`kitWorks`)로 만들고, 기록 전용 방법(hoist·taser·shield·airlift)은 생기지 않는다. R1 이 들어오면 `gear.ts` 의 몸만 R1 함수로 바꾸고 대체를 지운다 — `methods.ts`·`methodRun.ts` 는 고치지 않는다.

**H1(부상과 사망)** — `docs/specs/H1-injuries.md` 의 나눔("원인 이름·피해 공식·`hurt*` 는 H1, 언제 그 방법을 쓰는가와 사고 확률(R2 의 `mrng`)은 R2")을 따른다. 헤엄 중 익수 피해(1.2/s, `tick`)와 사고 피해는 `hurtResponder(…, 'drown')`(H1 의 `protection('drown') = 0` — R2 의 사고 식이 `pfd`·`drysuit` 로 이미 줄였다), 붙잡힘은 R2 의 사고 원인 하나, 급박 구출의 환자 피해는 `hurtCas(…, 'blunt')`, 터널 붕락은 `crush`, 비살상탄은 `hurtHostile(…, 'blunt')`, 저격은 `hurtHostile(…, 'gunshot', { down: true })`. 물에서 건진 사람의 남는 악화는 `landCasualty` 에서 `bleedCause = 'exposure'`.
- **물 위의 체력 하한은 H1 이 있든 없든 18 이다**(3.5). H1 의 결정 표("대원의 익수(물 위의 쓰러짐·사망) — 넣지 않는다. R2 의 체력 하한 18 을 둔다")와 같다. H1 문서의 "연관 설계서와 나누는 선" 표의 R2 줄에는 "R2 는 H1 이 있으면 체력 하한 18 을 두지 않고"라는 옛 문장이 남아 있다 — 이 문서와 H1 의 결정 표가 맞고, 합치는 사람이 그 줄을 고친다.
- H1 쪽이 지키는 두 가지(H1 연관 표): `rescueMate` 는 대상이 물 칸이면 물가에서 기다린다. 한 대원을 두 번 옮기지 않는다 — R2 의 `pullAshore` 는 물 칸에서만, `rescueMate` 의 끌기는 뭍에서만.
- H1 의 원인 표가 "R2 의 사다리·창문"으로 적은 추락은 R2 가 만들지 않는다 — `aerial` 의 대원은 조작대에서 방수하고 사다리에 오르지 않는다. H1 이 그 줄을 비워 두면 된다.
- H1 이 없으면 체력을 직접 깎는다(하한 18 그대로).

**X6(위험의 현실화)** — `docs/specs/X6-catastrophe.md` 의 나눔("현장 단위의 전술 모드와 진입 금지 구역은 X6, 방법 선택은 대원 개인의 갈래")을 따른다.
- 외부 방어: X6 의 지휘관이 외부 방어를 정하면(믿음 속 `ops` 사실 `mode === 'defensive'`, 또는 단계 3 위험 구역) R2 의 `suppress` 후보가 `defensive`·`aerial` 로 좁혀진다(4.5). 외부 방수 자리(`exteriorSpot`)와 `spray` 의 `eff`·`wmul` 인자는 X6 가 먼저 만든 것을 쓴다.
- 보강: R2 의 `shore` 는 균열을 `mitigated` 로 만들므로 X6 의 보강 규칙(`c.shored` — 구획 건전도 +0.1)이 저절로 받는다(4.3).
- 환기: R2 의 `s.fan` 은 X6 의 가스 모델이 출입구 3칸 감쇠(×(1 − 0.3))로 읽는다. R2 가 `power`(맨몸 환기 0.5)를 더했으므로 X6 의 그 감쇠에 `power` 를 곱한다(`1 − 0.3 × power`) — X6 를 고치는 쪽이 하나만 고른다: R2 구현 때 X6 의 그 줄에 `power` 를 곱하는 한 조각을 더하고 보고에 적는다.
- 철수 명령: X6 의 `evacuate` 의무는 `brain` 의 철수 지시 블록 바로 뒤에 있고, R2 의 물 위 가드도 같은 자리다. **R2 의 가드를 먼저** 둔다 — 물 위의 대원은 건물 위험 구역 안에 있을 수 없고, 물 한가운데서 철수 목표로 가는 것보다 뭍이 먼저다.
- 6절의 기준 수치는 X6 를 합친 뒤에 잰다.

**G5(교전 연출)** — G5 는 R2 보다 먼저 구현된다. `ArmPose 'throw'`·`Item 'ram'` 은 G5 가 넣은 것을 쓴다. 비살상탄·저격의 판정 직후 `recShot(sim, s, a, 'beanbag' / 'sniper', h.x, h.y, hit, 1, h.id)` 한 줄(G5 `FxWeapon 'beanbag'`). `unblock(…, method)` 의 방법을 G5 의 `recBreach` 의 `how` 로 넘긴다(G5 `BreachHow` 의 문 방법 이름이 R2 의 `MethodId` 와 같다). `agentPose` 의 방법 분기를 G5 의 하위 작업 분기 앞에 둔다. 저격 대원의 겨누는 선은 G5 가 그리지 않고 R2 가 조준선을 그린다.

**G4(현장 가독성)** — G4 는 "구조 줄 블록과 `sprites.ts` 는 R2 몫"이라 적고 건드리지 않는다. R2 의 그림은 `methodsLayer.ts` 에 모으고 `renderScene` 은 9절의 세 자리만 고친다. G4 가 먼저 합쳐졌으면 그 표지 규칙(크기·색)을 따른다. G4 도 R2 의 비살상탄이 `stunUntil` 로 무력화한다는 것을 전제로 적었다(맞다).

**R3(분야별 대응 교본)** — R3 는 `METHOD` 표의 행과 `situ` 조건을 늘리는 것으로 만든다. 공기(R1 `scba` 의 `uses`)·탄약·짝의 유무·부상(H1 `hurtF`·`bandOf`) 같은 '상태'는 `MethodCtx` 에 칸을 더해 넣는다. `situ`·`skill` 은 선택 칸이므로 칸을 넓혀도 기존 행이 깨지지 않는다. 이송·교통 통제의 방법도 R3 몫이다(2절).

## 11. `CLAUDE.md` 에 들어갈 줄 (합친 뒤에 고친다)

**자주 하는 확장** 표에 한 줄:

| 하고 싶은 것 | 고칠 곳 |
|---|---|
| 새 대응 방법 (같은 임무, 다른 방법) | `types.ts` `MethodId`(장비가 새것이면 `KitId` 도) → 장비가 새것이면 `crews.ts` 의 `KITS`(`uses`·`faultable`·`batch: 'r2'`)와 그 장비를 들 역할의 기본 장비 → `field/methods.ts` 의 `METHOD` 표에 한 줄(임무·`kits`/`altUnit`/`needUnit`·`pref`·`risk`·`plain`·`can`·`situ`·`short`·라벨·`noun`)과 `SAY` 문구 → `field/methodRun.ts` 그 임무의 실행부에 분기(장비 효과는 `kitWorks`, 판정은 `mrng`, 기록은 상태를 바꾸는 그 자리에서 `emit`, 끝나면 `recordMethod`) → 그림은 `view/scene/methodsLayer.ts`·`renderScene.agentPose` → 보고서 문장은 `noun` 으로 저절로. 확인은 `npm run sweep -- 20 --force 유형/변형 --scen --methods` |

**함정** 후보:
- **방법을 고르는 코드는 진실을 읽지 않는다.** `methods.ts` 는 믿음·현장의 생김새·자기 장비(`gear.ts` 의 `kitCount` — 알려진 고장만)만 본다(테스트가 금지어를 검사한다). 거리·물살은 믿음으로, 연기·열은 실행부가 대원이 선 칸에서 재서 `Sense` 로 넘긴다. `MethodCtx` 는 `chooseMethod` 안에서만 만든다. 숨은 고장을 드러내는 `kitWorks` 는 실행부에서만.
- **장비 조건은 `kits`·`altUnit`·`needUnit` 에만.** `can` 에 장비를 넣으면 `noGear` 까닭(장비를 빼고 다시 셈한 1등)이 틀린다. "이 부대면 장비 없이도"(구조정의 보트)는 `altUnit`, "이 부대여야"(사다리차)는 `needUnit`.
- **물 위의 대원.** 물 칸에 선 대원은 다른 일로 끌려 나가지 않는다(`brain` 가드 — 철수 지시 다음). 일이 끝나거나 사고가 나면 `ashore`. 경로는 `costFor`(물 칸을 지나는 비용). **보트의 이동 목표는 늘 물 칸**이다 — 뭍 칸을 목표로 하면 `astar` 가 경로를 내지 않는다(뭍 칸을 가운데로 `range 1.5`). 진수할 때는 대원을 물 칸으로 옮긴 뒤 `afloat` 를 켠다(뭍 칸에서 켜면 세계 규칙이 다음 틱에 푼다). 물 위의 매 틱 효과는 `waterTick` 한 곳에서. R2 의 피해는 물 위에서 체력 18 아래로 내리지 않는다. 그래도 남는 경우는 `pullAshore` 가 옮긴다.
- **끌고 오는 동안의 구조 대상은 `inWater` 를 유지한다.** 뭍에 내려놓을 때만(`landCasualty`) 푼다. 중간에 풀면 놓쳤을 때 "물 위에 떠 있는데 물 밖인 사람"이 생겨 아무도 건지지 못한다.
- **방법의 판정은 `mrng` 만.** 사격(`s.rng`)·판단 오차(`a.rng`)·명부·R1 장비(`kit`·`kit:<현장>`·`aid:<n>`)·H1(`injury:<현장>`) 흐름에 호출을 끼우면 무관한 결과까지 바뀐다. `moveTo` 의 비용 함수를 바꿀 때도 `agentCost` 를 만드는 횟수(`a.rng` 한 번)를 지킨다. 역할에 고장 나는 장비를 더할 때는 `batch: 'r2'` 로 R1 의 반복에서 빼고 `kit-r2`·`aid-r2:<n>` 에서 뽑는다.
- **쓸 방법이 하나도 없는 대원은 그 일을 맡지 않는다**(`methodFit` 0). 수난 구조에는 누구나 쓸 수 있는 즉석 부력물(3.6칸 안)을 남기고, 그래도 맡을 사람이 없으면 B3 의 "맡을 사람이 없는 작업" 블록(`fitFor` 가 곧 `methodFit`)이 지원을 부른다. 다른 임무는 맨몸·평소 방법(발로 차기·손으로 치우기·수동 구출·호출 수색·누출 조치·출입구 통제)이 늘 남는다. 진압·교전은 **선택 임무**라 고를 것이 없으면 방법 없이 지금 코드로 간다 — 끝내지 않는다.
- **접은 방법은 대원이 기억한다**(`a.mfail` — 실패 60초, 조건 상실 15초, 고장은 끝까지). `t.tried` 는 임무가 바뀌면 사라지므로 이것이 없으면 헤엄 사고 뒤 뭍에 오르자마자 다시 뛰어들고, 자리를 못 잡는 저격수가 조준 → 실패를 되풀이한다.
- **방법을 바꾸는 때는 셋뿐**(실패·고장·조건 상실 3초), 그리고 한 번의 **도착 재선택**과 **예정된 전환**(방법 안의 단계). "더 좋은 방법이 보이면 바꾼다"를 넣으면 대원이 두 방법 사이를 오간다(한 임무에 이동 목표 둘과 같은 증상).
- **R1 이 하는 행동을 다시 만들지 않는다.** 호이스트·테이저·방패·열화상은 R1 의 코드다. R2 는 그 자리에 기록(`recordMethod`·`recordAir`)만 더한다. 기록 전용 분기는 `recordMethod` 에 자기 방법 이름을 넘긴다(`t.method` 는 비어 있다).

## 12. 알려진 위험과 확인할 것

- **R1·H1·X6 가 문서대로 구현되지 않을 수 있다.** 장비 이름·함수 모양·명부의 고장 추첨 자리·호이스트의 흐름·`hurtResponder` 의 인자·`ops` 사실의 모양이 바뀌면 그쪽을 따른다(10절). 이 문서의 3.3 장비 배치(누가 무엇을 드는가)는 R2 가 정한 것이라 R1 의 균형과 함께 다시 볼 수 있다.
- **수치는 모두 시작값이다**(사거리·준비 시간·명중·사고율·`pref`). 현장 격자 1칸이 실제로 몇 m 인지 정해져 있지 않아 거리는 서로의 비율로만 잡았다(지금의 줄 3.6칸을 기준으로).
- **하류 차단(`catch`)은 평소에 드물 것이다.** 일반 수난 현장의 사람은 다리에서 4칸 이상 위에서 시작하고 drift 가 0.01~0.05 라 다리까지 60초 넘게 걸린다(40초 기준을 넘는다). 굽은 물가에 걸리는 경우·선박 화재·해일과 "줄도 헤엄도 없는 대원"에게서 주로 나온다. 테스트는 장면을 직접 만들어 확인한다. 더 자주 보이게 하려면 40초 기준을 늘린다.
- **건너편 물가로 돌아가는 일**: `reachOf` 는 대원과 같은 뭍 성분(`landComp` — 다리로 이어진 건너편 둔치도 같은 성분)의 가장 가까운 칸을 고른다. 건너편이 더 가까우면 다리를 건너 돌아가서 장대·손을 쓴다(실제로 그럴 수 있는 일이라 두지만, 이동 시간이 길어지면 점수에 이동 거리를 넣는다).
- **호이스트가 지상 방법을 앞지를 수 있다.** R1 에서 물 현장의 소방 헬기는 상공에 머물고 지휘관이 `hoist` 를 함께 낸다. 헬기가 자주 오면 지상의 다양성이 줄어든다(다양성 목표를 기록 전용 포함으로 잡은 까닭). 넘치면 상공 헬기가 있을 때의 지상 배율(swim ×0.7)을 1 로 되돌리거나 R1 의 `airFit` 을 본다.
- **경찰·구급의 소화기 초기 진압**은 화재 사건의 흐름을 바꿀 수 있다(먼저 도착하는 순찰차가 작은 불을 잡는다). B1(화재 균형) 뒤에 재고, 넘치면 `pref` 를 낮추거나 실외 구역으로만 좁힌다.
- **급박 구출**은 화재 현장의 고립자(연기 0.3 넘는 칸)에서 자주 고를 수 있다 — 빨라지는 대신 환자 피해 10. 화재 결과가 움직이면 감각 조건을 올린다(6절).
- **저격과 인질극**: "협상 60초 뒤에도 대치 중"이면 저격을 고를 수 있어, 투항으로 끝날 사건이 저격으로 끝날 수 있다(6절의 투항 비율로 본다).
- **배연의 효과 크기**(연기 감쇠 0.2/초, 불 +0.006/초)는 `tickFire` 가 5틱마다 도는 것과 겹쳐 생각보다 세거나 약할 수 있다. 재어서 정한다.
- **끌고 오는 동안의 대상은 `mob === 'trapped'` 로 남는다.** `orders/major.ts` 의 "옮겨지는 상태가 40초 넘으면 동행(`escort`)" 규칙이 걸리면 동행 실행기가 `trapped` 를 보고 `gone` 실패를 되풀이할 수 있다. 끌고 오는 시간이 대개 10~25초라 드물다. 보이면 그 규칙의 조건에 "믿음 `water` 가 아님"을 더한다.
- **물 위의 안전장치**(쓰러진 대원·오래 갇힌 대원을 물가로 옮김)는 물리적으로 너그러운 처리다. 기록(`truth: true`)으로 드러나게 했다.
- **동시 작업과의 충돌**: `wf/b3`(executor·commander·agents·types·sceneManager)·`wf/p1`(hazards·grid·beliefs)·R1(crews·resources·executor·agents·brain·commander·rules/air)·H1(agentHealth·injury)·X6(brain·executor·hazards·spray)·G4·G5(renderScene·sprites·executor) 과 같은 파일을 고친다. 합치는 순서는 ROADMAP(R1 → H1 → X6 → R2, G4·G5 는 따로). P1(헤드리스 속도)은 기록 해시 전후 비교로 검증하므로 R2 보다 먼저 합쳐야 한다(R2 는 로그 문구를 바꾼다).
- **import 순환**: `methods.ts` → `gear.ts` → R1 `crews.ts`. R1 은 `crews.ts` 가 타입·`util`·`events` 만 import 한다고 정했으므로 `agents → methods → gear → crews` 에 순환이 없다. `gear.ts` 도 `agents.ts`·`executor.ts` 를 import 하지 않는다(대체의 `seatsLeft` 가 자기 표를 쓰는 까닭). `rules/methods.ts` 는 `methodRun.ts` 를 import 한다(같은 자격).
- **성능**: `fitFor` 가 수난 현장에서 `methodFit` 을 생각 주기마다 부른다. `reachOf` 는 믿음 위치 둘레 반경 4칸만 훑고(못 찾을 때만 넓힌다), `landComp` 는 `s.staticVersion` 이 바뀔 때만 다시 칠한다(`WeakMap<Scene, …>`). 느려지면 대원별로 0.5초 동안 결과를 담아 둔다. R1 로 대원 수가 1.9배쯤 늘어나는 것과 겹친다.
- **구조정은 바닷가에만 출동한다**(`dispatcher.pickUnit`). 일반 하천에서 보트 방법은 구조 공작차의 고무보트로만 나온다.
- **방법 문장의 길이**: 보고서의 분석 문장은 11~12줄에서 잘린다. 문제가 많은 사건에서는 방법 문장이 빠질 수 있다(의도 — 문제 설명이 먼저).

## 검토 메모

독립 검토 두 갈래(실현성·규칙 / 빠진 것)의 지적은 대부분 반영했다(물 위 대원이 빠져나오는 길, 보트의 진수·뭍에 대기, `altUnit`·`needUnit`, `recordMethod` 의 방법 인자, 비살상탄 두 자리, 선택 임무와 `a.mfail`, 도착 재선택, R1 의 `KitDef.uses`·명부의 고장 추첨 자리·지원 부대 흐름, `gear.ts` 대체, 청음 배율을 `perceive` 로, 체력 필드 이름, `MethodUse` 의 `missing`·`tile`·`t0`, 기록 전용의 `plain` 표, 수난의 맨몸 방법, 안벽, `haz` 의 `sub`·`seal`·`shore`, 하한 18, 함수 시그니처, X6·G5 맞물림, 실종 수색 방법, 측정 표, 테스트 결정). 그대로 두거나 다르게 반영한 것과 그 까닭:

- 수난 맨몸 방법을 "작업이 생긴 지 25초 뒤 즉석 부력물의 거리 제한을 푼다"로 하지 않고 **즉석 부력물의 사거리를 3.6 으로 넓히고 먼 투척에 ×0.6** 을 주었다 — `methodFit` 이 작업의 나이를 보지 않아도 되고(같은 대원·같은 믿음 = 같은 점수), 헤엄칠 수 있는 대원은 여전히 헤엄을 고른다(예 2). 맡을 사람이 아예 없는 경우(검토가 낸 다른 안 — "30초 넘게 담당자가 없고 쓸 방법을 가진 대원이 없으면 `request('rescue')`")는 새 규칙을 더하지 않았다: `commander.syncBoard` 에 B3 가 넣은 "맡을 사람이 없는 작업" 블록(R1 6.4 의 `anyCapable`)이 같은 일을 20초 기준으로 이미 하고, 그 판정의 `fitFor` 가 R2 의 `methodFit` 식이다. 같은 요청을 두 곳에서 내면 문구만 둘이 된다.
- "물 위에 40초 넘게 있으면 옮긴다"는 쓰지 않았다 — 보트 구조(진수 지점에서 물에 뜬 뒤 접근·끌어올리기·귀환)와 헤엄 구조가 정상으로도 40초를 넘길 수 있다. 대신 `ashore` 가 30초를 넘거나 경로가 없을 때, 그리고 물 위 150초를 마지막 문턱으로 두었다.
- `shore` 의 효과를 "그 균열의 `mitigate` 작업 시간을 줄인다"로 하지 않고 **그 균열을 직접 보강(`mitigated`)** 하게 했다 — 같은 균열에 "반쯤 보강"이라는 두 번째 상태가 생기지 않고, X6 의 보강 규칙(`c.shored`)이 그대로 받는다.
- 실종 수색의 "탐조등 수색"은 넣지 않았다 — R1 에서 탐조등은 경찰 헬기 관측관(내리지 않는 자리)만 든다. 확성기 호출·열화상 수색 둘을 넣었다.
- `aerial` 에 사다리 추락 위험을 넣지 않았다 — 대원이 사다리에 오르지 않는 방법으로 정의했다(H1 의 "R2 의 사다리·창문 추락" 줄은 비워 두면 된다고 10절에 적었다).
- `reachOf` 가 건너편 둔치를 고르는 문제는 같은 뭍 성분 조건만 더하고 이동 거리 감점은 넣지 않았다 — 다리로 돌아가 구하는 것도 실제로 있는 일이고, 점수에 이동 거리를 넣으면 고르는 규칙이 경로 계산에 묶인다. 알려진 위험으로 적었다(12절).
- H1 문서의 연관 표 R2 줄("H1 이 있으면 하한 18 을 두지 않고")은 이 문서의 결정·H1 의 결정 표와 어긋나지만, 이번 검토는 이 파일만 고친다 — 10절에 합칠 때 고칠 줄로 적었다.
