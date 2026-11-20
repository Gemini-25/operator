# I1-b 단계 b3-4 (초과 위험 과정의 틀)·b3-5 ① (교통의 장부와 초과의 네 몫) — 작업자의 보고

워크플로 `docs/specs/workflows/package-run.js`(가리킴 `wf/causality`, 덩어리 `h1`, 인자 `docs/specs/workflows/args/I1-b-nat.json`, 2026-11-20 밤)의 작업자 보고를 그대로 옮겼다. 정본은 `docs/specs/I1-causality.md` 끝 구현 메모의 b3-4·b3-5 ① 절이다. 끝 커밋은 `976092f`(브랜치 `wf/causality-h1`), 관문 통과(`checkPassed: true`). 이 덩어리는 사건을 만드는 것이 하나도 없다(해시 불변) — 재설계("스크립트가 아니라 자연스럽게 생기는 인과", 설계서 §3.6a·§3.6b)의 틀이다.

보고 속의 scratchpad 경로(`/tmp/claude-0/…/wf-causality/…`)는 그 세션의 컨테이너에만 있다.


## 끝낸 것

- b3-4 ① types.ts: HazardLawId·HzWhat·HzSrc·HzCell(done)·HzWait·HzNote·HzState·PlaceExpo(pipeThr), WorldState.hz·expo·sills·spans, ZoneState.at, Signal.mag, Incident.hz, SignalKind 끝 'quake'·'blackout', WorldTag 끝 'struct' (Scene.wear 는 I2 준비 단계가 이미 넣어 둔 칸이라 그대로)
- b3-4 ② 새 파일 /home/user/operator/.claude/worktrees/wf_89289609-c4c-1/src/sim/world/hazard.ts: CSQ_SPAWN_CAP 을 옮기고 consequence.ts 가 다시 내보냄 · HZ 상수 · registerHazard(거두는 함수 반환)·hazardLaws·hazardLabel · tickHazards(기다리는 줄 → 법칙 등록 순서, every 12 는 traffic.driftAt 이 바뀔 때만, 보간 없음) · hazardImpulse(delay) · hazardCell · ruleLoad · hazardRoom 의 여섯 줄 · 기다리는 줄(넘는 순간의 몫 사본·마감·자기 자신을 빼고 세기) · once=done · 건물에 내는 사건의 공통 조건(전소·전체 붕괴면 expired, 사건 중이면 기다림) · 귀속(cause·causes·parent·hz, 몫마다 since) · 장부의 구멍 holes
- b3-4 ③ tickWorld 의 1초 블록에 tickHazards 한 줄('tick' 규칙 다음·recoverWorld 앞), 빈 모음 src/sim/world/laws/index.ts 와 engine.ts 의 import, SpawnOpts.edgeId·causes·hz 와 createIncident 의 자리(hz 리터럴·I.hz·발생 기록의 causes), tickIncidents 의 '법칙 사건의 건물이 placeGone 이면 expired' 한 줄, spawnRoom 의 전체 상한을 ruleLoad 로, zoneOfPlace 를 건물 가운데 좌표로, signal 의 mag 복사
- b3-4 ④ 새 시험 파일 /home/user/operator/.claude/worktrees/wf_89289609-c4c-1/tests/hazard.test.ts 의 틀 시험 20개(가짜 법칙 — 대부분 tickHazards 만: 문턱의 경로 무관·단조성·초과 0 일 때 H 유지·평균 λT±15%·귀속·구멍·once·기다리는 줄·부하·건물 공통 조건·흐름 이름·사슬 깊이와 한 뿌리의 가지·교대 상한 6·부모 없는 것 3·법칙별/전체 상한·late·미룬 충격·틱 순서·측정 도구의 hazard 줄·A 다음의 B(vi.resetModules)·소스 글자 둘) + b2 의 시험 고침(placeState toMatchObject · 전체 상한을 world.log 의 made 줄로 · 거절 기록의 csq · 세계 상태 처음 값에 hz/expo/sills/spans · '요약 모양' 열 키)
- b3-4 ⑤ scripts/metrics.ts 의 hazard 지표 줄(열째)과 metrics.hazard(natural·byLaw·parented·orphan·rootMax·story·ruleMade·queued·waited·dropped·holes·gain + maxMadeInShift·maxCausalInShift), 관문(holes 0 · 교대마다 natural+ruleMade ≤ CSQ_SPAWN_CAP · 이야기 연쇄+법칙 사건 ≤ 6 · rootMax ≤ ROOT_MAX), TAG_SYS struct→building, S(I) 의 wear 갈래(shock→building), 새 파일 scripts/hazstats.ts(HazProbe·sumHaz·hazLines·hazJson·roadSurface)와 sweep --hazard(--json 이면 hazard 칸)
- b3-5 ① 교통 장부(src/sim/traffic.ts): 항마다의 주인 closeEv/closeInc·slowEv/slowInc·levelEv·Obstacle.ev(announce 가 적음)·정체의 ev → bumps 줄(noteBump·unnoteBump·addBump·removeBump — 인파·태풍 정전은 산술 그대로 두고 줄만) → 뿌리의 두 갈래(평소의 뿌리 p0≥2.4 / 원인 있는 뿌리)와 qBy·qEv·qInc(뿌리가 풀린 뒤 밀림의 꼬리까지 유지) → base·exOwn·exBump·exQueue·exDiv·excess·driftAt, 구간별 몫 목록 parts/partAt 과 roadParts, roadFlow export
- b3-5 ① 장부를 쓰는 자리: 쓰러진 나무(닫힘=blockEv·감속=rootEvent)·교통사고 감속(createIncident)·사고 구간 전면 통제(sceneManager 6번 블록)·다중 추돌·산사태 onCreate·X6 blockRoad·건물 잔해(rules/structure.ts)·재난 closeEdge(emit 반환값)·태풍 정전(lightsOut/lightsOn, DisasterState.darkBump)
- b3-5 ① disaster.detour → traffic.canBlock(sim, e, dry), 홍수 구간 문턱을 disaster.roadSill(sim, d, e) 로, hazstats 의 도로 노출량(네 몫·갈래별·장부 없는 초과·가중 없는 초과·초과/닫힌 구간 수), 장부 시험 6개(평소의 도로와 난수 호출 수 · 닫힘과 밀림의 꼬리 · 얹은 혼잡의 줄 · 실제 교대 넷의 장부 감사 · canBlock/roadSill · .bump 소스 글자)와 b3-3 의 장애물 기록 시험 고침
- 틀의 보강(8a4d077): chain.chainedInShift 가 법칙 사건을 부모가 없어도 세게 — 이야기 연쇄(canChain)와 법칙 사건이 어느 쪽이 먼저 나든 한 교대 6건을 나눠 쓴다(hazardRoom ⑤ = chainedInShift + 기다리는 줄)
- 설계서 끝 구현 메모 'b3-4 · b3-5 ①' 절(실제 이름과 자리 9항목 · 본문과 다르게 한 곳 14항목 · 결과 불변 확인 · 수치 · h2 에게) — /home/user/operator/.claude/worktrees/wf_89289609-c4c-1/docs/specs/I1-causality.md. 본문(§3~§9)은 고치지 않음
- 커밋 다섯: 5357f83(틀) · cb91aa7(교통 장부) · 78b9ad0(메모) · 8a4d077(6건 세는 법) · 976092f(메모). 커밋마다 wf/causality 를 옮김. 작업 폴더 깨끗함, 푸시·PR 없음

