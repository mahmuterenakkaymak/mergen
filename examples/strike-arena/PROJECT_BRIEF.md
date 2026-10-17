# Strike Arena

## 1. Goal
A Counter-Strike-style first-person shooter that runs in the browser on one small, original arena map. The player
fights 5 AI bots in round-based matches. Everything is procedural: no external 3D models, textures or audio files -
geometry is built in code, sounds are synthesized with WebAudio. Built with Three.js + Vite, logic tested with
Vitest (same stack as town-driving-game-v2). "Done" = `npm run dev` gives a playable, complete round loop with
satisfying gunfeel and a readable HUD.

## 2. Users and use cases
- The player (single player, desktop Chrome/Edge):
  - Opens the game, presses Start, gets pointer lock, moves through the arena.
  - Switches between 3 weapons, shoots bots in the head or body, reloads under pressure.
  - Wins the round by killing all bots; loses on death; a new round auto-starts after 3 s.
  - Tunes mouse sensitivity from the menu; mutes audio with M; checks the key help.

## 3. Scope
**In (v1):**
- **Map:** one small original arena - two spawn points, a mid area, two corridors, cover crates, walls. Static AABB
  colliders for player and bots.
- **Movement:** WASD, pointer-lock mouse look, jump, crouch, Shift walk (silent + accurate). Sensitivity setting.
- **3 weapons** (slots 1/2/3 + mouse wheel, R to reload):
  - Pistol: semi-automatic, accurate, low damage.
  - Rifle: automatic, fixed recoil pattern, spread grows while moving.
  - Sniper: right-click scope (zoom), single shot, high damage, short lockout after each shot.
  - Every weapon has: damage, fire rate, magazine size, reserve ammo, reload time, spread, headshot multiplier.
    All values live in `src/config.js`.
- **Shooting:** hitscan raycast. Separate head and body hitboxes. Walls stop bullets.
- **Bots:** 5 enemies. Waypoint patrol, line-of-sight raycast check; when they spot the player they approach and
  fire with deliberate inaccuracy; they roam between covers. Visible humanoid model (torso, head, arms, weapon) -
  not a box.
- **Rounds:** all bots dead = round won; player dead = round lost; new round after 3 s. Track score and round time.
  Each new round refills the player's magazines and reserve ammo to config values.
- **Bot death feedback:** dying bot plays a simple fall-over animation, stops moving/shooting, corpse fades out
  after a configured lifetime (~5 s).
- **Fall damage:** falls under a height threshold deal no damage; higher falls deal height-proportional damage
  (pure function, tuned in config).
- **FPS counter:** small corner readout on the HUD.
- **HUD:** health, ammo (mag/reserve), active weapon, dynamic crosshair that opens/closes with spread, hitmarker,
  damage direction indicator, kill feed, score and round timer.
- **Feel:** viewmodel sway while walking, camera recoil kick, muzzle flash, impact sparks and bullet tracers.
- **Audio (WebAudio, procedural):** distinct shot sound per weapon, reload, footsteps, hit sound, directional bot
  gunfire. M toggles mute.
- **Menus:** start screen, Esc pause, sensitivity slider, key help.

**Out (later / never):** multiplayer, buy menu / economy, grenades, bomb plant/defuse, more than one map, teammate
bots, mobile controls.

## 4. Method / architecture
- Pure client-side ES modules. Deterministic data in `src/config.js` (weapons, movement, bot tuning, audio, round).
- Modules (suggested):
  - `map.js` - procedural arena geometry + static AABB collider list.
  - `player.js` - pointer-lock controller, movement, crouch/walk/jump, AABB collision resolution.
  - `weapons.js` - weapon state machines (fire, reload, sniper lockout), spread and damage math (pure functions).
  - `raycast.js` - hitscan against wall AABBs and bot hitboxes (head/body), wall occlusion.
  - `bots.js` - waypoint patrol, LOS check, approach/cover/engage state machine, inaccuracy model.
  - `botModel.js` - procedural humanoid (torso, head, arms, legs, weapon), simple limb-swing animation.
  - `rounds.js` - round state machine (playing -> won/lost -> 3 s intermission -> next round), score, timer.
  - `hud.js` - DOM overlay: health, ammo, weapon, dynamic crosshair, hitmarker, damage direction, kill feed, score, timer.
  - `audio.js` - WebAudio synthesis: noise-burst gunshots (per-weapon filtering/pitch), reload clicks, footsteps,
    hit ping, panner-based directional bot gunfire, master mute.
  - `effects.js` - muzzle flash, sparks, tracers, viewmodel bob, recoil kick.
  - `menu.js` - start/pause/help overlays, sensitivity slider (persisted in localStorage).
- Physics: swept-free AABB resolution against static colliders and entity boxes; hitscan = ray vs AABB (slab test).
- Game loop: requestAnimationFrame with fixed-timestep logic (e.g. 60 Hz) so tests and gameplay are deterministic.
- Testability: weapon/reload/damage/spread/round/bot-fire logic as pure modules with no Three.js imports, unit
  tested with Vitest (jsdom for HUD). Three.js scene code stays thin.

