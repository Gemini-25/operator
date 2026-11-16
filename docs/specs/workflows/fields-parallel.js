export const meta = {
  name: 'r3-fields-parallel',
  description: 'R3 단계 3(소방)·4(의료)·5(특수)를 같은 시작점에서 나란히 구현하고, 합치는 작업자가 셋을 합쳐 전체 균형을 다시 잰다',
  phases: [
    { title: 'Fields', detail: '소방·의료·특수 작업자 셋이 각자 worktree 에서 (브랜치 wf/doctrine-f3·-e4·-s5)' },
    { title: 'Integrate', detail: '셋을 합치고 충돌·맞물림을 고치고 전체 균형·관문 (wf/doctrine-int → wf/doctrine)' },
  ],
}

const P = args
const SP = P.scratch, BASE = P.base, PTR = 'wf/doctrine', ATTR = P.attr

const SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, commit: { type: 'string' },
    done: { type: 'array', items: { type: 'string' } },
    notDone: { type: 'array', items: { type: 'string' } },
    deviations: { type: 'array', items: { type: 'string' } },
    sharedEdits: { type: 'array', items: { type: 'string' } },
    results: { type: 'string' },
    issues: { type: 'array', items: { type: 'string' } },
    checkPassed: { type: 'boolean' },
  },
  required: ['branch', 'commit', 'done', 'notDone', 'deviations', 'sharedEdits', 'results', 'issues', 'checkPassed'],
}