## 하지 못한 것

- 'level' 장부를 쓰는 자리(disaster.floodRoads 의 noteRoadCause(…,'level',…)와 d.levelEv)는 넣지 않았다 — §3.6b 의 '장부를 쓰는 자리' 목록에는 있지만 §5 표와 덩어리 표가 b3-12(h7)의 일로 적었다. 틀(levelEv 배열·noteRoadCause 의 'level'·exOwn 의 LEVEL_EX 0.8 항·몫 'level')은 있고 시험이 손으로 건다
- createIncident 의 opts.edgeId 를 먼저 보는 갈래(§3.6b (다))는 넣지 않았다 — §5 표의 b3-6(L1 과 함께). SpawnOpts.edgeId 칸과 traffic.canBlock 은 있다
- 우회 몰림(divert·divertBy·detours·staticCost)은 계산하지 않는다(b3-5 ② — h2). 배열 divert·divertBy 와 exDiv·'divert' 몫의 길만 있고 값은 늘 0·-1
- kit.baseScene 의 wear: undefined 리터럴은 넣지 않았다(§7 표가 b3-8 로 적음 — 그 칸을 쓰는 코드가 아직 없다)
- hazstats 는 법칙 줄과 도로 줄만 — 열·충격·연기·정전·잔열의 줄은 그 상태가 생기는 단계가 더한다(설계대로)
- 재난 다섯 × 12 --check 는 cb91aa7 에서만 돌렸다(마지막 코드 커밋 8a4d077 은 해시 목록 123줄이 같고, npm run check·어려움·극한 40 --check 는 그 커밋에서 다시 통과). npm run ui-check 는 돌리지 않았다(화면 무변경 — vite build 만 확인)

