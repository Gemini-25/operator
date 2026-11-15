export const meta = {
  name: 'package-run-v2',
  description: '설계서 하나(묶음)를 단계 덩어리로 나눠 차례로 구현하고, 독립 검토와 문서 단계를 거친다 (준비 단계만 따로 돌리기·앞 묶음과 겹쳐 돌리기 지원)',
  phases: [
    { title: 'Implement', detail: '설계서의 단계를 덩어리로 묶어 작업자를 차례로 (브랜치 wf/<묶음>-<덩어리>, 가리킴 브랜치 wf/<묶음>)' },
    { title: 'Review', detail: '독립 검토와 수정' },
    { title: 'Docs', detail: '화면 확인, 균형 최종 확인, 문서와 구현 메모' },
  ],
}

const P = args
const BASE = P.base, SP = P.scratch, KEY = P.key, PTR = 'wf/' + P.key
const ATTR = P.attr || ''   // 커밋 메시지 끝에 붙일 줄(세션마다 다르다 — args.attr 로 넘긴다)
const PRIOR = P.priorReports || []   // 앞서 따로 돌린 덩어리의 보고: [{ stages, text }]

const SCHEMA = {
  type: 'object',
  properties: {
    branch: { type: 'string' }, commit: { type: 'string', description: 'wf/<묶음> 이 가리키는 마지막 커밋' },
    done: { type: 'array', items: { type: 'string' }, description: '끝낸 것 (단계 번호와 함께)' },
    notDone: { type: 'array', items: { type: 'string' }, description: '맡은 범위에서 못 한 것과 그 까닭' },
    deviations: { type: 'array', items: { type: 'string' }, description: '설계서와 다르게 한 곳: 무엇을 · 왜 · 실제 이름' },
    sharedEdits: { type: 'array', items: { type: 'string' }, description: '설계서의 "고칠 파일" 밖에서 고친 곳: 파일 · 함수 · 이유' },
    results: { type: 'string', description: '전후 수치(성공률·한계 시간·교대당 시간 등), 강제 실행 표, 테스트·관문 결과' },
    issues: { type: 'array', items: { type: 'string' }, description: '알려진 문제, 다음 작업자가 알아야 할 것' },
    checkPassed: { type: 'boolean', description: '마지막 커밋에서 npm run check 가 통과했는가' },
  },
  required: ['branch', 'commit', 'done', 'notDone', 'deviations', 'sharedEdits', 'results', 'issues', 'checkPassed'],
}

const brief = (r) => !r ? '(보고 없음 — 작업자가 중간에 멈췄다. git log 로 어디까지 커밋됐는지 직접 본다)' :
  ['끝낸 것: ' + (r.done || []).join(' / '), '못 한 것: ' + ((r.notDone || []).join(' / ') || '없음'), '설계와 다른 곳: ' + ((r.deviations || []).join(' / ') || '없음'),
   '알려진 문제: ' + ((r.issues || []).join(' / ') || '없음'), '관문: ' + (r.checkPassed ? '통과' : '통과하지 못함')].join('\n').slice(0, 6000)

const prevText = (prev) => PRIOR.map((p) => `### ${p.stages}\n${p.text}`).concat(prev.map((r, k) => `### ${P.chunks[k].stages}\n${brief(r)}`)).join('\n\n')

const machine = P.shared
  ? '- **이 기계(CPU 4개)에서 다른 묶음의 작업자가 동시에 돌고 있다.** 그래서 명령이 평소보다 느리고 시간 측정이 흔들린다. `npm run check` 는 4~7분 걸릴 수 있다. 테스트가 시간 초과로만 실패하면 그 테스트만 다시 돌려 확인한다(기준을 고치지 않는다). 교대당 시간 비교는 전후를 번갈아 재고 사용자 CPU(`time`)로 본다. 다른 작업 폴더(`.claude/worktrees/` 의 다른 폴더)와 다른 묶음의 브랜치(`wf/` 로 시작하는 다른 이름), 다른 포트의 개발 서버, 네가 띄우지 않은 프로세스는 건드리지 않는다.'
  : '- 지금 이 기계에서 무거운 작업은 너 하나다(CPU 4개). `npm run check` 는 3분쯤 걸린다 — 설계서가 단계 끝마다 돌리라고 한 대로 돌린다.'

