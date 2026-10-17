// Fixed-timestep accumulator. The simulation always advances in exact `step`-length
// ticks, so physics behaves the same at 30, 60 or 144 fps and stays reproducible.
import { LOOP } from '../config.js';

// N * step is a hair below N in binary floating point, so a plain floor would drop the
// last step when the frame delta is an exact multiple of the step.
const EPS = 1e-9;

export function createFixedLoop(step = LOOP.step, maxFrame = LOOP.maxFrame) {
  let accumulator = 0;

  return {
    // frameDt: wall-clock seconds since the previous call. Frame deltas above maxFrame
    // (backgrounded tab, breakpoint) are discarded rather than caught up on.
    // Returns how many fixed steps to run, plus alpha: the leftover fraction of a step,
    // for renderers that want to interpolate between the last two simulation states.
    advance(frameDt) {
      const dt = Number.isFinite(frameDt) ? Math.min(Math.max(frameDt, 0), maxFrame) : 0;
      accumulator += dt;

      const steps = Math.floor(accumulator / step + EPS);
      accumulator = Math.max(accumulator - steps * step, 0);

      return { steps, alpha: accumulator / step };
    },

    reset() {
      accumulator = 0;
    },
  };
}
