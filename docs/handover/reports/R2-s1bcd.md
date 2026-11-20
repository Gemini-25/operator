# R2 단계 1b·1c·1d (헤엄·보트·그림) — 덩어리 작업자의 보고

워크플로 package-run.js 의 구현 덩어리 보고를 그대로 옮겼다(브랜치 wf/methods-s1bcd (wf/methods moved to the same commit), 마지막 커밋 1cd09b4, 관문 통과). 정본은 docs/specs/R2-methods.md 끝의 구현 메모다.

## 끝낸 것

- 1b (6cb6ce0): base for agents on the water. executor.costFor uses swimCost (water tiles cost 2.2) and still builds agentCost once per call. moveSpeed has water speeds (swimming / rigid boat 3.0 / raft 2.2). executor.act calls waterTick: current drift, stamina drain, drown damage held at an 18-health floor, mishap roll on mrng, plus three forced mishaps. New case 'ashore'. pullAshore is the last-resort safety. finishTask drops a casualty carried out of the water via dropWet. brain guard sits right after the boardOrder block. fitFor guard: an agent on the water only keeps its current waterRescue. rules/methods runs on all scenes: a downed agent on water is moved to the bank next tick, and the boat flag is cleared on land.
- 1b: swim turned on (runSwim: walk to bank, prep, swim out, grab, tow back), tend turned on (runTend), and the clutch rule (clutchP). After a mishap the swim attempt is folded (METHOD_FAIL), the task is dropped, the agent goes ashore, and swim and boat are remembered in a.mfail for 60 s on that target. waitCarried switches a rope holder to tend when a swimmer is towing the target. swimTrouble is exported. TaskKind 'ashore' added. gear.hoistOver added.
- 1c (c63df49): boat turned on (raft or the rescue boat crew via altUnit, one boat per unit). runBoat: walk to launch point, kitWorks(raft), launch 8 s (rescue boat) or 14 s (raft), move onto a neighbouring water tile with afloat set, approach, haul aboard, dock beside the land tile with range 1.5, land. boatCost added. Capsize roll in waterTick (boatCapsize). rules/air.ts: the hoist hovers and waits while a swimmer or boat is towing its target. IMPROVISE_MUL constant added, value kept at the spec's 0.7.
- 1d (78b7240, view only): new src/view/scene/methodsLayer.ts. drawMethodFx draws the rope (red throw bag at the end, flies out after release, pulled back while rewinding), the life ring, the improvised line (dashed brown with a white jug), the hooked pole and the tend line to the swimmer. drawBoats draws an orange raft (1.4×0.7 tiles) or a grey rigid hull for the rescue boat (1.8×0.8). renderScene: the rescue-rope block is now one drawMethodFx call, boats are drawn before people, a hauled casualty lies inside the boat, swimming responders use drawSwimmer (helmet off, orange vest if they have a PFD), agents in a boat sit, and agentPose checks the method first. sprites: ArmPose reach/hold, Item rope/ring/pole/cloth, and a vest option on drawSwimmer.
- Tests in tests/methods.test.ts went from 62 to 88. 1b: swim conditions and scores, swimTrouble/clutchP, swim and tend scenes, team switch, tired/crisis/clutch mishaps, 18 floor, 150 s pull-ashore, downed-agent safety, guards, dropWet, and forced shifts checked every tick. 1c: two boat scenes as in §8.3 (rescue boat crew and roped tech with raft; on water and afloat at the launch tick, on land with no boat flag after landing), boatCost, one boat per unit, hidden raft fault, capsize, boat ashore, hoist waiting, boat successes in tsunami shifts. 1d: draw functions are read-only, and the view file does not call judgment or execution functions. The 1a tests were updated for the newly live rows.
- Implementation memo (1cd09b4): sections for 1b, 1c and 1d added at the end of docs/specs/R2-methods.md (actual names, places that differ from the spec, out-of-spec edits, numbers, known issues, gates). Screenshots checked by eye: swimmer, tend, rope, pole, improvise, rescue boat, towing at night.

## 못 한 것

