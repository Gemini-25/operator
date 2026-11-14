# I2 — 교대 간 지속

공통 규칙은 `docs/specs/README.md`. 브랜치 `wf/persist`, 개발 서버 포트 **5232**. 본보기: `T1-traffic.md`(도로 통제의 주인과 우회로 검사), `N4b-crime.md`(묶음 파일과 공용 파일 수정의 경계).

**한 줄 요약**: 교대가 끝나면 지금은 모든 것이 사라진다. 이 묶음은 대원 상태·장비·건물·도로 네 가지를 **"이어받은 상태"(`Carryover`)** 라는 자료로 만들어 다음 교대의 `Sim` 생성자에 입력으로 넣는다. 같은 시드 + 같은 난이도 + 같은 이어받은 상태 = 같은 결과. 이어받은 상태가 없으면 지금과 기록 해시가 한 글자도 다르지 않다.

사용자 검토 의견의 요지(설계의 기준): "사건 사이의 영향이 다음 교대까지 남는다 — 화재 건물의 그을음·손상, 붕괴 건물은 복구 전까지 못 쓰고, 파손 도로는 수리될 때까지, 부상 대원은 치료가 끝날 때까지 결장, 쓴 장비는 점검·보충, 큰 재난 뒤에는 인력·장비가 모자란다. 우선 대원 상태·장비·건물·도로 네 가지만." 그리고 "성공률을 무조건 높이는 쪽으로 최적화하지 않는다 — 실패도 중요한 결과다."

**하는 것**
- 자료형 `Carryover`(판 번호, JSON 으로 저장·복원) — 대원(체력·부상·결장 남은 교대·경험·숙련), 장비(펌프 상태·정비·소모품 재고), 건물(손상·그을음·출입 통제·무너짐·복구 남은 교대), 도로(파손·복구 남은 교대).
- 교대가 끝날 때 다음 교대용 상태를 만드는 규칙(회복·수리·보충), 다음 교대가 그것을 적용하는 자리와 순서.
- 도시 지도(`city.places`·`nodes`)를 고치지 않고 건물 상태를 **겹쳐** 읽기: 사건 장소 고르기·현장 생성·지도 그림이 모두 겹친 상태를 본다.
- 화면: 교대 시작 전 조건에 "새 조직으로 시작 / 이어서 시작", 저장(localStorage, 실패해도 새로 시작), 지도에 남은 흔적, 보고서의 "지난 교대의 영향".
- '죽음의 나선'을 막는 회복 규칙과 상한, 교대 N번을 이어 돌리는 측정 스크립트(`scripts/chain.ts`).
- ROADMAP 의 K1(대원 경험치 성장과 교대 간 저장)을 이 묶음이 함께 끝낸다.

**이번에 하지 않는 것**
- 교대 사이의 날짜·시각 흐름(교대 시각과 날씨는 지금처럼 그 교대의 시드가 정한다 — §3.1 결정).
- 지구력·피로의 누적(교대 사이 휴식으로 회복된다고 본다). 차량 자체의 손상(지금도, X6 초안에도 차량이 다치는 모델이 없다 — 생기면 `UnitCarry.service` 의 `'vehicle'` 로 받는다).
- AI 의 조직 기억(오판에서 배우기 — ROADMAP K2). 같은 방식(생성자 입력)으로 나중에 `Carryover` 에 칸을 더할 수 있게만 둔다.
- 병원 수용 여력, 기반시설(전력·통신·수도)의 교대 간 지속 — I1-b 의 세계 상태가 생긴 뒤 같은 틀로 더한다.
- 이어받은 상태를 손으로 고치는 편집 화면(관찰 전용 원칙 — §5.1).

**자기 파일**(새로): `src/sim/persist.ts`(만들기·적용·검사·요약), `src/view/city/carryLayer.ts`(지도의 남은 흔적), `scripts/chain.ts`(연속 교대 측정), `tests/persistence.test.ts`.
**공용 파일 수정**: §10 의 표에 적힌 함수만, 가장 작은 조각으로(README §2).
**이 설계서가 따로 허락하는 것**: 마지막 단계의 `README.md`·`CLAUDE.md`·`docs/ROADMAP.md`(K1 을 끝난 것으로 옮긴다). `scripts/sweep.ts` 에 `--carry` 옵션 하나.
**건드리지 않는다**: `city.ts`, `cityPlan.ts`, `view/city/staticCity.ts`, `view/city/places.ts`, `tests/sim.test.ts`, `dispatch/*`(배정은 지금의 `crewReady`·`oos` 로 충분하다 — §3.4), `traffic.ts`(새 통제 이유 `'repair'` 는 이 묶음이 주인이다).

시작하기 전에: 구현 순서는 **R1 → H1 → X6 → R2 → R3 → I1-b → I2**(`docs/ROADMAP.md` "진행 중"). 이 묶음은 맨 끝이다. 아래 줄 번호는 2026-11-14 `a746b77`(B1·B3·P1·Q1 을 합친 뒤) 기준이고 앞 묶음들이 합쳐지면 바뀐다 — **함수 이름으로 찾는다**. 확신하지 못한 곳은 **(확인 필요)** 로 표시했다. I1 설계서는 이 문서를 쓸 때 아직 없어서 이름을 가정으로 적었다. X6 는 초안(`X6-catastrophe.md`, 작성 중)의 이름에 맞췄다 — X6 §0 의 I2 줄이 "X6 의 이름이 기준"이라고 정했다. H1 은 설계서(`H1-injuries.md`)의 이름이다.

## 원칙

1. **이어받은 상태는 입력이다.** `new Sim(seed, d, len, { carry })`. 시뮬레이션은 이 입력을 고치지 않는다(받을 때 검사하며 깊이 복사한다). 같은 입력이면 같은 결과.
2. **없으면 지금과 같다.** `carry` 가 없거나 `null` 이면 이 묶음의 모든 함수가 첫 줄에서 돌아가고, 난수도 기록도 더하지 않는다. 0단계의 해시 목록(§8)이 모든 단계 뒤에 그대로여야 한다.
3. **도시 지도는 고치지 않는다.** `generateCity` 는 한 번 만든 지도를 모든 `Sim` 이 함께 쓴다(`city.ts:206-211`). 건물 상태는 `placeId` 를 열쇠로 한 **겹침 표**(`sim.carryState.places`)에, 도로 상태는 교대마다 복사되는 `city.edges` 의 칸에 둔다.
4. **난수는 새 흐름만.** `carry`(만들기), `recruit:<자리>`, `relief:<호출부호>`. 기존 흐름의 호출 수와 순서를 바꾸지 않는다 — 펌프 상태도 지금처럼 `equipment` 흐름에서 뽑은 **뒤에** 값만 바꾼다(`rng.fork` 는 부모 시드에서 갈라지므로 새 이름을 더해도 다른 흐름은 그대로다 — `rng.ts:44`).
5. **가짜 연출 금지.** 이어받은 상태가 바꾼 것은 그 상태를 적용하는 코드에서 `emit()` 한다(결장, 정비, 출입 통제, 복구 공사, 개통). 원인은 이어받은 상태 요약 기록(`carryState.event`)으로 `causes` 를 잇는다. 보고서 문장은 이 기록과 상태로만 쓴다.
6. **관찰만 한다.** 화면이 고르는 것은 "새 조직으로 / 이어서 / 저장된 조직 지우기" 셋뿐이다 — 교대 시작 전 조건(CLAUDE.md 1번 규칙). 누가 다쳤는지, 어느 건물이 막혔는지를 화면에서 고치지 않는다.
7. **정보 격리.** 이어받은 상태는 "앞 교대가 끝난 뒤의 점검으로 조직이 아는 기록"이다. 관제·지휘관이 읽어도 된다(진실 읽기가 아니다). 단 끝 상태를 **만들 때** 현장의 진실(`s.burnedTiles`·`s.damage`·소품)을 읽는 곳은 `persist.ts` 의 `placeOutcome` 하나뿐이다(`debrief.ts` 와 같은 자격 — CLAUDE.md 4번 규칙의 "진실을 읽어도 되는 곳"에 더한다).
8. **저장은 표현 계층에서만.** `src/sim` 에 `localStorage`·`sessionStorage`·`indexedDB` 가 없다(테스트가 잡는다 — §9). 저장 실패는 조용히 넘기고 새 조직으로 시작할 수 있다.
9. **이어갈수록 망가지지 않는다.** 결장·정비·출입 통제·도로 통제에 모두 회복 규칙과 상한이 있다(§6). 반대로 경험 성장이 쌓여 이어갈수록 쉬워지는 것도 상한으로 막는다.
10. **모든 사건은 끝난다.** 이어받은 통제가 도시를 끊지 않게 교대 시작 때 우회로를 확인한다(§3.5). `LIMIT`·`holdUntil`·`hardCap` 은 그대로.

## 연관 설계서와 나누는 선

| 설계서 | 겹치는 곳 | 나누는 선 |
|---|---|---|
| K1 대원 성장·교대 간 저장 (ROADMAP) | 경험 성장, 부상자 결장, 저장, 생성자 입력 | **I2 가 K1 을 함께 끝낸다.** K1 의 완료 조건("재현성 테스트에 명부 입력 추가, 저장된 명부로 재실행 시 해시 일치")은 §9 의 1·5번이 맡는다. 다 하면 ROADMAP 의 K1 을 "완료한 작업 묶음"으로 옮긴다 |
| H1 부상과 사망 | 다음 교대 결장, 순직, `RosterOut` | H1 은 교대 끝 상태(`r.dead`·`r.care`·`r.tDown`·`injuries`)와 화면용 `ShiftReport.roster` 를 **내놓는다**. I2 는 `sim.responders` 를 직접 읽어 `CrewCarry.out` 을 정한다 — 표는 H1 §3.7 그대로(§3.2). H1 의 `RosterOut` 은 열쇠가 `rid` 인데 `rid` 는 부대 규모 손잡이에 따라 바뀌므로(`resources.ts:66,75,86`) **I2 는 이름을 열쇠로 쓴다**. H1 의 `roster` 칸은 지우지 않고, `status 'off'` 인 대원의 `out` 만 I2 의 값으로 채운다(§10) |
| R1 부대 편성·개인 장비 | 자리·이름, 최소 인원, 소모품, 장비 고장 | R1 뒤에도 이름은 모두 다르다(`EXTRA_NAMES`, R1 테스트 ⑦). 결원 판정은 R1 의 `minCrew(kind)`(R1 없이 1). 소모품 재고(`Carryover.stock`)에 R1 의 테이저 카트리지를 더할 수 있고, 공기통·헬기 연료·물은 서(署)에서 채운다고 보아 이어받지 않는다. 장비 고장은 점검에서 드러나지 않은 것만 이어받는다(§3.3) |
| X6 위험의 현실화 | 실제 붕괴·폭발·전소, 건물 상태, 구조 건전도 | X6 는 교대 안의 건물 상태를 `Sim.placeMarks`(`Map<placeId, PlaceMark>` — `state` 는 `scorched`·`blasted`·`partial`·`burnt`·`collapsed`, `burnFrac`·`ruinFrac`)와 `Scene.cat`(`burntAt`·`totalAt`·`fallen`)에 남기고 `ShiftReport.placeMarks` 로 내놓기만 한다. **I2 는 `Sim.placeMarks` 를 끝 상태의 원천으로 먼저 읽는다**(§3.6): 전체 붕괴 → `ruin`, 전소 → `closed`(오래), 구획 붕괴·폭발 → `closed`, 그을림 → `marked`. 이어받은 손상(`s.wear.dmg`)은 X6 의 `catOf` 가 정하는 구획 건전도 처음 값에 한 항으로 들어간다(§7 — I2 가 그 한 줄을 넣는다). 같은 교대 안의 재발 막기(`pickPlace` 에서 `collapsed`·`burnt` 제외)는 X6 의 것이고 I2 는 그 옆에 이어받은 상태의 제외를 더한다 |
| I1 인과관계·세계 상태 | 세계 상태, 원인 사슬, 측정 | I1-b 가 건물·도로의 세계 상태(가칭 `sim.world`)를 두었으면 I2 의 겹침 표는 그 안의 칸으로 둔다(이름을 새로 만들지 않는다). I1-a 의 측정 지표가 "지난 교대 → 이번 교대" 의 영향을 시스템 간 영향으로 세도록 `carryState.event` 를 원인으로 잇는다(§7). **(확인 필요: I1 설계서가 아직 없다)** |
| G4 현장 상태 가독성 | 지도의 무너진 건물 그림 | G4 는 **이번 교대에** 무너진 건물을 현장 기록(`s.damage`·`s.falls`)으로 그린다(G4 §5.3). I2 는 **지난 교대에** 무너진 건물을 겹침 표로 그리며 G4 의 그림 함수와 기호(`RUIN_MARK`)를 쓴다. 그을린 지붕은 G4 §7.6 과 같은 넓이 식. G4 가 합쳐지지 않았으면 §5.4 의 단순한 그림 |
| T1 교통 | 도로 통제의 주인 | 새 통제 이유 `'repair'`(복구 공사)의 주인은 `persist.ts`. 교통 모델은 `'incident'`·`'disaster'` 처럼 건드리지 않는다(`traffic.ts:8` 규칙에 한 낱말 더한다 — 주석만). 놓기 전 우회로 검사는 T1 의 `linked` 와 같은 뜻(§3.5) |
| N6 재난 | 교대 끝의 통제 해제 | 재난은 지금처럼 교대가 끝나면 통제를 모두 연다(`disaster.ts:210,318-327`). 열기 **전에** 남은 통제를 기록만 한다(`d.leftover`) — 결과·기록 불변. 다음 교대가 그 구간을 "복구 공사"로 다시 막는다 |
| U2 통화창 · G5 교전 연출 | 화면 자리 | 겹치지 않는다. 상단 띠의 칩 하나(§5.2)는 U2 가 상단을 고쳤으면 그 배치를 따른다 |
| ROADMAP M2 (1) | 사건이 끝난 건물의 흔적 | 교대 **안**의 흔적은 G4, 교대를 **넘는** 흔적은 I2. 같은 건물의 재발은 I2 의 가중치(§3.6)가 일부 맡는다 |

---

## 1. 지금 상태 — 교대가 끝나면 무엇이 사라지는가

조사 근거는 파일:줄. 측정은 `npx tsx` 로 시드 3개(S0~S2, 보통)를 돌려 끝 상태를 읽은 것이다(작은 표본).

### 1.1 이미 교대를 넘어 남는 것

| 무엇 | 어떻게 | 근거 |
|---|---|---|
| 대원의 이름과 기본 능력 | 고정 조직 시드 `new Rng(0x51ab7e).fork('roster-v1')` 에서 `UNIT_DEFS` 순서로 한 명당 6번. 편성되지 않는 부대도 뽑으므로 부대 규모가 바뀌어도 같은 이름 = 같은 능력 | `resources.ts:58-86`, `tests/sim.test.ts:284-293`(부대 규모 손잡이 테스트) |
| 도시 지도 | `generateCity` 가 모듈 변수에 한 번 만들고, 교대마다 `edges` 만 복사해 준다 | `city.ts:206-211` |

### 1.2 교대가 끝나면 사라지는 것

