## branch
wf/injuries-s4a

## commit
de10540d8e21267ccae7ef98ba8f5c17baa65b00

## checkPassed
True

## done
- 준비: wf/injuries 에서 wf/injuries-s4a 를 만들고 claude/great-ptolemy-s31sxn 을 먼저 합쳤다(5a98f86). 커밋마다 git branch -f wf/injuries HEAD — 지금 wf/injuries = wf/injuries-s4a = de10540. 푸시·PR 없음, git status 깨끗함
- 단계 4a-1 (87aa05f, 시험 고침 5f0003d): 대원의 피해를 injury.ts 의 hurtResponder 한 길로 모았다 — 총상·자상·둔상(tickHostiles), 폭발(blast), 통과 차량(tickLane), 해일(rules/disaster.ts), 연기·불(agentHealth). 방호는 §2.4 의 'R1 이 있으면' 열(armorOf·blastFactor)
- 단계 4a-1: 문턱과 출혈 — 틱 시작 체력 a.hpTick 이 41 이상이면 한 번의 피해로 죽지 않고 체력 8 에 남는다(MATE_LETHAL_FROM·MATE_FLOOR), 쓰러진 뒤 출혈 상한 0.04, 출혈 최대 0.12, 원인별 BLEED_PER_DMG, 난이도 손잡이 tune.injuryMul(심각도 0.75~1.25)
- 단계 4a-1: 상태 전이 — sceneManager.agentHealth 를 고쳐 쓰고 settle(부상 → 쓰러짐 → 순직)을 두었다. 새 문제 코드 RESPONDER_KILLED('대원 순직', 보고서 맨 앞, 문장 '순직: …'), 기록은 '○○ 대원 생체 반응 소실.' 과 원인·경과(구조되던 중 / 구조되지 못함 / 후송을 기다리던 중). 판정 직전에 밀린 전이를 끝내는 settleInjuries 를 closeIncident 첫 줄에 두었다
- 단계 4a-1: 다친 대원의 능률 hurtF(staminaF 에 곱한다), 후퇴 조건 mustRetreat(체력 40 미만 또는 출혈 0.09 이상이면서 체력 70 미만), 불길을 뚫고 나가는 후퇴(agentCost·moveTo 의 escape), 길이 없으면 한 번 알리고 5초마다 다시 본다
- 단계 4a-1: 동료의 상태 — mateFact(거리 규칙: 숨진 것은 2칸 안, 부상 정도는 3칸 안), perceive 의 동료 고리, significant, 지휘관의 rescueMate(쓰러진 동료 0.97 / 숨진 동료 수습 0.55, needFor: 총을 든 현장이면 경찰·아니면 구조), fitFor(본인 0, 위험 현장은 경찰만, 위험한 실내는 공기호흡기), 실행기 rescueMate(강제 보고·물가 대기·수습 문구)
- 단계 4a-1: 4번 블록 지휘권 승계 문구를 후임이 믿는 동료 상태로(순직·쓰러짐·부상으로 지휘 불능), 7번 블록과 air.tellDispatch 가 outstanding(a, now, s) 의 mates 를 본다. 흉기·맨손 피습 기록('○○ 피습') 추가, 숨진 대원은 이송 중 처치·표적·통과 차량에서 뺐다
- 단계 4a-1 의 임시 조치(과제 지시): 물러난(withdrawn) 대원의 출혈을 멈춘다 — 후송은 단계 4b 에서 온다
- 단계 4a-2 (213ea0a): 예전에 방호가 없던 몫의 새 방호값 — 자상 armorOf×0.5, 독성 화학 대응 요원(hazTech) 0.95, 압궤 방탄 조끼·방탄판 0.1, 추락 방화복 0.2, 감전 방화복 0.4. 이 커밋만 따로 sweep 을 쟀다
- 7e01781: 숨진 동료의 수습 때문에 지원 부대를 부르지 않는다(commander 의 '맡을 사람이 없는 작업' 블록) + 변이 확인에서 살아남은 것을 잡는 시험 보강
- 시험: tests/injuries.test.ts 58 → 97개(방호 3, 문턱 5, 상태 전이 6, 다치는 자리 4, 동료의 상태 4, 지휘관 5, 실행기 6, 순직 2 등). 변이 확인 99가지 가운데 95가지를 시험이 잡았고 남은 4가지는 결과가 같은 변이다
- 깨지기 쉬운 두 시험(tests/sim.test.ts 생활 사건 성공률, tests/crime.test.ts 폭동)을 4a-1·4a-2 뒤에 각각 돌려 통과. loops·causality·crews 도 관문 안에서 통과
- 설계서 끝 '구현 메모 (진행 중)'에 단계 4a 절을 덧붙였다(de10540): 실제 이름 표, hurtResponder 로 옮긴 자리, 상태 전이와 새 규칙, 본문과 다르게 한 열여덟 곳, 시험, 수치, 단계 4b 가 이어받을 때, §12.1 밖에서 고친 곳. '상태' 문단도 4a 완료·다음은 4b 로 고쳤다