- The §6 target 'more bare-hand and swim methods at unit size 1' was not proven. The size-1 water run has 9 method kinds, with swim 10 and hand 15, but nothing was compared side by side.
- Nothing from steps 2 onward (doors and charge, extrication and detection, fire, armed, EMS/gas) was done, as assigned. The R3 row S15 that will remove swim's hoist ×0.7 is not merged yet, so the ×0.7 is still in place.
- No hand-off (relief) between rescuers on waterRescue was added, like RELIEF_GAP for extrication. It is outside the spec, and the 1a issue still stands.

## 설계와 다르게 한 곳

- swim.can also requires that no mate is already swimming to the same target (one swimmer per target). §4.1 says a no-rope agent next to a swimming mate is left with only hand/pole; without this rule two agents jumped in for one person. For swim, the condition-loss text is '동료가 헤엄쳐 들어감'.
- costFor uses swim cost only from swim phase ≥ 2 (in the water), not whenever t.method === 'swim'. Otherwise agents swam across the river while walking to the entry point.
- The entry point and the tend spot are chosen once, using the unused Task.range field as a marker. applyPick resets t.range to 0.
- The 'crisis' (health < 30) and 'swept' forced mishaps apply only during a swim rescue. 'Tired' applies to every agent on the water, once per entry (wetTired). Ashore and board get only the random roll and tired, with separate short texts. Texts for the not-towing case were added. METHOD_FAIL detail is '헤엄 구조 중 …'. The injury ev is the fold event id.
- After the incident closes, waterTick applies only drift and stamina: no damage, mishaps or logs.
- If the gap opens past 1.4 tiles while grabbing (phase 3), the swimmer swims again (back to phase 2).
- The tend switch for a carried target happens only when the carrier is swimming (not a boat). A waiting agent on the water drops its task.
- A thrower who loses the condition because a mate swims, and has no method left, finishes with preempt (no work fail counted) instead of nomethod.
- If an agent on the water holds a method it cannot do from the water, it drops the task and the brain guard sends it ashore. Swim phase 2 no path: tooFar with no next method, then finish(nopath). Phase 4 no path: drop the casualty, then the same.
- The rules/methods safety loop runs on every scene, before the water-scene early return (search scenes have streams). Only downed agents and agents in a boat have their tile checked.
- pullAshore keeps the spec signature, but the why argument is not logged. dropWet for a dead casualty on land only lays them down, with no completion record. The brain guard writes one candidate line for the panel.
- 1c: a boat haul-aboard line was added ('구조 대상 X를 보트에 끌어올렸습니다. 물가로 돌아갑니다.'). Capsize does no damage. Capsize detail is '보트 구조 중 보트 전복', and swim is also remembered. Phase 3 no path recomputes the nearest land once. If afloat is cleared during phase ≥ 1, the task is dropped. Boats cannot pass under bridges, because bridge tiles are land in boatCost.
- rules/air.ts: while waiting on a carried target, the heli hovers and op.progress decays, the same as when the target is out of reach.
- rules/methods also clears afloat for agents that have left (boat retreat via case 'board' no path).
- 1d: Item 'cloth' was added. The spec table says none, but G5's 'throw' draws a flashbang canister when the hand is empty. The boat is drawn in methodsLayer.drawBoats, because sprites.drawBoat already exists as the map vehicle. After release, all three throw methods use the hold+rope pose. The view checks swimming by tile instead of calling methods.onWater.
- Real names that differ from §3.5: dropWet (the finishTask drop), landed (one place for the completion record), clutchP, and the constants SWIM, TEND_RANGE, WATER_FLOOR, SWIM_HURT, BOAT, SWIM_MIN, SWIM_MIN_PFD, SWIM_COST and IMPROVISE_MUL. hoistOver lives in gear.ts (the judgment layer), because methods.ts cannot import crews.

## 설계서 밖에서 고친 공용 파일

