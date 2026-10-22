# REVIEW — M1 (ebf0136 vs plan 0847831; 20 test files / 188 tests pass)
Checked all 19 `ASSUMPTION:` comments; 4 bugs found, fix tasks T55-T58 appended (T50-T54 from VISUAL_REVIEW already queued).
## Bugs
- car.js: 0 -> maxSpeed in 2.77 s, brief wants 3-4 s. Cause: the "drag is coast-only" ASSUMPTION (constant accel + hard clamp). tests/car.test.js loosened the bound to 2.5 and hides it (T55).
- main.js: squeal ASSUMPTION is wrong. slip/6 is linear and not gated on `skidding`, so normal turns squeal; the prototype gates it (T56).
- carMesh.js: ASSUMPTION "view layer sets car.braking" is false, nobody sets it, brake lights never glow (T57).
- input.js: blur does not reset `dragging`, so the camera orbits on hover after alt-tab mid-drag (T58).
## Verified OK
Steer sign (A = left on screen), no pivot at standstill, reverse (9.04 m/s) < forward max, 60/144 Hz parity, camera y >= 0.9, rng.int inclusive, damagePct clamp.
## Risks
- Start screen and hint strip advertise R reset, unimplemented until T39 (M3). Toast queue and horn have no HUD/main wiring yet.
- main.js first-frame dt can be slightly negative (rAF timestamp < performance.now()); harmless but unclamped for visuals.
- pointerdown ignores e.button, so a right-click starts an orbit drag.
## Missing tests
main.js loop and startScreen click/onStart behaviour have no tests; no 390px or draw-call check yet.