const COMMON = `너는 이 저장소(자율형 긴급구조 시뮬레이션)의 묶음 **R3 — 분야별 대응 교본**(설계서 docs/specs/R3-doctrine.md)을 구현하는 작업자 가운데 하나다.

## 상황 (꼭 읽는다)
- 주 브랜치 claude/practical-keller-xm0ac2 의 HEAD ${BASE} 에 R1·H1·X6·R2 전부와 **R3 단계 0(틀)·1(공통)·2(경찰)** 가 들어 있다. 가리킴 브랜치 ${PTR} 도 ${BASE} 를 가리킨다.
- 사용자 요청(2026-11-16)으로 R3 의 단계 3(소방)·4(의료)·5(특수)를 **같은 시작점 ${BASE} 에서 작업자 셋이 동시에** 하고, 끝나면 합치는 작업자가 셋을 합쳐 전체 균형을 다시 잰다. 그래서:
  - 너는 **네 분야만** 한다. 다른 두 분야의 줄·판단 지점·임무는 다른 작업자가 같은 시간에 만든다 — 당겨 하지 않는다.
  - 공용 파일(types.ts·field/doctrine.ts·doctrine/registry.ts·doctrineRun.ts·brain.ts·executor.ts·commander.ts·agents.ts·tests/doctrine.test.ts)에는 **꼭 필요한 줄만, 합집합·표·객체 글자·파일의 끝에 덧붙이는 식으로** 쓴다(합칠 때 충돌을 줄인다). 기존 줄을 옮기거나 이름을 바꾸지 않는다. tests/doctrine.test.ts 에는 네 분야의 describe 묶음을 **파일 끝에** 따로 둔다. DOC_DEPTS_DONE 에는 네 분야만 더한다.
  - **${PTR} 가리킴 브랜치를 옮기지 않는다**(합치는 작업자가 옮긴다). 네 브랜치에만 커밋한다.
- 먼저 docs/specs/README.md("실행 방법"·"설계서 사이의 정본")와 docs/specs/R3-doctrine.md 를 처음부터 끝까지 읽는다. 끝의 "구현 메모 (진행 중)"의 단계 0·1·2 절이 실제 이름·걸리는 자리·이어받을 자리의 정본이다. 앞 묶음의 실제 이름은 각 설계서 끝 구현 메모의 "최종 요약"(R1·H1·X6·R2 — 특히 R2-methods.md 끝 "최종 요약"의 첫 표)이 정본이고, 설계서의 이름과 다르면 **코드를 따르고** deviations 에 적는다(R3 §11.2-7).
- 다른 묶음이 남긴 R3 몫(정본은 각 설계서 끝 구현 메모): X6 독립 검토 — doctrine.ts 의 opsLevel 이 구역의 regions 만 보아 원형(가스 용기) 구역(regions: [])이 docSit.danger·wDanger 에서 빠진다(ops.zoneLevelAt 같은 칸 판정으로 고칠 자리). X6 dangerMap 은 DangerHit.rule 에 줄 id 를 적는다(CF5·CF6). R2 — 폭파 진입(charge)이 실제 교대에서 0건(목표 ≥2): 잠긴 문을 진입 전에 다른 일 하던 대원이 차서 열고, 문 여는 사람을 모인 진입조에서 고르는데 장약을 든 진입대원(파괴)이 드물다. 한 번 났을 때 문 뒤 인질 위치를 모르면 인질이 다쳤다. R2 메모: R3 S15 가 헤엄의 '호이스트 머리 위 ×0.7' 을 대신한다. I2 단계 2 — 결장자(status 'off')가 u.crew 에 남고 예비 인력이 붙으면 u.crew 가 길어진다(짝·최소 인원 판정은 fieldCrew·off 제외로 센다). N8·N9 의 틀이 DOC_OF_UNIT·DOC_OF_ROLE·PAIRS·SOLO_OK 에 새 부대(편성되지 않음) 줄을 넣어 두었다 — 지우지 않는다. 단계 2 메모: finishTask 사유 'doctrine'·'handover', docBegin 의 캐스트, P17·P17b 는 단계 3 으로 넘어왔다(pairUp·interiorEntry 필요), P20 은 단계 6.
- 사용자 결정(바꾸지 않는다): 폭파 진입은 실제 방법(고르는 때는 R3 S26), 다친 대원은 risk > 0 인 방법을 고르지 않는다·걸을 수 있는 부상자는 가벼운 일만(LIGHT_WORK), 부대 운용 중단은 걸을 대원이 없을 때만, 용의자 자해 끔, 피 그림 없음.

## 작업 폴더와 브랜치
지금 있는 곳은 너만의 git worktree 다. /home/user/operator(주 작업 폴더)의 파일은 절대 고치지 않는다. 먼저:
\`\`\`bash
[ -e node_modules ] || ln -s /home/user/operator/node_modules node_modules
git checkout -q -b BRANCH ${BASE}
git log --oneline -6
npx tsc --noEmit
\`\`\`
- 커밋은 BRANCH 에만, 한국어 메시지 머리 'R3 단계 N: …'. 끝에 다음 두 줄:
${ATTR}
- 푸시하지 않는다. PR 을 만들지 않는다. 작은 것부터 끝내 자주 커밋한다. 끝낼 때 git status 가 깨끗해야 한다.
- 임시 파일·기준 수치·스크린샷은 저장소 밖 ${SP}/wf-doctrine/par/<분야>/ 에(없으면 만든다).
- **이 기계(CPU 4개)에서 다른 작업자 둘이 동시에 돈다.** 명령이 느리고 시간 측정이 흔들린다. npm run check 는 7~12분 걸릴 수 있다. 시간 초과로만 실패한 시험은 그 파일만 다시 돌려 확인한다(기준을 고치지 않는다). 측정은 꼭 필요한 것만: 0단계 기준은 ${BASE} 를 git archive 로 따로 푼 사본에서 **네 분야에 관계된 것만** 잰다(보통 60교대 한 번 + 네 분야의 강제 묶음). 다른 포트의 개발 서버, 네가 띄우지 않은 프로세스, 다른 작업 폴더(.claude/worktrees/ 의 다른 폴더)와 다른 wf/ 브랜치는 건드리지 않는다.

## 지켜야 할 것
- 설계서가 정본, 맡은 단계만. 재현성(src/sim 에서 Math.random·Date·performance·window·document 금지, 새 난수는 설계서가 이름을 정한 흐름만). 정보 격리(시험 1 이 글자로 본다 — 느슨하게 고치지 않는다: 교본 판단은 믿음·crew 사실·생김새·자기 몸만). 가짜 기록 금지. 모든 사건은 끝난다 — 판단 지점의 기다림(docGate)에는 반드시 상한과 그 문구가 있어야 한다.
- 테스트를 건너뛰거나 기준을 낮춰 통과시키지 않는다. 관문 범위(scripts/sweep.ts --check)를 고치지 않는다. 끝내지 못한 줄은 켜 두지 말고 notDone 에 적는다.
- 기록 문구를 바꾸거나 새 문제 코드를 만들면 scripts/metrics.ts 의 PHRASE·PROBLEM_SYS 와 tests/causality.test.ts 를 함께 고친다. 자주 도는 객체에 새 칸을 더하면 생성 리터럴에도 넣는다.
- README·CLAUDE·ROADMAP·docs/specs/README.md 는 고치지 않는다. R3 설계서 끝 '구현 메모'에 **네 단계 절 하나만** 덧붙인다(다른 작업자도 같은 자리에 덧붙이므로 절 제목을 '### 단계 N (분야) — 2026-11-16, 나란히 실행' 으로).

## 끝내는 조건
설계서 §9 표의 네 단계 줄의 "끝났다는 증거"와 "시험" 칸 그대로 + npx tsc --noEmit + tests/doctrine.test.ts + npm run check 통과. 0단계 기준(${BASE}) 대비 네 분야의 전후 수치(보통 60 의 분포·close reasons 의 timeout, 네 분야 강제 묶음의 성공·한계 시간·대원 부상, 교본 줄 쓰임)를 results 에.
마지막 응답은 구조화된 보고다(끝낸 것 / 못 한 것 / 설계와 다르게 한 곳 / 설계서 밖에서 고친 공용 파일 — **합치는 작업자가 충돌을 풀 때 읽는다, 파일·함수·줄 위치까지** / 수치 / 알려진 문제 / 마지막 커밋에서 관문 통과 여부).`

