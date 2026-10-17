# Strike Arena — Plan

Browser FPS (Three.js + Vite, Vitest). One procedural arena, player vs 5 bots, round-based. Zero external assets.

## Architecture

```
input.js ──► snapshot ─┐
                       ▼
            core/game.js  stepGame(world, input, dt)   ← fixed 60 Hz, pure, no Three.js
              │ uses core/movement, weapons, spread, raycast, bots, rounds, aabb, rng
              ▼
         world state  +  world.events[]  (shot, hit, kill, reload, footstep, damage, roundEnd, ...)
              │
   ┌──────────┼───────────────┬──────────────┬─────────────┐
   ▼          ▼               ▼              ▼             ▼
render/*   ui/hud.js       audio/audio.js  render/effects  core/feel (bob, kick)
(sync meshes from state; consume events; never mutate gameplay state)
```

- **Deterministic core** (`src/core/`): pure ES modules, no Three.js/DOM imports, all numbers from `src/config.js`.
  This is where every acceptance test from the brief lives.
- **Presentation** (`src/render/`, `src/ui/`, `src/audio/`): thin; reads world state, consumes the per-tick event list.
- **main.js**: bootstrap, rAF loop with fixed-timestep accumulator (`core/loop.js`), render interpolation-free sync.

## File layout

```
index.html                 canvas root #app, #hud, #menu overlays
vite.config.js             vite + vitest config (test.include tests/**, passWithNoTests)
src/config.js              ALL tunables (movement, fall, weapons, bots, rounds, hud, audio, effects, map)
src/main.js                bootstrap + rAF loop + wiring
src/input.js               keyboard/mouse/wheel/pointer-lock -> input snapshot, sensitivity
src/core/aabb.js           AABB helpers, resolveMove (axis-separated move-and-slide)
src/core/mapData.js        arena layout as data: wall/crate boxes, spawns, waypoints, cover points, bounds
src/core/movement.js       player physics, look, crouch/walk/jump, fallDamage()
src/core/loop.js           fixed-timestep accumulator
src/core/rng.js            seeded RNG (mulberry32)
src/core/weapons.js        weapon state machine, tryFire, reloadTick, loadout/switch/refill
src/core/spread.js         computeSpread, recoil pattern, crosshairRadius, sampleSpreadDir
src/core/raycast.js        ray-vs-AABB slab, castHitscan (walls + head/body), applyDamage
src/core/bots.js           botThink (patrol/engage/cover/dead), LOS, bot fire, hitboxes, corpse timer
src/core/rounds.js         roundTick: playing -> won/lost -> intermission(3 s) -> next round; score, timer
src/core/game.js           createWorld / stepGame / resetRound — orchestrates everything, emits events
src/core/feel.js           viewmodel bob/sway, camera kick + recovery, scope FOV lerp, landing dip
src/core/fps.js            smoothed FPS meter
src/core/safety.js         stuck/out-of-bounds detection + recovery
src/render/mapMesh.js      merged arena meshes (vertex colors, few materials), lights
src/render/scene.js        scene, camera, fog, sky color, attaches arena
src/render/viewmodel.js    procedural pistol/rifle/sniper viewmodels
src/render/botModel.js     procedural humanoid, limb swing, fall-over, fade-out
src/render/botSync.js      keeps bot models in sync with world.bots
src/render/effects.js      pooled muzzle flash, sparks, tracers
src/ui/hud.js              DOM HUD: health, ammo, weapon, crosshair, hitmarker, fps, score, timer, scope,
                           kill feed, damage direction, round banner, low-HP vignette
src/ui/menu.js             start / pause / help overlays, sensitivity slider (localStorage), mute indicator
src/audio/audio.js         WebAudio synth (injectable AudioContext), mute, shots, reload, steps, hit, panner
tests/*.test.js            one test file per task
```

## Decisions

