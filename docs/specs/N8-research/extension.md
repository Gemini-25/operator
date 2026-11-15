# N8 사건 종류 다양화 — 조사: 확장 비용과 빈 자리

- 조사 기준: 주 작업 폴더 `/home/user/operator`, 브랜치 `claude/great-ptolemy-s31sxn`, HEAD `823194e`(2026-11-15). R1 은 다 합쳐짐, H1 단계 0~3, X6 단계 1 까지 있는 코드다.
- 코드는 고치지 않았다. 잰 것: ① `npx tsx scripts/sweep.ts 40 --scen`(보통, S0~S39, 32초) 한 번 ② 읽기 전용 스크립트 둘(`tools/census.ts` — 건물 종류 표, `tools/usage.ts` — 같은 40교대의 부대·임무·건물 쓰임, 27초). 원본 출력은 이 폴더의 `tools/` 에 있다(`sweep40-scen.txt`).
- 표기: **[확인]** = 코드·실행으로 직접 봄, **[설계서]** = 아직 코드에 없고 설계서에서만 봄(구현 뒤 이름 확인 필요), **[추측]** = 근거는 있으나 확인하지 않음.

---

## 0. 한눈에

| 무엇을 더하나 | 고치는 파일 | 공용 파일 | 유형 수에 묶인 것 | 실측 |
|---|---|---|---|---|
| **새 유형**(IncidentType 하나) | src 19~26개 + 시험 3~6개 + 문서 | 거의 전부 공용 파일 | `lik` 배열 42개에 열 하나씩, 열 수 8을 보는 시험 3곳, 손으로 쓴 유형 배열 4곳, 문자열 열쇠 표 9개 | 수난(F1 커밋 `c776fc4`): 24파일 +409/−145 (네 기능 합계, src 20파일 +270/−59). 붕괴+가스(`78ad889`, 두 유형): 21파일 +396/−57 |
| **새 시나리오**(변형 하나) | 자기 파일 4~5개(표·현장·규칙·지휘·스킨) + 시험 | 0~9개, 몇 줄씩 | 없음(`lik` 는 자기 줄 하나) | N5 대형 사고 6개: 11파일 +1048/−7, 그중 공용 6파일 +15/−3. N4b 강력 범죄 7개: 15파일 +898/−23, 공용 9파일 +94/−17. N6 재난(시나리오 3 + 재난 5종): 11파일 +1508/−23, 공용 1파일 +12 |

- 유형 하나는 "공용 파일 스무 곳의 분기문에 한 갈래씩"이고, 시나리오 하나는 "자기 파일에 한 덩어리"다. 묶음 방식(레지스트리)은 시나리오용이고 **유형을 끼워 넣는 자리는 없다** [확인].
- 지금의 "종류가 적다"는 느낌의 실측: 40교대 567건 가운데 **기본 모습(시나리오 표에 없는 것)이 449건(79%)**, 시나리오 23개는 118건(21%). 위 다섯 모습(화재 기본 97 · 교통사고 기본 70 · 낙상·외상 42 · 가스 누출 40 · 조난 35)이 284건(50%). **실종·응급·가스 누출·수난 네 유형(200건, 35%)은 평소 추첨에 드는 시나리오가 하나도 없다** — 가스 누출과 수난은 모습이 딱 하나다 [확인].

---

## 1. 새 유형(IncidentType) 하나의 비용

### 1.1 고쳐야 하는 자리 전체 (지금 코드 기준)

"tsc" 열: 빠뜨리면 타입 검사가 잡는가. "빠뜨리면" 열: 잡히지 않을 때 실제로 일어나는 일.

**시뮬레이션 (src/sim)**

| # | 파일:줄 | 무엇 | tsc | 빠뜨리면 |
|---|---|---|---|---|
| 1 | `types.ts:9` | `IncidentType` 합집합 | — | — |
| 2 | `util.ts:24` | `TYPE_NAME` (`Record<string,string>`) | ✗ | 화면·기록에 `undefined` |
| 3 | `incidents.ts:76-77` | `types` 배열과 가중치 `[0.27, 0.24, 0.17, armedWeight, 0.2, 0.075, 0.085, 0.07]` | ✗ | 추첨되지 않음 |
| 4 | `incidents.ts:87-97` | 유형 안의 기본 변주(무장 네 갈래·장난, 실종 배회/조난, 교통 버스, 응급 심각도별, 화재 오인) | ✗ | `variant = 'std'` |
| 5 | `incidents.ts:130` | 첫 신고까지 지연(유형별 삼항 사슬, 기본 `4~11초`) | ✗ | 기본값 |
| 6 | `incidents.ts:133` | 추가 신고 확률 `pFollow`(기본 0.12) | ✗ | 기본값 |
| 7 | `cityPlan.ts:234` | `INCIDENT_PLACES: Record<IncidentType, W>` | **✓** | (유일하게 tsc 가 잡는 유형 표) |
| 8 | `field/builders.ts:785` | `buildScene` 의 유형 사슬 — 끝이 `buildArmed` | ✗ | **모르는 유형은 무장 현장이 만들어진다** |
| 9 | `field/builders.ts:797` | `sealPockets` 가 건너뛰는 유형(실종·교통·수난 — 바깥 현장) | ✗ | 바깥 현장의 한두 칸이 벽이 됨 |
| 10 | `dispatch/callSystem.ts:28` `NATURE_TEXT`, `:51` `NATURE_LIK` | 새 신고 내용 키(정확·모호) 문구와 가능도, **기존 20줄에 열 하나씩** | ✗ | `Math.log(undefined)` = NaN → 유형 확률이 모두 NaN |
| 11 | `callSystem.ts:80·82·86-92` `natureFor` | 정확한 키·모호한 키·"잘못 아는 신고자"의 오신고 | ✗ | 끝의 무장 갈래로 떨어짐(`'fight'`) |
| 12 | `callSystem.ts:127-217` `makeCaller` | 응급 전용 분기, `trappedTrue`/`injuredTrue` 의 뜻, 인원, 갇힘 문구(yes/no), 위험 요소, 상세 | ✗ | "차 안에 사람이 끼어서…" 같은 교통사고 문구가 나옴 |
| 13 | `callSystem.ts:232-241` `QUESTION` | 주제별 질문 문구(유형 열쇠) | ✗ | `any` 문구 |
| 14 | `callSystem.ts:245-254` `TOPIC_VALUE` | 유형별 질문 가치 | ✗ | `table` 없음 → 접수 AI 가 위치·종류만 묻고 통화 종료(`:333`) |
| 15 | `callSystem.ts:315` `maybeInstruct` + `hazards.ts:263-284` `applyCallerAid` | 도착 전 안내(화재·교통·응급·실종만) | ✗ | 안내 없음 |
| 16 | `dispatch/analyst.ts:13` `TYPES` | 열 순서 = `NATURE_LIK` 열 순서 | ✗ | 그 유형으로 판단하지 못함 |
| 17 | `analyst.ts:56·59` | **숫자 색인** `lp[3]`(무장)·`lp[1]`(교통) | ✗ | 새 유형을 끝이 아닌 곳에 끼우면 조용히 틀림 → **새 유형은 끝에만** |
| 18 | `analyst.ts:42-46` `placePrior` | `INCIDENT_PLACES[type][kind] > 0 ? 1.2 : 0.5` | — | 표가 비면 0.5 |
| 19 | `analyst.ts:79-143` 위험도, `:150-185` 필요 자원 | 유형별 `else if`, **마지막 `else` 가 무장** | ✗ | 무장의 위험도·경찰 수요로 계산 |
| 20 | `dispatch/dispatcher.ts:64-65` | 유형별 장비 가점(수난 로프·구명환 +12, 붕괴 탐지 장비 +8) | ✗ | 가점 없음 |
| 21 | `dispatcher.ts:92-101` `airFit` | 헬기가 뜨는 유형 목록 | ✗ | 헬기가 가지 않음 |
| 22 | `dispatcher.ts:128` | 구조정은 수난·'선박 화재'만 | ✗ | 구조정이 가지 않음 |
| 23 | `field/sceneManager.ts:222` `LIMIT` (`Record<string, number>`) | 현장 한계 시간 | ✗ | **`LIMIT[kind]` 가 undefined → `sim.t − on > NaN` 은 늘 거짓 → 한계 시간이 영영 오지 않는다**(`:315`). 불변 조건 6 위반 |
| 24 | `sceneManager.ts:245-250` | 유형별 세계 규칙 호출(붕괴·수난·실종·응급·승강기/압궤·가스) | ✗ | 규칙이 돌지 않음(`s.rules` 로는 collapse·gas·water 셋만 얹을 수 있다) |
| 25 | `sceneManager.ts:326-332` | 마지막 대원이 떠난 뒤의 종료·추가 요청 | ✗ | 기본 갈래 |
| 26 | `debrief.ts:25` `RESP_LIMIT` (`Record<string, number>`) | 대응 지연 기준 | ✗ | `responseTime > undefined` 는 거짓 → '대응 지연' 판정이 사라짐 |
| 27 | `debrief.ts:42·78·82·88·160` | 재산 피해·도주·미발견·머리글의 유형 분기 | ✗ | 기본 갈래 |
| 28 | `field/commander.ts:300` | **수색 대상 유형 목록**(화재·무장·응급·붕괴·가스·수난의 실내·구역 수색) | ✗ | 방을 수색하지 않음 |
| 29 | `commander.ts:253·262·264·289·293·301·302·313·321·328·398·402·438·455·475·647·681·682` | 통제선·무장 대치·재수색·교통 통제·진입 부대 요청·종료 조건 | ✗ | 해당 규칙 없음 |
| 30 | `field/agents.ts:415·504·520·523·538` | **위험한 건물 목록**(화재·가스·붕괴 = 공기호흡기 대원만 실내로) | ✗ | 누구나 들어감 |
| 31 | `agents.ts:90·213` (탐지 장비는 붕괴만), `:465` `workLabel` 의 가스 통제 문구, `:510` 수색 적합도의 유형 가점 | 선택 | ✗ | — |
| 32 | `field/executor.ts:89·199·281·633·653·713·885·1192` | 험한 지형 속도, `noAirEntry`, 구출 중 사고, 제세동, 척추 고정판, 통제 문구, 대기 지점 | ✗ | 기본 갈래 |
| 33 | `field/hazards.ts:196-199` | 가스의 독성 계수, 바깥 노출(`exposure`)이 걸리는 유형 | ✗ | 기본 갈래 |
| 34 | `field/injury.ts:68` `smokeCause`, `:289-306` `initialCause` | 처음 원인 표 — `switch` 의 `default` 가 무장(총상/타박상) | ✗ | 원인이 '타박상' |
| 35 | `field/airDecide.ts:104-152`, `crews.ts:171` `isHovering` | 상공 헬기의 훑는 길·한가함·상공에 머무는 현장 | ✗ | 기본 갈래 |
| 36 | `field/catastrophe.ts:50` `NO_STRUCT`(변형 목록), `:136·249` | X6 대상 판별은 유형이 아니라 생김새(실내 구획·용기·밸브)다. 변형 예외 목록만 본다 | ✗ | 건물이 아닌 현장이 구조 건전도를 가짐 |
| 37 | `disaster.ts:383-460` `resolve` | 재난이 그 유형을 일으키게 하려면 | — | 재난에 나오지 않음 |
| 38 | `scenarios/*.ts` 의 `lik` **22개** + `scenarios.ts:31` 주석 | 열 하나씩 | ✗ | #10 과 같음(NaN) |

