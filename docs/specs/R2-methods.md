# R2 — 대응 방식 다양화: 같은 임무, 여러 방법

공통 규칙은 `docs/specs/README.md`. 브랜치 `wf/methods`, 개발 서버 포트 **5208**(확인 필요: 동시에 쓰이는 R1·G4·H1 설계서의 포트와 겹치면 바꾼다).

사용자 요청(그대로): "대응 방법이 너무 1가지 밖에 없는 것 같아서 단조로우니까 대응 방식도 더 추가하라고 해줘. 예를 들면 물에 빠진 사람을 항상 구명줄로 구하는데 이것도 각자 장비 따라서 없으면 헤엄쳐서 구한다거나 하는 식으로."

한 줄로: 한 임무(`WorkKind`)를 이루는 **방법(Method)** 을 여럿 두고, 그 일을 맡은 대원이 **자기 장비·자기 능력·자기가 본 상황**으로 고른다. 장비가 없거나 방법이 실패하면 다른 방법으로 바꾼다. 관찰자는 기록 문구, 대원의 자세와 손에 든 것, 보고서 문장으로 "이번엔 다르게 했네"를 본다.

**선행 관계**: ROADMAP 의 순서는 R1(부대 편성·개인 장비) → H1(부상과 사망) → **R2** → R3(분야별 대응 교본). R1 이 아직 없어도 10절의 대체 함수(부대 단위 장비 판정)로 끝까지 만들 수 있다. R3 는 이 문서의 틀(방법 표·고르는 점수) 위에 행과 조건을 더한다.

**줄 번호를 쓰지 않는다.** `wf/b3`(executor·commander·agents·types·sceneManager)와 `wf/p1`(hazards·grid·beliefs)이 같은 파일을 고치고 있어 줄 번호가 바뀐다. 위치는 파일·함수·`case` 이름으로 가리킨다.

**자기 파일**(새로 만든다):

| 파일 | 하는 일 | 진실을 읽어도 되는가 |
|---|---|---|
| `src/sim/field/methods.ts` | **판단부**: 방법 표 `METHOD`, 장비 `gearOf`·`hasGear`, 수영 능력 `swimOf`, 고르기 `chooseMethod`·`methodFit`, 지형 계산 `reachOf`·`catchPoint` | **안 된다** — 테스트가 금지어를 검사한다(3.2) |
| `src/sim/field/methodRun.ts` | **실행부**: 방법별 효과(`runWaterRescue` 등), `startMethod`·`switchMethod`·`recordMethod`·`useGear`·`landCasualty`·`senseOf`, 실행 도구 `ExecKit` 의 타입 | 된다(`executor.ts` 와 같은 자격) |
| `src/sim/field/rules/methods.ts` | 세계 규칙: 물살 `s.flow`, 송풍기 `s.fan`, 뭍에 오른 보트 대원 정리 | 된다(`hazards.ts` 와 같은 자격) |
| `src/sim/field/orders/methods.ts` | 지휘 규칙: 수난 구조가 거듭 실패하면 구조정·헬기 지원 요청 | 안 된다(`tests/ext.test.ts` 가 이미 검사한다) |
| `src/view/scene/methodsLayer.ts` | 방법 그림: 줄·장대·보트·헬기 인양·송풍기·지지대 | 화면 계층(읽기만) |
| `tests/methods.test.ts` | 8절 | — |

**공용 파일 수정**(9절에 함수와 이유): `types.ts`, `difficulty.ts`, `field/executor.ts`, `field/agents.ts`, `field/brain.ts`, `field/commander.ts`(6단계에 조건 세 군데), `field/hazards.ts`(5·6단계에 한 줄씩), `debrief.ts`, `field/scenes/index.ts`(import 두 줄), `view/renderScene.ts`, `view/scene/sprites.ts`, `ui/panels.tsx`, `scripts/sweep.ts`(`--methods`).

**건드리지 않는다**: `resources.ts`(R1 이 편성·장비를 고친다. 장비 대체는 `methods.ts` 안에서 한다), `dispatch/*`, `sceneManager.ts`, `builders.ts`·`field/scenes/{crime,major,disaster}.ts`(현장 생성은 그대로 — `scenes/index.ts` 의 import 두 줄만 더한다), `city.ts`·`cityPlan.ts`, `tests/sim.test.ts`, `README.md`·`CLAUDE.md`·`docs/ROADMAP.md`(합친 뒤에 한꺼번에).

---

## 1. 지금 상태 — 방법이 하나뿐인 곳

| 유형 · 임무 | 지금의 방법 (하나) | 근거 |
|---|---|---|
| 수난 구조 `waterRescue` | 물가에서 시야가 닿는 3.6칸 안까지 가서 줄을 던진다. 실패가 없고 시간만 다르다(`9/(0.4+0.8×rescue+0.5×tool)`). 부서 제한이 없어 경찰·구급도 맡는다 — "누구나 줄을 가지고 있다"고 보는 셈. 헬기·구조정 대원도 뭍을 걸어 다니며 같은 일을 한다 | `executor` `case 'waterRescue'`, `agents` `fitFor`, `commander` 구조 대상 블록(믿음 위치의 칸이 `T.WATER` 면 `want('waterRescue')`) |
| 그 그림 | 대원 → 대상 곡선 줄 + 끝의 구명환. 대원은 맨손 기본 자세 | `renderScene` "구조 줄" 블록, `agentPose` 의 `default` |
| 화재 진압 `suppress` | 3.2칸·시야 안에서 호스 방수 하나. 소방만, 펌프·물이 없으면 아무것도 못 한다. 경찰·구급은 작은 불도 끌 수 없다 | `executor` `case 'suppress'`·`spray`, `agents` `fitFor` |
| 문·잔해 `force`·`clear` (+ 이동 중 하위 작업) | 한 식(능력 + `u.tool`)의 속도로 `p.hp` 를 깎는다. 도구 구분이 없다. 그림은 늘 도끼 | `executor` `workOnBlocker`·`unblock`, `renderScene` `agentPose` |
| 구출 `extricate` (차량·붕괴) | `rescue × (0.35 + 0.65 × tool)` 하나. 맨손은 35% 속도라는 연속값일 뿐 별도 방법이 아니다. 그림은 늘 유압 전개기 | `executor` `case 'extricate'` |
| 탐지 (붕괴 현장 수색) | 구조 공작차 대원의 은폐도 ×0.45 라는 숫자 하나. 청음·탐지견 같은 행동은 없다(README '없는 것') | `agents` `detectRadius` |
| 수색 `search` | 경유점을 걸어서 훑는다. 헬기 대원도 걷는다 | `executor` `sweepPoints`·`case 'search'` |
| 무장 `engage` | 분기는 여럿이다(추격 검거·동시 진입·방 진입·섬광탄·덮치기·엄폐 사격) — 이미 '방법'이 있는 유일한 곳. 비살상 무기·방패·저격은 없다 | `executor` `case 'engage'` |
| 응급 `treat`·`load` | 처치가 끝나면 탑승. 기본/전문 처치는 완료 문구만 갈린다. 이송 수단은 "자리가 빈 첫 차" | `executor` `case 'treat'`, `commander` 구조 대상 블록의 `ambulances` |
| 가스 `mitigate`(밸브)·`perimeter` | 밸브를 잠그는 것 하나, 경찰의 출입구 통제 하나. 환기·대피 안내가 없다 | `executor` `case 'mitigate'`, `hazards` `tickGas` |
| 이송 `carry` | 업기 하나(속도 배율만 0.48/0.78/0.7) | `executor` `moveSpeed` |

실제 기록 한 토막(`npx tsx scripts/sweep.ts 1 --force water/std --log S7`): 구조1 권도현(지휘)이 구급1 민지원에게 "구조 대상 A 수난 구조 맡아라"를 지시했다 — 구급 대원도 줄을 던질 수 있다고 보는 셈이다(`fitFor` 에 부서 제한이 없다). 30초 뒤 권도현이 "구조 대상 A를 물에서 끌어냈습니다". 기록 문구에는 '줄'이라는 말조차 나오지 않는다(방법은 머리 위 라벨 '구조 줄 투척'과 줄 그림으로만 드러난다). 같은 사건에 헬기1 이 출동했지만 헬기 대원도 뭍에서 걷는다.

정리:

- **장비는 모두 부대 단위 숫자다**(`Unit.tool` 0..1 하나, `medLevel`, `armor`, `flashbangs` 개수). 구명줄·소화기 같은 물품이 없고 사람마다 다르지 않다(`Responder`·`FieldAgent` 에 장비 칸이 없다). 수영 능력도 없다(가장 가까운 것은 `fitness`). 장비 '개수'가 부대 종류와 난이도로 정해지는 선례는 섬광탄 하나(`resources.createRoster`, `difficulty` `flashbangs [0,1,2,3,4]`).
- **'방법'을 기록하는 칸이 어디에도 없다**(`WorkItem`·`Task`·`Casualty`). 그래서 보고서도 방법을 말하지 못한다(`debrief.evaluate` 의 문장은 문제·사망 문장과 맺음말뿐).
- 이미 있는 선례 — 이 문서는 이것들을 일반화한다:
  - `executor` `engage`: 섬광탄이 있으면 던질 자리로, 없으면 쏘지 않고 다가가 덮친다(장비 유무 → 다른 방법).
  - `brain` 장비 문제: 펌프 고장 → 예비 펌프, 용수 소진 → 소화전(장비 문제 → 대체 행동).
  - `executor` `moveTo`: 막힌 길 앞에서 우회 / 강제 개방 / 포기를 믿음 기반 비용으로 고른다.
  - `agents` `fitFor` `extricate`: 적합도가 낮아도 25초가 지나면 누구든 맡는다(사건이 끝나게 하는 장치).
- README '없는 것'과 ROADMAP C4 에 적힌 것("보트·잠수를 쓰는 수난 구조", "청음·탐지견 같은 행동", "환기, 주변 건물 대피 안내", "하류에서 기다리는 차단선")의 대부분이 이 문서에 들어온다.

## 2. 범위

**하는 것**: 방법의 틀(자료형·고르기·바꾸기·기록·그림·보고서), 4절의 아홉 갈래 방법, R1 이 없을 때의 장비 대체(부대 종류별 장비 표 + 장비 손잡이).

**하지 않는 것**:
- 새 사건 유형·새 시나리오·새 부대 종류(R1 몫). 탐지견·드론은 R1 에 그 부대·장비가 생기면 7단계에서 켠다.
- 지휘관이 방법을 지시하는 것(3.2). 지휘관은 지금처럼 "무엇을 누구에게"만 정한다. 예외는 이송 수단(헬기/구급차) — 지금도 지휘관이 탑승 차량을 고른다.
- 잠수(물 밑 수색)·얕은 물 걸어 들어가기 — 현장 격자에 깊이가 없다.
- 기존 동작의 수치 재조정. 지금의 방법은 표의 "평소 방법"으로 **같은 식 그대로** 남겨, 새 방법이 쓰이지 않는 사건은 결과가 거의 같게 한다.

---

## 3. 방법(Method)의 틀

### 3.1 자료형 (`types.ts` — 추가만)

합집합에 붙일 때는 새 줄로(`docs/specs/README.md` 2절).

```ts
// ───────────────────────── 대응 방법 (R2) ─────────────────────────
/** 같은 임무를 이루는 여러 방법. 내용(조건·속도·위험·문구)은 field/methods.ts 의 METHOD 표 */
export type MethodId =
  | 'hand' | 'pole' | 'ring' | 'rope' | 'improvise' | 'catch' | 'swim' | 'tend' | 'boat' | 'hoist'   // 수난 구조 (waterRescue)
  | 'kick' | 'axe' | 'halligan' | 'ram' | 'hydraulic' | 'handClear' | 'toolClear'                     // 문·통로 (force·clear, 이동 중 하위 작업)
  | 'manual' | 'basic' | 'spread' | 'roof' | 'rapid' | 'tunnel' | 'airbag' | 'shore'                   // 구출 (extricate)
  | 'call' | 'listen' | 'thermal'                                                                       // 탐지 (실내·붕괴 search)
  | 'interior' | 'defensive' | 'aerial' | 'extinguisher' | 'ventilate'                                  // 화재 (suppress)
  | 'chase' | 'breach' | 'bang' | 'tackle' | 'cover' | 'taser' | 'beanbag' | 'shield' | 'sniper'       // 무장 (engage)
  | 'stay' | 'rush' | 'airlift'                                                                         // 응급 (treat · 이송 수단)
  | 'valve' | 'ventFirst' | 'announce'                                                                  // 가스 (mitigate · perimeter)
  | 'line' | 'air' | 'drone' | 'dog';                                                                   // 야외 수색 (search, 7단계)
/** 개인·부대 장비. R1 이 다른 이름을 쓰면 R1 의 이름을 따르고 methods.ts 머리에 대응표를 둔다 (10절) */
export type GearId =
  | 'rope' | 'ring' | 'pole' | 'ladder' | 'pfd' | 'drysuit' | 'raft' | 'boat' | 'hoist'
  | 'axe' | 'halligan' | 'ram' | 'spreader' | 'cutter' | 'airbag' | 'shoring' | 'listener' | 'tic'
  | 'extinguisher' | 'fan' | 'aerial' | 'taser' | 'beanbag' | 'shield' | 'scope' | 'aed' | 'drone' | 'k9';
/** 왜 이 방법을 골랐는가 (기록 문구·보고서 문장이 쓴다) */
export type MethodWhy = 'doctrine' | 'near' | 'noGear' | 'tooFar' | 'weak' | 'fast' | 'failed' | 'broken' | 'danger' | 'quiet' | 'team';
/** 방법을 쓴 기록 한 줄 (보고서는 이것과 Problem 으로만 방법을 말한다) */
export interface MethodUse {
  t: number; rid: number; unitId: number; work: WorkKind; method: MethodId; why: MethodWhy;
  ok: boolean;                                    // true = 이 방법으로 끝냈다, false = 이 방법을 접었다 (실패·고장·조건 상실)
  cas: number; prop: number; hostile: number; region: number;     // 대상 (없으면 -1)
  eventId: number;                                // 그때 남긴 기록
}
```

기존 타입에 더하는 칸(모두 선택 칸):

