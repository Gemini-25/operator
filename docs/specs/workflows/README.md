# 워크플로 대본 — 다른 세션·다른 모델이 그대로 이어 쓰기

이 폴더의 `.js` 는 Claude Code 의 **Workflow 도구**(울트라코드)에 넘기는 대본이다. 2026-11-15 세션에서 실제로 쓴 것을 그대로 옮겨 두었다(커밋 끝줄만 `args.attr` 로 바꿨다). 저장소의 코드가 아니므로 `tsc`·테스트·빌드에 들지 않는다.

이어받는 순서: `CLAUDE.md` → `docs/ROADMAP.md` "진행 중" → `docs/specs/README.md` "실행 방법"·"겹쳐 돌리기" → 이 문서.

| 파일 | 하는 일 |
|---|---|
| `package-run.js` | 설계서 하나(묶음)를 **단계 덩어리**로 나눠 작업자를 차례로 세우고(작업자마다 자기 git worktree), 독립 검토자, 문서 단계 작업자를 세운다. R1·H1 과 준비 단계(X6 1 · R2 0)를 이것으로 돌렸다 |
| `fields-parallel.js` | 한 묶음 안에서 **서로 다른 분야의 단계 셋을 같은 시작점에서 나란히** 구현하고(작업자마다 자기 worktree·브랜치), 합치는 작업자가 셋을 합쳐 맞물림을 고치고 전체 균형을 다시 잰다. R3 의 3(소방)·4(의료)·5(특수)를 이것으로 돌렸다(2026-11-16, 사용자 요청). 인자는 `{ base, scratch, attr }` — 분야와 지시문은 대본 안에 있다. 다른 묶음에 쓰려면 FIELDS·COMMON 을 고친다 |
| `design-incident-kinds.js` | 설계서를 쓰는 워크플로의 본보기: 조사 다섯 → 설계안 둘 → 초안 → 독립 검토 두 갈래 → 반영. N8·N9(사건 종류 다양화) 설계서를 이것으로 썼다. 다른 설계서를 쓸 때 주제·결정 사항만 바꿔 쓴다 |
| `complete-incident-kinds.js` | `design-incident-kinds.js` 가 조사 셋에서 멈춘 뒤의 뒷부분: 주 세션이 쓴 초안 둘(N8·N9)을 입력으로 남은 조사 둘 → N8 항목별 상세 → (N8 검토 ‖ N9 상세) → (N8 반영 ‖ N9 검토) → N9 반영. `args` 는 `design-incident-kinds.js` 와 같다 |

## 돌리는 법

Workflow 도구에 `scriptPath`(이 폴더의 파일 경로)와 `args` 를 넘긴다. 대본은 세션 밖에서도 읽을 수 있게 평범한 JavaScript 다(`agent()`·`parallel()`·`phase()`·`log()` 는 Workflow 도구가 준다).

### `package-run.js` 의 `args`

```jsonc
{
  "base": "<묶음을 시작하는 주 브랜치 커밋>",        // git diff <base>..wf/<key> 의 기준, 가리킴 브랜치가 없을 때 가르는 자리
  "scratch": "<세션의 scratchpad 절대 경로>",         // 기준 수치·보고·그림은 <scratch>/wf-<key>/ 에 (저장소 밖)
  "key": "catastrophe",                              // 가리킴 브랜치 wf/<key>, 작업 브랜치 wf/<key>-<덩어리 id>
  "id": "X6",                                        // 커밋 메시지 머리 ("X6 단계 3: …")
  "title": "X6 — 위험의 현실화: 붕괴 · 폭발 · 전소",
  "spec": "docs/specs/X6-catastrophe.md",
  "port": 5216,                                      // 개발 서버 포트 (docs/specs/README.md 의 덩어리 표)
  "testFile": "tests/catastrophe.test.ts",
  "attr": "Co-Authored-By: …\nClaude-Session: …",    // 커밋 끝에 붙일 줄 (세션의 지시대로)
  "docsStage": "단계 10 (화면 확인)과 문서",           // 문서 단계 작업자가 맡는 설계서의 단계
  "only": "impl",                                    // "impl" = 구현 덩어리만 / "impl+review" / 없으면 구현 → 검토 → 문서
  "shared": true,                                    // 다른 묶음의 작업자가 같은 기계에서 함께 돌 때 (시간 초과·측정 흔들림 안내가 바뀐다)
  "priorNotes": "…",                                 // 모든 작업자에게 주는 지금 상황 (앞 묶음의 상태, 사용자 결정, 고치지 말 문서 …)
  "reviewFocus": "…",                                // 검토자에게 '이 묶음에서 특히' 볼 것
  "priorReports": [{ "stages": "단계 1 (상태만)", "text": "<앞서 따로 돌린 덩어리의 보고 요약이나 보고 파일 경로>" }],
  "chunks": [
    { "id": "s02", "stages": "단계 0 (기준)·단계 2 (조짐)", "focus": "…",
      "pre": "git merge --no-edit <주 브랜치>; git branch -f wf/catastrophe HEAD; npx tsc --noEmit",   // 브랜치를 만든 바로 다음에 할 일 (선택)
      "extra": "…" }                                                                                   // 끝내는 조건에 덧붙일 것 (선택)
  ]
}
```

