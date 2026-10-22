# PLAN — Town Driving Game v3

Browser 3D arcade driving demo in a seeded procedural town. Three.js + Vite, plain ES modules, Vitest for tests.
Quality bar: `prototype/index.html` + `prototype/FEATURES.md` — every feature there is planned below and rebuilt properly.

## Architecture

**Rule: simulation is pure, rendering is a thin view.** All game logic is plain JS over plain objects
(`{x, z}`, numbers, arrays) with no Three.js and no DOM, so it runs in Vitest under Node. View modules read sim
state each frame and write it into Three.js objects / DOM / WebAudio. One `requestAnimationFrame` loop:

```
input (DOM → InputState) → toControls() → stepGame(world, controls, dt)  [pure, substepped]
   → world.events[] (impact, skid, horn, toast, stuck, reset …)
   → views: carMesh / townMeshes / actors / fx / camera / hud / minimap / audio
```

`world` = `{ town, car, traffic[], peds[], damage, fx pools, camera state, ui state, events[] }`.
Events are the only channel from sim to sound/HUD, which keeps the sim testable ("hit a wall → `impact` event").

## File layout

```
index.html                 full-window canvas root, HUD/start-screen markup, loads /src/main.js
src/
  config.js                ALL tunables (seed, grid, car, camera, traffic, peds, fx, audio, colors)
  util/math.js             clamp, lerp, damp (exp smoothing), wrapAngle, angLerp
  util/rng.js              mulberry32, createRng(seed) {float, range, int, pick, fork}
  input.js                 pure InputState + toControls; attachInput(target, state) DOM binding
  car.js                   createCar, stepCar (kinematic arcade model, handbrake, slip)
  collision.js             circle-vs-AABB, bounds, circle-vs-circle, substepped resolveWorld
  town.js                  generateTown(seed, cfg): roads, blocks, parks, buildings, trees, ponds, lights, aabbs, spawn
  traffic.js               AI cars on block-perimeter loops, yield to player
  peds.js                  sidewalk pedestrians, walk cycle, panic flee, horn reaction
  damage.js                impact → damage/shake/vignette/smoke, repair
  game.js                  createGame / stepGame orchestration, events, reset, stuck, pause
  camera.js                chase-orbit pose, FOV-by-speed, shake, occlusion pull-in, start swoop
  fx/particles.js          pure ring-buffer particle pool + spark/smoke presets
  fx/skids.js              pure ring buffer of skid quads
  fx/fxView.js             Points + InstancedMesh views of the pools
  audio/engineModel.js     pure mapping: speed/load/slip → synth params; thud/horn specs
  audio/audio.js           WebAudio graph (engine, squeal, thud, horn, ignition); no-op without AudioContext
  render/scene.js          renderer opts, sky dome, fog, hemi + shadowed sun that follows the car, ground/grass
  render/textures.js       facadeSpec (pure, seeded) + canvas facade / wall-stripe textures
  render/carMesh.js        car model (body, cabin, bumpers, lights, wheels, steer pivots) + update
  render/townMeshes.js     instanced/merged town geometry
  render/actorMeshes.js    pedestrian meshes + traffic car pool
  hud/format.js            pure: km/h, gear letter, damage %, tween
  hud/hud.js               speedo, gear, damage bar, vignette, toasts, hint strip, top speed, pause/fade overlays
  hud/minimap.js           pure world→map transform + canvas draw (static layer cached)
  ui/startScreen.js        title, keycaps, pulsing pill, attract-orbit pose
  style.css                HUD + start screen styles
  main.js                  wiring only (no logic worth testing)
tests/                     one *.test.js per task (Vitest, Node environment)
```

## Decisions

- **Pure sim / thin view split** — the brief wants core logic testable without a browser; doing it for traffic,
  peds, damage, FX pools, HUD formatting, minimap transform and audio params too makes "feel" features testable.
- **Kinematic arcade car**, velocity vector + heading (not a scalar speed) so handbrake drifts exist: lateral
  velocity is bled by `grip`, handbrake lowers grip. Turn authority = `min(1, |v|/refSpeed)` → no pivoting.
