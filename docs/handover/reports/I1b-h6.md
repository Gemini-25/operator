# I1-b 단계 b3-10 (정전·승강기·통신) — 작업자의 보고

워크플로 `docs/specs/workflows/package-run.js` 의 작업자(`impl:causality:h6`) 보고를 그대로 옮겼다. 끝 커밋 `f720162`(브랜치 `wf/causality-h6`), 관문 통과(`checkPassed: true`).

정본은 그 묶음 설계서 끝의 "구현 메모"다. 보고 속의 scratchpad 경로(`/tmp/…/scratchpad/wf-*/`)는 그 세션의 컨테이너에만 있다 — 기준 수치는 구현 메모의 방법으로 다시 잰다.


## 끝낸 것

- ① 틀 9b82e21 (결과 불변 — 해시 123줄 모두 그대로): world/state.ts 의 setZone(…, at?) 국지 갈래(자리·원인·회복 시각·알려짐을 한꺼번에 덮는다 — 처음 값·더 나쁨·같은 값이면 더 넓은 원), setZoneArea, zoneAt, isDark, endZoneBy(cause, until, f?), recoverWorld 가 자리도 지움 · types.ts 의 world.spans 선택 칸(src·since·tellAt·told·label·next)과 ZoneSpanSrc
- ② disaster.ts 는 신호만 보낸다: quake(본진 mag 1 · 여진 0.6, x·y = 진앙, ev = 그 tell), blackout(lightsOut data 1 · lightsOn data 0)
- ③ C4 e039aba (상태·판단): src/sim/world/rules/infra.ts 의 powerOut((가) 변전소 700·발전소 1100 동네 전체 · (라) 붕괴·폭발 자리의 끊긴 전선 — 문턱 grid:line:<건물>, 반경 90/70/30+8×size, 국지 setZoneArea, cap 6) · powerOut.grid(태풍 정전 — 곧바로 알려짐·동네별 기록 없음·혼잡 두 번 얹지 않음 / 지진 — 문턱 grid:power:<동네>, 240초) · powerOut.end(원인 사건이 닫히면 endZoneBy t+60~120) · powerOut.tell(20~40초 뒤 '…정전 — (인근) 신호등이 꺼졌습니다.'), until = t+600(Infinity 아님), 꺼진 신호는 정전 한 건에 addBump 한 번(world.spans — recover 에서 동네마다 빼지 않고 settle 이 한 번 거둔다), 응급실 −2(syncHospitals) · 분석 AI POWER_SEV 0.3(알려진 정전 안의 교통사고·승강기 신고, 근거 '정전 구역')
- ④ L5 5958774·8075a41 (법칙): src/sim/world/laws/power.ts liftStall(충격만, 건물마다 한 번, 상한 3, 기다리는 마감 420) + world/expo.ts 의 LIFT·liftOcc·liftPlaces(4층 이상 · 승강기 갇힘 시나리오 종류 · 145채)·liftDelta·darkened(쓸 수 있는 건물만) — C4 의 정전 넷이 새로 꺼진 건물에만 부른다
- ⑤ C8 4271952·9513bd8·31afce0 (상태·판단): commsDown(방송국·관제탑 800 안 0.4 · 지진 문턱 grid:comms:<동네> 0.5) · commsDown.power(정전 100초 → 그 범위 0.6 알려지지 않은 채 / 태풍 정전 → 모든 동네 0.7 알림 한 줄) · commsDown.shadow(현장 음영 덩어리 csq:shadow:<현장>, s.shadowAdd, 회복 때 더한 칸만, 대기 지점 7칸·안전 구역 5칸 제외, 더한 칸에 선 대원의 COMM_FAIL → INFRA_FAIL 한 줄) · 교대 상한 3 · 동네를 빼앗긴 통신 장부 줄 거두기 · debrief 의 INFRA_FAIL order(COMM_FAIL 다음)·문장
- ⑥ 분석 AI 정전 위험도(analyst.ts POWER_SEV·darkZone — knownZone 만 읽는다)
- ⑦ 시험 90eb792: tests/hazard.test.ts 'I1-b b3-10' 열넷(등록·국지 구역 값·C4 (가)(라)·둘째 폭발·태풍·지진·분석 AI·L5 ②③④①⑤·C8 방송국+INFRA_FAIL·C8 긴 정전·실제 태풍 S0) + scripts/hazstats.ts 의 hazard-power 줄과 --json hazard.power
- 측정 전부(§4 명령 전부 전후, 해시 목록 123줄 커밋별 조건 비교, 태풍·지진 20 승강기, 변전소 강제 20, 정전 복구 검사 다섯 조건, 극한 한계 시간 60시드), npm run check, 어려움·극한 40 --check, 교대당 시간
- 설계서 끝 구현 메모 f720162 (docs/specs/I1-causality.md 끝에 '### b3-10 a · b · c' 절 — 본문 §3~§9 는 고치지 않음), 커밋마다 git branch -f wf/causality HEAD, git status 깨끗함, 푸시·PR 없음

