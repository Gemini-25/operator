# I2 문서 단계 (화면 확인·최종 요약과 문서) — 작업자의 보고

워크플로 `docs/specs/workflows/package-run.js` 의 작업자(`docs:persist`) 보고를 그대로 옮겼다. 끝 커밋 `b7d100fbc8fe82f660287053d50cab02332b367f`(브랜치 `wf/persist-docs`), 관문 통과(`checkPassed: true`).

정본은 그 묶음 설계서 끝의 "구현 메모"다. 보고 속의 scratchpad 경로(`/tmp/…/scratchpad/wf-*/`)는 그 세션의 컨테이너에만 있다 — 기준 수치는 구현 메모의 방법으로 다시 잰다.


## 끝낸 것

- Stage 8 screen check (§5.6), redone on the final code (src = 730d9ea) at 1600x900 on port 5232 with Playwright. I reused the stage 6–7 scripts. Covered: first screen with no saved org and the 'new org' chip; ending a shift by dragging the time bar to the end saves ar.org.v1 (shift 2) and adds history entry #1; the report's org section; 'next shift (continue)' gives the 'org #2' chip, the first log lines and 'in maintenance · n min' in the unit list; the difficulty panel's org row in three states (saved, none, unreadable in a new window); a window with storage blocked still continues to org #2 inside that window; map traces after the quake state at small, mid and large scale; three mouse-over texts; the fire scene in a sooted building; the legend; the org section of a carried-over shift's report; the off-crew agent panel. Console errors were 0 in every script and there was nothing to fix (no overlap, clipping or text markers).
- npm run ui-check: all 9 checks passed in 156 s. Check 9: org #2, 2 off crew = 2 off dots, tick-22 hash matches headless.
- Stage 8 balance, final check (doc stage). The results below are identical to the R3b final numbers to the last digit, as expected since shifts without carry are unchanged. Normal 60, easy 60, hard 60 and extreme 60 match exactly. Hard 40 --check and extreme 40 --check passed (stall candidates are the same as before: hard 0, extreme 1). The metrics in the gate's sweep 40 --check were stall 0, forgotten 0, C1–C5 0, holes 0. Time per shift, measured against base 19a7e68 alternating twice: no difference. chain.ts 24 8 --check passed, giving the same table as stage 8 and the review. chain 12 8 --diff hard --paired gives the same table. Forced runs with a carried state: 7 scenarios × 20 shifts, run with and without the carry.
- Docs: added the final summary at the end of docs/specs/I2-persistence.md. It covers what went in, a table of real names later bundles must use, the 12 places that differ from the design, measured numbers, a check against the completion conditions, the gates, and 15 known issues. I also added an implementation-status line at the top of the spec and dropped '(진행 중)' from the memo heading.
- docs/specs/README.md: I2 row in the status table set to implemented; '7 | I2 — 끝남' in the build-order table; added a paragraph 'I2 가 끝난 뒤의 확인' giving the real names N8 and N9 depend on (placeUsable lives in placeUse.ts; roadsNext is a non-exported function inside persist.ts); marked I2 done in the chunk table; updated the source-of-truth table entry.
- N8-incident-kinds.md and N9-major-kinds.md: added an 'I2 가 끝났다' notice at the top of each with the real names and five things to know, and updated the I2 row in each handover table.
- CLAUDE.md: everything §10.3 asks for — command table (chain.ts 24 8 --check, sweep --carry, ui-check 9), test counts (1069 total, persistence 87, causality 64), reproducibility line, information-isolation line, structure entries (persist.ts, placeUse.ts, carryLayer.ts, chain.ts), extension-table row, nine pitfalls, and an update to the existing placeGone pitfall.
- README.md: new 'shifts carry over' feature bullet; controls (org row, org chip, report buttons); screen layout; storage; conditions; a feature bullet for persistence across shifts; tools; known issues (replaced 'no experience/skill change' with the I2 limits); test results (1069 tests, ui-check 9, chain results).
- docs/ROADMAP.md: current state (test count, ui-check 9, an I2 bullet, and a baseline line 'after I2'); in progress (I2 done, next bundle N8); K1 moved out of next bundles and new item W1 'world state carried across shifts' added; M2 (1) updated; I2 and K1 line added to completed bundles.
- docs/handover/README.md: updated the at-a-glance table (current bundle I2 done, next N8, test count) and the I2 rows in sections 1 and 4.
- Final gate on the final commit: npx tsc --noEmit passed; npm run check passed (20 files, 1069 tests passed, 0 skipped, 628 s, sweep 40 --check '검증 통과'). Before the doc commits I also ran npm run check on the review commit's code (1069 passed, 712 s). That closes the review's unconfirmed gate.

