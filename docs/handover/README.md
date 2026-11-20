# 인계 — 2026-11-15 저녁에 멈춘 자리

> **이어받은 뒤 (2026-11-15 밤)**: 다음 세션이 이 문서대로 이어받았다. 주 브랜치는 그때 `claude/practical-keller-xm0ac2` 였다 — **2026-11-20 부터는 다시 `claude/great-ptolemy-s31sxn`**(그 브랜치를 그대로 합쳐 받았다. 받기·합치기·푸시는 `claude/great-ptolemy-s31sxn` 에 한다. 아래와 `reports/` 의 `claude/practical-keller-xm0ac2` 는 그때의 기록이다). **R3 분야별 대응 교본까지 끝났다**(2026-11-20 — 덩어리 보고 `reports/R3-s345.md`·`R3-s67.md`·`R3-review.md`·`R3-s8.md`, 정본은 `docs/specs/R3-doctrine.md` 끝의 "최종 요약"). 다음은 I1-b(`b1·b2` 부터). **H1 4b·4c·5·6 은 끝나 주 브랜치에 합쳐졌다**(4b 는 아래 2절의 패치에서 (가) 방법으로 이어 했고, 패치 파일은 지웠다 — 2절은 끝난 일의 기록으로만 남긴다. 덩어리 보고는 `reports/H1-s4bc.md`·`H1-s56.md`). 준비 줄의 `I1-b b0`·`R3 0`·`I2 1` 도 합쳐졌고, N8·N9 설계도 완성해 합쳤다. 지금 상태는 `docs/ROADMAP.md` "진행 중" 맨 위 줄을 본다.

사용자 지시(2026-11-15 저녁): **"일단 n8 n9 설계 워크플로 최우선으로 완성시키고 나머지 작업은 하던거 그대로 opus 5.5 울트라 코드가 인계 받을 수 있게 멈추고 커밋해"**.
그래서 구현 작업(H1 의 후송 덩어리, R2 의 틀)을 그 자리에서 멈추고, 끝난 것은 주 브랜치에 합치고, 끝나지 않은 것은 이 폴더에 그대로 남겼다. 사건 종류 다양화(N8·N9)의 설계서는 초안까지 써서 넣었다(사용량 한도 때문에 독립 검토 전에서 멈췄다).

**읽는 순서**: `CLAUDE.md` → `docs/ROADMAP.md` "진행 중" → `docs/specs/README.md`("구현 순서"·"실행 방법"·"겹쳐 돌리기") → 이 문서 → 이어받을 묶음의 설계서와 그 끝의 "구현 메모 (진행 중)".
**먼저 할 일**: `npm install` → `npm run check`(4분쯤, 통과해야 한다 — 주 브랜치는 늘 관문 통과 상태다).

## 1. 주 브랜치에 있는 것 (모두 관문 통과, 푸시됨)

| 묶음 | 주 브랜치에 있는 단계 | 남은 단계 |
|---|---|---|
| R1 부대 편성·개인 장비·헬기 | 전부 (구현 메모 = 정본) | — |
| **H1 부상과 사망** | 0(기준) · 1·2(기록만·화면) · 3(구조 대상) · 4a-1·4a-2(대원의 부상 모델·새 방호값) · **4b 의 준비 커밋**(결과 불변 — 처치 식 `injury.treatPlan`·`treatEffect`, 자리 셈 `crews.seatsUsed`, 출발 판단 정리) | **4b(대원 후송) 본작업 — 아래 2절의 작업 중 변경**, 4c → 5·6(용의자·판정) → 독립 검토 → 7(균형·마무리) |
| X6 위험의 현실화 | 1(상태만 — 결과 불변) | 0(기준 — H1 이 다 합쳐진 뒤)·2 → 3·4 → 5 → 6·7 → 8·9 → 검토 → 10·문서 |
| R2 대응 방식 | 0(틀 — 결과 불변) | 1a → 1b·1c·1d → 2·3 → 4·5·6 → 검토 → 문서 |
| R3 교본 · I1-b 인과 규칙 · I2 교대 간 지속 | 없음 (설계서만) | 전부. 준비 줄의 다음 차례였던 것: `I1-b b0` → `R3 0` → `I2 1` |
| N8·N9 사건 종류 다양화 | **설계 완성**(2026-11-15 밤 — 항목별 상세와 독립 검토 반영, `docs/specs/workflows/complete-incident-kinds.js`. 조사 보고서 `docs/specs/N8-research/`) | 구현 전부 (I2 다음). 사용자에게 올린 열린 질문 여덟은 `docs/ROADMAP.md` "N8·N9 의 열린 질문" |

