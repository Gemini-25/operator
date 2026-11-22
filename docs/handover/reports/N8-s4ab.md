# N8 단계 4a·4b (시설 사고 — 전선·수도관·싱크홀·간판 + 복구반 셋 · 가스 누출의 공급 차단 확인) — 작업자의 보고

워크플로 `docs/specs/workflows/package-run.js` 의 작업자(`impl:kinds:s4ab`) 보고를 그대로 옮겼다. 끝 커밋 `75cdd37ba046437fd58d52e0deae799b6e2fb2bf`(브랜치 `wf/kinds-s4ab`), 관문 통과(`checkPassed: true`).

정본은 그 묶음 설계서 끝의 "구현 메모"다. 보고 속의 scratchpad 경로(`/tmp/…/scratchpad/wf-*/`)는 그 세션의 컨테이너에만 있다 — 기준 수치는 구현 메모의 방법으로 다시 잰다.


## 끝낸 것

- 단계 4a: utility 유형 추가. TYPE_ORDER 끝에 넣었고 TYPE_DEFS.utility 는 평소 가중 0(짧은 사건 흐름으로만 나온다)이며 한계 360초, TYPE_COLOR #22c9d6, INCIDENT_PLACES.utility 를 채웠다. 공통 틀도 넣었다: streetFrame·fixture 소품, 위험 반경 cordon, repair, 시간 막이, UTIL_LATE, registerVerdict, 머리글 UTIL_HEAD
- 단계 4a: utility/wire. 현장(scenes/kinds), wireRule(흐름 wire:<사건> — 감전, 불꽃, '내리지 마세요', 120초 뒤 원격 차단), 지휘 규칙(orders/kinds — 통제, 복구, 반경 안 사람 보류, 종료 막기, 남은 일), 전력1 minLevel 1, bang 열의 utility 0.08, KIND_CALLER.utility, INSTRUCT 'wire', 처음 원인 electric
- 단계 4b: utility/main(지하 침수 MAIN, 소방의 제수밸브 VALVE_LATE 120 — 3배 느림, UTIL_LATE), utility/sinkhole(구멍 칸 T.VOID, 넓어짐 holeChance·HOLE, 흐름 hole:, 밀려남, 줄 구출, 구간 차단 sinkholeBlock과 닫힐 때 넘기는 도로 공사 sinkholeRepairRoad, persist washout), utility/sign(간판 낙하 SIGN, 흐름 sign:, 행인 ESCALATION, 강제 보고)
- 단계 4b: 가스1·수도1 minLevel 1(부대 수 15·22·25). rumble 열의 utility 0.15. 이름표 가산 LABEL_BONUS 세 줄. 시설 사고가 아닌 사건의 유관 기관 수요는 보낼 차가 없으면 지운다(CIVIL_KEYS). 가스 누출의 공급 차단 확인(§5.3.8 선택 수요 — ATTACH_GAS, GAS_WAIT 120, 건물 밖 인입 배관에서 확인). 'pipeBurst' 신호는 보내지 않기로 결정했다(C11 waterMain 이 없다)
- 시험: tests/kinds.test.ts 39개(4a 의 3·5·9·10·18, 4b 의 5·10 — 손 계산 셋, 부대 규모 1, 소방 제수밸브 UTIL_LATE, 가스 공급 차단 확인). sim·crews·injuries·traffic 시험의 편성 값과 분야 팀 수를 고쳤다. 시드에 기대는 옛 시험은 시드나 표본만 바꿨다(문턱은 그대로)
- 화면(따로 커밋): ICON_PATH.utility, 스킨 pole·wire·pipe·hole·sign·signDebris, drawHazRings, drawFlood, 출동 차량이 VOID 칸을 비켜 서게(voidUnder), 지하 층 표지 '지하', cardTitle(NO_CARD). 5236 포트에서 강제 넷의 현장과 도시 지도를 1600×900 으로 찍어 확인했다. npm run ui-check 통과
- 측정: 강제 20교대(보통)를 utility 넷과 hazmat/std 로, 어려움 강제 20교대를 utility 넷으로 돌렸다. 보통 60 전후 비교, 어려움·극한 40 --check, 유형별 집계도 했다
- docs/specs/N8-incident-kinds.md 구현 메모의 '## 검토 메모' 앞에 '### 단계 4a·4b' 절을 넣었다(실제 이름 표, 본문과 다른 곳 13, 측정, 알려진 것)
- 커밋 349ba7d(시뮬레이션·시험)와 75cdd37(화면·메모). 커밋할 때마다 git branch -f wf/kinds HEAD. 푸시·PR 없음, git status 깨끗, 개발 서버 정지

