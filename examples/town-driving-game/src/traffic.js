// AI traffic: cars loop the perimeter of a block in its right lane, follow the
// corner waypoints, and stop for the player when it is close and ahead.
import { CONFIG } from './config.js';
import { angLerp, damp, wrapAngle, lerp } from './util/math.js';

const YIELD_DIST = 11; // m: a player this close, dead ahead, makes a car stop
const YIELD_CONE = 0.7; // rad half-angle of the forward cone it watches
const WP_REACH = 6; // m to a corner before aiming at the next one
const TURN_RATE = 4; // how fast heading eases toward the waypoint bearing
const ACCEL_RATE = 1.5; // per-second approach to cruise speed
const BRAKE_RATE = 5; // per-second approach to a stop

// The right-lane loop is the rectangle inset road/4 from the block's four road
// centre lines, walked clockwise so the block stays on the driver's right — which
// puts each side of a shared road in the correct lane for its direction of travel.
function loopCorners(b, hw) {
  const x0 = b.x - hw, x1 = b.x + b.w + hw;
  const z0 = b.z - hw, z1 = b.z + b.h + hw;
  return [{ x: x0, z: z0 }, { x: x1, z: z0 }, { x: x1, z: z1 }, { x: x0, z: z1 }];
}

export function makeTraffic(rng, town, cfg = CONFIG) {
  const hw = cfg.road / 4;
  const speed = cfg.traffic.speed;
  const cars = [];
  for (let i = 0; i < cfg.traffic.count; i++) {
    const corners = loopCorners(rng.pick(town.blocks), hw);
    const k = rng.int(0, 3);
    const a = corners[k];
    const b = corners[(k + 1) % 4];
    const t = rng.float();
    cars.push({
      x: lerp(a.x, b.x, t),
      z: lerp(a.z, b.z, t),
      heading: Math.atan2(b.x - a.x, b.z - a.z), // forward = (sin h, cos h)
      speed,
      cruise: speed,
      wp: (k + 1) % 4,
      waypoints: corners,
      color: rng.pick(cfg.colors.traffic),
    });
  }
  return cars;
}

export function stepTraffic(cars, player, dt) {
  for (const c of cars) {
    let tgt = c.waypoints[c.wp];
    if (Math.hypot(tgt.x - c.x, tgt.z - c.z) < WP_REACH) {
      c.wp = (c.wp + 1) % c.waypoints.length;
      tgt = c.waypoints[c.wp];
    }
    c.heading = angLerp(c.heading, Math.atan2(tgt.x - c.x, tgt.z - c.z), 1 - Math.exp(-TURN_RATE * dt));

    let target = c.cruise;
    if (player) {
      const px = player.x - c.x, pz = player.z - c.z;
      if (Math.hypot(px, pz) <= YIELD_DIST && Math.abs(wrapAngle(Math.atan2(px, pz) - c.heading)) < YIELD_CONE) {
        target = 0;
      }
    }
    c.speed = damp(c.speed, target, target > c.speed ? ACCEL_RATE : BRAKE_RATE, dt);
    c.x += Math.sin(c.heading) * c.speed * dt;
    c.z += Math.cos(c.heading) * c.speed * dt;
  }
  return cars;
}