## 5. Stack and environment
- Node 24, `three ^0.170`, `vite ^6`, `vitest ^3`, `jsdom ^25` (same package.json shape as town-driving-game-v2).
- Run: `npm install` -> `npm run dev`; tests: `npm test` (vitest run). Build: `npm run build`.
- Windows 11, local only. No network calls at runtime.

## 6. Data
- No persistence beyond localStorage sensitivity. No personal/customer data (privacy class: public).
- All tunable numbers in `src/config.js` with comments.

## 7. Interfaces
- **Screens:** start menu (Start, sensitivity, key help), pause overlay (Esc: resume, sensitivity, help), HUD.
- **Controls:** WASD move, Space jump, C or Ctrl crouch, Shift walk, mouse look (pointer lock), LMB fire,
  RMB scope (sniper), 1/2/3 and wheel = weapon switch, R reload, M mute, Esc pause.
- **Code interfaces:** pure functions with JSDoc: `computeSpread(state)`, `applyDamage(hit, multipliers)`,
  `reloadTick(state, dt)`, `roundTick(state, dt)`, `botThink(bot, world, dt)`.

## 8. Constraints
- **Plan cap: max 30 tasks, exactly 4 milestones** - M1 map + movement + collision; M2 weapons + shooting + HUD;
  M3 bots + rounds; M4 audio + feel + menus.
- 60 FPS target on a desktop browser; keep draw calls low (merged/simple geometry).
- Zero external assets and zero runtime network access; dependencies limited to three/vite/vitest/jsdom
  (MIT/Apache-compatible).
- All gameplay numbers in `src/config.js`; no magic numbers in modules.
- No LLM at runtime; everything deterministic except bot inaccuracy (seeded RNG preferred).

## 9. Acceptance tests
1. `npm test` passes; `npm run build` succeeds.
2. Config validation: every weapon has damage, fireRate, magSize, reserveAmmo, reloadTime, spread, headshotMult > 1.
3. AABB collision: a player box moved into a wall ends up outside the wall (no penetration); same resolver used by bots.
4. Hitscan: a ray aimed at a bot's head hitbox deals `damage * headshotMult`; body hitbox deals base damage.
5. Wall occlusion: a wall between shooter and bot blocks the shot (no damage, wall impact registered).
6. Weapon state: pistol fires once per click; rifle fires at fireRate while held; sniper enters lockout for its
   configured duration after a shot; firing with empty mag does not consume ammo.
7. Reload: takes exactly reloadTime, moves bullets reserve -> mag, cannot fire during reload, blocked when reserve is 0.
8. Spread: moving increases effective spread vs standing; walking (Shift) reduces it; crosshair radius reflects it.
9. Bots: a patrolling bot does not fire without line of sight; an engaged bot moves toward the player and fires with
   bounded inaccuracy; bots collide with the map (no wall clipping).
10. Rounds: killing all bots -> won; player death -> lost; score updates; new round auto-starts after 3 s with
    player and bots reset to spawns.
11. HUD (jsdom): health, mag/reserve, active weapon name, score and timer elements reflect state; kill feed shows
    the last kill; hitmarker appears on a registered hit.
12. Audio: mute flag zeroes master gain; each weapon maps to a distinct shot-sound generator; bot gunfire uses a
    positional panner.
13. Sensitivity: changing the slider changes the mouse-look factor used by the controller; value persists in localStorage.
14. Round start refills mag and reserve ammo of every weapon to config values.
15. Fall damage: a fall below the threshold deals 0; above it, damage grows with fall height (pure function test).
16. Bot death: bot enters dead state, stops patrolling/firing, corpse is removed after the configured lifetime.
17. HUD shows an FPS readout with a positive value (jsdom).

## 10. Milestones
- **M1 - Map, movement, collision:** arena geometry, colliders, player controller (WASD/jump/crouch/walk/pointer
  lock/sensitivity), fall damage, AABB tests. Playable walk-around.
- **M2 - Weapons, shooting, HUD:** 3 weapons with full stats, hitscan + head/body hitboxes, reload, spread,
  recoil pattern, HUD incl. dynamic crosshair and FPS counter. Shootable dummies.
- **M3 - Bots, rounds:** humanoid bot model, patrol/LOS/engage/cover AI, damage to player, bot death animation +
  corpse lifetime, round state machine with per-round ammo refill, score, kill feed, damage direction indicator.
- **M4 - Audio, feel, menus:** procedural WebAudio set, viewmodel bob, muzzle flash, sparks/tracers, camera kick,
  start/pause/help menus, mute, final tuning.

## 11. Open questions / risks
- Bot animation is procedural limb swing only (no skeletal system) - enough for v1, keep it simple.
- Procedural gunshots can sound thin; use layered noise burst + click transient + lowpass to keep them punchy.
- Fixed recoil pattern + spread must be visually readable; expose both in config for quick tuning.
- 30-task cap is tight for 4 milestones (~7-8 tasks each); tasks must stay small and test-driven.
