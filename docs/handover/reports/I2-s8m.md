# I2 단계 8 (측정·균형) — 작업자의 보고

워크플로 `docs/specs/workflows/package-run.js` 의 작업자(`impl:persist:s8m`) 보고를 그대로 옮겼다. 끝 커밋 `2cb396a`(브랜치 `wf/persist-s8m (가리킴 wf/persist = 2cb396a)`), 관문 통과(`checkPassed: true`).

정본은 그 묶음 설계서 끝의 "구현 메모"다. 보고 속의 scratchpad 경로(`/tmp/…/scratchpad/wf-*/`)는 그 세션의 컨테이너에만 있다 — 기준 수치는 구현 메모의 방법으로 다시 잰다.


## 끝낸 것

- 단계 8 측정 도구 (07dc469): 새 파일 /home/user/operator/.claude/worktrees/wf_72c4354c-691-4/scripts/chain.ts. 계보 L × 교대 K 를 돌린다(시드 C<L>.<k>, 다음 교대는 JSON 왕복을 거친 makeCarryover 를 받는다). 옵션: --diff, --disaster kind[@k], --json, --check(기본 24 계보, §6.3 의 1~7, 보통이면 기준 6 의 지진 회복 12 × 6 을 이어서 돈다), --dump <폴더>(C0.<k>.carry.json·C0.<k>.org.json), --soot [--sev] [--place], 진단 --paired·--strip, -v. I1-a 의 runWithProbe·shiftMetrics·summarize·checkMetrics 를 쓴다
- 단계 8: scripts/sweep.ts --carry <파일>. Carryover 또는 ar.org.v1 의 { carry } 를 받고, --json 에 carry 칸을 넣는다. --carry 면 보통의 기준 범위·교착 래칫은 걸지 않는다
- 단계 8: scripts/metrics.ts 의 Probe carryInc 가 carryState.slowed(한 차로 공사·건물 앞) 구간도 본다. 단계 4 의 알려진 문제였고 측정만 바뀌며 결과는 그대로다
- 단계 8: persist.applyCrewCarry 의 stats.grown 을 GROWN_MIN 문턱으로 바꿨다. 요약 줄의 '숙련이 오른 대원'이 carrySummary.grown 과 같은 문턱을 쓴다(단계 6·7 의 알려진 문제)
- 완료 조건 3: tests/causality.test.ts 의 T5 시험을 켰다. 정해진 시드 S1 은 맞는 기록 0, S1 이 만든 상태로 시작한 S2 에서는 T5 가 요약 기록 하나와 맞고 sysOf 가 carry 다. tag 'carry' 기록은 모두 carry 이고 요약 줄을 원인으로 가진다
- 단계 8 균형 (5e5d5f0): GAIN_K 0.5 → 1.0 (§3.2 의 '확인 필요' 목표), 새 상수 RUIN_REPAIR 4 → 3 (§6.4-2), PRE_BURN 0.35 는 재 보고 그대로 두었다
- 단계 8: chain --check 의 기준 6·7 의 꼴을 정했다(deviations 참고). 진단 칸(펌프 시작 평균·고장, 짝 차이)도 더했다
- §9 완성: tests/persistence.test.ts 84 → 85개. 성장 식(GAIN_K), 6·10 의 요약 줄 숙련 문턱과 교대마다 GAIN_CAP 안의 성장, 3 의 끝 상태 표가 RUIN_REPAIR 를 쓴다. §9 의 1~11 은 앞 단계까지 모두 있었다
- 측정: 보통 24×8 --check 통과, 어려움 12×8 --paired 표, quake@1 12×6 표(--check 안의 회복 실행), --soot 의 심각도 2·3·4·5. 진단으로 어려움의 몫 나누기(--strip)와 시험 3 ⑥ 바탕의 PRE_BURN 0.35·0.2·0.1·0.05 비교를 했다
- 구현 메모 (2cb396a): docs/specs/I2-persistence.md 끝에 '단계 8 — 측정·균형' 절. 실제 이름, 기준의 꼴, 본문과 다른 곳 10, 수치·표, 알려진 문제, 이어받을 자리

## 하지 못한 것

- README.md·CLAUDE.md·docs/ROADMAP.md·docs/specs/README.md 는 고치지 않았다. 다음 문서 단계의 몫이고(지시대로), 넣을 내용은 구현 메모의 '이어받을 자리'에 적었다
- §11.1-7 (수가 적은 건물 종류의 ruin → closed 규칙): 재지도 넣지도 않았다
- 펌프가 이어갈수록 좋아지는 쪽(보통 0.66 → 0.77)과 섬광탄 STOCK_CAP 이 정수 합보다 작은 조건(장비 4·5 와 부대 규모 4 이상, 프리셋 밖)은 손대지 않았다. 측정 결과 어려움에서는 정비의 몫이 펌프의 몫보다 컸다
- 어려움에서 이어받은 상태가 (성공+지연)을 낮추는 몫(짝 차이 −5.0%p)은 손잡이로 더 줄이지 않았다. 몫 나누기에서 한 몫이 도드라지지 않았고, 사용자 결정은 '실패도 결과'다
- 화면 확인(§5.6)은 이 단계 범위가 아니라 하지 않았다. 화면 코드는 고치지 않았다

