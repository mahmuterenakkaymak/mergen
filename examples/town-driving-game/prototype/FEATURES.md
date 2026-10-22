# Prototype Features

Single file: `index.html` (Three.js r160 from CDN via import map). Open it directly or serve the folder; click the start screen to drive.

## Core (from the brief)

- Drivable arcade car: W/S accelerate + brake-then-reverse, A/D steer; speed-dependent turn authority — no pivoting at standstill; dt-based physics, frame-rate independent.
- Seeded procedural town (seed 20261020): 6x6 grid of blocks, roads with dashed center lines, randomized buildings, identical layout every run.
- Third-person chase camera: hold-drag mouse to orbit, wheel to zoom (5.5-20 m), camera lerps smoothly and never clips below ground.
- Circle-vs-AABB collision vs buildings, trees and perimeter walls: push-out + kill the into-wall speed component — stops at the wall face, never tunnels.
- Space handbrake with reduced lateral grip: real handbrake turns / drifts, not just a brake.

## Feel / alive details

- Engine sound: WebAudio dual-oscillator engine whose pitch and lowpass open with speed; load-dependent volume; starts on the click gesture.
- Tire squeal: filtered noise loop whose gain rides the lateral slip — you hear the drift start before you see it.
- Impact thud: lowpassed noise burst scaled by impact speed; horn on H (two-tone square).
- Skid marks: pooled instanced quads laid at the rear wheels whenever slipping — the town accumulates your lines.
- Spark burst particles on every hard hit; gray exhaust smoke from the hood past 60% damage.
- Screen shake on impact (decaying camera jitter) + red vignette flash proportional to damage taken.
- Speed feel: FOV widens from 62 to 73 with speed; wheels spin with ground speed; front wheels visibly steer; brake lights glow red when braking.
- Damage system: hard hits fill a HUD damage bar, body paint visibly darkens, engine smokes, toast warns "overheating"; R resets and repairs.
- Live traffic: 14 AI cars loop block-perimeter routes, steer into corners, and yield/stop when the player blocks their lane; T-boning them shakes the screen and dents your bar.
- Pedestrians: 26 walking NPCs with leg-swing and bob animation on sidewalks; get clipped and they panic-run away from the car, with a "WATCH OUT!" toast.
- Minimap: rounded translucent panel, static layer (roads, parks, buildings) pre-rendered, live player arrow + red traffic dots + ped dots.
- HUD: big tabular speedometer in km/h with D/R gear letter, damage bar with green→red gradient, controls hint strip.
- Start screen: gradient title, keycap-styled control list, pulsing "CLICK TO DRIVE" pill, and an attract-mode camera slowly orbiting the town behind the overlay.
- Town variety: parks with trees and ponds, taller towers toward downtown (distance-from-center height falloff), per-building canvas facade textures with randomly lit windows, roof caps, instanced streetlights at every intersection, red/white striped perimeter walls.
- Atmosphere: canvas-gradient sky dome, warm directional sun with soft shadows that follows the car, distance fog matched to the horizon, grass beyond the walls.

## Notes

- Not browser-tested in this environment (no browser available); JS passed a syntax check. If something misrenders, open the console and report the first error.
- CDN import per sketch instructions; the real product must vendor Three.js (brief §8 offline rule).
