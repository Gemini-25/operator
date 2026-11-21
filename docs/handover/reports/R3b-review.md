# R3b 독립 검토 — 작업자의 보고

워크플로 `docs/specs/workflows/package-run.js` 의 작업자(`review:r3b`) 보고를 그대로 옮겼다. 끝 커밋 `e9864d8`(브랜치 `wf/r3b-review`), 관문 통과(`checkPassed: true`).

정본은 그 묶음 설계서 끝의 "구현 메모"다. 보고 속의 scratchpad 경로(`/tmp/…/scratchpad/wf-*/`)는 그 세션의 컨테이너에만 있다 — 기준 수치는 구현 메모의 방법으로 다시 잰다.


## 끝낸 것

- Overall: I found no correctness bugs and changed no code. The only commit is e9864d8, a review memo appended to the end of docs/specs/R3b-followup.md ('### 독립 검토 — 2026-11-21'). wf/r3b now points at e9864d8. Scripts and results are in /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-r3b/review/.
- (나) Results unchanged by stage 1, checked myself. I unpacked b421f2e and a7d7200 (end of stage 1) with git archive and ran the 131-shift hash list on each. b421f2e matches the stage-0 out0/hash.txt (diff 0), and a7d7200 matches b421f2e (diff 0), so N1 and N7 change nothing. The current code differs on 48 lines, which is expected from stages 2 and 3. Timing (sweep 8 --no-metrics, alternating 3 times, load 3-5): user CPU 32.3 to 23.5 s (x0.73), wall 13.0 to 10.9 s (x0.84). This matches the memo's x0.72 / x0.82. N6 was not added, so there is no pre condition to audit.
- Reproducibility: in one process, running the 131 shifts in reverse order and in shuffled order gives the same 131 lines as forward order. repro.mts covers 21 jobs (traffic 1/5, equipment 1/5, crew 1/5, forced robbery/shooter/siege on S33, S55, Q45), run forward and then reversed with other jobs interleaved: 0 differences. D2 draws only from the barricade:<incident> stream (a test checks the parent stream), and P30 and S30 make no random calls. shape.ts keeps a module-level counter site.n, but it never changes values.
- Information isolation (read through, and doctrine test 1's text scan covers it): breachDoorOf reads only beliefs (blk, hos), geometry (tiles, region, exits), teammates' visible tasks and its own docMem. lazyInView uses losWalls against the believed threat position. The P30 and S30 rules read only DocCtx. breacherOn, the lockedRoomDoor change, the toCoverSpot fix and S30's forced 'already open' report are in the executor, and barricadeSolo is a world rule; both are allowed to read truth.
- Loops and stuck tasks (loops.mts, fresh V seeds the implementers never ran). Forced siege V0-39: S30 started 4 times, at most once per responder, longest S30 task 16.2 s. P30 started 97 times, at most twice per responder, never restarted within 20 s. The 'waiting for breacher' state lasted at most 3.6 s. Forced hostage: P30 98, no S30. Hard V0-39: P30 107, one S30 (15.2 s). Extreme V0-29: P30 60. Forced robbery V0-39: P30 118, longest wait 8.0 s, which equals BREACHER_WAIT. Engagement time (suspect-seconds, forced four x V0-19) went 4508 to 4277: hiding idle officers did not lengthen gunfights.
- Unfinished incidents and balance, start to now, all on V seeds. Normal 40: success 433 to 439, armed 87/109 to 91/108, injured responders 16 to 9, timeout/abandoned/shift-end 1/2/0 to 1/1/1, stall candidates 0 to 0, repeat max 5 to 5, consistency checks C1-C5 all 0. Hard 40: success 391 to 397, timeout/abandoned/shift-end 4/9/2 to 5/9/4, stall 1 to 1 (the same V17 #15). Extreme 60: success 385 to 388, injured 117 to 95, timeouts 39 to 36, stall 2 to 0. Forced scenario successes: siege 21 to 23 (scenario deaths 5 to 3), hostage 36 to 45 (deaths 0 to 0), shooter 33 to 36, robbery V0-119 88 to 89. Minimum crew: robbery V0-59 45 to 48, siege V0-59 26 to 29. Every set had 0 exceptions, 0 incidents left open, 0 forgotten incidents, C1-C5 = 0.
- Edge cases: five disaster types x V0-11, crew sizes 1 and 5, equipment 1 and 5, extreme 60 (which includes neighbouring-city aid units and shift ends), and reverse-order reruns all ran with 0 exceptions and 0 open incidents. npx tsc --noEmit passes.
- Hard S5 #07 deadlock fix confirmed: the start code still times out with a 149 s stall; the current code has no timeout and no stall candidate in that shift.
- Every stall candidate in the current code also exists in the start code: hard V17 #15 (a comms outage stops the commander's orders reaching the SWAT team after the entry decision; this is I1-b's), forced robbery/shooter V29 #03 (overhaul), tsunami V5 #17. Minimum-crew robbery V4 #13 (riot, an overhaul task left open) appears only in the current code, but it is the same kind of overhaul stall and has nothing to do with the armed rules.
- Two borderline results from the memo did not reproduce on V seeds: the extreme success drop of 14 (V seeds show +3), and one hostage death in forced hostage (V seeds show 0 to 0). Minimum crew siege looked like 0 to 3 deaths on V0-19, but over V0-59 it is 7 to 9, which is noise.
- Spec check: stage 0-4 completion conditions are met as reported. Tests T1, T2, the A3 tests, D1, D2, D4 and the forced robbery/shooter x6 test are present. T3-T6 are missing only because N4, N6 and N8 were not adopted, which the report says. Changes to existing tests (registration order list, act list, the P11 scene now using a 'hold' belief, the S30 count in test 4) are follow-on changes or stricter checks; no expected value was bent to fit a seed. Names later packages rely on (I2, N8, N9 in the specs README) are untouched; DocCtx gained two required fields and tsc passes. All the honest-reporting items hold: the '목표' and '최소' outcomes are stated separately and match my re-measurement.
- The 'traffic · gunshot 1' entry noted in stage 2: in S7 the tactical lead was wounded in incident 01 (armed) and later went out on light duty to train incident #9, where H1 re-records '부상 — 체력 저하' with the original cause. He was not shot at the train incident. This is how H1 records injuries and is unrelated to R3b.
- Gate: npm run check passed on b8c29d2 with no code changed (20 test files, 1032 passed + 1 skipped, sweep 40 --check '검증 통과', 13 min 28 s at load average 7-16).

## 하지 못한 것

- No fixes: I found no correctness bug to fix, so there are no new tests or fix commits.
- I did not rerun npm run ui-check or sweep 40 --diff hard/extreme --check. The implementers ran them on 25cc1a1, whose src is byte-identical to the current code (I diffed the snapshot against the worktree), and this review changed no code.
- I did not add a guard that stops P30 hiding an officer who is covering an exit, even though the robbery flee count rose slightly (see issues). The increase is not significant (z about 1.5) and success did not drop; this is a balance knob for the docs stage or a later package.
- I did not tighten S26 to stop the blast in a hostage room seen in minimum-crew siege V5 (see issues). Under the user decisions that blast is allowed, and changing it needs a user decision.

## 설계서와 다르게 한 곳

- The spec's timing method is sweep 20 alternated three times. I used sweep 8 --no-metrics alternated three times, because other workers had the machine at load 3-16; the ratio matches the implementers' figure.
- For independence I measured on V-prefix seeds that none of the implementers used. They measured on S and Q seeds. My runs are V0-39 normal and hard, V0-59 extreme, forced four V0-39 (robbery up to V119), minimum crew V0-59.
- The spec's file names and line positions match the current code: function names resolved, tsc passes.

## 설계서 밖의 공용 파일을 고친 곳

- docs/specs/R3b-followup.md: the review memo appended at the end ('### 독립 검토 — 2026-11-21'). This is the bundle's own spec; I did not touch README.md, CLAUDE.md, ROADMAP or docs/specs/README.md.

## 결과

Hash lists (131 shifts): b421f2e copy matches out0/hash.txt (diff 0); a7d7200 (end of stage 1) matches b421f2e (diff 0); the current code differs on 48 lines (stages 2-3); current code run in reverse and shuffled order in one process is identical to forward order; repro.mts 21 jobs: 0 differences. Timing, sweep 8 --no-metrics alternated 3 times: b42 user 30.7/32.1/34.2 s, real 12.4/12.8/13.9 s; a7d user 23.4/24.5/22.7 s, real 11.4/11.2/10.0 s, giving user x0.73 and wall x0.84.

V seeds, b42 then current. Columns: incidents, success, injured responders, timeout/abandoned/shift-end, stall candidates, repeat max, C1-C5.
- Normal V0-39: 599, 433, 16, 1/2/0, 0, 5, 0 then 598, 439, 9, 1/1/1, 0, 5, 0. Armed success 87/109 then 91/108.
- Hard V0-39: 750, 391, 46, 4/9/2, 1, 7 then 750, 397, 45, 5/9/4, 1 (the same V17 #15 in both), 7.
- Extreme V0-59: 1360, 385, 117, 39/19/7, 2, 14 then 1364, 388, 95, 36/19/6, 0, 9. Armed 99/288 then 105/294.

Forced scenario incidents only. Columns: incidents, success, injured, deaths.
- siege V0-39: 42, 21, 9, 5 (hostages shot by police misses 38) then 42, 23, 8, 3 (34).
- hostage V0-39: 53, 36, 19, 0 then 53, 45, 8, 0.
- shooter V0-39: 45, 33, 6, 0 then 45, 36, 2, 1.
- robbery V0-119: 168, 88, 36, suspects fled 60 then 174, 89, 29, fled 75.
- Minimum crew robbery V0-59: success 45/92 then 48/99, unresolved 18 then 27, fled 41 then 52, timeouts 22 then 15.
- Minimum crew siege V0-59: success 26/64 then 29/64, deaths 7 then 9, hostages shot by police misses 64 then 69.
- Disasters x12, crew 1/5, equipment 1/5 x10: 0 exceptions and 0 open incidents for both.

Blasts in the current code: extreme V18 #13 robbery, hard V11 #4 robbery, forced robbery V10 #0 (all hostage-free rooms) and minimum-crew siege V5 #0 (hostage room, nobody hurt by the blast). Forced hostage and siege at normal difficulty, V0-39: 0 hostage-room blasts.

Loops: max one S30 per responder, longest S30 16.2 s, max two P30 per responder, 0 P30 restarts within 20 s, 'waiting for breacher' at most 8.0 s. Engagement suspect-seconds (forced four x V0-19): 4508 then 4277.

Gate: npx tsc --noEmit passed; npm run check passed (20 files, 1032 passed + 1 skipped, sweep 40 --check '검증 통과', 13 min 28 s).

## 알려진 문제 · 다음 작업자가 알아야 할 것

- A blast in a room with a held hostage can happen. It did once: minimum crew (3,3,3,3,3,1) + forced armed/siege V5 #0, the bank vault door at (17,8). The breacher believed the hostage-taker was at (21,7), 7 s old and 4.12 tiles from the door, just outside S26's 4 tiles. He did not know where the hostages were, so R2 condition ① did not apply either. Under the user decisions this blast is allowed. Nobody was hurt by the blast and no ESCALATION was raised, but the team had no flashbangs left and hostage A was shot by panicShot on entry (not killed). The spec's §0.3 ⑤ assumption (every hostage room is about 6x2, so the holder is always within 4 tiles of the door) does not hold for a bank vault. Minimum ② as specified (normal forced hostage/siege 40 each) still holds on both S and V seeds. Blocking this needs a user decision to widen S26, for example '×0 whenever the believed hostage-taker is in the room behind that door, whatever the distance'.
- Robbery suspects flee a little more since P30. SUSPECT_FLED: normal forced robbery V0-119 60 to 75, implementers' S/Q 120 shifts 80 to 83, minimum crew V0-59 41 to 52; combined z is about 1.47, below 2. Example (normal V0 #0): two officers who hit the robber at 0-2 tiles while searching both hid via P30, the robber could no longer see any officer, and he left by an uncovered exit. On the start code one of them took the negotiation and the other kept standing there, so the robber stayed. Success counts did not fall (88 to 89, 45 to 48). If wanted, a P30 condition such as 'the only officer covering an exit does not hide' is a balance knob for the docs stage or a later package.
- Pre-existing stall: hard V17 #15 (armed/shooter). During the comms outage (I1-b's C8 commsDown) the commander's engage and perimeter orders never reach the SWAT team after the entry decision, and the incident times out after 178 s. It is identical on b42; not caused by R3b.
- Minimum-crew robbery V4 #13 (riot) is a stall candidate only in the current code: an overhaul task stays open with only roll-call radio for 267 s. It is the same kind as the pre-existing overhaul stall (V29 #03) and is reached through the changed incident flow; minimum crew is outside the gate.
- For the docs stage: the implementer memo's two borderline results (extreme success −14, forced hostage deaths 0 to 1) did not reproduce on V seeds, so they are likely sample noise.
