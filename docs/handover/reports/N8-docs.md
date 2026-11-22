# N8 문서 단계 — 작업자의 보고

워크플로 `docs/specs/workflows/package-run.js` 의 작업자(`docs:kinds`) 보고를 그대로 옮겼다. 끝 커밋 `b4f560e`(브랜치 `wf/kinds-docs (pointer wf/kinds moved to the same commit)`), 관문 **통과하지 못함**(`checkPassed: false`).

정본은 그 묶음 설계서 끝의 "구현 메모"다. 보고 속의 scratchpad 경로(`/tmp/…/scratchpad/wf-*/`)는 그 세션의 컨테이너에만 있다 — 기준 수치는 구현 메모의 방법으로 다시 잰다.


## 끝낸 것

- Stage 11 screen check, commit 192d563. Ran a dev server on port 5236 at 1600×900 with Playwright and looked at the scenes of the five new types myself: utility/wire, animal/boar, disturb/brawl, welfare/ledge and rescue/facade, all seed S1 and forced. I also checked their map pins and cards (forced utility/sign, animal/hive, disturb/rowdy, welfare/lostchild and rescue/pit, seed S2; card titles are the type names, card: false) and the opened legend: the 13 type pin samples, the civil group and the 유관 기관 기사 role. Console errors 0 and warnings 0 everywhere.
- Added `--force <type/variant>`, `--diff` and `--port` to scripts/screenshot.cjs, as spec §5.12 asks. It also takes the five new type names and reports the console warning count.
- One screen fix, view only: the arrest handcuff icon (G5 combat.drawCuffs) sat 0.9 tiles above the head and covered the '· 검거' text on suspect pills when several people were arrested in a disturb scene. Raised it to 1.4 tiles, the same height R3 used for the negotiation bubble. The 153-condition hash list is identical to the review end (52d57e6), so results are unchanged.
- `npm run ui-check`: everything passed in 146.7 s. Console errors 0, 59 rewind samples match headless, the end-of-shift report hash matches headless, and the carried-over state (item 9) matches.
- §7.1 final balance check on the last code: normal 120 (--json), normal 60 (text), easy/hard/extreme 60, `sweep 40 --metrics`, forced 20 × 35 rows (24 new scenarios, 9 non-emergency, traffic/std, hazmat/std), and hard/extreme/normal 40 `--check` (all exit 0). All values equal the stage 11 balance work or differ only by what the review's airFit fix moved. I turned no further knobs: s11b already used §7.3 ①–⑦ and the rest are user decisions.
- Implementation memo at the end of the spec, commit b4f560e. Added a 'docs stage' section (screen check and balance) and a 'final summary': what went in; the real-name table N9 needs, with present/different/absent for every name on row 9 of the README implementation-order table; the big design changes; measured numbers; completion-condition check; gates; known issues; and four questions for the user. The status line at the head of the spec now says implemented.
- docs/specs/README.md: N8 status set to implemented, implementation-order row 8 marked done, the runUntilClosed note on row 9, the chunk table, the canonical-name table, and an 'after N8' paragraph. Added an 'N8 is done' notice with the real names at the head of the N9 spec.
- CLAUDE.md: test count, the kinds test group, the `kinds:` sweep line, screenshot `--force`, the N8 files in the structure section, an info-isolation line for N8, the extension table (new incident type, new unit type for civil, new work kind, new scenario), and 22 pitfalls: the §11 list plus ones hit during implementation (LEDGE.swing, zoneScene, METHOD['window'], towHand, cordon after an arrest, airFit reportedPrev, handcuff position).
- README.md: 13 types, the everyday and non-emergency events, five fields with 27 teams, feature list, difficulty and preset tables, known issues, and test results (normal 60 table and per-type rates).
- docs/ROADMAP.md: current state, a new 'after N8' baseline entry, in-progress updated to N8 done with N9 next, and an N8 line under completed bundles with remaining candidates.
- docs/DESIGN.md §5 and §6: new types and units, plus the deferred-items list split into done in N8, handed to N9, and still missing. docs/handover/README.md: §0, §1, §4 marks N8 done, and §5 has four N8 question rows.

## 하지 못한 것

