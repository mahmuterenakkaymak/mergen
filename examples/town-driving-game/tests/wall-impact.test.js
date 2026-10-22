import { describe, it, expect } from 'vitest';
import { CONFIG } from '../src/config.js';
import { createGame, stepGame } from '../src/game.js';

const DT = 1 / 60;
const R = CONFIG.car.radius;
const idle = { throttle: 0, brake: 0, steer: 0, handbrake: 0, horn: 0 };
const gas = { throttle: 1, brake: 0, steer: 0, handbrake: 0, horn: 0 };

const impacts = (w) => w.events.filter((e) => e.type === 'impact');

describe('perimeter wall impact (T68)', () => {
  it('a 25 m/s slam into the east wall emits one impact at the wall face', () => {
    const w = createGame();
    const b = w.town.bounds;
    const car = w.car;
    car.x = b.maxX - R - 0.1; // a short runway; speed set directly
    car.z = 0;
    car.heading = Math.PI / 2; // faces +x, straight at the wall
    car.vx = 25;
    car.vz = 0;
    car.speed = 25;

    stepGame(w, idle, DT);

    const hits = impacts(w);
    expect(hits).toHaveLength(1);
    expect(hits[0].speed).toBeGreaterThan(20);
    expect(hits[0].contact.x).toBeCloseTo(b.maxX, 6);
    expect(hits[0].contact.z).toBeCloseTo(0, 6);

    expect(car.x).toBeLessThanOrEqual(b.maxX - R + 1e-9); // stays inside the bounds
    expect(car.vx).toBeLessThanOrEqual(0); // and does not keep driving into the wall
  });

  it('grinding the perimeter wall at full throttle stays silent', () => {
    const w = createGame();
    const b = w.town.bounds;
    const car = w.car;
    car.x = b.maxX - R; // touching the wall
    car.z = 0;
    car.heading = Math.PI / 2;
    car.vx = 0;
    car.vz = 0;

    for (let i = 0; i < 120; i++) {
      stepGame(w, gas, DT);
      expect(impacts(w)).toHaveLength(0); // re-added ~0.15 m/s per step is not a hit
      expect(car.x).toBeLessThanOrEqual(b.maxX - R + 1e-9);
    }
  });

  it('driving along the wall is silent and keeps the car moving', () => {
    const w = createGame();
    const b = w.town.bounds;
    const car = w.car;
    car.x = b.maxX - R;
    car.z = 0;
    car.heading = 0; // faces +z, parallel to the wall
    car.vx = 0;
    car.vz = 20;
    car.speed = 20;

    for (let i = 0; i < 30; i++) {
      stepGame(w, gas, DT);
      expect(impacts(w)).toHaveLength(0); // no closing speed, no hit
      expect(car.x).toBeLessThanOrEqual(b.maxX - R + 1e-9);
    }
    expect(car.vz).toBeGreaterThan(19); // the tangential speed survives
  });
});
