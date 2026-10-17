// Weapon accuracy: how wide the fire cone currently is, how the crosshair draws it, and
// where a shot actually lands inside it. Every angle here is a cone HALF-angle in radians.
import { MAP } from '../config.js';

const DEG = Math.PI / 180;

function normalize(v) {
  const len = Math.hypot(v.x, v.y, v.z) || 1;
  return { x: v.x / len, y: v.y / len, z: v.z / len };
}

function cross(a, b) {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

// A scope magnifies the view, so the same barrel wobble subtends a smaller fraction of
// the screen: shrink the cone by the zoom factor itself, tan(hip fov/2)/tan(scope fov/2).
// Weapons without a scopeFov cannot aim down sights, so they are unaffected.
function scopeFactor(def) {
  if (!def.scopeFov) return 1;
  return Math.tan((def.scopeFov * DEG) / 2) / Math.tan((MAP.fov * DEG) / 2);
}

// Current cone half-angle. speedRatio is the player's horizontal speed over MOVEMENT
// runSpeed; the move term is defined "at full run speed", so it saturates there instead
// of growing on an air-strafe or a downhill fall. walkMult/crouchMult scale the whole
// cone down, bloom included.
export function computeSpread({
  def,
  speedRatio = 0,
  onGround = true,
  crouched = false,
  walking = false,
  bloom = 0,
  scoped = false,
}) {
  const s = def.spread;
  const move = Math.min(Math.max(speedRatio, 0), 1);

  let total = s.base + s.move * move + bloom;
  if (!onGround) total += s.air;
  if (crouched) total *= s.crouchMult;
  if (walking) total *= s.walkMult;

  return scoped ? total * scopeFactor(def) : total;
}

// Bloom is the extra cone a firing streak stacks on top of the base spread. It lives on
// the weapon state and decays back to 0 — i.e. back to the base spread — once firing stops.
export function addBloom(bloom, def) {
  return bloom + def.spread.bloomPerShot;
}

export function decayBloom(bloom, def, dt) {
  return Math.max(0, bloom - def.spread.bloomDecay * dt);
}

// Camera kick for one shot, 0-based (the first shot of a burst is index 0). The pattern
// repeats past its end while the trigger stays held; recovering back to zero belongs to
// the caller (core/feel), so this stays a pure lookup. Weapons with no pattern have no kick.
export function recoilOffset(def, shotIndex) {
  const p = def.recoilPattern;
  if (!p || p.length === 0) return { pitch: 0, yaw: 0 };
  const [pitch, yaw] = p[((shotIndex % p.length) + p.length) % p.length];
  return { pitch, yaw };
}

// Crosshair gap in pixels: the spread cone projected onto the screen for a vertical fov,
// so the drawn ring matches where the shots actually go.
export function crosshairRadius(spread, fovDeg, viewportHeight) {
  return (Math.tan(spread) / Math.tan((fovDeg * DEG) / 2)) * (viewportHeight / 2);
}

// Random unit direction inside the cone around `dir`, uniform over the cone's disc (the
// sqrt on the radius is what keeps the centre from being over-represented).
export function sampleSpreadDir(dir, spread, rng) {
  const d = normalize(dir);
  if (!(spread > 0)) return d;

  const angle = spread * Math.sqrt(rng());
  const phi = rng() * Math.PI * 2;

  // Any axis not parallel to d spans the plane the cone opens into.
  const ref = Math.abs(d.y) < 0.99 ? { x: 0, y: 1, z: 0 } : { x: 1, y: 0, z: 0 };
  const u = normalize(cross(ref, d));
  const v = cross(d, u);

  const radial = Math.sin(angle);
  const axial = Math.cos(angle);
  const rx = u.x * Math.cos(phi) + v.x * Math.sin(phi);
  const ry = u.y * Math.cos(phi) + v.y * Math.sin(phi);
  const rz = u.z * Math.cos(phi) + v.z * Math.sin(phi);

  return {
    x: d.x * axial + rx * radial,
    y: d.y * axial + ry * radial,
    z: d.z * axial + rz * radial,
  };
}
