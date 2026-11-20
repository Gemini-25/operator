# R2 단계 1a (수난 — 물가 방법) — 덩어리 작업자의 보고

워크플로 package-run.js 의 구현 덩어리 보고를 그대로 옮겼다(브랜치 wf/methods-s1a (wf/methods 도 75c8d57 로 옮김), 마지막 커밋 75c8d57, 관문 통과). 정본은 docs/specs/R2-methods.md 끝의 구현 메모다.

## 끝낸 것

- 1a 시작 처리: 주 브랜치 합치기(이미 같은 자리 e0d7376), 0단계 기준을 e0d7376 을 따로 푼 사본에서 측정 — normal·easy·hard·extreme 60, --force water/std 20, --force fire/ship 20, tsunami 20, 장비 1·부대 규모 1 수난 20 (scratchpad wf-methods/before-*.txt)
- 1a 장비: crews.ts ROLES 끝에 pole(기관원·사다리 조작원·수난 구조대원), pfd(로프 대원·수난 구조대원·항공 구조대원), drysuit(로프 대원·수난 구조대원), raft(로프 대원)
- 1a 명부: kitFor 가 KITS[id].uses 를 복사(KIT_USES 다음), OWN_DRAW 에 'r2' 추가 — createRoster 는 kit-r2, createAidUnit 은 aid-r2:<n> 흐름에서 drawBatchFaults(…, 'r2')
- 1a 판단부: methods.ts 의 hand·pole·ring·rope·improvise·catch 의 can/situ/skill(§4.1 — 믿음의 거리·물살·위중, 안벽 s.quay, 하류 차단 예상 시간 40/90초), methodStillFits 추가(1초 재확인)
- 1a 믿음·배정: casFact 에 drift, fitFor(waterRescue) = methodFit 식(0이면 맡지 않음)
- 1a 실행부: methodRun.runWaterRescue·landCasualty, 투척 빗나감·잡기 판정(mrng 한 번), 줄 다시 감기 4초·0.6배, 접기(METHOD_FAIL)·고장(broken)·조건 상실(tooFar/team 3초), 하류 차단(catch)의 기다림·걸려 멈춤 6초 규칙, 방법별 완료 문구
- 1a executor: case 'waterRescue' → runWaterRescue(XK), finishTask 의 nomethod 문구
- 1a recordAir: rules/air.ts hoistDone 의 완료 기록 id 로 recordAir
- 1a 지휘 규칙: orders/methods.ts — 열린 waterRescue 의 fails ≥ 2 이고 믿음상 아직 물속이면 rescue 요청
- 1a 시험: tests/methods.test.ts 62개 — 켜진 줄의 조건·점수·하류 차단·재확인·순수성, 장면 실행(손·하류 차단·두 번 빗나가면 접기·tooFar·nomethod), 강제 교대(§8 의 2·3·4·5·6(재현성·kit-r2/aid-r2 가 R1 흐름 불변)·7·9)
- 1a 문서: docs/specs/R2-methods.md 끝 구현 메모에 '단계 1a' 절 (실제 이름·본문과 다른 곳·밖에서 고친 시험·전후 수치·알려진 문제·관문)
- npm run check 통과 (77738d5: 704 passed + 1 skipped, sweep 40 --check 검증 통과)

## 못 한 것

- swim·tend·boat(헤엄·줄 확보·보트)와 물 위 바탕(waterTick·ashore·pullAshore·costFor·brain 가드)은 1b·1c 몫이라 하지 않았다 — 그래서 §6 의 수난 균형 목표(±5%p)는 1a 만으로는 맞지 않는다(아래 issues)
- §8 시험 3 의 boat·tend 장면, 시험 4 의 헤엄 부분, 시험 10(폭파)은 뒤 단계 몫
- 1d 그림(줄·장대 그림, agentPose)은 하지 않았다 — 화면은 고치지 않음(ui-check 불필요)
- 1a 에서 균형 수치(즉석 부력물 0.7 배율 등)는 바꾸지 않았다 — 헤엄·보트가 들어오면 1등이 바뀌므로 1b·1c 뒤에 재고 돌리기로 함

## 설계와 다르게 한 곳