## 하지 못한 것

- No code was changed, because the screen check found nothing to fix. Last code = 730d9ea.
- §11.1-7 (switching ruin to closed for building kinds with few members) was not done and not measured, same as stage 8.
- Did not commit a separate npx vitest run. npm run check runs tsc --noEmit && vitest run && sweep 40 --check, so the full vitest ran inside it (1069 passed).
- Nothing pushed and no PR created, as instructed.

## 설계서와 다르게 한 곳

- The spec puts placeUsable in persist.ts. It is actually in the new leaf module src/sim/placeUse.ts, which imports types only, and persist.ts re-exports it. roadsNext(sim, rng) exists but is internal to persist.ts and not exported. Both are recorded in the final summary, the specs README and the N8/N9 notices.
- ROAD_WHY, which N9 asks about, is an internal constant in persist.ts. All eight why values are present: crack, washout, flood, fire, mud, tree, debris, surface.
- Instead of committing an 'npx vitest run' step separately, I relied on npm run check, which includes it.
- Forced runs: the spec names no specific forced set for stage 8. I used the stage 5 set of seven scenarios (fire/std, collapse/std, hazmat/std, armed/kidnap, fire/arson, armed/riot, collapse/gasblast) × 20 shifts, with sweep --carry fed the state after the quake shift (C0.1), plus the same runs without carry as a control.
- I also updated docs/handover/README.md (allowed for the doc stage) and added a new ROADMAP item 'W1 세계 상태의 교대 간 지속' (spec header says 8 must add one).

## 설계서 밖의 공용 파일을 고친 곳

- None outside documentation. Files changed: CLAUDE.md, README.md, docs/ROADMAP.md, docs/specs/README.md, docs/specs/I2-persistence.md, docs/specs/N8-incident-kinds.md, docs/specs/N9-major-kinds.md, docs/handover/README.md. Every one is a file the doc stage is allowed to edit.

## 결과

Final numbers, as written in the docs:

**Shifts without a carried state: results unchanged (identical to R3b)**
- Normal 60: 881 incidents, 636 success (72%), success + delayed 77.8%.
- Easy / normal / hard / extreme (seeds 60):
  - success + delayed: 87.9 / 77.8 / 63.0 / 39.9%
  - success: 590 / 636 / 586 / 366
  - timeout · abandoned · no response · shift end: 1·2·0·0 / 1·2·0·0 / 7·14·2·1 / 40·26·15·14
  - responders hurt per shift: 0.08 / 0.33 / 0.63 / 1.60
- Normal 60 success by type: fire 95/177, armed 94/132, water 28/37, hazmat 47/63, traffic 141/191, collapse 52/69, medical 88/114, search 91/98.
- Metrics in the gate's sweep 40 --check: 590 incidents, stall 0, forgotten 0, C1–C5 0, holes 0, depth ≤ 2, spread ≥ 3 is 7, repeat max 5. Passed.
- hard 40 --check passed: 737 incidents (resolved 722, timeout 5, no response 2, abandoned 7, shift end 1).
- extreme 40 --check passed: 903 incidents (resolved 832, timeout 29, no response 12, abandoned 20, shift end 10, 1 stall candidate at 406 s, pre-existing).
- Time per shift, sweep 20 --no-metrics alternating base 19a7e68 vs head: base 792 and 818 ms, head 766 and 760 ms. User CPU: base 31.4 and 31.5 s, head 30.3 and 30.2 s. No difference, and all output except the time line is identical.

