# M4 review (df5c4e8..e56b6fa; T23-T29 + T35/T36; probed by script; suite 530/530 green, build ok)
Matches PLAN/BRIEF: audio, effects, feel, menu, safety and session wiring follow the pure-core + event design; AT1, AT12 (unit level), AT13 hold; recovery of a player dropped below the floor probed OK (no fall damage).
**Bugs (fix tasks T37-T39):**
- B1 `feel.viewBob` phase = time*freq*speedRatio: any speed change jumps the phase (0.023 m per 1% at t=600 s), so the run-up bob is random jitter of camera + gun.
- B2 `audio.setListener` is never called in src: the listener stays at the origin, so bot gunfire is not directional relative to the player (brief/AT12 only passes in the unit test).
- B3 Bot tracers have no end point: 13 of 13 probed bot tracers end outside the arena (through walls and the player); `botShot` has no hit info.
**Risks (no task):**
- `botStuckTick` duplicates patrolStep's own stuckTime watchdog (same 2.5 s, patrolStep resets the leg first), so it never fires in-game; engage/cover bots have no watchdog (not probed).
- Esc-resume calls requestPointerLock right after the browser-forced exit; Chrome may refuse for ~1 s, leaving the game running unlocked until a canvas click.
- Muzzle flash and player tracer start at the eye, not the viewmodel `muzzle`; sway also reacts to core recoil yaw/pitch; bot hits on the player give no spark/hit effect.
- `needsRecovery` ignores the ceiling by design, so a player pushed over the bounds top is never reset; `ctx.resume()` rejection is unhandled.
**Missing tests:** `main.js` wiring (kick/bob/land dip/sway, viewmodel offset) has none; bob continuity across speed changes; listener updates; bot tracer length; stuck engaged bot; pointer-lock refusal path.
