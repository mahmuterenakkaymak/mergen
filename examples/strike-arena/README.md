# Strike Arena

A browser FPS on Three.js and Vite: one procedural arena, you against five bots, round based.
No downloaded assets — the map, the bot bodies, the gun viewmodels and every sound are built
in code.

## Run

```bash
npm install
npm run dev      # vite dev server, http://localhost:5173
npm test         # vitest, whole suite
npm run build    # production bundle in dist/
npm run preview  # serve the built bundle
```

Click **Start** to lock the mouse and open the audio. The browser needs that click: both
pointer lock and the `AudioContext` are refused until a page has had a user gesture.

## Controls

| Key | Action |
| --- | --- |
| `W` `A` `S` `D` / arrows | Move |
| `Shift` | Walk — quiet and accurate |
| `C` / `Ctrl` | Crouch |
| `Space` | Jump |
| `LMB` | Fire |
| `RMB` | Scope (sniper) |
| `1` `2` `3`, wheel | Switch weapon |
| `R` | Reload |
| `M` | Mute |
| `Esc` | Pause |

Esc, an alt-tab or a lost pointer lock pauses the game; the pause menu and the start screen
both carry the mouse sensitivity slider, which is stored in `localStorage` and comes back on
the next visit.

## Layout

`src/core/` is the simulation: plain ES modules, no Three.js and no DOM, every number read
from `src/config.js`. It runs on a fixed 60 Hz step and reports what happened as a list of
events per tick. Everything else — meshes, HUD, audio, menus — is a thin layer that reads the
resulting world and reacts to those events, and never writes gameplay state back.

- `src/main.js` — bootstrap: renderer, scene, world, the frame loop.
- `src/session.js` — start, pause, mute, sensitivity, pointer lock, event fan-out.
- `src/config.js` — every tunable (movement, weapons, bots, rounds, HUD, audio, effects, feel).

Tests live in `tests/`, one file per module; `npm test` runs them all.