- 1초 재확인은 새로 내보낸 methods.methodStillFits(sim,s,a,work,tg,t,m,sense) 로 한다. 하류 차단은 기다릴 자리에 나선 뒤(t.phase ≥ 1) 일반 재확인을 하지 않고, 본문의 'drift 0 + 2칸 밖 6초' 규칙을 같은 1초 재확인에서 t.mbad 로 센다 (다리에 걸려 멈추는 순간 can 이 거짓이 되어 성공 직전에 방법을 버리는 것을 막음)
- nopath: 한 임무에서 처음 한 번(t.tried 가 빌 때)만 switchMethod('tooFar') 로 바꾸고, 그다음은 finish(false,'nopath') — 같은 목표의 물가 방법끼리 틱마다 바꾸며 기록을 쏟는 고리 방지
- kitWorks 는 '처음 도착한 틱' 대신 시도를 시작할 때마다(진행도 0) 부른다 — 작동하는 장비엔 무해, 표시 칸 불필요
- 다시 던지는 시간(0.6배·찾는 2초 없음)을 같은 대상에서 그 방법을 접었다가 다시 고른 때에도 적용(a.mfail 로 판단, methodRun.foldedBefore)
- 한 시도 = mrng 한 번: roll < hit×grab 성공, roll < hit 면 '잡지 못했습니다', 아니면 '빗나갔습니다'. 접을 때 상세 `${이름}이/가 두 차례 빗나감`/`세 차례 실패`
- 완료 문구 `구조 대상 A, ${noun} 끌어냈습니다. 처치와 이송이 필요합니다.` (kind recovery·imp 2 유지)
- orders/methods.ts 지휘 규칙 1 에 상한: 구조 능력 ≥ 0.8 부대가 이미 둘 와 있거나 오는 중이면 요청하지 않음
- landCasualty 는 서명대로 I 를 받지만 쓰지 않음(_I), (x,y)가 물 칸이면 가장 가까운 뭍 칸으로 옮겨 내려놓음
- 다른 대원이 끌고 오는 대상(where carried)은 '구조 지원 대기'로 기다리기만(tend 전환은 1b)
- casFact drift = c.inWater ? c.drift ?? 0 : 0 (늘 실림). kitFor 의 수량 복사는 N8·N9 장비(마취총 3·잠수 장비 900·오일펜스 3)에도 적용됨 — 소비하는 곳은 아직 없음
- tests/methods.test.ts 의 withRows 는 이제 켜진 줄까지 끄고 배율을 지운 '틀' 상태 위에 patch 를 얹는다(단계 0 손 계산 시험을 그대로 쓰려고). '단계 0: 틀은 결과를 바꾸지 않는다' 묶음은 §8 의 1a 몫으로 교체

## 설계서 밖에서 고친 공용 파일

- tests/kinds2.test.ts (N9) · '표 (§4.8)' 시험: 수난 구조대원 장비 비교를 앞 셋(rope·ring·oilBoom)으로 · '고장 추첨' 시험: 교대 흐름 kit 순서에서 batch r2 를 빼고 kit-r2 묶음을 따로 비교 — R2 장비가 역할 끝에 붙었기 때문
- tests/injuries.test.ts (H1) · '물에서 건져 낸 사람 … 물가의 구조 줄과 헬기의 호이스트 모두': 시드 S7 추가(단언 그대로) — S5·S8 의 물가 구조가 이제 모두 호이스트에 앞질러짐(줄 없는 구급대원의 즉석 부력물이 맨손 구명줄보다 느림)
- tests/crews.test.ts (R1 — 설계서 §9 가 허락한 파일) · 고장 추첨 시험: batch 장비를 R1 흐름 순서에서 빼고 kit-r2 따로 확인, 지원 부대 쪽도 batch 제외
- src/sim/field/rules/methods.ts 머리 주석만 갱신(읽는 곳이 생김)

## 알려진 문제 — 다음 작업자가 알아야 할 것

