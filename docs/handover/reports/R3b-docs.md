# R3b 문서 단계 (화면 확인 · 균형 최종 확인 · 최종 요약과 문서) — 작업자의 보고

워크플로 `docs/specs/workflows/package-run.js` 의 작업자(`docs:r3b`) 보고를 그대로 옮겼다. 끝 커밋 `f2f725a9d752247f635e238dd7e36d24ed1a6045`(브랜치 `wf/r3b-docs (wf/r3b points to the same commit)`), 관문 통과(`checkPassed: true`).

정본은 그 묶음 설계서 끝의 "구현 메모"다. 보고 속의 scratchpad 경로(`/tmp/…/scratchpad/wf-*/`)는 그 세션의 컨테이너에만 있다 — 기준 수치는 구현 메모의 방법으로 다시 잰다.


## 끝낸 것

- Stage 5, setup: created wf/r3b-docs from wf/r3b (e9864d8) and linked node_modules. tsc passed. Confirmed src is byte-identical to 25cc1a1 (the s34 snapshot snap3/d12d), so the docs stage measures the final code.
- Stage 5, screen check (port 5221, 1600x900, Playwright). This package changed no src/view or src/ui files, so I looked at the scenes whose behaviour changed. Normal S35 incident 11: officers hiding under P30 (with a zoomed shot and the agent info card), the charge being planted, the team pulled back, and the blast with door debris. Forced siege S17 incident 01: the S30 opening line. 0 console errors in every scene. Also ran npm run ui-check: all 8 checks passed in 146 s (15x ratio 15.01, 59 rewind samples match headless, end-of-shift report hash 604085fc matches headless).
- Stage 5, final balance on the final code (scratchpad fin/): normal 60 with --scen --methods --doctrine plus --json, easy, hard and extreme 60, metrics 40 at normal, hard and extreme, the nine forced armed scenarios x20, minimum crew 20, and five disasters x20. Normal, hard, extreme, the forced runs and minimum crew are identical to s34's m6-d12d output, excluding the ms lines. I also ran the stage-0 start copy for the sets earlier stages did not measure (easy 60, metrics hard/extreme 40, disasters x5, normal --doctrine) in fin0/. Timing: sweep 20 --no-metrics alternated three times across base97, start and final. load.mts on the final code. hurtby breakdown for normal 60. Every §6 range holds, so no knob was turned.
- Stage 5, gates: sweep 40 --diff hard --check passed, sweep 40 --diff extreme --check passed, npx vitest run passed (1032 + 1 skipped, 20 files, 699 s), npm run check passed (11 min 48 s, '검증 통과'), npx tsc --noEmit passed.
- Stage 5, docs: appended the implementation memo '최종 요약' to docs/specs/R3b-followup.md. It covers what went in; the real names later packages must use (as a table); the big design deviations; start-to-final numbers for the four presets, disasters, per-type success, doctrine, metrics, the forced four x120 and timing on three roots; the completion-condition table; how R3 known problems 3, 4 and 5 were closed; the screen check; the gates; and known problems. Also updated the spec header status and the '구현 메모' heading.
- Stage 5, docs: docs/specs/README.md. Status row set to '구현됨'. Added an R3b row (6b) to the implementation-order table. Marked the chunk table as done. Added a 'R3b 가 끝난 뒤의 확인' paragraph and updated two rows of the canonical-names table.
- Stage 5, docs: CLAUDE.md. Test counts (1032; doctrine 120, methods 156) and check time. Structure: added a src/sim/shape.ts line, plus breachDoorOf, lazyInView and the DOC S30 constants on the doctrine.ts line. Extension table: doctrine tests 5 and 8, and DocActId reuse of an existing TaskKind. Pitfalls: extended four (two move targets in one task, from hard S5 #07; numeric fields primed as doubles via shape.ts; the S30 and D2 routes to a breach and the narrowings that came from measurement; the tick-cache measurement) and added two (idle police staying in a gunman's line of sight, with P30, inView and the '*' memory; proving speed changes with the hash list and measuring them with sweep, not vitest).
- Stage 5, docs: README.md (preset table, test command row, structure, features, known issues, test results), docs/ROADMAP.md (R3b baseline bullet, R3b marked done under 진행 중 with I2 next, a completed-package line with remaining candidates, handoff order) and docs/handover/README.md (overview rows, the R3b rows in sections 1 and 4, gate time).

## 하지 못한 것

- No code changes. This is the docs stage and src/scripts/tests are untouched (git diff e9864d8..HEAD covers only the 6 doc files).
- Did not get the '파괴 담당 대기' or '잠긴 문 개방' head labels into a screenshot. The S30 task is short; in forced siege S17 only the opening log line showed. The memo says so instead of claiming the labels were seen.
- Did not fix a screen overlap I noticed: the region label ('수색 72%') and executor text like '경로 차단!' overlap the label of an agent standing on that tile. It predates R3b (mergeLabels only avoids agent name labels and suspect pills) and this package did not touch view code. It is listed in known problems.
- Did not write a per-chunk report under docs/handover/reports/; per the instructions the main session writes those.

## 설계서와 다르게 한 곳

- The specs README '구현 순서' table has no names that later packages expect from R3b: R3b was inserted after the table was written, and the I2/N8/N9 rows list R3's names. So the 'real names' table in the memo lists, for each R3 name later packages rely on (all still present), what R3b added or changed around it: DocCtx.breachDoor/inView, DocActId 'force', 94 rules, BARRICADE.solo, shape.ts site lists, BeliefStore internals. I added an R3b row labelled '6b' to the order table so the later rows keep their numbers.
- Timing rows in the docs use this stage's alternating run (base97, start and final, three times each) rather than s01's two-root run. The ratios agree: final/start x0.86 per shift, x0.73 user CPU, x0.88 wall.
- Doc wording: README's '대응 방법의 한계' said R3 had no buddy rule or ammo ('총은 무제한이다'). That was stale since R3 and I removed it while rewriting the blast-entry sentence. README's `npm test` row (890 tests, 19 files, already stale) is now 1,032 tests in 20 files.
- The spec header's '구현 상태' line now says done and points at the final summary as canonical, following the pattern of the R3 and I1-b specs.

## 설계서 밖의 공용 파일을 고친 곳

- docs/handover/README.md: overview table rows (current package, finished chunks, next task, after that, tests), the R3b rows in sections 1 and 4, and the gate-time bullet in section 6. The task allows the docs-stage worker to edit docs/handover/; reports/ was not touched.

## 결과

FINAL NUMBERS (start 0e92736 = b421f2e sim -> final 25cc1a1 src; 60 shifts each, disasters 20):
- Easy: incidents 699->701, success 83.5->84.2%, success+delayed 87.1->87.9%, timeout/abandoned/no-response/shift-end 1/2/0/0 -> 1/2/0/0, injured responders per shift 0.15->0.083, armed 74/93 -> 78/94.
- Normal: 881->881, success 72.1->72.2%, success+delayed 77.6->77.8%, failed+unresolved 10.9->10.6%, closes 1/2/0/1 -> 1/2/0/0, injured 0.333->0.333 (armed 11->10, traffic 6, fire 3->4), armed 91/132 (68.9%) -> 94/132 (71.2%), per-type unchanged except traffic 143->141.
- Hard: 1116->1117, success 52.3->52.5%, success+delayed 63.6->63.0%, closes 8/15/1/1 -> 7/14/2/1, injured 0.650->0.633, armed 102/203 -> 102/202.
- Extreme: 1355->1352, success 27.9->27.1%, success+delayed 40.7->39.9%, closes 36/26/17/7 -> 40/26/15/14, injured 1.617->1.600.
- Disasters, success+delayed: typhoon 74.0->73.4, flood 65.2->65.2, quake 42.2->42.0, wildfire 64.3->64.3, tsunami 73.5->73.4.
- Doctrine (normal 60): 92->94 rules registered, 68->71 used, split 0.485->0.461. P30 used 57 (normal), 106 (hard), 110 (extreme). S30 used 0 (normal), 3 (hard), 5 (extreme), 2 (forced siege x20).
- Metrics (normal 40): stall candidates 0->0, forgotten 0->0, repeat max 6->5, C1-C5 0. Hard 40 stall candidates 1->0 (S5 #07 fixed). Extreme 40: 1->1 (S35 #15, carried over from an earlier package).
- (가) Forced four x120, injured responders in that scenario, baseline 97869b1 -> start -> final: siege 38->46->24, hostage 13->19->10, shooter 19->21->19, robbery 33->52->33, total 103->138->86 (target <=118 met). Scenario successes 359->390. Timeout+abandoned 2->2. Hostages/victims dead in hostage+siege 8->6.
- (나) Timing, sweep 20 --no-metrics, three roots alternated three times. Per-shift ms: base 551, start 983, final 846. User CPU: 29.0, 45.6, 33.3 s. Wall: 12.0, 20.4, 17.9 s. Final/start x0.86 / x0.73 / x0.88. Final/base x1.54 / x1.15 / x1.49. Active agent-ticks: 1,177,244 / 1,588,596 / 1,588,814. R3's <=1.15x target (per shift) is closed, not met.
- (다) Actual breach entries: normal S35 incident 11 and forced robbery S55 incident 01. That is 1 per 120 normal shifts, 1 per 120 forced-robbery shifts, and 0 on the forced four x S0-S19 (target >=2 not met). 0 breaches of rooms with held hostages on the forced hostage/siege S0-S39 runs.
- Gates: npx tsc --noEmit pass. npx vitest run 1032 passed + 1 skipped, 20 files, 699 s (doctrine 120, methods 156). npm run check pass (11 min 48 s; normal 40: 590 incidents, timeout 1, abandoned 1, stall 0, forgotten 0, C1-C5 0). sweep 40 --diff hard --check pass (737 incidents, timeout 5, abandoned 7, stall 0). sweep 40 --diff extreme --check pass (903 incidents, stall 1 = S35 #15 at 406 s, carried over). npm run ui-check: 8/8 passed in 146 s.

SCREENSHOTS I LOOKED AT (absolute paths):
/tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-r3b/fin/shots/s35-p30-0.png
/tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-r3b/fin/shots/s35-p30-zoom-0.png
/tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-r3b/fin/shots/s35-p30-card-0.png
/tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-r3b/fin/shots/s35-p30-card2-0.png
/tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-r3b/fin/shots/s35-plant-0.png
/tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-r3b/fin/shots/s35-back-0.png
/tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-r3b/fin/shots/s35-boom-0.png
/tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-r3b/fin/shots/s35-boom-0p15.png
/tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-r3b/fin/shots/s35-boom-0p6.png
/tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-r3b/fin/shots/siege17-s30-0.png
/tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-r3b/fin/shots/siege17-s30b-0.png
UI check output: /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-r3b/fin/uicheck.txt (screenshots in .../fin/uicheck/). Measurement files: /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-r3b/fin/ (final) and /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-r3b/fin0/ (start).

## 알려진 문제 · 다음 작업자가 알아야 할 것

- Unmet targets, recorded in the final summary: normal-60 injured responders per shift <=0.200 (stays 0.333, because half the injuries are on traffic and fire scenes); forced four x20 breach successes >=2 (0, because hostage rooms correctly yield 0 under user decisions and hostage-free barricades are rare); R3's <=1.15x per-shift time (closed — agent-ticks are x1.35).
- From the review, needs a user decision: one breach of a room with a held hostage, under minimum crew + forced siege V5 #0 (bank vault door; the hostage-taker was believed to be 4.12 tiles away, just outside S26's 4-tile limit). Preventing it means widening S26.
- Robbery escapes rose slightly (z about 1.5). In some cases P30 hides every officer near an exit. This is a balance knob, left for the post-N9 rebalance.
- Extreme 60 on S seeds shows timeouts +4 and shift-ends +7 (start to final). On V seeds (review) both went down, so I treat it as spill-over noise in extreme, but the next package's baseline should be re-measured after merging R3b.
- Slow tests: under heavy load tests/crews.test.ts ⑨ has exceeded its 120 s limit once, and tests/sim.test.ts '다수 사상자 사고가 나오고…' takes about 128 s alone (a synchronous test, so it still reports pass). The limits were not changed.
- Pre-existing screen overlap: region labels and executor text sit under agent labels on the same tile (not caused by R3b).
- For the main session: merge wf/r3b (f2f725a) into claude/practical-keller-xm0ac2, then run npm run check and npm run ui-check and push. I2's stage 0 baseline must be re-measured after the merge.