구현 순서는 그대로다: **H1 → X6 → R2 → R3 → I1-b → I2 → N8 → N9**. 결과를 바꾸는 단계는 한 줄로 차례대로, 결과를 바꾸지 않는 앞 단계만 준비 줄로 나란히(`docs/specs/README.md` "겹쳐 돌리기").

## 2. H1 단계 4b — 작업 중이던 변경 (`H1-4b-wip.patch`)

작업자가 단계 4b(대원 후송: 처치·탑승·출발·결원)를 하던 중에 멈췄다. **커밋되지 않은 변경을 그대로** 패치로 남겼다(주 브랜치에는 넣지 않았다 — 관문을 확인하지 않은 반쯤 된 단계다).

- 패치: `docs/handover/H1-4b-wip.patch` — 주 브랜치 `90de7d1`("R2 준비 합치기") 기준, 파일 12개 +415 −66.
  `scripts/metrics.ts` · `dispatch/dispatcher.ts` · `field/agents.ts` · `brain.ts` · `commander.ts` · `executor.ts` · `injury.ts` · `orders/injury.ts` · `sceneManager.ts` · `resources.ts` · `types.ts` · `tests/injuries.test.ts`
- 확인한 것: `90de7d1` 위에 충돌 없이 얹히고 `npx tsc --noEmit` 통과. `npx vitest run tests/injuries.test.ts` 는 **97개 가운데 94 통과 · 3 실패**(4a 의 임시 동작을 지키던 시험 — 4b 가 고쳐야 하는 줄이다):
  1. "대원: Σ(기록) = 100 − 체력 …" (장부)
  2. "상처 악화: … 안전 구역으로 물러난 대원의 출혈은 멈춰 둔다 — 단계 4b 가 푼다"
  3. "mateFact: 숨졌는지는 2칸 안에서만 …"
- 확인하지 않은 것: `npm run check`, 균형(60교대 전후 비교), 4b 의 새 시험, 4c.
- 로컬 브랜치(이 컨테이너에만 있다 — 푸시하지 않았다): `wf/injuries`(= 4b 준비 커밋 `a95a8d1`, 주 브랜치에 합쳐짐), `wf/injuries-wip`(작업 중 변경 + 주 브랜치 받기).

**이어받는 두 가지 방법** (둘 다 괜찮다 — 패치를 읽어 보고 고른다):

```bash
# (가) 이어서: 패치를 얹고 4b 를 마저 한다
git checkout -b wf/injuries-s4bc claude/great-ptolemy-s31sxn   # 워크플로 작업자면 자기 worktree 에서
git apply --3way docs/handover/H1-4b-wip.patch
npx tsc --noEmit && npx vitest run tests/injuries.test.ts      # 94/97 에서 시작
```

```bash
# (나) 다시: 패치를 참고만 하고 주 브랜치에서 4b·4c 덩어리를 처음부터 한다
```

어느 쪽이든 4b 의 할 일은 `docs/specs/H1-injuries.md` 의 "구현 순서" 표 4b 줄과 끝의 "구현 메모 (진행 중)" 가운데 **단계 4a 가 끝난 자리 — 단계 4b 가 이어받을 때**에 있다(물러난 대원의 출혈을 임시로 멈춘 줄 `agentHealth` 의 `a.status !== 'withdrawn'` 풀기, `outstanding().mates` 의 병원 항, 5번 블록의 순직 대원, 경상 근무 `LIGHT_WORK`, 운용 중단은 전원 사망일 때만 — 사용자 결정). 4a 작업자의 보고는 `reports/H1-s4a.md`.

끝나면 이 패치 파일을 지운다(`git rm docs/handover/H1-4b-wip.patch`).

## 3. 워크플로로 이어 돌릴 때 (울트라코드)

대본은 `docs/specs/workflows/package-run.js`, 쓰는 법은 그 폴더의 `README.md`. H1 의 남은 구현 덩어리는 이렇게 넘긴다(값은 그대로 써도 된다 — `base`·`scratch`·`attr` 만 그 세션의 것으로):

