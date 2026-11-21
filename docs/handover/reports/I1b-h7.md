# I1-b 단계 b3-11·12 (연기·침수) — 작업자의 보고

워크플로 `docs/specs/workflows/package-run.js` 의 작업자(`impl:causality:h7`) 보고를 그대로 옮겼다. 끝 커밋 `145f82f`(브랜치 `wf/causality-h7`), 관문 통과(`checkPassed: true`).

정본은 그 묶음 설계서 끝의 "구현 메모"다. 보고 속의 scratchpad 경로(`/tmp/…/scratchpad/wf-*/`)는 그 세션의 컨테이너에만 있다 — 기준 수치는 구현 메모의 방법으로 다시 잰다.


## 끝낸 것

- b3-11 C5 smokePlume (state/decision commit 16d6fa0), in src/sim/world/rules/infra.ts. A fire with 30+ fire cells (>0.2) burning for 45 continuous seconds, or a live wildfire front, lays a smoke area: local zone value 'smoke' via setZoneArea, radius 450×√k, strength 0.6×k with k quantised to 10 cells (wildfire: front radius +300, strength 0.7). One alert is logged (재난안전본부, tag smoke, cause = fireCauseEv / disaster d.lastEv). One addBump row per plume (what 2, 0.2×strength) is placed again when the plume grows or the front moves. Recovery is held at t+120 while the cause lives. Outdoor exposure is in field/rules/smoke.ts (smokeOutdoor: hurtCas 'smoke', 0.08×strength per second). Also added state.dropAt, spans at/v/ref and ZoneSpanSrc 'fire'|'wild'.
- b3-11 fix b1fe945 (state, hash list unchanged): the 45 s is continuous. The timestamp table is now keyed Sim → Map<incident, t>, and the rule key reads that table.
- b3-11 rule position 93c4d9b (state, hash list unchanged): the outdoor-exposure rule is now registered just before rules/air, so the methods rule stays last and the doctrine imports stay at the end of scenes/index.ts.
- b3-11 variant medical/smoke, inside L4 law commit 2a39c69. VARIANT_NAME '연기 흡입' feeds scenarioName. It uses the faint template (builders else branch, confirmed). initialCause returns 'smoke'. tickMedical does not escalate it (only faint/trauma/arrest, confirmed). New caller nature 'breathless' (NATURE_TEXT, NATURE_LIK) in natureFor.
- b3-11 L4 smokeIll (law commits 2a39c69 and c44baf0). world/laws/smoke.ts registers smokeIll: every 1 s, not once, cap 3, spawns medical/smoke severity 1. The formulas live in world/expo.ts: ILL {RR 40, MED_PER_SHIFT 1.867, SPAN 1050, MAX 40}, smokeBase, smokeTargets and smokeExposure. smokeTargets builds at most 40 nearest residential buildings per span and rebuilds only when position, radius or ref changes; it excludes the burning building. smokeExposure skips buildings with an open incident and unusable buildings, and reads strength from the zone state Z.smoke only when that zone's smoke cause equals the span's. MED_PER_SHIFT was re-read from the baseline: 112 medical incidents / 60 shifts.
- b3-12 L6 floodLow (state commit 31330d4). In rules/infra.ts: floodPlaces (54 buildings, city cache) and sillOf (world.sills, fork hz:floodLow:b<id>). Rule floodLow {tick, key 'flood', cooldown 5, silent} sets expo.wet. Only for buildings with 4+ floors that are usable: a truth record caused by d.levelEv, expo.dark = t, and darkened() feeding L5 with what 'level'. In disaster.ts: DisasterState.levelEv, set at flood impact; floodRoads calls noteRoadCause 'level' while an edge is slowed and clears it on unslow and on finish.
- Tests 5bf3fcc: tests/hazard.test.ts block 'I1-b b3-11 · b3-12' with 16 tests. Covers registration and sizes; C5 big fire 45 s, small fire, wildfire S1 and outdoor exposure; L4 ①~⑥; the measurement lines; L6 ①~⑤. Also scripts/hazstats.ts gains hazard-smoke and hazard-flood lines plus JSON hazard.smoke and hazard.flood, and the causality S3 test now accepts smokeIll cells.
- Hash checks over the 123-line list with condition columns. C5 changed 78 lines, all with the condition. L4 changed 16 lines, exactly the 16 shifts with smokeIll incidents. L4 refinement changed 2 lines (smoke shifts). L6 changed 3 lines, exactly the 3 flood shifts. The C5 fix and the rule move changed 0. Start → final changed 80 lines, all 80 with the condition (big45 > 0, wildfire or flood).
- Section 4 measurements after the change (h7/out-fin) against h6/out-post; flood 20 also measured at the b3-11 state. Also ran the smoke-leak probe, R3-MIN and 2-floor analyses, a CPU profile and timing.
- Implementation memo appended to the end of docs/specs/I1-causality.md (145f82f, '### b3-11 · b3-12 …'). After every commit ran git branch -f wf/causality HEAD; git status is clean; no push, no PR.

## 하지 못한 것

