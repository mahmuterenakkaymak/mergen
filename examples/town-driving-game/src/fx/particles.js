// Pure ring-buffer particle pool. Fixed capacity, the oldest slot is recycled when the
// pool wraps, so a burst never allocates. Everything lives in Float32Arrays so the Points
// view can upload them to the GPU without a copy; a dead particle parks far below the
// world, which is how an invisible point stays invisible.
import { CONFIG } from '../config.js';

const OFFSCREEN = -9999;
const GRAVITY = 9; // m/s² for particles that don't state their own

export function createParticles(capacity = CONFIG.fx.particles) {
  return {
    capacity,
    head: 0,
    pos: new Float32Array(capacity * 3).fill(OFFSCREEN),
    vel: new Float32Array(capacity * 3),
    col: new Float32Array(capacity * 3),
    life: new Float32Array(capacity),
    grav: new Float32Array(capacity),
  };
}

// One particle at (x,y,z) with velocity v, visible as (r,g,b) for `life` seconds.
// Returns the slot it landed in; the pool never grows past `capacity`.
export function spawn(pool, x, y, z, vx, vy, vz, life, r, g, b, grav = GRAVITY) {
  const i = pool.head;
  pool.head = (pool.head + 1) % pool.capacity;

  const o = i * 3;
  pool.pos[o] = x; pool.pos[o + 1] = y; pool.pos[o + 2] = z;
  pool.vel[o] = vx; pool.vel[o + 1] = vy; pool.vel[o + 2] = vz;
  pool.col[o] = r; pool.col[o + 1] = g; pool.col[o + 2] = b;
  pool.life[i] = life;
  pool.grav[i] = grav;
  return i;
}

export function stepParticles(pool, dt) {
  for (let i = 0; i < pool.capacity; i++) {
    if (pool.life[i] <= 0) continue;
    pool.life[i] -= dt;
    if (pool.life[i] <= 0) {
      pool.life[i] = 0;
      pool.pos[i * 3 + 1] = OFFSCREEN;
      continue;
    }
    const o = i * 3;
    pool.vel[o + 1] -= pool.grav[i] * dt;
    pool.pos[o] += pool.vel[o] * dt;
    pool.pos[o + 1] += pool.vel[o + 1] * dt;
    pool.pos[o + 2] += pool.vel[o + 2] * dt;
  }
}

// Sparks: a short orange fan thrown up and off a scrape.
// ASSUMPTION: presets take the caller's rng so a seeded run replays identically (PLAN determinism);
// the prototype's Math.random is what made its FX unreproducible.
export function burstSparks(pool, rng, x, y, z, n = 10) {
  for (let k = 0; k < n; k++) {
    spawn(pool, x, y, z, rng.range(-5, 5), rng.range(2, 7), rng.range(-5, 5),
      rng.range(0.25, 0.55), 1, rng.range(0.55, 0.8), 0.15);
  }
}

// Smoke: one slow grey puff off the bonnet, spawned while the engine smokes.
export function puffSmoke(pool, rng, x, y, z) {
  spawn(pool, x, y, z, rng.range(-0.5, 0.5), rng.range(1.2, 2.2), rng.range(-0.5, 0.5),
    rng.range(0.6, 1.1), 0.35, 0.35, 0.37, 0.6);
}