const FIELDS = [
  { id: 'f3', stage: 3, name: '소방', branch: 'wf/doctrine-f3', body: `## 맡은 범위 — 단계 3 (소방)
§9 표의 3단계 줄 그대로: 짝(PAIRS·pairUp·rebuddy·pair 임무·G08 — 결장자 off·예비 인력이 붙은 부대·최소 인원 부대에서 막히지 않게 fieldCrew·off 제외로), interiorEntry 판단 지점, airOut·pairOut 의무와 실행(§5.7), AIR_IN, R1 공기통 교체 후보의 문턱, feel·pulse 방법 행, sparePump, F 줄 전부, CF1~CF7(CF5·CF6 은 X6 DANGER_RULES 두 줄 — DangerHit.rule), D4·D5, TaskKind airOut·pairOut·pair, §3.7 끝의 진압 외부 방어 조각(R2 단계 4 가 defensive 의 can 을 채웠다), doctrine.ts opsLevel 의 원형 구역(위 상황의 X6 몫), 단계 2 에서 넘어온 P17·P17b(pairUp·interiorEntry 위). 단계 1 메모의 'methodStillFits 가 교본 배율을 보지 않아 배연 뒤 전환이 교본을 무시한다 — F03b·F04b·F05b 를 넣을 때 고칠 것'. **화학 짝·대기조(S10·S11 — 특수 분야)는 하지 않는다** — 합치는 작업자가 네 pairUp 위에 넣는다. pairUp·PAIRS 의 쓰는 법(인자·반환·짝 기억 칸)을 구현 메모와 sharedEdits 에 분명히 적는다. 시험 2-c·2-f, 3(숨은 고장 — 열화상·fitFor(waterRescue) 의 남의 몸), 4(공기 왕복·짝 동행 경계 — fire/std 강제), 6(fire/std), 7(공기 부분), 8(소방 ≥ 12), 9. 끝: 화재 강제 묶음(fire/std·fire/arson 20교대)의 표, §8.2 의 화재 범위.` },
  { id: 'e4', stage: 4, name: '의료', branch: 'wf/doctrine-e4', body: `## 맡은 범위 — 단계 4 (의료)
§9 표의 4단계 줄 그대로: WorkKind 'triage'(workLabel '다수 사상자 분류', fitFor 구급만, 실행: 믿음 속 환자마다 2초 서서 casFact 강제 보고 → s.triageAt), CE1 의 band 1 미루기·거두기, 경계 밖 처치소(E05 — fitFor treat 기본 규칙), carryHold·laneTreat 판단 지점, 처치 넘겨받기(CE2 — 실행기 treat 의 handover, finishTask 사유 'handover'), E 줄 전부(E13·E14 는 6단계라 하지 않는다), CE1~CE5. H1 의 treatMate·treatSuspect·LIGHT_WORK 와 맞물리는 곳을 확인한다(다친 대원의 처치·탑승 우선순위). 시험 2-g, 8(의료 ≥ 12). 끝: 응급(medical/trauma 등)·교통(traffic/std·traffic/bus) 강제 묶음 20교대, **응급 대응 지연 비율이 늘지 않는다**.` },
  { id: 's5', stage: 5, name: '특수', branch: 'wf/doctrine-s5', body: `## 맡은 범위 — 단계 5 (특수)
§9 표의 5단계 줄 그대로: 줄 서기 진입(S01), 저격·섬광탄 가산(S02·S05), 해체 방법 셋과 WORK_MODE(§3.7 — fitFor defuse 에 로봇 자격, bareDefuse 의 방호 끄기), 장치 반경(S08·CS1, agentCost +20), 수난·헬기 줄(S13·S15·S25 — S15 가 들어오면 R2 의 헤엄 '호이스트 머리 위 ×0.7' 을 지운다), 사다리 조작원(S19), S21~S24, **폭파 진입의 교본(S26·S03) — R2 의 폭파 진입 0건을 받는다**: 장약을 든 사람이 문을 연다(진입조에 장약 든 진입대원(파괴)을 넣거나 문 여는 사람으로 고른다), 인질 위치를 모르면 폭파하지 않는다(믿음으로), 진입 전 잠긴 문을 함부로 차지 않는다. 단계 1 메모: R2 폭파 진입(runCharge 의 hazards.blast)도 반경+3칸 진입조를 동요시킨다 — 의도한 폭발을 빼는지 S26 과 함께 정한다. CS2, D1. **화학 짝·대기조(S10·S11)는 하지 않는다** — 소방 작업자가 지금 만드는 pairUp 위에 서므로 합치는 작업자가 넣는다(S10·S11 의 줄 글자는 써 두지 말고 notDone 에 '합치는 작업자 몫'으로). 시험 2-i, 8(특수 ≥ 12 — DOC_DEPTS_DONE 에 특수). 끝: 폭발물(armed/bomb)·가스(hazmat/std)·수난(water/std) 강제 묶음 20교대, armed/hostage·armed/siege 20교대 — **폭파 진입이 몇 건인지 results 에**(목표 ≥2 — 그때 다친 인질 수도).` },
]

