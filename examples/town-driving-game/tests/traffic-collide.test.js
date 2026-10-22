import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createGame, stepGame } from '../src/game.js';

const DT = 1 / 60;
const R = CONFIG.car.radius;
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: 0, horn: 0 };

const thuds = (w) => w.events.filter((e) => e.type === 'thud');
const gap = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const alive = (w) => Array.from(w.particles.life).filter((l) => l > 0).length;

// One AI car on the player's own line, aimed straight back at it: the single waypoint is
// the player's spawn, so stepTraffic never steers it off the test line. `dist` defaults to
// an already-overlapping pair, which puts the contact on the very first step.
function setup({ speed = 0, aiSpeed = 0, dist = 2 * R - 0.5 } = {}) {
  const w = createGame();
  const car = w.car;
  const h = car.heading;
  car.vx = Math.sin(h) * speed;
  car.vz = Math.cos(h) * speed;
  car.speed = speed;

  w.traffic.length = 1; // the rest of the town stays out of the way
  const c = w.traffic[0];
  c.x = car.x + Math.sin(h) * dist;
  c.z = car.z + Math.cos(h) * dist;
  c.speed = aiSpeed;
  c.heading = Math.atan2(car.x - c.x, car.z - c.z);
  c.waypoints = [{ x: car.x, z: car.z }];
  c.wp = 0;
  return { w, car, c };
}

function runUntilHit(w, frames = 300) {
  for (let i = 0; i < frames; i++) {
    stepGame(w, idle, DT);
    if (thuds(w).length) return thuds(w)[0];
  }
  return null;
}

describe('traffic in the sim', () => {
  it('the town comes with traffic, and it drives its loops', () => {
    const w = createGame();
    expect(w.traffic).toHaveLength(CONFIG.traffic.count);
    const c = w.traffic[0];
    const { x, z } = c;
    for (let i = 0; i < 60; i++) stepGame(w, idle, DT);
    expect(Math.hypot(c.x - x, c.z - z)).toBeGreaterThan(1);
  });
});

describe('traffic vs player', () => {
  it('a head-on hit at speed thuds, costs paint, shakes the camera and throws sparks', () => {
    const { w, car, c } = setup({ speed: 20, aiSpeed: CONFIG.traffic.speed, dist: 12 });
    const thud = runUntilHit(w);

    expect(thud).toBeTruthy();
    expect(thud.speed).toBeGreaterThan(5);
    expect(thud.shake).toBeGreaterThan(0);
    expect(thud.vignette).toBeGreaterThan(0);
    expect(w.damage.damage).toBeGreaterThan(0);
    expect(w.cam.shake).toBeGreaterThan(0);
    expect(alive(w)).toBeGreaterThan(0);

    // sparks at the sheeted metal, not at either car centre
    const p = w.particles.pos;
    for (let i = 0; i < w.particles.capacity; i++) {
      if (w.particles.life[i] <= 0) continue;
      expect(Math.abs(p[i * 3] - thud.contact.x)).toBeLessThan(0.5);
      expect(Math.abs(p[i * 3 + 2] - thud.contact.z)).toBeLessThan(0.5);
    }

    expect(car.speed).toBeLessThan(20); // the hit took speed off the player
    expect(c.speed).toBe(0); // and the car it landed on stops dead
  });

  it('pushes the two cars apart instead of letting one drive through the other', () => {
    const { w, car, c } = setup({ speed: 20, aiSpeed: CONFIG.traffic.speed });
    stepGame(w, idle, DT);
    expect(gap(car, c)).toBeGreaterThanOrEqual(2 * R - 1e-6);
  });

  it('a nudge under 5 m/s pushes but is not a hit', () => {
    const { w, car, c } = setup({ speed: 3, aiSpeed: 1.5 });
    stepGame(w, idle, DT);
    expect(thuds(w)).toHaveLength(0);
    expect(w.damage.damage).toBe(0);
    expect(w.cam.shake).toBe(0);
    expect(alive(w)).toBe(0);
    expect(gap(car, c)).toBeGreaterThanOrEqual(2 * R - 1e-6);
  });

  it('a 5-6 m/s bump thuds and sparks but costs no paint (damage.js keeps its own 6 m/s floor)', () => {
    const { w } = setup({ aiSpeed: 6 });
    stepGame(w, idle, DT);
    const hits = thuds(w);
    expect(hits).toHaveLength(1);
    expect(hits[0].speed).toBeGreaterThan(5);
    expect(hits[0].speed).toBeLessThan(6);
    expect(alive(w)).toBeGreaterThan(0);
    expect(w.damage.damage).toBe(0);
  });

  it('sparks fly: the pool steps with the sim', () => {
    const { w } = setup({ speed: 20, aiSpeed: CONFIG.traffic.speed, dist: 12 });
    expect(runUntilHit(w)).toBeTruthy();
    const i = w.particles.life.findIndex((l) => l > 0);
    const y = w.particles.pos[i * 3 + 1];
    stepGame(w, idle, DT);
    expect(w.particles.pos[i * 3 + 1]).not.toBe(y);
  });

  it('a hit never leaves the player inside a building or outside the bounds', () => {
    const { w, car } = setup({ speed: 25, aiSpeed: CONFIG.traffic.speed, dist: 12 });
    const b = w.town.bounds;
    for (let i = 0; i < 120; i++) {
      stepGame(w, idle, DT);
      expect(car.x).toBeGreaterThanOrEqual(b.minX + R - 1e-9);
      expect(car.x).toBeLessThanOrEqual(b.maxX - R + 1e-9);
      expect(car.z).toBeGreaterThanOrEqual(b.minZ + R - 1e-9);
      expect(car.z).toBeLessThanOrEqual(b.maxZ - R + 1e-9);
      for (const box of w.town.aabbs) {
        const dx = Math.max(box.minX - car.x, car.x - box.maxX, 0);
        const dz = Math.max(box.minZ - car.z, car.z - box.maxZ, 0);
        expect(Math.hypot(dx, dz)).toBeGreaterThanOrEqual(R - 1e-6);
      }
    }
  });
});