```ts
// Task
method?: MethodId; mwhy?: MethodWhy;              // 지금 쓰는 방법과 고른 까닭
tried?: MethodId[];                               // 이 임무에서 접은 방법 (다시 고르지 않는다. 모두 접었으면 비운다)
mtry?: number;                                    // 지금 방법을 시도한 횟수 (투척이 빗나간 횟수 등)
mbad?: number;                                    // 고른 방법의 조건이 맞지 않은 지 몇 초 (3초면 바꾼다)
mcands?: { m: MethodId; score: number }[];        // 고를 때의 후보와 점수 (패널이 보여 준다)
// FieldAgent
afloat?: 'boat';                                  // 보트에 타고 있다 (헤엄은 "선 칸이 물" 로 판단하므로 칸이 없다)
mrng?: Rng;                                       // 방법 판정 난수 (처음 쓸 때 만든다, 3.5)
// Unit
gearUse?: Partial<Record<GearId, number>>;        // (R1 없을 때) 이 교대에 써 버렸거나 고장 난 장비 수
// Casualty
freedHow?: MethodId; freedBy?: number;            // 어떤 방법으로 누가 구했는가 (보고서 타임라인)
rush?: boolean;                                   // 구급 대원이 즉시 이송을 정했다
// CasBelief (perceive 가 본 것 — casFact 가 채운다)
water?: boolean; drift?: number; veh?: boolean; rush?: boolean;
// Scene
flow?: number;                                    // 물살 (칸/초). rules/methods.ts 가 관리
fan?: { x: number; y: number; until: number; rid: number } | null;      // 돌고 있는 송풍기
// Incident
methods?: MethodUse[];
// ShiftReport
methods?: Partial<Record<MethodId, number>>;      // 이 교대에 성공한 방법별 횟수
// ProblemCode (끝에 새 줄로)
| 'METHOD_FAIL'                                   // 대응 방법이 실패해 다른 방법으로 바꿨다
// TaskKind (끝에 새 줄로)
| 'ashore'                                        // 물 위의 대원이 뭍으로 돌아간다
```

`difficulty.ts` 의 `Tuning` 에 `gearOk`·`toolFail`(3.3).

`WorkKind` 는 **늘리지 않는다**. 방법은 임무 안의 갈래다. 그래서 지휘관 규칙(`want('waterRescue')`)과 기존 테스트(`tests/major.test.ts` 선박 화재의 `w.kind === 'waterRescue' && w.status === 'done'` 개수)가 그대로 동작한다. 근거: `engage` 가 이미 한 `case` 안에 일곱 갈래를 품고 있고, 새 `WorkKind` 를 만들면 `want`·`cancel`·`fitFor`·`workLabel`·테스트를 두 갈래로 관리해야 한다.

### 3.2 누가 어디서 고르는가 — 맡은 대원이, 판단 전용 파일에서

| 후보 | 장점 | 문제 |
|---|---|---|
| (가) 지휘관이 고르고 지시에 싣는다 | 지시 문구에 방법이 드러난다 | 방법을 가르는 가장 큰 변수가 "그 사람이 무엇을 들고 있는가"(R1 에서는 사람마다 다르다)인데, 지휘관이 그것을 알려면 대원 장비를 진실처럼 읽어야 한다. 지휘관의 믿음은 묶음 보고(5초)만큼 낡아, 떠내려가는 사람과의 거리를 늦게 안다 |
| **(나) 맡은 대원이 고른다** | 자기 장비·자기 능력은 본인이 정확히 안다. 상황(거리·물살·의식)도 그 대원이 가장 새롭게 본다 | 고르는 코드를 진실과 떼어 놓아야 한다 → 판단부를 별도 파일로 |
| (다) 실행기가 진실을 보고 고른다 | 코드가 짧다 | "진실로 판단"하는 예외가 하나 는다. README '알려진 문제'의 정보 격리 예외 3건을 늘리지 말라는 규칙에 어긋난다 |

**결정: (나).** 고르는 일은 `methods.ts` 의 순수 함수 `chooseMethod` 하나가 한다. 실행기(`executor`·`methodRun`)는 그 결과를 받아 `t.method` 에 넣고 효과를 적용할 뿐이다. 지휘관은 "누구에게 맡길지"만 정하는데, `fitFor` 가 `methodFit`(그 사람이 지금 쓸 수 있는 가장 좋은 방법의 점수)을 쓰므로 줄을 가진 사람이 먼저 뽑힌다(지휘관이 부대 편성을 아는 것은 지금도 그렇다 — `assign` 이 `fitFor` 를 쓴다).

**판단부(`methods.ts`)가 읽어도 되는 것**:
- `a.beliefs`(그 대원의 믿음 — 구조 대상의 위치·상태·물속 여부·떠내려가는 속도는 `CasBelief` 의 새 칸으로 들어온다).
- 현장의 생김새: `s.tiles`·`s.region`·`s.regions`·`s.exits`·`s.staging`·`s.safe`·`s.kind`(지휘관·지휘 규칙과 같은 자격. `orders/crime.ts` 주석: "`s.region` 은 건물의 생김새라 읽어도 된다").
- 공개된 것: `sim.weather`, `sim.disaster` 의 `kind`·`phase`(특보), `sim.t`, `s.negotStart`·`s.entryOrdered`(지휘 상태).
- 자기 몸: `sim.responders[a.rid]`, `sim.units[a.unitId]` 의 장비(`gearOf`), `a.task`.
- 동료가 하는 일: `s.agents` 의 `task.kind`·`task.method`·`task.workId`·위치(같은 무전망에서 들린다 — `commander.assign` 도 위치를 쓴다).
- `Sense`: 실행기가 **대원이 선 칸에서** 잰 연기·열을 넘겨준다(몸의 감각. `brain.dangerScore` 가 자기 둘레 3×3 의 `s.fire` 를 읽는 것과 같은 자격).

**읽으면 안 되는 것**(테스트가 글자로 검사한다): `s.props`, `s.casualties`, `s.hostiles`, `.truth`, `s.fire[`, `s.smoke[`, `sim.scenes`, 그리고 `s.variant`(시나리오 변형 — 관제·지휘관은 이름표로만 안다). `methods.ts` 는 `agents.ts`·`hazards.ts`·`executor.ts` 를 import 하지 않는다(`agents.fitFor` 가 `methods.ts` 를 부르므로 순환을 만들지 않는다). import 해도 되는 것: 타입, `grid.ts`(`staticPass`·`losWalls`·`tileOf`), `rng.ts`, `util.ts`, `difficulty.ts` 의 타입.

**고르는 때**:
1. 처음: 실행기가 그 임무를 처음 돌릴 때(`t.method` 가 없을 때) `startMethod`.
2. 바꿀 때 — 이 셋뿐이다. 더 좋은 방법이 새로 보인다고 바꾸지는 않는다(왔다 갔다 방지).
   - 그 방법이 실패로 끝났다: `switchMethod(…, 'failed', 사유)`.
   - 장비가 고장 났다: `switchMethod(…, 'broken', 사유)`.
   - 고른 방법의 조건(`can`)이 3초 넘게 맞지 않는다(`t.mbad ≥ 3`): `switchMethod(…, 'tooFar', 사유)`. 예: 장대를 골랐는데 대상이 떠내려가 2칸 밖으로 나갔다. 도착 전에 대상을 아직 못 본 대원(믿음이 낡았다)이 물가에서 처음 보고 다시 고르는 것도 이 길로 온다.
3. `fitFor` 는 매번 `methodFit` 을 부른다(값만 쓰고 `t` 에 쓰지 않는다).

### 3.3 장비와 능력

```ts
gearOf(sim, a): Partial<Record<GearId, number>>   // 지금 쓸 수 있는 수 = 실린 수 − 써 버린 수(u.gearUse) − 같은 부대 동료가 지금 쓰는 중인 수
hasGear(sim, a, g): boolean                       // gearOf(sim, a)[g] > 0
useGear(sim, a, g, n = 1): void                   // (methodRun.ts) 소모품을 쓰거나 장비가 고장 났을 때만. u.gearUse[g] += n
swimOf(sim, a): number                            // 0..1
```

- `gearOf` 는 **상태를 바꾸지 않는다**. 실린 수는 `sim.rng.fork('gear:' + u.id)` 와 `sim.tune.gearOk` 로 매번 같은 값이 나오게 계산한다(`fork` 는 부모 흐름을 소비하지 않으므로 언제 불러도 결과가 같다 — `rng.ts`). 같은 `Unit` 에 대해 다시 계산하지 않도록 모듈 안의 `WeakMap<Unit, …>` 에 담아 둔다(캐시일 뿐 시뮬레이션 상태가 아니다). 그래서 화면(패널)이 `gearOf` 를 불러도 시뮬레이션이 달라지지 않는다.
- "동료가 쓰는 중": 같은 부대(`unitId`) 대원의 `task.method` 가 그 장비를 쓰는 방법이면 하나를 뺀다(구명줄이 하나뿐이면 둘이 같이 던지지 못한다). 보트·인양기·송풍기가 그렇다.
- **R1 이 없을 때의 장비 표**(부대 종류별 실린 수). `*` 는 늘 있다. 나머지는 하나하나 `tune.gearOk` 확률로 실려 있다(없으면 0).

| 부대 | 실린 장비 |
|---|---|
| 진압 `engine` | rope 1, ring 1, pole 1, ladder 1, pfd 2, extinguisher 1, axe* 2, halligan 1, fan 1, tic 1 |
| 사다리 `ladder` | rope 1, pole 1, ladder* 1, aerial* 1, pfd 2, extinguisher 1, axe* 2, halligan 1, fan 1, tic 1 |
| 구조 공작차 `rescue` | rope* 2, ring 1, pole 1, pfd* 2, drysuit 2, raft 1(확률은 `gearOk` 대신 `[0, 0.5, 0.75, 0.9, 1][장비]`), spreader* 1, cutter* 1, airbag 1, shoring 1, listener 1, tic 1, halligan* 1, axe* 1, extinguisher 1 |
| 화학 `hazmat` | rope 1, pfd 2, extinguisher* 2, fan 1, tic 1, halligan 1, spreader 1 |
| 헬기 `heli` | hoist* 1, rope 1, pfd* 2, drysuit 1, tic* 1 |
| 구조정 `boat` | boat* 1, rope* 2, ring* 2, pole 1, pfd* 2, drysuit 2 |
| 구급 `als`·`bls` | aed* 1, extinguisher 1(확률 `gearOk × 0.6`) |
| 순찰 `patrol` | extinguisher 1, taser 2(탄창), rope 1(확률 `gearOk × 0.35` — 트렁크의 견인줄) |
| 기동 `tactical` | taser 2, shield 1, beanbag 3(발), ram 1, extinguisher 1 |
| 특공 `swat` | shield* 2, beanbag* 3, ram* 1, scope* 1, taser 2 |
| 폭발물 `eod` | shield 1, extinguisher 1 |
| 인근 도시 지원 부대(`u.aid`) | 같은 종류의 줄 |

섬광탄은 지금처럼 `u.flashbangs` 를 쓴다(이 표에 넣지 않는다).

- `Tuning`(장비 손잡이 `e` = 1..5): `gearOk = [0.55, 0.75, 0.9, 0.97, 1][e]` — 있으면 좋은 장비가 실려 있을 확률. `toolFail = [0.12, 0.07, 0.04, 0.02, 0.01][e]` — 동력 장비(spreader·cutter·airbag·fan·hoist)를 **한 번 쓰기 시작할 때마다** 고장 나는 확률. 손잡이 설명(`KNOBS` equipment 의 `desc`)에 '개인 장비(구명줄·소화기 등)의 유무'를 더한다.
- **수영 능력**(R1 에 사람별 칸이 없을 때):

```ts
swimOf = clamp(0.15 + 0.45 × fitness + 0.3 × skills.rescue + 부대 보정 + 개인차, 0, 1)
  부대 보정: heli·boat +0.25, rescue +0.15, 그 밖 소방 +0.05, 경찰·구급 0
  개인차:   (hashStr(r.name + ':swim') % 1000 / 1000 − 0.5) × 0.3      // 난수 흐름이 아니라 이름의 해시 — 명부 난수(rosterRng)를 건드리지 않는다
```

  대략: 순찰 대원 0.2~0.8(열에 일곱은 0.35 를 넘어 헤엄칠 수 있다), 구조대·헬기·구조정 대원 0.55~1. "순찰 대원 가운데도 헤엄을 잘 치는 사람이 있다."

### 3.4 고르는 규칙 (점수)

각 방법은 `METHOD` 표의 한 줄이다.

```ts
export interface MethodCtx {
  sim: Sim; s: Scene; a: FieldAgent; r: Responder; u: Unit; work: WorkKind; t: Task | null;
  cb: CasBelief | null;            // 대상 구조 대상의 믿음 (없으면 null)
  reach: number;                   // 대상 믿음 위치에서 가장 가까운, 걸어서 설 수 있는 칸까지의 거리 (reachOf, s.tiles 만). 모르면 Infinity
  flow: number;                    // 믿음 속 drift (사람이 떠내려가는 모습으로 본 물살). 걸려 있는 사람(drift 0)을 보면 물살이 약하다고 잘못 본다 — 의도다. 실제 위험은 실행부가 s.flow 로 매긴다
  weak: boolean;                   // 믿음 band ≥ 2 (위중 — 줄을 잡을 힘이 없을 수 있다)
  sense: Sense;                    // { smoke, heat } 선 칸의 감각 (fitFor 에서는 0)
  mates: FieldAgent[];             // 같은 작업(workId)을 맡은 동료
  gear: Partial<Record<GearId, number>>;
}
export interface MethodDef {
  id: MethodId; work: WorkKind[];
  name: string;        // 패널·보고서의 이름 ('구명줄 투척')
  label: string;       // 대원 머리 위 (12자 안. renderScene 은 13자를 넘으면 12자 + … 로 자른다)
  noun: string;        // 보고서 문장에 끼우는 말 ('구명줄로', '헤엄쳐 들어가', '헬기로 끌어올려')
  gear: GearId[];      // 이 가운데 하나라도 있어야 한다 (빈 배열 = 맨몸으로 된다)
  pref: number;        // 교본상 선호 0..1 — 위험이 적은 방법이 높다
  risk: number;        // 대원 위험 0..1 (고를 때 감점)
  plain: boolean;      // 평소 방법: 시작을 따로 알리지 않고, 보고서에 따로 적지 않는다
  can: (c: MethodCtx) => boolean;        // 조건 (믿음·생김새·자기 몸만)
  situ?: (c: MethodCtx) => number;       // 상황 배율 (없으면 1)
  skill?: (c: MethodCtx) => number;      // 사람 배율 (없으면 1)
}
export const METHOD: Record<MethodId, MethodDef>;     // Record 라 MethodId 를 늘리면 컴파일이 항목을 강제한다

점수 = pref × situ × skill × (1 − risk × caution)
caution = clamp(1.1 − 0.3 × composure − 0.3 × experience, 0.5, 1.1)      // 침착하고 경험 많은 대원은 위험한 방법을 덜 꺼린다
```

