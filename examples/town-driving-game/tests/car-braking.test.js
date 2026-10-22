// T57: the sim owns car.braking so the tail lights in carMesh can glow.
import { describe, it, expect } from 'vitest';
import { createCar, stepCar } from '../src/car.js';

const DT = 1 / 60;
const IDLE = { throttle: 0, brake: 0, handbrake: 0, steer: 0 };

function makeCar(over = {}) {
  return createCar({ x: 0, z: 0, heading: 0, ...over });
}

function run(car, controls, seconds) {
  for (let i = 0; i < Math.round(seconds / DT); i++) stepCar(car, controls, DT);
}

describe('car.braking', () => {
  it('is initialised false', () => {
    expect(makeCar().braking).toBe(false);
  });

  it('stays false at rest even with the brake held', () => {
    const car = makeCar();
    run(car, { ...IDLE, brake: 1 }, 0.5);
    expect(car.braking).toBe(false);
  });

  it('stays false under throttle', () => {
    const car = makeCar();
    run(car, { ...IDLE, throttle: 1 }, 1);
    expect(car.speed).toBeGreaterThan(0.5);
    expect(car.braking).toBe(false);
  });

  it('is true while braking from 10 m/s', () => {
    const car = makeCar();
    car.vz = 10; // heading 0 => forward is +z
    run(car, { ...IDLE, brake: 1 }, 0.2);
    expect(car.braking).toBe(true);
  });

  it('is false again once the brake is released', () => {
    const car = makeCar();
    car.vz = 10;
    run(car, { ...IDLE, brake: 1 }, 0.2);
    expect(car.braking).toBe(true);
    run(car, IDLE, 0.2);
    expect(car.braking).toBe(false);
  });
});
