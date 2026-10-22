# REVIEW — M3 (43f6e05..90e67b2 vs PLAN M3; 58/59 test files pass, 2 tests red in tests/start-motion.test.js)
Checked every `ASSUMPTION:` comment in src/ (M3 ones: damage, particles, skids, game x2, hud, peds x2); 3 bugs, fix tasks T75-T77 (T69-T74 from VISUAL_REVIEW already queued).
## Bugs
- peds.js ASSUMPTION "never leaves its sidewalk band" is wrong along the walk axis: the car shove is added after the [lo, hi] bounce and only `across` is clamped, so a clipped walker lands ~0.6 m past the block end, in the road (T75).
- tests/start-motion.test.js is red (2 tests): it still asserts the pre-T59 animation shorthand / pill delays; the CSS is right, the test is stale (T76).
- Traffic and peds never move on the start screen: main.js steps the sim only when `running`; T70's premise that they already move is false (T77).
## Verified OK
Right-lane loop direction matches the T66 spawn lane; no AI overlap or AI near spawn at t0; 60 s idle = zero events; shallow wall scrape (1.7-6.9 deg) does not machine-gun impact; wall/thud/reset/damage wiring, skid and ped orientation, minimap building corners.
## Risks
- AI cars ignore each other: a car stopped by a yield or a hit is driven through by the one behind; AI has no building collider (corner cut up to ~6 m).
- A 5-6 m/s traffic bump thuds and sparks without damage (documented in game.js); reset does not snap the smoothed camera, so it may swoop across town.
## Missing tests
Traffic-vs-traffic, reset with a traffic car on the spawn, ped shove at block ends (T75), the render loop (main.js is only source-text tested).
