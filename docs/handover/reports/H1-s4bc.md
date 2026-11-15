# H1 단계 4b·4c (대원 — 후송·새 규칙) — 덩어리 작업자의 보고

워크플로 package-run.js 의 구현 덩어리 보고를 그대로 옮겼다(브랜치 wf/injuries-s4bc, 마지막 커밋 c2901a6, 관문 통과). 정본은 docs/specs/H1-injuries.md 끝의 구현 메모다.

## 끝낸 것

- Setup: branched wf/injuries-s4bc from wf/injuries (= main 9760785). Merging claude/practical-keller-xm0ac2 was a no-op because it was already up to date. Applied docs/handover/H1-4b-wip.patch with git apply --3way: no conflicts, tsc passed, 94 of 97 tests passed. After each commit I ran git branch -f wf/injuries HEAD; wf/injuries now points at c2901a6. Nothing pushed, no PR, git status clean.
- Stage 4b (d4da1e1), on top of the patch: new task treatMate (workLabel, fitFor, executor case). The medic treats with treatEffect; if the mate needs hospital, the medic drags them to the vehicle and loads them (stretcher if they had been down). A mate who does not need hospital is not loaded and returns to light work. A unit with nobody left on scene is released (orphan rule).
- Stage 4b, orders/injury.ts: one item per mate; vehicle and seats via seatsUsed; when nobody can take the item it is not opened and EMS is requested instead; the 20-second rule (the mate's own unit drives them to hospital); the mass-casualty recount now includes mates.
- Stage 4b, agentHealth: replaced the 4a temporary stop on withdrawn bleeding with the §2.6 multipliers (1 on scene, 0.6 when treated in the safe zone, stops once in a vehicle). outstanding() also counts mates who need hospital and returns matesDown separately; block 7 calls EMS when only such mates remain.
- Stage 4b, block 5: boardOrder at close; crew who need hospital are loaded and go to hospital first (the dead are not loaded); departure text; orphan-unit safeguard. Hospital handover now happens outside the patientsIncident block (care='hospital', text '부상 대원 n명 인계 완료').
- Stage 4b, crew counting: crewReady now counts crew who can walk (canDeploy); new crewOk counts uninjured crew. arrive has three stand-down texts (all dead, all taken to hospital, nobody can walk) with causes = u.oosEv. Per the user decision, a unit stands down only when nobody can walk; the old '대원 전원 부상' branch is gone. PHRASE.T4 and T6 widened.
- Stage 4b, light work: unitArrived also lands injured crew who can walk (label '부상 — 가벼운 일', quietly report mate 'light'). fitFor uses LIGHT_WORK for them. Return to light work per §3.6a (lightBack). commander.assign skips injured crew only when it does not know they reported 'light' (lightDuty). Dispatch got the three §6.4 lines. Injured crew at base now recover stamina.
- Stage 4b fix (4b239ef), found while measuring. (a) Hard S1 #05 sat stalled for 5 minutes: the patch's armed-scene post count kept two uninjured officers on perimeter, and engage (0.9) could not pull them because of the 0.22 rule. Posts added for injured officers now have lower priority (0.5 − 0.02k), and injured officers are counted from the commander's 'light' beliefs. (b) Return to light work now waits one tick after a treatMate finishes. Otherwise the medic's 'safe' report, arriving late with the same timestamp, overwrote the 'light' report in the commander's beliefs.
- Stage 4c (c055ab5): heat exhaustion — a fire responder with stamina ≤ 10 in heat (fire ≥ 0.3 within 1 tile, or smoke ≥ 0.4 on own tile) takes 0.5/s, never going below 15. Debris fall — in collapse scenes, an active responder stepping onto a new rubble tile rolls 0.002 × hazardMul on the injury:<scene>:fall stream; a hit does 8–20, writes the record '○○ 대원 잔해 위에서 미끄러져 다침.' first and uses it as the cause; once per responder per incident (lastTile, fellOnce). Scuffle on tackle — in engage and arrest, a suspect who was fighting and not stunned hurts both sides 3–8 (injury:<scene>:fight, responder's share first, then suspect's), and the record '…가 저항해 몸싸움 끝에 검거.' replaces the arrest line.
- Tests: tests/injuries.test.ts went 97 → 121. Fixed the three failing 4a tests. Added 19 tests for 4b (including spec tests 6, 8 for 4b, 12 ①–⑥, 13 and the two fixes) and 5 for 4c. Updated tests/causality.test.ts T6 (§11-15) and tests/crews.test.ts ⑨ seatsUsed plus the new departure text (§11-14).
- Gate: npm run check passed on all three code commits (d4da1e1, 4b239ef in an archived copy, c055ab5). sweep 40 --diff hard/extreme --check passed for 4b and 4c. Before/after numbers measured against f9965c0, 4a end, 4b and 4c.
- Implementation memo appended to the end of docs/specs/H1-injuries.md (c2901a6): actual names, deviations, tests, numbers, notes for stage 5, and edits outside §12.1. Status line updated.

## 못 한 것

- Extreme preset is outside two §9.1 targets after 4c. Injured responders are 2.10/shift (target ≤ 2; 1.90 after 4b). Timeouts + abandoned + no-response went 41 → 48 (+7, limit +6; +6 after 4b). I tried two knob variants on extreme only: scuffle damage 2–5 gave 2.15/shift and fall chance 0.0015 gave 2.08/shift — inside seed noise, so I kept the spec values. Knob 1 (bleed-retreat threshold) would push normal below its lower bound (0.15; now 0.17). Left for stage 7 to balance.
- Did not touch README, CLAUDE, ROADMAP, docs/specs/README or docs/handover, and did not delete the handover patch, as instructed. Did not run npm run ui-check: no screen code changed.

## 설계와 다르게 한 곳

- HOSPITAL_BLEED is 0.09 (spec 0.01), tied to MATE_RETREAT_BLEED (injury.ts). The patch author measured 0.01: everyone with a stab or a single gunshot went to hospital after every incident, and nobody returned to light work. mateFact.bleeding uses the same threshold.
- An injured commander may still do sizeup (fitFor injured branch exempts 'sizeup'). Otherwise a scene led by an injured unit leader never closes (§3.5). Test 12 ③ treats sizeup as the exception.
- Return to light work does not require treatQ (spec §3.2 conditions), but waits until the tick after a treatMate on that responder finished (sceneManager.settle).
- outstanding() returns an extra field matesDown. Block 7 asks for 'rescue' only for down mates in fire/hazmat/collapse scenes, otherwise 'ems'. rules/air.ts tellDispatch text changed to match.
- commander.syncBoard: added the okPosts and low-priority-posts logic, and counts injured officers via lightDuty (mate 'light'). Not in the spec.
- u.oosEv is set on every RESPONDER_HURT/RESPONDER_KILLED of the unit, so it holds the last hurt/killed id (H1 §3.6). I1 spec §3 reads u.oosEv as the stand-down record's own id; I1-b must check this.
- Block 5: an 'ok' responder loaded because of heavy bleeding is set to status 'injured' (no RESPONDER_HURT record).
- Debris fall applies only when s.kind === 'collapse'. The first tile an agent is seen on does not count as stepping onto it.
- Scuffle: the suspect's share is subtracted directly with a noteHostileHurt line marked (H1), because hurtHostile does not exist until stage 5. The stream order (responder first) is already final.
- The patch's API changes are kept: mateStatus(sim, b) gained a sim argument; workLabel(s, w, sim?).

## 설계서 밖에서 고친 공용 파일

- src/sim/field/commander.ts — syncBoard armed police threshold (armedCops, police, lightCops, okPosts); assign (lightDuty); targetX/targetY for treatMate; loadsQueued includes treatMate; outstanding (mates hospital term, matesDown); manageAmbulances. Reasons: injured officers hold posts instead of entering, light-duty orders, the §3.5 hospital term, transport.
- src/sim/field/brain.ts think — a light-duty responder who must retreat again re-reports 'hurt'; workLabel(…, sim).
- src/sim/field/executor.ts — act labels for injured; finishTask and relieve workLabel(…, sim); FIGHT_HIT, fights, scuffle (4c).
- src/sim/field/rules/air.ts tellDispatch — message text uses matesDown.
- src/sim/resources.ts — tickUnits base rest also restores stamina for injured crew who can walk; arrive hospital-handover time counts injured responders aboard.
- src/sim/field/rules/injury.ts — responderHazards also holds debris fall (spec only named heat there).
- tests/crews.test.ts — the '내리지 않는 자리' test's crewReady expectation (injured crew can now deploy; crewOk added), on top of the spec-sanctioned ⑨ change. tests/causality.test.ts T6 (spec §11-15).

## 알려진 문제 — 다음 작업자가 알아야 할 것

- Extreme preset sits just outside §9.1 targets: injured responders 2.1/shift (≤ 2) and +7 timeouts/abandoned versus base (≤ +6). Unit size 1 timeouts went 4 → 9. Stage 7 must balance this together with normal's lower bound (0.15; now 0.17).
- Stage 5 must extend these to suspects (treatSuspect): orders/injury queued(); commander loadsQueued, manageAmbulances loading and the cancel on departure; hospital handover in resources.tickUnits, which today hands over only 'mate' entries and clears the array — so suspect h.where='hospital' and the '용의자 k명' text are missing; the block 5 departure text. Also replace the two (H1) lines in executor.scuffle with hurtHostile.
- evaluate still scores a killed responder as down (1.5), and the buildReport list still says '중상' — stage 6.
- u.oosEv semantics differ between the H1 and I1 specs (last hurt/killed id versus the stand-down record's id). Code follows H1.
- HOSPITAL_BLEED is tied to MATE_RETREAT_BLEED: changing the retreat knob also moves the hospital threshold (intentional).
- The handover patch docs/handover/H1-4b-wip.patch is still in the repo for the main session to remove.
- About 4% slower per shift in user CPU (more active light-duty agents, more transport trips).

## 수치

Gate: npm run check passed on d4da1e1 (Vitest 443+1 skipped), 4b239ef (445+1) and c055ab5 (450+1). Seed-40 run identical on all three: success 446, partial 56, delayed 26, unresolved 13, failed 26; timeouts 0, abandoned 2; stall candidates 0, forgotten 0, C1–C5 0. sweep 40 --diff hard/extreme --check passed for 4b and 4c. Hard and extreme 60-shift metrics on 4c: stall candidates 0.

Normal 60 shifts (f9965c0 → 4a end → 4b → 4c):
- success 80.5 → 80.3 → 80.3 → 80.2%
- success+delayed 84.7 → 84.4 → 84.4 → 84.3%
- fail+unresolved 6.0 → 6.3 → 6.3 → 6.3%
- timeouts+abandoned 1+3 at every step
- rescue rate 94.1 → 94.0 → 94.0 → 94.0%
- injured responders/shift 0.17 → 0.15 → 0.15 → 0.17
- killed 0 at every step
- 4b event counts: 7 returns to light work, 7 mate treatments, 2 injured-responder departures, 1 own-unit transport

Easy 60, 4c: success 87.0%, timeouts+abandoned 0+1, injured responders 0.12/shift.

Hard 60 (base → 4a → 4b → 4c):
- success 63.0 → 62.6 → 62.8 → 62.3%
- timeouts+abandoned 15 → 17(+1 no-response) → 17(+1) → 16
- injured responders/shift 0.57 → 0.77 → 0.70 → 0.78
- killed 0

Extreme 60 (base → 4a → 4b → 4c):
- success 36.4 → 35.2 → 34.6 → 34.5%
- timeouts+abandoned+no-response 41 → 45 → 47 → 48
- injured responders/shift 0.82 → 1.80 → 1.90 → 2.10
- killed 0 → 2 → 1 → 1
- stand-downs: 3 → 4 → 3 (all for '남은 대원 모두 병원 이송')

Unit size 1, 30 shifts: success 239 → 233 → 233 → 231; timeouts 4 → 7 → 7 → 9.

Forced 20 shifts, scenario rows on 4b and 4c, all with timeout/no-response/abandoned 0·0·0:
- armed/shooter 23: 18 success, 5 partial (same as 4a)
- armed/hostage: 18 success, 2 partial
- armed/siege: 12 success, 8 partial, 1 delayed
- armed/riot: 20 success, 2 partial
- armed/domestic: 19 success, 1 partial, 2 delayed, 4 unresolved
- armed/bomb: 21 success
- fire/arson: 31 success, 7 partial, 5 failed

Debris falls per collapse incident: normal 0.13, easy 0.20, hard 0.18, extreme 0.36. Forced collapse 30 shifts: normal 0.16, extreme 0.26.

Scuffles (normal/hard/extreme): 27 / 33 / 40. Responders with heat-exhaustion records: 3 / 23 / 42; RESPONDER_HURT caused by heat: 2 (extreme only).

Log check: hard S13 #10 — down → safe zone after 28 s → treated → loaded into 구급1 → hospital handover.

Speed (sweep 20 --no-metrics, user CPU, alternating 3 rounds): 4a 23.7 s → 4c 24.8 s (+4%, slower in all three rounds).

Measurement tools and outputs: /tmp/claude-0/-home-user-operator/746ce228-3bc1-5d51-931f-76aa2a11e502/scratchpad/wf-injuries/ (diag.mts, cmp.mjs, measure.sh, to.mts, down.mts, causes.mts, out/).