- `chunks: []` 에 `priorReports` 만 주면 **검토 → 문서**만 돈다(구현 덩어리를 따로 돌린 뒤).
- 덩어리는 `docs/specs/README.md` 의 "묶음별 덩어리" 표 그대로 묶는다. 덩어리 하나에 40~100분 걸린다.
- 작업자가 보고 없이 끝나면(모델 한도 등) 같은 덩어리를 다른 모델로 한 번 더 세운다(브랜치 끝에 `-b`).

### 주 세션이 하는 일 (대본 밖 — 사람이든 모델이든 같다)

1. 덩어리가 관문 통과(`checkPassed`)로 끝날 때마다 그 커밋을 주 브랜치에 `git merge --no-ff` → `npm run check` → `docs/ROADMAP.md` "지금" 줄·`docs/specs/README.md` 상태 표·`CLAUDE.md` 의 테스트 수를 고쳐 푸시한다(컨테이너가 사라져도 그 단계부터 이어받게). 진행은 워크플로의 `journal.jsonl`(끝난 작업자마다 `result` 한 줄)에서 본다.
2. 구현 덩어리의 `pre` 에 주 브랜치 받기(`git merge --no-edit <주 브랜치>`)를 넣어, 주 세션이 고친 문서와 준비 줄의 변경이 묶음 브랜치로 흘러들게 한다.
3. **준비 줄**: 뒤 묶음의 결과를 바꾸지 않는 앞 단계를 `only: "impl"`·`shared: true`·덩어리 하나로 주 줄과 나란히 돌리고, 끝나면 주 브랜치에 합친다(`docs/specs/README.md` "겹쳐 돌리기").
4. 묶음이 끝나면(검토·문서까지) 합치고 `npm run check` + (화면을 고쳤으면) `npm run ui-check` 뒤 푸시, 작업 폴더와 `wf/<key>-*` 브랜치를 지운다.

### `design-incident-kinds.js` 의 `args`

```jsonc
{ "base": "<주 브랜치 커밋>", "scratch": "<scratchpad 절대 경로>", "attr": "<커밋 끝줄>" }
```

설계서는 작업 브랜치 `wf/kinds-spec`(가리킴 브랜치)에 커밋된다. 끝나면 주 세션이 주 브랜치에 합치고, 반영자가 돌려준 줄(문서 표·구현 순서 표·덩어리 표·정본 표·로드맵 항목)을 `docs/specs/README.md`·`docs/ROADMAP.md` 에 넣는다. 조사·설계안·검토 지적은 `<scratch>/wf-kinds/` 에 남는다(세션 폴더라 새 컨테이너에는 없다 — 설계서의 "검토 메모"와 "지금 상태" 절에 요지가 들어 있다).

## 실제로 띄운 인자 (`args/`)

`args/<묶음>.json` 은 그 묶음을 `package-run.js` 로 띄울 때 넘긴 `args` 그대로다. 워크플로가 중간에 멈췄을 때 **같은 대본 + 같은 인자 + `resumeFromRunId`** 로 띄우면 끝난 작업자의 결과를 다시 쓰고 멈춘 자리부터 잇는다(인자가 한 글자라도 다르면 처음부터 다시 돈다). 새 컨테이너에서는 실행 기록이 없으므로 `resumeFromRunId` 없이, 이미 주 브랜치에 합쳐진 덩어리를 `chunks` 에서 빼고 그 보고(`docs/handover/reports/<묶음>-<덩어리>.md`)를 `priorReports` 로 옮겨 띄운다. `scratch` 는 그 세션의 scratchpad 경로로 바꾼다.

| 파일 | 묶음 | 띄운 날 · 시작점 |
|---|---|---|
| `args/I1-b.json` | I1-b 인과 규칙과 세계 상태 결합 (`wf/causality`) — **첫 덩어리 `b12` 뒤에서 멈췄다**(사용자가 방향을 바꿨다: 스크립트가 아니라 자연스럽게 생기는 인과. `b3a` 뒤의 덩어리는 쓰지 않는다) | 2026-11-20 · `4aea467` (R3 를 다 합친 자리) |
| `args/I1-b-r123.json` | I1-b 의 규칙 셋 C6·C3·C2 만(`only: impl`, 덩어리 `r123`) — `b12` 의 보고를 `priorReports` 로 옮겼다 | 2026-11-20 · 같은 `base`, 가리킴 `wf/causality` = `a37c805` 에서 |