## 설계서와 다르게 한 곳

- 부모의 몫은 같은 주인 사건의 몫을 합쳐 본다(hazard.parentOf) — 본문은 '주인 사건이 있는 가장 큰 몫 하나가 1/3 이상일 때'. 통제 하나가 한 구간에 queue 와 divert 두 몫으로 걸리므로 몫 하나로 보면 60% 를 가진 사건이 부모가 못 된다. cause 와 구멍 판정은 본문대로 몫 단위
- chain.chainedInShift 가 법칙 사건(Incident.hz·opts.hz)을 부모가 없어도 센다 — 본문은 hazardRoom ⑤ 만 그 합을 보게 했는데, 그러면 부모 없는 법칙 사건 셋이 먼저 나고 이야기 연쇄 여섯이 뒤에 올 때 한 교대 9건이 돼 §4 의 관문(이야기 연쇄+법칙 사건 ≤ 6)을 틀이 지키지 못한다. 상한 값(3·6)은 그대로, 세는 것만 넓힘. 법칙이 없으면 예전과 같은 수(해시 목록 diff 0)
- hazardRoom 에 넷째 인자 skip(다시 보는 기다리는 줄 자신). 한 뿌리의 가지에는 법칙 사건의 자식도 든다
- 한 주기에 한 대상은 문턱을 하나만 넘는다(넘친 몫이 다음 문턱보다 커도 다음 주기에)
- tickHazards 가 첫 줄에서 돌아올 때(실제로 사건이 된 수 ≥ CSQ_SPAWN_CAP) 기다리던 줄을 'cap' 으로 버린다
- 모든 몫의 기록이 없는 넘음은 holes 에만 세고 gen.dropped 에는 넣지 않는다(맞는 까닭 갈래가 없다)
- 미룬 충격에서 spawn 이 그 자리에서 null 이면 기다리는 줄에 넣고 until − hold 전에는 내지 않는다(HzWait 에 칸을 더하지 않음). hz.at = 예약의 at
- DroppedChain.csq 새 칸 — 버린 것이 규칙·법칙의 것일 때 그 이름(측정 도구의 hazard.dropped 가 법칙의 것을 가린다)
- 구간마다의 몫 목록을 drift 가 굳혀 둔다(TrafficState.parts·partAt, RoadPart, roadParts) — 본문은 L1 이 exOwn·exBump 를 읽을 때 항마다 다시 가르게 했는데 drift 와 세계 틱 사이에 장애물·정체·줄이 사라지면 어긋난다. bumps 줄의 합보다 큰 e.bump 는 기록 없는 몫으로 남긴다
- 밀림의 뿌리가 바뀔 때는 새 뿌리의 주인이 -1 이어도 그 값으로 바꾼다('뿌리의 값이 -1 이면 앞의 값을 지우지 않는다'는 같은 뿌리일 때만). 한 다리 건너 구간은 많이 밀린 이웃에 평소의 밀림이 하나라도 있으면 평소의 것
- announce 가 스스로 Obstacle.ev 를 적고 전면 차단이면 닫힘의 장부에도 적는다. 불법 주차에는 ev 가 없다(평소 수준). 그래서 b3-3 의 '교통 모델이 놓은 장애물에는 ev 가 없다'가 바뀌었다 — 평소 장애물의 보고·ROUTE_BLOCKED 가 그 알림 기록을 원인으로 갖는다(기록의 원인 간선만 늘고 해시는 그대로)
- metrics.hazard 에 maxMadeInShift·maxCausalInShift 두 칸 추가(관문은 교대별 최댓값). waited 는 틱 표본으로 세므로 --no-metrics 면 null. HAZARD_LAWS 정적 목록, runWithProbe 의 셋째 인자 each
- TrafficState.driftAt 은 틀 커밋(b3-4)에 먼저 넣었다. 상수 DIV_MAX(1.0)·LEVEL_EX(0.8)를 traffic.ts 에 둠. DisasterState.darkBump 새 칸. roadSill 의 첫 인자는 아직 쓰지 않는다(N9 의 자리)
- 틀 시험은 tests/causality.test.ts 가 아니라 새 파일 tests/hazard.test.ts 에(§7 이 허락한 갈래) — 가짜 법칙을 넣는 동안 등록된 법칙을 치워 두는 withLaws 도우미