**화면 (src/view, src/ui)**

| # | 파일:줄 | 무엇 | 빠뜨리면 |
|---|---|---|---|
| 39 | `view/icons.ts:4-12` `ICON_PATH` | 유형 아이콘(24×24 경로) | `unknown`(물음표) 아이콘 |
| 40 | `view/renderCity.ts:26` `TYPE_COLOR` | 유형색 | 핀·카드 색이 `undefined` |
| 41 | `view/renderCity.ts:30` `RESP_LIMIT` (debrief 의 복사) | 핀의 경과 고리 | `NaN` |
| 42 | `view/city/trafficLayer.ts:169` `CAUSE_COLOR` (TYPE_COLOR 의 복사) | 통제 구간의 원인 색 | `undefined` |
| 43 | `ui/panels.tsx:281` | **손으로 쓴 8유형 배열** + "앞의 다섯은 늘 보인다" 조건 | 확률 줄이 없음 |
| 44 | `view/scene/staticLayer.ts:40-64·693-752` | 바닥 재질·보도·길가(실종·교통·수난은 바깥 현장으로 따로) | 건물 현장으로 그려짐 |
| 45 | `view/renderScene.ts:83-84·440·713·815` | 장면 제목 자리, 대기 줄 자리, 무장 현장의 안개, 실종의 구역 확률 | 건물 현장 기본 |
| 46 | `view/hazardState.ts:84-88` `pinIcon`·`VARIANT_ICON` | 변형별 핀 아이콘은 지금 **붕괴 변형 넷만** | 유형 아이콘 |
| 47 | 새 소품·타일이 있으면 `renderScene.ts:360-424`, `sprites.ts`, `staticLayer.ts`(`surfaceMap`·`paintTile`·`furniture`), `grid.ts` | — | 그려지지 않음(소품은 분기가 없으면 아무것도 안 그린다) |

쓰지 않아도 되는 화면 자리 [확인]: 범례(`ui/MapLegend.tsx`)는 유형별 줄이 없다(핀 견본 하나 `ICON_PATH.fire`). 소리(`view/audio.ts`)·카메라(`view/camera.ts`)·통화창·교전 연출은 유형을 보지 않는다(기록의 `kind`·효과 종류만 본다). `scripts/ui-check.cjs` 는 유형 이름을 쓰지 않는다(`.card.incident`·`.badge.phase-onscene`·장면 제목의 "사건 NN "만 본다). `scripts/screenshot.cjs` 는 인자로 받은 유형 이름 일부를 카드 글자에서 찾는다(목록 없음).

**시험·도구·문서**

| # | 파일:줄 | 무엇 |
|---|---|---|
| 48 | `tests/sim.test.ts:361-364` | `NATURE_LIK` 모든 줄의 길이 = **8** |
| 49 | `tests/ext.test.ts:37` | 시나리오 `lik` 길이 = **8** |
| 50 | `tests/major.test.ts:64-65` | 대형 사고 `lik` 길이 = **8**, 손으로 쓴 8유형 배열로 자기 유형 색인 |
| 51 | `tests/crews.test.ts:58` `HAZ_BUILDING`, `:849-855` | 위험한 건물 유형 표, 헬기가 뜨는 유형 목록 |
| 52 | `tests/injuries.test.ts:231-240` | [유형, 변형, 처음 원인] 표 |
| 53 | `scripts/metrics.ts`·`scripts/sweep.ts` | **유형 목록 없음** — `${type}/${variant}` 문자열과 `byType[inc.type]` 로만 센다(고칠 것 없음). `scripts/catstats.ts:40` 은 화재만 따로 센다 |
| 54 | `README.md`, `CLAUDE.md`("열 수(지금 8)", "새 사건 유형" 줄), `docs/specs/README.md`("가능도 8개"), `docs/ROADMAP.md` | 문서 |

`docs/specs/README.md` §2 는 `cityPlan.ts`·`tests/sim.test.ts` 를 "절대 건드리지 않는 것"으로 둔다(설계서가 따로 허락한 경우 제외). **새 유형은 #7(`cityPlan.INCIDENT_PLACES`)과 #48(`sim.test.ts:363`)을 반드시 고쳐야 하므로 N8 설계서가 그 두 곳을 명시해서 허락해야 한다** [확인].

### 1.2 유형 수(지금 8)에 묶인 것만 따로

| 묶인 것 | 수 | 자리 |
|---|---|---|
| 가능도 배열(길이 8) | **42개** = `NATURE_LIK` 20줄 + 시나리오 `lik` 22개(생활 5·추격 2·강력 6·대형 6·재난 3) | `callSystem.ts:51-60`, `scenarios/*.ts` |
| 열 수를 보는 시험 | 3곳 | `sim.test.ts:363`, `ext.test.ts:37`, `major.test.ts:64` |
| 손으로 쓴 유형 배열 | 4곳 | `analyst.ts:13`, `incidents.ts:76`(+가중치 `:77`), `panels.tsx:281`, `major.test.ts:65` |
| 숫자 색인 | 2곳 | `analyst.ts:56`(`lp[3]`), `:59`(`lp[1]`) |
| 문자열 열쇠 표(tsc 가 못 잡음) | 9개 | `TYPE_NAME`, `LIMIT`, `RESP_LIMIT`×2, `TYPE_COLOR`, `CAUSE_COLOR`, `ICON_PATH`, `TOPIC_VALUE`, `QUESTION` |
| 끝 갈래가 무장인 사슬 | 5곳 | `buildScene`, `natureFor`, 분석의 위험도·필요 자원, `initialCause` |
| 유형 가중치의 정규화 | `rng.weighted` 가 합으로 나눈다 | 아홉째 유형에 가중치를 주면 **기존 여덟 유형의 몫이 모두 줄고, 모든 시드의 유형 추첨이 바뀐다** |

지금 가중치(보통, `armedWeight` 0.23): 합 1.34 → 화재 20.1% · 교통 17.9% · 무장 17.2% · 응급 14.9% · 실종 12.7% · 가스 6.3% · 붕괴 5.6% · 수난 5.2% (직전과 같은 유형은 ×0.3).

### 1.3 저장소 안내서의 "새 사건 유형" 줄에 **없는** 자리

안내서 줄: `types.ts` → `builders.ts`(+`buildScene`), `cityPlan.ts INCIDENT_PLACES`, `incidents.ts`, `callSystem.ts`(`NATURE_TEXT`·`NATURE_LIK`·`natureFor`·질문·`TOPIC_VALUE`), `analyst.ts`, `commander.ts`, `agents.ts fitFor`, `sceneManager.ts LIMIT`, `debrief.ts RESP_LIMIT`, `util.ts TYPE_NAME`, `view/renderCity.ts`, `view/icons.ts`, `ui/panels.tsx`.

거기에 없는데 실제로 유형을 보는 자리 [확인]:

