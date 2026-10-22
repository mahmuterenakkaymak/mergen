# REVIEW — M4 (2a04b36..bc28610 vs PLAN M4 + brief; 72/76 test files pass, 10 tests red in 4 files)
Checked every `ASSUMPTION:` in src/ (M4: camera x4, car, game x3, hud, input, main); all hold except the T44/T70 fallout below. 5 bugs, fix tasks T82-T86 (T78-T81 from VISUAL_REVIEW already queued).
## Bugs
- Cinematic start (T44): main.js hands swoopPose an aim without `heading`, so the camera x/z and lookAt are NaN for the whole 1.2 s swoop (verified in Node) - blank view on every start click (T82).
- Attract orbit (T70, ORBIT_H 26) puts the camera inside >26 m towers ~7 % of each lap; tests/main-town.test.js caught it (y > 43) and was ignored (T83).
- tests/reset.test.js (6 red) encodes the pre-T43 instant reset; tests/honest-copy.test.js (2 red) the pre-T69 copy - both stale, code right (T84, T85).
- hud.js `topEl.append('TOP ', ...)` breaks createHud on the fake DOM; tests/hud-events.test.js red (T86).
## Verified OK
Pause freezes sim/events and the frame still drains input; lean signs match the mesh axes (nose-up on throttle, left side up in a left turn); occlusion uses buildings only, never closer than minDist/2; ped `along` is clamped (T75); stepAmbient pushes no events; horn answer cooldown and cone; pointer-lock state follows pointerlockchange.
## Risks
- Rescue lands on the road centre with no check for an AI car there (circle push, maybe a thud); the smoothed camera still glides across town under the 0.45 s fade-in.
- Earlier tasks were accepted on their own test only, so whole-suite regressions slipped through; run `npx vitest run` in the accept of the last task of a milestone.
## Missing tests
main.js wiring (only source-text tested: the swoop NaN lived there), rescue onto an occupied road spot, Esc while pointer-locked, tab hidden without blur.