## 설계서 밖의 공용 파일을 고친 곳

- src/sim/chain.ts · chainedInShift — 법칙 사건(hz)을 부모가 없어도 세게(한 교대 6건을 이야기 연쇄와 나눠 쓰게). noteChainDrop 의 리터럴에 csq: undefined(같은 모양)
- src/sim/incidents.ts · DroppedChain 에 csq 칸, tickIncidents 의 버림 기록에 csq — 측정 도구가 법칙의 거절을 가리려고(§7 표에는 SpawnOpts·createIncident·tickIncidents 의 다른 줄만 있다)
- src/sim/world/rules/structure.ts · rubbleRoad 의 apply — 전면 잔해에 noteRoadCause(닫힘의 주인 = 잔해 기록, 주인 사건 = 신호의 사건). §3.6b 의 장부 자리 목록에는 있지만 §7 표의 b3-5 줄에는 파일이 없다
- src/sim/world/consequence.ts · fire·spawnConsequence 의 거절 기록에 csq, signal 의 mag
- src/sim/disaster.ts · DisasterState.darkBump(새 칸)와 plan 의 리터럴 — 정전 혼잡의 장부 줄 id 를 둘 자리
- scripts/metrics.ts · runWithProbe(sim, maxTicks, each?)·Probe.hzWaited — hazstats 의 틱 표본과 waited 를 위해
- tests/causality.test.ts · '요약 모양'(열 키)·b3-3 의 장애물 기록 시험(교통 모델이 놓은 것도 알림 기록을 갖는다) — b2 의 두 시험 말고 더 고친 곳

## 결과

