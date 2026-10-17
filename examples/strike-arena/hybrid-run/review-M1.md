# M1 review (b04f607..328c445; T01-T07 done; 172 tests + build green)
Matches PLAN/BRIEF: pure core, config-driven numbers, <=4 arena meshes, fixed 60 Hz loop, fall damage as pure fn, AABB resolver shared.
**Bugs (fix tasks T30-T32):**
- B1 `applyLook` (movement.js): mouse right turns view left (yaw += dx, forward = -sin/-cos). No test checks direction.
- B2 index.html: empty full-screen `#menu` (no pointer-events:none) covers the canvas -> click-to-lock in main.js never fires.
- B3 mapData `COVER_POINTS`: 6/10 `facing` values point away from their crate (mid_north/south, stack_*, west/east_near). Would make M3 bots hide facing the wrong way.
**Risks (no task):**
- Mouse deltas are applied without pointer lock (input.js listens on window), so the camera spins on hover once B2 is fixed and again after Esc; T29 pause must gate look on lock.
- `loop.js` comment says big frames are "discarded"; code clamps to maxFrame (15 catch-up steps). Matches PLAN, comment is wrong.
- Pitch clamp is exactly +/-PI/2; no sub-degree margin. Crouch eye height snaps instantly. No terminal velocity/swept test (thin 0.6 m stack base is safe at current speeds).
- First click (lock request) also registers fire/ads edges in input.js: will shoot on lock in M2.
**Missing tests:** main.js wiring (lock, resize, look sign), cover facing, crouch/uncrouch in mid-air, jump onto a crate (landed value), resolveMove with two adjacent colliders at a corner, waypoint links for a 0.6 m body (checked ad hoc: all clear today).
