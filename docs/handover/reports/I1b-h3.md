# I1-b 단계 b3-7 (건물의 노출 + L2 옮겨붙는 불) — 작업자의 보고

워크플로 `docs/specs/workflows/package-run.js` 의 작업자(`impl:causality:h3`) 보고를 그대로 옮겼다. 끝 커밋 `49b6fd3`(브랜치 `wf/causality-h3 (pointer wf/causality moved to the same commit)`), 관문 통과(`checkPassed: true`).

정본은 그 묶음 설계서 끝의 "구현 메모"다. 보고 속의 scratchpad 경로(`/tmp/…/scratchpad/wf-*/`)는 그 세션의 컨테이너에만 있다 — 기준 수치는 구현 메모의 방법으로 다시 잰다.


## 끝낸 것

- b3-7 ① Checked whether two open incidents at the same intersection can be told apart (forced fire/std, 20 shifts, final code). There were 4 such pairs. All had different map pins, because pins sit at the building centre. All had different curb-parking spots, because each unit parks at its own incident's building cx·cy, and no unit parked in front of another incident's building. Follow-up calls stay tied to their own incident, and screening is still a stub that always returns null. knownBuildingAt cannot separate two buildings of the same kind (3 of the 4 pairs were shop/shop), but no decision code calls it yet. Verdict: they can be told apart, so the spawn-null + hold: 300 branch was NOT used (default hold of 60 s).
- b3-7 ② Hash-neutral commit 1fd3ae3: world/expo.ts (no registration) with expoOf (pipeThr = 0.2+0.6×fork('hz:pipe:<building>'), kept inside sim.world), neighborsOf / neighborsOfPoint (city-keyed WeakMap, independent of seed, sorted by gap then id, excludes open places, facilities and itself), wallGap / pointGap / NB_REACH; hazards.fireLoad (WeakMap, one extra count in the tickFire loop) and fireCauseEv; placeState now also returns shake/pipe/wet. Hash list 123 lines: diff 0 against the start point.
- b3-7 ③ Law commit e95520c: world/laws/heat.ts registers L2 heatSpread (every 1, once, cap 3) and laws/index.ts imports it on the line after road. Causes are the fire-causing record (fireCauseEv), never ESCALATION; the parent is the heat-source incident. hazstats gets a hazard-heat line and a JSON hazard.heat field. Hash check: the 19 changed lines are exactly the 19 shifts with heatSpread incidents (0 changed without one, 0 with one unchanged).
- b3-7 law refinement f1e08f1: fireLoad counts only indoor-region cells for building scenes, and spawn rounds the recovered F before comparing to F_BIG. The hash list changed on 1 line (wildfire S0 went from 2 spreads to 0, back to the pre hash).
- b3-7 ④ State/decision commit f1c2106: world/state.knownHazardNear; the analyst adds '연소 확대' label + SPREAD_SEV 0.3 + reason '인근 큰 불·폭발'; the fireBig signal ev now uses fireCauseEv. Hash check with a condition probe (cond.mts): all 22 changed lines had the condition; 0 lines changed without it.
- b3-7 ⑤ Tests 0fbc10c: tests/hazard.test.ts 'I1-b b3-7' block of 10 (registration; ② distances and neighbour list; ① no cells, including outdoor fire cells; ③ intervention; ④ across-the-road; ⑤ non-target buildings and waiting for an occupied building; ⑥ root branches 2 + third generation 'depth'; ⑦ cause record not ESCALATION and fireBig ev; knownHazardNear/analyst; real forced S1 with truth.placeId === hz.target). Added expo.ts to the registration-free list. Updated causality.test.ts '세계 상태 … 처음 값' to accept heatSpread cells.
- Implementation memo 49b6fd3 appended to the end of docs/specs/I1-causality.md (section 'b3-7 — 건물의 노출과 L2 heatSpread').

## 하지 못한 것

- npm run ui-check was not run. Only the analyst label text '연소 확대' reaches the card title; no drawing code changed.
- Ember term (불티) and expo shake/pipe/wet population are b3-8c and b3-8 work, so not done here. The spawn already handles what === 'ember' (severity 2, ember note).

## 설계서와 다르게 한 곳

