# M3 review (5c876ed..df5c4e8; T16-T22, plus T33/T34 fixes; probed by script; full suite: 10 failed / 404)
Matches PLAN/BRIEF: bots/rounds/HUD follow the pure-core + event-list design; AT9, AT10, AT14, AT16 hold end to end (all bots killed -> won, score 1:0, reset after 3 s with full ammo); T33/T34 fixes landed; damage-indicator bearing sign checked by hand.
**Bugs (fix tasks T35-T36):**
- B1 `tests/game.test.js`: 10 M2 tests still use the dummy world (`world.targets` is gone) and run among 5 live bots that kill the parked player, so `npm test` is red - brief AT1 is broken at the M3 head.
- B2 Corpses fall toward world -Z regardless of facing (Euler order XYZ in `botModel.js`; probed yaw PI/2: head at x=0, z=-1.6).
**Risks (no task):**
- Bots overlap each other (767 overlap ticks in 120 s idle); only walls collide, contrary to PLAN decision 3. Bot-vs-player overlap was 0 in the probe, but only with an idle player.
- Bots only notice the player inside the view cone: a player shooting from behind is never turned on, only the cover logic reacts to hp loss. Bots also keep firing in `cover` state.
- Active weapon is not reset on a new round (sniper stays equipped); weapon bloom and `stepDistance` also survive `resetRound`.
- Damage-indicator angle uses end-of-frame yaw, not yaw at the shot; unused `createDummy`/dummy-damage path remains in game.js.
- `main.js` handleEvent (kill, playerDamaged -> HUD) and `botSync` + `resetRound` re-creation are not covered by tests; the integration test only runs idle input, so player kills/headshots/round WON are never exercised in a long run.
**Missing tests:** player shooting bots over a long run, `woundBearing`, botSync after reset (model recreated for removable corpses), bot vs bot spacing, footstep `walking` flag (carried from M2, needed by T24).