| 무엇 | 교대 안에서 | 교대가 끝나면 | 근거 |
|---|---|---|---|
| 대원 체력·부상 | 연기·불·폭발·총격·2차 붕괴·재난이 깎는다. 40 아래 `injured`, 15 이하 `down`. 되돌리는 코드 없음(회복되는 것은 지구력뿐) | 다음 교대는 모두 체력 100, `ok` | `sceneManager.ts:134-157`(`agentHealth`), `resources.ts:78,323-327` |
| 교대 안의 결원 영향 | 현장에는 `ok` 만 내린다. `crewReady` 0 이면 복귀 때 `oos`. 배정은 결원 −18, 평균 지구력 감점 | 사라짐 | `sceneManager.ts:61`, `resources.ts:166,313`, `dispatcher.ts:60,75-78` |
| 경험 | `xpGained` 이 늘기만 하고 읽는 곳이 없다. `incidentsWorked++` 는 도착 때 한 번. 둘 다 보고서·화면에 없다 | 사라짐 | `executor.ts` 15곳, `agents.ts:93`, `sceneManager.ts:81` |
| 펌프 | `equipment` 흐름에서 장비 손잡이 범위로 뽑는다. 방수하면 닳고(`0.0042×pumpWearMul/s`) 0.2 아래면 고장. 서에 돌아오면 고장 난 펌프만 0.55 | 다음 교대에 새로 뽑는다 | `resources.ts:88,311-312`, `executor.ts:237-258,934-946` |
| 섬광탄 | 줄기만 하고 교대 안에서 채우지 않는다 | 다음 교대에 손잡이 값으로 | `resources.ts:97`, `executor.ts` 의 섬광탄 사용 세 곳 |
| 물·공구·처치 장비·방호 | 물은 서에서 가득. 나머지는 만든 뒤 바뀌지 않는다 | 다음 교대에 손잡이 값으로 | `resources.ts:94-96` |
| 건물 피해 | 그 사건의 `Scene` 에만: `burned`/`burnedTiles`(화재), `damage`(붕괴 잔해), `glass`, `decorHp`, 소품의 `ignited`·`exploded`. `Place` 에는 상태 칸이 없다 | 다음 교대에는 흔적 없음. 같은 교대 안에서도 다른 사건이 그 건물 상태를 보지 않는다(`pickPlace` 의 `used` 는 "이번 교대에 사건이 났던 곳"을 뺄 뿐) | `types.ts:46-58,292-330`, `incidents.ts:49-67` |
| 현장 평면 | 건물이 아니라 사건 번호와 교대 시드에 묶인 흐름(`scene:<사건>`)으로 만든다 | 같은 건물이라도 교대마다 평면이 다르다 — 칸 단위 피해는 옮길 수 없다 | `sceneManager.ts:23-27` |
| 도로 통제 | 사건(`'incident'`)은 `closeIncident` 가 풀고, 재난(`'disaster'`)은 교대가 끝나면 `finish(cut)` 이 모두 연다. 지진 균열은 200~400초, 해일은 200초 뒤에 연다 | 다음 교대는 모두 열린 도로 | `incidents.ts:211-215`, `disaster.ts:210,283-305,318-327` |
| 교통 장애물·불법 주차 | 교대마다 `traffic` 흐름에서 새로 | 사라짐(의도대로 — 교통은 이어받지 않는다) | `traffic.ts:290-331` |
| 저장 | `ar.settings.v1`·`ar.current.v1 {seed, tick, diff}`·`ar.history.v1`(요약 12개). 명부·장비·건물·도로의 끝 상태는 저장하지 않는다 | — | `runner.ts:9-19,96-101,119-121` |
| 보고서 | `respondersHurt`(지원 대원 포함), `equipFailures`, 부대 활용률. 끝 상태는 없다 | — | `debrief.ts:166-206` |

측정(시드 3개, 보통): 교대당 `xpGained` 은 가운데 0.006~0.011, 상위 10% 0.03, 가장 큰 값 0.055. 교대 끝의 펌프 상태 0.36~0.97, 고장 0. 섬광탄은 교대마다 0~2개 쓴다. 화재의 소실률 0~0.14, 붕괴 현장의 잔해 칸 30~60. 대원 부상 0명(H1 이전 — H1 뒤에는 늘어난다).

### 1.3 이어받기를 넣을 자리가 이미 있는 곳

- 생성자의 넷째 인자 `extra`(`engine.ts:63`)가 선택 인자 묶음이다. 지금은 `force` 하나. 부르는 곳: `runner.ts:45`, `scripts/sweep.ts:27`, 테스트 77곳(모두 그대로 둔다 — 새 칸은 선택).
- `rng.fork` 는 부모 시드에서 갈라진다(`rng.ts:44`) — 새 흐름 이름을 더해도 기존 결과가 바뀌지 않는다. `sim.rng` 를 직접 뽑는 코드는 `src/sim` 에 없다.
- `logHash` 는 기록 **문장**과 틱만 섞는다(`events.ts:22-26`). 이어받은 상태가 결과를 바꿨는지는 문장으로만 드러난다 → 요약 한 줄에 지문을 넣는다(§4.2).
- 도시 지도의 고정 층은 `Sim` 이 바뀔 때마다 다시 만든다(`renderCity.ts:115`) — 교대 내내 그대로인 흔적은 교대 시작 때 정해진다.

---

## 2. 이어받은 상태 (`Carryover`) — 자료형

### 2.1 `types.ts` (추가만. 합집합 끝에는 새 줄로)

```ts
// ───────────────────────── 교대 간 지속 (I2 — sim/persist.ts) ─────────────────────────
/**
 * 다음 교대가 이어받는 상태 — Sim 생성자의 입력(extra.carry). 회복·수리·보충을 이미 반영한 "다음 교대가 시작할 때의 상태"다.
 * JSON 으로 저장·복원할 수 있는 꼴만 쓴다: Map·Set·typed array·Infinity·NaN·undefined 값을 넣지 않는다(선택 칸은 아예 빼 둔다).
 * 판(v)이 다르면 persist.readCarryover 가 옮기거나(옮기는 함수가 있을 때) 읽지 않는다.
 */
export interface Carryover {
  v: 1;
  shift: number;                         // 이 상태로 시작하는 교대가 조직의 몇 번째 교대인가 (새 조직의 첫 교대 = 1 이고 그 교대가 만든 상태 = 2)
  city: string;                          // 도시 지문 (persist.cityKey). 지금 도시와 다르면 places·roads 를 버린다
  from: { seed: string; hash: string; diff: string };    // 이 상태를 만든 교대 (화면·검증용. 결과에 쓰지 않고 지문에도 넣지 않는다)
  crew: CrewCarry[];
  units: UnitCarry[];
  stock: Partial<Record<StockId, number>>;               // 서(署) 창고에 남은 소모품 — 이번 교대에 지급하고 남는 것까지 포함한 수
  places: PlaceCarry[];
  roads: RoadCarry[];
}
export type StockId = 'flashbang';
/** 대원 한 사람. 열쇠는 자리(seat ?? name) — 명부에서 이름은 모두 다르다 */
export interface CrewCarry {
  name: string;                          // 이 사람의 이름
  seat?: string;                         // 신임 대원만: 이 사람이 앉은 명부 자리의 원래 이름 (없으면 name 이 자리)
  callsign: string;                      // 만들 때의 소속 (화면용 — 열쇠가 아니다)
  out: number;                           // 앞으로 빠지는 교대 수, 이번 교대 포함 (0 = 나온다 · -1 = 순직)
  cause: string | null;                  // 결장 이유 — H1 의 InjuryCause (H1 전에는 'injured' | 'down')
  health: number;                        // 이번 교대를 시작할 때의 체력 (결장 중이면 돌아올 때의 체력)
  dExp: number; dSkill: number;          // 기본 능력(조직 시드)에 더한 경험·숙련. 누적 (상한 EXP_CAP · SKILL_CAP)
  shifts: number; incidents: number;     // 경력: 나온 교대 수, 다룬 사건 수 (화면·문장)
  replaceIn?: number;                    // out === -1 일 때: 신임 대원이 이 자리에 오기까지 남은 교대
  recruit?: RecruitBase;                 // 신임 대원: 조직 시드에 없는 사람의 기본 능력
  kitFault?: string[];                   // (R1 뒤) 점검에서 드러나지 않아 이번 교대에도 고장인 개인 장비 (KitId)
}
export interface RecruitBase { skill: number; judgment: number; composure: number; fitness: number; teamwork: number; experience: number }
/** 부대 하나. 열쇠는 호출부호 (편성표 UNIT_DEFS 에서 모두 다르다). 인근 도시 지원 부대는 넣지 않는다 */
export interface UnitCarry {
  callsign: string;
  pump?: number;                         // 소방 부대: 펌프 상태 0..1 (적용할 때 장비 손잡이의 범위 pumpMin..pumpMax 로 자른다)
  service?: { readyAt: number; why: 'pump' | 'vehicle' };    // 정비 중: 교대 시작 뒤 readyAt 초까지 'oos'
}
/** 건물 한 채의 남은 피해. 열쇠는 Place.id (도시가 고정이라 열쇠가 된다 — city 지문으로 확인) */
export interface PlaceCarry {
  id: number;
  state: 'marked' | 'closed' | 'ruin';   // 흔적만 남음(사용) · 출입 통제(복구 공사) · 무너짐
  dmg: number; soot: number;             // 구조 손상 0..1 · 그을음 0..1
  repair: number;                        // closed·ruin 이 풀리기까지 남은 교대, 이번 교대 포함 (marked 면 0)
  cause: 'fire' | 'collapse' | 'blast' | 'burnout';
  inc: string;                           // 원인 사건 ("조직 3번째 교대 · 04 화재") — 문장용
  since: number;                         // 생긴 교대
  spot?: [number, number];               // 무너진 자리의 건물 안 상대 위치 0..1 (그림용 — G4 의 u·v)
  mark?: 'scorched' | 'blasted' | 'partial' | 'burnt' | 'collapsed';   // 이 상태를 만든 X6 의 건물 상태 (그림용 — X6 가 없으면 빼 둔다)
  opened?: true;                         // 이번 교대를 앞두고 출입 통제가 풀렸다 (문장용, 한 번만)
}
/** 도로 한 구간의 복구 공사. 열쇠는 RoadEdge.id */
export interface RoadCarry {
  edge: number;
  why: 'crack' | 'washout' | 'flood' | 'fire' | 'mud' | 'tree' | 'debris' | 'surface';
  lane: boolean;                         // true = 한 차로 공사(느려질 뿐 — slow), false = 전면 통제(closed)
  left: number;                          // 남은 교대, 이번 교대 포함 (1 = 이번 교대 안에 openAt 에 끝난다, 2 = 이번 교대 내내)
  openAt: number;                        // left === 1 일 때 끝나는 시각 (교대 시작 뒤 초, 60..900)
  inc: string; since: number;
}
/** 화면·보고서용 요약 (persist.carrySummary) */
export interface CarrySummary { shift: number; absent: number; fallen: number; service: number; marked: number; closed: number; ruin: number; roads: number; grown: number }
```

있는 자료형에 더하는 칸(모두 선택 칸 — 없으면 지금과 같다):

```ts
// Responder.status 의 합집합 끝에 새 줄로
    | 'off';                             // 이번 교대에 나오지 않음 (결장·공석). 현장에 내리지 않고 crewReady 에 세지 않는다
// Responder
seat?: string;                           // 신임 대원이 앉은 명부 자리 (persist 가 채운다)
relief?: boolean;                        // 본부 예비 인력 (이번 교대만 — 이어받지 않는다)
carryOut?: number;                       // status 'off' 일 때 남은 결장 교대 (-1 = 공석)
carryCause?: string | null;              // status 'off' 일 때 결장 이유
// Unit
readyAt?: number;                        // 정비 중인 부대가 운용에 들어가는 시각 (persist.tickCarry 가 본다)
oosWhy?: string;                         // 'oos' 의 이유 (화면용: '정비 중' · '결원')
// Scene
wear?: { dmg: number; soot: number; cause: string; inc: string };      // 이어받은 건물 상태 (persist.applyPlaceWear 가 현장을 만든 직후 채운다)
// ShiftReport
carry?: { shift: number; key: string; lines: string[] };   // 이어받은 상태와 그 영향 — 이어받은 상태로 시작한 교대만
carryNext?: CarrySummary;                                  // 다음 교대로 넘기는 것
```

`RoadEdge.closedReason` 은 `string | null` 이라 타입을 고치지 않고 값 `'repair'` 를 쓴다. `Sim`(`engine.ts`)에 `readonly carry: Carryover | null` 과 `carryState: CarryState`(아래, `persist.ts` 에 정의 — `TrafficState` 가 `traffic.ts` 에 있는 것과 같은 꼴) 두 칸.

### 2.2 `persist.ts` 의 실행 중 상태

```ts
export interface CarryState {
  on: boolean;                                   // 이어받은 상태가 있는가 (없으면 모든 함수가 첫 줄에서 돌아간다)
  places: Map<number, PlaceCarry>;               // 건물 겹침 표 (교대 내내 그대로 — 교대 안의 새 피해는 끝날 때 placeOutcome 이 읽는다)
  roads: RoadCarry[];                            // 이번 교대에 끝날 복구 공사 (left === 1, openAt 순)
  slowed: { edge: number; v: number }[];         // 이 파일이 더해 둔 slow (한 차로 공사, 출입 통제 건물 앞)
  event: number;                                 // 이어받은 상태 요약 기록의 id (-1 = 없음). 원인으로 잇는다
  dropped: string[];                             // 적용하지 못한 것 (도시가 끊길 통제, 지도 지문 불일치, 명부에 없는 이름) — announceCarry 가 적는다
  stats: { relief: number; serviced: number; reopened: number; markedInc: string[]; fbShort: number; early: number };
}
```

### 2.3 열쇠와 판

| 무엇 | 열쇠 | 이유 |
|---|---|---|
| 대원 | `seat ?? name` | `rid`(=`sim.responders` 의 순번)는 부대 규모 손잡이에 따라 바뀐다(`resources.ts:66` — 편성될 때만 넣는다). 이름은 40명(R1 뒤 63명 + 예비) 모두 다르고 교대가 바뀌어도 그대로다(`sim.test.ts:289,293` 도 이름으로 찾는다) |
| 부대 | `callsign` | 편성표에서 모두 다르다. 지원 부대(`u.aid`)는 넣지 않는다 |
| 건물 | `Place.id` | 도시가 고정이다. 지도(`cityPlan.ts`)를 바꾸면 id 가 달라지므로 `city` 지문으로 확인하고, 다르면 건물·도로를 버린다(대원·부대·재고는 남는다) |
| 도로 | `RoadEdge.id` | 같은 이유 |

- `cityKey(city)`: `hashStr` 로 `places.length`, `edges.length`, 건물마다 `kind`·`x|0`·`y|0`, 구간마다 `a`·`b` 를 차례로 섞은 8자리 16진수. `WeakMap<object, string>`(열쇠 `city.places`)에 한 번만 센다(`incidents.ts:47` 의 `kindCount` 와 같은 꼴).
- **판** `v: 1`. 선택 칸을 더하는 것(R1 의 `kitFault`, 나중의 조직 기억)은 판을 올리지 않는다. 칸의 **뜻**이 바뀌면 판을 올리고 `readCarryover` 에 `v1 → v2` 를 옮기는 함수를 둔다. 옮길 수 없으면 `null`(새 조직으로 시작).
- **지문** `carryKey(co)`: `from` 을 뺀 나머지를 정해진 순서(대원은 열쇠 순, 건물·도로는 id 순, 객체의 칸은 이름 순)로 직렬화해 `hashStr` 한 8자리 16진수. 숫자는 만들 때 소수 넷째 자리로 반올림해 두므로(§3.2 끝) JSON 왕복에서 바뀌지 않는다.

### 2.4 `readCarryover(x, city): { carry: Carryover; dropped: string[] } | null`

입력(저장소에서 읽은 것, 테스트가 만든 것)을 검사하며 **새 객체로** 만든다. 시뮬레이션은 이 결과만 쓰고 원래 입력은 건드리지 않는다.