## notDone
- outstanding().mates 의 '병원이 필요한 동료' 항과 mateNeedsHospital/needsHospital — 처치·후송(treatMate·evac)이 단계 4b 에 있어 4a 에서는 쓰러진(숨지지 않은) 동료만 센다. 4b 로 넘겼다
- IncidentResult.respondersKilled 와 그 시험 줄(§10 4-③) — 판정을 고치는 단계 6 의 몫이라 넣지 않았다. 지금 evaluate 는 숨진 대원을 쓰러진 대원으로 센다
- 탈진 쪽 체력 깎임의 문턱 처리 — 단계 4c 의 몫이라 손대지 않았다
- npm run ui-check 는 돌리지 않았다 — 화면(src/view·src/ui)을 고치지 않았다
- 부대 운용 중단 문구('대원 전원 부상으로 운용 중단')와 5번 블록의 순직 대원 처리는 그대로다 — 단계 4b

## deviations
- 출혈로 물러나는 문턱: 설계서 0.06 → 실제 MATE_RETREAT_BLEED 0.09(체력 조건 MATE_RETREAT_HP 70 은 그대로). 0.06 에서는 보통 다친 대원 0.55/교대, 무장 성공률 −11.5%p, 가정 폭력 강제 실행 11/20 이었다. 네 조합(0.06/60, 0.09/60, 0.09/70, 0.08/70)을 재고 골랐다 — §9.3 의 균형 손잡이 1번
- 출혈의 원인을 대원에게 적어 둔다: 새 칸 Responder.bleedCause(types.ts, resources.ts 의 두 대원 리터럴에 undefined 로 추가) — 출혈로 숨졌을 때 순직 원인을 대려고
- 출혈 틱을 따로 떼었다: injury.woundTick(sim, r, k) — agentHealth 가 부른다. 설계서의 noteRespHurt 는 지우고 hurtCauseNow(이 틱의 가장 큰 피해 원인, WeakMap)로 바꿨다
- 방호는 숨은 고장을 모르는 hasKit 로 읽는다(피해 계산이 고장을 드러내지 않게). 압궤는 max(1 − blastFactor, 조끼·방탄판이면 0.1) — 폭발물 처리복 0.65 가 그대로 남고, 조끼에는 폭발 방호를 새로 주지 않았다
- 쓰러짐 판정은 Responder.status 가 'down' 이 아닌가로 본다(r.status !== 'down') — 현장을 옮긴 뒤 같은 대원이 두 번 쓰러짐으로 기록되지 않게
- 판정 직전의 전이: sceneManager.settleInjuries 를 incidents.closeIncident 첫 줄에서 부른다 — 사건이 닫히는 틱에 체력이 0 이 된 대원이 기록 없이 남지 않게(설계서에 없는 자리)
- 퇴로가 불로 막힌 다친 대원: 설계서의 '그 자리에서 쓰러진다' 대신 불길을 뚫는 후퇴 경로(escape)를 주고, 정말 갇혔으면 5초마다 다시 본다. 고치기 전 40교대에 제자리 철수 처리가 보통 0·어려움 5·극한 12건이었고, 고친 뒤 60교대씩에서 0건
- outstanding 의 모양: 셋째 인자 s?(현장)와 onScene 거르개(이미 떠난 동료의 낡은 믿음을 세지 않는다), 돌려주는 mates 는 쓰러졌고 숨지지 않은 동료만
- 닿을 수 없는 수습: commander.recoveryStuck — 숨진 동료의 수습을 맡을 사람이 없으면 종료를 막지 않는다(모든 사건은 끝난다). 같은 생각으로 숨진 동료의 수습 때문에는 부대를 부르지 않는다(7e01781)
- 문턱 계산: 문턱은 체력을 올리지 않는다(min 으로 묶는다) — 이미 8 아래인 대원이 문턱 덕에 체력이 오르지 않게
- mateFact 의 부상 정도는 3칸 밖에서는 상태 변화만 전한다(정도는 '모름'으로 묶는다). 숨진 줄 안 것은 2~3칸에서도 되돌리지 않는다
- 부상 후퇴 무전은 대원마다 한 번(brain 의 hurtTold WeakSet), 원인은 a.hurtEv 를 쓴다
- 순직 기록의 상세를 세 갈래로 나눴다: 안전 구역에서 후송을 기다리던 중 / 쓰러진 뒤 n 만에 구조되던 중 / 쓰러진 뒤 n 동안 구조되지 못함
- 이송 중 처치에서 숨진 대원을 뺐다(resources.ts) — 설계서에는 없던 줄
- 독성 방호는 장비가 아니라 역할로 본다: r.role === 'hazTech' 이면 0.95 (R1 에 화학 보호복 장비가 없다)
- 지휘관의 '대원 부상' 구급 요청은 쓰러졌고 숨지지 않았고 현장에 있는 동료가 있을 때만 낸다. assign 의 두 줄은 sim.responders[b.rid].status === 'injured' 로 본다(단계 4b 에서 경상 근무를 넣을 때 다시 봐야 한다)
- 7번 블록: 동료만 남았을 때 화재·가스·붕괴 현장이면 구조(rescue)를 부른다 — 설계서는 능력을 정하지 않았다
- 사건이 닫힌 뒤에는 용의자의 사격·근접과 통과 차량이 대원을 다치게 하지 않는다(I.phase !== 'closed' — 난수는 그대로 뽑는다)