const setup = (branch, retry) => `## 작업 폴더와 브랜치
지금 있는 곳은 너만의 git worktree 다. **/home/user/operator(주 작업 폴더)의 파일은 절대 고치지 않는다.** 먼저:
\`\`\`bash
[ -e node_modules ] || ln -s /home/user/operator/node_modules node_modules
if git rev-parse -q --verify ${PTR} >/dev/null; then git checkout -q -b ${branch} ${PTR}; else git checkout -q -b ${branch} ${BASE}; fi
git log --oneline -12        # 앞 작업자들이 어디까지 커밋했는지 (커밋 메시지 머리에 단계가 있다)
npx tsc --noEmit
\`\`\`
${retry ? `**이번은 같은 덩어리의 두 번째 시도다.** 앞 시도가 중간에 멈췄다. \`git worktree list\` 로 \`${branch.replace(/-b$/, '')}\` 를 체크아웃한 폴더를 찾아 \`git -C <그 폴더> status --short\` 로 커밋되지 않은 변경이 있는지 본다. 쓸 만한 변경이면 \`git -C <그 폴더> add -A && git -C <그 폴더> commit -m "WIP: 앞 시도의 미완 변경"\` 뒤 \`git branch -f ${PTR} ${branch.replace(/-b$/, '')}\` 로 가리킴 브랜치를 옮기고, 네 브랜치를 그 위에서 다시 만든다(\`git checkout -q -B ${branch} ${PTR}\`). 그런 다음 무엇이 끝났고 무엇이 남았는지 코드와 테스트로 확인하고 남은 것부터 한다.\n` : ''}- 커밋은 \`${branch}\` 에만, 메시지는 한국어로 \`${P.id} 단계 N: …\` 처럼 단계를 머리에 쓴다. 끝에 다음 두 줄:
${ATTR}
- **커밋할 때마다** \`git branch -f ${PTR} HEAD\` 로 묶음의 가리킴 브랜치를 옮긴다(다음 작업자가 거기서 시작한다). \`${PTR}\` 자체를 체크아웃하지 않는다. **푸시하지 않는다. PR 을 만들지 않는다.**
- 작은 것부터 끝내 자주 커밋한다(중간에 멈춰도 커밋된 데까지는 남는다). 끝낼 때 \`git status\` 가 깨끗해야 한다.
- 임시 파일·기준 수치·스크린샷·진단 스크립트는 저장소 밖 \`${SP}/wf-${KEY}/\` 에 둔다(없으면 만든다). 설계서가 \`/scratch\` 라고 쓴 곳이 여기다.
- 개발 서버가 필요하면 \`npx vite --port ${P.port} --strictPort\`(백그라운드), 끝나면 끈다. Playwright 는 \`require('playwright')\` 로 바로 쓴다(설치돼 있다, chromium.launch() 에 옵션 없이).
${machine}`

const rules = `## 지켜야 할 것
- 설계서가 정본이다. 다만 설계서의 줄 번호·함수 이름이 지금 코드와 다르면 **코드를 따르고**(함수 이름으로 찾는다) 보고의 deviations 에 적는다. 설계서가 스스로 "선택"이라고 한 항목은 시간이 남을 때만 한다.
- 맡은 단계만 한다. 뒤 단계의 것을 당겨 하지 않는다(설계서가 단계마다 관문이 통과하게 나눠 놓았다). 앞 단계의 완료 조건이 채워져 있지 않으면 그것부터 고치고 보고에 적는다.
- 재현성: \`src/sim\` 에서 \`Math.random\`·\`Date\`·\`performance\`·\`window\`·\`document\` 금지. 새 기능의 난수는 설계서가 이름을 정한 새 흐름만. 화면만 고치는 단계는 결과 해시가 한 건도 달라지면 안 된다.
- 정보 격리, 가짜 기록 금지(기록은 상태를 바꾸는 코드에서 \`emit()\`), 모든 사건은 끝난다 — 설계서가 단계마다 요구하는 강제 실행(\`--force\`)의 한계 시간·방치 건수를 실제로 잰다.
- 테스트를 건너뛰거나 기준을 낮춰 통과시키지 않는다. 기준 범위(\`scripts/sweep.ts\` 의 \`--check\`)를 고치지 않는다 — 설계서가 균형이 벗어났을 때 돌릴 손잡이의 차례를 적어 두었다. 끝내지 못한 기능은 켜 두지 말고 notDone 에 정직하게 적는다.
- 기록 문구를 바꾸거나 새 문제 코드를 만들면 \`scripts/metrics.ts\` 의 문구 규칙과 \`tests/causality.test.ts\` 를 함께 고친다. 자주 도는 객체에 새 선택 칸을 더하면 생성 리터럴에도 넣는다(저장소 안내서의 "자주 도는 객체의 모양").
- \`README.md\`·\`CLAUDE.md\`·\`docs/ROADMAP.md\` 는 설계서가 그 단계에 고치라고 한 때에만 고친다(대개 마지막 문서 단계).`