phase('Fields')
const fieldResults = await parallel(FIELDS.map((f) => () =>
  agent(COMMON.replace(/BRANCH/g, f.branch) + '\n\n' + f.body, { label: `impl:doctrine:${f.id}`, phase: 'Fields', isolation: 'worktree', schema: SCHEMA })
))
FIELDS.forEach((f, i) => { const r = fieldResults[i]; log(`${f.name}: ${r ? r.commit + ' · 관문 ' + (r.checkPassed ? '통과' : '통과하지 못함') : '보고 없음'}`) })

const brief = (r) => !r ? '(보고 없음 — 작업자가 중간에 멈췄다. git log 로 어디까지 커밋됐는지 직접 본다)' :
  ['브랜치·커밋: ' + r.branch + ' ' + r.commit, '관문: ' + (r.checkPassed ? '통과' : '통과하지 못함'), '끝낸 것: ' + (r.done || []).join(' / '), '못 한 것: ' + ((r.notDone || []).join(' / ') || '없음'), '설계와 다른 곳: ' + ((r.deviations || []).join(' / ') || '없음'), '설계서 밖에서 고친 공용 파일: ' + ((r.sharedEdits || []).join(' / ') || '없음'), '알려진 문제: ' + ((r.issues || []).join(' / ') || '없음'), '수치: ' + (r.results || '')].join('\n').slice(0, 9000)