1. **`scenarios/*.ts` 의 `lik` 22개**와 그것을 보는 시험 둘(`ext.test.ts:37`, `major.test.ts:64-65`) — 안내서는 `NATURE_LIK` 만 말한다.
2. `analyst.ts` 의 숫자 색인 `lp[3]`·`lp[1]`, 끝 갈래가 무장인 두 사슬.
3. `dispatch/dispatcher.ts` — 장비 가점(`:64-65`), `airFit`(`:92-101`), 구조정(`:128`), 선착 대응(`:175·233`).
4. `field/executor.ts` — `noAirEntry`(`:281`) 등 8곳.
5. `field/hazards.ts` — 악화 식의 유형 계수(`:196-199`), `applyCallerAid`(`:263-284`).
6. `field/injury.ts` `initialCause`·`smokeCause` (H1) + `tests/injuries.test.ts:231`.
7. `field/airDecide.ts`, `crews.ts isHovering` (R1) + `tests/crews.test.ts:58·849-855`.
8. `field/catastrophe.ts NO_STRUCT` (X6).
9. `sceneManager.ts:245-250`(유형별 세계 규칙 호출)·`:326-332`.
10. `debrief.ts` 의 판정 분기(`:42·78·82·88·160`) — 안내서는 `RESP_LIMIT` 만 말한다.
11. `view/city/trafficLayer.ts:169 CAUSE_COLOR`, `view/scene/staticLayer.ts`, `view/renderScene.ts`, `view/hazardState.ts pinIcon`.
12. `disaster.ts` 의 재난별 사건 표.
13. `builders.ts:797 sealPockets`.

유형 글자와 견주는 줄 수(정규식으로 센 근삿값, src): `callSystem` 28 · `commander` 26 · `analyst` 18 · `incidents` 12 · `renderScene` 10 · `agents` 10 · `sceneManager` 9 · `executor` 9 · `dispatcher` 9 · `staticLayer` 8 · `hazards` 8 · `injury` 6 · `airDecide` 6 · `debrief` 5 · `hazardState` 4 · 그 밖 18파일에 1~3줄. 시험: `sim.test.ts` 22줄.

### 1.4 가장 최근의 유형 추가 — 수난(F1)

- `git log --grep F1` 은 커밋 하나(`c776fc4`, 2026-11-14): "수난 사고, 다수 사상자 사고, 응급실 인계 대기, 가스 누출 출입구 통제" 네 기능이 한 커밋이다.
- 커밋 전체: **24파일 +409/−145**. src 20파일 +270/−59(시뮬레이션 14파일 +197/−52, 화면 6파일 +73/−7), 시험 +44/−1. src 에 더해진 266줄은 **28,072자**(줄당 평균 105자 — 이 저장소의 줄은 길다. 줄 수로 크기를 어림하면 작게 보인다).
- 그 가운데 수난 낱말이 든 더해진 줄은 src 18파일·75줄쯤 + `sim.test.ts` 7줄(낱말 맞춤이라 하한): `callSystem` 13 · `builders` 11 · `analyst` 7 · `renderScene` 6 · `hazards` 6 · `executor` 6 · `incidents` 5 · `types` 4 · `commander` 3 · `staticLayer`·`sprites`·`renderCity`·`sceneManager`·`agents` 각 2 · `icons`·`panels`·`util`·`debrief` 각 1.
- 그 전의 유형 추가(`78ad889`, 붕괴 + 가스 누출 두 유형): 21파일 +396/−57, src 19파일 +357/−53(33,900자).
- **그 뒤로 자리가 늘었다**: 지금 수난을 유형의 뜻으로 읽는 파일은 src 26개(시뮬레이션 20 + 화면 6)다 — F1 때의 18개에 `dispatcher`·`airDecide`·`crews`·`injury`·`cityPlan`·`disaster`·묶음 파일 넷·`trafficLayer`·`disasterLayer` 가 더해졌다(R1·H1·N6·G4 가 유형 분기를 더했다).

### 1.5 일곱 묶음이 다 합쳐지면 더 늘어날 자리

| 묶음 | 유형을 보는 새 자리 | 근거 |
|---|---|---|
| H1 (구현 중) | `injury.initialCause` 표, 악화 원인 이름, `tests/injuries.test.ts` 의 표 | [확인] 이미 코드에 있음 |
| X6 (단계 1 만) | `NO_STRUCT`(변형 목록), 화재 유형 + 건물 종류별 드럼통 놓기(§3.4 — `chemical`·`factory`·`storage`·`warehouse`·`workshop`), 붕괴 유형의 처음 건전도 | [확인] `NO_STRUCT`·`catOf`, 나머지 [설계서] |
| R2 | 방법 표는 **임무(WorkKind)별**이다(§4.1~4.9). 유형을 직접 보는 것은 일부 조건뿐(`s.kind === 'collapse'` 의 청음 탐지, 무장 현장의 농성 문 잠금, 물 있는 현장의 `s.flow`). R2 는 `WorkKind` 를 늘리지 않는다고 못박았다(§3.1) | [설계서] |
| R3 | `DocCtx.kind: IncidentType`·`label`(관제의 이름표), 교본 줄의 조건이 `s.kind === '…'` 로 쓰여 있다(P16·F18·S02·S10·S19·S22 …). 균형 목표가 유형별(§8.2) | [설계서] |
| I1-b | 규칙의 조건이 유형을 본다(재발화 = `s.kind === 'fire'`, 관제의 폭발 뒤 화재 신고 가산 등). `SpawnOpts` 에 `cause`·`csq` 가 더해지고 연쇄 깊이 상한이 모든 연쇄에 걸린다 | [설계서] |
| I2 | 이어받는 건물 상태 표가 유형별(화재 소실률, 붕괴) | [설계서] |

→ N8 을 구현할 때 새 유형은 위 표의 자리까지 더 고쳐야 한다. 새 **시나리오**는 임무와 생김새로 물려받는 것이 많다(§2.6).

---

## 2. 새 시나리오(변형) 하나의 비용

### 2.1 끼워 넣는 자리와 실제 서명 [확인]

| 무엇 | 파일 | 서명 (`field/sceneRegistry.ts`) |
|---|---|---|
| 표 | `scenarios/<묶음>.ts` → `scenarios.ts:43` 의 `SCENARIOS = [...LIFE, ...CHASE, ...CRIME, ...MAJOR, ...DISASTER]` | `Scenario`(아래) |
| 현장 | `field/scenes/<묶음>.ts` | `registerScene(type: IncidentType, variant: string, fn: (sim, I, rng) => Scene)` — 열쇠 `"유형/변형"`, `buildScene` 이 맨 먼저 찾는다 |
| 세계 규칙 | `field/rules/<묶음>.ts` | `registerRule((sim, s, I) => void)` — 매 틱·모든 현장, 자기 현장이 아니면 첫 줄에서 돌아간다 |
| 지휘 규칙 | `field/orders/<묶음>.ts` | `registerOrders((sim, s, I, a, k: CommandKit) => void)` — `k.want(kind, target, priority, max?, thorough?)`·`k.cancel(pred)`·`k.request(need, reason, urgent)`·`k.countUnits(need, min)`·`k.unitsOnScene()` |
| 종료 막기 | 같은 파일 | `registerBlocker((sim, s, a) => boolean)` |
| 소품 그림 | `view/scene/skins/<묶음>.ts` → `view/scene/skins.ts` 의 `SKINS` 에 펼쳐 넣는다 | `SkinPainter = (g, p: Prop, timeMs, truth, simT) => void` — 소품 가운데가 원점, 1 = 한 칸 |
| 등록 순서 | `field/scenes/index.ts` | `crime → major → disaster`(현장·규칙·지휘 순) → `rules/injury`·`orders/injury` → `rules/catastrophe` → `rules/air`(마지막). **`SCENE_RULES`·`ORDER_RULES` 는 등록 순서대로 돈다** |

`Scenario` 의 칸(`scenarios.ts:23-41`): `type, variant, name, share, nature, vague, severity:[lo,hi]` 필수 + `places`, `texts`, `lik`, `label`, `needs(n, ctx)`, `limit`, `delay`, `onCreate`, `onClose`, `node(sim, rng, busy)`, `gate(sim)`, `tag`. `needs` 가 보는 것은 `ScenarioCtx { sev, hurt, trapped, nat }` 뿐이다(관제가 아는 것).

`ext.test.ts:52-58` 은 `field/orders/` 폴더의 **모든 파일**을 글자로 훑는다(`s.props`·`s.casualties`·`s.hostiles`·`.truth`·`s.fire[`·`s.smoke[`·`sim.scenes` 금지) — `orders/kinds.ts` 를 만들면 저절로 걸린다.

### 2.2 추첨 규칙 (`incidents.ts:73-99`, `:155-205`) [확인]

1. 유형을 먼저 뽑는다(`rng.weighted(types, w)`), 그다음 심각도(`sevWeights`).
2. 시나리오: `cs = SCENARIOS.filter(유형이 같고 tag 가 major·disaster 가 아님)`. **`cs` 가 비어 있지 않을 때만** `r = rng.next()` 를 한 번 뽑고, 표의 순서대로 `r -= q.share` 하다 음수가 되는 것을 고른다. `gate` 가 거짓인 줄은 건너뛴다(몫을 깎지 않는다).
3. 고르지 못하면 유형의 기본 변주(`:87-97`)로 간다.
4. 장소: `scenario.places ?? INCIDENT_PLACES[type]`. 값은 **건물 종류 전체의 몫**이라 그 종류의 건물 수로 나눈다(`pickPlace`, `:49-67`). 출동 시설(`facility >= 0`)은 뽑히지 않는다. 진행 중인 사건의 교차로·이미 사건이 났던 건물은 엄격 추첨에서 빠지고, 후보가 없으면 그 제한을 푼다. `node` 가 있으면 길 위(건물 없음, `placeId = -1`).
5. `tag: 'major'`: 교대마다 `rngMajor.chance(tune.majorProb)`(보통 0.45)로 많아야 한 번, 시각은 교대의 18~70% 지점, `rngMajor.weighted(cs, share)` 로 고른다(`:178-186`).
6. `tag: 'disaster'`·`share: 0`: 추첨되지 않는다. `disaster.ts` 의 직접 호출, `gen.chain` 예약, `sim.force` 로만.
7. 연쇄: `chain.canChain` — 한 사슬 3건, 한 교대 6건(예약 포함). 예약은 `sim.t < shiftLen − 150` 이고 열린 사건이 `maxConcurrent` 이하일 때만 일어난다.
8. 교대당 사건 수: 보통 `maxIncidents` 15 · `maxConcurrent` 5(실측 14.18건/교대).