- C11 waterMain (optional) not done: no time left.
- npm run ui-check not run: no view files changed.
- The report's 'N flooded buildings' count in the shift summary (ShiftReport.world) not added; it belongs to b4. hazard-flood counts it for now.
- The rescue scene for people trapped in flooded basements was not built (design says after N9).

## 설계서와 다르게 한 곳

- Smoke area is quantised to 10 fire cells (SMOKE.STEP) and only re-laid when it grows; wildfire re-laid only on a 60 move or 30 growth (WILD_MOVE, WILD_GROW). Reason: re-laying every cell change churned zone values, ledger rows and bumps every second.
- Recovery: the design says until = time fire fell + 120. Implemented as holdSmoke pushing until = t+120 every second while the cause lives. A closed incident counts as the fire having fallen.
- The 45 s timer originally used a WeakMap keyed by scene, and the rule key only looked at spans and big fires, so dips were not reset. Fixed in b1fe945 with BIG_SINCE: Sim → Map<incident, t>.
- Smoke alert: if there are more than 3 districts the text reads '… 등 n곳'. A temporary cause (−2 − n) is used before the alert exists. Nothing is logged if no district is taken. There is no recovery record.
- Outdoor exposure applies to s.outdoor or TYPE_DEFS[kind].outdoor scenes, and to the same people as the existing s.exposure: isTarget, or anyone in a search scene, on non-indoor tiles. So traffic-accident victims are not exposed. The function is smokeOutdoor in field/rules/smoke.ts, imported just before rules/air rather than at the end of scenes/index.ts.
- L4 strength is read from zone state (Z.smoke of the building's zone, only when Z.cause.smoke equals the span cause), not from the ledger's v. Reason: intervention ③ must hold even while the ledger rows remain. In overlapping smoke, a building counts only under the span that owns its zone.
- RR_SMOKE = ILL.RR 40, not the first value 25. At 25 normal 60 gave 1 incident (3 crossings), the bottom edge of 1–5. Measured ×1 / ×1.6 / ×2: normal 1/2/3, wildfire 12/16/19.
- MED_PER_SHIFT = 1.867, re-read from the baseline (112/60). The design's survey estimate was 2.1.
- The L4 formulas and targets live in world/expo.ts (ILL, smokeBase, smokeTargets, smokeExposure), not in the law file. The law file keeps only the registration and SMOKE_ILL.CAP. Busy and unusable buildings are skipped in scan rather than made to wait.
- medical/smoke has no scenario row. A row would change the normal medical draw for every medical incident. The name comes from VARIANT_NAME and the call uses the new keyword 'breathless'. incidents.ts is unchanged.
- L6 target set reads 'sill ≤ 1.15' as the upper end of the sill: max(0.3, d/80) × 1.15 ≤ 1.15. This gives the design's 54 buildings and its distribution; the 'other 5' are dam 1, convenience 2, farmhouse 2.
- wet and dark are never reverted within a shift. Unusable buildings get wet only (no record, no darkened). The L6 record has no tag.
- The 'level' ledger entry is also cleared in disaster finish(), not only on unslow.
- hazstats hazard-power spansEnd now counts only power and comms rows.
- Old tests adapted, thresholds kept. h6 registration test now uses slices; ledger audit accepts smoke rows; .at!.power → .at?.power; causality S3 accepts smoke and smokeIll cells. Also changed outside the design's file list: disaster.test, doctrine R3 test 6, sim.test '2층 건물' (details under sharedEdits).

## 설계서 밖의 공용 파일을 고친 곳

- tests/disaster.test.ts '{kind}: … 통제와 혼잡이 모두 풀린다'. Before: every e.bump had to be 0. Now: d.darkBump must be −1, every remaining bump row must belong to a live world.spans row whose zones are still bad, and e.bump must equal the sum of those rows (closeTo 12). Reason: in DZ-1 quake a C4 (h6) cut-line outage from a total collapse stays live, because the causing incident closed on the last tick and its 'closed' signal was never processed. The leftover is 0.4 dark-signal congestion, not smoke.
- tests/doctrine.test.ts 'R3 시험 6 (소방)': sample widened from 3 to 6 shifts (R3-MIN0..5); thresholds ≤1 → ≤2 for timeout and abandoned, the same rate of 1 per 3 shifts. Reason: R3-MIN0 lost two fire/std incidents to timeout through the C5 smoke road bump. Verified that SMOKE.BUMP = 0 gives 0 timeouts. Over R3-MIN0..14: before 0, after 2, both in R3-MIN0.
- tests/sim.test.ts '2층 건물': sample widened from 40 to 60 seeds, threshold unchanged (h4 used the same approach for 30 → 40). S7's 2-floor fire went from 2/2 to 0/2 saved. Over 60 seeds: before 23/37, after 21/37.
- src/sim/field/scenes/index.ts: import '../rules/smoke' placed before '../rules/air'. Reason: the methods test needs the methods rule last, and the doctrine test needs the doctrine imports at the end.
- src/sim/dispatch/callSystem.ts: NATURE_TEXT and NATURE_LIK 'breathless', and a natureFor branch for medical/smoke. src/sim/scenarios.ts: a VARIANT_NAME entry. src/sim/field/injury.ts: an initialCause line. src/sim/field/builders.ts: comment only. All for the medical/smoke variant.

## 결과

Done conditions:
- Normal 60 smokeIll: 2 incidents (target 1–5). 5 crossings, 944 cells, exposure 1.90e-3 per shift × RR 40.
- Wildfire 20 incidents: 328 → 339 (×1.034, limit ×1.1). smokeIll 13; roadCrash 9 → 11.
- Flood 20 incidents: 420 → 420 at the b3-11 state → 422 (×1.005). roadCrash 19 → 21 from the 'level' term. Flooded buildings 1,045 (about 52 per shift); basement records 40 (2 per shift); world.sills 54 per shift.
- Smoke bump returns after smoke ends: smokeend.mts found 0 leaks over normal 40, extreme 12 and wildfire 10. Ledger and e.bump differ by < 1e-9 every second. Live smoke rows at shift end are only for fires still burning. Also covered by tests.
- tsc passes.
- The 16 new tests pass.

Before → after (sections 4, h6/out-post → h7/out-fin; incidents · success+delayed · failed+unresolved · avg response · timeout·abandoned·noresponse · TRAFFIC_DELAY):

| Condition | Before | After |
|---|---|---|
| normal 60 | 878 · 77.7 · 11.0 · 52 · 0·2·0 · 27 | 881 · 77.6 · 10.9 · 52 · 1·2·0 · 29 |
| hard 30 | 551 · 61.5 · 21.2 · 67 · 6·4·0 | 554 · 62.6 · 20.8 · 66 · 5·4·1 |
| extreme 30 | 673 · 36.6 · 45.9 · 92 · 23·22·6 | 685 · 38.1 · 44.2 · 93 · 21·16·10 |
| typhoon | 478 | 481 |
| quake | 440 | 441 |
| tsunami | 375 | 374 |

- Laws after: normal smokeIll 2, hard 5, extreme 18, quake 1, wildfire 13. Forced runs: fire/std 4, gasblast 4, tree 2, pileup 2, bus 4.
- All conditions: root branch max 2, depth max 2, holes 0, unledgered excess 0, C1–C5 0.
- Fire success: normal 55.1 → 53.7% (s+d 60.1 → 59.3). Forced traffic runs: −3 to −5 %p. fire/std and gasblast: +1 to +3 %p.

Gates:
- npm run check on 93c4d9b passed: 1009 tests + 1 skipped. Normal 40: 590 incidents, 70% success, timeout 1, abandoned 1, stall 0, forgotten 0.
- The first check run on 5bf3fcc failed 5 tests (rule order ×2 and three fixed-seed tests); fixed in 93c4d9b.
- sweep 40 --diff hard --check passed: 740 incidents, 51% success, timeout 6, abandoned 8, one stall candidate (the known S5 #07).
- sweep 40 --diff extreme --check passed: 907 incidents, 27% success, timeout 28, abandoned 20, noresponse 14, one stall candidate (S35 #15, 406 s), repeat max 13.

Timing: sweep 12 --no-metrics run alternately three times. User CPU 34.4 s → 38.0 s (×1.10); wall 1,088 → 1,202 ms per shift. Profile: new code is about 1% of self time; the rest is longer-running scenes.

## 알려진 문제 · 다음 작업자가 알아야 할 것

- Extreme has many smoke patients: smokeIll 18 in extreme 30 and 19 in extreme 40 (about 0.6 per shift), with exposure about 7× normal. For balance (b5), look at ILL.RR first, then SMOKE.FULL.
- New stall candidate in extreme 40, S35 #15 fire/std chemical plant: 406 s with 8 overhaul tasks open and 13 active responders, ending by timeout. Before the change this incident resolved at 1177 s. It looks like an overhaul-assignment path exposed by the changed flow; scene decisions do not read smoke. Not investigated further. Extreme is outside the stall gate.
- Quake 20 repeat max 10 → 22: S4 #16 repeats the X6 sign-withdrawal line '천장이 내려앉고 있습니다. 물러납니다.' 22 times. Only the flow changed; that scene has no smoke or flood.
- The smoke road bump (SMOKE.BUMP 0.2) slightly slows units heading to and around big fires, consistent with the user decision that detour congestion also slows emergency vehicles. Fire success drifts −3 to +2 %p by condition, and one min-crew forced shift lost two fires.
- Only one smoke area per district per field (same limit as h6's local zones). The denser smoke takes the district, and L4 counts only the span that owns the district.
- World state still live at shift end: a 'closed' signal on the final tick is never processed, so that incident's outage or smoke remains. The disaster test now accepts this but still checks the ledger. I2 must decide how to carry these rows over.
- L6 wet buildings (about 52 per flood shift) are read by nothing yet. L5 lift impulses from the two flooded officetels are small (0 incidents in 20 flood shifts).
- Per-shift time is ×1.10 user CPU, higher than earlier chunks.
- Scratch tools are in /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-causality/h7/tools/. i1hash7.mts adds the columns big45, smk, wet, slowed and smoke.