- 객체가 아니거나 `v` 가 1 이 아니고 옮기는 함수도 없으면 `null`.
- 숫자는 유한한지 보고 범위로 자른다: `out ∈ [-1, 3]`, `health ∈ [1, 100]`, `dExp ∈ [0, EXP_CAP]`, `dSkill ∈ [0, SKILL_CAP]`, `pump ∈ [0, 1]`, `readyAt ∈ [0, 900]`, `dmg·soot ∈ [0, 1]`, `repair ∈ [0, 6]`, `left ∈ [1, 2]`, `openAt ∈ [60, 900]`, 재고 `[0, STOCK_CAP]`.
- `city` 가 `cityKey(city)` 와 다르면 `places`·`roads` 를 비우고 `dropped` 에 '도시 지도가 바뀌어 건물·도로 상태는 이어받지 않습니다.'
- 범위를 벗어난 건물·구간 id, 출동 시설(`facility ≥ 0`)인 건물, 같은 열쇠가 둘인 항목은 버린다(뒤의 것). 명부에 없는 이름은 적용할 때 버린다(§3.4 — 판단에 명부가 필요하다).

---

## 3. 만들기와 적용

### 3.1 흐름과 교대 사이의 시간

```
교대 N (carry = C_N 또는 null) ──▶ 끝(sim.ended) ──▶ makeCarryover(sim) = C_{N+1}
                                                      ├ 끝 상태 읽기 (대원·부대·건물·도로)
                                                      ├ 휴식 한 번 적용 (회복·수리·보충 — §3.2~3.3·§3.5~3.6 의 표)
                                                      └ 상한 (§6)
교대 N+1 = new Sim(seed', d', 1200, { carry: C_{N+1} })  ── 적용 (§3.4~3.6) ── 기록 (§3.7)
```

- **교대 사이의 시간은 "휴식 한 번"으로 고정한다.** 남은 결장·수리·복구는 모두 교대 수로 센다. 교대 시각(`startTod`)과 날씨는 지금처럼 그 교대의 `environment` 흐름이 정한다 — 앞 교대가 밤이었는지에 따라 회복이 달라지지 않는다(결정 — 날씨와 시각을 이어 붙이려면 `environment` 흐름의 뽑기를 바꿔야 하고, 그러면 이어받은 상태가 없는 교대도 결과가 바뀐다).
- `Carryover` 는 **휴식을 이미 반영한** 상태다. 그래서 화면은 저장된 상태만 보고 "다음 교대 결장 2명"을 말할 수 있고, 적용은 그대로 옮기기만 하면 된다.
- **끝난 교대만** 상태를 만든다. 진행 중인 교대를 버리고 새로 시작하면 그 교대는 조직에 남지 않는다(저장된 상태 그대로 다시 시작).
- **이번 교대에 나오지 않은 사람·부대도 휴식은 한다.** 부대 규모 손잡이가 낮아 편성되지 않은 부대, 결장한 대원의 항목은 앞 상태(`sim.carry`)에서 그대로 가져와 휴식만 적용한다. 손잡이를 내렸다 올려도 그 사이의 기록이 사라지지 않는다.

`makeCarryover(sim)` 은 `sim.ended` 일 때만 부른다(아니면 예외). 난수는 `sim.rng.fork('carry')` 하나(복구 시각·정비 시각)와 신임 대원의 `sim.rng.fork('recruit:' + 자리)` 뿐이다 — 부모 시드에서 갈라지므로 몇 번 불러도 같은 결과다. `buildReport` 도 같은 계산을 쓴다(`carryNext` — `from.hash` 만 비워 둔 채).

### 3.2 대원

**끝 상태에서 다음 교대로** (`crewNext`, 지원 대원·예비 인력은 넣지 않는다):

| 이번 교대의 그 사람 | `out` (다음에 빠지는 교대 수) | `health` | 성장 |
|---|---|---|---|
| H1 의 순직(`r.dead`) | −1, `replaceIn = REPLACE_AFTER`(2) | — | 없음 |
| H1 의 병원 인계 + 쓰러진 적 있음(`r.care === 'hospital' && r.tDown ≥ 0`) | 3 | `BACK_HEALTH` 85 | 있음 |
| H1 의 병원 인계 | 2 | 85 | 있음 |
| `injured`, 또는 `down` 인데 병원에 가지 않음 | 1 (`down` 은 2) | 85 | 있음 |
| `ok` | 0 | `min(100, 끝 체력 + REST_HEAL 40)` | 있음 |
| `off`(이번 교대 결장) | 앞 값 − 1 (0 이 되면 나온다) | 앞 값 | 없음 |
| `off`(공석: −1) | −1, `replaceIn` − 1. 0 이 되면 신임 대원(아래) | — | — |
| 이번 교대에 편성되지 않음 | 앞 값 − 1 (최소 0) | 앞 값 | 없음 |

- H1 이 아직 합쳐지지 않았으면 `status` 만 본다: `down` 2, `injured` 1, `ok` 0(순직·병원 없음). 이 표는 H1 §3.7 의 표와 같다 — H1 이 표를 함수로 두었으면(가칭 `outShifts(sim, r)`) 그것을 부르고, 없으면 `persist.ts` 의 `outAfter(sim, r)` 하나로 두고 H1 의 `buildReport` 가 이것을 부르게 바꾼다(같은 표가 두 곳에 있지 않게).
- `cause`: H1 의 `mainCause(r.injuries)`(피해가 가장 큰 원인), H1 전에는 `status` 문자열.
- **성장** (K1): 이번 교대의 `xpGained` 으로
  ```
  gain   = min(GAIN_CAP 0.02, r.xpGained × GAIN_K 0.5) × (1 − r.experience)       // 이미 노련한 사람은 덜 는다
  dExp   = min(EXP_CAP 0.25, 앞 dExp + gain)
  dSkill = min(SKILL_CAP 0.15, 앞 dSkill + gain × SKILL_K 0.6)
  shifts += 1, incidents += r.incidentsWorked
  ```
  측정(§1.2)으로 보면 활발한 대원이 교대당 0.01~0.02 쯤, 열 교대에 0.05~0.15 쯤 는다. **(확인 필요: R1·H1 뒤 `xpGained` 의 분포를 다시 재고 `GAIN_K` 를 정한다. 목표는 "열 교대 뒤 가장 많이 큰 대원의 경험 +0.15 안팎")**
- **신임 대원**: 공석의 `replaceIn` 이 0 이 되는 휴식에서, 그 항목을 신임 대원으로 바꾼다: `name` = `RECRUIT_NAMES` 에서 아직 쓰지 않은 첫 이름(모두 쓰면 이름 뒤에 숫자), `seat` = 원래 자리 이름, `recruit` = `sim.rng.fork('recruit:' + 자리)` 에서 `createRoster` 와 같은 식(경험 0.1~0.3, `st()` 범위 0.3~0.85)으로, `out 0`, `health 100`, `dExp·dSkill·shifts·incidents 0`. `RECRUIT_NAMES` 는 `NAMES`·`EXTRA_NAMES`(R1)·`AID_NAMES`·`RELIEF_NAMES` 와 겹치지 않는 가상의 이름 24개(`persist.ts` 안).
- (R1 뒤) `kitFault`: 이번 교대에 고장이었던 개인 장비 가운데 **드러난 것**(`faultKnown`)은 점검에서 고친다(넣지 않는다). 드러나지 않은 것은 점검에서 절반을 찾는다 — `hashStr(seat + ':' + kitId + ':' + shift) % 2 === 0` 이면 고치고, 아니면 `kitFault` 에 남긴다(난수 흐름을 쓰지 않는다).

**다음 교대에 적용** (`applyCrewCarry`, `createRoster` 가 모든 난수를 뽑고 대원·부대를 만든 **뒤**):

1. 대원마다 열쇠(`r.seat ?? r.name`)로 항목을 찾는다. 없으면 그대로(새 사람).
2. 신임 대원 항목(`recruit` 가 있다)이면 그 자리(`seat` 이름의 대원)를 **같은 rid 그대로** 신임 대원으로 바꾼다: `name`, `seat`, 기본 능력 여섯 개, `skills = skillsFor(def, skill)`, `trait = traitOf(r)`. 같은 rid 를 쓰므로 `sim.responders` 의 순서와 현장 개체 흐름(`agent:<사건>:<rid>`)의 이름이 그대로다.
3. 성장: `experience = min(0.97, 기본 + dExp)`, `skill = clamp(기본 skill + dSkill, 0.3, 0.98)`, `judgment = clamp(기본 + 0.35 × dExp, 0.2, 0.98)`(`createRoster` 의 식에서 경험의 몫), `skills = skillsFor(def, skill)`, `trait = traitOf(r)`. `createRoster` 의 분야별 숙련 식(`resources.ts:80-84`)을 함수 `skillsFor(kind, dept, skill)` 로 꺼낸다(결과 그대로 — 0단계 해시 목록으로 확인).
4. `out > 0` 또는 `out === −1` 이면 `status = 'off'`, `carryOut = out`, `carryCause = cause`, `stamina = tn.startStamina`(배정의 평균 지구력 감점이 결장자 때문에 두 번 깎이지 않게 — `dispatcher.ts:75` 는 고치지 않는다). 아니면 `health = 항목의 health`.
5. **결장 상한**(§6): 편성된 대원 가운데 `off`(공석 제외)가 `ABSENT_CAP` 을 넘으면, 남은 결장이 짧은 사람부터(같으면 이름 순) 넘는 만큼 `status 'ok'`, `health EARLY_BACK_HEALTH 70` 으로 되돌린다('조기 복귀', `stats.early++`).
6. **예비 인력**: 부대 순서(`sim.units`)대로, 정비 중이 아니고 `crewReady(u) < need`(R1 의 `minCrew(u.kind)`, R1 없이 1)인 부대에 `RELIEF_MAX`(4명) 안에서 예비 인력을 한 명씩 붙인다: `sim.rng.fork('relief:' + u.callsign)` 에서 `createAidUnit` 의 식(경험 0.15~0.4)으로, 이름은 `RELIEF_NAMES`(가상의 이름 8개) 차례로, `relief: true`, `sim.responders` 와 `u.crew` 끝에 넣는다(지원 부대처럼 — 기존 rid 는 그대로). 채우지 못하면 `u.state = 'oos'`, `u.oosWhy = '결원'`(이번 교대 내내).
7. (R1 뒤) `kitFault` 의 장비는 R1 의 `kit` 고장 추첨(`kit` 흐름 — 그대로 다 뽑는다) **뒤에** `fault = true` 로 더한다.

**`status 'off'` 가 지나가는 곳** — 이미 `status === 'ok'` 를 보는 곳은 저절로 뺀다: `crewReady`(`resources.ts:166`), `unitArrived` 의 내리는 사람(`sceneManager.ts:61`), 지구력 회복(`resources.ts:326`). 고쳐야 하는 곳은 셋뿐이다:
- `debrief.buildReport` 의 `respondersHurt`(`debrief.ts:185`): `status !== 'ok' && status !== 'off'`.
- `resources.dispatchUnit` 의 출동 준비 시간(`resources.ts:236`)이 `u.crew[0]` 의 경험을 본다 → `u.crew.find((rid) => sim.responders[rid].status !== 'off') ?? u.crew[0]`. 이어받은 상태가 없으면 `off` 가 없으므로 결과가 같다(`injured` 를 거르지 않는 것은 일부러다 — 지금 결과를 지킨다).
- H1 의 명부 출력(`ShiftReport.roster`)에서 `off` 인 대원의 `out` 은 `crewNext` 의 값.

결원 부대는 지금 규칙 그대로 배정에서 −18(`crewReady < crew.length`, `dispatcher.ts:78`), 모두 `off` 면 `crewReady` 0 이라 배정에서 빠진다(`dispatcher.ts:60`) — 관제 코드는 고치지 않는다. 결원은 조직이 아는 사실이라 정보 격리에도 맞다.

### 3.3 장비

| 무엇 | 끝 상태 → 다음 교대 (휴식 한 번) | 적용 |
|---|---|---|
| 펌프 (`pumpCond`) | 이번 교대에 펌프가 고장 난 적이 있으면 `service = { readyAt: carry 흐름 range(300, 720), why: 'pump' }`, `pump = 0.7`(정밀 정비). 아니면 `pump = min(1, 끝 값 + PUMP_REST 0.12)`(점검). 고장 여부는 끝의 `pumpFailed` 로 알 수 없다 — 서로 돌아오면 0.55, 현장 보급이면 0.62 로 고친 채 `false` 가 된다(`resources.ts:312`, `executor.ts` `case 'resupply'`). 그래서 기록에서 센다: `problem === 'EQUIP_FAIL'` 이고 `text` 가 `${u.callsign} 펌프` 로 시작하는 기록(지금 `executor.ts:254` 하나뿐 — R1 이 고장 문구를 바꾸면 따라 고친다). 끝에 `pumpFailed` 인 채면(돌아오지 못하고 끝남) 그것도 고장으로 친다 | `createRoster` 가 `equipment` 흐름에서 지금처럼 뽑은 **뒤에** `u.pumpCond = clamp(pump, tn.pumpMin, tn.pumpMax)` — 장비 손잡이는 범위를, 이어받은 상태는 그 안의 위치를 정한다. 항목이 없으면 뽑은 값 그대로 |
| 정비 (`service`) | 정비 중인 채로 끝난 부대(교대 내내 편성되지 않아 정비하지 못한 경우 포함)는 휴식에서 정비를 마친다(넣지 않는다) | `u.state = 'oos'`, `u.readyAt`, `u.oosWhy = '정비 중'`. 한꺼번에 `SERVICE_CAP`(2대)까지 — 넘는 것은 `readyAt` 이 이른 순으로 남기고 나머지는 '급히 정비 완료'(`pump 0.6`, 바로 운용). `tickCarry` 가 `readyAt` 에 운용으로 돌린다(§3.7) |
| 섬광탄 (`stock.flashbang`) | `창고 = min(STOCK_CAP 10, 교대 시작 때 지급하고 남은 창고 + 부대에 남은 섬광탄 + RESUPPLY 3)` | 기동·특공 부대에 편성표 순서대로 정수(기동 `tn.flashbangs`, 특공 `+2`)만큼 창고에서 지급한다. 창고가 모자라면 있는 만큼, 단 정수가 1 이상인 부대는 적어도 1개(비상 지급 — 창고에서 빼지 않는다). 모자란 수는 `stats.fbShort`. 이어받은 상태가 없으면 지금처럼 정수 그대로 |
| 물·공기·헬기 연료·공구·처치 장비·방호 | 이어받지 않는다(서에서 채운다 / 손잡이 값) | — |
| (R1 뒤) 개인 장비 고장 | §3.2 의 `kitFault` | §3.2 의 7 |
| 차량 손상 | 지금도 X6 초안에도 없다. 나중에 차량이 다치는 모델이 생기면 `service = { readyAt: …, why: 'vehicle' }` 로 받는다 | 펌프 정비와 같다 |

창고의 처음 값(이어받은 상태가 없는 교대가 만든 상태)은 `STOCK_CAP` 에서 시작한 것으로 센다: `창고 = min(10, 10 − 처음 지급 + 남은 수 + 3)`. 보통에서 기동 2·특공 4 를 지급하고 2개를 쓰면 다음 교대의 창고는 다시 10 이다(`4 + 4 + 3` → 10). 지급한 여섯 개를 다 쓰는 교대가 두 번 이어지면(창고 10 → 7 → 4) 세 번째 교대에서 특공이 2개 덜 받는다 — 조용한 교대 한 번이면 회복된다.

### 3.4 적용의 자리와 순서 (`engine.ts` 생성자)