지금의 몫(평소 추첨, 유형 안에서):

| 유형 | 시나리오와 몫 | 합 | 남는 기본 몫 | 상한까지 |
|---|---|---|---|---|
| 화재 | 방화 0.10 | 0.10 | 0.90 (기본·오인 신고) | 0.65 |
| 교통 | 쓰러진 나무 0.14 · 맨홀 0.07 · 난폭 운전 0.09 | 0.30 | 0.70 (기본·버스) | 0.45 |
| 무장 | 가정 폭력 0.16 · 침입 절도 0.14 · 납치 0.08 · 폭발물 0.04 · 폭파 협박 0.04 · 수상한 물건 0.04 · 대형 인질극 0.04 · 폭동 0.04 · (도주 차량 0) | 0.58 | 0.42 (강도·난동·총격·인질극·장난) | **0.17** |
| 붕괴 | 승강기 갇힘 0.32 | 0.32 | 0.68 | 0.43 |
| 실종 | — | 0 | 1 (배회 0.45 · 조난 0.55) | 0.75 |
| 응급 | — | 0 | 1 (심각도 1 실신 · 2 낙상·외상 · 3 심정지) | 0.75 |
| 가스 | — | 0 | 1 (한 가지) | 0.75 |
| 수난 | — (해안 대피는 재난 전용) | 0 | 1 (한 가지) | 0.75 |

상한 0.75 는 `tests/ext.test.ts:33-34` 가 건다. 대형 사고 여섯(비중): 비행기 1.0 · 선박 1.0 · 열차 1.2 · 가스 폭발 1.6 · 크레인 1.2 · 다중 추돌 1.6.

### 2.3 순서가 결과를 바꾸는 곳 — 새 묶음 파일은 어디에 서나 [확인]

- **`SCENARIOS` 의 끝에 붙이면**(`[..., ...DISASTER, ...KINDS]`) 같은 유형의 기존 시나리오가 차지하던 `r` 구간은 그대로다. 새 시나리오는 기존 합 뒤의 구간, 곧 **예전에 기본 변주로 가던 자리**를 가져간다. 그래도 그 사건부터 난수 소비가 달라져(특수: `rng.int(sev)` / 기본: 변주 추첨) 그 교대의 뒤쪽 사건은 모두 달라진다 — "균형은 같고 시드별 결과는 바뀐다".
- **실종·응급·가스·수난에 첫 평소 시나리오를 더하면** 지금은 뽑지 않던 `rng.next()` 한 번이 그 유형의 **모든** 사건에 새로 들어간다(`if (cs.length)`). 그 유형이 한 번이라도 나온 교대는 그 뒤가 전부 달라진다.
- 대형 사고를 더하면 `rngMajor.weighted` 의 합이 바뀌어 **대형 사고가 있는 모든 교대의 대형 사고 종류**가 바뀐다.
- `nature` 키는 표를 읽을 때 `NATURE_TEXT`·`NATURE_LIK` 에 덮어쓴다(`callSystem.ts:62`) — 같은 키를 쓰는 뒤의 줄이 앞을 덮는다. 기본 키(`smoke`·`bang`·`scream` …)와 겹치면 기본 문구가 바뀐다. `vague` 는 **이미 있는 키**여야 한다(없으면 `rng.pick(undefined)` 예외).
- `natureLabel`(`scenarios.ts:69`)·`hazardState.shownVariant` 는 `SCENARIOS.find` — 같은 유형에서 `nature`(또는 `label`)가 겹치면 **앞의 줄**이 이긴다(폭발물·폭파 협박이 일부러 같은 키를 쓴다).
- 분석의 `needs` 는 `SCENARIOS` 순서대로 모두 적용된다(`analyst.ts:187`) — 뒤의 줄이 앞을 덮을 수 있다.
- 세계 규칙·지휘 규칙은 등록 순서대로 돈다. 새 묶음을 `scenes/index.ts` 의 어디에 두느냐는 **자기 현장에서** 부상 규칙(`rules/injury`)·위험의 현실화(`rules/catastrophe`)·상공의 헬기(`rules/air` — 주석에 "마지막에 돈다")와의 앞뒤만 정한다. 기존 묶음 셋은 모두 부상 규칙 앞이다.
- 순환 가져오기: `scenarios/*.ts` 는 `callSystem`·`incidents`·`pursuit` 를 가져오면 안 된다(`scenarios/crime.ts:2-3` 주석). 지금 가져오는 것은 `types`·`events`·`chain`·`city`·`traffic` 뿐이다. 달리는 차로 시작하는 시나리오는 `incidents.ts:149` 의 `startPursuit` 줄(공용 파일)에 변형 이름을 더한다.

### 2.4 그래도 공용 파일을 고쳐야 하는 경우 [확인]

| 하고 싶은 것 | 고칠 공용 파일 | 왜 |
|---|---|---|
| 기본 현장을 조금 바꿔 쓰기 | `builders.ts` | 내보낸 것은 `buildFire`·`buildStop`·`buildCollapse`·`armedVenue`·`pickArch`·`planOpts`·`fuelUp`·`farRooms`·`tallP`·`floorMatOf`·`doorOf` 뿐. **`buildTraffic`·`buildRoadIncident`·`buildElevator`·`buildSearch`·`buildArmed`·`buildMedical`·`buildHazmat`·`buildWater` 는 내보내지 않는다.** 길 위 현장의 틀 `roadFrame` 도 `scenes/major.ts` 안에 갇혀 있다 |
| 거짓 신고·오인형 시나리오 | `debrief.ts:68-72·156-157`, `incidents.ts:132`, `callSystem.ts:66-67`, `scripts/metrics.ts:576` | "실제 사건 없음"은 변형 이름(`false`·`prank`·`bombthreat`·`package`)으로 박혀 있다 |
| 관제가 이름표로 부대를 고르게 | `dispatcher.ts:93·99·128` | `as.label === '산불'`·`'선박 화재'` 처럼 **이름표 글자**로 헬기·구조정을 가른다 |
| 응급 유형에 환자 둘 이상 | `callSystem.ts:127-144` | 응급 분기가 `s.casualties[0]` 한 명과 "한 명이에요"를 박아 둔다 |
| 유형의 표에 없는 건물에서 일어나게 | `analyst.ts:42-46` (또는 `cityPlan.INCIDENT_PLACES`) | `placePrior` 는 **유형의 표만** 본다 — 시나리오의 `places` 를 보지 않는다. 표에 없는 건물이면 자기 유형의 사전 확률이 0.5(있는 유형은 1.2)라 오판(`MISJUDGE_TYPE`)이 는다 [추측: 크기는 재지 않음]. 예: 응급의 표는 집 8종뿐 — 경기장·역의 응급 환자는 화재·무장 쪽으로 기운다 |
| 한계 시간을 변형마다 | 없음 | `Scenario.limit`(더하는 초)로 된다 |
| 새 임무 종류 | `types.ts WorkKind` → `agents.ts workLabel`(`Record<WorkKind,string>` — tsc 가 잡음)·`fitBase` → `executor.ts` case → `commander.ts needFor` + R2 의 `WORK_MODE`·방법 표, R3 교본 줄 [설계서] | R2 는 `WorkKind` 를 늘리지 않는다는 방침 |
| 새 소품 종류 | `types.ts PropKind` → `agents.agentCost`(소품은 길을 막는다) → `renderScene.ts:360-424` 분기 + `sprites.ts`. **`Prop.skin` 으로 기존 종류에 새 그림만 입히면 공용 파일은 0** | N4b·N5·N6 가 쓴 방식 |
| 새 문제 코드 | `types.ts ProblemCode` → `debrief.ts PROBLEM_LABEL`(tsc)·`order`·문장 → `scripts/metrics.ts PROBLEM_SYS`(`tests/causality.test.ts:145-147` 이 모든 코드가 표에 있는지 본다) | |
| 새 필요 자원(Needs 열쇠) | `types.ts Needs`·`UnitCaps`, `analyst.ts NEED_NAME`·`emptyNeeds`, `dispatcher.ts MINCAP`·`NEED_LABEL`, `commander.ts:67·117`, `resources.ts caps()`·`KIND`, `scripts/metrics.ts NEED_KEYS` | `eod` 를 더할 때의 자리 |

### 2.5 실측 — 지난 시나리오 묶음의 크기

| 묶음 | 내용 | 전체 | 자기 파일 | 공용 파일 |
|---|---|---|---|---|
| N4b `wf/crime` | 시나리오 7(폭발물 셋·대형 인질극·도주 차량·폭동·방화) | 15파일 +898/−23 | 6파일 +804 | 9파일 +94/−17: `pursuit` +32 · `executor` +25 · `builders` +14 · `debrief` +6 · `hazards` +6 · `agents` +5 · `commander` +3 · `renderCity` +2 · `incidents` +1 |
| N5 `wf/major` | 시나리오 6 | 11파일 +1048/−7 | 5파일 +1033 | 6파일 +15/−3: `renderCity` +5 · `styles.css` +5 · `panels` +2 · `dispatcher`·`builders`·`executor` 각 +1 |
| N6 `wf/disaster` | 시나리오 3 + 재난 5종 | 11파일 +1508/−23 | 10파일 +1496 | 1파일 +12 (`styles.css`) |

