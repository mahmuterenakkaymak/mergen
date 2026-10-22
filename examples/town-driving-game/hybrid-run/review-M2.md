# REVIEW — M2 (c131006..f201339 vs PLAN M2; 37/38 test files pass, 4 tests red in tests/game.test.js)
Checked all 26 `ASSUMPTION:` comments; 4 bugs, fix tasks T65-T68 (T59-T64 from VISUAL_REVIEW already queued).
## Bugs
- tests/game.test.js is red (4 tests): still asserts the T18 origin spawn; T25 moved the spawn to the town and never updated it (T65).
- town.js spawn ASSUMPTION "right lane" is wrong: heading 0 faces +z, screen-right is -x, spawn is at +x = left lane. M3 traffic uses the right lane, so the player starts head-on (T66).
- game.js emits `impact` every frame while holding throttle into a wall (stepCar re-adds ~0.2 m/s, resolve removes it): once M3 wires thud/sparks it machine-guns (T67).
- Perimeter wall hit is silent: clampToBounds ASSUMPTION leaves the decision to the caller, game.js only zeroes velocity, no impact event, so no thud/damage at the outer wall (T68).
## Verified OK
Spawn on road and clear of aabbs, resolveWorld undo of the stepCar displacement is exact, substeps <= r/2, building/road no-overlap tests, deterministic town, draw-object count, dash `rot` convention, wall stripe repeat.
## Risks
- Facade texture is stretched over each whole box face, so a 40 m tower gets huge windows and a 6 m house tiny ones; windows are not metre-scaled.
- Lights, ponds and park lawns have no collider (by design); the car drives through poles.
- tests/main-town.test.js reads main.js source text, not behaviour; the render loop is untested.
## Missing tests
No test for lane side, grinding events, perimeter impact, or tree-trunk collision through stepGame.