- src/sim/field/brain.ts, think, step 7 (self-initiated work): an agent doing a waterRescue no longer moves itself onto other nearby work (another water rescue or a carry). The continue score and the nearby-work score were close, so judgment noise alone made agents flip between tasks and re-announce their method each time. In tsunami S7 one agent did this 8 times about every 2 s. The loop already existed in 1a and 1b. Commander orders are still accepted.
- src/sim/field/gear.ts: hoistOver(sim, s) added to the judgment layer. methods.ts needs 'heli with hoist overhead' and may not import crews.ts.
- tests/methods.test.ts: the 1a tests were adjusted, because swim, tend and boat are now live (LIVE list, reach rows include swim and boat, weak-target missing kit is 'raft', non-swimmers use noSwim).

## 알려진 문제 — 다음 작업자가 알아야 할 것

- For weak targets the top method ignoring kits is the boat, so rope-less agents often say '구조용 고무보트가 없습니다. …'. This follows the spec's noGear definition.
- Boats cannot pass under bridges; a target beyond a bridge folds with no path.
- Responder drown damage is gentle: RESPONDER_HURT per water incident is 0 against a target of ≤ 0.15. Raise SWIM_HURT if that is too lenient.
- In ship fires, improvise folds repeatedly under fast current with weak targets: 56 METHOD_FAIL in 60 shifts, one radio line each. The success rate is within target, and IMPROVISE_MUL is the knob.
- A tender has no ok row in I.methods (the swimmer lands the casualty), so the report only shows the swimmer's sentence.
- The pole line is thin at the default zoom.
- When R3 is merged, delete swim's 'hoist overhead ×0.7' (R3 S15 replaces it).
- Still open from 1a: no rescuer hand-off on waterRescue.
- Units left onscene at a closed incident at shift end happen only for the last incident, which closes at the end tick. Baseline has the same; the test only checks incidents closed 90 s or more before the end.
- Names for later steps: methodRun.landed/dropWet/waterTick/pullAshore/swimTrouble/clutchP/BOAT/SWIM/WATER_FLOOR/IMPROVISE_MUL, methods.swimCost/boatCost, executor.costFor, view/scene/methodsLayer.drawMethodFx/drawBoats/THROW_RELEASE. Step 2 adds its door/charge drawings to methodsLayer and its poses to agentPose's method branch.

## 수치

["Water success counts success + delayed. Baseline e0d7376 → 1a → 1c:", "- Normal 60, water/std: 83.8% → 78.4% → 86.5%. Overall good 83 → 82 → 82%, timeout 1 → 1 → 1.", "- Easy: 84.2% → 86.1%. Hard: 71.4% → 62.5% → 73.2%. Extreme: 67.1% → 53.6% → 63.8% (−3.3%p).", "- Forced water/std 20 shifts: 76.7% → 73.3% → 80.0%, timeout 0, responder hurt 0 per incident, killed 0.", "- Tsunami 20: water/std 62.5% → 53.8% → 63.8%; water/evac 44 → 39 → 44.", "- Forced fire/ship 20: 52.4% → 42.9% → 42.9%. This is sampling noise: at 60 shifts (62 incidents) it is 67.7% → 66.1%, −1.6%p, which meets ±5. With IMPROVISE_MUL 0.85 the success is also 66.1% and only the method failures fall (56 → 28), so the spec value 0.7 was kept.", "Diversity: forced water/std has 46 rescues, 8 kinds (swim 14, hand 7, rope 7, improvise 6, pole 5, hoist 4, boat 2, catch 1), top share 30%. Ship has 4 kinds, hand 0. Tsunami has 127 rescues, 8 kinds, 10 by boat.", "METHOD_FAIL: normal water 36 → 11; tsunami water/std 106 → 22.", "Size-1 / equipment-1 water runs: good 67% / 69% → 66% / 69%.", "1d is view-only: report.hash for 26 shifts (normal 10, water 8, ship 4, tsunami 4) matches 1c exactly, and sweep 60 --scen --methods output matches 1c line for line.", "npm run check passed at every code commit: 1b 719 tests + 1 skipped, 1c 728 + 1, 1d 730 + 1; sweep 40 --check '검증 통과' each time. ui-check all passed with 0 console errors."]