- 후보: `work` 가 맞고, `gear` 가 비었거나 하나라도 있고, `can` 이 참이고, `t.tried` 에 없는 방법. 하나도 없는데 `t.tried` 가 비어 있지 않으면 `tried` 를 비우고 한 번 더 본다("다 써 봤으면 처음부터 다시"). 그래도 없으면 `null`(그 대원은 그 일을 맡지 않는다 — `methodFit` 0).
- 같은 점수면 표의 순서. **난수를 쓰지 않는다**(같은 상황 = 같은 선택. 다양성은 장비·능력·상황의 차이에서 나온다).
- **까닭(`why`)**: 위에서부터 처음 맞는 것.
  1. `switchMethod` 가 넘긴 것(`failed`·`broken`·`tooFar`).
  2. `noGear` — 장비를 따지지 않고 다시 셈한 1등이 지금 1등과 다르고, 그 1등이 장비가 없어 빠졌다.
  3. `weak` — `c.weak` 이고, 고른 것이 잡을 힘이 필요 없는 방법(swim·boat·hoist·pole·catch)이다.
  4. `danger` — 위험 조건으로 점수가 오른 방법(rapid·shore·defensive·ventFirst).
  5. `quiet` — 무장 현장에서 조용한 방법(halligan·hydraulic)이 시끄러운 방법을 이겼다.
  6. `fast` — `c.flow ≥ 0.07` 이 고른 방법의 점수를 올렸다(catch·boat).
  7. `tooFar` — 던질 수 있는 거리를 넘어서(reach > 3.6) 고른 방법.
  8. `near` — 가까워서(hand·pole).
  9. `team` — 동료와 짝을 이루는 방법(tend·roof).
  10. 그 밖은 `doctrine`.
- `methodFit(sim, s, a, w)` = 1등 점수가 있으면 그 점수, 없으면 0. 수난 구조의 `fitFor` 는 `best > 0 ? 0.22 + 0.5 × rescue + 0.28 × min(1, best) : 0` (지금 식 `0.22 + 0.5×rescue + 0.28×tool` 의 `tool` 자리를 바꾼 것 — 값의 범위가 비슷하다).

### 3.5 실행과 난수

**실행 도구**: `methodRun.ts` 는 `executor.ts` 를 import 하지 않는다(순환을 피한다). 대신 실행기가 도구를 건넨다 — 지휘 규칙의 `CommandKit` 과 같은 방식.

```ts
// methodRun.ts
export interface ExecKit {
  moveTo(sim: Sim, s: Scene, a: FieldAgent, tx: number, ty: number, range: number, needLos?: boolean): 'arrived' | 'moving' | 'nopath' | 'busy';
  finish(sim: Sim, s: Scene, a: FieldAgent, ok: boolean, reason?: string): void;
  drain(sim: Sim, a: FieldAgent, rate: number): void;
  spray(sim: Sim, s: Scene, a: FieldAgent, tx: number, ty: number, eff?: number, wmul?: number): boolean;
  makeTask(kind: TaskKind, label: string): Task;
}
// executor.ts (파일 끝, 함수 선언 아래 — 선언은 끌어올려지므로 어디 두어도 된다)
const XK: ExecKit = { moveTo, finish: finishTask, drain, spray, makeTask };
```

**공통 함수**(`methodRun.ts`):

```ts
startMethod(sim, s, I, a, t, why?): boolean       // chooseMethod → t.method·t.mwhy·t.mcands, t.mtry = 0, t.mbad = 0.
                                                   //   평소 방법이 아니거나 까닭이 doctrine·near 가 아니면 그 자리에서 emit (3.6). 고를 것이 없으면 false
switchMethod(sim, s, I, a, t, why, detail, next = true): boolean
                                                   //   t.tried 에 지금 방법을 넣는다 → (next 면) 다음 방법을 먼저 고른다(chooseMethod)
                                                   //   → 기록 한 줄: failed 는 raiseProblem(METHOD_FAIL, detail, …, false), broken 은 raiseProblem(EQUIP_FAIL, detail, …, false),
                                                   //     tooFar 는 emit(imp 1). 문구에 바꾸는 방법까지 담는다 ("유압 개방기가 멈췄습니다. 할리건으로 바꿉니다.") — 따로 시작 문구를 내지 않는다
                                                   //   → recordMethod(ok=false, 그 기록 id) → (failed·broken 이면) w.fails++
                                                   //   → t.method·t.mwhy = 새 방법·why, t.phase = 0, t.progress = 0, t.mtry = 0, t.mbad = 0
                                                   //   고를 것이 없으면 finish(false, 'nomethod'). next = false 면 다음 방법을 고르지 않는다(헤엄 사고처럼 호출한 쪽이 따로 정할 때)
recordMethod(sim, I, a, t, ok, eventId): void      // I.methods 에 한 줄. ok 이면, 같은 작업·같은 대상의 앞선 ok=false 줄 가운데 eventId 가 가리키는
                                                   //   Problem 이 아직 복구되지 않았으면 그것을 직접 복구 처리한다(recovered = true, recoveryText).
                                                   //   markRecovered 의 "가장 최근 것" 규칙을 쓰지 않는다 — 펌프 고장 같은 다른 EQUIP_FAIL 을 잘못 닫지 않게
useGear(sim, a, g, n = 1): void
senseOf(s, a): Sense                               // { smoke: s.smoke[선 칸], heat: s.fire[선 칸] }
landCasualty(sim, s, I, a, c, how, x, y): void     // 물에서 뭍으로 (4.1). 지금 waterRescue 의 완료 처리를 그대로 옮긴 것
```

`switchMethod` 가 `w.fails` 를 올리는 것은 지금 뜻("실패하면 지휘관이 알 수 있도록 작업 항목에 기록" — `finishTask` 주석)과 같다. `holdUntil` 은 건드리지 않는다(같은 대원이 곧바로 다른 방법으로 이어 간다).

**난수 흐름**:
- 방법의 판정(투척 명중, 잡기, 헤엄 중 사고, 장비 고장, 테이저·비살상탄·저격 명중, 터널 붕락, 보트 전복)은 **대원마다 새 흐름 하나**로만 한다.

```ts
export function mrng(sim: Sim, s: Scene, a: FieldAgent): Rng { return a.mrng ??= sim.rng.fork('method:' + s.incidentId + ':' + a.rid); }
```

- 장비가 실려 있는가: `sim.rng.fork('gear:' + u.id)`(부대마다, 교대마다 같은 값).
- **쓰지 않는 흐름**: `a.rng`(판단 오차 `brain`, 장애물 제거 시간 추정 `agentCost`, 해체 실수), `s.rng`(사격 `shootAt`·`tickHostiles`, 현장 생성, 가스 폭발), `rosterRng`·`equipRng`(`resources.createRoster` — 대원 능력치·펌프 상태가 바뀐다). 여기에 호출을 끼워 넣으면 무관한 결과까지 바뀐다(CLAUDE.md 재현성).
- 주의: 실행기의 `moveTo` 는 경로를 다시 짤 때마다 `agentCost` 를 만들고, `agentCost` 는 만들 때 `a.rng.next()` 를 한 번 부른다. 비용 함수를 바꾸는 `costFor`(아래)는 **늘 `agentCost` 를 먼저 한 번 만든다**(보트일 때 쓰지 않더라도) — `a.rng` 의 호출 수가 지금과 같다.

**물 위의 대원 — 바탕**(1b 단계. 헤엄·보트가 이것 위에서 돈다):

- "헤엄 중" = 대원이 선 칸이 `T.WATER` 이고 `a.afloat` 가 없다. 따로 칸을 두지 않는다.
- `executor.moveTo` 의 비용 함수 → `costFor`:

```ts
const base = agentCost(sim, s, a);                                   // 지금처럼 한 번 만든다 (a.rng 호출 수 유지)
const cost = a.afloat === 'boat' ? boatCost(s)                       // 물 칸 0, 그 밖 -1 (목표가 뭍이면 astar 의 range 로 물가 칸에서 멈춘다)
  : (onWater(s, a) || t.method === 'swim' || t.kind === 'ashore') ? swimCost(s, base)    // 물 칸 2.2, 그 밖은 base
  : base;
```

  `swimCost`·`boatCost`·`onWater` 는 `methods.ts` 에 둔다(생김새만 본다).
- `executor.moveSpeed` 맨 앞: 선 칸이 물이면 `a.afloat === 'boat' ? (보트 3.0 / 고무보트 2.2) × (1 − 0.25 × flowK) : (0.7 + 1.1 × swimOf) × (업고 있으면 0.55) × (1 − 0.5 × flowK) × staminaF` 를 돌려준다. `flowK = min(1, (s.flow ?? 0) / 0.1)`. 물 칸에서 연기·나무 보정은 없다.
- 헤엄 중에는 물살에 떠밀린다: 실행부가 매 틱 `a.x += s.flow × 0.7 × dt`(업고 있는 사람도 함께). `a.x ≥ s.w − 2` 면 '떠밀림' 사고(4.1).
- **물 위의 대원은 다른 일로 끌려 나가지 않는다**: `brain.think` 에서 지휘관 계획 다음, 철수 지시(`boardOrder`) 블록보다 **앞에**:

```ts
if (onWater(s, a) || a.afloat) {
  if (!cur || (cur.kind !== 'waterRescue' && cur.kind !== 'ashore')) setTask(sim, s, a, 'ashore', '뭍으로');
  return;      // 후퇴·휴식·다른 지시 후보를 내지 않는다 (물 칸에서 retreat·board 의 경로가 없어 영영 갇히는 것을 막는다)
}
```

- 새 `case 'ashore'`(executor): `const b = reachOf(s, a.x, a.y)` 의 뭍 칸으로 `moveTo(b.x, b.y, 0.3)`. 뭍 칸에 서면 `a.afloat = undefined` 하고 끝(`finish(true)`). 라벨 '뭍으로'.
- **물 위에서 쓰러지지 않는다**: 헤엄 중 사고의 체력 피해는 18 아래로 내리지 않는다(`r.health = Math.max(18, …)`). 쓰러짐 판정은 뭍에 오른 뒤 `sceneManager.agentHealth` 가 지금대로 한다. 물 칸에 쓰러진 대원은 `rescueMate` 의 경로가 없어 사건이 끝나지 않기 때문이다(H1 이 대원 익수를 허용하면 다시 정한다 — 10절).
- **끌고 오는 동안의 구조 대상은 `inWater` 를 유지한다**: 붙잡으면 `c.where = 'carried'`, `a.carrying = c.id` 로만 바꾼다(`tickWater` 는 `where === 'scene'` 만 떠내려 보내므로 멈춘다). `inWater = false` 는 뭍에 내려놓을 때 `landCasualty` 에서만. 이렇게 해야 중간에 놓쳤을 때 "물 위에 떠 있는데 물 밖인 사람"이 생기지 않는다(그런 사람은 아무 규칙도 건지지 못하고, `tests/sim.test.ts` 수난 사고 테스트의 "끌어낸 사람은 물 칸이 아닌 곳" 조건도 깨진다).
- `executor.finishTask` 의 내려놓기: 업고 있던 사람이 `inWater` 이면 — 대원이 선 칸이 물이면 지금처럼 `where = 'scene'`(다시 떠내려간다), 뭍이면 `landCasualty(…, t.method ?? 'hand', …)`.
- 해일(`rules/disaster.ts` `swamp`)은 잠긴 줄의 대원을 뭍으로 옮긴다. 보트 대원이 뭍 칸에 놓이면 `rules/methods.ts` 가 `a.afloat` 를 푼다(아래).
- `rules/methods.ts`(매 틱, 첫 줄에서 해당 없는 현장은 돌아간다):
  - 물이 있는 현장(`s.kind === 'water'` 또는 `s.rules` 에 `'water'`)에서 1초마다 `s.flow = max(s.flow ?? 0.02, 물속 사람의 drift 최댓값)`. 해일이 사람을 휩쓸어 drift 0.1 을 주면 그때 오른다. 내려가지는 않는다(사람이 걸려 멈춰도 강물은 흐른다).
  - `a.afloat === 'boat'` 인데 선 칸이 물이 아니면 `a.afloat = undefined`.
  - 송풍기(4.5·4.8): `s.fan` 이 있고 `sim.t < s.fan.until` 이면 실내 칸의 `s.smoke[i] *= 1 − 0.2 × dt`, `s.fire[i] ≥ 0.5` 인 칸은 `s.fire[i] = min(1, s.fire[i] + 0.006 × dt)`(공기가 들어가 불이 커진다 — 흐름 경로의 위험). 끝나면 `s.fan = null`.

### 3.6 기록 문구

규칙 5(가짜 연출 금지)대로, 기록은 **상태를 바꾸는 바로 그 코드**에서만 `emit` 한다.

| 언제 | 어디서 | 무엇을 | 예 |
|---|---|---|---|
| 방법을 정했다(`t.method` 를 넣은 순간) | `startMethod` | 평소 방법이 아니거나 까닭이 `doctrine`·`near` 가 아닐 때만. `role 'RESPONDER'`, `kind 'action'`, `imp 1` | "구명줄이 없습니다. 헤엄쳐 들어가겠습니다." |
| 한 번의 시도가 빗나갔다(방법은 그대로) | 실행부의 판정 자리 | `kind 'action'`, `imp 0` | "줄이 빗나갔습니다. 다시 감아 던집니다." |
| 방법을 접었다 | `switchMethod` | 실패·고장은 `raiseProblem`(문제 기록이 곧 기록 문구), 조건 상실은 `emit` `imp 1` | "물살에 밀려 대상을 놓쳤습니다. 뭍으로 돌아갑니다." |
| 방법으로 끝냈다 | 실행부의 완료 자리 | **지금의 완료 문구를 방법별 문구로 바꾼다**(줄이 늘지 않는다) | "구조 대상 A, 구명줄로 끌어냈습니다. 처치와 이송이 필요합니다." |

- 문구는 `METHOD` 표 옆의 `SAY` 표(`methods.ts`)에서 `(방법, 까닭)` 으로 찾는다. 이름 뒤 조사는 `josa()`.
- 시작을 알리지 않는 평소 방법: rope·pole·hand·axe·halligan·handClear·toolClear·basic·spread·call·interior·chase·breach·bang·tackle·cover·stay·valve·line. 문·잔해처럼 자주 일어나는 일은 완료 문구만 방법별로 바뀌어 기록량이 지금과 거의 같다.
- 다만 같은 작업·같은 대상에 아직 복구되지 않은 방법 실패(`I.methods` 의 ok=false 줄)가 있으면, 다른 대원이 고른 평소 방법이라도 시작을 알린다(관찰자가 "다른 사람이 다른 방법으로 다시"를 보게 — 5절 예 4).
- 방법을 바꿀 때는 `switchMethod` 의 문제 기록 한 줄이 바꾸는 방법까지 말한다(시작 문구를 따로 내지 않는다).
- 로그 문구가 바뀌므로 교대 해시(`sim.logHash`)는 바뀐다. 기존 테스트는 같은 시드 두 번의 해시가 같은지만 본다(문제없다).