【결과 불변】 해시 목록 123줄이 b3-3 끝(out-c2/hash.txt)과 diff 0 — 틀 커밋 뒤·장부 커밋 뒤·마지막 코드 커밋 뒤 세 번(HASH_SAME, /tmp/claude-0/-home-user-operator/186169fe-a127-5e67-996a-cfc83d22e9db/scratchpad/wf-causality/h1/hash-a1·hash-b1·hash-c1). drift 의 난수 호출 수 그대로(시험: 혼잡 계산마다 rngTraffic.range 가 구간 수 257 만큼만). 한 프로세스에서 시드 A 다음의 B 해시 = B 만 돌린 것: 여섯 쌍 모두 같음(AB_SAME — h1/ab.mts: 보통 S39→S3 · 홍수 S1→S2 · 지진 S0→태풍 S1 · 강제 tree S3→S0 · 극한 S7→강제 landslide S2 · 강제 pileup S1→보통 S17) + 시험(vi.resetModules 로 홍수+가스 폭발 강제 S4 를 혼자/S9 다음에).
【보통 60 --json】 reportHash 1812bf3b 그대로. out-c2 와 다른 칸은 chain.worldLinks 69→78 · replan.fromWorld 71→80(장애물 알림 기록이 원인으로 이어짐) · 새 metrics.hazard(natural 0·story 4·holes 0)뿐.
【보통 12교대의 도로 노출량 Σx·V·S·ℓ dt (교대당)】 합 16,941.8 = 자기 1,399.0(정체 1,070.8 · 한 차로 328.2) · 얹은 혼잡 710.4(인파) · 밀림 14,832.4 · 우회 0(b3-5 ② 전). 장부 없는 초과의 노출량 0. 가중 없는 초과 14,306.8 구간·초, 초과가 있는 구간 28.5/표본, 닫힌 구간 0.6/표본. 밀림을 가르면 주인 사건 있는 것 47.2% · 없는 것 40.4%.
【다른 조건(교대당 노출량 · 장부 없는 초과)】 어려움 8: 27,164.9 · 0 / 극한 8: 33,970.3 · 0 / 태풍 6: 57,520.0(꺼진 신호 16,554.0) · 0 / 홍수 6: 36,101.6 · 0 / 지진 6: 54,689.1 · 0 / 산불 6: 23,434.7 · 0 / 해일 6: 17,243.9 · 0 / 강제 traffic/tree 8: 21,097.7 · 0 / traffic/pileup 8: 20,221.8 · 0 / collapse/landslide 8: 19,242.7 · 0 / collapse/gasblast 8: 24,911.1 · 0. world.hz.holes 는 94교대 모두 0. (h1/haz1/summary.txt)
【교대당 시간】 sweep 12 --no-metrics, 전(c2)과 번갈아 세 번: 사용자 CPU 전 34.5·33.2·33.0초 / 뒤 33.2·34.3·33.3초(×1.00), 교대당 1,082·1,017·1,032 / 1,046·1,073·1,046ms(+1%) — §4 의 '틀과 교통의 몫 ×1.03 이하' 안.
【관문】 npm run check 통과(cb91aa7 과 마지막 코드 커밋 8a4d077 에서 각각): 테스트 939 + 건너뜀 1(파일 20개 — b3-3 끝 913 에 tests/hazard.test.ts 26개), 보통 40 검증 통과(사건 565 · 성공 74% · 대응 지연 4% · 실패+미해결 11% · 한계 시간 0 · 방치 1 · 교착 0 · 잊힘 0 · C1~C5 0 · 최대 깊이 2). sweep 40 --diff hard --check 통과(713 · 51% · 한계 6 · 방치 7 · 출동 없음 1), --diff extreme --check 통과(871 · 28% · 19 · 26 · 7) — 둘 다 8a4d077 에서도 다시 통과. 재난 다섯 × 12 --check 통과(태풍 279 · 홍수 246 · 지진 257 · 산불 199 · 해일 224 — cb91aa7). 모든 수치가 b3-3 끝의 관문과 같다. hazard 줄: 모든 조건에서 natural 0 · holes 0, 이야기 연쇄 보통 40 에 3 · 어려움 14 · 극한 42(교대 최대 6). vite build 통과.
【강제 실행의 한계 시간·방치】 이 덩어리는 사건을 만들지 않아 해당 없음(해시 동일).

## 알려진 문제 · 다음 작업자가 알아야 할 것