## 하지 못한 것

- 화면(지도의 정전·통신 구역 표시 view/city/zoneLayer.ts)은 이 덩어리 몫이 아니라 만들지 않았고 npm run ui-check 는 돌리지 않았다(화면 파일을 고치지 않음)
- 보고서의 내력 문장('{동네} 정전(사건 {코드} 변전소 화재)으로 …')은 b4 의 몫이라 넣지 않았다 — INFRA_FAIL 의 causes 로 원인만 잇는다
- 극한의 한계 시간 증가(14 → 23)는 균형 단계(b5)의 몫으로 남겼다 — 손잡이를 고치지 않았다
- commander.ts 의 '응답 없음 — 재배정' 되풀이(더한 음영 안의 대원, 극한 S11 #15 13번)는 이 덩어리의 파일 밖이라 고치지 않았다

## 설계서와 다르게 한 곳

- setZone 국지 갈래: 같은 값이면 더 넓은 원만 자리를 가져가고, 자리가 있는 칸은 b2 갈래(같은 값에 회복 시각 늘림)를 타지 않는다 — 실제 이름 state.setZone(…, at?)
- 동네 전체 값은 rules/infra.ts 의 put(처음 값이거나 더 나쁠 때만 setZone) — b2 setZone 이 같은 값에 다른 원인의 회복 시각을 늘리고 알려짐을 켜서. 그 결과 국지 정전이 걸린 동네를 태풍·지진·변전소 정전이 가져가지 않는다(알려진 한계)
- world.spans 줄에 선택 칸 src·since·tellAt·told·label·next 와 새 자료형 ZoneSpanSrc (본문 §3.3 은 {f,cause,inc,bump})
- endZoneBy(sim, cause, until, f?) — 칸 인자를 더했다(긴 정전의 통신 장애는 정전과 원인 기록이 같아 power·comms 를 따로 당긴다), 당긴 수를 돌려준다
- 꺼진 신호 구간 = 그 건의 동네 안에 중점이 있고 zoneAt(power, 중점) < 0.5 인 구간; 일부만 빼앗긴 앞 건의 혼잡 줄은 그 건의 동네가 남은 동안 유지(가져간 동네 구간이 한동안 두 줄)
- 태풍 정전 끝 신호는 ev 가 시작과 다르거나(quiet 면 −1) — 장부의 blackout 줄에서 원인을 찾아 endZoneBy
- 응급실 −2 는 태풍 정전에도 걸린다(병원 넷 120초)
- 알림·복구 기록은 정전 한 건에 한 줄(동네 여럿을 '…·… 일대'로 묶음)
- C8 BACKUP 100초 (본문 120) — 태풍 정전이 꼭 120초이고 끝 신호가 1초 블록보다 먼저 처리되어 (라)가 걸리지 않는다
- C8 쿨다운·상한: 본문 '동네마다 300초 · 교대당 3' 대신 열쇠 ev:<신호>·쿨다운 0 + 네 갈래 공동 상한 3 (world.count['commsDown.spans']), 겹침은 put/setZone 이 막는다
- (나) 긴 정전의 통신 장애 원인 = 그 정전의 원인 기록, 알려지는 때 = 더한 음영 칸에 선 대원의 첫 COMM_FAIL
- INFRA_FAIL 은 세계 규칙 commsDown.shadow 가 낸다(더한 음영 칸의 대원 COMM_FAIL, 사건마다 한 번, causes = [COMM_FAIL, 통신 장애 원인])
- C8 음영을 대기 지점 7칸·안전 구역 5칸 안에 더하지 않음(COMMS.KEEP_STAGE·KEEP_SAFE — 본문에 없음): 보통 S21 64회 반복·S20 188초 교착 때문
- L5 기다리는 마감 420초(LIFT_LAW.HOLD — 틀의 60초): 태풍 충격 단계의 부하로 넘음 23 이 모두 버려졌다
- L5 ⑤ 전소(쓸 수 없는) 건물은 darkened 가 건너뛰어 칸도 사건도 없다 (본문: 'expired' 로 버려짐)
- L5 상수 LIFT·liftDelta·liftOcc·liftPlaces 는 world/expo.ts (등록 없는 파일), 몫 ref = 그 건물의 동네, 대상 145채
- 분석 AI 승강기 +0.3 은 1.8 상한 뒤에 (최대 3)
- (가) 이미 모두 꺼진 범위면 planOf 가 (라)로 넘어가 상한을 쓰지 않는다

## 설계서 밖의 공용 파일을 고친 곳

- tests/hazard.test.ts (§7 표에 있는 파일이지만 앞 덩어리의 시험 둘을 고쳤다, e039aba): §3.6b 장부 시험이 C4 의 얹은 혼잡 줄(what 1)을 받아들이게, 규칙 차례 시험이 앞부분만 보게
- src/sim/types.ts: world.spans 줄의 선택 칸 여섯과 새 자료형 ZoneSpanSrc (추가만 — §3.3 자료형 목록 밖의 칸)

## 결과

해시(123줄, h6/tools/cmp6.mjs): 틀 9b82e21 바뀐 0 · C4 바뀐 72 모두 조건 교대(조건 76 중 남은 4 는 정전 없던 변전소 사건 교대) · L5 바뀐 1 = liftStall 교대 · 마감 420 바뀐 1 · C8 바뀐 62 모두 통신<1 교대 · 음영 자리 바뀐 67 모두 조건 · 31afce0 바뀐 0 · 시작점→마지막 바뀐 72 = 조건 교대 72(조건 없이 바뀐 0, 조건 있는데 그대로 0).
끝내는 조건: 태풍 20 liftStall 14건 = 0.70/교대(0.5~2 안, 넘음 23) · 지진 20 승강기 3.20 → 3.40/교대(+1 안) · 사건 수 태풍 473 → 478(×1.01) · 지진 426 → 440(×1.03) · 변전소 강제 20(60초 변전소 화재): 정전 13교대, 정전 알림 26, 복구 20, 통신 기록 9, liftStall 10, INFRA_FAIL 5, 그 화재 한계 시간·방치·출동 없음 0 · 정전 복구 검사(leak.mts — 보통 40, 태풍·지진·어려움·극한 20): 어긋난 교대 0(남은 동네 값 회복 − 지금 ≤ 600, 닫힌 원인 + 120 안, 장부·혼잡 줄·구간 bump 일치), 가장 긴 연속 정전 지진 798초 = 원인 둘(각 600 안) · 태풍 정전 동네별 기록 없음.
전후(h5/out-post → h6/out-post, 사건·성공+지연·실패+미해결·대응·한계/방치/출동없음·TD): 보통 60 877·77.7·11.1·52·0/2/0·27 → 878·77.7·11.0·52·0/2/0·27 · 어려움 30 551·61.7·21.4·66·6/4/1·29 → 551·61.5·21.2·67·6/4/0·31 · 극한 30 673·37.6·44.9·92·14/21/5·36 → 673·36.6·45.9·92·23/22/6·35 · 태풍 473·73.8·15.6 → 478·73.4·15.5 (한계 6→6) · 지진 426·40.6·38.7·23/0/6 → 440·42.0·39.3·24/2/4 · 홍수·해일 그대로 · 산불 한계 9→8. 보통 60 교착 0·잊힘 0·반복 최대 6·C1~C5 0·한 뿌리 2·깊이 2·구멍 0. 극한 한계 +9 중 4 는 극한 S0 의 변전소 화재(동네 넷 정전), 다른 시드 S30~S59 는 17→18.
관문: npm run check 통과(31afce0, 테스트 993 + 건너뜀 1, 파일 20, 보통 40 검증 통과: 587·70%·지연 5%·실패+미해결 13%·한계 0·방치 1·교착 0·잊힘 0·C1~C5 0·roadCrash 19). sweep 40 --diff hard --check 통과(735·50%·한계 8·방치 8·교착 후보 1(149초, h5 의 S5 #07)·C1~C5 0) · --diff extreme --check 통과(894·27%·한계 30(h5 20)·방치 25·교착 0·잊힘 0·C1~C5 0·반복 최대 13). 교대당 사용자 CPU 평균 ×1.03(37.1 → 38.2초 / sweep 12). 도구·결과는 /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-causality/h6/ 아래(out-post/, hash-*/, leak2.txt, sub-fire.txt, lift-post-*.txt, tmo-*.txt, check.log, check-hard40.txt, check-extreme40.txt).

## 알려진 문제 · 다음 작업자가 알아야 할 것

- 극한의 한계 시간 증가: 극한 30 14 → 23, 극한 40 --check 20 → 30. 큰 정전(변전소 → 동네 넷)에 꺼진 신호 bump 0.4 · 응급실 −2 · 통신 0.6 이 함께 걸려 극한 S0 하나에서 4건이 늘었다. 균형 단계에서는 POWER.DARK_BUMP → HOSP_CUT → COMMS.SHADOW 차례로 본다. 보통·어려움·재난은 그대로이거나 +1
- 더한 음영 안의 재배정 되풀이: commander.ts 의 지시 미수신 COMM_FAIL('응답 없음 — 재배정')이 극한 S11 #15 에서 13번(반복 최대 8 → 13). 역할이 지휘관인 COMM_FAIL 이라 INFRA_FAIL 로는 잇지 않는다. 같은 대원에게 다시 보내지 않게 하는 것은 이 덩어리의 파일 밖
- 한 동네·한 칸에 국지 자리는 하나뿐: 겹친 두 국지 정전은 넓은 쪽만 남고, 국지 정전이 걸린 동네는 태풍·지진·변전소의 동네 전체 정전이 가져가지 않는다(그 동네의 원 밖은 불이 들어온 채). b3-11 C5(연기 setZoneArea)·b3-12 L6 도 같은 자리를 쓴다 — 넓히려면 ZoneState.at 의 모양을 바꿔야 한다
- C8 음영은 현장마다 처음 한 번만 더한다(통신이 더 나빠져도 늘리지 않는다)
- L5 는 보통 교대에 0건(칸 92·넘음 0). 태풍·지진·변전소에서만 난다
- isDark 의 expo.dark 는 b3-12 의 자리 — 아직 쓰는 곳이 없다
- 어려움 S5 #07 교착 후보(149초)는 h5 에서 넘어온 그대로
- 중간 커밋에서는 관문 전체를 돌리지 않았다(마지막 코드 커밋 31afce0 에서 돌림). 마지막 커밋 f720162 는 문서만 고친다
- h6 도구(scratchpad h6/tools/ — i1hash6.mts·cmp6.mjs·leak.mts·subforce.mts·lift.mts·tmo.mts·longdark.mts)는 h7 이 칸을 붙여 다시 쓸 수 있다