### 3.7 그림

`view/scene/sprites.ts` 의 `ArmPose` 에 `'throw' | 'reach' | 'hold' | 'shield'`, `Item` 에 `'rope' | 'ring' | 'pole' | 'halligan' | 'ram' | 'cutter' | 'extinguisher' | 'taser' | 'launcher' | 'tic'` 를 더한다. `renderScene.agentPose` 는 `a.task.method` 를 먼저 보고, 없으면 지금처럼 `task.kind` 로 정한다.

| 방법 | 자세 · 손에 든 것 | 현장 그림 (`methodsLayer.ts`) |
|---|---|---|
| hand · catch(붙잡을 때) | `reach` · 없음(무릎 꿇고 팔을 뻗음) | — |
| pole | `reach` · `pole` | 대원에서 대상 쪽으로 최대 2칸의 장대, 끝에 갈고리 |
| rope | 던지기 전 `throw` · `rope`(감긴 줄) | 지금의 줄 그림. 끝은 **빨간 투척 가방**(지금의 구명환 대신) |
| ring | `throw` · `ring` | 줄 끝에 빨강·흰 구명환(지금 그림) |
| improvise | `throw` · 없음 | 회갈색 점선 줄(옷·끈을 이은 것) 끝에 흰 통 |
| swim | `drawSwimmer` 에 대원 모습(소방은 헬멧·공기호흡기를 벗은 모습, 구명조끼면 주황 조끼) | 업고 오는 사람은 바로 뒤에 `drawSwimmer` |
| tend | `hold` · `rope` | 줄 확보 대원 → 헤엄치는 동료로 줄 |
| boat | 앉은 자세(`side`) | 대원 밑에 위에서 본 주황 고무보트(1.4×0.7칸), 실은 사람은 보트 안에 `drawLying` |
| hoist | 대원은 대기 지점에서 `side` | 인양 단계 동안 대상 위에 `drawHeli`(있는 함수)와 늘어진 줄, 줄 끝의 구조대원 |
| kick · handClear · manual · tunnel | `work` · 없음 | — |
| halligan · ram · cutter(toolClear·roof) | `work` · 그 물건 | — |
| hydraulic · spread | `work` · `spreader`(있는 그림) | — |
| airbag · shore | `work` · 없음 | 대상 곁의 납작한 검은 패드 / 세운 버팀목 |
| defensive · aerial | `hose` | aerial: 대기 지점에서 목표 창까지 굵은 회색 사다리 선(가로대) |
| extinguisher | `hose` 대신 `aim` · `extinguisher` | 흰 분말 줄기(`Fx 'spray'` 를 흰색으로) |
| ventilate · ventFirst | `work` · 없음 | 출입구의 송풍기(돌아가는 날개) — `s.fan` |
| taser · beanbag | `aim` · `taser`(노랑) / `launcher`(주황) | — |
| shield | `shield`(앞에 직사각형 방패) · 권총 | — |
| sniper | `aim` · `rifle` | 조준선(점선, 관찰자 시점만) |
| thermal · listen | `side` · `tic` / `kneel` · 없음 | listen: 정지 중 머리 둘레의 동심원 |
| announce | `megaphone`(있는 자세) | — |

머리 위 라벨(`a.label`)은 `METHOD.label`(12자 안). 패널(`ui/panels.tsx` 대원 정보)에 세 줄을 더한다: **장비**(`gearOf` — 가진 것, 다 쓴 것은 흐리게), **방법**("헤엄쳐 접근 — 구명줄 없음"), **방법 후보**(`t.mcands` 의 점수 막대 — 지금의 "행동 후보와 점수"와 같은 모양). 지도와 목록의 그림 기호 규칙과는 무관하다(대원 정보 패널의 글자 설명이다).

화면을 고친 단계는 헤드리스 브라우저로 현장을 찍어 보고 콘솔 오류 0건을 확인한다(CLAUDE.md). 화면만 고친 커밋은 sweep 분포가 한 건도 달라지면 안 된다.

### 3.8 보고서 문장

`debrief.evaluate` 는 기록된 문제와 타임라인에서만 문장을 만든다. 방법은 두 길로 들어간다.

1. **실패와 바꾸기** → 문제 `METHOD_FAIL`(새 코드). `PROBLEM_LABEL.METHOD_FAIL = '대응 방법 실패·변경'`, `order` 의 `EQUIP_FAIL` 바로 다음, 문장:
   `METHOD_FAIL: (ps) => \`대응 방법이 ${ps.length}차례 막혔습니다 (${ps[0].detail})${ps[0].recovered ? \` — ${ps[0].recoveryText}\` : ''}.\``
   복구 문구(`recordMethod` 가 앞선 실패의 Problem 을 직접 복구 처리할 때): "`${이름}이/가 ${noun} 다시 시도해 성공`". 장비 고장(`EQUIP_FAIL`)도 같은 길로 복구되어 지금의 `EQUIP_FAIL` 문장("… — 복구하지 못했습니다" / "… — 복구 문구")에 그대로 실린다.
2. **평소와 다른 방법으로 끝낸 것** → `I.methods` 의 `ok: true` 이고 `plain: false` 인 줄(같은 대상에 앞선 실패가 없는 것). 사망·미발견 문장 다음, 맺음말 앞에 **최대 2문장**, `A.length < 12` 일 때만:
   - 수난 구조: "구조 대상 A는 권도현 대원이 헤엄쳐 들어가 구했습니다 (구명줄이 없었음)."
   - 그 밖: `${이름} 대원이 ${noun} ${WORK_DONE[work]}` — `WORK_DONE = { force: '문을 열었습니다', clear: '잔해를 치웠습니다', extricate: '구출했습니다', suppress: '불길을 잡았습니다', engage: '제압했습니다', mitigate: '가스를 막았습니다', search: '찾아냈습니다', treat: '처치했습니다' }`.
   - 까닭 말: `WHY_TEXT = { noGear: '…이 없었음'(그 방법의 장비 이름), weak: '줄을 잡을 힘이 없었음', fast: '물살이 빨랐음', tooFar: '던져서 닿지 않는 거리였음', danger: '추가 위험이 있었음', quiet: '용의자에게 들키지 않으려', team: '동료와 짝을 이뤄' }`, `doctrine`·`near` 는 붙이지 않는다.
3. `buildReport`: `methods`(성공한 방법별 횟수)를 채우고, 요약에 한 줄 — "대응 방법: 구명줄 5 · 장대 3 · 헤엄 2 · 헬기 인양 1 · 할리건 4 …"(성공이 없으면 줄을 넣지 않는다).

---

## 4. 유형별 방법 표

수치는 **시작값**이다. 6절의 방법으로 재어 조정하되, "평소 방법"의 식은 지금 식 그대로 둔다. 거리는 칸(현장 격자 1칸)이다.

### 4.1 수난 구조 `waterRescue` (1단계 — 가장 자세히)

교본의 순서 "뻗기(Reach) → 던지기(Throw) → 배로(Row) → 들어가기(Go)" 를 `pref` 로 옮겼다. 위험이 적은 방법일수록 높다.

| 방법 | 고를 조건 (믿음·생김새·자기 몸) | 장비 | 닿는 거리 | 걸리는 시간 | 성공 판정 (실행부, `mrng`) | 대원 위험 | pref / risk |
|---|---|---|---|---|---|---|---|
| `hand` 손 뻗어 붙잡기 | reach ≤ 1.2 | 없음 | 1.2 | `2.5 / (0.5 + 0.5×rescue)` | 잡기 `max(grabP, 0.6)` | 없음 | 1.0 / 0 |
| `pole` 장대·사다리 뻗기 | reach ≤ 2.0 | pole 또는 ladder | 2.0 | `1.5 + 4 / (0.5 + 0.6×rescue)` | 갈고리라 의식이 없어도 `max(grabP, 0.8)` | 없음 | 0.92 / 0 |
| `ring` 구명환 투척 | reach ≤ 2.8 | ring | 2.8 | rope 의 0.8배 | 명중 ×1.08, 잡기 ×1.15 (최대 1) | 없음 | 0.84 / 0 |
| `rope` 구명줄 투척 (**지금의 방법**) | reach ≤ 3.6 | rope | 3.6 | `9 / (0.4 + 0.8×rescue + 0.5×tool)` (지금 식) | 명중 × 잡기 | 없음 | 0.85 / 0 |
| `improvise` 즉석 부력물 | reach ≤ 2.4 (언제나 고를 수 있는 맨몸 방법) | 없음 | 2.4 | 찾기 2초 + rope 의 1.3배 | 명중 ×0.7, 잡기 ×0.7 | 없음 | 0.5 / 0 |
| `catch` 하류에서 기다렸다 붙잡기 | 믿음 drift > 0, `catchPoint` 가 있다(같은 줄 하류(+x) 8칸 안의 첫 뭍 칸 — 다리·굽은 물가), 대상이 거기 닿는 예상 `(점 − 1 − x) / drift` ≤ 40초(40~90초면 점수 ×0.5, 그 넘으면 못 고른다) | 없음(장대가 있으면 잡기가 pole 과 같다) | 대기 칸에서 1.3 | 이동 + 대기 + 2.0 | hand 와 같음 | 없음 | 0.8 / 0 |
| `swim` 헤엄쳐 접근 | `swimOf ≥ 0.35`(구명조끼 pfd 가 있으면 0.25), reach > 1.2 | 없음 (pfd·drysuit 가 있으면 덜 위험) | 직접 | 준비(소방 6초 '방화복·공기호흡기 벗기', 그 밖 2초, pfd 를 입으면 +3초) + 헤엄 + 붙잡기 1.5초 + 끌고 오기 | 늘 잡는다(의식이 없어도) | 아래 '헤엄 중 사고' | 0.45 / 0.3 |
| `tend` 구조자 줄 확보 | 같은 작업에 헤엄치는 동료가 있고 자신에게 rope 가 있다 | rope | — | 헤엄 동료가 끝날 때까지 | — (동료의 사고율 ×0.5) | 없음 | 0.9 / 0 |
| `boat` 보트 접근 | 부대에 boat 또는 raft, 같은 부대에서 보트를 쓰는 동료가 없다 | boat / raft | 직접 | 진수 8초(raft 14초) + 이동(3.0 / 2.2칸/초) + 끌어올리기 2.5초 | 늘 | 전복 `0.0015 × (1 + 2×flowK)`/초 | 0.78 / 0.08 |
| `hoist` 헬기 인양 | 부대에 hoist(헬기), 같은 부대에서 인양 중이 아니다, 태풍 특보의 충격 단계(`sim.disaster.kind === 'typhoon' && phase === 'impact'`)가 아니다 | hoist | 거리 무관 | 탑승·이륙 10초(안개 ×1.3, 밤 ×1.2) + 인양 `6 + (대기 지점→대상 거리)/4`초 | 늘. 인양을 시작할 때 고장 판정(`toolFail`) | 없음 | 0.80 / 0 |

**상황 배율(`situ`)**:
- 위중(`c.weak` — 줄을 잡을 힘이 없을 수 있다): rope·ring·improvise ×0.35, hand ×0.7, pole·catch ×0.8, swim·boat·hoist ×1.15.
- 빠른 물살(`c.flow ≥ 0.07`): rope·ring ×0.85, catch ×1.3, boat ×1.1, swim ×0.6.
- 던져서 닿지 않는 거리(reach > 3.6): hoist·boat ×1.2, swim ×1.3.
- 밤·비·안개(`sim.weather !== 'clear'`): rope·ring·improvise ×0.9, hoist ×0.9.
- 같은 대상에게 헤엄치는 동료가 있다(`mates` 가운데 `task.method === 'swim'`): 던지는 방법(rope·ring·improvise)은 고르지 않는다(동료에게 걸린다). rope 가 있으면 `tend`, 없으면 물가에서 기다리는 `hand`·`pole` 만 남는다.

**사람 배율(`skill`)**: rope·ring·improvise `0.8 + 0.4×rescue`, hand·pole `0.9 + 0.2×rescue`, swim `0.5 + swimOf`.

**실행부의 판정(진실로)**:

```
grabP(health) = health > 55 ? 1 : health > 40 ? 0.75 : health > 25 ? 0.4 : 0.15        // 대상이 줄을 잡을 수 있는가
hit(d)        = clamp(0.62 + 0.3×rescue + 0.1×composure − 0.12×max(0, d − 2)
                      − (weather ≠ 'clear' ? 0.08 : 0) − (s.flow ≥ 0.07 ? 0.12 : 0), 0.25, 0.97)   // d = 그 순간 대원–대상 거리
한 번의 시도 = mrng.next() < hit × 잡기     (hand·pole·catch 는 hit = 1)
```

**실행 순서**(`methodRun.runWaterRescue`):