```ts
constructor(seed, difficulty = NORMAL, shiftLen = 1200, extra: { force?: string | null; carry?: Carryover | null } = {}) {
  … // force · seed · difficulty · tune · shiftLen · hardCap · rng · fork 다섯 · 날씨 · startTod — 지금 그대로
  this.city = generateCity(new Rng(CITY_SEED));
  const rc = extra.carry ? readCarryover(extra.carry, this.city) : null;
  this.carry = rc ? rc.carry : null;
  this.carryState = initCarry(this, rc?.dropped ?? []);     // ① 건물 겹침 표, 도로 복구 통제 — initTraffic 앞
  this.traffic = initTraffic(this);
  createRoster(this);
  applyCrewCarry(this);                                      // ② 대원·부대·재고 — createRoster 의 난수를 다 뽑은 뒤 값만 바꾼다
  this.gen = initGenerator(this.rngGen);
  this.gen.majorAt = …;                                      // 그대로
  this.disaster = initDisaster(this);
  emit(this, { … '교대 시작. …' });                          // 문구 그대로
  announceCarry(this);                                       // ③ 이어받은 상태의 기록 — carry 가 있을 때만
}
step(): … tickTraffic(this); tickCarry(this); tickDisaster(this); …   // tickCarry 는 할 일이 없으면 첫 줄에서 돌아간다
```

- **①이 `initTraffic` 앞인 이유**: 불법 주차를 놓을 때 큰 차의 우회로를 실제 상태로 본다(`traffic.ts:98-140` 의 `linked`·`heavyPath` 는 이유와 상관없이 `e.closed` 를 막힌 것으로 본다). 복구 통제가 먼저 있어야 그것을 피해 놓는다. 처음 혼잡(`cong`)은 기준값으로만 정하므로(`traffic.ts:302`) 영향이 없고, 밀림(`queue`)은 첫 주기부터 통제를 본다.
- **②가 `createRoster` 뒤인 이유**: `roster-v1`(고정)·`equipment`(교대) 흐름의 뽑기 횟수를 그대로 두고 값만 바꾼다. 예비 인력은 맨 끝에 붙으므로 기존 rid 가 그대로다.
- **③이 '교대 시작' 기록 뒤인 이유**: 첫 기록은 언제나 '교대 시작'이고, 그 문구는 그대로다(부대 수·대원 수에는 결장·예비가 들어간 수가 그대로 찍힌다 — 다음 줄이 내역을 말한다).
- `initGenerator`·`majorAt`·`initDisaster` 는 이어받은 상태를 읽지 않는다. 재난 무작위 추첨도 그대로.
- `persist.ts` 는 맨 위에서 다른 모듈의 표(상수)를 읽지 않는다. `resources.ts` 의 함수(`crewReady`·`skillsFor`·`traitOf`)는 부를 때만 쓴다 — `resources → sceneManager → … → persist → resources` 순환이 생겨도 함수 호출은 괜찮지만, 맨 위의 표 읽기는 초기화 전의 값을 읽는다(CLAUDE.md 의 시나리오·추격전 함정과 같은 꼴). 섬광탄 정수는 `u.kind` 와 `tn.flashbangs` 로 계산한다(표를 import 하지 않는다).

### 3.5 도로

**끝 상태에서** (`roadsNext`):

| 원천 | 조건 | `why` | `lane` | `left` | `openAt` |
|---|---|---|---|---|---|
| 앞에서 이어받은 것 | `left === 2` | 그대로 | 그대로 | 1 | carry 흐름 range(120, 600) |
| 재난이 교대 끝까지 막고 있던 구간 (`d.leftover`, 아래) | 지진 균열(`timed` 에 남은 것) | `crack` | 전면 | 1 | `clamp(남은 초, 120, 600)` |
| 〃 | 해일이 덮친 해안 구간 | `washout` | 전면 | 1 | range(240, 600) |
| 〃 | 홍수로 잠긴 구간 | `flood` | 전면 | 1 | range(120, 300) |
| 〃 | 산불이 번진 구간 | `fire` | 전면 | 1 | range(120, 300) |
| 〃 | 태풍 | — | — | — | (지금 태풍은 도로를 닫지 않는다 — 생기면 `debris`) |
| 산사태 흙더미 (`variant 'landslide'`) | 사건이 `resolved` 가 아닌 이유로 닫힘(흙더미를 다 치우지 못함) | `mud` | 전면 | 1 | range(300, 600) |
| 쓰러진 나무 (`variant 'tree'`) | 〃 | `tree` | 전면 | 1 | range(60, 240) |
| 다중 추돌 (`variant 'pileup'`) | 끝난 이유와 상관없이 — 노면·방호벽 보수 | `surface` | 한 차로 | 1 | range(300, 900) |
| 무너진 건물의 잔해가 길을 덮음 | X6 초안에는 없다(무너짐은 현장 안의 일). 나중에 생기면 이 줄로 받는다 | `debris` | 전면 | 2 | — |

- 사건의 구간은 `I.blockedEdge` 로 찾는다 — `closeIncident` 는 통제를 풀어도 `I.blockedEdge` 를 지우지 않는다(`incidents.ts:211-215`). 끝난 이유는 `I.closeReason`.
- **재난의 남은 통제 기록**: `disaster.ts` `finish(sim, d, cut)` 의 맨 앞, `cut` 일 때만 `d.leftover = d.closedEdges.map((id) => ({ edge: id, why: …, remain: (d.timed.find((q) => q.edge === id)?.until ?? sim.t) − sim.t }))` 한 줄(`DisasterState` 에 선택 칸 `leftover?`). 기록만 한다 — 난수·`emit` 없음, 결과 불변. `why` 는 `d.kind`(quake → crack, tsunami → washout, flood → flood, wildfire → fire).
- 같은 구간이 둘이면 `left`·전면 쪽이 큰 것을 남긴다. 상한 `ROAD_CAP`(6구간) — 넘으면 `openAt` 이 이른 것부터 남긴다.

**다음 교대에 적용** (`initCarry` 의 도로 부분, `initTraffic` 앞):

1. `openAt` 순으로(같으면 구간 id 순) 하나씩:
   - 전면 통제: **실제 상태에서** 큰 차가 그 구간 없이 양 끝을 오갈 수 있을 때만(`persist.ts` 의 `linkedHeavy(sim, a, b, skip)` — 그 구간과 이미 닫힌 구간을 빼고 너비 우선. T1 의 `linked` 와 같은 뜻이고 불법 주차는 아직 없다) `e.closed = true; e.closedReason = 'repair'`(`known` 은 두지 않는다 — 알려진 통제). 끊기면 놓지 않고 `dropped` 에 '…: 통제하면 길이 끊겨 복구 공사를 미룹니다.' 그 항목은 이번 교대에는 없는 것으로 보고, 끝날 때 만들어지는 상태에도 넣지 않는다(공사를 미루다 끝냈다고 본다 — 끊긴 채 남는 길이 없다).
   - 한 차로: `e.slow += LANE_SLOW 0.6`, `slowed` 에 적는다.
2. `left === 1` 인 것은 `carryState.roads` 에 둔다(`tickCarry` 가 `openAt` 에 연다).
3. **출입 통제 건물 앞**: `closed`·`ruin` 인 건물의 `edgeId` 가 있으면 그 구간에 `slow += 0.4`('복구 공사 차량') — 교대 내내. 같은 구간에 여럿이면 한 번만.

이렇게 놓은 통제는 모두 "알려진 통제"라 `findRoute`·`etaFor`·관제가 처음부터 피하고, 사건의 통제(`incidents.ts:137-141`, `sceneManager.ts:220-222`, 대형·재난 시나리오의 `onCreate`)·재난의 통제(`closeEdge` 의 `detour`)·교통의 장애물(`place` 의 `linked`)은 모두 이미 닫힌 구간을 막힌 것으로 보고 우회로를 확인한다 — 새로 끊기는 길이 생기지 않는다(T1 구현 메모의 "사건의 통제끼리만 겹쳐 생기는 끊김"은 지금처럼 남는다).

### 3.6 건물

**끝 상태에서** (`placeOutcome(sim, I)` — 이번 교대에 닫힌 사건마다, `I.truth.placeId ≥ 0` 이고 출동 시설이 아닐 때. 진실을 읽는 유일한 곳):

| 원천 | 조건 | `state` | `dmg` | `soot` | `repair` | `cause` |
|---|---|---|---|---|---|---|
| X6 `placeMarks` 의 `collapsed` (전체 붕괴) | X6 가 있으면 이 다섯 줄이 먼저다 | ruin | 1 | 0 | 4 | collapse |
| X6 `burnt` (전소 — 탄 비율 ≥ 0.7) | 〃 | closed | 0.8 | 1 | 5 | burnout |
| X6 `partial` (구획 붕괴) | 〃 | closed | `max(0.3, ruinFrac × 2)` | `burnFrac` | 2 | collapse |
| X6 `blasted` (폭발 흔적) | 〃 (가스 폭발 대형 사고면 `repair` 3, `dmg` 0.6) | closed | 0.35 | 0.3 | 1 | blast |
| X6 `scorched` (그을림 — 닫힌 화재의 탄 비율 ≥ 0.15) | 〃 | marked | `0.5 × burnFrac` | `min(1, burnFrac × 2)` | 0 | fire |
| 화재 (`s.kind === 'fire'`) | 소실률 `loss = s.burnedTiles / max(1, s.totalFuelTiles)`(판정의 `propertyLoss` 와 같은 식, `debrief.ts:39`) ≥ 0.6 | closed | `0.4 + 0.5 × loss` | `min(1, loss × 1.5)` | 3 | fire |
| 〃 | 0.25 ≤ loss < 0.6 | closed | `0.5 × loss` | `loss × 1.5` | 1 | fire |
| 〃 | 0.05 ≤ loss < 0.25 | marked | `0.5 × loss` | `loss × 2` | 0 | fire |
| 붕괴 (`s.kind === 'collapse'`, 승강기 갇힘 제외) | 2차 붕괴가 있었다(`I.problems` 에 `ESCALATION`) 또는 `frac ≥ 0.22` | ruin | 1 | 0 | 4 | collapse |
| 〃 | 그 밖에 잔해 칸이 있다 | closed | `min(1, frac × 2)` | 0 | 2 | collapse |
| 폭발 | 터진 가스 용기·폭발물(`p.exploded`) 또는 불붙은 배관(`kind 'valve' && p.ignited`) | closed | 0.35 | 0.3 | 1 | blast |
| 가스 폭발 대형 사고 (`variant 'gasblast'`) | 언제나 | closed | 0.6 | 0.4 | 3 | blast |
| 그 밖의 불붙은 소품 (`ignited` — 판정이 재산 피해 0.4 로 세는 것) | | marked | 0.2 | 0.4 | 0 | fire |

- `frac` = `s.damage` 가 1 인 칸 수 / 건물 칸 수(`FLOOR·FURN·DOOR·STAIR·WALL·WINDOW`). G4 §5.3 의 `ruinInfo.frac` 와 같은 식, 0.22 도 G4 의 `'major'` 기준과 같다. G4 의 기록(`s.ruin`·`s.falls`)은 "시뮬레이션이 읽지 않는다"는 G4 의 원칙 때문에 읽지 않는다 — 2차 붕괴는 `ESCALATION` 문제로 안다.
- `spot` = 잔해 칸 무게중심의 건물 칸 경계 상자 안 상대 위치(소수 둘째 자리). 무너진 것만.
- 한 사건에 여러 행이 맞으면 `state` 가 무거운 것(ruin > closed > marked), `dmg`·`soot`·`repair` 는 각각 큰 값.
- `inc` = `조직 ${shift}번째 교대 · ${I.code} ${scenarioName}`.
- X6 가 있으면: `placeMarks` 에 있는 건물은 위 다섯 줄로 정하고, 없는 건물(X6 가 표시하지 않은 작은 피해)만 아래 줄들로 본다. 화재의 `closed` 두 줄(소실률 0.25 이상)은 X6 뒤에도 쓴다 — X6 의 `scorched`·`burnt` 사이(0.25~0.7)를 받는다. `PlaceCarry.mark` 에 X6 의 상태를 남겨 지도가 X6·G4 의 그림을 고르게 한다(§5.4).
- X6 가 없으면(대체): 아래 줄들만.

**휴식 한 번** (앞에서 이어받은 건물과 이번 교대의 새 피해를 합친 뒤):
- 새 피해와 앞 상태가 같은 건물이면 무거운 쪽 `state`, 큰 값의 `dmg`·`soot`·`repair`, `since` 는 앞의 것.
- 이번 교대에 생긴 것이 아니면 `repair −= 1`. `repair` 가 0 이 되면 `state = 'marked'`, `dmg ×= 0.4`, `soot ×= 0.5`, `opened = true`.
- `marked` 는 `soot −= 0.25`, `dmg −= 0.15`. 둘 다 0.05 아래면 지운다.
- 이번 교대에 생긴 것은 깎지 않는다("화재 다음 교대에 출입 통제 1교대"가 그 교대 동안 정확히 1이 되게 — `repair` 는 "남은 교대, 이번 교대 포함").
- 상한(§6): 항목 `PLACE_CAP` 24, 그 가운데 `closed`·`ruin` 은 `CLOSED_CAP` 12.

**다음 교대에 겹쳐 읽기** — `city.places` 는 고치지 않는다. 모든 곳이 `placeCond(sim, id)`(`carryState.places.get(id) ?? null`)와 `placeUsable(sim, id, allowClosed = false)` 를 부른다:

| 곳 | 무엇을 | 고칠 자리 |
|---|---|---|
| 사건 장소 고르기 | `weigh` 에서 `!placeUsable(sim, q.id)` 이면 0 — 엄격·느슨 두 단계 모두. 둘 다 고를 곳이 없으면 **셋째 단계**: 느슨한 조건에 `allowClosed = true`(출입 통제 중인 건물은 허용, 무너진 건물은 끝까지 안 된다). 손상된 건물(`marked`)의 가중치: 붕괴 `× (1 + 3 × dmg)`, 가스 누출 `× (1 + dmg)`, 그 밖 그대로 | `incidents.ts` `pickPlace`(49-67) |
| 정해 준 건물 | `opts.placeId` 가 무너졌거나 출입 통제 중이면 그 건물을 버리고 `pickPlace` 로 고른다(같은 `rng`) — 연쇄 방화의 다음 대상, 은신처 제보, 재난, 시험 모두 이 한 곳으로 막힌다 | `incidents.ts` `createIncident` 의 `place` 줄(103) |
| 재난의 장소 고르기 | `ws` 에서 `!placeUsable` 이면 0 (재난이 무너진 건물을 다시 고르지 않게 — 위의 되돌림보다 먼저, 재난의 가중치로) | `disaster.ts` `pickPlace`(355-362) |
| 연쇄 방화의 다음 대상 | `pool` 에서 `placeUsable` 인 것만 | `scenarios/crime.ts` `arsonNext`(43-44) |
| 현장 생성 | `createScene` 끝에서 `applyPlaceWear(sim, s, I)` — 아래 | `field/sceneManager.ts` `createScene`(23-27) |
| 사건 발생 기록 | `I.rootEvent` 기록 바로 뒤 `noteWearIncident(sim, I)` — 아래 | `incidents.ts` `createIncident`(150 뒤) |
| 지도 그림·마우스 정보 | §5.4 | `view/city/carryLayer.ts`, `renderCity.ts` |

`applyPlaceWear(sim, s, I)`: 그 건물의 `placeCond` 가 있으면 `s.wear = { dmg, soot, cause, inc }`. 그을음이 있으면(`soot > 0`) 실내 바닥 칸의 `s.fuel *= 1 − 0.4 × soot`(이미 탄 것은 덜 탄다 — 난수 없음, `totalFuelTiles` 는 그대로). 그 밖의 현장 내용은 바꾸지 않는다 — 평면은 사건마다 다르므로(§1.2) 칸 단위 피해를 옮기지 않고 요약값만 쓴다. 그을음은 그림(`staticLayer` 의 바닥·벽 얼룩, `staticSig` 에 `s.wear?.soot` 를 넣는다)으로 보이고, 손상은 X6 의 구획 건전도 처음 값을 낮춘다(§7).