- `npm run check` does not pass. Vitest is 1137 of 1139, and the two failures are the known ones; thresholds and seeds are untouched, as instructed.
- tests/crews.test.ts ⑤ 'rescue done by hydraulic rescuers': 1221 / 1377 = 0.470 against the 0.5 threshold. The review traced it: a wide sample was already 0.45–0.48 at the N8 stage-0 base, and the drop in forced shifts comes from ambulance shortage caused by the short events (0.480 with short events off). The levers are one more general ambulance, or R1's hand-over rule or R3's pair rule. Those are user or other-bundle decisions, so I left the test failing.
- tests/sim.test.ts 'false and mistaken calls end with a check dispatch': fails at normal S7 #13. It is not a loop or deadlock: dispatch diversion plus the 330-second no-response closure in a shift where every pump unit was busy. Fixing it means changing dispatch diversion or the no-response rule, which apply to all incidents, so I left it.
- Targets in §7.1 that were not met, left as user decisions: ground ambulance 0-time +8.9%p (target +5), CALL_QUEUE +13.1%p, timeout+abandoned +6 per 120 shifts, tow truck utilisation 40% (target 8–30%), short events 4.25 per shift (spec 5.0 ± 0.5), most forced-20 L/M bands above their upper end, and four scenarios with no failure or partial at all (water main, dementia, lost child, overdose).
- Per-shift compute time was not re-measured: other bundles were running (load 5–8). The stage 11 numbers stand (+27% per shift, user CPU +23%).
- R3 doctrine rows N01–N17 were never added during implementation. I documented this but did not implement them; that would be stage 4–9 work, not docs.

## 설계서와 다르게 한 곳

- scripts/screenshot.cjs: besides the `--force` that §5.12 asks for, I added `--diff` and `--port` (default 5173). The dev server for this bundle runs on 5236.
- Screen fix in src/view/scene/combat.ts drawCuffs: the spec's screen section does not mention it. It is the overlap I found during the check (handcuff icon over the suspect pill), fixed by following R3 stage 8's precedent of putting the negotiation bubble at 1.4 tiles.
- Real-name table: `runUntilClosed` differs from §9.1. It is not exported and lives inside tests/kinds.test.ts with signature `(sim, pick: (I) => boolean, cap = 6000)`, not `(sim, id, cap)`. R3 `registerDoctrine` exists, but N8's rows N01–N17 do not; field/doctrine/kinds.ts is an empty file and doctrine/index.ts does not import it. Every other name on README row 9 exists under that name. airFit was widened by the review: `I.reportedPrev` now zeroes medical and fire helicopters.
- Balance numbers come from normal 120 for the main table (same as s11b) and normal 60 for README's 60-seed table: 81.7% success+delay over 1,134 incidents. Baseline is the N8 stage-0 copy in $S/s03/base.

## 설계서 밖의 공용 파일을 고친 곳

- src/view/scene/combat.ts · drawCuffs: handcuff icon raised from 0.9 to 1.4 tiles above the head so it no longer covers the suspect pill text (G5 file, view only, results unchanged).
- scripts/screenshot.cjs · whole file: added `--force`, `--diff` and `--port` options and warning counts (the spec asks for --force; the rest is for convenience).
- docs/handover/README.md · §0 '바로 이어서 할 일', §1 N8 row, §4 N8 row, §5 rows for the four N8 questions: the docs-stage worker updates the handover.

## 결과

Final numbers (last code = src of 52d57e6; my commits add a view fix and docs only; hash list 153 = $S/review/hash-now.txt, diff 0).
- **Normal 120** (base = N8 stage 0 → final):
  - incidents per shift: 14.67 → 19.09 (regular draw 14.08 → 14.20; short events 0 → 4.25)
  - success+delay: 79.2 → 80.6%; fail+unresolved: 9.8 → 8.6%
  - timeout · abandoned · no response: 2·5·0 → 4·9·1
  - average response: 52 → 58 s; non-emergency: 3.7 → 6.8%
  - per shift: types 6.42 → 9.45, scenarios 10.22 → 14.74, new-type incidents 4.22; repeats 30.3 → 22.8%
  - short-event scene time median: 63 s
  - utilisation: police 26%, fire 42%, EMS 58 → 64%, civil 15%; ground ambulance 0-time 34.9 → 43.8%
  - NO_UNIT 25.6 → 28.4%; CALL_QUEUE 9.7 → 22.8%; mutual aid 1.69 → 2.09 per shift
- **Normal 60** (README table): 1,134 incidents. Success 73%, partial 10%, delay 8%, fail 7%, unresolved 1%; success+delay 81.7% (base 77.8%). Success by type:
  - fire 55%, traffic 75%, armed 76%, medical 73%, search 90%, collapse 73%, hazmat 72%, water 71%
  - new types: disturb 71%, welfare 80%, utility 80%, animal 86%, rescue 91%
