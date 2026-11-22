# N8 독립 검토 — 작업자의 보고

워크플로 `docs/specs/workflows/package-run.js` 의 작업자(`review:kinds`) 보고를 그대로 옮겼다. 끝 커밋 `52d57e6b51020279521169a6412392257f40e40f`(브랜치 `wf/kinds-review`), 관문 **통과하지 못함**(`checkPassed: false`).

정본은 그 묶음 설계서 끝의 "구현 메모"다. 보고 속의 scratchpad 경로(`/tmp/…/scratchpad/wf-*/`)는 그 세션의 컨테이너에만 있다 — 기준 수치는 구현 메모의 방법으로 다시 잰다.


## 끝낸 것

- Review 1: read the full diff of s7b (welfare/ledge, lockin) and s11b (balance knobs, failure paths for facade, pit and birth) and checked it against the spec
- Fix 1 (98e46dd): executor.unblock. The s7b line `s.kinds.entered` had been inserted between the door branch and the charge branch, so the `else if (method === 'charge')` attached to the wrong `if`. When a door was opened by charge, two breach Fx records were left and the 3-2-1 and door-panel drawing played twice. Fx records only, so logHash is unchanged. Restored the pairing and moved the line after it. Added a 'only one entry record' assertion to the charge test in tests/methods.test.ts; it gave 2 before the fix.
- Fix 2 (98e46dd): two test checks that had stopped running. In tests/methods.test.ts the rescueLead kit check had ended up inside a comment; restored, and it passes. In tests/kinds.test.ts '9·20 안전 매트', `void saw` meant the test passed even when no one took a mat-site task; now asserts saw > 0.
- Fix 3 (286873e): fire and medical helicopters were sent to car chases that had no chase label (the cause of the crews ⑪ failure). dispatcher.airFit now returns 0 for medical and fire helicopters when the public field `I.reportedPrev` is set, which is the moment dispatch already knows the car is moving. The police helicopter is unchanged. pursuit.stop clears reportedPrev when the car stops, so dispatch can again send units to the crash scene. Added the tests/kinds.test.ts block 'N8 검토: 이름표 없는 추격전'; it gave 1 before the fix and 0 after. 3 of the 153 entries in the hash list changed: extreme S2 and S19, and forced S2 traffic/bus.
- Re-ran the three failing tests and found their causes: crews ⑤, crews ⑪, and the sim test '허위·오인'
- Reproducibility: 35 conditions × (run twice, then once in reverse order, all in one process). 0 hash mismatches, 0 exceptions.
- Info isolation: the judgement-side code changed by stage 7 (second half) and stage 11 does not read truth. Source checks: orders/kinds (crisis person, locked house, towHand), methods.armoredDoor, agents.fitBase and ledgeRadii, commander.zoneScene. Test 4 passes.
- §5.13 screen check (Playwright, port 5236, forced crisis person S3): around the failure there is no auto-slowdown and the camera does not move to it, no figure or cover sheet is drawn, the log has exactly one line, and the console has 0 errors. The dev server was stopped afterwards.
- Forced 20-shift runs for seven scenarios. The numbers match the stage 11 implementation memo, and every scenario has 0 deadlock candidates.
- Gates: normal 40, hard 40 and extreme 40 `--check` all pass. Edge cases: extreme 60, all five disasters × 12, unit-size 1 and 5, and equipment 1 and 5 all have errors=0.
- K1–K8 laws: no `.chance(` and no branches on the kind of cause
- Added the 'independent review' section to the spec implementation memo (d85c62c, 52d57e6): what was fixed, what was measured, and what was not fixed with its numbers

## 하지 못한 것

- crews ⑤ '구출은 유압 구조대원이' (threshold 0.5) still fails: 0.470 now, 0.496 before the ⑪ fix changed the stream. Not fixed. A wide sample gives 0.45–0.48 even at the N8 stage-0 base, so the test has depended on its seed sample (the seeds were swapped four times). In forced collapse and traffic shifts the share drops to 0.403, but with short events turned off (daily=0) it is 0.480, above the base. So the drop comes from the shortage short events create: with no ambulance free, the hydraulic rescuers do treatment and carrying. Possible levers are ambulance supply (§12.5-3, the user decision on one general ambulance), the R1 hand-over rule or the R3 pair rule. The threshold and seeds were left as they are.
- The sim.test '허위·오인 신고는 … 확인 출동으로 끝난다' still fails at normal S7 #13 (fire/false). Not fixed. This is not a loop or deadlock. Every pump and ladder unit was tied up elsewhere, dispatch diverted ladder 1, and the 330-second no-response closure came first. In a wide sample of normal 60 it is 1 of 46 cases. Fixing it means changing dispatch diversion or the no-response rule, which apply to all incidents, so it is outside this bundle.
- When dispatch sends a fire or medical helicopter before it knows the incident is a chase, there is no way to recall it once it finds out (normal S20). A dispatch 'cancel' path would be new work outside this bundle.

## 설계서와 다르게 한 곳