`noteWearIncident(sim, I)`: `dmg ≥ 0.1` 또는 `soot ≥ 0.2` 이면 `emit({ inc: I.id, role: 'SYSTEM', actor: '도시', kind: 'incident', imp: 1, truth: true, causes: [cs.event], text: \`이 건물은 ${inc}로 ${soot ≥ 0.2 ? '그을리고 ' : ''}손상된 상태였습니다 (구조 손상 ${pct(dmg)}).\` })`, `stats.markedInc.push(I.code)`. 관제는 신고 위치가 맞으면 이 사실을 안다고 본다 — 출동 브리핑(`briefFacts`)에 사실 하나를 더하는 것은 X6·R3 와 함께 정한다(§7).

### 3.7 기록 (`announceCarry`, `tickCarry`)

`announceCarry(sim)` — '교대 시작' 바로 뒤, 이어받은 상태가 있을 때만. 모두 `role 'SYSTEM'`(부대 줄은 `'UNIT'`), 원인은 첫 줄:

1. 요약(`actor '상황실'`, `kind 'shift'`, `imp 2`) → `carryState.event`:
   `지난 교대에서 이어받은 상태 — 조직의 ${shift}번째 교대 (지문 ${carryKey}). ${parts.join(' · ') || '남은 피해 없음'}.`
   `parts`: `결장 ${a}명` · `공석 ${f}자리` · `정비 중 ${s}대` · `출입 통제 건물 ${c}곳`(무너짐이 있으면 `(무너짐 ${r})`) · `복구 공사 도로 ${d}구간` · `숙련이 오른 대원 ${g}명`. 0 인 것은 뺀다.
2. 결장(부대마다 한 줄, `actor` 호출부호, `kind 'unit'`, `imp 1`): `${josa(이름들, '이/가')} 결장합니다 (${원인 이름} · ${n}교대 남음).` 공석: `순직한 ${이름} 대원의 자리가 비어 있습니다 (신임 배치까지 ${n}교대).` 신임이 처음 오는 교대: `신임 ${이름} 대원이 ${자리 이름} 대원의 자리에 배치됐습니다.` 원인 이름은 H1 의 `CAUSE_NAME`(H1 전: '부상' · '중상').
3. 조기 복귀: `결장 대원이 많아 ${이름} 대원이 경상으로 일찍 복귀합니다.`
4. 예비 인력: `${호출부호} 대원 전원 결장 — 본부 예비 인력 ${이름} 대원이 대신 탑니다.` / `${호출부호} 결원으로 이번 교대 운용 중단 (예비 인력 없음).`
5. 정비: `${호출부호} 펌프 정비 중 — 약 ${분}분 뒤 운용.`
6. 재고: `섬광탄 재고 부족 — ${호출부호} ${n}개만 지급 (정수 ${m}개).`
7. 건물(`closed`·`ruin` 만, `repair` 가 큰 순으로 4줄, 넘으면 `외 n곳`): `${이름} — ${inc}로 ${ruin ? '무너져 출입할 수 없습니다' : '복구 공사 중이라 출입을 통제합니다'} (${repair}교대 남음).` 통제가 풀린 건물(`opened`): `${이름} 복구 완료 — 다시 문을 열었습니다.`
8. 도로(`actor '교통정보'`, `kind 'traffic'`): `${edgeName} 복구 공사로 통제 — ${WHY_NAME[why]} (${left === 1 ? \`약 ${분}분 뒤 개통\` : '이번 교대 내내'}).` 한 차로: `${edgeName} 한 차로 복구 공사 — 서행.`
9. `dropped` 의 문장들(`imp 0`).

`tickCarry(sim)` — 매 틱, `on` 이 아니거나 남은 일(정비 중 부대·남은 복구 공사)이 없으면 첫 줄에서 돌아간다:
- `u.state === 'oos' && u.readyAt !== undefined && sim.t ≥ u.readyAt`: `u.readyAt = undefined`. `crewReady(u) ≥ need` 면 `u.state = 'available'; u.oosWhy = undefined`, `emit({ role: 'UNIT', actor: 호출부호, kind: 'unit', imp: 1, causes: [cs.event], text: \`${호출부호} 정비 완료 — 운용 재개.\` })`, `stats.serviced++`. 아니면 `oosWhy = '결원'`.
- `carryState.roads[0]` 의 `openAt ≤ sim.t` 이고 그 구간의 `closedReason === 'repair'` 면 `closed = false; closedReason = null`, `emit({ role: 'SYSTEM', actor: '교통정보', kind: 'traffic', imp: 1, causes: [cs.event], text: \`${edgeName} 복구 공사 완료 — 통행 재개.\` })`, `stats.reopened++`. 한 차로 공사는 `slow` 를 되돌린다(`slowed` 에서 빼고 `Math.max(0, e.slow − v)`).
- 교대가 끝난 뒤(`sim.ended`)에도 돌지만 할 일은 `openAt ≤ 900` 이라 이미 끝나 있다.

---

## 4. 재현성

### 4.1 같은 입력 = 같은 결과

- **입력**: 시드 + 난이도 + `Carryover`. `readCarryover` 가 검사하며 새 객체로 만들어 쓰므로 호출하는 쪽이 같은 객체를 다시 넘겨도(되감기) 결과가 같다.
- **JSON 왕복**: 숫자를 만들 때 소수 넷째 자리로 반올림해 둔다(`round4`). JS 의 수 → 문자열 → 수는 원래 값과 같으므로 반올림이 꼭 필요하지는 않지만, 저장 크기를 줄이고 지문이 사람 눈에 안정적이게 한다. 테스트: `new Sim(s, d, len, { carry: co })` 와 `{ carry: JSON.parse(JSON.stringify(co)) }` 의 `report.hash` 가 같다.
- **난수 흐름** (새로 더하는 것만):

| 흐름 | 쓰는 곳 | 비고 |
|---|---|---|
| `carry` (교대) | `makeCarryover`: 복구 시각 `openAt`, 정비 시각 `readyAt` | 교대가 끝난 뒤에만. 그 교대의 결과에는 영향이 없다 |
| `recruit:<자리>` (교대) | 신임 대원의 기본 능력 | 공석이 채워지는 휴식에서 한 번 |
| `relief:<호출부호>` (교대) | 예비 인력의 능력 | 적용할 때 |

  기존 흐름(`roster-v1`·`equipment`·`traffic`·`parked`·`scene:<사건>`·`agent:<사건>:<rid>` …)의 호출 수와 순서는 그대로다. 단 이어받은 상태가 있으면 사건 장소(가중치·제외)와 통제된 도로가 달라지므로 그 뒤의 전개가 달라지는 것은 당연하다 — "이어받은 상태가 결과를 바꾼다"가 이 묶음의 목적이다.

### 4.2 기록 해시와 지문

- 기록 해시는 문장만 섞는다(`events.ts:22-26`). 그래서 이어받은 상태가 있으면 **요약 첫 줄에 지문을 넣는다**(§3.7 의 1). 내용이 조금이라도 다른 상태(예: 경험 +0.001)는 지문이 달라 해시가 달라지고, 같은 상태면 같다.
- 이어받은 상태가 **없으면** 요약 줄을 남기지 않는다 → 지금과 해시가 같다. `{ carry: null }` 과 `{}` 와 인자 없음은 모두 같다.
- 보고서에도 `carry.key`(지문)와 `carry.shift` 를 남긴다. 화면 보고서 머리의 "기록 해시" 옆에 "조직 #n · 지문 …".

### 4.3 되감기·새로고침 복원·같은 시드 재실행

- 교대 **안**에서는 지금과 같다: 되감기는 같은 입력(시드·난이도·**이어받은 상태**)으로 처음부터 그 틱까지 다시 돌린다. 그래서 `Runner` 는 지금 교대의 입력 `carryIn` 을 들고 있고 `make()` 가 늘 그것을 넘긴다(§5.3).
- 새로고침 복원은 `ar.current.v1` 에 저장된 입력(이어받은 상태 포함)으로 다시 돌린다.
- **"같은 시드 재실행"은 "같은 입력으로 다시 보기"다.** 방금 끝난 교대의 **입력**을 그대로 쓴다(출력을 이어받지 않는다). 조직 저장소를 고치지 않는다(§5.3). "다음 교대(이어서)"가 출력을 이어받는 버튼이다.

---

## 5. 화면

### 5.1 원칙

- 고르는 것은 교대 시작 전 조건뿐: **새 조직으로 시작 / 이어서 시작**, 그리고 **저장된 조직 지우기**. 이어받은 내용을 고치는 화면은 만들지 않는다.
- 진행 중인 교대에는 아무것도 적용되지 않는다(난이도 창의 안내문과 같은 결).
- 지도·목록에 글자 표식을 쓰지 않는다(CLAUDE.md). 새 기호는 범례에 넣는다.
- 이어받은 상태는 조직이 아는 기록이라 **관찰자 시점과 AI 시점에 똑같이** 보인다.

### 5.2 고르는 자리

- **난이도 창** (`panels.tsx` `DifficultyPanel`, 496-549): 재난 줄 아래에 "조직" 줄 — 칩 둘.
  - `이어서 시작` — 저장된 조직이 있을 때만 누를 수 있다. 칩 아래 한 줄: `조직의 8번째 교대 · 결장 2명 · 정비 1대 · 출입 통제 건물 3곳 · 복구 공사 도로 1구간`(`carrySummary`). 저장된 조직이 없으면 `저장된 조직 없음 — 이 교대가 끝나면 저장됩니다`. 읽지 못했으면(판이 다르거나 깨짐) `저장된 조직을 읽지 못했습니다 — 새 조직으로 시작합니다`.
  - `새 조직으로 시작` — 칩 아래: `모든 대원이 처음 상태로 시작합니다. 이 교대가 끝나면 저장된 조직(8번째 교대)을 대신합니다.`
  - 오른쪽 끝에 작은 `저장된 조직 지우기`(확인 한 번).
  - 선택은 `settings.org: 'continue' | 'fresh'`(기본 `'continue'`)로 저장한다. "이 조건으로 새 교대 시작"이 이 선택을 따른다. "같은 시드(…)로 시작"은 비교 실행(§5.3 replay)이다 — 버튼 옆 안내에 `지금 교대와 같은 조직 상태로` 를 붙인다.
- **상단 띠** (`TopBar`): 난이도 칩 옆에 조직 칩 하나 — `조직 #8`(이어받은 교대) / `새 조직`. 마우스를 올리면 요약 한 줄, 누르면 난이도 창. 그림 기호는 `marks.ts` 에 `ORG_MARK`(사람 셋 실루엣) 하나. "새 교대" 버튼은 `settings.org` 를 따르고, "같은 시드 재실행"은 replay.
- **보고서** (`ReportModal`): 머리 버튼을 `다음 교대 (이어서)`(주 버튼 — 이 교대가 조직을 저장했을 때만), `새 조직으로 새 교대`, `같은 시드 재실행`, `닫고 마지막 상태 보기` 로.

### 5.3 저장 (`view/runner.ts` — 표현 계층)

| 키 | 내용 | 비고 |
|---|---|---|
| `ar.org.v1` (새로) | `{ id: string; carry: Carryover; savedAt: number }` | 저장된 조직. `id` 는 조직의 계보(새 조직을 시작할 때 `randomSeed()` 로 만든다 — 표현 계층이라 `Math.random` 허용) |
| `ar.current.v1` (칸 추가) | `{ seed, tick, diff, carry?: Carryover \| null, org?: string, write?: boolean }` | 지금 교대의 **입력**. 새로고침 복원이 그대로 쓴다 |
| `ar.history.v1` (칸 추가) | `HistoryItem` 에 `shift?: number` | 보고서의 "이전 교대 기록"에 `#8` |

`Runner` 의 새 칸: `carryIn: Carryover | null`(지금 교대의 입력), `orgId: string | null`, `writeOrg: boolean`, `orgMem: { id; carry } | null`(저장소가 안 될 때 이 창이 열려 있는 동안만 쓰는 사본).

- `make(seed, d)` 는 `new Sim(seed, d, 1200, { force: this.force, carry: this.carryIn })`. 되감기(`seek`)·복원·새 교대 모두 이 함수를 지난다.
- `newShift(seed?, difficulty?, mode: 'continue' | 'fresh' | 'replay' = 설정값)`:
  - `continue`: `saved = readOrg()`(`lsGet` → `readCarryover` 로 판·모양 검사. 실패면 `null`). `carryIn = saved?.carry ?? null`, `orgId = saved?.id ?? 새 id`, `writeOrg = true`.
  - `fresh`: `carryIn = null`, `orgId = 새 id`, `writeOrg = true`.
  - `replay`: `carryIn`·`orgId` 는 지금 교대의 것 그대로, `writeOrg = false`.
  - `ar.current.v1` 에 `{ seed, tick: 0, diff, carry: carryIn, org: orgId, write: writeOrg }`.
- 교대가 끝나면(`frame` 의 `sim.ended` 분기, 지금 `pushHistory` 하는 곳): `writeOrg` 이면 `next = makeCarryover(sim)`, 그리고 — `fresh` 로 시작한 계보이거나, 저장된 조직의 `id === orgId` 이고 그 `carry.shift === (carryIn?.shift ?? 1)` 일 때만(다른 창이 그 사이에 조직을 앞으로 보냈으면 덮어쓰지 않는다) — `lsSet('ar.org.v1', { id: orgId, carry: next, savedAt: Date.now() })` 와 `orgMem` 갱신. 그 뒤 `writeOrg = false`(같은 교대가 두 번 저장하지 않게). 덮어쓰지 않았으면 보고서에 `다른 창에서 조직이 이미 앞으로 진행됐습니다 — 이 교대의 결과는 저장하지 않았습니다.`
- 저장 실패(사생활 보호 창, 용량, 막힌 저장소): `lsSet` 이 조용히 넘긴다(지금처럼). 다음 교대의 `continue` 는 `orgMem` 을 쓰므로 이 창이 열려 있는 동안은 이어진다. 난이도 창에 `저장소를 쓸 수 없어 새로고침하면 조직이 처음으로 돌아갑니다.`
- **주소로 조건을 고정한 실행**(`?seed=`·`?diff=`·`?force=`·`?disaster=`)은 화면 확인·자동 테스트가 재현돼야 하므로 **새 조직**으로 시작하고 저장하지 않는다(`writeOrg = false`). `?org=continue` 를 주면 저장된 조직으로(저장은 하지 않는다).
- 새로고침 복원(`ar.current.v1` 에 `tick > 0`): 저장된 `carry`·`org`·`write` 로 `carryIn`·`orgId`·`writeOrg` 를 되살린 뒤 지금처럼 그 틱까지 돌린다. `diff` 는 지금처럼 `{...NORMAL, ...cur.diff}`.

### 5.4 지도에 남은 흔적 (`view/city/carryLayer.ts`)

`renderCity.ts` 월드 층에서 `drawDisasterWorld(…)`(143) 바로 뒤, G4 의 `drawRuinsWorld` 가 있으면 그 **앞**(이번 교대의 정보가 위에 오게) 한 줄: `drawCarryWorld(ctx, sim, { scale: xf.scale, timeMs: o.timeMs, mini })`. 축소 창에서는 그리지 않는다. 건물 회전은 G4 §5.3 처럼 `translate(가운데) → rotate(q.rot)` 뒤 `(−w/2, −h/2)` 좌표(`staticCity.ts` 의 `local()` 은 export 되어 있지 않으므로 같은 세 줄을 이 파일에 둔다 — `staticCity.ts` 는 고치지 않는다).