- **Presets, 60 shifts** (success+delay):
  - easy 86.6%, normal 80.6%, hard 62.5% (25·21·10), extreme 45.2% (67·46·42) — order holds
  - short events per shift 3.05 · 4.25 · 6.55 · 8.80
- **Metrics, normal 40**: 759 incidents, deadlock candidates 0, forgotten 0, C1–C5 0, ledger holes 0, law incidents 28, max chain depth 2, max 4 chains per shift, max repeat 12.
- **Forced 20 × 35 rows**: identical to the stage 11 table, line for line. New scenarios: timeout/no-response/abandoned total 6, deadlock candidates total 5. Non-emergency rows: 0 failures. traffic/std and hazmat/std: 0 timeouts.
- **Gates**:
  - tsc passes
  - vitest 1137 of 1139: crews ⑤ at 0.470 and sim false/mistaken call at normal S7 #13 still fail; `npm run check` took 937 s and stopped at vitest
  - `sweep 40 --check` passes (759 · timeout 2 · no response 1 · abandoned 2)
  - hard 40 `--check` passes (1016 · 18 · 9 · 15)
  - extreme 40 `--check` passes (1293 · 47 · 29 · 27)
  - `npm run ui-check` all passed in 146.7 s
- **Screenshots I looked at**, all under /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-kinds/docs/shots/:
  - scenes: utility-wire-S1-1.png, utility-wire-S1-3.png, animal-boar-S1-2.png, disturb-brawl-S1-2.png, welfare-ledge-S1-3.png, rescue-facade-S1-3.png
  - crops: crop-brawl.png, crop-ledge2.png
  - pins and cards: pin-utility-sign-S2.png, pin-animal-hive-S2.png, pins3.png, cards-all.png
  - city and legend: city-S5.png, legend-S5.png, legend-part2.png, legend-part3.png
- ui-check screenshots: /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-kinds/docs/uicheck/
- Measurement files: /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-kinds/docs/ — F-normal120.json, F-normal60.txt, F-easy60.json, F-hard60.json, F-extreme60.json, F-metrics40.txt, F-normal40check.txt, F-hard40check.txt, F-extreme40check.txt, f20.txt, hash-docs.txt, check-final.log, uicheck.log
- Docs written: /home/user/operator/.claude/worktrees/wf_e3e767a9-339-4/docs/specs/N8-incident-kinds.md (end of the implementation memo), plus docs/specs/README.md, docs/specs/N9-major-kinds.md, CLAUDE.md, README.md, docs/ROADMAP.md, docs/DESIGN.md and docs/handover/README.md.

## 알려진 문제 · 다음 작업자가 알아야 할 것

- Two tests still fail, so `npm run check` stops at vitest: crews ⑤ and sim 'false and mistaken calls' (normal S7 #13). The main session should expect exactly these two after merging and look only for anything new. They wait on the user's answers to the four questions now in handover §5: one general ambulance, two tow trucks or narrower tow demand, a second call-taker line, and how to handle the failing tests.
- When I checked the screen, a forced drunk disturbance (disturb/rowdy) and a forced beehive (animal/hive) at seed S2 got 특공1 (the tactical team) as the first unit sent: tactical units can fill police demand. Narrowing that with kindFit is a candidate fix, but it would change results.
- Outside N8: when a back street branches off another back street, the junction name repeats ('한솔3로 2길 2길 2길', from addLocalStreets in city.ts, a file this bundle must not touch). It shows on cards for short events at those junctions. Also, the pause banner covers the pin at the map centre right after '지도에서 보기'.
- When dispatch sends a fire or medical helicopter before it knows the incident is a chase, there is no way to recall it (normal S20).
- From the earlier stages: repeated fine searches for the dementia case (normal 60 S26 #11), the paired rescuer's outdoor treatment being cut off by the partner going inside, and 2 deadlock candidates in normal 120 (40 at the gate shows 0).
- Before measuring N9, re-measure the baseline on the main branch after merging N8. The figures are in the N9 head notice and in the ROADMAP 'after N8' baseline entry.
- Nothing was pushed and no PR was opened. git status is clean, wf/kinds and wf/kinds-docs both point to b4f560e, and the dev server on 5236 has been stopped.