```
c = s.casualties[t.cas]
c.dead || !c.inWater → 지금처럼 learn(casFact, true, true) 로 강제 보고하고 끝 (낡은 믿음 대비)
c.where === 'carried' && a.carrying !== c.id → 동료가 끌고 오는 중: rope 가 있으면 tend 로 바꾸고, 없으면 끄는 동료 가까운 물가로 moveTo(2.5) 하며 '구조 지원 대기'. return
t.method 가 없으면 startMethod. 고를 것이 없으면 finish(false, 'nomethod')
1초마다(sim.tick % 5 === 0) 고른 방법의 can 을 다시 본다: 거짓이면 t.mbad += 1, 참이면 0. t.mbad ≥ 3 → switchMethod(…, 'tooFar', '…') (문제 기록 없이 무전 한 줄)
  단, swim·boat·hoist 는 phase 1 부터(물에 들어간 뒤·진수한 뒤·이륙한 뒤), tend 는 자리를 잡은 뒤 다시 보지 않는다 — 몸이 이미 물 위에 있다
  (대상이 물가로 떠밀려 reach ≤ 1.2 가 되어도 헤엄치던 대원이 '손 뻗기'로 바뀌지 않게)
분기마다 moveTo 는 한 번만 부르고 return (CLAUDE.md 함정: 한 틱에 목표 둘)

물가 방법 (hand · pole · ring · rope · improvise):
  mv = moveTo(c.x, c.y, 닿는 거리, needLos = true)            // 떠내려가면 따라 옮긴다 (지금과 같다)
  nopath → switchMethod('tooFar') (다른 방법이 없으면 finish(false, 'nopath'))
  도착 전: 라벨 '물가로 이동', 진행도 초당 0.5 감소 (지금과 같다). return
  t.phase === 1 (줄 다시 감기): 4초 뒤 phase 0, 다음 투척의 필요 시간 ×0.6. 라벨 '줄 다시 감는 중'. return
  진행도 += dt × staminaF, drain 0.5, a.ring = 진행도 / 필요
  다 되면 한 번 판정:
    성공 → landCasualty(대원이 선 칸) · emit(방법별 완료 문구) · recordMethod(ok) · finish(true)
    실패 → t.mtry++, emit(imp 0 '줄이 빗나갔습니다…' / '대상이 줄을 잡지 못했습니다…')
           t.mtry ≥ 2 (hand·pole 은 3) → switchMethod('failed', '구명줄 투척이 두 차례 빗나감')
           아니면 phase 1 (던지는 방법) / 진행도 0 (뻗는 방법)

catch:  시작할 때 catchPoint(믿음 위치)를 t.tx, t.ty 에 둔다 → moveTo(t.tx, t.ty, 0.5), 라벨 '하류에서 대기'
        도착 뒤 dist(a, c) ≤ 1.3 → hand 와 같은 붙잡기(필요 2.0, 장대가 있으면 pole 의 잡기)
        믿음 속 drift 가 0 이 됐는데(다른 데 걸렸다) 믿음 위치가 대기 칸에서 2칸 밖인 채 6초가 지났다 → switchMethod('tooFar', …)

swim:   phase 0 준비(위 시간, 제자리. 라벨 '방화복 벗는 중' / '구명조끼 착용')
        phase 1 moveTo(c.x, c.y, 0.9), 라벨 '헤엄쳐 접근'           // costFor 가 물 칸을 지나게 한다
        phase 2 붙잡기 1.5초 → c.where = 'carried', a.carrying = c.id, a.path = null. emit '구조 대상 A를 붙잡았습니다. 물가로 끌고 갑니다.'
        phase 3 b = reachOf(s, a.x, a.y) → moveTo(b.x, b.y, 0.3), 라벨 '끌고 나오는 중', 대상은 대원 뒤 0.45칸 (carry 와 같은 식)
                뭍 칸에 서면 landCasualty(b) · a.carrying = -1 · emit · recordMethod(ok) · finish(true)
        물 칸에 있는 동안 매 틱: drain(1.6, 끌 때 2.4), 떠밀림(3.5), 사고 판정 mrng.chance(p × dt)
          p = 0.010 × (1.5 − swimOf) × (1 + 1.5×flowK) × (밤 1.3) × (pfd 0.45) × (drysuit 0.7) × (줄 확보 0.5) × (체력 잔량 < 30 이면 2) × (끌고 오는 중 1.5)
          체력 잔량 ≤ 8 이면 '지침' 사고, a.x ≥ s.w − 2 면 '떠밀림' 사고
        사고: r.health = max(18, r.health − mrng.range(8, 18) × (줄 확보면 0.5)), r.stamina −= 25
              끌던 사람을 놓는다(where = 'scene', 그 자리, inWater 그대로)
              → switchMethod('failed', '헤엄 구조 중 물살에 밀려 대상을 놓침', next = false) — 문구 "물살에 밀려 대상을 놓쳤습니다. 뭍으로 돌아갑니다."
              → 임무를 'ashore' 로 바꾼다 (finish(false, 'preempt') 뒤 a.task = makeTask('ashore', '뭍으로')). 같은 작업은 다른 대원(또는 뭍에 오른 뒤의 자신)이 다시 맡는다.
                줄 확보 동료가 있으면 그 동료가 선 물가 칸이 뭍으로 가는 목표
tend:   시작할 때 헤엄 동료가 들어간 물가 칸(reachOf(동료))을 t.tx, t.ty 에 → moveTo(1.0), 라벨 '구조자 줄 확보', 동료를 바라본다
        헤엄 동료가 없어지면(끝났거나 뭍으로) 같은 대상이 아직 물속이면 switchMethod('tooFar'), 아니면 끝
boat:   phase 0 L = reachOf(s, 믿음 위치) (걸어서 갈 수 있는 진수 지점) → moveTo(L, 0.5) → 진수 8초(raft 14초) → a.afloat = 'boat', emit '보트를 띄웠습니다.'
        phase 1 moveTo(c.x, c.y, 0.9) (보트 비용 — 물 칸만), 라벨 '보트 접근'
        phase 2 끌어올리기 2.5초 → c.where = 'carried', a.carrying = c.id
        phase 3 moveTo(L, 1.0) → 물가 칸에 닿으면 대원을 L 로 옮기고 a.afloat = undefined, landCasualty(L), finish(true)
        보트 위에 있는 동안 전복 판정: 전복 → a.afloat = undefined (그 자리 물 칸 — 헤엄 중이 된다), 끌던 사람을 놓고 switchMethod('failed', '보트 전복', next = false) → 'ashore'
hoist:  phase 0 moveTo(s.staging, 1.5) → 탑승·이륙(위 시간), 라벨 '헬기 탑승', emit '헬기 이륙 — 인양 준비.' / 인양 시작에 고장 판정(→ switchMethod('broken', '인양기 고장'))
        phase 1 라벨 '헬기 인양', 진행도 += dt (체력과 무관), 대상이 이미 물 밖이면 끝
                다 되면: landCasualty 와 같은 처리를 하되 자리는 placeAtSafe(s, c), c.where = 'safe', c.tSafe = sim.t
                emit '헬기 인양 완료 — 구조 대상 A를 안전 구역에 내렸습니다.'
        (대원은 대기 지점에 남는다. 헬기는 그림만 대상 위에 있다 — 대원이 하늘을 나는 이동을 만들지 않는다)
```

`landCasualty(sim, s, I, a, c, how, x, y)`: `c.inWater = false; c.drift = 0; c.mob = 'immobile'; c.trapWork = 0; c.tFreed = sim.t; c.where = 'scene'; c.x = c.px = x; c.y = c.py = y; c.bleed *= 0.35; c.bleed0 = c.bleed; c.freedHow = how; c.freedBy = a.rid; learnQuiet(sim, a, casFact(…))` — 지금 `waterRescue` 의 완료 처리와 같다.

**지휘 규칙**(`orders/methods.ts`, 믿음과 작업판만): 열려 있는 `waterRescue` 작업의 `w.fails ≥ 2` 이고 그 구조 대상의 믿음이 아직 물속(`water`)이면 `k.request('search', '수난 구조가 거듭 실패 — 구조정·헬기 필요', true)`(관제는 수색 수요에 헬기를 고른다 — `dispatcher.pickUnit`). `request` 는 같은 수요를 70초 안에 되풀이하지 않는다.

**지휘관 쪽 낡은 믿음 대비**: 방법이 늘어도 임무는 그대로 `waterRescue` 이므로, 지금의 장치(대상이 이미 물 밖이면 실행부가 `learn(…, true, true)` 로 강제 보고, 지휘관은 믿음상 물 밖이면 `want` 하지 않는다)가 그대로 동작한다. `tend` 처럼 "남이 하는 동안 거드는" 방법도 대상이 물 밖이 되면 첫 줄에서 끝난다.

### 4.2 문·통로 `force`·`clear` (+ 이동 중 하위 작업) — 2단계

`workOnBlocker(sim, s, a, tile, kind, tk)` 에 인자 `tk`(하위 작업이면 `t.sub`, 본 임무면 `t`)를 더하고, 처음 부를 때 `startMethod`(work = `kind`). 속도는 `blockerRate(sim, s, a, tk)`(methodRun). `fitFor` 는 바꾸지 않는다(누가 맡는가는 그대로, 속도만 방법에 따라).

| 방법 | 임무 | 장비 | 속도 (×staminaF, `p.hp` 를 깎는다) | pref | 특징 |
|---|---|---|---|---|---|
| `kick` 발로 차기·어깨 | force | 없음 | `0.6 + 0.6×rescue + 0.3×law` | 0.5 | 맨몸 방법 |
| `axe` 도끼 | force | axe | `0.6 + 0.6×rescue + 0.6×tool + 0.3×law` (**지금 식**) | 0.75 | |
| `halligan` 할리건 | force | halligan | 지금 식 ×1.25 | 0.85 | 조용하다 |
| `ram` 충격기 | force | ram | `0.9 + 0.6×law + 0.6` | 0.8 (경찰 0.9) | 끝날 때 10칸 안의 무력화되지 않은 용의자가 문 쪽을 돌아보고 5초 경계(`breach` 의 "문이 열리는 소리"와 같은 코드) |
| `hydraulic` 유압 개방기 | force | spreader | `(0.6 + 0.6×rescue + 0.6) × 1.6` | 0.9 | 시작할 때 고장 판정 → `broken` → 다음 방법. 승강기 문(hp 17)에서 차이가 크다 |
| `handClear` 손으로 치우기 | clear | 없음 | `0.5 + 0.8×rescue` | 0.55 | 맨몸 방법 |
| `toolClear` 장비로 절단·지렛대 | clear | cutter 또는 halligan | `0.5 + 0.8×rescue + 0.5×max(tool, 0.6)` (지금 식에 가깝다) | 0.8 | |

- 상황: 무장 현장에서 믿음에 대치·교전 중(`hold`·`fight`) 용의자가 있으면 시끄러운 방법(kick·axe·ram) ×0.7 → 까닭 `quiet`. 진입조의 동시 진입(`breach`)과 방 진입은 지금 코드 그대로 문을 연다(바꾸지 않는다).
- `agentCost` 의 제거 시간 추정(`forceCost`·`clearCost`)은 **바꾸지 않는다**(경로 선택이 크게 흔들린다). 알려진 한계로 둔다.
- `unblock(sim, s, a, tile, method)`: 완료 문구를 방법별로 — "할리건으로 문을 땄습니다. 진입합니다.", "유압 개방기로 철문을 열었습니다.", "문을 걷어차 열었습니다.", "절단기로 잔해를 잘라 통로를 확보했습니다." `markRecovered(PATH_BLOCKED, …)` 의 문구에도 방법 이름을 넣는다.

### 4.3 구출 `extricate` — 차량·붕괴 (3단계)

속도 = `rescue × k × staminaF × (연기 0.4 넘으면 0.7)` — `k` 만 방법에 따라 바뀐다(지금 식은 `k = 0.35 + 0.65 × tool`). `fitFor` 는 그대로.

차량(믿음 `veh`):

| 방법 | 장비 | k | 준비 | pref | 조건·위험 |
|---|---|---|---|---|---|
| `manual` 수동 구출(유리 깨고 끌어내기) | 없음 | 0.35 | — | 0.5 | 맨몸 방법 |
| `basic` 손 공구(지렛대) | halligan 또는 axe | `0.35 + 0.65×tool` (**지금 식**) | — | 0.7 | |
| `spread` 문 벌리기 | spreader | `max(1.0, 0.35 + 0.65×tool)` | 3초 | 0.85 | 시작할 때 고장 판정 |
| `roof` 지붕 절단 | cutter + 같은 작업의 동료가 2칸 안 | 1.5 | 8초 | 0.8 (믿음 band ≥ 1 이거나 같은 차의 고립자 믿음이 둘 이상이면 ×1.3) | 고장 판정. 까닭 `team` |
| `rapid` 급박 구출 | 없음 | `1.8 × (0.35 + 0.65×tool)` | — | 0.95 (조건일 때만) | 조건: 믿음 속 4칸 안에 살아 있는 누출 위험(`haz` leak active)이나 불난 구역(믿음 fire > 0.3), 또는 감각 연기 > 0.3. 끝날 때 대상 체력 −10 한 번(척추 보호 없이 끌어냄). 까닭 `danger` |

붕괴(`s.kind === 'collapse'`, 차량이 아님):

| 방법 | 장비 | k | 준비 | pref | 조건·위험 |
|---|---|---|---|---|---|
| `tunnel` 손으로 파기 | 없음 | 0.5 | — | 0.5 | 믿음 속 4칸 안에 살아 있는 균열(`haz` leak active)이 있으면 `mrng.chance(0.006 × dt)` 로 '잔해가 다시 흘러내림': 대상 체력 −8, 대원 체력 −6, `emit` |
| `basic` | halligan 또는 axe | 지금 식 | — | 0.7 | |
| `airbag` 에어백 들기 | airbag | 1.6 | 5초 | 0.85 | 고장 판정 |
| `shore` 지지대 먼저 | shoring | basic 과 같음 | 8초: 끝나면 대상 3칸 안의 균열 소품(`unstable`)의 `leakRate` ×0.5 (실행부가 한 번 바꾼다), `s.staticVersion++` | 0.9 (조건일 때만) | 조건: 믿음 속 4칸 안에 살아 있는 균열. 까닭 `danger`. 그림: 버팀목 |

### 4.4 탐지 — 실내·붕괴의 `search` (3단계)

| 방법 | 장비 | 효과 | pref | 조건 |
|---|---|---|---|---|
| `call` 호출·청취 (**지금의 방법**) | 없음 | 지금의 `sweepPoints`·`markCovered` | 0.6 | |
| `listen` 청음기 | listener | 경유점마다 정지 0.5초 → 3초. 정지하는 동안 체력 30 넘는 대상의 은폐도 ×0.35 | 0.85 | 붕괴 현장 |
| `thermal` 열화상 | tic | 연기에 의한 시야 감소 0.78 → 0.3, 살아 있는 사람만 더 잘 보인다 | 0.8 | 감각 연기 > 0.3, 또는 밤의 야외 구역 |

- `agents.detectRadius`: 지금 줄 `if (s.kind === 'collapse' && sim.units[a.unitId].kind === 'rescue') concealment *= 0.45;` 를 `concealment *= detectMul(sim, s, a)` 로 바꾼다. `detectMul` 은 `methods.ts` 에 둔다(대원의 임무·방법과 부대 종류만 본다 — `methodRun.ts` 에 두면 `agents` ↔ `methodRun` 이 서로 import 하게 된다). `detectMul` = 청음기 방법으로 정지 중이면 0.35, 아니면 지금 조건(붕괴 현장의 구조 공작차 대원)이면 0.45, 그 밖 1 — 방법이 없을 때는 지금과 같다.
- `agents.visionOf`: 연기 감소 계수 `0.78` 을 `a.task?.method === 'thermal' ? 0.3 : 0.78` 로.
- 수색 결과 보고는 지금처럼 즉시 보낸다(`flushOutbox` 의 `prompt` — CLAUDE.md 함정).

### 4.5 화재 `suppress` (4단계)

`case 'suppress'` 첫 줄 앞에서 `startMethod`. 방법이 `interior`(또는 없음)면 **지금 코드 그대로**, 그 밖이면 `runSuppress(…)` 로 간다. `spray` 에 인자 `eff`(효과 배율)·`wmul`(물 소모 배율)을 기본값 1 로 더한다.

