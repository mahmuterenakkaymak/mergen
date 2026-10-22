// Scalar helpers shared by the sim. Angles are radians; wrapAngle range is [-PI, PI).
export const TAU = Math.PI * 2;

export function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function lerp(a, b, t) {
  return a + (b - a) * t;
}

// Exponential smoothing toward b; rate k per second, frame-rate independent.
export function damp(a, b, k, dt) {
  return a + (b - a) * (1 - Math.exp(-k * dt));
}

export function wrapAngle(a) {
  const w = (a + Math.PI) % TAU;
  return (w < 0 ? w + TAU : w) - Math.PI;
}

// Interpolate a→b along the short way round.
export function angLerp(a, b, t) {
  return wrapAngle(a + wrapAngle(b - a) * t);
}