(합치기 직전의 브랜치 차이 — 그 뒤의 검토 커밋은 뺐다. 설계서 길이: N4b 167줄 · N5 85줄 · N6 102줄. 뒤의 큰 묶음은 1,200~1,500줄.)

새 임무(`defuse`)·새 소품(`bomb`)을 더한 N4b 가 공용 파일을 가장 많이 건드렸고, 기존 임무와 스킨만 쓴 N5 는 15줄이었다.

### 2.6 시나리오가 **유형에서 물려받는 것** — 유형을 고르는 것이 곧 규칙을 고르는 것 [확인]

| 유형 | 저절로 붙는 것 | 현장이 지켜야 하는 것 |
|---|---|---|
| 화재 | `tickFire`(연료가 있으면 탄다), 위험한 건물(공기호흡기 대원만 실내), 잔불 정리, 급수 연결, 헬기 0.5 | 신고자 모델이 `kind === 'room'` 구역에서 목격 위치를 뽑는다(`callSystem.ts:199-204` — 방이 없고 사람이 있으면 예외) |
| 교통 | 건물 없음(`pickPlace` 를 부르지 않는다 — `node` 가 없으면 무작위 교차로), 구간 지연 `slow += 1.4`(`incidents.ts:135-139`), 도로 정리·교통 통제, `tickLane` | `s.laneRows`·`controlPts` |
| 실종 | `tickWander`(대상이 `wander` 면), 구역 확률 수색, 험한 지형 속도, 바깥 노출, 헬기 1 | **`isTarget` 인 사람이 꼭 있어야 한다**(`callSystem.ts:206` 의 `find(...)!` — 없으면 예외), `kind === 'zone'` 구역 |
| 무장 | `hot`(안전 확보 전 경찰만 진입), 봉쇄·협상·교전·검거, `s.secureAt`, 용의자 없으면 수색 뒤 확보 | `s.exits`·`s.spots`(봉쇄 자리 — 길 위 현장도), `ARMED_BIAS` 는 기본 변형만 |
| 응급 | `tickMedical`(변형 `faint`·`trauma`·`arrest` 만 급변), 선착 대응(`dispatcher.ts:233`), 환자를 찾으면 수색 끝, `needs.search`(위험도 2.3↑) | 신고자 모델이 `casualties[0]` 한 명을 가정 |
| 붕괴 | `tickCollapse`(균열부), `tickCrush`(승강기 변형이 아니면), 위험한 건물, 탐지 장비 효과, 구출 중 사고(H1) | — |
| 가스 | `tickGas`, 통제선(`perimeter` — 누출을 알면), 독성 계수 0.62, 위험한 건물, 주변 시민 노출 | — |
| 수난 | `tickWater`(표류), 소방 헬기가 상공에 머묾(`isHovering`), 구조정(바닷가만), 헬기 구조 1 | 물 칸은 구역이 없다(`s.region = −1`) |

- 유형의 규칙을 **뺄** 방법은 없다(`s.rules` 는 붕괴·가스·수난을 얹기만 한다). 그래서 "응급인데 급변이 없는" 것은 변형 이름으로 저절로 되지만(급변은 세 변형만), "붕괴인데 압궤가 없는" 것은 `sceneManager.ts:249` 를 고쳐야 한다(승강기처럼).
- 현장의 한계 시간·대응 지연 기준·유형색·아이콘·통화 질문도 유형의 것을 쓴다.
- 지도의 핀은 유형 아이콘·유형색만 보인다(변형 아이콘은 붕괴의 넷뿐 — `hazardState.ts:84-88`). 시나리오가 달라진 것은 **사건 카드의 제목(`as.label`)과 현장 화면**에서만 보인다. 지도 틀의 글자(`Viewport.tsx:147`)는 `TYPE_NAME` 만 쓴다. → 유형을 그대로 두고 변형만 늘리면 지도에서는 "여전히 여덟 가지"로 보인다 [확인: 코드 / 체감은 추측].

### 2.7 시험이 시나리오에 거는 것 [확인]

| 시험 | 조건 |
|---|---|
| `ext.test.ts:31-42` | 유형별 평소 몫의 합 ≤ 0.75 · 모든 줄에 `tag` · `lik` 길이 8 · `texts` 가 있으면 1개 이상 · **등록된 현장 생성기(`SCENE_BUILDERS` 의 열쇠)는 모두 시나리오 표에 있다** |
| `sim.test.ts:716` | **`tag` 가 `life`·`chase` 인 시나리오는 S0~S39 에서 저마다 3번 이상 나와야 한다.** 몫이 작은 새 시나리오에 `life` 를 붙이면 깨진다(지금 강력 범죄 0.04 짜리는 40교대에 1~7번). 새 태그를 쓰면 걸리지 않는다 |
| `sim.test.ts:640` | 연쇄·재난이 아닌 사건의 건물 종류는 `scenario.places ?? INCIDENT_PLACES[type]` 에 0 보다 큰 값으로 있어야 한다 |
| `sim.test.ts:721` | 40교대의 한계 시간 종료 < 전체의 3% |
| `major.test.ts:59` | `tag: 'major'` 의 집합이 시험 안의 여섯과 **정확히** 같다 — 대형 사고를 더하면 그 시험을 함께 고쳐야 한다 |
| `disaster.test.ts:309-311` | 재난 시나리오 셋은 `tag 'disaster'`·`share 0` |
| `specs/README.md` §3·§4 | 새 시나리오마다 `--force` 20교대에서 한계 시간·방치 종료 2건 이하, `npm run check` 의 균형 범위 |

시드에 기대는 시험(새 시나리오가 평소 추첨에 들면 **모든 시드의 사건 구성이 바뀌므로** 흔들릴 수 있는 것) [확인: 조건 / 깨질지는 추측]:

- `sim.test.ts` 의 건수 문턱(시험마다 시드 범위가 다르다 — 30·40·50교대 또는 강제 발생): 응급 > 8(`:247`), 인질극 > 3(`:324`), 붕괴 > 5·가스 > 5(`:352-353`, S0~S29), 2층 화재 > 5(`:438`), 수난 > 8(`:524`, S0~S39), 버스 > 3(`:541`), **납치 > 4·난폭 운전 > 4(`:764`, S0~S49 50교대)**, 생활 사건 성공률 > 0.6(`:720`) 등. 배회 > 15(`:793`)는 `search/wander` 를 강제로 일으킨 W0~W11 이라 평소 추첨에 덜 기댄다. 지금 S0~S39 실측: 수난 26 · 버스 11 · **납치 4 · 난폭 운전 3**(50교대 문턱 '4 초과'에 여유가 작다 — 지금은 통과하는 상태이고, 시드별 구성이 바뀌면 가장 먼저 흔들릴 후보) · 인질극 3.
- `tests/causality.test.ts:148` — **보통 S7 한 교대**의 기록에 T1(인근 도시 지원 요청)·T2(응급실 대기)·T3·T4·T7 문구가 모두 나와야 한다. S7 의 사건 구성이 바뀌면 T1·T2 가 안 나올 수 있다.
- `npm run ui-check` 의 기본 시드 S3(150초 안에 현장 대응 사건이 있어야 한다), 안내서의 `--log S7`.

---

## 3. 빈 자리 — 쓰이지 않거나 덜 쓰이는 재료

### 3.1 지금의 분포 (보통 40교대, S0~S39, HEAD `823194e`)

567건(14.18건/교대) · 성공 79% · 부분 10% · 지연 5% · 미해결 2% · 실패 5% · 종료 사유 resolved 565 · abandoned 2 · 한계 시간 0.

| 유형 | 건 | 몫 | 모습(건) |
|---|---|---|---|
| 화재 | 116 | 20.5% | 기본 97 · 방화 12 · 오인 6 · 선박 1 |
| 교통 | 113 | 19.9% | 기본 70 · 쓰러진 나무 16 · 버스 11 · 맨홀 6 · 다중 추돌 4 · 난폭 운전 3 · 열차 3 |
| 무장 | 87 | 15.3% | 가정 폭력 16 · 침입 절도 14 · 난동 11 · 강도 11 · 폭동 7 · 폭파 협박 5 · 장난 5 · 납치 4 · 대형 인질극 4 · 인질극 3 · 총격 3 · 수상한 물건 2 · 폭발물 1 · 도주 차량 1 |
| 응급 | 73 | 12.9% | 낙상·외상 42 · 실신 17 · 심정지 14 |
| 실종 | 61 | 10.8% | 조난 35 · 배회 26 |
| 붕괴 | 51 | 9.0% | 기본 32 · 승강기 11 · 크레인 5 · 가스 폭발 3 |
| 가스 | 40 | 7.1% | 기본 40 |
| 수난 | 26 | 4.6% | 기본 26 |

- 가능한 모습은 39가지(기본 16 + 시나리오 23), 40교대에 실제로 나온 것은 36가지. 교대 하나(14건)에서는 위 여덟 모습이 65%다.
- 측정 도구의 `variety: … flat search/wander,traffic/tree`(결과가 한 가지로만 끝나는 시나리오), `actions lowest collapse/elevator 1.6 · armed/burglary 1.7 · armed/dispute 1.91`(행동이 단조로운 것).

### 3.2 건물 종류 — 사건이 나지 않거나 드문 곳

지도: 건물·터 1,302곳(출동 시설 14 포함), 교차로 173, 구간 257. `PlaceKind` 68가지.