**chain.ts 24 8 --check (normal): passed in 305 s**
- 192 shifts, 2831 incidents.
- Exceptions 0, unfinished incidents 0, round-trip failures 0.
- Timeout + no response + abandoned: 0.5%.
- Spiral check (success + delayed): shifts 1–2 at 83%, shifts 6–8 at 80% (Δ −3.3 pp, SE 2.5, limit ±8.0).
- Paired difference vs the same seed started fresh: −1.0 pp (SE 0.7).
- Shift 8: off 0.21, maintenance 0.92, closed 1.92, ruin 1.17, traces 3.79, repair roads 0.42, top experience +0.095.
- Stall: 1 candidate in carried shifts vs 1 in the control; forgotten 0.
- Quake recovery:
  - repair roads 5.92 → 0.17
  - absent crew 0.67 → 0.17 (shift 5)
  - closed + ruin 8.42 → 4.17 (limit ≤ 4.21)

**chain 12 8 --diff hard --paired**
- Paired difference −5.0 pp (SE 1.4).
- Δ −5.3 pp.
- Timeout etc. 2.2%.
- Extreme −4.4 pp (from the review).

**Forced runs, carried state (C0.1, post-quake) vs no carry, 7 scenarios × 20 shifts**
- Incidents in the whole shift: 2321 vs 2221.
- Timeout: 40 vs 24.
- No response 10 vs 6, abandoned 13 vs 15.
- Timeout/abandoned for the forced scenario itself: 0–1 per scenario in both runs; kidnap abandoned 12 vs 14 (lost pursuits, same in the control).
- Success for that scenario:
  - fire/std 21 vs 33
  - fire/arson 10 vs 22
  - hazmat 24 vs 33
  - Cause: two pumpers in maintenance at shift start plus 6 repair roads.

**Gate on the final code**
- npm run check passed: 1069 tests in 20 files, 628 s.
- ui-check: 9/9 passed.
- Screen check: console errors 0.

**Screenshots I looked at** (all in /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-persist/docs/shots/):
- 03-report.png
- 04-continued.png
- 08-diff-bad.png
- 20-map-big.png
- 20-map-small.png
- 20-hover-road.png
- 20-scene-soot.png
- 22-ui-legend.png
- 31-report-carry.png
- 32-agent-off.png
- Others in the same folder: 01, 02, 03b, 05, 06, 07, 09, 10, 20-hover-closed, 20-hover-marked, 20-map-mid, 21, 22b, 30, 31b.
- ui-check screenshots: /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-persist/docs/ui-check/carry.png and report.png.

Logs and measurements are in /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-persist/docs/bal/ and docs/check1.log, check2.log.

## 알려진 문제 · 다음 작업자가 알아야 할 것

- On hard and extreme, a carried state lowers success + delayed by 4–5 pp versus starting fresh. The effect is spread across many parts, so no knob was turned (user decision: failure is also a result). If it needs changing, start with §6.4-4 (SERVICE_CAP and maintenance time).
- Quake-recovery criterion 6 has a thin margin (4.17 ≤ 4.21). If constants change again, this line is the first to break.
- Report wording, found in the doc stage: X6's summary ('m곳이 무너졌습니다') counts only total collapses, while I2's 'next shift · 무너짐' also counts collapse scenes with rubble ≥ 0.22. Both '0곳이 무너졌습니다' and '무너짐 1' can appear in the same report (new-org shift HRTA2A). Aligning them changes hashes, so it is the user's call.
- Soot effect depends on fire size. Small fires burn a slightly higher share (+0.005 to +0.008); flipping that requires changing the property-damage denominator, a user call. Pre-burnt tiles still count toward X6's region burn share and regionBurning.
- Pumps get slightly better as shifts continue (0.66 → 0.77). Growth is below target: +0.095 after 8 shifts.
- The flashbang stock cap of 10 is smaller than the quota sum at equipment 4–5 with unit size ≥ 4 (outside the presets).
- A fallen-tree incident overwrites a 'repair' closure (createIncident's tree branch does not check e.closed). Rare.
- '결원 부대가 나간 사건 n건' also counts units whose seats were fully filled by relief crew.
- End-of-shift world.expo, hospital occupancy and zone values are not carried. Recorded as new ROADMAP item W1.
- Stall candidates appear about once per 200 shifts even without a carried state, from earlier bundles. chain.ts compares against the control run.
- Next workers: N8 should measure its stage-0 baseline after I2 is merged into the main branch; the values should equal R3b's. Before using roadsNext or placeUsable, read the 'I2 가 끝났다' notice at the top of N8/N9 and the final summary in I2-persistence.md.
