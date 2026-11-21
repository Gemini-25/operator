# I1-b 독립 검토 — 작업자의 보고

워크플로 `docs/specs/workflows/package-run.js` 의 작업자(`review:causality`) 보고를 그대로 옮겼다. 끝 커밋 `1216510`(브랜치 `wf/causality-review (wf/causality points to the same commit)`), 관문 통과(`checkPassed: true`).

정본은 그 묶음 설계서 끝의 "구현 메모"다. 보고 속의 scratchpad 경로(`/tmp/…/scratchpad/wf-*/`)는 그 세션의 컨테이너에만 있다 — 기준 수치는 구현 메모의 방법으로 다시 잰다.


## 끝낸 것

- Fix 1 (b4 report, results unchanged), commit 2fc919d. The shift summary's '정전 n회' was counting rule firings, not real outages. world/report.ts worldReport counted world.log rows of powerOut and powerOut.grid. Those rows include the typhoon power-restore signal (blackout data 0), aftershocks that cut nothing, and explosions in districts that were already dark. Typhoon S0 and S1 showed one blackout as '정전 2회'. Quake S0 showed 1 real outage as '정전 3회'. I checked this by sampling distinct power causes every second (review/wrep.mts). The fix: rules/infra.ts openSpan, the only place an outage span is opened, now counts into world.count['powerOut.spans'] (POWER_N, same pattern as commsDown.spans), and worldReport reads that count. Files: src/sim/world/rules/infra.ts, src/sim/world/report.ts.
- Fix 2 (b4 report, results unchanged), same commit. '연기 n건' never appeared. smokePlume is a silent rule, so it never writes world.log rows, and worldReport was counting those rows. Normal S3 has 3 smoke alerts but its summary had no smoke line. worldReport now counts smoke alert records (tag smoke), which are written once per plume. File: src/sim/world/report.ts.
- Fix 3 (b4 chain sentence, results unchanged), commit 34ca4f0. When a queue part's root segment is the crash segment itself, the sentence named the same segment twice. Example, normal S26 #11: '시청로 4구간의 사고(…)로 차가 밀려 있던 시청로 4구간에서'. This happens because the T1 queue model also fills the root segment two hops out. That case now reads '{구간}의 사고(…)로 밀려 있던 그 구간에서 난 사고입니다'. File: src/sim/world/report.ts hzSentence.
- New tests: three in tests/causality.test.ts, block 'I1-b 검토: 교대 요약의 세계 상태 수…'. All three failed before the fixes: hand-made typhoon blackout on/off plus a weak aftershock gave outages 3 (now 1); normal S3 had no smoke in its summary (now '연기 3건'); the segment name appeared twice (now once). The 31-line hash list (review/rep.mts) has the same report.hash before and after the fixes.
- Review section appended to the end of the implementation memo in docs/specs/I1-causality.md, commit 1216510: what I fixed, what I checked, what I did not fix and why.
- Checked, no problem — reproducibility: 31 conditions (normal ×4, hard ×2, extreme ×3, five disasters ×2, six forced scenarios, traffic 1/5, unit scale 1/5, equipment 1/5). Running them forward in one process and forward-then-reverse in another gave identical report.hash, so nothing leaks between shifts through the city-keyed caches. b4 and b5 change no results: 93c4d9b and 998faf3 give the same 31 hashes. All new randomness comes from fork streams (hz:, hz-spawn:, hz:pipe:, hz:floodLow:, grid:*, csq:*, expo:, reoffend(-place):). fork does not touch the parent stream, and no call was inserted into an existing stream.
- Checked, no problem — laws off (review/lawsoff.mts): I removed all registered laws and reran. Every shift that had no law incident and no law log row kept an identical hash: normal 8/8, hard 5/5, quake 2/2.
- Checked, no problem — info isolation (grep): the decision files (dispatch/*, commander, brain, orders/*, methods, ops, airDecide, gear, doctrine*) contain none of sim.world, world.expo, .wear, placeState, zoneAt(, isDark(, expoOf, fireLoad, the traffic ledger fields, I.hz, hospitalOf, erLoad, placeMarks. Nothing under src/sim/world writes s.rules. The analyst calls only knownZone, knownZoneOfIncident and knownHazardNear.
- Checked, no problem — naturalness: none of the seven laws' scan or formula branches on the kind of cause. User example 1, forced traffic/tree ×20: 1 of 28 trees led to a crash (S11 #06: '내부순환로 3구간의 통제(사건 02 쓰러진 나무)로 차가 밀려 있던 동문로 2구간'). Example 2, forced collapse/gasblast ×20: structFail 1 + pipeLeak 3. Example 3 (fire → collapse) is unchanged X6. Integration does not pile up behind a cap: once-laws are marked done; other laws subtract the threshold and draw the next one; the shift cap returns on the first line; waiting targets are not integrated.
- Checked, no problem — feedback and caps: I ran extreme ×60 with --check, each of the five disasters under extreme settings ×12, unit scale 1/5, equipment 1/5, traffic 1/5 and 5-5-5-1-1-1 (×12 each), plus hard ×40 --check. Results: 0 exceptions, chain depth ≤ 2, one root ≤ 2, law/rule incidents ≤ 6 per shift, story chains + law incidents ≤ 6 per shift (maximum 6, at the limit), 0 holes, gain ≤ 0.16. Both --check runs pass.
- Checked, no problem — balance: I ran the §4 command set on base0 (4aea467) and head at the same time (review/m4-*). Every number matches the h8 memo table. Normal 60: incidents 846 → 881; success+delayed 80.6 → 77.6%; failed+unresolved 9.3 → 10.9%; average response 50 → 52 s; timeout+abandoned+no-response 3 → 3; natural 35 (22 with a parent); TRAFFIC_DELAY 23 → 29; C1–C5 = 0. Per-shift CPU time (sweep 12 --no-metrics, alternated with b3-3 end three times): 42.3 s → 42.9 s, ×1.01 (budget ×1.10).
- Checked, no problem — names later bundles expect: knownBuildingAt, placeState (+shake/pipe/wet), WorldTag (ends with 'struct'), ObstacleKind 'rubble', Scene.wear (cause 'shock'), CAT.WEAR_INTEG, registerConsequence, spawnConsequence, signal, tickWorld, registerHazard, SignalKind (ends with 'quake', 'blackout'), disaster.roadSill, and rule ids hospitalLoad, powerOut, suspectZone, floodLow all exist with the expected meaning. waterMain (C11) does not exist; see issues.
- Gates: npx tsc --noEmit passes. npm run check on the final commit passes: 1020 tests + 1 skipped, 20 files, and the normal-40 gate passes. In an earlier check run two tests timed out because my sweeps were running at the same time; run alone they both pass (crews ⑨ patient seats, sim 'presets get harder').

## 하지 못한 것

- The four inherited stall/repeat loops were not fixed. They are hard S5 #07 (149 s), extreme S35 #15 (406 s), quake S4 #16 (one responder repeated a retreat 22 times) and one wildfire stall. The code involved belongs to earlier bundles — the R2/R3 engage executor, X6 rubble mode and overhaul assignment, X6 sign retreat — and changing it would alter results broadly. I diagnosed each one; details are under issues.
- C11 waterMain (optional in the design) is not implemented. h7 and h8 skipped it too.
- Balance targets h8 already listed as unmet were left as they are, and I turned no knobs. My re-measurement gives the same numbers. Normal structFail+pipeLeak is 1 in 60 shifts (target 2–5). The tree share is 3.6% per closure (target 5–20%). Disaster natural incidents: quake 0.7 and tsunami 0.5 per shift (target 1–3). Four disasters have a parented share below 3%. Average response is +8 s for extreme and for flood. Timeout+abandoned+no-response is +3 hard and +5 flood. Every knob also moves another target that is already at the edge of its range.
- npm run ui-check was not run. I changed no view files; only report text changed.

## 설계서와 다르게 한 곳

- The fix for the outage count adds one counter key, world.count['powerOut.spans'], written in rules/infra.ts openSpan. This is a b3-10 file, and the key is new to the design. No rule reads it, so results are unchanged.
- The design asks that hashes with all laws off equal 'b3-3 end + detour diversion'. That can no longer hold at HEAD, because the state rules (C4/C5/C8/C10, shockSpread, applyExpo) also change results. I checked the stronger form instead: with all laws removed, every shift that had no law activity keeps an identical hash.
- I put the new tests in tests/causality.test.ts as instructed. The law-specific tests from earlier chunks stay in tests/hazard.test.ts.

## 설계서 밖의 공용 파일을 고친 곳

- src/sim/world/rules/infra.ts openSpan (a b3-10 file): added the POWER_N counter, which is not read by any rule, so the shift report can count real outages.
- docs/specs/I1-causality.md: appended the review section at the end of the implementation memo. The design body was not edited.

## 결과

Reproducibility: 31 conditions gave identical report.hash run forward in one process and forward-then-reverse in another. Laws off: shifts with no law activity were identical (normal 8/8, hard 5/5, quake 2/2). b4/b5 change no results: 93c4d9b = 998faf3 on all 31 lines. My fixes change no results: all 31 report.hash identical before and after.

§4, base0 4aea467 → head 998faf3:
- normal60: incidents 846 → 881; success+delayed 80.6 → 77.6%; failed+unresolved 9.3 → 10.9%; average response 50 → 52 s; timeout/abandoned/no-response 1/2/0 → 1/2/0; TRAFFIC_DELAY 23 → 29; stalls 0, forgotten 0, repeatMax 10 → 6; C1–C5 = 0; law incidents 35 (roadCrash 29, heatSpread 3, smokeIll 2, pipeLeak 1); 22 with a parent; holes 0; gain 0.086.
- hard30: success+delayed 62.3 → 62.6%; t/a/n 2/6/0 → 5/4/1; 1 stall (S5 #07).
- extreme30: success+delayed 37.1 → 38.1%; t/a/n 11/19/13 → 21/16/10; average response 85 → 93 s.
- Disasters ×20 (base0 → head, t/a/n): typhoon 8/0/0 → 7/0/0; flood 2/0/0 → 6/1/0 (response 82 → 90 s); quake 20/1/7 → 21/1/5 (repeatMax 11 → 22); wildfire 7/1/1 → 6/0/1 (1 stall); tsunami 1/0/0 → 0/0/0.
- Forced ×20: tree 1 crash caused by a tree out of 28 trees; fire/std heatSpread 4; collapse/gasblast structFail 1 + pipeLeak 3.

Edge runs:
- extreme ×60 --check: passed (1355 incidents, 0 exceptions, depth ≤ 2, max 6 per shift, 0 holes).
- Five disasters under extreme settings ×12, unit scale 1/5, equipment 1/5, traffic 1/5, 5-5-5-1-1-1: 0 exceptions, root ≤ 2, ≤ 6 per shift.
- hard ×40 --check: passed.

Timing: b3-3 end 42.3 s → head 42.9 s user CPU (×1.01).

Gate: npm run check passed — 1020 tests + 1 skipped, 20 files, normal-40 gate passed.

Tools are in /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-causality/review/ (rep.mts, lawsoff.mts, wrep.mts, dumpchain.mts, tree.mts, stall.mts, stall2.mts, m4.sh, edge.sh, timing.sh, tab.mjs). Outputs are in m4-base0/, m4-head/, edge/, rep-*.txt.

## 알려진 문제 · 다음 작업자가 알아야 할 것

- hard S5 #07 (149 s stall): C10 placed the reoffend armed robbery at a bookstore. At 13:49 responder 최민재 entered alone and kept task engage/6 with label '진입' at (11,1.4). Suspect 2 stayed in state 'hold' at (13,6). The commander was hurt and on standby; two responders were on perimeter. Two casualties were never found and the incident ended by timeout. The cause is the R2/R3 engage executor: after entry, no branch acts on a holding suspect. Base0 hard ×40 has 0 stalls. Only the normal gate is enforced, and it passes.
- extreme S35 #15 (406 s stall): a chemical plant that burned out and fully collapsed. Eight overhaul tasks stay open with no assignees while 9 responders stand by (4 in pair escort). This is X6 rubble mode / overhaul assignment. The scene has no wear and no added C8 shadow.
- quake S4 #16: responder 설하윤 logged '천장이 내려앉고 있습니다. 물러납니다.' 22 times, every 20–35 s for 10 minutes, and many other responders churned the same way. This is the X6 brain.evacDuty sign retreat alternating with the R3 pair entry ('같이 들어간다'). The building has no wear, so it is not caused by I1-b's damage model. It raises quake repeatMax from 11 to 22.
- C11 waterMain does not exist. N8 expects to attach its 'pipeBurst' signal to that rule id, so N8 must create C11 first or use its own rule.
- The card's cause chip symbol (CAUSE_MARK) is not in marks.ts or the map legend. h8 chose this deliberately because it is a card chip, not a map marker; I left it.
- While other sweeps run on this machine, the crews ⑨ test (120 s budget) and the sim 'presets' test (180 s budget) can time out. Run alone, both pass.