## sharedEdits
- src/sim/incidents.ts · closeIncident — 첫 줄에 settleInjuries(sim, s, I): 판정 전에 밀린 쓰러짐·순직 전이를 끝낸다
- src/sim/resources.ts · 두 대원 리터럴에 bleedCause: undefined(객체 모양 유지), 이송 중 처치에서 숨진 대원 제외
- src/sim/types.ts · ProblemCode 에 'RESPONDER_KILLED', Responder.bleedCause? (추가만)
- src/sim/difficulty.ts · Tuning.injuryMul (심각도 손잡이 → 0.75·0.9·1·1.12·1.25)
- src/sim/debrief.ts · PROBLEM_LABEL.RESPONDER_KILLED, order 맨 앞, 문장 템플릿 '순직: …'
- src/sim/field/rules/air.ts · tellDispatch — outstanding(op.eye, sim.t, s) 의 mates 를 보고 '쓰러진 대원이' 문구로 수요를 다시 연다
- src/sim/field/rules/disaster.ts · 해일의 대원 피해를 hurtResponder(…, 'drown') 로
- src/sim/field/agents.ts · agentCost(…, escape), staminaF 에 hurtF, mateFact·mateStatus·significant·perceive 의 동료 고리, fitFor 의 rescueMate, HURT_HEALTH = HURT_AT
- src/sim/field/executor.ts · moveTo(…, escape), retreat·rescueMate case, act 의 숨진 대원 표시
- src/sim/field/brain.ts · dangerScore·부상 후퇴가 mustRetreat 를 본다, hurtTold
- src/sim/field/commander.ts · needFor(rescueMate), 동료 고리, assign 의 injured 줄, canClose·recoveryStuck·onScene, outstanding 의 mates, '맡을 사람이 없는 작업' 블록의 숨진 동료 예외
- src/sim/field/hazards.ts · blast·tickHostiles·tickLane 의 대원 피해 줄(blastFactor import 제거)
- tests/injuries.test.ts · 단계 3 의 사망 기록 시험이 대원의 순직 기록을 함께 세지 않게(e.kind !== 'casualty' 거르개), 장부 시험의 대원 갈래

## issues
- 보통 난이도의 다친 대원 0.15/교대는 목표 범위의 아래쪽 끝이다. 물러난 대원의 출혈을 풀면(단계 4b) 다시 재야 한다
- 극한: 한계+방치 40 → 45(허용 +6 안), 다친 대원 1.8/교대(상한 2 바로 아래), 무장 성공 38.7 → 32.7%. 단계 4b·4c 에서 더 나빠지면 손잡이를 다시 봐야 한다
- 부대 규모 1(30교대)에서 한계 시간 종료 4 → 7. 늘어난 3건은 화재이고 다친 대원이 없어 궤적이 갈라진 결과로 보이지만 원인을 끝까지 좁히지는 않았다
- 순직이 거의 나오지 않는다(60교대에 보통·어려움 0, 극한 2). 물러난 대원의 출혈을 멈춘 임시 조치 때문이다 — 단계 4b 에서 그 줄(agentHealth 의 a.status !== 'withdrawn')을 풀고 후송을 넣어야 한다
- 출혈 중인데 체력이 높아 'ok' 로 남은 대원은 상처를 안고 다음 사건에 나간다. 그래서 다친 원인이 생긴 사건과 RESPONDER_HURT 가 기록되는 사건이 다를 수 있다
- evaluate 는 단계 6 까지 숨진 대원을 쓰러진 대원으로 센다(respondersKilled 없음). 보고서 문장에는 RESPONDER_KILLED 가 나온다
- commander.assign 의 injured 건너뛰기 두 줄은 단계 4b 에서 경상 근무를 넣을 때 다시 봐야 한다. mate 사실의 since, 5번 블록의 순직 대원, outstanding 의 병원 항도 4b 몫으로 메모에 적어 두었다
- '퇴로가 막혀 나갈 수 없습니다' 길은 60교대 측정에서 한 번도 나오지 않아 시험으로만 확인했다
- 작업 환경: 긴 heredoc·여러 명령을 이은 bash 는 격리 검사에서 거절된다 — 스크립트를 파일로 쓰고 짧은 명령으로 돌려야 한다. 본 작업 폴더(/home/user/operator)는 건드리지 않았고, 마지막에 그 폴더의 상태를 읽어 확인하는 명령도 격리 규칙으로 막혀 돌리지 못했다

