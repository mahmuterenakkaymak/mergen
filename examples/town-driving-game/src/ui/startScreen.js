// Start screen overlay (gradient title, seed subtitle, keycaps, pulsing pill, footer)
// plus the pure attract-orbit pose the camera holds behind it.
import '../style.css';
import { CONFIG } from '../config.js';
import { clamp } from '../util/math.js';

// Aim above the car, never at it: a ground-level look target lands the parked hero car at
// dead frame centre, which the keycap legend and the pill cover.
// Height and radius are one decision, not two tunables: at 30 m the camera is still under
// the tallest towers, so the ring has to run between their footprints — 42 m sits in the
// one gap around the spawn, past the tower that ends 37.7 m out, before the next at 45.0 m.
const ORBIT_R = 42; // m — attract orbit radius over the town
const ORBIT_H = 30; // m — attract orbit height
const ORBIT_W = 0.08; // rad/s — slow enough to read the town
export const LOOK_H = 12; // m — raises the frame so the car sits in the lower third, below the pill

// Mouse parallax: the text layers drift a few pixels against the pointer, by different
// amounts, so the flat overlay reads as stacked depth before the game even starts.
const PARALLAX = 10; // px at the screen edge — a drift, not a slide

// Pure: pointer px + viewport px → the shift of one layer, opposite the pointer.
// Clamped so a pointer reported outside the viewport cannot pull a layer further out.
export function parallaxShift(clientX, clientY, vw, vh, depth) {
  const nx = clamp(clientX / vw - 0.5, -0.5, 0.5) * 2;
  const ny = clamp(clientY / vh - 0.5, -0.5, 0.5) * 2;
  return { x: -nx * PARALLAX * depth, y: -ny * PARALLAX * depth };
}

// Pure: t in seconds, center {x, z} — a slow circle at fixed height, looking at the center.
export function attractPose(t, center) {
  const a = t * ORBIT_W;
  return {
    x: center.x + Math.sin(a) * ORBIT_R,
    y: ORBIT_H,
    z: center.z + Math.cos(a) * ORBIT_R,
    lookAt: { x: center.x, y: LOOK_H, z: center.z },
  };
}

// Builds the full-screen overlay into doc.body. The first click fades it out and
// fires onStart() once — that click is also the gesture later tasks start audio on.
// ASSUMPTION: the task puts the seed in the subtitle (the prototype shows it in the
// footer); the footer keeps the rest of the prototype's line.
export function createStartScreen(doc, { seed = CONFIG.seed, onStart = () => {} } = {}) {
  const el = doc.createElement('div');
  el.id = 'start';
  // Static markup, no user input.
  el.innerHTML = `
    <h1>TOWN DRIVE</h1>
    <h2>V3 · SEED ${seed} · PROCEDURAL TOWN SANDBOX</h2>
    <div class="keys">
      <div><kbd>W</kbd><kbd>S</kbd> accelerate / brake-reverse</div>
      <div><kbd>A</kbd><kbd>D</kbd> steer</div>
      <div><kbd>SPACE</kbd> handbrake (drift)</div>
      <div><kbd>H</kbd> horn</div>
      <div><kbd>R</kbd> reset &amp; repair</div>
      <div><kbd>DRAG</kbd> orbit camera</div>
    </div>
    <div id="go">CLICK TO DRIVE</div>
    <div class="foot">same town every run</div>
  `;
  // The legend answers the keyboard while the overlay is up: pressing a shown key
  // lights its cap, so the controls are taught by doing, not by reading. Keys never
  // start the game — only the click below does.
  const caps = new Map();
  for (const kbd of el.querySelectorAll('kbd')) caps.set(kbd.textContent.trim(), kbd);
  const capFor = (e) => caps.get(e.key === ' ' ? 'SPACE' : e.key.toUpperCase());
  const onDown = (e) => capFor(e)?.classList.add('lit');
  const onUp = (e) => capFor(e)?.classList.remove('lit');
  doc.addEventListener('keydown', onDown);
  doc.addEventListener('keyup', onUp);

  // Depth under the cursor: the title sits nearest and the legend behind it, so the layers
  // separate as they ease against the pointer. `translate`, not `transform` — fadeUp and
  // titleDrift animate `transform`, and an animation there outranks an inline style.
  const layers = [
    [el.querySelector('h1'), 1],
    [el.querySelector('h2'), 0.7],
    [el.querySelector('.keys'), 0.45],
  ];
  const onMove = (e) => {
    for (const [node, depth] of layers) {
      const s = parallaxShift(e.clientX, e.clientY, el.clientWidth, el.clientHeight, depth);
      node.style.translate = `${s.x.toFixed(1)}px ${s.y.toFixed(1)}px`;
    }
  };
  el.addEventListener('pointermove', onMove);

  let fired = false;
  el.addEventListener('click', () => {
    if (fired) return;
    fired = true;
    doc.removeEventListener('keydown', onDown);
    doc.removeEventListener('keyup', onUp);
    el.removeEventListener('pointermove', onMove);
    el.classList.add('hide');
    onStart();
  });
  doc.body.appendChild(el);
  return { el };
}