const implPrompt = (c, i, prev, retry) => `너는 이 저장소(자율형 긴급구조 시뮬레이션)의 묶음 **${P.title}** 를 단계로 나눠 구현하는 작업자 가운데 하나다(여러 명이 차례로 한다).

## 맡은 범위
설계서 \`${P.spec}\` 의 **${c.stages}**. ${c.focus}

먼저 \`docs/specs/README.md\`("실행 방법" 절과 공통 규칙, "설계서 사이의 정본")와 \`${P.spec}\` 를 **처음부터 끝까지** 읽는다. 맡은 단계의 줄뿐 아니라 그 단계가 가리키는 절(자료형, 표, 고칠 파일 목록, 테스트, 알려진 위험, 검토 메모)을 모두 읽고, 문서가 가리키는 기존 코드를 읽은 뒤 시작한다.${P.priorNotes ? '\n' + P.priorNotes : ''}

${(PRIOR.length || prev.length) ? '## 앞 작업자들의 보고\n' + prevText(prev) + '\n' : ''}
${setup(PTR + '-' + c.id + (retry ? '-b' : ''), retry)}
${c.pre ? '\n## 시작하기 전에 (브랜치를 만든 바로 다음)\n' + c.pre + '\n' : ''}
${rules}

## 끝내는 조건
설계서의 "구현 순서" 표에서 맡은 단계의 완료 조건 그대로: \`npx tsc --noEmit\`, 그 단계의 테스트(\`${P.testFile}\` 의 해당 번호), \`npm run check\`, 설계서가 요구하는 전후 비교(기준 파일은 \`${SP}/wf-${KEY}/\` — 없으면 \`${BASE}\` 를 따로 풀어 다시 잰다).${c.extra ? ' ' + c.extra : ''}
마지막 응답은 구조화된 보고다(끝낸 것 / 못 한 것 / 설계와 다르게 한 곳 / 설계서 밖에서 고친 공용 파일 / 수치 / 알려진 문제 / 마지막 커밋에서 관문 통과 여부).`

