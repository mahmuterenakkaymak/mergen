import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createGame, stepGame } from '../src/game.js';
import { createRng } from '../src/util/rng.js';

const DT = 1 / 60;
const R = CONFIG.car.radius;
const gas = { throttle: 1, brake: 0, steer: 0, handbrake: 0, horn: 0 };

// Gap from a point to the box face: 0 on the surface, >= R means the car circle clears it.
function faceGap(x, z, box) {
  const dx = Math.max(box.minX - x, x - box.maxX, 0);
  const dz = Math.max(box.minZ - z, z - box.maxZ, 0);
  return Math.hypot(dx, dz);
}

describe('town integration in stepGame', () => {
  it('spawns the car at the town spawn point', () => {
    const w = createGame();
    expect(w.car.x).toBe(w.town.spawn.x);
    expect(w.car.z).toBe(w.town.spawn.z);
    expect(w.car.heading).toBe(w.town.spawn.heading);
  });

  it('a full-speed hit stops the car at the building face', () => {
    const w = createGame();
    const box = w.town.aabbs[0]; // buildings come first in the collider list
    const car = w.car;
    car.x = (box.minX + box.maxX) / 2;
    car.z = box.minZ - R - 3;
    car.heading = 0; // faces +z, straight at the wall
    car.vz = CONFIG.car.maxSpeed; // a 3 m runway is too short to accelerate down

    let impact = null;
    for (let t = 0; t < 2; t += DT) {
      stepGame(w, gas, DT);
      expect(faceGap(car.x, car.z, box)).toBeGreaterThanOrEqual(R - 1e-6); // never inside
      if (!impact) impact = w.events.find((e) => e.type === 'impact') ?? null;
    }

    expect(impact).toBeTruthy();
    expect(impact.speed).toBeGreaterThan(25); // hit at near full speed
    expect(impact.contact.z).toBeCloseTo(box.minZ, 6);
    expect(impact.contact.x).toBeGreaterThanOrEqual(box.minX);
    expect(impact.contact.x).toBeLessThanOrEqual(box.maxX);

    expect(car.speed).toBeLessThan(0.5); // pinned at the wall, not revving
    expect(faceGap(car.x, car.z, box)).toBeLessThan(R + 0.05); // stopped at the face, not bounced back
  });

  it('200 seeded random-input runs never end inside a box or outside the bounds', () => {
    for (let seed = 0; seed < 200; seed++) {
      const rng = createRng(seed);
      const w = createGame();
      for (let i = 0; i < 150; i++) {
        stepGame(w, {
          throttle: rng.float() < 0.75 ? 1 : 0,
          brake: rng.float() < 0.1 ? 1 : 0,
          steer: rng.range(-1, 1),
          handbrake: rng.float() < 0.08 ? 1 : 0,
          horn: 0,
        }, DT);
      }
      const { x, z } = w.car;
      const b = w.town.bounds;
      expect(x).toBeGreaterThanOrEqual(b.minX + R - 1e-9);
      expect(x).toBeLessThanOrEqual(b.maxX - R + 1e-9);
      expect(z).toBeGreaterThanOrEqual(b.minZ + R - 1e-9);
      expect(z).toBeLessThanOrEqual(b.maxZ - R + 1e-9);
      for (const box of w.town.aabbs) {
        expect(faceGap(x, z, box)).toBeGreaterThanOrEqual(R - 1e-6);
      }
    }
  });
});