- The crews ⑪ check now asks whether dispatch knew it was a chase at the tick it assigned the unit (a chase label, or `I.reportedPrev`). The test already had one exception for the same reason: car theft rated as a traffic accident. The airFit fix changed the stream, and at normal S20 a fire helicopter is now assigned before the sighting report arrives, so that exception was generalised to this rule. Helicopters assigned after a sighting report are now caught even without a label: under the pre-fix code, S2 fails this check.

## 설계서 밖의 공용 파일을 고친 곳

- src/sim/dispatch/dispatcher.ts · airFit: medical and fire helicopters get 0 when `I.reportedPrev !== undefined` (a public field dispatch already reads). Reason: fire and medical helicopters were sent to a chase whose moving car dispatch already knew about.
- src/sim/pursuit.ts · stop(): `I.reportedPrev = undefined` after `setReported`. Reason: stops the airFit condition above from still applying at the crash scene after the car stops.
- src/sim/field/executor.ts · unblock: restored the if / else-if pairing and moved the welfare `s.kinds.entered` line after it. Reason: a charge-opened door left two breach records (a regression from stage 7).
- tests/crews.test.ts · ⑪ patrol(): judges by whether dispatch knew it was a chase at assignment (CHASE_LABELS + reportedPrev). Removed the old car-theft exception.
- tests/methods.test.ts: restored the rescueLead kit check that had been commented out, and added the single-breach-record check to the charge test

## 결과

npm run check (HEAD 52d57e6, about 15 minutes): tsc passes. vitest: 20 files, 1137 passed and 2 failed out of 1139. The two failures are crews ⑤ '구출은 유압 구조대원이' and sim '허위·오인 신고는 … 확인 출동으로 끝난다'. Because vitest failed, check's `&&` chain did not reach `sweep 40 --check`; that gate was run separately.

Separate gate runs:
- Normal 40 `--check` passes: 759 incidents · timeout 2 · noresponse 1 · abandoned 2 · deadlock candidates 0 · forgotten 0 · C1–C5 0 · ledger holes 0.
- Hard 40 `--check` passes: 1016 · timeout 18 · noresponse 9 · abandoned 15 · shiftend 2 · deadlock candidates 2. Same as the stage 11 memo.
- Extreme 40 `--check` passes: 1293 · timeout 47 · noresponse 29 · abandoned 27 · shiftend 7 · deadlock candidates 0.

Edge cases, all errors=0:
- Extreme 60: 1936 incidents · timeout 67
- Typhoon 12: timeout 5 · Flood 12: 6 · Quake 12: 12 · Wildfire 12: 10 · Tsunami 12: 4
- Unit size 1: timeout 13, deadlock candidates 1 (114s; this condition is outside the gate) · Unit size 5: timeout 1
- Equipment 1 and 5: no errors · Equipment 5: timeout 0

Reproducibility: 35 conditions × 3 runs, 0 mismatches.

Forced 20 shifts — every scenario has 0 deadlock candidates:

| Scenario | Numbers |
|---|---|
| Crisis person | 20 · 19 · 0 · 0 · 0 · 1 \| 0·0·0 |
| Locked house | 27 · 24 · 0 · 2 · 1 · 0 \| 1·0·0 |
| Dementia elder | 23 · 22 · 0 · 1 \| 1·0·0 |
| Sign | 29 · 25 · 4 \| 0 |
| Beehive | 28 · 21 · 0 · 2 · 0 · 5 \| 1 |
| Car theft | 24 · 6 · 16 · 0 · 2 · 0 \| 0·0·2 |
| Reckless driving | 20 · 17 · 2 · 0 · 0 · 1 \| 0 |

The getaway car's 10 abandoned in forced 20 is also 10 at the N8 stage-0 base.

crews ⑤ share by sample:

| Sample | Base | After review | After review, daily=0 |
|---|---|---|---|
| Test sample | — | 0.470 (0.496 before the ⑪ fix) | — |
| Normal 60 | 0.476 | 0.484 | — |
| Forced collapse/traffic, 48 shifts | 0.448 | 0.403 | 0.480 |

Helicopters on unlabelled chases: 1 before the fix, 0 after. Breach records for a charge-opened door: 2 before the fix, 1 after.

## 알려진 문제 · 다음 작업자가 알아야 할 것

- The two failing tests (crews ⑤ and sim 허위·오인) are left failing. The thresholds and seeds were not touched, as instructed. The next worker or the user has to choose a balance lever: ambulance supply (§12.5-3), the R1 hand-over or R3 pair rules, or dispatch diversion and the 330-second no-response rule.
- The airFit fix changed the outcome of 3 of the 153 hash-list conditions (extreme S2 and S19, forced S2 traffic/bus). Use 52d57e6 as the new reference for any later hash comparison.
- There is no way to recall a helicopter assigned before dispatch knew it was a chase (normal S20: the fire helicopter stays assigned until the car stops)
- Review scripts and logs (repro.ts, heli*.ts, extrwide*.ts, falsewide.ts, ledgeroof.ts, ledgefail.ts, ledge-ui.cjs, force.sh, edges.sh, check.log, edges-summary.txt) are in /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-kinds/review/
- Nothing was pushed and no PR was made. git status is clean, and wf/kinds and wf/kinds-review both point to 52d57e6. The main working folder was not touched, and the dev server on 5236 has been stopped.