- 뒤 덩어리의 '전'은 여전히 /tmp/claude-0/-home-user-operator/186169fe-a127-5e67-996a-cfc83d22e9db/scratchpad/wf-causality/out-c2/ 다(이 덩어리는 결과를 바꾸지 않았다). 이번 산출물은 같은 scratchpad 의 wf-causality/h1/(hash-*·haz1·gates·gates2·check-1.log·check-2.log·timing.txt·normal60.json, 도구 ab.mts·owners.mts·haz.sh·timing.sh)
- h2 에게: 우회 몰림은 drift 에서 tr.divert·tr.divertBy 만 채우고 target 에 더하면 된다 — ledger 가 이미 exDiv 와 'divert' 몫(주인 = closeEv[divertBy])을 낸다. 그때 tests/hazard.test.ts 의 '우회 몰림은 b3-5 ② 가 채운다' 줄(exDiv·divert·divertBy = 0·0·-1)과 실제 교대 시험의 r.div === 0 을 고친다. 쓰러진 나무의 cong+0.7 은 아직 그대로다
- h2 에게: L1 의 scan 은 tr.excess[e] > 0 인 구간마다 roadParts(sim, e, buf) 의 몫(x)에 A_ROAD×V×S×ℓ 를 곱해 put 하면 된다. V·S·ℓ 식은 scripts/hazstats.ts 의 sampleRoad·roadSurface 와 같아야 한다. A_ROAD 첫 어림: 노출량 16,942(우회 몰림 없이)라 교대당 0.35건이면 2.1e-5 — 우회 몰림 뒤 sweep 12 --hazard 로 다시 잰다
- 보통 교대 초과의 88% 가 밀림이고 노출량의 47% 는 주인 사건의 몫이 1/3 이상이다(거의 다 평소 교통사고의 현장 감속) — L1 사고의 절반쯤이 근처의 먼저 난 사고를 부모로 갖게 되므로 ROOT_MAX 2·사슬 길이에 걸리는 수(hazard.dropped.depth)를 h2 가 봐야 한다. 태풍의 꺼진 신호는 그것만으로 보통 교대 전체만큼의 노출량(전 구간 0.4 × 120초)이라 법칙 상한 3 이 그 교대를 묶는다
- 진짜 법칙을 등록하면 tests/causality.test.ts '세계 상태는 걸린 규칙이 바꾼 것 말고는 처음 값'의 hz.cells 기대(지금 {})를 고쳐야 한다. tests/hazard.test.ts 의 틀 시험은 withLaws 가 등록된 법칙을 치워 두므로 그대로다
- I2 에게: 이어받은 복구 통제(closedReason 'repair')는 initTraffic 앞에서 닫으므로 noteRoadCause 가 듣지 않는다(sim.traffic 이 아직 없다) — initTraffic 뒤에 장부에 적어야 구멍이 되지 않는다(구현 메모에 적음)
- 설계서의 빈틈 하나를 틀에서 메웠다(본문은 고치지 않음 — 메모 '다르게 한 곳' 14): 본문의 hazardRoom ⑤ 만으로는 이야기 연쇄가 뒤에 올 때 한 교대 6건을 넘을 수 있다. chain.ts(Z1 의 파일)를 고쳤으니 검토자가 사용자 결정(상한 3·6 그대로)의 해석으로 받아들일지 본다
- 문서 단계가 고칠 것: CLAUDE.md·README 의 테스트 수(939, 파일 20개 — hazard 26)·지표 줄 아홉 → 열(hazard:)·sweep --hazard 옵션·'새로 길을 닫거나 혼잡을 얹는 코드는 noteRoadCause/addBump 한 줄'(§8-19). 이 작업자는 그 문서들을 건드리지 않았다
- 알려진 것 그대로: 극한 S12 #14 의 treatMate 80회 반복(H1 쪽), X6 외부 방어 문구의 반복 — 이 덩어리와 무관(해시 동일)