| 방법 | 장비 | 서는 자리 · 거리 | 효과 · 물 | 노출 | pref | 고를 조건 |
|---|---|---|---|---|---|---|
| `interior` 내부 공격 (**지금의 방법**) | 호스(펌프·물) | 화점 3.2칸·시야 | ×1 · ×1 | 지금대로(연기·열) | 0.85 | 소방, 펌프·물 있음 |
| `defensive` 외부 방어 방수 | 호스 | 실내가 아닌 칸에서 5.5칸, 시야(창은 통과) | ×0.7 · ×1.4 | 없음 | 0.7 (조건이면 ×1.4) | 믿음 속 그 구역 불 ≥ 0.7 이고, 그 구역에 믿음상 구조 대상이 없고, 그 구역 수색 확인율 ≥ 0.72 이거나 붕괴 현장 — "사람이 없다고 확인된 큰 불은 밖에서 끈다". 또는 자기 체력 < 50. 까닭 `danger` |
| `aerial` 고가 사다리 방수 | aerial (사다리차) | 대기 지점 쪽 실외 칸에서 7.5칸 | ×1.3 · ×2 | 없음 | 0.8 (조건이면 ×1.3) | 그 구역에 창(`T.WINDOW`)이 있고 믿음 불 ≥ 0.5 |
| `extinguisher` 소화기 | extinguisher (하나 = 12초 분사) | 1.8칸 | `applyWater 0.10 × dt`, 물·펌프를 쓰지 않는다. 12초 쓰면 `useGear` | 지금대로 | 0.6 | 믿음 속 그 구역 불 ≤ 0.35 이고, (실외 구역이거나 화재·가스·붕괴 현장이 아님) — 차량 화재·작은 불의 초기 진압 |
| `ventilate` 배연(송풍기) | fan | 가장 가까운 출입구 3칸 안에서 6초 설치 | `s.fan` 120초(3.5 의 규칙) | — | 0.75 (조건일 때만 고를 수 있고, 그때 ×1.3) | 소방, 감각 연기 > 0.5, 같은 현장에 송풍기가 없음(동료의 `task.method` 도 아님), 믿음에 불난 구역이 있다(불의 위치를 알고 하는 배연만). 설치가 끝나면 같은 대원은 `interior` 로 바꾼다 |

- `agents.fitFor` `suppress`: 지금 0 을 돌려주는 대원(호스를 쓸 수 없다)이라도 `extinguisher` 를 고를 수 있으면 0.25.
- 화재 유형은 B1 이 균형을 맞추고 있다. 이 단계는 B1 이 합쳐진 뒤에 잰다(6절).

### 4.6 무장 `engage` (5단계)

지금의 분기를 방법 이름으로 부르고(동작은 그대로, 검거 기록 자리에서 `recordMethod` 만 더한다): `chase`(추격 후 검거), `breach`(동시 진입·방 진입), `bang`(섬광탄), `tackle`(덮치기), `cover`(엄폐 사격). 이 다섯은 **기록 전용**이다(`can` 은 늘 거짓 — 지금처럼 현장 상태(`s.breachAt`, 섬광탄 수, 인질 곁)가 분기를 정한다). `chooseMethod` 는 새 방법 넷 가운데 하나를 고르거나, 아무것도 고르지 않는다. 고르지 않으면 `t.method` 를 비운 채 지금의 분기 순서대로 돌고, 검거한 분기의 이름을 `recordMethod` 에 남긴다. 새 방법은 `case 'engage'` 의 맨 앞(테이저 — 지금의 추격 분기보다 앞)과 ② 섬광탄 분기 앞(나머지)에 끼운다. (`airlift` 도 기록 전용이다.)

| 방법 | 장비 | 대상 · 조건 | 실행 | pref |
|---|---|---|---|---|
| `taser` 테이저 | taser (탄창) | 흉기·비무장, 인질 곁이 아님(믿음 `hostage` 거짓), 4.5칸·시야 | 조준 1.2초 → 명중 `clamp(0.55 + 0.3×law + 0.15×composure − (움직이면 0.15), 0.2, 0.92)` → `h.stunUntil = sim.t + 5`, 사기 −0.2 — 그다음은 지금의 ③ "무력화된 용의자 제압" 분기가 잡는다. 쏘면 탄창 −1, 빗나가면 1.5초 뒤 다시(탄창이 있으면) | 0.85 (chase 0.7) |
| `beanbag` 비살상탄 | beanbag (발) | 흉기·총기, 인질 곁이 아님, 9칸·시야, 총기면 대치(`hold`) 중일 때만 | 조준 1.5초 → 명중 `clamp(0.5 + 0.3×law, 0.2, 0.85)` → 4초 무력화, 체력 −8, 사기 −0.3. 한 발에 −1 | 0.8 |
| `shield` 방패 진입 | shield | 총기 대상에게 다가갈 때(진입 지시 `s.entryOrdered` 뒤) | 이동 ×0.8. `hazards.tickHostiles` 의 총기 명중 확률 `p` 에, 표적 대원의 방법이 `shield` 면 ×0.35 (곱만 한다 — `s.rng` 호출 수는 그대로) | 0.75 |
| `sniper` 저격 | scope (특공) | 믿음: 총기 용의자가 인질을 붙잡은 채 교전 중이거나, 협상을 시작한 지(`s.negotStart`) 60초가 넘었는데 그 용의자가 아직 대치 중 | 대기 지점 쪽 엄폐 자리, 16칸·시야 → 조준 6초 → 명중 `clamp(0.55 + 0.4×law − (움직이면 0.2), 0.3, 0.95)` → 체력 −70. 빗나가면 `mrng.chance(0.2)` 로 인질이 다친다(지금 `shootAt` 의 인질 피격과 같은 처리) | 0.6 (조건일 때만) |

- 판정은 모두 `mrng`. 지금의 `shootAt`·`flashbang` 이 쓰는 `s.rng` 에 호출을 더하지 않는다.
- 저격·비살상탄의 용의자 피해는 H1 의 부상 모델이 생기면 그것을 따른다(10절).

### 4.7 응급 `treat` · 이송 수단 (6단계)

| 방법 | 누가 · 조건 | 실행 | pref |
|---|---|---|---|
| `stay` 현장 안정 후 이송 (**지금의 방법**) | | 지금대로 | 0.8 |
| `rush` 즉시 이송 | 구급 대원, 믿음 band 2, 현장에 환자를 실을 수 있는 부대(`canCarryPatients`)가 있다 | 처치 필요 시간 3.0(지금은 4.5 + 2~4), 품질 ×0.7. 끝나면 `c.rush = true`(casFact 가 믿음에 싣는다). `commander` 구조 대상 블록에서 믿음 `rush` 인 환자는 처치가 더 필요하다고 보지 않고(`needTreat` 와 안전 구역 쪽 처치 조건에 `!c.rush`), 탑승 작업 우선순위를 `(c.treated ? 0.7 : 0.5) + urg` 대신 0.97 로 둔다 | 0.9 (조건일 때만) |
| `airlift` 헬기 이송 | 지휘관이 고른다(지금도 탑승 차량은 지휘관이 고른다) | `commander` 구조 대상 블록의 탑승 대상 고르기(`ambulances`)에서 믿음 band 2 이면 현장의 헬기를 먼저 본다. 기록은 `load` 가 헬기에 태울 때 `recordMethod('airlift')` | — |

`load` 는 구급차·헬기 모두 `canCarryPatients` 로 본다(CLAUDE.md 함정 — `dept === 'ems'` 로 가리지 않는다). 즉시 이송을 지휘 규칙(`orders/`)에서 "처치 작업 거두기"로 만들지 않는 까닭: 지휘관이 계획마다 처치를 다시 `want` 하면 거둔 작업 대신 새 작업이 생겨 작업판이 계속 불어난다. 지휘관의 조건 자체에 `!c.rush` 를 넣는다.

### 4.8 가스 `mitigate`(밸브) · `perimeter` (6단계)

| 방법 | 장비 | 실행 | pref | 조건 |
|---|---|---|---|---|
| `valve` 밸브 차단 (**지금의 방법**) | | 지금대로 | 0.8 | |
| `ventFirst` 환기 후 차단 | fan, 없으면 맨몸(문·창을 열기 — 설치 12초, 효과 절반) | 밸브가 있는 방의 출입구 앞에서 설치 → `s.fan`(가스 현장에서는 `s.smoke` 가 가스다) → 20초 또는 감각 가스 < 0.4 까지 기다림 → 지금의 밸브 차단(필요 시간 ×0.8) | 0.75 | 소방, 그 방 문 앞의 감각 가스 > 0.6, 같은 현장에 송풍기가 없음. 까닭 `danger` |
| `announce` 대피 방송 (`perimeter` 의 방법) | 없음(메가폰) | 가스 현장의 출입구 통제 자리에서. `hazards.tickGas` 의 "통제되지 않은 출입구로 다가온 시민" 확률에 ×0.4 (현장에 이 방법을 쓰는 대원이 있을 때. 확률만 곱하고 `s.rng.chance` 호출은 그대로). 시작할 때 한 번 `emit` "주변에 대피 방송을 합니다." | 0.8 | 경찰, 가스 현장 |

환기는 짙은 가스 칸 수를 줄여 `tickGas` 의 폭발 판정을 바꾼다. 그 판정은 `dense < 10` 이면 `s.rng` 를 부르지 않으므로(단락 평가) 그 현장의 이후 `s.rng` 결과가 달라진다 — 같은 현장 안의 일이고, 새 동작이므로 괜찮다.

### 4.9 야외 수색 `search` (7단계 — 선택, R1 뒤)

| 방법 | 장비 · 부대 | 효과 | 조건 |
|---|---|---|---|
| `line` 줄 수색 (**지금의 방법**) | | 지금대로 | |
| `air` 헬기 공중 수색 | 헬기 대원 | 실외 구역만. 이동 5칸/초로 지형을 무시(나무 위로), 실외 탐지 반경 ×1.5, 나무 칸의 대상은 은폐 +0.25(수관에 가림), 밤 ×0.7(tic 이 있으면 ×1.2) | 실외 구역이 남아 있음 |
| `drone` 드론 열화상 | drone (R1) | 조종자는 대기 지점에 서 있고 '눈'이 경유점을 4칸/초로 돈다. 나무 은폐 ×0.6, 밤에 강함. 배터리 120초 → 교체 20초 | |
| `dog` 탐지견 | k9 (R1 의 탐지견 팀) | 은폐 ×0.3, 반경 ×1.3, 30초마다 5초 휴식 | |

`air`·`drone` 은 "몸과 다른 곳에서 보는 눈"이 필요하다: `FieldAgent` 에 `eye?: { x: number; y: number }` 를 더하고 `perceive`·`markCovered` 가 있으면 그 자리를 쓴다. 이 단계는 손이 많이 가므로 R1 의 부대·장비가 정해진 뒤에 한다.

---

## 5. 고르는 예와 그 기록

점수는 3.4 의 식으로 어림한 것이다.

**예 1 — 구조대원, 3칸 거리, 의식 있음** (구조1 홍서진: rescue 0.8, composure 0.6, experience 0.4. 대상 믿음 band 0, reach 2.6, drift 0.02, 맑음. 고무보트 있음)
후보: rope 0.95 · ring 0.94 · boat 0.73 · swim 0.44 (pole·hand 는 닿지 않음, improvise 는 2.4칸 밖) → **rope**, 까닭 `doctrine`(시작을 알리지 않는다).

```
10:07:17 [02] COMMANDER/권도현: 홍서진, 구조 대상 A 수난 구조 맡아라.
10:07:27 [02] RESPONDER/홍서진: 줄이 빗나갔습니다. 다시 감아 던집니다.                    ← imp 0 (자세히 보기 -v 에서만)
10:07:35 [02] RESPONDER/홍서진: 구조 대상 A, 구명줄로 끌어냈습니다. 처치와 이송이 필요합니다.
```

**예 2 — 줄이 없는 순찰 대원** (순찰1 이서준: rescue 0.22, fitness 0.8 → swimOf 약 0.63. 구명줄 없음, reach 3.0, band 1)
후보: swim 0.38 하나(rope·ring·pole 장비 없음, hand·improvise 닿지 않음) → **swim**, 까닭 `noGear`(장비를 따지지 않은 1등은 rope).

```
10:12:03 [05] RESPONDER/이서준: 구명줄이 없습니다. 헤엄쳐 들어가겠습니다.
10:12:14 [05] RESPONDER/이서준: 구조 대상 A를 붙잡았습니다. 물가로 끌고 갑니다.
10:12:23 [05] RESPONDER/이서준: 구조 대상 A, 헤엄쳐 끌어냈습니다. 처치와 이송이 필요합니다.
보고서: "구조 대상 A는 이서준 대원이 헤엄쳐 들어가 구했습니다 (구명줄이 없었음)."
```

**예 3 — 위중한 대상, 헬기가 와 있다** (헬기1 채아린. 대상 믿음 band 2(체력 35), reach 2.4)
후보: hoist 0.92 · swim 0.57 · rope 0.32 · improvise 0.19 → **hoist**, 까닭 `weak`.

```
10:15:40 [07] RESPONDER/채아린: 대상이 줄을 잡을 힘이 없습니다. 헬기로 끌어올리겠습니다.
10:15:41 [07] RESPONDER/채아린: 헬기 이륙 — 인양 준비.
10:15:58 [07] RESPONDER/채아린: 헬기 인양 완료 — 구조 대상 B를 안전 구역에 내렸습니다.
보고서: "구조 대상 B는 채아린 대원이 헬기로 끌어올려 구했습니다 (줄을 잡을 힘이 없었음)."
```

**예 4 — 헤엄 실패 뒤 다른 대원이 장대로** (물살 0.08 인 선박 화재 현장. 진압4 서예린은 구명줄 없음, 진압3 안지후는 장대 있음)

```
10:21:10 [09] RESPONDER/서예린: 구명줄이 없습니다. 헤엄쳐 들어가겠습니다.
10:21:19 [09] RESPONDER/서예린: 물살에 밀려 대상을 놓쳤습니다. 뭍으로 돌아갑니다.        ← 문제 기록 METHOD_FAIL
10:21:31 [09] RESPONDER/안지후: 가까이 떠밀려 왔습니다. 장대로 끌어당기겠습니다.          ← 평소 방법이지만 앞선 실패가 있어 알린다
10:21:37 [09] RESPONDER/안지후: 구조 대상 C, 장대로 끌어냈습니다. 처치와 이송이 필요합니다.
보고서: "대응 방법이 1차례 막혔습니다 (헤엄 구조 중 물살에 밀려 대상을 놓침) — 안지후가 장대로 다시 시도해 성공."
```

