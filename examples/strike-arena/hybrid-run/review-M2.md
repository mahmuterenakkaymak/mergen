# M2 review (328c445..734595d; T08-T14 + T30-T32; 315 tests green, probed game.js by script)
Matches PLAN/BRIEF: pure core + event list, config-driven, seeded rng, hitscan head/body/wall order, reload exact (1.5 s), spread/crosshair share one cone, HUD plain DOM.
**Bugs (fix tasks T33-T34):**
- B1 main.js calls `input.endFrame()` every frame but `stepGame` (the only consumer of mouse delta/wheel/edges) runs only when steps>=1: at 120-144 Hz look, key edges and pistol clicks are randomly lost.
- B2 Recoil index = lifetime `shotsFired`, never resets: second burst continues mid-pattern (probed: shot 2 kick 0.014 vs 0.011 for a fresh first shot). Contradicts PLAN decision 8.
**Risks (no task):**
- `footstep` event has no `walking` flag; T24 needs "silent when walking" (probed: walking still emits 10 steps in 2 s) - add it when T24 lands.
- Reload started during weapon draw does not tick (`stepWeapons` returns early): reload takes drawRemaining + reloadTime and the bar sits at 0.
- Recoil is written straight into player pitch and never recovers (deferred to T26); sniper/pistol have no kick. Fire rate is tick-quantized (rifle 0.095 s -> 0.1 s, ~30 shots/3 s).
- Carried from M1: first click that requests pointer lock also registers fire/ads; look is applied without lock.
- Dead dummies stay in `world.targets` (alive=false, never respawn) and the player can reach 0 hp with no death handling; acceptable for M2, T18 replaces both.
**Missing tests:** main.js wiring (events -> hitmarker, only `hit` consumed), reload-during-draw, scoped sniper spread through stepGame, wheel wrap/'prev', fall damage via stepGame with a real drop, head vs body kill through stepGame.