**사건이 한 번도 날 수 없는 종류**(유형 표에도 시나리오 `places` 에도 없음) [확인]:

| 종류 | 수 | 비고 |
|---|---|---|
| `greenhouse` 비닐하우스 | 27 | `KIND_SCENE` 없음. 산불의 예비 표(`WILD_NEAR`)에만 |
| `parking` 주차장 | 20 | 터 |
| `school` 학교 | 2 (+시설 1) | 한솔중학교·동문고등학교. `KIND_SCENE` 없음 |
| `prison` 교도소 | 1 | `KIND_SCENE` 없음 |
| `amusement` 놀이공원 | 1 | 터. 교통의 행사 인파(`traffic.ts:52 VENUES`)와 해일(`COAST_KINDS`)에만 |
| `dam` 댐 · `lighthouse` 등대 · `tower` 관제탑 | 각 1 | 등대는 해일 표에만 |
| `restStop`·`playground`·`farmland` | 0 | 종류는 있으나 지도에 한 채도 없다(비행기 추락의 `farmland: 2` 는 죽은 값) |
| 출동 시설(소방서 6·경찰서 3·병원 2·시청·물류터미널·서림초) | 14 | `pickPlace` 가 `facility >= 0` 을 뺀다 — 병원·경찰서에서는 사건이 나지 않는다 |

**한두 가지 유형에서만, 드물게**:

| 종류 | 수 | 지금 |
|---|---|---|
| `church` 교회 9 · `cathedral` 성당 1 · `library` 도서관 1 | 11 | 화재만(유형 안의 0.5~1%) — 40교대에 교회 2건 |
| `dorm` 기숙사 | 1 | 화재 1% · 응급 2.3% |
| `clinic` 의원 | 23 | 화재 1%·무장 1%·승강기·침입 절도 — 40교대 1건 |
| `hotel` 호텔 | 7 | 40교대 1건 |
| `cafe` 카페 95 · `convenience` 편의점 59 · `pension` 펜션 88 | 242 | 40교대 5 · 5 · 5건(수는 많은데 몫이 작다) |
| `hangar` 격납고 2 · `substation` 변전소 1 · `reservoir` 저수지 1 | 4 | 화재 0.5%/가스 2% · 가스 4.1% · 수난 10.7% |
| `runway` 활주로 · `containerYard` 컨테이너 부두 · `lookout` 전망대 | 각 1 | 대형 사고·재난 전용 |
| `park` 공원 5 · `campsite` 캠핑장 1 | 6 | 실종(15%·8%)·납치 |
| `stadium` 경기장 · `station` 기차역 · `busTerminal` · `terminal`(공항) · `deptStore` · `mart` · `market` · `museum` · `broadcast` · `university` · `powerPlant` | 각 1 | 화재 0.3~1.5% + 강력 범죄(폭발물·폭동·인질극) — 사람이 많은 곳인데 **응급·실종·다수 환자 사건이 없다** |

40교대에 사건이 가장 많이 난 곳: 숲 56 · 다세대 42 · 작은 단독 37 · 아파트 34 · 사무용 21 · 창고 18 · 큰 단독 18 · 상점 16 · 공업사 15 · 공장 14 · 식당 14 · 해수욕장 13. 길 위(건물 없음) 118건.

유형별 장소의 좁음 [확인]: **응급은 집 8종에서만**(작은·큰 단독, 다세대, 아파트, 오피스텔, 기숙사, 농가, 펜션) — 현장도 언제나 "집 한 채에 환자 한 명"(`buildMedical`). **실종은 숲 77% · 공원 15% · 캠핑장 8%** — 도심·시장·놀이공원·역의 실종(아이·치매 어르신)이 없다. **수난은 하천 43% · 해수욕장 29% · 부두 18% · 저수지 11%**. 교통은 언제나 교차로.

`KIND_SCENE` 이 없는 건물 종류(학교·교도소·등대·댐·관제탑·비닐하우스·시설들)는 평면을 구역(`district`)의 틀로 만든다(`pickArch` 의 대체 갈래) — 현장은 만들어지지만 방 이름이 "호실·점포·작업실" 같은 구역 기본값이다. 건물 종류별 방 이름(`builders.ts:25-29 KIND_ROOMS`)·가구(`planOpts`)를 주려면 `cityPlan.KIND_SCENE`·`builders.ts` 를 고친다.

### 3.3 지형

| 지형 | 지도에 있는 것 | 지금 쓰는 사건 | 빈 자리 |
|---|---|---|---|
| 강 | `city.river`, 하천 터 6 | 수난 기본, 홍수 | — |
| 다리 | `bridge` 구간 **5** | 홍수 때 통제뿐 | **다리 위의 사건 없음**(P2 의 "다리 위의 위기자"). 사건 위치는 교차로이므로 다리 구간의 끝 교차로를 `node` 로 고르는 방식이 된다 |
| 바다·해안 | `coastY`, 해수욕장 1(640×80), 부두 2, 수산시장, 여객선 터미널, 컨테이너 부두 | 수난 기본(해수욕장·부두), 선박 화재, 해안 대피, 해일 | 구조정이 가는 것은 바닷가 수난·'선박 화재'뿐 — 40교대에 **6번** 출동 |
| 산 | `mountainAt`, 숲 6, 전망대, 사찰, 캠핑장 | 조난, 산사태·산불(재난) | 평소의 산악 사고(추락·낙석)는 없음 |
| 철길 | `city.rail`, 건널목 구간 **6**(`gateT`), 기차역 | 열차 탈선(대형), 건널목 대기(교통) | 평소의 건널목·선로 사건 없음 |
| 고속도로 | `highway` 구간 5 | 다중 추돌(대형) | — |
| 공항 | 활주로·터미널·관제탑·격납고 2·항공유 저장소·주차장 | 비행기 추락(대형), 터미널의 폭발물·인질극 | 격납고·저장소의 평소 사건은 몫이 아주 작다 |
| 항구 | 컨테이너 부두·어항·여객 부두 | 선박 화재·크레인 붕괴(대형) | — |
| 호수·댐 | `city.lake`, 저수지 1, 댐 1 | 수난 10.7% | 댐은 사건 없음 |
| 도시 밖 길 | `exit` 교차로 5 | 추격전의 도주, 지원 부대 진입 | — |

### 3.4 부대·역할·장비 (40교대 실측, 사건 567건)

처음 편성(보통) 19팀: 순찰 3 · 기동 1 · 펌프 3 · 사다리 1 · 구조 1 · 전문 구급 2 · 일반 구급 1 · 특공 1 · 소방 헬기 1 · 화학 1 · 구조정 1 · 폭발물 처리 1 · 경찰 헬기 1 · 의료 헬기 1.

| 부대 | 출동(40교대) | 간 사건 비율 | 메모 |
|---|---|---|---|
| 전문 구급 `als` ×2 | 424 | 68.6% | |
| 펌프 `engine` ×3 | 258 | 37.4% | |
| 순찰 `patrol` ×3 | 217 | 35.1% | |
| 일반 구급 `bls` (지원 부대 포함) | 184 | 29.1% | 편성 1 + 인근 도시 지원 |
| 구조 `rescue` | 126 | 22.2% | |
| 기동 `tactical` | 102 | 17.8% | |
| 사다리 `ladder` | 101 | 17.8% | **사다리로 하는 일은 없다** — 사다리 조작원은 펌프 조작·관창뿐(`crews.ts:112`, ROADMAP C4) |
| 의료 헬기 `medHeli` | 101 | 17.8% | |
| 화학 `hazmat` | 98 | 17.3% | |
| 소방 헬기 `heli` | 85 | 15.0% | |
| 특공 `swat` | 74 | 13.1% | |
| 경찰 헬기 `policeHeli` | 62 | 10.9% | |
| **폭발물 처리 `eod`** | **16** | **2.8%** | 폭발물 셋(무장의 0.12)에만 |
| **구조정 `boat`** | **6** | **1.1%** | 바닷가 수난·선박 화재에만 |

역할·장비 가운데 효과를 내는 자리가 좁은 것 [확인: 코드에서 읽는 줄]:

| 장비·역할 | 효과가 나는 곳 | 좁은 까닭 |
|---|---|---|
| 탐지 장비 `searchKit`(구조 팀장·탐지 대원) | `agents.ts:90`(은폐 ×0.45)·`:213`, 관제 가점 `dispatcher.ts:65` | **붕괴 현장에서만** |
| 원격 로봇 `robot`(로봇 조작 요원) | `executor.ts:841-842` | 폭발물 해체에서만(40교대에 해체 5건) |
| 해체 공구·폭발물 방호복 | `agents.ts`(`defuse`), `executor.ts:87` | 같음 |
| 저격 소총 `sniper` | `executor.ts:362`(명중 거리 식), 그림 | 저격이라는 행동은 없다(R2·R3 의 몫 [설계서]) |
| 방패 `shield` | `executor.ts` 2곳, `armorOf` | 무장 교전에서만 |
| 가스 측정기 `gasMeter` | `agents.ts:221`(새는 밸브를 벽 너머 7칸에서) | 가스 누출·가스 폭발에서만 |
| 누출 차단 장비 `plugKit` | `agents.ts`·`executor.ts`(밸브·연료 누출 +0.2) | 같음 + 교통의 연료 누출 |
| 확성기 `megaphone` | `executor.ts:879`(협상 ×1.2) | 협상에서만 |
| 경광봉 `baton` | `executor.ts:757`(교통 통제 ×0.85) | |
| 구조 로프·구명환 | 수난 구조의 장비 값, 관제 가점 | 수난·선박 화재·배회 실종자의 개울(40교대 수난 구조 53건) |
| 척추 고정판 `spineBoard` | `executor.ts:713` | 교통·붕괴의 구출된 사람 |
| 제세동기 `aed` | `executor.ts:654-666` | 심정지·체력 25 미만 |
| 열화상 `tic` | `agents.ts:80·92·212` | 연기 속에서만 |
| 공중 열영상 `flir`·탐조등 | `agents.ts`, `rules/air.ts` | 경찰 헬기 |
| 폭파 장약 `charge` | 없음 | R2 가 쓴다 [설계서] |
| 기본·전문 응급 가방 | 직접 읽는 줄 없음 — `medLevelOf` 의 `med` 값으로 | — |