- fireLoad F counts only cells in indoor regions when the scene is a building (the design says all cells with fire ≥ 0.5); road scenes still count all cells. Why: with all cells, the burning forest inside wildfire 'fire/wild' scenes produced 14 spreads to pension/temple neighbours in wildfire 20, and timeout/abandon/noresponse went 10→19. The flux formula measures from the source building's walls, and wildfire spread into buildings belongs to the wildfire model (same reasoning as the design's 'the fire front is not a heat source'). Normal, hard, extreme and forced exposure did not change at all.
- HEAT.K = 1.2e-4, not the design's first value 1.7e-4. At 1.7e-4, forced fire/std 20 gave 5 spreads and fire success −3.5%p; at 1.2e-4 it gives 3 spreads and −1.2%p.
- Targets exclude kinds not listed in INCIDENT_PLACES.fire, on top of the design's facilities, open places, unusable and already-burned buildings. Reason: avoid fire scenes on building kinds whose fire template was never checked.
- 'Already burned building' means a fire-type incident happened at that place this shift (false alarms included) or a scene there has burned tiles. False alarms are not excluded because law files must not contain truth.variant.
- knownHazardNear has a 5th parameter except = -1 (the incident being assessed). 'Big fire' means open + locationKnown + fieldVerified + (fieldType ?? assessment.type) === 'fire' + fieldRisk defined; the design's 'confirm field name' resolves to fieldVerified/fieldType.
- The '연소 확대' label is set only when no scenario label exists; the reason text is '인근 큰 불·폭발'.
- Test ④ boundary: at F=59 the reach is 6(√(59/3)−1) ≈ 20.6, not 'gap ≥ 20' as the design says; the test uses 21.
- Severity F is recovered from main.rate, the same approach as L1 uses for x, and rounded.
- fireCauseEv lives in field/hazards.ts; L2 and the fireBig signal share it. heat.ts also exports HEAT, heatMul, heatRate and heatTargets for hazstats. expo.ts also exports wallGap, pointGap, NB_REACH and Nb.
- world/state.ts imports X6_BOOM_DETAIL from field/catastrophe; a hash list taken with only this import added was diff 0.
- L2 tests live in tests/hazard.test.ts, not tests/causality.test.ts.

## 설계서 밖의 공용 파일을 고친 곳

- src/sim/field/hazards.ts — tickFire: one extra count (fireLoad, indoor-only for building scenes); fireBig signal ev → fireCauseEv; new exports FIRE_LOAD_MIN, fireLoad, fireCauseEv. Listed in the design's §7.
- src/sim/dispatch/analyst.ts — assess: '연소 확대' label and +0.3 via knownHazardNear only; SPREAD_SEV export. Listed in §7.
- src/sim/world/state.ts — placeState new fields; knownHazardNear; import of X6_BOOM_DETAIL from field/catastrophe (catastrophe.ts itself not edited). Listed in §7.
- scripts/hazstats.ts — hazard-heat line. Listed in §7.
- tests/causality.test.ts — world-state initial-value test accepts heatSpread cells and log rows, because the law now registers.
- No edits outside the design's file list.

## 결과

Baseline: start point 9c0bbec re-measured from a git archive copy (h3/out-pre/). It reproduces h2's L1 numbers: normal 60 has 875 incidents, 77.7% good, reportHash 4752b486. After = h3/out-post2/ (last code commit 0fbc10c).

**Normal 60**
- Incidents 875 → 877
- Success + delayed 77.7 → 77.3%; failed + unresolved 11.1 → 11.3%
- Average response 51 → 52 s
- Timeout·abandoned·noresponse 0·2·0 unchanged
- heatSpread 4, roadCrash 29 → 28; hazard.natural 32; parented 19, orphan 13
- holes 0, gain 0.094, stall 0, forgotten 0, C1–C5 0
- Fire-type incidents 174 → 178; success 54.6 → 53.9% (−0.7%p); success + delayed 59.8 → 58.4%

**Forced fire/std 20 (done condition)**
- heatSpread 3 (3 crossed, 3 made — target 1~4)
- Fire success 49.4 → 48.2% (−1.2%p, within −2%p); success + delayed 50.6 → 49.4%
- Timeouts 4 → 5 (one spread fire timed out)
- In heatSpread incidents seen in tests and the S1/S7 probes, truth.placeId === hz.target every time (tested)

