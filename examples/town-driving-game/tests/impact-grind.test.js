import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createGame, stepGame } from '../src/game.js';

const DT = 1 / 60;
const R = CONFIG.car.radius;
const gas = { throttle: 1, brake: 0, steer: 0, handbrake: 0, horn: 0 };

const impacts = (w) => w.events.filter((e) => e.type === 'impact');

describe('impact event threshold (T67)', () => {
  it('emits no impact while grinding a wall at crawl', () => {
    const w = createGame();
    const box = w.town.aabbs[0]; // buildings come first in the collider list
    const car = w.car;
    car.x = (box.minX + box.maxX) / 2;
    car.z = box.minZ - R; // touching the face
    car.heading = 0; // faces +z, straight into the wall
    car.vx = 0;
    car.vz = 0;

    for (let i = 0; i < 120; i++) {
      stepGame(w, gas, DT);
      expect(car.speed).toBeLessThan(1); // pinned at the face, never launched
      expect(impacts(w)).toHaveLength(0); // grinding (< MIN_IMPACT) is not a hit
    }
  });

  it('emits exactly one impact on a 25 m/s hit', () => {
    const w = createGame();
    const box = w.town.aabbs[0];
    const car = w.car;
    car.x = (box.minX + box.maxX) / 2;
    car.z = box.minZ - R - 3; // short runway; speed set directly
    car.heading = 0;
    car.vz = 25;

    let count = 0;
    let peak = 0;
    for (let i = 0; i < 120; i++) {
      stepGame(w, gas, DT);
      for (const e of impacts(w)) {
        count++;
        peak = Math.max(peak, e.speed);
      }
    }

    expect(count).toBe(1); // the slam, then only sub-threshold grinding
    expect(peak).toBeGreaterThan(24);
  });
});
