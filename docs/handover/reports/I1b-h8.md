# I1-b 단계 b4·b5 (보고서의 내력 문장·화면 + 균형·완료 조건) — 작업자의 보고

워크플로 `docs/specs/workflows/package-run.js` 의 작업자(`impl:causality:h8`) 보고를 그대로 옮겼다. 끝 커밋 `998faf3`(브랜치 `wf/causality-h8 (wf/causality points at the same commit)`), 관문 통과(`checkPassed: true`).

정본은 그 묶음 설계서 끝의 "구현 메모"다. 보고 속의 scratchpad 경로(`/tmp/…/scratchpad/wf-*/`)는 그 세션의 컨테이너에만 있다 — 기준 수치는 구현 메모의 방법으로 다시 잰다.


## 끝낸 것

- Setup: merged claude/practical-keller-xm0ac2 into wf/causality-h8 (d3e4b26). Baseline reused from h7/out-fin: src/scripts/tests are identical to 93c4d9b, and that commit's hash list and reportHash already matched.
- b4 report sentences (016eebf, results unchanged): new file src/sim/world/report.ts with chainLines/ChainLine/CHAIN_LINES/causeWord/worldReport/HZ_SHORT/STORY_NAME. debrief.buildReport now fills ShiftReport.incidents[].parent/children/chain (up to 4 lines, picked by law and share type; 'about N seconds' = at − since of that share) and ShiftReport.world. The summary gains a '인과:' line (only when law or story-chain incidents exist) and a '세계 상태:' line. Hash list: all 123 report.hash values unchanged; only the report JSON changed.
- b4 screen (2351822, results unchanged): new view/city/zoneLayer.ts drawZonesWorld draws local and district-wide outage and smoke rings; the AI view shows only known ones. ruinLayer.drawExpoWorld draws cracked buildings and broken pipes, observer view only. HazardStrip.causeChip adds a cause chip. The report panel shows ul.chain. Two legend rows and a styles.css I1-b block. Tests: drawing while running quake S1 leaves sim.world, logHash and the event count unchanged, and the AI view shows no chip; a source-text test checks view/ui files call no world-mutating functions.
- b5 (c544221): I1-a gate tightened in scripts/metrics.ts: CHAIN_DEPTH_GATE 4→3 and CHAINED_SHIFT_GATE 8→6 (holes, rootMax and 6-per-shift were already enforced). Tests: gate boundaries; §6 I1-b 8 three-step spread through law incidents (normal S33: gas explosion → heatSpread fire → its smoke → smokeIll; normal S26: fire → smoke → haze roadCrash → queue roadCrash); completion condition 2 (extreme S3/S4 ROUTE_BLOCKED caused by a heatSpread incident's road closure). Added step ④ to the L1 intervention test: the report sentence contains the tree incident code and both road-segment names.
- Measured the full §4 target table, normal 120 (X6 counts and laws), chain-sentence stats, tree-caused roadCrash count, timing, and a DIVERT.MAX 0.6 experiment (not adopted). Implementation memo appended to the end of docs/specs/I1-causality.md (998faf3); design body §3–§9 left untouched.
- Gates and checks: npm run check passed (1017 tests + 1 skipped, 20 files). Hard 40 --check and extreme 40 --check both passed with the tightened gates. npm run ui-check passed (8 items). Checked the screen on port 5218 at 1600×900: 0 console errors. Browser and headless hashes match on a law seed (normal S5 random-disaster end reportHash 9731e1c8; quake S1 tick 3267 hash aa17c83b).

## 하지 못한 것

- Normal 60 structFail+pipeLeak is 1 (2 in 120 shifts) against a target of 2–5. Forced collapse/gasblast already sits at 4, the top of its 1–4 target, and every L3 knob (strength or state size) moves both together. Most normal crossings are dropped as late or busy-building.
- Disaster natural incidents per shift: quake 0.7 and tsunami 0.5 (target 1–3). Parented share in disasters: typhoon 1.7%, flood 2.1%, quake 2.0%, tsunami 0.8% (target 3–15%; only wildfire 3.2% meets it). Tree share per closure is 3.6% (target 5–20%; the count of 1 is inside 1–4). ROAD.A cannot rise because normal roadCrash is 0.48/shift, at the 0.5 upper edge. Quake crossings mostly expire under load, and §8-24 says not to raise HZ.HOLD.
- Average response over baseline+6s: extreme +8, flood +8, wildfire +7. Timeout+abandon+noresponse over baseline+2: hard +3, flood +5. Tried DIVERT.MAX 0.6: flood 90→88s, extreme and wildfire unchanged, wildfire timeouts 6→13, normal failed+unresolved 10.9→11.6%. Not adopted.
- Stall candidates above baseline outside normal: hard S5 #07, extreme S35 #15 (406s of open overhaul tasks after a total collapse), wildfire 1. repeatMax above baseline in typhoon, flood, quake and wildfire. All were inherited from earlier chunks and the code lives outside the b4/b5 files, so they were not fixed.
- The optional C11 waterMain was not done (h7 also skipped it); it is outside b4/b5.

## 설계서와 다르게 한 곳

- The sentence builder lives in a new registration-free file src/sim/world/report.ts (chainLines and worldReport), which debrief.buildReport calls. The design puts it inside debrief.ts. Reason: tests need to see the structured references (ev, inc, edge, place) behind each sentence.
- Small wording differences: heat '바로 옆 {건물}에'; residual, outage and smoke also name the building; a queue rooted in a crowd reads '{구간}의 {장소} 주변 인파로'; jam drops the redundant cause parenthesis. The second share is appended only when it comes from a different record. Parenthetical notes go just before the final period.
- The DIVERTED line appears only when ref.lost ≥ 10 (DIVERT_LATE_MIN). HOSPITAL_FULL lines appear only after the incident closed, because evaluate's analysis already covers pre-close ones. blockedBy wait seconds come from the NO_UNIT recovery text, otherwise from close time.
- Added a '세계 상태:' summary line (outages, comms, ER saturation, smoke, cracked buildings, broken pipes, flooded basements) that the design does not have; h7 left the flooded-building count to b4. ShiftReport.world.lines holds both lines. Counts: outages = world.log powerOut/powerOut.grid rows; commsDown = world.count['commsDown.spans']; hospitalDiverts = hospital-tagged '응급실 포화 —' records; rerouted = HOSPITAL_FULL problems; spawned = world.log rows with made ≥ 0.
- '가장 긴 사슬' is its own piece of the 인과 line rather than inside the parentheses. The dropped count is the whole of gen.dropped.
- The cause chip is prepended in HazardStrip (causeChip), not inside G4's hazardChips, which caps at 4. Its symbol (CAUSE_MARK) is new and not added to marks.ts or the map legend.
- District-wide zone values (no ZoneState.at) are drawn as the DISTRICTS circle. City-wide typhoon blackout rings are skipped because d.dark already darkens the map. Cracks show as a glyph when the building is drawn small. Buildings already burnt or collapsed (placeMarks) are skipped.
- Also tightened CHAINED_SHIFT_GATE 8→6 to match the user's 6-per-shift decision; the task named only M-G3 depth 3.
- §6 I1-b 8 uses chains that actually occurred in normal S33 and S26 rather than the design's suggested tree + raised A_ROAD or pileup setups. Completion condition 2's 'law incident closure met by another incident's unit' never occurs in normal or hard runs, so the test uses extreme S3 and S4 (heatSpread closures).
- No knob values changed in b5. Every out-of-range target trades off against another target that is already at its edge; the memo documents each one.

## 설계서 밖의 공용 파일을 고친 곳

- src/sim/debrief.ts buildReport: added the parent/children/chain fields, ShiftReport.world, and the summary lines (calls world/report.ts).
- src/ui/panels.tsx ReportModal incident item: one ul.chain list under the analysis.
- src/ui/styles.css: appended a '/* ── I1-b ── */' block for ul.chain.
- src/view/renderCity.ts drawCity world layer: calls drawZonesWorld after drawDisasterWorld and drawExpoWorld after drawRuinsWorld.
- src/view/city/ruinLayer.ts (G4 file): added drawExpoWorld, EXPO_CRACK and EXPO_PIPE.
- src/ui/HazardStrip.tsx (G4 file): added causeChip, CAUSE_MARK and CAUSE_COLOR, and prepends the cause chip.
- src/ui/MapLegend.tsx: new '이웃 건물과 동네' section with CrackSample, PipeSample and ZoneSample.
- scripts/metrics.ts: CHAIN_DEPTH_GATE 3 and CHAINED_SHIFT_GATE 6.
- tests/hazard.test.ts: L1 intervention test step ④ and report.ts in the registration-free list. tests/causality.test.ts: b4 and b5 blocks plus gate-boundary assertions.

## 결과

Results did not change (logHash/report.hash identical on all 123 hash-list lines), so the §4 numbers equal h7/out-fin. Baseline = b1 row → now:
- Success+delayed: normal 80.6→77.6; hard 62.1→62.6; extreme 37.9→38.1; typhoon 74.5→74.0; flood 67.5→65.2; quake 42.7→42.2; wildfire 66.6→64.3; tsunami 75.1→73.5. All within ±4%p.
- Failed+unresolved: normal 9.3→10.9 (49 of 96 such incidents have a chain sentence).
- Timeout·abandon·noresponse, normal: 1·2·0 → 1·2·0.
- Average response, normal: 50→52s.
- Incidents per shift, normal: ×1.041.
- hazard.natural, normal 60: 35 (22 parented); normal 120: 75.
- gain ≤ 0.086; holes 0 everywhere; depth ≤ 2; rootMax ≤ 2; max causal per shift 6 (extreme).
- Law counts: normal roadCrash 0.48/shift; rekindle 0; smokeIll 2 (6 in 120); forced fire/std heatSpread 4; forced gasblast struct+pipe 1+3; typhoon liftStall 0.70/shift; forced tree 1 tree-caused crash out of 28 closures.
- X6, normal 120 (total collapse·burnout·explosion·withdrawal·partial): 22·20·34·80·202 (h3) → 20·20·34·73·194, within noise.
- spread≥3 4→9; cross-incident links 686→956; world links 0→101; replan 48.0%→50.2% (fromWorld 31→90); divert.hurt 31→36 (lost 322→358s, inside ×1.3).
- Entropy: outcome 0.90→1.02, story 3.01→3.16, actions 2.51→2.54. C1–C5 = 0 in all conditions.
- Chain sentences, normal 60: 289 of 881 incidents, 334 lines (248 blocked, 35 law causes, 27 children, 9 divert, 7 story, 4 hospital, 3 wear, 1 infra).
- Timing (user CPU, alternating, two rounds of 3): b3-3 end 38.13s, h8 end 39.73s (×1.042), CSQ_SPAWN_CAP=0 39.01s (×1.023).

Gates:
- npm run check: passed (1017 + 1 skipped; normal 40 validation: 590 incidents, stall 0, forgotten 0).
- Hard 40 --check: passed (740 incidents, 51%, one stall candidate S5 #07).
- Extreme 40 --check: passed (907 incidents, 27%, max per shift 6, one stall candidate S35 #15).
- ui-check: passed.

Screenshots: /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-causality/h8/shots/ (quakeS1c-map-truth.png, quakeS1c-zoom-truth.png, crop-crack2.png, quakeS1c-zoom-ai.png, crop-crack-ai.png, normS5-chip-card.png, normS5-chain.png).

Completion conditions:
- (가) Tree→crash intervention test passes. Collapse→crack→structFail/pipeLeak occurs (quake S1 #20/#21, normal S20 #07). Faster collapse of a cracked building is covered by the h5 neglect test. Fire→collapse is shown by the X6 120-shift counts.
- (나) natural 35, holes 0.
- 1: ge3 9; law paths fixed in tests (S33, S26).
- 2: replan 50.2%, fromWorld 90, law-closure ROUTE_BLOCKED (extreme S3/S4).
- 3: divert.hurt 36, lost 358s, 248 blocked sentences.
- 4: C1–C5 = 0; every sentence's references exist (test).
- 5: normal stall/forgotten 0, limits held; non-normal stalls and repeats exceed baseline (see notDone).

## 알려진 문제 · 다음 작업자가 알아야 할 것

- Extreme S35 #15: 8 overhaul tasks stay open in a totally collapsed building (rubble mode) while 13 responders sit idle for 406s until timeout. This is commander/X6 territory (overhaul wanted inside rubble). The extreme gate excludes stalls, so it passes.
- Hard S5 #07 (h5) and wildfire 1 stall candidate; quake S4 #16 evacuation repeated 22 times; extreme S11 #15 reassignment repeated 13 times. All are known from earlier chunks.
- About 74% of chain sentences are '부대가 사건 …에 묶여 N초 동안 배정하지 못했습니다' lines, which makes busy shifts monotonous. Consider emitting it only when the wait exceeds about 10 s.
- causeWord classifies obstacle, jam and crowd causes by the record's text. Changing the traffic notice wording (announceEv, noticeText, crowd and jam texts) silently breaks the label; OBST_WORD in world/report.ts must change with it.
- Reviewer or doc stage: DIVERT.MAX / SMOKE.BUMP / POWER.DARK_BUMP are the remaining levers for extreme/flood/wildfire response time. A 0.6 DIVERT.MAX copy and its measurements are in the scratchpad (h8/div06, h8/out-div06).
- Timing is noisy (±5% run to run). The framework-share figure is 1.023 on the 6-run mean but 1.029 on the second round alone; the reviewer should re-measure by alternating runs.
- The design body asks the doc worker to update README, CLAUDE.md and ROADMAP; this chunk did not touch them, as instructed.