```jsonc
{
  "base": "f9965c0",                      // H1 의 기준(R1 최종본). 검토자의 git diff 기준이기도 하다
  "scratch": "<세션 scratchpad>",
  "key": "injuries", "id": "H1",
  "title": "H1 — 부상과 사망 (구조 대상·대원·용의자의 공통 부상 모델)",
  "spec": "docs/specs/H1-injuries.md", "port": 5210, "testFile": "tests/injuries.test.ts",
  "attr": "<커밋 끝줄>",
  "only": "impl", "shared": false,
  "priorReports": [
    { "stages": "단계 1·2", "text": "docs/handover/reports/H1-s12.md 와 설계서 끝 구현 메모" },
    { "stages": "단계 0·3", "text": "docs/handover/reports/H1-s03.md" },
    { "stages": "단계 4a-1·4a-2", "text": "docs/handover/reports/H1-s4a.md" }
  ],
  "priorNotes": "주 브랜치에 R1 전체, H1 단계 0~4a 와 4b 준비, X6 단계 1, R2 단계 0 이 있다. 단계 4b 의 작업 중 변경이 docs/handover/H1-4b-wip.patch 에 있다(docs/handover/README.md 2절). 기준 수치는 f9965c0 을 git archive 로 풀어 다시 잰다(측정 도구는 구현 메모의 설명대로 다시 만든다). 사용자 결정: 용의자 자해는 끈 채(SELF_HARM = 0), 부대는 전원 사망일 때만 운용 중단, 다친 대원은 −18 감점만, 걸을 수 있는 부상자는 가벼운 일만(LIGHT_WORK). README·CLAUDE·ROADMAP·specs README 는 고치지 않는다(주 세션이 고친다).",
  "chunks": [
    { "id": "s4bc", "stages": "단계 4b (대원 — 후송)·단계 4c (대원 — 새 규칙)", "focus": "…",
      "pre": "git merge --no-edit claude/great-ptolemy-s31sxn; git apply --3way docs/handover/H1-4b-wip.patch (쓸 만하면); git branch -f wf/injuries HEAD" },
    { "id": "s56", "stages": "단계 5 (용의자)·단계 6 (판정·보고서)", "focus": "…", "extra": "화면을 고쳤으면 npm run ui-check 와 스크린샷" }
  ]
}
```

구현 덩어리가 끝나면 같은 대본에 `chunks: []` · `priorReports`(덩어리 보고) · `docsStage: "단계 7 (균형·마무리)"` 로 검토 → 문서를 돌린다. 검토자에게는 "`git diff f9965c0..wf/injuries` 에 다른 묶음의 준비 커밋(X6 단계 1 — `catastrophe.ts`·`ops.ts`·`rules/catastrophe.ts`·`scripts/catstats.ts`·`tests/catastrophe.test.ts`, R2 단계 0 — `gear.ts`·`methods.ts`·`methodRun.ts`·`methodReport.ts`·`rules/methods.ts`·`orders/methods.ts`·`ui/MethodRows.tsx`·`scripts/methodstats.ts`·`tests/methods.test.ts`)이 섞여 있다 — 검토 대상이 아니다"를 `reviewFocus` 에 넣는다.

X6 부터의 덩어리는 `docs/specs/README.md` 의 "묶음별 덩어리" 표 그대로다. 묶음마다 첫 덩어리의 `pre` 에 주 브랜치 받기를 넣고, 0단계(기준)를 앞 묶음이 다 합쳐진 자리에서 잰다.

## 4. 이 세션이 남긴 보고와 도구

- `reports/H1-s12.md` · `H1-s03.md` · `H1-s4a.md` · `X6-s1.md`: 덩어리 작업자의 구조화된 보고(끝낸 것·못 한 것·설계와 다른 곳·수치·알려진 문제). 요지는 각 설계서 끝의 "구현 메모 (진행 중)"에도 있다 — **구현 메모가 정본**이다. R2 단계 0 은 작업자가 메모를 쓰던 중에 멈춰 보고가 없다(`docs/specs/R2-methods.md` 끝의 메모가 전부이고, 해시 불변과 관문은 주 세션이 다시 확인했다: 기록·상태·현장·난수 해시 목록 네 가지가 기준과 같고 `sweep 60 --json` 은 시간과 새 `methods` 칸만 다르다).
- 보고에 나오는 `/tmp/claude-0/…/scratchpad/wf-*/` 의 측정 도구·기준 수치는 **세션 폴더라 새 컨테이너에는 없다**. 기준은 그 묶음의 시작 커밋을 `git archive` 로 풀어 다시 잰다(방법은 구현 메모마다 적혀 있다).
- 이 세션이 예약해 둔 중간 확인(스케줄)은 이 세션 안에서만 뜬다. 새 세션과 무관하다.

## 5. 사용자가 정한 것 (바꾸지 않는다)

`docs/ROADMAP.md` "진행 중"에 전문이 있다: 2026-11-15 의 결정(자해 끔 · 폭약 진입은 R2 · 닫힌 문 그림 · 빗나간 탄 = 깨진 유리 · 결원 규칙)과 사건 종류 다양화의 결정 열네 가지, 그리고 2026-11-20 저녁의 결정 넷(장비 1 의 예비 펌프 1 · 화재 균형은 N9 뒤에 · 인과는 스크립트가 아니라 세계 상태에서 자연스럽게 · R3 뒤 손질 R3b 를 I2 앞에).