**예 5 — 줄도 없고 헤엄도 못 치는 대원** (순찰3 한지민: swimOf 0.3, 구명줄 없음. 대상 reach 3, drift 0.05, 하류 2칸에 다리)
후보: catch 0.8 하나 → **catch**, 까닭 `noGear`.

```
10:30:02 [11] RESPONDER/한지민: 줄이 없습니다. 하류 다리 위에서 기다렸다 붙잡겠습니다.
10:30:31 [11] RESPONDER/한지민: 구조 대상 A, 다리 밑에서 붙잡아 끌어냈습니다.
```

**예 6 — 문** (구조1 홍서진, 장비 손잡이 2)

```
10:41:12 [14] RESPONDER/홍서진: 유압 개방기가 멈췄습니다. 할리건으로 바꿉니다.            ← 문제 기록 EQUIP_FAIL
10:41:20 [14] RESPONDER/홍서진: 할리건으로 문을 땄습니다. 진입합니다.
보고서: "구조1 유압 개방기 고장 — 홍서진이 할리건으로 다시 시도해 성공."
```

**예 7 — 흉기 용의자** (기동1 강현우, 테이저 탄창 2)

```
10:52:40 [16] RESPONDER/강현우: 흉기 소지 — 테이저로 무력화하겠습니다.
10:52:42 [16] RESPONDER/강현우: 테이저 명중. 용의자 1 무력화.
10:52:44 [16] RESPONDER/강현우: 무력화된 용의자 1 제압·검거!
```

---

## 6. 균형과 다시 재는 법

방법이 늘면 양쪽으로 움직인다.

| 쉬워지는 쪽 | 어려워지는 쪽 |
|---|---|
| 가까운 사람은 손·장대로 빨리 건진다. 위중한 사람은 헬기·보트·헤엄으로 건진다. 구조 공작차의 유압 장비로 문·구출이 빨라진다. 경찰·구급이 소화기로 작은 불을 먼저 잡는다. 테이저·비살상탄으로 교전 없이 검거한다 | 투척이 빗나간다. 위중한 사람은 줄을 못 잡는다(늦게 닿을수록 어려워진다 — 의도). 헤엄 구조에 대원이 다친다(부상은 판정의 `bad` 에 들어간다). 장비 손잡이가 낮으면 장비가 없고 동력 장비가 멈춘다. 배연이 불을 키울 수 있다 |

**목표**(난이도 보통):
- 전체: `npm run check` 의 범위(성공+대응 지연 65~90%, 실패+미해결 3~25%, 한계 시간·무대응 4% 이하, 평균 대응 90초 이하) 안, 그리고 ROADMAP 기준 수치와 성공률 ±3%p.
- 수난 사고: 성공률이 지금 ±5%p(ROADMAP 70%), `--force water/std` 20교대에서 한계 시간 ≤ 2, 수난 사건당 대원 부상 ≤ 0.15.
- **다양성(단조로움의 지표)**: `--force water/std` 20교대에서 성공한 방법이 **4가지 이상**, 가장 많이 쓰인 방법이 **70% 이하**. 문은 3가지 이상, 화재 3가지 이상, 무장 4가지 이상(각 단계의 강제 교대에서).
- 장비 손잡이 1(`--diff 3,3,3,1,3,3`)에서 맨몸 방법·헤엄이 늘고, 5 에서 줄어든다(방법 분포가 손잡이를 따른다).
- 구출: 평균 구출 시간 ±15%(평소 방법의 식을 그대로 두었으므로 크게 움직이지 않아야 한다).

**재는 법** — 단계마다 전후로(전 = 그 단계 직전 커밋):

```bash
npx tsx scripts/sweep.ts 60 --scen --methods            # 분포, 시나리오별 표, 방법별 성공 횟수
npx tsx scripts/sweep.ts 20 --force water/std --scen --methods
npx tsx scripts/sweep.ts 20 --force fire/ship --scen --methods
npx tsx scripts/sweep.ts 20 --disaster tsunami --scen --methods
npx tsx scripts/sweep.ts 20 --diff 3,3,3,1,3,3 --force water/std --methods     # 장비 불량
npx tsx scripts/sweep.ts 20 --diff 3,3,3,5,3,3 --force water/std --methods     # 장비 최상
npx tsx scripts/sweep.ts 1 --force water/std --log S7                           # 왜 그 방법을 골랐는지 읽는다
# 단계별: 2 문 → --force collapse/elevator, armed/hostage, fire/std · 3 구출 → traffic/std, collapse/std · 4 화재 → fire/std, fire/arson
#         5 무장 → armed/dispute, armed/robbery, armed/hostage, armed/siege · 6 → medical/trauma, hazmat/std
npm run check                                           # 단계를 끝낼 때 한 번 (오래 걸린다)
```

- `scripts/sweep.ts` 에 `--methods` 를 더한다: 모든 사건의 `I.methods` 에서 `ok: true` 를 방법별로, `ok: false` 를 (방법, 까닭)별로 세어 표 하나. `--json` 이면 요약에 `methods` 를 넣는다.
- 0단계(틀만) 커밋은 **기록 해시가 한 건도 달라지지 않아야 한다**: 같은 시드 몇 개(`S0`~`S9`)의 `sim.report.hash` 를 전후로 비교한다.
- 시뮬레이션을 고친 뒤 `sweep 60` 의 결과 분포와 `close reasons` 의 `timeout` 건수를 전후로 비교한다(CLAUDE.md 작업 방식). 범위를 벗어나면 방법의 `pref`·판정 수치를 조정한다. 범위 자체(`sweep --check`)는 건드리지 않는다.

## 7. 구현 순서 (유형 하나씩 — 단계마다 커밋)

| 단계 | 내용 | 끝났다는 증거 |
|---|---|---|
| **0 틀** | `types.ts` 추가, `difficulty` 의 `gearOk`·`toolFail`, `methods.ts`(`METHOD` 는 `Record` 라 모든 방법의 줄을 둔다 — 실행부가 아직 없는 방법은 `can: () => false`. `gearOf`·`swimOf`·`chooseMethod`·`methodFit`·`reachOf`·`catchPoint`), `methodRun.ts`(공통 함수·`ExecKit`), `executor` 의 `XK`, `casFact` 의 새 칸, `debrief` 의 `METHOD_FAIL`·방법 문장·`methods` 집계(아직 쓰이지 않는다), 패널 세 줄(방법이 없으면 비어 있음), `sweep --methods`, 테스트 1(격리)·장비 표 테스트 | `tsc` 통과, 기록 해시가 전과 같다 |
| **1a 수난: 물가 방법** | hand·pole·ring·rope·improvise·catch, 투척 빗나감·잡기, `fitFor` → `methodFit`, `case 'waterRescue'` → `runWaterRescue`, 완료 문구, 지휘 규칙(거듭 실패 → 지원 요청) | `--force water/std` 20교대 표, `tests/sim.test.ts` 수난·`tests/major.test.ts` 선박 화재 통과 |
| **1b 수난: 헤엄** | 물 위 바탕(3.5: `costFor`·`moveSpeed`·`ashore`·brain 가드·`finishTask` 내려놓기·`rules/methods` 의 `s.flow`), swim·tend | 물 칸에 갇힌 대원 0, 대원 부상 목표 안 |
| **1c 수난: 헬기·보트** | hoist·boat(raft 포함) | 선박 화재·해일에서 boat·hoist 성공이 있다 |
| **1d 수난: 그림** | 3.7 의 수난 줄, 헤엄치는 대원, 보트, 헬기 인양, `agentPose` | 스크린샷(`?seed=…&force=water/std`), 콘솔 오류 0, 분포가 1c 와 한 건도 다르지 않다 |
| **2 문·통로** | 4.2, `workOnBlocker`·`unblock` | 다양성 목표, 분포 |
| **3 구출·탐지** | 4.3·4.4 | 구출 시간 ±15% |
| **4 화재** | 4.5, `spray` 인자, 송풍기 규칙, `fitFor suppress` 소화기 | B1 합친 뒤 화재 성공률 −3~+5%p |
| **5 무장** | 4.6, `hazards.tickHostiles` 방패 배율 | 무장 성공률·대원 부상 |
| **6 응급·가스** | 4.7·4.8, `commander` 구조 대상 블록의 세 군데(헬기 먼저·`!c.rush`·즉시 이송 탑승 우선순위), `hazards.tickGas` 방송 배율 | 응급 대응 지연 비율이 늘지 않는다 |
| 7 야외 수색 (선택) | 4.9 — R1 의 부대·장비가 정해진 뒤 | |

각 단계: `npx tsc --noEmit` → `npx vitest run tests/methods.test.ts tests/ext.test.ts` → 6절의 sweep 전후 비교 → 커밋(한국어, `wf/methods` 에만, 푸시하지 않는다). 그림은 단계마다 함께 해도 되지만, 화면만 고친 커밋은 분포가 같아야 하므로 시뮬레이션 커밋과 나눈다.

## 8. 테스트 (`tests/methods.test.ts`)

무거운 반복은 피한다: 강제 교대는 `new Sim(seed, NORMAL, 1200, { force: 'water/std' })`, 장면 단위는 `createIncident(sim, { type, variant, rng: sim.rng.fork('t') })`.

1. **판단부는 진실을 읽지 않는다**: `src/sim/field/methods.ts` 의 주석이 아닌 줄에 `s.props`·`s.casualties`·`s.hostiles`·`.truth`·`s.fire[`·`s.smoke[`·`sim.scenes`·`s.variant` 가 없다. `agents`·`hazards`·`executor` 를 import 하지 않는다(`tests/ext.test.ts` 의 지휘 규칙 검사와 같은 방식). `orders/methods.ts` 는 기존 테스트가 이미 검사한다.
2. **장비를 빼면 다른 방법을 쓴다**: 수난 강제 교대 6개(시드 `W0`~`W5`)를 두 번 — 한 번은 그대로, 한 번은 시작 전에 모든 부대의 `u.gearUse = { rope: 9, ring: 9, pole: 9, ladder: 9 }`. 앞쪽은 성공 방법에 rope 나 pole 이 있고, 뒤쪽은 rope·ring·pole 이 없으며 성공한 수난 구조가 있고 그 방법은 hand·improvise·catch·swim·boat·hoist 가운데 하나다. 장비를 뺀 쪽에서 `noGear` 까닭의 기록이 하나 이상.
3. **방법마다 실제로 쓰인 교대가 있다**:
   - 수난 강제 12교대 + 선박 화재 4교대(`tests/major.test.ts` 의 `MA`~`MD` — 구조정이 오는 시드가 있다) + 2번의 장비를 뺀 6교대: 성공 방법 집합 ⊇ {rope, pole, swim, hoist, boat}. (확인 필요: 이 조합에서 boat·hoist 가 실제로 나오는지 — 안 나오면 선박 화재 시드를 늘리거나 장면을 직접 만든다.)
   - 장면을 직접 만들어: **catch**(수난 현장에서 대상을 다리 3칸 위에 두고 `drift = 0.08`, 줄·헤엄이 없는 대원 하나), **tend**(헤엄 대원과 구명줄을 가진 같은 작업의 동료), **hand**(대상을 물가 1칸에).
   - 2단계 뒤: 문 — hydraulic·halligan·kick 성공 각각 ≥ 1(`collapse/elevator`·`fire/std`·순찰만 있는 `armed` 강제). 5단계 뒤: taser ≥ 1(`armed/dispute`). 4단계 뒤: extinguisher ≥ 1(차량 화재가 있는 `traffic` 강제 또는 직접 만든 장면).
4. **헤엄 구조는 수영 능력과 위험을 반영한다**:
   - 대원의 `fitness`·`skills.rescue` 를 0.1 로 바꾸면(`swimOf < 0.35`, 구명조끼 없음) `chooseMethod` 가 swim 을 내지 않는다. 구명조끼를 주면(`swimOf ≥ 0.25` 일 때) 낸다.
   - 사고율 함수(`methodRun` 에서 export 하는 `swimTrouble(swim, flowK, pfd, drysuit, tended, tired, towing, night)`)는 swim 이 클수록 작고, pfd·tend 가 있으면 작고, flowK 가 클수록 크다.
   - 통합: 헤엄 구조가 쓰인 교대들에서 물 칸 위에 `down` 인 대원이 한 번도 없다(매 100틱 검사), 교대가 끝났을 때 물 칸에 서 있는 대원이 없다, 사고가 난 대원의 체력이 물 위에서 18 아래로 내려간 적이 없다.
5. **끌어낸 사람은 물 밖 뭍에**: 모든 강제 교대에서 `tFreed ≥ 0` 인 물속 대상은 `inWater === false` 이고 그 칸이 물이 아니거나 `where !== 'scene'`(tests/sim.test.ts 의 조건과 같다), 그리고 `freedHow` 가 있다.
6. **재현성**: 같은 시드 두 번의 `report.hash` 가 같다 — 수난 강제, 장비를 뺀 교대, 무장 강제 각각.
7. **기록과 보고서**: 평소 방법이 아닌 방법으로 구한 사건의 `result.analysis` 에 그 방법의 `noun` 이 들어간 문장이 있다. `METHOD_FAIL` 이 있는 사건은 (다음 방법이 성공했다면) 그 문제가 `recovered`. 보고서 요약에 "대응 방법:" 줄이 있다.
8. **소모 장비**: 소화기를 12초 쓰거나 테이저를 쏘면 `gearOf` 의 수가 준다. 0 이면 그 방법을 고르지 않는다. `gearOf` 를 백 번 불러도 시뮬레이션 상태(`u.gearUse`, 난수 흐름)가 바뀌지 않는다.
9. **다양성**(느슨하게): 수난 강제 20교대에서 성공 방법 3가지 이상, 가장 많은 방법 85% 이하(6절의 목표 70% 는 sweep 으로 본다).

## 9. 고칠 파일

**자기 파일**: 첫머리의 표.

**공용 파일 수정**(이 표에 없는 곳을 고쳐야 하면 고치되, 끝낼 때 보고에 파일·함수·이유를 적는다):

