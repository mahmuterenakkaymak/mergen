import { describe, it, expect } from 'vitest';
import { createGame, stepAmbient } from '../src/game.js';

// Behind the start screen main.js runs stepAmbient, not stepGame: the town must be alive
// (traffic looping, walkers pacing) while the car the attract orbit circles stays parked
// and the event channel — sound, toasts, damage — stays shut.
const STEP = 1 / 60;
const TWO_SECONDS = 120;

describe('stepAmbient', () => {
  it('moves the traffic and the walkers over two seconds', () => {
    const world = createGame();
    const cars = world.traffic.map((c) => [c.x, c.z]);
    const phases = world.peds.map((p) => p.phase);

    for (let i = 0; i < TWO_SECONDS; i++) stepAmbient(world, STEP);

    expect(world.traffic.some((c, i) => c.x !== cars[i][0] || c.z !== cars[i][1])).toBe(true);
    expect(world.peds.some((p, i) => p.phase !== phases[i])).toBe(true);
  });

  it('leaves the player car parked and raises no events', () => {
    const world = createGame();
    const { x, z, speed } = world.car;

    for (let i = 0; i < TWO_SECONDS; i++) stepAmbient(world, STEP);

    expect(world.car.x).toBe(x);
    expect(world.car.z).toBe(z);
    expect(world.car.speed).toBe(speed);
    expect(world.events).toEqual([]);
  });
});
