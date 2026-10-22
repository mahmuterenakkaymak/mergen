# Town Driving Game v3 (browser, 3D) - creativity test

> Same brief as v1 (2026-10-16), except the Out list: v1 also excluded sound, HUD/minimap, damage, traffic and
> pedestrians, textures beyond coloured boxes - that list was never asked of the user and made v1 feel empty.
> Run with --prototype: test of the 2026-10-20 creativity changes.

Small test project: a 3D driving game that runs in the browser, set in a small procedurally
generated town. Keyboard + mouse controls, arcade physics. Deliberately scoped to 2 milestones.

## 1. Goal
Build a playable 3D car-driving demo in the browser: the player drives a car around a small
town with roads and buildings, with a third-person camera. "Done" = opening the dev URL and
driving around the town without falling through the world or passing through buildings.

## 2. Users and use cases
- Player: opens a local URL, drives with WASD/arrows, looks around with the mouse,
  bumps into buildings and stops (no clipping), enjoys smooth 60 fps motion.

## 3. Scope
**In (v1):**
- Drivable car: accelerate, brake/reverse, steer with speed-dependent turn rate (arcade model).
- Third-person chase camera; mouse orbits the camera around the car.
- Small procedural town: grid roads, ground plane, randomized box buildings (seeded RNG,
  same layout every run), simple lighting + sky color.
- Car-vs-building and car-vs-world-bounds collision (stop, don't pass through).

**Out (later / never):**
- Realistic vehicle physics, multiplayer, mobile touch controls, levels/objectives.

## 4. Method / architecture
Single-page app, no backend, no LLM. One game loop (requestAnimationFrame):
- `input.js` - keyboard/mouse state (WASD/arrows, pointer-drag or pointer-lock mouse look).
- `car.js` - kinematic arcade car model (speed, heading, steering; dt-based integration).
- `town.js` - seeded procedural generation of roads, buildings, bounds; exposes AABB list.
- `collision.js` - circle (car) vs AABB (buildings) resolution: push out + kill speed component.
- `camera.js` - chase camera with mouse orbit offset.
- `main.js` - scene setup, loop, wiring. Config constants (speeds, sizes, seed) at top of a
  single `config.js`.

## 5. Stack and environment
- Three.js (MIT) + Vite (MIT), plain JavaScript (ES modules). No TypeScript, no bundler config.
- Node on Windows 11; run: `npm install` then `npm run dev` (Vite dev server), open the printed
  localhost URL. `npm run build` must also succeed.

## 6. Data
No external data. Town layout generated from a fixed seed in `config.js` (deterministic).
Privacy class: public (nothing personal).

## 7. Interfaces
- Browser UI: full-window canvas.
- Keyboard: W/Up accelerate, S/Down brake+reverse, A/D or Left/Right steer, Space handbrake.
- Mouse: hold left drag (or pointer lock) to orbit camera; wheel to zoom distance.
- No CLI/API.

## 8. Constraints
- 60 fps on a desktop GPU at 1080p; keep draw calls low (merged/instanced geometry where easy).
- Fully offline after `npm install`; no CDN at runtime, no cloud dependency.
- Dependencies MIT-licensed only (Three.js, Vite).
- Simple readable code, config at top, core logic (car model, collision, town gen) in pure
  functions testable without a browser.

## 9. Acceptance tests
1. Given a fresh clone, `npm install && npm run build` completes with no errors.
2. Given the dev server running, opening the URL renders a 3D scene with ground, roads,
   buildings, sky, and the car, at ~60 fps.
3. Holding W increases speed from 0 to max over ~3-4 s; releasing decays speed gradually;
   S brakes to stop then reverses (slower than forward max).
4. Steering at speed turns the car; steering magnitude at standstill/very low speed is ~0
   (no pivoting in place); A and D mirror each other.
5. Driving full speed into a building stops the car at the wall face; the car never ends up
   inside a building box or outside the world bounds.
6. Two runs with the same seed produce identical town layouts (unit-testable generator).
7. Mouse drag rotates the camera around the car; the camera never clips through the ground.
8. Unit tests for car integration, collision resolution, and town generator pass via `npm test`.

## 10. Milestones
- **M1 - Car + camera:** ground plane, car mesh, arcade physics, keyboard input, chase camera
  with mouse orbit. Playable on an empty plane. Acceptance: tests 1-4, 7, 8 (car parts).
- **M2 - Town + collision:** seeded procedural town (roads, buildings, bounds), collision
  resolution, lighting polish. Acceptance: tests 5, 6, 8 (town/collision parts).

## 11. Open questions / risks
- Mouse orbit: pointer lock vs drag - implement drag first (simpler, no permission prompt);
  pointer lock is a nice-to-have.
- Box buildings + flat colors may look plain; acceptable for a test, cheap gradient/fog can help.
- Frame-rate independence: all physics must use dt, or behavior changes on 144 Hz monitors.