const reviewPrompt = (prev) => `너는 독립 검토자다. 다른 작업자들이 \`${PTR}\` 브랜치에 단계별로 구현한 **${P.title}** 를 설계서와 저장소의 불변 조건에 비춰 **틀린 곳을 찾으려는 자세로** 검토하고, 찾은 문제를 직접 고친다. 구현자의 보고를 믿지 말고 직접 돌려서 확인한다. 문제가 없으면 없다고 보고한다 — 고칠 거리를 지어내지 않는다.

먼저 \`docs/specs/README.md\` 와 \`${P.spec}\` 를 처음부터 끝까지 읽고, \`git diff ${BASE}..${PTR} --stat\` 과 바뀐 파일을 읽는다.${P.priorNotes ? '\n' + P.priorNotes : ''}

## 구현자들의 보고 (참고 — 사실인지 확인할 대상)
${prevText(prev)}

${setup(PTR + '-review', false)}

## 꼭 확인할 것 (직접 진단 스크립트를 짜서 수치로 — 스크립트는 \`${SP}/wf-${KEY}/review/\` 에)
1. **설계서 대조**: "구현 순서"의 단계마다 완료 조건이 실제로 채워졌는가. 설계서의 테스트 목록(번호마다)이 \`${P.testFile}\` 에 있고, 느슨하게 바꿔 통과시킨 것은 없는가(기대값을 시드에 맞춰 비틀기, 건너뜀, 범위 넓히기). 빠졌거나 꺼져 있는데 보고에 없는 항목.
2. **재현성**: 같은 시드·조건 두 번의 \`report.hash\`(보통·어려움·극한, 강제 발생, 재난 다섯 종류, 교통 1·5). 한 프로세스에서 순서를 바꿔 돌려도 같은가(교대 사이에 새는 상태 — 모듈 수준 변수·공유 표를 고치는 코드). 새 난수가 설계서가 정한 흐름만 쓰는가(기존 흐름에 호출을 끼워 넣지 않았는가). 화면만 고친 단계의 앞뒤 해시가 같은가.
3. **정보 격리**: 판단부(\`commander.ts\`, \`brain.ts\` 의 판단부, \`dispatch/*\`, \`orders/*\`, 이 묶음이 만든 판단 파일)가 진실(\`s.props\`·\`s.casualties\`·\`s.hostiles\`·\`I.truth\`·\`s.fire\` 등, 숨은 고장·숨은 상태)을 읽는 곳. 설계서가 "누가 무엇으로 아는가"를 정한 표와 코드가 같은가.
4. **끝나지 않는 사건·반복 고리**: 보통·어려움·극한 각 40교대와 설계서가 정한 강제 실행에서 종료 사유(한계 시간·방치·무대응), 측정 도구(\`npx tsx scripts/sweep.ts 40 --metrics\`)의 교착 후보·잊힌 사건·반복 최대·기록 일치가 ${BASE} 보다 나빠지지 않았는가. 나빠졌으면 \`--log <시드>\` 로 기록을 읽어 원인을 찾아 고친다. 같은 지시가 되풀이되는 새 경로(낡은 믿음, 맡을 사람 없는 작업, 실패 기억이 없는 새 행동)가 있는가.
5. **균형**: 설계서의 균형 기준(보통 60시드와 프리셋 넷, 유형별, 강제 실행별, 교대당 시간)을 직접 다시 재서 기준 파일(\`${SP}/wf-${KEY}/\`)과 견준다. 벗어났으면 설계서가 정한 손잡이 차례대로 맞춘다.
6. **경계와 예외**: 부대 규모 1·5, 장비 1·5, 인근 도시 지원 부대, 재난 교대, 대형 사고, 교대가 끝나는 순간(hardCap), 되감기(같은 Sim 을 새로 만들어 다시 돌리기)에서 예외 0건. \`--diff extreme\` 60교대와 재난 다섯 종류 × 12교대.
7. **다른 묶음과 맞물리는 자리**: \`docs/specs/README.md\` "구현 순서" 표에서 **뒤 묶음들이 이 묶음에 기대하는 이름**(함수·자료형)이 설계서대로 있는가, 뜻이 같은가. 다르면 코드를 설계서에 맞추거나(쉬우면), 실제 이름을 보고에 적는다.
${P.reviewFocus ? '8. **이 묶음에서 특히**: ' + P.reviewFocus + '\n' : ''}
고친 것마다 고치기 전에 실패하고 고친 뒤에 통과하는 확인(테스트나 진단 스크립트)을 남긴다. 테스트는 \`${P.testFile}\` 에 더한다.

${rules}

## 끝내는 조건
\`npx tsc --noEmit\`, \`npx vitest run\` 전체, \`npm run check\` 통과. 마지막 응답은 구조화된 보고다: done 에는 찾아서 고친 것(무엇이 틀렸나 · 어떻게 확인했나 · 고친 파일)과 직접 확인해 문제없던 것(수치와 함께)을, notDone·issues 에는 찾았지만 고치지 않은 것과 그 까닭을 적는다.`