| 상태 | 큰 배율 (`min(q.w, q.h) · scale ≥ 12` — G4 §5.2 와 같은 기준) | 작은 배율 |
|---|---|---|
| `marked` (그을음) | 지붕에 그을음 덩어리 — G4 §7.6 의 함수(넓이 `clamp(soot × 1.07, 0.25, 0.9)` = G4 의 `loss × 1.6` 과 같은 값, `rgba(14,10,8,0.55)` 에 `soot` 를 곱한 투명도). `dmg ≥ 0.2` 면 지붕을 가로지르는 금 하나(G4 §5.3 의 4번) | 그리지 않는다(작은 건물의 얼룩은 읽히지 않는다) |
| `closed` (복구 공사) | 위의 얼룩 + 건물 외곽을 따라 노란 점선 울타리(`#e0b83a`, 굵기 `max(1, 1.4 / scale)`, 대시 4·3) + 지붕 가운데 `REPAIR_MARK`(공사 고깔과 가로대, `marks.ts` 에 새로) | `REPAIR_MARK` 하나(크기 `10·zs`, 투명도 0.85), 어두운 테 |
| `ruin` (무너짐) | G4 의 무너진 지붕 덧그림을 `level 'major'`(X6 뒤 `mark === 'collapsed'` 면 X6 가 더한 `'total'` — 건물 윤곽 전체가 잔해 더미), `u·v = spot`(없으면 0.5·0.5)으로 — 먼지는 그리지 않는다(지난 일이다). 그 위에 노란 점선 울타리 | G4 의 `RUIN_MARK.major`(X6 뒤 `total`, 크기 `11·zs`) |

X6 뒤에는 `mark` 로 그림을 고른다: `burnt` → X6 의 전소 지붕(지붕 전체 그을음 + 구멍), `partial` → G4 의 `'partial'` 덧그림, `blasted` → X6 의 폭발 흔적, `scorched` → 위의 그을음. 그 위에 상태(`closed`·`ruin`)의 울타리·`REPAIR_MARK` 를 얹는다. 이번 교대의 `placeMarks` 와 이어받은 상태가 같은 건물에 함께 있으면 이번 교대의 것을 그린다(X6·G4 의 층이 위에 온다).

- 밤이면 G4 처럼 `shade(…, −0.35)`.
- G4 가 아직 합쳐지지 않았으면: 무너짐은 지붕 가운데의 어두운 들쭉날쭉한 구멍(`rgba(16,12,9,0.62)`, 14각형, 가장자리 `hash2(q.id, k)`)과 `REPAIR_MARK`, 그을음은 같은 넓이의 둥근 얼룩.
- 같은 건물에 이번 교대의 사건 핀이 있으면 핀이 위에 온다(지금 순서 그대로).
- **도로**: 복구 공사 통제는 지금의 통제 점선(`trafficLayer.ts:70` 은 이유와 상관없이 알려진 통제를 그린다)에 더해, `drawTrafficScreen` 의 진입 금지 반복문(174-180)에서 `closedReason === 'repair'` 를 빼고 그 자리에 `drawObstacleMark(ctx, 'roadwork', mx, my, 6.5·zs, true)` 를 테 색 `#ffb454` 로(T1 의 공사 표식과 같은 고깔, 테 색만 다르다 — 이 한 덩어리만 고친다). 한 차로 공사는 혼잡 띠로 저절로 보인다.
- **마우스 정보** (`describeAt`, 378 의 `lines` 뒤): `const cl = carryLine(sim, q.id); if (cl) lines.push(cl);` — `그을림 · 구조 손상 30% (조직 3번째 교대 · 04 화재)` / `복구 공사 중 — 출입 통제 (2교대 남음)` / `무너짐 — 복구 전까지 출입 불가 (3교대 남음)`. 도로 정보에 `복구 공사 — 약 4분 뒤 개통`(`flowOf` 가 '통제' 라고 할 때 이유를 붙인다).
- **범례** (`MapLegend.tsx`): 새 묶음 "지난 교대의 흔적" — 그을린 건물 · 복구 공사 중인 건물 · 무너진 건물 · 복구 공사 도로.
- **부대 목록** (`UnitRow`, 131-150): `off` 대원의 칩은 흐리게 + 가로줄(`.cchip.off`), 마우스 정보 `${이름} — 결장 (총상 · 2교대 남음)` / `공석 — 순직 (신임 배치까지 1교대)`. 예비 인력 칩에는 작은 점 표지(`.cchip.relief`). `oos` 의 상태 글자는 `u.oosWhy` 가 있으면 그것(`정비 중 · 4분` — `readyAt − sim.t` 를 분으로).
- **대원 정보창**: 경력 한 줄 `조직에서 n번째 교대 · 사건 m건 · 경험 +0.04`(이어받은 항목이 있을 때만).

### 5.5 보고서

- `debrief.buildReport` 가 `carry`(이어받은 상태로 시작한 교대만)와 `carryNext`(언제나)를 채운다. 문장은 `persist.carryLines(sim)` — 기록과 상태로만:
  1. 요약 줄과 같은 문장(이어받은 것).
  2. `결원 부대가 나간 사건 ${n}건 (${호출부호들}).` — 사건마다 `everAssigned` 에 `off` 대원이 있는 부대가 있으면 센다(`off` 는 교대 내내 바뀌지 않는다).
  3. `본부 예비 인력 ${n}명이 결원 부대에 탔습니다.` · `정비를 마친 부대 ${n}대가 교대 중에 운용에 들어갔습니다.` · `복구 공사가 끝난 도로 ${n}구간이 교대 중에 열렸습니다.` · `지난 교대에 손상된 건물에서 사건 ${n}건 (${코드들}).` · `섬광탄 재고 부족으로 ${n}개 덜 지급했습니다.` — 0 인 줄은 뺀다.
- 요약(`summary`)에 한 줄 더: 이어받은 상태가 있으면 `지난 교대의 영향: …`(위 2~3 가운데 0 이 아닌 것 둘까지), 그리고 언제나 `다음 교대로 넘기는 것: 결장 예상 2명 · 정비 1대 · 출입 통제 건물 3곳 · 복구 공사 도로 1구간.`(모두 0 이면 `다음 교대로 넘기는 피해는 없습니다.`).
- 화면(`ReportModal`): 재난 요약 아래에 "조직" 칸 — 제목 `조직의 n번째 교대 · 지문 …`, `carry.lines`, 그리고 `carryNext` 의 작은 타일 다섯(결장 예상 · 공석 · 정비 · 출입 통제 건물 · 복구 도로). 대원 부상 목록에 H1 의 "결장 예상 n교대"가 이미 있으면 그대로 쓴다.
- (선택) 사건 분석 문장(`evaluate`): 첫 출동 부대에 `off` 대원이 있었고 그 사건이 대응 지연이면 `첫 출동 부대(${호출부호})는 지난 교대의 결장으로 ${n}명만 출동했습니다.` 한 줄.

### 5.6 화면 확인

`npx vite --port 5232 --strictPort` 를 띄우고 Playwright 로:
1. `?seed=S3` 로 한 교대를 끝까지(배속) → 보고서의 "조직" 칸과 `다음 교대 (이어서)` → 다음 교대의 첫 기록·부대 목록(`off` 칩)·지도.
2. 손으로 만든 상태(테스트 도우미 `scripts/chain.ts --dump` 로 지진 교대 뒤의 상태를 파일로 받아 `localStorage` 에 넣는다)로 `?org=continue` — 무너진 건물·복구 공사 울타리·복구 도로 고깔·범례를 큰 배율과 작은 배율에서 찍는다.
3. 난이도 창의 조직 줄(저장된 조직 있음/없음/읽지 못함), 상단 칩.
4. 저장소를 막은 창(`page.addInitScript` 로 `localStorage.setItem` 이 던지게)에서 교대를 끝내고 `이어서` 가 같은 창 안에서 이어지는지, 콘솔 오류 0건.
찍은 그림과 임시 스크립트는 저장소 밖(scratchpad)에 둔다.

---

## 6. 균형 — 죽음의 나선을 막는다

### 6.1 회복 규칙과 상한 (`persist.ts` 상수)

| 무엇 | 회복 | 상한 | 이유 |
|---|---|---|---|
| 결장 | 휴식마다 −1. 가장 길어야 3교대(H1 표) | `ABSENT_CAP = max(2, floor(0.2 × 편성 인원))` — 넘으면 남은 결장이 짧은 사람부터 조기 복귀(체력 70) | 큰 재난 뒤에도 조직의 4/5 는 나온다 |
| 공석(순직) | `REPLACE_AFTER` 2교대 뒤 신임 대원(경험 0.1~0.3) | — | 자리가 영원히 비지 않는다. 신임은 약하므로 영향은 남는다 |
| 결원 부대 | 예비 인력이 최소 인원까지 | `RELIEF_MAX` 4명 / 교대 | 부대가 통째로 빠지는 일은 드물게만 |
| 펌프 | 휴식마다 +0.12, 고장은 정비 뒤 0.7 | 장비 손잡이 범위로 자른다 | 장비 손잡이의 뜻(범위)을 지킨다 |
| 정비 | 다음 교대 안에 끝난다(300~720초) | `SERVICE_CAP` 2대 | 정비가 쌓이지 않는다 |
| 섬광탄 | 휴식마다 +3 | 창고 10, 정수가 1 이상이면 적어도 1개 | 연속해서 많이 쓴 뒤에만 모자란다 |
| 건물 | `repair` 휴식마다 −1(가장 길어야 5), 뒤에 흔적이 줄어 사라진다 | 항목 24, 출입 통제·무너짐 12. 넘으면 `repair` 가 작은 것부터 '복구 완료' | 사건 장소가 바닥나지 않는다(그 종류가 모두 막히면 셋째 단계 — §3.6) |
| 도로 | 길어야 2교대, 1교대째는 그 교대 안에 연다(60~900초) | 6구간, 끊기면 놓지 않는다 | 길이 끊긴 채 남지 않는다 |
| 경험 | 교대당 +0.02 까지, 노련할수록 덜 | 누적 +0.25, 경험 0.97 | 이어갈수록 쉬워지는 "성장의 나선"도 막는다 |

모든 수치는 처음 값이다. §6.3 의 측정으로 정하고, 바꾸면 구현 메모에 적는다.

### 6.2 재측정 — `scripts/chain.ts`

```bash
npx tsx scripts/chain.ts 12 8                       # 계보 12개 × 교대 8번 (보통)
npx tsx scripts/chain.ts 12 8 --diff hard
npx tsx scripts/chain.ts 12 6 --disaster quake@1    # 첫 교대에만 지진, 그 뒤는 없음 — 회복을 본다
npx tsx scripts/chain.ts 12 8 --json                # 한 줄 JSON
npx tsx scripts/chain.ts 12 8 --check               # 기준을 어기면 종료 코드 1
npx tsx scripts/chain.ts 1 4 --dump <scratchpad 폴더>   # 계보 C0 의 교대마다 이어받은 상태를 JSON 파일로 (화면 확인용, 저장소 밖에)
```

- 계보 L 의 k번째 교대: 시드 `C${L}.${k}`, 첫 교대는 `carry = null`, 그 뒤는 앞 교대의 `makeCarryover`. 매 교대 `readCarryover(JSON.parse(JSON.stringify(co)))` 의 지문이 원래와 같은지 확인한다(왕복 검사).
- 교대 번호(k)마다 한 줄:
  ```
  k  n   성공  성공+지연  실패+미해결  한계  대응  | 결장 공석 예비 정비 | 통제건물 무너짐 흔적 복구도로 | 경험+  결원출동 손상건물사건 이어진기록
  ```
  `--json` 키: `{ lineages, shifts, diff, byShift: [{ k, n, success, good, bad, timeout, resp, absent, fallen, relief, service, closed, ruin, marked, roads, expMean, shortRuns, markedInc, links }], errors, open }`. `links` = 그 교대에서 `causes` 에 `carryState.event` 가 들어간 기록 수(지난 교대에서 이어진 영향의 수 — I1-a 의 시스템 간 영향과 같은 방식으로 센다).
- I1-a 의 지표 함수가 있으면(인과 연쇄 깊이·재계획 비율·자원 경쟁 등) 교대 번호마다 그 값도 낸다 **(확인 필요: I1-a 가 지표 함수를 둔 곳 — `scripts/` 인지 `src/sim/` 인지)**.
- `scripts/sweep.ts` 에는 `--carry <파일>` 하나만 더한다: 모든 시드에 같은 이어받은 상태를 넣어 돌린다("이 조직 상태로 시드 40개" — 이어받은 상태의 효과를 A/B 로 잴 때).

### 6.3 기준 (`chain.ts --check`, 보통, 12 × 8)

1. 예외 0, 끝나지 않은 사건 0, 왕복 검사 실패 0.
2. 모든 교대에서 결장 ≤ `ABSENT_CAP`, 출입 통제·무너짐 ≤ 12, 복구 도로 ≤ 6.
3. **나선 없음**: 교대 6~8 의 (성공+지연) 평균이 교대 1~2 의 평균 −8%p 이상, +8%p 이하(망가지지도, 이어갈수록 쉬워지지도 않는다).
4. 한계 시간 종료 비율 ≤ 4%(sweep 의 기준과 같다).
5. 교대 2 이후 모든 교대의 기록에 지문이 든 요약 줄이 정확히 하나.
6. 회복(`--disaster quake@1`, 12 × 6): 교대 4 의 결장 평균 ≤ 교대 2 의 결장 평균, 교대 6 의 출입 통제·무너짐 평균 ≤ 교대 2 의 절반 **(확인 필요: 첫 측정 뒤 수치를 정한다)**.

`npm run check` 에는 넣지 않는다(교대 96번 — 다른 테스트와 함께 돌리면 느리다). 대신 `tests/persistence.test.ts` 의 짧은 연속(3 × 4)이 관문에 들어간다. 이 묶음을 끝낼 때와 균형을 바꿀 때 `chain.ts --check` 를 돌려 보고에 표를 적는다.

### 6.4 범위를 벗어나면 돌리는 손잡이 (이 순서로)

1. 이어갈수록 나빠진다 → `ABSENT_CAP` 비율(0.2), H1 표의 결장 교대 수(3·2·1), `REPLACE_AFTER`.
2. 출입 통제 건물이 늘 한도에 닿는다 → 화재의 문턱(0.6·0.25), 붕괴 `repair`(4·2).
3. 이어갈수록 좋아진다 → `GAIN_K`, `EXP_CAP`.
4. 재난 뒤 회복이 느리다 → `RELIEF_MAX`, `SERVICE_CAP`, 도로의 `left`.
`npm run check` 의 기준 범위(sweep)는 이어받은 상태가 없는 교대를 재므로 이 묶음과 상관없이 그대로 통과해야 한다.

---

## 7. 다른 묶음과의 맞물림

