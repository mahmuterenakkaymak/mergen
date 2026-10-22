// Circle-vs-AABB contact resolution in the XZ plane: plain data, no Three.js/DOM.
import { CONFIG } from './config.js';
import { clamp } from './util/math.js';

// Below this the closest-point direction is meaningless: the centre is on or inside the box.
const EPS = 1e-9;

// Pushes `pos` out of `box` along the closest-point normal and drops only the into-wall
// part of `vel`, so the car slides along a face instead of sticking to it.
// `pos` and `vel` are mutated in place; `box` is not.
// ASSUMPTION: no contact returns null; `impact` is the normal speed removed (the closing
// speed damage/thud reads) and `contact` is the point on the box face under the circle.
export function resolveCircleAabb(pos, vel, r, box) {
  const hx = (box.maxX - box.minX) / 2;
  const hz = (box.maxZ - box.minZ) / 2;
  const dx = pos.x - (box.minX + hx);
  const dz = pos.z - (box.minZ + hz);

  const ox = dx - clamp(dx, -hx, hx);
  const oz = dz - clamp(dz, -hz, hz);
  const d = Math.hypot(ox, oz);
  if (d > r) return null;

  let nx, nz, pen;
  if (d > EPS) {
    nx = ox / d;
    nz = oz / d;
    pen = r - d;
  } else {
    // Centre inside the box (a tunnelling step or a bad spawn): escape through the
    // nearest face so the push-out is the shortest one that clears the box.
    const ex = hx - Math.abs(dx);
    const ez = hz - Math.abs(dz);
    nx = 0;
    nz = 0;
    if (ex < ez) {
      nx = dx < 0 ? -1 : 1;
      pen = r + ex;
    } else {
      nz = dz < 0 ? -1 : 1;
      pen = r + ez;
    }
  }

  pos.x += nx * pen;
  pos.z += nz * pen;

  const vn = vel.x * nx + vel.z * nz;
  let impact = 0;
  if (vn < 0) {
    impact = -vn;
    vel.x -= nx * vn;
    vel.z -= nz * vn;
  }

  return { impact, contact: { x: pos.x - nx * r, z: pos.z - nz * r }, normal: { x: nx, z: nz } };
}

// Keeps a circle fully inside the world bounds (the perimeter is a clamp, not an AABB).
// `pos` is mutated in place; returns true when it had to move.
// ASSUMPTION: velocity is left alone — the caller decides what a boundary hit costs the car.
export function clampToBounds(pos, r, bounds) {
  const x = clamp(pos.x, bounds.minX + r, bounds.maxX - r);
  const z = clamp(pos.z, bounds.minZ + r, bounds.maxZ - r);
  if (x === pos.x && z === pos.z) return false;
  pos.x = x;
  pos.z = z;
  return true;
}

// Two circles, each `{ pos, vel, r, mass }`, pushed apart along the centre line with the
// penetration split by inverse mass (a heavier body moves less; mass 0 never moves) and
// the closing normal speed taken out of both, so they separate instead of bouncing.
// `pos` and `vel` of both bodies are mutated in place.
// ASSUMPTION: no restitution and no friction, matching resolveCircleAabb; `impact` is the
// relative normal speed (0 when they were already separating), `contact` sits on a's surface.
export function resolveCircleCircle(a, b) {
  const dx = b.pos.x - a.pos.x;
  const dz = b.pos.z - a.pos.z;
  const sum = a.r + b.r;
  const d = Math.hypot(dx, dz);
  if (d > sum) return null;

  const ia = a.mass > 0 ? 1 / a.mass : 0;
  const ib = b.mass > 0 ? 1 / b.mass : 0;
  const is = ia + ib;
  if (is === 0) return null; // neither body can be moved

  let nx, nz, pen;
  if (d > EPS) {
    nx = dx / d;
    nz = dz / d;
    pen = sum - d;
  } else {
    // Concentric: no direction to separate along, so pick one and push them fully apart.
    nx = 1;
    nz = 0;
    pen = sum;
  }

  const share = pen / is;
  a.pos.x -= nx * share * ia;
  a.pos.z -= nz * share * ia;
  b.pos.x += nx * share * ib;
  b.pos.z += nz * share * ib;

  const rvn = (b.vel.x - a.vel.x) * nx + (b.vel.z - a.vel.z) * nz;
  let impact = 0;
  if (rvn < 0) {
    const j = -rvn / is;
    a.vel.x -= nx * j * ia;
    a.vel.z -= nz * j * ia;
    b.vel.x += nx * j * ib;
    b.vel.z += nz * j * ib;
    impact = -rvn;
  }

  return { impact, contact: { x: a.pos.x + nx * a.r, z: a.pos.z + nz * a.r }, normal: { x: nx, z: nz } };
}

// A frame's worth of driving through the town: `car` (x/z/vx/vz, mutated in place) is
// walked from where it was at the start of the step in substeps small enough that none
// moves it further than r/2, contacts against town.aabbs resolved after each one.
// Returns the hardest contact of the step (the one damage/thud reads) or null.
// ASSUMPTION: `dt` is the already-clamped frame dt, and stepCar has just integrated the
// whole frame — that displacement is undone and re-walked here in substeps.
const MAX_SUBSTEPS = 8;

export function resolveWorld(car, town, dt, r = CONFIG.car.radius) {
  const dx = car.vx * dt;
  const dz = car.vz * dt;
  const steps = clamp(Math.ceil(Math.hypot(dx, dz) / (r / 2)), 1, MAX_SUBSTEPS);
  const h = dt / steps;

  const pos = { x: car.x - dx, z: car.z - dz };
  const vel = { x: car.vx, z: car.vz };
  let worst = null;

  for (let i = 0; i < steps; i++) {
    pos.x += vel.x * h;
    pos.z += vel.z * h;
    for (const box of town.aabbs) {
      const res = resolveCircleAabb(pos, vel, r, box);
      if (res && (!worst || res.impact > worst.impact)) worst = res;
    }
    clampToBounds(pos, r, town.bounds);
  }

  car.x = pos.x;
  car.z = pos.z;
  car.vx = vel.x;
  car.vz = vel.z;
  return worst;
}