## results
관문: 마지막 커밋 de10540(문서만 — 코드는 7e01781 과 같다)에서 npm run check 통과. 시험 351 통과 + 1 건너뜀(파일 13개), 시드 40개 검증 '검증 통과' — 한계 0, 방치 2, 다친 대원 0.23/교대, 교착 후보 0, 잊힌 사건 0, C1~C5 0, 반복 최대 9. 87aa05f(348)·213ea0a(349)·7e01781(351)에서도 각각 통과. sweep 40 --diff hard --check, --diff extreme --check 도 통과.

60교대, 기준(f9965c0) → 4a-1(87aa05f) → 4a-2(213ea0a):
- 보통: 성공 80.5 → 80.0 → 80.3%, 성공+지연 84.7 → 83.8 → 84.4%, 나쁜 결과 6.0 → 6.3 → 6.3%, 한계+방치 4 → 4 → 4, 구조율 94.1 → 93.9 → 94.0%(숨짐 99 → 104 → 102), 다친 대원/교대 0.17 → 0.27 → 0.15, 무장 성공 76.9 → 73.8 → 76.9%
- 쉬움: 성공 87.6 → 86.8 → 87.1%, 다친 대원 0.08 → 0.13 → 0.10
- 어려움: 성공 63.0 → 61.7 → 62.6%, 한계+방치 15 → 17 → 17(무대응 +1), 다친 대원 0.57 → 1.02 → 0.77, 무장 60.0 → 54.2 → 58.8%
- 극한: 성공 36.4 → 35.0 → 35.2%, 한계+방치 40(+1) → 45 → 45, 다친 대원 0.82 → 2.0 → 1.8, 무장 38.7 → 31.1 → 32.7%

강제 실행 20교대(그 시나리오의 한계·무대응·방치, 기준 → 4a-2): armed/shooter 0·0·0 → 0·0·0(성공 21 → 18, 부분 2 → 5), armed/hostage 0 → 0(성공 18·부분 2 그대로), armed/siege 0 → 0(성공 15 → 12, 부분 4 → 8), armed/riot 0 → 0(성공 19 → 20), 폭발물 같음, 가정 폭력 성공 19 그대로, fire/arson 30 → 31, traffic/bus 한계 1 → 1, 해일 water/evac 32 → 31, 지진 collapse 성공 24 → 22(실패 34 그대로).
부대 규모 1(30교대): 성공 239 → 233, 한계 4 → 7, 방치 2 → 2 (늘어난 화재 한계 3건에는 다친 대원이 없다 — 궤적이 갈라진 것).

대원의 경과(60교대, 4a-2): 보통 RESPONDER_HURT 9건(총상 5·자상 3·화상 1), 쓰러짐 0, 순직 0 / 어려움 47건, 쓰러짐 1(29초 만에 구조), 순직 0 / 극한 109건, 쓰러짐 2, 순직 2(0.033/교대 — 총상 1, 화상 1).
지표(보통 40): 교착 후보 0, 잊힌 사건 0, C1~C5 0, 반복 최대 9(그대로). 장부(69교대, 대원 4,566명): 불일치 0. 넓은 불변 조건(어려움 60 · 극한 60 · 5,5,5,1,5,1 30교대): 위반 0.
해시 목록 68교대: 7e01781 대 213ea0a 0/68 다름, 단계 3 대비 64/68, 기준 대비 68/68.
교대당 시간(사용자 CPU, sweep 20 --no-metrics 번갈아 3회): 기준 19.9/20.5/22.4초 대 새 것 19.6/22.9/22.0초 — 잡음 안.
변이 확인: 99가지 가운데 95가지를 시험이 잡았다. 남은 4가지는 결과가 같은 변이(문턱의 min, ??= 와 r.status 의 겹침, canClose 의 동료 쓰러짐 줄).
측정 도구·기준·기록은 /tmp/claude-0/-home-user-operator/186169fe-a127-5e67-996a-cfc83d22e9db/scratchpad/wf-injuries/s4a/ 에 있다(마지막 관문 기록은 그 안의 check-final.log).
