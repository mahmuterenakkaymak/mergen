// HUD number formatting, pure: sim state in, display numbers out (no DOM, no Three.js).
import { clamp, damp } from '../util/math.js';

const MS_TO_KMH = 3.6;
// ASSUMPTION: gear thresholds are the prototype's inline ones (forward speed < -0.6, brake held below 0.5); no config.js keys.
const REVERSE_V = -0.6; // m/s forward speed below which the car is in R
const CREEP_V = 0.5; // m/s: brake held at (near) a standstill => R, the gear the car is about to take
const TWEEN_K = 14; // 1/s, how fast a readout catches its target
const TWEEN_SNAP = 0.5; // readout units: closer than this, the tween lands on the target

export function toKmh(speed) {
  return Math.round(Math.abs(speed) * MS_TO_KMH);
}

export function gearLetter(forwardVel, brake = 0) {
  return forwardVel < REVERSE_V || (brake > 0 && forwardVel < CREEP_V) ? 'R' : 'D';
}

// ASSUMPTION: the sim stores damage 0-100 (T29), so this clamps and rounds instead of rescaling a fraction.
export function damagePct(damage) {
  return Math.round(clamp(damage, 0, 100));
}

// Exponential approach for a readout that would otherwise flicker every frame; frame-rate independent.
export function tweenNumber(value, target, dt) {
  if (Math.abs(target - value) < TWEEN_SNAP) return target;
  return damp(value, target, TWEEN_K, dt);
}
