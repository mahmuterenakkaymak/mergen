# VISUAL REVIEW — M4 (2026-10-20)

Only capture provided: `game-1366.png` (start / attract screen, laptop). No 390px phone shot and no in-game frame, so HUD, minimap, damage bar, pause and the M4 swoop/lean/horn features are unverified visually this pass.

## Real problems
- game / start overlay — **the hero car is invisible.** `attractPose` aims the camera exactly at the parked car (`lookAt.y: 0`), so it lands at dead screen-centre — behind the keycap legend and the CLICK TO DRIVE pill, and only ~30px at 62m. The first thing a driving game should show is occluded and tiny; the frame reads as a generic street canyon, not "here's your car". (T78)
- game / start overlay — **legend labels wash out.** `.keys` is the only start-screen text with no `text-shadow` (h1/h2/.foot/#go all have one), so "accelerate / brake-reverse" and "orbit camera" lose contrast where they cross a lit facade behind the scrim. (T79)
- Otherwise solid: title gradient, seed subtitle, single-column keycaps, amber pill and footer all read cleanly; the town and lit windows show through the scrim.

## Polish ideas
- Polish: light the parked car's own lamps in attract — tail glow + a faint warm headlight pool — so it reads as "yours, ready" and the dusk town feels inhabited. (T80)
- Polish: subtle mouse-parallax on the overlay (title/legend drift a few px against the cursor) for depth before the click. (T81)