const docsPrompt = (prev, rev) => `너는 묶음 **${P.title}** 의 마지막 작업자다. 구현과 독립 검토는 끝났다(\`${PTR}\`). 네 일은 설계서 \`${P.spec}\` 의 **${P.docsStage}** 다: 화면을 직접 확인하고, 균형을 마지막으로 재고, 문서를 쓴다.

먼저 \`docs/specs/README.md\` 와 \`${P.spec}\` 를 처음부터 끝까지 읽고 \`git diff ${BASE}..${PTR} --stat\` 과 \`git log --oneline ${BASE}..${PTR}\` 를 본다.${P.priorNotes ? '\n' + P.priorNotes : ''}

## 앞 작업자들의 보고
${prevText(prev)}

### 독립 검토
${brief(rev)}

${setup(PTR + '-docs', false)}

## 할 일
1. **화면 확인**(이 묶음이 화면을 고쳤으면): 개발 서버를 띄워 1600×900 에서 설계서의 화면 절이 정한 것들을 Playwright 로 찍어 **직접 보고**(겹침·잘림·읽히지 않는 기호·콘솔 오류/경고 0건), 틀린 것은 고친다. 지도·목록에 글자 표식을 쓰지 않는다는 규칙(그림 기호)을 지킨다. \`npm run ui-check\`(2분쯤) 통과. 화면만 고친 커밋은 결과 해시를 바꾸면 안 된다(시드 20개 전후 비교). 본 그림의 절대 경로를 보고에 적는다.
2. **균형 최종 확인**: 설계서의 균형 기준을 마지막 코드로 다시 잰다 — 보통 60시드, 프리셋 넷(60시드씩), 유형별 성공률, 설계서가 정한 강제 실행, 교대당 시간, 측정 도구 지표(\`npx tsx scripts/sweep.ts 40 --metrics\`). 기준을 벗어나면 설계서가 정한 손잡이 차례로 맞춘다. \`npm run check\`, \`--diff hard --check\`, \`--diff extreme --check\` 통과.
3. **문서**(잰 수치로 — 지어내지 않는다):
   - \`${P.spec}\` 끝에 **"구현 메모"** 절: 설계와 달라진 곳과 까닭, **뒤 묶음이 써야 하는 실제 이름**(\`docs/specs/README.md\` "구현 순서" 표가 뒤 묶음이 이 묶음에 기대한다고 적은 이름마다 — 있다/이름이 다르다/없다), 잰 수치(전 → 후), 알려진 문제와 남은 후보. 뒤 묶음의 작업자는 이 메모를 정본으로 읽는다.
   - \`docs/specs/README.md\`: 상태 표의 이 묶음 줄을 "구현됨"으로, "구현 순서" 표에서 이 묶음에 기대는 이름이 실제와 다르면 고친다.
   - \`CLAUDE.md\`: 설계서가 "CLAUDE.md 에 들어갈 것"으로 적은 줄(명령·구조·확장 표·겪은 함정), 구현하며 실제로 겪은 함정, 테스트 수.
   - \`README.md\`: 기능·화면·난이도 표·알려진 문제·테스트 결과의 수치.
   - \`docs/ROADMAP.md\`: "지금 상태"의 기준 수치, "진행 중"(이 묶음 끝남 · 다음 묶음 이름), "완료한 작업 묶음"에 한 줄(남은 후보 포함).
4. 마지막에 \`npx tsc --noEmit\`, \`npx vitest run\` 전체, \`npm run check\` 를 한 번 더 통과시키고 커밋한다.

${rules}

마지막 응답은 구조화된 보고다. results 에는 문서에 적은 최종 수치와, 직접 본 그림의 절대 경로를 적는다.`

async function run(mk, opts) {
  let r = await agent(mk(false), opts)
  if (!r) {
    log(opts.label + ': 작업자가 멈췄다 — 다른 모델(opus)로 같은 덩어리를 다시 세운다')
    r = await agent(mk(true), { ...opts, label: opts.label + ':retry', model: 'opus' })
  }
  return r
}

const results = []
for (let i = 0; i < P.chunks.length; i++) {
  const c = P.chunks[i]
  const r = await run((retry) => implPrompt(c, i, results.slice(), retry), { label: `impl:${KEY}:${c.id}`, phase: 'Implement', isolation: 'worktree', schema: SCHEMA })
  results.push(r)
  if (!r) { log(`${c.stages}: 두 번 모두 보고 없이 멈췄다 — 여기서 그만두고 사람이 본다`); return { key: KEY, stoppedAt: c.id, chunks: results } }
  log(`${c.stages}: ${r.commit} · 관문 ${r.checkPassed ? '통과' : '통과하지 못함'} · 못 한 것 ${(r.notDone || []).length}`)
}
if (P.only === 'impl') return { key: KEY, chunks: results }
const review = await run((retry) => reviewPrompt(results) + (retry ? '\n\n(두 번째 시도다: 브랜치 이름 끝에 -b 를 붙여 `' + PTR + '` 에서 다시 갈라 시작하고, 앞 시도의 작업 폴더에 남은 변경이 있으면 위 "작업 폴더" 절의 방식으로 살린다.)' : ''), { label: `review:${KEY}`, phase: 'Review', isolation: 'worktree', schema: SCHEMA })
log(`검토: ${review ? review.commit + ' · 관문 ' + (review.checkPassed ? '통과' : '통과하지 못함') : '보고 없음'}`)
if (P.only === 'impl+review') return { key: KEY, chunks: results, review }
const docs = await run((retry) => docsPrompt(results, review) + (retry ? '\n\n(두 번째 시도다: 브랜치 이름 끝에 -b 를 붙여 `' + PTR + '` 에서 다시 갈라 시작한다.)' : ''), { label: `docs:${KEY}`, phase: 'Docs', isolation: 'worktree', schema: SCHEMA })
return { key: KEY, chunks: results, review, docs }