| 묶음 | I2 가 읽는 것 | I2 가 주는 것 | 고칠 곳 |
|---|---|---|---|
| **K1** | `xpGained`·`incidentsWorked` | 성장(§3.2)·결장·저장·생성자 입력 | K1 의 전부. ROADMAP 에서 K1 을 끝난 것으로 |
| **H1** | `r.dead`·`r.care`·`r.tDown`·`mainCause`·`CAUSE_NAME`, H1 의 결장 표 | `off` 대원의 `RosterOut.out`, 보고서의 결장 예상 | H1 `buildReport` 의 `roster` 한 줄(§3.2), 결장 표를 함수 하나로(`outAfter`) |
| **R1** | `minCrew(kind)`, `EXTRA_NAMES`, `kit` 의 `fault`·`faultKnown`, 섬광탄 나눔(`useKit`) | `kitFault`, 창고에서 지급한 섬광탄을 사람 몫으로 나눌 합 | R1 의 섬광탄 나눔이 `u.flashbangs` 합을 정한 뒤 I2 가 창고에 맞춰 줄이면, 자리 순서의 **뒤에서부터** 1개씩 뺀다. 테이저 카트리지를 창고에 넣으려면 `StockId` 에 `'taser'` |
| **X6** | `Sim.placeMarks`(`state`·`burnFrac`·`ruinFrac`) — 끝 상태의 원천, X6 의 지도 그림(`ruinLayer` 의 `total`·`burnt` 단계, G4 가 없으면 `placeMarkLayer.ts`) | `s.wear.dmg` — X6 `catOf` 의 처음 값: 실내 구획마다 `integ = min(X6 의 처음 값, 1 − WEAR_INTEG × s.wear.dmg)`(`WEAR_INTEG` 처음 값 0.5 — 손상 0.3 이면 0.85). X6 의 조짐 문턱(L1~L3)이 그대로 작동하므로 손상된 건물은 조짐이 일찍 보이고 일찍 무너진다 | X6 `catastrophe.ts` 의 `catOf` 처음 값 계산 한 줄. 지휘관이 이 손상을 아는 길(출동 브리핑의 사실 — 관제가 아는 기록이므로 정보 격리에 맞다)은 넣지 않는다(지휘관은 X6 의 `struct` 조짐으로 안다 — 결정) |
| **I1-a** (이번 세션에 구현) | 지표 함수 | `carryState.event` 를 원인으로 잇는 기록들 — "지난 교대" 를 하나의 시스템으로 세면 교대를 넘는 인과 사슬이 깊이·시스템 간 영향에 잡힌다 | I1-a 의 시스템 분류표에 `'carry'`(지난 교대) 한 줄 **(확인 필요: I1-a 의 분류 이름)** |
| **I1-b** | 건물·도로의 세계 상태(가칭 `sim.world`) | 교대 시작 때의 처음 상태 | I1-b 가 건물 상태를 교대 안에서 바꾸면(이웃 건물로 번진 불, 손상된 건물의 위험) `placeOutcome` 이 그 상태도 끝 상태로 읽는다. 겹침 표의 이름은 I1-b 를 따른다 **(확인 필요)** |
| **G4** | 무너진 지붕 덧그림·`RUIN_MARK`·그을린 지붕(§7.6) | — | G4 의 그림 함수를 `(g, q, level, u, v, seed)` 모양으로 부를 수 있게 꺼낸다(G4 의 파일 — 함수 export 만) **(확인 필요: G4 구현 뒤의 함수 이름)** |
| **T1** | `drawObstacleMark`, 통제 점선 | `closedReason 'repair'` | `trafficLayer.ts` 의 진입 금지 반복문 한 덩어리, `traffic.ts:8` 주석 한 낱말 |
| **N6** | 교대 끝의 남은 통제 | — | `finish` 의 기록 한 줄(`d.leftover`) |
| **R2·R3** | — | `off`·신임·예비 인력은 R3 의 "상태"(경험·숙련)로 저절로 들어간다 | 없음 |

---

## 8. 구현 순서와 완료 조건

단계마다 커밋하고(`wf/persist`, 한국어 메시지, 푸시하지 않음), 단계 끝마다 `npx tsc --noEmit` · `npx vitest run tests/persistence.test.ts` 를 통과시킨다. `npm run check` 는 3·5·8 단계 끝에서.

| 단계 | 내용 | 이어받은 상태가 없을 때 결과가 바뀌는가 |
|---|---|---|
| **0. 기준** | 아래 해시 목록을 scratchpad 에 저장 | — |
| **1. 틀** | `types.ts` 의 자료형과 칸, `persist.ts`(`readCarryover`·`carryKey`·`cityKey`·빈 `initCarry`·`tickCarry`·`makeCarryover` 의 뼈대), `engine.ts` 의 `extra.carry`·두 칸·생성자 순서·`tickCarry` 호출, `resources.ts` 의 `skillsFor` 꺼내기 | **아니다 — 해시 목록이 같아야 한다** |
| **2. 대원** | `crewNext`(결장·체력·성장·신임), `applyCrewCarry`(`off`·성장·결장 상한·예비 인력), `off` 가 지나가는 세 곳, `announceCarry` 의 대원 줄 | 아니다 |
| **3. 장비** | 펌프 범위·정비·`tickCarry` 의 운용 복귀, 섬광탄 창고 | 아니다 |
| **4. 도로** | `d.leftover` 기록, `roadsNext`, `initCarry` 의 복구 통제(우회로 검사)·한 차로·건물 앞, `tickCarry` 의 개통, `trafficLayer` 의 고깔 | 아니다 |
| **5. 건물** | `placeOutcome`, 휴식, 상한, `placeUsable`·`placeCond` 와 다섯 자리(장소 고르기·정해 준 건물·재난·연쇄 방화·현장), `applyPlaceWear`·`noteWearIncident` | 아니다 |
| **6. 화면** | `runner.ts` 의 저장·계보·`make`, 난이도 창·상단 칩·보고서 버튼, `carryLayer.ts`, 범례, 마우스 정보, 부대 목록·정보창 | 아니다. 스크린샷 확인(§5.6) |
| **7. 보고서** | `carryLines`·`carry`·`carryNext`·요약 줄, H1 `roster` 의 `off`, (선택) 분석 문장 | 아니다(해시는 같고 보고서 JSON 에 칸이 는다) |
| **8. 측정·균형** | `scripts/chain.ts`, `sweep.ts --carry`, §6.3 기준에 맞춰 상수 조정, `tests/persistence.test.ts` 완성, `README.md`·`CLAUDE.md`·`ROADMAP.md` | 아니다 |

0단계의 해시 목록 — H1 §10 과 같은 스크립트에 이어받은 상태가 있는 경우를 더해 scratchpad 에 `hashes.ts` 로 둔다:

```ts
import { Sim } from '/home/user/operator/src/sim/engine';
import { parseDifficulty } from '/home/user/operator/src/sim/difficulty';
const cases: [string, string, string | null][] = [];
for (let k = 0; k < 12; k++) cases.push(['S' + k, '3,3,3,3,3,3', null]);
for (const f of ['armed/shooter', 'collapse/std', 'fire/arson']) for (let k = 0; k < 3; k++) cases.push(['F' + k, '3,3,3,3,3,3', f]);
for (let k = 0; k < 3; k++) cases.push(['Q' + k, '3,3,3,3,3,3-quake', null]);       // 재난(N6)의 끝 처리를 지나는 교대
for (let k = 0; k < 4; k++) cases.push(['X' + k, '5,5,5,1,5,1', null]);
for (const [seed, d, f] of cases) {
  const [knobs, dz] = d.split('-');
  const diff = { ...parseDifficulty(knobs)!, ...(dz ? { disaster: dz as never } : {}) };
  const sim = new Sim(seed, diff, 1200, { force: f }); sim.runToEnd();
  console.log(seed, d, f ?? '-', sim.report!.hash);
}
```

1단계부터 7단계까지 이 목록이 한 글자도 달라지면 안 된다(이어받은 상태가 없는 교대에서 이 묶음은 아무것도 하지 않는다). 깨지면 그 단계를 둘로 나눠 어느 자리인지 찾는다 — 흔한 원인은 `createRoster` 의 뽑기 순서를 건드린 것, `pickPlace` 의 가중치 식에서 곱셈 순서를 바꾼 것(부동소수점), `tickCarry` 가 첫 줄에서 돌아가지 않은 것.

**완료 조건**

1. 단계 1~7 뒤 0단계의 해시 목록이 그대로다.
2. `npm run check` 통과(이어받은 상태가 없는 교대의 분포가 그대로이므로 기준 범위를 그대로 지난다).
3. `tests/persistence.test.ts` 통과(§9). 다른 테스트 파일은 고치지 않는다(`tests/sim.test.ts` 는 건드리지 않는다).
4. `npx tsx scripts/chain.ts 12 8 --check` 통과. `--diff hard`(12 × 8)와 `--disaster quake@1`(12 × 6)의 표를 보고에 적는다.
5. 화면 확인(§5.6): 스크린샷으로 직접 보고 콘솔 오류 0건.
6. 보고(마지막 응답): 브랜치와 마지막 커밋, 단계별 구현 여부, chain 표(보통·어려움·지진 뒤 회복), 고친 공용 파일(파일·함수·이유), 바꾼 상수, 남은 문제.

---

## 9. 테스트 — `tests/persistence.test.ts`

교대를 여러 번 돌리는 묶음은 `beforeAll` 에서 한 번 돌려 나눠 쓴다(전체 40초 안팎). 도우미: `const run = (seed, carry?, d = NORMAL) => { const s = new Sim(seed, d, 1200, carry === undefined ? {} : { carry }); s.runToEnd(); return s; }`.

1. **같은 이어받은 상태 = 같은 해시**: `A = run('P1')`, `co = makeCarryover(A)`. `run('P2', co)` 두 번과 `run('P2', JSON.parse(JSON.stringify(co)))` 의 `report.hash` 가 모두 같다. `run('P2')`·`run('P2', null)` 은 서로 같고 위와 다르다. `co` 를 조금 바꾼 것(어느 대원의 `dExp + 0.001`)은 지문과 해시가 다르다. `readCarryover` 뒤에도 입력 객체가 바뀌지 않았다(`JSON.stringify` 비교). 배속 묶음(`[1, 3, 8, 15, 40, 2, 75]` 틱씩)으로 돌려도 해시가 같다.
2. **다친 대원이 다음 교대에 결장**: 끝난 교대 `A` 에서 한 대원(이름 X)을 `status = 'injured'; health = 30`, 다른 한 대원(Y)을 `'down'` 으로 바꾼 뒤 `co = makeCarryover(A)` → X 의 `out === 1`, Y 의 `out === 2`. `B = new Sim('P3', NORMAL, 1200, { carry: co })` 에서 X·Y 는 `status 'off'`, 교대 내내 어떤 `s.agents` 에도 그 rid 가 없고(100틱마다 검사), 그 부대의 `crewReady` 가 그만큼 작다. `B` 를 끝내고 `co2 = makeCarryover(B)` → X `out 0`(돌아온다, `health 85`), Y `out 1`. `C` 에서 X 는 `ok`·체력 85, Y 는 `off`. H1 이 합쳐져 있으면 `r.care = 'hospital'` 인 대원이 `out 2` 인지도 본다.
3. **무너진 건물에서는 사건이 나지 않는다**: `A = run('P4')` 에서 사건이 난 건물들 `U`(`placeId ≥ 0`). 그 모두를 `ruin` 으로 둔 상태 `co`(`makeCarryover(A)` 의 `places` 를 바꿔 넣는다)로 `run('P4', co)` — 어떤 사건의 `placeId` 도 `U` 에 없다. 같은 상태에서 `createIncident(sim, { type: 'fire', placeId: u, rng: sim.rng.fork('t') })`(u ∈ U)는 다른 건물에서 난다(`I.truth.placeId !== u`). **손상된 건물은 다른 현장**: 한 건물을 `marked`(`soot 0.6`, `dmg 0.3`)로 두고 그 건물에 `createIncident` → `s.wear` 가 있고, `noteWearIncident` 기록이 하나, 실내 바닥 칸의 연료 합이 이어받은 상태 없이 같은 사건을 만든 것보다 작다.
4. **수리된 도로가 열린다**: 간선 아닌 구간 E(양 끝 사이에 다른 길이 있는 것 — `findRoute(c, a, b, 1, E)` 가 있는 것)를 `{ edge: E, why: 'crack', lane: false, left: 1, openAt: 60 }` 으로 넣는다 → 1틱: `closed && closedReason === 'repair'`, 그 양 끝 사이의 `findRoute` 가 E 를 지나지 않는다. 61초 뒤: 열려 있고 '복구 공사 완료 — 통행 재개' 기록이 하나. `left: 2` 면 교대 내내 막혀 있고 `makeCarryover` 뒤 `left 1`. **끊기는 통제는 놓지 않는다**: 막다른 구간(한쪽 끝에 길이 하나뿐)을 넣으면 닫히지 않고 `dropped` 기록이 있으며, 다음 상태에 그 항목이 없다. 이어받은 통제가 여럿인 상태로 시작한 교대에서도 0틱에 모든 시설 → 모든 교차로의 (알려진 상태) 경로가 있다.
5. **저장·복원 왕복**: `readCarryover(JSON.parse(JSON.stringify(co)), city)!.carry` 가 `co` 와 같고(`toEqual`) 지문이 같다. `v: 2`·`null`·숫자·빈 객체·`crew` 가 배열이 아닌 것은 `null`. `city` 지문이 다르면 `places`·`roads` 가 비고 `dropped` 가 있다. 범위 밖 숫자(`out 9`, `health -5`, `openAt 1e9`, `NaN`)는 잘리거나 버려진다. `JSON.stringify(co)` 에 `null` 이 아닌 값으로 `Infinity`·`NaN` 이 없고, 선택 칸에 `undefined` 가 없다.
6. **짧은 연속(관문)**: 계보 3개 × 교대 4번(보통) — 예외 0, 모든 사건이 닫힘, 매 교대 결장 ≤ `ABSENT_CAP`, 출입 통제·무너짐 ≤ 12, 복구 도로 ≤ 6, 교대 2 부터 지문 요약 줄이 정확히 하나.
7. **경험 성장과 부대 규모**: `xpGained = 0.04` 인 대원의 `dExp` 가 0 보다 크고 0.02 이하. 부대 규모 5 의 교대에서 만든 상태를 부대 규모 1 의 교대에 넣었다가 다시 5 로 — 1 에서 편성되지 않은 부대의 대원 항목이 사라지지 않고(`out` 은 휴식만큼 줄고), 같은 이름의 대원은 `skill` 이 기본 + `dSkill` 이다.
8. **장비**: 펌프 `0.95` 를 장비 1(범위 0.21~0.55)에 넣으면 `pumpCond === 0.55`. `service: { readyAt: 120 }` 인 부대는 120초 전에는 `oos` 이고 배정되지 않으며(그 사이 그 부대의 출동 기록 없음), 120초에 '정비 완료' 기록과 함께 `available`. 섬광탄 창고 1 이면 특공의 섬광탄은 1, 기동은 비상 지급 1.
9. **금지와 격리**: `src/sim` 아래 어떤 파일에도 `/localStorage|sessionStorage|indexedDB/` 가 없다. `src/sim/dispatch/*`·`field/commander.ts`·`field/orders/*` 에 `carryState`·`.wear` 가 없다(이 묶음은 관제·지휘 판단을 바꾸지 않는다 — X6·R3 가 정보 경로를 만들면 이 검사를 그때 고친다).
10. **가짜 연출 없음**: 짧은 연속의 모든 교대에서 — `off` 대원마다 결장/공석 기록이 정확히 하나, `'repair'` 로 닫혔다 열린 구간마다 '통행 재개' 기록이 하나, 정비에서 돌아온 부대마다 '정비 완료' 기록이 하나, 이 기록들의 `causes` 에 `carryState.event` 가 있다.

---

## 10. 고칠 파일 목록

### 10.1 새 파일

| 파일 | 내용 |
|---|---|
| `src/sim/persist.ts` | 상수(`CARRY_VERSION`·`REST_HEAL`·`BACK_HEALTH`·`EARLY_BACK_HEALTH`·`GAIN_K`·`GAIN_CAP`·`EXP_CAP`·`SKILL_K`·`SKILL_CAP`·`ABSENT_CAP`·`RELIEF_MAX`·`REPLACE_AFTER`·`PUMP_REST`·`SERVICE_CAP`·`STOCK_CAP`·`RESUPPLY`·`PLACE_CAP`·`CLOSED_CAP`·`ROAD_CAP`·`LANE_SLOW`·`WEAR_INTEG`), 이름표(`RECRUIT_NAMES`·`RELIEF_NAMES`·`WHY_NAME`), `CarryState`, `readCarryover`·`carryKey`·`cityKey`·`initCarry`·`applyCrewCarry`·`announceCarry`·`tickCarry`·`placeCond`·`placeUsable`·`applyPlaceWear`·`noteWearIncident`·`makeCarryover`·`carrySummary`·`carryLines`·`carryLine`(마우스 정보)·`outAfter`. import 는 `types`·`rng`·`events`·`util`·`city`(`edgeName`)·`resources`(함수만)·`difficulty`(타입) — `incidents`·`field/*`·`dispatch/*`·`debrief` 를 import 하지 않는다 |
| `src/view/city/carryLayer.ts` | `drawCarryWorld`, 울타리·얼룩·무너짐 그림(G4 함수가 있으면 그것을) |
| `scripts/chain.ts` | 연속 교대 측정(§6.2) |
| `tests/persistence.test.ts` | §9 |