### 3.5 임무 종류 (40교대에서 '끝남'이 된 작업, 유형별)

| 임무 | 끝낸 수 | 나온 시나리오 가짓수 | 유형 |
|---|---|---|---|
| `search` 수색 | 2,828 | 35 | 모든 유형 |
| `suppress` 진압 | 1,403 | 9 | 화재 1,238 |
| `treat`·`load`·`carry` | 971 · 844 · 789 | 27~29 | 고루 |
| `sizeup` | 718 | 35 | |
| `overhaul` 잔불 정리 | 687 | 9 | 화재 604 |
| `clearRoad` 도로 정리 | 602 | 7 | 교통만 |
| `traffic` 교통 통제 | 557 | 7 | 교통 544 · 납치 13 |
| `extricate` 구출 | 254 | 12 | 교통 140 · 붕괴 67 · 화재 47 |
| `mitigate` 누출·균열 조치 | 180 | 7 | 붕괴 73 · 가스 60 · 교통 47 |
| `hookup` 급수 연결 | 121 | 5 | 화재 117 |
| `arrest` 검거 | 95 | 9 | 무장 |
| **`interview` 면담** | **80** | **4** | 실종 61 · 방화 17 · 수난 2 |
| **`negotiate` 협상** | **58** | 8 | 무장 |
| **`waterRescue` 수난 구조** | **53** | **3** | 수난 46 · 배회 5 · 선박 2 |
| **`engage` 교전** | **41** | 7 | 무장 |
| **`hoist` 호이스트** | **10** | **1** | 수난 기본만 |
| **`defuse` 해체** | **5** | **2** | 폭발물·수상한 물건 |
| `escort` 동행 | 4 | 3 | |
| `airDrop` 물 투하 | 0 | 0 | 산불(재난)·바깥의 불만 — 평소 교대에는 없다 |
| `rescueMate` 동료 구조 | 0 | 0 | 드묾 |

세는 법의 한계: `force`(문 개방)·`clear`(잔해)는 작업판 항목이 아니라 이동 중의 하위 작업이라 0 으로 나온다. `perimeter`(봉쇄·통제)는 '끝남'이 아니라 취소로 닫혀 0 으로 나온다. 실제로는 쓰인다.

→ 드문 임무(면담·수난 구조·호이스트·해체·물 투하·협상)는 **이미 있는 임무라 새 시나리오가 새 코드 없이 부를 수 있다.** 다만 지휘관이 그 임무를 내는 조건이 유형·소품에 묶여 있다: 면담은 `witness` 소품, 수난 구조는 믿음 속 위치가 물 칸, 해체는 믿음의 `haz bomb`, 협상·교전은 용의자, 호이스트는 상공의 호이스트 부대 + 물속의 사람, 통제선은 가스 누출을 알거나 살아 있는 폭발물.

### 3.6 타일·소품·스킨 — 새 그림 없이 쓸 수 있는 것과 새로 그려야 하는 것

**이미 그림이 있어 새 시나리오가 그대로 쓸 수 있는 것** [확인]:

- 평면: `plans.ts` 의 복도형·방 연결형·홀형·2층(`planBuilding`·`tallPlan`·`suiteRooms`·`blockPassage`·`lockDoor`), `armedVenue`(상점·은행·사무실·창고·집), 가구 11종(`DECOR`: 침대·책상·탁자·소파·수납장·상자·기계·계산대·화분·주방·선반 — 모두 쓰임), `furnish`.
- 타일 13종: 땅·도로·바닥·벽·창·나무·**물**·바위·문·오솔길·가구·계단·빈 곳. 물 칸은 하천(`buildWater`)·바다(선박·대피)·개울(실종)에 이미 그려진다.
- 소품 12종과 놓는 곳: `door` · `debris`(잔해 — 평면·붕괴·산사태·대형) · `vehicle`(승용차·버스·`cover`) · `hydrant` · `gas`(가스 용기 — 화재만) · `clue`(실종만) · `witness`(실종·방화·배회) · `roadDebris` · `unstable`(균열부) · `valve`(가스 배관) · `bomb`.
- 스킨 13종: `tree`(쓰러진 나무)·`manhole`·`bombBag`·`bombBox`·`mud`(흙더미)·`fuselageNose/Mid/Tail`·`planeDebris`·`trainCar`·`craneBoom`·`shipHull`.
- 사람: 시민·용의자·대원(역할별)·쓰러진 사람·물속의 사람(`drawSwimmer`), 차량·버스, 헬기·구조정, 고깔(`drawCone`).
- 사람의 상태: `inWater`·`drift`, `hostage`, `isTarget`+`wander`, `inVehicle`, `mob`(걸음·못 걸음·갇힘), `bystander2`(사건 도중 늘어나는 사람), `panic`. 용의자: 무기 총·칼·없음, 상태 7가지, 인질·시한.
- 지도: 건물 68종의 지붕·터 그림이 모두 있다 — **이미 있는 건물 종류에서 사건을 내는 데는 지도 그림이 필요 없다.**
- 유형 아이콘 8 + 붕괴 변형 4(`elevator`·`crane`·`landslide`·`gasblast`), 유형색 8.

**새로 그려야 하는 것**:

| 무엇 | 필요한 그림 | 자리 |
|---|---|---|
| 새 유형 | 아이콘 1(24×24 경로), 유형색 1(기존 8색과 구별 — 주황·노랑·초록·보라·분홍·황토·연두·하늘이 쓰였다) | `icons.ts`·`renderCity.ts`·`trafficLayer.ts` |
| 변형별 핀 아이콘(선택) | 아이콘 + `pinIcon` 을 붕괴 밖으로 넓히기 | `icons.ts`·`hazardState.ts:84-88` |
| 기존 소품의 새 모습 | 스킨 함수 하나(공용 파일 0) | `skins/<묶음>.ts` |
| 새 소품 종류 | `renderScene.ts` 분기 + `sprites.ts` 그림 + 범례가 있으면 범례 | 공용 |
| 새 타일 | `grid.ts`(`staticPass`·`isIndoor`·`los`) + `staticLayer.ts`(`surfaceMap`·`paintTile`) | 공용 |
| 동물·끊어진 전선·난간·금고 같은 **새 물건** | 스킨(기존 소품 규칙에 입힐 수 있을 때) 또는 새 소품 | ROADMAP P2 의 소재는 모두 여기에 든다 |
| 움직이는 새 개체(동물 등) | 지금 움직이는 것은 사람(구조 대상·용의자)·통과 차량뿐 — 새 개체를 구조 대상이나 용의자의 규칙에 얹지 않으면 이동·시야·그림을 새로 만들어야 한다 [추측: 설계에 따라 다름] | — |

---

## 4. 화면 쪽 비용 요약

| | 새 유형 하나 | 새 시나리오 하나 |
|---|---|---|
| 지도 핀 | 아이콘·색 필수 | 없음(유형 것). 변형 아이콘을 원하면 `pinIcon` 을 고친다 |
| 통제 구간 색 | `CAUSE_COLOR` | 없음 |
| 사건 카드·상황 패널 | `panels.tsx:281` 확률 줄 | 없음 — 제목은 `as.label ?? TYPE_NAME`, 관찰자 줄은 `scenarioName` 이 저절로 |
| 대형 표시 | — | `tag: 'major'` 면 저절로(핀의 주황 고리 `renderCity.ts:290`, 카드 배지 `panels.tsx:73`) |
| 범례 | 없음(유형별 줄이 없다) | 새 소품 표식을 만들 때만 |
| 현장 바닥·길 | `staticLayer.ts`·`renderScene.ts` 의 유형 분기(바깥 현장이면) | 없음 |
| 소품 | 새 종류면 분기 | 스킨이면 자기 파일 |
| 보고서 | `TYPE_NAME`·`TYPE_COLOR` | 없음(`x.name ?? TYPE_NAME`) |
| 소리·카메라·통화창 | 없음 | 없음 |
| `marks.ts`(부대·시설·역할 기호) | 없음 | 없음 |
| `ui-check` | 유형 이름에 기대지 않음 | 같음 |
| 문구 | `TYPE_NAME` | `name`·`label`·`texts` (표 한 줄) |

---

## 5. 재현성·측정에 걸리는 것