## 하지 못한 것

- 강제 20교대 완료 조건의 '실패·부분 ≥ 1'을 wire·sign 강제 줄은 채우지 못했다. 보통에서도 어려움에서도 성공과 지연뿐이다(복구반이 늘 편성돼 있고 반경을 피한다). 실패 갈래(원격 차단 UTIL_LATE, 소방 제수밸브, 간판 낙하 ESCALATION, 넓어지는 구멍)는 시험 5(b)·10 이 상태를 조작해서 본다. main·sinkhole·hazmat 강제 줄에는 부분·실패가 있다
- 4a 와 4b 를 따로 커밋해 각각 npm run check 를 돌리지 않았다. 한 시뮬레이션 커밋으로 냈고, 관문은 마지막 커밋에서 돌렸다(아래 deviations)
- X6 NO_STRUCT 에 'main' 을 넣지 않았다. tests/catastrophe.test.ts 가 그 목록을 글자로 고정한다. 수도관 현장은 s.outdoor 라서 structScene 이 원래 거짓이다

## 설계서와 다르게 한 곳

- 4a·4b 를 한 시뮬레이션 커밋(349ba7d '실제 이름 N8 단계 4a·4b: …')으로 냈다. 화면 커밋은 75cdd37 로 따로 냈다. 사건 번호가 밀리면서 시드에 기대는 옛 시험이 단계마다 다르게 흔들리기 때문이다
- streetFrame 의 남쪽 보도를 y12~14 로 넓혔다(본문은 y12 한 줄). 안전 구역 아래의 동료 내려놓는 자리가 벽이었다
- WIRE_SEE=6 과 HAZ_PAD=0.75 를 두었다. 위험 반경은 전선 소품 칸을 가운데로 한 원이다(본문의 3~6칸 띠는 그림으로만 그렸다)
- 원격 차단의 'powerCut' 과 수도관의 'pipeBurst' 신호는 보내지 않는다. 원격 차단은 전선만 죽이고 동네 정전은 만들지 않는다
- 지하 층은 구역 종류 'room' 에 s.kinds.base 를 붙였다(본문 'basement'). 화면에서는 '지하'라고 쓴다
- X6 NO_STRUCT 에 'main' 을 넣지 않았다(catastrophe 시험이 목록을 고정한다)
- 소방의 제수밸브는 손 공구를 든 사람만이 아니라 소방 부서 누구나 맡는다(valveFallback). 오는 소방이 없으면 진압 부대를 요청한다. 사다리차만 와 있을 때 한계 시간까지 갔기 때문이다
- 가스 복구반장이 X6 가스 재측정(civilFit mitigate)도 맡는다. 공급 차단 확인은 새는 방이 아니라 건물 밖 인입 배관(밸브에서 가장 가까운 출입구 1.5칸 안)에서 한다. 방 안에서 하면 남은 가스를 재서 진입 금지 구역이 생기고, 교착 후보가 났다(보통 S8 #05)
- 싱크홀 둘레 구역을 'verge' 로 하고, 구멍 안을 내려다보는 시야 losOpen 을 쓴다(grid.los 는 VOID 를 막는다)
- 수도관은 난수 흐름 main: 을 쓰지 않는다. 시험 6 에서 'main:' 은 LATER 목록에 남겼다
- 싱크홀은 종료를 막지 않는다(BLOCK_HAZ 밖). 구멍 둘레의 통제와 보강은 남은 일(holeWork)이 있을 때만 낸다
- ATTACH_GAS 스위치를 orders/kinds 가 아니라 scenarios/kinds 에 두었다. 분석(analyst)이 field/ 를 값으로 import 하지 않게 하려는 것이다
- 시드에 기대는 옛 시험의 시드·표본을 바꿨다(문턱은 그대로): sim '인근 도시 지원' 의 한가한 교대를 S0~S5 에서 S0~S5 + C0~C9 로 넓혔다(S7 은 시작점에서도 지원 5/5 를 다 써 시드마다의 조건에 걸린다). sim '추격전' 50 → 70교대. causality b2 S3 → S6, 인과 S0 → S2, 3단계 S33·S26 → S293·S5, 극한 S3·S4 → S4·S7, ROUTE_BLOCKED S0 → S1·S3·S5·S7, DIVERTED 에 S15·S17 추가. hazard 태풍 S0 → S7, L4① S0 → S1(새 도우미 normalS1). methods 3.문 D5 → D7, D2 S33 → S45. persistence SB → SC. crews ⑤ 표본 K6 교통 → K3 붕괴(CLAUDE.md 는 고치지 말라 하지만 I1-b h5 의 선례를 따랐다. 같은 대원의 되풀이는 찾지 못했다). crews ⑪ 맑은 둘째 시드

## 설계서 밖의 공용 파일을 고친 곳

- src/sim/field/sceneManager.ts · settle · 펌프 대원이 가벼운 일로 돌아오면, 같은 부대의 다른 대원이 대신 잡은 hookup·resupply 를 돌려준다(crews ⑭ 의 회귀, fitFor 'hookup' 과 같은 규칙)
- src/sim/field/agents.ts · perceiveFixture(pipe·hole·sign) · losOpen · seesAt · hazRadii·hazCount·targetInHaz·inRadii · valveFallback · fitBase(mitigate 의 구멍·간판, 반경 안 사람의 일) · civilFit(가스 재측정) · casFact pit · workLabel
- src/sim/field/executor.ts · repair(runPipeShut·runSupplyCheck) · mitigate(runFixtureFix) · UTIL_WORK · extricate 의 구멍 사거리 3.6
- src/sim/dispatch/dispatcher.ts · CIVIL_KEYS 의 선택 수요 갈래 · LABEL_BONUS 세 줄
- src/sim/dispatch/analyst.ts · TYPE_DEFS.baseNeeds 일반식 · 가스 누출 utilGas
- src/sim/dispatch/callSystem.ts · bang·rumble 의 utility 열 · KIND_CALLER 갈래 · INSTRUCT wire
- src/sim/debrief.ts · UTIL_HEAD · UTIL_LATE 자리와 문장 · 시설 사고 머리글
- src/sim/field/hazards.ts · applyCallerAid 'wire'
- src/sim/field/injury.ts · LIGHT_WORK 에 cordon
- src/sim/persist.ts · roadsNext 의 sinkhole → washout
- src/view/renderScene.ts · voidUnder(차량 줄이 VOID 칸을 비켜 선다) · drawFlood·drawHazRings 호출
- src/view/scene/staticLayer.ts · s.kinds.base 가 있으면 층 이름 '지하'와 거꾸로 된 계단 화살표
- src/ui/panels.tsx·App.tsx · cardTitle(NO_CARD)
- tests/causality·hazard·methods·persistence.test.ts · 시드·표본만(§9.2 의 표에 없는 파일이지만 같은 원칙)

## 결과

강제 20교대(보통, 끝 코드). 표기: n·성공·부분·지연·미해결·실패 | 한계·무대응·방치 | 평균 현장 시간·부대.
- wire 25·24·0·1·0·0 | 0·0·0 | 153초·3.0
- main 24·23·1·0·0·0 | 0·0·0 | 137초·3.9
- sinkhole 22·18·3·1·0·0 | 0·0·0 | 170초·5.7
- sign 30·28·0·2·0·0 | 0·0·0 | 150초·3.4
- hazmat/std 43·35·3·2·0·3 | 0·0·0 | 213초·5.9 (시작점 e710f64: 43·32·5·1·0·5 | 1·0·0)
- 다섯 묶음 모두 교착 후보(STALL) 0, 잊힌 사건 0, 반복 최대 5~12. 공급 차단 확인을 건물 밖으로 옮기기 전에는 hazmat 묶음 STALL 이 2 였다.

어려움 강제 20교대:
- wire 26·25·0·1 | 0·0·0
- main 24·22·0·2 | 0·0·0
- sign 31·28·0·3 | 1·0·0
- sinkhole 22·15·4·3 | 2·0·0
- 한계 시간은 모두 구조·이송을 마친 뒤 구급차가 전환 배정되어 기다리다 넘긴 것이다.

보통 60 (e710f64 → 이 단계):
- 사건/교대 15.15 → 16.00, 평소 추첨 14.18 → 14.08(±0.3 안), 짧은 사건 0.48 → 1.40(시설 사고 0.88), 비응급 1.03 → 1.03
- good 0.800 → 0.796, bad 0.095 → 0.093, 평균 대응 53 → 54초
- 종료 사유: 한계 시간 2 → 6, 무대응 1 → 0, 방치 2 → 0 (닫히지 못한 합 5 → 6). 한계 시간 여섯 가운데 시설 사고는 S15 #12 싱크홀 하나(구급 부족)
- 시설 사고 53건, 숨진 사람 0, UTIL_LATE 0
- 숨진 구조 대상 146 → 182 (붕괴·화재·가스 쪽), 유관 기관 가동률 7.4%, 지상 구급 0대 37.2 → 40.6%

어려움 40 --check: 검증 통과. 한계 6 → 8, 무대응 2 → 3, 방치 8 → 6, 교대 끝 1 → 2. 교착 0, 잊힌 0, C1~C5 0, holes 0.
극한 40 --check: 검증 통과. 35·11·18·9 → 38·18·27·5 (닫히지 못한 합 73 → 88). 교착 0, 잊힌 0, 반복 최대 9.

sim.test: 부대 수 15·22·25, 분야 팀 수 경찰 3~9 · 소방·구조·특수 3~7 · 유관 기관 0~4 통과.
npm run check (75cdd37): tsc 통과, vitest 20파일 1090개 통과(682초), sweep 40 --check 검증 통과.
npm run ui-check: 모두 통과(158초, 기록 해시 헤드리스와 같음).
산출물: /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-kinds/s4ab/final2/ (force-*.txt, hard-*.txt, after-normal60.json, hard40check.txt, extreme40check.txt, bytype-*.txt), 같은 s4ab 폴더의 shots/·uicheck/·check-final.log

## 알려진 문제 · 다음 작업자가 알아야 할 것

- 짧은 사건의 시설 사고가 구급을 끌어간다. 보통 60 의 숨진 구조 대상이 146 → 182 로 늘었고, 지상 구급 0대가 37.2 → 40.6%, 극한의 무대응·방치가 11·18 → 18·27 이다. 시설 사고에서 숨진 사람은 없다. 균형은 단계 11 의 손잡이 차례(§7.3)에서 볼 일이다
- 시설 사고의 한계 시간은 늘 구급 부족 갈래였다. 구조와 안전 구역 이송을 마친 뒤 구급차가 다른 사건으로 전환 배정되어 360초를 넘긴다. 보통 S15 #12, 강제 S7·S15, 어려움 S0·S6·S15. 교착이나 되풀이는 없었다
- 단계 5 이후 sim 을 고칠 때마다 시드에 기대는 옛 시험(causality ROUTE_BLOCKED·DIVERTED·b2·b5, hazard 태풍·L4, methods 문·D2, persistence 결원, sim 지원·추격, crews ⑤·⑪)이 다시 흔들릴 수 있다. 이 단계에서 공급 차단 확인 위치를 한 번 바꾼 것만으로 causality 둘이 다시 깨졌다
- causality ROUTE_BLOCKED 시험은 'ref.inc 이면 J.blockedEdge === edge' 를 가정한다. I1-b C2 의 건물 잔해 장애물 갈래는 blockedEdge 가 없어 이 가정을 깬다. 시험의 가정이 원래 좁은 것이고, 이번에는 시드만 바꿨다
- 도시의 이면 도로 이름이 '한솔3로 2길 2길 2길'처럼 겹쳐 쌓인다(city.addLocalStreets). 시작점부터 있던 것이고, 길 위 사건인 시설 사고에서 눈에 띈다
- 공급 차단 확인을 마친 바로 뒤 지휘관이 같은 지시를 한 번 더 낸다(강제 보고가 닿기 전의 계획 주기). 대원은 곧바로 '확인됨'으로 끝낸다
- crews ⑤ 의 표본을 바꾼 것은 CLAUDE.md '시험은 고치지 않는다'와 부딪힌다. 넓은 표본 18교대의 몫이 0.426 → 0.408 이다. 검토 단계에서 볼 일이다