phase('Integrate')
const integ = await agent(`너는 R3 — 분야별 대응 교본(docs/specs/R3-doctrine.md)의 **합치는 작업자**다. 사용자 요청으로 단계 3(소방)·4(의료)·5(특수)를 같은 시작점 ${BASE} 에서 작업자 셋이 동시에 만들었다. 네 일은 셋을 하나로 합치고, 셋이 따로 만들어 생긴 맞물림 문제를 고치고, 셋이 함께 들어간 상태의 전체 균형을 다시 재는 것이다.

먼저 docs/specs/README.md 와 docs/specs/R3-doctrine.md 를 처음부터 끝까지 읽는다(끝의 구현 메모 — 단계 0·1·2 와 셋이 덧붙인 단계 3·4·5 절).

## 세 작업자의 보고
### 단계 3 (소방) — ${FIELDS[0].branch}
${brief(fieldResults[0])}

### 단계 4 (의료) — ${FIELDS[1].branch}
${brief(fieldResults[1])}

### 단계 5 (특수) — ${FIELDS[2].branch}
${brief(fieldResults[2])}

## 작업 폴더와 브랜치
너만의 git worktree 에 있다. /home/user/operator 의 파일은 고치지 않는다.
\`\`\`bash
[ -e node_modules ] || ln -s /home/user/operator/node_modules node_modules
git checkout -q -b wf/doctrine-int ${BASE}
git merge --no-ff wf/doctrine-f3   # 소방 먼저(짝 맺기가 다른 둘의 바탕)
git merge --no-ff wf/doctrine-e4
git merge --no-ff wf/doctrine-s5
git merge --no-edit claude/practical-keller-xm0ac2   # 주 브랜치가 그 사이 움직였으면
\`\`\`
(보고가 없거나 관문을 통과하지 못한 브랜치는 git log 로 어디까지 됐는지 보고 쓸 만한 커밋까지 합치거나, 합치지 않고 그 단계를 네가 이어서 끝낸다 — 보고에 적는다.)
충돌은 대개 합집합·표·객체 글자·파일 끝(tests/doctrine.test.ts 의 describe 묶음, 구현 메모의 절, DOC_DEPTS_DONE)에 양쪽이 줄을 더한 것이다 — 둘 다 남긴다. 함수 본문이 겹치면 세 보고의 sharedEdits 를 읽고 세 의도를 모두 살린다.
- 커밋은 wf/doctrine-int 에만, 메시지 머리 'R3 단계 3·4·5 합치기: …' 또는 'R3 단계 5: 화학 짝(S10·S11) …'. 끝에:
${ATTR}
- **커밋할 때마다 git branch -f ${PTR} HEAD**. 푸시하지 않는다. PR 을 만들지 않는다.
- 임시 파일은 ${SP}/wf-doctrine/int/ 에. 이 기계에서 무거운 작업은 이제 너 하나다.

## 할 일
1. 합치기 → npx tsc --noEmit → npx vitest run tests/doctrine.test.ts → 실패하면 고친다(시험을 느슨하게 하지 않는다).
2. **화학 짝·대기조(S10·S11)** — 특수 작업자가 남긴 몫을 소방의 pairUp·PAIRS 위에 넣는다(§9 5단계 줄). 시험 8 의 특수 ≥ 12 를 다시 확인.
3. **셋이 함께 들어간 맞물림**: 같은 대원이 두 분야의 판단 지점·의무를 동시에 받는 경우(예: 소방 짝 의무와 특수 해체 반경, 의료 처치 넘겨받기와 소방 짝 동행), docAct·docDuty 의 우선순위, 같은 TaskKind·finishTask 사유를 셋이 따로 더하지 않았는가, DOC_DEPTS_DONE 이 네 분야 모두인가, 교본 줄 id 가 겹치지 않는가. 측정 도구로 교착 후보·잊힌 사건·반복 최대가 ${BASE} 보다 나빠지지 않는지.
4. **전체 균형** — §8.2·§8.3 의 범위를 셋이 합쳐진 코드로 다시 잰다(기준은 ${BASE} 를 git archive 로 따로 푼 사본): 보통 60, 프리셋 넷 60, 유형별, §8.3 의 강제 묶음 전부(fire/std·fire/arson·medical·traffic/std·traffic/bus·armed/bomb·hazmat/std·water/std·armed/hostage·armed/siege·armed/shooter 등 20교대), 최소 인원·장비 불량 묶음, 교대당 시간(전후를 번갈아, 사용자 CPU), 교본 줄 쓰임(분야마다 ≥75% — 측정 ∪ 장면 시험 = 100%), split. 벗어나면 §8.4 의 손잡이 차례로 맞춘다. **폭파 진입이 강제 인질극·농성에서 몇 건인지**(R2 의 목표 ≥2).
5. npm run check 통과, 화면을 고친 것이 있으면 npm run ui-check. R3 설계서 끝 구현 메모에 '### 단계 3·4·5 합치기 — 2026-11-16' 절(합친 순서·충돌과 푼 법·맞물림 고침·S10·S11·전체 수치·못 맞춘 목표). README·CLAUDE·ROADMAP·docs/specs/README.md 는 고치지 않는다.

## 지켜야 할 것
재현성·정보 격리(시험 1)·가짜 기록 금지·모든 사건은 끝난다(판단 지점의 기다림에 상한)·관문 범위를 고치지 않는다·시험을 건너뛰지 않는다.

마지막 응답은 구조화된 보고다(끝낸 것 / 못 한 것 / 설계와 다르게 한 곳 / 설계서 밖에서 고친 공용 파일 / 전체 수치 / 알려진 문제 / 마지막 커밋에서 관문 통과 여부).`, { label: 'integrate:doctrine:345', phase: 'Integrate', isolation: 'worktree', schema: SCHEMA })
log(`합치기: ${integ ? integ.commit + ' · 관문 ' + (integ.checkPassed ? '통과' : '통과하지 못함') : '보고 없음'}`)
return { fields: fieldResults, integrate: integ }