- **Frame-rate independence:** every rate uses `dt`; smoothing uses `1 - exp(-k·dt)`; frame `dt` clamped to 0.05 s;
  physics substeps so one step never moves more than `radius/2` (no tunnelling at 29 m/s on a 20 fps hitch).
- **Collision:** car = circle (r 2.05), obstacles = AABBs (buildings, tree trunks); world bounds are a separate
  clamp, not an AABB. Push out along the closest-point normal, remove only the into-wall velocity component
  (car slides along walls). Linear scan over ~150 boxes is fine; no broadphase.
- **Determinism:** one seed in `config.js`; `rng.fork(label)` gives independent streams for town / facades /
  traffic / peds, so adding peds never changes the layout. Prototype used `Math.random()` for facades — fixed.
- **Chase camera:** orbit yaw is *relative to car heading* and eases back behind the car ~1.5 s after drag ends
  (prototype's world-fixed yaw makes reversing/turning disorienting). Pitch/dist clamped, y ≥ 0.9 m.
- **Draw calls:** buildings as one InstancedMesh per facade texture (~10), roof caps, sidewalks, trees, lights,
  dashes all instanced → whole static town < 40 draw calls (prototype had ~250 separate meshes).
- **Offline:** Three.js comes from npm and is bundled by Vite (prototype's unpkg import map is dropped).
  Deps: `three` (MIT); dev: `vite`, `vitest` (MIT). No vite config file; no jsdom (DOM tests use Node's
  built-in `EventTarget`/`Event`, everything else is pure).
- **Audio is synthesized** (WebAudio oscillators + noise), no asset files; created on the start-click gesture;
  every audio call is a safe no-op if `AudioContext` is missing.
- **Milestones extended to 4:** the brief says 2, but the prototype (traffic, peds, damage, sound, HUD) is the bar;
  M1/M2 keep the brief's acceptance tests, M3/M4 add life and delight. Nothing from the Out list
  (realistic physics, multiplayer, touch, levels/objectives) is planned.
- **Pointer lock** is a toggle (P) on top of drag-orbit, per the brief's open question.

## Milestones

- **M1 — Car + camera on a plane (brief tests 1–4, 7, 8 car):** config, math/rng, input, arcade car with
  handbrake, chase-orbit camera with FOV/shake, car mesh, sky/fog/sun scene, speedo/gear/hint HUD, engine +
  squeal + horn audio, start screen with attract orbit, playable loop.
- **M2 — Town + collision (brief tests 5, 6, 8 town/collision):** seeded town (roads + dashes, sidewalks,
  parks/ponds/trees, downtown height falloff, facade textures with lit windows, roof caps, streetlights, striped
  perimeter walls), circle-vs-AABB + bounds, substepping, instanced town meshes.
- **M3 — Alive town & feedback:** damage (bar, paint darkening, smoke, overheating toast, R reset+repair),
  sparks, skid marks, thud, traffic AI with yielding and collisions, pedestrians with walk cycle and panic,
  minimap with live dots, vignette, event → sound/HUD wiring.
- **M4 — Delight & acceptance:** the Delight list below, pointer lock, full headless acceptance test.

## Delight

1. **Camera occlusion pull-in** — when a building sits between camera and car, the camera slides in front of it
   instead of showing a wall. (T42)
2. **Stuck rescue** — throttle held but not moving for 2.5 s → "Stuck? Press R" toast; R now fades to black and
   respawns at the *nearest road* facing along it, not back at the spawn. (T43)
3. **Cinematic start** — clicking start eases the camera from the attract orbit down to the chase pose over 1.2 s
   while the overlay fades, with an ignition-crank sound before the engine settles to idle. (T44)
4. **Body lean** — spring-damped chassis pitch under throttle/brake and roll in corners, so weight transfer is felt. (T45)
5. **Pause that respects you** — Esc or tab blur freezes the sim, suspends audio, dims the screen with
   "PAUSED — click to resume"; no dt jump on return. (T46)
6. **Horn reactions** — pedestrians within 12 m flinch and step away; a traffic car ahead honks back in a lower
   pitch (with cooldown). (T47)
7. **HUD polish** — speed number tweens instead of flickering, a small session "TOP" speed badge, and the hint
   strip fades after 10 s, returning on F1. (T48)