### 10.2 공용 파일 수정

| 파일 | 함수·자리 | 무엇을 · 왜 | 단계 |
|---|---|---|---|
| `sim/types.ts` | 끝에 추가, `Responder`·`Unit`·`Scene`·`ShiftReport` 의 선택 칸, `Responder.status` 끝에 `\| 'off'` | §2.1 | 1 |
| `sim/engine.ts` | 생성자 서명·순서, `carry`·`carryState` 칸, `step` 에 `tickCarry` | §3.4 | 1 |
| `sim/resources.ts` | `createRoster` 의 분야별 숙련 식(80-84) → `skillsFor`(export), `traitOf` export | 성장·신임·예비 인력이 같은 식을 쓴다. 결과 그대로 | 1 |
| | `dispatchUnit` 의 출동 준비 시간(236) | `off` 가 아닌 첫 대원의 경험 | 2 |
| `sim/debrief.ts` | `buildReport` 의 `respondersHurt`(185) | `off` 제외 | 2 |
| | `buildReport` 끝 | `carry`·`carryNext`·요약 줄(§5.5) | 7 |
| | (선택) `evaluate` | 결원 출동 분석 한 줄 | 7 |
| `sim/disaster.ts` | `finish` 맨 앞 | `cut` 일 때 `d.leftover` 기록(결과 불변). `DisasterState` 에 `leftover?` | 4 |
| | `pickPlace`(355-362) | `placeUsable` 아니면 0 | 5 |
| `sim/incidents.ts` | `pickPlace`(49-67) | 제외·셋째 단계·손상 가중치 | 5 |
| | `createIncident` 의 `place` 줄(103) | 정해 준 건물이 막혔으면 다시 고르기 | 5 |
| | `createIncident` 의 `I.rootEvent` 뒤(150) | `noteWearIncident` | 5 |
| `sim/scenarios/crime.ts` | `arsonNext` 의 `pool`(43-44) | `placeUsable` 인 것만 | 5 |
| `sim/field/sceneManager.ts` | `createScene`(23-27) | `applyPlaceWear` | 5 |
| `sim/traffic.ts` | 맨 위 주석(8) | `'repair'` 도 다른 곳의 것이라고 한 낱말(코드 변경 없음) | 4 |
| H1 의 `buildReport` `roster` | `off` 대원의 `out` | §3.2 | 7 |
| X6 `field/catastrophe.ts` `catOf` | 구획 건전도 처음 값에 `1 − WEAR_INTEG × s.wear.dmg` | §7 | 5 |
| X6 `incidents.pickPlace` 의 제외 | 같은 자리에 `placeUsable` 을 더한다(X6 의 `collapsed`·`burnt` 제외 옆) | §3.6 | 5 |
| `view/runner.ts` | 키·`make`·`newShift`·끝 처리·복원 | §5.3 | 6 |
| `view/renderCity.ts` | 월드 층 한 줄(143 뒤), `describeAt`(378 뒤) | §5.4 | 6 |
| `view/city/trafficLayer.ts` | `drawTrafficScreen` 의 진입 금지 반복문(174-180) | `'repair'` 는 고깔 | 4 |
| `view/scene/staticLayer.ts` | 바닥·벽 얼룩, `staticSig` 에 `s.wear?.soot` | 그을린 건물의 현장 | 6 |
| `view/marks.ts` | `REPAIR_MARK`·`ORG_MARK` | 그림 기호 | 6 |
| `ui/MapLegend.tsx` | "지난 교대의 흔적" | 범례 | 6 |
| `ui/panels.tsx` | `UnitRow`(`off`·예비·`oosWhy`), 대원 정보창의 경력, `TopBar` 조직 칩, `ReportModal` 버튼·조직 칸, `DifficultyPanel` 조직 줄 | §5.2·5.4·5.5 | 6·7 |
| `ui/App.tsx` | `onNew(seed, d, mode)` | 세 가지 시작 | 6 |
| `ui/styles.css` | 끝의 `/* ── persist ── */` | `.cchip.off`·`.cchip.relief`·조직 칩·조직 칸 | 6 |
| `scripts/sweep.ts` | `mk()` 와 옵션 | `--carry <파일>` | 8 |
| `README.md`·`CLAUDE.md`·`docs/ROADMAP.md` | 마지막 | 아래 | 8 |

### 10.3 `CLAUDE.md` 에 들어갈 것 (8단계)

- 구조 표에 `src/sim/persist.ts` 한 줄: "교대 간 지속: 이어받은 상태(Carryover)를 만들고(makeCarryover) 다음 교대에 적용한다(initCarry·applyCrewCarry). 건물 상태는 city.places 를 고치지 않고 carryState.places 에 겹친다."
- "절대 깨면 안 되는 것" 2번(재현성)에: "같은 시드 + 같은 난이도 + 같은 이어받은 상태 = 같은 결과. 이어받은 상태가 없으면 지금과 같은 해시."
- 4번(정보 격리)의 "진실을 읽어도 되는 곳"에 `persist.ts` 의 `placeOutcome`.
- 겪은 함정에: "**이어받은 대원의 열쇠는 이름이다.** rid 는 부대 규모 손잡이에 따라 바뀐다. 결장 대원은 `status 'off'` 로 명부에 남는다(현장·crewReady 에서 빠진다). `status !== 'ok'` 로 '이번 교대에 다친 사람'을 세면 결장자가 섞인다." · "**복구 공사 통제(`closedReason 'repair'`)의 주인은 persist.ts.** 교대 시작 때 큰 차의 우회로가 있을 때만 놓는다." · "**사건 장소를 고르는 새 코드는 `placeUsable` 을 지난다.** 무너진 건물에서는 사건이 나지 않는다." · "**이어받은 상태를 적용하는 코드는 기존 흐름을 다 뽑은 뒤 값만 바꾼다**(`equipment` 흐름처럼)."
- 확장 표에 "교대 간 지속에 항목 더하기: `types.ts` `Carryover` 에 선택 칸 → `persist.ts` 의 끝 상태(·휴식)·검사(`readCarryover`)·적용·요약 → `tests/persistence.test.ts` 왕복. 칸의 뜻이 바뀌면 `v` 를 올리고 옮기는 함수를 둔다."
- 명령 표에 `npx tsx scripts/chain.ts 12 8 --check`.

---

## 11. 알려진 위험과 결정 사항

### 11.1 알려진 위험

1. **이어받은 상태가 없을 때의 결과 불변**은 `createRoster` 의 뽑기 순서, `pickPlace` 의 가중치 연산 순서, `tickCarry`·`placeUsable` 의 첫 줄 반환에 기댄다. `placeUsable` 은 `on` 이 아니면 바로 `true`, 가중치는 `w *= …` 를 `marked` 일 때만 곱한다(1 을 곱하는 것도 하지 않는다).
2. **`status 'off'` 를 모르는 코드**: 지금은 세 곳(§3.2)뿐이지만 R1·H1·R2·R3 가 합쳐진 뒤 `status` 를 보는 곳이 늘어 있을 것이다. 구현을 시작할 때 `grep -n "\.status" src/sim src/ui` 에서 `Responder` 의 상태를 보는 곳을 모두 확인한다(`FieldAgent.status` 와 헷갈리지 않게). 현장에 내리지 않으므로 `field/*` 는 대개 안전하다.
3. **H1·X6·I1 의 이름**: 이 문서를 쓸 때 I1 설계서가 없었고, H1·X6 는 설계서(초안)만 있고 구현 전이다. 구현을 시작할 때 실제 이름(H1 의 결장 표 함수·`mainCause`, X6 의 `Sim.placeMarks`·`PlaceMark`·`catOf`, I1 의 `sim.world`·I1-a 지표 함수)을 확인해 이 문서의 이름을 바꾼다. 다르면 구현 메모에 적는다.
4. **도시 지도가 바뀌면** 건물·도로 상태는 버려진다(지문 불일치). 지도를 고치는 묶음(M2 등) 뒤에는 저장된 조직의 건물·도로 흔적이 한 번 사라진다 — 의도대로다. 기록 한 줄이 남는다.
5. **localStorage**: 용량(조직 하나가 10~20KB, 입력 사본까지 두 벌), 사생활 보호 창, 다른 창의 동시 진행. 실패는 조용히 넘기고 창 안의 사본으로 이어 간다. 두 창이 같은 조직을 이어 가면 먼저 끝난 쪽만 저장된다(§5.3).
6. **성장의 나선**: 경험이 쌓이면 판단 간격·발견 반경·협상 진척 등 여러 곳(`experience` 를 읽는 14곳)이 함께 좋아진다. 상한 0.25 로도 이어갈수록 쉬워지면 §6.4 의 3번.
7. **사건 장소가 바닥남**: 종류의 건물이 하나뿐인 곳(경기장·활주로 …)이 무너지면 그 종류의 사건은 셋째 단계에서도 고를 곳이 없다(무너짐은 끝까지 안 된다) → `pickPlace` 가 `null` 을 내고 지금처럼 교차로에서 일어난다. 비행기 추락이 활주로가 아닌 교차로에서 나는 식의 어색함이 생길 수 있다 — 수가 적은 종류(3채 이하)는 `ruin` 대신 `closed` 로 두는 규칙을 넣을지 측정 뒤에 정한다 **(확인 필요)**.
8. **재난 끝의 기록과 다음 교대의 통제**: 교대 N 의 기록은 교대 끝에 '통제 해제'를 말하고, 교대 N+1 은 같은 구간을 '복구 공사로 통제'한다. 두 기록은 각각 그 교대의 상태와 맞는다(비상 통제 → 복구 공사). 문구가 이 흐름을 말하도록 다음 교대의 줄에 원인(`지진 균열`)을 넣는다.
9. **보고서 JSON**: `carryNext` 가 늘 들어가므로 보고서 JSON 은 지금과 달라진다(해시는 같다). 같은 시드 두 번의 JSON 비교 테스트(`sim.test.ts` 의 "같은 시드는 같은 이벤트 기록과 같은 보고서를 만든다")는 두 번 다 같은 칸을 가지므로 그대로 통과한다.
10. **속도**: `tickCarry` 는 할 일이 없으면 첫 줄에서 돌아간다. `placeUsable` 은 `Map` 조회 하나. `initCarry` 의 우회로 검사는 교대 시작 때 많아야 6번.
11. **예비 인력의 rid**: `sim.responders` 끝에 붙으므로 그 뒤의 지원 부대 대원 rid 가 밀린다 — 이어받은 상태가 있을 때만이고 결과가 달라지는 것이 맞다.

### 11.2 결정 사항 (조사에서 열려 있던 질문)

| 질문 | 결정 | 이유 |
|---|---|---|
| 명부의 열쇠 | 이름(신임은 자리 이름 `seat`). H1 의 `RosterOut.rid` 는 화면용으로 그대로 | rid 는 부대 규모 손잡이에 따라 바뀐다 |
| 결장 대원을 명부에서 빼나 | 빼지 않는다. `status 'off'` 로 남긴다 | rid·흐름 이름이 그대로, 결원 감점(−18)이 지금 규칙대로 걸린다, 화면이 결장자를 보여 줄 수 있다 |
| 펌프와 장비 손잡이 | 손잡이 = 범위, 이어받은 값 = 그 안의 위치. `equipment` 흐름은 그대로 뽑는다 | 손잡이의 뜻과 다른 부대의 순서를 지킨다 |
| 건물 상태를 어디에 | `placeId` 열쇠의 겹침 표(`carryState.places`). `city.places` 는 고치지 않는다 | 지도는 모든 Sim 이 함께 쓰고, 그 배열을 열쇠로 한 캐시가 셋 있다(`kindCount`·`flowCache`·`geoCache`) |
| 현장에 피해를 칸 단위로 | 아니다. 요약값(그을음 → 연료·그림, 손상 → X6 의 처음 건전도)만 | 평면이 사건마다 달라 칸을 옮길 수 없다 |
| 무너진·통제 건물의 사건 | 무너짐은 끝까지 없음. 출입 통제는 그 종류가 모두 막혔을 때만(셋째 단계) | "무너진 건물에서는 사건이 나지 않는다", 장소 바닥남을 막는다 |
| 파손 도로의 주인 | 새 이유 `'repair'`, 주인 `persist.ts`. 재난은 교대 끝에 지금처럼 모두 열고 남은 통제를 기록만 | 재난의 끝 처리를 바꾸면 이어받은 상태가 없는 교대의 결과가 바뀐다 |
| 이어받은 통제와 도시의 연결 | 교대 시작 때 큰 차 기준 우회로가 있을 때만 놓는다 | "모든 시설에서 모든 교차로로"가 교대 시작부터 깨지지 않게 |
| "같은 시드 재실행" | 같은 **입력**으로 다시 보기(저장하지 않음). "다음 교대(이어서)"가 출력을 잇는다 | 재현을 보는 버튼의 뜻을 지킨다 |
| 저장 위치 | `ar.org.v1`(조직), `ar.current.v1` 에 입력 전체 | 되감기·복원이 같은 입력을 써야 한다 |
| 해시에 지문 | 이어받은 상태가 있을 때만 요약 줄에 지문 | 없을 때 해시 불변, 있을 때 내용이 다르면 해시가 다르다 |
| 연속 실행 | 새 스크립트 `scripts/chain.ts` + `sweep.ts --carry` | `sweep.ts` 는 I1-a 가 이번 세션에 고친다 — 겹침을 줄인다 |
| 금지 정규식에 localStorage | `tests/persistence.test.ts` 에서 검사 | `tests/sim.test.ts` 는 건드리지 않는다 |
| 교대 사이의 시간 | "휴식 한 번"으로 고정, 교대 시각·날씨는 그 교대의 시드 | `environment` 흐름을 바꾸지 않는다 |
| 지구력·피로 누적 | 넣지 않는다 | 휴식으로 회복된다고 본다. 큰 재난 뒤의 부족은 결장·정비·재고로 나타난다 |
| 순직 자리 | 2교대 뒤 신임 대원(약함) | 자리가 영원히 비면 나선이 된다 |
| 결원 부대 | 예비 인력이 최소 인원까지(교대당 4명) | 부대가 통째로 빠지는 일은 드물게 |
| 이어받은 상태의 편집 | 만들지 않는다 | 관찰 전용 |
| 교통(혼잡·불법 주차·공사) | 이어받지 않는다 | 교대마다 새로 — 교통은 그날의 일이다 |
| 지휘관이 이어받은 손상을 아는가 | 출동 브리핑에 따로 넣지 않는다. 손상은 X6 의 처음 건전도로 들어가고, 지휘관은 X6 의 `struct` 조짐(외부 관찰)으로 안다 | 정보 경로를 둘로 만들지 않는다. 기록(`noteWearIncident`)은 관찰자 시점의 진실로 남는다 |
| X6 와의 건물 상태 | X6 의 `Sim.placeMarks` 를 먼저 읽고, X6 가 표시하지 않는 작은 피해만 I2 의 대체 규칙으로 | X6 §0 이 "X6 의 이름이 기준"이라고 정했다 |
