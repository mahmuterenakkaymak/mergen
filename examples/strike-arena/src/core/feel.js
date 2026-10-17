// Math the presentation layer needs on top of world state: bearings and offsets the HUD
// and renderer read, never write. Pure and free of Three.js/DOM, so the numbers are
// testable without a canvas.
//
// Everything here is a *presentation* value: the core has already decided where the
// camera is, where it looks and what it sees. Bob, sway, kick and dip are layered on top
// of that, and none of them feeds back into a shot — the aim a hit uses is the core's.
import { CONFIG } from '../config.js';

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// Exponential approach: frame-rate independent and never overshoots, which is what every
// offset below wants — a bob or a kick that swings past rest looks like a bug.
const approach = (current, target, dt, rate) => current + (target - current) * (1 - Math.exp(-rate * dt));

// Bearing of `sourcePos` in the player's own frame, for the damage direction indicator:
// 0 straight ahead, +PI/2 to the right, +/-PI behind, -PI/2 to the left. Horizontal only
// — a shot fired from a ledge above still came from that compass direction, and the arc
// has no vertical axis to point at.
//
// Yaw follows the core convention (yaw 0 looks toward -Z, positive turns left), so the
// forward axis is (-sin yaw, -cos yaw) and the right axis its perpendicular.
export function damageIndicatorAngle(playerPos, playerYaw, sourcePos) {
  const dx = sourcePos.x - playerPos.x;
  const dz = sourcePos.z - playerPos.z;
  const ahead = dx * -Math.sin(playerYaw) + dz * -Math.cos(playerYaw);
  const right = dx * Math.cos(playerYaw) + dz * -Math.sin(playerYaw);
  return Math.atan2(right, ahead);
}

// Walk bob as a view-space offset {x right, y up} in meters.
//
// `speedRatio` is the player's horizontal speed over run speed (0..1) and scales the
// amplitude only, so standing still is exactly 0 rather than a small tremor. The frequency
// is fixed: folding the ratio into the phase would re-scale the whole elapsed time on every
// speed change, and the offset would jump by `time * Δratio * 2π * bobFrequency` radians —
// jitter that grows the longer a session runs. The vertical term runs at twice the
// side-to-side term, which turns two sine waves into the figure-eight a head traces while
// walking instead of a straight up-and-down pump.
//
// `time` is elapsed seconds; the caller owns the clock.
export function viewBob(time, speedRatio, crouched = false) {
  const f = CONFIG.FEEL;
  const r = clamp(speedRatio, 0, 1);
  if (r <= 0) return { x: 0, y: 0 };

  const amp = r * (crouched ? f.crouchBobMult : 1);
  const phase = time * 2 * Math.PI * f.bobFrequency;
  return {
    x: Math.sin(phase) * f.bobSide * amp,
    y: Math.sin(2 * phase) * f.bobUp * amp,
  };
}

// Mouse sway: the muzzle trails the turn instead of snapping to it.
//
// Feed it the radians the view moved in the last frame (this frame's yaw/pitch minus the
// last frame's — no need to know the look gain or sensitivity that produced them). A turn
// pushes the offset away from rest and the same rate pulls it back, so a flick swings the
// gun out and lets it catch up.
//
// Sign: yaw increases to the left, so a left turn leaves the gun momentarily to the right
// (+x); pitch increases upward, so looking up leaves it momentarily below (-y).
export function createMouseSway() {
  const f = CONFIG.FEEL;
  const sway = {
    x: 0,
    y: 0,

    update(dt, dYaw = 0, dPitch = 0) {
      const tx = clamp(dYaw * f.swayTurn, -f.swayMax, f.swayMax);
      const ty = -clamp(dPitch * f.swayTurn, -f.swayMax, f.swayMax);
      sway.x = approach(sway.x, tx, dt, f.swayLag);
      sway.y = approach(sway.y, ty, dt, f.swayLag);
      return sway;
    },

    reset() {
      sway.x = 0;
      sway.y = 0;
      return sway;
    },
  };
  return sway;
}

// Camera kick: the visual punch of a shot, on top of the recoil the core has already
// applied to the aim. It is deliberately never added to player.pitch — the next shot must
// be aimed where the crosshair says, not where the screen happens to be mid-kick.
export function createCameraKick() {
  const f = CONFIG.FEEL;
  const kick = {
    pitch: 0,
    yaw: 0,

    addKick(pitch = 0, yaw = 0) {
      kick.pitch = clamp(kick.pitch + pitch, -f.kickMax, f.kickMax);
      kick.yaw = clamp(kick.yaw + yaw, -f.kickMax, f.kickMax);
      return kick;
    },

    update(dt) {
      kick.pitch = approach(kick.pitch, 0, dt, f.kickRecover);
      kick.yaw = approach(kick.yaw, 0, dt, f.kickRecover);
      // Exponential decay never reaches 0, and a camera 1e-7 rad off level forever is not
      // worth the float noise.
      if (Math.abs(kick.pitch) < f.kickEpsilon) kick.pitch = 0;
      if (Math.abs(kick.yaw) < f.kickEpsilon) kick.yaw = 0;
      return kick;
    },

    reset() {
      kick.pitch = 0;
      kick.yaw = 0;
      return kick;
    },
  };
  return kick;
}

// How far the camera sinks on landing, in meters, from the height fallen. Linear in the
// height (a two-meter step is twice the jolt of a one-meter one) and capped, so a fall
// from a tower dips the view no further than the cap rather than burying the floor.
export function landingDip(fallHeight) {
  const f = CONFIG.FEEL;
  if (!(fallHeight > 0)) return 0;
  return Math.min(f.landDipMax, fallHeight * f.landDipPerMeter);
}

// One frame of the scope fov sweep: moves `current` toward `target` at a constant
// degrees/second and lands exactly on the target rather than creeping up to it.
//
// Constant speed (rather than a fixed fraction of the remaining distance) is what makes
// the sweep finish: exponential easing is asymptotic and would still be "in transition"
// a second after the scope opened.
export function scopeFov(current, target, dt) {
  const f = CONFIG.FEEL;
  const step = f.scopeFovSpeed * Math.max(0, dt);
  const delta = target - current;
  if (Math.abs(delta) <= step) return target;
  return current + Math.sign(delta) * step;
}