## 설계서와 다르게 한 곳

- 기준 7 (chain --check): 본문은 '교대 번호마다 checkMetrics 실패 0'(교착 래칫 포함)이다. 실제로는 교대 번호마다 checkMetrics(baseline: false)(구조의 관문)이 0 이어야 하고, 잊힌 사건 0, 교착 후보는 같은 시드·조건을 이어받은 상태 없이 돈 대조군과 견준다(이어받은 교대 ≤ 대조군 + STALL_SLACK 2). 까닭: sweep 의 교착 관문은 정해진 시드 S0~S39 의 래칫인데, 이어받은 상태가 없는 보통 200교대(S0~S199)에도 교착 후보가 1건(S145 #05) 있다. 첫 측정의 후보 C20.7 #17 도 X6 의 종료 차단 대기(건물 구역 2·gated 1·빈 작업판 88초)였다. 이 때문에 --check 는 교대를 두 배 돈다
- 기준 6: 결장 비교를 교대 4 대신 교대 5 ≤ 교대 2 로 했다. H1 의 가장 긴 결장인 쓰러짐 3교대가 지진 교대의 다음 셋(2·3·4)을 채우기 때문이다. 첫 측정은 교대 4 0.92 > 교대 2 0.67, 교대 5 0.25 였다. 본문이 '확인 필요: 첫 측정 뒤 수치를 정한다'로 남긴 자리다
- 기준 6 은 보통 --check 안에서 quake@1 12×6 을 이어서 돈다(본문은 1~7 을 24×8 한 줄에 적었다)
- chain.ts 에 본문에 없는 진단 --paired·--strip 과 JSON 칸을 더했다: shifts·expMax·pumpStart·pumpFails·m.forgotten, 밖에 spiral·recovery·stall·paired·fails·sec. m.metricFails 는 구조의 관문 수다
- --soot 의 바탕은 단계 5 의 s5-soot.ts 와 같다(60초 SOOT0 의 상태·건물 281·화재 std). 같은 사건 시드의 짝 차이를 함께 낸다
- 새 상수 이름 RUIN_REPAIR (persist.ts — placeOutcome 의 무너짐 두 줄, 본문 표의 4 → 3)
- PRE_BURN 은 §6.3-8 '늘면 손본다'와 달리 0.35 그대로다. 작은 불은 분모 효과로 소실률이 +0.005~0.008 오르지만, 번지는 불(시험 3 ⑥ 의 바탕)은 탄 칸 −27%·소실률 −0.015 로 덜 탄다. 0.1 등으로 낮추면 그 몫이 사라지고 시험 3 ⑥ 이 실패한다. 부호를 바꾸려면 재산 피해의 분모를 처음 연료 칸으로 두어야 하는데, 본문과 다르므로 사용자 판단이다
- 요약 줄의 '숙련이 오른 대원' 문구가 GROWN_MIN 문턱을 쓴다(이어받은 교대의 해시만 바뀐다)

## 설계서 밖의 공용 파일을 고친 곳

- scripts/metrics.ts · Probe.sample 의 carryInc 줄: 이어받은 감속 구간(carryState.slowed)도 carry 로 센다. 단계 4 의 알려진 문제였고, 설계서 §10.2 표에는 없는 자리다. 측정만이라 결과는 그대로다
- tests/causality.test.ts · '대응표가 문구를 아직 잡는다'의 it.skip(T5) 를 실제 시험으로 바꿨다(§8 완료 조건 3 — 설계서가 허락한 자리). makeCarryover import 한 줄도 더했다
- scripts/sweep.ts · mk()·옵션·--check 조건: --carry <파일>(설계서 §10.2 가 허락한 자리). readCarryover·carryKey import, --json 의 carry 칸, --carry 일 때 기준 범위와 교착 래칫 제외

## 결과

해시 목록 158교대 (scratchpad wf-persist/s67-hashlist.ts, 기준 s04-base-hashes.txt = 19a7e68): hash-a(07dc469), hash-b(중간안), hash-c(5e5d5f0 마지막 코드) 셋 다 diff 0.

npm run check 통과 (5e5d5f0): 파일 20, 1067개 통과, 건너뜀 0, 10분 47초. sweep 40 --check 통과 — 590건, resolved 588, timeout 1, abandoned 1, 교착 0, 잊힘 0, C1~C5 0, holes 0, carry 0%.

chain.ts 24 8 --check (보통, 마지막 상수) 검증 통과, 370초.
| k | 성공+지연 | 결장 | 정비 | 통제+무너짐 | 흔적 | 복구 도로 | 경험 최대 |
|---|---|---|---|---|---|---|---|
| 1 | 82% | 0 | 0 | 0 | 0 | 0 | 0 |
| 2 | 85% | 0.21 | 0.67 | 1.38 | 0.67 | 0.42 | 0.017 |
| 4 | 83% | 0.21 | 0.96 | 4.17 | 1.75 | 0.38 | 0.045 |
| 6 | 80% | 0.33 | 0.67 | 2.92 | 3.75 | 0.50 | 0.069 |
| 8 | 81% | 0.21 | 0.92 | 3.09 | 3.79 | 0.42 | 0.095 |
- 나선 Δ −3.3%p, SE 2.5, 한계 ±8.0.
- 한계 시간·무대응·방치 0.5%. 예외 0, 열린 사건 0, 왕복 실패 0.
- 짝 차이(이어받은 교대 − 같은 시드의 새 교대) −1.0%p (SE 0.7).
- 교착 후보: 이어받은 교대 1, 대조군 1, 잊힘 0.

지진 회복 quake@1 12×6 (--check 안):
- 복구 도로: 교대 2 5.92 (≥1), 교대 4 0.17 (≤2.96).
- 결장: 교대 2 0.67, 교대 4 0.67, 교대 5 0.17 (≤0.67).
- 통제+무너짐: 교대 2 8.42 → 교대 6 4.17 (≤4.21).
- 교대 1~6 성공+지연 44 · 78 · 85 · 82 · 74 · 78%.

어려움 12×8 --paired: 성공+지연 65% → 59%, Δ −5.3%p (SE 3.8, 표만). 짝 차이 −5.0%p (SE 1.4). 무너짐 교대 8 4.92 (RUIN 4 일 때 7.25). 한계 시간 2.2%. 교착 1 대 대조군 0.

몫 나누기 (어려움, RUIN 4·GAIN 0.5 일 때): 모두 −3.5. 건물만 −0.5, 결장만 0.0, 도로만 −0.3, 부대·창고·성장만 −1.1.

--soot (PRE_BURN 0.35), 심각도 2·3·4·5: 소실률 짝 차이 +0.005 · +0.008 · +0.005 · +0.006, 탄 칸 −0.2 ~ −1.0. 시험 3 ⑥ 바탕(12시드): 탄 칸 −27%, 소실률 −0.015. PRE_BURN 0.1 이면 탄 칸 −3%, 소실률 +0.004, 처음 6시드 실패.

바탕 비율: sweep 200 보통 교착 후보 1.

처음 상수(GAIN 0.5·RUIN 4)의 첫 측정: Δ −5.3. C20.7 교착으로 옛 기준 7 실패. 기준 6 은 교대 4 결장 0.92 > 0.67, 교대 6 통제 4.25 > 4.21 로 실패.

tests/persistence.test.ts 85개 통과. causality T5 통과.

## 알려진 문제 · 다음 작업자가 알아야 할 것

- 어려움에서 이어받은 상태가 성공+지연을 5%p 남짓 낮춘다(짝 차이 −5.0, SE 1.4). 보통은 −1.0 이다. 몫이 고루 퍼져 손잡이는 더 돌리지 않았다. 필요하면 §6.4-4(SERVICE_CAP·정비 시각)부터 본다
- 기준 6 의 교대 6 통제+무너짐 4.17 ≤ 4.21 은 여유가 작다. 지진의 전소 건물(5교대)이 교대 6 까지 닫혀 있다. 상수를 다시 바꾸면 이 줄부터 깨질 수 있다
- 기준 7 의 교착 후보는 앞 묶음(X6 종료 차단 대기, 무장 사건의 수색·교전)에서 나오는 바탕 후보다. 진단 대본: scratchpad s8m/lin.ts·stallprobe.ts
- 그을음의 방향은 불의 크기에 따라 갈린다. 작은 불의 소실률 오름은 분자·분모에서 함께 빼는 설계 탓이라, 바꾸려면 재산 피해의 분모를 처음 연료 칸으로 두는 사용자 판단이 필요하다. 시험 3 ⑥ 은 번지는 불의 바탕(앞 교대의 정비)에 기대므로 상수를 바꾸면 다시 본다
- 성장: 교대 8 최댓값 0.095, 열 교대면 약 0.12 로 목표 0.15 의 아래쪽이다. GAIN_K 를 더 올려도 GAIN_CAP 에 묶여 맨 위 사람은 크게 늘지 않는다
- --check 는 대조군 때문에 교대 492번(6분 남짓)을 돈다. npm run check 에는 넣지 않았다(§6.3)
- 문서 단계가 할 일: CLAUDE.md §10.3 줄 전부(명령 표 chain.ts 24 8 --check 포함), README 조작법·ui-check 9·sweep --carry, ROADMAP 에서 K1 끝남과 '세계 상태의 교대 간 지속' 새 항목. 화면 확인 2 의 상태는 chain.ts 1 4 --disaster quake@1 --dump <폴더> 의 C0.1.org.json 을 쓴다
- scratchpad: /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-persist/s8m/ (normal-2.txt, hard-2.txt, soot-2.txt, hash-c.txt, check.log, sweep200-base.txt, soottest*.txt)