| 파일 | 함수·자리 | 무엇을 · 왜 | 단계 |
|---|---|---|---|
| `types.ts` | 3.1 | 추가만 | 0 |
| `difficulty.ts` | `Tuning`·`tuningOf`, `KNOBS` equipment 의 `desc` | `gearOk`·`toolFail`, 설명 한 마디 | 0 |
| `field/executor.ts` | 파일 끝 | `XK: ExecKit` | 0 |
| | `case 'waterRescue'` | 몸통을 `runWaterRescue(sim, s, I, a, t, XK); return;` 으로(지금 줄은 rope·`landCasualty` 로 옮긴다) | 1a |
| | `moveTo` | 비용 함수를 `costFor` 로(물 위·헤엄·보트). `agentCost` 생성 횟수 유지 | 1b |
| | `moveSpeed` | 맨 앞에 물 칸의 헤엄·보트 속도 | 1b |
| | `finishTask` | 실패 사유 표에 `nomethod: '쓸 수 있는 방법이 없습니다'`. 업고 있던 사람이 물속 사람일 때의 내려놓기(3.5) | 1a·1b |
| | 새 `case 'ashore'` | 물 위의 대원을 뭍으로 | 1b |
| | `workOnBlocker`(인자 `tk` 추가, 호출 두 곳)·`unblock`(인자 `method`) | 속도를 `blockerRate` 로, 완료 문구를 방법별로 | 2 |
| | `case 'extricate'`·`case 'search'` | `startMethod`, 속도 `k`·청음 정지 | 3 |
| | `spray`(인자 `eff`·`wmul`, 기본 1)·`case 'suppress'` | 방법 분기 한 줄 | 4 |
| | `case 'engage'` | 맨 앞(테이저)·② 앞(나머지)에 분기, 검거 기록 자리마다 `recordMethod` | 5 |
| | `case 'treat'`·`case 'mitigate'`·`case 'perimeter'` | rush·ventFirst·announce 분기 | 6 |
| `field/agents.ts` | `casFact` | `CasBelief` 의 `water`·`drift`·`veh`·`rush`(본 것을 그대로) | 0 |
| | `fitFor` | `waterRescue` → `methodFit` 식(1a), `suppress` 의 소화기 길(4) | 1a·4 |
| | `visionOf`·`detectRadius` | 열화상 연기 계수, 청음 `detectMul` | 3 |
| `field/brain.ts` | `think` | 물 위의 대원 가드(3.5) — 철수 지시 블록보다 앞 | 1b |
| `field/commander.ts` | 구조 대상 블록: 탑승 대상(`ambulances`) 고르기, `needTreat`·안전 구역 쪽 처치 조건, 탑승 우선순위 | 믿음 band 2 이면 헬기 먼저, `!c.rush`, 즉시 이송이면 0.97 | 6 |
| `field/hazards.ts` | `tickHostiles` 총기 명중 `p` | 표적 대원의 방법이 `shield` 면 ×0.35(곱만) | 5 |
| | `tickGas` 주변 시민 확률 | 대피 방송이 있으면 ×0.4(곱만) | 6 |
| `debrief.ts` | `PROBLEM_LABEL`·`order`·문장 표 `T` | `METHOD_FAIL` | 0 |
| | `evaluate` 끝(맺음말 앞) | 방법 문장 최대 2 | 0 |
| | `buildReport` | `methods` 집계, 요약 한 줄 | 0 |
| `field/scenes/index.ts` | 끝 | `import '../rules/methods';` `import '../orders/methods';` (세계 규칙은 등록 순서대로 돈다 — 맨 끝에) | 0 |
| `view/renderScene.ts` | `agentPose` | 방법별 자세·물건 | 1d~ |
| | 대원 그리기 | 헤엄치는 대원(`drawSwimmer`), 보트 위 대원 | 1d |
| | "구조 줄" 블록 | `drawMethodFx(ctx, s, L, o)` 호출 하나로 바꾼다(그림은 `methodsLayer.ts`) | 1d |
| `view/scene/sprites.ts` | `ArmPose`·`Item`·`drawPerson` 끝의 물건 그림 | 3.7 의 자세·물건, `drawBoat`, 헤엄치는 대원 모습 | 1d~ |
| `ui/panels.tsx` | 대원 정보(`agent-head` 아래 섹션) | 장비·방법·방법 후보 | 0 |
| `scripts/sweep.ts` | 인자 처리·출력 | `--methods` | 0 |

`sceneManager.ts` 는 고치지 않는다: 부대 도착(대원은 대기 지점 근처 뭍에 선다)·`agentHealth`(물 위에서 쓰러지지 않게 하는 것은 실행부의 체력 하한으로)·한계 시간은 그대로다.

## 10. R1·H1·G4·R3 과의 맞물림, R1 없이 쓸 대체

**R1(부대 편성·개인 장비·헬기)** — 이 문서를 쓸 때 `docs/specs/R1-crews.md` 는 아직 없었다(확인 필요: 구현을 시작할 때 R1 문서를 먼저 읽고 아래를 맞춘다).

- **R1 없이 쓸 대체**: 장비 판정은 `methods.ts` 의 `gearOf(sim, a)` 하나에 모은다 — 3.3 의 부대 종류별 표 + `tune.gearOk` + `u.gearUse`. 수영 능력은 `swimOf`(3.3 의 식). 다른 모든 코드는 `gearOf`·`hasGear`·`swimOf` 만 부른다. 그래서 R1 이 들어오면 이 세 함수의 속만 바꾼다.
- **R1 이 생기면**:
  - 개인 장비: R1 의 대원별 장비 칸(이름 확인 필요 — 예: `Responder.kit`)이 있으면 `gearOf` 가 그것과 **차에 실린 장비**(boat·raft·hoist·aerial·fan·spreader·cutter·airbag·shoring·listener 처럼 부대에 하나 있는 것)를 합쳐 돌려준다. "같은 부대 동료가 쓰는 중"을 빼는 것은 차에 실린 장비에만 한다(개인 장비는 본인 것).
  - 이름: R1 의 장비 이름을 쓴다. 이 문서의 `GearId` 와 다르면 `GearId` 를 R1 이름으로 바꾸고, `methods.ts` 머리에 대응표를 둔다(`types.ts` 는 추가만이므로 R1 이 먼저 합쳐졌다면 R1 의 타입을 그대로 쓰고 `GearId` 를 만들지 않는다).
  - 역할: R1 의 역할(예: 수상 구조 요원·운전원·진입조)이 있으면 `situ` 에 역할 배율을 더한다 — 수상 구조 요원은 swim ×1.3 이고 구명조끼를 늘 입은 것으로, 운전원은 tend·boat 조종을 먼저.
  - 편성 인원: 2인 고정이 아니게 되면 roof(2인)·tend 는 이미 `mates`(같은 작업의 동료)를 본다. 바꿀 것이 없다.
  - 헬기: 경찰·구급 헬기가 생기면 hoist 는 인양기(hoist)가 있는 헬기만, 경찰 헬기는 air(공중 수색)·thermal, 구급 헬기는 airlift.
  - 수영 능력: R1 이 사람별 수영 능력이나 자격 칸을 두면 `swimOf` 가 그것을 읽는다.
  - 탐지견·드론: R1 의 부대·장비로 생기면 4.9 를 켠다.
- R1 이 `resources.createRoster` 의 난수 순서를 바꾸더라도 R2 의 대체는 자기 흐름(`gear:<부대 id>`)과 이름 해시만 쓰므로 영향을 받지 않는다.

**H1(부상과 사망)** — 헤엄 중 사고의 피해, 급박 구출(`rapid`)의 환자 피해, 테이저·비살상탄·저격의 용의자 피해, 터널 붕락의 피해는 지금 `health` 를 깎는 것으로 적었다. H1 의 부상 모델(종류·출혈·사망)이 들어와 있으면 그것을 쓴다. "물 위에서 쓰러지지 않는다"(체력 하한 18)는 H1 이 대원의 익수·사망을 허용하는지에 따라 다시 정한다(허용하면 물 칸의 쓰러진 대원을 건지는 길 — 다른 대원의 waterRescue 대상이 되는 것 — 이 함께 있어야 한다).

**G4(현장 가독성)** — 같은 `renderScene.ts`·`sprites.ts` 를 고친다. R2 의 그림은 `methodsLayer.ts` 에 모으고 `renderScene` 은 9절의 세 자리만 고친다. G4 가 먼저 합쳐졌으면 그 그림 규칙(크기·색·표지)을 따른다.

**R3(분야별 대응 교본)** — R3 는 `METHOD` 표의 행과 `situ` 조건을 늘리는 것으로 만든다. 공기·탄약·짝의 유무 같은 '상태'는 `MethodCtx` 에 칸을 더해 넣는다. `situ`·`skill` 은 선택 칸이므로 칸을 넓혀도 기존 행이 깨지지 않는다.

## 11. `CLAUDE.md` 에 들어갈 줄 (합친 뒤에 고친다)

**자주 하는 확장** 표에 한 줄:

| 하고 싶은 것 | 고칠 곳 |
|---|---|
| 새 대응 방법 (같은 임무, 다른 방법) | `types.ts` `MethodId`(필요하면 `GearId`) → `field/methods.ts` 의 `METHOD` 표에 한 줄(임무·장비·`pref`·`risk`·`can`·`situ`·라벨·`noun`)과 `SAY` 문구 → 장비가 새것이면 `gearOf` 의 부대 표(R1 뒤에는 R1 장비 표) → `field/methodRun.ts` 그 임무의 실행부에 분기(판정은 `mrng`, 기록은 상태를 바꾸는 그 자리에서 `emit`, 끝나면 `recordMethod`) → 그림은 `view/scene/methodsLayer.ts`·`renderScene.agentPose` → 보고서 문장은 `noun` 으로 저절로. 확인은 `npm run sweep -- 20 --force 유형/변형 --scen --methods` |

**함정** 후보:
- **방법을 고르는 코드는 진실을 읽지 않는다.** `methods.ts` 는 믿음·현장의 생김새·자기 장비만 본다(테스트가 금지어를 검사한다). 거리·물살은 믿음으로, 연기·열은 실행기가 대원이 선 칸에서 재서 `Sense` 로 넘긴다.
- **물 위의 대원.** 물 칸에 선 대원은 다른 일로 끌려 나가지 않는다(`brain` 가드). 일이 끝나거나 사고가 나면 `ashore`. 경로는 `costFor`(물 칸을 지나는 비용). 물 위에서는 쓰러지지 않는다(체력 하한 18). 이걸 빼면 물 칸에서 후퇴·철수의 경로가 없어 대원과 부대가 영영 묶인다.
- **끌고 오는 동안의 구조 대상은 `inWater` 를 유지한다.** 뭍에 내려놓을 때만(`landCasualty`) 푼다. 중간에 풀면 놓쳤을 때 "물 위에 떠 있는데 물 밖인 사람"이 생겨 아무도 건지지 못한다.
- **방법의 판정은 `mrng` 만.** 사격(`s.rng`)·판단 오차(`a.rng`)·명부·장비 흐름에 호출을 끼우면 무관한 결과까지 바뀐다. `moveTo` 의 비용 함수를 바꿀 때도 `agentCost` 를 만드는 횟수(`a.rng` 한 번)를 지킨다.
- **쓸 방법이 하나도 없는 대원은 그 일을 맡지 않는다**(`methodFit` 0). 임무마다 맨몸 방법(손·즉석 부력물·발로 차기·손으로 치우기·수동 구출·호출 수색)을 하나 남겨 사건이 끝나게 한다.
- **장비 수는 `useGear` 로만 줄인다.** `gearOf` 는 계산만 한다 — 화면이 불러도 시뮬레이션이 달라지지 않는다.
- **방법을 바꾸는 때는 셋뿐**(실패·고장·조건 상실 3초). "더 좋은 방법이 보이면 바꾼다"를 넣으면 대원이 두 방법 사이를 오간다(한 임무에 이동 목표 둘과 같은 증상).

## 12. 알려진 위험과 확인할 것

- **R1 문서가 아직 없다.** 장비 이름(`GearId`)·개인 장비 칸·역할·헬기 종류가 R1 과 다를 수 있다(10절의 맞물림대로 맞춘다). 이 문서의 부대별 장비 표는 R1 이 없을 때의 대체일 뿐이다.
- **수치는 모두 시작값이다**(사거리·준비 시간·명중·사고율·`pref`). 현장 격자 1칸이 실제로 몇 m 인지 정해져 있지 않아 거리는 서로의 비율로만 잡았다(지금의 줄 3.6칸을 기준으로).
- **하류 차단(`catch`)은 평소에 드물 것이다.** 일반 수난 현장의 사람은 다리에서 4칸 이상 위에서 시작하고 drift 가 0.01~0.05 라 다리까지 60초 넘게 걸린다(40초 기준을 넘는다). 굽은 물가에 걸리는 경우와 "줄도 헤엄도 없는 대원"에게서 주로 나온다. 테스트는 장면을 직접 만들어 확인한다. 더 자주 보이게 하려면 40초 기준을 늘린다.
- **헬기 인양은 그림만 대상 위에 있다**(대원은 대기 지점에 남는다). 대원이 줄에 매달려 내려가는 모습까지 하려면 하늘을 나는 이동(지형 무시)이 따로 필요하다 — 뒤로 미뤘다.
- **경찰·구급의 소화기 초기 진압**은 화재 사건의 흐름을 바꿀 수 있다(먼저 도착하는 순찰차가 작은 불을 잡는다). B1(화재 균형) 뒤에 재고, 넘치면 `pref` 를 낮추거나 실외 구역으로만 좁힌다.
- **배연의 효과 크기**(연기 감쇠 0.2/초, 불 +0.006/초)는 `tickFire` 가 5틱마다 도는 것과 겹쳐 생각보다 세거나 약할 수 있다. 재어서 정한다.
- **동시 작업과의 충돌**: `wf/b3`(executor·commander·agents·types·sceneManager)·`wf/p1`(hazards·grid·beliefs)·G4(renderScene·sprites)·H1(agentHealth·부상) 과 같은 파일을 고친다. 합치는 순서는 ROADMAP(R1 → H1 → R2, G4 는 따로). P1(헤드리스 속도)은 기록 해시 전후 비교로 검증하므로 R2 보다 먼저 합쳐야 한다(R2 는 로그 문구를 바꾼다).
- **성능**: `fitFor` 가 수난 현장에서 `methodFit` 을 생각 주기마다 부른다. `reachOf` 는 믿음 위치 둘레 반경 4칸만 훑고, `losWalls` 를 몇 번만 부른다. 느려지면 대원별로 0.5초 동안 결과를 담아 둔다.
- **`s.flow` 의 처음 값**: 사람들이 모두 걸려 멈춘 뒤에 처음 계산되면 기본값 0.02 가 된다. 지금은 첫 대원이 도착하기 전부터 규칙이 1초마다 돌므로 처음 drift 를 놓치지 않는다(확인 필요: 첫 틱에 이미 걸려 있는 사람이 있는 현장).
- **구조정은 바닷가에만 출동한다**(`dispatcher.pickUnit`). 일반 하천에서 보트 방법은 구조 공작차의 고무보트(raft)로만 나온다.
- **방법 문장의 길이**: 보고서의 분석 문장은 11~12줄에서 잘린다. 문제가 많은 사건에서는 방법 문장이 빠질 수 있다(의도 — 문제 설명이 먼저).