1. **Pure core + event list.** `stepGame` mutates only `world` and pushes events into `world.events` (cleared each
   tick). Audio/HUD/effects react to events. Lets a small model build and test logic without a browser.
2. **Units/axes:** meters, seconds, Y-up, yaw 0 looks toward -Z, angles in radians. Player box: width 0.6,
   height 1.8 (crouch 1.2), eye 1.65 (crouch 1.1).
3. **Collision:** static AABBs only. `resolveMove(box, delta, colliders)` resolves X, then Z, then Y; returns
   `{box, onGround, hitCeiling}`. Same function for player and bots. Entity-vs-entity uses the same resolver with
   bot boxes added to the collider list.
4. **Hitscan:** slab test ray-vs-AABB; nearest hit wins across walls and bot head/body boxes. Head box is checked
   as its own AABB above the body box, so a head ray never also counts as body.
5. **Fixed timestep 1/60 s** with accumulator capped at 0.25 s (prevents spiral of death after tab switch).
6. **Seeded RNG** (`mulberry32`) in world for spread sampling and bot inaccuracy → reproducible tests.
7. **Weapons:** `fireMode: 'semi' | 'auto'`; semi needs `triggerPressed` edge, auto needs `triggerHeld`. Sniper
   has `lockout` after each shot. Empty-mag fire emits `dryFire` event, consumes nothing. Switching cancels reload.
8. **Spread:** `base + moveFactor*speedRatio + airPenalty + crouchBonus/walkBonus + per-shot bloom (decays)`;
   crosshair radius in px = `tan(spread)/tan(fov/2) * screenHalfHeight`. Rifle recoil = fixed per-shot
   `[pitch, yaw]` table in config, recovers when trigger released.
9. **Bots:** states `patrol → engage → cover → dead`. LOS = ray from bot eye to player eye blocked by any wall.
   Reaction delay before first shot, aim error = seeded random cone whose size is bounded by config
   (`aimErrorMin..Max`, shrinks with time on target). Bots path via waypoint graph only (no navmesh).
10. **Rendering budget:** arena merged into ≤ 4 meshes (by material); colors via vertex colors + procedural
    checker on floor; bots are ~10 boxes each sharing materials. No textures, no shadows by default (config flag).
11. **HUD = plain DOM** (no canvas text), crosshair = 4 absolutely-positioned divs whose gap = crosshair radius.
12. **Audio** takes an `AudioContext` factory so tests inject a fake; created on Start click (autoplay policy).
    Shots = noise burst + click transient + lowpass + short pitch-swept sine thump, per-weapon params in config.
13. **Tests:** Vitest node env by default; DOM tests use `// @vitest-environment jsdom` file header. Three.js
    modules are tested in node (geometry/Group creation needs no WebGL). Presentation tasks are accepted by
    `npm run build` + a test that the module builds/exports the expected objects.
14. **Recovery:** pointer-lock loss → pause overlay; player below map/outside bounds or inside a collider → snap
    to spawn; bot stuck (no progress for N s) → skip to next waypoint; AudioContext resumed on every Start/Resume.

## Milestones

- **M1 – Map, movement, collision:** config + validation, AABB resolver, arena data + meshes, player physics with
  crouch/walk/jump and fall damage, input + fixed loop, scene bootstrap → walk around the arena.
- **M2 – Weapons, shooting, HUD:** weapon state machine, reload/loadout, spread + recoil, hitscan + head/body,
  HUD (health, ammo, weapon, dynamic crosshair, hitmarker, FPS, scope), viewmodels, game step with shootable dummies.
- **M3 – Bots, rounds:** bot AI + fire + death/corpse, humanoid model + animation, round state machine with refill,
  full world integration, kill feed, damage direction, round banner.
- **M4 – Audio, feel, menus:** WebAudio set, effects (flash/sparks/tracers), bob/kick/scope feel, menus with
  sensitivity + help + mute, stuck recovery, final wiring and tuning.

## Run

`npm install` · `npm run dev` · `npm test` · `npm run build`
