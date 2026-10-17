// Smoothed frames-per-second readout. Raw 1/dt swings a frame or two either way on every
// single frame, which reads as flicker in the HUD, so the meter low-pass filters it:
//   fps += (instant - fps) * (1 - smoothing)
// `smoothing` is the fraction of the previous value kept, so 0 tracks the frame exactly
// and 0.9 averages over roughly ten frames. Clamped below 1 so the meter always converges.
// The first sample seeds the average instead of being blended toward 0 — otherwise every
// session starts by reporting a frame-rate crash.

const DEFAULT_SMOOTHING = 0.9;

export function createFpsMeter(smoothing = DEFAULT_SMOOTHING) {
  const blend = 1 - Math.min(Math.max(smoothing, 0), 0.999);
  let fps = 0;

  return {
    get fps() {
      return fps;
    },

    // Feed the frame delta in seconds; returns the smoothed value. A zero or negative dt
    // (two timestamps in the same millisecond, a paused tab) carries no rate, so it is
    // skipped rather than reporting infinity.
    sample(dt) {
      if (!(dt > 0)) return fps;
      const instant = 1 / dt;
      fps = fps > 0 ? fps + (instant - fps) * blend : instant;
      return fps;
    },

    reset() {
      fps = 0;
    },
  };
}

export default createFpsMeter;