- 1a 만으로는 수난이 기준보다 어렵다(보통 −3~−5%p, 어려움·해일 −9%p, 극한 −13.5%p, 선박 화재 −9.5%p). 원인은 '줄을 잡을 힘이 없는 위중한 대상(믿음 band 2) + 줄 없는 대원': 기준은 누구나 맨손 구명줄로 실패 없이 건졌지만 1a 에서는 즉석 부력물(명중·잡기 ×0.7, 체력 ≤40 이면 잡기 0.4/0.15)만 남아 한 번에 10% 안팎. 위중한 대상에 맞는 헤엄·보트(×1.15)는 1b·1c 에 켜진다. 1b·1c 뒤 §6 목표(수난 ±5%p)를 재고, 넘치면 §6 손잡이(즉석 부력물 판정 배율)를 돌릴 것. 주 브랜치에 1a 만 먼저 합치면 이 균형이 그대로 들어간다
- 수난 구조 담당 둘(want max 2)을 줄 없는 대원이 다 차지하면 뒤에 손이 빈 로프 대원이 와도 넘겨받지 않는다(구출의 RELIEF_GAP 같은 교대가 없음). 거듭 실패하면 지휘 규칙 1 이 구조 부대를 부른다. 교대를 넣으려면 commander.assign 끝의 넘겨받기 줄과 실행부 relieve 에 waterRescue 를 더해야 한다 — 설계서 밖이라 하지 않음
- 선박 화재의 죽음 증가(교대 다섯)는 배 안의 화상과 물의 익수·늦은 구조 뒤 노출이 섞여 있다. 화상 쪽은 기관원이 장대를 들어 수난 구조 적합도가 오르며(0.45→0.67 안팎) 배치가 달라진 탓으로 보이나 표본 21 로는 흔들림과 가르지 못함
- 기존 동작: 해일 현장에서 물에 휩쓸린 사람에게 남은 이송(carry) 작업을 대원들이 '제가 맡겠습니다 → 대상이 더 이상 그 위치에 없습니다'로 되풀이하는 장면이 보였다(R2 와 무관해 보이나 확인하지 않음)
- 뒤 단계에 넘길 이름: methods.methodStillFits, methodRun.runWaterRescue·landCasualty(sim,s,I,a,c,how,x,y)·grabP·hitP·shoreNeed·REWIND·CATCH_*, methods.HAND_REACH·POLE_REACH·RING_REACH·CATCH_SOON·CATCH_LATE. runWaterRescue 는 swim·tend·boat 를 만나면 지금 finish(false,'nomethod') 하는 방어 줄이 있다 — 1b·1c 가 그 갈래로 바꿀 것. 1b 는 '구조 지원 대기' 자리에 tend 예정 전환을 넣는다

## 수치

기준 e0d7376 → 1a (같은 명령, scratchpad wf-methods/before-*.txt vs a2-*.txt, 비교 대본 cmp.sh):
- 보통 60 전체: 성공 79%→79%, good 83%→82%, close reasons 동일(resolved 845·abandoned 2·timeout 1), 교대당 520→513ms.
- 보통 60 water/std(37): 성공+지연 31(83.8%)→29(78.4%) −5.4%p, 실패 0→0.
- --force water/std 20 (30건): 성공20·부분7·지연3·실패0 (76.7%) → 19·7·3·1 (73.3%) −3.3%p, 한계 시간 0→0, 수난 사건 대원 부상 0·순직 0, METHOD_FAIL 7.
- --force fire/ship 20 (21건): 성공10·부분8·지연1·실패2 (52.4%) → 8·10·1·2 (42.9%) −9.5%p, 한계 시간 0.
- 어려움 60 water/std(56): 71.4%→62.5% (−8.9%p). 극한 60 water/std: 67.1%→53.6% (−13.5%p, 실패 9→18). 해일 20 water/std(80): 62.5%→53.8%, water/evac 44→39/49. 쉬움 60 water/std 84.2%→80.6%.
- 다양성(그 시나리오 사건만, scenmeth.ts): water/std 20교대 성공 43건 6가지(즉석 부력물 15·구명줄 9·손 6·호이스트 6·장대 5·하류 차단 2), 최다 35% (목표 ≥4·≤70% 충족). fire/ship 20교대 51건 3가지(장대 24·하류 차단 18·즉석 부력물 9), 손 0 (목표 ≥3·손 0 충족).
- nomethod(쓸 방법 없음)로 끝난 수난 구조: 보통 강제·해일·극한 20교대씩 0건.
- 시험: tests/methods.test.ts 62/62, tests/sim.test.ts 수난 통과, tests/major.test.ts 선박 화재 통과, kinds2·crews·injuries·ext·causality 통과. npm run check (코드 커밋 77738d5): Test Files 19, 704 passed + 1 skipped, sweep 40 --check 검증 통과 (보통 40: 성공 77%·부분 11%·지연 5%·실패 5%).