- **난수 흐름의 이름**: `fork` 는 뿌리 시드 + 이름표의 해시다(`rng.ts:44` — 부모의 소비와 무관). 이름은 `'이름:' + I.id` 또는 `` `이름:${I.id}:${c.id}` `` 꼴이다. 지금 쓰는 이름(겹치면 안 됨): `traffic` `incidents` `nuisance` `major` `environment` `equipment` `disaster` `force` `kit` `parked` `rail` `local-streets` `places-v2` `roster-v1` `roster-v2:…` · 사건별 `scene:` `call:…` `agent:…` `pursuit:` `getaway:` `hideout:` `hideout-call:` `arson:` `arson-next:` `leave:` `air:` `aid:` · 현장별 `dmg:` `kit:` `injury:` `cat:` `catinit:` · 사람별 `wander:` `medical:` `crush:` `lift:`.
- 현장 생성기는 `scene:<사건 id>` 흐름을 받는다 — 현장 안의 추첨은 다른 사건과 섞이지 않는다. 사건 하나의 세계 규칙 상태는 WeakMap 에 둔다(안내서).
- 평소 추첨은 `rngGen`(`incidents`) 한 흐름이다 — **새 시나리오·새 유형은 이 흐름의 소비를 바꾸므로 모든 시드의 결과가 바뀐다**(§2.3). 결과 불변으로 넣을 수 있는 것은 `share: 0`(직접·예약·강제로만 일어남)뿐이다 — `ext.test.ts:23-30` 이 "강제 발생은 평소 추첨을 흔들지 않는다"를 본다.
- `scripts/metrics.ts`: 유형 목록이 없다. 걸리는 것은 **기록 문구**(`PHRASE` T1 지원 요청 · T2 응급실 대기 · T3 이송 출발 · T4 병원 인계 · T5 이어받은 상태 · T6 결원 중단 · T7 출동 지령)와 **문제 코드**(`PROBLEM_SYS` — 표에 없는 코드는 `field` 로 떨어지지만 `tests/causality.test.ts:145-147` 이 `PROBLEM_LABEL` 의 모든 코드가 표에 있는지 본다). 새 시나리오가 기존 문구를 쓰고 새 문제 코드를 만들지 않으면 고칠 것이 없다. `isBenign`(`metrics.ts:576`)은 변형 `false`·`prank` 와 `FALSE_ALARM` 문제로 가른다.
- 관문(`sweep --check`, `scripts/sweep.ts:148-164`): **유형별 수치는 없다.** 전체 값만 본다 — 예외 0 · 끝나지 않은 사건 0 · (보통 기본 조건에서) 한계 시간·무대응 ≤ 4% · 성공+지연 65~90% · 실패+미해결 3~25% · 평균 대응 ≤ 90초 + 지표 관문(연쇄 깊이 ≤ 4 · 교대당 연쇄 ≤ 8 · C1~C5 = 0 · 교착 후보 0 · 잊힌 사건 0). 지금 값: 성공+지연 84% · 실패+미해결 7% · 평균 대응 49초 · 연쇄 깊이 최대 2.
- 유형·시나리오별로 보는 것은 관문이 아니라 `--scen` 표와 `--metrics` 의 시나리오 표(행동·결과 엔트로피는 `n ≥ 5` 인 시나리오만), 그리고 뒤 묶음 설계서들의 균형 목표다(R3 §8.2 "유형별 ±5%p", X6 §9 "화재 −6%p 이내" — [설계서]).
- 열 수·시나리오 수에 기대는 시험: §1.2 의 셋 + `major.test.ts:59`(대형 사고 여섯의 정확한 집합) + `sim.test.ts:716`(`life`·`chase` 는 40교대에 3번 이상). **전체 시나리오 수(23)를 세는 시험은 없다** [확인: `SCENARIOS.length` 를 보는 시험 없음].
- 속도: 교대 하나 781ms(40교대 32초, 이 기계에서 다른 작업 둘과 함께). `registerRule` 은 매 틱 모든 현장에서 불리므로 자기 현장이 아니면 첫 줄에서 돌아가야 한다. 객체 모양(안내서 "자주 도는 객체의 모양"): 현장·소품·구조 대상에 새 선택 칸을 더하면 생성 글자(`kit.ts` 의 `baseScene`·`PROP_BLANK`·`addCas`)에도 넣는다.

---

## 6. 설계가 알아야 할 것 (사실에서 바로 나오는 것만)

1. **유형은 비싸고 시나리오는 싸다 — 그러나 지도에서 "종류"로 보이는 것은 유형이다.** 변형은 핀에서 유형 아이콘·유형색으로만 보인다(붕괴 변형 넷만 예외). 종류가 늘었다고 느끼게 하려면 (가) 새 유형, (나) 변형 아이콘을 붕괴 밖으로 넓히기(`pinIcon` — 화면 공용 파일 둘), (다) 카드 제목·현장 그림으로만, 가운데서 골라야 한다.
2. **새 유형은 반드시 `TYPES`·`types` 의 끝에** 붙인다(숫자 색인 `lp[3]`·`lp[1]`). 가능도 배열 42개에 열 하나, 시험 3곳, 문자열 열쇠 표 9개(tsc 가 못 잡음 — 특히 `LIMIT` 을 빠뜨리면 **한계 시간이 사라진다**).
3. **평소 추첨에 무엇을 더하든 모든 시드의 결과가 바뀐다.** 기준을 다시 재야 하고, 시드에 기대는 시험(§2.7)이 흔들릴 수 있다. 결과 불변으로 먼저 넣을 수 있는 것은 `share: 0` 뿐이다(틀·현장·시험을 먼저 합치고 몫은 나중에 켜는 단계 나누기가 된다 — 다른 묶음의 "결과 불변 준비 단계"와 같은 꼴).
4. **무장은 몫이 0.17 밖에 남지 않았다**(상한 0.75). 실종·응급·가스·수난은 0.75 가 통째로 비어 있고, 이 넷이 사건의 35% 다.
5. **응급·실종·수난의 장소 표가 좁다.** 사람이 많은 큰 건물(경기장·역·터미널·백화점·마트·시장·놀이공원·학교·대학)에는 화재와 강력 범죄만 있다. 이 건물들에 다른 유형의 시나리오를 놓으면 `placePrior` 가 자기 유형을 0.5 로 깎는다 — `analyst.ts:42-46` 을 시나리오의 `places` 도 보게 하거나, 유형의 표에 작은 값으로 더해야 한다(뒤쪽은 그 유형의 기본 사건이 나는 건물까지 바뀐다).
6. **덜 쓰이는 부대**: 구조정(6회)·폭발물 처리(16회)가 40교대에 거의 서 있다. 사다리차는 101회 나가지만 사다리의 일이 없다. 탐지 장비는 붕괴에서만 듣는다.
7. **기본 현장 생성기 여덟 가운데 다섯 넘게가 내보내지지 않는다.** 새 묶음 파일이 기본 현장을 바탕으로 변형을 만들려면 `builders.ts` 에 `export` 를 붙이는 한 낱말짜리 공용 수정이 여러 번 필요하다(또는 `kit.ts`·`plans.ts` 로 처음부터 짓는다 — N5 가 그렇게 했다).
8. **`tag` 를 무엇으로 하느냐가 시험을 정한다**: `life`·`chase` 면 40교대 3번 이상(`sim.test.ts:716`), `major` 면 여섯의 집합 시험과 교대당 한 번 규칙, `disaster` 면 추첨에서 빠진다. 새 태그(예: 묶음 이름)는 평소 추첨에 들고 어느 시험에도 걸리지 않는다. 화면이 `tag` 를 읽는 곳은 `'major'` 뿐이다.
9. **등록된 현장 생성기는 시나리오 표에 있어야 한다**(`ext.test.ts:41`). 새 유형의 기본 현장을 레지스트리에 `('newtype', 'std')` 로 등록하려면 표에 `variant: 'std'` 줄이 있어야 하고, 그러면 그 줄이 평소 추첨의 몫·신고 문구(`natureFor` 가 `scenarioOf` 를 먼저 본다)를 갖게 된다 — 유형의 기본 모습을 **표 한 줄로** 쓸 수 있다는 뜻이기도 하다 [확인: 코드 경로 / 실제로 돌려 보지는 않음].
10. 앞선 사용자 의견과의 긴장: `docs/specs/I1-causality.md:5` 에 사용자가 전해 준 검토 의견 "**사건의 수를 늘리는 것보다, 사건 하나에서 발생할 수 있는 상황의 수를 늘리는 것 … 새 사건 유형을 더하지 말고**"가 적혀 있다(I1 의 출발점). 이번 요청("종류가 적으니까")은 그 뒤의 것이다. 설계서의 결정 사항에서 둘의 관계를 적어 둘 만하다.

---

## 7. 확인 못 한 것

- R2·R3·I1-b·I2 가 구현된 뒤의 실제 함수 이름과 유형 분기 수 — 설계서를 낱말로 훑었을 뿐이다(§1.5 의 [설계서] 줄).
- `placePrior` 때문에 오판이 얼마나 느는지(§2.4) — 재지 않았다.
- `sim.test.ts` 의 건수 문턱들이 새 시나리오를 더했을 때 실제로 깨지는지 — 시험을 돌리지 않았다(전체 vitest 는 돌리지 않기로 했다). 시험마다 쓰는 시드 범위(S0~S29 인지 S0~S39 인지)도 줄마다 확인하지 않았다.
- 시나리오 표의 `variant: 'std'` 줄로 유형의 기본 모습을 쓰는 길(§6-9) — 코드 경로만 읽었다.
- 부대별 출동 횟수의 "편성 수"는 교대 끝의 `sim.units`(지원 부대 포함)에서 셌다 — 일반 구급의 184회에는 인근 도시 지원이 섞여 있다.
- 어려움·극한 난이도의 분포(무장 가중치가 0.28·0.33 으로 오른다), 재난 교대의 분포 — 보통만 쟀다.
- 화면에서 변형이 실제로 얼마나 구별돼 보이는지(스크린샷) — 브라우저를 띄우지 않았다.