**Other forced 20**
- collapse/gasblast 4, traffic/tree 4, traffic/pileup 3, traffic/bus 1 heatSpread
- All five forced conditions: stall 0, forgotten 0, holes 0, C1–C5 0

**Hard 30**
- heatSpread 8; good 62.4 → 61.2%; timeout·abandoned·noresponse 3·4·2 unchanged
- Fire success 30.4 → 28.2% (−2.2%p); success + delayed 36.3 → 32.7%

**Extreme 30**
- heatSpread 11; good 37.9 → 37.4%; timeout·abandoned·noresponse 18·20·4 → 18·20·5
- Fire success 9.2 → 9.3%

**Disasters, 20 shifts each**
- Typhoon: 0 heatSpread, identical reportHash
- Flood 1, quake 1, wildfire 3, tsunami 1 heatSpread
- Wildfire after the indoor-F fix: good 62.6 → 62.4%, timeout·abandoned·noresponse 9·0·1 unchanged; before the fix it was 14 spreads and 10 → 19

**Hash checks (123 lines)**
- Exposure framework commit: diff 0
- Law commit: 19 changed lines = the 19 shifts with heatSpread
- State/decision commit: 22 changed lines, all with the condition; 29/123 shifts had the condition
- Refinement commit: 1 changed line
- Final vs start: 27 lines changed

**Timing** (sweep 12 --no-metrics, pre and post alternated three times)
- User CPU 30.2/30.1/30.0 → 31.1/31.2/30.5 s (+2.6%)
- 989/950/957 → 1006/1004/966 ms per shift (+3.0%)

**Gates**
- npm run check passed: 961 tests + 1 skipped; normal 40 check passed (586 incidents, 70% success, timeout 0, abandoned 1, stall 0, C1–C5 0, roadCrash 19, heatSpread 4, holes 0)
- sweep 40 --diff hard --check passed (736 incidents, 50% success, timeout 9, abandoned 8, noresponse 3)
- sweep 40 --diff extreme --check passed (893 incidents, 27% success, 24·24·9, max causal 6 per shift)
- Max depth ≤ 2 and root max 2 in all conditions

Tools and data are in /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-causality/h3/ (tools/, out-pre/, out-post2/, check.log, check-hard.log, check-ext.log, timing.txt, samenode-final.txt, cond.txt).

## 알려진 문제 · 다음 작업자가 알아야 할 것

- Fire success falls more than 2%p in conditions other than the done condition: hard 30 −2.2%p, forced traffic/tree −2.9%p, forced collapse/gasblast −2.3%p. The count of successful fires barely changes; the new spread fires (usually failed or partial, born while the source holds the engines) pull the rate down. Lowering K to 0.85e-4 did not help (hard fire success went to 27.5%, i.e. noise or step effects). Left for b5 and the post-N9 fire balance per the user's decision.
- knownBuildingAt cannot distinguish two same-kind buildings at one intersection. It has no consumer now; whoever adds one (I2, L7 label) must handle this.
- hazard.natural in normal 60 is 32 (target 15–40). Once the remaining laws (L3, L7, L5, L4) are added, b5 should look at ROAD.A first, as h2 noted.
- The analyst's 'big fire' only counts incidents with fieldRisk set. That field is only set when a field report carries a collapse, explosion or burnout, so a big fire with no X6 event does not trigger '연소 확대'. This follows the design text.
- For b3-8c: the ember term should call hazardImpulse(sim, 'heatSpread', neighbour, ΔH, {ev: sig.ev, inc: sig.inc, what: 'ember', ref}). The target conditions are currently inline in heat.ts heatTargets and should be extracted so both paths share them.
- The fire balance sensitivity may need re-checking once L3 adds wear and leaking valves.
- Known H1 loop unchanged: extreme S12 #14 repeats the treatMate order 80 times (repeat max 80).
- In the normal 40-seed gate output, the variety metric listed traffic/tree under 'flat'. This is report-only; the 60-shift run shows no flat scenario.
